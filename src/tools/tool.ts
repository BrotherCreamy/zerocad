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
import { declaredOptions, type OptionSpecs } from "./options.ts";

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
   * The line of sight, pointing back out of the screen at the viewer, in world
   * terms — which side of a face is the one seen. A preview of a solid culls
   * and shades its faces by it as the solids themselves are. Absent from a
   * context made by hand; a tool that needs it falls back to +z.
   */
  toward?: number[];
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
  /**
   * Where the click met the region's plane, in the world: a point inside it.
   * What a region chosen earlier is found again by once the drawing has
   * changed (`loopAround`) — its loops' indices are this moment's, and a
   * neighbour's extrude can relabel its members, but the point stays inside.
   */
  at: number[];
}

export interface ToolContext {
  model: Model;
  requestRender(): void; // redraw without resolving (e.g. a live drag preview)
  requestSolve(): void; // resolve the model and redraw — call after committing new geometry/relations
  finish(): void; // tool signals its gesture is complete; the engine decides whether to re-arm it
  /**
   * Whatever the tool was armed with: `arm("fillet", { radius: 8 })`. A tool
   * that needs a number before it can do anything (a fillet radius, a fixed
   * circle size) reads it here rather than inventing a way to be told. For a
   * tool that declares its options (`Tool.options`) every declared one is
   * here, filled from the default or the last value used, and checked; for
   * one that declares none, exactly what `arm` was given.
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
   * an error. `"guide"` marks **guidance**: a click that cannot do the thing,
   * answered with what would ("click inside a closed outline — the ones I can
   * see are lit"), the tool still armed. The host shows it muted, in the log
   * and the header's note, never red — red is for the model's own
   * contradictions, and a click that missed is not one (docs/plans/
   * effortless.md, rule 2). Every built-in tool's refusal about a click is
   * guidance; a line is a refusal unless it says otherwise, so a tool written
   * at the command line that logs a bare line still reads as one.
   */
  log?(line: string, outcome?: "refused" | "done" | "guide"): void;
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
  /**
   * The regions the user selected before arming this tool — a click inside a
   * region with nothing armed (see the engine) — handed over once, at arming.
   * Select the loop, then hit extrude: the owner's own words. A tool that
   * takes regions starts with these; one that does not ignores them. Empty
   * when nothing was selected.
   */
  preselected?: RegionHit[];
  /**
   * Values typed into the options panel and not yet committed — the depth
   * field reading 25 while the tool is still armed with 10. A feature tool
   * previews with them laid over `options`, so the lid moves as the number is
   * typed; nothing is typed or remembered until the field commits (which
   * re-arms the tool, and clears these). Always checked against the
   * declaration first: a value it refuses never gets here.
   */
  trial?: Record<string, unknown>;
  /**
   * Runs a feature's commit — the lines it types (`FeatureStep`, see
   * feature.ts), each asked of the model as the lines before it left it — as
   * **one user action**: every line through the command machinery, as typed,
   * so the log shows each and the journal holds what the typed calls hold,
   * and one undo step for the lot. Settles true once every line has run,
   * false at the first that was refused (the rest are not typed). Absent
   * outside an app; a tool then makes the same calls itself.
   */
  perform?(steps: FeatureStep[]): Promise<boolean>;
  /**
   * The same steps run on a **throwaway copy** of the model, by the same
   * command machinery, journalled nowhere — what a feature tool draws as its
   * preview, so the preview is the geometry the commit will build and not a
   * picture of it. Absent outside an app: no preview.
   */
  preview?(steps: FeatureStep[]): Promise<FeaturePreview>;
}

/**
 * One line of a feature's commit, asked of the model as it stands when it is
 * reached — so a second region is named in a drawing the first one's extrude
 * has already changed, and a plane typed by one step is there for the next.
 * Answers what to type (`text`), with `direct`, the operation it stands for,
 * for a host with no command line; or a `call` for the one thing no typed
 * line can say (a region bounded by a crossing no point marks yet, every
 * member of it shared — see extrude.ts), made directly and answered with the
 * line the log shows; or null, for nothing to do here.
 */
export type FeatureStep = (model: Model) => FeatureLine | FeatureCall | null;
export interface FeatureLine { text: string; direct?: () => unknown }
export interface FeatureCall { call: () => void }

/** What a preview built, on its copy of the model. */
export interface FeaturePreview {
  /** The copy, after the steps, solved. Null when a step was refused. */
  model: Model | null;
  /** The features on the copy that the original does not have. */
  features: string[];
  /** The entities likewise — a fillet's arc, a wall at a new tangent point. */
  entities: string[];
  /** Why a step was refused, in its own words; null when none was. */
  error: string | null;
}

/** What the options panel shows of a tool that commits a feature: whether ✓ would do anything now. */
export interface FeatureDialog { ready: boolean }

export abstract class Tool {
  /**
   * The options the tool can be armed with, declared:
   * `static options = { depth: { default: 10, unit: "length" } }` (see
   * ./options.ts). Declared rather than read ad hoc, because the declaration
   * is what everything else is built from — `arm`'s refusals and defaults, the
   * last value remembered, `tools()` and `help()`, and the options panel. A
   * tool defined at the command line with one gets all of that. Optional: a
   * tool that declares none is armed with whatever it is given, as before.
   * A static, so inherited — a tool written as `class extends ExtrudeTool`
   * takes a depth too, which (unlike an icon, see icons.ts) is right: it is
   * armed the way its parent is.
   */
  static readonly options?: OptionSpecs;
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

  // The feature dialog's hooks — pick, preview, confirm (docs/plans/
  // feature-dialog.md). Optional, so every tool that is not a feature, and
  // every tool written at the command line before they existed, is exactly
  // what it was; see feature.ts for the tools that have them.

  /** Called once the tool is armed and in place — where a preselection is taken up. */
  onArmed?(): void;
  /**
   * The tool is being re-armed with new options (`ctx.options` already
   * replaced) — the options panel's field committed, or `arm` typed again.
   * A tool with this keeps its gesture, its selection and its preview, and
   * the engine does not start it over: the depth changes under a selection
   * the user has already made.
   */
  retune?(): void;
  /** `ctx.trial` changed: the panel's field is mid-edit. Preview with it. */
  retry?(): void;
  /** ✓ or Enter. Answers whether there was anything to confirm. */
  confirm?(): boolean;
  /**
   * ✗ or Escape: drop the selection and the preview, and stay armed. Answers
   * false when there was nothing to drop, so the engine releases the tool
   * instead — a second Escape, as before.
   */
  clear?(): boolean;
  /** Whether this tool shows ✓ and ✗, and whether ✓ would do anything now. Absent for a tool that is not a feature. */
  dialog?(): FeatureDialog;
}

export type ToolCtor = new (ctx: ToolContext) => Tool;

const registry = new Map<string, ToolCtor>();

/**
 * Registers `ctor` under `name`. A malformed `static options` is refused here,
 * before anything is registered, so the line that defined the tool is the one
 * that says what is wrong with it — not the first `arm`.
 */
export function defineTool(name: string, ctor: ToolCtor): void {
  declaredOptions(ctor, name);
  registry.set(name, ctor);
}

export function getToolCtor(name: string): ToolCtor | undefined {
  return registry.get(name);
}

export function listTools(): string[] {
  return [...registry.keys()];
}
