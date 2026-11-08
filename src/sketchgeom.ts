// Where sketch curves meet, and where along a curve a place is — the questions
// trim and extend ask of the drawing (sketchedit.ts, and their tools).
//
// A question about the drawing, as loops.ts and picking.ts are: a function of
// the model, journalling nothing and making nothing. It sits at loops.ts's
// height and reads `heldOnCurves` from there, so "a point held on a curve" means
// the one thing everywhere.
//
// **A curve's carrier** is what it lies on: a line's infinite line, an arc's
// whole circle. Two carriers meet where they cross — line–line, line–circle and
// circle–circle in closed form, a line and an ellipse by scaling the ellipse to
// a circle (an affine map keeps a line a line) — and a tangency, within a
// millionth of the drawing, is no meeting: trim cuts where curves cross, and a
// curve touching another cuts nothing, as loops.ts says of a region. A circle
// and an ellipse, or two ellipses, have no closed form (a quartic): one is
// walked finely round its parameter and each change of side of the other —
// its rim, scaled to one — halved to the crossing, as a spline is walked
// against a line. Two splines (or a spline and a spline's piece) are their
// Bézier pieces, halved while their hulls' boxes overlap and the last overlap
// polished by Newton on both parameters (docs/plans/trim-everything.md).
//
// **In 3D two curves meet only in a plane they share**: two lines that cross
// (not skew, not parallel), a line lying in a circle's plane, two circles in
// one plane. Coordinates go in and come out as the model's, lifted to three
// inside so one piece of arithmetic serves 2D and 3D.
//
// **Along a curve** is a fraction, in the curve's own direction (loops.ts's
// `span`): a line from its first point (0) to its second (1), unbounded either
// way; an arc from its start, the angle over its sweep, counter-clockwise about
// its normal, in [0, 2π/sweep); a circle from its frame's +x, the angle over a
// whole turn, in [0, 1).

import { entityKind, isClosedEntity, type Entity, type Model } from "./model.ts";
import { curveFrame, curvePath } from "./curveplane.ts";
import { arcPoint, type ArcFrame } from "./arcgeom.ts";
import { bezierSegments, derivs, domain, nearestParam, pointAt as pathPoint, sampleParams, type BSpline } from "./bspline.ts";
import { heldOnCurves } from "./loops.ts";
import { cross3, dot3, lift3, sub3, unit3 } from "./vec3.ts";

const TAU = Math.PI * 2;

type V = number[];

/** A curve's carrier, lifted to three coordinates. */
type Carrier =
  | { kind: "line"; p: V; q: V }
  | { kind: "round"; f: ArcFrame; closed: boolean }
  /**
   * A curve laid out by an exact B-spline (a spline, or the piece of one a
   * trim leaves, docs/plans/trim-everything.md) — its own curve, bounded, its
   * parameter running over its domain; a closed one's wrapping.
   */
  | { kind: "path"; curve: BSpline; closed: boolean };

/**
 * The curve kinds trim and extend read: a line, an arc, a circle, and every
 * curve a module declares — an ellipse, an elliptical arc, a spline, the piece
 * of a spline a trim leaves.
 */
export function isSketchCurve(e: Entity | undefined): boolean {
  if (!e) return false;
  if (e.kind === "line" || e.kind === "arc" || e.kind === "circle") return true;
  return entityKind(e.kind)?.curve === true;
}

function carrierOf(model: Model, name: string): Carrier | null {
  const e = model.entities.get(name);
  if (!e) return null;
  if (e.kind === "line") return { kind: "line", p: lift3(model.coords(e.refs[0])), q: lift3(model.coords(e.refs[1])) };
  const path = curvePath(model, e);
  if (path) return { kind: "path", curve: path.curve, closed: path.closed };
  const f = curveFrame(model, e);
  if (!f) return null;
  return { kind: "round", f, closed: isClosedEntity(e) };
}

