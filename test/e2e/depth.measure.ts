// The measurement behind drawing faces by depth (docs/plans/display-depth.md):
// how wrong the painter's is, and what the depth buffer costs, in the browser
// the e2e suite runs.
//
// Not part of `npm run test:e2e` — it renders a few hundred frames and takes
// most of a minute. Run it with `npm run measure:depth`; set NEOCAD_MEASURE_DIR
// to a directory to keep the numbers (results.json) and the pictures: each
// scene's worst view as both renderers drew its faces, and as the app shows it.
//
// **What is measured.** Both renderers live in src/facelayer.ts and draw the
// same faces from faces.ts, so the comparison is direct: for each scene, 40
// orbits from a seeded random sequence, each drawn faces-only by the painter's
// onto a 2D canvas and by the depth layer onto a WebGL one, the same size as
// the app's own. A pixel is **different** where any channel differs by more
// than a few levels; it is **wrong** where it is different and further than a
// pixel and a half from every visible face's outline. The depth buffer is
// exact by construction, so a wrong pixel is the painter's error. The band
// exists because the two anti-alias edges differently (multisampling against a
// hair-wide stroke) — and so the lone convex solids, which the painter's
// cannot sort wrong, are the proof the band is only that: they must have no
// wrong pixels at all, and this asserts it.
//
// **Time per frame** is the app's own: the scene built in a fresh app, the view
// turned a little each animation frame and redrawn, once as the app runs and
// once with the browser's WebGL taken away, so the app falls back to the
// painter's by the one door it has (see `appFrames` for why not offscreen).
//
// **What it refuses.** No WebGL in the e2e browser, or frames slower than the
// painter's by more than `SLOWER` on the stepped block: either means the
// plan's choice does not hold here, and the run fails saying so.

