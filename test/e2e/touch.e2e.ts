// The app under fingers (docs/plans/touch.md; the owner: "it should work on a
// multi-touch device. Specifically I have an iPhone").
//
// Chromium emulating an iPhone 13 — its viewport, its 3× screen, `isMobile`
// and `hasTouch`, so `(pointer: coarse)` matches and every press is a touch
// pointer — with real multi-touch dispatched through CDP (fingers.ts). **Not
// Safari**: this machine has no WebKit, and what only iOS does (its keyboard,
// its callouts, its gestures at the screen's edges) is for the owner to try on
// the phone. What this can answer: that each row of the spec's finger table
// reaches the path a mouse uses, that the layout fits a phone both ways up,
// and that every target is 44 px.
//
// Set NEOCAD_E2E_SHOTS to a directory to keep the screenshots; look at them.

import { test, before, after } from "node:test";
import assert from "node:assert/strict";
import { mkdirSync } from "node:fs";
import { join } from "node:path";
import { openApp, axisFrame, PARKED, type AppContext, forgetAutosave } from "./harness.ts";
import { fingers, type Fingers } from "./fingers.ts";

const SHOTS = process.env.NEOCAD_E2E_SHOTS;
async function shot(app: AppContext, name: string): Promise<void> {
  if (!SHOTS) return;
  mkdirSync(SHOTS, { recursive: true });
  await app.page.screenshot({ path: join(SHOTS, `touch-${name}.png`) });
}

let app: AppContext;
let f: Fingers;
before(async () => { app = await openApp({ device: "iPhone 13" }); });
after(async () => { await app.close(); });

/** A fresh page, a parked sketch frame, and a 50×30 rectangle drawn round the middle of the view. */
async function fresh(): Promise<void> {
  // The viewer's own state — layout, view mode, remembered options — lives
  // in this browser's storage and would carry from one test into the next.
  await app.page.evaluate(() => localStorage.clear());
  await forgetAutosave(app.page); // a reload here means the app's first start
  await app.page.reload({ waitUntil: "networkidle" });
  await app.page.waitForFunction(() => document.getElementById("status")?.textContent?.includes("ready"), null, { timeout: 20_000 });
  await axisFrame(app, PARKED);
  await app.type("pt(-25,-15); pt(25,-15); pt(25,15); pt(-25,15)");
  await app.type('ln("p1","p2"); ln("p2","p3"); ln("p3","p4"); ln("p4","p1")');
  // Typing focused the command line, as tapping it would; a finger on the
  // drawing is what puts it away, which is tested below on its own.
  await app.page.evaluate(() => (document.activeElement as HTMLElement | null)?.blur());
  f = await fingers(app);
}

/**
 * Where a world point is on the canvas, checked to be canvas a finger can
 * reach — a fingertip's width clear of every panel, not only the pixel: the
 * browser's touch adjustment moves a contact onto a button beside it (a press
 * aimed at the toolbar's very edge went to the toolbar), as a phone's does.
 */
async function onCanvas(world: number[]): Promise<[number, number]> {
  const [x, y] = await app.screenOf(world);
  for (const [dx, dy] of [[0, 0], [-12, 0], [12, 0], [0, -12], [0, 12]]) await app.at(x + dx, y + dy); // throws under a panel
  return [x, y];
}

/** A selector's middle, in canvas pixels — the panels lie over the canvas, in its coordinates. */
async function middleOf(selector: string): Promise<[number, number]> {
  return app.page.$eval(selector, (el) => {
    const r = el.getBoundingClientRect();
    const c = document.getElementById("cv")!.getBoundingClientRect();
    return [r.x + r.width / 2 - c.x, r.y + r.height / 2 - c.y] as [number, number];
  });
}

const engine = <T>(fn: string) => app.page.evaluate((src) => {
  const e = (window as unknown as { __neocad: { engine: unknown; model: unknown } }).__neocad;
  return new Function("engine", "model", `return (${src})`)(e.engine, e.model);
}, fn) as Promise<T>;