/** How big a curve is, for tolerances: a line's length, a round's radius. */
function sizeOf(c: Carrier): number {
  if (c.kind === "path") return Math.max(...c.curve.ctrl.map((p) => Math.hypot(...sub3(p, c.curve.ctrl[0]))));
  return c.kind === "line" ? Math.hypot(...sub3(c.q, c.p)) : Math.max(c.f.r, c.f.rv ?? 0);
}

/** A millionth of the larger of two curves (at least of one unit) — loops.ts's `LENGTH_TOL`, for a pair. */
function tolFor(a: Carrier, b: Carrier): number {
  return 1e-6 * Math.max(1, sizeOf(a), sizeOf(b), Math.hypot(...(a.kind === "line" ? a.p : a.kind === "path" ? a.curve.ctrl[0] : a.f.center)));
}

/** The unit normal of the plane a B-spline's control points span, or null for one that is straight. */
function pathNormal(c: BSpline): V | null {
  // The largest triangle the control points make, not the polygon's signed
  // area: an S-shaped spline's area cancels to nothing, and it read as straight
  // (found by the trim-everything suite: a line across one cut nothing).
  let n = [0, 0, 0], best = 0;
  for (let i = 1; i < c.ctrl.length; i++) {
    for (let j = i + 1; j < c.ctrl.length; j++) {
      const w = cross3(sub3(c.ctrl[i], c.ctrl[0]), sub3(c.ctrl[j], c.ctrl[0]));
      const len = Math.hypot(...w);
      if (len > best) [n, best] = [w, len];
    }
  }
  const size = Math.max(1e-300, ...c.ctrl.map((p) => Math.hypot(...sub3(p, c.ctrl[0]))));
  return best > 1e-9 * size * size ? unit3(n) : null;
}

/**
 * Where a line's or a round's carrier crosses a B-spline: the spline walked
 * finely (its quarter-thousandth samples), each step where a side function of
 * the other carrier changes sign halved to the crossing — the signed distance
 * across a line, the normalised distance from a round's rim. A tangency
 * changes no side and is no meeting, as everywhere here. Only in a plane the
 * two share.
 */
function pathMeets(c: Carrier, path: Extract<Carrier, { kind: "path" }>, tol: number): V[] {
  const s = path.curve;
  const n = pathNormal(s) ?? (c.kind === "round" ? c.f.normal : null);
  let side: (x: V) => number;
  if (c.kind === "line") {
    const d = sub3(c.q, c.p);
    const across = n ? unit3(cross3(n, d)) : null;
    if (!across) return [];
    if (n && Math.abs(dot3(sub3(c.p, s.ctrl[0]), n)) > tol) return [];
    side = (x) => dot3(sub3(x, c.p), across);
  } else if (c.kind === "round") {
    if (pathNormal(s) && Math.hypot(...cross3(pathNormal(s)!, c.f.normal)) > 1e-6) return [];
    if (s.ctrl.some((p) => Math.abs(dot3(sub3(p, c.f.center), c.f.normal)) > tol)) return [];
    side = (x) => {
      const d = sub3(x, c.f.center);
      return Math.hypot(dot3(d, c.f.u) / c.f.r, dot3(d, c.f.v) / (c.f.rv ?? c.f.r)) - 1;
    };
  } else return [];
  const us = sampleParams(s, Math.max(tol, 1e-3 * sizeOf(path)) * 4, 8000);
  const at = (u: number) => lift3(pathPoint(s, u));
  const out: V[] = [];
  let [u0, g0] = [us[0], side(at(us[0]))];
  for (const u1 of us.slice(1)) {
    const g1 = side(at(u1));
    if ((g0 < 0) !== (g1 < 0)) {
      let [lo, hi, glo] = [u0, u1, g0];
      for (let i = 0; i < 80; i++) {
        const mid = (lo + hi) / 2, gm = side(at(mid));
        if ((gm < 0) === (glo < 0)) { lo = mid; glo = gm; } else hi = mid;
      }
      const x = at((lo + hi) / 2);
      if (!out.some((y) => Math.hypot(...sub3(x, y)) <= tol)) out.push(x);
    }
    [u0, g0] = [u1, g1];
  }
  return out;
}

