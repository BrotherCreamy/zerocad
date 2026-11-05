// Toolbar groups, in a browser (docs/plans/toolbar-groups.md; the owner: "give
// me better sketch tools, relations, trim, slot... all the usual", and before
// that "Second row.... everything has to fit").
//
// Today every group has one built-in member, so two tools defined at the
// command line pad them — `t_pad1` joins shapes and `t_pad2` modify, by
// `static group` — and the flyouts exist before the packages that fill them
// land. With a mouse: a hover opens a group's flyout, a click on an item arms
// it and closes it, the button then shows it; leaving closes it, Escape closes
// it and leaves the tool armed, a press held opens it; an item has its
// tooltip; the choice survives a reload. Under fingers (iPhone 13 both ways
// up, and an SE): a press slid off the button onto an item and lifted arms
// it; a long-press opens it and a tap on an item arms it; a plain tap arms the
// shown tool and opens nothing; a tap elsewhere closes it; a held item shows
// its tooltip. That nothing overlaps with a flyout open, on every phone in
// test/devices.ts, is fits.e2e.ts's.
//
// Set NEOCAD_E2E_SHOTS to a directory to keep the pictures — and look at them.

import { test, after } from "node:test";
import assert from "node:assert/strict";
import { mkdirSync } from "node:fs";
import { join } from "node:path";
import { openApp, forgetAutosave, type AppContext } from "./harness.ts";
import { fingers } from "./fingers.ts";
import { IPHONES, windowOf } from "../devices.ts";

const SHOTS = process.env.NEOCAD_E2E_SHOTS;
async function shot(app: AppContext, name: string, clip?: { x: number; y: number; width: number; height: number }): Promise<void> {
  if (!SHOTS) return;
  mkdirSync(SHOTS, { recursive: true });
  await app.page.waitForTimeout(120);
  await app.page.screenshot({ path: join(SHOTS, `groups-${name}.png`), ...(clip ? { clip } : {}) });
}

const apps: AppContext[] = [];
after(async () => { for (const a of apps) await a.close(); });

interface Box { x: number; y: number; w: number; h: number }
const overlap = (a: Box, b: Box) => a.x < b.x + b.w - 0.5 && b.x < a.x + a.w - 0.5 && a.y < b.y + b.h - 0.5 && b.y < a.y + a.h - 0.5;

async function fresh(app: AppContext): Promise<void> {
  await app.page.evaluate(() => localStorage.clear());
  await forgetAutosave(app.page);
  await app.page.reload({ waitUntil: "networkidle" });
  await app.page.waitForFunction(() => document.getElementById("status")?.textContent?.includes("ready"), null, { timeout: 20_000 });
}

/** The two padding tools: one more member for shapes, one for modify. */
async function pad(app: AppContext): Promise<void> {
  for (const [name, group] of [["t_pad1", "shapes"], ["t_pad2", "modify"]]) {
    // Typed, as a person defines one: the entry is what brings the toolbar up
    // to date with the registry (an evaluation behind its back does not).
    await app.type(`defineTool("${name}", class extends Tool { static group = "${group}"; ` +
      `static summary = "Pads the ${group} group"; name = "${name}"; })`);
  }
  assert.doesNotMatch(await app.log(), /Error|refused/, "both defined");
  await app.page.waitForTimeout(250);
  await app.page.evaluate(() => (document.activeElement as HTMLElement | null)?.blur());
}

const rectOf = (app: AppContext, selector: string) => app.page.$eval(selector, (el) => {
  const r = el.getBoundingClientRect();
  return { x: r.x, y: r.y, w: r.width, h: r.height };
});
const group = (g: string) => `#toolbar button[data-group="${g}"]`;
const item = (tool: string) => `#flyout button[data-tool="${tool}"]`;

