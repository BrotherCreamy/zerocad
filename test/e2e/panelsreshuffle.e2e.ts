// A dragged panel takes its place among the others; they are not shoved
// (docs/plans/panels-reshuffle.md), in a browser — with a mouse, and with a
// finger on an iPhone 13 and a Pixel 7, each held both ways up. The owner:
// "When I push toolbars around, they should be able to reorder with other
// toolbars. So reshuffle rather than push."
//
// What is checked, each way: a pane dragged along its edge past a neighbour's
// middle — the command line past the log under a mouse; on a phone, where
// those two share no edge, the log past the action strip upright and the
// command line past it on its side — trades places with it, the ghosts first
// and the panes standing still until the drop; the organiser brought to
// another edge is inserted where it is dropped, between the two it lands
// between; a floating pane dropped on another trades places with it; Escape
// mid-reorder commits nothing. And once each: a lock refuses the reorder; the
// tray taken to the top of an upright phone, the organiser and the action
// strip making room for it; the command line past the log in Safari, the
// organiser making room; and one of the refusals left (the log into the
// top-left corner of an upright phone) saying so on the ghost and in the
// status, the drop moving nothing. Every preview is checked by the page itself (a preview with two
// panes over each other is a page error under the dev server). Set
// NEOCAD_E2E_SHOTS to a directory to keep the pictures — and look at them.

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
  /** Every visible pane as drawn, relative to the panels' area. */
  panels: Record<string, Box & { opacity: number; orient: string | null }>;
  ghosts: Record<string, Box & { note: string | null }>;
  area: { w: number; h: number };
  dragging: boolean;
}

/** Every visible pane and every ghost, in the panels' area's coordinates (the window's, less the area's corner). */
const seen = (app: AppContext): Promise<Seen> => app.page.evaluate(() => {
  const wrap = document.getElementById("viewwrap")!;
  const o = wrap.getBoundingClientRect();
  const box = (el: Element) => { const r = el.getBoundingClientRect(); return { x: r.x - o.x, y: r.y - o.y, w: r.width, h: r.height }; };
  const panels: Seen["panels"] = {};
  for (const el of Array.from(document.querySelectorAll<HTMLElement>(".panel[data-panel]"))) {
    if (el.hidden) continue;
    panels[el.dataset.panel!] = { ...box(el), opacity: Number(getComputedStyle(el).opacity), orient: el.dataset.orient ?? null };
  }
  const ghosts: Seen["ghosts"] = {};
  const layer = document.querySelector<HTMLElement>(".pghosts");
  if (layer && !layer.hidden) {
    for (const g of Array.from(layer.querySelectorAll<HTMLElement>(".pghost"))) ghosts[g.dataset.ghost!] = { ...box(g), note: g.dataset.note ?? null };
  }
  return { panels, ghosts, area: { w: wrap.clientWidth, h: wrap.clientHeight }, dragging: wrap.classList.contains("dragging") };
});

const rect = (b: Box): Box => ({ x: b.x, y: b.y, w: b.w, h: b.h });
const places = (s: Seen) => Object.fromEntries(Object.entries(s.panels).map(([id, p]) => [id, rect(p)]));
const intersect = (a: Box, b: Box) => a.x < b.x + b.w - 0.5 && b.x < a.x + a.w - 0.5 && a.y < b.y + b.h - 0.5 && b.y < a.y + a.h - 0.5;
const near = (a: number, b: number, what: string) => assert.ok(Math.abs(a - b) <= 0.5, `${what}: ${a} vs ${b}`);

function apart(boxes: Record<string, Box>, what: string): void {
  const ids = Object.keys(boxes);
  for (let i = 0; i < ids.length; i++) {
    for (let j = i + 1; j < ids.length; j++) assert.ok(!intersect(boxes[ids[i]], boxes[ids[j]]), `${what}: ${ids[i]} and ${ids[j]} overlap: ${JSON.stringify(boxes)}`);
  }
}

