// Entry point for the single-file build (see singlefile.mjs).
//
// The one thing this wrapper exists to do is feed the kernel its bytes before
// the app asks for them. The page embeds the .wasm as base64; decoding it and
// seeding ensureKernelLoaded's memo here means main.ts's own no-argument call
// finds the kernel already loading and never tries to fetch a URL — which is
// the whole reason the app can run from a lone .html file with no server.
//
// Dynamic import, not a static one: static imports hoist above statements, so
// main.ts (which starts the app as a side effect) would run before the seed.

import { ensureKernelLoaded } from "../src/kernel/problem.ts";

const b64 = (globalThis as { __NEOCAD_WASM_B64?: string }).__NEOCAD_WASM_B64;
if (!b64) throw new Error("single-file build: embedded kernel missing");
const bytes = Uint8Array.from(atob(b64), (c) => c.charCodeAt(0));
await ensureKernelLoaded(bytes);
await import("../src/main.ts");
