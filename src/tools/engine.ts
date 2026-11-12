// Wires real DOM pointer events on a canvas to whatever Tool is currently
// armed, translating screen pixels to world coordinates via the camera in
// ../view.ts. A tool is one-shot by default — it deactivates once it calls
// ctx.finish() — the same "gesture completes, arm the next one explicitly"
// shape cellwork's pointer tools already used.
//
// **In a 3D model a pixel is a ray, and it lands on the working plane** — the
// work plane or the default frame's plane, or the origin's x–y plane when the
// user has chosen neither (see ../workplane.ts). Every world coordinate a tool
// is handed is read on that plane, which is why the tools did not have to
// learn what a camera is; a drag moves in the chosen plane, or the one facing
// the viewer (`dragPointAt`).
//
// Navigation and tool use are kept on separate buttons, Onshape-style: the
// left button belongs to whichever tool is armed and nothing else, while the
// middle button pans, the right button **orbits** (in a 3D model; in a 2D one,
// with nothing to turn, it still pans), and the wheel zooms about the cursor.
// That split is what lets you re-frame the drawing in the middle of a gesture
// without the tool ever seeing it — start a rectangle, turn the view, finish
// it.
//
// With nothing armed the left button has three meanings, decided by what the
// press landed on and whether it moved: **any geometry drags** — a point, an
// edge, a rim — empty canvas draws a selection box (see ../boxselect.ts), and
// a press that never moved picks. Both of the first two used to pan, which was
// cellwork's habit; both ancestor CADs box-select on empty canvas and drag the
// geometry everywhere else, and the standing rule is that tools work like
// Onshape, so they do here too. Panning did not lose anything by either change
// — it kept the middle and right buttons and `pan()` (the right has since
// become the 3D orbit; the middle and `pan()` still pan).
//
// The one press that still pans on the left button is one that landed on a
// constraint glyph, which is UI rather than geometry: it grabs nothing, so
// there is nothing for it to drag, and it is not empty canvas either, so it
// must not box.
//
// The right button splits the same way the left one does, and by the same
// rule: **the press decides nothing, the release does.** Past the drag
// threshold it orbits — Onshape's right-drag — where in 2D it panned; released
// without moving it is a context menu (see ../menu.ts) for whatever it landed
// on. Middle-drag is untouched and never opens anything — one button that is
// unambiguously "move the view" is worth keeping, and it is the button Onshape
// pans with.
//
// **A finger is none of those buttons** (docs/plans/touch.md; the owner: *"it
// should work on a multi-touch device. Specifically I have an iPhone."*). A
// touch pointer goes to the recogniser in ./gestures.ts, which holds it until
// it has done something — moved, lifted, held still, been joined — and hands
// back a tap, a drag, a long-press, a box or a pinch. Those are fed down the
// same paths a mouse uses: a tap is a click, a drag is the left button's drag
// (a tool's own gesture, or moving the geometry under it), a long-press is the
// right-click menu, a long-press-then-drag is the box, and two fingers pan and
// zoom about their centroid at once. One finger on empty canvas with nothing
// armed **orbits** — it is the only hand there is, and turning the drawing is
// what a finger on nothing most often means; the box, which the mouse's left
// button gets on empty canvas, moves behind the long-press. The split is made
// on `pointerType` and nothing else, so a mouse on the same device is still a
// mouse, and a pen, which aims as finely as one, is treated as one too.
//
// **Select and the Hand** head the toolbar (docs/plans/select-hand.md; the
// owner: *"there is no hand/selction tool. would be nice since a lot of people
// are used to that"*). Select is not a mode: it is "nothing armed" given a
// button, so everything above is what it does. The Hand is one change to how a
// press is read: armed, **a left press or a one-finger drag pans from wherever
// it lands**, geometry included, and moves nothing; a press that does not move
// still picks, so a tap still selects, and the wheel, a pinch and the other
// buttons are as they were. **Holding Space** is a temporary Hand over
// whatever is armed (`hold`): the tool stays armed, untouched, under it, and
// is simply back when Space is let go — nothing was put down to come back.

import { spanOf, valueArgIndex, type Model } from "../model.ts";
import { faceShade, faceUnder, pickSolid, SHADE_PX, type DrawnFaces } from "../solidpick.ts";
import { describeFace, faceKernelNames, faceRef, isPlanarFace, planeNow } from "../relations/solidref.ts";
import type { ResidualBlock } from "../kernel/problem.ts";
import {
  HAND, SELECT, engineNext, getToolCtor, howText, toolAlias, type FeatureDialog, type FeaturePreview, type FeatureStep, type Hand, type Tool, type ToolContext,
  type PointerInfo, type RegionHit, type RenderContext, type SolidsAccess,
} from "./tool.ts";
import {
  assignView, cameraPlane, depth, orbitBy, panBy, screenToPlane, screenToWorld, uiOf, viewAxes, worldToScreen, zoomAbout, type Plane, type View,
} from "../view.ts";
import { pointOnWorkingPlane, chosenPlane } from "../workplane.ts";
import { TOUCH_REACH, hitTest, type Pick } from "../picking.ts";
import { boxFrom, selectInBox, type BoxMode } from "../boxselect.ts";
import { glyphAt, placeGlyphs, type Glyph } from "../glyphs.ts";
import { describeSnap, findSnap, type Snap, type SnapKind } from "../snapping.ts";
import type { Occlusion } from "../occlusion.ts";
import { findLoops, loopAround, loopAt } from "../loops.ts";
import { OptionMemory, declaredOptions, explicitOptions, resolveOptions } from "./options.ts";
import { SELECTION, Selection, type RegionSelection } from "./selection.ts";
import { drawRegion, drawStandingRegions, hiddenLoop } from "./region.ts";
import { Gestures, TAP_SLOP, type Clock, type GestureSink } from "./gestures.ts";

export type { View };

/** One wheel notch. Chosen so a full turn is a comfortable factor, not a jump. */
const ZOOM_PER_NOTCH = 1.12;

// PointerEvent.buttons is a bitmask of what is currently held, not what
// changed: 1 left, 2 right, 4 middle.
const RIGHT_BUTTON = 2;
const MIDDLE_BUTTON = 4;

/** Movement past this many pixels turns a click into a drag. cellwork's value. */
const DRAG_THRESHOLD = 3;

/** Two clicks on one label this close together are a double-click — the usual platform default. */
const DOUBLE_CLICK_MS = 500;

/**
 * How far a right-drag turns the drawing, in radians per pixel: half a degree,
 * so a drag across a third of a typical window turns it end for end. Slower
 * than that and a quarter turn is a reach; faster and a steady oblique view is
 * hard to hold.
 */
export const ORBIT_PER_PIXEL = Math.PI / 360;

/**
 * How far above the finger the lifted copy of the active point is drawn, in
 * CSS pixels. A fingertip covers about 44 px of an iPhone's glass (Apple's
 * target size), centred on the contact: half of that, the lifted mark's own
 * ring and a gap clear of the nail.
 */
export const LIFT = 56;

/** The ghost of the point about to be placed, at the mouse: the tools' green, the snap marker's. */
export const GHOST = "#55c07a";

/**
 * The face a click will land on, lit: the hover's amber, as the dimension tool
 * lights a face under the hand — what is about to be acted on, not yet chosen
 * (green is for what is picked and placed). Filled faintly: a lid is pale
 * already, and a stronger wash hid the sketch drawn on it.
 */
const LANDING_INK = "#e8a33d";
const LANDING_FILL_ALPHA = 0.3;

/**
 * How hard a drag pulls the grabbed point toward the cursor, relative to a
 * constraint's weight of 1. cellwork's number, and the balance it strikes is
 * the whole feel of the interaction: small enough that a real constraint wins
 * outright, large enough that geometry nothing constrains sits under the
 * cursor exactly. A pull is never satisfied at the expense of the drawing —
 * that is what makes this a *kinematic* drag rather than a move.
 */
const DRAG_PULL = 0.12;

/**
 * The temporary residuals a drag hands to one solve: each coordinate of
 * `name` weakly wanting to be the matching coordinate of `world`.
 *
 * Written as a residual per coordinate rather than as a distance, because a
 * distance residual is a square in disguise near its own root and least
 * squares would end up minimising a fourth power. `(x - target) * w` is
 * linear, exact, and has a gradient everywhere including at the answer.
 *
 * Only as many coordinates as the viewport supplied are pulled. The engine
 * supplies all of them in a 3D model — a point on the working plane — and a
 * drag's target is the grabbed point moved by an offset that lies *in* that
 * plane, so the depth the gesture cannot see is left where it was by
 * construction rather than by not being pulled. A caller with only two
 * coordinates still gets the old reading: the rest are left alone.
 */
export function pullTo(model: Model, name: string, world: number[], weight = DRAG_PULL): ResidualBlock[] {
  const idx = model.point(name).varIndices.slice(0, world.length);
  return [{
    varIndices: idx,
    fn: (locals) => locals.map((v, i) => v.sub(world[i]).mul(weight)),
    label: `drag(${name})`,
  }];
}

/**
 * The points a drag on `pick` moves — its *governing* points, the ones whose
 * coordinates are the only thing the entity is made of.
 *
 * A line is its two endpoints, so dragging an edge is dragging both of them by
 * the same offset: the edge translates as a *target*, and what actually
 * happens to it is whatever the constraints allow. A circle is its centre
 * alone — dragging a rim moves the circle, it does not resize it, which is
 * both Onshape's behaviour and the only reading under which the gesture is a
 * translation. (Resizing is what `rad` and the centre-out `circle` tool are
 * for.) An arc is centre, start and end, because those three are what an arc
 * has; its radius follows from the endpoints via `arcends` rather than being
 * dragged directly.
 *
 * A glyph pick governs nothing: a constraint is not geometry and has no
 * position of its own to move.
 *
 * Returned without duplicates, since a repeated name would be a second pull on
 * the same point and would quietly weigh that point twice.
 */
export function dragGoverns(model: Model, pick: Pick): string[] {
  if (pick.kind === "relation") return [];
  const e = model.entities.get(pick.name);
  if (!e) return [];
  const names = e.kind === "point" ? [e.name] : model.refsOf(e);
  return [...new Set(names)];
}

export class ToolEngine {
  model: Model;
  view: View;
  canvas: HTMLCanvasElement;
  active: Tool | null = null;
  private g: CanvasRenderingContext2D;
  private onSolveRender: () => void;
  private onRenderOnly: () => void;
  private onPick: (pick: Pick) => void;
  private composing: () => boolean;
  private onUserAction: (phase: "before" | "after") => void;
  private onLog?: (line: string, outcome?: "refused" | "done" | "guide") => void;
  private onRun?: (command: string) => Promise<void> | void;
  private onPerform?: (steps: FeatureStep[]) => Promise<boolean>;
  private onPreview?: (steps: FeatureStep[]) => Promise<FeaturePreview>;
  /**
   * **The canvas's selection**, with nothing armed: a click on an entity or a
   * glyph replaces it with that one, shift toggles it, a box selects what it
   * catches (shift adding), a click inside a region selects the region (shift
   * adds or drops one), and a click on empty canvas or Escape clears it — all
   * of it only while no command is being written (`composing`): with text in
   * the command line a click puts the name there instead, as it always did.
   * UI state, never journalled (see `Selection`).
   *
   * The regions in it are handed to the next tool armed
   * (`ToolContext.preselected`): select the loop, then hit extrude. Arming
   * spends the whole selection, names too: what a tool does next is about its
   * own picks.
   */
  readonly selection = new Selection();

