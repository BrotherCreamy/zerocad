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

/** Length of the wedge — i.e. |u||v|sin(angle), the area of the parallelogram. */
export function wedgeNorm(u: Dual[], v: Dual[]): Dual {
  return norm(wedge(u, v));
}
