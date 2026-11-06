// A spline and the tools built before it (docs/plans/spline.md, As built's
// table): what each sketch edit and the surface sweep does with one — works,
// works partly, or refuses with a message, every refusal tested here. And the
// context menu's own edits: a through-point added on the curve, one taken out.

import "../src/modules/builtin.ts";
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { ensureKernelLoaded } from "../src/kernel/problem.ts";
import { Model } from "../src/model.ts";
import { fix } from "../src/relations/basic.ts";
import { addSpline } from "../src/relations/spline.ts";
import { splineCurve, splineOf } from "../src/kinds/spline.ts";
import { domain, nearestParam, pointAt } from "../src/bspline.ts";
import { chamfer, circular, extend, linear, mirror, offset, trim } from "../src/sketchedit.ts";
import { addThrough, removeThrough } from "../src/splineedit.ts";
import { del, extrude, fillet } from "../src/operations.ts";
import { open, save } from "../src/persist.ts";
import { menuFor } from "../src/menu.ts";
import { programOf } from "../src/bodies.ts";
import { Evaluator } from "../src/solids/evaluate.ts";
import { neocadScope } from "../src/replenv.ts";
import { kernel, noKernel as skip } from "./solids/load.ts";
import { loadSolver } from "./solids/scene.ts";

async function loadKernel() {
  await ensureKernelLoaded(await readFile(new URL("../src/kernel/wasm-gen/neocad_kernel_bg.wasm", import.meta.url)));
}

const sub = (a: number[], b: number[]) => a.map((x, i) => x - b[i]);
const len = (a: number[]) => Math.hypot(...a);

function ok(m: Model) {
  const r = m.solve();
  assert.equal(r.solved, true, JSON.stringify(r.offenders));
}

/** How far `p` is from the spline. */
function off(m: Model, s: string, p: number[]): number {
  const c = splineCurve(m, s);
  return len(sub(pointAt(c, nearestParam(c, p, c.closed)), p));
}

/** A wavy open spline along x, its points fixed. */
function wave(m: Model): { s: string; pts: string[] } {
  const pts = [[0, 0], [10, 6], [22, -4], [34, 8], [45, 0]].map((p) => m.addPoint(m.dim === 3 ? [...p, 0] : p).name);
  for (const p of pts) fix(m, p, m.coords(p));
  return { s: addSpline(m, pts), pts };
}

test("trim and extend: a spline is refused as what is trimmed or extended, and cuts a line it crosses — the new end held on it", async () => {
  await loadKernel();
  const m = new Model(2);
  const { s } = wave(m);
  assert.throws(() => trim(m, s, [10, 6]), /"sp1" is a spline, and trim trims nothing of one yet.*A spline does cut a line/);
  assert.throws(() => extend(m, s, "p1"), /"sp1" is a spline, and extend does not lengthen one — drag its end out\. A spline does cut/);
  // A line across the spline: trimmed at the crossing, its end held onspline.
  const l = m.addLine(m.addPoint([20, -15]).name, m.addPoint([20, 15]).name).name;
  ok(m);
  trim(m, l, [20, 12]);
  const end = m.line(l).refs.find((p) => !["p6"].includes(p))!;
  const held = m.relationsNaming(end).find((r) => r.op === "onSpline");
  assert.ok(held, `the cut end ${end} is held on the spline: ${JSON.stringify(m.relationsNaming(end).map((r) => r.op))}`);
  ok(m);
  assert.ok(off(m, s, m.coords(end)) < 1e-9, "and is on it");
  // A line short of the spline, extended to it.
  const short = m.addLine(m.addPoint([30, -20]).name, m.addPoint([30, -10]).name).name;
  const far = m.line(short).refs[1];
  extend(m, short, far);
  ok(m);
  assert.ok(off(m, s, m.coords(far)) < 1e-9, "the end reached the spline");
  assert.ok(m.relationsNaming(far).some((r) => r.op === "onSpline"));
});

test("offset, bevel and fillet: a spline is refused by name, and so is an offset chain it is part of", async () => {
  await loadKernel();
  const m = new Model(2);
  const { s, pts } = wave(m);
  assert.throws(() => offset(m, s, 3), /"sp1" is a spline, and offset does not offset one yet/);
  const l = m.addLine(pts[4], m.addPoint([45, -20]).name).name;
  assert.throws(() => offset(m, [l, s], 3), /"sp1" is a spline, and offset/);
  assert.throws(() => chamfer(m, s, l, 2), /"sp1" is not a line/);
  assert.throws(() => fillet(m, s, l, 2), /"sp1" is not a line/);
});

