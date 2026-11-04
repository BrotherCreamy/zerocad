// The 3-point circle tool: the closed form it previews and refuses with, and
// the composition it commits.
//
// The claim worth testing is not "a circle appeared" but "the circle is
// *defined* by the three points" — so the assertions are against the
// closed-form circumcircle exactly (the free-entities house standard, not a
// `solved: true`), against the journal being the three calls a user could have
// typed, and against the three relations still being there afterwards. What
// only a browser can answer — that the whole gesture is one undo step, and that
// the preview is actually drawn — is in test/e2e/circle3.e2e.ts.
//
// The closed form itself now lives in src/tools/circumcircle.ts, shared with
// the 3-point arc tool. Its tests stayed here rather than moving to a file of
// their own: this is where they were written, this is the tool they were
// written about, and a `circumcircle.test.ts` holding four cases would be a
// second place to look for the same thing.

import { test } from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { ensureKernelLoaded } from "../src/kernel/problem.ts";
import { Model } from "../src/model.ts";
import { Circle3Tool } from "./lockedtools.ts";
import { circumcircle, COLLINEAR_EPS } from "../src/tools/circumcircle.ts";
import { fix } from "../src/relations/basic.ts";
import { findSnap } from "../src/snapping.ts";
import { save, open } from "../src/persist.ts";
import { screenToWorld, worldToScreen, type View } from "../src/view.ts";
import type { PointerInfo, ToolContext } from "../src/tools/tool.ts";
import { axisFrame, tiltedFrame } from "./frames.ts";

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

/** A click at a world position, with whatever the engine would have snapped it to. */
function clickAt(model: Model, world: number[]): PointerInfo {
  const [sx, sy] = worldToScreen(view, world);
  const snap = findSnap(model, view, sx, sy);
  const w = snap ? snap.world : screenToWorld(view, sx, sy);
  return { world: w, screen: [sx, sy], ...(snap ? { snap } : {}) };
}

/** A click at raw world coordinates, with no snapping at all. */
const raw = (world: number[]): PointerInfo => ({ world, screen: worldToScreen(view, world) });

const opsOf = (m: Model) => m.journal.map((e) => e.op);

// --- the closed form -------------------------------------------------------

test("circumcircle: the closed form, exactly", () => {
  // (0,0), (8,0), (0,6) is the 3-4-5 right triangle scaled by two: the
  // circumcentre is the hypotenuse's midpoint and the radius is half of it.
  const c = circumcircle([0, 0], [8, 0], [0, 6])!;
  assert.ok(c, "three points off a line have a circumcircle");
  assert.ok(Math.abs(c.center[0] - 4) < 1e-12 && Math.abs(c.center[1] - 3) < 1e-12, `centre ${c.center}`);
  assert.ok(Math.abs(c.radius - 5) < 1e-12, `radius ${c.radius}`);
});

test("circumcircle: the answer does not depend on which click came first", () => {
  const pts: number[][] = [[-13, 7], [21, -4], [5, 30]];
  const base = circumcircle(pts[0], pts[1], pts[2])!;
  for (const order of [[1, 2, 0], [2, 0, 1], [2, 1, 0], [0, 2, 1], [1, 0, 2]]) {
    const c = circumcircle(pts[order[0]], pts[order[1]], pts[order[2]])!;
    assert.ok(Math.hypot(c.center[0] - base.center[0], c.center[1] - base.center[1]) < 1e-9,
      `order ${order} gave centre ${c.center}, not ${base.center}`);
    assert.ok(Math.abs(c.radius - base.radius) < 1e-9, `order ${order} gave radius ${c.radius}`);
  }
  // And it really is the circle through all three, not merely a stable number.
  for (const p of pts) {
    assert.ok(Math.abs(Math.hypot(p[0] - base.center[0], p[1] - base.center[1]) - base.radius) < 1e-9);
  }
});

test("circumcircle: collinear, and coincident, points have none", () => {
  assert.equal(circumcircle([0, 0], [10, 0], [25, 0]), null, "on one line");
  assert.equal(circumcircle([0, 0], [3, 4], [-6, -8]), null, "on one line through the first point");
  assert.equal(circumcircle([0, 0], [5, 5], [5, 5]), null, "two clicks in the same place");
  assert.equal(circumcircle([2, 2], [2, 2], [9, 1]), null, "the first two in the same place");
});

