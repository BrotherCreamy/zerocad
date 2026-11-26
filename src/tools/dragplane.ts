// **A drag of a point held on a plane moves it in that plane**
// (docs/plans/flat-profile.md, bug 83). The engine reads a drag's cursor on
// one plane for the whole gesture (engine.ts's `dragPointAt`): the plane
// chosen to sketch on, else the one facing the viewer. For a point the
// drawing holds on a plane — a circle's centre `onplane` a face, a profile
// corner held flat with the rest, a point `coplanar` with three others —
// the screen-parallel plane is the wrong one: the finger asks for a place
// off the face, the relation refuses it, and what gives is whatever is
// free. The owner's prism, free as a body may be, tilted toward the finger
// a hair at every frame, the hole's circle went nowhere (0.003 for a
// forty-pixel drag, measured), and mid-drag the solids layer refused the
// tilted plate. Read on the plane the point is held on, the finger's ray
// meets the face where the eye sees it land, the circle slides along the
// face, and nothing else has to move.
//
// The rule, in one place: the plane every governing point of what was
// grabbed is held on, where they all agree; null where none is held, or
// where they are held on different planes (a line from the lid to the
// ground), and the engine falls back to what it did. Where the plane is
// seen edge-on the engine falls back too, since a ray along a plane lands
// nowhere on it.

import type { Model } from "../model.ts";
import { planeOfRef } from "../workplane.ts";
import type { Plane } from "../view.ts";
import { cross3, dot3, sub3, unit3 } from "../vec3.ts";

/** The plane through three points, `a` its origin — or null for three in a line. */
function throughPoints(model: Model, a: string, b: string, c: string): Plane | null {
  const [A, B, C] = [a, b, c].map((n) => model.coords(n));
  const u = unit3(sub3(B, A));
  const n = unit3(cross3(sub3(B, A), sub3(C, A)));
  if (!u || !n) return null;
  const v = cross3(n, u);
  return { origin: A, u, v };
}

/** The plane `point` is held on by one relation, or null for a relation that holds it on none. */
function planeOfRelation(model: Model, point: string, op: string, args: readonly unknown[]): Plane | null {
  const names = args.filter((a): a is string => typeof a === "string");
  try {
    if (op === "onPlane" && names[0] === point && names[1] !== undefined) return planeOfRef(model, names[1]);
    // `coplanar(p, a, b, c)`: the plane of the three that are not this point.
    if (op === "coplanar" && names.includes(point)) {
      const others = names.filter((n) => n !== point);
      return others.length === 3 ? throughPoints(model, others[0], others[1], others[2]) : null;
    }
    // `flat(e1, a, b, c, …)`: the plane of its first three — the largest
    // triangle when it was made — whichever of its points this is.
    if (op === "profileFlat" && names.slice(1).includes(point) && names.length >= 4) return throughPoints(model, names[1], names[2], names[3]);
  } catch {
    return null; // a reference since deleted, a plane collapsed
  }
  return null;
}

/** Whether two planes are one plane, to the drawing's eye. */
function samePlane(a: Plane, b: Plane): boolean {
  const na = unit3(cross3(a.u, a.v)), nb = unit3(cross3(b.u, b.v));
  if (!na || !nb) return false;
  if (Math.abs(Math.abs(dot3(na, nb)) - 1) > 1e-6) return false;
  const away = Math.max(1, Math.hypot(...sub3(b.origin, a.origin)));
  return Math.abs(dot3(sub3(b.origin, a.origin), na)) <= 1e-6 * away;
}

/**
 * The plane a drag of `names` — the governing points of what was grabbed
 * (engine.ts's `dragGoverns`) — moves in: the one every one of them is held
 * on by `onplane`, `coplanar` or a feature's `flat`, where those agree; null
 * where any is held on none, or two are held on different planes. 3D only:
 * a 2D model is one plane already.
 */
export function heldPlane(model: Model, names: readonly string[]): Plane | null {
  if (model.dim !== 3 || !names.length) return null;
  let found: Plane | null = null;
  for (const name of names) {
    if (model.entities.get(name)?.kind !== "point") return null;
    let own: Plane | null = null;
    for (const r of model.relationsNaming(name)) {
      const p = planeOfRelation(model, name, r.op, r.args);
      if (!p) continue;
      if (own && !samePlane(own, p)) return null; // held on two planes: a line of its own
      own ??= p;
    }
    if (!own) return null;
    if (found && !samePlane(found, own)) return null;
    found ??= own;
  }
  return found;
}