interface Fly { open: boolean; group: string | null; orient: string | null; lines: number; items: string[]; current: string | null; box: Box | null }
const flyout = (app: AppContext) => app.page.$eval("#flyout", (el) => {
  const f = el as HTMLElement;
  const r = f.getBoundingClientRect();
  return {
    open: !f.hidden, group: f.hidden ? null : f.dataset.group ?? null, orient: f.hidden ? null : f.dataset.orient ?? null,
    lines: Number(f.dataset.lines ?? 0),
    items: Array.from(f.querySelectorAll<HTMLElement>("button")).map((b) => b.dataset.tool!),
    current: f.querySelector<HTMLElement>("button.current")?.dataset.tool ?? null,
    box: f.hidden ? null : { x: r.x, y: r.y, w: r.width, h: r.height },
  };
}) as Promise<Fly>;

async function flyoutBecomes(app: AppContext, want: (f: Fly) => boolean, what: string, ms = 2000): Promise<Fly> {
  const deadline = Date.now() + ms;
  for (;;) {
    const f = await flyout(app);
    if (want(f)) return f;
    if (Date.now() > deadline) assert.fail(`${what}: ${JSON.stringify(f)}`);
    await app.page.waitForTimeout(25);
  }
}

const shown = (app: AppContext, g: string) => app.page.$eval(group(g), (b) => ({
  tool: (b as HTMLElement).dataset.tool, glyph: b.querySelector("svg")?.dataset.glyph, pressed: b.getAttribute("aria-pressed"),
}));

// --- a mouse ------------------------------------------------------------------------

let desk: AppContext;

test("mouse: the group's button carries the mark; a hover opens its flyout beside the column, the current one marked", async () => {
  desk = await openApp();
  apps.push(desk);
  await fresh(desk);
  // A group of one is a plain button: no mark, its own tooltip, nothing opens
  // — the curves group's, the ellipse alone (docs/plans/sketch-shapes.md).
  assert.equal(await desk.page.$eval(group("curves"), (b) => b.hasAttribute("data-more")), false);
  assert.equal(await desk.page.$$eval("#toolbar button", (bs) => bs.length), 13);
  await pad(desk);
  assert.equal(await desk.page.$$eval("#toolbar button", (bs) => bs.length), 13, "two more tools, no more buttons");
  assert.equal(await desk.page.$eval(group("shapes"), (b) => b.hasAttribute("data-more") && b.getAttribute("aria-haspopup")), "true");
  // The mark is drawn: the ::after triangle in the corner, in the glyph's ink.
  const mark = await desk.page.$eval(group("shapes"), (b) => {
    const s = getComputedStyle(b, "::after");
    return { content: s.content, w: s.width, h: s.height, right: s.right, bottom: s.bottom };
  });
  assert.deepEqual(mark, { content: '""', w: "4px", h: "4px", right: "2px", bottom: "2px" });

  await desk.page.mouse.move(700, 400);
  const b = await rectOf(desk, group("shapes"));
  const t0 = Date.now();
  await desk.page.mouse.move(b.x + b.w / 2, b.y + b.h / 2, { steps: 2 });
  const f = await flyoutBecomes(desk, (s) => s.open, "a hover opens it");
  const waited = Date.now() - t0;
  assert.ok(waited >= 250 && waited < 1200, `after the tooltip's delay, not at once: ${waited} ms`);
  assert.deepEqual([f.group, f.orient, f.items, f.current], ["shapes", "row", ["rectangle", "polygon", "slot", "t_pad1"], "rectangle"]);
  const tray = await rectOf(desk, '.panel[data-panel="toolbar"]');
  assert.ok(f.box!.x >= tray.x + tray.w, "beside the column, on the drawing's side");
  assert.ok(Math.abs(f.box!.y + 4 - b.y) <= 1.5, `level with its button: ${f.box!.y} against ${b.y}`);
  assert.equal(await desk.page.$eval(group("shapes"), (el) => el.getAttribute("aria-expanded")), "true");
  // The button's own tooltip does not show over it: the items carry theirs.
  assert.equal(await desk.page.$eval("#tooltip", (el) => (el as HTMLElement).hidden), true);
  await shot(desk, "desktop-hover", { x: 0, y: 0, width: 220, height: 360 });
  assert.deepEqual(desk.pageErrors, []);
});

