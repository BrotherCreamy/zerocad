// The line tool: click, click, chain. Driven through the same `pointerAt`
// shape the engine builds, so the snap-dependent behaviour (an endpoint snap
// beating the axis guess) is exercised for real rather than through
// hand-written Snap objects.

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

// --- axis inference --------------------------------------------------------

/** The world position of a segment `len` long from the origin, `deg` off level. */
const offLevel = (len: number, deg: number) =>
  [len * Math.cos((deg * Math.PI) / 180), len * Math.sin((deg * Math.PI) / 180)];

test("LineTool: a nearly-level segment is pulled level and gets par to +x, in the line form", async () => {
  await loadKernel();
  const model = framed();
  const tool = new LineTool(fakeCtx(model));
  tool.onDown(click(model, [0, 0]));
  tool.onDown(click(model, offLevel(60, AXIS_DEGREES - 1)));

  const [l] = linesOf(model);
  assert.deepEqual(model.journal.filter((e) => e.op === "parallel").map((e) => e.args), [[l.name, "f.x"]],
    "the line form — the line and an axis — so it survives a fillet re-pointing the edge");
  const [a, b] = l.refs.map((n) => model.coords(n));
  assert.ok(Math.abs(a[1] - b[1]) < 1e-9, `the preview was pulled onto the axis, ys ${a[1]} and ${b[1]}`);
  assert.ok(Math.abs(b[0] - 60 * Math.cos(((AXIS_DEGREES - 1) * Math.PI) / 180)) < 1e-6,
    "only the off-axis coordinate is corrected");
});

