// The app's chrome as floating panels over a full-window canvas: a small panel
// manager, and the toolbar that is the first panel built for it.
//
// A panel is a DOM box with a title strip to drag by and — unless its size is
// its content's: a tray, a line of its buttons (two where one will not fit), or the options panel,
// one row per option — a grip on each of its four corners to resize by. Every
// piece of chrome — the toolbar, the log, the command line, the armed tool's
// options — is one, and the canvas underneath is the whole window, which
// nothing reflows. There is no title bar (docs/plans/chrome-logo-scale.md): the
// one fixed thing is the logo in the top-left corner, which opens the app
// menu, and which is in the layout as a panel nothing can move — so a panel
// pushed into the corner stops against it, and the way into the menu is never
// under anything.
//
// The layout's area is the **safe area** — inside a phone's notch, status bar
// and home indicator — and a panel touching the bottom edge, where the home
// indicator or the gesture bar is, reaches under it, its content kept clear
// (`bleed`); at the sides and the top it is drawn where it is. A panel the viewer has moved is
// stored as **what it rests against** (`Docking`), not only where it is, so a
// rotation puts a panel docked to the right edge on the right edge again.
//
// **Layout is per-viewer state, not model state.** Where a viewer has put their
// log is a fact about their screen, not about the drawing: it is not journalled,
// not in a saved file, not an undo step, and two people opening the same file
// see their own arrangements. It lives in `localStorage` — wrapped, because a
// private window or a sandboxed frame throws on the very first touch, and a
// storage failure must cost the viewer their arrangement and nothing else.
//
// The split follows menu.ts's: the geometry — what a drag or a resize does to a
// rectangle, what keeps a panel inside the area, how panels push one another,
// which point of a held panel the hand keeps (the one it took — the owner:
// *"the grasp point should stay the same"*), which way a tray runs against the
// edges it meets, what a stored layout parses to, what a drag previews and
// what its drop commits — is pure functions over plain numbers, tested
// without a DOM. The DOM half is thin on purpose.
//
// **Nothing moves until the drop** (docs/plans/panels-preview.md): a drag
// moves only the panel in the hand, and draws a ghost where each panel the
// drop would move will land; the drop commits that, Escape nothing. **And a
// drag reshuffles, it does not push** (docs/plans/panels-reshuffle.md): the
// panes along an edge are a sequence, and a pane dragged past a neighbour
// takes its slot, brought to another edge goes in between two, dropped on a
// floating pane trades places with it. Only a resize and `apply` still push.
//
// This file imports nothing from the model or the tools. The toolbar is given
// its tool names, their glyphs and its armed tool by its host, and the options
// panel the armed tool's declared options and their values; each hands back a
// command string, so neither can reach the model any more than the context
// menu can, nor do anything a typed line could not. The tools' descriptions
// for their tooltips are handed in the same way (`ToolbarHost.summary`), and
// the tooltip itself (tooltip.ts) is handed in as a function to attach one.

import { HOLD_MS, HOLD_SLOP, HOVER_MS, WARM_MS, giveTip, type AttachTip, type Tip } from "./tooltip.ts";

export interface Rect { x: number; y: number; w: number; h: number }
export interface Size { w: number; h: number }
export interface Point { x: number; y: number }

/**
 * Below this, two panels touch rather than overlap. Pointer coordinates are
 * whole pixels in practice, but nothing promises it, and a push computed in
 * floating point must not read a shared edge as a sliver of overlap.
 */
const EPS = 1e-6;

/**
 * Margin between a default panel and the area's edge, and between panels —
 * and the gap a pane inserted into an edge's sequence is given where it has
 * to make room (docs/plans/panels-reshuffle.md).
 */
const GAP = 8;

/**
 * Which way a tray runs. A tray is a panel of buttons — the toolbar is the one
 * there is — and it is the one kind of panel that turns: the log and the
 * command line keep their shape wherever they are put.
 */
export type Orientation = "column" | "row";

/**
 * A panel's rectangle, and for a tray the way it runs. `fixed` marks the one
 * thing in a layout that nothing moves — the logo: a push that reaches it
 * stops flush against it, exactly as a push that reaches the area's edge does.
 *
 * `lines`, on a tray, is the fewest lines it asks for (absent: one). It is a
 * floor, not the count: a tray takes as many more as it needs to fit along the
 * area (`traySize`), so a floor of one is "one line wherever one fits". Only a
 * default asks for more — a landscape phone's, which leaves the right edge's
 * column its whole height (`touchLayout`) — and a tray moved by the viewer
 * keeps what it asked for until it turns, when it is a new shape and asks for
 * its fewest again.
 */
export interface Placed extends Rect { orient?: Orientation; fixed?: boolean; lines?: number }

/** Placements by panel id. A panel absent from it is where the defaults put it. */
export type Layout = Record<string, Placed>;

/**
 * The title strip's height, in pixels — just tall enough to grab, in the hover
 * tag's proportions. Shared with the stylesheet by being set on each strip
 * from here, so the clamp below and the strip on screen cannot disagree. A
 * row's strip runs down its left end instead, this wide.
 */
export const TITLE_H = 16;

/**
 * Every size the chrome is built from, in one value — so that a finger's
 * chrome is the mouse's with other numbers, and no rule below has two
 * versions. `FINE` is the mouse's at 100 %, what every exported constant here
 * is. A finger's is `touchMetrics`: **drawn at the interface size, hit at the
 * target** (docs/plans/chrome-logo-scale.md), and the target follows the size
 * too — 44 at the device's own 100 % (docs/plans/touch-density.md). The two
 * are apart on purpose — a finger's chrome used to be *drawn* at Apple's
 * 44 pt target, which is what the owner called huge; now a button is drawn at
 * the device's size and a press lands on it over the target however small it
 * is drawn. The stylesheet draws from the same numbers (the host sets them as
 * custom properties), so the two cannot disagree.
 */
export interface Metrics {
  /** A strip's thickness, drawn: across a panel's top, down a row tray's left end. */
  title: number;
  /** A tray button's side, drawn. */
  button: number;
  /** Between two tray buttons — under a finger, what makes their pitch a whole hit target. */
  gap: number;
  /** The glyph inside a tray button. */
  icon: number;
  /** A corner grip's side (grips draw nothing, so this is their hit size). */
  grip: number;
  /** The logo's mark, square. */
  logo: number;
  /** One option's row in the options panel. */
  optionRow: number;
  /** The options panel's width. */
  optionsW: number;
  /** The command line's one row of input, under its strip. */
  line: number;
  /** The log's least height under its strip: a line of it, or so. */
  logLine: number;
  /**
   * The least a control answers a press over, in each direction — the target
   * (`target`): 44 under a finger at the device's 100 %, following the
   * interface size from there, never under 32; 0 (its drawn box) under a mouse.
   */
  hit: number;
  /** Whether this is a finger's chrome — which also lays out a phone's defaults (`defaultLayout`). */
  coarse: boolean;
  /**
   * The interface size these were scaled by — the device's 100 % times the
   * viewer's multiplier (uiscale.ts); 1 for `FINE` itself. Carried so a size
   * the viewer set — a command line made taller — scales with the rest
   * (`relaid`).
   */
  scale: number;
  /**
   * The device's form factor (uiscale.ts's `formFactor`: 1 under a mouse, 1.3
   * on a phone, 1.15 on a tablet) — what `scale` is measured against when the
   * target is worked out, so that the target is 44 at the device's 100 % with
   * the default text size, and grows with a larger one as the type does. Not
   * the whole of `deviceScale`, which also has the person's text size in it:
   * measured against that, a person who chose larger text on their phone got
   * targets — and tray buttons — no larger than anyone's (docs/plans/
   * touch-density.md, As built).
   */
  base: number;
}

export const FINE: Metrics = {
  title: 16, button: 20, gap: 2, icon: 16, grip: 12, logo: 20, optionRow: 22, optionsW: 168, line: 28, logLine: 30,
  hit: 0, coarse: false, scale: 1, base: 1,
};

/**
 * Apple's minimum target, 44 pt — a CSS pixel is a point on an iPhone (and
 * Google's 48 dp is 44–48 CSS px on the Pixels in the table). What a finger's
 * controls are hit at **at the device's own 100 %**; from there the target
 * follows the interface size (`target`).
 */
export const TOUCH_TARGET = 44;

/**
 * The least a target may be, whatever the interface size: below about 32 CSS
 * px a fingertip — 8–10 mm across, 30–38 px on these screens — misses a
 * target more often than it hits it. Only the spin box's 60 % and 70 % reach
 * it (26 and 31 px unfloored).
 */
export const TARGET_FLOOR = 32;

/**
 * How much of its target a tray button is drawn under a finger: the tool
 * fills its target and the air between tools is what is left (the owner:
 * *"the white space between eg the tools on the tool palettes is a bit too
 * much"*). At a phone's 100 % that is 35 of 44, a 9 px gap where there were
 * 18. 0.75 and 0.85 were looked at, at 1× and 3× (docs/plans/touch-density.md,
 * As built).
 */
export const TRAY_SHARE = 0.8;

/** The glyph inside a finger's tray button, as a share of the button: a mouse's 16 in 20 would crowd its border at 35. */
export const ICON_SHARE = 0.75;

/**
 * **The target at `m`'s interface size**: 44 at the device's own 100 % (at the
 * default text size; a larger one grows it as it grows the type), in
 * proportion to the spin box from there (`scale / base`), never under
 * `TARGET_FLOOR` — 35 at 80 %, 57 at 130 %. The
 * owner, from his phone: *"the text resizes but the spacing between e.g menu
 * items and toolbar items barely changes"* — they were a literal 44.
 */
export function target(m: Pick<Metrics, "scale" | "base">): number {
  const k = m.base > 0 ? m.scale / m.base : 1;
  return Math.max(TARGET_FLOOR, Math.round(TOUCH_TARGET * (Number.isFinite(k) ? k : 1)));
}

/** The interface size is held to this, all factors multiplied: past it nothing fits the screen it is for. */
const SCALE_MIN = 0.4;
const SCALE_MAX = 3;

/**
 * `base` at interface size `s`: every size multiplied and rounded to the
 * pixel, so a strip and the row it is drawn in agree to the pixel; held to
 * [0.4, 3], and anything that is not a positive number taken as 1. The one
 * place a panel's arithmetic learns the size.
 */
export function scaledMetrics(base: Metrics, s: number): Metrics {
  const k = Number.isFinite(s) && s > 0 ? Math.min(SCALE_MAX, Math.max(SCALE_MIN, s)) : 1;
  const r = (v: number) => Math.round(v * k);
  return {
    title: r(base.title), button: r(base.button), gap: r(base.gap), icon: r(base.icon), grip: r(base.grip), logo: r(base.logo),
    optionRow: r(base.optionRow), optionsW: r(base.optionsW), line: r(base.line), logLine: r(base.logLine),
    hit: base.hit, coarse: base.coarse, scale: k, base: base.base,
  };
}

/**
 * A finger's metrics at interface size `s` on a device of form factor `base`
 * (a phone's is 1.3, a tablet's 1.15, uiscale.ts): the mouse's, scaled — and
 * then each control made to answer a press over the target (`target`: 44 at
 * `s` = `base`) without being drawn any bigger than it needs. A tray's
 * button is drawn at `TRAY_SHARE` of the target (of the target before its
 * floor, so a tray still shrinks at 60 %) and spaced so that its pitch along
 * the tray is a whole target (its hit box, index.html's `::before`, overhangs
 * its face across the tray too); an option's row and the command line's are a
 * target tall, their fields drawn at the size inside; a grip, which draws
 * nothing, is a target square.
 */
export function touchMetrics(s: number, base: number): Metrics {
  const m = scaledMetrics({ ...FINE, base: base > 0 && Number.isFinite(base) ? base : 1 }, s);
  const hit = target(m);
  const button = Math.max(m.button, Math.round(TRAY_SHARE * TOUCH_TARGET * (m.scale / m.base)));
  return {
    ...m,
    button,
    icon: Math.max(m.icon, Math.round(ICON_SHARE * button)),
    gap: Math.max(m.gap, hit - button),
    grip: hit,
    optionRow: Math.max(m.optionRow, hit),
    line: Math.max(m.line, hit),
    hit,
    coarse: true,
  };
}

/** A finger's metrics at a phone's 100 % — what the tests and the defaults' docs call a phone. */
export const COARSE: Metrics = touchMetrics(1.3, 1.3);

/**
 * The logo's box in the top-left corner of the area: the mark and a margin
 * round it — and never less than a target (`m.hit`), which is the one size
 * here the interface does not shrink below: the logo is the way into the menu
 * that changes the size, and it must stay easy to hit.
 */
export function logoBox(m: Metrics): Size {
  const side = Math.max(m.hit, m.logo + 2 * Math.round(6 * m.scale));
  return { w: side, h: side };
}

function clamp(v: number, lo: number, hi: number): number {
  return Math.min(Math.max(v, lo), Math.max(lo, hi));
}

/**
 * The room the corner has — the status, the step note, the open group and
 * *Update ready*, beside the logo (main.ts) — in `layout`, in the area's
 * coordinates: from the logo's right, along the logo's row, to the first
 * panel in that row, and down to the first panel under that stretch, each
 * short by a margin. The defaults leave the logo's row empty (`touchLayout`),
 * so there it is the whole row; a pane the viewer drags into the row stops
 * the corner's text short of it, wrapping, so **the corner never lies over a
 * pane** (docs/plans/everything-fits.md) — it used to sit over the command
 * line's strip in landscape.
 */
export function cornerRoom(layout: Layout, area: Size, logo: Size, margin = 4): Rect {
  const x0 = logo.w;
  const panes = Object.values(layout).filter((r) => !r.fixed);
  const inRow = panes.filter((r) => r.y < logo.h && r.x + r.w > x0);
  const x1 = Math.min(area.w, ...inRow.map((r) => r.x));
  const under = panes.filter((r) => r.x < x1 && r.x + r.w > x0);
  const y1 = Math.min(area.h, ...under.map((r) => r.y));
  return { x: x0, y: 0, w: Math.max(0, x1 - x0 - margin), h: Math.max(0, y1 - margin) };
}

/**
 * The rectangle a panel is actually shown at, given the one wanted for it.
 *
 * Its size is held between its minimum and the area, and **the whole of it is
 * held inside the area** (the owner: *"they should stay fully within the
 * viewport borders"*). It may not hang off an edge, by any amount — and what
 * it may not do to another panel is `pushed`'s business, below, which starts
 * from this. Only a panel whose minimum is bigger than the area can
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
 * A panel's corners, by the compass: the one a grip sits on, and so the one a
 * resize by that grip moves. The corner opposite is the one that stays put.
 */
export type Corner = "nw" | "ne" | "sw" | "se";
export const CORNERS: readonly Corner[] = ["nw", "ne", "sw", "se"];
const westward = (c: Corner) => c === "nw" || c === "sw";
const northward = (c: Corner) => c === "nw" || c === "ne";

/**
 * The corners a panel carries a grip on: all four, or for a panel sized by its
 * content none — a tray (the owner: *"actually get rid of resizing altogether
 * on the tool palette"*), whose size is its buttons' (`traySize`), and the
 * options panel, whose size is its rows' (`optionsSize`). A grip on either
 * would have nothing to set. A function rather than a check in the DOM half,
 * so that the rule is tested where the rest of the geometry is.
 */
export function gripCorners(fixedSize: boolean): readonly Corner[] {
  return fixedSize ? [] : CORNERS;
}

/** Where `corner` of `r` is. */
export function cornerOf(r: Rect, corner: Corner): Point {
  return { x: westward(corner) ? r.x : r.x + r.w, y: northward(corner) ? r.y : r.y + r.h };
}

/**
 * The rectangle a resize by (dx, dy) from `start` gives a panel held by its
 * `corner` grip (the owner: *"allow me to rescale the popup windows from any
 * corner"*): that corner follows the pointer, and with it its two edges, while
 * the corner opposite stays exactly where it was. No smaller than the minimum,
 * and no further than the area's edges on the corner's side — a grip dragged
 * off the window would be a corner the viewer can no longer see, let alone
 * grab again.
 */
export function resized(start: Rect, dx: number, dy: number, area: Size, min: Size, corner: Corner = "se"): Rect {
  // One axis at a time, the same rule each way: the moving edge goes no further
  // than the area's edge on its side, nor nearer the fixed edge than the minimum.
  const span = (p: number, len: number, d: number, room: number, least: number, near: boolean): [number, number] => {
    if (!near) return [p, clamp(len + d, least, room - Math.max(0, p))];
    const far = p + len;
    const to = clamp(p + d, 0, far - least);
    return [to, far - to];
  };
  const [x, w] = span(start.x, start.w, dx, area.w, min.w, westward(corner));
  const [y, h] = span(start.y, start.h, dy, area.h, min.h, northward(corner));
  return constrain({ x, y, w, h }, area, min);
}

// ---- trays: turning with the edge they meet ---------------------------------

/** A tray button's side, square: a 16px glyph in a 1px border and 1px of room. */
export const BUTTON = 20;
/** One button's share of a tray's length: its side and the 2px gap after it. */
export const BUTTON_STEP = BUTTON + 2;
/** A tray's thickness across its run: a button, 3px padding each side, the border. */
export const TRAY_DEPTH = BUTTON + 6 + 2;

/**
 * How many lines a tray of `buttons` running `orient` takes in `room` pixels
 * along its run: the fewest, from `least`, whose line fits — the owner, asked
 * whether a landscape phone's toolbar should wrap or fold: *"Second row....
 * everything has to fit"*. Never more than one line per button, so a room too
 * short even for one button's line is a line per button, clipped.
 */
export function trayLines(buttons: number, orient: Orientation, m: Metrics = FINE, room = Infinity, least = 1): number {
  const n = Math.max(1, buttons);
  const run = (per: number) => m.title + 6 + per * (m.button + m.gap);
  let lines = Math.min(n, Math.max(1, Math.round(least) || 1));
  while (lines < n && run(Math.ceil(n / lines)) > room) lines++;
  return lines;
}

/**
 * The size of a tray of `buttons` buttons running `orient` — and the one thing
 * that sizes a tray (the owner: *"its just a straight line that fits the number
 * of tools it has in it, and can either be vert or horiz"*). A line is one
 * button thick, and along its run the strip, the padding and every button. A
 * column's strip is across its top; a row's down its left end — so that a row
 * is one button high, which is what makes it a row against a top or bottom
 * edge rather than a short column lying down.
 *
 * **Where one line does not fit in `room`, a second** (and a third, if the
 * interface size makes even two too long): `trayLines`, from `least`. This
 * reverses tray-fixed-line.md's "one line, clipped" exactly where the line did
 * not fit (docs/plans/everything-fits.md). The buttons keep their order,
 * filling line by line — a column's first line top to bottom, then the next
 * to its right; a row's left to right, then the next below — and the lines
 * are a whole button pitch apart, so under a finger a button's 44 px hit box
 * meets the next line's without overlapping it, as it meets the next button's
 * along the line. It never scrolls and never hides a tool.
 *
 * Nothing the viewer does sets it beyond that: a tray has no grips
 * (`gripCorners`), a turn re-sizes it to this the other way, and a stored size
 * is never read (`arranged`). The room is the area's, less the logo's corner
 * (`trayRoom`), so a tray wraps only where the window is too short for it.
 */
export function traySize(buttons: number, orient: Orientation, m: Metrics = FINE, room = Infinity, least = 1): Size {
  const lines = trayLines(buttons, orient, m, room, least);
  const per = Math.ceil(Math.max(0, buttons) / lines);
  const run = m.title + 6 + per * (m.button + m.gap);
  const depth = m.button + 6 + 2 + (lines - 1) * (m.button + m.gap);
  return orient === "column" ? { w: depth, h: run } : { w: run, h: depth };
}

/**
 * The room a tray running `orient` has along its run in `area`: the area's
 * length that way less the logo's box and a margin — the logo holds the
 * top-left corner, so a line along the top or down the left must start past
 * it, and the same room everywhere keeps a tray's size a function of the area
 * alone, so a drag along an edge never wraps and unwraps it on the way.
 */
export function trayRoom(area: Size, orient: Orientation, m: Metrics = FINE): number {
  const logo = logoBox(m);
  return orient === "row" ? area.w - logo.w - GAP : area.h - logo.h - GAP;
}

