// The touch recogniser on its own (src/tools/gestures.ts): pointer ids, pixels
// and a fake clock in, the gestures it decided on out. What a finger *means*
// is decided here and nowhere else, so every row of the spec's finger table is
// checked here, timing included; what the engine then does with each gesture
// is test/touch.test.ts's and the e2e suite's.

import { test } from "node:test";
import assert from "node:assert/strict";
import { Gestures, LATE_MS, LONG_PRESS_MS, TAP_MS, TAP_SLOP, type Clock, type GestureSink } from "../src/tools/gestures.ts";

/** A clock that moves only when told, firing what falls due on the way. */
class FakeClock implements Clock {
  t = 0;
  private timers: { at: number; fn: () => void; live: boolean }[] = [];
  now(): number { return this.t; }
  after(ms: number, fn: () => void): () => void {
    const timer = { at: this.t + ms, fn, live: true };
    this.timers.push(timer);
    return () => { timer.live = false; };
  }
  advance(ms: number): void {
    const until = this.t + ms;
    for (;;) {
      const due = this.timers.filter((x) => x.live && x.at <= until).sort((a, b) => a.at - b.at)[0];
      if (!due) break;
      this.t = due.at;
      due.live = false;
      due.fn();
    }
    this.t = until;
  }
  /** A busy page: time passes and nothing runs — no timer fires until the page is free. */
  block(ms: number): void { this.t += ms; }
  /** The page free again, one task at a time: only the earliest timer already due runs. */
  fireOnce(): void {
    const due = this.timers.filter((x) => x.live && x.at <= this.t).sort((a, b) => a.at - b.at)[0];
    if (due) { due.live = false; due.fn(); }
  }
}

/** Every call the sink got, as a line — `pinch` rounded so a test can read it. */
function recorder(): { sink: GestureSink; calls: string[] } {
  const calls: string[] = [];
  const r = (n: number) => Math.round(n * 1000) / 1000;
  const sink: GestureSink = {
    press: (x, y) => calls.push(`press ${x},${y}`),
    tap: (x, y) => calls.push(`tap ${x},${y}`),
    dragStart: (x, y) => calls.push(`dragStart ${x},${y}`),
    drag: (x, y) => calls.push(`drag ${x},${y}`),
    dragEnd: (x, y) => calls.push(`dragEnd ${x},${y}`),
    longPress: (x, y) => calls.push(`longPress ${x},${y}`),
    boxStart: (x, y) => calls.push(`boxStart ${x},${y}`),
    box: (x, y) => calls.push(`box ${x},${y}`),
    boxEnd: (x, y) => calls.push(`boxEnd ${x},${y}`),
    pinch: (dx, dy, f, cx, cy) => calls.push(`pinch ${r(dx)},${r(dy)} ×${r(f)} @${r(cx)},${r(cy)}`),
    abandon: () => calls.push("abandon"),
    end: () => calls.push("end"),
  };
  return { sink, calls };
}

function setup() {
  const clock = new FakeClock();
  const { sink, calls } = recorder();
  return { g: new Gestures(sink, clock), clock, calls };
}

test("a tap: down and up inside the slop and in time is one tap where it landed", () => {
  const { g, clock, calls } = setup();
  g.down(1, 100, 100);
  g.move(1, 104, 103); // a fingertip rolls
  clock.advance(TAP_MS - 50);
  g.up(1, 105, 104);
  assert.deepEqual(calls, ["press 100,100", "press 104,103", "tap 100,100", "end"]);
});

test("held too long for a tap and lifted before the long-press: nothing at all", () => {
  const { g, clock, calls } = setup();
  g.down(1, 100, 100);
  clock.advance(TAP_MS + 50);
  g.up(1, 100, 100);
  assert.deepEqual(calls, ["press 100,100", "end"]);
});

