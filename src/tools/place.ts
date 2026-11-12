// Constraint inference: the step where a tool that placed a point on existing
// geometry says so, in the model, as an ordinary constraint.
//
// This is what Onshape calls *inferencing* and SolidWorks calls automatic
// sketch relations, and the behaviour is deliberately theirs rather than
// invented here — click a vertex and your new point is coincident with it;
// click an edge and your point stays on that edge; click an edge's midpoint
// marker and it stays the midpoint. People arrive already knowing this.
//
// Two things it is not. It does **not** merge points: the new point is a new
// point, joined to what it snapped to by a constraint the user could have
// typed themselves and can delete when it was wrong. And it is not a separate
// switch — inference is downstream of snapping, so `snapping(false)` turns off
// both, one control, as in Onshape.
//
// Snapping (src/snapping.ts) already decides *what* was aimed at; all that is
// left is the mapping from its three kinds to the relation each one means:
//
//   point         an existing point      coincident(new, that point)
//   intersection  two curves crossing    the on-curve relation for *each* of them
//   midpoint      the middle of an edge  midpoint(new, that line)   — line form
//   curve         somewhere along a line pointOnLine(new, that line)
//   curve         somewhere on a rim     onCircle(new, that circle or arc)
//   projected     a point off the sketch nothing at all — a position aid
//
// The intersection row is the one worth reading twice. Two relations, not one:
// a point told only that it is on the line drifts along the line the moment
// anything moves, and the crossing it was placed at is gone. Constrained to
// both curves it *is* the crossing, and drag either curve and it rides.
//
// **In 3D there are two more rows: the sketch plane, and the face.** With a
// sketch plane chosen, a click lands on that plane (see ../workplane.ts), and
// the point it makes is held there with `onPlane` — the same "the sketch you
// are drawing on" every Onshape point has without saying so. With none chosen,
// a click on a solid's **face** lands on the face (the engine reads it there,
// `PointerInfo.face`), and a point placed on a flat face is held to it with
// `onPlane(p, "e1:l2")`, the face named by the line it is swept from and read off
// its feature's record (relations/solidref.ts) — docs/plans/click-on-face.md;
// the owner: *"if i am hovering over a face without an active on-plane
// constraint, it should constrain to the plane i am hovering over"*. Each
// click decides its own face, so a three-point circle can have a point on
// each of three faces. Either hold only where the snap leaves the point
// anywhere to go: a click in empty space, along a curve, or at the projection
// of a point off the sketch (which pins nothing). A snap to a vertex, a
// midpoint or a crossing already pins the point outright, so a plane on top
// would be redundant where it agreed and a conflict where it did not. And
// only when the point really is on the plane — a snap can carry a click to
// geometry off it, and the snap wins (it is what was aimed at). A round face
// (a cylinder's wall) places the point and holds nothing, and says so.

import type { PointerInfo, ToolContext } from "./tool.ts";
import type { OptionSpecs } from "./options.ts";
import type { Model } from "../model.ts";
import { construction } from "../operations.ts";
import type { Snap } from "../snapping.ts";
import { coincident, midpoint, onPlane } from "../relations/basic.ts";
import { onCircle, onEllipse, pointOnLine } from "../relations/geometry.ts";
import { onSpline } from "../relations/spline.ts";
import { isFacePlane, planeNormalRef, planeOfRef, drawingPlaneRef } from "../workplane.ts";
import { parallel } from "../relations/geometry.ts";
import type { Plane } from "../view.ts";
import { liesOn } from "../view.ts";
import { cross3, dot3, lift3, unit3 } from "../vec3.ts";

/**
 * Creates the point a click asked for and applies whatever constraint the
 * snap it landed on implies. Returns the new point's name.
 *
 * Every tool that puts a point where the user clicked should go through here
 * rather than calling `model.addPoint` directly — that is the whole of what
 * makes a drawn shape actually attach to the one it was drawn onto.
 *
 * `plane` is the gesture's plane (`CurvePlane.plane`) for a tool that has
 * one — a sketch plane, a face, or the ground — and what a point the gesture
 * re-read onto it is held to. A click that landed on a face of its own
 * (`info.face`, kept by `CurvePlane.settleOwn`) is held to that face instead:
 * each click decides its own surface (docs/plans/click-on-face.md).
 */
