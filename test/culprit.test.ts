// A conflict names the relation whose addition made it, and the set it
// disagrees with (docs/plans/review-solver.md, item 3 of the review against
// the owner's principle). It used to name a minimal set and say that it
// cannot all hold — which is true, and leaves the reader to work out which of
// them they just did.
//
// The drawing solved before the edit that broke it, so that edit is the
// culprit and is known without a search: the one relation of the failed part
// that has not yet held in a solve. The search is for what it cannot hold
// with. Each case in 2D and in 3D, on a frame tipped off every kernel axis.

import { test } from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { ensureKernelLoaded } from "../src/kernel/problem.ts";
import { Model, type Conflict } from "../src/model.ts";
import { dist, fix, onPlane } from "../src/relations/basic.ts";
import { parallel, perpendicular } from "../src/relations/geometry.ts";
import { among } from "../src/relations/among.ts";
import { join, leave } from "../src/among.ts";
import { describeRelation } from "../src/picking.ts";
import { del, extrude, set } from "../src/operations.ts";
import { open, save } from "../src/persist.ts";
import { diagnosisLine } from "../src/statusline.ts";
import { conflictRoles, paletteFor, type HeldRow } from "../src/constraints.ts";
import { tiltedFrame, type TiltedFrame } from "./frames.ts";
import { polygon } from "./profiles.ts";
import "../src/modules/builtin.ts";

await ensureKernelLoaded(await readFile(new URL("../src/kernel/wasm-gen/neocad_kernel_bg.wasm", import.meta.url)));

const lengthOf = (m: Model, l: string) => Math.hypot(...m.coords(m.line(l).refs[1]).map((c, i) => c - m.coords(m.line(l).refs[0])[i]));
const sorted = (xs: string[]) => [...xs].sort();

/** A sketch in `dim` dimensions: 2D as it is, 3D on a tilted frame with every point held on its plane. */
function sketch(dim: number): { m: Model; t: TiltedFrame | null; pt: (u: number, v: number, name: string) => string } {
  const m = new Model(dim);
  // What is named is asked of the trials, not of the clock (test/conflicts.test.ts says why); the bound has its own test.
  m.searchMs = Infinity;
  const t = dim === 3 ? tiltedFrame(m) : null;
  const pt = (u: number, v: number, name: string) => {
    m.addPoint(t ? t.at(u, v) : [u, v], name);
    if (t) onPlane(m, name, t.name);
    return name;
  };
  return { m, t, pt };
}

/** A rectangle as the rectangle tool leaves one in a sketch: four corners, four sides, a perp at every corner. */
function rectangle(dim: number) {
  const s = sketch(dim);
  [[0, 0], [40, 0], [40, 30], [0, 30]].forEach(([x, y], i) => s.pt(x, y, `p${i + 1}`));
  for (let i = 1; i <= 4; i++) s.m.addLine(`p${i}`, `p${(i % 4) + 1}`, `l${i}`);
  const perps = [1, 2, 3, 4].map((i) => perpendicular(s.m, `l${i}`, `l${(i % 4) + 1}`));
  assert.equal(s.m.solve().solved, true);
  return { ...s, perps };
}

/** Solves, expecting a conflict, and hands back what was said of it. */
function conflictsOf(m: Model): { conflicts: Conflict[]; relations: string[] } {
  const report = m.solve();
  assert.equal(report.solved, false, `solved — collapsed ${report.collapsed}`);
  const c = m.conflicting(report);
  return { conflicts: c.conflicts, relations: c.relations };
}

