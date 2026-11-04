// A feature's region is its outline and the holes you said (docs/plans/
// explicit-regions.md), driven the way a user drives it. The owner: *"I don't
// think coplanarity should be used as an automatic basis for deciding which
// entities to include in a region."*
//
// A rectangle extruded, then a circle drawn inside it with the circle tool:
// the solid has no hole (the record and the faces picture both say so). Its
// right-click menu's *Add as hole to e1* cuts it; Ctrl+Z takes it away;
// redone, *Remove hole from e1* fills it again. *Edit e1* on the lid: the
// circle clicked in, the depth typed, ✓ — one Ctrl+Z undoes both. Then the
// creating dialog: a second rectangle with a circle inside, clicked — the
// hole proposed — the circle clicked out, the preview solid over it, ✓ — a
// solid with no hole.
//
// The circle is under the lid, and shaded a solid is opaque: nothing behind a
// face is picked. So its menu is opened in the hidden view, as
// construction.e2e.ts does; the edit dialog reads its clicks on the sketch
// plane, and works shaded.
//
// Set NEOCAD_E2E_SHOTS to a directory to keep the screenshots, and look at
// them. One app, tests in order: the states are cumulative.

import { test, before, after } from "node:test";
import assert from "node:assert/strict";
import { mkdirSync } from "node:fs";
import { join } from "node:path";
import { openApp, axisFrame, confirmAndRelease, type AppContext } from "./harness.ts";

let app: AppContext;
before(async () => {
  app = await openApp();
  await axisFrame(app, [-150, -110]);
});
after(async () => {
  assert.deepEqual(app.pageErrors, [], "nothing the page threw went uncaught");
  await app.close();
});

const SHOTS = process.env.NEOCAD_E2E_SHOTS;
async function shot(name: string): Promise<void> {
  if (!SHOTS) return;
  mkdirSync(SHOTS, { recursive: true });
  await app.page.waitForTimeout(150);
  await app.page.screenshot({ path: join(SHOTS, `explicitregions-${name}.png`) });
}

async function press(sx: number, sy: number, button: "left" | "right" = "left"): Promise<void> {
  const at = await app.at(sx, sy);
  await app.page.mouse.move(at.x, at.y, { steps: 3 });
  await app.page.waitForTimeout(60);
  await app.page.mouse.down({ button });
  await app.page.mouse.up({ button });
  // Long enough for a preview's copy to be built and drawn.
  await app.page.waitForTimeout(400);
}

async function drag(from: [number, number], to: [number, number]): Promise<void> {
  const a = await app.at(...from);
  const b = await app.at(...to);
  await app.page.mouse.move(a.x, a.y);
  await app.page.mouse.down();
  await app.page.mouse.move(b.x, b.y, { steps: 8 });
  await app.page.mouse.up();
  await app.page.waitForTimeout(220);
}

async function park(): Promise<void> {
  const p = await app.at(...PARK);
  await app.page.mouse.move(p.x, p.y);
  await app.page.waitForTimeout(150);
}

async function items(): Promise<string[]> {
  return app.page.$$eval("#ctxmenu .item", (els) => els.map((el) => el.firstElementChild?.textContent ?? ""));
}

async function choose(label: string): Promise<string> {
  const handle = await app.page.evaluateHandle((want) => {
    const rows = Array.from(document.querySelectorAll("#ctxmenu .item"));
    return rows.find((el) => el.firstElementChild?.textContent === want) ?? null;
  }, label);
  const el = handle.asElement();
  assert.ok(el, `no menu item labelled ${JSON.stringify(label)} — had ${(await items()).join(", ")}`);
  const command = await el.evaluate((row) => row.querySelector(".cmd")?.textContent ?? "");
  await el.click();
  await app.page.waitForTimeout(350);
  return command;
}

async function key(k: string): Promise<void> {
  await app.page.fill("#cmd", "");
  await app.page.keyboard.press(k);
  await app.page.waitForTimeout(350);
}

const value = async (src: string) => (await app.repl(src)).value;
const loopsOf = (e: string) => value(`model.featureOf(${JSON.stringify(e)}).loops.length`) as Promise<number>;
const depthOf = (e: string) => value(`model.relationOf(model.featureOf(${JSON.stringify(e)}).depth).args[1]`) as Promise<number>;
/** Whether a solid's face is drawn at a screen point, in the faces picture. */
const faced = async (at: [number, number]) => (await app.pixel(at[0] + 0.5, at[1] + 0.5, "faces"))[3] > 0;
/**
 * Whether the drawing canvas carries a preview at a screen point: more than
 * the faint light every region a click could take wears (alpha 0x16 of the
 * green), which a preview's 0.55 is far above.
 */
const drawn = async (at: [number, number]) => (await app.pixel(at[0] + 0.5, at[1] + 0.5, "drawing"))[3] > 100;

const RECT: [[number, number], [number, number]] = [[420, 240], [620, 400]];
const CENTRE: [number, number] = [520, 320];
const RIM: [number, number] = [560, 320];
/** Inside the rectangle, outside the circle. */
const BETWEEN: [number, number] = [445, 265];
const PARK: [number, number] = [760, 120];
let circle = "";

test("a rectangle extruded, then a circle drawn inside it: the solid has no hole", async () => {
  await app.type("rectangle");
  await drag(...RECT);
  await app.type('arm("extrude")');
  await press(...BETWEEN);
  await confirmAndRelease(app);
  assert.equal(await loopsOf("e1"), 1);
  await app.type("circle");
  await drag(CENTRE, RIM);
  await app.type("cancel()");
  const m = await app.model();
  circle = m.circles[0].name;
  assert.ok(Math.abs(m.points[m.circles[0].center][2] ?? 0) < 1e-9, "drawn on the sketch plane, under the lid");
  assert.equal(await loopsOf("e1"), 1, "the record: the outline alone — inside is not membership");
  await park();
  assert.equal(await faced(CENTRE), true, "the lid is whole over the circle's centre");
  assert.equal(await app.status(), "SOLVED");
  await shot("1-no-hole");
});

