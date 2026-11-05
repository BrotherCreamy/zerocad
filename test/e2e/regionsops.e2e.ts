// Regions as operations (docs/plans/regions-as-operations.md), driven the way
// a user drives them. The owner: *"there should be no such thing as a negative
// face. a face is just a face"*.
//
// A plate and two circles inside it, typed. The region tool: a click on the
// plate's face makes rg1, a click in each circle subtracts it — three typed
// lines, the region in hand drawn with its two holes. The organiser's Regions
// row says `rg1 = l1–l4 − c1 − c2`. The extrude tool: a click inside rg1 takes
// the region, ✓ — a solid with two holes. The organiser's *Edit rg1* arms the
// region tool on it; Add pressed, a click on the second circle (under the lid,
// read on the region's plane) puts it back — the solid follows. One Ctrl+Z
// takes the edit away; save and open give the same model. Then the same under
// a finger on an iPhone 13.
//
// Set NEOCAD_E2E_SHOTS to a directory to keep the screenshots, and look at
// them. One app per device, tests in order: the states are cumulative.

import { test, before, after } from "node:test";
import assert from "node:assert/strict";
import { mkdirSync } from "node:fs";
import { join } from "node:path";
import { openApp, axisFrame, confirmAndRelease, type AppContext } from "./harness.ts";
import { fingers } from "./fingers.ts";

const SHOTS = process.env.NEOCAD_E2E_SHOTS;
async function shot(app: AppContext, name: string): Promise<void> {
  if (!SHOTS) return;
  mkdirSync(SHOTS, { recursive: true });
  await app.page.waitForTimeout(200);
  await app.page.screenshot({ path: join(SHOTS, `regionsops-${name}.png`) });
}

const PANE = '.panel[data-panel="organiser"]';
const row = (name: string) => `${PANE} .orow[data-name="${name}"]`;

/** The plate (±60 × ±40) and two circles of radius 12 in it, typed, at z = 0 — the world's x–y plane, the view's. */
const SKETCH = [
  "q = [pt(-60, -40, 0), pt(60, -40, 0), pt(60, 40, 0), pt(-60, 40, 0)]",
  "edges = [0, 1, 2, 3].map((i) => ln(q[i], q[(i + 1) % 4]))",
  "h1 = circ(pt(-25, 0, 0), 12); h2 = circ(pt(25, 0, 0), 12)",
];
/** Inside the plate, clear of both circles and of the frame's marker; inside each circle, clear of its centre's dot. */
const PLATE = [-45, 28, 0], C1 = [-20, 4, 0], C2 = [30, 4, 0];

const value = async (app: AppContext, src: string) => (await app.repl(src)).value;
const loopsOf = (app: AppContext, e: string) => value(app, `model.featureOf(${JSON.stringify(e)}).loops.length`) as Promise<number>;
const chain = (app: AppContext) => value(app, `ls().find((l) => l.startsWith("rg1 = ")) ?? ""`) as Promise<string>;
const typedLines = (app: AppContext) => app.page.$$eval("#log .in", (els) => els.map((e) => (e.textContent ?? "").replace(/^> /, "")));
/** Whether a solid's face is drawn at a world point, in the faces picture. */
async function faced(app: AppContext, world: number[]): Promise<boolean> {
  const [x, y] = await app.screenOf(world);
  return (await app.pixel(x + 0.5, y + 0.5, "faces"))[3] > 0;
}

async function regionRows(app: AppContext): Promise<[string, string][]> {
  return app.page.$$eval(`${PANE} .osect[data-section="regions"] .orow`, (els) => els.map((el) => [
    el.querySelector(".oname")?.textContent ?? "",
    el.textContent ?? "",
  ] as [string, string]));
}

// --- the mouse -------------------------------------------------------------------

let app: AppContext;
before(async () => {
  app = await openApp();
  await axisFrame(app, [-150, -110]);
});
after(async () => {
  assert.deepEqual(app.pageErrors, [], "nothing the page threw went uncaught");
  await app.close();
});

async function click(world: number[]): Promise<void> {
  const [sx, sy] = await app.screenOf(world);
  const at = await app.at(sx, sy);
  await app.page.mouse.move(at.x, at.y, { steps: 3 });
  await app.page.waitForTimeout(60);
  await app.page.mouse.down();
  await app.page.mouse.up();
  await app.page.waitForTimeout(350);
}

async function park(): Promise<void> {
  const at = await app.at(760, 110);
  await app.page.mouse.move(at.x, at.y);
  await app.page.waitForTimeout(150);
}

async function key(k: string): Promise<void> {
  await app.page.fill("#cmd", "");
  await app.page.keyboard.press(k);
  await app.page.waitForTimeout(350);
}