const focused = () => app.page.evaluate(() => document.activeElement?.id ?? "");

/**
 * The model once `want` holds of it, within a few seconds — for what a tap on
 * the strip or the menu typed. A typed line runs through `submit`, which is
 * asynchronous, so the model is read until the line has landed rather than
 * once at a guess (measured: on a loaded machine an undo landed after the
 * tap's own 120 ms settle, and a single read saw the rectangle still there).
 */
async function settled(want: (m: Awaited<ReturnType<AppContext["model"]>>) => boolean, what: string) {
  const deadline = Date.now() + 5000;
  for (;;) {
    const m = await app.model();
    if (want(m)) return m;
    if (Date.now() > deadline) assert.fail(`${what}: ${JSON.stringify({ size: m.size, lines: m.lines.length, activeTool: m.activeTool })}`);
    await app.page.waitForTimeout(50);
  }
}

test("portrait: the phone's defaults — command line docked to the bottom, the tray down the left under the logo, the strip top right under the logo's row, a one-line log, the organiser", async () => {
  await fresh();
  const rects = await app.page.evaluate(() => {
    const out: Record<string, { x: number; y: number; w: number; h: number }> = {};
    for (const el of Array.from(document.querySelectorAll<HTMLElement>(".panel[data-panel]"))) {
      if (el.hidden) continue;
      out[el.dataset.panel!] = { x: el.offsetLeft, y: el.offsetTop, w: el.offsetWidth, h: el.offsetHeight };
    }
    const wrap = document.getElementById("viewwrap")!;
    return { out, area: { w: wrap.clientWidth, h: wrap.clientHeight }, width: innerWidth };
  });
  assert.equal(rects.width, 390, "laid out at the phone's own width");
  const { out, area } = rects;
  // The organiser shown from the start (docs/plans/everything-fits.md; the owner: "show from start").
  assert.deepEqual(Object.keys(out).sort(), ["actions", "cmd", "log", "organiser", "toolbar"]);
  for (const [id, r] of Object.entries(out)) {
    assert.ok(r.x >= 0 && r.y >= 0 && r.x + r.w <= area.w && r.y + r.h <= area.h, `${id} wholly inside: ${JSON.stringify(r)}`);
  }
  // Docked to the bottom. Edge to edge in the installed app; here, in Safari's
  // shorter page (390 × 664), the column of thirteen — Select and the Hand
  // with the eleven tools — runs below where the line would start, so the
  // line starts right of it (touchlayout.test.ts has both cases).
  assert.deepEqual([out.cmd.x + out.cmd.w, out.cmd.y + out.cmd.h], [area.w, area.h], "the command line docked to the bottom and the right");
  assert.ok(out.cmd.x === 0 || out.cmd.x >= out.toolbar.x + out.toolbar.w, `edge to edge, or beside the column: ${JSON.stringify(out.cmd)}`);
  const logo = await app.page.$eval("#logo", (el) => (el as HTMLElement).offsetTop + (el as HTMLElement).offsetHeight);
  assert.ok(out.toolbar.x <= 8 && out.toolbar.h > out.toolbar.w && out.toolbar.y >= logo, "the tray is a column down the left, under the logo");
  assert.equal(await app.page.$$eval("#toolbar button", (bs) => bs.length), 13, "Select, the Hand and the eleven tools");
  // Under the logo's row, which is the status's (it used to be at y 8, under the status's text).
  assert.ok(out.actions.y >= logo && out.actions.y <= logo + 8 && out.actions.x + out.actions.w >= area.w - 8 && out.actions.w > out.actions.h,
    `the strip is a row at the top right, under the logo's row: ${JSON.stringify(out.actions)}`);
  assert.ok(out.log.h <= 72, `the log is one line: ${out.log.h}px`);
  const lines = await app.page.$eval("#log", (el) => Math.round(el.clientHeight / parseFloat(getComputedStyle(el).lineHeight)));
  assert.ok(lines <= 2, `and shows one line of itself: ${lines}`);
  assert.deepEqual(app.pageErrors, [], "and no two panels overlap (the dev build reports it if they do)");
  await shot(app, "portrait");
});

