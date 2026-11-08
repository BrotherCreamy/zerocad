// Trim every sketch curve (docs/plans/trim-everything.md). The owner: *"Also
// need trim for sketch entities"*.
//
// Each curve kind trimmed against the others: the right piece goes, and what
// is kept is the same curve it was — read back off the entity, against the
// curve as it stood before the trim, never through the relation that holds
// it. An ellipse's piece is an elliptical arc (`earc`); a spline's a spline of
// control points (`bspline`) — the piece of an interpolant is exactly a
// clamped B-spline, by knot insertion.

import { test } from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { ensureKernelLoaded } from "../src/kernel/problem.ts";
import { Model, isClosedEntity } from "../src/model.ts";
import { extend, trim } from "../src/sketchedit.ts";
import { open, save } from "../src/persist.ts";
import { addEllipse, addEllipticArc, semiAxes } from "../src/kinds/ellipse.ts";
import { addBSpline } from "../src/kinds/spline.ts";
import { addSpline } from "../src/relations/spline.ts";
import { minorAxis, onEllipse, tangent } from "../src/relations/geometry.ts";
import { dist, fix } from "../src/relations/basic.ts";
import { onSpline } from "../src/relations/spline.ts";
import { extrude } from "../src/operations.ts";
import { Repl } from "../src/repl.ts";
import { neocadScope } from "../src/replenv.ts";
import { TrimTool } from "../src/tools/trim.ts";
import type { ToolContext } from "../src/tools/tool.ts";
import { cutsOf, distanceToCurve, pointOn } from "../src/sketchgeom.ts";
import { curveFrame } from "../src/curveplane.ts";
import { arcPoint } from "../src/arcgeom.ts";
import "../src/modules/builtin.ts";

await ensureKernelLoaded(await readFile(new URL("../src/kernel/wasm-gen/neocad_kernel_bg.wasm", import.meta.url)));

const sub = (a: number[], b: number[]) => a.map((x, i) => x - b[i]);
const near = (a: number[], b: number[], tol = 1e-6) => Math.hypot(...sub(a, b)) <= tol;
const close = (a: number, b: number, tol = 1e-6, what = "") => assert.ok(Math.abs(a - b) <= tol, `${what} ${a} vs ${b}`);

function solved(m: Model) {
  const r = m.solve();
  assert.equal(r.solved, true, JSON.stringify(r.offenders));
  assert.ok(r.maxResidual < 1e-6, `max residual ${r.maxResidual}`);
  return r;
}

/** A line between two new points. */
function seg(m: Model, a: number[], b: number[]): string {
  const z = m.dim === 3 && a.length === 2 ? [0] : [];
  return m.addLine(m.addPoint([...a, ...z]).name, m.addPoint([...b, ...z]).name).name;
}

/** Save, open, save: the same text twice — the trim replays to the same model. */
function replays(m: Model): Model {
  const once = save(m);
  const back = open(once, m.dim);
  assert.equal(save(back), once, "the replay is the same model");
  return back;
}

/** How far `p` is from the ellipse with semi-axes a, b along x and y about `c` — zero on it. */
function offEllipse(p: number[], c: number[], a: number, b: number): number {
  return Math.abs(Math.hypot((p[0] - c[0]) / a, (p[1] - c[1]) / b) - 1);
}

test("an ellipse crossed by a line trims to an elliptical arc under its own name: the piece clicked goes, the rest is the same ellipse", () => {
  const m = new Model(2);
  const c = m.addPoint([0, 0]).name;
  const el = addEllipse(m, c, m.addPoint([20, 0]).name, 10).name;
  seg(m, [-30, 4], [30, 4]); // crosses the ellipse at y = 4, x = ±20·√(1 − 0.16)
  solved(m);
  const out = trim(m, el, [0, -10]); // the lower, larger piece goes
  assert.deepEqual(out, [el]);
  const e = m.entities.get(el)!;
  assert.equal(e.kind, "earc", "an elliptical arc, under the ellipse's name");
  const x = 20 * Math.sqrt(1 - 0.16);
  const arc = e as Extract<typeof e, { kind: "earc" }>;
  assert.ok(near(m.coords(arc.start), [x, 4]) && near(m.coords(arc.end), [-x, 4]), "kept: the top, start to end counter-clockwise");
  solved(m);
  // The kept piece is the same curve: every point along it on the old ellipse, and above the cut.
  const f = curveFrame(m, e)!;
  for (let k = 0; k <= 16; k++) {
    const p = arcPoint(f, (k / 16) * f.sweep);
    assert.ok(offEllipse(p, [0, 0], 20, 10) < 1e-9, `sample ${k} on the old ellipse`);
    assert.ok(p[1] >= 4 - 1e-9, `sample ${k} on the kept side: ${p}`);
  }
  replays(m);
});

