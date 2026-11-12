import { readFile } from "node:fs/promises";
const R = process.env.ROOT!;
const { ensureKernelLoaded } = await import(`${R}/src/kernel/problem.ts`);
const { Model } = await import(`${R}/src/model.ts`);
const { coplanar, dist, fix } = await import(`${R}/src/relations/basic.ts`);
const { parallel, perpendicular } = await import(`${R}/src/relations/geometry.ts`);
const { set } = await import(`${R}/src/operations.ts`);
await import(`${R}/src/modules/builtin.ts`);
await ensureKernelLoaded(await readFile(`${R}/src/kernel/wasm-gen/neocad_kernel_bg.wasm`));
function perpRects(n: number, chain: boolean) {
  const m = new Model(3);
  for (let r = 0; r < n; r++) {
    const x0 = r * 50;
    [[x0, 0, 0], [x0 + 40, 0, 0], [x0 + 40, 25, 0], [x0, 25, 0]].forEach((c, i) => m.addPoint(c, `r${r}k${i}`));
    for (let i = 0; i < 4; i++) m.addLine(`r${r}k${i}`, `r${r}k${(i + 1) % 4}`, `r${r}e${i}`);
    for (let i = 0; i < 4; i++) perpendicular(m, `r${r}e${i}`, `r${r}e${(i + 1) % 4}`);
    coplanar(m, `r${r}k3`, `r${r}k0`, `r${r}k1`, `r${r}k2`);
    dist(m, `r${r}k0`, `r${r}k1`, 40);
    if (chain && r > 0) { parallel(m, `r${r}e0`, `r${r - 1}e0`); dist(m, `r${r - 1}k1`, `r${r}k0`, 10); }
  }
  return m;
}
console.log("| drawing | set one width ×1.25: ms (best of 5) | iterations | add a par between two rectangles: ms | solved |"); console.log("|---|---|---|---|---|");
for (const chain of [true, false]) for (const n of [1, 5, 10, 20, 40]) {
  let best = Infinity, it = 0, bestPar = Infinity, ok = true;
  for (let rep = 0; rep < 5; rep++) {
    const m = perpRects(n, chain); m.solve();
    const d = m.relations.get([...m.relations.values()].filter((r: any) => r.op === "dist" && r.args[0].endsWith("k0") && r.args[1].endsWith("k1"))[Math.floor(n / 2)].name);
    let t0 = performance.now();
    set(m, d.name + ".value", 50); const rep1 = m.solve();
    best = Math.min(best, performance.now() - t0); it = rep1.iterations; ok &&= rep1.solved;
    if (n > 1 && !chain) {
      // turn one a little first, so the par has work to do
      const a = `r0k1`; const c = m.coords(a); m.setCoords(a, [c[0], c[1] + 6, c[2]]); m.solve();
      t0 = performance.now(); parallel(m, "r0e0", `r${n - 1}e0`); const r2 = m.solve(); bestPar = Math.min(bestPar, performance.now() - t0); ok &&= r2.solved;
    }
  }
  console.log(`| ${n} rectangles${chain ? ", chained by par + dist" : ", separate"} | ${best.toFixed(1)} | ${it} | ${Number.isFinite(bestPar) ? bestPar.toFixed(1) : "—"} | ${ok} |`);
}
