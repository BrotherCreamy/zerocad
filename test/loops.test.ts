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
import { Model, spanOf } from "../src/model.ts";
import { coincident, midpoint } from "../src/relations/basic.ts";
import { onCircle, pointOnLine } from "../src/relations/geometry.ts";
import { fillet, standsFor } from "../src/operations.ts";
import { neocadScope } from "../src/replenv.ts";
import { save } from "../src/persist.ts";
import { describeLoop, findLoops, isPortion, isVirtual, loopAt, memberLabel, type Loop } from "../src/loops.ts";
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
 * clockwise, this comes out negative. A member that is part of its entity is
 * walked over its `span` — fractions of the entity from its own start (a
 * line's first point, an arc's start, a circle's frame's +x).
 */
function traced(m: Model, loop: Loop): number {
  const { origin, u, v } = loop.plane;
  const flat = (w: number[]) => [dot(sub(w, origin), u), dot(sub(w, origin), v)];
  const pts: number[][] = [];
  for (const mem of loop.members) {
    const e = m.entities.get(mem.name)!;
    const [s0, s1] = mem.span ?? [0, 1];
    if (e.kind === "line") {
      const [a, b] = e.refs.map((p) => m.coords(p));
      const t = mem.reversed ? s1 : s0;
      pts.push(flat(a.map((x, i) => x + t * (b[i] - x))));
      continue;
    }
    if (e.kind !== "arc" && e.kind !== "circle") throw new Error("not a curve");
    const c = flat(m.coords(e.center));
    const r = m.radius(e.name);
    // Which way round the curve's own normal turns it, seen in this plane.
    const own = e.normal === undefined ? 1 : Math.sign(dot(m.normalOf(e.name), loop.plane.normal));
    const angle = (p: string) => { const q = flat(m.coords(p)); return Math.atan2(q[1] - c[1], q[0] - c[0]); };
    let a0: number, sweep: number;
    if (e.kind === "circle") {
      // From the circle's own +x: the first of the two directions its normal
      // spans its plane with in 3D (`spanOf`), the drawing's x in 2D.
      const x = e.normal === undefined ? [1, 0, 0] : spanOf(m.normalOf(e.name))[0];
      a0 = Math.atan2(dot(x, v), dot(x, u));
      sweep = 2 * Math.PI * own;
    } else {
      a0 = angle(e.start);
      sweep = own * (angle(e.end) - a0);
      while (sweep < 0) sweep += 2 * Math.PI;
      sweep *= own;
    }
    a0 += s0 * sweep;
    sweep *= s1 - s0;
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
  const [s0, s1] = [standsFor(m, lines[0]), standsFor(m, lines[1])];
  assert.deepEqual(sorted(loop), [arc, s0, s1, lines[2], lines[3]].sort(), "the two edges set aside are construction; the shorter lines in their place, and the arc");
  const at = names(loop).indexOf(arc), n = loop.members.length;
  assert.deepEqual([names(loop)[(at + n - 1) % n], names(loop)[(at + 1) % n]].sort(), [s0, s1].sort(), "the arc sits between the two lines it rounds");
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
  assert.deepEqual(loop.members, [{ name: c, reversed: false, from: null, to: null, span: null }]);
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
  assert.deepEqual(flipped.members, [{ name: ring, reversed: true, from: null, to: null, span: null }]);
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

test("two rectangles that overlap, joined nowhere, are three regions cut where their edges cross, and none holds another", () => {
  const m = new Model(2);
  const a = polygon(m, [[0, 0], [40, 0], [40, 30], [0, 30]]);
  const b = polygon(m, [[20, 10], [60, 10], [60, 40], [20, 40]]);
  const loops = findLoops(m);
  // Joined nowhere, but crossing at two points: each one's own part and the
  // overlap, side by side — Onshape's three regions.
  assert.equal(loops.length, 3, loops.map((l) => describeLoop(l, loops)).join(" | "));
  assert.deepEqual(loops.map((l) => Math.round(l.area)), [800, 400, 800]);
  assert.ok(loops.every((l) => close(traced(m, l), l.area, 1e-6)));
  const overlap = loops[1];
  const [x1, x2] = [`${a.lines[1]}×${b.lines[0]}`, `${a.lines[2]}×${b.lines[3]}`];
  assert.deepEqual(overlap.members.map(memberLabel), [
    `${a.lines[1]}[${x1}→${a.points[2]}]`, `${a.lines[2]}[${a.points[2]}→${x2}]`,
    `${b.lines[3]}[${x2}→${b.points[0]}]`, `${b.lines[0]}[${b.points[0]}→${x1}]`,
  ], "the overlap: a corner of each, and the two crossings");
  assert.ok([x1, x2].every((x) => isVirtual(m, x)) && !isVirtual(m, a.points[2]));
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

test("a line hanging off a corner is no part of anything — until it crosses an edge, and cuts the rectangle there", () => {
  const m = new Model(2);
  const { lines, points } = polygon(m, [[0, 0], [40, 0], [40, 30], [0, 30]]);
  m.addLine(points[2], m.addPoint([60, 50]).name);
  let loops = findLoops(m);
  assert.equal(loops.length, 1);
  assert.deepEqual(names(loops[0]), lines);
  // One that hangs *into* the rectangle from a corner and out through the far
  // edge: the part inside joins the corner to the crossing, and the rectangle
  // is two regions; the stub outside is on no cycle.
  const into = m.addLine(points[0], m.addPoint([70, 20]).name).name;
  loops = findLoops(m);
  assert.equal(loops.length, 2, loops.map((l) => describeLoop(l, loops)).join(" | "));
  const crossing = 40 * 20 / 70; // where y = 20x/70 meets x = 40
  assert.ok(close(loops[0].area, 20 * crossing) && close(loops[1].area, 1200 - 20 * crossing));
  assert.deepEqual(loops[0].members.map(memberLabel), [lines[0], `${lines[1]}[${points[1]}→${lines[1]}×${into}]`, `${into}[${points[0]}→${lines[1]}×${into}]`]);
});

// --- Ts and crossings: where a region is cut ------------------------------------------
//
// The cases `docs/plans/regions-split.md` lists, each drawn twice — in a 2D
// model, and on a frame tipped and spun off every kernel axis — from the same
// (u, v) numbers, so one set of closed forms checks both.

/** A drawing surface, and how to draw on it in its own (u, v). */
interface Sheet {
  label: string;
  m: Model;
  at: (u: number, v: number) => number[];
  /** A line between two fresh points. */
  seg: (a: number[], b: number[]) => string;
  circle: (u: number, v: number, r: number) => string;
  /** A view the sketch is seen in, for `loopAt` — square-on in 2D, turned for the tilted one. */
  view: View;
}

function sheets(): Sheet[] {
  const make = (label: string, m: Model, at: (u: number, v: number) => number[], frame: string | null, view: View): Sheet => ({
    label, m, at, view,
    seg: (a, b) => m.addLine(m.addPoint(at(a[0], a[1])).name, m.addPoint(at(b[0], b[1])).name).name,
    circle: (u, v, r) => m.addCircle(m.addPoint(at(u, v)).name, r, frame ?? undefined).name,
  });
  const tilted = new Model(3);
  const t = tiltedFrame(tilted);
  // The sheet's own axes are the two its normal spans the plane with
  // (`spanOf`): what a circle on it is laid out from, since a circle carries
  // its own normal and no frame's +x (docs/plans/frameless-curves.md), so a
  // seam falls where it does in 2D and a span reads the same on both sheets.
  const [U, V] = spanOf(t.uz);
  const on = (u: number, v: number) => t.origin.map((o, i) => o + u * U[i] + v * V[i]);
  return [
    make("in 2D", new Model(2), (u, v) => [u, v], null, { ox: 400, oy: 300, scale: 2 }),
    make("on a tilted plane", tilted, on, t.name, orbitBy({ ox: 400, oy: 300, scale: 3 }, 0.6, -0.4)),
  ];
}

const RECT = [[0, 0], [40, 0], [40, 30], [0, 30]];
const rectOn = (s: Sheet) => polygon(s.m, RECT.map(([u, v]) => s.at(u, v)));
const spanNear = (got: [number, number] | null, want: [number, number]) =>
  got !== null && close(got[0], want[0], 1e-9) && close(got[1], want[1], 1e-9);
/** The loop under the sketch's point (u, v), as an index into `loops`, or −1. */
const under = (s: Sheet, loops: Loop[], u: number, v: number) =>
  loops.indexOf(loopAt(s.m, s.view, ...worldToScreen(s.view, s.at(u, v)), loops)!);
const listing = (loops: Loop[]) => loops.map((l) => describeLoop(l, loops)).join(" | ");

test("a rectangle with one line across it is two regions, cut where the line crosses — and a click picks either", () => {
  for (const s of sheets()) {
    const { lines, points } = rectOn(s);
    const across = s.seg([15, -10], [15, 40]);
    const loops = findLoops(s.m);
    const what = `${s.label}: ${listing(loops)}`;
    assert.equal(loops.length, 2, what);
    const [x1, x3] = [`${lines[0]}×${across}`, `${lines[2]}×${across}`];
    assert.deepEqual(loops[0].members.map(memberLabel),
      [`${lines[0]}[${points[0]}→${x1}]`, `${across}[${x1}→${x3}]`, `${lines[2]}[${x3}→${points[3]}]`, lines[3]], what);
    assert.deepEqual(loops[1].members.map(memberLabel),
      [`${lines[0]}[${x1}→${points[1]}]`, lines[1], `${lines[2]}[${points[2]}→${x3}]`, `${across}[${x1}→${x3}]`], what);
    assert.ok(close(loops[0].area, 450) && close(loops[1].area, 750), what);
    assert.ok(loops.every((l) => close(traced(s.m, l), l.area, 1e-6)), `${s.label}: walked out of the model, each runs counter-clockwise`);
    // Spans are fractions of each entity from its own start, whichever way it is walked.
    const [bottom, stem, topEdge] = loops[0].members;
    assert.ok(spanNear(bottom.span, [0, 0.375]) && spanNear(stem.span, [0.2, 0.8]) && spanNear(topEdge.span, [0.625, 1]), what);
    assert.equal(loops[0].members[3].span, null, "the left edge is all of itself");
    assert.ok(isVirtual(s.m, x1) && isVirtual(s.m, x3) && !isVirtual(s.m, points[0]));
    assert.ok(isPortion(s.m, bottom) && !isPortion(s.m, loops[0].members[3]));
    assert.ok(loops.every((l) => l.parent === null), "side by side");
    assert.equal(under(s, loops, 5, 15), 0, `${s.label}: left of the line`);
    assert.equal(under(s, loops, 30, 15), 1, `${s.label}: right of it`);
    assert.equal(under(s, loops, 15, 35), -1, `${s.label}: on the line past the rectangle, inside nothing`);
  }
});

test("loops() lists a portion by the vertices it runs between, crossings by the edges that make them", () => {
  const m = new Model(3);
  axisFrame(m);
  polygon(m, RECT.map(([x, y]) => [x, y, 0]));
  m.addLine(m.addPoint([15, -10, 0]).name, m.addPoint([15, 40, 0]).name);
  const scope = neocadScope({ model: m }) as Record<string, (...a: unknown[]) => unknown>;
  assert.deepEqual(scope.loops(), [
    "loop of l1[p1→l1×l5],l5[l1×l5→l3×l5],l3[l3×l5→p4],l4 in f, area 450",
    "loop of l1[l1×l5→p2],l2,l3[p3→l3×l5],l5[l1×l5→l3×l5] in f, area 750",
  ]);
});

test("two lines crossing across a rectangle make four regions, all meeting at their crossing", () => {
  for (const s of sheets()) {
    rectOn(s);
    const up = s.seg([15, -10], [15, 40]), level = s.seg([-10, 10], [50, 10]);
    const loops = findLoops(s.m);
    const what = `${s.label}: ${listing(loops)}`;
    assert.equal(loops.length, 4, what);
    assert.deepEqual(loops.map((l) => Math.round(l.area * 1e6) / 1e6), [150, 250, 500, 300], what);
    assert.ok(loops.every((l) => close(traced(s.m, l), l.area, 1e-6)));
    const centre = `${up}×${level}`;
    assert.ok(loops.every((l) => l.members.some((x) => x.from === centre)), `${s.label}: every quarter has the centre as a corner`);
    for (const [u, v, i] of [[5, 5, 0], [30, 5, 1], [30, 20, 2], [5, 20, 3]]) assert.equal(under(s, loops, u, v), i, `${s.label}: (${u}, ${v})`);
  }
});

test("a line held on a rectangle's edges at both ends — a T each side — splits it there, the held points its corners", () => {
  for (const s of sheets()) {
    const { lines, points } = rectOn(s);
    const p = s.m.addPoint(s.at(15, 0)).name, q = s.m.addPoint(s.at(15, 30)).name;
    pointOnLine(s.m, p, lines[0]);
    pointOnLine(s.m, q, lines[2]);
    const stem = s.m.addLine(p, q).name;
    const loops = findLoops(s.m);
    const what = `${s.label}: ${listing(loops)}`;
    assert.deepEqual(loops.map((l) => l.members.map(memberLabel)), [
      [`${lines[0]}[${points[0]}→${p}]`, stem, `${lines[2]}[${q}→${points[3]}]`, lines[3]],
      [`${lines[0]}[${p}→${points[1]}]`, lines[1], `${lines[2]}[${points[2]}→${q}]`, stem],
    ], what);
    assert.ok(close(loops[0].area, 450) && close(loops[1].area, 750), what);
    assert.ok(loops.every((l) => l.members.every((x) => !isVirtual(s.m, x.from!) && !isVirtual(s.m, x.to!))), "nothing virtual: a T is held");
    assert.equal(under(s, loops, 5, 15), 0);
    assert.equal(under(s, loops, 30, 15), 1);
  }
});

test("a T counts through a coin chain: the stem's own ends held to points held on the edges", () => {
  for (const s of sheets()) {
    const { lines } = rectOn(s);
    const [p, q, a, b] = [[15, 0], [15, 30], [15, 0], [15, 30]].map(([u, v]) => s.m.addPoint(s.at(u, v)).name);
    pointOnLine(s.m, p, lines[0]);
    pointOnLine(s.m, q, lines[2]);
    const stem = s.m.addLine(a, b).name;
    coincident(s.m, a, p);
    coincident(s.m, b, q);
    const loops = findLoops(s.m);
    assert.equal(loops.length, 2, `${s.label}: ${listing(loops)}`);
    // The edge is cut at the held point, and the stem runs between its own.
    assert.deepEqual(loops[0].members.slice(0, 2).map((x) => [x.name, x.to]), [[lines[0], p], [stem, b]]);
    assert.ok(close(loops[0].area, 450) && close(loops[1].area, 750));
  }
});

test("a lens of two crossing circles is three regions — two crescents and the lens — each picked by a click", () => {
  const r = 10, d = 12;
  const lens = 2 * r * r * Math.acos(d / (2 * r)) - (d / 2) * Math.sqrt(4 * r * r - d * d);
  const crescent = Math.PI * r * r - lens;
  for (const s of sheets()) {
    const c1 = s.circle(20, 15, r), c2 = s.circle(20 + d, 15, r);
    const loops = findLoops(s.m);
    const what = `${s.label}: ${listing(loops)}`;
    assert.equal(loops.length, 3, what);
    assert.ok(close(loops[0].area, crescent, 1e-9) && close(loops[1].area, lens, 1e-9) && close(loops[2].area, crescent, 1e-9), what);
    assert.ok(loops.every((l) => close(traced(s.m, l), l.area, 1e-4)));
    // Crossed twice, so numbered along c1 from its own +x: #1 above, #2 below.
    const [k1, k2] = [`${c1}×${c2}#1`, `${c1}×${c2}#2`];
    assert.deepEqual(loops.map((l) => l.members.map(memberLabel)), [
      [`${c1}[${k1}→${k2}]`, `${c2}[${k1}→${k2}]`],
      [`${c1}[${k2}→${k1}]`, `${c2}[${k1}→${k2}]`],
      [`${c1}[${k2}→${k1}]`, `${c2}[${k2}→${k1}]`],
    ], what);
    // c1's piece inside c2 runs across c1's seam (its +x): measured past 1.
    const seam = Math.atan2(8, 6) / (2 * Math.PI);
    assert.ok(spanNear(loops[1].members[0].span, [1 - seam, 1 + seam]), `${s.label}: ${JSON.stringify(loops[1].members[0].span)}`);
    assert.ok(loops.every((l) => l.parent === null));
    assert.equal(under(s, loops, 12, 15), 0, `${s.label}: the left crescent`);
    assert.equal(under(s, loops, 26, 15), 1, `${s.label}: the lens`);
    assert.equal(under(s, loops, 40, 15), 2, `${s.label}: the right crescent`);
  }
});

test("a circle that only touches an edge splits nothing — nor one a solve left a hair over it; a thousandth over is a crossing", () => {
  for (const s of sheets()) {
    const { lines } = rectOn(s);
    const c = s.circle(20, 20, 10);
    let loops = findLoops(s.m);
    assert.deepEqual(loops.map(names), [lines, [c]], `${s.label}: tangent to the top edge — ${listing(loops)}`);
    assert.equal(loops[1].parent, 0, "touching at a point is still inside");
  }
  // A tangency within the length tolerance, as a solve leaves one: a
  // billionth over. Measured as a distance, not as how far apart the roots
  // are — those lie √(2rδ) either side of the touch, ~1.4e-4 here, past any
  // tolerance a length could have.
  for (const [over, regions] of [[1e-9, 2], [1e-3, 3]] as const) {
    for (const s of sheets()) {
      rectOn(s);
      s.circle(20, 20, 10 + over);
      const loops = findLoops(s.m);
      assert.equal(loops.length, regions, `${s.label}, ${over} over: ${listing(loops)}`);
      assert.ok(loops.every((l) => close(traced(s.m, l), l.area, 1e-3)), "traced samples a whole circle: a thousandth is its resolution");
    }
  }
});

test("two lines whose crossing lies beyond an end split nothing, nor does an end resting on an edge that nothing holds there", () => {
  for (const s of sheets()) {
    const { lines } = rectOn(s);
    s.seg([15, -10], [15, -2]); // pointing at the bottom edge, short of it
    s.seg([45, 15], [60, 15]); // beside the right edge, pointing away
    s.seg([25, -10], [25, 0]); // its end exactly on the bottom edge — touching, not held
    const loops = findLoops(s.m);
    assert.equal(loops.length, 1, `${s.label}: ${listing(loops)}`);
    assert.deepEqual(names(loops[0]), lines);
    assert.ok(loops[0].members.every((x) => x.span === null));
  }
});

test("a stray line inside a region splits nothing, and a stub poking out through one edge is on no cycle: the loop is listed whole", () => {
  for (const s of sheets()) {
    const { lines } = rectOn(s);
    s.seg([10, 10], [30, 20]);
    s.seg([30, 15], [50, 15]); // crosses the right edge once, and goes nowhere
    const loops = findLoops(s.m);
    assert.equal(loops.length, 1, `${s.label}: ${listing(loops)}`);
    assert.deepEqual(loops[0].members.map(memberLabel), lines, "the right edge cut at the crossing, and joined up again");
    assert.ok(close(loops[0].area, 1200));
  }
});

test("a point held on an edge with nothing else there, or a T whose stem goes nowhere, is no corner: the loop is listed whole", () => {
  for (const s of sheets()) {
    const { lines } = rectOn(s);
    const free = s.m.addPoint(s.at(10, 0)).name;
    pointOnLine(s.m, free, lines[0]);
    const foot = s.m.addPoint(s.at(20, 30)).name;
    midpoint(s.m, foot, lines[2]); // the line form: held at the top edge's middle
    s.m.addLine(foot, s.m.addPoint(s.at(20, 15)).name);
    const loops = findLoops(s.m);
    assert.equal(loops.length, 1, `${s.label}: ${listing(loops)}`);
    assert.deepEqual(loops[0].members.map(memberLabel), lines);
  }
});

test("a chord held on a circle cuts it in two; the piece across the circle's seam is measured past 1", () => {
  const r = 10, a = Math.PI / 3;
  const segment = (r * r / 2) * (2 * a - Math.sin(2 * a));
  for (const s of sheets()) {
    const c = s.circle(20, 15, r);
    const [p, q] = [a, -a].map((t) => s.m.addPoint(s.at(20 + r * Math.cos(t), 15 + r * Math.sin(t))).name);
    onCircle(s.m, p, c);
    onCircle(s.m, q, c);
    const chord = s.m.addLine(p, q).name;
    const loops = findLoops(s.m);
    const what = `${s.label}: ${listing(loops)}`;
    assert.equal(loops.length, 2, what);
    assert.deepEqual(loops.map((l) => l.members.map(memberLabel)), [[`${c}[${p}→${q}]`, chord], [`${c}[${q}→${p}]`, chord]], what);
    assert.ok(close(loops[0].area, Math.PI * r * r - segment, 1e-9) && close(loops[1].area, segment, 1e-9), what);
    assert.ok(spanNear(loops[1].members[0].span, [5 / 6, 7 / 6]), JSON.stringify(loops[1].members[0].span));
    assert.ok(loops.every((l) => close(traced(s.m, l), l.area, 1e-4)));
  }
});

test("three lines through one point cross at one vertex, named by all three", () => {
  for (const s of sheets()) {
    rectOn(s);
    const [l5, l6, l7] = [s.seg([20, -10], [20, 40]), s.seg([-10, 15], [50, 15]), s.seg([-10, 5], [50, 25])];
    const loops = findLoops(s.m);
    const what = `${s.label}: ${listing(loops)}`;
    assert.equal(loops.length, 6, what);
    const centre = `${l5}×${l6}×${l7}`;
    assert.ok(loops.every((l) => l.members.some((x) => x.from === centre)), what);
    assert.ok(!what.includes(`${l5}×${l6}]`) && !what.includes(`${l5}×${l6}→`), "no vertex of two of them alone");
    assert.ok(close(loops.reduce((sum, l) => sum + l.area, 0), 1200, 1e-6));
  }
});

test("a crossing already materialised — a point held on both lines — is that point, not a second vertex", () => {
  for (const s of sheets()) {
    rectOn(s);
    const up = s.seg([15, -10], [15, 40]), level = s.seg([-10, 10], [50, 10]);
    const x = s.m.addPoint(s.at(15, 10)).name;
    pointOnLine(s.m, x, up);
    pointOnLine(s.m, x, level);
    const loops = findLoops(s.m);
    const what = `${s.label}: ${listing(loops)}`;
    assert.equal(loops.length, 4, what);
    assert.ok(loops.every((l) => l.members.some((m) => m.from === x)), what);
    assert.ok(!what.includes(`${up}×${level}`), what);
  }
});

test("a crossing's key is never a name the model has: one that is gets a prime", () => {
  const m = new Model(2);
  m.addPoint([100, 100], "l1×l5"); // × is a legal name character; only the dot is reserved
  polygon(m, RECT);
  m.addLine(m.addPoint([15, -10]).name, m.addPoint([15, 40]).name);
  const [left] = findLoops(m);
  assert.equal(left.members[0].to, "l1×l5′");
  assert.ok(isVirtual(m, "l1×l5′") && !isVirtual(m, "l1×l5"));
});

test("three lines that only cross one another bound a triangle with no joined corner at all", () => {
  for (const s of sheets()) {
    const [a, b, c] = [s.seg([0, 0], [40, 0]), s.seg([5, -5], [25, 30]), s.seg([35, -5], [15, 30])];
    const loops = findLoops(s.m);
    const what = `${s.label}: ${listing(loops)}`;
    assert.equal(loops.length, 1, what);
    // Corners at x = 5 + 20/7 and 35 − 20/7 on the base, and (20, 21.25).
    assert.ok(close(loops[0].area, 0.5 * (30 - 40 / 7) * 21.25, 1e-9), what);
    assert.deepEqual(loops[0].members.map((x) => x.name), [a, c, b]);
    assert.equal(under(s, loops, 20, 5), 0);
  }
});

// --- what is not a loop -------------------------------------------------------------------

test("a self-crossing outline — a bow-tie — is its two lobes, cut where it crosses", () => {
  // Lopsided on purpose: a symmetric bow-tie's two lobes cancel to no area at
  // all. Before crossings cut regions this one came back as one "loop" of its
  // net area, 400, and then as no loop at all; it is two, of 50 and 450.
  const bow = new Model(2);
  const { lines, points } = polygon(bow, [[0, 0], [40, 30], [40, 0], [0, 10]]);
  const loops = findLoops(bow);
  assert.equal(loops.length, 2);
  assert.ok(close(loops[0].area, 50) && close(loops[1].area, 450), loops.map((l) => l.area).join(", "));
  assert.ok(loops.every((l) => close(traced(bow, l), l.area, 1e-6)));
  const x = `${lines[0]}×${lines[2]}`;
  assert.deepEqual(loops[0].members.map(memberLabel), [`${lines[0]}[${points[0]}→${x}]`, `${lines[2]}[${x}→${points[3]}]`, lines[3]]);
  assert.deepEqual(loops[1].members.map(memberLabel), [`${lines[0]}[${x}→${points[1]}]`, `${lines[2]}[${points[2]}→${x}]`, lines[1]]);
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
  // The bottom face lies in the origin's x–y plane, which every model has
  // (docs/plans/frameless-curves.md), and says so; no other face is in a frame.
  assert.deepEqual(loops.map((l) => l.plane.frame).filter((f) => f !== null), ["origin"]);
  assert.ok(loops.every((l) => l.parent === null));
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
  const arc = fillet(m, lines[3], lines[0], 6, t.uz);
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
