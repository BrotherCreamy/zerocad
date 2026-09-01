import { test } from "node:test";
import assert from "node:assert/strict";
import {
  MAX_SCALE, MIN_SCALE, assignView, clampScale, panBy,
  screenToWorld, worldToScreen, zoomAbout, type View,
} from "../src/view.ts";

const v = (): View => ({ ox: 400, oy: 300, scale: 3 });
const close = (a: number, b: number, tol = 1e-9) => Math.abs(a - b) < tol;

test("world and screen coordinates are inverses of each other", () => {
  const view = v();
  for (const w of [[0, 0], [10, -25], [-3.5, 7.25], [1000, 1000]]) {
    const [sx, sy] = worldToScreen(view, w);
    const back = screenToWorld(view, sx, sy);
    assert.ok(close(back[0], w[0]) && close(back[1], w[1]), `${w} -> ${[sx, sy]} -> ${back}`);
  }
});

test("screen y runs opposite to world y", () => {
  const view = v();
  const up = worldToScreen(view, [0, 10]);
  const down = worldToScreen(view, [0, -10]);
  assert.ok(up[1] < down[1], "a point higher in the world draws higher on screen");
});

test("zooming about a point leaves whatever is under it exactly where it was", () => {
  let view = v();
  const anchor: [number, number] = [712, 145];
  const under = screenToWorld(view, ...anchor);
  for (const f of [1.12, 1.12, 0.5, 3, 0.893]) {
    view = zoomAbout(view, anchor[0], anchor[1], f);
    const still = worldToScreen(view, under);
    assert.ok(close(still[0], anchor[0], 1e-8) && close(still[1], anchor[1], 1e-8),
      `after x${f} the anchor drifted to ${still}`);
  }
});

test("repeated zoom in and out returns to where it started", () => {
  let view = v();
  const start = { ...view };
  for (let i = 0; i < 20; i++) view = zoomAbout(view, 512, 384, 1.12);
  for (let i = 0; i < 20; i++) view = zoomAbout(view, 512, 384, 1 / 1.12);
  assert.ok(close(view.scale, start.scale, 1e-9), `scale drifted to ${view.scale}`);
  assert.ok(close(view.ox, start.ox, 1e-6) && close(view.oy, start.oy, 1e-6),
    `origin drifted to ${view.ox},${view.oy}`);
});

test("the scale is clamped, so a runaway wheel cannot wreck the view", () => {
  let view = v();
  for (let i = 0; i < 500; i++) view = zoomAbout(view, 0, 0, 2);
  assert.equal(view.scale, MAX_SCALE);
  assert.ok(Number.isFinite(view.ox) && Number.isFinite(view.oy));

  for (let i = 0; i < 500; i++) view = zoomAbout(view, 0, 0, 0.5);
  assert.equal(view.scale, MIN_SCALE);
  assert.ok(Number.isFinite(view.ox) && Number.isFinite(view.oy));
});

test("clampScale rejects nonsense outright", () => {
  assert.equal(clampScale(0), MIN_SCALE);
  assert.equal(clampScale(-5), MIN_SCALE);
  assert.equal(clampScale(NaN), MIN_SCALE);
  assert.equal(clampScale(Infinity), MAX_SCALE);
  assert.equal(clampScale(7), 7);
});

test("panning moves the drawing with the cursor, one pixel per pixel", () => {
  const view = v();
  const before = worldToScreen(view, [12, 34]);
  const moved = panBy(view, 25, -40);
  const after = worldToScreen(moved, [12, 34]);
  assert.ok(close(after[0] - before[0], 25) && close(after[1] - before[1], -40),
    `moved by ${[after[0] - before[0], after[1] - before[1]]}`);
  assert.equal(moved.scale, view.scale, "panning does not change the zoom");
});

test("assignView updates in place, so anything holding the object sees it", () => {
  const view = v();
  const held = view; // the REPL and the engine both hold this same object
  assignView(view, zoomAbout(view, 100, 100, 2));
  assert.equal(held.scale, 6);
  assert.ok(held === view);
});