test("the keyboard stays away: the command line is not focused on start, nor after a tap — a tap on it focuses it", async () => {
  await app.page.evaluate(() => localStorage.clear());
  await forgetAutosave(app.page); // a reload here means the app's first start
  await app.page.reload({ waitUntil: "networkidle" });
  await app.page.waitForFunction(() => document.getElementById("status")?.textContent?.includes("ready"), null, { timeout: 20_000 });
  assert.notEqual(await focused(), "cmd", "not focused on start");
  f = await fingers(app);
  await f.tap(...await middleOf("#cmd"));
  assert.equal(await focused(), "cmd", "a tap on the line focuses it, as any field");
  await f.tap(200, 450);
  assert.notEqual(await focused(), "cmd", "a tap on the drawing puts it away");
  // With a command being written, a tap on geometry still puts its name in
  // the line — without focusing it again.
  await fresh();
  await f.tap(...await middleOf("#cmd"));
  await app.page.keyboard.type("dist(");
  await f.tap(...await onCanvas([-25, -15, 0]));
  assert.equal(await app.page.$eval("#cmd", (el) => (el as HTMLInputElement).value), 'dist("p1"');
  assert.notEqual(await focused(), "cmd", "the name went in; the keyboard stayed down");
});

test("a tap selects, a tap on another adds it, a tap on a selected one drops it, a tap on empty canvas clears", async () => {
  await fresh();
  await f.tap(...await onCanvas([-25, -15, 0]));
  assert.deepEqual(await app.selection(), ["p1"]);
  await f.tap(...await onCanvas([0, 15, 0])); // the middle of l3
  assert.deepEqual(await app.selection(), ["p1", "l3"]);
  await f.tap(...await onCanvas([-25, -15, 0]));
  assert.deepEqual(await app.selection(), ["l3"]);
  await f.tap(...await onCanvas([55, -40, 0]));
  assert.deepEqual(await app.selection(), []);
  // A fingertip's reach: 15 px off a corner still takes it.
  const [x, y] = await onCanvas([25, 15, 0]);
  await f.tap(x + 11, y - 11);
  assert.deepEqual(await app.selection(), ["p3"]);
});

test("a quick tap while the page is busy is still a tap: blocked 700 ms at touchdown, it selects", async () => {
  await fresh();
  const [x, y] = await onCanvas([25, -15, 0]);
  // A heavy solve's worth of a busy page, starting the moment the finger lands.
  await app.page.evaluate(() => {
    document.getElementById("cv")!.addEventListener("pointerdown", () => {
      const t = performance.now();
      while (performance.now() - t < 700) { /* busy */ }
    }, { once: true });
  });
  // A real finger's lift is stamped by the OS when it happens, and queues
  // behind the busy page. The fingers helper cannot say that — CDP waits for
  // each touch to be handled before it returns, so a lift sent after it is a
  // 700 ms press — so this sends the two touches without waiting, the lift
  // stamped 40 ms after the landing, as a phone's would be. Before the
  // recogniser read the events' own timestamps, and before a late long-press
  // timer yielded to queued input, this tap was lost (gestures.ts, LATE_MS).
  const cdp = await app.page.context().newCDPSession(app.page);
  const box = await app.page.$eval("#cv", (el) => { const r = el.getBoundingClientRect(); return { x: r.x, y: r.y }; });
  const point = [{ x: box.x + x, y: box.y + y, id: 0, radiusX: 8, radiusY: 8, force: 1 }];
  const t0 = Date.now() / 1000;
  const landed = cdp.send("Input.dispatchTouchEvent", { type: "touchStart", touchPoints: point, timestamp: t0 });
  await new Promise((r) => setTimeout(r, 40));
  const lifted = cdp.send("Input.dispatchTouchEvent", { type: "touchEnd", touchPoints: [], timestamp: t0 + 0.04 });
  await Promise.all([landed, lifted]);
  const deadline = Date.now() + 3000;
  let sel: string[] = [];
  while (Date.now() < deadline) {
    sel = await app.selection();
    if (sel.length) break;
    await app.page.waitForTimeout(50);
  }
  assert.deepEqual(sel, ["p2"], "the tap selected what it landed on");
  assert.equal(await app.page.evaluate(() => {
    const m = document.getElementById("ctxmenu");
    return m !== null && !m.hidden && getComputedStyle(m).display !== "none";
  }), false, "and opened no menu: it was not a long-press");
  await cdp.detach();
});

