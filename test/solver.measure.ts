// The measurements docs/plans/review-solver.md asks for, before and after the
// direction rows were normalised: run it on either side of the change and
// compare the tables.
//
//   node --experimental-strip-types test/solver.measure.ts
//
// Not part of `npm test` (the glob is *.test.ts): it asserts nothing, it
// prints. The assertions live in test/directionrows.test.ts. Timings are the
// best of three (the box is shared; the minimum is the least disturbed run).

import { readFile } from "node:fs/promises";
import { ensureKernelLoaded } from "../src/kernel/problem.ts";
import { Model } from "../src/model.ts";
import { coplanar, dist, fix } from "../src/relations/basic.ts";
import { angle, collinear, parallel, perpendicular, pointOnLine, symmetric } from "../src/relations/geometry.ts";
import { among } from "../src/relations/among.ts";
import { cornerAngle } from "../src/relations/smartdim.ts";
import { extrude } from "../src/operations.ts";
import { open } from "../src/persist.ts";
import { pullTo } from "../src/tools/engine.ts";
import { baseOf } from "./profiles.ts";
import "../src/modules/builtin.ts";

const wasm = await readFile(new URL("../src/kernel/wasm-gen/neocad_kernel_bg.wasm", import.meta.url));
await ensureKernelLoaded(wasm);
// Which kernel this is: `npm run build:kernel:dev` makes a debug build (~148 KB,
// its linear algebra ten times slower), a release build is ~32 KB without
// wasm-opt (`build:kernel:noopt`). A kernel step's time is meaningless on the
// debug one, so the table says which it was given.
console.log(`kernel: ${wasm.byteLength} bytes (${wasm.byteLength > 100_000 ? "a debug build — time nothing on it" : "a release build"})`);

const sub = (a: number[], b: number[]) => a.map((x, i) => x - b[i]);
const dot = (a: number[], b: number[]) => a.reduce((s, x, i) => s + x * b[i], 0);
const cross = (a: number[], b: number[]) => [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]];
const len = (a: number[]) => Math.hypot(...a);
const lengthOf = (m: Model, l: string) => len(sub(m.coords(m.line(l).refs[1]), m.coords(m.line(l).refs[0])));
const f3 = (x: number) => x.toFixed(3);
const e2 = (x: number) => x.toExponential(1);

/** The drawing of docs/images/422: two free lines, 60.1 and 60.8 long. */
function twoLines(dim: number): Model {
  const m = new Model(dim);
  const z = dim === 3 ? [0] : [];
  m.addPoint([-30, 0, ...z], "p1"); m.addPoint([30, 4, ...z], "p2");
  m.addPoint([-30, 25, ...z], "p3"); m.addPoint([30, 15, ...z], "p4");
  m.addLine("p1", "p2", "l1"); m.addLine("p3", "p4", "l2");
  return m;
}

console.log("\n## two free lines (l1 60.133 long, l2 60.828), one relation, then solve");
console.log("| relation | dim | lines it reads for direction: before → after | worst relative change | iterations | solved |");
console.log("|---|---|---|---|---|---|");
// Each with the lines it reads for their direction only: the ones whose length it has no business changing.
// (`on` and `sym` move p3 and p4, which are l2's ends, so l2's length is theirs to change.)
const cases: [string, string[], (m: Model) => void][] = [
  ["par(l1, l2)", ["l1", "l2"], (m) => { parallel(m, "l1", "l2"); }],
  ["perp(l1, l2)", ["l1", "l2"], (m) => { perpendicular(m, "l1", "l2"); }],
  ["ang(l1, l2, 60°)", ["l1", "l2"], (m) => { angle(m, "l1", "l2", Math.PI / 3); }],
  ["col(l1, l2)", ["l1", "l2"], (m) => { collinear(m, "l1", "l2"); }],
  ["on(p3, l1)", ["l1"], (m) => { pointOnLine(m, "p3", "l1"); }],
  ["sym(p3, p4, l1)", ["l1"], (m) => { symmetric(m, "p3", "p4", "l1"); }],
  ["par(l1, origin.x)", ["l1"], (m) => { parallel(m, "l1", "origin.x"); }],
];
for (const [name, lines, add] of cases) {
  for (const dim of [2, 3]) {
    const m = twoLines(dim);
    const was = lines.map((l) => lengthOf(m, l));
    add(m);
    const r = m.solve();
    const now = lines.map((l) => lengthOf(m, l));
    const rel = Math.max(...now.map((v, i) => Math.abs(v - was[i]) / was[i]));
    console.log(`| ${name} | ${dim}D | ${lines.map((l, i) => `${l} ${f3(was[i])} → ${f3(now[i])}`).join(", ")} | ${e2(rel)} | ${r.iterations} | ${r.solved} |`);
  }
}

