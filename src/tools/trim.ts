// The trim tool (docs/plans/sketch-edit.md): click the piece to remove. A curve
// under the cursor shows, in the cut's red, the piece of it between the curves
// that cut it either side of the cursor — or up to its own end where nothing
// cuts it that way — and a click removes that piece: it types `trim("l1",
// [x, y, z])`, one line, one undo step, as a person could have typed it. A
// curve nothing cuts says so (and that `del` removes it whole), muted; the
// tool stays armed, for the next piece, as Onshape's trim does. Every sketch
// curve trims (docs/plans/trim-everything.md): a line, an arc, a circle, an
// ellipse, an elliptical arc, a spline and the piece of one.
//
// **Power trim** (docs/plans/trim-everything.md, SolidWorks's): press and drag
// across the drawing, and every piece the stroke crosses goes. The stroke is
// drawn as it is dragged and each piece turns red as it is crossed — read off
// the drawing as it was at the press — and the release types them all as one
// entry, one `trim` per piece: `trim("l1", [..]); trim("l2", [..])`, one undo
// step. So a click trims on its **release**, not its press: a press is the
// start of a stroke until it has not moved. By finger this is the natural
// gesture — a drag with a tool armed is the tool's, never a pan (gestures.ts).
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

import { Tool, press, type Hand, type PointerInfo, type RenderContext, type How } from "./tool.ts";
import { callText } from "./feature.ts";
import { SUBTRACT_RED } from "./regiontool.ts";
import { anyCurve, curveUnder, ownedBySolid, pieceSamples, rounded, strokeWorld } from "./editdraw.ts";
import { trim, trimPiece } from "../sketchedit.ts";
import { strokeCrossings } from "../sketchgeom.ts";
import { trimSurface } from "../surfaces.ts";
import { isClosedEntity, type Model } from "../model.ts";

/** What the cursor is over: a curve, and either the piece a click would take or why there is none. */
interface Hover {
  curve: string;
  at: number[];
  piece: [number, number] | null;
  why: string | null;
}

/** A piece a stroke crossed: where, which piece (fractions along the curve), and how it is drawn red. */
interface Crossed {
  curve: string;
  at: number[];
  piece: [number, number];
  /** Where the piece starts along its curve, as the cuts give it — what orders the trims of one curve. */
  lo: number;
  samples: number[][];
}

/** A press: where it landed, and — once it has moved — the stroke it became. */
interface Stroke {
  down: PointerInfo;
  last: PointerInfo;
  moved: boolean;
  path: number[][];
  crossed: Crossed[];
}

/**
 * How far a press must travel, in screen pixels, to be a stroke and not a
 * click — the engine's own drag threshold for a mouse (a finger's slop was
 * already spent by the recogniser before the press reached the tool).
 */
const STROKE_PX = 3;

/**
 * The order a stroke's pieces are typed in, so that every name typed is the
 * curve the piece is on when its turn comes. A trim keeps a curve's name on
 * the part from its start, and a new name goes only to the part after a
 * middle piece — so one curve's pieces are typed **from its far end back**,
 * each then on the part that kept the name. A closed curve's first trim opens
 * it from the cut after that piece round to the cut before it, so the rest
 * are ordered the same way along what is left. Curves in the order the stroke
 * first crossed them.
 */
export function strokeOrder(model: Model, crossed: readonly Crossed[]): Crossed[] {
  const byCurve = new Map<string, Crossed[]>();
  for (const c of crossed) byCurve.set(c.curve, [...(byCurve.get(c.curve) ?? []), c]);
  const out: Crossed[] = [];
  for (const [curve, list] of byCurve) {
    const e = model.entities.get(curve);
    if (!e || !isClosedEntity(e)) {
      out.push(...[...list].sort((a, b) => b.lo - a.lo));
      continue;
    }
    const [first, ...rest] = list;
    const from = first.piece[1] % 1;
    const along = (c: Crossed) => ((((c.lo - from) % 1) + 1) % 1);
    out.push(first, ...rest.sort((a, b) => along(b) - along(a)));
  }
  return out;
}

export class TrimTool extends Tool {
  static readonly summary = "Trims a curve back to where others cut it: click or drag across pieces";
  static readonly how: How = [
    "{Tap} the piece of a curve to remove.",
    "Or drag across several pieces at once.",
  ];
  readonly name = "trim";
  readonly snaps = false;
  private hover: Hover | null = null;
  /** A surface in hand, and the place on it to keep, until a cutter is clicked. */
  private held: { surface: string; keep: number[] } | null = null;
  private stroke: Stroke | null = null;

