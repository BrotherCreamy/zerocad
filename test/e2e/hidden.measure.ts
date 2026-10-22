// The measurement behind dimming hidden edges (docs/plans/hidden-edges.md):
// what the pass costs, on the three scenes the spec names — the stepped
// block, a boss on a plate, and a filleted full turn (hundreds of strips, the
// case where samples × faces is largest).
//
// Not part of `npm run test:e2e`: it renders a few hundred frames. Run it with
// `npm run measure:hidden`; set NEOCAD_MEASURE_DIR to keep hidden-results.json.
//
// **The app's frames**, exactly as depth.measure.ts times them (`appFrames`):
// the view turned a little each animation frame and `render()` called, so the
// frame interval is what a user orbiting it gets and `render()`'s own share is
// the main thread's part of it. Three fresh apps a scene, the median, because
// one SwiftShader run on a shared machine wanders by tens of milliseconds on
// its own. Run on the build before the pass and on this one for the before and
// after; the frame interval is the number a user feels, and is mostly the GPU
// process rasterising, which the pass does not touch.
//
// **The pass alone**, against the faces' own cost, in the page over the same
// sequence of views: the faces derived (`visibleFaces`, which the depth layer
// does each frame) and drawn by a depth layer of the app canvas's size (the
// main thread's part of it: the draw calls), against what the pass adds —
// the same faces derived again, projected (`occlusion`) and every edge cut
// into runs (`inkRuns`), as main.ts's entity pass asks for them. With the
// samples it took, and how many (sample, face) pairs got past the screen-box
// test to the even-odd one.

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

interface PassCost {
  /** Milliseconds a frame: deriving the visible faces. */
  derive: number;
  /** Milliseconds a frame: a depth layer drawing them (the main thread's part). */
  draw: number;
  /** Milliseconds a frame: the occlusion pass, deriving the faces again included. */
  pass: number;
  faces: number;
  edges: number;
  samples: number;
  /** (sample, face) pairs whose screen box held the sample: what the box test let through. */
  boxed: number;
}

const results: Record<string, { runs: Frames[]; frame: number; submit: number; pass?: PassCost }> = {};

after(() => {
  if (!OUT) return;
  mkdirSync(OUT, { recursive: true });
  writeFileSync(join(OUT, "hidden-results.json"), JSON.stringify(results, null, 2));
});

const median = (xs: number[]) => xs.slice().sort((a, b) => a - b)[Math.floor(xs.length / 2)];

