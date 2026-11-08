// The spline (docs/plans/spline.md): a cubic B-spline through points you can
// drag — the entity and the interpolation it owns, `onspline`, `tan` at an
// end, the diagnosis, deletion, and the file. The owner: *"give me better
// sketch tools, relations, trim, slot... all the usual"*.

import { test } from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { ensureKernelLoaded } from "../src/kernel/problem.ts";
import { Dual } from "../src/kernel/dual.ts";
import { Model } from "../src/model.ts";
import { coincident, dist, fix, onPlane } from "../src/relations/basic.ts";
import { onCircle, tangent } from "../src/relations/geometry.ts";
import { addSpline, onSpline } from "../src/relations/spline.ts";
import { splineCurve, splineOf } from "../src/kinds/spline.ts";
import { MAX_TURN, derivs, domain, gapOf, interpolate, knotsOf, layout, numericGaps, pointAt, sampleParams } from "../src/bspline.ts";
import { open, save, VERSION } from "../src/persist.ts";
import { del } from "../src/operations.ts";
import { pullTo } from "../src/tools/engine.ts";
import { neocadScope } from "../src/replenv.ts";

async function loadKernel() {
  const bytes = await readFile(new URL("../src/kernel/wasm-gen/neocad_kernel_bg.wasm", import.meta.url));
  await ensureKernelLoaded(bytes);
}

function ok(m: Model) {
  const report = m.solve();
  assert.equal(report.solved, true, JSON.stringify(report.offenders));
  return report;
}

/** A drag as the engine does one: the point pulled weakly toward a cursor moving there over `frames` solves. */
function drag(m: Model, name: string, to: number[], frames = 30) {
  const from = m.coords(name);
  for (let k = 1; k <= frames; k++) {
    const at = from.map((x, i) => x + ((to[i] - x) * k) / frames);
    m.problem.solve({ extra: pullTo(m, name, at) });
  }
}

const sub = (a: number[], b: number[]) => a.map((x, i) => x - b[i]);
const len = (a: number[]) => Math.hypot(...a);
const dot = (a: number[], b: number[]) => a.reduce((s, x, i) => s + x * b[i], 0);

/** How far the curve misses each through-point at its own knot: the interpolation, measured. */
function miss(m: Model, name: string): number {
  const s = splineOf(m, name);
  const c = splineCurve(m, name);
  const L = layout(s.points.length, s.closed === true);
  const K = knotsOf(numericGaps(L, s.points.map((p) => m.coords(p))));
  return Math.max(...s.points.map((p, k) => len(sub(pointAt(c, K[3 + k]), m.coords(p)))));
}

/** The problem's blocks, reached into as the ellipse's tests do. */
type Blocks = { id: number; block: { varIndices: number[] | (() => number[]); fn: (l: Dual[]) => Dual[] } }[];
const blocksOf = (m: Model) => (m.problem as unknown as { blocks: Blocks }).blocks;

/** Each residual of the given blocks at the model's values: its value and its gradient's length. */
function gradientsOf(m: Model, handles: Set<number>): { value: number; grad: number }[] {
  const out: { value: number; grad: number }[] = [];
  for (const { id, block } of blocksOf(m)) {
    if (!handles.has(id)) continue;
    const vars = typeof block.varIndices === "function" ? block.varIndices() : block.varIndices;
    const locals = vars.map((v, slot) => Dual.variable(m.problem.getVar(v), slot));
    for (const r of block.fn(locals)) out.push({ value: r.val, grad: Math.hypot(...r.grad.values()) });
  }
  return out;
}

function wavy(m: Model): string[] {
  return [[0, 0], [10, 6], [22, -4], [34, 8], [45, 0]].map((p) => m.addPoint(p).name);
}

