// Closed loops: what regions a drawing has, and which one a click is in.
//
// Closed forms throughout, for the reason the 3D suites use them: "it found a
// loop" is what a wrong loop also reports. Every area here is computed by hand
// — w·h, πr², a rectangle less (1 − π/4)r² per filleted corner — and every
// orientation is checked by walking the members back out of the model and
// summing the shoelace over them, independently of the module's own
// arithmetic (`traced` below), so a loop listed clockwise cannot pass as
// counter-clockwise.
//
// The case worth reading first is "joined means held": two endpoints at the
// same spot that nothing holds there are *not* joined, and the module says so
// rather than guessing — the package's honesty line.

import { test } from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { ensureKernelLoaded } from "../src/kernel/problem.ts";
import { Model } from "../src/model.ts";
import { coincident } from "../src/relations/basic.ts";
import { pointOnLine } from "../src/relations/geometry.ts";
import { fillet } from "../src/operations.ts";
import { neocadScope } from "../src/replenv.ts";
import { save } from "../src/persist.ts";
import { describeLoop, findLoops, loopAt, type Loop } from "../src/loops.ts";
import { orbitBy, worldToScreen, type View } from "../src/view.ts";
import { axisFrame, tiltedFrame } from "./frames.ts";

async function loadKernel() {
  const bytes = await readFile(new URL("../src/kernel/wasm-gen/neocad_kernel_bg.wasm", import.meta.url));
  await ensureKernelLoaded(bytes);
}

const close = (a: number, b: number, tol = 1e-9) => Math.abs(a - b) <= tol;
const dot = (a: number[], b: number[]) => a.reduce((s, x, i) => s + x * (b[i] ?? 0), 0);
const sub = (a: number[], b: number[]) => [0, 1, 2].map((i) => (a[i] ?? 0) - (b[i] ?? 0));
const names = (l: Loop) => l.members.map((m) => m.name);
const sorted = (l: Loop) => names(l).slice().sort();

/** A closed polygon of fresh points and lines through them, each corner one shared point. */
function polygon(m: Model, corners: number[][]): { points: string[]; lines: string[] } {
  const points = corners.map((c) => m.addPoint(c).name);
  const lines = points.map((p, i) => m.addLine(p, points[(i + 1) % points.length]).name);
  return { points, lines };
}

/**
 * The loop's outline walked straight out of the model — each member's points
 * in the order the loop says, an arc sampled finely in its own frame's
 * counter-clockwise sense (or against it, if reversed) — and its shoelace area
 * in the loop's plane. Independent of `loops.ts`: if the members are listed
 * clockwise, this comes out negative.
 */
function traced(m: Model, loop: Loop): number {
  const { origin, u, v } = loop.plane;
  const flat = (w: number[]) => [dot(sub(w, origin), u), dot(sub(w, origin), v)];
  const pts: number[][] = [];
  for (const mem of loop.members) {
    const e = m.entities.get(mem.name)!;
    if (e.kind === "line") { pts.push(flat(m.coords(mem.from!))); continue; }
    if (e.kind !== "arc" && e.kind !== "circle") throw new Error("not a curve");
    const c = flat(m.coords(e.center));
    const r = m.radius(e.name);
    // Which way round the arc's own frame turns, seen in this plane.
    const own = e.plane === undefined ? 1 : Math.sign(dot(frameZ(m, e.plane), loop.plane.normal));
    const angle = (p: string) => { const q = flat(m.coords(p)); return Math.atan2(q[1] - c[1], q[0] - c[0]); };
    let a0: number, sweep: number;
    if (e.kind === "circle") { a0 = 0; sweep = 2 * Math.PI * own; }
    else {
      a0 = angle(e.start);
      sweep = own * (angle(e.end) - a0);
      while (sweep < 0) sweep += 2 * Math.PI;
      sweep *= own;
    }
    if (mem.reversed) { a0 += sweep; sweep = -sweep; }
    const n = 4000;
    for (let k = 0; k < n; k++) pts.push([c[0] + r * Math.cos(a0 + (sweep * k) / n), c[1] + r * Math.sin(a0 + (sweep * k) / n)]);
  }
  let s = 0;
  for (let i = 0; i < pts.length; i++) {
    const [p, q] = [pts[i], pts[(i + 1) % pts.length]];
    s += p[0] * q[1] - p[1] * q[0];
  }
  return s / 2;
}

