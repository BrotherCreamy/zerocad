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
  constrainedBy, glyphAt, placeGlyphs, GLYPH_OFFSET, GLYPH_STEP, GLYPH_HALF_W,
} from "../src/glyphs.ts";
import { worldToScreen, type View } from "../src/view.ts";
import { coincident, dist, fix, horizontal, midpoint, vertical } from "../src/relations/basic.ts";
import {
  concentric, equalLength, parallel, perpendicular, pointOnLine, radius, symmetric, tangent,
} from "../src/relations/geometry.ts";
import { del } from "../src/operations.ts";

async function loadKernel() {
  const bytes = await readFile(new URL("../src/kernel/wasm-gen/neocad_kernel_bg.wasm", import.meta.url));
  await ensureKernelLoaded(bytes);
}

const view: View = { ox: 400, oy: 300, scale: 3 };
const at = (world: number[]) => worldToScreen(view, world);

/** A rectangle-ish scaffold: two horizontal edges and one vertical. */
function scaffold(): Model {
  const m = new Model(2);
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
  assert.deepEqual(gl.highlights, ["l1"]);
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
