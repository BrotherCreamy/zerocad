// Center, then start, then end — three clicks rather than one drag, which
// makes this the first tool to span more than a single gesture. Nothing in
// the engine needed changing for that: a tool stays armed until it calls
// ctx.finish(), so a multi-stage tool is just one that holds more state and
// finishes later. The one-shot lifecycle was always "finish when you say
// so", not "finish after one press".
//
// The sweep runs counter-clockwise in world space from start to end, which
// is the convention main.ts renders with.

import { Tool, defineTool, type PointerInfo, type RenderContext } from "./tool.ts";
import { arcEndpoints } from "../relations/geometry.ts";

/** Pulls `p` onto the circle of radius `r` about `c`, keeping its direction. */
function ontoRim(p: number[], c: number[], r: number): number[] {
  const dx = p[0] - c[0], dy = p[1] - c[1];
  const len = Math.hypot(dx, dy);
  if (len < 1e-9) return [c[0] + r, c[1]];
  return [c[0] + (dx / len) * r, c[1] + (dy / len) * r];
}

export class ArcTool extends Tool {
  readonly name = "arc";
  private center: number[] | null = null;
  private start: number[] | null = null;
  private hover: number[] | null = null;

  onDown(p: PointerInfo): void {
    if (this.ctx.model.dim !== 2) throw new Error("arc is a 2D tool");

    if (!this.center) {
      this.center = p.world;
      this.hover = p.world;
      this.ctx.requestRender();
      return;
    }

    if (!this.start) {
      if (Math.hypot(p.world[0] - this.center[0], p.world[1] - this.center[1]) < 1e-6) return; // no radius yet
      this.start = p.world;
      this.hover = p.world;
      this.ctx.requestRender();
      return;
    }

    // Third click: the end of the sweep, and the whole thing commits at once.
    const c = this.center, s = this.start;
    const r = Math.hypot(s[0] - c[0], s[1] - c[1]);
    const e = ontoRim(p.world, c, r); // snap it to the rim so nothing jumps on solve
    this.center = null;
    this.start = null;
    this.hover = null;

    const m = this.ctx.model;
    const ctr = m.addPoint(c);
    const sp = m.addPoint(s);
    const ep = m.addPoint(e);
    const arc = m.addArc(ctr.name, sp.name, ep.name, r);
    arcEndpoints(m, arc.name);

    this.ctx.requestSolve();
    this.ctx.finish();
  }

  onMove(p: PointerInfo): void {
    if (!this.center) return;
    this.hover = p.world;
    this.ctx.requestRender();
  }

  onCancel(): void {
    this.center = null;
    this.start = null;
    this.hover = null;
    this.ctx.requestRender();
  }

  render(r: RenderContext): void {
    if (!this.center || !this.hover) return;
    const c = this.center;
    const [cx, cy] = r.worldToScreen(c);
    const ang = (p: number[]) => Math.atan2(p[1] - c[1], p[0] - c[0]);

    r.g.save();
    r.g.strokeStyle = "#e8a33d";
    r.g.setLineDash([4, 3]);
    r.g.lineWidth = 1.3;

    if (!this.start) {
      // Stage two: the radius is still being chosen, so show the whole circle.
      const [hx, hy] = r.worldToScreen(this.hover);
      r.g.beginPath();
      r.g.arc(cx, cy, Math.hypot(hx - cx, hy - cy), 0, Math.PI * 2);
      r.g.stroke();
      r.g.beginPath();
      r.g.moveTo(cx, cy);
      r.g.lineTo(hx, hy);
      r.g.stroke();
    } else {
      // Stage three: radius is fixed, so show the sweep growing.
      const [sx, sy] = r.worldToScreen(this.start);
      const rad = Math.hypot(sx - cx, sy - cy);
      r.g.beginPath();
      r.g.arc(cx, cy, rad, -ang(this.start), -ang(this.hover), true);
      r.g.stroke();
      r.g.beginPath();
      r.g.moveTo(cx, cy);
      r.g.lineTo(sx, sy);
      r.g.stroke();
    }
    r.g.restore();
  }
}

defineTool("arc", ArcTool);
