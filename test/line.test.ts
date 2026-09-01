// The line tool: click, click, chain. Driven through the same `pointerAt`
// shape the engine builds, so the snap-dependent behaviour (an endpoint snap
// beating the horizontal/vertical guess) is exercised for real rather than
// through hand-written Snap objects.

import { test } from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { ensureKernelLoaded } from "../src/kernel/problem.ts";
import { Model } from "../src/model.ts";
import { LineTool, AXIS_DEGREES } from "../src/tools/line.ts";
import { fix } from "../src/relations/basic.ts";
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

/** What the engine hands a tool for a cursor at (sx, sy). */
function pointerAt(model: Model, sx: number, sy: number): PointerInfo {
  const snap = findSnap(model, view, sx, sy);
  const world = snap ? snap.world : screenToWorld(view, sx, sy);
  return { world, screen: [sx, sy], ...(snap ? { snap } : {}) };
}
/** A click aimed at a world position, through the engine's snapping. */
const click = (model: Model, world: number[], dx = 0, dy = 0): PointerInfo => {
  const [sx, sy] = screenAt(world);
  return pointerAt(model, sx + dx, sy + dy);
};

/**
 * Where the fixture frame goes: aligned with the kernel's axes, as everywhere
 * else, but parked 400 units up. The tool's axis inference only happens
 * against a default frame, so every model here needs one — and a frame's
 * points are ordinary points that snapping will happily catch, so a fixture on
 * the origin would be the nearest thing to every click these tests make.
 */
const FRAME_AT = [0, 400];

/** A model with the fixture frame in place, ready for the line tool. */
function framed(dim = 2): Model {
  const m = new Model(dim);
  if (dim === 2) axisFrame(m, "f", FRAME_AT);
  return m;
}

/** `fix`, in world terms — the frame is parked away from the origin. */
const pin = (m: Model, name: string, world: number[]) =>
  fix(m, name, [world[0] - FRAME_AT[0], world[1] - FRAME_AT[1]]);

// The counts below are of what the *tool* built, so the fixture frame and its
// two points are discounted throughout.
const FIXTURE_ENTITIES = 3;
const drawn = (m: Model) => m.entities.size - (m.dim === 2 ? FIXTURE_ENTITIES : 0);

const opsOf = (m: Model) => m.journal.map((e) => e.op);
const linesOf = (m: Model) => [...m.entities.values()].filter((e) => e.kind === "line");
const pointsOf = (m: Model) =>
  [...m.entities.values()].filter((e) => e.kind === "point" && !e.name.startsWith("f_"));
const near = (a: number[], b: number[]) => Math.hypot(a[0] - b[0], a[1] - b[1]) < 1e-6;

test("LineTool: the first click commits nothing, the second commits a segment", async () => {
  await loadKernel();
  const model = framed();
  const ctx = fakeCtx(model);
  const tool = new LineTool(ctx);

  tool.onDown(click(model, [0, 0]));
  assert.equal(drawn(model), 0, "an abandoned first click must leave no stray point");
  tool.onMove(click(model, [30, 47]));
  assert.equal(drawn(model), 0, "still only a preview");

  tool.onDown(click(model, [30, 47]));
  assert.equal(pointsOf(model).length, 2);
  assert.equal(linesOf(model).length, 1);
  assert.equal(ctx.finished, false, "the tool stays armed — the chain continues");
});

test("LineTool: an abandoned chain leaves nothing behind", async () => {
  await loadKernel();
  const model = framed();
  const tool = new LineTool(fakeCtx(model));
  tool.onDown(click(model, [10, 10]));
  tool.onCancel();
  assert.equal(drawn(model), 0);

  // ...and the next click starts a fresh chain rather than closing the old one.
  tool.onDown(click(model, [50, 10]));
  assert.equal(drawn(model), 0, "that click is a new pending start, not a second endpoint");
});

