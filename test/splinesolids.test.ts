// The spline in regions and solids (docs/plans/spline.md): a loop with a
// spline edge, its area against a numerical integral; a closed spline cut by
// a line; extrude's volume, the exact B-rep's (solids.ts: the spline's own
// B-spline swept by a SURFACE_OF_LINEAR_EXTRUSION) against the solid kernel's
// (SMLib, the spline handed over as its exact NURBS); a revolve the same way;
// and the STEP, both ways it is written. Without the kernel build the kernel's
// half skips and says why, as every kernel test does.

import "../src/modules/builtin.ts";
import { test } from "node:test";
import assert from "node:assert/strict";
import { Model } from "../src/model.ts";
import { del, extrude, revolve } from "../src/operations.ts";
import { fix, onPlane } from "../src/relations/basic.ts";
import { addSpline } from "../src/relations/spline.ts";
import { splineCurve } from "../src/kinds/spline.ts";
import { domain, pointAt } from "../src/bspline.ts";
import { findLoops, describeLoop } from "../src/loops.ts";
import { featureFaces } from "../src/faces.ts";
import { programOf } from "../src/bodies.ts";
import { kernelBody } from "../src/kernelbrep.ts";
import { kernelSweep, solidsOf } from "../src/solids.ts";
import { stepExport, type KernelSolid } from "../src/step.ts";
import { Evaluator } from "../src/solids/evaluate.ts";
import { AP214_TYPES, checkShell, parseStep, refOf, type StepFile, type Value } from "./stepread.ts";
import { loadSolver } from "./solids/scene.ts";
import { kernel, noKernel as skip } from "./solids/load.ts";

const STAMP = "2026-11-06T00:00:00";

test("the kernel names a partial revolve's caps and wall where the members' first points say nothing of the side — before the spline too", { skip }, async () => {
  await loadSolver();
  // A circular segment over the x axis, its chord the axis: the line starts
  // on the axis and the arc's centre lies below it, opposite the region —
  // which is all tagRevolve used to read, and it took the side below.
  const m = new Model(3);
  const [a, b, c] = [[-8, 0, 0], [8, 0, 0], [0, 0, -6]].map((p) => m.addPoint(p).name);
  for (const p of [a, b, c]) fix(m, p, m.coords(p));
  const arc = m.addArc(c, b, a, 10, [0, -1, 0]).name;
  const axis = m.addLine(a, b).name;
  revolve(m, arc, axis, Math.PI / 2);
  assert.equal(m.solve().solved, true);
  const { program } = programOf(m, true);
  const ev = new Evaluator(await kernel());
  const r = ev.run(program).bodies[0];
  const faces = ev.topology(r.name)!.faces;
  ev.clear();
  const roles = faces.map((f) => `${f.kind === "plane" ? "plane" : "turned"}:${f.tag % 1000}`).sort();
  // The base and the lid for the two caps, member 0 for the arc's turned wall.
  assert.deepEqual(roles, ["plane:0", "plane:1", "turned:2"], JSON.stringify(roles));
});

/** What the exporter writes beyond AP214's analytic types: a B-spline, plain or as a complex instance (stepkernel.test.ts's list). */
const SPLINE_TYPES = new Set([...AP214_TYPES, "B_SPLINE_CURVE_WITH_KNOTS", "B_SPLINE_CURVE", "BOUNDED_CURVE", "CURVE",
  "GEOMETRIC_REPRESENTATION_ITEM", "RATIONAL_B_SPLINE_CURVE", "REPRESENTATION_ITEM",
  "B_SPLINE_SURFACE_WITH_KNOTS", "B_SPLINE_SURFACE", "BOUNDED_SURFACE", "SURFACE", "RATIONAL_B_SPLINE_SURFACE",
  "SURFACE_OF_LINEAR_EXTRUSION", "SURFACE_OF_REVOLUTION"]);

/** How many instances of a type a STEP file has. */
const count = (f: StepFile, t: string) => [...f.data.values()].filter((e) => e.types.includes(t)).length;

/** Every solid's shell closed, each edge used twice, once each way. */
function shellsClosed(f: StepFile, where: string): number {
  const breps = [...f.data.values()].filter((e) => e.types[0] === "MANIFOLD_SOLID_BREP");
  for (const b of breps) checkShell(f, refOf(b.args[1] as Value), where, true);
  return breps.length;
}