test("circumcircle: the collinearity test is an angle, not an area", () => {
  // The same shape at two scales: an area threshold would call the big one
  // bent and the small one straight, which is exactly the bug the relative
  // form avoids. Both are 1e-6 radians off straight — far above the epsilon.
  for (const scale of [1e-3, 1, 1e4]) {
    const c = circumcircle([0, 0], [scale, 0], [2 * scale, scale * 1e-6]);
    assert.ok(c, `a 1e-6 rad bend at scale ${scale} is a circle, however big the drawing is`);
  }
  // And below the epsilon it is a line at every scale.
  for (const scale of [1e-3, 1, 1e4]) {
    assert.equal(circumcircle([0, 0], [scale, 0], [2 * scale, scale * COLLINEAR_EPS / 10]), null,
      `a bend under the epsilon at scale ${scale} is a straight line`);
  }
});

// --- the gesture -----------------------------------------------------------

test("Circle3Tool: three clicks commit one circle, three points and three onCircles", async () => {
  await loadKernel();
  const model = new Model(2);
  const ctx = fakeCtx(model);
  const tool = new Circle3Tool(ctx);

  tool.onDown(raw([0, 0]));
  assert.equal(model.entities.size, 0, "the first click commits nothing");
  tool.onMove(raw([4, 4]));
  tool.onDown(raw([8, 0]));
  assert.equal(model.entities.size, 0, "nor does the second — it is a live preview");
  assert.equal(ctx.finished, false, "and the tool is still armed, mid-gesture");

  tool.onDown(raw([0, 6]));
  assert.equal(ctx.finished, true, "the third click ends the gesture");
  assert.equal(ctx.solves, 1, "and solves exactly once");

  const byKind = (k: string) => [...model.entities.values()].filter((e) => e.kind === k);
  assert.equal(byKind("circle").length, 1);
  // Four points: the three rim points, plus the free circle's own centre.
  assert.equal(byKind("point").length, 4);
  assert.equal([...model.relations.values()].filter((r) => r.op === "onCircle").length, 3);

  // The exact answer, not "solved: true": circumcircle of (0,0), (8,0), (0,6).
  const circle = byKind("circle")[0];
  const centre = model.coords((circle as { center: string }).center);
  assert.ok(Math.abs(centre[0] - 4) < 1e-6 && Math.abs(centre[1] - 3) < 1e-6, `centre ${centre}`);
  assert.ok(Math.abs(model.radius(circle.name) - 5) < 1e-6, `radius ${model.radius(circle.name)}`);
});

test("Circle3Tool: it journals as the calls a user could have typed, and reopens identically", async () => {
  await loadKernel();
  const model = new Model(2);
  const tool = new Circle3Tool(fakeCtx(model));
  tool.onDown(raw([-20, 5]));
  tool.onDown(raw([14, -3]));
  tool.onDown(raw([2, 26]));

  assert.deepEqual(opsOf(model), [
    "addPoint", "addPoint", "addPoint", // the three rim points
    "addCircle", "setCoords", // the free circle, seeded at the answer
    "onCircle", "onCircle", "onCircle", // and its entire definition
  ]);
  // The circle is journalled as *free* — a null centre and a seed radius —
  // which is what makes this a composition rather than a computed circle.
  const addCircle = model.journal.find((e) => e.op === "addCircle")!;
  assert.equal(addCircle.args[0], null, `the centre argument must be null: ${JSON.stringify(addCircle.args)}`);

  const text = save(model, false);
  const reopened = open(text);
  assert.equal(save(reopened, false), text, "a gesture must survive save/open byte for byte");
  assert.equal(reopened.relations.size, model.relations.size);
});

