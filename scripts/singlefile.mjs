// Packs the whole app — markup, styles, bundled TypeScript, and the WASM
// kernel — into one self-contained HTML file with no external requests.
//
// Why this exists: the app normally needs a dev server (module resolution,
// the .wasm asset). A single file can be opened from disk, mailed, or
// published as a claude.ai artifact for review. The kernel rides along as
// base64 and is handed to the loader as bytes (`WasmSource` accepts them),
// so nothing is fetched at all.
//
// Usage: npm run build:single   ->  dist-single/neocad.html
// Requires src/kernel/wasm-gen to exist (npm run build:kernel:dev).
//
// The output is intentionally a fragment — <title> + <style> + body content +
// scripts, no <html>/<head> wrappers — because the artifact pipeline supplies
// its own document shell; browsers render the bare fragment fine for local
// testing.

import { build } from "esbuild";
import { execSync } from "node:child_process";
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";

const wasmPath = new URL("../src/kernel/wasm-gen/neocad_kernel_bg.wasm", import.meta.url);
let wasm;
try {
  wasm = readFileSync(wasmPath);
} catch {
  console.error("src/kernel/wasm-gen is missing — run `npm run build:kernel:dev` first.");
  process.exit(1);
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
const style = index.match(/<style>([\s\S]*?)<\/style>/)?.[1];
let body = index.match(/<body>([\s\S]*?)<\/body>/)?.[1];
if (!style || !body) throw new Error("index.html no longer matches what this script expects — update the extraction");
body = body.replace(/\s*<script type="module"[^>]*><\/script>/, "");

// A reviewer needs to know which build they are looking at.
let stamp = "";
try {
  const rev = execSync("git rev-parse --short HEAD", { encoding: "utf8" }).trim();
  stamp = `${rev} · ${new Date().toISOString().slice(0, 10)}`;
} catch { /* not in a git checkout — no stamp */ }
if (stamp) {
  body = body.replace(
    '<span id="status">',
    `<span id="buildstamp" style="font-size:10px;color:#46586a;margin-left:auto">build ${stamp}</span><span id="status">`,
  );
}

const html = `<title>NeoCAD</title>
<style>${style}
#buildstamp{margin-left:auto}</style>
${body}
<script>window.__NEOCAD_WASM_B64=${JSON.stringify(wasm.toString("base64"))};</script>
<script type="module">${js}</script>
`;

mkdirSync(new URL("../dist-single/", import.meta.url), { recursive: true });
const out = new URL("../dist-single/neocad.html", import.meta.url);
writeFileSync(out, html);
console.log(`dist-single/neocad.html — ${(html.length / 1024).toFixed(0)} KB (kernel ${(wasm.length / 1024).toFixed(0)} KB before base64)`);
