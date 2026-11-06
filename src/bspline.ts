// The spline's mathematics (docs/plans/spline.md): a cubic B-spline that
// **interpolates** its through-points — Onshape's spline, not a control
// polygon — over plain numbers, in any dimension, with no Model and no View,
// as arcgeom.ts is for a circle.
//
// **One layout, two arithmetics.** What the spline *is* — which knots, which
// control points are its through-points and which are solved, and the
// equations that tie the solved ones down — is `layout`'s, once. The
// equations' coefficients come out of one generic basis routine (`dersBasis`,
// Piegl & Tiller's A2.3) written over a `Ring`, so the relations evaluate it
// over Duals (relations/spline.ts: exact gradients, the knots moving with the
// points) and everything that draws, picks, loops and exports evaluates it over
// numbers — the same arithmetic, so the two cannot disagree about the curve.
//
// **The curve.** Degree 3, clamped: it starts at its first through-point and
// ends at its last (a closed one at its first again). Its knots are the
// through-points' **centripetal** parameters — consecutive knots `|Pₖ₊₁ − Pₖ|^½`
// apart — the choice that keeps a curve through unevenly spaced clicks from
// overshooting into loops (Lee 1989; Piegl & Tiller §9.2.1 give chord length
// as the plain alternative). Knots depend on where the points are, so the
// interpolation equations are not linear in the points; they are linear in the
// control points, and none is a square.
//
//   * **Open**, n ≥ 2 through-points: knots `t₀ … tₙ₋₁` with t₀ and tₙ₋₁ four
//     times over, n + 2 control points of which the first is P₀ and the last
//     Pₙ₋₁ — the n between are the unknowns — held by n equations: the curve
//     through each interior Pₖ at tₖ, and **natural** ends, no curvature at
//     either (C″ = 0). Two through-points make a straight segment.
//   * **Closed**, n ≥ 3: the knots run on past Pₙ₋₁ back to P₀ (`tₙ`), n + 3
//     control points, the first and last both P₀, and n + 1 unknowns held by
//     the curve through P₁ … Pₙ₋₁ and the seam made smooth: C′ and C″ the
//     same where it ends as where it starts. So a closed spline is C² all the
//     way round, its seam included, though it is written as a clamped curve
//     — what a STEP file and the solid kernel take without a periodic form.
//
// Nothing here is privileged to the sketch: a curve is knots and points.

/** The four operations the basis routine needs, and how a plain number is lifted. */
export interface Ring<T> {
  add(a: T, b: T): T;
  sub(a: T, b: T): T;
  mul(a: T, b: T): T;
  div(a: T, b: T): T;
  of(x: number): T;
}

/** Plain numbers. */
export const NUM: Ring<number> = {
  add: (a, b) => a + b,
  sub: (a, b) => a - b,
  mul: (a, b) => a * b,
  div: (a, b) => a / b,
  of: (x) => x,
};

/** The degree every spline here has: cubic, the least that is curvature-continuous. */
export const DEGREE = 3;

/**
 * Below this squared distance two through-points are one spot, and the knot gap
 * between them is held this far from zero — so a solve that drives two points
 * together reads a steep curve rather than a division by zero. A tool refuses
 * two consecutive through-points in one place before it gets here.
 */
const GAP_FLOOR = 1e-24;

/**
 * The centripetal knot gap between two through-points: `(|b − a|²)^¼`, floored
 * (`GAP_FLOOR`). The square root of a distance — not a square, and smooth
 * wherever the points are apart.
 */
export function gapOf(a: number[], b: number[]): number {
  let d2 = 0;
  for (let i = 0; i < a.length; i++) d2 += (b[i] - a[i]) ** 2;
  return Math.pow(d2 + GAP_FLOOR, 0.25);
}

/** The same over any ring, for a caller that already has the squared distance as one of its own. */
export function gapFromSquare<T>(R: Ring<T>, d2: T, root: (x: T) => T): T {
  return root(root(R.add(d2, R.of(GAP_FLOOR))));
}

/** A control point of the layout: a through-point's own, or the k-th solved one. */
export type Control = { point: number } | { unknown: number };

/**
 * One equation of the layout (each is `dim` scalar residuals):
 *
 * - `through`: the curve passes through `point` at the knot that starts `span`;
 * - `natural`: no curvature where `span` starts (`at: "start"`) or ends (`"end"`);
 * - `seam`: the `order`-th derivative where the curve starts equals the one where it ends.
 */