  /** The selection's regions — the feature tools' preselection, under the name it had before names joined it. */
  get selected(): RegionSelection {
    return this.selection.regions;
  }
  private onContextMenu: (pick: Pick | null, sx: number, sy: number) => void;
  private onEditDimension: ((name: string) => void) | undefined;
  /** Whether a command is half-typed — set by the host; then a label click names, never edits. */
  typingCommand: () => boolean = () => false;
  /** The last left click or tap on a dimension's label: which, where and when — what a second makes a double. */
  private lastLabelClick: { relation: string; x: number; y: number; at: number } | null = null;
  /** When the last finger went down, by its event's stamp. */
  private touchDownAt = 0;
  private onContextMenuWithdrawn: () => void;
  /**
   * Whether a user action is currently open, so that `before` and `after`
   * always arrive in pairs. The engine owns the balancing rather than leaving
   * it to the host, because the engine is the only thing that knows all the
   * ways a gesture can end — released, cancelled, or abandoned because the
   * model was swapped out from under it.
   */
  private actionOpen = false;
  /**
   * The navigation gesture in progress: which pointer, where it was last seen,
   * where it started, whether it has passed the threshold, whether it is the
   * *right* button — the only one a context menu can come out of — and whether
   * it turns the view (`orbit`: the right button, in a 3D model) or moves it.
   * The name predates the orbit; every gesture in it is navigation.
   *
   * `x0`/`y0`/`moved` are the same split the left button has always made
   * between a click and a drag, applied to the right button so that a press and
   * release in the same place can mean something other than a zero-length drag.
   * Reusing DRAG_THRESHOLD rather than inventing a second number is the point:
   * one hand, one idea of what "did not move" means.
   */
  private panning:
    | { id: number; sx: number; sy: number; x0: number; y0: number; moved: boolean; menu: boolean; orbit: boolean }
    | null = null;
  /**
   * A left press with no tool armed. What it becomes depends on what it landed
   * on and whether it moves: a press on *geometry* that moves drags it, a press
   * on *empty canvas* that moves drags a selection box, a press on a constraint
   * glyph that moves pans, and a press that does not move picks.
   *
   * `drag` is the plan for the first of those — which points the grabbed
   * entity is made of and where each of them was when it was grabbed, plus the
   * world position of the press itself and, in 3D, the plane that position was
   * read on. `empty` records that the press landed on nothing at all.
   *
   * All of it is captured at press time rather than re-hit-tested each move,
   * because the geometry is moving under the cursor from then on: re-asking
   * what is beneath the cursor would hand the drag to whatever the drawing
   * swept past, and re-reading the grabbed points' positions would make the
   * offset relative to where they have already been pulled, which compounds
   * into a runaway.
   */
  private idle: {
    id: number; sx: number; sy: number; x0: number; y0: number; moved: boolean;
    drag: { names: string[]; origins: number[][]; grab: number[]; plane?: Plane } | null;
    empty: boolean;
    /**
     * What a press on empty canvas that moves becomes: the mouse's box, or a
     * finger's orbit (a pan in 2D) — a finger's box being its long-press-drag.
     */
    onEmpty: "box" | "orbit";
    /**
     * The Hand's press: it pans wherever it landed and grabs nothing — `drag`
     * is null and `empty` is not consulted. Still, it picks, as any press does.
     */
    grab: boolean;
  } | null = null;
  /**
   * The selection box being dragged, in canvas pixels: `a` is where the press
   * landed and `b` is where the cursor is now. Null when no box is in progress.
   *
   * Kept unnormalised on purpose — which corner came first *is* the mode, and
   * normalising here would throw away the only thing that distinguishes a
   * window from a crossing.
   */
  box: { ax: number; ay: number; bx: number; by: number } | null = null;
  /**
   * What the cursor is over, for the highlight and the hover tag. A `relation`
   * pick is a constraint glyph — see `pickAt`.
   */
  hover: Pick | null = null;
  /**
   * What the cursor is over while a tool is armed — which `hover` stops being
   * the moment one is (see `dispatch`). Never highlighted, and nothing but the
   * host's drawing reads it: it is what reveals quiet geometry under an armed
   * tool's cursor (quiet.ts), so a corner the fillet tool is aimed at, which no
   * snap marker shows, is drawn while the cursor is on it.
   */
  armedUnder: Pick | null = null;
  /**
   * Where the cursor is being treated as being, while a tool is drawing.
   * Null when nothing is near enough to snap to, or when no tool is armed —
   * snapping is for placing geometry, not for looking around.
   */
  snap: Snap | null = null;
  /** Set false to place coordinates exactly where the cursor is. */
  snapping = true;
  /**
   * How far the hand reaches — every pick and snap radius is scaled by it:
   * 1 for a mouse or a pen, `TOUCH_REACH` for a finger. Set by each pointer
   * event, so a question asked between events (the menu's pick, a tool's
   * `ctx.pick`) is asked with the reach of the hand last on the canvas.
   */
  reach = 1;
  /**
   * Where a finger is on the canvas while it is down, in canvas pixels — null
   * with no finger down. What the lifted mark is drawn above while a tool is
   * armed (`renderLift`), and what the host's hover tag is placed above.
   */
  contact: [number, number] | null = null;
  /**
   * Where the mouse is on the canvas while a tool is armed, in canvas pixels —
   * null off the canvas, under a finger, or with nothing armed. What the
   * **ghost** of the point about to be placed is drawn at (`renderGhost`): the
   * mouse's half of the lifted mark a finger gets (docs/plans/mode-feedback.md).
   */
  cursorAt: [number, number] | null = null;
  /**
   * **The solid's face the armed tool's next click would land on**
   * (docs/plans/click-on-face.md): named as the kernel names it, flat or
   * round, with its plane facing the viewer and the pixel it was found under.
   * Set by every pointer event a drawing tool gets in a 3D model with no
   * sketch plane chosen, null otherwise — the ground, a chosen plane, nothing
   * armed, the pointer off the canvas or the finger lifted. What the overlay
   * lights and names before the click (`renderLanding`), and what the host's
   * chip says `on e1:l2` of.
   */
  landing: { face: string; flat: boolean; plane: Plane; at: [number, number] } | null = null;
  /**
   * **The hand last on the canvas** — a finger's touch, or a mouse or a pen —
   * which is the hand the mode chip's words are for: "tap the third point"
   * under a finger, "click" under a mouse. Set by every pointer event; the host
   * seeds it from the device (a phone starts as a finger) before any event.
   */
  pointing: Hand = "mouse";
  /**
   * The Hand, armed — `arm("hand")`. Not an `active` tool: with the Hand armed
   * nothing is armed as far as the selection, Delete and a tap are concerned;
   * only a press that moves is read differently (see the top of this file).
   * `arm` of anything, `arm("select")` and `cancel` put it down.
   */
  hand = false;
  /** Space held: a temporary Hand over whatever is armed, gone when Space is let go (`hold`). */
  private holding = false;

  /** Whether a press pans wherever it lands: the Hand armed, or Space held. */
  get handOn(): boolean {
    return this.hand || this.holding;
  }

  /**
   * What the toolbar lights: the Hand while a press would pan, the armed tool
   * by the name it was armed under, or Select — which *is* nothing armed, so
   * the button, `arm("select")` and this read one state and cannot disagree.
   */
  get lit(): string {
    if (this.handOn) return HAND;
    return this.armed?.name ?? SELECT;
  }

  /** The recogniser every touch pointer goes through (gestures.ts). */
  private gestures: Gestures;
  /**
   * The armed tool a finger's drag delivered its press to — so the drag's
   * moves and release go to that tool, and a second finger knows there is a
   * tool gesture to drop. Null otherwise.
   */
  private touchTool: Tool | null = null;
  /**
   * Whether the constraint glyphs are drawn and pickable. On by default, as in
   * an Onshape sketch: the feature exists so a constraint nobody typed
   * announces itself, and a switch you have to know to flick cannot do that.
   */
  glyphsOn = true;
  /**
   * What the solids hide, as the last frame drew it — set by the host's draw
   * pass in a shaded view, null otherwise (no solid; the hidden and wire
   * modes). Every question this engine asks about what is under the cursor —
   * a pick, a snap, a box, the glyphs — is asked with it, so nothing the frame
   * did not draw is ever under the hand. One answer per frame rather than one
   * per pointer event: a pick between two frames is a pick of what is on
   * screen, which is the last frame, and every change to the model or the
   * camera redraws before the next event can arrive.
   */
  occlusion: Occlusion | null = null;