// --- every kind against every kind ---------------------------------------------

/** Where a 2D drawing's (x, y) lands: the plane itself in 2D, a plane tipped in no frame's way in 3D. */
interface Sheet { at: (x: number, y: number) => number[]; normal: number[] | null }

function sheet(dim: 2 | 3): Sheet {
  if (dim === 2) return { at: (x, y) => [x, y], normal: null };
  const unit = (v: number[]) => { const l = Math.hypot(...v); return v.map((x) => x / l); };
  const u = unit([1, 0, 0.4]);
  const w = [0, 1, 0.3];
  const d = w.reduce((s, x, i) => s + x * u[i], 0);
  const v = unit(w.map((x, i) => x - d * u[i]));
  const n = [u[1] * v[2] - u[2] * v[1], u[2] * v[0] - u[0] * v[2], u[0] * v[1] - u[1] * v[0]];
  const o = [1, 2, 3];
  return { at: (x, y) => o.map((c, i) => c + x * u[i] + y * v[i]), normal: n };
}

type Build = (m: Model, s: Sheet) => string;
const pt = (m: Model, s: Sheet, x: number, y: number) => m.addPoint(s.at(x, y)).name;
const deg = Math.PI / 180;

const line = (a: [number, number], b: [number, number]): Build => (m, s) => m.addLine(pt(m, s, ...a), pt(m, s, ...b)).name;
const arc = (c: [number, number], r: number, from: number, to: number): Build => (m, s) =>
  m.addArc(pt(m, s, ...c), pt(m, s, c[0] + r * Math.cos(from * deg), c[1] + r * Math.sin(from * deg)),
    pt(m, s, c[0] + r * Math.cos(to * deg), c[1] + r * Math.sin(to * deg)), r, s.normal).name;
const circle = (c: [number, number], r: number): Build => (m, s) => m.addCircle(pt(m, s, ...c), r, s.normal).name;
/** An ellipse: semi-axis `a` toward `dir` (degrees), `b` across. */
const ellipse = (c: [number, number], a: number, b: number, dir = 0): Build => (m, s) =>
  addEllipse(m, pt(m, s, ...c), pt(m, s, c[0] + a * Math.cos(dir * deg), c[1] + a * Math.sin(dir * deg)), b, s.normal).name;
/** An elliptical arc of the same, from eccentric anomaly `from` to `to` (degrees), its ends held on it. */
const earc = (c: [number, number], a: number, b: number, dir: number, from: number, to: number): Build => (m, s) => {
  const [ux, uy] = [Math.cos(dir * deg), Math.sin(dir * deg)];
  const at = (t: number) => [c[0] + a * Math.cos(t * deg) * ux - b * Math.sin(t * deg) * uy, c[1] + a * Math.cos(t * deg) * uy + b * Math.sin(t * deg) * ux] as [number, number];
  const [st, en] = [pt(m, s, ...at(from)), pt(m, s, ...at(to))];
  const e = addEllipticArc(m, pt(m, s, ...c), pt(m, s, c[0] + a * ux, c[1] + a * uy), b, st, en, s.normal).name;
  onEllipse(m, st, e);
  onEllipse(m, en, e);
  return e;
};
const spline = (...p: [number, number][]): Build => (m, s) => addSpline(m, p.map((q) => pt(m, s, ...q)));
const bspline = (knots: number[], ...p: [number, number][]): Build => (m, s) => addBSpline(m, p.map((q) => pt(m, s, ...q)), knots).name;