test("right-click the circle → Add as hole to e1: the hole appears; Ctrl+Z takes it away; redone, Remove hole from e1 fills it", async () => {
  await app.type('view("hidden")');
  await press(...RIM, "right");
  assert.equal(await choose("Add as hole to e1"), `hole("e1", "${circle}")`);
  assert.match(await app.log(), new RegExp(`> hole\\("e1", "${circle}"\\)`));
  assert.equal(await loopsOf("e1"), 2);
  await app.type('view("shaded")');
  await park();
  assert.equal(await faced(CENTRE), false, "straight down the hole there is no face");
  assert.equal(await faced(BETWEEN), true, "the lid is there around it");
  await shot("2-hole");

  await key("Control+z");
  await park();
  assert.equal(await loopsOf("e1"), 1, "one Ctrl+Z takes the hole away");
  assert.equal(await faced(CENTRE), true);
  await shot("3-undone");

  await key("Control+Shift+z");
  assert.equal(await loopsOf("e1"), 2, "redone");
  await app.type('view("hidden")');
  await press(...RIM, "right");
  assert.ok((await items()).includes("Remove hole from e1"));
  assert.equal(await choose("Remove hole from e1"), `unhole("e1", "${circle}")`);
  assert.equal(await loopsOf("e1"), 1);
  await app.type('view("shaded")');
  await park();
  assert.equal(await faced(CENTRE), true, "solid again");
  await shot("4-removed");
});

test("Edit e1 on the lid: the circle clicked in, the depth typed, ✓ — hole and set, one undo step undoes both", async () => {
  await press(...BETWEEN, "right");
  assert.equal(await choose("Edit e1"), 'edit("e1")');
  assert.equal((await app.model()).activeTool, "edit extrude", "the dialog is up");
  assert.equal(await app.page.inputValue('#options input.oval[data-option="depth"]'), "10", "its depth in the panel");
  await park();
  assert.equal(await faced(BETWEEN), false, "the solid as it is steps aside for the preview");
  assert.equal(await drawn(BETWEEN), true, "the preview is drawn in its place");
  await shot("5-edit-open");

  await press(...CENTRE);
  await park();
  assert.equal(await loopsOf("e1"), 1, "nothing built yet");
  await shot("6-edit-toggled");

  await app.page.click('#options input.oval[data-option="depth"]', { clickCount: 3 });
  await app.page.keyboard.type("25");
  await app.page.waitForTimeout(400);
  await park();
  await shot("7-edit-depth");
  await app.page.focus('#options input.oval[data-option="depth"]');
  await app.page.keyboard.press("Enter");
  await app.page.waitForTimeout(600);
  const log = await app.log();
  assert.match(log, new RegExp(`> hole\\("e1", "${circle}"\\)`), "typed the hole");
  assert.match(log, /> set\("d\d+\.value", 25\)/, "typed the depth");
  assert.equal(await loopsOf("e1"), 2);
  assert.equal(await depthOf("e1"), 25);
  assert.equal((await app.model()).activeTool, null, "✓ closes the dialog");
  await park();
  assert.equal(await faced(CENTRE), false, "the hole, built");
  assert.equal(await app.status(), "SOLVED");
  await shot("8-edited");

  await key("Control+z");
  assert.equal(await loopsOf("e1"), 1, "one Ctrl+Z: the hole");
  assert.equal(await depthOf("e1"), 10, "and the depth, together");
  await park();
  await shot("9-edit-undone");
});

const RECT2: [[number, number], [number, number]] = [[700, 440], [860, 560]];
const CENTRE2: [number, number] = [780, 500];
const RIM2: [number, number] = [810, 500];
const BETWEEN2: [number, number] = [715, 455];
/** Inside the circle, clear of its centre's dot and name. */
const INSIDE2: [number, number] = [768, 512];

test("the creating dialog: the hole proposed, clicked out (the preview solid over it), ✓ — a solid with no hole", async () => {
  await app.type("rectangle");
  await drag(...RECT2);
  await app.type("circle");
  await drag(CENTRE2, RIM2);
  await app.type("cancel()");
  await app.type('arm("extrude")');
  await press(...BETWEEN2);
  await park();
  assert.equal(await drawn(BETWEEN2), true, "previewed");
  assert.equal(await drawn(INSIDE2), false, "with the circle a hole: no lid over it");
  await shot("10-proposed");

  await press(...INSIDE2);
  await park();
  assert.equal((await app.model()).journalOps.filter((o) => o === "extrude").length, 1, "nothing built yet");
  assert.equal(await drawn(INSIDE2), true, "clicked out: the preview's lid covers the circle");
  await shot("11-toggled-out");

  await key("Enter");
  assert.match(await app.log(), /> extrude\("l\d+", 10, "[^"]+", \[\["l\d+","l\d+","l\d+","l\d+"\]\]\)/,
    "the loops typed outright: the short form would take them all");
  const m = await app.model();
  assert.equal(m.journalOps.filter((o) => o === "extrude").length, 2);
  assert.equal(await loopsOf("e2"), 1, "no hole");
  await key("Escape");
  await park();
  assert.equal(await faced(INSIDE2), true, "the lid whole over the circle");
  await shot("12-built-solid");
});
