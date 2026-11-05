// The composite shapes — a regular polygon and a straight slot — as the lines,
// arcs and relations a user would otherwise draw one by one
// (docs/plans/sketch-shapes.md). The owner: *"give me better sketch tools,
// relations, trim, slot... all the usual"*.
//
// **A composite leaves ordinary entities behind**, as `rectangle` does: points,
// lines, arcs, a construction circle or line, and relations each with its own
// name, glyph and `del`. Nothing records that they were once a polygon — there
// is no polygon entity, and no `polygon` entry in the journal: every piece
// journals itself as it is made, so a file replays a polygon as its pieces,
// exactly as it replays a rectangle, and the persist layer needs no row for
// either. The same builder serves the tool (after it has placed the points the
// user clicked, with their inference) and the command line's `polygon(...)` and
// `slot(...)`.
//
// **The relations are intrinsic**, like the rectangle's: equal sides and a
// circle through the corners make a polygon regular in any frame, so nothing is
// levelled and nothing dimensioned — tools do not dimension what they draw. A
// polygon is left with four degrees of freedom (its centre, its size and its
// turn), a slot with five (its two centres and its width), each the count of
// what a hand would expect to drag; the tests count them.
//
// In 3D the pieces are laid out in the plane the gesture stands on — the
// sketch plane, a face, the ground — and held there by the same visible
// relations a circle drawn there is (place.ts): derived points `onplane`, the
// construction circle's and the arcs' normals `par` to the plane's.

import type { Model } from "../model.ts";
import { arcEndpoints, equalLength, equalRadius, onCircle, perpendicular, tangent } from "../relations/geometry.ts";
import { holdCurve, holdOnSketchPlane } from "./place.ts";
import { planeOfRef } from "../workplane.ts";
import { cross3, lift3, unit3 } from "../vec3.ts";

/** The fewest sides a polygon can have, and the most a hand would draw. */
export const POLYGON_MIN_SIDES = 3;
export const POLYGON_MAX_SIDES = 64;

/**
 * The in-plane unit direction a quarter turn counter-clockwise from `u` about
 * the plane's normal — the 2D drawing's +z, or the plane `ref`'s — as many
 * coordinates as the model has. Null when `u` is along the normal.
 */
function quarterTurn(model: Model, u: number[], ref: string | null): number[] | null {
  if (model.dim === 2) return [-u[1], u[0]];
  const plane = ref ? planeOfRef(model, ref) : null;
  const n = plane ? unit3(cross3(lift3(plane.u), lift3(plane.v))) : [0, 0, 1];
  return n ? unit3(cross3(n, lift3(u))) : null;
}

/** The plane normal a curve laid out on `ref` is seeded facing, or null in 2D. */
function normalOn(model: Model, ref: string | null): number[] | null {
  if (model.dim !== 3) return null;
  const plane = ref ? planeOfRef(model, ref) : null;
  return plane ? unit3(cross3(lift3(plane.u), lift3(plane.v))) : [0, 0, 1];
}

/** What a polygon is made of, by name. */
export interface PolygonParts {
  centre: string;
  /** Its corners, counter-clockwise from the vertex it was drawn by. */
  vertices: string[];
  /** Side k runs from vertex k to vertex k + 1. */
  sides: string[];
  /** The construction circle through its corners. */
  circle: string;
  /** An inscribed polygon's second construction circle, inside it, touching its sides — null otherwise (see `polygon`). */
  inscribed: string | null;
  relations: string[];
}

