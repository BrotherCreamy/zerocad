// Fingers on the canvas: the one recogniser that turns touch pointers into
// gestures (docs/plans/touch.md). The owner: *"it should work on a multi-touch
// device. Specifically I have an iPhone."*
//
// A mouse says what it means with its buttons — the left is the tool's, the
// right orbits, the middle pans, the wheel zooms — and the engine reads each
// press for what it is the moment it arrives. A finger has one button and a
// count, so a press means nothing until it has *done* something: moved, lifted,
// held still, or been joined by another finger. This file holds a touch back
// until it has, and then tells its sink — the engine — what it turned out to
// be. The engine feeds the answer down the paths a mouse already uses, so a
// tool sees the same `onDown`/`onMove`/`onUp` from a finger as from a mouse,
// and nothing below the engine knows a finger exists.
//
// | finger | is |
// |---|---|
// | down, lifted within `TAP_SLOP` and `TAP_MS` | **tap** — a click |
// | down, moved past `TAP_SLOP` | **drag** — the left button's drag |
// | down, still for `LONG_PRESS_MS` | **long-press** — the right-click menu |
// | long-pressed, then moved | **box** — the left drag on empty canvas |
// | a second finger | **pinch** — the centroid pans, the spread zooms about it |
// | a third finger | everything in progress dropped, until every finger lifts |
//
// A second finger arriving during any one-finger gesture **abandons** it
// first (a half-drawn rectangle dropped, not committed) and then pinches. A
// pinch that loses a finger, and anything after a third, is *spent*: nothing
// more happens until the hand is off the glass, so a finger left behind by a
// pinch cannot start drawing where it happens to be. Twist is ignored — the
// spread and the centroid are all a pinch reads, so turning two fingers is
// neither a pan nor a zoom rather than a misread one.
//
// Pure: no DOM, no model, no camera — pointer ids, canvas pixels and a clock,
// which a test drives with a fake. Timing is the clock's (`now`, `after`), so
// the long-press is a timer and not a guess made on the next event: a finger
// held perfectly still sends no events at all.

/**
 * How far a finger may wander and still be a tap or a long-press, in CSS
 * pixels. A fingertip rolls a few pixels as it lands and lifts; the mouse's 3 px
 * (the engine's DRAG_THRESHOLD) would read most taps as tiny drags. 8 px is
 * what iOS and Android use for the same decision, near enough.
 */
export const TAP_SLOP = 8;

/** A tap lifts within this many milliseconds. Longer and still is a press with no meaning until it is a long-press. */
export const TAP_MS = 350;

/** Held still this long, a finger asks for the menu — iOS's own long-press interval. */
export const LONG_PRESS_MS = 500;

/**
 * A long-press timer firing this much past its time means the page was busy
 * (a heavy solve, a big file opening) — and a lift that happened meanwhile may
 * be waiting in the queue behind it. So a late timer does not decide; it
 * waits this long again, letting queued input land first (`ripe`: one turn
 * of the queue was not enough on a loaded machine). Measured: a 40 ms tap made
 * while the page was blocked for 700 ms at touchdown was read as a held press,
 * and the tap was lost (`touch.e2e.ts`).
 */
export const LATE_MS = 50;

/** Time, for the recogniser: what it is now, and a callback later that can be called off. */
export interface Clock {
  now(): number;
  after(ms: number, fn: () => void): () => void;
}

export const realClock: Clock = {
  now: () => performance.now(),
  after: (ms, fn) => {
    const t = setTimeout(fn, ms);
    return () => clearTimeout(t);
  },
};

/**
 * What a recognised gesture is handed to. Every coordinate is canvas pixels.
 * The one-finger gestures arrive as start, moves, end — or `abandon`, which
 * ends any of them without its end: the gesture is to be dropped, not
 * finished. `end` comes once every finger is off the glass, whatever happened.
 */
