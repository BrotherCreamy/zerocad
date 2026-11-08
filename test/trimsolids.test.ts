// What a trim leaves makes solids (docs/plans/trim-everything.md): an
// elliptical arc and a spline of control points each bound a region, extrude,
// follow their profile when it moves, and go to STEP — the exact B-rep's
// elliptical edge trimmed by its two vertices, or the piece's own B-spline —
// read back by the suite's Part 21 reader with every topological rule a kernel
// checks (stepread.ts), and through the solid kernel where it is built. The
// kernel half skips and says why, as every kernel test does.
//
// Closed forms throughout: an elliptical segment's area by the circle it is an
// affine image of; a spline piece's by Green's theorem per knot span.

import "../src/modules/builtin.ts";
import { test } from "node:test";
import assert from "node:assert/strict";
import { Model } from "../src/model.ts";
import { extrude, revolve } from "../src/operations.ts";
import { fix, onPlane } from "../src/relations/basic.ts";
import { addSpline } from "../src/relations/spline.ts";
import { addEllipse } from "../src/kinds/ellipse.ts";
import { minorAxis } from "../src/relations/geometry.ts";
import { pathCurveOf } from "../src/kinds/spline.ts";
import { derivs, type BSpline } from "../src/bspline.ts";
import { trim } from "../src/sketchedit.ts";
import { open, save } from "../src/persist.ts";
import { programOf } from "../src/bodies.ts";
import { kernelBody } from "../src/kernelbrep.ts";
import { kernelSweep, solidsOf } from "../src/solids.ts";
import { stepExport, type KernelSolid } from "../src/step.ts";
import { Evaluator } from "../src/solids/evaluate.ts";
import { AP214_TYPES, checkShell, parseStep, refOf, type StepFile, type Value } from "./stepread.ts";
import { loadSolver } from "./solids/scene.ts";
import { kernel, noKernel as skip } from "./solids/load.ts";

const STAMP = "2026-11-08T00:00:00";

/** What the exporter writes beyond AP214's analytic types (splinesolids.test.ts's list). */
const TYPES = new Set([...AP214_TYPES, "ELLIPSE", "B_SPLINE_CURVE_WITH_KNOTS", "B_SPLINE_CURVE", "BOUNDED_CURVE", "CURVE",
  "GEOMETRIC_REPRESENTATION_ITEM", "RATIONAL_B_SPLINE_CURVE", "REPRESENTATION_ITEM",
  "B_SPLINE_SURFACE_WITH_KNOTS", "B_SPLINE_SURFACE", "BOUNDED_SURFACE", "SURFACE", "RATIONAL_B_SPLINE_SURFACE",
  "SURFACE_OF_LINEAR_EXTRUSION", "SURFACE_OF_REVOLUTION"]);

const count = (f: StepFile, t: string) => [...f.data.values()].filter((e) => e.types.includes(t)).length;

/** Every solid's shell closed, each edge used twice, once each way. */
function shellsClosed(f: StepFile, where: string): number {
  const breps = [...f.data.values()].filter((e) => e.types[0] === "MANIFOLD_SOLID_BREP");
  for (const b of breps) checkShell(f, refOf(b.args[1] as Value), where, true);
  return breps.length;
}

/** Points on the ground, held there and fixed where they are. */
function laid(m: Model, xy: number[][]): string[] {
  const p = xy.map(([x, y]) => m.addPoint([x, y, 0]).name);
  for (const q of p) { onPlane(m, q, "origin"); fix(m, q, m.coords(q)); }
  return p;
}

/** A line on the ground across y = `y`, its ends fixed. */
function chord(m: Model, y: number, x0 = -40, x1 = 40): string {
  const [a, b] = laid(m, [[x0, y], [x1, y]]);
  return m.addLine(a, b).name;
}

/** The area of the ellipse with semi-axes a (along x) and b above y = h: the circle's segment, squeezed. */
function segmentArea(a: number, b: number, h: number): number {
  const d = (h * a) / b;
  return (b / a) * (a * a * Math.acos(d / a) - d * Math.sqrt(a * a - d * d));
}

