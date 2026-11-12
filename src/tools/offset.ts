// The offset tool (docs/plans/sketch-edit.md): click a curve — the chain it is
// in comes with it (`chainThrough`: on through every corner where one other
// curve joins) — and the copy is drawn where it would go, in the tools' green,
// on the side the cursor is: move across the chain to change sides. The
// distance is the options panel's, typed; or **drag** it — press off the chain
// and pull, and the copy follows the cursor; let go and the distance becomes
// the option's, typed as the panel's field types it (`arm("offset", {
// distance: 7.5 })`), so the panel shows it and it is remembered. ✓, Enter, or a
// click on the chain again offsets it — one typed line, `offset(["l1", "l2",
// "l3", "l4"], 5)`, one undo step. The construction option makes the copy
// construction geometry.
//
// The preview is the call's own seed (`planOffset`): the vertices and radii
// the operation lays down before it solves, worked out in closed form — so it
// is drawn per move without a copy of the model, and cannot promise a copy the
// call will not make.

import { press, type FeatureStep, type Hand, type PointerInfo, type RenderContext, type How } from "./tool.ts";
import type { OptionSpecs } from "./options.ts";
import { FeatureTool, callText } from "./feature.ts";
import { REGION_GREEN } from "./region.ts";
import { curveUnder, pieceSamples, strokeWorld } from "./editdraw.ts";
import { chainThrough, offset, planOffset, type OffsetPlan } from "../sketchedit.ts";
import { distanceToCurve } from "../sketchgeom.ts";
import type { Model } from "../model.ts";
import { arcFrame, arcSamples, circleFrame } from "../arcgeom.ts";
import { arcSide, curvePlaneOf } from "../curveplane.ts";

export const DEFAULT_OFFSET = 5;

/** The copy a plan lays down, as world polylines — one per member, in walking order. */
export function offsetPolylines(model: Model, plan: OffsetPlan): number[][][] {
  const { walk, closed, vertices, resolved } = plan;
  const n = walk.length;
  const at = (i: number) => vertices[closed ? i % n : i];
  return walk.map((w, i) => {
    const e = model.entities.get(w.name)!;
    const [a, b] = [at(i), at(i + 1)];
    if (e.kind === "line") return [a, b];
    if (e.kind === "circle") {
      const { u, v } = curvePlaneOf(model, w.name);
      return arcSamples(circleFrame(model.coords(e.center), resolved.radii[i]!, u, v), 64);
    }
    if (e.kind !== "arc") return [];
    const [s, t] = w.reversed ? [b, a] : [a, b];
    const f = arcFrame(model.coords(e.center), s, t, resolved.radii[i]!, arcSide(model, w.name));
    return f ? arcSamples(f, 32) : [s, t];
  });
}

export class OffsetTool extends FeatureTool {
  static readonly options: OptionSpecs = {
    distance: { default: DEFAULT_OFFSET, unit: "length", check: (v) => ((v as number) > 0 ? null : "must be more than 0") },
    construction: { default: false },
  };
  static readonly summary = "Offsets a curve or chain: click it, choose a side, ✓ — or drag it";
  static readonly how: How = [
    "{Tap} a curve: its whole chain comes with it.",
    "Press beside the chain and drag the copy out.",
    "✓ makes it. The distance is in the options too.",
  ];
  readonly name = "offset";
  chain: string[] = [];
  /** Which side of the chain the copy goes: the sign the call's distance takes. */
  side: 1 | -1 = 1;
  /** A distance being dragged, until it is let go and typed into the option. */
  private dragging: number | null = null;
  private pressed = false;

  private distance(values: Record<string, unknown> = this.values()): number {
    if (this.dragging !== null) return this.dragging;
    const d = values.distance;
    return typeof d === "number" && d > 0 ? d : DEFAULT_OFFSET;
  }

  protected plan(values: Record<string, unknown>): FeatureStep[] | null {
    if (!this.chain.length) return null;
    const names = [...this.chain];
    const d = this.side * this.distance(values);
    const opts = values.construction === true ? { construction: true } : null;
    const args: unknown[] = [names.length === 1 ? names[0] : names, d];
    if (opts) args.push(opts);
    return [(m) => ({ text: callText("offset", args), direct: () => offset(m, names, d, opts) })];
  }