export interface GestureSink {
  /** A finger is down and nothing is decided yet — where it is, on landing and on every move inside the slop. */
  press(x: number, y: number): void;
  /** Down and up again, inside the slop and in time: a click, where it landed. */
  tap(x: number, y: number): void;
  /** Moved past the slop: a drag from where it landed. Moves and an end follow. */
  dragStart(x0: number, y0: number): void;
  drag(x: number, y: number): void;
  dragEnd(x: number, y: number): void;
  /** Held still: the menu, where it landed. A box may follow, if it then moves. */
  longPress(x: number, y: number): void;
  /** Long-pressed, then moved past the slop: a box from where it landed. */
  boxStart(x0: number, y0: number): void;
  box(x: number, y: number): void;
  boxEnd(x: number, y: number): void;
  /** Two fingers moved: pan by (dx, dy), then zoom by `factor` about the centroid (cx, cy) they now share. */
  pinch(dx: number, dy: number, factor: number, cx: number, cy: number): void;
  /** The one-finger gesture in progress — a press, drag, long-press or box — is dropped, not finished. */
  abandon(): void;
  /** Every finger is up. */
  end(): void;
}

type Phase =
  | { kind: "idle" }
  | { kind: "pending"; id: number; x0: number; y0: number; t0: number; stop: () => void }
  | { kind: "drag"; id: number }
  | { kind: "held"; id: number; x0: number; y0: number }
  | { kind: "box"; id: number }
  | { kind: "pinch"; a: number; b: number; cx: number; cy: number; spread: number }
  | { kind: "spent" };

/** Which phases are one finger's gesture — what a second or third finger abandons. */
const ONE_FINGER = new Set(["pending", "drag", "held", "box"]);

export class Gestures {
  private sink: GestureSink;
  private clock: Clock;
  private fingers = new Map<number, { x: number; y: number }>();
  private phase: Phase = { kind: "idle" };

  constructor(sink: GestureSink, clock: Clock = realClock) {
    this.sink = sink;
    this.clock = clock;
  }

  /** What the recogniser is doing — for a test, and for the engine to know a finger is down. */
  get state(): Phase["kind"] {
    return this.phase.kind;
  }

  /** How many fingers are on the glass. */
  get count(): number {
    return this.fingers.size;
  }

  /**
   * `at` is when the finger actually landed — the event's own timestamp, in
   * the clock's timebase — rather than when the page got round to it: on a
   * busy page the two differ by however long it was busy, and a tap is a
   * question about the finger, not about the page. Without one, the clock.
   */
  down(id: number, x: number, y: number, at?: number): void {
    if (this.fingers.has(id)) return;
    this.fingers.set(id, { x, y });
    const n = this.fingers.size;
    if (n === 1 && this.phase.kind === "idle") {
      const t0 = at ?? this.clock.now();
      const due = this.clock.now() + LONG_PRESS_MS;
      const stop = this.clock.after(LONG_PRESS_MS, () => this.ripe(id, due));
      this.phase = { kind: "pending", id, x0: x, y0: y, t0, stop };
      this.sink.press(x, y);
      return;
    }
    if (this.phase.kind === "spent") return;
    if (n === 2 && this.phase.kind !== "pinch") {
      this.drop();
      const [a, b] = [...this.fingers.keys()];
      this.phase = { kind: "pinch", a, b, ...this.pair(a, b) };
      return;
    }
    // A third finger (or a second arriving at a recogniser that missed the
    // first): everything stops until the hand is off.
    this.drop();
    this.phase = { kind: "spent" };
  }

  move(id: number, x: number, y: number): void {
    const f = this.fingers.get(id);
    if (!f) return;
    f.x = x;
    f.y = y;
    const p = this.phase;
    switch (p.kind) {
      case "pending":
        if (Math.hypot(x - p.x0, y - p.y0) <= TAP_SLOP) {
          this.sink.press(x, y);
          return;
        }
        p.stop();
        this.phase = { kind: "drag", id };
        this.sink.dragStart(p.x0, p.y0);
        this.sink.drag(x, y);
        return;
      case "drag":
        this.sink.drag(x, y);
        return;
      case "held":
        if (Math.hypot(x - p.x0, y - p.y0) <= TAP_SLOP) return;
        this.phase = { kind: "box", id };
        this.sink.boxStart(p.x0, p.y0);
        this.sink.box(x, y);
        return;
      case "box":
        this.sink.box(x, y);
        return;
      case "pinch": {
        if (id !== p.a && id !== p.b) return;
        const next = this.pair(p.a, p.b);
        // A spread of zero is two fingers on one spot — a hand cannot do it,
        // a script can; read it as no zoom rather than an infinite one.
        const factor = p.spread > 0 && next.spread > 0 ? next.spread / p.spread : 1;
        const [dx, dy] = [next.cx - p.cx, next.cy - p.cy];
        this.phase = { ...p, ...next };
        this.sink.pinch(dx, dy, factor, next.cx, next.cy);
        return;
      }
    }
  }

