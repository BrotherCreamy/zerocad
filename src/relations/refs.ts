// The lazy-variable plumbing every relation is written through.
//
// A relation declares *which variables it reads* either as a captured list or
// as a thunk re-consulted at every evaluation. The thunk form is the house
// rule for anything whose subject can be restructured underneath it: `hor(l1)`
// means "this edge is level", so if a fillet re-points that edge at a new
// tangent point the constraint has to follow. A captured index list cannot; a
// thunk that re-reads the entity's current refs can. This was learned the hard
// way — the fillet's first version passed every numerical check to six decimals
// while visibly wrecking the rectangle it was applied to.
//
// These live in their own file because both relation modules need them:
// geometry.ts has always used `lineVars`, and basic.ts needs `frameVars` for
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

/** A frame's origin and its two unit axes, as plain numbers. */
export interface FrameBasis {
  origin: number[];
  /** +x, unit length. */
  ux: number[];
  /** +y — +x turned a quarter turn counter-clockwise. */
  uy: number[];
}

/**
 * Below this the frame's two points count as collapsed, and it has no
 * direction to offer. See `frameBasis`.
 */
const DEGENERATE_FRAME = 1e-9;

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
 * solver handed `hor(line, frame)` would then be free to satisfy it by turning
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
 * The floor on the arm's length is what a collapsed frame gets instead of a
 * division by zero; NaN in a Jacobian does not fail loudly, it fails as a
 * solve that quietly stops converging everywhere at once. Floored, `fix`
 * degrades to "sit on the origin" and `hor`/`ver` to a claim about a direction
 * that is no longer there. `addFrame` seeds its two points a span apart so
 * this cannot arise by construction; it can only be dragged into.
 */
export function frameBasis(model: Model, frameName: string): () => FrameBasis {
  model.frame(frameName); // fail now, not at the first solve
  return () => {
    const f = model.frame(frameName);
    const o = model.coords(f.origin);
    const x = model.coords(f.xref);
    const d = [x[0] - o[0], x[1] - o[1]];
    const len = Math.hypot(d[0], d[1]);
    const ux = len < DEGENERATE_FRAME ? [0, 0] : [d[0] / len, d[1] / len];
    return { origin: o, ux, uy: [-ux[1], ux[0]] };
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
  // Frames are 2D-only (an origin plus one direction leaves a rotation free
  // above that), so their axes are too. Said here rather than left to
  // `model.frame` so the message names what was actually written.
  if (model.dim !== 2) throw new Error(`"${ref}": a frame is a 2D entity, so its axes are too`);
  const basis = frameBasis(model, axis.frame);
  return {
    width: 0,
    vars: () => [],
    direction: () => {
      const b = basis();
      return (axis.axis === "x" ? b.ux : b.uy).map((c) => Dual.constant(c));
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
