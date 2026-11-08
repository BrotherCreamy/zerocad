// The sketch-relations package (docs/plans/sketch-relations.md): the new
// relations, the free-variable and conflict analysis, the dimension and
// constrain tools' choices — headless.
//
// "Residual and gradient at a root" is asked of the rank analysis: after a
// solve each relation's residual is zero, and `diagnose` counts the freedoms
// it took away. A residual whose gradient vanished at its own root — a square —
// would take none, and the count would not move; so the count moving by the
// relation's own number of conditions is the gradient being there.

import { test } from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { ensureKernelLoaded, type ResidualBlock } from "../src/kernel/problem.ts";
import { Dual } from "../src/kernel/dual.ts";
import { Model } from "../src/model.ts";
import { coincident, dist, fix, midpoint, onPlane } from "../src/relations/basic.ts";
import {
  collinear, diameter, equalLength, equalSpacing, intersection, onCircle, parallel, perpendicular, pierce, radius, tangent,
  arcEndpoints,
} from "../src/relations/geometry.ts";
import { measure, measured } from "../src/relations/measure.ts";
import { open, save } from "../src/persist.ts";
import { set, del } from "../src/operations.ts";
import { Repl } from "../src/repl.ts";
import { neocadScope } from "../src/replenv.ts";
import { constraintsFor, dimensionFor, roundValue } from "../src/dimensioning.ts";
import { dimensionCommand, menuFor } from "../src/menu.ts";
import { placeGlyphs } from "../src/glyphs.ts";
import { DimensionTool } from "../src/tools/dimension.ts";
import { ConstrainTool } from "../src/tools/constrain.ts";
import type { ToolContext } from "../src/tools/tool.ts";
import type { Pick } from "../src/picking.ts";
import { tiltedFrame } from "./frames.ts";
import { diagnosisLine } from "../src/statusline.ts";

await (async () => {
  const bytes = await readFile(new URL("../src/kernel/wasm-gen/neocad_kernel_bg.wasm", import.meta.url));
  await ensureKernelLoaded(bytes);
})();

function solved(m: Model) {
  const r = m.solve();
  assert.equal(r.solved, true, JSON.stringify(r.offenders));
  assert.ok(r.maxResidual < 1e-6, `max residual ${r.maxResidual}`);
  return r;
}

const close = (a: number, b: number, tol = 1e-6, what = "") => assert.ok(Math.abs(a - b) < tol, `${what} ${a} vs ${b}`);

/** Distance from p to the infinite line through a, b. */
function off(p: number[], a: number[], b: number[]): number {
  const u = b.map((v, i) => v - a[i]), w = p.map((v, i) => v - a[i]);
  const t = w.reduce((s, v, i) => s + v * u[i], 0) / u.reduce((s, v) => s + v * v, 0);
  return Math.hypot(...w.map((v, i) => v - t * u[i]));
}

/** A weak pull of `point` toward `to` — what a drag adds for one solve and stores nowhere. */
function pull(m: Model, point: string, to: number[]): ResidualBlock {
  return { varIndices: m.point(point).varIndices, fn: (l: Dual[]) => l.map((x, i) => x.sub(to[i]).mul(0.3)) };
}

/** A 2D line with its two points. */
function line(m: Model, name: string, a: number[], b: number[]): string {
  m.addPoint(a, `${name}a`);
  m.addPoint(b, `${name}b`);
  return m.addLine(`${name}a`, `${name}b`, name).name;
}

// --- the relations ----------------------------------------------------------

test("collinear holds the second line on the first's, takes two freedoms in 2D, and follows a drag", () => {
  const m = new Model(2);
  line(m, "l1", [0, 0], [10, 0]);
  line(m, "l2", [15, 3], [25, 4]);
  const before = m.diagnose().dof;
  const r = collinear(m, "l1", "l2");
  assert.equal(r, "r1");
  solved(m);
  for (const p of ["l2a", "l2b"]) close(off(m.coords(p), m.coords("l1a"), m.coords("l1b")), 0, 1e-7, p);
  assert.equal(before - m.diagnose().dof, 2, "two conditions, two freedoms gone");
  // A drag of the first line's end: the second rides with it.
  m.problem.solve({ extra: [pull(m, "l1b", [10, 6])] });
  m.solve();
  for (const p of ["l2a", "l2b"]) close(off(m.coords(p), m.coords("l1a"), m.coords("l1b")), 0, 1e-6, p);
  assert.ok(Math.abs(m.coords("l1b")[1]) > 0.5, "the drag moved the line");
});

test("collinear is dimension-generic: on a tilted plane in 3D", () => {
  const m = new Model(3);
  const t = tiltedFrame(m);
  for (const [n, a, b] of [["l1", t.at(0, 0), t.at(10, 0)], ["l2", t.at(15, 2), t.at(25, 3)]] as const) {
    m.addPoint([...a], `${n}a`); m.addPoint([...b], `${n}b`); m.addLine(`${n}a`, `${n}b`, n);
  }
  collinear(m, "l1", "l2");
  solved(m);
  for (const p of ["l2a", "l2b"]) close(off(m.coords(p), m.coords("l1a"), m.coords("l1b")), 0, 1e-7, p);
});