function frameZ(m: Model, frame: string): number[] {
  const f = m.frame(frame);
  const o = m.coords(f.origin), x = sub(m.coords(f.xref), o), y = sub(m.coords(f.yref!), o);
  const ux = x.map((c) => c / Math.hypot(...x));
  const along = dot(y, ux);
  const yy = y.map((c, i) => c - along * ux[i]);
  const uy = yy.map((c) => c / Math.hypot(...yy));
  return [ux[1] * uy[2] - ux[2] * uy[1], ux[2] * uy[0] - ux[0] * uy[2], ux[0] * uy[1] - ux[1] * uy[0]];
}

/** Each member ends where the next begins — by point entity, the only kind of "where" a join has. */
function chained(loop: Loop): boolean {
  return loop.members.every((mem, i) => {
    const next = loop.members[(i + 1) % loop.members.length];
    return mem.to !== null && next.from !== null;
  });
}

// --- what a loop is ------------------------------------------------------------

test("a rectangle is one loop: area w·h, members counter-clockwise from the earliest", () => {
  const m = new Model(2);
  const { lines } = polygon(m, [[0, 0], [40, 0], [40, 30], [0, 30]]);
  const loops = findLoops(m);
  assert.equal(loops.length, 1);
  const [loop] = loops;
  assert.deepEqual(names(loop), lines, "l1, l2, l3, l4 — drawn counter-clockwise, listed as drawn");
  assert.ok(loop.members.every((x) => !x.reversed));
  assert.ok(close(loop.area, 1200), `area ${loop.area}`);
  assert.ok(close(traced(m, loop), 1200), "and the members, walked out of the model, run counter-clockwise");
  assert.deepEqual(loop.plane.normal, [0, 0, 1]);
  assert.equal(loop.plane.frame, null, "a 2D drawing with no frame");
  assert.ok(chained(loop));
  assert.equal(loop.parent, null);
  assert.deepEqual(loop.children, []);
});

test("a rectangle drawn clockwise is listed counter-clockwise: every member reversed, the area still +w·h", () => {
  const m = new Model(2);
  const { lines, points } = polygon(m, [[0, 30], [40, 30], [40, 0], [0, 0]]);
  const [loop] = findLoops(m);
  assert.deepEqual(names(loop), [lines[0], lines[3], lines[2], lines[1]], "from the earliest member, the other way round");
  assert.ok(loop.members.every((x) => x.reversed));
  assert.equal(loop.members[0].from, points[1], "l1 walked from its second point");
  assert.equal(loop.members[0].to, points[0]);
  assert.ok(close(loop.area, 1200) && close(traced(m, loop), 1200));
});

test("a filleted rectangle is one loop through the arc: w·h less (1 − π/4)r² per corner", async () => {
  await loadKernel();
  const m = new Model(2);
  const { lines } = polygon(m, [[0, 0], [40, 0], [40, 30], [0, 30]]);
  const arc = fillet(m, lines[0], lines[1], 8);
  m.solve();
  let [loop] = findLoops(m);
  assert.equal(findLoops(m).length, 1);
  assert.deepEqual(sorted(loop), [arc, ...lines].sort(), "every edge and the arc");
  assert.equal(names(loop)[1], arc, "the arc sits between the two legs it rounds");
  const want = 1200 - 64 * (1 - Math.PI / 4);
  assert.ok(close(loop.area, want, 1e-6), `area ${loop.area}, expected ${want}`);
  assert.ok(close(traced(m, loop), want, 1e-4), "and the outline walked out of the model agrees");
  assert.ok(chained(loop));

  // All four corners.
  for (let i = 1; i < 4; i++) fillet(m, lines[i], lines[(i + 1) % 4], 8);
  m.solve();
  [loop] = findLoops(m);
  assert.equal(loop.members.length, 8, "four edges, four arcs");
  const all = 1200 - 4 * 64 * (1 - Math.PI / 4);
  assert.ok(close(loop.area, all, 1e-6), `area ${loop.area}, expected ${all}`);
  assert.ok(close(traced(m, loop), all, 1e-4));
});

