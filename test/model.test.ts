import { test } from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { ensureKernelLoaded } from "../src/kernel/problem.ts";
import { Model } from "../src/model.ts";
import { dist, fix, coincident, midpoint } from "../src/relations/basic.ts";
import { arcEndpoints, concentric, parallel, radius } from "../src/relations/geometry.ts";
import { axisFrame } from "./frames.ts";

async function loadKernel() {
  const bytes = await readFile(new URL("../src/kernel/wasm-gen/neocad_kernel_bg.wasm", import.meta.url));
  await ensureKernelLoaded(bytes);
}

test("2D: fix + dist solves a triangle-free two-point system", async () => {
  await loadKernel();
  const m = new Model(2);
  axisFrame(m); // fix and the axis references are frame-relative — see test/frames.ts
  m.addPoint([0, 0], "a");
  m.addPoint([3, 4], "b");
  fix(m, "a", [0, 0]);
  dist(m, "a", "b", 10);
  const report = m.solve();
  assert.equal(report.solved, true, JSON.stringify(report.offenders));
  const [bx, by] = m.coords("b");
  assert.ok(Math.abs(Math.hypot(bx, by) - 10) < 1e-6);
});

test("3D: the exact same relation code works with 3 coordinates", async () => {
  await loadKernel();
  const m = new Model(3);
  // `fix` is frame-relative in 3D as in 2D since 3D frames closed the gauge
  // seam; the kernel-aligned fixture keeps [0, 0, 0] meaning what it did.
  axisFrame(m);
  m.addPoint([0, 0, 0], "a");
  m.addPoint([1, 1, 1], "b");
  fix(m, "a", [0, 0, 0]);
  dist(m, "a", "b", 5);
  const report = m.solve();
  assert.equal(report.solved, true, JSON.stringify(report.offenders));
  const [bx, by, bz] = m.coords("b");
  assert.ok(Math.abs(Math.hypot(bx, by, bz) - 5) < 1e-6);
});

test("coincident merges two points regardless of starting position", async () => {
  await loadKernel();
  const m = new Model(2);
  axisFrame(m);
  m.addPoint([0, 0], "a");
  m.addPoint([9, 9], "b");
  fix(m, "a", [2, 3]);
  coincident(m, "a", "b");
  const report = m.solve();
  assert.equal(report.solved, true, JSON.stringify(report.offenders));
  assert.deepEqual(m.coords("b").map((v) => Math.round(v * 1e6) / 1e6), [2, 3]);
});

test("midpoint tracks two independently-fixed endpoints", async () => {
  await loadKernel();
  const m = new Model(2);
  axisFrame(m);
  m.addPoint([0, 0], "a");
  m.addPoint([10, 0], "b");
  m.addPoint([0, 0], "mid");
  fix(m, "a", [0, 0]);
  fix(m, "b", [10, 20]);
  midpoint(m, "mid", "a", "b");
  const report = m.solve();
  assert.equal(report.solved, true, JSON.stringify(report.offenders));
  const [mx, my] = m.coords("mid");
  assert.ok(Math.abs(mx - 5) < 1e-6 && Math.abs(my - 10) < 1e-6, `mid = ${mx},${my}`);
});

// --- the relation registry -------------------------------------------------
//
// Entities have had names since the beginning; relations have not, which made
// a constraint something you could add and never refer to again. These pin the
// naming discipline, because everything about deletion and about replaying a
// saved file rests on the names coming out the same way twice.

test("relations are named r1, r2, … — or d1, d2, … — and carry the call that made them", async () => {
  await loadKernel();
  const m = new Model(2);
  axisFrame(m);
  m.addPoint([0, 0], "a");
  m.addPoint([3, 4], "b");
  // `fix` is a constraint and `dist` a dimension, so the two counters run
  // independently: the second relation made is `d1`, not `r2`.
  const r1 = fix(m, "a", [0, 0]);
  const d1 = dist(m, "a", "b", 10);
  assert.deepEqual([r1, d1], ["r1", "d1"]);

  const entry = m.relationOf("d1");
  assert.equal(entry.op, "dist");
  assert.deepEqual(entry.args, ["a", "b", 10]);
  assert.equal(entry.blocks.length, 1, "dist is one residual block");
  assert.equal(m.relationOf("r1").blocks.length, 2, "fix is one block per coordinate");
  assert.throws(() => m.relationOf("r9"), /"r9" is not a relation/);
});

