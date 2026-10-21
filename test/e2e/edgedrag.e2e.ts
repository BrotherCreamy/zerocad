// Dragging an edge, a rim or an arc with a real mouse.
//
// The unit suite checks the arithmetic — one soft pull per governing point,
// all toward the same offset — on a fixture with nothing in its way. What only
// a browser can answer is whether the gesture *is* the one the hand expects
// once every other meaning of the left button is in the room with it: that a
// press on an edge no longer pans, that the constraints still win, and that a
// circle dragged by its rim moves rather than growing.
//
// The three stories here are the ones from `docs/plans/edge-drag.md`: a
// constrained rectangle dragged by an edge, a free circle dragged by its rim,
// and a free edge translating exactly as far as the cursor went — which is the
// only one of the three that can pin the offset, because it is the only one no
// constraint has a say in.

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

/** The midpoint of a line, in canvas pixels — a spot that is edge and not endpoint. */
async function edgeMidpoint(a: string, b: string): Promise<[number, number]> {
  const [ax, ay] = await screenOf(a);
  const [bx, by] = await screenOf(b);
  return [(ax + bx) / 2, (ay + by) / 2];
}

/** Press at (sx, sy), pull by (dx, dy) screen pixels, release. */
async function dragFrom(sx: number, sy: number, dx: number, dy: number, mid?: () => Promise<void>) {
  const from = await app.at(sx, sy);
  const to = await app.at(sx + dx, sy + dy);
  await app.page.mouse.move(from.x, from.y);
  await app.page.mouse.down();
  await app.page.mouse.move(to.x, to.y, { steps: 8 });
  await app.page.waitForTimeout(80);
  if (mid) await mid();
  await app.page.mouse.up();
  await app.page.waitForTimeout(200);
}

before(async () => {
  app = await openApp();
  // `hor`/`ver` are relative to a frame now. Only its *direction* matters
  // here — nothing is fixed to it — so it is parked well above the drawing,
  // where its two points cannot be caught by a drag meant for an edge.
  await axisFrame(app, [0, 200]);
  // A constrained rectangle: four edges level or plumb, one of them measured.
  // Nothing is fixed, so the whole thing is free to travel — which is the
  // point, since an edge drag is a translation the constraints then argue with.
  await app.type("pt(-40,-30); pt(40,-30); pt(40,30); pt(-40,30)");
  await app.type('ln("p1","p2"); ln("p2","p3"); ln("p3","p4"); ln("p4","p1")');
  await app.type('par("l1", xaxis()); par("l2", yaxis()); par("l3", xaxis()); par("l4", yaxis()); dist("p1","p2",80)');
  await app.type("solve()");
});

test("dragging an edge carries the constrained rectangle with it", async () => {
  await app.page.fill("#cmd", "");
  const before = await app.model();
  assert.equal(await app.status(), "SOLVED", "the fixture starts satisfied");

  // The middle of the bottom edge, which is an edge and not a corner.
  const [mx, my] = await edgeMidpoint("p1", "p2");
  let midway: number[] = [];
  await dragFrom(mx, my, 45, -30, async () => { midway = (await app.model()).points.p1; });

  // It moved *during* the gesture. A drag that only catches up on release is a
  // move, and the whole point of the soft pull is that it does not wait.
  assert.ok(Math.hypot(midway[0] - before.points.p1[0], midway[1] - before.points.p1[1]) > 3,
    `p1 was still at ${midway} mid-drag`);

  const m = await app.model();
  const [p1, p2, p3, p4] = [m.points.p1, m.points.p2, m.points.p3, m.points.p4];

  // Every constraint still exact. "Exactly": a drag that leaves them
  // approximately satisfied has broken the drawing however good it looks.
  assert.ok(Math.abs(p1[1] - p2[1]) < 1e-6, `l1 is off level by ${p1[1] - p2[1]}`);
  assert.ok(Math.abs(p3[1] - p4[1]) < 1e-6, `l3 is off level by ${p3[1] - p4[1]}`);
  assert.ok(Math.abs(p2[0] - p3[0]) < 1e-6, `l2 is off plumb by ${p2[0] - p3[0]}`);
  assert.ok(Math.abs(p4[0] - p1[0]) < 1e-6, `l4 is off plumb by ${p4[0] - p1[0]}`);
  assert.ok(Math.abs(Math.hypot(p2[0] - p1[0], p2[1] - p1[1]) - 80) < 1e-6,
    `the measured edge is ${Math.hypot(p2[0] - p1[0], p2[1] - p1[1])} long, not 80`);

  // 45px right and 30px up at scale 3 is 15 and 10 world units. The grabbed
  // edge went there; the rest of the rectangle came along, because the +y par ties
  // the uprights to it.
  const scale = m.view.scale;
  for (const name of ["p1", "p2"]) {
    const d = [m.points[name][0] - before.points[name][0], m.points[name][1] - before.points[name][1]];
    assert.ok(Math.abs(d[0] - 45 / scale) < 1 && Math.abs(d[1] - 30 / scale) < 1,
      `${name} moved by ${d}, not by the drag offset (${45 / scale}, ${30 / scale})`);
  }
  for (const name of ["p3", "p4"]) {
    const dx = m.points[name][0] - before.points[name][0];
    assert.ok(Math.abs(dx - 45 / scale) < 1, `${name} did not follow sideways: ${dx}`);
  }

  assert.deepEqual({ ox: m.view.ox, oy: m.view.oy }, { ox: before.view.ox, oy: before.view.oy },
    "the view did not move — this gesture used to pan and now drags the edge");
  assert.equal(await cmd(), "", "a drag is not a selection");
  assert.equal(await app.status(), "SOLVED", "release settles the model and says so");
});