/**
 * A regular polygon of `n` sides about the point `centre`, with `vertex` its
 * first corner — both points already in the model (the tool has placed them,
 * snap inference and all). The other corners are laid out counter-clockwise
 * about the plane's normal, at the same distance, and held on `plane` (a
 * plane reference, 3D only) as a rectangle's derived corners are.
 *
 * **What holds it regular.** `circumscribed` (the default): a construction
 * circle about the centre through every corner (`oncircle` on each) and every
 * side `eq` to the first — n points on a circle cut into n equal chords are a
 * regular polygon, and those 2n − 1 equations leave exactly its four freedoms.
 * The circle is centred on the polygon's own centre point, so no `conc` is
 * needed.
 *
 * Inscribed (`circumscribed: false`): all of that, and a second construction
 * circle about the same centre **touching the first side** (one `tan`) — the
 * circle the option names, inside the polygon. A regular polygon's sides are
 * all one distance from its centre, so touching one it touches them all, and
 * its one radius costs one equation: still four freedoms, nothing redundant.
 * Measured before choosing, dragging each corner far off in steps for n = 3 …
 * 8: the inscribed circle `tan` to *every* side with the sides held equal by
 * `eq` folds for every n ≥ 4 (a polygon of equal sides all tangent to a circle
 * can rock — a rhombus is one — and past that fold over a corner); `tan` to
 * every side with the corners `oncircle` an outer circle and no `eq` let a
 * side shrink to nothing at n = 8, where a tangency of a side with no length
 * says nothing; `eq` to centre-to-corner spokes folded at 8 too. Equal sides
 * keep every side from folding, which is why both options are built on them.
 */
export function polygon(model: Model, centre: string, vertex: string, n: number,
                        circumscribed = true, plane: string | null = null): PolygonParts {
  if (!Number.isInteger(n) || n < POLYGON_MIN_SIDES || n > POLYGON_MAX_SIDES) {
    throw new Error(`a polygon has a whole number of sides from ${POLYGON_MIN_SIDES} to ${POLYGON_MAX_SIDES}, got ${JSON.stringify(n)}`);
  }
  if (model.dim !== 2 && model.dim !== 3) throw new Error(`a polygon is drawn in a 2D or 3D model, and this one is ${model.dim}D`);
  model.point(centre);
  model.point(vertex);
  const c = model.coords(centre), v0 = model.coords(vertex);
  const off = v0.map((x, i) => x - c[i]);
  const R = Math.hypot(...off);
  if (!(R > 1e-9)) throw new Error("a polygon needs its first corner apart from its centre");
  const u = off.map((x) => x / R);
  const w = quarterTurn(model, u, plane);
  if (!w) throw new Error("a polygon's first corner has to lie in its plane");
  const at = (k: number) => {
    const t = (2 * Math.PI * k) / n;
    return c.map((x, i) => x + R * (Math.cos(t) * u[i] + Math.sin(t) * (w[i] ?? 0)));
  };

  const vertices = [vertex];
  for (let k = 1; k < n; k++) {
    const p = model.addPoint(at(k)).name;
    holdOnSketchPlane(model, p, plane);
    vertices.push(p);
  }
  const sides = vertices.map((p, k) => model.addLine(p, vertices[(k + 1) % n]).name);
  const circle = model.addCircle(centre, R, normalOn(model, plane)).name;
  model.setConstruction(circle, true);
  const relations: string[] = [];
  if (plane) relations.push(...holdCurve(model, circle, centre, plane));
  for (const p of vertices) relations.push(onCircle(model, p, circle));
  for (let k = 1; k < n; k++) relations.push(equalLength(model, sides[k], sides[0]));
  let inscribed: string | null = null;
  if (!circumscribed) {
    inscribed = model.addCircle(centre, R * Math.cos(Math.PI / n), normalOn(model, plane)).name;
    model.setConstruction(inscribed, true);
    if (plane) relations.push(...holdCurve(model, inscribed, centre, plane));
    relations.push(tangent(model, sides[0], inscribed));
  }
  return { centre, vertices, sides, circle, inscribed, relations };
}

/** What a slot is made of, by name. */
export interface SlotParts {
  /** Its two centres, as given. */
  centres: [string, string];
  /** The construction line between them — the slot's length is a dimension on it. */
  axis: string;
  /** The two straight sides: the one on the left of `a`→`b`, then the right. */
  sides: [string, string];
  /** The two round ends: about `a`, then about `b`. */
  arcs: [string, string];
  relations: string[];
}

