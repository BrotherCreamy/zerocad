// Dimensions: the `d` namespace, and `set()` editing one in place.
//
// The owner's decision was one sentence — editing a dimension "should be a
// `set(d4.value, 60)` where d4 is the dimension" — and nearly everything here
// is a consequence of taking it literally. There is no parameter table: the
// relation *is* the named value-holder, so the two things worth pinning are
// that the name is right (`d`, not `r`, and only for the three that carry a
// value) and that it survives an edit unchanged. A rebuild that produced `d7`
// out of `d4` would satisfy every numeric assertion in this file and destroy
// the entire point of the feature.

import { test } from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { ensureKernelLoaded } from "../src/kernel/problem.ts";
import { DIMENSION_OPS, Model, parseValueRef, relationPrefix, valueArgIndex } from "../src/model.ts";
import { coincident, dist, fix, midpoint } from "../src/relations/basic.ts";
import {
  angle, equalLength, equalRadius, onCircle, parallel, perpendicular, pointOnLine,
  radius, symmetric, tangent,
} from "../src/relations/geometry.ts";
import { del, set } from "../src/operations.ts";
import { FORMAT, open, save } from "../src/persist.ts";
import { axisFrame } from "./frames.ts";

async function loadKernel() {
  const bytes = await readFile(new URL("../src/kernel/wasm-gen/neocad_kernel_bg.wasm", import.meta.url));
  await ensureKernelLoaded(bytes);
}

/** Two points a known distance apart, with the fixture frame beside them. */
function pair(): Model {
  const m = new Model(2);
  axisFrame(m);
  m.addPoint([0, 0], "a");
  m.addPoint([10, 0], "b");
  return m;
}

const spanOf = (m: Model, p = "a", q = "b") =>
  Math.hypot(...m.coords(q).map((c, i) => c - m.coords(p)[i]));

// --- the namespace ---------------------------------------------------------

test("the three value-carrying relations are d-named and every other one is r-named", async () => {
  await loadKernel();
  const m = new Model(2);
  axisFrame(m);
  for (const [i, at] of [[0, 0], [10, 0], [10, 10], [0, 10], [4, 4], [20, 20]].entries()) {
    m.addPoint(at, `p${i + 1}`);
  }
  m.addLine("p1", "p2", "l1");
  m.addLine("p2", "p3", "l2");
  m.addCircle("p5", 5, "c1");
  m.addCircle("p6", 5, "c2");

  // A dimension is a number you put on the drawing. There are exactly three.
  assert.deepEqual([
    dist(m, "p1", "p2", 10),
    radius(m, "c1", 5),
    angle(m, "l1", "l2", Math.PI / 2),
  ], ["d1", "d2", "d3"]);

  // Everything else is a statement about shape, whatever numbers it happens to
  // mention. `fix` is the interesting one: it carries two coordinates, which is
  // not *a* value, and Onshape calls it a constraint too.
  assert.deepEqual([
    fix(m, "p1", [0, 0]),
    coincident(m, "p4", "p4"),
    midpoint(m, "p5", "l1"),
    parallel(m, "l1", "f.x"),
    perpendicular(m, "l1", "l2"),
    pointOnLine(m, "p6", "l1"),
    equalLength(m, "l1", "l2"),
    onCircle(m, "p4", "c1"),
    equalRadius(m, "c1", "c2"),
    tangent(m, "l2", "c1"),
    symmetric(m, "p3", "p4", "l1"),
  ], ["r1", "r2", "r3", "r4", "r5", "r6", "r7", "r8", "r9", "r10", "r11"]);

  // And the two claims the split rests on, said directly.
  assert.deepEqual([...DIMENSION_OPS].sort(), ["angle", "dist", "radius"]);
  assert.equal(relationPrefix("dist"), "d");
  assert.equal(relationPrefix("fix"), "r");
  // A relation authored at the command line has never heard of any of this and
  // gets an `r`, which is the right default: it has no value to set.
  assert.equal(relationPrefix("myOwnRelation"), "r");
});

