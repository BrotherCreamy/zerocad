// The dimension tool: SolidWorks' Smart Dimension — click what to measure,
// then click where the number goes (docs/plans/sketch-relations.md, and
// docs/plans/smart-dimension.md; the owner: *"Dim tool needs to be similar in
// functionality to Solidworks smart dimension. I should be able to use it to
// dimension virtually anything. Distance between two faces of a solid, or
// angle"*).
//
// What is clicked decides what the number is — the whole table is
// dimensioning.ts's `dimensionFor`, and docs/plans/smart-dimension.md writes
// it out: a line's length, a circle's ⌀ and an arc's R, two points, a point
// and a line, two lines' angle or distance, three points' angle, an arc's
// length, an ellipse's axes, and a solid's vertices, edges and faces —
// two faces' distance or angle, a face and a point or an edge.
//
// **What it picks is SolidWorks' order**: a vertex before an edge before a
// face (`ctx.pickSolid`, solidpick.ts) — the ordinary pick, a finger's reach
// and all, and only where that finds nothing, the face of a solid under the
// pixel. A face is lit while the hand is on it and once it is picked, so it
// is plain what is being dimensioned.
//
// Each holds what it measures **now**, rounded as the menu's Dimension rounds
// (dimensioning.ts), so the click adds a constraint the drawing already
// satisfies and moves nothing; `set("d4.value", …)` or the label's Set value…
// — or a double-click on the label — then changes it.
//
// **Driving when it can, driven when it must.** Before it types a driving
// dimension the tool tries it on a throwaway copy (`ctx.preview`, the feature
// tools' preview) and asks the copy (`drivenBecause`): one that would only
// repeat what is already held, or contradict it, is typed as the reference
// dimension instead — `measure(…)`, in parentheses — and the log says why, in
// one line. SolidWorks asks; the house does not. A face only the solid kernel
// knows (a fillet's) is always driven: nothing in the model holds it. And
// picks that are a dimension the drawing already has — an extrude's lid and
// its own base, which are its depth — make nothing: the depth's value is
// opened to be typed, as Set value… opens it. With `driven` it is always the
// reference; with `measure` the reading is said in the log and nothing is made.
//
// **The gesture**: click (or tap) each thing to measure — a second click on a
// picked one drops it — and the number is previewed beside the cursor; then
// click on empty canvas (or on a label), where the label is to go, and it is
// typed. Two things picked take a third only where the three make a dimension
// (three points, an arc and its two ends, a point and two lines); a click on
// anything else starts again from it, as one on a fourth always does. Escape
// drops the picks; a second Escape puts the tool down. The tool stays armed.
//
// **The placement click chooses, and does not place.** Where it lands says
// which reading two points get — beyond both, above or below, is the
// horizontal distance; beside them the vertical; between them the true one —
// and an ellipse's nearer axis, as SolidWorks' does. The label itself sits
// where the glyph layer puts it: a position a person chooses has nowhere to
// be kept yet (glyphs.ts holds no state, and a position is not a relation);
// that is filed in TODO.md, not smuggled in here.

import { press, type Hand, type PointerInfo, type RenderContext } from "./tool.ts";
import type { OptionSpecs } from "./options.ts";
import { Tool } from "./tool.ts";
import type { Pick } from "../picking.ts";
import { dimensionFor, drivenBecause, takesThird, type Applicable, type DimensionOptions } from "../dimensioning.ts";
import { REGION_GREEN } from "./region.ts";
import { markPicked } from "./picked.ts";
import { edgePoints } from "../kerneledges.ts";

/** The hover's amber, as the drawing lights what is under the hand. */
const HOVER = "#e8a33d";

export class DimensionTool extends Tool {
  static readonly options: OptionSpecs = {
    // SolidWorks': a whole circle's diameter, an arc's radius — vetoable (TODO.md).
    radial: { default: "auto", label: "circle size", choices: { auto: "⌀ circle, R arc", radius: "R", diameter: "⌀" } },
    driven: { default: false, label: "driven" },
    // Say what it measures, make nothing (`measureOf`).
    measure: { default: false, label: "measure only", remember: false },
  };
  static readonly summary = "Dimensions what you click — a vertex, an edge, a face — then a click places it";
  readonly name = "dimension";
  // Its picks are entities, not places: a snap marker would promise a point.
  readonly snaps = false;
  /** What is picked, in the order picked — entity names, a frame's axis, a solid's face or edge by name. */
  picks: string[] = [];
  /** Where the cursor is, for the preview. */
  private at: [number, number] | null = null;
  /** The face under the hand, lit until it is picked or the hand moves off. */
  private hovered: string | null = null;
  /** The last commit, once it has run — what a test (and nothing else) waits on. */
  settled: Promise<void> = Promise.resolve();