test("moved past the slop: a drag from where it landed, every move, and the end where it lifted", () => {
  const { g, clock, calls } = setup();
  g.down(1, 100, 100);
  g.move(1, 100 + TAP_SLOP + 1, 100);
  g.move(1, 150, 120);
  clock.advance(2000); // a drag is not a long-press however long it lasts
  g.up(1, 151, 121);
  assert.deepEqual(calls, [
    "press 100,100", "dragStart 100,100", `drag ${100 + TAP_SLOP + 1},100`, "drag 150,120", "dragEnd 151,121", "end",
  ]);
});

test("held still: the long-press fires on its timer, with no event to carry it, and the lift does nothing more", () => {
  const { g, clock, calls } = setup();
  g.down(1, 80, 90);
  clock.advance(LONG_PRESS_MS - 1);
  assert.deepEqual(calls, ["press 80,90"]);
  clock.advance(1);
  assert.deepEqual(calls, ["press 80,90", "longPress 80,90"]);
  g.move(1, 83, 92); // inside the slop: still just held
  g.up(1, 83, 92);
  assert.deepEqual(calls, ["press 80,90", "longPress 80,90", "end"]);
});

test("long-press, then drag: the box, from where it was pressed", () => {
  const { g, clock, calls } = setup();
  g.down(1, 80, 90);
  clock.advance(LONG_PRESS_MS + 10);
  g.move(1, 140, 150);
  g.move(1, 160, 170);
  g.up(1, 160, 170);
  assert.deepEqual(calls, ["press 80,90", "longPress 80,90", "boxStart 80,90", "box 140,150", "box 160,170", "boxEnd 160,170", "end"]);
});

test("two fingers: the centroid pans and the spread zooms about it, both at once", () => {
  const { g, calls } = setup();
  g.down(1, 100, 100);
  g.down(2, 200, 100); // centroid 150,100; spread 100
  g.move(2, 300, 100); // centroid 200,100; spread 200
  g.move(1, 110, 110); // centroid 205,105; spread hypot(190,10)
  g.up(1, 110, 110);
  g.up(2, 300, 100);
  const spread = Math.hypot(190, 10);
  assert.deepEqual(calls, [
    "press 100,100", "abandon",
    "pinch 50,0 ×2 @200,100",
    `pinch 5,5 ×${Math.round((spread / 200) * 1000) / 1000} @205,105`,
    "end",
  ]);
});

test("a twist is neither a pan nor a zoom: two fingers turning about their middle send a pinch of nothing", () => {
  const { g, calls } = setup();
  g.down(1, 100, 100);
  g.down(2, 200, 100);
  calls.length = 0;
  // Both fingers turned 90° about (150, 100) together, as a hand does.
  g.move(1, 150, 50);
  g.move(2, 150, 150);
  // Mid-turn the centroid wanders and the spread dips, one finger at a time;
  // once both have arrived, the net is no pan and no zoom.
  const net = calls.map((c) => c.match(/pinch (-?[\d.]+),(-?[\d.]+) ×([\d.]+)/)!).reduce(
    (s, m) => ({ dx: s.dx + Number(m[1]), dy: s.dy + Number(m[2]), f: s.f * Number(m[3]) }), { dx: 0, dy: 0, f: 1 });
  assert.ok(Math.abs(net.dx) < 1e-9 && Math.abs(net.dy) < 1e-9, `net pan ${net.dx},${net.dy}`);
  assert.ok(Math.abs(net.f - 1) < 1e-2, `net zoom ${net.f}`);
});

test("a second finger mid-drag abandons the drag — no dragEnd — and pinches", () => {
  const { g, calls } = setup();
  g.down(1, 100, 100);
  g.move(1, 140, 100);
  g.down(2, 200, 200);
  g.move(2, 210, 200);
  g.up(2, 210, 200);
  g.up(1, 140, 100);
  assert.deepEqual(calls.slice(0, 4), ["press 100,100", "dragStart 100,100", "drag 140,100", "abandon"]);
  assert.ok(calls[4].startsWith("pinch "));
  assert.ok(!calls.some((c) => c.startsWith("dragEnd")), "a dropped drag is not finished");
  assert.equal(calls.at(-1), "end");
});