/** ½∮(x dy − y dx) of a curve by a polygon of `n` chords: the numerical integral the exact area is held to. */
function polygonArea(c: ReturnType<typeof splineCurve>, n = 40000): number {
  const [lo, hi] = domain(c);
  let a = 0;
  let p = pointAt(c, lo);
  for (let k = 1; k <= n; k++) {
    const q = pointAt(c, lo + ((hi - lo) * k) / n);
    a += p[0] * q[1] - p[1] * q[0];
    p = q;
  }
  return a / 2;
}

/** A D: an open spline over the top, a line back along the bottom — on the ground, held there, its points fixed. */
function dShape(m: Model): { spline: string; line: string; points: string[] } {
  const points = [[0, 0], [8, 12], [20, 15], [32, 9], [40, 0]].map((p) => m.addPoint(m.dim === 3 ? [...p, 0] : p).name);
  if (m.dim === 3) for (const p of points) onPlane(m, p, "origin");
  for (const p of points) fix(m, p, m.coords(p));
  const spline = addSpline(m, points);
  const line = m.addLine(points[4], points[0]).name;
  return { spline, line, points };
}

/** A closed spline on the ground, its points fixed. */
function blob(m: Model, at: [number, number] = [0, 0]): { spline: string; points: string[] } {
  const points = [[0, 0], [10, 8], [22, 3], [18, -9], [5, -7]].map(([x, y]) => m.addPoint(m.dim === 3 ? [x + at[0], y + at[1], 0] : [x + at[0], y + at[1]]).name);
  if (m.dim === 3) for (const p of points) onPlane(m, p, "origin");
  for (const p of points) fix(m, p, m.coords(p));
  return { spline: addSpline(m, points, true), points };
}

/** The kernel's bodies of a model, every body (one feature included), and its STEP with them. */
async function kernelRun(m: Model) {
  const { program, chains } = programOf(m, true);
  const ev = new Evaluator(await kernel());
  const results = ev.run(program).bodies;
  const solids: KernelSolid[] = results.map((r) => ({
    body: kernelBody(m, r.name, ev.topology(r.name)!, r),
    features: chains.get(r.name)!.features.map((f) => f.name),
  }));
  return { results, step: stepExport(m, { name: "spline", timestamp: STAMP }, solids) };
}

test("a loop with a spline edge: found by its joins, its area the exact one — held to a numerical integral", async () => {
  await loadSolver();
  const m = new Model(2);
  const { spline, line } = dShape(m);
  assert.equal(m.solve().solved, true);
  const loops = findLoops(m);
  assert.equal(loops.length, 1);
  assert.deepEqual(loops[0].members.map((x) => x.name).sort(), [line, spline].sort());
  // The D's area is the spline's sweep and the line's, which closes along y = 0.
  const want = Math.abs(polygonArea(splineCurve(m, spline)));
  assert.ok(Math.abs(loops[0].area - want) < 1e-6 * want, `${loops[0].area} against ${want}`);
});

test("a closed spline is a loop on its own; a line across it cuts it into two, their areas the whole", async () => {
  await loadSolver();
  const m = new Model(2);
  const { spline } = blob(m);
  assert.equal(m.solve().solved, true);
  const one = findLoops(m);
  assert.equal(one.length, 1);
  assert.deepEqual(one[0].members, [{ name: spline, reversed: one[0].members[0].reversed, from: null, to: null, span: null }]);
  const whole = Math.abs(polygonArea(splineCurve(m, spline)));
  assert.ok(Math.abs(one[0].area - whole) < 1e-6 * whole, `${one[0].area} against ${whole}`);
  m.addLine(m.addPoint([11, -20]).name, m.addPoint([11, 20]).name);
  const two = findLoops(m);
  assert.equal(two.length, 2, two.map((l) => describeLoop(l, two)).join("; "));
  assert.ok(Math.abs(two[0].area + two[1].area - one[0].area) < 1e-9 * whole, "the two halves make the whole");
  assert.ok(two.every((l) => l.members.some((x) => x.name === spline && x.span !== null)), "each runs along a part of the spline");
});

test("a region bounded by part of a spline is found but not extruded — refused by name; the whole one extrudes", async () => {
  await loadSolver();
  const m = new Model(3);
  const { spline, points } = blob(m);
  // A chord between two of its own points: the two regions' corners are real points.
  const chord = m.addLine(points[0], points[2]).name;
  assert.equal(m.solve().solved, true);
  const two = findLoops(m);
  assert.equal(two.length, 2, two.map((l) => describeLoop(l, two)).join("; "));
  for (const loop of two) {
    assert.throws(() => extrude(m, chord, 5, "origin", [loop.members]),
      new RegExp(`a part of the spline "${spline}" bounds this region — a spline makes a solid only whole, an edge from its first point to its last or a loop on its own`));
  }
  assert.equal(m.features.size, 0, "nothing made");
  del(m, chord);
  extrude(m, spline, 5);
  assert.equal(m.features.size, 1, "the whole one extrudes");
});

