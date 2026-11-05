// Sketch shapes: the polygon and the slot (composites of ordinary entities and
// relations) and the ellipse (a new entity kind, and its relations) —
// docs/plans/sketch-shapes.md. The owner: *"give me better sketch tools,
// relations, trim, slot... all the usual"*.

import { test } from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { ensureKernelLoaded } from "../src/kernel/problem.ts";
import { Dual } from "../src/kernel/dual.ts";
import { Model } from "../src/model.ts";
import { coincident, dist, fix, onPlane } from "../src/relations/basic.ts";
import {
  concentric, equalLength, majorAxis, minorAxis, onEllipse, parallel, radius, tangent,
} from "../src/relations/geometry.ts";
import { polygon, slot } from "../src/tools/shapes.ts";
import { open, save, VERSION } from "../src/persist.ts";
import { del, set } from "../src/operations.ts";
import { pullTo } from "../src/tools/engine.ts";
import { findLoops } from "../src/loops.ts";

/**
 * A drag as the engine does one: the grabbed point pulled weakly (the
 * engine's own `pullTo`) toward a cursor that moves from where the point was
 * to `to` over `frames` frames, one solve a frame.
 */
function drag(m: Model, name: string, to: number[], frames = 40) {
  const from = m.coords(name);
  for (let k = 1; k <= frames; k++) {
    const at = from.map((x, i) => x + ((to[i] - x) * k) / frames);
    m.problem.solve({ extra: pullTo(m, name, at) });
  }
}

async function loadKernel() {
  const bytes = await readFile(new URL("../src/kernel/wasm-gen/neocad_kernel_bg.wasm", import.meta.url));
  await ensureKernelLoaded(bytes);
}

function ok(m: Model) {
  const report = m.solve();
  assert.equal(report.solved, true, JSON.stringify(report.offenders));
  return report;
}

const sub = (a: number[], b: number[]) => a.map((x, i) => x - b[i]);
const len = (a: number[]) => Math.hypot(...a);
const dot = (a: number[], b: number[]) => a.reduce((s, x, i) => s + x * b[i], 0);

/**
 * Every block of relation `name` evaluated at the model's values with exact
 * derivatives: each residual's value and the length of its gradient. The
 * problem's blocks are its own; a test reaches in, and nothing else does.
 */
function gradients(m: Model, name: string): { value: number; grad: number }[] {
  const handles = new Set(m.relationOf(name).blocks);
  const blocks = (m.problem as unknown as { blocks: { id: number; block: { varIndices: number[] | (() => number[]); fn: (l: Dual[]) => Dual[] } }[] }).blocks;
  const out: { value: number; grad: number }[] = [];
  for (const { id, block } of blocks) {
    if (!handles.has(id)) continue;
    const vars = typeof block.varIndices === "function" ? block.varIndices() : block.varIndices;
    const locals = vars.map((v, slot) => Dual.variable(m.problem.getVar(v), slot));
    for (const r of block.fn(locals)) out.push({ value: r.val, grad: Math.hypot(...r.grad.values()) });
  }
  return out;
}

/** Degrees of freedom left: variables the relations touch, less the Jacobian's rank, by finite probing of the exact gradients. */
function freedoms(m: Model): number {
  const blocks = (m.problem as unknown as { blocks: { block: { varIndices: number[] | (() => number[]); fn: (l: Dual[]) => Dual[] } }[] }).blocks;
  const rows: Map<number, number>[] = [];
  const used = new Set<number>();
  for (const { block } of blocks) {
    const vars = typeof block.varIndices === "function" ? block.varIndices() : block.varIndices;
    const locals = vars.map((v, slot) => Dual.variable(m.problem.getVar(v), slot));
    for (const r of block.fn(locals)) {
      const row = new Map<number, number>();
      for (const [slot, d] of r.grad) row.set(vars[slot], (row.get(vars[slot]) ?? 0) + d);
      rows.push(row);
    }
  }
  // Every variable an entity owns, so a free one counts even when nothing reads it.
  for (const e of m.entities.values()) {
    if (e.kind === "point") e.varIndices.forEach((v) => used.add(v));
    if (e.kind === "circle" || e.kind === "arc") used.add(e.radiusVar);
    if (e.kind === "ellipse") used.add(e.minorVar);
    if ("normal" in e && e.normal) e.normal.forEach((v) => used.add(v));
  }
  const cols = [...used];
  const A = rows.map((r) => cols.map((c) => r.get(c) ?? 0));
  // Rank by Gaussian elimination with partial pivoting.
  let rank = 0;
  for (let c = 0; c < cols.length && rank < A.length; c++) {
    let p = rank;
    for (let r = rank + 1; r < A.length; r++) if (Math.abs(A[r][c]) > Math.abs(A[p][c])) p = r;
    if (Math.abs(A[p][c]) < 1e-9) continue;
    [A[rank], A[p]] = [A[p], A[rank]];
    for (let r = 0; r < A.length; r++) {
      if (r === rank) continue;
      const f = A[r][c] / A[rank][c];
      if (f !== 0) for (let k = c; k < cols.length; k++) A[r][k] -= f * A[rank][k];
    }
    rank++;
  }
  return cols.length - rank;
}

