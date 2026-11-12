// There is no sketch (docs/plans/no-sketch.md), in the browser: the Plane tool
// armed from the tray over a block, its lid taken — the chip says "plane ·
// click a lit face or plane to draw on it", then "on e1's top"; the face's
// menu offers "Draw on this face"; a group of a fully defined rectangle wears
// a filled dot in the organiser, a corner let go turns it hollow with the
// count on its tip, and its menu's Select what is free picks what moves;
// `arm("sketch")` and `workbench("sketch")` still open what they did, by their
// new names; and the status fade is measured (the brief's third question:
// pictures 515 and 521 with no SOLVED). Then on an iPhone 13 by finger: the
// status says "tap a thing" before any touch (picture 503 said click), the
// Plane tool and a tool's running guidance say tap, the organiser's dot and
// menu under a held finger. Set NEOCAD_E2E_SHOTS to keep the pictures
// (docs/images/525–536); look at them.

import { test } from "node:test";
import assert from "node:assert/strict";
import { existsSync, mkdirSync } from "node:fs";
import { join } from "node:path";
import { openApp, type AppContext } from "./harness.ts";
import { fingers, type Fingers } from "./fingers.ts";

const built = existsSync(new URL("../../src/solids/smlib-gen/smlib.mjs", import.meta.url));
const skip = built ? false : "no SMLib build — run `npm run build:solids`";

const SHOTS = process.env.NEOCAD_E2E_SHOTS;

async function withApp(options: Parameters<typeof openApp>[0], body: (a: AppContext) => Promise<void>): Promise<void> {
  const a = await openApp(options);
  try {
    await body(a);
    assert.deepEqual(a.pageErrors, [], "nothing the page threw went uncaught");
  } finally {
    await a.close();
  }
}

async function shot(a: AppContext, name: string): Promise<void> {
  if (!SHOTS) return;
  mkdirSync(SHOTS, { recursive: true });
  await a.page.waitForTimeout(400);
  await a.page.screenshot({ path: join(SHOTS, `${name}.png`) });
}

const chip = (a: AppContext) => a.page.$eval("#mode", (el) => {
  const d = (el as HTMLElement).dataset;
  return { where: d.where ?? "", what: d.what ?? "", next: d.next ?? "" };
});
const status = (a: AppContext) => a.page.evaluate(() => {
  const s = document.getElementById("status") as HTMLElement, d = document.getElementById("diagnosis") as HTMLElement;
  return { text: s.textContent ?? "", faded: s.dataset.faded !== undefined, count: d.textContent ?? "", countFaded: d.dataset.faded !== undefined };
});
const value = async (a: AppContext, src: string) => {
  const r = await a.repl(src);
  assert.equal(r.ok, true, `${src}: ${r.error ?? ""}`);
  return r.value;
};
/** Types a line and lets go of the command line, as a hand does before it touches the drawing again. */
async function say(a: AppContext, line: string): Promise<void> {
  await a.type(line);
  await a.page.evaluate(() => (document.activeElement as HTMLElement | null)?.blur());
  await a.page.waitForTimeout(150);
}
const PANE = '.panel[data-panel="organiser"]';
const row = (name: string) => `${PANE} .orow[data-name="${name}"]`;
/** A group row's definedness dot, as the pane shows it: its reading and its count. */
const dot = (a: AppContext, name: string) => a.page.$eval(`${row(name)} .odef`, (el) => ({
  defined: (el as HTMLElement).dataset.defined ?? "", free: (el as HTMLElement).dataset.free ?? "", label: el.getAttribute("aria-label") ?? "",
}));
const menuItems = (a: AppContext) => a.page.$$eval("#ctxmenu .item", (els) => els.map((el) => ({
  label: el.firstElementChild?.textContent ?? "", off: el.classList.contains("off") || el.classList.contains("disabled") || (el as HTMLElement).dataset.off !== undefined,
})));
async function choose(a: AppContext, label: string, touch = false): Promise<void> {
  const handle = await a.page.evaluateHandle((want) =>
    Array.from(document.querySelectorAll("#ctxmenu .item")).find((el) => el.firstElementChild?.textContent === want) ?? null, label);
  const el = handle.asElement();
  assert.ok(el, `no item ${label} — had ${(await menuItems(a)).map((i) => i.label).join(", ")}`);
  if (touch) await el.tap(); else await el.click();
  await a.page.waitForTimeout(300);
}
/** The middle of an element, in the canvas's pixels — what a finger is aimed by. */
const middle = (a: AppContext, sel: string) => a.page.$eval(sel, (el) => {
  const r = el.getBoundingClientRect(), c = document.getElementById("cv")!.getBoundingClientRect();
  return [r.x + r.width / 2 - c.x, r.y + r.height / 2 - c.y] as [number, number];
});

