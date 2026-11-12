// What a through-all cut's solve costs (docs/plans/through-all-relation.md):
// run it on the build before the change and on the build after, and compare.
//
//   node --experimental-strip-types test/through.measure.ts
//
// Not part of `npm test` (the glob is *.test.ts): it asserts nothing, it
// prints. The assertions are in test/throughrelation.test.ts. Times are the
// least of five runs (the box is shared; the least is the least disturbed).
// Only calls both builds have, so the same file runs on either.

import { Model } from "../src/model.ts";
import { onPlane } from "../src/relations/basic.ts";
import { extrude, set } from "../src/operations.ts";
import { pullTo } from "../src/tools/engine.ts";
import { T, circleOn, loadSolver, onTop, plate, type Plate } from "./solids/scene.ts";
import "../src/modules/builtin.ts";

await loadSolver();

const sub = (a: number[], b: number[]) => a.map((x, i) => x - b[i]);
const dot = (a: number[], b: number[]) => a.reduce((s, x, i) => s + x * b[i], 0);

interface Scene { m: Model; p: Plate; hole: string; pocket: string | null }

/** The plate with a round hole through all from its top — and, when asked, a square pocket through all beside it. */
function scene(withPocket: boolean): Scene {
  const m = new Model(3);
  const p = plate(m);
  const top = p.lid.slice(0, 3).join(".");
  const hole = extrude(m, circleOn(m, top, onTop(p, 30, 30), 5, p.t.uz), -1, { mode: "cut", end: "through" });
  m.solve();
  let pocket: string | null = null;
  if (withPocket) {
    const sq = [[60, 20], [80, 20], [80, 40], [60, 40]].map(([u, v]) => m.addPoint(onTop(p, u, v)).name);
    const sl = sq.map((q, i) => m.addLine(q, sq[(i + 1) % 4]).name);
    for (const q of sq) onPlane(m, q, top);
    pocket = extrude(m, sl[0], -1, { mode: "cut", end: "through" });
    m.solve();
  }
  return { m, p, hole, pocket };
}

/** A feature's chord in the plate's frame: [across, across, along] — its lean is the first two. */
function chord(s: Scene, feature: string): number[] {
  const f = s.m.featureOf(feature, "extrude");
  const pairs = s.m.relationOf(f.depth).args.slice(2) as string[];
  const d = sub(s.m.coords(pairs[1]), s.m.coords(pairs[0]));
  return [s.p.t.ux, s.p.t.uy, s.p.t.uz].map((a) => dot(d, a));
}

const least = (xs: number[]) => Math.min(...xs).toFixed(2);

console.log("\n## a through cut's solve");
console.log("| case | solved | iterations | ms (least of 5) | the cut's chord: lean, length | the lid off the plate's far face |");
console.log("|---|---|---|---|---|---|");
for (const withPocket of [false, true]) {
  const what = withPocket ? "a hole and a pocket" : "a hole";
  // 1. The plate set twice as deep: the cut follows.
  {
    const ms: number[] = [];
    let line = "";
    for (let run = 0; run < 5; run++) {
      const s = scene(withPocket);
      const t0 = performance.now();
      set(s.m, `${s.m.featureOf(s.p.feature, "extrude").depth}.value`, 2 * T);
      const r = s.m.solve();
      ms.push(performance.now() - t0);
      const c = chord(s, s.hole);
      // The plate's base is at 0 along the frame; the hole's sketch is on its top, 2T up.
      line = `${r.solved} | ${r.iterations} | MS | ${Math.hypot(c[0], c[1]).toExponential(1)}, ${Math.abs(c[2]).toFixed(4)} | ${(2 * T - Math.abs(c[2])).toFixed(4)}`;
    }
    console.log(`| ${what}: the plate set from ${T} to ${2 * T} deep | ${line.replace("MS", least(ms))} |`);
  }
  // 2. At rest: a solve of the drawing as it stands.
  {
    const ms: number[] = [];
    let line = "";
    for (let run = 0; run < 5; run++) {
      const s = scene(withPocket);
      const t0 = performance.now();
      const r = s.m.solve();
      ms.push(performance.now() - t0);
      const c = chord(s, s.hole);
      line = `${r.solved} | ${r.iterations} | MS | ${Math.hypot(c[0], c[1]).toExponential(1)}, ${Math.abs(c[2]).toFixed(4)} | ${(T - Math.abs(c[2])).toFixed(4)}`;
    }
    console.log(`| ${what}: at rest | ${line.replace("MS", least(ms))} |`);
  }
  // 3. A drag: a corner of the plate's top pulled 8 along the top's normal in twelve frames.
  {
    const ms: number[] = [];
    let line = "";
    for (let run = 0; run < 5; run++) {
      const s = scene(withPocket);
      const from = s.m.coords(s.p.lid[2]);
      const by = s.p.t.uz.map((c) => 8 * c);
      let it = 0;
      const t0 = performance.now();
      for (let k = 1; k <= 12; k++) it += s.m.solveFrame(pullTo(s.m, s.p.lid[2], from.map((c, i) => c + (by[i] * k) / 12))).iterations;
      const r = s.m.solve();
      ms.push(performance.now() - t0);
      const c = chord(s, s.hole);
      line = `${r.solved} | ${it + r.iterations} | MS | ${Math.hypot(c[0], c[1]).toExponential(1)}, ${Math.abs(c[2]).toFixed(4)} | —`;
    }
    console.log(`| ${what}: a top corner dragged 8 off the top, twelve frames and a solve | ${line.replace("MS", least(ms))} |`);
  }
}
