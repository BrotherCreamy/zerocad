// The chrome as floating panels — toolbar, log, command line — over a
// full-window canvas, in a browser, with a real mouse.
//
// Three claims, each of which only a browser can check.
//
// **A toolbar button is a shortcut to a command and nothing more** — the
// context menu's rule. So a click is checked the way the menu's items are: by
// reading the log (it shows the typed `arm(...)`), the journal (arming journals
// nothing, by button exactly as by typing) and the armed tool.
//
// **Panel gestures and canvas gestures never cross.** This is the bug class a
// floating UI invites: a drag that starts on a panel and is released over the
// drawing places a point; a drag that starts on the drawing and is released
// over a panel never finishes. Both directions are driven here with a real
// pointer stream, a tool armed, so that a leak would build something visible.
//
// **Layout is the viewer's, not the drawing's.** It survives a reload, it
// survives a storage that throws on every touch (by quietly not persisting),
// and it never reaches the journal, the saved file or the undo history.
//
// And the tray's own rules, from the owner's three lines: a panel stays wholly
// inside; a button is an icon whose name is its tooltip; the tray turns into a
// row against a top or bottom edge and a column against a side, live, as it is
// pushed. And from the owner's next two: a panel resizes from any of its four
// corners, the opposite one fixed; the tray's buttons wrap into more columns
// (or rows) as it is made shorter, never a scrollbar. Set NEOCAD_E2E_SHOTS to a
// directory to keep pictures of it at its own size — and look at them.

import { test, before, after } from "node:test";
import assert from "node:assert/strict";
import { mkdirSync } from "node:fs";
import { join } from "node:path";
import { openApp, axisFrame, type AppContext } from "./harness.ts";

let app: AppContext;
before(async () => {
  app = await openApp();
  await axisFrame(app, [150, 150]); // parked out of the way: nothing here wants to snap to it
});
after(async () => { await app.close(); });

interface Box { x: number; y: number; width: number; height: number }

async function rectOf(selector: string): Promise<Box> {
  return app.page.$eval(selector, (el) => {
    const r = el.getBoundingClientRect();
    return { x: r.x, y: r.y, width: r.width, height: r.height };
  });
}

const panel = (id: string) => `.panel[data-panel="${id}"]`;
const strip = (id: string) => `${panel(id)} > .ptitle`;
type Corner = "nw" | "ne" | "sw" | "se";
const CORNERS: Corner[] = ["nw", "ne", "sw", "se"];
const grip = (id: string, corner: Corner = "se") => `${panel(id)} > .pgrip[data-corner="${corner}"]`;

/**
 * Where a hand presses `selector`'s element: its middle — or, for a grip, a
 * few pixels in from the panel's corner, since a grip is only the triangle in
 * its corner and the middle of its box lies on the triangle's long side.
 */
async function pressPoint(selector: string): Promise<{ x: number; y: number }> {
  const r = await rectOf(selector);
  const corner = await app.page.$eval(selector, (el) => (el as HTMLElement).dataset.corner ?? null);
  if (!corner) return { x: r.x + r.width / 2, y: r.y + r.height / 2 };
  return { x: corner.endsWith("w") ? r.x + 3 : r.x + r.width - 3, y: corner.startsWith("n") ? r.y + 3 : r.y + r.height - 3 };
}

/** Presses `selector`'s element (`pressPoint`), moves by (dx, dy) in steps, releases. */
async function dragBy(selector: string, dx: number, dy: number, steps = 8): Promise<void> {
  const { x, y } = await pressPoint(selector);
  await app.page.mouse.move(x, y);
  await app.page.mouse.down();
  await app.page.mouse.move(x + dx, y + dy, { steps });
  await app.page.mouse.up();
  await app.page.waitForTimeout(80);
}

const SHOTS = process.env.NEOCAD_E2E_SHOTS;
/** The toolbar at its own size, with a margin of what is round it; and the whole window. */
async function shot(name: string): Promise<void> {
  if (!SHOTS) return;
  mkdirSync(SHOTS, { recursive: true });
  await app.page.waitForTimeout(100);
  const tb = await rectOf(panel("toolbar"));
  const m = 12;
  const clip = { x: Math.max(0, tb.x - m), y: Math.max(0, tb.y - m), width: tb.width + 2 * m, height: tb.height + 2 * m };
  await app.page.screenshot({ path: join(SHOTS, `panels-${name}-toolbar.png`), clip });
  await app.page.screenshot({ path: join(SHOTS, `panels-${name}.png`) });
}

const armed = () => app.page.evaluate(() =>
  (window as never as { __neocad: { engine: { active: { name: string } | null } } }).__neocad.engine.active?.name ?? null);

const pressed = () => app.page.$$eval("#toolbar button[aria-pressed=true]", (els) =>
  els.map((el) => (el as HTMLElement).dataset.tool));

const cmd = () => app.page.inputValue("#cmd");

async function reloadApp(): Promise<void> {
  await app.page.reload({ waitUntil: "networkidle" });
  await app.page.waitForFunction(() => document.getElementById("status")?.textContent?.includes("ready"));
}

// --- the layout ----------------------------------------------------------------

test("the canvas is the whole window under the header, and the chrome floats over it", async () => {
  const cv = await rectOf("#cv");
  const header = await rectOf("header");
  assert.equal(cv.width, 1100, "the full width");
  assert.equal(cv.y, header.height, "from the bottom of the header…");
  assert.equal(cv.y + cv.height, 800, "…to the bottom of the window");

  for (const id of ["toolbar", "log", "cmd"]) {
    const r = await rectOf(panel(id));
    assert.ok(r.x >= cv.x && r.y >= cv.y && r.x + r.width <= cv.x + cv.width && r.y + r.height <= cv.y + cv.height,
      `the ${id} panel is wholly on the canvas by default: ${JSON.stringify(r)}`);
  }
  // None of the defaults overlaps another — overlapping chrome is a visual bug.
  const [tb, log, line] = [await rectOf(panel("toolbar")), await rectOf(panel("log")), await rectOf(panel("cmd"))];
  assert.ok(tb.y + tb.height < log.y, "the toolbar ends above the log");
  assert.ok(log.y + log.height <= line.y, "the command line is under the log, not on it");

  // The log no longer takes height from the drawing as it fills.
  for (let i = 0; i < 12; i++) await app.type(`${i} + 1`);
  assert.deepEqual(await rectOf("#cv"), cv, "typing a dozen entries leaves the canvas exactly as it was");
});

