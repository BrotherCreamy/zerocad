// Everything fits (docs/plans/everything-fits.md; the owner, asked whether a
// landscape phone's toolbar should wrap or fold: "Second row.... everything
// has to fit"; asked whether the organiser should show from the start on a
// phone: "show from start").
//
// The tray wraps by the room it has; the phone's default layout, laid out as
// the page lays it out (the logo fixed, the organiser shown, the options
// panel at its default), overlaps nothing on every iPhone in test/devices.ts,
// both ways up, installed and in Safari; the corner's room keeps clear of the
// panes; and a layout the resolver cannot find is reported, never drawn
// silently. What the browser shows of it is test/e2e/fits.e2e.ts's.

import { test } from "node:test";
import assert from "node:assert/strict";
import {
  ACTIONS, COARSE, FINE, TOUCH_TARGET, arranged, cornerBox, cornerRoom, defaultLayout, describeLayout, fittedAt, layoutProblem,
  linesOf, logoBox, optionsSize, overlapping, scaledMetrics, touchMetrics, trayLines, trayRoom, traySize,
  type Layout, type Metrics, type Size,
} from "../src/panels.ts";
import { ANDROIDS, IPHONES, NAV_GESTURE, NAV_BUTTONS, androidAreaOf, androidWindowOf, areaOf, everyAndroidWay, everyWay, windowOf, type AndroidDevice } from "./devices.ts";
import { formFactor } from "../src/uiscale.ts";

// Select, the Hand and ten buttons of tools (one circle, one arc:
// docs/plans/one-circle-one-arc.md; the shapes and curves groups:
// docs/plans/sketch-shapes.md).
const TOOLS = 12;
/** The spin box's steps, 60 % to 160 % (uiscale.ts). */
const STEPS = [0.6, 0.7, 0.8, 0.9, 1, 1.1, 1.2, 1.3, 1.4, 1.5, 1.6];

/**
 * The phone's defaults laid out as `Panels.apply` lays out a fresh screen: the
 * logo fixed, every pane shown, and — with `rows` — the options panel of that
 * many rows at its default (`fittedAt`), placed after the rest.
 */
function laidOut(area: Size, m: Metrics, rows: number | null): { layout: Layout; ok: boolean } {
  const defaults = defaultLayout(area, TOOLS, m);
  const trays = { toolbar: TOOLS, actions: ACTIONS.length };
  const order = ["toolbar", "log", "organiser", "actions", "cmd"];
  const fixed: Layout = { logo: { x: 0, y: 0, ...logoBox(m), fixed: true } };
  if (rows === null) {
    const { options: _unused, ...d } = defaults;
    return arranged(order, {}, d, trays, area, {}, m, fixed);
  }
  const size = optionsSize(rows, m);
  const first = arranged(order, {}, defaults, trays, area, {}, m, fixed).layout;
  const d = { ...defaults, options: fittedAt(defaults.options, first.toolbar, size, area) };
  return arranged([...order, "options"], {}, d, trays, area, { options: size }, m, fixed);
}

/** Everything the fit rule forbids, said: an overlap, a pane off screen, a pane in the corner, a resolver that gave up. */
function breaches(area: Size, m: Metrics, rows: number | null): string[] {
  const r = laidOut(area, m, rows);
  const out: string[] = [];
  if (!r.ok) out.push("the resolver found no layout");
  for (const [a, b] of overlapping(r.layout)) out.push(`${a} over ${b}`);
  const corner = cornerBox(m);
  for (const [id, p] of Object.entries(r.layout)) {
    if (p.fixed) continue;
    if (p.x < 0 || p.y < 0 || p.x + p.w > area.w || p.y + p.h > area.h) out.push(`${id} off screen: ${JSON.stringify(p)}`);
    if (p.x < corner.w && p.y < corner.h) out.push(`${id} in the logo's row, over the corner: ${JSON.stringify(p)}`);
  }
  return out;
}

