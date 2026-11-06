// The mode chip: where · what · next (docs/plans/mode-feedback.md; the owner:
// "at the moment, it is not obvious how the UI works. like when creating a
// sketch or a face or something - in active face mode or whatever, it isnt
// obvious to me that is whats happening").
//
//     on e1's top · circle · drag the radius
//
// Always the same three parts, beside the status, in the logo's row:
//
//   * **where** — the plane being sketched on, named (activeplane.ts): a face
//     by its feature and side, a frame by its name — or nothing at all, since
//     drawing on the ground is not a mode and must not look like one. A tap
//     opens the plane's menu (Look at, Change…, Done) and a **Done** beside it
//     ends the plane in one tap;
//   * **what** — the armed tool, or Select (or the Hand): a tap opens the
//     tool's options panel, where it has one;
//   * **next** — the gesture's next step, from the tool (`Tool.next`), and
//     every guidance line a tool says, for as long as it is fresh: a click that
//     missed is answered *here*, where the next step is, and the status keeps
//     the verdict and the one-off notes ("cut changed nothing"), so the two
//     never fight for one place. A hint, not a control.
//
// Like the context menu, **the chip only types**: Done is `workplane(null)`
// (or `setDefaultFrame(null)`, where the plane is the default frame's), Look at
// is `lookAt(…)`, Change… is `arm("sketch")` — each through the command line,
// so it is logged, journalled where it is document state, and undone as typed.
//
// Pure rules first, over plain data, so the words are tested without a
// browser; the DOM half is a few buttons.

import type { Model } from "./model.ts";
import type { Menu } from "./menu.ts";
import type { ActivePlane } from "./activeplane.ts";

/** The three parts, as shown. */
export interface ChipParts {
  /** `on e1's top`, `on f1` — or null with no plane chosen, and then not shown at all. */
  where: string | null;
  /** The armed tool's name, or `select` or `hand`. */
  what: string;
  /** The next step, or the fresh guidance — null for a tool that says nothing. */
  next: string | null;
  /** Whether `next` is guidance (a click that missed, answered) rather than the step. */
  guiding: boolean;
}

/**
 * The chip for a moment: the plane's label (null for none), what is in the hand
 * — the armed tool by the name it was armed under, `select` or `hand` — the
 * tool's next step, and a guidance line still fresh, which outranks the step
 * while it is (it says why the last click did nothing, which is what the eye
 * wants first).
 */
export function chipParts(plane: string | null, what: string, next: string | null, guide: string | null): ChipParts {
  return {
    where: plane === null ? null : `on ${plane}`,
    what,
    next: guide ?? next,
    guiding: guide !== null,
  };
}

/** The chip as one line of text: `on e1's top · circle · drag the radius` — its parts that are there, in order. */
export function chipText(p: ChipParts): string {
  return [p.where, p.what, p.next].filter((s): s is string => s !== null && s !== "").join(" · ");
}

/**
 * A tool's guidance as the chip's third part says it: without the `tool: ` the
 * log line starts with — the chip's second part already names the tool — and
 * otherwise word for word, so the log and the chip say the same sentence.
 */
export function guideText(line: string, tool: string | null): string {
  if (tool && line.startsWith(`${tool}: `)) return line.slice(tool.length + 2);
  const m = /^[a-z][a-z0-9 ]{0,24}: /i.exec(line);
  return m ? line.slice(m[0].length) : line;
}

/**
 * The line Done types: **`workplane(null)`** ends a work plane — a face's —
 * and leaves the camera where it is; where the plane is the default frame's
 * (no work plane), `setDefaultFrame(null)` ends that, which is the same choice
 * unmade (choosing a frame is choosing a plane, and `setDefaultFrame` clears a
 * work plane with it). Null with no plane chosen: nothing to end.
 */
export function doneCommand(model: Model): string | null {
  if (model.dim !== 3) return null;
  if (model.workPlane !== null) return "workplane(null)";
  if (model.defaultFrame !== null) return "setDefaultFrame(null)";
  return null;
}

/**
 * The plane's menu, from the chip's first part: **Look at** — square-on to it,
 * `lookAt(ref)`; **Change…** — the sketch tool armed, to pick another face;
 * **Done** — the plane ended (`doneCommand`). Every item a command string, as
 * every menu here is (menu.ts).
 */
