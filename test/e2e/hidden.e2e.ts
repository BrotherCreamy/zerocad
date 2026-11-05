// Hidden edges, dimmed, in a browser (docs/plans/hidden-edges.md).
//
// The rule, now the hidden view's (`view("hidden")`; the default view is
// opaque since docs/plans/opaque-solids.md): the drawing stays on top of the
// solid and still picks, snaps and drags; only the *ink* of the part of an
// edge behind a face changes, to a dimmed one. Points, names and glyphs are
// never dimmed.
//
// A plain sketch, with no solid, must draw exactly as it did before the pass
// existed — not "about the same": the pass is off when there are no faces. That
// is held against a picture the previous build drew of the same scene
// (`golden/hidden-plain-sketch.png`, recorded from the commit before this
// package with NEOCAD_E2E_GOLDEN_RECORD set; see `plainSketch`).
//
// Since quiet geometry (docs/plans/quiet-geometry.md) the shaded view leaves a
// sketch's corners undrawn until the cursor is on them, so the picture is held
// in the hidden view, which draws everything as the build before did — the
// golden picture is unchanged, and still matches to the pixel — and the shaded
// one is held to differ from it only where the quiet rule says it must.
//
// Set NEOCAD_E2E_SHOTS to a directory to keep the screenshots; look at them.

import { test, after } from "node:test";
import assert from "node:assert/strict";
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { axisFrame, openApp, type AppContext } from "./harness.ts";
import { HELPERS, build, look, lookAlong, scene } from "./scenes.ts";

// Two scenes here are bodies of two features, which the solid kernel builds
// (docs/plans/solids-kernel.md): their dimmed edges are the kernel's. Without
// a kernel build the app draws the features' own faces instead and the
// picture is a different one, so they skip and say so, as the solids tests
// do — they failed instead, for the toolbar-groups worker, which had not
// built the kernel.
const built = existsSync(new URL("../../src/solids/smlib-gen/smlib.mjs", import.meta.url));
const skip = built ? false : "no SMLib build — run `npm run build:solids`";

const SHOTS = process.env.NEOCAD_E2E_SHOTS;
const GOLDEN = new URL("./golden/hidden-plain-sketch.png", import.meta.url).pathname;
const opened: AppContext[] = [];
after(async () => { for (const a of opened) await a.close(); });

async function fresh(): Promise<AppContext> {
  const app = await openApp();
  opened.push(app);
  return app;
}

async function shot(app: AppContext, name: string): Promise<void> {
  if (!SHOTS) return;
  mkdirSync(SHOTS, { recursive: true });
  await app.page.screenshot({ path: join(SHOTS, `hidden-${name}.png`) });
}

/**
 * A sketch with no solid and every kind of mark the entity pass draws: lines
 * held by constraints (so glyphs), a circle, an arc, points and their names, and
 * the default frame's arms — turned, so the frame's +z arm is drawn too.
 */
const PLAIN = `ls = poly([[0,0,0],[40,0,0],[40,30,0],[0,30,0]], "f");
  par(ls[0], xaxis()); perp(ls[0], ls[1]);
  c = P([60,15,0]); onplane(c, "f"); model.addCircle(c, 10, "f");
  a = P([20,-20,0]); onplane(a, "f"); model.addArc(a, null, null, 8, "f");
  solve(); refresh(); "plain"`;

/** The drawing canvas, whole, as PNG bytes — the picture the entity pass made. */
const drawingPNG = async (app: AppContext): Promise<Buffer> => Buffer.from(
  (await app.page.$eval("#cv", (el) => (el as HTMLCanvasElement).toDataURL("image/png"))).split(",")[1], "base64");

/** The plain sketch, built and turned as the golden picture was. */
async function plainSketch(app: AppContext): Promise<void> {
  await axisFrame(app, [-20, 45]);
  for (const src of [HELPERS, PLAIN]) {
    const r = await app.repl(src);
    assert.equal(r.ok, true, `${src}\n→ ${r.error}`);
  }
  await look(app, 0.5, 0.4, 0.3, [140, -50]);
}