/** A plane by its origin and two unit axes. */
interface Flat { o: V; u: V; v: V; n: V }

const toFlat = (pl: Flat, x: V): [number, number] => {
  const d = sub3(x, pl.o);
  return [dot3(d, pl.u), dot3(d, pl.v)];
};
const fromFlat = (pl: Flat, [x, y]: [number, number]): V => [0, 1, 2].map((i) => pl.o[i] + x * pl.u[i] + y * pl.v[i]);

const roundFlat = (f: ArcFrame): Flat => ({ o: f.center, u: f.u, v: f.v, n: f.normal });

/** Whether a point lies in a plane, to `tol`. */
const inPlane = (pl: Flat, x: V, tol: number) => Math.abs(dot3(sub3(x, pl.o), pl.n)) <= tol;

/**
 * Where two carriers meet, as world points (three coordinates) — none for
 * curves in no shared plane, parallel lines, a miss or a tangency.
 */
function carriersMeet(a: Carrier, b: Carrier, tol: number): V[] {
  if (b.kind === "path") return a.kind === "path" ? pathsMeet(a.curve, b.curve, tol) : pathMeets(a, b, tol);
  if (a.kind === "path") return pathMeets(b, a, tol);
  if (a.kind === "line" && b.kind === "line") {
    const d1 = sub3(a.q, a.p), d2 = sub3(b.q, b.p);
    const raw = cross3(d1, d2);
    const l1 = Math.hypot(...d1), l2 = Math.hypot(...d2);
    if (!(l1 > 0) || !(l2 > 0) || Math.hypot(...raw) <= 1e-9 * l1 * l2) return [];
    const n = unit3(raw)!;
    if (Math.abs(dot3(sub3(b.p, a.p), n)) > tol) return []; // skew
    const u = d1.map((x) => x / l1);
    const pl: Flat = { o: a.p, u, v: cross3(n, u), n };
    const [p, q] = [toFlat(pl, b.p), toFlat(pl, b.q)];
    // a's line is the flat x axis: where b's crosses y = 0.
    if (Math.abs(q[1] - p[1]) < 1e-300) return [];
    const s = -p[1] / (q[1] - p[1]);
    return [fromFlat(pl, [p[0] + s * (q[0] - p[0]), 0])];
  }
  if (a.kind === "round" && b.kind === "line") return carriersMeet(b, a, tol);
  if (a.kind === "line" && b.kind === "round") {
    const pl = roundFlat(b.f);
    if (!inPlane(pl, a.p, tol) || !inPlane(pl, a.q, tol)) return [];
    const [p, q] = [toFlat(pl, a.p), toFlat(pl, a.q)];
    // An ellipse is a circle of radius 1 once its axes are scaled to one.
    const [sx, sy] = [b.f.r, b.f.rv ?? b.f.r];
    const P: [number, number] = [p[0] / sx, p[1] / sy], Q: [number, number] = [q[0] / sx, q[1] / sy];
    const hits = lineUnitCircle(P, Q, tol / Math.min(sx, sy));
    return hits.map(([x, y]) => fromFlat(pl, [x * sx, y * sy]));
  }
  const [A, B] = [a as Extract<Carrier, { kind: "round" }>, b as Extract<Carrier, { kind: "round" }>];
  if (Math.hypot(...cross3(A.f.normal, B.f.normal)) > 1e-6) return [];
  if (A.f.rv !== undefined || B.f.rv !== undefined) return conicsMeet(A.f, B.f, tol);
  const pl = roundFlat(A.f);
  if (!inPlane(pl, B.f.center, tol)) return [];
  const c2 = toFlat(pl, B.f.center);
  const [r1, r2] = [A.f.r, B.f.r];
  const d = Math.hypot(c2[0], c2[1]);
  if (d <= tol || d >= r1 + r2 - tol || d <= Math.abs(r1 - r2) + tol) return [];
  const h = (d * d + r1 * r1 - r2 * r2) / (2 * d);
  const k2 = r1 * r1 - h * h;
  if (!(k2 > 0)) return [];
  const k = Math.sqrt(k2);
  const [ux, uy] = [c2[0] / d, c2[1] / d];
  const m: [number, number] = [h * ux, h * uy];
  return [fromFlat(pl, [m[0] - k * uy, m[1] + k * ux]), fromFlat(pl, [m[0] + k * uy, m[1] - k * ux])];
}