/** Each pane of `landing` (a pane's place, or its ghost's) is where it is now. */
function landed(s: Seen, landing: Record<string, Box>): void {
  for (const [id, r] of Object.entries(landing)) {
    for (const k of ["x", "y", "w", "h"] as const) near(s.panels[id][k], r[k], `${id} landed on its ghost (${k})`);
  }
}

async function shot(app: AppContext, name: string): Promise<void> {
  if (!SHOTS) return;
  mkdirSync(SHOTS, { recursive: true });
  await app.page.screenshot({ path: join(SHOTS, `reshuffle-${name}.png`) });
}

/** The middle of pane `id`'s strip, in the area's coordinates. */
const stripAt = (app: AppContext, id: string) => app.page.$eval(`.panel[data-panel="${id}"] > .ptitle`, (el) => {
  const o = document.getElementById("viewwrap")!.getBoundingClientRect();
  const r = el.getBoundingClientRect();
  return { x: r.x - o.x + r.width / 2, y: r.y - o.y + r.height / 2 };
});

/** Two frames, so a picture read after the last move sent is not a move behind. */
const frames = (app: AppContext) => app.page.evaluate(() => new Promise<void>((r) => requestAnimationFrame(() => requestAnimationFrame(() => r()))));

/** A hand on a strip, either kind, in the area's coordinates: down, along, up. */
interface Hand {
  down(x: number, y: number): Promise<void>;
  to(x: number, y: number, steps?: number): Promise<void>;
  up(): Promise<void>;
}

async function origin(app: AppContext): Promise<{ x: number; y: number }> {
  return app.page.$eval("#viewwrap", (el) => { const r = el.getBoundingClientRect(); return { x: r.x, y: r.y }; });
}

async function mouseHand(app: AppContext): Promise<Hand> {
  const m = app.page.mouse;
  const o = await origin(app);
  const hand: Hand = {
    async down(x, y) { await m.move(o.x + x, o.y + y); await m.down(); stillDown = () => hand.up(); },
    async to(x, y, steps = 10) { await m.move(o.x + x, o.y + y, { steps }); await frames(app); },
    async up() { stillDown = null; await m.up(); await settled(app.page); },
  };
  return hand;
}

async function fingerHand(app: AppContext): Promise<Hand> {
  const f = await fingers(app);
  // The fingers' points are the canvas's; the canvas is the area's whole box.
  const [o, cv] = [await origin(app), await app.page.$eval("#cv", (el) => { const r = el.getBoundingClientRect(); return { x: r.x, y: r.y }; })];
  const at = (x: number, y: number): [number, number] => [o.x - cv.x + x, o.y - cv.y + y];
  const hand: Hand = {
    async down(x, y) { await f.down(at(x, y)); stillDown = () => hand.up(); },
    async to(x, y, steps = 12) { await f.glide(steps, at(x, y)); await frames(app); },
    async up() { stillDown = null; await f.up(); await settled(app.page); },
  };
  return hand;
}

/** The panes along one edge in `s`, in order: those within `reach` of it, by where they start along it. */
function along(s: Seen, edge: "left" | "right" | "top" | "bottom", reach: number): string[] {
  const { w, h } = s.area;
  const gap = (b: Box) => (edge === "left" ? b.x : edge === "top" ? b.y : edge === "right" ? w - b.x - b.w : h - b.y - b.h);
  const opposite = (b: Box) => (edge === "left" ? w - b.x - b.w : edge === "right" ? b.x : edge === "top" ? h - b.y - b.h : b.y);
  const ids = Object.keys(s.panels).filter((id) => gap(s.panels[id]) <= reach && opposite(s.panels[id]) > reach);
  const key = (b: Box) => (edge === "left" || edge === "right" ? b.y : b.x);
  return ids.sort((a, b) => key(s.panels[a]) - key(s.panels[b]));
}

// --- the ways the app is held --------------------------------------------------------

