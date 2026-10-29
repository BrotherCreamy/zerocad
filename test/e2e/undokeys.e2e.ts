// Ctrl+Z and Ctrl+Y, wherever the focus is and whatever is on screen — the
// matrix docs/plans/undo-bulletproof.md asks for, each cell pressed with a real
// keyboard.
//
// The owner, 2026-10-29: "why does ctrl+z and ctrl+y not work? should work and
// be bulletproof". Measured then, the keys worked from most places and failed
// by design from one (text in the command box, which the old carve-out handed
// to the browser's text undo). So each cell below puts the page in one of the
// states a person can leave it in, presses the chord, and checks the drawing
// moved and nothing else did. undo.e2e.ts is the story of what one step *is*;
// this file is about the key reaching the step from everywhere.

import { test, before, after } from "node:test";
import assert from "node:assert/strict";
import { openApp, sketchFrame, type AppContext } from "./harness.ts";

let app: AppContext;
before(async () => {
  app = await openApp();
  // Typed through the REPL rather than the command line, so the fixture frame
  // is not itself a step and the stack starts empty — the empty-stack cell
  // below depends on that.
  await sketchFrame(app);
});
after(async () => { await app.close(); });

async function saved(): Promise<string> {
  const r = await app.repl("save()");
  assert.equal(r.ok, true, r.error ?? "");
  return r.value as string;
}

async function press(combo: string): Promise<void> {
  await app.page.keyboard.press(combo);
  await app.page.waitForTimeout(150);
}

const note = () => app.page.$eval("#stepnote", (el) => el.textContent ?? "");
const focused = () => app.page.evaluate(() => {
  const at = document.activeElement;
  return at === document.body ? "body" : at ? `${at.tagName.toLowerCase()}${at.id ? `#${at.id}` : ""}` : "none";
});
const menuOpen = () => app.page.$eval("#ctxmenu", (el) => !(el as HTMLElement).hidden);
const armed = () => app.page.evaluate(() =>
  (window as never as { __neocad: { engine: { active: { name: string } | null } } }).__neocad.engine.active?.name ?? null);
const lastLog = () => app.page.$eval("#log", (el) => el.lastElementChild?.textContent ?? "");

/**
 * One step on the stack, made the way a person makes one: a typed entry that
 * draws a point. Returns the state from before it, which an undo has to land
 * on exactly.
 */
async function oneStep(x: number, y: number): Promise<string> {
  const before = await saved();
  await app.type(`pt(${x}, ${y})`);
  assert.notEqual(await saved(), before, "the entry was a step");
  return before;
}

/** Canvas position of the point drawn last — the newest entry in the model's map. */
async function lastPointOnScreen(): Promise<[number, number]> {
  return app.page.evaluate(() => {
    const { model, engine } = (window as never as {
      __neocad: {
        model: { entities: Map<string, { kind: string }>; coords(x: string): number[] };
        engine: { worldToScreen(w: number[]): [number, number] };
      };
    }).__neocad;
    const name = [...model.entities.entries()].reverse().find(([, e]) => e.kind === "point")![0];
    return engine.worldToScreen(model.coords(name));
  });
}

async function rightClick(sx: number, sy: number): Promise<void> {
  const at = await app.at(sx, sy);
  await app.page.mouse.move(at.x, at.y);
  await app.page.mouse.down({ button: "right" });
  await app.page.mouse.up({ button: "right" });
  await app.page.waitForTimeout(120);
}

async function click(sx: number, sy: number): Promise<void> {
  const at = await app.at(sx, sy);
  await app.page.mouse.move(at.x, at.y);
  await app.page.mouse.down();
  await app.page.mouse.up();
  await app.page.waitForTimeout(150);
}

/** The menu's item rows, label → whether it can be chosen and the reason under it if not. */
async function menuItems(): Promise<{ label: string; off: boolean; why: string }[]> {
  return app.page.$$eval("#ctxmenu .item", (els) => els.map((el) => ({
    label: el.firstElementChild?.textContent ?? "",
    off: el.classList.contains("off"),
    why: el.classList.contains("off") ? el.parentElement?.querySelector(".why")?.textContent ?? "" : "",
  })));
}

