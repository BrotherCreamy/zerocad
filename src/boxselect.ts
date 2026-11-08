// What a dragged rectangle selects.
//
// The fourth of the pure "question about the drawing" modules, beside
// `picking.ts`, `snapping.ts` and `glyphs.ts`: a function of (model, view,
// rectangle) with no canvas, no pointer and no state, which is what lets the
// whole of it be tested without a browser. `picking.ts` answers "what is under
// this pixel"; this answers "what is inside this rectangle", and the two are
// deliberately separate files because the tie-breaking that dominates picking
// (tiers, tolerances, nearest wins) has no counterpart here — a box selects
// everything that qualifies, and nothing competes.
//
// **The direction of the drag is the mode**, exactly as in SolidWorks and
// Onshape, so people arrive already knowing it:
//
//   left → right   window select    only what is *fully contained*
//   right → left   crossing select  anything the box *touches*
//
// That is not a detail worth inventing an alternative for. It is one of the
// few gestures in CAD that every user of every package already has in their
// hands, and getting it backwards would be worse than not having it.
//
// Tests are in **screen space**, like picking's and snapping's, and for the
// same reason: the rectangle is pixels, dragged by a hand, and the tolerance
// for "did that edge clip the corner" is a pixel question. `intersect.ts` sits
// below this file and supplies the segment–segment, segment–circle and
// arc-sweep answers, so a box and a click cannot disagree about where an arc
// stops.
//
// One rule earns its own note, because it is the one people get wrong: **a
// rectangle lying wholly inside a circle touches nothing.** The entity is the
// rim, not the disc — the same rule picking already follows, where the middle
// of a circle is empty space.

import { isClosedEntity, type Entity, type Model } from "./model.ts";
import { intersect, withinSweep, type Curve, type Pt } from "./intersect.ts";
import { frameArms, frameMarker } from "./framemarker.ts";
import { sampledWorld, screenCurve, screenOf as projectPoint } from "./projection.ts";
import { inSight, visibleRuns, type Occlusion } from "./occlusion.ts";
import { arcSamples, arcSegments, frameReach } from "./arcgeom.ts";
import { curveFrame } from "./curveplane.ts";
import { frameBasis } from "./relations/refs.ts";
import { frameArmPx } from "./framemarker.ts";
import type { View } from "./view.ts";

/** Which of the two selections the drag direction asked for. */
export type BoxMode = "window" | "crossing";

/** A screen-space rectangle, normalised so x0 ≤ x1 and y0 ≤ y1. */
export interface ScreenRect {
  x0: number;
  y0: number;
  x1: number;
  y1: number;
}

/**
 * How far outside the sweep a crossing may fall and still count as being on an
 * arc, in pixels. One: enough that a rectangle edge clipping an arc exactly at
 * its endpoint is a touch rather than a coin-flip on the last bit of the
 * mantissa, and far too little to reach anything that is not really there.
 */
const ARC_SLACK_PX = 1;

/**
 * The rectangle a drag from (ax, ay) to (bx, by) describes, and what it means.
 *
 * Mode comes off the horizontal direction alone — vertical movement says
 * nothing about it, which is also how the ancestors behave. A drag with no
 * horizontal component at all reads as a window, the safer of the two: a
 * window can only ever select a subset of what a crossing would.
 */
export function boxFrom(ax: number, ay: number, bx: number, by: number): { rect: ScreenRect; mode: BoxMode } {
  return {
    rect: {
      x0: Math.min(ax, bx), y0: Math.min(ay, by),
      x1: Math.max(ax, bx), y1: Math.max(ay, by),
    },
    mode: bx >= ax ? "window" : "crossing",
  };
}

/**
 * The names of every entity the box selects, in the model's own order.
 *
 * **Relations are not selectable**, and it takes no code to say so: they live
 * in a registry beside the entity map rather than in it, so a box never sees
 * them. That is deliberate — a constraint glyph is UI, and a box that filled
 * the command line with a dozen `r`-names nobody asked for would be noise. The
 * flow for relations stays hover-and-click, which is aimed and one at a time.
 *
 * **`occ`, when given, is what a solid hides this frame** (occlusion.ts), the
 * same answer the draw pass and the pick use, and a box selects only what is
 * drawn: a point behind a visible face is not in any box, and an edge is
 * caught by its visible part alone — a crossing box must touch some of that,
 * and a window must contain the whole edge *and* see some of it, so an edge
 * wholly hidden is never selected however large the box. Null (no solid, or
 * the hidden and wire modes) selects as it always did.
 */
export function selectInBox(model: Model, view: View, rect: ScreenRect, mode: BoxMode, occ: Occlusion | null = null): string[] {
  const screenOf = (name: string): Pt => projectPoint(model, view, name);
  const test = mode === "window" ? contains : touches;
  const out: string[] = [];
  for (const e of model.entities.values()) {
    // Hidden is not drawn, so no box holds it — however large.
    if (model.hidden.has(e.name)) continue;
    if (!test(model, view, e, rect, screenOf)) continue;
    if (occ && !seenInBox(model, view, e, rect, mode, occ)) continue;
    out.push(e.name);
  }
  return out;
}