interface Way {
  name: string;
  device?: "iPhone 13" | "iPhone 13 landscape" | "Pixel 7" | "Pixel 7 landscape";
  /** The pane dragged along its edge, the neighbour it passes, the edge, and the way it goes. */
  reorder: { held: string; past: string; edge: "left" | "right" | "top"; dir: 1 | -1 };
  /** Where the organiser is taken to: an edge, and how far along it (the held pane's start) as a share of the area. */
  insert: { edge: "left" | "right" | "top"; at: number };
  /**
   * Two panes made floating, then one dropped on the other: side by side
   * (`row`) or one above the other, about a point of the drawing (shares of
   * the area) clear of every other pane.
   */
  swap: { a: string; b: string; row: boolean; at: [number, number] };
  finger: boolean;
}

const WAYS: Way[] = [
  {
    name: "mouse", reorder: { held: "cmd", past: "log", edge: "left", dir: -1 },
    insert: { edge: "top", at: 0.35 }, swap: { a: "organiser", b: "log", row: false, at: [0.5, 0.5] }, finger: false,
  },
  ...(["iPhone 13", "Pixel 7"] as const).flatMap((phone): Way[] => [
    {
      name: `${phone} upright`, device: phone, reorder: { held: "log", past: "actions", edge: "right", dir: -1 },
      insert: { edge: "right", at: 0.45 }, swap: { a: "log", b: "actions", row: false, at: [0.5, 0.6] }, finger: true,
    },
    {
      name: `${phone} on its side`, device: `${phone} landscape`, reorder: { held: "cmd", past: "actions", edge: "top", dir: 1 },
      insert: { edge: "left", at: 0.15 }, swap: { a: "log", b: "actions", row: true, at: [0.36, 0.5] }, finger: true,
    },
  ]),
];

/** How near an edge a pane is on it: the app's `reachOf` — 16 under a mouse, half a target under a finger at 100 %. */
const reachOf = (w: Way) => (w.finger ? 22 : 16);
const slug = (w: Way) => w.name.toLowerCase().replace(/ /g, "-");

