// A dragged panel shows where everything will land, and nothing moves until it
// is dropped (docs/plans/panels-preview.md), in a browser — with a mouse, and
// with a finger on an iPhone 13 held both ways up. The owner: "the toolbars
// should push each other around, but they should show how they will snap IF
// the user drops the grasped toolbar in that spot. but until they actually drop
// it, the permanent position of any tool bar is not changed"; "when I push a
// toolbar up against one side and it changes from horizontal to vertical
// layout. it should not actually change the toolbar between modes unless I let
// go"; "when I am dragging toolbars, all the ungripped ones should go
// translucent".
//
// What is checked, each way: the command line dragged onto the log — the log's
// ghost moves, the log does not; dropped, the log moves to its ghost. Dragged
// and Escaped (mouse), or lifted back where it started (both): nothing moved.
// The tray dragged to an edge: its ghost turns, the tray does not until the
// drop. Every panel not in hand is at half opacity for the drag and whole
// again after it. After every drop no two panes overlap, and every preview is
// checked by the page itself (the panels report a preview that overlaps as a
// page error under the dev server). Set NEOCAD_E2E_SHOTS to a directory to keep
// the pictures — and look at them: a ghost must read as a ghost.

import { test, after, afterEach } from "node:test";
import assert from "node:assert/strict";
import { mkdirSync } from "node:fs";
import { join } from "node:path";
import { openApp, settled, type AppContext } from "./harness.ts";
import { fingers } from "./fingers.ts";

const SHOTS = process.env.NEOCAD_E2E_SHOTS;
const apps: AppContext[] = [];
after(async () => { for (const a of apps) await a.close(); });
/** A hand a failed assertion left down, lifted so the next test does not start mid-drag. */
let stillDown: (() => Promise<void>) | null = null;
afterEach(async () => { if (stillDown) await stillDown(); });

interface Box { x: number; y: number; w: number; h: number }
interface Seen {
  panels: Record<string, Box & { opacity: number; orient: string | null; held: boolean }>;
  ghosts: Record<string, Box & { orient: string | null; own: boolean }>;
  dragging: boolean;
}

/** Every visible panel as drawn, with its opacity, and every ghost — in window pixels. */
const seen = (app: AppContext): Promise<Seen> => app.page.evaluate(() => {
  const box = (el: Element) => { const r = el.getBoundingClientRect(); return { x: r.x, y: r.y, w: r.width, h: r.height }; };
  const panels: Seen["panels"] = {};
  for (const el of Array.from(document.querySelectorAll<HTMLElement>(".panel[data-panel]"))) {
    if (el.hidden) continue;
    panels[el.dataset.panel!] = { ...box(el), opacity: Number(getComputedStyle(el).opacity), orient: el.dataset.orient ?? null, held: el.classList.contains("held") };
  }
  const ghosts: Seen["ghosts"] = {};
  const layer = document.querySelector<HTMLElement>(".pghosts");
  if (layer && !layer.hidden) {
    for (const g of Array.from(layer.querySelectorAll<HTMLElement>(".pghost"))) {
      ghosts[g.dataset.ghost!] = { ...box(g), orient: g.dataset.orient ?? null, own: "own" in g.dataset };
    }
  }
  return { panels, ghosts, dragging: document.getElementById("viewwrap")!.classList.contains("dragging") };
});

const rect = (b: Box): Box => ({ x: b.x, y: b.y, w: b.w, h: b.h });
const intersect = (a: Box, b: Box) => a.x < b.x + b.w - 0.5 && b.x < a.x + a.w - 0.5 && a.y < b.y + b.h - 0.5 && b.y < a.y + a.h - 0.5;

/** No two of `boxes` overlap. */
function apart(boxes: Record<string, Box>, what: string): void {
  const ids = Object.keys(boxes);
  for (let i = 0; i < ids.length; i++) {
    for (let j = i + 1; j < ids.length; j++) {
      assert.ok(!intersect(boxes[ids[i]], boxes[ids[j]]), `${what}: ${ids[i]} and ${ids[j]} overlap: ${JSON.stringify(boxes)}`);
    }
  }
}

/** Every panel but the held one at half opacity, the held one whole, and the area marked as dragging. */
function translucent(s: Seen, held: string): void {
  assert.ok(s.dragging, "the area is dragging");
  for (const [id, p] of Object.entries(s.panels)) {
    assert.equal(p.opacity, id === held ? 1 : 0.5, `${id} ${id === held ? "is solid in the hand" : "is translucent"}`);
    assert.equal(p.held, id === held);
  }
}

