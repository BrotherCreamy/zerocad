// Click inside a closed region, then on the axis to turn it about, and revolve
// it.
//
// The extrude tool's sibling and the fillet tool's shape: a two-click gesture,
// armed with the one number the clicks cannot supply —
// `arm("revolve", { angle: 3 * Math.PI / 2 })`, radians as everywhere a revolve
// takes an angle, a whole turn when left out. The first click chooses the
// profile exactly as the extrude tool does (`regionAt`: the innermost loop under
// the click, with every loop inside it), outlined while the cursor moves; the
// second chooses the axis — a line, or an arm of a frame's marker, which picking
// reports with the arm it was (`Pick.axis`) — shown as a dashed line through the
// profile while the cursor is over one. A click inside another region instead
// changes the profile.
//
// **A miss is guidance, and what would work is lit.** Before the first click
// every region the tool could take is lit faintly (`lightRegions`, as the
// extrude tool does); once a profile is chosen, every line and frame arm it
// could turn about is (`revolveAxes`: lying in its plane, the profile to one
// side of it). A click on nothing, or on an axis that would not do, says in a
// line what would and leaves the tool where it was, in the muted guidance
// style — never red.
//
// It hands `revolve` the profile it found, resolved, through `revolveProfile`,
// which makes the same geometric refusals a typed call makes — so the journal
// entry is the one a typed call writes, and the tool cannot revolve anything
// the command line would not. A profile no frame orients gets its plane typed
// first, exactly as the extrude tool does it (see there), once the axis has
// passed the refusals that do not need the frame.

import { Tool, defineTool, type PointerInfo, type RegionHit, type RenderContext } from "./tool.ts";
import type { OptionSpecs } from "./options.ts";
import type { Model } from "../model.ts";
import { checkRevolveRegion, orientingFrame, revolveProfile, revolveProfileOf } from "../operations.ts";
import { describeFeature, type Pick } from "../picking.ts";
import { featurePlaneCommand } from "../sketchface.ts";
import { FULL_TURN, axisReader } from "../relations/revolution.ts";
import { FRAME_ARM_PX } from "../framemarker.ts";
import { LIT_STROKE, REGION_GREEN, drawRegion, lightRegions, missedRegion, regionKey, type Region } from "./region.ts";

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

export class RevolveTool extends Tool {
  // Radians, as everywhere a revolve takes an angle; the operation's own range.
  static readonly options: OptionSpecs = {
    angle: {
      default: FULL_TURN, unit: "angle",
      check: (v) => (v === 0 || Math.abs(v as number) > FULL_TURN ? "must be within a whole turn (±6.283185) and not 0" : null),
    },
  };
  readonly name = "revolve";
  // It chooses a region and then an axis, not places: a snap marker would
  // promise a vertex the click does not go to.
  readonly snaps = false;
  /** The profile, once the first click has chosen it — with the side it was seen from, for a plane made on it. */
  private region: RegionHit | null = null;
  /** The axes the chosen profile could turn about, lit while the tool waits for one. */
  private axes: string[] = [];
  /** Set between typing a frameless profile's plane and revolving along it — see the extrude tool's. */
  private typing: object | null = null;
  /** Before the first click: the region under the cursor. */
  private under: Region | null = null;
  /** After it: the axis under the cursor, as `revolve` takes one. */
  private axisUnder: string | null = null;

  /** Armed, the angle is always here and checked; the fallback is for a tool driven with no engine. */
  private get angle(): number {
    const a = this.ctx.options.angle;
    return typeof a === "number" && Number.isFinite(a) && a !== 0 && Math.abs(a) <= FULL_TURN ? a : FULL_TURN;
  }

  /** The axis a pick names: a line, or a frame's arm as `"f1.y"` — null for anything else. */
  private static axisOf(hit: Pick | null | undefined): string | null {
    if (!hit) return null;
    if (hit.kind === "line") return hit.name;
    if (hit.kind === "frame" && hit.axis) return `${hit.name}.${hit.axis}`;
    return null;
  }

  onMove(p: PointerInfo): void {
    if (!this.region) {
      const next = this.ctx.regionAt?.(p.screen) ?? null;
      const changed = regionKey(next) !== regionKey(this.under);
      this.under = next;
      if (changed) this.ctx.requestRender();
      return;
    }
    const axis = RevolveTool.axisOf(this.ctx.pick?.(p.screen));
    if (axis === this.axisUnder) return;
    this.axisUnder = axis;
    this.ctx.requestRender();
  }

  /** Chooses `hit` as the profile, and finds what it could turn about. */
  private choose(hit: RegionHit): void {
    this.region = hit;
    this.axes = revolveAxes(this.ctx.model, hit);
    this.under = null;
    this.ctx.requestRender();
  }

