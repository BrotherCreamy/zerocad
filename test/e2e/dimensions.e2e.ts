// Dimension values on the canvas, in a browser.
//
// `dist("p1","p2",50)` used to draw a ↔ and put the 50 nowhere. The story here
// is the one an Onshape user expects: dimension a rectangle, fillet a corner,
// give the arc a radius, and the drawing says `110`, `73`, `R22` — on the
// geometry, in the places a draughtsman would write them.
//
// Three of these assertions are made against the canvas bitmap rather than
// against the glyph list, deliberately. "The value is drawn" is a claim about
// pixels, and a label that reached `glyphs()` but never reached the canvas
// would pass every structural check ever written. The label text is the
// lightest thing the renderer draws (#cfe0ee against geometry's #afc6d9), so a
// very light pixel inside a label's box is the label and nothing else.

import { test, before, after } from "node:test";
import assert from "node:assert/strict";
import { openApp, sketchFrame, type AppContext } from "./harness.ts";

let app: AppContext;
before(async () => { app = await openApp(); });
after(async () => { await app.close(); });

interface GlyphInfo {
  relation: string;
  op: string;
  symbol: string;
  screen: [number, number];
  anchor: [number, number];
  highlights: string[];
  halfW: number;
  halfH: number;
  isLabel: boolean;
  ends?: [[number, number], [number, number]];
}

interface Probe {
  __neocad: {
    engine: {
      glyphs(): GlyphInfo[];
      pickAt(sx: number, sy: number): { name: string; kind: string } | null;
    };
  };
}

const glyphs = (): Promise<GlyphInfo[]> =>
  app.page.evaluate(() => (window as never as Probe).__neocad.engine.glyphs());

const pickAt = (sx: number, sy: number) =>
  app.page.evaluate(([x, y]) => (window as never as Probe).__neocad.engine.pickAt(x, y), [sx, sy]);

async function labelFor(op: string): Promise<GlyphInfo> {
  const found = (await glyphs()).find((g) => g.op === op);
  assert.ok(found, `the ${op} relation should be wearing a label`);
  return found;
}

/**
 * Whether any pixel in a patch is lighter than anything but a dimension label.
 * Geometry tops out at #afc6d9 and the generic marks at #8fa7bb; a label's text
 * is #cfe0ee, so `r > 195` is the label or nothing.
 */
async function labelInkIn(x: number, y: number, w: number, h: number): Promise<boolean> {
  return app.page.evaluate(([px, py, pw, ph]) => {
    const cv = document.getElementById("cv") as HTMLCanvasElement;
    const dpr = cv.width / cv.getBoundingClientRect().width;
    const g = cv.getContext("2d")!;
    const d = g.getImageData(Math.round(px * dpr), Math.round(py * dpr),
      Math.max(1, Math.round(pw * dpr)), Math.max(1, Math.round(ph * dpr))).data;
    for (let i = 0; i < d.length; i += 4) {
      if (d[i] > 195 && d[i + 2] > 225) return true;
    }
    return false;
  }, [x, y, w, h]);
}

async function clickAt(sx: number, sy: number): Promise<void> {
  const at = await app.at(sx, sy);
  await app.page.mouse.move(at.x, at.y);
  await app.page.mouse.down();
  await app.page.mouse.up();
  await app.page.waitForTimeout(140);
}

async function dragFromTo(from: [number, number], to: [number, number]) {
  const a = await app.at(...from);
  const b = await app.at(...to);
  await app.page.mouse.move(a.x, a.y);
  await app.page.mouse.down();
  await app.page.mouse.move(b.x, b.y, { steps: 8 });
  await app.page.mouse.up();
  await app.page.waitForTimeout(220);
}

test("a dimensioned sketch says its dimensions", async () => {
  await app.type("rectangle");
  await dragFromTo([240, 200], [560, 420]);
  await app.type('dist("p4", "p3", 110)');
  await app.type('dist("p3", "p2", 73)');
  // The fillet's arc lies in a frame's plane in the 3D app: a sketch frame,
  // parked out of the way, in the plane the rectangle was drawn in.
  await sketchFrame(app);
  await app.type('fillet("l1", "l4", 22)'); // brings its own rad("a1", 22)
  await app.type('l5 = ln("p2", pt(60, 120))');
  await app.type('ang("l1", "l5", Math.PI / 6)');
  assert.equal(await app.status(), "SOLVED");

  const drawn = (await glyphs()).map((g) => g.symbol);
  for (const want of ["110", "73", "R22", "30°"]) {
    assert.ok(drawn.includes(want), `the drawing should say ${want}; it says ${drawn.join(" ")}`);
  }
  assert.equal(drawn.includes("↔"), false, "the value replaced the mark, it did not join it");
});

