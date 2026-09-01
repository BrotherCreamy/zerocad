import { test } from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { ensureKernelLoaded } from "../src/kernel/problem.ts";
import { Model } from "../src/model.ts";
import { dist, fix, coincident, midpoint } from "../src/relations/basic.ts";

async function loadKernel() {
  const bytes = await readFile(new URL("../src/kernel/wasm-gen/neocad_kernel_bg.wasm", import.meta.url));
  await ensureKernelLoaded(bytes);
}

test("2D: fix + dist solves a triangle-free two-point system", async () => {
  await loadKernel();
  const m = new Model(2);
  m.addPoint([0, 0], "a");
  m.addPoint([3, 4], "b");
  fix(m, "a", [0, 0]);
  dist(m, "a", "b", 10);
  const report = m.solve();
  assert.equal(report.solved, true, JSON.stringify(report.offenders));
  const [bx, by] = m.coords("b");
  assert.ok(Math.abs(Math.hypot(bx, by) - 10) < 1e-6);
});

test("3D: the exact same relation code works with 3 coordinates", async () => {
  await loadKernel();
  const m = new Model(3);
  m.addPoint([0, 0, 0], "a");
  m.addPoint([1, 1, 1], "b");
  fix(m, "a", [0, 0, 0]);
  dist(m, "a", "b", 5);
  const report = m.solve();
  assert.equal(report.solved, true, JSON.stringify(report.offenders));
  const [bx, by, bz] = m.coords("b");
  assert.ok(Math.abs(Math.hypot(bx, by, bz) - 5) < 1e-6);
});

test("coincident merges two points regardless of starting position", async () => {
  await loadKernel();
  const m = new Model(2);
  m.addPoint([0, 0], "a");
  m.addPoint([9, 9], "b");
  fix(m, "a", [2, 3]);
  coincident(m, "a", "b");
  const report = m.solve();
  assert.equal(report.solved, true, JSON.stringify(report.offenders));
  assert.deepEqual(m.coords("b").map((v) => Math.round(v * 1e6) / 1e6), [2, 3]);
});

test("midpoint tracks two independently-fixed endpoints", async () => {
  await loadKernel();
  const m = new Model(2);
  m.addPoint([0, 0], "a");
  m.addPoint([10, 0], "b");
  m.addPoint([0, 0], "mid");
  fix(m, "a", [0, 0]);
  fix(m, "b", [10, 20]);
  midpoint(m, "mid", "a", "b");
  const report = m.solve();
  assert.equal(report.solved, true, JSON.stringify(report.offenders));
  const [mx, my] = m.coords("mid");
  assert.ok(Math.abs(mx - 5) < 1e-6 && Math.abs(my - 10) < 1e-6, `mid = ${mx},${my}`);
});
