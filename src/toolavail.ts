// Whether a tool can run in the model as it stands — the one rule both the
// context menu and the toolbar read, so the two surfaces that offer tools can
// never disagree about which of them are usable.
//
// **Today the answer is never "no".** It used to be: in a 3D model with no
// default frame the five curve tools (circle, circle3, arc, arc3, fillet) were
// greyed on both surfaces with the model's "no default frame" as the reason —
// the first thing a newcomer met after drawing a rectangle. Those tools now
// make the plane they need at the click (`CurvePlane` and the fillet tool's
// corner plane, in tools/), exactly as extrude makes a frameless sketch's, so
// there is nothing left to refuse. The owner's direction (docs/plans/
// effortless.md) is that a tool does the obvious thing with defaults and
// refuses only where no default is honest.
//
// The file stays, answering null, because it is still the *one* place the
// question is asked: a tool that one day genuinely cannot run somewhere is
// greyed on the menu and the toolbar alike by changing this function, with
// the greyed button, its hover reason and the menu's disabled item all still
// wired to it. Deleting it would leave two surfaces to agree again by hand.
//
// It imports nothing but the model's type, and runs nothing that changes it.

import type { Model } from "./model.ts";

/**
 * Why `tool` cannot run in `model` right now, or null when it can — which,
 * since every built-in tool makes what it needs, is always. Keyed by the
 * registered name, so both callers can ask it without knowing tool classes.
 */
export function toolUnavailable(_model: Model, _tool: string): string | null {
  return null;
}