// --- the toolbar ---------------------------------------------------------------

test("the toolbar has a button per registered tool: its icon, with its name as the tooltip", async () => {
  const tools = (await app.repl("tools()")).value as string[];
  const buttons = await app.page.$$eval("#toolbar button", (els) =>
    els.map((el) => ({
      tool: (el as HTMLElement).dataset.tool,
      name: el.getAttribute("aria-label"),
      hint: el.getAttribute("title"),
      glyph: el.querySelector(":scope > svg")?.getAttribute("data-glyph") ?? null,
      text: el.textContent,
      box: (() => { const r = el.getBoundingClientRect(); return [r.width, r.height]; })(),
    })));
  assert.deepEqual(buttons.map((b) => b.tool), tools, "the registry, in its order");
  assert.ok(tools.includes("extrude") && tools.includes("revolve") && tools.includes("sketch"), "the solid tools included");
  for (const b of buttons) {
    assert.equal(b.glyph, b.tool, `${b.tool}: its own glyph — every one here is a built-in`);
    assert.equal(b.text, "", "and no words on its face");
    assert.equal(b.hint, `${b.tool} — arm("${b.tool}")`, "the hover is the name, then the command the button types");
    assert.equal(b.name, b.tool, "and the name is its accessible name");
    assert.deepEqual(b.box, [20, 20], "a square button");
  }
  await shot("default-column");
});

test("a button types arm(...) through the command line — and journals exactly what typing it does", async () => {
  await app.page.fill("#cmd", "");
  const journal = (await app.model()).journalOps;
  const logBefore = await app.log();

  await app.page.click('#toolbar button[data-tool="line"]');
  await app.page.waitForTimeout(80);
  assert.equal(await armed(), "line");
  const logged = (await app.log()).slice(logBefore.length);
  assert.ok(logged.includes('> arm("line")'), `the log shows the typed command: ${logged}`);
  assert.deepEqual(await pressed(), ["line"], "the armed tool's button reads as pressed, and only it");
  const byButton = (await app.model()).journalOps;

  // The same command typed by hand.
  await app.type('arm("circle")');
  assert.equal(await armed(), "circle");
  assert.deepEqual(await pressed(), ["circle"], "the toolbar follows a typed arm too");
  const byTyping = (await app.model()).journalOps;

  assert.deepEqual(byButton, journal, "arming by button journals nothing…");
  assert.deepEqual(byTyping, journal, "…exactly as arming by typing journals nothing");

  // The command line keeps the focus through a button click, so the next
  // keystroke types rather than pressing the button again.
  await app.page.click('#toolbar button[data-tool="point"]');
  assert.equal(await app.page.evaluate(() => document.activeElement?.id), "cmd");
  assert.equal(await armed(), "point");
});

test("Escape and a finished gesture both clear the pressed button", async () => {
  await app.page.click('#toolbar button[data-tool="rectangle"]');
  assert.deepEqual(await pressed(), ["rectangle"]);
  await app.page.keyboard.press("Escape");
  await app.page.waitForTimeout(50);
  assert.deepEqual(await pressed(), [], "Escape disarms, and the button lets go");

  await app.page.click('#toolbar button[data-tool="point"]');
  assert.deepEqual(await pressed(), ["point"]);
  const at = await app.at(700, 200);
  await app.page.mouse.click(at.x, at.y);
  await app.page.waitForTimeout(80);
  assert.equal(await armed(), null, "the point tool finishes on its click");
  assert.deepEqual(await pressed(), [], "and its button lets go with it");
});

test("a tool defined at the command line gets a button, which arms it", async () => {
  const before = await rectOf(panel("toolbar"));
  await app.type('defineTool("stamp", class extends Tool { name = "stamp"; onDown(p) { pt(p.world[0], p.world[1]); this.ctx.finish(); } })');
  const names = await app.page.$$eval("#toolbar button", (els) => els.map((el) => (el as HTMLElement).dataset.tool));
  assert.equal(names[names.length - 1], "stamp", `a button for the new tool: ${names.join(" ")}`);
  // It has no icon of its own, and none is guessed: the generic glyph, a
  // square carrying the first two letters of its name.
  const look = await app.page.$eval('#toolbar button[data-tool="stamp"]', (el) => ({
    glyph: el.querySelector(":scope > svg")?.getAttribute("data-glyph"),
    letters: el.querySelector(":scope > svg text")?.textContent,
    hint: el.getAttribute("title"),
  }));
  assert.deepEqual(look, { glyph: "generic", letters: "st", hint: 'stamp — arm("stamp")' });

  // An untouched toolbar grows to hold it, rather than hiding it below the fold.
  const after = await rectOf(panel("toolbar"));
  const last = await rectOf('#toolbar button[data-tool="stamp"]');
  assert.ok(after.height > before.height, "the toolbar grew");
  assert.ok(last.y + last.height <= after.y + after.height, "and the new button is inside it, visible");

  await app.page.click('#toolbar button[data-tool="stamp"]');
  assert.equal(await armed(), "stamp");
  assert.ok((await app.log()).includes('> arm("stamp")'));
  await shot("generic-glyph-armed");
  await app.page.keyboard.press("Escape");
});

// --- gestures never cross ------------------------------------------------------

test("dragging a panel across the drawing does nothing to the drawing, even with a tool armed", async () => {
  await app.page.click('#toolbar button[data-tool="point"]');
  await app.page.fill("#cmd", "");
  const m0 = await app.model();
  const start = await rectOf(panel("toolbar"));

  // From the strip, out over the empty canvas, released there.
  await dragBy(strip("toolbar"), 400, 120);

  const moved = await rectOf(panel("toolbar"));
  assert.deepEqual([moved.x - start.x, moved.y - start.y], [400, 120], "the toolbar went where it was dragged");
  const m1 = await app.model();
  assert.equal(m1.size, m0.size, "no point was placed by the release over the canvas");
  assert.deepEqual(m1.view, m0.view, "nor was the view panned or turned");
  assert.equal(await armed(), "point", "the armed tool never saw the gesture");
  assert.equal(await cmd(), "", "nothing was picked or boxed into the command line");
  await app.page.keyboard.press("Escape");
});

