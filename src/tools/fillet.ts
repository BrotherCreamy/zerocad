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
//
// **A corner in a model with no default frame gets its plane first, typed.**
// The arc a fillet makes is given a frame's plane in 3D (see `ArcEntity`), and
// a rectangle drawn in a fresh model has none. So, once the corner has passed
// every refusal that needs no frame (`filletNeedsFrame`), the tool types
// `plane(shared, a, b, { look: false })` on the corner's own three points
// (`cornerPlaneCommand`) and rounds the corner along it as a step of its own —
// the extrude tool's pattern exactly.

import { Tool, defineTool, type PointerInfo, type RenderContext } from "./tool.ts";
import { fillet, filletNeedsFrame } from "../operations.ts";
import { cornerPlaneCommand } from "../sketchface.ts";
import { cross3, lift3 } from "../vec3.ts";

/** Used when the tool is armed with no radius. */
export const DEFAULT_RADIUS = 10;

export class FilletTool extends Tool {
  readonly name = "fillet";
  private first: string | null = null;
  /** Set between typing a corner's plane and rounding along it — which typing, so a cancel can drop it. */
  private typing: object | null = null;

  private get radius(): number {
    const r = this.ctx.options.radius;
    return typeof r === "number" && r > 0 ? r : DEFAULT_RADIUS;
  }

  onDown(p: PointerInfo): void {
    if (this.typing) return; // the plane it typed is still going in
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
    const ctx = this.ctx;
    let corner: [string, string, string] | null = null;
    if (ctx.run && ctx.act) {
      try {
        corner = filletNeedsFrame(ctx.model, first, second, this.radius);
      } catch (e) {
        this.refuse(e);
        return;
      }
    }
    if (!corner) {
      // A default frame to resolve, a 2D model — or headless, where a
      // frameless corner is refused by the operation, as it always was.
      this.commit(first, second);
      return;
    }
    // +z toward whoever clicked: the plane the click was read on faces them.
    const toward = p.plane ? cross3(lift3(p.plane.u), lift3(p.plane.v)) : [0, 0, 1];
    const command = cornerPlaneCommand(ctx.model, corner, toward);
    this.first = null;
    const token = {};
    this.typing = token;
    void Promise.resolve(ctx.run!(command)).finally(() => {
      if (this.typing !== token) return; // cancelled while it went in: the plane stays, as typed
      this.typing = null;
      ctx.act!(() => this.commit(first, second));
    });
  }

  /** Rounds the corner — refused, and the first edge kept, when `fillet` cannot. */
  private commit(first: string, second: string): void {
    try {
      fillet(this.ctx.model, first, second, this.radius);
      this.first = null;
      this.ctx.requestSolve();
      this.ctx.finish();
    } catch (e) {
      this.first = first;
      this.refuse(e);
    }
  }

  /**
   * fillet refuses corners it cannot round — collinear legs, a radius too
   * large for them. Re-armed on the first edge rather than dropping the
   * gesture, so the obvious next move (pick a different second edge) works.
   * Out loud where there is a user to tell: a throw from a pointer handler
   * reaches the page as an uncaught error nobody sees explained. Headless
   * there is no pane and a caller, so it stays a throw there — which is also
   * what keeps unit tests honest.
   */
  private refuse(e: unknown): void {
    this.ctx.requestRender();
    if (!this.ctx.log) throw e;
    this.ctx.log(`fillet: ${e instanceof Error ? e.message : e}`);
  }

  onCancel(): void {
    this.first = null;
    this.typing = null;
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
