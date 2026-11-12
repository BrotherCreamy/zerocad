// The region tool: click a face to make a region of it, then click faces to
// combine with it — subtract (the default), add or intersect — each click one
// typed line, one undo step (docs/plans/regions-as-operations.md).
//
// The owner: *"there should be no such thing as a negative face. a face is
// just a face. just like there should be no such thing as a negative solid,
// only an operation which subtracts one solid from another"*. So this tool
// never decides what is a hole. A click inside a face with no region in hand
// types `region("l1")` and holds the region it made; with a region in hand, a
// click on a face types the mode's operation on it — `subtract("rg1", "c1")`,
// `add(…)`, `intersect(…)` — and the region in hand is drawn as a feature
// would take it, holes clear. The mode row is the extrude dialog's shape:
// **New · Add · Subtract · ∩**, none pressed meaning what the extrude's
// unpressed row means — the obvious thing: Subtract with a region in hand
// (a face inside a region is the commonest next click), a new region with
// none. New pressed makes another region of the face clicked, which is then
// the one in hand.
//
// **With a region in hand a click is read on its plane** (`ctx.planeAt`), as
// the edit dialog reads its clicks: once a feature stands on the region its
// lid is nearer the eye than the sketch, and a click aimed at a circle under
// the lid means the circle, not the lid's twin of it.
//
// **Which region is in hand**: the one this arming made last, or the one a
// click landed inside while none was (taking it in hand types nothing — it
// is a choice of what the next click edits, not an edit), or the one the tool
// was armed on (`arm("region", {}, "rg1")`, the organiser's *Edit rg1*).
// Escape, or ✗, puts it down; a second Escape puts the tool down, as every
// tool's does.
//
// **What it types is a line a user could have**: the shortest member that
// names the face alone — the face resolved beside it only where no member
// does (an edge two faces share) — so the log reads as the clicks did, and
// the journal holds what the typed call journals. A refusal (a face that
// takes nothing away) is guidance, muted, and the region stays in hand.

import { Tool, press, type Hand, type PointerInfo, type RegionHit, type RenderContext, type ToolContext, type How } from "./tool.ts";
import type { OptionSpecs } from "./options.ts";
import { drawNamedRegion, drawRegion, lightRegions, missedRegion, regionKey } from "./region.ts";
import { callText } from "./feature.ts";
import { findLoops, loopAround, type Loop } from "../loops.ts";
import {
  faceNaming, planRegionStep, region as makeRegion, regionHolds, regionStepNaming, regionValue, subtract, add, intersect,
} from "../operations.ts";

/** The cut's red, as the preview of a cut draws it — what a click would subtract is drawn in it. */
export const SUBTRACT_RED = "#e8806c";

/** The mode row's choices, in the extrude dialog's order — the first, unpressed, the obvious thing. */
export const REGION_MODES = { auto: "auto", new: "New", add: "Add", subtract: "Subtract", intersect: "∩" } as const;
export type RegionMode = Exclude<keyof typeof REGION_MODES, "auto">;

const OPS = { add, subtract, intersect } as const;

/** The verb a mode's click does, for the chip and the hover. */
const VERB: Record<RegionMode, string> = { new: "make a region of", add: "add", subtract: "subtract", intersect: "intersect with" };

export class RegionTool extends Tool {
  static readonly summary = "Combines faces into a region: click a face, then faces to subtract";
  static readonly how: How = [
    "{Tap} inside a closed outline to make a region of it.",
    "Then {tap} outlines inside it to cut them out.",
  ];
  static readonly options: OptionSpecs = {
    // No label: the row is the panel's only one, and "Subtract" is the long
    // word the extrude's Cut is not — beside it the label was cut to one
    // letter (found by looking at the screenshot).
    mode: { default: "auto", choices: REGION_MODES, buttons: true, remember: false, label: "" },
  };
  readonly name = "region";
  readonly snaps = false;
  /** The region in hand: what the next click edits. */
  held: string | null = null;
  private under: RegionHit | null = null;

  constructor(ctx: ToolContext) {
    super(ctx);
    if (typeof ctx.target === "string" && ctx.model.regions.has(ctx.target)) this.held = ctx.target;
  }

  /** The mode pressed, or null for none — the obvious thing. */
  private pressed(): RegionMode | null {
    const m = this.ctx.options.mode;
    return typeof m === "string" && m !== "auto" && Object.hasOwn(REGION_MODES, m) ? m as RegionMode : null;
  }

  private holding(): boolean {
    return this.held !== null && this.ctx.model.regions.has(this.held);
  }

  /** What a click does now: make a region, or the mode's step on the one in hand (Subtract unless another is pressed). */
  private doing(): RegionMode {
    return !this.holding() ? "new" : this.pressed() ?? "subtract";
  }

  /**
   * The face under `screen` on `region`'s plane — where its first face is —
   * or null. What a click with that region in hand is read as.
   */
  private onPlaneOf(region: string, screen: [number, number], loops: Loop[] = findLoopsSafe(this.ctx.model)): RegionHit | null {
    if (!this.ctx.planeAt) return null;
    try {
      const v = regionValue(this.ctx.model, region, loops);
      const plane = loops[v.faces[0]!].plane;
      const at = this.ctx.planeAt(screen, plane);
      if (!at) return null;
      const loop = loopAround(this.ctx.model, at, loops);
      return loop ? { loops, index: loops.indexOf(loop), toward: plane.normal, at } : null;
    } catch {
      return null;
    }
  }

