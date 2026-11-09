// The constraints palette (docs/plans/constraints-palette.md), driven the way a
// user drives it, with a mouse and then a finger on an iPhone 13. The owner:
// *"the constraint list should not be on the features palette, it should be a
// separate constraints palette. although i think it should still be installed
// as a workbench."*
//
// What only a browser shows: that the pane is up from the start on a desktop
// and hidden on a phone until the constrain tool brings it, and goes when the
// tool does; that a selection made with nothing armed feeds it; that a row
// pressed types its line and the held list follows; that a dimension's field
// types `set`; that × types `del`; that the agreeing set is listed, and the
// status counts it; that the app menu's Panes hides and shows it; and that a
// workbench without its module has no palette, the constrain tool's options
// pane listing the relations as it did. Pictures with NEOCAD_E2E_SHOTS.

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
  await app.page.screenshot({ path: join(SHOTS, `palette-${name}.png`) });
}

const PANE = '.panel[data-panel="constraints"]';

let desk: AppContext;
let phone: AppContext;
let f: Fingers;

before(async () => {
  desk = await openApp();
  phone = await openApp({ device: "iPhone 13" });
});
after(async () => { await desk.close(); await phone.close(); });

async function fresh(app: AppContext): Promise<void> {
  await app.page.evaluate(() => localStorage.clear());
  await forgetAutosave(app.page);
  await app.page.reload({ waitUntil: "networkidle" });
  await app.page.waitForFunction(() => document.getElementById("status")?.textContent?.includes("ready"), null, { timeout: 20_000 });
  if (app === phone) f = await fingers(phone);
}

/** Types a line, then lets go of the command line, as a hand does before it touches the drawing again. */
async function type(app: AppContext, line: string): Promise<void> {
  await app.type(line);
  await app.page.evaluate(() => (document.activeElement as HTMLElement | null)?.blur());
}

const hidden = (app: AppContext) => app.page.$eval(PANE, (el) => (el as HTMLElement).hidden);
const paneBox = (app: AppContext) => app.page.$eval(PANE, (el) => { const r = el.getBoundingClientRect(); return { x: r.x, y: r.y, w: r.width, h: r.height }; });
const box = (app: AppContext, sel: string) => app.page.$eval(sel, (el) => { const r = el.getBoundingClientRect(); return { x: r.x, y: r.y, w: r.width, h: r.height }; });
/** A canvas pixel in the middle of `sel`. */
const middleOf = (app: AppContext, sel: string) => app.page.$eval(sel, (el) => {
  const r = el.getBoundingClientRect(), c = document.getElementById("cv")!.getBoundingClientRect();
  return [r.x + r.width / 2 - c.x, r.y + r.height / 2 - c.y] as [number, number];
});
const applyRows = (app: AppContext) => app.page.$$eval("#constraints .ocmd", (els) => els.map((e) => ({
  label: e.querySelector(".olabel")?.textContent ?? "", command: (e as HTMLElement).dataset.command ?? "", more: e.classList.contains("more"),
})));
const heldRows = (app: AppContext, section = "held") => app.page.$$eval(`#constraints [data-section="${section}"] .crow`, (els) => els.map((e) => ({
  name: (e as HTMLElement).dataset.name ?? "", glyph: e.querySelector(".cglyph")?.textContent ?? "", text: e.querySelector(".cdesc")?.textContent ?? "",
  value: (e.querySelector(".cval") as HTMLInputElement | null)?.value ?? null, on: e.classList.contains("on"),
})));
const sectionIds = (app: AppContext) => app.page.$$eval("#constraints .csect", (els) => els.map((e) => (e as HTMLElement).dataset.section));
const diagnosisText = (app: AppContext) => app.page.$eval("#diagnosis", (el) => el.textContent ?? "");
const lastTyped = (app: AppContext) => app.page.$$eval("#log div", (els) => els.map((e) => e.textContent ?? "").filter((t) => t.startsWith("> ")).at(-1)?.slice(2) ?? "");
const relations = (app: AppContext) => app.page.evaluate(() =>
  [...(window as never as { __neocad: { model: { relations: Map<string, { op: string; args: unknown[] }> } } }).__neocad.model.relations.entries()]
    .map(([name, r]) => ({ name, op: r.op, args: r.args })));