test("dragging a circle by its rim moves it without changing its radius", async () => {
  await app.page.fill("#cmd", "");
  // Clear of the rectangle, and high enough that the drag stays clear of the
  // log panel at the bottom-left.
  await app.type("pt(0,60)");
  const centre = Object.keys((await app.model()).points).at(-1)!;
  await app.type(`circ("${centre}", 18)`);
  const circle = (await app.model()).circles.at(-1)!.name;

  const before = await app.model();
  const r0 = before.radii[circle];
  const scale = before.view.scale;
  const [cx, cy] = await screenOf(centre);
  // Straight out to the right of the centre: on the rim, and nowhere near the
  // centre point, which would otherwise win the pick outright.
  await dragFrom(cx + r0 * scale, cy, 30, 24);

  const m = await app.model();
  const d = [m.points[centre][0] - before.points[centre][0], m.points[centre][1] - before.points[centre][1]];
  assert.ok(Math.abs(d[0] - 30 / scale) < 1 && Math.abs(d[1] + 24 / scale) < 1,
    `the centre moved by ${d}, not by the drag offset (${30 / scale}, ${-24 / scale})`);
  assert.ok(Math.abs(m.radii[circle] - r0) < 1e-6,
    `the radius went from ${r0} to ${m.radii[circle]} — a rim drag moves a circle, it does not resize it`);
  assert.equal(await app.status(), "SOLVED");
});

test("a free edge translates by exactly the offset the cursor travelled", async () => {
  await app.page.fill("#cmd", "");
  // Two fresh points and an edge between them, constrained by nothing at all —
  // so the pulls are the only residuals it has, and the offset is checkable to
  // within the pixel the mouse actually landed on.
  await app.type("pt(-90,55); pt(-30,55)");
  const pts = Object.keys((await app.model()).points).slice(-2);
  await app.type(`ln("${pts[0]}", "${pts[1]}")`);

  const before = await app.model();
  const scale = before.view.scale;
  const [mx, my] = await edgeMidpoint(pts[0], pts[1]);
  await dragFrom(mx, my, 36, 24);

  const m = await app.model();
  for (const name of pts) {
    const d = [m.points[name][0] - before.points[name][0], m.points[name][1] - before.points[name][1]];
    assert.ok(Math.abs(d[0] - 36 / scale) < 0.5 && Math.abs(d[1] + 24 / scale) < 0.5,
      `${name} moved by ${d}, not by (${36 / scale}, ${-24 / scale})`);
  }
  // Both ends by the same amount is what makes it a translation rather than a
  // stretch: the length is unchanged even though nothing constrains it to be.
  const len = (mm: typeof m) => Math.hypot(
    mm.points[pts[1]][0] - mm.points[pts[0]][0], mm.points[pts[1]][1] - mm.points[pts[0]][1]);
  assert.ok(Math.abs(len(m) - len(before)) < 1e-6,
    `the edge changed length by ${len(m) - len(before)} — the two ends were pulled differently`);
});

test("a press on an edge that does not move is still a pick", async () => {
  await app.page.fill("#cmd", "");
  const before = await app.model();
  const [mx, my] = await edgeMidpoint("p1", "p2");
  const p = await app.at(mx, my);
  await app.page.mouse.move(p.x, p.y);
  await app.page.mouse.down();
  await app.page.mouse.move(p.x + 2, p.y + 1); // inside the 3px threshold
  await app.page.mouse.up();
  await app.page.waitForTimeout(150);

  assert.equal(await cmd(), '"l1"', "the edge's name still drops into the command line");
  const m = await app.model();
  for (const name of ["p1", "p2"]) {
    assert.ok(Math.hypot(m.points[name][0] - before.points[name][0],
      m.points[name][1] - before.points[name][1]) < 1e-9,
      `${name} moved on a click`);
  }
});

test("no uncaught page errors", () => {
  assert.deepEqual(app.pageErrors, []);
});
