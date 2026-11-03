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
// points are the solid's: set the depth and the frame on the lid rises with
// the lid, read as a datum like every frame. (A circle's lid has only its
// centre, and gets a plane made through it — `MadePlane`.) Nothing about the
// face is stored; the journal carries the names of three points.
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
import { PARALLEL_SINE, isVirtual, type Loop } from "./loops.ts";
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
 * A sketch plane on a face that has no three points of its own to make it of —
 * a whole circle off its frame's plane, as every extruded circle's lid is — to
 * be **made**: its origin the circle's own centre (a point of the face, which
 * follows the lid), its x-ref and y-ref new points seeded on the rim at `refs`,
 * along the circle frame's axes, each held there by `oncircle(_, on)`. On the
 * rim rather than anywhere else in the plane because the rim is what moves with
 * the face: set the depth and the circle rises, the two points with it, so the
 * plane stays the lid's — where two free points would stay behind and tip it.
 */
export interface MadePlane {
  origin: string;
  on: string;
  refs: [number[], number[]];
}

/** What a sketch plane on a face is: three of its points by name, or one to make (`MadePlane`). */
export type FacePlane = [string, string, string] | MadePlane;

/**
 * The plane `sketchFrameFor` found, as the arguments `plane(…)` or `frame(…)`
 * takes: three names, or the centre and two `pt(…)`s held on the rim — the
 * clause idiom, so the line in the log is the whole of what was made, and the
 * journal and the undo step are the typed call's.
 */
export function facePlaneArgs(p: FacePlane): string {
  if (Array.isArray(p)) return p.map((n) => JSON.stringify(n)).join(", ");
  const held = `oncircle(_, ${JSON.stringify(p.on)})`;
  return [JSON.stringify(p.origin), ...p.refs.map((at) => `pt(${at.map(num).join(", ")}, ${held})`)].join(", ");
}

/**
 * Every digit, unlike the curve tools' three-decimal origin: a rim point seeded
 * a rounding off the rim is pulled back by its hold, and the circle's own
 * radius — free, in a sketch nobody dimensioned — gives way by part of it
 * (measured: 5e-5 on a radius of 6). Seeded exactly, the hold has nothing to
 * correct and sketching on the lid leaves the cylinder as it was.
 */
function num(v: number): string {
  return String(v === 0 ? 0 : v);
}

/**
 * The three points — origin, x-ref, y-ref — of a sketch plane on `loop`, its
 * +z on the side of `toward`, the direction out of the screen at whoever is
 * looking (`viewAxes(view).toward`): what `plane(a, b, c)` takes to start a
 * sketch on that face — or, for a whole circle whose frame's plane is not its
 * own, the plane to make (`MadePlane`).
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
 * is skipped, and so is a crossing (a vertex that is no point). Failing every
 * corner, any three of the vertices off one line; failing that, an arc's centre
 * is a point of the loop's plane too (its rim, and so its ends, lie in the plane
 * through it), which is what a loop of only two vertices — a lens of two arcs,
 * a line closed by an arc — has to offer; and so are the own ends of a member
 * that is only part of its entity. A region bounded only by parts of circles
 * (a lens of two crossing circles) has nothing but their centres, and takes a
 * circle's frame, as a whole circle does (below).
 *
 * **A whole circle has only its centre**, and it also has its frame, whose
 * three points span the circle's plane when the circle lies on it: they are
 * used, with the x-ref and y-ref swapped when the frame's +z faces away — so a
 * circle drawn on its sketch gets a plane facing out. But a circle is held
 * only parallel to its frame (the frame is an orientation, not a constraint),
 * and every extruded circle's lid lies off its frame since an extrude makes no
 * lid frame (docs/plans/no-lid-frame.md). Such a circle gets a plane **made**
 * for it (`MadePlane`): the frame's orientation, turned over likewise, through
 * the circle's own centre. Only a circle with no orientation to give — no
 * frame, or one collapsed onto itself — is refused.
 *
 * Throws, with the reason, in a model without 3D frames, for a loop seen
 * exactly edge-on, and when no three of the loop's points are off one line.
 */
