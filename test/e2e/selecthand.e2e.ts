// Select and the Hand (docs/plans/select-hand.md; the owner: "there is no
// hand/selction tool. would be nice since a lot of people are used to that").
//
// The toolbar's first two buttons. **Select** is "no tool" given a button —
// lit whenever nothing is armed, and pressing it puts the armed tool down;
// **the Hand** pans with a left-drag or one finger from wherever it lands,
// geometry included, and moves nothing; **Space** held is a Hand over the
// armed tool. With a mouse on a desktop window and under fingers in iPhone 13
// emulation (portrait, and landscape for the toolbar's picture).
//
// Set NEOCAD_E2E_SHOTS to a directory to keep the screenshots: the toolbar in
// both orientations, at the default size and at 70 %, and on a desktop. Look
// at them.

import { test, before, after } from "node:test";
import assert from "node:assert/strict";
import { mkdirSync } from "node:fs";
import { join } from "node:path";
import { openApp, axisFrame, PARKED, type AppContext, forgetAutosave } from "./harness.ts";
import { fingers, type Fingers } from "./fingers.ts";

const SHOTS = process.env.NEOCAD_E2E_SHOTS;
/** The whole window, and the toolbar at its own size with a margin of what is round it. */
async function shot(app: AppContext, name: string): Promise<void> {
  if (!SHOTS) return;
  mkdirSync(SHOTS, { recursive: true });
  await app.page.waitForTimeout(100);
  await app.page.screenshot({ path: join(SHOTS, `selecthand-${name}.png`) });
  const r = await app.page.$eval('.panel[data-panel="toolbar"]', (el) => {
    const b = el.getBoundingClientRect();
    return { x: b.x, y: b.y, width: b.width, height: b.height };
  });
  const m = 12;
  const clip = { x: Math.max(0, r.x - m), y: Math.max(0, r.y - m), width: r.width + 2 * m, height: r.height + 2 * m };
  await app.page.screenshot({ path: join(SHOTS, `selecthand-${name}-toolbar.png`), clip });
}

const lit = (app: AppContext) => app.page.$$eval("#toolbar button[aria-pressed=true]", (els) =>
  els.map((el) => (el as HTMLElement).dataset.tool));

const buttons = (app: AppContext) => app.page.$$eval("#toolbar button", (els) => els.map((el) => ({
  tool: (el as HTMLElement).dataset.tool,
  glyph: el.querySelector(":scope > svg")?.getAttribute("data-glyph") ?? null,
  // The tooltip, not a native title (docs/plans/tooltips-rgb-frames.md).
  hint: el.hasAttribute("data-tip") && !el.hasAttribute("title"),
})));

/** A fresh page, a parked sketch frame, and a 50×30 rectangle round the middle of the view (p1…p4, l1…l4). */
async function fresh(app: AppContext): Promise<void> {
  await app.page.evaluate(() => localStorage.clear());
  await forgetAutosave(app.page); // a reload here means the app's first start
  await app.page.reload({ waitUntil: "networkidle" });
  await app.page.waitForFunction(() => document.getElementById("status")?.textContent?.includes("ready"), null, { timeout: 20_000 });
  await axisFrame(app, PARKED);
  await app.type("pt(-25,-15); pt(25,-15); pt(25,15); pt(-25,15)");
  await app.type('ln("p1","p2"); ln("p2","p3"); ln("p3","p4"); ln("p4","p1")');
}

/** A world point's place on the canvas, checked to be canvas and not a panel. */
async function onCanvas(app: AppContext, world: number[]): Promise<[number, number]> {
  const [x, y] = await app.screenOf(world);
  await app.at(x, y); // throws under a panel
  return [x, y];
}

/** The model once `want` holds of it, within a few seconds — for what a press typed through `submit`. */
async function settled(app: AppContext, want: (m: Awaited<ReturnType<AppContext["model"]>>) => boolean, what: string) {
  const deadline = Date.now() + 5000;
  for (;;) {
    const m = await app.model();
    if (want(m)) return m;
    if (Date.now() > deadline) assert.fail(`${what}: ${JSON.stringify({ size: m.size, activeTool: m.activeTool })}`);
    await app.page.waitForTimeout(50);
  }
}

async function litBecomes(app: AppContext, want: string, what: string): Promise<void> {
  const deadline = Date.now() + 5000;
  while (JSON.stringify(await lit(app)) !== JSON.stringify([want])) {
    if (Date.now() > deadline) assert.fail(`${what}: lit ${JSON.stringify(await lit(app))}`);
    await app.page.waitForTimeout(50);
  }
}

