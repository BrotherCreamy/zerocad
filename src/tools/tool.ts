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
import type { Occlusion } from "../occlusion.ts";
import type { BoxMode, ScreenRect } from "../boxselect.ts";
import type { BlendTrial, BodyView, SolidHit } from "../bodies.ts";
import type { EdgeHit } from "../kerneledges.ts";
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
  /** The interface size (view.ts's `uiOf`): what a mark drawn for a person — not geometry — is multiplied by. */
  ui?: number;
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
   * Where a screen point's line of sight meets the plane through `origin`
   * spanned by `u` and `v`, or null when it runs along it — for a tool that
   * works in one known plane whatever is in front of it: the edit dialog
   * toggles a loop on a feature's sketch plane under its own lid. Absent
   * outside a viewport, like `pick`.
   */
  planeAt?(screen: [number, number], plane: { origin: number[]; u: number[]; v: number[] }): number[] | null;
  /**
   * The one thing the tool was armed to work on, when it was armed on one —
   * the feature the edit dialog edits (`edit("e1")`). Not an option: options
   * are values a viewer remembers, and a name is not one of those.
   */
  target?: string;
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
   * tool types `workplane("a.b.c")`, which turns the camera as well as setting
   * the work plane, and going through the command line is what makes the log, the
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
   * The entities selected before arming — a click on each with nothing armed
   * — handed over once, at arming, as `preselected` hands over regions. The
   * constrain tool starts from these: select two lines, press Constrain, and
   * the relations for two lines are listed. Empty when nothing was.
   */
  prenamed?: string[];
  /**
   * The kernel edges selected before arming (docs/plans/solid-fillets.md), by
   * name — what the fillet and chamfer tools start from: select edges, press
   * Fillet. Handed over once, as `prenamed` is.
   */
  preedges?: string[];
  /**
   * The bodies the solid kernel built, as a tool reaches them: their edges
   * under a pixel, their faces, and a preview of a fillet or chamfer in a
   * body's chain. Absent where there is no kernel (a test with no host).
   */
  solids?: SolidsAccess;
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
/**
 * What the host's solid kernel offers the engine and a tool (main.ts builds it
 * over bodies.ts and kerneledges.ts). Numbers and names only; the kernel is
 * the host's.
 */