/** Two PNGs decoded in the page, and every pixel at which they differ. */
async function differing(app: AppContext, a: Buffer, b: Buffer): Promise<{ size: string; at: [number, number][]; inked: number; scale: number }> {
  return app.page.evaluate(async ([now, then]) => {
    const decode = async (b64: string) => {
      const img = new Image();
      img.src = `data:image/png;base64,${b64}`;
      await img.decode();
      const c = document.createElement("canvas");
      [c.width, c.height] = [img.width, img.height];
      const g = c.getContext("2d", { willReadFrequently: true })!;
      g.drawImage(img, 0, 0);
      return g.getImageData(0, 0, img.width, img.height);
    };
    const [x, y] = [await decode(now), await decode(then)];
    const scale = x.width / (document.getElementById("cv") as HTMLCanvasElement).getBoundingClientRect().width;
    if (x.width !== y.width || x.height !== y.height) return { size: `${x.width}×${x.height} against ${y.width}×${y.height}`, at: [], inked: 0, scale };
    const at: [number, number][] = [];
    let inked = 0;
    for (let k = 0; k < x.data.length; k += 4) {
      if (y.data[k + 3] > 0) inked++;
      if ([0, 1, 2, 3].some((i) => x.data[k + i] !== y.data[k + i])) at.push([((k / 4) % x.width) / scale, Math.floor(k / 4 / x.width) / scale]);
    }
    return { size: "", at, inked, scale };
  }, [a.toString("base64"), b.toString("base64")]);
}

test("shaded, the plain sketch differs from the hidden view's picture only at its quiet corners — each one's dot, name and the marks anchored on it", async () => {
  const app = await fresh();
  await plainSketch(app);
  assert.equal((await app.repl('view("hidden")')).value, "hidden");
  const all = await drawingPNG(app);
  assert.equal((await app.repl('view("shaded")')).value, "shaded");
  const quiet = await drawingPNG(app);
  await shot(app, "plain-sketch-shaded");
  const diff = await differing(app, quiet, all);
  assert.equal(diff.size, "");
  // Where the rule says the picture changes, worked out here from the model:
  // every point that ends a line or an arc and is no centre — its dot (3.5 px)
  // and its name (6 px right, baseline 6 px up, 11 px monospace) — and every
  // glyph whose anchor is on such points alone, its box. A pixel of anti-
  // aliasing round each.
  const places = await app.page.evaluate(() => {
    const { model, engine } = (window as never as { __neocad: {
      model: { entities: Map<string, { kind: string; name: string; refs?: string[]; start?: string; end?: string; center?: string }>; coords(n: string): number[] };
      engine: { worldToScreen(w: number[]): [number, number]; glyphs(): { screen: [number, number]; halfW: number; halfH: number; about: string[] }[] };
    } }).__neocad;
    const ends = new Set<string>();
    const centres = new Set<string>();
    for (const e of model.entities.values()) {
      if (e.kind === "line") e.refs!.forEach((p) => ends.add(p));
      if (e.kind === "arc") [e.start!, e.end!].forEach((p) => ends.add(p));
      if (e.center) centres.add(e.center);
    }
    for (const c of centres) ends.delete(c);
    const boxes: [number, number, number, number][] = [];
    for (const p of ends) {
      const [x, y] = engine.worldToScreen(model.coords(p));
      boxes.push([x - 5, y - 5, x + 5, y + 5], [x + 5, y - 16, x + 7 + 7 * p.length, y - 3]);
    }
    for (const g of engine.glyphs()) {
      if (g.about.length && g.about.every((n) => ends.has(n))) {
        boxes.push([g.screen[0] - g.halfW - 1.5, g.screen[1] - g.halfH - 1.5, g.screen[0] + g.halfW + 1.5, g.screen[1] + g.halfH + 1.5]);
      }
    }
    return { boxes, ends: [...ends].map((p) => engine.worldToScreen(model.coords(p))) };
  });
  const outside = diff.at.filter(([x, y]) => !places.boxes.some(([x0, y0, x1, y1]) => x >= x0 && x <= x1 && y >= y0 && y <= y1));
  assert.deepEqual(outside.slice(0, 10), [], `${outside.length} pixels changed away from every quiet corner`);
  // And every quiet corner did change: its dot is gone.
  assert.ok(places.ends.length >= 6, "four corners and an arc's two ends");
  for (const [x, y] of places.ends) {
    assert.ok(diff.at.some(([px, py]) => Math.hypot(px - x, py - y) < 3), `the dot at ${Math.round(x)}, ${Math.round(y)} went`);
  }
});

