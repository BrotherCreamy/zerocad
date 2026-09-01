// Kinematic drag: grab a point with nothing armed and pull, and the model
// follows the cursor while every constraint holds.
//
// This is the interaction the whole solver exists to make possible, and it is
// only true once it is assembled: the mathematics is checked in
// test/problem.test.ts and test/tools.test.ts, but whether a *mouse* moves a
// rectangle without breaking it is a question only a browser can answer. The
// two regressions here matter as much as the feature — a press that does not
// move must still be a pick, and a press that is not on a point must still
// pan, or dragging would have quietly eaten the two gestures it shares a
// button with.

import { test, before, after } from "node:test";
import assert from "node:assert/strict";
import { axisFrame, openApp, type AppContext } from "./harness.ts";

let app: AppContext;
after(async () => { await app.close(); });

const cmd = () => app.page.$eval("#cmd", (el) => (el as HTMLInputElement).value);

/** Canvas-relative screen coordinates of a named point. */
async function screenOf(name: string): Promise<[number, number]> {
  return app.page.evaluate((n) => {
    const { model, engine } = (window as never as {
      __neocad: { model: { coords(x: string): number[] }; engine: { worldToScreen(w: number[]): [number, number] } };
    }).__neocad;
    return engine.worldToScreen(model.coords(n));
  }, name);
}

/** Press on `name`, pull by (dx, dy) screen pixels, release. */
async function drag(name: string, dx: number, dy: number, mid?: () => Promise<void>) {
  const [sx, sy] = await screenOf(name);
  const from = await app.at(sx, sy);
  const to = await app.at(sx + dx, sy + dy);
  await app.page.mouse.move(from.x, from.y);
  await app.page.mouse.down();
  await app.page.mouse.move(to.x, to.y, { steps: 10 });
  await app.page.waitForTimeout(80);
  if (mid) await mid();
  await app.page.mouse.up();
  await app.page.waitForTimeout(200);
}

before(async () => {
  app = await openApp();
  // A rectangle whose edges are constrained, with one corner pinned. p1 is the
  // fixed corner and p3 the one opposite it. `hor`/`ver`/`fix` are relative to
  // a frame now, so the fixture makes one first.
  await axisFrame(app);
  await app.type("pt(-40,-30); pt(40,-30); pt(40,30); pt(-40,30)");
  await app.type('ln("p1","p2"); ln("p2","p3"); ln("p3","p4"); ln("p4","p1")');
  await app.type('hor("l1"); ver("l2"); hor("l3"); ver("l4")');
  await app.type('fix("p1", [-40,-30]); solve()');
});

test("dragging a corner resizes the rectangle and keeps it a rectangle", async () => {
  const before = await app.model();
  assert.equal(await app.status(), "SOLVED", "the fixture starts satisfied");

  let midway: number[] = [];
  await drag("p3", 50, -40, async () => {
    midway = (await app.model()).points.p3;
  });

  // The geometry moved *during* the gesture, not only on release — a drag that
  // only catches up at the end is a move, not a drag.
  assert.ok(Math.hypot(midway[0] - before.points.p3[0], midway[1] - before.points.p3[1]) > 5,
    `p3 was still at ${midway} mid-drag`);

  const m = await app.model();
  const [p1, p2, p3, p4] = [m.points.p1, m.points.p2, m.points.p3, m.points.p4];

  // Every edge still exactly horizontal or vertical. "Exactly": these are
  // constraints, and a drag that leaves them approximately satisfied has
  // broken the drawing however good it looks.
  assert.ok(Math.abs(p1[1] - p2[1]) < 1e-6, `l1 is off level by ${p1[1] - p2[1]}`);
  assert.ok(Math.abs(p3[1] - p4[1]) < 1e-6, `l3 is off level by ${p3[1] - p4[1]}`);
  assert.ok(Math.abs(p2[0] - p3[0]) < 1e-6, `l2 is off plumb by ${p2[0] - p3[0]}`);
  assert.ok(Math.abs(p4[0] - p1[0]) < 1e-6, `l4 is off plumb by ${p4[0] - p1[0]}`);

  // The pinned corner did not budge, and the dragged one went a long way.
  assert.ok(Math.abs(p1[0] + 40) < 1e-6 && Math.abs(p1[1] + 30) < 1e-6, `the fixed corner moved to ${p1}`);
  const travelled = Math.hypot(p3[0] - before.points.p3[0], p3[1] - before.points.p3[1]);
  assert.ok(travelled > 10, `p3 only moved ${travelled.toFixed(2)} world units`);
  // 50px right and 40px up at scale 3 is about 16.7 and 13.3 world units.
  assert.ok(p3[0] > before.points.p3[0] + 10 && p3[1] > before.points.p3[1] + 8,
    `p3 went to ${p3}, not toward where the cursor went`);

  assert.equal(await app.status(), "SOLVED", "release settles the model and says so");
});

