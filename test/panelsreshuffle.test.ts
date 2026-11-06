// A dragged panel takes its place among the others; they are not shoved
// (docs/plans/panels-reshuffle.md). The owner: "When I push toolbars around,
// they should be able to reorder with other toolbars. So reshuffle rather than
// push."
//
// The pure half: the panes along each edge are a sequence read from where they
// are; dragged along its edge past a neighbour's middle a pane takes that
// neighbour's slot, down the line; brought to another edge it is inserted
// between the two it lands between, and those after it make room; dropped on
// a floating pane the two trade places; with no room it wraps to a second
// line, and failing that the preview is refused and says so. Nothing is
// pushed, nothing leaves the area, every preview is sound, and a lock refuses
// all of it. The DOM half — the ghosts in a browser, under a mouse and a
// finger — is test/e2e/panelsreshuffle.e2e.ts.

import { test } from "node:test";
import assert from "node:assert/strict";
import {
  COARSE, FINE, NO_ROOM, NO_SWAP, arranged, backSlop, beginDrag, defaultLayout, dragTo, dropOf, edgesOf, ghostsOf, logoBox,
  migrated, overlapping, reachOf, relaid, sequences, traySize, minSizeOf, ACTIONS,
  type Drag, type Layout, type Point, type Rect, type Size,
} from "../src/panels.ts";

const area: Size = { w: 1000, h: 700 };
const box = (x: number, y: number, w = 100, h = 100): Rect => ({ x, y, w, h });
const minSize = () => ({ w: 10, h: 10 });
const reach = reachOf(FINE);

/** The drop at `to` of `id` taken by its top-left corner plus (5, 5). */
function dragged(layout: Layout, id: string, to: Point, buttons?: number, a: Size = area): Drag {
  const r = layout[id];
  const press = { x: r.x + 5, y: r.y + 5 };
  return dragTo(beginDrag(id, "move", press, layout, "se", buttons), { x: to.x + 5, y: to.y + 5 }, a, minSize);
}

/** Every panel wholly inside, and no two overlapping. */
function sound(l: Layout, a: Size = area): void {
  assert.deepEqual(overlapping(l), [], `no two overlap: ${JSON.stringify(l)}`);
  for (const [id, r] of Object.entries(l)) {
    assert.ok(r.x >= -1e-9 && r.y >= -1e-9 && r.x + r.w <= a.w + 1e-9 && r.y + r.h <= a.h + 1e-9, `${id} inside: ${JSON.stringify(r)}`);
  }
}

/** The ids of `l` in order down the left edge. */
const down = (l: Layout) => sequences(l, area, reach).left;

test("an edge's sequence is read from the panes' positions: in order along it, a corner in both, edge to edge in neither side, the logo and a floating pane in none", () => {
  const layout: Layout = {
    logo: { ...box(0, 0, 32, 32), fixed: true },
    c: box(8, 400), a: box(8, 40), b: box(0, 200), // the left edge, out of order in the record
    corner: box(892, 592), // bottom right
    span: box(0, 610, 300, 80), // in the bottom-left corner: the left's and the bottom's
    float: box(400, 300),
    top: box(500, 10, 100, 40),
  };
  const s = sequences(layout, area, reach);
  assert.deepEqual(s.left, ["a", "b", "c", "span"], "top to bottom, by where each is — not by the record's order");
  assert.deepEqual(s.right, ["corner"]);
  assert.deepEqual(s.bottom, ["span", "corner"], "left to right");
  assert.deepEqual(s.top, ["top"]);
  assert.deepEqual(edgesOf({ x: 0, y: 660, w: 1000, h: 40 }, area, reach), ["bottom"], "from edge to edge along the bottom it is on no side");
  assert.deepEqual(edgesOf(layout.float, area, reach), [], "a floating pane is on no edge");
  assert.ok(!Object.values(s).flat().includes("logo"), "the logo is the corner a sequence starts after, in none");
  // Within reach, which is more than the defaults' margin: what a fresh screen puts down is on its edges.
  assert.ok(reach > 8 && reachOf(COARSE) >= 22, `the reach: ${reach} under a mouse, ${reachOf(COARSE)} under a finger`);
});

