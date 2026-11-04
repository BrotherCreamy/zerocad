// The chrome under a finger (docs/plans/touch.md), as pure functions: the
// coarse sizes, a phone's default layout in both orientations, and what each
// action-strip button types. The DOM that shows them is touch.e2e.ts's.

import { test } from "node:test";
import assert from "node:assert/strict";
import {
  ACTIONS, COARSE, FINE, actionCommand, arranged, cornerBox, defaultLayout, inCorner, linesOf, logoBox, optionsSize, overlapping,
  touchMetrics, traySize, type Layout, type Size,
} from "../src/panels.ts";

/**
 * Thirteen buttons: the toolbar as it was until the 3-point circle and arc
 * folded into one tool each (docs/plans/one-circle-one-arc.md) — it has eleven
 * now. These layouts are kept at thirteen, the longer tray, because the
 * arithmetic is the claim; test/fits.test.ts holds the app's own eleven to
 * fitting every iPhone, and test/e2e/touch.e2e.ts looks at the real thing.
 */
const TOOLS = 13;
/**
 * The area the panels get on an iPhone 13 at home-screen size: the screen less
 * the safe-area insets (portrait 47 top, 34 bottom; landscape 47 each side,
 * 21 bottom) — there is no header any more.
 */
const PORTRAIT: Size = { w: 390, h: 844 - 47 - 34 };
const LANDSCAPE: Size = { w: 844 - 2 * 47, h: 390 - 21 };
/** A finger's chrome at 1 × a desktop's — a phone at its smallest (60 % of its 1.3, near enough). */
const PHONE = touchMetrics(1);

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

test("a finger's tray at a phone's 100 %: 26 px buttons a 44 px target apart, a 21 px strip, one line, either way", () => {
  assert.deepEqual(traySize(4, "row", COARSE), { w: 21 + 6 + 4 * 44, h: 34 });
  assert.deepEqual(traySize(TOOLS, "column", COARSE), { w: 34, h: 21 + 6 + TOOLS * 44 });
  assert.equal(optionsSize(2, COARSE).h, 21 + 8 + 2 * 44, "an option's row is a target tall");
});

for (const m of [COARSE, PHONE]) {
  const at = `${Math.round(m.scale * 100)} %`;
  const logo = { logo: { x: 0, y: 0, ...logoBox(m), fixed: true } };

  test(`portrait at ${at}: the command line docked to the bottom, the tray a column under the logo, the strip top-right under the logo's row, a one-line log, the organiser beside them`, () => {
    const d = defaultLayout(PORTRAIT, TOOLS, m);
    assert.deepEqual(Object.keys(d).sort(), ["actions", "cmd", "log", "options", "organiser", "toolbar"]);
    const { options, ...panels } = d;
    assert.deepEqual(inside(panels, PORTRAIT), []);
    assert.deepEqual(overlapping({ ...panels, ...logo }), [], "clear of one another and of the logo");
    assert.equal(d.toolbar.orient, "column");
    assert.ok(d.toolbar.y >= logoBox(m).h + 8, "the tray under the logo, a margin off it");
    assert.deepEqual(d.cmd, { x: 0, y: PORTRAIT.h - (m.title + m.line), w: PORTRAIT.w, h: m.title + m.line }, "edge to edge, on the bottom");
    assert.equal(d.log.h, m.title + m.logLine);
    assert.equal(d.actions.orient, "row");
    assert.equal(d.actions.x + d.actions.w, PORTRAIT.w - 8);
    assert.equal(d.actions.y, logoBox(m).h + 8, "the strip at the top right, under the logo's row");
    for (const [id, r] of Object.entries(panels)) assert.ok(r.y >= logoBox(m).h, `${id} is out of the logo's row`);
    assert.ok(d.log.y > d.actions.y + d.actions.h && d.log.x > d.toolbar.x + d.toolbar.w, "the log under it, right of the tray");
    // The organiser, shown from the start (the owner: "show from start"):
    // right of the tray, beside the strip and the log, and above the drawing's middle.
    assert.ok(d.organiser.x >= d.toolbar.x + d.toolbar.w && d.organiser.x + d.organiser.w <= d.actions.x);
    assert.ok(d.organiser.y + d.organiser.h <= Math.max(PORTRAIT.h * 0.4, d.log.y + d.log.h), "above the middle");
    // The options panel's box: right of the tray, between them and the command line.
    assert.ok(options.y >= d.organiser.y + d.organiser.h && options.y + options.h <= d.cmd.y && options.x >= d.toolbar.x + d.toolbar.w);
  });

  test(`landscape at ${at}: the tray two rows docked to the bottom, the strip, the log and the organiser down the right, the command line in the top row beyond the corner`, () => {
    const d = defaultLayout(LANDSCAPE, TOOLS, m);
    assert.deepEqual(Object.keys(d).sort(), ["actions", "cmd", "log", "organiser", "toolbar"]);
    assert.deepEqual(inside(d, LANDSCAPE), []);
    assert.deepEqual(overlapping({ ...d, ...logo }), []);
    assert.equal(d.toolbar.orient, "row");
    assert.equal(d.toolbar.y + d.toolbar.h, LANDSCAPE.h, "on the bottom edge");
    assert.equal(linesOf(d.toolbar, m), 2, "two rows: thirteen at a finger's pitch do not fit beside the column");
    assert.ok(d.toolbar.x + d.toolbar.w <= d.organiser.x - 8, "left of the column");
    const corner = cornerBox(m);
    assert.ok(d.cmd.y === 8 && d.cmd.x >= corner.w + 8 && d.actions.y === 8 && d.actions.x > d.cmd.x + d.cmd.w, "the row beyond the corner");
    assert.ok(d.log.x === d.actions.x && d.log.y > d.actions.y + d.actions.h);
    assert.equal(d.organiser.x + d.organiser.w, LANDSCAPE.w - 8, "the organiser at the right edge");
    assert.ok(d.organiser.y > d.log.y + d.log.h && d.organiser.y + d.organiser.h <= LANDSCAPE.h - 8, "under the log, to the bottom margin");
  });
}

