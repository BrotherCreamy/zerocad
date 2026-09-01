// Constraint glyphs, in a browser, with a mouse.
//
// The story that defines the feature is the one deletion.e2e.ts tells, minus
// the part where you have to already know where to hover: two rectangles drawn
// so the second starts on the first's corner, which makes the tool infer a
// coincidence nobody typed. Now that coincidence is *drawn*. Hover it and both
// corners it joins light up; click it and its name lands in the command line;
// `del` it and the mark goes with it; Ctrl+Z and it comes back.
//
// Two of these assertions are made against the canvas bitmap rather than
// against a list, and deliberately so. "Hovering a glyph highlights the
// entities it constrains" is a claim about pixels — a `lit` set that never
// reached the renderer would pass every structural check ever written, which
// is exactly the class of bug this suite exists for.

import { test, before, after } from "node:test";
import assert from "node:assert/strict";
import { axisFrame, openApp, type AppContext } from "./harness.ts";

let app: AppContext;
before(async () => {
  app = await openApp();
  // `hor` needs a frame to be level with. Only its direction matters here, so
  // it is parked well clear of the drawing, where its two points cannot be
  // mistaken for one of the rectangle's corners by a pick.
  await axisFrame(app, [0, 400]);
});
after(async () => { await app.close(); });

interface GlyphInfo {
  relation: string;
  op: string;
  symbol: string;
  screen: [number, number];
  anchor: [number, number];
  highlights: string[];
}

interface Probe {
  __neocad: {
    model: { coords(n: string): number[]; line(n: string): { refs: [string, string] } };
    engine: {
      glyphs(): GlyphInfo[];
      pickAt(sx: number, sy: number): { name: string; kind: string } | null;
      worldToScreen(w: number[]): [number, number];
      hover: { name: string; kind: string } | null;
    };
  };
}

const glyphs = (): Promise<GlyphInfo[]> =>
  app.page.evaluate(() => (window as never as Probe).__neocad.engine.glyphs());

const pickAt = (sx: number, sy: number) =>
  app.page.evaluate(([x, y]) => (window as never as Probe).__neocad.engine.pickAt(x, y), [sx, sy]);

/** Canvas-relative screen position of a point, as the app itself computes it. */
const screenOf = (name: string): Promise<[number, number]> =>
  app.page.evaluate((n) => {
    const { model, engine } = (window as never as Probe).__neocad;
    return engine.worldToScreen(model.coords(n));
  }, name);

/**
 * Whether anything in a small patch of the canvas is drawn in the highlight
 * amber (#e8a33d). Nothing else the renderer uses comes close — the geometry is
 * pale blue, the glyph text slate, the grid nearly black — so a hit here means
 * the highlight really reached the pixels.
 */
async function amberIn(x: number, y: number, w: number, h: number): Promise<boolean> {
  return app.page.evaluate(([px, py, pw, ph]) => {
    const cv = document.getElementById("cv") as HTMLCanvasElement;
    const dpr = cv.width / cv.getBoundingClientRect().width;
    const g = cv.getContext("2d")!;
    const d = g.getImageData(Math.round(px * dpr), Math.round(py * dpr),
      Math.max(1, Math.round(pw * dpr)), Math.max(1, Math.round(ph * dpr))).data;
    for (let i = 0; i < d.length; i += 4) {
      if (d[i] > 170 && d[i + 1] > 110 && d[i + 1] < 200 && d[i + 2] < 110) return true;
    }
    return false;
  }, [x, y, w, h]);
}

/** Moves the cursor onto a canvas position, arriving from somewhere else. */
async function hoverAt(sx: number, sy: number): Promise<void> {
  const at = await app.at(sx, sy);
  await app.page.mouse.move(at.x - 40, at.y - 40);
  await app.page.mouse.move(at.x, at.y);
  await app.page.waitForTimeout(120);
}

