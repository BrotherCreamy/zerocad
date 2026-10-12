// Constraint inference: the tool applies the relation the snap implies.
//
// The tests are written through `findSnap` rather than by hand-building a
// `Snap`, so what a tool receives here is what the engine really hands it —
// the same two lines `ToolEngine.dispatch` runs. The acceptance test at the
// bottom is the one that defines the feature: a rectangle drawn from another's
// corner has to *follow* that corner when it moves.

import { test } from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { ensureKernelLoaded } from "../src/kernel/problem.ts";
import { Model } from "../src/model.ts";
import { RectangleTool } from "../src/tools/rectangle.ts";
import { CircleTool } from "../src/tools/circle.ts";
import { ArcTool } from "../src/tools/arc.ts";
import { PointTool } from "../src/tools/point.ts";
import { placePoint } from "../src/tools/place.ts";
import { fix } from "../src/relations/basic.ts";
import { radius } from "../src/relations/geometry.ts";
import { findSnap } from "../src/snapping.ts";
import { screenToWorld, worldToScreen, type View } from "../src/view.ts";
import type { PointerInfo, ToolContext } from "../src/tools/tool.ts";
import { axisFrame } from "./frames.ts";

async function loadKernel() {
  const bytes = await readFile(new URL("../src/kernel/wasm-gen/neocad_kernel_bg.wasm", import.meta.url));
  await ensureKernelLoaded(bytes);
}

function fakeCtx(model: Model) {
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
  return c as ToolContext & typeof c;
}

const view: View = { ox: 400, oy: 300, scale: 3 };
const screenAt = (world: number[]): [number, number] => worldToScreen(view, world);

/**
 * Exactly what `ToolEngine.dispatch` builds for a cursor at (sx, sy): the
 * snapped world coordinate, plus the snap that produced it. Driving the tools
 * through this is what makes these unit tests the twin of the e2e ones rather
 * than a separate story about hand-written Snap objects.
 */
function pointerAt(model: Model, sx: number, sy: number): PointerInfo {
  const snap = findSnap(model, view, sx, sy);
  const world = snap ? snap.world : screenToWorld(view, sx, sy);
  return { world, screen: [sx, sy], ...(snap ? { snap } : {}) };
}

/** The same, aimed a few pixels off a world position — a realistic near-miss. */
function nearMiss(model: Model, world: number[], dx = 4, dy = -3): PointerInfo {
  const [sx, sy] = screenAt(world);
  return pointerAt(model, sx + dx, sy + dy);
}

const opsOf = (m: Model) => m.journal.map((e) => e.op);

// --- the snap-kind to relation mapping -------------------------------------

test("placePoint: a point snap becomes a coincident constraint", async () => {
  await loadKernel();
  const model = new Model(2);
  model.addPoint([10, 10], "a");
  const ctx = fakeCtx(model);

  const info = nearMiss(model, [10, 10]);
  assert.equal(info.snap?.kind, "point", "the near-miss should have snapped to the point");
  const placed = placePoint(ctx, info, "b");

  assert.deepEqual(model.journal.at(-1), { op: "coincident", args: ["b", "a"] });

  // And it is a live constraint, not a coordinate that happens to match:
  // move the target and the placed point comes with it.
  axisFrame(model); // added after the clicks, so it snaps to nothing — see test/frames.ts
  fix(model, "a", [40, 25]);
  assert.equal(model.solve().solved, true);
  const at = model.coords(placed);
  assert.ok(Math.hypot(at[0] - 40, at[1] - 25) < 1e-6, `expected b to follow a to (40,25), got ${at}`);
});

test("placePoint: a midpoint snap becomes the *line* form of midpoint", async () => {
  await loadKernel();
  const model = new Model(2);
  model.addPoint([0, 0], "a");
  model.addPoint([40, 0], "b");
  model.addPoint([40, 40], "c");
  model.addLine("a", "b", "l");
  const ctx = fakeCtx(model);

  const info = nearMiss(model, [20, 0], 2, -2);
  assert.equal(info.snap?.kind, "midpoint");
  const placed = placePoint(ctx, info, "m");
  assert.deepEqual(model.journal.at(-1), { op: "midpoint", args: ["m", "l"] },
    "two arguments after the model — the line form, not mid(m, a, b)");

  axisFrame(model); // added after the clicks, so it snaps to nothing — see test/frames.ts
  fix(model, "a", [0, 0]);
  fix(model, "b", [40, 0]);
  assert.equal(model.solve().solved, true);
  assert.deepEqual(model.coords(placed).map((v) => Math.round(v * 1e6) / 1e6), [20, 0]);

  // The point of the line form: re-point the edge and the midpoint follows it,
  // instead of going on being the midpoint of the two points it was born on.
  model.retargetLine("l", "b", "c");
  fix(model, "c", [40, 40]);
  assert.equal(model.solve().solved, true);
  const after = model.coords(placed).map((v) => Math.round(v * 1e6) / 1e6);
  assert.deepEqual(after, [20, 20], `the midpoint should have followed the re-pointed edge, got ${after}`);
});

