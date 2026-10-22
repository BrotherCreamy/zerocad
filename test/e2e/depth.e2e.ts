// Faces drawn by depth, in a browser (docs/plans/display-depth.md).
//
// A solid's faces are drawn by WebGL with a depth test, on a canvas of their
// own under the 2D drawing; the painter's is what is left where the browser
// has no WebGL. What only the assembled app can say: that the depth layer is
// really the one drawing (a suite that silently tested the fallback would pass
// for the wrong renderer), that it sits under the drawing and takes no pointer
// events, and that its pictures are right where the painter's were not — the
// register's two cases, a 355° revolve seen across its gap and two solids
// driven through each other, at views `npm run measure:depth` found the
// painter's worst at, and the grazing views the cap sort was once pinned on.
//
// "Right" is checked against an oracle that knows nothing of either renderer:
// each sampled pixel's ray cast against every visible face's plane (the
// harness's `nearestFaces`), the nearest face's fill the colour it must be.
// The same samples drawn by the painter's — still in the tree, as the fallback
// — must miss somewhere, or the view proves nothing.
//
// Set NEOCAD_E2E_SHOTS to a directory to keep the before/after screenshots
// (the app as it is, and the app with WebGL taken away); look at them.

import { test, after } from "node:test";
import assert from "node:assert/strict";
import { mkdirSync } from "node:fs";
import { join } from "node:path";
import { checkPicture, openApp, type AppContext } from "./harness.ts";
import { build, look, scene } from "./scenes.ts";

const SHOTS = process.env.NEOCAD_E2E_SHOTS;
const opened: AppContext[] = [];
after(async () => { for (const a of opened) await a.close(); });

async function fresh(webgl = true): Promise<AppContext> {
  const app = await openApp({ webgl });
  opened.push(app);
  return app;
}

async function shot(app: AppContext, name: string): Promise<void> {
  if (!SHOTS) return;
  mkdirSync(SHOTS, { recursive: true });
  await app.page.mouse.move(2, 2);
  await app.page.waitForTimeout(150);
  await app.page.screenshot({ path: join(SHOTS, `depth-${name}.png`) });
}

/**
 * The measurement's worst views of the register's two scenes (seed 1002 view
 * 31; seed 1003 view 16: yaw and pitch from its fitted top view), a little
 * closer and moved clear of the panels so the whole solid is in the picture.
 */
const VIEW_355: [number, number, number, [number, number]] = [-1.9607742038530962, 1.094745751046166, 0.27, [70, -60]];
const VIEW_CROSSED: [number, number, number, [number, number]] = [0.9588469461783153, -0.6593612901414914, 0.4, [120, -40]];

/** The same view's faces painted by the painter's, offscreen, at the samples — what the app drew before. */
const painterPixels = (app: AppContext, at: [number, number][]): Promise<number[][]> => app.page.evaluate(async (at) => {
  const path = "/src/facelayer.ts";
  const { paintFaces } = await import(path);
  const { model, engine } = (window as never as { __neocad: { model: unknown; engine: { view: unknown } } }).__neocad;
  const cv = document.getElementById("cv") as HTMLCanvasElement;
  const c = document.createElement("canvas");
  [c.width, c.height] = [cv.clientWidth, cv.clientHeight];
  const g = c.getContext("2d", { willReadFrequently: true })!;
  paintFaces(g, model, engine.view);
  return at.map(([x, y]) => [...g.getImageData(Math.floor(x), Math.floor(y), 1, 1).data]);
}, at);

/**
 * At a view: the depth layer's picture is the oracle's at every sample, and
 * the painter's misses at some — returned, so a test can say how many.
 */
async function depthRightPainterWrong(app: AppContext, what: string): Promise<number> {
  const pic = await checkPicture(app, 4);
  assert.ok(pic.onFace > 500, `${what}: ${pic.onFace} samples on the solids`);
  assert.deepEqual(pic.wrong, [], `${what}: every sample is the face nearest the viewer there`);
  const W = await app.page.$eval("#cv", (el) => el.clientWidth);
  const H = await app.page.$eval("#cv", (el) => el.clientHeight);
  const at: [number, number][] = [];
  for (let y = 2.5; y < H; y += 4) for (let x = 2.5; x < W; x += 4) at.push([x, y]);
  const [want, painted] = await Promise.all([app.nearestFaces(at), painterPixels(app, at)]);
  // A miss is the painter's showing some other face well inside one — more
  // than an anti-aliased edge's worth from any outline, by more than its seams' few levels.
  let missed = 0;
  want.forEach(({ face, edge }, i) => {
    if (!face || edge <= 3) return;
    if (face.rgb.some((c, k) => Math.abs(c - painted[i][k]) > 6)) missed++;
  });
  return missed;
}

