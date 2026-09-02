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
import { frameBasis } from "./refs.ts";

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
 * The two forms are the same distinction `par` and `perp` make (see
 * `relations/geometry.ts`), and for the same reason: the point form captures
 * the two points it was given
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

// `horizontal` and `vertical` used to live here, taking a frame and a line or
// a pair of points. They are gone — not deprecated, gone — and the reason is
// the words rather than the mathematics.
//
// The no-world-frame package made them frame-relative, but "horizontal" still
// says that the universe hands you a privileged pair of directions, which is a
// world frame in vocabulary form. What is meant is "parallel to an axis I can
// name", so it is spelled that way: `par("l1", "f1.x")` is level,
// `par("l1", "f1.y")` is vertical, and `xaxis()`/`yaxis()` fill in the default
// frame at the command line. Both forms survived the move — a line or a pair
// of points — and so did the residuals, wedge for wedge. See
// `relations/geometry.ts` and `docs/plans/retire-hor-ver.md`.
