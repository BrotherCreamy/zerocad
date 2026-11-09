// The example the Tool interface was designed around: drag out a rectangle.
// onDown remembers the first corner (not committed to the model yet —
// that's the whole point of a live preview); onMove just asks for a
// redraw, and render() draws the dashed preview from whatever the tool's
// own state says "so far"; onUp is the only place anything is actually
// created — four points, four lines, and the relations that make the shape a
// rectangle, then a solve. Nothing here is special-cased by the engine; it's
// exactly the same Tool subclass + defineTool call any other tool uses.
//
// **The relations are intrinsic — a `perp` at every corner — rather than the
// `hor`/`ver` this used to apply.**
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
// `perp` was always dimension-generic.
//
// **Four perps, one at each corner, and the corners coplanar when no plane
// holds them** (docs/plans/profiles-held.md, the owner: *"i was thinking 4
// perps so that all the edges are identical to one another"*). Until then it
// was `par`, `par`, `perp` — the fewest that make a rectangle, and so one
// corner and two edges held differently from the rest. Four perps say the
// same thing of every edge; the fourth is then implied by the other three, and
// the diagnosis says so, muted, in ordinary ink (an agreeing relation is no
// fault). In 3D four right angles do force a quadrilateral flat — a skew one's
// angles sum to less than 2π — but only to second order: measured, a corner
// dragged 7 out of the plane came back 2.9e-4 off it, the solve stopping on a
// gradient that vanishes as the fold does. So with no plane picked the four
// corners are also held `coplanar`, which is first order: 9e-13 off, the same
// drag. With a plane picked every corner is on it already, and that is the
// flatness.

import { Tool, defineTool, type Hand, type PointerInfo, type RenderContext } from "./tool.ts";
import { perpendicular } from "../relations/geometry.ts";
import { coplanar } from "../relations/basic.ts";
import { CurvePlane, DRAWING_OPTIONS, asArmed, holdOnSketchPlane, placePoint, requirePlanar } from "./place.ts";
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
  /**
   * The plane the box is drawn on, decided at the press: a chosen sketch
   * plane, else the solid's face the press landed on, else the ground
   * (place.ts, docs/plans/click-on-face.md). The release is read on it, so a
   * drag that runs off the face's edge still lays the box out on the face,
   * and all four corners are held there.
   */
  private plane = new CurvePlane(this.ctx, this.name);

  /** One stage: a press at a corner, held and dragged to the opposite one (a click alone builds nothing). */
  next(_hand: Hand): string {
    return this.from ? "drag to the opposite corner" : "press at a corner";
  }

  onDown(p: PointerInfo): void {
    requirePlanar(this.ctx.model, this.name);
    this.plane.begin(p);
    this.from = this.plane.settle(p);
    this.current = this.from.world;
    this.ctx.requestRender();
  }

  onMove(p: PointerInfo): void {
    if (!this.from) return;
    this.current = this.plane.settle(p).world;
    this.ctx.requestRender();
  }

  onUp(p: PointerInfo): void {
    if (!this.from) return;
    const from = this.from;
    this.from = null;
    this.current = null;
    p = this.plane.settle(p);

    if (Math.hypot(...p.world.map((v, i) => v - from.world[i])) < 1e-6) {
      this.ctx.requestRender();
      return; // a click with no real drag — nothing to build
    }

    const m = this.ctx.model;
    const on = this.plane.plane;
    // The two corners the user actually pointed at carry their inference; the
    // other two are derived, and nothing was clicked there to infer from —
    // except the plane they were laid out on: the sketch plane, or the face.
    const [bAt, dAt] = otherCorners(from.world, p.world, from.plane);
    const a = placePoint(this.ctx, from, undefined, on);
    const b = m.addPoint(bAt).name;
    const bHeld = holdOnSketchPlane(m, b, on);
    const c = placePoint(this.ctx, p, undefined, on);
    const d = m.addPoint(dAt).name;
    const dHeld = holdOnSketchPlane(m, d, on);
    const ab = m.addLine(a, b);
    const bc = m.addLine(b, c);
    const cd = m.addLine(c, d);
    const da = m.addLine(d, a);
    // Constrain the *edges*, not the corner points. What is meant is "these
    // two sides are parallel", and saying it that way means the box stays a
    // box when an operation later re-points an edge — filleting a corner, for
    // one.
    //
    // A right angle at every corner, so every edge is held as every other is
    // (see the header: the fourth is implied, and said so, muted).
    perpendicular(m, ab.name, bc.name);
    perpendicular(m, bc.name, cd.name);
    perpendicular(m, cd.name, da.name);
    perpendicular(m, da.name, ab.name);
    // Flat to first order where no plane is: four right angles only fold it
    // back to second (the header's measurement).
    // A box dragged flat along one axis has corners in one line and no plane
    // to be flat in: coplanar refuses it, and the box is built as it always
    // was, rather than half-built by the refusal.
    if (m.dim === 3 && (bHeld === null || dHeld === null)) {
      try { coplanar(m, d, a, b, c); } catch { /* no plane to hold it in: see above */ }
    }
    asArmed(this.ctx, ab.name, bc.name, cd.name, da.name);

    this.ctx.requestSolve();
    this.ctx.finish();
  }

  onCancel(): void {
    this.from = null;
    this.current = null;
    this.plane.cancel();
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

