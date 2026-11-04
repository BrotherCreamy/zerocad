// Where a circle's or arc's rim is, and where a plane is, read off the model as
// plain numbers — the one answer the renderer, picking/snapping/box select
// (through projection.ts), the glyphs, the arc tools, the loops and `fillet`
// all need about a curve's plane.
//
// A circle or arc in a 3D model carries its own normal (see `CircleEntity`),
// and its rim lies in the plane through its own centre square to that normal.
// It used to name a frame and be read off the frame; nothing asks a frame what
// plane a curve is in any more (docs/plans/frameless-curves.md). In 2D the
// plane is the drawing's own, x and y, and its +z is the side every 2D arc has
// always been counter-clockwise about. `arcgeom.ts` does the arithmetic over
// plain numbers and knows nothing of either; this file is where the model is
// asked which numbers to hand it.
//
// It sits above the relations for the reason `workplane.ts` does: a frame's
// axes are `frameBasis`'s to read and a plane's `planeBasis`'s, so the marker,
// every relation and every drawing of a rim agree on what "the plane's
// normal" is.

import { spanOf, type Entity, type Model } from "./model.ts";
import { frameBasis, planeBasis } from "./relations/refs.ts";
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
 * A frame's x–y plane, as plain unit directions — the origin's included — or
 * null for a frame collapsed so far it has no plane (an x-ref on the origin, a
 * y-ref on the frame's own x axis; see `frameBasis`), which a caller then has
 * to decide how to draw.
 */
export function framePlaneAxes(model: Model, frame: string): CurvePlane | null {
  const { ux, uy, uz } = frameBasis(model, frame)();
  if (!uz || ux.every((c) => c === 0) || uy.every((c) => c === 0)) return null;
  return { u: lift3(ux), v: lift3(uy), n: lift3(uz) };
}

/**
 * Any plane reference (`Model.planeKind`) — a frame, a curve's own plane, three
 * points — as an origin and plain unit directions, or null for one collapsed
 * past having a plane. What a feature's profile plane and the work plane are
 * read as by everything that draws or measures them.
 */
export function planeAxes(model: Model, ref: string): (CurvePlane & { origin: number[] }) | null {
  const { origin, u, v, n } = planeBasis(model, ref)();
  if (n.every((c) => c === 0) || u.every((c) => c === 0)) return null;
  return { origin, u, v, n };
}

/**
 * The plane a circle's or arc's rim lies in: square to its own normal in 3D,
 * the drawing's own in 2D. In-plane directions from `spanOf`, so a level
 * circle is laid out from the kernel's +x, as one on the origin's plane was.
 */
export function curvePlaneOf(model: Model, name: string): CurvePlane {
  if (model.circular(name).normal === undefined) return flat();
  const n = model.normalOf(name);
  const [u, v] = spanOf(n);
  return { u, v, n };
}

/**
 * The side a new arc drawn on the sketch will turn about: the drawing plane's
 * normal in a 3D model (the work plane's, the default frame's, the origin's)
 * — the normal the tool is about to give the arc — and the 2D +z otherwise.
 */
export function sketchSide(model: Model): number[] {
  if (model.dim !== 3) return flat().n;
  return planeAxes(model, model.drawingPlane())?.n ?? flat().n;
}

/** The side an existing arc turns about — its own normal. */
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
 * clockwise from start to end about its own normal (`arcFrame`) — measured
 * from its own start, so it needs no reference axis.
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
