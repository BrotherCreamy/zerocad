// A tool says how to use it (docs/plans/tool-howto.md), driven the way a user
// drives it: by finger on an iPhone 13, and with a mouse. The owner, asked to
// try adding a parallel relation: *"I don't even know how to add a parallel
// relation. Maybe a little tooltip should pop up when I hover over (desktop)
// or select (phone) a tool."*
//
// What only a browser shows: that a tap on a tool brings its tip up — its
// name, what it does, how — where the hover's tooltip stays away; that the tip
// **takes no touch**, a tap on it reaching the line drawn under it; that it
// goes at that first touch, by itself once read, and with the tool; that the
// second time it is the steps alone; that it never lies over the tray, the
// tool's own options pane or the palette, for every tool on the tray and
// behind it; that the setting turns it off and is remembered; and the owner's
// case end to end — Constrain found behind Dimension, two lines tapped,
// Parallel pressed from the palette without opening "more…", the lines
// parallel. With a mouse: the hover's tooltip has the steps, in a mouse's
// words, and a click shows no tip of its own.
//
// Set NEOCAD_E2E_SHOTS to a directory to keep the pictures (docs/images/480 on).
// Look at them, and read each tip as someone who has never used the app.

import { test, before, after } from "node:test";
import assert from "node:assert/strict";
import { mkdirSync } from "node:fs";
import { join } from "node:path";
import { forgetAutosave, openApp, settled, type AppContext } from "./harness.ts";
import { fingers, type Fingers } from "./fingers.ts";

const SHOTS = process.env.NEOCAD_E2E_SHOTS;
async function shot(app: AppContext, name: string): Promise<void> {
  if (!SHOTS) return;
  mkdirSync(SHOTS, { recursive: true });
  await app.page.waitForTimeout(200);
  await app.page.screenshot({ path: join(SHOTS, `${name}.png`) });
}

type Box = { x: number; y: number; w: number; h: number };
interface Chosen { shown: boolean; again: string | null; name: string | null; summary: string | null; how: string[]; also: string | null; command: string | null; box: Box | null }

/** The chosen tool's tip, as it is on the screen now. */
const chosen = (app: AppContext) => app.page.$eval("#chosentip", (el) => {
  const t = el as HTMLElement;
  const r = t.getBoundingClientRect();
  const text = (c: string) => t.querySelector(c)?.textContent ?? null;
  return {
    shown: !t.hidden, again: t.dataset.again ?? null, name: text(".tname"), summary: text(".tsum"),
    how: Array.from(t.querySelectorAll(".thow")).map((e) => e.textContent ?? ""), also: text(".talso"), command: text(".tcmd"),
    box: t.hidden ? null : { x: r.x, y: r.y, w: r.width, h: r.height },
  };
}) as Promise<Chosen>;

const box = (app: AppContext, sel: string) => app.page.$eval(sel, (el) => { const r = el.getBoundingClientRect(); return { x: r.x, y: r.y, w: r.width, h: r.height }; }) as Promise<Box>;
const shownBox = async (app: AppContext, sel: string): Promise<Box | null> =>
  (await app.page.$eval(sel, (el) => (el as HTMLElement).hidden).catch(() => true)) ? null : box(app, sel);
const meet = (a: Box, b: Box) => a.x < b.x + b.w - 0.5 && b.x < a.x + a.w - 0.5 && a.y < b.y + b.h - 0.5 && b.y < a.y + a.h - 0.5;
/** A canvas pixel in the middle of `sel` — what the fingers helper takes. */
const middleOf = (app: AppContext, sel: string) => app.page.$eval(sel, (el) => {
  const r = el.getBoundingClientRect(), c = document.getElementById("cv")!.getBoundingClientRect();
  return [r.x + r.width / 2 - c.x, r.y + r.height / 2 - c.y] as [number, number];
});
const PANE = (id: string) => `.panel[data-panel="${id}"]`;
const button = (tool: string) => `#toolbar button[data-tool="${tool}"]`;
const group = (name: string) => `#toolbar button[data-group="${name}"]`;
const relations = (app: AppContext) => app.page.evaluate(() =>
  [...(window as never as { __neocad: { model: { relations: Map<string, { op: string; args: unknown[] }> } } }).__neocad.model.relations.values()]
    .map((r) => ({ op: r.op, args: r.args })));
const applyRows = (app: AppContext) => app.page.$$eval("#constraints .ocmd", (els) => els.map((e) => ({
  label: e.querySelector(".olabel")?.textContent ?? "", command: (e as HTMLElement).dataset.command ?? "", more: e.classList.contains("more"),
})));