  constructor(
    model: Model,
    canvas: HTMLCanvasElement,
    view: View,
    callbacks: {
      onSolveRender: () => void;
      onRenderOnly: () => void;
      /**
       * An entity was clicked, or boxed, with no tool armed **while a command
       * is being written** (`composing`) — the host puts its name in the
       * command line. Otherwise a click selects, and this is not called.
       */
      onPick?: (pick: Pick) => void;
      /**
       * Whether a command is being written — text in the command line. The
       * host's to say, since the engine has never heard of a command line;
       * absent means no, and every click selects.
       */
      composing?: () => boolean;
      /**
       * Brackets one thing the user did with the pointer — a click handed to an
       * armed tool, or a drag from the moment it starts moving to the solve
       * that settles it. Fired in `before`/`after` pairs, always both.
       *
       * The engine deliberately does not know *why* a host wants this. It is
       * what undo is built on (main.ts snapshots the model at `before` and
       * pushes it at `after` if anything changed), but the engine sits below
       * undo in the layering and must not learn that undo exists — so what it
       * offers is the neutral fact it is uniquely able to report: a gesture
       * began, a gesture ended. Anything else wanting that fact gets it too.
       */
      onUserAction?: (phase: "before" | "after") => void;
      /** One line to the user in the host's log pane — see ToolContext.log. */
      onLog?: (line: string, outcome?: "refused" | "done" | "guide") => void;
      /** One line typed into the host's command machinery, settling once it has run — see ToolContext.run. */
      onRun?: (command: string) => Promise<void> | void;
      /** A feature's lines typed as one user action — see ToolContext.perform. */
      onPerform?: (steps: FeatureStep[]) => Promise<boolean>;
      /** The same lines run on a throwaway copy of the model — see ToolContext.preview. */
      onPreview?: (steps: FeatureStep[]) => Promise<FeaturePreview>;
      /**
       * A right press released without moving, with what it landed on (null for
       * empty canvas) and where, in canvas pixels.
       *
       * Named for the gesture rather than for the menu, the way `onUserAction`
       * is named for the gesture rather than for undo: the engine reports what
       * only it can see and holds no opinion about what a host does with it. A
       * host with no menu passes nothing and the right button keeps navigating
       * and nothing else, which is what every test written before this existed
       * assumes.
       */
      onContextMenu?: (pick: Pick | null, sx: number, sy: number) => void;
      /**
       * A dimension's label double-clicked (or double-tapped): open its value
       * to be typed, as Set value… does — SolidWorks' Modify box, in the
       * house's one way to ask for a number (docs/plans/smart-dimension.md).
       */
      onEditDimension?: (name: string) => void;
      /**
       * The press that asked for a menu moved on instead: a finger held still
       * until `onContextMenu`, then dragged — which is the box (gestures.ts).
       * The menu it opened is no longer what the hand is doing; a host with a
       * menu closes it. Never called for a mouse, whose menu opens on release.
       */
      onContextMenuWithdrawn?: () => void;
      /** Time for the touch recogniser — a test's fake; the real clock otherwise. */
      clock?: Clock;
      /**
       * The viewer's last option values, which `arm` fills from and writes to.
       * Not a callback: per-viewer state the host owns (main.ts hands it one
       * over `localStorage`), so the engine never touches storage itself. An
       * engine given none remembers for its own lifetime.
       */
      optionMemory?: OptionMemory;
    },
  ) {
    this.model = model;
    this.canvas = canvas;
    this.view = view;
    this.g = canvas.getContext("2d")!;
    this.onSolveRender = callbacks.onSolveRender;
    this.onRenderOnly = callbacks.onRenderOnly;
    this.onPick = callbacks.onPick ?? (() => {});
    this.composing = callbacks.composing ?? (() => false);
    this.onUserAction = callbacks.onUserAction ?? (() => {});
    this.onLog = callbacks.onLog;
    this.onRun = callbacks.onRun;
    this.onPerform = callbacks.onPerform;
    this.onPreview = callbacks.onPreview;
    this.onContextMenu = callbacks.onContextMenu ?? (() => {});
    this.onEditDimension = callbacks.onEditDimension;
    this.onContextMenuWithdrawn = callbacks.onContextMenuWithdrawn ?? (() => {});
    this.optionMemory = callbacks.optionMemory ?? new OptionMemory(null);
    this.gestures = new Gestures(this.touchSink(), callbacks.clock);
    // The canvas's touches are the recogniser's, all of them: left to the
    // browser, a second finger is a page zoom, and both pointers are cancelled
    // out from under the gesture (measured: Chromium's iPhone emulation sends
    // pointercancel on the first pinch move). Said here, beside the listeners
    // that depend on it, rather than left for a stylesheet to remember.
    if (canvas.style) canvas.style.touchAction = "none";
    // ...and so are the mouse events and the click a browser makes up after a
    // touch, which would be a second, mouse-shaped reading of the same finger.
    // Measured: the click after a long-press is hit-tested where the finger
    // lifted, which is now on the menu that long-press opened, and it ran the
    // menu's first item. Cancelling `touchend` is the one way to stop it
    // (a pointer event cannot cancel a click); the recogniser has already had
    // the pointerup by then, and nothing on the canvas listens for clicks.
    canvas.addEventListener("touchend", (e) => { if (e.cancelable) e.preventDefault(); });
    canvas.addEventListener("pointerleave", () => {
      if (this.hover || this.armedUnder || this.cursorAt || this.landing) {
        this.hover = null; this.armedUnder = null; this.cursorAt = null; this.landing = null; this.onRenderOnly();
      }
    });
    canvas.addEventListener("pointerdown", (e) => this.dispatch("down", e));
    canvas.addEventListener("pointermove", (e) => this.dispatch("move", e));
    canvas.addEventListener("pointerup", (e) => this.dispatch("up", e));
    canvas.addEventListener("pointercancel", (e) => this.dispatch("up", e));
    canvas.addEventListener("wheel", (e) => this.onWheel(e), { passive: false });
    // Without this a right-drag orbit ends in a context menu over the drawing.
    canvas.addEventListener("contextmenu", (e) => e.preventDefault());
  }

  /** Opens a user action, if one is not already open. Idempotent by design. */
  private beginUserAction(): void {
    if (this.actionOpen) return;
    this.actionOpen = true;
    this.onUserAction("before");
  }

  /** Closes the open user action, if there is one. Safe to call from any exit. */
  private endUserAction(): void {
    if (!this.actionOpen) return;
    this.actionOpen = false;
    this.onUserAction("after");
  }

  /**
   * Which selection the box in progress means, or null if there is no box.
   * Left→right is a window, right→left a crossing — the SolidWorks/Onshape
   * convention, which is worth matching exactly because it is one of the few
   * gestures every CAD user already has in their hands.
   */
  get boxMode(): BoxMode | null {
    return this.box ? boxFrom(this.box.ax, this.box.ay, this.box.bx, this.box.by).mode : null;
  }

  worldToScreen(world: number[]): [number, number] {
    return worldToScreen(this.view, world);
  }

  /**
   * The world point under (sx, sy). In a 3D model, on the working plane — the
   * one place a cursor can mean without help (see ../workplane.ts); in a 2D
   * model, where the world is a plane already, the plain inverse.
   */
  screenToWorld(sx: number, sy: number): number[] {
    return this.pointAt(sx, sy).world;
  }

  /** `screenToWorld`, plus the plane the point was read on — absent in 2D. */
  private pointAt(sx: number, sy: number): { world: number[]; plane?: Plane } {
    if (this.model.dim !== 3) return { world: screenToWorld(this.view, sx, sy) };
    return pointOnWorkingPlane(this.model, this.view, sx, sy);
  }

  /**
   * Where a drag's press is read, and the plane the drag then moves in: the
   * plane the user chose to sketch on (`chosenPlane`), else the one facing
   * the viewer — not the origin's, which is where a click *lands* with no plane
   * chosen (../workplane.ts). A drag is a hand moving something it sees, and
   * pinning it to the ground in a turned view would leave a lid's corner
   * immovable along the one direction the user is looking at it in.
   */
  private dragPointAt(sx: number, sy: number): { world: number[]; plane?: Plane } {
    if (this.model.dim !== 3) return { world: screenToWorld(this.view, sx, sy) };
    const chosen = chosenPlane(this.model);
    const on = chosen && screenToPlane(this.view, sx, sy, chosen);
    if (on && chosen) return { world: on, plane: chosen };
    const facing = cameraPlane(this.view);
    return { world: screenToPlane(this.view, sx, sy, facing)!, plane: facing };
  }

  /**
   * The constraint glyphs as they stand this frame — empty when they are off.
   *
   * Recomputed on demand rather than cached, because there is no moment at
   * which a cache could be invalidated honestly: a drag moves geometry without
   * touching the model's structure, and a solve moves it without anything
   * calling in here at all. The work is a few arithmetic operations per
   * relation, which is nothing next to the solve that just ran.
   */
  /**
   * The relations the host has lit — selected, or named by the last solve's
   * conflict — for which `placeGlyphs` places a linked pair's label at both
   * ends rather than at the nearer one alone. Set by the host before each draw; the pick
   * path reads the last.
   */
  litRelations: ReadonlySet<string> = new Set();

  glyphs(): Glyph[] {
    return this.glyphsOn ? placeGlyphs(this.model, this.view, this.occlusion, this.litRelations) : [];
  }

  /**
   * What is under (sx, sy): **glyphs first**, then geometry.
   *
   * Glyphs are the top tier because they are small and deliberate to aim at.
   * A glyph you cannot click because a point happens to sit near it defeats
   * the feature — and unlike geometry, a glyph is only ever where it is
   * because it was put there, so there is no ambiguity about whether it was
   * the thing meant.
   *
   * Snapping deliberately does not consult this. Glyphs are UI, not geometry,
   * and nothing should ever be *placed* at one.
   */
  pickAt(sx: number, sy: number): Pick | null {
    // A glyph's box is not widened for a finger: it sits a few pixels off the
    // line it marks, and a box grown to a fingertip would cover that line and
    // take every tap aimed at it.
    const gl = glyphAt(this.glyphs(), sx, sy);
    if (gl) return { name: gl.relation, kind: "relation", distance: 0 };
    return this.geometryAt(sx, sy);
  }

  /** `pickAt` below the glyphs: the drawing's own geometry, and a kernel body's edges. */
  private geometryAt(sx: number, sy: number): Pick | null {
    const hit = hitTest(this.model, this.view, sx, sy, this.occlusion, this.reach);
    // **A kernel body's edges pick** (docs/plans/solid-fillets.md) — where no
    // entity does, and in place of the quiet skeleton a kernel body's edges
    // lie along (a lid's twins, its walls, its profile: what the kernel draws
    // in their stead, quiet.ts). A point still wins, as it wins over a line:
    // a corner is what a hand on a corner means. The entity rides along
    // (`under`), so a press still drags it.
    if (this.solids && (!hit || (hit.kind !== "point" && this.solids.skeleton(hit.name)))) {
      const e = this.solids.edgePick([sx, sy], this.occlusion, this.reach);
      if (e) return hit ? { ...e, under: hit } : e;
    }
    return hit;
  }

  /**
   * Opens a dimension's value **after** the event that asked: the press that
   * did is still being dispatched, and its default — a mousedown on a canvas
   * takes the focus to the page — would take it straight back off the command
   * line, leaving the typed number going nowhere (found in the browser: the
   * value landed in front of the command, not after it).
   */
  private editSoon(name: string): void {
    const edit = this.onEditDimension;
    if (edit) setTimeout(() => edit(name), 0);
  }

  /**
   * Whether a click at (sx, sy) at time `at` is the second of a double-click
   * on one dimension's label — and if so, its value opened (`onEditDimension`).
   * A click on anything else forgets the first. The window is the platform's
   * usual double-click time; the slop a finger's, since a tap lands looser.
   */
  private doubleOnLabel(sx: number, sy: number, at: number): boolean {
    if (!this.onEditDimension) return false;
    // A command half-typed takes a click on a label as its name, every click:
    // `del(` then the label is a deletion, not an edit. Two such clicks land
    // inside the double-click window on a quick hand (found merging #84:
    // dimensions.e2e's `del(` click opened `set(` on a quiet machine).
    if (this.typingCommand()) { this.lastLabelClick = null; return false; }
    const gl = glyphAt(this.glyphs(), sx, sy);
    const dim = gl && gl.isLabel && valueArgIndex(gl.op) !== null ? gl.relation : null;
    const last = this.lastLabelClick;
    this.lastLabelClick = dim ? { relation: dim, x: sx, y: sy, at } : null;
    if (!dim || !last || last.relation !== dim || at - last.at > DOUBLE_CLICK_MS
      || Math.hypot(sx - last.x, sy - last.y) > TAP_SLOP) return false;
    this.lastLabelClick = null;
    this.editSoon(dim);
    return true;
  }

  /**
   * The bodies the solid kernel built, as a hand reaches them — set by the
   * host (main.ts, over bodies.ts and kerneledges.ts), null where there is no
   * kernel. What makes a kernel edge a pick, a box's catch and a fillet's edge.
   */
  solids: SolidsAccess | null = null;

  /**
   * The faces the last frame drew, with the occlusion answer over them — set
   * by the host's render (main.ts) — what `ToolContext.pickSolid` finds a
   * face in (solidpick.ts). Null where none were drawn: no solid, the wire view.
   */
  drawnFaces: DrawnFaces | null = null;

