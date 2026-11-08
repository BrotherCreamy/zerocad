// The spline's equations (docs/plans/spline.md): the interpolation it owns,
// and the relations that read the curve — `onspline` and `tan` at an end.
//
// **What the spline owns.** A cubic B-spline through its points has control
// points the solver finds: the layout's rows (../bspline.ts) — the curve
// through each interior point, natural ends or a smooth seam — one residual
// block each, `dim` rows, linear in the control points and never a square.
// They are added by `addSpline` straight to the problem and held on the entity
// (`SplineEntity.blocks`), not through `model.relation`: they are no relation
// a person made and can delete, they are what the entity *is*, so they go with
// it (`deleteEntity` removes what a kind `owns`) and come back with it (one
// journal entry, `addSpline`). Each block reads only the points and control
// points near its knot — the basis reads six knots, and those are the gaps
// between seven through-points at most — so a spline's Jacobian is banded.
//
// **Dimension-generic**, all of it: the curve is control points in however
// many coordinates the model has, and "through", "natural", "smooth seam" and
// "on the curve" are vector equations. `onspline` in 3D needs no plane block —
// the curve's position minus the point's is three rows, which put the point on
// the curve and so in whatever plane the curve is in. `tan` reads directions
// through `wedge` and `dot`, as `par` and `perp` do.

import { Dual } from "../kernel/dual.ts";
import type { Model } from "../model.ts";
import type { BlockHandle } from "../kernel/problem.ts";
import { DEGREE, dersBasis, domain, interpolate, layout, nearestParam, rowTerms, type Layout, type Ring, type Row } from "../bspline.ts";
import { bsplineOf, checkSpline, pathCurveOf, placeSpline, splineOf, type SplineEntity } from "../kinds/spline.ts";
import { dot, vecSub, wedge } from "./vec.ts";
import { curveNormal, joinVars, lineVars, unitDuals } from "./refs.ts";

/** Duals as a ring, so ../bspline.ts's basis runs over them and hands back exact gradients. */
const DUAL: Ring<Dual> = {
  add: (a, b) => a.add(b),
  sub: (a, b) => a.sub(b),
  mul: (a, b) => a.mul(b),
  div: (a, b) => a.div(b),
  of: (x) => Dual.constant(x),
};

/** The gap floor ../bspline.ts's `gapOf` uses, so a Dual gap is the very number a drawn one is. */
const GAP_FLOOR = 1e-24;

/** A centripetal knot gap between two points, as Duals: `(|b − a|²)^¼`, floored. Not a square: a root of a length. */
function gapDual(a: Dual[], b: Dual[]): Dual {
  const d = vecSub(b, a);
  return dot(d, d).add(GAP_FLOOR).sqrt().sqrt();
}

/** The variables a row reads: which through-points (for its knots and its point) and which solved control points. */
function rowReads(L: Layout, row: Row): { points: number[]; unknowns: number[] } {
  const m = L.ctrl.length;
  const windows = row.kind === "seam" ? [3, m - 1] : [row.span];
  const points = new Set<number>();
  const unknowns = new Set<number>();
  for (const w of windows) {
    for (let j = w - 2; j <= w + 2; j++) { const g = L.gaps[j]; if (g) { points.add(g[0]); points.add(g[1]); } }
    for (let j = w - DEGREE; j <= w; j++) {
      const c = L.ctrl[j];
      if ("unknown" in c) unknowns.add(c.unknown);
      else points.add(c.point);
    }
  }
  if (row.kind === "through") points.add(row.point);
  return { points: [...points].sort((a, b) => a - b), unknowns: [...unknowns].sort((a, b) => a - b) };
}

/** A row's label, as an offender report spells it. */
function rowLabel(s: SplineEntity, row: Row): string {
  if (row.kind === "through") return `spline(${s.name})|through(${s.points[row.point]})`;
  if (row.kind === "natural") return `spline(${s.name})|natural(${row.at})`;
  return `spline(${s.name})|seam(C${row.order === 1 ? "′" : "″"})`;
}

/**
 * The spline's own equations, made afresh: whatever blocks it held go, and one
 * block per row of its layout is added and held on the entity. Read at build
 * time — its points and control variables — so a change of structure (a
 * through-point added or taken out) calls this again.
 */
