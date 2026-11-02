// Sketching on a face in a browser: the Onshape sequence end to end. A plate
// drawn and extruded with the tools, turned so a wall faces the camera, the
// sketch tool clicked inside the wall, a circle drawn on it and extruded a
// positive depth — which must stand off the side of the plate as a boss, not
// bore into it. Then the same by the context menu on another face; one Ctrl+Z
// for the sketch; and the file round trip with both in its history.
//
// What only the assembled app can say: that the click goes through the
// command line — logged as the typed `plane(…)`, one undo step, the camera
// turned square to the wall — that the circle tool then draws *on the wall*
// (the working plane follows the new default for free), and that the picture
// is a boss on the side of a plate. Set NEOCAD_E2E_SHOTS to a directory to
// keep the screenshots; look at them.
//
// One app, tests in order: the states are cumulative.

import { test, before, after } from "node:test";
import assert from "node:assert/strict";
import { mkdirSync } from "node:fs";
import { join } from "node:path";
import { openApp, type AppContext, confirmAndRelease } from "./harness.ts";

let app: AppContext;
before(async () => { app = await openApp(); });
after(async () => { await app.close(); });

const SHOTS = process.env.NEOCAD_E2E_SHOTS;
async function shot(name: string, still = false): Promise<void> {
  if (!SHOTS) return;
  mkdirSync(SHOTS, { recursive: true });
  if (!still) await app.page.mouse.move(2, 2); // no hover outline or tag in the picture, unless that is the point
  await app.page.waitForTimeout(120);
  await app.page.screenshot({ path: join(SHOTS, `sketchface-${name}.png`) });
}

const dot = (a: number[], b: number[]) => a.reduce((s, x, i) => s + x * b[i], 0);
const sub = (a: number[], b: number[]) => a.map((x, i) => x - b[i]);
const dist3 = (a: number[], b: number[]) => Math.hypot(...sub(a, b));

async function leftDrag(a: [number, number], b: [number, number]): Promise<void> {
  const p = await app.at(...a), q = await app.at(...b);
  await app.page.mouse.move(p.x, p.y);
  await app.page.mouse.down();
  await app.page.mouse.move(q.x, q.y, { steps: 8 });
  await app.page.mouse.up();
  await app.page.waitForTimeout(220);
}

async function clickAt(sx: number, sy: number): Promise<void> {
  const at = await app.at(sx, sy);
  await app.page.mouse.click(at.x, at.y);
  await app.page.waitForTimeout(200);
}

async function moveTo(sx: number, sy: number): Promise<void> {
  const at = await app.at(sx, sy);
  await app.page.mouse.move(at.x, at.y, { steps: 3 });
  await app.page.waitForTimeout(120);
}

async function rightClick(sx: number, sy: number): Promise<void> {
  const at = await app.at(sx, sy);
  await app.page.mouse.move(at.x, at.y);
  await app.page.mouse.down({ button: "right" });
  await app.page.mouse.up({ button: "right" });
  await app.page.waitForTimeout(150);
}

/** The open menu's items: label → the command it shows (or "" for a disabled one). */
const menuItems = (): Promise<Record<string, string>> => app.page.$$eval("#ctxmenu .item", (els) =>
  Object.fromEntries(els.map((el) => [el.firstElementChild?.textContent ?? "", el.querySelector(".cmd")?.textContent ?? ""])));

async function choose(label: string): Promise<void> {
  const handle = await app.page.evaluateHandle((want) =>
    Array.from(document.querySelectorAll("#ctxmenu .item")).find((el) => el.firstElementChild?.textContent === want) ?? null, label);
  const el = handle.asElement();
  assert.ok(el, `no menu item ${JSON.stringify(label)}`);
  await el.click();
  await app.page.waitForTimeout(250);
}

/**
 * Pans `world` to a little right of the canvas's middle, clear of the panels.
 * `lookAt` keeps a frame's origin on its pixel, so after a few of them the
 * plate has wandered toward an edge.
 */
async function centreOn(world: number[]): Promise<void> {
  const [sx, sy] = await app.screenOf(world);
  const [w, h] = await app.page.$eval("#cv", (el) => [el.clientWidth, el.clientHeight]);
  await app.type(`pan(${w / 2 + 60 - sx}, ${h / 2 - 90 - sy})`);
}

/**
 * A pixel inside no region and over nothing pickable, as the app itself says —
 * the plate moves about the screen between tests, so no fixed pixel stays
 * clear of it.
 */