test("addSpline: an entity through its points, named sp1, journalled once, its own equations held on it", async () => {
  await loadKernel();
  const m = new Model(2);
  const pts = wavy(m);
  const before = blocksOf(m).length;
  const s = addSpline(m, pts);
  assert.equal(s, "sp1");
  const e = splineOf(m, s);
  assert.deepEqual(e.points, pts);
  assert.equal(e.closed, undefined);
  // n unknown control points for an open spline of n points, two coordinates each.
  assert.equal(e.ctrl.length, 2 * pts.length);
  assert.equal(e.blocks.length, pts.length, "one block per equation: n − 2 through-points and two natural ends");
  assert.equal(blocksOf(m).length - before, pts.length);
  assert.deepEqual(m.journal.at(-1), { op: "addSpline", args: [pts, null, "sp1"] });
  assert.equal(m.relations.size, 0, "the interpolation is the spline's own, no relation a person made");
  assert.deepEqual(m.refsOf(e), pts);
  // Seeded on the curve: interpolated before any solve.
  assert.ok(miss(m, s) < 1e-12, `${miss(m, s)}`);
  // The refusals, before anything is made.
  assert.throws(() => addSpline(m, [pts[0]]), /at least 2 points/);
  assert.throws(() => addSpline(m, pts.slice(0, 2), true), /at least 3 points/);
  assert.throws(() => addSpline(m, [pts[0], pts[0], pts[1]]), /twice in a row/);
  assert.throws(() => addSpline(m, [pts[0], pts[1], pts[0]]), /each point once/);
  assert.throws(() => addSpline(m, ["nope", pts[1]]), /nope/);
  const twin = m.addPoint([0, 0]).name;
  assert.throws(() => addSpline(m, [pts[0], twin, pts[2]]), /in one place/);
  assert.equal(m.entities.get("sp2"), undefined, "a refused spline claims no name");
});

test("interpolation holds after a drag of a through-point: the curve passes through every point within 1e-9, open and closed", async () => {
  await loadKernel();
  for (const closed of [false, true]) {
    const m = new Model(2);
    const pts = wavy(m);
    const s = addSpline(m, pts, closed);
    ok(m);
    drag(m, pts[2], [25, 14]);
    ok(m);
    assert.ok(len(sub(m.coords(pts[2]), [25, 14])) < 1e-3, "the dragged point went where it was dragged");
    assert.ok(miss(m, s) < 1e-9, `${closed ? "closed" : "open"}: ${miss(m, s)}`);
    const c = splineCurve(m, s);
    const [lo, hi] = domain(c);
    const [a, b] = [derivs(c, lo, 2), derivs(c, hi, 2)];
    if (closed) {
      // The seam is C²: the tangent and the curvature where it ends are where it starts.
      assert.ok(len(sub(a[1], b[1])) < 1e-7 && len(sub(a[2], b[2])) < 1e-7, JSON.stringify([a, b]));
      assert.ok(len(sub(a[0], b[0])) < 1e-12, "it closes on its first point");
    } else {
      assert.ok(len(a[2]) < 1e-7 && len(b[2]) < 1e-7, "natural ends: no curvature at either");
    }
  }
});

test("the spline's own equations: gradients at a root that do not vanish — none is a square", async () => {
  await loadKernel();
  for (const closed of [false, true]) {
    const m = new Model(2);
    const s = addSpline(m, wavy(m), closed);
    ok(m);
    const g = gradientsOf(m, new Set(splineOf(m, s).blocks));
    assert.equal(g.length, 2 * splineOf(m, s).blocks.length);
    for (const r of g) {
      assert.ok(Math.abs(r.value) < 1e-9, `at the root: ${r.value}`);
      assert.ok(r.grad > 0.05, `${closed ? "closed" : "open"}: a gradient at the root of ${r.grad}`);
    }
  }
});

test("the diagnosis: a spline's control points are held by its equations, its points are what is free", async () => {
  await loadKernel();
  const m = new Model(2);
  const pts = wavy(m);
  addSpline(m, pts);
  ok(m);
  assert.equal(m.diagnose().dof, 2 * pts.length, "every through-point free, no control point free");
  for (const p of pts) fix(m, p, m.coords(p));
  ok(m);
  const d = m.diagnose();
  assert.equal(d.dof, 0);
  assert.ok(!d.free.has("sp1"), "fixed points make a fixed curve");
  // A point on the curve: free along it, by its own parameter — one freedom.
  const q = m.addPoint([20, 3]).name;
  onSpline(m, q, "sp1");
  ok(m);
  assert.equal(m.diagnose().dof, 1);
  assert.ok(m.diagnose().free.has(q));
});

