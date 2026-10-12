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
//
// In 3D the radius is the full distance from centre to rim, and the preview is
// drawn the way the committed circle will be: its silhouette, `r * scale`
// about the projected centre. Until circles carry a plane (3D phase 2) a
// circle is a sphere to every relation that reads it, so on a plane seen at an
// angle the outline is wider than the plane's own circle through the cursor —
// the honest picture of what is being built, rather than a promise of a
// planar circle the model does not have yet.

import { Tool, defineTool, type PointerInfo, type RenderContext } from "./tool.ts";
import { placePoint, requirePlanar } from "./place.ts";

export class CircleTool extends Tool {
  readonly name = "circle";
  /** The whole press, so the centre's snap survives to commit — see place.ts. */
  private from: PointerInfo | null = null;
  private rim: number[] | null = null;

  onDown(p: PointerInfo): void {
    requirePlanar(this.ctx.model, this.name);
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

    const r = Math.hypot(...p.world.map((v, i) => v - c[i]));
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
    const c = this.from.world;
    const [cx, cy] = r.worldToScreen(c);
    const [rx, ry] = r.worldToScreen(this.rim);
    const radius = Math.hypot(...this.rim.map((v, i) => v - c[i])) * r.scale;
    r.g.save();
    r.g.strokeStyle = "#e8a33d";
    r.g.setLineDash([4, 3]);
    r.g.lineWidth = 1.3;
    r.g.beginPath();
    r.g.arc(cx, cy, radius, 0, Math.PI * 2);
    r.g.stroke();
    r.g.beginPath();
    r.g.moveTo(cx, cy);
    r.g.lineTo(rx, ry); // the radius being dragged, so the gesture reads
    r.g.stroke();
    r.g.restore();
  }
}

defineTool("circle", CircleTool);
