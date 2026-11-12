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
//
// **A hand does not wait for the page, so neither does this.** A phone's OS
// streams a finger's events as they happen and the browser queues them,
// coalescing the moves, while the page is busy. CDP's `dispatchTouchEvent`
// instead returns only once the page has handled the event — and every touch
// is handled on the main thread here (pagelock.ts's non-passive `touchmove`
// listener on the document, the engine's `touchend` one on the canvas). This
// helper used to await each event before sending the next, so on a loaded
// machine a drag went one main-thread turn per move. Measured (2026-11-06,
// 20 busy loops on 4 cores, `solidsphone`'s circle drags): each move took
// 50–130 ms to acknowledge; the sixth or seventh of twelve, the one that
// leaves `TAP_SLOP`, was sent after the long-press timer had fired on time
// (500 ms), and the drag became a box. A hand's twelve moves take the same
// time whatever the page is doing. So:
//
// - **Within a call, events are sent without waiting for each other** —
//   `drag`, `tap` and every step of a `glide` go to the browser at the hand's
//   pace, and the browser queues them as it would a touchscreen's. Each call
//   waits for all of its events to be handled before it returns (`flush`), so
//   what a test reads after `await hand.down(…)` is the page with the finger
//   on it.
// - **`hold` waits for its landing before it starts holding.** The long-press
//   is the page's timer, started when the page handles the landing; a hold
//   that began counting before that could lift before the page's 500 ms were
//   up, and be no long-press at all.
// - **Every event carries the hand's own timestamp:** the wall clock less the
//   time this helper spent waiting for the browser (`waited`), from the
//   gesture's first landing. A tap lasts what the test says even when its
//   landing was handled 600 ms late — the page times a tap by the events'
//   stamps, as a phone's OS stamps them (gestures.ts, `LATE_MS`; measured
//   before: landed at 2358, handled at 2963, a 40 ms tap read as a 640 ms
//   press). A test's own waits between calls *are* the hand's time (a finger
//   resting before it lifts), so they count. Every event is stamped, not only
//   some: a move sent unawaited with the browser's stamp once came out
//   earlier than the landing stamped here, and broke every drag (2026-11-05).
//   Moves are stamped at the pace they are really sent, `FRAME_MS` apart, and
//   no faster: stamped as a fast flick, Chromium suppresses the tap after the
//   fling (measured: the Hand's tap after a slide was lost). The stamps are
//   never ahead of the wall clock.
//   The page reads them as it would a phone's: a tap's length, and whether a
//   press its timer called held had in fact moved first (gestures.ts, `move`).
// - **The gaps are real time, on this process's clock** (`sleep`), because
//   they are the hand's: the `FRAME_MS` between a hand's moves, the 40 ms of
//   a tap. They are not waits for the page; nothing here waits a fixed time
//   for the page to catch up.

import { setTimeout as sleep } from "node:timers/promises";
import type { CDPSession } from "playwright";
import { timedCdp, type AppContext } from "./harness.ts";

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
  /**
   * Two taps at a hand's pace — the second sent 120 ms after the first lifts,
   * not after the page has handled it — so a double-tap is one however busy
   * the page is (docs/plans/smart-dimension.md: two `tap`s on a loaded box
   * were a page-turn apart, and read as two taps).
   */
  doubleTap(x: number, y: number): Promise<void>;
  /** One finger down, held still for `ms` once the page has it, then (unless `keep`) lifted. */
  hold(x: number, y: number, ms: number, keep?: boolean): Promise<void>;
  /** One finger from `from` to `to` in `steps` moves, then lifted. */
  drag(from: At, to: At, steps?: number): Promise<void>;
}

/**
 * A hand's gap between two events of one gesture. **The pace the suite was
 * written against**, not a touchscreen's report rate: the helper that awaited
 * each event sent a move every 32–35 ms on an unloaded box (measured,
 * toolbargroups' slide: its 16 ms settle plus the acknowledgement and
 * Playwright's round trip). At 16 ms the same twelve steps were a flick twice
 * as fast, and Chromium dropped the tap 400 ms after its fling (toolbargroups,
 * 0/3 unloaded). The tests' steps and rests were tuned to this speed, so it is
 * the speed a gesture keeps at every load.
 */
