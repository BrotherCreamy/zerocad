// The plane being sketched on, as something to draw and to name
// (docs/plans/mode-feedback.md; the owner: "it isnt obvious to me that is
// whats happening. needs clearer visual/contextual feedback to the user").
//
// A sketch is a plane — the work plane, or the default frame's (workplane.ts's
// `drawingPlaneRef`) — and nothing drew it: the camera turned square to it when
// it was set, and that was the only sign. This module answers the questions the
// drawing pass and the mode chip ask of it, and draws nothing:
//
//   * **which face it was taken from** (`activePlane`): the face of a feature
//     whose plane it is and whose outline its points lie on — named by the
//     feature and the side, `e1's top` — else the plain sketch loop they are
//     corners of, else nothing but the plane itself (a frame, or points no
//     loop joins), which is drawn as a bounded patch (`planePatch`);
//   * **what is in focus** (`focusOf`): what is held on the plane — by the
//     relation that holds it there, `onPlane(p, ref)`, never by where it
//     happens to lie — and the solid the face belongs to. Everything else is
//     drawn one step dimmed (`outOfFocusInk`).
//
// Pure, over a model and a pixel scale — no canvas, no view — at quiet.ts's
// height: the drawing pass in main.ts asks it once a frame. A plane is not an
// entity and is never picked; none of this reaches the pick.

import { memberName, referentsOf, type Entity, type Model } from "./model.ts";
import { featureFaces, loopOutlines, type Face } from "./faces.ts";
import { findLoops, type Loop } from "./loops.ts";
import { planeAxes } from "./curveplane.ts";
import { regionOf } from "./operations.ts";
import { planeLabel, planeNormalRef, drawingPlaneRef } from "./workplane.ts";

/** The plane being sketched on, as drawn and named. */
export interface ActivePlane {
  /** The plane reference, as the model holds it: `"p1.p2.p3"`, `"c3"`, `"f1"`. */
  ref: string;
  /**
   * What it was found to be: a feature's `face`; a plain sketch `loop` (no
   * solid yet); a `frame`'s plane (the origin included); or a `plane` its points
   * span that no loop joins.
   */
  kind: "face" | "loop" | "frame" | "plane";
  /** What the chip calls it: `e1's top`, `f1`, `c3`, `loop l1,l2,l3…`. */
  label: string;
  /** The feature whose face it is, for `face`. */
  feature: string | null;
  /** That face's side, for `face`: `top`, `bottom`, `side`, `start`, `end`. */
  side: string | null;
  /** The plane: a point on it, its in-plane axes and its normal, unit length. */
  origin: number[];
  u: number[];
  v: number[];
  n: number[];
  /** The face's or the loop's closed outlines in the world, filled even-odd — null for a frame's or a bare plane's patch. */
  outlines: number[][][] | null;
  /** The loop's members, for `loop` — in focus with what is held. */
  members: string[];
}

/** A face's side, in the words the chip uses: an extrude's caps are its bottom and top, a revolve's its start and end. */
export function sideName(feature: { kind: string }, face: Face["kind"]): string {
  if (face === "wall") return "side";
  if (feature.kind === "revolve") return face === "base" ? "start" : "end";
  return face === "base" ? "bottom" : "top";
}

const dot = (a: number[], b: number[]) => a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
const sub = (a: number[], b: number[]) => [a[0] - b[0], a[1] - b[1], a[2] - b[2]];
const lift = (p: number[]) => [p[0] ?? 0, p[1] ?? 0, p[2] ?? 0];
const len = (a: number[]) => Math.hypot(a[0], a[1], a[2]);

/** How far `p` is from the polyline `pts`, closed. */
function toOutline(p: number[], pts: number[][]): number {
  let best = Infinity;
  for (let i = 0; i < pts.length; i++) {
    const a = pts[i], b = pts[(i + 1) % pts.length];
    const ab = sub(b, a), ap = sub(p, a);
    const L = dot(ab, ab);
    const t = L > 0 ? Math.max(0, Math.min(1, dot(ap, ab) / L)) : 0;
    best = Math.min(best, len(sub(ap, ab.map((c) => c * t))));
  }
  return best;
}

/** The size of a set of outlines: their bounding box's diagonal. */
function sizeOf(outlines: number[][][]): number {
  const all = outlines.flat();
  const lo = [0, 1, 2].map((i) => Math.min(...all.map((p) => p[i])));
  const hi = [0, 1, 2].map((i) => Math.max(...all.map((p) => p[i])));
  return len(sub(hi, lo));
}