test("a canvas drag released over a panel finishes on the canvas, and moves no panel", async () => {
  // The rectangle tool builds on release — so if the release went to the panel
  // instead of the canvas, there would be no rectangle and a tool left waiting.
  await app.page.click('#toolbar button[data-tool="rectangle"]');
  const logBox = await rectOf(panel("log"));
  const lines0 = (await app.model()).lines.length;

  const from = await app.at(300, 420);
  await app.page.mouse.move(from.x, from.y);
  await app.page.mouse.down();
  // Into the middle of the log panel, and released there.
  await app.page.mouse.move(logBox.x + 200, logBox.y + 60, { steps: 10 });
  await app.page.mouse.up();
  await app.page.waitForTimeout(150);

  assert.equal((await app.model()).lines.length, lines0 + 4, "the rectangle was built: the canvas got its release");
  assert.equal(await armed(), null, "and the tool finished");
  assert.deepEqual(await rectOf(panel("log")), logBox, "the log panel did not move");

  // An empty-canvas box that ends over the toolbar: closed, toolbar unmoved.
  const tb = await rectOf(panel("toolbar"));
  const a = await app.at(1000, 120);
  await app.page.mouse.move(a.x, a.y);
  await app.page.mouse.down();
  await app.page.mouse.move(tb.x + tb.width / 2, tb.y + 30, { steps: 10 });
  await app.page.mouse.up();
  await app.page.waitForTimeout(100);
  const boxOpen = await app.page.evaluate(() =>
    (window as never as { __neocad: { engine: { box: unknown } } }).__neocad.engine.box !== null);
  assert.equal(boxOpen, false, "the box closed on its release");
  assert.deepEqual(await rectOf(panel("toolbar")), tb, "the toolbar did not move");
  await app.page.fill("#cmd", "");
});

test("typing after a press on the canvas still types into the command line", async () => {
  const at = await app.at(900, 300);
  await app.page.mouse.click(at.x, at.y);
  assert.notEqual(await app.page.evaluate(() => document.activeElement?.id), "cmd", "the canvas press took the focus away");
  await app.page.keyboard.type("ls()");
  assert.equal(await cmd(), "ls()", "and the keystrokes found the command line anyway");
  await app.page.fill("#cmd", "");
});

// --- resize, persistence, reset ----------------------------------------------

test("a panel resizes by its bottom-right grip, no smaller than its minimum", async () => {
  const before = await rectOf(panel("log"));
  await dragBy(grip("log"), 120, -70);
  const after = await rectOf(panel("log"));
  assert.deepEqual([after.x, after.y], [before.x, before.y], "resizing does not move it");
  assert.deepEqual([after.width - before.width, after.height - before.height], [120, -70]);

  // Far past the minimum: it stops there.
  await dragBy(grip("log"), -2000, -2000);
  const tiny = await rectOf(panel("log"));
  assert.ok(tiny.width >= 160 && tiny.height >= 46, `clamped at the minimum: ${JSON.stringify(tiny)}`);
  await dragBy(grip("log"), 300, 150); // and back to something usable
});

test("a panel cannot be dragged off an edge by a single pixel", async () => {
  // From the defaults, with the toolbar parked on the right first: a panel now
  // pushes what it meets, and this is about the window's edge alone, so the
  // two drags below are given clear paths — the log's to the top-left corner,
  // the command line's to the bottom-right.
  await app.type('layout("reset")');
  const cv = await rectOf("#cv");
  await dragBy(strip("toolbar"), 900, 100);
  const s0 = await rectOf(panel("cmd"));
  // The pointer stays in the window, so every move is one the page is sent;
  // the panel is pushed far past each edge all the same.
  await dragBy(strip("cmd"), 700, cv.y + cv.height - 2 - (s0.y + 8));
  const s = await rectOf(panel("cmd"));
  assert.notDeepEqual(s, s0, "it moved");
  assert.deepEqual([s.x + s.width, s.y + s.height], [cv.x + cv.width, cv.y + cv.height], "flush with the bottom-right");
  const st = await rectOf(strip("log"));
  await dragBy(strip("log"), 2 - (st.x + st.width / 2), 2 - (st.y + st.height / 2));
  const t = await rectOf(panel("log"));
  assert.deepEqual([t.x, t.y], [cv.x, cv.y], "flush with the top-left — the header is not covered");
});

test("the arrangement survives a reload, and layout(\"reset\") forgets it", async () => {
  // A reload first: it drops the tool defined above, and the default toolbar is
  // sized to the tools there are, so the defaults are measured without it.
  await reloadApp();
  await app.type('layout("reset")');
  const defaults = Object.fromEntries(await Promise.all(["toolbar", "log", "cmd"].map(async (id) => [id, await rectOf(panel(id))])));

  await dragBy(strip("toolbar"), 600, 40);
  await dragBy(strip("log"), 300, -200);
  await dragBy(grip("log"), 80, 60);
  const arranged = { toolbar: await rectOf(panel("toolbar")), log: await rectOf(panel("log")) };
  assert.notDeepEqual(arranged.toolbar, defaults.toolbar);

  await reloadApp();
  assert.deepEqual(await rectOf(panel("toolbar")), arranged.toolbar, "the toolbar is where it was left");
  assert.deepEqual(await rectOf(panel("log")), arranged.log, "and the log, size included");
  assert.deepEqual(await rectOf(panel("cmd")), defaults.cmd, "an untouched panel is still at its default");

  const report = (await app.repl("layout()")).value as string;
  assert.match(report, /^toolbar .*$/m);
  assert.doesNotMatch(report.split("\n").find((l) => l.startsWith("toolbar"))!, /default/, "the moved one is not called default");
  assert.match(report.split("\n").find((l) => l.startsWith("cmd"))!, /\(default\)/);

  await app.type('layout("reset")');
  for (const id of ["toolbar", "log", "cmd"]) assert.deepEqual(await rectOf(panel(id)), defaults[id], `${id} is back`);
  await reloadApp();
  for (const id of ["toolbar", "log", "cmd"]) assert.deepEqual(await rectOf(panel(id)), defaults[id], `${id} stays back after a reload`);
});