const FRAME_MS = 33;

export async function fingers(app: AppContext): Promise<Fingers> {
  const cdp: CDPSession = timedCdp(await app.page.context().newCDPSession(app.page));
  const box = await app.page.$eval("#cv", (el) => {
    const r = el.getBoundingClientRect();
    return { x: r.x, y: r.y };
  });
  /** Fingers down, in the order they went down: CDP id and canvas position. */
  let down: { id: number; at: At }[] = [];
  let next = 0;
  const points = (fs: { id: number; at: At }[]) =>
    fs.map((f) => ({ x: box.x + f.at[0], y: box.y + f.at[1], id: f.id, radiusX: 8, radiusY: 8, force: 1 }));

  /** Milliseconds this gesture has spent waiting for the browser — the machine's time, not the hand's. */
  let waited = 0;
  /** The hand's clock, in epoch milliseconds: the wall clock, less the waiting. */
  const handNow = () => Date.now() - waited;
  /** Events sent and not yet handled, in the order sent. */
  let inflight: Promise<unknown>[] = [];

  /** Sends one event, stamped by the hand's clock, without waiting for the page. */
  const send = (type: "touchStart" | "touchMove" | "touchEnd", fs: { id: number; at: At }[]) => {
    // A first finger landing starts a gesture, and the hand's clock with it.
    if (type === "touchStart" && down.length === 1 && fs.length === 1) waited = 0;
    const sent = cdp.send("Input.dispatchTouchEvent", { type, touchPoints: points(fs), timestamp: handNow() / 1000 });
    // Awaited in `flush`; until then a failure must not count as unhandled.
    sent.catch(() => {});
    inflight.push(sent);
  };
  /** Waits until the page has handled everything sent, and keeps that out of the hand's time. */
  const flush = async () => {
    const from = Date.now();
    const pending = inflight;
    inflight = [];
    await Promise.all(pending);
    waited += Date.now() - from;
  };

  // The steps of a gesture, unflushed, for the calls below to compose.
  const putDown = async (at: At[]) => {
    for (const p of at) {
      down = [...down, { id: next++, at: p }];
      send("touchStart", down);
      await sleep(FRAME_MS);
    }
  };
  const moveTo = async (at: At[]) => {
    // One finger moved per event, as a hand's events arrive.
    for (let i = 0; i < at.length && i < down.length; i++) {
      down = down.map((f, k) => (k === i ? { ...f, at: at[i] } : f));
      send("touchMove", down);
    }
    await sleep(FRAME_MS);
  };
  const glideTo = async (steps: number, to: At[]) => {
    const from = down.map((f) => f.at);
    for (let s = 1; s <= steps; s++) {
      const t = s / steps;
      await moveTo(to.map((p, i): At => [from[i][0] + (p[0] - from[i][0]) * t, from[i][1] + (p[1] - from[i][1]) * t]));
    }
  };
  const lift = (which: number[]) => {
    const lifting = which.length ? down.filter((_, k) => which.includes(k)) : down;
    down = down.filter((f) => !lifting.includes(f));
    send("touchEnd", lifting);
  };

  const self: Fingers = {
    async down(...at) {
      await putDown(at);
      await flush();
    },
    async move(...at) {
      await moveTo(at);
      await flush();
    },
    async glide(steps, ...to) {
      await glideTo(steps, to);
      await flush();
    },
    async up(...which) {
      lift(which);
      await flush();
      await sleep(60);
    },
    async tap(x, y) {
      await putDown([[x, y]]);
      await sleep(40);
      lift([]);
      await flush();
      await sleep(180);
    },
    async doubleTap(x, y) {
      await putDown([[x, y]]);
      await sleep(40);
      lift([]);
      await sleep(120);
      await putDown([[x, y]]);
      await sleep(40);
      lift([]);
      await flush();
      await sleep(180);
    },
    async hold(x, y, ms, keep = false) {
      await self.down([x, y]);
      await sleep(ms);
      if (!keep) await self.up();
    },
    async drag(from, to, steps = 10) {
      await putDown([from]);
      await glideTo(steps, [to]);
      lift([]);
      await flush();
      await sleep(140);
    },
  };
  return self;
}