for (const dim of [2, 3]) {
  const D = `${dim}D`;

  test(`${D}: the owner's first bug — a par across a corner of a rectangle names the par, against that corner's perp`, () => {
    const { m, perps } = rectangle(dim);
    const before = m.problem.snapshot();
    const par = parallel(m, "l1", "l2");
    const { conflicts, relations } = conflictsOf(m);
    assert.deepEqual(conflicts, [{ culprit: par, set: [perps[0]], found: true }]);
    assert.deepEqual(relations, [par, perps[0]], "the culprit first, then what it is against");
    assert.deepEqual(m.problem.snapshot(), before, "and the rectangle is exactly where it was");
  });

  test(`${D}: with that perp deleted the par is still what made it — now against the two far corners' perps`, () => {
    // The par has still never held, so it is still the culprit, whatever is
    // deleted beside it; and what it is against is found afresh.
    const { m, perps } = rectangle(dim);
    const par = parallel(m, "l1", "l2");
    conflictsOf(m);
    del(m, perps[0]);
    const { conflicts } = conflictsOf(m);
    assert.equal(conflicts.length, 1);
    assert.equal(conflicts[0].culprit, par);
    assert.equal(conflicts[0].found, true);
    const set = conflicts[0].set;
    assert.ok(set.length >= 2 && set.every((n) => perps.slice(1).includes(n)), `against ${set}`);
    // The least set, asked the way the search asks it — of the par and that
    // set alone, since the rest of the rectangle holds a conflict of its own
    // with the par (every pair of the three perps left does): with all of the
    // set the par cannot hold, and without any one of it it can.
    const only = (keep: string[]) => {
      const copy = open(save(m), dim);
      for (const n of perps.slice(1)) if (!keep.includes(n)) del(copy, n);
      return copy.solve().solved;
    };
    assert.equal(only(set), false, `the par against ${set}`);
    for (const n of set) assert.equal(only(set.filter((x) => x !== n)), true, `without ${n} the par holds against ${set.filter((x) => x !== n)}`);
  });

  test(`${D}: an edit elsewhere does not lose who made it; deleting the culprit clears it, and what was against it has held all along`, () => {
    const { m, perps, pt } = rectangle(dim);
    const par = parallel(m, "l1", "l2");
    conflictsOf(m);
    pt(80, 0, "q1"); pt(95, 4, "q2"); m.addLine("q1", "q2", "m1");
    dist(m, "q1", "q2", 20);
    const { conflicts } = conflictsOf(m);
    assert.deepEqual(conflicts, [{ culprit: par, set: [perps[0]], found: true }], "the same, after a line and a dimension drawn beside it");
    assert.ok(Math.abs(lengthOf(m, "m1") - 20) < 1e-6, "and the part apart from the conflict solved");
    del(m, par);
    const report = m.solve();
    assert.equal(report.solved, true);
    assert.deepEqual(m.conflicting(report).conflicts, []);
  });

  test(`${D}: a dimension just set — that dimension, against its set`, () => {
    // A level rectangle 40 by 25 with its diagonal dimensioned at what it is.
    // Set to 30, the diagonal cannot hold against a side of 40 at a square
    // corner: the hypotenuse is the longest side. The 25 is no part of it.
    const { m, pt, t } = sketch(dim);
    [[0, 0], [40, 0], [40, 25], [0, 25]].forEach(([x, y], i) => pt(x, y, `k${i}`));
    for (let i = 0; i < 4; i++) m.addLine(`k${i}`, `k${(i + 1) % 4}`, `e${i}`);
    const f = t ? t.name : "origin";
    const level = [parallel(m, "e0", `${f}.x`), parallel(m, "e1", `${f}.y`), parallel(m, "e2", `${f}.x`), parallel(m, "e3", `${f}.y`)];
    fix(m, "k0", dim === 2 ? [0, 0] : [0, 0, 0]);
    const w = dist(m, "k0", "k1", 40), h = dist(m, "k1", "k2", 25);
    const diag = dist(m, "k0", "k2", Math.hypot(40, 25));
    assert.equal(m.solve().solved, true);
    const before = m.problem.snapshot();
    set(m, `${diag}.value`, 30);
    const { conflicts } = conflictsOf(m);
    assert.equal(conflicts.length, 1);
    assert.equal(conflicts[0].culprit, diag, "the dimension whose value was set");
    assert.deepEqual(sorted(conflicts[0].set), sorted([level[0], level[1], w]), `against ${conflicts[0].set}`);
    assert.ok(!conflicts[0].set.includes(h));
    assert.deepEqual(m.problem.snapshot(), before, "and nothing moved: a value that cannot hold is not half-applied");
    // Set back, it holds again and has held.
    set(m, `${diag}.value`, Math.hypot(40, 25));
    assert.equal(m.solve().solved, true);
  });

  test(`${D}: a file opened in conflict — the set, none singled out`, () => {
    const { m, perps } = rectangle(dim);
    const par = parallel(m, "l1", "l2");
    conflictsOf(m);
    const back = open(save(m), dim);
    back.searchMs = Infinity;
    const { conflicts, relations } = conflictsOf(back);
    assert.equal(conflicts.length, 1);
    assert.equal(conflicts[0].culprit, null, "nothing in an opened file has held here, so nothing is the one that broke it");
    assert.equal(conflicts[0].found, true);
    assert.deepEqual(sorted(conflicts[0].set), sorted([par, perps[0]]));
    assert.deepEqual(sorted(relations), sorted([par, perps[0]]));
  });

  test(`${D}: an edit that is more than one relation — the set, none singled out`, () => {
    const { m } = rectangle(dim);
    const two = [parallel(m, "l1", "l2"), parallel(m, "l3", "l4")];
    const { conflicts } = conflictsOf(m);
    assert.equal(conflicts.length, 1);
    assert.equal(conflicts[0].culprit, null);
    assert.ok(conflicts[0].set.some((n) => two.includes(n)), `${conflicts[0].set}`);
  });

  test(`${D}: past the budget the culprit is still named, and its set is not found in time`, () => {
    const { m } = rectangle(dim);
    const par = parallel(m, "l1", "l2");
    m.searchMs = -1; // spent before the first trial
    const { conflicts, relations } = conflictsOf(m);
    assert.deepEqual(conflicts, [{ culprit: par, set: [], found: false }]);
    assert.deepEqual(relations, [par]);
    const said = diagnosisLine(false, null, conflicts, [], []).parts.map((p) => (typeof p === "string" ? p : p.relation)).join("");
    assert.match(said, /not found in time/);
  });

  test(`${D}: an undo and a redo hand on who has held — a redone par is named as it was the first time`, () => {
    // Each is a new model opened from a snapshot (undo.ts). Without what the
    // old model knew, the redone par would read as a file opened in conflict.
    const { m, perps } = rectangle(dim);
    const beforeText = save(m);
    const par = parallel(m, "l1", "l2");
    conflictsOf(m);
    const afterText = save(m);
    const undone = open(beforeText, dim);
    undone.inheritHeld(m);
    assert.equal(undone.solve().solved, true);
    const redone = open(afterText, dim);
    redone.searchMs = Infinity;
    redone.inheritHeld(undone);
    assert.deepEqual(conflictsOf(redone).conflicts, [{ culprit: par, set: [perps[0]], found: true }]);
  });
}

