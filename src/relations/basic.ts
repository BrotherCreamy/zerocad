// A small starter set of relations, written generically over however many
// coordinates a point has (model.dim) — the same function handles 2D or 3D
// points without change. Each just adds residual blocks with a Dual-arithmetic
// formula; nothing here is privileged over what a user could write themselves
// at the REPL later.
//
// Every one of them is one call to `model.relation(op, args, body)`, which
// journals the call, gathers the blocks the body adds, and names the result
// `r1`, `r2`, … — so a relation is something you can list, see on the hover
// tag, and `del`. Relations return that name; they used to return nothing.

import type { Model } from "../model.ts";
import { norm, vecSub } from "./vec.ts";

/** |a - b| = target */
export function dist(model: Model, aName: string, bName: string, target: number): string {
  return model.relation("dist", [aName, bName, target], () => {
    const a = model.point(aName), b = model.point(bName);
    const dim = model.dim;
    const varIndices = [...a.varIndices, ...b.varIndices];
    model.addResidual(varIndices, (l) => {
      const A = l.slice(0, dim), B = l.slice(dim);
      return [norm(vecSub(B, A)).sub(target)];
    }, `dist(${aName},${bName})`);
  });
}

/** pins every coordinate of a point to fixed numbers */
export function fix(model: Model, name: string, at: number[]): string {
  return model.relation("fix", [name, at], () => {
    const p = model.point(name);
    if (at.length !== p.varIndices.length) throw new Error(`fix needs ${p.varIndices.length} coordinates`);
    p.varIndices.forEach((gi, i) => {
      model.addResidual([gi], (l) => [l[0].sub(at[i])], `fix(${name}[${i}])`);
    });
  });
}

/** a and b occupy the same point, coordinate by coordinate */
export function coincident(model: Model, aName: string, bName: string): string {
  return model.relation("coincident", [aName, bName], () => {
    const a = model.point(aName), b = model.point(bName);
    a.varIndices.forEach((gi, i) => {
      const bi = b.varIndices[i];
      model.addResidual([gi, bi], (l) => [l[0].sub(l[1])], `coin(${aName},${bName})[${i}]`);
    });
  });
}

/**
 * m is the midway point, coordinate by coordinate — of two named points
 * (`midpoint(model, "m", "a", "b")`) or of a *line* (`midpoint(model, "m", "l")`).
 *
 * The two forms are the same distinction `horizontal`/`vertical` make below,
 * and for the same reason: the point form captures the two points it was given
 * and goes on constraining them, while the line form re-reads the line's
 * endpoints at every evaluation, so a fillet re-pointing that edge takes the
 * midpoint with it. Prefer the line form when what is meant is "the middle of
 * this edge" — which is what a midpoint snap means, so that is the form
 * inference applies.
 */
export function midpoint(model: Model, mName: string, aName: string, bName?: string): string {
  const args = bName === undefined ? [mName, aName] : [mName, aName, bName];
  return model.relation("midpoint", args, () => {
    const m = model.point(mName);
    const label = bName === undefined ? `mid(${mName},${aName})` : `mid(${mName})`;
    const ends = midpointEnds(model, aName, bName);
    m.varIndices.forEach((gi, i) => {
      const vars = typeof ends === "function"
        ? () => { const [a, b] = ends(); return [gi, a[i], b[i]]; }
        : [gi, ends[0][i], ends[1][i]];
      model.addResidual(vars, (l) => [l[0].sub(l[1].add(l[2]).div(2))], `${label}[${i}]`);
    });
  });
}

/** The two points a midpoint is between: named directly, or read off a line. */
function midpointEnds(model: Model, aName: string, bName?: string): number[][] | (() => number[][]) {
  if (bName !== undefined) return [model.point(aName).varIndices, model.point(bName).varIndices];
  model.line(aName); // fail now if it isn't a line, rather than at the first solve
  return () => {
    const l = model.line(aName);
    return [model.point(l.refs[0]).varIndices, model.point(l.refs[1]).varIndices];
  };
}

// hor/ver are genuinely 2D-only (like a cross product is genuinely 3D-only) —
// "same y" / "same x" isn't a concept that generalizes to N dimensions, so
// unlike dist/fix/coincident/midpoint above these deliberately don't try.
//
// Both take either two point names or a single *line* name, because both are
// real: a sketcher either picks two points and says "level", or picks an edge
// and says "level". The forms are not interchangeable once the model starts
// changing shape, and the difference matters. The two-point form pins those
// two points forever. The line form means "this line", and resolves the
// line's endpoints at every evaluation — so if an operation re-points the
// line at a different endpoint (a fillet trimming a corner back), the
// constraint follows the line instead of being left on the old corner.
// Prefer the line form when what you mean is a property of the edge.

/** Same y: `horizontal(m, "a", "b")` for two points, or `horizontal(m, "l")` for a line. */
export function horizontal(model: Model, aName: string, bName?: string): string {
  if (model.dim !== 2) throw new Error("horizontal is a 2D relation");
  return model.relation("horizontal", bName === undefined ? [aName] : [aName, bName], () => {
    const { vars, label } = axisRefs(model, 1, "hor", aName, bName);
    model.addResidual(vars, (l) => [l[0].sub(l[1])], label);
  });
}

/** Same x: `vertical(m, "a", "b")` for two points, or `vertical(m, "l")` for a line. */
export function vertical(model: Model, aName: string, bName?: string): string {
  if (model.dim !== 2) throw new Error("vertical is a 2D relation");
  return model.relation("vertical", bName === undefined ? [aName] : [aName, bName], () => {
    const { vars, label } = axisRefs(model, 0, "ver", aName, bName);
    model.addResidual(vars, (l) => [l[0].sub(l[1])], label);
  });
}

/** The one coordinate from each of two points — named directly, or via a line. */
function axisRefs(model: Model, axis: number, tag: string, aName: string, bName?: string) {
  if (bName !== undefined) {
    const a = model.point(aName), b = model.point(bName);
    return { vars: [a.varIndices[axis], b.varIndices[axis]], label: `${tag}(${aName},${bName})` };
  }
  model.line(aName); // fail now if it isn't a line, rather than at the first solve
  return {
    vars: () => {
      const l = model.line(aName);
      return [model.point(l.refs[0]).varIndices[axis], model.point(l.refs[1]).varIndices[axis]];
    },
    label: `${tag}(${aName})`,
  };
}
