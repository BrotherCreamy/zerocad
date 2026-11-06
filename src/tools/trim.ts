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

import { Tool, press, type Hand, type PointerInfo, type RenderContext } from "./tool.ts";
import { callText } from "./feature.ts";
import { SUBTRACT_RED } from "./regiontool.ts";
import { curveUnder, pieceSamples, rounded, strokeWorld } from "./editdraw.ts";
import { trim, trimPiece } from "../sketchedit.ts";

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

  next(hand: Hand): string {
    return `${press(hand)} the piece to trim away`;
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
    if (!curve) {
      this.guide("click on a line, arc or circle — the piece under the click goes");
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
    this.ctx.requestRender();
  }

  private guide(text: string): void {
    this.ctx.requestRender();
    if (!this.ctx.log) throw new Error(text);
    this.ctx.log(`trim: ${text}`, "guide");
  }

  /** The piece a click would take, in the cut's red; where there is none, the curve as it is, thin. */
  render(r: RenderContext): void {
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