test("a relation that throws puts back the counter it actually moved", async () => {
  await loadKernel();
  const m = pair();
  assert.equal(dist(m, "a", "b", 10), "d1");
  assert.equal(coincident(m, "a", "b"), "r1");

  const blocks = m.problem.blockCount;
  // Both bodies throw on a name that is not a point, which is the rollback path.
  assert.throws(() => dist(m, "a", "nope", 5), /"nope" is not a point/);
  assert.throws(() => coincident(m, "a", "nope"), /"nope" is not a point/);
  assert.equal(m.problem.blockCount, blocks, "a failed relation leaves no blocks behind");

  // The whole hazard of a per-op prefix: a failed `dist` that put back the "r"
  // counter would leave "d" advanced, and the next dimension would be d3.
  assert.equal(dist(m, "a", "b", 12), "d2");
  assert.equal(coincident(m, "b", "a"), "r2");
});

test("a name a relation might have wanted is stepped over in whichever namespace", async () => {
  await loadKernel();
  const m = pair();
  m.addPoint([1, 1], "d1"); // a point may be called d1 — but then no dimension is
  assert.equal(dist(m, "a", "b", 10), "d2", "the auto-name steps over the taken one");
  assert.throws(() => m.addPoint([2, 2], "d2"), /"d2" already exists/);
});

// --- set(), the happy path -------------------------------------------------

test("set edits the dimension in place: same name, same place, new value", async () => {
  await loadKernel();
  const m = pair();
  m.addLine("a", "b", "l");
  coincident(m, "a", "a");            // r1 — something before it in the registry
  const d = dist(m, "a", "b", 10);    // d1
  parallel(m, "l", "f.x");            // r2 — and something after it
  fix(m, "a", [0, 0]);                // r3
  assert.equal(m.solve().solved, true);
  assert.ok(Math.abs(spanOf(m) - 10) < 1e-9, "sanity: the drawing starts at 10");

  const order = [...m.relations.keys()];
  const oldBlocks = m.relationOf(d).blocks.slice();
  const blockCount = m.problem.blockCount;

  assert.equal(set(m, `${d}.value`, 60), d, "the name is what comes back, unchanged");

  assert.deepEqual([...m.relations.keys()], order, "and its position in the registry is untouched");
  assert.deepEqual(m.relationOf(d).args, ["a", "b", 60], "args tell the truth, so rels() and the glyph do");
  assert.equal(m.relationOf(d).op, "dist");

  // The old residual is *gone*, not merely unlisted. Counting blocks catches a
  // rebuild that left the old one in — which would still solve, to a drawing
  // that satisfies neither 10 nor 60.
  assert.equal(m.problem.blockCount, blockCount, "one block out, one block in");
  assert.notDeepEqual(m.relationOf(d).blocks, oldBlocks, "and it is a new block, not the old handle");
  for (const h of oldBlocks) {
    assert.throws(() => m.problem.removeBlock(h), /no residual block/,
      "the kernel has forgotten the old handle");
  }

  assert.equal(m.solve().solved, true);
  assert.ok(Math.abs(spanOf(m) - 60) < 1e-9, `the geometry moved to 60, got ${spanOf(m)}`);
});

test("a rebuilt dimension is still a first-class relation: rels, glyph args, del", async () => {
  await loadKernel();
  const m = pair();
  const d = dist(m, "a", "b", 10);
  set(m, `${d}.value`, 25);

  assert.deepEqual(m.relationsNaming("b").map((r) => r.name), [d], "still found by what it names");
  const blocks = m.problem.blockCount;
  assert.deepEqual(del(m, d), [d], "and still deletable under the same name");
  assert.equal(m.problem.blockCount, blocks - 1, "taking the *new* block with it, not a stale one");
  assert.equal(m.relations.has(d), false);
});

test("set works on a radius and on an angle, in the unit the relation stores", async () => {
  await loadKernel();
  const m = new Model(2);
  m.addPoint([0, 0], "ctr");
  m.addCircle("ctr", 5, "c");
  const dr = radius(m, "c", 5);
  assert.equal(dr, "d1");
  set(m, "d1.value", 12);
  assert.equal(m.solve().solved, true);
  assert.ok(Math.abs(m.radius("c") - 12) < 1e-9, `radius moved to 12, got ${m.radius("c")}`);

  // `ang` stores radians — the label reads degrees, and that seam is the
  // documented one. `set` takes what the relation stores and does not guess.
  m.addPoint([0, 0], "o");
  m.addPoint([10, 0], "p");
  m.addPoint([10, 10], "q");
  m.addLine("o", "p", "l1");
  m.addLine("o", "q", "l2");
  const da = angle(m, "l1", "l2", Math.PI / 2);
  assert.equal(da, "d2");
  set(m, "d2.value", Math.PI / 6);
  assert.equal(m.solve().solved, true);
  const between = (u: number[], v: number[]) =>
    Math.acos(Math.min(1, Math.abs(u[0] * v[0] + u[1] * v[1]) / (Math.hypot(...u) * Math.hypot(...v))));
  const u = m.coords("p").map((c, i) => c - m.coords("o")[i]);
  const v = m.coords("q").map((c, i) => c - m.coords("o")[i]);
  assert.ok(Math.abs(between(u, v) - Math.PI / 6) < 1e-6,
    `30° between the edges, got ${(between(u, v) * 180) / Math.PI}°`);
  assert.deepEqual(m.relationOf("d2").args, ["l1", "l2", Math.PI / 6], "radians, as stored");
});