/** Types a line, then lets go of the command line, as a hand does before it touches the drawing again. */
async function type(app: AppContext, line: string): Promise<void> {
  await app.type(line);
  await app.page.evaluate(() => (document.activeElement as HTMLElement | null)?.blur());
}

/** A first start: no layout, no autosave, no setting — and no tool yet chosen this session. */
async function fresh(app: AppContext): Promise<void> {
  await app.page.evaluate(() => localStorage.clear());
  await forgetAutosave(app.page);
  await app.page.reload({ waitUntil: "networkidle" });
  await app.page.waitForFunction(() => document.getElementById("status")?.textContent?.includes("ready"), null, { timeout: 20_000 });
  await app.page.evaluate(() => (document.activeElement as HTMLElement | null)?.blur());
}

/** The chosen tip once `want` holds of it, within `ms`. */
async function chosenBecomes(app: AppContext, want: (t: Chosen) => boolean, what: string, ms = 3000): Promise<Chosen> {
  const deadline = Date.now() + ms;
  for (;;) {
    const t = await chosen(app);
    if (want(t)) return t;
    if (Date.now() > deadline) assert.fail(`${what}: ${JSON.stringify(t)}`);
    await app.page.waitForTimeout(25);
  }
}

/** The tip's box against everything it must keep off, and the window. */
async function keepsClear(app: AppContext, t: Chosen, what: string): Promise<void> {
  const tip = t.box!;
  const vp = app.page.viewportSize()!;
  assert.ok(tip.x >= 0 && tip.y >= 0 && tip.x + tip.w <= vp.width + 0.5 && tip.y + tip.h <= vp.height + 0.5, `${what}: inside the window — ${JSON.stringify(tip)}`);
  for (const id of ["toolbar", "options", "constraints"]) {
    const pane = await shownBox(app, PANE(id));
    if (pane) assert.ok(!meet(tip, pane), `${what}: never over the ${id} pane — ${JSON.stringify({ tip, pane })}`);
  }
  assert.ok(!meet(tip, await box(app, "#logo")), `${what}: never over the logo`);
}

const apps: AppContext[] = [];
let phone: AppContext;
let desk: AppContext;
let f: Fingers;
before(async () => {
  phone = await openApp({ device: "iPhone 13" });
  desk = await openApp();
  apps.push(phone, desk);
});
after(async () => { for (const a of apps) await a.close(); });

async function freshPhone(app: AppContext = phone): Promise<void> {
  await fresh(app);
  f = await fingers(app);
}

/** A finger held on a group's button until its flyout opens, then a tap on `tool` in it. */
async function fromFlyout(app: AppContext, groupName: string, tool: string): Promise<void> {
  await f.hold(...await middleOf(app, group(groupName)), 700);
  await app.page.waitForFunction(() => !(document.getElementById("flyout") as HTMLElement).hidden, null, { timeout: 2000 });
  await f.tap(...await middleOf(app, `#flyout button[data-tool="${tool}"]`));
}

// ---- a finger ------------------------------------------------------------------

test("iPhone 13: a tap on a tool arms it and shows its tip — name, what it does, how, what else the button holds — in its own element, taking no touch", async () => {
  await freshPhone();
  assert.equal((await chosen(phone)).shown, false, "nothing chosen yet, nothing said");
  // The relate button's face is Dimension; Constrain is behind it.
  await f.tap(...await middleOf(phone, group("relate")));
  const t = await chosenBecomes(phone, (s) => s.shown, "Dimension's tip");
  assert.equal((await phone.model()).activeTool, "dimension", "armed, as a tap always did");
  assert.equal(t.name, "Dimension");
  assert.equal(t.summary, "Dimensions what you click, a solid's faces too; a click places it");
  assert.deepEqual(t.how, [
    "Tap what to measure: a line, a circle, two points…",
    "Then tap empty space to place it.",
    "Double-tap the number to edit it.",
  ], "the steps, in a finger's words");
  assert.equal(t.also, "Hold this button for Constrain.", "the one line that says the button holds more than its face");
  assert.equal(t.command, null, "not the command: the tap has just typed it");
  assert.equal(t.again, "false");
  // It is not the tooltip — the control's own, which a hover or a hold shows and Escape closes.
  assert.equal(await phone.page.$eval("#tooltip", (el) => (el as HTMLElement).hidden), true, "the tooltip itself stays away");
  assert.deepEqual(await phone.page.$eval("#chosentip", (el) => [el.getAttribute("role"), getComputedStyle(el).pointerEvents]), ["status", "none"]);
  // Nothing of it can be hit: whatever is under its middle is what a tap there reaches.
  const mid = { x: t.box!.x + t.box!.w / 2, y: t.box!.y + t.box!.h / 2 };
  const under = await phone.page.evaluate(([x, y]) => document.elementFromPoint(x, y)?.closest("#chosentip") !== null, [mid.x, mid.y]);
  assert.equal(under, false, "a tap on the tip goes to what is under it");
  await keepsClear(phone, t, "Dimension's tip");
  await shot(phone, "486-iphone-dimension-chosen-its-tip-says-constrain-is-behind-the-button");
  assert.deepEqual(phone.pageErrors, []);
});

