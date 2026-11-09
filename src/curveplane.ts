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

import { spanOf, type Entity, type FeatureEntry, type Model } from "./model.ts";
import { revolveProfilePlane } from "./relations/revolution.ts";
import { extrusionChord } from "./relations/extrusion.ts";
import { frameBasis, planeBasis } from "./relations/refs.ts";
import { arcFrame, circleFrame, type ArcFrame } from "./arcgeom.ts";
import type { BSpline } from "./bspline.ts";
import { cross3, lift3, unit3 } from "./vec3.ts";

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
 * The plane a feature's profile is sketched in — an extrude's lid is offset
 * along its normal, a revolve's axis lies in it — or null for a collapsed one.
 * Any plane reference the feature names (a frame, a curve's own plane, three
 * points: `planeAxes`), asked here rather than of the reference so the STEP
 * exporter (step.ts, solids.ts) reads a feature's plane the way it reads a
 * curve's, and a change to where that orientation lives changes this accessor
 * and not the exporter.
 */
export function featurePlane(model: Model, feature: FeatureEntry): CurvePlane | null {
  const p = planeAxes(model, feature.frame);
  if (!p) return null;
  const plane = { u: p.u, v: p.v, n: p.n };
  // A revolve's where its profile has turned to about the axis (relations/revolution.ts);
  // an extrude's square to its chord, which way ever the solid has turned.
  return feature.kind === "revolve" ? revolveProfilePlane(model, feature, plane) : extrudePlane(model, feature, plane);
}

/**
 * An extrude's plane **where its solid is** (docs/plans/profiles-held.md):
 * square to its chord, the normal the way the lid stands (`chord / reach`).
 * The chord is held square to the profile by the extrude's perpendicular, so
 * this is the profile's plane; the frame's is only where it started. Exactly
 * the frame's while the chord is still along the frame's normal — every
 * sketch-mode extrude — so nothing already built is laid out anew; otherwise
 * the frame's axes carried into the plane square to the chord.
 */
function extrudePlane(model: Model, f: Extract<FeatureEntry, { kind: "extrude" }>, frame: CurvePlane): CurvePlane {
  const chord = extrusionChord(model, f.depth);
  const d = model.relations.get(f.depth)?.args[1];
  if (!chord || typeof d !== "number") return frame;
  // Which way the lid stands is the depth's sign, whatever the end condition
  // (half of it, or through all, keeps it). Never the reach itself: a
  // through-all reach is read off the bodies' planes, which are read here.
  const len = Math.hypot(...chord);
  if (!(len > 1e-12) || d === 0) return frame;
  const n = chord.map((c) => (Math.sign(d) * c) / len);
  if (Math.hypot(...n.map((c, i) => c - frame.n[i])) < 1e-9) return frame;
  const along = frame.u.reduce((acc, c, i) => acc + c * n[i], 0);
  const u = unit3(frame.u.map((c, i) => c - along * n[i])) ?? unit3(cross3(n, [1, 0, 0])) ?? [0, 1, 0];
  return { u, v: cross3(n, u), n };
}

/**
 * The plane a circle's or arc's rim lies in: square to its own normal in 3D,
 * the drawing's own in 2D. In-plane directions from `spanOf`, so a level
 * circle is laid out from the kernel's +x, as one on the origin's plane was.
 */
export function curvePlaneOf(model: Model, name: string): CurvePlane {
  const e = model.entities.get(name);
  if (e && kindFrames.has(e.kind)) {
    // A declared kind's plane is laid out along its own frame's axes — u, v
    // and their cross — so a loop in its plane is measured where it is drawn.
    const f = curveFrame(model, e);
    if (f) return { u: f.u, v: f.v, n: f.normal };
  }
  if (model.oriented(name).normal === undefined) return flat();
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

/** How a kind a module declares is laid out (../modules.ts): its frame, as `curveFrame` answers for a circle. */
export type CurveFrameFn = (model: Model, e: Entity) => ArcFrame | null;

const kindFrames = new Map<string, CurveFrameFn>();

/** Registers how `kind` is laid out — drawn, boxed, looped and picked by that frame from then on. */
export function defineCurveFrame(kind: string, frame: CurveFrameFn): void {
  kindFrames.set(kind, frame);
}

export function undefineCurveFrame(kind: string): void {
  kindFrames.delete(kind);
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
  // A kind a module declares is laid out as its declaration says (`defineCurveFrame`).
  const declared = kindFrames.get(e.kind);
  return declared ? declared(model, e) : null;
}

/**
 * **An exact curve with no frame** (docs/plans/spline.md): a kind a module
 * declares that is not a conic says what B-spline it is — its control points
 * in the world, three coordinates each (a 2D drawing at z = 0), its knots,
 * and whether it closes on itself. What a curve that is no circle is drawn,
 * picked, looped, swept and written by: the frame's counterpart for a curve
 * with no centre (`curvePath`).
 */
export interface CurvePath {
  curve: BSpline;
  closed: boolean;
}

/** How a kind a module declares is laid out when it is a B-spline (../modules.ts's `EntityDecl.path`). */
export type CurvePathFn = (model: Model, e: Entity) => CurvePath | null;

const kindPaths = new Map<string, CurvePathFn>();

/** Registers how `kind` is laid out as an exact B-spline. */
export function defineCurvePath(kind: string, path: CurvePathFn): void {
  kindPaths.set(kind, path);
}

export function undefineCurvePath(kind: string): void {
  kindPaths.delete(kind);
}

/** Whether a kind is laid out by a declared B-spline. */
export function hasCurvePath(kind: string): boolean {
  return kindPaths.has(kind);
}

/**
 * The B-spline an entity of a declared kind is, lifted to three coordinates —
 * or null for any other kind, or one that cannot be laid out as it stands.
 */
export function curvePath(model: Model, e: Entity): CurvePath | null {
  const declared = kindPaths.get(e.kind);
  if (!declared) return null;
  const p = declared(model, e);
  if (!p) return null;
  return { closed: p.closed, curve: { ...p.curve, ctrl: p.curve.ctrl.map(lift3) } };
}
