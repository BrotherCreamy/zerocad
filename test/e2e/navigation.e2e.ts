// Panning and zooming with a real wheel and real buttons. The mid-gesture pan
// is the interesting one: it only works because panning watches the `buttons`
// mask rather than `button`, since a second button pressed while one is held
// arrives as a pointermove and never as a pointerdown.

import { test, before, after } from "node:test";
import assert from "node:assert/strict";
import { openApp, type AppContext } from "./harness.ts";

let app: AppContext;
before(async () => { app = await openApp(); });
after(async () => { await app.close(); });

const worldAt = (app: AppContext, sx: number, sy: number) =>
  app.page.evaluate(([x, y]) => (window as never as {
    __neocad: { engine: { screenToWorld(a: number, b: number): number[] } };
  }).__neocad.engine.screenToWorld(x, y), [sx, sy] as [number, number]);

test("the wheel zooms about the cursor, and the page does not scroll", async () => {
  await app.type("a = pt(0,0); b = pt(40,30); fix(a,[0,0]); fix(b,[40,30]); ln(a,b); solve()");
  const start = (await app.model()).view;
  const anchor = await app.at(700, 250);
  const under = await worldAt(app, 700, 250);

  await app.page.mouse.move(anchor.x, anchor.y);
  await app.page.mouse.wheel(0, -300);
  await app.page.waitForTimeout(150);

  const zoomed = (await app.model()).view;
  assert.ok(zoomed.scale > start.scale, `${start.scale} -> ${zoomed.scale}`);

  const stillUnder = await worldAt(app, 700, 250);
  assert.ok(Math.abs(stillUnder[0] - under[0]) < 1e-6 && Math.abs(stillUnder[1] - under[1]) < 1e-6,
    `the point under the cursor drifted: ${under} -> ${stillUnder}`);
  assert.equal(await app.page.evaluate(() => window.scrollY), 0, "the page must not scroll");

  await app.page.mouse.wheel(0, 300);
  await app.page.waitForTimeout(150);
  assert.ok(Math.abs((await app.model()).view.scale - start.scale) < 1e-9, "and back out again");
});

test("right-drag and middle-drag both pan, one pixel per pixel", async () => {
  for (const button of ["right", "middle"] as const) {
    const before = (await app.model()).view;
    const from = await app.at(600, 330);
    await app.page.mouse.move(from.x, from.y);
    await app.page.mouse.down({ button });
    await app.page.mouse.move(from.x + 80, from.y - 60, { steps: 6 });
    await app.page.mouse.up({ button });
    await app.page.waitForTimeout(120);

    const after = (await app.model()).view;
    assert.ok(Math.abs(after.ox - before.ox - 80) < 1e-6 && Math.abs(after.oy - before.oy + 60) < 1e-6,
      `${button}-drag moved the origin by ${after.ox - before.ox}, ${after.oy - before.oy}`);
    assert.equal(after.scale, before.scale, "panning does not change the zoom");
  }
});

test("navigation leaves the model alone", async () => {
  const before = await app.model();
  const from = await app.at(400, 300);
  await app.page.mouse.move(from.x, from.y);
  await app.page.mouse.down({ button: "right" });
  await app.page.mouse.move(from.x + 40, from.y + 40, { steps: 4 });
  await app.page.mouse.up({ button: "right" });
  await app.page.mouse.wheel(0, -120);
  await app.page.waitForTimeout(120);
  const after = await app.model();
  assert.equal(after.size, before.size);
  assert.deepEqual(after.points, before.points);
});

test("a tool's gesture survives being panned through", async () => {
  const before = await app.model();
  await app.type("rectangle");
  const start = await app.at(250, 200);
  await app.page.mouse.move(start.x, start.y);
  await app.page.mouse.down(); // left: the tool's gesture begins
  await app.page.mouse.move(start.x + 50, start.y + 40, { steps: 3 });
  assert.equal((await app.model()).size, before.size, "mid-gesture, nothing committed");

  // Pan *during* the drag. A second button while one is held arrives as a
  // pointermove, not a pointerdown — which is why this used to do nothing.
  const during = (await app.model()).view;
  await app.page.mouse.down({ button: "right" });
  await app.page.mouse.move(start.x + 90, start.y + 20, { steps: 4 });
  await app.page.mouse.up({ button: "right" });
  await app.page.waitForTimeout(100);

  assert.ok(Math.abs((await app.model()).view.ox - during.ox - 40) < 1e-6, "the pan took effect");
  assert.equal((await app.model()).activeTool, "rectangle", "the tool is still armed");
  assert.equal((await app.model()).size, before.size, "and the pan committed nothing");

  await app.page.mouse.move(start.x + 230, start.y + 140, { steps: 5 });
  await app.page.mouse.up();
  await app.page.waitForTimeout(200);
  assert.equal((await app.model()).size, before.size + 8, "the interrupted gesture still completed");
  assert.equal(await app.status(), "SOLVED");
});

test("zoom from the command line is clamped rather than exploding", async () => {
  await app.type("zoom(1e9)");
  assert.equal((await app.model()).view.scale, 1e5);
  await app.type("zoom(1e-12)");
  assert.equal((await app.model()).view.scale, 1e-3);
});

test("no uncaught page errors", () => {
  assert.deepEqual(app.pageErrors, []);
});
