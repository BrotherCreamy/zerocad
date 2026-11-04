// Which operation keeps heap? Each one alone, 50 rounds after 5 to warm up,
// then each part rebuilt 20 times. Prints bytes kept per round.
//
//   node --experimental-strip-types spikes/solid-kernel/bench/leak.ts <dir holding smlib.mjs>

import { pathToFileURL } from "node:url";
import { PARTS } from "../src/parts.ts";
import { circle, profile, rect } from "../src/profiles.ts";
import { SmlibKernel, type SmModule } from "../src/smlib.ts";

const dir = process.argv[2] ?? process.env.SMLIB_DIR;
const factory = (await import(pathToFileURL(`${dir}/smlib.mjs`).href)).default as () => Promise<SmModule>;
const k = new SmlibKernel(await factory());

const box = profile(rect(0, 0, 10, 10));
const cyl = profile(circle(10, 10, 4));
const lid = (s: number) => k.edges(s).flatMap((e, i) => (e.mid[2] > 4.9 ? [i] : []));
const cases: Record<string, () => void> = {
  extrude: () => k.free(k.extrude(box, 5)),
  revolve: () => k.free(k.revolve(profile(rect(2, 0, 5, 7)), [0, 0], [0, 1], 360)),
  faces: () => { const s = k.extrude(box, 5); k.faces(s); k.free(s); },
  edges: () => { const s = k.extrude(box, 5); k.edges(s); k.free(s); },
  tag: () => { const s = k.extrude(box, 5); k.tagFace(s, 0, 1); k.free(s); },
  volume: () => { const s = k.extrude(box, 5); k.volume(s); k.free(s); },
  bbox: () => { const s = k.extrude(box, 5); k.bbox(s); k.free(s); },
  validity: () => { const s = k.extrude(box, 5); k.validity(s); k.free(s); },
  copy: () => { const s = k.extrude(box, 5); k.free(k.copy(s)); k.free(s); },
  union: () => k.free(k.boolean("union", k.extrude(box, 5), k.extrude(cyl, 8))),
  "fillet 1 edge": () => { const s = k.extrude(box, 5); k.free(k.fillet(s, [0], 1)); },
  "fillet box lid": () => { const s = k.extrude(box, 5); k.free(k.fillet(s, lid(s), 1)); },
  "fillet cylinder lid": () => { const s = k.extrude(cyl, 5); k.free(k.fillet(s, lid(s), 1)); },
  shell: () => { const s = k.extrude(box, 5); k.free(k.shell(s, [0], 1)); },
  tessellate: () => { const s = k.extrude(cyl, 5); k.tessellate(s, 0, 15); k.free(s); },
};
for (const [name, f] of Object.entries(cases)) {
  for (let i = 0; i < 5; i++) f();
  const a = k.heapInUse();
  for (let i = 0; i < 50; i++) f();
  console.log(`${name.padEnd(22)} ${((k.heapInUse() - a) / 50).toFixed(0)} B/round`);
}
for (const p of PARTS) {
  for (let i = 0; i < 3; i++) k.free(p.build(k, p.dims));
  const a = k.heapInUse();
  for (let i = 0; i < 20; i++) k.free(p.build(k, i % 2 ? p.changed : p.dims));
  console.log(`${p.name.padEnd(22)} ${((k.heapInUse() - a) / 20).toFixed(0)} B/build`);
}
