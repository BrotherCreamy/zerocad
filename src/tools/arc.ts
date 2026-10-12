// Center, then start, then end — three clicks rather than one drag, which
// makes this the first tool to span more than a single gesture. Nothing in
// the engine needed changing for that: a tool stays armed until it calls
// ctx.finish(), so a multi-stage tool is just one that holds more state and
// finishes later. The one-shot lifecycle was always "finish when you say
// so", not "finish after one press".
//
// The sweep runs counter-clockwise *as the user sees it* from start to end. In
// 2D that is counter-clockwise in world space, which is the convention main.ts
// renders with. In 3D it is counter-clockwise seen from the front of the
// working plane — the side facing the viewer (see PointerInfo.plane) — and the
// endpoints are stored in whichever order makes that the arc every arc is
// drawn as (see ../arcgeom.ts): swapping them is free, both arcs between two
// points being drawable, and only the order says which one is meant.

import { Tool, defineTool, type PointerInfo, type RenderContext } from "./tool.ts";
import { arcEndpoints } from "../relations/geometry.ts";
import { placePoint, requirePlanar } from "./place.ts";
import { arcFrame, arcSamples, arcSegments, sweepsAs } from "../arcgeom.ts";
import { cross3, lift3 } from "../vec3.ts";
import type { Plane } from "../view.ts";

/** Pulls `p` onto the sphere of radius `r` about `c`, keeping its direction. */
function ontoRim(p: number[], c: number[], r: number): number[] {
  const d = p.map((v, i) => v - c[i]);
  const len = Math.hypot(...d);
  if (len < 1e-9) return c.map((v, i) => (i === 0 ? v + r : v));
  return c.map((v, i) => v + (d[i] / len) * r);
}

/** The side a sweep is counter-clockwise *from*: the working plane's front, or +z in 2D. */
function facing(plane?: Plane): number[] {
  return plane ? cross3(lift3(plane.u), lift3(plane.v)) : [0, 0, 1];
}

/**
 * The endpoints in stored order: `[s, e]` if the arc drawn counter-clockwise
 * from `s` to `e` about `front` is the arc every arc is laid out as, else
 * `[e, s]` — the same arc, read from its other end.
 */
function stored<T>(c: number[], s: T, e: T, sw: number[], ew: number[], front: number[]): [T, T] {
  return sweepsAs(c, sw, ew, front) ? [s, e] : [e, s];
}

export class ArcTool extends Tool {
  readonly name = "arc";
  /** The three clicks, kept whole so each one's snap survives to commit. */
  private center: PointerInfo | null = null;
  private start: PointerInfo | null = null;
  private hover: number[] | null = null;

  onDown(p: PointerInfo): void {
    requirePlanar(this.ctx.model, this.name);

    if (!this.center) {
      this.center = p;
      this.hover = p.world;
      this.ctx.requestRender();
      return;
    }

    if (!this.start) {
      const at = this.center.world;
      if (Math.hypot(...p.world.map((v, i) => v - at[i])) < 1e-6) return; // no radius yet
      this.start = p;
      this.hover = p.world;
      this.ctx.requestRender();
      return;
    }

    // Third click: the end of the sweep, and the whole thing commits at once.
    const centre = this.center, first = this.start;
    const c = centre.world, s = first.world;
    const r = Math.hypot(...s.map((v, i) => v - c[i]));
    // Normally the end click is pulled onto the rim so nothing jumps on solve.
    // But if it snapped to something, that geometry is what was meant: keep
    // the snapped position and let `arcends` and the inferred constraint
    // settle the radius between them, rather than quietly overriding a click
    // the user aimed at a corner.
    const end: PointerInfo = p.snap ? p : { ...p, world: ontoRim(p.world, c, r) };
    this.center = null;
    this.start = null;
    this.hover = null;

    const m = this.ctx.model;
    const ctr = placePoint(this.ctx, centre);
    const sp = placePoint(this.ctx, first);
    const ep = placePoint(this.ctx, end);
    // Placed in click order, so the auto-names follow the clicks; *stored* in
    // the order that draws the arc the user swept.
    const [startName, endName] = stored(c, sp, ep, first.world, end.world, facing(first.plane));
    const arc = m.addArc(ctr, startName, endName, r);
    arcEndpoints(m, arc.name);

    this.ctx.requestSolve();
    this.ctx.finish();
  }

  onMove(p: PointerInfo): void {
    if (!this.center) return;
    this.hover = p.world;
    this.ctx.requestRender();
  }

  onCancel(): void {
    this.center = null;
    this.start = null;
    this.hover = null;
    this.ctx.requestRender();
  }

  render(r: RenderContext): void {
    if (!this.center || !this.hover) return;
    const c = this.center.world;
    const [cx, cy] = r.worldToScreen(c);
    const front = facing(this.center.plane);
    // Every preview curve is sampled in the world and projected, as main.ts
    // draws a committed arc — on a plane seen at an angle, an ellipse's worth.
    const stroke = (pts: number[][]) => {
      const px = pts.map((w) => r.worldToScreen(w));
      r.g.beginPath();
      r.g.moveTo(...px[0]);
      for (const q of px.slice(1)) r.g.lineTo(...q);
      r.g.stroke();
    };

    r.g.save();
    r.g.strokeStyle = "#e8a33d";
    r.g.setLineDash([4, 3]);
    r.g.lineWidth = 1.3;

    if (!this.start) {
      // Stage two: the radius is still being chosen, so show the whole circle —
      // the one in the working plane through the cursor, which is the circle
      // the arc will be cut from.
      const rad = Math.hypot(...this.hover.map((v, i) => v - c[i]));
      const plane = this.center.plane;
      const u = plane ? lift3(plane.u) : [1, 0, 0], v = plane ? lift3(plane.v) : [0, 1, 0];
      const C = lift3(c);
      const n = Math.max(16, Math.min(720, Math.ceil(rad * r.scale)));
      stroke(Array.from({ length: n + 1 }, (_, k) => {
        const t = (2 * Math.PI * k) / n;
        return [0, 1, 2].map((i) => C[i] + rad * (Math.cos(t) * u[i] + Math.sin(t) * v[i]));
      }));
      const [hx, hy] = r.worldToScreen(this.hover);
      r.g.beginPath();
      r.g.moveTo(cx, cy);
      r.g.lineTo(hx, hy);
      r.g.stroke();
    } else {
      // Stage three: radius is fixed, so show the sweep growing — the arc the
      // next click will build, its end pulled onto the rim as the commit pulls it.
      const s = this.start.world;
      const rad = Math.hypot(...s.map((v, i) => v - c[i]));
      const e = ontoRim(this.hover, c, rad);
      const [a, b] = stored(c, s, e, s, e, front);
      const f = arcFrame(c, a, b, rad);
      if (f) stroke(arcSamples(f, arcSegments(f.sweep, rad * r.scale)));
      const [sx, sy] = r.worldToScreen(s);
      r.g.beginPath();
      r.g.moveTo(cx, cy);
      r.g.lineTo(sx, sy);
      r.g.stroke();
    }
    r.g.restore();
  }
}

defineTool("arc", ArcTool);