  private opts(): DimensionOptions & { measure: boolean } {
    const o = this.ctx.options;
    const radial = o.radial === "radius" || o.radial === "diameter" ? o.radial : "auto";
    return {
      radial: o.diameter === true ? "diameter" : radial,
      driven: o.driven === true,
      measure: o.measure === true,
    };
  }

  /** What to click: what to measure, then more of it, then where the value goes. */
  next(hand: Hand): string {
    if (!this.picks.length) return `${press(hand)} what to dimension — a vertex, an edge, a face`;
    if (this.planned()) return `${press(hand)} where it goes — above, beside or between`;
    return `${press(hand)} what to measure ${this.picks[0]} against`;
  }

  /** The dimension the picks make now, or null. */
  planned(at: [number, number] | null = this.at): Applicable | null {
    const place = at && this.ctx.toScreen ? { at, toScreen: this.ctx.toScreen } : undefined;
    return dimensionFor(this.ctx.model, this.picks, { ...this.opts(), ...(place ? { place } : {}) });
  }

  /** What is under the pixel, as this tool takes it: the solid-aware pick, else the plain one. */
  private under(screen: [number, number]): Pick | null {
    return this.ctx.pickSolid?.(screen) ?? this.ctx.pick?.(screen) ?? null;
  }

  /** A pick's name as the table reads it: a frame's arm is that axis. */
  private nameOf(hit: Pick): string | null {
    if (hit.kind === "relation") return null;
    if (hit.kind === "frame") return hit.axis ? `${hit.name}.${hit.axis}` : null;
    return hit.name;
  }

  onDown(p: PointerInfo): void {
    const hit = this.under(p.screen);
    const name = hit ? this.nameOf(hit) : null;
    if (name === null) {
      // Empty canvas, or a label — the placement click.
      const plan = this.planned(p.screen);
      if (!plan) {
        this.guide(this.picks.length
          ? `${this.picks.join(" and ")} make no dimension — click a vertex, an edge, a face, a line, a circle or two points`
          : "click what to dimension: a vertex, an edge or a face of a solid; a line, a circle, two points, two lines");
        return;
      }
      this.settled = this.commit(plan);
      return;
    }
    const at = this.picks.indexOf(name);
    if (at !== -1) {
      this.picks.splice(at, 1);
    } else if (this.picks.length >= 3 || (this.picks.length === 2 && !takesThird(this.ctx.model, this.picks, name))) {
      this.picks = [name];
    } else {
      this.picks.push(name);
    }
    this.hovered = null;
    this.ctx.requestRender();
  }

  onMove(p: PointerInfo): void {
    this.at = p.screen;
    const hit = this.ctx.pickSolid?.(p.screen) ?? null;
    const face = hit?.kind === "face" && !this.picks.includes(hit.name) ? hit.name : null;
    if (face !== this.hovered || this.picks.length) {
      this.hovered = face;
      this.ctx.requestRender();
    }
  }

  /**
   * Types the dimension through the command line where there is one, and
   * makes the call itself where there is not — driven instead where the trial
   * says it may not drive; or says the reading, or opens a value, and makes
   * nothing.
   */
  private async commit(plan: Applicable): Promise<void> {
    const opts = this.opts();
    this.picks = [];
    this.at = null;
    this.hovered = null;
    this.ctx.requestRender();
    if (opts.measure) {
      this.ctx.log?.(`${plan.label.replace(/ \(driven\)$/, "")}: ${(plan.reading ?? "").replace(/^\((.*)\)$/, "$1")}`, "done");
      return;
    }
    if (plan.edits) {
      this.ctx.log?.(`dimension: that is ${plan.label.toLowerCase()} = ${plan.reading} — type its new value`, "done");
      this.ctx.editDimension?.(plan.edits);
      return;
    }
    let chosen = plan;
    if (plan.driven && !opts.driven) {
      const why = await this.trial(plan);
      if (why !== null) {
        chosen = plan.driven;
        this.ctx.log?.(`dimension: made driven — ${why}`);
      }
    }
    if (this.ctx.run) {
      await this.ctx.run(chosen.text);
    } else {
      chosen.apply(this.ctx.model);
      this.ctx.requestSolve();
    }
    this.ctx.requestRender();
  }

