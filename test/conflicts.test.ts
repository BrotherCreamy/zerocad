// Conflict detection (docs/plans/conflict-detection.md): a conflict is a
// conflict even when the solver can satisfy it by collapsing something. The
// owner: "I'm able to add a parallel relation to a set of perpendicular
// relation lines. This is a bug."
//
// Every example is run in 2D and in 3D (the 3D drawing on a frame tipped off
// every kernel axis, so a 2D assumption cannot pass), and every conflict is
// named exactly: the irreducible set, no more and no less.
//
// Since docs/plans/review-solver.md the direction rows read unit directions,
// so most of what used to fold a side now has no answer at all: the solve
// fails, and is put back, where it used to collapse and be put back. What a
// user sees is the same — CONFLICT, the drawing where it was, the relation
// kept — and the tests that read `collapsed` say which it is now. A conflict
// that runs through shared corners (a triangle's two right angles, a lid
// against its base) still ends in a side of no length, and still reads as a
// collapse. Who made a conflict, and against what, is at the end of this file.

import { test } from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { ensureKernelLoaded, type ResidualBlock } from "../src/kernel/problem.ts";
import type { Dual } from "../src/kernel/dual.ts";
import { COLLAPSE, Model, SEARCH_MS, SEARCH_TRIALS, quickXplain, type ModelSolveReport } from "../src/model.ts";
import { coincident, dist, fix, onPlane } from "../src/relations/basic.ts";
import { angle, parallel, perpendicular, pointOnLine, tangent } from "../src/relations/geometry.ts";
import { addEllipse } from "../src/kinds/ellipse.ts";
import { addSpline } from "../src/relations/spline.ts";
import { del, extrude } from "../src/operations.ts";
import { open, save } from "../src/persist.ts";
import { tiltedFrame, type TiltedFrame } from "./frames.ts";
import { polygon } from "./profiles.ts";
import "../src/modules/builtin.ts";

await (async () => {
  const bytes = await readFile(new URL("../src/kernel/wasm-gen/neocad_kernel_bg.wasm", import.meta.url));
  await ensureKernelLoaded(bytes);
})();

const span = (a: number[], b: number[]) => Math.hypot(...a.map((v, i) => v - b[i]));
const lengthOf = (m: Model, l: string) => span(...(m.line(l).refs.map((p) => m.coords(p)) as [number[], number[]]));
const sorted = (xs: string[]) => [...xs].sort();

/**
 * A sketch in `dim` dimensions: 2D as it is, 3D on a tilted frame with every
 * point held on its plane — as the tools draw one.
 */
function sketch(dim: number): { m: Model; at: (u: number, v: number) => number[]; t: TiltedFrame | null; pt: (u: number, v: number, name: string) => string } {
  const m = new Model(dim);
  const t = dim === 3 ? tiltedFrame(m) : null;
  const at = (u: number, v: number) => (t ? t.at(u, v) : [u, v]);
  const pt = (u: number, v: number, name: string) => {
    m.addPoint(at(u, v), name);
    if (t) onPlane(m, name, t.name);
    return name;
  };
  return { m, at, t, pt };
}

/** The rectangle of the bug: four points, four lines, three perps. */
function rectangle(dim: number) {
  const s = sketch(dim);
  [[0, 0], [6, 0], [6, 4], [0, 4]].forEach(([x, y], i) => s.pt(x, y, `p${i + 1}`));
  for (let i = 1; i <= 4; i++) s.m.addLine(`p${i}`, `p${(i % 4) + 1}`, `l${i}`);
  const perps = [perpendicular(s.m, "l1", "l2"), perpendicular(s.m, "l2", "l3"), perpendicular(s.m, "l3", "l4")];
  assert.equal(s.m.solve().solved, true);
  return { ...s, perps };
}

/**
 * Solves, and asserts it is a conflict naming exactly `names` — and, for a
 * collapse, that every point of what would have folded is where it was.
 */
