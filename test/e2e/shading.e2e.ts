// Smooth shading of curved faces, in a browser (the owner, 2026-11-23:
// *"rendering of curved surfaces is piecemeal not smooth. Eg cylindrical
// surfaces. Should render smoothly."*).
//
// A curved face is drawn as flat pieces — an extruded circle's wall as one
// quad per drawn segment, a kernel body's cylinder as triangles 10° apart —
// and each piece used to be one shade: a cylinder read as a stack of grey
// strips. Now a piece of a curved surface carries the surface's own normal at
// each of its corners, the shade is worked out per corner and the GPU blends
// it across the piece (faces.ts `vertexNormals`, facelayer.ts), so the strips
// are gone; a flat face, and the crease where a cylinder's wall meets its cap,
// are exactly as they were.
//
// **The number**: along one row of pixels across the middle of a curved wall,
// inside its outline and away from every edge, the largest change in
// luminance between neighbouring pixels. Flat-shaded at 10°, that step is a
// facet boundary and is well over `FLAT_STEP` levels; smooth, it is at most
// `SMOOTH_STEP`. This fails on the build before the change and passes after;
// the numbers are in the CHANGELOG (2026-11-23).
//
// Set NEOCAD_E2E_SHOTS to a directory to keep the pictures; look at them.

import { test, after } from "node:test";
import assert from "node:assert/strict";
import { existsSync, mkdirSync } from "node:fs";
import { join } from "node:path";
import { checkPicture, openApp, type AppContext } from "./harness.ts";
import { appFrames, build, look, scene } from "./scenes.ts";

const SHOTS = process.env.NEOCAD_E2E_SHOTS;
const KERNEL = existsSync(new URL("../../src/solids/smlib-gen/smlib.mjs", import.meta.url));
const kernelSkip = KERNEL ? false : "no SMLib build — run `npm run build:solids`";

/**
 * The largest luminance step a smooth wall may show between neighbouring
 * pixels, in levels of 255. A cylinder's shade is a cosine, so even drawn
 * perfectly it changes fastest at its limbs; the row stays `MARGIN` pixels in
 * from them, and the rest of the wall is a level or two a pixel. Measured
 * smooth: 2.0–3.0 on the five views below (CHANGELOG, 2026-11-23).
 */
const SMOOTH_STEP = 4;
/**
 * What the same rows measured flat-shaded, at least — the before-number this
 * test was written against: 6.1 (the revolve, desktop) to 10.0 (the kernel's
 * boss on an iPhone), the facet boundaries at 10°. A three-quarter view
 * compresses the cosine, which is why it is not the twenty-odd levels a
 * cylinder square to the eye would step at its limb.
 */
const FLAT_STEP = 6;
/** Pixels a sample keeps from any edge of a face — a silhouette, a rim, a wall line — where anti-aliasing blends. */
const MARGIN = 4;

const opened: AppContext[] = [];
after(async () => { for (const a of opened) await a.close(); });

async function fresh(device?: "iPhone 13"): Promise<AppContext> {
  const app = await openApp(device ? { device } : {});
  opened.push(app);
  return app;
}

async function shot(app: AppContext, name: string): Promise<void> {
  if (!SHOTS) return;
  mkdirSync(SHOTS, { recursive: true });
  await app.page.mouse.move(2, 2);
  await app.page.waitForTimeout(200);
  await app.page.screenshot({ path: join(SHOTS, `shading-${name}.png`) });
}

const luminance = (p: number[]) => 0.2126 * p[0] + 0.7152 * p[1] + 0.0722 * p[2];

/**
 * How far each pixel is from the nearest **edge of a solid** on screen — a
 * cap's rim, a wall line, a kernel edge: every visible face's `edges`,
 * projected — never from a seam between two pieces of one curved surface,
 * which no face lists as an edge. The oracle's own `edge` counts those seams
 * as outlines, and a measurement that kept clear of them would never see a
 * facet boundary at all.
 */
