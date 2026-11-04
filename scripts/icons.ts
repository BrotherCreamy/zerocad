// Writes public/icons/icon.svg from the logo (src/logo.ts's `iconSvg` — the
// logo over the drawing and the home-screen icon are one mark, so the icon is
// generated from it rather than drawn beside it) and rasterises it to the PNGs
// the PWA names (scripts/pwa-shell.ts's `rasters`), with the Chromium the e2e
// suite uses. Run once when the mark changes, and commit the SVG and the PNGs:
// iOS will only take a PNG for the home screen, and the deploy should need no
// browser to build. test/chrome.test.ts fails if the SVG on disk is not the
// mark's.
//
// Usage: npm run build:icons
//
// The "any" icons get rounded corners here, transparent outside them; the
// maskable one and iOS's are left square and full bleed, because the
// launcher cuts those itself and fills a transparent corner with black.

import { readFileSync, writeFileSync } from "node:fs";
import { launchBrowser } from "../test/e2e/harness.ts";
import { ICON_SVG, rasters } from "./pwa-shell.ts";
import { iconSvg } from "../src/logo.ts";

/** The corner of a rounded "any" icon, as a share of its side — iOS's own squircle is about this. */
const CORNER = 0.22;

const publicDir = new URL("../public/", import.meta.url);
writeFileSync(new URL(ICON_SVG, publicDir), iconSvg());
console.log(`public/${ICON_SVG} — from src/logo.ts`);
const svg = readFileSync(new URL(ICON_SVG, publicDir));
const src = `data:image/svg+xml;base64,${svg.toString("base64")}`;

const browser = await launchBrowser();
try {
  for (const r of rasters()) {
    const page = await browser.newPage({ viewport: { width: r.size, height: r.size }, deviceScaleFactor: 1 });
    const radius = r.rounded ? `${Math.round(r.size * CORNER)}px` : "0";
    await page.setContent(
      `<body style="margin:0;background:transparent"><img src="${src}" width="${r.size}" height="${r.size}" style="display:block;border-radius:${radius}"></body>`,
    );
    await page.$eval("img", (img: HTMLImageElement) => img.decode());
    const png = await page.screenshot({ omitBackground: true, clip: { x: 0, y: 0, width: r.size, height: r.size } });
    writeFileSync(new URL(r.src, publicDir), png);
    console.log(`public/${r.src} — ${r.size}px, ${png.length} bytes`);
    await page.close();
  }
} finally {
  await browser.close();
}
