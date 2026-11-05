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
//
// **In 3D the box is laid out in the working plane**, along that plane's own
// two axes — the default frame's +x and +y when there is one, the screen's
// right and up when there is not — which in a view that has never been turned
// are x and y, exactly the 2D layout. Its two derived corners are held on the
// sketch plane like the clicked ones (see place.ts), or a rectangle drawn on a
// plane could fold about its own diagonal. The relations need nothing new:
// `par` and `perp` were always dimension-generic.

import { Tool, defineTool, type Hand, type PointerInfo, type RenderContext } from "./tool.ts";
import { parallel, perpendicular } from "../relations/geometry.ts";
import { DRAWING_OPTIONS, asArmed, holdOnSketchPlane, placePoint, requirePlanar } from "./place.ts";
import type { OptionSpecs } from "./options.ts";
import type { Plane } from "../view.ts";

/**
 * The two corners a drag from `a` to `c` implies: `c`'s offset from `a`, split
 * along the plane's two axes, each half laid off from `a`. With no plane (a 2D
 * model) the axes are x and y and this is `[x1, y0]` and `[x0, y1]`.
 */
function otherCorners(a: number[], c: number[], plane?: Plane): [number[], number[]] {
  if (!plane) return [[c[0], a[1]], [a[0], c[1]]];
  const d = a.map((ai, i) => c[i] - ai);
  const along = (u: number[]) => d.reduce((s, di, i) => s + di * u[i], 0);
  const du = along(plane.u), dv = along(plane.v);
  return [a.map((ai, i) => ai + du * plane.u[i]), a.map((ai, i) => ai + dv * plane.v[i])];
}

export class RectangleTool extends Tool {
  static readonly options: OptionSpecs = DRAWING_OPTIONS;
  static readonly summary = "Draws a rectangle: drag from corner to corner";
  readonly name = "rectangle";
  /**
   * The whole of the first press, not only its coordinate: the corner is not
   * created until onUp, and by then the snap that press landed on is the only
   * record of what the gesture was started *on*. Dropping it here is what used
   * to leave a rectangle drawn from another's corner merely adjacent to it.
   */
  private from: PointerInfo | null = null;
  private current: number[] | null = null;

  /** One stage: a press at a corner, held and dragged to the opposite one (a click alone builds nothing). */
  next(_hand: Hand): string {
    return this.from ? "drag to the opposite corner" : "press at a corner";
  }

  onDown(p: PointerInfo): void {
    requirePlanar(this.ctx.model, this.name);
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
    this.from = null;
    this.current = null;

    if (Math.hypot(...p.world.map((v, i) => v - from.world[i])) < 1e-6) {
      this.ctx.requestRender();
      return; // a click with no real drag — nothing to build
    }

    const m = this.ctx.model;
    // The two corners the user actually pointed at carry their inference; the
    // other two are derived, and nothing was clicked there to infer from —
    // except the sketch plane they were laid out on.
    const [bAt, dAt] = otherCorners(from.world, p.world, from.plane);
    const a = placePoint(this.ctx, from);
    const b = m.addPoint(bAt).name;
    holdOnSketchPlane(m, b);
    const c = placePoint(this.ctx, p);
    const d = m.addPoint(dAt).name;
    holdOnSketchPlane(m, d);
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
    asArmed(this.ctx, ab.name, bc.name, cd.name, da.name);

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
    const [b, d] = otherCorners(this.from.world, this.current, this.from.plane);
    const corners: [number, number][] = [this.from.world, b, this.current, d].map((w) => r.worldToScreen(w));
    r.g.save();
    r.g.strokeStyle = "#e8a33d";
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
