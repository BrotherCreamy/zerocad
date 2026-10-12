// Snapping: while a tool is drawing, pull the cursor onto whatever meaningful
// geometry is near it, so a rectangle started "on" a corner starts *exactly*
// on it rather than a pixel and a half away.
//
// The idea is cellwork's, though the mechanism differs. cellwork's pointer
// tools fill argument slots, so clicking an existing point simply used that
// point and clicking empty space auto-created one — the snap fell out of
// picking. neocad's tools are gesture-based (drag a rectangle) rather than
// slot-based, so the same idea lands here as: the *coordinate* a tool receives
// is snapped, and tools need to know nothing about it.
//
// Tolerances are in screen pixels and the tiers mirror picking's, for the same
// reason: an exact point beats a crossing beats a derived midpoint beats a
// point that merely lies somewhere along a curve.

import type { Model } from "./model.ts";
import { intersect, type Pt } from "./intersect.ts";
import { nearestOnPolyline, screenCurve, screenOf as projectPoint, type ScreenCurve } from "./projection.ts";
import type { View } from "./view.ts";

export type SnapKind = "point" | "intersection" | "midpoint" | "curve";

export interface Snap {
  /** Where the cursor should be treated as being. */
  world: number[];
  /** And where that is on screen, for drawing the marker. */
  screen: [number, number];
  kind: SnapKind;
  /**
   * What it snapped to, for the marker's label and for whatever the tool
   * infers from it.
   *
   * A list rather than a name because an `"intersection"` is *about two
   * curves* — that pairing is the whole of the feature, not an incidental
   * detail of how it was found, so it belongs in the type rather than in a
   * second field only one kind fills in. Every other kind carries exactly one
   * name, and `targets[0]` is that name.
   */
  targets: string[];
}

export const SNAP_POINT = 10;
export const SNAP_INTERSECTION = 8;
export const SNAP_MIDPOINT = 8;
export const SNAP_CURVE = 6;

/**
 * How far apart, in pixels' worth of world distance, the two curves' own
 * readings of a screen crossing may be and still be one place. A crossing of
 * two curves in one plane agrees to within the polyline's quarter-pixel; two
 * curves that only *look* crossed are as far apart as their depths, which is
 * nowhere near this.
 */
const SAME_PLACE_PX = 1;

function dist(ax: number, ay: number, bx: number, by: number): number {
  return Math.hypot(ax - bx, ay - by);
}

/**
 * The best snap for a cursor at (sx, sy), or null to use the raw position.
 *
 * Only ever *moves* the cursor — it never changes what a tool builds. A tool
 * that would have made a point at 3.02, 5.99 makes one at 3, 6 instead; it does
 * not silently reuse the existing point there. Welding coincident points is a
 * separate decision with different consequences, and conflating the two would
 * make snapping quietly destructive.
 *
 * **Where a snap is in the world is read off what it snapped to**, not off the
 * pixel. In 2D the two were one inverse apart and it made no difference; in 3D
 * a pixel is a ray, and only the geometry under it knows how deep it is. So a
 * point snap is that point's own coordinates, a midpoint the midpoint of the
 * edge's two ends, and a pixel along a curve the point of the curve it shows
 * (see projection.ts). A click on a vertex seen obliquely lands *on* the
 * vertex, wherever the working plane happens to be.
 */
