// Wires real DOM pointer events on a canvas to whatever Tool is currently
// armed, translating screen pixels to world coordinates via the view
// transform in ../view.ts. A tool is one-shot by default — it deactivates
// once it calls ctx.finish() — the same "gesture completes, arm the next one
// explicitly" shape cellwork's pointer tools already used.
//
// Navigation and tool use are kept on separate buttons, Onshape-style: the
// left button belongs to whichever tool is armed and nothing else, while the
// middle and right buttons pan and the wheel zooms about the cursor. That
// split is what lets you re-frame the drawing in the middle of a gesture
// without the tool ever seeing it — start a rectangle, pan, finish it.

import type { Model } from "../model.ts";
import { getToolCtor, type Tool, type ToolContext, type PointerInfo, type RenderContext } from "./tool.ts";
import { assignView, panBy, screenToWorld, worldToScreen, zoomAbout, type View } from "../view.ts";
import { hitTest, type Pick } from "../picking.ts";
import { findSnap, type Snap } from "../snapping.ts";

export type { View };

/** One wheel notch. Chosen so a full turn is a comfortable factor, not a jump. */
const ZOOM_PER_NOTCH = 1.12;

// PointerEvent.buttons is a bitmask of what is currently held, not what
// changed: 1 left, 2 right, 4 middle.
const RIGHT_BUTTON = 2;
const MIDDLE_BUTTON = 4;

/** Movement past this many pixels turns a click into a drag. cellwork's value. */
const DRAG_THRESHOLD = 3;

export class ToolEngine {
  model: Model;
  view: View;
  canvas: HTMLCanvasElement;
  active: Tool | null = null;
  private g: CanvasRenderingContext2D;
  private onSolveRender: () => void;
  private onRenderOnly: () => void;
  private onPick: (pick: Pick) => void;
  /** Which pointer is panning, and where it was last seen. */
  private panning: { id: number; sx: number; sy: number } | null = null;
  /**
   * A left press with no tool armed. It becomes a pan if it moves and a pick
   * if it doesn't — cellwork's behaviour, and the reason you rarely need the
   * right button.
   */
  private idle: { id: number; sx: number; sy: number; x0: number; y0: number; moved: boolean } | null = null;
  /** What the cursor is over, for the highlight and the hover tag. */
  hover: Pick | null = null;
  /**
   * Where the cursor is being treated as being, while a tool is drawing.
   * Null when nothing is near enough to snap to, or when no tool is armed —
   * snapping is for placing geometry, not for looking around.
   */
  snap: Snap | null = null;
  /** Set false to place coordinates exactly where the cursor is. */
  snapping = true;

  constructor(
    model: Model,
    canvas: HTMLCanvasElement,
    view: View,
    callbacks: {
      onSolveRender: () => void;
      onRenderOnly: () => void;
      /** An entity was clicked with no tool armed. */
      onPick?: (pick: Pick) => void;
    },
  ) {
    this.model = model;
    this.canvas = canvas;
    this.view = view;
    this.g = canvas.getContext("2d")!;
    this.onSolveRender = callbacks.onSolveRender;
    this.onRenderOnly = callbacks.onRenderOnly;
    this.onPick = callbacks.onPick ?? (() => {});
    canvas.addEventListener("pointerleave", () => {
      if (this.hover) { this.hover = null; this.onRenderOnly(); }
    });
    canvas.addEventListener("pointerdown", (e) => this.dispatch("down", e));
    canvas.addEventListener("pointermove", (e) => this.dispatch("move", e));
    canvas.addEventListener("pointerup", (e) => this.dispatch("up", e));
    canvas.addEventListener("pointercancel", (e) => this.dispatch("up", e));
    canvas.addEventListener("wheel", (e) => this.onWheel(e), { passive: false });
    // Without this a right-drag pan ends in a context menu over the drawing.
    canvas.addEventListener("contextmenu", (e) => e.preventDefault());
  }

  worldToScreen(world: number[]): [number, number] {
    return worldToScreen(this.view, world);
  }

  screenToWorld(sx: number, sy: number): number[] {
    return screenToWorld(this.view, sx, sy);
  }

  /** Canvas-local pixels for a pointer or wheel event. */
  private local(e: MouseEvent): [number, number] {
    const rect = this.canvas.getBoundingClientRect();
    return [e.clientX - rect.left, e.clientY - rect.top];
  }

  private onWheel(e: WheelEvent): void {
    e.preventDefault(); // otherwise the page scrolls instead of the drawing zooming
    const [sx, sy] = this.local(e);
    // deltaY is positive scrolling down, which should zoom out.
    const notches = e.deltaMode === 1 ? e.deltaY : e.deltaY / 100;
    assignView(this.view, zoomAbout(this.view, sx, sy, ZOOM_PER_NOTCH ** -notches));
    this.onRenderOnly();
  }

  /**
   * Arms `toolName`, cancelling whatever was active. Throws if the name isn't
   * registered. `options` is handed to the tool as `ctx.options`, which is how
   * a tool that needs a parameter up front — a fillet radius, say — gets one.
   */
  arm(toolName: string, options: Record<string, unknown> = {}): void {
    this.active?.onCancel();
    const Ctor = getToolCtor(toolName);
    if (!Ctor) throw new Error(`no tool "${toolName}"`);
    const ctx: ToolContext = {
      model: this.model,
      options,
      requestRender: () => this.onRenderOnly(),
      requestSolve: () => this.onSolveRender(),
      finish: () => {
        this.active = null;
        this.snap = null;
      },
      pick: ([sx, sy]) => hitTest(this.model, this.view, sx, sy),
    };
    this.active = new Ctor(ctx);
  }

