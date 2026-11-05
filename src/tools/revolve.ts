// Click inside closed regions, then on the axis to turn them about; see the
// solids, and confirm.
//
// The extrude tool's sibling (see there, and feature.ts): armed with the one
// number the clicks cannot supply — `arm("revolve", { angle: 3 * Math.PI / 2
// })`, radians as everywhere a revolve takes an angle, a whole turn when left
// out — it takes regions first, toggled in as the extrude tool takes them
// (several may be turned about one axis), then the axis: a line, or an arm of
// a frame's marker, which picking reports with the arm it was (`Pick.axis`).
// Clicking another axis replaces it; clicking a region adds or drops it. Once
// there is a region and an axis the solids are drawn as they will be built,
// translucent, following the angle as it is typed; ✓, Enter, or a second click
// on whatever was picked last — the region or the axis — builds them, one undo
// step. ✗ or Escape drops the picks and keeps the tool armed.
//
// **A miss is guidance, and what would work is lit.** Before the first click
// every region the tool could take is lit faintly (`lightRegions`); once there
// is a profile, every line and frame arm all the picked regions could turn
// about is too (`revolveAxes`: lying in each one's plane, each to one side of
// it). A click on nothing, or on an axis that would not do, says in a line
// what would and leaves the tool where it was, in the muted guidance style.
//
// **What it builds is typed**, a line per region — `revolve("c2", "l7")`, by
// the same shortest naming the extrude tool types (`regionNaming`), the angle
// said only when it is not a whole turn — after the region's plane, typed
// first where no frame orients it, once the axis has passed the refusals that
// do not need the frame. The command line's own revolve then makes the same
// geometric refusals a typed call makes, so the tool cannot revolve anything
// the command line would not.

import { defineTool, press, type FeatureStep, type Hand, type PointerInfo, type RegionHit, type RenderContext } from "./tool.ts";
import type { OptionSpecs } from "./options.ts";
import type { Model } from "../model.ts";
import {
  checkRevolveRegion, orientingPlane, profileOfLoops, regionNaming, regionOf, revolve, revolveProfile, revolveProfileOf,
} from "../operations.ts";
import { memberName } from "../model.ts";
import type { Pick } from "../picking.ts";
import { FULL_TURN, axisReader } from "../relations/revolution.ts";
import { FRAME_ARM_PX } from "../framemarker.ts";
import {
  LIT_STROKE, REGION_GREEN, drawRegion, lightRegions, missedRegion, outlineLoops, regionKey, type Region,
} from "./region.ts";
import { FeatureTool, MODE_OPTION, callText, foundRegion, modeOptions } from "./feature.ts";
import type { FeatureOptions } from "../operations.ts";
import { RegionSelection, leftOut } from "./selection.ts";

/**
 * The axes a revolve of `region` could turn about: every line, and every arm
 * of every frame, that lies in the region's plane with the region to one side
 * of it — `checkRevolveRegion`'s own question, asked of each, so what is lit is
 * exactly what a click would be let revolve about. In creation order, a
 * frame's arms x, y, then z. Pure: model and region in, axis names out.
 */
export function revolveAxes(model: Model, region: Region): string[] {
  const found: string[] = [];
  for (const e of model.entities.values()) {
    const axes = e.kind === "line" ? [e.name]
      : e.kind === "frame" ? (model.dim === 3 ? ["x", "y", "z"] : ["x", "y"]).map((a) => `${e.name}.${a}`)
      : [];
    for (const axis of axes) {
      try {
        checkRevolveRegion(model, region.loops, region.index, axis);
        found.push(axis);
      } catch {
        // Not one it could turn about: left dark.
      }
    }
  }
  return found;
}

/**
 * The steps that revolve `region` about `axis` through `angle`: the axis
 * checked against the loop's own plane (so a refused revolve makes no plane),
 * the plane if it needs one, then the shortest typed call that names it.
 */
