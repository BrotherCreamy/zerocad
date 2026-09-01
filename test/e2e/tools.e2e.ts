// Tools driven by an actual mouse. The acceptance test the whole project was
// pointed at lives here: author a tool at the command line, then drag one out.

import { test, before, after } from "node:test";
import assert from "node:assert/strict";
import { openApp, type AppContext } from "./harness.ts";

let app: AppContext;
before(async () => { app = await openApp(); });
after(async () => { await app.close(); });

// One line, because the command input is one line — exactly what a user types.
const REPL_TOOL = 'defineTool("replbox", class extends Tool { name = "replbox"; '
  + 'onDown(p) { this.s = p.world; this.c = p.world; this.ctx.requestRender(); } '
  + 'onMove(p) { if (this.s) { this.c = p.world; this.ctx.requestRender(); } } '
  + 'onUp(p) { if (!this.s) return; const [x0,y0] = this.s, [x1,y1] = p.world; this.s = null; '
  + 'const q = pt(x0,y0), r = pt(x1,y0), s = pt(x1,y1), u = pt(x0,y1); '
  + 'const e1 = ln(q,r), e2 = ln(r,s), e3 = ln(s,u), e4 = ln(u,q); '
  + 'hor(e1); hor(e3); ver(e2); ver(e4); '
  + 'this.ctx.requestSolve(); this.ctx.finish(); } '
  + 'render(r) { if (!this.s || !this.c) return; const [x0,y0] = this.s, [x1,y1] = this.c; '
  + 'const c = [[x0,y0],[x1,y0],[x1,y1],[x0,y1]].map((w) => r.worldToScreen(w)); '
  + 'r.g.save(); r.g.strokeStyle = "#55c07a"; r.g.setLineDash([5,3]); r.g.beginPath(); '
  + 'r.g.moveTo(...c[0]); c.slice(1).forEach((p) => r.g.lineTo(...p)); r.g.closePath(); r.g.stroke(); r.g.restore(); } });';

test("a tool authored at the command line drives like a built-in", async () => {
  await app.type(REPL_TOOL);
  await app.type("tools()");
  assert.ok((await app.log()).includes("replbox"), "it joins the same registry the built-ins use");

  await app.type("replbox"); // a bare tool name arms it
  assert.ok((await app.log()).includes("armed: replbox"));

  const before = await app.model();
  const p0 = app.at(250, 180);
  const p1 = app.at(500, 330);

  await app.page.mouse.move(p0.x, p0.y);
  await app.page.mouse.down();
  await app.page.mouse.move(p0.x + 120, p0.y + 70, { steps: 6 });
  assert.equal((await app.model()).size, before.size, "mid-drag nothing is committed — it is a live preview");

  await app.page.mouse.move(p1.x, p1.y, { steps: 8 });
  await app.page.mouse.up();
  await app.page.waitForTimeout(250);

  const after = await app.model();
  assert.equal(after.byKind.point, (before.byKind.point ?? 0) + 4, "four corners");
  assert.equal(after.byKind.line, (before.byKind.line ?? 0) + 4, "four edges");
  assert.equal(await app.status(), "SOLVED");
  assert.equal(after.activeTool, null, "the gesture completed and the tool stood down");

  // The committed rectangle matches the drag, in world units.
  const fresh = Object.entries(after.points).filter(([n]) => !(n in before.points)).map(([, c]) => c);
  const xs = fresh.map((p) => p[0]).sort((a, b) => a - b);
  const ys = fresh.map((p) => p[1]).sort((a, b) => a - b);
  assert.ok(Math.abs(xs[3] - xs[0] - 250 / after.view.scale) < 1e-3, `width ${xs[3] - xs[0]}`);
  assert.ok(Math.abs(ys[3] - ys[0] - 150 / after.view.scale) < 1e-3, `height ${ys[3] - ys[0]}`);
  assert.ok(Math.abs(xs[0] - xs[1]) < 1e-9 && Math.abs(ys[0] - ys[1]) < 1e-9, "axis-aligned to solver tolerance");
});

test("the circle tool drags from centre to rim", async () => {
  await app.type("circle");
  const before = await app.model();
  const c = app.at(700, 550);

  await app.page.mouse.move(c.x, c.y);
  await app.page.mouse.down();
  await app.page.mouse.move(c.x + 60, c.y, { steps: 4 });
  assert.equal((await app.model()).size, before.size, "mid-drag commits nothing");

  await app.page.mouse.move(c.x + 120, c.y, { steps: 6 });
  await app.page.mouse.up();
  await app.page.waitForTimeout(200);

  const after = await app.model();
  assert.equal(after.byKind.circle, (before.byKind.circle ?? 0) + 1);
  const newest = Object.entries(after.radii).find(([n]) => !(n in before.radii))!;
  assert.ok(Math.abs(newest[1] - 120 / after.view.scale) < 1e-6, `radius ${newest[1]}`);
  assert.equal(after.activeTool, null);
});

test("the arc tool spans three clicks and snaps the last one to the rim", async () => {
  await app.type("arc");
  const before = await app.model();
  const c = app.at(250, 600);

  await app.page.mouse.click(c.x, c.y);
  await app.page.waitForTimeout(80);
  assert.equal((await app.model()).size, before.size, "nothing after the centre click");

  await app.page.mouse.move(c.x + 90, c.y, { steps: 3 });
  await app.page.mouse.click(c.x + 90, c.y);
  await app.page.waitForTimeout(80);
  assert.equal((await app.model()).size, before.size, "nothing after the radius click");
  assert.equal((await app.model()).activeTool, "arc", "still armed — the gesture spans three clicks");

  await app.page.mouse.move(c.x, c.y - 90, { steps: 4 });
  await app.page.mouse.click(c.x, c.y - 90);
  await app.page.waitForTimeout(200);

  const after = await app.model();
  assert.equal(after.byKind.arc, (before.byKind.arc ?? 0) + 1);
  const arc = after.arcs[after.arcs.length - 1];
  const r = after.radii[arc.name];
  assert.ok(Math.abs(r - 90 / after.view.scale) < 1e-6, `radius ${r}`);
  const ctr = after.points[arc.center], end = after.points[arc.end];
  assert.ok(Math.abs(Math.hypot(end[0] - ctr[0], end[1] - ctr[1]) - r) < 1e-6,
    "the end click was pulled onto the rim");
  assert.equal(after.activeTool, null);
});

test("no uncaught page errors", () => {
  assert.deepEqual(app.pageErrors, []);
});