// ---- the ellipse -------------------------------------------------------------

test("addEllipse: a centre, a major end, a minor variable — named el1, journalled, a plane's own normal in 3D", async () => {
  await loadKernel();
  const m = new Model(2);
  const c = m.addPoint([1, 2]).name;
  const a = m.addPoint([11, 2]).name;
  const e = m.addEllipse(c, a, 4);
  assert.equal(e.name, "el1");
  assert.deepEqual(m.refsOf(e), [c, a]);
  assert.deepEqual(m.semiAxes("el1"), { a: 10, b: 4 });
  assert.equal(e.normal, undefined, "a 2D ellipse lies in the one plane there is");
  assert.deepEqual(m.journal.at(-1), { op: "addEllipse", args: [c, a, 4, null, "el1"] });
  assert.throws(() => m.addEllipse(c, c, 2), /major end apart/);
  assert.throws(() => m.addEllipse(c, a, -1), /positive minor/);
  assert.throws(() => m.addEllipse(c, a, 2, [0, 0, 1]), /takes no normal/);
  // Bare: everything seeded, nothing held.
  const free = m.addEllipse();
  const { a: fa, b: fb } = m.semiAxes(free.name);
  assert.ok(fa > 0 && fb > 0 && Math.abs(fb - fa / 2) < 1e-12);

  const m3 = new Model(3);
  const e3 = m3.addEllipse();
  assert.equal(e3.normal?.length, 3);
  assert.deepEqual(m3.normalOf(e3.name), [0, 0, 1]);
});

test("onellipse: a point is held on the ellipse, and its gradient at the root does not vanish (it is not a square)", async () => {
  await loadKernel();
  const m = new Model(2);
  const c = m.addPoint([0, 0]).name, a = m.addPoint([10, 0]).name;
  fix(m, c, [0, 0]);
  fix(m, a, [10, 0]);
  const e = m.addEllipse(c, a, 4).name;
  minorAxis(m, e, 4);
  const p = m.addPoint([3, 7]).name;
  const r = onEllipse(m, p, e);
  ok(m);
  const [x, y] = m.coords(p);
  assert.ok(Math.abs((x / 10) ** 2 + (y / 4) ** 2 - 1) < 1e-9, `on the ellipse: (${x}, ${y})`);
  const g = gradients(m, r);
  assert.equal(g.length, 1, "one block in 2D");
  assert.ok(Math.abs(g[0].value) < 1e-9);
  assert.ok(g[0].grad > 0.1, `gradient at the root: ${g[0].grad}`);
  // At the major end and the minor end, exactly where the implicit form's gradient is steepest and shallowest.
  for (const at of [[10, 0], [0, 4], [-10, 0], [0, -4]]) {
    m.setCoords(p, at);
    const [h] = gradients(m, r);
    assert.ok(Math.abs(h.value) < 1e-9 && h.grad > 0.3, `at ${at}: ${JSON.stringify(h)}`);
  }
});

