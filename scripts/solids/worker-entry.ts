// The solid kernel's Worker as a build bundles it (scripts/singlefile.mjs):
// src/solids/worker.ts, with the module imported statically so the Worker is
// one file — a script beside the PWA's page, or the single-file build's text.
// The .wasm stays its own file (or base64 in the single file) and is handed
// over by the page as bytes, so the bundle never looks for it by URL.

// @ts-expect-error — the build's own output (npm run build:solids), with no types of its own.
import factory from "../../src/solids/smlib-gen/smlib.mjs";
import { serve, type Scope } from "../../src/solids/serve.ts";
import type { SmModule } from "../../src/solids/smlib.ts";

const make = factory as (opts?: { wasmBinary?: ArrayBuffer; locateFile?: (p: string) => string }) => Promise<SmModule>;
// `locateFile`, though the bytes are given: Emscripten's loader resolves the
// .wasm's URL against its own whether it fetches it or not, and against a
// blob: URL (the single file's Worker) that throws.
serve(self as unknown as Scope, (wasm) => make(wasm ? { wasmBinary: wasm, locateFile: (p) => p } : {}));