  /**
   * The points a drag is moving right now — empty until the press has moved
   * past the drag threshold, and when the press grabbed nothing. What reveals
   * a quiet corner while it is dragged (quiet.ts): the hover is gone by then.
   */
  get dragging(): string[] {
    return this.idle?.moved && this.idle.drag ? this.idle.drag.names : [];
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
   * The closed region (sx, sy) is inside, if any — see ToolContext.regionAt.
   * Public as well, for the host's context menu, which offers "Sketch on this
   * face" only where a right-click landed inside one. Found afresh per ask,
   * like everything screen-space here: a loop is a question, not an entity,
   * and the drawing may have moved since.
   */
  regionAt(sx: number, sy: number): RegionHit | null {
    const loops = findLoops(this.model);
    let loop = loopAt(this.model, this.view, sx, sy, loops);
    // A body the solid kernel built has faces no loop of entities bounds — a
    // pocket's floor, a lid with a hole cut through it — and loses faces a
    // loop still does (a hole's mouth is a circle on the lid, with no lid
    // there). So the kernel's face under the pixel decides where it is
    // nearer: a flat one is the loop its point lies inside, on its plane (the
    // feature's own lid, wall or profile — the plane follows the solid,
    // because its points are the feature's), and a curved one is no region.
    const solid = this.solidFaceAt?.(sx, sy) ?? null;
    if (solid) {
      const at = loop ? screenToPlane(this.view, sx, sy, loop.plane) : null;
      const nearer = at !== null && depth(this.view, at) > solid.depth + 1e-6 * Math.max(1, Math.abs(solid.depth));
      if (!nearer) {
        if (!solid.planar) return null;
        loop = loopAround(this.model, solid.at, loops);
      }
    }
    // A region bounded by anything hidden is not on screen to click inside.
    // The innermost loop under the cursor decides, as it always has: one
    // further out is not offered in its place (a hidden hole is not a hole
    // the click fell through).
    if (!loop || hiddenLoop(this.model, loop)) return null;
    const { origin, u, v } = loop.plane;
    const at = screenToPlane(this.view, sx, sy, { origin, u, v });
    return at ? { loops, index: loops.indexOf(loop), toward: viewAxes(this.view).toward, at } : null;
  }

  /**
   * The nearest face of a body the solid kernel built, under a pixel — set by
   * the host (main.ts, bodies.ts), null where there is no kernel. Asked by
   * `regionAt` alone: the engine knows a hit's depth, flatness and point, and
   * nothing of the kernel.
   */
  solidFaceAt: ((sx: number, sy: number) => { at: number[]; depth: number; planar: boolean } | null) | null = null;

  /** Where `arm` keeps and finds the last value of each declared option. */
  private optionMemory: OptionMemory;

  /** What `arm` was last called with. Read through `armed`, which checks it is still current. */
  private armedWith: { name: string; options: Record<string, unknown>; target?: string } | null = null;

  /**
   * The name, options and target the armed tool was armed with, or null when
   * nothing is armed — exactly what `arm` needs to arm it afresh. That is its
   * one use: an undo abandons the gesture in progress but keeps the tool (see
   * main.ts's `step`), and the gesture's state lives in the tool instance, so
   * "keep the tool, drop the gesture" is a new instance of the same tool. The
   * registered name rather than `active.name`, because a tool defined at the
   * command line may call itself anything.
   */
  get armed(): { name: string; options: Record<string, unknown>; target?: string } | null {
    return this.active ? this.armedWith : null;
  }

  /**
   * Arms `toolName`, cancelling whatever was active. Throws if the name isn't
   * registered. `options` is handed to the tool as `ctx.options`, which is how
   * a tool that needs a parameter up front — a fillet radius, say — gets one.
   *
   * For a tool that declares its options they are checked first and filled
   * (`resolveOptions`: typed, else the last value used, else the default), and
   * the ones typed are remembered as this viewer's next defaults. A refusal —
   * an option the tool does not have, a value it cannot take — is thrown
   * **before** anything is cancelled, so a typo leaves the armed tool, and the
   * gesture it was in, exactly as they were.
   *
   * `target` is the one thing a tool armed on a thing works on (`ctx.target`):
   * the feature `edit("e1")` opens the dialog on.
   */
  arm(toolName: string, given: Record<string, unknown> = {}, target?: string): void {
    if (toolName === SELECT || toolName === HAND) {
      // Refused before anything is put down, as a typo in a tool's options is.
      if (Object.keys(given ?? {}).length) throw new Error(`${toolName} takes no options`);
      this.putDown(toolName === HAND);
      return;
    }
    // `circle3`, `arc3`: the one tool, locked — read here, where every way of
    // arming arrives (the typed `arm`, the bare name, an undo's re-arm), so the
    // tool armed, the options remembered and the panel are the one tool's.
    // The lock an alias brings is not remembered, only what was typed with it:
    // `circle3` once must not leave the Circle button's drag drawing nothing
    // for good. A lock picked in the panel, or typed, is remembered as usual.
    const alias = toolAlias(toolName);
    const typed = given;
    if (alias) {
      toolName = alias.tool;
      given = { ...(given && typeof given === "object" ? given : {}), ...alias.options };
    }
    const Ctor = getToolCtor(toolName);
    if (!Ctor) {
      this.active?.onCancel();
      throw new Error(`no tool "${toolName}"`);
    }
    const specs = declaredOptions(Ctor, toolName);
    const options = resolveOptions(toolName, specs, given, this.optionMemory.recall(toolName));
    this.optionMemory.remember(toolName, explicitOptions(specs, typed));
    // The tool already armed, armed again — the options panel's field
    // committed, or `arm` typed with a new depth — keeps what it has picked if
    // it can (`retune`): the depth changes under a selection already made. Not
    // when it is armed on something else: `edit("e2")` while editing e1 is a
    // different dialog. A field's `arm` names no target and keeps the one there.
    const keep = target ?? this.armedWith?.target;
    const same = this.active && this.armedWith?.name === toolName && this.active.retune
      && keep === this.armedWith?.target;
    if (same) {
      this.armedWith = { name: toolName, options, ...(keep === undefined ? {} : { target: keep }) };
      this.active!.ctx.options = options;
      this.active!.ctx.trial = {};
      this.active!.retune!();
      return;
    }
    this.active?.onCancel();
    // A tool taken up puts the Hand down: one thing in the hand at a time.
    this.hand = false;
    this.cursor();
    this.armedWith = { name: toolName, options, ...(target === undefined ? {} : { target }) };
    // Spent once taken: a selection carried into one tool is not carried on into the next.
    const preselected = [...this.selected.refresh(this.model)];
    // The entities selected, too — what the constrain tool constrains when
    // armed on a selection (docs/plans/sketch-relations.md). Relations and
    // regions are not entities, and the model is asked which names are.
    const prenamed = this.selection.prune(this.model).filter((n) => this.model.entities.has(n));
    // And the kernel edges selected — what the fillet and chamfer tools round.
    const preedges = [...this.selection.edges];
    this.selection.clear();
    const ctx: ToolContext = {
      model: this.model,
      options,
      preselected,
      prenamed,
      preedges,
      ...(this.solids ? { solids: this.solids } : {}),
      trial: {},
      ...(target === undefined ? {} : { target }),
      planeAt: ([sx, sy], plane) => screenToPlane(this.view, sx, sy, plane),
      requestRender: () => this.onRenderOnly(),
      requestSolve: () => this.onSolveRender(),
      finish: () => {
        this.active = null;
        this.snap = null;
        this.landing = null;
        // Drawn again at once: a tool that commits on a press and finishes
        // there gets no event after it to redraw on, and the frame its solve
        // drew still had it armed — the face it was landing on lit, the chip
        // saying so. Found in the picture of a three-point circle just made.
        this.onRenderOnly();
      },
      pick: ([sx, sy]) => hitTest(this.model, this.view, sx, sy, this.occlusion, this.reach),
      // A vertex before an edge before a face (docs/plans/smart-dimension.md).
      // The face is handed on by its written name — a wall by the entity it is
      // swept from (`e1:l2`), never its place (docs/plans/review-relations.md).
      pickSolid: ([sx, sy]) => pickSolid(this.geometryAt(sx, sy), this.drawnFaces, sx, sy,
        (f) => describeFace(this.model, f), (tag) => faceRef(this.model, tag)),
      ...(this.onEditDimension ? { editDimension: (name: string) => this.editSoon(name) } : {}),
      faceShade: (name) => faceShade(this.drawnFaces, faceKernelNames(this.model, name), this.view),
      toScreen: (world) => worldToScreen(this.view, world),
      regionAt: ([sx, sy]) => this.regionAt(sx, sy),
      // What a tool says while running — guidance, a refusal — is said to the
      // hand on the canvas, as its how-lines are (docs/plans/tool-howto.md,
      // docs/plans/no-sketch.md): `{tap}` in the line reads *click* under a
      // mouse and *tap* under a finger. Filled here, the one place every
      // tool's line passes, so no tool keeps two spellings of one sentence.
      // Headless (a test's own ctx) the placeholder is what the tool said.
      log: this.onLog && ((line, outcome) => this.onLog!(howText(line, this.pointing), outcome)),
      run: this.onRun,
      // The engine's own bracket, idempotent as ever: the pointer event that
      // began the gesture has long closed its own by the time this is called.
      act: (commit) => {
        this.beginUserAction();
        try {
          commit();
        } finally {
          this.endUserAction();
        }
      },
      perform: this.onPerform,
      preview: this.onPreview,
    };
    const tool = new Ctor(ctx);
    this.active = tool;
    tool.onArmed?.();
  }

  /**
   * `arm("select")` and `arm("hand")`: the armed tool put down — its gesture
   * and a feature's picks with it, as Escape drops them — and, for the Hand,
   * the Hand taken up. **The selection is left alone**, unlike `cancel`: the
   * Select button is "stop drawing", not "forget what I picked", and the Hand
   * is for looking at what is selected from another side.
   */
  private putDown(hand: boolean): void {
    this.active?.onCancel();
    this.active = null;
    this.snap = null;
    this.landing = null;
    this.armedUnder = null;
    this.cursorAt = null;
    this.touchTool = null;
    this.hand = hand;
    this.cursor();
    this.onRenderOnly();
  }

  /**
   * Space down (`true`) or up: the temporary Hand. Nothing armed is touched —
   * a half-drawn rectangle or a half-picked extrude is exactly where it was
   * when Space comes up. Only a press made while it is held pans; one already
   * under way is the gesture it began as, and a pan begun under it runs to its
   * release even if Space is let go first. Answers whether anything changed,
   * so the host re-lights the toolbar only then (a held key repeats).
   */
  hold(on: boolean): boolean {
    if (this.holding === on) return false;
    this.holding = on;
    this.cursor();
    return true;
  }

  /**
   * The canvas's cursor: an open hand while a press would pan, a closed one
   * while it is panning, and otherwise whatever the page says. The engine's to
   * set, beside `touch-action`, because only it knows which press pans.
   */
  private cursor(): void {
    if (!this.canvas.style) return;
    this.canvas.style.cursor = this.idle?.grab ? "grabbing" : this.handOn ? "grab" : "";
  }

  /**
   * ✓ or Enter: the armed tool's confirm, if it has one. Answers whether it
   * was taken — false with nothing armed, a tool that is not a feature, or a
   * feature with nothing picked — so the host can leave the key to whatever
   * else it means.
   */
  confirm(): boolean {
    return this.active?.confirm?.() ?? false;
  }

  /**
   * Escape, or ✗: **a feature's picks go first**, and the tool stays armed;
   * a second press, with nothing picked, releases it as Escape always did.
   * With nothing armed it drops the canvas's selection. Answers what it did,
   * for the log.
   */
  escape(): "cleared" | "cancelled" {
    if (this.active?.clear?.()) {
      this.onRenderOnly();
      return "cleared";
    }
    const had = !this.active && !this.hand && this.selection.size > 0;
    this.cancel();
    return had ? "cleared" : "cancelled";
  }

  /**
   * `select(...)` typed: exactly these names, already checked by the caller
   * (the command surface expands groups and features and drops what is
   * hidden), and nothing else — no region.
   */
  select(names: readonly string[]): void {
    this.selection.set(names);
    this.onRenderOnly();
  }

  /**
   * **The mode chip's third part** (docs/plans/mode-feedback.md): what the
   * gesture wants next — the armed tool's own words for the stage it is in
   * (`Tool.next`), or Select's or the Hand's — in the verb of the hand last on
   * the canvas. One seam, asked every frame, so the chip is never a stage
   * behind. A tool that says nothing, or throws saying it, says nothing: the
   * chip is not where a tool's bug should surface.
   */
  next(): string | null {
    if (this.handOn) return engineNext(HAND, this.pointing);
    if (!this.active) return engineNext(SELECT, this.pointing);
    try {
      return this.active.next?.(this.pointing) ?? null;
    } catch {
      return null;
    }
  }

  /** What the armed tool's next pick could take, for the host to light (`Tool.takes`) — none with nothing armed. */
  takes(): readonly string[] {
    try {
      return this.active?.takes?.() ?? [];
    } catch {
      return [];
    }
  }

  /** What the armed tool's gesture has placed and not finished with, drawn in the accent (`Tool.placed`). */
  placed(): readonly string[] {
    try {
      return this.active?.placed?.() ?? [];
    } catch {
      return [];
    }
  }

  /** What the options panel shows of the armed tool's ✓ and ✗ — null for a tool that is not a feature. */
  dialog(): FeatureDialog | null {
    return this.active?.dialog?.() ?? null;
  }

  /**
   * The options panel's field mid-edit: `option` reads `value` for the
   * preview, not yet typed — or, with null, reads the armed value again (the
   * field restored). A value the declaration refuses is left out, so a field
   * on its way through "0" to "0.5" keeps the last preview it could build.
   */
  trial(option: string, value: number | boolean | null): void {
    const tool = this.active;
    const armed = this.armedWith;
    if (!tool?.retry || !armed) return;
    const next = { ...(tool.ctx.trial ?? {}) };
    if (value === null) delete next[option];
    else {
      try {
        const Ctor = getToolCtor(armed.name)!;
        resolveOptions(armed.name, declaredOptions(Ctor, armed.name), { [option]: value }, {});
      } catch {
        return;
      }
      next[option] = value;
    }
    tool.ctx.trial = next;
    tool.retry();
  }

  /**
   * Abandons whatever gesture is in progress — Escape, or a model being
   * swapped out underneath one.
   *
   * A drag has to be *settled* rather than merely dropped. Its last frame was
   * solved with the pull still applied, so the geometry it left behind is the
   * compromise between the drawing and a cursor that is no longer there, and
   * the status line still reads whatever it did before the gesture began.
   * Cancelling therefore ends a drag the same way releasing the button does:
   * one ordinary solve through the host's path. "Cancel" cannot put the
   * geometry back — that is what Ctrl+Z is for, and it is a separate keystroke
   * meaning a separate thing — so the least it can do is not leave a pull baked
   * into the drawing.
   *
   * Because a cancelled drag *is* a settled drag, it closes the user action the
   * same way a release does. A drag abandoned with Escape is therefore one undo
   * step, exactly like one that was released: the two leave the same geometry
   * behind, so it would be strange for only one of them to be reversible.
   *
   * A selection box is the opposite case and is simply dropped: nothing was
   * committed, so there is nothing to settle and nothing to insert. Clearing
   * `idle` is what makes the release that follows a no-op rather than a
   * belated selection.
   */
  cancel(): void {
    this.active?.onCancel();
    this.active = null;
    // The Hand is put down too: Escape, `cancel()` and the strip's Cancel all
    // leave Select lit, whatever was in the hand.
    this.hand = false;
    // The canvas's selection goes with it: Escape with nothing armed means
    // "put down what I picked up", and a model swapped out from under a
    // selection leaves it naming loops and entities that are not there.
    this.selection.clear();
    const wasDragging = this.idle?.moved === true && this.idle.drag !== null
      && this.idle.drag.names.every((n) => this.model.entities.has(n));
    this.idle = null;
    this.box = null;
    this.snap = null;
    this.landing = null;
    this.cursorAt = null;
    // Fingers still down when everything is dropped are spent until they lift:
    // the gesture they were making is gone, and their next move must not
    // start another.
    this.gestures.reset();
    this.touchTool = null;
    this.contact = null;
    this.cursor();
    if (wasDragging) this.onSolveRender();
    else this.onRenderOnly();
    this.endUserAction();
  }

  private dispatch(kind: "down" | "move" | "up", e: PointerEvent): void {
    // A finger: the recogniser decides what it is (see the top of this file).
    if (e.pointerType === "touch") {
      this.reach = TOUCH_REACH;
      this.pointing = "finger";
      this.cursorAt = null;
      this.finger(kind, e);
      return;
    }
    this.reach = 1;
    this.pointing = "mouse";
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
          // Nothing moves until the threshold is passed, so that a right press
          // meant as a menu does not shift the drawing by the pixel or two a
          // hand adds while a button goes down. Past it the pan is the same
          // incremental one it always was — at most one threshold's worth of
          // travel is dropped, which is invisible and is exactly what the left
          // button's own click/drag split already costs.
          const p = this.panning;
          if (!p.moved && Math.hypot(sx - p.x0, sy - p.y0) > DRAG_THRESHOLD) p.moved = true;
          if (p.moved) {
            const [dx, dy] = [sx - p.sx, sy - p.sy];
            assignView(this.view, p.orbit
              ? orbitBy(this.view, dx * ORBIT_PER_PIXEL, dy * ORBIT_PER_PIXEL)
              : panBy(this.view, dx, dy));
            this.onRenderOnly();
          }
          p.sx = sx;
          p.sy = sy;
        }
        return;
      }
      // The navigation button was let go — which, again, may be reported as a
      // move rather than an up. End the pan and let the event fall through, so
      // a tool still mid-drag picks its gesture straight back up.
      this.canvas.releasePointerCapture?.(this.panning.id);
      const finished = this.panning;
      this.panning = null;
      // A right press that never moved is a menu, and only when nothing else is
      // still held: a right click taken *during* a left drag is not a request
      // to open anything over the gesture it would interrupt.
      if (finished.menu && !finished.moved && e.buttons === 0) {
        this.onContextMenu(this.pickAt(sx, sy), sx, sy);
        return;
      }
      if (kind === "up") return; // ...unless this was the release itself
    } else if (navHeld) {
      // Only the right button can end in a menu. The middle stays purely
      // navigational — one button that unambiguously means "move the view" is
      // worth keeping, and it is the button Onshape pans with anyway.
      const menu = (e.buttons & RIGHT_BUTTON) !== 0 && (e.buttons & MIDDLE_BUTTON) === 0;
      // The right button turns a 3D view — Onshape's right-drag — and pans a
      // 2D one, which has nothing to turn. The middle button always pans.
      const orbit = menu && this.model.dim === 3;
      this.panning = { id: e.pointerId, sx, sy, x0: sx, y0: sy, moved: false, menu, orbit };
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
      if (kind === "move") this.armedUnder = this.pickAt(sx, sy);
      this.cursorAt = [sx, sy];
    } else {
      this.armedUnder = null;
      this.cursorAt = null;
      if (kind === "move" && e.buttons === 0) this.updateHover(sx, sy);
    }

    // A second click on a dimension's label opens its value (SolidWorks'
    // double-click), whatever is armed; the second press goes no further.
    if (kind === "down" && e.button === 0 && this.doubleOnLabel(sx, sy, e.timeStamp)) return;

    // The Hand's left press — armed, or Space held over a tool — is taken
    // before the armed tool can see it, and its moves and release follow it
    // here whether or not the Hand is still on: the press decided.
    if (kind === "down" && e.button === 0 && this.handOn) {
      this.idlePress(sx, sy, e.pointerId, "box", true);
      this.canvas.setPointerCapture?.(e.pointerId);
      return;
    }
    if (this.idle?.grab && e.pointerId === this.idle.id) {
      if (kind === "move") this.idleMove(sx, sy);
      else {
        this.canvas.releasePointerCapture?.(e.pointerId);
        this.idleRelease(sx, sy, e.shiftKey);
      }
      return;
    }

    if (this.active) {
      if (kind === "down" && e.button !== 0) return; // the left button is the tool's
      this.toolEvent(kind, sx, sy);
      return;
    }
    this.snap = null;

    // Nothing armed: the left button drags whatever geometry it grabbed, drags
    // a selection box if it grabbed nothing, pans if it grabbed a glyph, and
    // picks if it never moved at all.
    if (kind === "down" && e.button === 0) {
      this.idlePress(sx, sy, e.pointerId, "box");
      this.canvas.setPointerCapture?.(e.pointerId);
      return;
    }
    if (!this.idle || e.pointerId !== this.idle.id) return;
    if (kind === "move") this.idleMove(sx, sy);
    else {
      this.canvas.releasePointerCapture?.(e.pointerId);
      this.idleRelease(sx, sy, e.shiftKey);
    }
  }

  /**
   * One pointer event for the armed tool: snapped, bracketed, delivered. The
   * mouse's left button and a finger's tap or drag both come here, so a tool
   * cannot tell which hand it is under — only the snap's reach differs.
   */
  private toolEvent(kind: "down" | "move" | "up", sx: number, sy: number): void {
    const tool = this.active!;
    // **A click on a solid's face lands on the face** (docs/plans/
    // click-on-face.md): for a tool that places points, in a 3D model with no
    // sketch plane chosen, the face drawn under the pixel is where the pixel's
    // ray meets it — not the ground behind it — and the tool is told which
    // face (`PointerInfo.face`), so a point it places there is held to it.
    // With a sketch plane chosen every click lands on that plane, whatever is
    // under it (case 1, sketch-mode.md), and this is not asked.
    const chosen = chosenPlane(this.model);
    const landing = tool.snaps && this.model.dim === 3 && chosen === null ? this.landingAt(sx, sy) : null;
    this.landing = landing ? { ...landing, at: [sx, sy] } : null;
    // The tool is handed a *snapped* world coordinate, and the snap that
    // produced it. A tool that only reads `world` behaves exactly as it did
    // before — it is about its own gesture, not about how precise the cursor
    // is. A tool that places points reads `snap` too, and applies the
    // constraint the user was aiming for (see place.ts). Inference is
    // downstream of snapping, so `snapping(false)` turns off both.
    // Only places on the sketch plane are offered while there is one — see
    // findSnap for the stack of geometry a square-on view hides behind it —
    // and, with a face under the pixel, only places on the face: its edges
    // and vertices and what lies in it, never a ground entity behind it. A
    // snap to a vertex or an edge of the face still wins over the face.
    // A tool that chooses regions rather than places points opts out
    // (`Tool.snaps`), and gets neither the pull nor the marker.
    this.snap = this.snapping && tool.snaps
      ? findSnap(this.model, this.view, sx, sy, landing?.plane ?? chosen, this.occlusion, this.reach) : null;
    // The plane is reported even when a snap moved the point off it: it is
    // what the gesture is being drawn on, and a tool laying out a shape from
    // a snapped corner still lays it out along that plane's axes.
    const at = landing ? { world: screenToPlane(this.view, sx, sy, landing.plane) ?? this.pointAt(sx, sy).world, plane: landing.plane } : this.pointAt(sx, sy);
    const world = this.snap ? this.snap.world : at.world;
    const info: PointerInfo = {
      world,
      screen: [sx, sy],
      ...(this.snap ? { snap: this.snap } : {}),
      ...(at.plane ? { plane: at.plane } : {}),
      ...(landing ? { face: { name: landing.face, flat: landing.flat } } : {}),
    };

    // A press or a release is one thing the user did; a move is part of one.
    // Which of down and up actually commits geometry differs by tool — the
    // rectangle builds nothing until it is released, the line and the fillet
    // commit on the click — so both are bracketed and the host is left to
    // notice that one of them changed nothing.
    if (kind === "move") {
      tool.onMove(info);
      this.onRenderOnly(); // so the snap marker follows
      return;
    }
    this.beginUserAction();
    try {
      if (kind === "down") tool.onDown(info);
      else tool.onUp(info);
    } finally {
      this.endUserAction();
    }
  }

  /**
   * **The face under a pixel, as a place to land on**: the front face drawn
   * there (solidpick.ts's `faceUnder`, the same answer a dimension tool's
   * pick gets), named, with its plane turned to face the viewer. A flat face
   * of a feature the model holds is its own plane, read off the record
   * (solidref.ts) so the click lands exactly where the solid is; a round face
   * (a cylinder's wall), or one only the kernel knows (a fillet's), is the
   * plane of the piece drawn under the pixel — the click lands on what is
   * seen, to the tessellation's accuracy, and nothing holds it (`flat`
   * false). Null off every face, and in the wire view, where no faces are
   * drawn.
   */
  private landingAt(sx: number, sy: number): { face: string; flat: boolean; plane: Plane } | null {
    const under = faceUnder(this.drawnFaces, sx, sy);
    if (!under) return null;
    const toward = viewAxes(this.view).toward;
    const facing = (n: number[]) => (n[0] * toward[0] + n[1] * toward[1] + n[2] * toward[2] >= 0 ? n : n.map((c) => -c));
    const flat = isPlanarFace(this.model, under.name);
    const now = flat ? planeNow(this.model, under.name) : null;
    const n = facing(now ? now.n : under.normal);
    const origin = now ? now.p : under.at;
    const [u, v] = spanOf(n);
    // Named as a relation will hold it: a wall by the entity it is swept from.
    return { face: faceRef(this.model, under.name), flat: now !== null, plane: { origin, u, v } };
  }

  /**
   * A press with nothing armed: what it landed on, and the plan for dragging
   * it, taken now (see `idle`). `onEmpty` is what a press on nothing becomes
   * if it moves — the mouse's box, or a finger's orbit. `hand` is the Hand's
   * press, which pans if it moves whatever it landed on, and so plans no drag.
   */
  private idlePress(sx: number, sy: number, id: number, onEmpty: "box" | "orbit", hand = false): void {
    if (hand) {
      this.idle = { id, sx, sy, x0: sx, y0: sy, moved: false, drag: null, empty: false, onEmpty, grab: true };
      this.cursor();
      return;
    }
    // A press that landed on a glyph grabs nothing *and* is not empty
    // canvas, which is the same statement as the glyph being the top pick
    // tier: it must not be possible to aim at a mark and start either
    // dragging the geometry behind it or a box over it.
    const under = this.pickAt(sx, sy);
    const { world: grab, plane } = this.dragPointAt(sx, sy);
    // A kernel edge drags the entity it was picked in place of, if any — and
    // otherwise nothing: the kernel's edge is derived, and a press on it that
    // moves is a pan (it is not empty canvas, so no box).
    const grabbed = under?.kind === "edge" ? under.under ?? null : under;
    const names = grabbed ? dragGoverns(this.model, grabbed) : [];
    const drag = names.length
      ? { names, origins: names.map((n) => this.model.coords(n).slice(0, grab.length)), grab, ...(plane ? { plane } : {}) }
      : null;
    this.idle = { id, sx, sy, x0: sx, y0: sy, moved: false, drag, empty: under === null, onEmpty, grab: false };
  }

  /** A move of the press `idlePress` took: past the threshold, a drag, a box, an orbit or a pan. */
  private idleMove(sx: number, sy: number): void {
    const idle = this.idle!;
    if (!idle.moved && Math.hypot(sx - idle.x0, sy - idle.y0) > DRAG_THRESHOLD) {
      idle.moved = true;
      // The highlight belongs to looking around, and the drag has taken over.
      if (this.hover) this.hover = null;
    }
    if (idle.moved) {
      // The action opens on the first frame that actually moves geometry, and
      // before that frame is solved — the state to go back to is the one the
      // drag started from, not the one it is already a pixel into. Neither a
      // pan nor a selection box opens one: the view is not the model, and
      // selecting is not editing.
      // The Hand pans from anywhere, in 2D and 3D alike: what is under the
      // press stays under the pointer, and nothing is moved or turned.
      if (idle.grab) assignView(this.view, panBy(this.view, sx - idle.sx, sy - idle.sy));
      else if (idle.drag) { this.beginUserAction(); this.dragTo(sx, sy); }
      else if (idle.empty && idle.onEmpty === "box") this.box = { ax: idle.x0, ay: idle.y0, bx: sx, by: sy };
      else if (idle.empty && this.model.dim === 3) {
        // A finger on nothing turns the drawing, at the right-drag's rate.
        assignView(this.view, orbitBy(this.view, (sx - idle.sx) * ORBIT_PER_PIXEL, (sy - idle.sy) * ORBIT_PER_PIXEL));
      } else assignView(this.view, panBy(this.view, sx - idle.sx, sy - idle.sy));
      this.onRenderOnly();
    }
    // `dragTo` clears `idle` if the model was swapped out mid-gesture, so this
    // is not the redundant check it looks like — without it that swap ends in
    // a TypeError on the next pointer move.
    if (this.idle) {
      this.idle.sx = sx;
      this.idle.sy = sy;
    }
  }

  /**
   * The release of the press `idlePress` took: a pick if it never moved, the
   * box's catch, or the drag's settling solve. `add` is what shift means — a
   * click toggles, a box adds — and a finger's box always has it.
   */
  private idleRelease(sx: number, sy: number, add: boolean): void {
    const { moved, drag, grab } = this.idle!;
    const box = this.box;
    this.idle = null;
    this.box = null;
    if (grab) this.cursor();
    // A still press under Space belongs to no one: the tool under the
    // temporary Hand is not handed a click it never saw the press of, and a
    // selection is no business of a tool's gesture.
    if (!moved && grab && this.active) return;
    if (!moved) {
      const pick = this.pickAt(sx, sy);
      if (pick && this.composing()) this.onPick(pick);
      else if (pick) this.pickInto(pick, add);
      else this.preselect(sx, sy, add);
    } else if (box) {
      // A box is a multi-click: every name it caught goes down the same path
      // a single click's name does — into the command line while a command
      // is being written, into the selection otherwise — so there is one
      // story about what selecting means. An empty box picks nothing, and a
      // plain one that caught nothing empties the selection, as a click on
      // empty canvas does.
      const { rect, mode } = boxFrom(box.ax, box.ay, box.bx, box.by);
      const caught = selectInBox(this.model, this.view, rect, mode, this.occlusion);
      // And a kernel body's edges, by the same two rules (kerneledges.ts).
      const edges = this.composing() ? [] : this.solids?.edgesInBox(rect, mode, this.occlusion) ?? [];
      if (this.composing()) {
        for (const name of caught) {
          const entity = this.model.entities.get(name)!;
          this.onPick({ name, kind: entity.kind, distance: 0 });
        }
      } else if (add) {
        this.selection.add(caught);
        this.selection.addEdges(edges);
      } else {
        this.selection.set(caught);
        this.selection.addEdges(edges);
      }
      this.onRenderOnly(); // the box is gone; the canvas has to stop drawing it
    } else if (drag) {
      // One ordinary solve, through the host's solve path, so the status
      // line reports the settled model rather than a frame of a gesture.
      this.onSolveRender();
    }
    // After the settling solve, so a host taking a snapshot here gets the
    // model as it will stay rather than a frame of the gesture. A no-op for a
    // pick or a pan, neither of which ever opened an action.
    this.endUserAction();
  }

  /** A touch pointer's event, to the recogniser — whose answers arrive at `touchSink`. */
  private finger(kind: "down" | "move" | "up", e: PointerEvent): void {
    const [sx, sy] = this.local(e);
    if (kind === "down") {
      // Each finger keeps the canvas for as long as it is down, wherever it
      // wanders — over a panel included.
      this.canvas.setPointerCapture?.(e.pointerId);
      this.gestures.down(e.pointerId, sx, sy, eventTime(e));
      // When the finger went down, by the event's own stamp: what a double-tap is timed by, so a
      // busy page that delivers the taps late does not split them (`doubleOnLabel`).
      this.touchDownAt = eventTime(e) ?? performance.now();
    } else if (kind === "move") this.gestures.move(e.pointerId, sx, sy, eventTime(e));
    else if (e.type === "pointercancel") this.gestures.cancel(e.pointerId);
    else this.gestures.up(e.pointerId, sx, sy, eventTime(e));
  }

  /**
   * What each recognised gesture does — the finger column of the spec's
   * table, fed down the mouse's paths.
   */
  private touchSink(): GestureSink {
    /** What is under the finger: quiet geometry revealed as a hover reveals it, or the armed tool's snap and preview. */
    const look = (x: number, y: number) => {
      this.contact = [x, y];
      if (this.active) {
        this.armedUnder = this.pickAt(x, y);
        this.toolEvent("move", x, y); // the snap marker and the preview, to the finger
      } else {
        this.hover = this.pickAt(x, y);
        this.onRenderOnly();
      }
    };
    /** No finger on the glass any more: what it revealed goes, the selection stays. */
    const lift = () => {
      this.contact = null;
      this.hover = null;
      this.armedUnder = null;
      if (this.active) this.snap = null;
      this.landing = null;
      this.onRenderOnly();
    };
    return {
      press: look,
      tap: (x, y) => {
        if (this.doubleOnLabel(x, y, this.touchDownAt)) return;
        if (this.active) {
          // A click: the press and the release, in the one place. A tool that
          // finished on the press (a point) is not handed a release it would
          // read as the start of something else.
          const tool = this.active;
          this.toolEvent("down", x, y);
          if (this.active === tool) this.toolEvent("up", x, y);
          return;
        }
        // **A tap toggles once something is selected** — there is no shift on
        // glass, and a selection made one tap at a time has to be able to
        // grow. A tap on empty canvas clears it, as a click does.
        const pick = this.pickAt(x, y);
        const add = this.selection.size > 0;
        if (pick && this.composing()) this.onPick(pick);
        else if (pick) this.pickInto(pick, add);
        else this.preselect(x, y, add);
      },
      dragStart: (x0, y0) => {
        this.hover = null;
        // The Hand: one finger pans from wherever it lands, as two do.
        if (this.handOn) this.idlePress(x0, y0, -1, "orbit", true);
        else if (this.active) {
          // The tool's press lands only now, where the finger first touched —
          // held back while the finger was undecided, so a pinch that began
          // with one finger never handed the tool a press to drop.
          this.touchTool = this.active;
          this.toolEvent("down", x0, y0);
        } else this.idlePress(x0, y0, -1, "orbit");
      },
      drag: (x, y) => {
        if (this.touchTool) {
          if (this.active !== this.touchTool) return; // it finished on the press
          this.contact = [x, y];
          this.armedUnder = this.pickAt(x, y);
          this.toolEvent("move", x, y);
        } else if (this.idle) this.idleMove(x, y);
      },
      dragEnd: (x, y) => {
        const tool = this.touchTool;
        this.touchTool = null;
        if (tool) {
          if (this.active === tool) this.toolEvent("up", x, y);
        } else if (this.idle) this.idleRelease(x, y, false);
      },
      longPress: (x, y) => {
        const pick = this.pickAt(x, y);
        // The menu is about to open over the finger: what the finger revealed,
        // and a tool's mark under it, would be stale behind it.
        this.contact = null;
        this.hover = null;
        this.armedUnder = null;
        if (this.active) this.snap = null;
        this.onRenderOnly();
        this.onContextMenu(pick, x, y);
      },
      boxStart: (x0, y0) => {
        // A box selects, and an armed tool is choosing for itself — the mouse
        // has no box under a tool either. The menu goes; the finger is done
        // until it lifts.
        this.onContextMenuWithdrawn();
        if (this.active) return;
        this.idle = { id: -1, sx: x0, sy: y0, x0, y0, moved: false, drag: null, empty: true, onEmpty: "box", grab: false };
      },
      box: (x, y) => { if (this.idle) this.idleMove(x, y); },
      // A finger's box adds, as a tap toggles: the selection grows by gesture
      // and a tap on empty canvas is what empties it.
      boxEnd: (x, y) => { if (this.idle) this.idleRelease(x, y, true); },
      pinch: (dx, dy, factor, cx, cy) => {
        assignView(this.view, zoomAbout(panBy(this.view, dx, dy), cx, cy, factor));
        this.onRenderOnly();
      },
      abandon: () => {
        // **A second finger drops what the first was doing** — a half-drawn
        // rectangle is not committed. The tool stays armed, afresh, as an undo
        // leaves it (`arm` again: a feature tool `retune`s and keeps its picks,
        // any other is a new instance with no gesture in it). What a tool
        // already committed on the press — a line's second click — stays
        // committed, as it would under a mouse; Undo takes it back.
        const tool = this.touchTool;
        this.touchTool = null;
        const armed = this.armed;
        if (tool && this.active === tool && armed) this.arm(armed.name, armed.options);
        // A press held past the long-press opened the menu; the second
        // finger ends that gesture, so it ends the menu too — as a drag out
        // of the held press does (`boxStart`). Seen under load in the
        // browser: the held finger's menu stayed, and the tap that followed
        // closed it instead of selecting (touch.e2e.ts, the quiet corner).
        this.onContextMenuWithdrawn();
        if (this.idle) {
          // A drag is settled rather than dropped, for `cancel`'s reasons; a
          // box and an orbit are simply over.
          const settle = this.idle.moved && this.idle.drag !== null
            && this.idle.drag.names.every((n) => this.model.entities.has(n));
          this.idle = null;
          this.box = null;
          this.cursor();
          if (settle) this.onSolveRender();
          this.endUserAction();
        }
        lift();
      },
      end: lift,
    };
  }

  /** A click with nothing armed on an entity or a glyph, while no command is being written: see `selection`. */
  private pickInto(pick: Pick, shift: boolean): void {
    const name = pick.name;
    if (pick.kind === "edge") {
      // A kernel edge is selected as an edge (selection.ts), not a name the model has.
      if (shift) this.selection.toggleEdge(name);
      else this.selection.onlyEdge(name);
    } else if (shift) this.selection.toggle(name);
    else this.selection.only(name);
    this.onRenderOnly();
  }

  /**
   * A click with nothing armed that landed on no entity: inside a region, it
   * selects that region alone — or, shifted, adds or drops it, the names
   * selected staying; on empty canvas, it clears the selection. See
   * `selection`.
   */
  private preselect(sx: number, sy: number, shift: boolean): void {
    let hit: RegionHit | null = null;
    try {
      hit = this.regionAt(sx, sy);
    } catch {
      hit = null; // a drawing whose loops cannot be found has none to select
    }
    if (!hit) {
      if (this.selection.clear()) this.onRenderOnly();
      return;
    }
    if (shift) this.selected.flip(this.model, hit);
    else {
      this.selection.set([]);
      this.selected.only(hit);
    }
    this.onRenderOnly();
  }

  /**
   * One frame of a kinematic drag: solve the model as it stands with a
   * temporary pull on each grabbed point toward where the cursor has carried
   * it, and leave the result in place.
   *
   * **The gesture is a translation, expressed as a target rather than as a
   * move.** Every grabbed point is pulled toward its own grab-time position
   * plus the offset the cursor has travelled since the press, so the whole
   * entity *wants* to arrive rigidly displaced — and what actually happens to
   * it is whatever the constraints permit. Drag an edge of a constrained
   * rectangle and the rectangle follows; drag one held by a `fix` and it
   * strains toward the cursor without breaking anything. A single point is the
   * same statement with one pull, which is why there is one code path: the
   * offset form also means a point grabbed a few pixels off-centre does not
   * jump to the cursor as the drag starts.
   *
   * Rotation is deliberately not attempted. A rigid rotation would need a
   * second degree of freedom the gesture does not carry, and translation plus
   * the solver already reproduces what Onshape does with the same drag.
   *
   * The pulls are `extra`, not stored residuals, so they exist for this solve
   * and no other — the model never contains "this point wants to be under the
   * cursor", which stops being true the moment the cursor moves. Nothing is
   * journalled either: a drag changes coordinates, and coordinates already
   * ride along in a saved file.
   *
   * The report is deliberately ignored. Mid-drag the header does not churn:
   * a cursor held past what the constraints allow leaves the model a little
   * out of true for as long as it is held, and flashing CONFLICT through a
   * gesture that is about to settle correctly would be noise. Release is what
   * asks for the truth.
   *
   * A frame that would **collapse** something (a side folded to nothing to
   * keep a par and a perp both true) stops where the last frame was, for the
   * part that would fold (`Model.solveFrame`; docs/plans/conflict-detection.md).
   */
  private dragTo(sx: number, sy: number): void {
    const plan = this.idle?.drag;
    if (!plan) return;
    // A file opened mid-gesture swaps the model out from under this. The action
    // is closed here too: a gesture that is abandoned rather than released must
    // still balance its `before`, or a host bracketing it waits forever.
    if (!plan.names.every((n) => this.model.entities.has(n))) {
      this.idle = null;
      this.endUserAction();
      return;
    }
    // No snapping: a drag goes to where the cursor actually is. Onshape infers
    // while dragging; that is a follow-up, deliberately not this.
    //
    // In 3D the cursor is read on the plane the press was read on, for the
    // whole gesture — so the offset lies in that plane and the grabbed points
    // move parallel to it, which is the drag's whole 3D story. Fixed at the
    // press rather than re-read, so that nothing which moves mid-gesture — a
    // frame being dragged, a view turned with the other hand — can tip the
    // plane the arithmetic is done in.
    const world = (plan.plane && screenToPlane(this.view, sx, sy, plan.plane)) || this.screenToWorld(sx, sy);
    const offset = world.map((w, i) => w - plan.grab[i]);
    const targets = plan.names.map((n, k) => plan.origins[k].map((c, i) => c + offset[i]));
    // A point a *frame* is built out of is moved outright before the solve
    // rather than only pulled at. See `movesDatum` for why a pull alone cannot
    // shift one.
    plan.names.forEach((n, k) => { if (this.movesDatum(n)) this.moveOutright(n, targets[k]); });
    const extra = plan.names.flatMap((n, k) => pullTo(this.model, n, targets[k]));
    this.model.solveFrame(extra);
  }

  /**
   * Whether dragging `name` moves a **datum** — a point some frame reads.
   *
   * These have to be moved outright, and the reason is a direct consequence of
   * the decision that a frame is read and never pushed (see
   * `relations/frameBasis`). A `hor(line, frame)` residual does not declare the
   * frame's points among its variables, so the Jacobian has no row saying "turn
   * the frame and the line must follow". The damped solve then keeps a step
   * only if it lowers the *total* residual — and turning the frame a hair
   * raises every levelled edge's residual by the edge's whole length times that
   * angle, where the drag's own weak pull can only lower its own row by a
   * fraction of it. Every step is rejected, lambda runs away, and the frame
   * simply does not move: measured at three thousandths of a degree against a
   * drag that asked for twenty-six degrees.
   *
   * Which is not a bug in the datum decision but its other half. A datum is
   * moved *by the user*, and the drawing follows; the solver never gets a
   * vote on where it goes. So the drag assigns the position and the same solve
   * then carries the drawing to it — one Gauss-Seidel sweep, exactly the cost
   * `frameBasis` says this trade costs.
   *
   * The weak pull is still applied on top, and still does its ordinary work:
   * if the point is *also* an ordinary part of the drawing (a frame's origin
   * that is also a rectangle's corner), the relations naming it do declare it,
   * they win the solve as they always did, and the gesture degrades gracefully
   * to the kinematic drag everything else gets.
   */
  private movesDatum(name: string): boolean {
    return this.model.dependents(name).some((e) => e.kind === "frame");
  }

  /** Puts a point where the drag asks, with no journal entry — as a seed does. */
  private moveOutright(name: string, world: number[]): void {
    const idx = this.model.point(name).varIndices;
    world.forEach((v, i) => this.model.problem.setVar(idx[i], v));
  }

  private updateHover(sx: number, sy: number): void {
    const next = this.pickAt(sx, sy);
    if (next?.name === this.hover?.name) return;
    this.hover = next;
    this.onRenderOnly();
  }

  /**
   * Call after clearing the canvas each frame — draws whatever gesture is in
   * progress: the active tool's live preview, or the selection box. Never
   * both, since a box only ever happens with nothing armed.
   */
  renderOverlay(): void {
    this.renderBox();
    const r: RenderContext = {
      g: this.g, worldToScreen: (w) => this.worldToScreen(w), scale: this.view.scale, toward: viewAxes(this.view).toward,
      ui: uiOf(this.view),
    };
    // Regions made and standing ready, under whatever a tool draws.
    drawStandingRegions(this.model, r);
    if (!this.active) {
      // The canvas's selected regions, in the selection's own colour — the
      // entities beside them wear it too (main.ts) — and not in an armed
      // tool's green: a tool armed from them shows them in its green, picked.
      if (this.selected.size) {
        for (const region of this.selected.refresh(this.model)) drawRegion(this.model, r, region, "40", SELECTION);
      }
      return;
    }
    // A tool starts on a solid line. Dashes mean selection (the crossing box
    // below), so a shape being drawn must never inherit them from whatever the
    // context drew last; a tool that wants a dashed guide sets one itself.
    this.g.save();
    this.g.setLineDash([]);
    // The face the next click lands on, lit under the tool's own preview: the
    // preview is what the click builds, and belongs on top of where.
    this.renderLandingFace(r);
    this.active.render(r);
    this.g.restore();
    this.renderSnapMarker();
    if (this.contact) this.renderLift();
    else this.renderGhost();
    this.renderLandingName();
  }

  /**
   * **The face the next click lands on, lit** (docs/plans/click-on-face.md;
   * the owner: *"it should come up with an on-plane constraint indicator
   * before i click (and highlight the plane i am hovering over)"*): filled
   * faintly in the hover's amber only in the cells where it is in front
   * (solidpick.ts's `faceShade`, as the dimension tool lights a face), its
   * edges in sight stroked. The name goes beside the hand (`renderLandingName`).
   */
  private renderLandingFace(r: RenderContext): void {
    const land = this.landing;
    if (!land || !this.active) return;
    const { cells, runs } = faceShade(this.drawnFaces, faceKernelNames(this.model, land.face), this.view);
    if (!cells.length && !runs.length) return;
    const g = this.g;
    const k = r.ui ?? 1;
    g.save();
    g.beginPath();
    for (const [x, y] of cells) g.rect(x, y, SHADE_PX, SHADE_PX);
    g.globalAlpha = LANDING_FILL_ALPHA;
    g.fillStyle = LANDING_INK;
    g.fill();
    g.globalAlpha = 1;
    g.strokeStyle = LANDING_INK;
    g.lineWidth = 1.5 * k;
    g.beginPath();
    for (const run of runs) run.forEach(([x, y], i) => (i === 0 ? g.moveTo(x, y) : g.lineTo(x, y)));
    g.stroke();
    g.restore();
  }

  /**
   * **The on-plane mark and the face's name beside the hand** — `▱ e1:l2`,
   * the glyph the relation the click makes will wear (glyphs.ts), so what is
   * about to be held is said in the drawing's own sign; a round face is named
   * without the mark, since nothing holds a point to it, and says so. Above
   * and right of the mouse's ghost, clear of the hover tag's corner; by a
   * finger, right of the lifted mark (or left of it at the canvas's edge),
   * under the snap's own words where there are any — the finger covers what
   * is under it, and the lifted mark is already where the eye is.
   */
  private renderLandingName(): void {
    const land = this.landing;
    if (!land || !this.active) return;
    const g = this.g;
    const k = uiOf(this.view);
    // A face no point can be held to — round, or only the kernel's — is named
    // without the mark, and says so: the click will land, and hold nothing.
    const text = land.flat ? `▱ ${land.face}` : `${land.face} · not held`;
    g.save();
    g.font = `${11 * k}px "IBM Plex Mono", ui-monospace, Menlo, monospace`;
    // A dark rim under the words, as a point's name wears over a light face
    // (main.ts): amber on a pale lid was faint at a desktop's size.
    g.strokeStyle = "#0a0e13";
    g.lineWidth = 3 * k;
    g.lineJoin = "round";
    g.fillStyle = LANDING_INK;
    const write = (x: number, y: number) => { g.strokeText(text, x, y); g.fillText(text, x, y); };
    const width = this.canvas.getBoundingClientRect().width;
    if (this.contact) {
      // Beside the lifted mark (`renderLift`): the same disc, the same side rule.
      const [px, py] = this.snap ? this.snap.screen : this.contact;
      const disc = 13 * k;
      const ly = py - LIFT >= 16 ? py - LIFT : py + LIFT;
      const gap = disc + 4 * k;
      const right = px + gap + g.measureText(text).width <= width - 4;
      g.textAlign = right ? "left" : "right";
      g.textBaseline = "middle";
      // The snap's words sit on the disc's line; this goes on the line below them.
      write(right ? px + gap : px - gap, this.snap ? ly + 14 * k : ly);
    } else {
      const [x, y] = this.snap ? this.snap.screen : land.at;
      const right = x + 10 * k + g.measureText(text).width <= width - 4;
      g.textAlign = right ? "left" : "right";
      g.textBaseline = "bottom";
      write(right ? x + 10 * k : x - 10 * k, y - 9 * k);
    }
    g.restore();
  }

  /**
   * **The point about to be placed, at the mouse** — a ghost of the dot a
   * click will put there, in the tools' green: the mouse's half of the lifted
   * mark a finger gets, so every placing tool shows where its next point lands
   * before the click (docs/plans/mode-feedback.md). Only for a tool that
   * places points (`snaps`), only while nothing is snapped — the snap marker
   * is the ghost then, and says more — and never while a press would pan.
   */
  private renderGhost(): void {
    if (!this.active?.snaps || this.snap || !this.cursorAt || this.handOn) return;
    const [x, y] = this.cursorAt;
    const k = uiOf(this.view);
    const g = this.g;
    g.save();
    g.setLineDash([]);
    g.globalAlpha = 0.45;
    g.fillStyle = GHOST;
    g.beginPath();
    g.arc(x, y, 3.5 * k, 0, Math.PI * 2);
    g.fill();
    g.globalAlpha = 0.9;
    g.strokeStyle = GHOST;
    g.lineWidth = 1.2;
    g.beginPath();
    g.arc(x, y, 6 * k, 0, Math.PI * 2);
    g.stroke();
    g.restore();
  }

  /**
   * The selection box, drawn so its *mode* is readable at a glance and without
   * having to remember which way you dragged: a window is a solid blue edge, a
   * crossing a dashed green one. Those are SolidWorks' colours and Onshape's
   * dash, and the two differ in three ways at once — line style, hue and fill
   * tint — because one difference is easy to miss mid-gesture and the two
   * modes select genuinely different things.
   */
  private renderBox(): void {
    if (!this.box) return;
    const { rect, mode } = boxFrom(this.box.ax, this.box.ay, this.box.bx, this.box.by);
    const g = this.g;
    g.save();
    if (mode === "window") {
      g.fillStyle = "#5a96dc22";
      g.strokeStyle = "#6fa8dc";
    } else {
      g.fillStyle = "#55c07a22";
      g.strokeStyle = "#7cc47f";
      g.setLineDash([5, 4]);
    }
    g.lineWidth = 1.2;
    g.fillRect(rect.x0, rect.y0, rect.x1 - rect.x0, rect.y1 - rect.y0);
    g.strokeRect(rect.x0, rect.y0, rect.x1 - rect.x0, rect.y1 - rect.y0);
    g.restore();
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
    const k = uiOf(this.view);
    g.save();
    g.strokeStyle = "#55c07a";
    g.lineWidth = 1.6;
    g.beginPath();
    if (this.snap.kind === "projected") {
      // A point off the sketch, offered at its projection: the point marker's
      // square, but **hollow** — dashed and inset by a ring, so it reads as a
      // ghost of a vertex rather than a vertex — and a faint dashed leader back
      // to the real point when the two are apart on screen, so it is plain
      // what is being borrowed and from where. It infers nothing, and the
      // marker must not look like a snap that does.
      g.setLineDash([2.5, 2]);
      g.rect(x - 6 * k, y - 6 * k, 12 * k, 12 * k);
      g.stroke();
      g.setLineDash([]);
      g.beginPath();
      g.arc(x, y, 1.6 * k, 0, Math.PI * 2);
      g.stroke();
      const from = this.model.entities.has(this.snap.targets[0]) ? this.model.coords(this.snap.targets[0]) : null;
      const [fx, fy] = from ? this.worldToScreen(from) : [x, y];
      if (Math.hypot(fx - x, fy - y) > 3) {
        g.globalAlpha = 0.55;
        g.lineWidth = 1;
        g.setLineDash([3, 3]);
        g.beginPath();
        g.moveTo(x, y);
        g.lineTo(fx, fy);
        g.stroke();
      }
      g.restore();
      return;
    }
    traceMark(g, this.snap.kind, x, y, k);
    g.stroke();
    g.restore();
  }

  /**
   * **The active point, lifted clear of the finger.** Under a finger the snap
   * marker and the tool's point are exactly where the fingertip is, and so are
   * the one thing on screen the hand hides. So while a finger is down with a
   * tool armed, a copy of the mark — the snap's shape and what it caught, or a
   * cross where nothing was caught — is drawn `LIFT` pixels above the point on
   * a dark disc, with a dotted leader down to where the point really is (below
   * it instead, where there is no room above).
   *
   * A lifted mark rather than a loupe, deliberately. A loupe magnifies the
   * picture, and the picture here is two canvases — the faces in WebGL, which
   * keeps no copy of its last frame to read back, under the drawing — so a
   * loupe would either show the sketch without the solid or cost a second
   * render of the faces on every move. And what the hand needs under a finger
   * is not a bigger picture but the answer to *where will it land, and on
   * what*: the mark's shape says which kind of place, the label names it, and
   * the leader says where.
   */
  private renderLift(): void {
    if (!this.active) return;
    const [cx, cy] = this.contact!;
    const [px, py] = this.snap ? this.snap.screen : [cx, cy];
    // The disc, its mark and its words are drawn for the eye and scale with
    // the interface; how far above the finger it floats is the finger's, and
    // does not.
    const k = uiOf(this.view);
    const disc = 13 * k;
    const above = py - LIFT >= 16;
    const [lx, ly] = [px, above ? py - LIFT : py + LIFT];
    const g = this.g;
    g.save();
    g.strokeStyle = "#55c07a";
    g.lineWidth = 1;
    g.globalAlpha = 0.7;
    g.setLineDash([2, 3]);
    g.beginPath();
    g.moveTo(px, py);
    g.lineTo(lx, above ? ly + disc : ly - disc);
    g.stroke();
    g.globalAlpha = 1;
    g.setLineDash([]);
    g.fillStyle = "#0a0e13d9";
    g.beginPath();
    g.arc(lx, ly, disc, 0, Math.PI * 2);
    g.fill();
    g.strokeStyle = "#223041";
    g.stroke();
    g.strokeStyle = "#55c07a";
    g.lineWidth = 1.6;
    g.beginPath();
    if (this.snap) {
      if (this.snap.kind === "projected") g.setLineDash([2.5, 2]);
      traceMark(g, this.snap.kind, lx, ly, k);
    } else {
      g.moveTo(lx - 6 * k, ly); g.lineTo(lx + 6 * k, ly);
      g.moveTo(lx, ly - 6 * k); g.lineTo(lx, ly + 6 * k);
    }
    g.stroke();
    if (this.snap) {
      g.setLineDash([]);
      g.font = `${11 * k}px "IBM Plex Mono", ui-monospace, Menlo, monospace`;
      g.fillStyle = "#55c07a";
      g.textBaseline = "middle";
      const text = describeSnap(this.snap);
      // Right of the disc, or left of it where the right would run off.
      const gap = disc + 4 * k;
      const right = lx + gap + g.measureText(text).width <= this.canvas.getBoundingClientRect().width - 4;
      g.textAlign = right ? "left" : "right";
      g.fillText(text, right ? lx + gap : lx - gap, ly);
    }
    g.restore();
  }
}

