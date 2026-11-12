// Sketch mode on an iPhone 13, by finger (docs/plans/sketch-mode.md): the
// desktop's walk (sketchmode.e2e.ts) under a phone's emulation. The sketch
// button tapped; Front tapped in its options; the view square to Front; a
// rectangle dragged and a spline tapped out and ended with ✓, every point held
// on Front; orbited, and the chip's ⊥ tapped to look square again; Done tapped.
// Then a filleted block's side wall tapped with the sketch tool and a circle
// dragged on it.
//
// Set NEOCAD_E2E_SHOTS to keep the pictures; look at them.

import { test, before, after } from "node:test";
import assert from "node:assert/strict";
import { existsSync, mkdirSync } from "node:fs";
import { join } from "node:path";
import { openApp, type AppContext } from "./harness.ts";
import { fingers, type Fingers } from "./fingers.ts";

const built = existsSync(new URL("../../src/solids/smlib-gen/smlib.mjs", import.meta.url));
const skip = built ? false : "no SMLib build — run `npm run build:solids`";

let app: AppContext;
let hand: Fingers;
before(async () => {
  app = await openApp({ device: "iPhone 13" });
  hand = await fingers(app);
});
after(async () => {
  assert.deepEqual(app.pageErrors, [], "nothing the page threw went uncaught");
  await app.close();
});

const frames = () => app.page.evaluate(() => new Promise<void>((r) => requestAnimationFrame(() => requestAnimationFrame(() => r()))));
const SHOTS = process.env.NEOCAD_E2E_SHOTS;
async function shot(name: string): Promise<void> {
  if (!SHOTS) return;
  mkdirSync(SHOTS, { recursive: true });
  await frames();
  await app.page.screenshot({ path: join(SHOTS, `sketchmode-iphone-${name}.png`) });
}

const chip = () => app.page.$eval("#mode", (el) => ({ where: (el as HTMLElement).dataset.where ?? "", what: (el as HTMLElement).dataset.what ?? "" }));
const toward = (): Promise<number[]> => app.page.evaluate(async () => {
  const path = "/src/view.ts";
  const { viewAxes } = await import(path);
  return viewAxes((window as never as { __neocad: { engine: { view: unknown } } }).__neocad.engine.view).toward as number[];
});
const near = (a: number[], b: number[], tol = 1e-6) => Math.hypot(...a.map((x, i) => x - b[i])) <= tol;
const value = async (src: string) => {
  const r = await app.repl(src);
  assert.equal(r.ok, true, r.error ?? "");
  return r.value;
};
async function type(line: string): Promise<void> {
  await app.type(line);
  await app.page.evaluate(() => (document.activeElement as HTMLElement | null)?.blur());
}
/** The middle of an element, in the canvas's pixels — what a finger is aimed by. */
const middle = (sel: string) => app.page.$eval(sel, (el) => {
  const r = el.getBoundingClientRect();
  const c = document.getElementById("cv")!.getBoundingClientRect();
  return [r.x + r.width / 2 - c.x, r.y + r.height / 2 - c.y] as [number, number];
});
async function tapOn(sel: string): Promise<void> {
  await hand.tap(...await middle(sel));
  await app.page.waitForTimeout(300);
}
async function tapAt(sx: number, sy: number): Promise<void> {
  await app.at(sx, sy);
  await hand.tap(sx, sy);
  // A tap straight after another is read as a double tap's second half if too soon.
  await app.page.waitForTimeout(350);
}
async function dragFrom(a: [number, number], b: [number, number]): Promise<void> {
  await app.at(...a);
  await hand.drag(a, b, 12);
  await app.page.waitForTimeout(400);
}
/** Every point, each with whether an onPlane holds it to `ref` and how far off that plane it is. */
const heldOn = (ref: string) => app.page.evaluate((plane) => {
  const m = (window as never as { __neocad: { model: {
    entities: Map<string, { kind: string; name: string }>; relations: Map<string, { op: string; args: unknown[] }>;
    coords(n: string): number[]; planeValues(r: string): { origin: number[]; n: number[] };
  } } }).__neocad.model;
  const pv = m.planeValues(plane);
  return [...m.entities.values()].filter((e) => e.kind === "point").map((e) => ({
    name: e.name,
    held: [...m.relations.values()].some((r) => r.op === "onPlane" && r.args[0] === e.name && r.args[1] === plane),
    off: Math.abs(m.coords(e.name).reduce((s, c, i) => s + (c - pv.origin[i]) * pv.n[i], 0)),
  }));
}, ref);

/** The options panel shown — on a phone it may be put away; the chip's tool name brings it, as a person would tap it. */
async function options(): Promise<void> {
  const hidden = await app.page.$eval('.panel[data-panel="options"]', (el) => (el as HTMLElement).hidden);
  if (hidden) await tapOn("#mode .what");
  await app.page.waitForSelector('#options .ochoose[data-choice="front"]', { state: "visible", timeout: 5000 });
}

