// What makes the single-file build an installable app: the manifest, the
// document head, and the service worker's source with its cache named. Kept
// apart from the build itself (scripts/pwa.ts) so the unit suite can check
// all of it without bundling anything — docs/plans/pwa-pages.md.
//
// **Every URL here is relative.** The site is served from a sub-path
// (https://brothercreamy.github.io/zerocad/), so a leading "/" would point at
// the account's root, where nothing of this app is. A relative URL in the
// manifest resolves against the manifest's own URL, and one in the page or
// the service worker against theirs, and all three live in the same folder.

import { readFileSync } from "node:fs";

/** The page's ground (index.html's body) — what a launching app shows before it draws. */
export const BACKGROUND = "#0a0e13";
/**
 * The colour the system bars round the installed app take — on an iPhone the
 * status bar's band, which the app starts below (`pwaHead`). The drawing's
 * own ground: there is no title bar, so the band and the drawing under it
 * read as one surface.
 */
export const THEME = BACKGROUND;

export interface Icon {
  src: string;
  sizes: string;
  type: string;
  purpose: "any" | "maskable";
}

/**
 * The PNGs scripts/icons.ts rasterises from public/icons/icon.svg, committed
 * so the deploy needs no browser. An "any" icon is shown as it is, so its
 * corners are rounded; a maskable one is cut by the launcher, so it is full
 * bleed. iOS takes neither: it wants its own PNG (APPLE_TOUCH_ICON) and
 * rounds it itself, so that one is full bleed too.
 */
export const ICONS: Icon[] = [
  { src: "icons/icon-192.png", sizes: "192x192", type: "image/png", purpose: "any" },
  { src: "icons/icon-512.png", sizes: "512x512", type: "image/png", purpose: "any" },
  { src: "icons/icon-maskable-512.png", sizes: "512x512", type: "image/png", purpose: "maskable" },
];
export const APPLE_TOUCH_ICON = { src: "icons/apple-touch-icon.png", size: 180 };
/** The SVG they are all drawn from, also the page's favicon. */
export const ICON_SVG = "icons/icon.svg";

/** Every raster scripts/icons.ts makes: its file under public/, its side, whether its corners are rounded. */
export function rasters(): { src: string; size: number; rounded: boolean }[] {
  return [
    ...ICONS.map((i) => ({ src: i.src, size: Number(i.sizes.split("x")[0]), rounded: i.purpose === "any" })),
    { src: APPLE_TOUCH_ICON.src, size: APPLE_TOUCH_ICON.size, rounded: false },
  ];
}

export function manifest(): Record<string, unknown> {
  return {
    name: "ZeroCAD",
    short_name: "ZeroCAD",
    description: "Relational CAD on a nonlinear least-squares solver, entirely in the browser.",
    // The manifest's own folder: under /zerocad/ that is /zerocad/, and the
    // same file served anywhere else still means "here".
    id: "./",
    start_url: "./",
    scope: "./",
    display: "standalone",
    orientation: "any",
    background_color: BACKGROUND,
    theme_color: THEME,
    icons: ICONS,
    file_handlers: FILE_HANDLERS,
  };
}

/**
 * The files an installed desktop app offers to open (Chromium 102+, desktop
 * only; docs/plans/files.md). The file arrives in `launchQueue`
 * (src/filehost.ts). iOS and every other browser ignore the member.
 *
 * **`.json`, not `.zerocad.json`.** The operating system keeps the
 * association, and a file's extension there is what follows its last dot
 * (Windows' associations are keyed so); whether Chromium registers a
 * two-part extension in a way any desktop honours is not documented and
 * could not be tried here, as no app can be installed in the test browser.
 * `.json` certainly works. So the app is offered for JSON files — an "Open
 * with" entry, never the default unless a person makes it so — and a JSON
 * file that is not a drawing is refused with the reason, as any open is.
 */
export const FILE_HANDLERS = [{ action: "./", accept: { "application/json": [".json"] } }];

/**
 * The service worker's cache, named for the build. Caches belong to the
 * origin, not the path — every Pages site of the account shares
 * brothercreamy.github.io — so the prefix is what lets a new worker delete
 * only its own old caches.
 */
