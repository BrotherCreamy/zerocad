// A dragged panel shows where everything will land, and nothing moves until it
// is dropped (docs/plans/panels-preview.md). The owner: "they should show how
// they will snap IF the user drops the grasped toolbar in that spot. but until
// they actually drop it, the permanent position of any tool bar is not
// changed".
//
// The pure half: the preview is the drop at this spot — one `dragStep` from
// the layout at the press, so the same spot shows the same ghosts however it
// was reached, and the press shows none; the held panel is under the hand; the
// ghosts are what the drop would move; the drop commits the preview, and a lift
// back at the press or a refused preview commits nothing. The DOM half — the panels
// standing still, translucent, the ghosts drawn, Escape — is
// test/e2e/panelspreview.e2e.ts.

import { test } from "node:test";
import assert from "node:assert/strict";
import {
  SNAP, backSlop, beginDrag, dragStep, dragTo, dropOf, ghostsOf, heldAt, layoutProblem, overlapping, traySize,
  touchMetrics, defaultLayout, arranged, trayRoom,
  type Drag, type Layout, type Point, type Rect, type Size,
} from "../src/panels.ts";

const area: Size = { w: 1000, h: 700 };
const box = (x: number, y: number, w = 100, h = 100): Rect => ({ x, y, w, h });
const minSize = () => ({ w: 10, h: 10 });

/** Drags `drag` along `path`, one move per point. */
function along(drag: Drag, path: Point[], a: Size = area, mins: (id: string, o: "row" | "column" | undefined) => Size = minSize): Drag {
  for (const p of path) drag = dragTo(drag, p, a, mins);
  return drag;
}

/** `from` to `to` in `n` even steps, `to` included. */
function steps(from: Point, to: Point, n: number): Point[] {
  return Array.from({ length: n }, (_, i) => ({ x: from.x + ((to.x - from.x) * (i + 1)) / n, y: from.y + ((to.y - from.y) * (i + 1)) / n }));
}

/** Every panel wholly inside, and no two overlapping. */
function sound(l: Layout, a: Size = area): void {
  assert.deepEqual(overlapping(l), [], `no two overlap: ${JSON.stringify(l)}`);
  for (const [id, r] of Object.entries(l)) {
    assert.ok(r.x >= -1e-9 && r.y >= -1e-9 && r.x + r.w <= a.w + 1e-9 && r.y + r.h <= a.h + 1e-9, `${id} inside: ${JSON.stringify(r)}`);
  }
}

test("the preview is the drop at this spot: one dragStep from the layout at the press — and the layout itself is untouched", () => {
  const layout: Layout = { a: box(100, 100), b: box(250, 100), c: box(400, 150) };
  const frozen = JSON.parse(JSON.stringify(layout));
  const begun = beginDrag("a", "move", { x: 150, y: 150 }, layout);
  const drag = along(begun, steps({ x: 150, y: 150 }, { x: 420, y: 160 }, 9));
  const once = dragStep(begun.grab, { x: 420, y: 160 }, layout, area, minSize);
  assert.deepEqual(drag.preview, once.layout, "the resolver's single step from the press to here");
  assert.ok(drag.preview.b.x > layout.b.x && drag.preview.c.x > layout.c.x, "b and c pushed, in the preview");
  assert.deepEqual(layout, frozen, "and nothing about the layout itself changed");
  assert.deepEqual(drag.start, frozen, "the start is the layout at the press");
});