/** Every panel whole again, no ghost, nothing dragging. */
function whole(s: Seen): void {
  assert.equal(s.dragging, false);
  assert.deepEqual(s.ghosts, {}, "the ghosts are gone");
  for (const [id, p] of Object.entries(s.panels)) assert.equal(p.opacity, 1, `${id} is whole again`);
}

/** The panels' rectangles alone. */
const places = (s: Seen) => Object.fromEntries(Object.entries(s.panels).map(([id, p]) => [id, rect(p)]));

async function shot(app: AppContext, name: string): Promise<void> {
  if (!SHOTS) return;
  mkdirSync(SHOTS, { recursive: true });
  await app.page.screenshot({ path: join(SHOTS, `preview-${name}.png`) });
}

/** The middle of panel `id`'s strip. */
const stripAt = (app: AppContext, id: string) => app.page.$eval(`.panel[data-panel="${id}"] > .ptitle`, (el) => {
  const r = el.getBoundingClientRect();
  return { x: r.x + r.width / 2, y: r.y + r.height / 2 };
});

/**
 * Two frames: the browser hands a page its pointer moves at the next frame, so
 * a picture read straight after the last one sent can be a move behind.
 */
const frames = (app: AppContext) => app.page.evaluate(() => new Promise<void>((r) => requestAnimationFrame(() => requestAnimationFrame(() => r()))));

/** A hand on a strip, either kind: down, along, up — the test looks in between. */
interface Hand {
  down(x: number, y: number): Promise<void>;
  to(x: number, y: number, steps?: number): Promise<void>;
  up(): Promise<void>;
}

function mouseHand(app: AppContext): Hand {
  const m = app.page.mouse;
  const hand: Hand = {
    async down(x, y) { await m.move(x, y); await m.down(); stillDown = () => hand.up(); },
    async to(x, y, steps = 10) { await m.move(x, y, { steps }); await frames(app); },
    async up() { stillDown = null; await m.up(); await settled(app.page); },
  };
  return hand;
}

async function fingerHand(app: AppContext): Promise<Hand> {
  const f = await fingers(app);
  const hand: Hand = {
    async down(x, y) { await f.down([x, y]); stillDown = () => hand.up(); },
    async to(x, y, steps = 12) { await f.glide(steps, [x, y]); await frames(app); },
    async up() { stillDown = null; await f.up(); await settled(app.page); },
  };
  return hand;
}

/**
 * The command line dragged onto the log until the log's ghost moves; looked at
 * held; dropped. Returns nothing — every claim is asserted here, for each hand.
 */
async function cmdOntoLog(app: AppContext, hand: Hand, name: string): Promise<void> {
  await app.type('layout("reset")');
  await settled(app.page);
  const s0 = await seen(app);
  const [log, cmd] = [s0.panels.log, s0.panels.cmd];
  const p = await stripAt(app, "cmd");
  // Into the log from wherever the command line is: its strip to the log's
  // middle, so the two overlap by half the log whichever side it comes from.
  const to = { x: p.x + (log.x + log.w / 2 - (cmd.x + cmd.w / 2)), y: p.y + (log.y + log.h / 2 - cmd.y) };
  await hand.down(p.x, p.y);
  await hand.to(to.x, to.y);
  const held = await seen(app);
  assert.deepEqual(rect(held.panels.log), rect(log), "the log has not moved");
  for (const id of Object.keys(s0.panels)) if (id !== "cmd") assert.deepEqual(rect(held.panels[id]), rect(s0.panels[id]), `${id} has not moved`);
  assert.ok(held.ghosts.log, `the log has a ghost: ${JSON.stringify(held.ghosts)}`);
  assert.notDeepEqual(rect(held.ghosts.log), rect(log), "where it would be pushed to");
  assert.ok(Math.abs(held.panels.cmd.y - (cmd.y + to.y - p.y)) <= 1, "the command line is in the hand, under it, over the log");
  assert.ok(intersect(held.panels.cmd, held.panels.log), "drawn over the log — it is held, not placed");
  translucent(held, "cmd");
  apart(held.ghosts, "the ghosts");
  await shot(app, `${name}-cmd-onto-log-held`);
  const landing = { ...places(held), ...Object.fromEntries(Object.entries(held.ghosts).map(([id, g]) => [id, rect(g)])) };
  await hand.up();
  const after = await seen(app);
  whole(after);
  for (const [id, r] of Object.entries(landing)) {
    for (const k of ["x", "y", "w", "h"] as const) {
      assert.ok(Math.abs(places(after)[id][k] - r[k]) <= 0.5, `${id} landed on its ghost: ${JSON.stringify(places(after)[id])} vs ${JSON.stringify(r)}`);
    }
  }
  assert.notDeepEqual(rect(after.panels.log), rect(log), "dropped, the log moved");
  apart(places(after), "after the drop");
  await shot(app, `${name}-cmd-onto-log-dropped`);
}