test("a closed spline on a tilted plane in 3D is a loop in that plane", async () => {
  await loadSolver();
  const m = new Model(3);
  const v = [0, Math.cos(0.5), Math.sin(0.5)];
  const at = (x: number, y: number) => [2 + x, 3 + y * v[1], 4 + y * v[2]];
  const pts = [[0, 0], [10, 8], [22, 3], [18, -9], [5, -7]].map(([x, y]) => m.addPoint(at(x, y)).name);
  addSpline(m, pts, true);
  const loops = findLoops(m);
  assert.equal(loops.length, 1);
  const n = loops[0].plane.normal;
  assert.ok(Math.abs(Math.abs(n[1]) - Math.sin(0.5)) < 1e-9 && Math.abs(Math.abs(n[2]) - Math.cos(0.5)) < 1e-9, JSON.stringify(n));
});

test("a closed spline in no frame's plane extrudes along its own plane — its plane from three of its points, it carries no normal", async () => {
  // Found making the OpenCascade fixtures: the loop's own plane is asked of
  // sketchface.ts, which took any whole closed curve for a circle and asked
  // it for a normal a spline has not got — extrude threw.
  await loadSolver();
  const m = new Model(3);
  const v = [0, Math.cos(0.5), Math.sin(0.5)];
  const at = (x: number, y: number) => [2 + x, 3 + y * v[1], 4 + y * v[2]];
  const pts = [[0, 0], [12, 9], [24, 2], [17, -10], [4, -6]].map(([x, y]) => m.addPoint(at(x, y)).name);
  for (const p of pts) fix(m, p, m.coords(p));
  const s = addSpline(m, pts, true);
  extrude(m, s, 9);
  assert.ok(m.solve().solved);
  // Its area in its own plane: the same curve laid flat (interpolation through
  // points moved rigidly is the same curve moved), by the shoelace of a fine sampling.
  const c = splineCurve(m, s);
  const [lo, hi] = domain(c);
  let area = 0;
  let prev = pointAt(c, lo);
  const flat = (q: number[]) => [q[0], (q[1] - 3) * v[1] + (q[2] - 4) * v[2]];
  for (let k = 1; k <= 20000; k++) {
    const q = pointAt(c, lo + ((hi - lo) * k) / 20000);
    const [a, b] = [flat(prev), flat(q)];
    area += (a[0] * b[1] - b[0] * a[1]) / 2;
    prev = q;
  }
  const volume = solidsOf(m).bodies.reduce((t, b) => t + b.volume, 0);
  assert.ok(Math.abs(volume - 9 * Math.abs(area)) < 1e-6 * volume, `${volume} against ${9 * Math.abs(area)}`);
});

test("extrude a spline profile: the exact B-rep's volume is its area by its depth, its wall the spline swept", async () => {
  await loadSolver();
  const m = new Model(3);
  const { spline } = dShape(m);
  const b = blob(m, [0, -40]);
  extrude(m, spline, 12);
  extrude(m, b.spline, -6);
  assert.equal(m.solve().solved, true);
  const area = (s: string) => Math.abs(polygonArea(splineCurve(m, s)));
  const { bodies, skipped } = solidsOf(m);
  assert.deepEqual(skipped, []);
  const [d, round] = bodies;
  assert.ok(Math.abs(d.volume - 12 * area(spline)) < 1e-6 * d.volume, `D: ${d.volume} against ${12 * area(spline)}`);
  assert.ok(Math.abs(round.volume - 6 * area(b.spline)) < 1e-6 * round.volume, `blob: ${round.volume}`);
  assert.deepEqual(d.outer.faces.map((f) => f.surface.kind).sort(), ["extrusion", "plane", "plane", "plane"]);
  // A closed spline is two halves, as a circle is: no face with a seam.
  assert.deepEqual(round.outer.faces.map((f) => f.surface.kind).sort(), ["extrusion", "extrusion", "plane", "plane"]);
  const e = round.outer.faces.find((f) => f.surface.kind === "extrusion")!;
  assert.equal(e.surface.kind === "extrusion" && e.surface.curve.kind, "bspline");
  // The lid is the spline's twin: a spline through the twins of its points.
  const twin = m.featureOf("e1").twins[0].find((t) => m.entities.get(t)?.kind === "spline")!;
  assert.ok(twin, "a twin spline");
  // Drawn: the wall is a ruled strip, a quad per sample, every one planar.
  const faces = featureFaces(m, m.featureOf("e2"), 4);
  const walls = faces.filter((f) => f.kind === "wall");
  assert.ok(walls.length > 20, `${walls.length} wall quads`);
  for (const w of walls) assert.equal(w.edges.length, 2, "no wall line on a closed spline's wall: it has no vertex");
});

