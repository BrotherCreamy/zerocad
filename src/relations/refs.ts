// The lazy-variable plumbing every relation is written through.
//
// A relation declares *which variables it reads* either as a captured list or
// as a thunk re-consulted at every evaluation. The thunk form is the house
// rule for anything whose subject can be restructured underneath it:
// `par("l1", "f.x")` means "this edge is level", so if a fillet re-points that
// edge at a new tangent point the constraint has to follow. A captured index
// list cannot; a thunk that re-reads the entity's current refs can. This was learned the hard
// way — the fillet's first version passed every numerical check to six decimals
// while visibly wrecking the rectangle it was applied to.
//
// These live in their own file because both relation modules need them:
// geometry.ts has always used `lineVars`, and basic.ts needs `frameBasis` for
// the same reason and would otherwise have to import from geometry.ts, which
// imports it back.

import { Dual } from "../kernel/dual.ts";
import { parseAxisRef, type Model } from "../model.ts";
import { vecSub } from "./vec.ts";

/**
 * A line's endpoint variables, resolved lazily. `model.line()` is re-run each
 * evaluation, which also means a relation on a line that is later removed
 * fails loudly rather than reading stale indices.
 */
export function lineVars(model: Model, lineName: string): () => number[] {
  model.line(lineName); // fail now, not at the first solve, if the name is wrong
  return () => {
    const l = model.line(lineName);
    return [...model.point(l.refs[0]).varIndices, ...model.point(l.refs[1]).varIndices];
  };
}

/** A frame's origin and its unit axes, as plain numbers. */
export interface FrameBasis {
  origin: number[];
  /** +x, unit length. */
  ux: number[];
  /**
   * +y. In 2D, +x turned a quarter turn counter-clockwise; in 3D, the y-ref's
   * direction straightened against +x (see `frameBasis`).
   */
  uy: number[];
  /** +z = +x × +y, the normal to a 3D frame's plane. Null in 2D, which has none. */
  uz: number[] | null;
  /**
   * The same unit axes in order, one per coordinate a position in this frame
   * has — `[ux, uy]` in 2D, `[ux, uy, uz]` in 3D — for the code that only
   * wants "the i-th axis", which is `fix` and anything else that reads frame
   * coordinates.
   */
  axes: number[][];
}

/**
 * Below this an arm counts as collapsed, and it has no direction to offer.
 * See `frameBasis`.
 */
const DEGENERATE_FRAME = 1e-9;

const sub = (a: number[], b: number[]) => a.map((v, i) => v - b[i]);
const dotN = (a: number[], b: number[]) => a.reduce((s, v, i) => s + v * b[i], 0);
const cross = (a: number[], b: number[]) =>
  [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]];

/**
 * `v` at unit length, or the zero vector when it is shorter than `floor`. The
 * zero vector is the floor: a direction that is no longer there, rather than
 * the NaN a division by zero would leave in every Jacobian it reached.
 */
function unitOrZero(v: number[], floor: number): number[] {
  const len = Math.hypot(...v);
  return len < floor ? v.map(() => 0) : v.map((c) => c / len);
}