/** A 60 × 40 block, 15 high, from typed lines: its lid is a face to take. */
async function block(a: AppContext): Promise<{ pts: string[]; lines: string[] }> {
  const pts = (await value(a, "[pt(-30, -20), pt(30, -20), pt(30, 20), pt(-30, 20)]")) as string[];
  const lines = (await value(a, `[ln("${pts[0]}", "${pts[1]}"), ln("${pts[1]}", "${pts[2]}"), ln("${pts[2]}", "${pts[3]}"), ln("${pts[3]}", "${pts[0]}")]`)) as string[];
  await say(a, `extrude("${lines[0]}", 15)`);
  await say(a, "orbit(0, -0.9); orbit(-0.7, 0)");
  return { pts, lines };
}

/** A rectangle held still — a corner fixed, two sides long, every side along an axis — and a point fixed beside it, all in one group. */
async function definedGroup(a: AppContext): Promise<{ pts: string[]; lines: string[]; loose: string; fixOfLoose: string; width: string }> {
  const pts = (await value(a, "[pt(100, -20), pt(160, -20), pt(160, 20), pt(100, 20)]")) as string[];
  const lines = (await value(a, `[ln("${pts[0]}", "${pts[1]}"), ln("${pts[1]}", "${pts[2]}"), ln("${pts[2]}", "${pts[3]}"), ln("${pts[3]}", "${pts[0]}")]`)) as string[];
  await say(a, `fix("${pts[0]}", [100, -20])`);
  await say(a, `par("${lines[0]}", "origin.x"); par("${lines[2]}", "origin.x"); par("${lines[1]}", "origin.y"); par("${lines[3]}", "origin.y")`);
  const width = (await value(a, `dist("${pts[0]}", "${pts[1]}", 60)`)) as string;
  await say(a, `dist("${pts[1]}", "${pts[2]}", 40)`);
  const loose = (await value(a, "pt(130, 0)")) as string;
  const fixOfLoose = (await value(a, `fix("${loose}", [130, 0])`)) as string;
  await say(a, `group(${[...pts, ...lines, loose].map((n) => JSON.stringify(n)).join(", ")})`);
  return { pts, lines, loose, fixOfLoose, width };
}

// --- by mouse ------------------------------------------------------------------------

