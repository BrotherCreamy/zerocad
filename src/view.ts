// The view: an orthographic camera, kept as pure functions over a plain object.
//
// Split out of the tool engine so the arithmetic can be tested without a
// canvas or a DOM — panning, zooming and turning are exactly the sort of thing
// that looks right until you zoom out far enough for a sign error to show.
//
// **It used to be the 2D transform, and it still is, exactly, until something
// turns it.** The convention is cellwork's, with y flipped because screen y
// grows downward and world y grows upward:
//
//     screen_x = ox + (world · right) * scale
//     screen_y = oy - (world · up)    * scale
//
// With `right` = +x and `up` = +y — which is what a view that has never been
// turned has, and what a `View` with no orientation means — that is the 2D
// formula term for term, multiplied through by exact ones and zeros, so every
// 2D caller gets bit-identical numbers. `ox`/`oy` keep their meaning (where
// the world origin lands on screen) and `scale` its (pixels per world unit).
//
// **Orthographic, deliberately, and no perspective in v1.** A sketcher draws in
// parallel projection — Onshape does while you sketch — and it is what keeps
// every tolerance in this codebase honest: a pick radius of six pixels means
// the same thing at the front of the drawing as at the back, and a line stays
// a line. The price is that depth is invisible except through foreshortening,
// which is what orbiting is for.
//
// The orientation is stored as the camera's own two screen axes in world
// terms — `right` and `up`, with `toward` (out of the screen, at the viewer)
// their cross product — rather than as an azimuth and an elevation. Two angles
// cannot hold the one view the 3D package most needs, a tilted frame seen
// face-on with its +x to the right (that needs a roll), and an orbit driven by
// angles about the *kernel's* z would make the gauge's z the drawing's "up",
// which is the world frame coming back in through the camera. An orbit here
// turns about the screen's own axes instead, which is also how Onshape's feels.
//
// `target` is the orbit pivot: the point a turn keeps still on screen, and the
// point the camera-parallel working plane passes through when there is no
// default frame to draw on (see `cameraPlane`). It is **screen-anchored**:
// panning and zooming carry it along so it stays on the same pixel — the
// middle of the canvas, for a view that started with the origin there — and
// only a turn is about it. So "orbit" always means "about what is in the middle
// of the window", wherever the drawing has been panned to.

import { cross3, dot3, lift3, unit3 } from "./vec3.ts";

export interface View {
  ox: number;
  oy: number;
  scale: number;
  /**
   * The screen's +x and +y as world unit vectors. Absent means the view has
   * never been turned: +x to the right, +y up, looking down −z — the top view,
   * which is the 2D transform exactly.
   */
  right?: number[];
  up?: number[];
  /** The orbit pivot, in world coordinates. Absent means the world origin. */
  target?: number[];
}

/**
 * A plane, by a point on it and two unit directions in it. Its normal is
 * `u × v`, so the order of the two says which side is the front.
 */
export interface Plane {
  origin: number[];
  u: number[];
  v: number[];
}

/**
 * Whether `world` lies on `plane` — to a millionth of its distance from the
 * plane's origin, and never tighter than a millionth of a unit. Loose enough to
 * accept a point the solver holds on the plane only to its own tolerance, or
 * one lifted off a curve that is; a point that is merely *behind* the plane on
 * the same pixel misses it by a great deal more. The one answer to "is this on
 * the sketch" that snapping and inference both ask.
 */
export function liesOn(plane: Plane, world: number[]): boolean {
  const n = cross3(plane.u, plane.v);
  const nLen = Math.hypot(n[0], n[1], n[2]);
  if (!(nLen > 0)) return false;
  const o = lift3(plane.origin), w = lift3(world);
  const off = [w[0] - o[0], w[1] - o[1], w[2] - o[2]];
  const away = Math.hypot(off[0], off[1], off[2]);
  return Math.abs(dot3(off, n)) / nLen <= 1e-6 * Math.max(1, away);
}

/** How far the view may be zoomed, so a stray wheel event cannot wreck it. */
export const MIN_SCALE = 1e-3;
export const MAX_SCALE = 1e5;

const X = [1, 0, 0];
const Y = [0, 1, 0];

/** The camera's three axes in world terms: screen-right, screen-up, and out of the screen. */
export function viewAxes(view: View): { right: number[]; up: number[]; toward: number[] } {
  const right = view.right ?? X;
  const up = view.up ?? Y;
  return { right, up, toward: cross3(right, up) };
}

function targetOf(view: View): number[] {
  return view.target ?? [0, 0, 0];
}

export function worldToScreen(view: View, world: number[]): [number, number] {
  const w = lift3(world);
  const { right, up } = viewAxes(view);
  return [view.ox + dot3(w, right) * view.scale, view.oy - dot3(w, up) * view.scale];
}

