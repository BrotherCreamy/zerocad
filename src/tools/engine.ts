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
//
// With nothing armed the left button has three meanings, decided by what the
// press landed on and whether it moved: **any geometry drags** — a point, an
// edge, a rim — empty canvas draws a selection box (see ../boxselect.ts), and
// a press that never moved picks. Both of the first two used to pan, which was
// cellwork's habit; both ancestor CADs box-select on empty canvas and drag the
// geometry everywhere else, and the standing rule is that tools work like
// Onshape, so they do here too. Panning did not lose anything by either change
// — it keeps the middle and right buttons and `pan()`.
//
// The one press that still pans on the left button is one that landed on a
// constraint glyph, which is UI rather than geometry: it grabs nothing, so
// there is nothing for it to drag, and it is not empty canvas either, so it
// must not box.
//
// The right button now splits the same way the left one does, and by the same
// rule: **the press decides nothing, the release does.** Past the drag
// threshold it is a pan, exactly as it always was; released without moving it
// is a context menu (see ../menu.ts) for whatever it landed on. Middle-drag is
// untouched and never opens anything — one button that is unambiguously
// navigation is worth keeping.

import type { Model } from "../model.ts";
import type { ResidualBlock } from "../kernel/problem.ts";
import { getToolCtor, type Tool, type ToolContext, type PointerInfo, type RenderContext } from "./tool.ts";
import { assignView, panBy, screenToWorld, worldToScreen, zoomAbout, type View } from "../view.ts";
import { hitTest, type Pick } from "../picking.ts";
import { boxFrom, selectInBox, type BoxMode } from "../boxselect.ts";
import { glyphAt, placeGlyphs, type Glyph } from "../glyphs.ts";
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
 * Only as many coordinates as the viewport supplied are pulled, so in a 3D
 * model dragging moves the point within the plane the viewport is drawing and
 * leaves the depth alone — which is the only thing a 2D cursor can honestly
 * mean.
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
  private onUserAction: (phase: "before" | "after") => void;
  private onLog?: (line: string) => void;
  private onContextMenu: (pick: Pick | null, sx: number, sy: number) => void;
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
   * where it started, whether it has passed the threshold, and whether it is
   * the *right* button — the only one a context menu can come out of.
   *
   * `x0`/`y0`/`moved` are the same split the left button has always made
   * between a click and a drag, applied to the right button so that a press and
   * release in the same place can mean something other than a zero-length pan.
   * Reusing DRAG_THRESHOLD rather than inventing a second number is the point:
   * one hand, one idea of what "did not move" means.
   */
  private panning:
    | { id: number; sx: number; sy: number; x0: number; y0: number; moved: boolean; menu: boolean }
    | null = null;
  /**
   * A left press with no tool armed. What it becomes depends on what it landed
   * on and whether it moves: a press on *geometry* that moves drags it, a press
   * on *empty canvas* that moves drags a selection box, a press on a constraint
   * glyph that moves pans, and a press that does not move picks.
   *
   * `drag` is the plan for the first of those — which points the grabbed
   * entity is made of and where each of them was when it was grabbed, plus the
   * world position of the press itself. `empty` records that the press landed
   * on nothing at all.
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
    drag: { names: string[]; origins: number[][]; grab: number[] } | null;
    empty: boolean;
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
   * Where the cursor is being treated as being, while a tool is drawing.
   * Null when nothing is near enough to snap to, or when no tool is armed —
   * snapping is for placing geometry, not for looking around.
   */
  snap: Snap | null = null;
  /** Set false to place coordinates exactly where the cursor is. */
  snapping = true;
  /**
   * Whether the constraint glyphs are drawn and pickable. On by default, as in
   * an Onshape sketch: the feature exists so a constraint nobody typed
   * announces itself, and a switch you have to know to flick cannot do that.
   */
  glyphsOn = true;

  constructor(
    model: Model,
    canvas: HTMLCanvasElement,
    view: View,
    callbacks: {
      onSolveRender: () => void;
      onRenderOnly: () => void;
      /** An entity was clicked with no tool armed. */
      onPick?: (pick: Pick) => void;
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
      onLog?: (line: string) => void;
      /**
       * A right press released without moving, with what it landed on (null for
       * empty canvas) and where, in canvas pixels.
       *
       * Named for the gesture rather than for the menu, the way `onUserAction`
       * is named for the gesture rather than for undo: the engine reports what
       * only it can see and holds no opinion about what a host does with it. A
       * host with no menu passes nothing and the right button keeps panning and
       * nothing else, which is what every test written before this existed
       * assumes.
       */
      onContextMenu?: (pick: Pick | null, sx: number, sy: number) => void;
    },
  ) {
    this.model = model;
    this.canvas = canvas;
    this.view = view;
    this.g = canvas.getContext("2d")!;
    this.onSolveRender = callbacks.onSolveRender;
    this.onRenderOnly = callbacks.onRenderOnly;
    this.onPick = callbacks.onPick ?? (() => {});
    this.onUserAction = callbacks.onUserAction ?? (() => {});
    this.onLog = callbacks.onLog;
    this.onContextMenu = callbacks.onContextMenu ?? (() => {});
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

  screenToWorld(sx: number, sy: number): number[] {
    return screenToWorld(this.view, sx, sy);
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
  glyphs(): Glyph[] {
    return this.glyphsOn ? placeGlyphs(this.model, this.view) : [];
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
    const gl = glyphAt(this.glyphs(), sx, sy);
    if (gl) return { name: gl.relation, kind: "relation", distance: 0 };
    return hitTest(this.model, this.view, sx, sy);
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
      log: this.onLog,
    };
    this.active = new Ctor(ctx);
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
    const wasDragging = this.idle?.moved === true && this.idle.drag !== null
      && this.idle.drag.names.every((n) => this.model.entities.has(n));
    this.idle = null;
    this.box = null;
    this.snap = null;
    if (wasDragging) this.onSolveRender();
    else this.onRenderOnly();
    this.endUserAction();
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
          // Nothing moves until the threshold is passed, so that a right press
          // meant as a menu does not shift the drawing by the pixel or two a
          // hand adds while a button goes down. Past it the pan is the same
          // incremental one it always was — at most one threshold's worth of
          // travel is dropped, which is invisible and is exactly what the left
          // button's own click/drag split already costs.
          const p = this.panning;
          if (!p.moved && Math.hypot(sx - p.x0, sy - p.y0) > DRAG_THRESHOLD) p.moved = true;
          if (p.moved) {
            assignView(this.view, panBy(this.view, sx - p.sx, sy - p.sy));
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
      this.panning = { id: e.pointerId, sx, sy, x0: sx, y0: sy, moved: false, menu };
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

      // A press or a release is one thing the user did; a move is part of one.
      // Which of down and up actually commits geometry differs by tool — the
      // rectangle builds nothing until it is released, the line and the fillet
      // commit on the click — so both are bracketed and the host is left to
      // notice that one of them changed nothing.
      const tool = this.active;
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
      return;
    }
    this.snap = null;

    // Nothing armed: the left button drags whatever geometry it grabbed, drags
    // a selection box if it grabbed nothing, pans if it grabbed a glyph, and
    // picks if it never moved at all.
    if (kind === "down" && e.button === 0) {
      // A press that landed on a glyph grabs nothing *and* is not empty
      // canvas, which is the same statement as the glyph being the top pick
      // tier: it must not be possible to aim at a mark and start either
      // dragging the geometry behind it or a box over it.
      const under = this.pickAt(sx, sy);
      const grab = this.screenToWorld(sx, sy);
      const names = under ? dragGoverns(this.model, under) : [];
      const drag = names.length
        ? { names, origins: names.map((n) => this.model.coords(n).slice(0, grab.length)), grab }
        : null;
      this.idle = { id: e.pointerId, sx, sy, x0: sx, y0: sy, moved: false, drag, empty: under === null };
      this.canvas.setPointerCapture?.(e.pointerId);
      return;
    }
    if (!this.idle || e.pointerId !== this.idle.id) return;
    if (kind === "move") {
      if (!this.idle.moved && Math.hypot(sx - this.idle.x0, sy - this.idle.y0) > DRAG_THRESHOLD) {
        this.idle.moved = true;
        // The highlight belongs to looking around, and the drag has taken over.
        if (this.hover) this.hover = null;
      }
      if (this.idle.moved) {
        // The action opens on the first frame that actually moves geometry, and
        // before that frame is solved — the state to go back to is the one the
        // drag started from, not the one it is already a pixel into. Neither a
        // pan nor a selection box opens one: the view is not the model, and
        // selecting is not editing.
        if (this.idle.drag) { this.beginUserAction(); this.dragTo(sx, sy); }
        else if (this.idle.empty) this.box = { ax: this.idle.x0, ay: this.idle.y0, bx: sx, by: sy };
        else assignView(this.view, panBy(this.view, sx - this.idle.sx, sy - this.idle.sy));
        this.onRenderOnly();
      }
      // `dragTo` clears `idle` if the model was swapped out mid-gesture, so this
      // is not the redundant check it looks like — without it that swap ends in
      // a TypeError on the next pointer move.
      if (this.idle) {
        this.idle.sx = sx;
        this.idle.sy = sy;
      }
    } else {
      this.canvas.releasePointerCapture?.(e.pointerId);
      const { moved, drag } = this.idle;
      const box = this.box;
      this.idle = null;
      this.box = null;
      if (!moved) {
        const pick = this.pickAt(sx, sy);
        if (pick) this.onPick(pick);
      } else if (box) {
        // A box is a multi-click: every name it caught goes down the same path
        // a single click's name does, so there is one story about what
        // selecting means and one place that implements it. An empty box picks
        // nothing and therefore inserts nothing.
        const { rect, mode } = boxFrom(box.ax, box.ay, box.bx, box.by);
        for (const name of selectInBox(this.model, this.view, rect, mode)) {
          const entity = this.model.entities.get(name)!;
          this.onPick({ name, kind: entity.kind, distance: 0 });
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
    const world = this.screenToWorld(sx, sy);
    const offset = world.map((w, i) => w - plan.grab[i]);
    const targets = plan.names.map((n, k) => plan.origins[k].map((c, i) => c + offset[i]));
    // A point a *frame* is built out of is moved outright before the solve
    // rather than only pulled at. See `movesDatum` for why a pull alone cannot
    // shift one.
    plan.names.forEach((n, k) => { if (this.movesDatum(n)) this.moveOutright(n, targets[k]); });
    const extra = plan.names.flatMap((n, k) => pullTo(this.model, n, targets[k]));
    this.model.problem.solve({ extra });
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
    if (!this.active) return;
    const r: RenderContext = { g: this.g, worldToScreen: (w) => this.worldToScreen(w) };
    this.active.render(r);
    this.renderSnapMarker();
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
    g.save();
    g.strokeStyle = "#55c07a";
    g.lineWidth = 1.6;
    g.beginPath();
    if (this.snap.kind === "point") {
      g.rect(x - 5, y - 5, 10, 10); // a square: an exact, existing point
    } else if (this.snap.kind === "intersection") {
      // An x: two curves crossing, drawn as the thing itself.
      g.moveTo(x - 5, y - 5); g.lineTo(x + 5, y + 5);
      g.moveTo(x + 5, y - 5); g.lineTo(x - 5, y + 5);
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
