// A direction relation turns lines and never scales them
// (docs/plans/review-solver.md, item 1 of the review against the owner's
// principle). Measured before the rows were normalised: `par` typed between
// two free lines 60.1 and 60.8 long left them 8.8 and 1.2 long, SOLVED
// (docs/images/422) — the row was |u||v|·sin, and shortening either line
// lowered it, so the solve paid for the parallel mostly in length.

import { test } from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { ensureKernelLoaded } from "../src/kernel/problem.ts";
import { Model } from "../src/model.ts";
import { parallel } from "../src/relations/geometry.ts";
import "../src/modules/builtin.ts";

await ensureKernelLoaded(await readFile(new URL("../src/kernel/wasm-gen/neocad_kernel_bg.wasm", import.meta.url)));

const sub = (a: number[], b: number[]) => a.map((x, i) => x - b[i]);
const len = (a: number[]) => Math.hypot(...a);
const lengthOf = (m: Model, l: string) => len(sub(m.coords(m.line(l).refs[1]), m.coords(m.line(l).refs[0])));

/** The drawing of docs/images/422: two free lines, as `ln(pt(-30, 0), pt(30, 4)); ln(pt(-30, 25), pt(30, 15))` leaves them. */
function twoLines(dim: number): Model {
  const m = new Model(dim);
  const z = dim === 3 ? [0] : [];
  m.addPoint([-30, 0, ...z], "p1"); m.addPoint([30, 4, ...z], "p2");
  m.addPoint([-30, 25, ...z], "p3"); m.addPoint([30, 15, ...z], "p4");
  m.addLine("p1", "p2", "l1"); m.addLine("p3", "p4", "l2");
  return m;
}

for (const dim of [2, 3]) {
  test(`${dim}D: par between two free lines turns them — each keeps its length to 1e-6 of it`, () => {
    const m = twoLines(dim);
    const was = [lengthOf(m, "l1"), lengthOf(m, "l2")];
    parallel(m, "l1", "l2");
    assert.equal(m.solve().solved, true);
    const now = [lengthOf(m, "l1"), lengthOf(m, "l2")];
    now.forEach((v, i) => assert.ok(Math.abs(v - was[i]) / was[i] < 1e-6, `l${i + 1} was ${was[i].toFixed(3)} long and is ${v.toFixed(3)}`));
  });
}
