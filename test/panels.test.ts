// The panel manager's arithmetic and its storage, without a DOM: what a drag or
// a resize does to a rectangle, what keeps a panel wholly inside, which way a
// tray runs against the edges it meets, the defaults, and a stored layout's
// round trip — including through a storage that throws on every touch, which is
// what a private window hands the app — and the two rules every arrangement
// keeps: panels push one another and never overlap, and a held panel keeps the
// point it was taken by — stopped short, it waits for the pointer to come back.
//
// The browser half (pointer capture, gestures not crossing, persistence across
// a real reload) is test/e2e/panels.e2e.ts.

import { test } from "node:test";
import { readFile } from "node:fs/promises";
import assert from "node:assert/strict";
import {
  TITLE_H, BUTTON_STEP, TRAY_DEPTH, SNAP, STORAGE_KEY,
  armCommand, buttonTitle, constrain, contacts, defaultLayout, describeLayout, dragStep, grabbed, loadLayout, moved,
  orientationFor, overlapping, parseLayout, pushed, resized, saveLayout, settled, traySize, turned,
  type Grab, type Layout, type Orientation, type Point, type Rect, type Size, type StorageLike,
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

// --- panels push one another, and the grasp point stays the same -------------

const box = (x: number, y: number, w = 100, h = 100): Rect => ({ x, y, w, h });
const still: Point = { x: 0, y: 0 };

/** `id` dragged by (dx, dy) as one pointer move. */
function push(layout: Layout, id: string, dx: number, dy: number, a: Size = area) {
  const r = layout[id];
  return pushed(id, { ...r, x: r.x + dx, y: r.y + dy }, layout, a, {}, { x: dx, y: dy });
}

/** Every panel wholly inside `a`, and no two overlapping: the invariant. */
function sound(layout: Layout, a: Size = area): void {
  assert.deepEqual(overlapping(layout), [], `no two panels overlap: ${JSON.stringify(layout)}`);
  for (const [id, r] of Object.entries(layout)) assert.ok(inside(r, a), `${id} is inside: ${JSON.stringify(r)}`);
}

test("a dragged panel that meets another pushes it, along x and along y, by exactly the overlap", () => {
  const side = push({ a: box(100, 100), b: box(250, 100) }, "a", 100, 0);
  assert.deepEqual(side.layout.b, box(300, 100), "pushed right to the mover's edge, flush");
  assert.deepEqual(side.rect, box(200, 100), "and the mover went where it was dragged");
  assert.equal(side.ok, true);
  const down = push({ a: box(100, 100), b: box(100, 250) }, "a", 0, 100);
  assert.deepEqual(down.layout.b, box(100, 300));
  // Up against it exactly, nothing moves: touching is not overlap.
  assert.deepEqual(push({ a: box(100, 100), b: box(250, 100) }, "a", 50, 0).layout.b, box(250, 100));
  const left = push({ a: box(400, 100), b: box(250, 100) }, "a", -100, 0);
  assert.deepEqual(left.layout.b, box(200, 100), "and the other way");
  sound(side.layout); sound(down.layout); sound(left.layout);
});

test("a chain: the pushed panel pushes the next", () => {
  const r = push({ a: box(100, 100), b: box(250, 100), c: box(400, 150) }, "a", 200, 0);
  assert.deepEqual(r.rect, box(300, 100));
  assert.deepEqual(r.layout.b, box(400, 100));
  assert.deepEqual(r.layout.c, box(500, 150), "c, reached only through b, pushed along x alone");
  sound(r.layout);
  // A panel reached twice: first by the mover itself, a short push, then
  // through b, which the mover pushed onto it, a longer one. Visited once and
  // never again, c would be left under b.
  const twice = push({ a: box(100, 100, 100, 200), b: box(210, 100, 50, 100), c: box(270, 150) }, "a", 150, 0);
  sound(twice.layout);
  assert.deepEqual(twice.layout.b, box(350, 100, 50, 100));
  assert.deepEqual(twice.layout.c, box(400, 150), "flush against b, not against the mover where it was first put");
});

test("a flick further in one move than a panel is wide still pushes it, rather than passing through", () => {
  const r = push({ a: box(100, 100), b: box(250, 100, 20, 100) }, "a", 400, 0);
  assert.deepEqual(r.layout.b, box(600, 100, 20, 100), "flush ahead of where the mover landed");
  const up = push({ a: box(100, 500), b: box(100, 300, 100, 10) }, "a", 0, -500);
  assert.deepEqual(up.layout.b, box(100, 0, 100, 10), "and pushed to the top");
  assert.equal(up.rect.y, 10, "the mover stopped flush under it");
});

test("a chain blocked at the window edge stops the mover flush against it, to the pixel", () => {
  // The chain has 100 px of room: it uses all of it, and the mover stops
  // where the chain is solid against the right edge.
  const r = push({ a: box(100, 100), b: box(700, 100), c: box(900, 100) }, "a", 700, 0);
  assert.equal(r.ok, false, "it did not get where it was dragged");
  assert.deepEqual(r.layout.c, box(900, 100), "the panel on the edge did not move");
  assert.deepEqual(r.layout.b, box(800, 100), "the one between used its room");
  assert.equal(r.rect.x + r.rect.w, r.layout.b.x, "and the mover is flush against it");
  assert.deepEqual(r.rect, box(700, 100), "not a pixel short");
  sound(r.layout);
  // A chain with no room at all is left exactly where it was.
  const tight = { a: box(100, 100), b: box(800, 100), c: box(900, 100) };
  const t = push(tight, "a", 650, 0);
  assert.deepEqual([t.layout.b, t.layout.c], [tight.b, tight.c], "the chain is unmoved");
  assert.deepEqual(t.rect, box(700, 100), "and the mover stops on it");
  // Upward against the top too, from fractional positions.
  const u = push({ a: box(10.5, 400.25), b: box(10.5, 150.75) }, "a", 0, -390);
  assert.deepEqual(u.layout.b, box(10.5, 0));
  assert.equal(u.rect.y, 100, "flush under b, which is flush with the top");
});

test("a diagonal drag pushes along the dominant axis only — and a drift on the other pushes by the drift", () => {
  // Into b's side, mostly rightward: b goes right and not a pixel down.
  const r = push({ a: box(100, 100), b: box(250, 120) }, "a", 100, 30);
  assert.deepEqual(r.layout.b, box(300, 120), "pushed along x only");
  assert.deepEqual(r.rect, box(200, 130), "while the mover went both ways");
  sound(r.layout);
  // Resting on b's top and dragged right with two pixels of downward drift:
  // b is pushed down by the two pixels — not thrown sideways the width of the
  // mover, which is what pushing everything along the larger axis would do.
  const resting = push({ a: box(300, 100), b: box(200, 200, 400, 100) }, "a", 20, 2);
  assert.deepEqual(resting.layout.b, box(200, 202, 400, 100));
  assert.deepEqual(resting.rect, box(320, 102));
  // A panel pushed along x never moves in y, over a whole drag of small steps.
  let l: Layout = { a: box(100, 300), b: box(260, 320) };
  for (let i = 0; i < 40; i++) l = push(l, "a", 7, i % 3 === 0 ? 1 : 0).layout;
  assert.ok(l.b.x > 260, "it was pushed");
  assert.equal(l.b.y, 320);
  sound(l);
});

test("a pushed panel stays where it was pushed when the mover goes back", () => {
  const there = push({ a: box(100, 100), b: box(250, 100) }, "a", 120, 0);
  const back = push(there.layout, "a", -300, 0);
  assert.deepEqual(back.layout.b, box(320, 100), "no spring, no pull");
  assert.deepEqual(back.rect, box(0, 100), "while the mover went back, to the edge");
});

test("a resize by the grip pushes what it grows into, and stops at the edge", () => {
  const l: Layout = { a: box(100, 100), b: box(250, 100) };
  const minSize = () => ({ w: 50, h: 50 });
  let s = dragStep(grabbed("a", "resize", { x: 200, y: 200 }, l), { x: 300, y: 200 }, l, area, minSize);
  assert.deepEqual(s.layout.a, box(100, 100, 200, 100), "grown by the grip's travel");
  assert.deepEqual(s.layout.b, box(300, 100), "and b pushed by it");
  s = dragStep(s.grab, { x: 1500, y: 200 }, s.layout, area, minSize);
  assert.deepEqual(s.layout.b, box(900, 100), "b on the right edge");
  assert.deepEqual(s.layout.a, box(100, 100, 800, 100), "and a grown flush against it, no further");
  sound(s.layout);
  // Back: the grip is held where it was taken, like the strip. The corner was
  // left behind at 900, flush on b, with the pointer at 1500: ten pixels back
  // is nothing, back to 900 it is under the hand again, and past that it
  // shrinks, pulling nothing with it.
  s = dragStep(s.grab, { x: 1490, y: 200 }, s.layout, area, minSize);
  assert.deepEqual(s.layout.a, box(100, 100, 800, 100), "ten pixels back, not a pixel narrower");
  s = dragStep(s.grab, { x: 900, y: 200 }, s.layout, area, minSize);
  assert.deepEqual(s.layout.a, box(100, 100, 800, 100), "back where it was left: under the hand, still");
  s = dragStep(s.grab, { x: 890, y: 200 }, s.layout, area, minSize);
  assert.deepEqual(s.layout.b, box(900, 100));
  assert.equal(s.layout.a.w, 790, "and ten pixels past it, ten pixels narrower");
  // Shrunk past its minimum, likewise: it grows again only once the pointer is
  // back at the size it stopped at.
  s = dragStep(s.grab, { x: 0, y: 200 }, s.layout, area, minSize);
  assert.equal(s.layout.a.w, 50, "stopped at the minimum");
  s = dragStep(s.grab, { x: 140, y: 200 }, s.layout, area, minSize);
  assert.equal(s.layout.a.w, 50, "the pointer still short of the corner: nothing");
  s = dragStep(s.grab, { x: 160, y: 200 }, s.layout, area, minSize);
  assert.equal(s.layout.a.w, 60, "past it, growing, the corner under the hand");
});

test("a tray turning into a neighbour pushes it out of the way, along x", () => {
  // A column dragged up to the top edge turns into a row along it, and the
  // row, as long as the column was tall, lands on n.
  const l: Layout = { tray: { ...col(400, 300), orient: "column" }, n: box(440, 0, 200, 100) };
  const g = grabbed("tray", "move", { x: 414, y: 308 }, l);
  const s = dragStep(g, { x: 414, y: 0 }, l, area, () => ({ w: 28, h: 28 }), content);
  assert.equal(s.layout.tray.orient, "row");
  assert.deepEqual([s.layout.tray.x, s.layout.tray.y], [400, 0]);
  assert.deepEqual(s.layout.n, box(400 + traySize(10, "row").w, 0, 200, 100), "pushed along x, flush, still on the top");
  sound(s.layout);
  // A neighbour that can go neither sideways nor down: the tray does not turn.
  const walled: Layout = { tray: { ...col(400, 300), orient: "column" }, n: box(440, 0, 560, 700) };
  const w = dragStep(grabbed("tray", "move", { x: 414, y: 308 }, walled), { x: 414, y: 0 }, walled, area, () => ({ w: 28, h: 28 }), content);
  assert.equal(w.layout.tray.orient, "column");
  assert.equal(w.layout.tray.y, 0, "it still went where it was dragged");
  assert.deepEqual(w.layout.n, walled.n);
  sound(w.layout);
});

test("with no motion a panel in the way is pushed along x first, away from the mover — then along y", () => {
  const r = pushed("a", box(100, 100), { a: box(500, 500), b: box(150, 120) }, area, {}, still);
  assert.deepEqual(r.layout.b, box(200, 120), "away to the right, where b's middle is");
  const l = pushed("a", box(100, 100), { a: box(500, 500), b: box(50, 120) }, area, {}, still);
  assert.deepEqual(l.layout.b, box(0, 120), "away to the left");
  // No room either way along x: along y instead.
  const narrow = { w: 220, h: 700 };
  const y = pushed("a", box(10, 100, 200, 100), { a: box(10, 500, 200, 100), b: box(10, 150, 200, 100) }, narrow, {}, still);
  assert.deepEqual(y.layout.b, box(10, 200, 200, 100));
  // No room at all: nothing moves, and the caller is told.
  const full = pushed("a", box(0, 0, 220, 700), { a: box(0, 0, 10, 10), b: box(10, 150, 200, 100) }, narrow, {}, still);
  assert.equal(full.ok, false);
  assert.deepEqual(full.layout, { a: box(0, 0, 10, 10), b: box(10, 150, 200, 100) });
});

test("load: a stored layout that overlaps comes up clear, earlier panels holding their places", () => {
  const order = ["toolbar", "log", "cmd"];
  const stored: Layout = { toolbar: { ...col(8, 8), orient: "column" }, log: box(8, 200, 560, 150), cmd: box(300, 300, 560, 44) };
  const s = settled(stored, order, area, {});
  assert.equal(s.ok, true);
  sound(s.layout);
  assert.deepEqual(s.layout.toolbar, stored.toolbar, "the first panel is where it asked to be");
  assert.deepEqual(s.layout.log, box(8 + TRAY_DEPTH, 200, 560, 150), "the log pushed off the toolbar, along x");
  // An untouched toolbar grown for a new tool, down onto the log: it keeps its
  // place, and the log makes way, sideways by the tray's thickness.
  const g = defaultLayout(area, 11);
  const grown = { ...g, toolbar: { ...g.toolbar, h: g.log.y + 10 - g.toolbar.y } };
  const gs = settled(grown, order, area, {});
  sound(gs.layout);
  assert.deepEqual(gs.layout.toolbar, grown.toolbar);
  assert.deepEqual(gs.layout.log, { ...g.log, x: g.toolbar.x + g.toolbar.w });
  assert.deepEqual(gs.layout.cmd, g.cmd, "the command line, clear of both, untouched");
  // A window shrunk until the defaults themselves would overlap: the toolbar is
  // taller than the room above the log.
  const short = { w: 1000, h: 420 };
  const d = defaultLayout(short, 11);
  assert.notDeepEqual(overlapping(d), [], "the defaults overlap in a window this short");
  const t = settled(d, order, short, {});
  assert.equal(t.ok, true);
  sound(t.layout, short);
  // One too small to hold them at all says so, and leaves them as asked.
  const tiny = { w: 300, h: 200 };
  const u = settled({ a: box(0, 0, 300, 150), b: box(0, 100, 300, 100) }, ["a", "b"], tiny, {});
  assert.equal(u.ok, false);
  assert.deepEqual(u.layout.b, box(0, 100, 300, 100));
  // A sound layout is left exactly as it is.
  const fine = defaultLayout(area, 11);
  assert.deepEqual(settled(fine, order, area, {}).layout, fine);
});

test("the grasp point stays the same: stopped short by d, a move back of less than d moves nothing, of d puts it under the hand", () => {
  const l: Layout = { a: box(800, 100) };
  const g: Grab = grabbed("a", "move", { x: 850, y: 150 }, l);
  assert.deepEqual([g.dx, g.dy], [50, 50]);
  const minSize = () => ({ w: 10, h: 10 });
  // The hand asks for x = 1000; the right edge stops the panel at 900: d = 100.
  let s = dragStep(g, { x: 1050, y: 150 }, l, area, minSize);
  assert.deepEqual(s.layout.a, box(900, 100), "flush with the right edge");
  assert.deepEqual(s.grab, g, "the grab is the one taken at the press");
  for (const back of [10, 50, 99]) {
    const b = dragStep(s.grab, { x: 1050 - back, y: 150 }, s.layout, area, minSize);
    assert.deepEqual(b.layout.a, box(900, 100), `${back} px back of a 100 px lead moves nothing`);
    assert.deepEqual(b.grab, g);
  }
  s = dragStep(s.grab, { x: 950, y: 150 }, s.layout, area, minSize);
  assert.deepEqual(s.layout.a, box(900, 100), "d back: where it stopped, which is under the hand again");
  assert.deepEqual([950 - s.layout.a.x, 150 - s.layout.a.y], [g.dx, g.dy], "at the point it was grabbed by");
  s = dragStep(s.grab, { x: 940, y: 150 }, s.layout, area, minSize);
  assert.deepEqual(s.layout.a, box(890, 100), "and past it, it follows, pixel for pixel");
  // Stopped on one axis, it is not stopped on the other: the hand going down
  // while still past the edge takes the panel down at once.
  const d = dragStep(g, { x: 1050, y: 150 }, l, area, minSize);
  const down = dragStep(d.grab, { x: 1050, y: 250 }, d.layout, area, minSize);
  assert.deepEqual(down.layout.a, box(900, 200));
  // Unblocked, the panel is simply under the hand.
  const free = dragStep(g, { x: 700, y: 300 }, l, area, minSize);
  assert.deepEqual(free.layout.a, box(650, 250));
  assert.deepEqual(free.grab, g);
  // Against a chain that cannot move, the same: asked for 750, stopped at 700.
  const chain: Layout = { a: box(500, 100), b: box(800, 100), c: box(900, 100) };
  const cg = grabbed("a", "move", { x: 550, y: 150 }, chain);
  let c = dragStep(cg, { x: 800, y: 150 }, chain, area, minSize);
  assert.deepEqual(c.layout.a, box(700, 100));
  assert.deepEqual(c.grab, cg);
  c = dragStep(c.grab, { x: 760, y: 150 }, c.layout, area, minSize);
  assert.deepEqual(c.layout.a, box(700, 100), "40 px back of a 50 px lead: nothing");
  c = dragStep(c.grab, { x: 750, y: 150 }, c.layout, area, minSize);
  assert.deepEqual(c.layout.a, box(700, 100), "50 px back: under the hand");
  c = dragStep(c.grab, { x: 745, y: 150 }, c.layout, area, minSize);
  assert.deepEqual(c.layout.a, box(695, 100));
  assert.deepEqual([c.layout.b, c.layout.c], [chain.b, chain.c], "and the chain was never moved");
});

test("a tray that turns keeps the same point of its strip under the hand — the same fraction along it", () => {
  const l: Layout = { tray: { ...col(400, 300), orient: "column" } };
  const minSize = () => ({ w: 28, h: 28 });
  // Held a quarter of the way along the column's strip and half way into it.
  const g = grabbed("tray", "move", { x: 407, y: 308 }, l);
  assert.deepEqual([g.dx, g.dy], [7, 8]);
  const s = dragStep(g, { x: 407, y: 0 }, l, area, minSize, content);
  const t = s.layout.tray;
  assert.equal(t.orient, "row", "turned at the top edge");
  assert.deepEqual([s.grab.dx, s.grab.dy], [8, 7], "down the row's strip a quarter of the way, half way into it");
  assert.equal(s.grab.dy / t.h, g.dx / l.tray.w, "the same fraction along the strip");
  assert.ok(s.grab.dx < TITLE_H, "and still on the strip");
  // The next move puts that point under the hand.
  const n = dragStep(s.grab, { x: 507, y: 40 }, s.layout, area, minSize, content);
  assert.deepEqual([n.layout.tray.x, n.layout.tray.y], [507 - 8, 40 - 7]);
  assert.equal(n.layout.tray.orient, "row");
  // And back to a column against the left edge: the point comes home.
  const h = dragStep(n.grab, { x: 0, y: 340 }, n.layout, area, minSize, content);
  assert.equal(h.layout.tray.orient, "column");
  assert.deepEqual([h.grab.dx, h.grab.dy], [7, 8], "the grab it was taken with");
});

test("a column eased onto the bottom edge turns along it, then comes back under the hand", () => {
  // `turned` holds the edge the tray met, which for a column's bottom is the
  // end away from the strip, and so from the hand. One move later the fixed
  // grab has it back under the hand; released before that move, it stays.
  let l: Layout = { tray: { ...col(400, 300), orient: "column" } };
  const minSize = () => ({ w: 28, h: 28 });
  let g = grabbed("tray", "move", { x: 414, y: 308 }, l);
  let p: Point = { x: 414, y: 308 };
  while (l.tray.orient === "column") {
    p = { x: p.x, y: p.y + 1 };
    const s = dragStep(g, p, l, area, minSize, content);
    [l, g] = [s.layout, s.grab];
  }
  assert.equal(l.tray.h, TRAY_DEPTH);
  assert.ok(area.h - (l.tray.y + l.tray.h) <= SNAP, "a row along the bottom edge");
  assert.ok(p.y - l.tray.y < -100, "with the hand far above it");
  const s = dragStep(g, { x: p.x, y: p.y + 1 }, l, area, minSize, content);
  assert.equal(s.layout.tray.orient, "row", "it stays a row");
  assert.deepEqual([s.layout.tray.x, s.layout.tray.y], [p.x - g.dx, p.y + 1 - g.dy], "under the hand");
});

test("a turn that would turn straight back under the hand does not happen", () => {
  // A row just under the top edge, held high and right on its strip, eased
  // right onto the right edge. As a column under the hand it would poke over
  // the top, and so turn back into a row on the right edge, and so on, a flip
  // every move. It stays a row until the hand itself is at the corner.
  let l: Layout = { tray: { x: 500, y: 10, ...traySize(10, "row"), orient: "row" } };
  const minSize = () => ({ w: 28, h: 28 });
  let g = grabbed("tray", "move", { x: 514, y: 12 }, l);
  let flips = 0;
  for (let x = 515; x <= 1100; x++) {
    const before = l.tray.orient;
    const s = dragStep(g, { x, y: 12 }, l, area, minSize, content);
    [l, g] = [s.layout, s.grab];
    if (l.tray.orient !== before) flips++;
    sound(l);
  }
  assert.equal(flips, 1, "one turn, not one a move");
  assert.equal(l.tray.orient, "column");
  assert.equal(l.tray.x + l.tray.w, area.w, "against the right edge");
});

/**
 * Whether `id`'s face leading along `axis` in `dir` cannot move that way: it is
 * on the area's edge, or flush against a panel beside it on that face which
 * cannot move that way either. Worked out from the layout alone, so the walk
 * below does not take the resolver's word for when a panel was stopped.
 */
function walled(l: Layout, id: string, axis: "x" | "y", dir: number, a: Size, seen = new Set<string>()): boolean {
  const r = l[id];
  const [p, len, room] = axis === "x" ? [r.x, r.w, a.w] : [r.y, r.h, a.h];
  const face = dir > 0 ? p + len : p;
  if (Math.abs(face - (dir > 0 ? room : 0)) < 1e-6) return true;
  seen.add(id);
  return Object.keys(l).some((o) => {
    if (seen.has(o)) return false;
    const q = l[o];
    const [qp, ql] = axis === "x" ? [q.x, q.w] : [q.y, q.h];
    const across = axis === "x"
      ? Math.min(r.y + r.h, q.y + q.h) - Math.max(r.y, q.y)
      : Math.min(r.x + r.w, q.x + q.w) - Math.max(r.x, q.x);
    return across > 1e-6 && Math.abs(face - (dir > 0 ? qp : qp + ql)) < 1e-6 && walled(l, o, axis, dir, a, seen);
  });
}

test("2 000 random drags over three panels: never an overlap or a pixel outside, and the panel under its grab whenever not blocked", () => {
  let seed = 11;
  const rand = () => ((seed = (seed * 1103515245 + 12345) % 2147483648) / 2147483648);
  const a = { w: 1100, h: 760 };
  let l: Layout = defaultLayout(a, 11);
  const ids = Object.keys(l);
  const minSize = (id: string, o: Orientation | undefined) => (id === "toolbar" ? traySize(1, o ?? "column") : { w: 160, h: 44 });
  const tray = (o: Orientation) => traySize(11, o);
  let pushes = 0;
  let turns = 0;
  let stops = 0;
  let caught = 0;
  for (let i = 0; i < 2000; i++) {
    const id = ids[Math.floor(rand() * ids.length)];
    const kind = rand() < 0.8 ? "move" : "resize";
    const r = l[id];
    let p: Point = kind === "move" ? { x: r.x + 5, y: r.y + 5 } : { x: r.x + r.w - 2, y: r.y + r.h - 2 };
    let g = grabbed(id, kind, p, l);
    const [tx, ty] = [(rand() - 0.5) * 1400, (rand() - 0.5) * 1000];
    const steps = 1 + Math.floor(rand() * 12);
    let lagged = false;
    for (let k = 0; k < steps; k++) {
      p = { x: p.x + tx / steps + (rand() - 0.5) * 6, y: p.y + ty / steps + (rand() - 0.5) * 6 };
      const before = l;
      const s = dragStep(g, p, l, a, minSize, id === "toolbar" ? tray : undefined);
      const turned = s.layout[id].orient !== before[id].orient;
      if (!turned) assert.deepEqual(s.grab, g, `drag ${i}, step ${k}: the grab never changes but in a turn`);
      [l, g] = [s.layout, s.grab];
      if (ids.some((o) => o !== id && l[o] !== before[o])) pushes++;
      if (turned) turns++;
      assert.deepEqual(overlapping(l), [], `drag ${i}, step ${k}: ${JSON.stringify(l)}`);
      for (const o of ids) assert.ok(inside(l[o], a), `drag ${i}, step ${k}: ${o} at ${JSON.stringify(l[o])}`);
      // Under the grab, or blocked on every axis it lags along. A turn is
      // exempt for its one step: `turned` put it against the edge it met.
      if (turned) continue;
      const q = l[id];
      const held = kind === "move" ? { x: q.x, y: q.y } : { x: q.x + q.w, y: q.y + q.h };
      const lag = { x: p.x - g.dx - held.x, y: p.y - g.dy - held.y };
      let stopped = false;
      for (const axis of ["x", "y"] as const) {
        const d = lag[axis];
        if (Math.abs(d) < 1e-6) continue;
        stopped = true;
        const why = kind === "resize" && d < 0
          ? (axis === "x" ? q.w : q.h) === (axis === "x" ? minSize(id, q.orient).w : minSize(id, q.orient).h)
          : walled(l, id, axis, Math.sign(d), a);
        assert.ok(why, `drag ${i}, step ${k}: ${id} (${kind}) ${d} px short of the hand along ${axis} with nothing stopping it: ${JSON.stringify(l)}`);
      }
      if (stopped) stops++;
      else if (lagged) caught++;
      lagged = stopped;
    }
  }
  // Not vacuous: the walk really pushed, stopped short, came back under the
  // hand after being stopped, and turned, many times.
  assert.ok(pushes > 200, `${pushes} steps pushed something`);
  assert.ok(stops > 200, `${stops} steps were stopped short of the hand`);
  assert.ok(caught > 20, `${caught} steps had a stopped panel back under the hand`);
  assert.ok(turns > 20, `${turns} steps turned the tray`);
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
