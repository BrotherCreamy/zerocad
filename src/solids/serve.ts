// The solid kernel's side of the Worker's messages: one evaluator over one
// SMLib module, answering the client (client.ts) one request at a time.
//
// Separate from worker.ts so the same loop serves a real Worker (worker.ts in
// development, scripts/solids/worker-entry.ts in a build) and an in-process
// port in the tests, where a fresh module per spawn is what a recycled Worker
// is. Knows numbers only — the layer rule's kernel edge.

import { Evaluator, type Program, type ProgramResult } from "./evaluate.ts";
import { SmlibKernel, type SmModule } from "./smlib.ts";
import type { Topology } from "./kernel.ts";

export type Request =
  | { id: number; kind: "init"; wasm?: ArrayBuffer | null }
  | { id: number; kind: "run"; program: Program }
  | { id: number; kind: "topology"; body: string };

export type Reply =
  | { id: number; ok: true; value: unknown; ms: number }
  /** `dead`: the module aborted — its memory is not to be trusted again, and the Worker is to be replaced. */
  | { id: number; ok: false; error: string; dead: boolean };

/** The two ends a Worker scope and an in-process port share. */
export interface Scope {
  onmessage: ((e: { data: Request }) => void) | null;
  postMessage(m: Reply, transfer?: Transferable[]): void;
}

/** Loads the module: from `wasm`'s bytes when the page handed them over, else from beside the loader. */
export type Loader = (wasm: ArrayBuffer | null) => Promise<SmModule>;

/** The typed arrays a result carries, handed over rather than copied. */
function transfers(r: ProgramResult): Transferable[] {
  const out: Transferable[] = [];
  for (const b of r.bodies) {
    if (!b.solid) continue;
    out.push(b.solid.mesh.positions.buffer, b.solid.mesh.triangles.buffer, b.solid.mesh.faceOf.buffer);
    for (const l of b.solid.lines) out.push(l.points.buffer);
  }
  // A buffer listed twice is refused: the edge lines are views on one buffer,
  // and arrive as views on one buffer still (structured clone keeps that).
  return [...new Set(out)];
}

export function serve(scope: Scope, load: Loader): void {
  let ev: Evaluator | null = null;
  scope.onmessage = async (e) => {
    const req = e.data;
    const t0 = performance.now();
    try {
      if (req.kind === "init") {
        ev = new Evaluator(new SmlibKernel(await load(req.wasm ?? null)));
        scope.postMessage({ id: req.id, ok: true, value: null, ms: performance.now() - t0 });
        return;
      }
      if (!ev) throw new Error("the solid kernel is not loaded");
      if (req.kind === "run") {
        const value = ev.run(req.program);
        scope.postMessage({ id: req.id, ok: true, value, ms: performance.now() - t0 }, transfers(value));
        return;
      }
      const value: Topology | null = ev.topology(req.body);
      scope.postMessage({ id: req.id, ok: true, value, ms: performance.now() - t0 });
    } catch (err) {
      // Emscripten's abort() throws a RuntimeError ("Aborted(...)"): SMLib's
      // bad_alloc past the memory cap, or an assertion. Nothing the module
      // holds is to be trusted after it.
      const text = err instanceof Error ? err.message : String(err);
      const dead = err instanceof WebAssembly.RuntimeError || /Aborted|abort\(/.test(text);
      scope.postMessage({ id: req.id, ok: false, error: text, dead });
    }
  };
}
