// Click two lines that meet, and round the corner between them.
//
// This is the first tool built on picking, and it is the case that motivated
// picking in the first place: `fillet` the operation has existed for a while
// and was perfectly usable from the command line, but only if you already knew
// the two edges by name. Pointing at them is how anyone would rather do it.
//
// The tool is a two-click gesture with no drag, and it takes its radius from
// `arm("fillet", { radius: 8 })` — a tool that needs a number before it can do
// anything asks for it at arm time rather than inventing a way to be told.

import { Tool, defineTool, type PointerInfo, type RenderContext } from "./tool.ts";
import { fillet } from "../operations.ts";

/** Used when the tool is armed with no radius. */
export const DEFAULT_RADIUS = 10;

export class FilletTool extends Tool {
  readonly name = "fillet";
  private first: string | null = null;

  private get radius(): number {
    const r = this.ctx.options.radius;
    return typeof r === "number" && r > 0 ? r : DEFAULT_RADIUS;
  }

  onDown(p: PointerInfo): void {
    const hit = this.ctx.pick?.(p.screen);
    // Clicking anything that isn't a line is a miss, not an error: the most
    // likely cause is aiming slightly off, and cancelling the whole gesture
    // for that would be infuriating.
    if (!hit || hit.kind !== "line") return;

    if (!this.first) {
      this.first = hit.name;
      this.ctx.requestRender();
      return;
    }
    if (hit.name === this.first) return; // the same edge twice is not a corner

    const second = hit.name;
    const first = this.first;
    this.first = null;
    try {
      fillet(this.ctx.model, first, second, this.radius);
      this.ctx.requestSolve();
      this.ctx.finish();
    } catch (e) {
      // fillet refuses corners it cannot round — collinear legs, a radius too
      // large for them. Re-arm on the first edge rather than dropping the
      // gesture, so the obvious next move (pick a different second edge) works.
      this.first = first;
      this.ctx.requestRender();
      // Refused out loud where there is a user to tell: a throw from a
      // pointer handler reaches the page as an uncaught error nobody sees
      // explained. Headless there is no pane and a caller, so it stays a
      // throw there — which is also what keeps unit tests honest.
      if (!this.ctx.log) throw e;
      this.ctx.log(`fillet: ${e instanceof Error ? e.message : e}`);
    }
  }

  onCancel(): void {
    this.first = null;
    this.ctx.requestRender();
  }

  /** Marks the edge already chosen, so it's clear the tool is half-way through. */
  render(r: RenderContext): void {
    if (!this.first) return;
    const m = this.ctx.model;
    if (!m.entities.has(this.first)) return;
    const line = m.line(this.first);
    const [ax, ay] = r.worldToScreen(m.coords(line.refs[0]));
    const [bx, by] = r.worldToScreen(m.coords(line.refs[1]));
    r.g.save();
    r.g.strokeStyle = "#55c07a";
    r.g.lineWidth = 3;
    r.g.beginPath();
    r.g.moveTo(ax, ay);
    r.g.lineTo(bx, by);
    r.g.stroke();
    r.g.restore();
  }
}

defineTool("fillet", FilletTool);