test("placePoint: a curve snap on a line becomes pointOnLine; on a rim, onCircle", async () => {
  await loadKernel();
  const model = new Model(2);
  model.addPoint([0, 0], "a");
  model.addPoint([40, 0], "b");
  model.addLine("a", "b", "l");
  model.addPoint([0, 60], "ctr");
  model.addCircle("ctr", 10, null, "c");
  const ctx = fakeCtx(model);

  const onEdge = nearMiss(model, [10, 0], 0, 1);
  assert.deepEqual([onEdge.snap?.kind, onEdge.snap?.targets?.[0]], ["curve", "l"]);
  placePoint(ctx, onEdge, "q");
  assert.deepEqual(model.journal.at(-1), { op: "pointOnLine", args: ["q", "l"] });

  const onRim = nearMiss(model, [10, 60], 1, 1);
  assert.deepEqual([onRim.snap?.kind, onRim.snap?.targets?.[0]], ["curve", "c"]);
  placePoint(ctx, onRim, "r");
  assert.deepEqual(model.journal.at(-1), { op: "onCircle", args: ["r", "c"] });

  axisFrame(model); // added after the clicks, so it snaps to nothing — see test/frames.ts
  fix(model, "a", [0, 0]);
  fix(model, "b", [40, 0]);
  fix(model, "ctr", [0, 60]);
  assert.equal(model.solve().solved, true);
  assert.ok(Math.abs(model.coords("q")[1]) < 1e-6, "q stayed on the edge");
  const r = model.coords("r");
  assert.ok(Math.abs(Math.hypot(r[0], r[1] - 60) - model.radius("c")) < 1e-6, "r stayed on the rim");
});

test("placePoint: an intersection snap applies the on-curve relation for both curves", async () => {
  await loadKernel();
  const model = new Model(2);
  model.addPoint([-40, 0], "a"); model.addPoint([40, 0], "b"); model.addLine("a", "b", "l");
  model.addPoint([0, 0], "ctr"); model.addCircle("ctr", 30, null, "c");
  const ctx = fakeCtx(model);

  const at = nearMiss(model, [30, 0], 2, -2);
  assert.equal(at.snap?.kind, "intersection");
  placePoint(ctx, at, "x");
  assert.deepEqual(model.journal.slice(-2), [
    { op: "pointOnLine", args: ["x", "l"] },
    { op: "onCircle", args: ["x", "c"] },
  ], "two relations — one per curve — is what makes the point stay the crossing");

  // And the crossing rides: move the line up and x has to come with it. The
  // radius is pinned as well, or the solver is free to grow the circle to meet
  // the line instead — a legal answer to an under-constrained sketch, and not
  // the question being asked here.
  axisFrame(model); // added after the clicks, so it snaps to nothing — see test/frames.ts
  fix(model, "ctr", [0, 0]);
  radius(model, "c", 30);
  fix(model, "a", [-40, 10]);
  fix(model, "b", [40, 10]);
  assert.equal(model.solve().solved, true);
  const x = model.coords("x");
  assert.ok(Math.abs(x[1] - 10) < 1e-6, `x should be on the line at y=10, got ${x}`);
  assert.ok(Math.abs(Math.hypot(x[0], x[1]) - 30) < 1e-6, `and still on the rim, got ${x}`);
  assert.ok(x[0] > 0, "and on the side it was placed, not the far one");
});

test("placePoint: no snap, no constraint — a click in empty space is just a point", async () => {
  await loadKernel();
  const model = new Model(2);
  model.addPoint([10, 10], "a");
  const ctx = fakeCtx(model);

  const info = pointerAt(model, ...screenAt([200, 200]));
  assert.equal(info.snap, undefined);
  placePoint(ctx, info);
  assert.deepEqual(opsOf(model), ["addPoint", "addPoint"], "nothing inferred out of nowhere");
});

// --- the tools that place points -------------------------------------------

test("the point tool infers from what it clicked", async () => {
  await loadKernel();
  const model = new Model(2);
  model.addPoint([10, 10], "a");
  const tool = new PointTool(fakeCtx(model));
  tool.onDown(nearMiss(model, [10, 10]));
  assert.ok(opsOf(model).includes("coincident"));
});