const features = (app: AppContext) => app.page.evaluate(() =>
  (window as unknown as { __neocad: { model: { features: Map<string, unknown> } } }).__neocad.model.features.size);

const optionsShown = (app: AppContext) => app.page.$eval('.panel[data-panel="options"]', (el) => !(el as HTMLElement).hidden);

// --- a mouse, on a desktop ------------------------------------------------------

let desk: AppContext;
before(async () => { desk = await openApp(); });
after(async () => { await desk.close(); });

test("desktop: Select and the Hand head the toolbar, each its own glyph and the command it types; Select is lit at start and after Escape", async () => {
  await fresh(desk);
  const bs = await buttons(desk);
  assert.equal(bs.length, 13, "two more than the eleven tools — one circle and one arc, dimension and constrain");
  assert.deepEqual(bs.slice(0, 3).map((b) => b.tool), ["select", "hand", "point"], "first, then the tools as they were");
  assert.deepEqual(bs.slice(0, 2).map((b) => [b.glyph, b.hint]),
    [["select", true], ["hand", true]]);
  assert.deepEqual(await lit(desk), ["select"], "nothing armed: Select is lit");
  await shot(desk, "desktop");

  await desk.page.click('#toolbar button[data-tool="rectangle"]');
  assert.deepEqual(await lit(desk), ["rectangle"], "a tool armed: only it");
  await desk.page.keyboard.press("Escape");
  await litBecomes(desk, "select", "Escape lights Select again");

  // A typed `cancel()` too, and the bare name, as any tool's bare name arms it.
  await desk.type("hand");
  await litBecomes(desk, "hand", "the bare name arms the Hand");
  assert.match(await desk.log(), /armed: hand/);
  await desk.type("cancel()");
  await litBecomes(desk, "select", "cancel() lights Select");

  await desk.type("ui({ scale: 0.7 })");
  await shot(desk, "desktop-70");
  await desk.type('ui({ scale: "default" })');
});

test("desktop: clicking Select puts a half-picked extrude down — no solid, the dialog gone — and types arm(\"select\")", async () => {
  await fresh(desk);
  await desk.page.click('#toolbar button[data-tool="extrude"]');
  await settled(desk, (m) => m.activeTool === "extrude", "the button armed extrude");
  const [x, y] = await onCanvas(desk, [-12, 8, 0]);
  await desk.page.mouse.click(x, y);
  await desk.page.waitForFunction(() => !(document.querySelector("#options .oact button.ok") as HTMLButtonElement | null)?.disabled);
  assert.equal(await optionsShown(desk), true, "the dialog is up with a pick in it");

  await desk.page.click('#toolbar button[data-tool="select"]');
  await settled(desk, (m) => m.activeTool === null, "Select put extrude down");
  assert.match(await desk.log(), /> arm\("select"\)/, "typed through the command line");
  assert.deepEqual(await lit(desk), ["select"]);
  assert.equal(await features(desk), 0, "nothing was built");
  assert.equal(await optionsShown(desk), false, "and the dialog has gone");
});

test("desktop: with the Hand a left-drag that starts on a line pans, the line unmoved; a click selects; Select keeps the selection", async () => {
  await fresh(desk);
  await desk.page.click('#toolbar button[data-tool="hand"]');
  assert.deepEqual(await lit(desk), ["hand"]);
  assert.match(await desk.log(), /> arm\("hand"\)/);
  await desk.page.evaluate(() => (document.activeElement as HTMLElement | null)?.blur());
  const before = await desk.model();
  const [x, y] = await onCanvas(desk, [0, -15, 0]); // the middle of l1
  assert.equal(await desk.page.$eval("#cv", (el) => getComputedStyle(el).cursor), "grab", "an open hand over the drawing");
  await desk.page.mouse.move(x, y);
  await desk.page.mouse.down();
  await desk.page.mouse.move(x + 80, y + 50, { steps: 8 });
  await desk.page.mouse.up();
  const after = await desk.model();
  assert.deepEqual(after.points, before.points, "no point moved");
  const [x1, y1] = await desk.screenOf([0, -15, 0]);
  assert.ok(Math.abs(x1 - (x + 80)) <= 4 && Math.abs(y1 - (y + 50)) <= 4, `the line went with the hand: ${x1 - x}, ${y1 - y}`);
  assert.deepEqual(after.journalOps, before.journalOps, "and nothing was journalled");
  assert.deepEqual(await desk.selection(), [], "a pan selects nothing");
  await shot(desk, "desktop-hand-panned");

  await desk.page.mouse.click(x1, y1);
  assert.deepEqual(await desk.selection(), ["l1"], "a click under the Hand selects");
  assert.deepEqual(await lit(desk), ["hand"], "and the Hand stays armed");
  await desk.page.click('#toolbar button[data-tool="select"]');
  await litBecomes(desk, "select", "Select");
  assert.deepEqual(await desk.selection(), ["l1"], "putting the Hand down keeps the selection");
});

