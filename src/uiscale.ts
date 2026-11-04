// The interface size: one factor that everything drawn for a person to read
// or hit is multiplied by — the panels' metrics, the command line's and the
// log's type, the menus, the hover tag, and in the viewport the constraint
// glyphs, dimension labels, point dots, frame markers, the snap marker and the
// lifted mark (docs/plans/chrome-logo-scale.md). The owner, from his iPhone:
// *"the interface elements are huge on my screen. there should be a settings
// menu that allows the user to change the zoom level of the interface."*
//
// **A viewer's setting, per device.** Like the view mode and the panel layout
// it is never journalled, never in a file, never an undo step: how big a
// person wants their buttons is a fact about their eyes and their screen, not
// about the drawing. Remembered in this browser's storage, every touch of it
// wrapped, so a private window costs the setting and nothing else.
//
// **What it never scales is reach.** How far from a point a finger may land
// and still take it (picking.ts's `TOUCH_REACH`) is about the finger, not the
// picture: a smaller interface must not make geometry harder to hit. A glyph's
// box is the exception that proves the rule — its hit box *is* its drawn box,
// so it follows the size it is drawn at, as it always has.
//
// This file is a leaf: it imports nothing, so the panels, the menus and the
// host can all read it without anything learning about anything else.

/** The least and the most the interface may be scaled by. */
export const UI_MIN = 0.6;
export const UI_MAX = 1.6;
/** One press of the spin box's − or +. */
export const UI_STEP = 0.1;

/**
 * The size a device starts at. **A mouse: 100 %**, the look the app has always
 * had, unchanged. **A finger: 70 %**, which makes a tool button 31 px against
 * the 44 px the owner called huge (Apple's 44 pt minimum, which a CSS pixel is
 * on an iPhone). The spec asked for "about 32"; 70 % is the step on the
 * spin box's 10 % ladder nearest it (80 % is 35 px, which in his portrait
 * screenshot still runs the eleven-tool column down two thirds of the
 * screen), and a finger still finds a 31 px button: the tray's buttons sit
 * 2 px apart, so the button under a fingertip is the one it lands on.
 */
export function defaultScale(coarse: boolean): number {
  return coarse ? 0.7 : 1;
}

/**
 * A scale held to [UI_MIN, UI_MAX] and to the hundredth, so a typed 0.8000001
 * and a stepped 0.8 are the same setting. Anything that is not a finite number
 * is null — the caller says what it wanted instead.
 */
export function clampScale(s: unknown): number | null {
  if (typeof s !== "number" || !Number.isFinite(s)) return null;
  return Math.round(Math.min(UI_MAX, Math.max(UI_MIN, s)) * 100) / 100;
}

/**
 * One press of − (`dir` −1) or + (+1): to the next 10 % step that way, so a
 * setting typed off the ladder (`ui({ scale: 0.75 })`) steps onto it rather
 * than along beside it — 75 % then + is 80 %, not 85 %.
 */
export function stepScale(s: number, dir: 1 | -1): number {
  const tenths = s * 10;
  const near = Math.round(tenths);
  // On a step already (to float noise): the next one. Between two: the one on
  // that side.
  const next = Math.abs(tenths - near) < 1e-6 ? near + dir : dir > 0 ? Math.ceil(tenths) : Math.floor(tenths);
  return clampScale(next / 10)!;
}

/** As the spin box and `ui()` say it: `80%`. */
export function formatScale(s: number): string {
  return `${Math.round(s * 100)}%`;
}

/** The storage key — versioned like the layout's and the view mode's. */
export const UI_SCALE_KEY = "neocad.uiScale.v1";

/** What storage the setting needs: a `localStorage` is one. */
export interface ScaleStorage {
  getItem(key: string): string | null;
  setItem(key: string, value: string): void;
  removeItem(key: string): void;
}

/**
 * The scale this viewer chose on this device, or null for none — the device's
 * default, which is not stored, so that a viewer who never chose follows the
 * default if a later version changes it. Anything unreadable is null.
 */
export function recallScale(storage: ScaleStorage | null): number | null {
  try {
    const raw = storage?.getItem(UI_SCALE_KEY) ?? null;
    return raw === null ? null : clampScale(Number(raw));
  } catch {
    return null;
  }
}

/**
 * Remembers `s`, or with null forgets it — back to the device's default.
 * Returns whether storage took it; a refusal leaves the setting in force for
 * this session only.
 */
export function rememberScale(storage: ScaleStorage | null, s: number | null): boolean {
  if (!storage) return false;
  try {
    if (s === null) storage.removeItem(UI_SCALE_KEY);
    else storage.setItem(UI_SCALE_KEY, String(s));
    return true;
  } catch {
    return false;
  }
}
