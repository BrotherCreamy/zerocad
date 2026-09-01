// Placement, which is the whole of what src/glyphs.ts decides.
//
// The interesting claims are all geometric and none of them need a canvas:
// which anchor a relation kind picks, that the offset from that anchor is
// measured in *screen* pixels and therefore survives a zoom, that glyphs
// sharing an anchor stack instead of piling up, and that the pick region is a
// box around the mark rather than around the geometry it is describing.

import { test } from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { ensureKernelLoaded } from "../src/kernel/problem.ts";
import { Model } from "../src/model.ts";
import {
  constrainedBy, formatValue, glyphAt, labelFor, placeGlyphs,
  GLYPH_CHAR_W, GLYPH_OFFSET, GLYPH_STEP, GLYPH_HALF_W,
} from "../src/glyphs.ts";
import { worldToScreen, type View } from "../src/view.ts";
import { coincident, dist, fix, horizontal, midpoint, vertical } from "../src/relations/basic.ts";
import {
  angle, concentric, equalLength, parallel, perpendicular, pointOnLine, radius, symmetric, tangent,
} from "../src/relations/geometry.ts";
import { del } from "../src/operations.ts";
import { axisFrame } from "./frames.ts";

async function loadKernel() {
  const bytes = await readFile(new URL("../src/kernel/wasm-gen/neocad_kernel_bg.wasm", import.meta.url));
  await ensureKernelLoaded(bytes);
}

const view: View = { ox: 400, oy: 300, scale: 3 };
const at = (world: number[]) => worldToScreen(view, world);

/** A rectangle-ish scaffold: two horizontal edges and one vertical. */
function scaffold(): Model {
  const m = new Model(2);
  axisFrame(m); // what hor/ver are level with — see test/frames.ts
  m.addPoint([0, 0], "p1");
  m.addPoint([40, 0], "p2");
  m.addPoint([40, 30], "p3");
  m.addPoint([0, 30], "p4");
  m.addLine("p1", "p2", "l1"); // bottom
  m.addLine("p3", "p4", "l2"); // top
  m.addLine("p2", "p3", "l3"); // right
  return m;
}

const byRelation = (m: Model, v: View) =>
  new Map(placeGlyphs(m, v).map((g) => [g.relation, g]));

test("one glyph per relation, carrying the relation's name and a mark", () => {
  const m = scaffold();
  const r = horizontal(m, "l1");
  const [gl] = placeGlyphs(m, view);
  assert.equal(gl.relation, r);
  assert.equal(gl.op, "horizontal");
  assert.equal(gl.symbol.length > 0, true, "something is actually drawn");
  // The frame is one of the things the relation is *about* — "level with f" —
  // so hovering the mark lights it up alongside the edge.
  assert.deepEqual(gl.highlights, ["l1", "f"]);
});

test("a point relation anchors on its point; an edge relation on the edge's middle", () => {
  const m = scaffold();
  const rc = coincident(m, "p1", "p3");
  const rh = horizontal(m, "l1");
  const g = byRelation(m, view);

  assert.deepEqual(g.get(rc)!.anchor, at([0, 0]), "the constrained point itself");
  assert.deepEqual(g.get(rh)!.anchor, at([20, 0]), "the midpoint of l1");
});

test("the offset from the anchor is a constant pixel distance at any zoom", () => {
  const m = scaffold();
  horizontal(m, "l1");
  coincident(m, "p1", "p3");

  for (const scale of [0.4, 3, 90]) {
    const v: View = { ox: 400, oy: 300, scale };
    for (const gl of placeGlyphs(m, v)) {
      const away = Math.hypot(gl.screen[0] - gl.anchor[0], gl.screen[1] - gl.anchor[1]);
      assert.ok(Math.abs(away - GLYPH_OFFSET) < 1e-9,
        `at scale ${scale} the glyph sat ${away}px from its anchor, not ${GLYPH_OFFSET}`);
    }
  }
});

test("the anchor itself is world-space, so it follows the drawing", () => {
  const m = scaffold();
  horizontal(m, "l1");
  const before = placeGlyphs(m, view)[0].anchor;
  m.setCoords("p2", [40, 20]); // the edge tilts, so its middle moves
  const after = placeGlyphs(m, view)[0].anchor;
  assert.deepEqual(after, at([20, 10]));
  assert.notDeepEqual(after, before);
});

