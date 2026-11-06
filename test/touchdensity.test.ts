// Touch targets that follow the interface size, and less air between tools
// (docs/plans/touch-density.md), as pure functions. The owner, from his phone:
// *"for the scaling, the text resizes but the spacing between e.g menu items
// and toolbar items barely changes. Not sure why. There must be some scaling
// you're missing. Also in general the white space between eg the tools on the
// tool palettes is a bit too much"*. Every target under a finger was a literal
// 44 px; now it is `target(m)` — 44 at the device's own 100 %, in proportion
// from there, never under 32 — and a tray's tool is drawn at 0.8 of it.
//
// Also here: the bleed under an inset, bottom only (the owner, on his
// landscape iPhone: *"when I move something up against the left or right
// edge, it hits an invisible edge, but then the padding of the palette
// expands out to touch the edge of the screen"*). What only a browser can
// show is touchdensity.e2e.ts's.

import { test } from "node:test";
import assert from "node:assert/strict";
import {
  COARSE, FINE, TARGET_FLOOR, TOUCH_TARGET, TRAY_SHARE, arranged, bleed, defaultLayout, flyoutSize, logoBox, minSizeOf, optionsSize,
  overlapping, recorded, refit, relaid, scaledMetrics, target, touchMetrics, traySize, trayRoom,
  type Insets, type Layout, type Recorded, type Rect, type Size,
} from "../src/panels.ts";
import { FORM_FACTOR, UI_MAX, UI_MIN, UI_STEP } from "../src/uiscale.ts";

/** The spin box's steps, 60 % to 160 %. */
const STEPS: number[] = [];
for (let s = UI_MIN; s <= UI_MAX + 1e-9; s += UI_STEP) STEPS.push(Math.round(s * 100) / 100);

const FORMS = [["a phone", FORM_FACTOR.phone], ["a tablet", FORM_FACTOR.tablet]] as const;

test("the target: 44 at each device's own 100 %, in proportion to the spin box from there, never under 32", () => {
  for (const [form, base] of FORMS) {
    assert.equal(touchMetrics(base, base).hit, TOUCH_TARGET, `${form}: 44 at its own 100 %`);
    // The device's 100 % is its form factor times the person's text size, and
    // the target is measured against the form factor: larger text, larger
    // targets, as Dynamic Type makes iOS's own rows taller — and smaller text
    // smaller ones, down to the floor.
    for (const text of [0.8, 1.25, 1.5]) {
      const k = Math.round(base * text * 100) / 100;
      assert.equal(touchMetrics(k, base).hit, Math.max(TARGET_FLOOR, Math.round(44 * k / base)), `${form}, text ${text}`);
    }
    assert.equal(touchMetrics(Math.round(base * 1.3 * 100) / 100, base).button > touchMetrics(base, base).button, true,
      `${form}: a system font 1.3 × larger draws the tray's tools larger`);
    for (const step of STEPS) {
      const m = touchMetrics(base * step, base);
      assert.equal(m.hit, Math.max(TARGET_FLOOR, Math.round(44 * step)), `${form} at ${Math.round(step * 100)} %`);
      assert.equal(m.hit, target(m));
    }
    assert.equal(touchMetrics(base * 0.8, base).hit, 35, `${form}: 80 % is 35`);
    assert.equal(touchMetrics(base * 1.3, base).hit, 57, `${form}: 130 % is 57`);
    assert.equal(touchMetrics(base * 1.6, base).hit, 70, `${form}: 160 % is 70`);
    // The floor: 60 % would be 26 and 70 % 31 — below what a fingertip hits.
    assert.equal(touchMetrics(base * 0.6, base).hit, TARGET_FLOOR, `${form}: 60 % is held at 32`);
    assert.equal(touchMetrics(base * 0.7, base).hit, TARGET_FLOOR, `${form}: 70 % is held at 32`);
  }
  assert.equal(TARGET_FLOOR, 32);
  // The target grows and shrinks with the size: never the same at two steps above the floor.
  const phone = STEPS.map((s) => touchMetrics(1.3 * s, 1.3).hit);
  for (let i = 1; i < phone.length; i++) assert.ok(phone[i] >= phone[i - 1], "never smaller at a larger size");
  assert.ok(phone.at(-1)! - phone[2] >= 30, "80 % to 160 % spans twice the target");
  // A mouse is hit where it is drawn, as before.
  assert.equal(scaledMetrics(FINE, 1.4).hit, 0);
  assert.deepEqual(scaledMetrics(FINE, 1), FINE, "the desktop is unchanged");
});