export type Row =
  | { kind: "through"; point: number; span: number }
  | { kind: "natural"; span: number; at: "start" | "end" }
  | { kind: "seam"; order: 1 | 2 };

/** What a spline of `n` through-points, open or closed, is made of. See the top of the file. */
export interface Layout {
  n: number;
  closed: boolean;
  /**
   * The gaps between consecutive knots, `K[j + 1] − K[j]`: `[a, b]` the
   * through-points whose centripetal gap it is, null where the knot repeats
   * (the clamped ends).
   */
  gaps: ([number, number] | null)[];
  /** The control points in order. */
  ctrl: Control[];
  /** How many control points are solved. */
  unknowns: number;
  rows: Row[];
}

/** The smallest number of through-points a spline takes: two open, three closed. */
export function fewestPoints(closed: boolean): number {
  return closed ? 3 : 2;
}

/** The layout of a spline through `n` points. Throws for too few. */
export function layout(n: number, closed: boolean): Layout {
  if (!Number.isInteger(n) || n < fewestPoints(closed)) {
    throw new Error(`a${closed ? " closed" : "n open"} spline goes through at least ${fewestPoints(closed)} points, not ${n}`);
  }
  const spans = closed ? n : n - 1;
  const gaps: ([number, number] | null)[] = [null, null, null];
  for (let k = 0; k < spans; k++) gaps.push([k, (k + 1) % n]);
  gaps.push(null, null, null);
  const m = spans + 3; // control points
  const ctrl: Control[] = [{ point: 0 }];
  for (let k = 1; k < m - 1; k++) ctrl.push({ unknown: k - 1 });
  ctrl.push({ point: closed ? 0 : n - 1 });
  const rows: Row[] = [];
  // The knot t_k is K[3 + k], and the span it starts is span 3 + k.
  const last = closed ? n - 1 : n - 2;
  for (let k = 1; k <= last; k++) rows.push({ kind: "through", point: k, span: 3 + k });
  if (closed) rows.push({ kind: "seam", order: 1 }, { kind: "seam", order: 2 });
  else rows.push({ kind: "natural", span: 3, at: "start" }, { kind: "natural", span: m - 1, at: "end" });
  return { n, closed, gaps, ctrl, unknowns: m - 2, rows };
}

/**
 * The basis functions' values and derivatives up to `order` at `u`, in the
 * span `i` of the knot vector `U` — Piegl & Tiller's algorithm A2.3, over any
 * ring. `ders[k][j]` is the k-th derivative of N_{i−p+j}. Every division is by
 * a knot difference across the span, never zero for a span of length.
 */
export function dersBasis<T>(R: Ring<T>, U: readonly T[], i: number, u: T, p: number, order: number): T[][] {
  const zero = R.of(0);
  const ndu: T[][] = Array.from({ length: p + 1 }, () => new Array<T>(p + 1).fill(zero));
  ndu[0][0] = R.of(1);
  const left: T[] = new Array<T>(p + 1).fill(zero);
  const right: T[] = new Array<T>(p + 1).fill(zero);
  for (let j = 1; j <= p; j++) {
    left[j] = R.sub(u, U[i + 1 - j]);
    right[j] = R.sub(U[i + j], u);
    let saved = zero;
    for (let r = 0; r < j; r++) {
      ndu[j][r] = R.add(right[r + 1], left[j - r]);
      const temp = R.div(ndu[r][j - 1], ndu[j][r]);
      ndu[r][j] = R.add(saved, R.mul(right[r + 1], temp));
      saved = R.mul(left[j - r], temp);
    }
    ndu[j][j] = saved;
  }
  const ders: T[][] = Array.from({ length: order + 1 }, () => new Array<T>(p + 1).fill(zero));
  for (let j = 0; j <= p; j++) ders[0][j] = ndu[j][p];
  for (let r = 0; r <= p; r++) {
    let s1 = 0, s2 = 1;
    const a: T[][] = [new Array<T>(p + 1).fill(zero), new Array<T>(p + 1).fill(zero)];
    a[0][0] = R.of(1);
    for (let k = 1; k <= order; k++) {
      let d = zero;
      const rk = r - k, pk = p - k;
      if (r >= k) {
        a[s2][0] = R.div(a[s1][0], ndu[pk + 1][rk]);
        d = R.mul(a[s2][0], ndu[rk][pk]);
      }
      const j1 = rk >= -1 ? 1 : -rk;
      const j2 = r - 1 <= pk ? k - 1 : p - r;
      for (let j = j1; j <= j2; j++) {
        a[s2][j] = R.div(R.sub(a[s1][j], a[s1][j - 1]), ndu[pk + 1][rk + j]);
        d = R.add(d, R.mul(a[s2][j], ndu[rk + j][pk]));
      }
      if (r <= pk) {
        a[s2][k] = R.div(R.sub(zero, a[s1][k - 1]), ndu[pk + 1][r]);
        d = R.add(d, R.mul(a[s2][k], ndu[r][pk]));
      }
      ders[k][r] = d;
      [s1, s2] = [s2, s1];
    }
  }
  let f = p;
  for (let k = 1; k <= order; k++) {
    for (let j = 0; j <= p; j++) ders[k][j] = R.mul(ders[k][j], R.of(f));
    f *= p - k;
  }
  return ders;
}