test("a sketch with no solid draws pixel for pixel what the previous build drew — in the hidden view, which draws everything", async () => {
  // The canvas the picture was recorded on: 1100×768, which was the suite's
  // window less the title bar there was then. There is no title bar now, so
  // the window is asked for at that size — the drawing is what is compared.
  const app = await openApp({ viewport: { width: 1100, height: 768 } });
  opened.push(app);
  await plainSketch(app);
  assert.equal((await app.repl('view("hidden")')).value, "hidden");
  const png = await drawingPNG(app);
  await shot(app, "plain-sketch");
  if (process.env.NEOCAD_E2E_GOLDEN_RECORD) {
    writeFileSync(GOLDEN, png);
    return;
  }
  // Decoded in the page, both, so the comparison is of pixels and not of how
  // two encoders happened to compress the same ones.
  const diff = await app.page.evaluate(async ([now, then]) => {
    const decode = async (b64: string) => {
      const img = new Image();
      img.src = `data:image/png;base64,${b64}`;
      await img.decode();
      const c = document.createElement("canvas");
      [c.width, c.height] = [img.width, img.height];
      const g = c.getContext("2d", { willReadFrequently: true })!;
      g.drawImage(img, 0, 0);
      return g.getImageData(0, 0, img.width, img.height);
    };
    const [a, b] = [await decode(now), await decode(then)];
    if (a.width !== b.width || a.height !== b.height) return { size: `${a.width}×${a.height} against ${b.width}×${b.height}`, differing: -1, inked: 0 };
    let differing = 0, inked = 0;
    for (let k = 0; k < a.data.length; k += 4) {
      if (b.data[k + 3] > 0) inked++;
      if (a.data[k] !== b.data[k] || a.data[k + 1] !== b.data[k + 1] || a.data[k + 2] !== b.data[k + 2] || a.data[k + 3] !== b.data[k + 3]) differing++;
    }
    return { size: "", differing, inked };
  }, [png.toString("base64"), readFileSync(GOLDEN).toString("base64")]);
  assert.equal(diff.size, "", "the same canvas size as the recorded picture");
  assert.ok(diff.inked > 2000, `the recorded picture has a drawing in it (${diff.inked} inked pixels)`);
  assert.equal(diff.differing, 0, "not one pixel differs from the previous build's");
});

// --- solids ----------------------------------------------------------------------
//
// Every solid here is looked at in `view("hidden")` — since opaque solids
// (docs/plans/opaque-solids.md) the default view does not draw what is behind
// a face at all; this file is about the mode that draws it dimmed. The solid's
// own edges (whole profile members, twins, walls) are in its dark ink, and a
// profile member that is a *portion* of a longer line keeps the sketch's
// colour, so each sample below says which it is.

/**
 * From the front, the right and above — a camera written down rather than
 * orbited, so which faces are turned away is known here: the lids, the front
 * (−y) and the right (+x) walls face the viewer; the bases, the back and the
 * left walls do not. An edge both of whose faces are turned away, and whose
 * pixel is on the solid, is behind it.
 */
const CORNER = [1, -2, 1.5];

/** A fresh app in the hidden view, which is what this file tests. */
async function hiddenApp(options: { webgl?: boolean } = {}): Promise<AppContext> {
  const app = await openApp(options);
  opened.push(app);
  assert.equal((await app.repl('view("hidden")')).value, "hidden");
  return app;
}

/** A point along a–b, `t` of the way. */
const along = (a: number[], b: number[], t: number) => a.map((x, i) => x + t * (b[i] - x));

const rgbOf = (css: string): number[] => css.startsWith("#")
  ? [1, 3, 5].map((i) => parseInt(css.slice(i, i + 2), 16))
  : css.match(/\d+/g)!.map(Number);

/** The largest difference in any of red, green and blue. */
const far = (a: number[], b: number[]) => Math.max(...[0, 1, 2].map((i) => Math.abs(a[i] - b[i])));

/** The app's own hidden ink for a colour, as three bytes. */
const dimmed = async (app: AppContext, css: string): Promise<number[]> =>
  rgbOf(await app.page.evaluate(async (c) => {
    const path = "/src/occlusion.ts";
    return (await import(path)).hiddenInk(c) as string;
  }, css));

/** The nearby pixels of the drawing canvas, two each way of `world`'s. */
async function patch(app: AppContext, world: number[]): Promise<number[][]> {
  const [x, y] = await app.screenOf(world);
  const at: [number, number][] = [];
  for (let dy = -2; dy <= 2; dy++) for (let dx = -2; dx <= 2; dx++) at.push([x + dx, y + dy]);
  return app.pixels("drawing", at);
}