/** ½∫(x dy − y dx) over a B-spline's domain, by 5-point Gauss–Legendre per span — exact for a cubic. */
function sweep(c: BSpline): number {
  const GL = [[-0.906179845938664, 0.236926885056189], [-0.538469310105683, 0.478628670499366], [0, 0.568888888888889],
    [0.538469310105683, 0.478628670499366], [0.906179845938664, 0.236926885056189]];
  const spans = [...new Set(c.knots)];
  let sum = 0;
  for (let k = 0; k + 1 < spans.length; k++) {
    const [a, b] = [spans[k], spans[k + 1]];
    for (const [x, w] of GL) {
      const [p, d] = derivs(c, (a + b) / 2 + ((b - a) / 2) * x, 1);
      sum += ((b - a) / 2) * w * (p[0] * d[1] - p[1] * d[0]) / 2;
    }
  }
  return sum;
}

/** An ellipse on the ground, 20 by 10, its centre and major end fixed, trimmed below y = 4 — an elliptical arc over a chord. */
function cap(m: Model): { arc: string; line: string } {
  const [c, major] = laid(m, [[0, 0], [20, 0]]);
  const el = addEllipse(m, c, major, 10).name;
  // Its minor held: free, a solve that moves the chord would be free to move it too.
  minorAxis(m, el, 10);
  const line = chord(m, 4);
  assert.equal(m.solve().solved, true);
  trim(m, el, [0, -10, 0]);
  return { arc: el, line };
}

/** A spline D on the ground over a chord at y = 3, its two ends below the chord trimmed off — a spline of control points over a chord. */
function dome(m: Model, dx = 0): { piece: string; line: string } {
  const s = addSpline(m, laid(m, [[0, 0], [8, 12], [20, 15], [32, 9], [40, 0]].map(([x, y]) => [x + dx, y])));
  const line = chord(m, 3, dx - 10, dx + 50);
  assert.equal(m.solve().solved, true);
  trim(m, s, [dx + 0.5, 0.5, 0]);
  trim(m, s, [dx + 39.5, 0.5, 0]);
  return { piece: s, line };
}

/** A 10 × 10 square on the ground at y = `y`, its points fixed: a solid for the wireframe test to stand beside. */
function addSquare(m: Model, y: number): string {
  const p = laid(m, [[0, y], [10, y], [10, y + 10], [0, y + 10]]);
  const l = p.map((a, i) => m.addLine(a, p[(i + 1) % 4]).name);
  return l[0];
}

/** The piece's region: its own sweep and the chord's back under it. */
function domeArea(m: Model, piece: string): number {
  const c = pathCurveOf(m, piece);
  const [S, E] = [c.ctrl[0], c.ctrl[c.ctrl.length - 1]];
  return Math.abs(sweep(c) + (E[0] * S[1] - E[1] * S[0]) / 2);
}

test("an elliptical arc over a chord bounds a region and extrudes: the exact B-rep's volume its segment by the depth, its edge an ellipse trimmed by two vertices", async () => {
  await loadSolver();
  const m = new Model(3);
  const { arc } = cap(m);
  assert.equal(m.entities.get(arc)!.kind, "earc");
  extrude(m, arc, 5);
  assert.equal(m.solve().solved, true);
  const [body] = solidsOf(m).bodies;
  const want = 5 * segmentArea(20, 10, 4);
  assert.ok(Math.abs(body.volume - want) < 1e-6 * want, `${body.volume} against ${want}`);
  const f = parseStep(stepExport(m, { name: "cap", timestamp: STAMP }).text);
  for (const e of f.data.values()) for (const t of e.types) assert.ok(TYPES.has(t), `${t} is a type the exporter writes`);
  assert.equal(count(f, "ELLIPSE") >= 2, true, "the base's and the lid's elliptical edges (and the wall's directrix)");
  assert.equal(count(f, "SURFACE_OF_LINEAR_EXTRUSION"), 1, "the wall: the ellipse swept");
  assert.equal(shellsClosed(f, "exact"), 1);
  // An elliptical edge runs between two vertices, not round from one.
  const ellipses = new Set([...f.data.entries()].filter(([, e]) => e.types.includes("ELLIPSE")).map(([id]) => id));
  const edges = [...f.data.values()].filter((e) => e.types.includes("EDGE_CURVE") && ellipses.has(refOf(e.args[3] as Value)));
  assert.ok(edges.length >= 2, `${edges.length} elliptical edges`);
  for (const e of edges) assert.notEqual(refOf(e.args[1] as Value), refOf(e.args[2] as Value), "its two vertices are two");
  // Saved and opened, the same solid.
  const back = open(save(m), 3);
  assert.equal(back.solve().solved, true);
  assert.ok(Math.abs(solidsOf(back).bodies[0].volume - want) < 1e-6 * want, "reopened");
});

