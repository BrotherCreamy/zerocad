// The spline tool (docs/plans/spline.md): click the through-points in turn,
// the curve previewed through them and the cursor as it grows; it ends **open**
// on a second click on the last point (a double-click, or a double tap), on
// Enter or ✓, and **closed** on a click on the first point once there are
// three. Escape (✗) drops it.
//
// **Nothing is made until it ends**, as the line tool makes nothing on its
// first click: a spline is one entity through all its points, so the gesture
// is one commit — the points, placed with their inference (place.ts: a click on
// a point is `coin` with it, along a curve `on` it), the spline through them,
// and, in 3D, each free point held on the plane the first click stood on
// (`onplane`, as a line's ends are; a spline carries no normal to hold). One
// undo step, and nothing to tidy away when it is abandoned.
//
// A finger lays a point where it lifts, so a press can be slid onto the snap
// it wants first; a click lays one where the button comes up, the same place.

import { Tool, press, type FeatureDialog, type Hand, type PointerInfo, type RenderContext, type How } from "./tool.ts";
import { CurvePlane, DRAWING_OPTIONS, asArmed, placePoint } from "./place.ts";
import type { OptionSpecs } from "./options.ts";
import { addSpline } from "../relations/spline.ts";
import { interpolate, pointAt, sampleParams } from "../bspline.ts";

/** How near on screen a click must land to a laid point to be that point again: the end, or the first (closing). */
export const SAME_POINT_PX = 10;
/** The same for a finger, whose aim is wider. */
export const SAME_POINT_FINGER_PX = 22;

/** The curve through `at`, open or closed, as world samples fine enough for `scale` pixels to the unit — the preview. */
export function splinePreview(at: number[][], closed: boolean, scale: number): number[][] {
  const pts = at.filter((p, i) => i === 0 || Math.hypot(...p.map((x, k) => x - at[i - 1][k])) > 1e-9);
  if (pts.length < 2 || (closed && pts.length < 3)) return pts;
  const curve = interpolate(pts, closed);
  return sampleParams(curve, 0.25 / Math.max(scale, 1e-9)).map((u) => pointAt(curve, u));
}

export class SplineTool extends Tool {
  static readonly options: OptionSpecs = DRAWING_OPTIONS;
  static readonly summary = "Draws a spline through the points you click; double-click to end it";
  static readonly how: How = [
    "{Tap} each point for the curve to pass through.",
    { mouse: "Double-click the last point, or press Enter, to end it.", finger: "✓ in the options ends it." },
    "{Tap} the first point again to close it.",
  ];
  readonly name = "spline";
  private plane = new CurvePlane(this.ctx, this.name);
  /** The clicks laid so far, each read on the gesture's plane, snaps and all. */
  private laid: PointerInfo[] = [];
  private hover: PointerInfo | null = null;
  /**
   * Whether the hand on the canvas is a finger, which aims wider — read off
   * `next`, which the engine asks every frame with the hand last on the canvas.
   */
  private finger = false;

  next(hand: Hand): string {
    this.finger = hand === "finger";
    const p = press(hand);
    if (this.laid.length === 0) return `${p} the first point`;
    if (this.laid.length === 1) return `${p} the next point`;
    // Short on a phone: the chip is one line there, and a longer one wrapped
    // and lost its end (looked at, iPhone 13).
    if (hand === "finger") return this.laid.length >= 3 ? "tap more, ✓ ends, the first closes" : "tap more, or ✓ to end";
    return `click the next point — double-click ends it${this.laid.length >= 3 ? ", the first closes it" : ""}`;
  }

  /** How near two screen points must be to be one laid point, for the hand that pressed. */
  private near(a: [number, number], b: [number, number]): boolean {
    return Math.hypot(a[0] - b[0], a[1] - b[1]) <= (this.finger ? SAME_POINT_FINGER_PX : SAME_POINT_PX);
  }

  // Each point of a spline is a point of its own, and keeps the face it landed
  // on (`settleOwn`, docs/plans/click-on-face.md): a spline may run from one
  // face of a solid onto the next, each point held to its own.
  onDown(p: PointerInfo): void {
    this.hover = this.laid.length ? this.plane.settleOwn(p) : p;
    this.ctx.requestRender();
  }