test("onellipse in 3D on a tilted plane: on the curve and in its plane, both blocks with gradients at the root", async () => {
  await loadKernel();
  const m = new Model(3);
  // A plane tipped 30° about x, through (5, 5, 5).
  const t = Math.PI / 6;
  const u = [1, 0, 0], v = [0, Math.cos(t), Math.sin(t)], n = [0, -Math.sin(t), Math.cos(t)];
  const o = [5, 5, 5];
  const at = (x: number, y: number) => o.map((c, i) => c + x * u[i] + y * v[i]);
  const c = m.addPoint(o).name;
  const a = m.addPoint(at(8 * Math.cos(0.4), 8 * Math.sin(0.4))).name;
  for (const q of [c, a]) fix(m, q, m.coords(q));
  const e = m.addEllipse(c, a, 3, n).name;
  minorAxis(m, e, 3);
  const p = m.addPoint(at(2, 6).map((x, i) => x + 2 * n[i])).name; // off the plane, off the curve
  const r = onEllipse(m, p, e);
  // The normal free to turn about the major axis would let the plane swing to
  // meet the point: hold it to the plane's, as a tool does.
  const tri = [m.addPoint(o).name, m.addPoint(at(1, 0)).name, m.addPoint(at(0, 1)).name];
  for (const q of tri) fix(m, q, m.coords(q));
  parallel(m, e, tri.join("."));
  ok(m);
  const d = sub(m.coords(p), o);
  assert.ok(Math.abs(dot(d, n)) < 1e-8, "in the ellipse's plane");
  // In the ellipse's own frame (major along 0.4 rad in the plane).
  const mu = [Math.cos(0.4), Math.sin(0.4)];
  const [px, py] = [dot(d, u), dot(d, v)];
  const X = px * mu[0] + py * mu[1], Y = -px * mu[1] + py * mu[0];
  assert.ok(Math.abs((X / 8) ** 2 + (Y / 3) ** 2 - 1) < 1e-8, `on it: ${X}, ${Y}`);
  const g = gradients(m, r);
  assert.equal(g.length, 2, "the curve and the plane");
  for (const b of g) assert.ok(Math.abs(b.value) < 1e-8 && b.grad > 0.1, JSON.stringify(b));
});

test("tan(line, ellipse): from either side, either order, the support distance — gradient at the root non-zero", async () => {
  await loadKernel();
  for (const side of [1, -1]) {
    for (const order of ["line-first", "ellipse-first"]) {
      const m = new Model(2);
      const c = m.addPoint([0, 0]).name, a = m.addPoint([10, 0]).name;
      fix(m, c, [0, 0]);
      fix(m, a, [10, 0]);
      const e = m.addEllipse(c, a, 4).name;
      minorAxis(m, e, 4);
      // A line at 30° that starts off the ellipse on one side.
      const p = m.addPoint([-20, side * 6]).name, q = m.addPoint([20, side * 5]).name;
      const l = m.addLine(p, q).name;
      fix(m, p, [-20, side * 6]);
      const r = order === "line-first" ? tangent(m, l, e) : tangent(m, e, l);
      ok(m);
      // Tangent: the line meets the ellipse in exactly one point — the
      // implicit form along it, a quadratic in s, has a double root: its
      // least value is zero.
      const [P, Q] = [m.coords(p), m.coords(q)];
      const D = sub(Q, P);
      const A = (D[0] / 10) ** 2 + (D[1] / 4) ** 2, B = 2 * (P[0] * D[0] / 100 + P[1] * D[1] / 16);
      const s = -B / (2 * A);
      const x = P[0] + s * D[0], y = P[1] + s * D[1];
      const lowest = (x / 10) ** 2 + (y / 4) ** 2 - 1;
      const sign = Math.sign(y);
      assert.ok(Math.abs(lowest) < 1e-9, `${side} ${order}: the line's lowest implicit value is ${lowest}`);
      assert.equal(sign, side, "it touched on the side it started");
      const [g] = gradients(m, r);
      assert.ok(Math.abs(g.value) < 1e-9 && g.grad > 0.1, JSON.stringify(g));
      assert.deepEqual(m.relationOf(r).args, order === "line-first" ? [l, e] : [e, l], "journalled as typed");
    }
  }
});

test("tan(line, ellipse) in 3D holds the line in the ellipse's plane; tan with a circle or another ellipse is refused by name", async () => {
  await loadKernel();
  const m = new Model(3);
  const e = m.addEllipse(m.addPoint([0, 0, 0]).name, m.addPoint([10, 0, 0]).name, 4).name;
  const l = m.addLine(m.addPoint([-20, 6, 3]).name, m.addPoint([20, 6, -2]).name).name;
  const r = tangent(m, l, e);
  assert.equal(gradients(m, r).length, 3, "the support block, and the plane block's two ends");
  const c = m.addCircle(null, 3).name;
  assert.throws(() => tangent(m, e, c), /tan takes an ellipse with a line .*not supported/);
  const e2 = m.addEllipse().name;
  assert.throws(() => tangent(m, e, e2), /not supported/);
});