test("one spot by two paths: the same ghosts and the same drop — and out and back to the press, no ghosts", () => {
  // A tray, the log under it and the command line under that, in a window
  // with room for the pushes to be different if the path mattered.
  const layout: Layout = {
    tray: { x: 8, y: 40, ...traySize(10, "column"), orient: "column" },
    log: box(60, 420, 400, 120), cmd: box(60, 560, 400, 40), org: box(700, 300, 200, 200),
  };
  const mins = (id: string, o: "row" | "column" | undefined) => (id === "tray" ? traySize(1, o ?? "column") : { w: 60, h: 30 });
  const press = { x: 22, y: 48 };
  const spot = { x: 300, y: 300 };
  const begin = () => beginDrag("tray", "move", press, layout, "se", 10);
  // Straight there; and the long way round — down through the log and the
  // command line to the bottom edge, across under the organiser, up past it.
  const straight = along(begin(), steps(press, spot, 12), area, mins);
  const detour = along(begin(), [
    ...steps(press, { x: 120, y: 690 }, 15), ...steps({ x: 120, y: 690 }, { x: 800, y: 690 }, 15),
    ...steps({ x: 800, y: 690 }, { x: 800, y: 100 }, 15), ...steps({ x: 800, y: 100 }, spot, 15),
  ], area, mins);
  assert.ok(Object.keys(ghostsOf(along(begin(), steps(press, { x: 120, y: 690 }, 15), area, mins))).length > 1,
    "the detour pushed things on its way");
  assert.deepEqual(ghostsOf(detour), ghostsOf(straight), "the same ghosts");
  assert.deepEqual(detour.preview, straight.preview, "the same preview");
  assert.deepEqual(dropOf(detour, spot, area, backSlop(false)), dropOf(straight, spot, area, backSlop(false)), "the same drop");
  // Out through everything and back to the press exactly: the start, no ghosts.
  const home = along(begin(), [...steps(press, { x: 120, y: 690 }, 15), ...steps({ x: 120, y: 690 }, press, 15)], area, mins);
  assert.deepEqual(ghostsOf(home), {}, "back at the press: no ghosts");
  assert.deepEqual(home.preview, layout, "the preview is the start");
  sound(straight.preview);
});

test("the resolver's answer for a drag position equals the layout a drop there commits", () => {
  const layout: Layout = { tray: { x: 8, y: 40, ...traySize(10, "column"), orient: "column" }, log: box(8, 500, 400, 120), cmd: box(8, 630, 400, 40) };
  let seed = 3;
  const rand = () => ((seed = (seed * 1103515245 + 12345) % 2147483648) / 2147483648);
  for (let trial = 0; trial < 200; trial++) {
    const ids = Object.keys(layout);
    const id = ids[Math.floor(rand() * ids.length)];
    const r = layout[id];
    const press = { x: r.x + 5, y: r.y + 5 };
    const to = { x: rand() * area.w, y: rand() * area.h };
    const drag = along(beginDrag(id, "move", press, layout, "se", id === "tray" ? 10 : undefined), steps(press, to, 1 + Math.floor(rand() * 12)));
    const drop = dropOf(drag, to, area, backSlop(false));
    if (drop.outcome === "back") continue;
    assert.ok(drop.outcome === "moved" || drop.outcome === "unchanged", `trial ${trial}: ${drop.outcome} ${drop.problem}`);
    assert.deepEqual(drop.layout, drag.preview, `trial ${trial}: the drop commits exactly what the ghosts showed`);
    sound(drag.preview);
  }
});

test("the held panel is under the hand at the point it was taken by, held inside the area and against nothing else", () => {
  const layout: Layout = { a: box(100, 100), b: box(300, 100) };
  const drag = along(beginDrag("a", "move", { x: 130, y: 120 }, layout), steps({ x: 130, y: 120 }, { x: 380, y: 140 }, 5));
  assert.deepEqual(drag.held, box(350, 120), "over b, exactly under the hand — the push is the preview's, not the hand's");
  assert.deepEqual(drag.preview.a, box(350, 120), "the preview has a there too, unblocked…");
  assert.deepEqual(drag.preview.b, box(450, 100), "…and b pushed out of its way");
  assert.deepEqual(drag.start.b, box(300, 100), "while b itself has not moved");
  // Past the right edge the hand goes on; the held panel stops at the edge, as every panel does.
  const far = dragTo(drag, { x: 5000, y: 140 }, area, minSize);
  assert.equal(far.held.x + far.held.w, area.w, "held wholly inside");
});

test("a drag that moves nothing draws no ghosts; one stopped short shows only its own, where it will snap", () => {
  const layout: Layout = { a: box(100, 100), b: box(600, 400) };
  const free = along(beginDrag("a", "move", { x: 150, y: 150 }, layout), steps({ x: 150, y: 150 }, { x: 300, y: 200 }, 6));
  assert.deepEqual(ghostsOf(free), {}, "free space: the held panel is where it will land, and nothing else moves");
  const none = beginDrag("a", "move", { x: 150, y: 150 }, layout);
  assert.deepEqual(ghostsOf(none), {}, "at the press, none");
  // Against the top edge with b pinned under it nothing is stopped; against
  // a chain at the right edge, the held panel goes on and its ghost stops flush.
  const chain: Layout = { a: box(500, 100), b: box(800, 100), c: box(900, 100) };
  const stopped = along(beginDrag("a", "move", { x: 550, y: 150 }, chain), steps({ x: 550, y: 150 }, { x: 800, y: 150 }, 5));
  const g = ghostsOf(stopped);
  assert.deepEqual(Object.keys(g), ["a"], "only the held one's, b and c cannot move");
  assert.deepEqual(g.a, box(700, 100), "flush against the chain");
  assert.deepEqual(stopped.held, box(750, 100), "while the hand has it 50 px on");
});

