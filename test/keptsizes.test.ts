// What `Model.keptSizes` costs, and what it gives back, on drawings large
// enough to feel on a phone (docs/plans/solver-cost.md). The review had
// measured one dimension set on forty chained rectangles with their widths
// free at 165 → 1407 ms: `keptSizes` solving the whole drawing four more
// times to bring back sizes that had drifted by nothing — and, measured here
// before anything changed, bringing them back only to 1e-2.
//
// The cost is counted in kernel solves and iterations, as test/conflicts.test.ts
// counts it, and the clock is printed: set NEOCAD_TIMING to assert the clock
// too, on a machine that is yours. The table itself is test/keptsizes.measure.ts's.

import { test } from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { ensureKernelLoaded, type ResidualBlock } from "../src/kernel/problem.ts";
import { Model } from "../src/model.ts";
import { coplanar, dist, fix } from "../src/relations/basic.ts";
import { parallel, perpendicular } from "../src/relations/geometry.ts";
import { del, set } from "../src/operations.ts";
import "../src/modules/builtin.ts";

await ensureKernelLoaded(await readFile(new URL("../src/kernel/wasm-gen/neocad_kernel_bg.wasm", import.meta.url)));

const TIMING = process.env.NEOCAD_TIMING !== undefined;
const lengthOf = (m: Model, l: string) => {
  const [a, b] = m.line(l).refs.map((p) => m.coords(p));
  return Math.hypot(...a.map((x, i) => x - b[i]));
};

/** Every kernel solve the model asks for: its iterations, how many `extra` rows (pulls) it carried, and how many blocks it was `only` of. */
function counting(m: Model): { log: { iterations: number; extra: number; only: number | null }[]; iterations: () => number } {
  const orig = m.problem.solve.bind(m.problem);
  const log: { iterations: number; extra: number; only: number | null }[] = [];
  m.problem.solve = (...args: Parameters<typeof orig>) => {
    const r = orig(...args);
    log.push({ iterations: r.iterations, extra: args[0]?.extra?.length ?? 0, only: args[0]?.only?.size ?? null });
    return r;
  };
  return { log, iterations: () => log.reduce((s, e) => s + e.iterations, 0) };
}

/** Rectangles as the tool leaves them (four perps and a flat), in a row, chained by a `par` of their bases and a `dist` between them; `widths` dimensions every width. */
function perpRects(n: number, widths: boolean): Model {
  const m = new Model(3);
  for (let r = 0; r < n; r++) {
    const x0 = r * 50;
    [[x0, 0, 0], [x0 + 40, 0, 0], [x0 + 40, 25, 0], [x0, 25, 0]].forEach((c, i) => m.addPoint(c, `r${r}k${i}`));
    for (let i = 0; i < 4; i++) m.addLine(`r${r}k${i}`, `r${r}k${(i + 1) % 4}`, `r${r}e${i}`);
    for (let i = 0; i < 4; i++) perpendicular(m, `r${r}e${i}`, `r${r}e${(i + 1) % 4}`);
    coplanar(m, `r${r}k3`, `r${r}k0`, `r${r}k1`, `r${r}k2`);
    if (widths) dist(m, `r${r}k0`, `r${r}k1`, 40);
    if (r > 0) { parallel(m, `r${r}e0`, `r${r - 1}e0`); dist(m, `r${r - 1}k1`, `r${r}k0`, 10); }
  }
  return m;
}

/** Forty rectangles held `par` to the axes, widths and every other height dimensioned, chained, the first corner fixed. */
function axisRects(n: number): Model {
  const m = new Model(3);
  for (let r = 0; r < n; r++) {
    const x0 = r * 50;
    [[x0, 0, 0], [x0 + 40, 0, 0], [x0 + 40, 25, 0], [x0, 25, 0]].forEach((c, i) => m.addPoint(c, `r${r}k${i}`));
    for (let i = 0; i < 4; i++) m.addLine(`r${r}k${i}`, `r${r}k${(i + 1) % 4}`, `r${r}e${i}`);
    parallel(m, `r${r}e0`, "origin.x"); parallel(m, `r${r}e2`, "origin.x");
    parallel(m, `r${r}e1`, "origin.y"); parallel(m, `r${r}e3`, "origin.y");
    dist(m, `r${r}k0`, `r${r}k1`, 40);
    if (r % 2 === 0) dist(m, `r${r}k1`, `r${r}k2`, 25);
    if (r === 0) fix(m, "r0k0", [0, 0, 0]); else dist(m, `r${r - 1}k1`, `r${r}k0`, 10);
  }
  return m;
}

const lines = (m: Model) => [...m.entities.values()].filter((e) => e.kind === "line").map((e) => e.name);
const sizes = (m: Model) => new Map(lines(m).map((l) => [l, lengthOf(m, l)]));

// --- the case the spec said to fix first -----------------------------------------------------------

