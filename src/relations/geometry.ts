// The rest of the sketch relation vocabulary, past the point/distance
// starter set in basic.ts. Same shape as everything there: each function
// takes the model plus some entity names, and adds one residual block whose
// value is zero exactly when the relation holds. Nothing here is privileged
// over a relation someone writes at the REPL — these are just the ones worth
// shipping in the box.
//
// Most of these are dimension-generic, and not by accident: written in terms
// of `dot` and `wedge` (see vec.ts) the definitions that people think of as
// 2D turn out to hold unchanged in any dimension. "Parallel" is "the wedge
// vanishes" whether that wedge has one component or three. Where a relation
// is genuinely 2D-only it says so and throws, rather than pretending —
// same call the `horizontal`/`vertical` pair in basic.ts makes.

import type { Model } from "../model.ts";
import { dot, norm, vecSub, wedge, wedgeNorm } from "./vec.ts";
import { coincident } from "./basic.ts";

/**
 * A line's endpoint variables, resolved *lazily*. Every line-taking relation
 * below declares its variables through one of these thunks rather than a
 * captured list, so a relation genuinely means "this line" — if an operation
 * later re-points the line at a different endpoint (a fillet trimming a
 * corner back), the relation follows it instead of going on constraining
 * whichever points the line happened to have when it was written.
 *
 * `model.line()` is re-run each evaluation, which also means a relation on a
 * line that is later removed fails loudly rather than reading stale indices.
 */
function lineVars(model: Model, lineName: string): () => number[] {
  model.line(lineName); // fail now, not at the first solve, if the name is wrong
  return () => {
    const l = model.line(lineName);
    return [...model.point(l.refs[0]).varIndices, ...model.point(l.refs[1]).varIndices];
  };
}

/** Concatenates several lazy variable lists into one. */
function joinVars(...parts: (number[] | (() => number[]))[]): () => number[] {
  return () => parts.flatMap((p) => (typeof p === "function" ? p() : p));
}

/** Splits a flat Dual array into `count` vectors of `dim` each. */
function chunk<T>(flat: T[], dim: number, count: number): T[][] {
  return Array.from({ length: count }, (_, k) => flat.slice(k * dim, (k + 1) * dim));
}

/** Two lines point the same way (or exactly opposite): their wedge vanishes. */
export function parallel(model: Model, l1: string, l2: string): void {
  const dim = model.dim;
  model.problem.addResidual(joinVars(lineVars(model, l1), lineVars(model, l2)), (l) => {
    const [a, b, c, d] = chunk(l, dim, 4);
    return wedge(vecSub(b, a), vecSub(d, c));
  }, `par(${l1},${l2})`);
}

/** Two lines meet at a right angle: their directions' dot product vanishes. */
export function perpendicular(model: Model, l1: string, l2: string): void {
  const dim = model.dim;
  model.problem.addResidual(joinVars(lineVars(model, l1), lineVars(model, l2)), (l) => {
    const [a, b, c, d] = chunk(l, dim, 4);
    return [dot(vecSub(b, a), vecSub(d, c))];
  }, `perp(${l1},${l2})`);
}

/**
 * The angle between two lines, in radians. Unsigned — this is the angle
 * between the two directions as undirected lines would have it, because
 * a *signed* angle needs an orientation, which only exists in 2D. Stated
 * as u·v = |u||v|cos(theta) rather than by taking an arccos, so the
 * residual stays smooth everywhere including at 0 and pi.
 */
export function angle(model: Model, l1: string, l2: string, radians: number): void {
  const dim = model.dim;
  const target = Math.cos(radians);
  model.problem.addResidual(joinVars(lineVars(model, l1), lineVars(model, l2)), (l) => {
    const [a, b, c, d] = chunk(l, dim, 4);
    const u = vecSub(b, a), v = vecSub(d, c);
    return [dot(u, v).sub(norm(u).mul(norm(v)).mul(target))];
  }, `ang(${l1},${l2})`);
}

/** A point lies somewhere on the infinite line through a line's two endpoints. */
export function pointOnLine(model: Model, pointName: string, lineName: string): void {
  const p = model.point(pointName);
  const dim = model.dim;
  model.problem.addResidual(joinVars(p.varIndices, lineVars(model, lineName)), (l) => {
    const [q, a, b] = chunk(l, dim, 3);
    return wedge(vecSub(q, a), vecSub(b, a));
  }, `on(${pointName},${lineName})`);
}

