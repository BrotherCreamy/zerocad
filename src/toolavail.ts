// Whether a tool can run in the model as it stands — the one rule both the
// context menu and the toolbar read, so the two surfaces that offer tools can
// never disagree about which of them are usable.
//
// It is a rule about *names*, and it answers with the model's own words. Names,
// because both callers hold a tool by the name the command line calls it and
// neither has any business with tool classes. The model's own words, because
// the reason is read out of `resolveFrame` rather than written here: the menu,
// the toolbar and the refusal in the log all say one sentence, and there is no
// second copy of it to drift.
//
// It imports nothing but the model's type, and runs nothing that changes it.

import type { Model } from "./model.ts";

/**
 * The tools that build a circle or an arc — the ones a 3D model cannot run
 * without a default frame, since what they build is given that frame's plane
 * (see `CircleEntity`). The fillet is one: it makes an arc.
 */
export const CURVE_TOOLS: ReadonlySet<string> = new Set(["circle", "circle3", "arc", "arc3", "fillet"]);

/**
 * Why the curve tools cannot run here, or null when they can. Only a 3D model
 * asks: a 2D circle needs no plane.
 *
 * Nothing here makes the frame that would answer it. The no-world-frame rule
 * is that a frame exists only because someone chose it, and a check that
 * quietly made one to pass itself would be the exact datum nobody chose.
 */
export function curvesNeedAFrame(model: Model): string | null {
  if (model.dim !== 3) return null;
  try {
    model.resolveFrame();
    return null;
  } catch (err) {
    return err instanceof Error ? err.message : String(err);
  }
}

/**
 * Why `tool` cannot run in `model` right now, or null when it can.
 *
 * Keyed by the registered name, which is a deliberate limit: a tool defined at
 * the command line under a *new* name is never disabled by this, but one that
 * re-registers a built-in curve tool's name (`defineTool("circle", …)`) takes
 * that name's rule with it, on the menu and the toolbar alike. Telling the two
 * apart would mean this file knowing tool classes, for a case nobody has hit.
 */
export function toolUnavailable(model: Model, tool: string): string | null {
  return CURVE_TOOLS.has(tool) ? curvesNeedAFrame(model) : null;
}