/**
 * The points a plane reference was made from, as places a face's outline must
 * run through: three points' coordinates, or for a curve, its centre and its
 * radius (a round face's outline is its rim — every vertex that far from the
 * centre). Null for a frame, which is no face's.
 */
function anchorsOf(model: Model, ref: string): { points: number[][] } | { centre: number[]; radius: number } | null {
  const kind = model.planeKind(ref);
  if (kind === "points") return { points: referentsOf(ref).map((p) => lift(model.coords(p))) };
  if (kind === "curve") {
    const e = model.entities.get(ref) as Extract<Entity, { kind: "circle" | "arc" | "ellipse" }>;
    if (e.kind === "ellipse") return null;
    return { centre: lift(model.coords(e.center)), radius: model.radius(ref) };
  }
  return null;
}

/** Whether a face lies in the plane and its outline runs through the anchors. */
function faceMatches(face: Face, n: number[], origin: number[], anchors: NonNullable<ReturnType<typeof anchorsOf>>): boolean {
  if (Math.abs(Math.abs(dot(face.normal, n)) - 1) > 1e-6) return false;
  const size = sizeOf(face.outlines);
  // A hundredth of the face: the outline of a round face is its rim sampled at
  // the drawing's resolution, so a point on the true rim is a sagitta off it.
  const tol = Math.max(1e-6, 0.01 * size);
  if (Math.abs(dot(sub(face.centroid, origin), n)) > tol) return false;
  if ("points" in anchors) return anchors.points.every((p) => face.outlines.some((o) => toOutline(p, o) <= tol));
  const rim = face.outlines[0];
  return rim.every((p) => Math.abs(len(sub(p, anchors.centre)) - anchors.radius) <= tol);
}

/** The loop a points reference is three corners of, or a curve reference's own loop — the smallest — or -1. */
function loopOf(loops: Loop[], model: Model, ref: string): number {
  const kind = model.planeKind(ref);
  const hits: number[] = [];
  loops.forEach((loop, i) => {
    if (kind === "curve") {
      if (loop.members.some((m) => m.name === ref && m.span === null)) hits.push(i);
      return;
    }
    const corners = new Set(loop.members.flatMap((m) => [m.from, m.to]));
    if (referentsOf(ref).every((p) => corners.has(p))) hits.push(i);
  });
  hits.sort((a, b) => Math.abs(loops[a].area) - Math.abs(loops[b].area) || a - b);
  return hits.length ? hits[0] : -1;
}

/**
 * **What is drawn, and dimmed around, is the work plane** — what `workplane()`
 * sets, which is what sketch on face sets — not a default frame on its own:
 * the default frame is already drawn heavier (main.ts's `drawFrame`) and is
 * named in the chip, and under it the drawing typed with `pt()` is held by no
 * relation, so dimming by relation would dim the whole of it. main.ts asks
 * with `model.workPlane` for the tint and the focus, and with the default
 * frame for the chip's name alone.
 *
 * The plane being sketched on (`ref`, by default the work plane else the
 * default frame) — or null when none is chosen (the ground is
 * where clicks land, and is not a mode: the owner's "just put the circle right
 * there"), the model is 2D, or the plane has collapsed. `scale` is pixels per
 * world unit, which round faces' outlines are sampled at.
 *
 * A frame is named by its name. A plane of points or of a curve is matched to
 * a face of a feature first, in the order the features were made — the face in
 * that plane whose outline runs through all of its points (a corner and its two
 * neighbours, as sketch on face takes them) or, for a round face, the rim of
 * its circle — then to the plain loop they are corners of, then left a plane.
 */
