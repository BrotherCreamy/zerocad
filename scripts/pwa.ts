// The hosted build: the single-file app as an installable PWA, in a folder
// that is served as it is (docs/plans/pwa-pages.md). GitHub Pages publishes
// it from the gh-pages branch (.github/workflows/pages.yml).
//
// Usage: npm run build:pwa   ->  dist-pwa/
//        node --experimental-strip-types scripts/pwa.ts --out DIR [--stamp TEXT]
// --stamp replaces the build stamp (normally the commit and the date), which
// is what names the service worker's cache: the e2e suite uses it to make two
// builds a worker can tell apart.
//
// Requires src/kernel/wasm-gen to exist (npm run build:kernel:dev), as the
// single-file build does.

import { copyFileSync, mkdirSync, rmSync, writeFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { parseArgs } from "node:util";
import { singleFile } from "./singlefile.mjs";
import { ICON_SVG, manifest, pwaDocument, rasters, serviceWorker } from "./pwa-shell.ts";

const root = new URL("..", import.meta.url).pathname;
const { values } = parseArgs({ options: { out: { type: "string" }, stamp: { type: "string" } } });
const out = resolve(values.out ?? join(root, "dist-pwa"));

const app = await singleFile({ stamp: values.stamp });
// The worker must change when the build does, and the stamp is the build's
// name; a checkout with no git gives none, so the time stands in.
const stamp = app.stamp || new Date().toISOString();

// Emptied first: the folder is published as the whole of the site, so a file
// a previous build left would be served as if this build had made it.
rmSync(out, { recursive: true, force: true });
mkdirSync(join(out, "icons"), { recursive: true });

const page = pwaDocument(app);
writeFileSync(join(out, "index.html"), page);
writeFileSync(join(out, "manifest.webmanifest"), JSON.stringify(manifest(), null, 2) + "\n");
writeFileSync(join(out, "sw.js"), serviceWorker(stamp));
// Pages runs Jekyll over a branch unless told not to; nothing here needs it.
writeFileSync(join(out, ".nojekyll"), "");
for (const file of [ICON_SVG, ...rasters().map((r) => r.src)]) {
  mkdirSync(dirname(join(out, file)), { recursive: true });
  copyFileSync(join(root, "public", file), join(out, file));
}

console.log(`${out} — index.html ${(page.length / 1024).toFixed(0)} KB, worker cache for "${stamp}"`);
