// The status beside the logo: the solve's verdict (`SOLVED`, `CONFLICT: …`),
// the app's state (`loading kernel…`, `ready …`, `ERROR`) and the step note
// after it (what an undo did, a tool's guidance). It used to be the header's;
// with no title bar (docs/plans/chrome-logo-scale.md) it is small text over
// the drawing, and text over the drawing has to know when to leave.
//
// **The rules.** What says all is well — `ready`, `SOLVED` — and a note fade
// after a few seconds: they are true, and once read they are in the way. What
// says something is wrong — a conflict, an error — stays until the next action
// replaces it, because a verdict that faded while still true would be the
// stale-readout bug in a new form: a CONFLICT the viewer looked away from
// would read as fixed. `loading kernel…` stays too, until `ready` replaces it.
//
// **Fading is the picture, never the text.** The element keeps what it says
// (`textContent`) — the tests read it, a screen reader reads it, and "faded"
// must never be mistaken for "nothing to report". Only an attribute changes,
// which the stylesheet turns into opacity.
//
// Pure rules over a little DOM-shaped class, so the rules are tested without a
// browser and the timers are the test's.

/** What the status line is saying, by the class index.html colours it with. */
export type StatusKind = "loading" | "ready" | "solved" | "conflict" | "error";

/** How long `ready` and `SOLVED` stay before fading: long enough to read, gone before the next thought. */
export const STATUS_FADE_MS = 3000;
/** How long "undid" stays beside the verdict. */
export const STEP_NOTE_MS = 1600;
/** How long a tool's guidance stays in the note: a sentence of a dozen words, not a one-word "undid". */
export const GUIDE_NOTE_MS = 5000;

/** How long a status of `kind` stays before it fades — or null: until the next one replaces it. */
export function statusFade(kind: StatusKind): number | null {
  return kind === "ready" || kind === "solved" ? STATUS_FADE_MS : null;
}

/** The colour class a status of `kind` carries (index.html). */
export function statusClass(kind: StatusKind): string {
  return kind === "solved" ? "solved" : kind === "conflict" || kind === "error" ? "bad" : "";
}

/** The part of an element this needs — so a test can hand in a plain object. */
export interface TextLike {
  textContent: string | null;
  className: string;
  dataset: Record<string, string | undefined>;
}

/** The timers it needs — the window's, or a test's. */
export interface Timers {
  set(fn: () => void, ms: number): unknown;
  clear(handle: unknown): void;
}

const windowTimers: Timers = {
  set: (fn, ms) => setTimeout(fn, ms),
  clear: (h) => clearTimeout(h as ReturnType<typeof setTimeout>),
};

/**
 * The status and its note, each with its own timer. `show` replaces the
 * status and restarts its fade; `note` replaces the note, which is cleared —
 * text and all, as it always was — after its time.
 */
export class StatusLine {
  private status: TextLike;
  private stepNote: TextLike;
  private timers: Timers;
  private statusTimer: unknown = undefined;
  private noteTimer: unknown = undefined;

  constructor(status: TextLike, stepNote: TextLike, timers: Timers = windowTimers) {
    this.status = status;
    this.stepNote = stepNote;
    this.timers = timers;
  }

  show(kind: StatusKind, text: string): void {
    this.status.textContent = text;
    this.status.className = statusClass(kind);
    delete this.status.dataset.faded;
    this.timers.clear(this.statusTimer);
    const ms = statusFade(kind);
    this.statusTimer = ms === null ? undefined : this.timers.set(() => { this.status.dataset.faded = ""; }, ms);
  }

  /** The note's class: "" for what just happened (amber), "guide" for a tool's guidance. */
  note(text: string, ms: number = STEP_NOTE_MS, cls = ""): void {
    this.stepNote.textContent = text;
    this.stepNote.className = cls;
    this.timers.clear(this.noteTimer);
    this.noteTimer = this.timers.set(() => { this.stepNote.textContent = ""; this.stepNote.className = ""; }, ms);
  }

  /** The note's class now — `"guide"` while a tool's guidance is up. */
  get noteClass(): string {
    return this.stepNote.className;
  }
}

/**
 * What the diagnosis beside the verdict says (docs/plans/sketch-relations.md):
 * words, and relation names to be drawn as things to click. Pure, over plain
 * data — the model's `diagnose` and `conflicting` answers — so the wording is
 * tested without a browser.
 *
 * - a conflict: the relations that cannot all hold — `d1 · d2 cannot all hold`;
 * - solved with agreement: the count of what is free, then how many relations
 *   say one thing together, muted as the count is — `3 free · 4 agreeing` —
 *   never blocking, never a warning, and **naming none**: an agreeing relation
 *   is no fault (docs/plans/profiles-held.md), and the one added last is not
 *   the one to blame (TODO.md's register; the owner's principle). Which they
 *   are, the constraints palette lists (docs/plans/constraints-palette.md).
 * - solved: how many ways the drawing can still move — `3 free`, `0 free`.
 */
export type DiagnosisPart = string | { relation: string };

export interface DiagnosisLine {
  cls: "" | "conflict" | "agreeing";
  parts: DiagnosisPart[];
  /** Whether it fades with SOLVED: only when it says nothing is wrong. */
  fades: boolean;
}

export function diagnosisLine(
  solved: boolean, dof: number | null, conflicts: readonly string[], unowned: readonly string[],
  agreeing: readonly (readonly string[])[],
): DiagnosisLine {
  const names = (rs: readonly string[]): DiagnosisPart[] => rs.flatMap((r, i) => (i ? [" · ", { relation: r }] : [{ relation: r }]));
  if (!solved) {
    const parts: DiagnosisPart[] = [...names(conflicts)];
    if (unowned.length) parts.push(...(parts.length ? [" · "] : []), unowned.join(" · "));
    if (!parts.length) return { cls: "conflict", parts: [], fades: false };
    parts.push(conflicts.length + unowned.length > 1 ? " cannot all hold" : " cannot hold");
    return { cls: "conflict", parts, fades: false };
  }
  const count: DiagnosisPart[] = dof === null ? [] : [`${dof} free`];
  const together = new Set(agreeing.flat()).size;
  if (together) {
    return { cls: "agreeing", parts: [...count, ...(count.length ? [" · "] : []), `${together} agreeing`], fades: false };
  }
  return { cls: "", parts: count, fades: true };
}