test("the device table: every iPhone from the SE to the Pro Max, its area the window less its insets", () => {
  assert.deepEqual([IPHONES[0].w, IPHONES[0].h], [375, 667], "from the SE");
  assert.deepEqual([IPHONES.at(-1)!.w, IPHONES.at(-1)!.h], [440, 956], "to the Pro Max");
  for (const p of IPHONES) {
    const a = areaOf(p, "portrait", "installed");
    assert.deepEqual(a, { w: p.w, h: p.h - p.portrait.top - p.portrait.bottom }, p.name);
    const l = areaOf(p, "landscape", "installed");
    assert.deepEqual(l, { w: p.h - p.landscape.left - p.landscape.right, h: p.w - p.landscape.top - p.landscape.bottom }, p.name);
    assert.ok(areaOf(p, "portrait", "safari").h < a.h, `${p.name}: Safari's bars take room the installed app has`);
    assert.equal(windowOf(p, "portrait", "installed").insets.top, 0, "the installed app's status bar is `default`: its page starts below it");
  }
});

test("traySize wraps by the room along it: one line where one fits, then two, then three — at every interface size", () => {
  for (const coarse of [false, true]) {
    for (const step of STEPS) {
      const m = coarse ? touchMetrics(1.3 * step, 1.3) : scaledMetrics(FINE, step);
      const at = `${coarse ? "a finger's" : "a mouse's"} ${Math.round(step * 100)} %`;
      for (const orient of ["row", "column"] as const) {
        const one = traySize(TOOLS, orient, m);
        const run = (s: Size) => (orient === "row" ? s.w : s.h);
        const depth = (s: Size) => (orient === "row" ? s.h : s.w);
        assert.deepEqual(traySize(TOOLS, orient, m, run(one)), one, `${at}: a line that fits is one line`);
        const two = traySize(TOOLS, orient, m, run(one) - 1);
        assert.equal(trayLines(TOOLS, orient, m, run(one) - 1), 2, at);
        assert.ok(run(two) < run(one) && depth(two) > depth(one), at);
        // The second line a whole button pitch over: under a finger, a target apart, as along the line.
        assert.equal(depth(two) - depth(one), m.button + m.gap, at);
        if (coarse) assert.ok(depth(two) - depth(one) >= m.hit, `${at}: the lines' hit boxes do not overlap`);
        assert.equal(trayLines(TOOLS, orient, m, run(two) - 1), 3, `${at}: three, where two are too long`);
        assert.equal(linesOf({ x: 0, y: 0, ...two, orient }, m), 2, `${at}: and read back off its depth`);
        // Same order, line by line: six then five.
        assert.equal(run(two), m.title + 6 + Math.ceil(TOOLS / 2) * (m.button + m.gap));
      }
    }
  }
  // Never more lines than buttons, and never fewer than it asks for.
  assert.equal(trayLines(3, "row", COARSE, 1), 3);
  assert.equal(trayLines(13, "row", COARSE, Infinity, 2), 2);
  // The room is the area's, less the logo's corner and a margin.
  assert.equal(trayRoom({ w: 750, h: 369 }, "row", COARSE), 750 - logoBox(COARSE).w - 8);
  assert.equal(trayRoom({ w: 390, h: 664 }, "column", COARSE), 664 - logoBox(COARSE).h - 8);
});

test("layout() says a wrapped tray's lines", () => {
  const two = traySize(TOOLS, "row", COARSE, 400);
  const text = describeLayout({ toolbar: { x: 8, y: 300, ...two, orient: "row", lines: 2 } }, {}, COARSE);
  assert.match(text, /row ×2/);
  assert.doesNotMatch(describeLayout({ toolbar: { x: 8, y: 300, ...traySize(TOOLS, "row", COARSE), orient: "row" } }, {}, COARSE), /×/);
});

for (const { phone, turn, mode } of everyWay()) {
  test(`everything fits: ${phone.name}, ${turn}, ${mode === "installed" ? "installed" : "in Safari"}, at the default size`, () => {
    const area = areaOf(phone, turn, mode);
    for (const rows of [null, 1, 2]) {
      assert.deepEqual(breaches(area, COARSE, rows), [], `${area.w}×${area.h}, ${rows === null ? "no tool armed" : `an options panel of ${rows}`}`);
    }
    const d = laidOut(area, COARSE, 2).layout;
    assert.ok(d.organiser && d.organiser.w > 0 && d.organiser.h > 0, "the organiser is there from the start");
    if (turn === "landscape") assert.equal(d.toolbar.orient, "row");
    else assert.equal(d.toolbar.orient, "column");
  });
}