// --- set(), the refusals ---------------------------------------------------

test("set says what is settable when it is handed something that is not", async () => {
  await loadKernel();
  const m = pair();
  m.addLine("a", "b", "l");
  const r = parallel(m, "l", "f.x");
  const d = dist(m, "a", "b", 10);

  // A relation with no value. The message names the three that have one, in
  // the short spellings the user typed to make them.
  assert.throws(() => set(m, `${r}.value`, 3), /"r1" is a parallel, not a dimension — only dist, rad and ang have a \.value/);
  // A name that is an entity, and a name that is nothing at all.
  assert.throws(() => set(m, "a.value", 3), /"a" is an entity, not a dimension/);
  assert.throws(() => set(m, "d99.value", 3), /"d99" is not a relation/);
  // An unknown property, and no property at all — both told what to type.
  assert.throws(() => set(m, `${d}.length`, 3), /"d1\.length" is not settable — the only settable property is "d1\.value"/);
  assert.throws(() => set(m, d, 3), /"d1" names no property — say "d1\.value"/);

  // A value that is not a number. `ang` says which unit it wanted, because that
  // is the throw a user holding degrees will actually meet.
  assert.throws(() => set(m, `${d}.value`, "60" as unknown as number), /set needs a number, got "60"/);
  assert.throws(() => set(m, `${d}.value`, NaN), /set needs a number, got null/);
  const da = angle(m, "l", "f.x", Math.PI / 4);
  assert.throws(() => set(m, `${da}.value`, undefined as unknown as number),
    /set needs a number of radians \(the label reads degrees; the relation stores radians\)/);

  // Nothing above changed anything: a refusal costs the drawing nothing.
  assert.deepEqual(m.relationOf(d).args, ["a", "b", 10]);
  assert.equal(m.journal.some((e) => e.op === "set"), false, "and journalled nothing");
});

test("a rebuild that throws leaves the old dimension exactly as it was", async () => {
  await loadKernel();
  const m = pair();
  const d = dist(m, "a", "b", 10);
  assert.equal(m.solve().solved, true);
  const blocks = m.problem.blockCount;
  const handles = m.relationOf(d).blocks.slice();

  // Reach past `set`'s own validation to the ordering guarantee underneath: a
  // body that throws must not have cost the relation its working blocks.
  assert.throws(() => m.rebuildRelation(d, "dist", ["a", "gone", 20], () => {
    dist(m, "a", "gone", 20);
  }), /"gone" is not a point/);

  assert.equal(m.problem.blockCount, blocks, "no blocks lost and none added");
  assert.deepEqual(m.relationOf(d).blocks, handles, "the original blocks are still the relation's");
  assert.deepEqual(m.relationOf(d).args, ["a", "b", 10]);
  assert.equal(m.solve().solved, true);
  assert.ok(Math.abs(spanOf(m) - 10) < 1e-9, "and it still constrains what it always did");
});

test("the value's place in the argument list is known for every dimension and nothing else", () => {
  assert.equal(valueArgIndex("dist"), 2);
  assert.equal(valueArgIndex("radius"), 1);
  assert.equal(valueArgIndex("angle"), 2);
  assert.equal(valueArgIndex("fix"), null);
  assert.equal(valueArgIndex("parallel"), null);
  // Every dimension has to have one, or `set` would reach an unreachable throw.
  for (const op of DIMENSION_OPS) assert.equal(typeof valueArgIndex(op), "number", op);
});

