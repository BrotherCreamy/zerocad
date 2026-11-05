// Edit e1: the feature dialog opened on a feature that exists.
//
// A region's membership is its outline and the holes the user confirmed
// (docs/plans/explicit-regions.md — the owner: *"there should be some kind of
// relationship between the loops > region > extrude"*, and *"I don't think
// coplanarity should be used as an automatic basis for deciding which
// entities to include in a region"*). So a circle drawn inside an extruded
// outline is not a hole until it is said to be one, and this is the pointer's
// way of saying it, beside `hole`/`unhole` typed and the menu's *Add as hole*.
//
// Opened by `edit("e1")` — what the menu's *Edit e1* types on a feature's face
// or a piece of it — the dialog lights the feature's region as its record
// says, holes clear; outlines every other loop inside the outline as
// available; and puts the depth (or angle) in the options panel. **A click on
// a loop inside the outline toggles it** — a hole filled, a loop cut through
// — and a click on the region itself is the quick path's second click. The
// preview is the edit run on a copy (featurepreview.ts), and the solid as it
// is steps aside while it is up (`replaces`), so a hole being cut shows.
// **✓ (Enter) types the steps** — `hole("e1", "c1")` or `unhole("e1", "c1")`
// per toggle in the order clicked, then `set("d1.value", 25)` if the value
// changed — as one user action, one undo step, exactly as a creating confirm
// types its lines; ✓ with nothing changed just closes. **✗ (Escape)** drops
// the toggles; a second releases the tool, the feature as it was. No
// rollback, no history: it edits the feature's inputs in place.
//
// **The click is read on the feature's own sketch plane**, wherever the lid
// is: the loops it toggles are under that lid, and `regionAt` would answer
// with the lid in front of them. Registered unlisted — a dialog opened on a
// thing is no tool to pick up empty-handed — under `edit extrude` and `edit
// revolve`, since each has one value of its own kind for the panel.

import { defineTool, type FeatureStep, type PointerInfo, type RenderContext, type FeaturePreview } from "./tool.ts";
import type { OptionSpecs } from "./options.ts";
import type { FeatureEntry, Model } from "../model.ts";
import { loopAround } from "../loops.ts";
import {
  DEFAULT_DEPTH, depthBelow, featureRegion, hole, holeNaming, regionOf, set, unhole, unholeNaming,
  type FeatureRegion,
} from "../operations.ts";
import { FULL_TURN } from "../relations/revolution.ts";
import { drawLoops, outlineLoops } from "./region.ts";
import { FeatureTool, callText } from "./feature.ts";

/** The value a feature's dimension holds now: its depth, or its angle. */
function valueOf(model: Model, f: FeatureEntry): number {
  return model.relationOf(f.kind === "extrude" ? f.depth : f.angle).args[1] as number;
}

/**
 * The steps an edit of `feature` types: per loop toggled — kept by a point
 * inside it, in the order clicked — `unhole` where it is a hole now and `hole`
 * where it is not, each asked of the model as the step before left it; then
 * `set` on the dimension when `value` is not what it holds. Empty when nothing
 * changes.
 */
export function editSteps(feature: string, toggled: readonly number[][], value: number | null): FeatureStep[] {
  const steps: FeatureStep[] = toggled.map((at) => (m) => {
    const f = m.featureOf(feature);
    const r = featureRegion(m, f);
    const loop = loopAround(m, at, r.all);
    const i = loop ? r.all.indexOf(loop) : -1;
    if (i < 0 || depthBelow(r.all, i, r.outline) === 0) {
      throw new Error(`a loop clicked is not inside ${feature}'s outline any more — click it again`);
    }
    const k = r.holes.indexOf(i);
    const n = k >= 0 ? unholeNaming(m, f, r, k + 1) : holeNaming(m, f, r, i);
    if (n === null) throw new Error(`no one member names that loop alone — type hole("${feature}", …) with one it has`);
    const op = k >= 0 ? unhole : hole;
    return { text: callText(k >= 0 ? "unhole" : "hole", [feature, n]), direct: () => op(m, feature, n) };
  });
  if (value !== null) {
    steps.push((m) => {
      const f = m.featureOf(feature);
      if (Math.abs(valueOf(m, f) - value) <= 1e-12 * Math.max(1, Math.abs(value))) return null;
      const path = `${f.kind === "extrude" ? f.depth : f.angle}.value`;
      return { text: callText("set", [path, value]), direct: () => set(m, path, value) };
    });
  }
  return steps;
}

abstract class EditTool extends FeatureTool {
  /** Points inside the loops toggled, in the order clicked. */
  private toggled: number[][] = [];
  /** The loop under the cursor, as an index into the loops last found. */
  private under: number | null = null;
  protected abstract readonly option: "depth" | "angle";

  /** The feature being edited, while it is there. */
  protected get feature(): FeatureEntry | null {
    const t = this.ctx.target;
    return t !== undefined && this.ctx.model.features.has(t) ? this.ctx.model.featureOf(t) : null;
  }

