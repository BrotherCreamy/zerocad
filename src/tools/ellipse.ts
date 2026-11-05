// The ellipse tool (docs/plans/sketch-shapes.md): drawn as the circle is —
// press at the centre and drag out to the end of the major axis (or click
// both) — then a second stage for the minor: move the pointer off the major
// axis and click, or on a finger tap, where the minor axis should end. The
// distance from the major axis is the minor semi-axis.
//
// It leaves one ellipse (`EllipseEntity`): its centre and major end are the
// points the hand gave, placed with their inference (place.ts) — a centre
// pressed on a point is `coin` with it, a major end let go along a line `on`
// it — and the minor is its variable, seeded where the click was and held by
// nothing: tools do not dimension what they draw, so `minor(e, 10)` is the
// user's to add. In 3D it lies on the plane the press stands on, as a circle
// does (`CurvePlane`): its centre and major end `onplane` and its normal `par`
// to the plane's — the same three kinds of visible, deletable relation a
// circle drawn there carries. The whole gesture is one undo step.

import { Tool, defineTool, type PointerInfo, type RenderContext } from "./tool.ts";
import { DRAWING_OPTIONS, asArmed, holdOnSketchPlane, placePoint } from "./place.ts";
import type { OptionSpecs } from "./options.ts";
import { TwoPoint, halfWidth, unsnapped } from "./twopoint.ts";
import { arcSamples, arcSegments, ellipseFrame } from "../arcgeom.ts";
import { cross3, lift3, unit3 } from "../vec3.ts";

/** The ellipse a centre, a major end and a minor semi-axis make, laid out on a plane (+z in 2D), for drawing. */
export function ellipsePreview(c: number[], m: number[], b: number, normal: number[] | null, scale: number): number[][] {
  const [C, M] = [lift3(c), lift3(m)];
  const d = M.map((x, i) => x - C[i]);
  const a = Math.hypot(...d);
  const u = unit3(d);
  const v = u ? unit3(cross3(normal ?? [0, 0, 1], u)) : null;
  if (!u || !v || !(a > 0)) return [];
  const f = ellipseFrame(C, a, Math.max(b, 0), u, v);
  return arcSamples(f, arcSegments(f.sweep, Math.max(a, b) * scale));
}

export class EllipseTool extends Tool {
  static readonly options: OptionSpecs = DRAWING_OPTIONS;
  static readonly summary = "Draws an ellipse: drag out its major axis, then click its minor";
  readonly name = "ellipse";
  private stage = new TwoPoint(this.ctx, this.name);
  /** The centre and the major end, once the first stage is done; the second chooses the minor. */
  private axis: { from: PointerInfo; to: PointerInfo } | null = null;
  private press: PointerInfo | null = null;
  private hover: PointerInfo | null = null;

  onDown(p: PointerInfo): void {
    if (!this.axis) { this.stage.down(p); return; }
    this.press = p;
    this.hover = p;
    this.ctx.requestRender();
  }

  onMove(p: PointerInfo): void {
    if (!this.axis) { this.stage.move(p); return; }
    this.hover = p;
    this.ctx.requestRender();
  }

  onUp(p: PointerInfo): void {
    if (!this.axis) {
      this.axis = this.stage.up(p);
      this.hover = this.axis?.to ?? null;
      this.ctx.requestRender();
      return;
    }
    if (!this.press) return;
    this.press = null;
    const b = this.minorAt(p);
    if (!(b > 1e-6)) {
      this.ctx.requestRender();
      return; // on the major axis: no minor yet, try again
    }
    const { from, to } = this.axis;
    const plane = this.stage.plane;
    const ref = plane.plane;
    this.axis = null;
    this.hover = null;
    this.stage.reset();
    const m = this.ctx.model;
    const centre = placePoint(this.ctx, from, undefined, ref);
    const major = placePoint(this.ctx, to, undefined, ref);
    const e = m.addEllipse(centre, major, b, plane.normal()).name;
    // The centre `onplane` (unless placing it already held it) and the normal
    // `par`, as a circle's are; the major end was held as it was placed, when
    // nothing it snapped to pinned it — or is held here, if a snap left it free.
    plane.hold(e, centre);
    if (ref && !m.relationsNaming(major).some((r) => r.op === "onPlane")) holdOnSketchPlane(m, major, ref);
    asArmed(this.ctx, e);
    this.ctx.requestSolve();
    this.ctx.finish();
  }

  /** The minor semi-axis a pointer at `p` means: its distance from the major axis, on the plane. */
  private minorAt(p: PointerInfo): number {
    if (!this.axis) return 0;
    const at = unsnapped(this.stage.plane, this.stage.plane.settle(p));
    return halfWidth(this.axis.from.world, this.axis.to.world, at);
  }

  onCancel(): void {
    this.axis = null;
    this.press = null;
    this.hover = null;
    this.stage.cancel();
    this.ctx.requestRender();
  }

  render(r: RenderContext): void {
    const c = this.axis?.from ?? this.stage.first;
    const m = this.axis?.to ?? this.stage.hover;
    if (!c) return;
    r.g.save();
    r.g.strokeStyle = "#e8a33d";
    r.g.lineWidth = 1.3;
    const [x, y] = r.worldToScreen(c.world);
    r.g.beginPath();
    r.g.moveTo(x - 4, y); r.g.lineTo(x + 4, y);
    r.g.moveTo(x, y - 4); r.g.lineTo(x, y + 4);
    r.g.stroke();
    if (m) {
      r.g.beginPath();
      r.g.moveTo(...r.worldToScreen(c.world));
      r.g.lineTo(...r.worldToScreen(m.world));
      r.g.stroke(); // the major semi-axis being dragged, so the gesture reads
      // While the major is dragged the minor previews at half of it — the
      // seed an ellipse typed bare gets — and then follows the pointer.
      const a = Math.hypot(...lift3(m.world).map((v, i) => v - lift3(c.world)[i]));
      const b = this.axis ? (this.hover ? this.minorAt(this.hover) : 0) : a / 2;
      const pts = ellipsePreview(c.world, m.world, b, this.stage.plane.normal(), r.scale).map((w) => r.worldToScreen(w));
      if (pts.length) {
        r.g.beginPath();
        r.g.moveTo(...pts[0]);
        for (const q of pts.slice(1)) r.g.lineTo(...q);
        r.g.stroke();
      }
    }
    r.g.restore();
  }
}

defineTool("ellipse", EllipseTool);