const coords = (app: AppContext, n: string) => app.page.evaluate((p) => (window as never as { __neocad: { model: { coords(n: string): number[] } } }).__neocad.model.coords(p), n);

/** A point along a line, `t` of the way from its first end, in canvas pixels. */
async function along(app: AppContext, line: string, t: number): Promise<[number, number]> {
  const [a, b] = await app.page.evaluate((l) => {
    const m = (window as never as { __neocad: { model: { line(n: string): { refs: [string, string] }; coords(n: string): number[] } } }).__neocad.model;
    const refs = m.line(l).refs;
    return [m.coords(refs[0]), m.coords(refs[1])];
  }, line);
  return app.screenOf(a.map((v, i) => v + t * (b[i] - v)));
}

async function click(app: AppContext, at: [number, number], shift = false): Promise<void> {
  const p = await app.at(...at);
  if (shift) await app.page.keyboard.down("Shift");
  await app.page.mouse.click(p.x, p.y);
  if (shift) await app.page.keyboard.up("Shift");
  await app.page.waitForTimeout(150);
}

/** Every shown pane wholly on screen and none over another — the page's own check reports a problem as an error otherwise. */
async function noOverlap(app: AppContext): Promise<void> {
  const panes = await app.page.$$eval("#viewwrap > .panel:not([hidden])", (els) => els.map((e) => {
    const r = e.getBoundingClientRect();
    return { id: (e as HTMLElement).dataset.panel, x: r.x, y: r.y, w: r.width, h: r.height };
  }));
  const vp = app.page.viewportSize()!;
  for (const p of panes) assert.ok(p.x >= -0.5 && p.y >= -0.5 && p.x + p.w <= vp.width + 0.5 && p.y + p.h <= vp.height + 0.5, `${p.id} on screen: ${JSON.stringify(p)}`);
  for (const a of panes) for (const b of panes) {
    if (a.id! >= b.id!) continue;
    const over = a.x < b.x + b.w - 0.5 && b.x < a.x + a.w - 0.5 && a.y < b.y + b.h - 0.5 && b.y < a.y + a.h - 0.5;
    assert.ok(!over, `${a.id} over ${b.id}: ${JSON.stringify([a, b])}`);
  }
}

// ---- a mouse -------------------------------------------------------------------

test("desktop: the palette is up from the start, up the right edge, listing the drawing's relations — none yet", async () => {
  await fresh(desk);
  assert.equal(await hidden(desk), false, "shown from the start on a desktop");
  const vp = desk.page.viewportSize()!;
  const p = await paneBox(desk);
  assert.ok(p.x + p.w > vp.width - 20, `against the right edge: ${JSON.stringify(p)}`);
  assert.ok(p.y < 100, `under the logo's row: ${JSON.stringify(p)}`);
  assert.deepEqual(await sectionIds(desk), ["all"]);
  assert.match(await desk.page.$eval("#constraints .cnone", (el) => el.textContent ?? ""), /none — select something/);
  await noOverlap(desk);
  await shot(desk, "1-desktop-fresh");
});

