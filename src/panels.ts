// The app's chrome as floating panels over a full-window canvas: a small panel
// manager, and the toolbar that is the first panel built for it.
//
// A panel is a DOM box with a title strip to drag by and a corner grip to
// resize by. Every piece of chrome — the toolbar, the log, the command line — is
// one, and the canvas underneath is the whole of the area below the header,
// which nothing reflows any more. The header is the one fixed thing: it is the
// app's title bar, carrying the solve status (and, in the single-file build, the
// buildstamp), and a title bar that could be dragged away would leave nowhere to
// read either.
//
// **Layout is per-viewer state, not model state.** Where a viewer has put their
// log is a fact about their screen, not about the drawing: it is not journalled,
// not in a saved file, not an undo step, and two people opening the same file
// see their own arrangements. It lives in `localStorage` — wrapped, because a
// private window or a sandboxed frame throws on the very first touch, and a
// storage failure must cost the viewer their arrangement and nothing else.
//
// The split follows menu.ts's: the geometry — what a drag or a resize does to a
// rectangle, what keeps a panel reachable, what a stored layout parses to — is
// pure functions over plain numbers, tested without a DOM. The DOM half is thin
// on purpose.
//
// This file imports nothing from the model or the tools. The toolbar is given
// its tool names and its armed tool by its host, and hands back a command
// string, so it can no more reach the model than the context menu can.

export interface Rect { x: number; y: number; w: number; h: number }
export interface Size { w: number; h: number }

/** Rectangles by panel id. A panel absent from it is where the defaults put it. */
export type Layout = Record<string, Rect>;

/**
 * The title strip's height, in pixels — just tall enough to grab, in the hover
 * tag's proportions. Shared with the stylesheet by being set on each strip
 * from here, so the clamp below and the strip on screen cannot disagree.
 */
export const TITLE_H = 16;

/**
 * How much of a panel's title strip always stays on screen sideways. Enough to
 * get a pointer on and drag back; a panel may otherwise be parked mostly off an
 * edge, which is a legitimate thing to want to do with a log you are not
 * reading.
 */
export const KEEP = 40;

function clamp(v: number, lo: number, hi: number): number {
  return Math.min(Math.max(v, lo), Math.max(lo, hi));
}

/**
 * The rectangle a panel is actually shown at, given the one wanted for it.
 *
 * Its size is held between its minimum and the area; its title strip is held
 * reachable — wholly inside top-to-bottom, at least `KEEP` pixels of it inside
 * side-to-side. Nothing else is promised: a panel may overlap another, or sit
 * partly off an edge. The one thing that cannot happen is a panel lost where
 * no pointer can reach the strip that moves it.
 */
export function constrain(r: Rect, area: Size, min: Size): Rect {
  const w = clamp(r.w, min.w, area.w);
  const h = clamp(r.h, min.h, area.h);
  const keep = Math.min(KEEP, w);
  return {
    x: clamp(r.x, keep - w, area.w - keep),
    y: clamp(r.y, 0, area.h - TITLE_H),
    w,
    h,
  };
}

/** Where a drag by (dx, dy) from `start` puts a panel. */
export function moved(start: Rect, dx: number, dy: number, area: Size, min: Size): Rect {
  return constrain({ ...start, x: start.x + dx, y: start.y + dy }, area, min);
}

/**
 * The size a resize by (dx, dy) from `start` gives a panel: the grip follows
 * the pointer, no smaller than the minimum and no further than the area's far
 * edges — a grip dragged off the window would be a corner the viewer can no
 * longer see, let alone grab again.
 */
export function resized(start: Rect, dx: number, dy: number, area: Size, min: Size): Rect {
  const w = clamp(start.w + dx, min.w, area.w - Math.max(0, start.x));
  const h = clamp(start.h + dy, min.h, area.h - Math.max(0, start.y));
  return constrain({ ...start, w, h }, area, min);
}

/** Margin between a default panel and the area's edge, and between panels. */
const GAP = 8;
/** A toolbar button's height, including its 2px of spacing. */
export const BUTTON_H = 22;
/** The toolbar's default width: the longest built-in name plus its padding. */
const TOOLBAR_W = 96;
/** The command-line panel's default height: its strip and one row of input. */
const CMD_H = TITLE_H + 28;
const LOG_H = 150;
const BOTTOM_W = 560;