/** How far `x` is outside a round's rim, its axes each scaled to one: zero on it, negative inside. */
function rimSide(f: ArcFrame, x: V): number {
  const d = sub3(x, f.center);
  return Math.hypot(dot3(d, f.u) / f.r, dot3(d, f.v) / (f.rv ?? f.r)) - 1;
}

/** How many steps round a conic the walk takes: two crossings closer than one step apart are missed (a near-tangency), so it is fine. */
const CONIC_STEPS = 1440;

/**
 * Where two rounds in one plane meet when one is a conic: the larger walked
 * round its whole rim — its parameter, not its sweep: a carrier is the whole
 * curve — and each step where the other's side changes halved to the
 * crossing. A tangency changes no side and is no meeting. Coplanar normals are
 * the caller's check; the centres' plane is checked here.
 */
function conicsMeet(a: ArcFrame, b: ArcFrame, tol: number): V[] {
  if (Math.abs(dot3(sub3(b.center, a.center), a.normal)) > tol) return [];
  const [walk, other] = Math.max(a.r, a.rv ?? a.r) >= Math.max(b.r, b.rv ?? b.r) ? [a, b] : [b, a];
  const whole: ArcFrame = { ...walk, t0: 0, sweep: TAU };
  const at = (t: number) => arcPoint(whole, t);
  const out: V[] = [];
  let [t0, g0] = [0, rimSide(other, at(0))];
  for (let k = 1; k <= CONIC_STEPS; k++) {
    const t1 = (TAU * k) / CONIC_STEPS;
    const g1 = rimSide(other, at(t1));
    if ((g0 < 0) !== (g1 < 0)) {
      let [lo, hi, glo] = [t0, t1, g0];
      for (let i = 0; i < 80; i++) {
        const mid = (lo + hi) / 2, gm = rimSide(other, at(mid));
        if ((gm < 0) === (glo < 0)) { lo = mid; glo = gm; } else hi = mid;
      }
      const x = at((lo + hi) / 2);
      if (!out.some((y) => Math.hypot(...sub3(x, y)) <= tol)) out.push(x);
    }
    [t0, g0] = [t1, g1];
  }
  return out;
}

/** The axis-aligned box of some points (three coordinates). */
function boxOf(pts: readonly V[]): [V, V] {
  const lo = [Infinity, Infinity, Infinity], hi = [-Infinity, -Infinity, -Infinity];
  for (const p of pts) for (let i = 0; i < 3; i++) { lo[i] = Math.min(lo[i], p[i]); hi[i] = Math.max(hi[i], p[i]); }
  return [lo, hi];
}

/** A cubic Bézier piece split in two at its middle (de Casteljau). */
function halve(p: readonly V[]): [V[], V[]] {
  const mid = (a: V, b: V) => a.map((x, i) => (x + b[i]) / 2);
  const [a, b, c] = [mid(p[0], p[1]), mid(p[1], p[2]), mid(p[2], p[3])];
  const [d, e] = [mid(a, b), mid(b, c)];
  const f = mid(d, e);
  return [[p[0], a, d, f], [f, e, c, p[3]]];
}

/**
 * Where two B-splines in one plane cross: each cut into its Bézier pieces,
 * every pair of pieces whose control hulls' boxes overlap halved — the larger
 * first — until both are smaller than `tol`, the parameters there polished by
 * Newton on `A(u) − B(w) = 0` in the plane. A touch where the two run the same
 * way (their tangents within a millionth of a radian) is a tangency, no
 * crossing; a candidate more than `tol` apart after polishing is none.
 */