export function findSnap(model: Model, view: View, sx: number, sy: number): Snap | null {
  const screenOf = (name: string) => projectPoint(model, view, name);
  const make = (screen: Pt, world: number[], kind: SnapKind, ...targets: string[]): Snap =>
    ({ screen, world, kind, targets });

  // Tier 1: an existing point. Exact, and almost always what was meant.
  let best: { snap: Snap; d: number } | null = null;
  for (const e of model.entities.values()) {
    if (e.kind !== "point") continue;
    const p = screenOf(e.name);
    const d = dist(sx, sy, p[0], p[1]);
    if (d < SNAP_POINT && (!best || d < best.d)) best = { snap: make(p, model.coords(e.name), "point", e.name), d };
  }
  if (best) return best.snap;

  // Tier 2: where two curves cross. Above midpoints because a crossing is a
  // place both curves agree on — the draughtsman's "there" — while a midpoint
  // is a property of one of them.
  //
  // In 3D two curves can cross on screen without meeting at all — one in front
  // of the other. So each curve reads the crossing back to its own world point,
  // and it is a crossing only where the two readings are one place. Two curves
  // in one sketch plane always agree; a circle, still a sphere, agrees with
  // its neighbours only seen square-on, which is the phase-2 seam showing.
  const near = curvesNear(model, view, sx, sy, SNAP_INTERSECTION);
  const sameWithin = SAME_PLACE_PX / view.scale;
  for (let i = 0; i < near.length; i++) {
    for (let j = i + 1; j < near.length; j++) {
      for (const at of intersect(near[i].shape.curve, near[j].shape.curve)) {
        const d = dist(sx, sy, at[0], at[1]);
        if (d >= SNAP_INTERSECTION || (best && d >= best.d)) continue;
        const p = near[i].shape.lift(at), q = near[j].shape.lift(at);
        if (Math.hypot(...p.map((v, k) => v - q[k])) > sameWithin) continue;
        const world = p.map((v, k) => (v + q[k]) / 2);
        best = { snap: make(at, world, "intersection", near[i].name, near[j].name), d };
      }
    }
  }
  if (best) return best.snap;

  // Tier 3: the middle of an edge — whose projection is the projection of its
  // middle, orthographic projection being affine.
  for (const e of model.entities.values()) {
    if (e.kind !== "line") continue;
    const a = screenOf(e.refs[0]);
    const b = screenOf(e.refs[1]);
    const mid: Pt = [(a[0] + b[0]) / 2, (a[1] + b[1]) / 2];
    const d = dist(sx, sy, mid[0], mid[1]);
    if (d < SNAP_MIDPOINT && (!best || d < best.d)) {
      const A = model.coords(e.refs[0]), B = model.coords(e.refs[1]);
      best = { snap: make(mid, A.map((v, k) => (v + B[k]) / 2), "midpoint", e.name), d };
    }
  }
  if (best) return best.snap;

  // Tier 4: somewhere along a curve — the nearest point on it.
  for (const e of model.entities.values()) {
    const shape = screenCurve(model, view, e, SNAP_INTERSECTION);
    const at = shape && nearestOnCurve(shape, sx, sy);
    if (shape && at && at.d < SNAP_CURVE && (!best || at.d < best.d)) {
      best = { snap: make(at.on, shape.lift(at.on), "curve", e.name), d: at.d };
    }
  }
  return best?.snap ?? null;
}

/**
 * The nearest point of a curve to (sx, sy), in screen pixels, or null if the
 * entity is not a curve (or is degenerate — a zero-length edge has no nearest
 * point worth reporting).
 *
 * This is tier 4's whole answer, and it is also the intersection tier's
 * prefilter, which is why it is a function rather than two loops. A crossing
 * within the tolerance of the cursor lies on both its curves, so both curves
 * are themselves within the tolerance: filtering on this distance first cannot
 * lose a candidate, and it turns a pairwise scan of the whole drawing into a
 * pairwise scan of the two or three curves actually under the hand.
 *
 * An arc seen square-on reports against its whole circle here, as it always
 * has — snapping along a rim is more forgiving than picking one, and the sweep
 * still gates the *crossings* that come out of the tier above. An arc seen
 * obliquely is a polyline on screen, and reports against the part of it that
 * is drawn: the rest of its ellipse is nothing anyone can see to aim at.
 */
function nearestOnCurve(shape: ScreenCurve, sx: number, sy: number): { on: Pt; d: number } | null {
  const curve = shape.curve;
  if (curve.kind === "segment") {
    const [ax, ay] = curve.a;
    const [bx, by] = curve.b;
    const len = dist(ax, ay, bx, by);
    if (len < 1e-6) return null;
    const t = Math.max(0, Math.min(1, ((sx - ax) * (bx - ax) + (sy - ay) * (by - ay)) / (len * len)));
    const on: Pt = [ax + t * (bx - ax), ay + t * (by - ay)];
    return { on, d: dist(sx, sy, on[0], on[1]) };
  }
  if (curve.kind === "circle" || curve.kind === "arc") {
    const [cx, cy] = curve.c;
    const r = curve.r;
    const away = dist(sx, sy, cx, cy);
    if (away < 1e-6) return null;
    const on: Pt = [cx + ((sx - cx) / away) * r, cy + ((sy - cy) / away) * r];
    return { on, d: dist(sx, sy, on[0], on[1]) };
  }
  const near = nearestOnPolyline(curve.pts, [sx, sy]);
  return near && { on: near.on, d: near.d };
}

/** The curves within `tol` pixels of the cursor, with their screen shapes. */
function curvesNear(
  model: Model,
  view: View,
  sx: number,
  sy: number,
  tol: number,
): { name: string; shape: ScreenCurve }[] {
  const out: { name: string; shape: ScreenCurve }[] = [];
  for (const e of model.entities.values()) {
    const shape = screenCurve(model, view, e, SNAP_INTERSECTION);
    const at = shape && nearestOnCurve(shape, sx, sy);
    if (shape && at && at.d < tol) out.push({ name: e.name, shape });
  }
  return out;
}

/** A short label for the snap marker: what it caught and how. */
export function describeSnap(snap: Snap): string {
  switch (snap.kind) {
    case "point": return snap.targets[0];
    case "intersection": return snap.targets.join(" × ");
    case "midpoint": return `mid ${snap.targets[0]}`;
    case "curve": return `on ${snap.targets[0]}`;
  }
}
