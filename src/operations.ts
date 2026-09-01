// Operations, as distinct from relations. A relation only ever *adds an
// equation* — the model's structure is untouched and the solver does the
// rest. An operation changes the structure itself: it creates entities,
// re-points references, trims things back. Fillet is the first, and the
// distinction is worth a file of its own because the two want reviewing
// with different eyes: a relation can only ever over- or under-constrain,
// while an operation can leave the model malformed.

import type { Model } from "./model.ts";
import { arcEndpoints, radius, tangent } from "./relations/geometry.ts";

function unit(v: number[]): number[] {
  const len = Math.hypot(...v);
  if (len < 1e-12) throw new Error("cannot take the direction of a zero-length line");
  return v.map((c) => c / len);
}

/** The point both lines reference, plus each line's far end. */
function corner(model: Model, l1Name: string, l2Name: string) {
  const l1 = model.line(l1Name), l2 = model.line(l2Name);
  const shared = l1.refs.find((n) => l2.refs.includes(n));
  if (!shared) throw new Error(`"${l1Name}" and "${l2Name}" do not meet at a shared point`);
  const a = l1.refs[0] === shared ? l1.refs[1] : l1.refs[0];
  const b = l2.refs[0] === shared ? l2.refs[1] : l2.refs[0];
  return { l1, l2, shared, a, b };
}

/**
 * Rounds the corner where two lines meet, with an arc of the given radius
 * tangent to both.
 *
 * The whole thing composes out of the existing relation vocabulary, which is
 * the point worth noticing: `tan` on each leg, `arcends` to hold the arc's
 * ends on its own circle, and `rad` for the size. Nothing bespoke. Those four
 * are also *complete* — a tangent line touches its circle exactly once, so an
 * endpoint that lies on both the leg and the circle can only be the point of
 * tangency. There is no need to state that separately.
 *
 * Structurally: the shared corner point is *reused* as the tangent point on
 * the first leg rather than being replaced, so the operation leaves no
 * orphaned geometry behind (the model has no delete yet, so an operation that
 * stranded points would leave stray dots on the canvas forever). The second
 * leg is re-pointed at a new tangent point.
 *
 * The legs' *directions* are deliberately left alone. A fillet in a
 * parametric sketch does not pin the lines it rounds — whatever already
 * constrains them (hor/ver, a dimension, another relation) still decides
 * where they point, and the fillet solves within that. On an otherwise
 * unconstrained pair of lines the result is therefore under-determined, and
 * the seeded starting positions are what pick a sensible answer.
 *
 * Which makes the *form* those constraints were written in matter. A relation
 * on a line ("this edge is level") resolves the line's endpoints at every
 * evaluation, so it follows the leg through this re-pointing. A relation on
 * two points ("these two share a y") keeps constraining the two points it
 * named — including the old corner, which is now leg one's tangent point —
 * and leaves the re-pointed leg free to swing. Both behaviours are pinned in
 * test/sketch.test.ts. Prefer the line form for anything that is a property
 * of an edge; it is what the built-in tools use.
 *
 * Returns the new arc's name.
 */
export function fillet(model: Model, l1Name: string, l2Name: string, r: number): string {
  if (model.dim !== 2) throw new Error("fillet is a 2D operation");
  if (!(r > 0)) throw new Error("fillet needs a positive radius");

  const { l1, shared, a, b } = corner(model, l1Name, l2Name);
  const p = model.coords(shared);
  const u = unit(model.coords(a).map((c, i) => c - p[i]));
  const v = unit(model.coords(b).map((c, i) => c - p[i]));

  // The interior angle at the corner decides how far back the legs are cut.
  const cosTheta = Math.min(1, Math.max(-1, u[0] * v[0] + u[1] * v[1]));
  const theta = Math.acos(cosTheta);
  if (theta < 1e-6 || Math.PI - theta < 1e-6) {
    throw new Error("cannot fillet a corner whose legs are collinear");
  }

  const backoff = r / Math.tan(theta / 2); // corner -> each tangent point
  const toCenter = r / Math.sin(theta / 2); // corner -> arc center
  const legA = Math.hypot(...model.coords(a).map((c, i) => c - p[i]));
  const legB = Math.hypot(...model.coords(b).map((c, i) => c - p[i]));
  if (backoff > legA || backoff > legB) {
    throw new Error(`radius ${r} is too large for this corner (needs ${backoff.toFixed(3)} of leg, have ${Math.min(legA, legB).toFixed(3)})`);
  }

  const bisector = unit([u[0] + v[0], u[1] + v[1]]);
  const t1 = [p[0] + u[0] * backoff, p[1] + u[1] * backoff];
  const t2 = [p[0] + v[0] * backoff, p[1] + v[1] * backoff];
  const ctr = [p[0] + bisector[0] * toCenter, p[1] + bisector[1] * toCenter];

  // Reuse the corner as leg one's tangent point; leg two gets a fresh one.
  model.setCoords(shared, t1);
  const t2p = model.addPoint(t2);
  const ctrp = model.addPoint(ctr);
  model.retargetLine(l2Name, shared, t2p.name);

  // Sweep counter-clockwise from start to end, so order the two ends by which
  // way round is the short way — otherwise the arc renders as the reflex one.
  const cross = (t1[0] - ctr[0]) * (t2[1] - ctr[1]) - (t1[1] - ctr[1]) * (t2[0] - ctr[0]);
  const [start, end] = cross > 0 ? [shared, t2p.name] : [t2p.name, shared];

  const arc = model.addArc(ctrp.name, start, end, r);
  radius(model, arc.name, r);
  arcEndpoints(model, arc.name);
  tangent(model, l1.name, arc.name);
  tangent(model, l2Name, arc.name);

  return arc.name;
}