test("two rectangles sharing an edge are two loops, the shared edge in both, the outline in neither", () => {
  const m = new Model(2);
  const [a, b, c, d, e, f] = [[0, 0], [40, 0], [40, 30], [0, 30], [80, 0], [80, 30]].map((p) => m.addPoint(p).name);
  const ab = m.addLine(a, b).name, bc = m.addLine(b, c).name, cd = m.addLine(c, d).name, da = m.addLine(d, a).name;
  const be = m.addLine(b, e).name, ef = m.addLine(e, f).name, fc = m.addLine(f, c).name;
  const loops = findLoops(m);
  assert.equal(loops.length, 2, loops.map((l) => describeLoop(l, loops)).join(" | "));
  assert.deepEqual(sorted(loops[0]), [ab, bc, cd, da].sort());
  assert.deepEqual(sorted(loops[1]), [bc, be, ef, fc].sort());
  assert.ok(loops.every((l) => close(l.area, 1200) && close(traced(m, l), 1200)));
  // The shared edge is walked one way by one face and the other way by the other.
  const way = (l: Loop) => l.members.find((x) => x.name === bc)!.reversed;
  assert.notEqual(way(loops[0]), way(loops[1]));
  assert.ok(loops.every((l) => l.parent === null), "side by side, neither inside the other");
});

test("a figure-eight is two loops, one each side of the vertex they share", () => {
  const m = new Model(2);
  const o = m.addPoint([0, 0]).name;
  const [l1, l2] = [[-30, 15], [-30, -15]].map((p) => m.addPoint(p).name);
  const [r1, r2] = [[30, -15], [30, 15]].map((p) => m.addPoint(p).name);
  const left = [m.addLine(o, l1), m.addLine(l1, l2), m.addLine(l2, o)].map((l) => l.name);
  const right = [m.addLine(o, r1), m.addLine(r1, r2), m.addLine(r2, o)].map((l) => l.name);
  const loops = findLoops(m);
  assert.equal(loops.length, 2);
  assert.deepEqual(sorted(loops[0]), left.sort());
  assert.deepEqual(sorted(loops[1]), right.sort());
  assert.ok(loops.every((l) => close(l.area, 450) && close(traced(m, l), 450)));
  assert.ok(loops.every((l) => l.parent === null));
});

test("a whole circle is a loop by itself: area πr², no ends", () => {
  const m = new Model(2);
  const c = m.addCircle(m.addPoint([5, 5]).name, 10).name;
  const [loop] = findLoops(m);
  assert.deepEqual(loop.members, [{ name: c, reversed: false, from: null, to: null }]);
  assert.ok(close(loop.area, 100 * Math.PI), `area ${loop.area}`);
  assert.ok(close(traced(m, loop), 100 * Math.PI, 1e-3));

  // In 3D, on a frame lying upside down in the default frame's plane: the
  // plane is the default's, so the circle is walked against its own way round.
  const n = new Model(3);
  axisFrame(n, "f");
  const [o, x, y] = [[0, 0, 0], [1, 0, 0], [0, -1, 0]].map((p) => n.addPoint(p).name);
  n.addFrame(o, x, y, "under");
  const ring = n.addCircle(n.addPoint([30, 0, 0]).name, 4, "under").name;
  const [flipped] = findLoops(n);
  assert.equal(flipped.plane.frame, "f");
  assert.deepEqual(flipped.members, [{ name: ring, reversed: true, from: null, to: null }]);
  assert.ok(close(flipped.area, 16 * Math.PI) && close(traced(n, flipped), 16 * Math.PI, 1e-3));
  const view: View = { ox: 400, oy: 300, scale: 2 };
  const found = findLoops(n);
  assert.equal(loopAt(n, view, ...worldToScreen(view, [31, 1, 0]), found), found[0], "a click inside it is inside it");
  assert.equal(loopAt(n, view, ...worldToScreen(view, [36, 0, 0]), found), null, "and one past its rim is not");
});

// --- islands and containment ------------------------------------------------------

test("a rectangle with an island circle is two loops, and the circle's parent is the rectangle", () => {
  const m = new Model(2);
  const { lines } = polygon(m, [[0, 0], [40, 0], [40, 30], [0, 30]]);
  const c = m.addCircle(m.addPoint([20, 15]).name, 5).name;
  const loops = findLoops(m);
  assert.equal(loops.length, 2);
  assert.deepEqual(names(loops[0]), lines);
  assert.deepEqual(names(loops[1]), [c]);
  assert.equal(loops[1].parent, 0, "the circle is inside the rectangle");
  assert.deepEqual(loops[0].children, [1]);
  assert.equal(loops[0].parent, null);
  assert.equal(describeLoop(loops[1], loops), `loop of ${c} in the plane facing (0, 0, 1), area 78.54, inside ${lines.join(",")}`);
});

