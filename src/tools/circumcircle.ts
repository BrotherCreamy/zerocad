// The circle through three points, and the threshold below which there isn't
// one. Plain numbers in and out; no Tool, no Model, and no `defineTool`, so
// importing this registers nothing — `place.ts` is the precedent for a helper
// module living under `tools/`.
//
// It started inside circle3.ts, where it was preview-only and belonged. Two
// tools need it now (3-point circle, 3-point arc) and what they need is not
// just the formula but the *same* answer to "are these three points on one
// line" — two copies of a scale-free epsilon is exactly the sort of thing that
// drifts until one tool refuses a gesture the other accepts.

/**
 * Relative sine below which three points are one straight line.
 *
 * Scale-free, and deliberately the same form and the same number as
 * intersect.ts's parallel test: it is compared against the product of the two
 * side lengths, so it means "the angle subtended at the first point is under
 * ~1e-9 radians" at any zoom, in any unit. A *near*-collinear circle is a
 * legitimate thing to draw and the user's call to make; only the exactly
 * degenerate case is refused.
 */
export const COLLINEAR_EPS = 1e-9;

/**
 * Screen radius past which a preview is not drawn. A rim this far away sags
 * by well under a pixel across the whole window, so what would be drawn is a
 * straight line — and asking a canvas for an arc of radius 10^8 is a good way
 * to find out how slowly it can do that.
 */
export const PREVIEW_MAX_R = 1e6;

export interface Circumcircle {
  center: [number, number];
  radius: number;
}

/**
 * The circle through three points, in closed form — or null when they are
 * collinear, because the "circle" through three points on a line is that
 * line, and a line is not a circle.
 *
 * Plain numbers in and out, with no idea which space it is being asked about,
 * exactly as intersect.ts is: a commit asks it in world coordinates because
 * that is where the model lives, and a preview asks it in screen pixels
 * because that is where it draws and a pixel radius needs no scale factor.
 * The view transform is affine with a uniform scale, so the two agree.
 *
 * Written about `a` as the origin rather than from the raw determinant: the
 * coordinates that go into it are then differences rather than absolute
 * positions, which is what stops a drawing far from the origin losing its
 * significant digits to cancellation.
 */
export function circumcircle(a: number[], b: number[], c: number[]): Circumcircle | null {
  const bx = b[0] - a[0], by = b[1] - a[1];
  const cx = c[0] - a[0], cy = c[1] - a[1];
  // |d| = 2 |b-a| |c-a| sin(theta), so dividing through by the two lengths is
  // what makes the test below an angle rather than an area — an area threshold
  // would call a large drawing collinear and a small one not.
  const d = 2 * (bx * cy - by * cx);
  if (Math.abs(d) <= 2 * COLLINEAR_EPS * Math.hypot(bx, by) * Math.hypot(cx, cy)) return null;

  const bb = bx * bx + by * by;
  const cc = cx * cx + cy * cy;
  const ux = (cy * bb - by * cc) / d;
  const uy = (bx * cc - cx * bb) / d;
  return { center: [a[0] + ux, a[1] + uy], radius: Math.hypot(ux, uy) };
}
