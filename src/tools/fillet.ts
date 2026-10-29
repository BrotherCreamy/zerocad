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
import type { Model } from "../model.ts";

/** Used when the tool is armed with no radius. */
export const DEFAULT_RADIUS = 10;

/** Whether two lines share an end — asked by the tool so a miss is said in its words, not the operation's. */
function sharesCorner(model: Model, a: string, b: string): boolean {
  const [la, lb] = [model.line(a), model.line(b)];
  return la.refs.some((p) => lb.refs.includes(p));
}

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
    const hit = this.ctx.pick?.(p.screen) ?? null;
    const first = this.first;
    // Clicking anything that isn't a line is a miss, not an error: the most
    // likely cause is aiming slightly off, and cancelling the whole gesture
    // for that would be infuriating. So the gesture stays where it was, and
    // the line says what was clicked and what would do.
    if (!hit || hit.kind !== "line") {
      const what = hit ? `${hit.name} is a ${hit.kind} — ` : "";
      this.guide(first ? (hit ? `${what}click a line that meets ${first}` : `now click a line that meets ${first}`)
        : `${hit ? what : "click a line — "}fillet wants two lines that share a corner`);
      return;
    }

    if (!first) {
      this.first = hit.name;
      this.ctx.requestRender();
      return;
    }
    if (hit.name === first) {
      this.guide(`that is ${first} again — click the line it shares a corner with`);
      return;
    }

    const second = hit.name;
    const ctx = this.ctx;
    if (!sharesCorner(ctx.model, first, second)) {
      // Through `refuse`, so headless it still throws, as the operation's own
      // refusal of the same corner always did.
      this.refuse(new Error(`${first} and ${second} do not meet — fillet wants two lines that share a corner`));
      return;
    }
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
    this.ctx.log(`fillet: ${e instanceof Error ? e.message : e}`, "guide");
  }

  /**
   * One line of guidance for a click that cannot be a corner's — muted, the
   * gesture as it was. Headless it is only the console's: a miss there was
   * always silent, and a test driving the tool should not have to catch one.
   */
  private guide(why: string): void {
    this.ctx.requestRender();
    if (this.ctx.log) this.ctx.log(`fillet: ${why}`, "guide");
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
