// Undo and redo, driven the way a person drives them: a drawing built with a
// mouse and a command line, then Ctrl+Z.
//
// This is the story that defines the feature. The unit tests cover the stack
// and the snapshot comparison; what only a browser can answer is whether the
// *three different kinds of thing a user does* — a tool gesture, a command
// entry, a drag — each turn out to be exactly one step, and whether the state
// you land on is the state you came from rather than something that merely
// looks like it. The assertion throughout is on the text of `save()`, which is
// the strongest one available here: two models whose saved form is identical
// have the same entities, the same journal and the same solved coordinates,
// down to the last digit.

import { test, before, after } from "node:test";
import assert from "node:assert/strict";
import { openApp, type AppContext } from "./harness.ts";

let app: AppContext;
after(async () => { await app.close(); });
before(async () => { app = await openApp(); });

/** The whole model as text — the same snapshot the undo stack stores. */
async function saved(): Promise<string> {
  const r = await app.repl("save()");
  assert.equal(r.ok, true, r.error ?? "");
  return r.value as string;
}

/**
 * Presses a shortcut with the command input empty, which is the state in which
 * the model owns Ctrl+Z (see the carve-out test at the bottom).
 */
async function key(combo: string): Promise<void> {
  await app.page.fill("#cmd", "");
  await app.page.keyboard.press(combo);
  await app.page.waitForTimeout(220);
}

const undoKey = () => key("Control+z");
const redoKey = () => key("Control+Shift+z");

async function screenOf(name: string): Promise<[number, number]> {
  return app.page.evaluate((n) => {
    const { model, engine } = (window as never as {
      __neocad: { model: { coords(x: string): number[] }; engine: { worldToScreen(w: number[]): [number, number] } };
    }).__neocad;
    return engine.worldToScreen(model.coords(n));
  }, name);
}

async function dragFromTo(from: { x: number; y: number }, to: { x: number; y: number }) {
  await app.page.mouse.move(from.x, from.y);
  await app.page.mouse.down();
  await app.page.mouse.move(to.x, to.y, { steps: 10 });
  await app.page.mouse.up();
  await app.page.waitForTimeout(200);
}

// The four states the session passes through, filled in by the first test and
// walked back and forth by the ones after it.
let empty = "";
let drawn = "";
let filleted = "";
let dragged = "";

test("three actions, three undos, and each lands exactly where it was", async () => {
  empty = await saved();

  // 1. A tool gesture: the rectangle tool, dragged out with the mouse.
  await app.type("rectangle");
  await dragFromTo(await app.at(250, 120), await app.at(420, 300));
  drawn = await saved();
  const m1 = await app.model();
  assert.deepEqual(m1.byKind, { point: 4, line: 4 }, "the rectangle was drawn");

  // 2. A command entry: filleting a corner, which is structural surgery.
  await app.type('fillet("l1", "l2", 8)');
  filleted = await saved();
  const m2 = await app.model();
  assert.equal(m2.byKind.arc, 1, "the fillet added its arc");
  assert.equal(await app.status(), "SOLVED");

  // 3. A drag: coordinates change and nothing at all is journalled.
  const [sx, sy] = await screenOf("p3");
  await dragFromTo(await app.at(sx, sy), await app.at(sx + 45, sy - 35));
  dragged = await saved();
  assert.notEqual(dragged, filleted, "the drag moved something");
  assert.deepEqual(
    JSON.parse(dragged).journal,
    JSON.parse(filleted).journal,
    "...without journalling anything, which is why this is not journal truncation",
  );

  assert.equal(new Set([empty, drawn, filleted, dragged]).size, 4, "four distinct states");

  // Now walk back through all three.
  await undoKey();
  assert.equal(await saved(), filleted, "one undo puts the drag back");
  assert.equal(await app.status(), "SOLVED", "and the restored model is solved");

  await undoKey();
  assert.equal(await saved(), drawn, "two undos put the fillet back");
  assert.deepEqual((await app.model()).byKind, { point: 4, line: 4 }, "the arc is gone again");

  await undoKey();
  assert.equal(await saved(), empty, "three undos put the rectangle back");
  assert.equal((await app.model()).size, 0, "an empty drawing, as at the start");

  await undoKey();
  assert.equal(await saved(), empty, "and a fourth does nothing at all");
  assert.match(await app.log(), /nothing to undo/);
});

