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

/**
 * Bridge `download()` into the artifact viewer, which never grants pages the
 * ordinary browser download — an `<a download>` click is silently inert
 * there. The claude.ai runtime instead offers `downloads.save()`, behind a
 * viewer confirmation. main.ts knows nothing about any of this (it hands a
 * blob URL to an anchor and clicks it, as a browser app should), so the
 * bridge lives here, in the one file that is only ever part of the artifact
 * build: remember which Blob each object URL was minted for, intercept the
 * anchor click, and hand the blob to the runtime. Anywhere the runtime is
 * absent — the same file opened from disk, say — the native click proceeds
 * untouched.
 */
function bridgeDownloadsIntoArtifactViewer(): void {
  type DownloadsNs = { save(req: { filename: string; data: Blob }): Promise<unknown> };
  type ClaudeGlobal = { use(name: string): Promise<DownloadsNs | null> };
  const claude = (globalThis as { claude?: ClaudeGlobal }).claude;
  if (typeof claude?.use !== "function") return; // not in the artifact viewer

  const blobs = new Map<string, Blob>();
  const mint = URL.createObjectURL.bind(URL);
  const burn = URL.revokeObjectURL.bind(URL);
  URL.createObjectURL = (obj: Blob | MediaSource) => {
    const url = mint(obj);
    if (obj instanceof Blob) blobs.set(url, obj);
    return url;
  };
  URL.revokeObjectURL = (url: string) => {
    blobs.delete(url);
    burn(url);
  };

  const click = HTMLElement.prototype.click;
  HTMLElement.prototype.click = function (this: HTMLElement) {
    const a = this instanceof HTMLAnchorElement ? this : null;
    const blob = a?.download ? blobs.get(a.href) : undefined;
    if (!a || !blob) return click.call(this);
    // Grabbed synchronously above, so main.ts's revoke right after this
    // click cannot pull the data out from under the async save below.
    const filename = a.download;
    void claude.use("downloads").then(async (downloads) => {
      if (!downloads) return; // capability not granted: nothing we can do
      try {
        await downloads.save({ filename, data: blob });
      } catch {
        // Declined or rate-limited — the viewer's call, not an error state.
      }
    });
  };
}

const b64 = (globalThis as { __NEOCAD_WASM_B64?: string }).__NEOCAD_WASM_B64;
if (!b64) throw new Error("single-file build: embedded kernel missing");
const bytes = Uint8Array.from(atob(b64), (c) => c.charCodeAt(0));
bridgeDownloadsIntoArtifactViewer();
await ensureKernelLoaded(bytes);
await import("../src/main.ts");