async function choose(label: string): Promise<void> {
  const handle = await app.page.evaluateHandle((want) =>
    Array.from(document.querySelectorAll("#ctxmenu .item")).find((el) => el.firstElementChild?.textContent === want) ?? null, label);
  const el = handle.asElement();
  assert.ok(el, `no menu item ${label}`);
  await el.click();
  await app.page.waitForTimeout(200);
}

test("with nothing to undo, the chord says so — in the log and beside the verdict", async () => {
  const here = await saved();
  await press("Control+z");
  assert.equal(await saved(), here);
  assert.equal(await lastLog(), "nothing to undo");
  assert.equal(await note(), "nothing to undo", "the status readout answers, not only the log");
  assert.equal(await app.status(), "SOLVED", "...beside the verdict, which it does not replace");

  await press("Control+y");
  assert.equal(await lastLog(), "nothing to redo");
  assert.equal(await note(), "nothing to redo");

  // And the note goes again: it says what just happened, not what is.
  await app.page.waitForFunction(() => document.getElementById("stepnote")?.textContent === "", null, { timeout: 4000 });
});

test("the menu offers Undo and Redo at the bottom, disabled with the reason while the stack is empty", async () => {
  await rightClick(500, 160);
  assert.ok(await menuOpen());
  const rows = await menuItems();
  assert.deepEqual(rows.slice(-2).map((r) => r.label), ["Undo", "Redo"]);
  assert.deepEqual(rows.slice(-2), [
    { label: "Undo", off: true, why: "nothing to undo" },
    { label: "Redo", off: true, why: "nothing to redo" },
  ]);
  await press("Escape");
  assert.ok(!(await menuOpen()));
});

test("focus on the empty command line", async () => {
  const before = await oneStep(10, 20);
  await app.page.fill("#cmd", "");
  await app.page.focus("#cmd");
  await press("Control+z");
  assert.equal(await saved(), before);
  assert.equal(await note(), "undid");
  assert.match(await lastLog(), /^undid — /);
  await press("Control+y");
  assert.notEqual(await saved(), before, "and redo, from the same place");
  assert.equal(await note(), "redid");
  await press("Control+z");
});

test("text half-typed in the command line: the drawing undoes and the text stays", async () => {
  const before = await oneStep(12, 22);
  await app.page.fill("#cmd", "");
  await app.page.focus("#cmd");
  // Typed key by key, not filled: the browser's own text undo needs a history
  // of edits to act on, and with one the old carve-out's failure — the box
  // emptied, the drawing untouched — is exactly what this keystroke would do.
  const half = 'dist("p1", ';
  await app.page.keyboard.type(half);
  await press("Control+z");
  assert.equal(await saved(), before, "the drawing undid");
  assert.equal(await app.page.inputValue("#cmd"), half, "and not one character of the text went with it");
  assert.equal(await focused(), "input#cmd", "the focus never left the box");

  await press("Control+Shift+z");
  assert.notEqual(await saved(), before);
  assert.equal(await app.page.inputValue("#cmd"), half, "redo does not touch it either");
  await press("Control+z");
  await app.page.fill("#cmd", "");
});

test("focus on the body after a click on empty canvas", async () => {
  const before = await oneStep(14, 24);
  await click(480, 260);
  assert.equal(await focused(), "body", "the canvas is not focusable, so a press on it leaves the body");
  await press("Control+z");
  assert.equal(await saved(), before);
});

test("after a toolbar button, with the button itself focused", async () => {
  const before = await oneStep(16, 26);
  await app.page.click('#toolbar button[data-tool="point"]');
  assert.equal(await armed(), "point");
  // A click on a button keeps the focus where it was; putting it on the
  // button by hand is the harder case — a focused button is a thing that
  // handles keys of its own.
  await app.page.focus('#toolbar button[data-tool="point"]');
  await press("Control+z");
  assert.equal(await saved(), before);
  assert.equal(await armed(), "point", "the tool stays armed through an undo");
  assert.equal(
    await app.page.$eval('#toolbar button[data-tool="point"]', (el) => el.getAttribute("aria-pressed")),
    "true",
    "and the toolbar still says so",
  );
  await press("Escape");
  assert.equal(await armed(), null);
});