/**
 * The six knots a span's basis reads, `K[s − 2] … K[s + 3]`, measured from
 * `K[s − 2]` — built from the gaps alone, since a B-spline does not change when
 * its knots all shift: what keeps each equation reading only the
 * through-points near it.
 */
export function knotWindow<T>(R: Ring<T>, gap: (j: number) => T, s: number): T[] {
  const out: T[] = [R.of(0)];
  for (let j = s - 2; j < s + 3; j++) out.push(R.add(out[out.length - 1], gap(j)));
  return out;
}

/**
 * An equation's terms: for each place it is evaluated (one, or a seam's two),
 * the controls it reads (`ctrl` indices, the span's four) and their
 * coefficients — the basis's derivative of the row's order, scaled so every
 * row is a length. `through` rows are `Σ c·Q − P`, the rest `Σ c·Q`.
 */
export function rowTerms<T>(R: Ring<T>, L: Layout, gap: (j: number) => T, row: Row): { ctrl: number; coeff: T }[] {
  const at = (s: number, end: boolean, order: number, scale: T): { ctrl: number; coeff: T }[] => {
    const U = knotWindow(R, gap, s);
    const d = dersBasis(R, U, 2, U[end ? 3 : 2], DEGREE, order);
    return d[order].map((c, j) => ({ ctrl: s - DEGREE + j, coeff: R.mul(c, scale) }));
  };
  const m = L.ctrl.length;
  if (row.kind === "through") return at(row.span, false, 0, R.of(1));
  // Each row reads only the gaps near it (an end's own span): the relations
  // build a block from just those points.
  if (row.kind === "natural") {
    const h = gap(row.at === "start" ? 3 : m - 1);
    return at(row.span, row.at === "end", 2, R.mul(h, h));
  }
  // The seam: where it starts, less where it ends, each scaled alike.
  const first = gap(3), last = gap(m - 1);
  const scale = row.order === 1 ? R.div(R.add(first, last), R.of(2)) : R.mul(first, last);
  const start = at(3, false, row.order, scale);
  const end = at(m - 1, true, row.order, scale).map((t) => ({ ctrl: t.ctrl, coeff: R.sub(R.of(0), t.coeff) }));
  return [...start, ...end];
}

/** A clamped B-spline over numbers, in any dimension: degree, the full knot vector, the control points. */
export interface BSpline {
  degree: number;
  knots: number[];
  ctrl: number[][];
}

/** The gaps of a layout as numbers, from where the through-points are. */
export function numericGaps(L: Layout, points: readonly number[][]): number[] {
  return L.gaps.map((g) => (g ? gapOf(points[g[0]], points[g[1]]) : 0));
}

/** The full knot vector from the gaps, starting at 0. */
export function knotsOf(gaps: readonly number[]): number[] {
  const K = [0];
  for (const g of gaps) K.push(K[K.length - 1] + g);
  return K;
}

/**
 * The solved control points for through-points at `points`: the layout's
 * equations, linear in the unknowns once the knots are read, solved by
 * elimination. What a new spline's control variables are seeded with, so it is
 * the curve from its first frame; the solver then holds it there.
 */
