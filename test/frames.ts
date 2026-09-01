// The one-line fixture frame the rest of the suite is written against.
//
// `hor`, `ver` and `fix` are relative to a coordinate frame now, and there is
// no world frame to fall back on — see docs/plans/coordinate-frames.md. A test
// written before frames existed still means what it meant, provided it says
// which frame it means; this is that line.

import type { Model } from "../src/model.ts";

/**
 * Adds a frame lined up with the kernel's own axes and makes it the default,
 * so a bare `hor`/`ver`/`fix` in a test means exactly what it meant before
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
 * coordinates literally the same numbers.
 *
 * The two points are named rather than auto-named, so the `p` counter — which
 * a good many tests assert against by name — is left exactly where it was.
 *
 * `at` moves the whole frame, for the tests that drive the *snapping* code: a
 * frame's points are ordinary points and snapping does not know they are a
 * frame's, so a fixture sitting on the origin would be the nearest thing to
 * every click a line-tool test makes. Those tests park it out of reach and
 * write their `fix` coordinates relative to it, which is what `fix` has always
 * meant and now says out loud.
 */
export function axisFrame(model: Model, name = "f", at: number[] = [0, 0]): string {
  const origin = model.addPoint(at, `${name}_o`).name;
  const xref = model.addPoint([at[0] + 1, at[1]], `${name}_x`).name;
  model.addFrame(origin, xref, name);
  model.setDefaultFrame(name);
  return name;
}
