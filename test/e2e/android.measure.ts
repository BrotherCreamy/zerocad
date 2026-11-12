// Two costs earlier reviews flagged as unmeasured, measured on the Android
// emulation (docs/plans/android.md): Playwright's Pixel 7 descriptor, once as
// this machine runs it and once under CDP's 4× CPU throttle — Lighthouse's
// stand-in for a mid-range phone; neither is a phone.
//
// 1. **The mode chip's `activePlane`, per frame, with a work plane set** — on
//    a face of the largest fixtures (pre-explicit-regions: three features;
//    shapes-v15: the most steps), and on the stepped-boss scene, whose plane
//    is matched against every feature's faces. Timed alone (the call the
//    drawing pass makes, `activePlane(model, scale, model.workPlane)`) and as
//    the whole frame (`render()`) with the plane set and cleared.
// 2. **`Bodies.everything` starting the Worker when round is armed**: a plain
//    extruded box (one sweep — faces.ts's, no Worker), then `arm("round")`:
//    the frame that arms it, how long until the kernel's bodies are in
//    (the Worker started, its 4 MB of wasm compiled, the box built), and the
//    longest frame the page drew meanwhile.
//
// Not part of `npm run test:e2e`. Run with `npm run measure:android`; the
// numbers are printed and, with NEOCAD_MEASURE_DIR, written to android.json.

import { test, after } from "node:test";
import assert from "node:assert/strict";
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { axisFrame, openApp, type AppContext } from "./harness.ts";
import { build, scene } from "./scenes.ts";

const OUT = process.env.NEOCAD_MEASURE_DIR;
const results: Record<string, unknown> = {};
after(() => {
  console.log(JSON.stringify(results, null, 2));
  if (OUT) { mkdirSync(OUT, { recursive: true }); writeFileSync(join(OUT, "android.json"), JSON.stringify(results, null, 2)); }
});

const fixture = (name: string) => readFileSync(new URL(`../fixtures/${name}`, import.meta.url), "utf8");

/** Sets the work plane to a face of a feature — the plane sketch on face sets — the last feature's that has one. */
async function planeOnAFace(app: AppContext): Promise<string> {
  return app.page.evaluate(async () => {
    const [{ findLoops }, { drawOnFaceCommand }, { activePlane }] = await Promise.all(
      ["/src/loops.ts", "/src/faceplane.ts", "/src/activeplane.ts"].map((p) => import(p)));
    const n = (window as unknown as { __neocad: { model: { workPlane: string | null; features: Map<string, unknown> }; engine: { view: { scale: number } }; repl: { eval(s: string): Promise<{ ok: boolean; error?: Error }> } } }).__neocad;
    let found = "";
    for (const loop of findLoops(n.model).reverse()) {
      let cmd: string;
      try { cmd = drawOnFaceCommand(n.model, loop, [0, 0, 1]); } catch { continue; }
      const r = await n.repl.eval(cmd);
      if (!r.ok) continue;
      const p = activePlane(n.model, n.engine.view.scale, n.model.workPlane);
      if (p?.kind === "face") { found = `${cmd} → ${p.label}`; break; }
    }
    return found;
  });
}

/** `activePlane` alone and the whole frame, with the plane set and cleared: mean ms of `reps`. */
async function timePlane(app: AppContext, reps: number) {
  return app.page.evaluate(async (reps) => {
    const { activePlane, focusOf } = await import("/src/activeplane.ts" as string);
    const n = (window as unknown as { __neocad: { model: { workPlane: string | null; setWorkPlane(p: string | null): void }; engine: { view: { scale: number } }; render(): void } }).__neocad;
    const mean = (f: () => void) => { f(); const t = performance.now(); for (let i = 0; i < reps; i++) f(); return (performance.now() - t) / reps; };
    const plane = n.model.workPlane;
    const call = mean(() => activePlane(n.model, n.engine.view.scale, n.model.workPlane));
    const found = activePlane(n.model, n.engine.view.scale, n.model.workPlane);
    const focus = mean(() => focusOf(n.model, found));
    const frameWith = mean(() => n.render());
    n.model.setWorkPlane(null);
    const frameWithout = mean(() => n.render());
    n.model.setWorkPlane(plane);
    return { activePlaneMs: +call.toFixed(3), focusOfMs: +focus.toFixed(3), frameWithPlaneMs: +frameWith.toFixed(2), frameWithoutPlaneMs: +frameWithout.toFixed(2) };
  }, reps);
}