test("an island joined to its outline by a bridge is still two loops, and the bridge is in neither", () => {
  const m = new Model(2);
  const outer = polygon(m, [[0, 0], [40, 0], [40, 40], [0, 40]]);
  const inner = polygon(m, [[10, 10], [20, 10], [20, 20], [10, 20]]);
  const bridge = m.addLine(outer.points[0], inner.points[0]).name;
  const loops = findLoops(m);
  assert.equal(loops.length, 2);
  assert.deepEqual(sorted(loops[0]), outer.lines.slice().sort());
  assert.deepEqual(sorted(loops[1]), inner.lines.slice().sort());
  assert.ok(!loops.some((l) => names(l).includes(bridge)));
  assert.equal(loops[1].parent, 0);
  assert.ok(close(loops[0].area, 1600) && close(loops[1].area, 100));
});

test("an island touching its outline at a vertex is two loops — the walk round the annulus is split there", () => {
  const m = new Model(2);
  const outer = polygon(m, [[0, 0], [40, 0], [40, 40], [0, 40]]);
  // A triangle inside the square, sharing its corner point.
  const t1 = m.addPoint([20, 10]).name, t2 = m.addPoint([10, 20]).name;
  const tri = [m.addLine(outer.points[0], t1), m.addLine(t1, t2), m.addLine(t2, outer.points[0])].map((l) => l.name);
  const loops = findLoops(m);
  assert.equal(loops.length, 2, loops.map((l) => describeLoop(l, loops)).join(" | "));
  assert.deepEqual(sorted(loops[0]), outer.lines.slice().sort());
  assert.deepEqual(sorted(loops[1]), tri.slice().sort());
  assert.ok(close(loops[0].area, 1600) && close(loops[1].area, 150));
  assert.ok(close(traced(m, loops[1]), 150), "the island is listed counter-clockwise too, though the annulus walked it the other way");
  assert.equal(loops[1].parent, 0, "touching at a point still counts as inside");
});

test("two rectangles that overlap, joined nowhere, are two loops and neither contains the other", () => {
  const m = new Model(2);
  polygon(m, [[0, 0], [40, 0], [40, 30], [0, 30]]);
  polygon(m, [[20, 10], [60, 10], [60, 40], [20, 40]]);
  const loops = findLoops(m);
  assert.equal(loops.length, 2);
  assert.ok(loops.every((l) => l.parent === null && l.children.length === 0));
});

// --- joined means held ----------------------------------------------------------------

/** A rectangle of four lines that share no points: eight points, two at each corner. */
function looseRectangle(m: Model): { lines: string[]; ends: string[][] } {
  const at = [[0, 0], [40, 0], [40, 30], [0, 30]];
  const ends = at.map((p, i) => [m.addPoint(p).name, m.addPoint(at[(i + 1) % 4]).name]);
  return { lines: ends.map(([a, b]) => m.addLine(a, b).name), ends };
}

test("joined means held: ends a coin holds together close a loop; ends that merely touch do not", () => {
  const held = new Model(2);
  const h = looseRectangle(held);
  for (let i = 0; i < 4; i++) coincident(held, h.ends[i][1], h.ends[(i + 1) % 4][0]);
  const loops = findLoops(held);
  assert.equal(loops.length, 1, "four coins, one loop");
  assert.ok(close(loops[0].area, 1200));
  assert.ok(chained(loops[0]));
  assert.equal(loops[0].members[0].to, h.ends[0][1], "each member names its own points, not the ones it is held to");

  // The same drawing with the last corner touching — the same coordinates, to
  // the last bit — and nothing holding it there.
  const near = new Model(2);
  const n = looseRectangle(near);
  for (let i = 0; i < 3; i++) coincident(near, n.ends[i][1], n.ends[(i + 1) % 4][0]);
  assert.deepEqual(near.coords(n.ends[3][1]), near.coords(n.ends[0][0]), "they sit on the same spot");
  assert.deepEqual(findLoops(near), [], "and they are not joined");
});

test("a coin chain joins: a corner held through a third point is still a corner", () => {
  const m = new Model(2);
  const r = looseRectangle(m);
  for (let i = 0; i < 3; i++) coincident(m, r.ends[i][1], r.ends[(i + 1) % 4][0]);
  const go = m.addPoint([0, 0]).name;
  coincident(m, r.ends[3][1], go);
  coincident(m, go, r.ends[0][0]);
  assert.equal(findLoops(m).length, 1);
});

