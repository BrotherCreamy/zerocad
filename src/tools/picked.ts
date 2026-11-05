// What a tool that picks entities draws over them: each one in the picking
// green, heavier than the drawing — a line along itself, a circle or arc round
// its rim as the renderer samples it, a point as a dot. The dimension and
// constrain tools share it, so a pick looks the same whichever is armed.

import type { RenderContext } from "./tool.ts";
import type { Model } from "../model.ts";
import { curveFrame } from "../curveplane.ts";
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
    } else if (e.kind === "circle" || e.kind === "arc") {
      const f = curveFrame(model, e);
      if (f) {
        const pts = arcSamples(f, arcSegments(f.sweep, f.r * r.scale)).map((w) => r.worldToScreen(w));
        r.g.beginPath();
        r.g.moveTo(...pts[0]);
        for (const pt of pts.slice(1)) r.g.lineTo(...pt);
        r.g.stroke();
      }
    }
    r.g.restore();
  }
}