test("desktop: two lines selected with nothing armed feed the palette; Parallel pressed types its line, the selection stays, and the held list shows // with ×", async () => {
  await fresh(desk);
  await type(desk, "ln(pt(-30, 0), pt(30, 4)); ln(pt(-30, 25), pt(30, 15))");
  await click(desk, await along(desk, "l1", 0.3));
  await click(desk, await along(desk, "l2", 0.3), true);
  assert.deepEqual((await desk.selection()).sort(), ["l1", "l2"]);
  const listed = await applyRows(desk);
  assert.deepEqual(listed.slice(0, 4).map((r) => r.command), ['par("l1", "l2")', 'perp("l1", "l2")', 'eq("l1", "l2")', 'col("l1", "l2")']);
  assert.equal(listed.length, 8, "a desktop pane holds every row");
  assert.ok(!listed.some((r) => r.more), "no more… row where they all fit");
  assert.deepEqual(await heldRows(desk), [], "nothing held yet");
  await shot(desk, "2-desktop-two-lines-selected");
  await desk.page.click('#constraints .ocmd[data-command="par(\\"l1\\", \\"l2\\")"]');
  await desk.page.waitForTimeout(300);
  assert.equal(await lastTyped(desk), 'par("l1", "l2")');
  const par = (await relations(desk)).filter((r) => r.op === "parallel");
  assert.deepEqual(par.map((r) => r.args), [["l1", "l2"]]);
  assert.deepEqual((await desk.selection()).sort(), ["l1", "l2"], "the selection stays, so the next relation needs no reselecting");
  const held = await heldRows(desk);
  assert.deepEqual(held.map((r) => [r.name, r.glyph, r.text]), [[par[0].name, "//", "par l1 l2"]]);
  await shot(desk, "3-desktop-parallel-held");
  // × types del; one undo step brings it back.
  await desk.page.click(`#constraints .crow[data-name="${par[0].name}"] .cdel`);
  await desk.page.waitForTimeout(300);
  assert.equal(await lastTyped(desk), `del("${par[0].name}")`);
  assert.deepEqual((await relations(desk)).filter((r) => r.op === "parallel"), []);
  assert.equal((await desk.repl("undo()")).ok, true);
  assert.deepEqual((await relations(desk)).filter((r) => r.op === "parallel").map((r) => r.name), [par[0].name]);
});

test("desktop: a dimension edited from the palette — 30 typed as 45 types set, and the line is 45 long; a tap on the row selects the relation", async () => {
  await fresh(desk);
  await type(desk, 'a = pt(-15, 0); b = pt(15, 0); ln(a, b); dist(a, b, 30)');
  await type(desk, 'select("l1")');
  const held = await heldRows(desk);
  assert.deepEqual(held.map((r) => [r.name, r.glyph, r.value]), [["d1", "30", "30"]], "the line's dist is what it has, by its label");
  const field = desk.page.locator('#constraints .crow[data-name="d1"] .cval');
  await field.click();
  await field.fill("45");
  await field.press("Enter");
  await desk.page.waitForTimeout(400);
  assert.equal(await lastTyped(desk), 'set("d1.value", 45)');
  const [p, q] = [await coords(desk, "p1"), await coords(desk, "p2")];
  assert.ok(Math.abs(Math.hypot(...p.map((v, i) => v - q[i])) - 45) < 1e-6, "45 long");
  assert.equal((await heldRows(desk))[0].value, "45", "the field shows the new value");
  await shot(desk, "4-desktop-dimension-edited");
  // Text that is not a number puts the field back and types nothing.
  await field.click();
  await field.fill("forty");
  await field.press("Enter");
  await desk.page.waitForTimeout(200);
  assert.equal((await heldRows(desk))[0].value, "45");
  assert.equal(await lastTyped(desk), 'set("d1.value", 45)');
  // A tap on the row selects the relation itself.
  await desk.page.click('#constraints .crow[data-name="d1"] .cname');
  await desk.page.waitForTimeout(200);
  assert.equal(await lastTyped(desk), 'select("d1")');
  assert.deepEqual(await desk.selection(), ["d1"]);
});

