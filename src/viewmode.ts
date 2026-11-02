// How solids are shown: opaque (the default), see-through with what is behind
// them dimmed, or not at all.
//
// The owner, 2026-11-02: "when you extrude a solid, it should look like a
// solid" / "It should be opaque". So by default a solid hides what is behind
// it — from the eye *and* from the hand: nothing behind a visible face is
// drawn, picked, snapped to or boxed (see occlusion.ts, which answers the one
// question all four ask). The other two modes are for when the user wants to
// see through: `hidden` is the hidden-edge pass as it was built
// (docs/plans/hidden-edges.md) — everything drawn and aimable, the part behind
// a face in a dimmed ink — and `wire` draws no faces at all.
//
// **A viewer's choice, not a fact about the drawing.** Like the camera and the
// panel layout it is never journalled, never in a file and never an undo step:
// two people looking at one model may want to see it differently, and Ctrl+Z
// after switching modes undoes the last edit, not the switch. Remembered in
// this browser, with the layout and the tool options, so a reload keeps it.
//
// The rules each mode stands for are here, as functions of the mode, so the
// three places that need them — the draw pass, the pick, the menu — read one
// answer and a unit test can hold all three.

/** The three ways of showing solids. */
export type ViewMode = "shaded" | "hidden" | "wire";

/** In the order the menu and `help()` offer them; the first is the default. */
export const VIEW_MODES: readonly ViewMode[] = ["shaded", "hidden", "wire"];

export const DEFAULT_VIEW_MODE: ViewMode = "shaded";

/** The storage key — versioned like the layout's and the options', so a later shape can move off it cleanly. */
export const VIEW_MODE_KEY = "neocad.viewMode.v1";

/** Whether faces are drawn at all. */
export function drawsFaces(mode: ViewMode): boolean {
  return mode !== "wire";
}

/**
 * Whether a face hides what is behind it — from drawing *and* from aiming.
 * Only `shaded`: `hidden` draws what is behind dimmed and keeps it pickable,
 * which is what that mode is for.
 */
export function opaque(mode: ViewMode): boolean {
  return mode === "shaded";
}

export function isViewMode(x: unknown): x is ViewMode {
  return typeof x === "string" && (VIEW_MODES as readonly string[]).includes(x);
}

/** What storage the mode needs: a `localStorage` is one. */
export interface ViewModeStorage {
  getItem(key: string): string | null;
  setItem(key: string, value: string): void;
}

/**
 * The mode this viewer last chose, or the default. Anything unreadable — no
 * storage, a sandbox that throws on the read, a value a later version wrote —
 * is the default rather than an error: a view mode is a convenience, and the
 * app must open whatever is in storage.
 */
export function recallViewMode(storage: ViewModeStorage | null): ViewMode {
  try {
    const stored = storage?.getItem(VIEW_MODE_KEY) ?? null;
    return isViewMode(stored) ? stored : DEFAULT_VIEW_MODE;
  } catch {
    return DEFAULT_VIEW_MODE;
  }
}

/** Remembers `mode` for next time; returns whether storage took it. */
export function rememberViewMode(storage: ViewModeStorage | null, mode: ViewMode): boolean {
  if (!storage) return false;
  try {
    storage.setItem(VIEW_MODE_KEY, mode);
    return true;
  } catch {
    return false; // full, or forbidden: the mode still holds for this session
  }
}

/** The refusal for a mode that is not one — naming the three, so the next try is the right one. */
export function viewModeError(given: unknown): Error {
  return new Error(`view() takes ${VIEW_MODES.map((m) => JSON.stringify(m)).join(", ")} — `
    + `"shaded" hides what is behind a solid, "hidden" shows it dimmed, "wire" draws no faces; `
    + `${JSON.stringify(given) ?? String(given)} is none of them`);
}