test("layout is not the drawing's: no journal entry, nothing in the file, no undo step", async () => {
  await reloadApp(); // a fresh model, whatever the test above left
  await axisFrame(app, [150, 150]);
  await app.type("pt(10, 10)"); // something to undo, so "nothing to undo" cannot be the answer by accident
  const journal = (await app.model()).journalOps;
  const file = (await app.repl("save()")).value as string;

  await dragBy(strip("toolbar"), 50, 50);
  await app.type("layout()");
  await app.type('layout("reset")');

  assert.deepEqual((await app.model()).journalOps, journal, "the journal is untouched");
  assert.equal((await app.repl("save()")).value, file, "and the saved file is byte-for-byte what it was");
  const logBefore = await app.log();
  await app.page.fill("#cmd", "");
  await app.page.keyboard.press("Control+z");
  await app.page.waitForTimeout(80);
  assert.equal((await app.model()).byKind.point, 3, "the one Ctrl+Z took the point (leaving the frame's three), not a panel move");
  assert.ok((await app.log()).slice(logBefore.length).includes("undid"));
});

test("a typo'd layout command says what it takes", async () => {
  const r = await app.repl('layout("rest")');
  assert.equal(r.ok, false);
  assert.match(r.error ?? "", /layout\(\) reports and layout\("reset"\) restores/);
});

// --- the tray turns with the edge it meets -------------------------------------

/** The toolbar's rectangle relative to the canvas, and which way it runs. */
async function tray(): Promise<{ x: number; y: number; w: number; h: number; orient: string | undefined; rows: number }> {
  const cv = await rectOf("#cv");
  const r = await rectOf(panel("toolbar"));
  const orient = await app.page.$eval(panel("toolbar"), (el) => (el as HTMLElement).dataset.orient);
  // How many distinct lines the buttons sit on: one, for a row.
  const rows = await app.page.$$eval("#toolbar button", (els) => new Set(els.map((el) => Math.round(el.getBoundingClientRect().y))).size);
  return { x: r.x - cv.x, y: r.y - cv.y, w: r.width, h: r.height, orient, rows };
}

const TOOLS = 11; // the built-ins, after the reload that dropped "stamp"
const RUN = 16 + 6 + TOOLS * 22; // strip, padding, a 22px step per button
const DEPTH = 28; // one button thick

test("dragged past the right edge, the tray stops flush inside it, still a column", async () => {
  await reloadApp();
  await app.type('layout("reset")');
  const cv = await rectOf("#cv");
  assert.deepEqual(await tray(), { x: 8, y: 8, w: DEPTH, h: RUN, orient: "column", rows: TOOLS }, "the default: a column");
  await dragBy(strip("toolbar"), 3000, 100);
  const t = await tray();
  assert.equal(t.x + t.w, cv.width, "flush with the right edge, not a pixel past");
  assert.equal(t.orient, "column", "a side edge makes a column, which it already was");
  assert.equal(t.y, 108, "and nothing else about it changed");
});

test("pushed against the top edge it turns into a row — live, before the release — flush with the top", async () => {
  const r = await rectOf(strip("toolbar"));
  const [x, y] = [r.x + r.width / 2, r.y + r.height / 2];
  await app.page.mouse.move(x, y);
  await app.page.mouse.down();
  await app.page.mouse.move(x - 400, y - 1000, { steps: 8 });
  const during = await tray();
  assert.equal(during.orient, "row", "turned while still held");
  await shot("turning-held");
  await app.page.mouse.up();
  await app.page.waitForTimeout(80);
  const t = await tray();
  assert.equal(t.orient, "row");
  assert.equal(t.y, 0, "flush with the top");
  assert.deepEqual([t.w, t.h], [RUN, DEPTH], "one button high and as long as its buttons");
  assert.equal(t.rows, 1, "every button on one line");
  await shot("row-at-top");
});

test("pushed against the left edge it is a column again", async () => {
  await dragBy(strip("toolbar"), -3000, 200);
  const t = await tray();
  assert.equal(t.orient, "column");
  assert.equal(t.x, 0, "flush with the left");
  assert.deepEqual([t.w, t.h], [DEPTH, RUN]);
  assert.equal(t.rows, TOOLS, "one button per line");
});

test("pushed up against another panel's top edge it turns into a row, still against it", async () => {
  const cv = await rectOf("#cv");
  const log = await rectOf(panel("log"));
  const t0 = await tray();
  // Clear of the left edge, its bottom 2px short of the log's top, in one move
  // so the turn happens exactly there.
  const [tx, ty] = [log.x - cv.x + 100, log.y - cv.y - 2 - t0.h];
  await dragBy(strip("toolbar"), tx - t0.x, ty - t0.y, 1);
  const t = await tray();
  assert.equal(t.orient, "row");
  assert.equal(t.y + t.h, log.y - cv.y - 2, "its bottom held where it met the log, not where the column's top was");
  assert.equal(t.x, tx);
  await shot("row-on-the-log");
});

test("a reload keeps the way it runs", async () => {
  const before = await tray();
  await reloadApp();
  assert.deepEqual(await tray(), before);
  assert.match((await app.repl("layout()")).value as string, /^toolbar .* row$/m, "and layout() says so");
});

test("pushed against another panel's right edge it turns into a column", async () => {
  const cv = await rectOf("#cv");
  const log = await rectOf(panel("log"));
  const t0 = await tray();
  // Its left end 2px off the log's right edge, level with the log's middle.
  const [tx, ty] = [log.x + log.width - cv.x + 2, log.y - cv.y + 40];
  await dragBy(strip("toolbar"), tx - t0.x, ty - t0.y, 1);
  const t = await tray();
  assert.equal(t.orient, "column");
  assert.equal(t.x, tx, "its left edge held against the log's right");
  assert.ok(t.y + t.h <= cv.height, "and the taller shape held inside the area");
  await shot("column-by-the-log");
});