  onDown(p: PointerInfo): void {
    if (this.typing) return; // the plane it typed is still going in
    if (!this.region) {
      const hit = this.ctx.regionAt?.(p.screen) ?? null;
      if (!hit) {
        this.guide(missedRegion(this.ctx.model));
        return;
      }
      this.choose(hit);
      return;
    }
    const axis = RevolveTool.axisOf(this.ctx.pick?.(p.screen));
    if (!axis) {
      const other = this.ctx.regionAt?.(p.screen) ?? null;
      if (other) {
        this.choose(other); // a second region clicked: that is the profile now
        return;
      }
      this.guide(this.axes.length
        ? "now click a line, or a frame's arm, to turn it about"
        : "nothing lies in its plane to turn it about — draw a line there");
      return;
    }
    const ctx = this.ctx;
    const region = this.region;
    const loop = region.loops[region.index];
    if (orientingFrame(ctx.model, loop) !== null || !ctx.run || !ctx.act) {
      this.commit(region, axis);
      return;
    }
    // A frameless region: its plane typed first, as the extrude tool does —
    // but only once the axis has passed the geometric refusals, asked of the
    // loop's own plane, so an axis the revolve would refuse makes no plane.
    let command: string;
    try {
      checkRevolveRegion(ctx.model, region.loops, region.index, axis);
      command = featurePlaneCommand(ctx.model, loop, region.toward);
    } catch (e) {
      this.refuse(axis, e);
      return;
    }
    const token = {};
    this.typing = token;
    this.axisUnder = null;
    void Promise.resolve(ctx.run(command)).finally(() => {
      if (this.typing !== token) return; // cancelled while it went in: the plane stays, as typed
      this.typing = null;
      ctx.act!(() => this.commit(region, axis));
    });
  }

  /** The profile revolved about `axis` — along the plane just typed, if it needed one. See the extrude tool's. */
  private commit(region: RegionHit, axis: string): void {
    const model = this.ctx.model;
    try {
      const profile = revolveProfileOf(model, region.loops, region.index);
      const feature = revolveProfile(model, profile, axis, this.angle);
      this.region = null;
      this.axes = [];
      this.axisUnder = null;
      // Finished first, so the solve's redraw is the first without the tool: its
      // light on every region would otherwise stay on screen over the solid.
      this.ctx.finish();
      this.ctx.requestSolve();
      this.ctx.log?.(describeFeature(model, model.featureOf(feature)), "done");
    } catch (e) {
      // The axis out of the profile's plane, or the profile across it, most
      // likely. The profile stays chosen, so the next click can be another axis.
      this.refuse(axis, e);
    }
  }

  /**
   * An axis the revolve will not turn about. Said short when it is one the
   * tool did not light — the lit ones are the answer — and in the operation's
   * own words otherwise, which are then about something the light could not
   * know (a profile no plane can be made of).
   */
  private refuse(axis: string, e: unknown): void {
    if (!this.ctx.log) throw e;
    this.guide(this.axes.includes(axis)
      ? (e instanceof Error ? e.message : String(e))
      : `${axis} is not in its plane, or crosses it — click a lit one`);
  }

  /**
   * One line of guidance: the tool stays armed, the sentence says what would
   * work, and the host shows it muted — never red, which is the model's. A
   * throw headless, where a caller is the only one listening.
   */
  private guide(why: string): void {
    this.ctx.requestRender();
    if (!this.ctx.log) throw new Error(why);
    this.ctx.log(`revolve: ${why}`, "guide");
  }

  onCancel(): void {
    this.region = null;
    this.axes = [];
    this.under = null;
    this.axisUnder = null;
    this.typing = null;
    this.ctx.requestRender();
  }

  /**
   * Before the first click, every region it could take lit faintly and the
   * one under the cursor outlined, exactly the profile a revolve would take;
   * once one is chosen, it a shade stronger, every axis it could turn about
   * lit, and the axis under the cursor as a dashed line running the length of
   * the profile and a little past it, so what it would turn about is plain
   * before the click.
   */
  render(r: RenderContext): void {
    if (!this.region) {
      lightRegions(this.ctx.model, r, this.under);
      if (this.under) drawRegion(this.ctx.model, r, this.under);
      return;
    }
    const outlines = drawRegion(this.ctx.model, r, this.region, "40");
    this.renderAxes(r);
    if (outlines && this.axisUnder) this.renderAxis(r, outlines);
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
    for (const axis of this.axes) {
      let ends: [number[], number[]];
      try {
        if (model.entities.get(axis)?.kind === "line") {
          const l = model.line(axis);
          ends = [model.coords(l.refs[0]), model.coords(l.refs[1])];
        } else {
          const ax = axisReader(model, axis).read();
          const len = FRAME_ARM_PX / r.scale;
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

  private renderAxis(r: RenderContext, outlines: number[][][]): void {
    let ax;
    try {
      ax = axisReader(this.ctx.model, this.axisUnder!).read();
    } catch {
      return;
    }
    if (ax.dir.every((c) => c === 0)) return;
    // Along the axis, as far as the profile reaches and a fifth again each way.
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
    r.g.lineWidth = 2;
    r.g.stroke();
    r.g.restore();
  }
}

defineTool("revolve", RevolveTool);
