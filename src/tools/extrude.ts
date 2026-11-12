// Click inside closed regions, see the solids, and confirm.
//
// Onshape's extrude: armed — from the toolbar, typed, or with regions already
// selected on the canvas, which it starts from — it lights every region a click
// could take and outlines the one under the cursor (the loop and every loop
// inside it, the very profile a click would take, holes left clear). A click
// **toggles** a region into the selection; several may be selected. The solids
// they would make are drawn as they will be built, translucent, and follow the
// depth as it changes — in the options panel, as it is typed. ✓, Enter, or a
// second click on the region picked last builds them all as one undo step and
// leaves the tool armed with nothing picked; ✗ or Escape drops the selection
// (see feature.ts for the shared machinery). The region is what `loopAt`
// finds: the innermost loop the click is inside, then the nearest — so a
// click on an island takes the island, a click between it and the outline
// takes the outline with its hole, and a click on a solid's lid takes the lid.
//
// **What it builds is typed**, a line per region: `extrude("l1", 25)`, the
// shortest call that names that region (`regionNaming`) — with the frame that
// narrows it when every member is shared with another plane's loop (a lid's
// edges are walls' too), and the profile resolved when every member is shared
// in its own plane (one half of a split rectangle). A region running through a
// crossing no point marks yet, every member shared, is the one thing no typed
// line can name — a typed profile names points, and a crossing is not one
// until an extrude makes it one — so that region alone is extruded by calling
// the operation, which journals the same entry and the log reports as
// `e1  extrude of …`.
//
// **A click proposes the loops inside; a click on one of them takes it out.**
// A region's membership is what the user confirmed (docs/plans/explicit-
// regions.md; the owner: *"I don't think coplanarity should be used as an
// automatic basis for deciding which entities to include in a region"*, and on
// the proposal, *"do what you think is best"*). So the click between the
// holes and the outline proposes the outline with every loop inside it, as it
// always did — that is the proposal, and the preview shows it — and the
// record keeps exactly what ✓ built: nothing drawn inside later joins it. Once
// a region is picked, **a click on one of its holes** (a loop an odd number of
// loops down, so empty by even-odd), **or anywhere inside a hole already taken
// out, toggles that hole out of the proposal and back in**; the preview fills
// it, and ✓ types the loops outright — `extrude("l1", 10, "f1", [[…]])` —
// since the short form would take them all. **A click on an island that is
// solid** (an even number of loops down) **is still a region of its own**, a
// second solid, as it always was. Before anything is picked a click inside a
// hole picks the hole's own region, as ever. Later, `hole`/`unhole` and the
// edit dialog (edit.ts) change what a feature's region holds.
//
// **A region no frame orients gets its plane first, typed.** An extrude runs
// along a frame's +z, and a rectangle drawn in a fresh model has none — the
// owner's first run, refused eight times. A frame of three of the loop's own
// points is the sketch's own plane, not a datum nobody chose (it is what
// "Sketch on this face" makes), so the confirm types it — `plane(a, b, c, {
// look: false })`, or `frame(a, b, c)` beside a default it keeps — ahead of the
// region's extrude, in the same user action. The view does not turn.
//
// **A miss is guidance.** A click in no region says so in a line — "click
// inside a closed outline — the ones I can see are lit" — muted, the tool still
// armed.

import { defineTool, type FeatureStep, type PointerInfo, type RegionHit, type RenderContext } from "./tool.ts";
import { formatValue, type OptionSpecs } from "./options.ts";
import { DEFAULT_DEPTH, extrude, extrudeProfile, orientingPlane, profileOf, profileOfLoops, regionNaming, regionOf, regionProfile } from "../operations.ts";
import { materialWay } from "../modes.ts";
import { planeAxes } from "../curveplane.ts";
import type { Model } from "../model.ts";
import { memberName } from "../model.ts";
import { REGION_GREEN, drawHit, lightRegions, missedRegion, namedRegionAt, outlineLoops, regionKey } from "./region.ts";
import { featureFaces } from "../faces.ts";
import { sub3, unit3 } from "../vec3.ts";
import { niceStep } from "../activeplane.ts";

