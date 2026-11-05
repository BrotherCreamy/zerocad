// Click two lines that meet — or the corner they meet at — see the arc, and
// confirm.
//
// This is the first tool built on picking, and it is the case that motivated
// picking in the first place: `fillet` the operation has existed for a while
// and was perfectly usable from the command line, but only if you already knew
// the two edges by name. Pointing at them is how anyone would rather do it.
//
// A feature tool (see feature.ts): it takes its radius from `arm("fillet", {
// radius: 8 })` or the options panel, and two lines that share a corner —
// clicked one after the other, or both at once by a click on the corner's
// point. With two the rounded corner is drawn as it will be built (the arc,
// and everything a regenerated lid gains with it), following the radius as it
// is typed; ✓, Enter, or a second click on the line picked last (or the corner
// again) rounds it, one undo step. Clicking a picked line drops it; ✗ or Escape
// drops both and keeps the tool armed. What it types is the typed call,
// `fillet("l2", "l3", 10)`.
//
// **No frame is made for the arc.** It carries its own normal and its two
// tangents hold it in the corner (docs/plans/frameless-curves.md); it used to
// need a frame's plane, and a fillet in a fresh model typed one first.

import { defineTool, press, type FeatureStep, type Hand, type PointerInfo, type RenderContext } from "./tool.ts";
import type { OptionSpecs } from "./options.ts";
import { fillet } from "../operations.ts";
import type { Model } from "../model.ts";
import { FeatureTool, callText } from "./feature.ts";
import { REGION_GREEN } from "./region.ts";

/** Used when the tool is armed with no radius. */
export const DEFAULT_RADIUS = 10;

/** Whether two lines share an end — asked by the tool so a miss is said in its words, not the operation's. */
function sharesCorner(model: Model, a: string, b: string): boolean {
  const [la, lb] = [model.line(a), model.line(b)];
  return la.refs.some((p) => lb.refs.includes(p));
}

/** The two lines that end at `point`, when exactly two do — a corner a click on its point takes whole. */
export function cornerAt(model: Model, point: string): [string, string] | null {
  const lines = [...model.entities.values()].filter((e) => e.kind === "line" && e.refs.includes(point)).map((e) => e.name);
  return lines.length === 2 ? [lines[0], lines[1]] : null;
}

/** The step that rounds the corner of `a` and `b` at `radius`: the typed call. */
export function filletSteps(a: string, b: string, radius: number): FeatureStep[] {
  return [(m) => ({ text: callText("fillet", [a, b, radius]), direct: () => fillet(m, a, b, radius) })];
}

export class FilletTool extends FeatureTool {
  static readonly options: OptionSpecs = {
    radius: { default: DEFAULT_RADIUS, unit: "length", check: (v) => ((v as number) > 0 ? null : "must be more than 0") },
  };
  static readonly summary = "Rounds a corner: click two lines that meet, or their corner";
  readonly name = "fillet";
  // Its picks are lines, and a corner's point: a snap marker would only echo the pick.
  readonly snaps = false;
  /** The lines picked, in the order picked. */
  lines: string[] = [];
  /** Whether the last pick was a corner's point — which a second click on the same corner confirms. */
  private byCorner: string | null = null;

  /** Armed, the radius is always here and checked; the fallback is for a tool driven with no engine. */
  private radiusOf(values: Record<string, unknown>): number {
    const r = values.radius;
    return typeof r === "number" && r > 0 ? r : DEFAULT_RADIUS;
  }

  protected plan(values: Record<string, unknown>): FeatureStep[] | null {
    if (this.lines.length !== 2) return null;
    const [a, b] = this.lines;
    return filletSteps(a, b, this.radiusOf(values));
  }

  protected picksKey(): string {
    return this.lines.join(",");
  }

  protected dropPicks(): boolean {
    const had = this.lines.length > 0;
    this.lines = [];
    this.byCorner = null;
    return had;
  }

  protected wanting(): string | null {
    return this.lines.length ? `now click a line that meets ${this.lines[0]}` : null;
  }

  protected get verb(): string {
    return "round the corner";
  }

  protected picking(hand: Hand): string {
    return this.lines.length ? `${press(hand)} a line that meets ${this.lines[0]}` : `${press(hand)} a lit corner, or a line`;
  }

