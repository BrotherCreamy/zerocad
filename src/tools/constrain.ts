// The constrain tool: pick what to relate, then choose the relation from the
// list of those that apply (docs/plans/sketch-relations.md).
//
// Onshape's constraint toolbar, as one button: with two lines picked the
// options panel lists Parallel, Perpendicular, Equal, Collinear and Angle;
// with a point and a line, On, Midpoint and Distance; with two circles,
// Concentric, Equal and Tangent; and so on (`constraintsFor`, the same list
// the context menu shows on a selection). One press types one relation —
// `par("l1", "l2")` — through the command line, so the log, the journal and the
// undo step are the typed call's.
//
// **Armed on a selection, it starts from it**: select two lines with nothing
// armed, press Constrain, and the list is already there. Armed on nothing,
// click (or tap) what to relate; a click on a picked one drops it, a click on
// empty canvas drops them all. After a relation is applied the picks are spent
// and the tool stays armed for the next.

import { defineTool, type PointerInfo, type RenderContext, type ToolCommand } from "./tool.ts";
import { Tool } from "./tool.ts";
import { constraintsFor } from "../dimensioning.ts";
import { markPicked } from "./picked.ts";

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

  /** The relations the picks take, as the panel lists them. */
  commands(): ToolCommand[] {
    return constraintsFor(this.ctx.model, this.picks).map((a) => ({ label: a.label, command: a.text }));
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
    const made = found.apply(this.ctx.model);
    this.picks = [];
    this.ctx.requestSolve();
    return made;
  }

  onDown(p: PointerInfo): void {
    const hit = this.ctx.pick?.(p.screen) ?? null;
    if (!hit || hit.kind === "relation" || hit.kind === "frame") {
      if (this.picks.length) {
        this.picks = [];
        this.ctx.requestRender();
      }
      return;
    }
    const at = this.picks.indexOf(hit.name);
    if (at !== -1) this.picks.splice(at, 1);
    else this.picks.push(hit.name);
    if (this.picks.length && !this.commands().length) {
      this.ctx.log?.(`constrain: no relation takes ${this.picks.join(", ")} — pick another`, "guide");
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
    markPicked(r, this.ctx.model, this.picks);
  }
}

defineTool("constrain", ConstrainTool);
