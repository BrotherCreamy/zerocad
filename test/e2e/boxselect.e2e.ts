// Box select, driven by a real mouse.
//
// The unit suite checks the predicates — what a rectangle contains and what it
// touches. What only a browser can answer is whether the *gesture* works: that
// a left-drag on empty canvas draws a box rather than panning, that the
// direction of the drag chooses the mode, that the names come out in the
// command line exactly as clicks do, and that the three other things the left
// button already meant still mean them.
//
// Canvas coordinates are kept well above the bottom edge on purpose: the log
// pane grows as these tests type into it and takes height from the canvas.

import { test, before, after } from "node:test";
import assert from "node:assert/strict";
import { axisFrame, openApp, type AppContext } from "./harness.ts";

let app: AppContext;
after(async () => { await app.close(); });

const cmd = () => app.page.$eval("#cmd", (el) => (el as HTMLInputElement).value);

/** What the engine thinks the box in progress is, from inside the page. */
const boxState = () => app.page.evaluate(() => {
  const { engine } = (window as never as {
    __neocad: { engine: { box: unknown; boxMode: string | null } };
  }).__neocad;
  return { open: engine.box !== null, mode: engine.boxMode };
});

/** Canvas-relative screen coordinates of a named entity's point. */
async function screenOf(name: string): Promise<[number, number]> {
  return app.page.evaluate((n) => {
    const { model, engine } = (window as never as {
      __neocad: { model: { coords(x: string): number[] }; engine: { worldToScreen(w: number[]): [number, number] } };
    }).__neocad;
    return engine.worldToScreen(model.coords(n));
  }, name);
}

/**
 * Drags a box from (ax, ay) to (bx, by) in canvas pixels, optionally pausing
 * mid-gesture. Returns nothing: what it did is read off the command line.
 */
async function dragBox(ax: number, ay: number, bx: number, by: number, mid?: () => Promise<void>) {
  const from = await app.at(ax, ay);
  const to = await app.at(bx, by);
  await app.page.mouse.move(from.x, from.y);
  await app.page.mouse.down();
  await app.page.mouse.move(to.x, to.y, { steps: 6 });
  await app.page.waitForTimeout(80);
  if (mid) await mid();
  await app.page.mouse.up();
  await app.page.waitForTimeout(150);
}

before(async () => {
  app = await openApp();
  // `fix` is relative to a frame now; this one sits on the kernel's origin,
  // clear of the drawing on the left and of the point out to the right.
  await axisFrame(app);
  // A rectangle on the left, and a long edge reaching out of it to a point on
  // the right. A box round the rectangle contains it whole and only *clips*
  // the reaching edge, which is the difference between the two modes.
  await app.type("pt(-60,-20); pt(-20,-20); pt(-20,20); pt(-60,20)");
  await app.type('ln("p1","p2"); ln("p2","p3"); ln("p3","p4"); ln("p4","p1")');
  await app.type("pt(80,0)");
  await app.type('ln("p3","p5")'); // out of the rectangle's top-right corner
  await app.type('fix("p1", [-60,-20])');
});

test("a left-drag on empty canvas draws a box instead of panning", async () => {
  await app.page.fill("#cmd", "");
  const before = (await app.model()).view;

  let mid: { open: boolean; mode: string | null } = { open: false, mode: null };
  await dragBox(60, 80, 320, 300, async () => { mid = await boxState(); });

  assert.equal(mid.open, true, "the box was up mid-gesture");
  assert.equal(mid.mode, "window", "dragged left→right, so a window");
  const after = (await app.model()).view;
  assert.deepEqual({ ox: after.ox, oy: after.oy }, { ox: before.ox, oy: before.oy },
    "the view must not have moved — this gesture used to pan and now does not");
});