export function placePoint(ctx: ToolContext, info: PointerInfo, name?: string, plane?: string | null): string {
  const placed = ctx.model.addPoint(info.world, name).name;
  if (info.snap) inferFromSnap(ctx.model, placed, info.snap);
  // A projected snap leaves the point as free as empty space does — it is on
  // the sketch, at a position borrowed from something that is not — so it is
  // held on the plane exactly as a click in empty space would be.
  const free = !info.snap || info.snap.kind === "curve" || info.snap.kind === "projected";
  if (!free) return placed;
  const own = info.face?.flat ? info.face.name : null;
  holdOnChosenPlane(ctx.model, placed, own ?? plane);
  // A round face, or one only the kernel knows (a fillet's): the point is
  // where the click landed, and nothing holds it there — said, so the owner's
  // "constrain to the plane i am hovering over" is not quietly half-kept
  // (TODO.md files the `onsurface` it would take).
  if (info.face && !info.face.flat) {
    ctx.log?.(`${placed} placed on ${info.face.name} — a round face, or one only the kernel knows: nothing holds it there yet`, "guide");
  }
  return placed;
}

/**
 * Refuses a drawing tool in a model it cannot lay a shape out in. A shape needs
 * a plane to be drawn on: a 2D model is one, and a 3D model has the working
 * plane. Anything else has neither — and said here, by name, rather than as
 * whatever `addPoint` complains about three steps later.
 */
export function requirePlanar(model: Model, tool: string): void {
  if (model.dim !== 2 && model.dim !== 3) {
    throw new Error(`${tool} draws in a 2D or 3D model, and this one is ${model.dim}D`);
  }
}

/**
 * The plane a curve tool's gesture stands on, and the two relations that hold
 * the curve there. **No frame is made for it** — a circle carries its own
 * normal (see `CircleEntity`); the owner, twice: *"why does it first create a
 * frame? … can I not just create a circle or whatever in space?"*
 * (docs/plans/frameless-curves.md).
 *
 * Where the curve lies is decided at the gesture's first click, as a plane
 * reference (`Model.planeKind`, or a face's name):
 *
 * 1. the plane the user chose to sketch on — the work plane (sketch on face)
 *    or the default frame (`drawingPlaneRef`) — when there is one: a sketch is
 *    drawn on its own plane, as in Onshape, whatever is under the cursor;
 * 2. else **the face of a solid the click landed on** (`PointerInfo.face`,
 *    read by the engine off the faces drawn this frame): the face's own
 *    plane, facing the viewer, named by what it is swept from (`e1:l2`);
 * 3. else the origin's x–y plane, where the click landed.
 *
 * Every later click of a *shape* gesture — a drag's rim, a slot's second
 * centre — is read on that plane (`settle`); a click that is a point of its
 * own — a three-point circle's, a spline's — keeps the face it landed on
 * (`settleOwn`), so the circle may pass through three faces. The commit holds
 * the curve where it lies with ordinary, visible, deletable relations: its
 * centre `onplane` (unless a snap already pinned it, or it was held as it was
 * placed) and its normal `par` to the plane's (`hold`) — on a chosen plane
 * (case 1), and on a flat face (case 2: `onplane(p, "e1:l2")`,
 * `par(c, "e1:l2")`, docs/plans/click-on-face.md). Delete the `par` and the
 * circle is free to turn in space; constrain its normal to a line instead and
 * it follows the line. On the ground (case 3) nothing is held: the ground is
 * where the curve was drawn, not a relation (the owner: *"every sketch is a 3D
 * sketch, unless you enter into active on-plane constraint"*,
 * docs/plans/profiles-held.md).
 */
export class CurvePlane {
  private ctx: ToolContext;
  /** The plane the gesture stands on: its reference (a face's name, a plane reference, or null for a round face), and as view.ts's Plane. */
  private ref: string | null = null;
  private on: Plane | null = null;

  constructor(ctx: ToolContext, _tool: string) {
    this.ctx = ctx;
  }

  /** Asked on a gesture's first click: decides the plane. Always goes on. */
  begin(p: PointerInfo): boolean {
    const m = this.ctx.model;
    this.ref = null;
    this.on = null;
    if (m.dim !== 3) return true;
    const chosen = drawingPlaneRef(m);
    if (chosen === null && p.face && p.plane) {
      // The face the click landed on, as the engine read it — facing the
      // viewer. A round face has a plane to lay the gesture out on (the piece
      // of it under the pixel) and no reference to hold anything to.
      this.on = p.plane;
      this.ref = p.face.flat ? p.face.name : null;
      return true;
    }
    const ref = chosen ?? m.drawingPlane();
    this.ref = ref;
    this.on = planeOfRef(m, ref);
    return true;
  }

  /** The plane reference the gesture stands on, or null in 2D (and on a round face, which holds nothing). */
  get plane(): string | null {
    return this.ref;
  }