test("by mouse: the Plane tool from the tray — the chip says to draw on a lit face, the lid taken says on e1's top; the face menu offers Draw on this face", { skip }, () =>
  withApp({}, async (a) => {
    await block(a);
    await a.page.click('#toolbar button[data-tool="plane"]');
    await a.page.waitForTimeout(200);
    assert.equal((await chip(a)).what, "plane");
    assert.equal((await chip(a)).next, "click a lit face or plane to draw on it");
    const tip = await a.page.$eval('#toolbar button[data-tool="plane"]', (b) => b.getAttribute("aria-label") ?? b.getAttribute("title") ?? "");
    assert.match(tip, /^plane\b/, `the button is the plane tool: ${tip}`);
    assert.doesNotMatch(tip, /sketch/i);
    // Over the lid: lit; a click takes it.
    const [lx, ly] = await a.screenOf([0, 0, 15]);
    const at = await a.at(lx, ly);
    await a.page.mouse.move(at.x, at.y);
    await a.page.waitForTimeout(200);
    await shot(a, "525-the-plane-tool-armed-over-a-block-the-lid-lit");
    await a.page.mouse.click(at.x, at.y);
    await a.page.waitForFunction(() => (document.getElementById("mode") as HTMLElement).dataset.where !== "", null, { timeout: 5000 });
    assert.equal((await chip(a)).where, "on e1's top");
    assert.match((await value(a, "workplane()")) as string, /^p\d+\.p\d+\.p\d+$/);
    assert.match(await a.log(), /workplane\("p\d+\.p\d+\.p\d+"\)/);
    assert.doesNotMatch(await a.log(), /sketch/i, "nothing the log said says sketch");
    await shot(a, "526-the-lid-taken-the-chip-says-on-e1s-top");
    await say(a, "workplane(null)");
    // The face's menu: Draw on this face, first.
    const [mx, my] = await a.screenOf([10, 5, 15]);
    const m = await a.at(mx, my);
    await a.page.mouse.click(m.x, m.y, { button: "right" });
    await a.page.waitForTimeout(300);
    const items = (await menuItems(a)).map((i) => i.label);
    assert.equal(items[0], "Draw on this face", items.join(", "));
    assert.ok(!items.some((l) => /sketch/i.test(l)), items.join(", "));
    await shot(a, "527-the-face-menu-draw-on-this-face");
    await choose(a, "Draw on this face");
    assert.equal((await chip(a)).where, "on e1's top");
    await say(a, "workplane(null)");
  }));

test("by mouse: a group's definedness — a filled dot for a held rectangle, hollow with the count when a point in it is let go, and Select what is free picks it", { skip }, () =>
  withApp({}, async (a) => {
    const { pts, loose, fixOfLoose, width } = await definedGroup(a);
    assert.match(await a.status(), /SOLVED/);
    await a.page.waitForTimeout(200);
    assert.deepEqual(await dot(a, "g1"), { defined: "yes", free: "0", label: "g1 is fully defined" });
    await shot(a, "528-a-group-of-a-held-rectangle-the-filled-dot");
    // The fixed point let go: one of nine can move, and the dot says so.
    await say(a, `del("${fixOfLoose}")`);
    await a.page.waitForTimeout(200);
    assert.deepEqual(await dot(a, "g1"), { defined: "no", free: "1", label: "g1 is not fully defined" });
    await a.page.hover(`${row("g1")} .odef`);
    await a.page.waitForFunction(() => !(document.getElementById("tooltip") as HTMLElement).hidden, null, { timeout: 2000 });
    assert.match(await a.page.$eval("#tooltip", (el) => el.textContent ?? ""), /1 of its 9 members can still move/);
    await a.page.click(row("g1"), { button: "right" });
    await a.page.waitForTimeout(300);
    const items = await menuItems(a);
    assert.ok(items.some((i) => i.label === "Select what is free" && !i.off), JSON.stringify(items));
    await shot(a, "529-the-point-let-go-the-hollow-dot-and-select-what-is-free");
    await choose(a, "Select what is free");
    assert.deepEqual(await a.selection(), [loose], "the one member that moves");
    await shot(a, "530-what-is-free-selected");
    // A side let go: the far corners and the sides on them move, and the count follows.
    await say(a, `del("${width}")`);
    await a.page.waitForTimeout(200);
    const d = await dot(a, "g1");
    assert.equal(d.defined, "no");
    assert.ok(Number(d.free) > 1 && Number(d.free) < 9, `some of the rectangle moves now: ${JSON.stringify(d)}`);
    await a.page.click(row("g1"), { button: "right" });
    await a.page.waitForTimeout(200);
    await choose(a, "Select what is free");
    const sel = await a.selection();
    assert.ok(sel.includes(pts[1]) && sel.includes(pts[2]) && !sel.includes(pts[0]), `the far side's corners, not the fixed one: ${sel}`);
    assert.equal(sel.length, Number(d.free), "the dot's count is the selection's size");
  }));