test("a second finger before the first has decided anything: no tap, no long-press, a pinch", () => {
  const { g, clock, calls } = setup();
  g.down(1, 100, 100);
  g.down(2, 200, 100);
  clock.advance(LONG_PRESS_MS * 2);
  g.up(1, 100, 100);
  g.up(2, 200, 100);
  assert.deepEqual(calls, ["press 100,100", "abandon", "end"]);
});

test("a pinch that loses a finger is spent: the finger left behind draws nothing until the hand is off", () => {
  const { g, clock, calls } = setup();
  g.down(1, 100, 100);
  g.down(2, 200, 100);
  g.up(2, 200, 100);
  calls.length = 0;
  g.move(1, 300, 300);
  clock.advance(LONG_PRESS_MS * 2);
  g.up(1, 300, 300);
  assert.deepEqual(calls, ["end"]);
  // ...and the next touch is a fresh one.
  g.down(3, 50, 50);
  clock.advance(10);
  g.up(3, 50, 50);
  assert.deepEqual(calls, ["end", "press 50,50", "tap 50,50", "end"]);
});

test("a third finger drops everything, a pinch included, until every finger has lifted", () => {
  const { g, calls } = setup();
  g.down(1, 100, 100);
  g.move(1, 150, 100);
  g.down(2, 200, 200);
  g.down(3, 250, 250);
  calls.length = 0;
  g.move(1, 10, 10);
  g.move(2, 20, 20);
  g.up(3, 250, 250);
  g.move(1, 30, 30); // two fingers again, still nothing
  g.up(1, 30, 30);
  g.up(2, 20, 20);
  assert.deepEqual(calls, ["end"]);
});

test("a third finger during a one-finger drag that has become a pinch abandons only once", () => {
  const { g, calls } = setup();
  g.down(1, 100, 100);
  g.move(1, 150, 100);
  g.down(2, 200, 200);
  g.down(3, 250, 250);
  assert.equal(calls.filter((c) => c === "abandon").length, 1);
});

test("a cancelled finger drops its gesture rather than finishing it", () => {
  const { g, calls } = setup();
  g.down(1, 100, 100);
  g.move(1, 150, 100);
  g.cancel(1);
  assert.deepEqual(calls, ["press 100,100", "dragStart 100,100", "drag 150,100", "abandon", "end"]);
});

test("reset: the engine dropped everything, so the fingers still down are ignored and the timer is off", () => {
  const { g, clock, calls } = setup();
  g.down(1, 100, 100);
  g.reset();
  clock.advance(LONG_PRESS_MS * 2);
  g.move(1, 200, 200);
  g.up(1, 200, 200);
  assert.deepEqual(calls, ["press 100,100", "end"]);
  assert.equal(g.state, "idle");
});

test("a finger the recogniser never saw go down — one another handler took — is ignored throughout", () => {
  const { g, calls } = setup();
  g.move(7, 10, 10);
  g.up(7, 10, 10);
  g.cancel(7);
  assert.deepEqual(calls, []);
});

// A busy page (a heavy solve, a big file opening) must not turn a quick tap
// into something else. Measured in the browser first: a 40 ms tap made while
// the page was blocked 700 ms at touchdown selected nothing (touch.e2e.ts).

test("a tap is timed by the finger, not the page: lifted at 40 ms, handled at 600, it is a tap", () => {
  const { g, clock, calls } = setup();
  g.down(1, 10, 10, 0);
  clock.block(600);
  g.up(1, 10, 10, 40);
  assert.ok(calls.includes("tap 10,10"), calls.join(" | "));
  assert.ok(!calls.some((c) => c.startsWith("longPress")));
});

