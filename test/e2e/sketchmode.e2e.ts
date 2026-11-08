// Sketch mode in a browser, by mouse (docs/plans/sketch-mode.md). The owner: *"I
// need a way to natively sketch on a plane without it being a special feature.
// It should just add 'on plane' relations to each entity as it gets sketched.
// Also when I select this mode it should go normal to the plane/face."*
//
// The spec's walk, end to end: in a fresh document the sketch tool lights Top
// (Front and Right are edge-on from above, and are the options' buttons);
// Front picked from the options turns the view square to it; a rectangle and a
// spline drawn there are held on it, one onPlane a point, and stay in it when
// the view is orbited; the chip's ⊥ (Normal To) turns it square again; Escape
// with nothing armed leaves the sketch, and so does Done. Then a block,
// filleted and chamfered by the kernel: its side wall picked and a circle
// drawn on it, and the chamfer's face — which no loop bounds — picked too.
//
// Set NEOCAD_E2E_SHOTS to a directory to keep the screenshots; look at them.

import { test, before, after } from "node:test";
import assert from "node:assert/strict";
import { existsSync, mkdirSync } from "node:fs";
import { join } from "node:path";
import { openApp, type AppContext } from "./harness.ts";

const built = existsSync(new URL("../../src/solids/smlib-gen/smlib.mjs", import.meta.url));
const skip = built ? false : "no SMLib build — run `npm run build:solids`";

let app: AppContext;
before(async () => { app = await openApp(); });
after(async () => {
  assert.deepEqual(app.pageErrors, [], "nothing the page threw went uncaught");
  await app.close();
});

const SHOTS = process.env.NEOCAD_E2E_SHOTS;
async function shot(name: string, still = false): Promise<void> {
  if (!SHOTS) return;
  mkdirSync(SHOTS, { recursive: true });
  if (!still) await app.page.mouse.move(2, 2); // no hover in the picture, unless that is the point
  await app.page.waitForTimeout(200);
  await app.page.screenshot({ path: join(SHOTS, `sketchmode-${name}.png`) });
}

const chip = () => app.page.$eval("#mode", (el) => {
  const d = (el as HTMLElement).dataset;
  return { where: d.where ?? "", what: d.what ?? "", next: d.next ?? "" };
});
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

/** Every point there is, each with whether an onPlane holds it to `ref`, and how far off that plane it is. */
const heldOn = (ref: string) => app.page.evaluate((plane) => {
  const m = (window as never as { __neocad: { model: {
    entities: Map<string, { kind: string; name: string }>; relations: Map<string, { op: string; args: unknown[] }>;
    coords(n: string): number[]; planeValues(r: string): { origin: number[]; n: number[] };
  } } }).__neocad.model;
  const pv = m.planeValues(plane);
  return [...m.entities.values()].filter((e) => e.kind === "point").map((e) => {
    const x = m.coords(e.name);
    return {
      name: e.name,
      held: [...m.relations.values()].some((r) => r.op === "onPlane" && r.args[0] === e.name && r.args[1] === plane),
      off: Math.abs(x.reduce((s, c, i) => s + (c - pv.origin[i]) * pv.n[i], 0)),
    };
  });
}, ref);

async function clickAt(sx: number, sy: number): Promise<void> {
  const at = await app.at(sx, sy);
  await app.page.mouse.click(at.x, at.y);
  await app.page.waitForTimeout(200);
}
async function drag(a: [number, number], b: [number, number]): Promise<void> {
  const p = await app.at(...a), q = await app.at(...b);
  await app.page.mouse.move(p.x, p.y);
  await app.page.mouse.down();
  await app.page.mouse.move(q.x, q.y, { steps: 8 });
  await app.page.mouse.up();
  await app.page.waitForTimeout(220);
}
/** The lines typed so far, as the log shows them (`> line`) — a button's included, since a button types. */
const typedLines = () => app.page.$$eval("#log > div", (els) => els.map((e) => e.textContent ?? "").filter((t) => t.startsWith("> ")).map((t) => t.slice(2).trim()));

