// Sketching on a face: the three points of a loop that make its sketch plane.
//
// **A face is not an entity, and does not need to be one to be sketched on.**
// Every planar face of a solid is a closed loop of real entities — a lid is the
// profile's twin loop, a wall the quad of a profile edge, two side edges and
// the twin edge, a partial revolve's end the profile's turned twins — and a
// plain sketch loop, with no solid behind it yet, is a face in the same sense.
// `loopAt` already finds the loop under a pixel, so a face is something a tool
// *asks about*, exactly as the extrude tool asks about a region; the canvas
// still selects nothing there, and faces stay display only (see faces.ts).
//
// And **a frame built from three of the loop's own points is the sketch
// plane**: `plane(a, b, c)` — origin, x-ref, y-ref — journals as the ordinary
// call it is, needs no new entity kind, and *follows the solid* because its
// points are the solid's: set the depth and the lid's frame rises with the lid,
// read as a datum like every frame. Nothing about the face is stored; the
// journal carries three point names.
//
// **Orientation is the whole trick: +z toward the viewer.** A sketch plane on a
// solid's face must have its +z pointing *out* of the solid, so a positive
// extrude on it adds material rather than cutting into it (Onshape's
// behaviour). Back-face culling makes that free. A face the click can land on
// is the nearest one the pixel's ray meets (`loopAt`), and the first surface a
// ray meets on a closed solid is one it enters through — one whose outward
// normal faces the viewer. So the rule needs no idea which side the material is
// on, and is one rule for solids and plain loops alike: order the three points
// so `(b − a) × (c − a)` points toward the camera, swapping b and c if not —
// the frame's +z is that cross product's direction, since `frameBasis`
// straightens the y-ref against +x without changing which side of it it is on.
//
// Pure, at loops.ts's height: model, loop and line of sight in, three names
// out. The line of sight rather than the view, because the tool asking has no
// camera: it has the region it was handed (`RegionHit.toward`), which carries
// the side it was seen from.

import type { Model } from "./model.ts";
import { PARALLEL_SINE, type Loop } from "./loops.ts";
import { frameBasis } from "./relations/refs.ts";
import { liesOn } from "./view.ts";
import { cross3, dot3, lift3, sub3 } from "./vec3.ts";

/**
 * A plane seen so nearly edge-on that the cosine between its normal and the
 * line of sight is below this shows the viewer neither side, so neither is
 * "toward" them. `loopAt` skips such a loop long before this (`EDGE_ON_PX`);
 * this is for a caller that asks about one anyway.
 */
const EDGE_ON_COS = 1e-9;

/** The sine of the angle at `a` in the triangle a, b, c — zero when the three are on one line. */
function turn(a: number[], b: number[], c: number[]): number {
  const [ab, ac] = [sub3(b, a), sub3(c, a)];
  const lengths = Math.hypot(...ab) * Math.hypot(...ac);
  return lengths === 0 ? 0 : Math.hypot(...cross3(ab, ac)) / lengths;
}

/**
 * The three points — origin, x-ref, y-ref — of a sketch plane on `loop`, its
 * +z on the side of `toward`, the direction out of the screen at whoever is
 * looking (`viewAxes(view).toward`): what `plane(a, b, c)` takes to start a
 * sketch on that face.
 *
 * The loop's own vertices are preferred, in loop order, and **a corner with its
 * two neighbours** first: the first vertex that is not on a straight run is
 * the origin, and the vertices either side of it are the x-ref and y-ref. So
 * the sketch's +x runs along an edge of the face and `lookAt` shows the face
 * square to the screen — a rectangle's wall comes up level, not tipped. (The
 * first cut took the first three vertices and swapped the last two to turn the
 * plane over, which put +x along the diagonal whenever the face was seen from
 * its back: a wall then came up tilted by its own aspect ratio. Found by
 * looking at the screenshot.) A point partway along an edge is no corner, and
 * is skipped. Failing every corner, any three of the vertices off one line;
 * failing that, an arc's centre is a point of the loop's plane too (its rim,
 * and so its ends, lie in the plane through it), which is what a loop of only
 * two vertices — a lens of two arcs, a line closed by an arc — has to offer.
 *
 * **A whole circle has only its centre**, and it also has its frame, whose
 * three points span the circle's plane: they are used, with the x-ref and
 * y-ref swapped when the frame's +z faces away — so a lid that is a circle
 * still gets a plane facing out. That needs the frame's plane to *be* the
 * circle's, and a circle is held only parallel to its frame (the frame is an
 * orientation, not a constraint); one lying off it is refused rather than
 * given a plane beside its face. A frame without a y-ref cannot be turned over
 * that way, and is refused by name.
 *
 * Throws, with the reason, in a model without 3D frames, for a loop seen
 * exactly edge-on, and when no three of the loop's points are off one line.
 */