export function revolveSteps(region: RegionHit, axis: string, angle: number, typed: boolean,
                             without: readonly number[][] = [], options: FeatureOptions | null = null): FeatureStep[] {
  const tail = options ? [options] : [];
  return [(m) => {
    const r = foundRegion(m, region);
    checkRevolveRegion(m, r.loops, r.index, axis);
    return null;
  }, (m): ReturnType<FeatureStep> => {
    const r = foundRegion(m, region);
    // Holes clicked out of the proposal: the loops named outright, as the extrude tool does.
    const out = leftOut(m, r, without);
    if (out.size) {
      const p = profileOfLoops(m, r.loops, regionOf(r.loops, r.index).filter((i) => !out.has(i)),
        orientingPlane(m, r.loops[r.index], region.toward));
      if (p.crossings?.size) return { call: () => { revolveProfile(m, p, axis, angle, options ?? {}); } };
      const member = memberName(p.loops[0][0]);
      return {
        text: callText("revolve", [member, axis, angle, p.frame, p.loops, ...tail]),
        direct: () => revolve(m, member, axis, angle, p.frame, p.loops, ...tail),
      };
    }
    const n = regionNaming(m, r.loops, r.index, region.toward);
    if (!n) return { call: () => { revolveProfile(m, revolveProfileOf(m, r.loops, r.index, region.toward), axis, angle, options ?? {}); } };
    const args: unknown[] = [n.member, axis];
    const more = n.frame !== null || n.loops !== null;
    if (more || angle !== FULL_TURN || tail.length) args.push(angle);
    if (more) args.push(n.frame);
    if (n.loops !== null) args.push(n.loops);
    return { text: callText("revolve", [...args, ...tail]), direct: () => revolve(m, n.member, axis, angle, n.frame, n.loops, null, null, ...tail) };
  }];
}

export class RevolveTool extends FeatureTool {
  // Radians, as everywhere a revolve takes an angle; the operation's own range.
  static readonly options: OptionSpecs = {
    angle: {
      default: FULL_TURN, unit: "angle",
      check: (v) => (v === 0 || Math.abs(v as number) > FULL_TURN ? "must be within a whole turn (±6.283185) and not 0" : null),
    },
    mode: MODE_OPTION,
  };
  static readonly summary = "Spins a closed shape into a solid: click it, then the axis, then ✓";
  readonly name = "revolve";
  /** The profiles picked, in the order picked. */
  readonly picks = new RegionSelection();
  /** The axis, once one is picked, as `revolve` takes one. */
  axis: string | null = null;
  /** Which was picked last — what a second click on confirms. */
  private lastPicked: "region" | "axis" | null = null;
  /** The axes every picked profile could turn about, lit while the tool waits for one. */
  private axes: string[] = [];
  /** What `axes` was found for. */
  private axesFor = "";
  /** The region under the cursor. */
  private under: Region | null = null;
  /** The axis under the cursor, once there is a profile. */
  private axisUnder: string | null = null;

  /** Armed, the angle is always here and checked; the fallback is for a tool driven with no engine. */
  private angleOf(values: Record<string, unknown>): number {
    const a = values.angle;
    return typeof a === "number" && Number.isFinite(a) && a !== 0 && Math.abs(a) <= FULL_TURN ? a : FULL_TURN;
  }

  /** The axis a pick names: a line, or a frame's arm as `"f1.y"` — null for anything else. */
  private static axisOf(hit: Pick | null | undefined): string | null {
    if (!hit) return null;
    if (hit.kind === "line") return hit.name;
    if (hit.kind === "frame" && hit.axis) return `${hit.name}.${hit.axis}`;
    return null;
  }

  /** The axes every picked profile could turn about, found again when the picks or the model change. */
  private candidates(): string[] {
    const m = this.ctx.model;
    const key = `${this.picks.key()}\n${m.journal.length}:${m.entities.size}`;
    if (key !== this.axesFor) {
      this.axesFor = key;
      const regions = this.picks.refresh(m);
      this.axes = regions.length
        ? regions.map((r) => revolveAxes(m, r)).reduce((all, these) => all.filter((a) => these.includes(a)))
        : [];
    }
    return this.axes;
  }