for (const way of WAYS) {
  let app: AppContext;
  const hand = () => (way.finger ? fingerHand(app) : mouseHand(app));

  test(`${way.name}: dragged along its edge past the ${way.reorder.past}'s middle, the ${way.reorder.held} trades places with it — the ghosts first, nothing moved until the drop`, async () => {
    app = await openApp(way.device ? { device: way.device } : {});
    apps.push(app);
    await app.type('layout("reset")');
    await settled(app.page);
    const { held: id, past, edge, dir } = way.reorder;
    const s0 = await seen(app);
    const order0 = along(s0, edge, reachOf(way));
    assert.ok(order0.indexOf(past) === order0.indexOf(id) + dir, `the two are neighbours on the ${edge} edge: ${order0.join(", ")}`);
    const [h0, p0] = [s0.panels[id], s0.panels[past]];
    const p = await stripAt(app, id);
    // Along the edge only, until the held pane's leading edge is 10 px past the neighbour's middle.
    const vertical = edge !== "top";
    const lead = vertical ? (dir < 0 ? h0.y : h0.y + h0.h) : (dir < 0 ? h0.x : h0.x + h0.w);
    const mid = vertical ? p0.y + p0.h / 2 : p0.x + p0.w / 2;
    const d = mid + 10 * dir - lead;
    const to = vertical ? { x: p.x, y: p.y + d } : { x: p.x + d, y: p.y };
    const h = await hand();
    await h.down(p.x, p.y);
    await h.to(to.x, to.y);
    const s1 = await seen(app);
    for (const o of Object.keys(s0.panels)) if (o !== id) assert.deepEqual(rect(s1.panels[o]), rect(s0.panels[o]), `${o} has not moved under the hand`);
    assert.ok(s1.dragging, "the drag is on");
    assert.deepEqual(Object.keys(s1.ghosts).sort(), [id, past].sort(), `ghosts for exactly the two: ${JSON.stringify(s1.ghosts)}`);
    // The held one's ghost at the neighbour's slot start (going back) or ending where it ended (going on).
    const g = s1.ghosts;
    if (vertical) {
      if (dir < 0) { near(g[id].y, p0.y, "the held one's ghost starts where the neighbour did"); near(g[past].y + g[past].h, h0.y + h0.h, "the neighbour's ends where the held one did"); }
      else { near(g[past].y, h0.y, "the neighbour's ghost starts where the held one did"); near(g[id].y + g[id].h, p0.y + p0.h, "the held one's ends where the neighbour did"); }
    } else if (dir > 0) {
      near(g[past].x, h0.x, "the neighbour's ghost starts where the held one did");
      near(g[id].x + g[id].w, p0.x + p0.w, "the held one's ends where the neighbour did");
    }
    assert.equal(g[id].note, null, "no word on it: it fits");
    apart(Object.fromEntries(Object.entries(g).map(([k, b]) => [k, rect(b)])), "the ghosts");
    await shot(app, `${slug(way)}-reorder-held`);
    const landing = Object.fromEntries(Object.entries(g).map(([k, b]) => [k, rect(b)]));
    await h.up();
    const s2 = await seen(app);
    assert.deepEqual(s2.ghosts, {}, "the ghosts are gone");
    landed(s2, landing);
    const order2 = along(s2, edge, reachOf(way));
    assert.ok(order2.indexOf(id) === order2.indexOf(past) + dir, `dropped, they have traded places: ${order0.join(", ")} → ${order2.join(", ")}`);
    for (const o of Object.keys(s0.panels)) if (o !== id && o !== past) assert.deepEqual(rect(s2.panels[o]), rect(s0.panels[o]), `${o} did not move`);
    apart(places(s2), "after the drop");
    await shot(app, `${slug(way)}-reorder-dropped`);
  });

  test(`${way.name}: the organiser brought to the ${way.insert.edge} edge is inserted where it is dropped, the rest standing still`, async () => {
    await app.type('layout("reset")');
    await settled(app.page);
    const s0 = await seen(app);
    const o0 = s0.panels.organiser;
    const { edge, at } = way.insert;
    const p = await stripAt(app, "organiser");
    // The strip's point taken so the pane's side lies 40 px past the edge
    // (the hand pushes it into the edge; it is held inside), its start `at` along it.
    const want = edge === "top" ? { x: at * s0.area.w, y: -40 } : { x: edge === "left" ? -40 : s0.area.w - o0.w + 40, y: at * s0.area.h };
    const to = { x: p.x + want.x - o0.x, y: p.y + want.y - o0.y };
    const before = along(s0, edge, reachOf(way));
    const h = await hand();
    await h.down(p.x, p.y);
    await h.to(to.x, to.y, 16);
    const s1 = await seen(app);
    for (const o of Object.keys(s0.panels)) if (o !== "organiser") assert.deepEqual(rect(s1.panels[o]), rect(s0.panels[o]), `${o} has not moved under the hand`);
    const ghost = s1.ghosts.organiser;
    assert.equal(ghost?.note ?? null, null, `no refusal: ${JSON.stringify(s1.ghosts)}`);
    await shot(app, `${slug(way)}-insert-held`);
    await h.up();
    const s2 = await seen(app);
    const o2 = s2.panels.organiser;
    // Against the edge, and along it where the hand had it.
    if (edge === "top") { near(o2.y, 0, "flush with the top"); near(o2.x, want.x, "where it was dropped along the top"); }
    else {
      near(edge === "left" ? o2.x : s2.area.w - o2.x - o2.w, 0, `flush with the ${edge} edge`);
      near(o2.y, want.y, `where it was dropped along the ${edge} edge`);
    }
    const after2 = along(s2, edge, reachOf(way));
    const k = after2.indexOf("organiser");
    assert.ok(k >= 0, `in the ${edge} edge's sequence: ${after2.join(", ")}`);
    assert.deepEqual(after2.filter((o) => o !== "organiser"), before.filter((o) => o !== "organiser"), "the rest of that edge in the order it had");
    const key = (b: Box) => (edge === "top" ? b.x : b.y);
    if (k > 0) assert.ok(key(s2.panels[after2[k - 1]]) < key(o2), `after ${after2[k - 1]}`);
    if (k + 1 < after2.length) assert.ok(key(s2.panels[after2[k + 1]]) > key(o2), `before ${after2[k + 1]}`);
    for (const o of Object.keys(s0.panels)) if (o !== "organiser") assert.deepEqual(rect(s2.panels[o]), rect(s0.panels[o]), `${o} did not move: there was room`);
    apart(places(s2), "after the drop");
    await shot(app, `${slug(way)}-insert-dropped`);
  });

  test(`${way.name}: a floating pane dropped on another floating pane trades places with it`, async () => {
    await app.type('layout("reset")');
    await settled(app.page);
    const s0 = await seen(app);
    const { a, b, row, at } = way.swap;
    const [A, B] = [s0.panels[a], s0.panels[b]];
    // Both put in the drawing, well off every edge: side by side, or one above the other.
    const cx = Math.round(at[0] * s0.area.w);
    const cy = Math.round(at[1] * s0.area.h);
    const placesFor = row
      ? { [a]: { x: cx - A.w - 30, y: cy - 20 }, [b]: { x: cx + 30, y: cy - 20 } }
      : { [a]: { x: Math.round(cx - A.w / 2), y: cy - A.h - 60 }, [b]: { x: Math.round(cx - B.w / 2), y: cy + 30 } };
    for (const id of [a, b]) {
      const now = (await seen(app)).panels[id];
      const p = await stripAt(app, id);
      const h = await hand();
      await h.down(p.x, p.y);
      await h.to(p.x + placesFor[id].x - now.x, p.y + placesFor[id].y - now.y, 16);
      await h.up();
      const there = (await seen(app)).panels[id];
      near(there.x, placesFor[id].x, `${id} put where it was dropped (x)`);
      near(there.y, placesFor[id].y, `${id} put where it was dropped (y)`);
    }
    const s1 = await seen(app);
    const [A1, B1] = [s1.panels[a], s1.panels[b]];
    const p = await stripAt(app, a);
    // a's middle over b's.
    const to = { x: p.x + (B1.x + B1.w / 2) - (A1.x + A1.w / 2), y: p.y + (B1.y + B1.h / 2) - (A1.y + A1.h / 2) };
    const h = await hand();
    await h.down(p.x, p.y);
    await h.to(to.x, to.y);
    const s2 = await seen(app);
    assert.deepEqual(Object.keys(s2.ghosts).sort(), [a, b].sort(), `ghosts for the two: ${JSON.stringify(s2.ghosts)}`);
    near(s2.ghosts[a].x, B1.x, `${a}'s ghost at ${b}'s place`);
    near(s2.ghosts[a].y, B1.y, `${a}'s ghost at ${b}'s place`);
    near(s2.ghosts[b].x, A1.x, `${b}'s ghost at ${a}'s place`);
    near(s2.ghosts[b].y, A1.y, `${b}'s ghost at ${a}'s place`);
    assert.deepEqual(rect(s2.panels[b]), rect(B1), `${b} itself has not moved yet`);
    await shot(app, `${slug(way)}-swap-held`);
    await h.up();
    const s3 = await seen(app);
    near(s3.panels[a].x, B1.x, `${a} at ${b}'s place`);
    near(s3.panels[a].y, B1.y, `${a} at ${b}'s place`);
    near(s3.panels[b].x, A1.x, `${b} at ${a}'s place`);
    near(s3.panels[b].y, A1.y, `${b} at ${a}'s place`);
    assert.deepEqual([s3.panels[a].w, s3.panels[b].w], [A1.w, B1.w], "each its own size");
    apart(places(s3), "after the swap");
    await shot(app, `${slug(way)}-swap-dropped`);
  });

  test(`${way.name}: Escape mid-reorder commits nothing`, async () => {
    await app.type('layout("reset")');
    await settled(app.page);
    const s0 = await seen(app);
    const { held: id, past, edge, dir } = way.reorder;
    const [h0, p0] = [s0.panels[id], s0.panels[past]];
    const p = await stripAt(app, id);
    const vertical = edge !== "top";
    const d = vertical ? (p0.y + p0.h / 2 + 10 * dir - (dir < 0 ? h0.y : h0.y + h0.h)) : (p0.x + p0.w / 2 + 10 * dir - (dir < 0 ? h0.x : h0.x + h0.w));
    const h = await hand();
    await h.down(p.x, p.y);
    await h.to(vertical ? p.x : p.x + d, vertical ? p.y + d : p.y);
    assert.ok((await seen(app)).ghosts[past], "the reorder is shown");
    await app.page.keyboard.press("Escape");
    await settled(app.page);
    const s1 = await seen(app);
    assert.deepEqual(s1.ghosts, {}, "the ghosts are gone");
    assert.equal(s1.dragging, false);
    assert.deepEqual(places(s1), places(s0), "every pane where it was");
    await h.up();
    assert.deepEqual(places(await seen(app)), places(s0), "and the lift after it commits nothing");
  });
}

