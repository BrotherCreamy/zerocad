// No title bar (docs/plans/chrome-logo-scale.md), as pure functions: the
// interface size — the metrics it scales, its storage, its defaults per
// pointer and its spin box; a panel to the very edge (`bleed`); the logo as
// the one thing in the layout that never moves; docking that survives a
// rotation, and the stored layout's migration; the status line's fade rules;
// the app menu's commands; and the logo and the home-screen icon being one
// mark. What only a browser can show is chrome.e2e.ts's.

import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import {
  COARSE, FINE, NO_INSETS, STORAGE_KEY, LAYOUT_KEY, arranged, bleed, defaultLayout, dockingOf, logoBox, loadStored,
  overlapping, pushed, recorded, relaid, saveStored, scaledMetrics, traySize,
  type Layout, type Metrics, type Recorded, type Size, type StorageLike,
} from "../src/panels.ts";
import {
  UI_MAX, UI_MIN, UI_SCALE_KEY, clampScale, defaultScale, formatScale, recallScale, rememberScale, stepScale,
} from "../src/uiscale.ts";
import { GUIDE_NOTE_MS, STATUS_FADE_MS, STEP_NOTE_MS, StatusLine, statusFade, type TextLike } from "../src/statusline.ts";
import { FILE_ITEMS, UNTITLED, fileItemOff, paneCommand, scaleCommand, spinCommands } from "../src/appmenu.ts";
import { iconSvg, logoMark } from "../src/logo.ts";

function memory(): { storage: StorageLike; store: Map<string, string> } {
  const store = new Map<string, string>();
  return {
    store,
    storage: {
      getItem: (k) => store.get(k) ?? null,
      setItem: (k, v) => { store.set(k, v); },
      removeItem: (k) => { store.delete(k); },
    },
  };
}

// ---- the interface size -----------------------------------------------------

test("the metrics scale: every size field multiplied and rounded, the flags kept, the factor clamped", () => {
  const m = scaledMetrics(COARSE, 0.7);
  for (const k of Object.keys(COARSE) as (keyof Metrics)[]) {
    if (k === "coarse") assert.equal(m.coarse, true);
    else if (k === "scale") assert.equal(m.scale, 0.7);
    else assert.equal(m[k], Math.round((COARSE[k] as number) * 0.7), `${k}`);
  }
  assert.equal(m.button, 31, "a finger's tool button at the default is 31 px, not 44");
  assert.deepEqual(scaledMetrics(FINE, 1), FINE, "100 % is the mouse's look exactly");
  assert.equal(scaledMetrics(FINE, 9).scale, UI_MAX, "held to the range");
  assert.equal(scaledMetrics(FINE, 0.01).scale, UI_MIN);
  assert.equal(scaledMetrics(FINE, Number.NaN).scale, 1, "and nonsense is 100 %");
  assert.deepEqual(traySize(3, "column", scaledMetrics(FINE, 1.5)), { w: 30 + 8, h: 24 + 6 + 3 * 32 });
});

test("the scale's defaults per pointer, its ladder, and how it reads", () => {
  assert.equal(defaultScale(false), 1, "a mouse: today's look, unchanged");
  assert.equal(defaultScale(true), 0.7, "a finger: 31 px buttons");
  assert.equal(clampScale(0.8000001), 0.8);
  assert.equal(clampScale(3), UI_MAX);
  assert.equal(clampScale(0.2), UI_MIN);
  assert.equal(clampScale("0.8"), null);
  assert.equal(clampScale(Infinity), null);
  assert.equal(stepScale(0.7, 1), 0.8);
  assert.equal(stepScale(0.7, -1), 0.6);
  assert.equal(stepScale(0.75, 1), 0.8, "off the ladder, + goes to the next step up");
  assert.equal(stepScale(0.75, -1), 0.7);
  assert.equal(stepScale(1.6, 1), 1.6, "and the ends hold");
  assert.equal(stepScale(0.6, -1), 0.6);
  assert.equal(stepScale(0.1 * 3 + 0.5, 1), 0.9, "float noise is on the step it is next to");
  assert.equal(formatScale(0.8), "80%");
});

