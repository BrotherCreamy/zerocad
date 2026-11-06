// The measurement behind the drag preview (docs/plans/panels-preview.md): what
// the resolver costs per move on a phone, and whether turning every panel but
// the held one translucent costs a frame.
//
// Not part of `npm run test:e2e` — it drags for a few seconds per case. Run it
// with `npm run measure:panels`; set NEOCAD_MEASURE_DIR to a directory to keep
// the numbers (panels-results.json).
//
// **The phone is an emulation**: Chromium as an iPhone 13 (its window, its 3×
// pixels, touch), with the CPU slowed by `Emulation.setCPUThrottlingRate` — 4×,
// the figure Chromium's own tools offer for a mid-range phone, and a crude
// one: an iPhone 13's A15 is faster than this box's cores divided by four on
// most work. So the numbers are a ceiling to compare against a frame, not the
// phone's own. Taken on a shared four-core machine with another worker on it.
//
// **Per move** is two numbers. *The handler*: from a window capture-phase
// listener to a window bubble-phase one around each pointermove of a finger
// drag, so everything the panel's own listener does — the resolver
// (`dragTo`), drawing the held panel and the ghosts, and the dev server's
// layout check — and nothing of the browser's style and paint. *The resolver
// alone*: the same moves replayed through `dragTo` in the page on the layout
// `layout()` printed, the module imported from the dev server.
//
// **The opacity change** is frame intervals (requestAnimationFrame to the
// next) of the same finger drag with the translucency on and with it taken
// away by a stylesheet, and of 60 frames each of which flips the class on its
// own, against 60 that flip nothing. A frame is 16.7 ms; the claim is that the
// class does not make one longer.