function conflict(m: Model, names: string[], what: string): ModelSolveReport {
  // What is named is asked of the trials, not of the clock: with three other
  // suites running on this box the 500 ms budget ran out on the spline (one
  // run in three) and the culprit was named without its set, which is the
  // bound doing its job and not the answer being wrong. The bound has its own
  // test below.
  m.searchMs = Infinity;
  const before = m.problem.snapshot();
  const report = m.solve();
  assert.equal(report.solved, false, `${what}: solved — collapsed ${report.collapsed}`);
  const c = m.conflicting(report);
  assert.deepEqual(sorted(c.relations), sorted(names), `${what}: named ${c.relations.map((r) => `${r} ${m.relationOf(r).op}`)}`);
  for (const n of report.collapsed) {
    const e = m.entities.get(n)!;
    for (const p of m.refsOf(e)) {
      const moved = Math.max(...m.point(p).varIndices.map((i) => Math.abs(m.problem.getVar(i) - before[i])));
      assert.ok(moved < 1e-9, `${what}: a collapse is put back — ${p} of ${n} moved ${moved}`);
    }
  }
  return report;
}

for (const dim of [2, 3]) {
  const D = `${dim}D`;

  test(`${D}: the owner's rectangle — a par across the perps is a CONFLICT, nothing folds, the par is kept`, () => {
    const { m, perps } = rectangle(dim);
    const before = m.problem.snapshot();
    const r = parallel(m, "l1", "l2");
    const report = conflict(m, [perps[0], r], "rectangle");
    // No side is folded to find it out any more: a `par` and a `perp` on one
    // pair of lines have no answer once neither can be met by a shorter line.
    assert.deepEqual(report.collapsed, [], "a failure, not a collapse");
    const lengths = ["l1", "l2", "l3", "l4"].map((l) => lengthOf(m, l));
    assert.ok(lengths.every((v) => v > 3), `nothing folded: ${lengths}`);
    assert.deepEqual(m.problem.snapshot(), before, "the geometry exactly as before the par");
    assert.ok(m.relations.has(r), "the par stays, as Onshape keeps a conflicting constraint");
    assert.ok(!m.diagnose().redundant.includes(r), "and is not called redundant: that was said at the folded state");
  });

  test(`${D}: par + perp on one pair of lines — both`, () => {
    const { m, pt } = sketch(dim);
    pt(0, 0, "a"); pt(10, 0, "b"); pt(2, 3, "c"); pt(4, 9, "d");
    m.addLine("a", "b", "l1"); m.addLine("c", "d", "l2");
    const p = perpendicular(m, "l1", "l2");
    assert.equal(m.solve().solved, true);
    const q = parallel(m, "l1", "l2");
    conflict(m, [p, q], "par + perp");
  });

  test(`${D}: par(l1,l2), par(l2,l3), perp(l1,l3) — all three`, () => {
    const { m, pt } = sketch(dim);
    pt(0, 0, "a"); pt(10, 0, "b"); pt(0, 3, "c"); pt(10, 4, "d"); pt(0, 7, "e"); pt(9, 12, "f");
    m.addLine("a", "b", "l1"); m.addLine("c", "d", "l2"); m.addLine("e", "f", "l3");
    const rs = [parallel(m, "l1", "l2"), parallel(m, "l2", "l3")];
    assert.equal(m.solve().solved, true);
    rs.push(perpendicular(m, "l1", "l3"));
    conflict(m, rs, "a chain of two pars and a perp");
  });

  test(`${D}: three lines, three perps — all three`, () => {
    // A triangle's directions without its corners: l1 ⊥ l2 ⊥ l3 makes l3 ∥ l1,
    // and the third perp then folds one of them. Every one of the three is
    // needed, so all three are named.
    const { m, pt } = sketch(dim);
    pt(0, 0, "a"); pt(10, 0, "b"); pt(12, 2, "c"); pt(15, 9, "d"); pt(-3, 4, "e"); pt(-8, 9, "f");
    m.addLine("a", "b", "l1"); m.addLine("c", "d", "l2"); m.addLine("e", "f", "l3");
    const rs = [perpendicular(m, "l1", "l2"), perpendicular(m, "l2", "l3")];
    assert.equal(m.solve().solved, true);
    rs.push(perpendicular(m, "l3", "l1"));
    // In 3D three directions can be square to each other: what makes these
    // three conflict is that every end is held on the sketch plane, so the
    // holds are part of it, every one — the minimal set says so.
    const holds = [...m.relations.values()].filter((r) => r.op === "onPlane").map((r) => r.name);
    assert.equal(holds.length, dim === 3 ? 6 : 0);
    conflict(m, [...rs, ...holds], "three lines");
  });

  test(`${D}: a closed triangle conflicts at its second perp — no triangle has two right angles`, () => {
    // The plan's "a triangle with three perps" never reaches its third: two
    // right angles already fold a side. The first collapse a residual meets
    // quadratically (the second perp is the square of the folding side once
    // the first holds), which is why `collapsedNow` polishes a suspect.
    const { m, pt } = sketch(dim);
    pt(0, 0, "a"); pt(10, 0, "b"); pt(3, 7, "c");
    m.addLine("a", "b", "l1"); m.addLine("b", "c", "l2"); m.addLine("c", "a", "l3");
    const rs = [perpendicular(m, "l1", "l2")];
    assert.equal(m.solve().solved, true);
    rs.push(perpendicular(m, "l2", "l3"));
    conflict(m, rs, "triangle");
    rs.push(perpendicular(m, "l3", "l1"));
    const report = m.solve();
    assert.equal(report.solved, false);
    const named = m.conflicting(report).relations;
    assert.equal(named.length, 2, `two right angles: ${named}`);
    assert.ok(named.includes(rs[2]), "the one just added is among them");
  });

  test(`${D}: ang(l1, l2, 30°) + par(l1, l2) — both`, () => {
    const { m, pt } = sketch(dim);
    pt(0, 0, "a"); pt(10, 0, "b"); pt(0, 3, "c"); pt(8, 8, "d");
    m.addLine("a", "b", "l1"); m.addLine("c", "d", "l2");
    const a = angle(m, "l1", "l2", Math.PI / 6);
    assert.equal(m.solve().solved, true);
    const p = parallel(m, "l1", "l2");
    conflict(m, [a, p], "ang + par");
  });

  test(`${D}: a tangent line through the circle's centre — the tangent and the incidence`, () => {
    const { m, pt, t } = sketch(dim);
    pt(0, 0, "o"); pt(-10, 6, "a"); pt(10, 6, "b");
    m.addLine("a", "b", "l1");
    m.addCircle("o", 6, t ? t.name : null, "c1");
    if (t) parallel(m, "c1", `${t.name}.z`);
    const tan = tangent(m, "l1", "c1");
    assert.equal(m.solve().solved, true);
    const on = pointOnLine(m, "o", "l1");
    const report = conflict(m, [tan, on], "tangent through the centre");
    assert.ok(Math.abs(m.radius("c1")) > 1, `the circle keeps its size: ${m.radius("c1")}`);
    void report;
  });

  test(`${D}: the user's own zero is no collapse — dist(p, q, 0) on a line's ends`, () => {
    const { m, pt } = sketch(dim);
    pt(0, 0, "a"); pt(10, 0, "b"); m.addLine("a", "b", "l1");
    dist(m, "a", "b", 0);
    const report = m.solve();
    assert.equal(report.solved, true, `collapsed ${report.collapsed}`);
    assert.ok(lengthOf(m, "l1") < 1e-6, "and the line is the point it was told to be");
  });

  test(`${D}: the user's own zero is no collapse — coin of a line's ends`, () => {
    const { m, pt } = sketch(dim);
    pt(0, 0, "a"); pt(10, 0, "b"); m.addLine("a", "b", "l1");
    coincident(m, "a", "b");
    assert.equal(m.solve().solved, true);
    assert.ok(lengthOf(m, "l1") < 1e-6);
  });

  test(`${D}: a point drawn on another is no collapse, and nothing on it is redundant`, () => {
    const { m, pt } = sketch(dim);
    pt(0, 0, "a"); pt(0, 0, "b"); pt(3, 3, "c"); pt(9, 5, "d");
    m.addLine("a", "b", "l1"); m.addLine("c", "d", "l2");
    const p = parallel(m, "l1", "l2");
    const report = m.solve();
    assert.equal(report.solved, true, "a line drawn as a point was a point before");
    assert.ok(!m.diagnose().redundant.includes(p), "redundant is not said at a folded state");
  });

  test(`${D}: deleting a relation of the conflict — SOLVED, nothing named`, () => {
    const { m, perps } = rectangle(dim);
    const r = parallel(m, "l1", "l2");
    conflict(m, [perps[0], r], "rectangle");
    del(m, r);
    const report = m.solve();
    assert.equal(report.solved, true);
    assert.deepEqual(m.conflicting(report).relations, []);
    // The other way: delete the perp on the par's own corner, and the par
    // still cannot hold. The rectangle held a second conflict all along —
    // l1 ∥ l2 puts three corners in a row, and the far corner's two perps
    // then fold a side — and it is named now, being the one left.
    const { m: m2, perps: p2 } = rectangle(dim);
    const r2 = parallel(m2, "l1", "l2");
    conflict(m2, [p2[0], r2], "rectangle");
    del(m2, p2[0]);
    conflict(m2, [r2, p2[1], p2[2]], "the second conflict");
    del(m2, p2[2]);
    const settled = m2.solve();
    assert.equal(settled.solved, true, `collapsed ${settled.collapsed}`);
    assert.ok(["l1", "l2", "l3", "l4"].every((l) => lengthOf(m2, l) > 0.5), "and it holds by turning a side, folding none");
  });

  test(`${D}: a relation added to a drawing that already holds a conflict`, () => {
    const { m, perps, pt } = rectangle(dim);
    const r = parallel(m, "l1", "l2");
    conflict(m, [perps[0], r], "rectangle");
    // Elsewhere: it solves, the conflict stays named.
    pt(20, 0, "q1"); pt(30, 2, "q2"); m.addLine("q1", "q2", "m1");
    const d = dist(m, "q1", "q2", 5);
    const report = conflict(m, [perps[0], r], "after a dist elsewhere");
    assert.ok(Math.abs(lengthOf(m, "m1") - 5) < 1e-6, `the part apart from the conflict solved: ${lengthOf(m, "m1")}`);
    assert.ok(m.relations.has(d));
    void report;
    // On the rectangle itself: still the same two.
    dist(m, "p1", "p2", 6);
    conflict(m, [perps[0], r], "after a dist on the rectangle");
  });

  test(`${D}: undo after a conflict — the snapshot before it solves`, () => {
    const { m } = rectangle(dim);
    const snap = save(m);
    parallel(m, "l1", "l2");
    assert.equal(m.solve().solved, false);
    const back = open(snap, dim);
    assert.equal(back.solve().solved, true);
    assert.deepEqual(back.conflicting(back.solve()).relations, []);
  });

  test(`${D}: save and open a drawing with a conflict — still CONFLICT on open, the same names`, () => {
    const { m, perps } = rectangle(dim);
    const r = parallel(m, "l1", "l2");
    conflict(m, [perps[0], r], "rectangle");
    const text = save(m);
    const back = open(text, dim);
    conflict(back, [perps[0], r], "reopened");
    assert.equal(save(back), text, "and opening and solving it changed nothing");
  });

  test(`${D}: a failed solve is named minimally too, not by every block left large`, () => {
    // A level rectangle, its sides 40 and 25, then a diagonal of 30. The
    // least squares leaves the error across every relation on the corner, the
    // 25 among them; but a diagonal of 30 cannot hold against a side of 40 at
    // a square corner whatever the other side is (the hypotenuse is the
    // longest side), so the conflict is the 40, the 30 and the two levels that
    // square the corner. Not the 25, not the other two levels, not the fix.
    const { m, pt, t } = sketch(dim);
    [[0, 0], [40, 0], [40, 25], [0, 25]].forEach(([x, y], i) => pt(x, y, `k${i}`));
    for (let i = 0; i < 4; i++) m.addLine(`k${i}`, `k${(i + 1) % 4}`, `e${i}`);
    const f = t ? t.name : "origin";
    const lv = [parallel(m, "e0", `${f}.x`), parallel(m, "e1", `${f}.y`), parallel(m, "e2", `${f}.x`), parallel(m, "e3", `${f}.y`)];
    fix(m, "k0", dim === 2 ? [0, 0] : [0, 0, 0]);
    const w = dist(m, "k0", "k1", 40), h = dist(m, "k1", "k2", 25);
    assert.equal(m.solve().solved, true);
    const diag = dist(m, "k0", "k2", 30);
    const report = m.solve();
    assert.equal(report.solved, false);
    const old = new Set(report.blocks.map((b) => [...m.relations.values()].find((r) => r.blocks.includes(b))?.name));
    assert.ok(old.has(h), "the old naming accused the 25 too");
    const named = m.conflicting(report).relations;
    assert.deepEqual(sorted(named), sorted([lv[0], lv[1], w, diag]), `named ${named}; the blocks left large were ${[...old]}`);
  });
}

