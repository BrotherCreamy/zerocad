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
import type { Model } from "../model.ts";
import type { Snap } from "../snapping.ts";
import { coincident, midpoint, onPlane } from "../relations/basic.ts";
import { onCircle, pointOnLine } from "../relations/geometry.ts";
import { framePlane } from "../workplane.ts";
import { liesOn } from "../view.ts";
import { cross3, dot3, lift3, sub3 } from "../vec3.ts";

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
  // A projected snap leaves the point as free as empty space does — it is on
  // the sketch, at a position borrowed from something that is not — so it is
  // held on the plane exactly as a click in empty space would be.
  const free = !info.snap || info.snap.kind === "curve" || info.snap.kind === "projected";
  if (free) holdOnSketchPlane(ctx.model, placed);
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
 * Three decimals, the menu's and the hover tag's precision: a plane's origin
 * typed into the log is read by a person, and `pt(512.3456789012345, …)` would
 * teach the command less well than `pt(512.346, …)` for a difference no zoom
 * shows. Negative zero is written as zero.
 */
function num(v: number): string {
  const r = Math.round(v * 1000) / 1000;
  return String(r === 0 ? 0 : r);
}

/**
 * The line a curve tool types when its first click lands in a 3D model with
 * no default frame: `plane(pt(x, y, z), null, null, { look: false })` — a
 * frame whose origin is the click and whose refs `frame()` seeds a span along
 * the screen's right and up (the kernel's x and y in a view never turned), so
 * its plane is the working plane the click already landed on: the one facing
 * the viewer. Made the default, as `plane` does, and the view left alone.
 *
 * The origin is rounded (see `num`), which moves the plane a fraction of a
 * thousandth along its normal in a turned view; the refs are seeded by the
 * command layer from the exact screen axes, so its orientation is exact.
 */
export function clickPlaneCommand(at: number[]): string {
  return `plane(pt(${at.map(num).join(", ")}), null, null, { look: false })`;
}

/**
 * The plane a curve tool's gesture stands on. A circle or an arc in a 3D model
 * is given the default frame's plane (see `CircleEntity`), and **with no
 * default frame the tool makes one** at its first click, rather than refusing:
 * nobody should have to know what a frame is to draw a circle. It types
 * `clickPlaneCommand` through the command line (`ctx.run`) — so the log shows
 * the line, and the journal and the undo step are those of the typed call —
 * and the gesture carries on. This is not a world datum: it is the working
 * plane at the click, seeded as a typed `frame()` is, and exists because the
 * click asked for a plane (the register's no-world-frame entry).
 *
 * The typed line runs asynchronously, so a commit that arrives before it has
 * settled is held until it has, and then made as a step of its own (`act`) —
 * otherwise it would land inside the plane's undo step. In practice the line
 * has gone in long before a drag ends or a second click comes.
 *
 * Headless, with no command line to type into, there is no plane to make, and
 * the first click is refused in the model's own words — through `ctx.log`
 * where there is one, thrown where there is not: the model's "no default
 * frame" stays the guard under the command layer.
 */
export class CurvePlane {
  private ctx: ToolContext;
  private tool: string;
  /** The typed plane, while it is still going in. */
  private pending: Promise<void> | null = null;
  /** Which gesture the pending plane belongs to, so a cancel can let it go. */
  private token: object | null = null;
  /** The click the plane was made at — taken on the screen-facing plane, before the frame's existed. */
  private madeAt: PointerInfo | null = null;

  constructor(ctx: ToolContext, tool: string) {
    this.ctx = ctx;
    this.tool = tool;
  }

  /**
   * Asked on a gesture's first click. True when it may go on — on the default
   * frame, or on the plane just typed — and false when it was refused.
   */
  begin(p: PointerInfo): boolean {
    const ctx = this.ctx;
    this.madeAt = null;
    if (ctx.model.dim !== 3) return true;
    try {
      ctx.model.resolveFrame();
      return true;
    } catch (e) {
      if (!ctx.run || !ctx.act) {
        const why = `${this.tool}: ${e instanceof Error ? e.message : e}`;
        if (!ctx.log) throw new Error(why);
        ctx.log(why);
        return false;
      }
    }
    const token = {};
    this.token = token;
    this.madeAt = p;
    this.pending = Promise.resolve(ctx.run(clickPlaneCommand(p.world))).finally(() => {
      if (this.token === token) this.pending = null;
    });
    return true;
  }

  /** Whether the plane typed for this gesture is still going in. */
  get typing(): boolean {
    return this.pending !== null;
  }

  /**
   * `info` as the commit should read it: the click the plane was made at moved
   * onto that plane, which the rounded origin can have put a fraction of a
   * thousandth off the one the click landed on — so the point is on the sketch
   * and `holdOnSketchPlane` holds it there. Every later click landed on the
   * frame's plane already, and a snapped one is where it was aimed.
   */
  settle(info: PointerInfo): PointerInfo {
    if (info !== this.madeAt || info.snap) return info;
    const plane = framePlane(this.ctx.model);
    if (!plane) return info;
    const n = cross3(plane.u, plane.v);
    const len = Math.hypot(...n);
    if (!(len > 0)) return info;
    const w = lift3(info.world);
    const off = dot3(sub3(w, lift3(plane.origin)), n) / (len * len);
    return { ...info, world: w.map((c, i) => c - off * n[i]) };
  }

  /** Runs `commit` now — or, while the plane is still going in, once it is, as a step of its own. */
  commit(commit: () => void): void {
    if (!this.pending) {
      commit();
      return;
    }
    const token = this.token;
    void this.pending.then(() => {
      if (this.token === token) this.ctx.act!(commit);
    });
  }

  /** The gesture was abandoned: a plane still going in stays, as typed, and nothing waits on it. */
  cancel(): void {
    this.token = null;
    this.pending = null;
    this.madeAt = null;
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