test("collinear refuses one line twice", () => {
  const m = new Model(2);
  line(m, "l1", [0, 0], [10, 0]);
  assert.throws(() => collinear(m, "l1", "l1"), /twice is one/);
});

test("dist takes a point and a line, either way round, and two lines", () => {
  const m = new Model(2);
  line(m, "l1", [0, 0], [10, 0]);
  m.addPoint([3, 4], "p");
  const r = dist(m, "p", "l1", 7);
  assert.equal(r, "d1");
  solved(m);
  close(off(m.coords("p"), m.coords("l1a"), m.coords("l1b")), 7, 1e-7);
  line(m, "l3", [0, 9], [10, 11]);
  parallel(m, "l1", "l3");
  dist(m, "l1", "l3", 12);
  solved(m);
  const mid = m.coords("l3a").map((v, i) => (v + m.coords("l3b")[i]) / 2);
  close(off(mid, m.coords("l1a"), m.coords("l1b")), 12, 1e-7);
  dist(m, "l3", "p", 5);
  solved(m);
  close(off(m.coords("p"), m.coords("l3a"), m.coords("l3b")), 5, 1e-7);
});

test("dist to a line in 3D on a tilted plane", () => {
  const m = new Model(3);
  const t = tiltedFrame(m);
  m.addPoint(t.at(0, 0), "a"); m.addPoint(t.at(10, 0), "b"); m.addLine("a", "b", "l1");
  m.addPoint(t.at(3, 4), "p");
  onPlane(m, "p", t.name);
  dist(m, "p", "l1", 6);
  solved(m);
  close(off(m.coords("p"), m.coords("a"), m.coords("b")), 6, 1e-7);
});

test("horizontal and vertical journal the par they expand to, on a line and on two points", async () => {
  const m = new Model(2);
  line(m, "l1", [0, 0], [10, 2]);
  m.addPoint([0, 5], "p"); m.addPoint([4, 9], "q");
  const repl = new Repl(neocadScope({ model: m, arm: () => {}, view: { ox: 0, oy: 0, scale: 3 }, refresh: () => {} }));
  for (const src of ['horizontal("l1")', 'vertical("p", "q")']) {
    const r = await repl.eval(src);
    assert.equal(r.ok, true, r.error?.message ?? "");
  }
  const ops = m.journal.filter((e) => e.op === "parallel").map((e) => e.args);
  assert.deepEqual(ops, [["l1", "origin.x"], ["p", "q", "origin.y"]]);
  solved(m);
  close(m.coords("l1a")[1], m.coords("l1b")[1], 1e-7, "level");
  close(m.coords("p")[0], m.coords("q")[0], 1e-7, "upright");
  assert.equal((await repl.eval('horizontal("p")')).ok, false, "a point needs its partner");
  // The glyphs: — and |, not //.
  const marks = placeGlyphs(m, { ox: 0, oy: 0, scale: 3 }).map((g) => g.symbol);
  assert.ok(marks.includes("—") && marks.includes("|"), marks.join(" "));
});

test("eq between two circles is an equal radius; between a line and an arc, equal length", () => {
  const m = new Model(2);
  m.addPoint([0, 0], "c0"); m.addCircle("c0", 5, null, "c1");
  m.addPoint([20, 0], "c2c"); m.addCircle("c2c", 8, null, "c2");
  radius(m, "c1", 5);
  const r = equalLength(m, "c1", "c2");
  solved(m);
  close(m.radius("c2"), 5, 1e-7);
  assert.equal(m.relations.get(r)!.op, "equalLength");
  // A quarter arc of radius 10: length 5π.
  m.addPoint([0, 30], "ac"); m.addPoint([10, 30], "as"); m.addPoint([0, 40], "ae");
  m.addArc("ac", "as", "ae", 10, null, "a1");
  arcEndpoints(m, "a1");
  fix(m, "ac", [0, 30]); fix(m, "as", [10, 30]); fix(m, "ae", [0, 40]);
  line(m, "l1", [30, 30], [40, 30]);
  fix(m, "l1a", [30, 30]);
  parallel(m, "l1", "origin.x");
  equalLength(m, "l1", "a1");
  solved(m);
  close(m.coords("l1b")[0] - 30, 5 * Math.PI, 1e-6, "line as long as the arc");
});

test("eq between a line and an arc in 3D, on a tilted plane", () => {
  const m = new Model(3);
  const t = tiltedFrame(m);
  m.addPoint(t.at(0, 0), "ac"); m.addPoint(t.at(10, 0), "as"); m.addPoint(t.at(0, 10), "ae");
  m.addArc("ac", "as", "ae", 10, t.name, "a1");
  arcEndpoints(m, "a1");
  for (const [p, u, v] of [["ac", 0, 0], ["as", 10, 0], ["ae", 0, 10]] as const) fix(m, p, [u, v, 0]);
  parallel(m, "a1", `${t.name}.z`);
  m.addPoint(t.at(20, 0), "la"); m.addPoint(t.at(30, 0), "lb"); m.addLine("la", "lb", "l1");
  fix(m, "la", [20, 0, 0]);
  parallel(m, "l1", `${t.name}.x`);
  equalLength(m, "l1", "a1");
  solved(m);
  close(Math.hypot(...m.coords("lb").map((v, i) => v - m.coords("la")[i])), 5 * Math.PI, 1e-6);
});

