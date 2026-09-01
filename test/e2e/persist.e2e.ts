// Save and open through the running app, where opening has to re-point the
// viewport, the tool engine and the command scope at a different model.

import { test, before, after } from "node:test";
import assert from "node:assert/strict";
import { openApp, type AppContext } from "./harness.ts";

let app: AppContext;
let saved: string;

before(async () => { app = await openApp(); });
after(async () => { await app.close(); });

test("a drawing made with the mouse and the command line saves", async () => {
  await app.type("rectangle");
  const p0 = app.at(250, 200);
  const p1 = app.at(550, 420);
  await app.page.mouse.move(p0.x, p0.y);
  await app.page.mouse.down();
  await app.page.mouse.move(p1.x, p1.y, { steps: 8 });
  await app.page.mouse.up();
  await app.page.waitForTimeout(200);

  const edges = (await app.model()).lines.map((l) => l.name);
  await app.type(`fillet("${edges[0]}", "${edges[1]}", 10); solve()`);

  const r = await app.repl("save()");
  assert.equal(r.ok, true, r.error);
  saved = r.value as string;
  assert.ok(saved.includes("neocad-model"));
});

test("opening restores the drawing exactly", async () => {
  const before = await app.model();

  await app.type("pt(0,0); pt(5,5); pt(10,10)"); // wreck it first
  assert.notEqual((await app.model()).size, before.size);

  await app.repl(`SAVED = ${JSON.stringify(saved)}`);
  const opened = await app.repl("open(SAVED)");
  assert.equal(opened.ok, true, opened.error);

  const after = await app.model();
  assert.deepEqual(after.byKind, before.byKind);
  for (const [name, coords] of Object.entries(before.points)) {
    assert.ok(after.points[name], `${name} came back`);
    assert.ok(Math.abs(after.points[name][0] - coords[0]) < 1e-9
      && Math.abs(after.points[name][1] - coords[1]) < 1e-9, `${name} at ${after.points[name]}, was ${coords}`);
  }
  for (const [name, r] of Object.entries(before.radii)) {
    assert.ok(Math.abs(after.radii[name] - r) < 1e-9, `${name} radius ${after.radii[name]}, was ${r}`);
  }
  assert.equal(await app.status(), "SOLVED");
});

test("the reopened model is live, not a picture", async () => {
  const name = Object.keys((await app.model()).points)[0];
  await app.repl(`model.setCoords("${name}", [999, 999])`);
  const report = await app.repl("solve()");
  assert.equal(report.ok, true, report.error);
  assert.equal((report.value as { solved: boolean }).solved, true);
  const moved = (await app.model()).points[name];
  assert.ok(Math.abs(moved[0] - 999) > 1, "the constraints pulled it back, so they were genuinely rebuilt");
});

test("tools still work on a reopened model", async () => {
  await app.repl("open(SAVED)");
  const before = await app.model();
  await app.type("circle");
  const c = app.at(800, 550);
  await app.page.mouse.move(c.x, c.y);
  await app.page.mouse.down();
  await app.page.mouse.move(c.x + 50, c.y, { steps: 4 });
  await app.page.mouse.up();
  await app.page.waitForTimeout(200);
  assert.equal((await app.model()).byKind.circle, (before.byKind.circle ?? 0) + 1);
});

test("a command-line binding survives opening a file", async () => {
  await app.repl("keepme = 4242");
  await app.repl("open(SAVED)");
  const r = await app.repl("keepme");
  assert.equal(r.value, 4242, "names are redefined, the REPL is not rebuilt");
});

test("open then save reproduces the same file", async () => {
  await app.repl("open(SAVED)");
  const again = await app.repl("save()");
  assert.equal(again.value, saved, "a round trip must be a fixed point, or repeated saves drift");
});

test("bad input is refused with a reason", async () => {
  const cases: [string, RegExp][] = [
    ['open("{ not json")', /not valid JSON/],
    ["open(JSON.stringify({hello: 1}))", /not a neocad model/],
    ['open(JSON.stringify({format: "neocad-model", version: 1, dim: 2, journal: [{op: "constructor", args: []}], values: {points:{}, radii:{}}}))',
      /not something a model file may do/],
  ];
  for (const [src, expected] of cases) {
    const r = await app.repl(src);
    assert.equal(r.ok, false, `${src} should be refused`);
    assert.match(r.error!, expected);
  }
});

test("no uncaught page errors", () => {
  assert.deepEqual(app.pageErrors, []);
});