test("mirror: a spline's copy is the spline through its points' mirrors, held by sym, following its original", async () => {
  await loadKernel();
  const m = new Model(2);
  const pts = [[0, 4], [10, 10], [22, 6], [34, 12]].map((p) => m.addPoint(p).name);
  const s = addSpline(m, pts);
  const axis = m.addLine(m.addPoint([0, 0]).name, m.addPoint([40, 0]).name).name;
  for (const p of m.line(axis).refs) fix(m, p, m.coords(p));
  const made = mirror(m, [s], axis);
  const copy = made.find((n) => m.entities.get(n)?.kind === "spline")!;
  assert.ok(copy, JSON.stringify(made));
  assert.equal(splineOf(m, copy).points.length, 4);
  ok(m);
  // The copy is the original reflected in y = 0, sample for sample.
  const [a, b] = [splineCurve(m, s), splineCurve(m, copy)];
  for (const f of [0, 0.2, 0.5, 0.77, 1]) {
    const pa = pointAt(a, domain(a)[0] + f * (domain(a)[1] - domain(a)[0]));
    const pb = pointAt(b, domain(b)[0] + f * (domain(b)[1] - domain(b)[0]));
    assert.ok(Math.abs(pa[0] - pb[0]) < 1e-9 && Math.abs(pa[1] + pb[1]) < 1e-9, JSON.stringify([pa, pb]));
  }
  // Drag an original point: the mirror follows.
  m.setCoords(pts[2], [22, 15]);
  ok(m);
  const q = splineOf(m, copy).points[2];
  assert.ok(Math.abs(m.coords(q)[0] - m.coords(pts[2])[0]) < 1e-9 && Math.abs(m.coords(q)[1] + m.coords(pts[2])[1]) < 1e-9);
});

test("linear and circular patterns: copies of a spline, each the spline through its points' copies", async () => {
  await loadKernel();
  const m = new Model(2);
  const pts = [[0, 0], [5, 4], [10, 0]].map((p) => m.addPoint(p).name);
  const s = addSpline(m, pts);
  fix(m, pts[0], [0, 0]);
  const made = linear(m, [s], 0, 12, 3);
  const copies = made.filter((n) => m.entities.get(n)?.kind === "spline");
  assert.deepEqual(copies, [`${s}_2`, `${s}_3`]);
  ok(m);
  for (const [k, c] of copies.entries()) {
    const want = splineCurve(m, s).ctrl.map((p) => [p[0], p[1] + 12 * (k + 1)]);
    splineCurve(m, c).ctrl.forEach((p, i) => assert.ok(len(sub(p, want[i])) < 1e-6, `${c} ${i}`));
  }
  const centre = m.addPoint([30, 0]).name;
  fix(m, centre, [30, 0]);
  const round = circular(m, [s], centre, Math.PI, 3).filter((n) => m.entities.get(n)?.kind === "spline");
  assert.equal(round.length, 2);
  ok(m);
  assert.equal(splineOf(m, round[1]).points.length, 3);
});