test("LineTool: chained segments share the vertex between them — one entity, not two", async () => {
  await loadKernel();
  const model = framed();
  const ctx = fakeCtx(model);
  const tool = new LineTool(ctx);

  tool.onDown(click(model, [0, 0]));
  tool.onDown(click(model, [0, 40]));   // straight up
  tool.onDown(click(model, [60, 40]));  // then right: an L

  const [first, second] = linesOf(model);
  assert.equal(linesOf(model).length, 2);
  assert.equal(pointsOf(model).length, 3, "three points for two segments, not four");
  assert.equal(first.refs[1], second.refs[0], "the committed end *is* the next segment's start");
  assert.equal(opsOf(model).includes("coincident"), false,
    "nothing to join — it is literally the same vertex");

  // Which is what makes it move as one: drag the shared vertex and both follow.
  pin(model, first.refs[1], [-15, 55]);
  assert.equal(model.solve().solved, true);
  assert.ok(near(model.coords(first.refs[1]), [-15, 55]));
  assert.ok(near(model.coords(second.refs[0]), [-15, 55]));
});

test("LineTool: escape ends the chain and the committed segments stay", async () => {
  await loadKernel();
  const model = framed();
  const tool = new LineTool(fakeCtx(model));
  tool.onDown(click(model, [0, 0]));
  tool.onDown(click(model, [0, 40]));
  assert.equal(linesOf(model).length, 1);

  tool.onCancel();
  tool.onDown(click(model, [80, 80]));
  assert.equal(linesOf(model).length, 1, "that click began a new chain, it did not extend the old one");
  assert.equal(pointsOf(model).length, 2, "and committed nothing of its own yet");
});

test("LineTool: a second click on the segment's own start is ignored, not a lost chain", async () => {
  await loadKernel();
  const model = framed();
  const tool = new LineTool(fakeCtx(model));
  tool.onDown(click(model, [0, 0]));
  tool.onDown(click(model, [0, 0]));
  assert.equal(drawn(model), 0, "no zero-length line");

  tool.onDown(click(model, [40, 0])); // the chain was still waiting, so this works
  assert.equal(linesOf(model).length, 1);
});

// --- horizontal / vertical inference ---------------------------------------

/** The world position of a segment `len` long from the origin, `deg` off level. */
const offLevel = (len: number, deg: number) =>
  [len * Math.cos((deg * Math.PI) / 180), len * Math.sin((deg * Math.PI) / 180)];

test("LineTool: a nearly-level segment is pulled level and gets hor, in the line form", async () => {
  await loadKernel();
  const model = framed();
  const tool = new LineTool(fakeCtx(model));
  tool.onDown(click(model, [0, 0]));
  tool.onDown(click(model, offLevel(60, AXIS_DEGREES - 1)));

  const [l] = linesOf(model);
  assert.deepEqual(model.journal.filter((e) => e.op === "horizontal").map((e) => e.args), [[l.name, "f"]],
    "the line form — one argument, the line — so it survives a fillet re-pointing the edge");
  const [a, b] = l.refs.map((n) => model.coords(n));
  assert.ok(Math.abs(a[1] - b[1]) < 1e-9, `the preview was pulled onto the axis, ys ${a[1]} and ${b[1]}`);
  assert.ok(Math.abs(b[0] - 60 * Math.cos(((AXIS_DEGREES - 1) * Math.PI) / 180)) < 1e-6,
    "only the off-axis coordinate is corrected");
});

test("LineTool: a nearly-upright segment gets ver; anything further off gets neither", async () => {
  await loadKernel();
  const model = framed();
  const tool = new LineTool(fakeCtx(model));
  tool.onDown(click(model, [0, 0]));
  tool.onDown(click(model, [2, 60])); // under 2 degrees off vertical
  assert.deepEqual(opsOf(model).filter((o) => o === "vertical").length, 1);

  const off = framed();
  const t2 = new LineTool(fakeCtx(off));
  t2.onDown(click(off, [0, 0]));
  t2.onDown(click(off, offLevel(60, AXIS_DEGREES + 2)));
  assert.deepEqual(opsOf(off).filter((o) => o === "horizontal" || o === "vertical"), [],
    "past the tolerance the line is left as drawn");
  const [l] = linesOf(off);
  const [a, b] = l.refs.map((n) => off.coords(n));
  assert.ok(Math.abs(a[1] - b[1]) > 1, "and not quietly straightened either");
});

