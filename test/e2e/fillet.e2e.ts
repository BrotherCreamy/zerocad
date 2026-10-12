// The fillet, on geometry drawn with a real mouse. This is the case that
// caught the relation-rebinding bug: every numerical check passed while the
// rectangle visibly fell apart, because the edge constraints stayed behind on
// the old corner. Hence the "still square" assertions.

import { test, before, after } from "node:test";
import assert from "node:assert/strict";
import { openApp, distanceToLine, sketchFrame, type AppContext } from "./harness.ts";

let app: AppContext;
before(async () => { app = await openApp(); });
after(async () => { await app.close(); });

test("filleting a drawn rectangle rounds the corner and keeps the box square", async () => {
  await app.type("rectangle");
  const p0 = await app.at(220, 120);
  const p1 = await app.at(620, 400);
  await app.page.mouse.move(p0.x, p0.y);
  await app.page.mouse.down();
  await app.page.mouse.move(p1.x, p1.y, { steps: 8 });
  await app.page.mouse.up();
  await app.page.waitForTimeout(250);

  const drawn = await app.model();
  assert.equal(drawn.byKind.line, 4, "a rectangle to work on");
  const edges = drawn.lines.map((l) => l.name);

  // A fillet's arc lies in a frame's plane in the 3D app; a sketch frame,
  // parked out of the way, in the plane the rectangle was drawn in.
  await sketchFrame(app);
  await app.type(`fillet("${edges[0]}", "${edges[1]}", 10); solve()`);
  const m = await app.model();

  assert.equal(m.byKind.arc, 1, "one arc created");
  assert.equal(await app.status(), "SOLVED");
  assert.equal(m.journalOps.filter((o) => o === "fillet").length, 1,
    "journalled as the one call the user made");
  assert.equal(m.journalOps.filter((o) => o === "tangent").length, 0,
    "not as the relations it expands into");

  // Tangency: the arc's centre sits exactly one radius from both legs.
  const arc = m.arcs[0];
  const centre = m.points[arc.center];
  const r = m.radii[arc.name];
  assert.ok(Math.abs(r - 10) < 1e-6, `radius ${r}`);
  for (const name of [edges[0], edges[1]]) {
    const leg = m.lines.find((l) => l.name === name)!;
    const d = distanceToLine(centre, m.points[leg.refs[0]], m.points[leg.refs[1]]);
    assert.ok(Math.abs(d - 10) < 1e-5, `${name} sits ${d} from the centre, expected 10`);
  }

  // The rectangle is still a rectangle: every edge still axis-aligned. This is
  // the assertion that failed before relations followed their line.
  for (const leg of m.lines) {
    const [a, b] = [m.points[leg.refs[0]], m.points[leg.refs[1]]];
    const level = Math.abs(a[1] - b[1]) < 1e-6;
    const plumb = Math.abs(a[0] - b[0]) < 1e-6;
    assert.ok(level || plumb, `${leg.name} went slack: ${a} -> ${b}`);
  }

  // Nothing stranded: the model has no delete, so an orphan would be permanent.
  const referenced = new Set<string>();
  for (const l of m.lines) l.refs.forEach((n) => referenced.add(n));
  for (const a of m.arcs) [a.center, a.start, a.end].forEach((n) => referenced.add(n));
  // (The sketch frame's points belong to the frame.)
  const orphans = Object.keys(m.points).filter((n) => !referenced.has(n) && !n.startsWith("f_"));
  assert.deepEqual(orphans, [], "no orphaned points left behind");
});

test("all four corners can be filleted", async () => {
  const m0 = await app.model();
  const edges = m0.lines.map((l) => l.name);
  for (let i = 1; i < 4; i++) {
    await app.type(`fillet("${edges[i]}", "${edges[(i + 1) % 4]}", 10); solve()`);
  }
  const m = await app.model();
  assert.equal(m.byKind.arc, 4);
  assert.equal(await app.status(), "SOLVED");
  for (const a of m.arcs) assert.ok(Math.abs(m.radii[a.name] - 10) < 1e-6);
});

test("the fillet tool rounds a corner from two clicks", async () => {
  // A fresh rectangle to work on, well clear of the earlier one.
  await app.type("rectangle");
  const p0 = await app.at(700, 120);
  const p1 = await app.at(1000, 340);
  await app.page.mouse.move(p0.x, p0.y);
  await app.page.mouse.down();
  await app.page.mouse.move(p1.x, p1.y, { steps: 8 });
  await app.page.mouse.up();
  await app.page.waitForTimeout(250);

  const before = await app.model();
  const fresh = before.lines.slice(-4); // the four edges just drawn

  /** The middle of an edge, in page coordinates. */
  const midOf = async (edge: { refs: [string, string] }) => {
    const [sx, sy] = await app.page.evaluate((refs) => {
      const { model, engine } = (window as never as {
        __neocad: { model: { coords(n: string): number[] }; engine: { worldToScreen(w: number[]): [number, number] } };
      }).__neocad;
      const a = model.coords(refs[0]), b = model.coords(refs[1]);
      return engine.worldToScreen([(a[0] + b[0]) / 2, (a[1] + b[1]) / 2]);
    }, edge.refs);
    return app.at(sx, sy);
  };

  await app.type('arm("fillet", { radius: 12 })');
  assert.equal((await app.model()).activeTool, "fillet");

  const first = await midOf(fresh[0]);
  await app.page.mouse.click(first.x, first.y);
  await app.page.waitForTimeout(150);
  assert.equal((await app.model()).byKind.arc, before.byKind.arc, "one click commits nothing");
  assert.equal((await app.model()).activeTool, "fillet", "and the tool is still armed");

  const second = await midOf(fresh[1]);
  await app.page.mouse.click(second.x, second.y);
  await app.page.waitForTimeout(250);

  const after = await app.model();
  assert.equal(after.byKind.arc, (before.byKind.arc ?? 0) + 1, "the corner was rounded");
  assert.equal(after.activeTool, null, "and the tool stood down");
  assert.equal(await app.status(), "SOLVED");

  const arc = after.arcs[after.arcs.length - 1];
  assert.ok(Math.abs(after.radii[arc.name] - 12) < 1e-6,
    `the arm-time radius was used, got ${after.radii[arc.name]}`);
});

test("clicking a point with the fillet tool armed is a miss, not a crash", async () => {
  await app.type('arm("fillet", { radius: 6 })');
  const m = await app.model();
  const name = Object.keys(m.points)[0];
  const [sx, sy] = await app.page.evaluate((n) => {
    const { model, engine } = (window as never as {
      __neocad: { model: { coords(x: string): number[] }; engine: { worldToScreen(w: number[]): [number, number] } };
    }).__neocad;
    return engine.worldToScreen(model.coords(n));
  }, name);
  const p = await app.at(sx, sy);
  await app.page.mouse.click(p.x, p.y);
  await app.page.waitForTimeout(150);
  assert.equal((await app.model()).byKind.arc, m.byKind.arc, "nothing happened");
  assert.equal((await app.model()).activeTool, "fillet", "and the gesture is still live");
  await app.type("cancel()");
});

test("no uncaught page errors", () => {
  assert.deepEqual(app.pageErrors, []);
});