/** The pass, and the faces' own work, timed in the page over `appFrames`' sequence of views. */
function passCost(args: { frames: number }) {
  return (async () => {
    const [viewPath, facesPath, occPath, layerPath, arcPath, curvePath, refsPath, markerPath] = [
      "/src/view.ts", "/src/faces.ts", "/src/occlusion.ts", "/src/facelayer.ts", "/src/arcgeom.ts",
      "/src/curveplane.ts", "/src/relations/refs.ts", "/src/framemarker.ts"];
    const { orbitBy, worldToScreen } = await import(viewPath);
    const { visibleFaces } = await import(facesPath);
    const { occlusion, inkRuns, SAMPLE_PX } = await import(occPath);
    const { createFaceLayer } = await import(layerPath);
    const { arcSamples, arcSegments } = await import(arcPath);
    const { curveFrame } = await import(curvePath);
    const { frameBasis } = await import(refsPath);
    const { FRAME_ARM_PX } = await import(markerPath);
    type V = { ox: number; oy: number; scale: number };
    type E = { kind: string; name: string; refs: [string, string] };
    const { model } = (window as never as { __neocad: {
      model: { entities: Map<string, E>; coords(n: string): number[] };
    } }).__neocad;
    const cv = document.getElementById("cv") as HTMLCanvasElement;
    const W = cv.getBoundingClientRect().width, H = cv.getBoundingClientRect().height;
    const layerCanvas = document.createElement("canvas");
    [layerCanvas.width, layerCanvas.height] = [cv.width, cv.height];
    const layer = createFaceLayer(layerCanvas)!;
    const pts = [...model.entities.values()].filter((e) => e.kind === "point").map((e) => model.coords(e.name));
    const c = [0, 1, 2].map((i) => (Math.min(...pts.map((p) => p[i])) + Math.max(...pts.map((p) => p[i]))) / 2);
    const r = Math.max(...pts.map((p) => Math.hypot(p[0] - c[0], p[1] - c[1], p[2] - c[2])));
    const scale = (0.32 * Math.min(W, H)) / r;
    let view: V = orbitBy({ ox: W / 2 - c[0] * scale, oy: H / 2 + c[1] * scale, scale, target: c }, 0.6, 0.5);
    for (let i = 0; i < 10; i++) view = orbitBy(view, 0.02, 0.005);

    // Every edge main.ts strokes, as the polyline it hands `inkRuns`.
    const edges = (v: V): [number[][], boolean][] => {
      const out: [number[][], boolean][] = [];
      for (const e of model.entities.values()) {
        if (e.kind === "line") out.push([[model.coords(e.refs[0]), model.coords(e.refs[1])], false]);
        else if (e.kind === "circle" || e.kind === "arc") {
          const f = curveFrame(model, e);
          if (f) out.push([arcSamples(f, arcSegments(f.sweep, f.r * v.scale)), e.kind === "circle"]);
        } else if (e.kind === "frame") {
          const b = frameBasis(model, e.name)();
          for (const u of [b.ux, b.uy, b.uz]) if (u) out.push([[b.origin, b.origin.map((x: number, i: number) => x + u[i] * FRAME_ARM_PX / v.scale)], false]);
        }
      }
      return out;
    };

    let derive = 0, draw = 0, pass = 0, faces = 0, samples = 0, boxed = 0, edgeCount = 0;
    for (let i = 0; i < args.frames; i++) {
      view = orbitBy(view, 0.02, 0.005);
      const t0 = performance.now();
      const fs = visibleFaces(model, view);
      const t1 = performance.now();
      layer.draw(model, view, W, H);
      const t2 = performance.now();
      const occ = occlusion(visibleFaces(model, view), view);
      const es = edges(view);
      for (const [world, closed] of es) inkRuns(occ, world, closed);
      const t3 = performance.now();
      derive += t1 - t0; draw += t2 - t1; pass += t3 - t2;
      faces += fs.length; edgeCount += es.length;
      // Counted outside the timing: the samples inkRuns takes, and how many
      // faces' boxes each falls in.
      for (const [world] of es) {
        const s = world.map((w) => worldToScreen(view, w));
        for (let k = 0; k < s.length; k++) {
          const n = k === 0 ? 1 : Math.max(1, Math.ceil(Math.hypot(s[k][0] - s[k - 1][0], s[k][1] - s[k - 1][1]) / SAMPLE_PX));
          for (let j = 0; j < n; j++) {
            const t = k === 0 ? 0 : (j + 1) / n;
            const [x, y] = k === 0 ? s[0] : [s[k - 1][0] + t * (s[k][0] - s[k - 1][0]), s[k - 1][1] + t * (s[k][1] - s[k - 1][1])];
            samples++;
            for (const f of occ.faces as { box: number[] }[]) if (x >= f.box[0] && x <= f.box[2] && y >= f.box[1] && y <= f.box[3]) boxed++;
          }
        }
      }
    }
    const n = args.frames;
    return { derive: derive / n, draw: draw / n, pass: pass / n, faces: faces / n, edges: edgeCount / n, samples: samples / n, boxed: boxed / n };
  })();
}

for (const name of TIMED) {
  test(`${name}: ${scene(name).what}`, async () => {
    const runs: Frames[] = [];
    let pass: PassCost | undefined;
    for (let i = 0; i < RUNS; i++) {
      const app = await openApp();
      try {
        await build(app, scene(name).source);
        runs.push(await app.page.evaluate(appFrames, { frames: TIMED_FRAMES }));
        if (i === 0) pass = await app.page.evaluate(passCost, { frames: TIMED_FRAMES });
        assert.deepEqual(app.pageErrors, []);
      } finally {
        await app.close();
      }
    }
    const frame = median(runs.map((r) => r.frame)), submit = median(runs.map((r) => r.submit));
    results[name] = { runs, frame, submit, pass };
    console.log(`${name}, ${runs[0].faces} faces: ${frame.toFixed(1)} ms a frame, render() ${submit.toFixed(2)} ms of it ` +
      `(median of ${RUNS} × ${TIMED_FRAMES} frames; frames ${runs.map((r) => r.frame.toFixed(1)).join(", ")})`);
    if (pass) {
      console.log(`${name}, alone: faces derived ${pass.derive.toFixed(2)} ms + drawn ${pass.draw.toFixed(2)} ms; ` +
        `the pass ${pass.pass.toFixed(2)} ms — ${pass.edges.toFixed(0)} edges, ${pass.samples.toFixed(0)} samples × ` +
        `${pass.faces.toFixed(0)} faces, ${pass.boxed.toFixed(0)} pairs past the box test`);
    }
  });
}