test("the value is really on the canvas, where the label says it is", async () => {
  const bottom = (await glyphs()).find((g) => g.symbol === "110")!;
  const [x, y] = bottom.screen;
  assert.equal(await labelInkIn(x - bottom.halfW, y - bottom.halfH, bottom.halfW * 2, bottom.halfH * 2), true,
    "`110` should be painted inside its own box");
  // Well clear of the box, along the edge it dimensions: nothing that light.
  assert.equal(await labelInkIn(x + bottom.halfW + 20, y - 6, 12, 12), false);
});

test("the box a label is picked by is the box its text is drawn in", async () => {
  const bottom = (await glyphs()).find((g) => g.symbol === "110")!;
  const [x, y] = bottom.screen;
  assert.ok(bottom.halfW > 9, "a three-digit value needs more than a mark's 18px square");

  // The regression this guards: a hit-box frozen at the mark's size clips the
  // text, so aiming at the last digit misses the dimension entirely.
  assert.deepEqual(await pickAt(x + bottom.halfW - 2, y),
    { name: bottom.relation, kind: "relation", distance: 0 }, "the last digit is part of the label");
  const past = await pickAt(x + bottom.halfW + 4, y);
  assert.notEqual(past?.name, bottom.relation, "and past the text it is somebody else's pixel");
});

test("the browser's monospace is the width glyphs.ts assumes it is", async () => {
  // glyphs.ts sizes label boxes from GLYPH_CHAR_W because it has no canvas and
  // must not grow one. That constant is a claim about the font main.ts sets,
  // and this is the only place that can check it.
  const advance = await app.page.evaluate(() => {
    const cv = document.getElementById("cv") as HTMLCanvasElement;
    const g = cv.getContext("2d")!;
    g.font = "12px ui-monospace, Menlo, monospace";
    return g.measureText("0123456789°R.").width / 13;
  });
  assert.ok(Math.abs(advance - 7.2) < 0.25,
    `GLYPH_CHAR_W is 7.2 but the browser draws ${advance.toFixed(3)}px per character`);
});

test("clicking a dimension drops its relation's name in, like every other glyph", async () => {
  await app.page.fill("#cmd", "");
  const bottom = (await glyphs()).find((g) => g.symbol === "110")!;
  await clickAt(...bottom.screen);
  assert.equal(await app.page.inputValue("#cmd"), `"${bottom.relation}"`,
    "no second selection model, and deliberately no editing yet");
  await app.page.fill("#cmd", "");
});

test("a dist label draws witness lines across what it measures", async () => {
  const bottom = (await glyphs()).find((g) => g.symbol === "110")!;
  assert.ok(bottom.ends, "a dist label carries the span its dimension line is drawn across");
  const [a, b] = bottom.ends!;
  // The dimension line runs at the label's own level, so the label sits on it.
  const along = (bottom.screen[0] - a[0]) * (b[0] - a[0]) + (bottom.screen[1] - a[1]) * (b[1] - a[1]);
  assert.ok(along > 0 && along < (b[0] - a[0]) ** 2 + (b[1] - a[1]) ** 2,
    "the label sits between the two ends it measures, not off past one of them");
  const rad = (await glyphs()).find((g) => g.symbol === "R22")!;
  assert.equal(rad.ends, undefined, "a radius has no span, so it draws no dimension line");
});

test("a dimension follows its geometry when the drawing moves", async () => {
  const before = (await glyphs()).find((g) => g.symbol === "110")!;
  await app.type("pan(40, 25)");
  const after = (await glyphs()).find((g) => g.symbol === "110")!;
  assert.deepEqual(after.screen.map(Math.round),
    [before.screen[0] + 40, before.screen[1] + 25].map(Math.round),
    "anchors are world-space; the label is not pinned to the window");
  await app.type("pan(-40, -25)");
});

test("glyphs(false) takes the values off too — they are glyphs, not a second layer", async () => {
  const bottom = (await glyphs()).find((g) => g.symbol === "110")!;
  const [x, y] = bottom.screen;
  assert.equal((await app.repl("glyphs(false)")).value, false);
  assert.deepEqual(await glyphs(), [], "the layer is empty, values included");
  assert.equal(await labelInkIn(x - bottom.halfW, y - bottom.halfH, bottom.halfW * 2, bottom.halfH * 2), false,
    "and the number is off the canvas, not merely unpickable");

  assert.equal((await app.repl("glyphs(true)")).value, true);
  assert.equal(await labelInkIn(x - bottom.halfW, y - bottom.halfH, bottom.halfW * 2, bottom.halfH * 2), true,
    "and back on again");
});

test("deleting a dimension takes its value off the drawing", async () => {
  const bottom = (await glyphs()).find((g) => g.symbol === "110")!;
  await app.type(`del("${bottom.relation}")`);
  assert.equal((await glyphs()).find((g) => g.symbol === "110"), undefined);
  assert.equal(await labelInkIn(bottom.screen[0] - bottom.halfW, bottom.screen[1] - bottom.halfH,
    bottom.halfW * 2, bottom.halfH * 2), false, "the number is gone, and so is its dimension line");
});

test("no uncaught page errors", () => {
  assert.deepEqual(app.pageErrors, []);
});