test("relationsNaming finds every relation that mentions an entity", async () => {
  await loadKernel();
  const m = new Model(2);
  axisFrame(m);
  m.addPoint([0, 0], "a");
  m.addPoint([10, 0], "b");
  m.addLine("a", "b", "l");
  fix(m, "a", [0, 0]);
  dist(m, "a", "b", 10);
  parallel(m, "l", "f.x");

  // Registry order, not name order: `d1` (the dist) was made before `r2` (the
  // par), and a mixed namespace must not reorder the answer.
  assert.deepEqual(m.relationsNaming("a").map((r) => r.name), ["r1", "d1"]);
  assert.deepEqual(m.relationsNaming("l").map((r) => r.name), ["r2"]);
  assert.deepEqual(m.relationsNaming("b").map((r) => r.name), ["d1"]);
  assert.deepEqual(m.relationsNaming("nothing"), []);
});

test("entities and relations share one namespace, so a name means one thing", async () => {
  await loadKernel();
  const m = new Model(2);
  axisFrame(m);
  m.addPoint([0, 0], "r1"); // a point may be called r1 — but then no relation is
  m.addPoint([1, 1], "b");
  assert.equal(fix(m, "r1", [0, 0]), "r2", "the auto-name steps over the taken one");
  assert.throws(() => m.addPoint([2, 2], "r2"), /"r2" already exists/);
});

test("a relation built out of another is one relation, not two", async () => {
  await loadKernel();
  const m = new Model(2);
  m.addPoint([0, 0], "c1ctr");
  m.addPoint([5, 5], "c2ctr");
  m.addCircle("c1ctr", 3, null, "c1");
  m.addCircle("c2ctr", 4, null, "c2");

  // concentric is defined as a coincident on the two centres; arcEndpoints as
  // two onCircles. Each is one entry, owning all of the blocks.
  const name = concentric(m, "c1", "c2");
  assert.deepEqual([...m.relations.keys()], [name]);
  assert.equal(m.relationOf(name).op, "concentric");
  assert.equal(m.relationOf(name).blocks.length, 2, "both coordinates of the coincidence");

  // ...and the inner call does not journal itself either, which is what used to
  // make a reopened file carry the coincidence a second time.
  assert.deepEqual(m.journal.map((e) => e.op).filter((op) => op !== "addPoint" && op !== "addCircle"),
    ["concentric"]);
});

test("an arcEndpoints owns both of its onCircle blocks", async () => {
  await loadKernel();
  const m = new Model(2);
  m.addPoint([0, 0], "ctr");
  m.addPoint([10, 0], "s");
  m.addPoint([0, 10], "e");
  m.addArc("ctr", "s", "e", 10, null, "arc");
  const rad = radius(m, "arc", 10);
  const ends = arcEndpoints(m, "arc");
  assert.equal(m.relationOf(rad).blocks.length, 1);
  assert.equal(m.relationOf(ends).blocks.length, 2);
  assert.equal(m.problem.blockCount, 3);
});

test("a relation that throws leaves no name, no journal entry and no blocks", async () => {
  await loadKernel();
  const m = new Model(2);
  axisFrame(m);
  m.addPoint([0, 0], "a");
  const before = m.problem.blockCount;
  const journalled = m.journal.length; // the fixture frame's entries and the addPoint

  assert.throws(() => fix(m, "a", [0, 0, 0]), /fix needs 2 coordinates/);
  assert.equal(m.relations.size, 0, "nothing registered");
  assert.equal(m.problem.blockCount, before, "and nothing left in the problem");
  assert.deepEqual(m.journal.slice(journalled).map((e) => e.op), [], "and nothing journalled");

  // The harder case, which the shipped relations happen not to reach because
  // they all validate up front: a body that gets some blocks in and *then*
  // throws. Those blocks have to be taken back out, or the drawing keeps a
  // constraint that no relation admits to owning and nothing can ever remove.
  assert.throws(() => m.relation("halfBuilt", ["a"], () => {
    m.addResidual(m.point("a").varIndices, (l) => [l[0]], "half");
    throw new Error("changed my mind");
  }), /changed my mind/);
  assert.equal(m.problem.blockCount, before, "the half-built relation left nothing behind");
  assert.equal(m.relations.size, 0);

  // Crucially the name counter is back where it was, or a replay — which only
  // ever performs the calls that succeeded — would name everything after it
  // one step out.
  assert.equal(fix(m, "a", [0, 0]), "r1");
});