test("by mouse: arm(\"sketch\") arms the plane tool by its old name and workbench(\"sketch\") opens Drawing; a file saved in the old workbench opens there", { skip }, () =>
  withApp({}, async (a) => {
    await say(a, 'arm("sketch")');
    assert.match(await a.log(), /armed: sketch — the plane tool, by its old name — a plane to draw on, arm\("plane", \{\}\)/);
    assert.equal((await a.model()).activeTool, "plane");
    await say(a, 'arm("select")');
    await say(a, 'workbench("sketch")');
    assert.equal(await value(a, "workbench()"), "drawing");
    assert.match(await a.log(), /workbench: drawing — core, sketch, dimensions/);
    assert.match(await a.page.$eval(`${PANE} .ptitle`, (e) => e.textContent ?? ""), /organiser\s*· Drawing/);
    const tools = await a.page.$$eval("#toolbar > button[data-tool]", (bs) => bs.map((b) => (b as HTMLElement).dataset.tool!));
    assert.ok(!tools.includes("plane") && !tools.includes("extrude"), `the drawing tray has no plane or extrude: ${tools}`);
    await say(a, "pt(1, 2)");
    const text = (await value(a, "save()")) as string;
    assert.equal(JSON.parse(text).workbench, "drawing", "saved under the name it has now");
    await say(a, 'workbench("part")');
    // A file from before, saying "sketch": opened in Drawing.
    const old = JSON.stringify({ ...JSON.parse(text), workbench: "sketch" });
    await a.repl(`open(${JSON.stringify(old)})`);
    await a.page.waitForTimeout(300);
    assert.equal(await value(a, "workbench()"), "drawing");
    await say(a, 'workbench("part")');
    const benches = (await value(a, "workbenches()")) as string[];
    assert.deepEqual(benches.map((w) => w.replace(/^[● ]\s*/, "").split(/\s+/)[0]), ["part", "drawing", "surfaces"], "the old name is listed nowhere");
  }));

test("by mouse: the status after an operation — SOLVED and the count are there, and after three seconds fade by design, the text kept", { skip }, () =>
  withApp({}, async (a) => {
    // The brief's third question (pictures 515 and 521): is a blank status a
    // status that never came? The verdict and the count are shown at once and
    // then fade (statusline.ts's `statusFade`, main.ts's `showDiagnosis`),
    // display:none in index.html — never the text, which a test reads.
    const { lines } = await block(a);
    const t0 = Date.now();
    const first = await status(a);
    assert.equal(first.text, "SOLVED");
    assert.match(first.count, /^\d+ free$/);
    assert.equal(first.faded, false, "shown as the operation lands");
    await say(a, `extrude("${lines[1]}", -5, { mode: "cut", into: "e1" })`);
    const after = await status(a);
    assert.equal(after.text, "SOLVED");
    assert.equal(after.faded, false, "a second operation shows it again");
    await a.page.waitForTimeout(3600 - Math.min(3000, Date.now() - t0) + 3000);
    const late = await status(a);
    assert.equal(late.text, "SOLVED", "faded is the picture, never the text");
    assert.equal(late.faded, true, "and after STATUS_FADE_MS it is out of the way — what pictures 515 and 521 show");
    assert.equal(late.countFaded, true, "the count with it, when nothing agrees");
  }));

// --- on an iPhone 13, by finger ------------------------------------------------------

async function tapOn(a: AppContext, f: Fingers, sel: string): Promise<void> {
  await f.tap(...await middle(a, sel));
  await a.page.waitForTimeout(400);
}

