// The app's chrome as floating panels over a full-window canvas: a small panel
// manager, and the toolbar that is the first panel built for it.
//
// A panel is a DOM box with a title strip to drag by and — unless its size is
// its content's: a tray, always one line of its buttons, or the options panel,
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
// and home indicator — and a panel touching an edge that has an inset reaches
// under it, its content kept clear (`bleed`). A panel the viewer has moved is
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
// edges it meets, what a stored layout parses to — is pure functions over
// plain numbers, tested without a DOM. The DOM half is thin on purpose.
//
// This file imports nothing from the model or the tools. The toolbar is given
// its tool names, their glyphs and its armed tool by its host, and the options
// panel the armed tool's declared options and their values; each hands back a
// command string, so neither can reach the model any more than the context
// menu can, nor do anything a typed line could not.

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
 * Which way a tray runs. A tray is a panel of buttons — the toolbar is the one
 * there is — and it is the one kind of panel that turns: the log and the
 * command line keep their shape wherever they are put.
 */
export type Orientation = "column" | "row";

/**
 * A panel's rectangle, and for a tray the way it runs. `fixed` marks the one
 * thing in a layout that nothing moves — the logo: a push that reaches it
 * stops flush against it, exactly as a push that reaches the area's edge does.
 */
export interface Placed extends Rect { orient?: Orientation; fixed?: boolean }

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
 * is. A finger's is `touchMetrics`: **drawn at the interface size, hit at 44**
 * (docs/plans/chrome-logo-scale.md). The two are apart on purpose — a finger's
 * chrome used to be *drawn* at Apple's 44 pt target, which is what the owner
 * called huge; now a button is drawn at the device's size and a press lands on
 * it over 44 px however small it is drawn. The stylesheet draws from the same
 * numbers (the host sets them as custom properties), so the two cannot
 * disagree.
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
  /** The least a control answers a press over, in each direction: 44 under a finger, 0 (its drawn box) under a mouse. */
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
}

export const FINE: Metrics = {
  title: 16, button: 20, gap: 2, icon: 16, grip: 12, logo: 20, optionRow: 22, optionsW: 168, line: 28, logLine: 30,
  hit: 0, coarse: false, scale: 1,
};

/** Apple's minimum target, 44 pt — a CSS pixel is a point on an iPhone. What a finger's controls are hit at. */
export const TOUCH_TARGET = 44;

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
    hit: base.hit, coarse: base.coarse, scale: k,
  };
}

/**
 * A finger's metrics at interface size `s` (a phone's 100 % is 1.3,
 * uiscale.ts): the mouse's, scaled — and then each control made to answer a
 * press over `TOUCH_TARGET` without being drawn any bigger. A tray's buttons
 * are spaced so that each one's pitch along the tray is a whole target (its
 * hit box, index.html's `::before`, overhangs its face across the tray too);
 * an option's row and the command line's are a target tall, their fields
 * drawn at the size inside; a grip, which draws nothing, is a target square.
 */
export function touchMetrics(s: number): Metrics {
  const m = scaledMetrics(FINE, s);
  return {
    ...m,
    gap: Math.max(m.gap, TOUCH_TARGET - m.button),
    grip: TOUCH_TARGET,
    optionRow: Math.max(m.optionRow, TOUCH_TARGET),
    line: Math.max(m.line, TOUCH_TARGET),
    hit: TOUCH_TARGET,
    coarse: true,
  };
}

