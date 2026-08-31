// A small starter set of relations, written generically over however many
// coordinates a point has (model.dim) — the same function handles 2D or 3D
// points without change. Each just calls model.problem.addResidual with a
// Dual-arithmetic formula; nothing here is privileged over what a user
// could write themselves at the REPL later.

import { Dual } from "../kernel/dual.ts";
import type { Model } from "../model.ts";

function vecSub(a: Dual[], b: Dual[]): Dual[] {
  return a.map((ai, i) => ai.sub(b[i]));
}

function normSquared(v: Dual[]): Dual {
  return v.reduce((acc, c) => acc.add(c.mul(c)), Dual.constant(0));
}

/** |a - b| = target */
export function dist(model: Model, aName: string, bName: string, target: number): void {
  const a = model.point(aName), b = model.point(bName);
  const dim = model.dim;
  const varIndices = [...a.varIndices, ...b.varIndices];
  model.problem.addResidual(varIndices, (l) => {
    const A = l.slice(0, dim), B = l.slice(dim);
    return [normSquared(vecSub(B, A)).sqrt().sub(target)];
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

/** same y (index 1) */
export function horizontal(model: Model, aName: string, bName: string): void {
  if (model.dim !== 2) throw new Error("horizontal is a 2D relation");
  const a = model.point(aName), b = model.point(bName);
  model.problem.addResidual([a.varIndices[1], b.varIndices[1]], (l) => [l[0].sub(l[1])], `hor(${aName},${bName})`);
}

/** same x (index 0) */
export function vertical(model: Model, aName: string, bName: string): void {
  if (model.dim !== 2) throw new Error("vertical is a 2D relation");
  const a = model.point(aName), b = model.point(bName);
  model.problem.addResidual([a.varIndices[0], b.varIndices[0]], (l) => [l[0].sub(l[1])], `ver(${aName},${bName})`);
}
