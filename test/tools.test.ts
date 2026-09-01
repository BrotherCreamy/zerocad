import { test } from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { ensureKernelLoaded } from "../src/kernel/problem.ts";
import { Model } from "../src/model.ts";
import { RectangleTool } from "../src/tools/rectangle.ts";
import { PointTool } from "../src/tools/point.ts";
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
