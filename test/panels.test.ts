// The panel manager's arithmetic and its storage, without a DOM: what a drag or
// a resize does to a rectangle, what keeps a panel wholly inside, which way a
// tray runs against the edges it meets, the defaults, and a stored layout's
// round trip — including through a storage that throws on every touch, which is
// what a private window hands the app.
//
// The browser half (pointer capture, gestures not crossing, persistence across
// a real reload) is test/e2e/panels.e2e.ts.

import { test } from "node:test";
import { readFile } from "node:fs/promises";
import assert from "node:assert/strict";
import {
  TITLE_H, BUTTON_STEP, TRAY_DEPTH, SNAP, STORAGE_KEY,
  armCommand, buttonTitle, constrain, contacts, defaultLayout, describeLayout, loadLayout, moved, orientationFor,
  parseLayout, resized, saveLayout, traySize, turned,
  type Orientation, type Rect, type Size, type StorageLike,
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

/** Every pixel of `r` is inside `area`. */
function inside(r: Rect, a: Size): boolean {
  return r.x >= 0 && r.y >= 0 && r.x + r.w <= a.w && r.y + r.h <= a.h;
}

test("a panel is held wholly inside the area, pushed off any side", () => {
  const r: Rect = { x: 100, y: 100, w: 200, h: 150 };
  // Each side, and each corner, flush against it — not a pixel past.
  assert.deepEqual(moved(r, 0, -500, area, min), { ...r, y: 0 }, "the top");
  assert.deepEqual(moved(r, 0, 5000, area, min), { ...r, y: area.h - r.h }, "the bottom");
  assert.deepEqual(moved(r, -5000, 0, area, min), { ...r, x: 0 }, "the left");
  assert.deepEqual(moved(r, 5000, 0, area, min), { ...r, x: area.w - r.w }, "the right");
  assert.deepEqual(moved(r, 5000, 5000, area, min), { ...r, x: area.w - r.w, y: area.h - r.h }, "a corner");
  assert.deepEqual(moved(r, -5000, -5000, area, min), { ...r, x: 0, y: 0 }, "the opposite corner");
});

test("constrain never leaves a pixel outside, wherever and however big the panel asked for", () => {
  // A seeded walk over positions far off every side and sizes up to twice the
  // area's, so a regression at any one edge cannot hide behind the others.
  let seed = 7;
  const rand = () => ((seed = (seed * 1103515245 + 12345) % 2147483648) / 2147483648);
  for (let i = 0; i < 2000; i++) {
    const want: Rect = { x: (rand() - 0.5) * 4000, y: (rand() - 0.5) * 3000, w: rand() * 2 * area.w, h: rand() * 2 * area.h };
    const c = constrain(want, area, min);
    assert.ok(inside(c, area), `${JSON.stringify(want)} came out at ${JSON.stringify(c)}`);
    assert.ok(c.w >= min.w && c.h >= min.h, "and no smaller than its minimum");
  }
});

test("a stored position from a bigger window is pulled wholly in", () => {
  // Where the old rule left it: KEEP pixels of its strip on screen.
  assert.deepEqual(constrain({ x: 960, y: 690, w: 300, h: 200 }, area, min), { x: 700, y: 500, w: 300, h: 200 });
  assert.deepEqual(constrain({ x: -260, y: -40, w: 300, h: 200 }, area, min), { x: 0, y: 0, w: 300, h: 200 });
});

test("a resize follows the grip, stopping at the minimum and at the area's far edges", () => {
  const r: Rect = { x: 100, y: 100, w: 200, h: 150 };
  assert.deepEqual(resized(r, 50, 20, area, min), { x: 100, y: 100, w: 250, h: 170 });
  assert.deepEqual(resized(r, -1000, -1000, area, min), { x: 100, y: 100, w: 100, h: 50 }, "the minimum");
  assert.deepEqual(resized(r, 5000, 5000, area, min), { x: 100, y: 100, w: 900, h: 600 },
    "the grip goes no further than the area's right and bottom edges");
});

test("a resize cannot push a panel out either", () => {
  const r: Rect = { x: 850, y: 600, w: 100, h: 60 };
  const grown = resized(r, 5000, 5000, area, min);
  assert.ok(inside(grown, area));
  assert.deepEqual(grown, { x: 850, y: 600, w: 150, h: 100 }, "the grip stops at the right and bottom edges");
});

test("a window too small for a panel shrinks it to fit, never below its minimum", () => {
  const big: Rect = { x: 0, y: 0, w: 900, h: 600 };
  const small = { w: 400, h: 300 };
  assert.deepEqual(constrain(big, small, min), { x: 0, y: 0, w: 400, h: 300 });
  assert.deepEqual(constrain({ ...big, x: 300, y: 200 }, small, min), { x: 0, y: 0, w: 400, h: 300 },
    "from anywhere: shrunk to the area is placed on it");
  // Smaller than the minimum is the one case that cannot fit. It spills off
  // the right and bottom only, its strip at the top-left where it can be taken.
  assert.deepEqual(constrain({ ...big, x: 30, y: 30 }, { w: 50, h: 20 }, min), { x: 0, y: 0, w: 100, h: 50 });
});

test("the defaults: a toolbar column on the left sized to its buttons, log and command line at the bottom", () => {
  const d = defaultLayout(area, 10);
  assert.equal(d.toolbar.orient, "column");
  assert.equal(d.toolbar.w, TRAY_DEPTH, "one button wide");
  assert.equal(d.toolbar.h, TITLE_H + 6 + 10 * BUTTON_STEP, "tall enough for every button");
  assert.equal(defaultLayout(area, 11).toolbar.h - d.toolbar.h, BUTTON_STEP, "and one button taller per tool");
  assert.equal(d.cmd.y + d.cmd.h, area.h - 8, "the command line on the bottom edge");
  assert.ok(d.log.y + d.log.h <= d.cmd.y, "the log above it, not on it");
  assert.equal(d.log.x, d.cmd.x);
  assert.equal(d.log.w, d.cmd.w, "the two read as one column");
  assert.ok(d.toolbar.y + d.toolbar.h < d.log.y, "the toolbar clear of the log");
  for (const [id, r] of Object.entries(d)) {
    const { orient: _, ...rect } = r;
    assert.deepEqual(constrain(rect, area, { w: 1, h: 1 }), rect, `${id}'s default needs no constraining`);
  }
  // Nor turning: the defaults sit a margin off every edge, which is more than
  // the snap distance, so the untouched toolbar can be dragged sideways along
  // the top without becoming a row on the way.
  const others = [d.log, d.cmd];
  assert.ok(SNAP < 8);
  assert.equal(orientationFor({ ...d.toolbar, x: 300 }, "column", area, others), "column");
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
  const layout = { log: { x: 10, y: 20, w: 300, h: 100 }, toolbar: { x: 1, y: 2, w: 200, h: 28, orient: "row" as const } };
  assert.equal(saveLayout(storage, layout), true);
  assert.deepEqual(loadLayout(storage), layout, "a tray's orientation goes with its rectangle");

  store.set(STORAGE_KEY, JSON.stringify({ log: { x: 1, y: 2, w: 3, h: 4 }, toolbar: { x: "a" }, cmd: null }));
  assert.deepEqual(loadLayout(storage), { log: { x: 1, y: 2, w: 3, h: 4 } });
  store.set(STORAGE_KEY, JSON.stringify({ toolbar: { x: 1, y: 2, w: 3, h: 4, orient: "diagonal" } }));
  assert.deepEqual(loadLayout(storage), { toolbar: { x: 1, y: 2, w: 3, h: 4 } },
    "an orientation that is not one is dropped alone, and the tray runs its default way");
  assert.deepEqual(parseLayout("{not json"), {});
  assert.deepEqual(parseLayout("[1,2]"), {});
  assert.deepEqual(parseLayout(JSON.stringify({ log: { x: 1, y: 2, w: Infinity, h: 4 } })), {}, "finite numbers only");

  // An empty layout — a reset — removes the key rather than storing `{}`.
  saveLayout(storage, {});
  assert.equal(store.has(STORAGE_KEY), false);

  // The key is v2. A v1 layout — where a panel could hang mostly off an edge,
  // and no tray had a way of running — is not read: the defaults, for free.
  assert.equal(STORAGE_KEY, "neocad.panels.v2");
  store.set("neocad.panels.v1", JSON.stringify({ log: { x: 1, y: 2, w: 300, h: 100 } }));
  assert.deepEqual(loadLayout(storage), {});
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

test("layout() says where each panel is, which way a tray runs, and which were moved", () => {
  const shown = { toolbar: { x: 8, y: 8, w: 28, h: 264, orient: "column" as const }, log: { x: 300.4, y: 20, w: 400, h: 150 } };
  const text = describeLayout(shown, { log: shown.log });
  assert.equal(text, "toolbar  8,8  28x264  column  (default)\nlog      300,20  400x150");
});

test("a button's command is arm() with the name quoted as JSON", () => {
  assert.equal(armCommand("line"), 'arm("line")');
  assert.equal(armCommand('odd"name'), 'arm("odd\\"name")');
});

test("a button's hover text is the tool's name, then its command or why it cannot run", () => {
  assert.equal(buttonTitle("circle", null), 'circle — arm("circle")');
  assert.equal(buttonTitle("circle", "no default frame"), "circle — no default frame");
});

// --- trays: the way they run -------------------------------------------------

test("a tray is one button thick, and as long as its strip and buttons", () => {
  assert.deepEqual(traySize(11, "column"), { w: TRAY_DEPTH, h: TITLE_H + 6 + 11 * BUTTON_STEP });
  assert.deepEqual(traySize(11, "row"), { w: TITLE_H + 6 + 11 * BUTTON_STEP, h: TRAY_DEPTH });
});

/** A column tray of 10 buttons at (x, y); its size is traySize's. */
const col = (x: number, y: number): Rect => ({ x, y, ...traySize(10, "column") });
const row = (x: number, y: number): Rect => ({ x, y, ...traySize(10, "row") });
const content = (o: Orientation) => traySize(10, o);

test("against the area's top or bottom a tray becomes a row; against its left or right, a column", () => {
  const c = col(400, 200);
  const r = row(400, 200);
  assert.equal(orientationFor({ ...c, y: 0 }, "column", area, []), "row", "flush with the top");
  assert.equal(orientationFor({ ...c, y: SNAP }, "column", area, []), "row", "within the snap distance of it");
  assert.equal(orientationFor({ ...c, y: SNAP + 1 }, "column", area, []), "column", "but not one pixel further");
  assert.equal(orientationFor({ ...c, y: area.h - c.h }, "column", area, []), "row", "the bottom");
  assert.equal(orientationFor({ ...c, y: area.h - c.h - SNAP }, "column", area, []), "row");
  assert.equal(orientationFor({ ...r, x: 0 }, "row", area, []), "column", "the left");
  assert.equal(orientationFor({ ...r, x: area.w - r.w }, "row", area, []), "column", "the right");
  assert.equal(orientationFor({ ...r, x: area.w - r.w - SNAP - 1 }, "row", area, []), "row");
  // Already the way the edge says: it stays so.
  assert.equal(orientationFor({ ...r, y: 0 }, "row", area, []), "row");
  assert.equal(orientationFor({ ...c, x: 0 }, "column", area, []), "column");
});

test("against another panel's horizontal edge it is beside, a row; against a vertical one, a column", () => {
  const log: Rect = { x: 100, y: 500, w: 500, h: 150 };
  // Pushed down onto the log's top, and up under its bottom.
  assert.equal(orientationFor(col(300, log.y - col(0, 0).h), "column", area, [log]), "row", "onto its top");
  assert.equal(orientationFor(col(300, log.y - col(0, 0).h + SNAP), "column", area, [log]), "row", "a little into it");
  assert.equal(orientationFor({ ...col(300, 0), y: log.y + log.h }, "column", { w: 1000, h: 1200 }, [log]), "row",
    "up under its bottom");
  // Pushed against its right edge, and its left.
  assert.equal(orientationFor(row(log.x + log.w, 550), "row", area, [log]), "column", "against its right");
  assert.equal(orientationFor(row(log.x + log.w - SNAP, 550), "row", area, [log]), "column");
  const further: Rect = { ...log, x: 400 };
  assert.equal(orientationFor(row(further.x - row(0, 0).w, 550), "row", area, [further]), "column", "against its left");
});

test("an edge's line is not its edge: a panel off to one side is not beside", () => {
  const log: Rect = { x: 100, y: 500, w: 300, h: 150 };
  // Level with the log's top, but wholly to its right: shares the line, not the edge.
  assert.equal(orientationFor(col(450, log.y - col(0, 0).h), "column", area, [log]), "column");
  // Level with its right edge, but wholly above it.
  assert.equal(orientationFor(row(log.x + log.w, 100), "row", area, [log]), "row");
  // Just touching at a corner is no overlap either.
  assert.deepEqual(contacts(col(log.x + log.w, log.y - col(0, 0).h), area, [log], SNAP),
    { top: false, bottom: false, left: false, right: false });
  // Lying over the log is against nothing of it: only a facing edge counts.
  assert.equal(orientationFor(row(200, log.y + 20), "row", area, [log]), "row");
  assert.deepEqual(contacts(row(200, log.y + 20), area, [log], SNAP), { top: false, bottom: false, left: false, right: false });
});

test("a corner keeps the way it runs, and so does nowhere near anything", () => {
  for (const o of ["column", "row"] as const) {
    const r = o === "column" ? col(0, 0) : row(0, 0);
    assert.equal(orientationFor(r, o, area, []), o, `top-left corner, ${o}`);
    assert.equal(orientationFor({ ...r, x: area.w - r.w, y: area.h - r.h }, o, area, []), o, `bottom-right, ${o}`);
    assert.equal(orientationFor({ ...r, x: 300, y: 200 }, o, area, []), o, `the middle, ${o}`);
  }
  // A corner made of an area edge and a panel's edge is a corner too.
  const log: Rect = { x: 100, y: 500, w: 500, h: 150 };
  const corner = col(log.x + log.w, area.h - col(0, 0).h);
  assert.deepEqual(contacts(corner, area, [log], SNAP), { top: false, bottom: true, left: true, right: false });
  for (const o of ["column", "row"] as const) {
    assert.equal(orientationFor(corner, o, area, [log]), o, `against the log's right and the area's bottom, ${o}`);
  }
});

test("a turn re-sizes to the content and keeps the edge it is against", () => {
  // A column pushed onto the bottom: a row along the bottom, not where the column's top was.
  const down = turned(col(300, area.h - col(0, 0).h), "column", area, [], content);
  assert.equal(down.orient, "row");
  assert.deepEqual(down.rect, { x: 300, ...traySize(10, "row"), y: area.h - TRAY_DEPTH });
  // Onto the top: the top kept.
  assert.deepEqual(turned(col(300, 3), "column", area, [], content).rect, { x: 300, y: 3, ...traySize(10, "row") });
  // A row pushed onto the right edge: a column whose right edge is the area's.
  const right = turned(row(area.w - row(0, 0).w, 300), "row", area, [], content);
  assert.equal(right.orient, "column");
  assert.equal(right.rect.x + right.rect.w, area.w);
  // Onto a panel's top: the bottom held against it.
  const log: Rect = { x: 100, y: 500, w: 500, h: 150 };
  const onto = turned(col(300, log.y - col(0, 0).h + 2), "column", area, [log], content);
  assert.equal(onto.orient, "row");
  assert.equal(onto.rect.y + onto.rect.h, log.y + 2, "still against the log's top, where it was pushed");
});

test("a turn is held inside the area, keeping its edge, and no turn changes nothing", () => {
  // A column near the right of the top edge turns into a row too long to fit
  // where it is: pulled left, still on the top.
  const t = turned(col(area.w - 100, 0), "column", area, [], content);
  assert.equal(t.orient, "row");
  assert.ok(inside(t.rect, area));
  assert.equal(t.rect.y, 0);
  assert.equal(t.rect.x + t.rect.w, area.w);
  // A row low on the left edge turning into a column taller than the room below it.
  const u = turned(row(0, area.h - 100), "row", area, [], content);
  assert.equal(u.orient, "column");
  assert.ok(inside(u.rect, area));
  // Nothing turns it: the very rectangle it was given.
  const r = col(300, 200);
  assert.equal(turned(r, "column", area, [], content).rect, r);
  // Content longer than the area: shrunk to it, and the tray scrolls.
  const long = turned(col(50, 0), "column", { w: 200, h: 700 }, [], (o) => traySize(30, o));
  assert.equal(long.orient, "row");
  assert.ok(inside(long.rect, { w: 200, h: 700 }));
  assert.equal(long.rect.w, 200);
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