test("in a fresh document the sketch tool lights Top, and offers Top, Front and Right as buttons", async () => {
  await app.page.click('#toolbar button[data-tool="sketch"]');
  await app.page.waitForTimeout(250);
  assert.equal((await chip()).what, "sketch");
  assert.equal((await chip()).next, "click a lit face or plane to sketch on it");
  const buttons = await app.page.$$eval('#options .ochoose', (els) => els.map((b) => (b as HTMLElement).dataset.choice));
  assert.deepEqual(buttons, ["top", "front", "right"]);
  // The Top patch is drawn, faintly green, round the origin.
  const half = 90 / (await app.model()).view.scale; // the patch's least reach, PATCH_PX on screen
  const [ox, oy] = await app.screenOf([0.5 * half, -0.5 * half, 0]);
  const px = await app.pixel(ox + 0.5, oy + 0.5, "drawing");
  assert.ok(px[3] > 0 && px[1] > px[0], `Top's patch is tinted at its middle: ${px}`);
  const tip = await app.page.$eval('#toolbar button[data-tool="sketch"]', (b) => b.getAttribute("aria-label") ?? b.getAttribute("title") ?? "");
  assert.ok(tip.length > 0);
  await shot("1-armed-fresh");
});

test("Front from the options: workplane(\"origin.xz\") typed, the view square to it, the chip says on Front", async () => {
  await app.page.click('#options .ochoose[data-choice="front"]');
  await app.page.waitForFunction(() => (document.getElementById("mode") as HTMLElement).dataset.where === "on Front", null, { timeout: 5000 });
  assert.ok((await typedLines()).some((l) => l === 'workplane("origin.xz")'), `typed: ${(await typedLines()).slice(-4).join(" | ")}`);
  assert.equal(await value("workplane()"), "origin.xz");
  assert.ok(near(await toward(), [0, -1, 0]), `square to Front, seen from the front: ${await toward()}`);
  await shot("2-on-front");
});

test("a rectangle and a spline drawn on Front: every point held onPlane to it, and in it — still, once the view is orbited", async () => {
  await app.type('arm("rectangle")');
  const [cx, cy] = await app.screenOf([0, 0, 0]);
  await drag([cx - 120, cy - 140], [cx + 40, cy - 40]);
  await app.type('arm("spline")');
  for (const [dx, dy] of [[-140, 60], [-60, 10], [20, 70], [100, 20]]) await clickAt(cx + dx, cy + dy);
  await clickAt(cx + 100, cy + 20); // the last point again: the end, open
  const pts = await heldOn("origin.xz");
  assert.equal(pts.length, 8, `four corners and four spline points: ${pts.map((p) => p.name)}`);
  assert.deepEqual(pts.filter((p) => !p.held).map((p) => p.name), [], "every one held on Front");
  assert.deepEqual(pts.filter((p) => p.off > 1e-6).map((p) => p.name), [], "and on it");
  const kinds = await app.model();
  assert.equal(kinds.byKind.spline, 1);
  await app.type('arm("select")');
  await app.type("orbit(-0.7, -0.5)");
  await app.page.waitForTimeout(250);
  const after = await heldOn("origin.xz");
  assert.deepEqual(after.filter((p) => p.off > 1e-6).map((p) => p.name), [], "orbiting moves the camera, not the sketch");
  // The view shows the plane: Front's patch tinted, seen at an angle now.
  assert.equal((await chip()).where, "on Front");
  assert.ok(!near(await toward(), [0, -1, 0], 1e-3), "turned away");
  await shot("3-front-orbited");
});

test("the chip's ⊥ looks at the plane again — Normal To", async () => {
  await app.page.click("#mode .look");
  await app.page.waitForTimeout(250);
  assert.ok(near(await toward(), [0, -1, 0]), `square to Front again: ${await toward()}`);
  assert.ok((await typedLines()).at(-1) === 'lookAt("origin.xz")', `typed: ${(await typedLines()).at(-1)}`);
  await shot("4-normal-to");
});