test("mid(p, arc) puts the point halfway round the arc, and follows the arc", () => {
  const m = new Model(2);
  m.addPoint([0, 0], "c"); m.addPoint([10, 0], "s"); m.addPoint([0, 10], "e");
  m.addArc("c", "s", "e", 10, null, "a1");
  arcEndpoints(m, "a1");
  fix(m, "c", [0, 0]); fix(m, "s", [10, 0]);
  const held = fix(m, "e", [0, 10]);
  m.addPoint([6, 8], "m");
  const r = midpoint(m, "m", "a1");
  assert.deepEqual(m.relations.get(r)!.args, ["m", "a1"]);
  solved(m);
  close(m.coords("m")[0], 10 * Math.SQRT1_2, 1e-6); close(m.coords("m")[1], 10 * Math.SQRT1_2, 1e-6);
  m.deleteRelation(held);
  m.problem.solve({ extra: [pull(m, "e", [-10, 0])] });
  m.solve();
  const [s, e, p] = ["s", "e", "m"].map((n) => m.coords(n));
  close(Math.hypot(p[0] - s[0], p[1] - s[1]), Math.hypot(p[0] - e[0], p[1] - e[1]), 1e-6, "equal chords");
  close(Math.hypot(...p), m.radius("a1"), 1e-6, "on the rim");
});

test("mid(p, arc) in 3D on a tilted plane", () => {
  const m = new Model(3);
  const t = tiltedFrame(m);
  m.addPoint(t.at(0, 0), "c"); m.addPoint(t.at(10, 0), "s"); m.addPoint(t.at(0, 10), "e");
  m.addArc("c", "s", "e", 10, t.name, "a1");
  arcEndpoints(m, "a1");
  for (const [p, u, v] of [["c", 0, 0], ["s", 10, 0], ["e", 0, 10]] as const) fix(m, p, [u, v, 0]);
  parallel(m, "a1", `${t.name}.z`);
  m.addPoint(t.at(6, 8, 2), "m");
  midpoint(m, "m", "a1");
  solved(m);
  const want = t.at(10 * Math.SQRT1_2, 10 * Math.SQRT1_2);
  m.coords("m").forEach((v, i) => close(v, want[i], 1e-6, `axis ${i}`));
});

test("tan(arc, line) and tan(arc, arc) at a shared end: a smooth join, typed either way round", () => {
  const m = new Model(2);
  line(m, "l1", [0, 0], [10, 0]);
  fix(m, "l1a", [0, 0]); fix(m, "l1b", [10, 0]);
  m.addPoint([10, 5], "c"); m.addPoint([15, 6], "e");
  m.addArc("c", "l1b", "e", 5, null, "a1");
  arcEndpoints(m, "a1");
  tangent(m, "a1", "l1");
  m.addPoint([20, 0], "c2"); m.addPoint([25, 2], "e2");
  m.addArc("c2", "e", "e2", 5, null, "a2");
  arcEndpoints(m, "a2");
  tangent(m, "a1", "a2");
  solved(m);
  // At the join the arc's radius is square to the line: a smooth leave.
  const [c, b] = [m.coords("c"), m.coords("l1b")];
  close((c[0] - b[0]) * 10, 0, 1e-6, "radius ⟂ line");
  // And the two arcs' centres and their shared end are in a line.
  close(off(m.coords("e"), m.coords("c"), m.coords("c2")), 0, 1e-6, "centres and join collinear");
});

test("tan(arc, line) at a shared end in 3D on a tilted plane", () => {
  const m = new Model(3);
  const t = tiltedFrame(m);
  m.addPoint(t.at(0, 0), "a"); m.addPoint(t.at(10, 0), "b"); m.addLine("a", "b", "l1");
  fix(m, "a", [0, 0, 0]); fix(m, "b", [10, 0, 0]);
  m.addPoint(t.at(10, 5), "c"); m.addPoint(t.at(15, 5), "e");
  m.addArc("c", "b", "e", 5, t.name, "a1");
  arcEndpoints(m, "a1");
  onPlane(m, "c", t.name); onPlane(m, "e", t.name);
  tangent(m, "a1", "l1");
  solved(m);
  const u = m.coords("b").map((v, i) => v - m.coords("a")[i]);
  const w = m.coords("c").map((v, i) => v - m.coords("b")[i]);
  close(u.reduce((s, v, i) => s + v * w[i], 0), 0, 1e-5, "radius ⟂ line");
});