const hoverTag = () =>
  app.page.$eval("#hovertag", (el) => ((el as HTMLElement).hidden ? "" : el.textContent ?? ""));

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

async function undoKey(): Promise<void> {
  await app.page.fill("#cmd", ""); // the model owns Ctrl+Z only with the box empty
  await app.page.keyboard.press("Control+z");
  await app.page.waitForTimeout(220);
}

const coinGlyph = async (): Promise<GlyphInfo> => {
  const found = (await glyphs()).find((g) => g.op === "coincident");
  assert.ok(found, "the inferred coincidence should be wearing a glyph");
  return found;
};

test("a drawing wears one glyph per constraint, including the ones nobody typed", async () => {
  await app.type("rectangle");
  await dragFromTo([200, 90], [360, 210]);

  // Three pixels off the first rectangle's far corner — a miss by any exact
  // measure, and exactly the aim a hand has. The tool infers a coincidence.
  await app.type("rectangle");
  await dragFromTo([363, 207], [470, 330]);

  const all = await glyphs();
  const rels = (await app.repl("rels()")).value as string[];
  // Every relation wears a mark — counted by relation rather than by glyph,
  // because a relation that is a claim about *two* things marks both of them:
  // an intrinsic rectangle's `par` and `perp` each draw twice, on purpose, so
  // that "parallel to what?" has an answer on the canvas.
  const marked = new Set(all.map((g) => g.relation));
  assert.deepEqual([...marked].sort(), rels.map((r) => r.split(/\s+/)[0]).sort(),
    `${rels.length} relations drew marks for ${marked.size} of them`);

  const coin = await coinGlyph();
  assert.equal(coin.relation, "r4");
  assert.deepEqual(coin.highlights, ["p5", "p3"], "it is about both corners");

  // The mark sits beside the corner, not on top of it.
  const [px, py] = await screenOf("p3");
  const away = Math.hypot(coin.screen[0] - px, coin.screen[1] - py);
  assert.ok(away > 8 && away < 30, `the glyph sat ${away}px from its point`);
  assert.deepEqual(await app.repl("glyphs()").then((r) => r.value), true, "on by default");
});

test("hovering the glyph names the relation and lights up both corners", async () => {
  const coin = await coinGlyph();
  await hoverAt(...coin.screen);

  assert.deepEqual(await app.page.evaluate(() => (window as never as Probe).__neocad.engine.hover),
    { name: "r4", kind: "relation", distance: 0 });
  assert.equal(await hoverTag(), "r4  coin p5 p3",
    "the tag names the relation exactly as rels() would");

  // p3 and p5 are coincident, so "both corners" is one place on screen — and
  // that place has to actually be drawn lit. Sampled up and left of the point,
  // clear of the glyph's own amber border.
  const [px, py] = await screenOf("p3");
  assert.equal(await amberIn(px - 4, py - 4, 5, 5), true,
    "the corner the constraint is about should be highlighted");

  // ...and nothing else should be. The far corner of the same rectangle is
  // constrained by other relations, not this one.
  const [qx, qy] = await screenOf("p1");
  assert.equal(await amberIn(qx - 4, qy - 4, 5, 5), false,
    "a point this constraint says nothing about stays cold");
});

test("hovering an edge's glyph lights up that edge", async () => {
  // The rectangle tool says "rectangle" intrinsically — par, par, perp — and
  // no longer claims any edge is level, so being level is something this test
  // now asks for out loud, against the frame the fixture made.
  await app.type('hor("l1")');
  const hor = (await glyphs()).find((g) => g.op === "horizontal");
  assert.ok(hor, "the edge that was just told to be level is constrained");
  const line = hor.highlights[0];

  const [a, b] = await app.page.evaluate((n) => {
    const { model, engine } = (window as never as Probe).__neocad;
    const l = model.line(n);
    return [engine.worldToScreen(model.coords(l.refs[0])), engine.worldToScreen(model.coords(l.refs[1]))];
  }, line);
  // A quarter of the way along, which is well clear of the glyph at the middle.
  const on = [a[0] + (b[0] - a[0]) * 0.25, a[1] + (b[1] - a[1]) * 0.25];

  assert.equal(await amberIn(on[0] - 3, on[1] - 3, 7, 7), false, "cold before the hover");
  await hoverAt(...hor.screen);
  assert.equal(await hoverTag(), `${hor.relation}  hor ${line} f`);
  assert.equal(await amberIn(on[0] - 3, on[1] - 3, 7, 7), true,
    "hovering the mark should light the edge it is about, along its whole length");
});

