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
import { extrude } from "../src/operations.ts";
import { open } from "../src/persist.ts";
import { pullTo } from "../src/tools/engine.ts";
import { baseOf } from "./profiles.ts";
import "../src/modules/builtin.ts";

await ensureKernelLoaded(await readFile(new URL("../src/kernel/wasm-gen/neocad_kernel_bg.wasm", import.meta.url)));

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

console.log("\n## two free lines (60.133 and 60.828 long), one relation, then solve");
console.log("| relation | dim | l1 after | l2 after | worst relative change | iterations | solved |");
console.log("|---|---|---|---|---|---|---|");
const cases: [string, (m: Model) => void][] = [
  ["par(l1, l2)", (m) => { parallel(m, "l1", "l2"); }],
  ["perp(l1, l2)", (m) => { perpendicular(m, "l1", "l2"); }],
  ["ang(l1, l2, 60°)", (m) => { angle(m, "l1", "l2", Math.PI / 3); }],
  ["col(l1, l2)", (m) => { collinear(m, "l1", "l2"); }],
  ["on(p3, l1)", (m) => { pointOnLine(m, "p3", "l1"); }],
  ["sym(p3, p4, l1)", (m) => { symmetric(m, "p3", "p4", "l1"); }],
  ["par(l1, origin.x)", (m) => { parallel(m, "l1", "origin.x"); }],
];
for (const [name, add] of cases) {
  for (const dim of [2, 3]) {
    const m = twoLines(dim);
    const was = [lengthOf(m, "l1"), lengthOf(m, "l2")];
    add(m);
    const r = m.solve();
    const now = [lengthOf(m, "l1"), lengthOf(m, "l2")];
    const rel = Math.max(...now.map((v, i) => Math.abs(v - was[i]) / was[i]));
    console.log(`| ${name} | ${dim}D | ${f3(now[0])} | ${f3(now[1])} | ${e2(rel)} | ${r.iterations} | ${r.solved} |`);
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
console.log("| fixture | entities | relations | open: iterations | open: ms | open: moved from the file | jiggled: iterations | jiggled: ms | jiggled: solved |");
console.log("|---|---|---|---|---|---|---|---|---|");
const fixtures = ["bracket.zerocad", "curves-v12.neocad", "features-v12.neocad", "flat2d-v12.neocad", "pre-explicit-regions.neocad", "shapes-v15.neocad"];
for (const name of fixtures) {
  const text = await readFile(new URL(`./fixtures/${name}.json`, import.meta.url), "utf8");
  const m = open(text);
  const filed = m.problem.snapshot();
  const opened = best(m, () => m.solve());
  const moved = Math.max(0, ...filed.map((v, i) => Math.abs(m.problem.getVar(i) - v)));
  jiggle(m);
  const j = best(m, () => m.solve());
  console.log(`| ${name} | ${m.entities.size} | ${m.relations.size} | ${opened.out.iterations} | ${opened.ms.toFixed(2)} | ${e2(moved)} | ${j.out.iterations} | ${j.ms.toFixed(2)} | ${j.out.solved} |`);
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
  const filed = m.problem.snapshot();
  const opened = best(m, () => m.solve());
  const moved = Math.max(0, ...filed.map((v, i) => Math.abs(m.problem.getVar(i) - v)));
  // A smaller jiggle than a file's: 1% of two kilometres would be 20 on a side of 25.
  let k = 0;
  for (const e of m.entities.values()) if (e.kind === "point") m.setCoords(e.name, m.coords(e.name).map((c) => c + 0.5 * Math.sin(12.9898 * ++k)));
  const j = best(m, () => m.solve());
  console.log(`| forty rectangles (jiggled ±0.5) | ${m.entities.size} | ${m.relations.size} | ${opened.out.iterations} | ${opened.ms.toFixed(2)} | ${e2(moved)} | ${j.out.iterations} | ${j.ms.toFixed(2)} | ${j.out.solved} |`);
}