test("a long-press timer that fires late yields once, so a lift waiting in the queue lands first and is a tap", () => {
  const { g, clock, calls } = setup();
  g.down(1, 10, 10, 0);
  clock.block(LONG_PRESS_MS + LATE_MS + 150);
  clock.fireOnce(); // the late timer: it must not decide yet
  assert.ok(!calls.some((c) => c.startsWith("longPress")), "not held on a late timer's say-so");
  g.up(1, 10, 10, 40); // the lift the busy page had queued
  clock.advance(0);
  assert.ok(calls.includes("tap 10,10"), calls.join(" | "));
  assert.ok(!calls.some((c) => c.startsWith("longPress")));
});

test("a late timer with no lift waiting still makes a long-press, a grace later", () => {
  const { g, clock, calls } = setup();
  g.down(1, 10, 10, 0);
  clock.block(LONG_PRESS_MS + LATE_MS + 150);
  clock.fireOnce();
  clock.advance(0);
  assert.ok(!calls.some((c) => c.startsWith("longPress")), "not on the next turn: the lift may still be on its way");
  clock.advance(LATE_MS);
  assert.ok(calls.includes("longPress 10,10"), calls.join(" | "));
});

// Measured in the browser (touch.e2e.ts, the busy page, under the full suite's
// load): the browser forwards a lift only once the landing is acknowledged,
// which is after the block, and on a loaded machine that takes longer than
// one turn of the page's queue. A grace of LATE_MS covers it.
test("a lift arriving within the grace after a late timer is still a tap", () => {
  const { g, clock, calls } = setup();
  g.down(1, 10, 10, 0);
  clock.block(LONG_PRESS_MS + LATE_MS + 150);
  clock.fireOnce();
  clock.advance(LATE_MS - 1);
  g.up(1, 10, 10, 40);
  clock.advance(LATE_MS);
  assert.ok(calls.includes("tap 10,10"), calls.join(" | "));
  assert.ok(!calls.some((c) => c.startsWith("longPress")));
});

// Measured in the browser (android.e2e.ts, Pixel 7, at load 30): the page,
// busy from the landing until its long-press timer was due, ran the timer
// before the move the browser already had for it — a move the finger made at
// 171 ms. The page's lateness is not the finger's hold.
test("a drag the page saw only after its long-press timer: moved at 171 ms by its stamp, it is a drag, the long-press dropped", () => {
  const { g, clock, calls } = setup();
  g.down(1, 80, 90, 0);
  clock.advance(LONG_PRESS_MS); // the timer, on time: the move is still queued
  assert.ok(calls.includes("longPress 80,90"));
  clock.block(60);
  g.move(1, 140, 150, 171);
  g.move(1, 160, 170, 600);
  g.up(1, 160, 170, 620);
  assert.deepEqual(calls, ["press 80,90", "longPress 80,90", "abandon", "dragStart 80,90", "drag 140,150", "drag 160,170", "dragEnd 160,170", "end"]);
});

test("a held press moved by the finger after the long-press is still the box", () => {
  const { g, clock, calls } = setup();
  g.down(1, 80, 90, 0);
  clock.advance(LONG_PRESS_MS + 100);
  g.move(1, 140, 150, LONG_PRESS_MS + 90);
  assert.deepEqual(calls, ["press 80,90", "longPress 80,90", "boxStart 80,90", "box 140,150"]);
});

test("a held press's move inside the slop is nothing, whatever its stamp", () => {
  const { g, clock, calls } = setup();
  g.down(1, 80, 90, 0);
  clock.advance(LONG_PRESS_MS);
  g.move(1, 84, 93, 100);
  assert.deepEqual(calls, ["press 80,90", "longPress 80,90"]);
  assert.equal(g.state, "held");
});

test("on time, a held finger is a long-press exactly as before", () => {
  const { g, clock, calls } = setup();
  g.down(1, 10, 10, 0);
  clock.advance(LONG_PRESS_MS);
  assert.ok(calls.includes("longPress 10,10"), calls.join(" | "));
});

