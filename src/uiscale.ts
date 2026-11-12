// The interface size: one factor that everything drawn for a person to read
// is multiplied by — the panels' metrics, the command line's and the log's
// type, the menus, the hover tag, and in the viewport the constraint glyphs,
// dimension labels, point dots, frame markers, the snap marker and the lifted
// mark (docs/plans/chrome-logo-scale.md). The owner, from his iPhone: *"the
// interface elements are huge on my screen"*, and then: *"is there any way you
// can figure out what interface scale to use for each device, so everything is
// appropriately sized? (and make that 100% zoom)"*.
//
// **Two factors, multiplied.** The *device's* — worked out here from what the
// page can see (`deviceScale`): what a pointer is, how big the screen is, and
// the text size the person chose for their whole device. That is what 100 %
// means on that device. Then the *viewer's* — the spin box's `− 80% +`, the
// only thing stored — a multiplier on the device's, so a change to the
// device's text size still comes through under it.
//
// **Drawn size is not hit size.** Under a finger every control used to be
// *drawn* at its 44 px hit size, which is what made it huge. Now a control is
// drawn at the interface size and, under a coarse pointer, answers a press
// over at least 44 px whatever it is drawn at (index.html's hit areas;
// panels.ts's `touchMetrics`). And how far from a point a finger may land and
// still take it (picking.ts's `TOUCH_REACH`) is about the finger, not the
// picture: no factor here touches it.
//
// **A viewer's setting, per device.** Never journalled, never in a file, never
// an undo step, like the view mode and the layout; every touch of storage
// wrapped, so a private window costs the setting and nothing else.
//
// This file is a leaf: it imports nothing, so the panels, the menus and the
// host can all read it without anything learning about anything else.

/** The least and the most the viewer's multiplier may be: 60 %–160 % of the device's 100 %. */
export const UI_MIN = 0.6;
export const UI_MAX = 1.6;
/** One press of the spin box's − or +. */
export const UI_STEP = 0.1;

/**
 * **Form factor**: how much bigger than a desktop's the chrome is drawn, at
 * the device's own default text size. A mouse's is 1 — the look the app has
 * always had on a desktop. A finger on a phone, 1.3: Apple's body text is
 * 17 pt on iOS against 13 pt on macOS (WebKit's `-apple-system-body`
 * resolves to exactly those two sizes; bugs.webkit.org 215279 and 230348), and
 * 17 / 13 is 1.31. A finger on a tablet, between the two: it is held further
 * off than a phone and has the room.
 */
export const FORM_FACTOR = { fine: 1, phone: 1.3, tablet: 1.15 } as const;

/**
 * Where a phone stops and a tablet starts: the screen's short side in CSS px.
 * Every iPhone is under 450 (the largest Pro Max, 440); every iPad over 740
 * (the mini, 744); Android's own boundary for a tablet layout is the same
 * 600 ("smallest width 600dp"). So 600, with room on both sides of it.
 */
export const TABLET_SHORT_SIDE = 600;

/** iOS's body text at the default Dynamic Type setting: what `-apple-system-body` measures there. */
export const IOS_BODY_PX = 17;
/** A browser's default text size, which a person's "font size" setting changes. */
export const DEFAULT_FONT_PX = 16;

/** The text-size factor is held to this: past it, the chrome would not fit the screen it is for. */
export const TEXT_MIN = 0.8;
export const TEXT_MAX = 1.5;

/** What the page measured about the device it is on. */
export interface Device {
  /** The primary pointer is coarse: a finger. */
  coarse: boolean;
  /** The screen's short side, in CSS px. */
  shortSide: number;
  /**
   * `font: -apple-system-body`'s size in px, where it applies — Safari, which
   * follows Dynamic Type on iOS and iPadOS — or null where it does not.
   */
  appleBody: number | null;
  /** The browser's default font size in px (`font-size: medium`). */
  defaultFont: number;
  /**
   * The operating system's text scale where the browser reports it —
   * `env(preferred-text-scale)`, Chrome on Android since 138 (1 at the
   * default; 1.3 for a person who chose 130 %) — or null where it does not.
   * Optional: a device measured before it existed has none.
   */
  textScale?: number | null;
}

/** The form factor alone: 1, 1.3 or 1.15 (`FORM_FACTOR`). */
export function formFactor(d: Pick<Device, "coarse" | "shortSide">): number {
  if (!d.coarse) return FORM_FACTOR.fine;
  return d.shortSide >= TABLET_SHORT_SIDE ? FORM_FACTOR.tablet : FORM_FACTOR.phone;
}