test("on an iPhone 13: before any touch the status says tap, not click; the Plane tool chosen by finger says tap; the lid tapped is on e1's top; a tool's miss says tap", { skip }, () =>
  withApp({ device: "iPhone 13" }, async (a) => {
    await block(a);
    // Picture 503 said "click a thing, or drag to box" on a phone: the hand is
    // seeded from the device before any finger has touched the canvas.
    assert.equal((await chip(a)).next, "tap a thing, or hold and drag to box");
    // Pictured once the verdict has faded and the chip's third part has the room it gives way for.
    await a.page.waitForTimeout(3600);
    await shot(a, "531-iphone-before-any-touch-the-status-says-tap");
    const f = await fingers(a);
    await tapOn(a, f, '#toolbar button[data-tool="plane"]');
    assert.equal((await chip(a)).what, "plane");
    assert.equal((await chip(a)).next, "tap a lit face or plane to draw on it");
    const tip = await a.page.$eval("#chosentip", (el) => ({ hidden: (el as HTMLElement).hidden, text: el.textContent ?? "" }));
    assert.equal(tip.hidden, false, "the chosen tip shows");
    assert.doesNotMatch(tip.text, /sketch|click/i, tip.text);
    await shot(a, "532-iphone-the-plane-tool-chosen-the-chip-says-tap");
    const [lx, ly] = await a.screenOf([0, 0, 15]);
    await a.at(lx, ly);
    await f.tap(lx, ly);
    await a.page.waitForFunction(() => (document.getElementById("mode") as HTMLElement).dataset.where !== "", null, { timeout: 5000 });
    assert.equal((await chip(a)).where, "on e1's top");
    await shot(a, "533-iphone-the-lid-tapped-on-e1s-top");
    await say(a, "workplane(null)");
    // A tool's running guidance, under a finger: the offset tool tapped on nothing.
    await say(a, 'arm("offset")');
    // Empty canvas: right of the block's top, under the action strip and the log, above the tool's options panel.
    const [ex, ey]: [number, number] = [340, 215];
    await a.at(ex, ey);
    await f.tap(ex, ey);
    await a.page.waitForTimeout(400);
    assert.match(await a.log(), /offset: tap a line, arc or circle — the chain it is in is offset/);
    assert.equal((await chip(a)).next, "tap a line, arc or circle — the chain it is in is offset");
    await shot(a, "534-iphone-a-tools-miss-says-tap");
    await say(a, 'arm("select")');
    // The summary a finger reads says tap too: the line tool chosen.
    await tapOn(a, f, '#toolbar button[data-tool="line"]');
    const line = await a.page.$eval("#chosentip .tsum", (el) => el.textContent ?? "");
    assert.equal(line, "Draws lines: tap the start, then the end of each in turn");
    await shot(a, "535-iphone-the-line-tool-chosen-its-summary-says-tap");
    await say(a, 'arm("select")');
  }));

test("on an iPhone 13: the group's dot in the organiser, and a held finger's menu with Select what is free", { skip }, () =>
  withApp({ device: "iPhone 13" }, async (a) => {
    const { loose, fixOfLoose } = await definedGroup(a);
    await a.page.waitForTimeout(200);
    assert.deepEqual(await dot(a, "g1"), { defined: "yes", free: "0", label: "g1 is fully defined" });
    await say(a, `del("${fixOfLoose}")`);
    await a.page.waitForTimeout(200);
    assert.equal((await dot(a, "g1")).free, "1");
    const f = await fingers(a);
    // Held on the row's middle, which on a phone is the dot itself (the marker
    // and the eye each take a finger's width either side): the row's menu,
    // and no tooltip — the dot's count is in the menu's header.
    const mid = await middle(a, `${row("g1")} .odef`);
    await f.hold(...mid, 700);
    await a.page.waitForTimeout(250);
    assert.ok((await menuItems(a)).length, `the held row's menu, at ${mid}`);
    assert.equal(await a.page.$eval("#tooltip", (el) => (el as HTMLElement).hidden), true, "and no tooltip with it");
    assert.match(await a.page.$eval("#ctxmenu", (el) => el.textContent ?? ""), /g1 {2}group of 9 members {2}· {2}1 of 9 free/);
    assert.ok((await menuItems(a)).some((i) => i.label === "Select what is free"), (await menuItems(a)).map((i) => i.label).join(", "));
    await shot(a, "536-iphone-the-hollow-dot-and-the-held-rows-menu");
    await choose(a, "Select what is free", true);
    assert.deepEqual(await a.selection(), [loose]);
  }));
