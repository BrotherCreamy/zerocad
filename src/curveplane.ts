// Where a circle's or arc's rim is, read off the model as plain numbers — the
// one answer the renderer, picking/snapping/box select (through
// projection.ts), the glyphs, the arc tools and `fillet` all need about a
// curve's plane.
//
// A circle or arc in a 3D model names a frame (see `CircleEntity`), and its rim
// lies in the plane through its own centre **parallel** to that frame's x–y
// plane: the frame orients it, the centre places it. In 2D the plane is the
// drawing's own, x and y, and its +z is the side every 2D arc has always been
// counter-clockwise about. `arcgeom.ts` does the arithmetic over plain numbers
// and knows nothing of either; this file is where the model is asked which
// numbers to hand it.
//
// It sits above the relations for the reason `workplane.ts` does: a frame's
// axes are `frameBasis`'s to read and nobody else's, so the marker, every
// relation and every drawing of a rim agree on what "the frame's +z" is.

import type { Entity, FeatureEntry, Model } from "./model.ts";
import { frameBasis } from "./relations/refs.ts";
import { arcFrame, circleFrame, type ArcFrame } from "./arcgeom.ts";
import { lift3 } from "./vec3.ts";

/** A plane's two in-plane unit directions and its normal, three coordinates each. */
export interface CurvePlane {
  u: number[];
  v: number[];
  n: number[];
}

/** The 2D drawing's plane: x, y, and +z the side its arcs are counter-clockwise about. */
function flat(): CurvePlane {
  return { u: [1, 0, 0], v: [0, 1, 0], n: [0, 0, 1] };
}

/**
 * A frame's x–y plane, as plain unit directions — or null for a frame
 * collapsed so far it has no plane (an x-ref on the origin, a y-ref on the
 * frame's own x axis; see `frameBasis`), which a caller then has to decide
 * how to draw.
 */
export function framePlaneAxes(model: Model, frame: string): CurvePlane | null {
  const { ux, uy, uz } = frameBasis(model, frame)();
  if (!uz || ux.every((c) => c === 0) || uy.every((c) => c === 0)) return null;
  return { u: lift3(ux), v: lift3(uy), n: lift3(uz) };
}

/**
 * The plane a circle's or arc's rim lies parallel to: its frame's x–y plane in
 * 3D, the drawing's own in 2D. A frame collapsed onto itself has no plane to
 * give, and the rim is then drawn in the kernel's x–y plane — the floor that
 * keeps a renderer from throwing, for a drawing whose datum has stopped
 * meaning anything (every relation against that frame has degraded the same
 * way; see `frameBasis`).
 */
export function curvePlaneOf(model: Model, name: string): CurvePlane {
  const plane = model.circular(name).plane;
  if (plane === undefined || !model.entities.has(plane)) return flat();
  return framePlaneAxes(model, plane) ?? flat();
}

/**
 * The plane a feature's profile is sketched in — an extrude's lid is offset
 * along its normal, a revolve's axis lies in it — or null for a collapsed one.
 * Today that is the feature's sketch frame; asked here rather than of the frame
 * so the STEP exporter (step.ts, solids.ts) reads a feature's plane the way it
 * reads a curve's, and a change to where that orientation lives changes this
 * accessor and not the exporter.
 */
export function featurePlane(model: Model, feature: FeatureEntry): CurvePlane | null {
  return framePlaneAxes(model, feature.frame);
}

/**
 * The side a new arc drawn on the sketch will turn about: the default frame's
 * +z in a 3D model — the plane a tool's arc is about to be given — and the 2D
 * +z otherwise, or when there is no default frame to ask (the tool refuses
 * before it gets that far; see tools/place.ts).
 */
export function sketchSide(model: Model): number[] {
  if (model.dim !== 3 || model.defaultFrame == null || !model.entities.has(model.defaultFrame)) return flat().n;
  return framePlaneAxes(model, model.defaultFrame)?.n ?? flat().n;
}

/** The side an existing arc turns about — its own plane's normal. */
export function arcSide(model: Model, name: string): number[] {
  return curvePlaneOf(model, name).n;
}

/**
 * A circle or arc laid out in its plane, as `arcgeom.ts` draws, picks and lifts
 * it — or null for any other kind, or an arc with an endpoint on its centre.
 * Three coordinates throughout, a 2D drawing lying at z = 0.
 *
 * A circle is the full turn about its centre in its plane (`circleFrame`). An
 * arc is laid out in the plane through its centre and both ends, counter-
 * clockwise from start to end about its plane's +z (`arcFrame`).
 */
export function curveFrame(model: Model, e: Entity): ArcFrame | null {
  if (e.kind === "circle") {
    const { u, v } = curvePlaneOf(model, e.name);
    return circleFrame(model.coords(e.center), model.radius(e.name), u, v);
  }
  if (e.kind === "arc") {
    return arcFrame(model.coords(e.center), model.coords(e.start), model.coords(e.end),
      model.radius(e.name), arcSide(model, e.name));
  }
  return null;
}