/**
 * The visible part of an entity the box test already passed: in a window, any
 * of it seen at all; in a crossing, some seen part touching the box. A point
 * is seen or not; a frame's marker is drawn by its origin (main.ts), and its
 * arms are edges.
 */
function seenInBox(model: Model, view: View, e: Entity, rect: ScreenRect, mode: BoxMode, occ: Occlusion): boolean {
  if (e.kind === "point") return inSight(occ, model.coords(e.name));
  if (e.kind === "frame" && !inSight(occ, frameBasis(model, e.name)().origin)) return false;
  const runs = worldPaths(model, view, e).flatMap((p) => visibleRuns(occ, view, p.world, p.closed));
  if (mode === "window") return runs.length > 0;
  return runs.some((run) => (run.length === 1 ? rectContainsPoint(rect, run[0]) : rectTouchesPolyline(rect, run)));
}

/**
 * An entity as the polylines in the world it is drawn as — a line's two ends,
 * a curve's drawn samples, a frame's arms out to their pixel length — the same
 * ones main.ts strokes, so the parts a box sees are the parts on screen.
 */
function worldPaths(model: Model, view: View, e: Entity): { world: number[][]; closed: boolean }[] {
  if (e.kind === "line") return [{ world: [model.coords(e.refs[0]), model.coords(e.refs[1])], closed: false }];
  if (e.kind === "circle" || e.kind === "arc" || e.kind === "ellipse" || e.kind === "earc") {
    const f = curveFrame(model, e);
    return f ? [{ world: arcSamples(f, arcSegments(f.sweep, frameReach(f) * view.scale)), closed: isClosedEntity(e) }] : [];
  }
  if (e.kind === "frame") {
    const b = frameBasis(model, e.name)();
    const reach = frameArmPx(view) / view.scale;
    return [b.ux, b.uy, b.uz].filter((u): u is number[] => !!u && u.some((c) => c !== 0))
      .map((u) => ({ world: [b.origin, b.origin.map((c, i) => c + (u[i] ?? 0) * reach)], closed: false }));
  }
  // A declared kind with no frame (a spline, docs/plans/spline.md): the samples
  // it is drawn as. Before it, a shaded view's box never held such a kind.
  const pts = sampledWorld(model, e, view.scale);
  return pts ? [{ world: pts, closed: false }] : [];
}

/** Is the whole of `e` inside `rect`? */
function contains(model: Model, view: View, e: Entity, rect: ScreenRect, screenOf: (n: string) => Pt): boolean {
  if (e.kind === "point") return rectContainsPoint(rect, screenOf(e.name));
  if (e.kind === "line") return rectContainsSegment(rect, screenOf(e.refs[0]), screenOf(e.refs[1]));
  // A frame *is* its axes marker as far as a box is concerned — the same extent
  // the cursor picks and the eye sees. Not its two points: those are ordinary
  // points, selected on their own account, and the x-ref can be dragged far
  // outside a box that plainly contains the whole marker.
  if (e.kind === "frame") {
    const arms = frameSegments(model, view, e.name);
    // A collapsed frame draws nothing, so it is inside nothing — `every` on an
    // empty list would otherwise call it contained by every box on the canvas.
    return arms.length > 0 && arms.every(([a, b]) => rectContainsSegment(rect, a, b));
  }
  const shape = curveOf(model, view, e);
  if (shape.kind === "circle") return rectContainsCircle(rect, shape.c, shape.r);
  if (shape.kind === "arc") return rectContainsArc(rect, shape);
  return shape.kind === "polyline" && rectContainsPolyline(rect, shape.pts);
}

/** Does `e` come into `rect` at all? */
function touches(model: Model, view: View, e: Entity, rect: ScreenRect, screenOf: (n: string) => Pt): boolean {
  if (e.kind === "point") return rectContainsPoint(rect, screenOf(e.name));
  if (e.kind === "line") return rectTouchesSegment(rect, screenOf(e.refs[0]), screenOf(e.refs[1]));
  if (e.kind === "frame") {
    return frameSegments(model, view, e.name).some(([a, b]) => rectTouchesSegment(rect, a, b));
  }
  const shape = curveOf(model, view, e);
  if (shape.kind === "circle") return rectTouchesCircle(rect, shape.c, shape.r);
  if (shape.kind === "arc") return rectTouchesArc(rect, shape);
  return shape.kind === "polyline" && rectTouchesPolyline(rect, shape.pts);
}

/** A frame's marker arms in screen space — empty when it has collapsed. */
function frameSegments(model: Model, view: View, name: string): [Pt, Pt][] {
  const marker = frameMarker(model, view, name);
  return marker ? frameArms(marker) : [];
}

/**
 * A circle or arc as the screen-space curve `intersect.ts` understands: seen
 * square-on an exact circle or arc, seen obliquely the polyline its ellipse is
 * drawn with. See projection.ts.
 */
function curveOf(model: Model, view: View, e: Entity): Curve {
  return screenCurve(model, view, e, ARC_SLACK_PX)!.curve;
}