/**
 * How far the guarantee goes above 100 %. **The target follows the interface
 * size** (docs/plans/touch-density.md): at 120 % it is 53, not the 44 it was,
 * so option rows and tray pitches are longer there than they were, and the
 * guarantee is shorter — 120 % everywhere with no tool armed or a drawing
 * tool's one row of options, 110 % everywhere with a feature's two rows (at
 * 120 % those do not fit an SE in Safari, the 390 and 393 pt phones in
 * Safari's landscape, or a 360 px Android on its side). The step-by-step table
 * is in touch-density.md's As built. Past it, the resolver says so.
 */
const holds = (step: number, rows: number | null) => step <= 1.1 || (step <= 1.2 && rows !== 2);

test("at larger interface sizes it holds as far as the screen allows — to 120 % on every phone, 110 % with a feature's options — and past that the resolver says so", () => {
  for (const { phone, turn, mode } of everyWay()) {
    const area = areaOf(phone, turn, mode);
    for (const step of STEPS) {
      const m = touchMetrics(1.3 * step, 1.3);
      for (const rows of [null, 1, 2]) {
        const where = `${phone.name} ${turn} ${mode} at ${Math.round(step * 100)} %, options ${rows}`;
        const r = laidOut(area, m, rows);
        if (holds(step, rows)) assert.deepEqual(breaches(area, m, rows), [], where);
        // Never an overlap drawn silently: either the layout is sound, or
        // the resolver gave up and `layoutProblem` says so.
        if (r.ok) assert.deepEqual(overlapping(r.layout), [], where);
        else assert.match(layoutProblem(r.layout, r.ok, area) ?? "", /no layout fits/, where);
      }
    }
  }
});

test("the resolver's failure is reported: a layout it could not find, or two panels over one another, is a problem with words", () => {
  const area = { w: 200, h: 120 };
  const r = arranged(["log", "cmd"], {}, { log: { x: 0, y: 0, w: 190, h: 110 }, cmd: { x: 0, y: 0, w: 190, h: 110 } }, {}, area);
  assert.equal(r.ok, false, "two 190×110 panes cannot both fit 200×120");
  assert.match(layoutProblem(r.layout, r.ok, area)!, /^panels: no layout fits/);
  assert.match(layoutProblem({ a: { x: 0, y: 0, w: 10, h: 10 }, b: { x: 5, y: 5, w: 10, h: 10 } }, true, area)!, /^panels overlap: a and b/);
  assert.equal(layoutProblem({ a: { x: 0, y: 0, w: 10, h: 10 }, b: { x: 10, y: 0, w: 10, h: 10 } }, true, area), null, "touching is not overlapping");
});

test("the corner's room: the whole logo's row while the panes are at their defaults, and short of a pane dragged into it", () => {
  for (const { phone, turn, mode } of everyWay()) {
    const area = areaOf(phone, turn, mode);
    const d = laidOut(area, COARSE, 1).layout;
    const room = cornerRoom(d, area, logoBox(COARSE));
    const box = cornerBox(COARSE);
    assert.ok(room.w >= box.w - logoBox(COARSE).w - 4 && room.h >= box.h - 4, `${phone.name} ${turn} ${mode}: at least the corner's box`);
    for (const [id, r] of Object.entries(d)) {
      if (r.fixed) continue;
      const over = r.x < room.x + room.w && room.x < r.x + r.w && r.y < room.y + room.h && room.y < r.y + r.h;
      assert.ok(!over, `${id} is not under the corner's text`);
    }
    if (turn === "portrait") assert.equal(room.w, area.w - logoBox(COARSE).w - 4, "in portrait, the whole row");
  }
  // A log dragged into the row, 100 px right of the logo: the text stops 4 px short of it.
  const logo = logoBox(COARSE);
  const room = cornerRoom({ logo: { x: 0, y: 0, ...logo, fixed: true }, log: { x: logo.w + 100, y: 10, w: 200, h: 60 } }, { w: 390, h: 700 }, logo);
  assert.deepEqual([room.x, room.w], [logo.w, 96]);
  // And a pane under the stretch it has stops it going down.
  const low = cornerRoom({ cmd: { x: 0, y: 50, w: 390, h: 65 } }, { w: 390, h: 700 }, logo);
  assert.equal(low.h, 46);
});