for (const rate of [1, 4]) {
  test(`activePlane per frame with a work plane on a face, Pixel 7, CPU ×${rate}`, async () => {
    const out: Record<string, unknown> = {};
    for (const source of ["pre-explicit-regions.neocad.json", "shapes-v15.neocad.json", "stepped-boss"]) {
      const app = await openApp({ device: "Pixel 7" });
      try {
        const cdp = await app.page.context().newCDPSession(app.page);
        if (source === "stepped-boss") await build(app, scene("stepped-boss").source);
        else {
          const r = await app.repl(`open(${JSON.stringify(fixture(source))})`);
          assert.ok(r.ok, r.error ?? "opened");
        }
        const size = (await app.model()).size;
        const plane = await planeOnAFace(app);
        await cdp.send("Emulation.setCPUThrottlingRate", { rate });
        const t = await timePlane(app, 60);
        await cdp.send("Emulation.setCPUThrottlingRate", { rate: 1 });
        out[source] = { entities: size, plane: plane || "no face plane found — a frame or loop instead", ...t };
      } finally {
        await app.close();
      }
    }
    results[`activePlane, CPU ×${rate}`] = out;
  });

  test(`round armed on a one-sweep box: the Worker started, Pixel 7, CPU ×${rate}`, async () => {
    const app = await openApp({ device: "Pixel 7" });
    try {
      const cdp = await app.page.context().newCDPSession(app.page);
      await axisFrame(app);
      await app.repl(`P = (c) => model.addPoint(c).name; ps = [[0,0,0],[40,0,0],[40,30,0],[0,30,0]].map(P);
        ls = ps.map((p, i) => model.addLine(p, ps[(i + 1) % 4]).name); for (const p of ps) onplane(p, "f"); extrude(ls[0], 20); refresh(); "ok"`);
      const before = await app.page.evaluate(() => (window as unknown as { __neocad: { bodies: { answers: number } } }).__neocad.bodies.answers);
      assert.equal(before, 0, "no Worker answer before round is armed: a one-sweep box is faces.ts's");
      await cdp.send("Emulation.setCPUThrottlingRate", { rate });
      const r = await app.page.evaluate(async () => {
        const n = (window as unknown as { __neocad: { repl: { eval(s: string): Promise<unknown> }; render(): void; bodies: { settled: boolean; answers: number; kernelFeatures(): Set<string> } } }).__neocad;
        // Every frame the page draws meanwhile, by requestAnimationFrame's own clock.
        const frames: number[] = [];
        let last = performance.now();
        let on = true;
        const tick = (t: number) => { frames.push(t - last); last = t; if (on) requestAnimationFrame(tick); };
        requestAnimationFrame(tick);
        // The page's own long tasks (over 50 ms), each with when it started after the arm.
        const long: { at: number; ms: number }[] = [];
        const watch = new PerformanceObserver((list) => {
          for (const e of list.getEntries()) long.push({ at: Math.round(e.startTime - t0), ms: Math.round(e.duration) });
        });
        watch.observe({ type: "longtask", buffered: false });
        const t0 = performance.now();
        await n.repl.eval('arm("round")');
        const t1 = performance.now();
        n.render();
        const armFrame = performance.now() - t1;
        while (!(n.bodies.answers > 0 && n.bodies.settled)) {
          await new Promise((res) => setTimeout(res, 10));
          if (performance.now() - t0 > 60_000) break;
        }
        const ready = performance.now() - t0;
        on = false;
        return {
          armTypedMs: +(t1 - t0).toFixed(1), armFrameMs: +armFrame.toFixed(1), kernelBodiesInMs: Math.round(ready),
          kernelFeatures: [...n.bodies.kernelFeatures()], framesDrawn: frames.length, longestFrameMs: Math.round(Math.max(...frames)),
          longTasks: (watch.disconnect(), long),
        };
      });
      await cdp.send("Emulation.setCPUThrottlingRate", { rate: 1 });
      results[`round armed, CPU ×${rate}`] = r;
    } finally {
      await app.close();
    }
  });
}