/**
 * Where a frame is and which way it is turned, re-read at every evaluation —
 * lazily, for the reason a line's endpoints are, and then some: a frame's two
 * points are ordinary points that an operation may re-target or a user may
 * drag, and a relation written against the frame means "this frame", not
 * "wherever this frame's points were when I was typed".
 *
 * **The frame is read as a value, not declared as a variable, and that is a
 * decision rather than an oversight.** A residual block names the variables it
 * reads; naming the frame's two points would put them in the Jacobian, and a
 * solver handed `par(line, "f.x")` would then be free to satisfy it by turning
 * the *frame* instead of the line — which, measured, is exactly what it does:
 * on a 40-unit line seven units out of level against a frame with a 20-unit
 * arm, least squares turns the frame 8° and the line barely at all. A frame
 * that the drawing pushes around is not a datum, and a datum is the whole of
 * what a frame is for. It also makes the package's own acceptance test true:
 * a drawing levelled against a tilted frame settles at *exactly* the frame's
 * tilt, rather than somewhere between the frame's tilt and its own.
 *
 * So a frame moves only when something moves it — a drag, a dimension, a user.
 * The geometry then follows within the same solve, because this thunk is
 * re-read at every evaluation. The cost is that the Jacobian row is exact for
 * the block as declared rather than for every number the residual touches,
 * which costs nothing in a solve where the frame is not itself moving and
 * behaves as one Gauss-Seidel sweep in a solve where it is.
 *
 * **In 3D the y-ref is straightened, not obeyed.** +x is the x-ref's direction,
 * as in 2D. +y is the y-ref's direction with its +x component taken out
 * (Gram–Schmidt) and renormalised, and +z is +x × +y. So the y-ref fixes the
 * *plane* — the one through the origin containing both refs — and *which side*
 * of +x is +y, and nothing else: it need not sit square to the x-ref, and
 * moving it anywhere in its own half of that plane changes no axis at all.
 * That is the reading a user drawing a sketch plane wants (three clicks that
 * are roughly an L give an exact frame), and it is why a 3D frame can never be
 * skewed — the axes handed out are orthonormal and right-handed by
 * construction, so `fix` and `onPlane` mean the distances they say.
 *
 * The floor on an arm's length is what a collapsed frame gets instead of a
 * division by zero; NaN in a Jacobian does not fail loudly, it fails as a
 * solve that quietly stops converging everywhere at once. Floored, `fix`
 * degrades to "sit on the origin" and an axis reference to a claim about a
 * direction that is no longer there. 3D has more ways to collapse and each
 * gets that same treatment, axis by axis rather than all at once: an x-ref on
 * the origin floors +x (and so +z), and +y is then the y-ref's raw direction,
 * there being nothing to straighten it against; a y-ref on the origin *or on
 * the frame's own x axis* has no plane to offer, so +y and +z floor and +x —
 * still perfectly well defined — survives. The y floor is scaled by the arm's
 * length, because what is left after taking out the +x component of an arm
 * that lies along +x is rounding error proportional to the arm, and an
 * absolute floor would eventually let that noise through as a direction.
 * Measured on a tilted frame: the remainder is 1e-15 for a 3-unit arm, 1e-10
 * for a million units, and 1.3e-7 — past an absolute 1e-9 — for a billion. Far
 * outside any drawing, and the scaled floor costs one multiplication. `addFrame`
 * seeds its points so none of this can arise by construction; it can only be
 * dragged into.
 */
export function frameBasis(model: Model, frameName: string): () => FrameBasis {
  model.frame(frameName); // fail now, not at the first solve
  return () => {
    const f = model.frame(frameName);
    const o = model.coords(f.origin);
    const ux = unitOrZero(sub(model.coords(f.xref), o), DEGENERATE_FRAME);
    if (f.yref === undefined) {
      // 2D: +y is +x turned a quarter turn counter-clockwise, and that is the
      // whole of the frame.
      const uy = [-ux[1], ux[0]];
      return { origin: o, ux, uy, uz: null, axes: [ux, uy] };
    }
    const arm = sub(model.coords(f.yref), o);
    const along = dotN(arm, ux);
    const straight = arm.map((v, i) => v - along * ux[i]);
    const uy = unitOrZero(straight, DEGENERATE_FRAME * Math.max(1, Math.hypot(...arm)));
    const uz = cross(ux, uy);
    return { origin: o, ux, uy, uz, axes: [ux, uy, uz] };
  };
}

// --- directions ------------------------------------------------------------
//
// `par`, `perp` and `ang` are claims about *directions* and nothing else, and
// a direction can come from three places: a line, two named points, or a
// frame's axis. `directionOf` is the one place that turns a written reference
// into one, which is what keeps `"f1.x"` from being parsed in five files with
// four slightly different answers.