console.log("\n## a drag of one end of a par pair (p2 pulled by [0, 20], 12 frames, then released)");
console.log("| dim | l1 (dragged) before → after | l2 (not touched) before → after | l2 relative change | still parallel (sin) |");
console.log("|---|---|---|---|---|");
for (const dim of [2, 3]) {
  const m = twoLines(dim);
  // Parallel to begin with, so the drag starts from a solved drawing whatever the row's form.
  m.setCoords("p4", dim === 3 ? [30, 29, 0] : [30, 29]);
  parallel(m, "l1", "l2");
  m.solve();
  const was = [lengthOf(m, "l1"), lengthOf(m, "l2")];
  const from = m.coords("p2");
  const by = dim === 3 ? [0, 20, 0] : [0, 20];
  for (let k = 1; k <= 12; k++) m.solveFrame(pullTo(m, "p2", from.map((c, i) => c + (by[i] * k) / 12)));
  m.solve();
  const now = [lengthOf(m, "l1"), lengthOf(m, "l2")];
  const u = sub(m.coords("p2"), m.coords("p1")), v = sub(m.coords("p4"), m.coords("p3"));
  const sin = dim === 3 ? len(cross(u, v)) / (len(u) * len(v)) : Math.abs(u[0] * v[1] - u[1] * v[0]) / (len(u) * len(v));
  console.log(`| ${dim}D | ${f3(was[0])} → ${f3(now[0])} | ${f3(was[1])} → ${f3(now[1])} | ${e2(Math.abs(now[1] - was[1]) / was[1])} | ${e2(sin)} |`);
}

/**
 * Four free lines, none parallel to another; in 3D no three of their ends in
 * a plane. For one relation among many (docs/plans/review-relations.md), whose
 * rows are the pair's, each member with the first listed; and for `corner`,
 * the angle two walls' lines make. "Before" for these is that branch alone.
 */
function fourLines(dim: number, parallelAlready = false): Model {
  const m = new Model(dim);
  const z = (h: number) => (dim === 3 ? [parallelAlready ? 0 : h] : []);
  const ends = parallelAlready
    ? [[-30, 0], [30, 4], [-30, 25], [30, 29], [-28, 40], [26, 43.6], [-20, -30], [34, -26.4]]
    : [[-30, 0], [30, 4], [-30, 25], [30, 15], [-28, 40], [26, 52], [-20, -30], [34, -12]];
  const lift = [3, -5, 11, 2, -4, 6, 8, -7];
  ends.forEach((e, i) => m.addPoint([e[0], e[1], ...z(lift[i])], `p${i + 1}`));
  for (let i = 0; i < 4; i++) m.addLine(`p${2 * i + 1}`, `p${2 * i + 2}`, `l${i + 1}`);
  return m;
}
const FOUR = ["l1", "l2", "l3", "l4"];

console.log("\n## four free lines, one relation among them (and `corner` of two), then solve");
console.log("| relation | dim | lines it reads for direction: before → after | worst relative change | iterations | solved |");
console.log("|---|---|---|---|---|---|");
const many: [string, string[], (m: Model) => void][] = [
  ["par(l1, l2, l3, l4)", FOUR, (m) => { among(m, "parallel", ...FOUR); }],
  ["col(l1, l2, l3, l4)", FOUR, (m) => { among(m, "collinear", ...FOUR); }],
  ["corner(l1, l2, 60°)", ["l1", "l2"], (m) => { cornerAngle(m, "l1", "l2", Math.PI / 3); }],
];
for (const [name, lines, add] of many) {
  for (const dim of [2, 3]) {
    const m = fourLines(dim);
    const was = lines.map((l) => lengthOf(m, l));
    add(m);
    const r = m.solve();
    const now = lines.map((l) => lengthOf(m, l));
    const rel = Math.max(...now.map((v, i) => Math.abs(v - was[i]) / was[i]));
    console.log(`| ${name} | ${dim}D | ${lines.map((l, i) => `${l} ${f3(was[i])} → ${f3(now[i])}`).join(", ")} | ${e2(rel)} | ${r.iterations} | ${r.solved} |`);
  }
}