test("glyphs sharing an anchor stack in a row rather than piling up", () => {
  const m = scaffold();
  coincident(m, "p1", "p2");
  coincident(m, "p1", "p3");
  fix(m, "p1", [0, 0]);
  const [a, b, c] = placeGlyphs(m, view);

  assert.deepEqual([a.anchor, b.anchor, c.anchor], [at([0, 0]), at([0, 0]), at([0, 0])]);
  assert.equal(a.screen[1], b.screen[1], "a row, so they share a y");
  assert.equal(b.screen[1], c.screen[1]);
  assert.ok(Math.abs(b.screen[0] - a.screen[0] - GLYPH_STEP) < 1e-9, "stepped apart");
  assert.ok(Math.abs(c.screen[0] - b.screen[0] - GLYPH_STEP) < 1e-9);
});

test("relations on different anchors are left where they are", () => {
  const m = scaffold();
  const h1 = horizontal(m, "l1");
  const h2 = horizontal(m, "l2");
  const g = byRelation(m, view);
  assert.deepEqual(g.get(h1)!.anchor, at([20, 0]));
  assert.deepEqual(g.get(h2)!.anchor, at([20, 30]));
  assert.notDeepEqual(g.get(h1)!.screen, g.get(h2)!.screen);
});

test("a relation about two lines gets a mark on each of them", () => {
  const m = scaffold();
  const rp = perpendicular(m, "l1", "l3");
  const marks = placeGlyphs(m, view).filter((gl) => gl.relation === rp);
  assert.equal(marks.length, 2, "one glyph per line — which two lines is the thing worth seeing");
  assert.deepEqual(marks.map((mk) => mk.anchor), [at([20, 0]), at([40, 15])]);
  assert.deepEqual(marks[0].highlights, ["l1", "l3"], "and both light up from either mark");
});

test("parallel, equal length and symmetric are two-mark relations too", () => {
  const m = scaffold();
  const rp = parallel(m, "l1", "l2");
  const re = equalLength(m, "l1", "l2");
  const rs = symmetric(m, "p1", "p2", "l3");
  const all = placeGlyphs(m, view);
  for (const [name, n] of [[rp, 2], [re, 2], [rs, 2]] as const) {
    assert.equal(all.filter((gl) => gl.relation === name).length, n, `${name} should have ${n} marks`);
  }
});

test("the glyph sits beside an edge, not along it", () => {
  const m = scaffold();
  horizontal(m, "l1"); // a level edge, so "beside" means above or below
  const gl = placeGlyphs(m, view)[0];
  assert.equal(gl.screen[0], gl.anchor[0], "not shifted along the edge");
  assert.ok(Math.abs(gl.screen[1] - gl.anchor[1]) === GLYPH_OFFSET, "shifted across it");
});

test("hor/ver in their two-point form anchor between the two points", () => {
  const m = scaffold();
  const rh = horizontal(m, "p1", "p3");
  const rv = vertical(m, "p2", "p4");
  const g = byRelation(m, view);
  assert.deepEqual(g.get(rh)!.anchor, at([20, 15]));
  assert.deepEqual(g.get(rv)!.anchor, at([20, 15]));
});

test("dist anchors between its two points; midpoint on the point it defines", () => {
  const m = scaffold();
  const rd = dist(m, "p1", "p2", 40);
  const rm = midpoint(m, "p4", "l1");
  const g = byRelation(m, view);
  assert.deepEqual(g.get(rd)!.anchor, at([20, 0]));
  assert.deepEqual(g.get(rm)!.anchor, at([0, 30]), "the point being constrained, not the edge");
});

test("circle relations anchor on the rim, and concentric on the shared centre", async () => {
  await loadKernel();
  const m = new Model(2);
  m.addPoint([0, 0], "ctr");
  m.addPoint([0, 0], "ctr2");
  m.addPoint([50, 0], "a");
  m.addPoint([50, 40], "b");
  m.addLine("a", "b", "l");
  m.addCircle("ctr", 20, "c1");
  m.addCircle("ctr2", 30, "c2");

  const rr = radius(m, "c1", 20);
  const rc = concentric(m, "c1", "c2");
  const rt = tangent(m, "l", "c1");
  const g = byRelation(m, view);

  const rim = at([20 * Math.SQRT1_2, 20 * Math.SQRT1_2]);
  assert.deepEqual(g.get(rr)!.anchor.map(Math.round), rim.map(Math.round), "upper right of the rim");
  assert.deepEqual(g.get(rc)!.anchor, at([0, 0]), "the centre the two share");
  // The line is vertical at x = 50, so the nearest rim point is due +x.
  assert.deepEqual(g.get(rt)!.anchor.map(Math.round), at([20, 0]).map(Math.round));
});

