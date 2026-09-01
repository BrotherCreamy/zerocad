// Constraint inference, with a real mouse. The acceptance test that defines
// the feature is the first one here: a rectangle drawn from another's corner
// has to *follow* that corner when it moves. Before inference it demonstrably
// did not — two points sat at identical coordinates, unconnected, and moving
// one left the other behind.

import { test, before, after } from "node:test";
import assert from "node:assert/strict";
import { axisFrame, openApp, type AppContext } from "./harness.ts";

let app: AppContext;
before(async () => { app = await openApp(); });
after(async () => { await app.close(); });

const countOf = (ops: string[], op: string) => ops.filter((o) => o === op).length;

/** Drags the armed tool from one canvas point to another. */
async function drag(from: [number, number], to: [number, number]) {
  const a = await app.at(...from);
  const b = await app.at(...to);
  await app.page.mouse.move(a.x, a.y);
  await app.page.mouse.down();
  await app.page.mouse.move(b.x, b.y, { steps: 6 });
  await app.page.mouse.up();
  await app.page.waitForTimeout(200);
}

test("a rectangle drawn from another's corner follows it when that corner moves", async () => {
  await app.type("rectangle");
  await drag([200, 120], [380, 260]);
  const a = await app.model();
  assert.equal(a.byKind.point, 4, "rectangle A");

  // Rectangle B, started three pixels off A's far corner — a miss by any exact
  // measure, and exactly the kind of aim a hand has.
  await app.type("rectangle");
  await drag([383, 257], [500, 380]);
  const b = await app.model();
  assert.equal(b.byKind.point, 8, "rectangle B");
  assert.equal(countOf(b.journalOps, "coincident"), 1, "the corner click became a constraint");
  assert.equal(await app.status(), "SOLVED", "two rectangles sharing a corner is not a conflict");
  assert.deepEqual(b.points.p5, b.points.p3, "B's first corner sits on A's second");

  // Move A's corner. B's has to come with it. `fix` is relative to a frame
  // now, and this one goes in after the drawing so that the counts above are
  // still of the rectangles alone.
  await axisFrame(app);
  await app.type('fix("p3", [40, 15]); solve()');
  const after = await app.model();
  assert.equal(await app.status(), "SOLVED");
  const moved = after.points.p5;
  assert.ok(Math.hypot(moved[0] - 40, moved[1] - 15) < 1e-6,
    `B's corner should have followed A's to (40,15), got ${moved}`);
});

test("clicking an edge's midpoint applies the line form of midpoint", async () => {
  const before = await app.model();
  // The middle of A's first edge, in canvas pixels.
  const mid = await app.page.evaluate((refs) => {
    const { model, engine } = (window as never as {
      __neocad: { model: { coords(n: string): number[] }; engine: { worldToScreen(w: number[]): [number, number] } };
    }).__neocad;
    const a = model.coords(refs[0]), b = model.coords(refs[1]);
    return engine.worldToScreen([(a[0] + b[0]) / 2, (a[1] + b[1]) / 2]);
  }, before.lines[0].refs);

  await app.type("point");
  const target = await app.at(mid[0] + 2, mid[1] - 2);
  await app.page.mouse.move(target.x, target.y);
  await app.page.mouse.click(target.x, target.y);
  await app.page.waitForTimeout(200);

  const entries = (await app.repl("journal()")).value as string[];
  const applied = entries.filter((e) => e.startsWith("midpoint("));
  assert.equal(applied.length, 1, `expected one midpoint, got ${JSON.stringify(applied)}`);
  assert.match(applied[0], new RegExp(`^midpoint\\("[^"]+", "${before.lines[0].name}"\\)$`),
    "the line form — two arguments, the second a line");
});

test("with snapping off, nothing is inferred", async () => {
  await app.type("snapping(false)");
  const before = await app.model();

  await app.type("rectangle");
  // Start exactly on an existing corner: with snapping off there is no snap to
  // infer from, so this is two points in one place and nothing joining them.
  const corner = await app.page.evaluate(() => {
    const { model, engine } = (window as never as {
      __neocad: { model: { coords(n: string): number[] }; engine: { worldToScreen(w: number[]): [number, number] } };
    }).__neocad;
    return engine.worldToScreen(model.coords("p1"));
  });
  await drag([corner[0], corner[1]], [corner[0] + 90, corner[1] + 70]);

  const after = await app.model();
  assert.equal(after.byKind.point, (before.byKind.point ?? 0) + 4, "the rectangle was still drawn");
  assert.equal(countOf(after.journalOps, "coincident"), countOf(before.journalOps, "coincident"),
    "one switch for both — snapping(false) turns inference off with it");
  await app.type("snapping(true)");
});

test("no uncaught page errors", () => {
  assert.deepEqual(app.pageErrors, []);
});