test("a T is not a join: a line between two points held on a rectangle's edges does not split it", () => {
  const m = new Model(2);
  const { lines } = polygon(m, [[0, 0], [40, 0], [40, 30], [0, 30]]);
  const p = m.addPoint([20, 0]).name, q = m.addPoint([20, 30]).name;
  pointOnLine(m, p, lines[0]);
  pointOnLine(m, q, lines[2]);
  m.addLine(p, q);
  const loops = findLoops(m);
  assert.equal(loops.length, 1, "the rectangle, whole");
  assert.deepEqual(names(loops[0]), lines);
});

test("a line hanging off a corner is no part of anything", () => {
  const m = new Model(2);
  const { lines, points } = polygon(m, [[0, 0], [40, 0], [40, 30], [0, 30]]);
  m.addLine(points[2], m.addPoint([60, 50]).name);
  // One that hangs *into* the rectangle and out the other side, too: it is on
  // no cycle, so it crosses nothing that matters.
  m.addLine(points[0], m.addPoint([70, 20]).name);
  const loops = findLoops(m);
  assert.equal(loops.length, 1);
  assert.deepEqual(names(loops[0]), lines);
});

// --- what is not a loop -------------------------------------------------------------------

test("a self-crossing outline — a bow-tie — is no loop, and neither is a joined pair that overlaps", () => {
  // Lopsided on purpose: a symmetric bow-tie's two lobes cancel to no area at
  // all and would vanish for that reason alone. This one's net area is 400,
  // and without the crossing rule it came back as a "loop" of that area.
  const bow = new Model(2);
  polygon(bow, [[0, 0], [40, 30], [40, 0], [0, 10]]);
  assert.deepEqual(findLoops(bow), []);

  // A square and a diamond sharing a corner point, their edges crossing: with
  // nothing joining them where they cross, the faces are not the regions the
  // drawing shows — the deliberate limit, pinned here so it is a decision.
  const over = new Model(2);
  const sq = polygon(over, [[0, 0], [40, 0], [40, 40], [0, 40]]);
  const [e, f, g] = [[60, 20], [20, 60], [-20, 20]].map((p) => over.addPoint(p).name);
  over.addLine(sq.points[0], e); over.addLine(e, f); over.addLine(f, g); over.addLine(g, sq.points[0]);
  assert.deepEqual(findLoops(over), [], "joined at a corner and crossing each other: no loops");
});

test("a line drawn twice is a sliver, not a loop, and the face beside it is still one loop", () => {
  const m = new Model(2);
  const { lines, points } = polygon(m, [[0, 0], [40, 0], [40, 30], [0, 30]]);
  const twin = m.addLine(points[0], points[1]).name;
  const loops = findLoops(m);
  assert.equal(loops.length, 1);
  const edge = names(loops[0]).filter((n) => n === lines[0] || n === twin);
  assert.equal(edge.length, 1, `one copy of the edge, not both: ${names(loops[0])}`);
  assert.ok(close(loops[0].area, 1200));
});

test("a line and an arc between the same two points are a loop — a D", () => {
  const m = new Model(2);
  const [c, s, e] = [[0, 0], [10, 0], [-10, 0]].map((p) => m.addPoint(p).name);
  const arc = m.addArc(c, s, e, 10).name; // counter-clockwise: the upper half
  const line = m.addLine(e, s).name;
  const [loop] = findLoops(m);
  assert.deepEqual(names(loop), [arc, line]);
  assert.ok(close(loop.area, 50 * Math.PI), `area ${loop.area}`);
  assert.ok(close(traced(m, loop), 50 * Math.PI, 1e-3));
});

test("two arcs leaving a vertex tangent to each other are told apart by how they bend", () => {
  // Two circles tangent to the x axis at the origin, one inside the other;
  // an arc of each leaves the origin heading +x. With a triangle hung below,
  // the origin has four edges and the two arcs tie on direction — only their
  // curvature says which is nearer counter-clockwise.
  const m = new Model(2);
  const o = m.addPoint([0, 0]).name;
  const c1 = m.addPoint([0, 10]).name, c2 = m.addPoint([0, 20]).name;
  const q1 = m.addPoint([10, 10]).name, q2 = m.addPoint([20 * Math.sin(Math.PI / 3), 10]).name;
  const tight = m.addArc(c1, o, q1, 10).name;   // a quarter of r = 10
  const wide = m.addArc(c2, o, q2, 20).name;    // a sixth of r = 20
  const lid = m.addLine(q2, q1).name;
  const [t1, t2] = [[10, -10], [-10, -10]].map((p) => m.addPoint(p).name);
  const tri = [m.addLine(o, t1), m.addLine(t1, t2), m.addLine(t2, o)].map((l) => l.name);
  const loops = findLoops(m);
  assert.equal(loops.length, 2, loops.map((l) => describeLoop(l, loops)).join(" | "));
  const sliver = loops.find((l) => names(l).includes(tight))!;
  assert.deepEqual(sliver && sorted(sliver), [tight, wide, lid].sort());
  const want = traced(m, sliver);
  assert.ok(want > 40 && close(sliver.area, want, 1e-3), `area ${sliver.area}, traced ${want}`);
  const below = loops.find((l) => names(l).includes(tri[0]))!;
  assert.ok(close(below.area, 100));
});