import { test, after } from "node:test";
import assert from "node:assert/strict";
import { mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { openApp, settled, type AppContext } from "./harness.ts";
import { fingers } from "./fingers.ts";

const OUT = process.env.NEOCAD_MEASURE_DIR;
const results: Record<string, unknown> = {};
const apps: AppContext[] = [];
after(async () => {
  for (const a of apps) await a.close();
  if (OUT) {
    mkdirSync(OUT, { recursive: true });
    writeFileSync(join(OUT, "panels-results.json"), JSON.stringify(results, null, 2));
  }
  console.log(JSON.stringify(results, null, 2));
});

/** Median, 95th percentile and largest of `xs`. */
function stats(xs: number[]): { n: number; median: number; p95: number; max: number } {
  const s = [...xs].sort((a, b) => a - b);
  const at = (q: number) => s[Math.min(s.length - 1, Math.floor(q * s.length))];
  const r = (v: number) => Math.round(v * 1000) / 1000;
  return { n: s.length, median: r(at(0.5)), p95: r(at(0.95)), max: r(s[s.length - 1]) };
}

/** Starts timing every pointermove's handler, and every frame, in the page. */
const instrument = (app: AppContext) => app.page.evaluate(() => {
  const w = window as unknown as { __m: { moves: number[]; frames: number[]; on: boolean } };
  w.__m = { moves: [], frames: [], on: false };
  let t0 = 0;
  window.addEventListener("pointermove", () => { t0 = performance.now(); }, true);
  window.addEventListener("pointermove", () => {
    if (document.getElementById("viewwrap")!.classList.contains("dragging")) w.__m.moves.push(performance.now() - t0);
  });
  let last = 0;
  const tick = (t: number) => {
    if (w.__m.on && last) w.__m.frames.push(t - last);
    last = t;
    requestAnimationFrame(tick);
  };
  requestAnimationFrame(tick);
});

const take = (app: AppContext) => app.page.evaluate(() => {
  const w = window as unknown as { __m: { moves: number[]; frames: number[]; on: boolean } };
  const out = { moves: w.__m.moves, frames: w.__m.frames };
  w.__m.moves = [];
  w.__m.frames = [];
  return out;
});
const frames = (app: AppContext, on: boolean) => app.page.evaluate((v) => { (window as unknown as { __m: { on: boolean } }).__m.on = v; }, on);

/** The middle of panel `id`'s strip. */
const stripAt = (app: AppContext, id: string) => app.page.$eval(`.panel[data-panel="${id}"] > .ptitle`, (el) => {
  const r = el.getBoundingClientRect();
  return [r.x + r.width / 2, r.y + r.height / 2] as [number, number];
});

/** The command line onto the log and on up (pushing), then the tray along the top (turning), `steps` moves each. */
async function drags(app: AppContext, steps: number): Promise<[number, number][][]> {
  const f = await fingers(app);
  const paths: [number, number][][] = [];
  for (const [id, dx, dy] of [["cmd", 0, -420], ["toolbar", 250, -60]] as const) {
    await app.type('layout("reset")');
    await settled(app.page);
    const [x, y] = await stripAt(app, id);
    const path: [number, number][] = [[x, y]];
    await f.down([x, y]);
    for (let i = 1; i <= steps; i++) {
      const p: [number, number] = [x + (dx * i) / steps, y + (dy * i) / steps];
      path.push(p);
      await f.move(p);
    }
    await f.up();
    await settled(app.page);
    paths.push(path);
  }
  return paths;
}

test("iPhone 13, the CPU slowed 4×: the resolver per move, and the opacity change against a frame", async () => {
  const app = await openApp({ device: "iPhone 13" });
  apps.push(app);
  const cdp = await app.page.context().newCDPSession(app.page);
  await instrument(app);

  for (const rate of [1, 4]) {
    await cdp.send("Emulation.setCPUThrottlingRate", { rate });
    await take(app);
    await frames(app, true);
    const paths = await drags(app, 60);
    await frames(app, false);
    const on = await take(app);

    // The same drags with the translucency taken away.
    const off = await app.page.addStyleTag({ content: "#viewwrap.dragging>.panel:not(.held){opacity:1!important}" });
    await frames(app, true);
    await drags(app, 60);
    await frames(app, false);
    const without = await take(app);
    await off.evaluate((el) => (el as Element).remove());

    // The class alone, flipped on a frame of its own, against frames that flip nothing.
    const flip = await app.page.evaluate(async () => {
      const v = document.getElementById("viewwrap")!;
      const raf = () => new Promise<number>((r) => requestAnimationFrame(r));
      const flips: number[] = [];
      const idle: number[] = [];
      for (let i = 0; i < 60; i++) {
        const a = await raf();
        v.classList.toggle("dragging");
        flips.push((await raf()) - a);
        const b = await raf();
        idle.push((await raf()) - b);
      }
      v.classList.remove("dragging");
      return { flips, idle };
    });

    // The resolver alone: the same moves through dragTo, on the layout as printed.
    const report = (await app.repl("layout()")).value as string;
    const resolver = await app.page.evaluate(async ({ report, paths }) => {
      // The dev server's own module; a variable, so nothing tries to resolve it here.
      const url = "/src/panels.ts";
      const P = await import(url) as typeof import("../../src/panels.ts");
      const layout: Record<string, { x: number; y: number; w: number; h: number; orient?: "row" | "column" }> = {};
      for (const line of report.split("\n")) {
        const m = /^(\w+)\s+(-?\d+),(-?\d+)\s+(\d+)x(\d+)(?:\s+(row|column))?/.exec(line);
        if (m) layout[m[1]] = { x: +m[2], y: +m[3], w: +m[4], h: +m[5], ...(m[6] ? { orient: m[6] as "row" | "column" } : {}) };
      }
      const area = { w: innerWidth, h: innerHeight };
      const m = P.touchMetrics(1.3, 1.3);
      const mins = (id: string, o: "row" | "column" | undefined) => (id === "toolbar" || id === "actions") ? P.traySize(1, o ?? "column", m) : { w: 60, h: 30 };
      const out: number[] = [];
      for (let round = 0; round < 5; round++) {
        for (const [k, path] of paths.entries()) {
          const id = k === 0 ? "cmd" : "toolbar";
          let drag = P.beginDrag(id, "move", { x: path[0][0], y: path[0][1] }, layout, "se", id === "toolbar" ? 13 : undefined);
          for (const [x, y] of path.slice(1)) {
            const t = performance.now();
            drag = P.dragTo(drag, { x, y }, area, mins, m);
            out.push(performance.now() - t);
          }
        }
      }
      return out;
    }, { report, paths });

    results[`cpu ${rate}x`] = {
      "handler per move, ms": stats(on.moves),
      "resolver alone per move, ms": stats(resolver),
      "frame interval while dragging, translucent, ms": stats(on.frames),
      "frame interval while dragging, opaque, ms": stats(without.frames),
      "frame that flips the class, ms": stats(flip.flips),
      "frame that flips nothing, ms": stats(flip.idle),
    };
    assert.ok(on.moves.length > 60, `moves were timed: ${on.moves.length}`);
  }
  await cdp.send("Emulation.setCPUThrottlingRate", { rate: 1 });
});