test("the scale is stored per device, and forgetting it is the device's default", () => {
  const { storage, store } = memory();
  assert.equal(recallScale(storage), null, "nothing chosen: the default, which is not stored");
  assert.equal(rememberScale(storage, 0.8), true);
  assert.equal(store.get(UI_SCALE_KEY), "0.8");
  assert.equal(recallScale(storage), 0.8);
  store.set(UI_SCALE_KEY, "9");
  assert.equal(recallScale(storage), UI_MAX, "a stored value out of range is held to it");
  store.set(UI_SCALE_KEY, "big");
  assert.equal(recallScale(storage), null, "and one that is not a number is nothing");
  rememberScale(storage, null);
  assert.equal(store.has(UI_SCALE_KEY), false, "the default removes the key");
  const hostile = { getItem: () => { throw new Error("SecurityError"); }, setItem: () => { throw new Error("x"); }, removeItem: () => { throw new Error("x"); } };
  assert.equal(recallScale(hostile), null);
  assert.equal(rememberScale(hostile, 0.8), false);
  assert.equal(rememberScale(null, 0.8), false);
});

test("the spin box types ui({ scale }), 10 % a press; the number types the default; the ends are off", () => {
  assert.equal(scaleCommand(0.8), "ui({ scale: 0.8 })");
  assert.equal(scaleCommand("default"), 'ui({ scale: "default" })');
  assert.deepEqual(spinCommands(0.7), { down: "ui({ scale: 0.6 })", up: "ui({ scale: 0.8 })" });
  assert.deepEqual(spinCommands(UI_MIN), { down: null, up: "ui({ scale: 0.7 })" });
  assert.deepEqual(spinCommands(UI_MAX), { down: "ui({ scale: 1.5 })", up: null });
});

// ---- the logo, the one fixed thing ------------------------------------------

test("the logo's box: the mark and a margin, never under a finger's 44 px", () => {
  assert.deepEqual(logoBox(FINE), { w: 36, h: 36 });
  const phone = scaledMetrics(COARSE, 0.7);
  assert.equal(phone.logo, 24, "the mark at a phone's default is 24 px — the spec's 22–28");
  assert.deepEqual(logoBox(phone), { w: 44, h: 44 });
  assert.deepEqual(logoBox(scaledMetrics(COARSE, 1.6)), { w: 54 + 20, h: 54 + 20 });
});

test("a push stops at the logo: it is in the layout, and nothing moves it", () => {
  const area = { w: 400, h: 400 };
  const layout: Layout = {
    logo: { x: 0, y: 0, w: 36, h: 36, fixed: true },
    log: { x: 0, y: 40, w: 100, h: 40 },
  };
  // The log dragged up into the logo: it stops flush under it, and the logo stays.
  const r = pushed("log", { x: 0, y: 10, w: 100, h: 40 }, layout, area, {}, { x: 0, y: -30 });
  assert.deepEqual(r.layout.logo, layout.logo);
  assert.equal(r.rect.y, 36, "flush with the logo's bottom");
  assert.equal(r.ok, false);
  // A panel put down on it (a stored layout, a default) is pushed off it, never the logo off the panel.
  const s = arranged(["log"], { log: { x: 0, y: 0, w: 100, h: 40 } }, {}, {}, area, {}, FINE, { logo: layout.logo });
  assert.deepEqual(s.layout.logo, layout.logo);
  assert.deepEqual(overlapping(s.layout), []);
});

// ---- to the very edge -------------------------------------------------------

const PHONE = { top: 47, right: 0, bottom: 34, left: 0 };
const AREA: Size = { w: 390, h: 844 - 47 - 34 };

test("a panel touching an inset edge reaches under the inset and pads by it; elsewhere it is drawn where it is", () => {
  // Docked to the bottom of a portrait phone, full width: ground under the
  // home indicator, content above it.
  const cmd = { x: 0, y: AREA.h - 62, w: AREA.w, h: 62 };
  assert.deepEqual(bleed(cmd, AREA, PHONE), {
    rect: { x: 0, y: 47 + AREA.h - 62, w: 390, h: 62 + 34 },
    pad: { top: 0, right: 0, bottom: 34, left: 0 },
  });
  // …so its bottom edge is the screen's.
  const b = bleed(cmd, AREA, PHONE).rect;
  assert.equal(b.y + b.h, 844);
  // At the top, under the status bar.
  assert.deepEqual(bleed({ x: 100, y: 0, w: 50, h: 40 }, AREA, PHONE),
    { rect: { x: 100, y: 0, w: 50, h: 87 }, pad: { top: 47, right: 0, bottom: 0, left: 0 } });
  // Floating: offset into the safe area, nothing padded.
  assert.deepEqual(bleed({ x: 10, y: 10, w: 50, h: 40 }, AREA, PHONE),
    { rect: { x: 10, y: 57, w: 50, h: 40 }, pad: NO_INSETS });
  // A landscape notch's side.
  const land = { top: 0, right: 47, bottom: 21, left: 47 };
  assert.deepEqual(bleed({ x: 0, y: 100, w: 40, h: 200 }, { w: 750, h: 369 }, land),
    { rect: { x: 0, y: 100, w: 87, h: 200 }, pad: { top: 0, right: 0, bottom: 0, left: 47 } });
  // Touching an edge with no inset (a desktop): touching, nothing to reach under.
  assert.deepEqual(bleed(cmd, AREA, NO_INSETS), { rect: cmd, pad: NO_INSETS });
});

