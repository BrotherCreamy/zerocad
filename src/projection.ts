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
//   * a **circle** lies in a plane (its frame's orientation through its own
//     centre, in 3D; the drawing's own in 2D — see curveplane.ts) and projects
//     to an **ellipse**. Seen face-on that ellipse is a circle of radius
//     r·scale about the projected centre, and it stays the exact `circle`
//     curve it always was, so a 2D drawing and anything looked at square-on are
//     picked, snapped and boxed by the very arithmetic that pinned them before.
//     Seen obliquely it is a closed polyline fine enough (a quarter-pixel) that
//     the eye and the hand cannot tell, and a pixel on it lifts back to the
//     true rim by the angle round it. (Until 3D phase 2 a circle had no plane,
//     was a sphere to every relation, and was drawn as its silhouette — a rim
//     that never foreshortened. That is gone.)
//   * an **arc** is the same, cut short: laid out in the plane through its
//     centre and endpoints, counter-clockwise about its plane's +z (see
//     arcgeom.ts), an exact `arc` curve face-on and a polyline obliquely.
//
// Lifting is what replaced `screenToWorld` for every pixel that is *on*
// something. In 2D the inverse was exact and one formula; in 3D a pixel names a
// ray, and only the entity under it can say how deep along that ray it is.

import type { Entity, Model } from "./model.ts";
import { arcSlack, screenAngle, type Curve, type Pt } from "./intersect.ts";
import { arcPoint, arcSamples, arcSegments, frameReach, type ArcFrame } from "./arcgeom.ts";
import { curveFrame } from "./curveplane.ts";
import { viewAxes, worldToScreen, type View } from "./view.ts";
import { dot3, lift3 } from "./vec3.ts";

/**
 * How near to square-on a circle or arc has to be seen to be drawn and picked
 * as an exact circle or circular arc: the cosine between its normal and the
 * line of sight within a billionth of one. A view that has never been turned
 * looks along exactly +z, so every 2D circle and arc is face-on with room to
 * spare.
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
    const f = curveFrame(model, e)!;
    if (faceOn(view, f)) {
      // Square-on, the rim is a circle on screen and the exact curve is the
      // right one. A pixel on it lifts out along its screen direction, in the
      // camera's plane — which, face-on, *is* the rim's plane.
      return { curve: { kind: "circle", c, r: r * view.scale }, lift: faceOnLift(view, C, r, c, dim) };
    }
    return obliquely(view, f, r * view.scale, dim);
  }
  if (e.kind === "arc") {
    const C = model.coords(e.center);
    const r = model.radius(e.name);
    const c = worldToScreen(view, C);
    const rs = r * view.scale;
    const f = curveFrame(model, e);
    if (!f || faceOn(view, f)) {
      // Square-on: the arc is a circular arc on screen, and the old exact
      // curve is the right one. Seen from behind, its counter-clockwise sweep
      // runs clockwise on screen — which is the same arc read from the other
      // end, so the two screen angles swap.
      const facing = f ? dot3(f.normal, viewAxes(view).toward) : 1;
      const a0 = screenAngle(c[0], c[1], ...screenOf(model, view, e.start));
      const a1 = screenAngle(c[0], c[1], ...screenOf(model, view, e.end));
      return {
        curve: { kind: "arc", c, r: rs, a0: facing < 0 ? a1 : a0, a1: facing < 0 ? a0 : a1, slack: arcSlack(rs, slackPx) },
        lift: faceOnLift(view, C, r, c, dim),
      };
    }
    return obliquely(view, f, rs, dim);
  }
  if (e.kind === "ellipse") {
    // Never an exact screen curve: an ellipse is a polyline on screen however
    // it is seen — intersect.ts has no ellipse, and needs none, since a
    // quarter-pixel polyline is what is drawn — and a pixel on it lifts back
    // to the true ellipse by Newton on its parametric form (`ellipseLift`).
    const f = curveFrame(model, e);
    if (!f) return null;
    const shape = obliquely(view, f, frameReach(f) * view.scale, dim);
    return { curve: shape.curve, lift: ellipseLift(view, f, shape.curve as { kind: "polyline"; pts: Pt[] }, dim) };
  }
  return null;
}

/**
 * A pixel near an ellipse, as the point of the ellipse nearest it **on
 * screen**: the polyline's nearest piece gives a parameter to a quarter-pixel,
 * and a few Newton steps on the projected parametric form — orthographic
 * projection is affine, so the projected ellipse is `S(c) + cos t·A + sin t·B`
 * exactly — take it the rest of the way. Then read back off the ellipse at
 * that parameter, so a snap along an ellipse lands on it to rounding rather
 * than on a chord a quarter-pixel inside it.
 */
function ellipseLift(view: View, f: ArcFrame, curve: { kind: "polyline"; pts: Pt[] }, dim: number): (p: Pt) => number[] {
  const n = curve.pts.length - 1;
  const C = worldToScreen(view, f.center);
  const S = (w: number[]) => { const s = worldToScreen(view, w); return [s[0] - C[0], s[1] - C[1]]; };
  const A = S(arcPoint(f, 0)), B = S(arcPoint(f, Math.PI / 2));
  return (p) => {
    const near = nearestOnPolyline(curve.pts, p);
    let t = near ? (f.sweep * (near.index + near.t)) / n : 0;
    const [px, py] = [p[0] - C[0], p[1] - C[1]];
    for (let k = 0; k < 6; k++) {
      const [c, s] = [Math.cos(t), Math.sin(t)];
      const P = [c * A[0] + s * B[0] - px, c * A[1] + s * B[1] - py];
      const D = [-s * A[0] + c * B[0], -s * A[1] + c * B[1]];
      const DD = [-c * A[0] - s * B[0], -c * A[1] - s * B[1]];
      const g = P[0] * D[0] + P[1] * D[1];
      const h = D[0] * D[0] + D[1] * D[1] + P[0] * DD[0] + P[1] * DD[1];
      if (!(h > 1e-12)) break; // past the curve's evolute: the polyline's answer stands
      const step = g / h;
      t -= step;
      if (Math.abs(step) < 1e-12) break;
    }
    return arcPoint(f, t).slice(0, dim);
  };
}

/** Whether a circle or arc is seen square-on — see `FACE_ON`. */
function faceOn(view: View, f: ArcFrame): boolean {
  return 1 - Math.abs(dot3(f.normal, viewAxes(view).toward)) <= FACE_ON;
}

/**
 * A circle or arc seen at an angle: the fine polyline it is drawn as, closed
 * for a circle (its first and last samples are the same point), and a pixel on
 * it lifted back to the true curve by how far round it is.
 */
function obliquely(view: View, f: ArcFrame, pixelRadius: number, dim: number): ScreenCurve {
  const n = arcSegments(f.sweep, pixelRadius);
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
 * A pixel on a rim seen face-on, as the point of the rim it shows: out from the
 * centre along the screen direction of the pixel, in the camera's own plane —
 * which for a circle seen square-on is the circle's own plane. In a view that
 * has never been turned that plane is the drawing's own, and this is the rim
 * point exactly as `screenToWorld` gave it.
 */
function faceOnLift(view: View, C: number[], r: number, c: Pt, dim: number): (p: Pt) => number[] {
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
