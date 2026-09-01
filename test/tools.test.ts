import { test } from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { ensureKernelLoaded } from "../src/kernel/problem.ts";
import { Model } from "../src/model.ts";
import { RectangleTool } from "../src/tools/rectangle.ts";
import { PointTool } from "../src/tools/point.ts";
import { pullTo } from "../src/tools/engine.ts";
import { horizontal } from "../src/relations/basic.ts";
import type { ToolContext } from "../src/tools/tool.ts";

async function loadKernel() {
  const bytes = await readFile(new URL("../src/kernel/wasm-gen/neocad_kernel_bg.wasm", import.meta.url));
  await ensureKernelLoaded(bytes);
}

function fakeCtx(model: Model): ToolContext & { solves: number; renders: number; finished: boolean } {
  const c = {
    model,
    options: {},
    solves: 0,
    renders: 0,
    finished: false,
    requestRender() { c.renders++; },
    requestSolve() { c.solves++; model.solve(); },
    finish() { c.finished = true; },
  };
  return c;
}

test("PointTool: onDown places a point and finishes the gesture", async () => {
  await loadKernel();
  const model = new Model(2);
  const ctx = fakeCtx(model);
  const tool = new PointTool(ctx);
  tool.onDown({ world: [12, 34], screen: [0, 0] });
  assert.equal(model.entities.size, 1);
  const [name] = model.entities.keys();
  assert.deepEqual(model.coords(name), [12, 34]);
  assert.equal(ctx.finished, true);
});

test("RectangleTool: drag from (0,0) to (100,50) builds an axis-aligned rectangle", async () => {
  await loadKernel();
  const model = new Model(2);
  const ctx = fakeCtx(model);
  const tool = new RectangleTool(ctx);

  tool.onDown({ world: [0, 0], screen: [0, 0] });
  tool.onMove({ world: [60, 20], screen: [60, 20] }); // live-drag preview, nothing committed yet
  assert.equal(model.entities.size, 0, "nothing should exist until onUp commits");
  assert.ok(ctx.renders > 0, "onMove should have requested a preview render");

  tool.onUp({ world: [100, 50], screen: [100, 50] });
  assert.equal(ctx.finished, true);
  assert.equal(ctx.solves, 1);

  const points = [...model.entities.values()].filter((e) => e.kind === "point");
  const lines = [...model.entities.values()].filter((e) => e.kind === "line");
  assert.equal(points.length, 4);
  assert.equal(lines.length, 4);

  const xs = points.map((p) => model.coords(p.name)[0]).sort((a, b) => a - b);
  const ys = points.map((p) => model.coords(p.name)[1]).sort((a, b) => a - b);
  assert.ok(Math.abs(xs[0] - 0) < 1e-6 && Math.abs(xs[3] - 100) < 1e-6, `xs=${xs}`);
  assert.ok(Math.abs(ys[0] - 0) < 1e-6 && Math.abs(ys[3] - 50) < 1e-6, `ys=${ys}`);
  // exactly two distinct x values and two distinct y values -> genuinely axis-aligned, not a stray quadrilateral
  assert.equal(new Set(xs.map((v) => Math.round(v * 1e6))).size, 2);
  assert.equal(new Set(ys.map((v) => Math.round(v * 1e6))).size, 2);
});

test("RectangleTool: a click with no real drag commits nothing", async () => {
  await loadKernel();
  const model = new Model(2);
  const ctx = fakeCtx(model);
  const tool = new RectangleTool(ctx);
  tool.onDown({ world: [5, 5], screen: [0, 0] });
  tool.onUp({ world: [5, 5], screen: [0, 0] });
  assert.equal(model.entities.size, 0);
  assert.equal(ctx.finished, false, "a no-op drag shouldn't count as a finished gesture");
});

// The drag's pull, without a browser. What a real drag looks like on top of
// this is in test/e2e/drag.e2e.ts — these are the mathematics of one frame.

test("pullTo drags a free point onto the cursor and a constrained one as far as it may go", async () => {
  await loadKernel();
  const model = new Model(2);
  model.addPoint([0, 0], "a");
  model.addPoint([10, 0], "b");
  horizontal(model, "a", "b");

  // b is free along x and held level with a; the cursor asks for both.
  model.problem.solve({ extra: pullTo(model, "b", [40, 25]) });
  const b = model.coords("b");
  assert.ok(Math.abs(b[0] - 40) < 1e-6, `x follows the cursor exactly: ${b[0]}`);
  assert.ok(Math.abs(b[1] - model.coords("a")[1]) < 1e-6, `hor held: b.y = ${b[1]}`);

  // And nothing was kept: solving again changes nothing, because the model
  // never contained the pull.
  const before = model.coords("b");
  model.solve();
  assert.deepEqual(model.coords("b"), before);
  assert.equal(model.journal.filter((j) => j.op !== "addPoint" && j.op !== "horizontal").length, 0,
    "a drag journals nothing — it changes values, not structure");
});

test("pullTo is dimension-generic: a 2D cursor leaves the third coordinate alone", async () => {
  await loadKernel();
  const model = new Model(3);
  model.addPoint([0, 0, 7], "a");

  model.problem.solve({ extra: pullTo(model, "a", [3, 4]) });
  const a = model.coords("a");
  assert.ok(Math.abs(a[0] - 3) < 1e-6 && Math.abs(a[1] - 4) < 1e-6, `a = ${a}`);
  assert.equal(a[2], 7, "depth is not something a 2D cursor can mean");
});