test("the tray under a finger: its pitch a whole target, its button drawn at 0.8 of it, the gap what is left", () => {
  for (const [form, base] of FORMS) {
    for (const step of STEPS) {
      const m = touchMetrics(base * step, base);
      const at = `${form} at ${Math.round(step * 100)} %`;
      assert.equal(m.button + m.gap, m.hit, `${at}: the pitch is the target`);
      // Drawn at 0.8 of the target before its floor: so at 60 % and 70 % a
      // tray still shrinks, its hit boxes held at 32.
      assert.equal(m.button, Math.round(TRAY_SHARE * 44 * step), `${at}: the button 0.8 of the target`);
      assert.ok(m.gap >= 7 && m.gap <= 14, `${at}: a gap of ${m.gap}, not 18`);
      assert.ok(m.icon < m.button && m.icon >= Math.round(m.button * 0.7), `${at}: the glyph fills its button: ${m.icon} in ${m.button}`);
      // A tray's length along its run is what it always was at 100 %: pitch × buttons.
      assert.equal(traySize(11, "column", m).h, m.title + 6 + 11 * m.hit);
      assert.equal(traySize(11, "column", m).w, m.button + 8, "and as thick as a button and its padding");
    }
  }
  const phone = touchMetrics(1.3, 1.3);
  assert.deepEqual([phone.button, phone.gap, phone.icon], [35, 9, 26], "a phone's 100 %: 35 drawn, 9 between, a 26 px glyph");
  const small = touchMetrics(1.3 * 0.8, 1.3);
  assert.deepEqual([small.hit, small.button, small.gap], [35, 28, 7], "80 %: 28 drawn on a 35 pitch");
  const big = touchMetrics(1.3 * 1.3, 1.3);
  assert.deepEqual([big.hit, big.button, big.gap], [57, 46, 11], "130 %: 46 drawn on a 57 pitch");
  // The flyout's items are a tray's buttons, a whole target apart.
  const fly = flyoutSize(3, "row", phone);
  assert.equal(fly.w, 8 + 3 * phone.button + 2 * phone.gap);
});

test("option rows and the command line's row are a target tall; their type is the type it was", () => {
  for (const [form, base] of FORMS) {
    for (const step of STEPS) {
      const m = touchMetrics(base * step, base);
      const at = `${form} at ${Math.round(step * 100)} %`;
      const drawn = scaledMetrics(FINE, base * step);
      assert.equal(m.optionRow, Math.max(drawn.optionRow, m.hit), at);
      assert.equal(m.line, Math.max(drawn.line, m.hit), at);
      assert.equal(m.grip, m.hit, `${at}: a grip draws nothing, it is its target`);
      assert.equal(optionsSize(2, m).h, m.title + 8 + 2 * m.optionRow);
      // Only the hit sizes moved: a strip, the logo and the options' width are the drawn size's.
      assert.deepEqual([m.title, m.logo, m.optionsW, m.logLine], [drawn.title, drawn.logo, drawn.optionsW, drawn.logLine], at);
    }
  }
  // At 80 % an option row is 35 tall where it was 44; at 130 %, 57 where it was 44.
  assert.equal(touchMetrics(1.04, 1.3).optionRow, 35);
  assert.equal(touchMetrics(1.69, 1.3).optionRow, 57);
});

const area = { w: 750, h: 369 };
const iPhone13Landscape: Insets = { top: 0, right: 47, bottom: 21, left: 47 };
const safariPortrait: Insets = { top: 47, right: 0, bottom: 0, left: 0 };
const at = (x: number, y: number, w: number, h: number): Rect => ({ x, y, w, h });