  /** The face a press at `screen` means: on the plane of the region in hand, else the nearest under the pointer. */
  private faceAt(screen: [number, number]): RegionHit | null {
    const hit = this.holding() ? this.onPlaneOf(this.held!, screen) : null;
    return hit ?? this.ctx.regionAt?.(screen) ?? null;
  }

  /** The latest region shown that a press at `screen` is inside, each asked on its own plane. */
  private regionUnder(screen: [number, number], hit: RegionHit): string | null {
    const model = this.ctx.model;
    for (const name of [...model.regions.keys()].reverse()) {
      if (model.hidden.has(name)) continue;
      const on = this.onPlaneOf(name, screen, hit.loops) ?? hit;
      try {
        if (regionHolds(model, regionValue(model, name, hit.loops), on.at)) return name;
      } catch {
        // a region whose first face is gone holds nothing
      }
    }
    return null;
  }

  next(hand: Hand): string {
    const d = this.doing();
    if (d === "new") return `${press(hand)} a face to make a region of it`;
    return `${press(hand)} a face to ${VERB[d]} ${this.held}`;
  }

  /**
   * Armed again with other options — a mode button pressed, or `arm("region",
   * { mode: "add" })` typed — it keeps the region in hand: the engine hands it
   * the new options, and the next click is read in the new mode.
   */
  retune(): void {
    this.ctx.requestRender();
  }

  /** Escape's first press: the region goes out of hand, and the tool stays armed. */
  clear(): boolean {
    const had = this.held !== null;
    this.held = null;
    this.under = null;
    this.ctx.requestRender();
    return had;
  }

  onCancel(): void {
    this.under = null;
    this.ctx.requestRender();
  }

  onMove(p: PointerInfo): void {
    const next = this.faceAt(p.screen);
    const changed = regionKey(next) !== regionKey(this.under);
    this.under = next;
    if (changed) this.ctx.requestRender();
  }

  onDown(p: PointerInfo): void {
    const model = this.ctx.model;
    const hit = this.faceAt(p.screen);
    if (!hit) {
      this.guide(missedRegion(model));
      return;
    }
    const d = this.doing();
    // Nothing in hand and the click inside a region: take that one in hand.
    if (d === "new" && this.pressed() !== "new") {
      const inside = this.regionUnder(p.screen, hit);
      if (inside) {
        this.held = inside;
        this.ctx.requestRender();
        return;
      }
    }
    let line: string, direct: () => string;
    try {
      if (d === "new") {
        const n = faceNaming(model, hit.loops, hit.index, hit.toward);
        const args: unknown[] = [n.member];
        if (n.frame !== null || n.face !== null) args.push(n.frame);
        if (n.face !== null) args.push(n.face);
        line = callText("region", args);
        direct = () => makeRegion(model, n.member, n.frame, n.face);
      } else {
        const r = this.held!;
        const n = regionStepNaming(model, d, r, hit.loops, hit.index);
        planRegionStep(model, d, r, n.member, n.face ?? undefined); // its refusal, before anything is typed
        line = callText(d, n.face === null ? [r, n.member] : [r, n.member, n.face]);
        direct = () => OPS[d](model, r, n.member, n.face ?? undefined);
      }
    } catch (e) {
      this.guide(e instanceof Error ? e.message : String(e));
      return;
    }
    this.commit(line, direct, d === "new");
  }

  /** Types the line where there is a command line, else makes the call; a new region is then the one in hand. */
  private commit(line: string, direct: () => string, made: boolean): void {
    const model = this.ctx.model;
    const had = new Set(model.regions.keys());
    const after = () => {
      if (made) this.held = [...model.regions.keys()].find((r) => !had.has(r)) ?? this.held;
      this.ctx.requestRender();
    };
    if (this.ctx.run) {
      const done = this.ctx.run(line);
      if (done instanceof Promise) void done.then(after);
      else after();
      return;
    }
    direct();
    after();
    this.ctx.requestSolve();
  }

  /** Guidance where there is a user to tell, a throw headless — the extrude tool's convention. */
  private guide(text: string): void {
    this.ctx.requestRender();
    if (!this.ctx.log) throw new Error(text);
    this.ctx.log(`region: ${text}`, "guide");
  }

  /**
   * Every face lit; the region in hand drawn as a feature would take it, a
   * shade stronger; and the face under the cursor outlined — in the cut's red
   * when the click would subtract it, the tools' green otherwise.
   */
  render(r: RenderContext): void {
    const model = this.ctx.model;
    lightRegions(model, r, this.under);
    if (this.held !== null && model.regions.has(this.held)) {
      try {
        drawNamedRegion(model, r, this.held, this.under?.loops ?? findLoopsSafe(model), "40");
      } catch {
        // a region whose first face is gone draws nothing
      }
    }
    if (this.under) {
      // Red where the click would take the face away; the region's own first
      // face is never that (it would leave nothing), and is drawn green.
      const own = this.holding() && (() => {
        try {
          return regionValue(model, this.held!, this.under!.loops).faces[0] === this.under!.index;
        } catch {
          return false;
        }
      })();
      drawRegion(model, r, this.under, "2e", this.doing() === "subtract" && !own ? SUBTRACT_RED : undefined);
    }
  }
}

function findLoopsSafe(model: ToolContext["model"]): Loop[] {
  try {
    return findLoops(model);
  } catch {
    return [];
  }
}