test("the solid follows the elliptical arc: the chord moved, the trimmed ends ride it and the volume is the new segment's", async () => {
  await loadSolver();
  const m = new Model(3);
  const { line } = cap(m);
  extrude(m, "el1", 5);
  assert.equal(m.solve().solved, true);
  // Lower the chord to y = 2: its points are fixed, so their fixes are re-said.
  for (const r of [...m.relations.values()].filter((r) => r.op === "fix" && m.line(line).refs.includes(r.args[0] as string))) m.deleteRelation(r.name);
  for (const [p, x] of m.line(line).refs.map((p, k) => [p, k === 0 ? -40 : 40] as const)) fix(m, p, [x, 2, 0]);
  assert.equal(m.solve().solved, true);
  const want = 5 * segmentArea(20, 10, 2);
  const v = solidsOf(m).bodies[0].volume;
  assert.ok(Math.abs(v - want) < 1e-6 * want, `${v} against ${want}`);
});

test("a trim across the elliptical arc under an extrude regenerates the solid onto the face left, in one typed call; a trim of the spline piece under one likewise", async () => {
  await loadSolver();
  const m = new Model(3);
  cap(m);
  extrude(m, "el1", 5);
  // A wall at x = 5: the arc's piece right of it trimmed away, and the chord's.
  const [a, b] = laid(m, [[5, -20], [5, 20]]);
  const wall = m.addLine(a, b).name;
  assert.equal(m.solve().solved, true);
  const entries = m.journal.length;
  trim(m, "el1", [15, 6, 0]);
  const ops = m.journal.slice(entries).map((e) => e.op);
  assert.equal(ops[0], "trim", "the trim, the regeneration inside it");
  assert.ok(ops.slice(1).every((op) => op === "deleteRelation" || op === "deleteEntity"), `then only its tidying, as del journals it: ${ops}`);
  assert.equal((m.journal[entries].args[3] as unknown[]).length, 1, "the feature it regenerated, resolved");
  assert.equal(m.solve().solved, true);
  const names = m.featureOf("e1", "extrude").loops[0].map((x) => (typeof x === "string" ? x : x.name));
  assert.ok(names.includes(wall), `the outline runs along the wall now: ${names}`);
  // ∫ from the chord's left crossing to x = 5 of (b√(1 − x²/a²) − 4) dx.
  const [A, B, h] = [20, 10, 4];
  const F = (x: number) => (B / A) * ((x / 2) * Math.sqrt(A * A - x * x) + ((A * A) / 2) * Math.asin(x / A)) - h * x;
  const x0 = -A * Math.sqrt(1 - (h / B) ** 2);
  const want = 5 * (F(5) - F(x0));
  const v = solidsOf(m).bodies[0].volume;
  assert.ok(Math.abs(v - want) < 1e-6 * want, `${v} against ${want}`);
  const back = open(save(m), 3);
  assert.equal(save(back), save(m), "it replays");

  const n = new Model(3);
  const { piece } = dome(n);
  extrude(n, piece, 12);
  const [c, d] = laid(n, [[20, -20], [20, 30]]);
  const cut = n.addLine(c, d).name;
  assert.equal(n.solve().solved, true);
  const before = domeArea(n, piece);
  trim(n, piece, [30, 10, 0]);
  assert.equal(n.solve().solved, true);
  const loop = n.featureOf("e1", "extrude").loops[0].map((x) => (typeof x === "string" ? x : x.name));
  assert.ok(loop.includes(cut), `the outline runs along the cut: ${loop}`);
  const after = solidsOf(n).bodies[0].volume / 12;
  assert.ok(after < before && after > 0.3 * before, `the solid stands on the piece left: ${after} of ${before}`);
  const back2 = open(save(n), 3);
  assert.equal(save(back2), save(n), "it replays");
});

test("a revolve of an elliptical arc is refused by name, as an ellipse's is", async () => {
  await loadSolver();
  const m = new Model(3);
  const { arc, line } = cap(m);
  assert.throws(() => revolve(m, arc, line, Math.PI / 2), /"el1" is an elliptical arc — revolving an ellipse is not supported yet/);
});