test("Circle3Tool: the circle follows its rim points, which is the whole point of it", async () => {
  await loadKernel();
  const model = new Model(2);
  const ctx = fakeCtx(model);
  const tool = new Circle3Tool(ctx);
  tool.onDown(raw([0, 0]));
  tool.onDown(raw([8, 0]));
  tool.onDown(raw([0, 6]));

  // Nail two of the rim points down and move the third: a computed circle
  // would sit where it was drawn; a constrained one goes with it.
  const names = [...model.entities.values()].filter((e) => e.kind === "point").map((e) => e.name);
  // The fixture frame goes in after the names are read, so it contributes no
  // points to that list — and after the clicks, so it snaps to nothing.
  axisFrame(model);
  fix(model, names[0], [0, 0]);
  fix(model, names[1], [8, 0]);
  model.setCoords(names[2], [0, 12]);
  fix(model, names[2], [0, 12]);
  const report = model.solve();
  assert.equal(report.solved, true, JSON.stringify(report.offenders));

  const circle = [...model.entities.values()].find((e) => e.kind === "circle")!;
  const centre = model.coords((circle as { center: string }).center);
  const expected = circumcircle([0, 0], [8, 0], [0, 12])!;
  assert.ok(Math.hypot(centre[0] - expected.center[0], centre[1] - expected.center[1]) < 1e-6,
    `centre went to ${centre}, not the new circumcentre ${expected.center}`);
  assert.ok(Math.abs(model.radius(circle.name) - expected.radius) < 1e-6);
});

// --- refusing what is not a circle -----------------------------------------

test("Circle3Tool: a collinear third click is refused, and the gesture stays live", async () => {
  await loadKernel();
  const model = new Model(2);
  const ctx = fakeCtx(model);
  const tool = new Circle3Tool(ctx);

  tool.onDown(raw([0, 0]));
  tool.onDown(raw([10, 0]));
  tool.onDown(raw([25, 0])); // dead on the line through the first two

  assert.equal(model.entities.size, 0, "nothing may be built for a circle that cannot exist");
  assert.equal(model.relations.size, 0);
  assert.equal(ctx.finished, false, "and the tool stays armed rather than dropping the gesture");
  assert.equal(ctx.solves, 0, "there is nothing to solve, so nothing was solved");

  // The two good clicks are still held, so aiming the third somewhere else
  // finishes the gesture that was already half done.
  tool.onDown(raw([5, 8]));
  assert.equal(ctx.finished, true);
  const circle = [...model.entities.values()].find((e) => e.kind === "circle")!;
  const expected = circumcircle([0, 0], [10, 0], [5, 8])!;
  assert.ok(Math.abs(model.radius(circle.name) - expected.radius) < 1e-6);
});

test("Circle3Tool: a near-collinear commit is the user's to make, and goes through", async () => {
  await loadKernel();
  const model = new Model(2);
  const ctx = fakeCtx(model);
  const tool = new Circle3Tool(ctx);
  tool.onDown(raw([0, 0]));
  tool.onDown(raw([10, 0]));
  tool.onDown(raw([20, 1e-4])); // visibly straight, mathematically not

  assert.equal(ctx.finished, true, "a very large circle is still a circle");
  const circle = [...model.entities.values()].find((e) => e.kind === "circle")!;
  assert.ok(model.radius(circle.name) > 1e5, `radius ${model.radius(circle.name)}`);
});

test("Circle3Tool: cancelling forgets the clicks so far", async () => {
  await loadKernel();
  const model = new Model(2);
  const ctx = fakeCtx(model);
  const tool = new Circle3Tool(ctx);
  tool.onDown(raw([0, 0]));
  tool.onDown(raw([8, 0]));
  tool.onCancel();
  // Three fresh clicks, not one: the two before the cancel are gone.
  tool.onDown(raw([0, 0]));
  tool.onDown(raw([8, 0]));
  assert.equal(model.entities.size, 0, "the cancelled clicks must not count toward the next gesture");
  tool.onDown(raw([0, 6]));
  assert.equal(ctx.finished, true);
});

