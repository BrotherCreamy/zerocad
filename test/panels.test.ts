// The panel manager's arithmetic and its storage, without a DOM: what a drag or
// a resize does to a rectangle, what keeps a panel reachable, the defaults, and
// a stored layout's round trip — including through a storage that throws on
// every touch, which is what a private window hands the app.
//
// The browser half (pointer capture, gestures not crossing, persistence across
// a real reload) is test/e2e/panels.e2e.ts.

import { test } from "node:test";
import { readFile } from "node:fs/promises";
import assert from "node:assert/strict";
import {
  KEEP, TITLE_H, BUTTON_H, STORAGE_KEY,
  armCommand, constrain, defaultLayout, describeLayout, loadLayout, moved, parseLayout, resized, saveLayout,
  type Rect, type StorageLike,
} from "../src/panels.ts";
import { neocadScope } from "../src/replenv.ts";
import { Model } from "../src/model.ts";
import { ensureKernelLoaded } from "../src/kernel/problem.ts";

const area = { w: 1000, h: 700 };
const min = { w: 100, h: 50 };

test("a drag moves a panel by exactly the pointer's travel", () => {
  const r: Rect = { x: 100, y: 100, w: 200, h: 150 };
  assert.deepEqual(moved(r, 37, -12, area, min), { x: 137, y: 88, w: 200, h: 150 });
});

test("a panel's title strip is always reachable", () => {
  const r: Rect = { x: 100, y: 100, w: 200, h: 150 };
  // Off the top: never — the strip would be under the header, or gone.
  assert.equal(moved(r, 0, -500, area, min).y, 0);
  // Off the bottom: the strip stays wholly inside.
  assert.equal(moved(r, 0, 5000, area, min).y, area.h - TITLE_H);
  // Off either side: KEEP pixels of it stay inside.
  assert.equal(moved(r, 5000, 0, area, min).x, area.w - KEEP);
  assert.equal(moved(r, -5000, 0, area, min).x, KEEP - r.w);
});

test("a panel narrower than KEEP stays wholly inside sideways", () => {
  const narrow: Rect = { x: 0, y: 0, w: 30, h: 60 };
  const c = constrain({ ...narrow, x: -100 }, area, { w: 20, h: 20 });
  assert.equal(c.x, 0);
  assert.equal(constrain({ ...narrow, x: 5000 }, area, { w: 20, h: 20 }).x, area.w - 30);
});

test("a resize follows the grip, stopping at the minimum and at the area's far edges", () => {
  const r: Rect = { x: 100, y: 100, w: 200, h: 150 };
  assert.deepEqual(resized(r, 50, 20, area, min), { x: 100, y: 100, w: 250, h: 170 });
  assert.deepEqual(resized(r, -1000, -1000, area, min), { x: 100, y: 100, w: 100, h: 50 }, "the minimum");
  assert.deepEqual(resized(r, 5000, 5000, area, min), { x: 100, y: 100, w: 900, h: 600 },
    "the grip goes no further than the area's right and bottom edges");
});

test("a window too small for a panel shrinks it to fit, never below its minimum", () => {
  const big: Rect = { x: 0, y: 0, w: 900, h: 600 };
  const small = { w: 400, h: 300 };
  assert.deepEqual(constrain(big, small, min), { x: 0, y: 0, w: 400, h: 300 });
  assert.deepEqual(constrain(big, { w: 50, h: 20 }, min).w, 100, "the minimum wins over a tiny window");
});