test("every op in DIMENSION_OPS can actually be rebuilt by set", async () => {
  await loadKernel();
  // Three tables have to agree for a dimension to work end to end: DIMENSION_OPS
  // (which gives it a `d` name), VALUE_ARG (which says where its value sits) and
  // operations.ts's REBUILD (which re-runs it). The first two are checked above;
  // this drives the third from the first, so adding a fourth dimension without a
  // REBUILD entry fails here rather than the first time a user types `set`.
  const fixtures: Record<string, (m: Model) => string> = {
    dist: (m) => dist(m, "a", "b", 10),
    radius: (m) => radius(m, "c", 5),
    angle: (m) => angle(m, "l1", "l2", Math.PI / 3),
  };
  for (const op of DIMENSION_OPS) {
    assert.ok(fixtures[op], `${op} is a dimension with no fixture here — add one, and a REBUILD entry`);
    const m = pair();
    m.addPoint([0, 10], "c2");
    m.addCircle("c2", 5, "c");
    m.addLine("a", "b", "l1");
    m.addLine("a", "c2", "l2");
    const name = fixtures[op](m);
    // Would throw `"<op>" cannot be rebuilt` if REBUILD were missing an entry.
    assert.equal(set(m, `${name}.value`, op === "angle" ? Math.PI / 4 : 7), name, op);
    assert.equal(m.solve().solved, true, op);
  }
});

test("parseValueRef is the f1.x syntax, one property along", () => {
  assert.deepEqual(parseValueRef("d4.value"), { name: "d4", property: "value" });
  assert.throws(() => parseValueRef("d4"), /names no property/);
  assert.throws(() => parseValueRef("d4.x"), /not settable/);
  // A name cannot contain a dot (claimName refuses one), so the first dot is
  // always the separator and there is no ambiguity to resolve.
  assert.throws(() => parseValueRef("f1.x.value"), /not settable/);
});

// --- journal, replay and undo ----------------------------------------------

test("set journals as the one call it was, and replays", async () => {
  await loadKernel();
  const m = pair();
  m.addLine("a", "b", "l");
  const d = dist(m, "a", "b", 10);
  parallel(m, "l", "f.x");
  set(m, `${d}.value`, 60);
  assert.equal(m.solve().solved, true);

  // One entry, the call as made — not the `dist` it rebuilt, which would make a
  // saved file carry the dimension twice.
  assert.deepEqual(m.journal.filter((e) => e.op === "set"), [{ op: "set", args: ["d1.value", 60] }]);
  assert.equal(m.journal.filter((e) => e.op === "dist").length, 1, "the rebuild journalled nothing");

  const reopened = open(save(m));
  assert.deepEqual([...reopened.relations.keys()], [...m.relations.keys()]);
  assert.deepEqual(reopened.relationOf(d).args, ["a", "b", 60]);
  assert.equal(reopened.solve().solved, true);
  assert.ok(Math.abs(spanOf(reopened) - 60) < 1e-9, "reopens at the value it was set to");
  assert.equal(save(open(save(m))), save(m), "and the file is a fixed point");
});

test("set survives being replayed twice over, and only the last value stands", async () => {
  await loadKernel();
  const m = pair();
  const d = dist(m, "a", "b", 10);
  set(m, `${d}.value`, 20);
  set(m, `${d}.value`, 35);
  m.solve();
  const reopened = open(save(m));
  assert.deepEqual(reopened.relationOf(d).args, ["a", "b", 35]);
  assert.equal(reopened.problem.blockCount, m.problem.blockCount,
    "each replayed set replaced a block rather than adding one");
});

// --- reading a file written before the rename ------------------------------

test("a version-3 file's deleteRelation is pointed at the name that relation has now", async () => {
  await loadKernel();
  // Written by the build before this change: relations were r1, r2, r3 in
  // creation order regardless of kind, and the deletion names the third.
  const v3 = JSON.stringify({
    format: FORMAT, version: 3, dim: 2,
    journal: [
      { op: "addPoint", args: [[0, 0], "p1"] },
      { op: "addPoint", args: [[10, 0], "p2"] },
      { op: "addPoint", args: [[10, 10], "p3"] },
      { op: "addLine", args: ["p1", "p2", "l1"] },
      { op: "addLine", args: ["p2", "p3", "l2"] },
      { op: "dist", args: ["p1", "p2", 10] },          // was r1, is now d1
      { op: "perpendicular", args: ["l1", "l2"] },     // was r2, is now r1
      { op: "dist", args: ["p2", "p3", 10] },          // was r3, is now d2
      { op: "deleteRelation", args: ["r3"] },          // the dimension between constraints
    ],
    values: { points: {}, radii: {} },
  });

  const m = open(v3);
  assert.deepEqual([...m.relations.keys()], ["d1", "r1"], "the right relation was removed");
  assert.equal(m.relationOf("d1").op, "dist");
  assert.equal(m.relationOf("r1").op, "perpendicular");
  assert.equal(m.solve().solved, true);

  // The rewritten name is installed in the journal too, or the file would keep
  // pointing at a name the model no longer uses and the migration would never
  // finish. That is the same rule the hor/ver translation follows.
  assert.deepEqual(m.journal.at(-1), { op: "deleteRelation", args: ["d2"] });
  const saved = save(m);
  assert.match(saved, /"version": 6/); // the current version, whatever later boundaries it crossed
  assert.equal(save(open(saved)), saved, "and the file is stable from here on");
});

