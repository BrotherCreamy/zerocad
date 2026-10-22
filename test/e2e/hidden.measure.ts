// The measurement behind dimming hidden edges (docs/plans/hidden-edges.md):
// what the app's frames cost before the pass and after it, on the three scenes
// the spec names — the stepped block, a boss on a plate, and a filleted full
// turn (hundreds of strips, the case where samples × faces is largest).
//
// Not part of `npm run test:e2e`: it renders a few hundred frames. Run it with
// `npm run measure:hidden`; set NEOCAD_MEASURE_DIR to keep hidden-results.json.
//
// **What is timed** is the app's own frames, exactly as depth.measure.ts times
// them (`appFrames`): the view turned a little each animation frame and
// `render()` called, so the frame interval is what a user orbiting it gets and
// `render()`'s own share is the main thread's part of it. Three fresh apps a
// scene, the median of each number, because one SwiftShader run wanders by a
// few milliseconds on its own.

import { test, after } from "node:test";
import assert from "node:assert/strict";
import { mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { openApp } from "./harness.ts";
import { appFrames, build, scene, type Frames } from "./scenes.ts";

const OUT = process.env.NEOCAD_MEASURE_DIR;
const TIMED_FRAMES = 90;
const RUNS = 3;
const TIMED = ["stepped-boss", "boss-plate", "filleted-turn"];

const results: Record<string, { runs: Frames[]; frame: number; submit: number }> = {};

after(() => {
  if (!OUT) return;
  mkdirSync(OUT, { recursive: true });
  writeFileSync(join(OUT, "hidden-results.json"), JSON.stringify(results, null, 2));
});

const median = (xs: number[]) => xs.slice().sort((a, b) => a - b)[Math.floor(xs.length / 2)];

for (const name of TIMED) {
  test(`${name}: ${scene(name).what}`, async () => {
    const runs: Frames[] = [];
    for (let i = 0; i < RUNS; i++) {
      const app = await openApp();
      try {
        await build(app, scene(name).source);
        runs.push(await app.page.evaluate(appFrames, { frames: TIMED_FRAMES }));
        assert.deepEqual(app.pageErrors, []);
      } finally {
        await app.close();
      }
    }
    const frame = median(runs.map((r) => r.frame)), submit = median(runs.map((r) => r.submit));
    results[name] = { runs, frame, submit };
    console.log(`${name}, ${runs[0].faces} faces: ${frame.toFixed(1)} ms a frame, render() ${submit.toFixed(2)} ms of it ` +
      `(median of ${RUNS} × ${TIMED_FRAMES} frames; frames ${runs.map((r) => r.frame.toFixed(1)).join(", ")})`);
  });
}
