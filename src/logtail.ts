// The log's see-through form (docs/plans/panels-overlay-lock.md): its last
// three lines over the drawing, each fading with age and gone after ten
// seconds — the log read through would be a wall of old text over the
// drawing, and what a person glances at is what just happened.
//
// Read from the docked log itself, so the two cannot disagree: each line the
// app logs is one element of `#log`, stamped with when it was said
// (`data-at`), and the tail is the last three of those still young enough.
// A tap on a line brings the whole log back docked (panels.ts's pin) until the
// next press outside it. This file imports nothing.

/** One line of the log, as the docked log holds it. */
export interface LogEntry { text: string; cls: string; at: number }

/** How many lines the see-through log shows. */
export const TAIL_LINES = 3;
/** How long a line stays: it fades from the moment it is said, and is gone at this age. */
export const TAIL_LIFE_MS = 10_000;
/** For this long a line is wholly there; then it fades to nothing by `TAIL_LIFE_MS`. */
export const TAIL_HOLD_MS = 3_000;

/** A line of the tail: the entry, and how opaque its age makes it now. */
export interface TailLine extends LogEntry { opacity: number; age: number }

/** How opaque a line `age` ms old is drawn: whole for the hold, then linearly to nothing at the end of its life. */
export function tailOpacity(age: number): number {
  if (age <= TAIL_HOLD_MS) return 1;
  if (age >= TAIL_LIFE_MS) return 0;
  return 1 - (age - TAIL_HOLD_MS) / (TAIL_LIFE_MS - TAIL_HOLD_MS);
}

/**
 * The tail at `now`: the last `TAIL_LINES` entries of the log that are younger
 * than `TAIL_LIFE_MS`, oldest first, each with its opacity. An entry is never
 * brought back by being among the last three once it has aged out: a quiet
 * log is an empty tail.
 */
export function logTail(entries: readonly LogEntry[], now: number): TailLine[] {
  return entries.slice(-TAIL_LINES)
    .map((e) => ({ ...e, age: Math.max(0, now - e.at) }))
    .filter((e) => e.age < TAIL_LIFE_MS)
    .map((e) => ({ ...e, opacity: tailOpacity(e.age) }));
}

/** The docked log's last few lines, read off its elements and their stamps. */
export function entriesOf(log: HTMLElement, keep = TAIL_LINES): LogEntry[] {
  const kids = Array.from(log.children).slice(-keep) as HTMLElement[];
  return kids.map((d) => ({ text: d.textContent ?? "", cls: d.className, at: Number(d.dataset.at) || 0 }));
}

/**
 * The tail's element, kept to `logTail` of the docked log: redrawn when a line
 * is logged (`sync`), and again when the oldest line shown ages out. Each line
 * fades by a CSS animation started at its age, so nothing runs every frame.
 */
export class LogTail {
  private el: HTMLElement;
  private log: HTMLElement;
  private now: () => number;
  private timer: ReturnType<typeof setTimeout> | undefined;

  constructor(el: HTMLElement, log: HTMLElement, now: () => number = () => Date.now()) {
    this.el = el;
    this.log = log;
    this.now = now;
  }

  sync(): void {
    clearTimeout(this.timer);
    const now = this.now();
    const lines = logTail(entriesOf(this.log), now);
    this.el.textContent = "";
    for (const l of lines) {
      const d = document.createElement("div");
      d.className = l.cls ? `tline ${l.cls}` : "tline";
      d.textContent = l.text;
      // The fade is the stylesheet's (`tailfade`, its length `TAIL_LIFE_MS`),
      // started as far in as the line is old.
      d.style.animationDelay = `${-l.age}ms`;
      d.dataset.age = String(Math.round(l.age));
      this.el.appendChild(d);
    }
    if (lines.length) this.timer = setTimeout(() => this.sync(), TAIL_LIFE_MS - lines[0].age + 20);
  }
}