/** What is trimmed: each kind once, about the origin and about 30 across. */
const TARGETS: Record<string, Build> = {
  line: line([-20, -1], [20, 1]),
  arc: arc([0, -20], 24, 45, 135),
  circle: circle([0, 0], 10),
  ellipse: ellipse([0, 0], 15, 7),
  earc: earc([0, 0], 15, 7, 0, 20, 170),
  spline: spline([-15, -4], [-5, 5], [5, -5], [15, 4]),
  bspline: bspline([0, 0, 0, 0, 0.5, 1, 1, 1, 1], [-15, 2], [-8, -9], [0, 9], [8, -9], [15, 2]),
};

/** What cuts it: each kind once, standing across the targets near x = 3. */
const CUTTERS: Record<string, Build> = {
  line: line([3, -14], [4, 14]),
  arc: arc([40, 0], 37, 158, 202),
  circle: circle([3, 1], 11),
  ellipse: ellipse([3, 0], 13, 6, 90),
  earc: earc([3, 0], 13, 6, 90, 20, 160),
  spline: spline([3, -14], [1, -5], [5, 5], [3, 14]),
  bspline: bspline([0, 0, 0, 0, 0.5, 1, 1, 1, 1], [6, -14], [0, -6], [6, 0], [0, 6], [6, 14]),
};

/** Trims `target`'s first piece where `cutter` crosses it, and checks it: the piece gone, what is kept the same curve. */
function trimmedAgainst(dim: 2 | 3, target: string, cutter: string): void {
  const m = new Model(dim);
  const s = sheet(dim);
  const t = TARGETS[target](m, s);
  CUTTERS[cutter](m, s);
  solved(m);
  const closed = isClosedEntity(m.entities.get(t)!);
  const cuts = cutsOf(m, t);
  assert.ok(cuts.length >= (closed ? 2 : 1), `${cutter} cuts ${target} ${cuts.length} times`);
  // The piece from the curve's start (a closed one's: from its first cut) to the next cut.
  const [a, b] = closed ? [cuts[0].t, cuts[1].t] : [0, cuts[0].t];
  const place = pointOn(m, t, (a + b) / 2);
  const before = open(save(m), dim);
  const out = trim(m, t, place);
  const size = 30;
  for (const n of out) {
    for (let k = 0; k <= 40; k++) {
      const p = pointOn(m, n, k / 40);
      const d = distanceToCurve(before, t, p);
      assert.ok(d < 1e-6 * size, `${dim}D ${target}×${cutter}: ${n} at ${k / 40} is ${d} off the ${target} it was`);
    }
    assert.ok(distanceToCurve(m, n, place) > 1e-3 * size, `${dim}D ${target}×${cutter}: the piece clicked is gone from ${n}`);
  }
  solved(m);
  replays(m);
}

/** How a test's title names each kind. */
const NOUN: Record<string, string> = {
  line: "a line", arc: "an arc", circle: "a circle", ellipse: "an ellipse", earc: "an elliptical arc",
  spline: "a spline", bspline: "a spline of control points",
};

for (const dim of [2, 3] as const) {
  for (const target of Object.keys(TARGETS)) {
    test(`${dim}D: ${NOUN[target]} trimmed by each kind — the piece goes, the rest is the curve it was, and it replays`, () => {
      for (const cutter of Object.keys(CUTTERS)) trimmedAgainst(dim, target, cutter);
    });
  }
}

// --- the elliptical arc ------------------------------------------------------------

