// The solid tools on an iPhone, by finger (docs/plans/solid-tools-intuitive.md;
// the owner, who uses the app mostly on one: "Flip button." and "I'm still not
// clear on how to use the extrude cut tool."): a plate drawn with a finger,
// its depth handle dragged, ⇅ tapped — the preview and the solid the other
// way — and flipped back from the menu on its face; a circle on its lid, Cut
// held out of the extrude's button and tapped, ✓ — a hole with no minus sign;
// Through all tapped for a second; a revolve about the origin's own axis,
// flipped. Set NEOCAD_E2E_SHOTS to keep the pictures; look at them.

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
  if (!built) return;
  app = await openApp({ device: "iPhone 13" });
  hand = await fingers(app);
});
after(async () => { if (built) await app.close(); });

const SHOTS = process.env.NEOCAD_E2E_SHOTS;
async function shot(name: string): Promise<void> {
  if (!SHOTS) return;
  mkdirSync(SHOTS, { recursive: true });
  await app.page.waitForTimeout(400);
  await app.page.screenshot({ path: join(SHOTS, `solidtools-iphone-${name}.png`) });
}

/** Types a line and lets go of the command line, as a hand does before touching the drawing again. */
async function type(line: string): Promise<void> {
  await app.type(line);
  await app.page.evaluate(() => (document.activeElement as HTMLElement | null)?.blur());
}

async function tapAt(world: number[]): Promise<void> {
  const [x, y] = await app.screenOf(world);
  await app.at(x, y); // refuses a point a panel covers
  await hand.tap(x, y);
  await app.page.waitForTimeout(300);
}

async function dragOn(a: number[], b: number[]): Promise<void> {
  const [p, q] = [await app.screenOf(a), await app.screenOf(b)];
  await app.at(...p);
  await hand.drag(p, q, 12);
  await app.page.waitForTimeout(300);
}

/** Taps a button of the chrome, as a finger does. */
async function tapButton(selector: string): Promise<void> {
  await app.page.tap(selector);
  await app.page.waitForTimeout(350);
}

async function middleOf(selector: string): Promise<[number, number]> {
  const box = await app.page.$eval("#cv", (el) => { const r = el.getBoundingClientRect(); return [r.x, r.y]; });
  return app.page.$eval(selector, (el, b) => {
    const r = el.getBoundingClientRect();
    return [r.x + r.width / 2 - b[0], r.y + r.height / 2 - b[1]] as [number, number];
  }, box);
}

type Neo = { __neocad: {
  bodies: { settled: boolean; views(): { features: string[]; result: { solid: { validity: { manifold: boolean; failures: number }; faces: { name: string }[] } } }[] };
  model: { journal: { op: string; args: unknown[] }[]; features: Map<string, { twins: string[][]; depth: string }>;
    entities: Map<string, { refs: string[] }>; coords(p: string): number[]; relations: Map<string, { args: unknown[] }> };
  engine: { active: { name: string; handle: { from: number[]; label: number[]; dir: number[] } | null } | null };
} };

async function faces(): Promise<{ valid: boolean; faces: string[] }> {
  await app.page.waitForFunction(() => (window as never as Neo).__neocad.bodies.settled, undefined, { timeout: 20_000 });
  return app.page.evaluate(() => {
    const v = (window as never as Neo).__neocad.bodies.views()[0];
    return { valid: v.result.solid.validity.manifold && v.result.solid.validity.failures === 0, faces: [...new Set(v.result.solid.faces.map((f) => f.name))].sort() };
  });
}

const lastExtrude = () => app.page.evaluate(() => (window as never as Neo).__neocad.model.journal.filter((e) => e.op === "extrude").at(-1)?.args ?? null);
const depthOf = (f: string) => app.page.evaluate((n) => {
  const m = (window as never as Neo).__neocad.model;
  return m.relations.get(m.features.get(n)!.depth)!.args[1] as number;
}, f);
/**
 * How far a feature's lid stands above its base, along z: a lid corner less
 * the base corner it twins. Measured off the base, not the ground: a
 * rectangle drawn on the ground is held there by nothing (free-entities.md),
 * and a `set` of the depth moves base and lid both, a little each — measured
 * here as 0.0143 of a change of 15 — so the ground is no fixed mark.
 */
