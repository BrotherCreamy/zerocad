// Evaluating the kernel's exact curves (kernel.ts's `NurbsCurve`): a point at
// a parameter, by de Boor's algorithm on homogeneous control points — what the
// STEP writer needs to say which way an edge runs along its curve and where a
// circle's centre is. Numbers only, like everything under src/solids/.

import type { NurbsCurve } from "./kernel.ts";

/** The full knot vector: each unique knot repeated by its multiplicity. */
export function fullKnots(c: Pick<NurbsCurve, "knots" | "mults">): number[] {
  const out: number[] = [];
  c.knots.forEach((k, i) => { for (let j = 0; j < c.mults[i]; j++) out.push(k); });
  return out;
}

/** The point at parameter `t` (clamped to the curve's domain). */
export function curvePoint(c: NurbsCurve, t: number): number[] {
  const p = c.degree;
  const U = fullKnots(c);
  const n = c.points.length - 1;
  const lo = U[p], hi = U[n + 1];
  const u = Math.min(hi, Math.max(lo, t));
  // The span: the last knot interval [U[k], U[k+1]) holding u (the last one closed).
  let k = p;
  while (k < n && u >= U[k + 1]) k++;
  // Homogeneous: (wx, wy, wz, w).
  const d: number[][] = [];
  for (let j = 0; j <= p; j++) {
    const [x, y, z, w] = c.points[k - p + j];
    d.push([x * w, y * w, z * w, w]);
  }
  for (let r = 1; r <= p; r++) {
    for (let j = p; j >= r; j--) {
      const i = k - p + j;
      const den = U[i + p - r + 1] - U[i];
      const a = den === 0 ? 0 : (u - U[i]) / den;
      d[j] = d[j].map((v, q) => (1 - a) * d[j - 1][q] + a * v);
    }
  }
  const [X, Y, Z, W] = d[p];
  return [X / W, Y / W, Z / W];
}

/** The curve's parameter domain. */
export function curveDomain(c: NurbsCurve): [number, number] {
  const U = fullKnots(c);
  return [U[c.degree], U[c.points.length]];
}