  onArmed(): void {
    const given = this.ctx.preselected ?? [];
    if (given.length) {
      this.picks.adopt(given);
      this.lastPicked = "region";
      this.ctx.requestRender();
    }
  }

  protected plan(values: Record<string, unknown>): FeatureStep[] | null {
    if (!this.picks.size || this.axis === null) return null;
    const angle = this.angleOf(values);
    const typed = !!this.ctx.perform;
    const axis = this.axis;
    const options = modeOptions(values);
    return this.picks.regions.flatMap((r, i) => revolveSteps(r, axis, angle, typed, this.picks.without(i), options));
  }

  protected picksKey(): string {
    return `${this.picks.key()}@${this.axis ?? ""}`;
  }

  protected dropPicks(): boolean {
    const had = this.picks.size > 0 || this.axis !== null;
    this.picks.clear();
    this.axis = null;
    this.lastPicked = null;
    this.under = null;
    this.axisUnder = null;
    return had;
  }

  /** The region, then the axis — the lit lines and arms — then ✓ (`FeatureTool.next`). */
  protected picking(hand: Hand): string {
    if (!this.picks.size) return `${press(hand)} inside a closed shape`;
    if (this.axis === null) {
      return this.candidates().length ? `${press(hand)} a lit line or arm to turn it about` : "draw a line in its plane to turn it about";
    }
    return `${press(hand)} inside a closed shape`;
  }

  protected wanting(): string | null {
    if (!this.picks.size) return this.axis === null ? null : missedRegion(this.ctx.model);
    return this.candidates().length
      ? "now click a line, or a frame's arm, to turn it about"
      : "nothing lies in its plane to turn it about — draw a line there";
  }

  onMove(p: PointerInfo): void {
    if (this.picks.size) {
      const axis = RevolveTool.axisOf(this.ctx.pick?.(p.screen));
      if (axis !== this.axisUnder) {
        this.axisUnder = axis;
        this.ctx.requestRender();
      }
      if (axis) {
        if (this.under) { this.under = null; this.ctx.requestRender(); }
        return;
      }
    }
    const next = this.ctx.regionAt?.(p.screen) ?? null;
    const changed = regionKey(next) !== regionKey(this.under);
    this.under = next;
    if (changed) this.ctx.requestRender();
  }

  onDown(p: PointerInfo): void {
    const ctx = this.ctx;
    // With a profile picked a line is an axis before it is a region's edge:
    // the click that lands on one is aiming at it.
    const axis = this.picks.size ? RevolveTool.axisOf(ctx.pick?.(p.screen)) : null;
    if (axis) {
      if (axis === this.axis && this.lastPicked === "axis") {
        this.confirm();
        return;
      }
      if (!this.candidates().includes(axis)) {
        this.guide(`${axis} is not in its plane, or crosses it — click a lit one`);
        return;
      }
      this.axis = axis;
      this.lastPicked = "axis";
      ctx.requestRender();
      return;
    }
    const hit = ctx.regionAt?.(p.screen) ?? null;
    if (!hit) {
      this.guide(this.picks.size ? (this.wanting() ?? missedRegion(ctx.model)) : missedRegion(ctx.model));
      return;
    }
    // A hole of a picked region toggles out of its proposal, as in extrude.ts.
    if (this.picks.toggleHole(ctx.model, hit) !== null) {
      this.lastPicked = "region";
      ctx.requestRender();
      return;
    }
    const was = this.picks.toggle(ctx.model, hit);
    if (was === "again") {
      // The quick path once there is an axis to confirm about; before there
      // is, a confirm could only say "pick an axis", and the click means what
      // a click on a picked region means anywhere else: drop it.
      if (this.axis !== null) {
        this.confirm();
        return;
      }
      this.picks.flip(ctx.model, hit);
    }
    this.lastPicked = this.picks.size ? "region" : null;
    // A region that cannot turn about the axis already picked: the axis goes,
    // and the light shows which ones the selection as it is now can.
    if (this.axis !== null && !this.candidates().includes(this.axis)) this.axis = null;
    ctx.requestRender();
  }

