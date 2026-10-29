// What the click-inside tools share: a region's identity for a hover, its
// preview, and the faint light on every region a click could take.
//
// The extrude, revolve and sketch tools all choose a region under the cursor
// (`ToolContext.regionAt`) and outline it before the click. One copy of the
// drawing, so the three cannot disagree about what "the region a click would
// take" looks like — the green that means it is the same green everywhere.
//
// **While such a tool is armed, every region it could take is lit**, faintly,
// in that green: a click that misses is told "the ones I can see are lit", and
// the light is what makes the sentence true. Guidance that shows where to click
// beats a sentence that only says it (docs/plans/effortless.md, rule 2). The
// region under the cursor is drawn over it, brighter, as before.

import type { RenderContext } from "./tool.ts";
import type { Model } from "../model.ts";
import { findLoops, memberLabel, type Loop } from "../loops.ts";
import { regionOf } from "../operations.ts";
import { loopOutlines } from "../faces.ts";

/** Only which loops, and which one — what the extrude and revolve tools keep after a click. */
export type Region = { loops: Loop[]; index: number };

/** The click-inside tools' green. */
export const REGION_GREEN = "#55c07a";

/**
 * The lit regions' tint and outline, as two hex digits of alpha on the green:
 * enough to find on a dark canvas at a glance, little enough that the drawing
 * under it still reads and the hovered region (`2e` fill, solid outline)
 * stands out of it.
 */
export const LIT_FILL = "16";
export const LIT_STROKE = "70";

/**
 * Which loops a region is made of, by member names — what a hover is compared
 * by, so the preview is redrawn when the region under the cursor changes and
 * not on every move within one. A portion carries the vertices it runs
 * between (`memberLabel`): a lens and the crescent beside it are made of parts
 * of the same two circles.
 */
export function regionKey(r: Region | null): string {
  if (!r) return "";
  return regionOf(r.loops, r.index).map((i) => r.loops[i].members.map(memberLabel).join(",")).join("|");
}

/**
 * The regions a click-inside tool lights while it is armed: every loop
 * `findLoops` sees, each as the region a click inside it would take — the loop
 * with the loops inside it, so a hole is left clear in its outline's region and
 * lit as a region of its own — except the one under the cursor, which is drawn
 * on its own, brighter. Pure: loops in, regions out.
 */
export function litRegions(loops: Loop[], hovered: Region | null): Region[] {
  const skip = hovered ? regionKey(hovered) : null;
  return loops.map((_, index) => ({ loops, index })).filter((r) => regionKey(r) !== skip);
}

/**
 * Whether an outline, as drawn on screen, is too thin to light: a loop seen
 * edge-on (a wall of a solid looked at square from above) projects to a line,
 * and lighting it would only paint its edges green. Thin means its area is
 * under its perimeter — less than about two pixels across on average — which
 * is also where `loopAt` stops offering a click there.
 */
export function edgeOn(screen: [number, number][]): boolean {
  let area = 0, perimeter = 0;
  for (let i = 0; i < screen.length; i++) {
    const [ax, ay] = screen[i], [bx, by] = screen[(i + 1) % screen.length];
    area += ax * by - bx * ay;
    perimeter += Math.hypot(bx - ax, by - ay);
  }
  return Math.abs(area) / 2 < perimeter;
}

/**
 * Lights every region in `regions` (`litRegions`): a faint even-odd fill per
 * region and a faint outline of its own loop, each loop laid out once. A loop
 * that cannot be laid out, or is seen edge-on, is left dark.
 */
export function drawLit(model: Model, r: RenderContext, regions: Region[]): void {
  if (!regions.length) return;
  const loops = regions[0].loops;
  const screenOf = new Map<number, [number, number][] | null>();
  const outline = (i: number): [number, number][] | null => {
    if (!screenOf.has(i)) {
      let pts: [number, number][] | null = null;
      try {
        const [o] = loopOutlines(model, [loops[i].members], r.scale);
        if (o) pts = o.map((w) => r.worldToScreen(w));
      } catch {
        pts = null; // a drawing that moved under the hover; the next render asks again
      }
      screenOf.set(i, pts && !edgeOn(pts) ? pts : null);
    }
    return screenOf.get(i)!;
  };
  const path = (pts: [number, number][]) => {
    r.g.moveTo(...pts[0]);
    for (const q of pts.slice(1)) r.g.lineTo(...q);
    r.g.closePath();
  };
  r.g.save();
  r.g.fillStyle = `${REGION_GREEN}${LIT_FILL}`;
  r.g.strokeStyle = `${REGION_GREEN}${LIT_STROKE}`;
  r.g.lineWidth = 1.6;
  for (const region of regions) {
    const own = outline(region.index);
    if (!own) continue;
    r.g.beginPath();
    for (const i of regionOf(loops, region.index)) {
      const pts = outline(i);
      if (pts) path(pts);
    }
    r.g.fill("evenodd");
    r.g.beginPath();
    path(own);
    r.g.stroke();
  }
  r.g.restore();
}

/**
 * Lights every region a click could take in the model as it stands —
 * `litRegions` of what `findLoops` sees, drawn by `drawLit` — with `hovered`
 * left for the caller to draw brighter. Found afresh per render, as `regionAt`
 * finds them per move: a loop is a question, not an entity, and the drawing
 * may have moved since.
 */
export function lightRegions(model: Model, r: RenderContext, hovered: Region | null): void {
  let loops: Loop[];
  try {
    loops = findLoops(model);
  } catch {
    return;
  }
  drawLit(model, r, litRegions(loops, hovered));
}

/**
 * What a click-inside tool says to a click that landed in no region: where to
 * click instead, and that those places are lit — or, with nothing closed to
 * click inside at all, what to do first. A sentence, not an error: the tool
 * stays armed and the next click can be the right one.
 */
export function missedRegion(model: Model): string {
  let found = 0;
  try {
    found = findLoops(model).length;
  } catch {
    found = 0;
  }
  return found ? "click inside a closed outline — the ones I can see are lit"
    : "no closed outline yet — draw one, then click inside it";
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
    outlines = loopOutlines(model, regionOf(region.loops, region.index).map((i) => region.loops[i].members), r.scale);
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