test("forty chained rectangles, widths free, one gap set: every width is kept to 1e-9 (it was 1e-2) and the chain opens — five kernel solves, no more", () => {
  const m = perpRects(40, false);
  assert.equal(m.solve().solved, true);
  const was = sizes(m);
  const x0 = m.coords("r0k0")[0], x39 = m.coords("r39k0")[0];
  const gap = [...m.relations.values()].filter((r) => r.op === "dist")[25];
  assert.deepEqual([gap.args[0], gap.args[1]], ["r25k1", "r26k0"]);
  const work = counting(m);
  const t0 = performance.now();
  set(m, gap.name + ".value", 12.5);
  const report = m.solve();
  const ms = performance.now() - t0;
  assert.equal(report.solved, true, JSON.stringify(report.offenders));
  // The gap opened by moving the chain apart, not by narrowing the two
  // rectangles beside it (what the plain solve does: 1.24 off each, measured)
  // nor the two beside those (what a pull on the four narrowed widths alone
  // did: the drift moved one rectangle over).
  const worst = Math.max(...[...was].map(([l, w]) => Math.abs(lengthOf(m, l) - w) / w));
  assert.ok(worst < 1e-9, `every size kept: the worst is off by ${worst.toExponential(2)} of itself`);
  const [a, b] = [m.coords("r25k1"), m.coords("r26k0")];
  assert.ok(Math.abs(Math.hypot(...a.map((x, i) => x - b[i])) - 12.5) < 1e-6, "the gap is 12.5");
  assert.ok(m.coords("r39k0")[0] - x39 > 1 && x0 - m.coords("r0k0")[0] > 0.5, `the chain moved apart: ${(m.coords("r0k0")[0] - x0).toFixed(3)} and ${(m.coords("r39k0")[0] - x39).toFixed(3)}`);
  // The plain solve, the probe, the finish, the release, the whole: five, and
  // whatever the drawing's size. The probe pulls on every held size (all 160
  // lines are read for direction by a perp or a par), the finish on the free
  // ones — here all of them, nothing owns a width.
  const kinds = work.log.map((e) => (e.extra ? `pull(${e.extra})` : e.only !== null ? "release" : "whole"));
  assert.deepEqual(kinds, ["whole", "pull(160)", "pull(160)", "release", "whole"], kinds.join(" "));
  assert.ok(work.iterations() <= 30, `${work.iterations()} iterations (41 before, with the widths left 1e-2 off)`);
  console.log(`forty chained rectangles, widths free, a gap set: ${work.log.length} kernel solves, ${work.iterations()} iterations, ${ms.toFixed(1)} ms`);
  if (TIMING) assert.ok(ms < 400, `${ms} ms (NEOCAD_TIMING is set)`);
});

test("forty chained rectangles, widths dimensioned, one width set: the two sides it sets are the relations' own and never pulled; every other size is kept to 1e-9", () => {
  const m = perpRects(40, true);
  assert.equal(m.solve().solved, true);
  const was = sizes(m);
  const width = [...m.relations.values()].filter((r) => r.op === "dist" && String(r.args[0]).endsWith("k0") && String(r.args[1]).endsWith("k1"))[20];
  assert.deepEqual([width.args[0], width.args[1]], ["r20k0", "r20k1"]);
  const work = counting(m);
  const t0 = performance.now();
  set(m, width.name + ".value", 50);
  const report = m.solve();
  const ms = performance.now() - t0;
  assert.equal(report.solved, true, JSON.stringify(report.offenders));
  assert.ok(Math.abs(lengthOf(m, "r20e0") - 50) < 1e-9 && Math.abs(lengthOf(m, "r20e2") - 50) < 1e-9, "the width is the one asked for, on both sides");
  // The plain solve leaves every rectangle's height 0.5 to 1.4 off (measured:
  // the chain shears as the width grows), and r20's 5.5. All of it comes back.
  const others = [...was].filter(([l]) => l !== "r20e0" && l !== "r20e2");
  const worst = Math.max(...others.map(([l, w]) => Math.abs(lengthOf(m, l) - w) / w));
  assert.ok(worst < 1e-9, `every other size kept: the worst is off by ${worst.toExponential(2)} of itself`);
  // The probe found the two sides the dimension owns (they kept 98% of their
  // change under it) and the finish pulled the other 158, never those two.
  const pulls = work.log.filter((e) => e.extra).map((e) => e.extra);
  assert.deepEqual(pulls, [160, 158], `probe then finish: ${pulls}`);
  assert.equal(work.log.length, 5);
  assert.ok(work.iterations() <= 30, `${work.iterations()} iterations (27 before)`);
  console.log(`forty chained rectangles, widths dimensioned, a width set: ${work.log.length} kernel solves, ${work.iterations()} iterations, ${ms.toFixed(1)} ms`);
  if (TIMING) assert.ok(ms < 400, `${ms} ms (NEOCAD_TIMING is set)`);
});

