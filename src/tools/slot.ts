// The slot tool (docs/plans/sketch-shapes.md): a straight slot by its two
// centres and a width. Press at one centre and drag to the other (or click
// both), then move the pointer off the centreline and click — or, on a
// finger, tap — where the slot's side should be: twice that distance is the
// width. With the `width` option set the second stage is skipped and the slot
// is that wide.
//
// What it leaves is the composite `slot` in shapes.ts builds: two lines, two
// arcs, a construction line between the centres and the relations that hold
// them a slot, after the two centres are placed with their inference
// (place.ts). The whole gesture is one undo step: nothing is built until the
// last click.
//
// An **arc slot** (two centres and a point on a curved centreline) is not
// here: its ends are arcs concentric with the centreline's, its sides two more
// arcs, and holding the four tangent to each other is the circle-to-circle
// `tan` a centreline arc's own relations would have to share — several times
// the straight slot's composition, for a shape the owner did not name. Left
// for later (TODO.md).

import { Tool, defineTool, type PointerInfo, type RenderContext } from "./tool.ts";
import { DRAWING_OPTIONS, asArmed, placePoint } from "./place.ts";
import type { OptionSpecs } from "./options.ts";
import { TwoPoint, halfWidth, unsnapped } from "./twopoint.ts";
import { slot } from "./shapes.ts";
import { arcPoint, arcSegments } from "../arcgeom.ts";
import { cross3, lift3, unit3 } from "../vec3.ts";

/** A slot's outline as world points, for a preview: left side, the arc round b, the right side, the arc round a. */
export function slotOutline(a: number[], b: number[], r: number, normal: number[] | null, scale: number): number[][] {
  const [A, B] = [lift3(a), lift3(b)];
  const u = unit3(B.map((x, i) => x - A[i]));
  if (!u || !(r > 0)) return [];
  const n = normal ?? [0, 0, 1];
  const p = unit3(cross3(n, u));
  if (!p) return [];
  const half = (c: number[], from: number[]) => {
    const f = { center: c, r, u: from, v: cross3(n, from), normal: n, sweep: Math.PI };
    const k = arcSegments(Math.PI, r * scale);
    return Array.from({ length: k + 1 }, (_, i) => arcPoint(f, (Math.PI * i) / k));
  };
  return [...half(B, p.map((x) => -x)), ...half(A, p)];
}

export class SlotTool extends Tool {
  static readonly options: OptionSpecs = {
    ...DRAWING_OPTIONS,
    width: {
      default: 0, unit: "length",
      check: (v) => ((v as number) >= 0 ? null : "is 0 (chosen by the gesture) or more"),
    },
  };
  static readonly summary = "Draws a slot: drag between its two centres, then click its width";
  readonly name = "slot";
  private stage = new TwoPoint(this.ctx, this.name);
  /** The two centres, once the first stage is done; the second stage chooses the width. */
  private centres: { from: PointerInfo; to: PointerInfo } | null = null;
  private press: PointerInfo | null = null;
  private hover: PointerInfo | null = null;

  private get fixedWidth(): number {
    const w = this.ctx.options.width;
    return typeof w === "number" && w > 0 ? w : 0;
  }

  onDown(p: PointerInfo): void {
    if (!this.centres) { this.stage.down(p); return; }
    this.press = p;
    this.hover = p;
    this.ctx.requestRender();
  }

  onMove(p: PointerInfo): void {
    if (!this.centres) { this.stage.move(p); return; }
    this.hover = p;
    this.ctx.requestRender();
  }

  onUp(p: PointerInfo): void {
    if (!this.centres) {
      const done = this.stage.up(p);
      if (!done) return;
      this.centres = done;
      if (this.fixedWidth > 0) this.commit(this.fixedWidth);
      return;
    }
    // The width: where the click or the lift is, off the centreline.
    if (!this.press) return;
    this.press = null;
    const at = unsnapped(this.stage.plane, this.stage.plane.settle(p));
    const half = halfWidth(this.centres.from.world, this.centres.to.world, at);
    if (!(half > 1e-6)) {
      this.ctx.requestRender();
      return; // on the centreline: no width yet, try again
    }
    this.commit(2 * half);
  }

  private commit(width: number): void {
    const { from, to } = this.centres!;
    const plane = this.stage.plane.plane;
    this.centres = null;
    this.press = null;
    this.hover = null;
    this.stage.reset();
    const a = placePoint(this.ctx, from, undefined, plane);
    const b = placePoint(this.ctx, to, undefined, plane);
    const parts = slot(this.ctx.model, a, b, width, plane);
    asArmed(this.ctx, ...parts.sides, ...parts.arcs);
    this.ctx.requestSolve();
    this.ctx.finish();
  }

  onCancel(): void {
    this.centres = null;
    this.press = null;
    this.hover = null;
    this.stage.cancel();
    this.ctx.requestRender();
  }

  render(r: RenderContext): void {
    const a = this.centres?.from ?? this.stage.first;
    const b = this.centres?.to ?? this.stage.hover;
    if (!a) return;
    r.g.save();
    r.g.strokeStyle = "#e8a33d";
    r.g.lineWidth = 1.3;
    const [x, y] = r.worldToScreen(a.world);
    r.g.beginPath();
    r.g.moveTo(x - 4, y); r.g.lineTo(x + 4, y);
    r.g.moveTo(x, y - 4); r.g.lineTo(x, y + 4);
    r.g.stroke();
    if (b) {
      // The centreline, dashed: the construction line the slot will carry.
      r.g.setLineDash([4, 4]);
      r.g.lineWidth = 0.8;
      r.g.beginPath();
      r.g.moveTo(...r.worldToScreen(a.world));
      r.g.lineTo(...r.worldToScreen(b.world));
      r.g.stroke();
      r.g.setLineDash([]);
      r.g.lineWidth = 1.3;
      const half = this.centres
        ? (this.hover ? halfWidth(a.world, b.world, unsnapped(this.stage.plane, this.stage.plane.settle(this.hover))) : 0)
        : this.fixedWidth / 2;
      const outline = slotOutline(a.world, b.world, half, this.stage.plane.normal(), r.scale);
      if (outline.length) {
        const px = outline.map((w) => r.worldToScreen(w));
        r.g.beginPath();
        r.g.moveTo(...px[0]);
        for (const q of px.slice(1)) r.g.lineTo(...q);
        r.g.closePath();
        r.g.stroke();
      }
    }
    r.g.restore();
  }
}

defineTool("slot", SlotTool);