test("a window box inserts exactly what it fully contained", async () => {
  await app.page.fill("#cmd", "");
  // A box around the rectangle only. Left→right.
  const [x1, y1] = await screenOf("p1"); // world (-60,-20), the far corner
  const [x3, y3] = await screenOf("p3"); // world (-20, 20), the near one
  await dragBox(Math.min(x1, x3) - 25, Math.min(y1, y3) - 25, Math.max(x1, x3) + 25, Math.max(y1, y3) + 25);

  const names = (await cmd()).split(", ").map((s) => s.replace(/"/g, ""));
  assert.deepEqual(names, ["p1", "p2", "p3", "p4", "l1", "l2", "l3", "l4"],
    "the four corners and four edges of the rectangle, quoted and comma-separated");
  assert.equal(names.includes("p5"), false, "the far point is nowhere near the box");
  assert.equal(names.includes("l5"), false,
    "and the edge reaching out to it is only clipped, so a window box leaves it");
});

test("a crossing box the other way picks up the edge the window box excluded", async () => {
  await app.page.fill("#cmd", "");
  const [x1, y1] = await screenOf("p1");
  const [x3, y3] = await screenOf("p3");
  // The same rectangle, dragged right→left this time.
  let mid: { open: boolean; mode: string | null } = { open: false, mode: null };
  await dragBox(
    Math.max(x1, x3) + 25, Math.max(y1, y3) + 25,
    Math.min(x1, x3) - 25, Math.min(y1, y3) - 25,
    async () => { mid = await boxState(); },
  );

  assert.equal(mid.mode, "crossing", "right→left is a crossing box");
  const names = (await cmd()).split(", ").map((s) => s.replace(/"/g, ""));
  assert.ok(names.includes("l5"), `the clipped edge came along: ${names.join(" ")}`);
  assert.equal(names.includes("p5"), false, "but its far endpoint is still outside the box");
  assert.deepEqual(names, ["p1", "p2", "p3", "p4", "l1", "l2", "l3", "l4", "l5"]);
});

test("the two boxes are drawn differently, and the drawing says which is which", async () => {
  // Asserting the mode rather than the pixels: what matters is that the two
  // gestures are distinguishable, and the render reads the same field.
  await app.page.fill("#cmd", "");
  const seen: (string | null)[] = [];
  await dragBox(80, 90, 300, 280, async () => { seen.push((await boxState()).mode); });
  await dragBox(300, 280, 80, 90, async () => { seen.push((await boxState()).mode); });
  assert.deepEqual(seen, ["window", "crossing"]);
});

test("an empty box inserts nothing at all", async () => {
  await app.page.fill("#cmd", "");
  // Far to the right of everything, and clear of p5.
  await dragBox(600, 60, 780, 180);
  assert.equal(await cmd(), "");
});

test("a box appends to what is already typed, exactly as clicks do", async () => {
  await app.page.fill("#cmd", "del(");
  const [x1, y1] = await screenOf("p5");
  await dragBox(x1 - 30, y1 - 30, x1 + 30, y1 + 30);
  assert.equal(await cmd(), 'del("p5"');
});

test("Escape cancels the box, and the release does not belatedly select", async () => {
  await app.page.fill("#cmd", "");
  const [x1, y1] = await screenOf("p1");
  const [x3, y3] = await screenOf("p3");
  const from = await app.at(Math.min(x1, x3) - 25, Math.min(y1, y3) - 25);
  const to = await app.at(Math.max(x1, x3) + 25, Math.max(y1, y3) + 25);

  await app.page.mouse.move(from.x, from.y);
  await app.page.mouse.down();
  await app.page.mouse.move(to.x, to.y, { steps: 6 });
  await app.page.waitForTimeout(80);
  assert.equal((await boxState()).open, true, "the box is up");

  await app.page.keyboard.press("Escape");
  await app.page.waitForTimeout(80);
  assert.equal((await boxState()).open, false, "Escape dropped it");

  await app.page.mouse.up();
  await app.page.waitForTimeout(150);
  assert.equal(await cmd(), "", "and the release inserted nothing");
});

test("a press on a point still drags it rather than boxing", async () => {
  await app.page.fill("#cmd", "");
  const before = (await app.model()).points.p3;
  const [sx, sy] = await screenOf("p3");
  const from = await app.at(sx, sy);
  const to = await app.at(sx + 40, sy - 30);

  await app.page.mouse.move(from.x, from.y);
  await app.page.mouse.down();
  await app.page.mouse.move(to.x, to.y, { steps: 6 });
  await app.page.waitForTimeout(80);
  assert.equal((await boxState()).open, false, "no box — the press grabbed a point");
  await app.page.mouse.up();
  await app.page.waitForTimeout(200);

  const after = (await app.model()).points.p3;
  assert.ok(Math.hypot(after[0] - before[0], after[1] - before[1]) > 5,
    `p3 stayed at ${after} — the drag was eaten by something`);
  assert.equal(await cmd(), "", "a drag is not a selection");
  assert.equal(await app.status(), "SOLVED");
});

test("a press on an edge drags it, and draws no box", async () => {
  await app.page.fill("#cmd", "");
  const before = await app.model();
  const [ax, ay] = await screenOf("p1");
  const [bx, by] = await screenOf("p2");
  const from = await app.at((ax + bx) / 2, (ay + by) / 2);

  await app.page.mouse.move(from.x, from.y);
  await app.page.mouse.down();
  await app.page.mouse.move(from.x + 40, from.y - 20, { steps: 5 });
  await app.page.waitForTimeout(80);
  assert.equal((await boxState()).open, false, "a box that starts on an edge is not a box");
  await app.page.mouse.up();
  await app.page.waitForTimeout(200);

  // The half of the rule this file guards is the first clause: a press on
  // geometry is not a box. What that press *is* changed with the edge-drag
  // package — it used to pan and now drags the edge — so the second clause
  // moved with it. p1 is fixed, so it is p2 that goes.
  const after = await app.model();
  assert.deepEqual({ ox: after.view.ox, oy: after.view.oy }, { ox: before.view.ox, oy: before.view.oy },
    "the view stayed put — an edge drag is not a pan any more");
  const travelled = Math.hypot(after.points.p2[0] - before.points.p2[0], after.points.p2[1] - before.points.p2[1]);
  assert.ok(travelled > 5, `p2 only moved ${travelled.toFixed(2)} world units`);
  assert.equal(await cmd(), "", "a drag is not a selection");
});

test("middle-drag still pans and right-drag orbits — neither draws a box", async () => {
  for (const button of ["middle", "right"] as const) {
    const before = (await app.model()).view;
    const from = await app.at(400, 200);
    await app.page.mouse.move(from.x, from.y);
    await app.page.mouse.down({ button });
    await app.page.mouse.move(from.x + 30, from.y + 20, { steps: 4 });
    await app.page.mouse.up({ button });
    await app.page.waitForTimeout(120);
    const after = (await app.model()).view;
    if (button === "middle") {
      assert.ok(Math.abs(after.ox - before.ox - 30) < 1e-6, `middle-drag panned by ${after.ox - before.ox}`);
    } else {
      // The 3D app's right button turns the view (Onshape's gesture); the
      // box-select story is only that it does not *select* anything.
      assert.ok(after.right && Math.abs(after.right[0] - 1) > 1e-3, `right-drag orbited: ${JSON.stringify(after)}`);
    }
    assert.equal((await boxState()).open, false, `${button}-drag drew no box`);
  }
});

test("a box does not select constraint glyphs", async () => {
  await app.page.fill("#cmd", "");
  await app.type('par("l1", xaxis()); par("l2", yaxis())');
  const rels = await app.repl("rels().length");
  assert.ok((rels.value as number) > 0, "there are relations to accidentally catch");

  await app.page.fill("#cmd", "");
  // A crossing box over the whole rectangle, glyphs and all.
  const [x1, y1] = await screenOf("p1");
  const [x3, y3] = await screenOf("p3");
  await dragBox(Math.max(x1, x3) + 40, Math.max(y1, y3) + 40, Math.min(x1, x3) - 40, Math.min(y1, y3) - 40);

  const names = (await cmd()).split(", ").map((s) => s.replace(/"/g, ""));
  assert.equal(names.some((n) => /^r\d+$/.test(n)), false,
    `a relation name got in: ${names.join(" ")}`);
});

test("a box selects what a click would, so the names are usable straight away", async () => {
  await app.page.fill("#cmd", "");
  const [x5, y5] = await screenOf("p5");
  await dragBox(x5 - 40, y5 - 40, x5 + 40, y5 + 40);
  const picked = await cmd();
  await app.page.fill("#cmd", `coords(${picked})`);
  await app.page.press("#cmd", "Enter");
  await app.page.waitForTimeout(200);
  assert.match(await app.log(), /coords\("p5"\)/);
});

test("no uncaught page errors", () => {
  assert.deepEqual(app.pageErrors, []);
});
