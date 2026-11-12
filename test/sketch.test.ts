import { test } from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { ensureKernelLoaded } from "../src/kernel/problem.ts";
import { Model } from "../src/model.ts";
import { CircleTool } from "../src/tools/circle.ts";
import { ArcTool } from "../src/tools/arc.ts";
import { fillet, standsFor } from "../src/operations.ts";
import { fix } from "../src/relations/basic.ts";
import { parallel } from "../src/relations/geometry.ts";
import type { ToolContext } from "../src/tools/tool.ts";
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
  axisFrame(model);
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
  axisFrame(model); // what "level" and "square" mean here — see test/frames.ts
  model.addPoint([0, 20], "a");
  model.addPoint([0, 0], "p");
  model.addPoint([20, 0], "b");
  fix(model, "a", [0, 20]);
  fix(model, "b", [20, 0]);
  model.addLine("a", "p", "l1");
  model.addLine("p", "b", "l2");
  parallel(model, "l1", "f.y");
  parallel(model, "l2", "f.x");
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

test("fillet: keeps both legs and their corner as construction, and the shorter lines it makes end on the arc", async () => {
  await loadKernel();
  const model = new Model(2);
  rightCorner(model);
  const before = new Set(model.entities.keys());
  const arcName = fillet(model, "l1", "l2", 5);
  model.solve();

  // The legs are as they were drawn — a to p, p to b — and construction now;
  // the lines that bound in their place end at the tangent points, on the arc.
  const l1 = model.line("l1"), l2 = model.line("l2");
  assert.deepEqual([l1.refs, l2.refs], [["a", "p"], ["p", "b"]], "neither leg re-pointed");
  assert.ok(["l1", "l2", "p"].every((n) => model.isConstruction(n)), "the legs and their corner, set aside");
  const arc = model.arc(arcName);
  const arcEnds = [arc.start, arc.end];
  const [s1, s2] = [standsFor(model, "l1"), standsFor(model, "l2")];
  assert.ok(s1 !== "l1" && s2 !== "l2", "each leg stands for the shorter line made in its place");
  assert.ok(arcEnds.includes(model.line(s1).refs[1]) && model.line(s1).refs[0] === "a", "leg 1's line runs from a to the arc");
  assert.ok(arcEnds.includes(model.line(s2).refs[0]) && model.line(s2).refs[1] === "b", "leg 2's line runs from the arc to b");

  // Every point in the model is referenced by something.
  const referenced = new Set<string>();
  for (const e of model.entities.values()) model.refsOf(e).forEach((n) => referenced.add(n));
  for (const e of model.entities.values()) {
    if (e.kind === "point") assert.ok(referenced.has(e.name), `${e.name} is orphaned`);
  }
  assert.ok(before.has("p"), "sanity: the corner existed beforehand");
  assert.ok(model.entities.has("p"), "and it still does, as construction");
});

test("fillet: works on a non-right angle too", async () => {
  await loadKernel();
  const model = new Model(2);
  axisFrame(model);
  // A 60-degree corner at the origin, both legs pinned by fixing their far ends
  // and constraining the corner to lie on each leg's direction via fix.
  model.addPoint([20, 0], "a");
  model.addPoint([0, 0], "p");
  model.addPoint([20 * Math.cos(Math.PI / 3), 20 * Math.sin(Math.PI / 3)], "b");
  fix(model, "a", [20, 0]);
  fix(model, "b", [20 * Math.cos(Math.PI / 3), 20 * Math.sin(Math.PI / 3)]);
  model.addLine("a", "p", "l1");
  model.addLine("p", "b", "l2");
  parallel(model, "a", "p", "f.x"); // leg 1 held on the frame's x axis

  const arcName = fillet(model, "l1", "l2", 4);
  const report = model.solve();
  assert.equal(report.solved, true, JSON.stringify(report.offenders));

  // Tangent to the x-axis means the center sits exactly one radius above it.
  const ctr = model.coords(model.arc(arcName).center);
  assert.ok(Math.abs(ctr[1] - 4) < 1e-6, `center should be 4 above the x-axis, got y=${ctr[1]}`);
  assert.ok(Math.abs(model.radius(arcName) - 4) < 1e-6);
});