// --- what only 3D has -----------------------------------------------------------

test("3D: a chain through an extrude's twins — a relation on the lid against one on the base", () => {
  const m = new Model(3);
  const t = tiltedFrame(m);
  const { lines } = polygon(m, t, [[0, 0], [40, 0], [40, 30], [0, 30]]);
  const base = perpendicular(m, lines[0], lines[1]);
  extrude(m, lines[0], 20);
  assert.equal(m.solve().solved, true);
  const f = m.featureOf("e1", "extrude");
  const [lid0, lid1] = f.twins[0];
  const lid = parallel(m, lid0, lid1);
  const report = conflict(m, [base, lid], "base against lid");
  assert.ok(report.collapsed.length > 0, "a collapse, not a failure");
  assert.ok(!m.conflicting(report).relations.includes(f.depth!), "the extrude's depth is the feature's, never named");
});

// --- a collapse the solver used to have to be steered off ---------------------------------

test("3D: par(l1, l2) and perp(l2, l3) on a rectangle hold without a fold — a side turns, and the bare solver turns it too", () => {
  // Consistent: three corners in a row and the fourth off it square. From the
  // rectangle as drawn the bare solver used to fold l2 instead (measured at
  // 1e-7 long), which is the locality `solve` retries steered against. With
  // the direction rows normalised (docs/plans/review-solver.md) a `par` across
  // a square corner is an angle of 90° to turn through, not a product that
  // only a shorter line lowers, and the bare solver turns the side itself.
  const make = () => {
    const s = sketch(3);
    [[0, 0], [6, 0], [6, 4], [0, 4]].forEach(([x, y], i) => s.pt(x, y, `p${i + 1}`));
    for (let i = 1; i <= 4; i++) s.m.addLine(`p${i}`, `p${(i % 4) + 1}`, `l${i}`);
    parallel(s.m, "l1", "l2");
    perpendicular(s.m, "l2", "l3");
    return s.m;
  };
  const bare = make();
  assert.equal(bare.problem.solve().solved, true);
  assert.ok(["l1", "l2", "l3", "l4"].every((l) => lengthOf(bare, l) > 0.5), `the bare solver folds nothing: ${["l1", "l2", "l3", "l4"].map((l) => lengthOf(bare, l))}`);
  const m = make();
  const report = m.solve();
  assert.equal(report.solved, true, `collapsed ${report.collapsed}`);
  assert.ok(["l1", "l2", "l3", "l4"].every((l) => lengthOf(m, l) > 0.5), `nothing folded: ${["l1", "l2", "l3", "l4"].map((l) => lengthOf(m, l))}`);
  console.log(`bare: l2 ${lengthOf(bare, "l2").toExponential(2)}; steered: l2 ${lengthOf(m, "l2").toFixed(3)}`);
});