/**
 * Where each panel goes on a fresh screen, for an area of `area` and a toolbar
 * holding `tools` buttons.
 *
 * The toolbar is a strip on the left, tall enough for every button it has right
 * now. The log is bottom-left and wide, and the command line sits under it at
 * the bottom edge — together where they always were, but each its own panel, so
 * a viewer who wants the input top-centre can put just the input there. The
 * bottom pair is anchored to the area's bottom edge, so an untouched layout
 * follows the window as it is resized.
 */
export function defaultLayout(area: Size, tools: number): Layout {
  const w = Math.min(BOTTOM_W, area.w - 2 * GAP);
  const cmdY = area.h - GAP - CMD_H;
  return {
    toolbar: { x: GAP, y: GAP, w: TOOLBAR_W, h: TITLE_H + 6 + tools * BUTTON_H },
    log: { x: GAP, y: cmdY - GAP / 2 - LOG_H, w, h: LOG_H },
    cmd: { x: GAP, y: cmdY, w, h: CMD_H },
  };
}

/** The part of `Storage` this file uses — narrow, so a test can hand in a fake. */
export interface StorageLike {
  getItem(key: string): string | null;
  setItem(key: string, value: string): void;
  removeItem(key: string): void;
}

/**
 * Where the layout is stored. Versioned in the key rather than in the value: a
 * future layout that means something different reads as "nothing stored" here,
 * which is the defaults — the one answer that is never wrong.
 */
export const STORAGE_KEY = "neocad.panels.v1";

function isRect(v: unknown): v is Rect {
  if (!v || typeof v !== "object") return false;
  const r = v as Record<string, unknown>;
  return ["x", "y", "w", "h"].every((k) => typeof r[k] === "number" && Number.isFinite(r[k]));
}

/**
 * A stored layout, read leniently: any panel whose entry is not a well-formed
 * rectangle is dropped — and so goes back to its default — rather than failing
 * the whole read. Text that is not JSON at all is an empty layout. Somebody
 * else's code shares this origin's storage in some hosts; nothing in it can be
 * trusted to be ours.
 */
export function parseLayout(text: string | null): Layout {
  if (!text) return {};
  let raw: unknown;
  try {
    raw = JSON.parse(text);
  } catch {
    return {};
  }
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) return {};
  const out: Layout = {};
  for (const [id, r] of Object.entries(raw as Record<string, unknown>)) {
    if (isRect(r)) out[id] = { x: r.x, y: r.y, w: r.w, h: r.h };
  }
  return out;
}

/**
 * The stored layout, or an empty one when there is none or storage cannot be
 * read. Never throws: a private window's `SecurityError` is the viewer's
 * defaults, not a broken app.
 */
export function loadLayout(storage: StorageLike | null): Layout {
  if (!storage) return {};
  try {
    return parseLayout(storage.getItem(STORAGE_KEY));
  } catch {
    return {};
  }
}

/**
 * Stores a layout; an empty one removes the key, so a reset leaves nothing
 * behind. Returns whether it was stored. Never throws — a full or forbidden
 * storage means the arrangement lasts until reload, which is all it can mean.
 */
export function saveLayout(storage: StorageLike | null, layout: Layout): boolean {
  if (!storage) return false;
  try {
    if (Object.keys(layout).length === 0) storage.removeItem(STORAGE_KEY);
    else storage.setItem(STORAGE_KEY, JSON.stringify(layout));
    return true;
  } catch {
    return false;
  }
}

/**
 * The page's `localStorage`, or null. Even *reading the property* throws in
 * some sandboxes, which is why this is a function with a catch round it rather
 * than a bare `window.localStorage` at the call site.
 */
export function browserStorage(): StorageLike | null {
  try {
    return globalThis.localStorage ?? null;
  } catch {
    return null;
  }
}

/** What `layout()` says: each panel's rectangle as it stands, and whether it was moved. */
export function describeLayout(shown: Layout, stored: Layout): string {
  return Object.entries(shown).map(([id, r]) =>
    `${id.padEnd(8)} ${Math.round(r.x)},${Math.round(r.y)}  ${Math.round(r.w)}x${Math.round(r.h)}` +
    (id in stored ? "" : "  (default)"),
  ).join("\n");
}

// ---- the DOM half -----------------------------------------------------------

/** What each panel will not shrink below. The toolbar's is one button. */
const MIN: Record<string, Size> = {
  toolbar: { w: 64, h: TITLE_H + 6 + BUTTON_H },
  log: { w: 160, h: TITLE_H + 30 },
  cmd: { w: 160, h: CMD_H },
};
const DEFAULT_MIN: Size = { w: 80, h: TITLE_H + 20 };
/** The lowest panel's z-index; index.html puts the hover tag and menu well above any stack. */
const PANEL_Z = 10;

