// Vector arithmetic over Duals, shared by every relation module. These are
// written for arrays of arbitrary length so that a relation built out of
// them is dimension-generic for free — `dot` and `wedge` don't know or care
// whether they were handed 2D or 3D points.

import { Dual } from "../kernel/dual.ts";

export function vecSub(a: Dual[], b: Dual[]): Dual[] {
  return a.map((ai, i) => ai.sub(b[i]));
}

export function dot(a: Dual[], b: Dual[]): Dual {
  return a.reduce((acc, ai, i) => acc.add(ai.mul(b[i])), Dual.constant(0));
}

export function normSquared(v: Dual[]): Dual {
  return dot(v, v);
}

export function norm(v: Dual[]): Dual {
  return normSquared(v).sqrt();
}

// The wedge (exterior) product's components: w_ij = u_i*v_j - u_j*v_i for
// every i<j. All zero exactly when u and v are parallel, in any dimension —
// in 2D that's the single familiar cross-product scalar, in 3D the three
// components of the cross product.
//
// Deliberately the *components* rather than their summed square: a residual
// that is already a square has a vanishing gradient at its own root, and
// least-squares would then be minimising a fourth power, which converges
// badly. The components are individually well-scaled and linear in each input.
export function wedge(u: Dual[], v: Dual[]): Dual[] {
  const out: Dual[] = [];
  for (let i = 0; i < u.length; i++) {
    for (let j = i + 1; j < u.length; j++) {
      out.push(u[i].mul(v[j]).sub(u[j].mul(v[i])));
    }
  }
  return out;
}

/**
 * `v` at unit length: what a row reads a line's **direction** through, so the
 * row is blind to how long the line is (docs/plans/review-solver.md).
 *
 * A row built from a raw `b − a` is a product with the line's length, and a
 * shorter line is then a smaller residual: the solve pays for the relation
 * partly in length. Measured: `par` between two free lines 60 long left them
 * 8.8 and 1.2 long, SOLVED. Divided by its own length the direction's
 * gradient along the line is exactly zero (∂û/∂u · u = 0), so the row can only
 * turn the line.
 *
 * **Below `floor` the divisor is `floor`, not the length**: a line that short
 * has no direction to give, and dividing by a length near zero puts a
 * near-infinite number in the Jacobian. `u / floor` meets `u / |u|` exactly at
 * `|u| = floor`, so the row is continuous there, and under it the row is the
 * un-normalised one it used to be, which a point drawn on another satisfies
 * as it always did. With no floor to fall to, the zero vector.
 *
 * `k` multiplies the result — the plain number a row of unit directions is
 * scaled by to be a length again (`rowLength`, refs.ts) — here rather than
 * after, so it costs no second pass over the gradients.
 *
 * The derivative is the chain rule written once rather than left to the
 * operators: ∂û = (I − ûûᵀ)/|v| · ∂v, each component's gradient built in one
 * pass. Exact, as `v.div(norm(v))` is, and a third of the work — which
 * matters, since every direction row of every solve comes through here.
 */
export function unit(v: Dual[], floor = 0, k = 1): Dual[] {
  let sq = 0;
  for (const c of v) sq += c.val * c.val;
  if (!(sq > floor * floor) || sq === 0) return floor > 0 ? v.map((c) => c.mul(k / floor)) : v.map(() => Dual.constant(0));
  const len = Math.sqrt(sq);
  const hat = v.map((c) => c.val / len);
  return hat.map((hi, i) => {
    const g = new Map<number, number>();
    for (let j = 0; j < v.length; j++) {
      const coeff = (((i === j ? 1 : 0) - hi * hat[j]) * k) / len;
      if (coeff === 0) continue;
      for (const [slot, d] of v[j].grad) g.set(slot, (g.get(slot) ?? 0) + coeff * d);
    }
    return new Dual(k * hi, g);
  });
}

/**
 * Below this sin² two unit directions lie along one line as nearly as a
 * double can say, and which way to turn one off the other is not something
 * their wedge can answer (`angleBetween`). The square of the 1e-12 under which
 * `Dual.sqrt` gives no derivative.
 */
const ALONG = 1e-24;

