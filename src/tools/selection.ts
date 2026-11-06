// What is selected — the canvas's selection with nothing armed (entities,
// relations and regions: `Selection`), and the feature tools' picks of regions
// (`RegionSelection`).
//
// **There was no entity selection until groups needed one** (docs/plans/
// groups.md): a click put a name in the command line and that was all. A
// click still does that while a command is being written — text in the
// command line is the signal, the same one the undo carve-out read — and
// otherwise selects, as every CAD tool's click does, so a set can be grouped,
// deleted or hidden in one gesture.
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
import { depthBelow, regionOf } from "../operations.ts";

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

/** What a click on a hole of a picked region did to that region's proposal. */
export type HoleToggled = "out" | "in";

/**
 * The loops of `region` a creating dialog leaves out — each loop around one of
 * `without` that lies inside the region, and every loop inside that — as
 * indices into `region.loops`. Kept by points for the reason picks are.
 */
export function leftOut(model: Model, region: RegionHit, without: readonly number[][]): Set<number> {
  const out = new Set<number>();
  for (const at of without) {
    const loop = loopAround(model, at, region.loops);
    if (!loop) continue;
    const i = region.loops.indexOf(loop);
    if (depthBelow(region.loops, i, region.index) === 0) continue;
    for (const j of regionOf(region.loops, i)) out.add(j);
  }
  return out;
}

/**
 * An ordered set of regions, in the order they were picked — which is the order
 * a confirm builds them in, so the log reads as the clicks did. Pure: every
 * question about the drawing is asked of the loops it is handed.
 *
 * **Each pick proposes its loop and every loop inside it** — the holes a click
 * between them and the outline means, as ever — and a click on one of those
 * holes, or inside one already left out, takes it out of the proposal or puts
 * it back (`toggleHole`), rather than picking the hole as a region of its own.
 * A click on an island that is solid (a loop an even number of loops down) is
 * still a region of its own, as it always was. Which loops are left out is
 * kept per pick, by a point inside each (`without`).
 */
export class RegionSelection {
  private picked: RegionHit[] = [];
  /** Per pick, a point inside each loop left out of its proposal. */
  private holes: number[][][] = [];

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
    const at = (p: number[]) => p.map((c) => c.toFixed(6)).join(",");
    return this.picked.map((r, i) => [at(r.at), ...this.holes[i].map(at)].join("-")).join("|");
  }

  /** Where each loop left out of pick `i`'s proposal was clicked. */
  without(i: number): readonly number[][] {
    return this.holes[i] ?? [];
  }

  /**
   * A creating dialog's click inside `hit`, asked before `toggle`: when the
   * loop under it is a hole of a picked region — an odd number of loops down —
   * it is taken out of that region's proposal (`"out"`); when it is inside a
   * loop already taken out, that loop is put back (`"in"`); otherwise null, and
   * the click is the region's own (an island that is solid, or anywhere else).
   * The pick it belongs to is the innermost one it is inside.
   */
  toggleHole(model: Model, hit: RegionHit): HoleToggled | null {
    const loops = hit.loops;
    let best = -1, depth = Infinity, found: RegionHit | null = null;
    this.picked.forEach((p, k) => {
      const r = refind(model, p, loops);
      if (!r) return;
      const d = depthBelow(loops, hit.index, r.index);
      if (d > 0 && d < depth) [best, depth, found] = [k, d, r];
    });
    if (best < 0 || !found) return null;
    const ex = this.holes[best];
    for (let j = 0; j < ex.length; j++) {
      const loop = loopAround(model, ex[j], loops);
      if (!loop) continue;
      const i = loops.indexOf(loop);
      if (i === hit.index || depthBelow(loops, hit.index, i) > 0) {
        ex.splice(j, 1);
        return "in";
      }
    }
    if (depth % 2 === 0) return null;
    ex.push(hit.at);
    return "out";
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
      this.holes.push([]);
      return "added";
    }
    if (at === this.picked.length - 1) return "again";
    this.picked.splice(at, 1);
    this.holes.splice(at, 1);
    return "dropped";
  }

  /** The canvas's shift-click: adds `hit`, or drops it if it is already selected — never "again". */
  flip(model: Model, hit: RegionHit): Exclude<Toggled, "again"> {
    const at = this.indexOf(model, hit);
    if (at === -1) {
      this.picked.push(hit);
      this.holes.push([]);
      return "added";
    }
    this.picked.splice(at, 1);
    this.holes.splice(at, 1);
    return "dropped";
  }

  /** The canvas's plain click: this region and no other. */
  only(hit: RegionHit): void {
    this.picked = [hit];
    this.holes = [[]];
  }

  /** Drops every pick, answering whether there was one to drop. */
  clear(): boolean {
    const had = this.picked.length > 0;
    this.picked = [];
    this.holes = [];
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
    this.holes = this.holes.filter((_, i) => found[i] !== null);
    return found.filter((r): r is RegionHit => r !== null);
  }

  /** Takes over `regions` (a preselection), as picked in that order. */
  adopt(regions: readonly RegionHit[]): void {
    this.picked = [...regions];
    this.holes = regions.map(() => []);
  }
}