import { DEPTH_OPTION, END_OPTION, FeatureTool, MODE_OPTION, callText, featureOptions, foundRegion, uptoPickAt, type UptoPick } from "./feature.ts";
import type { FeatureOptions } from "../operations.ts";
import { RegionSelection, leftOut } from "./selection.ts";

/**
 * The steps that extrude `region` `depth` deep: its plane if it needs one, then
 * the shortest typed call that names it — or, with holes clicked out of the
 * proposal (`without`, points inside them), the call that names its loops
 * outright, `extrude("l1", 10, "f1", [[…], […]])`, which takes exactly those.
 */
export function extrudeSteps(region: RegionHit, depth: number, typed: boolean, without: readonly number[][] = [],
                             options: FeatureOptions | null = null): FeatureStep[] {
  // The mode, when one was chosen: typed last, as the call takes it.
  const tail = options ? [options] : [];
  return [(m): ReturnType<FeatureStep> => {
    const r = foundRegion(m, region);
    // Inside a named region the click took the region: `extrude("rg1", 10)`.
    const named = namedRegionAt(m, r);
    if (named) return { text: callText("extrude", [named, depth, ...tail]), direct: () => extrude(m, named, depth, ...tail) };
    const out = leftOut(m, r, without);
    if (out.size) {
      const p = profileOfLoops(m, r.loops, regionOf(r.loops, r.index).filter((i) => !out.has(i)),
        orientingPlane(m, r.loops[r.index], region.toward));
      if (p.crossings?.size) return { call: () => { extrudeProfile(m, p, depth, options ?? {}); } };
      const member = memberName(p.loops[0][0]);
      return {
        text: callText("extrude", [member, depth, p.frame, p.loops, ...tail]),
        direct: () => extrude(m, member, depth, p.frame, p.loops, ...tail),
      };
    }
    const n = regionNaming(m, r.loops, r.index, region.toward);
    if (!n) {
      return { call: () => { extrudeProfile(m, profileOf(m, r.loops, r.index, orientingPlane(m, r.loops[r.index], region.toward)), depth, options ?? {}); } };
    }
    const args: unknown[] = [n.member, depth];
    if (n.frame !== null || n.loops !== null) args.push(n.frame);
    if (n.loops !== null) args.push(n.loops);
    return { text: callText("extrude", [...args, ...tail]), direct: () => extrude(m, n.member, depth, n.frame, n.loops, null, ...tail) };
  }];
}

/** What an up-to-face end still wants, said the same way wherever it is asked. */
const UPTO_ASK = "up to face: press the face it ends on";

export class ExtrudeTool extends FeatureTool {
  // Negative is allowed — the other way along +z, as the typed call takes it,
  // and what the panel's ⇅ types; zero is no solid at all.
  static readonly options: OptionSpecs = {
    depth: DEPTH_OPTION,
    end: END_OPTION,
    mode: MODE_OPTION,
  };
  static readonly summary: string = "Pulls a closed shape into a solid: click inside it, then ✓";
  readonly name: string = "extrude";
  private under: RegionHit | null = null;
  /** The regions picked, in the order picked. */
  readonly picks = new RegionSelection();
  /** The depth handle, where it was last drawn — what a press near it grabs. Null while there is none. */
  private handle: DepthHandle | null = null;
  /**
   * A drag of the handle: where it was pressed, the depth then, and the
   * handle's way on screen and its pixels per unit of depth then — fixed for
   * the whole drag, as the fillet's label drag fixes its way (blend.ts), so a
   * preview landing mid-drag cannot turn the finger's motion round.
   */
  private drag: { from: [number, number]; start: number; dir: [number, number]; perUnit: number; step: number } | null = null;
  /** The depth a drag of the handle has reached, laid over the options until it is let go. */
  private dragged: number | null = null;
  /**
   * Up to face (docs/plans/through-all-relation.md): the face the end row's
   * one extra press landed on. Asked for once a region is picked and the end
   * row says Up to face; kept until the picks go.
   */
  protected upto: UptoPick | null = null;