test("mouse: an item's tooltip; a click on it arms it, closes the flyout, and the button shows it from then on", async () => {
  const i = await rectOf(desk, item("t_pad1"));
  await desk.page.mouse.move(i.x + i.w / 2, i.y + i.h / 2, { steps: 3 });
  await desk.page.waitForFunction(() => !document.getElementById("tooltip")!.hidden, null, { timeout: 2000 });
  const tip = await desk.page.$eval("#tooltip", (el) => el.textContent);
  assert.match(tip!, /T_pad1.*Pads the shapes group.*arm\("t_pad1"\)/);
  const tipBox = await rectOf(desk, "#tooltip");
  const fly = (await flyout(desk)).box!;
  assert.ok(!overlap(tipBox, fly), "the item's tip keeps off the flyout's other items");
  assert.ok(!overlap(tipBox, await rectOf(desk, '.panel[data-panel="toolbar"]')), "and off the tray it opened from");
  await shot(desk, "desktop-item-tip", { x: 0, y: 0, width: 320, height: 400 });
  await desk.page.mouse.down();
  await desk.page.mouse.up();
  await flyoutBecomes(desk, (s) => !s.open, "a click closes it");
  assert.equal((await desk.model()).activeTool, "t_pad1");
  assert.match(await desk.log(), /arm\("t_pad1"\)/, "typed, as every button types");
  assert.deepEqual(await shown(desk, "shapes"), { tool: "t_pad1", glyph: "generic", pressed: "true" });
  // Typed by name it is the same: arm("rectangle") puts the rectangle back on the button.
  await desk.type('arm("rectangle")');
  assert.deepEqual(await shown(desk, "shapes"), { tool: "rectangle", glyph: "rectangle", pressed: "true" });
  await desk.type('arm("t_pad1")');
  assert.deepEqual(await shown(desk, "shapes"), { tool: "t_pad1", glyph: "generic", pressed: "true" });
  await desk.type("cancel()");
  assert.equal((await shown(desk, "shapes")).pressed, "false");
  // A plain click arms what the button shows.
  await desk.page.mouse.move(700, 400);
  const b = await rectOf(desk, group("shapes"));
  await desk.page.mouse.click(b.x + b.w / 2, b.y + b.h / 2);
  assert.equal((await desk.model()).activeTool, "t_pad1");
  await flyoutBecomes(desk, (s) => !s.open, "a click on the button arms, and opens nothing");
  await desk.type("cancel()");
  assert.deepEqual(desk.pageErrors, []);
});

test("mouse: leaving closes it; Escape closes it and only it; a press held opens it and the lift arms nothing", async () => {
  const b = await rectOf(desk, group("modify"));
  await desk.page.mouse.move(700, 400);
  await desk.page.mouse.move(b.x + b.w / 2, b.y + b.h / 2, { steps: 2 });
  await flyoutBecomes(desk, (s) => s.open && s.group === "modify", "the modify group's");
  assert.deepEqual((await flyout(desk)).items, ["fillet", "t_pad2"]);
  await desk.page.mouse.move(700, 600, { steps: 3 });
  await desk.page.waitForTimeout(150);
  assert.equal((await flyout(desk)).open, true, "not at once: the way across to it is allowed");
  await flyoutBecomes(desk, (s) => !s.open, "gone once the pointer has left it", 1500);

  // Escape, with a tool armed: the flyout goes, the tool stays.
  await desk.type('arm("line")');
  await desk.page.mouse.move(b.x + b.w / 2, b.y + b.h / 2, { steps: 2 });
  await flyoutBecomes(desk, (s) => s.open, "open again");
  await desk.page.keyboard.press("Escape");
  await flyoutBecomes(desk, (s) => !s.open, "Escape closes it");
  assert.equal((await desk.model()).activeTool, "line", "and does nothing else");
  await desk.page.keyboard.press("Escape");
  assert.equal((await desk.model()).activeTool, null, "the next Escape is the app's");

  // Pressed and held (the hover's own timer is beaten by pressing at once).
  await desk.page.mouse.move(700, 400);
  await desk.page.mouse.move(b.x + b.w / 2, b.y + b.h / 2);
  await desk.page.mouse.down();
  await desk.page.waitForTimeout(700);
  assert.equal((await flyout(desk)).open, true, "a press held opens it");
  await desk.page.mouse.up();
  await desk.page.waitForTimeout(150);
  assert.equal((await desk.model()).activeTool, null, "the lift of the hold armed nothing");
  assert.equal((await flyout(desk)).open, true, "and it stays, to be clicked");
  const i = await rectOf(desk, item("t_pad2"));
  await desk.page.mouse.click(i.x + i.w / 2, i.y + i.h / 2);
  assert.equal((await desk.model()).activeTool, "t_pad2");
  assert.equal((await flyout(desk)).open, false);
  await desk.type("cancel()");
  assert.deepEqual(desk.pageErrors, []);
});