export function planeMenu(model: Model, plane: ActivePlane): Menu {
  const done = doneCommand(model);
  return {
    header: `sketching on ${plane.label}`,
    items: [
      { label: "Look at", action: { do: "run", command: `lookAt(${JSON.stringify(plane.ref)})` } },
      { label: "Change…", action: { do: "run", command: 'arm("sketch")' } },
      ...(done ? [{ label: "Done", action: { do: "run" as const, command: done } }] : []),
    ],
  };
}

/** What the chip's DOM half asks of the host. */
export interface ChipHost {
  /** The first part was tapped: open the plane's menu under it (`anchor`, in the page's pixels). */
  planeMenu(anchor: DOMRect): void;
  /** Done was tapped: type `doneCommand`. */
  done(): void;
  /** The second part was tapped: open the armed tool's options panel. */
  options(): void;
}

/**
 * The chip on screen: three parts in the status's corner (index.html's
 * `#mode`), each a button but the third. Rebuilt only when what it says
 * changes — it is asked every frame — and it carries what it says as data
 * (`data-where`, `data-what`, `data-next`) for a test to read without parsing.
 */
export class ModeChip {
  private el: HTMLElement;
  private host: ChipHost;
  private shown = "";
  private where: HTMLButtonElement;
  private done: HTMLButtonElement;
  private what: HTMLButtonElement;
  private next: HTMLSpanElement;

  constructor(el: HTMLElement, host: ChipHost) {
    this.el = el;
    this.host = host;
    const part = (cls: string, label: string) => {
      const b = document.createElement("button");
      b.type = "button";
      b.className = cls;
      b.setAttribute("aria-label", label);
      return b;
    };
    this.where = part("where", "the sketch plane — its menu");
    this.done = part("done", "Done — end the sketch plane");
    this.done.textContent = "Done";
    this.what = part("what", "the tool in hand — its options");
    this.next = document.createElement("span");
    this.next.className = "next";
    const sep = (cls: string) => {
      const s = document.createElement("span");
      s.className = `sep ${cls}`;
      s.textContent = "·";
      return s;
    };
    const plane = document.createElement("span");
    plane.className = "plane";
    plane.append(this.where, this.done, sep("psep"));
    el.append(plane, this.what, sep("nsep"), this.next);
    // A press on the chip is the chip's: never a gesture on the canvas under it.
    el.addEventListener("pointerdown", (e) => e.stopPropagation());
    this.where.addEventListener("click", () => this.host.planeMenu(this.where.getBoundingClientRect()));
    this.done.addEventListener("click", () => this.host.done());
    this.what.addEventListener("click", () => this.host.options());
  }

  /**
   * Shows `p`; `options` says whether the tool has an options panel, which is
   * what makes the second part a button. Answers whether anything changed.
   */
  show(p: ChipParts, options: boolean): boolean {
    const key = JSON.stringify([p, options]);
    if (key === this.shown) return false;
    this.shown = key;
    const plane = this.where.parentElement!;
    plane.hidden = p.where === null;
    this.where.textContent = p.where ?? "";
    this.what.textContent = p.what;
    this.what.disabled = !options;
    this.next.textContent = p.next ?? "";
    this.next.classList.toggle("guide", p.guiding);
    // The separator before an empty next would point at nothing.
    (this.next.previousElementSibling as HTMLElement).hidden = !p.next;
    this.el.dataset.where = p.where ?? "";
    this.el.dataset.what = p.what;
    this.el.dataset.next = p.next ?? "";
    this.el.dataset.guiding = p.guiding ? "true" : "false";
    return true;
  }

  /**
   * **The verdict is never cut for the chip** (docs/plans/mode-feedback.md):
   * the corner is clipped to the room the panes leave it (everything-fits.md),
   * and on a phone held upright the chip's two lines can push the verdict past
   * it. So while anything after the chip that is showing — the verdict, the
   * diagnosis, a note — would be clipped, the chip gives way in order: its
   * next step first (`tight`), then the tool's name (`tighter`). Where, and
   * Done, stay. `clipped` asks the page whether something showing is cut —
   * and a verdict still fading out is showing: the chip waits for the fade's
   * end before it takes the line back (docs/plans/touch-density.md).
   */
  fit(clipped: () => boolean): void {
    this.el.classList.remove("tight", "tighter");
    if (!clipped()) return;
    this.el.classList.add("tight");
    if (clipped()) this.el.classList.add("tighter");
  }

  /** How much of the chip is given way: 0 all of it shown, 1 the next step hidden, 2 the tool's name too. */
  get yielded(): number {
    return this.el.classList.contains("tighter") ? 2 : this.el.classList.contains("tight") ? 1 : 0;
  }
}