test("layout(\"reset\") puts back the column", async () => {
  await dragBy(strip("toolbar"), -200, -3000); // a row along the top again, first
  assert.equal((await tray()).orient, "row");
  await app.type('layout("reset")');
  assert.deepEqual(await tray(), { x: 8, y: 8, w: DEPTH, h: RUN, orient: "column", rows: TOOLS });
  await reloadApp();
  assert.equal((await tray()).orient, "column", "and it stays reset");
});

test("the log and the command line keep their shape against any edge", async () => {
  const log0 = await rectOf(panel("log"));
  await dragBy(strip("log"), 0, -3000);
  const log = await rectOf(panel("log"));
  assert.deepEqual([log.width, log.height], [log0.width, log0.height]);
  assert.equal(await app.page.$eval(panel("log"), (el) => (el as HTMLElement).dataset.orient ?? null), null);
  await app.type('layout("reset")');
});

test("storage that throws costs the arrangement and nothing else", async () => {
  // A second app, whose page throws on every touch of localStorage — what a
  // private window or a sandboxed frame does — from before the app's first line.
  const other = await openApp();
  try {
    await other.page.addInitScript(() => {
      Object.defineProperty(window, "localStorage", { get() { throw new DOMException("denied", "SecurityError"); } });
    });
    await other.page.reload({ waitUntil: "networkidle" });
    await other.page.waitForFunction(() => document.getElementById("status")?.textContent?.includes("ready"));
    assert.ok(await other.page.evaluate(() => { try { void localStorage; return false; } catch { return true; } }),
      "the storage really does throw");

    const tb = await other.page.$eval('.panel[data-panel="toolbar"] > .ptitle', (el) => {
      const r = el.getBoundingClientRect();
      return { x: r.x + r.width / 2, y: r.y + r.height / 2 };
    });
    await other.page.mouse.move(tb.x, tb.y);
    await other.page.mouse.down();
    await other.page.mouse.move(tb.x + 200, tb.y + 100, { steps: 5 });
    await other.page.mouse.up();
    const left = await other.page.$eval('.panel[data-panel="toolbar"]', (el) => el.getBoundingClientRect().x);
    assert.equal(left, 8 + 200, "the panel still drags");
    await other.type('layout("reset")');
    await other.type('arm("line")');
    assert.ok((await other.log()).includes("armed: line"), "and the app carries on");
    assert.deepEqual(other.pageErrors, [], "with nothing thrown at the page");
  } finally {
    await other.close();
  }
});

// --- no tool is greyed ----------------------------------------------------------
//
// The curve tools used to be greyed in a 3D model with no default frame, with
// the model's "no default frame" as their hover text. They make their plane at
// the click now (docs/plans/no-refusals.md), so the rule answers "never" and
// nothing greys — the machinery stays, wired to `toolUnavailable`, for a tool
// that one day genuinely cannot run.

const CURVES = ["circle", "circle3", "arc", "arc3", "fillet"];

/** Each button's tool, whether it is disabled, and its hover text. */
const buttonStates = () => app.page.$$eval("#toolbar button", (els) =>
  els.map((el) => ({ tool: (el as HTMLElement).dataset.tool!, off: (el as HTMLButtonElement).disabled, title: el.getAttribute("title") })));

const disabledTools = async () => (await buttonStates()).filter((b) => b.off).map((b) => b.tool);

test("in a fresh 3D app no button is greyed: the curve tools are there, enabled, their hover the command they type", async () => {
  await reloadApp(); // a fresh model: 3D, and no frame at all
  assert.equal((await app.model()).size, 0);
  const states = await buttonStates();
  for (const c of CURVES) assert.ok(states.some((b) => b.tool === c), `${c} is on the toolbar`);
  for (const b of states) {
    assert.ok(!b.off, `${b.tool} is enabled`);
    assert.equal(b.title, `${b.tool} — arm("${b.tool}")`);
  }
  await shot("curves-enabled");
});

test("a real click on the circle button in a frameless model arms it, as any other button does", async () => {
  const b = await rectOf('#toolbar button[data-tool="circle"]');
  await app.page.mouse.click(b.x + b.width / 2, b.y + b.height / 2);
  await app.page.waitForTimeout(80);
  assert.equal(await armed(), "circle");
  assert.deepEqual(await pressed(), ["circle"]);
  assert.match(await app.log(), /armed: circle/);
  await app.page.keyboard.press("Escape");
});

test("the context menu greys no tool either", async () => {
  const at = await app.at(700, 300);
  await app.page.mouse.click(at.x, at.y, { button: "right" });
  await app.page.waitForTimeout(120);
  // Undo and Redo carry their own reasons, about the history; no tool has one.
  const why = (await app.page.$$eval("#ctxmenu .why", (els) => els.map((el) => el.textContent)))
    .filter((t) => !/^nothing to (undo|redo)$/.test(t ?? ""));
  await app.page.keyboard.press("Escape");
  assert.deepEqual(why, []);
});

test("a default frame coming and going changes nothing on the toolbar; an armed arc stays armed and amber", async () => {
  await app.type("setDefaultFrame(frame())");
  assert.deepEqual(await disabledTools(), []);
  await app.type('arm("arc")');
  assert.deepEqual(await pressed(), ["arc"]);
  const f = (await app.repl("defaultFrame()")).value as string;
  await app.type(`del(${JSON.stringify(f)})`);
  assert.equal((await app.repl("defaultFrame()")).value, null);
  assert.equal(await armed(), "arc", "still armed: its next click makes the plane");
  assert.deepEqual(await disabledTools(), []);
  const look = await app.page.$eval('#toolbar button[data-tool="arc"]', (el) => getComputedStyle(el).borderColor);
  assert.match(look, /232, 163, 61/, "the armed amber edge");
  await app.page.keyboard.press("Escape");
});

/** The colour a button's glyph is actually drawn in: its strokes', or its dot's fill. */
const glyphColour = (tool: string) => app.page.$eval(`#toolbar button[data-tool="${tool}"] svg > *`, (el) => {
  const cs = getComputedStyle(el);
  return cs.stroke !== "none" ? cs.stroke : cs.fill;
});

