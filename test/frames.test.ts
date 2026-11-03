// Coordinate frames: the entity, the default pointer, and what `fix` and a
// frame-axis reference mean now that there is no world frame to fall back on.
//
// `hor`/`ver` were retired after this package shipped and the tests that used
// them are here in the new spelling — `par(l, "f.x")` and `par(l, "f.y")` —
// with the closed-form assertions untouched, because the equation did not
// change with the word.
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
import { dist, fix } from "../src/relations/basic.ts";
import { parallel } from "../src/relations/geometry.ts";
import { del } from "../src/operations.ts";
import { FORMAT, VERSION, open, save } from "../src/persist.ts";
import { neocadScope } from "../src/replenv.ts";

async function loadKernel() {
  const bytes = await readFile(new URL("../src/kernel/wasm-gen/neocad_kernel_bg.wasm", import.meta.url));
  await ensureKernelLoaded(bytes);
}

const TILT = Math.PI / 6; // 30°, which no axis-aligned accident lands on

/**
 * The `xaxis()`/`yaxis()` helpers as the command line offers them — through
 * the real scope rather than a copy, since resolving the default at call time
 * is the whole of what they do.
 */
const axisOf = (m: Model, which: "xaxis" | "yaxis", frame?: string | null) =>
  (neocadScope({ model: m })[which] as (f?: string | null) => string)(frame);
const xaxis = (m: Model, frame?: string | null) => axisOf(m, "xaxis", frame);
const yaxis = (m: Model, frame?: string | null) => axisOf(m, "yaxis", frame);

/** A model whose frame `f` is tilted by `TILT` about `at`. */
function tilted(at = [0, 0]): Model {
  const m = new Model(2);
  m.addPoint(at, "o");
  m.addPoint([at[0] + Math.cos(TILT), at[1] + Math.sin(TILT)], "x");
  m.addFrame("o", "x", null, "f");
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
  assert.equal(m.addFrame(o.name, x.name, null, "world").name, "world", "or named outright");
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

test("a 2D frame refuses a y-ref, and a model with no frames says so", () => {
  // This test used to read "a frame is 2D-only": one direction does not settle
  // a 3D frame. A second one does, so 3D frames exist now (their own tests are
  // in test/frames3d.test.ts) and what is left to pin here is the 2D side.
  const m = new Model(2);
  m.addPoint([0, 0], "o");
  m.addPoint([1, 0], "x");
  m.addPoint([0, 1], "y");
  assert.throws(() => m.addFrame("o", "x", "y"),
    /a 2D frame takes no y-ref — its \+y is \+x turned a quarter turn, already/);
  // Refused before anything was made: a missing origin is not auto-created
  // only to be stranded by the refusal that follows.
  assert.throws(() => m.addFrame(null, null, "y"), /a 2D frame takes no y-ref/);
  assert.equal(m.entities.size, 3, "no stray auto-created points");
  assert.equal(m.journal.filter((e) => e.op === "addFrame").length, 0);

  // Above 3D (and below 2D) two directions leave a rotation free again, so
  // there are no frames — and, `fix` being a position in one, no `fix` either.
  for (const dim of [1, 4]) {
    const odd = new Model(dim);
    assert.throws(() => odd.addFrame(), new RegExp(`a ${dim}D model has no frames — a frame lives in a 2D or 3D model`));
    odd.addPoint(new Array(dim).fill(0), "a");
    assert.throws(() => fix(odd, "a", new Array(dim).fill(0)), /has no frames/,
      "the gauge form that once lived here is gone in every dimension");
  }
});

test("a frame journals as the one call that was made", () => {
  const m = new Model(2);
  m.addFrame();
  // Four arguments since format version 5 — the y-ref sits third, null in 2D,
  // and the name last, as on every other constructor.
  assert.deepEqual(m.journal, [{ op: "addFrame", args: [null, null, null, "f1"] }],
    "its two auto-created points journal nothing of their own");
  m.setDefaultFrame("f1");
  assert.deepEqual(m.journal.at(-1), { op: "setDefaultFrame", args: ["f1"] });
});

test("a frame and its default survive a save/open round trip, byte for byte", async () => {
  await loadKernel();
  const m = tilted([4, 6]);
  m.addLine(null, null, "l");
  parallel(m, "l", "f.x");
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
    () => parallel(m, "l", xaxis(m)),
    () => parallel(m, "l", yaxis(m)),
    () => fix(m, "p", [0, 0]),
  ]) {
    assert.throws(call, /no default frame — frame\(\) then setDefaultFrame\(\), or say which frame/);
  }
  // And nothing was left behind by the attempt.
  assert.equal(m.relations.size, 0);
  assert.equal(m.problem.blockCount, 0);
});