test("onspline: a point on the curve by a parameter of the relation's own; slides along it; gradient at the root", async () => {
  await loadKernel();
  const m = new Model(2);
  const pts = wavy(m);
  addSpline(m, pts);
  for (const p of pts) fix(m, p, m.coords(p));
  const q = m.addPoint([17, 6]).name;
  const r = onSpline(m, q, "sp1");
  assert.deepEqual(m.journal.at(-1), { op: "onSpline", args: [q, "sp1"] });
  assert.equal(m.relationOf(r).vars?.length, 1, "its parameter");
  ok(m);
  const c = splineCurve(m, "sp1");
  const sigma = m.problem.getVar(m.relationOf(r).vars![0]);
  const [lo, hi] = domain(c);
  assert.ok(len(sub(pointAt(c, lo + sigma * (hi - lo)), m.coords(q))) < 1e-9, "on the curve, at its parameter");
  const g = gradientsOf(m, new Set(m.relationOf(r).blocks));
  for (const x of g) assert.ok(Math.abs(x.value) < 1e-9 && x.grad > 0.5, JSON.stringify(x));
  // Dragged along, it stays on; the curve, fixed, does not move.
  drag(m, q, [30, 5]);
  ok(m);
  const s2 = m.problem.getVar(m.relationOf(r).vars![0]);
  assert.ok(s2 > sigma, "it slid along the curve");
  assert.ok(len(sub(pointAt(c, lo + s2 * (hi - lo)), m.coords(q))) < 1e-9);
  // Deleting the spline takes the relation, not the point.
  del(m, "sp1");
  assert.equal(m.relations.has(r), false);
  assert.ok(m.entities.has(q));
});

test("onspline in 3D on a tilted plane: the point is on the curve and so in its plane, three rows, no plane block", async () => {
  await loadKernel();
  const m = new Model(3);
  // A plane tipped about x and about y, through (2, 3, 4).
  const n = [Math.sin(0.4), -Math.sin(0.6) * Math.cos(0.4), Math.cos(0.6) * Math.cos(0.4)];
  const u = [Math.cos(0.4), Math.sin(0.4) * Math.sin(0.6), -Math.sin(0.4) * Math.cos(0.6)];
  const v = [0, Math.cos(0.6), Math.sin(0.6)];
  const o = [2, 3, 4];
  const at = (x: number, y: number) => o.map((c, i) => c + x * u[i] + y * v[i]);
  const pts = [[0, 0], [10, 6], [22, -4], [34, 8]].map(([x, y]) => m.addPoint(at(x, y)).name);
  addSpline(m, pts);
  for (const p of pts) fix(m, p, m.coords(p));
  const q = m.addPoint(at(15, 9).map((c, i) => c + 3 * n[i])).name; // off the plane, to begin with
  const r = onSpline(m, q, "sp1");
  assert.equal(m.relationOf(r).blocks.length, 1);
  assert.equal(gradientsOf(m, new Set(m.relationOf(r).blocks)).length, 3, "three rows in 3D");
  ok(m);
  assert.ok(Math.abs(dot(sub(m.coords(q), o), n)) < 1e-9, "in the curve's plane");
  const c = splineCurve(m, "sp1");
  const sigma = m.problem.getVar(m.relationOf(r).vars![0]);
  const [lo, hi] = domain(c);
  assert.ok(len(sub(pointAt(c, lo + sigma * (hi - lo)), m.coords(q))) < 1e-9);
  // The curve itself lies in the plane: its control points are its points' affine combinations.
  for (const P of c.ctrl) assert.ok(Math.abs(dot(sub(P, o), n)) < 1e-9);
  // And a spline in 3D drags with its interpolation held, its points held on the plane.
  const m2 = new Model(3);
  const p2 = [[0, 0], [10, 6], [22, -4], [34, 8]].map(([x, y]) => m2.addPoint(at(x, y)).name);
  const plane = [m2.addPoint(o).name, m2.addPoint(at(1, 0)).name, m2.addPoint(at(0, 1)).name];
  for (const p of plane) fix(m2, p, m2.coords(p));
  for (const p of p2) onPlane(m2, p, plane.join("."));
  addSpline(m2, p2);
  ok(m2);
  drag(m2, p2[1], at(12, 15));
  ok(m2);
  assert.ok(miss(m2, "sp1") < 1e-9);
  for (const P of splineCurve(m2, "sp1").ctrl) assert.ok(Math.abs(dot(sub(P, o), n)) < 1e-9);
});

