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
// **Horizontal/vertical inference, and only against a frame somebody chose.**
// While the preview is within a few degrees of an axis it is drawn exactly on
// that axis, with a guide, and the committed line gets `hor(line, frame)` or
// `ver(line, frame)` — the *line* form, so the constraint still means "this
// edge is level" after a fillet re-points it. An endpoint snap beats the axis
// guess: if the click landed on real geometry, that is what was aimed at, and
// the axis constraint is applied only if the snapped position happens to
// satisfy it anyway.
//
// With **no default frame there is no inference at all**: the drawing has no
// notion of level, and inferring against the kernel's own axes would be the
// world frame coming back in through the side door. The line is still drawn,
// and still snaps; it simply arrives unconstrained.
//
// ⚠ Half-1 gap, deliberate and bounded: the aim and its guide are still
// computed against the kernel's axes rather than the default frame's, so a
// *tilted* default frame gets a preview that disagrees with the constraint
// that lands. Nothing in this half can tilt a frame by hand — frames are not
// drawn or draggable until the second half of the package, which is where
// the aim becomes frame-relative along with the rest of the tool work.
//
// The chain itself is dimension-generic — points and lines are — so the tool
// works unchanged in a 3D model and simply infers no axis there, since
// horizontal and vertical are genuinely 2D-only concepts.

import { Tool, defineTool, type PointerInfo, type RenderContext } from "./tool.ts";
import { horizontal, vertical } from "../relations/basic.ts";
import { placePoint } from "./place.ts";

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

type Axis = "horizontal" | "vertical" | null;

/** Across every coordinate, not just the two a viewport draws. */
function distance(a: number[], b: number[]): number {
  return Math.hypot(...a.map((v, i) => v - b[i]));
}

/** Where the segment's far end should go, and which axis constraint that implies. */
interface Aim {
  world: number[];
  axis: Axis;
}

export class LineTool extends Tool {
  readonly name = "line";
  /** The first click of a fresh chain — kept whole, so its snap survives to commit. */
  private pending: PointerInfo | null = null;
  /** The committed point the next segment runs from. The chain's shared vertex. */
  private anchor: string | null = null;
  /** Where the far end currently wants to be, axis-corrected, for the preview. */
  private aim: Aim | null = null;

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
    // Only against a frame the user chose. `resolveFrame` would throw without
    // one, and a tool must not turn a drawing gesture into an error message.
    if (m.defaultFrame) {
      if (aim.axis === "horizontal") horizontal(m, line.name, m.defaultFrame);
      else if (aim.axis === "vertical") vertical(m, line.name, m.defaultFrame);
    }

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
    // A chain of segments is dimension-generic — it is only points and lines.
    // Horizontal and vertical are not (see relations/basic.ts), so above two
    // dimensions the tool draws the same and simply infers no axis.
    if (from.length !== 2) return { world: p.world, axis: null };
    const dx = p.world[0] - from[0];
    const dy = p.world[1] - from[1];
    if (Math.hypot(dx, dy) < DEGENERATE) return { world: p.world, axis: null }; // no direction to read

    if (p.snap) {
      const scale = Math.max(1, Math.abs(dx), Math.abs(dy));
      if (Math.abs(dy) <= ALREADY_ON_AXIS * scale) return { world: p.world, axis: "horizontal" };
      if (Math.abs(dx) <= ALREADY_ON_AXIS * scale) return { world: p.world, axis: "vertical" };
      return { world: p.world, axis: null };
    }

    if (Math.abs(dy) <= Math.abs(dx) * AXIS_SLOPE) {
      return { world: [p.world[0], from[1]], axis: "horizontal" };
    }
    if (Math.abs(dx) <= Math.abs(dy) * AXIS_SLOPE) {
      return { world: [from[0], p.world[1]], axis: "vertical" };
    }
    return { world: p.world, axis: null };
  }

  render(r: RenderContext): void {
    const from = this.startWorld();
    if (!from || !this.aim) return;
    const [ax, ay] = r.worldToScreen(from);
    const [bx, by] = r.worldToScreen(this.aim.world);

    r.g.save();
    // The guide first, so the segment itself draws over it.
    if (this.aim.axis) {
      const far = 4000; // longer than any canvas; the rest is clipped away
      const [ux, uy] = this.aim.axis === "horizontal" ? [1, 0] : [0, 1];
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

    r.g.strokeStyle = "#e8a33d";
    r.g.setLineDash([4, 3]);
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

defineTool("line", LineTool);