test("iPhone 13, the owner's case: Constrain from behind Dimension, its tip up; two lines tapped — one through the tip; Parallel pressed without opening more…; the lines parallel", async () => {
  await freshPhone();
  // One line in the open middle, one up under where the tip will be.
  await type(phone, "ln(pt(-25, -6), pt(25, 4)); ln(pt(4, 46), pt(58, 42))");
  await fromFlyout(phone, "relate", "constrain");
  await settled(phone.page);
  const t = await chosenBecomes(phone, (s) => s.shown && s.name === "Constrain", "Constrain's tip");
  assert.equal((await phone.model()).activeTool, "constrain");
  assert.equal(t.summary, "Relates what you pick: choose from the relations that apply");
  assert.deepEqual(t.how, [
    "Tap the things to relate.",
    "Then choose: Parallel, Tangent…",
    "Pick several for one relation; hold a line for Leave.",
  ]);
  assert.equal(t.also, "Hold this button for Dimension.");
  await keepsClear(phone, t, "Constrain's tip");
  // Clear of the drawing's middle: the middle third of the screen, each way.
  const vp = phone.page.viewportSize()!;
  assert.ok(!meet(t.box!, { x: vp.width / 3, y: vp.height / 3, w: vp.width / 3, h: vp.height / 3 }), `clear of the drawing's middle: ${JSON.stringify(t.box)}`);
  // And the empty palette says what can be picked and what will be offered.
  assert.equal(await phone.page.$eval("#constraints .cnone", (el) => el.textContent),
    "pick what to relate — two lines, a line and a circle, a point and a line… Parallel, Perpendicular, Tangent, Midpoint and the others that fit are then listed here");
  const line = await phone.page.$eval("#constraints .cnone", (el) => { const r = el.getBoundingClientRect(), p = document.getElementById("constraints")!.getBoundingClientRect(); return r.bottom <= p.bottom + 0.5; });
  assert.ok(line, "the whole of it inside the pane");
  await shot(phone, "480-iphone-constrain-chosen-its-tip-says-how");

  // The second line lies under the tip. A tap there, on the tip, picks the line.
  const cv = await box(phone, "#cv");
  const on2 = await phone.screenOf([40, 43.333, 0]);
  const inTip = { x: cv.x + on2[0], y: cv.y + on2[1] };
  assert.ok(inTip.x > t.box!.x + 4 && inTip.x < t.box!.x + t.box!.w - 4 && inTip.y > t.box!.y + 4 && inTip.y < t.box!.y + t.box!.h - 4,
    `the tap is on the tip: ${JSON.stringify({ inTip, tip: t.box })}`);
  await phone.at(...on2); // and no pane is under it: the tip is all that is over the drawing there
  await f.tap(...on2);
  await phone.page.waitForTimeout(250);
  assert.equal((await chosen(phone)).shown, false, "gone at the first touch on the drawing");
  assert.deepEqual(await phone.page.evaluate(() => (window as never as { __neocad: { engine: { active: { related(): string[] } } } }).__neocad.engine.active.related()), ["l2"],
    "and the touch went through it: the line under the tip is picked");
  await f.tap(...await phone.screenOf([-10, -3, 0]));
  await phone.page.waitForTimeout(250);
  // Parallel is there, and the row a blank used to take is Perpendicular (TODO.md, "The phone palette wastes a row").
  const listed = await applyRows(phone);
  assert.deepEqual(listed.map((r) => r.label), ["Parallel", "Perpendicular", "6 more…"], JSON.stringify(listed));
  assert.equal(listed[0].command, 'par("l2", "l1")');
  const pane = await box(phone, "#constraints");
  for (const r of await phone.page.$$eval("#constraints .ocmd", (els) => els.map((e) => { const q = e.getBoundingClientRect(); return { y: q.y, h: q.height }; }))) {
    assert.ok(r.h >= 43.5 && r.y >= pane.y - 0.5 && r.y + r.h <= pane.y + pane.h + 0.5, `a row a finger's target tall, wholly in the pane: ${JSON.stringify({ r, pane })}`);
  }
  assert.equal(await phone.page.$("#constraints [data-section='held']"), null, "the section with nothing in it gave way to the second row");
  await shot(phone, "481-iphone-two-lines-tapped-parallel-and-perpendicular-no-more-needed");

  // One tap.
  await f.tap(...await middleOf(phone, '#constraints .ocmd[data-command=\'par("l2", "l1")\']'));
  await phone.page.waitForTimeout(400);
  assert.deepEqual((await relations(phone)).filter((r) => r.op === "parallel").map((r) => r.args), [["l2", "l1"]]);
  const pts = (await phone.model()).points;
  const dir = (a: string, b: string) => [pts[b][0] - pts[a][0], pts[b][1] - pts[a][1]];
  const [u, v] = [dir("p1", "p2"), dir("p3", "p4")];
  assert.ok(Math.abs(u[0] * v[1] - u[1] * v[0]) / (Math.hypot(...u) * Math.hypot(...v)) < 1e-6, `the lines are parallel: ${JSON.stringify([u, v])}`);
  assert.equal(await phone.status(), "SOLVED");
  // With a relation made the section has something to say, and is back.
  assert.equal(await phone.page.$eval("#constraints", (el) => el.textContent?.includes("pick what to relate")), true, "the tool waits for the next");
  await shot(phone, "482-iphone-parallel-pressed-the-two-lines-parallel");
  assert.deepEqual(phone.pageErrors, []);
});