test("the phone's portrait default docks the command line to the bottom, edge to edge", () => {
  const m = scaledMetrics(COARSE, 0.7);
  const d = defaultLayout(AREA, 11, m);
  assert.deepEqual(d.cmd, { x: 0, y: AREA.h - (m.title + m.line), w: AREA.w, h: m.title + m.line });
  assert.deepEqual(dockingOf("cmd", d, AREA), { left: "edge", right: "edge", bottom: "edge" });
  const logo = logoBox(m);
  assert.ok(d.toolbar.y >= logo.h, "the tray starts under the logo");
  const r = arranged(Object.keys(d).filter((k) => k !== "options"), {}, d, { toolbar: 11, actions: 4 }, AREA, {}, m,
    { logo: { x: 0, y: 0, ...logo, fixed: true } });
  assert.ok(r.ok);
  assert.deepEqual(overlapping(r.layout), []);
});

// ---- docking, through a rotation --------------------------------------------

const PORTRAIT: Size = { w: 390, h: 763 };
const LANDSCAPE: Size = { w: 750, h: 369 };

test("what a side rests against: the area's edge first, then a panel it is flush with and overlaps", () => {
  const layout: Layout = {
    toolbar: { x: 352, y: 100, w: 38, h: 400, orient: "column" },
    log: { x: 200, y: 120, w: 152, h: 60 },
    cmd: { x: 0, y: 700, w: 390, h: 63 },
    off: { x: 200, y: 600, w: 152, h: 60 },
  };
  assert.deepEqual(dockingOf("toolbar", layout, PORTRAIT), { right: "edge", left: "log" });
  assert.deepEqual(dockingOf("log", layout, PORTRAIT), { right: "toolbar" });
  assert.deepEqual(dockingOf("cmd", layout, PORTRAIT), { left: "edge", right: "edge", bottom: "edge" });
  assert.deepEqual(dockingOf("off", layout, PORTRAIT), {}, "flush with the toolbar's line but not beside it: nothing");
});

/** Sizes as the panel manager has them: the tray its line, the others the viewer's. */
const sizeOf = (id: string, orient: "row" | "column" | undefined) =>
  id === "toolbar" ? traySize(11, orient ?? "column", scaledMetrics(COARSE, 0.7)) : null;
const minOf = () => ({ w: 80, h: 40 });

test("a tray docked right and a pane against it stay so through portrait → landscape → portrait; a floating pane keeps its share and stays inside", () => {
  const bar = traySize(11, "column", scaledMetrics(COARSE, 0.7));
  const shown: Layout = {
    toolbar: { x: PORTRAIT.w - bar.w, y: 200, ...bar, orient: "column" },
    log: { x: PORTRAIT.w - bar.w - 160, y: 260, w: 160, h: 60 },
    float: { x: 20, y: 400, w: 120, h: 60 },
  };
  const recs: Record<string, Recorded> = {};
  for (const id of Object.keys(shown)) recs[id] = recorded(id, shown, PORTRAIT, 0.7);
  assert.equal(recs.toolbar.dock.right, "edge");
  assert.equal(recs.log.dock.right, "toolbar");
  for (const area of [LANDSCAPE, PORTRAIT, LANDSCAPE]) {
    const out = relaid(recs, {}, area, 0.7, sizeOf, minOf);
    const r = arranged(["toolbar", "log", "float"], out, {}, { toolbar: 11 }, area, {}, scaledMetrics(COARSE, 0.7));
    const l = r.layout;
    assert.equal(l.toolbar.x + l.toolbar.w, area.w, `the tray against the right edge in ${area.w}×${area.h}`);
    assert.equal(l.log.x + l.log.w, l.toolbar.x, "and the log against the tray's left");
    assert.ok(l.log.y + l.log.h > l.toolbar.y && l.log.y < l.toolbar.y + l.toolbar.h, "beside it, not off its end");
    for (const [id, p] of Object.entries(l)) {
      assert.ok(p.x >= 0 && p.y >= 0 && p.x + p.w <= area.w && p.y + p.h <= area.h, `${id} inside ${JSON.stringify(p)}`);
    }
    // The floating one: the same share of the free room across.
    const share = (shown.float.x) / (PORTRAIT.w - shown.float.w);
    assert.ok(Math.abs(l.float.x - share * (area.w - l.float.w)) < 1e-6, `the floating pane ${share.toFixed(3)} of the way across`);
    assert.deepEqual(overlapping(l), []);
  }
});