test("a pushed panel's ghost is where it will land, and a fixed panel never has one", () => {
  const layout: Layout = { logo: { ...box(0, 0, 40, 40), fixed: true }, a: box(100, 100), b: box(100, 250) };
  const drag = along(beginDrag("a", "move", { x: 150, y: 150 }, layout), steps({ x: 150, y: 150 }, { x: 150, y: 250 }, 5));
  const g = ghostsOf(drag);
  assert.deepEqual(Object.keys(g).sort(), ["b"], "the held one is where it will land; b's ghost below it");
  assert.deepEqual(g.b, box(100, 300));
  const up = along(beginDrag("a", "move", { x: 150, y: 150 }, layout), steps({ x: 150, y: 150 }, { x: 20, y: 20 }, 8));
  assert.ok(!("logo" in ghostsOf(up)), "nothing moves the logo");
  sound(up.preview);
});

test("a tray's turn is the preview's: the held tray keeps the way it ran, its ghost turns, and the drop turns it", () => {
  const layout: Layout = { tray: { x: 400, y: 300, ...traySize(10, "column"), orient: "column" } };
  const mins = () => ({ w: 28, h: 28 });
  const press = { x: 407, y: 308 };
  const drag = along(beginDrag("tray", "move", press, layout, "se", 10), steps(press, { x: 407, y: 2 }, 10), area, mins);
  assert.equal(drag.preview.tray.orient, "row", "the resolver turned it at the top edge");
  assert.ok(drag.preview.tray.y <= SNAP, "against the top");
  assert.equal(drag.held.orient, "column", "but in the hand it is still a column…");
  assert.deepEqual([drag.held.w, drag.held.h], [layout.tray.w, layout.tray.h], "…its own shape");
  assert.equal(ghostsOf(drag).tray?.orient, "row", "its ghost is the turned tray");
  const drop = dropOf(drag, { x: 407, y: 2 }, area, backSlop(false));
  assert.equal(drop.outcome, "moved");
  assert.equal(drop.layout.tray.orient, "row", "the turn happens at the drop");
});

test("lifting back where the drag started commits nothing — and a finger's lift near the press counts as back", () => {
  const layout: Layout = { a: box(100, 100), b: box(100, 250) };
  const press = { x: 150, y: 150 };
  // Down into b (b's ghost pushed), and back up to a pixel off the press.
  let drag = along(beginDrag("a", "move", press, layout), steps(press, { x: 150, y: 260 }, 6));
  assert.ok(drag.preview.b.y > layout.b.y, "b's ghost pushed on the way");
  drag = along(drag, steps({ x: 150, y: 260 }, { x: 151, y: 151 }, 6));
  assert.deepEqual(drag.preview.b, layout.b, "the hand drawn back, b's ghost is home: the preview is the spot's");
  const mouse = dropOf(drag, { x: 151, y: 151 }, area, backSlop(false));
  assert.equal(mouse.outcome, "back");
  assert.equal(mouse.layout, drag.start, "the start, exactly — not a pixel's move of a");
  // A finger's slop is the tap's: 8 px.
  const near = dragTo(drag, { x: 155, y: 156 }, area, minSize);
  assert.equal(dropOf(near, { x: 155, y: 156 }, area, backSlop(true)).outcome, "back");
  assert.equal(dropOf(near, { x: 155, y: 156 }, area, backSlop(false)).outcome, "moved", "a mouse 7 px off has moved it");
  assert.equal(backSlop(true), 8);
  assert.equal(backSlop(false), 2);
});

test("Escape goes back to the start: the drag never changed it, so there is nothing to undo", () => {
  // Escape is the DOM half's (it drops nothing); what it relies on is that a
  // gesture's start is the layout at the press, kept whole through every move.
  const layout: Layout = { a: box(100, 100), b: box(250, 100), c: box(400, 150) };
  const frozen = JSON.parse(JSON.stringify(layout));
  let seed = 11;
  const rand = () => ((seed = (seed * 1103515245 + 12345) % 2147483648) / 2147483648);
  let drag = beginDrag("a", "move", { x: 150, y: 150 }, layout);
  for (let i = 0; i < 200; i++) drag = dragTo(drag, { x: rand() * area.w, y: rand() * area.h }, area, minSize);
  assert.deepEqual(drag.start, frozen);
  assert.deepEqual(layout, frozen);
});

