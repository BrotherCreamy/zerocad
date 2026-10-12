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
// point anywhere to go: a click in empty space, or along a curve. A snap to a
// vertex, a midpoint or a crossing already pins the point outright, so a plane
// on top would be redundant where it agreed and a conflict where it did not.
// And only when the point really is on the plane — a snap can carry a click to
// geometry off it, and the snap wins (it is what was aimed at).

import type { PointerInfo, ToolContext } from "./tool.ts";
import type { Model } from "../model.ts";
import type { Snap } from "../snapping.ts";
import { coincident, midpoint, onPlane } from "../relations/basic.ts";
import { onCircle, pointOnLine } from "../relations/geometry.ts";
import { framePlane } from "../workplane.ts";
import { liesOn } from "../view.ts";

/**
 * Creates the point a click asked for and applies whatever constraint the
 * snap it landed on implies. Returns the new point's name.
 *
 * Every tool that puts a point where the user clicked should go through here
 * rather than calling `model.addPoint` directly — that is the whole of what
 * makes a drawn shape actually attach to the one it was drawn onto.
 */
export function placePoint(ctx: ToolContext, info: PointerInfo, name?: string): string {
  const placed = ctx.model.addPoint(info.world, name).name;
  if (info.snap) inferFromSnap(ctx.model, placed, info.snap);
  if (!info.snap || info.snap.kind === "curve") holdOnSketchPlane(ctx.model, placed);
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
 * Holds a point on the default frame's plane with `onPlane`, if this is a 3D
 * model with a default frame and the point is on its plane. Returns the
 * relation's name, or null when nothing applied.
 *
 * Exported for the points a tool makes *without* a click of their own — a
 * rectangle's two derived corners, a three-point circle's centre — which are
 * on the sketch because they were laid out there, and have to stay on it for
 * the same reason the clicked ones do.
 */
export function holdOnSketchPlane(model: Model, pointName: string): string | null {
  const plane = framePlane(model);
  if (!plane || !liesOn(plane, model.coords(pointName))) return null;
  return onPlane(model, pointName, model.defaultFrame);
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
  }
}

/** "This point lies on that curve", whichever kind of curve it is. */
function onCurve(model: Model, pointName: string, curveName: string): void {
  const target = model.entities.get(curveName);
  if (!target || target.name === pointName) return;
  if (target.kind === "line") pointOnLine(model, pointName, target.name);
  else if (target.kind === "circle" || target.kind === "arc") onCircle(model, pointName, target.name);
}