test("after dragging a panel by its strip — and the panel does not move back", async () => {
  const before = await oneStep(18, 28);
  const strip = '.panel[data-panel="log"] > .ptitle';
  const rect = () => app.page.$eval('.panel[data-panel="log"]', (el) => {
    const r = el.getBoundingClientRect();
    return { x: Math.round(r.x), y: Math.round(r.y) };
  });
  const was = await rect();
  const r = await app.page.$eval(strip, (el) => {
    const b = el.getBoundingClientRect();
    return { x: b.x + b.width / 2, y: b.y + b.height / 2 };
  });
  await app.page.mouse.move(r.x, r.y);
  await app.page.mouse.down();
  await app.page.mouse.move(r.x - 60, r.y - 40, { steps: 8 });
  await app.page.mouse.up();
  await app.page.waitForTimeout(120);
  const moved = await rect();
  assert.notDeepEqual(moved, was, "the panel was dragged");

  await press("Control+z");
  assert.equal(await saved(), before, "the drawing's last step undid");
  assert.deepEqual(await rect(), moved, "layout is not a step: the panel stays where it was put");
  await app.type('layout("reset")');
});

test("with the context menu open: the menu closes and the undo happens", async () => {
  const before = await oneStep(20, 30);
  await rightClick(500, 160);
  assert.ok(await menuOpen());
  await press("Control+z");
  assert.ok(!(await menuOpen()), "the menu went — its items named the model that was replaced");
  assert.equal(await saved(), before);
});

test("mid-gesture, the line tool after its first click: the preview goes, the tool stays", async () => {
  const before = await oneStep(-20, -20);
  await app.type("line");
  await click(300, 140);
  const b = await app.at(380, 190);
  await app.page.mouse.move(b.x, b.y, { steps: 4 });
  await app.page.waitForTimeout(80);
  const pending = () => app.page.evaluate(() =>
    (window as never as { __neocad: { engine: { active: { pending: unknown; aim: unknown } | null } } }).__neocad.engine.active);
  const mid = await pending();
  assert.ok(mid && mid.pending && mid.aim, "a chain is under way, with a preview to draw");

  await press("Control+z");
  // The first click commits nothing (see tools/line.ts), so what undid is the
  // step before it — the point — and the gesture is simply gone.
  assert.equal(await saved(), before, "the step before the gesture undid");
  assert.equal(await armed(), "line", "the tool stays armed");
  const after = await pending();
  assert.ok(after && !after.pending && !after.aim, "and starts afresh: no first click, no preview");

  // The proof that the half-gesture is gone: two more clicks make a line
  // between *them*, not one from the abandoned first click.
  await click(420, 260);
  await click(500, 300);
  const m = await app.model();
  assert.equal(m.byKind.line, 1, "one line");
  const p = m.points[m.lines[0].refs[0]];
  const first = await app.page.evaluate((w) =>
    (window as never as { __neocad: { engine: { worldToScreen(w: number[]): [number, number] } } }).__neocad.engine.worldToScreen(w), p);
  assert.ok(Math.hypot(first[0] - 420, first[1] - 260) < 3, `it starts at the new first click, not the abandoned one (${first})`);
  await press("Escape");
  await press("Control+z");
  assert.equal(await saved(), before);
});

test("mid-chain, after a segment: the segment undoes, the preview goes, the tool stays", async () => {
  const before = await saved();
  await app.type("line");
  await click(300, 140);
  await click(380, 200); // one segment, committed: a step
  const b = await app.at(440, 140);
  await app.page.mouse.move(b.x, b.y, { steps: 4 }); // the next segment's preview, rubber-banding
  await app.page.waitForTimeout(80);

  await press("Control+z");
  assert.equal(await saved(), before, "the committed segment undid");
  assert.equal(await armed(), "line");
  const state = await app.page.evaluate(() => {
    const t = (window as never as { __neocad: { engine: { active: { anchor: unknown; aim: unknown } | null } } }).__neocad.engine.active;
    return t ? { anchor: t.anchor, aim: t.aim } : null;
  });
  assert.deepEqual(state, { anchor: null, aim: null }, "the chain was dropped with its preview");
  await press("Escape");
});

