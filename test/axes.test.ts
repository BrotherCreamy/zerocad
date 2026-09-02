// Frame-axis references: `par("l1", "f1.y")` and everything that follows from
// a relation argument that names a direction rather than an entity.
//
// This is what `hor` and `ver` became. The interesting assertions are not that
// a line levels out — `par` could already do that against another line — but
// that the *frame side never moves*, that a reference cannot collide with an
// entity name, and that deleting a frame reaches the relations that only ever
// mentioned one of its axes.

import { test } from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { ensureKernelLoaded } from "../src/kernel/problem.ts";
import { Model, parseAxisRef } from "../src/model.ts";
import { dist, fix } from "../src/relations/basic.ts";
import { angle, equalLength, parallel, perpendicular, pointOnLine } from "../src/relations/geometry.ts";
import { del } from "../src/operations.ts";

async function loadKernel() {
  const bytes = await readFile(new URL("../src/kernel/wasm-gen/neocad_kernel_bg.wasm", import.meta.url));
  await ensureKernelLoaded(bytes);
}

const TILT = Math.PI / 6; // 30°, which no axis-aligned accident lands on

/** A model whose frame `f` is tilted by `TILT` about the origin. */
function tilted(): Model {
  const m = new Model(2);
  m.addPoint([0, 0], "o");
  m.addPoint([Math.cos(TILT), Math.sin(TILT)], "x");
  m.addFrame("o", "x", "f");
  m.setDefaultFrame("f");
  return m;
}

/** The direction of line `name`, as an angle. */
function heading(m: Model, name: string): number {
  const l = m.line(name);
  const [a, b] = [m.coords(l.refs[0]), m.coords(l.refs[1])];
  return Math.atan2(b[1] - a[1], b[0] - a[0]);
}

/**
 * How far two headings are apart as *undirected* lines. `par` and `perp` are
 * both claims about a line, not a ray — a line pointing the other way along
 * the same axis satisfies either of them — so the assertions that only care
 * about the axis go through this rather than pretending a sign is meaningful.
 */
function apart(a: number, b: number): number {
  const d = Math.abs(a - b) % Math.PI;
  return Math.min(d, Math.PI - d);
}

// --- the syntax ------------------------------------------------------------

test("parseAxisRef: a dot means a frame's axis, and nothing else may", () => {
  assert.equal(parseAxisRef("l1"), null, "an ordinary name is not a reference");
  assert.deepEqual(parseAxisRef("f1.x"), { frame: "f1", axis: "x" });
  assert.deepEqual(parseAxisRef("f1.y"), { frame: "f1", axis: "y" });
  // A dot followed by anything else is a typo with no other reading, so it
  // says so rather than being handed on as a name nothing will match.
  assert.throws(() => parseAxisRef("f1.z"), /"f1\.z" is not a frame axis — say "f1\.x" or "f1\.y"/);
  assert.throws(() => parseAxisRef("f1."), /is not a frame axis/);
});