test("iPhone 13: the second time a tool is chosen its tip is the steps alone, and goes by itself; put down, the tool takes its tip with it", async () => {
  await freshPhone();
  await f.tap(...await middleOf(phone, button("line")));
  const first = await chosenBecomes(phone, (s) => s.shown, "the line tool's tip");
  assert.deepEqual([first.name, first.again, first.how.length], ["Line", "false", 3]);
  assert.equal(first.how[2], "Cancel (✕) ends the chain.", "a finger's way out, not Esc");
  assert.equal(first.also, null, "a button of one tool holds nothing else");
  // The strip's Cancel puts the tool down: the tip is about a tool no longer in the hand.
  await f.tap(...await middleOf(phone, '#actions button[data-action="cancel"]'));
  await phone.page.waitForTimeout(300);
  assert.equal((await phone.model()).activeTool, null);
  assert.equal((await chosen(phone)).shown, false);
  // Chosen again: how, and nothing else.
  await f.tap(...await middleOf(phone, button("line")));
  const again = await chosenBecomes(phone, (s) => s.shown, "the line tool's tip, again");
  assert.deepEqual([again.name, again.summary, again.also, again.again], [null, null, null, "true"]);
  assert.deepEqual(again.how, first.how);
  assert.ok(again.box!.h < first.box!.h, "smaller than the first");
  await keepsClear(phone, again, "the steps alone");
  await shot(phone, "485-iphone-the-second-time-the-steps-alone");
  // Untouched, it goes when it has been read: under the five seconds' cap, not at once.
  const t0 = Date.now();
  await phone.page.waitForTimeout(1500);
  assert.equal((await chosen(phone)).shown, true, "still up after a second and a half");
  await chosenBecomes(phone, (s) => !s.shown, "gone by itself", 6000);
  assert.ok(Date.now() - t0 < 7000);
  assert.equal((await phone.model()).activeTool, "line", "the tool is still in the hand");
  await type(phone, "cancel()");
  assert.deepEqual(phone.pageErrors, []);
});

