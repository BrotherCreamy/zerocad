// Packs the whole app — markup, styles, bundled TypeScript, and the WASM
// kernel — into one self-contained HTML file with no external requests.
//
// Why this exists: the app normally needs a dev server (module resolution,
// the .wasm asset). A single file can be opened from disk, mailed, or
// published as a claude.ai artifact for review. The kernel rides along as
// base64 and is handed to the loader as bytes (`WasmSource` accepts them),
// so nothing is fetched at all. The hosted PWA (scripts/pwa.ts) is this same
// build in a full document, which is why the packing is a function it can call.
//
// Usage: npm run build:single   ->  dist-single/neocad.html
// Requires src/kernel/wasm-gen to exist (npm run build:kernel:dev).
//
// The output is intentionally a fragment — <title> + the page's metas +
// <style> + body content + scripts, no <html>/<head> wrappers — because the
// artifact pipeline supplies its own document shell; browsers render the bare
// fragment fine for local testing.

import { build } from "esbuild";
import { execSync } from "node:child_process";
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { pathToFileURL } from "node:url";

/**
 * The app as pieces: its title, the metas from index.html's head that shape
 * the page (the viewport above all — without it a phone lays the app out at
 * desktop width and lets it zoom), the style, and the body with the kernel
 * and the code inlined. `html` is the fragment build:single writes.
 *
 * @param {{ stamp?: string }} [options] stamp replaces the commit-and-date one
 * @returns {Promise<{ title: string, metas: string, style: string, body: string, stamp: string, html: string, kernelBytes: number }>}
 */
export async function singleFile(options = {}) {
  const wasmPath = new URL("../src/kernel/wasm-gen/neocad_kernel_bg.wasm", import.meta.url);
  let wasm;
  try {
    wasm = readFileSync(wasmPath);
  } catch {
    throw new Error("src/kernel/wasm-gen is missing — run `npm run build:kernel:dev` first.");
  }

  const bundle = await build({
    entryPoints: [new URL("./single-entry.ts", import.meta.url).pathname],
    bundle: true,
    format: "esm",
    target: "es2022",
    minify: true,
    write: false,
    logLevel: "warning",
  });
  // A "</script" inside the bundle text would end our inline tag mid-file.
  const js = bundle.outputFiles[0].text.replace(/<\/script/gi, "<\\/script");

  const index = readFileSync(new URL("../index.html", import.meta.url), "utf8");
  const head = index.match(/<head>([\s\S]*?)<\/head>/)?.[1];
  const title = head?.match(/<title>([\s\S]*?)<\/title>/)?.[1];
  const style = head?.match(/<style>([\s\S]*?)<\/style>/)?.[1];
  let body = index.match(/<body>([\s\S]*?)<\/body>/)?.[1];
  if (!title || !style || !body) throw new Error("index.html no longer matches what this script expects — update the extraction");
  const metas = (head.match(/<meta name="[^"]+" content="[^"]*">/g) ?? []).join("\n");
  if (!metas.includes('name="viewport"')) throw new Error("index.html has lost its viewport meta — the app would zoom and scroll on a phone");
  body = body.replace(/\s*<script type="module"[^>]*><\/script>/, "");

  // A reviewer needs to know which build they are looking at.
  let stamp = options.stamp ?? "";
  if (!stamp) {
    try {
      const rev = execSync("git rev-parse --short HEAD", { encoding: "utf8" }).trim();
      stamp = `${rev} · ${new Date().toISOString().slice(0, 10)}`;
    } catch { /* not in a git checkout — no stamp */ }
  }
  // Into the app menu's About (src/appmenu.ts moves the element there), by its
  // id, which the PWA's tests read.
  if (stamp) {
    const empty = '<span id="buildstamp" hidden></span>';
    if (!body.includes(empty)) throw new Error("index.html has lost its #buildstamp — update the stamp's insertion");
    body = body.replace(empty, `<span id="buildstamp" hidden>build ${stamp}</span>`);
  }

  const fullStyle = style;
  const fullBody = `${body}
<script>window.__NEOCAD_WASM_B64=${JSON.stringify(wasm.toString("base64"))};</script>
<script type="module">${js}</script>`;
  const html = `<title>${title}</title>
${metas}
<style>${fullStyle}</style>
${fullBody}
`;
  return { title, metas, style: fullStyle, body: fullBody, stamp, html, kernelBytes: wasm.length };
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  let app;
  try {
    app = await singleFile();
  } catch (e) {
    console.error(e instanceof Error ? e.message : e);
    process.exit(1);
  }
  mkdirSync(new URL("../dist-single/", import.meta.url), { recursive: true });
  const out = new URL("../dist-single/neocad.html", import.meta.url);
  writeFileSync(out, app.html);
  console.log(`dist-single/neocad.html — ${(app.html.length / 1024).toFixed(0)} KB (kernel ${(app.kernelBytes / 1024).toFixed(0)} KB before base64)`);
}