test("major and minor are dimensions: d-named, labelled, set-able; conc takes an ellipse with a circle or an ellipse", async () => {
  await loadKernel();
  const m = new Model(2);
  const c = m.addPoint([0, 0]).name;
  fix(m, c, [0, 0]);
  const e = m.addEllipse(c, m.addPoint([7, 1]).name, 2).name;
  const d1 = majorAxis(m, e, 20);
  const d2 = minorAxis(m, e, 10);
  assert.match(d1, /^d\d+$/);
  assert.match(d2, /^d\d+$/);
  ok(m);
  const { a, b } = m.semiAxes(e);
  assert.ok(Math.abs(a - 20) < 1e-9 && Math.abs(b - 10) < 1e-9);
  set(m, `${d2}.value`, 5);
  ok(m);
  assert.ok(Math.abs(m.semiAxes(e).b - 5) < 1e-9);
  for (const [g] of [gradients(m, d1), gradients(m, d2)]) assert.ok(g.grad > 0.5, "neither is a square");
  assert.throws(() => majorAxis(m, e, 0), /positive semi-axis/);
  const circ = m.addCircle(m.addPoint([3, 3]).name, 2).name;
  concentric(m, circ, e);
  const e2 = m.addEllipse(m.addPoint([-4, 2]).name, null, 1).name;
  concentric(m, e, e2);
  ok(m);
  assert.ok(len(m.coords(m.circle(circ).center)) < 1e-9 && len(m.coords(m.ellipse(e2).center)) < 1e-9);
});

test("an ellipse is construction-able, deletable with its points, and a plane reference in 3D", async () => {
  await loadKernel();
  const m = new Model(3);
  const e = m.addEllipse(m.addPoint([0, 0, 0]).name, m.addPoint([10, 0, 0]).name, 4).name;
  m.setConstruction(e, true);
  assert.equal(m.isConstruction(e), true);
  assert.equal(m.planeKind(e), "curve");
  assert.deepEqual(m.planeValues(e)?.n, [0, 0, 1]);
  // Its normal straightened: tipped toward the major axis, its plane is unchanged.
  m.setNormal(e, [1, 0, 1]);
  assert.deepEqual(m.normalOf(e).map((x) => Math.round(x * 1e12) / 1e12), [0, 0, 1]);
  const p = m.addPoint([3, 3, 0]).name;
  onEllipse(m, p, e);
  del(m, m.ellipse(e).center);
  assert.equal(m.entities.has(e), false, "deleting its centre takes the ellipse and what reads it");
  assert.equal([...m.relations.values()].some((r) => r.op === "onEllipse"), false);
});

test("an ellipse replays from its file: format 15, minors and normals saved, a version-14 file still opens", async () => {
  await loadKernel();
  const m = new Model(3);
  const c = m.addPoint([1, 1, 0]).name;
  const e = m.addEllipse(c, m.addPoint([9, 3, 0]).name, 2).name;
  onPlane(m, c);
  const p = m.addPoint([0, 5, 0]).name;
  onEllipse(m, p, e);
  minorAxis(m, e, 3);
  majorAxis(m, e, 12);
  ok(m);
  const text = save(m);
  const saved = JSON.parse(text);
  assert.equal(saved.version, VERSION);
  assert.equal(VERSION, 15);
  assert.ok(Math.abs(saved.values.minors[e] - 3) < 1e-9);
  assert.equal(saved.values.normals[e].length, 3);
  const back = open(text);
  assert.deepEqual([...back.relations.values()].map((r) => r.op), [...m.relations.values()].map((r) => r.op));
  assert.deepEqual(back.semiAxes(e), m.semiAxes(e));
  assert.deepEqual(back.coords(p), m.coords(p));
  assert.equal(save(back), text, "and saves back to the same bytes");
  // A file from before the ellipse opens unchanged.
  const old = new Model(2);
  old.addLine(old.addPoint([0, 0]).name, old.addPoint([5, 0]).name);
  const v14 = JSON.parse(save(old));
  v14.version = 14;
  const reopened = open(JSON.stringify(v14));
  assert.deepEqual([...reopened.entities.keys()], [...old.entities.keys()]);
});

