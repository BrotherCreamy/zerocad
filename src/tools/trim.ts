// The trim tool (docs/plans/sketch-edit.md): click the piece to remove. A curve
// under the cursor shows, in the cut's red, the piece of it between the curves
// that cut it either side of the cursor — or up to its own end where nothing
// cuts it that way — and a click removes that piece: it types `trim("l1",
// [x, y, z])`, one line, one undo step, as a person could have typed it. A
// curve nothing cuts says so (and that `del` removes it whole), muted; the
// tool stays armed, for the next piece, as Onshape's trim does.
//
// No ✓: a trim is one click, and the hover is its preview. The place typed is
// rounded to four decimals — it only says which piece — and the operation
// journals the cuts it found, so a replay never asks the drawing again.
//
// **A surface is trimmed by the same tool** (docs/plans/surfaces.md): a press
// on a surface, away from any curve, takes it in hand, the press's place the
// side to keep (marked); then a click on a curve — projected along its plane's
// normal — or on another surface cuts it there: `trim("s1", "l5", [x, y, z])`,
// one line. Escape puts the surface down. What a press is on says which trim
// it is, so a curve's trim is never a surface's by mistake.

import { Tool, press, type Hand, type PointerInfo, type RenderContext } from "./tool.ts";
import { callText } from "./feature.ts";
import { SUBTRACT_RED } from "./regiontool.ts";
import { curveUnder, pieceSamples, rounded, strokeWorld } from "./editdraw.ts";
import { trim, trimPiece } from "../sketchedit.ts";
import { trimSurface } from "../surfaces.ts";

/** What the cursor is over: a curve, and either the piece a click would take or why there is none. */
interface Hover {
  curve: string;
  at: number[];
  piece: [number, number] | null;
  why: string | null;
}

export class TrimTool extends Tool {
  static readonly summary = "Trims a curve back to where others cut it: click the piece to remove";
  readonly name = "trim";
  readonly snaps = false;
  private hover: Hover | null = null;
  /** A surface in hand, and the place on it to keep, until a cutter is clicked. */
  private held: { surface: string; keep: number[] } | null = null;

  next(hand: Hand): string {
    if (this.held) return `${press(hand)} the curve or surface to trim ${this.held.surface} by`;
    return `${press(hand)} the piece to trim away, or a surface where it is kept`;
  }

  /** The surface under a pixel, if a surface's face is the nearest thing there. */
  private surfaceAt(p: PointerInfo): { surface: string; at: number[] } | null {
    const hit = this.ctx.solids?.faceAt(p.screen) ?? null;
    if (!hit || !this.ctx.model.surfaces.has(hit.body)) return null;
    return { surface: hit.body, at: hit.at };
  }

  /** Types the surface trim, or makes it with no command line. */
  private trimHeld(by: string): void {
    const h = this.held!;
    const keep = rounded(h.keep);
    this.held = null;
    if (this.ctx.run) {
      const done = this.ctx.run(callText("trim", [h.surface, by, keep]));
      const after = () => this.ctx.requestRender();
      if (done instanceof Promise) void done.then(after);
      else after();
      return;
    }
    trimSurface(this.ctx.model, h.surface, by, keep);
    this.ctx.requestRender();
  }

  /** The piece of `curve` a press at `at` would take, as fractions along it — or why none. */
  private look(curve: string, at: number[]): Hover {
    const model = this.ctx.model;
    try {
      const { lo, hi } = trimPiece(model, curve, at);
      const kind = model.entities.get(curve)!.kind;
      const a = lo ? lo.t : 0;
      let b = hi ? hi.t : 1;
      if (kind === "circle" && b <= a) b += 1;
      return { curve, at, piece: [a, b], why: null };
    } catch (e) {
      return { curve, at, piece: null, why: e instanceof Error ? e.message : String(e) };
    }
  }

  onMove(p: PointerInfo): void {
    const curve = curveUnder(this.ctx, p);
    const was = this.hover;
    this.hover = curve ? this.look(curve, p.world) : null;
    const key = (h: Hover | null) => (h ? `${h.curve}:${h.piece?.join(",") ?? h.why}` : "");
    if (key(was) !== key(this.hover)) this.ctx.requestRender();
  }

  onDown(p: PointerInfo): void {
    const curve = curveUnder(this.ctx, p);
    if (this.held) {
      // The cutter: a curve, or another surface.
      const other = curve ? null : this.surfaceAt(p);
      if (curve) return this.trimHeld(curve);
      if (other && other.surface !== this.held.surface) return this.trimHeld(other.surface);
      if (other) {
        // The same surface again: the place to keep, moved.
        this.held = { surface: other.surface, keep: other.at };
        this.ctx.requestRender();
        return;
      }
      this.guide(`click the curve or the surface that cuts ${this.held.surface} — Escape puts it down`);
      return;
    }
    if (!curve) {
      const s = this.surfaceAt(p);
      if (s) {
        this.held = { surface: s.surface, keep: s.at };
        this.ctx.requestRender();
        return;
      }
      this.guide("click on a line, arc or circle — the piece under the click goes — or on a surface, where it is kept");
      return;
    }
    const h = this.look(curve, p.world);
    this.hover = h;
    if (!h.piece) {
      this.guide(h.why ?? `${curve} has no piece to trim there`);
      return;
    }
    const at = rounded(p.world);
    const model = this.ctx.model;
    if (this.ctx.run) {
      const done = this.ctx.run(callText("trim", [curve, at]));
      const after = () => { this.hover = null; this.ctx.requestRender(); };
      if (done instanceof Promise) void done.then(after);
      else after();
      return;
    }
    trim(model, curve, at);
    this.hover = null;
    this.ctx.requestSolve();
  }

  onCancel(): void {
    this.hover = null;
    this.held = null;
    this.ctx.requestRender();
  }

  /** Escape with a surface in hand puts it down, and keeps the tool. */
  clear(): boolean {
    if (!this.held) return false;
    this.held = null;
    this.ctx.requestRender();
    return true;
  }

  private guide(text: string): void {
    this.ctx.requestRender();
    if (!this.ctx.log) throw new Error(text);
    this.ctx.log(`trim: ${text}`, "guide");
  }

  /** The piece a click would take, in the cut's red; where there is none, the curve as it is, thin. */
  render(r: RenderContext): void {
    if (this.held) {
      // The side kept: a ring where it was pressed, in the tools' green.
      const [x, y] = r.worldToScreen(this.held.keep);
      const g = r.g, ui = r.ui ?? 1;
      g.save();
      g.strokeStyle = "#5fbf7a";
      g.lineWidth = 2 * ui;
      g.beginPath();
      g.arc(x, y, 7 * ui, 0, Math.PI * 2);
      g.moveTo(x - 3 * ui, y);
      g.lineTo(x + 3 * ui, y);
      g.moveTo(x, y - 3 * ui);
      g.lineTo(x, y + 3 * ui);
      g.stroke();
      g.restore();
    }
    const h = this.hover;
    if (!h || !this.ctx.model.entities.has(h.curve)) return;
    const model = this.ctx.model;
    if (h.piece) {
      strokeWorld(r, pieceSamples(model, h.curve, h.piece[0], h.piece[1]), SUBTRACT_RED, 4);
      return;
    }
    // Nothing cuts it: dashed, thin — "this, but not like this".
    strokeWorld(r, pieceSamples(model, h.curve, 0, 1), SUBTRACT_RED, 1.5, [4, 4]);
  }
}