const lidZ = (f: string) => app.page.evaluate((n) => {
  const m = (window as never as Neo).__neocad.model;
  const e = m.features.get(n)! as unknown as { twins: string[][]; loops: string[][] };
  return m.coords(m.entities.get(e.twins[0][0])!.refs[0])[2] - m.coords(m.entities.get(e.loops[0][0])!.refs[0])[2];
}, f);

const W = 30, H = 18;

test("on an iPhone: a plate drawn, its depth handle dragged, ⇅ tapped — the solid goes the other way; the menu's Flip direction turns it back", { skip }, async () => {
  await tapButton('#toolbar button[data-group="shapes"]');
  await dragOn([-W, -H, 0], [W, H, 0]);
  await tapButton('#toolbar button[data-group="sweep"]');
  // Off the origin, whose marker is under the middle: the plate, not an arm.
  await tapAt([12, 6, 0]);
  await app.page.waitForFunction(() => ((window as never as { __neocad: { engine: { active: { picks?: { size: number } } | null } } }).__neocad.engine.active?.picks?.size ?? 0) === 1,
    undefined, { timeout: 30_000 });
  // Seen square on, as a fresh sketch is: the lid says the solid comes out at you.
  await shot("1-extrude-square-on");
  await type("orbit(-0.6, -1.0)");
  const h = (await app.page.waitForFunction(() => (window as never as Neo).__neocad.engine.active?.handle ?? null, undefined, { timeout: 30_000 })).jsonValue() as
    Promise<{ from: number[]; label: number[]; dir: number[] }>;
  const handle = await h;
  // The handle by finger: along it, deeper; the panel's number follows when let go.
  const mid: [number, number] = [(handle.from[0] + handle.label[0]) / 2, (handle.from[1] + handle.label[1]) / 2];
  await hand.drag(mid, [mid[0] + handle.dir[0] * 40, mid[1] + handle.dir[1] * 40], 12);
  await app.page.waitForTimeout(400);
  const dragged = Number(await app.page.$eval('#options input.oval[data-option="depth"]', (f) => (f as HTMLInputElement).value));
  assert.ok(dragged > 10, `the finger made it deeper: ${dragged}`);
  await shot("2-handle-dragged");
  // ⇅ is a finger's target, beside the depth.
  const box = await app.page.$eval("#options button.oflip", (b) => { const r = b.getBoundingClientRect(); return [r.width, r.height]; });
  assert.ok(box[0] >= 25 && box[1] >= 18, `the flip is drawn at a size to tap: ${box}`);
  await tapButton("#options button.oflip");
  assert.equal(Number(await app.page.$eval('#options input.oval[data-option="depth"]', (f) => (f as HTMLInputElement).value)), -dragged);
  await shot("3-flipped");
  await tapButton("#options .oact button.ok");
  assert.equal((await lastExtrude())?.[1], -dragged, "the negated call");
  assert.ok(Math.abs(await lidZ("e1") + dragged) < 1e-6, "built below the sketch");
  // A held finger on the plate's face: Flip direction, beside Edit e1.
  const [x, y] = await app.screenOf([10, -H, -dragged / 2]);
  await app.at(x, y);
  await hand.hold(x, y, 700);
  await app.page.waitForFunction(() => !(document.querySelector("#ctxmenu") as HTMLElement).hidden);
  const items = await app.page.$$eval("#ctxmenu .item", (els) => els.map((i) => i.firstElementChild?.textContent ?? ""));
  assert.ok(items.includes("Flip direction") && items.includes("Edit e1"), `the face's menu: ${items}`);
  await shot("4-menu-flip-direction");
  await app.page.locator("#ctxmenu .item", { hasText: "Flip direction" }).first().tap();
  await app.page.waitForTimeout(400);
  assert.equal(await depthOf("e1"), dragged, "flipped back by the menu");
  // The plate at ten deep for what follows.
  await type(`set("${await app.page.evaluate(() => (window as never as Neo).__neocad.model.features.get("e1")!.depth)}.value", 10)`);
  assert.ok(Math.abs(await lidZ("e1") - 10) < 1e-6, `ten up: ${await lidZ("e1")}`);
});