test("the depth layer is the renderer: WebGL under the drawing, the same size, taking no pointer events", async () => {
  const app = await fresh();
  assert.equal(await app.renderer(), "depth", "faces by depth — not the painter's fallback");
  const layout = await app.page.evaluate(() => {
    const [faces, cv] = ["faces", "cv"].map((id) => document.getElementById(id) as HTMLCanvasElement);
    const [rf, rc] = [faces.getBoundingClientRect(), cv.getBoundingClientRect()];
    const top = document.elementFromPoint(rc.x + rc.width / 2, rc.y + rc.height / 2);
    return {
      sameBox: [rf.x, rf.y, rf.width, rf.height].join() === [rc.x, rc.y, rc.width, rc.height].join(),
      sameBitmap: faces.width === cv.width && faces.height === cv.height,
      under: !!(faces.compareDocumentPosition(cv) & Node.DOCUMENT_POSITION_FOLLOWING),
      events: getComputedStyle(faces).pointerEvents,
      top: top?.id,
    };
  });
  assert.deepEqual(layout, { sameBox: true, sameBitmap: true, under: true, events: "none", top: "cv" });
});

test("the 355° revolve seen across its gap: every pixel the face nearest there, where the painter's put walls over the start cap", async () => {
  const app = await fresh();
  await build(app, scene("revolve-355").source);
  await look(app, ...VIEW_355);
  const missed = await depthRightPainterWrong(app, "355°");
  assert.ok(missed > 0, "and this is a view the painter's draws wrong");
  await shot(app, "355-after");

  const before = await fresh(false);
  assert.equal(await before.renderer(), "painter's");
  await build(before, scene("revolve-355").source);
  await look(before, ...VIEW_355);
  await shot(before, "355-before");
});

test("two solids driven through each other: every pixel the face nearest there, where the painter's put one whole over the other", async () => {
  const app = await fresh();
  await build(app, scene("interpenetrating").source);
  await look(app, ...VIEW_CROSSED);
  const missed = await depthRightPainterWrong(app, "interpenetrating");
  assert.ok(missed > 100, `and the painter's draws ${missed} samples of it wrong`);
  await shot(app, "interpenetrating-after");

  const before = await fresh(false);
  await build(before, scene("interpenetrating").source);
  await look(before, ...VIEW_CROSSED);
  await shot(before, "interpenetrating-before");
});

test("a lid seen at a grazing angle, a hole near its end: the lid over its hole's far wall in every view the cap sort was pinned on", async () => {
  // Was the unit test that a cap sorts after every wall of its own (a
  // centroid key put the far wall over the lid). Now a picture.
  const app = await fresh();
  await build(app, `ls = poly([[0,0,0],[120,0,0],[120,30,0],[0,30,0]], "f");
    c = P([105,15,0]); onplane(c, "f"); model.addCircle(c, 10, "f"); extrude(ls[0], 40)`);
  for (const [yaw, pitch] of [[1.2, 0.2], [-1.3, 0.25], [1.45, 0.1], [0.4, 0.3]]) {
    await look(app, yaw, pitch, 0.42);
    const pic = await checkPicture(app, 5);
    assert.ok(pic.seen.has("e1.lid"), `${yaw}, ${pitch}: the lid is in view`);
    assert.deepEqual(pic.wrong, [], `${yaw}, ${pitch}: every sample is the face nearest there`);
  }
});

test("a revolve past 300° wraps round in front of its own start cap: right in every view the cap rule was pinned on", async () => {
  // Was the unit test of the painter's cap-lowering rule, at 321°. Now a picture.
  const app = await fresh();
  await build(app, `ls = poly([[10,-15,0],[40,-15,0],[40,15,0],[10,15,0]], "f");
    c = P([25,0,0]); onplane(c, "f"); model.addCircle(c, 6, "f"); revolve(ls[0], "f.y", 5.6)`);
  for (const [yaw, pitch] of [[0, -0.7], [0.26, -0.7], [5.5, 0.7], [1.05, -0.3]]) {
    await look(app, yaw, pitch, 0.42);
    const pic = await checkPicture(app, 5);
    assert.ok(pic.seen.has("e1.base"), `${yaw}, ${pitch}: the start cap is in view`);
    assert.deepEqual(pic.wrong, [], `${yaw}, ${pitch}: every sample is the face nearest there`);
  }
});

test("with WebGL taken away the app falls back to the painter's: the solid is still drawn, into the drawing, and the faces canvas stays empty", async () => {
  const app = await fresh(false);
  assert.equal(await app.renderer(), "painter's");
  await build(app, scene("box").source);
  // Square on to the lid: a pixel of it clear of every mark is the lid's
  // square-on fill, on the 2D canvas.
  let checked = 0;
  for (const p of [[12, 9, 20], [28, 21, 20], [20, 22, 20], [9, 18, 20]]) {
    const at = await app.screenOf(p);
    const pt = await app.at(...at);
    await app.page.mouse.move(pt.x, pt.y);
    await app.page.waitForTimeout(80);
    if ((await app.repl("hover()")).value !== null) continue;
    const [{ face }] = await app.nearestFaces([at]);
    assert.equal(face?.kind, "lid");
    assert.deepEqual(await app.pixel(...at, "drawing"), [...face!.rgb, 255]);
    assert.deepEqual(await app.pixel(...at, "screen"), [...face!.rgb, 255]);
    checked++;
  }
  assert.ok(checked > 0, "somewhere on the lid is clear of the drawing's marks");
  await assert.rejects(app.pixel(10, 10, "faces"), /painter's/);
  assert.deepEqual(app.pageErrors, []);
});

test("no uncaught page errors", () => {
  for (const a of opened) assert.deepEqual(a.pageErrors, []);
});
