// The dimensions the sketch vocabulary lacked until the dimension tool had to
// dimension virtually anything (docs/plans/smart-dimension.md): a distance
// along one direction (SolidWorks' horizontal and vertical dimensions), the
// angle at a vertex between two points, and an arc's length. Each is one
// `model.relation`, one residual block, d-named, and `set` re-runs it.
//
// Generic over the model's dimension, through `dot` — proved in 2D and 3D by
// test/smartdimension.test.ts — except `arclen`, which reads an arc's sweep:
// its sign is about the arc's own normal, which a 2D arc takes as +z.

import { Dual } from "../kernel/dual.ts";
import type { Model } from "../model.ts";
import { curveNormal, directionOf, fadeUnder, frameBasis, joinVars, lengthBefore, rowLength, unitDuals } from "./refs.ts";
import { angleBetween, dot, unit, vecSub, wedge } from "./vec.ts";

function requireLength(op: string, v: unknown): number {
  if (typeof v !== "number" || !Number.isFinite(v) || v < 0) throw new Error(`${op} needs a length of 0 or more, got ${JSON.stringify(v)}`);
  return v;
}

/**
 * **`along(a, b, axis, d)`** — how far apart two points are measured along
 * one direction: a frame's axis (`"origin.x"`), or a line's. What SolidWorks
 * calls a horizontal or a vertical dimension, chosen by where its label is
 * put; here the direction is named, because there is no privileged pair
 * (a sketch on a tilted face has its own x and y — `Model.axisRef`).
 *
 * |(b − a) · û| − d, û the direction normalised: linear in the points, and not
 * a square. An axis is a datum, read and never pushed (`directionOf`); a line
 * named instead turns to meet it.
 */
export function distAlong(model: Model, a: string, b: string, axis: string, target: number): string {
  requireLength("along", target);
  // `a` may be a frame — its origin, read as a datum, as every frame is: a
  // point's distance from an axis is its distance from the origin along the
  // other one (what the dimension tool types for a point and an axis).
  const origin = model.isFrame(a) ? frameBasis(model, a) : null;
  const A = origin ? null : model.point(a), B = model.point(b);
  const dir = directionOf(model, axis);
  return model.relation("distAlong", [a, b, axis, target], () => {
    const dim = model.dim;
    const own = A ? [...A.varIndices] : [];
    model.addResidual(joinVars([...own, ...B.varIndices], dir.vars), (l) => {
      const at = A ? l.slice(0, dim) : origin!().origin.slice(0, dim).map((x) => Dual.constant(x));
      const off = own.length;
      const d = vecSub(l.slice(off, off + dim), at);
      const u = unitDuals(dir.direction(l.slice(off + dim)));
      const s = dot(d, u);
      return [(s.val < 0 ? s.neg() : s).sub(target)];
    }, `along(${a},${b},${axis})`);
  });
}

/**
 * **`ang3(v, a, b, θ)`** — the angle at vertex `v` between the directions to
 * `a` and to `b`, in radians, unsigned: the angle itself less θ, `ang`'s
 * form (`angleBetween`), nowhere a square. SolidWorks' three-point angle.
 */
export function angle3(model: Model, v: string, a: string, b: string, radians: number): string {
  if (typeof radians !== "number" || !Number.isFinite(radians)) throw new Error(`ang3 needs an angle in radians, got ${JSON.stringify(radians)}`);
  const pts = [v, a, b].map((n) => model.point(n));
  if (new Set([v, a, b]).size < 3) throw new Error("ang3 takes three different points: the vertex, then one on each side");
  return model.relation("angle3", [v, a, b, radians], () => {
    const dim = model.dim;
    const target = Math.acos(Math.max(-1, Math.min(1, Math.cos(radians))));
    model.addResidual(pts.flatMap((p) => p.varIndices), (l) => {
      const [V, P, Q] = [l.slice(0, dim), l.slice(dim, 2 * dim), l.slice(2 * dim)];
      // As `ang` (docs/plans/review-solver.md): the angle between the two
      // arms at unit length, less the one asked for, times the longer arm as
      // the solve began. Raw — u·w − |u||w|cos θ — it is a product with both
      // arms' lengths, and the solve met part of an angle by changing them.
      const floor = model.lengthFloor();
      const [iv, ia, ib] = pts.map((p) => p.varIndices);
      const k = rowLength(lengthBefore(model, [...iv, ...ia]), lengthBefore(model, [...iv, ...ib]));
      const [u, w] = [vecSub(P, V), vecSub(Q, V)];
      return [fadeUnder(angleBetween(unit(u, floor), unit(w, floor)).sub(target).mul(k), floor, u, w)];
    }, `ang3(${v},${a},${b})`);
  });
}

/**
 * An arc's sweep from start to end, counter-clockwise about its normal (+z in
 * 2D), in [0, 2π): atan2 of the wedge along the normal and the dot.
 */
function sweepOf(u: Dual[], w: Dual[], n: Dual[] | null): Dual {
  const sin = n === null ? wedge(u, w)[0] : dot([
    u[1].mul(w[2]).sub(u[2].mul(w[1])), u[2].mul(w[0]).sub(u[0].mul(w[2])), u[0].mul(w[1]).sub(u[1].mul(w[0])),
  ], n);
  const t = sin.atan2(dot(u, w));
  return t.val < 0 ? t.add(2 * Math.PI) : t;
}

/**
 * **`arclen(arc, L)`** — an arc's length, r·θ with θ its sweep start to end.
 * Reads the arc's radius variable and its three points (its ends held on it
 * by `arcends`), and in 3D its normal; linear in the radius and smooth in
 * the sweep everywhere but a whole turn, which an arc is not.
 */
export function arcLength(model: Model, arc: string, target: number): string {
  requireLength("arclen", target);
  const e = model.arc(arc);
  const normal = curveNormal(model, arc);
  return model.relation("arcLength", [arc, target], () => {
    const dim = model.dim;
    const pts = () => {
      const a = model.arc(arc);
      return [a.radiusVar, ...model.point(a.center).varIndices, ...model.point(a.start).varIndices, ...model.point(a.end).varIndices];
    };
    model.addResidual(normal ? joinVars(pts, normal) : pts, (l) => {
      const r = l[0];
      const [c, s, t] = [l.slice(1, 1 + dim), l.slice(1 + dim, 1 + 2 * dim), l.slice(1 + 2 * dim, 1 + 3 * dim)];
      const n = normal ? unitDuals(l.slice(1 + 3 * dim)) : null;
      const theta = sweepOf(vecSub(s, c), vecSub(t, c), n);
      return [r.abs().mul(theta).sub(target)];
    }, `arclen(${e.name})`);
  });
}

/** An arc's length now: what `arclen` holds. */
export function arcLengthNow(model: Model, arc: string): number {
  const a = model.arc(arc);
  const k = (n: string) => model.coords(n).map((x) => Dual.constant(x));
  const n = model.dim === 3 ? model.normalOf(arc).map((x) => Dual.constant(x)) : null;
  const theta = sweepOf(vecSub(k(a.start), k(a.center)), vecSub(k(a.end), k(a.center)), n);
  return Math.abs(model.radius(arc)) * theta.val;
}