test("Escape with nothing armed leaves the sketch — workplane(null), the view where it was; undo puts it back; Done leaves it too", async () => {
  await app.type("orbit(-0.3, -0.2)");
  const was = await toward();
  await app.page.fill("#cmd", "");
  await app.page.locator("#cv").focus().catch(() => {});
  await app.page.evaluate(() => (document.activeElement as HTMLElement | null)?.blur());
  await app.page.keyboard.press("Escape");
  await app.page.waitForTimeout(250);
  assert.equal((await chip()).where, "", "no plane: nothing in the chip's first part");
  assert.equal(await value("workplane()"), "origin", "the drawing plane is the ground again");
  assert.ok((await typedLines()).at(-1) === "workplane(null)");
  assert.ok(near(await toward(), was), "the camera stays where it was");
  const pts = await heldOn("origin.xz");
  assert.equal(pts.filter((p) => p.held).length, 8, "what was drawn stays held on Front");
  await shot("5-escaped");
  await app.type("undo()");
  assert.equal((await chip()).where, "on Front", "one undo puts the sketch back");
  await app.page.click("#mode .done");
  await app.page.waitForTimeout(250);
  assert.equal((await chip()).where, "");
});

// --- a block the kernel filleted and chamfered ---------------------------------------

async function block(): Promise<{ wall: number[]; camera: string }> {
  // A fresh page: the sketch above is not this one's.
  assert.deepEqual(app.pageErrors, []);
  await app.close();
  app = await openApp();
  await value("pt(0,0,0); pt(60,0,0); pt(60,40,0); pt(0,40,0)");
  await value('ln("p1","p2"); ln("p2","p3"); ln("p3","p4"); ln("p4","p1")');
  await value('extrude("l1", 20)');
  await app.type("orbit(-0.6, -1.0)");
  const [bx, by] = await app.screenOf([30, 20, 10]);
  const [w, h] = await app.page.$eval("#cv", (el) => [el.clientWidth, el.clientHeight]);
  await app.type(`pan(${w / 2 + 60 - bx}, ${h / 2 - 60 - by})`);
  const t = await toward();
  // The wall facing the viewer along x, and the lid edges facing it: one filleted, one chamfered.
  const xWall = t[0] > 0 ? "m1" : "m3", yWall = t[1] < 0 ? "m0" : "m2";
  await value(`fillet("e1", ["e1.lid|e1.${xWall}"], 6)`);
  await value(`chamfer("e1", ["e1.lid|e1.${yWall}"], 6)`);
  await app.type("refresh()");
  // Until the kernel's answer has the chamfer's face in it: settled alone can be the answer before the fillet's.
  await app.page.waitForFunction(() => {
    const b = (window as never as { __neocad: { bodies: { settled: boolean; views(): { result: { solid: { faces: { name: string }[] } | null } }[] } } }).__neocad.bodies;
    return b.settled && b.views().some((v) => v.result.solid?.faces.some((f) => f.name.startsWith("e3.")));
  }, null, { timeout: 60_000 });
  await app.page.waitForTimeout(300);
  const wall = t[0] > 0 ? [60, 20, 7] : [0, 20, 7];
  const camera = await app.page.evaluate(() => JSON.stringify((window as never as { __neocad: { engine: { view: unknown } } }).__neocad.engine.view));
  assert.ok(await chamferPixel(), "the chamfer's face is in sight");
  return { wall, camera };
}

/** A pixel on the chamfer's face with nothing nearer, in the view as it is now — or null. */
const chamferPixel = (): Promise<[number, number] | null> => app.page.evaluate(async () => {
  const n = (window as never as { __neocad: { engine: { view: unknown }; bodies: {
    views(): { faces: { face: number; centroid: number[] }[]; result: { solid: { faces: { name: string }[] } } }[];
    faceAt(v: unknown, x: number, y: number): { name: string } | null } } }).__neocad;
  const path = "/src/view.ts";
  const { worldToScreen } = await import(path);
  for (const v of n.bodies.views()) {
    for (const t of v.faces) {
      if (!v.result.solid.faces[t.face].name.startsWith("e3.")) continue;
      const [x, y] = worldToScreen(n.engine.view, t.centroid);
      if (n.bodies.faceAt(n.engine.view, x, y)?.name.startsWith("e3.")) return [x, y] as [number, number];
    }
  }
  return null;
});