/**
 * The path of a snap marker's shape at (x, y): a square for an existing point
 * (and for a projected one, which the caller dashes), an x where two curves
 * cross, a triangle for a midpoint, a circle along a curve. Traced, not
 * stroked, so the marker and its lifted copy share one drawing of each kind.
 */
function traceMark(g: CanvasRenderingContext2D, kind: SnapKind, x: number, y: number, k = 1): void {
  const [a, b] = [5 * k, 6 * k];
  if (kind === "point" || kind === "projected") {
    g.rect(x - a, y - a, 2 * a, 2 * a); // a square: an exact, existing point
  } else if (kind === "intersection") {
    // An x: two curves crossing, drawn as the thing itself.
    g.moveTo(x - a, y - a); g.lineTo(x + a, y + a);
    g.moveTo(x + a, y - a); g.lineTo(x - a, y + a);
  } else if (kind === "midpoint") {
    g.moveTo(x, y - b); // a triangle: derived, but still an exact position
    g.lineTo(x + b, y + a);
    g.lineTo(x - b, y + a);
    g.closePath();
  } else {
    g.arc(x, y, a, 0, Math.PI * 2); // a circle: somewhere along a curve
  }
}

/**
 * When a pointer event happened, in `performance.now()`'s timebase — the
 * recogniser's clock — or undefined where the browser's timestamp is not that
 * (an old engine's epoch milliseconds, or none), so the recogniser falls back
 * to the time it handles the event. See gestures.ts's `LATE_MS`.
 */
export function eventTime(e: { timeStamp: number }): number | undefined {
  const t = e.timeStamp;
  return Number.isFinite(t) && t > 0 && t <= performance.now() + 1 ? t : undefined;
}
