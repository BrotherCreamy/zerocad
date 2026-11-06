// Android's back — the gesture from a screen's edge, or the bar's ◁ — and a
// browser's Back (docs/plans/android.md). The owner: *"obv this whole platform
// should also work on android"*; the spec's rule: **back closes what is open —
// a flyout, the menu, a dialog, the context menu, a tooltip — and otherwise
// does nothing, never leaving the app or reloading the page.**
//
// The page has one way to hear a back: a `popstate`, which comes only when
// there is an entry of its own in the session history to go back from. So
// (the pattern every installed web app uses):
//
// - **An entry is pushed when something opens**, and the back that pops it
//   closes the top-most open thing — the same thing Escape closes, so the two
//   are one seam (main.ts's `closeTop`). Pushed only for an opening a person
//   asked for (`userActivation`): a flyout a mouse's hover opened gets none —
//   history written on every hover would be a back button's worth of churn,
//   and Chromium marks entries made without a gesture as ones Back skips.
// - **Closed any other way** (Escape, a tap outside, an item chosen), the
//   entry is taken back off with `history.back()`, and the `popstate` that
//   answers it is expected and ignored — nothing is left behind, so opening
//   and closing a menu ten times leaves the history as it was.
// - **At rest, a guard entry** stands above the page's own, armed at the
//   first press: a back with nothing open pops it, closes nothing, and the
//   guard is put back — so back does nothing rather than leave the app. Only
//   where the app is the whole screen of a phone or installed (main.ts says
//   when): in a desktop's tab, Back leaving the page is what a person expects.
//
// **What this cannot promise.** The guard re-armed by the `popstate` handler
// is pushed without a gesture, so Chromium may mark the entry below it as one
// Back skips until the next tap on the page: two backs with no tap between
// them can leave the app. And a back pressed while an expected `popstate` is
// still on its way is taken as the expected one.
//
// Pure: the history and what is open are handed in, so every rule here runs
// in the unit suite with a fake history.

/** The part of `window.history` this uses. */
export interface HistoryLike {
  readonly state: unknown;
  pushState(data: unknown, unused: string): void;
  replaceState(data: unknown, unused: string): void;
  back(): void;
}

/** What is open, top-most first, and how to close one — the host's chrome. */
export interface Openings {
  /** The names of what is open now, the one a back closes first first. */
  open(): string[];
  /** Closes it, as Escape would. */
  close(name: string): void;
  /** Whether an opening is worth an entry of its own (a tooltip is not: it goes by itself). */
  tracked(name: string): boolean;
}

/** The entries this pushes, told apart from anyone else's by their key. */
export const GUARD = { zerocad: "guard" } as const;
export const OPEN = { zerocad: "open" } as const;
type Kind = "guard" | "open" | "base";

/** Which of this file's entries `state` is — "base" for the page's own (or anyone else's). */
export function kindOf(state: unknown): Kind {
  const k = (state as { zerocad?: unknown } | null)?.zerocad;
  return k === "guard" || k === "open" ? k : "base";
}

/** What a `popstate` did — for the log and the tests. */
export type BackResult = { closed: string } | "nothing" | "expected";

export class BackStack {
  private readonly h: HistoryLike;
  private readonly o: Openings;
  private readonly guarded: boolean;
  /** The entry the page is on, as far as this file has put it there. */
  private at: Kind;
  /** `popstate`s this file asked for with `back()`, still to come. */
  private expected = 0;

  /**
   * `guard`: whether a back at rest is to do nothing (a phone, an installed
   * app) rather than leave the page (a desktop's tab).
   */
  constructor(history: HistoryLike, openings: Openings, options: { guard: boolean }) {
    this.h = history;
    this.o = openings;
    this.guarded = options.guard;
    // A reload keeps the session history: the page may start on an entry of
    // its own. One left from something open is a guard now — nothing is open.
    this.at = kindOf(history.state);
    if (this.at === "open") {
      history.replaceState(this.guarded ? GUARD : null, "");
      this.at = this.guarded ? "guard" : "base";
    }
  }

  /** Where the page is in its own entries: for the tests and the log. */
  get entry(): Kind {
    return this.at;
  }

  /** A press, with the gesture it carries: the moment to put the guard up, where there is to be one. */
  arm(): void {
    if (!this.guarded || this.at !== "base") return;
    this.h.pushState(GUARD, "");
    this.at = "guard";
  }

  /**
   * Something opened. `asked`: a person's press opened it (the browser's user
   * activation) — only then is an entry pushed for it.
   */
  opened(name: string, asked: boolean): void {
    if (this.at === "open" || !asked || !this.o.tracked(name)) return;
    this.arm();
    this.h.pushState(OPEN, "");
    this.at = "open";
  }

  /** Something closed, not by a back: when nothing tracked is open any more, its entry comes off. */
  closed(): void {
    if (this.at !== "open" || this.o.open().some((n) => this.o.tracked(n))) return;
    this.expected++;
    this.at = this.guarded ? "guard" : "base";
    this.h.back();
  }

  /** A `popstate`: a back (or a forward) the person made, or the answer to `closed`'s own. */
  popped(state: unknown): BackResult {
    const k = kindOf(state);
    if (this.expected > 0) {
      this.expected--;
      this.at = k;
      // A traversal lands relative to wherever the page is by then: something
      // opened again before it came was pushed above it, and the traversal
      // went back past that entry. The opening gets one again.
      if (k !== "open" && this.o.open().some((n) => this.o.tracked(n))) {
        this.h.pushState(OPEN, "");
        this.at = "open";
      }
      return "expected";
    }
    this.at = k;
    const open = this.o.open();
    let result: BackResult = "nothing";
    if (open.length) {
      this.o.close(open[0]);
      result = { closed: open[0] };
    }
    // Back where the guard should be: put it up again, so the next back with
    // nothing open does nothing too. Forward onto an entry of something open
    // that is closed now: it is a guard.
    if (k === "open" && !this.o.open().some((n) => this.o.tracked(n))) {
      this.h.replaceState(this.guarded ? GUARD : null, "");
      this.at = this.guarded ? "guard" : "base";
    } else if (k === "base" && this.guarded) {
      this.h.pushState(GUARD, "");
      this.at = "guard";
    }
    // More still open after this one: an entry for the next back to close it by.
    if (this.at !== "open" && this.o.open().some((n) => this.o.tracked(n))) {
      this.h.pushState(OPEN, "");
      this.at = "open";
    }
    return result;
  }
}