test("LineTool: a nearly-upright segment gets par to +y; anything further off gets neither", async () => {
  await loadKernel();
  const model = framed();
  const tool = new LineTool(fakeCtx(model));
  tool.onDown(click(model, [0, 0]));
  tool.onDown(click(model, [2, 60])); // under 2 degrees off the frame's +y
  assert.deepEqual(model.journal.filter((e) => e.op === "parallel").map((e) => e.args),
    [[linesOf(model)[0].name, "f.y"]]);

  const off = framed();
  const t2 = new LineTool(fakeCtx(off));
  t2.onDown(click(off, [0, 0]));
  t2.onDown(click(off, offLevel(60, AXIS_DEGREES + 2)));
  assert.deepEqual(opsOf(off).filter((o) => o === "parallel"), [],
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
  assert.equal(ops.includes("parallel"), false, "so the axis guess is dropped rather than fighting it");

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
  assert.ok(ops.includes("coincident") && ops.includes("parallel"),
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
  tool.onDown(click(model, [50, 0])); // a level segment, so the par ties the two ys
  const [first] = linesOf(model);

  // Now drag the chain's far end somewhere else, through the constraint.
  pin(model, first.refs[0], [0, 30]);
  assert.equal(model.solve().solved, true);
  const moved = model.coords(first.refs[1]);
  assert.ok(near(moved, [50, 30]), `the axis par carried the chain's end with it, now at ${moved}`);

  // A click barely off level *from where that point now is*. Read from the
  // stale click position (50, 0) this would be 31 degrees out and infer
  // nothing; read from the point, it is half a degree and infers the axis.
  tool.onDown(click(model, [100, 30.5]));
  const [, second] = linesOf(model);
  assert.equal(second.refs[0], first.refs[1], "the same shared vertex");
  assert.equal(opsOf(model).filter((o) => o === "parallel").length, 2,
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
  assert.deepEqual(opsOf(model).filter((o) => o === "parallel"), [],
    "a frame and its axes are 2D-only, so nothing is inferred here");
  assert.deepEqual(model.coords(linesOf(model)[1].refs[1]), [10, 0, 7]);
});

// --- the aim, the guide and the constraint, against a *tilted* frame ---------
//
// The half-1 gap this closes: the tool inferred the axis constraint against
// the frame while computing the aim and drawing the guide against the kernel's
// own axes, so a tilted default frame got a preview that disagreed with the
// constraint about to land. All three now read the same frame.

/** A frame turned `deg` counter-clockwise, parked well away from the drawing. */
function tiltedFrame(model: Model, deg: number): void {
  const rad = (deg * Math.PI) / 180;
  model.addPoint(FRAME_AT, "f_o");
  model.addPoint([FRAME_AT[0] + Math.cos(rad), FRAME_AT[1] + Math.sin(rad)], "f_x");
  model.addFrame("f_o", "f_x", null, "f");
  model.setDefaultFrame("f");
}

/** The segment the tool committed, as a unit direction. */
function segmentDirection(model: Model): number[] {
  const [l] = linesOf(model);
  const [a, b] = l.refs.map((n) => model.coords(n));
  const d = [b[0] - a[0], b[1] - a[1]];
  const len = Math.hypot(d[0], d[1]);
  return [d[0] / len, d[1] / len];
}

test("LineTool: a tilted frame tilts the aim — the segment lands on the frame's +x, not the canvas's", async () => {
  await loadKernel();
  const model = new Model(2);
  tiltedFrame(model, 30);
  const tool = new LineTool(fakeCtx(model));

  // Two degrees off the *frame's* x — which is 32° off the canvas's, far
  // outside the tolerance, so any answer here can only have come from the frame.
  const rad = (32 * Math.PI) / 180;
  tool.onDown(click(model, [0, 0]));
  tool.onDown(click(model, [60 * Math.cos(rad), 60 * Math.sin(rad)]));

  const [l] = linesOf(model);
  assert.deepEqual(model.journal.filter((e) => e.op === "parallel").map((e) => e.args), [[l.name, "f.x"]]);
  const [dx, dy] = segmentDirection(model);
  const wedge = dx * Math.sin((30 * Math.PI) / 180) - dy * Math.cos((30 * Math.PI) / 180);
  assert.ok(Math.abs(wedge) < 1e-9, `the committed segment lies along the frame's +x (wedge ${wedge})`);
  assert.equal(model.solve().solved, true, "so the constraint that landed is already satisfied");
});

test("LineTool: the dashed guide is drawn along the same tilted axis the constraint means", async () => {
  await loadKernel();
  const model = new Model(2);
  tiltedFrame(model, 30);
  const tool = new LineTool(fakeCtx(model));
  tool.onDown(click(model, [0, 0]));
  const rad = (32 * Math.PI) / 180;
  tool.onMove(click(model, [60 * Math.cos(rad), 60 * Math.sin(rad)]));

  // The guide is the first stroked path the tool draws, and it is the only one
  // 8000px long — the preview segment and the start marker are both short.
  const segments: [number, number, number, number][] = [];
  let at: [number, number] = [0, 0];
  const g = {
    save() {}, restore() {}, beginPath() {}, stroke() {}, arc() {}, setLineDash() {},
    moveTo(x: number, y: number) { at = [x, y]; },
    lineTo(x: number, y: number) { segments.push([at[0], at[1], x, y]); at = [x, y]; },
    strokeStyle: "", lineWidth: 0, globalAlpha: 1,
  } as unknown as CanvasRenderingContext2D;
  tool.render({ g, worldToScreen: (w) => worldToScreen(view, w) });

  const guide = segments.find((s) => Math.hypot(s[2] - s[0], s[3] - s[1]) > 1000);
  assert.ok(guide, "a guide was drawn at all");
  // Screen y runs the other way from world y, so a frame turned 30° CCW in the
  // world is a guide sloping 30° *up* the canvas to the right.
  // Mod 180: a guide is a line through the start, drawn both ways, so which
  // end of it the path happens to begin at says nothing.
  const angle = (Math.atan2(-(guide![3] - guide![1]), guide![2] - guide![0]) * 180) / Math.PI;
  const off = (((angle - 30) % 180) + 180) % 180;
  assert.ok(Math.min(off, 180 - off) < 1e-6,
    `the guide lies along the frame's +x, not the canvas's (got ${angle}°)`);
});

test("LineTool: with no default frame nothing is inferred, and nothing is quietly straightened", async () => {
  await loadKernel();
  const model = new Model(2); // no frame at all
  const tool = new LineTool(fakeCtx(model));
  tool.onDown(click(model, [0, 0]));
  tool.onDown(click(model, offLevel(60, AXIS_DEGREES - 1)));

  assert.deepEqual(opsOf(model).filter((o) => o === "parallel"), [],
    "there is nothing to be level with, so nothing claims the line is");
  const [a, b] = linesOf(model)[0].refs.map((n) => model.coords(n));
  assert.ok(Math.abs(a[1] - b[1]) > 1,
    "and the preview is not pulled onto the kernel's axes either — that is the world frame by the back door");
});