test("a relation on a leg holds through a fillet whichever form it was written in: the corner is kept, so the point form has its point", async () => {
  await loadKernel();

  // Line form: "this edge is level". The line stays, construction, and the
  // shorter line in its place is held on it, so it is level too.
  const good = new Model(2);
  rightCorner(good);
  fillet(good, "l1", "l2", 5);
  assert.equal(good.solve().solved, true);
  const gl2 = good.line(standsFor(good, "l2"));
  const [gs, ge] = [good.coords(gl2.refs[0]), good.coords(gl2.refs[1])];
  assert.ok(Math.abs(gs[1] - ge[1]) < 1e-6, `leg 2's line should still be level, got ys ${gs[1]} and ${ge[1]}`);

  // Point form: "these two points share a y". The corner it names is kept,
  // so it goes on holding the leg level — which it did not when the fillet
  // re-pointed the leg away from the corner (the form's one weakness; a trim
  // still has it, so the line form is still the one the tools write).
  const stale = new Model(2);
  axisFrame(stale);
  stale.addPoint([0, 20], "a");
  stale.addPoint([0, 0], "p");
  stale.addPoint([20, 0], "b");
  fix(stale, "a", [0, 20]);
  fix(stale, "b", [20, 0]);
  stale.addLine("a", "p", "l1");
  stale.addLine("p", "b", "l2");
  parallel(stale, "l1", "f.y");
  parallel(stale, "p", "b", "f.x"); // names the corner, not the edge
  fillet(stale, "l1", "l2", 5);
  assert.equal(stale.solve().solved, true);
  assert.deepEqual(stale.line("l2").refs, ["p", "b"], "leg 2 still runs from the corner");
  const sl2 = stale.line(standsFor(stale, "l2"));
  const [ss, se] = [stale.coords(sl2.refs[0]), stale.coords(sl2.refs[1])];
  assert.ok(Math.abs(ss[1] - se[1]) < 1e-6, "the point-form relation holds the corner, and the line made in leg 2's place is level with it");
});