export interface SolidsAccess {
  /** Whether an entity is a kernel body's skeleton — a twin, wall or profile member the kernel draws in its stead. */
  skeleton(name: string): boolean;
  /** The kernel edge under a pixel, as a pick (`kind: "edge"`), or null. */
  edgePick(screen: [number, number], occ: Occlusion | null, reach: number): Pick | null;
  /** The kernel edges a selection box holds, by name. */
  edgesInBox(rect: ScreenRect, mode: BoxMode, occ: Occlusion | null): string[];
  /** The bodies as drawn now — a body being previewed as its preview. */
  views(): readonly BodyView[];
  /** The kernel edge under a pixel on the bodies as drawn now, the preview included, with the hand's reach — for a tool. */
  edgeAt(screen: [number, number]): EdgeHit | null;
  /** The kernel face under a pixel on the bodies as drawn now, or null. */
  faceAt(screen: [number, number]): SolidHit | null;
  /** Shows a body as it would be with a fillet or chamfer in its chain — the preview; null takes it away. */
  trial(t: BlendTrial | null): void;
  /** What the trial last set came to: whether its answer is in, and the kernel's refusal if it refused. */
  trialAnswer(): { settled: boolean; why: string | null };
}

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
export interface FeatureDialog {
  ready: boolean;
  /**
   * A word option left at its default, and what the default comes to for what
   * is picked — an extrude's `mode: "auto"` adding to the body its solid
   * touches — with a choice worth offering (Cut, when it runs into a body).
   */
  choice?: { option: string; resolved: string | null; offer: string | null } | null;
}

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
  /**
   * What the tool does, in one line of a person's words: `static summary =
   * "Draws a rectangle: drag from corner to corner"`. The one place it is
   * written — the toolbar's tooltip, `tools()` and `help()` all read it
   * (`toolSummary`), so they cannot drift apart (docs/plans/
   * tooltips-rgb-frames.md). Optional: a tool defined at the command line
   * without one is shown by its name.
   *
   * **Read only from the class itself, never inherited** — the icon's reason
   * (icons.ts): `class extends CircleTool` registered as "stamp" would
   * otherwise describe itself as drawing a circle. Unlike `options`, which a
   * subclass is armed with exactly as its parent is, a description is of the
   * one tool.
   */
  static readonly summary?: string;
  /**
   * The toolbar group the tool's button is in: `static group = "shapes"`
   * (docs/plans/toolbar-groups.md) — one of `TOOL_GROUPS`' names, so a tool
   * defined at the command line can share a family's button. A built-in's
   * group is the table's, by name. Read from the class itself, never
   * inherited, as `summary` is; a name not in the table, or null, is a button
   * of its own.
   */
  static readonly group?: string | null;
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
   * What the gesture so far has been read as, for a choice option left to
   * read it — the circle tool's `method: "auto"` reading a drag as `centre`
   * and three clicks as `3pt` (docs/plans/one-circle-one-arc.md). Keyed by the
   * option, each value one of its declared choices; an option absent until the
   * gesture has said. The options panel shows it beside the choice, which the
   * user can then lock. Optional: a tool that reads nothing has nothing to say.
   */
  read?(): Readonly<Record<string, string>>;
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
  /**
   * Commands the options panel offers as buttons, one per row — each typed
   * through the command line when pressed, as every menu item is (the constrain
   * tool's relations for what it has picked). Absent, or empty: none.
   */
  commands?(): readonly ToolCommand[];
  /** One of `commands` was typed and has run: the tool's picks are spent. */
  ran?(command: string): void;
  /**
   * Features whose faces the host leaves undrawn while this tool is armed,
   * because the tool draws them itself, as they will be — the edit dialog's
   * preview of the feature it edits. Without it the solid as it is would sit
   * opaque over the preview, and a hole being cut would never show.
   */
  replaces?(): readonly string[];

  // The mode chip's seam (docs/plans/mode-feedback.md): what the gesture wants
  // next, and what a pick could take. Optional, so a tool written at the
  // command line before they existed is exactly what it was — the chip then
  // says the tool's name and nothing after it.

  /**
   * **The gesture's next step**, in a few of a person's words — `"press at the
   * centre"`, `"drag the radius"`, `"tap the third point"`, `"✓ to extrude"` —
   * read afresh every frame from the tool's own state, so it is always the
   * stage the gesture is in now. `hand` says which verb a press is under the
   * hand last on the canvas (`click` or `tap`). Null: nothing to say.
   */
  next?(hand: Hand): string | null;
  /**
   * **What a pick could take, lit**: entity names the host draws in a faint
   * accent while the tool waits for one — the fillet tool's corners. The extrude,
   * revolve and sketch tools light their regions and axes in their own
   * `render`, as they did before this seam; a tool that takes any entity at all
   * (the dimension tool, before its first pick) lights nothing, because
   * everything lit says nothing.
   */
  takes?(): readonly string[];
  /**
   * **Works on kernel edges** (docs/plans/solid-fillets.md): while armed, the
   * host has the solid kernel build every body, one of a single extrude
   * included, so its edges carry the kernel's names to pick.
   */
  readonly kernelEdges?: boolean;
  /**
   * **What the gesture has placed so far**: entity names it has already put in
   * the model and has not finished with — the line tool's chain. The host draws
   * them in the accent until the gesture ends.
   */
  placed?(): readonly string[];
}

/**
 * The hand a gesture's words are for: a mouse clicks, a finger taps. Read off
 * the last pointer on the canvas (the engine's `hand`), never off the device —
 * a mouse plugged into a tablet clicks.
 */
export type Hand = "mouse" | "finger";

/** "click" or "tap": the verb a press is under `hand`. */
export function press(hand: Hand): string {
  return hand === "finger" ? "tap" : "click";
}

/**
 * What Select and the Hand want next — the chip's third part with nothing
 * armed, here beside `ENGINE_SUMMARIES` because neither is a class to say it.
 */
export function engineNext(name: string, hand: Hand): string | null {
  if (name === HAND) return "drag anywhere to pan";
  if (name === SELECT) return hand === "finger" ? "tap a thing, or hold and drag to box" : "click a thing, or drag to box";
  return null;
}