test("a finger down on a quiet corner reveals it, as a hover does; lifting ends it", async () => {
  await fresh();
  // Shaded, a corner of a rectangle is quiet: not drawn until the hand is on it.
  // p2 is the bottom-right corner: its edges run left and up from it, so a
  // pixel just down-right of it is the dot's alone (a lit dot is 5 px across
  // the radius; the edges are never there).
  const [x, y] = await onCanvas([25, -15, 0]);
  const dot = async () => (await app.pixels("drawing", [[x + 3.5, y + 3.5]]))[0];
  assert.equal((await dot())[3], 0, "quiet: not drawn");
  await f.down([x, y]);
  assert.equal(await engine("engine.hover?.name"), "p2");
  const held = await dot();
  assert.ok(held[3] > 150 && held[0] > 180 && held[2] < 120, `drawn, in the hover's amber, while the finger is on it: ${held}`);
  await shot(app, "reveal");
  // Ended without a tap — a second finger, which drops the first's gesture
  // however long the first was down (a lift would be a tap or not by the
  // clock, and a loaded machine's clock is not the test's to choose).
  await f.down([x - 120, y + 60]);
  await f.up();
  assert.equal(await engine("engine.hover"), null, "the finger's reveal is over");
  assert.deepEqual(await app.selection(), []);
  assert.equal((await dot())[3], 0, "quiet again once the hand is off");
  // What is selected stays drawn after the lift; cleared, it is quiet again.
  await f.tap(x, y);
  assert.deepEqual(await app.selection(), ["p2"]);
  assert.ok((await dot())[3] > 150, "drawn as selected");
  await f.tap(...await onCanvas([55, -40, 0]));
  assert.deepEqual(await app.selection(), []);
  assert.equal((await dot())[3], 0, "and quiet again");
});

test("a tool armed: one finger's drag draws a rectangle, with the lifted mark above the finger; one undo step", async () => {
  await fresh();
  await f.tap(...await middleOf('#toolbar button[data-tool="rectangle"]'));
  await settled((m) => m.activeTool === "rectangle", "the button armed the rectangle");
  const before = (await app.model()).size;
  const [ax, ay] = await onCanvas([-30, 32, 0]);
  const [bx, by] = await onCanvas([-10, 22, 0]);
  await f.down([ax, ay]);
  await f.glide(6, [bx, by]);
  // The lifted copy of the active point: a dark disc LIFT px above it.
  const disc = (await app.pixels("drawing", [[bx + 0.5, by - 56 + 0.5]]))[0];
  assert.ok(disc[3] > 150, `the lifted mark is drawn above the finger: ${disc}`);
  await shot(app, "drawing");
  // The finger rests on the corner before it lifts, as a hand placing a
  // corner does. Lifted mid-glide, the drag is a fling to Chromium, and a tap
  // that follows a fling within ~150 ms is suppressed as the tap that stopped
  // it — no click (measured: a strip tap 80 ms after a moving lift was lost
  // every time, after a 120 ms rest never). The test passed on a loaded
  // machine only because the load stretched that gap.
  await app.page.waitForTimeout(120);
  await f.move([bx, by]);
  await app.page.waitForTimeout(120);
  await f.up();
  const m = await app.model();
  assert.equal(m.size, before + 8, "four corners and four sides");
  // Undo, from the strip: the whole rectangle in one step.
  await f.tap(...await middleOf('#actions button[data-action="undo"]'));
  await settled((m) => m.size === before, "the undo took the rectangle");
  assert.match(await app.log(), /> undo\(\)/, "the strip typed it");
});

