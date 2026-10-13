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
// the command line would not.

import { Tool, defineTool, type PointerInfo, type RenderContext } from "./tool.ts";
import { regionOf, revolveProfile, revolveProfileOf } from "../operations.ts";
import { loopOutlines } from "../faces.ts";
import type { Loop } from "../loops.ts";
import type { Pick } from "../picking.ts";
import { FULL_TURN, axisReader } from "../relations/revolution.ts";

type Region = { loops: Loop[]; index: number };

/** The tool's green, shared with the extrude tool's preview. */
const GREEN = "#55c07a";

export class RevolveTool extends Tool {
  readonly name = "revolve";
  // It chooses a region and then an axis, not places: a snap marker would
  // promise a vertex the click does not go to.
  readonly snaps = false;
  /** The profile, once the first click has chosen it. */
  private region: Region | null = null;
  /** Before the first click: the region under the cursor. */
  private under: Region | null = null;
  /** After it: the axis under the cursor, as `revolve` takes one. */
  private axisUnder: string | null = null;

  private get angle(): number {
    const a = this.ctx.options.angle;
    return typeof a === "number" && Number.isFinite(a) && a !== 0 && Math.abs(a) <= FULL_TURN ? a : FULL_TURN;
  }

  /** Which loops a region is made of, by member names — what a hover is compared by. */
  private static key(r: Region | null): string {
    if (!r) return "";
    return regionOf(r.loops, r.index).map((i) => r.loops[i].members.map((m) => m.name).join(",")).join("|");
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
      const changed = RevolveTool.key(next) !== RevolveTool.key(this.under);
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
    try {
      const profile = revolveProfileOf(this.ctx.model, this.region.loops, this.region.index);
      revolveProfile(this.ctx.model, profile, axis, this.angle);
      this.region = null;
      this.axisUnder = null;
      this.ctx.requestSolve();
      this.ctx.finish();
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
    const m = this.ctx.model;
    let outlines: number[][][];
    try {
      outlines = loopOutlines(m, regionOf(u.loops, u.index).map((i) => u.loops[i].members.map((mm) => mm.name)), r.scale);
    } catch {
      return; // the drawing moved under the hover; the next move asks again
    }
    if (!outlines.length) return;
    r.g.save();
    r.g.beginPath();
    for (const o of outlines) {
      const pts = o.map((w) => r.worldToScreen(w));
      r.g.moveTo(...pts[0]);
      for (const q of pts.slice(1)) r.g.lineTo(...q);
      r.g.closePath();
    }
    r.g.fillStyle = this.region ? "#55c07a40" : "#55c07a2e";
    r.g.fill("evenodd");
    r.g.strokeStyle = GREEN;
    r.g.lineWidth = 2.4;
    r.g.stroke();
    if (this.region && this.axisUnder) this.renderAxis(r, outlines);
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
    r.g.beginPath();
    r.g.moveTo(...at(lo - pad));
    r.g.lineTo(...at(hi + pad));
    r.g.setLineDash([8, 5]);
    r.g.lineWidth = 2;
    r.g.stroke();
    r.g.setLineDash([]);
  }
}

defineTool("revolve", RevolveTool);
