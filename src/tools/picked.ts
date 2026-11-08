// What a tool that picks entities draws over them: each one in the picking
// green, heavier than the drawing — a line along itself, a circle or arc round
// its rim as the renderer samples it, a point as a dot. The dimension and
// constrain tools share it, so a pick looks the same whichever is armed.
//
// Any other curve is marked by how its kind is laid out — a conic by its
// frame (an ellipse, as a circle is), a B-spline by its path — so a kind a
// module adds is marked with no line here. Until the constrain tool took an
// ellipse and a spline (docs/plans/relations-complete.md) neither was ever
// picked, and a picked spline drew nothing: found by looking at the iPhone
// picture of an arc and a spline picked for Tangent, the arc green and the
// spline not.

import type { RenderContext } from "./tool.ts";
import type { Model } from "../model.ts";
import { curveFrame, curvePath } from "../curveplane.ts";
import { domain, pointAt } from "../bspline.ts";
import { arcSamples, arcSegments } from "../arcgeom.ts";
import { REGION_GREEN } from "./region.ts";

export function markPicked(r: RenderContext, model: Model, names: readonly string[]): void {
  const k = r.ui ?? 1;
  for (const name of names) {
    const e = model.entities.get(name);
    if (!e) continue;
    r.g.save();
    r.g.strokeStyle = REGION_GREEN;
    r.g.fillStyle = REGION_GREEN;
    r.g.lineWidth = 3;
    if (e.kind === "line") {
      const [ax, ay] = r.worldToScreen(model.coords(e.refs[0]));
      const [bx, by] = r.worldToScreen(model.coords(e.refs[1]));
      r.g.beginPath();
      r.g.moveTo(ax, ay);
      r.g.lineTo(bx, by);
      r.g.stroke();
    } else if (e.kind === "point") {
      const [x, y] = r.worldToScreen(model.coords(name));
      r.g.beginPath();
      r.g.arc(x, y, 5 * k, 0, Math.PI * 2);
      r.g.fill();
    } else {
      const pts = curveSamples(model, e, r.scale).map((w) => r.worldToScreen(w));
      if (pts.length > 1) {
        r.g.beginPath();
        r.g.moveTo(...pts[0]);
        for (const pt of pts.slice(1)) r.g.lineTo(...pt);
        r.g.stroke();
      }
    }
    r.g.restore();
  }
}

/** How many pieces a B-spline is marked in: enough that a picked one reads as the curve at any zoom a drawing is worked at. */
const PATH_SAMPLES = 96;

/** A curve's world polyline as it is laid out: by its frame (circle, arc, ellipse, …), else its path (a spline, …), else none. */
function curveSamples(model: Model, e: Parameters<typeof curveFrame>[1], scale: number): number[][] {
  const f = curveFrame(model, e);
  if (f) return arcSamples(f, arcSegments(f.sweep, Math.max(f.r, f.rv ?? 0) * scale));
  const path = curvePath(model, e);
  if (!path) return [];
  const [lo, hi] = domain(path.curve);
  return Array.from({ length: PATH_SAMPLES + 1 }, (_, k) => pointAt(path.curve, lo + ((hi - lo) * k) / PATH_SAMPLES));
}
