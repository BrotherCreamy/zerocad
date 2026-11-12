// Deleting things, and everything that has to be true afterwards.
//
// The cascade is the interesting part and it is Onshape's, not an invention:
// a relation takes nothing with it, a point takes whatever could not exist
// without it, and a curve takes the relations naming it but leaves the points
// alone. The other half of these tests is about the *journal* — a deletion is
// recorded as its expansion, and a saved file has to replay to exactly the
// model it was written from, names included.

import { test } from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { ensureKernelLoaded } from "../src/kernel/problem.ts";
import { Model } from "../src/model.ts";
import { coincident, dist, fix } from "../src/relations/basic.ts";
import { onCircle, parallel, radius } from "../src/relations/geometry.ts";
import { del, fillet } from "../src/operations.ts";
import { open, save } from "../src/persist.ts";
import { axisFrame } from "./frames.ts";

async function loadKernel() {
  const bytes = await readFile(new URL("../src/kernel/wasm-gen/neocad_kernel_bg.wasm", import.meta.url));
  await ensureKernelLoaded(bytes);
}

/** Everything a reopened model should agree with the original about. */
function shape(m: Model) {
  return {
    entities: [...m.entities.values()].map((e) => JSON.stringify(e)),
    relations: [...m.relations.values()].map((r) => `${r.name} ${r.op} ${JSON.stringify(r.args)}`),
    points: Object.fromEntries([...m.entities.values()].filter((e) => e.kind === "point")
      .map((e) => [e.name, m.coords(e.name).map((v) => Math.round(v * 1e9) / 1e9)])),
  };
}

/**
 * An axis-aligned rectangle p1..p4 / l1..l4, with p1 pinned — and the fixture
 * frame `f` (plus its two points) that hor/ver/fix are level with, which is
 * why the entity listings below start with three names the drawing did not
 * put there.
 */
function rectangle(): Model {
  const m = new Model(2);
  axisFrame(m);
  m.addPoint([0, 0], "p1");
  m.addPoint([40, 0], "p2");
  m.addPoint([40, 25], "p3");
  m.addPoint([0, 25], "p4");
  m.addLine("p1", "p2", "l1");
  m.addLine("p2", "p3", "l2");
  m.addLine("p3", "p4", "l3");
  m.addLine("p4", "p1", "l4");
  parallel(m, "l1", "f.x");   // r1
  parallel(m, "l3", "f.x");   // r2
  parallel(m, "l2", "f.y");   // r3
  parallel(m, "l4", "f.y");   // r4
  fix(m, "p1", [0, 0]);  // r5
  return m;
}

// --- the cascade -----------------------------------------------------------

test("deleting a relation removes its blocks and nothing else", async () => {
  await loadKernel();
  const m = new Model(2);
  axisFrame(m);
  m.addPoint([0, 0], "a");
  m.addPoint([9, 9], "b");
  fix(m, "a", [2, 3]);
  const coin = coincident(m, "a", "b");
  assert.equal(m.solve().solved, true);
  assert.deepEqual(m.coords("b").map((v) => Math.round(v)), [2, 3], "sanity: b followed a");

  const blocksBefore = m.problem.blockCount;
  assert.deepEqual(del(m, coin), [coin]);
  assert.equal(m.problem.blockCount, blocksBefore - 2, "both coordinates of the coincidence went");
  assert.equal(m.entities.size, 5, "and not one entity with it — a, b, and the fixture frame's three");

  // The proof that the equation is really gone, not merely unlisted: move the
  // point it used to follow and watch b stay where it is.
  del(m, "r1");
  fix(m, "a", [50, 60]);
  assert.equal(m.solve().solved, true);
  assert.deepEqual(m.coords("b").map((v) => Math.round(v)), [2, 3], "b is free of a now");
});

test("deleting a point takes exactly what could not survive without it", async () => {
  await loadKernel();
  const m = rectangle();
  // Adds the two tangent points p5, p6, the centre p7, the shorter lines l5,
  // l6 and the arc a1 — the corner p2 and l1, l2 stay, construction — and six
  // relations that land in *both* namespaces: the arc's radius is a dimension
  // (`d1`), while the tangent points' holds on the lines, the arc's endpoint
  // conditions and the two tangencies are constraints (`r6`–`r10`).
  fillet(m, "l1", "l2", 8);
  assert.equal(m.solve().solved, true);

  // p1 is an endpoint of l1, l4 and the shorter line l5, so all three go; and
  // with them every relation naming p1, l1, l4 or l5 — the fillet's own hold
  // and tangency on l1 among them.
  assert.deepEqual(del(m, "p1"), ["r1", "r4", "r5", "r6", "r9", "l1", "l4", "l5", "p1"]);
  assert.deepEqual([...m.entities.keys()],
    ["f_o", "f_x", "f", "p2", "p3", "p4", "l2", "l3", "p5", "p6", "p7", "l6", "a1"]);
  // The dimension survives in its own namespace and in its own place: the
  // cascade neither treats `d1` differently nor loses track of where it sat.
  assert.deepEqual([...m.relations.keys()], ["r2", "r3", "r7", "d1", "r8", "r10"]);

  // What is left is still a model, not wreckage: no relation refers to
  // anything that has gone, so it still solves.
  assert.equal(m.solve().solved, true);
});

