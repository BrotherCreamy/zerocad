import { test } from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { ensureKernelLoaded } from "../src/kernel/problem.ts";
import { Model } from "../src/model.ts";
import { findSnap, describeSnap, SNAP_POINT } from "../src/snapping.ts";
import { worldToScreen, type View } from "../src/view.ts";

async function loadKernel() {
  const bytes = await readFile(new URL("../src/kernel/wasm-gen/neocad_kernel_bg.wasm", import.meta.url));
  await ensureKernelLoaded(bytes as unknown as BufferSource);
}

const view: View = { ox: 400, oy: 300, scale: 3 };
const at = (w: number[]) => worldToScreen(view, w);
const near = (a: number[], b: number[], tol = 1e-6) =>
  Math.abs(a[0] - b[0]) < tol && Math.abs(a[1] - b[1]) < tol;

test("snaps to an existing point, exactly", async () => {
  const m = new Model(2);
  m.addPoint([10, 20], "a");
  const [sx, sy] = at([10, 20]);
  const snap = findSnap(m, view, sx + 3, sy - 2);
  assert.equal(snap?.kind, "point");
  assert.equal(snap?.target, "a");
  assert.ok(near(snap!.world, [10, 20]), `expected exactly (10,20), got ${snap!.world}`);
});

test("returns nothing when there is nothing near", async () => {
  const m = new Model(2);
  m.addPoint([10, 20], "a");
  const [sx, sy] = at([10, 20]);
  assert.equal(findSnap(m, view, sx + 60, sy + 60), null);
});

test("snaps to the middle of an edge", async () => {
  const m = new Model(2);
  m.addPoint([0, 0], "a");
  m.addPoint([40, 0], "b");
  m.addLine("a", "b", "l");
  const [sx, sy] = at([20, 0]);
  const snap = findSnap(m, view, sx + 2, sy + 2);
  assert.equal(snap?.kind, "midpoint");
  assert.equal(snap?.target, "l");
  assert.ok(near(snap!.world, [20, 0]), `got ${snap!.world}`);
});

test("an endpoint wins over the edge it belongs to", async () => {
  const m = new Model(2);
  m.addPoint([0, 0], "a");
  m.addPoint([40, 0], "b");
  m.addLine("a", "b", "l");
  const [sx, sy] = at([0, 0]);
  const snap = findSnap(m, view, sx + 2, sy);
  assert.equal(snap?.kind, "point", "an exact point beats a point merely on the line");
  assert.equal(snap?.target, "a");
});

test("a midpoint wins over the same edge's length", async () => {
  const m = new Model(2);
  m.addPoint([0, 0], "a");
  m.addPoint([40, 0], "b");
  m.addLine("a", "b", "l");
  const [sx, sy] = at([20, 0]);
  const snap = findSnap(m, view, sx, sy + 3);
  assert.equal(snap?.kind, "midpoint");
});

test("snaps onto a line's length away from its middle", async () => {
  const m = new Model(2);
  m.addPoint([0, 0], "a");
  m.addPoint([40, 0], "b");
  m.addLine("a", "b", "l");
  const [sx, sy] = at([32, 0]);
  const snap = findSnap(m, view, sx, sy + 3);
  assert.equal(snap?.kind, "curve");
  assert.ok(Math.abs(snap!.world[1]) < 1e-6, "pulled onto the line");
  assert.ok(Math.abs(snap!.world[0] - 32) < 1e-6, "and along it, where the cursor was");
});

test("snaps onto a circle's rim", async () => {
  await loadKernel();
  const m = new Model(2);
  m.addPoint([0, 0], "ctr");
  m.addCircle("ctr", 30, "c");
  const [sx, sy] = at([30, 0]);
  const snap = findSnap(m, view, sx + 3, sy);
  assert.equal(snap?.kind, "curve");
  assert.equal(snap?.target, "c");
  assert.ok(Math.abs(Math.hypot(...snap!.world) - 30) < 1e-6, `radius ${Math.hypot(...snap!.world)}`);
});

test("the snap radius is in screen pixels, so it survives zooming", async () => {
  const m = new Model(2);
  m.addPoint([100, 100], "a");
  for (const scale of [0.5, 3, 40]) {
    const v: View = { ox: 400, oy: 300, scale };
    const [sx, sy] = worldToScreen(v, [100, 100]);
    assert.ok(findSnap(m, v, sx + SNAP_POINT - 2, sy), `inside the radius at scale ${scale}`);
    assert.equal(findSnap(m, v, sx + SNAP_POINT + 4, sy), null, `outside it at scale ${scale}`);
  }
});

test("snapping never changes the model", async () => {
  const m = new Model(2);
  m.addPoint([10, 20], "a");
  const before = m.entities.size;
  const [sx, sy] = at([10, 20]);
  findSnap(m, view, sx, sy);
  assert.equal(m.entities.size, before, "a snap moves the cursor, it does not build anything");
  assert.deepEqual(m.coords("a"), [10, 20], "and does not move what it snapped to");
});

test("describeSnap says what was caught and how", async () => {
  assert.equal(describeSnap({ world: [], screen: [0, 0], kind: "point", target: "p1" }), "p1");
  assert.equal(describeSnap({ world: [], screen: [0, 0], kind: "midpoint", target: "l1" }), "mid l1");
  assert.equal(describeSnap({ world: [], screen: [0, 0], kind: "curve", target: "c1" }), "on c1");
});