test("on an iPhone: a circle on the lid, Cut held out of the extrude's button, ✓ — a hole, no minus sign typed; then Through all", { skip }, async () => {
  await type('lookAt("origin"); orbit(-0.6, -1.0)');
  await tapButton('#toolbar button[data-tool="sketch"]');
  await tapAt([W - 6, H - 6, 10]);
  await tapButton('#toolbar button[data-tool="circle"]');
  await dragOn([-14, 0, 10], [-9, 0, 10]);
  await type("orbit(-0.6, -1.0)");
  await hand.hold(...await middleOf('#toolbar button[data-group="sweep"]'), 700, true);
  await app.page.waitForFunction(() => { const f = document.querySelector("#flyout") as HTMLElement; return !f.hidden && f.dataset.group === "sweep"; });
  await shot("5-cut-in-the-flyout");
  await hand.up();
  await hand.tap(...await middleOf('#flyout button[data-tool="cut"]'));
  await app.page.waitForFunction(() => (window as never as Neo).__neocad.engine.active?.name === "cut");
  await tapAt([-14, 0, 10]);
  await app.page.waitForTimeout(500);
  await shot("6-cut-preview");
  assert.match((await app.page.textContent("#mode")) ?? "", /✓ to cut/);
  await tapButton("#options .oact button.ok");
  const args = await lastExtrude();
  assert.equal(args?.[1], -10, `into the plate, typed for the user: ${JSON.stringify(args)}`);
  let b = await faces();
  assert.ok(b.valid && b.faces.includes("e2.m0") && !b.faces.includes("e2.lid"), `a hole right through: ${b.faces}`);
  // A second, through all: tapped in the end row.
  const circlesBefore = (await app.model()).circles.length;
  await tapButton('#toolbar button[data-tool="circle"]');
  await dragOn([10, 0, 10], [14, 0, 10]);
  assert.equal((await app.model()).circles.length, circlesBefore + 1, `a second circle drawn by the finger: ${(await app.log()).slice(-300)}`);
  await type('arm("cut")');
  await tapAt([10, 0, 10]);
  await tapButton('#options .ochoose[data-choice="through"]');
  assert.equal(await app.page.$eval('#options .ochoose[data-choice="through"]', (x) => x.getAttribute("aria-pressed")), "true");
  await shot("7-through-all-preview");
  await tapButton("#options .oact button.ok");
  assert.deepEqual((await lastExtrude())?.at(-1), { mode: "cut", into: "e1", end: "through" });
  await type('set("d1.value", 16)'); // the plate deeper: still through
  b = await faces();
  assert.ok(b.valid && b.faces.includes("e3.m0") && !b.faces.includes("e3.lid"), `still through: ${b.faces} ${(await app.log()).slice(-900)}`);
  await type('workplane(null); zoom(2)');
  await shot("8-holes");
  assert.deepEqual(app.pageErrors, []);
});

test("on an iPhone: a revolve about the origin's own y axis, ⇅ tapped — the sweep turns the other way", { skip }, async () => {
  await app.close();
  app = await openApp({ device: "iPhone 13" });
  hand = await fingers(app);
  await tapButton('#toolbar button[data-group="shapes"]');
  await dragOn([10, 10, 0], [25, 35, 0]);
  await tapButton('#toolbar button[data-tool="revolve"]');
  await tapAt([17, 22, 0]);
  // The origin's y arm, a finger's reach out along it.
  const [o, y1] = [await app.screenOf([0, 0, 0]), await app.screenOf([0, 1, 0])];
  const len = Math.hypot(y1[0] - o[0], y1[1] - o[1]);
  const on: [number, number] = [o[0] + ((y1[0] - o[0]) / len) * 24, o[1] + ((y1[1] - o[1]) / len) * 24];
  await app.at(...on);
  await hand.tap(...on);
  await app.page.waitForTimeout(400);
  assert.doesNotMatch(await app.log(), /origin\.y is not in its plane/, "the origin's arm is taken (W9)");
  await app.page.tap('#options input.oval[data-option="angle"]');
  await app.page.fill('#options input.oval[data-option="angle"]', "3.14159");
  await app.page.evaluate(() => (document.activeElement as HTMLElement | null)?.blur());
  await app.page.waitForTimeout(300);
  await tapButton("#options button.oflip");
  await type("orbit(-0.6, -1.0)");
  await shot("9-revolve-flipped");
  await tapButton("#options .oact button.ok");
  const j = await app.page.evaluate(() => (window as never as Neo).__neocad.model.journal.filter((e) => e.op === "revolve").at(-1)!.args);
  assert.deepEqual([j[1], j[2]], ["origin.y", -3.14159]);
  assert.deepEqual(app.pageErrors, []);
});