test("mid-drag with nothing armed: the drag is cancelled, becomes a step, and that step undoes", async () => {
  const before = await oneStep(30, 0);
  const drawn = await saved();
  const at = await app.at(...await lastPointOnScreen());
  await app.page.mouse.move(at.x, at.y);
  await app.page.mouse.down();
  await app.page.mouse.move(at.x + 40, at.y + 30, { steps: 6 });
  await app.page.waitForTimeout(80);
  assert.notEqual(await saved(), drawn, "the drag is pulling the point");

  await press("Control+z");
  assert.equal(await saved(), drawn, "the drag undid, mid-gesture");
  await app.page.mouse.move(at.x + 80, at.y + 60, { steps: 4 });
  await app.page.mouse.up();
  await app.page.waitForTimeout(120);
  assert.equal(await saved(), drawn, "and the rest of the gesture moves nothing: it was cancelled");

  await press("Control+z");
  assert.equal(await saved(), before, "the step before it is next");
});

test("Ctrl+Y, Ctrl+Shift+Z, Meta+Z and Meta+Shift+Z", async () => {
  const before = await oneStep(-30, 10);
  const after = await saved();
  await press("Control+z");
  assert.equal(await saved(), before);
  await press("Control+y");
  assert.equal(await saved(), after, "Ctrl+Y redoes");
  await press("Meta+z");
  assert.equal(await saved(), before, "Cmd+Z undoes");
  await press("Control+Shift+z");
  assert.equal(await saved(), after, "Ctrl+Shift+Z redoes");
  await press("Meta+z");
  await press("Meta+Shift+z");
  assert.equal(await saved(), after, "Cmd+Shift+Z redoes");
  await press("Meta+z");
  await press("Meta+y");
  assert.equal(await saved(), after, "Cmd+Y redoes");
});

test("a layout whose Z key is not called z: the physical key still undoes", async () => {
  // No keyboard here can be switched to Russian, so this one is dispatched —
  // the event a Cyrillic layout produces for Ctrl and the key at Z's place.
  const before = await oneStep(-34, 14);
  await app.page.evaluate(() => {
    window.dispatchEvent(new KeyboardEvent("keydown", { key: "я", code: "KeyZ", ctrlKey: true, bubbles: true, cancelable: true }));
  });
  await app.page.waitForTimeout(150);
  assert.equal(await saved(), before);
});

test("the menu's Undo and Redo type undo() and redo(), on an entity's menu and on empty canvas", async () => {
  const before = await oneStep(-40, 20);
  const after = await saved();

  // The point just drawn: an entity's menu, with a header naming it.
  await rightClick(...await lastPointOnScreen());
  assert.ok((await app.page.$eval("#ctxmenu .head", (el) => el.textContent ?? "")).length > 0, "an entity's menu");
  let rows = await menuItems();
  assert.deepEqual(rows.slice(-2), [
    { label: "Undo", off: false, why: "" },
    { label: "Redo", off: true, why: "nothing to redo" },
  ]);
  await choose("Undo");
  assert.equal(await saved(), before);
  assert.match(await app.log(), /> undo\(\)\s*undid — /, "the log shows the command it typed, and what it did");
  assert.equal(await note(), "undid");

  // Empty canvas, with a step each way now.
  await rightClick(500, 160);
  rows = await menuItems();
  assert.deepEqual(rows.slice(-2).map((r) => [r.label, r.off]), [["Undo", false], ["Redo", false]]);
  await choose("Redo");
  assert.equal(await saved(), after);
  assert.match(await app.log(), /> redo\(\)\s*redid — /);
});

test("no uncaught page errors", () => {
  assert.deepEqual(app.pageErrors, []);
});
