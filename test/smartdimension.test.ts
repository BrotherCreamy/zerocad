// Smart dimension (docs/plans/smart-dimension.md): one dimension tool that
// dimensions virtually anything — the owner: *"Distance between two faces of
// a solid, or angle"*. Headless: the table, the face references, driving and
// driven, and what survives a save.

import { test } from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { ensureKernelLoaded } from "../src/kernel/problem.ts";
import { Model } from "../src/model.ts";
import { extrude, set } from "../src/operations.ts";
import { open, save } from "../src/persist.ts";
import { dimensionFor } from "../src/dimensioning.ts";
import { tiltedFrame } from "./frames.ts";
import { polygon } from "./profiles.ts";

await (async () => {
  const bytes = await readFile(new URL("../src/kernel/wasm-gen/neocad_kernel_bg.wasm", import.meta.url));
  await ensureKernelLoaded(bytes);
})();

const close = (a: number, b: number, tol = 1e-6, what = "") => assert.ok(Math.abs(a - b) < tol, `${what} ${a} vs ${b}`);

/** A 40 × 30 block, 20 deep, on a frame tipped off every kernel axis. */
function block() {
  const m = new Model(3);
  const t = tiltedFrame(m);
  const { points, lines } = polygon(m, t, [[0, 0], [40, 0], [40, 30], [0, 30]]);
  const e = extrude(m, lines[0], 20);
  m.solve();
  return { m, t, points, lines, e };
}

test("two opposite walls of a block are two lines: the distance between them is dist on its sketch", () => {
  const { m, lines, e } = block();
  const plan = dimensionFor(m, [`${e}.m0`, `${e}.m2`]);
  assert.equal(plan?.text, `dist("${lines[0]}", "${lines[2]}", 30)`);
});

test("a face of one block to a face of another is fdist, and setting it moves the second solid — and survives a save", () => {
  const { m, t } = block();
  const { lines } = polygon(m, t, [[60, 0], [80, 0], [80, 10], [60, 10]]);
  const e2 = extrude(m, lines[0], 35);
  m.solve();
  const plan = dimensionFor(m, ["e1.lid", `${e2}.lid`]);
  assert.equal(plan?.text, `fdist("e1.lid", "${e2}.lid", 15)`);
  const d = plan!.apply(m);
  m.solve();
  set(m, `${d}.value`, 25);
  assert.equal(m.solve().solved, true);
  const back = open(save(m), 3);
  back.solve();
  assert.equal(back.relations.get(d)?.op, "faceDistance");
  close(back.relations.get(d)!.args[2] as number, 25);
});
