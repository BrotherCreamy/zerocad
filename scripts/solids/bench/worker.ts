// The kernel in a Worker — where it would sit under main.ts: single-threaded
// wasm off the UI thread, spoken to by messages.
//
// The protocol is the spike's, not a product's: `{ module }` loads a kernel
// build by URL, then `{ run }` names a measurement and the reply carries its
// report. A product protocol would be per-operation (`extrude`, `boolean`, …)
// with handles in replies; the measurements are enough to show the cost of
// the hop and of the kernel behind it.

import { heapOverRebuilds, identity, rebuildAll, runAll } from "../../../test/solids/bench.ts";
import { PARTS } from "../../../test/solids/parts.ts";
import { SmlibKernel, type SmModule } from "../../../src/solids/smlib.ts";

let kernel: SmlibKernel | null = null;

type Request = { id: number; module?: string; run?: "parts" | "identity" | "rebuild" | "heap"; n?: number };

self.onmessage = async (ev: MessageEvent<Request>) => {
  const { id } = ev.data;
  try {
    if (ev.data.module) {
      const t0 = performance.now();
      const factory = (await import(ev.data.module)).default as () => Promise<SmModule>;
      kernel = new SmlibKernel(await factory());
      postMessage({ id, result: { initMs: performance.now() - t0, reserved: kernel.heapReserved() } });
      return;
    }
    if (!kernel) throw new Error("no kernel loaded");
    const k = kernel;
    const result =
      ev.data.run === "parts" ? runAll(k)
      : ev.data.run === "identity" ? PARTS.map((p) => identity(k, p))
      : ev.data.run === "rebuild" ? [rebuildAll(k), rebuildAll(k), rebuildAll(k)]
      : ev.data.run === "heap" ? heapOverRebuilds(k, ev.data.n ?? 100)
      : null;
    postMessage({ id, result, reserved: k.heapReserved(), inUse: k.heapInUse() });
  } catch (e) {
    postMessage({ id, error: String((e as Error).stack ?? e) });
  }
};
