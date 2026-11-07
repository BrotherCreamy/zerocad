// Conflict detection (docs/plans/conflict-detection.md): a conflict is a
// conflict even when the solver can satisfy it by collapsing something.

import { test } from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { ensureKernelLoaded } from "../src/kernel/problem.ts";
import { Model } from "../src/model.ts";
import { parallel, perpendicular } from "../src/relations/geometry.ts";

await (async () => {
  const bytes = await readFile(new URL("../src/kernel/wasm-gen/neocad_kernel_bg.wasm", import.meta.url));
  await ensureKernelLoaded(bytes);
})();

const lengthOf = (m: Model, l: string) => {
  const [a, b] = m.line(l).refs.map((p) => m.coords(p));
  return Math.hypot(...a.map((v, i) => v - b[i]));
};

for (const dim of [2, 3]) {
  test(`${dim}D: a par across a rectangle's perps is a CONFLICT, not a collapse`, () => {
    const m = new Model(dim);
    const at = (x: number, y: number) => (dim === 2 ? [x, y] : [x, y, 0]);
    [[0, 0], [6, 0], [6, 4], [0, 4]].forEach(([x, y], i) => m.addPoint(at(x, y), `p${i + 1}`));
    for (let i = 1; i <= 4; i++) m.addLine(`p${i}`, `p${(i % 4) + 1}`, `l${i}`);
    perpendicular(m, "l1", "l2");
    perpendicular(m, "l2", "l3");
    perpendicular(m, "l3", "l4");
    assert.equal(m.solve().solved, true);
    const r = parallel(m, "l1", "l2");
    const report = m.solve();
    const lengths = ["l1", "l2", "l3", "l4"].map((l) => lengthOf(m, l));
    assert.equal(report.solved, false, `solved by collapsing: lengths ${lengths.map((v) => v.toFixed(4))}`);
    assert.ok(lengths.every((v) => v > 3), `nothing folded: ${lengths}`);
    assert.ok(m.relations.has(r), "the par is kept");
  });
}