test("the solid kernel extrudes a spline profile to the exact B-rep's volume; STEP writes it both ways", { skip }, async () => {
  await loadSolver();
  const m = new Model(3);
  const { spline } = dShape(m);
  const b = blob(m, [0, -40]);
  extrude(m, spline, 12);
  extrude(m, b.spline, 6);
  assert.equal(m.solve().solved, true);
  const profile = kernelSweep(m, m.featureOf("e1", "extrude")).profile;
  assert.deepEqual(profile.loops.map((l) => l.map((x) => x.kind).sort()), [["line", "nurbs"]], "the spline goes to the kernel as itself");
  const { results, step } = await kernelRun(m);
  for (const body of solidsOf(m).bodies) {
    const r = results.find((x) => x.name === body.feature)!;
    assert.deepEqual(r.failed, [], body.feature);
    assert.deepEqual(r.solid!.validity, { manifold: true, failures: 0 }, `${body.feature}: a valid solid`);
    assert.ok(Math.abs(r.solid!.volume - body.volume) < 1e-6 * body.volume, `${body.feature}: the kernel's ${r.solid!.volume} against ${body.volume}`);
  }
  // The kernel's bodies, as STEP: each wall the kernel's own B-spline surface.
  const parsed = parseStep(step.text);
  for (const e of parsed.data.values()) for (const t of e.types) assert.ok(SPLINE_TYPES.has(t), `${t} is a type the exporter writes`);
  assert.ok(count(parsed, "B_SPLINE_SURFACE_WITH_KNOTS") >= 2, "each wall the kernel's surface");
  assert.equal(shellsClosed(parsed, "kernel"), 2);
  // And the exact bodies on their own (no kernel handed in): the spline itself, swept.
  const p2 = parseStep(stepExport(m, { name: "spline", timestamp: STAMP }).text);
  for (const e of p2.data.values()) for (const t of e.types) assert.ok(SPLINE_TYPES.has(t), `${t} is a type the exporter writes`);
  assert.equal(count(p2, "SURFACE_OF_LINEAR_EXTRUSION"), 3, "the D's wall, and the blob's two halves");
  assert.ok(count(p2, "B_SPLINE_CURVE_WITH_KNOTS") >= 3 + 4, "each spline edge, base and lid, and each sweep's directrix");
  assert.equal(shellsClosed(p2, "exact"), 2);
});

test("revolve a spline profile: the exact B-rep is a surface of revolution of the spline, its volume by Pappus — the kernel's too", { skip }, async () => {
  await loadSolver();
  const m = new Model(3);
  // A D standing on the x axis, its straight side along it: turned about it.
  const pts = [[0, 0, 0], [8, 0, 10], [20, 0, 13], [32, 0, 8], [40, 0, 0]].map((p) => m.addPoint(p).name);
  for (const p of pts) fix(m, p, m.coords(p));
  const s = addSpline(m, pts);
  const axis = m.addLine(pts[4], pts[0]).name;
  revolve(m, s, axis, Math.PI / 2);
  assert.equal(m.solve().solved, true);
  const { bodies, skipped } = solidsOf(m);
  assert.deepEqual(skipped, []);
  assert.ok(bodies[0].outer.faces.some((f) => f.surface.kind === "revolution" && f.surface.curve.kind === "bspline"));
  const { results, step } = await kernelRun(m);
  const r = results.find((x) => x.name === "e1")!;
  assert.deepEqual(r.failed, []);
  assert.ok(Math.abs(r.solid!.volume - bodies[0].volume) < 1e-6 * bodies[0].volume, `kernel ${r.solid!.volume}, exact ${bodies[0].volume}`);
  const parsed = parseStep(stepExport(m, { name: "spline", timestamp: STAMP }).text);
  assert.equal(count(parsed, "SURFACE_OF_REVOLUTION"), 1);
  assert.equal(shellsClosed(parsed, "revolved"), 1);
  const ks = parseStep(step.text);
  // (The kernel named the turned wall for the axis line until naming.ts read
  // the profile's side along every member — the test below.)
  assert.ok(count(ks, "B_SPLINE_SURFACE_WITH_KNOTS") >= 1, `the kernel's turned wall, its own NURBS: ${[...new Set([...ks.data.values()].flatMap((e) => e.types))].join(" ")}`);
});
