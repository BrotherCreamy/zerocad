// Every iPhone screen size Apple sells or still supports, from the SE to the
// Pro Max — and, below them, the Android devices (docs/plans/android.md) —
// the table "everything has to fit" is tested over
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

// ---- Android (docs/plans/android.md) ---------------------------------------------
//
// Pixels 7, 8 and 9 with their Pro sizes, the Galaxy S23/S24, a Galaxy Z Fold's
// cover and inner screens, a Pixel Tablet and a Galaxy Tab. One row per
// distinct screen *and insets*: the Pixel 8 Pro and 9 Pro XL share a screen
// but not a camera cutout.
//
// Where each number comes from:
//
// - **The screen** (`w`, `h`, CSS px, portrait) and `dpr`: Playwright's device
//   descriptors (playwright-core 1.62, `devices["Pixel 7"].screen` …), which are
//   Chrome DevTools' device list. Two rows have no descriptor and are
//   **derived**: the Galaxy S23 shares the S24's 1080 × 2340 panel at the S24's
//   scale; the Pixel Tablet is Google's 2560 × 1600 at xhdpi (2.0). Note the
//   Pixel 9's descriptor: 360 × 808 at 3, which is the 1080 × 2424 panel at a
//   scale of 3 — Android's own default for it is 420 dpi (2.625, so 411 wide).
//   The table keeps Playwright's, which is the narrowest phone in it.
// - **The status bar and the camera cutout**: AOSP's device overlays for each
//   Pixel (android.googlesource.com, device/google/{pantah,shusky,caimito},
//   `status_bar_height_portrait` and `config_mainBuiltInDisplayCutoutRect
//   Approximation`, read 2026-11-06): Pixel 7 136 px, 7 Pro 144, 8 132, 8 Pro
//   151, 9 173, 9 Pro 204, 9 Pro XL 199 — divided by the descriptor's scale and
//   rounded up. The status bar is AOSP's rule, `max(cutout's safe inset, its
//   default)` (`SystemBarUtils.getStatusBarHeight`), and 28 dp in landscape on
//   every one of them (`status_bar_height_landscape`). Turned on its side, the
//   phone's cutout is on a side, as deep as it was tall. **Samsung publishes no
//   overlay**: its status bars are **estimated** — 40 on a phone (between
//   AOSP's 24 dp floor and the Pixels' 41–68), 32 on the Fold's inner screen,
//   24 on the tablets (no camera in the glass) — and so is the Pixel Tablet's.
// - **The navigation bar**: AOSP's `navigation_bar_height` — 48 dp with three
//   buttons (frameworks/base core/res values/dimens.xml), 24 dp with gestures
//   (the NavigationBarModeGestural overlay). With three buttons a phone on its
//   side carries the bar as a 48 dp column at its right
//   (`navigation_bar_width`); a large screen keeps it along the bottom as the
//   taskbar.
// - **Chrome's page in a tab** (`chrome`): the descriptors' viewports, Chrome's
//   page with its toolbar. Where a descriptor gives only the screen (the
//   S23/S24, the Tab S9) or there is none (the Pixel Tablet), it is
//   **estimated** the way DevTools' every other Android row is made: 76 px off
//   the height upright, 52 off each side on its side.
//
// **What the page reports** (`androidWindowOf`), installed: the page starts
// below the status bar, which takes the theme colour (Chrome's standalone
// window); with gestures it runs under the gesture bar, which reports its
// 24 as the bottom inset (Chrome 135's edge to edge, `viewport-fit=cover`);
// with three buttons it stops above the bar, inset 0. On its side the cutout
// is a left inset — the camera at the left, the buttons at the right. In a
// tab, Chrome's toolbar is the page's edge and nothing is inset (before
// Chrome 135, or with three buttons; after, the gesture bar's 24 px are under
// the page with an inset of 24 — the same area). **Not measured on a device**:
// whether Chrome letterboxes a standalone app's landscape cutout (no inset, a
// page that much narrower — the same area) or reports it.

export interface AndroidDevice {
  platform: "android";
  name: string;
  /** Portrait CSS px, and the scale they are drawn at. */
  w: number;
  h: number;
  dpr: number;
  /** The status bar's height upright and on its side. */
  status: { portrait: number; landscape: number };
  /** How deep the camera cutout is — a side inset when the phone is on its side; 0 for none. */
  cutout: number;
  /** A large screen (short side ≥ 600): a taskbar along the bottom both ways up, never a side column. */
  large: boolean;
  /** Chrome's page in a tab, with its toolbar, upright and on its side. */
  chrome: { portrait: { w: number; h: number }; landscape: { w: number; h: number } };
  /** The descriptor this row's screen is Playwright's for, if any. */
  descriptor?: string;
  /** Which of the numbers are estimated rather than read off a source. */
  estimated?: string[];
}

/** Chrome's tab, the DevTools way: 76 px off the height upright, 52 off each side on its side. */
const tab = (w: number, h: number) => ({ portrait: { w, h: h - 76 }, landscape: { w: h - 52, h: w - 52 } });
const pg = (w: number, h: number) => ({ w, h });