test("the region tool: a click on the plate makes rg1, a click in each circle subtracts it — one typed line each", async () => {
  for (const line of SKETCH) await app.type(line);
  const [h1, h2] = [await value(app, "h1"), await value(app, "h2")] as string[];
  await app.type("region");
  assert.equal((await app.model()).activeTool, "region");
  await park(); // the chip is drawn with the frame
  assert.equal(await app.page.$eval("#mode", (el) => (el as HTMLElement).dataset.next), "click a face to make a region of it");
  await click(PLATE);
  await click(C1);
  await click(C2);
  const typed = await typedLines(app);
  assert.match(typed.at(-3)!, /^region\("l\d+"\)$/);
  assert.deepEqual(typed.slice(-2), [`subtract("rg1", "${h1}")`, `subtract("rg1", "${h2}")`]);
  assert.match(await chain(app), new RegExp(`^rg1 = l\\d+–l\\d+ − ${h1} − ${h2}$`));
  assert.equal(await app.page.$eval("#mode", (el) => (el as HTMLElement).dataset.next), "click a face to subtract rg1");
  await park();
  // The region in hand drawn with its holes clear: the green on the plate, none in a circle.
  const [px, py] = await app.screenOf(PLATE);
  const [cx, cy] = await app.screenOf(C1);
  const plate = await app.pixel(px, py, "drawing");
  const hole = await app.pixel(cx, cy, "drawing");
  assert.ok(plate[3] > 60 && plate[1] > plate[0], `the region tinted: ${plate}`);
  assert.ok(hole[3] < plate[3], `the subtracted circle clearer: ${hole} against ${plate}`);
  await shot(app, "1-two-subtracted");
  await key("Escape");
  await key("Escape");
  assert.equal((await app.model()).activeTool, null);
});

test("the organiser lists Regions: rg1's row is its chain, and the eye hides the region's tint", async () => {
  const rows = await regionRows(app);
  assert.equal(rows.length, 1);
  assert.equal(rows[0][0], "rg1");
  assert.match(rows[0][1], /rg1.*− c\d+ − c\d+/);
  await park();
  const [px, py] = await app.screenOf(PLATE);
  const shown = await app.pixel(px, py, "drawing");
  assert.ok(shown[3] > 0, `a region standing ready is tinted: ${shown}`);
  await shot(app, "2-organiser-row");
  await app.page.click(`${row("rg1")} .oeye`);
  await app.page.waitForTimeout(250);
  assert.equal((await typedLines(app)).at(-1), 'hide("rg1")');
  assert.equal((await app.pixel(px, py, "drawing"))[3], 0, "hidden: no tint");
  await app.page.click(`${row("rg1")} .oeye`);
  await app.page.waitForTimeout(250);
  assert.equal((await typedLines(app)).at(-1), 'show("rg1")');
});

test("the extrude tool: a click inside rg1 takes the region, ✓ — a solid with its two holes", async () => {
  await app.type('arm("extrude", { depth: 20 })');
  await click(PLATE);
  await confirmAndRelease(app);
  assert.match((await typedLines(app)).find((l) => l.startsWith("extrude("))!, /^extrude\("rg1", 20\)$/);
  assert.equal(await loopsOf(app, "e1"), 3, "the outline and the two circles the region subtracts");
  await park();
  assert.equal(await faced(app, PLATE), true);
  assert.equal(await faced(app, C1), false, "straight down the first hole");
  assert.equal(await faced(app, C2), false, "and the second");
  await shot(app, "3-extruded-two-holes");
});

test("Edit rg1 from the organiser, Add pressed, a click on the circle under the lid: the region and the solid follow; Ctrl+Z undoes it", async () => {
  const before = await value(app, "save()");
  await app.page.click(`${row("rg1")} .oname`, { button: "right" });
  await app.page.waitForTimeout(250);
  const handle = await app.page.evaluateHandle(() =>
    Array.from(document.querySelectorAll("#ctxmenu .item")).find((el) => el.firstElementChild?.textContent === "Edit rg1") ?? null);
  assert.ok(handle.asElement(), "the row's menu has Edit rg1");
  await handle.asElement()!.click();
  await app.page.waitForTimeout(300);
  assert.equal((await app.model()).activeTool, "region");
  await park();
  assert.equal(await app.page.$eval("#mode", (el) => (el as HTMLElement).dataset.next), "click a face to subtract rg1", "armed with rg1 in hand");
  await app.page.click('#options .ochoose[data-choice="add"]');
  await app.page.waitForTimeout(250);
  await park();
  assert.equal(await app.page.$eval("#mode", (el) => (el as HTMLElement).dataset.next), "click a face to add rg1");
  await click(C2);
  const h2 = await value(app, "h2");
  assert.equal((await typedLines(app)).at(-1), `add("rg1", "${h2}")`);
  assert.equal(await loopsOf(app, "e1"), 2, "regenerated: one hole now");
  await key("Escape");
  await key("Escape");
  await park();
  assert.equal(await faced(app, C2), true, "the second hole filled");
  assert.equal(await faced(app, C1), false, "the first still open");
  await shot(app, "4-region-edited-solid-follows");
  await key("Control+z");
  await park();
  assert.equal(await loopsOf(app, "e1"), 3, "one Ctrl+Z: both holes again");
  assert.equal(await value(app, "save()"), before, "exactly the model before the edit");
});