export type ToolCtor = new (ctx: ToolContext) => Tool;

/** A command a tool offers on its panel: the label on the button and the line it types. */
export interface ToolCommand {
  label: string;
  command: string;
  /** Greyed, with why: shown and not pressable (the constrain tool's cell that cannot apply as the drawing stands). */
  off?: string;
}

/**
 * **Select and the Hand** (docs/plans/select-hand.md; the owner: *"there is no
 * hand/selction tool. would be nice since a lot of people are used to that"*)
 * — the toolbar's first two buttons, armed by name like any tool, and not
 * classes in the registry. `arm("select")` means **no tool**: the state a
 * click selects in, which existed long before it had a button. `arm("hand")`
 * makes a left-drag or a one-finger drag pan from wherever it lands. Both are
 * the engine's own (engine.ts), because what they change is how the engine
 * reads a press, not what a tool does with one — a Tool is handed world
 * coordinates and has no camera to pan, and the Hand's tap must still reach
 * the selection, which is the engine's.
 */
export const SELECT = "select";
export const HAND = "hand";
/** The two, in the toolbar's order. Reserved: `defineTool` refuses either name. */
export const ENGINE_TOOLS: readonly string[] = [SELECT, HAND];

/**
 * What Select and the Hand do, in the words the other tools' `static summary`
 * is in — here, because neither is a class with a static to carry one.
 */
export const ENGINE_SUMMARIES: Readonly<Record<string, string>> = {
  [SELECT]: "Picks things: click one, or drag across empty space to box several",
  [HAND]: "Pans the view: drag from anywhere, over the drawing too",
};

/**
 * A tool's one-line description — Select's and the Hand's, or a registered
 * tool's own `static summary` — or null for a tool that declares none (or no
 * tool at all), which is then shown by its name alone.
 */
export function toolSummary(name: string): string | null {
  if (Object.hasOwn(ENGINE_SUMMARIES, name)) return ENGINE_SUMMARIES[name];
  const ctor = registry.get(name);
  return ctor ? ownSummary(ctor) : null;
}

/** The class's own `summary`, not one it inherits — see `Tool.summary`. */
function ownSummary(ctor: ToolCtor): string | null {
  if (!Object.hasOwn(ctor, "summary")) return null;
  const s = (ctor as unknown as { summary?: unknown }).summary;
  return typeof s === "string" && s.trim() ? s.trim() : null;
}

/** What the toolbar shows, in its order: Select, the Hand, then every listed tool. */
export function toolbarTools(): string[] {
  return [...ENGINE_TOOLS, ...listTools()];
}

/**
 * **Toolbar groups** (docs/plans/toolbar-groups.md): tools of one family share
 * one toolbar button, which shows the one armed last and opens the rest beside
 * it. The owner asked for *"better sketch tools, relations, trim, slot... all
 * the usual"* and, before that, that *"everything has to fit"*: twenty-odd
 * buttons fit no phone as a column, so a family is one button.
 *
 * **A table keyed by the registered name, as `TOOL_ICONS` is** (icons.ts),
 * filled by the modules that own or extend each group (../modules.ts) — a
 * built-in's group is a property of its name, not guessed and not inherited:
 * a tool defined at the command line as `class extends FilletTool` under a new
 * name is not a fillet. A group's members are in its button's order, the
 * default first. A name listed here that nothing registers yet (polygon, until
 * its package lands) is simply not on the button, and **a group none of whose
 * members is registered shows no button at all**. Vetoable (TODO.md).
 *
 * Select and the Hand are the engine's and never grouped; point, line, circle,
 * arc, extrude, revolve and sketch are in no group and keep a button each. A
 * tool defined at the command line joins a group by declaring `static group =
 * "shapes"` (its own, not inherited — see `toolGroup`); a group not in this
 * table is no group, and the tool is a button of its own.
 */
export const TOOL_GROUPS: Readonly<Record<string, readonly string[]>> = {};

/**
 * Adds `members` to `group`, making it if it is new — how a module owns or
 * extends a group (../modules.ts: the sketch module's `shapes`, and a later
 * module's addition to it). Members already listed keep their place, so a
 * group extended by two modules keeps both lists in module order.
 */