test("an elliptical arc trimmed at an end keeps its name and its hold moves to the new end; out of the middle it leaves two held eqrad, and minor drives both", () => {
  const m = new Model(2);
  const c = m.addPoint([0, 0]).name;
  const el = addEllipse(m, c, m.addPoint([20, 0]).name, 10).name;
  seg(m, [-30, -4], [30, -4]); // the bottom cut off first
  trim(m, el, [0, -10]);
  const left = seg(m, [-8, -20], [-8, 20]), right = seg(m, [8, -20], [8, 20]);
  void left; void right;
  // The end piece, from the start (at the bottom right, y = −4) up to x = 8.
  const a0 = m.entities.get(el) as Extract<ReturnType<typeof m.entities.get>, { kind: "earc" }>;
  const end0 = a0.end;
  trim(m, el, [18, 3]);
  const a = m.entities.get(el) as typeof a0;
  assert.equal(a.kind, "earc");
  assert.ok(near(m.coords(a.start), [8, 10 * Math.sqrt(1 - 0.16)]), `starts at the cut at x = 8: ${m.coords(a.start)}`);
  assert.equal(a.end, end0, "the far end is the same point");
  const holds = (p: string, on: string) => [...m.relations.values()].filter((r) => r.op === "onEllipse" && r.args[0] === p && r.args[1] === on);
  assert.equal(holds(a.start, el).length, 1, "the new start held on it, once");
  // Out of the middle: the top between x = 0 and x = −8 goes.
  seg(m, [0, -20], [0, 20]);
  const out = trim(m, el, [-4, 10 * Math.sqrt(1 - 0.04)]);
  assert.equal(out.length, 2);
  const [, ea] = out;
  const b = m.entities.get(ea) as typeof a0;
  assert.equal(b.kind, "earc");
  assert.equal(b.center, a.center, "about the same centre");
  assert.equal(b.major, a.major, "and the same major end");
  assert.equal(holds(b.end, el).length, 0, "the far end held on the second piece, not twice");
  assert.equal(holds(b.end, ea).length, 1);
  assert.ok([...m.relations.values()].some((r) => r.op === "equalRadius" && r.args[0] === el && r.args[1] === ea), "eqrad");
  solved(m);
  // The minor dimensioned on the first piece: the second follows.
  minorAxis(m, el, 6);
  solved(m);
  close(semiAxes(m, ea).b, 6, 1e-9, "the second piece's minor");
  // Both pieces on one ellipse: the first's axes, its major and the minor of 6.
  const f0 = curveFrame(m, m.entities.get(el)!)!;
  const major = semiAxes(m, el).a;
  for (const n of [el, ea]) {
    const f = curveFrame(m, m.entities.get(n)!)!;
    for (let k = 0; k <= 8; k++) {
      const d = sub(arcPoint(f, (k / 8) * f.sweep), f0.center);
      const dot = (u: number[]) => d.reduce((acc, x, i) => acc + x * u[i], 0);
      close(Math.hypot(dot(f0.u) / major, dot(f0.v) / 6), 1, 1e-9, `${n} on el1's ellipse, minor 6`);
    }
  }
  replays(m);
});

test("an ellipse under an extrude that a trim would leave without its profile: refused, and the model — names and counters — exactly as it was", () => {
  const m = new Model(3);
  const el = addEllipse(m, m.addPoint([0, 0, 0]).name, m.addPoint([20, 0, 0]).name, 10).name;
  extrude(m, el, 5);
  // Two stubs, each crossing the rim once: the arc left would close on nothing.
  seg(m, [-25, -3], [-15, -3]);
  seg(m, [15, -3], [25, -3]);
  const was = save(m, false), entries = m.journal.length;
  assert.throws(() => trim(m, el, [0, -10, 0]), /trimming that piece of el1 leaves a feature nothing to stand on/);
  assert.equal(save(m, false), was, "nothing changed — the ellipse is an ellipse again");
  assert.equal(m.entities.get(el)!.kind, "ellipse");
  assert.equal(m.journal.length, entries, "nothing journalled");
});

test("an ellipse under an extrude trimmed by a chord: the solid regenerates onto the elliptical arc and the chord, one typed call", () => {
  const m = new Model(3);
  const el = addEllipse(m, m.addPoint([0, 0, 0]).name, m.addPoint([20, 0, 0]).name, 10).name;
  extrude(m, el, 5);
  const chord = seg(m, [-30, 4], [30, 4]);
  solved(m);
  const entries = m.journal.length;
  trim(m, el, [0, -10, 0]);
  assert.equal(m.journal[entries].op, "trim");
  assert.equal(m.entities.get(el)!.kind, "earc");
  const loop = m.featureOf("e1", "extrude").loops[0].map((x) => (typeof x === "string" ? x : x.name));
  assert.deepEqual([...loop].sort(), [chord, el].sort(), `the solid stands on the cap: ${loop}`);
  solved(m);
  replays(m);
});