test("pierce: a point where a line crosses the tilted sketch plane, following a drag; refused in 2D", () => {
  const m = new Model(3);
  const t = tiltedFrame(m);
  m.addPoint(t.at(0, 0, -5), "a"); m.addPoint(t.at(2, 1, 5), "b"); m.addLine("a", "b", "l1");
  const fa = fix(m, "a", [0, 0, -5]); const fb = fix(m, "b", [2, 1, 5]);
  m.addPoint(t.at(3, 3, 0), "p");
  const r = pierce(m, "p", "l1");
  assert.deepEqual(m.relations.get(r)!.args, ["p", "l1", t.name]);
  solved(m);
  const want = t.at(1, 0.5, 0);
  m.coords("p").forEach((v, i) => close(v, want[i], 1e-6, `axis ${i}`));
  m.deleteRelation(fb); void fa;
  m.problem.solve({ extra: [pull(m, "b", t.at(4, 1, 5))] });
  m.solve();
  close(off(m.coords("p"), m.coords("a"), m.coords("b")), 0, 1e-6, "on the line");
  const w = m.coords("p").map((v, i) => v - t.origin[i]).reduce((s, v, i) => s + v * t.uz[i], 0);
  close(w, 0, 1e-6, "on the plane");
  assert.throws(() => pierce(new Model(2), "p", "l1"), /3D/);
});

test("intersection holds a point on two curves, and follows a drag", () => {
  const m = new Model(2);
  line(m, "l1", [-20, 1], [20, 1]);
  m.addPoint([0, 0], "c0"); m.addCircle("c0", 10, null, "c1");
  fix(m, "c0", [0, 0]); radius(m, "c1", 10);
  m.addPoint([9, 2], "p");
  const r = intersection(m, "p", "l1", "c1");
  assert.equal(m.relations.get(r)!.blocks.length, 2, "on the line, on the rim");
  solved(m);
  close(off(m.coords("p"), m.coords("l1a"), m.coords("l1b")), 0, 1e-7);
  close(Math.hypot(...m.coords("p")), 10, 1e-7);
  m.problem.solve({ extra: [pull(m, "l1b", [20, 6])] });
  m.solve();
  close(off(m.coords("p"), m.coords("l1a"), m.coords("l1b")), 0, 1e-6);
  close(Math.hypot(...m.coords("p")), 10, 1e-6);
  assert.throws(() => intersection(m, "p", "l1", "l1"), /twice/);
});

test("intersection of two lines in 3D", () => {
  const m = new Model(3);
  const t = tiltedFrame(m);
  m.addPoint(t.at(-5, 0), "a"); m.addPoint(t.at(5, 0), "b"); m.addLine("a", "b", "l1");
  m.addPoint(t.at(0, -5), "c"); m.addPoint(t.at(0, 5), "d"); m.addLine("c", "d", "l2");
  for (const [p, u, v] of [["a", -5, 0], ["b", 5, 0], ["c", 0, -5], ["d", 0, 5]] as const) fix(m, p, [u, v, 0]);
  m.addPoint(t.at(1, 1, 1), "p");
  intersection(m, "p", "l1", "l2");
  solved(m);
  m.coords("p").forEach((v, i) => close(v, t.origin[i], 1e-6));
});

test("equalSpacing makes every gap the first, in 2D and 3D", () => {
  for (const dim of [2, 3]) {
    const m = new Model(dim);
    const pts = [[0, 0], [3, 0], [8, 1], [9, 5]].map((p, i) => m.addPoint(dim === 3 ? [...p, i] : p, `q${i}`).name);
    fix(m, "q0", dim === 3 ? [0, 0, 0] : [0, 0]);
    equalSpacing(m, ...pts);
    solved(m);
    const gap = (i: number) => Math.hypot(...m.coords(pts[i + 1]).map((v, k) => v - m.coords(pts[i])[k]));
    close(gap(1), gap(0), 1e-7); close(gap(2), gap(0), 1e-7);
  }
  assert.throws(() => equalSpacing(new Model(2), "a", "b"), /three/);
});

test("diameter is a d-named dimension that set edits", () => {
  const m = new Model(2);
  m.addPoint([0, 0], "c0"); m.addCircle("c0", 5, null, "c1");
  const d = diameter(m, "c1", 24);
  assert.equal(d, "d1");
  solved(m);
  close(m.radius("c1"), 12, 1e-9);
  set(m, "d1.value", 30);
  solved(m);
  close(m.radius("c1"), 15, 1e-9);
  assert.equal(placeGlyphs(m, { ox: 0, oy: 0, scale: 3 })[0].symbol, "⌀30");
});

test("measure is a driven dimension: d-named, no blocks, live, unsettable, deleted with what it measures", () => {
  const m = new Model(2);
  line(m, "l1", [0, 0], [10, 0]);
  const blocks = m.problem.blockCount;
  const d = measure(m, "dist", "l1a", "l1b");
  assert.equal(d, "d1");
  assert.equal(m.problem.blockCount, blocks, "it adds nothing to the problem");
  assert.equal(m.relations.get(d)!.blocks.length, 0);
  const view = { ox: 0, oy: 0, scale: 3 };
  assert.equal(placeGlyphs(m, view).find((g) => g.relation === d)!.symbol, "(10)");
  m.setCoords("l1b", [20, 0]);
  assert.equal(placeGlyphs(m, view).find((g) => g.relation === d)!.symbol, "(20)", "live");
  assert.throws(() => set(m, "d1.value", 3), /not a dimension/);
  assert.throws(() => measure(m, "volume", "l1"), /what to measure/);
  assert.throws(() => measure(m, "radius", "l1"), /not a circle|is not/);
  m.addPoint([0, 0], "c0"); m.addCircle("c0", 4, null, "c1");
  measure(m, "diameter", "c1");
  close(measured(m, ["diameter", "c1"]), 8, 1e-12);
  del(m, "l1b");
  assert.equal(m.relations.has(d), false, "gone with its point");
});