  /**
   * The same plane as a place — a point on it and two directions in it — or
   * null in 2D: what the curve tools lay their closed forms out on
   * (curvemethod.ts's `Sheet`) and ask whether a curve lies in.
   */
  get surface(): Plane | null {
    return this.on;
  }

  /**
   * The normal a curve drawn on the plane is seeded with — the plane's own,
   * which for a face is the side facing the viewer — or null in 2D. A seed:
   * `hold` is what keeps it.
   */
  normal(): number[] | null {
    if (!this.on) return null;
    return unit3(cross3(lift3(this.on.u), lift3(this.on.v)));
  }

  /**
   * `info` as the commit should read it: on the gesture's plane. A click that
   * landed on another plane (the ground under a face, another face) is read
   * again on this one, at the same pixel — and loses the face it landed on,
   * since it is no longer on it; a snapped click is where it was aimed, and
   * stays.
   */
  settle(info: PointerInfo): PointerInfo {
    const plane = this.on;
    if (!plane || info.snap) return info;
    // Already on it: kept as it is, plane and all — the engine reports the
    // plane with its front toward the viewer, which is what a tool reads
    // "counter-clockwise as seen" by (the arc tools).
    if (liesOn(plane, info.world)) return info;
    const w = this.ctx.planeAt?.(info.screen, plane);
    if (!w) return info;
    // Read again on this plane, turned to face the way the engine's plane did.
    const was = info.plane;
    const flip = was && dot3(cross3(lift3(was.u), lift3(was.v)), cross3(lift3(plane.u), lift3(plane.v))) < 0;
    const { face: _face, ...rest } = info;
    return { ...rest, world: w, plane: flip ? { ...plane, v: plane.v.map((c) => -c) } : plane };
  }

  /**
   * `info` as a click that is **a point of its own** reads it: kept where it
   * landed when that was a solid's face — its own surface, which the point is
   * then held to — else on the gesture's plane as `settle` reads it. For the
   * clicks of a three-point circle, a spline's points: *"a 3 point circle with
   * each point on a different face of the rect prism"* (the owner,
   * docs/plans/click-on-face.md).
   */
  settleOwn(info: PointerInfo): PointerInfo {
    return info.face ? info : this.settle(info);
  }

  /** Runs `commit` — at once: there is never a typed plane to wait for. */
  commit(commit: () => void): void {
    commit();
  }

  /**
   * Holds `curve` on the gesture's plane: its centre `onplane` — unless the
   * centre is already held on it, or a snap put it somewhere off it (the snap
   * wins: it is what was aimed at) — and its normal `par` to the plane's.
   * Returns the relations made. Nothing in 2D, whose curves lie in the one
   * plane there is; nothing on the ground, or on a round face.
   */
  hold(curve: string, centre: string): string[] {
    if (!this.ref || !this.on) return [];
    return holdCurve(this.ctx.model, curve, centre, this.ref);
  }

  /** The gesture was abandoned. */
  cancel(): void {
    this.ref = null;
    this.on = null;
  }
}

/**
 * Holds `curve` on the plane `ref`: its centre `onplane` — unless the centre is
 * already held on it, or lies off it (a snap put it there, and the snap wins) —
 * and its normal `par` to the plane's. Returns the relations made; nothing in
 * 2D. `CurvePlane.hold`'s body, shared with the composites (shapes.ts), which
 * hold their construction circle and their arcs exactly as a circle drawn on
 * the plane is held.
 *
 * On a plane the user chose, or on a solid's flat face (`"e1:l2"`): the two
 * places a curve is held (docs/plans/click-on-face.md). Nowhere else:
 * the owner's "every sketch is a 3D sketch, unless you enter into active
 * on-plane constraint" — the ground lays the curve out and seeds its normal;
 * it is a position, not a relation (docs/plans/profiles-held.md).
 */
export function holdCurve(m: Model, curve: string, centre: string, ref: string): string[] {
  if (m.dim !== 3) return [];
  if (!isFacePlane(m, ref) && drawingPlaneRef(m) === null) return [];
  const on = planeOfRef(m, ref);
  if (!on) return [];
  const made: string[] = [];
  const held = m.relationsNaming(centre).some((r) => r.op === "onPlane" && r.args[0] === centre && r.args[1] === ref);
  if (!held && liesOn(on, m.coords(centre))) made.push(onPlane(m, centre, ref));
  made.push(parallel(m, curve, normalRef(m, ref)));
  return made;
}

/**
 * The direction reference for a plane's normal — what `par` takes to hold a
 * curve's normal to it: workplane.ts's `planeNormalRef`, under the name the
 * tools have always called it by.
 */
export function normalRef(model: Model, ref: string): string {
  return planeNormalRef(model, ref);
}