export function holdSpline(model: Model, s: SplineEntity): void {
  for (const h of s.blocks) model.problem.removeBlock(h);
  const dim = model.dim;
  const L = layout(s.points.length, s.closed === true);
  const blocks: BlockHandle[] = [];
  for (const row of L.rows) {
    const { points, unknowns } = rowReads(L, row);
    const vars = [
      ...points.flatMap((k) => model.point(s.points[k]).varIndices),
      ...unknowns.flatMap((u) => s.ctrl.slice(u * dim, (u + 1) * dim)),
    ];
    const pointAt = new Map(points.map((k, i) => [k, i]));
    const unknownAt = new Map(unknowns.map((u, i) => [u, points.length + i]));
    blocks.push(model.problem.addResidual(vars, (l) => {
      const vec = (slot: number) => l.slice(slot * dim, (slot + 1) * dim);
      const P = (k: number) => vec(pointAt.get(k)!);
      const gaps = new Map<number, Dual>();
      const gap = (j: number): Dual => {
        const g = L.gaps[j];
        if (!g) return Dual.constant(0);
        let d = gaps.get(j);
        if (!d) gaps.set(j, d = gapDual(P(g[0]), P(g[1])));
        return d;
      };
      const ctrl = (j: number) => { const c = L.ctrl[j]; return "unknown" in c ? vec(unknownAt.get(c.unknown)!) : P(c.point); };
      const out = Array.from({ length: dim }, () => Dual.constant(0));
      for (const t of rowTerms(DUAL, L, gap, row)) {
        const q = ctrl(t.ctrl);
        for (let i = 0; i < dim; i++) out[i] = out[i].add(t.coeff.mul(q[i]));
      }
      if (row.kind === "through") { const p = P(row.point); for (let i = 0; i < dim; i++) out[i] = out[i].sub(p[i]); }
      return out;
    }, rowLabel(s, row)));
  }
  s.blocks = blocks;
}

/**
 * A spline through `points`, open or `closed` — the entity and the equations
 * it owns (see the top of the file), journalled as `addSpline(points, closed,
 * name)`. Its control points are seeded on the curve the points make now, so
 * it is that curve from its first frame. A constructor, so it constrains
 * nothing about its points: where they go is the user's.
 */
export function addSpline(model: Model, points: string[], closed?: boolean | null, name?: string | null): string {
  checkSpline(model, points, closed ?? null);
  const s = placeSpline(model, points, closed === true, name);
  holdSpline(model, s);
  model.record("addSpline", [[...points], closed === true ? true : null, s.name]);
  return s.name;
}

/**
 * A spline's through-points changed in place — one added or taken out (the
 * context menu's, ../splineedit.ts): its control variables re-seeded on the
 * curve the new points make, its equations made again. Its name, and every
 * relation on it, stay. A primitive the edit operations call; journals nothing.
 */
export function respline(model: Model, name: string, points: string[]): void {
  const s = splineOf(model, name);
  checkSpline(model, points, s.closed === true);
  const fresh = placeSplineVars(model, points, s.closed === true);
  s.points = [...points];
  s.ctrl = fresh;
  holdSpline(model, s);
}

/** Control variables seeded on the curve through `points`, as `placeSpline` seeds a new one's. */
function placeSplineVars(model: Model, points: readonly string[], closed: boolean): number[] {
  // Through a throwaway layout of the same points: the seed is the curve they make now.
  const at = points.map((p) => model.coords(p));
  const L = layout(points.length, closed);
  const seed = interpolate(at, closed).ctrl;
  const out: number[] = [];
  L.ctrl.forEach((c, k) => { if ("unknown" in c) for (const x of seed[k]) out.push(model.problem.addVar(x)); });
  return out;
}

/**
 * Whether a kind is a spline: an interpolant (`spline`), or the piece of one a
 * trim leaves, a spline of control points (`bspline`, kinds/spline.ts) — what
 * `onspline` and `tan` take alike (docs/plans/trim-everything.md).
 */
export function isPathCurve(kind: string | undefined): boolean {
  return kind === "spline" || kind === "bspline";
}

/** `name` as a spline of either kind, or the refusal. */
function pathCheck(model: Model, name: string): void {
  if (!isPathCurve(model.entities.get(name)?.kind)) splineOf(model, name);
}

