// The most basic tool in any sketcher, and somehow the last one built here:
// click, click, and there is a line. Shaped like Onshape's, because a line
// tool is the first thing anyone reaches for and there is nothing to gain by
// being different.
//
// **Chaining.** The end of a committed segment *is* the start of the next one
// — the same point entity, not a copy joined by a constraint. There is nothing
// to infer between them: they are literally one vertex, exactly as chained
// segments are in Onshape. Escape (or anything else that cancels the tool)
// ends the chain and leaves what was committed.
//
// **Nothing is committed on the first click.** A chain that is abandoned
// before its second click leaves no stray point behind, which is the same
// reason rectangle.ts builds nothing until onUp.
//
// **Axis inference, and only against a frame somebody chose.** While the
// preview is within a few degrees of one of the default frame's axes it is
// drawn exactly on that axis, with a guide, and the committed line gets
// `par(line, "f.x")` or `par(line, "f.y")` — the *line* form, so the
// constraint still means "this edge is level" after a fillet re-points it.
// (It used to land `hor`/`ver`; those words implied a world frame and are
// gone. Same equation, said against an axis the drawing can name.) An endpoint
// snap beats the axis guess: if the click landed on real geometry, that is
// what was aimed at, and the axis constraint is applied only if the snapped
// position happens to satisfy it anyway.
//
// With **no default frame there is no inference at all**: the drawing has no
// notion of level, so the preview is not pulled anywhere, no guide is drawn
// and nothing is constrained. Inferring against the kernel's own axes — even
// only in the preview — would be the world frame coming back in through the
// side door, and would promise a constraint that never lands.
//
// **The aim, the guide and the constraint are one answer**, read off the
// default frame's own axes. A tilted frame tilts all three together: the
// preview snaps onto the frame's +x, the dashed guide lies along it, and the
// `par` that lands names that same axis. (Half 1 shipped with the first two
// computed against the kernel's axes and only the third against the frame,
// which was invisible while nothing could tilt a frame by hand and wrong the
// moment something could.)
//
// The chain itself is dimension-generic — points and lines are — and so, now,
// is the inference. In 3D the cursor lands on the default frame's own plane
// (see ../workplane.ts), so its offset from the segment's start *is* a vector
// in that plane, and "how far along +x, how far along +y" is two dot products
// — the 2D arithmetic, written so it does not care how many coordinates there
// are. The 3° test is therefore measured in the sketch plane, not on screen:
// seen square-on the two are the same angle, and seen obliquely the plane's
// own angle is the one the constraint that lands will hold.

import { Tool, defineTool, press, type Hand, type PointerInfo, type RenderContext, type How } from "./tool.ts";
import { parallel } from "../relations/geometry.ts";
import { frameBasis } from "../relations/refs.ts";
import { DRAWING_OPTIONS, asArmed, placePoint } from "./place.ts";
import type { OptionSpecs } from "./options.ts";

/** How near an axis the preview has to be, in degrees, to be pulled onto it. */
export const AXIS_DEGREES = 3;
const AXIS_SLOPE = Math.tan((AXIS_DEGREES * Math.PI) / 180);

/** Below this, a click is on top of the segment's start and there is no line to draw. */
const DEGENERATE = 1e-6;

/**
 * How close a snapped endpoint has to be to an axis to still count as on it.
 * Tight on purpose: this is "the snap happened to land level", not a second
 * helping of the 3-degree guess.
 */
const ALREADY_ON_AXIS = 1e-9;

/**
 * Which of the default frame's axes the preview is lined up with, if either.
 * `"x"`/`"y"` rather than `"horizontal"`/`"vertical"`: the words went with the
 * relations, and what is left is genuinely a question about which axis.
 */
type Axis = "x" | "y" | null;

/** Across every coordinate, not just the two a viewport draws. */
function distance(a: number[], b: number[]): number {
  return Math.hypot(...a.map((v, i) => v - b[i]));
}

function dot(a: number[], b: number[]): number {
  return a.reduce((s, v, i) => s + v * b[i], 0);
}

/** Where the segment's far end should go, and which axis constraint that implies. */
interface Aim {
  world: number[];
  axis: Axis;
  /**
   * The world direction the guide lies along — the default frame's own +x or
   * +y, not the canvas's. Carried on the aim rather than recomputed at render
   * time so that what is drawn is provably the same direction the aim was
   * measured against, whatever the frame does between the two.
   */
  along?: number[];
}