function pathsMeet(A: BSpline, B: BSpline, tol: number): V[] {
  const nA = pathNormal(A), nB = pathNormal(B);
  const n = nA ?? nB;
  if (nA && nB && Math.hypot(...cross3(nA, nB)) > 1e-6) return [];
  if (n && [...A.ctrl, ...B.ctrl].some((p) => Math.abs(dot3(sub3(lift3(p), lift3(A.ctrl[0])), n)) > tol)) return [];
  const flat = n ?? [0, 0, 1];
  const u = unit3(Math.abs(flat[0]) < 0.9 ? cross3(flat, [1, 0, 0]) : cross3(flat, [0, 1, 0]))!;
  const v = cross3(flat, u);
  const found: [number, number][] = [];
  type Bit = { pts: V[]; from: number; to: number };
  const bits = (s: BSpline): Bit[] => bezierSegments(s).map((g) => ({ pts: g.pts.map(lift3), from: g.from, to: g.to }));
  const overlap = (p: Bit, q: Bit) => {
    const [a0, a1] = boxOf(p.pts), [b0, b1] = boxOf(q.pts);
    return [0, 1, 2].every((i) => a0[i] <= b1[i] + tol && b0[i] <= a1[i] + tol);
  };
  const size = (b: Bit) => { const [lo, hi] = boxOf(b.pts); return Math.hypot(...sub3(hi, lo)); };
  const split = (b: Bit): [Bit, Bit] => {
    const [l, r] = halve(b.pts);
    const m = (b.from + b.to) / 2;
    return [{ pts: l, from: b.from, to: m }, { pts: r, from: m, to: b.to }];
  };
  const visit = (p: Bit, q: Bit, depth: number) => {
    if (found.length > 256 || !overlap(p, q)) return;
    if ((size(p) <= tol && size(q) <= tol) || depth > 48) {
      found.push([(p.from + p.to) / 2, (q.from + q.to) / 2]);
      return;
    }
    if (size(p) >= size(q)) { const [l, r] = split(p); visit(l, q, depth + 1); visit(r, q, depth + 1); }
    else { const [l, r] = split(q); visit(p, l, depth + 1); visit(p, r, depth + 1); }
  };
  for (const p of bits(A)) for (const q of bits(B)) visit(p, q, 0);
  const [aLo, aHi] = domain(A), [bLo, bHi] = domain(B);
  const out: V[] = [];
  for (let [ua, ub] of found) {
    for (let it = 0; it < 30; it++) {
      const [pa, da] = derivs(A, ua, 1).map(lift3), [pb, db] = derivs(B, ub, 1).map(lift3);
      const r = sub3(pa, pb);
      const [rx, ry] = [dot3(r, u), dot3(r, v)];
      const [ax, ay, bx, by] = [dot3(da, u), dot3(da, v), -dot3(db, u), -dot3(db, v)];
      const det = ax * by - ay * bx;
      if (!(Math.abs(det) > 1e-300)) break;
      ua = Math.min(aHi, Math.max(aLo, ua - (rx * by - ry * bx) / det));
      ub = Math.min(bHi, Math.max(bLo, ub - (ax * ry - ay * rx) / det));
    }
    const [pa, da] = derivs(A, ua, 1).map(lift3), [pb, db] = derivs(B, ub, 1).map(lift3);
    if (Math.hypot(...sub3(pa, pb)) > tol) continue;
    const [ta, tb] = [unit3(da), unit3(db)];
    if (!ta || !tb || Math.hypot(...cross3(ta, tb)) < 1e-6) continue;
    if (!out.some((y) => Math.hypot(...sub3(pa, y)) <= tol)) out.push(pa);
  }
  return out;
}

/** Where the infinite line through p and q meets the unit circle about the origin — none for a miss or a tangency. */
function lineUnitCircle(p: [number, number], q: [number, number], tol: number): [number, number][] {
  const d = [q[0] - p[0], q[1] - p[1]];
  const len = Math.hypot(d[0], d[1]);
  if (!(len > 0)) return [];
  const u = [d[0] / len, d[1] / len];
  const along = -(p[0] * u[0] + p[1] * u[1]);
  const across = -(u[0] * p[1] - u[1] * p[0]);
  if (Math.abs(across) >= 1 - tol) return [];
  const half = Math.sqrt(1 - across * across);
  return [along - half, along + half].map((s) => [p[0] + s * u[0], p[1] + s * u[1]] as [number, number]);
}

