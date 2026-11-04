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

/**
 * **The arms' inks: x red, y green, z blue**, as SolidWorks draws its triad
 * (docs/plans/tooltips-rgb-frames.md; the owner: *"use rgb colours like
 * solidworks"*). Here, beside the marker's geometry, so the drawing and a test
 * that samples its pixels read one table.
 *
 * Chosen to read in three places, and measured in each (CHANGELOG has the
 * numbers): **on the dark ground** (#0a0e13) — none is the pure primary,
 * whose blue is too dark to see there (a contrast of 2.3 : 1) and whose red
 * is harsh; these are lightened to 5.9–10.4 : 1. **Over a light solid**,
 * where the casing pass rims each in the ground's dark, so the hue sits on a
 * dark line as on the ground. **In the hidden view's dimmed ink**
 * (`hiddenInk`, 40 % of the colour on the faces' shadow tone): each keeps its
 * leading channel — a dull brick, a dull green, a slate blue — so a hidden
 * arm is still its axis, only further away. The red leans a little to
 * vermilion for that: a red with as much blue as green dims to a mauve.
 *
 * **Red–green colour blindness** (about one man in twelve): the red and the
 * green are set apart in lightness as well as hue (relative luminance 0.27
 * against 0.51), and every arm keeps its letter, so x and y never depend on
 * hue alone. Distinct from every other ink the drawing uses: the lit amber
 * (#e8a33d), the selection's violet, construction's muted teal, the regions'
 * green (#55c07a, bluer and darker than the y arm).
 */
export const AXIS_INKS: Readonly<Record<"x" | "y" | "z", string>> = {
  x: "#ee6040",
  y: "#60d658",
  z: "#5b9cff",
};

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