test("every new relation replays from a saved file, names and all", () => {
  const m = new Model(3);
  const t = tiltedFrame(m);
  m.addPoint(t.at(0, 0), "a"); m.addPoint(t.at(10, 0), "b"); m.addLine("a", "b", "l1");
  m.addPoint(t.at(15, 1), "c"); m.addPoint(t.at(25, 2), "d"); m.addLine("c", "d", "l2");
  m.addPoint(t.at(0, -5, -5), "e"); m.addPoint(t.at(1, 5, 5), "f"); m.addLine("e", "f", "l3");
  m.addPoint(t.at(0, 0), "cc"); m.addCircle("cc", 4, t.name, "c1");
  m.addPoint(t.at(3, 3), "p1"); m.addPoint(t.at(1, 1), "p2"); m.addPoint(t.at(4, 0), "p3");
  collinear(m, "l1", "l2");
  pierce(m, "p1", "l3");
  intersection(m, "p2", "l1", "c1");
  equalSpacing(m, "a", "p3", "b");
  diameter(m, "c1", 9);
  measure(m, "angle", "l1", "l3");
  dist(m, "p1", "l1", 3);
  equalLength(m, "l1", "l2");
  m.solve();
  const text = save(m);
  const back = open(text, 3);
  assert.equal(save(back), text, "byte-identical round trip");
  assert.deepEqual([...back.relations.keys()], [...m.relations.keys()]);
  const ops = [...back.relations.values()].map((r) => r.op);
  for (const op of ["collinear", "pierce", "intersection", "equalSpacing", "diameter", "measure", "dist", "equalLength"]) {
    assert.ok(ops.includes(op), `${op} replayed`);
  }
});

// --- diagnosis --------------------------------------------------------------

/** A 2D rectangle drawn as the tool draws one: four lines on four corners, level and upright edges. */
function rectangle(m: Model, w = 40, h = 25): void {
  const corners = [[0, 0], [w, 0], [w, h], [0, h]];
  corners.forEach((c, i) => m.addPoint(c, `k${i}`));
  for (let i = 0; i < 4; i++) m.addLine(`k${i}`, `k${(i + 1) % 4}`, `e${i}`);
  parallel(m, "e0", "origin.x"); parallel(m, "e2", "origin.x");
  parallel(m, "e1", "origin.y"); parallel(m, "e3", "origin.y");
}

test("freeVars on a rectangle: which variables and which entities, then none once dimensioned", () => {
  const m = new Model(2);
  rectangle(m);
  solved(m);
  let d = m.diagnose();
  assert.equal(d.dof, 4, "a level rectangle: where it is (2) and its two sides (2)");
  assert.deepEqual([...d.free].sort(), ["e0", "e1", "e2", "e3", "k0", "k1", "k2", "k3"]);
  fix(m, "k0", [0, 0]);
  d = m.diagnose();
  assert.equal(d.dof, 2, "pinned: its width and height");
  assert.deepEqual([...d.free].sort(), ["e0", "e1", "e2", "e3", "k1", "k2", "k3"], "the pinned corner is held, the rest not");
  // The free *variables*: k1's x, k2's x and y, k3's y — and not k1's y or k3's x.
  const freeVars = new Set(m.problem.analyse({ vars: [0, 1, 2, 3, 4, 5, 6, 7] }).free);
  assert.deepEqual([...freeVars].sort((a, b) => a - b), [2, 4, 5, 7]);
  dist(m, "k0", "k1", 40);
  d = m.diagnose();
  assert.equal(d.dof, 1);
  assert.deepEqual([...d.free].sort(), ["e1", "e2", "e3", "k2", "k3"], "the bottom edge is held once its length is");
  dist(m, "k1", "k2", 25);
  solved(m);
  d = m.diagnose();
  assert.equal(d.dof, 0);
  assert.equal(d.free.size, 0);
  assert.deepEqual(d.redundant, []);
});

test("a deleted entity's orphaned variables are no freedom", () => {
  const m = new Model(2);
  m.addPoint([0, 0], "p");
  fix(m, "p", [0, 0]);
  m.addPoint([5, 5], "q");
  assert.equal(m.diagnose().dof, 2);
  del(m, "q");
  assert.equal(m.diagnose().dof, 0);
});

test("3D: a sketch on the ground is not free off it, a circle's normal length is no freedom", () => {
  const m = new Model(3);
  m.addPoint([0, 0, 0], "a"); m.addPoint([10, 0, 0], "b"); m.addLine("a", "b", "l1");
  fix(m, "a", [0, 0, 0]);
  parallel(m, "l1", "origin.x");
  dist(m, "a", "b", 10);
  solved(m);
  assert.equal(m.diagnose().dof, 0, "z is the ground's, not a freedom");
  m.addPoint([0, 0, 0], "cc"); m.addCircle("cc", 5, null, "c1");
  coincident(m, "cc", "a");
  radius(m, "c1", 5);
  parallel(m, "c1", "origin.z");
  solved(m);
  const d = m.diagnose();
  assert.equal(d.dof, 0, `held: ${[...d.free].join(" ")}`);
  // Off the ground and held by nothing, a point is free in all three.
  m.addPoint([0, 0, 7], "air");
  assert.equal(m.diagnose().dof, 3);
});