/** The angle of `x` round a round's frame, from its +u, counter-clockwise about its normal, in [0, 2π). */
function angleOn(f: ArcFrame, x: V): number {
  const d = sub3(x, f.center);
  const t = Math.atan2(dot3(d, f.v) / (f.rv ?? f.r), dot3(d, f.u) / f.r);
  return ((t % TAU) + TAU) % TAU;
}

/** The angle of `x` round a round's frame from where it starts — an elliptical arc's start (`t0`), anything else's +u — in [0, 2π). */
function fromStart(f: ArcFrame, x: V): number {
  const t = angleOn(f, x) - (f.t0 ?? 0);
  return ((t % TAU) + TAU) % TAU;
}

/** How far along a carrier a world point (three coordinates) is — see the top of the file. A path's: its nearest point's parameter, over its domain. */
function fractionAlong(c: Carrier, x: V): number {
  if (c.kind === "path") {
    const [lo, hi] = domain(c.curve);
    return hi > lo ? (nearestParam(c.curve, x, c.closed) - lo) / (hi - lo) : 0;
  }
  if (c.kind === "line") {
    const d = sub3(c.q, c.p);
    return dot3(sub3(x, c.p), d) / dot3(d, d);
  }
  return fromStart(c.f, x) / (c.closed ? TAU : c.f.sweep);
}

/** The model's coordinates of a lifted point. */
const own = (model: Model, x: V) => x.slice(0, model.dim);

/** How far along `name` a place is (the model's coordinates): see the top of the file. */
export function fractionOn(model: Model, name: string, world: number[]): number {
  const c = carrierOf(model, name);
  if (!c) throw new Error(`"${name}" is not a line, arc or circle`);
  return fractionAlong(c, lift3(world));
}

/** The place a fraction `t` along `name` is, in the model's coordinates. */
export function pointOn(model: Model, name: string, t: number): number[] {
  const c = carrierOf(model, name);
  if (!c) throw new Error(`"${name}" is not a curve`);
  if (c.kind === "path") {
    const [lo, hi] = domain(c.curve);
    const f = c.closed ? ((t % 1) + 1) % 1 : Math.min(1, Math.max(0, t));
    return own(model, lift3(pathPoint(c.curve, lo + f * (hi - lo))));
  }
  if (c.kind === "line") return own(model, c.p.map((pi, i) => pi + t * (c.q[i] - pi)));
  return own(model, arcPoint(c.f, t * (c.closed ? TAU : c.f.sweep)));
}

/** How long `name` is along itself, for turning a length into a fraction: a line's length, an arc's or circle's circumference. */
export function lengthOf(model: Model, name: string): number {
  const c = carrierOf(model, name);
  if (!c) return 0;
  if (c.kind === "path") {
    const us = sampleParams(c.curve, 1e-4 * Math.max(1, sizeOf(c)), 2000);
    let len = 0;
    for (let k = 1; k < us.length; k++) len += Math.hypot(...sub3(lift3(pathPoint(c.curve, us[k])), lift3(pathPoint(c.curve, us[k - 1]))));
    return len;
  }
  if (c.kind === "line") return Math.hypot(...sub3(c.q, c.p));
  // An ellipse's by its larger semi-axis: an upper bound, which is all a tolerance needs.
  return Math.max(c.f.r, c.f.rv ?? c.f.r) * (c.closed ? TAU : c.f.sweep);
}

/**
 * How far a place is from the curve itself — a line's segment, an arc's sweep,
 * a circle's rim — in the model's units. What a tool asks to choose between the
 * curves meeting at a point it was handed.
 */