/**
 * Every variable a spline's curve reads, in a fixed order: an interpolant's
 * through-points' then its control points'; a control-point spline's points'.
 * Read lazily, so a relation follows a spline a trim turned into its piece
 * under the same name.
 */
function splineVars(model: Model, name: string): () => number[] {
  pathCheck(model, name);
  return () => {
    const e = model.entities.get(name);
    if (e?.kind === "bspline") return e.points.flatMap((p) => model.point(p).varIndices);
    const s = splineOf(model, name);
    return [...s.points.flatMap((p) => model.point(p).varIndices), ...s.ctrl];
  };
}

/** A control-point spline at a fraction `sigma` of its domain, over its points' Duals — the knots fixed numbers. */
function bsplineAt(model: Model, name: string, l: Dual[], sigma: Dual): Dual[] {
  const s = bsplineOf(model, name);
  const dim = model.dim;
  const K = s.knots.map((k) => Dual.constant(k));
  const m = s.points.length;
  const [lo, hi] = [s.knots[DEGREE], s.knots[m]];
  // Open: past an end it runs on along the end span's own polynomial, as an interpolant's does.
  const u = sigma.mul(hi - lo).add(lo);
  let span = DEGREE;
  while (span < m - 1 && u.val >= s.knots[span + 1]) span++;
  const N = dersBasis(DUAL, K, span, u, DEGREE, 0)[0];
  const out = Array.from({ length: dim }, () => Dual.constant(0));
  N.forEach((c, j) => {
    const k = span - DEGREE + j;
    for (let i = 0; i < dim; i++) out[i] = out[i].add(c.mul(l[k * dim + i]));
  });
  return out;
}

/**
 * The curve at a fraction `sigma` of its parameter, as Duals over `splineVars`'
 * locals — the spline evaluated with its knots and control points all live, so
 * a relation on the curve moves its points and its shape alike.
 */
function curveAt(model: Model, name: string, l: Dual[], sigma: Dual): Dual[] {
  if (model.entities.get(name)?.kind === "bspline") return bsplineAt(model, name, l, sigma);
  const s = splineOf(model, name);
  const dim = model.dim;
  const n = s.points.length;
  const L = layout(n, s.closed === true);
  const P = (k: number) => l.slice(k * dim, (k + 1) * dim);
  const Q = (u: number) => l.slice((n + u) * dim, (n + u + 1) * dim);
  const K: Dual[] = [Dual.constant(0)];
  for (const g of L.gaps) K.push(K[K.length - 1].add(g ? gapDual(P(g[0]), P(g[1])) : Dual.constant(0)));
  const m = L.ctrl.length;
  // A closed curve's parameter wraps; an open one's runs on past its ends,
  // along the end span's own polynomial.
  const frac = s.closed ? sigma.sub(Math.floor(sigma.val)) : sigma;
  const u = frac.mul(K[m]);
  let span = DEGREE;
  while (span < m - 1 && u.val >= K[span + 1].val) span++;
  const N = dersBasis(DUAL, K, span, u, DEGREE, 0)[0];
  const out = Array.from({ length: dim }, () => Dual.constant(0));
  N.forEach((c, j) => {
    const ctl = L.ctrl[span - DEGREE + j];
    const q = "unknown" in ctl ? Q(ctl.unknown) : P(ctl.point);
    for (let i = 0; i < dim; i++) out[i] = out[i].add(c.mul(q[i]));
  });
  return out;
}

/**
 * A point lies on a spline — **the parameter form**, the one `oncircle` could
 * not teach: the relation makes a variable of its own, the point's place along
 * the curve as a fraction of it (`relationVar`), seeded at the curve's point
 * nearest the point now, and the residual is the curve's position there minus
 * the point's, `C(σ) − p`: `dim` rows, linear in the curve's control points
 * and in the point, never a square. So a held point slides along the curve
 * continuously as either moves — it cannot jump to another branch the way a
 * nearest-point residual would — and the diagnosis counts its σ as the one
 * freedom left it. In any dimension: in 3D the three rows put it on the curve,
 * and so in the curve's plane. On an open spline it may slide past an end,
 * onto the end span carried on; on a closed one σ wraps.
 */
