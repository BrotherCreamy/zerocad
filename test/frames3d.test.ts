// 3D frames: an origin, an x-ref and a y-ref — a sketch plane — and what `fix`,
// `onPlane` and the axis references mean against one.
//
// The same rule as test/frames.test.ts, sharpened: "solves against a tilted
// frame" proves nothing, because a solver that turned the frame instead of the
// drawing would report `solved: true` just as happily. Every 3D frame below is
// turned by a rotation the test computes for itself (Rodrigues, not
// `frameBasis`), and the assertions are the coordinates that rotation predicts.

import { test } from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { ensureKernelLoaded } from "../src/kernel/problem.ts";
import { Model } from "../src/model.ts";
import { dist, fix, onPlane } from "../src/relations/basic.ts";
import { angle, parallel, perpendicular, pointOnLine } from "../src/relations/geometry.ts";
import { frameBasis } from "../src/relations/refs.ts";
import { del } from "../src/operations.ts";
import { open, save } from "../src/persist.ts";
import { neocadScope } from "../src/replenv.ts";
import { describeRelation } from "../src/picking.ts";

async function loadKernel() {
  const bytes = await readFile(new URL("../src/kernel/wasm-gen/neocad_kernel_bg.wasm", import.meta.url));
  await ensureKernelLoaded(bytes);
}

// --- a frame turned by a rotation the test owns ------------------------------

type V = number[];
const add = (a: V, b: V) => a.map((v, i) => v + b[i]);
const scale = (a: V, k: number) => a.map((v) => v * k);
const dot = (a: V, b: V) => a.reduce((s, v, i) => s + v * b[i], 0);
const cross = (a: V, b: V) => [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]];
const len = (a: V) => Math.hypot(...a);
const gap = (a: V, b: V) => len(a.map((v, i) => v - b[i]));

/** Rodrigues: `v` turned by `theta` about the unit axis `n`. */
function rotate(v: V, n: V, theta: number): V {
  const [c, s] = [Math.cos(theta), Math.sin(theta)];
  return add(add(scale(v, c), scale(cross(n, v), s)), scale(n, dot(n, v) * (1 - c)));
}

/** About (1, 2, 2)/3 by 50° — no axis-aligned accident survives that. */
const N = [1 / 3, 2 / 3, 2 / 3];
const THETA = (50 * Math.PI) / 180;
const EX = rotate([1, 0, 0], N, THETA);
const EY = rotate([0, 1, 0], N, THETA);
const EZ = rotate([0, 0, 1], N, THETA);
const O = [4, -3, 7];

/** World position of frame coordinates `c` in the tilted frame. */
const world = (c: V) => add(O, add(add(scale(EX, c[0]), scale(EY, c[1])), scale(EZ, c[2])));

/**
 * A 3D model whose frame `f` is the tilted one above, made the default. The
 * y-ref is deliberately *not* square to the x-ref — 1.7 along +x as well as 3
 * along +y — because a y-ref only fixes the plane and its side, and the frame
 * that comes out has to be the exact one regardless.
 */
function tilted3(): Model {
  const m = new Model(3);
  m.addPoint(O, "o");
  m.addPoint(add(O, scale(EX, 2.5)), "x");
  m.addPoint(add(O, add(scale(EY, 3), scale(EX, 1.7))), "y");
  m.addFrame("o", "x", "y", "f");
  m.setDefaultFrame("f");
  return m;
}

/** The frame's three points, to show they never moved. */
const framePoints = (m: Model) => ["o", "x", "y"].map((n) => m.coords(n));

const near = (a: V, b: V, tol = 1e-9) => gap(a, b) < tol;

// --- the entity --------------------------------------------------------------

test("addFrame in 3D: every argument optional, the plane seeded square, journalled as one call", () => {
  const m = new Model(3);
  const f = m.addFrame();
  assert.equal(f.name, "f1");
  assert.ok(f.yref, "a 3D frame always has a y-ref — made, when it is not given");
  assert.deepEqual(m.coords(f.origin), [0, 0, 0]);
  assert.deepEqual(m.coords(f.xref), [Model.FREE_SPAN, 0, 0], "x-ref along one kernel axis…");
  assert.deepEqual(m.coords(f.yref!), [0, Model.FREE_SPAN, 0], "…y-ref along another");
  assert.deepEqual(m.journal, [{ op: "addFrame", args: [null, null, null, "f1"] }],
    "its three auto-created points journal nothing of their own");
  // The y-ref is a reference like the others, so it is what `dependents` and
  // the deletion cascade see.
  assert.deepEqual(m.refsOf(f), [f.origin, f.xref, f.yref]);
  assert.deepEqual(m.dependents(f.yref!).map((e) => e.name), ["f1"]);
});