/**
 * **The person's preferred text size**, as a factor: 1 at the device's
 * default. On an iPhone or iPad, Dynamic Type — `-apple-system-body` over its
 * default 17 px. Everywhere else, the browser's default font size over 16.
 *
 * `-apple-system-body` is read only under a finger: macOS Safari has it too,
 * but at a fixed 13 px — it has no Dynamic Type — so dividing that by 17 would
 * shrink every Mac's chrome by a quarter. A Mac's preference is its browser's
 * font size, the second rule. Held to [TEXT_MIN, TEXT_MAX]; anything that is
 * not a positive number is 1.
 *
 * **On Android** (docs/plans/android.md), under a finger where there is no
 * `-apple-system-body`: the system's font scale as Chrome reports it,
 * `env(preferred-text-scale)`, times the browser's own default font size over
 * 16 (which a person can also change, and which the system scale does not
 * touch on a page that has no `<meta name="text-scale">` — this one has none).
 * *Measured* (Chromium 141 under Pixel 7 emulation, the system scale stood in
 * for by `--blink-settings=accessibilityFontScaleFactor=1.3`): the variable
 * reads 1.3, while `font-size: medium` stays 16 px wherever text autosizing
 * does not act — and it never acts on a lone probe, nor anywhere on this page
 * (`text-size-adjust: 100%`). Autosizing is a heuristic over runs of text; the
 * variable is the API. So the variable, and where a browser has none (Chrome
 * before 138, Firefox), the second rule — 1 for a person who changed only the
 * system's size. Not under a mouse: a desktop's preference is its browser's
 * font size, and the variable there is 1 or, where Chrome brings it to
 * Windows, a scale Chrome already applies as zoom.
 */
export function textFactor(d: Device): number {
  const scale = d.textScale;
  const raw = d.coarse && d.appleBody !== null ? d.appleBody / IOS_BODY_PX
    : d.coarse && typeof scale === "number" && scale > 0 ? scale * (d.defaultFont / DEFAULT_FONT_PX)
    : d.defaultFont / DEFAULT_FONT_PX;
  if (!Number.isFinite(raw) || raw <= 0) return 1;
  return Math.min(TEXT_MAX, Math.max(TEXT_MIN, raw));
}

/**
 * **The system's font scale from what the page read of
 * `env(preferred-text-scale)`** — a `Device`'s `textScale`, or null where the
 * browser has no such variable.
 *
 * Chromium changed which page it tells, so the variable is read twice
 * (main.ts's `measureDevice`; docs/plans/android.md has the measurements):
 *
 * - `plain` is the variable as this page reads it. Chromium 141 reported the
 *   system's scale there (1.3 for a person at 130 %), so anything but 1 is
 *   the answer. Zero or less is the probe's fallback: no variable.
 * - **Chromium 153 reports it only to a page that asks**, with
 *   `<meta name="text-scale" content="scale">`; a page that does not reads 1
 *   whatever the system says (bug 77: the e2e read *text size 1.00* under a
 *   system scale of 1.3). `asked` is the variable read with that meta in the
 *   document for the length of the reading, or null where that was not
 *   tried. What 153 reports then is **the system's scale times the browser's
 *   own default font size over 16** (1.3 with a 20 px default reads 1.625),
 *   so the browser's own share — `defaultFont`, read *without* the meta — is
 *   taken out again, and `textFactor`'s rule, the system's scale × the
 *   browser's own, counts it once.
 */
export function systemTextScale(plain: number, asked: number | null, defaultFont: number): number | null {
  if (!(plain > 0)) return null;
  if (plain !== 1) return plain;
  const own = defaultFont / DEFAULT_FONT_PX;
  if (asked === null || !(asked > 0) || !(own > 0)) return plain;
  return asked / own;
}

/** Where `textFactor` read the person's text size from, as `ui()` says it. */
export function textSource(d: Device): "Dynamic Type" | "the system's font scale" | "the browser's font size" {
  if (d.coarse && d.appleBody !== null) return "Dynamic Type";
  if (d.coarse && typeof d.textScale === "number" && d.textScale > 0) return "the system's font scale";
  return "the browser's font size";
}

/** **The device's 100 %**: form factor × preferred text size, to the hundredth. */
export function deviceScale(d: Device): number {
  return Math.round(formFactor(d) * textFactor(d) * 100) / 100;
}

/**
 * A viewer's multiplier held to [UI_MIN, UI_MAX] and to the hundredth, so a
 * typed 0.8000001 and a stepped 0.8 are the same setting. Anything that is not
 * a finite number is null — the caller says what it wanted instead.
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

/** The storage key — versioned like the layout's and the view mode's. It holds the viewer's multiplier only. */
export const UI_SCALE_KEY = "neocad.uiScale.v1";

/** What storage the setting needs: a `localStorage` is one. */
export interface ScaleStorage {
  getItem(key: string): string | null;
  setItem(key: string, value: string): void;
  removeItem(key: string): void;
}

/**
 * The multiplier this viewer chose on this device, or null for none — 100 %,
 * which is not stored, so a viewer who never chose follows their device.
 * Anything unreadable is null.
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
 * Remembers `s`, or with null (or 100 %) forgets it — the device's own size.
 * Returns whether storage took it; a refusal leaves the setting in force for
 * this session only.
 */
export function rememberScale(storage: ScaleStorage | null, s: number | null): boolean {
  if (!storage) return false;
  try {
    if (s === null || s === 1) storage.removeItem(UI_SCALE_KEY);
    else storage.setItem(UI_SCALE_KEY, String(s));
    return true;
  } catch {
    return false;
  }
}