/**
 * **What a wedge of two unit directions is multiplied by to be the turn
 * between them** — `w` the wedge's components, `c` the dot
 * (docs/plans/review-solver.md).
 *
 * The wedge is sin θ, and a row of sin θ has **no gradient where it is
 * largest**: two lines exactly square cannot be told which way to turn to be
 * parallel. The un-normalised row hid that, because it could always be
 * lowered by shortening a line — which is how `par` across a rectangle's
 * corner folded a side to nothing. So the row is the **angle** instead: the
 * wedge scaled to the length θ′, the turn that would bring the two lines
 * together, in (−π/2, π/2] since a line has no front. Its gradient has the
 * same size at every angle, a step is the turn that is needed rather than its
 * sine's guess, and at a root it is the wedge itself.
 *
 * θ′/sin θ is asin(s)/s for unit directions, s = |w|; by its series where s
 * is too small to divide by. Negative where the two point opposite ways, so
 * the turn is toward the nearer of the two ways of being parallel.
 */
export function turnFactor(w: Dual[], c: Dual): Dual {
  let t = w[0].mul(w[0]);
  for (let k = 1; k < w.length; k++) t = t.add(w[k].mul(w[k]));
  const way = c.val < 0 ? -1 : 1;
  if (t.val < 1e-8) return t.mul(way / 6).add(way);
  const s = t.sqrt();
  return s.atan2(c.mul(way)).div(s).mul(way);
}

/**
 * How far two unit directions are from parallel, **as the turn that would
 * make them so**: the wedge's components, scaled so that their length is that
 * angle (`turnFactor`). One component in 2D, three in 3D, all zero exactly
 * when the two are parallel; never a square.
 */
export function turnToParallel(u: Dual[], v: Dual[]): Dual[] {
  const w = wedge(u, v);
  if (!w.length) return w;
  const f = turnFactor(w, dot(u, v));
  return w.map((x) => x.mul(f));
}

/**
 * **The angle between two unit directions**, in [0, π]: atan2 of the wedge's
 * length against the dot, so its gradient is the same size at every angle —
 * where a cosine's vanishes at 0 and π, and a line could not be told to turn
 * off one it lay along.
 *
 * Exactly along one line the wedge's length is a cone's tip and has no
 * derivative: every way of turning off is as good as another. One is chosen
 * — `v`'s part along a fixed direction square to `u` stands in for the
 * wedge's length — so the row has a gradient there too and the solve moves;
 * a step later the two are apart and the wedge answers for itself. Two
 * directions of no length at all (lines under the floor, at nothing) are at
 * no angle: 0, with no gradient, and the caller's row is scaled to nothing.
 */
export function angleBetween(u: Dual[], v: Dual[]): Dual {
  const w = wedge(u, v);
  const c = dot(u, v);
  let t = Dual.constant(0);
  if (w.length) {
    t = w[0].mul(w[0]);
    for (let k = 1; k < w.length; k++) t = t.add(w[k].mul(w[k]));
  }
  if (t.val > ALONG) return t.sqrt().atan2(c);
  if (c.val === 0) return Dual.constant(0);
  // A unit direction square to u: the axis u leans on least, less its part along u.
  const uv = u.map((x) => x.val);
  let m = 0;
  for (let i = 1; i < uv.length; i++) if (Math.abs(uv[i]) < Math.abs(uv[m])) m = i;
  const uu = uv.reduce((sum, x) => sum + x * x, 0) || 1;
  const p = uv.map((x, i) => (i === m ? 1 : 0) - (uv[m] * x) / uu);
  const pl = Math.hypot(...p) || 1;
  let s = v[0].mul(p[0] / pl);
  for (let i = 1; i < v.length; i++) s = s.add(v[i].mul(p[i] / pl));
  return c.val >= 0 ? s.atan2(c) : s.atan2(c.neg()).neg().add(Math.PI);
}

/**
 * How far two unit directions are from square, as the turn that would make
 * them so: π/2 less the angle between them (`angleBetween`), in [−π/2, π/2].
 * Zero exactly when they are perpendicular; never a square.
 */
export function turnToSquare(u: Dual[], v: Dual[]): Dual {
  return angleBetween(u, v).neg().add(Math.PI / 2);
}

/** Length of the wedge — i.e. |u||v|sin(angle), the area of the parallelogram. */
export function wedgeNorm(u: Dual[], v: Dual[]): Dual {
  return norm(wedge(u, v));
}