  onArmed(): void {
    if (this.feature) return;
    this.ctx.finish();
    this.guide(`${this.name} opens on a feature: edit("e1"), or right-click a solid's face → Edit e1`);
  }

  replaces(): readonly string[] {
    const f = this.feature;
    return f ? [f.name] : [];
  }

  protected previewFeatures(p: FeaturePreview): readonly string[] {
    const f = this.feature;
    return f && p.model?.features.has(f.name) ? [f.name] : [];
  }

  protected plan(values: Record<string, unknown>): FeatureStep[] | null {
    const f = this.feature;
    if (!f) return null;
    const v = values[this.option];
    return editSteps(f.name, this.toggled, typeof v === "number" && Number.isFinite(v) ? v : null);
  }

  protected picksKey(): string {
    return `${this.ctx.target ?? ""}:${this.toggled.map((p) => p.map((c) => c.toFixed(6)).join(",")).join("|")}`;
  }

  protected dropPicks(): boolean {
    const had = this.toggled.length > 0;
    this.toggled = [];
    this.under = null;
    return had;
  }

  protected wanting(): string | null {
    return null;
  }

  /** The feature's region as it stands, or null — a feature whose outline cannot be found has nothing to toggle. */
  private region(): FeatureRegion | null {
    const f = this.feature;
    if (!f) return null;
    try {
      return featureRegion(this.ctx.model, f);
    } catch {
      return null;
    }
  }

  /** The loop of `r` under a screen point, read on the outline's plane — or null off every loop. */
  private loopUnder(r: FeatureRegion, screen: [number, number]): number | null {
    const plane = r.all[r.outline].plane;
    const at = this.ctx.planeAt?.(screen, plane) ?? this.ctx.regionAt?.(screen)?.at ?? null;
    if (!at) return null;
    const loop = loopAround(this.ctx.model, at, r.all);
    return loop ? r.all.indexOf(loop) : null;
  }

  /** Which of `r`'s loops a toggle stands for, by the point it was clicked at. */
  private toggledLoops(r: FeatureRegion): number[] {
    return this.toggled.map((p) => {
      const l = loopAround(this.ctx.model, p, r.all);
      return l ? r.all.indexOf(l) : -1;
    });
  }

  onMove(p: PointerInfo): void {
    const r = this.region();
    const next = r ? this.loopUnder(r, p.screen) : null;
    if (next !== this.under) {
      this.under = next;
      this.ctx.requestRender();
    }
  }

  onDown(p: PointerInfo): void {
    const r = this.region();
    const f = this.feature;
    if (!r || !f) {
      this.guide(f ? `${f.name}'s outline cannot be found — regen("${f.name}") says why` : "the feature is gone");
      return;
    }
    const i = this.loopUnder(r, p.screen);
    if (i === r.outline) {
      this.confirm();
      return;
    }
    if (i === null || depthBelow(r.all, i, r.outline) === 0) {
      this.guide(`click a loop inside ${f.name}'s outline to cut it through or fill it — ✓ or Enter when done`);
      return;
    }
    const at = this.toggledLoops(r).indexOf(i);
    if (at >= 0) this.toggled.splice(at, 1);
    else this.toggled.push(this.ctx.planeAt?.(p.screen, r.all[r.outline].plane) ?? this.ctx.regionAt!(p.screen)!.at);
    this.ctx.requestRender();
  }

  /**
   * The region as it will be — the outline with the holes it will have, lit —
   * every other loop inside the outline outlined as available, the loop under
   * the cursor drawn brighter; and over it the preview of the feature edited.
   */
  render(rc: RenderContext): void {
    const r = this.region();
    if (r) {
      const flips = new Set(this.toggledLoops(r));
      const recorded = new Set(r.holes.filter((i): i is number => i !== null));
      const inner = regionOf(r.all, r.outline).slice(1);
      const holes = inner.filter((i) => recorded.has(i) !== flips.has(i));
      drawLoops(this.ctx.model, rc, r.all, [r.outline, ...holes], "40");
      outlineLoops(this.ctx.model, rc, r.all, inner.filter((i) => !holes.includes(i)));
      if (this.under !== null && this.under !== r.outline && inner.includes(this.under)) {
        outlineLoops(this.ctx.model, rc, r.all, [this.under], undefined, 2.4);
      }
    }
    this.renderPreview(rc);
  }

}

export class EditExtrudeTool extends EditTool {
  static readonly options: OptionSpecs = {
    depth: { default: DEFAULT_DEPTH, unit: "length", check: (v) => (v === 0 ? "cannot be 0" : null) },
  };
  static readonly summary = "Changes an extrude: click holes in or out, or change the depth";
  readonly name = "edit extrude";
  protected readonly option = "depth";
}

export class EditRevolveTool extends EditTool {
  static readonly options: OptionSpecs = {
    angle: {
      default: FULL_TURN, unit: "angle",
      check: (v) => (v === 0 || Math.abs(v as number) > FULL_TURN ? "must be within a whole turn (±6.283185) and not 0" : null),
    },
  };
  static readonly summary = "Changes a revolve: click holes in or out, or change the angle";
  readonly name = "edit revolve";
  protected readonly option = "angle";
}