test("a second finger mid-draw drops the rectangle — nothing built — and pans and zooms instead", async () => {
  await fresh();
  await app.type("rectangle");
  await app.page.evaluate(() => (document.activeElement as HTMLElement | null)?.blur());
  const before = await app.model();
  const [ax, ay] = await onCanvas([-30, 32, 0]);
  await f.down([ax, ay]);
  await f.glide(4, [ax + 30, ay + 30]);
  await f.down([ax + 120, ay + 60]);
  await f.glide(4, [ax + 20, ay + 40], [ax + 160, ay + 80]);
  await f.up();
  const after = await app.model();
  assert.equal(after.size, before.size, "the half-drawn rectangle was dropped");
  assert.equal(after.activeTool, "rectangle", "and the tool is still armed");
  assert.ok(after.view.scale > before.view.scale, "the two fingers zoomed");
});

test("one finger on empty canvas orbits the drawing", async () => {
  await fresh();
  const [x, y] = await onCanvas([55, -40, 0]);
  await f.drag([x, y], [x + 60, y], 8);
  const m = await app.model();
  assert.ok(m.view.right && Math.abs(m.view.right[2]) > 0.1, `turned: right is ${m.view.right}`);
  assert.deepEqual(await app.selection(), [], "and selected nothing");
  await shot(app, "orbit");
});

test("two fingers pan by their centroid and zoom about it: the point under it stays under it", async () => {
  await fresh();
  const [cx, cy] = [230, 380];
  const under = await app.page.evaluate(([x, y]) =>
    (window as unknown as { __neocad: { engine: { screenToWorld(x: number, y: number): number[] } } }).__neocad.engine.screenToWorld(x, y), [cx, cy]);
  const before = (await app.model()).view.scale;
  await f.down([cx - 40, cy], [cx + 40, cy]);
  // Centroid to (cx + 20, cy + 30); spread from 80 to 160.
  await f.glide(8, [cx + 20 - 80, cy + 30], [cx + 20 + 80, cy + 30]);
  await f.up();
  const m = await app.model();
  assert.ok(Math.abs(m.view.scale / before - 2) < 0.02, `zoomed ×2: ${m.view.scale / before}`);
  const [sx, sy] = await app.screenOf(under);
  assert.ok(Math.hypot(sx - (cx + 20), sy - (cy + 30)) < 1.5, `the point under the centroid went with it: ${sx}, ${sy}`);
});

