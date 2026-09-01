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
import { placePoint } from "./place.ts";

export class CircleTool extends Tool {
  readonly name = "circle";
  /** The whole press, so the centre's snap survives to commit — see place.ts. */
  private from: PointerInfo | null = null;
  private rim: number[] | null = null;

  onDown(p: PointerInfo): void {
    if (this.ctx.model.dim !== 2) throw new Error("circle is a 2D tool");
    this.from = p;
    this.rim = p.world;
    this.ctx.requestRender();
  }

  onMove(p: PointerInfo): void {
    if (!this.from) return;
    this.rim = p.world;
    this.ctx.requestRender();
  }

  onUp(p: PointerInfo): void {
    if (!this.from) return;
    const from = this.from;
    const c = from.world;
    this.from = null;
    this.rim = null;

    const r = Math.hypot(p.world[0] - c[0], p.world[1] - c[1]);
    if (r < 1e-6) {
      this.ctx.requestRender();
      return; // a click with no drag — no radius to speak of
    }

    const m = this.ctx.model;
    // Only the centre is a point the user placed; the rim is a radius, not an
    // entity, so there is nothing there to infer a constraint about.
    const ctr = placePoint(this.ctx, from);
    m.addCircle(ctr, r);

    this.ctx.requestSolve();
    this.ctx.finish();
  }

  onCancel(): void {
    this.from = null;
    this.rim = null;
    this.ctx.requestRender();
  }

  render(r: RenderContext): void {
    if (!this.from || !this.rim) return;
    const [cx, cy] = r.worldToScreen(this.from.world);
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
