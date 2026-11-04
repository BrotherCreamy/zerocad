import { test } from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { ensureKernelLoaded } from "../src/kernel/problem.ts";
import { Model } from "../src/model.ts";
import { hitTest, describePick, PICK_POINT } from "../src/picking.ts";
import { FRAME_ARM_PX } from "../src/framemarker.ts";
import { worldToScreen, type View } from "../src/view.ts";
import { coincident, fix } from "../src/relations/basic.ts";
import { parallel } from "../src/relations/geometry.ts";
import { del } from "../src/operations.ts";
import { axisFrame } from "./frames.ts";

async function loadKernel() {
  const bytes = await readFile(new URL("../src/kernel/wasm-gen/neocad_kernel_bg.wasm", import.meta.url));
  await ensureKernelLoaded(bytes);
}

const view: View = { ox: 400, oy: 300, scale: 3 };
const at = (world: number[]) => worldToScreen(view, world);

test("picks the point under the cursor", async () => {
  const m = new Model(2);
  m.addPoint([10, 20], "a");
  m.addPoint([-30, 5], "b");
  const [sx, sy] = at([10, 20]);
  const hit = hitTest(m, view, sx + 2, sy - 1);
  assert.equal(hit?.name, "a");
  assert.equal(hit?.kind, "point");
});

test("picks nothing when the cursor is in empty space", async () => {
  const m = new Model(2);
  m.addPoint([10, 20], "a");
  const [sx, sy] = at([10, 20]);
  assert.equal(hitTest(m, view, sx + 40, sy + 40), null);
});

test("picks the nearer of two points", async () => {
  const m = new Model(2);
  m.addPoint([0, 0], "near");
  m.addPoint([2, 0], "far"); // 6px apart at scale 3, so both are in range
  const [sx, sy] = at([0, 0]);
  assert.equal(hitTest(m, view, sx + 1, sy)?.name, "near");
  assert.equal(hitTest(m, view, sx + 5, sy)?.name, "far");
});

test("a point beats a line it sits on, even when the line is nearer", async () => {
  const m = new Model(2);
  m.addPoint([0, 0], "a");
  m.addPoint([40, 0], "b");
  m.addLine("a", "b", "l");
  // Just off the endpoint: the line is essentially underneath the cursor, but
  // the point is what was meant.
  const [sx, sy] = at([0, 0]);
  const hit = hitTest(m, view, sx + 3, sy + 1);
  assert.equal(hit?.kind, "point", "points win their tier outright");
  assert.equal(hit?.name, "a");
});

test("picks a line along its length, but not past its ends", async () => {
  const m = new Model(2);
  m.addPoint([0, 0], "a");
  m.addPoint([40, 0], "b");
  m.addLine("a", "b", "l");

  const mid = at([20, 0]);
  assert.equal(hitTest(m, view, mid[0], mid[1] + 2)?.name, "l", "on the segment");

  const beyond = at([70, 0]); // on the infinite line, well past b
  assert.equal(hitTest(m, view, beyond[0], beyond[1]), null, "not on the infinite extension");
});

test("picks a circle by its rim, not its middle", async () => {
  await loadKernel();
  const m = new Model(2);
  m.addPoint([0, 0], "ctr");
  m.addCircle("ctr", 30, null, "c");

  const rim = at([30, 0]);
  assert.equal(hitTest(m, view, rim[0], rim[1])?.name, "c");

  const middle = at([15, 0]); // inside, far from both centre and rim
  assert.equal(hitTest(m, view, middle[0], middle[1]), null, "the inside of a circle is empty space");
});

test("an arc is only pickable within its own sweep", async () => {
  await loadKernel();
  const m = new Model(2);
  m.addPoint([0, 0], "ctr");
  m.addPoint([30, 0], "s");
  m.addPoint([0, 30], "e");
  m.addArc("ctr", "s", "e", 30, null, "arc"); // the quarter from +x round to +y

  const inside = at([30 * Math.cos(Math.PI / 4), 30 * Math.sin(Math.PI / 4)]);
  assert.equal(hitTest(m, view, inside[0], inside[1])?.name, "arc", "within the sweep");

  const outside = at([-30 * Math.cos(Math.PI / 4), -30 * Math.sin(Math.PI / 4)]);
  assert.equal(hitTest(m, view, outside[0], outside[1]), null,
    "the rest of the circle the arc lies on is not the arc");
});

test("the pick tolerance is in screen pixels, so it survives zooming", async () => {
  const m = new Model(2);
  m.addPoint([100, 100], "a");
  for (const scale of [0.5, 3, 40]) {
    const v: View = { ox: 400, oy: 300, scale };
    const [sx, sy] = worldToScreen(v, [100, 100]);
    assert.ok(hitTest(m, v, sx + PICK_POINT - 2, sy), `just inside the radius at scale ${scale}`);
    assert.equal(hitTest(m, v, sx + PICK_POINT + 3, sy), null, `just outside it at scale ${scale}`);
  }
});

test("picking follows the view when it pans", async () => {
  const m = new Model(2);
  m.addPoint([0, 0], "a");
  const panned: View = { ox: 400 + 120, oy: 300 - 45, scale: 3 };
  const [sx, sy] = worldToScreen(panned, [0, 0]);
  assert.equal(hitTest(m, panned, sx, sy)?.name, "a");
  assert.equal(hitTest(m, view, sx, sy), null, "and not where it used to be");
});