test("a preview the resolver could not make sound is refused at the drop, like Escape, and says why", () => {
  const layout: Layout = { a: box(100, 100), b: box(300, 100) };
  const drag: Drag = { ...beginDrag("a", "move", { x: 150, y: 150 }, layout), preview: { a: box(250, 100), b: box(300, 100) } };
  const drop = dropOf(drag, { x: 300, y: 150 }, area, backSlop(false));
  assert.equal(drop.outcome, "refused");
  assert.equal(drop.layout, drag.start, "nothing moves");
  assert.match(drop.problem ?? "", /overlap/);
  assert.equal(layoutProblem(drag.start, true, area), null);
});

test("a drop that changes nothing is unchanged, and commits the start", () => {
  const layout: Layout = { a: box(900, 100), b: box(100, 400) };
  // Into the right edge and no further: the preview has a exactly where it was.
  const drag = along(beginDrag("a", "move", { x: 950, y: 150 }, layout), steps({ x: 950, y: 150 }, { x: 990, y: 150 }, 4));
  const drop = dropOf(drag, { x: 990, y: 150 }, area, backSlop(false));
  assert.equal(drop.outcome, "unchanged");
  assert.equal(drop.layout, drag.start);
});

test("a resize is previewed the same way: the held panel grows under the hand, the neighbour's ghost is pushed", () => {
  const layout: Layout = { a: box(100, 100, 200, 100), b: box(100, 250, 200, 100) };
  const press = { x: 298, y: 198 };
  const drag = along(beginDrag("a", "resize", press, layout, "se"), steps(press, { x: 298, y: 298 }, 5));
  assert.deepEqual(drag.held, box(100, 100, 200, 200), "grown down to the hand, over b");
  assert.deepEqual(drag.preview.b, box(100, 300, 200, 100), "b's ghost pushed under it");
  assert.deepEqual(drag.start.b, box(100, 250, 200, 100), "b itself where it was");
  assert.deepEqual(heldAt(drag, { x: 298, y: 298 }, area, minSize()), drag.held);
  assert.equal(dropOf(drag, { x: 298, y: 298 }, area, backSlop(false)).layout, drag.preview);
});

test("everything fits for every preview: 1 500 random gestures on a phone's defaults, no ghost over another or outside", () => {
  // The phone's own defaults (touchLayout, through `arranged` as the app
  // places them), portrait and landscape, at 100 % of a phone.
  const m = touchMetrics(1.3);
  for (const a of [{ w: 390, h: 763 }, { w: 750, h: 369 }]) {
    const tools = 13;
    const counts = { toolbar: tools, actions: 4 };
    const defaults = defaultLayout(a, tools, m);
    const order = Object.keys(defaults);
    const placed = arranged(order, {}, defaults, counts, a, {}, m).layout;
    sound(placed, a);
    let seed = 17;
    const rand = () => ((seed = (seed * 1103515245 + 12345) % 2147483648) / 2147483648);
    const ids = Object.keys(placed);
    const mins = (id: string, orient: "row" | "column" | undefined) =>
      id in counts ? traySize(1, orient ?? "column", m) : { w: 60, h: m.title + 10 };
    let layout = placed;
    for (let i = 0; i < 750; i++) {
      const id = ids[Math.floor(rand() * ids.length)];
      const r = layout[id];
      const press = { x: r.x + 4, y: r.y + 4 };
      const buttons = id in counts ? counts[id as keyof typeof counts] : undefined;
      let drag = beginDrag(id, "move", press, layout, "se", buttons);
      const to = { x: rand() * a.w, y: rand() * a.h };
      for (const p of steps(press, to, 2 + Math.floor(rand() * 10))) {
        drag = dragTo(drag, p, a, mins, m);
        sound(drag.preview, a);
      }
      const drop = dropOf(drag, to, a, backSlop(true));
      assert.notEqual(drop.outcome, "refused");
      layout = drop.layout;
      sound(layout, a);
    }
    // Room in the area for a tray to wrap is the area's, whatever is dragged.
    assert.ok(trayRoom(a, "row", m) > 0);
  }
});