test("three redos walk forward through the same states", async () => {
  await redoKey();
  assert.equal(await saved(), drawn);
  await redoKey();
  assert.equal(await saved(), filleted);
  await redoKey();
  assert.equal(await saved(), dragged, "back at the end of the session");
  assert.equal(await app.status(), "SOLVED");

  await redoKey();
  assert.equal(await saved(), dragged, "nothing beyond it");
  assert.match(await app.log(), /nothing to redo/);
});

test("Ctrl+Y redoes as well, for the hands that reach for it", async () => {
  await undoKey();
  assert.equal(await saved(), filleted);
  await key("Control+y");
  assert.equal(await saved(), dragged);
});

test("a fresh action truncates the redo branch", async () => {
  await undoKey();
  assert.equal(await saved(), filleted, "one step back, with a way forward");

  await app.type("pt(0, 40)"); // ...and instead of taking it, draw something
  const branched = await saved();
  assert.notEqual(branched, dragged);

  await redoKey();
  assert.equal(await saved(), branched, "the drag is no longer reachable by going forward");
  assert.match(await app.log(), /nothing to redo/);

  // The new action is itself one step, and undoing it returns to where the
  // branch was taken.
  await undoKey();
  assert.equal(await saved(), filleted);
});

test("an entry that changes nothing is not a step", async () => {
  const here = await saved();
  for (const inert of ["ls()", "help()", "journal()", "2 + 2"]) await app.type(inert);

  await undoKey();
  assert.notEqual(await saved(), here, "the undo skipped straight past all four to a real one");

  await redoKey();
  assert.equal(await saved(), here, "and forward again, still one step");
});

test("with text in the command line, Ctrl+Z belongs to the text", async () => {
  const here = await saved();
  // A half-typed command, exactly as picking two entities leaves one.
  await app.page.fill("#cmd", 'dist("p1", "p2"');
  await app.page.keyboard.press("Control+z");
  await app.page.waitForTimeout(200);

  assert.equal(await saved(), here, "the model did not move under the half-typed command");

  // And with the box empty again it is the model's once more.
  await app.page.fill("#cmd", "");
  await undoKey();
  assert.notEqual(await saved(), here);
  await redoKey();
  assert.equal(await saved(), here);
});

test("undo() typed at the command line is the same thing as the keystroke", async () => {
  const here = await saved();

  await undoKey();
  const byKeystroke = await saved();
  await redoKey();
  assert.equal(await saved(), here, "back to the start of the comparison");

  await app.type("undo()");
  assert.equal(await saved(), byKeystroke, "the command lands on the same state");
  assert.match(await app.log(), /undid —/);

  await app.type("redo()");
  assert.equal(await saved(), here);

  // And the entry that undoes is not itself recorded as an edit, or Ctrl+Z
  // would forever be undoing the last undo.
  await app.type("undo()");
  assert.equal(await saved(), byKeystroke);
  await app.type("redo()");
  assert.equal(await saved(), here);
});

test("opening a file is one undo step", async () => {
  const here = await saved();
  await app.repl(`OTHER = ${JSON.stringify(empty)}`);
  const opened = await app.repl("open(OTHER)");
  assert.equal(opened.ok, true, opened.error ?? "");
  assert.equal((await app.model()).size, 0, "opened the empty drawing");

  await undoKey();
  assert.equal(await saved(), here, "one Ctrl+Z from opening the wrong file");
});

test("no uncaught page errors", () => {
  assert.deepEqual(app.pageErrors, []);
});