test("the defaults: a toolbar on the left sized to its buttons, log and command line at the bottom", () => {
  const d = defaultLayout(area, 10);
  assert.equal(d.toolbar.h, TITLE_H + 6 + 10 * BUTTON_H, "tall enough for every button");
  assert.equal(defaultLayout(area, 11).toolbar.h - d.toolbar.h, BUTTON_H, "and one button taller per tool");
  assert.equal(d.cmd.y + d.cmd.h, area.h - 8, "the command line on the bottom edge");
  assert.ok(d.log.y + d.log.h <= d.cmd.y, "the log above it, not on it");
  assert.equal(d.log.x, d.cmd.x);
  assert.equal(d.log.w, d.cmd.w, "the two read as one column");
  assert.ok(d.toolbar.y + d.toolbar.h < d.log.y, "the toolbar clear of the log");
  for (const [id, r] of Object.entries(d)) {
    assert.deepEqual(constrain(r, area, { w: 1, h: 1 }), r, `${id}'s default needs no constraining`);
  }
  // A narrow window: the bottom pair narrows with it rather than hanging off.
  assert.equal(defaultLayout({ w: 400, h: 700 }, 10).log.w, 400 - 16);
});

test("a stored layout round-trips, and a bad entry costs only its own panel", () => {
  const store = new Map<string, string>();
  const storage: StorageLike = {
    getItem: (k) => store.get(k) ?? null,
    setItem: (k, v) => { store.set(k, v); },
    removeItem: (k) => { store.delete(k); },
  };
  const layout = { log: { x: 10, y: 20, w: 300, h: 100 }, toolbar: { x: 1, y: 2, w: 90, h: 200 } };
  assert.equal(saveLayout(storage, layout), true);
  assert.deepEqual(loadLayout(storage), layout);

  store.set(STORAGE_KEY, JSON.stringify({ log: { x: 1, y: 2, w: 3, h: 4 }, toolbar: { x: "a" }, cmd: null }));
  assert.deepEqual(loadLayout(storage), { log: { x: 1, y: 2, w: 3, h: 4 } });
  assert.deepEqual(parseLayout("{not json"), {});
  assert.deepEqual(parseLayout("[1,2]"), {});
  assert.deepEqual(parseLayout(JSON.stringify({ log: { x: 1, y: 2, w: Infinity, h: 4 } })), {}, "finite numbers only");

  // An empty layout — a reset — removes the key rather than storing `{}`.
  saveLayout(storage, {});
  assert.equal(store.has(STORAGE_KEY), false);
});

test("a storage that throws on every touch is no layout, and never an exception", () => {
  const hostile: StorageLike = {
    getItem: () => { throw new Error("SecurityError"); },
    setItem: () => { throw new Error("QuotaExceededError"); },
    removeItem: () => { throw new Error("SecurityError"); },
  };
  assert.deepEqual(loadLayout(hostile), {});
  assert.equal(saveLayout(hostile, { log: { x: 0, y: 0, w: 1, h: 1 } }), false);
  assert.equal(saveLayout(hostile, {}), false);
  assert.deepEqual(loadLayout(null), {}, "and no storage at all is the same");
  assert.equal(saveLayout(null, {}), false);
});

test("layout() says where each panel is and which were moved", () => {
  const shown = { toolbar: { x: 8, y: 8, w: 96, h: 242 }, log: { x: 300.4, y: 20, w: 400, h: 150 } };
  const text = describeLayout(shown, { log: shown.log });
  assert.equal(text, "toolbar  8,8  96x242  (default)\nlog      300,20  400x150");
});

test("a button's command is arm() with the name quoted as JSON", () => {
  assert.equal(armCommand("line"), 'arm("line")');
  assert.equal(armCommand('odd"name'), 'arm("odd\\"name")');
});

test("layout is a viewport command: it says so with no viewport, and help() lists it", async () => {
  await ensureKernelLoaded(await readFile(new URL("../src/kernel/wasm-gen/neocad_kernel_bg.wasm", import.meta.url)));
  const scope = neocadScope({ model: new Model(3) });
  assert.throws(() => (scope.layout as () => string)(), /no viewport/);
  assert.match((scope.help as () => string)(), /layout\(\)\s+layout\("reset"\)/);
  let asked: string | undefined = "never";
  const hosted = neocadScope({ model: new Model(3), layout: (c) => { asked = c; return "ok"; } });
  assert.equal((hosted.layout as (c?: string) => string)("reset"), "ok");
  assert.equal(asked, "reset", "the argument goes to the host untouched");
});