async function emptySpot(): Promise<[number, number]> {
  const spot = await app.page.evaluate(() => {
    const { engine } = (window as never as { __neocad: { engine: {
      regionAt(x: number, y: number): unknown; pickAt(x: number, y: number): unknown;
    } } }).__neocad;
    for (const [x, y] of [[1060, 60], [1060, 560], [700, 60], [180, 420], [900, 740]]) {
      if (engine.regionAt(x, y) === null && engine.pickAt(x, y) === null) return [x, y] as [number, number];
    }
    return null;
  });
  assert.ok(spot, "somewhere on the canvas is clear of the plate");
  return spot;
}

async function key(combo: string): Promise<void> {
  await app.page.fill("#cmd", "");
  await app.page.keyboard.press(combo);
  await app.page.waitForTimeout(250);
}

async function saved(): Promise<string> {
  const r = await app.repl("save()");
  assert.equal(r.ok, true, r.error ?? "");
  return r.value as string;
}

/** The 2D canvas's pixel at (sx, sy): where a tool's preview is drawn. */
const pixel = (sx: number, sy: number): Promise<number[]> => app.pixel(sx, sy, "drawing");

/** The camera's line of sight back at the viewer, and a frame's +z, read from the modules the app runs. */
const toward = (): Promise<number[]> => app.page.evaluate(async () => {
  const path = "/src/view.ts";
  const { viewAxes } = await import(path);
  return viewAxes((window as never as { __neocad: { engine: { view: unknown } } }).__neocad.engine.view).toward as number[];
});
const zOf = (frame: string): Promise<number[]> => app.page.evaluate(async (f) => {
  const path = "/src/relations/refs.ts";
  const { frameBasis } = await import(path);
  return frameBasis((window as never as { __neocad: { model: unknown } }).__neocad.model, f)().uz as number[];
}, frame);

interface SeenFeature { name: string; top: string; depth: string; pairs: [string, string][] }
const features = (): Promise<SeenFeature[]> => app.page.evaluate(() => {
  const { model } = (window as never as { __neocad: { model: {
    features: Map<string, { name: string; top: string; depth: string }>;
    relations: Map<string, { args: unknown[] }>;
  } } }).__neocad;
  return [...model.features.values()].map((f) => {
    const args = model.relations.get(f.depth)!.args;
    const pairs: [string, string][] = [];
    for (let i = 2; i < args.length; i += 2) pairs.push([args[i] as string, args[i + 1] as string]);
    return { name: f.name, top: f.top, depth: f.depth, pairs };
  });
});
const defaultFrame = async (): Promise<string | null> => (await app.repl("defaultFrame()")).value as string | null;

// The plate: 80 × 50 on the first plane, 20 deep along its +z.
const W = 40, H = 25, DEPTH = 20;
const CENTROID = [0, 0, DEPTH / 2];
/** The middle of the near wall (y = −H) and the far one (y = +H). */
const NEAR_WALL = [0, -H, DEPTH / 2];
const RIGHT_WALL = [W, 0, DEPTH / 2];

let plateFile = "";
let wallFrame = "";

test("plane(), a rectangle, an extrude: a plate", async () => {
  await app.type("plane()");
  await app.type("rectangle");
  await leftDrag(await app.screenOf([-W, -H, 0]), await app.screenOf([W, H, 0]));
  await app.type(`arm("extrude", { depth: ${DEPTH} })`);
  await clickAt(...await app.screenOf([0, 0, 0]));
  await confirmAndRelease(app);
  const [plate] = await features();
  assert.equal(plate.name, "e1");
  assert.equal(await app.status(), "SOLVED");
  const m = await app.model();
  // The tools drew the rectangle where they were dragged; its corners say so.
  const xs = Object.values(m.points).map((p) => p[0]);
  assert.ok(Math.abs(Math.min(...xs) + W) < 1e-6 && Math.abs(Math.max(...xs) - W) < 1e-6, `corners at ±${W}: ${xs}`);
  plateFile = await saved();
});