// --- 3D: planes, frames, and what is out of them --------------------------------------

test("a box's twelve edges are its six faces — and the belt round its middle is no loop", () => {
  const m = new Model(3);
  const p = (x: number, y: number, z: number) => m.addPoint([x * 10, y * 10, z * 10]).name;
  const v = [p(0, 0, 0), p(1, 0, 0), p(1, 1, 0), p(0, 1, 0), p(0, 0, 1), p(1, 0, 1), p(1, 1, 1), p(0, 1, 1)];
  for (const [a, b] of [[0, 1], [1, 2], [2, 3], [3, 0], [4, 5], [5, 6], [6, 7], [7, 4], [0, 4], [1, 5], [2, 6], [3, 7]]) {
    m.addLine(v[a], v[b]);
  }
  const loops = findLoops(m);
  assert.equal(loops.length, 6);
  assert.ok(loops.every((l) => l.members.length === 4 && close(l.area, 100)));
  const normals = loops.map((l) => l.plane.normal.map((x) => Math.round(x)).join(","));
  assert.deepEqual(normals.sort(), ["0,0,1", "0,0,1", "0,1,0", "0,1,0", "1,0,0", "1,0,0"]);
  assert.ok(loops.every((l) => l.parent === null && l.plane.frame === null));
});

test("on a tilted frame, the loop's plane is the frame's, and area and orientation are the closed form", async () => {
  await loadKernel();
  const m = new Model(3);
  const t = tiltedFrame(m);
  const corners = [[5, 5], [45, 5], [45, 35], [5, 35]].map(([u, w]) => t.at(u, w));
  const { lines } = polygon(m, corners);
  let [loop] = findLoops(m);
  assert.equal(loop.plane.frame, t.name);
  assert.deepEqual(loop.plane.origin, t.origin);
  for (const [got, want] of [[loop.plane.u, t.ux], [loop.plane.v, t.uy], [loop.plane.normal, t.uz]]) {
    assert.ok(got.every((x, i) => close(x, want[i], 1e-12)), `${got} vs ${want}`);
  }
  assert.deepEqual(names(loop), lines, "counter-clockwise about the frame's +z, as drawn");
  assert.ok(close(loop.area, 1200, 1e-9) && close(traced(m, loop), 1200, 1e-9));

  // A fillet on it, in the frame.
  const arc = fillet(m, lines[3], lines[0], 6, t.name);
  m.solve();
  [loop] = findLoops(m);
  assert.ok(names(loop).includes(arc));
  const want = 1200 - 36 * (1 - Math.PI / 4);
  assert.ok(close(loop.area, want, 1e-6), `area ${loop.area}, expected ${want}`);
  assert.ok(close(traced(m, loop), want, 1e-4));
  assert.equal(describeLoop(loop, [loop]), `loop of ${names(loop).join(",")} in ${t.name}, area ${Number(want.toFixed(3))}`);
});