test("desktop: a rectangle's four right angles are one agreeing set — counted in the status, named in the palette, none blamed", async () => {
  await fresh(desk);
  await type(desk, 'a = pt(0, 0); b = pt(40, 0); c = pt(40, 25); d = pt(0, 25); ln(a, b); ln(b, c); ln(c, d); ln(d, a); '
    + 'perp("l1", "l2"); perp("l2", "l3"); perp("l3", "l4"); perp("l4", "l1")');
  assert.equal(await desk.status(), "SOLVED");
  assert.match(await diagnosisText(desk), /free · 4 agreeing$/);
  assert.equal(await desk.page.$eval("#diagnosis", (el) => el.className), "agreeing");
  assert.deepEqual(await sectionIds(desk), ["all", "agreeing"]);
  const set = await heldRows(desk, "agreeing");
  assert.deepEqual(set.map((r) => r.name), ["r1", "r2", "r3", "r4"]);
  assert.match(await desk.page.$eval('#constraints [data-section="agreeing"] .chead', (el) => el.textContent ?? ""), /4 say one thing together — none is wrong/);
  await shot(desk, "5-desktop-agreeing-set");
  // A right-click on a row is the relation's menu: Delete on it.
  const r = await box(desk, '#constraints .crow[data-name="r2"]');
  await desk.page.mouse.click(r.x + r.w / 2, r.y + r.h / 2, { button: "right" });
  await desk.page.waitForSelector("#ctxmenu:not([hidden])", { timeout: 3000 });
  const items = await desk.page.$$eval("#ctxmenu .item", (els) => els.map((e) => e.textContent?.trim().split(/\s{2,}/)[0] ?? ""));
  assert.ok(items.some((t) => t.startsWith("Delete")), items.join(", "));
  await desk.page.keyboard.press("Escape");
});

test("desktop: the pane is in the app menu's Panes, and hides and shows from there", async () => {
  await fresh(desk);
  await desk.page.click("#logo");
  const listed = await desk.page.$$eval("#appmenu .item.check[data-pane]", (els) => els.map((e) => (e as HTMLElement).dataset.pane));
  assert.ok(listed.includes("constraints"), listed.join(", "));
  await desk.page.click('#appmenu .item.check[data-pane="constraints"] input');
  await desk.page.waitForTimeout(150);
  assert.equal(await hidden(desk), true);
  assert.equal(await lastTyped(desk), 'ui({ hide: "constraints" })');
  await desk.page.click('#appmenu .item.check[data-pane="constraints"] input');
  await desk.page.waitForTimeout(150);
  assert.equal(await hidden(desk), false);
  await desk.page.keyboard.press("Escape");
});

test("desktop: a workbench without the constraints module has no palette; the constrain tool lists in its options pane as it did; back in part the palette returns", async () => {
  await fresh(desk);
  await type(desk, 'defineWorkbench("bare", { label: "Bare", modules: ["core", "sketch"] })');
  await type(desk, 'workbench("bare")');
  await desk.page.waitForTimeout(200);
  assert.equal(await hidden(desk), true, "no palette on a workbench without its module");
  await desk.page.click("#logo");
  const listed = await desk.page.$$eval("#appmenu .item.check[data-pane]", (els) => els.map((e) => (e as HTMLElement).dataset.pane));
  assert.ok(!listed.includes("constraints"), `not in Panes either: ${listed.join(", ")}`);
  await desk.page.keyboard.press("Escape");
  const r = await desk.repl('ui({ show: "constraints" })');
  assert.equal(r.ok, false);
  assert.match(r.error ?? "", /not on this workbench/);
  // The constrain tool is still the sketch module's: armed on two lines, its
  // options pane lists the relations, as before the palette.
  await type(desk, "ln(pt(-30, 0), pt(30, 4)); ln(pt(-30, 25), pt(30, 15))");
  await type(desk, 'select("l1", "l2")');
  await type(desk, "constrain");
  await desk.page.waitForSelector('#options .ocmd[data-command="par(\\"l1\\", \\"l2\\")"]', { state: "visible", timeout: 3000 });
  assert.equal(await hidden(desk), true, "the tool cannot summon a pane that is not there");
  await shot(desk, "6-desktop-bare-workbench-options-pane");
  await desk.page.keyboard.press("Escape");
  await desk.page.keyboard.press("Escape");
  await type(desk, 'workbench("part")');
  await desk.page.waitForTimeout(200);
  assert.equal(await hidden(desk), false, "back");
  assert.equal(await desk.page.$$eval("#options .ocmd", (els) => els.length), 0, "and the options pane no longer lists them");
});