test("a conflict names exactly the relations that disagree: two distances on one line", () => {
  const m = new Model(2);
  rectangle(m);
  fix(m, "k0", [0, 0]);
  dist(m, "k1", "k2", 25);
  const a = dist(m, "k0", "k1", 40);
  const b = dist(m, "k0", "k1", 60);
  const report = m.solve();
  assert.equal(report.solved, false);
  const c = m.conflicting(report);
  assert.deepEqual(c.relations.sort(), [a, b].sort());
  assert.deepEqual(c.unowned, []);
});

test("a block no relation owns is named by its label", () => {
  const m = new Model(2);
  const p = m.addPoint([0, 0], "p");
  m.problem.addResidual(p.varIndices, (l) => [l[0].sub(1)], "mine");
  m.problem.addResidual(p.varIndices, (l) => [l[0].sub(3)], "yours");
  const c = m.conflicting(m.solve());
  assert.deepEqual(c.relations, []);
  assert.deepEqual(c.unowned.sort(), ["mine", "yours"]);
});

test("a redundant eq is reported, and the drawing still solves", () => {
  const m = new Model(2);
  rectangle(m);
  fix(m, "k0", [0, 0]);
  dist(m, "k0", "k1", 40);
  dist(m, "k1", "k2", 25);
  const r = equalLength(m, "e0", "e2");
  const report = m.solve();
  assert.equal(report.solved, true, "consistent: never a failure");
  const d = m.diagnose();
  assert.deepEqual(d.redundant, [r], "the later way of saying it is the one named");
  assert.equal(d.dof, 0);
});

test("the shipped tools' structural rows are not reported redundant: a 3D arc on its plane, made in the arc tool's order", () => {
  const m = new Model(3);
  const t = tiltedFrame(m);
  m.addPoint(t.at(0, 0), "c"); m.addPoint(t.at(10, 0), "s"); m.addPoint(t.at(0, 10), "e");
  for (const p of ["s", "e"]) onPlane(m, p, t.name);
  m.addArc("c", "s", "e", 10, t.name, "a1");
  onPlane(m, "c", t.name);
  parallel(m, "a1", `${t.name}.z`);
  arcEndpoints(m, "a1");
  solved(m);
  assert.deepEqual(m.diagnose().redundant, []);
});

test("perpendicular twice is redundant, not a conflict", () => {
  const m = new Model(2);
  line(m, "l1", [0, 0], [10, 0]);
  line(m, "l2", [0, 0], [1, 10]);
  perpendicular(m, "l1", "l2");
  const again = perpendicular(m, "l2", "l1");
  assert.equal(m.solve().solved, true);
  assert.deepEqual(m.diagnose().redundant, [again]);
});

// --- the dimension and constrain tools' choices -------------------------------

test("the dimension tool's rounding is the menu's", () => {
  const m = new Model(2);
  line(m, "l1", [0, 0], [10.12345, 3.98765]);
  m.addPoint([0, 0], "c0"); m.addCircle("c0", 7.77777, null, "c1");
  const pick = (name: string, kind: "line" | "circle"): Pick => ({ name, kind, distance: 0 });
  assert.equal(dimensionFor(m, ["l1"])!.text, dimensionCommand(m, pick("l1", "line")));
  assert.equal(dimensionFor(m, ["c1"])!.text, dimensionCommand(m, pick("c1", "circle")));
  // A whole circle's diameter, SolidWorks' default (docs/plans/smart-dimension.md).
  assert.equal(dimensionFor(m, ["c1"])!.text, `dia("c1", ${roundValue(2 * 7.77777)})`);
});

test("what the dimension tool types for each pick", () => {
  const m = new Model(2);
  line(m, "l1", [0, 0], [10, 0]);
  line(m, "l2", [0, 0], [10, 10]);
  line(m, "l3", [0, 5], [10, 5]);
  m.addPoint([3, 7], "p");
  m.addPoint([0, 0], "c0"); m.addCircle("c0", 4, null, "c1");
  const t = (names: string[], o = {}) => dimensionFor(m, names, o)?.text ?? null;
  assert.equal(t(["l1"]), 'dist("l1a", "l1b", 10)');
  assert.equal(t(["p", "l1a"]), 'dist("p", "l1a", 7.616)');
  assert.equal(t(["p", "l1"]), 'dist("p", "l1", 7)');
  assert.equal(t(["l1", "l2"]), 'ang("l1", "l2", deg(45))');
  assert.equal(t(["l1", "l3"]), 'dist("l1", "l3", 5)', "parallel lines: the distance between");
  // A whole circle's diameter by default, SolidWorks' (docs/plans/smart-dimension.md); its radius asked for.
  assert.equal(t(["c1"]), 'dia("c1", 8)');
  assert.equal(t(["c1"], { radial: "radius" }), 'rad("c1", 4)');
  assert.equal(t(["c1"], { diameter: true }), 'dia("c1", 8)');
  assert.equal(t(["l1"], { driven: true }), 'measure("dist", "l1a", "l1b")');
  assert.equal(t(["l1", "l2"], { driven: true }), 'measure("angle", "l1", "l2")');
  // A circle and a point: the distance to its centre (smart-dimension.md's table).
  assert.equal(t(["c1", "p"]), 'dist("c0", "p", 7.616)');
  // And each one applies as the call it types.
  const made = dimensionFor(m, ["l1", "l2"])!.apply(m);
  close(m.relations.get(made)!.args[2] as number, Math.PI / 4, 1e-12);
});