/** main.ts's casing: the background's colour, under every light mark drawn in full where faces are. */
const CASING = [10, 14, 19];

/**
 * The ink an edge is drawn in where it passes `world`, read off the drawing
 * canvas: of the pixels within two of its own, the most opaque that is not a
 * casing — the 2D canvas hands colour back unpremultiplied, so a stroke's
 * pixel over nothing is the stroke's colour however much of it the stroke
 * covers. Right for a stroke drawn over nothing: a hidden run (never cased) or
 * the solid's dark edge (never cased).
 */
async function inkAt(app: AppContext, world: number[]): Promise<number[]> {
  return (await patch(app, world)).filter((p) => far(p, CASING) > 6)
    .reduce((best, p) => (p[3] > best[3] ? p : best), [0, 0, 0, 0]);
}

/**
 * Whether a light mark is drawn in full `ink` near `world`, over its casing: a
 * pixel there is the ink laid over the casing by how much the stroke covers
 * it, so some pixel must sit on the line from the casing to the ink, most of
 * the way to the ink.
 */
async function casedInk(app: AppContext, world: number[], ink: number[]): Promise<boolean> {
  const d = [0, 1, 2].map((i) => ink[i] - CASING[i]);
  const dd = d.reduce((s, v) => s + v * v, 0);
  return (await patch(app, world)).some((p) => {
    if (p[3] < 200) return false;
    const a = [0, 1, 2].reduce((s, i) => s + (p[i] - CASING[i]) * d[i], 0) / dd;
    const off = Math.max(...[0, 1, 2].map((i) => Math.abs(p[i] - CASING[i] - a * d[i])));
    return a > 0.6 && off <= 6;
  });
}

/** Whether a face of a solid is drawn at `world`'s pixel — so a point on turned-away faces there is behind the solid. */
async function onSolid(app: AppContext, world: number[]): Promise<boolean> {
  const [{ face }] = await app.nearestFaces([await app.screenOf(world)]);
  return face !== null;
}

const PLAIN_EDGE = "#afc6d9";
const AMBER = "#e8a33d";
/**
 * A frame's +x arm, which is what the frame test samples: red, every frame's
 * alike (docs/plans/tooltips-rgb-frames.md) — the default is told by weight.
 */
const X_ARM = "#ee6040";
/** framemarker.ts's arm length, which the test's sample positions depend on. */
const FRAME_ARM_PX = 36;

/** The app's solid edge ink, read from the module that defines it. */
const solidInk = async (app: AppContext): Promise<string> => app.page.evaluate(async () => {
  const path = "/src/faces.ts";
  return (await import(path)).SOLID_EDGE as string;
});