test("addFrame in 3D: no auto-seeded piece can make the frame degenerate, whichever were given", () => {
  const m = new Model(3);
  m.addPoint([5, 5, 5], "o");
  m.addPoint([5, 25, 5], "up");    // straight along the kernel's y from o
  m.addPoint([25, 5, 5], "east");  // straight along the kernel's x from o
  m.addPoint([45, 5, 5], "east2"); // further along that same line

  /** Orthonormal, right-handed axes — which is only possible for a frame with a plane. */
  const sound = (name: string, why: string) => {
    const { ux, uy, uz } = frameBasis(m, name)();
    for (const u of [ux, uy, uz!]) assert.ok(Math.abs(len(u) - 1) < 1e-12, `${why}: an axis floored — ${u}`);
    assert.ok(Math.abs(dot(cross(ux, uy), uz!) - 1) < 1e-12, `${why}: not right-handed`);
  };

  sound(m.addFrame().name, "nothing given");
  sound(m.addFrame("o").name, "an origin");
  sound(m.addFrame(null, "east").name, "an x-ref");
  sound(m.addFrame(null, null, "up").name, "a y-ref");
  // The cases a plain "next axis along" seed would get wrong, because two of
  // the three points were given and lie along the axis the seed would use:
  sound(m.addFrame("o", "up").name, "an x-ref straight along the kernel's y");
  sound(m.addFrame("o", null, "east").name, "a y-ref straight along the kernel's x");
  sound(m.addFrame(null, "east", "east2").name, "two refs on one line along the kernel's x");
  sound(m.addFrame("o", "east", "up").name, "all three given");

  assert.throws(() => m.addFrame("o", "east", "o"), /a frame needs three different points/);
  assert.throws(() => m.addFrame("o", "o"), /three different points/);
});

test("frameBasis in 3D: +y is the y-ref straightened against +x — it fixes the plane and the side, not the angle", () => {
  const m = tilted3();
  const b = frameBasis(m, "f")();
  assert.ok(near(b.origin, O));
  assert.ok(near(b.ux, EX, 1e-12), `+x ${b.ux}`);
  assert.ok(near(b.uy, EY, 1e-12), `+y ${b.uy}: the 1.7 along +x in the y-ref should be gone`);
  assert.ok(near(b.uz!, EZ, 1e-12), `+z ${b.uz}`);
  assert.deepEqual(b.axes, [b.ux, b.uy, b.uz]);

  // Anywhere in its own half of the plane, the y-ref gives the same frame.
  m.setCoords("y", add(O, add(scale(EY, 0.2), scale(EX, -40))));
  const moved = frameBasis(m, "f")();
  assert.ok(near(moved.uy, EY, 1e-12) && near(moved.uz!, EZ, 1e-12), "the angle was never the y-ref's to give");

  // Across +x, the other side: +y and +z flip, +x does not.
  m.setCoords("y", add(O, scale(EY, -3)));
  const flipped = frameBasis(m, "f")();
  assert.ok(near(flipped.ux, EX, 1e-12));
  assert.ok(near(flipped.uy, scale(EY, -1), 1e-12) && near(flipped.uz!, scale(EZ, -1), 1e-12),
    "the y-ref says which side is +y, and +z follows by the right-hand rule");
});

test("a 2D frame's basis is the one it always was, with no z", () => {
  const m = new Model(2);
  m.addPoint([1, 2], "o");
  m.addPoint([1 + 3 * Math.cos(0.5), 2 + 3 * Math.sin(0.5)], "x");
  m.addFrame("o", "x", null, "f");
  const b = frameBasis(m, "f")();
  assert.equal(b.uz, null);
  assert.deepEqual(b.uy, [-b.ux[1], b.ux[0]], "+x a quarter turn counter-clockwise");
  assert.deepEqual(b.axes, [b.ux, b.uy]);
});

