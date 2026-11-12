// The two solver costs docs/plans/solver-cost.md was written from — an
// ordinary edit (one dimension set, then the solve the app runs) and a drag's
// frame — on drawings large enough to feel on a phone. Run it on either side
// of a change and compare the tables:
//
//   node --experimental-strip-types test/keptsizes.measure.ts
//
// Not part of `npm test` (the glob is *.test.ts): it asserts nothing, it
// prints. The assertions — how many kernel solves `Model.solve` spends on an
// edit, and what `keptSizes` pulls on — are test/keptsizes.test.ts's. Times
// are the best of five (the box is shared; the minimum is the least disturbed
// run); the kernel solves and their iterations are counted beside each, since
// those do not depend on the load. The scripts this grew from were the
// review's `bench/drag.ts` and `bench/edit.ts`.

import { readFile } from "node:fs/promises";
import { ensureKernelLoaded } from "../src/kernel/problem.ts";
import { Model } from "../src/model.ts";
import { coplanar, dist, fix } from "../src/relations/basic.ts";
import { parallel, perpendicular } from "../src/relations/geometry.ts";
import { open } from "../src/persist.ts";
import { pullTo } from "../src/tools/engine.ts";
import { set } from "../src/operations.ts";
import "../src/modules/builtin.ts";

const wasm = await readFile(new URL("../src/kernel/wasm-gen/neocad_kernel_bg.wasm", import.meta.url));
await ensureKernelLoaded(wasm);
// Which kernel this is: `npm run build:kernel:dev` makes a debug build (~148 KB,
// its linear algebra ten times slower), a release build is ~32 KB without
// wasm-opt. Every timing below is the kernel's as much as the rows', so say.
console.log(`kernel: ${wasm.byteLength} bytes (${wasm.byteLength > 100_000 ? "a debug build — time nothing on it" : "a release build"})\n`);

/** Every kernel solve the model asks for, and their iterations, as test/conflicts.test.ts counts them. */
function counting(m: Model): { solves: () => number; iterations: () => number; off: () => void } {
  const orig = m.problem.solve.bind(m.problem);
  let solves = 0, iterations = 0;
  m.problem.solve = (...args: Parameters<typeof orig>) => {
    const r = orig(...args);
    solves++;
    iterations += r.iterations;
    return r;
  };
  // The wrapper is an own property over the prototype's method; taking it off leaves the method.
  return { solves: () => solves, iterations: () => iterations, off: () => { delete (m.problem as { solve?: unknown }).solve; } };
}

/**
 * Forty rectangles in a row held `par` to the axes, each width dimensioned
 * and every other height, chained by a `dist` between neighbours and the
 * first corner fixed: test/conflicts.test.ts's cost sketch, with half the
 * heights free so a corner can be dragged.
 */