  protected values(): Record<string, unknown> {
    const v = super.values();
    return this.dragged === null ? v : { ...v, depth: this.dragged };
  }

  /** "✓ to cut" when the mode row says Cut — the chip said "✓ to extrude" whatever it would do (W8). */
  protected get verb(): string {
    const m = this.values().mode;
    return m === "cut" ? "cut" : m === "intersect" ? "intersect" : "extrude";
  }

  /** Whether a screen point is on the handle: its shaft, its head, or its label, a finger's reach. */
  private onHandle(at: [number, number]): boolean {
    const h = this.handle;
    if (!h) return false;
    const reach = HANDLE_REACH * h.ui;
    const [ax, ay] = h.from, [bx, by] = h.label;
    const [dx, dy] = [bx - ax, by - ay];
    const t = Math.max(0, Math.min(1, ((at[0] - ax) * dx + (at[1] - ay) * dy) / Math.max(1e-9, dx * dx + dy * dy)));
    return Math.hypot(at[0] - (ax + t * dx), at[1] - (ay + t * dy)) <= reach;
  }

  /** Armed, the depth is always here and checked; the fallback is for a tool driven with no engine. */
  private depthOf(values: Record<string, unknown>): number {
    const d = values.depth;
    return typeof d === "number" && Number.isFinite(d) && d !== 0 ? d : DEFAULT_DEPTH;
  }

  onArmed(): void {
    const given = this.ctx.preselected ?? [];
    if (given.length) {
      this.picks.adopt(given);
      this.ctx.requestRender();
    }
  }

  protected plan(values: Record<string, unknown>): FeatureStep[] | null {
    if (!this.picks.size) return null;
    // Up to face with no face yet is not a plan: `wanting` says what is missing.
    if (values.end === "upto" && !this.upto) return null;
    const depth = this.depthOf(values);
    const typed = !!this.ctx.perform;
    const options = featureOptions(values, this.upto);
    // Two clicks inside one named region are one region, extruded once.
    const seen = new Set<string>();
    return this.picks.regions.flatMap((r, i) => {
      const named = namedRegionAt(this.ctx.model, r);
      if (named) {
        if (seen.has(named)) return [];
        seen.add(named);
      }
      return extrudeSteps(r, depth, typed, this.picks.without(i), options);
    });
  }

  protected picksKey(): string {
    return `${this.picks.key()}${this.upto ? `>${this.upto.face}@${this.upto.at?.join(",") ?? ""}` : ""}`;
  }

  protected wanting(): string | null {
    // Nothing picked is the only other way to be short of an extrude.
    return this.picks.size && this.values().end === "upto" && !this.upto ? UPTO_ASK : null;
  }

  onMove(p: PointerInfo): void {
    if (this.drag) {
      const d = this.drag;
      const along = (p.screen[0] - d.from[0]) * d.dir[0] + (p.screen[1] - d.from[1]) * d.dir[1];
      this.dragged = draggedDepth(d.start, along / d.perUnit, d.step);
      this.ctx.requestRender();
      return;
    }
    // Over the handle nothing else is lit: a press there drags the depth.
    const next = this.onHandle(p.screen) ? null : this.ctx.regionAt?.(p.screen) ?? null;
    if (regionKey(next) === regionKey(this.under)) { this.under = next; return; }
    this.under = next;
    this.ctx.requestRender();
  }

  onUp(): void {
    if (!this.drag) return;
    this.drag = null;
    const v = this.dragged;
    if (v === null) return;
    // Let go: the depth becomes the option's, typed as the panel's field types
    // it — so the panel shows it, the log has it, and the picks stay.
    const line = `arm(${JSON.stringify(this.name)}, {depth: ${formatValue(v)}})`;
    const done = () => { this.dragged = null; this.ctx.requestRender(); };
    if (this.ctx.run) void Promise.resolve(this.ctx.run(line)).then(done, done);
    else {
      this.ctx.options = { ...this.ctx.options, depth: v };
      done();
    }
  }

