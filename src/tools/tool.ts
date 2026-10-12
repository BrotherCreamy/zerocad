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
import type { Snap } from "../snapping.ts";
import type { Plane } from "../view.ts";

export interface PointerInfo {
  world: number[]; // world-space coordinates, length = model.dim
  screen: [number, number]; // raw screen/canvas pixels, for UI-space rendering (e.g. drag boxes)
  /**
   * What `world` was pulled onto, if anything — the geometry the user was
   * aiming at rather than the pixel they hit. A tool that ignores this behaves
   * exactly as it did before snapping existed; a tool that places points hands
   * it to `placePoint` (see place.ts), which turns it into the constraint the
   * user meant. Absent when nothing was near enough, or when snapping is off.
   */
  snap?: Snap;
  /**
   * In a 3D model, the plane the cursor was read on — the working plane (the
   * default frame's, or the one facing the viewer; see ../workplane.ts). A
   * tool that only places points never needs it: `world` is already on it. A
   * tool that lays out a *shape* from two clicks does — a rectangle's other two
   * corners are along this plane's own axes, the way they were along x and y
   * in 2D. Absent in a 2D model, whose plane is the whole world.
   */
  plane?: Plane;
}

export interface RenderContext {
  g: CanvasRenderingContext2D;
  worldToScreen(world: number[]): [number, number];
  /**
   * Pixels per world unit. A tool previewing a circle draws it at `r * scale`
   * about its projected centre, which is how the renderer draws a committed
   * one — in 3D a circle is still a sphere, and that is its silhouette — so a
   * preview cannot promise a different size from what the click will build.
   */
  scale: number;
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
  /**
   * One line to the user, in the app's log pane. This is how a tool refuses a
   * gesture out loud: a `throw` from a pointer handler reaches the page as an
   * uncaught error nobody sees explained, and `console.warn` reaches nobody
   * at all. Absent headless, like `pick` — the convention there is to fall
   * back to whatever a caller with no user in front of them deserves: rethrow
   * a real refusal, keep the `console.warn` for an advisory.
   */
  log?(line: string): void;
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
