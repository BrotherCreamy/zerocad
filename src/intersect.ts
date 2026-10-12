// Where two curves cross — closed form, no iteration, no CAS.
//
// This file is pure screen-space geometry over plain numbers. It has never
// heard of a Model, which is what lets `picking.ts` and `snapping.ts` both
// sit on top of it without either depending on the other.
//
// **Screen space, not world space**, and deliberately so. Everything that asks
// this file a question asks it in pixels: the snap prefilter measures pixel
// distance to the cursor, the tolerance for "is that a crossing I meant" is a
// pixel count, and the arc-sweep test picking already had was written against
// screen angles. The view is an orthographic projection, so a segment stays a
// segment under it, a circle — a sphere, in 3D, until circles carry a plane —
// projects to its silhouette circle, and an arc seen face-on stays a circular
// arc. Doing the algebra in world space instead would have meant a second
// definition of "on the arc" in the opposite angular convention, which is the
// one thing the sweep test must not have. (Which world point a screen crossing
// *is* is no longer one inverse away in 3D — see `projection.ts`, which lifts
// a crossing back onto each curve and keeps it only where the two agree.)
//
// The three closed forms are segment–segment, segment–circle and
// circle–circle; an arc is a circle that then filters its results by sweep,
// and an arc seen obliquely is a polyline of segments.
//
// **Degenerate cases return nothing.** Parallel lines, coincident lines,
// tangent circles, a circle inside another: all of them produce either no
// crossing or a doubled one, and a doubled root is a *tangency* — which is
// already its own relation. Manufacturing a phantom crossing out of one would
// put a snap where the drawing says two curves touch rather than cross.

export type Pt = [number, number];

export type Curve =
  | { kind: "segment"; a: Pt; b: Pt }
  | { kind: "circle"; c: Pt; r: number }
  /** `a0`/`a1` are screen angles of the arc's start and end; `slack` is in radians. */
  | { kind: "arc"; c: Pt; r: number; a0: number; a1: number; slack: number }
  /**
   * A curve that is none of the above on screen, as a fine chain of segments —
   * which in practice means an arc seen obliquely, whose projection is part of
   * an ellipse. See `projection.ts` for how fine (a quarter-pixel at worst) and
   * why an arc seen face-on stays an exact `arc` instead.
   */
  | { kind: "polyline"; pts: Pt[] };

/**
 * Two candidate crossings closer together than this (in screen pixels) are one
 * crossing, and one crossing is a tangency.
 *
 * A tangency the solver actually holds leaves the two roots a fraction of a
 * thousandth of a pixel apart rather than exactly zero — the residual is
 * ~1e-11 but the root *separation* goes as its square root, so an exact test
 * for a doubled root never fires on real numbers. Half a twentieth of a pixel
 * is far above that noise and far below anything a hand could aim between.
 */
export const TANGENT_EPS = 0.05;

/**
 * Relative sine threshold for calling two lines parallel. Scale-free: it is
 * compared against the product of the two lengths, so it means "the angle
 * between them is below ~1e-9 radians" at any zoom.
 */
const PARALLEL_EPS = 1e-9;

function wedge(ax: number, ay: number, bx: number, by: number): number {
  return ax * by - ay * bx;
}

/** Angle from a circle's centre to a point, in screen space (y-down). */
export function screenAngle(cx: number, cy: number, sx: number, sy: number): number {
  return Math.atan2(sy - cy, sx - cx);
}

/** How far counter-clockwise (in world terms) `to` is from `from`, in [0, 2pi). */
export function sweepFrom(from: number, to: number): number {
  let d = from - to; // screen angles run the other way from world angles
  while (d < 0) d += Math.PI * 2;
  while (d >= Math.PI * 2) d -= Math.PI * 2;
  return d;
}

/**
 * Is the screen angle `here` inside the arc running from `a0` to `a1`?
 *
 * The one definition of "on the arc" in the codebase. Picking asks it of the
 * cursor; intersection asks it of a candidate crossing. Two definitions would
 * eventually disagree about an arc's last few pixels, and the symptom — a snap
 * that exists but cannot be clicked, or the reverse — would be baffling.
 *
 * `slack` extends the far end of the sweep, so the very last pixels of an arc
 * are still reachable — picking's reason, and intersection's too: a crossing
 * that lands on an endpoint is on the arc.
 */
export function withinSweep(a0: number, a1: number, here: number, slack: number): boolean {
  return sweepFrom(a0, here) <= sweepFrom(a0, a1) + slack;
}

/**
 * A pixel tolerance as an angle on a rim of screen radius `r`. Tiny arcs would
 * otherwise get a slack wider than themselves, so it is capped.
 */
export function arcSlack(r: number, pixels: number): number {
  return r > 1 ? pixels / r : 0.1;
}

/**
 * Every point at which two curves cross, in screen space. Empty for the
 * degenerate cases — see the note at the top of this file.
 *
 * Order of the arguments does not matter; the result is unordered.
 */
export function intersect(p: Curve, q: Curve): Pt[] {
  // A polyline is its segments, each asked the ordinary question. A crossing
  // that lands exactly on a joint is found by both segments meeting there, and
  // is one crossing, not two.
  if (p.kind === "polyline") return distinct(piecesOf(p).flatMap((s) => intersect(s, q)));
  if (q.kind === "polyline") return distinct(piecesOf(q).flatMap((s) => intersect(p, s)));
  if (p.kind === "segment") {
    if (q.kind === "segment") return segmentSegment(p.a, p.b, q.a, q.b);
    return onArcs(segmentCircle(p.a, p.b, q.c, q.r), q);
  }
  if (q.kind === "segment") return onArcs(segmentCircle(q.a, q.b, p.c, p.r), p);
  return onArcs(onArcs(circleCircle(p.c, p.r, q.c, q.r), p), q);
}

