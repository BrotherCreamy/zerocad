// The box-select predicates: what a dragged rectangle contains, and what it
// merely touches.
//
// These are the whole of the feature's definition, one sentence each, so they
// are tested directly on screen geometry rather than through a Model — a test
// that drove them through a Model would be checking the view projection at the
// same time, and would say nothing useful when it failed. `selectInBox` is
// tested against a Model at the bottom, which is where the projection and the
// ordering belong.
//
// The case worth reading first is "a rectangle inside a circle touches
// nothing": the entity is the rim, not the disc, and every CAD gets this right
// for the same reason clicking the middle of a circle picks nothing.

import { test } from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { ensureKernelLoaded } from "../src/kernel/problem.ts";
import { Model } from "../src/model.ts";
import {
  arcBounds, boxFrom, rectContainsArc, rectContainsCircle, rectContainsPoint,
  rectContainsSegment, rectTouchesArc, rectTouchesCircle, rectTouchesSegment,
  selectInBox, type ScreenRect,
} from "../src/boxselect.ts";
import { screenAngle, type Curve, type Pt } from "../src/intersect.ts";
import { worldToScreen, type View } from "../src/view.ts";

async function loadKernel() {
  const bytes = await readFile(new URL("../src/kernel/wasm-gen/neocad_kernel_bg.wasm", import.meta.url));
  await ensureKernelLoaded(bytes);
}

/** A 100x100 box with its top-left at (100, 100). */
const box: ScreenRect = { x0: 100, y0: 100, x1: 200, y1: 200 };

/** An arc of screen radius `r` about `c`, sweeping from screen angle a0 to a1. */
function arc(c: Pt, r: number, a0: number, a1: number): Extract<Curve, { kind: "arc" }> {
  return { kind: "arc", c, r, a0, a1, slack: 0.02 };
}

// --- direction is the mode --------------------------------------------------

test("dragging right is a window, dragging left is a crossing", () => {
  assert.equal(boxFrom(10, 10, 90, 90).mode, "window");
  assert.equal(boxFrom(90, 10, 10, 90).mode, "crossing");
  // Vertical movement says nothing about the mode, in either direction.
  assert.equal(boxFrom(10, 90, 90, 10).mode, "window");
  assert.equal(boxFrom(90, 90, 10, 10).mode, "crossing");
});

test("the rectangle comes out normalised whichever way it was dragged", () => {
  assert.deepEqual(boxFrom(90, 80, 10, 20).rect, { x0: 10, y0: 20, x1: 90, y1: 80 });
  assert.deepEqual(boxFrom(10, 20, 90, 80).rect, { x0: 10, y0: 20, x1: 90, y1: 80 });
});

test("a drag with no horizontal component reads as a window, the safer half", () => {
  // A window can only ever select a subset of what a crossing would, so an
  // ambiguous gesture defaults to taking less rather than more.
  assert.equal(boxFrom(50, 10, 50, 90).mode, "window");
});

// --- points -----------------------------------------------------------------

test("a point is in the box or it is not, and the boundary counts as in", () => {
  assert.equal(rectContainsPoint(box, [150, 150]), true);
  assert.equal(rectContainsPoint(box, [250, 150]), false);
  assert.equal(rectContainsPoint(box, [100, 100]), true, "the corner is on the box");
  assert.equal(rectContainsPoint(box, [200, 150]), true, "and so is the edge");
  assert.equal(rectContainsPoint(box, [99.9, 150]), false);
});

// --- segments ---------------------------------------------------------------

test("a segment is contained only when both ends are", () => {
  assert.equal(rectContainsSegment(box, [110, 110], [190, 190]), true);
  assert.equal(rectContainsSegment(box, [110, 110], [290, 190]), false, "one end outside is not contained");
  assert.equal(rectContainsSegment(box, [10, 10], [290, 290]), false);
});