  /** `at` as for `down`: when the finger lifted, so a tap is timed by the finger's clock. */
  up(id: number, x: number, y: number, at?: number): void {
    if (!this.fingers.has(id)) return;
    this.fingers.delete(id);
    const p = this.phase;
    if (p.kind === "pending") {
      p.stop();
      if ((at ?? this.clock.now()) - p.t0 <= TAP_MS) this.sink.tap(p.x0, p.y0);
      this.phase = { kind: "idle" };
    } else if (p.kind === "drag") {
      this.sink.dragEnd(x, y);
      this.phase = { kind: "idle" };
    } else if (p.kind === "box") {
      this.sink.boxEnd(x, y);
      this.phase = { kind: "idle" };
    } else if (p.kind === "held") {
      this.phase = { kind: "idle" }; // the menu stays open; the finger has done its work
    } else if (p.kind === "pinch") {
      this.phase = { kind: "spent" };
    }
    this.settle();
  }

  /**
   * The browser took a finger back (`pointercancel`: a system gesture, an
   * alert). Whatever it was part of is dropped, never finished — a drag the
   * system interrupted is not a drag the user released.
   */
  cancel(id: number): void {
    if (!this.fingers.has(id)) return;
    this.fingers.delete(id);
    if (this.phase.kind !== "idle" && this.phase.kind !== "spent") {
      this.drop();
      this.phase = { kind: "spent" };
    }
    this.settle();
  }

  /**
   * The engine dropped everything itself (Escape, Cancel, a model swapped in):
   * whatever the fingers still down were doing is over, and they are ignored
   * until they lift. The sink is not told — it is the one that asked.
   */
  reset(): void {
    if (this.phase.kind === "pending") this.phase.stop();
    this.phase = this.fingers.size ? { kind: "spent" } : { kind: "idle" };
  }

  /** The one-finger gesture in progress, if any, abandoned. */
  private drop(): void {
    const p = this.phase;
    if (!ONE_FINGER.has(p.kind)) return;
    if (p.kind === "pending") p.stop();
    this.phase = { kind: "spent" };
    this.sink.abandon();
  }

  /** Back to idle, and `end`, once the last finger is off. */
  private settle(): void {
    if (this.fingers.size > 0) {
      if (this.phase.kind === "idle") this.phase = { kind: "spent" };
      return;
    }
    this.phase = { kind: "idle" };
    this.sink.end();
  }

  /**
   * The long-press timer: on time, the press is held; late, see `LATE_MS` —
   * wait a grace of that much, then decide. One turn of the queue was the
   * first version, and it lost a tap under load (touch.e2e.ts, the busy
   * page, once in nine full runs): the browser forwards a lift only once the
   * landing is acknowledged — after the block, by a message — and on a
   * loaded machine that message takes longer than one turn. A long-press on
   * a page that was already blocked longer than this opens its menu
   * `LATE_MS` later, which is not felt.
   */
  private ripe(id: number, due: number): void {
    const p = this.phase;
    if (p.kind !== "pending" || p.id !== id) return;
    if (this.clock.now() - due <= LATE_MS) { this.held(id); return; }
    p.stop = this.clock.after(LATE_MS, () => this.held(id));
  }

  private held(id: number): void {
    const p = this.phase;
    if (p.kind !== "pending" || p.id !== id) return;
    this.phase = { kind: "held", id, x0: p.x0, y0: p.y0 };
    this.sink.longPress(p.x0, p.y0);
  }

  /** Where two fingers' centroid is and how far apart they are. */
  private pair(a: number, b: number): { cx: number; cy: number; spread: number } {
    const fa = this.fingers.get(a)!, fb = this.fingers.get(b)!;
    return { cx: (fa.x + fb.x) / 2, cy: (fa.y + fb.y) / 2, spread: Math.hypot(fa.x - fb.x, fa.y - fb.y) };
  }
}