test("a long-press opens the menu at the finger, for what it landed on", async () => {
  await fresh();
  const [x, y] = await onCanvas([25, 15, 0]);
  await f.hold(x, y, 700);
  const menu = await app.page.$eval("#ctxmenu", (el) => ({
    hidden: (el as HTMLElement).hidden, head: el.querySelector(".head")?.textContent ?? "",
    x: (el as HTMLElement).offsetLeft, y: (el as HTMLElement).offsetTop, w: (el as HTMLElement).offsetWidth,
  }));
  assert.equal(menu.hidden, false);
  assert.match(menu.head, /^p3/);
  // At the finger's height, and across it — on a phone the menu is wider than
  // the room either side of most fingers, and menu.ts holds it inside the
  // window (a few pixels of touch adjustment aside, the finger's own place).
  assert.ok(menu.x <= x && x <= menu.x + menu.w && Math.abs(menu.y - y) <= 10,
    `at the finger (${x}, ${y}): ${JSON.stringify(menu)}`);
  assert.deepEqual(await app.selection(), [], "the lift picked nothing");
  await shot(app, "menu");
  // An item, by finger.
  const del = await app.page.$$eval("#ctxmenu .item", (items) => {
    const c = document.getElementById("cv")!.getBoundingClientRect();
    const it = items.find((i) => i.textContent?.startsWith("Delete"))!.getBoundingClientRect();
    return [it.x + it.width / 2 - c.x, it.y + it.height / 2 - c.y] as [number, number];
  });
  await f.tap(...del);
  await settled((m) => !m.points.p3, "Delete took p3");
  assert.match(await app.log(), /> del\("p3"\)/);

  // On empty canvas with room to the right the menu opens with its first row
  // under the finger — and the lift must not press it. (The browser's click
  // after a long touch landed on that row and ran it, until the engine
  // cancelled the touch's click.)
  const typed = (await app.log()).split("> ").length;
  const [ex, ey] = await onCanvas([40, 35, 0]);
  await f.hold(ex, ey, 700);
  const open = await app.page.$eval("#ctxmenu", (el) => {
    const r = (el as HTMLElement);
    return { hidden: r.hidden, x: r.offsetLeft, y: r.offsetTop, w: r.offsetWidth, h: r.offsetHeight };
  });
  assert.equal(open.hidden, false, "still open after the lift");
  assert.ok(open.x <= ex && ex <= open.x + open.w && open.y <= ey + 10, `with the finger over it: ${JSON.stringify(open)} at ${ex}, ${ey}`);
  assert.equal((await app.log()).split("> ").length, typed, "and nothing on it ran");
  // A tap elsewhere closes it — elsewhere being off the menu, which on a
  // phone covers most of the screen: the first place, a fingertip clear all
  // round, where the browser says the canvas is on top.
  const away = await app.page.evaluate(() => {
    const cv = document.getElementById("cv")!;
    const c = cv.getBoundingClientRect();
    const bare = (x: number, y: number) => [[0, 0], [-12, 0], [12, 0], [0, -12], [0, 12]]
      .every(([dx, dy]) => document.elementFromPoint(c.x + x + dx, c.y + y + dy) === cv);
    for (let y = 30; y < c.height - 30; y += 10) for (let x = 30; x < c.width - 30; x += 10) if (bare(x, y)) return [x, y] as [number, number];
    return null;
  });
  assert.ok(away, "somewhere off the menu to tap");
  const view = await app.page.evaluate(() => (window as unknown as { __neocad: { repl: { eval(s: string): Promise<{ value: unknown }> } } })
    .__neocad.repl.eval("view()").then((r) => r.value));
  await f.tap(...away!);
  assert.equal(await app.page.$eval("#ctxmenu", (el) => (el as HTMLElement).hidden), true);
  assert.equal((await app.log()).split("> ").length, typed, "closing it ran nothing either");
  assert.equal(await app.page.evaluate(() => (window as unknown as { __neocad: { repl: { eval(s: string): Promise<{ value: unknown }> } } })
    .__neocad.repl.eval("view()").then((r) => r.value)), view);
});

test("long-press, then drag: the menu goes and a box selects", async () => {
  await fresh();
  const [x0, y0] = await onCanvas([-30, 32, 0]);
  const [x1, y1] = await onCanvas([40, -30, 0]);
  await f.hold(x0, y0, 700, true);
  assert.equal(await app.page.$eval("#ctxmenu", (el) => (el as HTMLElement).hidden), false, "the menu came first");
  await f.glide(8, [x1, y1]);
  assert.equal(await app.page.$eval("#ctxmenu", (el) => (el as HTMLElement).hidden), true, "and went when the finger moved");
  await shot(app, "box");
  await f.up();
  const sel = await app.selection();
  assert.deepEqual([...sel].sort(), ["l1", "l2", "l3", "l4", "p1", "p2", "p3", "p4"]);
});

