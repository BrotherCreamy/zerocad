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
// rectangle, what keeps a panel inside the area, which way a tray runs against
// the edges it meets, what a stored layout parses to — is pure functions over
// plain numbers, tested without a DOM. The DOM half is thin on purpose.
//
// This file imports nothing from the model or the tools. The toolbar is given
// its tool names, their glyphs, its armed tool and which tools cannot run by
// its host, and hands back a command string, so it can no more reach the model
// than the context menu can.

export interface Rect { x: number; y: number; w: number; h: number }
export interface Size { w: number; h: number }

/**
 * Which way a tray runs. A tray is a panel of buttons — the toolbar is the one
 * there is — and it is the one kind of panel that turns: the log and the
 * command line keep their shape wherever they are put.
 */
export type Orientation = "column" | "row";

/** A panel's rectangle, and for a tray the way it runs. */
export interface Placed extends Rect { orient?: Orientation }

/** Placements by panel id. A panel absent from it is where the defaults put it. */
export type Layout = Record<string, Placed>;

/**
 * The title strip's height, in pixels — just tall enough to grab, in the hover
 * tag's proportions. Shared with the stylesheet by being set on each strip
 * from here, so the clamp below and the strip on screen cannot disagree. A
 * row's strip runs down its left end instead, this wide.
 */
export const TITLE_H = 16;

function clamp(v: number, lo: number, hi: number): number {
  return Math.min(Math.max(v, lo), Math.max(lo, hi));
}

/**
 * The rectangle a panel is actually shown at, given the one wanted for it.
 *
 * Its size is held between its minimum and the area, and **the whole of it is
 * held inside the area** (the owner: *"they should stay fully within the
 * viewport borders"*). A panel may overlap another; it may not hang off an
 * edge, by any amount. Only a panel whose minimum is bigger than the area can
 * spill, and then off the right and bottom only, its strip at the top-left
 * where a pointer can still take it.
 */
