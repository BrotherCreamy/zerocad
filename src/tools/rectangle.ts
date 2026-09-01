// The example the Tool interface was designed around: drag out a rectangle.
// onDown remembers the first corner (not committed to the model yet —
// that's the whole point of a live preview); onMove just asks for a
// redraw, and render() draws the dashed preview from whatever the tool's
// own state says "so far"; onUp is the only place anything is actually
// created — four points, four lines, and the relations that make the shape a
// rectangle, then a solve. Nothing here is special-cased by the engine; it's
// exactly the same Tool subclass + defineTool call any other tool uses.
//
// **The relations are intrinsic — `par` on each pair of opposite edges and
// one `perp` at a corner — rather than the `hor`/`ver` this used to apply.**
// It had to become so with the arrival of coordinate frames: `hor` means
// "level with *a frame*" now, there is no world frame to fall back on, and a
// tool that could not draw a rectangle until you had made a frame would be a
// tool that mostly does not work. Saying it intrinsically is also the truer
// statement — a rectangle is a rectangle in any frame — and it leaves the
// shape one degree of freedom it used to lack: its angle, which a user who
// wants the box level pins with one `hor`.

import { Tool, defineTool, type PointerInfo, type RenderContext } from "./tool.ts";
import { parallel, perpendicular } from "../relations/geometry.ts";
import { placePoint } from "./place.ts";

export class RectangleTool extends Tool {
  readonly name = "rectangle";
  /**
   * The whole of the first press, not only its coordinate: the corner is not
   * created until onUp, and by then the snap that press landed on is the only
   * record of what the gesture was started *on*. Dropping it here is what used
   * to leave a rectangle drawn from another's corner merely adjacent to it.
   */
  private from: PointerInfo | null = null;
  private current: number[] | null = null;

  onDown(p: PointerInfo): void {
    if (this.ctx.model.dim !== 2) throw new Error("rectangle is a 2D tool");
    this.from = p;
    this.current = p.world;
    this.ctx.requestRender();
  }

  onMove(p: PointerInfo): void {
    if (!this.from) return;
    this.current = p.world;
    this.ctx.requestRender();
  }

  onUp(p: PointerInfo): void {
    if (!this.from) return;
    const from = this.from;
    const [x0, y0] = from.world;
    const [x1, y1] = p.world;
    this.from = null;
    this.current = null;

    if (Math.hypot(x1 - x0, y1 - y0) < 1e-6) {
      this.ctx.requestRender();
      return; // a click with no real drag — nothing to build
    }

    const m = this.ctx.model;
    // The two corners the user actually pointed at carry their inference; the
    // other two are derived, and nothing was clicked there to infer from.
    const a = placePoint(this.ctx, from);
    const b = m.addPoint([x1, y0]).name;
    const c = placePoint(this.ctx, p);
    const d = m.addPoint([x0, y1]).name;
    const ab = m.addLine(a, b);
    const bc = m.addLine(b, c);
    const cd = m.addLine(c, d);
    const da = m.addLine(d, a);
    // Constrain the *edges*, not the corner points. What is meant is "these
    // two sides are parallel", and saying it that way means the box stays a
    // box when an operation later re-points an edge — filleting a corner, for
    // one.
    //
    // Three relations, not four: two pairs of parallel sides make a
    // parallelogram (the closure of the four directions forces the opposite
    // sides equal as well as parallel), and one right angle makes that
    // parallelogram a rectangle. The fourth would be redundant.
    parallel(m, ab.name, cd.name);
    parallel(m, bc.name, da.name);
    perpendicular(m, ab.name, bc.name);

    this.ctx.requestSolve();
    this.ctx.finish();
  }

  onCancel(): void {
    this.from = null;
    this.current = null;
    this.ctx.requestRender();
  }

  render(r: RenderContext): void {
    if (!this.from || !this.current) return;
    const [x0, y0] = this.from.world;
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