/** A finger's metrics at a phone's 100 % — what the tests and the defaults' docs call a phone. */
export const COARSE: Metrics = touchMetrics(1.3);

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
 * The size of a tray of `buttons` buttons running `orient` — and the one thing
 * that sizes a tray (the owner: *"its just a straight line that fits the number
 * of tools it has in it, and can either be vert or horiz"*). One line: one
 * button thick, and along its run the strip, the padding and every button. A
 * column's strip is across its top; a row's down its left end — so that a row
 * is one button high, which is what makes it a row against a top or bottom
 * edge rather than a short column lying down.
 *
 * Nothing the viewer does sets it: a tray has no grips (`gripCorners`), a turn
 * re-sizes it to this the other way, and a stored size is never read
 * (`arranged`). The one thing that cuts it short is a window shorter than the
 * line, which clips it at the window's edge (`constrain`) — not a window
 * anyone draws in, so not designed for beyond staying inside.
 */
export function traySize(buttons: number, orient: Orientation, m: Metrics = FINE): Size {
  const run = m.title + 6 + buttons * (m.button + m.gap);
  const depth = m.button + 6 + 2;
  return orient === "column" ? { w: depth, h: run } : { w: run, h: depth };
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
  const to = keep(placed(constrain(want, area, minSizes[id] ?? { w: 0, h: 0 }), orient));
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
  const rect = keep(placed(out[id], orient));
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
    const t = turned(r.rect, r.rect.orient, area, others, (o) => traySize(buttons, o, m));
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

// ---- the default layout -----------------------------------------------------

/** Margin between a default panel and the area's edge, and between panels. */
const GAP = 8;
const LOG_H = 150;
const BOTTOM_W = 560;
/** The organiser's (docs/plans/organiser.md) default size at 100 % — a mouse's, and a finger's width. */
const ORGANISER_W = 190;
const ORGANISER_H = 260;
const ORGANISER_TOUCH_W = 120;
const ORGANISER_TOUCH_H = 170;

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
    toolbar: { x: GAP, y: top, ...traySize(tools, "column", m), orient: "column" },
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
 * — a phone's, in either orientation, at the interface size `m` carries. The
 * logo has the top-left corner in both; nothing default touches it.
 *
 * **Portrait**: the command line **docked to the bottom**, edge to edge — the
 * owner: *"Please allow it to be dragged right to the bottom"*; touching the
 * bottom, it reaches under the home indicator with its line above it (`bleed`),
 * iOS's own toolbar. (It was at the top, on the theory that a line typed at
 * the bottom sits under the keyboard it raises; iOS scrolls a focused field
 * into view, and the owner had dragged it to the bottom himself — see the
 * spec's limitations.) The tray a **column down the left**, under the logo —
 * eleven buttons are too long a row for a phone's width. The action strip at
 * the top right, where the owner put it in his own screenshot, and the
 * one-line log under it, right of the tray.
 *
 * **Landscape** (wider than tall): the tray a row docked to the bottom, the
 * command line along the top right of the logo, the action strip at the top
 * right with the one-line log under it.
 *
 * Positions only, like every default: the viewer moves anything, and what they
 * move is theirs. Safe areas are the area's business — `area` is the space
 * inside them.
 */
function touchLayout(area: Size, tools: number, m: Metrics): Layout {
  const cmdH = m.title + m.line;
  const logH = m.title + m.logLine;
  const act = traySize(ACTIONS.length, "row", m);
  const logo = logoBox(m);
  if (area.w >= area.h) {
    const bar = traySize(tools, "row", m);
    const right = area.w - GAP - act.w;
    const left = logo.w + GAP;
    return {
      cmd: { x: left, y: GAP, w: right - GAP - left, h: cmdH },
      actions: { x: right, y: GAP, ...act, orient: "row" },
      log: { x: right, y: GAP + act.h + GAP, w: act.w, h: logH },
      toolbar: { x: GAP, y: area.h - bar.h, ...bar, orient: "row" },
      // Under the log, as wide as the strip, down to the tray's row.
      organiser: organiserAt(area, act.w, Math.round(ORGANISER_TOUCH_H * m.scale), GAP + act.h + GAP + logH + GAP, area.h - bar.h - GAP),
    };
  }
  const bar = traySize(tools, "column", m);
  const left = GAP + bar.w + GAP;
  const w = area.w - left - GAP;
  // Under the strip, and low enough that its strip's hit box — which reaches
  // up over the drawing to a whole target (index.html) — stays out of the
  // logo's row: the status is there, and a drag that starts on it must reach
  // the drawing (measured: at the strip's own margin it took the press).
  const logY = Math.max(GAP + act.h + GAP, logo.h + Math.max(0, m.hit - m.title) + GAP / 2);
  const cmdY = area.h - cmdH;
  const below = logY + logH + GAP;
  return {
    toolbar: { x: GAP, y: logo.h + GAP, ...bar, orient: "column" },
    actions: { x: area.w - GAP - act.w, y: GAP, ...act, orient: "row" },
    log: { x: left, y: logY, w, h: logH },
    cmd: { x: 0, y: cmdY, w: area.w, h: cmdH },
    // Beside a column on the left the options panel would hang in the middle
    // of a phone's drawing (measured: it covered the rectangle the extrude was
    // aimed at). So it gets the space right of the tray, between the log and
    // the command line, and sits in that box's bottom-right corner — just
    // above the line, its ✓ under the same thumb (`inCorner`).
    options: { x: left, y: below, w, h: cmdY - GAP - below },
    // Under the log at the right edge, the top of that same box: the options
    // panel sits in its bottom corner, so the two share it without meeting.
    organiser: organiserAt(area, Math.round(ORGANISER_TOUCH_W * m.scale), Math.round(ORGANISER_TOUCH_H * m.scale), below, cmdY - GAP),
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
 * **A tray's size is never read from either.** Its position and the way it runs
 * are kept, and its size is `traySize` of the buttons it has: so a tray stored
 * when it could be resized and wrapped comes up one line where it was, and one
 * that gains a tool is a button longer whether or not the viewer ever moved it,
 * pushing whatever that reaches. The storage key stays v2 — the size is still
 * written with the rectangle, and simply never believed.
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
    const size = tray ? traySize(trays[id], orient!, m) : fitted[id] ?? { w: want.w, h: want.h };
    wanted[id] = placed(constrain({ x: want.x, y: want.y, ...size }, area, minOf(id, orient)), orient);
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
// content is never under any of them. But **a panel touching an edge that has
// an inset extends its ground under the inset and keeps its content clear of
// it**: iOS's own toolbar, which runs to the bottom of the glass with its
// buttons above the home indicator. That is `bleed`, and it is drawing only:
// every rule above — push, turn, the clamp — is about the rectangle inside the
// safe area, and none of it knows the inset exists.

/** The safe area's insets from the window's edges, in CSS pixels (`env(safe-area-inset-*)`). */
export interface Insets { top: number; right: number; bottom: number; left: number }
export const NO_INSETS: Insets = { top: 0, right: 0, bottom: 0, left: 0 };

/**
 * Where a panel at `r` — in the area's coordinates, the safe area's — is drawn
 * in the window's, and how much of it is padding: for each edge of the area it
 * touches that has an inset, it reaches out by the inset, which it pads. An
 * edge it does not touch, or one with no inset, it neither reaches nor pads:
 * a floating panel is drawn exactly where it is.
 */
export function bleed(r: Rect, area: Size, insets: Insets): { rect: Rect; pad: Insets } {
  const touches = {
    left: r.x <= EPS, top: r.y <= EPS,
    right: r.x + r.w >= area.w - EPS, bottom: r.y + r.h >= area.h - EPS,
  };
  const pad: Insets = {
    top: touches.top ? insets.top : 0, right: touches.right ? insets.right : 0,
    bottom: touches.bottom ? insets.bottom : 0, left: touches.left ? insets.left : 0,
  };
  return {
    rect: { x: insets.left + r.x - pad.left, y: insets.top + r.y - pad.top, w: r.w + pad.left + pad.right, h: r.h + pad.top + pad.bottom },
    pad,
  };
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
  const rec: Recorded = { ...placed(r, r.orient), area: { w: area.w, h: area.h }, scale, dock };
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
 *   same distance along that panel as before (`ox`/`oy`), held so the two
 *   still overlap — a log on the toolbar's top stays on the toolbar.
 * - **Against nothing at all**: the same share of the free room as before —
 *   halfway across a portrait phone is halfway across a landscape one.
 *
 * A panel waits for the panels it rests against to be placed first. Two that
 * rest on each other (a log against the toolbar's right is the toolbar against
 * the log's left) are a ring: the one with more sides against the area's edges
 * goes first, by those, and the other follows it. A side against a panel that
 * is gone — hidden, or never there — counts as against nothing.
 *
 * A tray whose line no longer fits along its run — a row along the bottom of a
 * landscape phone, stood up — turns, keeping its edges: it is a column against
 * the same bottom edge. Nothing here holds a panel inside the area or keeps
 * panels apart; that is `arranged`'s, which this feeds.
 */
export function relaid(
  recs: Readonly<Record<string, Recorded>>, base: Layout, area: Size, scale: number,
  sizeOf: (id: string, orient: Orientation | undefined) => Size | null,
  minOf: (id: string, orient: Orientation | undefined) => Size,
): Layout {
  const ids = Object.keys(recs);
  const sizes: Record<string, Size> = {};
  const orients: Record<string, Orientation | undefined> = {};
  const stretchy = new Set<string>();
  for (const id of ids) {
    const rec = recs[id];
    let orient = rec.orient;
    let s = sizeOf(id, orient);
    if (s && orient) {
      const long = orient === "row" ? s.w > area.w : s.h > area.h;
      const other: Orientation = orient === "row" ? "column" : "row";
      const t = sizeOf(id, other);
      if (long && t && (other === "row" ? t.w <= area.w : t.h <= area.h)) [orient, s] = [other, t];
    }
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
        return [clamp(np + off, np - len + 1, np + nl - 1), len];
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
    out[id] = placed({ x, y, w, h }, orients[id]);
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
    // `false` is a pane shown that starts hidden on this device (`hiddenAtFirst`).
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

/** The lowest panel's z-index; index.html puts the hover tag and menu well above any stack. */
const PANEL_Z = 10;

/** `r` running `orient` — or, for a panel that is not a tray, just `r`. */
function placed(r: Rect, orient: Orientation | undefined): Placed {
  return orient ? { x: r.x, y: r.y, w: r.w, h: r.h, orient } : { x: r.x, y: r.y, w: r.w, h: r.h };
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
 * an inset edge is drawn reaching under it, padded by it (`bleed`). `fixed`
 * names the panels nothing moves — the logo — each an element placed at the
 * area's top-left at the size it answers, which the others are pushed against
 * and docked to like any panel.
 *
 * `trays` names the panels that are trays, each with how many buttons it holds
 * right now: those, and only those, have no grips, are always one line of
 * their buttons (`traySize`, re-counted on every `apply`), and turn between
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
  /** The panels that start hidden until the viewer shows them — the organiser on a phone. */
  private hiddenAtFirst: Set<string>;
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

  constructor(
    area: HTMLElement, defaults: (area: Size) => Layout, storage: StorageLike | null,
    trays: Record<string, () => number> = {},
    options: {
      check?: boolean; fitted?: Record<string, Fitted>; metrics?: Metrics;
      fixed?: Record<string, Fixed>; insets?: () => Insets; hiddenAtFirst?: readonly string[];
    } = {},
  ) {
    this.hiddenAtFirst = new Set(options.hiddenAtFirst ?? []);
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

  /** Whether the viewer has hidden `id` — or, having said nothing, whether it starts hidden here. */
  private hiddenByViewer(id: string): boolean {
    return this.stored[id]?.hidden ?? this.hiddenAtFirst.has(id);
  }

  /**
   * Puts every panel where the layouts say, clear of one another (`arranged`),
   * each tray one line of the buttons it has now and each stored panel docked
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
    const defaults = this.defaults(area);
    const recs: Record<string, Recorded> = {};
    for (const id of [...order, ...later]) if (this.stored[id]?.at) recs[id] = this.stored[id].at!;
    const sizeOf = (id: string, orient: Orientation | undefined): Size | null =>
      id in counts ? traySize(counts[id], orient ?? "column", this.m) : sizes[id] ?? null;
    const minOf = (id: string, orient: Orientation | undefined) => this.min(id, orient);
    const relay = (base: Layout) => relaid(recs, base, area, this.m.scale, sizeOf, minOf);
    const unstored = (ids: string[], from: Layout) =>
      Object.fromEntries(ids.filter((id) => !recs[id] && from[id]).map((id) => [id, from[id]]));
    if (later.length) {
      // Earlier panels hold their places in `settled`, so the tray is where the
      // panels without the fitted ones put it — which is what "beside" means.
      const base0 = { ...fixed, ...unstored(order, defaults) };
      const first = arranged(order, relay(base0), defaults, counts, area, {}, this.m, fixed).layout;
      for (const id of later) {
        const by = this.fitted[id].beside;
        const box = defaults[id];
        defaults[id] = box ? inCorner(box, sizes[id], area)
          : by && first[by] ? besideTray(first[by], sizes[id], area) : { x: GAP, y: GAP, ...sizes[id] };
      }
    }
    const all = [...order, ...later];
    const wanted = relay({ ...fixed, ...unstored(all, defaults) });
    const s = arranged(all, wanted, defaults, counts, area, sizes, this.m, fixed);
    this.show(s.layout, s.ok);
  }

  /**
   * Puts each panel where `layout` says. With `check` on (the dev server, and
   * so every e2e run) a layout with two panels overlapping is reported as an
   * error on the page — unless the resolver has already said it could find
   * no other (`sound` false: a window too small to hold them all).
   */
  private show(layout: Layout, sound = true): void {
    for (const [id, r] of Object.entries(layout)) {
      if (r.fixed) { this.shown[id] = r; continue; }
      const el = this.els.get(id);
      if (el && this.shown[id] !== r) this.place(id, el, r);
    }
    if (this.check && sound) {
      const bad = overlapping(this.shown);
      // Reported, not thrown: thrown from here it would break the very gesture
      // that showed it, where the point is to see it and carry on.
      if (bad.length) reportError(new Error(`panels overlap: ${bad.map((p) => p.join(" and ")).join(", ")} — ${JSON.stringify(this.shown)}`));
    }
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
    // Drawn reaching under any inset edge it touches, its content padded clear
    // of it; the rectangle it is in the layout is `r` all the same.
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
    const bled = (["top", "right", "bottom", "left"] as const).filter((side) => pad[side] > 0).join(" ");
    if (bled) el.dataset.bleed = bled;
    else delete el.dataset.bleed;
    const strip = el.querySelector<HTMLElement>(":scope > .ptitle");
    if (r.orient && el.dataset.orient !== r.orient) el.dataset.orient = r.orient;
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
    // A pane that starts hidden keeps being shown only by saying so.
    if (shown && !this.hiddenAtFirst.has(id)) delete entry.hidden;
    else entry.hidden = !shown;
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
    return [describeLayout(panels, at), ...(hidden.length ? [`hidden   ${hidden.join(", ")}`] : []), where].join("\n");
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
    const strip = el.querySelector<HTMLElement>(":scope > .ptitle");
    if (strip) {
      // A tray's strip is sized by `place`, which knows which way it runs.
      if (!(id in this.trays)) strip.style.height = `${this.m.title}px`;
      this.gesture(id, strip, "move");
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

  private gesture(id: string, handle: HTMLElement, kind: "move" | "resize", corner: Corner = "se"): void {
    // `mousedown`, not `pointerdown`, is the event whose default moves focus and
    // starts a text selection. Prevented, a drag leaves the command line holding
    // the focus it had, so typing after rearranging still types.
    handle.addEventListener("mousedown", (e) => e.preventDefault());
    handle.addEventListener("pointerdown", (e) => {
      if (e.button !== 0) return;
      e.preventDefault();
      const el = this.els.get(id)!;
      // The whole layout at the press: a push can move any panel, and each one
      // this gesture moves is stored at its end like the one held.
      const start = { ...this.shown };
      // The pointer in the layout's own coordinates — the safe area's, so the
      // element's box less the insets. Held for the whole gesture, the grab has
      // to be a point *of the panel*, or a tray that turns (`regrasped`)
      // carries the offset along its strip. Measured once: the area does not
      // move under a held pointer, and measuring it on every move would force
      // a layout after each `show`.
      const box = this.area.getBoundingClientRect();
      const [ox, oy] = [box.left + this.area.clientLeft + this.inset.left, box.top + this.area.clientTop + this.inset.top];
      const at = (ev: PointerEvent): Point => ({ x: ev.clientX - ox, y: ev.clientY - oy });
      let grab = grabbed(id, kind, at(e), this.shown, corner);
      // Counted at the press: nothing defines a tool while a pointer is held on a panel.
      const buttons = id in this.trays ? this.trays[id]() : undefined;
      handle.setPointerCapture(e.pointerId);
      el.classList.add("held");
      this.holding = true;
      const move = (ev: PointerEvent) => {
        if (ev.pointerId !== e.pointerId) return;
        const step = dragStep(grab, at(ev), this.shown, this.size(),
          (o, orient) => this.min(o, orient), buttons, this.m);
        grab = step.grab;
        this.show(step.layout);
      };
      const end = (ev: PointerEvent) => {
        if (ev.pointerId !== e.pointerId) return;
        handle.removeEventListener("pointermove", move);
        handle.removeEventListener("pointerup", end);
        handle.removeEventListener("pointercancel", end);
        el.classList.remove("held");
        this.holding = false;
        // A press that never moved is not an arrangement; storing it would turn
        // an untouched panel's following-the-defaults into a fixed position.
        // Nor is a panel the gesture left where it was.
        this.remember(start);
        if (this.stale) { this.stale = false; this.apply(); }
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
 * this is where the name the command line calls it is read — then the command
 * it types.
 */
export function buttonTitle(tool: string): string {
  return `${tool} — ${armCommand(tool)}`;
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
    // The host's string, from a table of constants or built round the name
    // escaped; nothing a file or another viewer supplies reaches it.
    b.innerHTML = this.host.icon(tool);
    b.dataset.tool = tool;
    b.setAttribute("aria-label", tool);
    b.title = buttonTitle(tool);
    b.setAttribute("aria-pressed", "false");
    // Keeps the focus where it was — the command line — so a click on a button
    // is not followed by Enter or Space re-pressing it instead of submitting.
    b.addEventListener("mousedown", (e) => e.preventDefault());
    b.addEventListener("contextmenu", (e) => e.preventDefault());
    b.addEventListener("click", () => this.host.run(armCommand(tool)));
    return b;
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

/** One declared option as the panel shows it: what it is called, its unit's text, and the armed value. */
export interface OptionRow { name: string; label: string; unit: string; value: number | boolean }

/**
 * A feature tool's ✓ and ✗, as the panel shows them: whether ✓ would do
 * anything now. Its own shape rather than the tools' — this file knows nothing
 * of tools — which the host fills from the engine.
 */
export interface DialogState { ready: boolean }

/** What the options panel needs of its host. */
export interface OptionsHost {
  /**
   * The armed tool's registered name and its declared options — and, for a
   * tool that makes a feature, the state of its ✓ — or null when none is armed
   * or it has neither options nor a ✓.
   */
  armed(): { tool: string; rows: OptionRow[]; dialog?: DialogState | null } | null;
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
}

/**
 * The line a field types: `arm("extrude", {depth: 25})` — the tool quoted as
 * JSON, as a button quotes it, and only the option edited. The others need not
 * be said: each was either never typed, and is filled from its default, or was,
 * and is remembered, which is exactly what the tool is armed with now.
 */
export function optionCommand(tool: string, option: string, value: number | boolean): string {
  const key = /^[A-Za-z_$][\w$]*$/.test(option) ? option : JSON.stringify(option);
  return `arm(${JSON.stringify(tool)}, {${key}: ${String(value)}})`;
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
    const key = a
      ? [a.tool, a.dialog ? "dialog" : "", ...a.rows.map((r) => `${r.name}\t${typeof r.value}\t${r.label}\t${r.unit}`)].join("\n")
      : "";
    const shaped = key !== this.key;
    if (shaped) {
      this.key = key;
      this.tool = a?.tool ?? "";
      this.count = a ? a.rows.length + (a.dialog ? 1 : 0) : null;
      this.body.textContent = "";
      this.ok = null;
      if (this.strip) this.strip.textContent = a ? a.tool : "";
      for (const row of a?.rows ?? []) this.body.appendChild(this.row(row));
      if (a?.dialog) this.body.appendChild(this.actions());
    }
    if (a) this.fill(a.rows, false);
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
    const button = (cls: string, text: string, title: string, act: () => void) => {
      const b = document.createElement("button");
      b.className = cls;
      b.type = "button";
      b.textContent = text;
      b.title = title;
      b.addEventListener("mousedown", (e) => e.preventDefault());
      b.addEventListener("click", act);
      return b;
    };
    this.ok = button("ok", "✓", "confirm — Enter", () => this.host.confirm?.());
    line.append(this.ok, button("no", "✗", "cancel — Escape", () => this.host.cancel?.()));
    return line;
  }

  private row(r: OptionRow): HTMLElement {
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
    return line;
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

  private type(tool: string, option: string, value: number | boolean): Promise<unknown> | void {
    const ran = this.host.run(optionCommand(tool, option, value));
    // `arm` runs as the line is typed, so the tool is armed afresh by now — or,
    // refused, as it was; either way the fields say which, the edited one too.
    const a = this.host.armed();
    if (a && a.tool === this.tool) this.fill(a.rows, true);
    return ran;
  }

  /** Every field to its row's value — except, unless `force`, one being edited. */
  private fill(rows: OptionRow[], force: boolean): void {
    const fields = Array.from(this.body.querySelectorAll<HTMLInputElement>("input.oval"));
    rows.forEach((r, i) => {
      const field = fields[i];
      if (!field) return;
      if (typeof r.value === "boolean") {
        field.checked = r.value;
        return;
      }
      const text = fieldText(r.value);
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
}

/**
 * The line `action` types now, or null when it would do nothing — and the
 * button is then disabled, rather than typing a line that only says so.
 * **Delete is the Delete key exactly**: the selection's names quoted as JSON,
 * and nothing while a tool is armed. **Cancel is `cancel()`**: the tool and
 * the selection put down together — Escape's one-step-at-a-time (a feature's
 * picks first) is the options panel's ✗, which a feature always shows.
 */
export function actionCommand(action: Action, state: ActionState): string | null {
  switch (action) {
    case "undo": return state.canUndo ? "undo()" : null;
    case "redo": return state.canRedo ? "redo()" : null;
    case "delete":
      return state.selected.length && !state.armed ? `del(${state.selected.map((n) => JSON.stringify(n)).join(", ")})` : null;
    case "cancel": return state.armed || state.selected.length ? "cancel()" : null;
  }
}

const ACTION_LABELS: Readonly<Record<Action, string>> = {
  undo: "Undo", redo: "Redo", delete: "Delete selection", cancel: "Cancel",
};

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
      b.title = ACTION_LABELS[action];
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
      const title = command ? `${ACTION_LABELS[action]} — ${command}` : ACTION_LABELS[action];
      if (b.title !== title) b.title = title;
    }
  }
}