  /**
   * Why `plan` may not drive, asked of a copy with it added: the app's
   * preview (the very command machinery the commit will use), or headless a
   * copy saved and opened here — loaded only then, since persist.ts imports
   * the modules that import this tool.
   */
  private async trial(plan: Applicable): Promise<string | null> {
    const model = this.ctx.model;
    if (this.ctx.preview) {
      const pv = await this.ctx.preview([() => ({ text: plan.text })]);
      if (!pv.model) return null; // refused: typed as it is, the refusal is the command line's to say
      const made = [...pv.model.relations.keys()].find((k) => !model.relations.has(k));
      return made ? drivenBecause(pv.model, made) : null;
    }
    const { open, save } = await import("../persist.ts");
    const copy = open(save(model, false), model.dim);
    copy.solve();
    return drivenBecause(copy, plan.apply(copy));
  }

  clear(): boolean {
    const had = this.picks.length > 0;
    this.picks = [];
    this.ctx.requestRender();
    return had;
  }

  onCancel(): void {
    this.picks = [];
    this.hovered = null;
  }

  retune(): void {
    this.ctx.requestRender();
  }

  private guide(why: string): void {
    this.ctx.requestRender();
    this.ctx.log?.(`dimension: ${why}`, "guide");
  }

  /** A face lit: its outlines filled faintly and stroked, in `colour`. */
  private lightFace(r: RenderContext, name: string, colour: string): void {
    const outlines = this.ctx.faceOutlines?.(name) ?? [];
    if (!outlines.length) return;
    const k = r.ui ?? 1;
    r.g.save();
    r.g.beginPath();
    for (const o of outlines) {
      o.forEach((w, i) => {
        const [x, y] = r.worldToScreen(w);
        if (i === 0) r.g.moveTo(x, y);
        else r.g.lineTo(x, y);
      });
      r.g.closePath();
    }
    r.g.globalAlpha = 0.28;
    r.g.fillStyle = colour;
    r.g.fill("nonzero");
    r.g.globalAlpha = 1;
    r.g.strokeStyle = colour;
    r.g.lineWidth = 1.5 * k;
    r.g.stroke();
    r.g.restore();
  }

  /** A kernel edge lit along the kernel's own curve. */
  private lightEdge(r: RenderContext, name: string): void {
    for (const v of this.ctx.solids?.views() ?? []) {
      for (const e of v.result.solid?.edges.map((x, i) => ({ x, i })) ?? []) {
        if (e.x.name !== name) continue;
        const pts = edgePoints(v, e.i).map((w) => r.worldToScreen(w));
        if (pts.length < 2) continue;
        r.g.save();
        r.g.strokeStyle = REGION_GREEN;
        r.g.lineWidth = 3;
        r.g.beginPath();
        r.g.moveTo(...pts[0]);
        for (const pt of pts.slice(1)) r.g.lineTo(...pt);
        r.g.stroke();
        r.g.restore();
      }
    }
  }

  /** The picks marked, the face under the hand lit, and the number the placement click would type, beside the cursor. */
  render(r: RenderContext): void {
    const m = this.ctx.model;
    const k = r.ui ?? 1;
    if (this.hovered) this.lightFace(r, this.hovered, HOVER);
    for (const name of this.picks) {
      if (m.entities.has(name)) continue;
      if (name.includes("|")) this.lightEdge(r, name);
      else this.lightFace(r, name, REGION_GREEN);
    }
    markPicked(r, m, this.picks);
    if (!this.at) return;
    const plan = this.planned();
    const text = plan?.reading;
    if (!plan || !text) return;
    r.g.save();
    r.g.font = `${12 * k}px ui-monospace, Menlo, monospace`;
    r.g.fillStyle = REGION_GREEN;
    r.g.textBaseline = "bottom";
    const shown = this.opts().driven && !text.startsWith("(") && plan.driven ? plan.driven.reading ?? text : text;
    r.g.fillText(shown, this.at[0] + 12 * k, this.at[1] - 6 * k);
    r.g.restore();
  }
}