test("desktop: Space held is a Hand over the rectangle tool — a drag pans and draws nothing — and the rectangle is back when it comes up", async () => {
  await fresh(desk);
  await desk.page.click('#toolbar button[data-tool="rectangle"]');
  // The command line has the focus after a button: its Space is a space.
  assert.equal(await desk.page.evaluate(() => document.activeElement?.id), "cmd");
  await desk.page.keyboard.down("Space");
  assert.deepEqual(await lit(desk), ["rectangle"], "no Hand while the command line has the focus");
  await desk.page.keyboard.up("Space");
  assert.equal(await desk.page.inputValue("#cmd"), " ", "the space was typed");
  await desk.page.fill("#cmd", "");
  await desk.page.evaluate(() => (document.activeElement as HTMLElement | null)?.blur());

  const before = await desk.model();
  await desk.page.keyboard.down("Space");
  await litBecomes(desk, "hand", "Space lights the Hand");
  const [x, y] = await onCanvas(desk, [0, 0, 0]);
  await desk.page.mouse.move(x, y);
  await desk.page.mouse.down();
  await desk.page.mouse.move(x - 60, y + 40, { steps: 8 });
  await desk.page.mouse.up();
  await desk.page.keyboard.up("Space");
  await litBecomes(desk, "rectangle", "the rectangle is lit again");
  const after = await desk.model();
  assert.equal(after.size, before.size, "no rectangle was drawn");
  assert.equal(after.activeTool, "rectangle", "and it is still armed");
  const [x1, y1] = await desk.screenOf([0, 0, 0]);
  assert.ok(Math.abs(x1 - (x - 60)) <= 4 && Math.abs(y1 - (y + 40)) <= 4, `panned: ${x1 - x}, ${y1 - y}`);
  assert.equal(await desk.page.inputValue("#cmd"), "", "and nothing went into the command line");

  // The next drag is the rectangle's own.
  const [ax, ay] = await onCanvas(desk, [40, 30, 0]);
  await desk.page.mouse.move(ax, ay);
  await desk.page.mouse.down();
  await desk.page.mouse.move(ax + 60, ay + 40, { steps: 6 });
  await desk.page.mouse.up();
  await settled(desk, (m) => m.size === before.size + 8, "the rectangle drew");
});

// --- fingers, on an iPhone ------------------------------------------------------

let phone: AppContext;
let f: Fingers;
before(async () => { phone = await openApp({ device: "iPhone 13" }); });
after(async () => { await phone.close(); });

/** A fresh phone page, the command line's keyboard put away as a finger on the drawing would. */
async function freshPhone(): Promise<void> {
  await fresh(phone);
  await phone.page.evaluate(() => (document.activeElement as HTMLElement | null)?.blur());
  f = await fingers(phone);
}

/** A selector's middle, in canvas pixels. */
async function middleOf(selector: string): Promise<[number, number]> {
  return phone.page.$eval(selector, (el) => {
    const r = el.getBoundingClientRect();
    const c = document.getElementById("cv")!.getBoundingClientRect();
    return [r.x + r.width / 2 - c.x, r.y + r.height / 2 - c.y] as [number, number];
  });
}

/**
 * One finger from `from` to `to`, resting before it lifts: lifted mid-glide
 * the drag is a fling to Chromium, which then swallows the next tap (see
 * touch.e2e.ts, where it was measured).
 */
async function slide(from: [number, number], to: [number, number]): Promise<void> {
  await f.down(from);
  await f.glide(8, to);
  await phone.page.waitForTimeout(120);
  await f.move(to);
  await phone.page.waitForTimeout(120);
  await f.up();
}