test("the circle tool infers from its centre click, and the arc tool from all three", async () => {
  await loadKernel();
  const model = new Model(2);
  model.addPoint([0, 0], "a");
  model.addPoint([40, 0], "b");
  model.addLine("a", "b", "l");

  const circle = new CircleTool(fakeCtx(model));
  circle.onDown(nearMiss(model, [0, 0]));
  circle.onUp(pointerAt(model, ...screenAt([0, -30])));
  assert.ok(opsOf(model).includes("coincident"), "the centre landed on a — that is a constraint");

  const arcModel = new Model(2);
  arcModel.addPoint([0, 0], "a");
  const arc = new ArcTool(fakeCtx(arcModel));
  arc.onDown(nearMiss(arcModel, [0, 0]));            // centre, on the existing point
  arc.onDown(pointerAt(arcModel, ...screenAt([20, 0])));  // start, in space
  arc.onDown(pointerAt(arcModel, ...screenAt([0, 20])));  // end, in space
  assert.deepEqual(opsOf(arcModel).filter((o) => o === "coincident"), ["coincident"]);
  assert.equal(arcModel.solve().solved, true);
});

test("the arc tool prefers a snapped end click over projecting it onto the rim", async () => {
  await loadKernel();
  const model = new Model(2);
  model.addPoint([0, 40], "target"); // well off a rim of radius 20 about the origin
  const ctx = fakeCtx(model);
  const arc = new ArcTool(ctx);
  arc.onDown(pointerAt(model, ...screenAt([0, 0])));
  arc.onDown(pointerAt(model, ...screenAt([20, 0])));
  arc.onDown(nearMiss(model, [0, 40]));

  const a = model.arc("a1");
  assert.ok(opsOf(model).includes("coincident"), "the end click's snap was honoured");
  // The journal records what the tool asked for, before any solve moved it.
  const created = model.journal.find((e) => e.op === "addPoint" && e.args[1] === a.end)!;
  assert.deepEqual(created.args[0], [0, 40], "placed where it snapped, not projected back onto the rim");

  // And it stays there: `arcends` stretches the arc out to reach the point
  // rather than the click being quietly moved back onto the drawn rim.
  axisFrame(model); // added after the clicks, so it snaps to nothing — see test/frames.ts
  fix(model, "target", [0, 40]);
  assert.equal(model.solve().solved, true);
  const [ex, ey] = model.coords(a.end);
  assert.ok(Math.hypot(ex - 0, ey - 40) < 1e-6, `the end stayed on what it snapped to, got ${[ex, ey]}`);
  assert.ok(model.radius("a1") > 25, `the arc grew to reach it, r = ${model.radius("a1")}`);
});

// --- the acceptance test ---------------------------------------------------

/** Draws a rectangle with the tool, from one world corner to another. */
function drawRectangle(model: Model, ctx: ToolContext, from: PointerInfo, to: PointerInfo) {
  const tool = new RectangleTool(ctx);
  tool.onDown(from);
  tool.onUp(to);
}

test("a rectangle drawn from another's corner follows that corner when it moves", async () => {
  await loadKernel();
  const model = new Model(2);
  const ctx = fakeCtx(model);

  // Rectangle A: p1..p4, corners (0,0) and (100,50).
  drawRectangle(model, ctx, pointerAt(model, ...screenAt([0, 0])), pointerAt(model, ...screenAt([100, 50])));

  // Rectangle B: started a few pixels off A's far corner, the way a hand does.
  const start = nearMiss(model, [100, 50]);
  assert.equal(start.snap?.kind, "point", "the near-miss caught A's corner");
  drawRectangle(model, ctx, start, pointerAt(model, ...screenAt([160, 90])));

  assert.equal(model.solve().solved, true, "two rectangles sharing a corner is not a conflict");
  assert.deepEqual(model.coords("p5"), model.coords("p3"), "B's first corner is on A's");

  // Now move A's corner, and B's must come along.
  axisFrame(model); // added after the clicks, so it snaps to nothing — see test/frames.ts
  fix(model, "p3", [130, 70]);
  const report = model.solve();
  assert.equal(report.solved, true, JSON.stringify(report.offenders));
  const followed = model.coords("p5");
  assert.ok(Math.hypot(followed[0] - 130, followed[1] - 70) < 1e-6,
    `B's corner should have followed A's to (130,70), got ${followed}`);
});

test("...and does not, when snapping (and so inference) is off", async () => {
  await loadKernel();
  const model = new Model(2);
  const ctx = fakeCtx(model);

  // The same two rectangles, but with the snap stripped from every click —
  // which is exactly what the engine hands a tool when `snapping(false)`.
  const raw = (world: number[]): PointerInfo => ({ world, screen: screenAt(world) });
  drawRectangle(model, ctx, raw([0, 0]), raw([100, 50]));
  drawRectangle(model, ctx, raw([100, 50]), raw([160, 90]));
  assert.equal(opsOf(model).includes("coincident"), false, "nothing was inferred");

  axisFrame(model); // added after the clicks, so it snaps to nothing — see test/frames.ts
  fix(model, "p3", [130, 70]);
  assert.equal(model.solve().solved, true);
  const stranded = model.coords("p5");
  assert.ok(Math.hypot(stranded[0] - 130, stranded[1] - 70) > 1,
    "two points at the same coordinates are still two points — this is the behaviour inference fixes");
});
