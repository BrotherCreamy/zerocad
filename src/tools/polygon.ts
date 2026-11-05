// The polygon tool (docs/plans/sketch-shapes.md): a regular polygon by its
// centre and one corner, as Onshape's — press at the centre and drag to a
// corner, or click the centre and then the corner. `n` sides (an option, 6 by
// default) and a construction circle through the corners, or inside them as
// well (`circumscribed: false`).
//
// What it leaves is the composite `polygon` in shapes.ts builds — ordinary
// points, lines, circles and relations — after placing the two points the hand
// gave, with their inference (place.ts): a centre pressed on a point is `coin`
// with it, a corner let go along a line is `on` it. The corner the hand gave is
// the polygon's first; the rest are laid out counter-clockwise about the
// plane's normal from it. In 3D the polygon lies on the plane the press stands
// on — the sketch plane, a solid's face, the ground — as a circle does
// (`CurvePlane`). The whole gesture is one undo step.

import { Tool, defineTool, type PointerInfo, type RenderContext } from "./tool.ts";
import { DRAWING_OPTIONS, asArmed, placePoint } from "./place.ts";
import type { OptionSpecs } from "./options.ts";
import { TwoPoint } from "./twopoint.ts";
import { POLYGON_MAX_SIDES, POLYGON_MIN_SIDES, polygon } from "./shapes.ts";
import { arcSamples, arcSegments, circleFrame } from "../arcgeom.ts";
import { cross3, lift3, unit3 } from "../vec3.ts";

/** The polygon a centre and a corner make on a plane (2D when `plane` is null): its corners, in order. */
export function polygonCorners(c: number[], v: number[], n: number, normal: number[] | null): number[][] {
  const C = lift3(c), V = lift3(v);
  const off = V.map((x, i) => x - C[i]);
  const R = Math.hypot(...off);
  if (!(R > 0)) return [];
  const u = off.map((x) => x / R);
  const w = normal ? unit3(cross3(normal, u)) : [-u[1], u[0], 0];
  if (!w) return [];
  return Array.from({ length: n }, (_, k) => {
    const t = (2 * Math.PI * k) / n;
    return C.map((x, i) => x + R * (Math.cos(t) * u[i] + Math.sin(t) * w[i]));
  });
}

export class PolygonTool extends Tool {
  static readonly options: OptionSpecs = {
    ...DRAWING_OPTIONS,
    n: {
      default: 6, label: "sides",
      check: (v) => (Number.isInteger(v) && (v as number) >= POLYGON_MIN_SIDES && (v as number) <= POLYGON_MAX_SIDES
        ? null : `is a whole number from ${POLYGON_MIN_SIDES} to ${POLYGON_MAX_SIDES}`),
    },
    circumscribed: { default: true },
  };
  static readonly summary = "Draws a regular polygon: drag from its centre to a corner";
  readonly name = "polygon";
  private stage = new TwoPoint(this.ctx, this.name);

  private get sides(): number {
    const n = this.ctx.options.n;
    return typeof n === "number" ? n : 6;
  }

  onDown(p: PointerInfo): void {
    this.stage.down(p);
  }

  onMove(p: PointerInfo): void {
    this.stage.move(p);
  }

  onUp(p: PointerInfo): void {
    const done = this.stage.up(p);
    if (!done) return;
    const plane = this.stage.plane.plane;
    this.stage.reset();
    const centre = placePoint(this.ctx, done.from, undefined, plane);
    const corner = placePoint(this.ctx, done.to, undefined, plane);
    const parts = polygon(this.ctx.model, centre, corner, this.sides, this.ctx.options.circumscribed !== false, plane);
    asArmed(this.ctx, ...parts.sides);
    this.ctx.requestSolve();
    this.ctx.finish();
  }

  onCancel(): void {
    this.stage.cancel();
    this.ctx.requestRender();
  }

  render(r: RenderContext): void {
    const { first, hover } = this.stage;
    if (!first) return;
    r.g.save();
    r.g.strokeStyle = "#e8a33d";
    r.g.lineWidth = 1.3;
    const [x, y] = r.worldToScreen(first.world);
    r.g.beginPath();
    r.g.moveTo(x - 4, y); r.g.lineTo(x + 4, y);
    r.g.moveTo(x, y - 4); r.g.lineTo(x, y + 4);
    r.g.stroke();
    if (hover) {
      const normal = this.stage.plane.normal();
      const corners = polygonCorners(first.world, hover.world, this.sides, normal);
      if (corners.length) {
        const px = corners.map((w) => r.worldToScreen(w));
        r.g.beginPath();
        r.g.moveTo(...px[0]);
        for (const q of px.slice(1)) r.g.lineTo(...q);
        r.g.closePath();
        r.g.stroke();
        // The construction circle, dashed as construction is previewed nowhere
        // else — thin, so the polygon reads first.
        const surface = this.stage.plane.surface;
        const R = Math.hypot(...lift3(hover.world).map((v, i) => v - lift3(first.world)[i]));
        const f = circleFrame(first.world, R, surface ? surface.u : [1, 0, 0], surface ? surface.v : [0, 1, 0]);
        r.g.lineWidth = 0.8;
        r.g.setLineDash([4, 4]);
        const ring = arcSamples(f, arcSegments(f.sweep, R * r.scale)).map((w) => r.worldToScreen(w));
        r.g.beginPath();
        r.g.moveTo(...ring[0]);
        for (const q of ring.slice(1)) r.g.lineTo(...q);
        r.g.stroke();
      }
    }
    r.g.restore();
  }
}

defineTool("polygon", PolygonTool);
