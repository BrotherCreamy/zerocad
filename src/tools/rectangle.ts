// The example the Tool interface was designed around: drag out a rectangle.
// onDown remembers the first corner (not committed to the model yet —
// that's the whole point of a live preview); onMove just asks for a
// redraw, and render() draws the dashed preview from whatever the tool's
// own state says "so far"; onUp is the only place anything is actually
// created — four points, four lines, and hor/ver relations to keep it
// axis-aligned, then a solve. Nothing here is special-cased by the engine;
// it's exactly the same Tool subclass + defineTool call any other tool uses.

import { Tool, defineTool, type PointerInfo, type RenderContext } from "./tool.ts";
import { horizontal, vertical } from "../relations/basic.ts";

export class RectangleTool extends Tool {
  readonly name = "rectangle";
  private start: number[] | null = null;
  private current: number[] | null = null;

  onDown(p: PointerInfo): void {
    if (this.ctx.model.dim !== 2) throw new Error("rectangle is a 2D tool");
    this.start = p.world;
    this.current = p.world;
    this.ctx.requestRender();
  }

  onMove(p: PointerInfo): void {
    if (!this.start) return;
    this.current = p.world;
    this.ctx.requestRender();
  }

  onUp(p: PointerInfo): void {
    if (!this.start) return;
    const [x0, y0] = this.start;
    const [x1, y1] = p.world;
    this.start = null;
    this.current = null;

    if (Math.hypot(x1 - x0, y1 - y0) < 1e-6) {
      this.ctx.requestRender();
      return; // a click with no real drag — nothing to build
    }

    const m = this.ctx.model;
    const a = m.addPoint([x0, y0]);
    const b = m.addPoint([x1, y0]);
    const c = m.addPoint([x1, y1]);
    const d = m.addPoint([x0, y1]);
    const ab = m.addLine(a.name, b.name);
    const bc = m.addLine(b.name, c.name);
    const cd = m.addLine(c.name, d.name);
    const da = m.addLine(d.name, a.name);
    // Constrain the *edges*, not the corner points. What is meant is "this
    // side is level", and saying it that way means the box stays square when
    // an operation later re-points an edge — filleting a corner, for one.
    horizontal(m, ab.name);
    horizontal(m, cd.name);
    vertical(m, bc.name);
    vertical(m, da.name);

    this.ctx.requestSolve();
    this.ctx.finish();
  }

  onCancel(): void {
    this.start = null;
    this.current = null;
    this.ctx.requestRender();
  }

  render(r: RenderContext): void {
    if (!this.start || !this.current) return;
    const [x0, y0] = this.start;
    const [x1, y1] = this.current;
    const corners: [number, number][] = [
      r.worldToScreen([x0, y0]),
      r.worldToScreen([x1, y0]),
      r.worldToScreen([x1, y1]),
      r.worldToScreen([x0, y1]),
    ];
    r.g.save();
    r.g.strokeStyle = "#e8a33d";
    r.g.setLineDash([4, 3]);
    r.g.lineWidth = 1.3;
    r.g.beginPath();
    r.g.moveTo(...corners[0]);
    for (const c of corners.slice(1)) r.g.lineTo(...c);
    r.g.closePath();
    r.g.stroke();
    r.g.restore();
  }
}

defineTool("rectangle", RectangleTool);
