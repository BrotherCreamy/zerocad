// Coordinate frames: the entity, the default pointer, and what `hor`, `ver`
// and `fix` mean now that there is no world frame to fall back on.
//
// The interesting assertions here are the closed-form ones. "Solves against a
// tilted frame" is easy to satisfy accidentally — a solver that levelled the
// frame instead of the drawing would report `solved: true` just as happily —
// so the tilted cases below check the exact angle and the exact coordinate.

import { test } from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { ensureKernelLoaded } from "../src/kernel/problem.ts";
import { Model } from "../src/model.ts";
import { dist, fix, horizontal, vertical } from "../src/relations/basic.ts";
import { del } from "../src/operations.ts";
import { FORMAT, VERSION, open, save } from "../src/persist.ts";

async function loadKernel() {
  const bytes = await readFile(new URL("../src/kernel/wasm-gen/neocad_kernel_bg.wasm", import.meta.url));
  await ensureKernelLoaded(bytes);
}

const TILT = Math.PI / 6; // 30°, which no axis-aligned accident lands on

/** A model whose frame `f` is tilted by `TILT` about `at`. */
function tilted(at = [0, 0]): Model {
  const m = new Model(2);
  m.addPoint(at, "o");
  m.addPoint([at[0] + Math.cos(TILT), at[1] + Math.sin(TILT)], "x");
  m.addFrame("o", "x", "f");
  m.setDefaultFrame("f");
  return m;
}

// --- the entity ------------------------------------------------------------

test("addFrame: every argument optional, and the pieces it makes are real points", () => {
  const m = new Model(2);
  const f = m.addFrame();
  assert.equal(f.kind, "frame");
  assert.equal(f.name, "f1", "auto-named f1, f2, …");
  // Its two points are first-class: named, listed, and constrainable.
  const o = m.point(f.origin), x = m.point(f.xref);
  assert.deepEqual(m.coords(o.name), [0, 0]);
  assert.equal(m.frame("f1"), f);
  assert.throws(() => m.frame(o.name), /"p1" is not a frame/);
  assert.equal(m.addFrame(o.name).name, "f2", "an origin given, an x-ref made");
  assert.equal(m.addFrame(null, x.name).name, "f3", "or the other way round");
  assert.equal(m.addFrame(o.name, x.name, "world").name, "world", "or named outright");
});

test("addFrame: a directionless frame is impossible to construct", () => {
  const m = new Model(2);
  const span = (f: { origin: string; xref: string }) => {
    const [o, x] = [m.coords(f.origin), m.coords(f.xref)];
    return Math.hypot(x[0] - o[0], x[1] - o[1]);
  };
  // Every auto-created form seeds the pair apart. A frame whose two points
  // coincide has no direction at all, so every relation against it would be
  // meaningless — this has to be impossible, not merely discouraged.
  assert.ok(span(m.addFrame()) > 1, "both points auto-created");
  m.addPoint([5, 5], "here");
  assert.ok(span(m.addFrame("here")) > 1, "the x-ref auto-created");
  assert.ok(span(m.addFrame(null, "here")) > 1, "the origin auto-created");
  assert.throws(() => m.addFrame("here", "here"), /two different points/);
});

test("a frame is 2D-only, because one direction does not settle a 3D frame", () => {
  const m = new Model(3);
  assert.throws(() => m.addFrame(), /a frame is a 2D entity/);
  // ...and `fix` therefore keeps its old, gauge-relative meaning up there,
  // which is the one place the kernel's own axes are still visible.
  m.addPoint([1, 1, 1], "a");
  assert.equal(fix(m, "a", [0, 0, 0]), "r1");
  assert.deepEqual(m.relationOf("r1").args, ["a", [0, 0, 0]], "no frame in the entry");
  assert.throws(() => fix(m, "a", [0, 0, 0], "f"), /a frame is a 2D entity/);
});

test("a frame journals as the one call that was made", () => {
  const m = new Model(2);
  m.addFrame();
  assert.deepEqual(m.journal, [{ op: "addFrame", args: [null, null, "f1"] }],
    "its two auto-created points journal nothing of their own");
  m.setDefaultFrame("f1");
  assert.deepEqual(m.journal.at(-1), { op: "setDefaultFrame", args: ["f1"] });
});

test("a frame and its default survive a save/open round trip, byte for byte", async () => {
  await loadKernel();
  const m = tilted([4, 6]);
  m.addLine(null, null, "l");
  horizontal(m, "l");
  m.solve();

  const once = save(m);
  const reopened = open(once);
  assert.equal(save(reopened), once, "or repeated saves drift");
  assert.equal(reopened.defaultFrame, "f", "the pointer came back with it");
  assert.deepEqual(reopened.frame("f"), m.frame("f"));
});