/**
 * Every `.panel[data-panel]` inside an area, placed, draggable and resizable.
 *
 * Holds two layouts and keeps them apart deliberately. `stored` is what the
 * viewer *asked for* — only the panels they have touched, as they left them —
 * and is what persists. What is on screen is that, or the default for an
 * untouched panel, passed through `constrain` against the area as it is now.
 * So shrinking the window pulls panels in without forgetting where they were
 * put, and widening it again puts them back.
 */
export class Panels {
  private area: HTMLElement;
  private storage: StorageLike | null;
  private defaults: (area: Size) => Layout;
  private stored: Layout;
  private els = new Map<string, HTMLElement>();
  /** Where each panel is on screen right now — what a gesture starts from. */
  private shown: Layout = {};
  /** Back to front. The panel last pressed is drawn over the others. */
  private order: string[] = [];

  constructor(area: HTMLElement, defaults: (area: Size) => Layout, storage: StorageLike | null) {
    this.area = area;
    this.defaults = defaults;
    this.storage = storage;
    this.stored = loadLayout(storage);
    for (const el of Array.from(area.querySelectorAll<HTMLElement>(".panel[data-panel]"))) {
      const id = el.dataset.panel!;
      this.els.set(id, el);
      this.order.push(id);
      this.wire(id, el);
    }
    this.restack();
    new ResizeObserver(() => this.apply()).observe(area);
    this.apply();
  }

  private size(): Size {
    return { w: this.area.clientWidth, h: this.area.clientHeight };
  }

  private min(id: string): Size {
    return MIN[id] ?? DEFAULT_MIN;
  }

  /** Puts every panel where the layouts say. Cheap; call it whenever a default may have changed. */
  apply(): void {
    const area = this.size();
    const defaults = this.defaults(area);
    for (const [id, el] of this.els) {
      const want = this.stored[id] ?? defaults[id] ?? { x: GAP, y: GAP, w: 200, h: 120 };
      this.place(id, el, constrain(want, area, this.min(id)));
    }
  }

  private place(id: string, el: HTMLElement, r: Rect): void {
    this.shown[id] = r;
    el.style.left = `${r.x}px`;
    el.style.top = `${r.y}px`;
    el.style.width = `${r.w}px`;
    el.style.height = `${r.h}px`;
  }

  private raise(id: string): void {
    if (this.order[this.order.length - 1] === id) return;
    this.order = [...this.order.filter((o) => o !== id), id];
    this.restack();
  }

  /**
   * Panels stack from `PANEL_Z` up, one apiece — below the hover tag and the
   * context menu, which are transient and belong over everything.
   */
  private restack(): void {
    this.order.forEach((id, i) => { this.els.get(id)!.style.zIndex = String(PANEL_Z + i); });
  }

  /** Forgets every arrangement — this viewer's, in this browser — and goes back to the defaults. */
  reset(): string {
    this.stored = {};
    saveLayout(this.storage, this.stored);
    this.apply();
    return "layout reset to the defaults";
  }

  report(): string {
    return describeLayout(this.shown, this.stored);
  }

  /**
   * The two gestures: drag by the strip, resize by the grip. Both capture the
   * pointer on the element pressed, so every move and the release come back
   * here wherever the pointer wanders — over the canvas included, which never
   * hears about it. That, and the canvas capturing its own presses (see
   * main.ts), is the whole of "panel gestures and canvas gestures never cross".
   */
  private wire(id: string, el: HTMLElement): void {
    // Raised by a press anywhere on it, in the capture phase so a button or the
    // input inside it raises it too. By z-index rather than by moving it to the
    // end of its parent: moving an element that holds the focus blurs it, and
    // the command line is nearly always the element that holds the focus.
    el.addEventListener("pointerdown", () => this.raise(id), true);
    const strip = el.querySelector<HTMLElement>(":scope > .ptitle");
    const grip = el.querySelector<HTMLElement>(":scope > .pgrip");
    if (strip) {
      strip.style.height = `${TITLE_H}px`;
      this.gesture(id, strip, moved);
    }
    if (grip) this.gesture(id, grip, resized);
    // The browser's own menu is not wanted on chrome that has no text to copy;
    // it is left alone on the log and the input, which do.
    for (const part of [strip, grip]) part?.addEventListener("contextmenu", (e) => e.preventDefault());
  }