export class LineTool extends Tool {
  static readonly options: OptionSpecs = DRAWING_OPTIONS;
  static readonly summary = "Draws lines: click the start, then the end of each in turn";
  static readonly how: How = [
    "{Tap} the start, then the end of each line in turn.",
    "Start or end on a point or a line to join it.",
    { mouse: "Esc ends the chain.", finger: "Cancel (✕) ends the chain." },
  ];
  readonly name = "line";
  /** The first click of a fresh chain — kept whole, so its snap survives to commit. */
  private pending: PointerInfo | null = null;
  /** The committed point the next segment runs from. The chain's shared vertex. */
  private anchor: string | null = null;
  /** Where the far end currently wants to be, axis-corrected, for the preview. */
  private aim: Aim | null = null;
  /** The lines this chain has made: in the accent until the chain ends (`placed`). */
  private chain: string[] = [];

  next(hand: Hand): string {
    // How a chain ends: Escape under a mouse, the action strip's Cancel under a finger.
    if (this.anchor) return `${press(hand)} the next end — ${hand === "finger" ? "Cancel" : "Esc"} ends the chain`;
    if (this.pending) return `${press(hand)} the end`;
    return `${press(hand)} the start`;
  }

  /** The chain so far, its lines and their points: placed, and not finished with until it ends. */
  placed(): readonly string[] {
    const m = this.ctx.model;
    const names = new Set<string>();
    for (const l of this.chain) {
      const e = m.entities.get(l);
      if (e?.kind !== "line") continue;
      names.add(l);
      for (const r of e.refs) names.add(r);
    }
    return [...names];
  }

  onDown(p: PointerInfo): void {
    const from = this.startWorld();
    if (!from) {
      this.pending = p;
      this.aim = { world: p.world, axis: null };
      this.ctx.requestRender();
      return;
    }

    const aim = this.resolve(from, p);
    if (distance(from, aim.world) < DEGENERATE) {
      // A click on top of the segment's own start — including snapping back to
      // the vertex the chain is standing on. Not a segment; ignore it rather
      // than dropping the chain.
      return;
    }

    const m = this.ctx.model;
    // The start is created only now, on the click that gives it a line to
    // belong to — and with its own inference, from the click that aimed it.
    const a = this.anchor ?? placePoint(this.ctx, this.pending!);
    const b = placePoint(this.ctx, { ...p, world: aim.world });
    const line = m.addLine(a, b);
    // Only against a frame the user chose, and named outright rather than left
    // to the default: `resolveFrame` would throw without one, and a tool must
    // not turn a drawing gesture into an error message.
    if (m.defaultFrame && aim.axis) parallel(m, line.name, `${m.defaultFrame}.${aim.axis}`);
    asArmed(this.ctx, line.name);
    this.chain.push(line.name);

    // The committed end becomes the next segment's start: the same entity.
    this.pending = null;
    this.anchor = b;
    // Not null: render() reads the anchor's position for itself, so this keeps
    // the mark on the chain's live vertex drawn between the click and the next
    // move, with a zero-length (invisible) preview off it.
    this.aim = { world: aim.world, axis: null };
    this.ctx.requestSolve();
  }

  onMove(p: PointerInfo): void {
    const from = this.startWorld();
    if (!from) return;
    this.aim = this.resolve(from, p);
    this.ctx.requestRender();
  }

  onCancel(): void {
    this.pending = null;
    this.anchor = null;
    this.aim = null;
    this.chain = [];
    this.ctx.requestRender();
  }

  /** Where the segment being drawn starts, or null if the chain has not begun. */
  private startWorld(): number[] | null {
    if (this.anchor) {
      // Read the point's *current* position: the solve that committed the last
      // segment may well have moved it.
      if (this.ctx.model.entities.has(this.anchor)) return this.ctx.model.coords(this.anchor);
      this.anchor = null; // the model was replaced underneath us
    }
    return this.pending ? this.pending.world : null;
  }