export const CACHE_PREFIX = "zerocad-";
export function cacheName(stamp: string): string {
  const slug = stamp.trim().replace(/[^A-Za-z0-9.]+/g, "-").replace(/^-|-$/g, "");
  if (!slug) throw new Error("a service worker's cache needs a build stamp to be named for");
  return CACHE_PREFIX + slug;
}

/** The solid kernel's files, beside the page (docs/plans/solids-kernel.md): its Worker, its module and its licence. */
export const SOLID_FILES = ["solids/worker.js", "solids/smlib.wasm", "solids/LICENSE"];

/**
 * What the worker keeps: the page (as "./", the address the app is started
 * at), the manifest and the icons — and, in a build that has it, the solid
 * kernel's files. The page is the app — the solver's kernel and the code ride
 * inside it — so it opens with no network at all; the solid kernel is its own
 * 4 MB, fetched by the page only when a body first needs it and cached here at
 * install, so it is there offline too.
 */
export function shellFiles(solids = false): string[] {
  return ["./", "manifest.webmanifest", ICON_SVG, ...rasters().map((r) => r.src), ...(solids ? SOLID_FILES : [])];
}

const SW_TEMPLATE = new URL("./pwa-sw.js", import.meta.url);

/** The hand-written worker (scripts/pwa-sw.js) with its cache and its file list filled in. */
export function serviceWorker(stamp: string, solids = false): string {
  const src = readFileSync(SW_TEMPLATE, "utf8");
  const filled = src
    .replace('"__NEOCAD_CACHE__"', JSON.stringify(cacheName(stamp)))
    .replace("__NEOCAD_SHELL__", JSON.stringify(shellFiles(solids)));
  if (filled.includes("__NEOCAD_")) throw new Error("scripts/pwa-sw.js has a placeholder this build does not fill");
  return filled;
}

/**
 * The head the hosted build adds to the app's own (index.html's viewport and
 * the metas that shape the page, which every build carries): the manifest,
 * the icons, and what iOS reads instead of the manifest — it still takes the
 * standalone flag, the status bar's style and the home-screen title from
 * these, not from the manifest.
 */
export function pwaHead(): string {
  return [
    `<meta name="theme-color" content="${THEME}">`,
    `<meta name="mobile-web-app-capable" content="yes">`,
    `<meta name="apple-mobile-web-app-capable" content="yes">`,
    // **`default`, not `black-translucent`.** Translucent, the page ran under
    // the status bar — and since iOS 26's Liquid Glass, iOS draws its
    // scroll-edge blur over the top ~40 pt of a translucent home-screen app
    // (the owner's screenshot: "some blending at the top of the screen";
    // reported by several projects, not stated by Apple — see
    // CONVERSATION_LOG.md). `default` starts the page below the bar, the bar
    // a solid band in `theme-color`, and there is nothing under it to blur.
    // iOS reads this when the app is added to the home screen: an installed
    // app keeps its old style until it is removed and added again.
    `<meta name="apple-mobile-web-app-status-bar-style" content="default">`,
    `<meta name="apple-mobile-web-app-title" content="ZeroCAD">`,
    `<link rel="manifest" href="manifest.webmanifest">`,
    `<link rel="icon" type="image/svg+xml" href="${ICON_SVG}">`,
    `<link rel="apple-touch-icon" sizes="180x180" href="${APPLE_TOUCH_ICON.src}">`,
    // Registered from the hosted build only, never from index.html: a worker
    // on the dev server would serve yesterday's code from its cache, and the
    // single-file artifact is not served from anywhere a worker could live.
    // No reload when a new version is found: it waits, and applies on the
    // next start (see pwa-sw.js).
    `<script>if ("serviceWorker" in navigator) addEventListener("load", () => navigator.serviceWorker.register("./sw.js").catch((e) => console.warn("service worker not registered:", e)));</script>`,
  ].join("\n");
}

/** The single-file build's pieces, wrapped as a full document with the PWA head. */
export function pwaDocument(app: { title: string; metas: string; style: string; body: string }): string {
  return `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
${app.metas}
<title>${app.title}</title>
${pwaHead()}
<style>${app.style}</style>
</head>
<body>
${app.body}
</body>
</html>
`;
}