test("bleed: a pane on the bottom edge reaches under the bottom inset, padded by it — and nowhere else", () => {
  const ins = iPhone13Landscape;
  // Docked to the bottom: down to the glass, its content above the home indicator.
  const cmd = bleed(at(100, area.h - 65, 400, 65), area, ins);
  assert.deepEqual(cmd.rect, { x: 147, y: area.h - 65, w: 400, h: 65 + 21 });
  assert.deepEqual(cmd.pad, { top: 0, right: 0, bottom: 21, left: 0 });
  // Against the left edge, by the cutout: drawn exactly at its rectangle — the
  // drag stopped at the safe area's line, and the box stays there.
  const tray = bleed(at(0, 60, 43, 300), area, ins);
  assert.deepEqual(tray.rect, { x: 47, y: 60, w: 43, h: 300 });
  assert.deepEqual(tray.pad, { top: 0, right: 0, bottom: 0, left: 0 });
  // Against the right edge: the same.
  const strip = bleed(at(area.w - 43, 60, 43, 180), area, ins);
  assert.deepEqual(strip.rect, { x: 47 + area.w - 43, y: 60, w: 43, h: 180 });
  // In the bottom-left corner: down, not sideways.
  const log = bleed(at(0, area.h - 60, 300, 60), area, ins);
  assert.deepEqual(log.rect, { x: 47, y: area.h - 60, w: 300, h: 60 + 21 });
  assert.deepEqual(log.pad, { top: 0, right: 0, bottom: 21, left: 0 });
  // Under Safari's status bar: never upward.
  const top = bleed(at(0, 0, 390, 60), { w: 390, h: 617 }, safariPortrait);
  assert.deepEqual(top.rect, { x: 0, y: 47, w: 390, h: 60 });
  assert.deepEqual(top.pad, { top: 0, right: 0, bottom: 0, left: 0 });
});

test("a bled pane never draws over another pane's rectangle: the bleed is only below the safe area, where no rectangle is", () => {
  // Every pane of a row along the bottom, side by side, the corners included,
  // and a stack above them: bled, no two drawn boxes meet.
  const ins = iPhone13Landscape;
  const panes = [at(0, 309, 200, 60), at(200, 309, 350, 60), at(550, 289, 200, 80), at(0, 200, 300, 109), at(700, 0, 50, 289)];
  const drawn = panes.map((r) => bleed(r, area, ins).rect);
  for (let i = 0; i < drawn.length; i++) {
    for (let j = i + 1; j < drawn.length; j++) {
      const [a, b] = [drawn[i], drawn[j]];
      const over = a.x < b.x + b.w && b.x < a.x + a.w && a.y < b.y + b.h && b.y < a.y + a.h;
      assert.ok(!over, `${i} and ${j}: ${JSON.stringify([a, b])}`);
    }
  }
});

// ---- a layout that does not fit is never drawn (the owner's landscape picture) -----------
//
// His iPhone on its side, the log drawn over the command line's body. Not the
// bleed (above: it cannot reach a rectangle); a real overlap — the places he
// left the panes in, re-laid through a rotation, could not all be had, and the
// resolver's no-layout was drawn as it stood. `refit` gives up stored places
// until a layout fits. As Panels.apply lays out, without the DOM.

const PROMAX_UP = { w: 440, h: 956 - 62 - 34 };
const PROMAX_SIDE = { w: 956 - 124, h: 440 - 40 };
const counts = { toolbar: 13, actions: 4 };
const ORDER = ["toolbar", "log", "organiser", "actions", "cmd"];

function laidFrom(area: Size, stored: Record<string, Recorded>, keep: readonly string[], m = COARSE) {
  const logo: Layout = { logo: { x: 0, y: 0, ...logoBox(m), fixed: true } };
  const { options: _o, ...defaults } = defaultLayout(area, 13, m);
  const recs = Object.fromEntries(keep.map((id) => [id, stored[id]]));
  const sizeOf = (id: string, o: "row" | "column" | undefined, lines?: number) =>
    id in counts ? traySize(counts[id as keyof typeof counts], o ?? "column", m, trayRoom(area, o ?? "column", m), lines) : null;
  const minOf = (id: string, o: "row" | "column" | undefined) => minSizeOf(id, o, id in counts, undefined, m);
  const unstored = Object.fromEntries(ORDER.filter((id) => !recs[id]).map((id) => [id, defaults[id]]));
  return arranged(ORDER, relaid(recs, { ...logo, ...unstored }, area, m.scale, sizeOf, minOf), defaults, counts, area, {}, m, logo);
}