export function interpolate(points: readonly number[][], closed: boolean): BSpline {
  const L = layout(points.length, closed);
  const dim = points[0].length;
  const g = numericGaps(L, points);
  const gap = (j: number) => g[j] ?? 0;
  const N = L.unknowns;
  const A: number[][] = [];
  const B: number[][] = [];
  for (const row of L.rows) {
    const a = new Array<number>(N).fill(0);
    const b = row.kind === "through" ? points[row.point].slice() : new Array<number>(dim).fill(0);
    for (const t of rowTerms(NUM, L, gap, row)) {
      const c = L.ctrl[t.ctrl];
      if ("unknown" in c) a[c.unknown] += t.coeff;
      else for (let i = 0; i < dim; i++) b[i] -= t.coeff * points[c.point][i];
    }
    A.push(a);
    B.push(b);
  }
  const X = solveDense(A, B);
  const ctrl = L.ctrl.map((c) => ("unknown" in c ? X[c.unknown] : points[c.point].slice()));
  return { degree: DEGREE, knots: knotsOf(g), ctrl };
}

/** A·X = B by Gaussian elimination with partial pivoting; B has a column per dimension. */
function solveDense(A: number[][], B: number[][]): number[][] {
  const n = A.length;
  const M = A.map((r) => r.slice());
  const R = B.map((r) => r.slice());
  for (let c = 0; c < n; c++) {
    let piv = c;
    for (let r = c + 1; r < n; r++) if (Math.abs(M[r][c]) > Math.abs(M[piv][c])) piv = r;
    if (!(Math.abs(M[piv][c]) > 1e-300)) throw new Error("a spline's through-points leave its control points undetermined");
    [M[c], M[piv]] = [M[piv], M[c]];
    [R[c], R[piv]] = [R[piv], R[c]];
    for (let r = c + 1; r < n; r++) {
      const f = M[r][c] / M[c][c];
      if (f === 0) continue;
      for (let k = c; k < n; k++) M[r][k] -= f * M[c][k];
      for (let k = 0; k < R[r].length; k++) R[r][k] -= f * R[c][k];
    }
  }
  const X = R.map((r) => r.map(() => 0));
  for (let c = n - 1; c >= 0; c--) {
    for (let k = 0; k < R[c].length; k++) {
      let s = R[c][k];
      for (let j = c + 1; j < n; j++) s -= M[c][j] * X[j][k];
      X[c][k] = s / M[c][c];
    }
  }
  return X;
}

/** The parameter range a curve is defined over. */
export function domain(s: BSpline): [number, number] {
  return [s.knots[s.degree], s.knots[s.knots.length - 1 - s.degree]];
}

/** The span `u` is in: the last `s` with `K[s] ≤ u`, among those of the domain (its end in the last). */
export function findSpan(s: BSpline, u: number): number {
  const p = s.degree;
  const last = s.ctrl.length - 1;
  if (u >= s.knots[last + 1]) return last;
  if (u <= s.knots[p]) return p;
  let lo = p, hi = last + 1;
  while (hi - lo > 1) {
    const mid = (lo + hi) >> 1;
    if (u < s.knots[mid]) hi = mid;
    else lo = mid;
  }
  return lo;
}

/**
 * The curve's point and derivatives at `u`, `out[k]` the k-th. A `u` outside
 * the domain is read off the end span's own polynomial, carried on — what a
 * point held on an open spline past its end lies on.
 */
export function derivs(s: BSpline, u: number, order = 0): number[][] {
  const p = s.degree;
  const span = findSpan(s, u);
  const d = dersBasis(NUM, s.knots, span, u, p, Math.min(order, p));
  const dim = s.ctrl[0].length;
  const out: number[][] = [];
  for (let k = 0; k <= order; k++) {
    const v = new Array<number>(dim).fill(0);
    if (k <= p) for (let j = 0; j <= p; j++) for (let i = 0; i < dim; i++) v[i] += d[k][j] * s.ctrl[span - p + j][i];
    out.push(v);
  }
  return out;
}

/** The curve's point at `u`. */
export function pointAt(s: BSpline, u: number): number[] {
  return derivs(s, u, 0)[0];
}

/**
 * The curve with `u` inserted as a knot once more (Boehm's algorithm, Piegl &
 * Tiller A5.1 for one insertion): the same curve, one more control point.
 */