// --- the predicates, over plain screen geometry -----------------------------
//
// Exported because they are the part worth testing directly: each is one
// sentence of the feature's definition, and a test that drives them through a
// Model would be checking the projection at the same time.

/** Inclusive on the boundary — a point on the edge of the box is in the box. */
export function rectContainsPoint(rect: ScreenRect, [x, y]: Pt): boolean {
  return x >= rect.x0 && x <= rect.x1 && y >= rect.y0 && y <= rect.y1;
}

export function rectContainsSegment(rect: ScreenRect, a: Pt, b: Pt): boolean {
  return rectContainsPoint(rect, a) && rectContainsPoint(rect, b);
}

/**
 * An endpoint inside, or the segment crossing an edge of the box. Those two
 * cover everything: a segment with both ends outside that still meets the box
 * has to enter and leave through its boundary.
 */
export function rectTouchesSegment(rect: ScreenRect, a: Pt, b: Pt): boolean {
  if (rectContainsPoint(rect, a) || rectContainsPoint(rect, b)) return true;
  return crossesBoundary(rect, { kind: "segment", a, b });
}

export function rectContainsCircle(rect: ScreenRect, [cx, cy]: Pt, r: number): boolean {
  return cx - r >= rect.x0 && cx + r <= rect.x1 && cy - r >= rect.y0 && cy + r <= rect.y1;
}

/**
 * The rim, not the disc. A box wholly inside the circle touches nothing —
 * there is no geometry where it is — which is the same statement as clicking
 * the middle of a circle picking nothing.
 *
 * Containment first, then a boundary crossing: those are exhaustive, because
 * the rim is a closed curve. If some of it is inside the box and some outside,
 * it must cross the boundary somewhere.
 */
export function rectTouchesCircle(rect: ScreenRect, c: Pt, r: number): boolean {
  return rectContainsCircle(rect, c, r) || crossesBoundary(rect, { kind: "circle", c, r });
}

/** Containment measured against the arc's true extent, not its whole circle. */
export function rectContainsArc(rect: ScreenRect, arc: Extract<Curve, { kind: "arc" }>): boolean {
  const b = arcBounds(arc);
  return b.x0 >= rect.x0 && b.x1 <= rect.x1 && b.y0 >= rect.y0 && b.y1 <= rect.y1;
}

export function rectTouchesArc(rect: ScreenRect, arc: Extract<Curve, { kind: "arc" }>): boolean {
  return rectContainsArc(rect, arc) || crossesBoundary(rect, arc);
}

/**
 * An arc seen obliquely, drawn as a fine polyline: contained when every vertex
 * is, since the polyline is what is drawn and it strays a quarter-pixel at
 * most from the true curve.
 */
export function rectContainsPolyline(rect: ScreenRect, pts: Pt[]): boolean {
  return pts.length > 0 && pts.every((p) => rectContainsPoint(rect, p));
}

/** A vertex inside, or a piece crossing the boundary — the segment rule, piece by piece. */
export function rectTouchesPolyline(rect: ScreenRect, pts: Pt[]): boolean {
  return pts.some((p) => rectContainsPoint(rect, p)) || crossesBoundary(rect, { kind: "polyline", pts });
}

/**
 * The arc's bounding box: its two endpoints, plus whichever of the four
 * cardinal points of the circle its sweep actually reaches.
 *
 * Using the whole circle's box instead would be the easy wrong answer — a
 * quarter arc tucked in a corner would refuse to be window-selected until the
 * box was three times its size, for no reason a user could see.
 */
export function arcBounds(arc: Extract<Curve, { kind: "arc" }>): ScreenRect {
  const [cx, cy] = arc.c;
  const at = (angle: number): Pt => [cx + arc.r * Math.cos(angle), cy + arc.r * Math.sin(angle)];
  const on: Pt[] = [at(arc.a0), at(arc.a1)];
  // No slack here, unlike everywhere else the sweep test is used: slack exists
  // to make an arc's last pixels *reachable* by a cursor, and a bounding box
  // wants the arc's actual extent. The endpoints are in the list already, so a
  // cardinal that coincides with one is not lost by asking exactly.
  for (const angle of [0, Math.PI / 2, Math.PI, -Math.PI / 2]) {
    if (withinSweep(arc.a0, arc.a1, angle, 0)) on.push(at(angle));
  }
  const xs = on.map((p) => p[0]);
  const ys = on.map((p) => p[1]);
  return { x0: Math.min(...xs), y0: Math.min(...ys), x1: Math.max(...xs), y1: Math.max(...ys) };
}

/** Does `curve` cross any of the box's four edges? */
function crossesBoundary(rect: ScreenRect, curve: Curve): boolean {
  for (const [a, b] of boundary(rect)) {
    if (intersect({ kind: "segment", a, b }, curve).length) return true;
  }
  return false;
}

/** The box's four edges, as segments. */
function boundary(rect: ScreenRect): [Pt, Pt][] {
  const tl: Pt = [rect.x0, rect.y0];
  const tr: Pt = [rect.x1, rect.y0];
  const br: Pt = [rect.x1, rect.y1];
  const bl: Pt = [rect.x0, rect.y1];
  return [[tl, tr], [tr, br], [br, bl], [bl, tl]];
}