  /**
   * Every region it could take lit faintly, the picked ones a shade stronger,
   * the one under the cursor outlined; with a profile, every axis the picks
   * could turn about lit, the one picked as a dashed line running the length
   * of the profiles and a little past them, the one under the cursor likewise
   * and thinner; and over all of it the solids a confirm would build.
   */
  render(r: RenderContext): void {
    const model = this.ctx.model;
    lightRegions(model, r, this.under);
    const outlines: number[][][] = [];
    this.picks.refresh(model).forEach((picked, i) => {
      const out = leftOut(model, picked, this.picks.without(i));
      outlines.push(...(drawRegion(model, r, picked, "40", undefined, out) ?? []));
      outlineLoops(model, r, picked.loops, [...out]);
    });
    if (this.under) drawRegion(model, r, this.under);
    if (this.picks.size) {
      this.renderAxes(r);
      if (outlines.length && this.axis) this.renderAxis(r, outlines, this.axis, 2.4);
      if (outlines.length && this.axisUnder && this.axisUnder !== this.axis) this.renderAxis(r, outlines, this.axisUnder, 1.4);
    }
    this.renderPreview(r);
  }

  /**
   * The candidate axes, lit: a line along its own length, a frame's arm along
   * the length its marker draws it — the arm a click would take.
   */
  private renderAxes(r: RenderContext): void {
    const model = this.ctx.model;
    r.g.save();
    r.g.strokeStyle = `${REGION_GREEN}${LIT_STROKE}`;
    r.g.lineWidth = 5;
    r.g.lineCap = "round";
    for (const axis of this.candidates()) {
      let ends: [number[], number[]];
      try {
        if (model.entities.get(axis)?.kind === "line") {
          const l = model.line(axis);
          ends = [model.coords(l.refs[0]), model.coords(l.refs[1])];
        } else {
          const ax = axisReader(model, axis).read();
          const len = (FRAME_ARM_PX * (r.ui ?? 1)) / r.scale;
          ends = [ax.origin, ax.origin.map((o, i) => o + len * ax.dir[i])];
        }
      } catch {
        continue; // gone or collapsed since it was found: nothing to light
      }
      r.g.beginPath();
      r.g.moveTo(...r.worldToScreen(ends[0]));
      r.g.lineTo(...r.worldToScreen(ends[1]));
      r.g.stroke();
    }
    r.g.restore();
  }

  private renderAxis(r: RenderContext, outlines: number[][][], axis: string, width: number): void {
    let ax;
    try {
      ax = axisReader(this.ctx.model, axis).read();
    } catch {
      return;
    }
    if (ax.dir.every((c) => c === 0)) return;
    // Along the axis, as far as the profiles reach and a fifth again each way.
    const along = outlines.flat().map((w) => w.reduce((s, c, i) => s + (c - ax.origin[i]) * ax.dir[i], 0));
    const [lo, hi] = [Math.min(0, ...along), Math.max(0, ...along)];
    const pad = Math.max(1, (hi - lo) * 0.2);
    const at = (t: number) => r.worldToScreen(ax.origin.map((o, i) => o + t * ax.dir[i]));
    r.g.save();
    r.g.strokeStyle = REGION_GREEN;
    r.g.beginPath();
    r.g.moveTo(...at(lo - pad));
    r.g.lineTo(...at(hi + pad));
    r.g.setLineDash([8, 5]);
    r.g.lineWidth = width;
    r.g.stroke();
    r.g.restore();
  }
}

defineTool("revolve", RevolveTool);