test("par against a tilted frame levels the line to the frame, exactly", async () => {
  await loadKernel();
  const m = tilted();
  m.addPoint([0, 0], "a");
  m.addPoint([9, 1], "b"); // nowhere near either the frame's axis or the gauge's
  m.addLine("a", "b", "l");
  fix(m, "a", [0, 0]);
  dist(m, "a", "b", 10);
  parallel(m, "l", "f.x");

  assert.equal(m.solve().solved, true);
  const [a, b] = [m.coords("a"), m.coords("b")];
  const angle = Math.atan2(b[1] - a[1], b[0] - a[0]);
  assert.ok(Math.abs(angle - TILT) < 1e-9, `the line settled at ${angle}, not the frame's ${TILT}`);
  // The whole of the point: the frame did not meet the line halfway.
  assert.deepEqual(m.coords("o"), [0, 0], "the frame's origin did not move");
  assert.ok(Math.abs(Math.atan2(...m.coords("x").slice().reverse() as [number, number]) - TILT) < 1e-12,
    "and neither did its x-ref");
});

test("par against a tilted frame's +y is that direction, exactly", async () => {
  await loadKernel();
  const m = tilted();
  m.addPoint([0, 0], "a");
  m.addPoint([3, 9], "b");
  m.addLine("a", "b", "l");
  fix(m, "a", [0, 0]);
  dist(m, "a", "b", 10);
  parallel(m, "l", "f.y");

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
  parallel(m, "l", "f.x");
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
  m.addFrame(null, null, null, "a");
  m.addFrame(null, null, null, "b");
  m.addLine(null, null, "l");

  m.setDefaultFrame("a");
  const r = parallel(m, "l", xaxis(m));
  assert.deepEqual(m.relationOf(r).args, ["l", "a.x"], "the entry names the frame, not the pointer");

  // Moving the default afterwards must not reach back and change what that
  // relation meant — which is the whole reason the name is resolved eagerly.
  m.setDefaultFrame("b");
  assert.deepEqual(m.relationOf(r).args, ["l", "a.x"]);
  assert.deepEqual(open(save(m)).relationOf(r).args, ["l", "a.x"], "and a reopened file agrees");
  assert.equal(open(save(m)).defaultFrame, "b");

  m.setDefaultFrame(null);
  assert.equal(m.defaultFrame, null, "null clears it");
  assert.throws(() => xaxis(m), /no default frame/);
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
  const r = parallel(m, "l", "f.x");

  // The line rules: deleting the frame reaches the relations naming it and
  // stops there — its two points were the drawing's points first.
  assert.deepEqual(del(m, "f"), [r, "f"]);
  assert.ok(m.has("o") && m.has("x"), "the frame's points outlive it");
  assert.ok(m.has("l"), "and so does the line it constrained");

  // ...and the cascade runs inward, so one of those points takes the frame.
  const m2 = tilted();
  m2.addLine(null, null, "l2");
  parallel(m2, "l2", "f.x");
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

// --- the older files -------------------------------------------------------

test("a pre-frames file is refused by name and step, not silently skipped", () => {
  // Exactly what this app used to write before frames: `hor`/`fix` with no
  // frame in sight.
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
  // The message now comes out of the *translation* rather than out of `hor`
  // itself — `hor` is gone — but it is the same message at the same step,
  // because the translation is what has to resolve the frame the entry lacks.
  assert.throws(() => open(oldHor), /step 2, horizontal\("l"\): no default frame/);
});

test("a version-2 file's hor/ver are translated, and re-save in the new vocabulary", async () => {
  await loadKernel();
  // A file this app wrote hours before `hor`/`ver` were retired: the frame is
  // named in every entry, so the entries still say exactly what they meant.
  const v2 = JSON.stringify({
    format: FORMAT, version: 2, dim: 2,
    journal: [
      { op: "addPoint", args: [[0, 0], "o"] },
      { op: "addPoint", args: [[Math.cos(TILT), Math.sin(TILT)], "x"] },
      { op: "addFrame", args: ["o", "x", "f"] },
      { op: "setDefaultFrame", args: ["f"] },
      { op: "addPoint", args: [[0, 0], "a"] },
      { op: "addPoint", args: [[9, 1], "b"] },
      { op: "addLine", args: ["a", "b", "l"] },
      { op: "addPoint", args: [[2, 2], "c"] },
      { op: "addPoint", args: [[6, 3], "d"] },
      { op: "fix", args: ["a", [0, 0], "f"] },
      { op: "dist", args: ["a", "b", 10] },
      { op: "horizontal", args: ["l", "f"] },
      { op: "vertical", args: ["c", "d", "f"] },  // the point form
    ],
    values: { points: {}, radii: {} },
  });

  const m = open(v2);
  // Its frame is translated too, at the 4→5 boundary rather than the 2→3 one:
  // the name moves from third to fourth so a 3D frame's y-ref can sit beside
  // the other refs.
  assert.deepEqual(m.journal[2], { op: "addFrame", args: ["o", "x", null, "f"] });
  assert.deepEqual(m.journal.slice(-2), [
    { op: "parallel", args: ["l", "f.x"] },
    // Parallel to +y, not perpendicular to +x: the same equation, but `rels()`
    // and the glyph then read as what the drawing actually claims.
    { op: "parallel", args: ["c", "d", "f.y"] },
  ], "translated on the way in");

  // And it means the same geometry it always did.
  assert.equal(m.solve().solved, true);
  const [a, b] = [m.coords("a"), m.coords("b")];
  assert.ok(Math.abs(Math.atan2(b[1] - a[1], b[0] - a[0]) - TILT) < 1e-9, "still level with the frame");
  // Undirected: parallel is a claim about an axis, not a ray, so the pair may
  // settle either way along the frame's +y — and does, from this seed.
  const [c, d] = [m.coords("c"), m.coords("d")];
  const off = Math.abs(Math.atan2(d[1] - c[1], d[0] - c[0]) - (TILT + Math.PI / 2)) % Math.PI;
  assert.ok(Math.min(off, Math.PI - off) < 1e-9,
    "and the point pair still lies along the frame's +y");

  // save(open(x)) !== x across this boundary, deliberately: a file that opened
  // as `par` and saved back as `hor` would keep the retired words alive
  // forever. It does round-trip from here on.
  const saved = save(m);
  assert.equal(saved.includes("horizontal"), false, "the old words are gone from the file");
  assert.match(saved, /"version": 10/);
  assert.equal(save(open(saved)), saved, "and the new file is stable");
});

// --- the command surface ----------------------------------------------------
//
// `frame()` is a free constructor like `circ()` and seeds like one: the origin
// in the middle of the view, the x-ref a span to its right. It matters more
// here than for a circle — a frame off the edge of the window would leave
// `fix` and every axis reference pointing at something nobody can see.

/** The command surface over `model`, with a viewport whose centre is (225, -175). */
function scopeWithView(model: Model): Record<string, unknown> {
  return neocadScope({
    model,
    view: { ox: 100, oy: 50, scale: 2 },
    viewSize: () => [1100, 800],
  });
}

const callScope = (s: Record<string, unknown>, name: string, ...args: unknown[]) =>
  (s[name] as (...a: unknown[]) => string)(...args);

test("frame() seeds its origin at the middle of the view, x-ref to its right", () => {
  const m = new Model(2);
  const f = m.frame(callScope(scopeWithView(m), "frame"));
  assert.deepEqual(m.coords(f.origin), [225, -175]);
  const x = m.coords(f.xref);
  assert.equal(x[1], -175, "and level with it, so the frame starts square to the window");
  assert.ok(x[0] > 225, `the x-ref is to the right of the origin, not on it: ${x}`);
});

test("frame() headless still seeds itself, so a test's journal stays the one call", () => {
  const m = new Model(2);
  const s = neocadScope({ model: m }); // no viewport to ask
  const f = m.frame(callScope(s, "frame"));
  assert.deepEqual(m.journal.map((e) => e.op), ["addFrame"]);
  assert.deepEqual(m.coords(f.origin), [0, 0], "the model's own plain default stands");
});

test("frame(): an x-ref given without an origin seeds beside it, not at the window", () => {
  const m = new Model(2);
  const s = scopeWithView(m);
  m.addPoint([0, 0], "here");
  const f = m.frame(callScope(s, "frame", null, "here"));
  assert.equal(f.xref, "here");
  assert.ok(Math.hypot(...m.coords(f.origin)) < 50,
    `the origin belongs beside the point it was given, not in the middle of the window: ${m.coords(f.origin)}`);
});

test("setDefaultFrame and defaultFrame() are the pointer, readable and clearable", () => {
  const m = new Model(2);
  const s = scopeWithView(m);
  assert.equal(callScope(s, "defaultFrame"), null);
  const f = callScope(s, "frame");
  assert.equal(callScope(s, "setDefaultFrame", f), f);
  assert.equal(callScope(s, "defaultFrame"), f);
  assert.equal(callScope(s, "setDefaultFrame", null), "no default frame");
  assert.equal(callScope(s, "defaultFrame"), null);
});

test("ls() names a frame by its pieces, and says which one is the default", () => {
  const m = new Model(2);
  const s = scopeWithView(m);
  const f = callScope(s, "frame");
  const line = () => (callScope(s, "ls") as unknown as string[]).find((l) => l.startsWith(f))!;
  assert.match(line(), /frame  origin p\d+, \+x toward p\d+$/);
  callScope(s, "setDefaultFrame", f);
  assert.match(line(), /\(default\)$/);
});

test("help() covers the frame vocabulary — it is the one thing with no world to fall back on", () => {
  const help = callScope(neocadScope({ model: new Model(2) }), "help");
  for (const word of ["frame(", "setDefaultFrame", "defaultFrame()", "no world frame"]) {
    assert.ok(help.includes(word), `help() should mention ${word}`);
  }
});

test("the format version says the vocabulary changed, and still reads the old envelope", () => {
  // 10 now that a feature's frames share its own points; 9 was a fillet
  // journalling the features it regenerated; 8 a
  // feature's profile carrying portions; circles and arcs
  // carrying a plane was 7, the app becoming 3D 6, `addFrame` taking a y-ref
  // before its name 5, `d`-named dimensions 4 and the hor/ver retirement 3.
  // Every boundary is a translation rather than a wall, so this file's own v2
  // fixture above still opens.
  assert.equal(VERSION, 10);
  // A version-1 file with nothing frameless in it opens unchanged: the version
  // wall is not what refuses the ones above, the missing frame is.
  const empty = JSON.stringify({ format: FORMAT, version: 1, dim: 2, journal: [], values: { points: {}, radii: {} } });
  assert.equal(open(empty).entities.size, 0);
  const future = JSON.stringify({ format: FORMAT, version: 11, dim: 2, journal: [], values: { points: {}, radii: {} } });
  assert.throws(() => open(future), /version 11, and this build only reads up to 10/);
});

test("a version-4 frame opens with its name where the name goes now, and re-saves as current", async () => {
  await loadKernel();
  // Exactly what the app wrote the day before 3D frames: the name third.
  const v4 = JSON.stringify({
    format: FORMAT, version: 4, dim: 2,
    journal: [
      { op: "addPoint", args: [[4, 6], "o"] },
      { op: "addPoint", args: [[4 + Math.cos(TILT), 6 + Math.sin(TILT)], "x"] },
      { op: "addFrame", args: ["o", "x", "base"] },
      { op: "addFrame", args: [null, null, "f2"] },
      { op: "setDefaultFrame", args: ["base"] },
      { op: "addPoint", args: [[0, 0], "p"] },
      { op: "fix", args: ["p", [3, 4], "base"] },
    ],
    values: { points: {}, radii: {} },
  });
  const m = open(v4);
  // A name that is not an auto-name is the case that matters: a build that
  // read the new arity the old way would have auto-named it and lost it.
  assert.equal(m.frame("base").origin, "o");
  assert.equal(m.frame("base").yref, undefined, "a 2D frame, as it always was");
  assert.ok(m.has("f2"));
  assert.deepEqual(m.journal[2], { op: "addFrame", args: ["o", "x", null, "base"] });
  assert.equal(m.solve().solved, true);
  const [c, s] = [Math.cos(TILT), Math.sin(TILT)];
  const at = m.coords("p");
  assert.ok(Math.hypot(at[0] - (4 + 3 * c - 4 * s), at[1] - (6 + 3 * s + 4 * c)) < 1e-9,
    `and it still means the same frame: p at ${at}`);

  const saved = save(m);
  assert.match(saved, /"version": 10/);
  assert.equal(save(open(saved)), saved, "stable from here on");

  // The translation is keyed on the version, not on how many arguments an
  // entry has: a version-5 file says all four, so a three-argument entry in
  // one is a hand edit, and it fails at its own step rather than being
  // guessed at.
  const edited = JSON.parse(saved);
  edited.journal[2] = { op: "addFrame", args: ["o", "x", "base"] };
  assert.throws(() => open(JSON.stringify(edited)), /step 3, addFrame\("o", "x", "base"\): a 2D frame takes no y-ref/);
});
