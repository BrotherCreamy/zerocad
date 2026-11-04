// Where a frame's axes marker is on screen — the one answer three files need.
//
// A frame owns no geometry of its own: it is two ordinary points (three in 3D),
// and only the *directions* they give count. So what a user sees, clicks, boxes
// and drags is a small marker drawn at the origin — short arrows along +x and
// +y, and +z for a 3D frame — and "where is that marker" has to be one function
// rather than three, or the drawing and the hit test drift apart by a few
// pixels and nobody can see why a frame refuses to be clicked where it plainly
// is.
//
// It lives here rather than in picking.ts because boxselect.ts needs it too,
// and those two are peers: both are pure "question about the drawing" modules
// over (model, view), and a sideways import between them would be the first.
//
// **The arms are a fixed length in pixels, not in world units** — for an axis
// lying flat to the screen. The distance to a ref means nothing — a frame is an
// origin and directions — so drawing the marker at the x-ref's distance would
// put a number on screen that carries no information and grows or vanishes
// with the zoom. A constant number of pixels is what a datum triad looks like
// in every CAD package, and it is also what makes the marker a *deliberate*
// target the way a constraint glyph is. Each arm is that length times how much
// of its axis faces the screen, so a triad foreshortens exactly as the drawing
// around it does: an axis pointing straight at the viewer is a dot, and a
// tilted frame reads as tilted.
//
// The axes come from `frameBasis` — the same three unit vectors every relation
// written against the frame reads — so the marker cannot disagree with a
// constraint about which way +y is. (In 3D that is not a formality: +y is the
// y-ref *straightened* against +x, and drawing toward the raw y-ref would show
// a skewed frame the relations never see.)
//
// Which is why **snapping deliberately does not consult this**. An arm's tip
// is at no meaningful position — it is a pixel length — so placing geometry
// there would be placing it at an artefact of the zoom. A frame's origin and
// refs are ordinary points, and snapping catches those as it catches any other.

import type { Model } from "./model.ts";
import type { Pt } from "./intersect.ts";
import { frameBasis } from "./relations/refs.ts";
import { uiOf, viewAxes, worldToScreen, type View } from "./view.ts";
import { dot3, lift3 } from "./vec3.ts";

/**
 * How long each arm is, in screen pixels, when its axis lies flat to the
 * screen. Small — a marker, not geometry — but long enough that its letters
 * clear the origin point's own name label, which is drawn in the pass after
 * this one and cannot move out of the way.
 */
export const FRAME_ARM_PX = 36;

/**
 * The arm's length at the view's interface size: the marker is drawn for a
 * person to read and aim at, so it scales with the interface — and its hit
 * test with it, being the drawn arm.
 */
export function frameArmPx(view: View): number {
  return FRAME_ARM_PX * uiOf(view);
}

/** A frame's marker in screen space: where it sits and where each arm ends. */
export interface FrameMarker {
  origin: Pt;
  /** The +x arm's tip. */
  x: Pt;
  /** The +y arm's tip — in 2D, +x turned a quarter turn counter-clockwise in
   * *world* space, which is clockwise on screen, since screen y runs the other way. */
  y: Pt;
  /** The +z arm's tip, for a 3D frame; absent for a 2D one, which has no z. */
  z?: Pt;
}

/**
 * The marker for `name`, or null when the frame's origin and x-ref have been
 * dragged together and it has no direction left to draw. Null rather than an
 * arbitrary fallback: a collapsed frame genuinely has no axes, and drawing an
 * invented set would be a picture of something that is not true.
 */
export function frameMarker(model: Model, view: View, name: string): FrameMarker | null {
  const { origin: o, ux, uy, uz } = frameBasis(model, name)();
  if (ux.every((c) => c === 0)) return null;
  const origin = worldToScreen(view, o);
  const { right, up } = viewAxes(view);
  const len = frameArmPx(view);
  // An axis's on-screen arm: its components along the screen's right and up,
  // scaled to the arm length. Screen y runs down, hence the minus.
  const arm = (u: number[]): Pt => {
    const a = lift3(u);
    return [origin[0] + dot3(a, right) * len, origin[1] - dot3(a, up) * len];
  };
  const marker: FrameMarker = { origin, x: arm(ux), y: arm(uy) };
  if (uz) marker.z = arm(uz);
  return marker;
}

/** The marker's arms as segments, for hit-testing and box selection. */
export function frameArms(marker: FrameMarker): [Pt, Pt][] {
  const arms: [Pt, Pt][] = [[marker.origin, marker.x], [marker.origin, marker.y]];
  if (marker.z) arms.push([marker.origin, marker.z]);
  return arms;
}
