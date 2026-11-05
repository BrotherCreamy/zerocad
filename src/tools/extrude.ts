// Click inside closed regions, see the solids, and confirm.
//
// Onshape's extrude: armed — from the toolbar, typed, or with regions already
// selected on the canvas, which it starts from — it lights every region a click
// could take and outlines the one under the cursor (the loop and every loop
// inside it, the very profile a click would take, holes left clear). A click
// **toggles** a region into the selection; several may be selected. The solids
// they would make are drawn as they will be built, translucent, and follow the
// depth as it changes — in the options panel, as it is typed. ✓, Enter, or a
// second click on the region picked last builds them all as one undo step and
// leaves the tool armed with nothing picked; ✗ or Escape drops the selection
// (see feature.ts for the shared machinery). The region is what `loopAt`
// finds: the innermost loop the click is inside, then the nearest — so a
// click on an island takes the island, a click between it and the outline
// takes the outline with its hole, and a click on a solid's lid takes the lid.
//
// **What it builds is typed**, a line per region: `extrude("l1", 25)`, the
// shortest call that names that region (`regionNaming`) — with the frame that
// narrows it when every member is shared with another plane's loop (a lid's
// edges are walls' too), and the profile resolved when every member is shared
// in its own plane (one half of a split rectangle). A region running through a
// crossing no point marks yet, every member shared, is the one thing no typed
// line can name — a typed profile names points, and a crossing is not one
// until an extrude makes it one — so that region alone is extruded by calling
// the operation, which journals the same entry and the log reports as
// `e1  extrude of …`.
//
// **A click proposes the loops inside; a click on one of them takes it out.**
// A region's membership is what the user confirmed (docs/plans/explicit-
// regions.md; the owner: *"I don't think coplanarity should be used as an
// automatic basis for deciding which entities to include in a region"*, and on
// the proposal, *"do what you think is best"*). So the click between the
// holes and the outline proposes the outline with every loop inside it, as it
// always did — that is the proposal, and the preview shows it — and the
// record keeps exactly what ✓ built: nothing drawn inside later joins it. Once
// a region is picked, **a click on one of its holes** (a loop an odd number of
// loops down, so empty by even-odd), **or anywhere inside a hole already taken
// out, toggles that hole out of the proposal and back in**; the preview fills
// it, and ✓ types the loops outright — `extrude("l1", 10, "f1", [[…]])` —
// since the short form would take them all. **A click on an island that is
// solid** (an even number of loops down) **is still a region of its own**, a
// second solid, as it always was. Before anything is picked a click inside a
// hole picks the hole's own region, as ever. Later, `hole`/`unhole` and the
// edit dialog (edit.ts) change what a feature's region holds.
//
// **A region no frame orients gets its plane first, typed.** An extrude runs
// along a frame's +z, and a rectangle drawn in a fresh model has none — the
// owner's first run, refused eight times. A frame of three of the loop's own
// points is the sketch's own plane, not a datum nobody chose (it is what
// "Sketch on this face" makes), so the confirm types it — `plane(a, b, c, {
// look: false })`, or `frame(a, b, c)` beside a default it keeps — ahead of the
// region's extrude, in the same user action. The view does not turn.
//
// **A miss is guidance.** A click in no region says so in a line — "click
// inside a closed outline — the ones I can see are lit" — muted, the tool still
// armed.

import { defineTool, type FeatureStep, type PointerInfo, type RegionHit, type RenderContext } from "./tool.ts";
import type { OptionSpecs } from "./options.ts";
import { DEFAULT_DEPTH, extrude, extrudeProfile, orientingPlane, profileOf, profileOfLoops, regionNaming, regionOf } from "../operations.ts";
import { memberName } from "../model.ts";
import { drawHit, lightRegions, missedRegion, namedRegionAt, outlineLoops, regionKey } from "./region.ts";
import { FeatureTool, MODE_OPTION, callText, foundRegion, modeOptions } from "./feature.ts";
import type { FeatureOptions } from "../operations.ts";
import { RegionSelection, leftOut } from "./selection.ts";

/**
 * The steps that extrude `region` `depth` deep: its plane if it needs one, then
 * the shortest typed call that names it — or, with holes clicked out of the
 * proposal (`without`, points inside them), the call that names its loops
 * outright, `extrude("l1", 10, "f1", [[…], […]])`, which takes exactly those.
 */
