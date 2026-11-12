// Per-frame drag cost and an ordinary edit's cost, on a given checkout: ROOT=<repo> node --experimental-strip-types drag.ts
import { readFile } from "node:fs/promises";
const R = process.env.ROOT!;
const { ensureKernelLoaded } = await import(`${R}/src/kernel/problem.ts`);
const { Model } = await import(`${R}/src/model.ts`);
const { coplanar, dist, fix } = await import(`${R}/src/relations/basic.ts`);
const { parallel, perpendicular } = await import(`${R}/src/relations/geometry.ts`);
const { open } = await import(`${R}/src/persist.ts`);
const { pullTo } = await import(`${R}/src/tools/engine.ts`);
const { set } = await import(`${R}/src/operations.ts`);
await import(`${R}/src/modules/builtin.ts`);
await ensureKernelLoaded(await readFile(`${R}/src/kernel/wasm-gen/neocad_kernel_bg.wasm`));

const med = (a: number[]) => [...a].sort((x, y) => x - y)[Math.floor(a.length / 2)];
function dragBench(name: string, m: any, p: string, by: number[], frames = 30) {
  m.solve();
  const start = m.problem.snapshot();
  let bestMed = Infinity, bestMax = Infinity, rel = Infinity;
  for (let rep = 0; rep < 5; rep++) {
    m.problem.restore(start); m.solve();
    const from = m.coords(p); const t: number[] = [];
    for (let k = 1; k <= frames; k++) {
      const t0 = performance.now();
      m.solveFrame(pullTo(m, p, from.map((c: number, i: number) => c + (by[i] ?? 0) * k / frames)));
      t.push(performance.now() - t0);
    }
    const t0 = performance.now(); m.solve(); const r = performance.now() - t0;
    bestMed = Math.min(bestMed, med(t)); bestMax = Math.min(bestMax, Math.max(...t)); rel = Math.min(rel, r);
  }
  console.log(`| ${name} | ${bestMed.toFixed(2)} | ${bestMax.toFixed(2)} | ${rel.toFixed(2)} |`);
}
function axisRects(n: number) {
  const m = new Model(3);
  for (let r = 0; r < n; r++) {
    const x0 = r * 50;
    [[x0, 0, 0], [x0 + 40, 0, 0], [x0 + 40, 25, 0], [x0, 25, 0]].forEach((c, i) => m.addPoint(c, `r${r}k${i}`));
    for (let i = 0; i < 4; i++) m.addLine(`r${r}k${i}`, `r${r}k${(i + 1) % 4}`, `r${r}e${i}`);
    parallel(m, `r${r}e0`, "origin.x"); parallel(m, `r${r}e2`, "origin.x");
    parallel(m, `r${r}e1`, "origin.y"); parallel(m, `r${r}e3`, "origin.y");
    dist(m, `r${r}k0`, `r${r}k1`, 40); if (r % 2 === 0) dist(m, `r${r}k1`, `r${r}k2`, 25);
    if (r === 0) fix(m, "r0k0", [0, 0, 0]); else dist(m, `r${r - 1}k1`, `r${r}k0`, 10);
  }
  return m;
}
// As the rectangle tool leaves them: four perps and a flat, free of each other but for a shared par.
function perpRects(n: number) {
  const m = new Model(3);
  for (let r = 0; r < n; r++) {
    const x0 = r * 50;
    [[x0, 0, 0], [x0 + 40, 0, 0], [x0 + 40, 25, 0], [x0, 25, 0]].forEach((c, i) => m.addPoint(c, `r${r}k${i}`));
    for (let i = 0; i < 4; i++) m.addLine(`r${r}k${i}`, `r${r}k${(i + 1) % 4}`, `r${r}e${i}`);
    for (let i = 0; i < 4; i++) perpendicular(m, `r${r}e${i}`, `r${r}e${(i + 1) % 4}`);
    coplanar(m, `r${r}k3`, `r${r}k0`, `r${r}k1`, `r${r}k2`);
    if (r > 0) { parallel(m, `r${r}e0`, `r${r - 1}e0`); dist(m, `r${r - 1}k1`, `r${r}k0`, 10); }
  }
  return m;
}
console.log("| drawing, drag | frame median ms | frame worst ms | release solve ms |"); console.log("|---|---|---|---|");
//dragBench("1 rectangle (4 perps), corner", perpRects(1), "r0k2", [12, 7, 0]);
//dragBench("10 rectangles (perps, par chain), corner", perpRects(10), "r5k2", [12, 7, 0]);
//dragBench("40 rectangles (perps, par chain), corner", perpRects(40), "r20k2", [12, 7, 0]);
//dragBench("40 rectangles (par to axes, dims), free corner", axisRects(40), "r21k2", [0, 9, 0]);
for (const f of ["features-v12.neocad", "shapes-v15.neocad", "bracket.zerocad"]) {
  const m = open(await readFile(`${R}/test/fixtures/${f}.json`, "utf8"));
  const pts = [...m.entities.values()].filter((e: any) => e.kind === "point").map((e: any) => e.name);
  const p = pts[Math.floor(pts.length / 2)];
  const L = m.extent() || 1;
  //dragBench(`${f}, point ${p}`, m, p, m.coords(p).map(() => 0.03 * L));
}
// An ordinary edit: one dimension set, then the solve the app runs.
console.log("\n| drawing, edit | best ms of 5 |"); console.log("|---|---|");
for (const [name, make] of [["40 rectangles (par to axes)", () => axisRects(40)], ["40 rectangles (perps)", () => perpRects(40)]] as const) {
  let best = Infinity;
  for (let rep = 0; rep < 5; rep++) {
    const m = make(); m.solve();
    const d = [...m.relations.values()].filter((r: any) => r.op === "dist")[25];
    const t0 = performance.now();
    try { set(m, d.name + ".value", (d.args[2] as number) * 1.25); m.solve(); } catch (e) { console.log("set failed", String(e)); break; }
    best = Math.min(best, performance.now() - t0);
  }
  console.log(`| ${name}: one dist ×1.25 | ${best.toFixed(2)} |`);
}
