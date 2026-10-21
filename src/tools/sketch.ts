// Click inside a face, and start a sketch on it.
//
// The gesture every stacked feature in Onshape starts with — pick a face,
// sketch on it, extrude — and the extrude tool's gesture exactly: armed, it
// outlines the region under the cursor (the same preview, the same green), and
// one click inside commits. A face is not something the canvas selects; it is
// a loop this tool asks about (`regionAt`: the innermost loop under the click,
// then the nearest), so a solid's lid, a wall turned toward the viewer, a
// revolve's end face and a plain sketch loop are all sketched on alike. With
// nothing armed, a click there still picks nothing.
//
// **The commit is `plane(a, b, c)`, typed.** Three of the loop's own points,
// ordered so the plane's +z faces the viewer — out of a solid, see
// ../sketchface.ts — make the frame; `plane` makes it the default and looks at
// it square-on. The tool hands that line to the command machinery (`ctx.run`)
// rather than calling the model, because the camera is not the model's and
// `plane` already knows how to turn it: so the log shows the call, the journal
// holds what the typed call journals, and it is one undo step, all because it
// *is* the typed call. The "Sketch on this face" menu item types the same line.
//
// A click on no region is refused in the log, as the extrude tool's is, and so
// is a face no plane can be made of; either way the tool stays armed.

import { Tool, defineTool, type PointerInfo, type RegionHit, type RenderContext } from "./tool.ts";
import { drawRegion, regionKey } from "./region.ts";
import { sketchOnFaceCommand } from "../sketchface.ts";

export class SketchTool extends Tool {
  readonly name = "sketch";
  // It chooses a face, not a place: a snap marker would promise a vertex the
  // click does not go to.
  readonly snaps = false;
  private under: RegionHit | null = null;

  onMove(p: PointerInfo): void {
    const next = this.ctx.regionAt?.(p.screen) ?? null;
    const changed = regionKey(next) !== regionKey(this.under);
    this.under = next;
    if (changed) this.ctx.requestRender();
  }

  onDown(p: PointerInfo): void {
    const hit = this.ctx.regionAt?.(p.screen) ?? null;
    if (!hit) {
      this.refuse(new Error("no face under the click — click inside a closed loop: a solid's face, or a sketch's (loops() lists them)"));
      return;
    }
    if (!this.ctx.run) {
      this.refuse(new Error("there is no command line here to type plane(…) into"));
      return;
    }
    let command: string;
    try {
      command = sketchOnFaceCommand(this.ctx.model, hit.loops[hit.index], hit.toward);
    } catch (e) {
      this.refuse(e);
      return;
    }
    this.under = null;
    // Finished first: the command turns the view, and the hover outline of a
    // tool that is done would otherwise be drawn once more in the new one.
    this.ctx.finish();
    this.ctx.run(command);
  }

  /** Out loud where there is a user to tell, a throw headless — the extrude tool's convention. */
  private refuse(e: unknown): void {
    if (!this.ctx.log) throw e;
    this.ctx.log(`sketch: ${e instanceof Error ? e.message : e}`);
  }

  onCancel(): void {
    this.under = null;
    this.ctx.requestRender();
  }

  /** The face under the cursor, exactly as the extrude tool outlines a region. */
  render(r: RenderContext): void {
    if (this.under) drawRegion(this.ctx.model, r, this.under);
  }
}

defineTool("sketch", SketchTool);