  /**
   * Lit while the tool waits (docs/plans/mode-feedback.md): every corner it
   * could round — a point two lines meet at, quiet until now — or, with one
   * line picked, the lines that share a corner with it.
   */
  takes(): readonly string[] {
    const model = this.ctx.model;
    if (this.lines.length === 2) return [];
    if (this.lines.length === 1) {
      const first = this.lines[0];
      return [...model.entities.values()]
        .filter((e) => e.kind === "line" && e.name !== first && sharesCorner(model, first, e.name))
        .map((e) => e.name);
    }
    return [...model.entities.values()].filter((e) => e.kind === "point" && cornerAt(model, e.name)).map((e) => e.name);
  }

  onDown(p: PointerInfo): void {
    const model = this.ctx.model;
    const hit = this.ctx.pick?.(p.screen) ?? null;
    const corner = hit?.kind === "point" ? cornerAt(model, hit.name) : null;
    if (corner) {
      if (this.byCorner === hit!.name && this.lines.length === 2) {
        this.confirm();
        return;
      }
      this.pickPair(corner, hit!.name);
      return;
    }
    // Clicking anything that isn't a line is a miss, not an error: the most
    // likely cause is aiming slightly off, and cancelling the whole gesture
    // for that would be infuriating. So the picks stay as they were, and the
    // line says what was clicked and what would do.
    if (!hit || hit.kind !== "line") {
      const what = hit ? `${hit.name} is a ${hit.kind} — ` : "";
      const first = this.lines[0];
      this.guide(first ? (hit ? `${what}click a line that meets ${first}` : `now click a line that meets ${first}`)
        : `${hit ? what : "click a line — "}fillet wants two lines that share a corner`);
      return;
    }
    const line = hit.name;
    const at = this.lines.indexOf(line);
    if (at !== -1) {
      // The last one picked, picked again, is the quick path; the other is dropped.
      if (at === this.lines.length - 1 && this.lines.length === 2 && this.byCorner === null) this.confirm();
      else if (at === this.lines.length - 1 && this.lines.length === 1) this.guide(`that is ${line} again — click the line it shares a corner with`);
      else {
        this.lines.splice(at, 1);
        this.byCorner = null;
        this.ctx.requestRender();
      }
      return;
    }
    if (this.lines.length === 2) {
      this.guide(`${this.lines.join(" and ")} are picked — ✓ or Enter rounds them; click one to drop it`);
      return;
    }
    if (this.lines.length === 1 && !sharesCorner(model, this.lines[0], line)) {
      // Through `refuse`, so headless it still throws, as the operation's own
      // refusal of the same corner always did.
      this.refuse(new Error(`${this.lines[0]} and ${line} do not meet — fillet wants two lines that share a corner`));
      return;
    }
    // A corner it cannot round — collinear legs, a radius too large for them —
    // is still picked: the preview is refused in the operation's words, ✓
    // stays off, and the obvious next move is as likely a smaller radius in
    // the panel as another line, which a pick dropped here would rule out.
    this.lines.push(line);
    this.byCorner = null;
    this.ctx.requestRender();
  }

  /** Both lines of a corner, picked by its point. */
  private pickPair(pair: [string, string], point: string): void {
    this.lines = [...pair];
    this.byCorner = point;
    this.ctx.requestRender();
  }

  /**
   * A click that cannot be a corner's, said — muted, the picks as they were.
   * Headless it is only the console's: a miss there was always silent, and a
   * test driving the tool should not have to catch one.
   */
  protected guide(why: string): void {
    this.ctx.requestRender();
    this.ctx.log?.(`fillet: ${why}`, "guide");
  }

  /** The picked lines marked, so it's clear the tool is half-way through; then the rounded corner a confirm would make. */
  render(r: RenderContext): void {
    // From the preview's copy once there is one: the legs as the fillet
    // leaves them, ending at the arc's tangent points.
    const m = this.previewed()?.model ?? this.ctx.model;
    for (const name of this.lines) {
      if (!m.entities.has(name)) continue;
      const line = m.line(name);
      const [ax, ay] = r.worldToScreen(m.coords(line.refs[0]));
      const [bx, by] = r.worldToScreen(m.coords(line.refs[1]));
      r.g.save();
      r.g.strokeStyle = REGION_GREEN;
      r.g.lineWidth = 3;
      r.g.beginPath();
      r.g.moveTo(ax, ay);
      r.g.lineTo(bx, by);
      r.g.stroke();
      r.g.restore();
    }
    this.renderPreview(r);
  }
}