test("a distance constraint survives being dragged around", async () => {
  // Clear of the rectangle above it, and high enough on the canvas that the
  // drag still lands inside it once the log pane has taken its share.
  await app.type("pt(0,60); pt(30,60)");
  const names = Object.keys((await app.model()).points).slice(-2);
  const [anchor, free] = names;
  await app.type(`fix("${anchor}", [0,60]); dist("${anchor}", "${free}", 30); solve()`);

  const start = (await app.model()).points[free];
  await drag(free, 30, 60);

  const m = await app.model();
  const a = m.points[anchor], b = m.points[free];
  const d = Math.hypot(b[0] - a[0], b[1] - a[1]);
  assert.ok(Math.abs(d - 30) < 1e-6, `the distance is ${d}, not 30 — the drag broke it`);
  assert.ok(Math.abs(a[0]) < 1e-6 && Math.abs(a[1] - 60) < 1e-6, `the anchor moved to ${a}`);
  // It swung round the anchor rather than staying put: same radius, new angle.
  const angle = (p: number[]) => Math.atan2(p[1] - a[1], p[0] - a[0]);
  assert.ok(Math.abs(angle(b) - angle(start)) > 0.2, `the angle barely changed: ${angle(start)} → ${angle(b)}`);
  assert.equal(await app.status(), "SOLVED");
});

test("a press that does not move is still a pick, not a drag", async () => {
  await app.page.fill("#cmd", "");
  const before = (await app.model()).points.p3;

  const [sx, sy] = await screenOf("p3");
  const p = await app.at(sx, sy);
  await app.page.mouse.move(p.x, p.y);
  await app.page.mouse.down();
  // Inside the 3px threshold: a hand is never perfectly still.
  await app.page.mouse.move(p.x + 2, p.y + 1);
  await app.page.mouse.up();
  await app.page.waitForTimeout(150);

  assert.equal(await cmd(), '"p3"', "the name still drops into the command line");
  const after = (await app.model()).points.p3;
  assert.ok(Math.abs(after[0] - before[0]) < 1e-9 && Math.abs(after[1] - before[1]) < 1e-9,
    `a click moved the point from ${before} to ${after}`);
});

test("dragging from an edge drags the drawing, and no longer pans", async () => {
  // This is the assertion the edge-drag package reversed: the same gesture used
  // to move the view and leave the model alone, and now does the opposite. The
  // fuller story — every constraint still exact, the offset it lands on — is in
  // edgedrag.e2e.ts; what this one is for is that the old meaning is gone from
  // the file that asserted it.
  await app.page.fill("#cmd", "");
  const before = await app.model();
  // The middle of l1, which is an edge and not a point. p1 is fixed and l1 is
  // level, so the edge strains sideways rather than translating freely.
  const [ax, ay] = await screenOf("p1");
  const [bx, by] = await screenOf("p2");
  const from = await app.at((ax + bx) / 2, (ay + by) / 2);
  await app.page.mouse.move(from.x, from.y);
  await app.page.mouse.down();
  await app.page.mouse.move(from.x + 40, from.y - 20, { steps: 5 });
  await app.page.mouse.up();
  await app.page.waitForTimeout(200);

  const after = await app.model();
  assert.deepEqual({ ox: after.view.ox, oy: after.view.oy }, { ox: before.view.ox, oy: before.view.oy },
    "the view stayed put");
  const travelled = Math.hypot(after.points.p2[0] - before.points.p2[0], after.points.p2[1] - before.points.p2[1]);
  assert.ok(travelled > 5, `p2 only moved ${travelled.toFixed(2)} world units`);
  assert.ok(Math.abs(after.points.p1[0] + 40) < 1e-6 && Math.abs(after.points.p1[1] + 30) < 1e-6,
    `the fixed corner moved to ${after.points.p1}`);
  assert.ok(Math.abs(after.points.p1[1] - after.points.p2[1]) < 1e-6, "and l1 is still exactly level");
  assert.equal(await cmd(), "", "a drag is not a selection");
  assert.equal(await app.status(), "SOLVED");
});

test("a dragged drawing saves and reopens where it was left", async () => {
  // A drag journals nothing — it changes values, not structure — so this is
  // the check that the coordinates riding alongside the journal are enough.
  const saved = await app.repl("save()");
  assert.equal(saved.ok, true, saved.error ?? "");
  const before = await app.model();

  await app.type("pt(200,200)"); // wreck it first, so a no-op open would fail
  await app.repl(`SAVED = ${JSON.stringify(saved.value)}`);
  const opened = await app.repl("open(SAVED)");
  assert.equal(opened.ok, true, opened.error ?? "");

  const after = await app.model();
  assert.deepEqual(after.byKind, before.byKind);
  for (const [name, coords] of Object.entries(before.points)) {
    const back = after.points[name];
    assert.ok(back, `${name} came back`);
    assert.ok(Math.abs(back[0] - coords[0]) < 1e-9 && Math.abs(back[1] - coords[1]) < 1e-9,
      `${name} reopened at ${back}, was dragged to ${coords}`);
  }
  assert.equal(await app.status(), "SOLVED");
});

test("no uncaught page errors", () => {
  assert.deepEqual(app.pageErrors, []);
});