  onMove(p: PointerInfo): void {
    this.hover = this.laid.length ? this.plane.settleOwn(p) : p;
    this.ctx.requestRender();
  }

  onUp(p: PointerInfo): void {
    if (this.laid.length === 0) {
      this.plane.begin(p);
      this.laid.push(this.plane.settleOwn(p));
      this.hover = null;
      this.ctx.requestRender();
      return;
    }
    const at = this.plane.settleOwn(p);
    const last = this.laid[this.laid.length - 1];
    // A second click on the last point: the end, open.
    if (this.near(at.screen, last.screen)) {
      if (this.laid.length >= 2) this.commit(false);
      return;
    }
    // A click on the first point, with two after it: closed.
    if (this.laid.length >= 3 && this.near(at.screen, this.laid[0].screen)) {
      this.commit(true);
      return;
    }
    this.laid.push(at);
    this.hover = null;
    this.ctx.requestRender();
  }

  /** ✓ or Enter: the spline ends open where it is, if it has two points. */
  confirm(): boolean {
    if (this.laid.length < 2) return false;
    this.commit(false);
    return true;
  }

  /** ✗ or Escape: the points laid go, and the tool stays armed; with none laid, the engine lets it go. */
  clear(): boolean {
    if (!this.laid.length) return false;
    this.reset();
    this.ctx.requestRender();
    return true;
  }

  dialog(): FeatureDialog {
    return { ready: this.laid.length >= 2 };
  }

  onCancel(): void {
    this.reset();
    this.ctx.requestRender();
  }

  private reset(): void {
    this.laid = [];
    this.hover = null;
    this.plane.cancel();
  }

  /** The gesture's one commit: the points with their inference, the spline through them. */
  private commit(closed: boolean): void {
    const laid = this.laid;
    const ref = this.plane.plane;
    this.reset();
    const m = this.ctx.model;
    const points = laid.map((info) => placePoint(this.ctx, info, undefined, ref));
    let made: string;
    try {
      made = addSpline(m, points, closed);
    } catch (e) {
      // Two clicks the snaps put in one place: said, and the points stay —
      // they were placed, and a refusal must not leave a half-made gesture.
      const why = e instanceof Error ? e.message : String(e);
      if (this.ctx.log) this.ctx.log(`spline: ${why}`);
      else throw e;
      this.ctx.requestSolve();
      return;
    }
    asArmed(this.ctx, made);
    this.ctx.requestSolve();
    this.ctx.finish();
  }

  render(r: RenderContext): void {
    if (!this.laid.length) return;
    const at = this.laid.map((p) => p.world);
    const hover = this.hover;
    const closing = !!hover && this.laid.length >= 3 && this.near(hover.screen, this.laid[0].screen);
    const ending = !!hover && this.near(hover.screen, this.laid[this.laid.length - 1].screen);
    const through = closing || ending || !hover ? at : [...at, hover.world];
    const pts = splinePreview(through, closing, r.scale).map((w) => r.worldToScreen(w));
    const k = r.ui ?? 1;
    r.g.save();
    // Solid, as every shape being drawn is: dashes are a selection's.
    r.g.strokeStyle = "#e8a33d";
    r.g.lineWidth = 1.3;
    if (pts.length >= 2) {
      r.g.beginPath();
      r.g.moveTo(...pts[0]);
      for (const q of pts.slice(1)) r.g.lineTo(...q);
      r.g.stroke();
    }
    // The points laid, and a ring on the first when the next click would close
    // it, or on the last when it would end it.
    for (const w of at) {
      const [x, y] = r.worldToScreen(w);
      r.g.beginPath();
      r.g.arc(x, y, 3 * k, 0, Math.PI * 2);
      r.g.stroke();
    }
    const ring = closing ? at[0] : ending && this.laid.length >= 2 ? at[at.length - 1] : null;
    if (ring) {
      const [x, y] = r.worldToScreen(ring);
      r.g.beginPath();
      r.g.arc(x, y, 7 * k, 0, Math.PI * 2);
      r.g.stroke();
    }
    r.g.restore();
  }
}