test("saved and opened: the same regions, the same solid", async () => {
  const text = await value(app, "save()") as string;
  const r = await app.repl(`open(${JSON.stringify(text)})`);
  assert.equal(r.ok, true, String(r.error));
  await app.page.waitForTimeout(400);
  assert.equal(await value(app, "save()"), text, "byte for byte");
  assert.match(await chain(app), /^rg1 = l\d+–l\d+ − c\d+ − c\d+  \(e1 on it\)$/);
  assert.equal(await loopsOf(app, "e1"), 3);
  assert.equal((await regionRows(app)).length, 1, "the organiser's row again");
});

// --- a finger -------------------------------------------------------------------

test("iPhone 13: region, two subtracts and the extrude by taps; the organiser's row; Edit and Add by taps; undo, save and open", async () => {
  const p = await openApp({ device: "iPhone 13" });
  try {
    await axisFrame(p, [-150, -110]);
    for (const line of SKETCH) await p.type(line);
    await p.type("zoom(0.6)");
    const f = await fingers(p);
    const tap = async (world: number[]) => {
      const [sx, sy] = await p.screenOf(world);
      await p.at(sx, sy); // refuses a point a panel covers
      await f.tap(sx, sy);
      await p.page.waitForTimeout(400);
    };
    await p.type("region");
    await tap(PLATE);
    assert.equal(await p.page.$eval("#mode", (el) => (el as HTMLElement).dataset.next), "tap a face to subtract rg1", "a finger's word");
    await tap(C1);
    await tap(C2);
    const chained = await value(p, `ls().find((l) => l.startsWith("rg1 = ")) ?? ""`) as string;
    assert.match(chained, /^rg1 = l\d+–l\d+ − c\d+ − c\d+$/);
    await shot(p, "5-phone-two-subtracted");
    await p.type("cancel()");
    await p.type('arm("extrude", { depth: 20 })');
    await tap(PLATE);
    await confirmAndRelease(p);
    assert.equal(await value(p, 'model.featureOf("e1").loops.length'), 3);
    assert.equal(await value(p, 'model.featureOf("e1").region'), "rg1");
    const rows = await p.page.$$eval(`${PANE} .osect[data-section="regions"] .orow .oname`, (els) => els.map((e) => e.textContent));
    assert.deepEqual(rows, ["rg1"], "the organiser's row, on a phone");
    // The row tapped, then Edit typed (the row's menu is a long-press, organiser.e2e.ts's),
    // then Add by its button, then a tap on the second circle.
    const [rx, ry] = await p.page.$eval(`${row("rg1")} .oname`, (el) => {
      const r = el.getBoundingClientRect();
      return [r.x + r.width / 2, r.y + r.height / 2];
    });
    await p.page.touchscreen.tap(rx, ry); // a tap on the row selects what its faces run along
    await p.page.waitForTimeout(200);
    await p.type('edit("rg1")');
    assert.equal((await p.model()).activeTool, "region");
    const [ax, ay] = await p.page.$eval('#options .ochoose[data-choice="add"]', (el) => {
      const r = el.getBoundingClientRect();
      return [r.x + r.width / 2, r.y + r.height / 2];
    });
    await p.page.touchscreen.tap(ax, ay);
    await p.page.waitForTimeout(250);
    await tap(C2);
    assert.equal(await value(p, 'model.featureOf("e1").loops.length'), 2, "the solid follows its region");
    await shot(p, "6-phone-region-edited");
    await p.type("undo()");
    assert.equal(await value(p, 'model.featureOf("e1").loops.length'), 3, "undone");
    const text = await value(p, "save()") as string;
    assert.equal((await p.repl(`open(${JSON.stringify(text)})`)).ok, true);
    await p.page.waitForTimeout(400);
    assert.equal(await value(p, "save()"), text);
    assert.deepEqual(p.pageErrors, []);
  } finally {
    await p.close();
  }
});