export function constrain(r: Rect, area: Size, min: Size): Rect {
  const w = clamp(r.w, min.w, area.w);
  const h = clamp(r.h, min.h, area.h);
  return { x: clamp(r.x, 0, area.w - w), y: clamp(r.y, 0, area.h - h), w, h };
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

// ---- trays: turning with the edge they meet ---------------------------------

/** A tray button's side, square: a 16px glyph in a 1px border and 1px of room. */
export const BUTTON = 20;
/** One button's share of a tray's length: its side and the 2px gap after it. */
export const BUTTON_STEP = BUTTON + 2;
/** A tray's thickness across its run: a button, 3px padding each side, the border. */
export const TRAY_DEPTH = BUTTON + 6 + 2;

/**
 * The size of a tray of `buttons` buttons running `orient`: one button thick,
 * and along its run the strip, the padding and every button. A column's strip
 * is across its top; a row's down its left end — so that a row is one button
 * high, which is what makes it a row against a top or bottom edge rather than
 * a short column lying down.
 */
export function traySize(buttons: number, orient: Orientation): Size {
  const run = TITLE_H + 6 + buttons * BUTTON_STEP;
  return orient === "column" ? { w: TRAY_DEPTH, h: run } : { w: run, h: TRAY_DEPTH };
}

/**
 * How near, in pixels, a tray's edge must come to an edge for the tray to be
 * against it. Less than the default layout's 8px margin on purpose: a panel the
 * defaults put down is a margin off every edge, and dragging the untouched
 * toolbar sideways must not turn it on the way.
 */
export const SNAP = 6;

/** Which of a tray's four edges are against something. */
export interface Contacts { top: boolean; bottom: boolean; left: boolean; right: boolean }

/** The length two spans share; positive only when they genuinely overlap. */
function overlap(a0: number, a1: number, b0: number, b1: number): number {
  return Math.min(a1, b1) - Math.max(a0, b0);
}

/**
 * Which edges of `r` are against the area's edges, or against the facing edge
 * of a panel in `others` it is *beside*: within `snap` of that edge, and the
 * two overlapping along it. Facing, because a tray pushed up against the log's
 * top is the tray's bottom against the log's top; a tray lying over the log is
 * against nothing of it. Overlapping, because a panel off to one side shares
 * an edge's line without sharing the edge.
 */
export function contacts(r: Rect, area: Size, others: readonly Rect[], snap: number): Contacts {
  const near = (a: number, b: number) => Math.abs(a - b) <= snap;
  const alongX = (o: Rect) => overlap(r.x, r.x + r.w, o.x, o.x + o.w) > 0;
  const alongY = (o: Rect) => overlap(r.y, r.y + r.h, o.y, o.y + o.h) > 0;
  return {
    top: r.y <= snap || others.some((o) => alongX(o) && near(r.y, o.y + o.h)),
    bottom: area.h - (r.y + r.h) <= snap || others.some((o) => alongX(o) && near(r.y + r.h, o.y)),
    left: r.x <= snap || others.some((o) => alongY(o) && near(r.x, o.x + o.w)),
    right: area.w - (r.x + r.w) <= snap || others.some((o) => alongY(o) && near(r.x + r.w, o.x)),
  };
}

/**
 * The way a tray at `r` should run (the owner: *"when I push a vertical
 * tooltray against a top or bottom edge, it should become horizontal etc and
 * vice versa. that includes pushing it up against a vertical/horizontal edge
 * of another tooltray"*). Against a horizontal edge — the area's top or
 * bottom, another panel's top or bottom — a row; against a vertical one, a
 * column. Against both, a corner, and nothing says which: it stays as it is.
 * Against nothing, likewise — a tray only turns when pushed.
 */
export function orientationFor(
  r: Rect, current: Orientation, area: Size, others: readonly Rect[], snap: number = SNAP,
): Orientation {
  const c = contacts(r, area, others, snap);
  const across = c.top || c.bottom;
  const upright = c.left || c.right;
  if (across && !upright) return "row";
  if (upright && !across) return "column";
  return current;
}

/**
 * One step of dragging a tray: `r` is where the drag has put it, running
 * `current`. If it now meets an edge that turns it, it takes the size its
 * content has the other way (`content`) and **keeps the edge it is against** —
 * a column pushed down onto the bottom edge becomes a row along that edge, not
 * a row floating where the column's top was — then is held inside the area.
 * Otherwise `r` comes back untouched.
 *
 * Content bigger than the area is shrunk to it and scrolls, as any panel is.
 */
export function turned(
  r: Rect, current: Orientation, area: Size, others: readonly Rect[],
  content: (o: Orientation) => Size, snap: number = SNAP,
): { rect: Rect; orient: Orientation } {
  const orient = orientationFor(r, current, area, others, snap);
  if (orient === current) return { rect: r, orient };
  const c = contacts(r, area, others, snap);
  const s = content(orient);
  // Turning into a row, the edge held is a horizontal one: the bottom if only
  // the bottom is against something, else the top. Into a column, likewise
  // the right or the left. The other axis keeps its near edge, which is where
  // the strip — and so the pointer — was.
  const x = orient === "column" && c.right && !c.left ? r.x + r.w - s.w : r.x;
  const y = orient === "row" && c.bottom && !c.top ? r.y + r.h - s.h : r.y;
  return { rect: constrain({ x, y, w: s.w, h: s.h }, area, { w: 0, h: 0 }), orient };
}

// ---- the default layout -----------------------------------------------------

/** Margin between a default panel and the area's edge, and between panels. */
const GAP = 8;
/** The command-line panel's default height: its strip and one row of input. */
const CMD_H = TITLE_H + 28;
const LOG_H = 150;
const BOTTOM_W = 560;

/**
 * Where each panel goes on a fresh screen, for an area of `area` and a toolbar
 * holding `tools` buttons.
 *
 * The toolbar is a column on the left, tall enough for every button it has
 * right now. The log is bottom-left and wide, and the command line sits under
 * it at the bottom edge — together where they always were, but each its own
 * panel, so a viewer who wants the input top-centre can put just the input
 * there. The bottom pair is anchored to the area's bottom edge, so an
 * untouched layout follows the window as it is resized.
 */
export function defaultLayout(area: Size, tools: number): Layout {
  const w = Math.min(BOTTOM_W, area.w - 2 * GAP);
  const cmdY = area.h - GAP - CMD_H;
  return {
    toolbar: { x: GAP, y: GAP, ...traySize(tools, "column"), orient: "column" },
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
 * layout that means something different reads as "nothing stored" here, which
 * is the defaults — the one answer that is never wrong. v2 is v1 with a tray's
 * orientation and every panel wholly inside; a v1 layout is simply not read,
 * which costs a viewer one arrangement of their own screen and nothing else.
 */
export const STORAGE_KEY = "neocad.panels.v2";

function isRect(v: unknown): v is Rect {
  if (!v || typeof v !== "object") return false;
  const r = v as Record<string, unknown>;
  return ["x", "y", "w", "h"].every((k) => typeof r[k] === "number" && Number.isFinite(r[k]));
}

/**
 * A stored layout, read leniently: any panel whose entry is not a well-formed
 * rectangle is dropped — and so goes back to its default — rather than failing
 * the whole read, and an orientation that is not one is dropped alone. Text that is not JSON at all is an empty layout. Somebody
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
    if (!isRect(r)) continue;
    const orient = (r as { orient?: unknown }).orient;
    out[id] = { x: r.x, y: r.y, w: r.w, h: r.h, ...(orient === "row" || orient === "column" ? { orient } : {}) };
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

/**
 * What `layout()` says: each panel's rectangle as it stands, a tray's way of
 * running, and whether it was moved.
 */
export function describeLayout(shown: Layout, stored: Layout): string {
  return Object.entries(shown).map(([id, r]) =>
    `${id.padEnd(8)} ${Math.round(r.x)},${Math.round(r.y)}  ${Math.round(r.w)}x${Math.round(r.h)}` +
    (r.orient ? `  ${r.orient}` : "") + (id in stored ? "" : "  (default)"),
  ).join("\n");
}

// ---- the DOM half -----------------------------------------------------------

/** What each panel will not shrink below. A tray's is one button, either way it runs. */
const MIN: Record<string, Size> = {
  log: { w: 160, h: TITLE_H + 30 },
  cmd: { w: 160, h: CMD_H },
};
const DEFAULT_MIN: Size = { w: 80, h: TITLE_H + 20 };
/** The lowest panel's z-index; index.html puts the hover tag and menu well above any stack. */
const PANEL_Z = 10;

/** `r` running `orient` — or, for a panel that is not a tray, just `r`. */
function placed(r: Rect, orient: Orientation | undefined): Placed {
  return orient ? { x: r.x, y: r.y, w: r.w, h: r.h, orient } : { x: r.x, y: r.y, w: r.w, h: r.h };
}

/**
 * Every `.panel[data-panel]` inside an area, placed, draggable and resizable.
 *
 * Holds two layouts and keeps them apart deliberately. `stored` is what the
 * viewer *asked for* — only the panels they have touched, as they left them —
 * and is what persists. What is on screen is that, or the default for an
 * untouched panel, passed through `constrain` against the area as it is now.
 * So shrinking the window pulls panels in without forgetting where they were
 * put, and widening it again puts them back.
 *
 * `trays` names the panels that are trays, each with how many buttons it holds
 * right now: those, and only those, turn between column and row as they are
 * dragged against an edge (`turned`), and size to their buttons when they do.
 */
export class Panels {
  private area: HTMLElement;
  private storage: StorageLike | null;
  private defaults: (area: Size) => Layout;
  private trays: Record<string, () => number>;
  private stored: Layout;
  private els = new Map<string, HTMLElement>();
  /** Where each panel is on screen right now — what a gesture starts from. */
  private shown: Layout = {};
  /** Back to front. The panel last pressed is drawn over the others. */
  private order: string[] = [];

  constructor(
    area: HTMLElement, defaults: (area: Size) => Layout, storage: StorageLike | null,
    trays: Record<string, () => number> = {},
  ) {
    this.area = area;
    this.defaults = defaults;
    this.storage = storage;
    this.trays = trays;
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

  private min(id: string, orient: Orientation | undefined): Size {
    if (id in this.trays) return traySize(1, orient ?? "column");
    return MIN[id] ?? DEFAULT_MIN;
  }

  /** Puts every panel where the layouts say. Cheap; call it whenever a default may have changed. */
  apply(): void {
    const area = this.size();
    const defaults = this.defaults(area);
    for (const [id, el] of this.els) {
      const want = this.stored[id] ?? defaults[id] ?? { x: GAP, y: GAP, w: 200, h: 120 };
      // A tray always runs some way; one with nothing stored or defaulted runs
      // the default's way, which is down.
      const orient = id in this.trays ? want.orient ?? "column" : undefined;
      this.place(id, el, placed(constrain(want, area, this.min(id, orient)), orient));
    }
  }

  private place(id: string, el: HTMLElement, r: Placed): void {
    this.shown[id] = r;
    el.style.left = `${r.x}px`;
    el.style.top = `${r.y}px`;
    el.style.width = `${r.w}px`;
    el.style.height = `${r.h}px`;
    if (r.orient && el.dataset.orient !== r.orient) {
      // The stylesheet turns the body and moves the strip on this attribute;
      // the strip's thickness is set here, from TITLE_H, as for every strip.
      el.dataset.orient = r.orient;
      const strip = el.querySelector<HTMLElement>(":scope > .ptitle");
      if (strip) {
        strip.style.height = r.orient === "column" ? `${TITLE_H}px` : "";
        strip.style.width = r.orient === "row" ? `${TITLE_H}px` : "";
      }
    }
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
      // A tray's strip is sized by `place`, which knows which way it runs.
      if (!(id in this.trays)) strip.style.height = `${TITLE_H}px`;
      this.gesture(id, strip, "move");
    }
    if (grip) this.gesture(id, grip, "resize");
    // The browser's own menu is not wanted on chrome that has no text to copy;
    // it is left alone on the log and the input, which do.
    for (const part of [strip, grip]) part?.addEventListener("contextmenu", (e) => e.preventDefault());
  }

  private gesture(id: string, handle: HTMLElement, kind: "move" | "resize"): void {
    // `mousedown`, not `pointerdown`, is the event whose default moves focus and
    // starts a text selection. Prevented, a drag leaves the command line holding
    // the focus it had, so typing after rearranging still types.
    handle.addEventListener("mousedown", (e) => e.preventDefault());
    handle.addEventListener("pointerdown", (e) => {
      if (e.button !== 0) return;
      e.preventDefault();
      const el = this.els.get(id)!;
      const start = this.shown[id];
      // What the drag is measured from. A tray that turns mid-drag is a new
      // shape under the pointer, so the drag starts again from where it turned:
      // measured from the press it would jump back to the old shape's anchor.
      let base = start;
      let [x0, y0] = [e.clientX, e.clientY];
      const count = this.trays[id];
      handle.setPointerCapture(e.pointerId);
      el.classList.add("held");
      const move = (ev: PointerEvent) => {
        if (ev.pointerId !== e.pointerId) return;
        const area = this.size();
        const [dx, dy] = [ev.clientX - x0, ev.clientY - y0];
        const min = this.min(id, base.orient);
        if (kind === "resize") {
          // A resized tray keeps the way it runs, and scrolls if made short.
          this.place(id, el, placed(resized(base, dx, dy, area, min), base.orient));
          return;
        }
        const r = moved(base, dx, dy, area, min);
        if (!count || !base.orient) {
          this.place(id, el, placed(r, base.orient));
          return;
        }
        // Live, on every move, so the viewer sees it turn as they push.
        const others = Array.from(this.els.keys()).filter((o) => o !== id).map((o) => this.shown[o]);
        const t = turned(r, base.orient, area, others, (o) => traySize(count(), o));
        if (t.orient !== base.orient) {
          base = placed(t.rect, t.orient);
          [x0, y0] = [ev.clientX, ev.clientY];
        }
        this.place(id, el, placed(t.rect, t.orient));
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
        if (now.x === start.x && now.y === start.y && now.w === start.w && now.h === start.h &&
            now.orient === start.orient) return;
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

/**
 * A button's hover text: the tool's name — the button shows only its glyph, so
 * this is where the name the command line calls it is read — then what the
 * button will do, or, for a tool that cannot run, why not.
 */
export function buttonTitle(tool: string, unavailable: string | null): string {
  return `${tool} — ${unavailable ?? armCommand(tool)}`;
}

/** What the toolbar needs of its host. */
export interface ToolbarHost {
  /** Every registered tool, in registration order — `listTools()`. */
  tools(): string[];
  /**
   * The tool's glyph, as an inline SVG string drawn in `currentColor`: a
   * built-in's own, any other tool's the generic one (`toolIcon`). Asked once
   * per button, when the buttons are built.
   */
  icon(tool: string): string;
  /** The armed tool's name, or null. */
  active(): string | null;
  /**
   * Why `tool` cannot run in the model as it stands, or null when it can —
   * the rule the context menu reads (`toolUnavailable`), so a button and a
   * menu item never disagree. Asked on every `sync`, so it must be cheap.
   */
  unavailable(tool: string): string | null;
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
 * clicking. **Its face is the tool's icon** (the owner: *"tools should be
 * icons"*) and its hover text is the name with the command after it, so the
 * vocabulary the command line uses is still one hover away and still what the
 * log shows; the name is the button's accessible name too.
 *
 * **A tool that cannot run is shown disabled, not hidden** — the menu's rule
 * and Fix's reason: a circle button that vanished when the frame did would
 * leave "where did circle go" unanswered, where a greyed one whose hover text
 * is the model's own reason answers it. A disabled button types nothing.
 */
export class Toolbar {
  private el: HTMLElement;
  private host: ToolbarHost;
  private names = "";
  private armed: string | null = null;
  /** Every tool's reason (or "") as last shown, joined — compared, not diffed. */
  private reasons = "";

  constructor(el: HTMLElement, host: ToolbarHost) {
    this.el = el;
    this.host = host;
  }

  /**
   * Rebuilds if the tool list changed, re-marks the armed button and re-reads
   * which tools cannot run. Returns whether the list changed.
   */
  sync(): boolean {
    const tools = this.host.tools();
    const key = tools.join("\n");
    const rebuilt = key !== this.names;
    if (rebuilt) {
      this.names = key;
      this.el.textContent = "";
      for (const tool of tools) this.el.appendChild(this.button(tool));
      this.armed = null; // the new buttons carry no state; mark them below
      this.reasons = "";
    }
    // Re-read on every call: availability follows the model (a frame made or
    // deleted), and nothing announces that either.
    const why = tools.map((t) => this.host.unavailable(t));
    const reasons = why.map((w) => w ?? "").join("\n");
    if (rebuilt || reasons !== this.reasons) {
      this.reasons = reasons;
      const buttons = Array.from(this.el.querySelectorAll<HTMLButtonElement>("button"));
      buttons.forEach((b, i) => {
        b.disabled = why[i] !== null;
        b.title = buttonTitle(tools[i], why[i]);
      });
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
    // The host's string, from a table of constants or built round the name
    // escaped; nothing a file or another viewer supplies reaches it.
    b.innerHTML = this.host.icon(tool);
    b.dataset.tool = tool;
    b.setAttribute("aria-label", tool);
    b.title = buttonTitle(tool, null);
    b.setAttribute("aria-pressed", "false");
    // Keeps the focus where it was — the command line — so a click on a button
    // is not followed by Enter or Space re-pressing it instead of submitting.
    b.addEventListener("mousedown", (e) => e.preventDefault());
    b.addEventListener("contextmenu", (e) => e.preventDefault());
    // The guard is for a click dispatched by script; a disabled button gets no
    // click from a pointer in the first place.
    b.addEventListener("click", () => { if (!b.disabled) this.host.run(armCommand(tool)); });
    return b;
  }
}
