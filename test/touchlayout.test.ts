// The chrome under a finger (docs/plans/touch.md), as pure functions: the
// coarse sizes, a phone's default layout in both orientations, and what each
// action-strip button types. The DOM that shows them is touch.e2e.ts's.

import { test } from "node:test";
import assert from "node:assert/strict";
import {
  ACTIONS, COARSE, FINE, actionCommand, arranged, defaultLayout, inCorner, optionsSize, overlapping, traySize,
  type Layout, type Size,
} from "../src/panels.ts";

/** Eleven built-in tools, as the app registers them. */
const TOOLS = 11;
/** The area the panels get on an iPhone 13 in Safari: the viewport less the header. */
const PORTRAIT: Size = { w: 390, h: 621 };
const LANDSCAPE: Size = { w: 750, h: 312 };

function inside(layout: Layout, area: Size): string[] {
  return Object.entries(layout).filter(([, r]) => r.x < 0 || r.y < 0 || r.x + r.w > area.w || r.y + r.h > area.h)
    .map(([id]) => id);
}

test("the mouse's sizes are what they were: FINE is every exported constant, and the default when none is said", () => {
  assert.deepEqual(traySize(3, "column"), traySize(3, "column", FINE));
  assert.deepEqual(traySize(3, "column"), { w: 28, h: 16 + 6 + 3 * 22 });
  assert.deepEqual(optionsSize(2), { w: 168, h: 16 + 8 + 44 });
  assert.deepEqual(defaultLayout({ w: 1100, h: 760 }, TOOLS), defaultLayout({ w: 1100, h: 760 }, TOOLS, FINE));
});

test("a finger's tray: 44 px buttons and a 44 px strip, one line, either way", () => {
  assert.deepEqual(traySize(4, "row", COARSE), { w: 44 + 6 + 4 * 46, h: 52 });
  assert.deepEqual(traySize(TOOLS, "column", COARSE), { w: 52, h: 44 + 6 + TOOLS * 46 });
  assert.equal(optionsSize(2, COARSE).h, 44 + 8 + 2 * 44, "an option's row is a target tall");
});

test("portrait: the command line on top, the tray a column down the left, a one-line log, the strip bottom-right", () => {
  const d = defaultLayout(PORTRAIT, TOOLS, COARSE);
  assert.deepEqual(Object.keys(d).sort(), ["actions", "cmd", "log", "options", "toolbar"]);
  const { options, ...panels } = d;
  assert.deepEqual(inside(panels, PORTRAIT), []);
  assert.deepEqual(overlapping(panels), []);
  assert.equal(d.toolbar.orient, "column");
  assert.ok(d.cmd.y === 8 && d.cmd.x > d.toolbar.x + d.toolbar.w);
  assert.equal(d.log.h, COARSE.title + COARSE.logLine);
  assert.equal(d.actions.orient, "row");
  assert.equal(d.actions.x + d.actions.w, PORTRAIT.w - 8);
  assert.equal(d.actions.y + d.actions.h, PORTRAIT.h - 8);
  // The options panel's box: right of the tray, between the log and the strip.
  assert.ok(options.y >= d.log.y + d.log.h && options.y + options.h <= d.actions.y && options.x >= d.cmd.x);
});

test("landscape: the tray a row along the bottom, the command line top-left, the strip and the log top-right", () => {
  const d = defaultLayout(LANDSCAPE, TOOLS, COARSE);
  assert.deepEqual(Object.keys(d).sort(), ["actions", "cmd", "log", "toolbar"]);
  assert.deepEqual(inside(d, LANDSCAPE), []);
  assert.deepEqual(overlapping(d), []);
  assert.equal(d.toolbar.orient, "row");
  assert.equal(d.toolbar.y + d.toolbar.h, LANDSCAPE.h - 8);
  assert.ok(d.cmd.y === 8 && d.actions.y === 8 && d.actions.x > d.cmd.x + d.cmd.w);
  assert.ok(d.log.x === d.actions.x && d.log.y > d.actions.y + d.actions.h);
});

test("arranged at a finger's sizes keeps the phone's defaults clear of one another, the strip a tray", () => {
  for (const area of [PORTRAIT, LANDSCAPE]) {
    const d = defaultLayout(area, TOOLS, COARSE);
    const r = arranged(["toolbar", "log", "actions", "cmd"], {}, d, { toolbar: TOOLS, actions: ACTIONS.length }, area, {}, COARSE);
    assert.ok(r.ok);
    assert.deepEqual(overlapping(r.layout), []);
    assert.deepEqual(r.layout.actions, d.actions, "the defaults already fit: nothing was pushed");
  }
});

test("a fitted panel given a box sits flush in its bottom-right corner, held inside", () => {
  assert.deepEqual(inCorner({ x: 68, y: 190, w: 314, h: 350 }, { w: 230, h: 140 }, PORTRAIT), { x: 152, y: 400, w: 230, h: 140 });
  // A box too small for it: still inside the area, its top-left kept on screen.
  const r = inCorner({ x: 300, y: 10, w: 50, h: 20 }, { w: 230, h: 140 }, PORTRAIT);
  assert.ok(r.x >= 0 && r.y >= 0 && r.x + r.w <= PORTRAIT.w);
});

test("the strip's buttons type the keys' lines, and nothing when they would do nothing", () => {
  const none = { canUndo: false, canRedo: false, selected: [], armed: false };
  assert.deepEqual(ACTIONS.map((a) => actionCommand(a, none)), [null, null, null, null]);
  const some = { canUndo: true, canRedo: true, selected: ["l1", 'we"ird'], armed: false };
  assert.deepEqual(ACTIONS.map((a) => actionCommand(a, some)),
    ["undo()", "redo()", 'del("l1", "we\\"ird")', "cancel()"], "names quoted as JSON, as the Delete key quotes them");
  // Delete is the Delete key's: nothing while a tool is armed.
  assert.equal(actionCommand("delete", { ...some, armed: true }), null);
  assert.equal(actionCommand("cancel", { ...none, armed: true }), "cancel()");
});
