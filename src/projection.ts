// The drawing as it lands on the screen, and the way back — the one answer
// picking, snapping and box select need about any entity.
//
// All three work in screen space, and they always did: a tolerance is a pixel
// count, and a hand agrees with nothing else. What the 3D camera changed is
// only what an entity *looks like* on screen and which world point a pixel on
// it stands for, and both of those are questions about the projection rather
// than about picking or snapping. So they are answered here, once:
//
//   * a **line** projects to a segment — orthographic projection is affine —
//     and a pixel a fraction t along it is the world point a fraction t along
//     the line, exactly;
//   * a **circle** projects to its silhouette, a circle of radius r·scale about
//     its projected centre. In 3D a circle has no plane yet (phase 2 gives it
//     one), so it *is* a sphere to every relation that reads it, and the
//     silhouette is exactly what a sphere looks like orthographically. A pixel
//     on the rim stands for the point of the sphere on the camera-parallel
//     great circle — the one point of the sphere that is under that pixel;
//   * an **arc** has a plane — the one through its centre and endpoints (see
//     arcgeom.ts) — and projects to part of an ellipse. **Seen face-on it is
//     still a circular arc**, and it stays the exact `arc` curve it always was,
//     so a 2D drawing and anything looked at square-on are picked, snapped and
//     boxed by the very arithmetic that pinned them before. Seen obliquely it
//     is a polyline fine enough (a quarter-pixel) that the eye and the hand
//     cannot tell, and a pixel on it lifts back to the true arc by the angle
//     along it.
//
// Lifting is what replaced `screenToWorld` for every pixel that is *on*
// something. In 2D the inverse was exact and one formula; in 3D a pixel names a
// ray, and only the entity under it can say how deep along that ray it is.

import type { Entity, Model } from "./model.ts";
import { arcSlack, screenAngle, type Curve, type Pt } from "./intersect.ts";
import { arcFrame, arcPoint, arcSamples, arcSegments } from "./arcgeom.ts";
import { viewAxes, worldToScreen, type View } from "./view.ts";
import { dot3, lift3 } from "./vec3.ts";

/**
 * How near to square-on an arc has to be seen to be drawn and picked as an
 * exact circular arc: the cosine between its normal and the line of sight
 * within a billionth of one. A view that has never been turned looks along
 * exactly +z, so every 2D arc is face-on with room to spare.
 */
const FACE_ON = 1e-9;

/** Where a named point lands on screen. */
export function screenOf(model: Model, view: View, name: string): Pt {
  return worldToScreen(view, model.coords(name));
}

/** An entity's on-screen shape, and how a pixel on it maps back to the world. */
export interface ScreenCurve {
  curve: Curve;
  /**
   * The world point on the entity that the pixel `p` — on the curve or near it
   * — stands for: the nearest point of the curve to `p`, read back off the
   * entity. As many coordinates as the model has.
   */
  lift(p: Pt): number[];
}

/**
 * `name`'s shape on screen, or null for an entity that is not a curve (a point,
 * a frame). `slackPx` is how far past an arc's ends a pixel may fall and still
 * be on it, for the callers whose tolerance is a hand's.
 */
