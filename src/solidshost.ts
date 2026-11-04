// Where the solid kernel's Worker comes from, in each way the app is served —
// host-level, like filehost.ts, and constructed by main.ts alone.
//
// - **The dev server** (vite): the Worker is src/solids/worker.ts, which finds
//   the module beside it in src/solids/smlib-gen/.
// - **A build** (scripts/singlefile.mjs, scripts/pwa.ts): the page says where,
//   before main.ts runs, on `globalThis.__ZEROCAD_SOLIDS` — the PWA a Worker
//   script and a .wasm beside the page (each a file of its own, cached by the
//   service worker and fetched only when a body first needs the kernel), the
//   single file both inlined (the Worker as text, the module as base64),
//   since it has no server to fetch from.
//
// Missing the build (`npm run build:solids` never ran), the Worker's import
// fails, the client says so, and the app draws every body of one feature as
// it always has and says that cuts are not shown.

import { SolidsClient, type Port } from "./solids/client.ts";

/** What a build tells the page about its kernel. */
export interface SolidsBuild {
  /** The Worker: a URL beside the page, or its whole text. */
  worker: { url: string } | { text: string };
  /** The module's bytes: a URL to fetch, base64 in the page, or neither (the Worker finds its own). */
  wasm?: { url: string } | { base64: string };
}

function fromBuild(build: SolidsBuild): SolidsClient {
  const url = "url" in build.worker ? build.worker.url
    : URL.createObjectURL(new Blob([build.worker.text], { type: "text/javascript" }));
  const wasm = build.wasm;
  return new SolidsClient(() => new Worker(url, { type: "module" }) as unknown as Port, {
    wasm: async () => {
      if (!wasm) return null;
      if ("url" in wasm) return (await fetch(wasm.url)).arrayBuffer();
      return Uint8Array.from(atob(wasm.base64), (c) => c.charCodeAt(0)).buffer;
    },
  });
}

/** The kernel's client for this page, or null where Workers do not exist. */
export function solidsClient(): SolidsClient | null {
  if (typeof Worker === "undefined") return null;
  const build = (globalThis as { __ZEROCAD_SOLIDS?: SolidsBuild }).__ZEROCAD_SOLIDS;
  if (build) return fromBuild(build);
  return new SolidsClient(() => new Worker(new URL("./solids/worker.ts", import.meta.url), { type: "module" }) as unknown as Port);
}