export function sketchFrameFor(model: Model, loop: Loop, toward: number[]): [string, string, string] {
  if (model.dim !== 3) {
    throw new Error("a sketch plane on a face is a 3D frame — a 2D drawing is one plane already");
  }
  const facing = (n: number[]): number => {
    const len = Math.hypot(...n);
    const cos = len === 0 ? 0 : dot3(n, toward) / len;
    if (Math.abs(cos) < EDGE_ON_COS) {
      throw new Error(`the loop of ${members(loop)} is edge-on to the view — neither side of it faces you; turn the view and try again`);
    }
    return cos;
  };

  if (loop.members.length === 1 && loop.members[0].from === null) return circleFrame(model, loop, facing);

  const where = new Map<string, number[]>();
  const at = (p: string): number[] => {
    if (!where.has(p)) where.set(p, lift3(model.coords(p)));
    return where.get(p)!;
  };
  /** a, b, c ordered so the plane faces the viewer: b and c swapped if not. */
  const oriented = (a: string, b: string, c: string): [string, string, string] =>
    facing(cross3(sub3(at(b), at(a)), sub3(at(c), at(a)))) > 0 ? [a, b, c] : [a, c, b];

  const vertices = loop.members.map((m) => m.from!);
  const n = vertices.length;
  for (let i = 0; i < n; i++) {
    const [v, next, prev] = [vertices[i], vertices[(i + 1) % n], vertices[(i + n - 1) % n]];
    if (next !== prev && turn(at(v), at(next), at(prev)) > PARALLEL_SINE) return oriented(v, next, prev);
  }
  const centres = loop.members.flatMap((m) => {
    const e = model.entities.get(m.name);
    return e?.kind === "arc" ? [e.center] : [];
  });
  const candidates = [...new Set([...vertices, ...centres])];
  for (let i = 0; i < candidates.length; i++) {
    for (let j = i + 1; j < candidates.length; j++) {
      for (let k = j + 1; k < candidates.length; k++) {
        const [a, b, c] = [candidates[i], candidates[j], candidates[k]];
        if (turn(at(a), at(b), at(c)) > PARALLEL_SINE) return oriented(a, b, c);
      }
    }
  }
  throw new Error(`the loop of ${members(loop)} has no three points off one line to make a plane of — `
    + "a plane on it needs a third point: plane(a, b, c) with one of your own");
}

/** A whole circle's plane: its frame's own three points, turned over if they face away. */
function circleFrame(model: Model, loop: Loop, facing: (n: number[]) => number): [string, string, string] {
  const name = loop.members[0].name;
  const circle = model.circular(name);
  const plane = circle.plane;
  if (plane === undefined) throw new Error(`"${name}" names no frame, so it has no plane to sketch on`);
  const f = model.frame(plane);
  if (f.yref === undefined) {
    throw new Error(`"${name}"'s frame "${plane}" has no y-ref, so it cannot be turned to face you — `
      + "plane(a, b, c) with points of your own");
  }
  const { origin, ux, uy, uz } = frameBasis(model, plane)();
  const centre = lift3(model.coords(circle.center));
  if (!uz || !liesOn({ origin: lift3(origin), u: lift3(ux), v: lift3(uy) }, centre)) {
    throw new Error(`"${name}" lies parallel to its frame "${plane}" but off its plane, so "${plane}"'s points `
      + "are not on the face — plane(a, b, c) with points of your own on it");
  }
  return facing(uz) > 0 ? [f.origin, f.xref, f.yref] : [f.origin, f.yref, f.xref];
}

function members(loop: Loop): string {
  return loop.members.map((m) => m.name).join(",");
}

/**
 * The command that starts a sketch on `loop`: `plane("a", "b", "c")`, typed by
 * the sketch tool and the "Sketch on this face" menu item alike, so the two
 * cannot make different planes of one face. Throws as `sketchFrameFor` does.
 */
export function sketchOnFaceCommand(model: Model, loop: Loop, toward: number[]): string {
  return `plane(${sketchFrameFor(model, loop, toward).map((p) => JSON.stringify(p)).join(", ")})`;
}
