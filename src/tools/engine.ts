// Wires real DOM pointer events on a canvas to whatever Tool is currently
// armed, translating screen pixels to world coordinates via a simple 2D
// view transform (matches cellwork's convention: screen = ox + x*scale,
// oy - y*scale). A tool is one-shot by default — it deactivates once it
// calls ctx.finish() — the same "gesture completes, arm the next one
// explicitly" shape cellwork's pointer tools already used.

import type { Model } from "../model.ts";
import { getToolCtor, type Tool, type ToolContext, type PointerInfo, type RenderContext } from "./tool.ts";

export interface View {
  ox: number;
  oy: number;
  scale: number;
}

export class ToolEngine {
  model: Model;
  view: View;
  canvas: HTMLCanvasElement;
  active: Tool | null = null;
  private g: CanvasRenderingContext2D;
  private onSolveRender: () => void;
  private onRenderOnly: () => void;

  constructor(
    model: Model,
    canvas: HTMLCanvasElement,
    view: View,
    callbacks: { onSolveRender: () => void; onRenderOnly: () => void },
  ) {
    this.model = model;
    this.canvas = canvas;
    this.view = view;
    this.g = canvas.getContext("2d")!;
    this.onSolveRender = callbacks.onSolveRender;
    this.onRenderOnly = callbacks.onRenderOnly;
    canvas.addEventListener("pointerdown", (e) => this.dispatch("down", e));
    canvas.addEventListener("pointermove", (e) => this.dispatch("move", e));
    canvas.addEventListener("pointerup", (e) => this.dispatch("up", e));
  }

  worldToScreen(world: number[]): [number, number] {
    return [this.view.ox + world[0] * this.view.scale, this.view.oy - world[1] * this.view.scale];
  }

  screenToWorld(sx: number, sy: number): number[] {
    return [(sx - this.view.ox) / this.view.scale, (this.view.oy - sy) / this.view.scale];
  }

  /** Arms `toolName`, cancelling whatever was active. Throws if the name isn't registered. */
  arm(toolName: string): void {
    this.active?.onCancel();
    const Ctor = getToolCtor(toolName);
    if (!Ctor) throw new Error(`no tool "${toolName}"`);
    const ctx: ToolContext = {
      model: this.model,
      requestRender: () => this.onRenderOnly(),
      requestSolve: () => this.onSolveRender(),
      finish: () => {
        this.active = null;
      },
    };
    this.active = new Ctor(ctx);
  }

  cancel(): void {
    this.active?.onCancel();
    this.active = null;
    this.onRenderOnly();
  }

  private dispatch(kind: "down" | "move" | "up", e: PointerEvent): void {
    if (!this.active) return;
    const rect = this.canvas.getBoundingClientRect();
    const sx = e.clientX - rect.left;
    const sy = e.clientY - rect.top;
    const info: PointerInfo = { world: this.screenToWorld(sx, sy), screen: [sx, sy] };
    if (kind === "down") this.active.onDown(info);
    else if (kind === "move") this.active.onMove(info);
    else this.active.onUp(info);
  }

  /** Call after clearing the canvas each frame — draws the active tool's live preview, if any. */
  renderOverlay(): void {
    if (!this.active) return;
    const r: RenderContext = { g: this.g, worldToScreen: (w) => this.worldToScreen(w) };
    this.active.render(r);
  }
}