test("mouse: the choice is the viewer's — it survives a reload, and is in no file", async () => {
  // shapes and modify each armed a padding tool last.
  const stored = await desk.page.evaluate(() => localStorage.getItem("neocad.toolGroups.v1"));
  assert.deepEqual(JSON.parse(stored!), { shapes: "t_pad1", modify: "t_pad2" });
  await forgetAutosave(desk.page);
  await desk.page.reload({ waitUntil: "networkidle" });
  await desk.page.waitForFunction(() => document.getElementById("status")?.textContent?.includes("ready"), null, { timeout: 20_000 });
  // Without the padding tools, the first member: a name not in the group is not shown.
  assert.equal((await shown(desk, "shapes")).tool, "rectangle");
  await pad(desk);
  assert.equal((await shown(desk, "shapes")).tool, "t_pad1", "remembered across the reload");
  assert.equal((await shown(desk, "modify")).tool, "t_pad2");
  const saved = await desk.repl("JSON.stringify(save())");
  assert.ok(saved.ok);
  assert.doesNotMatch(String(saved.value), /toolGroups|"shapes": *"t_pad1"/, "the choice is not in the drawing's file");
  assert.deepEqual(desk.pageErrors, []);
});

// --- fingers ------------------------------------------------------------------------

/** A selector's middle, in canvas pixels — what the fingers helper takes. */
const middleOf = (app: AppContext, selector: string) => app.page.$eval(selector, (el) => {
  const r = el.getBoundingClientRect();
  const c = document.getElementById("cv")!.getBoundingClientRect();
  return [r.x + r.width / 2 - c.x, r.y + r.height / 2 - c.y] as [number, number];
});

for (const device of ["iPhone 13", "iPhone 13 landscape"] as const) {
  test(`${device}: press on the shapes button, slide onto an item, lift — it is armed, in one gesture`, async () => {
    const app = await openApp({ device });
    apps.push(app);
    await fresh(app);
    await pad(app);
    const f = await fingers(app);
    const from = await middleOf(app, group("shapes"));
    await f.down(from);
    // Past the slop: the flyout opens under the moving finger.
    await f.move([from[0] + (device === "iPhone 13" ? 12 : 0), from[1] - (device === "iPhone 13" ? 0 : 12)]);
    const fly = await flyoutBecomes(app, (s) => s.open, "the slide opens it");
    assert.equal(fly.orient, device === "iPhone 13" ? "row" : "column", "a row beside a column, a column over a row");
    const to = await middleOf(app, item("t_pad1"));
    await f.glide(6, to);
    assert.equal(await app.page.$eval(item("t_pad1"), (el) => el.classList.contains("hot")), true, "lit under the finger");
    await shot(app, `${device === "iPhone 13" ? "portrait" : "landscape"}-slide`);
    await f.up();
    await flyoutBecomes(app, (s) => !s.open, "the lift closes it");
    assert.equal((await app.model()).activeTool, "t_pad1", "and arms what it lifted on");
    assert.equal((await shown(app, "shapes")).tool, "t_pad1", "the button shows it");
    await app.type("cancel()");
    await app.page.evaluate(() => (document.activeElement as HTMLElement | null)?.blur());

    // Slid off onto nothing: closed, nothing armed.
    await f.down(from);
    // Clear of the flyout: a column of the four shapes over a landscape row
    // reaches past 160 px (docs/plans/sketch-shapes.md filled it).
    await f.glide(12, [from[0] + 6, from[1] - (device === "iPhone 13" ? 160 : 250)]);
    await f.up();
    await flyoutBecomes(app, (s) => !s.open, "slid off onto nothing");
    assert.equal((await app.model()).activeTool, null);

    // A plain tap arms the shown tool and never opens it. (After a pause:
    // Chromium drops the tap that follows a fling, fingers.ts.)
    await app.page.waitForTimeout(400);
    await f.tap(...from);
    assert.equal((await app.model()).activeTool, "t_pad1");
    assert.equal((await flyout(app)).open, false, "a tap opens nothing");
    await app.type("cancel()");
    assert.deepEqual(app.pageErrors, []);
  });
}