export function insertKnot(s: BSpline, u: number): BSpline {
  const p = s.degree;
  const k = findSpan(s, u);
  const dim = s.ctrl[0].length;
  let mult = 0;
  for (const x of s.knots) if (x === u) mult++;
  const ctrl: number[][] = [];
  for (let i = 0; i <= k - p; i++) ctrl.push(s.ctrl[i].slice());
  for (let i = k - p + 1; i <= k - mult; i++) {
    const a = (u - s.knots[i]) / (s.knots[i + p] - s.knots[i]);
    ctrl.push(Array.from({ length: dim }, (_, c) => (1 - a) * s.ctrl[i - 1][c] + a * s.ctrl[i][c]));
  }
  for (let i = k - mult; i < s.ctrl.length; i++) ctrl.push(s.ctrl[i].slice());
  const knots = [...s.knots.slice(0, k + 1), u, ...s.knots.slice(k + 1)];
  return { degree: p, knots, ctrl };
}

/**
 * The curve as cubic Bézier segments, one per span of length, each its four
 * control points and the parameter range it covers — every interior knot
 * inserted to full multiplicity. What area, flatness and nearest-point
 * questions are asked of, segment by segment.
 */
export function bezierSegments(s: BSpline): { from: number; to: number; pts: number[][] }[] {
  let c = s;
  const p = c.degree;
  const [lo, hi] = domain(c);
  const inner = [...new Set(c.knots.filter((x) => x > lo && x < hi))];
  for (const u of inner) {
    let mult = c.knots.filter((x) => x === u).length;
    while (mult < p) { c = insertKnot(c, u); mult++; }
  }
  const breaks = [lo, ...inner, hi];
  const out: { from: number; to: number; pts: number[][] }[] = [];
  for (let i = 0; i + 1 < breaks.length; i++) {
    out.push({ from: breaks[i], to: breaks[i + 1], pts: c.ctrl.slice(p * i, p * i + p + 1) });
  }
  return out;
}

/**
 * Parameters along the curve close enough that the chords between them stray
 * no further than `tol` from it — a bound, not an estimate: a cubic Bézier
 * piece's second derivative is at most six times its largest second difference
 * of control points, and a chord over a parameter step δ of a curve bending at
 * most M strays at most M·δ²/8. So the screen's quarter pixel is kept however
 * the curve bends, more samples where it bends hard and fewer where it is
 * straight — the spline's `arcSegments`.
 */
export function sampleParams(s: BSpline, tol: number, cap = 4000): number[] {
  const segs = bezierSegments(s);
  const out: number[] = [];
  const each = Math.max(1, Math.floor(cap / Math.max(1, segs.length)));
  for (const seg of segs) {
    let m = 0;
    for (let i = 0; i + 2 < seg.pts.length; i++) {
      let d2 = 0;
      for (let c = 0; c < seg.pts[i].length; c++) d2 += (seg.pts[i + 2][c] - 2 * seg.pts[i + 1][c] + seg.pts[i][c]) ** 2;
      m = Math.max(m, Math.sqrt(d2));
    }
    const bend = 6 * m;
    const count = Math.min(each, Math.max(1, Math.ceil(Math.sqrt(bend / (8 * Math.max(tol, 1e-12))))));
    for (let k = 0; k < count; k++) out.push(seg.from + ((seg.to - seg.from) * k) / count);
  }
  out.push(segs.length ? segs[segs.length - 1].to : domain(s)[1]);
  return out;
}

/**
 * The parameter of the curve's point nearest `x`: a coarse walk along it, then
 * Newton on the squared distance's derivative — `(C − x)·C′ = 0` — from the
 * nearest sample, kept inside the domain. `periodic`: a closed curve, whose
 * parameter wraps rather than stopping at an end.
 */
