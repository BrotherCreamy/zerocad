// The dimension tool: click what to measure, then click where the number goes
// (docs/plans/sketch-relations.md; the owner: *"give me better sketch tools,
// relations, trim, slot... all the usual"*).
//
// Onshape's and SolidWorks' one dimension tool, which decides from what is
// clicked what the number is:
//
//   a line                     its length            dist(end, end, 40)
//   two points                 the distance          dist("p1", "p2", 25)
//   a point and a line         the distance to it    dist("p1", "l2", 12)
//   two lines                  the angle between     ang("l1", "l2", deg(30))
//   two parallel lines         the distance between  dist("l1", "l3", 18)
//   a circle or an arc         the radius            rad("c1", 10) — or dia
//
// Each holds what it measures **now**, rounded as the menu's Dimension rounds
// (dimensioning.ts), so the click adds a constraint the drawing already
// satisfies and moves nothing; `set("d4.value", …)` or the label's Set value…
// then changes it. With `driven` it types `measure(…)` instead, a reference
// dimension in parentheses that measures and never constrains.
//
// **The gesture**: click (or tap) each thing to measure — a second click on a
// picked one drops it — and the number is previewed beside the cursor; then
// click on empty canvas, where the label is to go, and it is typed. A click on
// a third thing when two are picked starts again from it. Escape drops the
// picks; a second Escape puts the tool down. The tool stays armed for the next.
//
// **The placement click places the gesture, not the label.** A dimension's
// label sits where the glyph layer puts it — beside what it measures, a fixed
// number of pixels off — and the click that commits it is "here, done", as
// Onshape's is. A label a person drags to a place of their own has nowhere to
// be kept yet (glyphs.ts holds no state, and a position is not a relation);
// that is filed in TODO.md as the next step, not smuggled in here.

import { defineTool, press, type Hand, type PointerInfo, type RenderContext } from "./tool.ts";
import type { OptionSpecs } from "./options.ts";
import { Tool } from "./tool.ts";
import type { Model } from "../model.ts";
import { dimensionFor } from "../dimensioning.ts";
import { formatValue } from "../glyphs.ts";
import { measured } from "../relations/measure.ts";
import { REGION_GREEN } from "./region.ts";
import { markPicked } from "./picked.ts";

export class DimensionTool extends Tool {
  static readonly options: OptionSpecs = {
    diameter: { default: false, label: "diameter" },
    driven: { default: false, label: "driven" },
  };
  static readonly summary = "Dimensions what you click; a click on empty canvas places it";
  readonly name = "dimension";
  // Its picks are entities, not places: a snap marker would promise a point.
  readonly snaps = false;
  /** What is picked, in the order picked. */
  picks: string[] = [];
  /** Where the cursor is, for the preview. */
  private at: [number, number] | null = null;

  private opts() {
    return { diameter: this.ctx.options.diameter === true, driven: this.ctx.options.driven === true };
  }

  /** What to click: what to measure, then more of it, then where the value goes. */
  next(hand: Hand): string {
    if (!this.picks.length) return `${press(hand)} what to dimension`;
    if (this.planned()) return `${press(hand)} empty space to place it`;
    return `${press(hand)} what to measure ${this.picks[0]} against`;
  }

  /** The dimension the picks make now, or null. */
  planned() {
    return dimensionFor(this.ctx.model, this.picks, this.opts());
  }

  onDown(p: PointerInfo): void {
    const hit = this.ctx.pick?.(p.screen) ?? null;
    if (!hit || hit.kind === "relation" || hit.kind === "frame") {
      // Empty canvas — the placement click.
      const plan = this.planned();
      if (!plan) {
        this.guide(this.picks.length
          ? `${this.picks.join(" and ")} make no dimension — click a line, two points, a point and a line, two lines, or a circle`
          : "click what to dimension: a line, two points, a point and a line, two lines, or a circle");
        return;
      }
      this.commit(plan.text, () => plan.apply(this.ctx.model));
      return;
    }
    const at = this.picks.indexOf(hit.name);
    if (at !== -1) {
      this.picks.splice(at, 1);
    } else if (this.picks.length === 2) {
      this.picks = [hit.name];
    } else {
      this.picks.push(hit.name);
    }
    this.ctx.requestRender();
  }

  onMove(p: PointerInfo): void {
    this.at = p.screen;
    if (this.picks.length) this.ctx.requestRender();
  }

  /** Types the dimension through the command line where there is one; makes the call itself where there is not. */
  private commit(text: string, direct: () => string): void {
    this.picks = [];
    this.at = null;
    if (this.ctx.run) {
      void this.ctx.run(text);
    } else {
      direct();
      this.ctx.requestSolve();
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

  retune(): void {
    this.ctx.requestRender();
  }

  private guide(why: string): void {
    this.ctx.requestRender();
    this.ctx.log?.(`dimension: ${why}`, "guide");
  }

  /** The picks marked, and the number the placement click would type, beside the cursor. */
  render(r: RenderContext): void {
    const m = this.ctx.model;
    const k = r.ui ?? 1;
    markPicked(r, m, this.picks);
    const plan = this.planned();
    if (!plan || !this.at) return;
    const text = previewText(m, this.picks, this.opts());
    if (!text) return;
    r.g.save();
    r.g.font = `${12 * k}px ui-monospace, Menlo, monospace`;
    r.g.fillStyle = REGION_GREEN;
    r.g.textBaseline = "bottom";
    r.g.fillText(text, this.at[0] + 12 * k, this.at[1] - 6 * k);
    r.g.restore();
  }
}

/** The number the preview shows: what the label will read. */
function previewText(model: Model, picks: string[], opts: { diameter: boolean; driven: boolean }): string | null {
  const plan = dimensionFor(model, picks, opts);
  if (!plan) return null;
  const wrap = (s: string) => (opts.driven ? `(${s})` : s);
  if (plan.label.startsWith("Angle")) {
    return wrap(`${formatValue((measured(model, ["angle", picks[0], picks[1]]) * 180) / Math.PI)}°`);
  }
  if (plan.label.startsWith("Radius")) return wrap(`R${formatValue(model.radius(picks[0]))}`);
  if (plan.label.startsWith("Diameter")) return wrap(`⌀${formatValue(2 * model.radius(picks[0]))}`);
  const v = picks.length === 1 ? measured(model, ["dist", picks[0]]) : measured(model, ["dist", picks[0], picks[1]]);
  return wrap(formatValue(v));
}