// --- one relation among many (docs/plans/review-relations.md) ------------------------------------------
//
// `par("l1", "l2", "m1")` is one relation owning a row block for each member
// with the first: a conflict names it once, whichever of its blocks is the
// one that cannot hold, with every member in what it says. And who is in it
// can change (`join`, `leave`): the relation as it now stands has not held,
// so it is what made a conflict that follows a join.

/** What the status says of `conflicts`, as the app asks it: each relation by its name, the culprit with what it says. */
function said(m: Model, conflicts: Conflict[]): string {
  const says = (r: string) => describeRelation(m.relationOf(r)).slice(r.length).trim();
  return diagnosisLine(false, null, conflicts, [], [], says).parts.map((p) => (typeof p === "string" ? p : p.relation)).join("");
}

for (const dim of [2, 3]) {
  const D = `${dim}D`;

  test(`${D}: a par among three across a rectangle's corner is one culprit — named once with all three members, against that corner's perp`, () => {
    const { m, perps, pt } = rectangle(dim);
    pt(80, 0, "q1"); pt(95, 14, "q2"); m.addLine("q1", "q2", "m1");
    assert.equal(m.solve().solved, true);
    const before = m.problem.snapshot();
    const par = among(m, "parallel", "l1", "l2", "m1");
    assert.equal(m.relationOf(par).blocks.length >= 2, true, "one relation, a row block for each member with the first");
    const { conflicts, relations } = conflictsOf(m);
    assert.deepEqual(conflicts, [{ culprit: par, set: [perps[0]], found: true }]);
    assert.deepEqual(relations, [par, perps[0]]);
    assert.equal(said(m, conflicts), `${par} par l1 l2 m1 — against ${perps[0]}`);
    assert.deepEqual(m.problem.snapshot(), before, "and nothing moved — the free line it also names least of all");
  });

  test(`${D}: a line joining a relation that held makes the relation the culprit, as it now stands; the line leaving it clears it`, () => {
    const { m, perps, pt } = rectangle(dim);
    pt(80, 0, "q1"); pt(95, 14, "q2"); m.addLine("q1", "q2", "m1");
    const par = parallel(m, "l1", "m1");
    assert.equal(m.solve().solved, true, "l1 and the free line parallel: it holds");
    const before = m.problem.snapshot();
    assert.equal(join(m, par, "l2"), par, "the same relation, under the same name, among three");
    const { conflicts } = conflictsOf(m);
    assert.deepEqual(conflicts, [{ culprit: par, set: [perps[0]], found: true }], "it held among two; among these three it has not");
    assert.equal(said(m, conflicts), `${par} par l1 m1 l2 — against ${perps[0]}`);
    assert.deepEqual(m.problem.snapshot(), before);
    assert.equal(leave(m, par, "l2"), par);
    const report = m.solve();
    assert.equal(report.solved, true);
    assert.deepEqual(m.conflicting(report).conflicts, []);
    // And having held again as it stands, it is no longer what makes the next one.
    const other = parallel(m, "l2", "l3");
    assert.equal(conflictsOf(m).conflicts[0].culprit, other);
  });
}

