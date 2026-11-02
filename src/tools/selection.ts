// Which regions are selected — the feature tools' picks, and the canvas's
// preselection with nothing armed.
//
// Onshape's selection, as far as regions go: a click inside a region toggles it
// into a feature's selection, several may be selected, and a second click on
// the one picked last confirms (the quick path: click, click). With nothing
// armed, a click selects only that region and a shift-click adds or drops one,
// and arming a tool that takes regions starts from what is selected — select
// the loop, then hit extrude, as the owner wrote.
//
// **A region is kept by a point inside it, not by its loop.** A region is a
// question asked of the drawing, not an entity (see region.ts), and the answer
// moves under a selection: a loop found again has new indices, and the
// extrude of one half of a split rectangle makes the crossing a point, which
// relabels the other half's members. So a pick keeps where the click met the
// region's plane (`RegionHit.at`) and is found again as the loop around that
// point (`loopAround`) — the drawing as it stands, every time it is asked.

import type { Model } from "../model.ts";
import { findLoops, loopAround, type Loop } from "../loops.ts";
import type { RegionHit } from "./tool.ts";
import { regionKey } from "./region.ts";

/**
 * `region` found again in the drawing as it stands — the loop around the point
 * it was picked at — or null when no loop holds that point any more (its
 * outline was deleted, or opened). `loops` is `findLoops`'s answer when the
 * caller has it, so the indices of every region found against it agree.
 */
export function refind(model: Model, region: RegionHit, loops: Loop[] = findLoops(model)): RegionHit | null {
  const loop = loopAround(model, region.at, loops);
  return loop ? { loops, index: loops.indexOf(loop), toward: region.toward, at: region.at } : null;
}

/** What a click inside a region did to a selection. */
export type Toggled = "added" | "dropped" | "again";

/**
 * An ordered set of regions, in the order they were picked — which is the order
 * a confirm builds them in, so the log reads as the clicks did. Pure: every
 * question about the drawing is asked of the loops it is handed.
 */
export class RegionSelection {
  private picked: RegionHit[] = [];

  /** The regions, in the order picked. */
  get regions(): readonly RegionHit[] {
    return this.picked;
  }

  get size(): number {
    return this.picked.length;
  }

  /** The one picked last — whose second click confirms. */
  get last(): RegionHit | null {
    return this.picked.at(-1) ?? null;
  }

  /**
   * Where each region was picked, as text — the selection's identity for a
   * preview keyed by it. Points, not loops, for the reason at the top.
   */
  key(): string {
    return this.picked.map((r) => r.at.map((c) => c.toFixed(6)).join(",")).join("|");
  }

  /** Which of the picks `hit` is — compared as regions found in `hit`'s own loops — or -1. */
  indexOf(model: Model, hit: RegionHit): number {
    const want = regionKey(hit);
    return this.picked.findIndex((r) => regionKey(refind(model, r, hit.loops)) === want);
  }

  /**
   * A feature tool's click inside `hit`: the last region picked again is
   * `"again"` (and is left selected — the caller confirms), another one already
   * picked is dropped, and one not picked is added at the end.
   */
  toggle(model: Model, hit: RegionHit): Toggled {
    const at = this.indexOf(model, hit);
    if (at === -1) {
      this.picked.push(hit);
      return "added";
    }
    if (at === this.picked.length - 1) return "again";
    this.picked.splice(at, 1);
    return "dropped";
  }

  /** The canvas's shift-click: adds `hit`, or drops it if it is already selected — never "again". */
  flip(model: Model, hit: RegionHit): Exclude<Toggled, "again"> {
    const at = this.indexOf(model, hit);
    if (at === -1) {
      this.picked.push(hit);
      return "added";
    }
    this.picked.splice(at, 1);
    return "dropped";
  }

  /** The canvas's plain click: this region and no other. */
  only(hit: RegionHit): void {
    this.picked = [hit];
  }

  /** Drops every pick, answering whether there was one to drop. */
  clear(): boolean {
    const had = this.picked.length > 0;
    this.picked = [];
    return had;
  }

  /**
   * Every pick found again in the drawing as it stands; any that is no longer
   * there is dropped. Returns the regions found, against one `findLoops`, in
   * the order picked.
   */
  refresh(model: Model, loops: Loop[] = findLoops(model)): RegionHit[] {
    const found = this.picked.map((r) => refind(model, r, loops));
    this.picked = this.picked.filter((_, i) => found[i] !== null);
    return found.filter((r): r is RegionHit => r !== null);
  }

  /** Takes over `regions` (a preselection), as picked in that order. */
  adopt(regions: readonly RegionHit[]): void {
    this.picked = [...regions];
  }
}
