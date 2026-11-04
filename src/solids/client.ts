// The page's side of the solid kernel's Worker: one request in flight, the
// newest program waiting behind it, and a Worker that is replaced when it
// dies, hangs, or has grown too big.
//
// **A crash or a refusal is a message, never a hung app.** The kernel aborts
// on an allocation past its memory cap (scripts/solids/build.sh) and on its
// own assertions; the Worker answers with `dead`, or an `error` event, or —
// stuck in a loop — nothing at all within `timeoutMs`. Each ends the same way:
// the Worker is terminated, the request is answered with the reason, and the
// next request starts a fresh one. Nothing here ever waits on a Worker
// without a clock running.
//
// **Memory is bounded by recycling** (the spike measured a fillet's 154 kB a
// call that SMLib never gives back, and wasm memory never shrinks): after an
// answer, a Worker whose linear memory has passed `recycleBytes` is let go,
// and the next request builds everything again in a fresh one — the price is
// one cold rebuild, measured in docs/plans/solids-kernel.md.
//
// Knows numbers and messages, no model: the layer rule's kernel edge.

import type { Program, ProgramResult } from "./evaluate.ts";
import type { Topology } from "./kernel.ts";
import type { Reply, Request } from "./serve.ts";

/** What a Worker is to this file — and what an in-process stand-in has to be. */
export interface Port {
  postMessage(m: Request, transfer?: Transferable[]): void;
  onmessage: ((e: { data: Reply }) => void) | null;
  onerror: ((e: { message?: string }) => void) | null;
  terminate(): void;
}

export interface ClientOptions {
  /** The module's bytes, when the page has them to hand over (the single-file build); null to let the Worker fetch them. */
  wasm?: () => Promise<ArrayBuffer | null>;
  /** Linear memory past which a Worker is replaced after its answer. */
  recycleBytes?: number;
  /** How long a request may take before its Worker is taken to be stuck. */
  timeoutMs?: number;
}

/** 256 MB: half the module's cap, well under what iOS Safari gives a tab (the spike's Findings). */
export const RECYCLE_BYTES = 256 * 1024 * 1024;
const TIMEOUT_MS = 30_000;

export class SolidsClient {
  private spawn: () => Port;
  private wasm: () => Promise<ArrayBuffer | null>;
  private recycleBytes: number;
  private timeoutMs: number;
  private port: Port | null = null;
  private ready: Promise<void> | null = null;
  private next = 1;
  private waiting = new Map<number, { resolve: (v: unknown) => void; reject: (e: Error) => void; timer: ReturnType<typeof setTimeout> }>();
  /** How many Workers have been started, and why each before the last was let go. */
  readonly history: { spawned: number; recycled: number; crashed: number; reasons: string[] } = { spawned: 0, recycled: 0, crashed: 0, reasons: [] };
  /** Milliseconds from starting the last Worker to its module being ready. */
  loadMs = 0;

  constructor(spawn: () => Port, opts: ClientOptions = {}) {
    this.spawn = spawn;
    this.wasm = opts.wasm ?? (async () => null);
    this.recycleBytes = opts.recycleBytes ?? RECYCLE_BYTES;
    this.timeoutMs = opts.timeoutMs ?? TIMEOUT_MS;
  }

  /** Evaluates a program. Rejects, in words, when the kernel cannot — the caller keeps what it last had. */
  async run(program: Program): Promise<ProgramResult> {
    const r = (await this.ask({ kind: "run", program })) as ProgramResult;
    if (r.heap.reserved > this.recycleBytes) this.letGo(`grew to ${(r.heap.reserved / 2 ** 20).toFixed(0)} MB`, false);
    return r;
  }

  /** A body's exact boundary as last evaluated, for STEP; null if it has none. */
  async topology(body: string): Promise<Topology | null> {
    return (await this.ask({ kind: "topology", body })) as Topology | null;
  }

  /** Lets the Worker go; the next request starts another. */
  close(): void {
    this.letGo("closed", false);
  }

  private start(): Promise<void> {
    if (this.ready) return this.ready;
    const t0 = performance.now();
    const port = this.spawn();
    this.port = port;
    this.history.spawned++;
    port.onmessage = (e) => this.answer(e.data);
    port.onerror = (e) => this.died(port, `the solid kernel's worker failed: ${e.message ?? "no reason given"}`);
    this.ready = (async () => {
      const wasm = await this.wasm();
      await this.send(port, { id: 0, kind: "init", wasm }, wasm ? [wasm] : []);
      this.loadMs = performance.now() - t0;
    })();
    // A Worker that could not even load is let go, so the next ask tries afresh.
    this.ready.catch(() => { if (this.port === port) this.letGo("it did not load", true); });
    return this.ready;
  }

  private async ask(req: { kind: "run"; program: Program } | { kind: "topology"; body: string }): Promise<unknown> {
    await this.start();
    const port = this.port;
    if (!port) throw new Error("the solid kernel's worker went away");
    return this.send(port, req as Request);
  }

  private send(port: Port, req: Request, transfer: Transferable[] = []): Promise<unknown> {
    const id = this.next++;
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => {
        this.waiting.delete(id);
        reject(new Error(`the solid kernel did not answer in ${(this.timeoutMs / 1000).toFixed(0)} s — it has been restarted`));
        if (this.port === port) this.letGo("it stopped answering", true);
      }, this.timeoutMs);
      this.waiting.set(id, { resolve, reject, timer });
      port.postMessage({ ...req, id } as Request, transfer);
    });
  }

  private answer(r: Reply): void {
    const w = this.waiting.get(r.id);
    if (!w) return;
    this.waiting.delete(r.id);
    clearTimeout(w.timer);
    if (r.ok) {
      w.resolve(r.value);
      return;
    }
    w.reject(new Error(r.error));
    if (r.dead) this.letGo(`it aborted: ${r.error}`, true);
  }

  private died(port: Port, why: string): void {
    if (this.port !== port) return;
    for (const [id, w] of this.waiting) {
      clearTimeout(w.timer);
      w.reject(new Error(why));
      this.waiting.delete(id);
    }
    this.letGo(why, true);
  }

  private letGo(why: string, crashed: boolean): void {
    const port = this.port;
    this.port = null;
    this.ready = null;
    if (!port) return;
    port.onmessage = null;
    port.onerror = null;
    port.terminate();
    if (crashed) this.history.crashed++;
    else this.history.recycled++;
    this.history.reasons.push(why);
    for (const [id, w] of this.waiting) {
      clearTimeout(w.timer);
      w.reject(new Error(`the solid kernel was restarted: ${why}`));
      this.waiting.delete(id);
    }
  }
}