test("the glyph is the button's colour: amber when armed, the label colour otherwise — a curve tool included", async () => {
  await app.type('arm("line")');
  assert.equal(await glyphColour("line"), "rgb(232, 163, 61)", "the armed glyph is the amber");
  assert.equal(await glyphColour("circle"), "rgb(175, 198, 217)", "a curve tool's idle glyph, with no frame, is the label colour");
  assert.equal(await glyphColour("point"), "rgb(175, 198, 217)", "an idle one is the label colour it replaced");
  await shot("armed-and-idle");
  await app.page.keyboard.press("Escape");
});

// --- panels push one another, and the grasp point stays the same ---------------

const IDS = ["toolbar", "log", "cmd"];

/** Every panel's rectangle relative to the canvas. */
async function panelsNow(): Promise<Record<string, Box>> {
  const cv = await rectOf("#cv");
  const out: Record<string, Box> = {};
  for (const id of IDS) {
    const r = await rectOf(panel(id));
    out[id] = { x: r.x - cv.x, y: r.y - cv.y, width: r.width, height: r.height };
  }
  return out;
}

/** No two panels share any area, and every one is wholly on the canvas. */
async function assertSound(what: string): Promise<void> {
  const cv = await rectOf("#cv");
  const l = await panelsNow();
  for (const id of IDS) {
    const r = l[id];
    assert.ok(r.x >= 0 && r.y >= 0 && r.x + r.width <= cv.width && r.y + r.height <= cv.height,
      `${what}: ${id} is wholly inside: ${JSON.stringify(r)}`);
  }
  for (let i = 0; i < IDS.length; i++) {
    for (let j = i + 1; j < IDS.length; j++) {
      const [a, b] = [l[IDS[i]], l[IDS[j]]];
      const ox = Math.min(a.x + a.width, b.x + b.width) - Math.max(a.x, b.x);
      const oy = Math.min(a.y + a.height, b.y + b.height) - Math.max(a.y, b.y);
      assert.ok(ox <= 0 || oy <= 0, `${what}: ${IDS[i]} and ${IDS[j]} overlap: ${JSON.stringify(l)}`);
    }
  }
}

test("the tray pushes the log, the log the command line, and at the bottom edge the tray stops flush — and waits for the hand", async () => {
  await reloadApp();
  await app.type('layout("reset")');
  const cv = await rectOf("#cv");
  // The log up out of the way first, so there is a push worth watching.
  await dragBy(strip("log"), 0, -250);
  const l0 = await panelsNow();
  assert.ok(l0.log.y > l0.toolbar.y + l0.toolbar.height + 20, "room between the tray and the log");

  const s = await rectOf(strip("toolbar"));
  let [x, y] = [s.x + s.width / 2, s.y + s.height / 2];
  await app.page.mouse.move(x, y);
  await app.page.mouse.down();
  // Down in 10 px steps, far further than there is room for.
  const travel = cv.height;
  for (let d = 0; d < travel; d += 10) await app.page.mouse.move(x, (y += 10));
  const held = await panelsNow();
  assert.ok(held.log.y > l0.log.y, `the log was pushed down: ${l0.log.y} → ${held.log.y}`);
  assert.equal(held.cmd.y + held.cmd.height, cv.height, "the command line, pushed by the log, is on the bottom edge");
  assert.equal(held.log.y + held.log.height, held.cmd.y, "the log flush on it");
  assert.equal(held.toolbar.y + held.toolbar.height, held.log.y, "and the tray stopped flush on the log — not short, not over it");
  await shot("pushed-chain-held");

  // The grasp point stays the same, measured. The tray turned into a row on
  // the log on the way down, and the hand holds the same point of it: the
  // middle of its strip, as it held the middle of the column's. Stopped, the
  // tray is left behind by `lead`; a step back of less than that moves nothing,
  // a step back of exactly that has the hand on the middle of the strip again,
  // and past that the tray follows, pixel for pixel.
  const middle = async () => { const r = await rectOf(strip("toolbar")); return { x: r.x + r.width / 2, y: r.y + r.height / 2 }; };
  assert.equal((await tray()).orient, "row", "a row against the log's top");
  const m0 = await middle();
  assert.equal(m0.x, x, "under the hand across the push");
  const lead = y - m0.y;
  assert.ok(lead > 100, `the pointer went on far past the tray: ${lead}px`);
  await app.page.mouse.move(x, (y -= 10));
  assert.equal((await panelsNow()).toolbar.y, held.toolbar.y, "ten pixels back of that: not a pixel moved");
  await app.page.mouse.move(x, (y -= lead - 11));
  assert.equal((await panelsNow()).toolbar.y, held.toolbar.y, "a pixel short of it: still not");
  await app.page.mouse.move(x, (y -= 1));
  assert.equal((await panelsNow()).toolbar.y, held.toolbar.y, "back by exactly the lead: where it stopped…");
  assert.deepEqual(await middle(), { x, y }, "…and under the hand where it was grabbed");
  await app.page.mouse.move(x, (y -= 10));
  assert.equal((await panelsNow()).toolbar.y, held.toolbar.y - 10, "ten pixels past it, ten pixels up");
  assert.deepEqual(await middle(), { x, y }, "still under the hand");
  await shot("pushed-chain-back-under-hand");
  await app.page.mouse.up();
  await app.page.waitForTimeout(80);

  const after = await panelsNow();
  assert.deepEqual([after.log, after.cmd], [held.log, held.cmd], "nothing springs back: the pushed panels stay where they were pushed");
  await assertSound("after the push");
  await shot("pushed-chain-released");
});

test("the log dragged into the command line pushes it, as far as the bottom edge", async () => {
  await app.type('layout("reset")');
  const cv = await rectOf("#cv");
  const l0 = await panelsNow();
  await dragBy(strip("log"), 0, 100);
  const l = await panelsNow();
  assert.ok(l.cmd.y > l0.cmd.y, "the command line moved");
  assert.equal(l.cmd.y + l.cmd.height, cv.height, "as far as the bottom edge");
  assert.equal(l.log.y + l.log.height, l.cmd.y, "and the log is flush on it");
  assert.equal(l.log.y - l0.log.y, (l0.cmd.y - l0.log.y - l0.log.height) + (cv.height - l0.cmd.y - l0.cmd.height),
    "the log moved by the gap and the command line's room, exactly");
  assert.deepEqual([l.log.x, l.cmd.x], [l0.log.x, l0.cmd.x], "pushed down, and not a pixel sideways");
  await assertSound("log into command line");
});