test("describePick says something useful for each kind", async () => {
  await loadKernel();
  const m = new Model(2);
  m.addPoint([1.5, 2], "a");
  m.addPoint([4.5, 6], "b");
  m.addLine("a", "b", "l");
  m.addCircle("a", 7, null, "c");

  assert.equal(describePick(m, { name: "a", kind: "point", distance: 0 }), "a  1.5, 2");
  assert.equal(describePick(m, { name: "c", kind: "circle", distance: 0 }), "c  r 7");
  assert.equal(describePick(m, { name: "l", kind: "line", distance: 0 }), "l  a–b  len 5");
});

test("the hover tag names the relations constraining what is under the cursor", async () => {
  await loadKernel();
  const m = new Model(2);
  axisFrame(m); // fix and the axis references are frame-relative — see test/frames.ts
  m.addPoint([1.5, 2], "a");
  m.addPoint([4.5, 6], "b");
  m.addLine("a", "b", "l");
  fix(m, "a", [1.5, 2]);      // r1
  coincident(m, "a", "b");    // r2
  parallel(m, "l", "f.x");    // r3

  // This is the whole of the visibility story: a constraint a tool inferred on
  // your behalf now says so somewhere you will actually look.
  assert.equal(describePick(m, { name: "a", kind: "point", distance: 0 }), "a  1.5, 2  ·  r1 r2");
  assert.equal(describePick(m, { name: "l", kind: "line", distance: 0 }), "l  a–b  len 5  ·  r3");

  // ...and says nothing at all when there is nothing to say.
  m.addPoint([9, 9], "free");
  assert.equal(describePick(m, { name: "free", kind: "point", distance: 0 }), "free  9, 9");

  del(m, "r2");
  assert.equal(describePick(m, { name: "a", kind: "point", distance: 0 }), "a  1.5, 2  ·  r1");
});

// --- frames -----------------------------------------------------------------
//
// A frame is picked by its axes marker: two arms of a fixed pixel length out of
// its origin (see src/framemarker.ts). Nothing else about a frame is on screen,
// so nothing else about it can be aimed at.

/**
 * The frame's origin, off the world's — where the origin's own marker is drawn
 * and picked (docs/plans/frameless-curves.md), which this file is not about.
 */
const FO = [60, 40];

/** Origin at FO, +x along the world's, unless `deg` says otherwise. */
function framedModel(deg = 0): Model {
  const m = new Model(2);
  const rad = (deg * Math.PI) / 180;
  m.addPoint(FO, "o");
  m.addPoint([FO[0] + 20 * Math.cos(rad), FO[1] + 20 * Math.sin(rad)], "x");
  m.addFrame("o", "x", null, "fr");
  return m;
}

test("picks a frame along either arm of its axes marker", async () => {
  await loadKernel();
  const m = framedModel();
  const [ox, oy] = at(FO);

  const alongX = hitTest(m, view, ox + FRAME_ARM_PX * 0.6, oy);
  assert.equal(alongX?.name, "fr");
  assert.equal(alongX?.kind, "frame");
  // +y is up the canvas, screen y running the other way from world y.
  assert.equal(hitTest(m, view, ox, oy - FRAME_ARM_PX * 0.6)?.name, "fr");
  // Past the arm's end and still clear of the x-ref point itself, which this
  // view puts 60px out — the arm is 30, and only the direction to it matters.
  assert.equal(hitTest(m, view, ox + FRAME_ARM_PX + 10, oy), null, "past the arm's end there is nothing");
  assert.equal(hitTest(m, view, ox - 20, oy + 20), null, "and nothing behind the origin either");
});

test("a frame's arms turn with it, so a tilted frame is picked where it is drawn", async () => {
  await loadKernel();
  const m = framedModel(45);
  const [ox, oy] = at(FO);
  const d = (FRAME_ARM_PX * 0.6) / Math.SQRT2;

  assert.equal(hitTest(m, view, ox + d, oy - d)?.name, "fr", "the +x arm now runs up and to the right");
  assert.equal(hitTest(m, view, ox + FRAME_ARM_PX * 0.6, oy), null, "and no longer along the canvas's x");
});

test("the frame's own origin point still wins the pick — it is the higher tier", async () => {
  await loadKernel();
  const m = framedModel();
  const [ox, oy] = at(FO);
  assert.equal(hitTest(m, view, ox + 2, oy)?.name, "o",
    "a click on the corner of the marker grabs the point the marker is drawn from");
});

test("a frame collapsed onto its own origin draws nothing and picks as nothing", async () => {
  await loadKernel();
  const m = framedModel();
  m.setCoords("x", FO);
  const [ox, oy] = at(FO);
  assert.equal(hitTest(m, view, ox + FRAME_ARM_PX * 0.6, oy), null);
});

test("the hover tag says which frame is the default, because that is what a bare xaxis() means", async () => {
  await loadKernel();
  const m = framedModel();
  const pick = { name: "fr", kind: "frame" as const, distance: 0 };
  assert.equal(describePick(m, pick), "fr  origin o, +x toward x");
  m.setDefaultFrame("fr");
  assert.match(describePick(m, pick), /\(default\)$/);
});