test("the stepped block from a corner, hidden view: its far edges are in the dimmed ink, its near ones in full, and a point behind it keeps its full dot", { skip }, async () => {
  const app = await hiddenApp();
  await build(app, scene("stepped-boss").source);
  await lookAlong(app, CORNER);
  await shot(app, "stepped-block");
  const SOLID = await solidInk(app);
  const [dimSolid, fullSolid] = [await dimmed(app, SOLID), rgbOf(SOLID)];
  const dimPlain = await dimmed(app, PLAIN_EDGE);
  assert.ok(far(dimSolid, fullSolid) > 25, `the dimmed solid ink rgb(${dimSolid}) is not the full rgb(${fullSolid})`);
  assert.ok(far(dimPlain, rgbOf(PLAIN_EDGE)) > 40, `the dimmed sketch ink rgb(${dimPlain}) is not the full one`);
  // Behind: the base's back edge (base and back wall turned away), under both
  // steps — a portion of the rectangle's back line, which the cut at x = 15
  // split, so in the sketch's colour — and the low step's back-left upright
  // (back and left walls away), a wall, in the solid's.
  //
  // The back line is also the base cap's edge, so the face layer's dimmed
  // solid line runs under the sketch's there: of the two, the most opaque
  // pixel in the patch is a coin toss on anti-aliasing (measured: the sketch
  // stroke's core went from alpha 255 to 251 when the lids lost their frame,
  // and the solid's 255 won). What the test means is that the sketch's dimmed
  // ink is drawn there, in full, so that is what is asked of the two portions.
  for (const p of [[8, 30, 0], [30, 30, 0]]) {
    assert.ok(await onSolid(app, p), `${p} is on the solid's picture`);
    const drawn = (await patch(app, p)).filter((px) => far(px, dimPlain) <= 3 && px[3] > 150);
    assert.ok(drawn.length > 0, `${p}: dimmed rgb(${dimPlain}) drawn: ${JSON.stringify(await patch(app, p))}`);
  }
  for (const [p, dim] of [[[0, 30, 5], dimSolid]] as [number[], number[]][]) {
    assert.ok(await onSolid(app, p), `${p} is on the solid's picture`);
    const ink = await inkAt(app, p);
    assert.ok(far(ink, dim) <= 3 && ink[3] > 150, `${p}: dimmed rgb(${dim}), got ${ink}`);
  }
  // In front: the tall step's lid along its back edge (lid toward, back away:
  // the silhouette) and its right edge — twins — and the upright where its
  // front and right walls meet, a wall: all the solid's own, in its dark ink.
  for (const p of [[37, 30, 20], [40, 15, 20], [40, 0, 17]]) {
    const ink = await inkAt(app, p);
    assert.ok(far(ink, fullSolid) <= 3 && ink[3] > 150, `${p}: full rgb(${fullSolid}), got ${ink}`);
  }
  // A point is never dimmed: the far bottom corner, on three turned-away
  // faces, has its dot in full ink.
  const p4 = (await app.model()).points.p4;
  assert.deepEqual(p4, [0, 30, 0]);
  assert.ok(await onSolid(app, p4), "p4 is behind the solid");
  const [sx, sy] = await app.screenOf(p4);
  assert.deepEqual(await app.pixel(Math.floor(sx) + 0.5, Math.floor(sy) + 0.5, "drawing"), [...rgbOf(PLAIN_EDGE), 255], "p4's dot, full ink");
  assert.deepEqual(app.pageErrors, []);
});

test("hidden view: a frame's arm behind a face dims like an edge; one above the solid does not", async () => {
  const app = await hiddenApp();
  await build(app, `${scene("box").source};
    model.addFrame(P([20,15,30]), P([21,15,30]), P([20,16,30]), "g");
    model.addFrame(P([20,15,-10]), P([21,15,-10]), P([20,16,-10]), "k")`);
  await lookAlong(app, CORNER);
  await shot(app, "frames");
  // g floats over the box's lid; k sits under its base, where the box covers
  // it from this side. Every frame's +x arm is drawn in the same red; theirs
  // are sampled most of the way out (clear of the names beside their origins).
  const scale = (await app.model()).view.scale;
  const out = 0.6 * (FRAME_ARM_PX / scale);
  assert.ok(await onSolid(app, [20 + out, 15, -10]), "k's +x arm is on the box's picture");
  assert.ok(await casedInk(app, [20 + out, 15, 30], rgbOf(X_ARM)), "g's +x arm: full, over its casing");
  const under = await inkAt(app, [20 + out, 15, -10]);
  const dim = await dimmed(app, X_ARM);
  assert.ok(far(dim, rgbOf(X_ARM)) > 25, `the dimmed frame ink rgb(${dim}) is not the full one`);
  assert.ok(far(under, dim) <= 3, `k's +x arm, under the box: dimmed rgb(${dim}), got ${under}`);
});

