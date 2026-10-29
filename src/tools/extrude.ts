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
// entry is the same one a typed call makes, and the log says what it made.
//
// **A region no frame orients gets its plane first, typed.** An extrude runs
// along a frame's +z, and a rectangle drawn in a fresh model has none — the
// owner's first run, refused eight times. A frame of three of the loop's own
// points is the sketch's own plane, not a datum nobody chose (it is what
// "Sketch on this face" makes), so the tool types it — `plane(a, b, c, { look:
// false })`, or `frame(a, b, c)` beside a default it keeps — through the
// command line (`ctx.run`), where the log teaches it, and then extrudes along
// it as a step of its own. The view does not turn: the solid appears where the
// user was looking.

import { Tool, defineTool, type PointerInfo, type RegionHit, type RenderContext } from "./tool.ts";
import { DEFAULT_DEPTH, extrudeProfile, orientingFrame, profileOf } from "../operations.ts";
import { describeFeature } from "../picking.ts";
import { featurePlaneCommand } from "../sketchface.ts";
import { drawRegion, regionKey, type Region } from "./region.ts";

export class ExtrudeTool extends Tool {
  readonly name = "extrude";
  // It chooses a region, not a place: a snap marker would promise a vertex
  // the click does not go to.
  readonly snaps = false;
  private under: Region | null = null;
  /** Set between typing a frameless region's plane and extruding along it — which typing, so a cancel can drop it. */
  private typing: object | null = null;

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
    if (this.typing) return; // the plane it typed is still going in
    const hit = this.ctx.regionAt?.(p.screen) ?? null;
    if (!hit) {
      this.refuse(new Error("no closed region under the click — click inside a loop (loops() lists them)"));
      return;
    }
    const ctx = this.ctx;
    const model = ctx.model;
    const loop = hit.loops[hit.index];
    if (orientingFrame(model, loop) !== null || !ctx.run || !ctx.act) {
      // Headless, with no command line to type the plane into, a frameless
      // region is refused by the operation, as it always was.
      this.commit(hit);
      return;
    }
    let command: string;
    try {
      command = featurePlaneCommand(model, loop, hit.toward);
    } catch (e) {
      this.refuse(e);
      return;
    }
    // The plane is typed and then waited for: the line runs asynchronously,
    // and an extrude made in the same breath would fall inside its undo step,
    // so one Ctrl+Z would take both. Waiting makes them two steps — the solid,
    // then the plane — as two typed lines would be.
    this.under = null;
    const token = {};
    this.typing = token;
    void Promise.resolve(ctx.run(command)).finally(() => {
      if (this.typing !== token) return; // cancelled while it went in: the plane stays, as typed
      this.typing = null;
      ctx.act!(() => this.commit(hit));
    });
  }

  /**
   * The region extruded, along the frame that orients it — which, after a
   * typed plane, is that plane: it was the only one parallel. Refused, with the
   * operation's own words, when there is still none (the plane's line failed,
   * or there was no command line to type it into).
   */
  private commit(hit: RegionHit): void {
    const model = this.ctx.model;
    try {
      const feature = extrudeProfile(model, profileOf(model, hit.loops, hit.index), this.depth);
      this.under = null;
      this.ctx.requestSolve();
      this.ctx.finish();
      this.ctx.log?.(describeFeature(model, model.featureOf(feature)), "done");
    } catch (e) {
      // The tool stays armed, so the next click can be somewhere it can extrude.
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
    this.typing = null;
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