test("deleting a curve takes its relations and leaves the points alone", async () => {
  await loadKernel();
  const m = rectangle();
  fillet(m, "l1", "l2", 8);
  m.solve();

  // The arc's radius, its endpoint conditions and both tangencies name a1.
  // The points do not: they were the drawing's points before the arc existed
  // — nor do the tangent points' holds on their lines, which name the lines.
  // `d1` is the radius — a dimension is taken by the cascade exactly as a
  // constraint is, and comes back in registry order among them.
  assert.deepEqual(del(m, "a1"), ["d1", "r8", "r9", "r10", "a1"]);
  assert.deepEqual([...m.entities.keys()],
    ["f_o", "f_x", "f", "p1", "p2", "p3", "p4", "l1", "l2", "l3", "l4", "p5", "p6", "p7", "l5", "l6"]);
  assert.deepEqual([...m.relations.keys()], ["r1", "r2", "r3", "r4", "r5", "r6", "r7"]);
  assert.equal(m.solve().solved, true);
});

test("the cascade reaches an arc through its start and end, not only its centre", async () => {
  await loadKernel();
  const m = new Model(2);
  m.addPoint([0, 0], "ctr");
  m.addPoint([10, 0], "s");
  m.addPoint([0, 10], "e");
  m.addArc("ctr", "s", "e", 10, null, "a");
  radius(m, "a", 10);
  m.addPoint([7, 7], "q");
  onCircle(m, "q", "a");

  // `d1` is the radius dimension, `r1` the point-on-circle constraint.
  assert.deepEqual(del(m, "s"), ["d1", "r1", "a", "s"], "the arc cannot outlive an endpoint");
  assert.deepEqual([...m.entities.keys()], ["ctr", "e", "q"], "the other points are not the arc's to take");
});

test("del of a name that is neither an entity nor a relation says so", async () => {
  await loadKernel();
  const m = rectangle();
  assert.throws(() => del(m, "p99"), /"p99" is not an entity or a relation/);
  assert.throws(() => del(m, "r99"), /"r99" is not an entity or a relation/);
  assert.throws(() => del(m, ""), /"" is not an entity or a relation/);
  assert.deepEqual([...m.entities.keys()].length, 11, "and changed nothing on the way out");
});

test("the primitives refuse to leave the model malformed", async () => {
  await loadKernel();
  const m = rectangle();
  // Working out what else has to go is `del`'s job; the primitives just say no,
  // so a hand-edited file gets a reason rather than a line with no endpoint.
  assert.throws(() => m.deleteEntity("p1"), /"p1" is still used by l1, l4/);
  assert.throws(() => m.deleteEntity("l1"), /"l1" is still constrained by r1/);
  assert.throws(() => m.deleteEntity("nope"), /"nope" is not an entity/);
  assert.throws(() => m.deleteRelation("r9"), /"r9" is not a relation/);
});

// --- tombstones ------------------------------------------------------------

test("a deleted point's variables are tombstoned, and cost memory rather than correctness", async () => {
  await loadKernel();
  const m = rectangle();
  assert.equal(m.solve().solved, true);
  const varsBefore = m.problem.varCount;
  const before = shape(m).points;

  del(m, "p3");
  assert.equal(m.problem.varCount, varsBefore,
    "the flat vector is not compacted — remapping every captured index list is a later problem");

  // Orphan variables take part in no residual, so the damped solve leaves them
  // exactly where they are and nothing else notices they are there.
  const report = m.solve();
  assert.equal(report.solved, true);
  assert.equal(Number.isFinite(report.maxResidual), true, "no NaN crept in from the orphans");
  for (const [name, at] of Object.entries(shape(m).points)) {
    assert.deepEqual(at, before[name], `${name} moved when nothing asked it to`);
  }
});

test("the tombstones survive a save/open, because a replay re-runs the same deletes", async () => {
  await loadKernel();
  const m = rectangle();
  m.solve();
  del(m, "p3");
  const reopened = open(save(m));
  assert.equal(reopened.problem.varCount, m.problem.varCount,
    "reopening does not shed the leak — worth knowing, and documented in STATUS");
});

// --- journal and replay ----------------------------------------------------

