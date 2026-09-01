// Snapping, with a real cursor. The claim being tested is precision: a drag
// that starts "on" a corner starts exactly on it, not a pixel and a half away.

import { test, before, after } from "node:test";
import assert from "node:assert/strict";
import { openApp, type AppContext } from "./harness.ts";

let app: AppContext;
after(async () => { await app.close(); });

/** Where a named point is, in page coordinates. */
async function screenOf(name: string) {
  const [sx, sy] = await app.page.evaluate((n) => {
    const { model, engine } = (window as never as {
      __neocad: { model: { coords(x: string): number[] }; engine: { worldToScreen(w: number[]): [number, number] } };
    }).__neocad;
    return engine.worldToScreen(model.coords(n));
  }, name);
  return app.at(sx, sy);
}
const snapState = () => app.page.evaluate(() => {
  const s = (window as never as { __neocad: { engine: { snap: { kind: string; target: string } | null } } }).__neocad.engine.snap;
  return s ? { kind: s.kind, target: s.target } : null;
});

before(async () => {
  app = await openApp();
  await app.type('a = pt(-60,-30); b = pt(60,-30); c = pt(60,30); d = pt(-60,30)');
  await app.type('e1 = ln(a,b); e2 = ln(b,c); e3 = ln(c,d); e4 = ln(d,a)');
  await app.type("solve()");
});

test("a tool's click near a point lands exactly on it", async () => {
  const before = await app.model();
  const corner = before.points.p1; // (-60, -30)
  const target = await screenOf("p1");

  await app.type("point");
  // Aim deliberately off — 4px away, which is a miss by any exact measure.
  await app.page.mouse.click(target.x + 4, target.y - 3);
  await app.page.waitForTimeout(200);

  const after = await app.model();
  const fresh = Object.entries(after.points).find(([n]) => !(n in before.points))!;
  assert.ok(Math.abs(fresh[1][0] - corner[0]) < 1e-9 && Math.abs(fresh[1][1] - corner[1]) < 1e-9,
    `expected exactly ${corner}, got ${fresh[1]}`);
});

test("the snap marker reports what it caught", async () => {
  await app.type("point");
  const target = await screenOf("p2");
  await app.page.mouse.move(target.x + 3, target.y + 2);
  await app.page.waitForTimeout(150);
  assert.deepEqual(await snapState(), { kind: "point", target: "p2" });

  // The middle of an edge is a different kind of snap.
  const m = await app.model();
  const [sx, sy] = await app.page.evaluate((refs) => {
    const { model, engine } = (window as never as {
      __neocad: { model: { coords(n: string): number[] }; engine: { worldToScreen(w: number[]): [number, number] } };
    }).__neocad;
    const a = model.coords(refs[0]), b = model.coords(refs[1]);
    return engine.worldToScreen([(a[0] + b[0]) / 2, (a[1] + b[1]) / 2]);
  }, m.lines[0].refs);
  const mid = await app.at(sx, sy);
  await app.page.mouse.move(mid.x + 2, mid.y - 2);
  await app.page.waitForTimeout(150);
  assert.deepEqual(await snapState(), { kind: "midpoint", target: m.lines[0].name });
  await app.type("cancel()");
});

test("nothing snaps when no tool is armed", async () => {
  const target = await screenOf("p1");
  await app.page.mouse.move(target.x + 2, target.y + 2);
  await app.page.waitForTimeout(150);
  assert.equal(await snapState(), null, "snapping is for placing geometry, not for looking around");
});

test("a rectangle dragged corner-to-corner lands on both exactly", async () => {
  const before = await app.model();
  const from = await screenOf("p1");
  const to = await screenOf("p3");

  await app.type("rectangle");
  await app.page.mouse.move(from.x + 3, from.y + 3);
  await app.page.mouse.down();
  await app.page.mouse.move(to.x - 4, to.y + 2, { steps: 6 });
  await app.page.mouse.up();
  await app.page.waitForTimeout(250);

  const after = await app.model();
  const fresh = Object.entries(after.points).filter(([n]) => !(n in before.points)).map(([, c]) => c);
  assert.equal(fresh.length, 4);
  const xs = fresh.map((p) => p[0]).sort((a, b) => a - b);
  const ys = fresh.map((p) => p[1]).sort((a, b) => a - b);
  assert.ok(Math.abs(xs[0] - (-60)) < 1e-6 && Math.abs(xs[3] - 60) < 1e-6, `xs ${xs}`);
  assert.ok(Math.abs(ys[0] - (-30)) < 1e-6 && Math.abs(ys[3] - 30) < 1e-6, `ys ${ys}`);
});

test("snapping can be turned off from the command line", async () => {
  assert.equal((await app.repl("snapping()")).value, true);
  await app.type("snapping(false)");
  assert.equal((await app.repl("snapping()")).value, false);

  const before = await app.model();
  const target = await screenOf("p1");
  await app.type("point");
  await app.page.mouse.click(target.x + 5, target.y);
  await app.page.waitForTimeout(200);

  const after = await app.model();
  const fresh = Object.entries(after.points).find(([n]) => !(n in before.points))!;
  assert.ok(Math.abs(fresh[1][0] - before.points.p1[0]) > 1e-6,
    "with snapping off the point lands where the cursor actually was");
  await app.type("snapping(true)");
});

test("the hover tag gets out of the way once a tool is armed", async () => {
  const target = await screenOf("p1");

  // With nothing armed, hovering a point shows the tag.
  await app.page.mouse.move(target.x, target.y);
  await app.page.waitForTimeout(150);
  assert.equal(await app.page.$eval("#hovertag", (el) => (el as HTMLElement).hidden), false);

  // Arm a tool and the tag goes — otherwise it follows the cursor still
  // naming whatever was under it before the gesture began.
  await app.type("rectangle");
  await app.page.mouse.move(target.x + 60, target.y - 40);
  await app.page.waitForTimeout(150);
  assert.equal(await app.page.$eval("#hovertag", (el) => (el as HTMLElement).hidden), true);
  assert.equal((await app.model()).activeTool, "rectangle");
  await app.type("cancel()");
});

test("no uncaught page errors", () => {
  assert.deepEqual(app.pageErrors, []);
});
