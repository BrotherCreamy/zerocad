// Run the measurements in headless Chromium, the kernel in a module Worker —
// the arrangement the app would use — and print JSON.
//
//   node --experimental-strip-types spikes/solid-kernel/bench/chromium.ts <dir holding smlib.mjs>
//
// A tiny static server serves the spike's TypeScript with its types stripped
// (Node's own `stripTypeScriptTypes`, the same transform the unit tests run
// under — so no bundler and no dependency) and the built module beside it.

import { createServer } from "node:http";
import { readFile } from "node:fs/promises";
import { stripTypeScriptTypes } from "node:module";
import { dirname, extname, join, normalize, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { launchBrowser } from "../../../test/e2e/harness.ts";

const build = resolve(process.argv[2] ?? process.env.SMLIB_DIR ?? "");
const spike = resolve(dirname(fileURLToPath(import.meta.url)), "..");

const TYPES: Record<string, string> = { ".mjs": "text/javascript", ".js": "text/javascript", ".ts": "text/javascript",
  ".wasm": "application/wasm", ".html": "text/html" };

const server = createServer(async (req, res) => {
  const url = new URL(req.url ?? "/", "http://x");
  const [root, rest] = url.pathname.startsWith("/smlib/") ? [build, url.pathname.slice(7)]
    : url.pathname.startsWith("/spike/") ? [spike, url.pathname.slice(7)] : [null, ""];
  try {
    if (!root) { res.writeHead(200, { "content-type": "text/html" }).end("<!doctype html><title>bench</title>"); return; }
    const file = normalize(join(root, rest));
    if (!file.startsWith(root)) throw new Error("outside");
    let body: Buffer | string = await readFile(file);
    if (extname(file) === ".ts") body = stripTypeScriptTypes(body.toString(), { mode: "strip" });
    res.writeHead(200, { "content-type": TYPES[extname(file)] ?? "application/octet-stream" }).end(body);
  } catch {
    res.writeHead(404).end();
  }
});
await new Promise<void>((ok) => server.listen(0, "127.0.0.1", ok));
const port = (server.address() as { port: number }).port;

const browser = await launchBrowser();
const page = await browser.newPage();
page.on("console", (m) => process.stderr.write(`[page] ${m.text()}\n`));
await page.goto(`http://127.0.0.1:${port}/`);

const out = await page.evaluate(async (n) => {
  type Reply = { id: number; result?: unknown; error?: string; reserved?: number; inUse?: number };
  let next = 0;
  const call = (w: Worker, msg: object) => new Promise<Reply>((ok, fail) => {
    const id = ++next;
    const on = (ev: MessageEvent<Reply>) => {
      if (ev.data.id !== id) return;
      w.removeEventListener("message", on);
      if (ev.data.error) fail(new Error(ev.data.error)); else ok(ev.data);
    };
    w.addEventListener("message", on);
    w.postMessage({ id, ...msg });
  });
  const spawn = async () => {
    const t0 = performance.now();
    const w = new Worker("/spike/src/worker.ts", { type: "module" });
    const r = await call(w, { module: "/smlib/smlib.mjs" });
    return { w, coldMs: performance.now() - t0, init: r.result as { initMs: number; reserved: number } };
  };

  const first = await spawn();
  const pings: number[] = [];
  for (let i = 0; i < 20; i++) { const t = performance.now(); await call(first.w, {}); pings.push(performance.now() - t); }
  const parts = (await call(first.w, { run: "parts" })).result;
  const identity = (await call(first.w, { run: "identity" })).result;
  const rebuild = (await call(first.w, { run: "rebuild" })).result;
  const heap = (await call(first.w, { run: "heap", n })).result;
  first.w.terminate();

  // Recycling: a fresh Worker starts from the module's initial memory, so
  // what it costs is the start-up, measured here three times.
  const recycled = [];
  for (let i = 0; i < 3; i++) {
    const s = await spawn();
    const r = await call(s.w, { run: "rebuild" });
    recycled.push({ coldMs: s.coldMs, initMs: s.init.initMs, reservedAtStart: s.init.reserved, reservedAfterRebuild: r.reserved });
    s.w.terminate();
  }
  pings.sort((a, b) => a - b);
  return { env: navigator.userAgent, coldMs: first.coldMs, init: first.init, pingMedianMs: pings[10], parts, identity, rebuild, heap, recycled };
}, Number(process.env.REBUILDS ?? 100));

console.log(JSON.stringify(out, null, 1));
await browser.close();
server.close();