// --- the spline --------------------------------------------------------------------

/** A spline through four points along y = 0, and its points. */
function wave(m: Model): { s: string; pts: string[] } {
  const pts = [[0, 0], [10, 6], [20, -6], [30, 0]].map((p) => m.addPoint(p).name);
  return { s: addSpline(m, pts), pts };
}

test("a spline trimmed at an end is a spline of control points under its own name, the same curve; a tan at the end kept holds, one at the end that went is removed and said", () => {
  const m = new Model(2);
  const { s, pts } = wave(m);
  const lead = m.addLine(m.addPoint([-10, -5]).name, pts[0]).name;
  const tail = m.addLine(pts[3], m.addPoint([40, 5]).name).name;
  const tStart = tangent(m, lead, s), tEnd = tangent(m, s, tail);
  solved(m);
  const cutter = circle([30, 0], 8);
  cutter(m, sheet(2));
  const before = open(save(m), 2);
  const notes: string[] = [];
  trim(m, s, [29, 0.5], undefined, undefined, notes); // the end inside the circle goes
  const e = m.entities.get(s)!;
  assert.equal(e.kind, "bspline", "a spline of control points, same name");
  const piece = e as Extract<typeof e, { kind: "bspline" }>;
  assert.equal(piece.points[0], pts[0], "it still starts at the spline's first point");
  assert.ok(Math.abs(Math.hypot(...m.coords(piece.points.at(-1)!).map((v, i) => v - [30, 0][i])) - 8) < 1e-9, "and ends on the circle");
  for (let k = 0; k <= 32; k++) assert.ok(distanceToCurve(before, s, pointOn(m, s, k / 32)) < 1e-7, `sample ${k} on the old spline`);
  assert.ok(m.relations.has(tStart), "the tan at the start it kept stays");
  assert.ok(!m.relations.has(tEnd), "the tan at the end that went is gone");
  assert.ok(notes.some((n) => n.startsWith(`${tEnd} (tan at sp1's end`)), `said: ${notes}`);
  assert.ok(!m.entities.has(pts[1]) && !m.entities.has(pts[2]), "the through-points nothing used went");
  solved(m);
  // The tangency at its start still holds when the lead line is turned.
  fix(m, m.line(lead).refs[0], [-10, -9]);
  solved(m);
  const [p0, p1] = piece.points.slice(0, 2).map((p) => m.coords(p));
  const [q0, q1] = m.line(lead).refs.map((p) => m.coords(p));
  const wedge = (a: number[], b: number[]) => (a[0] * b[1] - a[1] * b[0]) / (Math.hypot(...a) * Math.hypot(...b));
  assert.ok(Math.abs(wedge([p1[0] - p0[0], p1[1] - p0[1]], [q1[0] - q0[0], q1[1] - q0[1]])) < 1e-9, "still tangent");
  replays(m);
});

test("out of a spline's middle: two splines of control points, a used through-point held onspline on the piece it is on, an onspline re-made on its piece", () => {
  const m = new Model(2);
  const { s, pts } = wave(m);
  dist(m, pts[2], m.addPoint([20, -16]).name, 10); // something uses the third point
  const slider = m.addPoint([5, 4]).name;
  onSpline(m, slider, s);
  solved(m);
  seg(m, [12, -20], [12, 20]);
  seg(m, [16, -20], [16, 20]);
  const before = open(save(m), 2);
  const out = trim(m, s, [14, 0]);
  assert.equal(out.length, 2);
  const [, second] = out;
  assert.equal(m.entities.get(second)!.kind, "bspline");
  for (const n of out) for (let k = 0; k <= 24; k++) assert.ok(distanceToCurve(before, s, pointOn(m, n, k / 24)) < 1e-7, `${n} on the old spline`);
  assert.ok(!m.entities.has(pts[1]), "an unused through-point went");
  assert.ok(m.entities.has(pts[2]), "a used one stayed");
  assert.ok([...m.relations.values()].some((r) => r.op === "onSpline" && r.args[0] === pts[2] && r.args[1] === second), "held on the piece it is on");
  assert.ok([...m.relations.values()].some((r) => r.op === "onSpline" && r.args[0] === slider && r.args[1] === s), "the slider re-made on the first piece");
  solved(m);
  assert.ok(distanceToCurve(m, s, m.coords(slider)) < 1e-9, "and on it");
  replays(m);
});

