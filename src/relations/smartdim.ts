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
import { chunk, curveNormal, directionOf, frameBasis, joinVars, lineVars, unitDuals } from "./refs.ts";
import { dot, norm, vecSub, wedge } from "./vec.ts";

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
 * `a` and to `b`, in radians, unsigned: u·w = |u||w| cos θ, `ang`'s form, so
 * smooth at 0 and π and nowhere a square. SolidWorks' three-point angle.
 */
export function angle3(model: Model, v: string, a: string, b: string, radians: number): string {
  if (typeof radians !== "number" || !Number.isFinite(radians)) throw new Error(`ang3 needs an angle in radians, got ${JSON.stringify(radians)}`);
  const pts = [v, a, b].map((n) => model.point(n));
  if (new Set([v, a, b]).size < 3) throw new Error("ang3 takes three different points: the vertex, then one on each side");
  return model.relation("angle3", [v, a, b, radians], () => {
    const dim = model.dim;
    const target = Math.cos(radians);
    model.addResidual(pts.flatMap((p) => p.varIndices), (l) => {
      const [V, P, Q] = [l.slice(0, dim), l.slice(dim, 2 * dim), l.slice(2 * dim)];
      const u = vecSub(P, V), w = vecSub(Q, V);
      return [dot(u, w).sub(norm(u).mul(norm(w)).mul(target))];
    }, `ang3(${v},${a},${b})`);
  });
}

/**
 * Which end of each of two lines is at the corner they make: the point they
 * share, by name, where they share one; else the two ends nearest each other
 * as the drawing stands — the tangent points either side of a fillet that
 * rounded the corner off, whose lines still make it. `at` is the four ends,
 * the first line's then the second's.
 */
function cornerEnds(model: Model, l1: string, l2: string, at: number[][]): [number, number] {
  const [r1, r2] = [model.line(l1).refs, model.line(l2).refs];
  let best: [number, number] = [0, 0];
  let least = Infinity;
  for (const i of [0, 1]) {
    for (const j of [0, 1]) {
      if (r1[i] === r2[j]) return [i, j];
      const d = Math.hypot(...at[i].map((x, k) => x - at[2 + j][k]));
      if (d < least) [least, best] = [d, [i, j]];
    }
  }
  return best;
}

/**
 * **`corner(l1, l2, θ)`** — the angle in the corner two lines make, in
 * radians: each line taken as it leaves the corner, so a wedge's sharp edge
 * reads 30° whichever way round its two lines were drawn. `ang(l1, l2, θ)` is
 * the angle between the lines' own directions, which for two sides of a
 * profile drawn head to tail is the other one, 150°.
 *
 * What the dimension tool holds between **two meeting walls of a solid**
 * (docs/plans/review-relations.md): the lines the walls are swept from, by
 * name, read lazily (`lineVars`) — where it used to hold `ang3` of the corner
 * point and the two far ends, three points, which a fillet of that corner
 * re-points out from under it. The corner is found each time the relation is
 * read (`cornerEnds`), so it follows a line an operation re-points.
 *
 * u·w = |u||w| cos θ, `ang`'s form: smooth at 0 and π, nowhere a square, and
 * the same in any dimension (test/reviewrelations.test.ts: 2D and 3D).
 */
export function cornerAngle(model: Model, l1: string, l2: string, radians: number): string {
  if (typeof radians !== "number" || !Number.isFinite(radians)) throw new Error(`corner needs an angle in radians, got ${JSON.stringify(radians)}`);
  model.line(l1);
  model.line(l2);
  if (l1 === l2) throw new Error(`corner takes the two lines that make it: ${l1} twice is one`);
  return model.relation("cornerAngle", [l1, l2, radians], () => {
    const dim = model.dim;
    const target = Math.cos(radians);
    model.addResidual(joinVars(lineVars(model, l1), lineVars(model, l2)), (l) => {
      const ends = chunk(l, dim, 4);
      const [i, j] = cornerEnds(model, l1, l2, ends.map((p) => p.map((x) => x.val)));
      const u = vecSub(ends[1 - i], ends[i]), w = vecSub(ends[3 - j], ends[2 + j]);
      return [dot(u, w).sub(norm(u).mul(norm(w)).mul(target))];
    }, `corner(${l1},${l2})`);
  });
}

/** The corner two lines make, now: where it is, the unit ray along each line out of it, and its angle in radians — what `corner` holds. */
export function cornerNow(model: Model, l1: string, l2: string): { at: number[]; rays: [number[], number[]]; angle: number } {
  const ends = [...model.line(l1).refs, ...model.line(l2).refs].map((p) => model.coords(p));
  const [i, j] = cornerEnds(model, l1, l2, ends);
  const ray = (from: number[], to: number[]) => {
    const d = to.map((x, k) => x - from[k]);
    const len = Math.hypot(...d);
    return len > 0 ? d.map((x) => x / len) : d;
  };
  const rays: [number[], number[]] = [ray(ends[i], ends[1 - i]), ray(ends[2 + j], ends[3 - j])];
  const cos = rays[0].reduce((s, x, k) => s + x * rays[1][k], 0);
  return { at: ends[i], rays, angle: Math.acos(Math.max(-1, Math.min(1, cos))) };
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