/**
 * How near the viewer a world point is — larger is nearer. Only the order means
 * anything: it is what the renderer sorts by, painter's-style, so a nearer edge
 * is drawn over a farther one.
 */
export function depth(view: View, world: number[]): number {
  return dot3(lift3(world), viewAxes(view).toward);
}

/**
 * The point at depth zero under a pixel — where the pixel's ray through the
 * scene crosses the camera-parallel plane through the world origin. Every
 * other point under that pixel is this one moved along `toward`.
 */
function rayBase(view: View, sx: number, sy: number): number[] {
  const { right, up } = viewAxes(view);
  const a = (sx - view.ox) / view.scale;
  const b = (view.oy - sy) / view.scale;
  return [a * right[0] + b * up[0], a * right[1] + b * up[1], a * right[2] + b * up[2]];
}

/**
 * Where the pixel (sx, sy) looks at a plane, or null when the plane is seen
 * edge-on and the pixel's ray runs along it rather than through it.
 *
 * This is what pointing *means* in 3D. A 2D cursor names a line through the
 * scene, not a point, so a click needs a surface to land on — the working plane
 * (see `tools/engine.ts`) — and this is the one intersection everything that
 * turns a pixel into a place goes through.
 */
export function screenToPlane(view: View, sx: number, sy: number, plane: Plane): number[] | null {
  const q = rayBase(view, sx, sy);
  const { toward } = viewAxes(view);
  const n = cross3(plane.u, plane.v);
  // Measured against a unit normal, so "edge-on" is an angle (about 1e-9 rad of
  // grazing), not something that depends on how long `u` and `v` are.
  const nLen = Math.hypot(n[0], n[1], n[2]);
  const denom = dot3(toward, n);
  if (!(nLen > 0) || Math.abs(denom) <= 1e-9 * nLen) return null;
  // The ray is q + λ·toward; it meets the plane where (q + λ·toward − o)·n = 0.
  const o = lift3(plane.origin);
  const lambda = (dot3(o, n) - dot3(q, n)) / denom;
  return [q[0] + lambda * toward[0], q[1] + lambda * toward[1], q[2] + lambda * toward[2]];
}

/**
 * The 2D inverse: the world point under (sx, sy) **in a 2D model**, whose whole
 * world is the plane z = 0, as two coordinates.
 *
 * In a view that has never been turned this is the old formula exactly — the
 * ray is the z axis and crosses z = 0 at (a, b). In a turned one it is where
 * the pixel's ray meets that plane, which is still the honest answer for a
 * drawing that lies in it; seen edge-on there is no crossing, and the depth-zero
 * point is returned rather than infinity. A 3D model never asks this — it asks
 * `screenToPlane` against a working plane, because a cursor does not name a
 * point in 3D until something says which surface it is on.
 */
export function screenToWorld(view: View, sx: number, sy: number): number[] {
  const q = rayBase(view, sx, sy);
  const { toward } = viewAxes(view);
  if (Math.abs(toward[2]) <= 1e-9) return [q[0], q[1]];
  const lambda = -q[2] / toward[2];
  return [q[0] + lambda * toward[0], q[1] + lambda * toward[1]];
}

/**
 * The plane through the orbit target that faces the viewer — what a click lands
 * on when there is no default frame to draw on. In a view that has never been
 * turned, with the target at its default, it is the plane z = 0: the plane every
 * 2D drawing already lived in.
 */
export function cameraPlane(view: View): Plane {
  const { right, up } = viewAxes(view);
  return { origin: targetOf(view).slice(), u: right.slice(), v: up.slice() };
}

export function clampScale(scale: number): number {
  // NaN carries no intent, so it falls back to the far-out end, where the
  // whole drawing is at least visible. Infinity does carry intent — "as far
  // in as it goes" — and is treated as such rather than lumped in with NaN.
  if (Number.isNaN(scale)) return MIN_SCALE;
  if (scale === Infinity) return MAX_SCALE;
  if (scale <= 0) return MIN_SCALE;
  return Math.min(MAX_SCALE, Math.max(MIN_SCALE, scale));
}

/**
 * `next` with its target moved, within the camera-parallel plane, back onto the
 * pixel it occupied in `before` — which is what keeps the pivot screen-anchored
 * through a pan or a zoom. Absent stays absent while nothing has moved it, so a
 * view nobody navigated compares equal to how it started.
 */
function keepTargetPixel(before: View, next: View): View {
  const t = targetOf(before);
  const [px, py] = worldToScreen(before, t);
  const [qx, qy] = worldToScreen(next, t);
  if (px === qx && py === qy) return next;
  const { right, up } = viewAxes(next);
  const a = (px - qx) / next.scale, b = (qy - py) / next.scale;
  return { ...next, target: [0, 1, 2].map((i) => t[i] + a * right[i] + b * up[i]) };
}

