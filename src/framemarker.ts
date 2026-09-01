// Where a frame's axes marker is on screen — the one answer three files need.
//
// A frame owns no geometry of its own: it is two ordinary points, and only the
// *direction* between them counts. So what a user sees, clicks, boxes and
// drags is a small marker drawn at the origin — two short arrows along +x and
// +y — and "where is that marker" has to be one function rather than three,
// or the drawing and the hit test drift apart by a few pixels and nobody can
// see why a frame refuses to be clicked where it plainly is.
//
// It lives here rather than in picking.ts because boxselect.ts needs it too,
// and those two are peers: both are pure "question about the drawing" modules
// over (model, view), and a sideways import between them would be the first.
//
// **The arms are a fixed length in pixels, not in world units.** The distance
// to the x-ref means nothing — a frame is an origin and a direction — so
// drawing the marker at the x-ref's distance would put a number on screen that
// carries no information and grows or vanishes with the zoom. A constant
// number of pixels is what a datum triad looks like in every CAD package, and
// it is also what makes the marker a *deliberate* target the way a constraint
// glyph is.

import type { Model } from "./model.ts";
import type { Pt } from "./intersect.ts";
import { worldToScreen, type View } from "./view.ts";

/** How long each arm is, in screen pixels. Small: a marker, not geometry. */
export const FRAME_ARM_PX = 30;

/** A frame's marker in screen space: where it sits and where each arm ends. */
export interface FrameMarker {
  origin: Pt;
  /** The +x arm's tip. */
  x: Pt;
  /** The +y arm's tip — +x turned a quarter turn counter-clockwise in *world*
   * space, which is clockwise on screen, since screen y runs the other way. */
  y: Pt;
}

/**
 * The marker for `name`, or null when the frame's two points have been dragged
 * together and it has no direction left to draw. Null rather than an arbitrary
 * fallback: a collapsed frame genuinely has no axes, and drawing an invented
 * pair would be a picture of something that is not true.
 */
export function frameMarker(model: Model, view: View, name: string): FrameMarker | null {
  const f = model.frame(name);
  const o = model.coords(f.origin);
  const x = model.coords(f.xref);
  // Straight to screen space, which flips y — so the quarter turn below is the
  // screen's, and world +y comes out pointing up the canvas as it should.
  const origin = worldToScreen(view, o);
  const tip = worldToScreen(view, x);
  const dx = tip[0] - origin[0], dy = tip[1] - origin[1];
  const len = Math.hypot(dx, dy);
  if (!(len > 1e-9)) return null;
  const [ux, uy] = [dx / len, dy / len];
  return {
    origin,
    x: [origin[0] + ux * FRAME_ARM_PX, origin[1] + uy * FRAME_ARM_PX],
    // Clockwise on screen is counter-clockwise in the world.
    y: [origin[0] + uy * FRAME_ARM_PX, origin[1] - ux * FRAME_ARM_PX],
  };
}

/** The marker's two arms as segments, for hit-testing and box selection. */
export function frameArms(marker: FrameMarker): [Pt, Pt][] {
  return [[marker.origin, marker.x], [marker.origin, marker.y]];
}
