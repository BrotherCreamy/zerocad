// A relation typed at the command line re-solves, so the header never reports
// a verdict from before what was just typed.
//
// This is the stale-readout family, third sighting: for a while `dist("a","b",50)`
// added its residual and redrew, and the status line went on reading `SOLVED`
// over a drawing that plainly violated the constraint until someone thought to
// type `solve()`. No unit test can see it — the mathematics was never wrong,
// only the assembly — which is exactly why the check lives here.
//
// The counter is the load-bearing part. "It solved" is easy to assert by
// looking at the geometry; "it did *not* solve" is not, and `ls()` not solving
// is half the decision. So `model.solve` is wrapped in the page and counted.

import { test, before, after } from "node:test";
import assert from "node:assert/strict";
import { openApp, type AppContext } from "./harness.ts";

let app: AppContext;
after(async () => { await app.close(); });

/** Wraps `model.solve` in the page so solves can be counted from here. */
async function countSolves(): Promise<void> {
  await app.page.evaluate(() => {
    const w = window as never as {
      __neocad: { model: { solve(...a: unknown[]): unknown } };
      __solves: number;
    };
    const model = w.__neocad.model;
    const original = model.solve.bind(model);
    w.__solves = 0;
    model.solve = (...args: unknown[]) => {
      w.__solves++;
      return original(...args);
    };
  });
}

const solves = () => app.page.evaluate(() => (window as never as { __solves: number }).__solves);

before(async () => {
  app = await openApp();
  // Deliberately under-constrained: two free points and the edge between them.
  await app.type("a = pt(0,0); b = pt(40,0); ln(a,b)");
  await app.type('fix("p1", [0,0])');
  await countSolves();
});

test("looking at the model does not solve it", async () => {
  const start = await solves();
  await app.type("ls()");
  await app.type("help()");
  await app.type("2 + 2");
  await app.type("coords('p2')");
  assert.equal(await solves(), start,
    "an entry that leaves the model identical must not re-solve — the comparison, not a list of command names, is what decides");
});

test("a relation typed at the command line takes effect without solve()", async () => {
  const start = await solves();
  await app.type('dist("p1", "p2", 100)'); // note: no solve()
  assert.equal(await solves(), start + 1, "the entry changed the model, so it re-solved");

  const m = await app.model();
  const [p1, p2] = [m.points.p1, m.points.p2];
  const d = Math.hypot(p2[0] - p1[0], p2[1] - p1[1]);
  assert.ok(Math.abs(d - 100) < 1e-6, `the constraint was added but never applied: distance is ${d}`);
  assert.equal(await app.status(), "SOLVED", "and the header describes the drawing on screen");
});

test("a contradictory relation flips the header to CONFLICT, with no solve() typed", async () => {
  await app.type("k = circ(pt(0,80), 20)");
  await app.type('rad("c1", 20)');
  assert.equal(await app.status(), "SOLVED", "one radius is satisfiable");

  const start = await solves();
  await app.type('rad("c1", 40)'); // a circle cannot have two radii
  assert.equal(await solves(), start + 1);
  assert.match(await app.status(), /^CONFLICT/,
    "the header must not still read SOLVED over a drawing that cannot be");
});

test("an entry that fails changes nothing and solves nothing", async () => {
  const start = await solves();
  await app.type('dist("nope", "p2", 10)');
  assert.equal(await solves(), start, "a throw left the model as it was, so there is nothing to re-solve");
  assert.match(await app.log(), /nope/);
});

test("no uncaught page errors", () => {
  assert.deepEqual(app.pageErrors, []);
});