test("a loop in no frame's plane: an arc's frame orients it, or else the normal is the one pointing up", () => {
  const m = new Model(3);
  const t = tiltedFrame(m);
  // Parallel to the frame but five units off it: the frame's plane is not this one.
  polygon(m, [[0, 0], [20, 0], [20, 10], [0, 10]].map(([u, w]) => t.at(u, w, 5)));
  // Level, at z = 7, with no frame anywhere near.
  polygon(m, [[100, 0, 7], [120, 0, 7], [120, 10, 7], [100, 10, 7]]);
  const [off, level] = findLoops(m);
  assert.equal(off.plane.frame, null);
  assert.ok(Math.abs(Math.abs(dot(off.plane.normal, t.uz)) - 1) < 1e-12, "parallel to the frame, one way or the other");
  const big = off.plane.normal.reduce((k, x, i) => (Math.abs(x) > Math.abs(off.plane.normal[k]) ? i : k), 0);
  assert.ok(off.plane.normal[big] > 0, "the way whose largest component is positive");
  assert.ok(close(off.area, 200, 1e-9));
  assert.deepEqual(level.plane.normal, [0, 0, 1]);
  assert.equal(describeLoop(level, [off, level]).replace(/^loop of [^ ]+ /, ""), "in the plane facing (0, 0, 1), area 200");

  // An arc in a frameless plane lends that plane its own frame's axes.
  const n = new Model(3);
  axisFrame(n, "f", [0, 0, 0]);
  const [c, s, e] = [[0, 0, 9], [10, 0, 9], [-10, 0, 9]].map((p) => n.addPoint(p).name);
  n.addArc(c, s, e, 10, "f");
  n.addLine(e, s);
  const [d] = findLoops(n);
  assert.equal(d.plane.frame, null, "f's plane is z = 0; this is z = 9");
  assert.deepEqual(d.plane.normal, [0, 0, 1]);
  assert.deepEqual(d.plane.origin, [0, 0, 9], "through the arc's centre");
});

test("a near-loop out of its plane is no loop; inside the stated tolerance it is", () => {
  const lifted = (dz: number) => {
    const m = new Model(3);
    polygon(m, [[0, 0, 0], [40, 0, 0], [40, 30, dz], [0, 30, 0]]);
    return findLoops(m);
  };
  assert.deepEqual(lifted(1e-3), [], "a thousandth off: four lines in no one plane");
  assert.equal(lifted(1e-9).length, 1, "a billionth off: the solver's noise, inside a millionth of the size");
});

test("an arc whose frame disagrees with the plane its points lie in is no part of a loop there", () => {
  const slice = (frame: (m: Model) => string) => {
    const m = new Model(3);
    const name = frame(m);
    const [c, s, e] = [[0, 0, 0], [10, 0, 0], [0, 10, 0]].map((p) => m.addPoint(p).name);
    m.addArc(c, s, e, 10, name);
    m.addLine(e, c);
    m.addLine(c, s);
    return findLoops(m);
  };
  // In the kernel's x–y plane, and an arc on a frame lying in it: a quarter disc.
  const flat = slice((m) => axisFrame(m, "f"));
  assert.equal(flat.length, 1);
  assert.ok(close(flat[0].area, 25 * Math.PI), `area ${flat[0].area}`);
  // The same points, the arc naming a frame stood on its edge (+z along x):
  // its points lie in z = 0, its frame says it is drawn across it.
  const across = slice((m) => {
    const [o, x, y] = [[0, 0, 0], [0, 1, 0], [0, 0, 1]].map((p) => m.addPoint(p).name);
    return m.addFrame(o, x, y, "wall").name;
  });
  assert.deepEqual(across, []);
});

test("a model with no plane to speak of is refused, by name", () => {
  assert.throws(() => findLoops(new Model(4)), /loops lie in a plane, in a 2D or 3D model — this one is 4D/);
});

// --- read-only -----------------------------------------------------------------------

test("loops() lists them, and reads only: no journal entry, no name claimed, the file unchanged", () => {
  const m = new Model(3);
  axisFrame(m);
  const { lines } = polygon(m, [[0, 0], [40, 0], [40, 30], [0, 30]].map(([x, y]) => [x, y, 0]));
  const c = m.addCircle(m.addPoint([20, 15, 0]).name, 5, "f").name;
  const scope = neocadScope({ model: m }) as Record<string, (...a: unknown[]) => unknown>;
  const file = save(m);
  const journal = m.journal.length;
  const listed = scope.loops() as string[];
  assert.deepEqual(listed, [
    `loop of ${lines.join(",")} in f, area 1200`,
    `loop of ${c} in f, area 78.54, inside ${lines.join(",")}`,
  ]);
  assert.equal(m.journal.length, journal, "nothing journalled");
  assert.equal(save(m), file, "the saved file is byte for byte what it was");
  // Four corners and the circle's centre are p1–p5 (the fixture frame's points are named).
  assert.equal(scope.pt(1, 1, 1), "p6", "the next point is the one it would have been");
  assert.equal(m.relations.size, 0);
  assert.match(scope.help() as string, /loops\(\)/);
});

// --- loopAt ------------------------------------------------------------------------