let solid: { wall: number[]; camera: string };

test("a filleted block's side wall: picked with the sketch tool, the view square to it, a circle drawn on it held there", { skip }, async () => {
  solid = await block();
  await shot("6-block-filleted-chamfered");
  await app.page.click('#toolbar button[data-tool="sketch"]');
  await app.page.waitForTimeout(250);
  const [sx, sy] = await app.screenOf(solid.wall);
  await clickAt(sx, sy);
  await app.page.waitForFunction(() => (document.getElementById("mode") as HTMLElement).dataset.where !== "", null, { timeout: 5000 });
  const wp = await value("workplane()") as string;
  assert.match(wp, /^p\d+\.p\d+\.p\d+$/, "the wall's own three points: it follows the block");
  assert.equal((await chip()).where, "on e1's side");
  const n = await value(`model.planeValues(${JSON.stringify(wp)}).n`) as number[];
  assert.ok(near(await toward(), n), `square to the wall: ${await toward()} vs ${n}`);
  await app.page.click('#toolbar button[data-tool="circle"]');
  await app.page.waitForTimeout(200);
  const [cx, cy] = await app.screenOf(solid.wall);
  await drag([cx, cy], [cx + 14, cy]);
  const pts = await heldOn(wp);
  const fresh = pts.filter((p) => p.held);
  assert.equal(fresh.length, 1, "the circle's centre, held on the wall");
  assert.ok(fresh[0].off < 1e-6);
  const circle = await value('[...model.entities.values()].find((e) => e.kind === "circle").name') as string;
  assert.equal(await value(`[...model.relations.values()].some((r) => r.op === "parallel" && r.args[0] === "${circle}" && r.args[1] === "${wp}")`), true,
    "its normal par to the wall's");
  await app.type('arm("select")');
  await shot("7-circle-on-the-filleted-wall");
});

test("the chamfer's face, which no loop bounds: a frame made there, the work plane, the view square to it — no feature", { skip }, async () => {
  await app.page.click("#mode .done");
  // The view the block was first seen in, the chamfer's face toward it.
  await app.page.evaluate((c) => {
    const n = (window as never as { __neocad: { engine: { view: object }; render(): void } }).__neocad;
    Object.assign(n.engine.view, JSON.parse(c));
    n.render();
  }, solid.camera);
  await app.page.waitForTimeout(200);
  const features = await value("model.features.size") as number;
  await app.page.click('#toolbar button[data-tool="sketch"]');
  await app.page.waitForTimeout(250);
  const at = await chamferPixel();
  assert.ok(at, "the chamfer's face in sight again");
  await app.page.mouse.move(...(Object.values(await app.at(...at)) as [number, number]), { steps: 3 });
  await app.page.waitForTimeout(150);
  await shot("8-chamfer-hovered", true);
  await clickAt(...at);
  await app.page.waitForFunction(() => (document.getElementById("mode") as HTMLElement).dataset.where !== "", null, { timeout: 5000 });
  const wp = await value("workplane()") as string;
  assert.equal(await value(`model.planeKind(${JSON.stringify(wp)})`), "frame");
  assert.match((await typedLines()).at(-1)!, /^workplane\(frame\(pt\(/);
  assert.equal(await value("model.features.size"), features, "no feature made");
  const n = await value(`model.planeValues(${JSON.stringify(wp)}).n`) as number[];
  assert.ok(Math.abs(Math.abs(n[2]) - Math.SQRT1_2) < 1e-3, `a 45° face: ${n}`);
  assert.ok(near(await toward(), n, 1e-6), "square to it");
  await shot("9-on-the-chamfer");
});
