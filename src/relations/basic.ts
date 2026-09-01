// A small starter set of relations, written generically over however many
// coordinates a point has (model.dim) — the same function handles 2D or 3D
// points without change. Each just calls model.problem.addResidual with a
// Dual-arithmetic formula; nothing here is privileged over what a user
// could write themselves at the REPL later.

import type { Model } from "../model.ts";
import { norm, vecSub } from "./vec.ts";

/** |a - b| = target */
export function dist(model: Model, aName: string, bName: string, target: number): void {
  const a = model.point(aName), b = model.point(bName);
  const dim = model.dim;
  const varIndices = [...a.varIndices, ...b.varIndices];
  model.problem.addResidual(varIndices, (l) => {
    const A = l.slice(0, dim), B = l.slice(dim);
    return [norm(vecSub(B, A)).sub(target)];
  }, `dist(${aName},${bName})`);
}

/** pins every coordinate of a point to fixed numbers */
export function fix(model: Model, name: string, at: number[]): void {
  const p = model.point(name);
  if (at.length !== p.varIndices.length) throw new Error(`fix needs ${p.varIndices.length} coordinates`);
  p.varIndices.forEach((gi, i) => {
    model.problem.addResidual([gi], (l) => [l[0].sub(at[i])], `fix(${name}[${i}])`);
  });
}

/** a and b occupy the same point, coordinate by coordinate */
export function coincident(model: Model, aName: string, bName: string): void {
  const a = model.point(aName), b = model.point(bName);
  a.varIndices.forEach((gi, i) => {
    const bi = b.varIndices[i];
    model.problem.addResidual([gi, bi], (l) => [l[0].sub(l[1])], `coin(${aName},${bName})[${i}]`);
  });
}

/** m is the midpoint of a and b, coordinate by coordinate */
export function midpoint(model: Model, mName: string, aName: string, bName: string): void {
  const m = model.point(mName), a = model.point(aName), b = model.point(bName);
  m.varIndices.forEach((gi, i) => {
    const ai = a.varIndices[i], bi = b.varIndices[i];
    model.problem.addResidual([gi, ai, bi], (l) => [l[0].sub(l[1].add(l[2]).div(2))], `mid(${mName})[${i}]`);
  });
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
export function horizontal(model: Model, aName: string, bName?: string): void {
  if (model.dim !== 2) throw new Error("horizontal is a 2D relation");
  const { vars, label } = axisRefs(model, 1, "hor", aName, bName);
  model.problem.addResidual(vars, (l) => [l[0].sub(l[1])], label);
}

/** Same x: `vertical(m, "a", "b")` for two points, or `vertical(m, "l")` for a line. */
export function vertical(model: Model, aName: string, bName?: string): void {
  if (model.dim !== 2) throw new Error("vertical is a 2D relation");
  const { vars, label } = axisRefs(model, 0, "ver", aName, bName);
  model.problem.addResidual(vars, (l) => [l[0].sub(l[1])], label);
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