// --- what the relations mean now -------------------------------------------

test("no frame and no default: the error says what to do about it", () => {
  const m = new Model(2);
  m.addLine(null, null, "l");
  m.addPoint([1, 2], "p");
  for (const call of [
    () => horizontal(m, "l"),
    () => vertical(m, "l"),
    () => fix(m, "p", [0, 0]),
  ]) {
    assert.throws(call, /no default frame — frame\(\) then setDefaultFrame\(\), or say which frame/);
  }
  // And nothing was left behind by the attempt.
  assert.equal(m.relations.size, 0);
  assert.equal(m.problem.blockCount, 0);
});

test("hor against a tilted frame levels the line to the frame, exactly", async () => {
  await loadKernel();
  const m = tilted();
  m.addPoint([0, 0], "a");
  m.addPoint([9, 1], "b"); // nowhere near either the frame's axis or the gauge's
  m.addLine("a", "b", "l");
  fix(m, "a", [0, 0]);
  dist(m, "a", "b", 10);
  horizontal(m, "l");

  assert.equal(m.solve().solved, true);
  const [a, b] = [m.coords("a"), m.coords("b")];
  const angle = Math.atan2(b[1] - a[1], b[0] - a[0]);
  assert.ok(Math.abs(angle - TILT) < 1e-9, `the line settled at ${angle}, not the frame's ${TILT}`);
  // The whole of the point: the frame did not meet the line halfway.
  assert.deepEqual(m.coords("o"), [0, 0], "the frame's origin did not move");
  assert.ok(Math.abs(Math.atan2(...m.coords("x").slice().reverse() as [number, number]) - TILT) < 1e-12,
    "and neither did its x-ref");
});

test("ver against a tilted frame is the frame's +y, exactly", async () => {
  await loadKernel();
  const m = tilted();
  m.addPoint([0, 0], "a");
  m.addPoint([3, 9], "b");
  m.addLine("a", "b", "l");
  fix(m, "a", [0, 0]);
  dist(m, "a", "b", 10);
  vertical(m, "l");

  assert.equal(m.solve().solved, true);
  const [a, b] = [m.coords("a"), m.coords("b")];
  const angle = Math.atan2(b[1] - a[1], b[0] - a[0]);
  assert.ok(Math.abs(angle - (TILT + Math.PI / 2)) < 1e-9,
    `the line settled at ${angle}, not the frame's +y at ${TILT + Math.PI / 2}`);
});

test("fix places a point in the frame's coordinates, origin and tilt and all", async () => {
  await loadKernel();
  const m = tilted([5, 7]);
  m.addPoint([0, 0], "p");
  fix(m, "p", [3, 4]);
  assert.equal(m.solve().solved, true);

  const [c, s] = [Math.cos(TILT), Math.sin(TILT)];
  const expected = [5 + 3 * c - 4 * s, 7 + 3 * s + 4 * c];
  const at = m.coords("p");
  assert.ok(Math.hypot(at[0] - expected[0], at[1] - expected[1]) < 1e-9,
    `p landed at ${at}, not at ${expected}`);
  // The x-ref's *distance* is irrelevant — only its direction is read — so
  // sliding it out along the same ray must not move p at all.
  m.setCoords("x", [5 + 100 * c, 7 + 100 * s]);
  m.solve();
  const again = m.coords("p");
  assert.ok(Math.hypot(again[0] - expected[0], again[1] - expected[1]) < 1e-9,
    `p moved to ${again} when the x-ref slid out along its own direction`);
});

test("the frame is read at every evaluation, so turning it turns the drawing", async () => {
  await loadKernel();
  const m = tilted();
  m.addPoint([0, 0], "a");
  m.addPoint([10, 0], "b");
  m.addLine("a", "b", "l");
  fix(m, "a", [0, 0]);
  dist(m, "a", "b", 10);
  horizontal(m, "l");
  m.solve();

  // Turn the frame by moving its x-ref — the gesture half 2 makes a drag.
  const turned = TILT + 0.4;
  m.setCoords("x", [Math.cos(turned), Math.sin(turned)]);
  assert.equal(m.solve().solved, true);

  const [a, b] = [m.coords("a"), m.coords("b")];
  const angle = Math.atan2(b[1] - a[1], b[0] - a[0]);
  assert.ok(Math.abs(angle - turned) < 1e-9,
    `the drawing should have followed the frame to ${turned}, and is at ${angle}`);
});

// --- the default frame -----------------------------------------------------