test("the v3 map is computed from the replay, so an operation's hidden relations count", async () => {
  await loadKernel();
  // `fillet` is one journal entry that expands into four relations — a radius
  // (a dimension) and three constraints. A translation that scanned the journal
  // instead of watching the registry would be off by four from here on.
  const v3 = JSON.stringify({
    format: FORMAT, version: 3, dim: 2,
    journal: [
      { op: "addPoint", args: [[0, 0], "p1"] },
      { op: "addPoint", args: [[40, 0], "p2"] },
      { op: "addPoint", args: [[40, 25], "p3"] },
      { op: "addLine", args: ["p1", "p2", "l1"] },
      { op: "addLine", args: ["p2", "p3", "l2"] },
      { op: "dist", args: ["p1", "p2", 40] },   // was r1, is now d1
      { op: "fillet", args: ["l1", "l2", 8] },  // was r2..r5, is now d2, r1, r2, r3
      { op: "deleteRelation", args: ["r3"] },   // the arc's endpoint conditions
    ],
    values: { points: {}, radii: {} },
  });

  const m = open(v3);
  assert.deepEqual([...m.relations.keys()], ["d1", "d2", "r2", "r3"]);
  assert.equal(m.relations.has("r1"), false, "arcEndpoints — old r3 — is the one that went");
  assert.deepEqual(m.journal.at(-1), { op: "deleteRelation", args: ["r1"] });
});

test("the v3 map reproduces the old naming's one wrinkle: a name an entity had taken", async () => {
  await loadKernel();
  // The old `autoName` skipped a name already claimed, so a drawing with a
  // point called `r1` had its first relation named `r2`. Entity names are
  // untouched by this change, so the map has to skip in the same places.
  const v3 = JSON.stringify({
    format: FORMAT, version: 3, dim: 2,
    journal: [
      { op: "addPoint", args: [[0, 0], "r1"] },
      { op: "addPoint", args: [[10, 0], "b"] },
      { op: "dist", args: ["r1", "b", 10] },   // was r2 (r1 was taken), is now d1
      { op: "deleteRelation", args: ["r2"] },
    ],
    values: { points: {}, radii: {} },
  });

  const m = open(v3);
  assert.deepEqual([...m.relations.keys()], []);
  assert.equal(m.entities.has("r1"), true, "the point called r1 is untouched");
});

test("a version-3 file with no deletions needs no map, and opens unchanged", async () => {
  await loadKernel();
  const v3 = JSON.stringify({
    format: FORMAT, version: 3, dim: 2,
    journal: [
      { op: "addPoint", args: [[0, 0], "a"] },
      { op: "addPoint", args: [[10, 0], "b"] },
      { op: "dist", args: ["a", "b", 10] },
      { op: "coincident", args: ["a", "a"] },
    ],
    values: { points: { a: [0, 0], b: [10, 0] }, radii: {} },
  });
  const m = open(v3);
  assert.deepEqual([...m.relations.keys()], ["d1", "r1"]);
  assert.equal(m.solve().solved, true);
});

test("a deleteRelation naming nothing the map knows is left alone to fail on its own", async () => {
  await loadKernel();
  // A hand-edited file's typo. Rewriting it into something plausible would turn
  // a mistake into the deletion of whatever happened to be in that slot.
  const v3 = JSON.stringify({
    format: FORMAT, version: 3, dim: 2,
    journal: [
      { op: "addPoint", args: [[0, 0], "a"] },
      { op: "deleteRelation", args: ["r9"] },
    ],
    values: { points: {}, radii: {} },
  });
  assert.throws(() => open(v3), /"r9" is not a relation/);
});