test("a collapsed or collinear 3D frame floors axis by axis, and never hands out NaN", async () => {
  await loadKernel();
  const finite = (b: { ux: V; uy: V; uz: V | null }) =>
    [...b.ux, ...b.uy, ...b.uz!].every(Number.isFinite);
  // By value: a cross product of floored vectors can come out as -0, which is
  // the same zero to every residual that reads it.
  const zeros = (...us: V[]) => us.every((u) => u.length === 3 && u.every((c) => c === 0));

  // A y-ref on the frame's own x axis offers no plane: +x survives, +y and +z
  // floor. Out to a billion units, so the floor's scaling with the arm is what
  // keeps rounding error from coming back as a direction.
  for (const along of [3, -3, 1e9]) {
    const m = tilted3();
    m.setCoords("y", add(O, scale(EX, along)));
    const b = frameBasis(m, "f")();
    assert.ok(finite(b));
    assert.ok(near(b.ux, EX, 1e-12), "+x is still perfectly well defined");
    assert.ok(zeros(b.uy, b.uz!), `a y-ref ${along} along +x has no plane to offer: ${b.uy} ${b.uz}`);
  }

  // A y-ref on the origin: the same.
  const onOrigin = tilted3();
  onOrigin.setCoords("y", O);
  const b1 = frameBasis(onOrigin, "f")();
  assert.ok(finite(b1) && near(b1.ux, EX, 1e-12));
  assert.ok(zeros(b1.uy, b1.uz!));

  // An x-ref on the origin: +x floors, and so does +z with it; +y is the
  // y-ref's raw direction, there being nothing left to straighten it against.
  const noX = tilted3();
  noX.setCoords("x", O);
  const b2 = frameBasis(noX, "f")();
  assert.ok(finite(b2));
  assert.ok(zeros(b2.ux, b2.uz!));
  const arm = add(scale(EY, 3), scale(EX, 1.7));
  assert.ok(near(b2.uy, scale(arm, 1 / len(arm)), 1e-12));

  // And a solve against a collapsed frame stays a number. The verdict is not
  // the point — a `fix` against a frame with no plane cannot hold — NaN is.
  const m = tilted3();
  m.setCoords("y", add(O, scale(EX, 3)));
  m.addPoint([1, 2, 3], "p");
  m.addPoint([4, 4, 4], "q");
  m.addLine("p", "q", "l");
  fix(m, "p", [1, 2, 3]);
  onPlane(m, "q");
  parallel(m, "l", "f.z");
  m.solve();
  for (const n of ["p", "q"]) assert.ok(m.coords(n).every(Number.isFinite), `${n} = ${m.coords(n)}`);
});

// --- fix ---------------------------------------------------------------------

test("fix in 3D pins frame coordinates against a tilted frame — the closed form, not solved:true", async () => {
  await loadKernel();
  const m = tilted3();
  m.addPoint([100, -50, 20], "p"); // nowhere near the answer, in any frame
  const r = fix(m, "p", [3, -4, 5]);
  assert.deepEqual(m.relationOf(r).args, ["p", [3, -4, 5], "f"], "journalled with the frame it resolved to");
  const before = framePoints(m);

  assert.equal(m.solve().solved, true);
  assert.ok(near(m.coords("p"), world([3, -4, 5])),
    `p landed at ${m.coords("p")}, not at ${world([3, -4, 5])}`);
  assert.deepEqual(framePoints(m), before, "the frame did not meet the point halfway — not by a bit");

  // Only the x-ref's direction and the y-ref's half-plane are read, so sliding
  // the one out along its ray and the other about inside its half-plane must
  // not move p at all.
  m.setCoords("x", add(O, scale(EX, 90)));
  m.setCoords("y", add(O, add(scale(EY, 0.5), scale(EX, 12))));
  m.solve();
  assert.ok(near(m.coords("p"), world([3, -4, 5])), `p moved to ${m.coords("p")}`);
});

test("fix in 3D is in a frame and takes three coordinates — the origin's, when none is named", () => {
  const m = new Model(3);
  m.addPoint([1, 2, 3], "p");
  // No world gauge: the frameless form names the origin, the one datum every
  // model has (docs/plans/frameless-curves.md), journalled as it.
  const r = fix(m, "p", [0, 0, 0]);
  assert.deepEqual(m.relationOf(r).args, ["p", [0, 0, 0], "origin"]);
  m.deleteRelation(r);
  m.addFrame(null, null, null, "f");
  assert.throws(() => fix(m, "p", [0, 0], "f"), /fix needs 3 coordinates/);
  assert.equal(m.relations.size, 0, "nothing left behind by the attempts");
  assert.equal(m.problem.blockCount, 0);
});

// --- onPlane -----------------------------------------------------------------