const edgeDistances = (app: AppContext, at: [number, number][]): Promise<number[]> => app.page.evaluate(async (at) => {
  const [facesPath, viewPath] = ["/src/faces.ts", "/src/view.ts"];
  const { visibleFaces } = await import(facesPath);
  const { worldToScreen } = await import(viewPath);
  const hook = (window as never as { __neocad: { model: unknown; engine: { view: unknown }; bodies?: { drawn(): unknown } } }).__neocad;
  const faces = visibleFaces(hook.model, hook.engine.view, new Set(), hook.bodies?.drawn() ?? null) as { edges: number[][][] }[];
  const segs: [number, number, number, number][] = [];
  for (const f of faces) for (const e of f.edges) {
    const s = e.map((w) => worldToScreen(hook.engine.view, w) as [number, number]);
    for (let k = 0; k + 1 < s.length; k++) segs.push([s[k][0], s[k][1], s[k + 1][0], s[k + 1][1]]);
  }
  return at.map(([x, y]) => {
    let best = 99;
    for (const [ax, ay, bx, by] of segs) {
      const [dx, dy] = [bx - ax, by - ay];
      const t = Math.max(0, Math.min(1, ((x - ax) * dx + (y - ay) * dy) / (dx * dx + dy * dy || 1)));
      best = Math.min(best, Math.hypot(x - ax - t * dx, y - ay - t * dy));
    }
    return best;
  });
}, at);

/**
 * Along the pixel row through where `world` is drawn: the largest luminance
 * step between neighbouring pixels, over the pixels on a wall face of
 * `feature` (by the oracle, `nearestFaces`) that are `MARGIN` pixels clear of
 * every edge of a solid and of the wall's silhouette — each run of such
 * pixels trimmed at both ends. Seams between the wall's pieces are inside a
 * run, so a facet boundary is exactly what this measures. Returns how many
 * pixels were compared too, so a view that put the row somewhere else fails
 * loudly rather than measuring nothing.
 */
async function rowStep(app: AppContext, world: number[], feature: string): Promise<{ step: number; compared: number; row: number }> {
  const [, sy] = await app.screenOf(world);
  const row = Math.floor(sy) + 0.5;
  const W = await app.page.$eval("#cv", (el) => el.clientWidth);
  const at: [number, number][] = [];
  for (let x = 0; x < W; x++) at.push([x + 0.5, row]);
  const [want, got, far] = await Promise.all([app.nearestFaces(at), app.pixels("faces", at), edgeDistances(app, at)]);
  const onWall = want.map(({ face }) => !!face && face.feature === feature && face.kind === "wall");
  // Runs of the wall along the row, trimmed by MARGIN at each end: the silhouette.
  const kept = onWall.map(() => false);
  for (let x = 0; x < W;) {
    if (!onWall[x]) { x++; continue; }
    let e = x;
    while (e < W && onWall[e]) e++;
    for (let k = x + MARGIN; k < e - MARGIN; k++) kept[k] = far[k] > MARGIN;
    x = e;
  }
  let step = 0, compared = 0;
  for (let x = 0; x + 1 < W; x++) {
    if (!kept[x] || !kept[x + 1]) continue;
    assert.equal(got[x][3], 255, `an opaque pixel on the wall at ${x}`);
    compared++;
    step = Math.max(step, Math.abs(luminance(got[x + 1]) - luminance(got[x])));
  }
  return { step, compared, row };
}

/** The oracle's picture check: every sampled pixel the fill the face nearest there should have — a flat face its one shade, a curved one its shade at that very pixel. */
async function pictureRight(app: AppContext, what: string, step = 6): Promise<void> {
  const pic = await checkPicture(app, step);
  assert.ok(pic.onFace > 300, `${what}: ${pic.onFace} samples on the solid`);
  assert.deepEqual(pic.wrong.slice(0, 12), [], `${what}: ${pic.wrong.length} of ${pic.onFace} samples off the oracle's fill`);
}

test("a lone cylinder, desktop: its wall shades smoothly across — no facet steps along a row through its middle", async () => {
  const app = await fresh();
  await build(app, scene("cylinder").source);
  await look(app, 0.6, 1.15, 0.2, [60, 40]);
  const { step, compared } = await rowStep(app, [0, 0, 12.5], "e1");
  console.log(`cylinder (desktop): largest luminance step along the wall's middle row ${step.toFixed(1)} levels over ${compared} pixels`);
  await shot(app, "cylinder-desktop");
  assert.ok(compared > 60, `the row crosses the wall: ${compared} pixels compared`);
  assert.ok(step <= SMOOTH_STEP, `smooth: the largest step is ${step.toFixed(1)} levels (flat facets measured ${FLAT_STEP} and more)`);
  await pictureRight(app, "cylinder");
  assert.deepEqual(app.pageErrors, []);
});

