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
// In 3D the circle lies on the sketch: it is given the default frame's plane
// (see `CircleEntity`), and with no default frame the press makes one — the
// working plane it landed on, typed as `plane(pt(…), null, null, { look:
// false })` (see `CurvePlane` in place.ts) — and the drag carries on over it.
// The radius is the distance from centre to rim in the working plane, and the
// preview is drawn the way the committed circle will be: sampled in that plane
// and projected, an ellipse on a plane seen at an angle.

import { Tool, defineTool, type PointerInfo, type RenderContext } from "./tool.ts";
import { CurvePlane, DRAWING_OPTIONS, asArmed, placePoint, requirePlanar } from "./place.ts";
import type { OptionSpecs } from "./options.ts";
import { arcSamples, arcSegments, circleFrame } from "../arcgeom.ts";

export class CircleTool extends Tool {
  static readonly options: OptionSpecs = DRAWING_OPTIONS;
  static readonly summary = "Draws a circle: drag from the centre out to the rim";
  readonly name = "circle";
  /** The whole press, so the centre's snap survives to commit — see place.ts. */
  private from: PointerInfo | null = null;
  private rim: number[] | null = null;
  private plane = new CurvePlane(this.ctx, this.name);

  onDown(p: PointerInfo): void {
    requirePlanar(this.ctx.model, this.name);
    if (!this.plane.begin(p)) return;
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
    const pressed = this.from;
    this.from = null;
    this.rim = null;

    const r = Math.hypot(...p.world.map((v, i) => v - pressed.world[i]));
    if (r < 1e-6) {
      this.ctx.requestRender();
      return; // a click with no drag — no radius to speak of
    }

    this.plane.commit(() => {
      const m = this.ctx.model;
      // Only the centre is a point the user placed; the rim is a radius, not an
      // entity, so there is nothing there to infer a constraint about.
      const ctr = placePoint(this.ctx, this.plane.settle(pressed));
      asArmed(this.ctx, m.addCircle(ctr, r).name);

      this.ctx.requestSolve();
      this.ctx.finish();
    });
  }

  onCancel(): void {
    this.from = null;
    this.rim = null;
    this.plane.cancel();
    this.ctx.requestRender();
  }

  render(r: RenderContext): void {
    if (!this.from || !this.rim) return;
    const c = this.from.world;
    const [cx, cy] = r.worldToScreen(c);
    const [rx, ry] = r.worldToScreen(this.rim);
    const radius = Math.hypot(...this.rim.map((v, i) => v - c[i]));
    // In the plane the press landed on — the default frame's, in 3D — exactly
    // as main.ts will draw the circle the release commits.
    const plane = this.from.plane;
    const f = circleFrame(c, radius, plane ? plane.u : [1, 0, 0], plane ? plane.v : [0, 1, 0]);
    const pts = arcSamples(f, arcSegments(f.sweep, radius * r.scale)).map((w) => r.worldToScreen(w));
    r.g.save();
    r.g.strokeStyle = "#e8a33d";
    r.g.lineWidth = 1.3;
    r.g.beginPath();
    r.g.moveTo(...pts[0]);
    for (const q of pts.slice(1)) r.g.lineTo(...q);
    r.g.stroke();
    r.g.beginPath();
    r.g.moveTo(cx, cy);
    r.g.lineTo(rx, ry); // the radius being dragged, so the gesture reads
    r.g.stroke();
    r.g.restore();
  }
}

defineTool("circle", CircleTool);