test("onPlane: a line pinned off the plane meets it exactly where the arithmetic says", async () => {
  await loadKernel();
  const m = tilted3();
  // Two points pinned in frame coordinates, one above the plane and one below.
  // The line through them crosses z = 0 three fifths of the way along:
  // (1, 2, 3) + 0.6·((4, -1, -2) − (1, 2, 3)) = (2.8, 0.2, 0).
  //
  // Seeded near where they are pinned. With the line's ends starting a long
  // way from their fixes *and* p far off, this shape of system can stall in a
  // spurious minimum in 3D — `on`'s wedge grows with p's distance, so least
  // squares trades the fixes for it. Measured, and not `onPlane`'s doing: a
  // second plain `on` in its place stalls too, from a seed `onPlane` survives
  // (see TODO.md). That is not what this test is about, so the line starts
  // near its pins and only p starts well away from both line and plane.
  m.addPoint(add(world([1, 2, 3]), [0.5, -0.3, 0.2]), "a");
  m.addPoint(add(world([4, -1, -2]), [-0.4, 0.6, 0.1]), "b");
  fix(m, "a", [1, 2, 3]);
  fix(m, "b", [4, -1, -2]);
  m.addLine("a", "b", "l");
  m.addPoint([-20, 30, 10], "p");
  pointOnLine(m, "p", "l");
  const r = onPlane(m, "p");
  assert.deepEqual(m.relationOf(r).args, ["p", "f"], "journalled resolved, like fix");
  assert.equal(m.relationOf(r).op, "onPlane");
  assert.match(r, /^r\d+$/, "a constraint, not a dimension");
  const before = framePoints(m);

  assert.equal(m.solve().solved, true);
  assert.ok(near(m.coords("p"), world([2.8, 0.2, 0])),
    `p settled at ${m.coords("p")}, not at ${world([2.8, 0.2, 0])}`);
  assert.deepEqual(framePoints(m), before, "the plane did not come to the point");
});

test("onPlane reads the plane and never pushes it, and follows it when it moves", async () => {
  await loadKernel();
  const m = tilted3();
  m.addPoint([0, 0, 0], "p");
  fix(m, "p", [2, 2, 2]);
  onPlane(m, "p"); // contradicts the fix: z = 2 against z = 0
  const before = framePoints(m);
  const report = m.solve();
  // Declaring the frame's points would let least squares tilt the plane toward
  // the point and call the conflict half-solved. It cannot: the frame is
  // outside the Jacobian, so the conflict stays a conflict and the plane stays put.
  assert.equal(report.solved, false);
  assert.deepEqual(framePoints(m), before);

  // Without the contradiction, moving the frame carries the point with it in
  // the same solve: the basis is re-read at every evaluation.
  const m2 = tilted3();
  m2.addPoint([0, 0, 0], "q");
  fix(m2, "q", [5, 6, 0]);
  onPlane(m2, "q");
  m2.solve();
  const lift = scale(EZ, 9);
  for (const n of ["o", "x", "y"]) m2.setCoords(n, add(m2.coords(n), lift));
  assert.equal(m2.solve().solved, true);
  assert.ok(near(m2.coords("q"), add(world([5, 6, 0]), lift)), `q at ${m2.coords("q")}`);
});