test("a third finger drops everything until the hand is off", async () => {
  await fresh();
  await app.type("rectangle");
  await app.page.evaluate(() => (document.activeElement as HTMLElement | null)?.blur());
  const before = await app.model();
  const [ax, ay] = await onCanvas([-30, 32, 0]);
  await f.down([ax, ay], [ax + 100, ay], [ax + 50, ay + 80]);
  await f.glide(6, [ax + 20, ay + 20], [ax + 160, ay + 20], [ax + 70, ay + 120]);
  await f.up();
  const after = await app.model();
  assert.equal(after.size, before.size);
  assert.equal(after.view.scale, before.view.scale, "no zoom either");
});

test("the action strip: Undo, Redo, Delete, Cancel each type their line — and are off when they would do nothing", async () => {
  await fresh();
  const off = (a: string) => app.page.$eval(`#actions button[data-action="${a}"]`, (b) => (b as HTMLButtonElement).disabled);
  assert.equal(await off("redo"), true, "nothing to redo");
  assert.equal(await off("delete"), true, "nothing selected");
  assert.equal(await off("cancel"), true, "nothing to cancel");
  await f.tap(...await onCanvas([0, -15, 0])); // l1
  assert.equal(await off("delete"), false);
  // Each button's line runs asynchronously (`submit`), so each outcome — and
  // the button state that follows from it — is waited for, not sampled.
  const offBecomes = (a: string, v: boolean) => app.page.waitForFunction(([a, v]) =>
    (document.querySelector(`#actions button[data-action="${a}"]`) as HTMLButtonElement).disabled === v, [a, v] as const,
  { timeout: 5000 });
  await f.tap(...await middleOf('#actions button[data-action="delete"]'));
  await settled((m) => m.lines.length === 3, "Delete took l1");
  assert.match(await app.log(), /> del\("l1"\)/);
  await f.tap(...await middleOf('#actions button[data-action="undo"]'));
  await settled((m) => m.lines.length === 4, "Undo put it back");
  await offBecomes("redo", false);
  await f.tap(...await middleOf('#actions button[data-action="redo"]'));
  await settled((m) => m.lines.length === 3, "Redo took it again");
  assert.match(await app.log(), /> redo\(\)/);
  await f.tap(...await middleOf('#toolbar button[data-tool="line"]'));
  await offBecomes("cancel", false);
  await f.tap(...await middleOf('#actions button[data-action="cancel"]'));
  await settled((m) => m.activeTool === null, "Cancel put the tool down");
  assert.match(await app.log(), /> cancel\(\)/);
});

