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

import type { Entity, Model } from "./model.ts";
import { intersect, type Pt } from "./intersect.ts";
import { nearestOnPolyline, screenCurve, screenOf as projectPoint, type ScreenCurve } from "./projection.ts";
import { liesOn, worldToScreen, type Plane, type View } from "./view.ts";
import { inSight, type Occlusion } from "./occlusion.ts";
import { cross3, dot3, lift3, unit3 } from "./vec3.ts";

/**
 * What a snap caught. `"projected"` is the one that is not a place in the
 * drawing at all: a point *off* the sketch plane, offered at its projection
 * onto the plane — a position to draw at, and nothing to infer from (see
 * `findSnap`).
 */
export type SnapKind = "point" | "intersection" | "midpoint" | "projected" | "curve";

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
 *
 * **`sketch`, when given, is the plane being drawn on** — the default frame's,
 * in a 3D model — and then only places *on* it are offered as themselves.
 * Seen square-on, a sketch has whole stacks of geometry behind it sharing its
 * pixels: a floor's front and back corners are one pixel to a camera looking
 * at the wall standing on its back edge. Snapping to whichever of a stack came
 * first would pin a point of the wall to a corner of the floor seventy units
 * behind it, dragging the wall's edge out of its own plane — the drawing
 * obeying a click the user never made. A vertex, edge or crossing that really
 * is on the sketch (the floor's back edge, which the wall stands on) is still
 * found.
 *
 * **A point *off* the sketch is offered at its projection onto it** — Onshape's
 * "use / project into the sketch", as a position aid and no more: tier 4, a
 * `"projected"` snap whose world is the foot of the perpendicular from the
 * point to the plane. Drawing a wall's outline over a floor's far corner then
 * lands *on the wall*, square in front of that corner, which is what aiming at
 * it meant. It infers **nothing** (see tools/place.ts): a coincidence with a
 * point the new one is not at would be a lie, and a constraint to a projected
 * ghost needs a relation this model does not have. Below every place that is
 * really on the sketch — a point, a crossing or a midpoint there infers
 * something true, and wins at any distance inside the tolerance — and above a
 * bare curve, because a vertex aimed at is a more particular intent than an
 * edge passed over. **Points only**, in this package: projecting edges and
 * curves into the sketch is a larger change (a projected circle is an ellipse
 * the snap would have to intersect) and is left for later.
 *
 * Without a sketch plane (no default frame, or a 2D model) everything is
 * offered as itself, as it always was, and nothing is ever projected.
 *
 * **`occ`, when given, is the frame's answer to what a solid hides**
 * (occlusion.ts) — the one the draw pass and `hitTest` use — and nothing it
 * hides is offered: not a point, a crossing, a midpoint or a place along a
 * curve behind a visible face, and not a projection of a vertex that cannot be
 * seen. A snap is a place the hand was aiming at, and nobody aims at what is
 * not drawn. Null (no solid, or the hidden and wire modes) offers everything.
 */
export function findSnap(model: Model, view: View, sx: number, sy: number, sketch?: Plane | null,
                         occ: Occlusion | null = null): Snap | null {
  // What is hidden is not on screen, so nothing about it is offered — not a
  // point, a crossing, a midpoint, a projection or a place along it.
  const shown = [...model.entities.values()].filter((e) => !model.hidden.has(e.name));
  const screenOf = (name: string) => projectPoint(model, view, name);
  const make = (screen: Pt, world: number[], kind: SnapKind, ...targets: string[]): Snap =>
    ({ screen, world, kind, targets });
  // On the sketch, and in sight: every tier's place must be both to be offered as itself.
  const onSketch = (world: number[]) => (!sketch || liesOn(sketch, world)) && inSight(occ, world);

  // Tier 1: an existing point. Exact, and almost always what was meant.
  let best: { snap: Snap; d: number } | null = null;
  for (const e of shown) {
    if (e.kind !== "point") continue;
    const p = screenOf(e.name);
    const d = dist(sx, sy, p[0], p[1]);
    const world = model.coords(e.name);
    if (d < SNAP_POINT && (!best || d < best.d) && onSketch(world)) best = { snap: make(p, world, "point", e.name), d };
  }
  if (best) return best.snap;

  // Tier 2: where two curves cross. Above midpoints because a crossing is a
  // place both curves agree on — the draughtsman's "there" — while a midpoint
  // is a property of one of them.
  //
  // In 3D two curves can cross on screen without meeting at all — one in front
  // of the other. So each curve reads the crossing back to its own world point,
  // and it is a crossing only where the two readings are one place. Two curves
  // in one sketch plane always agree, a circle's planar rim as much as a line —
  // at any angle of view, which a circle drawn as a sphere's silhouette could
  // not manage.
  const near = curvesNear(model, view, sx, sy, SNAP_INTERSECTION, shown);
  const sameWithin = SAME_PLACE_PX / view.scale;
  for (let i = 0; i < near.length; i++) {
    for (let j = i + 1; j < near.length; j++) {
      for (const at of intersect(near[i].shape.curve, near[j].shape.curve)) {
        const d = dist(sx, sy, at[0], at[1]);
        if (d >= SNAP_INTERSECTION || (best && d >= best.d)) continue;
        const p = near[i].shape.lift(at), q = near[j].shape.lift(at);
        if (Math.hypot(...p.map((v, k) => v - q[k])) > sameWithin) continue;
        const world = p.map((v, k) => (v + q[k]) / 2);
        if (!onSketch(world)) continue;
        best = { snap: make(at, world, "intersection", near[i].name, near[j].name), d };
      }
    }
  }
  if (best) return best.snap;

  // Tier 3: the middle of an edge — whose projection is the projection of its
  // middle, orthographic projection being affine.
  for (const e of shown) {
    if (e.kind !== "line") continue;
    const a = screenOf(e.refs[0]);
    const b = screenOf(e.refs[1]);
    const mid: Pt = [(a[0] + b[0]) / 2, (a[1] + b[1]) / 2];
    const d = dist(sx, sy, mid[0], mid[1]);
    if (d < SNAP_MIDPOINT && (!best || d < best.d)) {
      const A = model.coords(e.refs[0]), B = model.coords(e.refs[1]);
      const world = A.map((v, k) => (v + B[k]) / 2);
      if (onSketch(world)) best = { snap: make(mid, world, "midpoint", e.name), d };
    }
  }
  if (best) return best.snap;

  // Tier 4: a point off the sketch, at its projection onto it — a position aid
  // that infers nothing. See the note above.
  if (sketch) {
    const foot = footOnPlane(sketch);
    for (const e of shown) {
      if (e.kind !== "point") continue;
      const world = model.coords(e.name);
      if (onSketch(world) || !foot || !inSight(occ, world)) continue;
      const at = foot(world).slice(0, model.dim);
      const p = worldToScreen(view, at);
      const d = dist(sx, sy, p[0], p[1]);
      if (d < SNAP_POINT && (!best || d < best.d) && inSight(occ, at)) best = { snap: make(p, at, "projected", e.name), d };
    }
    if (best) return best.snap;
  }

  // Tier 5: somewhere along a curve — the nearest point on it.
  for (const e of shown) {
    const shape = screenCurve(model, view, e, SNAP_INTERSECTION);
    const at = shape && nearestOnCurve(shape, sx, sy);
    if (shape && at && at.d < SNAP_CURVE && (!best || at.d < best.d)) {
      const world = shape.lift(at.on);
      if (onSketch(world)) best = { snap: make(at.on, world, "curve", e.name), d: at.d };
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

/**
 * The orthogonal projection onto a plane — the foot of the perpendicular from a
 * point — or null for a plane with no normal to drop one along. Along the
 * plane's *own* normal, not along the line of sight: seen square-on the two
 * are one, and seen obliquely the foot is still the point of the sketch
 * nearest the vertex, which is what "project it into the sketch" means, rather
 * than wherever the pixel's ray happens to cross the plane.
 */
function footOnPlane(plane: Plane): ((world: number[]) => number[]) | null {
  const n = unit3(cross3(lift3(plane.u), lift3(plane.v)));
  if (!n) return null;
  const o = lift3(plane.origin);
  return (world) => {
    const w = lift3(world);
    const off = dot3([w[0] - o[0], w[1] - o[1], w[2] - o[2]], n);
    return [w[0] - off * n[0], w[1] - off * n[1], w[2] - off * n[2]];
  };
}

/** The curves within `tol` pixels of the cursor, with their screen shapes. */
function curvesNear(
  model: Model,
  view: View,
  sx: number,
  sy: number,
  tol: number,
  among: Iterable<Entity> = model.entities.values(),
): { name: string; shape: ScreenCurve }[] {
  const out: { name: string; shape: ScreenCurve }[] = [];
  for (const e of among) {
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
    case "projected": return `proj ${snap.targets[0]}`;
    case "curve": return `on ${snap.targets[0]}`;
  }
}
