// The surface tool (docs/plans/surfaces.md): click a curve — the chain it is in
// comes with it, open or closed, as the offset tool takes one — and the sheet
// it sweeps is drawn where it will be, in the tools' green: the chain, the
// chain again a depth along its plane's normal, the open ends joined. The depth
// is the options panel's (negative: the other side). ✓, Enter, or a click on
// the chain again makes it — one typed line, `surface("l1", 20)`, one undo
// step. A click on another curve takes its chain instead.
//
// Under the extrude button, beside the extrude that sweeps a region into a
// solid: one tool sweeping curves into a sheet, no button of its own.

import { press, type FeatureStep, type Hand, type PointerInfo, type RenderContext } from "./tool.ts";
import type { OptionSpecs } from "./options.ts";
import { FeatureTool, callText } from "./feature.ts";
import { REGION_GREEN } from "./region.ts";
import { curveUnder, pieceSamples, strokeWorld } from "./editdraw.ts";
import { chainThrough } from "../sketchedit.ts";
import { surfaceExtrude, surfacePlane } from "../surfaces.ts";
import { planeAxes } from "../curveplane.ts";
import { unit3 } from "../vec3.ts";

export const DEFAULT_SURFACE_DEPTH = 20;

export class SurfaceTool extends FeatureTool {
  static readonly options: OptionSpecs = {
    depth: { default: DEFAULT_SURFACE_DEPTH, unit: "length", check: (v) => ((v as number) !== 0 ? null : "must not be 0") },
  };
  static readonly summary = "Sweeps curves into a surface: click a curve, set the depth, ✓";
  readonly name = "surface";
  chain: string[] = [];

  private depth(values: Record<string, unknown> = this.values()): number {
    const d = values.depth;
    return typeof d === "number" && Number.isFinite(d) && d !== 0 ? d : DEFAULT_SURFACE_DEPTH;
  }

  protected plan(values: Record<string, unknown>): FeatureStep[] | null {
    if (!this.chain.length || this.ctx.model.dim !== 3) return null;
    const names = [...this.chain];
    const depth = this.depth(values);
    // The one-name form when the chain is the whole chain through its first curve.
    const whole = chainThrough(this.ctx.model, names[0]);
    const one = whole.length === names.length && whole.every((n) => names.includes(n));
    const arg: string | string[] = one ? names[0] : names;
    return [(m) => ({ text: callText("surface", [arg, depth]), direct: () => surfaceExtrude(m, arg, depth) })];
  }

  protected picksKey(): string {
    return this.chain.join(",");
  }

  protected dropPicks(): boolean {
    const had = this.chain.length > 0;
    this.chain = [];
    return had;
  }

  protected wanting(): string | null {
    return null;
  }

  protected get verb(): string {
    return "make the surface";
  }

  protected picking(hand: Hand): string {
    return this.chain.length ? `${press(hand)} the chain again, or ✓, to make it` : `${press(hand)} a curve to sweep into a surface`;
  }

  onDown(p: PointerInfo): void {
    if (this.ctx.model.dim !== 3) {
      this.guide("a surface is 3D — this drawing is 2D");
      return;
    }
    const curve = curveUnder(this.ctx, p);
    if (curve && this.chain.includes(curve)) {
      this.confirm();
      return;
    }
    if (curve) {
      this.chain = chainThrough(this.ctx.model, curve);
      this.ctx.requestRender();
      return;
    }
    this.guide("click a line, arc or circle — the chain it is in is swept");
  }

  render(r: RenderContext): void {
    const model = this.ctx.model;
    if (!this.chain.length || !this.chain.every((c) => model.entities.has(c))) return;
    let n: number[] | null = null;
    try {
      const p = planeAxes(model, surfacePlane(model, this.chain));
      n = p ? unit3(p.n) : null;
    } catch {
      n = null;
    }
    const d = this.depth();
    for (const c of this.chain) {
      const base = pieceSamples(model, c, 0, 1);
      strokeWorld(r, base, REGION_GREEN, 3);
      if (!n) continue;
      const up = base.map((q) => q.map((v, i) => v + n![i] * d));
      strokeWorld(r, up, REGION_GREEN, 1.8, [6, 4]);
      // Each curve's ends joined to their copies: the sheet's sides, and its seams between curves.
      for (const q of [base[0], base[base.length - 1]]) strokeWorld(r, [q, q.map((v, i) => v + n![i] * d)], REGION_GREEN, 1.2, [3, 3]);
    }
  }
}