test("a spline trimmed to a piece over a chord bounds a region and extrudes: its volume the piece's own area by the depth, its wall the piece swept", async () => {
  await loadSolver();
  const m = new Model(3);
  const { piece } = dome(m);
  assert.equal(m.entities.get(piece)!.kind, "bspline");
  extrude(m, piece, 12);
  assert.equal(m.solve().solved, true);
  const want = 12 * domeArea(m, piece);
  const v = solidsOf(m).bodies[0].volume;
  assert.ok(Math.abs(v - want) < 1e-6 * want, `${v} against ${want}`);
  const f = parseStep(stepExport(m, { name: "dome", timestamp: STAMP }).text);
  for (const e of f.data.values()) for (const t of e.types) assert.ok(TYPES.has(t), `${t} is a type the exporter writes`);
  assert.equal(count(f, "SURFACE_OF_LINEAR_EXTRUSION"), 1, "the piece swept");
  assert.ok(count(f, "B_SPLINE_CURVE_WITH_KNOTS") >= 3, "the base's edge, the lid's and the directrix");
  assert.equal(shellsClosed(f, "exact"), 1);
  const back = open(save(m), 3);
  assert.equal(back.solve().solved, true);
  assert.ok(Math.abs(solidsOf(back).bodies[0].volume - want) < 1e-6 * want, "reopened");
});

test("the solid kernel extrudes both pieces to the exact B-rep's volumes — the elliptical arc as its exact rational NURBS — and STEP writes its bodies closed", { skip }, async () => {
  await loadSolver();
  const m = new Model(3);
  cap(m);
  extrude(m, "el1", 5);
  const { piece } = dome(m, 80);
  extrude(m, piece, 12);
  assert.equal(m.solve().solved, true);
  const kinds = kernelSweep(m, m.featureOf("e1", "extrude")).profile.loops.map((l) => l.map((x) => x.kind).sort());
  assert.deepEqual(kinds, [["line", "nurbs"]], "the elliptical arc goes to the kernel as a NURBS of itself");
  const { program, chains } = programOf(m, true);
  const ev = new Evaluator(await kernel());
  const results = ev.run(program).bodies;
  const exact = solidsOf(m).bodies;
  for (const body of exact) {
    const r = results.find((x) => x.name === body.feature)!;
    assert.deepEqual(r.failed, [], body.feature);
    assert.deepEqual(r.solid!.validity, { manifold: true, failures: 0 }, `${body.feature}: a valid solid`);
    assert.ok(Math.abs(r.solid!.volume - body.volume) < 1e-6 * body.volume, `${body.feature}: the kernel's ${r.solid!.volume} against ${body.volume}`);
  }
  const solids: KernelSolid[] = results.map((r) => ({
    body: kernelBody(m, r.name, ev.topology(r.name)!, r),
    features: chains.get(r.name)!.features.map((f) => f.name),
  }));
  const f = parseStep(stepExport(m, { name: "pieces", timestamp: STAMP }, solids).text);
  for (const e of f.data.values()) for (const t of e.types) assert.ok(TYPES.has(t), `${t} is a type the exporter writes`);
  assert.equal(shellsClosed(f, "kernel"), 2);
  ev.clear();
});

test("a loose elliptical arc and a loose spline piece go to STEP as wireframe: a trimmed ellipse and a B-spline", async () => {
  await loadSolver();
  const m = new Model(3);
  cap(m);
  dome(m, 80);
  // A solid beside them: a STEP file of nothing is refused.
  extrude(m, addSquare(m, -60), 2);
  const x = stepExport(m, { name: "loose", timestamp: STAMP, curves: true });
  const f = parseStep(x.text);
  const trimmed = [...f.data.values()].filter((e) => e.types.includes("TRIMMED_CURVE"));
  const onEllipse = trimmed.filter((e) => f.data.get(refOf(e.args[1] as Value))!.types.includes("ELLIPSE"));
  assert.equal(onEllipse.length, 1, "the elliptical arc: its ellipse, trimmed");
  assert.ok(count(f, "B_SPLINE_CURVE_WITH_KNOTS") >= 1, "the spline piece");
});