test("dragged past a neighbour's middle, a pane swaps with exactly that one; short of it, it slides and stops flush", () => {
  const layout: Layout = { a: box(8, 40, 100, 80), b: box(8, 200, 100, 120), c: box(8, 400, 100, 60), d: box(8, 560, 100, 100) };
  // b's leading edge (its bottom) taken just past c's middle (430).
  const past = dragged(layout, "b", { x: 8, y: 431 - 120 });
  assert.deepEqual(down(past.preview), ["a", "c", "b", "d"]);
  assert.deepEqual(past.preview.c, box(8, 200, 100, 60), "c takes b's slot, from its start");
  // The block's far end is c's, and the gap between the two places is kept: c ends at 260, b starts 80 on.
  assert.deepEqual(past.preview.b, box(8, 340, 100, 120), "b after it, ending where c did");
  assert.deepEqual([past.preview.a, past.preview.d], [layout.a, layout.d], "nothing outside the two moves");
  assert.deepEqual(Object.keys(ghostsOf(past)).sort(), ["b", "c"]);
  sound(past.preview);
  // Short of the middle: no swap, and b's landing stops flush on c, which stays put.
  const short = dragged(layout, "b", { x: 8, y: 429 - 120 });
  assert.deepEqual(down(short.preview), ["a", "b", "c", "d"]);
  assert.deepEqual(short.preview.c, layout.c, "c is not pushed");
  assert.deepEqual(short.preview.b, box(8, 280, 100, 120), "b flush on c's top");
  assert.equal(short.refused, undefined);
  // Back up past a's middle: those two swap the other way.
  const up = dragged(layout, "b", { x: 8, y: 79 });
  assert.deepEqual(down(up.preview), ["b", "a", "c", "d"]);
  assert.deepEqual([up.preview.b.y, up.preview.a.y + up.preview.a.h], [40, 320], "the block's ends stay: b at a's start, a ending at b's end");
});

test("a drag down a column of four moves the held pane through the order, one neighbour at a time", () => {
  const layout: Layout = { a: box(8, 40, 100, 100), b: box(8, 180, 100, 100), c: box(8, 320, 100, 100), d: box(8, 460, 100, 100) };
  const press = { x: 20, y: 50 };
  let drag = beginDrag("a", "move", press, layout);
  const seen: string[][] = [];
  for (let y = 50; y <= 560; y += 10) {
    drag = dragTo(drag, { x: 20, y }, area, minSize);
    sound(drag.preview);
    const order = down(drag.preview);
    if (seen.length === 0 || seen[seen.length - 1].join() !== order.join()) seen.push(order);
  }
  assert.deepEqual(seen, [["a", "b", "c", "d"], ["b", "a", "c", "d"], ["b", "c", "a", "d"], ["b", "c", "d", "a"]],
    "through the order: each neighbour passed once, in turn");
  // At the end the whole column is where it was, a last: every slot kept.
  assert.deepEqual([drag.preview.b.y, drag.preview.c.y, drag.preview.d.y, drag.preview.a.y], [40, 180, 320, 460]);
  // And it is the spot, not the path: straight there, the same.
  assert.deepEqual(dragTo(beginDrag("a", "move", press, layout), { x: 20, y: 560 }, area, minSize).preview, drag.preview);
});