export const ANDROIDS: readonly AndroidDevice[] = [
  {
    platform: "android", name: "Pixel 9", w: 360, h: 808, dpr: 3, status: { portrait: 58, landscape: 28 }, cutout: 58, large: false,
    chrome: { portrait: pg(360, 732), landscape: pg(756, 308) }, descriptor: "Pixel 9",
  },
  {
    platform: "android", name: "Galaxy S23, S24", w: 360, h: 780, dpr: 3, status: { portrait: 40, landscape: 24 }, cutout: 40, large: false,
    chrome: tab(360, 780), descriptor: "Galaxy S24", estimated: ["status bar", "cutout", "Chrome's page", "the S23 (the S24's panel)"],
  },
  {
    platform: "android", name: "Galaxy Z Fold 7 cover", w: 360, h: 840, dpr: 3, status: { portrait: 40, landscape: 24 }, cutout: 40, large: false,
    chrome: { portrait: pg(360, 764), landscape: pg(788, 308) }, descriptor: "Galaxy Z Fold 7 Cover", estimated: ["status bar", "cutout"],
  },
  {
    platform: "android", name: "Pixel 7, 7a, 8, 8a", w: 412, h: 915, dpr: 2.625, status: { portrait: 52, landscape: 28 }, cutout: 52, large: false,
    chrome: { portrait: pg(412, 839), landscape: pg(863, 360) }, descriptor: "Pixel 7",
  },
  {
    platform: "android", name: "Pixel 7 Pro", w: 412, h: 892, dpr: 3.5, status: { portrait: 42, landscape: 28 }, cutout: 42, large: false,
    chrome: { portrait: pg(412, 816), landscape: pg(840, 360) }, descriptor: "Pixel 7 Pro",
  },
  {
    platform: "android", name: "Pixel 9 Pro", w: 427, h: 952, dpr: 3, status: { portrait: 68, landscape: 28 }, cutout: 68, large: false,
    chrome: { portrait: pg(427, 876), landscape: pg(900, 375) }, descriptor: "Pixel 9 Pro",
  },
  {
    platform: "android", name: "Pixel 8 Pro", w: 448, h: 997, dpr: 3, status: { portrait: 51, landscape: 28 }, cutout: 51, large: false,
    chrome: { portrait: pg(448, 921), landscape: pg(945, 396) }, descriptor: "Pixel 8 Pro",
  },
  {
    platform: "android", name: "Pixel 9 Pro XL", w: 448, h: 997, dpr: 3, status: { portrait: 67, landscape: 28 }, cutout: 67, large: false,
    chrome: { portrait: pg(448, 921), landscape: pg(945, 396) }, descriptor: "Pixel 9 Pro XL",
  },
  {
    platform: "android", name: "Galaxy Tab S9", w: 640, h: 1024, dpr: 2.5, status: { portrait: 24, landscape: 24 }, cutout: 0, large: true,
    chrome: tab(640, 1024), descriptor: "Galaxy Tab S9", estimated: ["status bar", "Chrome's page"],
  },
  {
    platform: "android", name: "Pixel Tablet", w: 800, h: 1280, dpr: 2, status: { portrait: 24, landscape: 24 }, cutout: 0, large: true,
    chrome: tab(800, 1280), estimated: ["the screen (2560 × 1600 at 2.0)", "status bar", "Chrome's page"],
  },
  {
    platform: "android", name: "Galaxy Z Fold 7 inner", w: 984, h: 1092, dpr: 2, status: { portrait: 32, landscape: 32 }, cutout: 0, large: true,
    chrome: { portrait: pg(984, 1016), landscape: pg(1040, 932) }, descriptor: "Galaxy Z Fold 7", estimated: ["status bar"],
  },
];

/** AOSP's navigation bar: three buttons, and the gesture bar's handle (core/res dimens.xml and its gestural overlay). */
export const NAV_BUTTONS = 48;
export const NAV_GESTURE = 24;

/**
 * Android's ways of showing the page: installed with the gesture bar (the
 * default since Android 10), installed with the three-button bar, and in a
 * Chrome tab.
 */
export type AndroidMode = "installed" | "buttons" | "chrome";

/** What the page is on an Android device held `turn`, shown `mode` — see the notes above the table. */
export function androidWindowOf(d: AndroidDevice, turn: Turn, mode: AndroidMode): { w: number; h: number; insets: Insets } {
  if (mode === "chrome") return { ...d.chrome[turn], insets: ins(0, 0, 0, 0) };
  const gesture = mode === "installed";
  if (turn === "portrait") {
    const h = d.h - d.status.portrait;
    return gesture ? { w: d.w, h, insets: ins(0, 0, NAV_GESTURE, 0) } : { w: d.w, h: h - NAV_BUTTONS, insets: ins(0, 0, 0, 0) };
  }
  const [w, h] = [d.h, d.w - d.status.landscape];
  const side = d.large ? 0 : d.cutout;
  if (gesture) return { w, h, insets: ins(0, 0, NAV_GESTURE, side) };
  // Three buttons: a phone's column at the right, a large screen's taskbar along the bottom.
  return d.large ? { w, h: h - NAV_BUTTONS, insets: ins(0, 0, 0, 0) } : { w: w - NAV_BUTTONS, h, insets: ins(0, 0, 0, side) };
}

/** The area the panels are laid out in on an Android device: the window less its insets. */
export function androidAreaOf(d: AndroidDevice, turn: Turn, mode: AndroidMode): { w: number; h: number } {
  const win = androidWindowOf(d, turn, mode);
  return { w: win.w - win.insets.left - win.insets.right, h: win.h - win.insets.top - win.insets.bottom };
}

/** Every Android device, both ways up, every way shown. */
export function* everyAndroidWay(): Generator<{ device: AndroidDevice; turn: Turn; mode: AndroidMode }> {
  for (const device of ANDROIDS) for (const turn of ["portrait", "landscape"] as const) {
    for (const mode of ["installed", "buttons", "chrome"] as const) yield { device, turn, mode };
  }
}