test("no uncaught page errors (desktop)", () => {
  assert.deepEqual(desk.pageErrors, []);
});

// ---- a finger, iPhone 13 ---------------------------------------------------------

test("iPhone 13: hidden from the start; the constrain tool brings it up docked at the bottom, over no pane; put down, it goes; Panes keeps it", async () => {
  await fresh(phone);
  assert.equal(await hidden(phone), true, "a phone starts without it");
  await type(phone, "ln(pt(-20, 0), pt(20, 3)); ln(pt(-20, 25), pt(20, 15))");
  await type(phone, "constrain");
  await phone.page.waitForTimeout(300);
  await settled(phone.page);
  assert.equal(await hidden(phone), false, "summoned by the tool");
  const vp = phone.page.viewportSize()!;
  const p = await paneBox(phone);
  const cmd = await box(phone, '.panel[data-panel="cmd"]');
  assert.ok(p.y + p.h <= cmd.y + 0.5 && p.y + p.h > cmd.y - 40, `docked just above the command line: ${JSON.stringify({ p, cmd })}`);
  assert.ok(p.y > vp.height / 2, `in the lower half: ${JSON.stringify(p)}`);
  await noOverlap(phone);
  assert.match(await phone.page.$eval("#constraints .cnone", (el) => el.textContent ?? ""), /^pick what to relate/);
  await shot(phone, "7-iphone-constrain-armed-the-palette-up");
  // Tap the two lines: the rows, a finger's target tall, the likeliest shown.
  await f.tap(...await along(phone, "l1", 0.3));
  await phone.page.waitForTimeout(250);
  await f.tap(...await along(phone, "l2", 0.3));
  await phone.page.waitForTimeout(250);
  const listed = await applyRows(phone);
  assert.equal(listed[0]?.command, 'par("l1", "l2")');
  const rowH = await box(phone, "#constraints .ocmd");
  assert.ok(rowH.h >= 43.5, `a row a target tall: ${rowH.h}`);
  await shot(phone, "8-iphone-two-lines-tapped");
  await f.tap(...await middleOf(phone, '#constraints .ocmd[data-command="par(\\"l1\\", \\"l2\\")"]'));
  await phone.page.waitForTimeout(400);
  assert.deepEqual((await relations(phone)).filter((r) => r.op === "parallel").map((r) => r.args), [["l1", "l2"]]);
  // The tool put down (✗ on the strip, Escape's cancel): the palette goes with it.
  await f.tap(...await middleOf(phone, '#actions button[data-action="cancel"]'));
  await phone.page.waitForTimeout(400);
  await settled(phone.page);
  assert.equal(await hidden(phone), true, "hidden again with the tool down");
  // Shown from Panes, it stays whatever is armed.
  await phone.page.touchscreen.tap(...await phone.page.$eval("#logo", (el) => { const r = el.getBoundingClientRect(); return [r.x + r.width / 2, r.y + r.height / 2] as [number, number]; }));
  await phone.page.waitForTimeout(200);
  await phone.page.$eval('#appmenu .item.check[data-pane="constraints"]', (el) => el.scrollIntoView({ block: "center" }));
  const [bx, by] = await phone.page.$eval('#appmenu .item.check[data-pane="constraints"]', (el) => { const r = el.getBoundingClientRect(); return [r.x + r.width / 2, r.y + r.height / 2]; });
  await phone.page.touchscreen.tap(bx, by);
  await phone.page.waitForTimeout(300);
  assert.equal(await lastTyped(phone), 'ui({ show: "constraints" })');
  await phone.page.keyboard.press("Escape");
  await settled(phone.page);
  assert.equal(await hidden(phone), false, "kept");
  await noOverlap(phone);
  const held = await heldRows(phone, "all");
  assert.deepEqual(held.map((r) => r.glyph), ["//"], "with nothing selected the drawing's relations are listed");
  await shot(phone, "9-iphone-kept-from-panes");
});

