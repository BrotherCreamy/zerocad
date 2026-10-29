// The extension point: a Tool is a class with up to four hooks (pointer
// down/move/up, plus a render callback for live previews) and a name it's
// registered under. Built-in tools (see point.ts, rectangle.ts) are
// ordinary uses of exactly this API — nothing in the engine privileges
// them over a tool someone defines later at the REPL. Registration is one
// function call (defineTool), so "write a rectangle tool" really is just
// "write a class and call defineTool" — see rectangle.ts for the concrete
// example the interface was designed around.

import type { Model } from "../model.ts";
import type { Loop } from "../loops.ts";
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
   * Pixels per world unit — how finely a preview has to sample a curve to be
   * the curve the renderer will draw (see `arcSegments`). A circle previews as
   * the committed one is drawn: sampled in its plane and projected, so a
   * preview cannot promise a different shape from what the click will build.
   */
  scale: number;
}

/**
 * A region under a pixel (see ../loops.ts: the innermost loop whose inside the
 * pixel's ray meets, then the nearest). `loops` is every loop `findLoops`
 * found and `index` the one under the point, so its `children` mean something.
 *
 * `toward` is the ray it was found along, pointing back out of the screen at
 * the viewer, in world terms — which side of the region was the one seen. A
 * region is the answer to a question asked along a line of sight, and the
 * sketch tool needs that half of the answer to put a plane's +z on the side
 * facing whoever clicked; a tool has no camera to ask it of afterwards.
 */
export interface RegionHit {
  loops: Loop[];
  index: number;
  toward: number[];
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
   * The closed region a screen point is inside, if any — `pick`'s question
   * asked of regions rather than entities. See `RegionHit`. Absent outside a
   * viewport, like `pick`.
   */
  regionAt?(screen: [number, number]): RegionHit | null;
  /**
   * One line to the user, in the app's log pane. This is how a tool refuses a
   * gesture out loud: a `throw` from a pointer handler reaches the page as an
   * uncaught error nobody sees explained, and `console.warn` reaches nobody
   * at all. Absent headless, like `pick` — the convention there is to fall
   * back to whatever a caller with no user in front of them deserves: rethrow
   * a real refusal, keep the `console.warn` for an advisory.
   *
   * `"done"` marks a line that reports what a commit made rather than a
   * refusal — `e1  extrude of …` — so the host can show it as an answer, not
   * an error. A line is a refusal unless it says otherwise.
   */
  log?(line: string, outcome?: "refused" | "done"): void;
  /**
   * Types one line into the command machinery, exactly as if it had been typed
   * at the command line — the context menu's `run`, handed to a tool. For a
   * tool whose commit *is* a command with more to it than the model: the sketch
   * tool types `plane(a, b, c)`, which turns the camera as well as making a
   * frame, and going through the command line is what makes the log, the
   * journal and the undo step those of the typed call rather than a second
   * answer to what it means. Absent outside an app, like `log`.
   *
   * Settles once the line has run — logged, bracketed as its own undo step,
   * re-solved — for a tool with more to do after it: the extrude tool types
   * the plane a frameless region needs, then extrudes along it (`act`). A
   * typed line runs asynchronously, so a tool that went on in the same breath
   * would land inside the typed line's undo step.
   */
  run?(command: string): Promise<void> | void;
  /**
   * Runs `commit` as one user action of its own — one undo step — for a tool
   * that commits after a `run` it had to wait for, and so outside the pointer
   * event that began its gesture. Absent outside an app, like `run`.
   */
  act?(commit: () => void): void;
}

export abstract class Tool {
  abstract readonly name: string;
  /**
   * Whether the engine pulls this tool's cursor onto nearby geometry and draws
   * the snap marker. True for everything that places points; false for a tool
   * that chooses a *region* (extrude), where a marker saying "this click goes
   * to that vertex" would be a promise the click does not keep.
   */
  readonly snaps: boolean = true;
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
