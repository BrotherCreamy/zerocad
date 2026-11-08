// The constrain tool: pick what to relate, then choose the relation from the
// list of those that apply (docs/plans/sketch-relations.md,
// docs/plans/relations-complete.md).
//
// Onshape's constraint toolbar, as one button: with two lines picked the
// options panel lists Parallel, Perpendicular, Equal, Collinear and Angle;
// with a point and a line, On, Midpoint and Distance; with two circles,
// Concentric, Coradial, Equal and Tangent; with five lines, Equal for all five
// at once; and so on (`constraintsFor`, the same list the context menu shows
// on a selection). One press types one line — `par("l1", "l2")`, or for many
// at once `eq("l1", "l2"); eq("l1", "l3")` — through the command line, so the
// log, the journal and the undo step are the typed line's. A row greyed in
// the panel says why it cannot apply, and a press on it types nothing.
//
// **Armed on a selection, it starts from it**: select two lines with nothing
// armed, press Constrain, and the list is already there. Armed on nothing,
// click (or tap) what to relate; a click on a picked one drops it, a click on
// empty canvas drops them all. After a relation is applied the picks are spent
// and the tool stays armed for the next.
//
// What a click can pick, beyond the drawing's own points and curves: **a
// frame's arm**, which is that axis (`"f1.y"`; the z arm, in 3D, its plane);
// and on a solid, **a flat face**, as the three of its own points sketch on
// face names it by (`"p1.p2.p3"`) — or, where the face or edge is the
// kernel's own (a fillet's), its kernel name, which the list greys with the
// reason. A solid's vertices and the edges along its sketch are the model's
// points and lines, and pick as any do. That last part is `solidRefAt` below,
// on its own so a fuller picker can take its place.

import { defineTool, press, type Hand, type PointerInfo, type RenderContext, type ToolCommand, type ToolContext } from "./tool.ts";
import { Tool } from "./tool.ts";
import { constraintsFor } from "../dimensioning.ts";
import { sketchFrameFor } from "../sketchface.ts";
import { parsePointTriple } from "../model.ts";
import { markPicked } from "./picked.ts";

/**
 * **The minimal solid picker** (docs/plans/relations-complete.md): what of a
 * solid is under `screen`, where the drawing's own entities found nothing —
 * as a name `constraintsFor` reads. A flat face whose region the model's
 * points bound is its plane through three of them, the plane reference sketch
 * on face writes (sketchface.ts; a face bounded only by a circle comes back
 * as the circle, which is the plane reference it has); anything else the
 * kernel answers for — an edge no model line lies along, a curved face, a
 * face a fillet made — is its kernel name, which the list greys. Null where
 * there is no solid there.
 *
 * Two kinds of solid answer: a body the solid kernel built (its edges and
 * faces through `ctx.solids`), and an extrude or revolve the kernel was never
 * asked for — a plain box is drawn from its features, its faces the loops of
 * its own profile, twins and walls. A region under the pixel is a face only
 * when it is one of those (`onSolid`): inside a rectangle that was only ever
 * sketched is still empty canvas, and drops the picks as it always did.
 *
 * Kept to one function on purpose: smart-dimension.md is building the
 * reusable picker for a solid's faces, edges and vertices, and this is the
 * one place that swaps for it.
 */
export function solidRefAt(ctx: ToolContext, screen: [number, number]): string | null {
  const edge = ctx.solids?.edgeAt(screen) ?? null;
  if (edge) return edge.name;
  const face = ctx.solids?.faceAt(screen) ?? null;
  if (face && !face.planar) return face.name;
  const region = ctx.regionAt?.(screen) ?? null;
  const loop = region ? region.loops[region.index] : null;
  if (region && loop && (face || onSolid(ctx.model, loop.members.map((m) => m.name)))) {
    try {
      return sketchFrameFor(ctx.model, loop, region.toward);
    } catch {
      // A face seen edge-on, or no three points off a line: the kernel's name, greyed, or nothing.
    }
  }
  return face ? face.name : null;
}