// --- the limits of "the user's own zero", pinned (TODO.md) -----------------------------

test("2D: the own-zero rule is one relation — two coins through a third point fold a line, and that is a conflict", () => {
  const m = new Model(2);
  m.addPoint([0, 0], "a"); m.addPoint([10, 0], "b"); m.addPoint([5, 5], "c");
  m.addLine("a", "b", "l1");
  const one = coincident(m, "a", "c");
  assert.equal(m.solve().solved, true);
  const two = coincident(m, "c", "b");
  conflict(m, [one, two], "a chain of coins");
});

test("2D: …and perp(l1, l1) is a conflict of one: a line is not square to itself, and no longer folds to pretend so", () => {
  // It used to solve, the line at nothing, and read as meant: the own-zero
  // rule saw one relation fold what it named. A unit direction cannot be made
  // square to itself by any length, so it fails, the line stays, and the
  // relation is named alone, against nothing.
  const m = new Model(2);
  m.addPoint([0, 0], "a"); m.addPoint([10, 3], "b");
  m.addLine("a", "b", "l1");
  const r = perpendicular(m, "l1", "l1");
  const report = conflict(m, [r], "perp(l1, l1)");
  assert.deepEqual(report.collapsed, []);
  assert.ok(Math.abs(lengthOf(m, "l1") - Math.hypot(10, 3)) < 1e-9, `the line is as it was: ${lengthOf(m, "l1")}`);
  assert.deepEqual(m.conflicting(report).conflicts, [{ culprit: r, set: [], found: true }]);
});