export function distanceToCurve(model: Model, name: string, world: number[]): number {
  const c = carrierOf(model, name);
  if (!c) return Infinity;
  const x = lift3(world);
  if (c.kind === "path") {
    // The curve's nearest point, by Newton from a walk (`nearestParam`) — not the nearest sample, which
    // is a chord's sagitta off on a straight stretch.
    return Math.hypot(...sub3(x, lift3(pathPoint(c.curve, nearestParam(c.curve, x, c.closed)))));
  }
  if (c.kind === "line") {
    const t = Math.min(1, Math.max(0, fractionAlong(c, x)));
    return Math.hypot(...sub3(x, c.p.map((pi, i) => pi + t * (c.q[i] - pi))));
  }
  const th = fromStart(c.f, x);
  const sweep = c.closed ? TAU : c.f.sweep;
  const t = th <= sweep ? th : (th - sweep < TAU - th ? sweep : 0);
  return Math.hypot(...sub3(x, arcPoint(c.f, t)));
}

/** Whether a place on a carrier is on the curve itself — a line's segment, an arc's sweep — to `tol`. */
function onExtent(c: Carrier, x: V, tol: number): boolean {
  if (c.kind === "path") return true; // its meetings are on it: it is its own extent
  if (c.kind === "line") {
    const len = Math.hypot(...sub3(c.q, c.p));
    const t = fractionAlong(c, x);
    const e = tol / Math.max(len, 1e-300);
    return t >= -e && t <= 1 + e;
  }
  if (c.closed) return true;
  const th = fromStart(c.f, x);
  const e = tol / Math.min(c.f.r, c.f.rv ?? c.f.r);
  return th <= c.f.sweep + e || th >= TAU - e;
}

/** The end points of a curve, by name — a line's two, an arc's start and end, a declared open curve's (`EntityKindSpec.ends`); none for a closed curve. */
export function curveEnds(e: Entity): string[] {
  if (e.kind === "line") return [...e.refs];
  if (e.kind === "arc") return [e.start, e.end];
  return entityKind(e.kind)?.ends?.(e) ?? [];
}
const endsOf = curveEnds;

/**
 * **Where `name` is cut**: every place another curve crosses it, or rests an
 * end on it (a T), strictly inside it — never at its own ends, which are where
 * it stops already — in order along it. Each with the cutting curve, the world
 * place, and the point already there when there is one: the cutter's own end
 * (a T), or a point a relation holds on `name` (a crossing a snap or an extrude
 * made real). Places within a millionth of each other are one cut, the one with
 * a point kept. Construction curves cut as any other: they are drawn, and a
 * trim to one is what a construction line is for.
 */
export interface CurveCut {
  t: number;
  at: number[];
  by: string;
  point: string | null;
}

export function cutsOf(model: Model, name: string): CurveCut[] {
  const me = model.entities.get(name);
  const mine = carrierOf(model, name);
  if (!me || !mine) return [];
  const closed = isClosedEntity(me);
  const held = heldOnCurves(model).filter((h) => h.curve === name).map((h) => h.point);
  const ends = new Set(endsOf(me));
  const len = lengthOf(model, name);
  const cuts: CurveCut[] = [];
  for (const other of model.entities.values()) {
    if (other.name === name || !isSketchCurve(other)) continue;
    const them = carrierOf(model, other.name);
    if (!them) continue;
    const tol = tolFor(mine, them);
    for (const x of carriersMeet(mine, them, tol)) {
      if (!onExtent(them, x, tol)) continue;
      // An arc's carrier is its whole circle (an elliptical arc's its whole
      // ellipse): a crossing off its sweep is not on it.
      if (!closed && mine.kind === "round" && !(fromStart(mine.f, x) < mine.f.sweep)) continue;
      const t = fractionAlong(mine, x);
      const e = tol / Math.max(len, 1e-300);
      if (!closed && !(t > e && t < 1 - e)) continue;
      const near = (p: string) => Math.hypot(...sub3(lift3(model.coords(p)), x)) <= tol * 10;
      const point = endsOf(other).find((p) => !ends.has(p) && near(p)) ?? held.find((p) => !ends.has(p) && near(p)) ?? null;
      cuts.push({ t: closed ? ((t % 1) + 1) % 1 : t, at: own(model, x), by: other.name, point });
    }
  }
  cuts.sort((a, b) => a.t - b.t);
  const out: CurveCut[] = [];
  for (const c of cuts) {
    const last = out[out.length - 1];
    const same = last && Math.hypot(...sub3(lift3(last.at), lift3(c.at))) <= 1e-6 * Math.max(1, len);
    if (!same) out.push(c);
    else if (last.point === null && c.point !== null) out[out.length - 1] = c;
  }
  // A closed curve's first and last cuts can be one place across its seam.
  if (closed && out.length > 1) {
    const [first, last] = [out[0], out[out.length - 1]];
    if (Math.hypot(...sub3(lift3(first.at), lift3(last.at))) <= 1e-6 * Math.max(1, len)) {
      if (first.point === null && last.point !== null) out[0] = last;
      out.pop();
    }
  }
  return out;
}

