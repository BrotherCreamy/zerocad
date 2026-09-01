// Drag from the center out to the rim. Same shape as rectangle.ts: onDown
// remembers where the gesture started without touching the model, onMove
// only asks for a redraw, render() draws the preview from the tool's own
// state, and onUp is the only place anything is committed.
//
// The radius is deliberately left *unconstrained* on commit, matching the
// rectangle tool's choice not to dimension the box it draws: the circle
// keeps the size it was drawn at (nothing pulls on that variable, so the
// solver leaves it alone) but is still free to be driven later by a `rad`
// or a tangency. Pinning it here would make every drawn circle rigid.

import { Tool, defineTool, type PointerInfo, type RenderContext } from "./tool.ts";

export class CircleTool extends Tool {
  readonly name = "circle";
  private center: number[] | null = null;
  private rim: number[] | null = null;

  onDown(p: PointerInfo): void {
    if (this.ctx.model.dim !== 2) throw new Error("circle is a 2D tool");
    this.center = p.world;
    this.rim = p.world;
    this.ctx.requestRender();
  }

  onMove(p: PointerInfo): void {
    if (!this.center) return;
    this.rim = p.world;
    this.ctx.requestRender();
  }

  onUp(p: PointerInfo): void {
    if (!this.center) return;
    const c = this.center;
    this.center = null;
    this.rim = null;

    const r = Math.hypot(p.world[0] - c[0], p.world[1] - c[1]);
    if (r < 1e-6) {
      this.ctx.requestRender();
      return; // a click with no drag — no radius to speak of
    }

    const m = this.ctx.model;
    const ctr = m.addPoint(c);
    m.addCircle(ctr.name, r);

    this.ctx.requestSolve();
    this.ctx.finish();
  }

  onCancel(): void {
    this.center = null;
    this.rim = null;
    this.ctx.requestRender();
  }

  render(r: RenderContext): void {
    if (!this.center || !this.rim) return;
    const [cx, cy] = r.worldToScreen(this.center);
    const [rx, ry] = r.worldToScreen(this.rim);
    r.g.save();
    r.g.strokeStyle = "#e8a33d";
    r.g.setLineDash([4, 3]);
    r.g.lineWidth = 1.3;
    r.g.beginPath();
    r.g.arc(cx, cy, Math.hypot(rx - cx, ry - cy), 0, Math.PI * 2);
    r.g.stroke();
    r.g.beginPath();
    r.g.moveTo(cx, cy);
    r.g.lineTo(rx, ry); // the radius being dragged, so the gesture reads
    r.g.stroke();
    r.g.restore();
  }
}

defineTool("circle", CircleTool);
