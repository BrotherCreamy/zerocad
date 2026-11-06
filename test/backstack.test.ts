// Android's back (docs/plans/android.md): one history entry pushed when
// something opens, taken off when it closes, a `popstate` closing it; a
// guard at rest so a back with nothing open does nothing; nothing left behind
// after open-close-open. Run against a fake session history that behaves as a
// browser's: `pushState` drops the forward entries, `back()` moves the index
// and its `popstate` arrives later (here, when the test drains it), and the
// person's own back is the same move with a `popstate` of its own.

import { test } from "node:test";
import assert from "node:assert/strict";
import { BackStack, GUARD, OPEN, kindOf, type BackResult, type HistoryLike, type Openings } from "../src/backstack.ts";

class FakeHistory implements HistoryLike {
  entries: unknown[] = [null];
  index = 0;
  /**
   * Traversals on their way. As in a browser, `back()` only queues one: it is
   * applied — relative to wherever the page is by then — and its popstate
   * fired when the test drains the queue, so a push made in between lands
   * first.
   */
  queue: number[] = [];
  left = false;
  get state(): unknown { return this.entries[this.index]; }
  pushState(data: unknown): void {
    this.entries = this.entries.slice(0, this.index + 1);
    this.entries.push(data);
    this.index++;
  }
  replaceState(data: unknown): void { this.entries[this.index] = data; }
  /** `history.back()` — the page's own or the person's. */
  back(): void { this.queue.push(-1); }
  forward(): void { this.queue.push(1); }
  /** Applies every traversal on its way, each one's popstate delivered; back past the first entry leaves the page. */
  drain(stack: BackStack): ReturnType<BackStack["popped"]>[] {
    const out: BackResult[] = [];
    while (this.queue.length) {
      const to = this.index + this.queue.shift()!;
      if (to < 0) { this.left = true; continue; }
      if (to >= this.entries.length) continue;
      this.index = to;
      out.push(stack.popped(this.state));
    }
    return out;
  }
}

/** A host with things that open and close, a tooltip among them, top-most last opened. */
function host() {
  const open: string[] = [];
  const closedByBack: string[] = [];
  const o: Openings = {
    open: () => [...open].reverse(),
    close: (n) => { open.splice(open.indexOf(n), 1); closedByBack.push(n); },
    tracked: (n) => n !== "tooltip",
  };
  return { o, open, closedByBack };
}

/** The person's back gesture: the browser goes back, and its popstate is delivered. */
function personBack(h: FakeHistory, s: BackStack) {
  h.back();
  return h.drain(s);
}

test("push on open, pop on close: a menu opened by a press gets one entry, and Escape takes it off again", () => {
  const h = new FakeHistory();
  const { o, open } = host();
  const s = new BackStack(h, o, { guard: true });
  s.arm();
  assert.deepEqual(h.entries, [null, GUARD], "the guard at the first press");
  open.push("appmenu");
  s.opened("appmenu", true);
  assert.deepEqual(h.entries, [null, GUARD, OPEN]);
  assert.equal(s.entry, "open");
  // Escape closes it: the entry comes off, and the popstate that answers is expected.
  open.pop();
  s.closed();
  assert.deepEqual(h.drain(s), ["expected"]);
  assert.equal(h.index, 1, "back on the guard");
  assert.equal(kindOf(h.state), "guard");
});

test("popstate closes it: the back gesture closes the open thing and leaves the guard up", () => {
  const h = new FakeHistory();
  const { o, open, closedByBack } = host();
  const s = new BackStack(h, o, { guard: true });
  open.push("appmenu");
  s.opened("appmenu", true);
  assert.deepEqual(h.entries, [null, GUARD, OPEN], "opened before any press armed it: the guard goes under");
  assert.deepEqual(personBack(h, s), [{ closed: "appmenu" }]);
  assert.deepEqual(closedByBack, ["appmenu"]);
  assert.equal(kindOf(h.state), "guard");
  // The closing the back did is reported by the host too: no second back for it.
  s.closed();
  assert.deepEqual(h.queue, []);
  assert.equal(h.index, 1);
});