console.log("\n## a drag of one end of one of four lines parallel as one relation (p2 pulled by [0, 20], 12 frames, then released)");
console.log("| dim | l1 (dragged) before → after | the three not touched, before → after | worst relative change of those | still parallel (worst sin) |");
console.log("|---|---|---|---|---|");
for (const dim of [2, 3]) {
  const m = fourLines(dim, true);
  among(m, "parallel", ...FOUR);
  m.solve();
  const was = FOUR.map((l) => lengthOf(m, l));
  const from = m.coords("p2");
  const by = dim === 3 ? [0, 20, 0] : [0, 20];
  for (let k = 1; k <= 12; k++) m.solveFrame(pullTo(m, "p2", from.map((c, i) => c + (by[i] * k) / 12)));
  m.solve();
  const now = FOUR.map((l) => lengthOf(m, l));
  const dir = (l: string) => sub(m.coords(m.line(l).refs[1]), m.coords(m.line(l).refs[0]));
  const sinTo = (l: string) => {
    const [u, v] = [dir("l1"), dir(l)];
    return (dim === 3 ? len(cross(u, v)) : Math.abs(u[0] * v[1] - u[1] * v[0])) / (len(u) * len(v));
  };
  const rest = [1, 2, 3];
  console.log(`| ${dim}D | ${f3(was[0])} → ${f3(now[0])} | ${rest.map((i) => `${FOUR[i]} ${f3(was[i])} → ${f3(now[i])}`).join(", ")} | ${e2(Math.max(...rest.map((i) => Math.abs(now[i] - was[i]) / was[i])))} | ${e2(Math.max(...rest.map((i) => sinTo(FOUR[i]))))} |`);
}

/** A 40 × 30 rectangle as the tool leaves one: four perps, and in 3D the flat. */
function rectangle(dim: number): Model {
  const m = new Model(dim);
  const z = dim === 3 ? [0] : [];
  [[0, 0], [40, 0], [40, 30], [0, 30]].forEach(([x, y], i) => m.addPoint([x, y, ...z], `p${i + 1}`));
  for (let i = 1; i <= 4; i++) m.addLine(`p${i}`, `p${(i % 4) + 1}`, `l${i}`);
  for (let i = 1; i <= 4; i++) perpendicular(m, `l${i}`, `l${(i % 4) + 1}`);
  if (dim === 3) coplanar(m, "p4", "p1", "p2", "p3");
  return m;
}

/** How far each corner is from square, as the length its far end is off by: |cos| × the longer side. */
function cornerError(m: Model): number {
  let worst = 0;
  for (let i = 1; i <= 4; i++) {
    const a = m.line(`l${i}`), b = m.line(`l${(i % 4) + 1}`);
    const u = sub(m.coords(a.refs[1]), m.coords(a.refs[0])), v = sub(m.coords(b.refs[1]), m.coords(b.refs[0]));
    worst = Math.max(worst, (Math.abs(dot(u, v)) / (len(u) * len(v))) * Math.max(len(u), len(v)));
  }
  return worst;
}

console.log("\n## the rectangle (40 × 30, four perps, in 3D the flat): a corner moved, then solved");
console.log("| dim | corner moved by | corners off square (length) | iterations | sides after |");
console.log("|---|---|---|---|---|");
for (const dim of [2, 3]) {
  const m = rectangle(dim);
  m.solve();
  const by = dim === 3 ? [3, 4, 7] : [3, 4];
  m.setCoords("p3", m.coords("p3").map((c, i) => c + by[i]));
  const r = m.solve();
  console.log(`| ${dim}D | [${by}] | ${e2(cornerError(m))} | ${r.iterations} | ${[1, 2, 3, 4].map((i) => f3(lengthOf(m, `l${i}`))).join(", ")} |`);
}

