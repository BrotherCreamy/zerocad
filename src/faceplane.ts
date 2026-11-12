// Sketching on a face: the plane of a loop, as a plane reference.
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
// And **three of the loop's own points are its plane**: the plane reference
// `"a.b.c"` (`Model.planeKind`), which names no new entity and *follows the
// solid* because its points are the solid's — set the depth and the plane on
// the lid rises with the lid, read as a datum like every plane. A whole
// circle's face has only its centre, and its plane is the circle's own (its
// name, as a plane reference). Nothing about the face is stored; what is
// journalled is three names, or one. It used to be a frame made of the three
// points — `plane(a, b, c)` — and the owner asked why every sketch made one
// (docs/plans/frameless-curves.md): sketch on face now sets the **work plane**
// to the face, and makes nothing.
//
// **Orientation is the whole trick: the normal toward the viewer.** A sketch
// plane on a solid's face must face *out* of the solid, so a positive extrude
// on it adds material rather than cutting into it (Onshape's behaviour).
// Back-face culling makes that free. A face the click can land on is the
// nearest one the pixel's ray meets (`loopAt`), and the first surface a ray
// meets on a closed solid is one it enters through — one whose outward normal
// faces the viewer. So the rule needs no idea which side the material is on,
// and is one rule for solids and plain loops alike: order the three points so
// `(b − a) × (c − a)` points toward the camera, swapping b and c if not.
//
// Pure, at loops.ts's height: model, loop and line of sight in, a plane
// reference out. The line of sight rather than the view, because the tool
// asking has no camera: it has the region it was handed (`RegionHit.toward`),
// which carries the side it was seen from.

import { entityKind, type Model } from "./model.ts";
import { PARALLEL_SINE, isVirtual, type Loop } from "./loops.ts";
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
 * The plane of `loop` as a plane reference, facing the side of `toward` — the
 * direction out of the screen at whoever is looking (`viewAxes(view).toward`)
 * where it can be made to: `"a.b.c"`, three of the loop's own points, or a
 * whole circle's name. What sketch on face sets the work plane to, what a
 * curve drawn on a solid's face is held to, and what an extrude of a loop no
 * frame orients runs along (operations.ts's `orientingPlane`).
 *
 * The loop's own vertices are preferred, in loop order, and **a corner with its
 * two neighbours** first: the first vertex that is not on a straight run is
 * the plane's first point, and the vertices either side of it the second and
 * third. So the plane's own +x (`planeBasis`) runs along an edge of the face
 * and looking at it shows the face square to the screen — a rectangle's wall
 * comes up level, not tipped. (The first cut took the first three vertices and
 * swapped the last two to turn the plane over, which put +x along the diagonal
 * whenever the face was seen from its back. Found by looking at the
 * screenshot.) A point partway along an edge is no corner, and is skipped, and
 * so is a crossing (a vertex that is no point). Failing every corner, any three
 * of the vertices off one line; failing that, an arc's centre is a point of the
 * loop's plane too (its rim, and so its ends, lie in the plane through it),
 * which is what a loop of only two vertices — a lens of two arcs, a line closed
 * by an arc — has to offer; and so are the own ends of a member that is only
 * part of its entity.
 *
 * **A whole circle has only its centre**, and it has its own normal: its plane
 * is the circle itself. A circle cannot be turned over the way three points
 * can, so a circle's face seen from behind keeps the circle's own normal; a
 * curve drawn on it is turned toward the viewer by the tool (tools/place.ts),
 * which is all that side decides for a sketch. A region bounded only by parts
 * of circles (a lens of two crossing circles) has nothing but their centres,
 * and takes a circle's plane likewise.
 *
 * Throws, with the reason, in a model that is not 3D, for a loop seen exactly
 * edge-on, and when no three of the loop's points are off one line.
 */
export function facePlaneFor(model: Model, loop: Loop, toward: number[]): string {
  if (model.dim !== 3) {
    throw new Error("a plane to draw on a face is a 3D plane — a 2D drawing is one plane already");
  }
  const facing = (n: number[]): number => {
    const len = Math.hypot(...n);
    const cos = len === 0 ? 0 : dot3(n, toward) / len;
    if (Math.abs(cos) < EDGE_ON_COS) {
      throw new Error(`the loop of ${members(loop)} is edge-on to the view — neither side of it faces you; turn the view and try again`);
    }
    return cos;
  };

  // A whole closed curve that carries its own plane (a circle, an ellipse) is
  // its plane. One that carries none — a closed spline (docs/plans/
  // spline.md), whose plane is its points' — takes three of its points below
  // (found: a closed spline drawn on a plate's top threw here, asked for a
  // normal it has not got, the moment it was extruded).
  const whole = loop.members.length === 1 && loop.members[0].from === null ? model.entities.get(loop.members[0].name) : undefined;
  if (whole && (whole.kind === "circle" || entityKind(whole.kind)?.plane)) return circlePlane(model, whole.name, facing);

  const where = new Map<string, number[]>();
  const at = (p: string): number[] => {
    if (!where.has(p)) where.set(p, lift3(model.coords(p)));
    return where.get(p)!;
  };
  /** a, b, c ordered so the plane faces the viewer: b and c swapped if not. */
  const oriented = (a: string, b: string, c: string): string =>
    (facing(cross3(sub3(at(b), at(a)), sub3(at(c), at(a)))) > 0 ? [a, b, c] : [a, c, b]).join(".");

  // A crossing is a vertex of the loop but no point (loops.ts): a plane made
  // of it would name nothing that can hold it, so only real points are used.
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
    // A spline's points are all in its plane (docs/plans/spline.md): a D of a
    // spline and one line has two corners, and its bend through them.
    if (e?.kind === "spline") return [...e.points];
    if (m.span === null) return [];
    if (e?.kind === "line") return [...e.refs];
    if (e?.kind === "ellipse") return [e.center, e.major];
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
  // A region bounded by parts of circles alone (a lens) has their planes left,
  // on the same terms as a whole circle.
  const ring = loop.members.find((m) => ["circle", "ellipse"].includes(model.entities.get(m.name)?.kind ?? ""));
  if (ring) return circlePlane(model, ring.name, facing);
  throw new Error(`the loop of ${members(loop)} has no three points off one line to make a plane of — `
    + "say which plane with points of your own: workplane(\"p1.p2.p3\")");
}

/** A whole circle's plane: the circle itself, which must still face somewhere (an edge-on one is refused). */
function circlePlane(model: Model, name: string, facing: (n: number[]) => number): string {
  facing(model.normalOf(name));
  return name;
}

function members(loop: Loop): string {
  return loop.members.map((m) => m.name).join(",");
}

/**
 * The command that starts a sketch on `loop`: `workplane("a.b.c")` — the work
 * plane set to the face and looked at square-on — typed by the sketch tool and
 * the "Sketch on this face" menu item alike, so the two cannot set different
 * planes of one face. Throws as `facePlaneFor` does.
 */
export function drawOnFaceCommand(model: Model, loop: Loop, toward: number[]): string {
  return `workplane(${JSON.stringify(facePlaneFor(model, loop, toward))})`;
}
