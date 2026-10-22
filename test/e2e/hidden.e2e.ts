// Hidden edges, dimmed, in a browser (docs/plans/hidden-edges.md).
//
// The rule: the drawing stays on top of the solid and still picks, snaps and
// drags as before; only the *ink* of the part of an edge behind a face changes,
// to a dimmed one. Points, names and glyphs are never dimmed.
//
// A plain sketch, with no solid, must draw exactly as it did before the pass
// existed — not "about the same": the pass is off when there are no faces. That
// is held against a picture the previous build drew of the same scene
// (`golden/hidden-plain-sketch.png`, recorded from the commit before this
// package with NEOCAD_E2E_GOLDEN_RECORD set; see `plainSketch`).
//
// Set NEOCAD_E2E_SHOTS to a directory to keep the screenshots; look at them.

import { test, after } from "node:test";
import assert from "node:assert/strict";
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { axisFrame, openApp, type AppContext } from "./harness.ts";
import { HELPERS, build, look, scene } from "./scenes.ts";

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

test("a sketch with no solid draws pixel for pixel what the previous build drew", async () => {
  const app = await fresh();
  await axisFrame(app, [-20, 45]);
  for (const src of [HELPERS, PLAIN]) {
    const r = await app.repl(src);
    assert.equal(r.ok, true, `${src}\n→ ${r.error}`);
  }
  await look(app, 0.5, 0.4, 0.3, [140, -50]);
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

/**
 * From the front, the right and above — a camera written down rather than
 * orbited, so which faces are turned away is known here: the lids, the front
 * (−y) and the right (+x) walls face the viewer; the bases, the back and the
 * left walls do not. An edge both of whose faces are turned away, and whose
 * pixel is on the solid, is behind it.
 */
const CORNER = [1, -2, 1.5];

/** Points the app's camera along −`toward`, +z as near up as it goes, fitting the scene as `look` does, and redraws. */
async function lookAlong(app: AppContext, toward: number[], fill = 0.3, shift: [number, number] = [100, -60]): Promise<void> {
  await app.page.evaluate(async ([toward, fill, dx, dy]) => {
    const viewPath = "/src/view.ts";
    const { assignView } = await import(viewPath);
    const hook = (window as never as { __neocad: {
      model: { entities: Map<string, { kind: string; name: string }>; coords(n: string): number[] };
      engine: { view: unknown }; render(): void;
    } }).__neocad;
    const unit = (v: number[]) => { const l = Math.hypot(...v); return v.map((x) => x / l); };
    const cross = (a: number[], b: number[]) => [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]];
    const dot = (a: number[], b: number[]) => a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
    const t = unit(toward);
    const right = unit(cross([0, 0, 1], t));
    const up = cross(t, right);
    const cv = document.getElementById("cv") as HTMLCanvasElement;
    const W = cv.getBoundingClientRect().width, H = cv.getBoundingClientRect().height;
    const pts = [...hook.model.entities.values()].filter((e) => e.kind === "point").map((e) => hook.model.coords(e.name));
    const c = [0, 1, 2].map((i) => (Math.min(...pts.map((p) => p[i])) + Math.max(...pts.map((p) => p[i]))) / 2);
    const r = Math.max(...pts.map((p) => Math.hypot(p[0] - c[0], p[1] - c[1], p[2] - c[2])));
    const scale = (fill * Math.min(W, H)) / r;
    // The scene's middle on the canvas's, moved by the shift.
    assignView(hook.engine.view, { scale, right, up, target: c, ox: W / 2 + dx - dot(c, right) * scale, oy: H / 2 + dy + dot(c, up) * scale });
    hook.render();
  }, [toward, fill, ...shift] as [number[], number, number, number]);
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

/**
 * The ink an edge is drawn in where it passes `world`, read off the drawing
 * canvas: of the pixels within two of its own, the most opaque — the 2D canvas
 * hands colour back unpremultiplied, so a stroke's pixel is the stroke's
 * colour however much of it the stroke covers, and the most covered is the
 * least rounded.
 */
async function inkAt(app: AppContext, world: number[]): Promise<number[]> {
  return (await patch(app, world)).reduce((best, p) => (p[3] > best[3] ? p : best));
}

/** Whether a face of a solid is drawn at `world`'s pixel — so a point on turned-away faces there is behind the solid. */
async function onSolid(app: AppContext, world: number[]): Promise<boolean> {
  const [{ face }] = await app.nearestFaces([await app.screenOf(world)]);
  return face !== null;
}

const PLAIN_EDGE = "#afc6d9";
const AMBER = "#e8a33d";
/** A frame that is not the default one. */
const OTHER_FRAME = "#7b93a8";
/** framemarker.ts's arm length, which the test's sample positions depend on. */
const FRAME_ARM_PX = 36;

test("the stepped block from a corner: its far edges are in the dimmed ink, its near ones in full, and a point behind it keeps its full dot", async () => {
  const app = await fresh();
  await build(app, scene("stepped-boss").source);
  await lookAlong(app, CORNER);
  await shot(app, "stepped-block");
  const [dim, full] = [await dimmed(app, PLAIN_EDGE), rgbOf(PLAIN_EDGE)];
  assert.ok(far(dim, full) > 40, `the dimmed ink rgb(${dim}) is not the full rgb(${full})`);
  // Behind: the base's back edge (base and back wall turned away), under both
  // steps, and the low step's back-left upright (back and left walls away).
  for (const p of [[8, 30, 0], [30, 30, 0], [0, 30, 5]]) {
    assert.ok(await onSolid(app, p), `${p} is on the solid's picture`);
    const ink = await inkAt(app, p);
    assert.ok(far(ink, dim) <= 3 && ink[3] > 150, `${p}: dimmed rgb(${dim}), got ${ink}`);
  }
  // In front: the tall step's lid along its back edge (lid toward, back away:
  // the silhouette), its right edge, and the upright where its front and right
  // walls meet.
  for (const p of [[37, 30, 20], [40, 15, 20], [40, 0, 17]]) {
    const ink = await inkAt(app, p);
    assert.ok(far(ink, full) <= 3 && ink[3] > 150, `${p}: full rgb(${full}), got ${ink}`);
  }
  // A point is never dimmed: the far bottom corner, on three turned-away
  // faces, has its dot in full ink.
  const p4 = (await app.model()).points.p4;
  assert.deepEqual(p4, [0, 30, 0]);
  assert.ok(await onSolid(app, p4), "p4 is behind the solid");
  const [sx, sy] = await app.screenOf(p4);
  assert.deepEqual(await app.pixel(Math.floor(sx) + 0.5, Math.floor(sy) + 0.5, "drawing"), [...full, 255], "p4's dot, full ink");
  assert.deepEqual(app.pageErrors, []);
});

test("a frame's arm behind a face dims like an edge; one above the solid does not", async () => {
  const app = await fresh();
  await build(app, `${scene("box").source};
    model.addFrame(P([20,15,30]), P([21,15,30]), P([20,16,30]), "g");
    model.addFrame(P([20,15,-10]), P([21,15,-10]), P([20,16,-10]), "k")`);
  await lookAlong(app, CORNER);
  await shot(app, "frames");
  // g floats over the box's lid; k sits under its base, where the box covers
  // it from this side. Neither is the default frame, so both are drawn in the
  // same colour; their +x arms, sampled most of the way out (clear of the
  // names beside their origins).
  const scale = (await app.model()).view.scale;
  const out = 0.6 * (FRAME_ARM_PX / scale);
  assert.ok(await onSolid(app, [20 + out, 15, -10]), "k's +x arm is on the box's picture");
  const above = await inkAt(app, [20 + out, 15, 30]);
  assert.ok(far(above, rgbOf(OTHER_FRAME)) <= 3, `g's +x arm: full, got ${above}`);
  const under = await inkAt(app, [20 + out, 15, -10]);
  const dim = await dimmed(app, OTHER_FRAME);
  assert.ok(far(under, dim) <= 3, `k's +x arm, under the box: dimmed rgb(${dim}), got ${under}`);
});

test("a line from in front of the block to under it: lit, amber in front and dimmed amber behind — and it picks where it is dimmed", async () => {
  const app = await fresh();
  await build(app, scene("stepped-boss").source);
  await lookAlong(app, CORNER);
  // The line the block was cut along: x = 15 on the base's plane, from y = −10
  // in front of the block to y = 40 behind it.
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
  // Picking does not know about ink: the dimmed part picks the line.
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
  const lit = await inkAt(app, along(a, b, 0.05));
  assert.ok(far(lit, rgbOf(AMBER)) <= 3, `in front: amber, got ${lit}`);
  const dimAmber = await dimmed(app, AMBER);
  const litUnder = await inkAt(app, along(a, b, 0.7));
  assert.ok(far(litUnder, dimAmber) <= 3, `under: dimmed amber rgb(${dimAmber}), got ${litUnder}`);
  assert.ok(litUnder[0] > litUnder[1] && litUnder[1] > litUnder[2], "still amber: red over green over blue");
  await shot(app, "stepped-block-lit");
});

test("the boss on a plate: the far side of the boss's foot is dimmed behind the boss, its near side and its top are not, and the plate's far edge is dimmed", async () => {
  const app = await fresh();
  await build(app, scene("boss-plate").source);
  await lookAlong(app, CORNER);
  await shot(app, "boss-plate");
  const [dim, full] = [await dimmed(app, PLAIN_EDGE), rgbOf(PLAIN_EDGE)];
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

test("with WebGL taken away the painter's fallback dims the same edges: it is the same 2D pass", async () => {
  const app = await openApp({ webgl: false });
  opened.push(app);
  assert.equal(await app.renderer(), "painter's");
  await build(app, scene("stepped-boss").source);
  await lookAlong(app, CORNER);
  const [dim, full] = [await dimmed(app, PLAIN_EDGE), rgbOf(PLAIN_EDGE)];
  // The faces are in the same canvas here, so a stroke's pixels are its ink
  // mixed with a face's fill: the pixel nearest the ink is the one to ask.
  const nearest = async (p: number[], ink: number[]) =>
    (await patch(app, p)).reduce((best, q) => (far(q, ink) < far(best, ink) ? q : best));
  for (const p of [[8, 30, 0], [30, 30, 0]]) {
    const got = await nearest(p, dim);
    assert.ok(far(got, dim) <= 12 && far(got, dim) < far(got, full), `${p}: dimmed, got ${got}`);
  }
  const got = await nearest([37, 30, 20], full);
  assert.ok(far(got, full) <= 12, `the tall step's lid edge: full, got ${got}`);
  await shot(app, "stepped-block-painter");
});

test("no uncaught page errors", () => {
  for (const a of opened) assert.deepEqual(a.pageErrors, []);
});
