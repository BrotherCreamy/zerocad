// The app's chrome as floating panels over a full-window canvas: a small panel
// manager, and the toolbar that is the first panel built for it.
//
// A panel is a DOM box with a title strip to drag by and — unless its size is
// its content's: a tray, always one line of its buttons, or the options panel,
// one row per option — a grip on each of its four corners to resize by. Every
// piece of chrome — the toolbar, the log, the command line, the armed tool's
// options — is one, and the canvas underneath is the whole of the area
// below the header, which nothing reflows any more. The header is the one fixed
// thing: it is the app's title bar, carrying the solve status (and, in the
// single-file build, the buildstamp), and a title bar that could be dragged
// away would leave nowhere to read either.
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

/** How far past the area's edge in `dir` the furthest panel that `after` moved (and `before` had elsewhere) has gone. */
function excess(before: Layout, after: Layout, mover: string, axis: Axis, dir: 1 | -1, area: Size): number {
  let e = 0;
  for (const id of Object.keys(after)) {
    if (id === mover || after[id] === before[id]) continue;
    const r = after[id];
    e = Math.max(e, dir > 0 ? start(r, axis) + span(r, axis) - room(area, axis) : -start(r, axis));
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
  const to = placed(constrain(want, area, minSizes[id] ?? { w: 0, h: 0 }), orient);
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
  const rect = placed(out[id], orient);
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
  buttons?: number,
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
    const t = turned(r.rect, r.rect.orient, area, others, (o) => traySize(buttons, o));
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

/** What each panel will not shrink below. */
const MIN: Record<string, Size> = {
  log: { w: 160, h: TITLE_H + 30 },
  cmd: { w: 160, h: CMD_H },
};
const DEFAULT_MIN: Size = { w: 80, h: TITLE_H + 20 };

/**
 * What panel `id` will not shrink below. A tray's is one button, either way it
 * runs: nothing makes a tray smaller on purpose, but a window shorter than its
 * line clips it, and one button and the strip are what must be left to take it
 * by.
 */
export function minSizeOf(id: string, orient: Orientation | undefined, tray: boolean, fitted?: Size): Size {
  // A panel sized by its content is that size, or clipped; nothing shrinks it.
  if (fitted) return fitted;
  if (tray) return traySize(1, orient ?? "column");
  return MIN[id] ?? DEFAULT_MIN;
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
  fitted: Readonly<Record<string, Size>> = {},
): { layout: Layout; ok: boolean } {
  const wanted: Layout = {};
  const minOf = (id: string, orient: Orientation | undefined) => minSizeOf(id, orient, id in trays, fitted[id]);
  for (const id of order) {
    const want = stored[id] ?? defaults[id] ?? { x: GAP, y: GAP, w: 200, h: 120 };
    const tray = id in trays;
    // A tray always runs some way; one with nothing stored or defaulted runs
    // the default's way, which is down.
    const orient = tray ? want.orient ?? "column" : undefined;
    const size = tray ? traySize(trays[id], orient!) : fitted[id] ?? { w: want.w, h: want.h };
    wanted[id] = placed(constrain({ x: want.x, y: want.y, ...size }, area, minOf(id, orient)), orient);
  }
  const mins = Object.fromEntries(order.map((id) => [id, minOf(id, wanted[id].orient)]));
  return settled(wanted, order, area, mins);
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
export function optionsSize(rows: number): Size {
  return { w: OPTIONS_W, h: TITLE_H + 8 + rows * OPTION_ROW };
}

/**
 * Where a panel of `size` goes by default: beside the tray, on the side of it
 * the window has room on — right of a column on the left half, left of one on
 * the right; below a row in the top half, above one in the bottom — lined up
 * with the tray's near end, a margin off it, and held inside. The options
 * panel's default, so it comes up where the eye already is, next to the button
 * that armed the tool, wherever the viewer has put the tray.
 */
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
 * viewer *asked for* — only the panels they have touched, as they left them —
 * and is what persists. What is on screen is that, or the default for an
 * untouched panel, passed through `constrain` against the area as it is now.
 * So shrinking the window pulls panels in without forgetting where they were
 * put, and widening it again puts them back.
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

export class Panels {
  private area: HTMLElement;
  private storage: StorageLike | null;
  private defaults: (area: Size) => Layout;
  private trays: Record<string, () => number>;
  private fitted: Record<string, Fitted>;
  private stored: Layout;
  private els = new Map<string, HTMLElement>();
  /** Where each panel is on screen right now — what a gesture starts from. */
  private shown: Layout = {};
  /** Back to front. The panel last pressed is drawn over the others. */
  private order: string[] = [];
  private check: boolean;
  /** A gesture is in progress; `apply` waits for it (`stale`) rather than undo its pushes. */
  private holding = false;
  private stale = false;

  constructor(
    area: HTMLElement, defaults: (area: Size) => Layout, storage: StorageLike | null,
    trays: Record<string, () => number> = {}, options: { check?: boolean; fitted?: Record<string, Fitted> } = {},
  ) {
    this.area = area;
    this.defaults = defaults;
    this.storage = storage;
    this.trays = trays;
    this.fitted = options.fitted ?? {};
    this.check = options.check ?? false;
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
    return minSizeOf(id, orient, id in this.trays, this.fitted[id]?.size() ?? undefined);
  }

  /**
   * Puts every panel where the layouts say, clear of one another (`arranged`),
   * each tray one line of the buttons it has now. Cheap; call it whenever a
   * default or a tray's count may have changed. What it moves is not stored:
   * it is this window's answer, and a wider one may need none of it.
   */
  apply(): void {
    // Mid-gesture the gesture owns the layout: putting the panels back where
    // the stored layout says would throw away the pushes it has made so far.
    if (this.holding) { this.stale = true; return; }
    const area = this.size();
    const counts = Object.fromEntries(Object.entries(this.trays).map(([id, n]) => [id, n()]));
    const order: string[] = [];
    const later: string[] = [];
    const sizes: Record<string, Size> = {};
    for (const [id, el] of this.els) {
      const f = this.fitted[id];
      if (!f) { order.push(id); continue; }
      const size = f.size();
      el.hidden = size === null;
      if (size === null) { delete this.shown[id]; continue; }
      sizes[id] = size;
      later.push(id);
    }
    const defaults = this.defaults(area);
    if (later.length) {
      // Earlier panels hold their places in `settled`, so the tray is where the
      // panels without the fitted ones put it — which is what "beside" means.
      const first = arranged(order, this.stored, defaults, counts, area).layout;
      for (const id of later) {
        const by = this.fitted[id].beside;
        defaults[id] = by && first[by] ? besideTray(first[by], sizes[id], area) : { x: GAP, y: GAP, ...sizes[id] };
      }
    }
    const s = arranged([...order, ...later], this.stored, defaults, counts, area, sizes);
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
      if (!(id in this.trays)) strip.style.height = `${TITLE_H}px`;
      this.gesture(id, strip, "move");
    }
    // Every panel but a tray has the four, made here rather than written out in
    // the page: that a panel resizes from any corner, and a tray from none, is
    // the panel manager's rule, not something each panel's markup could
    // forget. Last in the panel, so they are over its content — each only a
    // 12px triangle in its corner (the stylesheet clips it), which leaves a
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
      // The pointer in the area's own coordinates, the layout's. With the grab
      // re-based on every move, window coordinates did no harm — the header's
      // height cancelled out. Held for the whole gesture, the grab has to be a
      // point *of the panel*, or a tray that turns (`regrasped`) carries the
      // header's height along its strip. Measured once: the area does not
      // move under a held pointer, and measuring it on every move would force
      // a layout after each `show`.
      const box = this.area.getBoundingClientRect();
      const [ox, oy] = [box.left + this.area.clientLeft, box.top + this.area.clientTop];
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
          (o, orient) => this.min(o, orient), buttons);
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
        let changed = false;
        for (const [o, now] of Object.entries(this.shown)) {
          const was = start[o];
          if (was && now.x === was.x && now.y === was.y && now.w === was.w && now.h === was.h &&
              now.orient === was.orient) continue;
          this.stored[o] = now;
          changed = true;
        }
        if (changed) saveLayout(this.storage, this.stored);
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

  constructor(panel: HTMLElement, body: HTMLElement, host: OptionsHost) {
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

  /** The panel's size now, or null while no tool with options is armed — `Fitted.size`. */
  size(): Size | null {
    return this.count === null ? null : optionsSize(this.count);
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