export function activePlane(model: Model, scale: number, ref: string | null = drawingPlaneRef(model)): ActivePlane | null {
  if (ref === null || model.dim !== 3) return null;
  let axes: ReturnType<typeof planeAxes>;
  let anchors: ReturnType<typeof anchorsOf>;
  try {
    axes = planeAxes(model, ref);
    anchors = anchorsOf(model, ref);
  } catch {
    return null; // a name since deleted: the deletion clears the plane, and a frame drawn first may ask
  }
  if (!axes) return null;
  const { origin, u, v, n } = { origin: lift(axes.origin), u: lift(axes.u), v: lift(axes.v), n: lift(axes.n) };
  const base = { ref, origin, u, v, n, feature: null, side: null, members: [] as string[] };
  if (!anchors) return { ...base, kind: model.isFrame(ref) ? "frame" : "plane", label: planeLabel(ref), outlines: null };

  for (const f of model.features.values()) {
    if (model.hidden.has(f.name)) continue;
    const face = featureFaces(model, f, scale).find((fc) => faceMatches(fc, n, origin, anchors!));
    if (face) {
      const side = sideName(f, face.kind);
      return { ...base, kind: "face", label: `${f.name}'s ${side}`, feature: f.name, side, outlines: face.outlines };
    }
  }
  try {
    const loops = findLoops(model);
    const at = loopOf(loops, model, ref);
    if (at >= 0) {
      const indices = regionOf(loops, at);
      const outlines = loopOutlines(model, indices.map((i) => loops[i].members), scale);
      const names = loops[at].members.map((m) => m.name);
      const label = model.planeKind(ref) === "curve" ? ref : `loop ${names.slice(0, 3).join(",")}${names.length > 3 ? "…" : ""}`;
      if (outlines.length) return { ...base, kind: "loop", label, outlines, members: [...new Set(names)] };
    }
  } catch {
    // A loop that cannot be laid out is drawn as the plane it lies in.
  }
  return { ...base, kind: "plane", label: ref, outlines: null };
}

/** A bounded patch of a plane with a grid on it, in the world: what a frame's plane, or a bare one, is drawn as. */
export interface Patch {
  /** The four corners, in order round it. */
  corners: number[][];
  /** The grid's lines, each two world points. */
  lines: number[][][];
  /** The grid's spacing, in world units. */
  step: number;
}

/** The grid's spacing on screen at the least, in pixels: close enough to read as a grid, far enough to stay faint. */
export const GRID_PX = 32;
/** How many steps of grid the patch reaches past the drawing on it, and (below) the least it reaches from its origin. */
const PAD_STEPS = 1;
const LEAST_STEPS = 3;
/** More lines than this along a side and the step doubles: a grid is a hint of a plane, not a lattice to count. */
const MOST_LINES = 40;

/** The first of 1, 2 and 5 times a power of ten that is at least `x`. */
export function niceStep(x: number): number {
  if (!(x > 0) || !Number.isFinite(x)) return 1;
  const p = 10 ** Math.floor(Math.log10(x));
  for (const m of [1, 2, 5, 10]) if (m * p >= x * (1 - 1e-12)) return m * p;
  return 10 * p;
}

/**
 * The patch a plane is drawn as: **sized to the drawing** — the points held on
 * it, `points` — and the plane's own origin, padded by a step of grid; at
 * least three steps from the origin each way, so an empty plane still shows;
 * and **following the zoom**: the step is the first of 1, 2, 5 × 10ⁿ that is
 * `GRID_PX` on screen at `scale`, so zooming in or out changes the spacing and
 * never the lines' density on screen.
 */
export function planePatch(plane: Pick<ActivePlane, "origin" | "u" | "v">, points: readonly number[][], scale: number): Patch {
  let step = niceStep(GRID_PX / scale);
  const st = points.map((p) => {
    const d = sub(lift(p), plane.origin);
    return [dot(d, plane.u), dot(d, plane.v)];
  });
  const lo = [0, 1].map((i) => Math.min(-LEAST_STEPS * step, ...st.map((q) => q[i] - PAD_STEPS * step)));
  const hi = [0, 1].map((i) => Math.max(LEAST_STEPS * step, ...st.map((q) => q[i] + PAD_STEPS * step)));
  while ((hi[0] - lo[0]) / step > MOST_LINES || (hi[1] - lo[1]) / step > MOST_LINES) step *= 2;
  const a = lo.map((x) => Math.floor(x / step) * step);
  const b = hi.map((x) => Math.ceil(x / step) * step);
  const at = (s: number, t: number) => plane.origin.map((o, i) => o + s * plane.u[i] + t * plane.v[i]);
  const lines: number[][][] = [];
  for (let s = a[0] + step; s < b[0] - step / 2; s += step) lines.push([at(s, a[1]), at(s, b[1])]);
  for (let t = a[1] + step; t < b[1] - step / 2; t += step) lines.push([at(a[0], t), at(b[0], t)]);
  return { corners: [at(a[0], a[1]), at(b[0], a[1]), at(b[0], b[1]), at(a[0], b[1])], lines, step };
}