export function extrudeSteps(region: RegionHit, depth: number, typed: boolean, without: readonly number[][] = [],
                             options: FeatureOptions | null = null): FeatureStep[] {
  // The mode, when one was chosen: typed last, as the call takes it.
  const tail = options ? [options] : [];
  return [(m): ReturnType<FeatureStep> => {
    const r = foundRegion(m, region);
    // Inside a named region the click took the region: `extrude("rg1", 10)`.
    const named = namedRegionAt(m, r);
    if (named) return { text: callText("extrude", [named, depth, ...tail]), direct: () => extrude(m, named, depth, ...tail) };
    const out = leftOut(m, r, without);
    if (out.size) {
      const p = profileOfLoops(m, r.loops, regionOf(r.loops, r.index).filter((i) => !out.has(i)),
        orientingPlane(m, r.loops[r.index], region.toward));
      if (p.crossings?.size) return { call: () => { extrudeProfile(m, p, depth, options ?? {}); } };
      const member = memberName(p.loops[0][0]);
      return {
        text: callText("extrude", [member, depth, p.frame, p.loops, ...tail]),
        direct: () => extrude(m, member, depth, p.frame, p.loops, ...tail),
      };
    }
    const n = regionNaming(m, r.loops, r.index, region.toward);
    if (!n) {
      return { call: () => { extrudeProfile(m, profileOf(m, r.loops, r.index, orientingPlane(m, r.loops[r.index], region.toward)), depth, options ?? {}); } };
    }
    const args: unknown[] = [n.member, depth];
    if (n.frame !== null || n.loops !== null) args.push(n.frame);
    if (n.loops !== null) args.push(n.loops);
    return { text: callText("extrude", [...args, ...tail]), direct: () => extrude(m, n.member, depth, n.frame, n.loops, null, ...tail) };
  }];
}

export class ExtrudeTool extends FeatureTool {
  // Negative is allowed — the other way along +z, as the typed call takes it;
  // zero is no solid at all.
  static readonly options: OptionSpecs = {
    depth: { default: DEFAULT_DEPTH, unit: "length", check: (v) => (v === 0 ? "cannot be 0" : null) },
    mode: MODE_OPTION,
  };
  static readonly summary = "Pulls a closed shape into a solid: click inside it, then ✓";
  readonly name = "extrude";
  private under: RegionHit | null = null;
  /** The regions picked, in the order picked. */
  readonly picks = new RegionSelection();

  /** Armed, the depth is always here and checked; the fallback is for a tool driven with no engine. */
  private depthOf(values: Record<string, unknown>): number {
    const d = values.depth;
    return typeof d === "number" && Number.isFinite(d) && d !== 0 ? d : DEFAULT_DEPTH;
  }

  onArmed(): void {
    const given = this.ctx.preselected ?? [];
    if (given.length) {
      this.picks.adopt(given);
      this.ctx.requestRender();
    }
  }

  protected plan(values: Record<string, unknown>): FeatureStep[] | null {
    if (!this.picks.size) return null;
    const depth = this.depthOf(values);
    const typed = !!this.ctx.perform;
    const options = modeOptions(values);
    // Two clicks inside one named region are one region, extruded once.
    const seen = new Set<string>();
    return this.picks.regions.flatMap((r, i) => {
      const named = namedRegionAt(this.ctx.model, r);
      if (named) {
        if (seen.has(named)) return [];
        seen.add(named);
      }
      return extrudeSteps(r, depth, typed, this.picks.without(i), options);
    });
  }

  protected picksKey(): string {
    return this.picks.key();
  }

  protected dropPicks(): boolean {
    this.under = null;
    return this.picks.clear();
  }

  protected wanting(): string | null {
    return null; // nothing picked is the only way to be short of an extrude
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
      this.guide(missedRegion(this.ctx.model));
      return;
    }
    if (this.picks.toggle(this.ctx.model, hit) === "again") {
      this.confirm();
      return;
    }
    this.ctx.requestRender();
  }

  /**
   * Every region a click could take, lit faintly; the picked ones a shade
   * stronger; the one under the cursor outlined — exactly the profile a click
   * would take; and over all of it the solids a confirm would build.
   */
  render(r: RenderContext): void {
    const model = this.ctx.model;
    lightRegions(model, r, this.under);
    this.picks.refresh(model).forEach((picked, i) => {
      const out = leftOut(model, picked, this.picks.without(i));
      drawHit(model, r, picked, "40", undefined, out);
      // A hole clicked out stays outlined, so it can be clicked back in.
      outlineLoops(model, r, picked.loops, [...out]);
    });
    if (this.under) drawHit(model, r, this.under);
    this.renderPreview(r);
  }
}