test("tan at an end, from both sides: a line along the spline's start and along its end, either order", async () => {
  await loadKernel();
  for (const [which, typedFirst] of [["start", "line"], ["end", "spline"]] as const) {
    const m = new Model(2);
    const pts = wavy(m);
    addSpline(m, pts);
    // A line out of the end, sharing its point, at an angle to begin with.
    const end = which === "start" ? pts[0] : pts[pts.length - 1];
    // Some 20° off the end tangent, as a hand would leave it before the relation.
    const far = m.addPoint(which === "start" ? [-9, -5] : [52, -1]).name;
    const line = m.addLine(end, far).name;
    const r = typedFirst === "line" ? tangent(m, line, "sp1") : tangent(m, "sp1", line);
    assert.equal(m.relationOf(r).args[2], which, "the end it meets, journalled as read");
    for (const p of pts.slice(1, -1)) fix(m, p, m.coords(p));
    fix(m, far, m.coords(far));
    ok(m);
    const c = splineCurve(m, "sp1");
    const [lo, hi] = domain(c);
    const t = derivs(c, which === "start" ? lo : hi, 1)[1];
    const w = sub(m.coords(far), m.coords(end));
    assert.ok(Math.abs(t[0] * w[1] - t[1] * w[0]) / (len(t) * len(w)) < 1e-9, `the line runs along the end tangent: ${JSON.stringify([which, t, w])}`);
    for (const x of gradientsOf(m, new Set(m.relationOf(r).blocks))) assert.ok(Math.abs(x.value) < 1e-9 && x.grad > 1e-3, JSON.stringify(x));
  }
  // An end joined by a coin, not shared, is found the same; one that meets nothing is refused, naming both.
  const m = new Model(2);
  const pts = wavy(m);
  addSpline(m, pts);
  const a = m.addPoint([45, 0]).name;
  const l = m.addLine(a, m.addPoint([50, 5]).name).name;
  coincident(m, a, pts[4]);
  assert.equal(m.relationOf(tangent(m, l, "sp1")).args[2], "end");
  const stray = m.addLine(m.addPoint([5, 30]).name, m.addPoint([9, 31]).name).name;
  assert.throws(() => tangent(m, stray, "sp1"), /neither end of "sp1" meets/);
  const shut = addSpline(m, [[0, 40], [10, 50], [20, 40]].map((p) => m.addPoint(p).name), true);
  assert.throws(() => tangent(m, l, shut), /closed — it has none/);
});

test("tan(spline, arc) at a shared end: the end runs square to the radius; tan(spline, spline) end to end", async () => {
  await loadKernel();
  const m = new Model(2);
  const pts = wavy(m);
  addSpline(m, pts);
  const c = m.addPoint([45, -10]).name;
  const e = m.addPoint([55, -10]).name;
  const arc = m.addArc(c, pts[4], e, 10).name;
  const r = tangent(m, "sp1", arc);
  for (const p of pts.slice(0, 4)) fix(m, p, m.coords(p));
  fix(m, e, m.coords(e));
  ok(m);
  const curve = splineCurve(m, "sp1");
  const t = derivs(curve, domain(curve)[1], 1)[1];
  const radial = sub(m.coords(pts[4]), m.coords(c));
  assert.ok(Math.abs(dot(t, radial)) / (len(t) * len(radial)) < 1e-9, "square to the radius at the join");
  for (const x of gradientsOf(m, new Set(m.relationOf(r).blocks))) assert.ok(x.grad > 1e-3, JSON.stringify(x));
  // Two splines sharing an end, held smooth through it.
  // Leaving some 20° off the first one's end tangent, as a hand would.
  const more = [pts[4], m.addPoint([55, -4]).name, m.addPoint([65, -3]).name];
  const s2 = addSpline(m, more);
  del(m, r);
  const r2 = tangent(m, "sp1", s2);
  assert.deepEqual(m.relationOf(r2).args, ["sp1", s2, "end", "start"]);
  fix(m, more[2], m.coords(more[2]));
  fix(m, more[1], m.coords(more[1]));
  ok(m);
  const c2 = splineCurve(m, s2);
  const [ta, tb] = [derivs(splineCurve(m, "sp1"), domain(splineCurve(m, "sp1"))[1], 1)[1], derivs(c2, domain(c2)[0], 1)[1]];
  assert.ok(Math.abs(ta[0] * tb[1] - ta[1] * tb[0]) / (len(ta) * len(tb)) < 1e-9);
});

test("deleting a spline takes its own equations with it; deleting a through-point takes the spline", async () => {
  await loadKernel();
  const m = new Model(2);
  const pts = wavy(m);
  const base = blocksOf(m).length;
  addSpline(m, pts);
  del(m, "sp1");
  assert.equal(m.entities.has("sp1"), false);
  assert.equal(blocksOf(m).length, base, "no block left behind");
  addSpline(m, pts);
  dist(m, pts[0], pts[1], 12);
  const gone = del(m, pts[2]);
  assert.ok(gone.includes("sp2"), JSON.stringify(gone));
  assert.equal(blocksOf(m).length, base + 1, "only the dist's block is left");
});