// ---- Android (docs/plans/android.md) ------------------------------------------------
//
// The same rule over the Android rows of the table — installed with the
// gesture bar, installed with three buttons, and in a Chrome tab — at each
// device's own 100 % (uiscale.ts: a phone 1.3, a large screen 1.15), since a
// tablet is drawn at the tablet's size, not a phone's.

const androidMetrics = (d: AndroidDevice) => { const k = formFactor({ coarse: true, shortSide: Math.min(d.w, d.h) }); return touchMetrics(k, k); };

test("the Android table: Pixels 7, 8 and 9 with their Pro sizes, a Galaxy S, a Fold's two screens, two tablets — each area its window less its insets", () => {
  const names = ANDROIDS.map((d) => d.name).join(" | ");
  for (const want of [/Pixel 7\b/, /Pixel 8\b/, /Pixel 9\b/, /Pixel 7 Pro/, /Pixel 8 Pro/, /Pixel 9 Pro/, /Galaxy S23, S24/, /Fold 7 cover/, /Fold 7 inner/, /Pixel Tablet/, /Galaxy Tab/]) {
    assert.match(names, want);
  }
  for (const d of ANDROIDS) {
    const gesture = androidWindowOf(d, "portrait", "installed");
    assert.equal(gesture.h, d.h - d.status.portrait, `${d.name}: the installed page starts below the status bar`);
    assert.equal(gesture.insets.bottom, NAV_GESTURE, `${d.name}: and runs under the gesture bar, inset by it`);
    const buttons = androidWindowOf(d, "portrait", "buttons");
    assert.equal(buttons.h, d.h - d.status.portrait - NAV_BUTTONS, `${d.name}: three buttons stop the page above them`);
    assert.deepEqual(androidAreaOf(d, "portrait", "installed"), { w: d.w, h: d.h - d.status.portrait - NAV_GESTURE });
    const side = androidWindowOf(d, "landscape", "installed");
    assert.equal(side.insets.left, d.large ? 0 : d.cutout, `${d.name}: on its side the cutout is a left inset`);
    assert.ok(androidAreaOf(d, "portrait", "chrome").h < androidAreaOf(d, "portrait", "installed").h + NAV_GESTURE,
      `${d.name}: Chrome's toolbar takes room the installed app has`);
    assert.equal(d.large, Math.min(d.w, d.h) >= 600, `${d.name}: large is a short side of 600 or more`);
  }
  // The narrowest phone in either table is Android's.
  assert.ok(Math.min(...ANDROIDS.map((d) => d.w)) < Math.min(...IPHONES.map((p) => p.w)));
});

for (const { device, turn, mode } of everyAndroidWay()) {
  test(`everything fits: ${device.name}, ${turn}, ${mode === "installed" ? "installed, gesture bar" : mode === "buttons" ? "installed, three buttons" : "in Chrome"}, at its default size`, () => {
    const area = androidAreaOf(device, turn, mode);
    const m = androidMetrics(device);
    for (const rows of [null, 1, 2]) {
      assert.deepEqual(breaches(area, m, rows), [], `${area.w}×${area.h} at ${m.scale}, ${rows === null ? "no tool armed" : `an options panel of ${rows}`}`);
    }
    const d = laidOut(area, m, 2).layout;
    assert.ok(d.organiser && d.organiser.w > 0 && d.organiser.h > 0, "the organiser is there from the start");
    assert.equal(d.toolbar.orient, area.w >= area.h ? "row" : "column");
  });
}

test("Android at larger interface sizes: to 120 % on every device, 110 % with a feature's options, and past where it stops the resolver says so", () => {
  for (const { device, turn, mode } of everyAndroidWay()) {
    const area = androidAreaOf(device, turn, mode);
    const k = formFactor({ coarse: true, shortSide: Math.min(device.w, device.h) });
    for (const step of STEPS) {
      const m = touchMetrics(k * step, k);
      for (const rows of [null, 1, 2]) {
        const where = `${device.name} ${turn} ${mode} at ${Math.round(step * 100)} %, options ${rows}`;
        const r = laidOut(area, m, rows);
        if (holds(step, rows)) assert.deepEqual(breaches(area, m, rows), [], where);
        if (r.ok) assert.deepEqual(overlapping(r.layout), [], where);
        else assert.match(layoutProblem(r.layout, r.ok, area) ?? "", /no layout fits/, where);
      }
    }
  }
});