test("iPhone 13: every tool on the tray and behind it — its tip up as it is chosen, saying its own steps, never over the tray, its own options pane or the palette", async () => {
  await freshPhone();
  const buttons = await phone.page.$$eval("#toolbar button", (els) => els.map((e) => ({ tool: (e as HTMLElement).dataset.tool!, group: (e as HTMLElement).dataset.group ?? null })));
  assert.equal(buttons.length, 13);
  const seen: string[] = [];
  for (const b of buttons) {
    let tools = [b.tool];
    if (b.group) {
      await f.hold(...await middleOf(phone, group(b.group)), 700);
      await phone.page.waitForFunction(() => !(document.getElementById("flyout") as HTMLElement).hidden, null, { timeout: 2000 });
      tools = await phone.page.$$eval("#flyout button", (els) => els.map((e) => (e as HTMLElement).dataset.tool!));
      await phone.page.keyboard.press("Escape");
    }
    for (const tool of tools) {
      if (b.group) await fromFlyout(phone, b.group, tool);
      else await f.tap(...await middleOf(phone, button(tool)));
      await settled(phone.page);
      const t = await chosenBecomes(phone, (s) => s.shown && s.name?.toLowerCase() === tool, `${tool}'s tip`);
      const lit = await phone.page.$$eval('#toolbar button[aria-pressed="true"]', (els) => els.map((e) => (e as HTMLElement).dataset.tool));
      assert.deepEqual(lit, [tool], `${tool} is the tool in the hand`);
      assert.ok(t.how.length >= 1 && t.how.length <= 3, `${tool}: its steps, three at most: ${JSON.stringify(t.how)}`);
      for (const step of t.how) assert.doesNotMatch(step, /\bclick|[{}]/i, `${tool}: in a finger's words: ${step}`);
      assert.ok(t.summary, `${tool}: what it does`);
      assert.equal(t.also !== null, tools.length > 1, `${tool}: what else its button holds, where it holds more`);
      await keepsClear(phone, t, `${tool}'s tip`);
      seen.push(tool);
    }
  }
  assert.ok(seen.length >= 28, `every tool there is to choose: ${seen.join(", ")}`);
  await type(phone, "cancel()");
  assert.deepEqual(phone.pageErrors, []);
});

test("iPhone 13: extrude's tip is not over its options pane — and its steps, followed, build the solid", async () => {
  await freshPhone();
  await type(phone, "const a = pt(-20,-25), b = pt(20,-25), c = pt(20,0), d = pt(-20,0); ln(a,b); ln(b,c); ln(c,d); ln(d,a)");
  await f.tap(...await middleOf(phone, group("sweep")));
  await settled(phone.page);
  const t = await chosenBecomes(phone, (s) => s.shown && s.name === "Extrude", "Extrude's tip");
  assert.deepEqual(t.how, ["Tap inside a closed outline.", "Set the depth in the options; ⇅ turns it the other way.", "✓ builds the solid."]);
  assert.equal(t.also, "Hold this button for Cut, Surface, Edge.");
  const options = await shownBox(phone, PANE("options"));
  assert.ok(options, "extrude has an options pane");
  assert.ok(!meet(t.box!, options!), `the tip is not over the options it tells you to use: ${JSON.stringify({ tip: t.box, options })}`);
  await keepsClear(phone, t, "Extrude's tip");
  await shot(phone, "484-iphone-extrude-chosen-its-tip-clear-of-its-options-pane");
  // The steps are true: tap inside, ✓, a solid.
  await f.tap(...await phone.screenOf([0, -12, 0]));
  await phone.page.waitForTimeout(300);
  assert.equal((await chosen(phone)).shown, false, "gone at the touch");
  await f.tap(...await middleOf(phone, `${PANE("options")} button.ok`));
  await phone.page.waitForTimeout(600);
  assert.deepEqual(await phone.page.evaluate(() => [...(window as never as { __neocad: { model: { features: Map<string, unknown> } } }).__neocad.model.features.keys()]), ["e1"]);
  assert.deepEqual(phone.pageErrors, []);
});

test("iPhone 13: a finger held on a tool still shows its tooltip without arming it — now with the steps, and the command", async () => {
  await freshPhone();
  await f.hold(...await middleOf(phone, button("circle")), 750, true);
  await phone.page.waitForFunction(() => !(document.getElementById("tooltip") as HTMLElement).hidden, null, { timeout: 2000 });
  const held = await phone.page.$eval("#tooltip", (el) => ({
    how: Array.from(el.querySelectorAll(".thow")).map((e) => e.textContent), cmd: el.querySelector(".tcmd")?.textContent, name: el.querySelector(".tname")?.firstChild?.textContent,
  }));
  assert.deepEqual(held, {
    name: "Circle", cmd: 'arm("circle")',
    how: ["Press at the centre and drag out to the rim.", "Or tap three points for it to pass through.", "A tap along a line or circle makes it touch that."],
  });
  await f.up();
  await phone.page.waitForTimeout(200);
  assert.equal((await phone.model()).activeTool, null, "held, not armed");
  assert.equal((await chosen(phone)).shown, false, "and nothing was chosen");
  assert.deepEqual(phone.pageErrors, []);
});