test("resizing the log into the command line pushes it, and the grip stops at the edge", async () => {
  await app.type('layout("reset")');
  const cv = await rectOf("#cv");
  const l0 = await panelsNow();
  await dragBy(grip("log"), 0, 100);
  const l = await panelsNow();
  assert.equal(l.cmd.y + l.cmd.height, cv.height, "the command line pushed to the bottom edge");
  assert.equal(l.log.y, l0.log.y, "the log's top stayed");
  assert.equal(l.log.y + l.log.height, l.cmd.y, "and it grew flush onto the command line, no further");
  await assertSound("resized into the command line");
  await shot("resized-into-cmd");
});

test("a reload keeps the pushed positions, and layout(\"reset\") puts everything back", async () => {
  const pushedNow = await panelsNow();
  await reloadApp();
  assert.deepEqual(await panelsNow(), pushedNow, "the pushed command line is stored like a dragged one");
  assert.doesNotMatch((await app.repl("layout()")).value as string, /^cmd .*\(default\)$/m, "and is not called default");
  await app.type('layout("reset")');
  const d = await panelsNow();
  assert.equal(d.cmd.y + d.cmd.height, (await rectOf("#cv")).height - 8, "the command line back a margin off the bottom");
  assert.equal(d.log.y + d.log.height + 4, d.cmd.y, "and the log back above it");
});

test("a stored layout from before panels pushed comes up with nothing overlapping", async () => {
  // An arrangement the old rules allowed: the log dropped over the command line
  // and the toolbar over the log.
  await app.page.evaluate(() => localStorage.setItem("neocad.panels.v2", JSON.stringify({
    toolbar: { x: 40, y: 500, w: 28, h: 264, orient: "column" },
    log: { x: 20, y: 560, w: 560, h: 150 },
    cmd: { x: 100, y: 600, w: 560, h: 44 },
  })));
  await reloadApp();
  await assertSound("on load");
  await app.type('layout("reset")');
});

test("after a scripted run of random drags, no two panels overlap", async () => {
  await app.type('layout("reset")');
  let seed = 5;
  const rand = () => ((seed = (seed * 1103515245 + 12345) % 2147483648) / 2147483648);
  for (let i = 0; i < 30; i++) {
    const id = IDS[Math.floor(rand() * IDS.length)];
    // A strip, or any of the four grips.
    const by = rand() < 0.6 ? strip(id) : grip(id, CORNERS[Math.floor(rand() * 4)]);
    await dragBy(by, Math.round((rand() - 0.5) * 900), Math.round((rand() - 0.5) * 700), 4 + Math.floor(rand() * 8));
    await assertSound(`drag ${i} (${by})`);
    // No panel below its minimum, and the tray wrapped whole whatever was done to it.
    const l = await panelsNow();
    assert.ok(l.log.width >= 160 && l.log.height >= 46 && l.cmd.width >= 160 && l.cmd.height >= 44, `drag ${i}: ${JSON.stringify(l)}`);
    assert.ok(Math.min(l.toolbar.width, l.toolbar.height) >= DEPTH && Math.max(l.toolbar.width, l.toolbar.height) >= 16 + 6 + 22, `drag ${i}: the tray ${JSON.stringify(l.toolbar)}`);
    const g = await buttonGrid();
    assert.ok(g.whole && !g.scrolls, `drag ${i} (${by}): every button shown, nothing to scroll`);
  }
  await shot("after-random-drags");
  await app.type('layout("reset")');
});

// --- any corner, and a tray that wraps ------------------------------------------

/** `corner` of a box. */
const at = (b: Box, c: Corner) => ({ x: c.endsWith("w") ? b.x : b.x + b.width, y: c.startsWith("n") ? b.y : b.y + b.height });
const opposite = (c: Corner): Corner => (({ nw: "se", ne: "sw", sw: "ne", se: "nw" }) as const)[c];

/**
 * The tray's buttons, where they are: each one's column and row as the
 * distinct x and y positions it sits on, and whether every button lies wholly
 * inside the tray's body with nothing to scroll.
 */
async function buttonGrid(): Promise<{ xs: number[]; ys: number[]; at: [number, number][]; whole: boolean; scrolls: boolean; overflow: string }> {
  return app.page.$eval("#toolbar", (body) => {
    const box = body.getBoundingClientRect();
    const rects = Array.from(body.querySelectorAll("button")).map((b) => b.getBoundingClientRect());
    const xs = [...new Set(rects.map((r) => Math.round(r.x)))].sort((a, b) => a - b);
    const ys = [...new Set(rects.map((r) => Math.round(r.y)))].sort((a, b) => a - b);
    return {
      xs, ys,
      at: rects.map((r) => [xs.indexOf(Math.round(r.x)), ys.indexOf(Math.round(r.y))] as [number, number]),
      whole: rects.every((r) => r.x >= box.x && r.y >= box.y && r.x + r.width <= box.x + box.width && r.y + r.height <= box.y + box.height),
      scrolls: body.scrollHeight > body.clientHeight || body.scrollWidth > body.clientWidth,
      overflow: getComputedStyle(body).overflow,
    };
  });
}

test("the log resizes from each of its four corners, and the opposite corner does not move", async () => {
  await reloadApp();
  await app.type('layout("reset")');
  // Up into the open first, so that every corner has room to grow into.
  await dragBy(strip("log"), 300, -250);
  for (const c of CORNERS) {
    const before = await rectOf(panel("log"));
    const [sx, sy] = [c.endsWith("w") ? -1 : 1, c.startsWith("n") ? -1 : 1];
    await dragBy(grip("log", c), 40 * sx, 30 * sy);
    const after = await rectOf(panel("log"));
    assert.deepEqual(at(after, opposite(c)), at(before, opposite(c)), `${c}: the opposite corner did not move`);
    assert.deepEqual([after.width - before.width, after.height - before.height], [40, 30], `${c}: grown by the hand's travel`);
    assert.deepEqual(at(after, c), { x: at(before, c).x + 40 * sx, y: at(before, c).y + 30 * sy }, `${c}: its corner went with the hand`);
    // And shrunk again from the same corner, the opposite one still put.
    await dragBy(grip("log", c), -40 * sx, -30 * sy);
    assert.deepEqual(await rectOf(panel("log")), before, `${c}: and back`);
  }
  // Each grip carries the cursor of its own diagonal.
  const cursors = await app.page.$$eval(`${panel("log")} > .pgrip`, (els) =>
    els.map((el) => [(el as HTMLElement).dataset.corner, getComputedStyle(el).cursor]));
  assert.deepEqual(Object.fromEntries(cursors), { nw: "nwse-resize", ne: "nesw-resize", sw: "nesw-resize", se: "nwse-resize" });
  await shot("log-from-corners");
  await assertSound("after resizing from every corner");
});

