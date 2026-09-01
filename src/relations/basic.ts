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
import type { Dual } from "../kernel/dual.ts";
import { norm, vecSub } from "./vec.ts";
import { chunk, frameBasis, lineVars, type FrameBasis } from "./refs.ts";

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

/**
 * Pins a point's position **in a frame's coordinates**: the frame's origin,
 * plus `at[0]` along its +x and `at[1]` along its +y.
 *
 * There is no world frame to pin against, which is the whole of the coordinate
 * -frames change — an origin nobody made is exactly the thing that tempts a
 * drawing into being related to a global grid. So a 2D `fix` needs a frame:
 * the one named, or the default at call time, and it throws when there is
 * neither. The journal always carries the resolved name, so a saved file never
 * depends on what the default happened to be afterwards.
 *
 * The frame is read, never pushed — see `frameBasis`. So this pins the point
 * to the frame and not the other way round, and a drawing with no frame at all
 * simply floats in the kernel's flat vector, which the damped solve is content
 * to leave where it was seeded.
 *
 * **Above 2D it keeps its old, gauge-relative meaning.** A frame is an origin
 * plus one direction, which fully determines a 2D frame and leaves a whole
 * rotation free in 3D, so `addFrame` is 2D-only — and a `fix` that could not
 * be written at all in a 3D model would take the dimension-genericity of this
 * vocabulary with it. Documented here rather than smoothed over: it is the one
 * place the gauge is still visible, and closing it needs a frame entity with
 * a second reference direction, which is a package of its own.
 */
export function fix(model: Model, name: string, at: number[], frameName?: string | null): string {
  const p = model.point(name);
  if (at.length !== p.varIndices.length) throw new Error(`fix needs ${p.varIndices.length} coordinates`);
  if (model.dim !== 2) {
    if (frameName != null) throw new Error("a frame is a 2D entity");
    return model.relation("fix", [name, at], () => {
      p.varIndices.forEach((gi, i) => {
        model.addResidual([gi], (l) => [l[0].sub(at[i])], `fix(${name}[${i}])`);
      });
    });
  }
  const frame = model.resolveFrame(frameName);
  return model.relation("fix", [name, at, frame], () => {
    const basis = frameBasis(model, frame);
    // One block per coordinate, as it always was, so an over-constrained
    // drawing still reports `fix(a[1])` rather than one lump. `at[i]` is a
    // length along an axis, so the axis has to be a unit vector — how far the
    // x-ref happens to sit from the origin must not change what [10, 0] means.
    for (let i = 0; i < 2; i++) {
      model.addResidual(p.varIndices, (l) => {
        const { origin, ux, uy } = basis();
        const axis = i === 0 ? ux : uy;
        const rel = [l[0].sub(origin[0]), l[1].sub(origin[1])];
        return [rel[0].mul(axis[0]).add(rel[1].mul(axis[1])).sub(at[i])];
      }, `fix(${name}[${i}])`);
    }
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
// "along +x" / "across +x" isn't a concept that generalizes to N dimensions,
// so unlike dist/coincident/midpoint above these deliberately don't try.
//
// **They are relative to a frame, and there is no world frame.** "Level" used
// to mean "level with the kernel's own axes"; it now means "level with this
// frame's +x", and a drawing with no frame has no way to say it at all. That
// is the point of the change rather than a side effect of it: an axis nobody
// chose is exactly what tempts a drawing into a global grid. Omitting the
// frame means the default *at call time*, and the journal records what that
// resolved to, so an entry cannot change meaning later.
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

/**
 * Along a frame's +x: `horizontal(m, "l", frame?)` for a line, or
 * `horizontal(m, "a", "b", frame?)` for two points.
 */
export function horizontal(model: Model, aName: string, bName?: string | null, frameName?: string | null): string {
  // Parallel to +x: the wedge with it vanishes.
  return axisRelation(model, "horizontal", "hor", aName, bName, frameName,
    (d, f) => [d[0].mul(f.ux[1]).sub(d[1].mul(f.ux[0]))]);
}

/**
 * Across a frame's +x — which in 2D is along its +y: `vertical(m, "l", frame?)`
 * for a line, or `vertical(m, "a", "b", frame?)` for two points.
 */
export function vertical(model: Model, aName: string, bName?: string | null, frameName?: string | null): string {
  // Perpendicular to +x: the dot with it vanishes.
  return axisRelation(model, "vertical", "ver", aName, bName, frameName,
    (d, f) => [d[0].mul(f.ux[0]).add(d[1].mul(f.ux[1]))]);
}

/**
 * The shared body of `horizontal` and `vertical`: read a direction (off a line
 * or off two points) and the frame's +x, and say how the two must relate.
 * Parallel is "the wedge vanishes", perpendicular is "the dot vanishes" —
 * both linear in each input and well away from being a square, whose gradient
 * would vanish at its own root.
 *
 * The frame's direction arrives already normalised, from `frameBasis` — and
 * that also puts the residual back on exactly the scale the pre-frames `hor`
 * had, |d|·sin, so nothing downstream that reads residual magnitudes has to be
 * re-tuned.
 */
function axisRelation(
  model: Model, op: string, tag: string,
  aName: string, bName: string | null | undefined, frameName: string | null | undefined,
  residual: (d: Dual[], f: FrameBasis) => Dual[],
): string {
  if (model.dim !== 2) throw new Error(`${op} is a 2D relation`);
  // One string argument after the subject is ambiguous on its face — second
  // point, or frame? The model settles it: the *line* form takes no second
  // point, so what follows a line name can only be a frame. Deciding on the
  // entity's kind rather than on arity is also what lets an old journal entry
  // (`horizontal("l1")`, no frame at all) reach `resolveFrame` and be told
  // exactly what it is missing.
  const lineForm = model.entities.get(aName)?.kind === "line";
  if (lineForm && bName != null && frameName != null) {
    throw new Error(`${op} on a line takes a frame, not two more names`);
  }
  const frame = model.resolveFrame(lineForm ? (bName ?? frameName) : frameName);
  const direction = lineForm ? lineVars(model, aName) : pointPairVars(model, aName, bName);
  const label = lineForm ? `${tag}(${aName})` : `${tag}(${aName},${bName})`;
  const args = lineForm ? [aName, frame] : [aName, bName, frame];
  const basis = frameBasis(model, frame);
  return model.relation(op, args, () => {
    model.addResidual(direction, (l) => {
      const [a, b] = chunk(l, 2, 2);
      return residual(vecSub(b, a), basis());
    }, `${label}|${frame}`);
  });
}

/** Both coordinates of each of two named points — the point form's direction. */
function pointPairVars(model: Model, aName: string, bName?: string | null): number[] {
  // Only reached when the first name is not a line, so the second is required.
  if (bName == null) throw new Error(`"${aName}" is not a line`);
  return [...model.point(aName).varIndices, ...model.point(bName).varIndices];
}