  protected dropPicks(): boolean {
    this.handle = null;
    this.drag = null;
    this.dragged = null;
    this.under = null;
    this.upto = null;
    return this.picks.clear();
  }

  onDown(p: PointerInfo): void {
    if (this.handle && this.onHandle(p.screen)) {
      const h = this.handle;
      this.drag = { from: p.screen, start: this.depthOf(this.values()), dir: h.dir, perUnit: h.perUnit, step: h.step };
      this.under = null;
      return;
    }
    // Up to face: with a region picked and no face yet, this press is the
    // face — before it is read as a region, since a face of a solid is where
    // regions are. A press on a face that is in no region takes it again.
    const hit = this.ctx.regionAt?.(p.screen) ?? null;
    if (this.values().end === "upto" && this.picks.size && (!this.upto || !hit)) {
      const face = uptoPickAt(this.ctx, p.screen);
      if (face) {
        this.upto = face;
        this.guide(`up to ${face.face} — ✓ to ${this.verb}`);
        this.ctx.requestRender();
        return;
      }
      if (!this.upto) {
        this.guide(UPTO_ASK);
        return;
      }
    }
    if (!hit) {
      this.guide(missedRegion(this.ctx.model));
      return;
    }
    if (this.picks.toggle(this.ctx.model, hit) === "again") {
      this.confirm();
      return;
    }
    this.ctx.requestRender();
  }

  /**
   * Every region a click could take, lit faintly; the picked ones a shade
   * stronger; the one under the cursor outlined — exactly the profile a click
   * would take; and over all of it the solids a confirm would build.
   */
  render(r: RenderContext): void {
    const model = this.ctx.model;
    lightRegions(model, r, this.under);
    this.picks.refresh(model).forEach((picked, i) => {
      const out = leftOut(model, picked, this.picks.without(i));
      drawHit(model, r, picked, "40", undefined, out);
      // A hole clicked out stays outlined, so it can be clicked back in.
      outlineLoops(model, r, picked.loops, [...out]);
    });
    if (this.under) drawHit(model, r, this.under);
    this.renderPreview(r);
    this.renderHandle(r);
  }