export function defineGroup(group: string, members: readonly string[]): void {
  const table = TOOL_GROUPS as Record<string, string[]>;
  const list = Object.hasOwn(table, group) ? table[group] : (table[group] = []);
  for (const m of members) if (!list.includes(m)) list.push(m);
}

/** Takes `tool` out of every group's list, and drops a group left with none — a removed module's. */
export function ungroupTool(tool: string): void {
  const table = TOOL_GROUPS as Record<string, string[]>;
  for (const [group, list] of Object.entries(table)) {
    const i = list.indexOf(tool);
    if (i >= 0) list.splice(i, 1);
    if (list.length === 0) delete table[group];
  }
}

/** The class's own `static group`, when it declares one: a name, or null for none. Undefined when it declares nothing. */
function ownGroup(ctor: ToolCtor): string | null | undefined {
  if (!Object.hasOwn(ctor, "group")) return undefined;
  const g = (ctor as unknown as { group?: unknown }).group;
  return typeof g === "string" && g.trim() ? g.trim() : null;
}

/**
 * The group whose button `name` is on, or null for a button of its own. A
 * class's own `static group` decides first — a known group joins it, anything
 * else (an unknown name, null) is a button of its own; a class that declares
 * none is where the table puts its name. Read from the class itself, never
 * inherited, for the reason `summary` is not (see `Tool.summary`).
 */
export function toolGroup(name: string): string | null {
  if (ENGINE_TOOLS.includes(name)) return null;
  const ctor = registry.get(name);
  const own = ctor ? ownGroup(ctor) : undefined;
  if (own !== undefined) return own !== null && Object.hasOwn(TOOL_GROUPS, own) ? own : null;
  for (const [group, members] of Object.entries(TOOL_GROUPS)) if (members.includes(name)) return group;
  return null;
}

/** One toolbar button: a tool on its own (`group` null, one tool), or a group's registered members in its order. */
export interface ToolbarButton { group: string | null; tools: string[] }

/**
 * The toolbar's buttons, in order: Select, the Hand, then every listed tool in
 * registration order, where a group's button stands where its first registered
 * member does — its members in the table's order, then any that joined by
 * `static group`, in registration order. Thirteen today.
 */
export function toolbarButtons(on?: (tool: string) => boolean): ToolbarButton[] {
  const out: ToolbarButton[] = [];
  const byGroup = new Map<string, ToolbarButton>();
  // `on`: the tools the current workbench's tray has (../modules.ts) — the
  // engine's two are on every tray. Absent: every listed tool.
  for (const name of toolbarTools().filter((t) => !on || ENGINE_TOOLS.includes(t) || on(t))) {
    const group = toolGroup(name);
    if (group === null) {
      out.push({ group: null, tools: [name] });
      continue;
    }
    let b = byGroup.get(group);
    if (!b) {
      b = { group, tools: [] };
      byGroup.set(group, b);
      out.push(b);
    }
    b.tools.push(name);
  }
  for (const b of byGroup.values()) {
    const table = TOOL_GROUPS[b.group!];
    const rank = (t: string) => (table.includes(t) ? table.indexOf(t) : table.length);
    // A stable sort: those the table does not list keep their registration order after it.
    b.tools.sort((a, c) => rank(a) - rank(c));
  }
  return out;
}

/**
 * The tool a group's button shows, and a press on it arms: the member the
 * viewer armed last from it (`remembered` — the host keeps it, see
 * `GroupMemory` in options.ts), while that is still a member; else the first.
 */
export function groupCurrent(button: ToolbarButton, remembered: string | null | undefined): string {
  return remembered && button.tools.includes(remembered) ? remembered : button.tools[0];
}

/**
 * Names that arm a registered tool already set one way: `circle3` is the circle
 * tool locked to three points, `arc3` the arc tool likewise. They were tools of
 * their own until the owner asked *"why are there multiple circle tools and arc
 * tools? … surely just one tool, but different ways to set constraints"*
 * (docs/plans/one-circle-one-arc.md); they stay as typed names so old habits
 * and scripts keep working. `arm` reads one as the tool it names with these
 * options laid over whatever was given — so `arm("circle3")` *is*
 * `arm("circle", { method: "3pt" })`, logged, remembered and undone as that.
 * Not on the toolbar, not in the menu: one button each is the point.
 *
 * A tool registered under one of these names (`defineTool("circle3", …)` at
 * the command line) is that tool, and the alias steps aside.
 */