test("LineTool: an endpoint snap beats the axis guess", async () => {
  await loadKernel();
  const model = framed();
  // A target two degrees off level from where the chain will start: near
  // enough that the axis guess would have claimed it.
  const target = offLevel(60, 2);
  model.addPoint(target, "target");
  const tool = new LineTool(fakeCtx(model));

  tool.onDown(click(model, [0, 0]));
  const end = click(model, target, 3, -2); // a near miss, so the snap catches it
  assert.equal(end.snap?.kind, "point");
  tool.onDown(end);

  const ops = opsOf(model);
  assert.ok(ops.includes("coincident"), "the point it landed on is what was meant");
  assert.equal(ops.includes("horizontal"), false, "so the axis guess is dropped rather than fighting it");

  pin(model, "target", target);
  assert.equal(model.solve().solved, true, "which is why it does not conflict");
  const [l] = linesOf(model);
  assert.ok(near(model.coords(l.refs[1]), target), "the end is on the target, not on the axis");
});

test("LineTool: ...unless the snapped point is level anyway, in which case both hold", async () => {
  await loadKernel();
  const model = framed();
  model.addPoint([60, 0], "target"); // exactly level with the chain's start
  const tool = new LineTool(fakeCtx(model));
  tool.onDown(click(model, [0, 0]));
  tool.onDown(click(model, [60, 0], 3, -2));

  const ops = opsOf(model);
  assert.ok(ops.includes("coincident") && ops.includes("horizontal"),
    "nothing is given up when the snap already satisfies the axis");
  pin(model, "target", [60, 0]);
  assert.equal(model.solve().solved, true, JSON.stringify(model.solve().offenders));
});

test("LineTool: the chain follows the solver, so the next segment starts where the last one ended", async () => {
  await loadKernel();
  const model = framed();
  const ctx = fakeCtx(model);
  const tool = new LineTool(ctx);

  tool.onDown(click(model, [0, 0]));
  tool.onDown(click(model, [50, 0])); // a level segment, so hor ties the two ys
  const [first] = linesOf(model);

  // Now drag the chain's far end somewhere else, through the constraint.
  pin(model, first.refs[0], [0, 30]);
  assert.equal(model.solve().solved, true);
  const moved = model.coords(first.refs[1]);
  assert.ok(near(moved, [50, 30]), `hor carried the chain's end with it, now at ${moved}`);

  // A click barely off level *from where that point now is*. Read from the
  // stale click position (50, 0) this would be 31 degrees out and infer
  // nothing; read from the point, it is half a degree and infers hor.
  tool.onDown(click(model, [100, 30.5]));
  const [, second] = linesOf(model);
  assert.equal(second.refs[0], first.refs[1], "the same shared vertex");
  assert.equal(opsOf(model).filter((o) => o === "horizontal").length, 2,
    "the second segment was measured from the vertex's current position");
});

test("LineTool: the chain is dimension-generic — it draws in 3D, with no axis to infer", async () => {
  await loadKernel();
  const model = framed(3);
  const tool = new LineTool(fakeCtx(model));
  const raw = (world: number[]): PointerInfo => ({ world, screen: [0, 0] });

  tool.onDown(raw([0, 0, 0]));
  tool.onDown(raw([10, 0, 0]));
  tool.onDown(raw([10, 0, 7]));

  assert.equal(linesOf(model).length, 2);
  assert.equal(pointsOf(model).length, 3, "the vertex is shared in 3D too");
  assert.deepEqual(opsOf(model).filter((o) => o === "horizontal" || o === "vertical"), [],
    "horizontal and vertical are genuinely 2D-only, so nothing is inferred here");
  assert.deepEqual(model.coords(linesOf(model)[1].refs[1]), [10, 0, 7]);
});