test("mouse: locked, a drag past a neighbour's middle reorders nothing — no ghost, nothing moved", async () => {
  const app = apps[0];
  await app.type('layout("reset")');
  await app.type("panels({ locked: true })");
  await settled(app.page);
  const s0 = await seen(app);
  const [cmd, log] = [s0.panels.cmd, s0.panels.log];
  // The strip is not drawn locked, but takes the press on its band.
  const p = await stripAt(app, "cmd");
  const h = await mouseHand(app);
  await h.down(p.x, p.y);
  await h.to(p.x, p.y + (log.y + log.h / 2 - 10 - cmd.y));
  const s1 = await seen(app);
  assert.deepEqual(s1.ghosts, {}, "no ghost");
  assert.deepEqual(places(s1), places(s0), "nothing moved under the hand");
  await h.up();
  assert.deepEqual(places(await seen(app)), places(s0), "nor at the drop");
  await app.type("panels({ locked: false })");
});

/**
 * A drag held at `to`, looked at, and dropped: the ghosts asserted sound and
 * every pane but the held one unmoved while held, each pane on its ghost after.
 * Returns the picture before and after.
 */
async function heldAndDropped(app: AppContext, id: string, to: { x: number; y: number }, name: string): Promise<{ s0: Seen; s1: Seen; s2: Seen }> {
  const s0 = await seen(app);
  const p = await stripAt(app, id);
  const h = await fingerHand(app);
  await h.down(p.x, p.y);
  await h.to(p.x + to.x, p.y + to.y);
  const s1 = await seen(app);
  for (const o of Object.keys(s0.panels)) if (o !== id) assert.deepEqual(rect(s1.panels[o]), rect(s0.panels[o]), `${o} has not moved under the hand`);
  const landing = { ...places(s0), ...Object.fromEntries(Object.entries(s1.ghosts).map(([k, b]) => [k, rect(b)])) };
  if (!s1.ghosts[id]) landing[id] = rect(s1.panels[id]);
  apart(landing, "where the drop would put them");
  await shot(app, `${name}-held`);
  await h.up();
  const s2 = await seen(app);
  assert.deepEqual(s2.ghosts, {}, "the ghosts are gone");
  landed(s2, landing);
  apart(places(s2), "after the drop");
  await shot(app, `${name}-dropped`);
  return { s0, s1, s2 };
}