test("iPhone 13: a long-press opens it and the lift arms nothing; a tap on an item arms it; a tap elsewhere closes it", async () => {
  const app = await openApp({ device: "iPhone 13" });
  apps.push(app);
  await fresh(app);
  await pad(app);
  const f = await fingers(app);
  const at = await middleOf(app, group("modify"));
  await f.hold(...at, 700, true);
  await flyoutBecomes(app, (s) => s.open && s.group === "modify", "the long-press opens it");
  assert.equal(await app.page.$eval("#tooltip", (el) => (el as HTMLElement).hidden), true, "it, not the button's tooltip");
  await shot(app, "portrait-longpress");
  await f.up();
  await app.page.waitForTimeout(200);
  assert.equal((await app.model()).activeTool, null, "the lift pressed nothing");
  assert.equal((await flyout(app)).open, true, "it stays for the tap");
  // A held item shows its tooltip, and its lift arms nothing either.
  await f.hold(...await middleOf(app, item("t_pad2")), 750, true);
  await app.page.waitForFunction(() => !document.getElementById("tooltip")!.hidden, null, { timeout: 2000 });
  assert.match(await app.page.$eval("#tooltip", (el) => el.textContent!), /T_pad2.*Pads the modify group.*arm\("t_pad2"\)/);
  assert.ok(!overlap(await rectOf(app, "#tooltip"), await rectOf(app, '.panel[data-panel="toolbar"]')), "the held item's tip is off the tray");
  await shot(app, "portrait-item-tip");
  await f.up();
  await app.page.waitForTimeout(200);
  assert.equal((await app.model()).activeTool, null, "the held item's lift armed nothing");
  // The long-press left it open; a tap arms.
  if (!(await flyout(app)).open) {
    await f.hold(...at, 700);
    await flyoutBecomes(app, (s) => s.open, "open again");
  }
  await f.tap(...await middleOf(app, item("t_pad2")));
  assert.equal((await app.model()).activeTool, "t_pad2", "a tap on an item arms it");
  assert.equal((await flyout(app)).open, false);
  await app.type("cancel()");
  await app.page.evaluate(() => (document.activeElement as HTMLElement | null)?.blur());
  // A tap elsewhere closes it.
  await f.hold(...at, 700);
  await flyoutBecomes(app, (s) => s.open, "open");
  const cv = await rectOf(app, "#cv");
  await f.tap(cv.w * 0.6, cv.h * 0.75);
  await flyoutBecomes(app, (s) => !s.open, "a tap elsewhere closes it");
  assert.equal((await app.model()).activeTool, null);
  assert.deepEqual(app.pageErrors, []);
});

test("iPhone SE, landscape: modify's flyout over a two-row tray is a column, clear of the panes; LOOK at it", async () => {
  const app = await openApp({ device: "iPhone 13" });
  apps.push(app);
  const se = IPHONES.find((p) => p.w === 375)!;
  const win = windowOf(se, "landscape", "safari");
  await app.page.setViewportSize({ width: win.w, height: win.h });
  await fresh(app);
  await pad(app);
  const f = await fingers(app);
  await f.hold(...await middleOf(app, group("modify")), 700);
  const fly = await flyoutBecomes(app, (s) => s.open, "open on an SE");
  assert.equal(fly.orient, "column");
  const tray = await rectOf(app, '.panel[data-panel="toolbar"]');
  assert.ok(fly.box!.y + fly.box!.h <= tray.y, "above the tray");
  await shot(app, "se-landscape-modify");
  assert.deepEqual(app.pageErrors, []);
});