test("iPhone 13: ui({ tips: false }) turns the chosen tip off, the menu's row says so, and it is remembered across a reload; true brings it back", async () => {
  await freshPhone();
  assert.match(String((await phone.repl("ui()")).value), /; tips on \(a tool chosen by finger says how it is used\)$/);
  await type(phone, "ui({ tips: false })");
  assert.match(String((await phone.repl("ui()")).value), /; tips off /);
  await f.tap(...await middleOf(phone, button("circle")));
  await phone.page.waitForTimeout(500);
  assert.equal((await phone.model()).activeTool, "circle", "the tap arms as ever");
  assert.equal((await chosen(phone)).shown, false, "and says nothing");
  await type(phone, "cancel()");
  // The app menu's View has the row, unticked, with the line that turns it on.
  await phone.page.touchscreen.tap(...await phone.page.$eval("#logo", (el) => { const r = el.getBoundingClientRect(); return [r.x + r.width / 2, r.y + r.height / 2] as [number, number]; }));
  await phone.page.waitForSelector("#appmenu:not([hidden]) [data-tips]");
  const row = await phone.page.$eval("#appmenu [data-tips]", (el) => ({
    label: el.querySelector("span")?.textContent, cmd: el.querySelector(".cmd")?.textContent, on: (el.querySelector("input") as HTMLInputElement).checked,
  }));
  assert.deepEqual(row, { label: "Tips when a tool is chosen", cmd: "ui({ tips: true })", on: false });
  await phone.page.keyboard.press("Escape");
  // Remembered: the viewer's, on this device.
  await forgetAutosave(phone.page);
  await phone.page.reload({ waitUntil: "networkidle" });
  await phone.page.waitForFunction(() => document.getElementById("status")?.textContent?.includes("ready"), null, { timeout: 20_000 });
  await phone.page.evaluate(() => (document.activeElement as HTMLElement | null)?.blur());
  f = await fingers(phone);
  await f.tap(...await middleOf(phone, button("circle")));
  await phone.page.waitForTimeout(500);
  assert.equal((await chosen(phone)).shown, false, "still off after a reload");
  // And back, by the menu's row.
  await phone.page.touchscreen.tap(...await phone.page.$eval("#logo", (el) => { const r = el.getBoundingClientRect(); return [r.x + r.width / 2, r.y + r.height / 2] as [number, number]; }));
  await phone.page.waitForSelector("#appmenu:not([hidden]) [data-tips]");
  await phone.page.$eval("#appmenu [data-tips]", (el) => el.scrollIntoView({ block: "center" }));
  await phone.page.touchscreen.tap(...await phone.page.$eval("#appmenu [data-tips] input", (el) => { const r = el.getBoundingClientRect(); return [r.x + r.width / 2, r.y + r.height / 2] as [number, number]; }));
  await phone.page.waitForTimeout(300);
  assert.match(await phone.log(), /> ui\(\{ tips: true \}\)/, "the row types its line");
  await phone.page.keyboard.press("Escape");
  await phone.page.waitForTimeout(200);
  f = await fingers(phone);
  await f.tap(...await middleOf(phone, button("point")));
  assert.equal((await chosenBecomes(phone, (s) => s.shown, "back on")).name, "Point");
  const bad = await phone.repl('ui({ tips: "no" })');
  assert.equal(bad.ok, false);
  assert.match(bad.error!, /ui\(\{ tips \}\) takes true or false/);
  assert.equal((await phone.repl("journal()")).value?.toString().includes("ui("), false, "nothing journalled: it is the viewer's");
  await type(phone, "cancel()");
  assert.deepEqual(phone.pageErrors, []);
});

test("iPhone 13 landscape: the chosen tip is inside the window, off the tray and the palette — LOOK", async () => {
  const land = await openApp({ device: "iPhone 13 landscape" });
  apps.push(land);
  await fresh(land);
  f = await fingers(land);
  await type(land, "ln(pt(-25, 8), pt(25, 14)); ln(pt(-25, 30), pt(25, 26))");
  await fromFlyout(land, "relate", "constrain");
  await settled(land.page);
  const t = await chosenBecomes(land, (s) => s.shown && s.name === "Constrain", "Constrain's tip, landscape");
  await keepsClear(land, t, "landscape");
  await shot(land, "487-iphone-landscape-the-tip-over-the-organiser-and-the-drawings-corner");
  // The lines are still tapped, wherever the tip is.
  await f.tap(...await land.screenOf([-10, 9.8, 0]));
  await land.page.waitForTimeout(250);
  await f.tap(...await land.screenOf([-10, 28.8, 0]));
  await land.page.waitForTimeout(250);
  assert.equal((await applyRows(land))[0]?.command, 'par("l1", "l2")');
  assert.equal((await chosen(land)).shown, false);
  assert.deepEqual(land.pageErrors, []);
});

