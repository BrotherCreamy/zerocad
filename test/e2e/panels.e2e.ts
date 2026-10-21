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

import { test, before, after } from "node:test";
import assert from "node:assert/strict";
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
async function dragBy(selector: string, dx: number, dy: number): Promise<void> {
  const r = await rectOf(selector);
  const [x, y] = [r.x + r.width / 2, r.y + r.height / 2];
  await app.page.mouse.move(x, y);
  await app.page.mouse.down();
  await app.page.mouse.move(x + dx, y + dy, { steps: 8 });
  await app.page.mouse.up();
  await app.page.waitForTimeout(80);
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

test("the toolbar has a button per registered tool, labelled with its name", async () => {
  const tools = (await app.repl("tools()")).value as string[];
  const buttons = await app.page.$$eval("#toolbar button", (els) =>
    els.map((el) => ({ label: el.textContent, tool: (el as HTMLElement).dataset.tool, hint: el.getAttribute("title") })));
  assert.deepEqual(buttons.map((b) => b.tool), tools, "the registry, in its order");
  assert.ok(tools.includes("extrude") && tools.includes("revolve"), "the solid tools included");
  for (const b of buttons) {
    assert.equal(b.label, b.tool, "the label is what the command line calls it");
    assert.equal(b.hint, `arm("${b.tool}")`, "and the hover shows the command the button types");
  }
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
  const names = await app.page.$$eval("#toolbar button", (els) => els.map((el) => el.textContent));
  assert.equal(names[names.length - 1], "stamp", `a button for the new tool: ${names.join(" ")}`);

  // An untouched toolbar grows to hold it, rather than hiding it below the fold.
  const after = await rectOf(panel("toolbar"));
  const last = await rectOf('#toolbar button[data-tool="stamp"]');
  assert.ok(after.height > before.height, "the toolbar grew");
  assert.ok(last.y + last.height <= after.y + after.height, "and the new button is inside it, visible");

  await app.page.click('#toolbar button[data-tool="stamp"]');
  assert.equal(await armed(), "stamp");
  assert.ok((await app.log()).includes('> arm("stamp")'));
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

test("a panel cannot be dragged where its strip is out of reach", async () => {
  await dragBy(strip("cmd"), 3000, 3000);
  const cv = await rectOf("#cv");
  const s = await rectOf(strip("cmd"));
  assert.ok(s.y >= cv.y && s.y + s.height <= cv.y + cv.height, "its strip stays wholly inside top to bottom");
  assert.ok(s.x + 40 <= cv.x + cv.width + 0.5, "and at least 40px of it inside on the right");

  await dragBy(strip("cmd"), -6000, -6000);
  const t = await rectOf(strip("cmd"));
  assert.ok(t.y >= cv.y, "never above the canvas's top — the header is not covered");
  assert.ok(t.x + t.width >= cv.x + 40 - 0.5, "and at least 40px of it inside on the left");
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

test("no uncaught page errors", () => {
  assert.deepEqual(app.pageErrors, []);
});