  /**
   * **The depth handle** (docs/plans/solid-tools-intuitive.md; Onshape's
   * manipulator is the model): an arrow standing off the previewed lid the way
   * the solid goes, with the depth on its label — so which way and how far are
   * on the drawing, not only in the panel. A finger or the mouse drags it along
   * its own line; the depth follows, snapping to round values (`depthStep`),
   * and through zero it flips. Seen square on, where an arrow along the line of
   * sight has no length, the lid shows ⊙ (towards you) or ⊗ (away) instead,
   * and the panel's ⇅ is the way to turn it. None for through all, whose depth
   * is the body's, not a number to drag.
   */
  private renderHandle(r: RenderContext): void {
    this.handle = null;
    const p = this.previewed();
    if (!p?.model || this.values().end === "through" || this.values().end === "upto") return;
    const ui = r.ui ?? 1;
    let lid: number[] | null = null, base: number[] | null = null;
    for (const name of p.features) {
      const f = p.model.features.get(name);
      if (f?.kind !== "extrude") continue;
      try {
        const faces = featureFaces(p.model, f, r.scale);
        lid = faces.find((x) => x.kind === "lid")?.centroid ?? null;
        base = faces.find((x) => x.kind === "base")?.centroid ?? null;
      } catch {
        lid = null;
      }
      if (lid && base) break;
    }
    if (!lid || !base) return;
    const way = unit3(sub3(lid, base));
    if (!way) return;
    const [lx, ly] = r.worldToScreen(lid);
    const [tx, ty] = r.worldToScreen(lid.map((c, i) => c + way[i]));
    const perUnit = Math.hypot(tx - lx, ty - ly);
    const g = r.g;
    const depth = this.depthOf(this.values());
    const text = formatValue(Math.abs(depth));
    g.save();
    g.strokeStyle = HANDLE_INK;
    g.fillStyle = HANDLE_INK;
    g.lineWidth = 2 * ui;
    g.lineCap = "round";
    if (perUnit < SQUARE_ON_PX * r.scale) {
      // Square on: the way is along the line of sight — out at the viewer or away.
      const toward = r.toward ?? [0, 0, 1];
      const out = way.reduce((s, c, i) => s + c * (toward[i] ?? 0), 0) > 0;
      const rad = 7 * ui;
      g.beginPath();
      g.arc(lx, ly, rad, 0, 2 * Math.PI);
      g.stroke();
      g.beginPath();
      if (out) g.arc(lx, ly, 2 * ui, 0, 2 * Math.PI), g.fill();
      else {
        const k = rad * 0.6;
        g.moveTo(lx - k, ly - k); g.lineTo(lx + k, ly + k);
        g.moveTo(lx + k, ly - k); g.lineTo(lx - k, ly + k);
        g.stroke();
      }
      this.labelAt(g, text, [lx + rad + 14 * ui, ly], ui);
      g.restore();
      return;
    }
    const dir: [number, number] = [(tx - lx) / perUnit, (ty - ly) / perUnit];
    const len = HANDLE_PX * ui;
    const tip: [number, number] = [lx + dir[0] * len, ly + dir[1] * len];
    g.beginPath();
    g.moveTo(lx, ly);
    g.lineTo(tip[0], tip[1]);
    g.stroke();
    // The head: two barbs back from the tip.
    const [bx, by] = [-dir[0] * 7 * ui, -dir[1] * 7 * ui];
    const [nx, ny] = [-dir[1] * 5 * ui, dir[0] * 5 * ui];
    g.beginPath();
    g.moveTo(tip[0] + bx + nx, tip[1] + by + ny);
    g.lineTo(tip[0], tip[1]);
    g.lineTo(tip[0] + bx - nx, tip[1] + by - ny);
    g.stroke();
    const label: [number, number] = [tip[0] + dir[0] * 16 * ui, tip[1] + dir[1] * 16 * ui];
    this.labelAt(g, text, label, ui);
    g.restore();
    // A symmetric extrude's lid moves half what its depth does.
    const half = this.values().end === "symmetric" ? 0.5 : 1;
    this.handle = { from: [lx, ly], label, dir, perUnit: perUnit * half, step: depthStep(perUnit * half), ui };
  }

  private labelAt(g: CanvasRenderingContext2D, text: string, at: [number, number], ui: number): void {
    g.font = `${12 * ui}px ui-monospace, monospace`;
    const w = g.measureText(text).width + 10 * ui, h = 18 * ui;
    g.fillStyle = this.drag ? "#2f6b45" : "#1d3a2a";
    g.fillRect(at[0] - w / 2, at[1] - h / 2, w, h);
    g.lineWidth = 1.2 * ui;
    g.strokeRect(at[0] - w / 2, at[1] - h / 2, w, h);
    g.fillStyle = "#e6f4ea";
    g.textAlign = "center";
    g.textBaseline = "middle";
    g.fillText(text, at[0], at[1] + 0.5);
  }
}

/** Where the depth handle is: the lid's centre and its label on screen, its way, and how a drag along it reads. */
interface DepthHandle {
  from: [number, number];
  label: [number, number];
  dir: [number, number];
  perUnit: number;
  step: number;
  ui: number;
}

/** The handle's ink: the previews' green, the colour of what ✓ builds. */
const HANDLE_INK = REGION_GREEN;
/** How long the handle's arrow is on screen, in pixels at 100 %. */
const HANDLE_PX = 44;
/** How far from the handle a press still grabs it, in pixels at 100 % — the fillet label's reach. */
const HANDLE_REACH = 16;
/**
 * A lid whose way is shorter than this fraction of a unit on screen is seen
 * square on: an arrow along the line of sight would have no length.
 */