/**
 * Dragged onto the log and back where it started: the preview is the drop at
 * the spot, so back at the press there are no ghosts — and the lift there
 * moves nothing.
 */
async function backWhereItStarted(app: AppContext, hand: Hand): Promise<void> {
  await app.type('layout("reset")');
  await settled(app.page);
  const s0 = await seen(app);
  const [log, cmd] = [s0.panels.log, s0.panels.cmd];
  const p = await stripAt(app, "cmd");
  await hand.down(p.x, p.y);
  await hand.to(p.x + (log.x + log.w / 2 - (cmd.x + cmd.w / 2)), p.y + (log.y + log.h / 2 - cmd.y));
  assert.ok((await seen(app)).ghosts.log, "the log's ghost moved on the way");
  await hand.to(p.x, p.y);
  assert.deepEqual((await seen(app)).ghosts, {}, "back at the press: no ghosts, the log's gone home");
  await hand.to(p.x + 1, p.y + 1);
  await hand.up();
  const after = await seen(app);
  whole(after);
  assert.deepEqual(places(after), places(s0), "back where it started: nothing moved");
}

/**
 * The tray dragged against an edge that turns it — a column up against the top
 * (`sideways` along it: on a portrait phone the column is under the logo, and
 * straight up is the logo's bottom edge, which turns it as the area's top
 * would; sideways, the panes beside it are pinned against the right edge), a
 * row against the left edge: its ghost turns, the tray in the hand does not
 * until the drop.
 */
async function trayToTop(app: AppContext, hand: Hand, name: string, sideways: number): Promise<void> {
  await app.type('layout("reset")');
  await settled(app.page);
  const s0 = await seen(app);
  const t0 = s0.panels.toolbar;
  const p = await stripAt(app, "toolbar");
  const turnFrom = t0.orient === "row" ? "row" : "column";
  // Against the top for a column, which turns it into a row; against the left
  // edge for a row, which turns it into a column.
  const to = turnFrom === "column"
    ? { x: p.x + sideways, y: p.y - t0.y - 40 }
    : { x: p.x - t0.x - 40, y: p.y - Math.min(160, t0.y / 2) };
  await hand.down(p.x, p.y);
  await hand.to(to.x, to.y);
  const held = await seen(app);
  const turned = turnFrom === "column" ? "row" : "column";
  assert.equal(held.panels.toolbar.orient, turnFrom, "the tray in the hand still runs the way it did");
  assert.deepEqual([held.panels.toolbar.w, held.panels.toolbar.h], [t0.w, t0.h], "its own shape");
  assert.equal(held.ghosts.toolbar?.orient, turned, `its ghost is turned: ${JSON.stringify(held.ghosts)}`);
  if (turned === "row") assert.ok(held.ghosts.toolbar.y < s0.panels.toolbar.y, "up where it met the edge");
  translucent(held, "toolbar");
  apart(held.ghosts, "the ghosts");
  await shot(app, `${name}-tray-turn-held`);
  const ghost = rect(held.ghosts.toolbar);
  await hand.up();
  const after = await seen(app);
  whole(after);
  assert.equal(after.panels.toolbar.orient, turned, "dropped, it turns");
  for (const k of ["x", "y", "w", "h"] as const) assert.ok(Math.abs(after.panels.toolbar[k] - ghost[k]) <= 0.5, `onto its ghost: ${JSON.stringify(after.panels.toolbar)} vs ${JSON.stringify(ghost)}`);
  apart(places(after), "after the turn");
  await shot(app, `${name}-tray-turn-dropped`);
}

// --- a mouse ----------------------------------------------------------------------

test("mouse: the command line dragged onto the log — the log's ghost moves, the log does not; dropped, it does", async () => {
  const app = await openApp();
  apps.push(app);
  await cmdOntoLog(app, mouseHand(app), "desktop");
});