// ---- a mouse -------------------------------------------------------------------

test("desktop: a hover's tooltip has the steps, in a mouse's words, between what the tool does and the command — and a click shows no tip of its own", async () => {
  await fresh(desk);
  await desk.type("ln(pt(-30, -10), pt(10, -4)); ln(pt(-30, 12), pt(10, 20))");
  await desk.page.mouse.move(700, 500);
  const hover = async (sel: string) => {
    const r = await box(desk, sel);
    await desk.page.mouse.move(r.x + r.w / 2, r.y + r.h / 2, { steps: 3 });
    await desk.page.waitForFunction(() => !(document.getElementById("tooltip") as HTMLElement).hidden, null, { timeout: 2000 });
    return desk.page.$eval("#tooltip", (el) => Array.from(el.children).map((c) => `${c.className}: ${c.className === "tname" ? c.firstChild?.textContent : c.textContent}`));
  };
  assert.deepEqual(await hover(button("line")), [
    "tname: Line",
    "tsum: Draws lines: click the start, then the end of each in turn",
    "thow: Click the start, then the end of each line in turn.",
    "thow: Start or end on a point or a line to join it.",
    "thow: Esc ends the chain.",
    'tcmd: arm("line")',
  ]);
  // Constrain, where it lives: an item of the relate button's flyout.
  const g = await box(desk, group("relate"));
  await desk.page.mouse.move(700, 500);
  await desk.page.waitForTimeout(700);
  await desk.page.mouse.move(g.x + g.w / 2, g.y + g.h / 2, { steps: 3 });
  await desk.page.waitForFunction(() => !(document.getElementById("flyout") as HTMLElement).hidden, null, { timeout: 2000 });
  assert.deepEqual(await hover('#flyout button[data-tool="constrain"]'), [
    "tname: Constrain",
    "tsum: Relates what you pick: choose from the relations that apply",
    "thow: Click the things to relate: two lines, a line and a circle…",
    "thow: Then choose: Parallel, Tangent…",
    "thow: Pick several for one relation; right-click a line for Leave.",
    'tcmd: arm("constrain")',
  ]);
  const tip = await box(desk, "#tooltip");
  assert.ok(!meet(tip, await box(desk, PANE("toolbar"))) && !meet(tip, await box(desk, "#flyout")), "beside the tray and its flyout, as ever");
  await shot(desk, "483-desktop-hovering-constrain-the-tooltip-with-its-steps");
  // A click arms it, and a mouse gets no tip it did not ask for.
  const item = await box(desk, '#flyout button[data-tool="constrain"]');
  await desk.page.mouse.click(item.x + item.w / 2, item.y + item.h / 2);
  await desk.page.waitForTimeout(400);
  assert.equal((await desk.model()).activeTool, "constrain");
  assert.equal((await chosen(desk)).shown, false, "no chosen tip under a mouse");
  // The steps are true with a mouse too: click, click, Parallel.
  await desk.page.mouse.move(700, 500);
  for (const at of [[-10, -7, 0], [-10, 16, 0]]) {
    const p = await desk.at(...await desk.screenOf(at));
    await desk.page.mouse.click(p.x, p.y);
    await desk.page.waitForTimeout(150);
  }
  await desk.page.click('#constraints .ocmd[data-command=\'par("l1", "l2")\']');
  await desk.page.waitForTimeout(300);
  assert.deepEqual((await relations(desk)).map((r) => r.op), ["parallel"]);
  await desk.type("cancel()");
  assert.deepEqual(desk.pageErrors, []);
});