test("a segment is touched by an end inside it, or by crossing it at all", () => {
  assert.equal(rectTouchesSegment(box, [110, 110], [290, 190]), true, "one end inside");
  assert.equal(rectTouchesSegment(box, [10, 150], [290, 150]), true,
    "straight through, both ends outside — the case containment cannot see");
  assert.equal(rectTouchesSegment(box, [10, 10], [290, 290]), true, "diagonally through the corners");
  assert.equal(rectTouchesSegment(box, [10, 10], [90, 90]), false, "stops short");
  assert.equal(rectTouchesSegment(box, [10, 250], [290, 250]), false, "passes underneath");
});

test("containment implies touching, for every segment tried", () => {
  const cases: [Pt, Pt][] = [
    [[110, 110], [190, 190]], [[100, 100], [200, 200]], [[150, 101], [151, 199]],
  ];
  for (const [a, b] of cases) {
    assert.equal(rectContainsSegment(box, a, b) && !rectTouchesSegment(box, a, b), false,
      `${a}–${b} is contained but not touched, which cannot be`);
  }
});

// --- circles ----------------------------------------------------------------

test("a circle is contained when its whole extent is inside the box", () => {
  assert.equal(rectContainsCircle(box, [150, 150], 40), true);
  assert.equal(rectContainsCircle(box, [150, 150], 60), false, "the rim escapes the box");
  assert.equal(rectContainsCircle(box, [150, 150], 50), true, "exactly inscribed still counts");
  assert.equal(rectContainsCircle(box, [190, 150], 40), false, "off-centre, touching one side from outside");
});

test("a rectangle wholly inside a circle touches nothing — the rim is the entity", () => {
  // The whole box sits in the middle of a circle four times its size. There is
  // no geometry anywhere in the box: the middle of a circle is empty space,
  // exactly as it is for picking.
  assert.equal(rectTouchesCircle(box, [150, 150], 400), false);
  assert.equal(rectContainsCircle(box, [150, 150], 400), false);
});

test("a circle is touched when its rim passes through the box", () => {
  assert.equal(rectTouchesCircle(box, [150, 150], 40), true, "contained is touched");
  assert.equal(rectTouchesCircle(box, [100, 100], 60), true, "rim cuts across the corner");
  assert.equal(rectTouchesCircle(box, [0, 0], 60), false, "nowhere near");
  assert.equal(rectTouchesCircle(box, [150, 350], 60), false, "below, and short of it");
});

// --- arcs -------------------------------------------------------------------
//
// Screen angles, so y runs downward: angle 0 is the rightmost point of the
// circle, +pi/2 the bottom, -pi/2 the top. `withinSweep` runs the other way
// from screen angles, which is why these are written against the helper rather
// than by hand.

test("an arc's bounds are its own extent, not its whole circle's", () => {
  // A quarter from the rightmost point round to the top: it reaches the
  // circle's right and top extremes and neither of the other two.
  const b = arcBounds(arc([150, 150], 50, 0, -Math.PI / 2));
  assert.deepEqual(
    [b.x0, b.y0, b.x1, b.y1].map((v) => Math.round(v)),
    [150, 100, 200, 150],
    "the bounding box should hug the quarter, not the whole circle",
  );
});

test("a quarter arc is contained by a box that would not hold its circle", () => {
  const quarter = arc([150, 200], 90, 0, -Math.PI / 2); // right-to-top, centre below the box
  assert.equal(rectContainsCircle(box, [150, 200], 90), false, "the circle is far too big for the box");
  assert.equal(rectContainsArc({ x0: 140, y0: 100, x1: 250, y1: 210 }, quarter), true,
    "but the arc itself fits");
});