/** Whether a loop's members are all a solid feature's own — its profile, or the twins and walls it made. */
function onSolid(model: ToolContext["model"], members: string[]): boolean {
  return [...model.features.values()].some((f) => {
    const own = new Set([...f.names, ...f.loops.flat().map((m) => (typeof m === "string" ? m : m.name))]);
    return members.every((m) => own.has(m));
  });
}

export class ConstrainTool extends Tool {
  static readonly summary = "Relates what you pick: choose from the relations that apply";
  readonly name = "constrain";
  readonly snaps = false;
  /** What is picked, in the order picked. */
  picks: string[] = [];

  onArmed(): void {
    this.picks = [...(this.ctx.prenamed ?? [])];
    if (!this.picks.length) this.ctx.log?.("constrain: click what to relate — the relations that apply are listed in the panel", "guide");
    this.ctx.requestRender();
  }

  /** What to pick, then a relation from the panel's list. */
  next(hand: Hand): string {
    if (!this.picks.length) return `${press(hand)} what to relate`;
    return this.commands().some((c) => !c.off) ? "choose a relation in the panel, or pick more" : `${press(hand)} something else to relate`;
  }

  /** The relations the picks take, as the panel lists them — a greyed one with its reason. */
  commands(): ToolCommand[] {
    return constraintsFor(this.ctx.model, this.picks).map((a) => ({ label: a.label, command: a.text, ...(a.off ? { off: a.off } : {}) }));
  }

  /** One was typed: the picks are spent. */
  ran(): void {
    this.picks = [];
    this.ctx.requestRender();
  }

  /** Applies the `index`th relation directly — for a host with no command line. */
  apply(index: number): string {
    const found = constraintsFor(this.ctx.model, this.picks)[index];
    if (!found) throw new Error(`constrain: nothing at ${index} — ${this.picks.length ? `${this.picks.join(", ")} take ${constraintsFor(this.ctx.model, this.picks).length}` : "nothing is picked"}`);
    if (found.off) throw new Error(`constrain: ${found.label} cannot apply — ${found.off}`);
    const made = found.apply(this.ctx.model);
    this.picks = [];
    this.ctx.requestSolve();
    return made;
  }

  onDown(p: PointerInfo): void {
    const hit = this.ctx.pick?.(p.screen) ?? null;
    // A frame's arm is its axis; a solid under an empty pixel, what of it is there.
    const name = !hit ? solidRefAt(this.ctx, p.screen)
      : hit.kind === "frame" ? (hit.axis ? `${hit.name}.${hit.axis}` : null)
        : hit.kind === "relation" ? null : hit.name;
    if (!name) {
      if (this.picks.length) {
        this.picks = [];
        this.ctx.requestRender();
      }
      return;
    }
    const at = this.picks.indexOf(name);
    if (at !== -1) this.picks.splice(at, 1);
    else this.picks.push(name);
    const listed = this.commands();
    if (this.picks.length && !listed.length) {
      this.ctx.log?.(`constrain: no relation takes ${this.picks.join(", ")} — pick another`, "guide");
    } else if (this.picks.length && listed.every((c) => c.off)) {
      this.ctx.log?.(`constrain: ${listed[0].off}`, "guide");
    }
    this.ctx.requestRender();
  }

  clear(): boolean {
    const had = this.picks.length > 0;
    this.picks = [];
    this.ctx.requestRender();
    return had;
  }

  onCancel(): void {
    this.picks = [];
  }

  render(r: RenderContext): void {
    // A face picked is marked by the three corners that name it — which face
    // it is, where a finger can see it; an axis is its frame's own marker.
    const model = this.ctx.model;
    markPicked(r, model, this.picks.flatMap((n) => model.entities.has(n) ? [n] : parsePointTriple(n) ?? []));
  }
}