function prismError(m: Model, feature: string) {
  const f = m.featureOf(feature, "extrude");
  const d = m.relationOf(f.depth).args[1] as number;
  const pairs = [...baseOf(m, f.depth)].filter(([t, b]) => m.entities.get(t)?.kind === "point" && m.entities.get(b)?.kind === "point");
  const B = pairs.map(([, b]) => m.coords(b)), T = pairs.map(([t]) => m.coords(t));
  let n = [0, 0, 0];
  for (let i = 0; i < B.length; i++) for (let j = i + 1; j < B.length; j++) for (let k = j + 1; k < B.length; k++) {
    const c = cross(sub(B[j], B[i]), sub(B[k], B[i]));
    if (len(c) > len(n)) n = c;
  }
  n = n.map((x) => x / len(n));
  const walls = T.map((t, i) => sub(t, B[i]));
  return {
    flat: Math.max(...B.map((b) => Math.abs(dot(sub(b, B[0]), n)))),
    square: Math.max(...walls.map((w) => len(cross(w, n)))),
    depth: Math.max(...walls.map((w) => Math.abs(len(w) - Math.abs(d)))),
    translated: Math.max(...walls.map((w) => len(sub(w, walls[0])))),
  };
}

console.log("\n## the prism (that rectangle extruded 10): a lid corner dragged [12, −6, −8], then a base corner [3, −2, 9]");
console.log("| flat | walls square | depth | lid translated | corners off square | solved |");
console.log("|---|---|---|---|---|---|");
{
  const m = rectangle(3);
  m.solve();
  const e = extrude(m, "l1", 10);
  m.solve();
  const f = m.featureOf(e, "extrude");
  const twinOf = new Map([...baseOf(m, f.depth)].map(([t, b]) => [b, t]));
  const drag = (p: string, by: number[]) => {
    const from = m.coords(p);
    for (let k = 1; k <= 12; k++) m.solveFrame(pullTo(m, p, from.map((c, i) => c + (by[i] * k) / 12)));
    return m.solve().solved;
  };
  const ok = [drag(twinOf.get("p3")!, [12, -6, -8]), drag("p1", [3, -2, 9])];
  const pe = prismError(m, e);
  console.log(`| ${e2(pe.flat)} | ${e2(pe.square)} | ${e2(pe.depth)} | ${e2(pe.translated)} | ${e2(cornerError(m))} | ${ok.join(", ")} |`);
}

/** Runs `f` three times from the same values and keeps the fastest; returns what the last run returned. */
function best<T>(m: Model, f: () => T): { ms: number; out: T } {
  const start = m.problem.snapshot();
  let ms = Infinity, out!: T;
  for (let i = 0; i < 3; i++) {
    m.problem.restore(start);
    const t0 = performance.now();
    out = f();
    ms = Math.min(ms, performance.now() - t0);
  }
  return { ms, out };
}

/** Moves every point a deterministic 1% of the drawing's size off where it is. */
function jiggle(m: Model): void {
  const L = m.extent() || 1;
  let k = 0;
  for (const e of m.entities.values()) {
    if (e.kind !== "point") continue;
    m.setCoords(e.name, m.coords(e.name).map((c) => c + 0.01 * L * Math.sin(12.9898 * ++k)));
  }
}

console.log("\n## the solver fixtures: opened and solved; then every point moved 1% of the drawing's size and solved again");
console.log("(kernel: `problem.solve()`, the rows alone; model: `Model.solve()`, with its checks. Times are the best of three.)");
console.log("| fixture | entities | relations | open: iterations | open: ms | open: moved from the file | jiggled, kernel: iterations | ms | jiggled, model: iterations | ms | solved |");
console.log("|---|---|---|---|---|---|---|---|---|---|---|");

/** One row of the table: `m` as opened, then `jig` applied and solved both ways from the same jiggled values. */
function fixtureRow(name: string, m: Model, jig: () => void): void {
  const filed = m.problem.snapshot();
  const opened = best(m, () => m.solve());
  const moved = Math.max(0, ...filed.map((v, i) => Math.abs(m.problem.getVar(i) - v)));
  jig();
  const jiggled = m.problem.snapshot();
  // The model's solve first: it is what takes the values the rows are scaled by, as the app's does.
  const whole = best(m, () => m.solve());
  m.problem.restore(jiggled);
  const bare = best(m, () => m.problem.solve());
  console.log(`| ${name} | ${m.entities.size} | ${m.relations.size} | ${opened.out.iterations} | ${opened.ms.toFixed(2)} | ${e2(moved)} `
    + `| ${bare.out.iterations} | ${bare.ms.toFixed(2)} | ${whole.out.iterations} | ${whole.ms.toFixed(2)} | ${whole.out.solved} |`);
}