  protected picksKey(): string {
    return `${this.chain.join(",")}|${this.side}`;
  }

  protected dropPicks(): boolean {
    const had = this.chain.length > 0;
    this.chain = [];
    this.dragging = null;
    this.pressed = false;
    return had;
  }

  protected wanting(): string | null {
    return null;
  }

  protected get verb(): string {
    return "offset";
  }

  protected picking(hand: Hand): string {
    return `${press(hand)} a curve to offset`;
  }

  /** The plan for a signed distance, or null where the call would refuse it. */
  private planFor(d: number): OffsetPlan | null {
    try {
      return planOffset(this.ctx.model, this.chain, d);
    } catch {
      return null;
    }
  }

  /** The side whose copy runs nearer the cursor. */
  private sideAt(world: number[]): 1 | -1 {
    const d = this.distance();
    const near = (plan: OffsetPlan | null) => {
      if (!plan) return Infinity;
      let best = Infinity;
      for (const poly of offsetPolylines(this.ctx.model, plan)) {
        for (let k = 0; k + 1 < poly.length; k++) {
          const [a, b] = [poly[k], poly[k + 1]];
          const ab = b.map((v, i) => v - a[i]), aw = world.map((v, i) => v - (a[i] ?? 0));
          const t = Math.max(0, Math.min(1, ab.reduce((s, v, i) => s + v * (aw[i] ?? 0), 0) / Math.max(1e-300, ab.reduce((s, v) => s + v * v, 0))));
          best = Math.min(best, Math.hypot(...world.map((v, i) => v - (a[i] + t * ab[i]))));
        }
      }
      return best;
    };
    return near(this.planFor(d)) <= near(this.planFor(-d)) ? 1 : -1;
  }

  onMove(p: PointerInfo): void {
    if (!this.chain.length) return;
    if (this.pressed) {
      // The distance is the cursor's from the chain — the nearest member.
      const d = Math.min(...this.chain.map((c) => distanceToCurve(this.ctx.model, c, p.world)));
      if (d > 1e-9) this.dragging = d;
    }
    const side = this.sideAt(p.world);
    if (side !== this.side || this.pressed) {
      this.side = side;
      this.ctx.requestRender();
    }
  }

  onDown(p: PointerInfo): void {
    const curve = curveUnder(this.ctx, p);
    if (curve && this.chain.includes(curve)) {
      this.confirm();
      return;
    }
    if (curve) {
      this.chain = chainThrough(this.ctx.model, curve);
      this.dragging = null;
      this.side = this.sideAt(p.world);
      this.ctx.requestRender();
      return;
    }
    if (!this.chain.length) {
      this.guide("click a line, arc or circle — the chain it is in is offset");
      return;
    }
    this.pressed = true;
  }

  onUp(): void {
    if (!this.pressed) return;
    this.pressed = false;
    const v = this.dragging;
    if (v === null) return;
    // Let go: the distance becomes the option's, typed as the panel types it.
    const value = Math.round(v * 100) / 100;
    const line = callText("arm", [this.name, { distance: value }]);
    const done = () => { this.dragging = null; this.ctx.requestRender(); };
    if (this.ctx.run) void Promise.resolve(this.ctx.run(line)).then(done, done);
    else {
      this.ctx.options = { ...this.ctx.options, distance: value };
      done();
    }
  }

  render(r: RenderContext): void {
    const model = this.ctx.model;
    if (!this.chain.every((c) => model.entities.has(c))) return;
    for (const c of this.chain) strokeWorld(r, pieceSamples(model, c, 0, 1), REGION_GREEN, 3);
    const plan = this.planFor(this.side * this.distance());
    if (!plan) return;
    for (const poly of offsetPolylines(model, plan)) strokeWorld(r, poly.map((x) => x.slice(0, model.dim)), REGION_GREEN, 1.8, [6, 4]);
  }
}
