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
// changes the profile. Refusals go to the log and leave the tool where it was:
// no region under the first click, nothing that is an axis under the second,
// or an axis `revolve` refuses (out of the profile's plane, crossed by the
// profile), after which another axis can be clicked.
//
// It hands `revolve` the profile it found, resolved, through `revolveProfile`,
// which makes the same geometric refusals a typed call makes — so the journal
// entry is the one a typed call writes, and the tool cannot revolve anything
// the command line would not. A profile no frame orients gets its plane typed
// first, exactly as the extrude tool does it (see there), once the axis has
// passed the refusals that do not need the frame.

import { Tool, defineTool, type PointerInfo, type RegionHit, type RenderContext } from "./tool.ts";
import { checkRevolveRegion, orientingFrame, revolveProfile, revolveProfileOf } from "../operations.ts";
import { describeFeature, type Pick } from "../picking.ts";
import { featurePlaneCommand } from "../sketchface.ts";
import { FULL_TURN, axisReader } from "../relations/revolution.ts";
import { REGION_GREEN, drawRegion, regionKey, type Region } from "./region.ts";

export class RevolveTool extends Tool {
  readonly name = "revolve";
  // It chooses a region and then an axis, not places: a snap marker would
  // promise a vertex the click does not go to.
  readonly snaps = false;
  /** The profile, once the first click has chosen it — with the side it was seen from, for a plane made on it. */
  private region: RegionHit | null = null;
  /** Set between typing a frameless profile's plane and revolving along it — see the extrude tool's. */
  private typing: object | null = null;
  /** Before the first click: the region under the cursor. */
  private under: Region | null = null;
  /** After it: the axis under the cursor, as `revolve` takes one. */
  private axisUnder: string | null = null;

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

  onDown(p: PointerInfo): void {
    if (this.typing) return; // the plane it typed is still going in
    if (!this.region) {
      const hit = this.ctx.regionAt?.(p.screen) ?? null;
      if (!hit) {
        this.refuse(new Error("no closed region under the click — click inside a loop (loops() lists them), then on the axis"));
        return;
      }
      this.region = hit;
      this.under = null;
      this.ctx.requestRender();
      return;
    }
    const axis = RevolveTool.axisOf(this.ctx.pick?.(p.screen));
    if (!axis) {
      const other = this.ctx.regionAt?.(p.screen) ?? null;
      if (other) {
        this.region = other; // a second region clicked: that is the profile now
        this.ctx.requestRender();
        return;
      }
      this.refuse(new Error("no line or frame axis under the click — click a line, or an arm of a frame's marker, to turn the profile about"));
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
      this.refuse(e);
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
      this.axisUnder = null;
      this.ctx.requestSolve();
      this.ctx.finish();
      this.ctx.log?.(describeFeature(model, model.featureOf(feature)), "done");
    } catch (e) {
      // The axis out of the profile's plane, or the profile across it, most
      // likely. The profile stays chosen, so the next click can be another axis.
      this.refuse(e);
    }
  }

  /** Out loud where there is a user to tell, a throw headless — the extrude and fillet tools' convention. */
  private refuse(e: unknown): void {
    if (!this.ctx.log) throw e;
    this.ctx.log(`revolve: ${e instanceof Error ? e.message : e}`);
  }

  onCancel(): void {
    this.region = null;
    this.under = null;
    this.axisUnder = null;
    this.typing = null;
    this.ctx.requestRender();
  }

  /**
   * The region — under the cursor, or chosen — filled faintly even-odd and
   * outlined, exactly the profile a revolve would take; and once it is chosen,
   * the axis under the cursor as a dashed line running the length of the
   * profile and a little past it, so what it would turn about is plain before
   * the click.
   */
  render(r: RenderContext): void {
    const u = this.region ?? this.under;
    if (!u) return;
    const outlines = drawRegion(this.ctx.model, r, u, this.region ? "40" : "2e");
    if (outlines && this.region && this.axisUnder) this.renderAxis(r, outlines);
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