// ---- the polygon -------------------------------------------------------------

test("polygon: n points, n lines sharing corners, every side eq to its neighbour, a construction circle through the corners", async () => {
  await loadKernel();
  const m = new Model(2);
  const c = m.addPoint([0, 0]).name, v = m.addPoint([10, 0]).name;
  const parts = polygon(m, c, v, 6);
  assert.equal(parts.vertices.length, 6);
  assert.equal(parts.sides.length, 6);
  assert.equal(parts.vertices[0], v, "the clicked vertex is the first corner");
  for (let k = 0; k < 6; k++) assert.deepEqual(m.line(parts.sides[k]).refs, [parts.vertices[k], parts.vertices[(k + 1) % 6]]);
  assert.equal(m.isConstruction(parts.circle), true);
  assert.equal(m.circle(parts.circle).center, c, "about the polygon's own centre — no conc needed");
  const ops = parts.relations.map((r) => m.relationOf(r).op);
  assert.deepEqual(ops, [...Array(6).fill("onCircle"), ...Array(5).fill("equalLength")]);
  assert.equal([...m.relations.values()].filter((r) => r.op === "coincident").length, 0, "corners are shared points");
  ok(m);
  for (let k = 0; k < 6; k++) {
    const t = (Math.PI * 2 * k) / 6;
    const q = m.coords(parts.vertices[k]);
    assert.ok(Math.abs(q[0] - 10 * Math.cos(t)) < 1e-9 && Math.abs(q[1] - 10 * Math.sin(t)) < 1e-9);
  }
  // Four freedoms: the centre's two, the size, the turn.
  assert.equal(freedoms(m), 4);
  assert.throws(() => polygon(m, c, v, 2), /3 to 64/);
  assert.throws(() => polygon(m, c, c, 5), /apart from its centre/);
});

/** Whether every side of a closed chain of corners is `s` long and every corner on the circle of radius `R` about `c`. */
function regular(m: Model, centre: string, vertices: string[]): { sides: number[]; reach: number[] } {
  const at = vertices.map((p) => m.coords(p));
  const c = m.coords(centre);
  return {
    sides: at.map((p, k) => len(sub(at[(k + 1) % at.length], p))),
    reach: at.map((p) => len(sub(p, c))),
  };
}

function assertRegular(m: Model, centre: string, vertices: string[], what: string) {
  const { sides, reach } = regular(m, centre, vertices);
  const spread = (xs: number[]) => Math.max(...xs) - Math.min(...xs);
  assert.ok(spread(sides) < 1e-7, `${what}: sides ${sides.map((s) => s.toFixed(6))}`);
  assert.ok(spread(reach) < 1e-7, `${what}: corners from the centre ${reach.map((s) => s.toFixed(6))}`);
}

for (const circumscribed of [true, false]) {
  for (const n of [3, 4, 5, 6, 8]) {
    test(`polygon (${n} sides, ${circumscribed ? "circumscribed" : "inscribed"}) stays regular as a side is dimensioned and as a vertex is dragged`, async () => {
      await loadKernel();
      const m = new Model(2);
      const c = m.addPoint([2, 1]).name, v = m.addPoint([12, 4]).name;
      fix(m, c, [2, 1]);
      const parts = polygon(m, c, v, n, circumscribed);
      ok(m);
      assertRegular(m, c, parts.vertices, "as drawn");
      assert.equal(freedoms(m), 2, "fixed centre: the size and the turn");
      // A side dimensioned.
      const d = dist(m, parts.vertices[1], parts.vertices[2], 7);
      ok(m);
      assertRegular(m, c, parts.vertices, "a side dimensioned to 7");
      assert.ok(Math.abs(regular(m, c, parts.vertices).sides[1] - 7) < 1e-8);
      del(m, d);
      // A vertex dragged: a weak pull far off the circle — the polygon turns
      // and grows to follow, regular all the way.
      drag(m, parts.vertices[n - 1], [-15, 9]);
      assertRegular(m, c, parts.vertices, "a vertex dragged out and round");
      drag(m, parts.vertices[0], [4, 3]);
      assertRegular(m, c, parts.vertices, "a vertex dragged in close");
      // A side dimensioned with the polygon's `eq` on a line it made: the circle follows.
      const r = radius(m, parts.inscribed ?? parts.circle, 9);
      ok(m);
      assertRegular(m, c, parts.vertices, "its circle given a radius");
      const R = regular(m, c, parts.vertices).reach[0];
      assert.ok(Math.abs((circumscribed ? R : R * Math.cos(Math.PI / n)) - 9) < 1e-8, `radius 9 ↔ corners at ${R}`);
      del(m, r);
      if (!circumscribed) {
        const ops = parts.relations.map((x) => m.relationOf(x).op);
        assert.deepEqual(ops, [...Array(n).fill("onCircle"), ...Array(n - 1).fill("equalLength"), "tangent"],
          "the circumscribed polygon's relations, and the inner circle touching the first side");
        assert.equal(freedoms(m), 2, "still the size and the turn");
        assert.equal(m.isConstruction(parts.inscribed!), true);
      }
    });
  }
}