import { test, after } from "node:test";
import assert from "node:assert/strict";
import { mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { openApp, type AppContext } from "./harness.ts";
import { SCENES, appFrames, build, type Frames } from "./scenes.ts";

const OUT = process.env.NEOCAD_MEASURE_DIR;
const VIEWS = 40;
const TIMED_FRAMES = 90;
/** Channel levels two renderers may differ by and still be drawing the same face. */
const TOLERANCE = 6;
/** How much slower than the painter's the app's frames may be before the choice is wrong. */
const SLOWER = 3;

interface ViewStats { view: number; different: number; wrong: number; faces: number }
interface SceneResult {
  name: string; what: string; faces: number; views: ViewStats[];
  timing?: { usual: Frames; withoutWebGL: Frames };
  worst: number;
}

const results: SceneResult[] = [];

after(() => {
  if (!OUT) return;
  mkdirSync(OUT, { recursive: true });
  writeFileSync(join(OUT, "results.json"), JSON.stringify(results, null, 2));
});

/**
 * The comparison, all in the page: the views (seeded, so a re-run draws the
 * same ones), both renderers onto canvases of the app canvas's size, and the
 * counts. Returns numbers only — the pictures are fetched separately.
 */
function measureInPage(args: { seed: number; views: number; tolerance: number }) {
  return (async () => {
    const [layerPath, viewPath, facesPath] = ["/src/facelayer.ts", "/src/view.ts", "/src/faces.ts"];
    const { paintFaces, createFaceLayer } = await import(layerPath);
    const { orbitBy, worldToScreen } = await import(viewPath);
    const { visibleFaces } = await import(facesPath);
    const { model } = (window as never as { __neocad: { model: { entities: Map<string, { kind: string; name: string }>; coords(n: string): number[] } } }).__neocad;
    const cv = document.getElementById("cv") as HTMLCanvasElement;
    const W = Math.round(cv.getBoundingClientRect().width), H = Math.round(cv.getBoundingClientRect().height);

    const make = () => { const c = document.createElement("canvas"); c.width = W; c.height = H; return c; };
    const paintCanvas = make(), glCanvas = make(), readCanvas = make(), maskCanvas = make();
    const g2 = paintCanvas.getContext("2d", { willReadFrequently: true })!;
    const rd = readCanvas.getContext("2d", { willReadFrequently: true })!;
    const mk = maskCanvas.getContext("2d", { willReadFrequently: true })!;
    const layer = createFaceLayer(glCanvas);
    if (!layer) return { webgl: false } as const;

    // The scene's points, for a view that fits it: centred on their middle,
    // the farthest of them a third of the short side out.
    const pts = [...model.entities.values()].filter((e) => e.kind === "point").map((e) => model.coords(e.name));
    const lo = [0, 1, 2].map((i) => Math.min(...pts.map((p) => p[i])));
    const hi = [0, 1, 2].map((i) => Math.max(...pts.map((p) => p[i])));
    const c = lo.map((x, i) => (x + hi[i]) / 2);
    const r = Math.max(...pts.map((p) => Math.hypot(p[0] - c[0], p[1] - c[1], p[2] - c[2])));
    const scale = (0.32 * Math.min(W, H)) / r;
    const base = { ox: W / 2 - c[0] * scale, oy: H / 2 + c[1] * scale, scale, target: c };

    // mulberry32: a few lines of seeded randomness, so the 40 views are the
    // same 40 on every run and in every commit.
    let s = args.seed >>> 0;
    const rand = () => {
      s = (s + 0x6d2b79f5) >>> 0;
      let t = s;
      t = Math.imul(t ^ (t >>> 15), t | 1);
      t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
      return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    };
    const views = Array.from({ length: args.views }, () => orbitBy(base, (rand() * 2 - 1) * Math.PI, (rand() * 2 - 1) * (Math.PI / 2)));

    const painted = (view: unknown) => {
      g2.setTransform(1, 0, 0, 1, 0, 0);
      g2.clearRect(0, 0, W, H);
      paintFaces(g2, model, view);
      return g2.getImageData(0, 0, W, H).data;
    };
    const depthDrawn = (view: unknown) => {
      layer.draw(model, view, W, H);
      rd.clearRect(0, 0, W, H);
      rd.drawImage(glCanvas, 0, 0);
      return rd.getImageData(0, 0, W, H).data;
    };
    // The band either renderer may anti-alias differently: every visible
    // face's outline, a pixel and a half either side.
    const band = (view: unknown) => {
      mk.clearRect(0, 0, W, H);
      mk.lineWidth = 3;
      mk.strokeStyle = "#fff";
      for (const f of visibleFaces(model, view) as { outlines: number[][][] }[]) {
        mk.beginPath();
        for (const o of f.outlines) {
          const sp = o.map((w) => worldToScreen(view, w));
          mk.moveTo(sp[0][0], sp[0][1]);
          for (const q of sp.slice(1)) mk.lineTo(q[0], q[1]);
          mk.closePath();
        }
        mk.stroke();
      }
      return mk.getImageData(0, 0, W, H).data;
    };

    // The comparison as a picture too, for the views worth looking at: red
    // where the two differ off the band (the painter's error), grey where
    // they differ inside it.
    const diffs: string[] = [];
    const stats = views.map((view, i) => {
      const a = painted(view), b = depthDrawn(view), e = band(view);
      const pic = new ImageData(W, H);
      let different = 0, wrong = 0;
      for (let k = 0; k < a.length; k += 4) {
        const d = Math.max(Math.abs(a[k] - b[k]), Math.abs(a[k + 1] - b[k + 1]), Math.abs(a[k + 2] - b[k + 2]), Math.abs(a[k + 3] - b[k + 3]));
        pic.data[k + 3] = 255;
        if (d <= args.tolerance) continue;
        different++;
        if (e[k + 3] === 0) { wrong++; pic.data[k] = 255; } else pic.data.fill(110, k, k + 3);
      }
      mk.putImageData(pic, 0, 0);
      diffs.push(maskCanvas.toDataURL("image/png"));
      return { view: i, different, wrong, faces: (visibleFaces(model, view) as unknown[]).length };
    });

    (window as never as { __measured: unknown }).__measured = { views, W, H, diffs };
    return { webgl: true as const, W, H, stats };
  })();
}

/** The two renderers' pictures of one view, as PNG data, and the app's own screenshot of it. */
async function pictures(app: AppContext, scene: string, view: number): Promise<void> {
  if (!OUT) return;
  mkdirSync(OUT, { recursive: true });
  const urls = await app.page.evaluate(async (i) => {
    const [layerPath, viewPath] = ["/src/facelayer.ts", "/src/view.ts"];
    const { paintFaces, createFaceLayer } = await import(layerPath);
    const { assignView } = await import(viewPath);
    const { views, W, H, diffs } = (window as never as { __measured: { views: unknown[]; W: number; H: number; diffs: string[] } }).__measured;
    const { model, engine } = (window as never as { __neocad: { model: unknown; engine: { view: unknown } } }).__neocad;
    const opaque = (draw: (c: HTMLCanvasElement) => void) => {
      const c = document.createElement("canvas");
      c.width = W; c.height = H;
      draw(c);
      const out = document.createElement("canvas");
      out.width = W; out.height = H;
      const g = out.getContext("2d")!;
      g.fillStyle = "#0a0e13"; // the page's ground, so the picture reads as the app does
      g.fillRect(0, 0, W, H);
      g.drawImage(c, 0, 0);
      return out.toDataURL("image/png");
    };
    const painter = opaque((c) => paintFaces(c.getContext("2d")!, model, views[i]));
    const depth = opaque((c) => createFaceLayer(c)!.draw(model, views[i], W, H));
    assignView(engine.view, views[i]);
    return { painter, depth, diff: diffs[i] };
  }, view);
  for (const [which, url] of Object.entries(urls)) {
    writeFileSync(join(OUT, `${scene}-view${view}-${which}.png`), Buffer.from(url.split(",")[1], "base64"));
  }
  await app.repl("refresh()");
  await app.page.mouse.move(2, 2);
  await app.page.waitForTimeout(150);
  await app.page.screenshot({ path: join(OUT, `${scene}-view${view}-app.png`) });
}

/** A scene built on a fresh app — with WebGL, or with the browser's WebGL taken away — and its frames timed. */
async function timedFrames(source: string, webgl: boolean): Promise<Frames> {
  const app = await openApp({ webgl });
  try {
    await build(app, source);
    return await app.page.evaluate(appFrames, { frames: TIMED_FRAMES });
  } finally {
    await app.close();
  }
}

for (const [k, scene] of SCENES.entries()) {
  test(`${scene.name}: ${scene.what}`, async () => {
    const app = await openApp();
    try {
      await build(app, scene.source);
      const m = await app.page.evaluate(measureInPage, { seed: 1000 + k, views: VIEWS, tolerance: TOLERANCE });
      assert.ok(m.webgl, "STOP: no WebGL in the e2e browser — the depth layer cannot be the renderer here");
      const views = m.stats;
      const worst = views.reduce((w, v) => (v.wrong > w.wrong ? v : w), views[0]);
      const mean = (xs: number[]) => xs.reduce((s, x) => s + x, 0) / xs.length;
      const result: SceneResult = { name: scene.name, what: scene.what, faces: Math.max(...views.map((v) => v.faces)), views, worst: worst.view };
      results.push(result);
      console.log(`${scene.name} (${m.W}×${m.H}, ${views.length} views): wrong mean ${mean(views.map((v) => v.wrong)).toFixed(0)}, ` +
        `worst ${worst.wrong} (view ${worst.view}); different mean ${mean(views.map((v) => v.different)).toFixed(0)}, ` +
        `worst ${Math.max(...views.map((v) => v.different))}; views with any wrong pixel ${views.filter((v) => v.wrong > 0).length}`);
      await pictures(app, scene.name, worst.view);
      if (scene.convex) {
        assert.deepEqual(views.filter((v) => v.wrong > 0), [], "a convex solid differs between the two only along its edges");
      }
      assert.deepEqual(app.pageErrors, []);
    } finally {
      await app.close();
    }
    if (!scene.timed) return;
    const usual = await timedFrames(scene.source, true);
    const withoutWebGL = await timedFrames(scene.source, false);
    results.at(-1)!.timing = { usual, withoutWebGL };
    for (const t of [usual, withoutWebGL]) {
      console.log(`${scene.name}, ${t === usual ? "as the app runs" : "WebGL taken away"} — ${t.renderer}, ${t.faces} faces: ` +
        `${t.frame.toFixed(1)} ms a frame, render() ${t.submit.toFixed(2)} ms of it (${t.frames} frames)`);
    }
    if (scene.name === "stepped-boss") {
      assert.ok(usual.frame <= SLOWER * withoutWebGL.frame,
        `STOP: frames take ${usual.frame.toFixed(1)} ms as the app runs, ${withoutWebGL.frame.toFixed(1)} ms by the painter's`);
    }
  });
}