test("a full turn of a filleted profile, desktop: its outer wall and the fillet's torus shade smoothly", async () => {
  const app = await fresh();
  await build(app, scene("filleted-turn").source);
  await look(app, 0.6, 0.5, 0.36, [60, 40]);
  const { step, compared } = await rowStep(app, [0, 8, 0], "e1");
  console.log(`revolve (desktop): largest luminance step along the outer wall's row ${step.toFixed(1)} levels over ${compared} pixels`);
  await shot(app, "revolve-desktop");
  assert.ok(compared > 60, `the row crosses the wall: ${compared} pixels compared`);
  assert.ok(step <= SMOOTH_STEP, `smooth: the largest step is ${step.toFixed(1)} levels`);
  await pictureRight(app, "revolve");
  assert.deepEqual(app.pageErrors, []);
});

test("a boss on a plate, the kernel's body, desktop: the boss's wall shades smoothly; the plate's faces stay flat and the rim stays a crease", { skip: kernelSkip }, async () => {
  const app = await fresh();
  await build(app, scene("boss-plate").source);
  await look(app, 0.6, 1.15, 0.5, [60, 20]);
  const { step, compared } = await rowStep(app, [30, 20, 15.5], "e2");
  console.log(`boss on a plate (desktop, kernel body): largest luminance step along the boss's row ${step.toFixed(1)} levels over ${compared} pixels`);
  await shot(app, "boss-desktop");
  assert.ok(compared > 40, `the row crosses the boss: ${compared} pixels compared`);
  assert.ok(step <= SMOOTH_STEP, `smooth: the largest step is ${step.toFixed(1)} levels`);
  // The kernel's faces, as drawn: a vertex normal on every piece of a curved
  // face (by the kernel's own record of the face) and on no piece of a plane
  // — the plate's side walls are `wall`s and planes both — never leaning
  // into the cap (a cylinder's normal has no axial part; a mean taken across
  // the rim would), and one normal per position within a face (the seam's
  // duplicated vertices agree).
  const facts = await app.page.evaluate(() => {
    type Drawn = { kind: string; name?: string; face: number; outlines: number[][][]; normal: number[]; vertexNormals?: number[][][] };
    const hook = (window as never as { __neocad: { bodies: {
      drawn(): { faces: Drawn[] } | null;
      views(): { result: { solid: { faces: { kind: string }[] } } }[];
    } } }).__neocad;
    const faces = hook.bodies.drawn()?.faces ?? [];
    const records = hook.bodies.views()[0].result.solid.faces;
    const planarWithNormals = faces.filter((f) => f.vertexNormals && records[f.face].kind === "plane").length;
    const curvedWithout = faces.filter((f) => !f.vertexNormals && records[f.face].kind !== "plane").length;
    const walls = faces.filter((f) => f.vertexNormals);
    let axial = 0, offUnit = 0;
    const byPosition = new Map<string, number[]>();
    let disagree = 0;
    for (const f of walls) {
      f.vertexNormals?.[0].forEach((n, k) => {
        axial = Math.max(axial, Math.abs(n[2]));
        offUnit = Math.max(offUnit, Math.abs(Math.hypot(...n) - 1));
        const key = `${f.name}|${f.outlines[0][k].map((c) => c.toFixed(4)).join(",")}`;
        const seen = byPosition.get(key);
        if (seen && Math.hypot(...seen.map((c, i) => c - n[i])) > 1e-6) disagree++;
        byPosition.set(key, n);
      });
    }
    return { faces: faces.length, planarWithNormals, curved: walls.length, curvedWithout, axial, offUnit, disagree };
  });
  assert.ok(facts.faces > 0 && facts.curved > 0, `a kernel body is drawn, the boss's wall in it: ${JSON.stringify(facts)}`);
  assert.equal(facts.planarWithNormals, 0, `a plane carries no vertex normals: ${JSON.stringify(facts)}`);
  assert.equal(facts.curvedWithout, 0, `every piece of a curved face carries vertex normals: ${JSON.stringify(facts)}`);
  assert.ok(facts.axial < 1e-3, `a wall's vertex normal has no axial part — nothing of the cap leaked across the rim: ${facts.axial}`);
  assert.ok(facts.offUnit < 1e-6, `unit length: ${facts.offUnit}`);
  assert.equal(facts.disagree, 0, "one normal per position within a face: no shading seam");
  await pictureRight(app, "boss on a plate");
  assert.deepEqual(app.pageErrors, []);
});