  private gesture(id: string, handle: HTMLElement, apply: typeof moved): void {
    // `mousedown`, not `pointerdown`, is the event whose default moves focus and
    // starts a text selection. Prevented, a drag leaves the command line holding
    // the focus it had, so typing after rearranging still types.
    handle.addEventListener("mousedown", (e) => e.preventDefault());
    handle.addEventListener("pointerdown", (e) => {
      if (e.button !== 0) return;
      e.preventDefault();
      const el = this.els.get(id)!;
      const start = this.shown[id];
      const [x0, y0] = [e.clientX, e.clientY];
      handle.setPointerCapture(e.pointerId);
      el.classList.add("held");
      const move = (ev: PointerEvent) => {
        if (ev.pointerId !== e.pointerId) return;
        this.place(id, el, apply(start, ev.clientX - x0, ev.clientY - y0, this.size(), this.min(id)));
      };
      const end = (ev: PointerEvent) => {
        if (ev.pointerId !== e.pointerId) return;
        handle.removeEventListener("pointermove", move);
        handle.removeEventListener("pointerup", end);
        handle.removeEventListener("pointercancel", end);
        el.classList.remove("held");
        // A press that never moved is not an arrangement; storing it would turn
        // an untouched panel's following-the-defaults into a fixed position.
        const now = this.shown[id];
        if (now.x === start.x && now.y === start.y && now.w === start.w && now.h === start.h) return;
        this.stored[id] = now;
        saveLayout(this.storage, this.stored);
      };
      handle.addEventListener("pointermove", move);
      handle.addEventListener("pointerup", end);
      handle.addEventListener("pointercancel", end);
    });
  }
}

// ---- the toolbar ------------------------------------------------------------

/** The command a tool's button types. Quoted as JSON, as the menu quotes names. */
export function armCommand(tool: string): string {
  return `arm(${JSON.stringify(tool)})`;
}

/** What the toolbar needs of its host. */
export interface ToolbarHost {
  /** Every registered tool, in registration order — `listTools()`. */
  tools(): string[];
  /** The armed tool's name, or null. */
  active(): string | null;
  /** Types one line into the command machinery, as one user action — `submit`. */
  run(command: string): void;
}

/**
 * One button per registered tool, built from the registry when asked rather
 * than from a list kept here — so a tool defined at the command line gets a
 * button exactly as a built-in has one. Nothing in the registry announces a new
 * tool, so the host calls `sync` whenever one might have appeared or the armed
 * tool might have changed; it does DOM work only when something did.
 *
 * **A button types `arm("name")`** through the host's `run`, the context menu's
 * seam, so the log shows what the button did and a user learns the command by
 * clicking. The label is the tool's name, which is what the command line calls
 * it — an icon would be a second vocabulary for the same thing — and the hover
 * text is the command itself.
 */
export class Toolbar {
  private el: HTMLElement;
  private host: ToolbarHost;
  private names = "";
  private armed: string | null = null;

  constructor(el: HTMLElement, host: ToolbarHost) {
    this.el = el;
    this.host = host;
  }

  /** Rebuilds if the tool list changed and re-marks the armed button. Returns whether the list changed. */
  sync(): boolean {
    const tools = this.host.tools();
    const key = tools.join("\n");
    const rebuilt = key !== this.names;
    if (rebuilt) {
      this.names = key;
      this.el.textContent = "";
      for (const tool of tools) this.el.appendChild(this.button(tool));
      this.armed = null; // the new buttons carry no state; mark them below
    }
    const active = this.host.active();
    if (rebuilt || active !== this.armed) {
      this.armed = active;
      for (const b of Array.from(this.el.querySelectorAll<HTMLButtonElement>("button"))) {
        b.setAttribute("aria-pressed", String(b.dataset.tool === active));
      }
    }
    return rebuilt;
  }

  private button(tool: string): HTMLButtonElement {
    const b = document.createElement("button");
    b.type = "button";
    b.textContent = tool;
    b.dataset.tool = tool;
    b.title = armCommand(tool);
    b.setAttribute("aria-pressed", "false");
    // Keeps the focus where it was — the command line — so a click on a button
    // is not followed by Enter or Space re-pressing it instead of submitting.
    b.addEventListener("mousedown", (e) => e.preventDefault());
    b.addEventListener("contextmenu", (e) => e.preventDefault());
    b.addEventListener("click", () => this.host.run(armCommand(tool)));
    return b;
  }
}