test("hidden view: a line from in front of the block to under it: lit, amber in front and dimmed amber behind — and it picks where it is dimmed", async () => {
  const app = await hiddenApp();
  await build(app, scene("stepped-boss").source);
  await lookAlong(app, CORNER);
  // The line the block was cut along: x = 15 on the base's plane, from y = −10
  // in front of the block to y = 40 behind it. A portion of it bounds each
  // step, so it keeps the sketch's colour.
  const m = await app.model();
  const cut = m.lines.find((l) => {
    const [a, b] = l.refs.map((n) => m.points[n]);
    return a[0] === 15 && b[0] === 15 && a[1] === -10 && b[1] === 40;
  });
  assert.ok(cut, "the cut line");
  const [a, b] = [[15, -10, 0], [15, 40, 0]];
  // Three-quarters of the way along: under the block, and clear on screen of
  // the boss's circles, which a pick there would rather take.
  const under = along(a, b, 0.75);
  assert.ok(await onSolid(app, under), "three-quarters along, it is under the block");
  assert.ok(far(await inkAt(app, under), await dimmed(app, PLAIN_EDGE)) <= 3, "unlit, dimmed under the block");
  // The hidden view keeps everything aimable: the dimmed part picks the line.
  const [ux, uy] = await app.screenOf(under);
  const picked = await app.page.evaluate(([x, y]) => (window as never as {
    __neocad: { engine: { pickAt(x: number, y: number): { name: string } | null } };
  }).__neocad.engine.pickAt(x, y), [ux, uy]);
  assert.equal(picked?.name, cut!.name, "the dimmed run picks its line");
  // Hovered there, the whole line lights: amber in front, dimmed amber under.
  const pt = await app.at(ux, uy);
  await app.page.mouse.move(pt.x - 30, pt.y - 30);
  await app.page.mouse.move(pt.x, pt.y);
  await app.page.waitForTimeout(150);
  assert.equal((await app.repl("hover()")).value, cut!.name, "hovering it");
  assert.ok(await casedInk(app, along(a, b, 0.05), rgbOf(AMBER)), "in front: amber, over its casing");
  const dimAmber = await dimmed(app, AMBER);
  const litUnder = await inkAt(app, along(a, b, 0.7));
  assert.ok(far(litUnder, dimAmber) <= 3, `under: dimmed amber rgb(${dimAmber}), got ${litUnder}`);
  assert.ok(litUnder[0] > litUnder[1] && litUnder[1] > litUnder[2], "still amber: red over green over blue");
  await shot(app, "stepped-block-lit");
});

test("hidden view, the boss on a plate: the far side of the boss's foot is dimmed behind the boss, its near side and its top are not, and the plate's far edge is dimmed", { skip }, async () => {
  const app = await hiddenApp();
  await build(app, scene("boss-plate").source);
  await lookAlong(app, CORNER);
  await shot(app, "boss-plate");
  // Every edge sampled is the solids' own — the boss's profile circle and its
  // twin, the plate's profile — so in the solid's ink.
  const SOLID = await solidInk(app);
  const [dim, full] = [await dimmed(app, SOLID), rgbOf(SOLID)];
  // The boss: r 10 about (30, 20), standing on the plate's lid at z = 8, 15
  // high. Points of its circles `deg` round from straight away from the
  // viewer — not straight away, where its height's label sits.
  const away = [-1, 2].map((c) => c / Math.hypot(1, 2));
  const at = (deg: number, z: number) => {
    const t = (deg * Math.PI) / 180;
    const [u, v] = [Math.cos(t), Math.sin(t)];
    return [30 + 10 * (u * away[0] + v * away[1]), 20 + 10 * (u * away[1] - v * away[0]), z];
  };
  for (const deg of [-60, 60]) {
    assert.ok(far(await inkAt(app, at(deg, 8)), dim) <= 3, `the foot circle's far side (${deg}°), behind the boss`);
    assert.ok(far(await inkAt(app, at(deg, 23)), full) <= 3, `the top circle's far side (${deg}°): nothing over it`);
  }
  assert.ok(far(await inkAt(app, at(180, 8)), full) <= 3, "the foot circle's near side");
  assert.ok(far(await inkAt(app, [50, 40, 0]), dim) <= 3, "the plate's back-bottom edge");
});

test("with WebGL taken away the painter's fallback dims the same edges in the hidden view: it is the same 2D pass", async () => {
  const app = await hiddenApp({ webgl: false });
  assert.equal(await app.renderer(), "painter's");
  await build(app, scene("stepped-boss").source);
  await lookAlong(app, CORNER);
  const [dim, full] = [await dimmed(app, PLAIN_EDGE), rgbOf(await solidInk(app))];
  // The faces are in the same canvas here, so a stroke's pixels are its ink
  // mixed with a face's fill: the pixel nearest the ink is the one to ask.
  const nearest = async (p: number[], ink: number[]) =>
    (await patch(app, p)).reduce((best, q) => (far(q, ink) < far(best, ink) ? q : best));
  for (const p of [[8, 30, 0], [30, 30, 0]]) {
    const got = await nearest(p, dim);
    assert.ok(far(got, dim) <= 12 && far(got, dim) < far(got, rgbOf(PLAIN_EDGE)), `${p}: dimmed, got ${got}`);
  }
  const got = await nearest([37, 30, 20], full);
  assert.ok(far(got, full) <= 12, `the tall step's lid edge: full, got ${got}`);
  await shot(app, "stepped-block-painter");
});

test("no uncaught page errors", () => {
  for (const a of opened) assert.deepEqual(a.pageErrors, []);
});