test("iPhone 13 upright: the tray brought to the top turns into a row there, under the logo's row, and the organiser and the action strip make room — ghosts first", async () => {
  const app = apps.find((a) => a.page.viewportSize()?.width === 390)!;
  await app.type('layout("reset")');
  await settled(app.page);
  const t0 = (await seen(app)).panels.toolbar;
  // Off the left edge, and up to the top.
  const { s0, s1, s2 } = await heldAndDropped(app, "toolbar", { x: 60, y: -t0.y - 40 }, "iphone-13-upright-tray-to-the-top");
  assert.equal(s1.ghosts.toolbar?.note ?? null, null, `not refused: ${JSON.stringify(s1.ghosts)}`);
  assert.equal(s2.panels.toolbar.orient, "row", "a row");
  // Too long for the top beside the logo's corner (the logo and the status's
  // room), so a second line of the top, just under the logo's row — the
  // corner keeps its row for the status.
  const logo = await app.page.$eval("#logo", (el) => el.getBoundingClientRect().height);
  near(s2.panels.toolbar.y, logo + 8, "just under the logo's row");
  for (const o of ["organiser", "actions"]) {
    assert.ok(s1.ghosts[o], `the ${o} makes room, its ghost first: ${JSON.stringify(s1.ghosts)}`);
    assert.notDeepEqual(rect(s2.panels[o]), rect(s0.panels[o]), `the ${o} moved out of the row's way`);
  }
});

