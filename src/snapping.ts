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
import { arcSlack, intersect, screenAngle, type Curve } from "./intersect.ts";
import { screenToWorld, worldToScreen, type View } from "./view.ts";

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
 */
export function findSnap(model: Model, view: View, sx: number, sy: number): Snap | null {
  const screenOf = (name: string) => {
    const c = model.coords(name);
    return worldToScreen(view, [c[0], c[1]]);
  };
  const make = (screen: [number, number], kind: SnapKind, ...targets: string[]): Snap => ({
    screen,
    world: screenToWorld(view, screen[0], screen[1]),
    kind,
    targets,
  });

  // Tier 1: an existing point. Exact, and almost always what was meant.
  let best: { snap: Snap; d: number } | null = null;
  for (const e of model.entities.values()) {
    if (e.kind !== "point") continue;
    const p = screenOf(e.name);
    const d = dist(sx, sy, p[0], p[1]);
    if (d < SNAP_POINT && (!best || d < best.d)) best = { snap: make(p, "point", e.name), d };
  }
  if (best) return best.snap;

  // Tier 2: where two curves cross. Above midpoints because a crossing is a
  // place both curves agree on — the draughtsman's "there" — while a midpoint
  // is a property of one of them.
  const near = curvesNear(model, view, sx, sy, SNAP_INTERSECTION, screenOf);
  for (let i = 0; i < near.length; i++) {
    for (let j = i + 1; j < near.length; j++) {
      for (const [x, y] of intersect(near[i].curve, near[j].curve)) {
        const d = dist(sx, sy, x, y);
        if (d < SNAP_INTERSECTION && (!best || d < best.d)) {
          best = { snap: make([x, y], "intersection", near[i].name, near[j].name), d };
        }
      }
    }
  }
  if (best) return best.snap;

  // Tier 3: the middle of an edge.
  for (const e of model.entities.values()) {
    if (e.kind !== "line") continue;
    const a = screenOf(e.refs[0]);
    const b = screenOf(e.refs[1]);
    const mid: [number, number] = [(a[0] + b[0]) / 2, (a[1] + b[1]) / 2];
    const d = dist(sx, sy, mid[0], mid[1]);
    if (d < SNAP_MIDPOINT && (!best || d < best.d)) best = { snap: make(mid, "midpoint", e.name), d };
  }
  if (best) return best.snap;

  // Tier 4: somewhere along a curve — the nearest point on it.
  for (const e of model.entities.values()) {
    const at = nearestOnCurve(model, view, e, sx, sy, screenOf);
    if (at && at.d < SNAP_CURVE && (!best || at.d < best.d)) {
      best = { snap: make(at.on, "curve", e.name), d: at.d };
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
 * An arc reports against its whole circle here, as it always has — snapping
 * along a rim is more forgiving than picking one, and the sweep still gates
 * the *crossings* that come out of the tier above.
 */
function nearestOnCurve(
  model: Model,
  view: View,
  e: Entity,
  sx: number,
  sy: number,
  screenOf: (name: string) => [number, number],
): { on: [number, number]; d: number } | null {
  if (e.kind === "line") {
    const [ax, ay] = screenOf(e.refs[0]);
    const [bx, by] = screenOf(e.refs[1]);
    const len = dist(ax, ay, bx, by);
    if (len < 1e-6) return null;
    const t = Math.max(0, Math.min(1, ((sx - ax) * (bx - ax) + (sy - ay) * (by - ay)) / (len * len)));
    const on: [number, number] = [ax + t * (bx - ax), ay + t * (by - ay)];
    return { on, d: dist(sx, sy, on[0], on[1]) };
  }
  if (e.kind === "circle" || e.kind === "arc") {
    const [cx, cy] = screenOf(e.center);
    const r = model.radius(e.name) * view.scale;
    const away = dist(sx, sy, cx, cy);
    if (away < 1e-6) return null;
    const on: [number, number] = [cx + ((sx - cx) / away) * r, cy + ((sy - cy) / away) * r];
    return { on, d: dist(sx, sy, on[0], on[1]) };
  }
  return null;
}

/** The curves within `tol` pixels of the cursor, as screen-space geometry. */
function curvesNear(
  model: Model,
  view: View,
  sx: number,
  sy: number,
  tol: number,
  screenOf: (name: string) => [number, number],
): { name: string; curve: Curve }[] {
  const out: { name: string; curve: Curve }[] = [];
  for (const e of model.entities.values()) {
    const at = nearestOnCurve(model, view, e, sx, sy, screenOf);
    if (!at || at.d >= tol) continue;
    const curve = screenCurve(model, view, e, screenOf);
    if (curve) out.push({ name: e.name, curve });
  }
  return out;
}

/** An entity as the plain screen-space curve intersect.ts understands. */
function screenCurve(
  model: Model,
  view: View,
  e: Entity,
  screenOf: (name: string) => [number, number],
): Curve | null {
  if (e.kind === "line") return { kind: "segment", a: screenOf(e.refs[0]), b: screenOf(e.refs[1]) };
  if (e.kind === "circle") {
    return { kind: "circle", c: screenOf(e.center), r: model.radius(e.name) * view.scale };
  }
  if (e.kind === "arc") {
    const c = screenOf(e.center);
    const r = model.radius(e.name) * view.scale;
    return {
      kind: "arc",
      c,
      r,
      a0: screenAngle(c[0], c[1], ...screenOf(e.start)),
      a1: screenAngle(c[0], c[1], ...screenOf(e.end)),
      slack: arcSlack(r, SNAP_INTERSECTION),
    };
  }
  return null;
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
