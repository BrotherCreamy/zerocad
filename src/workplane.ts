// What a click lands on in 3D — the one answer the tool engine and the command
// line both need.
//
// A cursor names a ray through the scene, not a point; turning it into a point
// needs a surface. That surface is the **working plane**:
//
//   * the **default frame's x–y plane**, when there is a default frame — the
//     sketch flow: set a frame as the default and every tool draws on it, the
//     way an Onshape sketch is drawn on its plane;
//   * otherwise the **camera-parallel plane through the orbit target**, which
//     in a view that has never been turned is z = 0 — the plane a 2D drawing
//     always lived in — and after a turn is the plane facing the viewer through
//     the middle of the window.
//
// A default frame seen exactly edge-on offers no crossing at all, and then the
// camera plane stands in for it, so a click always lands somewhere. Such a
// click is off the sketch plane, and `placePoint` notices (see tools/place.ts)
// rather than holding a point to a plane it is not on.
//
// In its own file because two layers need it and neither may own it: the
// engine (tools/) turns every pointer event into a place with it, and the
// command surface (replenv.ts) uses it to decide where "the middle of the view"
// is when it seeds a free entity. Above relations, because reading a frame's
// axes is `frameBasis`'s job and nobody else's.

import type { Model } from "./model.ts";
import { frameBasis } from "./relations/refs.ts";
import { cameraPlane, screenToPlane, type Plane, type View } from "./view.ts";

/**
 * The default frame's plane, or null when there is none to draw on: no default,
 * a 2D model (whose frames have no plane to offer that is not the whole
 * world), or a frame collapsed so far that it has no +y left.
 */
export function framePlane(model: Model): Plane | null {
  const name = model.defaultFrame;
  if (model.dim !== 3 || name == null || !model.entities.has(name)) return null;
  const { origin, ux, uy } = frameBasis(model, name)();
  if (ux.every((c) => c === 0) || uy.every((c) => c === 0)) return null;
  return { origin, u: ux, v: uy };
}

/** The plane a click lands on in this model, seen through this view. See the top of the file. */
export function workingPlane(model: Model, view: View): Plane {
  return framePlane(model) ?? cameraPlane(view);
}

/**
 * The world point under (sx, sy) on the working plane — or, when that is the
 * default frame seen edge-on, on the camera plane instead — together with the
 * plane it actually landed on. Always three coordinates: this is the 3D
 * question.
 */
export function pointOnWorkingPlane(model: Model, view: View, sx: number, sy: number):
  { world: number[]; plane: Plane } {
  const plane = workingPlane(model, view);
  const hit = screenToPlane(view, sx, sy, plane);
  if (hit) return { world: hit, plane };
  // The camera plane faces the viewer by construction, so this always lands.
  const facing = cameraPlane(view);
  return { world: screenToPlane(view, sx, sy, facing)!, plane: facing };
}