test("build, delete, save, open, save is a fixed point", async () => {
  await loadKernel();
  const m = rectangle();
  m.addPoint([80, 80], "stray");
  dist(m, "p2", "stray", 30);
  m.solve();
  del(m, "stray");

  const once = save(m);
  const reopened = open(once);
  assert.equal(save(reopened), once, "or repeated saves drift");
  assert.deepEqual(shape(reopened), shape(m));
  assert.equal(reopened.solve().solved, true);

  // The journal carries the expansion, one entry per name removed — not the
  // `del` call, whose cascade would have to be recomputed against a model that
  // may since have been built differently.
  assert.deepEqual(m.journal.slice(-2).map((e) => e), [
    // `d1`, not `r6`: the `dist` that measured to the stray point is a
    // dimension, and the journal records the name it actually had.
    { op: "deleteRelation", args: ["d1"] },
    { op: "deleteEntity", args: ["stray"] },
  ]);
});

test("a name deleted and then used again replays as the second thing", async () => {
  await loadKernel();
  const m = rectangle();
  m.solve();
  del(m, "p3");
  // The counter never goes backwards, so the name is only free because it is
  // being claimed explicitly — which is exactly what a replay will do too.
  m.addPoint([100, 100], "p3");
  dist(m, "p1", "p3", 50);
  m.solve();

  const reopened = open(save(m));
  assert.deepEqual(shape(reopened), shape(m));
  assert.equal(reopened.entities.get("p3")?.kind, "point");
  assert.deepEqual(reopened.dependents("p3"), [], "the new p3 is not the old one's line endpoint");
});

test("deleting a relation the fillet created replays correctly", async () => {
  await loadKernel();
  const m = rectangle();
  fillet(m, "l1", "l2", 8);
  m.solve();

  // r8 exists only because `fillet` expanded into it; nothing journalled it,
  // and the journal never will. Its deletion, on the other hand, is explicit —
  // so replay has to recreate it under the same name and then remove it. That
  // it is `r8` rather than `r9` is the fillet's radius having gone off into the
  // `d` namespace ahead of it, which is precisely what the version bump is for.
  assert.equal(m.relationOf("r8").op, "arcEndpoints");
  assert.ok(!m.journal.some((e) => e.op === "arcEndpoints"), "sanity: implicit on the way in");
  del(m, "r8");
  assert.ok(m.journal.some((e) => e.op === "deleteRelation" && e.args[0] === "r8"), "explicit on the way out");

  const reopened = open(save(m));
  assert.deepEqual(shape(reopened), shape(m));
  assert.ok(!reopened.relations.has("r8"));
  assert.deepEqual([...reopened.relations.keys()], ["r1", "r2", "r3", "r4", "r5", "r6", "r7", "d1", "r9", "r10"]);
  assert.equal(reopened.solve().solved, true);
});

test("relation names are deterministic across a replay, fillet's internals included", async () => {
  await loadKernel();
  const m = rectangle();
  fillet(m, "l1", "l2", 8);
  m.solve();

  const reopened = open(save(m));
  assert.deepEqual([...reopened.relations.keys()], [...m.relations.keys()]);
  for (const [name, r] of m.relations) {
    assert.equal(reopened.relationOf(name).op, r.op, `${name} came back as a different relation`);
    assert.deepEqual(reopened.relationOf(name).args, r.args);
  }
  // And the counter came back with them, so the next relation lands where it
  // would have in the original session rather than colliding.
  assert.equal(dist(reopened, "p2", "p3", 25), dist(m, "p2", "p3", 25));
});

test("del of several names is one call, cascades each, in order", async () => {
  await loadKernel();
  const m = new Model(2);
  m.addPoint([0, 0], "a");
  m.addPoint([10, 0], "b");
  m.addPoint([50, 50], "loner");
  m.addLine("a", "b", "l");
  const removed = del(m, "loner", "l");
  assert.deepEqual(removed, ["loner", "l"]);
  assert.ok(m.has("a") && m.has("b"), "the line's points were the user's points first");
});

test("a bad name anywhere in the batch removes nothing at all", async () => {
  await loadKernel();
  const m = new Model(2);
  m.addPoint([0, 0], "a");
  m.addPoint([10, 0], "b");
  assert.throws(() => del(m, "a", "nope", "b"), /"nope" is not/);
  assert.ok(m.has("a") && m.has("b"), "validation happens before the first removal");
  assert.ok(!m.journal.some((e) => e.op === "deleteEntity"), "and the journal saw none of it");
  assert.throws(() => del(m), /at least one name/);
});

test("a name an earlier cascade already took is skipped, not an error", async () => {
  await loadKernel();
  const m = new Model(2);
  m.addPoint([0, 0], "a");
  m.addPoint([10, 0], "b");
  m.addLine("a", "b", "l");
  dist(m, "a", "b", 10);
  // A box select hands over the point AND the line on it; deleting the point
  // takes the line, and the line's own turn must be a no-op.
  const removed = del(m, "a", "l");
  assert.deepEqual(removed.filter((n) => n === "l").length, 1, "the line went exactly once");
  assert.ok(!m.has("a") && !m.has("l"));
  assert.ok(m.has("b"));
  // And the journal replays to the same place.
  const reopened = open(save(m));
  assert.deepEqual(shape(reopened), shape(m));
});