test("a closed spline cut twice opens across its seam into one spline of control points: the same curve, its first point still on it", () => {
  const m = new Model(2);
  const pts = [[0, 10], [-10, 0], [0, -10], [10, 0]].map((p) => m.addPoint(p).name);
  const s = addSpline(m, pts, true);
  seg(m, [-20, 6], [20, 6]); // cuts the top off, across the seam at the first point
  solved(m);
  const before = open(save(m), 2);
  trim(m, s, [-12, -2]); // the big bottom piece... no: the piece the place is on — here the lower one goes
  const e = m.entities.get(s)!;
  assert.equal(e.kind, "bspline");
  for (let k = 0; k <= 40; k++) assert.ok(distanceToCurve(before, s, pointOn(m, s, k / 40)) < 1e-7, `sample ${k} on the old spline`);
  solved(m);
  replays(m);
  // And the other way: the top across the seam goes.
  const m2 = new Model(2);
  const q = [[0, 10], [-10, 0], [0, -10], [10, 0]].map((p) => m2.addPoint(p).name);
  const s2 = addSpline(m2, q, true);
  seg(m2, [-20, 6], [20, 6]);
  const before2 = open(save(m2), 2);
  trim(m2, s2, [0, 9]);
  const piece = m2.entities.get(s2) as Extract<ReturnType<typeof m2.entities.get>, { kind: "bspline" }>;
  assert.ok(!piece.points.includes(q[0]), "the seam's point went with the piece across it");
  for (let k = 0; k <= 40; k++) assert.ok(distanceToCurve(before2, s2, pointOn(m2, s2, k / 40)) < 1e-7, `sample ${k} on the old spline`);
  const m3 = new Model(2);
  const r = [[0, 10], [-10, 0], [0, -10], [10, 0]].map((p) => m3.addPoint(p).name);
  const s3 = addSpline(m3, r, true);
  seg(m3, [-20, -6], [20, -6]); // the bottom off: the piece kept runs across the seam
  const before3 = open(save(m3), 2);
  trim(m3, s3, [0, -9]);
  const kept = m3.entities.get(s3) as typeof piece;
  assert.ok(kept.points.includes(r[0]), "the seam's point is a control point of the piece across it — the curve passes through it");
  assert.ok(distanceToCurve(m3, s3, m3.coords(r[0])) < 1e-9);
  for (let k = 0; k <= 40; k++) assert.ok(distanceToCurve(before3, s3, pointOn(m3, s3, k / 40)) < 1e-7, `sample ${k} on the old spline`);
  solved(m3);
  replays(m3);
});

// --- power trim -------------------------------------------------------------------