// --- a drift that cannot be seen is not a drift -----------------------------------------------------

test("forty axis-held rectangles, the fix moved up 5: the first rectangle goes up whole, every size kept to 1e-9, five kernel solves", () => {
  const m = axisRects(40);
  assert.equal(m.solve().solved, true);
  const was = sizes(m);
  // A fix carries coordinates, not a value, so it is made again where the drawing is to go.
  del(m, [...m.relations.values()].find((r) => r.op === "fix")!.name);
  fix(m, "r0k0", [0, 5, 0]);
  const work = counting(m);
  const report = m.solve();
  assert.equal(report.solved, true, JSON.stringify(report.offenders));
  // The plain solve leaves a size 13% off (measured: the straight step spends
  // a free height on the way); the pull brings every size back.
  const worst = Math.max(...[...was].map(([l, w]) => Math.abs(lengthOf(m, l) - w) / w));
  assert.ok(worst < 1e-9, `every size kept: the worst is off by ${worst.toExponential(2)}`);
  // The first rectangle goes up whole; the gap to the next is a distance, so the rest need not follow.
  assert.ok(Math.abs(m.coords("r0k2")[1] - 30) < 1e-6, `moved whole: r0k2 at y = ${m.coords("r0k2")[1]}`);
  assert.equal(work.log.length, 5, `kernel solves: ${work.log.map((e) => e.extra).join(" ")}`);
  assert.ok(work.iterations() <= 30, `${work.iterations()} iterations`);
});

test("a visible drift is still pulled back: perp typed between two free lines stretches one 16%, and both end as long as they were", () => {
  const m = new Model(3);
  m.addPoint([-30, 0, 3], "p1"); m.addPoint([30, 4, -5], "p2"); m.addPoint([-30, 25, 11], "p3"); m.addPoint([30, 15, 2], "p4");
  m.addLine("p1", "p2", "l1"); m.addLine("p3", "p4", "l2");
  const was = sizes(m);
  perpendicular(m, "l1", "l2");
  const work = counting(m);
  assert.equal(m.solve().solved, true);
  for (const [l, w] of was) assert.ok(Math.abs(lengthOf(m, l) - w) / w < 1e-6, `${l}: ${w} → ${lengthOf(m, l)}`);
  assert.equal(work.log.length, 5, "the plain solve, the probe, the finish, the release, the whole");
  const pulls = work.log.filter((e) => e.extra).map((e) => e.extra);
  assert.deepEqual(pulls, [2, 2], "both lines free, both pulled");
});

test("a size that drifts by 1e-7 of itself is left alone: the fix on a level line's end moved by a hair, one solve", () => {
  const m = new Model(3);
  m.addPoint([0, 0, 0], "a"); m.addPoint([50, 0, 0], "b"); m.addLine("a", "b", "l1");
  parallel(m, "l1", "origin.x");
  const pin = fix(m, "a", [0, 0, 0], "origin");
  assert.equal(m.solve().solved, true);
  // A move of 1e-3 turns the line by 2e-5 and stretches it by half of that
  // squared: nothing anyone sees, and under `DRIFT`.
  del(m, pin);
  fix(m, "a", [0, 1e-3, 0], "origin");
  const work = counting(m);
  assert.equal(m.solve().solved, true);
  assert.equal(work.log.length, 1, `kernel solves: ${work.log.length}`);
  assert.ok(Math.abs(lengthOf(m, "l1") - 50) < 1e-6);
});

// --- the direction row against an axis reads the line's variables and nothing else (spec item 3a) ------

test("par(line, axis) in 3D: each block reads the line's six variables, never the frame's, and a row has at most six non-zeros", () => {
  const m = axisRects(1);
  m.solve();
  const problem = m.problem as unknown as { blocks: { block: ResidualBlock }[] };
  const axisBlocks = problem.blocks.filter((b) => b.block.label?.startsWith("par("));
  assert.equal(axisBlocks.length, 4);
  for (const { block } of axisBlocks) {
    const vars = typeof block.varIndices === "function" ? block.varIndices() : block.varIndices;
    assert.equal(vars.length, 6, `${block.label} reads ${vars.length} variables`);
  }
  // The frame is a datum: turning the drawing off its axes must not put the
  // frame's points in any row. Measured on forty such rectangles mid-drag:
  // 2.8 non-zeros a row, the dists' 4.0 (test/solver.measure.ts).
  m.setCoords("r0k1", [40, 3, 1]);
  const j = (m.problem as unknown as { evaluate: () => { rows: number[]; labels: (string | undefined)[] } }).evaluate();
  const perRow = new Map<number, number>();
  for (const r of j.rows) perRow.set(r, (perRow.get(r) ?? 0) + 1);
  j.labels.forEach((label, i) => {
    if (label?.startsWith("par(")) assert.ok((perRow.get(i) ?? 0) <= 6, `${label} row ${i}: ${perRow.get(i)} non-zeros`);
  });
});