test("on an iPhone: the boss on a plate, close — the boss's wall smooth by the same measure", { skip: kernelSkip }, async () => {
  const app = await fresh("iPhone 13");
  await build(app, scene("boss-plate").source);
  await look(app, 0.6, 1.15, 0.75, [0, -40]);
  const { step, compared } = await rowStep(app, [30, 20, 15.5], "e2");
  console.log(`boss on a plate (iPhone 13): largest luminance step along the boss's row ${step.toFixed(1)} levels over ${compared} pixels`);
  await shot(app, "boss-iphone");
  assert.ok(compared > 40, `the row crosses the boss: ${compared} pixels compared`);
  assert.ok(step <= SMOOTH_STEP, `smooth: the largest step is ${step.toFixed(1)} levels`);
  assert.deepEqual(app.pageErrors, []);
});

test("on an iPhone: the filleted turn — smooth", async () => {
  const app = await fresh("iPhone 13");
  await build(app, scene("filleted-turn").source);
  await look(app, 0.6, 0.5, 0.42, [0, -40]);
  const { step, compared } = await rowStep(app, [0, 8, 0], "e1");
  console.log(`revolve (iPhone 13): largest luminance step along the outer wall's row ${step.toFixed(1)} levels over ${compared} pixels`);
  await shot(app, "revolve-iphone");
  assert.ok(compared > 40, `the row crosses the wall: ${compared} pixels compared`);
  assert.ok(step <= SMOOTH_STEP, `smooth: the largest step is ${step.toFixed(1)} levels`);
  assert.deepEqual(app.pageErrors, []);
});

test("a box stays a box: three flat faces, each one shade, the corner sharp", async () => {
  const app = await fresh();
  await build(app, scene("box").source);
  await look(app, 0.6, 0.5, 0.36, [60, 40]);
  const pic = await checkPicture(app, 6);
  assert.ok(pic.onFace > 300);
  assert.deepEqual(pic.wrong.slice(0, 12), [], `${pic.wrong.length} samples off`);
  // One colour per face: every sample the oracle put on a face is that face's one fill.
  const colours = await app.page.evaluate(async () => {
    const facesPath = "/src/faces.ts";
    const { visibleFaces } = await import(facesPath);
    const { model, engine } = (window as never as { __neocad: { model: unknown; engine: { view: unknown } } }).__neocad;
    return (visibleFaces(model, engine.view) as { vertexNormals?: unknown; shades?: unknown }[]).map((f) => [!!f.vertexNormals, !!f.shades]);
  });
  assert.ok(colours.length >= 3);
  assert.ok(colours.every(([vn, sh]) => !vn && !sh), "a box's faces carry no vertex normals and no per-vertex shades");
  assert.deepEqual(app.pageErrors, []);
});

/**
 * The cost: the app's own frames on the two curved scenes, as hidden.measure.ts
 * times them. Per-vertex colours add nothing to the vertex count, so the
 * number is logged for the CHANGELOG's before/after and not asserted — a
 * frame time under the suite's load is not a verdict.
 */
test("frame cost, logged: the boss on a plate and the filleted turn", async () => {
  for (const name of ["boss-plate", "filleted-turn"]) {
    const app = await fresh();
    await build(app, scene(name).source);
    const t = await app.page.evaluate(appFrames, { frames: 90 });
    console.log(`${name}: ${t.frame.toFixed(1)} ms a frame, render() ${t.submit.toFixed(2)} ms of it (${t.frames} frames, ${t.faces} faces, ${t.renderer})`);
    assert.equal(t.renderer, "depth");
  }
});
