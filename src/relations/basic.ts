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
import { frameBasis, planeBasis } from "./refs.ts";

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
 * How far a point sits along one of a frame's unit axes, measured from the
 * frame's origin: (p − origin) · axis, with the point as Duals and the frame as
 * plain numbers. Plain numbers are what keep the frame out of the Jacobian —
 * see `frameBasis`. Written out term by term so the 2D case is the very
 * expression `fix` always evaluated, operation for operation.
 */
function alongAxis(p: Dual[], origin: number[], axis: number[]): Dual {
  let acc = p[0].sub(origin[0]).mul(axis[0]);
  for (let k = 1; k < p.length; k++) acc = acc.add(p[k].sub(origin[k]).mul(axis[k]));
  return acc;
}

/**
 * Pins a point's position **in a frame's coordinates**: the frame's origin,
 * plus `at[0]` along its +x, `at[1]` along its +y and — in 3D — `at[2]` along
 * its +z.
 *
 * There is no world frame to pin against, which is the whole of the coordinate
 * -frames change — an origin nobody made is exactly the thing that tempts a
 * drawing into being related to a global grid. So `fix` needs a frame: the one
 * named, or the default at call time, and it throws when there is neither. The
 * journal always carries the resolved name, so a saved file never depends on
 * what the default happened to be afterwards.
 *
 * The frame is read, never pushed — see `frameBasis`. So this pins the point
 * to the frame and not the other way round, and a drawing with no frame at all
 * simply floats in the kernel's flat vector, which the damped solve is content
 * to leave where it was seeded.
 *
 * **That is now true in 3D as well, and there is no frameless form left.**
 * Until 3D frames existed, `fix` above 2D pinned the kernel's own coordinates,
 * because a frame was an origin plus one direction and that settles nothing in
 * 3D — the register recorded it as the one place the gauge was still visible.
 * A 3D frame carries a second direction, so the seam is closed: a 3D `fix` pins
 * `[x, y, z]` in a frame exactly as a 2D one pins `[x, y]`, and refuses with
 * the same message when there is no frame to pin in. Above 3D there are no
 * frames (see `Model.resolveFrame`), so there is no `fix` there either.
 */
export function fix(model: Model, name: string, at: number[], frameName?: string | null): string {
  const p = model.point(name);
  if (at.length !== p.varIndices.length) throw new Error(`fix needs ${p.varIndices.length} coordinates`);
  const frame = model.resolveFrame(frameName);
  return model.relation("fix", [name, at, frame], () => {
    const basis = frameBasis(model, frame);
    // One block per coordinate, as it always was, so an over-constrained
    // drawing still reports `fix(a[1])` rather than one lump. `at[i]` is a
    // length along an axis, so the axis has to be a unit vector — how far the
    // x-ref happens to sit from the origin must not change what [10, 0] means.
    for (let i = 0; i < at.length; i++) {
      model.addResidual(p.varIndices, (l) => {
        const { origin, axes } = basis();
        return [alongAxis(l, origin, axes[i]).sub(at[i])];
      }, `fix(${name}[${i}])`);
    }
  });
}

/**
 * A point lies in a plane — a frame's x–y plane (the one its origin and both
 * refs lie in; the origin's included), a circle's or arc's own plane, or the
 * plane through three points (`"p1.p2.p3"`, a solid's face). This is what
 * "this point is on the sketch" means in a 3D model, and half of what holds a
 * circle drawn on a plane there (tools/place.ts). Everything below about the
 * frame holds for every kind of plane: read as a datum (`planeBasis`), never
 * pushed.
 *
 * The residual is the point's signed distance off the plane, (p − origin) · +z.
 * Linear in the point and not a square, so its gradient is the plane's normal
 * all the way down to the root. Distance rather than anything scaled, because
 * +z is a unit vector: that is what lets a solve report `onplane(p,f)` off by
 * a number that means something.
 *
 * Everything about the frame is `fix`'s: read and never pushed (so the point
 * goes to the plane, never the plane to the point), resolved from the default
 * **at call time** when no frame is named, and journalled resolved, so a
 * saved entry cannot change meaning when the default moves afterwards.
 *
 * Refused in 2D rather than accepted as a no-op: every point of a 2D drawing is
 * already in every frame's plane, so the relation could never say anything,
 * and a constraint that constrains nothing is a trap on the hover tag.
 *
 * The long name is `onPlane` (the short one `onplane`), after `onCircle`: the
 * family is "on" plus the kind of thing, and `pointOnLine` keeps its own name
 * only because `on` was taken first.
 */
export function onPlane(model: Model, pointName: string, planeName?: string | null): string {
  if (model.dim !== 3) {
    throw new Error("onPlane needs a 3D model — in 2D every point already lies in every frame's plane");
  }
  const p = model.point(pointName);
  // Any plane reference (`Model.planeKind`): a frame — the origin included —
  // a circle's or arc's own plane, or a face's three points as "p1.p2.p3".
  // Left out, the drawing plane, resolved now and journalled resolved.
  const plane = planeName ?? model.drawingPlane();
  model.planeKind(plane);
  return model.relation("onPlane", [pointName, plane], () => {
    const basis = planeBasis(model, plane);
    model.addResidual(p.varIndices, (l) => {
      const { origin, n } = basis();
      return [alongAxis(l, origin, n)];
    }, `onplane(${pointName},${plane})`);
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