test("the default is resolved at call time and journalled resolved", async () => {
  await loadKernel();
  const m = new Model(2);
  m.addFrame(null, null, "a");
  m.addFrame(null, null, "b");
  m.addLine(null, null, "l");

  m.setDefaultFrame("a");
  const r = horizontal(m, "l");
  assert.deepEqual(m.relationOf(r).args, ["l", "a"], "the entry names the frame, not the pointer");

  // Moving the default afterwards must not reach back and change what that
  // relation meant — which is the whole reason the name is resolved eagerly.
  m.setDefaultFrame("b");
  assert.deepEqual(m.relationOf(r).args, ["l", "a"]);
  assert.deepEqual(open(save(m)).relationOf(r).args, ["l", "a"], "and a reopened file agrees");
  assert.equal(open(save(m)).defaultFrame, "b");

  m.setDefaultFrame(null);
  assert.equal(m.defaultFrame, null, "null clears it");
  assert.throws(() => horizontal(m, "l"), /no default frame/);
  assert.throws(() => m.setDefaultFrame("l"), /"l" is not a frame/);
});

test("a new model has no default frame — one exists only because a user made it", () => {
  assert.equal(new Model(2).defaultFrame, null);
});

// --- deletion --------------------------------------------------------------

test("a frame takes its relations, not its points; and its points take it", async () => {
  await loadKernel();
  const m = tilted();
  m.addLine(null, null, "l");
  const r = horizontal(m, "l");

  // The line rules: deleting the frame reaches the relations naming it and
  // stops there — its two points were the drawing's points first.
  assert.deepEqual(del(m, "f"), [r, "f"]);
  assert.ok(m.has("o") && m.has("x"), "the frame's points outlive it");
  assert.ok(m.has("l"), "and so does the line it constrained");

  // ...and the cascade runs inward, so one of those points takes the frame.
  const m2 = tilted();
  m2.addLine(null, null, "l2");
  horizontal(m2, "l2");
  assert.deepEqual(del(m2, "x"), ["r1", "f", "x"], "the frame cannot outlive its x-ref");
});

test("deleting the default frame clears the pointer, journalled as the expansion", async () => {
  await loadKernel();
  const m = tilted();
  assert.equal(m.defaultFrame, "f");

  del(m, "f");
  assert.equal(m.defaultFrame, null, "the pointer cannot outlive what it points at");
  assert.deepEqual(m.journal.slice(-2), [
    { op: "setDefaultFrame", args: [null] },
    { op: "deleteEntity", args: ["f"] },
  ], "journalled as its expansion, the way every deletion is");

  const reopened = open(save(m));
  assert.equal(reopened.defaultFrame, null, "so a reopened file is not left pointing at a ghost");
  assert.equal(reopened.has("f"), false);
});

// --- the files that no longer mean anything --------------------------------

test("a pre-frames file is refused by name and step, not silently skipped", () => {
  // Exactly what this app used to write: `hor`/`fix` with no frame in sight.
  // There is no world frame left to resolve them against and a compatibility
  // shim would preserve precisely the semantics this package removes, so the
  // file is refused — with the message that says what a frame is for.
  const old = JSON.stringify({
    format: FORMAT, version: 1, dim: 2,
    journal: [
      { op: "addPoint", args: [[0, 0], "a"] },
      { op: "addPoint", args: [[10, 0], "b"] },
      { op: "addLine", args: ["a", "b", "l"] },
      { op: "fix", args: ["a", [0, 0]] },
    ],
    values: { points: {}, radii: {} },
  });
  assert.throws(() => open(old), /step 4, fix\("a", \[0,0\]\): no default frame — frame\(\)/);

  const oldHor = JSON.stringify({
    format: FORMAT, version: 1, dim: 2,
    journal: [
      { op: "addLine", args: [null, null, "l"] },
      { op: "horizontal", args: ["l"] },
    ],
    values: { points: {}, radii: {} },
  });
  assert.throws(() => open(oldHor), /step 2, horizontal\("l"\): no default frame/);
});

test("the format version says the vocabulary changed, and still reads the old envelope", () => {
  assert.equal(VERSION, 2);
  // A version-1 file with nothing frameless in it opens unchanged: the version
  // wall is not what refuses the ones above, the missing frame is.
  const empty = JSON.stringify({ format: FORMAT, version: 1, dim: 2, journal: [], values: { points: {}, radii: {} } });
  assert.equal(open(empty).entities.size, 0);
  const future = JSON.stringify({ format: FORMAT, version: 3, dim: 2, journal: [], values: { points: {}, radii: {} } });
  assert.throws(() => open(future), /version 3, and this build only reads up to 2/);
});