test("docked to both sides, a pane the viewer sizes spans the new width; its height follows the interface size", () => {
  const shown: Layout = { cmd: { x: 0, y: PORTRAIT.h - 62, w: PORTRAIT.w, h: 62 } };
  const recs = { cmd: recorded("cmd", shown, PORTRAIT, 0.7) };
  const out = relaid(recs, {}, LANDSCAPE, 1.4, sizeOf, minOf);
  assert.deepEqual(out.cmd, { x: 0, y: LANDSCAPE.h - 124, w: LANDSCAPE.w, h: 124 });
});

test("resting on another pane's top with its sides free, a pane stays the same distance along it", () => {
  const shown: Layout = {
    toolbar: { x: 0, y: PORTRAIT.h - 39, w: 360, h: 39, orient: "row" },
    log: { x: 50, y: PORTRAIT.h - 39 - 60, w: 160, h: 60 },
  };
  const recs = { toolbar: recorded("toolbar", shown, PORTRAIT, 0.7), log: recorded("log", shown, PORTRAIT, 0.7) };
  assert.deepEqual(recs.log.dock, { bottom: "toolbar" });
  assert.equal(recs.log.ox, 50);
  const rowOf = () => ({ w: 360, h: 39 });
  const out = relaid(recs, {}, LANDSCAPE, 0.7, (id) => (id === "toolbar" ? rowOf() : null), minOf);
  assert.equal(out.toolbar.y + out.toolbar.h, LANDSCAPE.h, "the row on the bottom edge");
  assert.equal(out.log.y + out.log.h, out.toolbar.y, "the log still on the row");
  assert.equal(out.log.x - out.toolbar.x, 50, "the same 50 px along it");
});

test("a tray whose line no longer fits along its edge turns, and keeps the edge", () => {
  const m = scaledMetrics(COARSE, 1);
  const row = traySize(11, "row", m);
  const shown: Layout = { toolbar: { x: 0, y: LANDSCAPE.h - row.h, ...row, orient: "row" } };
  const recs = { toolbar: recorded("toolbar", shown, { w: 800, h: LANDSCAPE.h }, 1) };
  const out = relaid(recs, {}, PORTRAIT, 1, (_id, o) => traySize(11, o ?? "row", m), minOf);
  assert.equal(out.toolbar.orient, "column", "556 px of row does not fit 390 px across");
  assert.equal(out.toolbar.y + out.toolbar.h, PORTRAIT.h, "still on the bottom edge");
  assert.equal(out.toolbar.x, 0, "and the left");
});

test("a side against a pane that is gone is against nothing", () => {
  const shown: Layout = { toolbar: { x: 0, y: 0, w: 38, h: 300, orient: "column" }, log: { x: 38, y: 100, w: 160, h: 60 } };
  const recs = { log: recorded("log", shown, PORTRAIT, 1) };
  const out = relaid(recs, {}, LANDSCAPE, 1, () => null, minOf);
  assert.ok(Number.isFinite(out.log.x) && Number.isFinite(out.log.y));
});