test("brought to another edge, a pane is inserted between the right two, and those after it make room — only as far as they must", () => {
  // Two on the right edge with room between them, one on the left to bring over.
  const layout: Layout = { p: box(892, 40, 100, 100), q: box(892, 300, 100, 100), r: box(892, 560, 100, 100), h: box(8, 300, 100, 120) };
  // Its middle between p's and q's: between those two. Room enough before q, so nothing moves.
  const free = dragged(layout, "h", { x: 900, y: 150 });
  assert.deepEqual(sequences(free.preview, area, reach).right, ["p", "h", "q", "r"]);
  assert.deepEqual(free.preview.h, box(900, 150, 100, 120), "where the hand put it, against the edge");
  assert.deepEqual([free.preview.q, free.preview.r], [layout.q, layout.r], "q and r had room to spare");
  // Dropped onto q's top: still between p and q (its middle above q's), and q makes room, then r.
  const tight = dragged(layout, "h", { x: 900, y: 240 });
  assert.deepEqual(sequences(tight.preview, area, reach).right, ["p", "h", "q", "r"]);
  assert.deepEqual(tight.preview.h, box(900, 240, 100, 120));
  assert.equal(tight.preview.q.y, 240 + 120 + 8, "q a room gap after it");
  assert.equal(tight.preview.r.y, layout.r.y, "r was still clear of q, and stays");
  assert.deepEqual(tight.preview.p, layout.p, "the one before it does not move");
  sound(tight.preview);
  // Onto p's bottom: it goes just after p, not over it.
  const onP = dragged(layout, "h", { x: 900, y: 100 });
  assert.equal(onP.preview.h.y, 40 + 100 + 8, "just after p");
  assert.deepEqual(sequences(onP.preview, area, reach).right, ["p", "h", "q", "r"]);
  sound(onP.preview);
});

test("a tray brought to another edge turns in its ghost — its own shape in the hand — and the drop turns it", () => {
  const n = 10;
  const tray = { x: 8, y: 300, ...traySize(n, "column"), orient: "column" as const };
  const layout: Layout = { tray, log: box(300, 500, 300, 100) };
  const d = dragged(layout, "tray", { x: 400, y: 0 }, n);
  assert.equal(d.held.orient, "column", "in the hand it still runs down");
  assert.equal(d.preview.tray.orient, "row", "its landing runs along the top");
  assert.deepEqual([d.preview.tray.w, d.preview.tray.h], [traySize(n, "row").w, traySize(n, "row").h]);
  assert.deepEqual([d.preview.tray.x, d.preview.tray.y], [400, 0], "its strip's end where the strip was");
  assert.equal(dropOf(d, { x: 405, y: 5 }, area, 2).layout.tray.orient, "row");
});

test("dropped on a floating pane, a pane trades places with it; on empty space it lands where it is put", () => {
  const layout: Layout = { a: box(200, 200, 120, 80), b: box(600, 300, 100, 150), docked: box(8, 500) };
  // a's middle over b.
  const swap = dragged(layout, "a", { x: 600, y: 330 });
  assert.deepEqual(swap.preview.a, box(600, 300, 120, 80), "a at b's place, its own size");
  assert.deepEqual(swap.preview.b, box(200, 200, 100, 150), "b at a's");
  assert.deepEqual(swap.preview.docked, layout.docked);
  assert.deepEqual(Object.keys(ghostsOf(swap)).sort(), ["a", "b"]);
  sound(swap.preview);
  // Clamped inside: b, taller than room at a's place near the bottom, is held in.
  const low: Layout = { a: box(300, 640, 100, 50), b: box(600, 100, 100, 200) };
  const clamped = dragged(low, "a", { x: 600, y: 150 });
  assert.equal(clamped.preview.b.y + clamped.preview.b.h, area.h, "each at the other's place, held inside the area");
  // Empty space: no ghosts at all — it lands under the hand.
  const empty = dragged(layout, "a", { x: 400, y: 50 });
  assert.deepEqual(ghostsOf(empty), {});
  assert.deepEqual(empty.preview.a, box(400, 50, 120, 80));
  // A swap that lands a on a third pane: that pane makes room, at the nearest
  // place on nothing — reshuffled, not refused.
  const crowded: Layout = { a: box(200, 200, 300, 80), b: box(600, 300, 100, 100), c: box(710, 300, 100, 100) };
  const made = dragged(crowded, "a", { x: 500, y: 290 });
  assert.equal(made.refused, undefined);
  assert.deepEqual([made.preview.a, made.preview.b], [box(600, 300, 300, 80), box(200, 200)], "the two traded");
  assert.deepEqual(made.preview.c, box(710, 380), "c just under a, the nearest place clear of it");
  sound(made.preview);
});

