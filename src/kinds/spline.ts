// The spline's **structure** (docs/plans/spline.md), as the sketch module
// declares it through the entity extension point (docs/plans/workbenches.md),
// beside the ellipse's (kinds/ellipse.ts). It sits at the model's height — it
// imports the model and the plain B-spline arithmetic (../bspline.ts) and
// nothing above — so the relations can import it as they import the model.
//
// **What a spline is.** A list of **through-points** — ordinary points, which
// the user drags, snaps, `coin`s and dimensions like any other — and the
// variables of the control points between them that the curve is solved for:
// a cubic B-spline *interpolating* its points (Onshape's spline), open or
// closed. The equations that tie those control points to the through-points
// are the spline's own definition, not relations a user put on it, so the
// entity **owns** them: added with it (relations/spline.ts's `addSpline`), not
// named, not listed by `rels()`, not deletable on their own, removed with it
// (`EntityKindSpec.owns`, model.ts's `deleteEntity`) and replayed with it —
// one journal entry, `addSpline`, re-makes the entity and its equations
// together. What a user can say about a spline is said with ordinary relations
// on its points, and `onspline`/`tan` on the curve.
//
// It carries **no normal** (a deviation from the plan, which gave it a
// circle's three): its control points are affine combinations of its
// through-points, so a spline whose points lie in a plane lies in that plane
// whatever is solved, and a tool holds it on its sketch plane by holding its
// points there (`onplane`), as it holds a line's. A normal would be three more
// variables only a `par` could hold, saying what the points already say.

import { distanceMeasure, entityKind, type EntityKindSpec, type Entity, type Measure, type Model } from "../model.ts";
import type { BlockHandle } from "../kernel/problem.ts";
import { DEGREE, fewestPoints, gapOf, interpolate, knotsOf, layout, numericGaps, type BSpline } from "../bspline.ts";

/**
 * A spline: its through-points in order, whether it closes back on its first,
 * and the variables of the control points it solves for — `dim` per control
 * point, the layout's unknowns in order (../bspline.ts's `layout`): n for an
 * open spline of n points, n + 1 for a closed one.
 */
export interface SplineEntity {
  kind: "spline";
  name: string;
  /** The through-points, in the curve's own direction. */
  points: string[];
  /** Closed back on its first point, C² across the seam. Absent when open. */
  closed?: true;
  /** The solved control points' variables, flat: unknown k's coordinate i at `k·dim + i`. */
  ctrl: number[];
  /** Construction geometry: forms no regions. Absent when not. */
  construction?: true;
  /**
   * The interpolation's residual blocks — the spline's own (`owns`), never a
   * relation's. Re-made by every `addSpline` a replay runs; never saved.
   */
  blocks: BlockHandle[];
}

declare module "../model.ts" {
  interface EntityTypes {
    spline: SplineEntity;
  }
}

/** The spline's structure: what the model asks of the kind (`EntityKindSpec`). */
export const SPLINE_STRUCTURE: EntityKindSpec = {
  kind: "spline",
  noun: "a spline",
  refs: (e) => [...new Set((e as SplineEntity).points)],
  vars: (e) => (e as SplineEntity).ctrl,
  curve: true,
  closed: (e) => (e as SplineEntity).closed === true,
  ends: (e) => {
    const s = e as SplineEntity;
    return s.closed ? null : [s.points[0], s.points[s.points.length - 1]];
  },
  heldBy: ["onSpline"],
  // Every through-point is on the curve: what the regions cut it at where a
  // chord or another edge meets it (found by a test: such a chord split nothing).
  through: (e) => (e as SplineEntity).points,
  owns: (e) => (e as SplineEntity).blocks,
  // The spacing between consecutive through-points, round the seam of a
  // closed one: two run together is a spline with a kink it never had
  // (docs/plans/conflict-detection.md), as `checkSpline` refuses to draw one.
  measures: (model, e) => {
    const s = e as SplineEntity;
    const n = s.points.length;
    const out: Measure[] = [];
    for (let k = 0; k < (s.closed ? n : n - 1); k++) {
      out.push(distanceMeasure(model.point(s.points[k]).varIndices, model.point(s.points[(k + 1) % n]).varIndices));
    }
    return out;
  },
};

/** The spline called `name`, or a refusal saying it is not one. */
export function splineOf(model: Model, name: string): SplineEntity {
  const e = model.entities.get(name);
  if (!e || e.kind !== "spline") throw new Error(`"${name}" is not a spline`);
  return e;
}

/**
 * The refusals a new spline makes about its points, made first so a refused
 * call leaves nothing behind: real points, enough of them, no two in a row the
 * same point or in the same place, none twice in a closed one — and a model
 * of two dimensions or more (a spline is the same curve in any of them).
 */