/**
 * The selection's colour: a violet — not the hover's amber, not an armed
 * tool's green, not either box's blue or green — chosen to read on a solid's
 * light faces (with the casing every light mark gets there, main.ts) and on
 * the dark ground alike. Entities, glyphs and preselected regions all wear
 * it: one selection, one highlight family.
 */
export const SELECTION = "#c46cff";

/**
 * **The canvas's selection**: the entities and relations picked with nothing
 * armed, in the order picked — and the regions, which are the same selection
 * for regions (`regions`), kept by a point inside each for the reason at the
 * top of this file.
 *
 * UI state and nothing more: never journalled, never in a file, never an undo
 * step. What it holds is names, so a name that stops answering — deleted, or
 * hidden — leaves it the next time it is asked (`prune`).
 */
export class Selection {
  private picked: string[] = [];
  readonly regions = new RegionSelection();
  /**
   * **Kernel edges** picked (docs/plans/solid-fillets.md): edges of bodies the
   * solid kernel built, by name (`e1.lid|e1.m0`) — no entity's, so kept apart
   * from `names`, which the model prunes. A click, a shift-click and a box
   * select them as they do entities; the fillet and chamfer tools start from
   * them. Pruned by the host against the bodies on screen (`pruneEdges`).
   */
  private edgeNames: string[] = [];

  /** The names, in the order picked. */
  get names(): readonly string[] {
    return this.picked;
  }

  /** The kernel edges, in the order picked. */
  get edges(): readonly string[] {
    return this.edgeNames;
  }

  get size(): number {
    return this.picked.length + this.regions.size + this.edgeNames.length;
  }

  /** A plain click on an edge: it and nothing else. */
  onlyEdge(name: string): void {
    this.picked = [];
    this.regions.clear();
    this.edgeNames = [name];
  }

  /** A shift-click (or a tap, once something is selected) on an edge: in if it was out, out if it was in. */
  toggleEdge(name: string): void {
    const at = this.edgeNames.indexOf(name);
    if (at === -1) this.edgeNames.push(name);
    else this.edgeNames.splice(at, 1);
  }

  /** A box's edges: added (a shift-box, a finger's) or exactly these (a plain box, after `set`). */
  addEdges(names: readonly string[]): void {
    for (const n of names) if (!this.edgeNames.includes(n)) this.edgeNames.push(n);
  }

  /** Drops the edges no body on screen has any more — asked every frame, as `prune` is. */
  pruneEdges(present: (name: string) => boolean): readonly string[] {
    this.edgeNames = this.edgeNames.filter(present);
    return this.edgeNames;
  }

  has(name: string): boolean {
    return this.picked.includes(name);
  }

  /** A plain click: this and nothing else — no region either. */
  only(name: string): void {
    this.picked = [name];
    this.regions.clear();
    this.edgeNames = [];
  }

  /** A shift-click: in if it was out, out if it was in. Regions are left alone. */
  toggle(name: string): void {
    const at = this.picked.indexOf(name);
    if (at === -1) this.picked.push(name);
    else this.picked.splice(at, 1);
  }

  /** A shift-box: every name not already selected, at the end. */
  add(names: readonly string[]): void {
    for (const n of names) if (!this.picked.includes(n)) this.picked.push(n);
  }

  /** A plain box, or `select(...)` typed: exactly these, no region. */
  set(names: readonly string[]): void {
    this.picked = [...new Set(names)];
    this.regions.clear();
    this.edgeNames = [];
  }

  /** Drops everything, answering whether there was anything to drop. */
  clear(): boolean {
    const had = this.size > 0;
    this.picked = [];
    this.regions.clear();
    this.edgeNames = [];
    return had;
  }

  /**
   * The names that still answer — not deleted, not hidden — with the rest
   * dropped. Asked every frame by whatever draws the selection, so a hidden
   * entity leaves the selection as it leaves the screen.
   */
  prune(model: Model): readonly string[] {
    this.picked = this.picked.filter((n) => model.has(n) && !model.hidden.has(n));
    return this.picked;
  }
}