test("a point-on-curve relation anchors on the point, not the curve", async () => {
  await loadKernel();
  const m = scaffold();
  const r = pointOnLine(m, "p4", "l1");
  assert.deepEqual(placeGlyphs(m, view)[0].anchor, at([0, 30]));
  assert.deepEqual(constrainedBy(m, r), ["p4", "l1"], "but both are what it constrains");
});

test("a relation the glyph table has never heard of still gets a mark", () => {
  const m = scaffold();
  // What a relation authored at the command line looks like: an op nothing in
  // src/ knows, journalled and named like any other.
  const r = m.relation("wobble", ["l3"], () => {
    m.addResidual([m.point("p2").varIndices[0]], (l) => [l[0].sub(40)], "wobble");
  });
  const gl = placeGlyphs(m, view)[0];
  assert.equal(gl.relation, r);
  assert.deepEqual(gl.anchor, at([40, 15]), "anchored on the entity it names");
  assert.equal(gl.symbol, "w");
});

test("a relation naming nothing the model still holds draws nothing, and does not throw", () => {
  const m = scaffold();
  const r = m.relation("mystery", [7], () => {
    m.addResidual([m.point("p1").varIndices[0]], (l) => [l[0].sub(0)], "mystery");
  });
  assert.equal(placeGlyphs(m, view).find((gl) => gl.relation === r), undefined);
});

test("deleting a relation takes its glyph with it", () => {
  const m = scaffold();
  const r = horizontal(m, "l1");
  horizontal(m, "l2");
  assert.equal(placeGlyphs(m, view).length, 2);
  del(m, r);
  const left = placeGlyphs(m, view);
  assert.equal(left.length, 1);
  assert.notEqual(left[0].relation, r);
});

test("glyphs are picked by their own box, wherever the geometry is", () => {
  const m = scaffold();
  horizontal(m, "l1");
  const gl = placeGlyphs(m, view)[0];
  const [gx, gy] = gl.screen;

  assert.equal(glyphAt([gl], gx, gy)?.relation, gl.relation);
  assert.equal(glyphAt([gl], gx + GLYPH_HALF_W - 1, gy)?.relation, gl.relation, "just inside");
  assert.equal(glyphAt([gl], gx + GLYPH_HALF_W + 2, gy), null, "just outside");
  assert.equal(glyphAt([gl], gl.anchor[0], gl.anchor[1]), null,
    "the geometry it describes is not part of the glyph");
});

test("the nearest glyph wins when two boxes overlap", () => {
  const m = scaffold();
  coincident(m, "p1", "p2");
  coincident(m, "p1", "p3");
  const [a, b] = placeGlyphs(m, view);
  // GLYPH_STEP is smaller than the box width, so the two boxes do overlap.
  const between = (a.screen[0] + b.screen[0]) / 2;
  assert.equal(glyphAt([a, b], between - 2, a.screen[1])?.relation, a.relation);
  assert.equal(glyphAt([a, b], between + 2, a.screen[1])?.relation, b.relation);
});

// --- dimension labels ------------------------------------------------------
// The three dimensioned relations draw their *value* in place of a mark, which
// is what makes a sketch read like an Onshape sketch rather than like a
// diagram of its own constraints. Everything below is about that number: how
// it is written, where it goes, and the box it is clicked by.

test("a dimension's value is written the way it was typed, not to six decimals", () => {
  assert.equal(formatValue(50), "50", "not 50.000 — a dimension is an intent, not a measurement");
  assert.equal(formatValue(120.5), "120.5");
  assert.equal(formatValue(12.3456), "12.346", "three decimals when they are real");
  assert.equal(formatValue(0.0001), "0", "and rounded away when they are not");
  assert.equal(formatValue(-3.5), "-3.5");
  assert.equal(formatValue(NaN), "?", "a renderer must draw something rather than NaN");
});

