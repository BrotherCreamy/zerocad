// Every iPhone screen size Apple sells or still supports, from the SE to the
// Pro Max — the table "everything has to fit" is tested over
// (docs/plans/everything-fits.md; the owner: "Second row.... everything has
// to fit"). One row per distinct size: phones that share a screen share a row.
//
// Where each number comes from:
//
// - **Portrait points** (`w`, `h`): Apple's sizes as tabulated by Use Your
//   Loaf, "iPhone 17 Screen Sizes" (useyourloaf.com/blog/iphone-17-screen-sizes/,
//   September 2025) and "iPhone 16 Screen Sizes"; each agrees with the screen
//   Playwright's device descriptors give (`devices["iPhone 17 Pro Max"].screen`
//   is 440 × 956, and so on). Apple's own HIG page no longer carries the table
//   in a form that can be read without a browser (its JSON, fetched
//   2026-11-04, lists only the change log of when each phone was added).
// - **Safe-area insets** (`portrait`, `landscape`, top/right/bottom/left):
//   Use Your Loaf's posts, read off the iOS simulator — "iPhone 17 Screen
//   Sizes" for the iPhone 17, 17 Pro, 17 Pro Max and Air (iOS 26: a landscape
//   status bar inset of 20 at the top), "iPhone 16 Screen Sizes" for the 16
//   and 16 Plus (iOS 18: 0 at the top in landscape), "iPhone 14 Screen Sizes"
//   for the 390 × 844 notch (47 portrait, 47 each side in landscape). The SE's
//   20 pt status bar and no insets in landscape are UIKit's for every Touch ID
//   iPhone; no post gives them, and the simulator does.
// - **Safari's page** (`safari`): Playwright's device descriptors' viewports
//   (node_modules/playwright-core's deviceDescriptorsSource.json), which are
//   Safari's measured page with its bars — e.g. 390 × 664 for an iPhone 13,
//   which the touch suite has always run at. The SE has none that is Safari's
//   (its "iPhone SE (3rd gen)" viewport is the whole 375 × 667 screen), so its
//   row is **estimated**: the 16e's bars (844 − 651 = 193 pt portrait, of which
//   47 is its status bar, so 146 of Safari; 50 in landscape) on the SE's 20 pt
//   status bar — 375 × 501 and 667 × 325.
//
// **The area the panels get** (`areaOf`): in the installed app, the screen
// less its insets (the installed app's status bar is `default`, so its page
// starts below the bar — the area is the same either way); in Safari, the
// page less the landscape home indicator's inset (a portrait Safari page ends
// above its toolbar, so nothing is under the home indicator there).

export interface Insets { top: number; right: number; bottom: number; left: number }

export interface IPhone {
  name: string;
  /** Portrait points. */
  w: number;
  h: number;
  portrait: Insets;
  landscape: Insets;
  /** Safari's page, portrait then landscape, in points. */
  safari: { portrait: { w: number; h: number }; landscape: { w: number; h: number } };
}

const ins = (top: number, right: number, bottom: number, left: number): Insets => ({ top, right, bottom, left });

export const IPHONES: readonly IPhone[] = [
  {
    name: "iPhone SE (2nd, 3rd gen)", w: 375, h: 667, portrait: ins(20, 0, 0, 0), landscape: ins(0, 0, 0, 0),
    safari: { portrait: { w: 375, h: 501 }, landscape: { w: 667, h: 325 } },
  },
  {
    name: "iPhone 13, 14, 16e, 17e", w: 390, h: 844, portrait: ins(47, 0, 34, 0), landscape: ins(0, 47, 21, 47),
    safari: { portrait: { w: 390, h: 664 }, landscape: { w: 750, h: 342 } },
  },
  {
    name: "iPhone 16, 15, 15 Pro, 14 Pro", w: 393, h: 852, portrait: ins(59, 0, 34, 0), landscape: ins(0, 59, 21, 59),
    safari: { portrait: { w: 393, h: 659 }, landscape: { w: 734, h: 343 } },
  },
  {
    name: "iPhone 17, 17 Pro, 16 Pro", w: 402, h: 874, portrait: ins(62, 0, 34, 0), landscape: ins(20, 62, 20, 62),
    safari: { portrait: { w: 402, h: 681 }, landscape: { w: 756, h: 352 } },
  },
  {
    name: "iPhone Air", w: 420, h: 912, portrait: ins(68, 0, 34, 0), landscape: ins(20, 68, 29, 68),
    safari: { portrait: { w: 420, h: 719 }, landscape: { w: 794, h: 370 } },
  },
  {
    name: "iPhone 16 Plus, 15 Plus, 15 Pro Max, 14 Pro Max", w: 430, h: 932, portrait: ins(59, 0, 34, 0), landscape: ins(0, 59, 21, 59),
    safari: { portrait: { w: 430, h: 739 }, landscape: { w: 814, h: 380 } },
  },
  {
    name: "iPhone 17 Pro Max, 16 Pro Max", w: 440, h: 956, portrait: ins(62, 0, 34, 0), landscape: ins(20, 62, 20, 62),
    safari: { portrait: { w: 440, h: 763 }, landscape: { w: 838, h: 390 } },
  },
];

export type Mode = "installed" | "safari";
export type Turn = "portrait" | "landscape";

/**
 * What the page is, for a phone held `turn` in `mode`: the window (CSS
 * pixels) and the safe-area insets it reports — what an emulation sets, and
 * what the panels' area is made from.
 */
export function windowOf(p: IPhone, turn: Turn, mode: Mode): { w: number; h: number; insets: Insets } {
  if (mode === "safari") {
    const s = p.safari[turn];
    // In landscape the home indicator is under Safari's page too.
    return { ...s, insets: turn === "landscape" ? ins(0, 0, p.landscape.bottom, 0) : ins(0, 0, 0, 0) };
  }
  if (turn === "portrait") {
    // The installed app's status bar is `default`: the page starts below it.
    return { w: p.w, h: p.h - p.portrait.top, insets: ins(0, 0, p.portrait.bottom, 0) };
  }
  return { w: p.h, h: p.w, insets: p.landscape };
}

/** The area the panels are laid out in: the window less its insets. */
export function areaOf(p: IPhone, turn: Turn, mode: Mode): { w: number; h: number } {
  const win = windowOf(p, turn, mode);
  return { w: win.w - win.insets.left - win.insets.right, h: win.h - win.insets.top - win.insets.bottom };
}

/** Every phone, both ways up, both ways installed. */
export function* everyWay(): Generator<{ phone: IPhone; turn: Turn; mode: Mode }> {
  for (const phone of IPHONES) for (const turn of ["portrait", "landscape"] as const) for (const mode of ["installed", "safari"] as const) {
    yield { phone, turn, mode };
  }
}