test("the sketch button tapped, then Front in its options: the view square to Front, the chip says so", async () => {
  await tapOn('#toolbar button[data-tool="plane"]');
  assert.equal((await chip()).what, "plane");
  await options();
  await shot("1-armed-options");
  await tapOn('#options .ochoose[data-choice="front"]');
  await app.page.waitForFunction(() => (document.getElementById("mode") as HTMLElement).dataset.where === "on Front", null, { timeout: 5000 });
  assert.equal(await value("workplane()"), "origin.xz");
  assert.ok(near(await toward(), [0, -1, 0]), `square to Front: ${await toward()}`);
});

test("a rectangle dragged and a spline tapped out on Front: every point held on it, and in it — and still, orbited", async () => {
  await tapOn('#toolbar button[data-tool="rectangle"]');
  // Below the origin, clear of the organiser and the log.
  const [cx, cy] = await app.screenOf([0, 0, 0]);
  await dragFrom([cx - 40, cy + 60], [cx + 120, cy + 140]);
  await type('arm("spline")');
  for (const [dx, dy] of [[20, -120], [60, -80], [100, -110], [150, -70]]) await tapAt(cx + dx, cy + dy);
  await tapOn("#options .oact button.ok");
  const pts = await heldOn("origin.xz");
  assert.equal(pts.length, 8, `four corners and four spline points: ${pts.map((p) => p.name)}`);
  assert.deepEqual(pts.filter((p) => !p.held).map((p) => p.name), [], "every one held on Front");
  assert.deepEqual(pts.filter((p) => p.off > 1e-6).map((p) => p.name), []);
  await shot("2-drawn-on-front");
  await type('arm("select")');
  await type("orbit(-0.7, -0.5)");
  await app.page.waitForTimeout(250);
  assert.deepEqual((await heldOn("origin.xz")).filter((p) => p.off > 1e-6).map((p) => p.name), [], "orbiting moves the camera only");
  await shot("3-orbited");
});

test("⊥ in the chip, tapped: square to Front again; Done, tapped: the sketch left, the view where it was", async () => {
  await tapOn("#mode .look");
  assert.ok(near(await toward(), [0, -1, 0]), `Normal To: ${await toward()}`);
  await shot("4-normal-to");
  await type("orbit(-0.3, -0.2)");
  const was = await toward();
  await tapOn("#mode .done");
  assert.equal((await chip()).where, "");
  assert.ok(near(await toward(), was), "the camera stays");
  assert.equal((await heldOn("origin.xz")).filter((p) => p.held).length, 8, "the sketch stays held on Front");
});

test("a filleted block's side wall tapped with the sketch tool, and a circle dragged on it, held there", { skip }, async () => {
  assert.deepEqual(app.pageErrors, []);
  await app.close();
  app = await openApp({ device: "iPhone 13" });
  hand = await fingers(app);
  await value("pt(0,0,0); pt(60,0,0); pt(60,40,0); pt(0,40,0)");
  await value('ln("p1","p2"); ln("p2","p3"); ln("p3","p4"); ln("p4","p1")');
  await value('extrude("l1", 20)');
  await type("orbit(-0.6, -1.0)");
  const t = await toward();
  const xWall = t[0] > 0 ? "m1" : "m3";
  await value(`fillet("e1", ["e1.lid|e1.${xWall}"], 6)`);
  await type("refresh()");
  await app.page.waitForFunction(() => {
    const b = (window as never as { __neocad: { bodies: { settled: boolean; views(): { result: { solid: { faces: { name: string }[] } | null } }[] } } }).__neocad.bodies;
    return b.settled && b.views().some((v) => v.result.solid?.faces.some((f) => f.name.startsWith("e2.")));
  }, null, { timeout: 60_000 });
  const wall = t[0] > 0 ? [60, 20, 7] : [0, 20, 7];
  // Zoomed first, then the wall brought to the middle, clear of the panes.
  await type("zoom(1.4)");
  const [bx, by] = await app.screenOf(wall);
  const [w, h] = await app.page.$eval("#cv", (el) => [el.clientWidth, el.clientHeight]);
  await type(`pan(${w / 2 + 20 - bx}, ${h / 2 + 80 - by})`);
  await shot("5-filleted-block");
  await tapOn('#toolbar button[data-tool="plane"]');
  await tapAt(...await app.screenOf(wall));
  await app.page.waitForFunction(() => (document.getElementById("mode") as HTMLElement).dataset.where !== "", null, { timeout: 5000 });
  const wp = await value("workplane()") as string;
  assert.match(wp, /^p\d+\.p\d+\.p\d+$/);
  assert.equal((await chip()).where, "on e1's side");
  const n = await value(`model.planeValues(${JSON.stringify(wp)}).n`) as number[];
  assert.ok(near(await toward(), n), "square to the wall");
  await tapOn('#toolbar button[data-tool="circle"]');
  const [cx, cy] = await app.screenOf(wall);
  await dragFrom([cx, cy], [cx + 24, cy + 4]);
  const held = (await heldOn(wp)).filter((p) => p.held);
  assert.equal(held.length, 1, "the circle's centre held on the wall");
  assert.ok(held[0].off < 1e-6);
  await type('arm("select")');
  await shot("6-circle-on-the-wall");
});