test("polygon in 3D: laid out on a tilted plane and held there — derived corners onplane, the circle onplane and par", async () => {
  await loadKernel();
  const m = new Model(3);
  const t = 0.5;
  const tri = [m.addPoint([0, 0, 0]).name, m.addPoint([1, 0, 0]).name, m.addPoint([0, Math.cos(t), Math.sin(t)]).name];
  for (const q of tri) fix(m, q, m.coords(q));
  const plane = tri.join(".");
  const n = [0, -Math.sin(t), Math.cos(t)];
  const c = m.addPoint([1, 2 * Math.cos(t), 2 * Math.sin(t)]).name;
  const v = m.addPoint([6, 2 * Math.cos(t), 2 * Math.sin(t)]).name;
  onPlane(m, c, plane);
  onPlane(m, v, plane);
  const parts = polygon(m, c, v, 5, true, plane);
  ok(m);
  for (const p of parts.vertices) assert.ok(Math.abs(dot(m.coords(p), n)) < 1e-9, `${p} on the plane`);
  assertRegular(m, c, parts.vertices, "3D");
  const ops = [...m.relations.values()].map((r) => r.op);
  assert.equal(ops.filter((o) => o === "onPlane").length, 2 + 4, "the two clicked points and the four derived corners");
  assert.ok(ops.includes("parallel"), "the circle's normal held to the plane's");
  assert.deepEqual(m.normalOf(parts.circle).map((x) => Math.round(x * 1e9) / 1e9), n.map((x) => Math.round(x * 1e9) / 1e9));
});

test("polygon(...) replays as its pieces: no polygon in the journal, a save/open round trip gives the same model", async () => {
  await loadKernel();
  const m = new Model(2);
  polygon(m, m.addPoint([0, 0]).name, m.addPoint([5, 5]).name, 7, false);
  ok(m);
  assert.equal(m.journal.some((e) => e.op === "polygon"), false);
  const text = save(m);
  const back = open(text);
  assert.deepEqual([...back.entities.keys()], [...m.entities.keys()]);
  assert.deepEqual([...back.relations.values()].map((r) => [r.name, r.op, r.args]), [...m.relations.values()].map((r) => [r.name, r.op, r.args]));
  assert.equal(save(back), text);
});

// ---- the slot ----------------------------------------------------------------

test("slot: two lines, two arcs about the centres, eqrad, four tangencies, arcends, a construction line between the centres", async () => {
  await loadKernel();
  const m = new Model(2);
  const a = m.addPoint([0, 0]).name, b = m.addPoint([30, 0]).name;
  const parts = slot(m, a, b, 10);
  assert.equal(m.isConstruction(parts.axis), true);
  assert.deepEqual(m.line(parts.axis).refs, [a, b]);
  assert.equal(m.arc(parts.arcs[0]).center, a);
  assert.equal(m.arc(parts.arcs[1]).center, b);
  const ops = parts.relations.map((r) => m.relationOf(r).op);
  assert.deepEqual(ops, ["arcEndpoints", "arcEndpoints", "equalRadius", "perpendicular", "perpendicular", "perpendicular", "perpendicular"]);
  // Each side square to the radius at each of its ends — tangency said linearly (see `slot`).
  assert.deepEqual(parts.relations.slice(3).map((r) => m.relationOf(r).args.length), [3, 3, 3, 3]);
  ok(m);
  // As drawn: the sides 5 off the axis, the arcs radius 5, the outline closed.
  for (const s of parts.sides) {
    const [p, q] = m.line(s).refs.map((x) => m.coords(x));
    assert.ok(Math.abs(Math.abs(p[1]) - 5) < 1e-9 && Math.abs(Math.abs(q[1]) - 5) < 1e-9);
  }
  assert.ok(Math.abs(m.radius(parts.arcs[0]) - 5) < 1e-9 && Math.abs(m.radius(parts.arcs[1]) - 5) < 1e-9);
  // The arcs run round the outside of each end.
  assert.ok(m.coords(m.arc(parts.arcs[1]).start)[1] < 0 && m.coords(m.arc(parts.arcs[1]).end)[1] > 0);
  assert.equal(freedoms(m), 5, "two centres and the width");
});

