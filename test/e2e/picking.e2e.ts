// Picking and hover, driven by a real cursor.
//
// The design being tested is cellwork's, and it is not the obvious one: there
// is no selection set. Clicking geometry drops its name into the command line
// and that is all. So these check the command input, not some selection state.

import { test, before, after } from "node:test";
import assert from "node:assert/strict";
import { openApp, type AppContext } from "./harness.ts";

let app: AppContext;
after(async () => { await app.close(); });

const cmd = () => app.page.$eval("#cmd", (el) => (el as HTMLInputElement).value);
const hoverTag = async () => {
  const hidden = await app.page.$eval("#hovertag", (el) => (el as HTMLElement).hidden);
  return hidden ? null : app.page.$eval("#hovertag", (el) => el.textContent);
};
/** Where a named point is, in page coordinates. */
async function screenOf(name: string) {
  const [sx, sy] = await app.page.evaluate((n) => {
    const { model, engine } = (window as never as {
      __neocad: { model: { coords(x: string): number[] }; engine: { worldToScreen(w: number[]): [number, number] } };
    }).__neocad;
    return engine.worldToScreen(model.coords(n));
  }, name);
  return await app.at(sx, sy);
}

before(async () => {
  app = await openApp();
  // A shape with points, edges and a circle to aim at.
  await app.type('a = pt(-40,-20); b = pt(40,-20); c = pt(40,30); d = pt(-40,30)');
  await app.type('e1 = ln(a,b); e2 = ln(b,c); e3 = ln(c,d); e4 = ln(d,a)');
  await app.type('k = circ(pt(90,0), 25)');
  await app.type("solve()");
});

test("hovering a point highlights it and names it", async () => {
  const p = await screenOf("p1");
  await app.page.mouse.move(p.x, p.y);
  await app.page.waitForTimeout(120);

  const tag = await hoverTag();
  assert.ok(tag?.startsWith("p1"), `expected the tag to name p1, got ${tag}`);
  assert.match(tag!, /-40/, "and to show its coordinates");
  assert.equal(await app.page.evaluate(() => (window as never as { __neocad: { engine: { hover: { name: string } | null } } }).__neocad.engine.hover?.name), "p1");
});

test("moving off geometry drops the hover", async () => {
  const p = await screenOf("p1");
  await app.page.mouse.move(p.x + 120, p.y + 90);
  await app.page.waitForTimeout(120);
  assert.equal(await hoverTag(), null);
});

test("hovering an edge names it and gives its length", async () => {
  const a = await screenOf("p1");
  const b = await screenOf("p2");
  await app.page.mouse.move((a.x + b.x) / 2, (a.y + b.y) / 2);
  await app.page.waitForTimeout(120);
  const tag = await hoverTag();
  assert.ok(tag?.startsWith("l1"), `expected the edge, got ${tag}`);
  assert.match(tag!, /len 80/);
});

test("clicking geometry drops its name into the command line", async () => {
  await app.page.fill("#cmd", "");
  const p = await screenOf("p1");
  await app.page.mouse.click(p.x, p.y);
  await app.page.waitForTimeout(120);
  assert.equal(await cmd(), '"p1"');

  // A second pick appends, so picking two things writes most of a call.
  const q = await screenOf("p3");
  await app.page.mouse.click(q.x, q.y);
  await app.page.waitForTimeout(120);
  assert.equal(await cmd(), '"p1", "p3"');
});

test("a picked name is usable straight away", async () => {
  await app.page.fill("#cmd", "dist(");
  const a = await screenOf("p1");
  const b = await screenOf("p3");
  await app.page.mouse.click(a.x, a.y);
  await app.page.mouse.click(b.x, b.y);
  await app.page.waitForTimeout(120);
  assert.equal(await cmd(), 'dist("p1", "p3"');

  // Finish it by hand and it runs — the names came out in a usable form.
  await app.page.fill("#cmd", 'dist("p1", "p3", 120); solve()');
  await app.page.press("#cmd", "Enter");
  await app.page.waitForTimeout(300);
  const m = await app.model();
  const [p1, p3] = [m.points.p1, m.points.p3];
  assert.ok(Math.abs(Math.hypot(p3[0] - p1[0], p3[1] - p1[1]) - 120) < 1e-6, "the constraint applied");
});

test("clicking empty space picks nothing", async () => {
  await app.page.fill("#cmd", "");
  const p = await screenOf("p1");
  await app.page.mouse.click(p.x + 200, p.y + 150);
  await app.page.waitForTimeout(120);
  assert.equal(await cmd(), "");
});

test("a left-drag on empty space pans instead of picking", async () => {
  await app.page.fill("#cmd", "");
  const before = (await app.model()).view;
  const from = await app.at(500, 400);
  await app.page.mouse.move(from.x, from.y);
  await app.page.mouse.down();
  await app.page.mouse.move(from.x + 60, from.y - 30, { steps: 5 });
  await app.page.mouse.up();
  await app.page.waitForTimeout(120);

  const after = (await app.model()).view;
  assert.ok(Math.abs(after.ox - before.ox - 60) < 1e-6, `panned by ${after.ox - before.ox}`);
  assert.equal(await cmd(), "", "a drag is not a pick");
});

test("with a tool armed, the left button belongs to the tool, not to picking", async () => {
  await app.page.fill("#cmd", "");
  const before = await app.model();
  await app.type("rectangle");
  const p = await screenOf("p1");

  // Press exactly on a point. With no tool armed this would pick it.
  await app.page.mouse.move(p.x, p.y);
  await app.page.mouse.down();
  await app.page.mouse.move(p.x + 100, p.y + 80, { steps: 5 });
  await app.page.mouse.up();
  await app.page.waitForTimeout(250);

  assert.equal(await cmd(), "", "nothing was picked into the command line");
  assert.equal((await app.model()).size, before.size + 8, "the tool got the gesture");
});

test("hover() reports what the cursor is over", async () => {
  const p = await screenOf("p2");
  await app.page.mouse.move(p.x, p.y);
  await app.page.waitForTimeout(120);
  const r = await app.repl("hover()");
  assert.equal(r.value, "p2");
});

test("the canvas keeps square pixels as the log pane grows", async () => {
  // The log takes height from the viewport as it fills. If the canvas bitmap
  // does not follow, the drawing is stretched and circles come out elliptical.
  for (let i = 0; i < 8; i++) await app.type(`${i} + ${i}`);
  await app.page.waitForTimeout(200);
  const ratio = await app.page.$eval("#cv", (el) => {
    const c = el as HTMLCanvasElement;
    const r = c.getBoundingClientRect();
    return { x: c.width / r.width, y: c.height / r.height };
  });
  assert.ok(Math.abs(ratio.x - ratio.y) < 0.02,
    `the bitmap is ${ratio.x.toFixed(3)} px/css across and ${ratio.y.toFixed(3)} down — the drawing is stretched`);
});

test("no uncaught page errors", () => {
  assert.deepEqual(app.pageErrors, []);
});