test("a line relation keeps holding after the line is re-pointed by hand", async () => {
  await loadKernel();
  const model = new Model(2);
  axisFrame(model);
  model.addPoint([0, 0], "a");
  model.addPoint([10, 5], "b");
  model.addPoint([20, 40], "c");
  fix(model, "a", [0, 0]);
  model.addLine("a", "b", "l");
  parallel(model, "l", "f.x");
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

test("FilletTool: clicking two edges picks the corner, and a confirm rounds it and releases the tool", async () => {
  await loadKernel();
  const model = new Model(2);
  rightCorner(model); // a(0,20) — p(0,0) — b(20,0), edges l1 and l2
  const ctx = pickingCtx(model);
  const tool = new FilletTool(ctx);

  tool.onDown({ world: [0, 10], screen: screenAt([0, 10]) }); // midway along l1
  assert.equal(model.entities.size, 3 + 2 + 3, "the first click commits nothing"); // +3: the fixture frame
  tool.onDown({ world: [10, 0], screen: screenAt([10, 0]) }); // midway along l2
  assert.equal(model.entities.size, 3 + 2 + 3, "nor does the second: it picks");
  assert.deepEqual(tool.lines, ["l1", "l2"]);
  assert.equal(tool.dialog().ready, true, "and ✓ would round it");

  assert.equal(tool.confirm(), true);
  assert.equal(ctx.finished, true, "a confirm releases the tool, as Onshape's ✓ closes its dialog");
  assert.deepEqual(tool.lines, [], "with nothing picked");
  const arcs = [...model.entities.values()].filter((e) => e.kind === "arc");
  assert.equal(arcs.length, 1);
  assert.equal(model.solve().solved, true);
  assert.ok(Math.abs(model.radius(arcs[0].name) - DEFAULT_RADIUS) < 1e-6,
    `an unarmed radius falls back to the default, got ${model.radius(arcs[0].name)}`);
});

test("FilletTool: the quick path — a second click on the line picked last confirms", async () => {
  await loadKernel();
  const model = new Model(2);
  rightCorner(model);
  const tool = new FilletTool(pickingCtx(model));
  tool.onDown({ world: [0, 10], screen: screenAt([0, 10]) });
  tool.onDown({ world: [10, 0], screen: screenAt([10, 0]) });
  tool.onDown({ world: [12, 0], screen: screenAt([12, 0]) }); // l2 again
  assert.equal([...model.entities.values()].filter((e) => e.kind === "arc").length, 1);
});

test("FilletTool: a click on the corner's point takes both lines; the first of two picked, clicked again, is dropped", async () => {
  await loadKernel();
  // A corner of its own, away from the fixture frame's origin, which would be
  // what a click at (0, 0) picks.
  const model = new Model(2);
  model.addPoint([30, 50], "a");
  model.addPoint([30, 30], "p");
  model.addPoint([50, 30], "b");
  model.addLine("a", "p", "l1");
  model.addLine("p", "b", "l2");
  const tool = new FilletTool(pickingCtx(model));
  tool.onDown({ world: [30, 30], screen: screenAt([30, 30]) }); // the shared point
  assert.deepEqual([...tool.lines].sort(), ["l1", "l2"]);
  tool.onDown({ world: [30, 30], screen: screenAt([30, 30]) }); // the corner again: confirmed
  assert.equal([...model.entities.values()].filter((e) => e.kind === "arc").length, 1);

  const other = new Model(2);
  rightCorner(other);
  const t2 = new FilletTool(pickingCtx(other));
  t2.onDown({ world: [0, 10], screen: screenAt([0, 10]) });
  t2.onDown({ world: [10, 0], screen: screenAt([10, 0]) });
  t2.onDown({ world: [0, 12], screen: screenAt([0, 12]) }); // l1, the first: dropped
  assert.deepEqual(t2.lines, ["l2"]);
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
  tool.confirm();

  const arc = [...model.entities.values()].find((e) => e.kind === "arc")!;
  assert.ok(Math.abs(model.radius(arc.name) - 4) < 1e-6);
});

test("FilletTool: clicking empty space or a lone point is a miss, not a cancel", async () => {
  await loadKernel();
  const model = new Model(2);
  rightCorner(model);
  const ctx = pickingCtx(model);
  const tool = new FilletTool(ctx);

  tool.onDown({ world: [500, 500], screen: screenAt([500, 500]) }); // nothing there
  tool.onDown({ world: [0, 20], screen: screenAt([0, 20]) }); // a point at the end of one line, not a corner
  assert.equal(model.entities.size, 8, "nothing happened"); // 3 points, 2 lines, and the fixture frame
  assert.deepEqual(tool.lines, []);

  // The gesture is still fresh, so a proper pair still works.
  tool.onDown({ world: [0, 10], screen: screenAt([0, 10]) });
  tool.onDown({ world: [10, 0], screen: screenAt([10, 0]) });
  tool.confirm();
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
  assert.deepEqual(tool.lines, ["l1"], "one edge is not a corner");
  assert.equal(tool.dialog().ready, false);
  assert.equal([...model.entities.values()].filter((e) => e.kind === "arc").length, 0);
});

test("FilletTool: a refused corner keeps its picks, so a smaller radius can round it", async () => {
  await loadKernel();
  const model = new Model(2);
  rightCorner(model);
  const ctx = pickingCtx(model);
  ctx.options = { radius: 500 }; // far too large for these legs
  const tool = new FilletTool(ctx);
  tool.onDown({ world: [0, 10], screen: screenAt([0, 10]) });
  tool.onDown({ world: [10, 0], screen: screenAt([10, 0]) });
  assert.throws(() => tool.confirm(), /too large/);
  assert.deepEqual(tool.lines, ["l1", "l2"], "both still picked");

  ctx.options = { radius: 5 };
  tool.retune();
  tool.confirm();
  assert.equal([...model.entities.values()].filter((e) => e.kind === "arc").length, 1);
});

test("FilletTool: a corner it cannot round is refused out loud, not thrown at the page", async () => {
  await loadKernel();
  const model = new Model(2);
  rightCorner(model);
  const ctx = pickingCtx(model) as ReturnType<typeof pickingCtx> & { log(l: string): void; lines: string[] };
  ctx.lines = [];
  ctx.log = (l: string) => ctx.lines.push(l);
  ctx.options = { radius: 1000 }; // far too large for 20-unit legs
  const tool = new FilletTool(ctx);

  tool.onDown({ world: [0, 10], screen: screenAt([0, 10]) });
  tool.onDown({ world: [10, 0], screen: screenAt([10, 0]) });
  tool.confirm(); // must not throw
  assert.equal(ctx.lines.length, 1, "the refusal reaches the log pane");
  assert.match(ctx.lines[0], /^fillet: .*too large/);
  assert.equal([...model.entities.values()].filter((e) => e.kind === "arc").length, 0);

  // The obvious next move still works: a sane radius, and confirm again.
  ctx.options = { radius: 4 };
  tool.confirm();
  assert.equal([...model.entities.values()].filter((e) => e.kind === "arc").length, 1);
});

test("FilletTool: headless, with no log channel, a refusal still throws", async () => {
  await loadKernel();
  const model = new Model(2);
  rightCorner(model);
  const ctx = pickingCtx(model); // no .log — the convention for a caller with no user
  ctx.options = { radius: 1000 };
  const tool = new FilletTool(ctx);
  tool.onDown({ world: [0, 10], screen: screenAt([0, 10]) });
  tool.onDown({ world: [10, 0], screen: screenAt([10, 0]) });
  assert.throws(() => tool.confirm(), /too large/);
});
