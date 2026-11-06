// The mirror tool (docs/plans/sketch-edit.md): select what to mirror, then
// click the mirror line — any line, or a frame's axis (its marker's arm, by
// name as `par` takes it: `origin.y`). Selected before arming (Select, then
// Mirror), the tool starts at the line; armed with nothing selected, clicks
// pick lines, arcs, circles and points into the set, and ✓ moves on to the
// line. With both, the copy is drawn as ✓ will make it (the copy preview,
// feature.ts) and ✓, Enter or a second click on the line types `mirror(["l1",
// "l2"], "l5")`, one undo step. Clicking a picked thing drops it.

import { press, type FeatureStep, type Hand, type PointerInfo, type RenderContext } from "./tool.ts";
import { FeatureTool, callText } from "./feature.ts";
import { REGION_GREEN } from "./region.ts";
import { pieceSamples, strokeWorld } from "./editdraw.ts";
import { mirror } from "../sketchedit.ts";
import type { Pick } from "../picking.ts";

/** What a set takes: the kinds a mirror or a pattern copies. */
export const COPIES = new Set(["point", "line", "arc", "circle"]);

/** The names a preselection hands over that a copy can take. */
export function copyable(model: { entities: Map<string, { kind: string }> }, names: readonly string[] | undefined): string[] {
  return (names ?? []).filter((n) => COPIES.has(model.entities.get(n)?.kind ?? ""));
}

/** A frame arm or a line, as the name `mirror` takes. */
export function mirrorLineOf(hit: Pick | null): string | null {
  if (!hit) return null;
  if (hit.kind === "line") return hit.name;
  if (hit.kind === "frame" && hit.axis) return `${hit.name}.${hit.axis}`;
  return null;
}

/** The set drawn picked: each curve in the tools' green, each point ringed. */
export function drawSet(r: RenderContext, model: Parameters<typeof pieceSamples>[0], set: readonly string[]): void {
  for (const n of set) {
    const e = model.entities.get(n);
    if (!e) continue;
    if (e.kind === "point") {
      const [x, y] = r.worldToScreen(model.coords(n));
      const ui = r.ui ?? 1;
      r.g.save();
      r.g.strokeStyle = REGION_GREEN;
      r.g.lineWidth = 2 * ui;
      r.g.beginPath();
      r.g.arc(x, y, 6 * ui, 0, Math.PI * 2);
      r.g.stroke();
      r.g.restore();
    } else strokeWorld(r, pieceSamples(model, n, 0, 1), REGION_GREEN, 3);
  }
}

export class MirrorTool extends FeatureTool {
  static readonly summary = "Mirrors a copy: select, then click the mirror line or an axis";
  readonly name = "mirror";
  set: string[] = [];
  line: string | null = null;
  /** Whether the set is settled and the next click is the line. */
  private choosingLine = false;

  onArmed(): void {
    const pre = copyable(this.ctx.model, this.ctx.prenamed);
    if (pre.length) {
      this.set = pre;
      this.choosingLine = true;
      this.ctx.requestRender();
    }
  }

  protected plan(): FeatureStep[] | null {
    if (!this.set.length || this.line === null) return null;
    const [set, line] = [[...this.set], this.line];
    return [(m) => ({ text: callText("mirror", [set, line]), direct: () => mirror(m, set, line) })];
  }

  protected picksKey(): string {
    return `${this.set.join(",")}|${this.line ?? ""}`;
  }

  protected dropPicks(): boolean {
    const had = this.set.length > 0 || this.line !== null;
    this.set = [];
    this.line = null;
    this.choosingLine = false;
    return had;
  }

  protected wanting(): string | null {
    if (!this.set.length) return null;
    return "now click the mirror line — a line, or a frame's axis";
  }

  protected get verb(): string {
    return "mirror";
  }

  protected picking(hand: Hand): string {
    if (!this.set.length) return `${press(hand)} what to mirror, then ✓`;
    if (!this.choosingLine) return `${press(hand)} more, or ✓ for the mirror line`;
    return `${press(hand)} the mirror line — a line or an axis`;
  }

  /** ✓ with the set picked and no line yet: on to the line. */
  confirm(): boolean {
    if (this.set.length && this.line === null && !this.choosingLine) {
      this.choosingLine = true;
      this.ctx.requestRender();
      return true;
    }
    return super.confirm();
  }

  onDown(p: PointerInfo): void {
    const hit = this.ctx.pick?.(p.screen) ?? null;
    if (this.choosingLine) {
      const line = mirrorLineOf(hit);
      if (!line) {
        this.guide("click the mirror line: a line, or an arm of a frame's marker");
        return;
      }
      if (line === this.line) {
        this.confirm();
        return;
      }
      if (this.set.includes(line)) this.set = this.set.filter((n) => n !== line);
      this.line = line;
      this.ctx.requestRender();
      return;
    }
    if (!hit || !COPIES.has(hit.kind)) {
      this.guide(this.set.length ? "click more to mirror, or ✓ and then the mirror line" : "click a line, arc, circle or point to mirror");
      return;
    }
    this.set = this.set.includes(hit.name) ? this.set.filter((n) => n !== hit.name) : [...this.set, hit.name];
    this.ctx.requestRender();
  }

  render(r: RenderContext): void {
    const model = this.previewed()?.model ?? this.ctx.model;
    drawSet(r, model, this.set.filter((n) => model.entities.has(n)));
    if (this.line && !this.line.includes(".") && model.entities.has(this.line)) {
      strokeWorld(r, pieceSamples(model, this.line, 0, 1), REGION_GREEN, 1.5, [8, 3, 2, 3]);
    }
    this.renderPreview(r);
  }
}