test("nothing is pushed: dropped partly on a pane that is on an edge, the held one stops flush and the other stays", () => {
  const layout: Layout = { a: box(300, 100), b: box(8, 300, 200, 200) };
  const d = dragged(layout, "a", { x: 300, y: 250 });
  assert.deepEqual(d.preview.b, layout.b, "b is not moved");
  assert.equal(d.preview.a.y + d.preview.a.h <= layout.b.y || d.preview.a.x >= layout.b.x + layout.b.w, true, "a stops clear of it");
  sound(d.preview);
});

test("no room on an edge: the pane wraps to a second line beside the first — and where that has none either, the preview is refused and says so", () => {
  // The right edge full from top to bottom: two panes and the gap between them too small.
  const layout: Layout = { p: box(892, 0, 100, 330), q: box(892, 370, 100, 330), h: box(8, 300, 100, 120) };
  const wrap = dragged(layout, "h", { x: 900, y: 300 });
  assert.equal(wrap.refused, undefined);
  assert.deepEqual(wrap.preview.h, box(1000 - 8 - 100 - 8 - 100, 300, 100, 120), "a second line: a room gap off the first");
  assert.deepEqual([wrap.preview.p, wrap.preview.q], [layout.p, layout.q], "the first line untouched");
  sound(wrap.preview);
  // A pane already where the second line would be: it makes room.
  const full: Layout = { ...layout, s: box(700, 250, 150, 250) };
  const made = dragged(full, "h", { x: 900, y: 300 });
  assert.equal(made.refused, undefined);
  assert.deepEqual(made.preview.h, wrap.preview.h, "the second line where it was");
  assert.notDeepEqual(made.preview.s, full.s, "s out of its way");
  assert.ok(Object.keys(ghostsOf(made)).includes("s"), "and its ghost shows where");
  sound(made.preview);
  // Refused only where the panes cannot all be had: a 300 px square whose right
  // edge is full, and a pane too wide for a second line beside it.
  const small: Size = { w: 300, h: 300 };
  const tight: Layout = { p: box(192, 0, 100, 140), q: box(192, 150, 100, 140), h: box(0, 80, 200, 100) };
  const no = dragged(tight, "h", { x: 100, y: 80 }, undefined, small);
  assert.equal(no.refused, NO_ROOM);
  assert.equal(no.preview, tight, "the preview is the start…");
  assert.deepEqual(ghostsOf(no), { h: tight.h }, "…and the held pane's ghost is where it was, which is where it would go back to");
  const drop = dropOf(no, { x: 105, y: 85 }, small, 2);
  assert.deepEqual([drop.outcome, drop.problem], ["refused", NO_ROOM]);
  assert.equal(drop.layout, tight, "a refused drop moves nothing");
});

test("a pane dragged along its edge into a pane that is not in the line stops flush against it; past the middle of a wide one, the pane off the edge it lands on makes room", () => {
  // Down the left edge: a, then a pane beside it that is not on the edge.
  const layout: Layout = { a: box(8, 40, 100, 100), wide: box(8, 400, 600, 100), off: box(300, 100, 300, 120) };
  // Short of wide's middle: flush on it, nothing moved.
  const short = dragged(layout, "a", { x: 8, y: 330 });
  assert.deepEqual(short.preview.a, box(8, 300, 100, 100));
  assert.deepEqual([short.preview.wide, short.preview.off], [layout.wide, layout.off]);
  // a (100 wide) and wide (600) trade: wide at a's slot lies on `off`, which
  // goes to the nearest place on nothing — under wide.
  const d = dragged(layout, "a", { x: 8, y: 400 });
  assert.equal(d.refused, undefined);
  assert.deepEqual([d.preview.wide.y, d.preview.a.y], [40, 400], "the two traded slots");
  assert.deepEqual(d.preview.off, box(300, 140, 300, 120), "off just under wide");
  sound(d.preview);
});