test("mouse: dragged and Escaped, nothing moved — and the Escape was the drag's, not the armed tool's", async () => {
  const app = apps[0];
  await app.type('layout("reset")');
  await app.type('arm("line")');
  await settled(app.page);
  const s0 = await seen(app);
  const [log, cmd] = [s0.panels.log, s0.panels.cmd];
  const p = await stripAt(app, "cmd");
  const hand = mouseHand(app);
  await hand.down(p.x, p.y);
  await hand.to(p.x + 200, p.y + (log.y + log.h / 2 - cmd.y));
  const held = await seen(app);
  assert.ok(held.ghosts.log, "the log's ghost moved");
  await app.page.keyboard.press("Escape");
  await settled(app.page);
  const escaped = await seen(app);
  whole(escaped);
  assert.deepEqual(places(escaped), places(s0), "every panel where it was — the held one too");
  // The hand is still down; moving it and lifting it does nothing more.
  await hand.to(p.x + 300, p.y - 300);
  await hand.up();
  assert.deepEqual(places(await seen(app)), places(s0), "and the lift after it commits nothing");
  const armed = await app.page.evaluate(() =>
    (window as never as { __neocad: { engine: { active: { name: string } | null } } }).__neocad.engine.active?.name ?? null);
  assert.equal(armed, "line", "the line tool is still armed: one Escape takes back one thing");
  await app.type("cancel()");
});

test("mouse: lifted back where it started, nothing moved", async () => {
  await backWhereItStarted(apps[0], mouseHand(apps[0]));
});

test("mouse: the tray dragged to the top edge — its ghost turns, the tray does not until dropped", async () => {
  await trayToTop(apps[0], mouseHand(apps[0]), "desktop", 160);
});

test("mouse: a drag in free space shows no ghosts, and the drop puts the panel exactly where the hand left it", async () => {
  const app = apps[0];
  await app.type('layout("reset")');
  await settled(app.page);
  const s0 = await seen(app);
  const p = await stripAt(app, "log");
  const hand = mouseHand(app);
  await hand.down(p.x, p.y);
  await hand.to(p.x + 300, p.y - 200);
  const held = await seen(app);
  assert.deepEqual(held.ghosts, {}, "nothing would move but the held one, and it is where it will land");
  translucent(held, "log");
  await hand.up();
  const after = await seen(app);
  assert.deepEqual(rect(after.panels.log), { ...rect(s0.panels.log), x: s0.panels.log.x + 300, y: s0.panels.log.y - 200 });
  await app.type('layout("reset")');
});

// --- a finger, on an iPhone 13 held both ways up ------------------------------------

for (const device of ["iPhone 13", "iPhone 13 landscape"] as const) {
  const name = device === "iPhone 13" ? "phone-portrait" : "phone-landscape";
  let phone: AppContext;

  test(`${device}: the command line dragged onto the log by a finger — the log's ghost moves, the log does not; lifted, it does`, async () => {
    phone = await openApp({ device });
    apps.push(phone);
    await cmdOntoLog(phone, await fingerHand(phone), name);
  });

  test(`${device}: lifted back where it started, nothing moved`, async () => {
    await backWhereItStarted(phone, await fingerHand(phone));
  });

  test(`${device}: the tray dragged to an edge — its ghost turns, the tray does not until lifted`, async () => {
    await trayToTop(phone, await fingerHand(phone), name, 0);
  });

  test(`${device}: the ghosts are drawn at the interface size's line weight`, async () => {
    const app = phone;
    await app.type('layout("reset")');
    await settled(app.page);
    const p = await stripAt(app, "cmd");
    const s0 = await seen(app);
    const hand = await fingerHand(app);
    await hand.down(p.x, p.y);
    const [log, cmd] = [s0.panels.log, s0.panels.cmd];
    await hand.to(p.x + (log.x + log.w / 2 - (cmd.x + cmd.w / 2)), p.y + (log.y + log.h / 2 - cmd.y));
    const weight = await app.page.evaluate(() => {
      const g = document.querySelector<HTMLElement>(".pghost");
      const ui = Number(getComputedStyle(document.documentElement).getPropertyValue("--ui"));
      return { line: g ? parseFloat(getComputedStyle(g).borderTopWidth) : null, ui };
    });
    await hand.up();
    assert.ok(weight.line !== null, "a ghost was drawn");
    assert.ok(weight.ui > 1.2, `a phone's interface size: ${weight.ui}`);
    // A border is drawn a whole CSS pixel wide (Chromium floors 1.95 px to 1), so
    // the stylesheet rounds 1.5 px × the interface size to the nearest: 2 at a phone's 100 %.
    assert.equal(weight.line, Math.round(1.5 * weight.ui), `the line is 1.5 px × the interface size, to the pixel: ${JSON.stringify(weight)}`);
    await app.type('layout("reset")');
  });
}

test("no uncaught page errors — no preview anywhere overlapped", () => {
  for (const a of apps) assert.deepEqual(a.pageErrors, []);
});