/** How many lines a tray placed at `r` is showing — read off its depth, for `layout()` and the stylesheet. */
export function linesOf(r: Placed, m: Metrics = FINE): number {
  const depth = r.orient === "row" ? r.h : r.w;
  return Math.max(1, Math.round((depth - (m.button + 8)) / (m.button + m.gap)) + 1);
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
 * Content bigger than the area is shrunk to it, as any panel is, and the
 * buttons past the window's edge are clipped.
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

// ---- panels push one another ------------------------------------------------
//
// The owner: *"shouldn't be able to drag windows over other windows. they
// should collide and push one another around. not collide like physics, just
// push."* So two rules hold of every layout this file shows: **no two panels
// overlap**, and **the window's edge is the one immovable thing**. A panel that
// meets another moves it by exactly the amount that separates them, that one
// moves whatever it now meets, and nothing springs back, bounces or slides
// round a corner. A push that would put any panel of the chain outside the area
// cannot happen, and the panel doing the pushing stops flush against the chain.

type Axis = "x" | "y";

/** Whether two rectangles share any area — a shared edge is not overlap. */
function overlaps(a: Rect, b: Rect): boolean {
  return overlap(a.x, a.x + a.w, b.x, b.x + b.w) > EPS && overlap(a.y, a.y + a.h, b.y, b.y + b.h) > EPS;
}

/**
 * Every pair of panels in `layout` that overlap, as `[id, id]` — empty for a
 * layout that keeps the first rule. What the tests assert after every gesture,
 * and what the DOM half checks after every placement when asked to.
 */
export function overlapping(layout: Layout): [string, string][] {
  const ids = Object.keys(layout);
  const out: [string, string][] = [];
  for (let i = 0; i < ids.length; i++) {
    for (let j = i + 1; j < ids.length; j++) if (overlaps(layout[ids[i]], layout[ids[j]])) out.push([ids[i], ids[j]]);
  }
  return out;
}

const start = (r: Rect, a: Axis) => (a === "x" ? r.x : r.y);
const span = (r: Rect, a: Axis) => (a === "x" ? r.w : r.h);
const room = (s: Size, a: Axis) => (a === "x" ? s.w : s.h);
/** `r` with its interval along `a` replaced — the other axis untouched, which is "just push". */
function along(r: Placed, a: Axis, pos: number, len: number = span(r, a)): Placed {
  return a === "x" ? { ...r, x: pos, w: len } : { ...r, y: pos, h: len };
}

/**
 * The chain a panel `mover`, now where `layout` has it, pushes along `axis` in
 * direction `dir`: every panel it overlaps is put flush against its leading
 * edge, and so on from each panel moved. The mover itself is not moved, and
 * nothing is held inside the area here — that is the caller's question.
 *
 * Not breadth-first-never-revisit: a panel reached early by a short push can be
 * reached again by a longer one through another panel, and must then move on,
 * or the two would be left overlapping. Every push is the same way along the
 * same axis, so positions only ever grow in `dir` and the loop settles; the
 * guard is for a layout that was not sound to begin with.
 */
function shove(layout: Layout, mover: string, axis: Axis, dir: 1 | -1): Layout {
  const out: Layout = { ...layout };
  const ids = Object.keys(out);
  const queue = [mover];
  for (let guard = 0; queue.length && guard < 64 * ids.length * ids.length; guard++) {
    const qid = queue.shift()!;
    const q = out[qid];
    for (const id of ids) {
      if (id === mover || id === qid || !overlaps(q, out[id])) continue;
      const p = out[id];
      const to = dir > 0 ? start(q, axis) + span(q, axis) : start(q, axis) - span(p, axis);
      if ((to - start(p, axis)) * dir <= EPS) continue;
      out[id] = along(p, axis, to);
      queue.push(id);
    }
  }
  return out;
}

/**
 * How far past the area's edge in `dir` the furthest panel that `after` moved
 * (and `before` had elsewhere) has gone — or a fixed panel has moved at all,
 * which is the same thing: it is an edge that happens to stand inside the
 * area. Every panel the chain moves moves one for one with the mover's
 * leading edge, so pulling back by this is flush against the fixed one too.
 */
function excess(before: Layout, after: Layout, mover: string, axis: Axis, dir: 1 | -1, area: Size): number {
  let e = 0;
  for (const id of Object.keys(after)) {
    if (id === mover || after[id] === before[id]) continue;
    const r = after[id];
    if (r.fixed) e = Math.max(e, Math.abs(start(r, axis) - start(before[id], axis)));
    else e = Math.max(e, dir > 0 ? start(r, axis) + span(r, axis) - room(area, axis) : -start(r, axis));
  }
  return e;
}

/**
 * One axis of a push: the mover's interval along `axis` goes from `from`'s to
 * `to`'s, and leads in `dir`. Returns the layout with the mover where it got
 * to — the whole way, or as far as it can go with the chain inside.
 *
 * **Flush, not short, and found exactly.** Every panel the chain moves moves
 * exactly as far as the mover's leading edge does past the point where the
 * chain reached it, so how far the chain overshoots the edge grows one for one
 * with the leading edge's travel. Pulling the travel back by the overshoot is
 * therefore the largest travel that fits, to the pixel — where a binary search
 * over the travel would stop a fraction short. The loop re-checks, and goes
 * round again only if the chain met at the shorter travel is a different one
 * (it cannot be longer); after a few rounds it gives up and stays put, which
 * is always sound.
 */
function pass(layout: Layout, id: string, to: Rect, axis: Axis, dir: 1 | -1, area: Size): Layout {
  const from = layout[id];
  const [p0, l0, p1, l1] = [start(from, axis), span(from, axis), start(to, axis), span(to, axis)];
  const lead = (p: number, l: number) => (dir > 0 ? p + l : p);
  const trail = (p: number, l: number) => (dir > 0 ? p : p + l);
  const [a0, a1, t0, t1] = [lead(p0, l0), lead(p1, l1), trail(p0, l0), trail(p1, l1)];
  const travel = (a1 - a0) * dir;
  // The leading edge is what is pulled back, and the rest is put round it: a
  // drag keeps its length exactly, and a resize — west and north grips as much
  // as east and south — keeps its trailing edge exactly, so a mover stopped on
  // a chain is flush with it to the bit, not a few ulps into it.
  let a = a1;
  for (let round = 0; round < 6; round++) {
    const s = travel > EPS ? ((a - a0) * dir) / travel : 1;
    const t = l1 === l0 ? a - dir * l0 : t0 + s * (t1 - t0);
    const [p, l] = a === a1 ? [p1, l1] : l1 === l0 ? [dir > 0 ? t : a, l0] : dir > 0 ? [t, a - t] : [a, t - a];
    // What pushes is everything the mover passed over on the way, not only
    // where it lands: a fast flick that moves a panel further in one event
    // than the panel in its way is wide would otherwise go straight through it.
    const lo = Math.min(p0, p);
    const swept = along(from, axis, lo, Math.max(p0 + l0, p + l) - lo);
    const out = shove({ ...layout, [id]: swept }, id, axis, dir);
    out[id] = along(from, axis, p, l);
    const e = excess(layout, out, id, axis, dir, area);
    if (e <= EPS) return snapped(layout, out, axis, area);
    if (travel <= EPS) break;
    a = (a - dir * e - a0) * dir > 0 ? a - dir * e : a0;
  }
  return layout;
}

/**
 * `after` with every panel it moved that lies outside by no more than float
 * noise put back on the edge. The pull-back above is exact in arithmetic and
 * a few ulps out in floating point; a panel 1e-14 px past the top is still
 * past it.
 */
function snapped(before: Layout, after: Layout, axis: Axis, area: Size): Layout {
  for (const id of Object.keys(after)) {
    const r = after[id];
    if (r === before[id]) continue;
    const hi = room(area, axis) - span(r, axis);
    const p = start(r, axis);
    if (p < 0 && p >= -EPS) after[id] = along(r, axis, 0);
    else if (p > hi && p <= hi + EPS) after[id] = along(r, axis, hi);
  }
  return after;
}

/** The result of `pushed`: every panel's new place, and whether `id` got the whole way. */
export interface Pushed { layout: Layout; rect: Placed; ok: boolean }

/**
 * The one resolver every arrangement goes through: panel `id` wants to be at
 * `want`, the pointer having moved by `motion` since the last step. Returns the
 * new layout, panels pushed included, and where `id` actually ended up.
 *
 * `want` is held inside the area first (`constrain`, with `id`'s minimum from
 * `minSizes`), so the window edge stops the mover itself exactly as before.
 *
 * **With a motion**, each axis of it is taken in turn, the larger first (ties to
 * x): the mover goes as far along that axis as it wants, and a panel in the way
 * is pushed along that axis only, by exactly the overlap. Each axis on its own
 * rather than everything along the larger one, because a drag is never quite
 * straight: a tray resting on the log's top and dragged right with a pixel of
 * downward drift must push the log down a pixel, not throw it sideways the
 * width of the tray. A panel pushed along x still never moves in y.
 *
 * **With no motion** — a tray turning, a panel placed on load — the mover is
 * put down where it wants and what it covers is pushed out of its way: along x
 * first (the tie), away from the mover, then the other way; then along y the
 * same. The first that leaves every panel inside and none overlapping wins. If
 * none does, `ok` is false and nothing moves — the caller decides what an
 * impossible placement means.
 */
export function pushed(
  id: string, want: Placed, layout: Layout, area: Size, minSizes: Readonly<Record<string, Size>>, motion: Point,
): Pushed {
  const from = layout[id];
  const orient = want.orient ?? from.orient;
  // A fixed panel pushing what was put down on it (`settled`) stays fixed.
  const keep = (r: Placed): Placed => (from.fixed ? { ...r, fixed: true } : r);
  // A tray's floor of lines goes with it wherever it is put: a move is the
  // same shape, a turn hands in none (`dragStep`), which is its fewest.
  const to = keep(placed(constrain(want, area, minSizes[id] ?? { w: 0, h: 0 }), orient, want.lines));
  if (motion.x === 0 && motion.y === 0) return settle(id, to, layout, area);
  let out = layout;
  const axes: Axis[] = Math.abs(motion.x) >= Math.abs(motion.y) ? ["x", "y"] : ["y", "x"];
  for (const axis of axes) {
    const m = axis === "x" ? motion.x : motion.y;
    const cur = out[id];
    if (start(cur, axis) === start(to, axis) && span(cur, axis) === span(to, axis)) continue;
    // The way the rectangle grows on this axis — its far edge going on, or its
    // near edge going back — rather than the pointer's sign. For every gesture
    // there now is the two agree; they parted only for the tray that wrapped,
    // whose depth grew against the pointer. The rectangle's is kept because it
    // is the rectangle, not the pointer, that covers what has to make way.
    const far = start(to, axis) + span(to, axis) - start(cur, axis) - span(cur, axis);
    const near = start(to, axis) - start(cur, axis);
    const dir = (far > EPS ? 1 : near < -EPS ? -1 : Math.sign(m) || 1) as 1 | -1;
    out = pass(out, id, along(cur, axis, start(to, axis), span(to, axis)), axis, dir, area);
  }
  const rect = keep(placed(out[id], orient, to.lines));
  const ok = Math.abs(rect.x - to.x) <= EPS && Math.abs(rect.y - to.y) <= EPS &&
    Math.abs(rect.w - to.w) <= EPS && Math.abs(rect.h - to.h) <= EPS;
  return { layout: { ...out, [id]: rect }, rect, ok };
}

/** `pushed` with no motion: the mover put down at `to`, what it covers pushed out of the way. */
function settle(id: string, to: Placed, layout: Layout, area: Size): Pushed {
  const put = { ...layout, [id]: to };
  const covered = Object.keys(put).filter((o) => o !== id && overlaps(to, put[o]));
  if (covered.length === 0) return { layout: put, rect: to, ok: true };
  for (const axis of ["x", "y"] as const) {
    // Away from the mover: the side the covered panels' middles are on, summed.
    const mid = (r: Rect) => start(r, axis) + span(r, axis) / 2;
    const away = (Math.sign(covered.reduce((s, o) => s + mid(put[o]) - mid(to), 0)) || 1) as 1 | -1;
    for (const dir of [away, -away as 1 | -1]) {
      const out = shove(put, id, axis, dir);
      if (excess(put, out, id, axis, dir, area) <= EPS && overlapping(out).length === 0) {
        return { layout: out, rect: to, ok: true };
      }
    }
  }
  return { layout, rect: layout[id], ok: false };
}

/**
 * A stored or default layout made sound: panels put down in `order`, each one
 * that lands on a panel already down being pushed out of that panel's way
 * (`pushed` with no motion, the earlier panel as the mover). Earlier panels
 * hold their places, so a toolbar column that grows for a new tool down onto
 * the log pushes the log out of its way — along x, the tie, by the tray's
 * thickness — rather than the log knocking the toolbar off the left edge.
 *
 * `ok` is false when some panel could not be put clear of the others — a
 * window too small to hold them all side by side at their sizes. Then it is
 * left where it asked to be, over its neighbour: nothing here shrinks a panel
 * to make room, and a panel pushed out of the window would be lost.
 */
export function settled(
  layout: Layout, order: readonly string[], area: Size, minSizes: Readonly<Record<string, Size>>,
): { layout: Layout; ok: boolean } {
  let out: Layout = {};
  let ok = true;
  for (const id of order) {
    if (!layout[id]) continue;
    out = { ...out, [id]: layout[id] };
    const under = order.find((o) => o !== id && out[o] && overlaps(out[o], out[id]));
    if (under === undefined) continue;
    const r = pushed(under, out[under], out, area, minSizes, { x: 0, y: 0 });
    if (r.ok) out = r.layout;
    else ok = false;
  }
  return { layout: out, ok };
}

/**
 * Where on a panel the pointer holds it: the pointer minus the panel's top-left
 * for a drag by the strip, minus the grip's corner for a resize by one of the
 * four grips (`corner`, the south-east when none is said). Taken once, at the
 * press, and held for the whole gesture — see `dragStep`.
 */
export interface Grab { id: string; kind: "move" | "resize"; corner?: Corner; dx: number; dy: number }

export function grabbed(id: string, kind: "move" | "resize", pointer: Point, layout: Layout, corner: Corner = "se"): Grab {
  const r = layout[id];
  if (kind === "move") return { id, kind, dx: pointer.x - r.x, dy: pointer.y - r.y };
  const c = cornerOf(r, corner);
  return { id, kind, corner, dx: pointer.x - c.x, dy: pointer.y - c.y };
}

/**
 * The grab on a tray that has just turned from `from` to `to`: the same point of
 * the tray under the hand, as nearly as the new shape allows. The hand holds the
 * strip, and the strip turns with the tray — across a column's top, down a
 * row's left end — so the point is carried as how far along the strip it is, a
 * fraction of the strip's length, and how deep into the strip, which the
 * strip's thickness (`TITLE_H`, the same both ways) keeps. Not a fresh offset
 * from the pointer to wherever the turn put the tray: that would be the grab
 * re-basing, which is exactly what the owner withdrew.
 */
export function regrasped(grab: Grab, from: Placed, to: Placed): Grab {
  const colFrom = from.orient !== "row";
  const colTo = to.orient !== "row";
  const along = colFrom ? grab.dx : grab.dy;
  const depth = colFrom ? grab.dy : grab.dx;
  const lenFrom = colFrom ? from.w : from.h;
  const lenTo = colTo ? to.w : to.h;
  const a = lenFrom > 0 ? (along / lenFrom) * lenTo : 0;
  const d = clamp(depth, 0, colTo ? to.h : to.w);
  return colTo ? { ...grab, dx: a, dy: d } : { ...grab, dx: d, dy: a };
}

/**
 * One pointer move of a drag or a resize: where the panel wants to be from the
 * pointer and the grab, everything `pushed` does about it, and — if the panel
 * is a tray of `buttons` buttons — the turn a drag can make.
 *
 * **The grab is fixed at the moment the panel is taken** — the owner: *"actually
 * the grasp point should stay the same"*, withdrawing the slip he had asked for
 * the day before. A panel stopped short — at the window's edge, against a
 * chain that cannot move, a grip at its minimum — stays where it stopped while
 * the pointer goes on, because every move asks again for the rectangle under
 * the hand and is refused again. It moves again only when the pointer comes
 * back past the point where it left the panel behind, and is then once more
 * exactly under the hand where it was grabbed. So the grab goes back out
 * untouched, drag and every grip alike.
 *
 * The one exception is a tray that **turns**: it is a new shape, and the grab
 * becomes the same point of it (`regrasped`). Where the turn puts the tray is
 * still `turned`'s business — the edge it met is held — so after a turn against
 * a bottom or a right edge, the end the strip is not at, the tray lies against
 * that edge away from the hand until the next move brings it back under it.
 *
 * **A tray is never resized here**, whatever grab it is handed: it has no
 * grips (`gripCorners`), and a resize grab on one comes back with nothing
 * moved. So no gesture can give a tray a size that `traySize` did not.
 */
export function dragStep(
  grab: Grab, pointer: Point, layout: Layout, area: Size,
  minSize: (id: string, orient: Orientation | undefined) => Size,
  buttons?: number, m: Metrics = FINE,
): { layout: Layout; grab: Grab } {
  if (buttons !== undefined && grab.kind === "resize") return { layout, grab };
  const min = (o: Orientation | undefined) => ({ [grab.id]: minSize(grab.id, o) });
  const corner = grab.corner ?? "se";
  let out = layout;
  // `pushed` takes the larger axis of a motion first, so a panel stopped on
  // that axis by a neighbour it then slides clear of along the other has not
  // yet tried the first again from where it now is. With the grab fixed that
  // is a panel short of the hand with nothing stopping it, for one event; a
  // second round from where it got to takes up the rest. (A slip hid this
  // too, by forgetting the rest.) Each round can only move the panel further
  // toward the hand, and a round that moves nothing ends it.
  for (let round = 0; round < 3; round++) {
    const cur = out[grab.id];
    // Where the pointer now puts the corner it holds, against where that corner is.
    const anchor = grab.kind === "move" ? { x: cur.x, y: cur.y } : cornerOf(cur, corner);
    const motion = { x: pointer.x - grab.dx - anchor.x, y: pointer.y - grab.dy - anchor.y };
    if (motion.x === 0 && motion.y === 0) {
      if (round === 0) return { layout, grab };
      break;
    }
    const from = out;
    const push = (want: Placed) => pushed(grab.id, want, from, area, min(cur.orient), motion);
    // A grip held off the window is a corner the viewer could no longer see,
    // let alone grab: `resized` stops it at the area's edges.
    const r = grab.kind === "move"
      ? push({ ...cur, x: cur.x + motion.x, y: cur.y + motion.y })
      : push(placed(resized(cur, motion.x, motion.y, area, minSize(grab.id, cur.orient), corner), cur.orient));
    const still = r.rect.x === cur.x && r.rect.y === cur.y && r.rect.w === cur.w && r.rect.h === cur.h;
    if (!still) out = r.layout;
    if (r.ok || still) break;
  }
  let r = { layout: out, rect: out[grab.id] };
  let held = grab;
  if (grab.kind === "move" && buttons !== undefined && r.rect.orient) {
    const others = Object.keys(r.layout).filter((o) => o !== grab.id).map((o) => r.layout[o]);
    // Turned, it is a new shape: its fewest lines along the area the other way.
    const t = turned(r.rect, r.rect.orient, area, others, (o) => traySize(buttons, o, m, trayRoom(area, o, m)));
    if (t.orient !== r.rect.orient) {
      // Turned, the tray is put down in its new shape — its one line the other
      // way — and what that covers is pushed out of the way. If nothing can
      // make room, it does not turn.
      const u = pushed(grab.id, placed(t.rect, t.orient), r.layout, area, min(t.orient), { x: 0, y: 0 });
      const g = u.ok ? regrasped(grab, r.rect, u.rect) : grab;
      // Nor does it turn if, brought back under the hand, the new shape would
      // turn straight back. With the grab fixed, nothing else stops that: a row
      // just under the top edge held high on its strip, eased right onto the
      // right edge, turns into a column, which under the hand pokes over the
      // top edge, so turns into a row, which under the hand is on the right
      // edge again — a flip on every move, 225 of them across one measured
      // drag. The slip used to hide this, by re-basing the grab on wherever the
      // turn had put the tray.
      const hand = constrain({ x: pointer.x - g.dx, y: pointer.y - g.dy, w: u.rect.w, h: u.rect.h }, area, { w: 0, h: 0 });
      const near = Object.keys(u.layout).filter((o) => o !== grab.id).map((o) => u.layout[o]);
      if (u.ok && orientationFor(hand, t.orient, area, near) === t.orient) {
        held = g;
        r = u;
      }
    }
  }
  return { layout: r.layout, grab: held };
}

// ---- the preview: nothing moves until the drop ------------------------------
//
// The owner: *"the toolbars should push each other around, but they should show
// how they will snap IF the user drops the grasped toolbar in that spot. but
// until they actually drop it, the permanent position of any tool bar is not
// changed"* (docs/plans/panels-preview.md). So a gesture keeps two things
// apart. **The preview is the drop at this spot**: the layout the resolver
// answers for the held panel taken from where it was at the press straight to
// where the hand is now, from the layout as it was at the press — so it is a
// function of the spot alone, not of the path the hand took to it. Back at the
// press it is the start; any spot shows the same ghosts however it was
// reached. **The held panel** is the one in the hand, drawn where the hand has
// it — under the pointer at the point it was taken by, held only inside the
// area, over whatever it is over. Every other panel stays where it was until
// the drop, which commits the preview; Escape, or a lift back where the press
// was, commits nothing.
//
// The step is the resolver's own single one — one `dragStep` from the press —
// rather than the hand's path replayed: the push's rules are unchanged (a
// panel in the way is pushed ahead along each axis of the move in turn, the
// larger first, by the mover's swept rectangle), and they are asked once, for
// the straight move from the press to here. Replaying a straight line in
// small steps would be the same function of the spot, and slower by the
// number of steps, for a difference only in which way a panel crossed
// diagonally is pushed.

/** A gesture in progress: the layout at the press, the resolver's answer for the spot, and the panel in the hand. */
export interface Drag {
  /** The grab as taken — where the held panel is drawn from, and what every move resolves from. */
  grab: Grab;
  /** Where the press was, in the layout's coordinates. */
  press: Point;
  /** Every panel at the press — what Escape goes back to. */
  start: Layout;
  /** What a drop now would commit. */
  preview: Layout;
  /** The held panel, where the hand has it: its shape at the press, under the pointer. */
  held: Placed;
  /** For a tray, its buttons, counted at the press. */
  buttons?: number;
  /**
   * Taken while the panels are locked (docs/plans/panels-overlay-lock.md): the
   * hand moves nothing — the preview stays the start wherever it goes, so no
   * panel is dragged and none is pushed, and the drop commits nothing.
   */
  locked?: boolean;
  /**
   * Why the drop at this spot would move nothing (docs/plans/panels-reshuffle.md):
   * the edge the held pane is brought to has no room for it, or two panes
   * cannot trade places there. The preview is then the start, the held pane's
   * ghost is where it would go back to, and it says this.
   */
  refused?: string;
}

/** A gesture taken at `pointer`, nothing yet moved: the preview is the layout itself, and so are the ghosts — none. */
export function beginDrag(
  id: string, kind: "move" | "resize", pointer: Point, layout: Layout, corner: Corner = "se", buttons?: number, locked = false,
): Drag {
  const grab = grabbed(id, kind, pointer, layout, corner);
  return { grab, press: { ...pointer }, start: layout, preview: layout, held: layout[id], buttons, ...(locked ? { locked } : {}) };
}

/**
 * Where the hand has the held panel at `pointer`: by the strip, its shape at
 * the press with the point it was taken by under the pointer; by a grip, that
 * corner under the pointer and the opposite one where it was (`resized`).
 * Held wholly inside the area, as every panel is, and against nothing else —
 * it is in the hand, over whatever it is over, and its ghost is what says
 * where it will land. A tray keeps the way it ran at the press: its turn is
 * the preview's until the drop (the owner: *"it should not actually change the
 * toolbar between modes unless I let go"*).
 */
export function heldAt(drag: Drag, pointer: Point, area: Size, min: Size): Placed {
  const g = drag.grab;
  const r = drag.start[g.id];
  if (g.kind === "move") {
    return placed(constrain({ x: pointer.x - g.dx, y: pointer.y - g.dy, w: r.w, h: r.h }, area, { w: 0, h: 0 }), r.orient, r.lines);
  }
  // A tray has no grips; a resize grab on one holds it where it was, as `dragStep` does.
  if (drag.buttons !== undefined) return r;
  const corner = g.corner ?? "se";
  const c = cornerOf(r, corner);
  return placed(resized(r, pointer.x - g.dx - c.x, pointer.y - g.dy - c.y, area, min, corner), r.orient, r.lines);
}

/**
 * One move of a gesture: the drop at this spot — one `dragStep` from the
 * layout at the press, the grab as taken, to `pointer` (the resolver's push,
 * its turn and its re-grasp, asked once for the straight move from the press)
 * — and the held panel put where the hand now has it. Nothing of earlier
 * moves is carried: the answer is the same however the hand got here. Pure:
 * nothing on screen is this until it is drawn, and nothing is committed until
 * `dropOf`.
 */
export function dragTo(
  drag: Drag, pointer: Point, area: Size,
  minSize: (id: string, orient: Orientation | undefined) => Size, m: Metrics = FINE,
): Drag {
  // Locked, the spot changes nothing: the held panel stays put and pushes nobody.
  if (drag.locked) return { ...drag, preview: drag.start, held: drag.start[drag.grab.id] };
  const id = drag.grab.id;
  const held = heldAt(drag, pointer, area, minSize(id, drag.start[id].orient));
  const { refused: _was, ...rest } = drag;
  // By the strip, a reshuffle (docs/plans/panels-reshuffle.md); by a grip, the push.
  if (drag.grab.kind === "move") {
    const r = reshuffled(drag, held, area, m);
    return { ...rest, preview: r.preview, held, ...(r.refused ? { refused: r.refused } : {}) };
  }
  const step = dragStep(drag.grab, pointer, drag.start, area, minSize, drag.buttons, m);
  return { ...rest, preview: step.layout, held };
}

const sameRect = (a: Placed | undefined, b: Placed | undefined): boolean =>
  a !== undefined && b !== undefined && a.x === b.x && a.y === b.y && a.w === b.w && a.h === b.h && a.orient === b.orient;

/**
 * The ghosts a gesture shows now: each panel the drop would move, where it
 * will land — and the held panel's own, where it will snap, wherever that is
 * not exactly where the hand has it (stopped flush against a chain, turned
 * against an edge). A panel the drop would not move shows none, and neither
 * does the held one lying exactly on its landing. Never a fixed panel: nothing
 * moves the logo.
 */
export function ghostsOf(drag: Drag): Layout {
  const out: Layout = {};
  const id = drag.grab.id;
  for (const [o, r] of Object.entries(drag.preview)) {
    if (r.fixed) continue;
    if (o === id ? !sameRect(r, drag.held) : !sameRect(r, drag.start[o])) out[o] = r;
  }
  return out;
}

/**
 * How near the press a lift must be to be **back where the drag started** —
 * which commits nothing (the spec: *"Escape, or lifting back where the drag
 * started, commits nothing"*). A finger's is the slop a press already has
 * before it is a drag rather than a tap (tools/gestures.ts's `TAP_SLOP`,
 * tooltip.ts's `HOLD_SLOP`): a fingertip does not come down on the pixel it
 * left. A mouse's is two pixels — a hand on a mouse comes back nearly exactly,
 * and a nudge of a panel by three pixels is a real arrangement that must not
 * be read as taking it back.
 */
export function backSlop(coarse: boolean): number {
  return coarse ? HOLD_SLOP : 2;
}

/** What a drop did: `moved` committed the preview; the others left every panel where it was. */
export type DropOutcome = "moved" | "unchanged" | "back" | "refused" | "locked";

/**
 * The drop at `pointer`: the layout to show and what it was. The preview, if
 * it is a layout at all — so a drop commits exactly what the ghosts showed, in
 * one step. **Back where it started** (within `slop` of the press): the start
 * — exactly at the press the preview is the start anyway, and within the slop
 * a fingertip that has not quite come home is read as having come home, the
 * owner's way out under a finger, which has no Escape. **The resolver's refusal** (a preview two panels overlap in, which
 * `layoutProblem` names): the start too, the same as Escape, and `problem`
 * says why — the host puts a word of it in the status. A preview the same as
 * the start is `unchanged`: there is nothing to commit, or to store.
 */
export function dropOf(drag: Drag, pointer: Point, area: Size, slop: number): { layout: Layout; outcome: DropOutcome; problem: string | null } {
  if (drag.locked) return { layout: drag.start, outcome: "locked", problem: null };
  if (Math.hypot(pointer.x - drag.press.x, pointer.y - drag.press.y) <= slop) {
    return { layout: drag.start, outcome: "back", problem: null };
  }
  if (drag.refused) return { layout: drag.start, outcome: "refused", problem: drag.refused };
  const problem = layoutProblem(drag.preview, true, area);
  if (problem) return { layout: drag.start, outcome: "refused", problem };
  const same = Object.keys(drag.start).every((o) => sameRect(drag.start[o], drag.preview[o]));
  return { layout: same ? drag.start : drag.preview, outcome: same ? "unchanged" : "moved", problem: null };
}

/** How long the panels take to settle onto their ghosts at a drop: short, and no spring (index.html eases out). */
export const SETTLE_MS = 120;

// ---- reshuffle: the panes along an edge are a sequence ----------------------
//
// The owner: *"When I push toolbars around, they should be able to reorder with
// other toolbars. So reshuffle rather than push."* (docs/plans/panels-
// reshuffle.md). So a pane dragged by its strip no longer pushes anything.
// The panes along each edge of the area are **a sequence** — top to bottom
// down a side, left to right along the top or the bottom — read from where
// they are at the press, and a drag does one of four things to it, decided
// from where the hand has the pane now (the preview's rule stands: the drop at
// this spot, one step from the press):
//
// - **Along an edge it is on** it reorders: past the middle of a neighbour, it
//   takes that neighbour's slot and the neighbour takes its own, down the line
//   as a dock's icons do (`reordered`); short of a middle it slides, and stops
//   flush against whatever it meets.
// - **To another edge** it is inserted into that edge's sequence where the
//   hand is, between the two it lands between, and those after it make room
//   (`inserted`); a tray takes the way that edge runs, at the drop.
// - **Dropped on a pane that is on no edge** — floating — the two trade
//   places. Anywhere else it is put where it is, or stops flush against what
//   it meets: nothing is pushed out of its way.
// - **No room** on the edge: the pane wraps to a second line beside the first
//   (`wrapped`), and failing that the preview is refused, and says so.
//
// Only a drag by the strip reshuffles. A resize by a grip has no order to
// change, and grows into its neighbour as it always has: the push stays there.

/** One of the area's four edges. */
export type Edge = "left" | "top" | "right" | "bottom";
export const EDGES: readonly Edge[] = ["left", "top", "right", "bottom"];
const OPPOSITE: Readonly<Record<Edge, Edge>> = { left: "right", right: "left", top: "bottom", bottom: "top" };
/** The axis an edge runs along: down a side, across the top or the bottom. */
const runAxis = (e: Edge): Axis => (e === "left" || e === "right" ? "y" : "x");
const acrossAxis = (e: Edge): Axis => (e === "left" || e === "right" ? "x" : "y");
/** The way a tray lies along edge `e` — a column down a side, a row along the top or the bottom (`orientationFor`'s rule). */
export const orientAlong = (e: Edge): Orientation => (runAxis(e) === "y" ? "column" : "row");
const middle = (r: Rect, a: Axis) => start(r, a) + span(r, a) / 2;

/** How far `r`'s side facing edge `e` is from it. */
export function edgeGap(r: Rect, e: Edge, area: Size): number {
  if (e === "left") return r.x;
  if (e === "top") return r.y;
  if (e === "right") return area.w - r.x - r.w;
  return area.h - r.y - r.h;
}

/** How near an edge, at 100 % under a mouse, a pane is on it. */
export const EDGE_REACH = 16;

/**
 * How near an edge a pane's side must be for the pane to be **on** it — in its
 * sequence. More than the defaults' margin (`GAP`, 8 px off every edge) and a
 * snap, so the panes a fresh screen puts down are on their edges; and under a
 * finger at least half a target, so a thumb sliding a pane along an edge can
 * drift that far off it and still be sliding along it.
 */
export function reachOf(m: Metrics): number {
  return Math.max(GAP + SNAP, Math.round(EDGE_REACH * m.scale), Math.round(m.hit / 2));
}

/**
 * The edges a pane at `r` is on: those its side is within `reach` of — but
 * not a pair of opposite ones. A pane from edge to edge (a phone's command
 * line along the bottom) is the bottom's alone: in a side's sequence it would
 * be a slot as wide as the screen, which no reorder could ever give to a pane
 * beside another.
 */
export function edgesOf(r: Rect, area: Size, reach: number): Edge[] {
  const near = EDGES.filter((e) => edgeGap(r, e, area) <= reach + EPS);
  return near.filter((e) => !near.includes(OPPOSITE[e]));
}

/** The panes on each edge, in order along it. */
export type Sequences = Record<Edge, string[]>;

/**
 * **Each edge's sequence, read from where the panes are**: every pane on that
 * edge (`edgesOf`), in order along it — top to bottom down a side, left to
 * right along the top or the bottom. A pane in a corner is in both its edges'.
 * The logo is in none: it is the corner a sequence starts after (`runOf`).
 * Read afresh at every press, so a layout stored before sequences existed —
 * rectangles and dockings, as every layout is stored — is read into the order
 * of its positions, with nothing to migrate.
 */
export function sequences(layout: Layout, area: Size, reach: number): Sequences {
  const out: Sequences = { left: [], top: [], right: [], bottom: [] };
  for (const [id, r] of Object.entries(layout)) {
    if (r.fixed) continue;
    for (const e of edgesOf(r, area, reach)) out[e].push(id);
  }
  for (const e of EDGES) {
    const a = runAxis(e);
    out[e].sort((p, q) => start(layout[p], a) - start(layout[q], a) || span(layout[p], a) - span(layout[q], a) || (p < q ? -1 : 1));
  }
  return out;
}

/** Where edge `e`'s sequence may lie along it: the whole edge, short of a fixed panel on it at either end — the logo's corner. */
function runOf(layout: Layout, e: Edge, area: Size, reach: number): [number, number] {
  const a = runAxis(e);
  let lo = 0;
  let hi = room(area, a);
  for (const r of Object.values(layout)) {
    if (!r.fixed || edgeGap(r, e, area) > reach + EPS) continue;
    if (middle(r, a) <= room(area, a) / 2) lo = Math.max(lo, start(r, a) + span(r, a));
    else hi = Math.min(hi, start(r, a));
  }
  return [lo, hi];
}

/** `r` with its side facing edge `e` at `dist` from it, along the other axis untouched. */
function offEdge(r: Placed, e: Edge, dist: number, area: Size): Placed {
  const c = acrossAxis(e);
  return along(r, c, e === "right" || e === "bottom" ? room(area, c) - dist - span(r, c) : dist);
}

/**
 * The pane `id`, held at `held`, dragged along edge `e`, which it was on at the
 * press: **past the middle of a neighbour, it takes the neighbour's slot** —
 * its leading edge past the middle, the way it is going — and so on down the
 * line. The panes between where it was and where it goes (the block) are laid
 * out again in their new order from the block's first place, each its own
 * length, the gaps between places kept as they were — so the block's ends do
 * not move and nothing outside it does. Each keeps its own distance from the
 * edge; the held one, the hand's. `"slide"` when it has passed no middle.
 */
function reordered(start0: Layout, id: string, held: Placed, e: Edge, area: Size, reach: number): Layout | "slide" {
  const seq = sequences(start0, area, reach)[e];
  const i = seq.indexOf(id);
  const a = runAxis(e);
  const was = start0[id];
  const d = start(held, a) - start(was, a);
  let k = i;
  if (d > EPS) while (k + 1 < seq.length && middle(start0[seq[k + 1]], a) < start(held, a) + span(held, a)) k++;
  else if (d < -EPS) while (k > 0 && middle(start0[seq[k - 1]], a) > start(held, a)) k--;
  if (k === i) return "slide";
  const [lo, hi] = [Math.min(i, k), Math.max(i, k)];
  const block = seq.slice(lo, hi + 1);
  const gaps = block.slice(1).map((o, j) => {
    const p = start0[block[j]];
    return Math.max(0, start(start0[o], a) - start(p, a) - span(p, a));
  });
  const order = block.filter((o) => o !== id);
  order.splice(k - lo, 0, id);
  const c = acrossAxis(e);
  const out: Layout = { ...start0 };
  let p = start(start0[block[0]], a);
  order.forEach((o, j) => {
    const r = o === id ? along(was, c, start(held, c)) : start0[o];
    out[o] = along(r, a, p);
    p += span(r, a) + (gaps[j] ?? 0);
  });
  return out;
}

/** The gap a pane inserted into a sequence is given from its neighbours, where it has to make room: the defaults' margin. */
const ROOM_GAP = GAP;

/**
 * Pane `id`, held at `held`, brought to edge `e`, which it was not on: put in
 * `shape` (a tray turned to run along the edge, else its own) where the hand
 * is along the edge, as far off it as the hand has it, **between the two it
 * lands between** — those whose middles are either side of its own. Where it
 * would lie on the one before, it goes just after it; those after it **make
 * room**, each moving on only as far as it must to keep clear of the one
 * before (`ROOM_GAP`, or the gap two already had where that was less); and
 * where the last would leave the edge, the whole line closes back from the
 * far end. Null when the line does not fit the edge (**no room**). A pane
 * off the edge that the line now lies on **makes room** too (`madeRoom`).
 */
function inserted(start0: Layout, id: string, shape: Placed, held: Placed, e: Edge, area: Size, reach: number): Layout | null {
  const others: Layout = { ...start0 };
  delete others[id];
  const seq = sequences(others, area, reach)[e];
  const [lo, hi] = runOf(others, e, area, reach);
  const a = runAxis(e);
  const len = span(shape, a);
  if (len > hi - lo + EPS) return null;
  const want = clamp(start(held, a), lo, hi - len);
  const h = offEdge(along(shape, a, want), e, clamp(edgeGap(held, e, area), 0, reach), area);
  const k = seq.filter((o) => middle(others[o], a) < want + len / 2).length;
  const ids = [...seq.slice(0, k), id, ...seq.slice(k)];
  const rect = (o: string): Placed => (o === id ? h : others[o]);
  const pos = ids.map((o) => start(rect(o), a));
  const lens = ids.map((o) => span(rect(o), a));
  // Between two that were already neighbours, the gap they had if it was less
  // than the room gap — so making room moves only what the new pane reaches.
  const sep = (j: number) => {
    if (ids[j - 1] === id || ids[j] === id) return ROOM_GAP;
    const p = others[ids[j - 1]];
    return clamp(start(others[ids[j]], a) - start(p, a) - span(p, a), 0, ROOM_GAP);
  };
  for (let j = Math.max(1, k); j < ids.length; j++) pos[j] = Math.max(pos[j], pos[j - 1] + lens[j - 1] + sep(j));
  const n = ids.length - 1;
  if (pos[n] + lens[n] > hi + EPS) {
    pos[n] = hi - lens[n];
    for (let j = n - 1; j >= 0; j--) pos[j] = Math.min(pos[j], pos[j + 1] - sep(j + 1) - lens[j]);
  }
  if (pos[0] < lo - EPS) return null;
  const out: Layout = { ...start0 };
  ids.forEach((o, j) => { out[o] = along(rect(o), a, pos[j]); });
  return madeRoom(out, new Set(ids), area);
}

/**
 * Pane `id` brought to edge `e` where the line has no room for it: **a second
 * line**, as a tray's buttons wrap — beside the panes of the first line it
 * lies along, a room gap further off the edge than the furthest of them,
 * where the hand has it along the edge. Null when there is no first line
 * there to wrap beside, or when the second line would leave the area; a pane
 * off the edge that it lies on makes room (`madeRoom`).
 */
function wrapped(start0: Layout, id: string, shape: Placed, held: Placed, e: Edge, area: Size, reach: number): Layout | null {
  const others: Layout = { ...start0 };
  delete others[id];
  // The first line is the edge's panes and its fixed ones (the logo, the
  // corner along the top); a second line beside them may run the whole edge.
  const seq = [...sequences(others, area, reach)[e], ...Object.keys(others).filter((o) => others[o].fixed && edgeGap(others[o], e, area) <= reach + EPS)];
  const a = runAxis(e);
  const c = acrossAxis(e);
  const len = span(shape, a);
  if (len > room(area, a) + EPS) return null;
  const want = clamp(start(held, a), 0, room(area, a) - len);
  const first = seq.filter((o) => overlap(start(others[o], a), start(others[o], a) + span(others[o], a), want, want + len) > EPS);
  if (!first.length) return null;
  const dist = Math.max(...first.map((o) => edgeGap(others[o], e, area) + span(others[o], c))) + ROOM_GAP;
  if (dist + span(shape, c) > room(area, c) + EPS) return null;
  const out: Layout = { ...start0, [id]: offEdge(along(shape, a, want), e, dist, area) };
  return madeRoom(out, new Set([id, ...seq]), area);
}

/**
 * The place nearest `r`'s own (by its top-left corner) where a rectangle of
 * its size lies wholly inside the area and on none of `obstacles` — null if
 * there is none. Exact, not sampled: the nearest free place of an
 * axis-aligned box among axis-aligned boxes has each coordinate either its
 * own or flush with an obstacle's edge or the area's, so those are the only
 * candidates to try.
 */
function nearestFree(r: Placed, obstacles: readonly Rect[], area: Size): Placed | null {
  const xs = [r.x, 0, area.w - r.w, ...obstacles.flatMap((o) => [o.x - r.w, o.x + o.w])].filter((x) => x >= -EPS && x + r.w <= area.w + EPS);
  const ys = [r.y, 0, area.h - r.h, ...obstacles.flatMap((o) => [o.y - r.h, o.y + o.h])].filter((y) => y >= -EPS && y + r.h <= area.h + EPS);
  let best: Placed | null = null;
  let d = Infinity;
  for (const x of xs) {
    for (const y of ys) {
      const e = (x - r.x) ** 2 + (y - r.y) ** 2;
      if (e >= d) continue;
      const c = { ...r, x, y };
      if (obstacles.some((o) => overlaps(o, c))) continue;
      best = c;
      d = e;
    }
  }
  return best;
}

/**
 * `layout` with every pane that lies on another moved out of the way —
 * **reshuffled, not refused** (the owner's *"reshuffle rather than push"*, as
 * the review of the first build read it: the others reorder to let the held
 * one in). The panes in `keep` — the one in the hand and the line it joined —
 * hold the places just given them, and so does the logo; any other pane they
 * lie on is put at **the nearest place that lies on nothing** (`nearestFree`),
 * and where there is none, the old push's own search is the fallback: the
 * pane in the way pushes what it covers along x then y, each way, a chain
 * allowed, every kept pane standing (`pushed` with no motion); and where that
 * cannot either, every pane not kept is laid again round the kept ones
 * (`relaidAround`). Null only when none finds room — the panes cannot all be
 * had on the screen at their sizes. Nothing is ever put off the screen.
 */
function madeRoom(layout: Layout, keep: ReadonlySet<string>, area: Size): Layout | null {
  let out = layout;
  const ids = Object.keys(layout);
  const stays = (o: string) => keep.has(o) || out[o].fixed === true;
  for (let guard = 0; guard < 4 * ids.length; guard++) {
    const pair = overlapping(out)[0];
    if (!pair) return out;
    const [a, b] = pair;
    if (stays(a) && stays(b)) return null;
    // Of a kept pane and another, the other gives way; of two others, the later.
    const [mover, victim] = stays(a) ? [a, b] : stays(b) ? [b, a] : [a, b];
    const spot = nearestFree(out[victim], ids.filter((o) => o !== victim).map((o) => out[o]), area);
    if (spot) {
      out = { ...out, [victim]: spot };
      continue;
    }
    const pinned: Layout = {};
    for (const o of ids) pinned[o] = o !== mover && stays(o) ? { ...out[o], fixed: true } : out[o];
    const r = pushed(mover, out[mover], pinned, area, { [mover]: { w: out[mover].w, h: out[mover].h } }, { x: 0, y: 0 });
    if (!r.ok) return relaidAround(out, stays, area);
    const next: Layout = {};
    for (const o of ids) next[o] = out[o].fixed ? out[o] : placed(r.layout[o], out[o].orient, out[o].lines);
    out = next;
  }
  return overlapping(out).length ? null : out;
}

/**
 * The last way `madeRoom` has of finding room, when one pane has nowhere to go
 * and no push can make it: **every pane not kept laid again**, the biggest
 * first, each at the nearest place to where it was that lies on nothing — the
 * kept panes and those already laid. A phone's command line, as wide as the
 * screen, needs a whole band of it free; that band is often there only once
 * the smaller panes have moved off it. Null when even this leaves one with
 * nowhere — which, at their sizes, is the screen being too small for them all.
 */
function relaidAround(layout: Layout, stays: (id: string) => boolean, area: Size): Layout | null {
  const out: Layout = {};
  for (const o of Object.keys(layout)) if (stays(o)) out[o] = layout[o];
  const rest = Object.keys(layout).filter((o) => !stays(o)).sort((p, q) => layout[q].w * layout[q].h - layout[p].w * layout[p].h);
  for (const o of rest) {
    const spot = nearestFree(layout[o], Object.values(out), area);
    if (!spot) return null;
    out[o] = spot;
  }
  return Object.fromEntries(Object.keys(layout).map((o) => [o, out[o]]));
}

/** The id the logo's corner is held under while a pane is inserted along the top (`reshuffled`); never a pane's. */
const CORNER = "\u0000corner";

/** What the preview says, on the held pane's ghost and in the status at the drop, when an edge has no room for it. */
export const NO_ROOM = "no room on this edge";
/** Likewise when two panes cannot trade places where they are. */
export const NO_SWAP = "no room to trade places there";

/**
 * Where the held pane lands with every other pane standing still: **where the
 * hand has it, if that lies on nothing**; else, on the straight line from
 * where it was at the press to there, the furthest point it is clear of
 * everything — so it **stops flush** against what it was dropped on, from
 * the side it came, and pushes nothing. Furthest, not first: a pane carried
 * over another to the empty space beyond lands there. Found exactly: along the
 * line each other pane is in the way over one open stretch of it, and the
 * answer is the far end of the line stepped back to the near end of each
 * stretch it lies in, until it lies in none — the press itself, at worst,
 * where the layout was sound.
 *
 * `turn`, for a tray in no edge's sequence: against a pane's edge, or the
 * area's, it turns as it always has (`turned`), where its turned shape lies on
 * nothing — the owner's *"that includes pushing it up against a
 * vertical/horizontal edge of another tooltray"*.
 */
function landing(drag: Drag, held: Placed, area: Size, m: Metrics, turn: boolean): Layout {
  const id = drag.grab.id;
  const others = Object.keys(drag.start).filter((o) => o !== id).map((o) => drag.start[o]);
  // The line from the press, then along each axis on toward the hand from
  // wherever that stopped: a pane taken diagonally into the corner under the
  // logo stops on the logo's bottom and still slides on to the left edge, as a
  // hand dragging it there means.
  let r = furthest(drag.start[id], held, others);
  r = furthest(r, { ...r, x: held.x }, others);
  r = furthest(r, { ...r, y: held.y }, others);
  if (turn && drag.buttons !== undefined && r.orient) {
    const u = turned(r, r.orient, area, others, (o) => traySize(drag.buttons!, o, m, trayRoom(area, o, m)));
    const to = placed(u.rect, u.orient);
    if (u.orient !== r.orient && others.every((o) => !overlaps(o, to))) r = to;
  }
  return { ...drag.start, [id]: r };
}

/** `held`'s shape on the straight line from `from` to `held`: the furthest point along it that lies on none of `others` (see `landing`). */
function furthest(from: Placed, held: Placed, others: readonly Rect[]): Placed {
  const v = { x: held.x - from.x, y: held.y - from.y };
  // The open stretch of the line, as a share t of it, over which the held pane overlaps `r`.
  const stretch = (r: Rect): [number, number] | null => {
    let lo = -Infinity;
    let hi = Infinity;
    for (const a of ["x", "y"] as const) {
      const [p, len, d] = [start(from, a), span(held, a), a === "x" ? v.x : v.y];
      const [q0, q1] = [start(r, a), start(r, a) + span(r, a)];
      if (Math.abs(d) < EPS) {
        if (overlap(p, p + len, q0, q1) <= EPS) return null;
        continue;
      }
      const [t0, t1] = [(q0 - len - p) / d, (q1 - p) / d];
      lo = Math.max(lo, Math.min(t0, t1));
      hi = Math.min(hi, Math.max(t0, t1));
    }
    return lo < hi ? [lo, hi] : null;
  };
  const stretches = others.map(stretch).filter((s): s is [number, number] => s !== null);
  let t = 1;
  for (let guard = 0; guard <= stretches.length; guard++) {
    const inside = stretches.find(([a, b]) => a < t - 1e-9 && t < b - 1e-9);
    if (!inside) break;
    t = Math.max(0, inside[0]);
  }
  // Flush to the bit: t·v is the obstacle's edge less the pane, give or take an ulp.
  const snap = (x: number) => (Math.abs(x - Math.round(x)) < 1e-6 ? Math.round(x) : x);
  return { ...held, x: snap(from.x + v.x * t), y: snap(from.y + v.y * t) };
}

/**
 * **The drop at this spot, reshuffled** (see the section's head): what the
 * layout would be if the pane in the hand, now `held`, were dropped here —
 * and, where an edge has no room for it or two panes cannot trade places, the
 * start and the word for why (`refused`). Pure, and a function of the spot:
 * every decision is made from the layout at the press and where the held pane
 * is now.
 *
 * Which of the four it is: **an edge it was on at the press and is still on**
 * (within `reachOf`) — it reorders along it; of two such (a corner), the one
 * running the way it has moved further. Otherwise **the nearest other edge it
 * is on** — inserted there. Otherwise it is floating, and **its middle on a
 * floating pane** trades places with it. A tray that has left the edge it lay
 * along for another it was on (a row in the bottom-left corner, slid up the
 * left edge) is inserted there turned, as if it had come from elsewhere.
 */
export function reshuffled(drag: Drag, held: Placed, area: Size, m: Metrics = FINE): { preview: Layout; refused?: string } {
  const id = drag.grab.id;
  const was = drag.start[id];
  const reach = reachOf(m);
  const home = edgesOf(was, area, reach);
  const near = edgesOf(held, area, reach);
  const stay = home.filter((e) => near.includes(e));
  const tray = drag.buttons !== undefined && was.orient !== undefined;
  const refuse = (why: string) => ({ preview: drag.start, refused: why });
  let e: Edge | undefined;
  if (stay.length) {
    const moved = Math.abs(held.x - was.x) >= Math.abs(held.y - was.y) ? "x" : "y";
    e = stay.find((s) => runAxis(s) === moved) ?? stay[0];
  } else if (near.length) {
    const gap = (s: Edge) => edgeGap(held, s, area);
    e = near.reduce((best, s) => {
      const d = gap(s) - gap(best);
      if (Math.abs(d) > EPS) return d < 0 ? s : best;
      return tray && orientAlong(s) === was.orient && orientAlong(best) !== was.orient ? s : best;
    });
  }
  // A tray that lay along an edge at the press and has left it for one it does
  // not lie along has come to that edge as much as one from elsewhere. One that
  // lay along none — a phone's action strip, a row down the right edge — keeps
  // the way it runs as it moves along its edge, until it is pressed right up
  // against it (`SNAP`, the turn's own reach): then it turns, as a tray always
  // has against the edge it meets.
  const lay = (edges: Edge[]) => edges.some((s) => orientAlong(s) === was.orient);
  const turning = tray && e !== undefined && orientAlong(e) !== was.orient &&
    ((lay(home) && !lay(stay)) || edgeGap(held, e, area) <= SNAP + EPS);
  if (e !== undefined) {
    if (stay.includes(e) && !turning) {
      const r = reordered(drag.start, id, held, e, area, reach);
      if (r === "slide") return { preview: landing(drag, held, area, m, false) };
      // The stretch it reordered holds; a pane off the edge it now lies on makes room.
      const block = sequences(drag.start, area, reach)[e].filter((o) => r[o] !== drag.start[o]);
      const made = madeRoom(r, new Set(block), area);
      return made ? { preview: made } : refuse(NO_ROOM);
    }
    let shape: Placed = held;
    if (tray && orientAlong(e) !== was.orient) {
      const o = orientAlong(e);
      shape = placed({ x: held.x, y: held.y, ...traySize(drag.buttons!, o, m, trayRoom(area, o, m)) }, o);
    }
    // Along the top, the logo's corner is the logo and the status's least room
    // beside it (`cornerBox`), held as a fixed pane for the insertion: the
    // line starts after it, a pane too long for the rest of the top wraps to
    // a second line under it, and no pane making room lands in it. A pane let
    // in beside the bare logo left the status a column a few pixels wide,
    // running down the screen a character to a line (seen in the picture of
    // the tray taken to the top of an upright phone).
    // (Only where the corner is clear: a pane the viewer left in it stays, and
    // the corner is then the bare logo, as it always was.)
    // The status's room beside the logo, not over it: two fixed panes never overlap.
    const box = cornerBox(m);
    const logoW = logoBox(m).w;
    const corner: Rect = { x: logoW, y: 0, w: Math.max(0, box.w - logoW), h: box.h };
    const clear = Object.keys(drag.start).every((o) => o === id || drag.start[o].fixed || !overlaps(drag.start[o], corner));
    const base: Layout = e === "top" && clear ? { ...drag.start, [CORNER]: { ...corner, fixed: true } } : drag.start;
    const r = inserted(base, id, shape, held, e, area, reach) ?? wrapped(base, id, shape, held, e, area, reach);
    if (!r) return refuse(NO_ROOM);
    const { [CORNER]: _corner, ...preview } = r;
    return { preview };
  }
  const mid = { x: held.x + held.w / 2, y: held.y + held.h / 2 };
  const onto = Object.keys(drag.start).find((o) => {
    const r = drag.start[o];
    return o !== id && !r.fixed && mid.x > r.x && mid.x < r.x + r.w && mid.y > r.y && mid.y < r.y + r.h &&
      edgesOf(r, area, reach).length === 0;
  });
  if (onto !== undefined) {
    const f = drag.start[onto];
    const out: Layout = {
      ...drag.start,
      [id]: placed(constrain({ x: f.x, y: f.y, w: was.w, h: was.h }, area, { w: 0, h: 0 }), was.orient, was.lines),
      [onto]: placed(constrain({ x: was.x, y: was.y, w: f.w, h: f.h }, area, { w: 0, h: 0 }), f.orient, f.lines),
    };
    // The held one holds the place it took; the other — and any third pane
    // either now lies on — goes to the nearest place on nothing.
    const made = madeRoom(out, new Set([id]), area);
    return made ? { preview: made } : refuse(NO_SWAP);
  }
  return { preview: landing(drag, held, area, m, true) };
}

// ---- see-through and locked -------------------------------------------------
//
// Two switches in the logo menu's View section (docs/plans/panels-overlay-
// lock.md; the owner: *"a menu option to make the toolbars transparent to
// maximize visible viewport size. and also another option to lock the
// toolbars in place"*). Both are the viewer's, as the layout and the interface
// size are: kept in this browser beside the layout, never in a file, never
// journalled, never an undo step — and typed, `panels({ overlay: true })`,
// `panels({ locked: true })`, so the menu does nothing a line could not.

/** The two switches: every pane drawn as its content alone over the drawing, and every pane held where it is. */
export interface PanelSwitches { overlay: boolean; locked: boolean }
export const NO_SWITCHES: PanelSwitches = { overlay: false, locked: false };

/** Beside the layout's key, its own: `layout("reset")` puts the panes back, and leaves how they are drawn alone. */
export const SWITCHES_KEY = "neocad.panels.switches.v1";

/** What a stored switches text parses to: anything not exactly a boolean is the default, off. */
export function parseSwitches(text: string | null): PanelSwitches {
  if (!text) return { ...NO_SWITCHES };
  try {
    const o = JSON.parse(text) as Record<string, unknown>;
    return { overlay: o?.overlay === true, locked: o?.locked === true };
  } catch {
    return { ...NO_SWITCHES };
  }
}

export function loadSwitches(storage: StorageLike | null): PanelSwitches {
  try {
    return parseSwitches(storage?.getItem(SWITCHES_KEY) ?? null);
  } catch {
    return { ...NO_SWITCHES };
  }
}

export function saveSwitches(storage: StorageLike | null, s: PanelSwitches): boolean {
  try {
    storage?.setItem(SWITCHES_KEY, JSON.stringify({ overlay: s.overlay, locked: s.locked }));
    return storage !== null;
  } catch {
    return false;
  }
}

/** What `panels()` says: both switches, in the menu's words and the command's. */
export function describeSwitches(s: PanelSwitches): string {
  return `panels: see-through ${s.overlay ? "on" : "off"}, locked ${s.locked ? "on" : "off"}` +
    ` — panels({ overlay: ${s.overlay} }), panels({ locked: ${s.locked} })`;
}

export const PANELS_USAGE = "panels() takes { overlay: true | false } and { locked: true | false }; panels() says both";

/**
 * `panels(options)` read against the switches now: the next switches, or a
 * throw that says what it takes. Each key is optional, so one line can set
 * either or both; nothing but a boolean is taken for either.
 */
export function switchesFrom(now: PanelSwitches, options: unknown): PanelSwitches {
  if (!options || typeof options !== "object" || Array.isArray(options)) throw new Error(PANELS_USAGE);
  const o = options as Record<string, unknown>;
  const unknown = Object.keys(o).filter((k) => k !== "overlay" && k !== "locked");
  if (unknown.length) throw new Error(`panels() takes overlay and locked — ${unknown.map((u) => JSON.stringify(u)).join(", ")} is neither. ${PANELS_USAGE}`);
  const next = { ...now };
  for (const k of ["overlay", "locked"] as const) {
    if (!(k in o)) continue;
    if (typeof o[k] !== "boolean") throw new Error(`panels({ ${k} }) takes true or false — ${JSON.stringify(o[k]) ?? String(o[k])} is neither`);
    next[k] = o[k] as boolean;
  }
  return next;
}

/**
 * `panels(options)` as the command line runs it: with nothing, what is in
 * force; with options, the switches set through `set` (which stores and draws
 * them) and the new state said. The host's half of the command, kept here so
 * a test can run it without a page.
 */
export function panelsLine(get: () => PanelSwitches, set: (s: PanelSwitches) => void, options?: unknown): string {
  if (options === undefined) return describeSwitches(get());
  const next = switchesFrom(get(), options);
  set(next);
  return describeSwitches(next);
}

/** What a press on a locked pane's strip says, in the chip's guidance. */
export const LOCKED_GUIDE = "panels are locked — unlock in the menu";

/** What the status says when a rotation made a locked layout re-fit. */
export const REFIT_NOTE = "panels re-fitted to this screen — still locked";

/** What the status says when the panes left where they were cannot all fit this screen, and some were put at their defaults. */
export const REFIT_UNLOCKED_NOTE = "panels re-fitted to this screen";

/**
 * **A layout that does not fit is never drawn while one that does is there.**
 * `attempt(keep)` lays the panes out with the stored places of `keep` and the
 * rest at their defaults; with all of `stored` kept the resolver can find no
 * layout — the places a viewer left in one area, re-laid through a rotation,
 * cannot all be had in the other — and what it leaves overlaps (measured over
 * 2,796 random stored layouts on a 440 × 956 phone, both ways up: 850 of 5,592
 * re-layouts found none, 844 of them drawn with panes over panes, and only a
 * console warning said so). So, in order: every stored place; every stored
 * place but those of the panes the failed layout has overlapping (731 of the
 * 850 fit so); none — the defaults, which everything-fits guarantees (the
 * other 119). `dropped` names the stored places given up; the caller says so
 * and stores nothing. Where even the defaults do not fit, the first result
 * stands, and is reported as it always was.
 */
export function refit(
  attempt: (keep: readonly string[]) => { layout: Layout; ok: boolean },
  stored: readonly string[],
): { result: { layout: Layout; ok: boolean }; dropped: string[] } {
  const first = attempt(stored);
  if (first.ok || !stored.length) return { result: first, dropped: [] };
  const inWay = new Set(overlapping(first.layout).flat());
  const kept = stored.filter((id) => !inWay.has(id));
  if (kept.length < stored.length) {
    const some = attempt(kept);
    if (some.ok) return { result: some, dropped: stored.filter((id) => inWay.has(id)) };
  }
  const none = attempt([]);
  if (none.ok) return { result: none, dropped: [...stored] };
  return { result: first, dropped: [] };
}

/** A corner of a pane: which way its see-through content hugs. */
export type Hug = "nw" | "ne" | "sw" | "se";

/**
 * The corner a pane's see-through content hugs (the owner: *"like how the
 * feature tree in solidworks changes form when it is overlaid over the
 * viewport"* — SolidWorks' flown-out tree sits in the view's corner, not in
 * the middle of a box): the corner of its rectangle nearest the area's corner
 * it is in — by which half of the area its middle lies in, each way. So an
 * organiser docked to the right edge has its tree along the right, one at the
 * bottom has its last rows on the bottom, and the drawing gets the rest.
 */
export function hugOf(r: Rect, area: Size): Hug {
  const ns = r.y + r.h / 2 <= area.h / 2 ? "n" : "s";
  const we = r.x + r.w / 2 <= area.w / 2 ? "w" : "e";
  return `${ns}${we}` as Hug;
}

/**
 * The panes the resolver moved to make a layout fit: those of `ids` whose
 * place in `shown` is not where `wanted` (the stored docking re-laid in the
 * area there is now, and the defaults for the rest) asked — a pane the viewer
 * placed, or a default one it pushed out of its way. A locked layout is re-fitted like any other — the
 * lock keeps a hand from moving a pane, not the window from turning under it
 * — and this is what says that it was.
 */
export function refitted(wanted: Layout, shown: Layout, ids: readonly string[]): string[] {
  return ids.filter((id) => wanted[id] && shown[id] && !sameRect(wanted[id], shown[id]));
}

// ---- the default layout -----------------------------------------------------

const LOG_H = 150;
const BOTTOM_W = 560;
/** The organiser's (docs/plans/organiser.md) default size at 100 %: the most it is given anywhere. */
const ORGANISER_W = 190;
const ORGANISER_H = 260;
/**
 * In portrait on a phone the organiser keeps above this share of the area's
 * height, its top third: a drawing starts in the middle of the window, and a
 * pane over the middle covered what the touch suite draws (organiser.md; and
 * measured again here, at 40 % it lay over a rectangle's top-left corner).
 */
const UPPER = 1 / 3;
/** The status's least room beside the logo, at 100 %: a dozen and a half characters a line, wrapped. */
const CORNER_W = 120;

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
export function defaultLayout(area: Size, tools: number, m: Metrics = FINE): Layout {
  if (m.coarse) return touchLayout(area, tools, m);
  // Under the logo, a margin clear of it: touching it, the tray would be
  // against it, and the first sideways drag would turn it into a row.
  const top = logoBox(m).h + GAP;
  const w = Math.min(Math.round(BOTTOM_W * m.scale), area.w - 2 * GAP);
  const cmdH = m.title + m.line;
  const logH = Math.round(LOG_H * m.scale);
  const cmdY = area.h - GAP - cmdH;
  return {
    toolbar: { x: GAP, y: top, ...traySize(tools, "column", m, trayRoom(area, "column", m)), orient: "column" },
    log: { x: GAP, y: cmdY - GAP / 2 - logH, w, h: logH },
    cmd: { x: GAP, y: cmdY, w, h: cmdH },
    // Bottom right, level with the log and the command line: the corner
    // nothing else defaults to, clear of the drawing's middle and of the tray
    // wherever along the top it is pushed.
    organiser: organiserAt(area, Math.round(ORGANISER_W * m.scale), Math.round(ORGANISER_H * m.scale),
      Math.max(top, area.h - GAP - Math.round(ORGANISER_H * m.scale)), area.h - GAP),
  };
}

/** The organiser against the area's right edge from `top`, held above `bottom`. */
function organiserAt(area: Size, w: number, h: number, top: number, bottom: number): Rect {
  return { x: area.w - GAP - w, y: top, w, h: Math.max(0, Math.min(h, bottom - top)) };
}

/**
 * Where each panel goes on a fresh screen under a finger (docs/plans/touch.md)
 * — a phone's, in either orientation, at the interface size `m` carries.
 *
 * **Everything fits** (the owner: *"everything has to fit"*;
 * docs/plans/everything-fits.md): on every iPhone from the SE to the Pro Max,
 * both ways up, installed and in Safari, at the device's 100 %, these panes
 * overlap nothing — no pane over another, and **none in the logo's row**, the
 * band across the top as tall as the logo's box, which belongs to the logo and
 * the status beside it (main.ts's corner), so the status never lies over a
 * pane. A pane with a strip across its top sits a little lower still
 * (`stripTop`): a strip's hit box reaches up over the drawing to a whole
 * target (index.html), and it must not take a drag that starts on the status.
 * The device table this is tested over is `test/devices.ts`.
 *
 * **Portrait**: the command line **docked to the bottom**, edge to edge — the
 * owner: *"Please allow it to be dragged right to the bottom"*; touching the
 * bottom, it reaches under the home indicator with its line above it (`bleed`),
 * iOS's own toolbar. The tray a **column down the left**, under the logo,
 * wrapping onto a second line where the screen is too short for one (an SE in
 * Safari); where the column runs down past the line's top, the line starts
 * right of it. Under the logo's row, the action strip at the top right (where
 * the owner put it in his own screenshot) with the one-line log under it, and
 * **the organiser beside them** on the left, right of the tray — shown from
 * the start (the owner: *"show from start"*), and held above the drawing's
 * middle (`UPPER`), which is where a drawing starts. Where the screen is too
 * narrow for it beside the strip, it goes under the log instead. The options
 * panel's box is what is left between them and the command line.
 *
 * **Landscape** (wider than tall): a column down the right edge — the action
 * strip, the one-line log, and the organiser down to the bottom — and left of
 * it the command line under the logo's row and the tray a row docked to the
 * bottom. The tray's room is what the column leaves, so on most phones it is
 * **two rows** (the owner's *"Second row"*): a 13-button line is 599 px, and
 * the column is 203.
 *
 * At a larger interface size the same holds as far as the screen allows: a tray
 * takes another line, the organiser shrinks to its least, then the log is the
 * last thing in its column; past that the resolver finds no layout and says so
 * (`layoutProblem`) — see the spec's *As built* for where on each phone.
 *
 * Positions only, like every default: the viewer moves anything, and what they
 * move is theirs. Safe areas are the area's business — `area` is the space
 * inside them.
 */
/**
 * The corner's box: the logo, and beside it the room the status is given in
 * every default layout — the region of the logo's row no default pane enters
 * (docs/plans/everything-fits.md). In portrait the defaults leave the whole
 * row empty; in landscape, where height is short, the command line and the
 * strip share the row beyond this. The status wraps inside whatever room the
 * panes leave it (`cornerRoom`), which is at least this.
 */
export function cornerBox(m: Metrics): Rect {
  const logo = logoBox(m);
  return { x: 0, y: 0, w: logo.w + Math.round(CORNER_W * m.scale), h: logo.h };
}

function touchLayout(area: Size, tools: number, m: Metrics): Layout {
  const cmdH = m.title + m.line;
  const logH = m.title + m.logLine;
  const logo = logoBox(m);
  // A strip's hit box reaches this far up past the strip's top (index.html's
  // `::before`, a whole target tall from the strip's bottom).
  const lift = Math.max(0, m.hit - m.title);
  const top = logo.h + GAP;
  const stripTop = logo.h + lift + GAP / 2;
  const orgMin = minOfPanel("organiser", m);
  const logMin = minOfPanel("log", m);
  const orgW = Math.round(ORGANISER_W * m.scale);
  const orgH = Math.round(ORGANISER_H * m.scale);
  const act = traySize(ACTIONS.length, "row", m, trayRoom(area, "row", m));
  const actions: Placed = { x: area.w - GAP - act.w, y: top, ...act, orient: "row" };
  // Under the strip, its own strip's hit box clear of the strip's buttons.
  const logY = top + act.h + Math.max(GAP, lift + GAP / 2);
  if (area.w >= area.h) {
    // Height is what a landscape phone has least of, so the top row is used:
    // the corner's box stays the corner's, and the command line and the strip
    // share the row beyond it.
    const colW = Math.max(act.w, logMin.w);
    const colX = area.w - GAP - colW;
    const room = colX - 2 * GAP;
    const lines = trayLines(tools, "row", m, room);
    const bar = traySize(tools, "row", m, room);
    const rowY = GAP;
    const cmdX = cornerBox(m).w + GAP;
    // Where the row beyond the corner is too short for a command line, it
    // goes under the row instead.
    const cmd = colX - GAP - cmdX >= minOfPanel("cmd", m).w
      ? { x: cmdX, y: rowY, w: colX - GAP - cmdX, h: cmdH }
      : { x: GAP, y: stripTop, w: colX - 2 * GAP, h: cmdH };
    const logRow = rowY + act.h + Math.max(GAP, lift + GAP / 2);
    const orgY = logRow + logH + GAP;
    return {
      cmd,
      actions: { ...actions, x: colX + colW - act.w, y: rowY },
      log: { x: colX, y: logRow, w: colW, h: logH },
      // The rest of the column, down to the bottom margin.
      organiser: { x: colX, y: orgY, w: colW, h: Math.max(orgMin.h, Math.min(orgH, area.h - GAP - orgY)) },
      toolbar: { x: GAP, y: area.h - bar.h, ...bar, orient: "row", ...(lines > 1 ? { lines } : {}) },
    };
  }
  const bar = traySize(tools, "column", m, trayRoom(area, "column", m));
  const left = GAP + bar.w + GAP;
  const cmdY = area.h - cmdH;
  // Edge to edge where the column ends above it, which it does in the
  // installed app; where it would run down onto it, the line starts right of
  // the tray instead, still docked to the bottom and the right edge.
  const clear = top + bar.h <= cmdY;
  const upper = Math.round(area.h * UPPER);
  // The log under the strip is the strip's width, or its own least where the
  // strip is shorter — which it is below about 80 %, now that the strip's
  // pitch is the target and follows the size (docs/plans/touch-density.md).
  const logW = Math.max(act.w, logMin.w);
  const logX = area.w - GAP - logW;
  const besideW = Math.min(orgW, logX - GAP - left);
  let log: Rect;
  let organiser: Rect;
  if (besideW >= orgMin.w) {
    log = { x: logX, y: logY, w: logW, h: logH };
    const h = Math.max(orgMin.h, Math.min(orgH, Math.max(logY + logH, upper) - stripTop));
    organiser = { x: logX - GAP - besideW, y: stripTop, w: besideW, h };
  } else {
    log = { x: left, y: logY, w: area.w - GAP - left, h: logH };
    const y = logY + logH + GAP;
    const w = Math.max(orgMin.w, Math.min(orgW, area.w - GAP - left));
    organiser = { x: area.w - GAP - w, y, w, h: Math.max(orgMin.h, Math.min(orgH, upper - y)) };
  }
  const below = Math.max(log.y + log.h, organiser.y + organiser.h) + GAP;
  return {
    toolbar: { x: GAP, y: top, ...bar, orient: "column" },
    actions,
    log,
    organiser,
    cmd: clear ? { x: 0, y: cmdY, w: area.w, h: cmdH } : { x: left, y: cmdY, w: area.w - left, h: cmdH },
    // Beside a column on the left the options panel would hang in the middle
    // of a phone's drawing (measured: it covered the rectangle the extrude was
    // aimed at). So it gets the space right of the tray, between the panes at
    // the top and the command line, and sits in that box's bottom-right
    // corner — just above the line, its ✓ under the same thumb (`inCorner`).
    options: { x: left, y: below, w: area.w - GAP - left, h: Math.max(0, cmdY - GAP - below) },
  };
}

/** What each panel will not shrink below — a strip and a line of it. */
function minOfPanel(id: string, m: Metrics): Size {
  if (id === "log") return { w: 160, h: m.title + m.logLine };
  if (id === "cmd") return { w: 160, h: m.title + m.line };
  if (id === "organiser") return { w: 110, h: m.title + Math.round(40 * m.scale) };
  return { w: 80, h: m.title + 20 };
}

/**
 * What panel `id` will not shrink below. A tray's is one button, either way it
 * runs: nothing makes a tray smaller on purpose, but a window shorter than its
 * line clips it, and one button and the strip are what must be left to take it
 * by.
 */
export function minSizeOf(id: string, orient: Orientation | undefined, tray: boolean, fitted?: Size, m: Metrics = FINE): Size {
  // A panel sized by its content is that size, or clipped; nothing shrinks it.
  if (fitted) return fitted;
  if (tray) return traySize(1, orient ?? "column", m);
  return minOfPanel(id, m);
}

/**
 * Where each panel is shown, from what the viewer stored and the defaults for
 * `area`: each held inside, then the whole set `settled` in `order`, so that a
 * layout stored before panels pushed, a window shrunk until the defaults would
 * overlap, or a tray grown for a new tool all come up with no panel over
 * another. `trays` is how many buttons each tray holds now.
 *
 * **A tray's size is never read from either.** Its position, the way it runs
 * and the lines it asks for are kept, and its size is `traySize` of the
 * buttons it has in the area's room: so one that gains a tool is a button
 * longer whether or not the viewer ever moved it, pushing whatever that
 * reaches, and one whose line no longer fits takes a second. The size is
 * still written with the rectangle, and simply never believed.
 *
 * `fitted` is the same rule for a panel that is not a tray but is sized by its
 * content — the options panel, by its rows: its size is the one given here,
 * whatever was stored, and only its position is the viewer's.
 */
export function arranged(
  order: readonly string[], stored: Layout, defaults: Layout,
  trays: Readonly<Record<string, number>>, area: Size,
  fitted: Readonly<Record<string, Size>> = {}, m: Metrics = FINE,
  fixed: Layout = {},
): { layout: Layout; ok: boolean } {
  // The fixed panels — the logo — first, exactly where they are: put down
  // before every other, they are what the rest is pushed out of the way of.
  const wanted: Layout = {};
  for (const [id, r] of Object.entries(fixed)) wanted[id] = { ...r, fixed: true };
  const minOf = (id: string, orient: Orientation | undefined) => minSizeOf(id, orient, id in trays, fitted[id], m);
  for (const id of order) {
    if (id in fixed) continue;
    const want = stored[id] ?? defaults[id] ?? { x: GAP, y: GAP, w: 200, h: 120 };
    const tray = id in trays;
    // A tray always runs some way; one with nothing stored or defaulted runs
    // the default's way, which is down.
    const orient = tray ? want.orient ?? "column" : undefined;
    const size = tray ? traySize(trays[id], orient!, m, trayRoom(area, orient!, m), want.lines) : fitted[id] ?? { w: want.w, h: want.h };
    wanted[id] = placed(constrain({ x: want.x, y: want.y, ...size }, area, minOf(id, orient)), orient, tray ? want.lines : undefined);
  }
  const all = [...Object.keys(fixed), ...order.filter((id) => !(id in fixed))];
  const mins = Object.fromEntries(all.map((id) => [id, id in fixed ? { w: fixed[id].w, h: fixed[id].h } : minOf(id, wanted[id].orient)]));
  return settled(wanted, all, area, mins);
}
// ---- insets: a panel to the very edge ---------------------------------------
//
// The owner, of his portrait screenshot: *"the command bar is not at the
// bottom. That is as far as I can drag it down. Please allow it to be dragged
// right to the bottom."* The layout's area is the safe area — inside the notch,
// the status bar, the rounded corners and the home indicator — so a panel's
// content is never under any of them. But **a panel touching the bottom edge
// extends its ground under the bottom inset and keeps its content clear of
// it**: iOS's own toolbar, which runs to the bottom of the glass with its
// buttons above the home indicator. That is `bleed`, and it is drawing only:
// every rule above — push, turn, the clamp — is about the rectangle inside the
// safe area, and none of it knows the inset exists.
//
// **Only the bottom.** It used to be every inset edge a panel touched, and on
// a landscape iPhone that read as a fault — the owner: *"when I move something
// up against the left or right edge, it hits an invisible edge, but then the
// padding of the palette expands out to touch the edge of the screen. Strange
// behaviour"*. The drag stops at the safe area's line, and then the box grew
// out under the cutout to the glass. A side inset is a cutout or a rounded
// corner, with nothing to keep clear of and nothing a panel's ground there
// does for anyone; the top inset is the status bar (Safari's; the installed
// app has none). The bottom is the one inset a docked panel's content must
// stand above and its ground may run under — the home indicator, Android's
// gesture bar. A pane against a side or the top is drawn exactly at its
// rectangle, the drawing visible under the inset. And since a bottom bleed
// only reaches down, below the safe area, where no pane's rectangle is, a bled
// pane never draws over another pane.

/** The safe area's insets from the window's edges, in CSS pixels (`env(safe-area-inset-*)`). */
export interface Insets { top: number; right: number; bottom: number; left: number }
export const NO_INSETS: Insets = { top: 0, right: 0, bottom: 0, left: 0 };

/**
 * Where a panel at `r` — in the area's coordinates, the safe area's — is drawn
 * in the window's, and how much of it is padding: touching the area's bottom
 * edge, it reaches down by the bottom inset, which it pads. Every other edge,
 * and a panel off the bottom, is drawn exactly where it is (see above: the
 * owner's *"the padding of the palette expands out to touch the edge of the
 * screen"*). `pad` keeps all four sides, three of them always 0, so the
 * stylesheet's padding rules stay one rule.
 */
export function bleed(r: Rect, area: Size, insets: Insets): { rect: Rect; pad: Insets } {
  const bottom = r.y + r.h >= area.h - EPS ? insets.bottom : 0;
  const pad: Insets = { top: 0, right: 0, bottom, left: 0 };
  return { rect: { x: insets.left + r.x, y: insets.top + r.y, w: r.w, h: r.h + bottom }, pad };
}

// ---- docking: what a panel rests against, kept through a rotation ----------
//
// The owner: *"if I push a toolbar right to one side, or up against another
// toolbar, that setting should persist if I change from landscape to portrait
// or vice versa."* A pixel position cannot do that — the right edge of a
// portrait phone is 390 px from its left, of a landscape one 844 — so what is
// stored for a panel the viewer has put somewhere is **what it rests
// against**: for each of its four sides, the area's edge, another panel by
// name, or nothing. Re-laid in a new area (`relaid`), a panel against the
// right edge is against the right edge, one against the toolbar's right is
// against the toolbar's right wherever the toolbar went, and one against
// nothing keeps its place in proportion to the room there is.

/** What one side of a panel rests against: the area's edge, or a panel by its id. */
export type Against = "edge" | string;
/** A panel's four sides, each against something or nothing. */
export interface Docking { left?: Against; right?: Against; top?: Against; bottom?: Against }

/** Two edges this close are touching: a push leaves them flush, so this is noise, not a snap. */
const TOUCH = 0.5;

/**
 * What each side of panel `id` rests against in `layout`, in `area`: the area's
 * edge before any panel; otherwise the panel whose facing edge it is flush
 * with and which it overlaps along that edge — the rule `contacts` uses for a
 * tray's turn, at a touch's distance rather than a snap's.
 */
export function dockingOf(id: string, layout: Layout, area: Size): Docking {
  const r = layout[id];
  const near = (a: number, b: number) => Math.abs(a - b) <= TOUCH;
  const d: Docking = {};
  if (near(r.x, 0)) d.left = "edge";
  if (near(r.x + r.w, area.w)) d.right = "edge";
  if (near(r.y, 0)) d.top = "edge";
  if (near(r.y + r.h, area.h)) d.bottom = "edge";
  for (const [o, q] of Object.entries(layout)) {
    if (o === id) continue;
    const alongX = overlap(r.x, r.x + r.w, q.x, q.x + q.w) > EPS;
    const alongY = overlap(r.y, r.y + r.h, q.y, q.y + q.h) > EPS;
    if (!d.left && alongY && near(r.x, q.x + q.w)) d.left = o;
    if (!d.right && alongY && near(r.x + r.w, q.x)) d.right = o;
    if (!d.top && alongX && near(r.y, q.y + q.h)) d.top = o;
    if (!d.bottom && alongX && near(r.y + r.h, q.y)) d.bottom = o;
  }
  return d;
}
/**
 * A panel the viewer has put somewhere, as it is stored: the rectangle it was
 * left at, the area and the interface size it was left in, what each of its
 * sides rested against (`dockingOf`) — and, along an axis on which neither
 * side rests on anything but the panel lies against another across that axis
 * (a log resting on the toolbar's top, its left free), how far along that
 * panel it was, so it stays on the same stretch of it.
 */
export interface Recorded extends Placed {
  area: Size;
  scale: number;
  dock: Docking;
  /** Its left less the left of the panel its top or bottom rests on, when neither its left nor its right rests on anything. */
  ox?: number;
  /** Likewise its top less the top of the panel its left or right rests on. */
  oy?: number;
}

/** What `id` is in `layout`, as it would be stored now. */
export function recorded(id: string, layout: Layout, area: Size, scale: number): Recorded {
  const r = layout[id];
  const dock = dockingOf(id, layout, area);
  const rec: Recorded = { ...placed(r, r.orient, r.lines), area: { w: area.w, h: area.h }, scale, dock };
  const panelOf = (...v: (Against | undefined)[]) => v.find((a) => a !== undefined && a !== "edge" && layout[a]);
  if (!dock.left && !dock.right) {
    const n = panelOf(dock.top, dock.bottom);
    if (n) rec.ox = r.x - layout[n].x;
  }
  if (!dock.top && !dock.bottom) {
    const n = panelOf(dock.left, dock.right);
    if (n) rec.oy = r.y - layout[n].y;
  }
  return rec;
}

/**
 * Where each panel of `recs` goes in `area` at interface size `scale`: what
 * every side of it rested against, it rests against again.
 *
 * `base` is every other panel, already placed — the fixed ones and those at
 * their defaults — which a recorded panel may rest against. `sizeOf` answers a
 * panel's size when its content fixes it (a tray's line, which way it runs)
 * and null for one the viewer sizes, whose recorded size is scaled with the
 * interface: a command line made 60 px tall at 1 is 78 at 1.3.
 *
 * Axis by axis, the same rule each way:
 *
 * - **Against something on one side**: flush with it — the edge, or the
 *   panel's facing edge wherever that panel has gone.
 * - **Against something on both**: a panel the viewer sizes is stretched
 *   between them — the command line docked to both sides of a portrait phone
 *   spans a landscape one too; a tray, whose length is its buttons', keeps the
 *   near side.
 * - **Against nothing on this axis, but resting on a panel across it**: the
 *   same distance along that panel as before (`ox`/`oy`), held so that it
 *   still lies along it — a log on the toolbar's top stays on the toolbar,
 *   and a pane beside a tray that wrapped in the rotation, and so got
 *   shorter, slides back along it rather than hanging off its end.
 * - **Against nothing at all**: the same share of the free room as before —
 *   halfway across a portrait phone is halfway across a landscape one.
 *
 * A panel waits for the panels it rests against to be placed first. Two that
 * rest on each other (a log against the toolbar's right is the toolbar against
 * the log's left) are a ring: the one with more sides against the area's edges
 * goes first, by those, and the other follows it. A side against a panel that
 * is gone — hidden, or never there — counts as against nothing.
 *
 * A tray whose line no longer fits along its run — a column down a portrait
 * phone, laid on its side — **wraps**, keeping the way it runs and its edges:
 * `sizeOf` answers the tray's size in this area, its lines included. (It used
 * to turn, which made a 599 px row along a landscape phone's right edge and
 * left no room beside it for a log; docs/plans/everything-fits.md.) Nothing
 * here holds a panel inside the area or keeps panels apart; that is
 * `arranged`'s, which this feeds.
 */
export function relaid(
  recs: Readonly<Record<string, Recorded>>, base: Layout, area: Size, scale: number,
  sizeOf: (id: string, orient: Orientation | undefined, lines?: number) => Size | null,
  minOf: (id: string, orient: Orientation | undefined) => Size,
): Layout {
  const ids = Object.keys(recs);
  const sizes: Record<string, Size> = {};
  const orients: Record<string, Orientation | undefined> = {};
  const stretchy = new Set<string>();
  for (const id of ids) {
    const rec = recs[id];
    const orient = rec.orient;
    let s = sizeOf(id, orient, rec.lines);
    if (!s) {
      stretchy.add(id);
      const k = scale / (rec.scale > 0 ? rec.scale : 1);
      s = { w: rec.w * k, h: rec.h * k };
    }
    orients[id] = orient;
    sizes[id] = s;
  }
  const known = new Set([...Object.keys(base), ...ids]);
  const solve = (axis: Axis): Map<string, [number, number]> => {
    const [lo, hi] = axis === "x" ? ["left", "right"] as const : ["top", "bottom"] as const;
    const across = axis === "x" ? ["top", "bottom"] as const : ["left", "right"] as const;
    const roomNow = room(area, axis);
    const done = new Map<string, [number, number]>();
    for (const [id, r] of Object.entries(base)) done.set(id, [start(r, axis), span(r, axis)]);
    // A side against a panel that is not here is against nothing.
    const ref = (v: Against | undefined) => (v === "edge" || (v !== undefined && known.has(v)) ? v : undefined);
    const panelAcross = (id: string) => {
      const d = recs[id].dock;
      return across.map((s) => ref(d[s])).find((v) => v !== undefined && v !== "edge");
    };
    const offset = (id: string) => (axis === "x" ? recs[id].ox : recs[id].oy);
    const deps = (id: string): string[] => {
      const d = recs[id].dock;
      const sides = [ref(d[lo]), ref(d[hi])].filter((v) => v !== undefined);
      if (sides.length) return sides.filter((v): v is string => v !== "edge");
      const n = panelAcross(id);
      return n !== undefined && offset(id) !== undefined ? [n] : [];
    };
    const place = (id: string): [number, number] => {
      const rec = recs[id];
      const d = rec.dock;
      const len = axis === "x" ? sizes[id].w : sizes[id].h;
      const l = ref(d[lo]);
      const h = ref(d[hi]);
      const a = l === "edge" ? 0 : l !== undefined && done.has(l) ? done.get(l)![0] + done.get(l)![1] : null;
      const b = h === "edge" ? roomNow : h !== undefined && done.has(h) ? done.get(h)![0] : null;
      if (a !== null && b !== null) {
        const least = axis === "x" ? minOf(id, orients[id]).w : minOf(id, orients[id]).h;
        return stretchy.has(id) ? [a, Math.max(least, b - a)] : [a, len];
      }
      if (a !== null) return [a, len];
      if (b !== null) return [b - len, len];
      const n = panelAcross(id);
      const off = offset(id);
      if (n !== undefined && off !== undefined && done.has(n)) {
        const [np, nl] = done.get(n)!;
        // Wholly along it where it is the shorter, else covering it: a
        // neighbour that got shorter (a tray that wrapped) is not left with a
        // pane hanging off its corner by a pixel of overlap.
        return [len <= nl ? clamp(np + off, np, np + nl - len) : clamp(np + off, np + nl - len, np), len];
      }
      // In the same room it was put in, exactly where it was put — though its
      // size may have changed since (a tray re-measured for a new tool).
      if (Math.abs(room(rec.area, axis) - roomNow) <= EPS) return [clamp(start(rec, axis), 0, roomNow - len), len];
      // In another, the same share of the free room it had then.
      const free = room(rec.area, axis) - span(rec, axis);
      const share = free > EPS ? clamp(start(rec, axis) / free, 0, 1) : 0;
      return [share * Math.max(0, roomNow - len), len];
    };
    let todo = ids.slice();
    while (todo.length) {
      const ready = todo.filter((id) => deps(id).every((v) => done.has(v)));
      if (ready.length) {
        for (const id of ready) done.set(id, place(id));
        todo = todo.filter((id) => !ready.includes(id));
        continue;
      }
      // A ring. The one held by more of the area's edges goes first, on those.
      const edges = (id: string) => [lo, hi].filter((s) => recs[id].dock[s] === "edge").length;
      const first = todo.reduce((best, id) => (edges(id) > edges(best) ? id : best));
      done.set(first, place(first));
      todo = todo.filter((id) => id !== first);
    }
    return done;
  };
  const xs = solve("x");
  const ys = solve("y");
  const out: Layout = {};
  for (const id of ids) {
    const [x, w] = xs.get(id)!;
    const [y, h] = ys.get(id)!;
    out[id] = placed({ x, y, w, h }, orients[id], recs[id].lines);
  }
  return out;
}

// ---- what is stored ---------------------------------------------------------

/**
 * One panel as stored: where the viewer put it (`at`, absent while it is at
 * its default) and whether they hid it from the app menu (`hidden`, the
 * owner's *"a show hide for the panes"*). Both the viewer's, per device, like
 * every arrangement; a hidden panel keeps its `at`, so it comes back where it
 * was.
 */
export interface StoredPanel { at?: Recorded; hidden?: boolean }
export type Stored = Record<string, StoredPanel>;

/**
 * Where the layout is stored now: v3, a panel's docking and its area with its
 * rectangle (`Recorded`). v2 (`STORAGE_KEY`) was rectangles alone; it is read
 * once and migrated — its rectangles docked where they lie (`recorded`) — then
 * removed, so a viewer's arrangement survives the change of format.
 */
export const LAYOUT_KEY = "neocad.panels.v3";

const SIDES = ["left", "right", "top", "bottom"] as const;

function isSize(v: unknown): v is Size {
  if (!v || typeof v !== "object") return false;
  const r = v as Record<string, unknown>;
  return ["w", "h"].every((k) => typeof r[k] === "number" && Number.isFinite(r[k]) && (r[k] as number) > 0);
}

/** A stored `Recorded`, read leniently: anything malformed in it is null, a side that is not one is dropped alone. */
function parseRecorded(v: unknown): Recorded | null {
  if (!isRect(v)) return null;
  const r = v as unknown as Record<string, unknown>;
  if (!isSize(r.area)) return null;
  const scale = typeof r.scale === "number" && Number.isFinite(r.scale) && r.scale > 0 ? r.scale : 1;
  const dock: Docking = {};
  const raw = r.dock && typeof r.dock === "object" ? r.dock as Record<string, unknown> : {};
  for (const side of SIDES) if (typeof raw[side] === "string") dock[side] = raw[side] as string;
  const out: Recorded = { x: v.x, y: v.y, w: v.w, h: v.h, area: { w: r.area.w, h: r.area.h }, scale, dock };
  if (r.orient === "row" || r.orient === "column") out.orient = r.orient;
  if (out.orient && typeof r.lines === "number" && Number.isInteger(r.lines) && r.lines > 1) out.lines = r.lines;
  if (typeof r.ox === "number" && Number.isFinite(r.ox)) out.ox = r.ox;
  if (typeof r.oy === "number" && Number.isFinite(r.oy)) out.oy = r.oy;
  return out;
}

/** A stored v3 layout, read leniently: a panel whose entry is malformed is dropped, and so goes back to its default. */
export function parseStored(text: string | null): Stored {
  if (!text) return {};
  let raw: unknown;
  try {
    raw = JSON.parse(text);
  } catch {
    return {};
  }
  const panels = raw && typeof raw === "object" ? (raw as { panels?: unknown }).panels : null;
  if (!panels || typeof panels !== "object" || Array.isArray(panels)) return {};
  const out: Stored = {};
  for (const [id, v] of Object.entries(panels as Record<string, unknown>)) {
    if (!v || typeof v !== "object") continue;
    const e = v as { at?: unknown; hidden?: unknown };
    const at = e.at === undefined ? null : parseRecorded(e.at);
    const entry: StoredPanel = {};
    if (at) entry.at = at;
    // `false` was a pane shown that started hidden on this device; every pane starts shown now, so it reads as shown.
    if (typeof e.hidden === "boolean") entry.hidden = e.hidden;
    if (entry.at || entry.hidden !== undefined) out[id] = entry;
  }
  return out;
}

/**
 * What is stored: the v3 layout, and — only when there is none yet — the v2
 * rectangles, for the panel manager to migrate against the area it has (a
 * docking needs an area to be against, which only the page knows). Never
 * throws.
 */
export function loadStored(storage: StorageLike | null): { stored: Stored; legacy: Layout | null } {
  if (!storage) return { stored: {}, legacy: null };
  try {
    const text = storage.getItem(LAYOUT_KEY);
    if (text !== null) return { stored: parseStored(text), legacy: null };
    const old = loadLayout(storage);
    return { stored: {}, legacy: Object.keys(old).length ? old : null };
  } catch {
    return { stored: {}, legacy: null };
  }
}

/**
 * Stores the layout as v3, and removes v2's key — the migration's last step,
 * and harmless every time after. An empty layout removes v3's key too, so a
 * reset leaves nothing behind. Returns whether it was stored; never throws.
 */
export function saveStored(storage: StorageLike | null, stored: Stored): boolean {
  if (!storage) return false;
  try {
    if (Object.keys(stored).length === 0) storage.removeItem(LAYOUT_KEY);
    else storage.setItem(LAYOUT_KEY, JSON.stringify({ panels: stored }));
    storage.removeItem(STORAGE_KEY);
    return true;
  } catch {
    return false;
  }
}

/** A v2 layout's rectangles as v3 entries: each docked against what it lies against in `area`. */
export function migrated(legacy: Layout, area: Size, scale: number): Stored {
  const out: Stored = {};
  for (const id of Object.keys(legacy)) out[id] = { at: recorded(id, legacy, area, scale) };
  return out;
}


// ---- the options panel's size and place -------------------------------------

/** One option's row in the options panel: a label, a field and the unit, on one line. */
export const OPTION_ROW = 22;
/** The options panel's width: room for a short label, a field of a few digits and a unit. */
export const OPTIONS_W = 168;

/**
 * The options panel's size for `rows` options — its strip, 3px of padding top
 * and bottom, the border, and a row apiece. Like `traySize`, the one thing that
 * sizes it: it has no grips, and a stored size is never read (`arranged`).
 */
export function optionsSize(rows: number, m: Metrics = FINE): Size {
  return { w: m.optionsW, h: m.title + 8 + rows * m.optionRow };
}

/**
 * Where a panel of `size` goes by default: beside the tray, on the side of it
 * the window has room on — right of a column on the left half, left of one on
 * the right; below a row in the top half, above one in the bottom — lined up
 * with the tray's near end, a margin off it, and held inside. The options
 * panel's default, so it comes up where the eye already is, next to the button
 * that armed the tool, wherever the viewer has put the tray.
 */
/**
 * Where a panel of `size` goes when the defaults name a box for it rather
 * than a tray to go beside: flush in the box's bottom-right corner, held
 * inside the area. A phone's options panel, above the action strip.
 */
export function inCorner(box: Rect, size: Size, area: Size): Rect {
  return constrain({ x: box.x + box.w - size.w, y: box.y + box.h - size.h, ...size }, area, size);
}

export function besideTray(tray: Placed, size: Size, area: Size): Rect {
  const row = tray.orient === "row";
  const x = row ? tray.x : tray.x + tray.w / 2 <= area.w / 2 ? tray.x + tray.w + GAP : tray.x - GAP - size.w;
  const y = !row ? tray.y : tray.y + tray.h / 2 <= area.h / 2 ? tray.y + tray.h + GAP : tray.y - GAP - size.h;
  return constrain({ x, y, ...size }, area, size);
}

/**
 * Where a fitted panel of `size` (the options panel) goes by default: in the
 * corner of the box the defaults name for it (`inCorner`), else beside the
 * tray it belongs to as that tray was laid out (`besideTray`), else the area's
 * top-left. What `Panels.apply` does, as a function, so a test lays out what
 * the page does.
 */
export function fittedAt(box: Rect | undefined, tray: Placed | undefined, size: Size, area: Size): Rect {
  if (box) return inCorner(box, size, area);
  if (tray) return besideTray(tray, size, area);
  return { x: GAP, y: GAP, ...size };
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
 * running — `row ×2` for one wrapped onto a second line — and whether it was
 * moved.
 */
export function describeLayout(shown: Layout, stored: Layout, m: Metrics = FINE): string {
  return Object.entries(shown).map(([id, r]) => {
    const lines = r.orient ? linesOf(r, m) : 1;
    return `${id.padEnd(8)} ${Math.round(r.x)},${Math.round(r.y)}  ${Math.round(r.w)}x${Math.round(r.h)}` +
      (r.orient ? `  ${r.orient}${lines > 1 ? ` ×${lines}` : ""}` : "") + (id in stored ? "" : "  (default)");
  }).join("\n");
}

/**
 * Whether a layout `show` is about to draw breaks the rule — and if so, what to
 * say: two panels over one another, or (`ok` false) the resolver having found
 * no layout at all, which is the same thing about to happen. Null for a sound
 * layout. The owner: *"everything has to fit"* — so a layout that does not is
 * never drawn silently (docs/plans/everything-fits.md); pure, so the rule is
 * tested where the rest of the geometry is.
 */
export function layoutProblem(layout: Layout, ok: boolean, area: Size): string | null {
  const bad = overlapping(layout);
  if (ok && bad.length === 0) return null;
  const where = `in ${Math.round(area.w)}x${Math.round(area.h)}: ${JSON.stringify(layout)}`;
  if (!ok) return `panels: no layout fits${bad.length ? ` (${bad.map((p) => p.join(" over ")).join(", ")})` : ""} ${where}`;
  return `panels overlap: ${bad.map((p) => p.join(" and ")).join(", ")} ${where}`;
}

// ---- the DOM half -----------------------------------------------------------

/** The lowest panel's z-index; index.html puts the hover tag and menu well above any stack. */
const PANEL_Z = 10;
/**
 * A gesture's ghosts, and over them the held panel (one more), for the drag:
 * over the corner's status (40) and the logo (45) — a ghost may land in the
 * logo's row, where the corner's text keeps clear of panes only once they are
 * placed — and under the hover tag and the menus (50 and up), which belong
 * over everything.
 */
const LIFTED_Z = 46;

/** `r` running `orient`, asking for at least `lines` — or, for a panel that is not a tray, just `r`. */
function placed(r: Rect, orient: Orientation | undefined, lines?: number): Placed {
  if (!orient) return { x: r.x, y: r.y, w: r.w, h: r.h };
  return lines !== undefined && lines > 1 ? { x: r.x, y: r.y, w: r.w, h: r.h, orient, lines } : { x: r.x, y: r.y, w: r.w, h: r.h, orient };
}

/**
 * Every `.panel[data-panel]` inside an area, placed, draggable, and — but for
 * a tray — resizable.
 *
 * Holds two layouts and keeps them apart deliberately. `stored` is what the
 * viewer *asked for* — only the panels they have touched, as they left them,
 * with what each rested against — and is what persists. What is on screen is
 * that re-laid in the area as it is now (`relaid`), or the default for an
 * untouched panel, then held inside and kept apart (`arranged`). So shrinking
 * the window pulls panels in without forgetting where they were put, widening
 * it puts them back, and turning a phone keeps a panel docked to the right
 * edge on the right edge.
 *
 * The area is the element's box less the safe-area `insets`; a panel touching
 * the bottom edge is drawn reaching under the bottom inset, padded by it
 * (`bleed`); at the sides and the top, exactly at its rectangle. `fixed`
 * names the panels nothing moves — the logo — each an element placed at the
 * area's top-left at the size it answers, which the others are pushed against
 * and docked to like any panel.
 *
 * `trays` names the panels that are trays, each with how many buttons it holds
 * right now: those, and only those, have no grips, are a line of
 * their buttons, wrapped where one does not fit (`traySize`, re-counted on every `apply`), and turn between
 * column and row as they are dragged against an edge (`turned`).
 *
 * `fitted` names the panels sized by their content that come and go — the
 * options panel: each has no grips, is exactly the size its `size` answers,
 * and is hidden while that answers null. Shown, it is placed after every other
 * panel (so it is the one moved out of the way of a panel already down), at
 * its stored position or else `beside` the tray it names (`besideTray`).
 *
 * Any panel can be hidden by the viewer (`setShown`, the app menu's Panes):
 * hidden, it is out of the page and out of the layout, and its place is kept.
 *
 * Every arrangement goes through `pushed`: a drag, a resize, a turn, and (by
 * `settled`) every `apply`. So no two panels are ever shown overlapping while
 * the window has room for them all. `check` asks for that to be verified after
 * every placement and reported on the page when it fails — for the tests.
 */
export interface Fitted {
  /** The panel's size now, or null while it is not shown. */
  size(): Size | null;
  /** The tray it goes beside when the viewer has not put it anywhere. */
  beside?: string;
}

/** A panel nothing moves: its element, and its size now (it sits at the area's top-left). */
export interface Fixed {
  el: HTMLElement;
  size(): Size;
}

/**
 * A panel's strip's tooltip: the pane's name, and what dragging it does. No
 * command: a strip types nothing — where the panels are is the viewer's, never
 * a line in the log.
 */
export function stripTip(label: string, tray: boolean, locked = false): Tip {
  if (locked) return { name: label, summary: "The panels are locked where they are", off: "unlock them in the menu's View" };
  return {
    name: label,
    summary: tray ? "Drag to move it; against an edge it turns to fit and stays there"
      : "Drag to move it; along its edge past another pane the two trade places",
  };
}

/**
 * A see-through pane under the hand. **A mouse over it** gives it its box
 * back — ground, border, strip — under the same content (`hand`), for as long
 * as it is there and this long after it leaves (so the gap between two rows is
 * not a flicker): a row reads against a busy drawing and the strip is there to
 * drag by, and the organiser stays the tree it was, so the pointer reaching a
 * root to open it does not turn it into another layout under itself. **A
 * press on its content** — any hand's — brings its docked form wholly, the
 * organiser's every column and the log's every line (`pinned`), until the
 * next press outside it: a finger has no hover, and this is how it reaches a
 * strip. A control of the see-through form's own (a tree root's disclosure)
 * pins nothing: it is there to be used see-through.
 */
export const HAND_LINGER_MS = 150;

/** The panes that are never see-through: the options panel (and the feature dialog it holds) is read and typed into, not looked through. */
export const OPAQUE_PANES: readonly string[] = ["options"];

/** One panel as the app menu lists it: its id, the name it shows, and whether it is shown. */
export interface Pane { id: string; label: string; shown: boolean }

export class Panels {
  private area: HTMLElement;
  private storage: StorageLike | null;
  private defaults: (area: Size) => Layout;
  private trays: Record<string, () => number>;
  private fitted: Record<string, Fitted>;
  private fixed: Record<string, Fixed>;
  private insets: () => Insets;
  /** Told the layout after every placement — the corner's text keeps clear of it. */
  private onShow: ((layout: Layout, area: Size, insets: Insets) => void) | undefined;
  private stored: Stored;
  /** A v2 layout read at load, migrated against the first area there is. */
  private legacy: Layout | null;
  private els = new Map<string, HTMLElement>();
  /** Where each panel is on screen right now — what a gesture starts from. Fixed panels included. */
  private shown: Layout = {};
  /** Back to front. The panel last pressed is drawn over the others. */
  private order: string[] = [];
  private check: boolean;
  /** A gesture is in progress; `apply` waits for it (`stale`) rather than undo its pushes. */
  private holding = false;
  private stale = false;
  /** The chrome's sizes: the mouse's, or a finger's, at the interface size (see `Metrics`). */
  private m: Metrics;
  /** The insets the last `apply` laid out against — a gesture's pointer is offset by them. */
  private inset: Insets = NO_INSETS;
  /** Gives each panel's strip its tooltip, where the host has them. */
  private tooltip: AttachTip | undefined;
  /** Told, in a few words, when a drop is refused — the host puts it in the status. */
  private onRefused: ((text: string) => void) | undefined;
  /** Where a gesture's ghosts are drawn: over the other panels, under the held one. */
  private ghostLayer: HTMLElement;
  private ghosts = new Map<string, HTMLElement>();
  private settleTimer: ReturnType<typeof setTimeout> | undefined;
  /** See-through and locked (docs/plans/panels-overlay-lock.md): the viewer's, stored beside the layout. */
  private switches: PanelSwitches;
  /** Told when a press on a locked pane's strip did nothing — the host puts it in the chip's guidance. */
  private onLocked: ((text: string) => void) | undefined;
  /** Told when a locked layout had to be re-fitted to a new area — the host says it in the status. */
  private onRefit: ((text: string) => void) | undefined;
  /** The stored places the last `apply` had to give up (`refit`), so a re-fit is said once, not on every apply. */
  private gaveUp = "";
  /** The area the last `apply` laid out in: a change is a rotation or a resize. */
  private lastArea: Size | null = null;
  /** See-through panes a press put in docked form, until the next press outside them. */
  private pinned = new Set<string>();
  private lingers = new Map<string, ReturnType<typeof setTimeout>>();

  constructor(
    area: HTMLElement, defaults: (area: Size) => Layout, storage: StorageLike | null,
    trays: Record<string, () => number> = {},
    options: {
      check?: boolean; fitted?: Record<string, Fitted>; metrics?: Metrics;
      fixed?: Record<string, Fixed>; insets?: () => Insets;
      tooltip?: AttachTip; onShow?: (layout: Layout, area: Size, insets: Insets) => void;
      onRefused?: (text: string) => void;
      onLocked?: (text: string) => void; onRefit?: (text: string) => void;
    } = {},
  ) {
    this.tooltip = options.tooltip;
    this.onRefused = options.onRefused;
    this.onLocked = options.onLocked;
    this.onRefit = options.onRefit;
    this.switches = loadSwitches(storage);
    this.onShow = options.onShow;
    this.m = options.metrics ?? FINE;
    this.area = area;
    this.defaults = defaults;
    this.storage = storage;
    this.trays = trays;
    this.fitted = options.fitted ?? {};
    this.fixed = options.fixed ?? {};
    this.insets = options.insets ?? (() => NO_INSETS);
    this.check = options.check ?? false;
    const loaded = loadStored(storage);
    this.stored = loaded.stored;
    this.legacy = loaded.legacy;
    for (const el of Array.from(area.querySelectorAll<HTMLElement>(".panel[data-panel]"))) {
      const id = el.dataset.panel!;
      this.els.set(id, el);
      this.order.push(id);
      this.wire(id, el);
    }
    this.ghostLayer = document.createElement("div");
    this.ghostLayer.className = "pghosts";
    this.ghostLayer.hidden = true;
    area.appendChild(this.ghostLayer);
    // A press anywhere but on a pinned see-through pane puts it back to see-through.
    window.addEventListener("pointerdown", (e) => {
      if (!this.pinned.size) return;
      const at = e.target instanceof Node ? e.target : null;
      for (const id of [...this.pinned]) {
        if (at && this.els.get(id)?.contains(at)) continue;
        this.pinned.delete(id);
        this.handOf(id);
      }
    }, true);
    this.drawSwitches();
    this.restack();
    new ResizeObserver(() => this.apply()).observe(area);
    this.apply();
  }

  /** The safe area's size: the element's box less the insets. */
  private size(): Size {
    const i = this.inset;
    return { w: Math.max(0, this.area.clientWidth - i.left - i.right), h: Math.max(0, this.area.clientHeight - i.top - i.bottom) };
  }

  private min(id: string, orient: Orientation | undefined): Size {
    return minSizeOf(id, orient, id in this.trays, this.fitted[id]?.size() ?? undefined, this.m);
  }

  private fixedLayout(): Layout {
    return Object.fromEntries(Object.entries(this.fixed).map(([id, f]) => [id, { x: 0, y: 0, ...f.size(), fixed: true }]));
  }

  /**
   * Whether the viewer has hidden `id`. Every pane starts shown — the
   * organiser on a phone too (the owner: *"show from start"*; it used to
   * start hidden there, docs/plans/organiser.md), in a place the defaults keep
   * for it in both orientations.
   */
  private hiddenByViewer(id: string): boolean {
    return this.stored[id]?.hidden ?? false;
  }

  /**
   * Puts every panel where the layouts say, clear of one another (`arranged`),
   * each tray the lines of the buttons it has now and each stored panel docked
   * as it was (`relaid`). Cheap; call it whenever a default, a tray's count,
   * the insets or the interface size may have changed. What it moves is not
   * stored: it is this window's answer, and a wider one may need none of it.
   */
  apply(): void {
    // Mid-gesture the gesture owns the layout: putting the panels back where
    // the stored layout says would throw away the pushes it has made so far.
    if (this.holding) { this.stale = true; return; }
    this.inset = this.insets();
    const area = this.size();
    if (this.legacy) {
      // The v2 layout, docked where it lies, now that there is an area for it
      // to lie in — and written back as v3 at once, so it migrates only once.
      this.stored = { ...migrated(this.legacy, area, this.m.scale), ...this.stored };
      this.legacy = null;
      saveStored(this.storage, this.stored);
    }
    const counts = Object.fromEntries(Object.entries(this.trays).map(([id, n]) => [id, n()]));
    const order: string[] = [];
    const later: string[] = [];
    const sizes: Record<string, Size> = {};
    for (const [id, el] of this.els) {
      const f = this.fitted[id];
      const size = f ? f.size() : undefined;
      const off = this.hiddenByViewer(id) || size === null;
      el.hidden = off;
      if (off) { delete this.shown[id]; continue; }
      if (!f) { order.push(id); continue; }
      sizes[id] = size!;
      later.push(id);
    }
    const fixed = this.fixedLayout();
    for (const [id, r] of Object.entries(fixed)) this.placeFixed(id, r);
    const stored: Record<string, Recorded> = {};
    for (const id of [...order, ...later]) if (this.stored[id]?.at) stored[id] = this.stored[id].at!;
    const sizeOf = (id: string, orient: Orientation | undefined, lines?: number): Size | null =>
      id in counts ? traySize(counts[id], orient ?? "column", this.m, trayRoom(area, orient ?? "column", this.m), lines) : sizes[id] ?? null;
    const minOf = (id: string, orient: Orientation | undefined) => this.min(id, orient);
    const all = [...order, ...later];
    // The layout from the stored places of `keep` (the rest at their defaults).
    let defaults: Layout = {};
    let wanted: Layout = {};
    const attempt = (keep: readonly string[]) => {
      const recs = Object.fromEntries(keep.map((id) => [id, stored[id]]));
      defaults = this.defaults(area);
      const relay = (base: Layout) => relaid(recs, base, area, this.m.scale, sizeOf, minOf);
      const unstored = (ids: string[], from: Layout) =>
        Object.fromEntries(ids.filter((id) => !recs[id] && from[id]).map((id) => [id, from[id]]));
      if (later.length) {
        // Earlier panels hold their places in `settled`, so the tray is where the
        // panels without the fitted ones put it — which is what "beside" means.
        const base0 = { ...fixed, ...unstored(order, defaults) };
        const first = arranged(order, relay(base0), defaults, counts, area, {}, this.m, fixed).layout;
        for (const id of later) defaults[id] = fittedAt(defaults[id], first[this.fitted[id].beside ?? ""], sizes[id], area);
      }
      wanted = relay({ ...fixed, ...unstored(all, defaults) });
      return arranged(all, wanted, defaults, counts, area, sizes, this.m, fixed);
    };
    const { result: s, dropped } = refit(attempt, Object.keys(stored));
    // Stored places this area could not hold all of: the panes in the way were
    // put at their defaults for this area — said, never stored, so turning back
    // puts every pane where it was left (the owner's landscape picture had the
    // log drawn over the command line's body, the resolver's no-layout drawn
    // as it stood).
    const gaveUp = dropped.join(" ");
    const newly = gaveUp !== "" && gaveUp !== this.gaveUp;
    this.gaveUp = gaveUp;
    if (newly && !this.switches.locked) this.onRefit?.(REFIT_UNLOCKED_NOTE);
    // A locked layout re-fitted to a new area (a rotation) is said, once — the
    // area changed on this apply only: the lock holds the panes against a
    // hand, and the resolver still runs. The
    // re-fit is not stored, so turning back puts each where it was locked.
    const turned = this.lastArea !== null && (this.lastArea.w !== area.w || this.lastArea.h !== area.h);
    this.lastArea = area;
    if (this.switches.locked) {
      if ((turned && refitted({ ...defaults, ...wanted }, s.layout, all).length) || newly) this.onRefit?.(REFIT_NOTE);
    }
    this.show(s.layout, s.ok);
  }

  /** See-through and locked, as they are now. */
  getSwitches(): PanelSwitches {
    return { ...this.switches };
  }

  /**
   * Sets the switches — the viewer's, stored at once beside the layout — and
   * draws them: see-through is a class on the area the stylesheet draws every
   * pane's own form from; locked hides the strips and the grips and refuses
   * every gesture. Neither moves a pane: the layout is the same rectangles
   * either way, which is why everything that fits docked fits see-through.
   */
  setSwitches(s: PanelSwitches): void {
    this.switches = { overlay: s.overlay, locked: s.locked };
    saveSwitches(this.storage, this.switches);
    if (!s.overlay) {
      this.pinned.clear();
      for (const t of this.lingers.values()) clearTimeout(t);
      this.lingers.clear();
    }
    for (const id of this.els.keys()) this.handOf(id);
    this.drawSwitches();
  }

  private drawSwitches(): void {
    this.area.classList.toggle("overlay", this.switches.overlay);
    this.area.classList.toggle("locked", this.switches.locked);
  }

  /** Whether pane `id` is drawn in its docked form now: the hand on it, pinned by a press, or held. */
  private handOf(id: string): void {
    const el = this.els.get(id);
    el?.classList.toggle("hand", this.switches.overlay && this.mouseOver.has(id));
    el?.classList.toggle("pinned", this.switches.overlay && this.pinned.has(id));
  }

  /** The panes a mouse is over now (a finger's enter and leave are a tap's, not a hover). */
  private mouseOver = new Set<string>();

  /**
   * Puts each panel where `layout` says. A layout with two panels overlapping,
   * or one the resolver could not find (`sound` false: a window too small to
   * hold them all at their least), is never drawn silently (`layoutProblem`):
   * with `check` on (the dev server, and so every e2e run) it is reported as an
   * error on the page, which every e2e test's "no page errors" trips; in a
   * built page, a warning in the console.
   */
  private show(layout: Layout, sound = true): void {
    for (const [id, r] of Object.entries(layout)) {
      if (r.fixed) { this.shown[id] = r; continue; }
      const el = this.els.get(id);
      if (el && this.shown[id] !== r) this.place(id, el, r);
    }
    const problem = layoutProblem(this.shown, sound, this.size());
    // Reported, not thrown: thrown from here it would break the very gesture
    // that showed it, where the point is to see it and carry on.
    if (problem && this.check) reportError(new Error(problem));
    else if (problem) console.warn(problem);
    this.onShow?.(this.shown, this.size(), this.inset);
  }

  private placeFixed(id: string, r: Placed): void {
    const el = this.fixed[id].el;
    el.style.left = `${this.inset.left + r.x}px`;
    el.style.top = `${this.inset.top + r.y}px`;
    el.style.width = `${r.w}px`;
    el.style.height = `${r.h}px`;
    this.shown[id] = r;
  }

  private place(id: string, el: HTMLElement, r: Placed): void {
    this.shown[id] = r;
    this.draw(el, r);
  }

  /** Draws `el` at `r` — the DOM half of `place`, and how the held panel is drawn mid-gesture without being placed. */
  private draw(el: HTMLElement, r: Placed): void {
    // Drawn reaching under the bottom inset if it touches the bottom, its
    // content padded clear of it; the rectangle it is in the layout is `r`.
    const { rect, pad } = bleed(r, this.size(), this.inset);
    el.style.left = `${rect.x}px`;
    el.style.top = `${rect.y}px`;
    el.style.width = `${rect.w}px`;
    el.style.height = `${rect.h}px`;
    el.style.padding = pad.top || pad.right || pad.bottom || pad.left ? `${pad.top}px ${pad.right}px ${pad.bottom}px ${pad.left}px` : "";
    // The grips sit in the corners of the content, not out under the inset —
    // a grip under the home indicator is a swipe the system takes.
    for (const [k, v] of [["--pad-t", pad.top], ["--pad-r", pad.right], ["--pad-b", pad.bottom], ["--pad-l", pad.left]] as const) {
      el.style.setProperty(k, `${v}px`);
    }
    // The corner its see-through content hugs, from where it is in the area.
    const hug = hugOf(r, this.size());
    if (el.dataset.hug !== hug) el.dataset.hug = hug;
    const bled = (["top", "right", "bottom", "left"] as const).filter((side) => pad[side] > 0).join(" ");
    if (bled) el.dataset.bleed = bled;
    else delete el.dataset.bleed;
    const strip = el.querySelector<HTMLElement>(":scope > .ptitle");
    if (r.orient && el.dataset.orient !== r.orient) el.dataset.orient = r.orient;
    if (r.orient) {
      // How many buttons a line holds, for the stylesheet's grid: read off the
      // run, which `traySize` made a whole number of them.
      const run = r.orient === "row" ? r.w : r.h;
      const per = Math.max(1, Math.round((run - this.m.title - 6) / (this.m.button + this.m.gap)));
      el.querySelector<HTMLElement>(":scope > .tray")?.style.setProperty("--per", String(per));
      el.dataset.lines = String(linesOf(r, this.m));
    }
    if (strip && r.orient) {
      // The stylesheet turns the body and moves the strip on the attribute;
      // the strip's thickness is set here, from the metrics, as for every strip.
      strip.style.height = r.orient === "column" ? `${this.m.title}px` : "";
      strip.style.width = r.orient === "row" ? `${this.m.title}px` : "";
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

  /**
   * New sizes — the interface size changed (`ui({ scale })`): every strip
   * re-sized, every tray re-measured, and the layout laid out again, a panel
   * the viewer sized scaled with the rest.
   */
  setMetrics(m: Metrics): void {
    this.m = m;
    for (const [id, el] of this.els) {
      const strip = el.querySelector<HTMLElement>(":scope > .ptitle");
      if (strip && !(id in this.trays)) strip.style.height = `${m.title}px`;
      // A tray's strip follows its orientation; forgetting it makes `place` set it again.
      if (id in this.trays) delete el.dataset.orient;
    }
    this.shown = {};
    this.apply();
  }

  /** Every panel there is, in the page's order, with the name it shows and whether it is shown — the app menu's Panes. */
  panes(): Pane[] {
    return [...this.els.keys()].map((id) => {
      const el = this.els.get(id)!;
      const strip = el.querySelector<HTMLElement>(":scope > .ptitle");
      const label = el.dataset.label ?? strip?.title ?? strip?.textContent ?? id;
      return { id, label: label || id, shown: !this.hiddenByViewer(id) };
    });
  }

  /**
   * Shows or hides panel `id` — the viewer's, stored with the layout. Hidden,
   * its place is kept: shown again, it comes back where it was, and what has
   * moved into that place since is pushed out of its way. Throws for an id
   * that is not a panel, naming those there are.
   */
  setShown(id: string, shown: boolean): void {
    if (!this.els.has(id)) {
      throw new Error(`there is no "${id}" pane — the panes are ${[...this.els.keys()].map((k) => JSON.stringify(k)).join(", ")}`);
    }
    const entry = { ...this.stored[id] };
    if (shown) delete entry.hidden;
    else entry.hidden = true;
    if (entry.at || entry.hidden !== undefined) this.stored[id] = entry;
    else delete this.stored[id];
    saveStored(this.storage, this.stored);
    if (shown) this.raise(id);
    this.apply();
  }

  /** Forgets every arrangement — this viewer's, in this browser, hidden panes too — and goes back to the defaults. */
  reset(): string {
    this.stored = {};
    saveStored(this.storage, this.stored);
    this.apply();
    return "layout reset to the defaults";
  }

  report(): string {
    const at = Object.fromEntries(Object.entries(this.stored).filter(([, e]) => e.at).map(([id, e]) => [id, e.at!]));
    const panels = Object.fromEntries(Object.entries(this.shown).filter(([, r]) => !r.fixed));
    const hidden = [...this.els.keys()].filter((id) => this.hiddenByViewer(id));
    const area = this.size();
    const i = this.inset;
    // The window and the insets as the page measured them: on a phone this is
    // the one place to read what iOS actually reported.
    const where = `window ${this.area.clientWidth}x${this.area.clientHeight}, insets ${i.top} ${i.right} ${i.bottom} ${i.left}` +
      ` (top right bottom left), panels' area ${Math.round(area.w)}x${Math.round(area.h)}`;
    return [describeLayout(panels, at, this.m), ...(hidden.length ? [`hidden   ${hidden.join(", ")}`] : []), where].join("\n");
  }

  /**
   * Stores what a gesture changed: each panel it moved, docked against what it
   * now rests on; and each stored panel that rested on one of those, re-docked
   * where it now is — its neighbour has gone, and a docking to where the
   * neighbour was would pull it after it on the next rotation.
   */
  private remember(start: Layout): boolean {
    const area = this.size();
    const moved = Object.keys(this.shown).filter((o) => {
      const now = this.shown[o];
      const was = start[o];
      return !now.fixed && !(was && now.x === was.x && now.y === was.y && now.w === was.w && now.h === was.h && now.orient === was.orient);
    });
    if (!moved.length) return false;
    const touched = new Set(moved);
    for (const [o, e] of Object.entries(this.stored)) {
      if (!e.at || !this.shown[o] || touched.has(o)) continue;
      if (SIDES.some((side) => e.at!.dock[side] !== undefined && touched.has(e.at!.dock[side]!))) touched.add(o);
    }
    for (const o of touched) this.stored[o] = { ...this.stored[o], at: recorded(o, this.shown, area, this.m.scale) };
    saveStored(this.storage, this.stored);
    return true;
  }

  /**
   * The two gestures: drag by the strip, resize by any of the four grips.
   * Both capture the pointer on the element pressed, so every move and the
   * release come back here wherever the pointer wanders — over the canvas
   * included, which never hears about it. That, and the canvas capturing its own presses (see
   * main.ts), is the whole of "panel gestures and canvas gestures never cross".
   */
  private wire(id: string, el: HTMLElement): void {
    // Raised by a press anywhere on it, in the capture phase so a button or the
    // input inside it raises it too. By z-index rather than by moving it to the
    // end of its parent: moving an element that holds the focus blurs it, and
    // the command line is nearly always the element that holds the focus.
    el.addEventListener("pointerdown", () => this.raise(id), true);
    // See-through, the hand on a pane (`HAND_LINGER_MS`): a mouse over it
    // gives it its box back; a press on its content, its docked form until the
    // next press outside.
    // The pin is set after the press's own click has run, so what the press was
    // on — a row, a button — does its thing in the form it was pressed in.
    if (!OPAQUE_PANES.includes(id)) {
      el.addEventListener("pointerenter", (e) => {
        if (e.pointerType !== "mouse") return;
        clearTimeout(this.lingers.get(id));
        this.mouseOver.add(id);
        this.handOf(id);
      });
      el.addEventListener("pointerleave", (e) => {
        if (e.pointerType !== "mouse") return;
        clearTimeout(this.lingers.get(id));
        this.lingers.set(id, setTimeout(() => { this.mouseOver.delete(id); this.handOf(id); }, HAND_LINGER_MS));
      });
      el.addEventListener("click", (e) => {
        if (!this.switches.overlay) return;
        if (e.target instanceof Element && e.target.closest("[data-own-form]")) return;
        setTimeout(() => { this.pinned.add(id); this.handOf(id); }, 0);
      }, true);
    }
    const strip = el.querySelector<HTMLElement>(":scope > .ptitle");
    if (strip) {
      // A tray's strip is sized by `place`, which knows which way it runs.
      if (!(id in this.trays)) strip.style.height = `${this.m.title}px`;
      this.gesture(id, strip, "move");
      // The strip is a control too — a word, or a tray's grip of dots — and
      // says what it is and what it does (`stripTip`), held as any is.
      const label = el.dataset.label || strip.title || id;
      if (this.tooltip) this.tooltip(strip, () => stripTip(label, id in this.trays, this.switches.locked));
    }
    // Every panel but a tray has the four, made here rather than written out in
    // the page: that a panel resizes from any corner, and a tray from none, is
    // the panel manager's rule, not something each panel's markup could
    // forget. Last in the panel, so they are over its content — each only a
    // triangle in its corner (the stylesheet clips it), which leaves a
    // strip its middle. They draw nothing (the owner: *"you dont need those
    // diag lines on every corner"*); the resize cursor is the affordance.
    const grips = gripCorners(id in this.trays || id in this.fitted).map((corner) => {
      const grip = document.createElement("div");
      grip.className = "pgrip";
      grip.dataset.corner = corner;
      el.appendChild(grip);
      this.gesture(id, grip, "resize", corner);
      return grip;
    });
    // The browser's own menu is not wanted on chrome that has no text to copy;
    // it is left alone on the log and the input, which do.
    for (const part of [strip, ...grips]) part?.addEventListener("contextmenu", (e) => e.preventDefault());
  }

  /**
   * The ghosts of a gesture, drawn: one outline per panel the drop would move
   * (`ghostsOf`), where it will land, in the layer between the other panels
   * and the held one. Each kept by its panel's id and moved rather than made
   * again, so a move that changes nothing in the preview writes nothing.
   */
  private drawGhosts(drag: Drag | null): void {
    const want = drag ? ghostsOf(drag) : {};
    const area = this.size();
    for (const [id, g] of this.ghosts) if (!(id in want)) { g.remove(); this.ghosts.delete(id); }
    for (const [id, r] of Object.entries(want)) {
      let g = this.ghosts.get(id);
      if (!g) {
        g = document.createElement("div");
        g.className = "pghost";
        g.dataset.ghost = id;
        this.ghostLayer.appendChild(g);
        this.ghosts.set(id, g);
      }
      if (drag && id === drag.grab.id) g.dataset.own = "";
      else delete g.dataset.own;
      // A refused spot (docs/plans/panels-reshuffle.md): the held pane's ghost
      // is home, and says why the drop here would leave it there.
      const note = drag && id === drag.grab.id ? drag.refused : undefined;
      if (note) g.dataset.note = note;
      else delete g.dataset.note;
      // The word runs out from the ghost's side nearer the area's middle, so a
      // narrow column's at a side edge reads on a line or two, on screen.
      g.dataset.noteSide = r.x + r.w / 2 <= area.w / 2 ? "left" : "right";
      if (r.orient) g.dataset.orient = r.orient;
      else delete g.dataset.orient;
      const { rect } = bleed(r, area, this.inset);
      const where = `${rect.x},${rect.y},${rect.w},${rect.h}`;
      if (g.dataset.at === where) continue;
      g.dataset.at = where;
      g.style.left = `${rect.x}px`;
      g.style.top = `${rect.y}px`;
      g.style.width = `${rect.w}px`;
      g.style.height = `${rect.h}px`;
    }
    this.ghostLayer.hidden = !drag;
  }

  /**
   * The panels glide onto their places at a drop or an escape, for `SETTLE_MS`
   * (index.html eases the move out: no spring). Their rectangles are final the
   * moment it starts — the layout, the store and every rule are the new one at
   * once — and only the drawing catches up. `settling` on the area is the
   * stylesheet's cue, and the tests' sign that the panels have arrived.
   */
  private settle(): void {
    clearTimeout(this.settleTimer);
    this.area.classList.add("settling");
    this.settleTimer = setTimeout(() => this.area.classList.remove("settling"), SETTLE_MS);
  }

  /**
   * One gesture, by a strip or a grip (`wire`). **Nothing moves until the drop** (docs/plans/panels-preview.md): through
   * the gesture only the held panel is drawn anywhere new — lifted, under the
   * hand — and every other one stays where it was, translucent (`dragging` on
   * the area: one class, for every panel at once), with a ghost where the
   * resolver says it would land. The drop commits the ghosts (`dropOf`), and
   * the panels settle onto them. Escape, a lift back at the press, and a
   * pointercancel (the system taking the touch) commit nothing; a preview the
   * resolver could not make sound commits nothing either, and says so.
   */
  private gesture(id: string, handle: HTMLElement, kind: "move" | "resize", corner: Corner = "se"): void {
    // `mousedown`, not `pointerdown`, is the event whose default moves focus and
    // starts a text selection. Prevented, a drag leaves the command line holding
    // the focus it had, so typing after rearranging still types.
    handle.addEventListener("mousedown", (e) => e.preventDefault());
    handle.addEventListener("pointerdown", (e) => {
      if (e.button !== 0 || this.holding) return;
      e.preventDefault();
      const el = this.els.get(id)!;
      // The pointer in the layout's own coordinates — the safe area's, so the
      // element's box less the insets. Held for the whole gesture, the grab has
      // to be a point *of the panel*, or a tray that turns (`regrasped`)
      // carries the offset along its strip. Measured once: the area does not
      // move under a held pointer, and measuring it on every move would force
      // a layout after each draw.
      const box = this.area.getBoundingClientRect();
      const [ox, oy] = [box.left + this.area.clientLeft + this.inset.left, box.top + this.area.clientTop + this.inset.top];
      const at = (ev: PointerEvent): Point => ({ x: ev.clientX - ox, y: ev.clientY - oy });
      // Counted at the press: nothing defines a tool while a pointer is held on a panel.
      const buttons = id in this.trays ? this.trays[id]() : undefined;
      // The whole layout at the press — what Escape goes back to, and what the
      // drop stores the changes from: a push can move any panel.
      // Locked (docs/plans/panels-overlay-lock.md), the gesture is taken as any
      // is — captured, so it stays the pane's and never becomes the canvas's —
      // but the drag moves nothing and pushes nobody (`dragTo`), and the drop
      // commits nothing (`dropOf`); the press says why. The strip is not drawn
      // and a grip takes no press at all (the stylesheet).
      let drag = beginDrag(id, kind, at(e), { ...this.shown }, corner, buttons, this.switches.locked);
      const slop = backSlop(e.pointerType !== "mouse");
      handle.setPointerCapture(e.pointerId);
      if (drag.locked) this.onLocked?.(LOCKED_GUIDE);
      // A press during the last drop's settle: the panels are already where it
      // put them, and the glide would only drag behind the hand.
      clearTimeout(this.settleTimer);
      this.area.classList.remove("settling");
      this.holding = true;
      if (!drag.locked) el.classList.add("held");
      // The drag's look starts with its first move, not at the press: a press
      // on a strip that never moves (to raise a panel, to read a strip's
      // tooltip) must not flash every other panel to half and back.
      let started = false;
      const move = (ev: PointerEvent) => {
        if (ev.pointerId !== e.pointerId || drag.locked) return;
        if (!started) {
          started = true;
          this.area.classList.add("dragging");
          // The held panel over everything, the ghosts just under it and over the rest.
          this.ghostLayer.style.zIndex = String(LIFTED_Z);
          el.style.zIndex = String(LIFTED_Z + 1);
        }
        const area = this.size();
        drag = dragTo(drag, at(ev), area, (o, orient) => this.min(o, orient), this.m);
        this.draw(el, drag.held);
        this.drawGhosts(drag);
        // Every preview keeps the rules a committed layout does — nothing a
        // ghost shows overlaps — and is checked as one is (`show`).
        const problem = layoutProblem(drag.preview, true, area);
        if (problem && this.check) reportError(new Error(`preview: ${problem}`));
      };
      const finish = (pointer: Point | null) => {
        handle.removeEventListener("pointermove", move);
        handle.removeEventListener("pointerup", up);
        handle.removeEventListener("pointercancel", cancel);
        window.removeEventListener("keydown", key, true);
        if (handle.hasPointerCapture(e.pointerId)) handle.releasePointerCapture(e.pointerId);
        el.classList.remove("held");
        this.area.classList.remove("dragging");
        this.drawGhosts(null);
        this.holding = false;
        const drop = pointer ? dropOf(drag, pointer, this.size(), slop) : null;
        if (started) this.settle();
        if (drop?.outcome === "moved") this.show(drop.layout);
        // The held panel back onto its place — the ghost it dropped on, or the
        // place it was taken from — which `show` alone would skip where the
        // drop left that place as it was.
        this.draw(el, this.shown[id]);
        this.restack();
        if (drop?.outcome === "refused") {
          // A reshuffle's own refusal says its word; a preview the check found
          // unsound (which no rule should make) says the old one, and why, in
          // the console.
          this.onRefused?.(`${drag.refused ?? "no layout fits there"} — nothing moved`);
          if (drop.problem && !drag.refused) console.warn(drop.problem);
        }
        // A press that never moved is not an arrangement; storing it would
        // turn an untouched panel's following-the-defaults into a fixed
        // position. Nor is a drop that changed nothing.
        if (drop?.outcome === "moved") this.remember(drag.start);
        if (this.stale) { this.stale = false; this.apply(); }
      };
      const up = (ev: PointerEvent) => { if (ev.pointerId === e.pointerId) finish(at(ev)); };
      const cancel = (ev: PointerEvent) => { if (ev.pointerId === e.pointerId) finish(null); };
      // Escape is the drag's while one is held, and only the drag's: the window's
      // own Escape (main.ts) would also put the armed tool down, and one key
      // takes back one thing — the most recent, which is this.
      const key = (ev: KeyboardEvent) => {
        if (ev.key !== "Escape") return;
        ev.preventDefault();
        ev.stopImmediatePropagation();
        finish(null);
      };
      handle.addEventListener("pointermove", move);
      handle.addEventListener("pointerup", up);
      handle.addEventListener("pointercancel", cancel);
      window.addEventListener("keydown", key, true);
    });
  }
}

// ---- the toolbar ------------------------------------------------------------

/** The command a tool's button types. Quoted as JSON, as the menu quotes names. */
export function armCommand(tool: string): string {
  return `arm(${JSON.stringify(tool)})`;
}

/** A name as a tooltip heads with it: its first letter a capital — `Rectangle`, `Circle3`. */
export function displayName(name: string): string {
  return name ? name[0].toUpperCase() + name.slice(1) : name;
}

/**
 * A tool button's tooltip: the tool's name — the button shows only its glyph,
 * so this is where the name is read, and the command after it says it the way
 * the command line does — what it does (its `static summary`, or nothing for a
 * tool that declares none), and its key where it has one.
 */
export function toolTip(tool: string, summary: string | null = null, key: string | null = null): Tip {
  return { name: displayName(tool), summary, command: armCommand(tool), key };
}

// ---- the flyout: a group's other tools, beside its button --------------------
//
// docs/plans/toolbar-groups.md. Tools of one family share one button
// (tools/tool.ts's `TOOL_GROUPS`); the button shows the one armed last, and the
// whole family opens beside it, a line the other way from the tray — a row
// beside a column, a column over a row — so it runs out into the drawing and
// never back along the tray. Where is pure arithmetic over rectangles, below;
// what opens it is the Toolbar's.

/** Between a tray and its flyout. */
export const FLYOUT_GAP = 4;
/** The least a flyout keeps from the edge of its bounds, as a tooltip does. */
const FLYOUT_MARGIN = 4;
/**
 * How long the pointer may be off both a button and its open flyout before the
 * flyout closes — the crossing from one to the other, and a hand's wobble.
 */
export const FLYOUT_LEAVE_MS = 300;

/**
 * A flyout's size: `items` buttons in `lines` lines running `orient`. A tray's
 * family (`traySize`) without the strip — nothing drags a flyout — so a line is
 * the padding, the border and the buttons a gap apart, and the lines a whole
 * button pitch apart, as a tray's are.
 */
export function flyoutSize(items: number, orient: Orientation, m: Metrics = FINE, lines = 1): Size {
  const n = Math.max(1, items);
  const l = Math.min(n, Math.max(1, Math.round(lines)));
  const per = Math.ceil(n / l);
  const run = 8 + per * m.button + (per - 1) * m.gap;
  const depth = 8 + m.button + (l - 1) * (m.button + m.gap);
  return orient === "row" ? { w: run, h: depth } : { w: depth, h: run };
}

/** What a flyout is laid out round: every rectangle in the same coordinates (the window's, in the app). */
export interface FlyoutAsk {
  /** The button it opens from. */
  button: Rect;
  /** The whole tray the button is in, every line of it. Never covered. */
  tray: Rect;
  /** Which way the tray runs. The flyout runs the other way. */
  along: Orientation;
  /** How many buttons it holds. */
  items: number;
  m: Metrics;
  /** Where it may be: the window less its safe-area insets. */
  bounds: Rect;
  /** What it must never cover: the logo and the corner the status is shown in. */
  keep: readonly Rect[];
  /** What it keeps off where it can: every other pane on screen. */
  avoid: readonly Rect[];
}

export type FlyoutSide = "left" | "right" | "above" | "below";

export interface FlyoutPlace {
  rect: Rect;
  orient: Orientation;
  lines: number;
  /** Buttons a line — the stylesheet's `--per`. */
  per: number;
  side: FlyoutSide;
  /** Whether it is clear of every pane in `avoid` as well as of everything it must be. */
  clear: boolean;
}

const meets = (a: Rect, b: Rect) => a.x < b.x + b.w - EPS && b.x < a.x + a.w - EPS && a.y < b.y + b.h - EPS && b.y < a.y + a.h - EPS;
const overlapArea = (a: Rect, b: Rect) =>
  Math.max(0, Math.min(a.x + a.w, b.x + b.w) - Math.max(a.x, b.x)) * Math.max(0, Math.min(a.y + a.h, b.y + b.h) - Math.max(a.y, b.y));

/**
 * Where a flyout goes: beside the tray, on the side with more room (the
 * drawing's, for a tray docked to an edge) and then the other; a row beside a
 * column, a column above or below a row; **level with its button** where that
 * is clear, else slid along the tray to the nearest place that is; wrapped
 * into more lines where one is too long for the room — an iPhone SE's
 * landscape tray has a short way up to the top of the screen.
 *
 * Never over the tray, never over `keep` (the logo and the status's corner),
 * always inside `bounds`. Clear of every other pane wherever such a place
 * exists (`clear`); where none does — a screen too small for it anywhere —
 * the place that covers least of them, as a menu covers what is under it.
 *
 * Of the clear places, the nearest the button wins, then the one on the
 * preferred side, then the fewest lines.
 */
export function flyoutPlacement(a: FlyoutAsk): FlyoutPlace {
  const orient: Orientation = a.along === "column" ? "row" : "column";
  const { bounds: B, tray: T, button, m } = a;
  const lo = { x: B.x + FLYOUT_MARGIN, y: B.y + FLYOUT_MARGIN };
  const hi = { x: B.x + B.w - FLYOUT_MARGIN, y: B.y + B.h - FLYOUT_MARGIN };
  const sides: FlyoutSide[] = a.along === "column"
    ? (hi.x - (T.x + T.w) >= T.x - lo.x ? ["right", "left"] : ["left", "right"])
    : (T.y - lo.y >= hi.y - (T.y + T.h) ? ["above", "below"] : ["below", "above"]);
  const hard = [...a.keep, T];
  const n = Math.max(1, a.items);
  // Across the flyout's run, its first line lies level with the button: the
  // padding and the border are what the button's face is in from the edge.
  const level = (orient === "row" ? button.y : button.x) - 4;
  interface Cand extends FlyoutPlace { cover: number; dist: number; rank: number }
  const cands: Cand[] = [];
  sides.forEach((side, rank) => {
    for (let lines = 1; lines <= n; lines++) {
      const size = flyoutSize(n, orient, m, lines);
      const run = side === "right" ? T.x + T.w + FLYOUT_GAP : side === "left" ? T.x - FLYOUT_GAP - size.w
        : side === "below" ? T.y + T.h + FLYOUT_GAP : T.y - FLYOUT_GAP - size.h;
      const runLen = orient === "row" ? size.w : size.h;
      const [runLo, runHi] = orient === "row" ? [lo.x, hi.x] : [lo.y, hi.y];
      if (run < runLo - EPS || run + runLen > runHi + EPS) continue;
      const depth = orient === "row" ? size.h : size.w;
      const [crossLo, crossHi] = orient === "row" ? [lo.y, hi.y] : [lo.x, hi.x];
      if (depth > crossHi - crossLo + EPS) continue;
      const clampC = (c: number) => Math.min(Math.max(c, crossLo), crossHi - depth);
      // Level with the button, at either end of the room, or just past any
      // obstacle — the only places the nearest clear one can be.
      const at = new Set<number>([level, crossLo, crossHi - depth]);
      for (const o of [...hard, ...a.avoid]) {
        const [o0, o1] = orient === "row" ? [o.y, o.y + o.h] : [o.x, o.x + o.w];
        at.add(o0 - FLYOUT_GAP - depth);
        at.add(o1 + FLYOUT_GAP);
      }
      for (const c0 of at) {
        const c = clampC(c0);
        const rect: Rect = orient === "row" ? { x: run, y: c, ...size } : { x: c, y: run, ...size };
        if (hard.some((h) => meets(rect, h))) continue;
        const cover = a.avoid.reduce((s, o) => s + overlapArea(rect, o), 0);
        cands.push({
          rect, orient, lines, per: Math.ceil(n / lines), side, clear: cover <= EPS, cover, dist: Math.abs(c - level), rank,
        });
      }
    }
  });
  cands.sort((p, q) => p.cover - q.cover || p.dist - q.dist || p.rank - q.rank || p.lines - q.lines);
  const best = cands[0];
  if (best) {
    const { cover: _c, dist: _d, rank: _r, ...place } = best;
    return place;
  }
  // Nowhere at all beside the tray — a window smaller than the flyout: on the
  // first side, held inside, and said not to be clear.
  const size = flyoutSize(n, orient, m, 1);
  const side = sides[0];
  const x = side === "right" ? T.x + T.w + FLYOUT_GAP : side === "left" ? T.x - FLYOUT_GAP - size.w : level;
  const y = side === "below" ? T.y + T.h + FLYOUT_GAP : side === "above" ? T.y - FLYOUT_GAP - size.h : level;
  return {
    rect: { x: clamp(x, lo.x, hi.x - size.w), y: clamp(y, lo.y, hi.y - size.h), ...size },
    orient, lines: 1, per: n, side, clear: false,
  };
}

/** One toolbar button, as the host hands it: a tool on its own (`group` null), or a group's members in their order. */
export interface ToolbarButtonSpec { group: string | null; tools: string[] }

/** What the flyout needs of its host, beyond the toolbar's: where it may go and what it keeps off. */
export interface FlyoutHost {
  /** The element it is drawn in — fixed, over the panels, empty until it opens. */
  el: HTMLElement;
  /** The chrome's sizes now (they change with the interface size). */
  metrics(): Metrics;
  /** The window less its safe-area insets, in the window's coordinates — what the tooltip is kept inside. */
  bounds(): Rect;
  /** What it must never cover, in the window's coordinates: the logo and the status's corner. */
  keep(): Rect[];
  /** Every other pane on screen, in the window's coordinates. */
  avoid(): Rect[];
}

/** What the toolbar needs of its host. */
export interface ToolbarHost {
  /** Select, the Hand, then every registered tool in registration order — `toolbarTools()`. */
  tools(): string[];
  /**
   * The buttons, in order — `toolbarButtons()`: a group's members share one.
   * Without it every tool is a button of its own, as before groups.
   */
  buttons?(): ToolbarButtonSpec[];
  /** The member a group's button shows now — `groupCurrent` over what the viewer armed last. Without it, the first. */
  current?(group: string, tools: readonly string[]): string;
  /** `tool`, just armed, is now `group`'s current member: remember it for the viewer (`GroupMemory`). */
  remember?(group: string, tool: string): void;
  /** Where a group's flyout opens. Without it a group's button is a button of its current tool and nothing opens. */
  flyout?: FlyoutHost;
  /**
   * The tool's glyph, as an inline SVG string drawn in `currentColor`: a
   * built-in's own, any other tool's the generic one (`toolIcon`). Asked once
   * per button, when the buttons are built.
   */
  icon(tool: string): string;
  /** The button to light: the armed tool's name, `"hand"`, or `"select"` with nothing armed — `engine.lit`. */
  active(): string | null;
  /** Types one line into the command machinery, as one user action — `submit`. */
  run(command: string): void;
  /** What the tool does, in one line — its `static summary` (`toolSummary`) — or null for one that declares none. */
  summary?(tool: string): string | null;
  /** The key that does what the button does, where one does: `hold Space` for the Hand. */
  key?(tool: string): string | null;
  /** Gives a button its tooltip (tooltip.ts); without it, a button's tip is its `title`. */
  tooltip?: AttachTip;
}

/** A press on a group's button, until it lifts: where it landed, and whether it has opened the flyout yet. */
interface Press {
  id: number;
  x: number;
  y: number;
  touch: boolean;
  button: HTMLButtonElement;
  timer: ReturnType<typeof setTimeout> | undefined;
  /** Moved past `HOLD_SLOP`: a slide, which opened the flyout if the hold had not. */
  moved: boolean;
  /** Held past `HOLD_MS` without moving: a long-press, which opened it. */
  held: boolean;
}

/**
 * One button per registered tool — or per group of them — built from the
 * registry when asked rather than from a list kept here, so a tool defined at
 * the command line gets a button exactly as a built-in has one. Nothing in the
 * registry announces a new tool, so the host calls `sync` whenever one might
 * have appeared or the armed tool might have changed; it does DOM work only
 * when something did.
 *
 * **A button types `arm("name")`** through the host's `run`, the context menu's
 * seam, so the log shows what the button did and a user learns the command by
 * clicking. **Its face is the tool's icon** (the owner: *"tools should be
 * icons"*) and its tooltip is the name, what the tool does and the command it
 * types (the owner: *"when I hover over tools, I should see a tooltip"*), so
 * the vocabulary the command line uses is still one hover — or, under a
 * finger, one hold — away and still what the log shows; the name is the
 * button's accessible name too.
 *
 * **A group's button** (docs/plans/toolbar-groups.md) wears its current
 * member's icon and `data-tool`, and a tap or click arms that member as any
 * button arms its tool. Where the group has more than one member it carries a
 * small mark in its corner and opens the **flyout** — the whole group beside
 * it, the current one marked:
 *
 * - a mouse: rest on it (`HOVER_MS`, the tooltip's delay), or press and hold
 *   (`HOLD_MS`); click an item. It closes on arming, when the pointer has been
 *   off it and its button `FLYOUT_LEAVE_MS`, and on Escape.
 * - a finger: press and slide off the button onto an item and lift — one
 *   gesture, a phone keyboard's accents — or hold (`HOLD_MS`) to open it, lift,
 *   and tap an item. A press anywhere else closes it. A plain tap never opens
 *   it: it arms the button's tool. The numbers are the canvas recogniser's
 *   (tools/gestures.ts's `TAP_SLOP` and `LONG_PRESS_MS`, which tooltip.ts
 *   holds as `HOLD_SLOP` and `HOLD_MS`); the recogniser itself is the
 *   canvas's, and a tray is the host's.
 *
 * **What opens the flyout is what shows a plain button's tooltip** — the
 * hover, the hold — so a group's button has none of its own: its items do,
 * each with its name, what it does and its command, shown by a hover or a
 * hold as any button's.
 *
 * **No button is ever greyed.** One used to be, for a tool the model could not
 * run, with the reason as its hover text; since every built-in makes what it
 * needs (docs/plans/no-refusals.md) the rule answers "never", and the wiring
 * that read it here went with tool-options.md. A tool that one day genuinely
 * cannot run somewhere refuses its click with guidance, as every tool does.
 */
export class Toolbar {
  private el: HTMLElement;
  private host: ToolbarHost;
  private names = "";
  /** The group buttons, by group, with their members. */
  private groups = new Map<string, { el: HTMLButtonElement; tools: string[] }>();
  /** The group whose flyout is open, and its button. */
  private open: { group: string; button: HTMLButtonElement } | null = null;
  private press: Press | null = null;
  private hoverTimer: ReturnType<typeof setTimeout> | undefined;
  private leaveTimer: ReturnType<typeof setTimeout> | undefined;
  /** When a flyout last closed, for `WARM_MS`: running along the toolbar opens the next at once. */
  private closedAt = -Infinity;
  /** The button whose next click is the lift of a press that opened or used its flyout — not a press of the button. */
  private swallow: HTMLButtonElement | null = null;

  constructor(el: HTMLElement, host: ToolbarHost) {
    this.el = el;
    this.host = host;
    const fly = host.flyout?.el;
    if (!fly || typeof window === "undefined") return;
    fly.hidden = true;
    fly.addEventListener("pointerenter", (e) => { if (e.pointerType !== "touch") clearTimeout(this.leaveTimer); });
    fly.addEventListener("pointerleave", (e) => { if (e.pointerType !== "touch") this.leaving(); });
    fly.addEventListener("contextmenu", (e) => e.preventDefault());
    // Escape closes it, and only that: the tool armed stays armed. On the
    // window, in the capture phase, ahead of the app's own Escape.
    window.addEventListener("keydown", (e) => {
      if (e.key !== "Escape" || !this.open) return;
      this.close();
      e.preventDefault();
      e.stopImmediatePropagation();
    }, true);
    // A press anywhere but the flyout and its button closes it — and goes on
    // to do what it does there.
    window.addEventListener("pointerdown", (e) => {
      if (!this.open || !(e.target instanceof Node)) return;
      if (fly.contains(e.target) || this.open.button.contains(e.target)) return;
      this.close();
    }, true);
    window.addEventListener("resize", () => this.close());
  }

  /** Whether a group's flyout is open, and which. */
  get opened(): string | null {
    return this.open?.group ?? null;
  }

  /** Rebuilds if the buttons changed and re-marks the armed button. Returns whether the buttons changed. */
  sync(): boolean {
    const buttons = this.host.buttons?.() ?? this.host.tools().map((t) => ({ group: null, tools: [t] }));
    const key = JSON.stringify(buttons);
    const rebuilt = key !== this.names;
    if (rebuilt) {
      this.names = key;
      this.close();
      this.el.textContent = "";
      this.groups.clear();
      for (const b of buttons) this.el.appendChild(this.button(b));
    }
    const active = this.host.active();
    // The current member follows whatever armed it — this button, the flyout,
    // or `arm("polygon")` typed.
    for (const [group, g] of this.groups) {
      if (active !== null && g.tools.includes(active)) this.host.remember?.(group, active);
      const current = this.host.current?.(group, g.tools) ?? g.tools[0];
      if (g.el.dataset.tool !== current) this.face(g.el, current);
    }
    for (const b of Array.from(this.el.querySelectorAll<HTMLButtonElement>("button"))) {
      const on = String(b.dataset.tool === active);
      if (b.getAttribute("aria-pressed") !== on) b.setAttribute("aria-pressed", on);
    }
    return rebuilt;
  }

  /** Shows `tool` on a group's button: its glyph, its name, the tool a press arms. */
  private face(b: HTMLButtonElement, tool: string): void {
    // The host's string, from a table of constants or built round the name
    // escaped; nothing a file or another viewer supplies reaches it.
    b.innerHTML = this.host.icon(tool);
    b.dataset.tool = tool;
    b.setAttribute("aria-label", tool);
  }

  private button(spec: ToolbarButtonSpec): HTMLButtonElement {
    const b = document.createElement("button");
    b.type = "button";
    const grouped = spec.group !== null;
    const flies = grouped && spec.tools.length > 1 && !!this.host.flyout;
    const first = grouped ? this.host.current?.(spec.group!, spec.tools) ?? spec.tools[0] : spec.tools[0];
    this.face(b, first);
    if (grouped) {
      b.dataset.group = spec.group!;
      this.groups.set(spec.group!, { el: b, tools: spec.tools });
    }
    if (flies) {
      // The mark in the corner (index.html), and what assistive tech is told:
      // the button opens something.
      b.dataset.more = "";
      b.setAttribute("aria-haspopup", "true");
      b.setAttribute("aria-expanded", "false");
      this.flyoutGestures(b, spec.group!);
    } else {
      // Asked when it shows, not now: a tool redefined at the command line
      // with a summary says it the next time, with no rebuild.
      giveTip(b, () => {
        const tool = b.dataset.tool!;
        return toolTip(tool, this.host.summary?.(tool) ?? null, this.host.key?.(tool) ?? null);
      }, this.host.tooltip, {
        // Beside the tray when it is a column, so the tip never covers the
        // buttons the pointer is about to run down.
        along: () => (this.el.closest<HTMLElement>(".panel")?.dataset.orient as "column" | "row" | undefined) ?? null,
        // Beside or past the whole tray, every line of it, so a held tip never
        // covers the next button — on this line or the next.
        line: () => this.el,
      });
    }
    b.setAttribute("aria-pressed", "false");
    // Keeps the focus where it was — the command line — so a click on a button
    // is not followed by Enter or Space re-pressing it instead of submitting.
    b.addEventListener("mousedown", (e) => e.preventDefault());
    b.addEventListener("contextmenu", (e) => e.preventDefault());
    b.addEventListener("click", (e) => {
      if (this.swallow === b) {
        this.swallow = null;
        e.preventDefault();
        return;
      }
      this.close();
      this.host.run(armCommand(b.dataset.tool!));
    });
    return b;
  }

  /** A group button's ways into its flyout: the hover and the hold, the slide, the long-press. */
  private flyoutGestures(b: HTMLButtonElement, group: string): void {
    b.addEventListener("pointerenter", (e) => {
      if (e.pointerType === "touch") return;
      clearTimeout(this.leaveTimer);
      if (this.open?.group === group) return;
      clearTimeout(this.hoverTimer);
      // At once when another group's flyout is open or just was — a run along
      // the toolbar — as the tooltip comes at once on the next button.
      const warm = this.open !== null || performance.now() - this.closedAt < WARM_MS;
      this.hoverTimer = setTimeout(() => { if (!this.press) this.show(group, b); }, warm ? 0 : HOVER_MS);
    });
    b.addEventListener("pointerleave", (e) => {
      if (e.pointerType === "touch") return;
      clearTimeout(this.hoverTimer);
      if (this.open?.group === group) this.leaving();
    });
    b.addEventListener("pointerdown", (e) => {
      if (e.button !== 0) return;
      clearTimeout(this.hoverTimer);
      this.swallow = null;
      const press: Press = {
        id: e.pointerId, x: e.clientX, y: e.clientY, touch: e.pointerType === "touch", button: b,
        moved: false, held: false, timer: undefined,
      };
      press.timer = setTimeout(() => {
        if (this.press !== press || press.moved) return;
        press.held = true;
        this.show(group, b);
      }, HOLD_MS);
      this.press = press;
      // Held, so the slide's moves and its lift come here wherever the
      // finger or the mouse goes — the items are found under it by position.
      try { b.setPointerCapture(e.pointerId); } catch { /* a synthetic press has nothing to capture */ }
    });
    b.addEventListener("pointermove", (e) => {
      const p = this.press;
      if (!p || p.id !== e.pointerId) return;
      if (!p.moved && Math.hypot(e.clientX - p.x, e.clientY - p.y) > HOLD_SLOP) {
        p.moved = true;
        clearTimeout(p.timer);
        if (this.open?.group !== group) this.show(group, b);
      }
      if (p.moved) this.mark(this.itemAt(e.clientX, e.clientY));
    });
    b.addEventListener("pointerup", (e) => {
      const p = this.press;
      if (!p || p.id !== e.pointerId) return;
      clearTimeout(p.timer);
      this.press = null;
      if (!p.moved && !p.held) return; // a tap or a click: the click arms the button's tool
      // The lift is the end of the gesture, not a press of the button.
      this.swallow = b;
      const item = p.moved ? this.itemAt(e.clientX, e.clientY) : null;
      if (item) {
        this.close();
        this.host.run(armCommand(item.dataset.tool!));
      } else if (p.moved) {
        // Slid off onto nothing: put away, nothing armed.
        this.close();
      }
      // Held and lifted where it was: it stays open, for a tap on an item.
    });
    b.addEventListener("pointercancel", (e) => {
      const p = this.press;
      if (!p || p.id !== e.pointerId) return;
      clearTimeout(p.timer);
      this.press = null;
      if (p.moved) this.close();
    });
  }

  /** The flyout's item under a window point, if any. */
  private itemAt(x: number, y: number): HTMLButtonElement | null {
    const fly = this.host.flyout?.el;
    const hit = typeof document.elementFromPoint === "function" ? document.elementFromPoint(x, y) : null;
    const item = hit?.closest<HTMLButtonElement>("button[data-tool]") ?? null;
    return item && fly?.contains(item) ? item : null;
  }

  /** Lights the item a sliding finger is over, as a hover lights it under a mouse. */
  private mark(item: HTMLButtonElement | null): void {
    const fly = this.host.flyout?.el;
    if (!fly) return;
    for (const b of Array.from(fly.querySelectorAll<HTMLButtonElement>("button"))) b.classList.toggle("hot", b === item);
  }

  private leaving(): void {
    clearTimeout(this.leaveTimer);
    if (this.press) return;
    this.leaveTimer = setTimeout(() => this.close(), FLYOUT_LEAVE_MS);
  }

  /** Opens `group`'s flyout beside `b`, closing any other. */
  private show(group: string, b: HTMLButtonElement): void {
    const host = this.host.flyout;
    const g = this.groups.get(group);
    if (!host || !g || !b.isConnected) return;
    if (this.open && this.open.group !== group) this.close();
    clearTimeout(this.leaveTimer);
    const fly = host.el;
    fly.textContent = "";
    const active = this.host.active();
    const current = b.dataset.tool;
    for (const tool of g.tools) {
      const item = document.createElement("button");
      item.type = "button";
      item.innerHTML = this.host.icon(tool);
      item.dataset.tool = tool;
      item.setAttribute("aria-label", tool);
      item.setAttribute("aria-pressed", String(tool === active));
      if (tool === current) {
        item.classList.add("current");
        item.setAttribute("aria-current", "true");
      }
      giveTip(item, () => toolTip(tool, this.host.summary?.(tool) ?? null, this.host.key?.(tool) ?? null), this.host.tooltip, {
        along: () => (fly.dataset.orient as Orientation | undefined) ?? null,
        line: () => fly,
        // Never over the tray it opened from: its buttons are the next thing a finger reaches for.
        clear: () => [this.el.closest<HTMLElement>(".panel") ?? this.el],
      });
      item.addEventListener("mousedown", (e) => e.preventDefault());
      item.addEventListener("contextmenu", (e) => e.preventDefault());
      item.addEventListener("click", () => {
        this.close();
        this.host.run(armCommand(tool));
      });
      fly.appendChild(item);
    }
    const r = (el: Element): Rect => {
      const q = el.getBoundingClientRect();
      return { x: q.x, y: q.y, w: q.width, h: q.height };
    };
    const panel = this.el.closest<HTMLElement>(".panel") ?? this.el;
    const along = (panel.dataset.orient as Orientation | undefined) ?? "column";
    const place = flyoutPlacement({
      button: r(b), tray: r(panel), along, items: g.tools.length, m: host.metrics(),
      bounds: host.bounds(), keep: host.keep(), avoid: host.avoid(),
    });
    fly.dataset.orient = place.orient;
    fly.dataset.lines = String(place.lines);
    fly.dataset.side = place.side;
    fly.dataset.group = group;
    fly.style.setProperty("--per", String(place.per));
    fly.style.left = `${Math.round(place.rect.x)}px`;
    fly.style.top = `${Math.round(place.rect.y)}px`;
    fly.style.width = `${place.rect.w}px`;
    fly.style.height = `${place.rect.h}px`;
    fly.hidden = false;
    b.setAttribute("aria-expanded", "true");
    this.open = { group, button: b };
  }

  /** Puts the flyout away, if one is open. Returns whether one was. */
  close(): boolean {
    clearTimeout(this.leaveTimer);
    clearTimeout(this.hoverTimer);
    if (!this.open) return false;
    const fly = this.host.flyout?.el;
    if (fly) {
      fly.hidden = true;
      fly.textContent = "";
    }
    this.open.button.setAttribute("aria-expanded", "false");
    this.open = null;
    this.closedAt = performance.now();
    return true;
  }
}

// ---- the options panel ------------------------------------------------------
//
// The owner (docs/plans/effortless.md): *"if the tool has options, there should
// also be some kind of e.g. pop-up menu that allows me to set them visually, or
// it happens in the terminal or whatever."* Both, and they are one thing: while
// a tool that declares options is armed, a small panel beside the tray shows a
// row per option, and **editing a field types `arm("extrude", {depth: 25})`**
// through the host's `run` — `submit`, the toolbar's and the menu's seam — so
// the log shows it, the recall history has it, and the panel can do nothing a
// typed line cannot. The fields show whatever the tool is armed with, however
// it was armed: typed by hand, by a button, or by the panel itself.

/**
 * One declared option as the panel shows it: what it is called, its unit's
 * text, and the armed value. A choice (`method`) carries its words, each with
 * what the panel shows for it, and what the gesture has read it as so far —
 * the panel's words for that, or null — so the row can say `3 points` beside
 * `auto` and the user can lock it.
 */
export interface OptionRow {
  name: string; label: string; unit: string; value: number | boolean | string;
  choices?: readonly (readonly [string, string])[];
  read?: string | null;
  /** A choice drawn as buttons, one per word but the first, rather than a drop-down (an extrude's mode). */
  buttons?: boolean;
  /** A number whose sign is a direction: a ⇅ button beside its field types it negated (an extrude's depth). */
  flip?: boolean;
}

/** The flip button's name, in the words a SolidWorks user looks for (docs/plans/solid-tools-intuitive.md). */
export const FLIP_LABEL = "Flip direction";

/**
 * A feature tool's ✓ and ✗, as the panel shows them: whether ✓ would do
 * anything now. Its own shape rather than the tools' — this file knows nothing
 * of tools — which the host fills from the engine.
 */
export interface DialogState {
  ready: boolean;
  /**
   * For a word option left at its default (an extrude's `mode: "auto"`): what
   * the default comes to for what is picked — shown as that button dimly
   * down — and a choice worth offering, outlined (Cut, when the solid runs
   * into a body). Null or absent: nothing to show.
   */
  choice?: { option: string; resolved: string | null; offer: string | null } | null;
}

/**
 * A command a tool offers on its panel, one row each: the label, and the line
 * the row types when pressed. This file's own shape, as `DialogState` is — it
 * knows nothing of tools.
 */
export interface PanelCommand {
  label: string;
  command: string;
}

/** What the options panel needs of its host. */
export interface OptionsHost {
  /**
   * The armed tool's registered name and its declared options — and, for a
   * tool that makes a feature, the state of its ✓ — or null when none is armed
   * or it has neither options nor a ✓.
   */
  armed(): { tool: string; rows: OptionRow[]; dialog?: DialogState | null; commands?: readonly PanelCommand[] } | null;
  /**
   * Types one of the armed tool's `commands` (the constrain tool's relations) as
   * one user action and tells the tool it ran. Absent: `run`, untold.
   */
  command?(text: string): Promise<unknown> | void;
  /** Types one line into the command machinery, as one user action — `submit`. Settles once it has run. */
  run(command: string): Promise<unknown> | void;
  /** ✓ — what Enter does. */
  confirm?(): void;
  /** ✗ — what Escape does. */
  cancel?(): void;
  /**
   * A field's text as it is typed, before it commits: the number it reads, or
   * null for text that is not one (the armed value stands) — so a feature's
   * preview can follow the typing without a line typed per keystroke.
   */
  trial?(option: string, value: number | null): void;
  /** Gives ✓ and ✗ their tooltips (tooltip.ts); without it, each has a `title`. */
  tooltip?: AttachTip;
}

/**
 * The line a field types: `arm("extrude", {depth: 25})` — the tool quoted as
 * JSON, as a button quotes it, and only the option edited. The others need not
 * be said: each was either never typed, and is filled from its default, or was,
 * and is remembered, which is exactly what the tool is armed with now.
 */
export function optionCommand(tool: string, option: string, value: number | boolean | string): string {
  const key = /^[A-Za-z_$][\w$]*$/.test(option) ? option : JSON.stringify(option);
  return `arm(${JSON.stringify(tool)}, {${key}: ${typeof value === "string" ? JSON.stringify(value) : String(value)}})`;
}

/** A number as a field shows it: to a millionth, so a whole turn reads 6.283185, not seventeen digits. */
export function fieldText(v: number): string {
  return String(Math.round(v * 1e6) / 1e6);
}

/** What a field's text means: a finite number, or null for anything that is not one (which restores the field). */
export function parseField(text: string): number | null {
  const t = text.trim();
  if (t === "") return null;
  const n = Number(t);
  return Number.isFinite(n) ? n : null;
}

/**
 * The options panel's DOM: a strip naming the armed tool, and a row per
 * declared option — the label, a field (a checkbox for a flag) and the unit.
 * Built from the host when asked, like the toolbar, so a tool defined at the
 * command line with a `static options` gets its rows with no work of its own.
 *
 * **Enter or blur commits; Escape restores.** A commit that would change
 * nothing types nothing, and text that is not a number puts the field back. A
 * press anywhere else commits a field left mid-edit *before* that press is
 * handled, so clicking straight into the drawing after typing 25 extrudes 25
 * deep, not by the value the tool had a moment earlier. Escape in a field is
 * the field's — it restores the value and gives the focus back, and does not
 * also release the tool; a second Escape does that.
 */
export class OptionsPanel {
  private body: HTMLElement;
  private strip: HTMLElement | null;
  private host: OptionsHost;
  /** The tool and its rows' shape as last built, joined — compared, not diffed. */
  private key = "";
  private tool = "";
  private count: number | null = null;
  /** The ✓ button, while the armed tool has one. */
  private ok: HTMLButtonElement | null = null;
  private m: Metrics;

  constructor(panel: HTMLElement, body: HTMLElement, host: OptionsHost, metrics: Metrics = FINE) {
    this.m = metrics;
    this.body = body;
    this.strip = panel.querySelector<HTMLElement>(":scope > .ptitle");
    this.host = host;
    // Capture, on the document: ahead of the canvas's own listener, so the
    // tool the press reaches is the one armed with what the field says.
    document.addEventListener("pointerdown", (e) => {
      const at = document.activeElement;
      if (at instanceof HTMLInputElement && at.type === "text" && this.body.contains(at) && e.target !== at) void this.commit(at);
    }, true);
  }

  /** New sizes, when the interface size changes; the host lays the panels out again after. */
  setMetrics(m: Metrics): void {
    this.m = m;
  }

  /** The panel's size now, or null while no tool with options is armed — `Fitted.size`. */
  size(): Size | null {
    return this.count === null ? null : optionsSize(this.count, this.m);
  }

  /**
   * Rebuilds if the armed tool or its declared options changed and shows the
   * values it is armed with. Returns whether the panel's shape changed — shown,
   * hidden, or another number of rows — so the host can place it again.
   */
  sync(): boolean {
    const a = this.host.armed();
    const commands = a?.commands ?? [];
    const key = a
      ? [a.tool, a.dialog ? "dialog" : "", ...a.rows.map((r) => `${r.name}\t${typeof r.value}\t${r.label}\t${r.unit}\t${r.flip ? "flip" : ""}\t${r.choices?.flat().join("\t") ?? ""}`),
        ...commands.map((c) => `cmd\t${c.label}\t${c.command}`)].join("\n")
      : "";
    const shaped = key !== this.key;
    if (shaped) {
      this.key = key;
      this.tool = a?.tool ?? "";
      this.count = a ? a.rows.length + (a.dialog ? 1 : 0) + commands.length : null;
      this.body.textContent = "";
      this.ok = null;
      if (this.strip) this.strip.textContent = a ? a.tool : "";
      for (const row of a?.rows ?? []) this.body.appendChild(this.row(row));
      for (const c of commands) this.body.appendChild(this.commandRow(c));
      if (a?.dialog) this.body.appendChild(this.actions());
    }
    if (a) this.fill(a.rows, false, a.dialog?.choice ?? null);
    if (this.ok && a?.dialog) this.ok.disabled = !a.dialog.ready;
    return shaped;
  }

  /**
   * The feature's ✓ and ✗, a row of their own under the options — Onshape's
   * feature dialog, in this panel's size. ✓ is disabled until the picks are
   * enough to build something. A press keeps the focus where it was (the
   * command line, nearly always), so typing after a ✗ still types; a field
   * left mid-edit is committed before the press is handled, by the same
   * capture every press elsewhere gets — so ✓ after typing 25 builds 25 deep.
   */
  private actions(): HTMLElement {
    const line = document.createElement("div");
    line.className = "orow oact";
    const button = (cls: string, text: string, tip: () => Tip, act: () => void) => {
      const b = document.createElement("button");
      b.className = cls;
      b.type = "button";
      b.textContent = text;
      b.setAttribute("aria-label", tip().name);
      giveTip(b, tip, this.host.tooltip);
      b.addEventListener("mousedown", (e) => e.preventDefault());
      b.addEventListener("click", act);
      return b;
    };
    // Neither types a line of its own: ✓ is Enter and ✗ is Escape, which the
    // feature's lines are typed by, so the tip names the key, not a command.
    const ok = button("ok", "✓", () => ({
      name: "Confirm", key: "Enter", summary: "Builds what the preview shows; the tool stays armed",
      off: this.ok?.disabled ? "pick what to build first" : null,
    }), () => this.host.confirm?.());
    this.ok = ok;
    line.append(ok, button("no", "✗", () => ({
      name: "Cancel", key: "Esc", summary: "Drops what is picked; a second Esc puts the tool down",
    }), () => this.host.cancel?.()));
    return line;
  }

  /**
   * One of the tool's commands (docs/plans/sketch-relations.md — the constrain
   * tool's relations for what is picked): a row-wide button, the label and,
   * dim beside it, the line it types — the context menu's rule, every item
   * showing what it does. Pressed, it types that line; it never takes the
   * focus, so typing after it still types.
   */
  private commandRow(c: PanelCommand): HTMLElement {
    const b = document.createElement("button");
    b.type = "button";
    b.className = "orow ocmd";
    b.dataset.command = c.command;
    const label = document.createElement("span");
    label.className = "olabel";
    label.textContent = c.label;
    const cmd = document.createElement("span");
    cmd.className = "ocmdtext";
    cmd.textContent = c.command;
    b.append(label, cmd);
    b.title = `${c.label} — ${c.command}`;
    b.addEventListener("mousedown", (e) => e.preventDefault());
    b.addEventListener("click", () => {
      void (this.host.command ? this.host.command(c.command) : this.host.run(c.command));
    });
    return b;
  }

  /**
   * A choice drawn as buttons (`buttons: true`): a button per word but the
   * first (the default, which is "none of these"). A press types
   * `arm(tool, { mode: "cut" })`; a press on the button already down types the
   * default back. The buttons never take the focus, so typing after one still
   * types.
   */
  private choiceRow(r: OptionRow): HTMLElement {
    const line = document.createElement("div");
    line.className = "orow ochoice";
    line.dataset.option = r.name;
    line.title = `${r.label} — ${optionCommand(this.tool, r.name, r.value)}`;
    const label = document.createElement("span");
    label.className = "olabel";
    label.textContent = r.label;
    line.append(label);
    const tool = this.tool;
    const [[none], ...words] = r.choices ?? [["", ""]];
    for (const [word, text] of words) {
      const b = document.createElement("button");
      b.type = "button";
      b.className = "ochoose";
      b.dataset.choice = word;
      b.textContent = text;
      b.setAttribute("aria-label", `${r.label}: ${word}`);
      b.addEventListener("mousedown", (e) => e.preventDefault());
      b.addEventListener("click", () => {
        const now = this.host.armed()?.rows.find((x) => x.name === r.name)?.value;
        void this.type(tool, r.name, now === word ? none : word);
      });
      line.append(b);
    }
    return line;
  }

  private row(r: OptionRow): HTMLElement {
    if (r.choices && r.buttons) return this.choiceRow(r);
    const line = document.createElement("label");
    line.className = "orow";
    line.title = `${r.label} — ${optionCommand(this.tool, r.name, r.value)}`;
    const label = document.createElement("span");
    label.className = "olabel";
    label.textContent = r.label;
    const field = document.createElement("input");
    field.className = "oval";
    field.dataset.option = r.name;
    // The tool it was built for, not whichever is armed when it commits.
    field.dataset.tool = this.tool;
    field.autocomplete = "off";
    field.spellcheck = false;
    if (r.choices) {
      // A choice: a drop-down of its words, the whole row wide — a choice's words
      // are longer than a number, and a label beside them left neither room
      // (looked at: "centre · radius" cut to "centre …", and "auto: centre ·
      // radius" cut too). Its name is its accessible label and its tooltip's.
      // Picking one types the arm line, as a field does.
      //
      // First, an option the list does not show: what the gesture has been read
      // as, shown in the box while the choice is left to read it — so the box
      // says "3 points", lit, and the list under it is still only the locks.
      // Its value is the default's, so picking from the list never mistakes it
      // for one.
      line.classList.add("ochoice");
      const pick = document.createElement("select");
      pick.className = "oval";
      pick.dataset.option = r.name;
      pick.dataset.tool = this.tool;
      pick.setAttribute("aria-label", r.label);
      const reading = document.createElement("option");
      reading.value = r.choices[0]?.[0] ?? "";
      reading.hidden = true;
      reading.dataset.read = "";
      pick.append(reading);
      for (const [value, text] of r.choices) {
        const o = document.createElement("option");
        o.value = value;
        o.textContent = text;
        pick.append(o);
      }
      pick.addEventListener("change", () => this.type(pick.dataset.tool!, r.name, pick.value));
      line.append(pick);
      return line;
    }
    const unit = document.createElement("span");
    unit.className = "ounit";
    unit.textContent = r.unit;
    if (typeof r.value === "boolean") {
      field.type = "checkbox";
      field.addEventListener("change", () => this.type(field.dataset.tool!, r.name, field.checked));
    } else {
      field.type = "text";
      field.inputMode = "decimal";
      field.addEventListener("keydown", (e) => {
        if (e.key === "Enter") {
          // The field, then the feature: one key, both done. The feature's
          // confirm waits for the field's line to have run, so it builds with
          // the value just typed.
          e.preventDefault();
          void Promise.resolve(this.commit(field)).then(() => this.host.confirm?.());
        } else if (e.key === "Escape") {
          // The field's own: it does not also release the tool underneath, nor
          // drop a feature's picks.
          e.stopPropagation();
          field.value = field.dataset.shown ?? "";
          this.host.trial?.(r.name, null);
          field.blur();
        }
      });
      field.addEventListener("input", () => this.host.trial?.(r.name, parseField(field.value)));
      field.addEventListener("blur", () => { void this.commit(field); });
    }
    line.append(label, field, unit);
    if (r.flip && typeof r.value === "number") line.append(this.flipButton(r));
    return line;
  }

  /**
   * The ⇅ beside a direction's field: one press types the value negated —
   * `arm("extrude", {depth: -10})` — so the preview turns at once and the
   * confirm types the negated call. Reads the value at the press, not when
   * built, and a field left mid-edit is committed first (the capture every
   * press gets), so a flip after typing 25 gives -25. Never takes the focus.
   */
  private flipButton(r: OptionRow): HTMLButtonElement {
    const b = document.createElement("button");
    b.type = "button";
    b.className = "oflip";
    b.dataset.flip = r.name;
    b.textContent = "⇅";
    b.setAttribute("aria-label", FLIP_LABEL);
    const tool = this.tool;
    const now = () => this.host.armed()?.rows.find((x) => x.name === r.name)?.value;
    giveTip(b, () => {
      const v = now();
      return {
        name: FLIP_LABEL,
        summary: `Turns the ${r.label} the other way`,
        command: typeof v === "number" ? optionCommand(tool, r.name, -v) : null,
      };
    }, this.host.tooltip);
    b.addEventListener("mousedown", (e) => e.preventDefault());
    b.addEventListener("click", () => {
      const v = now();
      if (typeof v === "number" && v !== 0) void this.type(tool, r.name, -v);
    });
    return b;
  }

  /**
   * Types the edited field's `arm` line, if it says something new and numeric;
   * else puts it back. Settles once the line has run.
   */
  private commit(field: HTMLInputElement): Promise<unknown> | void {
    const text = field.value.trim();
    if (text === field.dataset.shown) return;
    const v = parseField(text);
    if (v === null) {
      field.value = field.dataset.shown ?? "";
      this.host.trial?.(field.dataset.option!, null);
      return;
    }
    return this.type(field.dataset.tool!, field.dataset.option!, v);
  }

  private type(tool: string, option: string, value: number | boolean | string): Promise<unknown> | void {
    const ran = this.host.run(optionCommand(tool, option, value));
    // `arm` runs as the line is typed, so the tool is armed afresh by now — or,
    // refused, as it was; either way the fields say which, the edited one too.
    const a = this.host.armed();
    if (a && a.tool === this.tool) this.fill(a.rows, true, a.dialog?.choice ?? null);
    return ran;
  }

  /** Every field to its row's value — except, unless `force`, one being edited. */
  private fill(rows: OptionRow[], force: boolean, choice: DialogState["choice"] = null): void {
    const fields = Array.from(this.body.querySelectorAll<HTMLInputElement | HTMLSelectElement>(".oval"));
    // A row of buttons has no field, so fields are counted, not indexed by row.
    let next = 0;
    rows.forEach((r) => {
      if (r.choices && r.buttons) {
        const line = this.body.querySelector<HTMLElement>(`.ochoice[data-option="${r.name}"]`);
        if (!line) return;
        const hint = choice?.option === r.name && r.value === r.choices[0]?.[0] ? choice : null;
        for (const b of Array.from(line.querySelectorAll<HTMLButtonElement>("button.ochoose"))) {
          const word = b.dataset.choice!;
          b.setAttribute("aria-pressed", String(r.value === word));
          b.classList.toggle("resolved", hint?.resolved === word);
          b.classList.toggle("offer", hint?.offer === word);
        }
        line.title = `${r.label} — ${optionCommand(this.tool, r.name, r.value)}`;
        return;
      }
      const field = fields[next++];
      if (!field) return;
      if (field instanceof HTMLSelectElement) {
        // What the gesture was read as, in the hidden first option, lit, while
        // the choice is left to read it (it only ever is at its first word,
        // `auto`); the word chosen otherwise — a lock, or nothing read yet.
        const read = r.read ?? null;
        const options = Array.from(field.options);
        const shown = read !== null ? 0 : options.findIndex((o, k) => k > 0 && o.value === String(r.value));
        if (read !== null) options[0].textContent = read;
        if (field.selectedIndex !== shown) field.selectedIndex = shown;
        field.classList.toggle("oread", read !== null);
        (field.parentElement as HTMLElement).title = read
          ? `${r.label}: read as ${read} — pick it to lock it`
          : `${r.label} — ${optionCommand(this.tool, r.name, r.value)}`;
        return;
      }
      if (typeof r.value === "boolean") {
        field.checked = r.value;
        return;
      }
      const text = fieldText(r.value as number);
      const editing = document.activeElement === field && field.value !== field.dataset.shown;
      if (!force && editing) return;
      field.value = text;
      field.dataset.shown = text;
      (field.parentElement as HTMLElement).title = `${r.label} — ${optionCommand(this.tool, r.name, r.value)}`;
    });
  }
}

// ---- the action strip -------------------------------------------------------
//
// A finger has no Ctrl+Z, no Delete and no Escape (docs/plans/touch.md): the
// action strip is those four keys as buttons — **Undo, Redo, Delete, Cancel** —
// a tray like the toolbar, moved and turned the same way. Like every other
// piece of chrome it can only type: each button types its line through the
// host's `run` (`submit`), so the log shows `undo()` or `del("l1", "l2")` and
// the strip can do nothing a typed line could not. Shown where the primary
// pointer is coarse (the host decides, from the same media query the
// stylesheet sizes by); a mouse has the keys.

/** The strip's buttons, in order. */
export type Action = "undo" | "redo" | "delete" | "cancel";
export const ACTIONS: readonly Action[] = ["undo", "redo", "delete", "cancel"];

/** What the strip needs to know to say what each button would type. */
export interface ActionState {
  canUndo: boolean;
  canRedo: boolean;
  /** The canvas's selected names, as `sel()` lists them. */
  selected: readonly string[];
  /** Whether a tool is armed. */
  armed: boolean;
  /** Whether the Hand is armed — which Cancel puts down, and Delete does not mind. */
  hand?: boolean;
}

/**
 * The line `action` types now, or null when it would do nothing — and the
 * button is then disabled, rather than typing a line that only says so.
 * **Delete is the Delete key exactly**: the selection's names quoted as JSON,
 * and nothing while a tool is armed. **Cancel is `cancel()`**: the tool (or
 * the Hand) and the selection put down together — Escape's one-step-at-a-time
 * (a feature's picks first) is the options panel's ✗, which a feature always
 * shows.
 */
export function actionCommand(action: Action, state: ActionState): string | null {
  switch (action) {
    case "undo": return state.canUndo ? "undo()" : null;
    case "redo": return state.canRedo ? "redo()" : null;
    case "delete":
      return state.selected.length && !state.armed ? `del(${state.selected.map((n) => JSON.stringify(n)).join(", ")})` : null;
    case "cancel": return state.armed || state.hand || state.selected.length ? "cancel()" : null;
  }
}

const ACTION_LABELS: Readonly<Record<Action, string>> = {
  undo: "Undo", redo: "Redo", delete: "Delete selection", cancel: "Cancel",
};

/** What each does, in the words its tooltip says it in. */
const ACTION_SUMMARIES: Readonly<Record<Action, string>> = {
  undo: "Takes back the last change to the drawing",
  redo: "Puts back the change you last took back",
  delete: "Deletes what is selected",
  cancel: "Puts the tool down and clears the selection",
};

/** Why `action` would do nothing in `state` — what its tooltip says where the command would be. */
function actionOff(action: Action, state: ActionState): string {
  switch (action) {
    case "undo": return "nothing to undo";
    case "redo": return "nothing to redo";
    case "delete": return state.armed ? "put the tool down first — Delete is for the selection" : "select something first";
    case "cancel": return "nothing to cancel";
  }
}

/**
 * An action's tooltip: its name, what it does, and the line it would type now
 * (`del("l1", "l2")` names the selection) — or, while it would do nothing,
 * why — with the key that does the same (`actionKey`).
 */
export function actionTip(action: Action, state: ActionState, key: string | null = null): Tip {
  const command = actionCommand(action, state);
  return { name: ACTION_LABELS[action], summary: ACTION_SUMMARIES[action], command, off: command ? null : actionOff(action, state), key };
}

/**
 * The key each action is on a keyboard (main.ts's bindings): ⌘ on Apple's
 * systems, Ctrl elsewhere — an iPad with a keyboard has them too. Cancel is
 * Escape's nearest: Escape drops a feature's picks first, Cancel both at once.
 */
export function actionKey(action: Action, apple: boolean): string {
  switch (action) {
    case "undo": return apple ? "⌘Z" : "Ctrl+Z";
    case "redo": return apple ? "⇧⌘Z" : "Ctrl+Y";
    case "delete": return "Delete";
    case "cancel": return "Esc";
  }
}

/** The toolbar's glyph family (tools/icons.ts): a 16-unit box, 1.5-unit round strokes, nothing filled. */
function actionGlyph(name: Action, body: string): string {
  return `<svg class="ico" data-glyph="${name}" viewBox="0 0 16 16" width="16" height="16" aria-hidden="true" ` +
    `fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round">${body}</svg>`;
}

const ACTION_ICONS: Readonly<Record<Action, string>> = {
  undo: actionGlyph("undo", `<path d="M5.5 3.5 2.5 6.5l3 3"/><path d="M2.5 6.5H10a3.5 3.5 0 0 1 0 7H7"/>`),
  redo: actionGlyph("redo", `<path d="M10.5 3.5l3 3-3 3"/><path d="M13.5 6.5H6a3.5 3.5 0 0 0 0 7h3"/>`),
  delete: actionGlyph("delete", `<path d="M2.5 4.5h11"/><path d="M6.5 4.5V2.5h3v2"/><path d="M4 4.5l.8 9h6.4l.8-9"/>`),
  cancel: actionGlyph("cancel", `<path d="M4 4l8 8M12 4l-8 8"/>`),
};

/** What the action strip needs of its host. */
export interface ActionHost {
  state(): ActionState;
  /** Types one line into the command machinery, as one user action — `submit`. */
  run(command: string): void;
  /** The key each button is on a keyboard — `actionKey`. */
  key?(action: Action): string | null;
  /** Gives a button its tooltip (tooltip.ts); without it, each has a `title`. */
  tooltip?: AttachTip;
}

/**
 * The strip's buttons, one per `ACTIONS`, each disabled while it would do
 * nothing. The host calls `sync` whenever the history, the selection or the
 * armed tool may have changed — the toolbar's `sync` is called from the same
 * places — and it touches the DOM only for a button whose state changed.
 */
export class ActionStrip {
  private buttons = new Map<Action, HTMLButtonElement>();
  private host: ActionHost;

  constructor(el: HTMLElement, host: ActionHost) {
    this.host = host;
    for (const action of ACTIONS) {
      const b = document.createElement("button");
      b.type = "button";
      b.innerHTML = ACTION_ICONS[action];
      b.dataset.action = action;
      b.setAttribute("aria-label", ACTION_LABELS[action]);
      // Asked as it shows, so it names what the button would type then.
      if (host.tooltip) {
        host.tooltip(b, () => actionTip(action, this.host.state(), this.host.key?.(action) ?? null), {
          along: () => (el.closest<HTMLElement>(".panel")?.dataset.orient as "column" | "row" | undefined) ?? null,
          line: () => el,
        });
      } else {
        b.title = ACTION_LABELS[action];
      }
      // The focus stays where it was: a tap here must not raise a keyboard
      // that a tap on the command line had put away, nor take it from a field.
      b.addEventListener("mousedown", (e) => e.preventDefault());
      b.addEventListener("contextmenu", (e) => e.preventDefault());
      b.addEventListener("click", () => {
        // Asked again at the press, not read off the button: the state may
        // have moved since the last sync.
        const command = actionCommand(action, this.host.state());
        if (command) this.host.run(command);
      });
      el.appendChild(b);
      this.buttons.set(action, b);
    }
  }

  sync(): void {
    const state = this.host.state();
    for (const [action, b] of this.buttons) {
      const command = actionCommand(action, state);
      const off = command === null;
      if (b.disabled !== off) b.disabled = off;
      // With a tooltip it is read when shown; the title is only the fallback.
      if (this.host.tooltip) continue;
      const title = command ? `${ACTION_LABELS[action]} — ${command}` : ACTION_LABELS[action];
      if (b.title !== title) b.title = title;
    }
  }
}