test("iPhone: Select is lit at start, and one finger on empty canvas orbits without the Hand and pans with it", async () => {
  await freshPhone();
  assert.equal((await buttons(phone)).length, 13);
  assert.deepEqual(await lit(phone), ["select"]);
  await shot(phone, "portrait");

  const v0 = (await phone.model()).view;
  // Below the log, which since docs/plans/everything-fits.md is the strip's
  // width at the top right, under the logo's row, rather than the screen's.
  const from = await onCanvas(phone, [60, 40, 0]);
  await slide(from, [from[0] + 40, from[1] + 30]);
  const v1 = (await phone.model()).view;
  assert.notDeepEqual([v1.right, v1.up], [v0.right, v0.up], "without the Hand one finger turns the drawing");

  await f.tap(...await middleOf('#toolbar button[data-tool="hand"]'));
  await litBecomes(phone, "hand", "a tap armed the Hand");
  const from2 = await onCanvas(phone, [0, 40, 0]);
  const at0 = await phone.screenOf([0, 0, 0]);
  await slide(from2, [from2[0] + 40, from2[1] + 30]);
  const v2 = (await phone.model()).view;
  assert.deepEqual([v2.right, v2.up], [v1.right, v1.up], "with it, nothing turns");
  const at1 = await phone.screenOf([0, 0, 0]);
  assert.ok(Math.abs(at1[0] - at0[0] - 40) <= 9 && Math.abs(at1[1] - at0[1] - 30) <= 9,
    `the drawing went with the finger: ${at1[0] - at0[0]}, ${at1[1] - at0[1]}`);
  await shot(phone, "portrait-hand");
});

test("iPhone: with the Hand a finger that starts on a line pans, and the line has not moved; the strip's Cancel lights Select", async () => {
  await freshPhone();
  await f.tap(...await middleOf('#toolbar button[data-tool="hand"]'));
  await litBecomes(phone, "hand", "a tap armed the Hand");
  const before = await phone.model();
  const [x, y] = await onCanvas(phone, [25, 0, 0]); // the middle of l2
  await slide([x, y], [x - 30, y + 40]);
  const after = await phone.model();
  assert.deepEqual(after.points, before.points, "no point moved");
  const [x1, y1] = await phone.screenOf([25, 0, 0]);
  assert.ok(Math.abs(x1 - (x - 30)) <= 9 && Math.abs(y1 - (y + 40)) <= 9, `the line went with the finger: ${x1 - x}, ${y1 - y}`);

  await f.tap(...await middleOf('#actions button[data-action="cancel"]'));
  await litBecomes(phone, "select", "Cancel put the Hand down");
  assert.match(await phone.log(), /> cancel\(\)/);
});

test("iPhone: tapping Select puts a half-picked extrude down", async () => {
  await freshPhone();
  await f.tap(...await middleOf('#toolbar button[data-tool="extrude"]'));
  await settled(phone, (m) => m.activeTool === "extrude", "the button armed extrude");
  await f.tap(...await onCanvas(phone, [-12, 8, 0]));
  await phone.page.waitForFunction(() => !(document.querySelector("#options .oact button.ok") as HTMLButtonElement | null)?.disabled);
  await f.tap(...await middleOf('#toolbar button[data-tool="select"]'));
  await settled(phone, (m) => m.activeTool === null, "Select put extrude down");
  assert.match(await phone.log(), /> arm\("select"\)/);
  assert.equal(await features(phone), 0, "nothing was built");
  assert.equal(await optionsShown(phone), false, "and the dialog has gone");
  assert.deepEqual(await lit(phone), ["select"]);

  await phone.type("ui({ scale: 0.7 })");
  await phone.page.evaluate(() => (document.activeElement as HTMLElement | null)?.blur());
  await shot(phone, "portrait-70");
});

// --- the toolbar in landscape -----------------------------------------------------

test("iPhone landscape: the two more buttons fit the row along the bottom, every one wholly on screen", async () => {
  const land = await openApp({ device: "iPhone 13 landscape" });
  try {
    await fresh(land);
    await land.page.evaluate(() => (document.activeElement as HTMLElement | null)?.blur());
    const look = async () => land.page.evaluate(() => {
      const bar = document.querySelector('.panel[data-panel="toolbar"]')!.getBoundingClientRect();
      const bs = Array.from(document.querySelectorAll("#toolbar button")).map((b) => b.getBoundingClientRect());
      return {
        row: bar.width > bar.height,
        n: bs.length,
        inside: bs.every((b) => b.left >= 0 && b.top >= 0 && b.right <= innerWidth && b.bottom <= innerHeight
          && b.left >= bar.left - 0.5 && b.right <= bar.right + 0.5),
      };
    });
    assert.deepEqual(await look(), { row: true, n: 11, inside: true });
    assert.deepEqual(await lit(land), ["select"]);
    await shot(land, "landscape");
    await land.type("ui({ scale: 0.7 })");
    await land.page.evaluate(() => (document.activeElement as HTMLElement | null)?.blur());
    assert.deepEqual(await look(), { row: true, n: 11, inside: true }, "and at 70 %");
    await shot(land, "landscape-70");
  } finally {
    await land.close();
  }
});