test("a flyout, then the menu, then nothing: each back closes the top-most, and a back at rest does nothing, never leaving the page", () => {
  const h = new FakeHistory();
  const { o, open, closedByBack } = host();
  const s = new BackStack(h, o, { guard: true });
  s.arm();
  open.push("appmenu");
  s.opened("appmenu", true);
  open.push("flyout");
  s.opened("flyout", true);
  assert.deepEqual(h.entries, [null, GUARD, OPEN], "one entry for however much is open");
  assert.deepEqual(personBack(h, s), [{ closed: "flyout" }]);
  assert.deepEqual(h.entries.slice(0, h.index + 1), [null, GUARD, OPEN], "the menu still open: an entry to close it by");
  assert.deepEqual(personBack(h, s), [{ closed: "appmenu" }]);
  assert.equal(kindOf(h.state), "guard");
  // Nothing open: the back pops the guard, closes nothing, and puts the guard back.
  assert.deepEqual(personBack(h, s), ["nothing"]);
  assert.equal(kindOf(h.state), "guard");
  assert.deepEqual(personBack(h, s), ["nothing"]);
  assert.equal(h.left, false, "never left the page");
  assert.deepEqual(closedByBack, ["flyout", "appmenu"]);
});

test("nothing left behind after open-close-open: ten menus opened and closed leave the history as one guard", () => {
  const h = new FakeHistory();
  const { o, open } = host();
  const s = new BackStack(h, o, { guard: true });
  s.arm();
  for (let i = 0; i < 10; i++) {
    open.push("ctxmenu");
    s.opened("ctxmenu", true);
    open.pop();
    s.closed();
    h.drain(s);
  }
  assert.equal(h.index, 1);
  assert.equal(kindOf(h.state), "guard");
  // And open again after: one entry, and the back closes it.
  open.push("ctxmenu");
  s.opened("ctxmenu", true);
  assert.equal(h.index, 2);
  assert.deepEqual(personBack(h, s), [{ closed: "ctxmenu" }]);
});

test("closed before the expected popstate came: opening again at once still gets its entry and the late popstate is not taken as a back", () => {
  const h = new FakeHistory();
  const { o, open, closedByBack } = host();
  const s = new BackStack(h, o, { guard: true });
  s.arm();
  open.push("appmenu");
  s.opened("appmenu", true);
  open.pop();
  s.closed();             // back() is on its way
  open.push("appmenu");
  s.opened("appmenu", true); // reopened before it arrived
  assert.deepEqual(h.drain(s), ["expected"]);
  assert.deepEqual(closedByBack, [], "the late popstate closed nothing");
  // It landed after the push — on the guard, with the menu open — and the
  // menu got its entry again.
  assert.equal(kindOf(h.state), "open");
  assert.deepEqual(personBack(h, s), [{ closed: "appmenu" }]);
});

test("what is not pushed for: a hover's opening (no gesture) and a tooltip — but a back still closes them", () => {
  const h = new FakeHistory();
  const { o, open, closedByBack } = host();
  const s = new BackStack(h, o, { guard: true });
  s.arm();
  open.push("flyout");
  s.opened("flyout", false); // a mouse's hover opened it
  open.push("tooltip");
  s.opened("tooltip", true);
  assert.deepEqual(h.entries, [null, GUARD], "no entry for either");
  assert.deepEqual(personBack(h, s), [{ closed: "tooltip" }], "the guard's pop closes the top-most, a tooltip too");
  assert.deepEqual(personBack(h, s), [{ closed: "flyout" }]);
  assert.deepEqual(personBack(h, s), ["nothing"]);
  assert.equal(h.left, false);
  assert.deepEqual(closedByBack, ["tooltip", "flyout"]);
});

test("unguarded (a desktop's tab): a back closes what is open, and with nothing open it leaves the page as Back always has", () => {
  const h = new FakeHistory();
  const { o, open } = host();
  const s = new BackStack(h, o, { guard: false });
  s.arm();
  assert.deepEqual(h.entries, [null], "no guard");
  open.push("appmenu");
  s.opened("appmenu", true);
  assert.deepEqual(h.entries, [null, OPEN]);
  assert.deepEqual(personBack(h, s), [{ closed: "appmenu" }]);
  assert.equal(h.index, 0);
  personBack(h, s);
  assert.equal(h.left, true);
});

test("a reload on an entry of its own: a guard stays a guard, an entry of something open becomes one", () => {
  const h = new FakeHistory();
  h.entries = [null, GUARD, OPEN];
  h.index = 2;
  const { o } = host();
  const s = new BackStack(h, o, { guard: true });
  assert.equal(s.entry, "guard");
  assert.deepEqual(h.entries, [null, GUARD, GUARD]);
  s.arm();
  assert.equal(h.entries.length, 3, "no second guard on top");
  // Forward onto an entry of something open that is long closed: made a guard.
  const h2 = new FakeHistory();
  const s2 = new BackStack(h2, o, { guard: true });
  s2.arm();
  h2.entries.push(OPEN);
  h2.forward();
  h2.drain(s2);
  assert.equal(kindOf(h2.state), "guard");
  assert.equal(kindOf({ zerocad: "elsewhere" }), "base");
  assert.equal(kindOf(null), "base");
});