export function screenCurve(model: Model, view: View, e: Entity, slackPx: number): ScreenCurve | null {
  const dim = model.dim;
  if (e.kind === "line") {
    const A = model.coords(e.refs[0]), B = model.coords(e.refs[1]);
    const a = worldToScreen(view, A), b = worldToScreen(view, B);
    return {
      curve: { kind: "segment", a, b },
      lift: (p) => {
        const t = segmentParam(a, b, p);
        return A.map((ai, i) => ai + t * (B[i] - ai));
      },
    };
  }
  if (e.kind === "circle") {
    const C = model.coords(e.center);
    const r = model.radius(e.name);
    const c = worldToScreen(view, C);
    return { curve: { kind: "circle", c, r: r * view.scale }, lift: silhouetteLift(view, C, r, c, dim) };
  }
  if (e.kind === "arc") {
    const C = model.coords(e.center);
    const r = model.radius(e.name);
    const c = worldToScreen(view, C);
    const rs = r * view.scale;
    const f = arcFrame(C, model.coords(e.start), model.coords(e.end), r);
    const facing = f ? dot3(f.normal, viewAxes(view).toward) : 1;
    if (!f || 1 - Math.abs(facing) <= FACE_ON) {
      // Square-on: the arc is a circular arc on screen, and the old exact
      // curve is the right one. Seen from behind, its counter-clockwise sweep
      // runs clockwise on screen — which is the same arc read from the other
      // end, so the two screen angles swap.
      const a0 = screenAngle(c[0], c[1], ...screenOf(model, view, e.start));
      const a1 = screenAngle(c[0], c[1], ...screenOf(model, view, e.end));
      return {
        curve: { kind: "arc", c, r: rs, a0: facing < 0 ? a1 : a0, a1: facing < 0 ? a0 : a1, slack: arcSlack(rs, slackPx) },
        lift: silhouetteLift(view, C, r, c, dim),
      };
    }
    const n = arcSegments(f.sweep, rs);
    const pts = arcSamples(f, n).map((w) => worldToScreen(view, w));
    return {
      curve: { kind: "polyline", pts },
      lift: (p) => {
        const near = nearestOnPolyline(pts, p);
        const k = near ? near.index + near.t : 0;
        return arcPoint(f, (f.sweep * k) / n).slice(0, dim);
      },
    };
  }
  return null;
}

/**
 * The parameter in [0, 1] of the point on segment a–b nearest p — the fraction
 * along it, which orthographic projection keeps, so the same fraction along
 * the world line is the world point. Zero for a segment seen end-on.
 */
function segmentParam(a: Pt, b: Pt, p: Pt): number {
  const dx = b[0] - a[0], dy = b[1] - a[1];
  const len2 = dx * dx + dy * dy;
  if (!(len2 > 1e-24)) return 0;
  return Math.max(0, Math.min(1, ((p[0] - a[0]) * dx + (p[1] - a[1]) * dy) / len2));
}

/**
 * A pixel on a sphere's silhouette, as the point of the sphere it shows: out
 * from the centre along the screen direction of the pixel, in the camera's own
 * plane. In a view that has never been turned that plane is the drawing's own,
 * and this is the rim point of the circle, exactly as `screenToWorld` gave it.
 */
function silhouetteLift(view: View, C: number[], r: number, c: Pt, dim: number): (p: Pt) => number[] {
  const { right, up } = viewAxes(view);
  const C3 = lift3(C);
  return (p) => {
    const dx = p[0] - c[0], dy = p[1] - c[1];
    const len = Math.hypot(dx, dy);
    const [ux, uy] = len > 1e-12 ? [dx / len, dy / len] : [1, 0];
    // Screen y runs down, world "up" runs up — hence the minus.
    return [0, 1, 2].map((i) => C3[i] + r * (ux * right[i] - uy * up[i])).slice(0, dim);
  };
}

/**
 * The nearest point of a polyline to `p`: where it is, how far, and which piece
 * it is on and how far along that piece — which is what lets a pixel on a drawn
 * arc be lifted back to the arc by angle.
 */
export function nearestOnPolyline(pts: Pt[], p: Pt): { on: Pt; d: number; index: number; t: number } | null {
  let best: { on: Pt; d: number; index: number; t: number } | null = null;
  for (let i = 1; i < pts.length; i++) {
    const a = pts[i - 1], b = pts[i];
    const t = segmentParam(a, b, p);
    const on: Pt = [a[0] + t * (b[0] - a[0]), a[1] + t * (b[1] - a[1])];
    const d = Math.hypot(p[0] - on[0], p[1] - on[1]);
    if (!best || d < best.d) best = { on, d, index: i - 1, t };
  }
  return best;
}