  /**
   * The far end of the segment: the cursor, pulled onto an axis if it is close
   * to one, together with the constraint that implies.
   *
   * A snap wins outright. It means the user pointed at something real, and
   * moving that point onto an axis afterwards would silently undo the aim —
   * so the position stands, and the axis constraint comes along only if the
   * snapped position already satisfies it.
   */
  private resolve(from: number[], p: PointerInfo): Aim {
    const axes = this.axes();
    // No default frame, or one dragged onto its own origin: nothing to be
    // level *with*, so no aim, no guide and no constraint.
    if (!axes) return { world: p.world, axis: null };
    const { ux, uy } = axes;

    // The cursor's offset from the start, read in the frame's coordinates: how
    // far along its +x, and how far along its +y. Every test below is on those
    // two numbers, so all of it turns with the frame — and, in 3D, tilts with
    // it.
    const d = p.world.map((v, i) => v - from[i]);
    if (Math.hypot(...d) < DEGENERATE) return { world: p.world, axis: null }; // no direction to read
    const along = dot(d, ux);
    const across = dot(d, uy);
    const on = (u: number[], t: number) => from.map((f, i) => f + u[i] * t);

    if (p.snap) {
      // A snap wins outright, and the constraint comes along only if the
      // snapped position already satisfies it — measured in the frame, so a
      // snap that is level with a tilted frame counts and one that is merely
      // level with the canvas does not.
      const scale = Math.max(1, Math.abs(along), Math.abs(across));
      if (Math.abs(across) <= ALREADY_ON_AXIS * scale) return { world: p.world, axis: "x", along: ux };
      if (Math.abs(along) <= ALREADY_ON_AXIS * scale) return { world: p.world, axis: "y", along: uy };
      return { world: p.world, axis: null };
    }

    if (Math.abs(across) <= Math.abs(along) * AXIS_SLOPE) {
      return { world: on(ux, along), axis: "x", along: ux };
    }
    if (Math.abs(along) <= Math.abs(across) * AXIS_SLOPE) {
      return { world: on(uy, across), axis: "y", along: uy };
    }
    return { world: p.world, axis: null };
  }

  /**
   * The default frame's axes, or null when there is no default frame — or when
   * the one there is has been dragged onto its own origin and has no direction
   * left to offer. Read fresh each time: the frame is ordinary geometry and may
   * have moved since the last cursor event, including during this very gesture.
   */
  private axes(): { ux: number[]; uy: number[] } | null {
    const m = this.ctx.model;
    if (!m.defaultFrame || !m.entities.has(m.defaultFrame)) return null;
    const { ux, uy } = frameBasis(m, m.defaultFrame)();
    // `frameBasis` floors a collapsed frame's direction to the zero vector
    // rather than dividing by zero; anything else it hands back is a unit. In
    // 3D +y can floor on its own (a y-ref dragged onto the x axis), and a frame
    // with no plane has no "level" to offer either.
    const gone = (u: number[]) => u.every((c) => c === 0);
    return gone(ux) || gone(uy) ? null : { ux, uy };
  }

  render(r: RenderContext): void {
    const from = this.startWorld();
    if (!from || !this.aim) return;
    const [ax, ay] = r.worldToScreen(from);
    const [bx, by] = r.worldToScreen(this.aim.world);

    r.g.save();
    // The guide first, so the segment itself draws over it.
    if (this.aim.axis && this.aim.along) {
      const far = 4000; // longer than any canvas; the rest is clipped away
      // Along the *frame's* axis, taken to screen space through the same
      // transform the geometry uses — so the guide is drawn where the
      // constraint that is about to land actually points, tilt and all.
      const [gx, gy] = r.worldToScreen(this.aim.along.map((c, i) => from[i] + c));
      const [dx, dy] = [gx - ax, gy - ay];
      const glen = Math.hypot(dx, dy) || 1;
      const [ux, uy] = [dx / glen, dy / glen];
      r.g.strokeStyle = "#e8a33d";
      r.g.globalAlpha = 0.4;
      r.g.setLineDash([2, 5]);
      r.g.lineWidth = 1;
      r.g.beginPath();
      r.g.moveTo(ax - ux * far, ay - uy * far);
      r.g.lineTo(ax + ux * far, ay + uy * far);
      r.g.stroke();
      r.g.globalAlpha = 1;
    }

    // Solid, like every shape being drawn: dashes mean selection (the crossing
    // box), and a shape under the hand must not read as one.
    r.g.strokeStyle = "#e8a33d";
    r.g.setLineDash([]);
    r.g.lineWidth = 1.3;
    r.g.beginPath();
    r.g.moveTo(ax, ay);
    r.g.lineTo(bx, by);
    r.g.stroke();

    // A mark on the start, so a chain that has begun but not yet drawn
    // anything still looks like it is under way.
    r.g.setLineDash([]);
    r.g.beginPath();
    r.g.arc(ax, ay, 3, 0, Math.PI * 2);
    r.g.stroke();
    r.g.restore();
  }
}

