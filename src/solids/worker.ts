// The solid kernel's Worker, as the dev server serves it: `new Worker(new
// URL("./solids/worker.ts", import.meta.url), { type: "module" })` from
// bodies.ts's host. A build bundles scripts/solids/worker-entry.ts instead,
// which imports the module statically so the whole Worker is one file.
//
// The module is found beside this file (src/solids/smlib-gen/, npm run
// build:solids) unless the page hands its bytes over, as the single-file build
// does: it has no server to fetch from.

import { serve, type Scope } from "./serve.ts";
import type { SmModule } from "./smlib.ts";

type Factory = (opts?: { wasmBinary?: ArrayBuffer }) => Promise<SmModule>;

serve(self as unknown as Scope, async (wasm) => {
  // A computed URL, so neither the type checker nor a bundler insists on a
  // file the checkout may not have built yet: without it, the client says the
  // kernel is missing and the app goes on drawing what it can.
  const url = new URL("./smlib-gen/smlib.mjs", import.meta.url).href;
  const factory = (await import(/* @vite-ignore */ url)).default as Factory;
  return factory(wasm ? { wasmBinary: wasm } : {});
});