export function sketchFrameFor(model: Model, loop: Loop, toward: number[]): FacePlane {
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

  if (loop.members.length === 1 && loop.members[0].from === null) return circleFrame(model, loop.members[0].name, facing);

  const where = new Map<string, number[]>();
  const at = (p: string): number[] => {
    if (!where.has(p)) where.set(p, lift3(model.coords(p)));
    return where.get(p)!;
  };
  /** a, b, c ordered so the plane faces the viewer: b and c swapped if not. */
  const oriented = (a: string, b: string, c: string): [string, string, string] =>
    facing(cross3(sub3(at(b), at(a)), sub3(at(c), at(a)))) > 0 ? [a, b, c] : [a, c, b];

  // A crossing is a vertex of the loop but no point (loops.ts): a plane made
  // of it would name nothing a frame can hold, so only real points are used.
  const vertices = loop.members.map((m) => m.from!);
  const real = (p: string) => !isVirtual(model, p);
  const n = vertices.length;
  for (let i = 0; i < n; i++) {
    const [v, next, prev] = [vertices[i], vertices[(i + 1) % n], vertices[(i + n - 1) % n]];
    if (![v, next, prev].every(real)) continue;
    if (next !== prev && turn(at(v), at(next), at(prev)) > PARALLEL_SINE) return oriented(v, next, prev);
  }
  // An arc's centre is a point of the loop's plane, and so — for a member that
  // is only part of its entity — are the entity's own ends and a circle's
  // centre, wherever the loop leaves it: a region cut off by crossings may
  // have fewer than three real corners.
  const extra = loop.members.flatMap((m) => {
    const e = model.entities.get(m.name);
    if (e?.kind === "arc") return m.span === null ? [e.center] : [e.center, e.start, e.end];
    if (m.span === null) return [];
    if (e?.kind === "line") return [...e.refs];
    return e?.kind === "circle" ? [e.center] : [];
  });
  const candidates = [...new Set([...vertices.filter(real), ...extra])];
  for (let i = 0; i < candidates.length; i++) {
    for (let j = i + 1; j < candidates.length; j++) {
      for (let k = j + 1; k < candidates.length; k++) {
        const [a, b, c] = [candidates[i], candidates[j], candidates[k]];
        if (turn(at(a), at(b), at(c)) > PARALLEL_SINE) return oriented(a, b, c);
      }
    }
  }
  // A region bounded by parts of circles alone (a lens) has their frames left,
  // on the same terms as a whole circle.
  const ring = loop.members.find((m) => model.entities.get(m.name)?.kind === "circle");
  if (ring) return circleFrame(model, ring.name, facing);
  throw new Error(`the loop of ${members(loop)} has no three points off one line to make a plane of — `
    + "a plane on it needs a third point: plane(a, b, c) with one of your own");
}

/**
 * A whole circle's plane: its frame's own three points where the circle lies
 * on the frame, else one made through its centre (`MadePlane`) — either way
 * turned over if it would face away.
 */
function circleFrame(model: Model, name: string, facing: (n: number[]) => number): FacePlane {
  const circle = model.circular(name);
  const plane = circle.plane;
  if (plane === undefined) throw new Error(`"${name}" names no frame, so it has no plane to sketch on`);
  const f = model.frame(plane);
  const { origin, ux, uy, uz } = frameBasis(model, plane)();
  if (!uz || [ux, uy].some((a) => a.every((c) => c === 0))) {
    throw new Error(`"${name}"'s frame "${plane}" has collapsed, so it gives the circle no orientation to sketch in — `
      + "plane(a, b, c) with points of your own");
  }
  const up = facing(uz) > 0;
  const centre = lift3(model.coords(circle.center));
  if (f.yref !== undefined && liesOn({ origin: lift3(origin), u: lift3(ux), v: lift3(uy) }, centre)) {
    return up ? [f.origin, f.xref, f.yref] : [f.origin, f.yref, f.xref];
  }
  const r = model.radius(name);
  const [a, b] = (up ? [ux, uy] : [uy, ux]).map(lift3);
  return { origin: circle.center, on: name, refs: [a, b].map((d) => centre.map((c, i) => c + r * d[i])) as [number[], number[]] };
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
  return `plane(${facePlaneArgs(sketchFrameFor(model, loop, toward))})`;
}

/**
 * The command the extrude and revolve tools type before their operation, on a
 * region no frame orients: a frame of `sketchFrameFor`'s three points, so the
 * feature runs along the sketch's own plane with +z toward the viewer — a
 * positive depth comes out at whoever clicked.
 *
 * `plane(a, b, c, { look: false })` in a model with no default frame, because
 * this frame is then the plane being sketched on and the tools should draw on
 * it next — but **without turning the view**: `plane` alone swings the camera
 * square-on, which in the middle of an extrude is a jolt, and the solid should
 * appear where the user was looking. `frame(a, b, c)` when there is a default
 * already: a default that is merely not parallel is still the user's choice,
 * and is kept. Throws as `sketchFrameFor` does, in its words.
 */
export function featurePlaneCommand(model: Model, loop: Loop, toward: number[]): string {
  const names = facePlaneArgs(sketchFrameFor(model, loop, toward));
  return model.defaultFrame == null ? `plane(${names}, { look: false })` : `frame(${names})`;
}

/**
 * Three points of a plane — origin, x-ref, y-ref — ordered so the frame they
 * make has its +z on the side of `toward`: the last two swapped if not, as
 * `sketchFrameFor` orders a face's. A plane seen exactly edge-on has no side
 * facing anyone and keeps the order it was given: the frame is the same plane
 * either way, and only which side is +z is left to chance.
 */
export function facingPoints(model: Model, [a, b, c]: [string, string, string], toward: number[]): [string, string, string] {
  const [pa, pb, pc] = [a, b, c].map((p) => lift3(model.coords(p)));
  return dot3(cross3(sub3(pb, pa), sub3(pc, pa)), toward) < 0 ? [a, c, b] : [a, b, c];
}

/**
 * The command the fillet tool types before rounding a corner in a model with
 * no default frame: `plane(shared, a, b, { look: false })` — the corner's own
 * three points (`filletNeedsFrame`), +z toward the viewer, the view left alone.
 * The corner's points rather than a frame seeded at the click, as the circle
 * tool's is, because the arc must lie in the corner's plane, and the plane
 * facing the screen is that only while the view has not turned since the
 * corner was drawn. Like a face's plane, a frame of the corner's points then
 * follows the corner.
 */
export function cornerPlaneCommand(model: Model, corner: [string, string, string], toward: number[]): string {
  return `plane(${facingPoints(model, corner, toward).map((p) => JSON.stringify(p)).join(", ")}, { look: false })`;
}