/** Two lines have the same length. */
export function equalLength(model: Model, l1: string, l2: string): void {
  const dim = model.dim;
  model.problem.addResidual(joinVars(lineVars(model, l1), lineVars(model, l2)), (l) => {
    const [a, b, c, d] = chunk(l, dim, 4);
    return [norm(vecSub(b, a)).sub(norm(vecSub(d, c)))];
  }, `eq(${l1},${l2})`);
}

// --- circles and arcs ------------------------------------------------------
// Every one of these reads the entity through model.circular(), so it accepts
// a circle or an arc interchangeably — the two differ only in whether they
// also name a start and end point.

/** Pins a circle's (or arc's) radius to a number. */
export function radius(model: Model, circleName: string, target: number): void {
  const c = model.circular(circleName);
  model.problem.addResidual([c.radiusVar], (l) => [l[0].sub(target)], `rad(${circleName})`);
}

/** A point sits on a circle's rim: its distance from the center equals the radius. */
export function onCircle(model: Model, pointName: string, circleName: string): void {
  const p = model.point(pointName);
  const c = model.circular(circleName);
  const center = model.point(c.center);
  const dim = model.dim;
  model.problem.addResidual([...p.varIndices, ...center.varIndices, c.radiusVar], (l) => {
    const [q, ctr] = chunk(l, dim, 2);
    return [norm(vecSub(q, ctr)).sub(l[2 * dim])];
  }, `oncircle(${pointName},${circleName})`);
}

/** Two circles/arcs share a center. */
export function concentric(model: Model, c1: string, c2: string): void {
  coincident(model, model.circular(c1).center, model.circular(c2).center);
}

/** Two circles/arcs have the same radius. */
export function equalRadius(model: Model, c1: string, c2: string): void {
  const a = model.circular(c1), b = model.circular(c2);
  model.problem.addResidual([a.radiusVar, b.radiusVar], (l) => [l[0].sub(l[1])], `eqrad(${c1},${c2})`);
}

/**
 * A line touches a circle exactly once: the perpendicular distance from the
 * center to the infinite line equals the radius. That distance is the wedge
 * norm over the direction length — |(ctr-a) ^ u| / |u| — which is smooth
 * here because a tangent line never passes *through* the center (the wedge
 * only vanishes when the distance is 0, and the radius is positive).
 */
export function tangent(model: Model, lineName: string, circleName: string): void {
  const c = model.circular(circleName);
  const center = model.point(c.center);
  const dim = model.dim;
  model.problem.addResidual(joinVars(lineVars(model, lineName), center.varIndices, [c.radiusVar]), (l) => {
    const [a, b, ctr] = chunk(l, dim, 3);
    const u = vecSub(b, a);
    return [wedgeNorm(vecSub(ctr, a), u).div(norm(u)).sub(l[3 * dim])];
  }, `tan(${lineName},${circleName})`);
}

// --- symmetry --------------------------------------------------------------

/**
 * Two points are mirror images across a line: their midpoint lies on the
 * line, and the segment joining them is perpendicular to it. Those two
 * conditions together are the mirror in 2D — and in 3D they are exactly a
 * half-turn about the line, which is the same relation one dimension up,
 * so this stays generic rather than being marked 2D-only.
 */
export function symmetric(model: Model, aName: string, bName: string, lineName: string): void {
  const a = model.point(aName), b = model.point(bName);
  const dim = model.dim;
  const varIndices = joinVars(a.varIndices, b.varIndices, lineVars(model, lineName));

  model.problem.addResidual(varIndices, (l) => {
    const [p, q, s, e] = chunk(l, dim, 4);
    const mid = p.map((pi, i) => pi.add(q[i]).div(2));
    return wedge(vecSub(mid, s), vecSub(e, s));
  }, `sym(${aName},${bName},${lineName})|mid`);

  model.problem.addResidual(varIndices, (l) => {
    const [p, q, s, e] = chunk(l, dim, 4);
    return [dot(vecSub(q, p), vecSub(e, s))];
  }, `sym(${aName},${bName},${lineName})|perp`);
}

// --- arcs ------------------------------------------------------------------

/**
 * What makes an arc's endpoints *its* endpoints: both lie on its circle.
 * Not applied by Model.addArc for the same reason a Line doesn't imply
 * hor/ver — the model holds structure, relations hold equations — so a
 * tool that creates an arc calls this straight after.
 */
export function arcEndpoints(model: Model, arcName: string): void {
  const a = model.arc(arcName);
  onCircle(model, a.start, arcName);
  onCircle(model, a.end, arcName);
}