const fixtures = ["bracket.zerocad", "curves-v12.neocad", "features-v12.neocad", "flat2d-v12.neocad", "pre-explicit-regions.neocad", "shapes-v15.neocad",
  // Saved by review-relations (format 19, before the rows were normalised): relations among many, walls by name, `corner`.
  "review-relations-v19.neocad", "review-relations-drift-v19.neocad", "review-relations-wedge-v19.neocad"];
for (const name of fixtures) {
  const m = open(await readFile(new URL(`./fixtures/${name}.json`, import.meta.url), "utf8"));
  fixtureRow(name, m, () => jiggle(m));
}
{
  // Forty rectangles in a row, tied to each other: test/conflicts.test.ts's cost sketch.
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
  // A smaller jiggle than a file's: 1% of two kilometres would be 20 on a side of 25.
  fixtureRow("forty rectangles (jiggled ±0.5)", m, () => {
    let k = 0;
    for (const e of m.entities.values()) if (e.kind === "point") m.setCoords(e.name, m.coords(e.name).map((c) => c + 0.5 * Math.sin(12.9898 * ++k)));
  });
}


// --- what a direction row costs the kernel (docs/plans/solver-cost.md, item 3) -----------------------
//
// A unit direction depends on every coordinate of both ends, so `par(l,
// "origin.x")` in 3D names six variables a row where the raw wedge against a
// constant axis named two of them; and the kernel's conjugate gradient pays
// by the non-zero. Counted here, before anything is done about it: the rows
// and non-zeros of the par-to-axes frame by the kind of row, how long one
// evaluation of the rows takes against one kernel step on the Jacobian it
// gives, and how many CG iterations that step takes — by a TypeScript mirror
// of solver.rs's loop (the kernel does not report them), run on the same
// triplets to the same tolerance.

import { solve_step } from "../src/kernel/wasm-gen/neocad_kernel.js";
import type { ResidualBlock } from "../src/kernel/problem.ts";

/** Forty rectangles held `par` to the axes, widths dimensioned and every other height, chained: the spec's drag frame (test/keptsizes.measure.ts's `axisRects`). */
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

type Triplets = { r: number[]; rows: number[]; cols: number[]; vals: number[]; labels: (string | undefined)[] };
/** The problem's rows and sparse Jacobian at its current values — `Problem.evaluate`, which is private to the kernel and read here only to count. */
function jacobian(m: Model, extra: ResidualBlock[] = []): Triplets {
  return (m.problem as unknown as { evaluate: (extra: ResidualBlock[]) => Triplets }).evaluate(extra);
}

/** solver.rs's `solve_damped_step`, step for step, counting its CG iterations; returns them. */
function cgIterations(j: Triplets, n: number, lambda: number, maxIter = 200, tol = 1e-10): number {
  const m = j.r.length;
  const mul = (v: number[]) => { const out = new Array<number>(m).fill(0); for (let k = 0; k < j.vals.length; k++) out[j.rows[k]] += j.vals[k] * v[j.cols[k]]; return out; };
  const mulT = (v: number[]) => { const out = new Array<number>(n).fill(0); for (let k = 0; k < j.vals.length; k++) out[j.cols[k]] += j.vals[k] * v[j.rows[k]]; return out; };
  const diag = new Array<number>(n).fill(0);
  for (let k = 0; k < j.vals.length; k++) diag[j.cols[k]] += j.vals[k] * j.vals[k];
  const apply = (v: number[]) => { const out = mulT(mul(v)); for (let i = 0; i < n; i++) out[i] += lambda * (1 + diag[i]) * v[i]; return out; };
  const dotv = (a: number[], b: number[]) => a.reduce((s, x, i) => s + x * b[i], 0);
  let res = mulT(j.r).map((x) => -x);
  let p = res.slice();
  let rsOld = dotv(res, res);
  if (Math.sqrt(rsOld) < tol) return 0;
  const iters = Math.max(1, Math.min(maxIter, Math.max(n, 1)));
  let count = 0;
  for (let it = 0; it < iters; it++) {
    const ap = apply(p);
    const pap = dotv(p, ap);
    count++;
    if (Math.abs(pap) < 1e-300) break;
    const alpha = rsOld / pap;
    for (let i = 0; i < n; i++) res[i] -= alpha * ap[i];
    const rsNew = dotv(res, res);
    if (Math.sqrt(rsNew) < tol) break;
    const beta = rsNew / rsOld;
    for (let i = 0; i < n; i++) p[i] = res[i] + beta * p[i];
    rsOld = rsNew;
  }
  return count;
}