test("onPlane: the default resolved at call time and journalled resolved; refused in 2D", () => {
  const m = new Model(3);
  m.addPoint([1, 1, 1], "p");
  // With no frame chosen, the drawing plane: the origin's.
  const ground = onPlane(m, "p");
  assert.deepEqual(m.relationOf(ground).args, ["p", "origin"]);
  m.addFrame(null, null, null, "a");
  m.addFrame(null, null, null, "b");
  m.setDefaultFrame("a");
  const r = onPlane(m, "p");
  m.setDefaultFrame("b");
  assert.deepEqual(m.relationOf(r).args, ["p", "a"], "the entry names the frame, not the pointer");
  assert.deepEqual(open(save(m)).relationOf(r).args, ["p", "a"], "and a reopened file agrees");
  assert.equal(onPlane(m, "p", "a") !== r, true, "naming the frame outright works too");
  assert.equal(describeRelation(m.relationOf(r)), `${r}  onplane p a`, "and reads back as typed");

  // In 2D every point is already in every frame's plane: refused, not a no-op.
  const flat = new Model(2);
  flat.addPoint([0, 0], "q");
  flat.addFrame(null, null, null, "f");
  flat.setDefaultFrame("f");
  assert.throws(() => onPlane(flat, "q"),
    /onPlane needs a 3D model — in 2D every point already lies in every frame's plane/);
  assert.equal(flat.relations.size, 0);
  assert.equal(flat.problem.blockCount, 0);
});

test("deleting a 3D frame takes its onPlane; deleting its y-ref takes the frame", async () => {
  await loadKernel();
  const m = tilted3();
  m.addPoint([0, 0, 0], "p");
  const r = onPlane(m, "p");
  assert.deepEqual(m.relationsNaming("f").map((e) => e.name), [r]);
  assert.deepEqual(del(m, "f"), [r, "f"]);
  assert.ok(m.has("p") && m.has("y"), "the point and the frame's points outlive it");

  const m2 = tilted3();
  m2.addPoint([0, 0, 0], "p");
  onPlane(m2, "p");
  assert.deepEqual(del(m2, "y"), ["r1", "f", "y"], "a frame cannot outlive the point that gives it a plane");
  assert.equal(m2.defaultFrame, null);
});

// --- axis references in 3D ---------------------------------------------------

/**
 * A 3D model with the tilted frame, a line `l` from `a` (pinned at frame
 * coordinates (1, 1, 1)) to a free `b` ten units away. Returns the line's
 * direction once solved, in world terms.
 */
async function directed(constrain: (m: Model) => void): Promise<{ d: V; m: Model }> {
  await loadKernel();
  const m = tilted3();
  m.addPoint([0, 0, 0], "a");
  m.addPoint(add(world([1, 1, 1]), [3, 7, -2]), "b"); // off every axis
  m.addLine("a", "b", "l");
  fix(m, "a", [1, 1, 1]);
  dist(m, "a", "b", 10);
  constrain(m);
  const before = framePoints(m);
  assert.equal(m.solve().solved, true);
  assert.deepEqual(framePoints(m), before, "the frame is a datum: it never moved");
  const [a, b] = [m.coords("a"), m.coords("b")];
  return { d: b.map((v, i) => v - a[i]), m };
}

/** `d` lies along `u` one way or the other, at length 10 — par is about lines, not rays. */
const alongEitherWay = (d: V, u: V) => Math.min(gap(d, scale(u, 10)), gap(d, scale(u, -10)));

test("par against a tilted 3D frame's z lands on its normal, exactly", async () => {
  const { d } = await directed((m) => parallel(m, "l", "f.z"));
  assert.ok(alongEitherWay(d, EZ) < 1e-9, `the line went to ${d}, not ±10·${EZ}`);
});

test("par against its x and y, too — every axis, not just the new one", async () => {
  const { d: dx } = await directed((m) => parallel(m, "l", "f.x"));
  assert.ok(alongEitherWay(dx, EX) < 1e-9, `${dx}`);
  const { d: dy } = await directed((m) => parallel(m, "l", "f.y"));
  assert.ok(alongEitherWay(dy, EY) < 1e-9, `${dy}`);
});

test("perp to two of a 3D frame's axes leaves exactly the third", async () => {
  const { d } = await directed((m) => {
    perpendicular(m, "l", "f.z");
    perpendicular(m, "l", "f.x");
  });
  assert.ok(alongEitherWay(d, EY) < 1e-9, `${d} should lie along ±${EY}`);
});

test("ang against a 3D frame's z, held in its x–z plane: the closed-form direction", async () => {
  const t = 0.6;
  const { d } = await directed((m) => {
    angle(m, "l", "f.z", t);
    perpendicular(m, "l", "f.y");
  });
  assert.ok(Math.abs(dot(d, EZ) - 10 * Math.cos(t)) < 1e-9, `along +z: ${dot(d, EZ)}`);
  assert.ok(Math.abs(dot(d, EY)) < 1e-9, `off the x–z plane: ${dot(d, EY)}`);
  assert.ok(Math.abs(Math.abs(dot(d, EX)) - 10 * Math.sin(t)) < 1e-9, `along +x: ${dot(d, EX)}`);
});

test("two axes of one 3D frame on one relation are refused, as in 2D", () => {
  const m = tilted3();
  assert.throws(() => parallel(m, "f.x", "f.z"), /par needs something it can move/);
  assert.throws(() => angle(m, "f.z", "f.y", 1), /ang needs something it can move/);
});

// --- journal round trips -----------------------------------------------------

test("a 3D frame and everything written against it survive save/open byte for byte", async () => {
  await loadKernel();
  const m = tilted3();
  m.addPoint([0, 0, 0], "a");
  m.addPoint([1, 1, 1], "b");
  m.addLine("a", "b", "l");
  fix(m, "a", [1, 2, 0]);
  onPlane(m, "b");
  dist(m, "a", "b", 6);
  angle(m, "l", "f.x", 0.4);
  m.addPoint([9, 9, 9], "c");
  m.addLine("a", "c", "up");
  parallel(m, "up", "f.z");
  m.addFrame(); // and an all-auto one beside it
  assert.equal(m.solve().solved, true);

  const once = save(m);
  const reopened = open(once);
  assert.equal(save(reopened), once, "or repeated saves drift");
  assert.deepEqual(reopened.frame("f"), m.frame("f"), "y-ref and all");
  assert.deepEqual(reopened.frame("f1"), m.frame("f1"));
  assert.deepEqual([...reopened.relations.values()].map((r) => [r.name, r.op, r.args]),
    [...m.relations.values()].map((r) => [r.name, r.op, r.args]));
  // And it still means the same geometry: re-solved from where it was saved,
  // nothing moves.
  assert.equal(reopened.solve().solved, true);
  for (const n of ["a", "b", "c"]) assert.ok(near(reopened.coords(n), m.coords(n)), n);
});

test("a v4 3D file that leant on the gauge fix opens with it in the origin, the gauge it meant", () => {
  // The app had only ever been 2D, so a file like this could only have come
  // from the command line or a test. It was refused while there was no world
  // frame; the origin is the kernel's own axes, which is what it pinned.
  const v4 = JSON.stringify({
    format: "neocad-model", version: 4, dim: 3,
    journal: [
      { op: "addPoint", args: [[0, 0, 0], "a"] },
      { op: "fix", args: ["a", [0, 0, 0]] },
    ],
    values: { points: {}, radii: {} },
  });
  assert.deepEqual([...open(v4).relations.values()].map((r) => r.args), [["a", [0, 0, 0], "origin"]]);
});

// --- the command surface -----------------------------------------------------

const call = (s: Record<string, unknown>, name: string, ...args: unknown[]) =>
  (s[name] as (...a: unknown[]) => unknown)(...args);

test("the command surface in 3D: frame(o, x, y), zaxis(), onplane, ls and rels", () => {
  const m = new Model(3);
  const s = neocadScope({ model: m });
  m.addPoint([0, 0, 0], "o");
  m.addPoint([0, 5, 0], "x");
  m.addPoint([0, 0, 5], "y");
  const f = call(s, "frame", "o", "x", "y") as string;
  assert.deepEqual(m.frame(f), { kind: "frame", name: f, origin: "o", xref: "x", yref: "y" });
  call(s, "setDefaultFrame", f);
  assert.equal(call(s, "xaxis"), `${f}.x`);
  assert.equal(call(s, "yaxis"), `${f}.y`);
  assert.equal(call(s, "zaxis"), `${f}.z`);
  assert.equal(call(s, "zaxis", f), `${f}.z`);

  m.addPoint([3, 3, 3], "p");
  const r = call(s, "onplane", "p") as string;
  assert.equal(call(s, "onPlane", "p", f) !== r, true, "the long name is bound too");
  assert.deepEqual(call(s, "rels", "p"), [`${r}  onplane p ${f}`, `r2  onplane p ${f}`]);
  const line = (call(s, "ls") as string[]).find((l) => l.startsWith(f))!;
  assert.equal(line, `${f}  frame  origin o, +x toward x, +y toward y  (default)`);
  assert.match(call(s, "help") as string, /zaxis\(frame\?\)/);
  assert.match(call(s, "help") as string, /onplane/);
});

test("the command surface in 2D: zaxis() refuses, and frame() with a y-ref leaves nothing behind", () => {
  const m = new Model(2);
  // With a viewport, so `frame()` would anchor a missing origin at its centre
  // — the case where refusing *after* making that point would strand it.
  const s = neocadScope({ model: m, view: { ox: 0, oy: 0, scale: 1 }, viewSize: () => [800, 600] });
  call(s, "setDefaultFrame", call(s, "frame"));
  assert.throws(() => call(s, "zaxis"), /a 2D frame has no z axis/);
  const entities = m.entities.size, journal = m.journal.length;
  m.addPoint([1, 1], "q");
  assert.throws(() => call(s, "frame", null, null, "q"), /a 2D frame takes no y-ref/);
  assert.equal(m.entities.size, entities + 1, "only the point this test made");
  assert.equal(m.journal.length, journal + 1);
});