const top: View = { ox: 400, oy: 300, scale: 2 };
const pixel = (view: View, w: number[]) => worldToScreen(view, w);

test("a click inside a rectangle is in it; a click outside is in nothing", () => {
  const m = new Model(2);
  polygon(m, [[0, 0], [40, 0], [40, 30], [0, 30]]);
  const loops = findLoops(m);
  assert.equal(loopAt(m, top, ...pixel(top, [20, 15]), loops), loops[0], "one of the loops it was given");
  assert.equal(loopAt(m, top, ...pixel(top, [60, 15])), null);
  assert.equal(loopAt(m, top, ...pixel(top, [39.9, 29.9]))?.area, 1200, "just inside the corner");
});

test("a click on an island picks the island — the innermost wins, which nearest-first could not say", () => {
  const m = new Model(3);
  axisFrame(m);
  polygon(m, [[0, 0, 0], [40, 0, 0], [40, 30, 0], [0, 30, 0]]);
  m.addCircle(m.addPoint([20, 15, 0]).name, 5, "f");
  const loops = findLoops(m);
  // The two are coplanar: the click meets both at the same point, the same
  // depth exactly, and the rectangle is listed first. Only containment decides.
  assert.equal(loops[0].plane, loops[1].plane);
  assert.equal(loopAt(m, top, ...pixel(top, [21, 16]), loops), loops[1], "on the island");
  assert.equal(loopAt(m, top, ...pixel(top, [5, 5]), loops), loops[0], "between the island and the outline");
  // Containment outranks depth, not merely ties with it: the outline reported
  // a ten-thousandth nearer — the kind of difference noise makes, far past the
  // depth tie — still loses to the island it holds.
  const nudged = loops.map((l, i) => i === 0
    ? { ...l, plane: { ...l.plane, origin: l.plane.origin.map((x, k) => x + 1e-4 * l.plane.normal[k]) } }
    : l);
  assert.equal(loopAt(m, top, ...pixel(top, [21, 16]), nudged), nudged[1], "the contained loop wins over a merely-nearer one");

  // A rectangle ten units nearer, over the same spot: across planes the
  // nearest wins — the island is innermost in its own plane, not in this one.
  polygon(m, [[10, 5, 10], [30, 5, 10], [30, 25, 10], [10, 25, 10]]);
  const more = findLoops(m);
  assert.equal(more.length, 3);
  const front = more.find((l) => close(l.area, 400))!;
  assert.equal(loopAt(m, top, ...pixel(top, [21, 16]), more), front, "seen from above, the nearer plane");
  // From below, the sketch is nearer, and its island wins again.
  const below: View = { ox: 400, oy: 300, scale: 2, right: [1, 0, 0], up: [0, -1, 0] };
  assert.equal(loopAt(m, below, ...pixel(below, [21, 16, 0]), more), more.find((l) => close(l.area, 25 * Math.PI)));
});

test("a loop seen edge-on has no inside: under a pixel thick it is skipped, a few pixels and it is not", () => {
  // A 40 × 30 rectangle in a plane tipped nearly upright, seen from above at
  // 3 px a unit: its 30-unit side shows 90·cos(tip) pixels wide.
  const thick = (px: number) => {
    const m = new Model(3);
    const c = px / 90;
    const s = Math.sqrt(1 - c * c);
    polygon(m, [[0, 0], [40, 0], [40, 30], [0, 30]].map(([x, y]) => [x, y * c, y * s]));
    const view: View = { ox: 400, oy: 300, scale: 3 };
    return loopAt(m, view, ...worldToScreen(view, [20, 15 * c, 15 * s]));
  };
  assert.equal(thick(0.5), null, "half a pixel: edge-on");
  assert.ok(thick(3), "three pixels: a sliver, but one with an inside");
});

test("in a turned view a click lands on the tilted rectangle where it is drawn", () => {
  const m = new Model(3);
  const t = tiltedFrame(m);
  polygon(m, [[5, 5], [45, 5], [45, 35], [5, 35]].map(([u, w]) => t.at(u, w)));
  const view = orbitBy({ ox: 400, oy: 300, scale: 3 }, 0.6, -0.4);
  const loops = findLoops(m);
  assert.equal(loopAt(m, view, ...worldToScreen(view, t.at(25, 20)), loops), loops[0]);
  assert.equal(loopAt(m, view, ...worldToScreen(view, t.at(50, 20)), loops), null, "beside it");
});