export function onSpline(model: Model, pointName: string, splineName: string): string {
  model.point(pointName);
  pathCheck(model, splineName);
  return model.relation("onSpline", [pointName, splineName], () => {
    const curve = pathCurveOf(model, splineName);
    const [lo, hi] = domain(curve);
    const u0 = nearestParam(curve, model.coords(pointName), curve.closed);
    const sigma = model.relationVar(hi > lo ? (u0 - lo) / (hi - lo) : 0);
    const p = model.point(pointName);
    const dim = model.dim;
    model.addResidual(joinVars(p.varIndices, [sigma], splineVars(model, splineName)), (l) => {
      const c = curveAt(model, splineName, l.slice(dim + 1), l[dim]);
      return c.map((ci, i) => ci.sub(l[i]));
    }, `onspline(${pointName},${splineName})`);
  });
}

/** Which end of a spline: its first through-point, or its last. */
export type SplineEnd = "start" | "end";
const ENDS: readonly SplineEnd[] = ["start", "end"];

/** Whether two points are one: the same point, or held together by `coin`s, directly or through a chain. */
function joined(model: Model, a: string, b: string): boolean {
  if (a === b) return true;
  const seen = new Set([a]);
  const todo = [a];
  while (todo.length) {
    const p = todo.pop()!;
    for (const r of model.relations.values()) {
      if (r.op !== "coincident") continue;
      const [x, y] = r.args as [string, string];
      const next = x === p ? y : y === p ? x : null;
      if (next === null || seen.has(next)) continue;
      if (next === b) return true;
      seen.add(next);
      todo.push(next);
    }
  }
  return false;
}

/** A spline's end point, and the variables of the end's tangent: the end point and the control point beside it. */
function endVars(model: Model, name: string, end: SplineEnd): () => number[] {
  return () => {
    const e = model.entities.get(name);
    if (e?.kind === "bspline") {
      const n = e.points.length;
      const [at, next] = end === "start" ? [e.points[0], e.points[1]] : [e.points[n - 1], e.points[n - 2]];
      return [...model.point(at).varIndices, ...model.point(next).varIndices];
    }
    const s = splineOf(model, name);
    const dim = model.dim;
    const at = end === "start" ? s.points[0] : s.points[s.points.length - 1];
    const k = end === "start" ? 0 : s.ctrl.length / dim - 1;
    return [...model.point(at).varIndices, ...s.ctrl.slice(k * dim, (k + 1) * dim)];
  };
}

/** The point at a spline's end — an interpolant's first or last through-point, a control-point spline's first or last point. */
function endPoint(model: Model, name: string, end: SplineEnd): string {
  const e = model.entities.get(name);
  const s = e?.kind === "bspline" ? e : splineOf(model, name);
  return end === "start" ? s.points[0] : s.points[s.points.length - 1];
}

/**
 * Which of a spline's ends meets `other` — joined to a line's end, an arc's
 * end or another spline's end, or held `oncircle` a circle — or the end given,
 * checked. Refuses a closed spline (it has no end), an end given that is not
 * one, and a spline whose ends both meet with none given (say which).
 */
function meetingEnd(model: Model, spline: string, other: string, given: unknown): SplineEnd {
  pathCheck(model, spline);
  if (pathCurveOf(model, spline).closed) throw new Error(`tan holds a spline at an end, and "${spline}" is closed — it has none`);
  if (given != null && !(ENDS as readonly unknown[]).includes(given)) {
    throw new Error(`tan takes a spline's end as "start" or "end", got ${JSON.stringify(given)}`);
  }
  if (given != null) return given as SplineEnd;
  const o = model.entities.get(other);
  const meets = (end: SplineEnd): boolean => {
    const p = endPoint(model, spline, end);
    if (!o) return false;
    if (o.kind === "line") return o.refs.some((q) => joined(model, p, q));
    if (o.kind === "arc") return [o.start, o.end].some((q) => joined(model, p, q));
    if (o.kind === "circle") {
      return [...model.relations.values()].some((r) => r.op === "onCircle" && r.args[1] === other && joined(model, p, r.args[0] as string));
    }
    if (o.kind === "spline" || o.kind === "bspline") return [o.points[0], o.points[o.points.length - 1]].some((q) => joined(model, p, q));
    return false;
  };
  const both = ENDS.filter(meets);
  if (both.length === 1) return both[0];
  if (both.length === 2) throw new Error(`both ends of "${spline}" meet "${other}" — say which: tan(…, "start") or tan(…, "end")`);
  throw new Error(`tan holds a spline at an end that meets the other curve — neither end of "${spline}" meets "${other}" `
    + "(share the point, or coin it)");
}

