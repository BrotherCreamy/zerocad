// The simplest possible tool: click, place a point, done. Exists mainly to
// prove the extension point works for the trivial case too, not just the
// drag-a-shape case rectangle.ts demonstrates.

import { Tool, defineTool, type PointerInfo } from "./tool.ts";

export class PointTool extends Tool {
  readonly name = "point";

  onDown(p: PointerInfo): void {
    this.ctx.model.addPoint(p.world);
    this.ctx.requestSolve();
    this.ctx.finish();
  }
}

defineTool("point", PointTool);