  next(hand: Hand): string {
    if (this.held) return `${press(hand)} the curve or surface to trim ${this.held.surface} by`;
    // Short: the phone's chip is one line (docs/plans/spline.md found a longer one wrapped).
    // A surface is offered only where there is one to trim.
    if (this.ctx.model.surfaces.size) return `${press(hand)} a piece to trim it, drag across pieces, or a surface where it is kept`;
    return `${press(hand)} a piece to trim it, or drag across pieces`;
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
      const closed = isClosedEntity(model.entities.get(curve)!);
      const a = lo ? lo.t : 0;
      let b = hi ? hi.t : 1;
      if (closed && b <= a) b += 1;
      return { curve, at, piece: [a, b], why: null };
    } catch (e) {
      return { curve, at, piece: null, why: e instanceof Error ? e.message : String(e) };
    }
  }

  onMove(p: PointerInfo): void {
    const s = this.stroke;
    if (s) {
      if (!s.moved && Math.hypot(p.screen[0] - s.down.screen[0], p.screen[1] - s.down.screen[1]) > STROKE_PX) {
        s.moved = true;
        this.hover = null;
      }
      if (s.moved) {
        this.cross(s.last.world, p.world);
        s.last = p;
        s.path.push(p.world);
        this.ctx.requestRender();
      }
      return;
    }
    const curve = curveUnder(this.ctx, p, anyCurve);
    const was = this.hover;
    this.hover = curve ? this.look(curve, p.world) : null;
    const key = (h: Hover | null) => (h ? `${h.curve}:${h.piece?.join(",") ?? h.why}` : "");
    if (key(was) !== key(this.hover)) this.ctx.requestRender();
  }

  /** The pieces the stroke's latest step crossed, each once, red from now on. */
  private cross(a: number[], b: number[]): void {
    const model = this.ctx.model;
    const s = this.stroke!;
    const curves = [...model.entities.values()]
      .filter((e) => anyCurve(e) && !model.hidden.has(e.name) && !ownedBySolid(model, e.name)).map((e) => e.name);
    for (const hit of strokeCrossings(model, a, b, curves)) {
      const h = this.look(hit.curve, hit.at);
      if (!h.piece) continue;
      const [lo, hi] = h.piece;
      const same = (c: Crossed) => c.curve === hit.curve && Math.abs(c.piece[0] - lo) < 1e-9 && Math.abs(c.piece[1] - hi) < 1e-9;
      if (s.crossed.some(same)) continue;
      s.crossed.push({ curve: hit.curve, at: hit.at, piece: [lo, hi], lo, samples: pieceSamples(model, hit.curve, lo, hi) });
    }
  }

  onDown(p: PointerInfo): void {
    if (this.held) {
      const curve = curveUnder(this.ctx, p, anyCurve);
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
    // A press on a surface, away from any curve, takes it in hand; anything
    // else is the start of a click or a stroke, decided on the release.
    if (!curveUnder(this.ctx, p, anyCurve)) {
      const s = this.surfaceAt(p);
      if (s) {
        this.held = { surface: s.surface, keep: s.at };
        this.ctx.requestRender();
        return;
      }
    }
    this.stroke = { down: p, last: p, moved: false, path: [p.world], crossed: [] };
  }

  onUp(p: PointerInfo): void {
    const s = this.stroke;
    if (!s) return;
    this.stroke = null;
    if (s.moved) {
      this.cross(s.last.world, p.world);
      this.strokeTrim(s.crossed);
      return;
    }
    this.clickTrim(s.down);
  }

  /** A click: the piece under it goes. */
  private clickTrim(p: PointerInfo): void {
    const curve = curveUnder(this.ctx, p, anyCurve);
    if (!curve) {
      this.guide("click on a curve — the piece under the click goes — drag across pieces, or press a surface where it is kept");
      return;
    }
    const h = this.look(curve, p.world);
    this.hover = h;
    if (!h.piece) {
      this.guide(h.why ?? `${curve} has no piece to trim there`);
      return;
    }
    this.type([[curve, rounded(p.world)]]);
  }

  /** A stroke: every piece it crossed, one entry. */
  private strokeTrim(crossed: Crossed[]): void {
    if (!crossed.length) {
      this.ctx.requestRender();
      this.guide("the stroke crossed no piece to trim — drag across the pieces to remove");
      return;
    }
    this.type(strokeOrder(this.ctx.model, crossed).map((c) => [c.curve, rounded(c.at)] as [string, number[]]));
  }

  /** Types the trims as one entry — one undo step — or makes them with no command line. */
  private type(trims: [string, number[]][]): void {
    const model = this.ctx.model;
    if (this.ctx.run) {
      const done = this.ctx.run(trims.map(([curve, at]) => callText("trim", [curve, at])).join("; "));
      const after = () => { this.hover = null; this.ctx.requestRender(); };
      if (done instanceof Promise) void done.then(after);
      else after();
      return;
    }
    for (const [curve, at] of trims) trim(model, curve, at);
    this.hover = null;
    this.ctx.requestSolve();
  }

  onCancel(): void {
    this.hover = null;
    this.held = null;
    this.stroke = null;
    this.ctx.requestRender();
  }

  /** Escape with a surface in hand puts it down, and keeps the tool; mid-stroke, it drops the stroke. */
  clear(): boolean {
    if (this.stroke) {
      this.stroke = null;
      this.ctx.requestRender();
      return true;
    }
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

  /** The piece a click would take, in the cut's red; where there is none, the curve as it is, thin. A stroke, and what it crossed. */
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
    const s = this.stroke;
    if (s?.moved) {
      for (const c of s.crossed) strokeWorld(r, c.samples, SUBTRACT_RED, 4);
      // The stroke itself, thin and dashed: where the hand went, not geometry.
      strokeWorld(r, s.path, STROKE_GREY, 1.5, [5, 4]);
      return;
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

/** The power-trim stroke's colour: a neutral mid grey, readable on the light and the dark canvas alike. */
const STROKE_GREY = "#8a8f98";