export const TOOL_ALIASES: Readonly<Record<string, { tool: string; options: Readonly<Record<string, unknown>>; says: string }>> = {
  circle3: { tool: "circle", options: { method: "3pt" }, says: "the circle tool, locked to 3 points" },
  arc3: { tool: "arc", options: { method: "3pt" }, says: "the arc tool, locked to 3 points" },
};

/** The alias `name` is, when no tool is registered under it — else null. */
export function toolAlias(name: string): (typeof TOOL_ALIASES)[string] | null {
  return !registry.has(name) && Object.hasOwn(TOOL_ALIASES, name) ? TOOL_ALIASES[name] : null;
}

/** The `arm` line an alias stands for — `arm("circle", {method: "3pt"})` — or null for a name that is not one. */
export function aliasCommand(name: string): string | null {
  const alias = toolAlias(name);
  if (!alias) return null;
  const options = Object.entries(alias.options).map(([k, v]) => `${k}: ${JSON.stringify(v)}`).join(", ");
  return `arm(${JSON.stringify(alias.tool)}, {${options}})`;
}

/** What `arm(name)` answers: `armed: circle`, and for an alias what it armed. */
export function armedLine(name: string): string {
  const alias = toolAlias(name);
  return alias ? `armed: ${name} — ${alias.says}, ${aliasCommand(name)}` : `armed: ${name}`;
}

const registry = new Map<string, ToolCtor>();
/** Tools armed only on something — never from the toolbar, so never on it. */
const unlisted = new Set<string>();

/**
 * Registers `ctor` under `name`. A malformed `static options` is refused here,
 * before anything is registered, so the line that defined the tool is the one
 * that says what is wrong with it — not the first `arm`.
 *
 * `listed: false` keeps it off the toolbar and out of `tools()`: a dialog
 * armed on a thing (the edit dialog, `edit("e1")`) is no tool to pick up empty
 * handed. It is armed by name all the same.
 */
export function defineTool(name: string, ctor: ToolCtor, { listed = true }: { listed?: boolean } = {}): void {
  // A class registered as "hand" would never be armed — the engine answers
  // the name itself — so it is refused where it is written, not lost.
  if (ENGINE_TOOLS.includes(name)) {
    throw new Error(`"${name}" is the toolbar's own (Select puts the tool down, the Hand pans) — name the tool something else`);
  }
  declaredOptions(ctor, name);
  // Refused where it is written, as a malformed `options` is: a summary that
  // is not text would otherwise vanish from every tooltip without a word.
  if (Object.hasOwn(ctor, "summary")) {
    const s = (ctor as unknown as { summary?: unknown }).summary;
    if (s !== undefined && typeof s !== "string") {
      throw new Error(`${name}'s static summary must be one line of text, like "Draws a rectangle: drag from corner to corner"`);
    }
  }
  // Likewise a group that is not a name: `static group = 3` would otherwise
  // quietly be a button of its own. An unknown name is allowed, and is one.
  if (Object.hasOwn(ctor, "group")) {
    const g = (ctor as unknown as { group?: unknown }).group;
    if (g !== undefined && g !== null && typeof g !== "string") {
      throw new Error(`${name}'s static group must be a group's name — ${Object.keys(TOOL_GROUPS).map((k) => JSON.stringify(k)).join(", ")} — or null`);
    }
  }
  registry.set(name, ctor);
  if (listed) unlisted.delete(name);
  else unlisted.add(name);
}

/** Unregisters `name` — a removed module's tool. Nothing armed is touched: the host releases it. */
export function undefineTool(name: string): void {
  registry.delete(name);
  unlisted.delete(name);
}

export function getToolCtor(name: string): ToolCtor | undefined {
  return registry.get(name);
}

export function listTools(): string[] {
  return [...registry.keys()].filter((n) => !unlisted.has(n));
}