/** A spline end's direction of travel, as Duals: from its end point to the control point beside it (`endVars`' locals). */
function endTangent(l: Dual[], dim: number, end: SplineEnd): Dual[] {
  const [p, q] = [l.slice(0, dim), l.slice(dim, 2 * dim)];
  return end === "start" ? vecSub(q, p) : vecSub(p, q);
}

/**
 * Tangency at a spline's end (docs/plans/spline.md): `tan(line, s)` — the
 * line along the spline's end tangent, `wedge` of the two directions, read
 * unit, as `par` reads them; `tan(s, arc)` and `tan(s, circle)` — the end
 * tangent square to the radius to the spline's end, `dot`, as a tangent arc's
 * join is (geometry.ts's `tangent` at a shared end), and in 3D in the arc's
 * plane; `tan(s, s2)` — two splines' ends running on into each other. The end
 * is the one that meets the other curve (`meetingEnd`), journalled as read so a
 * replay holds the same end; `end`, when given, is the spline's end, and with
 * two splines `end2` the second's. None of the residuals is a square: a
 * wedge's components and a dot, each linear in each direction.
 */
export function tangentSpline(model: Model, a: string, b: string, end?: unknown, end2?: unknown): string {
  const kind = (n: string) => model.entities.get(n)?.kind;
  if (isPathCurve(kind(a)) && isPathCurve(kind(b))) {
    if (a === b) throw new Error(`tan needs two curves: "${a}" twice is one`);
    const [ea, eb] = [meetingEnd(model, a, b, end), meetingEnd(model, b, a, end2)];
    return model.relation("tangent", [a, b, ea, eb], () => {
      const dim = model.dim;
      model.addResidual(joinVars(endVars(model, a, ea), endVars(model, b, eb)), (l) =>
        wedge(unitDuals(endTangent(l, dim, ea)), unitDuals(endTangent(l.slice(2 * dim), dim, eb))), `tan(${a},${b})`);
    });
  }
  const [spline, other] = isPathCurve(kind(a)) ? [a, b] : [b, a];
  const ok = kind(other);
  if (ok !== "line" && ok !== "arc" && ok !== "circle") {
    throw new Error(`tan takes a spline with a line, an arc, a circle or another spline — "${other}" is ${ok ? `a ${ok}` : "not there"}`);
  }
  const e = meetingEnd(model, spline, other, end);
  if (end2 != null) throw new Error(`tan takes a second end only between two splines — "${other}" is a ${ok}`);
  return model.relation("tangent", [a, b, e], () => {
    const dim = model.dim;
    const label = `tan(${a},${b})`;
    if (ok === "line") {
      model.addResidual(joinVars(endVars(model, spline, e), lineVars(model, other)), (l) => {
        const t = endTangent(l, dim, e);
        const w = vecSub(l.slice(3 * dim, 4 * dim), l.slice(2 * dim, 3 * dim));
        return wedge(unitDuals(t), unitDuals(w));
      }, label);
      return;
    }
    const c = model.circular(other);
    const centre = model.point(c.center).varIndices;
    model.addResidual(joinVars(endVars(model, spline, e), centre), (l) => {
      const t = endTangent(l, dim, e);
      const radius = vecSub(l.slice(0, dim), l.slice(2 * dim, 3 * dim));
      return [dot(unitDuals(t), unitDuals(radius))];
    }, label);
    const normal = curveNormal(model, other);
    if (normal) {
      // In 3D the end runs on in the arc's own plane, as a tangent line lies in a circle's.
      model.addResidual(joinVars(endVars(model, spline, e), normal), (l) =>
        [dot(unitDuals(endTangent(l, dim, e)), unitDuals(l.slice(2 * dim, 2 * dim + 3)))], `${label}|plane`);
    }
  });
}