/**
 * Zooms by `factor` while keeping whatever is under (sx, sy) exactly where it
 * is — the behaviour that makes a wheel feel like it is pointing at something
 * rather than at the middle of the window.
 *
 * Solved directly rather than nudged: the offset of the cursor from the origin
 * is read first, and the origin is then placed so that same offset lands back
 * on the same pixel at the new scale. No drift as the scale accumulates. In a
 * turned view this is still exact, and for the same reason: an orthographic
 * zoom is a uniform scaling of the *screen* about the cursor, so it never needs
 * to know which world point is under it.
 */
export function zoomAbout(view: View, sx: number, sy: number, factor: number): View {
  const wx = (sx - view.ox) / view.scale;
  const wy = (view.oy - sy) / view.scale;
  const scale = clampScale(view.scale * factor);
  return keepTargetPixel(view, { ...view, scale, ox: sx - wx * scale, oy: sy + wy * scale });
}

/** Zooms about a fixed point without moving the cursor anchor (command-line zoom). */
export function zoomBy(view: View, factor: number, sx: number, sy: number): View {
  return zoomAbout(view, sx, sy, factor);
}

export function panBy(view: View, dxScreen: number, dyScreen: number): View {
  return keepTargetPixel(view, { ...view, ox: view.ox + dxScreen, oy: view.oy + dyScreen });
}

/** `v` turned by `angle` about the unit axis `k` (Rodrigues). */
function rotate(v: number[], k: number[], angle: number): number[] {
  const c = Math.cos(angle), s = Math.sin(angle);
  const kv = cross3(k, v);
  const kd = dot3(k, v) * (1 - c);
  return [0, 1, 2].map((i) => v[i] * c + kv[i] * s + k[i] * kd);
}

/**
 * A right-handed orthonormal pair from two directions that are nearly one —
 * `right` kept, `up` straightened against it. Applied after every turn, so a
 * thousand small orbits cannot accumulate into a skewed camera.
 */
function orthonormal(right: number[], up: number[]): { right: number[]; up: number[] } | null {
  const r = unit3(right);
  if (!r) return null;
  const along = dot3(up, r);
  const u = unit3([up[0] - along * r[0], up[1] - along * r[1], up[2] - along * r[2]]);
  return u ? { right: r, up: u } : null;
}

/**
 * The view turned to a new orientation, with `pivot` held on the pixel it was
 * on — the one move every turn is made of. The pivot becomes the target, so the
 * next orbit is about the same point and the camera-parallel working plane goes
 * through it.
 */
function turnTo(view: View, right: number[], up: number[], pivot: number[]): View {
  const axes = orthonormal(right, up);
  if (!axes) return view;
  const p = lift3(pivot);
  const [px, py] = worldToScreen(view, p);
  return {
    ...view,
    right: axes.right,
    up: axes.up,
    target: p,
    ox: px - dot3(p, axes.right) * view.scale,
    oy: py + dot3(p, axes.up) * view.scale,
  };
}

/**
 * Turns the drawing about the orbit target: `yaw` radians about the screen's
 * vertical, `pitch` about its horizontal.
 *
 * The signs are a hand's: positive yaw carries the near side of the drawing to
 * the right and positive pitch carries it down, so a drag that moves the cursor
 * right and down turns the drawing the way grabbing it would. Both turns are
 * about the *screen's* axes as they were at the start of the call — a
 * trackball, not a turntable — because a turntable needs a world "up" to turn
 * about, and the only candidate here is the kernel's z, which is a gauge and
 * not a direction anyone chose.
 *
 * Implemented by turning the camera the other way, which is the same thing
 * seen from the drawing.
 */
export function orbitBy(view: View, yaw: number, pitch: number): View {
  const { right, up } = viewAxes(view);
  // The camera turns by the inverse of the drawing's turn: −pitch about the
  // screen's right, then −yaw about its (original) up.
  const r1 = rotate(rotate(right, right, -pitch), up, -yaw);
  const u1 = rotate(rotate(up, right, -pitch), up, -yaw);
  return turnTo(view, r1, u1, targetOf(view));
}

/**
 * Points the camera so that the screen's right and up are the given world
 * directions — how `lookAt` puts a frame's plane face-on with its +x to the
 * right. `pivot` keeps its pixel and becomes the orbit target.
 */
export function alignView(view: View, right: number[], up: number[], pivot: number[]): View {
  return turnTo(view, lift3(right), lift3(up), pivot);
}

/** Copies `next` into `view` in place, so anything holding the object sees it. */
export function assignView(view: View, next: View): void {
  view.ox = next.ox;
  view.oy = next.oy;
  view.scale = next.scale;
  // Only what `next` actually carries: a view that was never turned keeps
  // having no orientation, which is what lets it keep meaning "the 2D view".
  if (next.right) view.right = next.right.slice();
  if (next.up) view.up = next.up.slice();
  if (next.target) view.target = next.target.slice();
}