test("iPhone 13: a dimension edited by finger from the palette", async () => {
  await fresh(phone);
  await type(phone, 'a = pt(-15, 0); b = pt(15, 0); ln(a, b); dist(a, b, 30)');
  await type(phone, 'ui({ show: "constraints" })');
  await type(phone, 'select("l1")');
  await settled(phone.page);
  assert.deepEqual((await heldRows(phone)).map((r) => [r.name, r.value]), [["d1", "30"]]);
  const field = phone.page.locator('#constraints .crow[data-name="d1"] .cval');
  const fb = await box(phone, '#constraints .crow[data-name="d1"] .cval');
  assert.ok(fb.h >= 43.5, `the field a target tall under a finger: ${fb.h}`);
  await field.tap();
  await field.fill("45");
  await field.press("Enter");
  await phone.page.waitForTimeout(400);
  assert.equal(await lastTyped(phone), 'set("d1.value", 45)');
  const [p, q] = [await coords(phone, "p1"), await coords(phone, "p2")];
  assert.ok(Math.abs(Math.hypot(...p.map((v, i) => v - q[i])) - 45) < 1e-6, "45 long");
  await shot(phone, "10-iphone-dimension-edited");
});

test("iPhone 13 landscape: the constrain tool's palette stands at the side — the left, under the logo — over no pane, the drawing's middle clear", async () => {
  const p = await openApp({ device: "iPhone 13 landscape" });
  try {
    const ff = await fingers(p);
    await p.page.evaluate(() => localStorage.clear());
    await forgetAutosave(p.page);
    await p.page.reload({ waitUntil: "networkidle" });
    await p.page.waitForFunction(() => document.getElementById("status")?.textContent?.includes("ready"), null, { timeout: 20_000 });
    assert.equal(await hidden(p), true);
    await type(p, "ln(pt(-20, 0), pt(20, 3)); ln(pt(-20, 25), pt(20, 15))");
    await type(p, "constrain");
    await p.page.waitForTimeout(300);
    await settled(p.page);
    assert.equal(await hidden(p), false);
    const pane = await paneBox(p);
    const log = await box(p, '.panel[data-panel="log"]');
    const tray = await box(p, '.panel[data-panel="toolbar"]');
    const vp = p.page.viewportSize()!;
    assert.ok(pane.x < 60, `at the left side: ${JSON.stringify(pane)}`);
    assert.ok(pane.x + pane.w < vp.width / 2 - 40, `clear of the drawing's middle: ${JSON.stringify(pane)}`);
    assert.ok(pane.x + pane.w <= log.x + 0.5, `left of the column: ${JSON.stringify({ pane, log })}`);
    assert.ok(pane.y + pane.h <= tray.y + 0.5, `above the tray's row: ${JSON.stringify({ pane, tray })}`);
    await noOverlap(p);
    await ff.tap(...await along(p, "l1", 0.3));
    await p.page.waitForTimeout(250);
    await ff.tap(...await along(p, "l2", 0.3));
    await p.page.waitForTimeout(250);
    assert.equal((await applyRows(p))[0]?.command, 'par("l1", "l2")');
    await shot(p, "11-iphone-landscape-at-the-side");
    assert.deepEqual(p.pageErrors, []);
  } finally {
    await p.close();
  }
});

test("no uncaught page errors (phone)", () => {
  assert.deepEqual(phone.pageErrors, []);
});