// --- every kind declares its measures ------------------------------------------------

test("2D: an ellipse run to nothing by two fixes is a conflict — its own measure, no line in it", () => {
  const m = new Model(2);
  m.addPoint([0, 0], "o"); m.addPoint([10, 0], "maj");
  addEllipse(m, "o", "maj", 4, null, "el1");
  const a = fix(m, "o", [3, 3]);
  assert.equal(m.solve().solved, true);
  const b = fix(m, "maj", [3, 3]);
  conflict(m, [a, b], "ellipse");
});

test("3D: a spline whose consecutive points are pinned together is a conflict — its own measure", () => {
  const m = new Model(3);
  const t = tiltedFrame(m);
  const ps = [[0, 0], [10, 5], [20, 0], [30, 5]].map(([u, v], i) => m.addPoint(t.at(u, v), `s${i}`).name);
  addSpline(m, ps, false, "sp1");
  const a = fix(m, "s1", [12, 3, 0]);
  assert.equal(m.solve().solved, true);
  const b = fix(m, "s2", [12, 3, 0]);
  conflict(m, [a, b], "spline");
});

test("2D: a frame's axis run onto its origin is a conflict", () => {
  const m = new Model(2);
  m.addPoint([5, 5], "fo"); m.addPoint([9, 5], "fx");
  m.addFrame("fo", "fx", null, "f1");
  const a = fix(m, "fo", [1, 1], "origin");
  assert.equal(m.solve().solved, true);
  const b = fix(m, "fx", [1, 1], "origin");
  conflict(m, [a, b], "frame");
});