test("the stored layout: v3 round-trips leniently; a v2 one is migrated, not dropped", () => {
  const { storage, store } = memory();
  assert.equal(LAYOUT_KEY, "neocad.panels.v3");
  const rec = recorded("log", { log: { x: 0, y: 10, w: 100, h: 50 } }, PORTRAIT, 0.7);
  assert.equal(saveStored(storage, { log: { at: rec }, toolbar: { hidden: true } }), true);
  assert.deepEqual(loadStored(storage).stored, { log: { at: rec }, toolbar: { hidden: true } });
  store.set(LAYOUT_KEY, JSON.stringify({ panels: { log: { at: { ...rec, dock: { left: 3 } } }, bad: { at: { x: "a" } }, cmd: 7 } }));
  const lenient = loadStored(storage).stored;
  assert.deepEqual(lenient.log.at!.dock, {}, "a side that is not one is dropped alone");
  assert.equal(lenient.bad, undefined);
  assert.equal(lenient.cmd, undefined);
  // A v2 layout: no v3 yet, so it is read as the old rectangles, for the host to migrate.
  store.delete(LAYOUT_KEY);
  store.set(STORAGE_KEY, JSON.stringify({ log: { x: 1, y: 2, w: 300, h: 100 } }));
  const old = loadStored(storage);
  assert.deepEqual(old.stored, {});
  assert.deepEqual(old.legacy, { log: { x: 1, y: 2, w: 300, h: 100 } });
  saveStored(storage, {});
  assert.equal(store.has(LAYOUT_KEY), false, "an empty one leaves nothing behind");
  assert.equal(store.has(STORAGE_KEY), false, "and the v2 key goes once v3 is written");
});

// ---- the status line --------------------------------------------------------

test("the status fades when it says all is well, and stays when it says something is wrong; the text stays either way", () => {
  assert.equal(statusFade("ready"), STATUS_FADE_MS);
  assert.equal(statusFade("solved"), STATUS_FADE_MS);
  assert.equal(statusFade("conflict"), null);
  assert.equal(statusFade("error"), null);
  assert.equal(statusFade("loading"), null);
  const timers: { fn: () => void; ms: number; live: boolean }[] = [];
  const fake = {
    set: (fn: () => void, ms: number) => { const t = { fn, ms, live: true }; timers.push(t); return t; },
    clear: (h: unknown) => { if (h) (h as { live: boolean }).live = false; },
  };
  const el = (): TextLike => ({ textContent: "", className: "", dataset: {} });
  const [status, note] = [el(), el()];
  const line = new StatusLine(status, note, fake);
  line.show("solved", "SOLVED");
  assert.equal(status.className, "solved");
  timers.at(-1)!.fn();
  assert.equal(status.dataset.faded, "", "faded after its time");
  assert.equal(status.textContent, "SOLVED", "but still saying it");
  line.show("conflict", "CONFLICT: d1");
  assert.equal(status.dataset.faded, undefined, "a new status is shown again");
  assert.equal(status.className, "bad");
  assert.ok(timers.every((t) => !t.live), "and a conflict has no fade waiting");
  line.show("solved", "SOLVED");
  assert.equal(timers.filter((t) => t.live).length, 1);
  line.note("undid");
  assert.equal(timers.at(-1)!.ms, STEP_NOTE_MS);
  line.note("click inside a closed outline", GUIDE_NOTE_MS, "guide");
  assert.equal(line.noteClass, "guide");
  timers.at(-1)!.fn();
  assert.equal(note.textContent, "", "a note goes, text and all, as it always did");
});

// ---- the app menu -----------------------------------------------------------

test("the File items: the four commands, each off with its reason until it exists", () => {
  assert.deepEqual(FILE_ITEMS.map((i) => i.command), ["newFile()", "openFile()", "saveFile()", "shareFile()"]);
  const only = (names: string[]) => (n: string) => names.includes(n);
  assert.equal(fileItemOff(FILE_ITEMS[1], only(["openFile"])), null);
  assert.match(fileItemOff(FILE_ITEMS[0], only(["openFile"]))!, /newFile\(\) is not in this build yet/);
  assert.deepEqual(UNTITLED, { name: "Untitled", dirty: false });
  assert.equal(paneCommand("log", false), 'ui({ hide: "log" })');
  assert.equal(paneCommand("cmd", true), 'ui({ show: "cmd" })');
});

// ---- one mark ---------------------------------------------------------------

test("the home-screen icon is the logo: public/icons/icon.svg is iconSvg(), the mark inside the maskable circle", () => {
  const onDisk = readFileSync(new URL("../public/icons/icon.svg", import.meta.url), "utf8");
  assert.equal(onDisk, iconSvg(), "regenerate with npm run build:icons");
  assert.ok(iconSvg().includes(logoMark()));
});
