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
// **In 3D there is one more row: the sketch plane.** With a default frame set,
// a click lands on that frame's plane (see ../workplane.ts), and the point it
// makes is held there with `onPlane` — the same "the sketch you are drawing
// on" every Onshape point has without saying so. Only where the snap leaves the
// point anywhere to go: a click in empty space, along a curve, or at the
// projection of a point off the sketch (which pins nothing). A snap to a
// vertex, a midpoint or a crossing already pins the point outright, so a plane
// on top would be redundant where it agreed and a conflict where it did not.
// And only when the point really is on the plane — a snap can carry a click to
// geometry off it, and the snap wins (it is what was aimed at).

import type { PointerInfo, ToolContext } from "./tool.ts";
import type { OptionSpecs } from "./options.ts";
import type { Model } from "../model.ts";
import { construction } from "../operations.ts";
import type { Snap } from "../snapping.ts";
import { coincident, midpoint, onPlane } from "../relations/basic.ts";
import { onCircle, pointOnLine } from "../relations/geometry.ts";
import { planeOfRef, sketchPlaneRef } from "../workplane.ts";
import { sketchFrameFor } from "../sketchface.ts";
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
 */
export function placePoint(ctx: ToolContext, info: PointerInfo, name?: string, plane?: string | null): string {
  const placed = ctx.model.addPoint(info.world, name).name;
  if (info.snap) inferFromSnap(ctx.model, placed, info.snap);
  // A projected snap leaves the point as free as empty space does — it is on
  // the sketch, at a position borrowed from something that is not — so it is
  // held on the plane exactly as a click in empty space would be.
  const free = !info.snap || info.snap.kind === "curve" || info.snap.kind === "projected";
  if (free) holdOnSketchPlane(ctx.model, placed, plane);
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
 * Whether the region under a click is **a solid's face** — a loop every member
 * of which one feature names (its profile, its lid's twins, a wall's quad) —
 * and so a plane a curve drawn there lies on. A plain sketch loop is not one:
 * a circle drawn inside a rectangle on the ground lies on the ground already.
 */
function isSolidFace(model: Model, members: readonly { name: string }[]): boolean {
  if (!members.length) return false;
  let common: string[] = model.featuresNaming(members[0].name).map((f) => f.name);
  for (const m of members.slice(1)) {
    const mine = model.featuresNaming(m.name).map((f) => f.name);
    common = common.filter((f) => mine.includes(f));
  }
  return common.length > 0;
}

/**
 * The plane a curve tool's gesture stands on, and the two relations that hold
 * the curve there. **No frame is made for it** — a circle carries its own
 * normal (see `CircleEntity`); the owner, twice: *"why does it first create a
 * frame? … can I not just create a circle or whatever in space?"*
 * (docs/plans/frameless-curves.md).
 *
 * Where the curve lies is decided at the gesture's first click, as a plane
 * reference (`Model.planeKind`):
 *
 * 1. the plane the user chose to sketch on — the work plane (sketch on face)
 *    or the default frame (`sketchPlaneRef`) — when there is one: a sketch is
 *    drawn on its own plane, as in Onshape, whatever is under the cursor;
 * 2. else **the face of a solid under the cursor** (`regionAt`, the nearest loop
 *    at the pixel, every member of it one feature's): its own plane,
 *    `sketchFrameFor`'s three points facing the viewer, or a circle's;
 * 3. else the origin's x–y plane, where the click landed.
 *
 * Every click of the gesture is read on that plane (`settle`), and the commit
 * holds the curve there with **ordinary, visible, deletable relations** — its
 * centre `onplane` (unless a snap already pinned it, or it was held as it was
 * placed) and its normal `par` to the plane's (`hold`). Delete the `par` and the
 * circle is free to turn in space; constrain its normal to a line instead and
 * it follows the line.
 */
export class CurvePlane {
  private ctx: ToolContext;
  /** The plane the gesture stands on: its reference, and as view.ts's Plane. */
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
    let ref = sketchPlaneRef(m);
    if (ref === null && !p.snap) {
      const hit = this.ctx.regionAt?.(p.screen) ?? null;
      const loop = hit ? hit.loops[hit.index] : null;
      if (hit && loop && isSolidFace(m, loop.members)) {
        try {
          ref = sketchFrameFor(m, loop, hit.toward);
        } catch {
          ref = null; // a face no plane can be made of: the ground, then
        }
      }
    }
    ref ??= m.drawingPlane();
    this.ref = ref;
    this.on = planeOfRef(m, ref);
    return true;
  }

  /** The plane reference the gesture stands on, or null in 2D. */
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
   * landed on another plane (the ground, under a face) is read again on this
   * one, at the same pixel; a snapped click is where it was aimed, and stays.
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
    return { ...info, world: w, plane: flip ? { ...plane, v: plane.v.map((c) => -c) } : plane };
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
   * plane there is.
   */
  hold(curve: string, centre: string): string[] {
    const m = this.ctx.model;
    if (!this.ref || !this.on || m.dim !== 3) return [];
    const made: string[] = [];
    const held = m.relationsNaming(centre).some((r) => r.op === "onPlane" && r.args[0] === centre && r.args[1] === this.ref);
    if (!held && liesOn(this.on, m.coords(centre))) made.push(onPlane(m, centre, this.ref));
    made.push(parallel(m, curve, normalRef(m, this.ref)));
    return made;
  }

  /** The gesture was abandoned. */
  cancel(): void {
    this.ref = null;
    this.on = null;
  }
}

/**
 * The direction reference for a plane's normal — what `par` takes to hold a
 * curve's normal to it: a frame's `"f1.z"` (the origin's `"origin.z"`), and a
 * curve or a face's `"p1.p2.p3"` as themselves (relations/refs.ts reads both
 * as their normals).
 */
export function normalRef(model: Model, ref: string): string {
  return model.planeKind(ref) === "frame" ? `${ref}.z` : ref;
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
 * Holds a point on the plane the user chose to sketch on with `onPlane` — the
 * work plane or the default frame (`sketchPlaneRef`), or `plane` when the
 * caller says which (a curve tool's gesture plane, which may be a solid's
 * face) — if this is a 3D model and the point is on it. Returns the relation's
 * name, or null when nothing applied. With no plane chosen and none given,
 * nothing: a point drawn on the ground in a fresh document stays free, as it
 * always did, and only a curve — which needs its orientation held by
 * something — is held there (`CurvePlane.hold`).
 *
 * Exported for the points a tool makes *without* a click of their own — a
 * rectangle's two derived corners, a three-point circle's centre — which are
 * on the sketch because they were laid out there, and have to stay on it for
 * the same reason the clicked ones do.
 */
export function holdOnSketchPlane(model: Model, pointName: string, given?: string | null): string | null {
  const ref = given ?? sketchPlaneRef(model);
  if (ref === null || model.dim !== 3) return null;
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
}