test("a layout stored before sequences — v2 rectangles — is read into the same order once migrated and laid out", () => {
  const legacy: Layout = {
    toolbar: { x: 8, y: 40, w: 28, h: 300, orient: "column" },
    log: { x: 8, y: 420, w: 400, h: 120 },
    cmd: { x: 8, y: 560, w: 400, h: 44 },
    organiser: { x: 802, y: 400, w: 190, h: 292 },
  };
  const stored = migrated(legacy, area, 1);
  const recs = Object.fromEntries(Object.entries(stored).map(([id, e]) => [id, e.at!]));
  const fixed: Layout = { logo: { x: 0, y: 0, ...logoBox(FINE), fixed: true } };
  const sizeOf = (id: string, o: "row" | "column" | undefined) => (id === "toolbar" ? traySize(12, o ?? "column") : null);
  const mins = (id: string, o: "row" | "column" | undefined) => minSizeOf(id, o, id === "toolbar", undefined, FINE);
  const laid = relaid(recs, fixed, area, 1, sizeOf, mins);
  const shown = arranged(Object.keys(legacy), laid, defaultLayout(area, 12), { toolbar: 12 }, area, {}, FINE, fixed).layout;
  const was = sequences(legacy, area, reach);
  assert.deepEqual(sequences(shown, area, reach), was, "the same sequences, edge by edge");
  assert.deepEqual(was.left, ["toolbar", "log", "cmd"]);
  assert.deepEqual(was.right, ["organiser"]);
});

test("locked, a drag past a neighbour's middle reorders nothing, and the drop commits nothing", () => {
  const layout: Layout = { a: box(8, 40, 100, 80), b: box(8, 200, 100, 120) };
  let drag = beginDrag("b", "move", { x: 20, y: 205 }, layout, "se", undefined, true);
  drag = dragTo(drag, { x: 20, y: 40 }, area, minSize);
  assert.equal(drag.preview, layout);
  assert.deepEqual(ghostsOf(drag), {});
  assert.equal(dropOf(drag, { x: 20, y: 40 }, area, 2).outcome, "locked");
});

test("every preview is sound and every drop commits it: 1 500 random gestures on a phone's defaults, a refusal only ever with its reason", () => {
  const m = COARSE;
  for (const a of [{ w: 390, h: 763 }, { w: 750, h: 369 }]) {
    const tools = 13;
    const counts: Record<string, number> = { toolbar: tools, actions: ACTIONS.length };
    const { options: _o, ...defaults } = defaultLayout(a, tools, m);
    const fixed: Layout = { logo: { x: 0, y: 0, ...logoBox(m), fixed: true } };
    let layout = arranged(Object.keys(defaults), {}, defaults, counts, a, {}, m, fixed).layout;
    sound(layout, a);
    let seed = 29;
    const rand = () => ((seed = (seed * 1103515245 + 12345) % 2147483648) / 2147483648);
    const ids = Object.keys(layout).filter((id) => !layout[id].fixed);
    const mins = (id: string, orient: "row" | "column" | undefined) => minSizeOf(id, orient, id in counts, undefined, m);
    let refused = 0;
    let moved = 0;
    for (let i = 0; i < 750; i++) {
      const id = ids[Math.floor(rand() * ids.length)];
      const r = layout[id];
      const press = { x: r.x + 4, y: r.y + 4 };
      let drag = beginDrag(id, "move", press, layout, "se", counts[id]);
      const to = { x: rand() * a.w, y: rand() * a.h };
      for (let s = 1; s <= 4; s++) {
        drag = dragTo(drag, { x: press.x + ((to.x - press.x) * s) / 4, y: press.y + ((to.y - press.y) * s) / 4 }, a, mins, m);
        sound(drag.preview, a);
      }
      const drop = dropOf(drag, to, a, backSlop(true));
      if (drop.outcome === "refused") {
        refused++;
        assert.ok(drop.problem === NO_ROOM || drop.problem === NO_SWAP, `refused for its reason, not an unsound preview: ${drop.problem}`);
        assert.equal(drop.layout, layout);
      } else if (drop.outcome === "moved") {
        moved++;
        assert.equal(drop.layout, drag.preview, "the drop commits what the ghosts showed");
      }
      layout = drop.layout;
      sound(layout, a);
    }
    assert.ok(moved > 300, `most gestures move something: ${moved} moved, ${refused} refused`);
  }
});