test("save and open: the current version, the spline replayed with its equations, its control points and an onspline's parameter restored", async () => {
  await loadKernel();
  assert.equal(VERSION, 19);
  const m = new Model(2);
  const pts = wavy(m);
  addSpline(m, pts);
  const shut = addSpline(m, [[0, 30], [12, 40], [24, 31], [12, 22]].map((p) => m.addPoint(p).name), true);
  const q = m.addPoint([33, 7]).name;
  const r = onSpline(m, q, "sp1");
  ok(m);
  drag(m, pts[3], [36, 12]);
  ok(m);
  const text = save(m);
  const saved = JSON.parse(text);
  assert.equal(saved.version, 19);
  assert.equal(saved.values.splines.sp1.length, 2 * pts.length);
  assert.equal(saved.values.params[r].length, 1);
  const back = open(text);
  assert.deepEqual(splineOf(back, "sp1").points, pts);
  assert.equal(splineOf(back, shut).closed, true);
  assert.equal(splineOf(back, "sp1").blocks.length, pts.length, "its equations came back with it");
  const [a, b] = [splineCurve(m, "sp1"), splineCurve(back, "sp1")];
  for (let k = 0; k < a.ctrl.length; k++) assert.ok(len(sub(a.ctrl[k], b.ctrl[k])) < 1e-12);
  assert.equal(back.problem.getVar(back.relationOf(r).vars![0]), m.problem.getVar(m.relationOf(r).vars![0]));
  ok(back);
  assert.ok(len(sub(back.coords(q), m.coords(q))) < 1e-9, "the same solve");
  // A version-17 file (no spline in it) opens as it was.
  const old = new Model(2);
  old.addLine(old.addPoint([0, 0]).name, old.addPoint([3, 4]).name);
  const t17 = JSON.parse(save(old));
  t17.version = 17;
  assert.equal(open(JSON.stringify(t17)).entities.size, 3);
});

test("typed: spline(...) takes names or coordinates and { closed }; ls() and the hover line describe it", async () => {
  await loadKernel();
  const m = new Model(2);
  const scope = neocadScope({ model: m } as Parameters<typeof neocadScope>[0]) as Record<string, (...a: unknown[]) => unknown>;
  const p = m.addPoint([0, 0]).name;
  const s = scope.spline(p, [10, 5], [20, 0]) as string;
  assert.equal(s, "sp1");
  assert.equal(splineOf(m, s).points.length, 3);
  const c = scope.spline([0, 20], [10, 30], [20, 20], { closed: true }) as string;
  assert.equal(splineOf(m, c).closed, true);
  assert.throws(() => scope.spline(p, [1, 2, 3]), /a point is a name or 2 numbers/);
  assert.throws(() => scope.spline(p, [3, 3], { open: true }), /the options are \{ closed: true \}/);
  const listed = String(scope.ls());
  assert.match(listed, /sp1 {2}spline through p1, p2, p3/);
  assert.match(listed, /sp2 {2}spline through .*, closed/);
  // The knot gaps are the points' centripetal distances: |Δ|^½.
  assert.ok(Math.abs(gapOf([0, 0], [9, 12]) - Math.sqrt(15)) < 1e-12);
});

test("a spline is drawn within a quarter pixel of itself and no chord turning more than 2° from the next — the outline true, the wall unbanded", () => {
  // A tight wave: a trough where it bends hardest, the case that banded at 3× (looked at, docs/plans/spline.md).
  const c = interpolate([[-35, 0], [-12, 9], [4, -16], [13, 7], [35, 0]], false);
  for (const scale of [1, 4, 12, 36]) {
    const us = sampleParams(c, 0.25 / scale);
    for (let i = 0; i + 1 < us.length; i++) {
      const [a, b] = [derivs(c, us[i], 1)[1], derivs(c, us[i + 1], 1)[1]];
      const turn = Math.acos(Math.min(1, dot(a, b) / (len(a) * len(b))));
      assert.ok(turn <= MAX_TURN * (1 + 1e-9), `scale ${scale}: a chord turns ${(turn * 180 / Math.PI).toFixed(3)}°`);
      const [p, q] = [pointAt(c, us[i]), pointAt(c, us[i + 1])];
      for (const f of [0.25, 0.5, 0.75]) {
        const x = pointAt(c, us[i] + f * (us[i + 1] - us[i]));
        const off = Math.abs((q[0] - p[0]) * (x[1] - p[1]) - (q[1] - p[1]) * (x[0] - p[0])) / len(sub(q, p));
        assert.ok(off * scale <= 0.25, `scale ${scale}: ${off * scale} px off its chord`);
      }
    }
  }
});