test("dist, rad and ang label themselves; nothing else does", () => {
  assert.equal(labelFor("dist", ["p1", "p2", 50]), "50");
  assert.equal(labelFor("radius", ["c1", 12]), "R12", "Onshape's prefix");
  assert.equal(labelFor("angle", ["l1", "l2", Math.PI / 6]), "30°",
    "the relation stores radians; a drawing says degrees");
  assert.equal(labelFor("angle", ["l1", "l2", Math.PI]), "180°");
  assert.equal(labelFor("coincident", ["p1", "p2"]), null);
  assert.equal(labelFor("horizontal", ["l1"]), null);
});

test("a dimensioned relation with a non-numeric target falls back to its mark", () => {
  // A hand-edited file, or a user-defined op that happens to be called `dist`.
  // Drawing `RNaN` would be worse than drawing the generic symbol.
  assert.equal(labelFor("dist", ["p1", "p2", "fifty"]), null);
  assert.equal(labelFor("radius", ["c1"]), null);
  const m = scaffold();
  m.relation("dist", ["p1", "p2", "fifty"], () => {
    m.addResidual([m.point("p1").varIndices[0]], (l) => [l[0].sub(0)], "odd");
  });
  const gl = placeGlyphs(m, view)[0];
  assert.equal(gl.symbol, "↔");
  assert.equal(gl.isLabel, false);
});

test("dist draws its number midway along the span, offset across it", () => {
  const m = scaffold();
  const r = dist(m, "p1", "p2", 50);
  const gl = placeGlyphs(m, view).find((g) => g.relation === r)!;

  assert.equal(gl.symbol, "50", "the value, where the ↔ used to be");
  assert.equal(gl.isLabel, true);
  assert.deepEqual(gl.anchor, at([20, 0]), "midway between the two points");
  assert.equal(gl.screen[0], gl.anchor[0], "not shifted along the span");
  assert.equal(Math.abs(gl.screen[1] - gl.anchor[1]), GLYPH_OFFSET, "across it");
});

test("rad draws R-and-its-number just outside the rim, up and to the right", async () => {
  await loadKernel();
  const m = new Model(2);
  m.addPoint([0, 0], "ctr");
  m.addCircle("ctr", 20, "c1");
  const r = radius(m, "c1", 12.5);
  const gl = placeGlyphs(m, view).find((g) => g.relation === r)!;

  assert.equal(gl.symbol, "R12.5");
  const rim = at([20 * Math.SQRT1_2, 20 * Math.SQRT1_2]);
  assert.deepEqual(gl.anchor.map(Math.round), rim.map(Math.round));
  const ctr = at([0, 0]);
  assert.ok(Math.hypot(gl.screen[0] - ctr[0], gl.screen[1] - ctr[1])
    > Math.hypot(gl.anchor[0] - ctr[0], gl.anchor[1] - ctr[1]), "outside the rim, not inside it");
  assert.ok(gl.screen[0] > gl.anchor[0] && gl.screen[1] < gl.anchor[1], "up and to the right");
});

test("ang draws its degrees at the corner the two lines share, inside the angle", () => {
  const m = new Model(2);
  m.addPoint([0, 0], "v");
  m.addPoint([40, 0], "a");
  m.addPoint([0, 40], "b");
  m.addLine("v", "a", "l1");
  m.addLine("v", "b", "l2");
  const r = angle(m, "l1", "l2", Math.PI / 2);
  const marks = placeGlyphs(m, view).filter((g) => g.relation === r);

  assert.equal(marks.length, 1, "one number, not the two marks `∥` gets — it is the same number twice");
  assert.equal(marks[0].symbol, "90°");
  assert.deepEqual(marks[0].anchor, at([0, 0]), "the shared corner");
  // The wedge here opens up and to the right in world terms, so on screen the
  // label is to the right of the corner and above it.
  assert.ok(marks[0].screen[0] > marks[0].anchor[0], "into the angle, not away from it");
  assert.ok(marks[0].screen[1] < marks[0].anchor[1]);
});