/**
 * What every drawing tool can be armed with: `construction`, so a circle can
 * be drawn as construction geometry from the start (docs/plans/
 * construction.md) — and, being a declared option, it is in the options panel
 * as a checkbox, typed as `arm("circle", { construction: true })` and
 * remembered like any option. One declaration, shared, so the drawing tools cannot
 * come to spell it several ways.
 */
export const DRAWING_OPTIONS: OptionSpecs = {
  construction: { default: false },
};

/**
 * Flags what a drawing tool just made as construction, if it was armed so — the
 * same `construction` operation a typed call runs, so the journal holds the same
 * entry the menu's Construction would have made, right after the shape.
 */
export function asArmed(ctx: ToolContext, ...curves: string[]): void {
  if (ctx.options.construction === true) construction(ctx.model, ...curves);
}

/**
 * Holds a point on the plane it was placed on with `onPlane`, if this is a 3D
 * model and the point is on it. Returns the relation's name, or null when
 * nothing applied. The plane is `given` — a curve tool's gesture plane, which
 * may be a solid's flat face (`"e1:l2"`, docs/plans/click-on-face.md), a
 * plane the user chose, or the ground — else the plane the user chose to
 * sketch on (the work plane or the default frame, `drawingPlaneRef`).
 *
 * **A face holds; the ground never does**: with no plane chosen and no face,
 * nothing, given or not — the owner's *"the default for sketch entities is no
 * plane. Every sketch is a 3D sketch, unless you enter into active on-plane
 * constraint."* A point or a curve drawn on the ground in a fresh document
 * stays free; a curve's orientation is its own normal, seeded facing the
 * plane the click landed on and held by nothing (docs/plans/profiles-held.md).
 *
 * Exported for the points a tool makes *without* a click of their own — a
 * rectangle's two derived corners, a polygon's other vertices — which are
 * on the surface because they were laid out there, and have to stay on it
 * for the same reason the clicked ones do.
 */
export function holdOnChosenPlane(model: Model, pointName: string, given?: string | null): string | null {
  if (model.dim !== 3) return null;
  // A face is a plane to hold to whether or not one was chosen (the owner's
  // "constrain to the plane i am hovering over"); anything else only on a
  // plane the user picked (see `holdCurve`).
  const face = isFacePlane(model, given);
  if (!face && drawingPlaneRef(model) === null) return null;
  const ref = face ? given : given ?? drawingPlaneRef(model);
  if (ref === null || ref === undefined) return null;
  const plane = planeOfRef(model, ref);
  if (!plane || !liesOn(plane, model.coords(pointName))) return null;
  return onPlane(model, pointName, ref);
}

/**
 * Applies the relation a snap implies, to a point that is already in the model.
 *
 * A snap whose target has since gone is ignored rather than throwing: the
 * inference is a convenience on top of a gesture, and losing the gesture over
 * it would be a poor trade. (Nothing removes entities today, so this is
 * defensive rather than reachable.)
 */
export function inferFromSnap(model: Model, pointName: string, snap: Snap): void {
  // An intersection is the one snap that means *two* things, and it applies
  // both: `onCurve` per target, each an ordinary relation with its own name,
  // its own glyph and its own `del`. Nothing here is special-cased downstream.
  if (snap.kind === "intersection") {
    for (const name of snap.targets) onCurve(model, pointName, name);
    return;
  }

  const target = model.entities.get(snap.targets[0]);
  if (!target || target.name === pointName) return;

  switch (snap.kind) {
    case "point":
      if (target.kind === "point") coincident(model, pointName, target.name);
      return;
    case "midpoint":
      // The *line* form, not mid(m, a, b): what was clicked is the middle of
      // this edge, which has to stay true if an operation later re-points it.
      if (target.kind === "line") midpoint(model, pointName, target.name);
      return;
    case "curve":
      onCurve(model, pointName, target.name);
      return;
    case "projected":
      // Nothing, and deliberately: the new point is *not* at the point it was
      // projected from — that one is off the sketch — so a coincidence would
      // be a lie, and "lies under that point, seen along the plane's normal"
      // is a relation this model does not have. The snap was a position aid.
      return;
  }
}

/** "This point lies on that curve", whichever kind of curve it is. */
function onCurve(model: Model, pointName: string, curveName: string): void {
  const target = model.entities.get(curveName);
  if (!target || target.name === pointName) return;
  if (target.kind === "line") pointOnLine(model, pointName, target.name);
  else if (target.kind === "circle" || target.kind === "arc") onCircle(model, pointName, target.name);
  else if (target.kind === "ellipse") onEllipse(model, pointName, target.name);
  else if (target.kind === "spline") onSpline(model, pointName, target.name);
}