test("an arc is touched only where it actually sweeps", () => {
  // A circle of radius 60 about the box's centre, and an arc covering only the
  // stretch near the bottom of it. `withinSweep` runs from a0 *down* through
  // decreasing screen angle, which is why a0 is the larger of the two.
  const c: Pt = [150, 150];
  const bottomOnly = arc(c, 60, Math.PI / 2 + 0.9, Math.PI / 2 - 0.9);

  assert.equal(rectTouchesArc(box, bottomOnly), true, "the bottom of the box is where this arc is");

  // The same circle also passes through a box above the centre — and the arc
  // does not, because it never sweeps that far round.
  const above: ScreenRect = { x0: 100, y0: 60, x1: 200, y1: 120 };
  assert.equal(rectTouchesCircle(above, c, 60), true, "the whole circle reaches up into this box");
  assert.equal(rectTouchesArc(above, bottomOnly), false, "but the arc stops well short of it");
});

// --- the whole thing, over a model ------------------------------------------

test("window takes what is contained, crossing takes what is touched", async () => {
  await loadKernel();
  const m = new Model(2);
  const view: View = { ox: 400, oy: 300, scale: 3 };
  const at = (w: number[]) => worldToScreen(view, w);

  // A short edge at the origin, and a second point well off to the right with
  // an edge running out to it. A box around the origin contains the first edge
  // whole and only clips the second.
  m.addPoint([-10, 0], "a");
  m.addPoint([10, 0], "b");
  m.addPoint([100, 0], "far");
  m.addLine("a", "b", "near");
  m.addLine("b", "far", "reaching");

  const [x0, y0] = at([-20, 20]);
  const [x1, y1] = at([20, -20]);
  const rect: ScreenRect = { x0, y0: y0, x1, y1 };

  assert.deepEqual(selectInBox(m, view, rect, "window"), ["a", "b", "near"],
    "the far point and the edge reaching out to it are not contained");
  assert.deepEqual(selectInBox(m, view, rect, "crossing"), ["a", "b", "near", "reaching"],
    "crossing picks up the edge the window box only clipped");
});

test("nothing in the box selects nothing, in either mode", async () => {
  await loadKernel();
  const m = new Model(2);
  const view: View = { ox: 400, oy: 300, scale: 3 };
  m.addPoint([0, 0], "a");
  const far: ScreenRect = { x0: 700, y0: 20, x1: 800, y1: 100 };
  assert.deepEqual(selectInBox(m, view, far, "window"), []);
  assert.deepEqual(selectInBox(m, view, far, "crossing"), []);
});

test("relations are never box-selectable, because a box only sees entities", async () => {
  await loadKernel();
  const m = new Model(2);
  const view: View = { ox: 400, oy: 300, scale: 3 };
  const { axisFrame } = await import("./frames.ts");
  axisFrame(m);
  m.addPoint([0, 0], "a");
  m.addPoint([10, 0], "b");
  m.addLine("a", "b", "l");
  // A relation whose glyph would sit right in the middle of the box.
  const { horizontal } = await import("../src/relations/basic.ts");
  horizontal(m, "l");
  assert.ok(m.relations.size > 0, "the fixture really does have a relation");

  const everything: ScreenRect = { x0: 0, y0: 0, x1: 800, y1: 600 };
  const names = selectInBox(m, view, everything, "crossing");
  // The fixture frame's two points are caught like any other points, and the
  // frame itself by its axes marker — but no r-names, because glyphs are UI
  // rather than geometry, and that is what this test is about.
  assert.deepEqual(names, ["f_o", "f_x", "f", "a", "b", "l"]);
});

test("a circle selects by its rim in a real model too", async () => {
  await loadKernel();
  const m = new Model(2);
  const view: View = { ox: 400, oy: 300, scale: 3 };
  m.addPoint([0, 0], "c");
  m.addCircle("c", 40, "k"); // 120 screen pixels of radius

  // A small box at the circle's centre: inside the disc, nowhere near the rim.
  const inside: ScreenRect = { x0: 380, y0: 280, x1: 420, y1: 320 };
  assert.deepEqual(selectInBox(m, view, inside, "crossing"), ["c"], "only the centre point, not the circle");

  // A box straddling the rim.
  const onRim: ScreenRect = { x0: 500, y0: 280, x1: 560, y1: 320 };
  assert.deepEqual(selectInBox(m, view, onRim, "crossing"), ["k"]);
  assert.deepEqual(selectInBox(m, view, onRim, "window"), [], "a straddled rim is not contained");
});

