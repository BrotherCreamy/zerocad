// The extend tool (docs/plans/sketch-edit.md): hover a line or an arc near the
// end to lengthen, and see where it would reach — the extension drawn in the
// tools' green, dashed, to a ring on the curve it meets; click, and it types
// `extend("l1", "p2")`, one undo step. An end it cannot take (a corner, or
// nothing that way) is said muted at the click, and drawn red at the hover.
// Like trim, one click and no ✓.

import { Tool, press, type Hand, type PointerInfo, type RenderContext, type How } from "./tool.ts";
import { callText } from "./feature.ts";
import { REGION_GREEN } from "./region.ts";
import { SUBTRACT_RED } from "./regiontool.ts";
import { curveUnder, ringAt, strokeWorld } from "./editdraw.ts";
import { extend, extendReach } from "../sketchedit.ts";
import { curveFrame } from "../curveplane.ts";
import { arcPoint, eccentricAnomaly } from "../arcgeom.ts";
import { curveEnds } from "../sketchgeom.ts";
import type { Entity } from "../model.ts";

/** What extend takes: a line, an arc, an elliptical arc (docs/plans/trim-everything.md). */
const extendable = (e: Entity | undefined) => !!e && (e.kind === "line" || e.kind === "arc" || e.kind === "earc");

interface Hover {
  curve: string;
  /** The end nearer the cursor. */
  point: string;
  reach: { by: string; at: number[] } | null;
  why: string | null;
}

export class ExtendTool extends Tool {
  static readonly summary = "Extends a line or arc to the next curve: click near the end";
  static readonly how: How = [
    "{Tap} a line or an arc near the end to lengthen.",
    "It grows to the next curve in its way.",
  ];
  readonly name = "extend";
  readonly snaps = false;
  private hover: Hover | null = null;

  next(hand: Hand): string {
    return `${press(hand)} a line or arc near the end to extend`;
  }

  private look(p: PointerInfo): Hover | null {
    const model = this.ctx.model;
    const curve = curveUnder(this.ctx, p, extendable);
    const e = curve ? model.entities.get(curve) : undefined;
    if (!e || !extendable(e)) return null;
    const ends = curveEnds(e);
    const d = ends.map((q) => Math.hypot(...model.coords(q).map((v, i) => v - p.world[i])));
    const point = d[0] <= d[1] ? ends[0] : ends[1];
    try {
      const r = extendReach(model, e.name, point);
      return { curve: e.name, point, reach: { by: r.by, at: r.at }, why: null };
    } catch (err) {
      return { curve: e.name, point, reach: null, why: err instanceof Error ? err.message : String(err) };
    }
  }

  onMove(p: PointerInfo): void {
    const was = this.hover;
    this.hover = this.look(p);
    const key = (h: Hover | null) => (h ? `${h.curve}:${h.point}:${h.reach?.by ?? h.why}` : "");
    if (key(was) !== key(this.hover)) this.ctx.requestRender();
  }

  onDown(p: PointerInfo): void {
    const h = this.look(p);
    this.hover = h;
    if (!h) {
      this.guide("click a line or an arc, near the end to lengthen");
      return;
    }
    if (!h.reach) {
      this.guide(h.why ?? `${h.curve} cannot be extended there`);
      return;
    }
    if (this.ctx.run) {
      const done = this.ctx.run(callText("extend", [h.curve, h.point]));
      const after = () => { this.hover = null; this.ctx.requestRender(); };
      if (done instanceof Promise) void done.then(after);
      else after();
      return;
    }
    extend(this.ctx.model, h.curve, h.point);
    this.hover = null;
    this.ctx.requestSolve();
  }

  onCancel(): void {
    this.hover = null;
    this.ctx.requestRender();
  }

  private guide(text: string): void {
    this.ctx.requestRender();
    if (!this.ctx.log) throw new Error(text);
    this.ctx.log(`extend: ${text}`, "guide");
  }

  /** The extension, dashed green to a ring where it lands; an end it cannot take, ringed red. */
  render(r: RenderContext): void {
    const h = this.hover;
    const model = this.ctx.model;
    if (!h || !model.entities.has(h.curve) || !model.entities.has(h.point)) return;
    const from = model.coords(h.point);
    if (!h.reach) {
      ringAt(r, from, SUBTRACT_RED);
      return;
    }
    const e = model.entities.get(h.curve)!;
    let pts: number[][] = [from, h.reach.at];
    if (e.kind === "arc" || e.kind === "earc") {
      const f = curveFrame(model, e)!;
      // From the arc's own start, as `arcPoint` reads it (an elliptical arc's eccentric anomaly past its `t0`).
      const angle = (x: number[]) => {
        const t = eccentricAnomaly(f, x) - (f.t0 ?? 0);
        return ((t % (2 * Math.PI)) + 2 * Math.PI) % (2 * Math.PI);
      };
      const atEnd = h.point === curveEnds(e)[1];
      const t0 = atEnd ? f.sweep : 0;
      let t1 = angle(h.reach.at);
      if (atEnd && t1 < t0) t1 += 2 * Math.PI;
      if (!atEnd) t1 -= 2 * Math.PI;
      pts = Array.from({ length: 33 }, (_, k) => arcPoint(f, t0 + ((t1 - t0) * k) / 32).slice(0, model.dim));
    }
    strokeWorld(r, pts, REGION_GREEN, 2.5, [6, 4]);
    ringAt(r, h.reach.at, REGION_GREEN);
  }
}