const SQUARE_ON_PX = 0.15;
/** The least a drag's snap is on screen, in pixels: finer steps than this a hand cannot place. */
const SNAP_PX = 6;

/**
 * The round values a drag of the depth snaps to: the first of 1, 2 and 5 ×
 * 10ⁿ that is at least `SNAP_PX` on screen at `perUnit` pixels per unit — so
 * zoomed out a drag goes in fives or tens, zoomed in in tenths (vetoable).
 */
export function depthStep(perUnit: number): number {
  return niceStep(SNAP_PX / Math.max(1e-9, perUnit));
}

/**
 * A depth dragged `by` units along the way the solid goes from `start`:
 * deeper along it, shallower against it, and **through zero to the other
 * side** — a flip — snapped to `step`, and never 0 (no solid), which snaps a
 * step on in the way the drag is going.
 */
export function draggedDepth(start: number, by: number, step: number): number {
  const raw = start + Math.sign(start || 1) * by;
  let v = Math.round(raw / step) * step;
  if (v === 0) v = (raw > 0 || (raw === 0 && start > 0) ? 1 : -1) * step;
  return Math.round(v * 1e6) / 1e6;
}


// ---- Cut ---------------------------------------------------------------------

/**
 * The diagonal of everything drawn, and a unit more: how far a through-all
 * cut's probes walk, when the reach it will have is only known once it is made.
 */
function drawingSpan(m: Model): number {
  const lo = [Infinity, Infinity, Infinity], hi = [-Infinity, -Infinity, -Infinity];
  for (const e of m.entities.values()) {
    if (e.kind !== "point") continue;
    m.coords(e.name).forEach((c, i) => { lo[i] = Math.min(lo[i], c); hi[i] = Math.max(hi[i], c); });
  }
  return Number.isFinite(lo[0]) ? Math.hypot(hi[0] - lo[0], hi[1] - lo[1], hi[2] - lo[2]) + 1 : 1;
}

/**
 * Which way a cut of `region` goes into the material, `depth` deep and ending
 * as `end` says, on the model as it stands — `materialWay` asked of the profile
 * the extrude would take, along the plane it would run along (a named region's
 * own, else `orientingPlane`'s with the viewer's side, as `extrudeSteps` types
 * it). `+1` along that plane's normal, `-1` against; `reaches` false when no
 * way meets any solid. A symmetric cut goes both ways, so only whether it
 * reaches anything is asked.
 */
export function cutWay(m: Model, region: RegionHit, depth: number, end: unknown): { way: 1 | -1; reaches: boolean } {
  let r: RegionHit, profile;
  try {
    r = foundRegion(m, region);
    const named = namedRegionAt(m, r);
    profile = named ? regionProfile(m, named) : profileOf(m, r.loops, r.index, orientingPlane(m, r.loops[r.index], region.toward));
  } catch {
    return { way: 1, reaches: false };
  }
  const plane = planeAxes(m, profile.frame);
  if (!plane) return { way: 1, reaches: false };
  // Up to a face reaches as far as through all may: the call turns it toward its face itself.
  const reach = end === "through" || end === "upto" ? drawingSpan(m) : end === "symmetric" ? Math.abs(depth) / 2 : Math.abs(depth);
  const found = materialWay(m, plane, profile.loops, r.at, reach);
  return end === "symmetric" ? { way: 1, reaches: found.reaches } : found;
}

/** What the Cut tool says, muted, when a cut it would make meets no solid — before ✓, not after. */
export const CUT_REACHES_NOTHING = "this cut doesn't reach any solid — flip it, or make it deeper";

