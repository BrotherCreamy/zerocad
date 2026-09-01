// The extension point: a Tool is a class with up to four hooks (pointer
// down/move/up, plus a render callback for live previews) and a name it's
// registered under. Built-in tools (see point.ts, rectangle.ts) are
// ordinary uses of exactly this API — nothing in the engine privileges
// them over a tool someone defines later at the REPL. Registration is one
// function call (defineTool), so "write a rectangle tool" really is just
// "write a class and call defineTool" — see rectangle.ts for the concrete
// example the interface was designed around.

import type { Model } from "../model.ts";
import type { Pick } from "../picking.ts";

export interface PointerInfo {
  world: number[]; // world-space coordinates, length = model.dim
  screen: [number, number]; // raw screen/canvas pixels, for UI-space rendering (e.g. drag boxes)
}

export interface RenderContext {
  g: CanvasRenderingContext2D;
  worldToScreen(world: number[]): [number, number];
}

export interface ToolContext {
  model: Model;
  requestRender(): void; // redraw without resolving (e.g. a live drag preview)
  requestSolve(): void; // resolve the model and redraw — call after committing new geometry/relations
  finish(): void; // tool signals its gesture is complete; the engine decides whether to re-arm it
  /**
   * Whatever the tool was armed with: `arm("fillet", { radius: 8 })`. A tool
   * that needs a number before it can do anything (a fillet radius, a fixed
   * circle size) reads it here rather than inventing a way to be told.
   */
  options: Record<string, unknown>;
  /**
   * What is under a screen point, if anything. Absent outside a viewport —
   * a tool driven directly in a test has nothing to hit-test against.
   */
  pick?(screen: [number, number]): Pick | null;
}

export abstract class Tool {
  abstract readonly name: string;
  ctx: ToolContext;

  constructor(ctx: ToolContext) {
    this.ctx = ctx;
  }

  onDown(_p: PointerInfo): void {}
  onMove(_p: PointerInfo): void {}
  onUp(_p: PointerInfo): void {}
  onCancel(): void {}
  render(_r: RenderContext): void {}
}

export type ToolCtor = new (ctx: ToolContext) => Tool;

const registry = new Map<string, ToolCtor>();

export function defineTool(name: string, ctor: ToolCtor): void {
  registry.set(name, ctor);
}

export function getToolCtor(name: string): ToolCtor | undefined {
  return registry.get(name);
}

export function listTools(): string[] {
  return [...registry.keys()];
}
