// The bevel tool — **the sketch's chamfer** (docs/plans/sketch-edit.md): click
// two lines that meet, or their corner, see the corner cut by a line, ✓. The
// fillet tool's gesture exactly (it is a subclass), with a setback where the
// fillet has a radius, and a second setback for a chamfer that is not even.
//
// **Named `bevel`, not `chamfer`**: `chamfer` is the solid's tool (docs/plans/
// solid-fillets.md), which cuts a body's edges, and both are on the modify
// button. A tool's name is one word, and the two must not be confused in the
// flyout or at the command line — so the tray says Bevel, while the typed call
// stays `chamfer("l1", "l2", 5)`, which the typed `chamfer` tells from the
// solid's by its second argument (two lines, not a list of edges), as the
// typed `fillet` tells the corner from the edges.

import type { FeatureStep } from "./tool.ts";
import type { OptionSpecs } from "./options.ts";
import { FilletTool } from "./fillet.ts";
import { callText } from "./feature.ts";
import { chamfer } from "../sketchedit.ts";

/** The setback a bevel is armed with when none is given. */
export const DEFAULT_SETBACK = 5;

/** The step that cuts the corner of `a` and `b`: the typed call, one setback or two. */
export function bevelSteps(a: string, b: string, d: number, d2: number | null): FeatureStep[] {
  const args = d2 === null ? [a, b, d] : [a, b, d, d2];
  return [(m) => ({ text: callText("chamfer", args), direct: () => chamfer(m, a, b, d, d2) })];
}

export class BevelTool extends FilletTool {
  static readonly options: OptionSpecs = {
    setback: { default: DEFAULT_SETBACK, unit: "length", check: (v) => ((v as number) > 0 ? null : "must be more than 0") },
    // 0 is "the same as the first": an even chamfer, the usual one.
    other: { default: 0, unit: "length", label: "second", check: (v) => ((v as number) >= 0 ? null : "must be 0 (the same) or more") },
  };
  static readonly summary = "Chamfers a sketch corner: click two lines that meet, or their corner";
  readonly name = "bevel";

  protected plan(values: Record<string, unknown>): FeatureStep[] | null {
    if (this.lines.length !== 2) return null;
    const [a, b] = this.lines;
    const d = typeof values.setback === "number" && values.setback > 0 ? values.setback : DEFAULT_SETBACK;
    const d2 = typeof values.other === "number" && values.other > 0 && values.other !== d ? values.other : null;
    return bevelSteps(a, b, d, d2);
  }

  protected get verb(): string {
    return "chamfer the corner";
  }
}