test("addThrough: a point on the curve where it was asked, the curve near where it was; removeThrough takes one out, and the point with it", async () => {
  await loadKernel();
  const m = new Model(2);
  const { s, pts } = wave(m);
  ok(m);
  const before = splineCurve(m, s);
  const p = addThrough(m, s, [16, 3]);
  assert.deepEqual(m.journal.at(-1)!.op, "addThrough");
  assert.equal(splineOf(m, s).points.length, 6);
  assert.equal(splineOf(m, s).points[2], p, "between the points either side of it");
  assert.ok(off(m, s, m.coords(p)) < 1e-9);
  ok(m);
  // Laid on the curve: the curve through it is near the one before, not the
  // same — an interpolating spline through one more point re-spaces its knots
  // and bends a little differently (measured: under 2 % of its length here,
  // written down in the spec) — and goes through every point exactly.
  for (const f of [0.1, 0.3, 0.6, 0.9]) {
    const [lo, hi] = domain(before);
    const q = pointAt(before, lo + f * (hi - lo));
    assert.ok(off(m, s, q) < 0.02 * 45, `${f}: ${off(m, s, q)}`);
  }
  // Its relations stay: one held on it keeps its name and its hold.
  const r = removeThrough(m, s, p);
  assert.deepEqual(r, [p], "the point went, nothing else using it");
  assert.equal(m.entities.has(p), false);
  assert.deepEqual(splineOf(m, s).points, pts);
  ok(m);
  // The refusals: an end, the fewest points, a feature on it, a point not its own.
  assert.throws(() => addThrough(m, s, [0, 0]), /that is "sp1"'s end/);
  const two = addSpline(m, [m.addPoint([0, 30]).name, m.addPoint([10, 30]).name]);
  assert.throws(() => removeThrough(m, two, splineOf(m, two).points[0]), /the fewest a/);
  assert.throws(() => removeThrough(m, s, "nope"), /is not one of "sp1"'s points/);
  // Saved and opened, the edits replay.
  const p2 = addThrough(m, s, [28, 2]);
  const back = open(save(m));
  assert.deepEqual(splineOf(back, s).points, splineOf(m, s).points);
  assert.ok(back.entities.has(p2));
  // Under a feature: refused, and the menu offers it disabled with the reason.
  // (A D, over its closing line — the wave would cross it and make three regions.)
  const m3 = new Model(3);
  const dp = [[0, 0, 0], [10, 6, 0], [22, 9, 0], [34, 8, 0], [45, 0, 0]].map((q) => m3.addPoint(q).name);
  const d = addSpline(m3, dp);
  m3.addLine(dp[4], dp[0]);
  extrude(m3, d, 5);
  assert.throws(() => addThrough(m3, d, [16, 7, 0]), /part of e1/);
  const menu = menuFor(m3, { name: d, kind: "spline", distance: 0 }, null, null, null, [], [16, 7, 0]);
  const add = menu.items.find((i) => i.label === "Add point here")!;
  assert.equal(add.action.do, "disabled");
});

test("the menu on a spline: Add point here where it was clicked, Remove point nearest; Remove from sp1 on a through-point", async () => {
  await loadKernel();
  const m = new Model(2);
  const { s, pts } = wave(m);
  const menu = menuFor(m, { name: s, kind: "spline", distance: 0 }, null, null, null, [], [21, -3.5]);
  const labels = menu.items.map((i) => i.label);
  assert.ok(labels.includes("Add point here") && labels.includes("Remove point p3"), JSON.stringify(labels));
  assert.deepEqual(menu.items.find((i) => i.label === "Add point here")!.action, { do: "run", command: 'addThrough("sp1", [21, -3.5])' });
  assert.ok(labels.includes("Construction"), "a spline can be construction");
  const onPoint = menuFor(m, { name: pts[1], kind: "point", distance: 0 });
  assert.deepEqual(onPoint.items.find((i) => i.label === "Remove from sp1")!.action, { do: "run", command: 'removeThrough("sp1", "p2")' });
  // Typed, the same calls.
  const scope = neocadScope({ model: m }) as Record<string, (...a: unknown[]) => unknown>;
  const p = scope.addThrough(s, [21, -3.5]) as string;
  assert.ok(splineOf(m, s).points.includes(p));
  assert.deepEqual(scope.removeThrough(s, p), [p]);
  // del of the spline leaves its points; construction makes it bound nothing.
  scope.construction(s);
  assert.equal(m.isConstruction(s), true);
  del(m, s);
  assert.ok(pts.every((q) => m.entities.has(q)));
});

test("a surface swept from a spline: the kernel's sheet, its area the curve's length by the depth", { skip }, async () => {
  await loadSolver();
  const m = new Model(3);
  const { s } = wave(m);
  const scope = neocadScope({ model: m }) as Record<string, (...a: unknown[]) => unknown>;
  assert.equal(scope.surface(s, 10), "s1");
  ok(m);
  const ev = new Evaluator(await kernel());
  const r = ev.run(programOf(m).program).bodies.find((b) => b.name === "s1")!;
  ev.clear();
  assert.deepEqual(r.failed, []);
  const area = r.solid!.faces.reduce((a, f) => a + f.area, 0);
  // The curve's length, by a fine walk.
  const c = splineCurve(m, s);
  const [lo, hi] = domain(c);
  let L = 0;
  for (let k = 0; k < 20000; k++) L += len(sub(pointAt(c, lo + ((hi - lo) * (k + 1)) / 20000), pointAt(c, lo + ((hi - lo) * k) / 20000)));
  assert.ok(Math.abs(area - 10 * L) < 1e-5 * 10 * L, `area ${area} against ${10 * L}`);
  // Trimming a surface by a spline is refused by name: the surface trim projects lines, arcs and circles.
  assert.throws(() => scope.trim("s1", s, [10, 0, 5]), /a surface is trimmed by a line, an arc or a circle — sp1 is a spline/);
});

test("a surface turned from a spline: the kernel's sheet, its area by Pappus — the turn by ∫ r ds", { skip }, async () => {
  await loadSolver();
  const m = new Model(3);
  const { s } = wave(m);
  // An axis along x, 20 below the wave: every point of it 10 or more off the axis.
  const axis = m.addLine(m.addPoint([0, -20, 0]).name, m.addPoint([45, -20, 0]).name).name;
  fix(m, lineEnds(m, axis)[0], [0, -20, 0]);
  fix(m, lineEnds(m, axis)[1], [45, -20, 0]);
  const scope = neocadScope({ model: m }) as Record<string, (...a: unknown[]) => unknown>;
  const name = scope.surface(s, axis) as string;
  ok(m);
  const ev = new Evaluator(await kernel());
  const r = ev.run(programOf(m).program).bodies.find((b) => b.name === name)!;
  ev.clear();
  assert.deepEqual(r.failed, []);
  const area = r.solid!.faces.reduce((a, f) => a + f.area, 0);
  const c = splineCurve(m, s);
  const [lo, hi] = domain(c);
  let moment = 0;
  for (let k = 0; k < 20000; k++) {
    const [p, q] = [pointAt(c, lo + ((hi - lo) * k) / 20000), pointAt(c, lo + ((hi - lo) * (k + 1)) / 20000)];
    moment += len(sub(q, p)) * ((p[1] + q[1]) / 2 + 20);
  }
  assert.ok(Math.abs(area - 2 * Math.PI * moment) < 1e-5 * area, `area ${area} against ${2 * Math.PI * moment}`);
});

/** A line's two points. */
function lineEnds(m: Model, line: string): [string, string] {
  const e = m.entities.get(line)!;
  if (e.kind !== "line") throw new Error("a line");
  return e.refs;
}