test("desktop: the constrain tool's third step is true — three lines picked and one press make one relation; a right-click on a line offers Leave, and it leaves", async () => {
  await fresh(desk);
  await desk.type("ln(pt(-30, 30), pt(-5, 32)); ln(pt(-30, 18), pt(-8, 21)); ln(pt(-30, 6), pt(-2, 3))");
  await desk.type("constrain");
  await desk.page.mouse.move(700, 500);
  const mid = async (l: string) => {
    const [a, b] = await desk.page.evaluate((n) => {
      const m = (window as never as { __neocad: { model: { line(n: string): { refs: [string, string] }; coords(n: string): number[] } } }).__neocad.model;
      return m.line(n).refs.map((p) => m.coords(p));
    }, l);
    return desk.at(...await desk.screenOf(a.map((v, i) => (v + b[i]) / 2)));
  };
  for (const l of ["l1", "l2", "l3"]) {
    const p = await mid(l);
    await desk.page.mouse.click(p.x, p.y);
    await desk.page.waitForTimeout(150);
  }
  await desk.page.click('#constraints .ocmd[data-command=\'par("l1", "l2", "l3")\']');
  await desk.page.waitForTimeout(300);
  assert.deepEqual(await relations(desk), [{ op: "parallel", args: ["l1", "l2", "l3"] }], "pick several for one relation");
  await desk.page.keyboard.press("Escape");
  await desk.page.waitForTimeout(200);
  const p = await mid("l2");
  await desk.page.mouse.click(p.x, p.y, { button: "right" });
  await desk.page.waitForSelector("#ctxmenu:not([hidden])");
  const leave = desk.page.locator("#ctxmenu .item", { hasText: /^Leave / });
  assert.match(await leave.first().textContent() ?? "", /^Leave r1 .*leave\("r1", "l2"\)$/, "right-click a line for Leave");
  await leave.first().click();
  await desk.page.waitForTimeout(300);
  assert.deepEqual(await relations(desk), [{ op: "parallel", args: ["l1", "l3"] }], "and it has left");
  assert.deepEqual(desk.pageErrors, []);
});

test("desktop: a circle locked to three points says so on its hover — the steps are of the tool as it would be armed", async () => {
  await fresh(desk);
  await desk.type('arm("circle", { method: "3pt" })');
  await desk.type("cancel()");
  await desk.page.mouse.move(700, 500);
  await desk.page.waitForTimeout(700);
  const r = await box(desk, button("circle"));
  await desk.page.mouse.move(r.x + r.w / 2, r.y + r.h / 2, { steps: 3 });
  await desk.page.waitForFunction(() => !(document.getElementById("tooltip") as HTMLElement).hidden, null, { timeout: 2000 });
  assert.deepEqual(await desk.page.$$eval("#tooltip .thow", (els) => els.map((e) => e.textContent)),
    ["Click three points for it to pass through.", "Locked to 3 points: the options unlock it."], "the lock is this viewer's last word on it, and arm would use it");
  await desk.type('arm("circle", { method: "auto" })');
  await desk.type("cancel()");
  await desk.page.mouse.move(700, 500);
  await desk.page.waitForTimeout(700);
  await desk.page.mouse.move(r.x + r.w / 2, r.y + r.h / 2, { steps: 3 });
  await desk.page.waitForFunction(() => !(document.getElementById("tooltip") as HTMLElement).hidden, null, { timeout: 2000 });
  assert.equal(await desk.page.$eval("#tooltip .thow", (el) => el.textContent), "Press at the centre and drag out to the rim.");
  await desk.page.mouse.move(700, 500);
  assert.deepEqual(desk.pageErrors, []);
});

test("desktop: the ✓'s tooltip says what a confirm does now — it puts the tool down (bug 74: it said the tool stays armed)", async () => {
  await fresh(desk);
  await desk.type("const a = pt(-30,-20), b = pt(30,-20), c = pt(30,20), d = pt(-30,20); ln(a,b); ln(b,c); ln(c,d); ln(d,a)");
  await desk.type("extrude");
  const p = await desk.at(...await desk.screenOf([0, 0, 0]));
  await desk.page.mouse.click(p.x, p.y);
  await desk.page.waitForTimeout(300);
  const ok = await box(desk, `${PANE("options")} button.ok`);
  await desk.page.mouse.move(ok.x + ok.w / 2, ok.y + ok.h / 2, { steps: 3 });
  await desk.page.waitForFunction(() => !(document.getElementById("tooltip") as HTMLElement).hidden, null, { timeout: 2000 });
  assert.equal(await desk.page.$eval("#tooltip .tsum", (el) => el.textContent), "Builds what the preview shows, and puts the tool down");
  await desk.page.mouse.click(ok.x + ok.w / 2, ok.y + ok.h / 2);
  await desk.page.waitForTimeout(600);
  assert.equal((await desk.model()).activeTool, null, "which is what happens");
  assert.deepEqual(desk.pageErrors, []);
});

test("no uncaught page errors", () => {
  for (const a of apps) assert.deepEqual(a.pageErrors, []);
});