/**
 * A straight slot between the centres `a` and `b` (points already in the
 * model), `width` across: two lines and two arcs, the arcs about the centre
 * points themselves (so a `conc` would hold nothing more), `eqrad`, each side
 * sharing its ends with the arcs, the ends `arcends` on their arcs. A
 * construction line joins the centres, so the length is `dist` on it and the
 * width `rad` on an arc (doubled). Five freedoms are left: the two centres and
 * the width.
 *
 * **Each side is tangent to both arcs, said as `perp`**, between the side and
 * the radius out to its end (`perp(a, end, side)`, the point-pair form) — not
 * as `tan`. A side whose end is already on its arc (`arcends`) touches the arc
 * where it is tangent *to second order*: `tan`'s distance-minus-radius is
 * then `r(1 − sin φ)`, a square in the angle off tangency, the very residual
 * CLAUDE.md forbids, with no gradient at its own root. Measured: with four
 * `tan`s the Jacobian at the solution is four short of full rank (nine
 * freedoms where the slot has five — every tangency's row is zero along the
 * side's turn about its end); with the `perp`s — linear, a dot product — it
 * is five. (Both solve a width dimension; it is a rank check, and the
 * redundancy report `sketch-relations.md` plans, that the `tan`s would
 * mislead.) A radius square to a line through a point on the circle is what a
 * tangency at that point is, so the shape is the same. The fillet's own
 * `tan`s have the same flaw — TODO.md.
 *
 * Each arc turns counter-clockwise about the plane's normal from one side to
 * the other, round its own end.
 */
export function slot(model: Model, a: string, b: string, width: number, plane: string | null = null): SlotParts {
  if (typeof width !== "number" || !(width > 0) || !Number.isFinite(width)) {
    throw new Error(`a slot needs a positive width, got ${JSON.stringify(width)}`);
  }
  if (model.dim !== 2 && model.dim !== 3) throw new Error(`a slot is drawn in a 2D or 3D model, and this one is ${model.dim}D`);
  if (a === b) throw new Error("a slot needs two different centres");
  model.point(a);
  model.point(b);
  const A = model.coords(a), B = model.coords(b);
  const d = B.map((x, i) => x - A[i]);
  const len = Math.hypot(...d);
  if (!(len > 1e-9)) throw new Error("a slot needs its two centres apart");
  const u = d.map((x) => x / len);
  const p = quarterTurn(model, u, plane);
  if (!p) throw new Error("a slot's centres have to lie in its plane");
  const r = width / 2;
  const side = (o: number[], s: number) => o.map((x, i) => x + s * r * (p[i] ?? 0));
  const made = (at: number[]) => {
    const q = model.addPoint(at).name;
    holdOnSketchPlane(model, q, plane);
    return q;
  };
  // Left of a→b first: a's left, b's left, then b's right, a's right — the
  // outline counter-clockwise about the plane's normal.
  const [al, bl, br, ar] = [made(side(A, 1)), made(side(B, 1)), made(side(B, -1)), made(side(A, -1))];
  const axis = model.addLine(a, b).name;
  model.setConstruction(axis, true);
  const left = model.addLine(al, bl).name;
  const right = model.addLine(br, ar).name;
  const normal = normalOn(model, plane);
  // About b from its right to its left (round past b), about a from its left
  // to its right (round past a): counter-clockwise about the normal, since the
  // left is a quarter turn counter-clockwise from a→b.
  const arcB = model.addArc(b, br, bl, r, normal).name;
  const arcA = model.addArc(a, al, ar, r, normal).name;
  const relations: string[] = [];
  if (plane) relations.push(...holdCurve(model, arcA, a, plane), ...holdCurve(model, arcB, b, plane));
  relations.push(arcEndpoints(model, arcA), arcEndpoints(model, arcB));
  relations.push(equalRadius(model, arcA, arcB));
  // Each side square to the radius at each of its ends: a's to its left and
  // right ends, b's likewise.
  relations.push(perpendicular(model, a, al, left), perpendicular(model, b, bl, left));
  relations.push(perpendicular(model, b, br, right), perpendicular(model, a, ar, right));
  return { centres: [a, b], axis, sides: [left, right], arcs: [arcA, arcB], relations };
}