/** A polyline's pieces as segments, skipping any of zero length. */
export function piecesOf(curve: Extract<Curve, { kind: "polyline" }>): Extract<Curve, { kind: "segment" }>[] {
  const out: Extract<Curve, { kind: "segment" }>[] = [];
  for (let i = 1; i < curve.pts.length; i++) {
    const a = curve.pts[i - 1], b = curve.pts[i];
    if (a[0] !== b[0] || a[1] !== b[1]) out.push({ kind: "segment", a, b });
  }
  return out;
}

/** The points with near-duplicates (a millionth of a pixel) dropped. */
function distinct(points: Pt[]): Pt[] {
  const out: Pt[] = [];
  for (const p of points) {
    if (!out.some((q) => Math.abs(q[0] - p[0]) < 1e-6 && Math.abs(q[1] - p[1]) < 1e-6)) out.push(p);
  }
  return out;
}

/** Drops the candidates that fall outside `curve`'s sweep, if it is an arc. */
function onArcs(candidates: Pt[], curve: Curve): Pt[] {
  if (curve.kind !== "arc") return candidates;
  return candidates.filter(([x, y]) =>
    withinSweep(curve.a0, curve.a1, screenAngle(curve.c[0], curve.c[1], x, y), curve.slack));
}

/**
 * Where two *segments* cross — within both extents, so the infinite extension
 * of a short edge never produces a crossing halfway across the drawing.
 *
 * Parallel and coincident lines return nothing. Coincident lines technically
 * cross everywhere, which is not a place.
 */
export function segmentSegment(a: Pt, b: Pt, c: Pt, d: Pt): Pt[] {
  const [ux, uy] = [b[0] - a[0], b[1] - a[1]];
  const [vx, vy] = [d[0] - c[0], d[1] - c[1]];
  const denom = wedge(ux, uy, vx, vy);
  const scale = Math.hypot(ux, uy) * Math.hypot(vx, vy);
  if (scale === 0 || Math.abs(denom) <= PARALLEL_EPS * scale) return [];

  const [wx, wy] = [c[0] - a[0], c[1] - a[1]];
  const t = wedge(wx, wy, vx, vy) / denom;
  const u = wedge(wx, wy, ux, uy) / denom;
  if (t < 0 || t > 1 || u < 0 || u > 1) return [];
  return [[a[0] + t * ux, a[1] + t * uy]];
}

/**
 * Where a segment crosses a circle: zero, one or two points, dropping the ones
 * beyond the segment's ends. A tangent line touches rather than crosses and
 * returns nothing.
 */
export function segmentCircle(a: Pt, b: Pt, c: Pt, r: number): Pt[] {
  const [dx, dy] = [b[0] - a[0], b[1] - a[1]];
  const [fx, fy] = [a[0] - c[0], a[1] - c[1]];
  const A = dx * dx + dy * dy;
  if (A === 0 || !(r > 0)) return [];
  const B = 2 * (fx * dx + fy * dy);
  const C = fx * fx + fy * fy - r * r;
  const disc = B * B - 4 * A * C;
  if (disc <= 0) return [];

  const root = Math.sqrt(disc);
  // The roots are `root / A` apart in the parameter, which is `root / |d|`
  // apart in pixels. Below the tangent threshold they are the same point.
  if (root / Math.sqrt(A) < TANGENT_EPS) return [];

  const out: Pt[] = [];
  for (const t of [(-B - root) / (2 * A), (-B + root) / (2 * A)]) {
    if (t < 0 || t > 1) continue;
    out.push([a[0] + t * dx, a[1] + t * dy]);
  }
  return out;
}

/**
 * Where two circles cross. Nothing when they are separate, when one is inside
 * the other, when they are tangent (internally or externally), or when they
 * are the same circle.
 */
export function circleCircle(c1: Pt, r1: number, c2: Pt, r2: number): Pt[] {
  if (!(r1 > 0) || !(r2 > 0)) return [];
  const [dx, dy] = [c2[0] - c1[0], c2[1] - c1[1]];
  const d = Math.hypot(dx, dy);
  // Concentric: either the same circle (crossing everywhere, which is not a
  // place) or no crossing at all. Both are nothing.
  if (d < TANGENT_EPS) return [];
  if (d > r1 + r2 || d < Math.abs(r1 - r2)) return [];

  // Distance from c1 to the crossing chord's midpoint, along the centre line.
  const h = (d * d + r1 * r1 - r2 * r2) / (2 * d);
  const kSquared = r1 * r1 - h * h;
  if (kSquared <= 0) return [];
  const k = Math.sqrt(kSquared);
  // The two crossings sit 2k apart; below the threshold that is one tangency.
  if (2 * k < TANGENT_EPS) return [];

  const [ux, uy] = [dx / d, dy / d];
  const base: Pt = [c1[0] + h * ux, c1[1] + h * uy];
  return [
    [base[0] - k * uy, base[1] + k * ux],
    [base[0] + k * uy, base[1] - k * ux],
  ];
}
