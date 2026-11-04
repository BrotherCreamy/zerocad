// What makes the single-file build an installable app: the manifest, the
// document head, and the service worker's source with its cache named. Kept
// apart from the build itself (scripts/pwa.ts) so the unit suite can check
// all of it without bundling anything — docs/plans/pwa-pages.md.
//
// **Every URL here is relative.** The site is served from a sub-path
// (https://brothercreamy.github.io/neocad/), so a leading "/" would point at
// the account's root, where nothing of this app is. A relative URL in the
// manifest resolves against the manifest's own URL, and one in the page or
// the service worker against theirs, and all three live in the same folder.

import { readFileSync } from "node:fs";

/** The page's ground (index.html's body) — what a launching app shows before it draws. */
export const BACKGROUND = "#0a0e13";
/** The header's ground: the colour the system bars around the app take. */
export const THEME = "#0e141b";

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
    name: "NeoCAD",
    short_name: "NeoCAD",
    description: "Relational CAD on a nonlinear least-squares solver, entirely in the browser.",
    // The manifest's own folder: under /neocad/ that is /neocad/, and the
    // same file served anywhere else still means "here".
    id: "./",
    start_url: "./",
    scope: "./",
    display: "standalone",
    orientation: "any",
    background_color: BACKGROUND,
    theme_color: THEME,
    icons: ICONS,
  };
}

/**
 * The service worker's cache, named for the build. Caches belong to the
 * origin, not the path — every Pages site of the account shares
 * brothercreamy.github.io — so the prefix is what lets a new worker delete
 * only its own old caches.
 */
export const CACHE_PREFIX = "neocad-";
export function cacheName(stamp: string): string {
  const slug = stamp.trim().replace(/[^A-Za-z0-9.]+/g, "-").replace(/^-|-$/g, "");
  if (!slug) throw new Error("a service worker's cache needs a build stamp to be named for");
  return CACHE_PREFIX + slug;
}

/**
 * What the worker keeps: the page (as "./", the address the app is started
 * at), the manifest and the icons. The page alone is the app — the kernel and
 * the code ride inside it — so this is the whole of what offline needs.
 */
export function shellFiles(): string[] {
  return ["./", "manifest.webmanifest", ICON_SVG, ...rasters().map((r) => r.src)];
}

const SW_TEMPLATE = new URL("./pwa-sw.js", import.meta.url);

/** The hand-written worker (scripts/pwa-sw.js) with its cache and its file list filled in. */
export function serviceWorker(stamp: string): string {
  const src = readFileSync(SW_TEMPLATE, "utf8");
  const filled = src
    .replace('"__NEOCAD_CACHE__"', JSON.stringify(cacheName(stamp)))
    .replace("__NEOCAD_SHELL__", JSON.stringify(shellFiles()));
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
    // Translucent: the app draws under the status bar, and the header's own
    // padding (env(safe-area-inset-top), index.html) keeps its text clear.
    `<meta name="apple-mobile-web-app-status-bar-style" content="black-translucent">`,
    `<meta name="apple-mobile-web-app-title" content="NeoCAD">`,
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