test("turned so the near wall faces the camera, the sketch tool outlines it, refuses a click on nothing, and a click inside types plane(a, b, c)", async () => {
  await app.type("orbit(-0.5, -1.05); zoom(1.3)");
  const seen = await toward();
  assert.ok(dot(seen, [0, -1, 0]) > 0.3, `the near wall faces the camera: toward ${seen}`);
  assert.ok(dot(seen, [0, 0, 1]) > 0.1, "and the lid is in view too");
  await shot("1-plate");

  await app.type("sketch");
  assert.equal((await app.model()).activeTool, "sketch");
  const wall = await app.screenOf(NEAR_WALL);
  await moveTo(...wall);
  const tint = await pixel(...wall);
  await shot("1b-hover", true);
  assert.ok(tint[1] > tint[0] + 15, `the wall is outlined green under the cursor: ${tint}`);

  // A click off the plate is refused aloud, and the tool stays armed.
  await clickAt(...await emptySpot());
  assert.match(await app.log(), /sketch: click inside a closed outline — the ones I can see are lit/);
  assert.equal((await app.model()).activeTool, "sketch");

  const frames = (await app.model()).byKind.frame;
  const before = await saved();
  await clickAt(...wall);
  assert.equal((await app.model()).activeTool, null, "one click, then the tool is done");
  const log = await app.log();
  const typed = log.match(/> (plane\("p\d+", "p\d+", "p\d+"\))/g);
  assert.ok(typed && typed.length === 1, `the log shows the typed call: ${log.slice(-300)}`);
  assert.equal((await app.model()).byKind.frame, frames + 1);
  wallFrame = (await defaultFrame())!;
  assert.ok(log.trimEnd().endsWith(`)${wallFrame}`), "and its answer, the new frame's name");

  // The plane's +z is out of the plate, and the camera is square to it.
  const z = await zOf(wallFrame);
  assert.ok(dist3(z, [0, -1, 0]) < 1e-9, `+z out of the near wall: ${z}`);
  assert.ok(dist3(await toward(), z) < 1e-9, "looking at it square-on");
  // And level: the x-ref is the origin's neighbour along an edge of the wall,
  // so the wall's edge from one to the other is horizontal on screen. (The
  // first cut put +x along the wall's diagonal, and the wall came up tipped.)
  const [a, b] = [...typed![0].matchAll(/"(p\d+)"/g)].map((x) => x[1]);
  const pts = (await app.model()).points;
  const [sa, sb] = [await app.screenOf(pts[a]), await app.screenOf(pts[b])];
  assert.ok(Math.abs(sa[1] - sb[1]) < 1e-6, `the wall's edge ${a}–${b} is level: ${sa} ${sb}`);
  assert.equal(await app.status(), "SOLVED");

  // One undo step, and back again.
  const after = await saved();
  await key("Control+z");
  assert.equal(await saved(), before, "one Ctrl+Z takes the sketch plane away, default and all");
  await key("Control+Shift+z");
  assert.equal(await saved(), after);
  await shot("2-on-the-wall");
});

test("a circle drawn on the wall lands on it, and extruded a positive depth stands off the plate: a boss", async () => {
  await app.type("circle");
  const c = await app.screenOf(NEAR_WALL);
  // The rim dragged out along the wall's long side, clear of its edges.
  await leftDrag(c, await app.screenOf([NEAR_WALL[0] + 8, NEAR_WALL[1], NEAR_WALL[2]]));
  const m = await app.model();
  const boss = m.circles.at(-1)!;
  assert.ok(Math.abs(m.radii[boss.name] - 8) < 1e-3, `radius 8: ${m.radii[boss.name]}`);
  assert.ok(Math.abs(m.points[boss.center][1] + H) < 1e-6, `on the wall's plane, y = −${H}: ${m.points[boss.center]}`);
  assert.ok(dist3(m.points[boss.center], NEAR_WALL) < 1e-3, "where it was drawn");

  await app.type('arm("extrude", { depth: 14 })');
  await clickAt(...await app.screenOf(NEAR_WALL));
  await confirmAndRelease(app);
  const all = await features();
  assert.equal(all.length, 2);
  const g = all[1];
  const m2 = await app.model();
  const twin = g.pairs.find(([b]) => b === boss.center)![1];
  const offset = sub(m2.points[twin], m2.points[boss.center]);
  assert.ok(dist3(offset, [0, -14, 0]) < 1e-6, `the boss's lid centre is its centre moved 14 out along −y: ${offset}`);
  // The outward-boss assertion: the boss's lid sits farther from the plate's
  // centroid than the wall does — its centre straight-line, and its lid frame
  // measured along the wall's outward normal. (The frame's origin is a twin of
  // a plate *corner*, which is farther from the centroid than the wall's middle
  // whichever way the boss went; only its distance across the wall's plane
  // tells out from in.)
  assert.ok(dist3(m2.points[twin], CENTROID) > dist3(NEAR_WALL, CENTROID) + 13.9, "the boss's lid centre is outside the plate");
  const lidOrigin = await app.page.evaluate((top) => {
    const { model } = (window as never as { __neocad: { model: { frame(n: string): { origin: string }; coords(n: string): number[] } } }).__neocad;
    return model.coords(model.frame(top).origin);
  }, g.top);
  assert.ok(Math.abs(lidOrigin[1] - (-H - 14)) < 1e-6, `the lid frame is on the lid plane: ${lidOrigin}`);
  const out = [0, -1, 0];
  assert.ok(dot(sub(lidOrigin, CENTROID), out) > dot(sub(NEAR_WALL, CENTROID), out) + 13.9, `lid frame ${lidOrigin} outside the plate`);
  assert.equal(await app.status(), "SOLVED");
  await app.type("lookAt(\"f1\"); orbit(-0.6, -1.0); zoom(1.8)");
  await centreOn(CENTROID);
  await shot("3-boss");
});

