// The one-line fixture frame the rest of the suite is written against.
//
// `fix` and every axis reference are relative to a coordinate frame now, and
// there is no world frame to fall back on — see docs/plans/coordinate-frames.md.
// A test written before frames existed still means what it meant, provided it
// says which frame it means; this is that line. Since 3D frames closed the
// gauge seam `fix` used to have above 2D, that is as true of a 3D test as of a
// 2D one.

import type { Model } from "../src/model.ts";

/**
 * Adds a frame lined up with the kernel's own axes and makes it the default,
 * so a bare `fix` (or `xaxis()`) in a test means exactly what it meant before
 * frames existed: the frame's coordinates and the flat vector's coincide.
 *
 * This is only a *fixture* because a frame is read and never pushed (see
 * `frameBasis` in src/relations/refs.ts) — nothing a test constrains can drag
 * this frame off the axes, so every coordinate the suite asserts still means
 * what it says. Were it otherwise, a fixture frame would be a slow leak rather
 * than a one-line change.
 *
 * The x-ref sits one unit out. Only its *direction* counts, so the distance is
 * arbitrary; one unit is the reading that makes frame coordinates and gauge
 * coordinates literally the same numbers. In a 3D model the y-ref sits one unit
 * out along the kernel's y, for the same reason, which makes the frame's +z the
 * kernel's z.
 *
 * The points are named rather than auto-named, so the `p` counter — which a
 * good many tests assert against by name — is left exactly where it was.
 *
 * `at` moves the whole frame, for the tests that drive the *snapping* code: a
 * frame's points are ordinary points and snapping does not know they are a
 * frame's, so a fixture sitting on the origin would be the nearest thing to
 * every click a line-tool test makes. Those tests park it out of reach and
 * write their `fix` coordinates relative to it, which is what `fix` has always
 * meant and now says out loud. It defaults to the origin in whatever dimension
 * the model has.
 */
export function axisFrame(model: Model, name = "f", at?: number[]): string {
  const o = at ?? new Array<number>(model.dim).fill(0);
  const offset = (axis: number) => o.map((v, i) => (i === axis ? v + 1 : v));
  const origin = model.addPoint(o, `${name}_o`).name;
  const xref = model.addPoint(offset(0), `${name}_x`).name;
  const yref = model.dim === 3 ? model.addPoint(offset(1), `${name}_y`).name : null;
  model.addFrame(origin, xref, yref, name);
  model.setDefaultFrame(name);
  return name;
}