/** Rows and non-zeros by the word a label starts with (`par(`, `dist(`, …), and the empty rows (a wedge's component along the axis is identically zero). */
function rowCensus(j: Triplets): string {
  const perRow = new Array<number>(j.r.length).fill(0);
  for (const r of j.rows) perRow[r]++;
  const byKind = new Map<string, { rows: number; nnz: number; empty: number }>();
  j.labels.forEach((l, i) => {
    const kind = (l ?? "extra").replace(/\(.*$/, "");
    const e = byKind.get(kind) ?? { rows: 0, nnz: 0, empty: 0 };
    e.rows++; e.nnz += perRow[i]; if (!perRow[i]) e.empty++;
    byKind.set(kind, e);
  });
  return [...byKind].map(([k, e]) => `${k}: ${e.rows} rows, ${e.nnz} nnz (${(e.nnz / Math.max(1, e.rows - e.empty)).toFixed(1)} a non-empty row${e.empty ? `, ${e.empty} empty` : ""})`).join("; ");
}

console.log("\n## the par-to-axes frame: what the rows cost, and what the kernel's step costs on them (forty rectangles; a frame pulling r21k2 up 9)");
console.log("| state | variables | rows | non-zeros | by kind | evaluate ms | solve_step ms (λ = 1e-3) | CG iterations (mirror, λ = 1e-3) | CG iterations (λ = 1e-10) |");
console.log("|---|---|---|---|---|---|---|---|---|");
{
  const m = axisRects(40);
  m.solve();
  const n = m.problem.varCount;
  const from = m.coords("r21k2");
  const pullAt = (k: number) => pullTo(m, "r21k2", [from[0], from[1] + 9 * k / 30, from[2]]);
  const census = (name: string, extra: ResidualBlock[]) => {
    const j = jacobian(m, extra);
    const evalMs = best(m, () => { for (let i = 0; i < 10; i++) jacobian(m, extra); }).ms / 10;
    const rows = new Uint32Array(j.rows), cols = new Uint32Array(j.cols), vals = new Float64Array(j.vals), r = new Float64Array(j.r);
    const stepMs = best(m, () => { for (let i = 0; i < 10; i++) solve_step(rows, cols, vals, r, n, 1e-3); }).ms / 10;
    console.log(`| ${name} | ${n} | ${j.r.length} | ${j.vals.length} | ${rowCensus(j)} | ${evalMs.toFixed(2)} | ${stepMs.toFixed(3)} | ${cgIterations(j, n, 1e-3)} | ${cgIterations(j, n, 1e-10)} |`);
  };
  census("at rest, no pull", []);
  census("the first frame's pull, before its solve", pullAt(1));
  // Ten frames in, the lines near the dragged corner are off their axes by
  // the frame's step, and a unit direction's gradient is no longer diagonal:
  // the non-zeros a row are what a drag really pays for.
  for (let k = 1; k <= 10; k++) m.solveFrame(pullAt(k));
  census("ten frames in, the eleventh's pull, before its solve", pullAt(11));
  m.solve();
  // The frame itself, as the engine runs it: the median of thirty, best of five.
  let bestMed = Infinity, iters = 0;
  for (let rep = 0; rep < 5; rep++) {
    const t: number[] = [];
    let it = 0;
    for (let k = 1; k <= 30; k++) {
      const t0 = performance.now();
      it += m.solveFrame(pullAt(k)).iterations;
      t.push(performance.now() - t0);
    }
    const med = [...t].sort((a, b) => a - b)[15];
    if (med < bestMed) { bestMed = med; iters = it / 30; }
    m.solve();
  }
  console.log(`\nthe frame: median ${bestMed.toFixed(2)} ms, ${iters.toFixed(1)} LM iterations a frame`);
}