test("Circle3Tool in 3D: the circle through three clicks on a tilted plane, centre held there too", async () => {
  await loadKernel();
  const model = new Model(3);
  const f = tiltedFrame(model);
  const plane = { origin: f.origin, u: f.ux, v: f.uy };
  const ctx = fakeCtx(model);
  const tool = new Circle3Tool(ctx);
  // (0,0), (8,0), (0,6) in the frame: the circumcircle is centred (4,3), r 5.
  for (const [u, v] of [[0, 0], [8, 0], [0, 6]]) tool.onDown({ world: f.at(u, v), screen: [0, 0], plane });
  assert.equal(ctx.finished, true);

  const c = [...model.entities.values()].find((e) => e.kind === "circle") as { name: string; center: string };
  const at = model.coords(c.center), expected = f.at(4, 3);
  assert.ok(Math.hypot(...at.map((v, i) => v - expected[i])) < 1e-9, `centre at ${at}, expected ${expected}`);
  assert.ok(Math.abs(model.radius(c.name) - 5) < 1e-9);
  const held = model.journal.filter((e) => e.op === "onPlane").map((e) => e.args[0]);
  assert.equal(held.length, 4, "three rim points and the centre are all on the sketch");
  assert.ok(held.includes(c.center));
  assert.equal(model.solve().solved, true);
});

test("circumcircle in 3D refuses three points on one line, at any orientation", () => {
  const d = [0.3, -0.5, 0.81];
  assert.equal(circumcircle([1, 2, 3], d.map((x, i) => [1, 2, 3][i] + 4 * x), d.map((x, i) => [1, 2, 3][i] - 7 * x)), null);
  const found = circumcircle([0, 0, 5], [8, 0, 5], [0, 6, 5])!;
  assert.deepEqual(found.center.map((v) => Math.round(v * 1e9) / 1e9), [4, 3, 5]);
});

// --- snapping and inference, which is what makes it compose ----------------

test("Circle3Tool: a click on an existing point makes the rim point coincident with it", async () => {
  await loadKernel();
  const model = new Model(2);
  model.addPoint([0, 0], "a");
  model.addPoint([8, 0], "b");

  const ctx = fakeCtx(model);
  const tool = new Circle3Tool(ctx);
  tool.onDown(clickAt(model, [0, 0])); // straight onto a
  tool.onDown(clickAt(model, [8, 0])); // straight onto b
  tool.onDown(raw([0, 6])); // and one on empty canvas

  // Pinned after the clicks, so the fixture frame's origin — which also sits
  // at (0,0) — is not there to compete with `a` for the first snap.
  axisFrame(model);
  fix(model, "a", [0, 0]);
  fix(model, "b", [8, 0]);

  const coincidences = [...model.relations.values()].filter((r) => r.op === "coincident");
  assert.equal(coincidences.length, 2,
    `both snapped clicks should have inferred a coincidence: ${JSON.stringify(
      [...model.relations.values()].map((r) => `${r.op}(${r.args.join(",")})`))}`);
  assert.ok(coincidences.some((r) => r.args.includes("a")));
  assert.ok(coincidences.some((r) => r.args.includes("b")));

  // The circle really does pass through the two corners it was drawn from —
  // which is the "3-point circle through two existing corners is just three
  // clicks" case the tool exists for.
  assert.equal(model.solve().solved, true);
  const circle = [...model.entities.values()].find((e) => e.kind === "circle")!;
  const centre = model.coords((circle as { center: string }).center);
  const r = model.radius(circle.name);
  for (const p of [[0, 0], [8, 0]]) {
    assert.ok(Math.abs(Math.hypot(p[0] - centre[0], p[1] - centre[1]) - r) < 1e-6,
      `${p} is not on the rim: centre ${centre}, r ${r}`);
  }
});

test("Circle3Tool: the collinear refusal reaches the log pane when there is one", async () => {
  await loadKernel();
  const model = new Model(2);
  const ctx = fakeCtx(model) as ReturnType<typeof fakeCtx> & { log(l: string): void; lines: string[] };
  ctx.lines = [];
  ctx.log = (l: string) => ctx.lines.push(l);
  const tool = new Circle3Tool(ctx);

  tool.onDown(raw([0, 0]));
  tool.onDown(raw([10, 0]));
  tool.onDown(raw([25, 0]));
  assert.equal(ctx.lines.length, 1);
  assert.match(ctx.lines[0], /^circle: those three are on one line — click the third off it$/);
});