test("a column made shorter from its bottom-right corner wraps into a second column, with no scrollbar", async () => {
  await app.type('layout("reset")');
  const t0 = await tray();
  assert.equal(t0.rows, TOOLS, "one button a line to start with");
  // 60px shorter: room for eight to a column, so the last three go to a second.
  await dragBy(grip("toolbar", "se"), 0, -60);
  const t = await tray();
  assert.equal(t.orient, "column", "a resize never turns it");
  assert.deepEqual([t.x, t.y, t.h], [t0.x, t0.y, t0.h - 60], "as short as the hand made it, its top-left where it was");
  assert.equal(t.w, DEPTH + 22, "and as wide as two columns of buttons, exactly");
  const g = await buttonGrid();
  assert.equal(g.xs.length, 2, `two columns: ${JSON.stringify(g.xs)}`);
  assert.equal(g.xs[1] - g.xs[0], 22, "a button's step apart");
  assert.deepEqual(g.at, Array.from({ length: TOOLS }, (_, i) => [i < 8 ? 0 : 1, i % 8]),
    "down the first column, then on down the second, in registration order");
  assert.ok(g.whole, "every button inside the tray");
  assert.equal(g.scrolls, false, "nothing to scroll");
  assert.equal(g.overflow, "hidden", "and no scrollbar to do it with");
  await shot("wrapped-column");
  // As short as it goes: one button to a column.
  await dragBy(grip("toolbar", "se"), 0, -2000);
  const least = await tray();
  assert.equal(least.h, 16 + 6 + 22, "one button long");
  assert.equal((await buttonGrid()).xs.length, TOOLS, "every button its own column");
  assert.ok((await buttonGrid()).whole);
  await assertSound("a tray wrapped as far as it goes");
});

test("a row made narrower from its right wraps into a second row", async () => {
  await app.type('layout("reset")');
  await dragBy(strip("toolbar"), 300, -3000); // a row along the top
  const t0 = await tray();
  assert.deepEqual([t0.orient, t0.w, t0.h], ["row", RUN, DEPTH]);
  // 100px narrower: six to a row, the last five on a second row.
  await dragBy(grip("toolbar", "se"), -100, 0);
  const t = await tray();
  assert.equal(t.orient, "row");
  assert.deepEqual([t.x, t.y, t.w], [t0.x, t0.y, t0.w - 100], "as narrow as the hand made it, the top-left where it was");
  assert.equal(t.h, DEPTH + 22, "and two rows deep");
  const g = await buttonGrid();
  assert.equal(g.ys.length, 2, `two rows: ${JSON.stringify(g.ys)}`);
  assert.deepEqual(g.at, Array.from({ length: TOOLS }, (_, i) => [i % 6, i < 6 ? 0 : 1]), "along the first row, then the second");
  assert.ok(g.whole);
  assert.equal(g.scrolls, false);
  await shot("wrapped-row");
});

test("a wrapped tray turns into one line the other way", async () => {
  // The two-row row above, dragged against the left edge.
  await dragBy(strip("toolbar"), -3000, 200);
  const t = await tray();
  assert.equal(t.orient, "column");
  assert.deepEqual([t.w, t.h], [DEPTH, RUN], "one column, as long as its buttons");
  assert.equal(t.rows, TOOLS, "one button a line");
  assert.equal((await buttonGrid()).xs.length, 1);
  // And a wrapped column turned against the top comes up one row.
  await dragBy(grip("toolbar", "se"), 0, -100);
  assert.equal((await buttonGrid()).xs.length, 2, "wrapped again first");
  await dragBy(strip("toolbar"), 300, -3000);
  const r = await tray();
  assert.deepEqual([r.orient, r.w, r.h, r.rows], ["row", RUN, DEPTH, 1]);
  await assertSound("after turning a wrapped tray");
});

test("a tool defined at the command line takes its place in the wrap: every button shown, no scrollbar", async () => {
  await app.type('layout("reset")');
  // Four to a column: 4, 4 and 3.
  await dragBy(grip("toolbar", "se"), 0, -(RUN - (16 + 6 + 4 * 22) - 4));
  assert.equal((await buttonGrid()).xs.length, 3);
  const w0 = (await tray()).w;
  await app.type('defineTool("ink", class extends Tool { name = "ink"; onDown() { this.ctx.finish(); } })');
  let g = await buttonGrid();
  assert.deepEqual(g.at[TOOLS], [2, 3], "the new button fills the third column's last place");
  assert.equal((await tray()).w, w0, "which needed no more room");
  await app.type('defineTool("dab", class extends Tool { name = "dab"; onDown() { this.ctx.finish(); } })');
  g = await buttonGrid();
  assert.equal(g.xs.length, 4, "the next one wraps into a fourth column");
  assert.equal((await tray()).w, w0 + 22, "and the tray widens to hold it");
  assert.ok(g.whole, "every button inside the tray");
  assert.equal(g.scrolls, false, "nothing to scroll");
  const look = await app.page.$eval('#toolbar button[data-tool="dab"]', (el) => el.querySelector(":scope > svg")?.getAttribute("data-glyph"));
  assert.equal(look, "generic");
  await shot("wrapped-with-new-tools");
  await assertSound("after the tray widened for a tool");
  await reloadApp(); // drops ink and dab: the tests below count the built-ins
  assert.equal((await buttonGrid()).whole, true, "and on reload, the stored size wraps the same way");
  await app.type('layout("reset")');
});

test("no uncaught page errors", () => {
  assert.deepEqual(app.pageErrors, []);
});