test("the extrude dialog end to end by finger: the button, a tap inside, ✓", async () => {
  await fresh();
  await f.tap(...await middleOf('#toolbar button[data-tool="extrude"]'));
  await settled((m) => m.activeTool === "extrude", "the button armed extrude");
  await f.tap(...await onCanvas([-12, 8, 0]));
  await app.page.waitForFunction(() => !(document.querySelector("#options .oact button.ok") as HTMLButtonElement | null)?.disabled);
  await shot(app, "extrude");
  await f.tap(...await middleOf("#options .oact button.ok"));
  await app.page.waitForFunction(() =>
    (window as unknown as { __neocad: { model: { features: Map<string, unknown> } } }).__neocad.model.features.size === 1);
  assert.match(await app.log(), /> extrude\(/);
});

test("every target is hit over at least 44 px, however small it is drawn: tray and strip buttons, strips, grips, option rows and ✓/✗, menu items", async () => {
  await fresh();
  await app.type('arm("extrude")');
  await app.page.evaluate(() => (document.activeElement as HTMLElement | null)?.blur());
  const [x, y] = await onCanvas([40, 35, 0]);
  await f.hold(x, y, 700);
  const small = await app.page.evaluate(() => {
    const out: string[] = [];
    // A target's hit box: its own box, or the ::before that overhangs it
    // (index.html) — whichever is bigger along each axis.
    const check = (what: string, el: Element, w = true, h = true) => {
      const r = el.getBoundingClientRect();
      const before = getComputedStyle(el, "::before");
      const hw = Math.max(r.width, before.content === "none" ? 0 : parseFloat(before.width) || 0);
      const hh = Math.max(r.height, before.content === "none" ? 0 : parseFloat(before.height) || 0);
      if ((w && hw < 44) || (h && hh < 44)) out.push(`${what} ${Math.round(hw)}x${Math.round(hh)}`);
    };
    for (const b of Array.from(document.querySelectorAll(".tray button"))) check(`button ${(b as HTMLElement).dataset.tool ?? (b as HTMLElement).dataset.action}`, b);
    for (const s of Array.from(document.querySelectorAll(".panel:not([hidden])>.ptitle"))) check(`strip of ${(s.parentElement as HTMLElement).dataset.panel}`, s);
    for (const g of Array.from(document.querySelectorAll(".panel:not([hidden])>.pgrip"))) check(`grip ${(g as HTMLElement).dataset.corner}`, g);
    for (const r of Array.from(document.querySelectorAll("#options .orow"))) check("option row", r, false, true);
    for (const b of Array.from(document.querySelectorAll("#options .oact button"))) check("✓/✗", b);
    for (const i of Array.from(document.querySelectorAll("#ctxmenu .item, #ctxmenu .choice"))) check(`menu ${i.textContent}`, i, false, true);
    return { out, items: document.querySelectorAll("#ctxmenu .item").length };
  });
  assert.ok(small.items > 0, "the menu was open to be measured");
  assert.deepEqual(small.out, []);
});

test("landscape: the tray is a row along the bottom, the command line at the top, the strip and log at the right", async () => {
  const land = await openApp({ device: "iPhone 13 landscape" });
  try {
    const { out, area } = await land.page.evaluate(() => {
      const out: Record<string, { x: number; y: number; w: number; h: number }> = {};
      for (const el of Array.from(document.querySelectorAll<HTMLElement>(".panel[data-panel]"))) {
        if (el.hidden) continue;
        out[el.dataset.panel!] = { x: el.offsetLeft, y: el.offsetTop, w: el.offsetWidth, h: el.offsetHeight };
      }
      const wrap = document.getElementById("viewwrap")!;
      return { out, area: { w: wrap.clientWidth, h: wrap.clientHeight } };
    });
    for (const [id, r] of Object.entries(out)) {
      assert.ok(r.x >= 0 && r.y >= 0 && r.x + r.w <= area.w && r.y + r.h <= area.h, `${id} wholly inside: ${JSON.stringify(r)}`);
    }
    assert.ok(out.toolbar.w > out.toolbar.h && out.toolbar.y + out.toolbar.h >= area.h - 8, "a row along the bottom");
    assert.ok(out.cmd.y <= 8 && out.actions.y <= 8 && out.actions.x > out.cmd.x + out.cmd.w);
    assert.ok(out.log.x === out.actions.x && out.log.y > out.actions.y);
    await land.type("plane()");
    await land.type("pt(-25,-15); pt(25,-15); pt(25,15); pt(-25,15)");
    await land.type('ln("p4","p5"); ln("p5","p6"); ln("p6","p7"); ln("p7","p4"); arm("extrude")');
    await land.page.evaluate(() => (document.activeElement as HTMLElement | null)?.blur());
    if (SHOTS) {
      mkdirSync(SHOTS, { recursive: true });
      await land.page.screenshot({ path: join(SHOTS, "touch-landscape.png") });
    }
    assert.deepEqual(land.pageErrors, []);
  } finally {
    await land.close();
  }
});

test("a mouse is a mouse: the desktop page has no action strip and keeps the command line focused", async () => {
  const desk = await openApp();
  try {
    assert.equal(await desk.page.$$eval('.panel[data-panel="actions"]', (els) => els.length), 0);
    assert.equal(await desk.page.evaluate(() => document.activeElement?.id), "cmd");
    assert.equal(await desk.page.$eval("#toolbar button", (b) => (b as HTMLElement).offsetWidth), 20);
  } finally {
    await desk.close();
  }
});

test("nothing the page threw went uncaught", () => {
  assert.deepEqual(app.pageErrors, []);
});