test("3D: a feature's own relations are still background — a conflict through an extrude names the two a person made, never the extrusion", () => {
  // docs/plans/review-solver.md: "Feature-made relations may now be in the set
  // … if they are still background when you build, say so and leave a test
  // that will fail when that changes." They are: the extrusion that carries
  // the lid's `par` down to the base's `perp` is in every trial and in no
  // answer, because `del` refuses it alone. When features relate rather than
  // own (the register's item 4, linked-profiles.md), this test is meant to
  // fail: decide then whether the set is the par's perp alone or the
  // extrusion between them as well, and say so in the status.
  const m = new Model(3);
  m.searchMs = Infinity;
  const t = tiltedFrame(m);
  const { lines } = polygon(m, t, [[0, 0], [40, 0], [40, 30], [0, 30]]);
  const base = perpendicular(m, lines[0], lines[1]);
  extrude(m, lines[0], 20);
  assert.equal(m.solve().solved, true);
  const f = m.featureOf("e1", "extrude");
  const lid = parallel(m, f.twins[0][0], f.twins[0][1]);
  const { conflicts } = conflictsOf(m);
  assert.deepEqual(conflicts, [{ culprit: lid, set: [base], found: true }]);
  assert.throws(() => m.deleteRelation(f.depth!), /still part of e1/, "the extrusion is not a relation to delete alone, which is what makes it background");
});

// --- what the status says of it ---------------------------------------------------------------------

