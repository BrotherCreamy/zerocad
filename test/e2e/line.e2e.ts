// The line tool, with real clicks: chaining, the shared vertex, the
// horizontal/vertical guide, and Escape ending a chain without losing what was
// already drawn.

import { test, before, after } from "node:test";
import assert from "node:assert/strict";
import { FIXTURE_ENTITIES, axisFrame, openApp, type AppContext } from "./harness.ts";

let app: AppContext;
before(async () => {
  app = await openApp();
  // The tool's axis inference only fires against a *default* frame — inferring
  // against the kernel's own axes would be the world frame coming back in
  // through the side door — so there has to be one before anything is drawn.
  // Hence FIXTURE_ENTITIES in the counts below.
  await axisFrame(app);
});
after(async () => { await app.close(); });

async function clickAt(sx: number, sy: number) {
  const p = await app.at(sx, sy);
  await app.page.mouse.move(p.x, p.y);
  await app.page.waitForTimeout(40);
  await app.page.mouse.click(p.x, p.y);
  await app.page.waitForTimeout(160);
}

test("click, click, chain — and the middle vertex is one point, not two", async () => {
  await app.type("line");
  assert.equal((await app.model()).activeTool, "line");

  await clickAt(200, 120);
  assert.equal((await app.model()).size, FIXTURE_ENTITIES, "the first click commits nothing to abandon");

  await clickAt(200, 300); // straight down
  const one = await app.model();
  assert.equal(one.byKind.line, 1);
  assert.equal(one.byKind.point, 2 + 2, "two, plus the frame's own");
  assert.equal(one.activeTool, "line", "the chain continues without re-arming");

  await clickAt(420, 300); // then straight across: an L
  const two = await app.model();
  assert.equal(two.byKind.line, 2);
  assert.equal(two.byKind.point, 3 + 2, "three points for two segments — the vertex is shared");
  assert.equal(two.lines[0].refs[1], two.lines[1].refs[0], "literally the same entity");
  assert.equal(await app.status(), "SOLVED");
});

test("the segments were drawn upright and level, and say so as line-form constraints", async () => {
  const entries = (await app.repl("journal()")).value as string[];
  const m = await app.model();
  const axis = entries.filter((e) => e.startsWith("vertical(") || e.startsWith("horizontal("));
  assert.deepEqual(axis, [`vertical("${m.lines[0].name}", "f")`, `horizontal("${m.lines[1].name}", "f")`],
    "the line form, which survives a fillet re-pointing the edge — and the frame it is level with");

  // And they are live: move the shared vertex and the far ends follow it.
  const vertex = m.lines[0].refs[1];
  await app.type(`fix("${vertex}", [-20, -10]); solve()`);
  const after = await app.model();
  assert.equal(await app.status(), "SOLVED");
  const at = after.points[vertex];
  assert.ok(Math.hypot(at[0] + 20, at[1] + 10) < 1e-6, `the vertex moved to ${at}`);
  assert.ok(Math.abs(after.points[after.lines[0].refs[0]][0] - at[0]) < 1e-6,
    "the upright segment is still upright");
  assert.ok(Math.abs(after.points[after.lines[1].refs[1]][1] - at[1]) < 1e-6,
    "the level one still level");
});

test("Escape ends the chain and keeps what was committed", async () => {
  const before = await app.model();
  await app.type("line");
  await clickAt(560, 120);
  await app.page.press("#cmd", "Escape");
  await app.page.waitForTimeout(150);

  const after = await app.model();
  assert.equal(after.activeTool, null, "the chain is over");
  assert.equal(after.size, before.size, "and the abandoned first click left nothing behind");
  assert.equal(after.byKind.line, before.byKind.line, "while the committed segments stayed");
});

test("an endpoint snapped to an existing point is joined to it", async () => {
  const before = await app.model();
  const target = before.lines[1].refs[1]; // the far end of the level segment
  const [tx, ty] = await app.page.evaluate((n) => {
    const { model, engine } = (window as never as {
      __neocad: { model: { coords(x: string): number[] }; engine: { worldToScreen(w: number[]): [number, number] } };
    }).__neocad;
    return engine.worldToScreen(model.coords(n));
  }, target);

  await app.type("line");
  await clickAt(600, 380);
  await clickAt(Math.round(tx) + 3, Math.round(ty) + 3); // a near miss at the existing point

  const after = await app.model();
  assert.equal(after.byKind.line, (before.byKind.line ?? 0) + 1);
  const joined = after.journalOps.filter((o) => o === "coincident").length;
  assert.equal(joined, 1, "the end landed on an existing point, so it was constrained to it");
  assert.equal(await app.status(), "SOLVED");
  await app.type("cancel()");
});

test("no uncaught page errors", () => {
  assert.deepEqual(app.pageErrors, []);
});
