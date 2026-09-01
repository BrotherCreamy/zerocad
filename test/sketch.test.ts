import { test } from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { ensureKernelLoaded } from "../src/kernel/problem.ts";
import { Model } from "../src/model.ts";
import { CircleTool } from "../src/tools/circle.ts";
import { ArcTool } from "../src/tools/arc.ts";
import { fillet } from "../src/operations.ts";
import { fix, horizontal, vertical } from "../src/relations/basic.ts";
import type { ToolContext } from "../src/tools/tool.ts";

async function loadKernel() {
  const bytes = await readFile(new URL("../src/kernel/wasm-gen/neocad_kernel_bg.wasm", import.meta.url));
  await ensureKernelLoaded(bytes as unknown as BufferSource);
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

const at = (world: number[]) => ({ world, screen: [0, 0] as [number, number] });

// --- circle tool -----------------------------------------------------------

test("CircleTool: drag from center to rim commits a circle of that radius", async () => {
  await loadKernel();
  const model = new Model(2);
  const ctx = fakeCtx(model);
  const tool = new CircleTool(ctx);

  tool.onDown(at([10, 10]));
  tool.onMove(at([13, 14]));
  assert.equal(model.entities.size, 0, "mid-drag nothing is committed");
  tool.onUp(at([13, 14]));

  assert.equal(model.entities.size, 2, "a center point and a circle");
  assert.deepEqual(model.coords("p1"), [10, 10]);
  assert.ok(Math.abs(model.radius("c1") - 5) < 1e-9, `r = ${model.radius("c1")}`);
  assert.equal(ctx.finished, true);
});

test("CircleTool: a click with no drag commits nothing", async () => {
  await loadKernel();
  const model = new Model(2);
  const ctx = fakeCtx(model);
  const tool = new CircleTool(ctx);
  tool.onDown(at([4, 4]));
  tool.onUp(at([4, 4]));
  assert.equal(model.entities.size, 0);
  assert.equal(ctx.finished, false, "nothing was drawn, so the tool stays armed");
});

test("a drawn circle keeps its radius through a solve — the variable is free, not adrift", async () => {
  await loadKernel();
  const model = new Model(2);
  const tool = new CircleTool(fakeCtx(model));
  tool.onDown(at([0, 0]));
  tool.onUp(at([7, 0]));
  fix(model, "p1", [0, 0]);
  const report = model.solve();
  assert.equal(report.solved, true, JSON.stringify(report.offenders));
  assert.ok(Math.abs(model.radius("c1") - 7) < 1e-9, `r drifted to ${model.radius("c1")}`);
});

// --- arc tool --------------------------------------------------------------

test("ArcTool: three clicks — center, radius, sweep — commit one arc", async () => {
  await loadKernel();
  const model = new Model(2);
  const ctx = fakeCtx(model);
  const tool = new ArcTool(ctx);

  tool.onDown(at([0, 0]));
  assert.equal(model.entities.size, 0, "still nothing after the center click");
  tool.onMove(at([10, 0]));
  tool.onDown(at([10, 0])); // radius 10
  assert.equal(model.entities.size, 0, "still nothing after the start click");
  assert.equal(ctx.finished, false, "the gesture spans three clicks, so it is not done yet");

  tool.onDown(at([0, 30])); // off the rim on purpose — should be snapped onto it
  assert.equal(ctx.finished, true);

  const arc = model.arc("a1");
  assert.equal(arc.center, "p1");
  assert.ok(Math.abs(model.radius("a1") - 10) < 1e-9);
  const end = model.coords(arc.end);
  assert.ok(Math.abs(Math.hypot(...end) - 10) < 1e-6, `the end click was snapped to the rim, got ${end}`);
  assert.ok(Math.abs(end[0]) < 1e-6 && Math.abs(end[1] - 10) < 1e-6, `expected (0,10), got ${end}`);
});

test("ArcTool: a second click on the center is ignored — there is no radius yet", async () => {
  await loadKernel();
  const model = new Model(2);
  const tool = new ArcTool(fakeCtx(model));
  tool.onDown(at([5, 5]));
  tool.onDown(at([5, 5]));
  tool.onDown(at([15, 5])); // this is the *start* click, not the end
  assert.equal(model.entities.size, 0, "no arc yet — the degenerate click did not advance the gesture");
});

test("ArcTool: cancelling mid-gesture leaves nothing behind", async () => {
  await loadKernel();
  const model = new Model(2);
  const tool = new ArcTool(fakeCtx(model));
  tool.onDown(at([0, 0]));
  tool.onDown(at([10, 0]));
  tool.onCancel();
  tool.onDown(at([3, 3])); // starts a fresh gesture as a center, not an end
  assert.equal(model.entities.size, 0);
});

// --- fillet ----------------------------------------------------------------

/**
 * A right-angled corner: a(0,20) — p(0,0) — b(20,0), each leg held square by
 * a *line-form* relation — "this edge is level" rather than "these two points
 * share a y". That is the form that survives a fillet re-pointing an edge.
 */
function rightCorner(model: Model) {
  model.addPoint([0, 20], "a");
  model.addPoint([0, 0], "p");
  model.addPoint([20, 0], "b");
  fix(model, "a", [0, 20]);
  fix(model, "b", [20, 0]);
  model.addLine("a", "p", "l1");
  model.addLine("p", "b", "l2");
  vertical(model, "l1");
  horizontal(model, "l2");
}

test("fillet: rounds a right angle, tangent to both legs", async () => {
  await loadKernel();
  const model = new Model(2);
  rightCorner(model);
  const arcName = fillet(model, "l1", "l2", 5);
  const report = model.solve();
  assert.equal(report.solved, true, JSON.stringify(report.offenders));

  // For a right angle of radius 5 the center sits at (5,5) and the tangent
  // points at (0,5) and (5,0) — checkable in closed form.
  const arc = model.arc(arcName);
  const ctr = model.coords(arc.center);
  assert.ok(Math.abs(ctr[0] - 5) < 1e-6 && Math.abs(ctr[1] - 5) < 1e-6, `center = ${ctr}`);
  assert.ok(Math.abs(model.radius(arcName) - 5) < 1e-6);

  const ends = [model.coords(arc.start), model.coords(arc.end)].sort((x, y) => x[0] - y[0]);
  assert.ok(Math.abs(ends[0][0]) < 1e-6 && Math.abs(ends[0][1] - 5) < 1e-6, `tangent point on leg 1 = ${ends[0]}`);
  assert.ok(Math.abs(ends[1][0] - 5) < 1e-6 && Math.abs(ends[1][1]) < 1e-6, `tangent point on leg 2 = ${ends[1]}`);
});

test("fillet: trims both legs back and leaves no orphaned point", async () => {
  await loadKernel();
  const model = new Model(2);
  rightCorner(model);
  const before = new Set(model.entities.keys());
  const arcName = fillet(model, "l1", "l2", 5);
  model.solve();

  // The legs now end at the tangent points, not at the old corner.
  const l1 = model.line("l1"), l2 = model.line("l2");
  const arc = model.arc(arcName);
  const arcEnds = [arc.start, arc.end];
  assert.ok(arcEnds.includes(l1.refs[1]), "leg 1 ends on the arc");
  assert.ok(arcEnds.includes(l2.refs[0]), "leg 2 starts on the arc");

  // Every point in the model is referenced by something — the old corner was
  // reused as a tangent point rather than stranded.
  const referenced = new Set<string>();
  for (const e of model.entities.values()) {
    if (e.kind === "line") e.refs.forEach((n) => referenced.add(n));
    if (e.kind === "circle") referenced.add(e.center);
    if (e.kind === "arc") { referenced.add(e.center); referenced.add(e.start); referenced.add(e.end); }
  }
  for (const e of model.entities.values()) {
    if (e.kind === "point") assert.ok(referenced.has(e.name), `${e.name} is orphaned`);
  }
  assert.ok(before.has("p"), "sanity: the corner existed beforehand");
  assert.ok(model.entities.has("p"), "and it still does, now as a tangent point");
});

test("fillet: works on a non-right angle too", async () => {
  await loadKernel();
  const model = new Model(2);
  // A 60-degree corner at the origin, both legs pinned by fixing their far ends
  // and constraining the corner to lie on each leg's direction via fix.
  model.addPoint([20, 0], "a");
  model.addPoint([0, 0], "p");
  model.addPoint([20 * Math.cos(Math.PI / 3), 20 * Math.sin(Math.PI / 3)], "b");
  fix(model, "a", [20, 0]);
  fix(model, "b", [20 * Math.cos(Math.PI / 3), 20 * Math.sin(Math.PI / 3)]);
  model.addLine("a", "p", "l1");
  model.addLine("p", "b", "l2");
  horizontal(model, "a", "p"); // leg 1 held on the x-axis

  const arcName = fillet(model, "l1", "l2", 4);
  const report = model.solve();
  assert.equal(report.solved, true, JSON.stringify(report.offenders));

  // Tangent to the x-axis means the center sits exactly one radius above it.
  const ctr = model.coords(model.arc(arcName).center);
  assert.ok(Math.abs(ctr[1] - 4) < 1e-6, `center should be 4 above the x-axis, got y=${ctr[1]}`);
  assert.ok(Math.abs(model.radius(arcName) - 4) < 1e-6);
});

test("a line-form relation follows the line through a fillet; a point-form one does not", async () => {
  await loadKernel();

  // Line form: "this edge is level". The fillet re-points the edge, and the
  // relation goes with it — the leg stays horizontal.
  const good = new Model(2);
  rightCorner(good);
  fillet(good, "l1", "l2", 5);
  assert.equal(good.solve().solved, true);
  const gl2 = good.line("l2");
  const [gs, ge] = [good.coords(gl2.refs[0]), good.coords(gl2.refs[1])];
  assert.ok(Math.abs(gs[1] - ge[1]) < 1e-6, `leg 2 should still be level, got ys ${gs[1]} and ${ge[1]}`);

  // Point form: "these two points share a y". It keeps constraining the two
  // points it named, and the re-pointed leg is left free to swing.
  const stale = new Model(2);
  stale.addPoint([0, 20], "a");
  stale.addPoint([0, 0], "p");
  stale.addPoint([20, 0], "b");
  fix(stale, "a", [0, 20]);
  fix(stale, "b", [20, 0]);
  stale.addLine("a", "p", "l1");
  stale.addLine("p", "b", "l2");
  vertical(stale, "l1");
  horizontal(stale, "p", "b"); // names the corner, not the edge
  fillet(stale, "l1", "l2", 5);
  stale.solve();
  const sl2 = stale.line("l2");
  assert.notEqual(sl2.refs[0], "p", "leg 2 was re-pointed away from the corner");
  const [ss, se] = [stale.coords(sl2.refs[0]), stale.coords(sl2.refs[1])];
  assert.ok(Math.abs(ss[1] - se[1]) > 1e-3,
    "the point-form relation stayed on the old corner, so leg 2 is no longer level — which is why the line form exists");
});

test("a line relation keeps holding after the line is re-pointed by hand", async () => {
  await loadKernel();
  const model = new Model(2);
  model.addPoint([0, 0], "a");
  model.addPoint([10, 5], "b");
  model.addPoint([20, 40], "c");
  fix(model, "a", [0, 0]);
  model.addLine("a", "b", "l");
  horizontal(model, "l");
  assert.equal(model.solve().solved, true);
  assert.ok(Math.abs(model.coords("b")[1]) < 1e-6, "b levelled with a");

  model.retargetLine("l", "b", "c"); // the line now runs a -> c
  assert.equal(model.solve().solved, true);
  assert.ok(Math.abs(model.coords("c")[1]) < 1e-6, `c should now be the one levelled, got y=${model.coords("c")[1]}`);
});

test("fillet: refuses corners it cannot round, with a reason", async () => {
  await loadKernel();
  const model = new Model(2);
  rightCorner(model);
  assert.throws(() => fillet(model, "l1", "l2", 500), /too large for this corner/);
  assert.throws(() => fillet(model, "l1", "l2", 0), /positive radius/);

  const m2 = new Model(2);
  m2.addPoint([0, 0], "x"); m2.addPoint([1, 1], "y");
  m2.addPoint([5, 5], "z"); m2.addPoint([6, 6], "w");
  m2.addLine("x", "y", "n1");
  m2.addLine("z", "w", "n2");
  assert.throws(() => fillet(m2, "n1", "n2", 1), /do not meet at a shared point/);

  const m3 = new Model(2);
  m3.addPoint([0, 0], "x"); m3.addPoint([10, 0], "y"); m3.addPoint([20, 0], "z");
  m3.addLine("x", "y", "s1");
  m3.addLine("y", "z", "s2");
  assert.throws(() => fillet(m3, "s1", "s2", 1), /collinear/);
});

// --- the fillet tool -------------------------------------------------------

import { FilletTool, DEFAULT_RADIUS } from "../src/tools/fillet.ts";
import { hitTest } from "../src/picking.ts";
import { worldToScreen, type View } from "../src/view.ts";

const view: View = { ox: 400, oy: 300, scale: 3 };

/** A tool context that can pick, so the fillet tool has something to click. */
function pickingCtx(model: Model) {
  const c = fakeCtx(model) as ReturnType<typeof fakeCtx> & { pick(s: [number, number]): unknown };
  c.pick = ([sx, sy]: [number, number]) => hitTest(model, view, sx, sy);
  return c;
}
const screenAt = (world: number[]): [number, number] => worldToScreen(view, world);

test("FilletTool: clicking two edges rounds the corner between them", async () => {
  await loadKernel();
  const model = new Model(2);
  rightCorner(model); // a(0,20) — p(0,0) — b(20,0), edges l1 and l2
  const ctx = pickingCtx(model);
  const tool = new FilletTool(ctx);

  tool.onDown({ world: [0, 10], screen: screenAt([0, 10]) }); // midway along l1
  assert.equal(model.entities.size, 3 + 2, "the first click commits nothing");
  assert.equal(ctx.finished, false, "and the gesture is not over");

  tool.onDown({ world: [10, 0], screen: screenAt([10, 0]) }); // midway along l2
  assert.equal(ctx.finished, true);

  const arcs = [...model.entities.values()].filter((e) => e.kind === "arc");
  assert.equal(arcs.length, 1);
  assert.equal(model.solve().solved, true);
  assert.ok(Math.abs(model.radius(arcs[0].name) - DEFAULT_RADIUS) < 1e-6,
    `an unarmed radius falls back to the default, got ${model.radius(arcs[0].name)}`);
});

test("FilletTool: takes its radius from the arm-time options", async () => {
  await loadKernel();
  const model = new Model(2);
  rightCorner(model);
  const ctx = pickingCtx(model);
  ctx.options = { radius: 4 };
  const tool = new FilletTool(ctx);
  tool.onDown({ world: [0, 10], screen: screenAt([0, 10]) });
  tool.onDown({ world: [10, 0], screen: screenAt([10, 0]) });

  const arc = [...model.entities.values()].find((e) => e.kind === "arc")!;
  assert.ok(Math.abs(model.radius(arc.name) - 4) < 1e-6);
});

test("FilletTool: clicking empty space or a point is a miss, not a cancel", async () => {
  await loadKernel();
  const model = new Model(2);
  rightCorner(model);
  const ctx = pickingCtx(model);
  const tool = new FilletTool(ctx);

  tool.onDown({ world: [500, 500], screen: screenAt([500, 500]) }); // nothing there
  tool.onDown({ world: [0, 20], screen: screenAt([0, 20]) }); // a point, not an edge
  assert.equal(model.entities.size, 5, "nothing happened");

  // The gesture is still fresh, so a proper pair still works.
  tool.onDown({ world: [0, 10], screen: screenAt([0, 10]) });
  tool.onDown({ world: [10, 0], screen: screenAt([10, 0]) });
  assert.equal(ctx.finished, true);
  assert.equal([...model.entities.values()].filter((e) => e.kind === "arc").length, 1);
});

test("FilletTool: the same edge twice is ignored", async () => {
  await loadKernel();
  const model = new Model(2);
  rightCorner(model);
  const ctx = pickingCtx(model);
  const tool = new FilletTool(ctx);
  tool.onDown({ world: [0, 10], screen: screenAt([0, 10]) });
  tool.onDown({ world: [0, 15], screen: screenAt([0, 15]) }); // same edge, further along
  assert.equal(ctx.finished, false, "one edge is not a corner");
  assert.equal([...model.entities.values()].filter((e) => e.kind === "arc").length, 0);
});

test("FilletTool: a refused corner keeps the first edge so the pick can be retried", async () => {
  await loadKernel();
  const model = new Model(2);
  rightCorner(model);
  const ctx = pickingCtx(model);
  ctx.options = { radius: 500 }; // far too large for these legs
  const tool = new FilletTool(ctx);
  tool.onDown({ world: [0, 10], screen: screenAt([0, 10]) });
  assert.throws(() => tool.onDown({ world: [10, 0], screen: screenAt([10, 0]) }), /too large/);
  assert.equal(ctx.finished, false);

  // Still holding the first edge: a smaller radius and the same second pick works.
  ctx.options = { radius: 5 };
  tool.onDown({ world: [10, 0], screen: screenAt([10, 0]) });
  assert.equal(ctx.finished, true);
  assert.equal([...model.entities.values()].filter((e) => e.kind === "arc").length, 1);
});