test("two lines with no shared corner still get their angle, between their middles", () => {
  const m = scaffold(); // l1 along the bottom, l2 along the top, no shared point
  const r = angle(m, "l1", "l2", Math.PI / 4);
  const marks = placeGlyphs(m, view).filter((g) => g.relation === r);
  assert.equal(marks.length, 1);
  assert.deepEqual(marks[0].anchor, at([20, 15]), "midway between the two edges' middles");
});

test("the label's box is as wide as its text, and is what picks it", () => {
  const m = scaffold();
  const r = dist(m, "p1", "p2", 137.25);
  const gl = placeGlyphs(m, view).find((g) => g.relation === r)!;

  assert.equal(gl.symbol, "137.25");
  assert.ok(gl.halfW > GLYPH_HALF_W * 1.5, `"137.25" needs more than a mark's box, got ${gl.halfW}`);
  assert.ok(Math.abs(gl.halfW * 2 - (gl.symbol.length * GLYPH_CHAR_W + 10)) < 1e-9,
    "the text's own width plus a little padding");

  const [gx, gy] = gl.screen;
  assert.equal(glyphAt([gl], gx + GLYPH_HALF_W + 4, gy)?.relation, r,
    "a click on the last digit is a click on the dimension, not a miss");
  assert.equal(glyphAt([gl], gx + gl.halfW + 2, gy), null, "and past the text it is a miss");
});

test("a wide label nudged sideways clears the geometry as far as a small mark does", () => {
  const m = scaffold();
  // A vertical edge, so the nudge is horizontal and the label's width is in the
  // way. Its *near edge* should sit where a mark's near edge would.
  const rd = dist(m, "p2", "p3", 137.25);
  const gl = placeGlyphs(m, view).find((g) => g.relation === rd)!;
  const near = Math.abs(gl.screen[0] - gl.anchor[0]) - gl.halfW;
  assert.ok(Math.abs(near - (GLYPH_OFFSET - GLYPH_HALF_W)) < 1e-9,
    `the wide one should travel its extra width; its box starts ${near}px out, a mark's starts ` +
    `${GLYPH_OFFSET - GLYPH_HALF_W}px out`);
  assert.equal(gl.screen[1], gl.anchor[1], "and it is not pushed along the edge to do it");
});

test("a label and a mark sharing an anchor do not sit on top of each other", () => {
  // The failure this pins was visible in the first screenshot taken of the
  // feature: `—` (l3 is level) and `110` (l3 is 110 long) share an anchor, and
  // a row that steps by a fixed 17px drew them touching — which reads as
  // *minus* 110.
  for (const order of [0, 1]) {
    const m = scaffold();
    const rd = () => dist(m, "p1", "p2", 137.25);
    const rh = () => horizontal(m, "p1", "p2"); // same anchor, same direction
    const [first, second] = order === 0 ? [rd(), rh()] : [rh(), rd()];
    const g = byRelation(m, view);
    const [a, b] = [g.get(first)!, g.get(second)!];
    assert.equal(a.screen[1], b.screen[1], "still a row");
    assert.ok(b.screen[0] - a.screen[0] > a.halfW + b.halfW,
      `the boxes overlap: ${a.symbol} is ${a.halfW * 2}px wide, ${b.symbol} is ${b.halfW * 2}px, ` +
      `and their centres are ${b.screen[0] - a.screen[0]}px apart`);
  }
});

test("only a dist label carries the span its dimension lines are drawn across", () => {
  const m = scaffold();
  const rd = dist(m, "p1", "p2", 50);
  const rh = horizontal(m, "l1");
  const g = byRelation(m, view);
  assert.deepEqual(g.get(rd)!.ends, [at([0, 0]), at([40, 0])], "the two points, in screen pixels");
  assert.equal(g.get(rh)!.ends, undefined, "nothing else has a span to measure");
});

test("glyphs follow the view when it pans and zooms", () => {
  const m = scaffold();
  coincident(m, "p1", "p3");
  const here = placeGlyphs(m, view)[0];
  const panned: View = { ox: view.ox + 120, oy: view.oy - 45, scale: view.scale };
  const there = placeGlyphs(m, panned)[0];
  assert.deepEqual(there.screen, [here.screen[0] + 120, here.screen[1] - 45]);
  assert.equal(glyphAt(placeGlyphs(m, panned), here.screen[0], here.screen[1]), null,
    "and are no longer where they used to be");
});
