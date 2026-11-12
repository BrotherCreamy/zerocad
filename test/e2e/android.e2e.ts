// Android (docs/plans/android.md; the owner: *"obv this whole platform should
// also work on android"*), in Chromium — which on Android *is* the browser:
// the same engine and input pipeline, so what is emulated here is the device
// around it (its screen, its insets, its keyboard, its back gesture), not the
// browser. Playwright's Pixel 7 descriptor (and the Galaxy S24's, under
// Samsung Internet's user agent), with the Android rows of test/devices.ts
// for the window and the insets (CDP's `Emulation.setSafeAreaInsetsOverride`).
//
// What only a device can show is said where it is assumed: the back gesture
// is driven as the browser's own Back (CDP's history navigation, which is
// what the system's gesture becomes in Chrome); the keyboard is a stand-in
// `visualViewport` shrunk the way Chrome shrinks it, since no keyboard comes
// up in emulation; the system font scale is Blink's own setting for it,
// passed as a flag. Set NEOCAD_E2E_SHOTS to a directory to keep pictures.

import { test, before, after } from "node:test";
import assert from "node:assert/strict";
import { mkdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import type { CDPSession } from "playwright";
import { axisFrame, forgetAutosave, openApp, PARKED, timedCdp, type AppContext } from "./harness.ts";
import { fingers, type Fingers } from "./fingers.ts";
import { ANDROIDS, androidWindowOf, type AndroidMode, type Turn } from "../devices.ts";

const SHOTS = process.env.NEOCAD_E2E_SHOTS;
const PIXEL7 = ANDROIDS.find((d) => d.descriptor === "Pixel 7")!;
const PINS = readFileSync(new URL("../fixtures/workbenches/pins.zerocad.js", import.meta.url), "utf8");
const BRACKET = readFileSync(new URL("../fixtures/bracket.zerocad.json", import.meta.url), "utf8");
/** Samsung Internet 28 on a Galaxy S24, as it sends itself (its Chromium 130 underneath). */
const SAMSUNG_UA = "Mozilla/5.0 (Linux; Android 14; SM-S921B) AppleWebKit/537.36 (KHTML, like Gecko) SamsungBrowser/28.0 Chrome/130.0.0.0 Mobile Safari/537.36";

async function shot(app: AppContext, name: string): Promise<void> {
  if (!SHOTS) return;
  mkdirSync(SHOTS, { recursive: true });
  await app.page.waitForTimeout(150);
  await app.page.screenshot({ path: join(SHOTS, `android-${name}.png`) });
}

/**
 * What the page's platform is, set before each load from `sessionStorage`
 * (which survives the reloads, and the tests' `localStorage.clear`): the file
 * pickers — Chrome on Android's since 132, stubbed (`stub`), refusing a save as
 * Android's has been reported to (`refuse`), or absent (`none`); the share sheet
 * as Chrome on Android has it (`canShare` yes to any file, `share` refusing a
 * `.json` with NotAllowedError — its permitted list, ShareServiceImpl.java, has
 * no json); and, with `vv`, a stand-in visual viewport for the keyboard.
 */
function platform(): void {
  const w = window as unknown as Record<string, unknown>;
  const cfg = JSON.parse(sessionStorage.getItem("e2e.android") ?? "{}") as { pickers?: string; vv?: boolean };
  const rec = { savePicks: 0, writes: [] as { name: string; text: string }[], shares: [] as string[], opened: { name: "opened.zerocad.json", text: "" } };
  w.__rec = rec;
  const handle = (name: string, text: () => string) => ({
    kind: "file", name,
    async getFile() { return new File([text()], name, { type: name.endsWith(".js") ? "text/javascript" : "application/json" }); },
    async createWritable() {
      let t = "";
      return { async write(s: string) { t += s; }, async close() { rec.writes.push({ name, text: t }); } };
    },
  });
  if (cfg.pickers === "none") {
    delete w.showOpenFilePicker;
    delete w.showSaveFilePicker;
  } else {
    w.showOpenFilePicker = async () => [handle(rec.opened.name, () => rec.opened.text)];
    w.showSaveFilePicker = async (o: { suggestedName?: string }) => {
      rec.savePicks++;
      if (cfg.pickers === "refuse") throw new DOMException("The request is not allowed", "NotAllowedError");
      return handle(o?.suggestedName ?? "picked.zerocad.json", () => "");
    };
  }
  Object.defineProperty(navigator, "canShare", { configurable: true, value: () => true });
  Object.defineProperty(navigator, "share", {
    configurable: true,
    value: async (d: { files: File[] }) => {
      rec.shares.push(d.files.map((f) => f.name).join());
      throw new DOMException("Permission denied", "NotAllowedError");
    },
  });
  if (cfg.vv) {
    // What Chrome's keyboard does to the page: the visual viewport shorter, the layout one not.
    const fake = new EventTarget() as EventTarget & Record<string, number>;
    Object.assign(fake, { offsetLeft: 0, offsetTop: 0, pageLeft: 0, pageTop: 0, scale: 1, width: innerWidth, height: innerHeight });
    Object.defineProperty(window, "visualViewport", { configurable: true, get: () => fake });
    w.__vv = fake;
  }
}

let app: AppContext;
let cdp: CDPSession;
let f: Fingers;
before(async () => {
  app = await openApp({ device: "Pixel 7", init: { fn: platform } });
  cdp = timedCdp(await app.page.context().newCDPSession(app.page));
});
after(async () => { await app.close(); });

/** A first start on the Pixel 7 held `turn`, shown `mode`, on `platform`'s settings, with a rectangle round the middle. */
async function fresh(turn: Turn = "portrait", mode: AndroidMode = "installed", cfg: { pickers?: string; vv?: boolean } = {}): Promise<void> {
  const win = androidWindowOf(PIXEL7, turn, mode);
  await app.page.setViewportSize({ width: win.w, height: win.h });
  await cdp.send("Emulation.setSafeAreaInsetsOverride", { insets: win.insets });
  await app.page.evaluate((c) => { localStorage.clear(); sessionStorage.setItem("e2e.android", JSON.stringify(c)); }, cfg);
  await forgetAutosave(app.page);
  await app.page.reload({ waitUntil: "networkidle" });
  await app.page.waitForFunction(() => document.getElementById("status")?.textContent?.includes("ready"), null, { timeout: 20_000 });
  await cdp.send("Emulation.setSafeAreaInsetsOverride", { insets: win.insets });
  await app.page.waitForTimeout(100);
  // The page reports the cutout and the bar it was given — what every picture here rests on.
  const reported = await app.page.evaluate(() => {
    const p = getComputedStyle(document.getElementById("safeprobe")!);
    return { top: parseFloat(p.paddingTop), right: parseFloat(p.paddingRight), bottom: parseFloat(p.paddingBottom), left: parseFloat(p.paddingLeft) };
  });
  assert.deepEqual(reported, win.insets, `${turn} ${mode}: the insets in force`);
  await axisFrame(app, PARKED);
  await app.type("pt(-25,-15); pt(25,-15); pt(25,15); pt(-25,15)");
  await app.type('ln("p1","p2"); ln("p2","p3"); ln("p3","p4"); ln("p4","p1")');
  await app.page.evaluate(() => (document.activeElement as HTMLElement | null)?.blur());
  f = await fingers(app);
}

/** Where a world point is on the canvas, a fingertip clear of every panel. */
async function onCanvas(world: number[]): Promise<[number, number]> {
  const [x, y] = await app.screenOf(world);
  for (const [dx, dy] of [[0, 0], [-12, 0], [12, 0], [0, -12], [0, 12]]) await app.at(x + dx, y + dy);
  return [x, y];
}

const middleOf = (selector: string) => app.page.$eval(selector, (el) => {
  const r = el.getBoundingClientRect();
  return [r.x + r.width / 2, r.y + r.height / 2] as [number, number];
});

async function until<T>(read: () => Promise<T>, want: (t: T) => boolean, what: string): Promise<T> {
  const deadline = Date.now() + 6000;
  for (;;) {
    const v = await read();
    if (want(v)) return v;
    if (Date.now() > deadline) assert.fail(`${what}: still ${JSON.stringify(v)}`);
    await app.page.waitForTimeout(60);
  }
}

/** The next `confirm` answered yes; settles with its question. */
const answerYes = () => new Promise<string>((resolve) => {
  app.page.once("dialog", (d) => { resolve(d.message()); void d.accept(); });
});

const shown = (id: string) => app.page.evaluate((i) => { const el = document.getElementById(i); return !!el && !el.hidden; }, id);

/** The logo tapped open, and a row of its menu tapped. */
async function menuRow(command: string): Promise<void> {
  await f.tap(...await middleOf("#logo"));
  await until(() => shown("appmenu"), Boolean, "the menu opened");
  await f.tap(...await middleOf(`#appmenu [data-command='${command}']`));
}

/**
 * **Android's back**, as the browser receives it: the system's gesture (or
 * the bar's ◁) is Chrome's Back, which goes one entry back in the session
 * history. Returns false where there is none to go back to — where Chrome
 * would close the app or leave the page.
 */
async function back(): Promise<boolean> {
  const h = await cdp.send("Page.getNavigationHistory");
  if (h.currentIndex === 0) return false;
  await cdp.send("Page.navigateToHistoryEntry", { entryId: h.entries[h.currentIndex - 1].id });
  await app.page.waitForTimeout(150);
  return true;
}

// ---- touch: nothing new in the recogniser ------------------------------------------

for (const turn of ["portrait", "landscape"] as const) {
  test(`Pixel 7, ${turn}: a tap selects, a drag draws a rectangle, a long-press opens the menu, a pinch zooms the drawing and never the page`, async () => {
    await fresh(turn);
    // A tap on the rectangle's top side selects it.
    await f.tap(...await onCanvas([0, 15, 0]));
    await until(() => app.selection(), (s) => s.length === 1, "the tap selected the side");
    // The rectangle tool from the tray, and a drag draws one: four corners, four sides.
    await f.tap(...await middleOf('#toolbar button[data-tool="rectangle"]'));
    await until(() => app.model(), (m) => m.activeTool === "rectangle", "the button armed the rectangle");
    const size = (await app.model()).size;
    const [ax, ay] = await onCanvas([-40, -30, 0]);
    const [bx, by] = await onCanvas([-32, -22, 0]);
    await f.down([ax, ay]);
    await f.glide(6, [bx, by]);
    await app.page.waitForTimeout(120);
    await f.move([bx, by]);
    await app.page.waitForTimeout(120);
    await f.up();
    await until(() => app.model(), (m) => m.size === size + 8, "the drag drew a rectangle");
    await shot(app, `touch-${turn}`);
    await app.type('arm("select")');
    await app.page.evaluate(() => (document.activeElement as HTMLElement | null)?.blur());
    // A long-press on a corner: the menu, at the finger, for what it landed on.
    await f.hold(...await onCanvas([25, 15, 0]), 700);
    await until(() => shown("ctxmenu"), Boolean, "the long-press opened the menu");
    await app.page.keyboard.press("Escape");
    // Two fingers spread over the drawing: the view zooms, the page does not.
    const before = (await app.model()).view.scale;
    const [cx, cy] = await onCanvas([0, 0, 0]);
    await f.down([cx - 30, cy], [cx + 30, cy]);
    await f.glide(8, [cx - 60, cy], [cx + 60, cy]);
    await f.up();
    const after = (await app.model()).view.scale;
    assert.ok(Math.abs(after / before - 2) < 0.05, `the drawing zoomed ×2: ${after / before}`);
    assert.equal(await app.page.evaluate(() => window.visualViewport?.scale ?? 1), 1, "the page's own zoom is untouched");
    assert.deepEqual(app.pageErrors, []);
  });
}

test("the touch checks: a long-press raises no browser menu or selection on the canvas or the chrome; the command line and log stay selectable; a pinch over the chrome zooms nothing", async () => {
  await fresh();
  // Chrome on Android raises `contextmenu` for a long-press: the canvas's and
  // the chrome's are cancelled, so its own menu never comes. Seen here in
  // emulation as it is sent, and asked of each surface directly too.
  await app.page.evaluate(() => {
    (window as unknown as { __ctx: boolean[] }).__ctx = [];
    window.addEventListener("contextmenu", (e) => (window as unknown as { __ctx: boolean[] }).__ctx.push(e.defaultPrevented));
  });
  await f.hold(...await onCanvas([0, 0, 0]), 700);
  await app.page.keyboard.press("Escape");
  const sent = await app.page.evaluate(() => (window as unknown as { __ctx: boolean[] }).__ctx);
  assert.ok(sent.every(Boolean), `every contextmenu the long-press raised was cancelled: ${JSON.stringify(sent)}`);
  const cancelled = await app.page.evaluate(() => ["#cv", "#logo", "#toolbar", '.panel[data-panel="organiser"] .ptitle', "#appmenu"].map((sel) => {
    const el = document.querySelector(sel)!;
    const e = new MouseEvent("contextmenu", { bubbles: true, cancelable: true });
    el.dispatchEvent(e);
    return [sel, e.defaultPrevented];
  }));
  for (const [sel, prevented] of cancelled) assert.equal(prevented, true, `${sel}: no browser menu`);
  // Nothing selects on a long-press but where there is text to take.
  const select = await app.page.evaluate(() => Object.fromEntries(["#cv", "#toolbar", "#logo", "#organiser", "#cmd", "#log"].map((sel) =>
    [sel, getComputedStyle(document.querySelector(sel)!).userSelect])));
  assert.deepEqual(select, { "#cv": "none", "#toolbar": "none", "#logo": "none", "#organiser": "none", "#cmd": "text", "#log": "text" });
  assert.equal(await app.page.$eval("#cv", (el) => getComputedStyle(el).touchAction), "none", "the canvas takes every touch");
  assert.equal(await app.page.evaluate(() => getComputedStyle(document.documentElement).touchAction), "manipulation", "the chrome: no double-tap zoom");
  // A pinch over the log — chrome, where a touch may pan — leaves the page unzoomed.
  const [lx, ly] = await middleOf('.panel[data-panel="log"]');
  await f.down([lx - 20, ly], [lx + 20, ly]);
  await f.glide(6, [lx - 70, ly], [lx + 70, ly]);
  await f.up();
  assert.equal(await app.page.evaluate(() => window.visualViewport?.scale ?? 1), 1);
  assert.deepEqual([await app.page.evaluate(() => scrollX), await app.page.evaluate(() => scrollY)], [0, 0]);
});

// ---- back ---------------------------------------------------------------------------

test("back closes a flyout, then the menu, then nothing — never leaving the app nor reloading it — and the context menu and a dialog too", async () => {
  await fresh();
  await app.page.evaluate(() => { (window as unknown as { __alive: number }).__alive = 1; });
  const url = app.page.url();
  // A first tap anywhere puts the guard up.
  await f.tap(...await onCanvas([55, -40, 0]));
  // A group's flyout, by a long-press on its button.
  await f.hold(...await middleOf('#toolbar button[data-group="shapes"]'), 700);
  await until(() => shown("flyout"), Boolean, "the long-press opened the shapes flyout");
  assert.ok(await back());
  await until(() => shown("flyout"), (s) => !s, "back closed the flyout");
  await shot(app, "back-flyout-closed");
  // The logo's menu.
  await f.tap(...await middleOf("#logo"));
  await until(() => shown("appmenu"), Boolean, "the logo opened its menu");
  assert.ok(await back());
  await until(() => shown("appmenu"), (s) => !s, "back closed the menu");
  // Then nothing: still the app, the same page, nothing reloaded — and again.
  for (let i = 0; i < 2; i++) {
    assert.ok(await back(), "there was an entry to go back from: the guard");
    assert.equal(app.page.url(), url);
    assert.equal(await app.page.evaluate(() => (window as unknown as { __alive?: number }).__alive), 1, "not reloaded");
    assert.equal(await app.page.evaluate(() => (history.state as { zerocad?: string } | null)?.zerocad), "guard", "the guard is back up");
  }
  // The context menu, by a long-press on the canvas.
  await f.hold(...await onCanvas([55, -40, 0]), 700);
  await until(() => shown("ctxmenu"), Boolean, "the context menu opened");
  assert.ok(await back());
  await until(() => shown("ctxmenu"), (s) => !s, "back closed the context menu");
  // A dialog: Add workbench…'s question, answered Cancel by the back.
  await app.page.evaluate((text) => { (window as unknown as { __rec: { opened: { name: string; text: string } } }).__rec.opened = { name: "pins.zerocad.js", text }; }, PINS);
  await menuRow("addWorkbench()");
  await until(() => app.page.evaluate(() => !!document.getElementById("wbconsent")), Boolean, "the question");
  assert.ok(await back());
  await until(() => app.page.evaluate(() => !document.getElementById("wbconsent")), Boolean, "back closed the question");
  assert.match(await app.log(), /pins\.zerocad\.js: not added/);
  assert.match(await app.log(), /back: flyout closed[\s\S]*back: menu closed[\s\S]*back: question closed/);
  assert.equal(await app.page.evaluate(() => (window as unknown as { __alive?: number }).__alive), 1);
  assert.deepEqual(app.pageErrors, []);
});

test("back's bookkeeping leaves nothing behind: a menu opened and closed by a tap outside five times, the history where it was", async () => {
  await fresh();
  await f.tap(...await onCanvas([55, -40, 0]));
  const at = async () => (await cdp.send("Page.getNavigationHistory")).currentIndex;
  const start = await at();
  for (let i = 0; i < 5; i++) {
    await f.tap(...await middleOf("#logo"));
    await until(() => shown("appmenu"), Boolean, "opened");
    await f.tap(...await onCanvas([55, -40, 0]));
    await until(() => shown("appmenu"), (s) => !s, "a tap outside closed it");
    await app.page.waitForTimeout(100);
  }
  assert.equal(await at(), start, "the entry each opening pushed came off again");
  assert.equal(await app.page.evaluate(() => (history.state as { zerocad?: string } | null)?.zerocad), "guard");
});

// ---- install -------------------------------------------------------------------------

test("Install app: offered in the logo menu once the browser's beforeinstallprompt comes, the browser's own sheet asked for by a tap, gone once installed", async () => {
  await fresh();
  await f.tap(...await middleOf("#logo"));
  await until(() => shown("appmenu"), Boolean, "opened");
  assert.equal(await app.page.$("#appmenu [data-section='App']"), null, "no offer before the browser makes one (the dev server has no worker)");
  await f.tap(...await onCanvas([55, -40, 0]));
  // The event, as Chrome sends it once the hosted app has its manifest and worker.
  await app.page.evaluate(() => {
    const e = new Event("beforeinstallprompt", { cancelable: true }) as Event & Record<string, unknown>;
    const w = window as unknown as { __install: { prompted: number; prevented?: boolean } };
    w.__install = { prompted: 0 };
    e.prompt = async () => { w.__install.prompted++; };
    e.userChoice = Promise.resolve({ outcome: "accepted", platform: "web" });
    window.dispatchEvent(e);
    w.__install.prevented = e.defaultPrevented;
  });
  assert.equal(await app.page.evaluate(() => (window as unknown as { __install: { prevented: boolean } }).__install.prevented), true,
    "kept: Chrome's own mini-infobar is not shown over the drawing");
  await f.tap(...await middleOf("#logo"));
  await until(() => shown("appmenu"), Boolean, "opened");
  await shot(app, "install-menu");
  await f.tap(...await middleOf("#appmenu [data-command='installApp()']"));
  await until(() => app.page.evaluate(() => (window as unknown as { __install: { prompted: number } }).__install.prompted), (n) => n === 1, "the sheet was asked for");
  await until(() => app.log(), (l) => /> installApp\(\)[\s\S]*installing ZeroCAD/.test(l), "typed, and said");
  await app.page.evaluate(() => window.dispatchEvent(new Event("appinstalled")));
  await f.tap(...await middleOf("#logo"));
  await until(() => shown("appmenu"), Boolean, "opened");
  assert.equal(await app.page.$("#appmenu [data-section='App']"), null, "installed: nothing to offer");
  await app.page.keyboard.press("Escape");
});

// ---- files ---------------------------------------------------------------------------

test("files on Android: open by the picker, save by the picker, a refusing picker downloads, the share sheet's refusal of a .json downloads — each saying what it did", async () => {
  await fresh("portrait", "installed", { pickers: "stub" });
  await app.page.evaluate((text) => { (window as unknown as { __rec: { opened: { name: string; text: string } } }).__rec.opened = { name: "bracket.zerocad.json", text }; }, BRACKET);
  // The rectangle is unsaved: the open asks first (files.md), and is answered yes.
  const asked = answerYes();
  await menuRow("openFile()");
  await until(() => app.log(), (l) => /choose a file… \(the file picker\)[\s\S]*opened bracket\.zerocad\.json/.test(l), "opened by the picker");
  assert.match(await asked, /Open bracket\.zerocad\.json\? The unsaved changes/);
  // Save: back into the file it came from (the open picker's handle).
  await menuRow("saveFile()");
  await until(() => app.log(), (l) => /saved bracket\.zerocad\.json/.test(l), "saved in place");
  const writes = await app.page.evaluate(() => (window as unknown as { __rec: { writes: { name: string; text: string }[] } }).__rec.writes);
  assert.equal(writes.length, 1);
  assert.match(writes[0].text, /"format": "neocad-model"/);
  // Share: Chrome on Android says yes to canShare and refuses the .json; it downloads instead.
  const [download] = await Promise.all([app.page.waitForEvent("download"), menuRow("shareFile()")]);
  assert.equal(download.suggestedFilename(), "bracket.zerocad.json");
  await until(() => app.log(), (l) => /the share sheet would not take the file \(Permission denied\) — downloading it instead/.test(l), "said why");
  // A new document, whose save picker refuses as Android's has been reported to: a download, and why.
  await fresh("portrait", "installed", { pickers: "refuse" });
  const [refused] = await Promise.all([app.page.waitForEvent("download"), menuRow("saveFile()")]);
  assert.equal(refused.suggestedFilename(), "Untitled.zerocad.json");
  await until(() => app.log(), (l) => /downloaded Untitled\.zerocad\.json — the save picker refused \(The request is not allowed\)/.test(l), "said why");
});

test("files on Android before Chrome 132: no pickers — open is the system's file chooser, save a download, and each says so", async () => {
  await fresh("portrait", "installed", { pickers: "none" });
  const asked = answerYes();
  const [chooser] = await Promise.all([app.page.waitForEvent("filechooser"), menuRow("openFile()")]);
  await chooser.setFiles({ name: "bracket.zerocad.json", mimeType: "application/json", buffer: Buffer.from(BRACKET) });
  await asked;
  await until(() => app.log(), (l) => /choose a file… \(the browser's file chooser\)[\s\S]*opened bracket\.zerocad\.json/.test(l), "opened by the input");
  const [download] = await Promise.all([app.page.waitForEvent("download"), menuRow("saveFile()")]);
  assert.equal(download.suggestedFilename(), "bracket.zerocad.json");
  // Under a finger the share sheet is tried first; Chrome refuses the .json, so it is a download.
  await until(() => app.log(), (l) => /downloaded bracket\.zerocad\.json/.test(l), "said");
});

test("a workbench file the Android way: Add workbench… by the picker where it exists, by the file chooser where not — its manifest asked about before anything runs", async () => {
  await fresh("portrait", "installed", { pickers: "stub" });
  await app.page.evaluate((text) => { (window as unknown as { __rec: { opened: { name: string; text: string } } }).__rec.opened = { name: "pins.zerocad.js", text }; }, PINS);
  await menuRow("addWorkbench()");
  await until(() => app.page.evaluate(() => !!document.getElementById("wbconsent")), Boolean, "the question, from the picker");
  assert.match(await app.log(), /choose a workbench file \(\.zerocad\.js\) — the file picker/);
  await shot(app, "workbench-question");
  await f.tap(...await middleOf("#wbconsent button"));
  await fresh("portrait", "installed", { pickers: "none" });
  const [chooser] = await Promise.all([app.page.waitForEvent("filechooser"), menuRow("addWorkbench()")]);
  await chooser.setFiles({ name: "pins.zerocad.js", mimeType: "text/javascript", buffer: Buffer.from(PINS) });
  await until(() => app.page.evaluate(() => !!document.getElementById("wbconsent")), Boolean, "the question, from the input");
  assert.match(await app.log(), /the browser's file chooser/);
  await f.tap(...await middleOf("#wbconsent button"));
});

// ---- the keyboard ----------------------------------------------------------------------

test("the keyboard up: the command line rides above it, over no other pane, the drawing does not shrink — and goes back down after", async () => {
  await fresh("portrait", "installed", { vv: true });
  const canvas = () => app.page.$eval("#cv", (el) => [el.clientWidth, el.clientHeight]);
  const before = await canvas();
  const home = await app.page.$eval('.panel[data-panel="cmd"]', (el) => el.getBoundingClientRect().toJSON());
  await f.tap(...await middleOf("#cmd"));
  assert.equal(await app.page.evaluate(() => document.activeElement?.id), "cmd", "a tap on the line focuses it");
  // The keyboard: the visual viewport shrunk to what a Pixel 7's leaves, the page not.
  const kbTop = 480;
  await app.page.evaluate((h) => { const vv = (window as unknown as { __vv: EventTarget & { height: number } }).__vv; vv.height = h; vv.dispatchEvent(new Event("resize")); }, kbTop);
  await app.page.waitForTimeout(100);
  const up = await app.page.evaluate(() => {
    const box = (el: Element) => { const r = el.getBoundingClientRect(); return { x: r.x, y: r.y, w: r.width, h: r.height }; };
    const cmd = document.querySelector('.panel[data-panel="cmd"]')!;
    const others = Array.from(document.querySelectorAll<HTMLElement>(".panel[data-panel]")).filter((el) => el !== cmd && !el.hidden).map((el) => [el.dataset.panel, box(el)]);
    return { cmd: box(cmd), others };
  });
  assert.ok(Math.abs(up.cmd.y + up.cmd.h - kbTop) < 1, `its bottom on the keyboard's top: ${JSON.stringify(up.cmd)}`);
  for (const [id, r] of up.others as [string, { x: number; y: number; w: number; h: number }][]) {
    const over = r.x < up.cmd.x + up.cmd.w - 0.5 && up.cmd.x < r.x + r.w - 0.5 && r.y < up.cmd.y + up.cmd.h - 0.5 && up.cmd.y < r.y + r.h - 0.5;
    assert.ok(!over, `over ${id}: ${JSON.stringify({ cmd: up.cmd, r })}`);
  }
  assert.ok(up.cmd.w >= 160, "wide enough to type in");
  assert.deepEqual(await canvas(), before, "the drawing kept its size");
  await shot(app, "keyboard-up");
  // Typing works in it, and the keyboard going puts it back.
  await app.page.keyboard.type("1+1");
  await app.page.evaluate(() => { const vv = (window as unknown as { __vv: EventTarget & { height: number } }).__vv; vv.height = innerHeight; vv.dispatchEvent(new Event("resize")); });
  await app.page.waitForTimeout(100);
  const down = await app.page.$eval('.panel[data-panel="cmd"]', (el) => el.getBoundingClientRect().toJSON());
  assert.deepEqual([down.x, down.y, down.width], [home.x, home.y, home.width], "home again");
  assert.equal(await app.page.$eval("#cmd", (el) => (el as HTMLInputElement).value), "1+1");
  // Landscape: the line is in the top row, above any keyboard; nothing moves.
  await fresh("landscape", "installed", { vv: true });
  const top = await app.page.$eval('.panel[data-panel="cmd"]', (el) => el.getBoundingClientRect().toJSON());
  await f.tap(...await middleOf("#cmd"));
  await app.page.evaluate(() => { const vv = (window as unknown as { __vv: EventTarget & { height: number } }).__vv; vv.height = 150; vv.dispatchEvent(new Event("resize")); });
  await app.page.waitForTimeout(100);
  const still = await app.page.$eval('.panel[data-panel="cmd"]', (el) => el.getBoundingClientRect().toJSON());
  assert.deepEqual([still.x, still.y], [top.x, top.y], "left where it was: already above the keyboard");
  assert.deepEqual(app.pageErrors, []);
});

// ---- the app killed in the background ------------------------------------------------

test("the app killed in the background and opened again: the hidden-flush kept the drawing, and it is restored", async () => {
  // Its own app: the page is closed under it, and the suite's helpers hold theirs.
  const own = await openApp({ device: "Pixel 7" });
  try {
    await own.type("pt(40, 40); pt(50, 40)");
    const count = (await own.model()).size;
    // Android hides the app, then kills it: the page hears `visibilitychange`
    // and nothing more. Hidden as Chrome hides it, then the page closed at
    // once, inside autosave's 500 ms quiet — so only the hidden-flush saves it.
    await own.page.evaluate(() => {
      Object.defineProperty(document, "visibilityState", { configurable: true, get: () => "hidden" });
      document.dispatchEvent(new Event("visibilitychange"));
    });
    await own.page.waitForTimeout(100);
    const url = own.page.url();
    const ctx = own.page.context();
    await own.page.close({ runBeforeUnload: false });
    const page = await ctx.newPage();
    await page.goto(url, { waitUntil: "networkidle" });
    await page.waitForFunction(() => document.getElementById("status")?.textContent?.includes("ready"), null, { timeout: 20_000 });
    const size = await page.evaluate(() => (window as unknown as { __neocad: { model: { entities: Map<string, unknown> } } }).__neocad.model.entities.size);
    assert.equal(size, count, "the drawing is back");
    assert.match(await page.$eval("#log", (el) => el.textContent ?? ""), /restored/);
  } finally {
    await own.close();
  }
});

// ---- the scale -----------------------------------------------------------------------

/**
 * What this browser tells a page of the system's font scale, read on the
 * app's own page after the app has read it: `env(preferred-text-scale)` as
 * the page stands (`plain`), the same with `<meta name="text-scale"
 * content="scale">` in the document for the length of the reading (`asked`),
 * `font-size: medium` on a lone probe as the page stands, and whether a meta
 * of that name is in the document (the app's reading must leave none).
 */
const textScaleReadings = (a: AppContext) => a.page.evaluate(() => {
  const probe = document.createElement("span");
  probe.style.cssText = "position:absolute;visibility:hidden;height:0;width:calc(100px * env(preferred-text-scale, 0))";
  document.body.append(probe);
  const read = () => probe.getBoundingClientRect().width / 100;
  const left = document.querySelectorAll('meta[name="text-scale"]').length;
  const plain = read();
  const meta = document.createElement("meta");
  meta.name = "text-scale";
  meta.content = "scale";
  document.head.append(meta);
  const asked = read();
  meta.remove();
  probe.style.cssText = "position:absolute;font-size:medium;text-size-adjust:auto;-webkit-text-size-adjust:auto";
  const medium = getComputedStyle(probe).fontSize;
  probe.remove();
  return { plain, asked, medium, left };
});

test("Android's font scale, measured: Chromium reports env(preferred-text-scale) — 153 only to a page that asks — and the device's 100 % follows it: 1.3 at the default, 1.69 at 130 %, the browser's own font size counted once", async () => {
  const said = async (a: AppContext) => String((await a.repl("ui()")).value);
  assert.match(await said(app), /100% here is 1\.3× a desktop's: a phone 1\.3, text size 1\.00 \(the system's font scale\)/);
  const scaled = await openApp({ device: "Pixel 7", args: ["--blink-settings=accessibilityFontScaleFactor=1.3"] });
  try {
    // **Which page this Chromium tells** (bug 79). 141 told every page; 153
    // tells only one carrying `<meta name="text-scale" content="scale">`,
    // and the app's page, which has none, read 1.00 under a system scale of
    // 1.3 — so this test failed on every run the day the browser under the
    // suite became 153. Said first and by version, so that a browser which
    // can be told no scale either way fails here, saying so, and not at a
    // regular expression over `ui()` further down.
    const version = scaled.browser.version();
    const r = await textScaleReadings(scaled);
    console.log(`  Chromium ${version}, system font scale 1.3: env(preferred-text-scale) reads ${r.plain} as the page stands, ${r.asked} with meta text-scale`);
    assert.ok(Math.abs(r.plain - 1.3) < 1e-3 || Math.abs(r.asked - 1.3) < 1e-3,
      `Chromium ${version} was started with --blink-settings=accessibilityFontScaleFactor=1.3 and reports it neither to a page as it stands (${r.plain}) nor to one that asks with meta text-scale (${r.asked}): this browser cannot be told a font scale, or says it another way now`);
    assert.match(await said(scaled), /100% here is 1\.69× a desktop's: a phone 1\.3, text size 1\.30 \(the system's font scale\)/);
    const [b0, b1] = await Promise.all([app, scaled].map((a) => a.page.$eval('#toolbar button[data-tool="line"]', (el) => el.getBoundingClientRect().width)));
    assert.ok(Math.abs(b1 / b0 - 1.3) < 0.08, `a tool button drawn 1.3 × larger: ${b0} → ${b1}`);
    // And `font: medium` did not move, which is why it is not what is read —
    // nor has the app's own asking left its meta behind, which would move it
    // (21 px with the meta in, measured) and count the scale twice.
    assert.equal(r.medium, "16px");
    assert.equal(r.left, 0, "no meta text-scale left in the document");
    assert.deepEqual(scaled.pageErrors, []);
  } finally {
    await scaled.close();
  }
  // **The browser's own font size is counted once.** What 153 reports to a
  // page that asks is the system's scale times the browser's default font
  // size over 16 (1.15 and 20 px: 1.4375, measured), and the app's rule
  // multiplies the system's scale by the browser's own as well: 1.15 × 1.25
  // is 1.44, where counted twice it would be 1.80 and held to 1.50. On a
  // Chromium that tells every page, the same figure the old way.
  const both = await openApp({ device: "Pixel 7", args: ["--blink-settings=accessibilityFontScaleFactor=1.15,defaultFontSize=20"] });
  try {
    assert.match(await said(both), /100% here is 1\.87× a desktop's: a phone 1\.3, text size 1\.44 \(the system's font scale\)/);
    assert.deepEqual(both.pageErrors, []);
  } finally {
    await both.close();
  }
});

// ---- other browsers --------------------------------------------------------------------

test("Samsung Internet's user agent on a Galaxy S24 (Chromium underneath — a smoke run, not Samsung's browser): a tap, a drag, a long-press, a pinch", async () => {
  const s = await openApp({ device: "Galaxy S24", userAgent: SAMSUNG_UA });
  try {
    assert.match(await s.page.evaluate(() => navigator.userAgent), /SamsungBrowser/);
    await axisFrame(s, PARKED);
    await s.type("pt(-25,-15); pt(25,-15); pt(25,15); pt(-25,15)");
    await s.type('ln("p1","p2"); ln("p2","p3"); ln("p3","p4"); ln("p4","p1")');
    await s.page.evaluate(() => (document.activeElement as HTMLElement | null)?.blur());
    const g = await fingers(s);
    const at = (w: number[]) => s.screenOf(w);
    await g.tap(...await at([0, 15, 0]));
    assert.equal((await s.selection()).length, 1, "the tap selected");
    await s.type('arm("rectangle")');
    await s.page.evaluate(() => (document.activeElement as HTMLElement | null)?.blur());
    const n = (await s.model()).size;
    // A fingertip clear of the tray all round: on a 360 px Galaxy, world x −40
    // was 9 px off the tray's hit boxes once its tools were drawn at 0.8 of
    // the target (docs/plans/touch-density.md), and Chromium's touch
    // adjustment moved the press onto a button.
    const clear = async (w: number[]) => {
      const [x, y] = await at(w);
      for (const [dx, dy] of [[0, 0], [-12, 0], [12, 0], [0, -12], [0, 12]]) await s.at(x + dx, y + dy);
      return [x, y] as [number, number];
    };
    const [ax, ay] = await clear([-36, -32, 0]);
    const [bx, by] = await clear([-28, -24, 0]);
    await g.down([ax, ay]);
    await g.glide(6, [bx, by]);
    await s.page.waitForTimeout(120);
    await g.move([bx, by]);
    await s.page.waitForTimeout(120);
    await g.up();
    assert.equal((await s.model()).size, n + 8, "the drag drew");
    await s.type('arm("select")');
    await s.page.evaluate(() => (document.activeElement as HTMLElement | null)?.blur());
    await g.hold(...await at([25, 15, 0]), 700);
    assert.equal(await s.page.$eval("#ctxmenu", (el) => (el as HTMLElement).hidden), false, "the long-press menu");
    await s.page.keyboard.press("Escape");
    const before = (await s.model()).view.scale;
    const [cx, cy] = await at([0, 0, 0]);
    await g.down([cx - 30, cy], [cx + 30, cy]);
    await g.glide(8, [cx - 60, cy], [cx + 60, cy]);
    await g.up();
    assert.ok((await s.model()).view.scale > before * 1.5, "the pinch zoomed");
    assert.deepEqual(s.pageErrors, []);
  } finally {
    await s.close();
  }
});

test("nothing the page threw went uncaught", () => {
  assert.deepEqual(app.pageErrors, []);
});