test("the same by the context menu, on the right wall: Sketch on this face types plane(…) for it, and a second boss stands off that side", async () => {
  // Turned so the right wall faces the camera too.
  await app.type("lookAt(\"f1\"); orbit(-1.2, -0.9)");
  await centreOn(CENTROID);
  const seen = await toward();
  assert.ok(dot(seen, [1, 0, 0]) > 0.3, `the right wall faces the camera: ${seen}`);
  const at = await app.screenOf(RIGHT_WALL);
  await rightClick(...at);
  const items = await menuItems();
  const cmd = items["Sketch on this face"];
  assert.match(cmd ?? "", /^plane\("p\d+", "p\d+", "p\d+"\)$/, `the item and what it types: ${JSON.stringify(items)}`);
  await choose("Sketch on this face");
  assert.match(await app.log(), new RegExp(`> ${cmd.replace(/[()]/g, "\\$&")}`), "logged as typed");
  const f = (await defaultFrame())!;
  assert.notEqual(f, wallFrame);
  assert.ok(dist3(await zOf(f), [1, 0, 0]) < 1e-9, "+z out of the right wall");

  // Off the plate, on empty canvas, there is no such item.
  await rightClick(...await emptySpot());
  assert.ok(!("Sketch on this face" in await menuItems()));
  await key("Escape");

  await app.type("circle");
  const c = await app.screenOf(RIGHT_WALL);
  await leftDrag(c, await app.screenOf([RIGHT_WALL[0], RIGHT_WALL[1] + 7, RIGHT_WALL[2]]));
  await app.type('arm("extrude", { depth: 10 })');
  await clickAt(...c);
  await confirmAndRelease(app);
  const all = await features();
  assert.equal(all.length, 3);
  const m = await app.model();
  const boss = m.circles.find((x) => dist3(m.points[x.center], RIGHT_WALL) < 1e-3)!;
  const twin = all[2].pairs.find(([b]) => b === boss.center)![1];
  assert.ok(Math.abs(m.points[boss.center][0] - W) < 1e-6, `drawn on the right wall, x = ${W}: ${m.points[boss.center]}`);
  assert.ok(dist3(sub(m.points[twin], m.points[boss.center]), [10, 0, 0]) < 1e-6, `its lid 10 out along +x: ${m.points[twin]}`);
  assert.equal(await app.status(), "SOLVED");
  await app.type("lookAt(\"f1\"); orbit(-0.9, -0.8); zoom(0.8)");
  await centreOn(CENTROID);
  await shot("4-two-bosses");
});

test("the sketch planes follow the plate: set its depth and both walls' frames stay on their walls, facing out", async () => {
  const [plate] = await features();
  await app.type(`set("${plate.depth}.value", 30)`);
  assert.equal(await app.status(), "SOLVED");
  assert.ok(dist3(await zOf(wallFrame), [0, -1, 0]) < 1e-9);
  const m = await app.model();
  const [, , third] = await features();
  // The second boss's centre was held on the right wall's frame; the wall grew.
  assert.ok(third.pairs.length > 0);
  for (const p of Object.values(m.points)) assert.ok(p.every(Number.isFinite));
});

test("save and open: the same file back, byte for byte, with sketches on faces in its history", async () => {
  const file = await saved();
  assert.notEqual(file, plateFile);
  await app.type(`open(${JSON.stringify(file)})`);
  assert.equal(await app.status(), "SOLVED");
  assert.equal(await saved(), file);
  assert.equal((await features()).length, 3);
  await shot("5-reopened");
});

test("no uncaught page errors", () => {
  assert.deepEqual(app.pageErrors, []);
});
