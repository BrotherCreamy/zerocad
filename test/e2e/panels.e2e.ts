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
// pushed. Set NEOCAD_E2E_SHOTS to a directory to keep pictures of it at its own
// size — and look at them.

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
const grip = (id: string) => `${panel(id)} > .pgrip`;

/** Presses at the middle of `selector`'s element, moves by (dx, dy) in steps, releases. */
async function dragBy(selector: string, dx: number, dy: number, steps = 8): Promise<void> {
  const r = await rectOf(selector);
  const [x, y] = [r.x + r.width / 2, r.y + r.height / 2];
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

test("a panel resizes by its corner grip, no smaller than its minimum", async () => {
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
  // The test above left the log grown over the command line's strip; a press
  // there would take the log, and the command line would pass this by never
  // moving at all (the old version of this test did exactly that).
  await app.type('layout("reset")');
  const cv = await rectOf("#cv");
  const s0 = await rectOf(panel("cmd"));
  // Flush with the bottom-right corner, then the top-left: every pixel inside.
  // The pointer stays in the window, so every move is one the page is sent;
  // the panel is pushed far past each edge all the same.
  await dragBy(strip("cmd"), 700, cv.y + cv.height - 2 - (s0.y + 8));
  const s = await rectOf(panel("cmd"));
  assert.notDeepEqual(s, s0, "it moved");
  assert.deepEqual([s.x + s.width, s.y + s.height], [cv.x + cv.width, cv.y + cv.height], "flush with the bottom-right");
  const st = await rectOf(strip("cmd"));
  await dragBy(strip("cmd"), 2 - (st.x + st.width / 2), 2 - (st.y + st.height / 2));
  const t = await rectOf(panel("cmd"));
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

// --- a tool that cannot run ----------------------------------------------------

const CURVES = ["circle", "circle3", "arc", "arc3", "fillet"];
const STANDING = "no default frame — frame() then setDefaultFrame(), or say which frame";

/** Each button's tool, whether it is disabled, and its hover text. */
const buttonStates = () => app.page.$$eval("#toolbar button", (els) =>
  els.map((el) => ({ tool: (el as HTMLElement).dataset.tool!, off: (el as HTMLButtonElement).disabled, title: el.getAttribute("title") })));

const disabledTools = async () => (await buttonStates()).filter((b) => b.off).map((b) => b.tool);

test("in a fresh 3D app the curve tools are greyed, with the model's reason as their hover text", async () => {
  await reloadApp(); // a fresh model: 3D, and no frame at all
  assert.equal((await app.model()).size, 0);
  const states = await buttonStates();
  for (const b of states) {
    if (CURVES.includes(b.tool)) {
      assert.ok(b.off, `${b.tool} is disabled`);
      assert.equal(b.title, `${b.tool} — ${STANDING}`, `${b.tool}'s hover is its name and the reason, not the command`);
    } else {
      assert.ok(!b.off, `${b.tool} is enabled`);
      assert.equal(b.title, `${b.tool} — arm("${b.tool}")`);
    }
  }
  assert.deepEqual(states.filter((b) => b.off).map((b) => b.tool), CURVES, "shown, not hidden: all five are still there");
  await shot("curves-disabled");
});

test("a disabled button arms nothing and logs nothing — a real click on it", async () => {
  const logBefore = await app.log();
  const b = await rectOf('#toolbar button[data-tool="circle"]');
  await app.page.mouse.click(b.x + b.width / 2, b.y + b.height / 2);
  await app.page.waitForTimeout(80);
  assert.equal(await armed(), null);
  assert.deepEqual((await app.log()).slice(logBefore.length), "", "not a line in the log");
  assert.deepEqual(await pressed(), []);
});

test("the context menu and the toolbar give the same reason", async () => {
  const at = await app.at(700, 300);
  await app.page.mouse.click(at.x, at.y, { button: "right" });
  await app.page.waitForTimeout(120);
  const why = await app.page.$$eval("#ctxmenu .why", (els) => els.map((el) => el.textContent));
  await app.page.keyboard.press("Escape");
  assert.equal(why.length, CURVES.length, "one reason per disabled menu item");
  // A button's hover leads with its name, the face being an icon; the reason after it is the menu's.
  const titles = (await buttonStates()).filter((b) => b.off).map((b) => b.title!.slice(`${b.tool} — `.length));
  assert.equal(titles.length, CURVES.length);
  for (const t of [...why, ...titles]) assert.equal(t, STANDING);
});

test("a default frame enables them on the next render, and deleting it disables them again", async () => {
  await app.type("setDefaultFrame(frame())");
  assert.deepEqual(await disabledTools(), [], "nothing but the command was needed");
  for (const b of await buttonStates()) assert.equal(b.title, `${b.tool} — arm("${b.tool}")`);

  await app.page.click('#toolbar button[data-tool="circle"]');
  assert.equal(await armed(), "circle", "and an enabled curve button arms as any other does");
  await app.page.keyboard.press("Escape");

  const f = (await app.repl("defaultFrame()")).value as string;
  await app.type(`del(${JSON.stringify(f)})`);
  assert.equal((await app.repl("defaultFrame()")).value, null);
  assert.deepEqual(await disabledTools(), CURVES);
});

test("an armed tool whose frame goes away is greyed, not amber — and arm() itself is unchanged", async () => {
  await app.type("setDefaultFrame(frame())");
  await app.type('arm("arc")');
  assert.deepEqual(await pressed(), ["arc"]);
  const f = (await app.repl("defaultFrame()")).value as string;
  await app.type(`del(${JSON.stringify(f)})`);
  // `arm` is untouched by this package: the tool stays armed and its click is
  // refused in the log, as typing arm("arc") with no frame always was.
  assert.equal(await armed(), "arc");
  const look = await app.page.$eval('#toolbar button[data-tool="arc"]', (el) => {
    const cs = getComputedStyle(el);
    return { off: (el as HTMLButtonElement).disabled, color: cs.color, border: cs.borderColor };
  });
  assert.ok(look.off);
  assert.equal(look.color, "rgb(70, 88, 106)", "the menu's .item.off grey, not the armed amber");
  assert.doesNotMatch(look.border, /232, 163, 61/, "and no amber edge");
  await app.page.keyboard.press("Escape");
});

/** The colour a button's glyph is actually drawn in: its strokes', or its dot's fill. */
const glyphColour = (tool: string) => app.page.$eval(`#toolbar button[data-tool="${tool}"] svg > *`, (el) => {
  const cs = getComputedStyle(el);
  return cs.stroke !== "none" ? cs.stroke : cs.fill;
});

test("the glyph is the button's colour: amber when armed, grey when it cannot run", async () => {
  // Still no default frame (the test above deleted it): the curves are disabled.
  await app.type('arm("line")');
  assert.equal(await glyphColour("line"), "rgb(232, 163, 61)", "the armed glyph is the amber");
  assert.equal(await glyphColour("circle"), "rgb(70, 88, 106)", "a disabled glyph is the menu's grey");
  assert.equal(await glyphColour("point"), "rgb(175, 198, 217)", "an idle one is the label colour it replaced");
  await shot("armed-and-disabled");
  await app.page.keyboard.press("Escape");
});

test("no uncaught page errors", () => {
  assert.deepEqual(app.pageErrors, []);
});
