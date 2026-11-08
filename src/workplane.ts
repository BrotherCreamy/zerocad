// What a click lands on in 3D — the one answer the tool engine and the command
// line both need.
//
// A cursor names a ray through the scene, not a point; turning it into a point
// needs a surface. That surface is the **working plane** — the model's drawing
// plane (`Model.drawingPlane`):
//
//   * the **work plane**, when one is set — a solid's face, by sketch on face —
//     or the **default frame's x–y plane**: the sketch flow, every tool drawing
//     on the plane the user chose, the way an Onshape sketch is drawn on its
//     plane;
//   * otherwise **the origin's x–y plane**, which every document has
//     (docs/plans/frameless-curves.md). It used to be the plane facing the
//     viewer through the orbit target, which is z = 0 too in a view never
//     turned and swung with the camera after one; a fixed ground is what the
//     owner's "just put the circle right there" needs once the view has turned.
//
// A drawing plane seen exactly edge-on offers no crossing at all, and then the
// camera plane stands in for it, so a click always lands somewhere. Such a
// click is off the plane, and `placePoint` notices (see tools/place.ts) rather
// than holding a point to a plane it is not on.
//
// The plane the user **chose** — the work plane or the default frame, never the
// origin by default — is a second question (`sketchPlane`): it is the one
// snapping keeps to and points are held on, as they were held on the default
// frame before. A drawing with no plane chosen is not "sketching on the
// ground", so its snaps reach everything and its points stay free.
//
// In its own file because two layers need it and neither may own it: the
// engine (tools/) turns every pointer event into a place with it, and the
// command surface (replenv.ts) uses it to decide where "the middle of the view"
// is when it seeds a free entity. Above relations, because reading a plane is
// `planeBasis`'s job and nobody else's.

import { parseFramePlane, type Model } from "./model.ts";
import { planeAxes } from "./curveplane.ts";
import { cameraPlane, screenToPlane, type Plane, type View } from "./view.ts";

/**
 * The direction reference for a plane's normal — what `par` holds a curve's
 * normal to so the curve stays in the plane: a frame's `"f1.z"` (the origin's
 * `"origin.z"`), a frame's x–z or y–z plane's own frame axis along its normal
 * (`"origin.y"` for Front, `"origin.x"` for Right), and a curve or a face's
 * `"p1.p2.p3"` as themselves (relations/refs.ts reads both as their normals).
 * Here, below the tools and the drawing pass, because both ask it: a curve
 * tool holds a curve by it, and the focus reads a held curve by it.
 */
export function planeNormalRef(model: Model, ref: string): string {
  const kind = model.planeKind(ref);
  if (kind === "frame") return `${ref}.z`;
  if (kind === "framePlane") {
    const side = parseFramePlane(ref)!;
    return `${side.frame}.${side.normal}`;
  }
  return ref;
}

/** A plane reference as view.ts's Plane, or null when it has collapsed past having one. */
export function planeOfRef(model: Model, ref: string): Plane | null {
  const p = planeAxes(model, ref);
  return p ? { origin: p.origin, u: p.u, v: p.v } : null;
}

/**
 * The plane the user chose to sketch on — the work plane, else the default
 * frame's — or null when there is none: no choice made (the origin's plane is
 * where clicks land, not a sketch), a 2D model (whose frames have no plane to
 * offer that is not the whole world), or a plane collapsed so far it has none.
 */
export function sketchPlane(model: Model): Plane | null {
  const ref = model.workPlane ?? model.defaultFrame;
  if (model.dim !== 3 || ref == null) return null;
  try {
    return planeOfRef(model, ref);
  } catch {
    return null; // named something since deleted: the deletion clears it, but a frame drawn first may ask
  }
}

/** The plane reference `sketchPlane` reads, or null. */
export function sketchPlaneRef(model: Model): string | null {
  return model.dim === 3 ? model.workPlane ?? model.defaultFrame : null;
}

/** The plane a click lands on in this model, seen through this view. See the top of the file. */
export function workingPlane(model: Model, view: View): Plane {
  if (model.dim !== 3) return cameraPlane(view);
  return sketchPlane(model) ?? planeOfRef(model, model.drawingPlane()) ?? cameraPlane(view);
}

/**
 * The world point under (sx, sy) on the working plane — or, when that is seen
 * edge-on, on the camera plane instead — together with the plane it actually
 * landed on. Always three coordinates: this is the 3D question.
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
