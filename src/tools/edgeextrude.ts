// The edge extrude tool (docs/plans/profiles-held.md): click a curve — the
// chain it is in comes with it, open or closed, as the surface tool takes one
// (the `chain` option off: the curve alone) — and its copy is drawn where it
// will be, in the tools' green, each end joined to its copy's: the chords the
// operation makes real. The depth is the options panel's (negative: the other
// side). ✓, Enter, or a click on the same curve again makes it — one typed
// line, `edgeExtrude("l1", 20)`, one undo step.
//
// A tool of its own beside the surface sweep, under the extrude button: the
// surface sweep makes a sheet and nothing else; this makes the copy and the
// chords, entities that stay and are held, and the sheet between them. The
// owner: *"Edge extrude is a fundamental feature."*

import { press, type FeatureStep, type Hand, type PointerInfo, type RenderContext, type How } from "./tool.ts";
import type { OptionSpecs } from "./options.ts";
import { FeatureTool, callText } from "./feature.ts";
import { REGION_GREEN } from "./region.ts";
import { curveUnder, pieceSamples, strokeWorld } from "./editdraw.ts";
import { chainThrough } from "../sketchedit.ts";
import { edgeExtrude, surfacePlane } from "../surfaces.ts";
import { planeAxes } from "../curveplane.ts";
import { unit3 } from "../vec3.ts";

export const DEFAULT_EDGE_DEPTH = 20;

export class EdgeExtrudeTool extends FeatureTool {
  static readonly options: OptionSpecs = {
    depth: { default: DEFAULT_EDGE_DEPTH, unit: "length", check: (v) => ((v as number) !== 0 ? null : "must not be 0") },
    chain: { default: true, label: "chain" },
  };
  static readonly summary = "Extrudes an edge: a copy of the curve, chords to it, the surface";
  static readonly how: How = [
    "{Tap} a curve: its whole chain comes with it.",
    "A copy is made a depth away, joined at each end.",
    "Set the depth in the options. ✓ makes it.",
  ];
  // Lower case, as every tool's name is (a glyph's name is the tool's); typed
  // bare, `edge` arms it, and `edgeExtrude(…)` is the call it types.
  readonly name = "edge";
  chain: string[] = [];

  private depth(values: Record<string, unknown> = this.values()): number {
    const d = values.depth;
    return typeof d === "number" && Number.isFinite(d) && d !== 0 ? d : DEFAULT_EDGE_DEPTH;
  }

  protected plan(values: Record<string, unknown>): FeatureStep[] | null {
    if (this.ctx.model.dim !== 3 || !this.chain.length) return null;
    const names = [...this.chain];
    const depth = this.depth(values);
    // The one-name form when the chain is the whole chain through its first curve.
    const whole = chainThrough(this.ctx.model, names[0]);
    const one = whole.length === names.length && whole.every((n) => names.includes(n));
    const arg: string | string[] = one ? names[0] : names;
    return [(m) => ({ text: callText("edgeExtrude", [arg, depth]), direct: () => edgeExtrude(m, arg, depth) })];
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
    return "extrude the edges";
  }

  protected picking(hand: Hand): string {
    if (this.chain.length) return `${press(hand)} it again, or ✓, to extrude it`;
    return `${press(hand)} a curve to extrude`;
  }

  onDown(p: PointerInfo): void {
    if (this.ctx.model.dim !== 3) {
      this.guide("an edge extrude is 3D — this drawing is 2D");
      return;
    }
    const curve = curveUnder(this.ctx, p);
    if (curve && this.chain.includes(curve)) {
      this.confirm();
      return;
    }
    if (curve) {
      this.chain = this.values().chain === false ? [curve] : chainThrough(this.ctx.model, curve);
      this.ctx.requestRender();
      return;
    }
    this.guide("click a line, arc, circle or spline — the chain it is in is extruded");
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
      // The copy solid, not dashed: it will be geometry, as the chords will.
      const up = base.map((q) => q.map((v, i) => v + n![i] * d));
      strokeWorld(r, up, REGION_GREEN, 1.8);
      for (const q of [base[0], base[base.length - 1]]) strokeWorld(r, [q, q.map((v, i) => v + n![i] * d)], REGION_GREEN, 1.2);
    }
  }
}