  cancel(): void {
    this.active?.onCancel();
    this.active = null;
    this.idle = null;
    this.snap = null;
    this.onRenderOnly();
  }

  private dispatch(kind: "down" | "move" | "up", e: PointerEvent): void {
    const [sx, sy] = this.local(e);

    // Navigation first, and on its own buttons — a pan in the middle of a
    // tool's gesture must not look like part of that gesture.
    //
    // Driven off `buttons` (the bitmask of what is held) rather than `button`
    // (what just changed), because pressing a *second* button while one is
    // already down does not fire another pointerdown — it arrives as a
    // pointermove with the mask updated. Watching the mask is what lets a pan
    // start midway through a tool's drag, which is the whole point of putting
    // navigation on separate buttons.
    const navHeld = (e.buttons & (RIGHT_BUTTON | MIDDLE_BUTTON)) !== 0;

    if (this.panning) {
      if (navHeld) {
        if (kind === "move") {
          assignView(this.view, panBy(this.view, sx - this.panning.sx, sy - this.panning.sy));
          this.panning.sx = sx;
          this.panning.sy = sy;
          this.onRenderOnly();
        }
        return;
      }
      // The navigation button was let go — which, again, may be reported as a
      // move rather than an up. End the pan and let the event fall through, so
      // a tool still mid-drag picks its gesture straight back up.
      this.canvas.releasePointerCapture?.(this.panning.id);
      this.panning = null;
      if (kind === "up") return; // ...unless this was the release itself
    } else if (navHeld) {
      this.panning = { id: e.pointerId, sx, sy };
      this.canvas.setPointerCapture?.(e.pointerId);
      if (kind === "down") e.preventDefault();
      return;
    }

    // Hover is for looking around with nothing armed. Once a tool is armed the
    // snap marker is the feedback that matters, and two highlights competing
    // for the same cursor is worse than one — so hover stops entirely rather
    // than going stale behind the gesture.
    if (this.active) {
      if (this.hover) { this.hover = null; this.onRenderOnly(); }
    } else if (kind === "move" && e.buttons === 0) {
      this.updateHover(sx, sy);
    }

    if (this.active) {
      if (kind === "down" && e.button !== 0) return; // the left button is the tool's

      // The tool is handed a *snapped* world coordinate, and the snap that
      // produced it. A tool that only reads `world` behaves exactly as it did
      // before — it is about its own gesture, not about how precise the cursor
      // is. A tool that places points reads `snap` too, and applies the
      // constraint the user was aiming for (see place.ts). Inference is
      // downstream of snapping, so `snapping(false)` turns off both.
      this.snap = this.snapping ? findSnap(this.model, this.view, sx, sy) : null;
      const world = this.snap ? this.snap.world : this.screenToWorld(sx, sy);
      const info: PointerInfo = { world, screen: [sx, sy], ...(this.snap ? { snap: this.snap } : {}) };

      if (kind === "down") this.active.onDown(info);
      else if (kind === "move") this.active.onMove(info);
      else this.active.onUp(info);
      if (kind === "move") this.onRenderOnly(); // so the snap marker follows
      return;
    }
    this.snap = null;

    // Nothing armed: the left button pans if it moves and picks if it doesn't.
    if (kind === "down" && e.button === 0) {
      this.idle = { id: e.pointerId, sx, sy, x0: sx, y0: sy, moved: false };
      this.canvas.setPointerCapture?.(e.pointerId);
      return;
    }
    if (!this.idle || e.pointerId !== this.idle.id) return;
    if (kind === "move") {
      if (!this.idle.moved && Math.hypot(sx - this.idle.x0, sy - this.idle.y0) > DRAG_THRESHOLD) {
        this.idle.moved = true;
      }
      if (this.idle.moved) {
        assignView(this.view, panBy(this.view, sx - this.idle.sx, sy - this.idle.sy));
        this.onRenderOnly();
      }
      this.idle.sx = sx;
      this.idle.sy = sy;
    } else {
      this.canvas.releasePointerCapture?.(e.pointerId);
      const clicked = !this.idle.moved;
      this.idle = null;
      if (clicked) {
        const pick = hitTest(this.model, this.view, sx, sy);
        if (pick) this.onPick(pick);
      }
    }
  }

  private updateHover(sx: number, sy: number): void {
    const next = hitTest(this.model, this.view, sx, sy);
    if (next?.name === this.hover?.name) return;
    this.hover = next;
    this.onRenderOnly();
  }

  /** Call after clearing the canvas each frame — draws the active tool's live preview, if any. */
  renderOverlay(): void {
    if (!this.active) return;
    const r: RenderContext = { g: this.g, worldToScreen: (w) => this.worldToScreen(w) };
    this.active.render(r);
    this.renderSnapMarker();
  }

  /**
   * A marker showing what the cursor has been pulled onto. Drawn after the
   * tool's own preview so it is never hidden by it — if the cursor is not
   * where it looks, that has to be the most visible thing on screen.
   */
  private renderSnapMarker(): void {
    if (!this.snap) return;
    const [x, y] = this.snap.screen;
    const g = this.g;
    g.save();
    g.strokeStyle = "#55c07a";
    g.lineWidth = 1.6;
    g.beginPath();
    if (this.snap.kind === "point") {
      g.rect(x - 5, y - 5, 10, 10); // a square: an exact, existing point
    } else if (this.snap.kind === "midpoint") {
      g.moveTo(x, y - 6); // a triangle: derived, but still an exact position
      g.lineTo(x + 6, y + 5);
      g.lineTo(x - 6, y + 5);
      g.closePath();
    } else {
      g.arc(x, y, 5, 0, Math.PI * 2); // a circle: somewhere along a curve
    }
    g.stroke();
    g.restore();
  }
}
