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
  /**
   * **A tap is timed by the hand, not by the machine.** CDP waits for a touch
   * to be handled before it returns, so on a loaded machine a landing handled
   * 600 ms late made the lift go 600 ms late too, and the page — which times a
   * tap by the events' own timestamps, as a phone's OS stamps them
   * (gestures.ts, `LATE_MS`) — read a 40 ms tap as a 640 ms press and never
   * tapped (measured: landed at 2358, handled at 2963). So a gesture's first
   * landing is stamped when it is sent, and **a lift with no movement before
   * it** is stamped that plus the pauses this helper meant (`pause`) — a tap
   * or a hold lasts what the test says. Moves, and a lift after moves, keep
   * the browser's own stamps: stamping a drag's moves 16 ms apart would make
   * every drag a fast flick, and Chromium suppresses the next tap after a
   * fling (measured: the Hand's tap after a slide was lost). The stamps are
   * never ahead of the wall clock — the pauses are really waited.
   */
  let startedAt = 0;
  let meant = 0;
  let moved = false;
  const send = (type: "touchStart" | "touchMove" | "touchEnd", fs: { id: number; at: At }[]) => {
    let timestamp: number | undefined;
    if (type === "touchStart" && down.length === 1 && fs.length === 1) {
      startedAt = Date.now();
      meant = 0;
      moved = false;
      timestamp = startedAt / 1000;
    } else if (type === "touchMove") moved = true;
    else if (type === "touchEnd" && !moved && down.length === 0) timestamp = (startedAt + meant) / 1000;
    return cdp.send("Input.dispatchTouchEvent", { type, touchPoints: points(fs), ...(timestamp === undefined ? {} : { timestamp }) });
  };
  /** Waits `ms`, and counts it as part of the gesture under way. */
  const pause = (ms: number) => { meant += ms; return app.page.waitForTimeout(ms); };
  const settle = () => pause(16);

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
      await pause(60);
    },
    async tap(x, y) {
      await self.down([x, y]);
      await pause(40);
      await self.up();
      await pause(120);
    },
    async hold(x, y, ms, keep = false) {
      await self.down([x, y]);
      await pause(ms);
      if (!keep) await self.up();
    },
    async drag(from, to, steps = 10) {
      await self.down(from);
      await self.glide(steps, to);
      await self.up();
      await pause(80);
    },
  };
  return self;
}