/**
 * **Cut**, a tool of its own (docs/plans/solid-tools-intuitive.md; the owner:
 * *"I'm still not clear on how to use the extrude cut tool. It doesn't make
 * sense to me."*) — SolidWorks' Extruded Cut, Onshape's Remove — beside
 * Extrude on its button (the sweep group). Armed, it lights regions as the
 * extrude does and toggles them in the same way; its preview is the volume to
 * be removed, in the cut's red, drawn over the body it goes into.
 *
 * **The direction defaults into the material**: its depth is how far *into*
 * the solid, and which way that is along the sketch's normal is read off the
 * bodies (`cutWay`): a circle on a lid cuts down into the plate, one on the
 * ground under a block up into it — no minus sign to know about. ⇅ still flips
 * it (a negative depth goes out of the material). A cut that reaches no solid
 * says so before ✓, in the muted guidance line, and ✓ still builds it: it is
 * guidance, not a refusal.
 *
 * **What it types is the extrude call** — `extrude("c1", -10, { mode: "cut" })`,
 * with `end` when it is through all or symmetric — so files, replay and undo
 * are exactly an extrude's. The extrude's mode row stays, the expert's way.
 */
export class CutTool extends ExtrudeTool {
  static readonly options: OptionSpecs = {
    depth: { ...DEPTH_OPTION, label: "depth" },
    end: END_OPTION,
  };
  static readonly summary = "Cuts a hole or a pocket into a solid: click a closed shape, then ✓";
  readonly name: string = "cut";
  /** The picks, values and model a reach was last worked out for, and whether every cut reached a solid. */
  private reachKey = "";
  private reachesAll = true;
  /** The picks and values the guidance last spoke for. */
  private toldKey = "";

  protected get verb(): string {
    return "cut";
  }

  protected plan(values: Record<string, unknown>): FeatureStep[] | null {
    if (!this.picks.size) return null;
    const d = values.depth;
    const depth = typeof d === "number" && Number.isFinite(d) && d !== 0 ? d : DEFAULT_DEPTH;
    const typed = !!this.ctx.perform;
    const end = values.end;
    // Up to face with no face yet is not a plan (`wanting` asks for it).
    if (end === "upto" && !this.upto) return null;
    const options: FeatureOptions = { mode: "cut", ...(featureOptions(values, this.upto) ?? {}) };
    const seen = new Set<string>();
    return this.picks.regions.flatMap((r, i) => {
      const named = namedRegionAt(this.ctx.model, r);
      if (named) {
        if (seen.has(named)) return [];
        seen.add(named);
      }
      const without = this.picks.without(i);
      // Asked of the model as the step finds it — after a plane the step
      // before typed — which way is into the material, and the depth signed so.
      const step: FeatureStep = (m) => extrudeSteps(r, cutWay(m, r, depth, end).way * depth, typed, without, options)[0](m);
      return [step];
    });
  }

  /** Whether every picked region's cut reaches a solid, worked out once per picks, values and model. */
  private reaches(): boolean {
    const m = this.ctx.model;
    const v = this.values();
    const key = `${this.picksKey()}\n${JSON.stringify(v)}\n${m.journal.length}:${m.entities.size}`;
    if (key !== this.reachKey) {
      this.reachKey = key;
      const d = typeof v.depth === "number" && v.depth !== 0 ? v.depth : DEFAULT_DEPTH;
      this.reachesAll = this.picks.refresh(m).every((r) => cutWay(m, r, d, v.end).reaches);
    }
    return this.reachesAll;
  }

  render(r: RenderContext): void {
    super.render(r);
    // Not while ✓'s lines go in: the cut being made has taken the material
    // the question would look for (seen: said once after every cut).
    if (this.busy) return;
    if (!this.picks.size) {
      this.toldKey = "";
      return;
    }
    // Said once for what is picked as it is now — the guidance line, never red.
    if (!this.reaches() && this.toldKey !== this.reachKey && this.ctx.log) {
      this.toldKey = this.reachKey;
      this.ctx.log(`${this.name}: ${CUT_REACHES_NOTHING}`, "guide");
    }
  }
}