test("clicking a glyph drops its name into the command line", async () => {
  await app.page.fill("#cmd", "");
  const coin = await coinGlyph();
  await clickAt(...coin.screen);
  assert.equal(await app.page.inputValue("#cmd"), '"r4"',
    "exactly what clicking geometry does — there is no second selection model");
  await app.page.fill("#cmd", "");
});

test("deleting the relation takes its mark off the canvas, and undo brings it back", async () => {
  const before = (await glyphs()).length;
  await app.type('del("r4")');
  const after = await glyphs();
  assert.equal(after.length, before - 1);
  assert.equal(after.find((g) => g.relation === "r4"), undefined, "the mark is gone");
  assert.equal(after.find((g) => g.op === "coincident"), undefined);

  await undoKey();
  const back = await glyphs();
  assert.equal(back.length, before);
  assert.equal((await coinGlyph()).relation, "r4", "and it is the same constraint, not a new one");
});

test("a glyph outranks a point sitting right on top of it", async () => {
  const coin = await coinGlyph();
  // Put a point exactly under the mark — the case the tier exists for. A glyph
  // you cannot click because a point wandered near it defeats the feature.
  const world = await app.page.evaluate(([x, y]) => {
    const { engine } = (window as never as Probe).__neocad as never as
      { engine: { screenToWorld(sx: number, sy: number): number[] } };
    return engine.screenToWorld(x, y);
  }, coin.screen);
  await app.type(`pt(${world[0]}, ${world[1]})`);

  const at = await pickAt(...coin.screen);
  assert.deepEqual(at, { name: "r4", kind: "relation", distance: 0 },
    "the glyph wins outright, the way a point wins over a line it sits on");

  await app.page.fill("#cmd", "");
  await clickAt(...coin.screen);
  assert.equal(await app.page.inputValue("#cmd"), '"r4"', "and a real click agrees");
  await app.page.fill("#cmd", "");
});

test("glyphs(false) empties the layer and hands the click back to the geometry", async () => {
  const coin = await coinGlyph();
  assert.equal((await app.repl("glyphs(false)")).value, false);
  assert.deepEqual(await glyphs(), [], "the layer is empty");

  const at = await pickAt(...coin.screen);
  assert.equal(at?.kind, "point", "the click lands on what is underneath");

  await app.page.fill("#cmd", "");
  await clickAt(...coin.screen);
  assert.equal(await app.page.inputValue("#cmd"), `"${at!.name}"`);
  await app.page.fill("#cmd", "");

  // Nothing amber is left on the canvas from a glyph that is no longer drawn.
  await hoverAt(...coin.screen);
  assert.equal(await amberIn(coin.screen[0] - 12, coin.screen[1] - 12, 24, 24), true,
    "the point underneath still highlights, so the canvas is being drawn");

  assert.equal((await app.repl("glyphs(true)")).value, true);
  assert.equal((await glyphs()).length > 0, true, "and back on again");
  await app.type(`del("${at!.name}")`); // tidy the probe point away
});

test("glyphs() is on help()", async () => {
  const help = (await app.repl("help()")).value as string;
  assert.match(help, /glyphs\(on\)/);
});

test("no uncaught page errors", () => {
  assert.deepEqual(app.pageErrors, []);
});