export function checkSpline(model: Model, points: unknown, closed?: unknown): void {
  if (!Array.isArray(points) || points.some((p) => typeof p !== "string")) {
    throw new Error(`a spline goes through points, named — spline("p1", "p2", "p3"), got ${JSON.stringify(points)}`);
  }
  if (closed != null && typeof closed !== "boolean") throw new Error(`a spline's closed is true or false, got ${JSON.stringify(closed)}`);
  const shut = closed === true;
  if (points.length < fewestPoints(shut)) {
    throw new Error(`a${shut ? " closed" : "n open"} spline goes through at least ${fewestPoints(shut)} points — ${points.length} given`);
  }
  for (const p of points as string[]) model.point(p);
  if (model.dim < 2) throw new Error(`a spline is a curve — a ${model.dim}D model has no room to bend one`);
  const n = points.length;
  for (let k = 0; k < (shut ? n : n - 1); k++) {
    const [a, b] = [points[k] as string, points[(k + 1) % n] as string];
    if (a === b) throw new Error(`a spline runs from one point to the next — "${a}" twice in a row goes nowhere`);
    const d = Math.hypot(...model.coords(a).map((v, i) => v - model.coords(b)[i]));
    if (!(d > 1e-9)) throw new Error(`"${a}" and "${b}" are in one place — a spline needs its points in a row apart`);
  }
  // Each point once: a closed spline closes on its first by itself, and a point
  // twice would be one set of coordinates read as two places on the curve.
  if (new Set(points).size !== n) {
    throw new Error(shut ? "a closed spline goes through each point once — it closes on its first by itself"
      : "a spline goes through each point once — a curve back through a point is two splines, or a closed one");
  }
  if (!entityKind("spline")) throw new Error("the spline is the sketch module's, and it is not loaded");
}

/**
 * A new spline's entity, its control variables seeded on the curve its points
 * make now (../bspline.ts's `interpolate`), claimed and placed — the structure
 * only. Its equations are added by relations/spline.ts's `addSpline`, which is
 * what everything calls; this is its first half.
 */
export function placeSpline(model: Model, points: readonly string[], closed: boolean, name?: string | null): SplineEntity {
  const at = points.map((p) => model.coords(p));
  const curve = interpolate(at, closed);
  const L = layout(points.length, closed);
  const ctrl: number[] = [];
  L.ctrl.forEach((c, k) => { if ("unknown" in c) for (const x of curve.ctrl[k]) ctrl.push(model.problem.addVar(x)); });
  // `sp`, not `s`: a surface is `s1` (docs/plans/surfaces.md), and the shared
  // verbs tell a surface by that name alone.
  const [nm] = model.claimFirst("sp", name, () => null);
  const ent: SplineEntity = { kind: "spline", name: nm, points: [...points], ctrl, blocks: [] };
  if (closed) ent.closed = true;
  model.place(ent as unknown as Entity);
  return ent;
}

/**
 * The spline as it stands, as a plain B-spline in the model's coordinates:
 * the through-points where they are and the control variables as solved, the
 * knots read off the points (centripetal, ../bspline.ts). What everything that
 * draws, picks, loops, sweeps and writes a spline reads.
 */
export function splineCurve(model: Model, name: string): BSpline & { closed: boolean } {
  const s = splineOf(model, name);
  const L = layout(s.points.length, s.closed === true);
  const at = s.points.map((p) => model.coords(p));
  const dim = model.dim;
  const ctrl = L.ctrl.map((c) => ("unknown" in c
    ? Array.from({ length: dim }, (_, i) => model.problem.getVar(s.ctrl[c.unknown * dim + i]))
    : at[c.point].slice()));
  return { degree: DEGREE, knots: knotsOf(numericGaps(L, at)), ctrl, closed: s.closed === true };
}

/** The parameter, as a fraction of the curve, at which its k-th through-point lies. */
export function throughFraction(model: Model, name: string, k: number): number {
  const s = splineOf(model, name);
  const at = s.points.map((p) => model.coords(p));
  const n = at.length;
  let before = 0, total = 0;
  const spans = s.closed ? n : n - 1;
  for (let j = 0; j < spans; j++) {
    const g = gapOf(at[j], at[(j + 1) % n]);
    if (j < k) before += g;
    total += g;
  }
  return total > 0 ? before / total : 0;
}

/** The variables a spline owns — its control points' — for the diagnosis and the saved values. */
export function splineVars(model: Model, name: string): number[] {
  return splineOf(model, name).ctrl;
}

