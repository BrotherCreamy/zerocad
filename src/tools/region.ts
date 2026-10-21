// What the click-inside tools share: a region's identity for a hover, and its
// preview.
//
// The extrude, revolve and sketch tools all choose a region under the cursor
// (`ToolContext.regionAt`) and outline it before the click. One copy of the
// drawing, so the three cannot disagree about what "the region a click would
// take" looks like — the green that means it is the same green everywhere.

import type { RenderContext } from "./tool.ts";
import type { Model } from "../model.ts";
import type { Loop } from "../loops.ts";
import { regionOf } from "../operations.ts";
import { loopOutlines } from "../faces.ts";

/** Only which loops, and which one — what the extrude and revolve tools keep after a click. */
export type Region = { loops: Loop[]; index: number };

/** The click-inside tools' green. */
export const REGION_GREEN = "#55c07a";

/**
 * Which loops a region is made of, by member names — what a hover is compared
 * by, so the preview is redrawn when the region under the cursor changes and
 * not on every move within one.
 */
export function regionKey(r: Region | null): string {
  if (!r) return "";
  return regionOf(r.loops, r.index).map((i) => r.loops[i].members.map((m) => m.name).join(",")).join("|");
}

/**
 * The region — the loop and every loop inside it — filled faintly even-odd, so
 * holes stay clear, and outlined in the tools' green. Returns the outlines
 * drawn (world coordinates), or null when there was nothing to draw — a drawing
 * that moved under the hover, which the next move asks about again. `fill` is
 * the tint's alpha, as two hex digits: a chosen region is drawn a shade
 * stronger than one merely under the cursor.
 */
export function drawRegion(model: Model, r: RenderContext, region: Region, fill = "2e"): number[][][] | null {
  let outlines: number[][][];
  try {
    outlines = loopOutlines(model, regionOf(region.loops, region.index).map((i) => region.loops[i].members.map((m) => m.name)), r.scale);
  } catch {
    return null;
  }
  if (!outlines.length) return null;
  r.g.save();
  r.g.beginPath();
  for (const o of outlines) {
    const pts = o.map((w) => r.worldToScreen(w));
    r.g.moveTo(...pts[0]);
    for (const q of pts.slice(1)) r.g.lineTo(...q);
    r.g.closePath();
  }
  r.g.fillStyle = `${REGION_GREEN}${fill}`;
  r.g.fill("evenodd");
  r.g.strokeStyle = REGION_GREEN;
  r.g.lineWidth = 2.4;
  r.g.stroke();
  r.g.restore();
  return outlines;
}
