// The 3-point circle and arc tools as the tests drove them before there was one
// circle tool and one arc tool (docs/plans/one-circle-one-arc.md): the one tool,
// armed locked to three points — exactly what `arm("circle3")` arms now. Kept
// under the old names so every test written against circle3 and arc3 still makes
// its claim, unchanged, of the tool that claim is now about.

import { CircleTool } from "../src/tools/circle.ts";
import { ArcTool } from "../src/tools/arc.ts";
import type { ToolContext } from "../src/tools/tool.ts";

/** `ctx` with the method locked — on the context itself, as the engine's arm hands options over. */
function locked(ctx: ToolContext, method: string): ToolContext {
  ctx.options = { ...ctx.options, method };
  return ctx;
}

export class Circle3Tool extends CircleTool {
  constructor(ctx: ToolContext) {
    super(locked(ctx, "3pt"));
  }
}

export class Arc3Tool extends ArcTool {
  constructor(ctx: ToolContext) {
    super(locked(ctx, "3pt"));
  }
}