/**
 * One side of a direction relation, ready to be joined into a residual.
 *
 * The three constructors below differ in exactly one way that matters, and it
 * is the datum decision the frames package settled: a line or a point pair
 * contributes *variables*, so the solver may move it to satisfy the relation,
 * while a frame axis contributes none and therefore never moves. `par(l1, l2)`
 * turns both lines; `par(l1, "f1.x")` turns only the line, which is precisely
 * what `hor` did and precisely what a datum means. The asymmetry is visible
 * right here, in `width: 0` and in a direction built out of
 * `Dual.constant` — a constant carries an empty gradient, so the frame is
 * absent from the Jacobian as a matter of arithmetic rather than of
 * bookkeeping anyone has to remember.
 */
export interface DirectionRef {
  /** How many of the residual's Duals belong to this side. Zero for an axis. */
  width: number;
  /** Those variables, lazily — so this side follows a line that is re-pointed. */
  vars: () => number[];
  /** This side's direction, given exactly its own `width` Duals. */
  direction: (own: Dual[]) => Dual[];
  /** The frame an axis reference reads, or null when this side is geometry. */
  frame: string | null;
}

/** The direction from the first `dim` Duals to the second — a line or a point pair. */
function fromEnds(dim: number, vars: () => number[]): DirectionRef {
  return {
    width: 2 * dim,
    vars,
    direction: (own) => vecSub(own.slice(dim), own.slice(0, dim)),
    frame: null,
  };
}

/**
 * The direction a written reference denotes: a line's, or a frame axis's.
 *
 * A frame's axis arrives **normalised**, from `frameBasis`. That is not
 * cosmetic — it is the rule `hor`/`ver` established and the register records
 * why: with a raw arm the solver can shrink the frame to make a wedge smaller
 * and call the relation satisfied. It also puts the residual on exactly the
 * scale `hor` had (|d|·sin), so `par(l, "f.x")` is numerically the same
 * equation `hor(l, f)` was, and the frames package's closed-form tests hold to
 * the same tolerances in the new spelling.
 *
 * A collapsed frame has no direction to offer and `frameBasis` floors it to
 * the zero vector rather than dividing by zero, so an axis reference against
 * one degrades to a residual that is trivially satisfied — a claim about a
 * direction that is no longer there. The same degradation `hor` had, and for
 * the same reason: NaN in a Jacobian does not fail loudly.
 */
export function directionOf(model: Model, ref: string): DirectionRef {
  const axis = parseAxisRef(ref);
  if (!axis) return fromEnds(model.dim, lineVars(model, ref));
  // A 2D frame has no z. Said here, before the frame is even looked up, so the
  // message names what was actually written rather than whatever goes wrong
  // further down.
  model.requireAxis(axis.axis, ref);
  const basis = frameBasis(model, axis.frame);
  return {
    width: 0,
    vars: () => [],
    direction: () => {
      const b = basis();
      // `uz` is non-null whenever "z" got past `requireAxis`: only a 3D model
      // lets it through, and every frame in a 3D model has a y-ref.
      const u = axis.axis === "x" ? b.ux : axis.axis === "y" ? b.uy : b.uz!;
      return u.map((c) => Dual.constant(c));
    },
    frame: axis.frame,
  };
}

/**
 * The direction between two named points — the form that pins *those two
 * points* rather than following an edge.
 *
 * Kept because it is a real thing to mean and not merely because `hor` had it:
 * "these two corners are level with each other" is a claim about the corners.
 * The line form is still the one to prefer for anything that is a property of
 * an edge, since it survives a fillet re-pointing that edge and this does not.
 */
export function directionOfPoints(model: Model, aName: string, bName: string): DirectionRef {
  const a = model.point(aName), b = model.point(bName);
  return fromEnds(model.dim, () => [...a.varIndices, ...b.varIndices]);
}

/** Concatenates several lazy variable lists into one. */
export function joinVars(...parts: (number[] | (() => number[]))[]): () => number[] {
  return () => parts.flatMap((p) => (typeof p === "function" ? p() : p));
}

/** Splits a flat array into `count` vectors of `dim` each. */
export function chunk<T>(flat: T[], dim: number, count: number): T[][] {
  return Array.from({ length: count }, (_, k) => flat.slice(k * dim, (k + 1) * dim));
}
