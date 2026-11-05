// The SMLib build for tests that need a real kernel: src/solids/smlib-gen/
// (npm run build:solids), or the directory SMLIB_DIR names. Without one, those
// tests skip and say why — the build is minutes of C++ and is not committed.

import { existsSync } from "node:fs";
import { fileURLToPath, pathToFileURL } from "node:url";
import { SmlibKernel, type SmModule } from "../../src/solids/smlib.ts";
import { serve, type Reply, type Request, type Scope } from "../../src/solids/serve.ts";
import type { Port } from "../../src/solids/client.ts";

export const SMLIB_DIR = process.env.SMLIB_DIR ?? fileURLToPath(new URL("../../src/solids/smlib-gen", import.meta.url));

/** The reason every kernel test skips, or false when there is a build to run them on. */
export const noKernel: string | false = existsSync(`${SMLIB_DIR}/smlib.mjs`)
  ? false
  : "no SMLib build — run `npm run build:solids` (or point SMLIB_DIR at one)";

/** The module factory: each call is a fresh module with memory of its own, which is what a recycled Worker is. */
export async function smlibFactory(): Promise<() => Promise<SmModule>> {
  return (await import(pathToFileURL(`${SMLIB_DIR}/smlib.mjs`).href)).default as () => Promise<SmModule>;
}

let shared: SmlibKernel | null = null;

/** One kernel for a whole test file. */
export async function kernel(): Promise<SmlibKernel> {
  if (!shared) shared = new SmlibKernel(await (await smlibFactory())());
  return shared;
}

/**
 * A Worker without a thread: the client's port and the kernel's scope, joined
 * in-process, each message delivered on a later turn as a Worker's would be.
 * Each call is a fresh module, so terminating it and spawning another is a
 * real recycle — new linear memory, an empty cache.
 */
export function inProcessPort(factory: () => Promise<SmModule>): Port & { dead: boolean } {
  const scope: Scope = { onmessage: null, postMessage: (m: Reply) => { if (!port.dead) setTimeout(() => port.onmessage?.({ data: m }), 0); } };
  const port: Port & { dead: boolean } = {
    dead: false,
    onmessage: null,
    onerror: null,
    postMessage: (m: Request) => { if (!port.dead) setTimeout(() => scope.onmessage?.({ data: m }), 0); },
    terminate: () => { port.dead = true; },
  };
  serve(scope, () => factory());
  return port;
}
