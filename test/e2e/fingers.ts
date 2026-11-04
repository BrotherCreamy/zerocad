// Fingers on the glass, for the touch tests: real touch events, dispatched by
// Chromium's own input pipeline through CDP's `Input.dispatchTouchEvent` — so
// the page receives what a touchscreen gives it (touch pointers with their
// ids, pointer capture, the compatibility mouse events after a tap), several
// fingers at once, which Playwright's `touchscreen.tap` cannot do.
//
// Coordinates are canvas pixels, like `AppContext.at`'s; `hold` and the gaps
// between moves are real time, because the long-press is a real timer.
//
// CDP's touch events are a running list of the fingers on the glass: a start
// or a move names every finger down (one new or moved per event), and an end
// names the fingers lifting.

import type { CDPSession } from "playwright";
import type { AppContext } from "./harness.ts";

type At = [number, number];

export interface Fingers {
  /** Puts a finger down at each point, one after another, keeping any already down. */
  down(...at: At[]): Promise<void>;
  /** Moves the fingers down, in the order they went down, to these points. */
  move(...at: At[]): Promise<void>;
  /** Moves every finger down from where it is to `to` (in order) over `steps` events. */
  glide(steps: number, ...to: At[]): Promise<void>;
  /** Lifts the fingers at these indices (in down order), or every finger. */
  up(...which: number[]): Promise<void>;
  /** One finger down and up, inside a tap's time. */
  tap(x: number, y: number): Promise<void>;
  /** One finger down, held still for `ms`, then (unless `keep`) lifted. */
  hold(x: number, y: number, ms: number, keep?: boolean): Promise<void>;
  /** One finger from `from` to `to` in `steps` moves, then lifted. */
  drag(from: At, to: At, steps?: number): Promise<void>;
}

export async function fingers(app: AppContext): Promise<Fingers> {
  const cdp: CDPSession = await app.page.context().newCDPSession(app.page);
  const box = await app.page.$eval("#cv", (el) => {
    const r = el.getBoundingClientRect();
    return { x: r.x, y: r.y };
  });
  /** Fingers down, in the order they went down: CDP id and canvas position. */
  let down: { id: number; at: At }[] = [];
  let next = 0;
  const points = (fs: { id: number; at: At }[]) =>
    fs.map((f) => ({ x: box.x + f.at[0], y: box.y + f.at[1], id: f.id, radiusX: 8, radiusY: 8, force: 1 }));
  const send = (type: "touchStart" | "touchMove" | "touchEnd", fs: { id: number; at: At }[]) =>
    cdp.send("Input.dispatchTouchEvent", { type, touchPoints: points(fs) });
  const settle = () => app.page.waitForTimeout(16);

  const self: Fingers = {
    async down(...at) {
      for (const p of at) {
        down = [...down, { id: next++, at: p }];
        await send("touchStart", down);
        await settle();
      }
    },
    async move(...at) {
      // One finger moved per event, as a hand's events arrive.
      for (let i = 0; i < at.length && i < down.length; i++) {
        down = down.map((f, k) => (k === i ? { ...f, at: at[i] } : f));
        await send("touchMove", down);
      }
      await settle();
    },
    async glide(steps, ...to) {
      const from = down.map((f) => f.at);
      for (let s = 1; s <= steps; s++) {
        const t = s / steps;
        await self.move(...to.map((p, i): At => [from[i][0] + (p[0] - from[i][0]) * t, from[i][1] + (p[1] - from[i][1]) * t]));
      }
    },
    async up(...which) {
      const lifting = which.length ? down.filter((_, k) => which.includes(k)) : down;
      down = down.filter((f) => !lifting.includes(f));
      await send("touchEnd", lifting);
      await app.page.waitForTimeout(60);
    },
    async tap(x, y) {
      await self.down([x, y]);
      await app.page.waitForTimeout(40);
      await self.up();
      await app.page.waitForTimeout(120);
    },
    async hold(x, y, ms, keep = false) {
      await self.down([x, y]);
      await app.page.waitForTimeout(ms);
      if (!keep) await self.up();
    },
    async drag(from, to, steps = 10) {
      await self.down(from);
      await self.glide(steps, to);
      await self.up();
      await app.page.waitForTimeout(80);
    },
  };
  return self;
}
