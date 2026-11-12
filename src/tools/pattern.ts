// The pattern tool (docs/plans/sketch-edit.md): select the seed, then say the
// step — a linear pattern's in the options panel (dx, dy along the drawing
// plane's axes, and the count), a circular pattern's centre by a click on a
// point (or on a circle or arc: its centre), its angle and count in the panel.
// Selected before arming (Select, then Pattern), the seed is taken at once;
// otherwise clicks pick it, and ✓ moves on (a circular pattern's centre next).
// The copies are drawn as ✓ will make them (the copy preview) and follow the
// panel's numbers as they are typed; ✓ types `linear(["l1", …], 20, 0, 3)` or
// `circular(["c1"], "p1", 6.283185, 6)`, one undo step. Copy k of l1 is l1_k.

import { press, type FeatureStep, type Hand, type PointerInfo, type RenderContext, type How } from "./tool.ts";
import type { OptionSpecs } from "./options.ts";
import { FeatureTool, callText } from "./feature.ts";
import { COPIES, copyable, drawSet } from "./mirror.ts";
import { ringAt } from "./editdraw.ts";
import { REGION_GREEN } from "./region.ts";
import { circular, linear } from "../sketchedit.ts";

const TAU = Math.PI * 2;

export class PatternTool extends FeatureTool {
  static readonly options: OptionSpecs = {
    kind: { default: "linear", choices: { linear: "Linear", circular: "Circular" }, label: "" },
    count: { default: 3, label: "count", check: (v) => (Number.isInteger(v) && (v as number) >= 2 && (v as number) <= 200 ? null : "must be a whole number from 2 to 200") },
    dx: { default: 20, unit: "length", label: "step x" },
    dy: { default: 0, unit: "length", label: "step y" },
    angle: { default: TAU, unit: "angle", check: (v) => ((v as number) !== 0 && Math.abs(v as number) <= TAU + 1e-9 ? null : "must be more than 0 and at most a whole turn") },
  };
  static readonly summary = "Copies in a row or round a centre: select, then step and count";
  static readonly how: How = (o) => [
    "{Tap} what to copy, then ✓.",
    o.kind === "circular" ? "{Tap} the point to turn about; set the angle and count." : "Set the step and the count in the options.",
    "✓ again makes the copies.",
  ];
  readonly name = "pattern";
  set: string[] = [];
  centre: string | null = null;
  private settled = false;

  onArmed(): void {
    const pre = copyable(this.ctx.model, this.ctx.prenamed);
    if (pre.length) {
      this.set = pre;
      this.settled = true;
      this.ctx.requestRender();
    }
  }

  private circularNow(values: Record<string, unknown> = this.values()): boolean {
    return values.kind === "circular";
  }

  protected plan(values: Record<string, unknown>): FeatureStep[] | null {
    if (!this.set.length) return null;
    const set = [...this.set];
    const n = typeof values.count === "number" ? values.count : 3;
    if (this.circularNow(values)) {
      if (this.centre === null) return null;
      const [c, a] = [this.centre, typeof values.angle === "number" ? values.angle : TAU];
      return [(m) => ({ text: callText("circular", [set, c, a, n]), direct: () => circular(m, set, c, a, n) })];
    }
    const dx = typeof values.dx === "number" ? values.dx : 20, dy = typeof values.dy === "number" ? values.dy : 0;
    if (dx === 0 && dy === 0) return null;
    return [(m) => ({ text: callText("linear", [set, dx, dy, n]), direct: () => linear(m, set, dx, dy, n) })];
  }

  protected picksKey(): string {
    return `${this.set.join(",")}|${this.centre ?? ""}`;
  }

  protected dropPicks(): boolean {
    const had = this.set.length > 0;
    this.set = [];
    this.centre = null;
    this.settled = false;
    return had;
  }

  protected wanting(): string | null {
    if (!this.set.length) return null;
    if (this.circularNow() && this.centre === null) return `now {tap} the centre — a point, or a circle or arc for its centre`;
    return "set a step that is not nothing in the options panel";
  }

  protected get verb(): string {
    return "pattern";
  }

  protected picking(hand: Hand): string {
    if (!this.set.length) return `${press(hand)} what to pattern, then ✓`;
    if (this.circularNow() && this.settled) return `${press(hand)} the centre to turn about`;
    return `${press(hand)} more, or ✓`;
  }

  /** ✓ with the seed picked: a circular pattern goes on to its centre; a linear one, with its step, is made. */
  confirm(): boolean {
    if (this.set.length && !this.settled) {
      this.settled = true;
      if (this.circularNow() && this.centre === null) {
        this.ctx.requestRender();
        return true;
      }
    }
    return super.confirm();
  }

  onDown(p: PointerInfo): void {
    const model = this.ctx.model;
    const hit = this.ctx.pick?.(p.screen) ?? null;
    if (this.circularNow() && this.settled) {
      const e = hit ? model.entities.get(hit.name) : undefined;
      const c = e?.kind === "point" ? e.name : e && (e.kind === "circle" || e.kind === "arc") ? e.center : null;
      if (!c) {
        this.guide("{tap} the centre: a point, or a circle or arc for its centre");
        return;
      }
      if (c === this.centre) {
        this.confirm();
        return;
      }
      this.centre = c;
      this.ctx.requestRender();
      return;
    }
    if (!hit || !COPIES.has(hit.kind)) {
      this.guide(this.set.length ? "{tap} more to pattern, or ✓" : "{tap} a line, arc, circle or point to pattern");
      return;
    }
    this.set = this.set.includes(hit.name) ? this.set.filter((n) => n !== hit.name) : [...this.set, hit.name];
    this.ctx.requestRender();
  }

  render(r: RenderContext): void {
    const model = this.previewed()?.model ?? this.ctx.model;
    drawSet(r, model, this.set.filter((n) => model.entities.has(n)));
    if (this.centre && model.entities.has(this.centre)) ringAt(r, model.coords(this.centre), REGION_GREEN);
    this.renderPreview(r);
  }
}
