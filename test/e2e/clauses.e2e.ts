// Clauses, typed at the real command line: `circ(oncircle("p1", _), …)` and
// `pt(on(_, h), on(_, v))`.
//
// The unit suite proves a clause expression is its expansion, byte for byte.
// What it cannot see is the keystroke-to-drawing path: that the entry solves
// without `solve()` being typed, that the whole expression is ONE undo step
// (main.ts brackets a submitted line, and a clause expression is one line
// however many relations it makes), that a clause typed alone shows up in the
// log as the call rather than as `{}`, and that the file saved afterwards
// opens in the app.

import { test, before, after } from "node:test";
import assert from "node:assert/strict";
import { axisFrame, openApp, type AppContext } from "./harness.ts";

let app: AppContext;
before(async () => { app = await openApp(); });
after(async () => { await app.close(); });

const EMPTY = JSON.stringify({
  format: "neocad-model", version: 1, dim: 2,
  journal: [], values: { points: {}, radii: {} },
});

/** Wraps `model.solve` in the page so solves can be counted from here. */
async function countSolves(): Promise<void> {
  await app.page.evaluate(() => {
    const w = window as never as { __neocad: { model: { solve(...a: unknown[]): unknown } }; __solves: number };
    const model = w.__neocad.model;
    const original = model.solve.bind(model);
    w.__solves = 0;
    model.solve = (...args: unknown[]) => { w.__solves++; return original(...args); };
  });
}
const solves = () => app.page.evaluate(() => (window as never as { __solves: number }).__solves);

const near = (a: number[], b: number[], tol = 1e-6) => a.every((v, i) => Math.abs(v - b[i]) < tol);

test("the three-point circle, as one expression, solves without solve()", async () => {
  await app.type(`open(${JSON.stringify(EMPTY)})`);
  await axisFrame(app); // named points, so the p-counter still starts at p1
  await app.type("fix(pt(20,0), [20,0]); fix(pt(100,0), [100,0]); fix(pt(20,60), [20,60])");
  await countSolves();

  await app.type('c = circ(oncircle("p1", _), oncircle("p2", _), oncircle("p3", _))');

  assert.ok(await solves() > 0, "no solve() was typed, and the drawing moved anyway");
  assert.equal(await app.status(), "SOLVED");
  const m = await app.model();
  assert.equal(m.byKind.circle, 1);
  // Circumcircle of (20,0), (100,0), (20,60): centre (60, 30), radius 50.
  const centre = m.points[m.circles[0].center];
  assert.ok(near(centre, [60, 30, 0]), `centre at ${centre}`);
  assert.ok(Math.abs(m.radii.c1 - 50) < 1e-6, `radius ${m.radii.c1}`);
  // Each clause journalled as the relation it is — the file will say oncircle three times.
  assert.equal(m.journalOps.filter((op) => op === "onCircle").length, 3);
  assert.ok((await app.log()).includes("c1"), "the entry answers with the circle's name");
});

test("the intersection point, and the whole expression is one undo step", async () => {
  await app.type("a = pt(-80,50); b = pt(0,50); fix(a, [-80,50]); fix(b, [0,50]); h = ln(a, b)");
  await app.type("u = pt(-40,10); w = pt(-40,90); fix(u, [-40,10]); fix(w, [-40,90]); v = ln(u, w)");
  const before = await app.model();

  await app.type("x = pt(on(_, h), on(_, v))");
  const after = await app.model();
  assert.equal(await app.status(), "SOLVED");
  const x = Object.keys(after.points).find((n) => !(n in before.points))!;
  assert.ok(near(after.points[x], [-40, 50, 0]), `the crossing is (-40, 50), the point is at ${after.points[x]}`);
  assert.deepEqual(after.journalOps.slice(before.journalOps.length), ["addPoint", "pointOnLine", "pointOnLine"],
    "the point and its two relations, journalled as the lines they expand to");

  await app.type("undo()");
  const undone = await app.model();
  assert.deepEqual(undone.journalOps, before.journalOps, "one undo takes the point and both relations");
  assert.equal(undone.size, before.size);

  await app.type("redo()");
  const redone = await app.model();
  assert.deepEqual(redone.journalOps, after.journalOps);
  assert.ok(near(redone.points[x], [-40, 50, 0]));
});

test("a clause typed alone shows as the call; a refusal leaves nothing behind", async () => {
  const before = await app.model();
  await app.type('on(_, "l1")');
  assert.ok((await app.log()).includes('on(_, "l1")'), "the log shows the clause as the call that made it");

  await app.type('pt(on(_, "l1"), on(_, "nope"))');
  const log = await app.log();
  assert.ok(log.includes('pt: on(_, "nope") names "nope", and there is no "nope"'), log.slice(-300));
  const after = await app.model();
  assert.deepEqual(after.journalOps, before.journalOps, "checked before anything was made");
});

test("save and open: the drawing comes back, and its clauses are ordinary relations", async () => {
  const saved = await app.repl("save()");
  assert.equal(saved.ok, true);
  const text = saved.value as string;
  assert.ok(!text.includes('"_"'), "the file never mentions the placeholder");
  const before = await app.model();

  await app.type(`open(${JSON.stringify(text)})`);
  await app.type("solve()");
  const m = await app.model();
  assert.equal(await app.status(), "SOLVED");
  assert.deepEqual(m.journalOps, before.journalOps);
  assert.ok(near(m.points[m.circles[0].center], [60, 30, 0]));
  assert.ok(Math.abs(m.radii.c1 - 50) < 1e-6);
  const reSaved = await app.repl("save()");
  assert.equal(reSaved.value, text, "and saves back to the same bytes");
});

test("no uncaught page errors", () => {
  assert.deepEqual(app.pageErrors, []);
});