export function axisRects(n: number): Model {
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

/**
 * Rectangles as the rectangle tool leaves them — four perps and a flat — in
 * a row. `chain` ties each to the one before by a `par` of their bases and a
 * `dist` between them, so the drawing is one connected part; `widths` puts a
 * dimension on every width. With the widths free, a dimension set on the
 * chain moves every point by a hair and nothing's size on purpose: the case
 * the spec says to fix first.
 */
export function perpRects(n: number, chain: boolean, widths: boolean): Model {
  const m = new Model(3);
  for (let r = 0; r < n; r++) {
    const x0 = r * 50;
    [[x0, 0, 0], [x0 + 40, 0, 0], [x0 + 40, 25, 0], [x0, 25, 0]].forEach((c, i) => m.addPoint(c, `r${r}k${i}`));
    for (let i = 0; i < 4; i++) m.addLine(`r${r}k${i}`, `r${r}k${(i + 1) % 4}`, `r${r}e${i}`);
    for (let i = 0; i < 4; i++) perpendicular(m, `r${r}e${i}`, `r${r}e${(i + 1) % 4}`);
    coplanar(m, `r${r}k3`, `r${r}k0`, `r${r}k1`, `r${r}k2`);
    if (widths) dist(m, `r${r}k0`, `r${r}k1`, 40);
    if (chain && r > 0) { parallel(m, `r${r}e0`, `r${r - 1}e0`); dist(m, `r${r - 1}k1`, `r${r}k0`, 10); }
  }
  return m;
}

const med = (a: number[]) => [...a].sort((x, y) => x - y)[Math.floor(a.length / 2)];

/** One dimension `set` and the solve the app runs after it, the best of five fresh models; the kernel solves and iterations of the best run. */
function editBench(name: string, make: () => Model, pick: (m: Model) => { name: string; value: number }): void {
  let best = Infinity, solves = 0, iterations = 0, ok = true;
  for (let rep = 0; rep < 5; rep++) {
    const m = make();
    m.solve();
    const d = pick(m);
    const work = counting(m);
    const t0 = performance.now();
    set(m, d.name + ".value", d.value);
    const r = m.solve();
    const ms = performance.now() - t0;
    ok &&= r.solved;
    if (ms < best) { best = ms; solves = work.solves(); iterations = work.iterations(); }
  }
  console.log(`| ${name} | ${best.toFixed(1)} | ${solves} | ${iterations} | ${ok} |`);
}

/** The nth `dist` relation of the model, by the order they were made. */
const nthDist = (m: Model, n: number, where: (args: readonly unknown[]) => boolean = () => true) =>
  [...m.relations.values()].filter((r) => r.op === "dist" && where(r.args))[n];

console.log("## an ordinary edit: one dimension set, then the solve the app runs");
console.log("| drawing, edit | best ms of 5 | kernel solves | iterations | solved |");
console.log("|---|---|---|---|---|");
// The spec's two rows first. With the widths free the only dimensions are the
// chain's gaps, so the 25th `dist` is a gap between two rectangles; with the
// widths dimensioned it is the twentieth rectangle's width.
editBench("40 rectangles (perps), chained, widths free: a gap ×1.25", () => perpRects(40, true, false), (m) => {
  const d = nthDist(m, 25);
  return { name: d.name, value: (d.args[2] as number) * 1.25 };
});
editBench("40 rectangles (perps), chained, widths dimensioned: a width 40 → 50", () => perpRects(40, true, true), (m) => {
  const d = nthDist(m, 20, (a) => String(a[0]).endsWith("k0") && String(a[1]).endsWith("k1"));
  return { name: d.name, value: 50 };
});
editBench("40 rectangles (par to axes, dims): a width ×1.25", () => axisRects(40), (m) => {
  const d = nthDist(m, 25);
  return { name: d.name, value: (d.args[2] as number) * 1.25 };
});
// How the dimensioned edit grows with the drawing, chained and separate (the
// review's `bench/edit.ts`): separate rectangles share no variable, so a set
// touches one part; chained, the part is the drawing.
for (const chain of [true, false]) {
  for (const n of [1, 5, 10, 20, 40]) {
    editBench(`${n} rectangle${n > 1 ? "s" : ""} (perps), ${chain ? "chained" : "separate"}, widths dimensioned: a width 40 → 50`, () => perpRects(n, chain, true), (m) => {
      const d = nthDist(m, Math.floor(n / 2), (a) => String(a[0]).endsWith("k0") && String(a[1]).endsWith("k1"));
      return { name: d.name, value: 50 };
    });
  }
}

/**
 * A drag of `p` by `by` in `frames` frames (`Model.solveFrame`), then the
 * release's `Model.solve`: the frame's median and worst, and the release, each
 * the best of five runs from the same start. A frame has 16 ms on a phone.
 */
function dragBench(name: string, m: Model, p: string, by: number[], frames = 30): void {
  m.solve();
  const start = m.problem.snapshot();
  let bestMed = Infinity, bestMax = Infinity, rel = Infinity, relSolves = 0, relIter = 0;
  for (let rep = 0; rep < 5; rep++) {
    m.problem.restore(start);
    m.solve();
    const from = m.coords(p);
    const t: number[] = [];
    for (let k = 1; k <= frames; k++) {
      const t0 = performance.now();
      m.solveFrame(pullTo(m, p, from.map((c, i) => c + (by[i] ?? 0) * k / frames)));
      t.push(performance.now() - t0);
    }
    const work = counting(m);
    const t0 = performance.now();
    m.solve();
    const r = performance.now() - t0;
    bestMed = Math.min(bestMed, med(t));
    bestMax = Math.min(bestMax, Math.max(...t));
    if (r < rel) { rel = r; relSolves = work.solves(); relIter = work.iterations(); }
    work.off();
  }
  console.log(`| ${name} | ${bestMed.toFixed(2)} | ${bestMax.toFixed(2)} | ${rel.toFixed(2)} | ${relSolves} | ${relIter} |`);
}

console.log("\n## a drag: thirty frames, then the release");
console.log("| drawing, drag | frame median ms | frame worst ms | release solve ms | release: kernel solves | iterations |");
console.log("|---|---|---|---|---|---|");
dragBench("40 rectangles (par to axes, dims), a free corner up 9", axisRects(40), "r21k2", [0, 9, 0]);
dragBench("40 rectangles (perps, chained by par), a corner by [12, 7]", perpRects(40, true, false), "r20k2", [12, 7, 0]);
dragBench("10 rectangles (perps, chained by par), a corner by [12, 7]", perpRects(10, true, false), "r5k2", [12, 7, 0]);
dragBench("1 rectangle (perps), a corner by [12, 7]", perpRects(1, false, false), "r0k2", [12, 7, 0]);
for (const f of ["features-v12.neocad", "shapes-v15.neocad", "bracket.zerocad"]) {
  const m = open(await readFile(new URL(`./fixtures/${f}.json`, import.meta.url), "utf8"));
  const pts = [...m.entities.values()].filter((e) => e.kind === "point").map((e) => e.name);
  const p = pts[Math.floor(pts.length / 2)];
  const L = m.extent() || 1;
  dragBench(`${f}, point ${p} by 3% of the drawing each way`, m, p, m.coords(p).map(() => 0.03 * L));
}