test("constraintsFor lists what each selection takes", () => {
  const m = new Model(2);
  line(m, "l1", [0, 0], [10, 0]);
  line(m, "l2", [0, 3], [10, 5]);
  m.addPoint([3, 7], "p");
  m.addPoint([0, 0], "c0"); m.addCircle("c0", 4, null, "c1");
  m.addPoint([20, 0], "c2c"); m.addCircle("c2c", 3, null, "c2");
  const labels = (names: string[]) => constraintsFor(m, names).map((a) => a.label);
  assert.deepEqual(labels(["l1", "l2"]), ["Parallel", "Perpendicular", "Equal", "Collinear", "Angle"]);
  assert.deepEqual(labels(["p", "l1"]), ["On", "Midpoint", "Distance"]);
  assert.deepEqual(labels(["c1", "c2"]), ["Concentric", "Equal", "Tangent", "Centre distance"]);
  assert.deepEqual(labels(["l1"]), ["Horizontal", "Vertical", "Length"]);
  assert.deepEqual(labels(["p", "l1a"]), ["Coincident", "Horizontal", "Vertical", "Distance"]);
  assert.deepEqual(constraintsFor(m, ["l1", "l2"])[0].text, 'par("l1", "l2")');
  // The menu on a two-line selection carries the same list, under a heading.
  const menu = menuFor(m, { name: "l1", kind: "line", distance: 0 }, null, null, null, ["l1", "l2"]);
  const at = menu.items.findIndex((i) => i.label === "Constrain");
  assert.ok(at > 0, "a Constrain heading");
  assert.deepEqual(menu.items.slice(at + 1, at + 6).map((i) => i.action.do === "run" ? i.action.command : ""),
    constraintsFor(m, ["l1", "l2"]).map((a) => a.text));
});

/** A context whose pick answers from a script. */
function scripted(m: Model, picks: (Pick | null)[], options: Record<string, unknown> = {}, prenamed: string[] = []) {
  const said: string[] = [];
  const ctx: ToolContext = {
    model: m, options, prenamed,
    requestRender() {}, requestSolve() { m.solve(); }, finish() {},
    pick: () => picks.shift() ?? null,
    log: (l: string) => { said.push(l); },
  };
  return { ctx, said };
}

const at0 = { world: [0, 0], screen: [0, 0] as [number, number] };

// The commit is asynchronous since smart dimension (docs/plans/smart-dimension.md):
// the dimension is tried on a copy first, to make it driven if it may not drive.
test("the dimension tool: click a line, click to place — one dist holding its length", async () => {
  const m = new Model(2);
  line(m, "l1", [0, 0], [12, 5]);
  const { ctx } = scripted(m, [{ name: "l1", kind: "line", distance: 0 }, null]);
  const tool = new DimensionTool(ctx);
  tool.onDown(at0);
  assert.deepEqual(tool.picks, ["l1"]);
  tool.onDown(at0);
  await tool.settled;
  const d = [...m.relations.values()];
  assert.equal(d.length, 1);
  assert.deepEqual(d[0].args, ["l1a", "l1b", 13]);
  assert.deepEqual(tool.picks, [], "spent");
});

test("the dimension tool: two lines make an angle; a click on a picked one drops it; driven types measure", async () => {
  const m = new Model(2);
  line(m, "l1", [0, 0], [10, 0]);
  line(m, "l2", [0, 0], [0, 10]);
  const L = (n: string): Pick => ({ name: n, kind: "line", distance: 0 });
  const { ctx } = scripted(m, [L("l1"), L("l2"), L("l2"), L("l2"), null]);
  const tool = new DimensionTool(ctx);
  tool.onDown(at0); tool.onDown(at0); tool.onDown(at0);
  assert.deepEqual(tool.picks, ["l1"], "the second click on l2 dropped it");
  tool.onDown(at0); tool.onDown(at0);
  await tool.settled;
  const r = [...m.relations.values()][0];
  assert.equal(r.op, "angle");
  close(r.args[2] as number, Math.PI / 2, 1e-12);
  const driven = scripted(m, [{ name: "c1", kind: "circle", distance: 0 }, null], { driven: true, diameter: true });
  m.addPoint([0, 0], "c0"); m.addCircle("c0", 4, null, "c1");
  const tool2 = new DimensionTool(driven.ctx);
  tool2.onDown(at0); tool2.onDown(at0);
  await tool2.settled;
  const last = [...m.relations.values()].at(-1)!;
  assert.deepEqual([last.op, ...last.args], ["measure", "diameter", "c1"]);
});