test("refit: stored places a rotation cannot all hold give way — those in the way first, then all — and what is drawn fits", () => {
  // Found by the fuzz below: left on its side, re-laid upright.
  const stored: Record<string, Recorded> = {
    log: { x: 607, y: 300, w: 203, h: 60, area: PROMAX_SIDE, scale: 1.3, dock: { left: "toolbar" }, oy: -57 },
    cmd: { x: 427, y: 141, w: 405, h: 65, area: PROMAX_SIDE, scale: 1.3, dock: { right: "edge" } },
    actions: { x: 629, y: 84, w: 203, h: 43, orient: "row", area: PROMAX_SIDE, scale: 1.3, dock: { right: "edge" } },
    organiser: { x: 221, y: 111, w: 203, h: 246, area: PROMAX_SIDE, scale: 1.3, dock: { bottom: "toolbar" }, ox: 213 },
  };
  const all = laidFrom(PROMAX_UP, stored, Object.keys(stored));
  assert.equal(all.ok, false, "every stored place: no layout");
  assert.ok(overlapping(all.layout).length > 0, "and what it leaves has panes over panes — what used to be drawn");
  const { result, dropped } = refit((keep) => laidFrom(PROMAX_UP, stored, keep), Object.keys(stored));
  assert.equal(result.ok, true);
  assert.deepEqual(overlapping(result.layout), []);
  assert.ok(dropped.length > 0 && dropped.length < Object.keys(stored).length, `only those in the way given up: ${dropped}`);
  // A layout that fits as stored gives up nothing.
  const fine = refit((keep) => laidFrom(PROMAX_SIDE, stored, keep), Object.keys(stored));
  assert.deepEqual(fine.dropped, []);
  // Nothing fits even at the defaults: the first result stands, to be reported.
  const never = refit(() => ({ layout: { a: { x: 0, y: 0, w: 9, h: 9 }, b: { x: 1, y: 1, w: 9, h: 9 } }, ok: false }), ["a"]);
  assert.deepEqual(never.dropped, []);
  assert.equal(never.result.ok, false);
});

test("refit, over 300 stored layouts on a Pro Max taken through a rotation: what is drawn never has a pane over another", () => {
  let seed = 11;
  const rnd = () => { seed = (seed * 16807) % 2147483647; return seed / 2147483647; };
  let gaveUp = 0;
  for (let n = 0; n < 300; n++) {
    const from = rnd() < 0.5 ? PROMAX_SIDE : PROMAX_UP;
    const to = from === PROMAX_SIDE ? PROMAX_UP : PROMAX_SIDE;
    const { options: _o, ...d } = defaultLayout(from, 13, COARSE);
    const ids = ORDER.filter(() => rnd() < 0.7);
    const put: Layout = {};
    for (const id of ids) {
      const r = id === "log" || id === "cmd" ? { ...d[id], w: Math.round(160 + rnd() * (from.w - 160)) } : d[id];
      let x = Math.round(rnd() * (from.w - r.w)), y = Math.round(rnd() * (from.h - r.h));
      if (rnd() < 0.5) x = rnd() < 0.5 ? 0 : from.w - r.w;
      if (rnd() < 0.5) y = rnd() < 0.5 ? 0 : from.h - r.h;
      put[id] = { ...r, x, y };
    }
    const logo: Layout = { logo: { x: 0, y: 0, ...logoBox(COARSE), fixed: true } };
    const left = arranged(ORDER, { ...logo, ...put }, d, counts, from, {}, COARSE, logo);
    if (!left.ok) continue;
    const stored = Object.fromEntries(ids.map((id) => [id, recorded(id, left.layout, from, COARSE.scale)]));
    const { result, dropped } = refit((keep) => laidFrom(to, stored, keep), ids);
    if (dropped.length) gaveUp++;
    assert.equal(result.ok, true, `case ${n}`);
    assert.deepEqual(overlapping(result.layout), [], `case ${n}`);
  }
  assert.ok(gaveUp > 0, "some needed it — the fuzz reaches the case");
});
