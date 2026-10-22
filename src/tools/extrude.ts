// Click inside a closed region, and extrude it.
//
// The Onshape gesture, and the first click-inside behaviour in the app. It
// lives here and only here: with nothing armed, a click inside a region still
// picks nothing and a press there still starts a selection box, exactly as it
// did — the region is something this tool asks about, not something the
// canvas learned to select.
//
// Armed with its depth — `arm("extrude", { depth: 20 })`, the fillet tool's
// convention for a number the gesture cannot supply — it outlines the region
// under the cursor as it moves (the loop and every loop inside it, the very
// profile a click would take, holes left clear), and one click there commits.
// The region is what `loopAt` finds: the innermost loop the click is inside,
// then the nearest — so a click on an island takes the island, a click between
// it and the outline takes the outline with its hole, and a click on a solid's
// lid takes the lid's own loop.
//
// It hands `extrude` the region it found (`extrudeProfile`), rather than a
// member name to look the loop up by: a member is in several loops once
// anything has been extruded (every profile edge is also a wall's), and the
// click has already said which. A region split by a crossing extrudes as the
// preview outlined it, the crossing made a point by the operation. The journal
// entry is the same one a typed call makes.

import { Tool, defineTool, type PointerInfo, type RenderContext } from "./tool.ts";
import { DEFAULT_DEPTH, extrudeProfile, profileOf } from "../operations.ts";
import { drawRegion, regionKey, type Region } from "./region.ts";

export class ExtrudeTool extends Tool {
  readonly name = "extrude";
  // It chooses a region, not a place: a snap marker would promise a vertex
  // the click does not go to.
  readonly snaps = false;
  private under: Region | null = null;

  private get depth(): number {
    const d = this.ctx.options.depth;
    return typeof d === "number" && Number.isFinite(d) && d !== 0 ? d : DEFAULT_DEPTH;
  }

  onMove(p: PointerInfo): void {
    const next = this.ctx.regionAt?.(p.screen) ?? null;
    if (regionKey(next) === regionKey(this.under)) { this.under = next; return; }
    this.under = next;
    this.ctx.requestRender();
  }

  onDown(p: PointerInfo): void {
    const hit = this.ctx.regionAt?.(p.screen) ?? null;
    if (!hit) {
      this.refuse(new Error("no closed region under the click — click inside a loop (loops() lists them)"));
      return;
    }
    try {
      extrudeProfile(this.ctx.model, profileOf(this.ctx.model, hit.loops, hit.index), this.depth);
      this.under = null;
      this.ctx.requestSolve();
      this.ctx.finish();
    } catch (e) {
      // No frame orients the loop, most likely. The tool stays armed, so the
      // next click can be somewhere it can extrude.
      this.refuse(e);
    }
  }

  /**
   * Out loud where there is a user to tell — a throw from a pointer handler
   * reaches the page as an uncaught error nobody sees explained — and a throw
   * headless, where a caller is the only one listening (fillet's convention).
   */
  private refuse(e: unknown): void {
    if (!this.ctx.log) throw e;
    this.ctx.log(`extrude: ${e instanceof Error ? e.message : e}`);
  }

  onCancel(): void {
    this.under = null;
    this.ctx.requestRender();
  }

  /**
   * The region under the cursor: a faint fill, even-odd so holes stay clear,
   * and its members outlined in the tool colour — exactly the profile a click
   * would extrude.
   */
  render(r: RenderContext): void {
    if (this.under) drawRegion(this.ctx.model, r, this.under);
  }
}

defineTool("extrude", ExtrudeTool);