// --- the drag --------------------------------------------------------------------------

/** A weak pull of `point` toward `to` — what a drag adds for one frame and stores nowhere. */
function pull(m: Model, point: string, to: number[]): ResidualBlock {
  return { varIndices: m.point(point).varIndices, fn: (l: Dual[]) => l.map((x, i) => x.sub(to[i]).mul(0.3)) };
}

for (const dim of [2, 3]) {
  test(`${dim}D: a drag frame that would fold something stops where the last frame was, and the rest still moves`, () => {
    const { m, at, pt } = rectangle(dim);
    parallel(m, "l1", "l2");
    m.solve();
    pt(20, 0, "free");
    const before = m.problem.snapshot();
    m.solveFrame([pull(m, "p3", at(9, 9)), pull(m, "free", at(25, 3))]);
    const rect = ["p1", "p2", "p3", "p4"].flatMap((p) => m.point(p).varIndices);
    for (const i of rect) assert.equal(m.problem.getVar(i), before[i], "the rectangle holds its conflict still");
    assert.ok(span(m.coords("free"), at(20, 0)) > 1, "a point apart from it follows the drag");
    assert.ok(["l1", "l2", "l3", "l4"].every((l) => lengthOf(m, l) > 3));
  });
}

// --- QuickXplain, alone -------------------------------------------------------------------

test("quickXplain finds an irreducible conflict, preferring the earlier items", () => {
  // Conflicts are the sets containing {3, 7} or {1, 2, 9}.
  const bad = (s: number[]) => (s.includes(3) && s.includes(7)) || (s.includes(1) && s.includes(2) && s.includes(9));
  let asked = 0;
  const found = quickXplain([1, 2, 3, 4, 5, 6, 7, 8, 9, 10], (s) => { asked++; return bad(s); });
  assert.deepEqual(found.sort((a, b) => a - b), [3, 7]);
  assert.ok(asked < 12, `${asked} questions for 10 items`);
  assert.deepEqual(quickXplain([9, 2, 1, 3, 7], bad).sort((a, b) => a - b), [1, 2, 9], "the earlier conflict is the one named");
});

// --- what it costs ------------------------------------------------------------------------

/**
 * **The cost is measured in work, and the clock is only printed.** Every
 * kernel solve the model asks for is counted (a trial of the conflict search
 * is one or two; a steer, one more), with its iterations; a wall-clock figure
 * is printed beside it. The old assertion — the search under 2000 ms — was
 * a flake by construction on a shared box: it read 2255 ms, 2888 ms, with
 * other workers' suites on the same four cores, and passed alone. Set
 * NEOCAD_TIMING to assert the clock as well, on a machine that is yours.
 */
function counting(m: Model): { solves: () => number; iterations: () => number; reset: () => void } {
  const orig = m.problem.solve.bind(m.problem);
  let solves = 0;
  let iterations = 0;
  m.problem.solve = (...args: Parameters<typeof orig>) => {
    const r = orig(...args);
    solves++;
    iterations += r.iterations;
    return r;
  };
  return { solves: () => solves, iterations: () => iterations, reset: () => { solves = 0; iterations = 0; } };
}
const TIMING = process.env.NEOCAD_TIMING !== undefined;