test("the sweep test is the same one picking uses, applied to arc endpoints", async () => {
  await loadKernel();
  const m = new Model(2);
  const view: View = { ox: 400, oy: 300, scale: 3 };
  m.addPoint([0, 0], "c");
  m.addPoint([20, 0], "s");
  m.addPoint([0, 20], "e");
  m.addArc("c", "s", "e", 20, "arc1"); // the upper-right quarter, in world terms

  const centre = worldToScreen(view, [0, 0]);
  const upperRight: ScreenRect = { x0: centre[0], y0: centre[1] - 70, x1: centre[0] + 70, y1: centre[1] };
  assert.ok(selectInBox(m, view, upperRight, "crossing").includes("arc1"),
    "the box is exactly where this quarter arc lives");

  const lowerLeft: ScreenRect = { x0: centre[0] - 70, y0: centre[1], x1: centre[0], y1: centre[1] + 70 };
  assert.equal(selectInBox(m, view, lowerLeft, "crossing").includes("arc1"), false,
    "the opposite quarter of the same circle has no arc in it");
});

// --- frames -----------------------------------------------------------------

/** A frame at the world origin, aligned with the world's x. */
function framedModel(): Model {
  const m = new Model(2);
  m.addPoint([0, 0], "o");
  m.addPoint([20, 0], "x");
  m.addFrame("o", "x", "fr");
  return m;
}

test("a frame is boxed by its axes marker — the same extent the cursor picks", async () => {
  await loadKernel();
  const m = framedModel();
  const view: View = { ox: 400, oy: 300, scale: 3 };
  const [ox, oy] = worldToScreen(view, [0, 0]);

  // The marker reaches 30px right and 30px up out of the origin. A box round
  // exactly that contains the frame — but not the x-ref point, which this view
  // puts 60px out: a frame's arm length is drawn, not measured.
  const round: ScreenRect = { x0: ox - 5, y0: oy - 40, x1: ox + 40, y1: oy + 5 };
  assert.deepEqual(selectInBox(m, view, round, "window"), ["o", "fr"]);

  // Half the marker: touched, not contained.
  const half: ScreenRect = { x0: ox + 10, y0: oy - 5, x1: ox + 40, y1: oy + 5 };
  assert.deepEqual(selectInBox(m, view, half, "window"), [], "a clipped marker is not fully inside");
  assert.deepEqual(selectInBox(m, view, half, "crossing"), ["fr"], "but it is touched");

  const elsewhere: ScreenRect = { x0: ox + 100, y0: oy + 100, x1: ox + 200, y1: oy + 200 };
  assert.deepEqual(selectInBox(m, view, elsewhere, "crossing"), []);
});

test("a collapsed frame is inside nothing, not inside everything", async () => {
  await loadKernel();
  const m = framedModel();
  m.setCoords("x", [0, 0]); // dragged onto its own origin: no axes left to draw
  const view: View = { ox: 400, oy: 300, scale: 3 };
  const everything: ScreenRect = { x0: 0, y0: 0, x1: 800, y1: 600 };
  // The two points are still caught; the frame is not, because there is
  // nothing drawn for the box to contain. An `every` over no arms would have
  // said the opposite, which is the bug this pins.
  assert.deepEqual(selectInBox(m, view, everything, "window"), ["o", "x"]);
});

test("screenAngle and the arc curve agree about where an arc starts", () => {
  // Guards the projection in boxselect.ts against drifting from snapping's: an
  // arc's a0 is the screen angle of its start point about its centre, y-down.
  const a = arc([0, 0], 10, screenAngle(0, 0, 10, 0), screenAngle(0, 0, 0, -10));
  const b = arcBounds(a);
  assert.ok(Math.abs(b.x1 - 10) < 1e-9 && Math.abs(b.y0 + 10) < 1e-9,
    `the quarter should reach right and up: ${JSON.stringify(b)}`);
});
