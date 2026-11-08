// Workbenches in the app (docs/plans/workbenches.md), with a mouse and then a
// finger in iPhone 13 emulation: the default tray is today's; the logo menu
// switches workbench and the tray and the menu follow while typed names do
// not; a drawing made in one is extruded in the other; the workbench is
// remembered by the document; Add workbench… takes a file from the device,
// shows its manifest, asks, loads it, keeps it across a reload, hands it back
// byte for byte, and removes it; a file whose manifest lies is refused; a
// document that needs a workbench opens on a fresh profile with the offer and
// the rest of the drawing; a module pasted at the command line has a button.

import { test, before, after } from "node:test";
import assert from "node:assert/strict";
import { mkdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { openApp, forgetAutosave, type AppContext } from "./harness.ts";
import { fingers } from "./fingers.ts";

const SHOTS = process.env.NEOCAD_E2E_SHOTS;
async function shot(app: AppContext, name: string): Promise<void> {
  if (!SHOTS) return;
  mkdirSync(SHOTS, { recursive: true });
  await app.page.waitForTimeout(200);
  await app.page.screenshot({ path: join(SHOTS, `workbenches-${name}.png`) });
}

const PINS = readFileSync(new URL("../fixtures/workbenches/pins.zerocad.js", import.meta.url), "utf8");
const LIAR = readFileSync(new URL("../fixtures/workbenches/liar.zerocad.js", import.meta.url), "utf8");

/** Today's tray, button by button — what `part` must still be. */
const PART_TRAY = ["select", "hand", "point", "line", "rectangle", "circle", "arc", "ellipse", "trim", "dimension",
  "extrude", "revolve", "sketch"]; // dimension shows the relate group (dimension, constrain); trim the modify group since trim everything
const SKETCH_TRAY = PART_TRAY.filter((t) => !["extrude", "revolve", "sketch"].includes(t));

async function fresh(app: AppContext): Promise<void> {
  await app.page.evaluate(() => localStorage.clear());
  await forgetAutosave(app.page);
  await app.page.reload({ waitUntil: "networkidle" });
  await app.page.waitForFunction(() => document.getElementById("status")?.textContent?.includes("ready"), null, { timeout: 20_000 });
}

/** The tray's buttons, by the tool each shows (a group's, its current member). */
const tray = (app: AppContext) => app.page.$$eval("#toolbar > button[data-tool]", (bs) => bs.map((b) => (b as HTMLElement).dataset.tool!));

/** Every tray button wholly on screen — everything fits still holds. */
async function trayFits(app: AppContext): Promise<void> {
  const off = await app.page.$$eval("#toolbar > button", (bs) => bs.filter((b) => {
    const r = b.getBoundingClientRect();
    return r.left < 0 || r.top < 0 || r.right > innerWidth || r.bottom > innerHeight;
  }).length);
  assert.equal(off, 0, "every tray button is on screen");
}

/** Opens the logo menu and clicks (or taps) the row typing `command`. */
async function menuRow(app: AppContext, command: string, touch = false): Promise<void> {
  if (touch) await app.page.tap("#logo"); else await app.page.click("#logo");
  const row = `#appmenu [data-command='${command}']`;
  await app.page.waitForSelector(row);
  if (touch) await app.page.tap(row); else await app.page.click(row);
}

/**
 * The file input's door, which an iPhone has and nothing else (no
 * `showOpenFilePicker` on iOS): these tests answer Playwright's file chooser,
 * which is the input's. Desktop Chromium and Android's Chrome take the picker
 * first (docs/plans/android.md); that door is android.e2e.ts's, stubbed.
 */
const INPUT_ONLY = { fn: () => { delete (window as unknown as Record<string, unknown>).showOpenFilePicker; } };

/** Add workbench… from the logo menu, the device's picker answered with `file`. */
async function pick(app: AppContext, name: string, text: string, touch = false): Promise<void> {
  const [chooser] = await Promise.all([app.page.waitForEvent("filechooser"), menuRow(app, "addWorkbench()", touch)]);
  await chooser.setFiles({ name, mimeType: "text/javascript", buffer: Buffer.from(text, "utf8") });
  await app.page.waitForSelector("#wbconsent");
}

async function settled<T>(read: () => Promise<T>, want: (t: T) => boolean, what: string): Promise<T> {
  const deadline = Date.now() + 8000;
  for (;;) {
    const v = await read();
    if (want(v)) return v;
    if (Date.now() > deadline) throw new Error(`${what}: still ${JSON.stringify(v)}`);
    await new Promise((r) => setTimeout(r, 100));
  }
}

// ===== a mouse ======================================================================

let app: AppContext;
before(async () => { app = await openApp({ init: INPUT_ONLY }); });
after(async () => {
  assert.deepEqual(app.pageErrors, [], "nothing the page threw went uncaught");
  await app.close();
});

test("the default workbench is part, and its tray is today's, button for button", async () => {
  await fresh(app);
  assert.deepEqual(await tray(app), PART_TRAY);
  assert.equal((await app.repl("workbench()")).value, "part");
});

test("switching to sketch from the logo menu: the tray and the menu change, typed names do not; a drawing made there extrudes in part", async () => {
  await fresh(app);
  await menuRow(app, 'workbench("sketch")');
  assert.deepEqual(await tray(app), SKETCH_TRAY);
  assert.match(await app.page.$eval('.panel[data-panel="organiser"] .ptitle', (e) => e.textContent ?? ""), /organiser\s*· Sketch/);
  // The menu shows the switcher with sketch current.
  await app.page.click("#logo");
  assert.equal(await app.page.$eval("#appmenu [data-workbench='sketch']", (e) => e.getAttribute("aria-current")), "true");
  await shot(app, "sketch-tray-and-menu");
  await app.page.keyboard.press("Escape");
  // Draw in sketch: a rectangle by its tool's own typed form.
  await app.type("arm(\"rectangle\")");
  const [x0, y0] = await app.screenOf([-30, -20, 0]);
  const [x1, y1] = await app.screenOf([30, 20, 0]);
  const a = await app.at(x0, y0), b = await app.at(x1, y1);
  await app.page.mouse.move(a.x, a.y);
  await app.page.mouse.down();
  await app.page.mouse.move(b.x, b.y, { steps: 8 });
  await app.page.mouse.up();
  await app.type('arm("select")');
  const lines = (await app.model()).lines.map((l) => l.name);
  assert.equal(lines.length, 4, "a rectangle was drawn in the sketch workbench");
  // A typed name from any module works in any workbench: extrude is not on this tray.
  const typed = await app.repl("typeof extrude");
  assert.equal(typed.value, "function");
  // Back to part from the menu; extrude there.
  await menuRow(app, 'workbench("part")');
  assert.deepEqual(await tray(app), PART_TRAY);
  await app.type(`extrude("${lines[0]}", 15)`);
  assert.equal((await app.model()).journalOps.includes("extrude"), true, "extruded in part");
  await app.type("orbit(0.5, 0.6)");
  await shot(app, "drawn-in-sketch-extruded-in-part");
});

test("the workbench is the document's: saved in its head, opened back, and no undo step", async () => {
  await fresh(app);
  await app.type('workbench("sketch")');
  await app.type("pt(1, 2)");
  const text = (await app.repl("save()")).value as string;
  assert.equal(JSON.parse(text).workbench, "sketch");
  assert.equal(JSON.parse(text).version, 18);
  await app.type('workbench("part")');
  await app.type("undo()");
  assert.equal((await app.repl("workbench()")).value, "part", "undo does not switch workbench back");
  await app.repl(`open(${JSON.stringify(JSON.stringify(JSON.parse(text)))})`);
  assert.equal((await app.repl("workbench()")).value, "sketch", "opened in the workbench it was saved in");
  assert.deepEqual(await tray(app), SKETCH_TRAY);
});

test("Add workbench…: the manifest shown before anything runs, accepted, its tools on its tray, kept across a reload, shared back byte for byte, removed", async () => {
  await fresh(app);
  await pick(app, "pins.zerocad.js", PINS);
  const asked = await app.page.$eval("#wbconsent", (e) => e.textContent ?? "");
  for (const word of ["Add workbench Pins?", "pins.zerocad.js", "tools: pin", "relations: level", "entity kinds: pin", "not a sandbox"]) {
    assert.ok(asked.includes(word), `the question says ${word}: ${asked}`);
  }
  assert.equal((await app.repl("\"addPin\" in globalThis")).value, false, "nothing has run while it asks");
  await shot(app, "consent");
  await app.page.click("#wbconsent .wbyes");
  await settled(() => app.log(), (l) => l.includes("added workbench pins"), "the log says it was added");
  // Its tools are on its own tray, not on part's.
  assert.deepEqual(await tray(app), PART_TRAY);
  await menuRow(app, 'workbench("pins")');
  assert.deepEqual(await tray(app), [...SKETCH_TRAY, "pin"]);
  // Drawn with its tool: a pin, picked by its cross.
  await app.type('arm("pin")');
  const [px, py] = await app.screenOf([20, 10, 0]);
  const at = await app.at(px, py);
  await app.page.mouse.click(at.x, at.y);
  await settled(async () => (await app.model()).byKind.pin ?? 0, (n) => n === 1, "a pin was dropped");
  await app.type('arm("select")');
  const arm = await app.at(px + 4 * (await app.model()).view.scale, py);
  await app.page.mouse.move(arm.x, arm.y);
  await settled(() => app.repl("hover()").then((r) => r.value), (v) => v === "pin1", "the pin is picked by its arm");
  await shot(app, "a-pin-dropped-in-the-pins-workbench");
  const doc = (await app.repl("save()")).value as string;
  assert.deepEqual(JSON.parse(doc).modules.map((m: { name: string }) => m.name), ["pins"], "the document records the module it needs");

  // Kept on the device: there after a reload, without being asked again.
  await app.page.reload({ waitUntil: "networkidle" });
  await app.page.waitForFunction(() => document.getElementById("status")?.textContent?.includes("ready"), null, { timeout: 20_000 });
  assert.equal(await app.page.$("#wbconsent"), null, "not asked again");
  assert.equal((await app.repl("\"addPin\" in globalThis")).value, true, "loaded at start");
  await app.page.click("#logo");
  assert.ok(await app.page.$("#appmenu [data-workbench='pins']"), "listed under the built-in workbenches");
  await app.page.keyboard.press("Escape");

  // Share hands the file back, byte for byte.
  const [download] = await Promise.all([app.page.waitForEvent("download"), menuRow(app, 'shareWorkbench("pins")')]);
  const path = await download.path();
  assert.equal(readFileSync(path!, "utf8"), PINS, "the very bytes that were added");
  assert.equal(download.suggestedFilename(), "pins.zerocad.js");

  // Remove takes it away: off the menu and the tray, and gone at the next start.
  await menuRow(app, 'removeWorkbench("pins")');
  await settled(() => app.log(), (l) => l.includes("removed workbench pins"), "the log says it was removed");
  await app.page.click("#logo");
  assert.equal(await app.page.$("#appmenu [data-workbench='pins']"), null);
  await app.page.keyboard.press("Escape");
  assert.equal((await tray(app)).includes("pin"), false);
  await app.page.reload({ waitUntil: "networkidle" });
  await app.page.waitForFunction(() => document.getElementById("status")?.textContent?.includes("ready"), null, { timeout: 20_000 });
  assert.equal((await app.repl("\"addPin\" in globalThis")).value, false, "not loaded at the next start");
});

test("a workbench file whose manifest and source disagree is refused, says what was not shown, and registers nothing", async () => {
  await fresh(app);
  await pick(app, "liar.zerocad.js", LIAR);
  await app.page.click("#wbconsent .wbyes");
  const log = await settled(() => app.log(), (l) => l.includes("liar.zerocad.js refused"), "the refusal is said");
  assert.match(log, /registers relations its manifest does not show: sneak/);
  assert.equal((await app.repl("\"sneak\" in globalThis")).value, false);
  assert.equal((await tray(app)).includes("dot"), false);
  await shot(app, "a-lying-manifest-refused");
});

test("a module pasted at the command line: its tool has a button on every tray, and modules() lists it", async () => {
  await fresh(app);
  await app.type('defineModule("stamps", { tools: { stamp: class extends Tool { static summary = "Stamps a point"; name = "stamp"; onUp(p) { pt(...p.world); this.ctx.requestSolve(); this.ctx.finish(); } } } })');
  assert.deepEqual(await tray(app), [...PART_TRAY, "stamp"]);
  await app.type('workbench("sketch")');
  assert.deepEqual(await tray(app), [...SKETCH_TRAY, "stamp"]);
  const listed = (await app.repl("modules()")).value as string[];
  assert.ok(listed.some((l) => /^stamps\s+tools stamp\s+\(typed\)/.test(l)), listed.join("\n"));
  await trayFits(app);
});

test("a document that needs a workbench opens on a fresh profile with the offer, and the rest of the drawing intact", async () => {
  // Made with pins added …
  await fresh(app);
  await pick(app, "pins.zerocad.js", PINS);
  await app.page.click("#wbconsent .wbyes");
  await settled(() => app.repl("\"addPin\" in globalThis").then((r) => r.value), (v) => v === true, "added");
  await app.type("a = pt(0, 0, 0)");
  await app.type("b = pt(40, 9, 0)");
  await app.type('fix(a, [0, 0, 0])');
  await app.type("level(a, b)");
  await app.type("addPin(b)");
  const doc = JSON.stringify(JSON.parse((await app.repl("save()")).value as string));
  await menuRow(app, 'removeWorkbench("pins")');
  await settled(() => app.log(), (l) => l.includes("removed workbench pins"), "removed");

  // … opened by someone who has never added it.
  const other = await openApp({ init: INPUT_ONLY });
  try {
    await other.type(`open(${JSON.stringify(doc)})`);
    await other.page.waitForSelector("#wbmissing");
    assert.match(await other.page.$eval("#wbmissing", (e) => e.textContent ?? ""), /needs workbench pins/);
    assert.match(await other.log(), /this file needs workbench "pins"/);
    const m = await other.model();
    assert.equal(m.byKind.point, 2, "the two points are there");
    assert.equal(m.byKind.pin ?? 0, 0, "the pin is not");
    assert.ok(Math.abs(m.points.p2[1]) < 1e-6, "where they were saved");
    await shot(other, "the-missing-workbench-offer");
    // The offer opens the picker; added, the drawing opens whole.
    const [chooser] = await Promise.all([other.page.waitForEvent("filechooser"), other.page.click("#wbmissing .wbyes")]);
    await chooser.setFiles({ name: "pins.zerocad.js", mimeType: "text/javascript", buffer: Buffer.from(PINS, "utf8") });
    await other.page.click("#wbconsent .wbyes");
    await settled(async () => (await other.model()).byKind.pin ?? 0, (n) => n === 1, "the pin comes back");
    assert.deepEqual(other.pageErrors, []);
  } finally {
    await other.close();
  }
});

// ===== a finger, iPhone 13 ===========================================================

let phone: AppContext;
before(async () => { phone = await openApp({ device: "iPhone 13", init: INPUT_ONLY }); });
after(async () => {
  assert.deepEqual(phone.pageErrors, [], "nothing the page threw went uncaught");
  await phone.close();
});

test("iPhone 13: switch workbench from the logo menu by touch; everything fits on each tray", async () => {
  await fresh(phone);
  assert.deepEqual(await tray(phone), PART_TRAY);
  await trayFits(phone);
  await menuRow(phone, 'workbench("sketch")', true);
  assert.deepEqual(await tray(phone), SKETCH_TRAY);
  await trayFits(phone);
  await shot(phone, "phone-sketch-tray");
  await menuRow(phone, 'workbench("part")', true);
  assert.deepEqual(await tray(phone), PART_TRAY);
});

test("iPhone 13: Add workbench… by touch — the question, a tap on Add, its tray, a pin tapped down; and a lying file refused", async () => {
  await fresh(phone);
  await pick(phone, "pins.zerocad.js", PINS, true);
  await shot(phone, "phone-consent");
  // The question fits the phone and its buttons are a finger's.
  const box = await phone.page.$eval("#wbconsent", (e) => { const r = e.getBoundingClientRect(); return [r.left, r.right, innerWidth]; });
  assert.ok(box[0] >= 0 && box[1] <= box[2], `the question is on screen: ${box}`);
  const h = await phone.page.$eval("#wbconsent .wbyes", (e) => e.getBoundingClientRect().height);
  assert.ok(h >= 44, `Add is a finger's target: ${h}`);
  await phone.page.tap("#wbconsent .wbyes");
  await settled(() => phone.log(), (l) => l.includes("added workbench pins"), "added");
  await menuRow(phone, 'workbench("pins")', true);
  assert.deepEqual(await tray(phone), [...SKETCH_TRAY, "pin"]);
  await trayFits(phone);
  await phone.page.tap("#toolbar > button[data-tool='pin']");
  const f = await fingers(phone);
  const [x, y] = await phone.screenOf([0, -20, 0]);
  await phone.at(x, y);
  await f.tap(x, y);
  await settled(async () => (await phone.model()).byKind.pin ?? 0, (n) => n === 1, "a pin tapped down");
  await shot(phone, "phone-a-pin-tapped");
  await menuRow(phone, 'removeWorkbench("pins")', true);
  await settled(() => phone.log(), (l) => l.includes("removed workbench pins"), "removed");

  await pick(phone, "liar.zerocad.js", LIAR, true);
  await phone.page.tap("#wbconsent .wbyes");
  await settled(() => phone.log(), (l) => l.includes("liar.zerocad.js refused"), "refused");
});