export function nearestParam(s: BSpline, x: number[], periodic = false): number {
  const [lo, hi] = domain(s);
  const steps = Math.max(32, 16 * (s.ctrl.length - s.degree));
  let best = lo, bestD = Infinity;
  for (let k = 0; k <= steps; k++) {
    const u = lo + ((hi - lo) * k) / steps;
    const p = pointAt(s, u);
    let d = 0;
    for (let i = 0; i < x.length; i++) d += (p[i] - x[i]) ** 2;
    if (d < bestD) { bestD = d; best = u; }
  }
  let u = best;
  const len = hi - lo;
  for (let it = 0; it < 30; it++) {
    const [c, d1, d2] = derivs(s, u, 2);
    let f = 0, df = 0;
    for (let i = 0; i < x.length; i++) {
      const r = c[i] - x[i];
      f += r * d1[i];
      df += d1[i] * d1[i] + r * d2[i];
    }
    if (!(Math.abs(df) > 1e-300)) break;
    let next = u - f / df;
    if (periodic) next = lo + ((((next - lo) % len) + len) % len);
    else next = Math.min(hi, Math.max(lo, next));
    if (Math.abs(next - u) <= 1e-15 * Math.max(1, len)) { u = next; break; }
    u = next;
  }
  return u;
}

/**
 * ½∫(x dy − y dx) over the curve's parameter from `a` to `b` (either way
 * round), in its first two coordinates — Green's theorem, exact: on a cubic
 * piece the integrand is a polynomial of degree five, and four Gauss–Legendre
 * points per span integrate that exactly.
 */
export function areaSweep(s: BSpline, a: number, b: number): number {
  const sign = b < a ? -1 : 1;
  const [u0, u1] = b < a ? [b, a] : [a, b];
  const breaks = [u0, ...s.knots.filter((k) => k > u0 && k < u1), u1].filter((v, i, all) => i === 0 || v !== all[i - 1]);
  const X = [-0.8611363115940526, -0.3399810435848563, 0.3399810435848563, 0.8611363115940526];
  const W = [0.3478548451374538, 0.6521451548625461, 0.6521451548625461, 0.3478548451374538];
  let sum = 0;
  for (let i = 0; i + 1 < breaks.length; i++) {
    const [lo, hi] = [breaks[i], breaks[i + 1]];
    const half = (hi - lo) / 2, mid = (hi + lo) / 2;
    for (let g = 0; g < 4; g++) {
      const [c, d] = derivs(s, mid + half * X[g], 1);
      sum += W[g] * half * (c[0] * d[1] - c[1] * d[0]);
    }
  }
  return (sign * sum) / 2;
}

/**
 * The part of the curve from parameter `a` to `b` (`a < b`, both in its
 * domain), exactly, as a clamped B-spline of its own over [a, b]: each end
 * inserted as a knot until it is a full one (Boehm), and what lies outside
 * dropped. A closed curve's two halves are written so (solids.ts): an edge
 * that starts where it ends needs a seam the exact B-rep never makes.
 */
export function subCurve(s: BSpline, a: number, b: number): BSpline {
  const p = s.degree;
  let c = s;
  const count = (u: number) => c.knots.filter((x) => x === u).length;
  for (const u of [a, b]) while (count(u) < p + 1 && u > c.knots[0] && u < c.knots[c.knots.length - 1]) {
    if (count(u) >= p) break;
    c = insertKnot(c, u);
  }
  // With a and b each a knot p times over (or an end p + 1), the curve on
  // [a, b] is the controls from the span starting at a's first copy minus one.
  const first = c.knots.indexOf(a);
  const last = c.knots.lastIndexOf(b);
  const lo = first - 1 + (count(a) > p ? 1 : 0);
  const hiCtrl = last - p + (count(b) > p ? 0 : 1) - 1;
  const ctrl = c.ctrl.slice(Math.max(0, lo), hiCtrl + 1);
  const knots = [...new Array(p + 1).fill(a), ...c.knots.filter((x) => x > a && x < b), ...new Array(p + 1).fill(b)];
  return { degree: p, knots, ctrl };
}

/** The curve as a NURBS of unit weights: its unique knots, how many times each repeats, its points `[x, y, z, 1]`. */
export function nurbsOf(s: BSpline): { degree: number; knots: number[]; mults: number[]; points: number[][] } {
  const knots: number[] = [];
  const mults: number[] = [];
  for (const k of s.knots) {
    if (knots.length && k === knots[knots.length - 1]) mults[mults.length - 1]++;
    else { knots.push(k); mults.push(1); }
  }
  return { degree: s.degree, knots, mults, points: s.ctrl.map((c) => [c[0] ?? 0, c[1] ?? 0, c[2] ?? 0, 1]) };
}