test("iPhone 13 upright (Safari): the command line dragged up the right edge past the log trades places with it, and the organiser it would lie on makes room", async () => {
  const app = apps.find((a) => a.page.viewportSize()?.width === 390)!;
  await app.type('layout("reset")');
  await settled(app.page);
  const s = await seen(app);
  const [cmd, log] = [s.panels.cmd, s.panels.log];
  assert.deepEqual(along(s, "right", 22), ["actions", "log", "cmd"], "in Safari the line runs right of the tray, down the right edge");
  // Its top 10 px past the log's middle, short of the strip's.
  const { s0, s1, s2 } = await heldAndDropped(app, "cmd", { x: 0, y: log.y + log.h / 2 - 10 - cmd.y }, "iphone-13-upright-safari-cmd-past-the-log");
  assert.equal(s1.ghosts.cmd?.note ?? null, null, `not refused: ${JSON.stringify(s1.ghosts)}`);
  assert.deepEqual(along(s2, "right", 22), ["actions", "cmd", "log"], "the two traded places");
  near(s2.panels.cmd.y, log.y, "the line in the log's slot");
  near(s2.panels.log.y + s2.panels.log.h, cmd.y + cmd.h, "the log in the line's");
  assert.notDeepEqual(rect(s2.panels.organiser), rect(s0.panels.organiser), "the organiser, which the line now crossed, moved out of its way");
});

test("iPhone 13 upright (Safari): the log taken up into the top-left corner — no room there: the ghost says so, and the drop moves nothing", async () => {
  // One of the refusals left (docs/plans/panels-reshuffle.md, As built): the
  // top beside the logo's corner is shorter than the log, and its second line
  // under the corner would leave the command line — as wide as the screen
  // right of the tray — no band of its height anywhere.
  const app = apps.find((a) => a.page.viewportSize()?.width === 390)!;
  await app.type('layout("reset")');
  await settled(app.page);
  const s0 = await seen(app);
  const l0 = s0.panels.log;
  const p = await stripAt(app, "log");
  const h = await fingerHand(app);
  await h.down(p.x, p.y);
  await h.to(p.x - 140, p.y - l0.y - 5);
  const s1 = await seen(app);
  assert.equal(s1.ghosts.log?.note, "no room on this edge", `the held log's ghost says why: ${JSON.stringify(s1.ghosts)}`);
  for (const k of ["x", "y", "w", "h"] as const) near(s1.ghosts.log[k], l0[k], `its ghost is home (${k})`);
  assert.deepEqual(Object.keys(s1.ghosts), ["log"], "nothing else would move");
  // The word at least 9em wide, on a line or two — not a word to a line.
  const label = await app.page.$eval('.pghost[data-ghost="log"]', (g) => {
    const st = getComputedStyle(g, "::after");
    return { w: parseFloat(st.width), font: parseFloat(st.fontSize) };
  });
  assert.ok(label.w >= 9 * label.font - 0.5, `the label is at least 9em wide: ${JSON.stringify(label)}`);
  await shot(app, "iphone-13-upright-log-to-the-corner-no-room-held");
  await h.up();
  assert.deepEqual(places(await seen(app)), places(s0), "nothing moved");
  assert.match(await app.page.$eval("#stepnote", (el) => el.textContent ?? ""), /no room on this edge — nothing moved/, "and the status says so");
});

test("no uncaught page errors — no preview anywhere overlapped", () => {
  for (const a of apps) assert.deepEqual(a.pageErrors, []);
});
