// Run every measurement in Node against a built SMLib module and print JSON.
//
//   node --experimental-strip-types spikes/solid-kernel/bench/node.ts <dir holding smlib.mjs>

import { pathToFileURL } from "node:url";
import { heapOverRebuilds, identity, rebuildAll, runAll } from "../../../test/solids/bench.ts";
import { PARTS } from "../../../test/solids/parts.ts";
import { SmlibKernel, type SmModule } from "../../../src/solids/smlib.ts";

const dir = process.argv[2] ?? process.env.SMLIB_DIR;
if (!dir) throw new Error("usage: node.ts <dir holding smlib.mjs>");

const t0 = performance.now();
const factory = (await import(pathToFileURL(`${dir}/smlib.mjs`).href)).default as () => Promise<SmModule>;
const m = await factory();
const k = new SmlibKernel(m);
const initMs = performance.now() - t0;

const parts = runAll(k);
const ids = PARTS.map((p) => identity(k, p));
const rebuild = [rebuildAll(k), rebuildAll(k), rebuildAll(k)];
const heap = heapOverRebuilds(k, Number(process.env.REBUILDS ?? 100));

console.log(JSON.stringify({ env: `node ${process.version}`, initMs, parts, identity: ids, rebuild, heap }, null, 1));