test("slot: the width a radius (doubled) and the length a dist on the construction line, each holding, the rest following", async () => {
  await loadKernel();
  const m = new Model(2);
  const a = m.addPoint([0, 0]).name, b = m.addPoint([30, 4]).name;
  fix(m, a, [0, 0]);
  const parts = slot(m, a, b, 10);
  radius(m, parts.arcs[0], 6);           // width 12
  dist(m, a, b, 40);                      // length 40, centre to centre
  // Level against the origin's axis — a datum, as CLAUDE.md prefers. (Against
  // a fixed one-unit line the solver stalls short of the answer, a rectangle's
  // edge as much as this slot's axis: TODO.md.)
  parallel(m, parts.axis, "origin.x");
  ok(m);
  assert.ok(Math.abs(len(m.coords(b)) - 40) < 1e-8);
  assert.ok(Math.abs(m.radius(parts.arcs[1]) - 6) < 1e-8, "eqrad carries the width to the other end");
  for (const s of parts.sides) {
    const [p, q] = m.line(s).refs.map((x) => m.coords(x));
    assert.ok(Math.abs(Math.abs(p[1]) - 6) < 1e-7 && Math.abs(Math.abs(q[1]) - 6) < 1e-7, `side ${s} 6 off the axis`);
  }
  assert.throws(() => slot(m, a, b, 0), /positive width/);
  assert.throws(() => slot(m, a, a, 3), /two different centres/);
});

test("slot in 3D on a tilted plane: held there, and a coin-joined pair of slots stays one drawing after a save/open", async () => {
  await loadKernel();
  const m = new Model(3);
  const t = -0.7;
  const tri = [m.addPoint([0, 0, 2]).name, m.addPoint([0, 1, 2]).name, m.addPoint([Math.cos(t), 0, 2 + Math.sin(t)]).name];
  for (const q of tri) fix(m, q, m.coords(q));
  const plane = tri.join(".");
  const a = m.addPoint([0, 0, 2]).name, b = m.addPoint([0, 20, 2]).name;
  onPlane(m, a, plane);
  onPlane(m, b, plane);
  const parts = slot(m, a, b, 6, plane);
  ok(m);
  const n = [Math.sin(t), 0, -Math.cos(t)].map((x) => -x); // (p2-p1)×(p3-p1)
  const unitN = n.map((x) => x / len(n));
  for (const s of parts.sides) for (const p of m.line(s).refs) assert.ok(Math.abs(dot(sub(m.coords(p), [0, 0, 2]), unitN)) < 1e-9);
  const a2 = m.addPoint([0, 20, 2]).name;
  coincident(m, a2, b);
  const text = save(m);
  assert.equal(save(open(text)), text);
});

test("a polygon's side made eq to another line keeps the polygon regular — the composite is ordinary relations", async () => {
  await loadKernel();
  const m = new Model(2);
  const parts = polygon(m, m.addPoint([0, 0]).name, m.addPoint([0, 8]).name, 3);
  const l = m.addLine(m.addPoint([20, 0]).name, m.addPoint([32, 0]).name).name;
  fix(m, m.line(l).refs[0], [20, 0]);
  fix(m, m.line(l).refs[1], [32, 0]);
  equalLength(m, parts.sides[0], l);
  ok(m);
  assertRegular(m, parts.centre, parts.vertices, "eq to a 12-long line");
  assert.ok(Math.abs(regular(m, parts.centre, parts.vertices).sides[0] - 12) < 1e-8);
});

// ---- regions -----------------------------------------------------------------

