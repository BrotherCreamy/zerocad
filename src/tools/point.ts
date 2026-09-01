// The simplest possible tool: click, place a point, done. Exists mainly to
// prove the extension point works for the trivial case too, not just the
// drag-a-shape case rectangle.ts demonstrates.
//
// It goes through `placePoint` rather than `model.addPoint` so that clicking
// an existing vertex, edge or midpoint leaves the new point *constrained* to
// what was clicked, the way every sketcher does it — see place.ts.

import { Tool, defineTool, type PointerInfo } from "./tool.ts";
import { placePoint } from "./place.ts";

export class PointTool extends Tool {
  readonly name = "point";

  onDown(p: PointerInfo): void {
    placePoint(this.ctx, p);
    this.ctx.requestSolve();
    this.ctx.finish();
  }
}

defineTool("point", PointTool);