test("the status names the culprit first and what it is against after — and a set with none singled out as it always did", () => {
  const text = (c: Conflict[], unowned: string[] = []) => {
    const line = diagnosisLine(false, null, c, unowned, []);
    assert.equal(line.cls, "conflict");
    assert.equal(line.fades, false);
    return line.parts.map((p) => (typeof p === "string" ? p : `[${p.relation}${p.role === "against" ? "~" : p.role === "culprit" ? "!" : ""}]`)).join("");
  };
  // `[r7!]` is a name to click in the conflict's ink, the one that made it;
  // `[r1~]` one in the quieter ink, what it is against; `[r1]` one of a set
  // with none singled out.
  assert.equal(text([{ culprit: "r7", set: ["r1", "r2"], found: true }]), "[r7!] — against [r1~], [r2~]");
  assert.equal(text([{ culprit: "r7", set: ["r1"], found: true }]), "[r7!] — against [r1~]");
  assert.equal(text([{ culprit: "d3", set: [], found: true }]), "[d3!] cannot hold");
  assert.equal(text([{ culprit: "r7", set: [], found: false }]), "[r7!] — against a set not found in time");
  assert.equal(text([{ culprit: null, set: ["r1", "r2", "r3"], found: true }]), "[r1] · [r2] · [r3] cannot all hold");
  assert.equal(text([{ culprit: null, set: ["r1"], found: true }]), "[r1] cannot hold");
  assert.equal(text([{ culprit: "r7", set: ["r1"], found: true }, { culprit: null, set: ["r8", "r9"], found: true }]),
    "[r7!] — against [r1~]; [r8] · [r9] cannot all hold");
  assert.equal(text([], ["a block"]), "a block cannot hold");
  assert.equal(text([]), "");
  // With what the culprit says, as the app passes it: the spec's own line.
  const line = diagnosisLine(false, null, [{ culprit: "r7", set: ["r1", "r2"], found: true }], [], [], () => "par l1 l2");
  assert.equal(line.parts.map((p) => (typeof p === "string" ? p : p.relation)).join(""), "r7 par l1 l2 — against r1, r2");
});

// --- what the constraints palette lists ---------------------------------------------------------------

test("the palette lists a conflict first under one heading — the culprit first and marked, what it is against after, a delete on each", () => {
  const { m, perps } = rectangle(2);
  const par = parallel(m, "l1", "l2");
  const { conflicts } = conflictsOf(m);
  // With nothing selected, and with the two lines selected (a row pressed keeps the selection): first either way.
  for (const names of [[], ["l1", "l2"]]) {
    const sections = paletteFor(m, names, [], [], false, conflicts);
    assert.equal(sections[0].id, "conflict", `first with ${names.length ? names : "nothing"} selected`);
    assert.equal(sections[0].title, "conflict");
    assert.equal(sections[0].note, `${par} made it · against 1`);
    const rows = sections[0].rows as HeldRow[];
    assert.deepEqual(rows.map((r) => [r.name, r.role]), [[par, "culprit"], [perps[0], "against"]]);
    assert.deepEqual(rows.map((r) => r.deleteCommand), [`del("${par}")`, `del("${perps[0]}")`]);
    // And the same relations wear the same part wherever else the pane lists them.
    const elsewhere = sections.slice(1).flatMap((x) => (x.id === "apply" ? [] : (x.rows as HeldRow[])));
    assert.equal(elsewhere.find((r) => r.name === par)?.role, "culprit");
    assert.equal(elsewhere.find((r) => r.name === perps[0])?.role, "against");
    assert.equal(elsewhere.find((r) => r.name === perps[2])?.role, undefined, "a relation in no conflict has no part");
  }
  // None singled out: one heading, every member the same.
  const opened = [{ culprit: null, set: [perps[0], par], found: true }];
  const s = paletteFor(m, [], [], [], false, opened)[0];
  assert.equal(s.note, "2 cannot all hold");
  assert.deepEqual((s.rows as HeldRow[]).map((r) => r.role), ["conflict", "conflict"]);
  // Past the bound: the culprit alone, and the heading says why.
  assert.equal(paletteFor(m, [], [], [], false, [{ culprit: par, set: [], found: false }])[0].note, `${par} made it · its set not found in time`);
  // No conflict, no section.
  assert.notEqual(paletteFor(m, [], [], [], false, [])[0].id, "conflict");
  assert.equal(conflictRoles([]).size, 0);
});