test("loops: an ellipse is a loop on its own, area πab, counter-clockwise; inside a rectangle it is the rectangle's hole", async () => {
  await loadKernel();
  const m = new Model(2);
  const e = m.addEllipse(m.addPoint([0, 0]).name, m.addPoint([8 * Math.cos(0.3), 8 * Math.sin(0.3)]).name, 3).name;
  let loops = findLoops(m);
  assert.equal(loops.length, 1);
  assert.deepEqual(loops[0].members.map((x) => x.name), [e]);
  assert.ok(Math.abs(loops[0].area - Math.PI * 8 * 3) < 1e-9, `area ${loops[0].area}`);
  // A rectangle round it: two loops, the ellipse the rectangle's child.
  const c = [[-20, -10], [20, -10], [20, 10], [-20, 10]].map((at) => m.addPoint(at).name);
  c.forEach((p, k) => m.addLine(p, c[(k + 1) % 4]));
  loops = findLoops(m);
  assert.equal(loops.length, 2);
  const ring = loops.findIndex((l) => l.members.length === 1);
  const box = 1 - ring;
  assert.equal(loops[ring].parent, box);
  assert.deepEqual(loops[box].children, [ring]);
  // Construction: no region at all.
  m.setConstruction(e, true);
  assert.equal(findLoops(m).length, 1);
});

test("loops: a line across an ellipse cuts it into two regions at the crossings, a point held on it cuts it", async () => {
  await loadKernel();
  const m = new Model(2);
  const e = m.addEllipse(m.addPoint([0, 0]).name, m.addPoint([10, 0]).name, 4).name;
  const l = m.addLine(m.addPoint([-1, -8]).name, m.addPoint([2, 8]).name).name;
  const loops = findLoops(m);
  assert.equal(loops.length, 2, "the two sides of the chord");
  const total = loops.reduce((s, x) => s + x.area, 0);
  assert.ok(Math.abs(total - Math.PI * 40) < 1e-6, `the two parts make the whole: ${total}`);
  for (const x of loops) assert.ok(x.members.some((mm) => mm.name === l) && x.members.some((mm) => mm.name === e));
  // An ellipse crossing a circle: a lens and two crescents.
  const m2 = new Model(2);
  m2.addEllipse(m2.addPoint([0, 0]).name, m2.addPoint([10, 0]).name, 4);
  m2.addCircle(m2.addPoint([9, 0]).name, 3);
  assert.equal(findLoops(m2).length, 3);
});

test("loops: a slot is one region — two lines and two arcs — area 2r·L + πr²", async () => {
  await loadKernel();
  const m = new Model(2);
  const parts = slot(m, m.addPoint([0, 0]).name, m.addPoint([30, 0]).name, 10);
  ok(m);
  const loops = findLoops(m);
  assert.equal(loops.length, 1, "the construction axis bounds nothing");
  assert.deepEqual(loops[0].members.map((x) => x.name).sort(), [...parts.sides, ...parts.arcs].sort());
  assert.ok(Math.abs(loops[0].area - (10 * 30 + Math.PI * 25)) < 1e-9, `area ${loops[0].area}`);
  // A polygon is one too; its construction circle none.
  const m2 = new Model(2);
  polygon(m2, m2.addPoint([0, 0]).name, m2.addPoint([10, 0]).name, 6, false);
  ok(m2);
  const pl = findLoops(m2);
  assert.equal(pl.length, 1);
  assert.ok(Math.abs(pl[0].area - (3 * Math.sqrt(3) / 2) * 100) < 1e-8, `a hexagon of circumradius 10: ${pl[0].area}`);
});

test("loops in 3D: an ellipse on a tilted plane is found in that plane, its area πab", async () => {
  await loadKernel();
  const m = new Model(3);
  const t = 0.6;
  const u = [Math.cos(t), 0, Math.sin(t)], v = [0, 1, 0];
  const n = [-Math.sin(t), 0, Math.cos(t)];
  const o = [3, 4, 5];
  const at = (x: number, y: number) => o.map((c, i) => c + x * u[i] + y * v[i]);
  m.addEllipse(m.addPoint(o).name, m.addPoint(at(6, 2)).name, 2.5, n);
  const loops = findLoops(m);
  assert.equal(loops.length, 1);
  assert.ok(Math.abs(Math.abs(dot(loops[0].plane.normal, n)) - 1) < 1e-9);
  assert.ok(Math.abs(loops[0].area - Math.PI * Math.hypot(6, 2) * 2.5) < 1e-9);
});