/**
 * **Where a stroke from `a` to `b` crosses the drawing** (docs/plans/
 * trim-everything.md, power trim): every sketch curve `curves` names that the
 * straight segment between two places on the sketch plane passes through, as
 * the curve and the place, in order along the stroke. A tangency is no
 * crossing here either. The stroke is a line carrier, so it meets a curve
 * only in a plane they share — a stroke on the sketch plane meets what is
 * drawn on it.
 */
export function strokeCrossings(model: Model, a: number[], b: number[], curves: readonly string[]): { curve: string; at: number[]; s: number }[] {
  const stroke: Carrier = { kind: "line", p: lift3(a), q: lift3(b) };
  const len = Math.hypot(...sub3(stroke.q, stroke.p));
  if (!(len > 0)) return [];
  const out: { curve: string; at: number[]; s: number }[] = [];
  for (const name of curves) {
    const them = carrierOf(model, name);
    if (!them) continue;
    const tol = tolFor(stroke, them);
    for (const x of carriersMeet(stroke, them, tol)) {
      const s = fractionAlong(stroke, x);
      if (s < -tol / len || s > 1 + tol / len || !onExtent(them, x, tol)) continue;
      out.push({ curve: name, at: own(model, x), s });
    }
  }
  return out.sort((p, q) => p.s - q.s);
}

/**
 * **Where extending an end of `name` reaches**: the first curve its carrier
 * meets past that end — a line on along its own direction, an arc on round its
 * circle — and the place, as a fraction along `name` and in the world. `to`
 * names the curve when one is wanted; null when nothing lies that way.
 */
export interface Reach {
  by: string;
  at: number[];
  /** How far past the end, along the curve: a length. */
  past: number;
}

export function reachOf(model: Model, name: string, end: "start" | "end", to?: string | null): Reach | null {
  const me = model.entities.get(name);
  const mine = carrierOf(model, name);
  // A line, or an open round — an arc, an elliptical arc — carried on round its whole rim.
  if (!me || !mine || mine.kind === "path" || (mine.kind === "round" && mine.closed)) return null;
  let best: Reach | null = null;
  for (const other of model.entities.values()) {
    if (other.name === name || !isSketchCurve(other) || (to != null && other.name !== to)) continue;
    const them = carrierOf(model, other.name);
    if (!them) continue;
    const tol = tolFor(mine, them);
    for (const x of carriersMeet(mine, them, tol)) {
      if (!onExtent(them, x, tol)) continue;
      let past: number;
      if (mine.kind === "line") {
        const t = fractionAlong(mine, x);
        const len = Math.hypot(...sub3(mine.q, mine.p));
        past = (end === "end" ? t - 1 : -t) * len;
      } else {
        const th = fromStart(mine.f, x);
        if (th <= mine.f.sweep + tol / mine.f.r || th >= TAU - tol / mine.f.r) continue; // on the arc already
        past = (end === "end" ? th - mine.f.sweep : TAU - th) * mine.f.r;
      }
      if (!(past > tol)) continue;
      if (!best || past < best.past) best = { by: other.name, at: own(model, x), past };
    }
  }
  return best;
}