test("a name cannot contain a dot, so a reference can never collide with one", () => {
  const m = new Model(2);
  // The guard is at claimName, which is every entity kind's one way in.
  assert.throws(() => m.addPoint([0, 0], "f1.x"), /cannot contain a dot — "f1\.x" names a frame's axis/);
  assert.throws(() => m.addLine(null, null, "a.b"), /cannot contain a dot/);
  assert.throws(() => m.addFrame(null, null, "w.x"), /cannot contain a dot/);
});

test("an unknown frame or a bad suffix is refused where it is written", () => {
  const m = tilted();
  m.addLine(null, null, "l");
  assert.throws(() => parallel(m, "l", "g.x"), /"g" is not a frame/);
  assert.throws(() => parallel(m, "l", "f.z"), /is not a frame axis/);
  // A line by that name is still just a line; nothing has changed for it.
  assert.throws(() => parallel(m, "l", "nope"), /"nope" is not a line/);
  assert.equal(m.relations.size, 0, "and none of the attempts left a relation");
  assert.equal(m.problem.blockCount, 0);
});

test("axis references are 2D-only, because a frame is", () => {
  const m = new Model(3);
  m.addPoint([0, 0, 0], "a");
  m.addPoint([1, 1, 1], "b");
  m.addLine("a", "b", "l");
  assert.throws(() => parallel(m, "l", "f.x"), /a frame is a 2D entity, so its axes are too/);
});

// --- what they mean --------------------------------------------------------

test("par against a frame's x is what hor was: the line settles at the frame's tilt", async () => {
  await loadKernel();
  const m = tilted();
  m.addPoint([0, 0], "a");
  m.addPoint([9, 1], "b"); // nowhere near either the frame's axis or the gauge's
  m.addLine("a", "b", "l");
  fix(m, "a", [0, 0]);
  dist(m, "a", "b", 10);
  parallel(m, "l", "f.x");

  assert.equal(m.solve().solved, true);
  assert.ok(Math.abs(heading(m, "l") - TILT) < 1e-9,
    `the line settled at ${heading(m, "l")}, not the frame's ${TILT}`);
});

test("par against a frame's y is what ver was — parallel to +y, not perpendicular to +x", async () => {
  await loadKernel();
  const m = tilted();
  m.addPoint([0, 0], "a");
  m.addPoint([3, 9], "b");
  m.addLine("a", "b", "l");
  fix(m, "a", [0, 0]);
  dist(m, "a", "b", 10);
  parallel(m, "l", "f.y");

  assert.equal(m.solve().solved, true);
  assert.ok(Math.abs(heading(m, "l") - (TILT + Math.PI / 2)) < 1e-9,
    `the line settled at ${heading(m, "l")}, not the frame's +y at ${TILT + Math.PI / 2}`);
});

test("perp against an axis squares up to it", async () => {
  await loadKernel();
  const m = tilted();
  m.addPoint([0, 0], "a");
  m.addPoint([9, 1], "b");
  m.addLine("a", "b", "l");
  fix(m, "a", [0, 0]);
  dist(m, "a", "b", 10);
  perpendicular(m, "l", "f.x");

  assert.equal(m.solve().solved, true);
  assert.ok(apart(heading(m, "l"), TILT + Math.PI / 2) < 1e-9,
    `perpendicular to +x should lie along +y, and the line is at ${heading(m, "l")}`);
});

test("ang against an axis: an edge at a stated angle to the frame", async () => {
  await loadKernel();
  const m = tilted();
  m.addPoint([0, 0], "a");
  m.addPoint([9, 1], "b");
  m.addLine("a", "b", "l");
  fix(m, "a", [0, 0]);
  dist(m, "a", "b", 10);
  angle(m, "l", "f.x", Math.PI / 4);

  assert.equal(m.solve().solved, true);
  // Unsigned, so either side of the axis satisfies it; the seed is above it.
  assert.ok(Math.abs(Math.abs(heading(m, "l") - TILT) - Math.PI / 4) < 1e-9,
    `expected 45° off the frame's ${TILT}, got ${heading(m, "l")}`);
});

test("the axis side is read and never pushed — the frame does not meet the line halfway", async () => {
  await loadKernel();
  const m = tilted();
  m.addPoint([0, 0], "a");
  m.addPoint([40, 7], "b"); // a long line, badly out of level: the tempting case
  m.addLine("a", "b", "l");
  fix(m, "a", [0, 0]);
  parallel(m, "l", "f.x");
  m.solve();

  // The measurement the frames register records: declaring the frame's points
  // as variables lets least squares turn the *frame* by about 8° of a 9° error
  // and shrink its arm besides. Both numbers stay at zero here.
  assert.deepEqual(m.coords("o"), [0, 0], "the frame's origin did not move");
  const x = m.coords("x");
  assert.ok(Math.abs(Math.atan2(x[1], x[0]) - TILT) < 1e-12, "and its x-ref did not turn");
  assert.ok(Math.abs(Math.hypot(x[0], x[1]) - 1) < 1e-12, "nor did its arm shorten");
  assert.ok(Math.abs(heading(m, "l") - TILT) < 1e-9, "the line is what moved");
});

test("two ordinary lines still push each other — the asymmetry is the datum, not par", async () => {
  await loadKernel();
  const m = new Model(2);
  m.addPoint([0, 0], "a");
  m.addPoint([10, 2], "b");
  m.addPoint([0, 5], "c");
  m.addPoint([10, 3], "d");
  m.addLine("a", "b", "l1");
  m.addLine("c", "d", "l2");
  const before = [heading(m, "l1"), heading(m, "l2")];
  parallel(m, "l1", "l2");

  assert.equal(m.solve().solved, true);
  const after = [heading(m, "l1"), heading(m, "l2")];
  assert.ok(Math.abs(after[0] - after[1]) < 1e-9, "they ended up parallel");
  assert.ok(Math.abs(after[0] - before[0]) > 1e-6, "and l1 moved to get there");
  assert.ok(Math.abs(after[1] - before[1]) > 1e-6, "and so did l2");
});

test("the frame is re-read every evaluation, so turning it turns the drawing", async () => {
  await loadKernel();
  const m = tilted();
  m.addPoint([0, 0], "a");
  m.addPoint([10, 0], "b");
  m.addLine("a", "b", "l");
  fix(m, "a", [0, 0]);
  dist(m, "a", "b", 10);
  parallel(m, "l", "f.x");
  m.solve();

  const turned = TILT + 0.4;
  m.setCoords("x", [Math.cos(turned), Math.sin(turned)]);
  assert.equal(m.solve().solved, true);
  assert.ok(Math.abs(heading(m, "l") - turned) < 1e-9,
    `the drawing should have followed the frame to ${turned}, and is at ${heading(m, "l")}`);
});

// --- the point-pair form ---------------------------------------------------

test("par takes a point pair, the form hor had — and journals all three names", async () => {
  await loadKernel();
  const m = tilted();
  m.addPoint([0, 0], "p");
  m.addPoint([10, 4], "q");
  fix(m, "p", [0, 0]);
  dist(m, "p", "q", 10);
  const r = parallel(m, "p", "q", "f.x");
  assert.deepEqual(m.relationOf(r).args, ["p", "q", "f.x"]);

  assert.equal(m.solve().solved, true);
  const [a, b] = [m.coords("p"), m.coords("q")];
  assert.ok(Math.abs(Math.atan2(b[1] - a[1], b[0] - a[0]) - TILT) < 1e-9,
    "the pair lines up with the frame's +x, exactly as hor(p, q, f) did");
});

test("a point pair with nothing to be relative to says so", () => {
  const m = tilted();
  m.addPoint([0, 0], "p");
  m.addPoint([1, 1], "q");
  assert.throws(() => parallel(m, "p", "q"),
    /"p" is a point: give the second point and what the pair is relative to/);
  m.addLine(null, null, "l");
  assert.throws(() => parallel(m, "l", "f.x", "f.y"),
    /"l" is not a point, so this takes two references, not three/);
});

// --- the relations that deliberately do not take one -----------------------

test("the relations an axis reference is meaningless for refuse it as a name", () => {
  const m = tilted();
  m.addLine(null, null, "l1");
  m.addLine(null, null, "l2");
  m.addPoint([1, 1], "p");
  // An axis has no length, so there is nothing for `eq` to equal...
  assert.throws(() => equalLength(m, "l1", "f.x"), /"f\.x" is not a line/);
  // ...and no position, so `on` has no line to lie on. `fix(p, [t, 0])` is how
  // "somewhere along the frame's x" is said, against a frame that has an origin.
  assert.throws(() => pointOnLine(m, "p", "f.x"), /"f\.x" is not a line/);
});

// --- deletion --------------------------------------------------------------

test("deleting a frame reaches a relation that named only one of its axes", async () => {
  await loadKernel();
  const m = tilted();
  m.addLine(null, null, "l");
  const r = parallel(m, "l", "f.x");
  assert.deepEqual(m.relationsNaming("f").map((e) => e.name), [r],
    "`f.x` counts as naming `f`, or the frame could be deleted out from under it");

  assert.deepEqual(del(m, "f"), [r, "f"]);
  assert.ok(m.has("l"), "the line it constrained outlives it");
  assert.equal(m.solve().solved, true, "and the drawing still solves, with no dangling residual");
});

test("a frame's point takes the frame, and the frame takes the axis-referenced relation", async () => {
  await loadKernel();
  const m = tilted();
  m.addLine(null, null, "l");
  parallel(m, "l", "f.y");
  assert.deepEqual(del(m, "x"), ["r1", "f", "x"], "the cascade runs inward, all the way");
});