test("the dimension tool guides a placement with nothing measurable", () => {
  const m = new Model(2);
  const { ctx, said } = scripted(m, [null]);
  new DimensionTool(ctx).onDown(at0);
  assert.match(said[0], /click what to dimension/);
  assert.equal(m.relations.size, 0);
});

test("the constrain tool starts from the selection and applies the relation chosen", () => {
  const m = new Model(2);
  line(m, "l1", [0, 0], [10, 0]);
  line(m, "l2", [0, 3], [10, 5]);
  const { ctx } = scripted(m, [], {}, ["l1", "l2"]);
  const tool = new ConstrainTool(ctx);
  tool.onArmed();
  assert.deepEqual(tool.commands().map((c) => c.label), ["Parallel", "Perpendicular", "Equal", "Collinear", "Angle"]);
  const r = tool.apply(0);
  assert.equal(m.relations.get(r)!.op, "parallel");
  assert.deepEqual(tool.picks, []);
  assert.deepEqual(tool.commands(), []);
  // Picking by click instead.
  const clicks = scripted(m, [{ name: "l1", kind: "line", distance: 0 }, { name: "l2", kind: "line", distance: 0 }, null]);
  const t2 = new ConstrainTool(clicks.ctx);
  t2.onArmed();
  t2.onDown(at0); t2.onDown(at0);
  assert.equal(t2.commands()[0].command, 'par("l1", "l2")');
  t2.onDown(at0);
  assert.deepEqual(t2.picks, [], "empty canvas drops the picks");
});

// --- cost -----------------------------------------------------------------------

test("the analysis costs milliseconds on a large sketch, and is never asked during a drag", () => {
  // Forty rectangles in a row, each dimensioned and tied to the last — 160
  // points, 160 lines, ~400 relations: past the biggest fixture the suite
  // carries (the measured numbers are in docs/plans/sketch-relations.md).
  const m = new Model(3);
  for (let r = 0; r < 40; r++) {
    const x0 = r * 50;
    const corners = [[x0, 0, 0], [x0 + 40, 0, 0], [x0 + 40, 25, 0], [x0, 25, 0]];
    corners.forEach((c, i) => m.addPoint(c, `r${r}k${i}`));
    for (let i = 0; i < 4; i++) m.addLine(`r${r}k${i}`, `r${r}k${(i + 1) % 4}`, `r${r}e${i}`);
    parallel(m, `r${r}e0`, "origin.x"); parallel(m, `r${r}e2`, "origin.x");
    parallel(m, `r${r}e1`, "origin.y"); parallel(m, `r${r}e3`, "origin.y");
    dist(m, `r${r}k0`, `r${r}k1`, 40); dist(m, `r${r}k1`, `r${r}k2`, 25);
    if (r === 0) fix(m, "r0k0", [0, 0, 0]);
    else dist(m, `r${r - 1}k1`, `r${r}k0`, 10);
  }
  m.solve();
  const runs: number[] = [];
  for (let i = 0; i < 5; i++) runs.push(m.diagnose().ms);
  const d = m.diagnose();
  runs.sort((a, b) => a - b);
  console.log(`diagnose on ${m.entities.size} entities / ${m.relations.size} relations / ${m.problem.varCount} variables: median ${runs[2].toFixed(1)} ms`);
  assert.ok(runs[2] < 500, `median ${runs[2]} ms`);
  // Every rectangle's y is free except the first's: the chain ties x only.
  assert.equal(d.dof, 39);
});

// --- what the status says, and the marks -------------------------------------

test("the diagnosis line: a count that fades, a conflict that names, a redundancy in the softer word", () => {
  assert.deepEqual(diagnosisLine(true, 3, [], [], []), { cls: "", parts: ["3 free"], fades: true });
  assert.deepEqual(diagnosisLine(true, 0, [], [], []).parts, ["0 free"]);
  assert.deepEqual(diagnosisLine(false, null, ["d1", "d2"], [], []),
    { cls: "conflict", parts: [{ relation: "d1" }, " · ", { relation: "d2" }, " cannot all hold"], fades: false });
  assert.deepEqual(diagnosisLine(false, null, [], ["mine"], []).parts, ["mine", " cannot hold"]);
  assert.deepEqual(diagnosisLine(true, 2, [], [], ["r5"]),
    { cls: "redundant", parts: ["2 free", " · ", "redundant ", { relation: "r5" }], fades: false });
});

test("a par between two lines keeps //; against an axis it is — or |", () => {
  const m = new Model(2);
  line(m, "l1", [0, 0], [10, 0]);
  line(m, "l2", [0, 5], [10, 6]);
  line(m, "l3", [20, 0], [21, 10]);
  const between = parallel(m, "l1", "l2");
  const level = parallel(m, "l1", "origin.x");
  const upright = parallel(m, "l3", "origin.y");
  const marks = placeGlyphs(m, { ox: 0, oy: 0, scale: 3 });
  const of = (r: string) => [...new Set(marks.filter((g) => g.relation === r).map((g) => g.symbol))];
  assert.deepEqual(of(between), ["//"]);
  assert.deepEqual(of(level), ["—"]);
  assert.deepEqual(of(upright), ["|"]);
});