test("portrait in Safari's shorter page: a column too long to end above the command line has the line start right of it", () => {
  // iPhone 13 in Safari, as Chromium emulates it: 390 × 664, its bars taking
  // what the installed app has. Measured: with Select and the Hand the column
  // ran 44 px down onto an edge-to-edge line, and the two were drawn one over
  // the other.
  const safari: Size = { w: 390, h: 664 };
  for (const m of [COARSE, PHONE]) {
    const d = defaultLayout(safari, TOOLS, m);
    const tall = d.toolbar.y + d.toolbar.h > safari.h - (m.title + m.line);
    const { options, ...panels } = d;
    assert.deepEqual(inside(panels, safari), []);
    assert.deepEqual(overlapping({ ...panels, logo: { x: 0, y: 0, ...logoBox(m), fixed: true } }), [], `clear at ${m.scale}`);
    assert.equal(d.cmd.y + d.cmd.h, safari.h, "still docked to the bottom");
    assert.equal(d.cmd.x + d.cmd.w, safari.w, "and to the right edge");
    if (tall) assert.ok(d.cmd.x >= d.toolbar.x + d.toolbar.w, "beside the column");
    else assert.equal(d.cmd.x, 0, "edge to edge where the column ends above it");
    assert.ok(options.y + options.h <= d.cmd.y);
  }
  assert.ok(defaultLayout(safari, TOOLS, COARSE).cmd.x > 0, "at a phone's 100 % it is beside");
  assert.equal(defaultLayout(safari, 11, COARSE).cmd.x, 0, "where eleven buttons were edge to edge, as they always were");
});

test("arranged at a finger's sizes keeps the phone's defaults clear of one another, the strip a tray", () => {
  for (const [area, m] of [[PORTRAIT, COARSE], [LANDSCAPE, COARSE], [PORTRAIT, PHONE], [LANDSCAPE, PHONE]] as const) {
    const d = defaultLayout(area, TOOLS, m);
    const r = arranged(["toolbar", "log", "actions", "cmd"], {}, d, { toolbar: TOOLS, actions: ACTIONS.length }, area, {}, m,
      { logo: { x: 0, y: 0, ...logoBox(m), fixed: true } });
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