test("the cost: the check on every solve, and the search, on the largest fixtures and a large sketch — counted in solves and iterations, the clock printed", async () => {
  const fixtures = ["pre-explicit-regions", "shapes-v15", "features-v12"];
  for (const name of fixtures) {
    const text = await readFile(new URL(`./fixtures/${name}.neocad.json`, import.meta.url), "utf8");
    const m = open(text, 3);
    m.solve();
    const times = (f: () => void) => {
      const runs: number[] = [];
      for (let i = 0; i < 7; i++) { const t0 = performance.now(); f(); runs.push(performance.now() - t0); }
      return runs.sort((a, b) => a - b)[3];
    };
    const bare = times(() => m.problem.solve());
    const checked = times(() => m.solve());
    assert.equal(m.solve().solved, true, `${name} solves with nothing collapsed`);
    // A conflict made in it: a par and a perp on the first two lines that
    // share a point, and the search for it.
    const lines = [...m.entities.values()].filter((e) => e.kind === "line").map((e) => m.line(e.name));
    const pair = lines.flatMap((a) => lines.filter((b) => b !== a && b.refs.some((p) => a.refs.includes(p))).map((b) => [a.name, b.name]))[0];
    const made = [parallel(m, pair[0], pair[1]), perpendicular(m, pair[0], pair[1])];
    // What is named is asked of the trials, not of the clock: under load the
    // 500 ms budget ran out and the fallback named others (found merging
    // #86, 1 run in 3 alone at load ~18). The time is still measured.
    m.searchMs = Infinity;
    const work = counting(m);
    let t0 = performance.now();
    const report = m.solve();
    const solveMs = performance.now() - t0;
    const solveWork = `${work.solves()} solves, ${work.iterations()} iterations`;
    work.reset();
    t0 = performance.now();
    const named = m.conflicting(report).relations;
    const searchMs = performance.now() - t0;
    console.log(`${name}: ${m.entities.size} entities, ${m.relations.size} relations — solve ${bare.toFixed(2)} ms bare, `
      + `${checked.toFixed(2)} ms checked; with a conflict made in it, solve ${solveMs.toFixed(1)} ms (${solveWork}), `
      + `search ${searchMs.toFixed(1)} ms (${work.solves()} solves, ${work.iterations()} iterations) → ${named.join(" ")}`);
    assert.equal(report.solved, false, `${name}: the par and the perp conflict`);
    for (const r of made) assert.ok(named.includes(r), `${name}: ${r} named among ${named}`);
    // A conflict between two relations on one pair of lines is found in a
    // handful of trials, whatever the drawing around it: the search is
    // bounded at 200 and never came near it here (5 to 9 solves, measured).
    assert.ok(work.solves() <= 40, `${name}: the search took ${work.solves()} solves`);
  }

  // Forty rectangles in a row, tied to each other (sketchrelations.test.ts's
  // cost sketch): one component of ~400 relations. A par across the last
  // one's perps-in-effect (two levels) is the conflict searched for.
  const m = new Model(3);
  for (let r = 0; r < 40; r++) {
    const x0 = r * 50;
    [[x0, 0, 0], [x0 + 40, 0, 0], [x0 + 40, 25, 0], [x0, 25, 0]].forEach((c, i) => m.addPoint(c, `r${r}k${i}`));
    for (let i = 0; i < 4; i++) m.addLine(`r${r}k${i}`, `r${r}k${(i + 1) % 4}`, `r${r}e${i}`);
    parallel(m, `r${r}e0`, "origin.x"); parallel(m, `r${r}e2`, "origin.x");
    parallel(m, `r${r}e1`, "origin.y"); parallel(m, `r${r}e3`, "origin.y");
    dist(m, `r${r}k0`, `r${r}k1`, 40); dist(m, `r${r}k1`, `r${r}k2`, 25);
    if (r === 0) fix(m, "r0k0", [0, 0, 0]);
    else dist(m, `r${r - 1}k1`, `r${r}k0`, 10);
  }
  let t0 = performance.now();
  assert.equal(m.solve().solved, true);
  console.log(`40 rectangles: ${m.entities.size} entities, ${m.relations.size} relations — first solve ${(performance.now() - t0).toFixed(1)} ms`);
  // A drag's frame, checked and bare: the same pull on a corner, alternately.
  const frames = { bare: [] as number[], checked: [] as number[] };
  for (let i = 0; i < 20; i++) {
    const to = [20 * 50 + 40 + (i % 2 ? 3 : -3), 25 + (i % 2 ? 2 : -2), 0];
    t0 = performance.now();
    if (i % 4 < 2) m.problem.solve({ extra: [pull(m, "r20k2", to)] });
    else m.solveFrame([pull(m, "r20k2", to)]);
    (i % 4 < 2 ? frames.bare : frames.checked).push(performance.now() - t0);
  }
  const median = (xs: number[]) => [...xs].sort((a, b) => a - b)[xs.length >> 1];
  console.log(`40 rectangles, a drag's frame: ${median(frames.bare).toFixed(1)} ms bare, ${median(frames.checked).toFixed(1)} ms checked`);
  m.solve();
  const p = parallel(m, "r20e0", "r20e1");
  const work = counting(m);
  t0 = performance.now();
  const report = m.solve();
  const solveMs = performance.now() - t0;
  const solveWork = `${work.solves()} solves, ${work.iterations()} iterations`;
  // What is named, asked of the trials alone (as above): under load the
  // budget ran out here too and the fallback named eight (merging #83).
  m.searchMs = Infinity;
  work.reset();
  t0 = performance.now();
  const c = m.conflicting(report);
  const searchMs = performance.now() - t0;
  const searchSolves = work.solves();
  console.log(`40 rectangles, a par across a corner: solve ${solveMs.toFixed(1)} ms (${solveWork}; collapsed ${report.collapsed}), `
    + `search ${searchMs.toFixed(1)} ms (${searchSolves} solves, ${work.iterations()} iterations) → ${c.relations.join(" ")}`);
  assert.equal(report.solved, false);
  assert.ok(c.relations.includes(p), "the par is named");
  assert.ok(c.relations.length <= 4, `minimal: ${c.relations}`);
  // **The search's cost, in its own units.** With the clock lifted it must
  // still finish inside the product's trial budget — then the product's
  // search, bounded by both, names the same thing on an unloaded machine.
  // Measured 25 solves (130 iterations); the bound is 200 trials.
  assert.ok(searchSolves <= SEARCH_TRIALS, `the search took ${searchSolves} solves for a budget of ${SEARCH_TRIALS} trials`);
  if (TIMING) assert.ok(searchMs < 2000, `${searchMs} ms (NEOCAD_TIMING is set)`);

  // **And the clock bound does bound it** — on a clock the test turns, so the
  // result is the same on any machine: each reading of `performance.now()`
  // is 100 ms after the last, the budget is the product's 500 ms, and the
  // search stops at the sixth reading, five trials in (5 solves, measured,
  // against 25 with the clock lifted) — the culprit still named,
  // its set not found (`found` false), which is what the app shows past the
  // bound (*against a set not found in time*).
  m.searchMs = SEARCH_MS;
  work.reset();
  const realNow = performance.now.bind(performance);
  let fakeNow = 0;
  performance.now = () => (fakeNow += 100);
  let bounded: ReturnType<Model["conflicting"]>;
  try {
    bounded = m.conflicting(report);
  } finally {
    performance.now = realNow;
  }
  console.log(`40 rectangles, the same search on the product's budget with 100 ms a reading: ${work.solves()} solves → ${bounded.relations.join(" ")}, found ${bounded.conflicts.map((k) => k.found)}`);
  assert.ok(work.solves() < searchSolves, `bounded: ${work.solves()} solves, against ${searchSolves} with the clock lifted`);
  assert.ok(work.solves() <= 8, `bounded: ${work.solves()} solves on a budget of five readings`);
  assert.deepEqual(bounded.relations, [p], "past the bound the culprit is named alone");
  assert.deepEqual(bounded.conflicts.map((k) => k.found), [false]);
});

test("ε is a share of the drawing's size: the same rectangle conflicts at a micron and at a kilometre", () => {
  for (const scale of [1e-3, 1, 1e3, 1e6]) {
    const m = new Model(2);
    [[0, 0], [6, 0], [6, 4], [0, 4]].forEach(([x, y], i) => m.addPoint([x * scale, y * scale], `p${i + 1}`));
    for (let i = 1; i <= 4; i++) m.addLine(`p${i}`, `p${(i % 4) + 1}`, `l${i}`);
    perpendicular(m, "l1", "l2"); perpendicular(m, "l2", "l3"); perpendicular(m, "l3", "l4");
    assert.equal(m.solve().solved, true, `scale ${scale}`);
    parallel(m, "l1", "l2");
    const r = m.solve();
    assert.equal(r.solved, false, `scale ${scale}: collapsed ${r.collapsed}`);
    assert.ok(COLLAPSE * m.extent() < lengthOf(m, "l2"));
  }
});