/**
 * **What is in focus while a plane is set** (docs/plans/mode-feedback.md): what
 * is *held on it* — chosen by the relation that holds it there, never by where
 * it lies, so a point that merely passes through the plane is not in the
 * sketch — and the solid the plane's face belongs to:
 *
 *   * a point held by `onPlane(p, ref)`, and the points the reference names;
 *   * a line whose two ends are in focus;
 *   * a circle, arc or ellipse whose centre is, or that a relation holds to the
 *     plane (the `par` on its normal: `par(c, ref)`, or `par(c, "f.z")` for a
 *     frame) — and the curve the reference names;
 *   * the frame the reference names;
 *   * for a face, everything its feature made (`owns`) and its profile, with
 *     their points; for a plain loop, its members and theirs.
 *
 * Everything else is drawn one step dimmed. Null with no plane set: nothing is
 * dimmed then.
 */
export function focusOf(model: Model, plane: ActivePlane | null): Set<string> | null {
  if (!plane) return null;
  const ref = plane.ref;
  const focus = new Set<string>();
  const pointsOf = (name: string) => {
    const e = model.entities.get(name);
    if (!e) return;
    focus.add(name);
    if (e.kind === "line") for (const r of e.refs) focus.add(r);
    else if (e.kind === "circle" || e.kind === "arc" || e.kind === "ellipse") {
      focus.add(e.center);
      if (e.kind === "arc") { focus.add(e.start); focus.add(e.end); }
    }
  };
  for (const r of referentsOf(ref)) pointsOf(r);
  if (model.isFrame(ref)) focus.add(ref);
  const normals = new Set([ref, `${ref}.z`, planeNormalRef(model, ref)]);
  const heldCurves = new Set<string>();
  for (const r of model.relations.values()) {
    if (r.op === "onPlane" && r.args[1] === ref && typeof r.args[0] === "string") focus.add(r.args[0]);
    if (r.op === "parallel" && r.args.length === 2 && typeof r.args[0] === "string" && typeof r.args[1] === "string" && normals.has(r.args[1])) {
      heldCurves.add(r.args[0]);
    }
  }
  if (plane.feature) {
    const f = model.features.get(plane.feature);
    for (const name of f?.owns ?? []) pointsOf(name);
    for (const loop of f?.loops ?? []) for (const m of loop) pointsOf(memberName(m));
  }
  for (const m of plane.members) pointsOf(m);
  for (const e of model.entities.values()) {
    if (e.kind === "line" && focus.has(e.refs[0]) && focus.has(e.refs[1])) focus.add(e.name);
    else if ((e.kind === "circle" || e.kind === "arc" || e.kind === "ellipse") && (focus.has(e.center) || heldCurves.has(e.name))) focus.add(e.name);
    // Any other curve — a spline, and whatever kind a module declares — by the
    // points it is built of (`refsOf`), every one of them in focus: a spline
    // drawn on the plane was dimmed for want of a line here (found in the
    // sketch-mode walkthrough). Points and frames have their own rules above.
    else if (e.kind !== "point" && e.kind !== "frame" && !focus.has(e.name)) {
      const refs = model.refsOf(e);
      if (refs.length && refs.every((p) => focus.has(p))) focus.add(e.name);
    }
  }
  return focus;
}

/** How much of its own colour an entity out of focus keeps; the rest is the canvas's ground. */
export const OUT_OF_FOCUS_KEEP = 0.45;
/** What an entity out of focus is taken toward: the canvas's own dark ground (index.html's body). */
const GROUND = [0x0a, 0x0e, 0x13];

/**
 * **The out-of-focus ink**: an entity's own colour taken most of the way to
 * the canvas's ground — one step dimmed, in the quiet-geometry family, its hue
 * kept so a free line out of focus is still a blue line, only duller. A solid
 * colour, not transparency, as `hiddenInk` is, so a pixel can be asked for it.
 */
export function outOfFocusInk(css: string): string {
  const m = /^#([0-9a-f]{2})([0-9a-f]{2})([0-9a-f]{2})$/i.exec(css);
  if (!m) return css;
  const rgb = [m[1], m[2], m[3]].map((h, i) => Math.round(OUT_OF_FOCUS_KEEP * parseInt(h, 16) + (1 - OUT_OF_FOCUS_KEEP) * GROUND[i]));
  return `#${rgb.map((c) => c.toString(16).padStart(2, "0")).join("")}`;
}