test("a power-trim stroke across three pieces types one entry of three trims, and the three pieces go", async () => {
  // Three parallel lines crossed by one: a comb. The stroke runs down across the
  // three teeth's tops, above the spine.
  const m = new Model(2);
  const repl = new Repl(neocadScope({ model: m }));
  const ran: string[] = [];
  const pending: Promise<unknown>[] = [];
  const spine = seg(m, [0, 0], [40, 0]);
  const teeth = [10, 20, 30].map((x) => seg(m, [x, -10], [x, 10]));
  const ctx = {
    model: m, options: {}, requestRender() {}, requestSolve() {}, finish() {}, pick: () => null,
    run: (line: string) => { ran.push(line); const p = repl.eval(line).then((r) => assert.ok(r.ok, String(r.error?.message))); pending.push(p); return p; },
    log: () => {},
  } as unknown as ToolContext;
  const t = new TrimTool(ctx);
  const at = (x: number, y: number, sx: number) => ({ world: [x, y], screen: [sx, 100] as [number, number] });
  t.onDown(at(5, 5, 0));
  for (let x = 6; x <= 35; x += 3) t.onMove(at(x, 5, (x - 5) * 4));
  t.onUp(at(35, 5, 120));
  await Promise.all(pending);
  assert.equal(ran.length, 1, "one entry — one undo step");
  assert.equal((ran[0].match(/trim\(/g) ?? []).length, 3, ran[0]);
  for (const tooth of teeth) {
    const [a, b] = m.line(tooth).refs.map((p) => m.coords(p));
    assert.ok(Math.max(a[1], b[1]) < 1e-6, `${tooth}'s top is gone: ${a} ${b}`);
  }
  void spine;
});

test("a power-trim stroke across two pieces of one line types them from its far end back, so each name is the curve the piece is on", async () => {
  const m = new Model(2);
  const repl = new Repl(neocadScope({ model: m }));
  const ran: string[] = [];
  const pending: Promise<unknown>[] = [];
  const l = seg(m, [0, 0], [40, 0]);
  // Short teeth, so the stroke's run along y = −5 crosses none of them.
  [8, 16, 24, 32].map((x) => seg(m, [x, -3], [x, 3]));
  const ctx = {
    model: m, options: {}, requestRender() {}, requestSolve() {}, finish() {}, pick: () => null,
    run: (line: string) => { ran.push(line); const p = repl.eval(line).then((r) => assert.ok(r.ok, String(r.error?.message))); pending.push(p); return p; },
    log: () => {},
  } as unknown as ToolContext;
  const t = new TrimTool(ctx);
  // A zig-zag down across the piece 8–16 and up across the piece 24–32.
  const path: [number, number][] = [[12, 5], [12, -5], [20, -5], [28, -5], [28, 5]];
  t.onDown({ world: path[0], screen: [0, 0] });
  path.slice(1).forEach((p, k) => t.onMove({ world: p, screen: [10 * (k + 1), 10] }));
  t.onUp({ world: path.at(-1)!, screen: [50, 10] });
  await Promise.all(pending);
  assert.equal(ran.length, 1);
  const calls = [...ran[0].matchAll(/trim\("(\w+)", \[([^\]]*)\]\)/g)].map((x) => [x[1], Number(x[2].split(",")[0])]);
  assert.deepEqual(calls, [[l, 28], [l, 12]], "the far piece first, both on l1");
  // Three lines left of l1's: 0–8, 16–24, 32–40.
  const lines = [...m.entities.values()].filter((e) => e.kind === "line" && Math.abs(m.coords(e.refs[0])[1]) < 1e-9 && Math.abs(m.coords(e.refs[1])[1]) < 1e-9);
  const spans = lines.map((e) => (e as Extract<typeof e, { kind: "line" }>).refs.map((p) => Math.round(m.coords(p)[0])).sort((a, b) => a - b)).sort((a, b) => a[0] - b[0]);
  assert.deepEqual(spans, [[0, 8], [16, 24], [32, 40]]);
});

test("an elliptical arc extends round its ellipse to the next curve, its end held there and still on the ellipse", () => {
  const m = new Model(2);
  const el = earc([0, 0], 20, 10, 0, 30, 120)(m, sheet(2));
  const wall = seg(m, [-15, -20], [-15, 20]); // the ellipse meets x = −15 at y = ±10·√(1 − 0.5625)
  solved(m);
  const e = m.entities.get(el) as Extract<ReturnType<typeof m.entities.get>, { kind: "earc" }>;
  extend(m, el, e.end);
  solved(m);
  assert.ok(near(m.coords(e.end), [-15, 10 * Math.sqrt(1 - 0.5625)]), `reached the wall: ${m.coords(e.end)}`);
  assert.ok([...m.relations.values()].some((r) => r.op === "pointOnLine" && r.args[0] === e.end && r.args[1] === wall), "held on it");
  assert.throws(() => extend(m, addEllipse(m, m.addPoint([60, 0]).name, m.addPoint([70, 0]).name, 3).name, [70, 0]), /is an ellipse — it has no end to extend/);
  replays(m);
});
