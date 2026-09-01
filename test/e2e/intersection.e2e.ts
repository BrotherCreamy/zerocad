// Snapping to a crossing, in a browser, with a real mouse.
//
// The claim that defines the feature is not "there is an × on the screen". It
// is that a point clicked at a crossing **stays** the crossing: `placePoint`
// applies the on-curve relation for *both* curves, so moving either one takes
// the point with it. A one-frame snap that put the point at the right
// coordinate and joined it to nothing would pass a coordinate check and fail
// the only test that matters, so the coordinate check here is followed
// immediately by a drag.
//
// The landing is compared against the closed form computed from the model's
// own numbers — sqrt(r² - dy²) — rather than against the click, which is
// three pixels off on purpose. A tolerance-of-the-click assertion would pass
// with no snapping at all.

import { test, before, after } from "node:test";
import assert from "node:assert/strict";
import { openApp, type AppContext } from "./harness.ts";

let app: AppContext;
after(async () => { await app.close(); });

interface Probe {
  __neocad: {
    model: { coords(n: string): number[]; radius(n: string): number };
    engine: {
      snap: { kind: string; targets: string[] } | null;
      glyphs(): { relation: string; op: string; symbol: string }[];
      worldToScreen(w: number[]): [number, number];
    };
  };
}

const snapState = () => app.page.evaluate(() => {
  const s = (window as never as Probe).__neocad.engine.snap;
  return s ? { kind: s.kind, targets: [...s.targets].sort() } : null;
});

/** Canvas-relative screen position of a world coordinate, as the app computes it. */
const screenOf = (world: number[]): Promise<[number, number]> =>
  app.page.evaluate((w) => (window as never as Probe).__neocad.engine.worldToScreen(w), world);

/** Page coordinates for a world position, nudged by a few canvas pixels. */
async function pageAt(world: number[], dx = 0, dy = 0) {
  const [sx, sy] = await screenOf(world);
  return app.at(sx + dx, sy + dy);
}

async function moveTo(world: number[], dx = 0, dy = 0) {
  const p = await pageAt(world, dx, dy);
  await app.page.mouse.move(p.x, p.y);
  await app.page.waitForTimeout(150);
}

const rels = async () => (await app.repl("rels()")).value as string[];
const relsNaming = async (n: string) => (await app.repl(`rels(${JSON.stringify(n)})`)).value as string[];

/** Ctrl+Z with the command input empty — the state in which the model owns it. */
async function undoKey(): Promise<void> {
  await app.page.fill("#cmd", "");
  await app.page.keyboard.press("Control+z");
  await app.page.waitForTimeout(250);
}

/** The point the crossing click created, remembered across the tests below. */
let placed = "";

// The scene: a circle of radius 40 about the origin, and a level edge across
// it at y = 12 — deliberately off-centre, so the crossing is at an x no click
// could land on by luck.
const R = 40, DY = 12;
const CROSS_X = Math.sqrt(R * R - DY * DY); // 38.1576…

before(async () => {
  app = await openApp();
  await app.type(`ctr = pt(0,0); k = circ(ctr, ${R})`);
  await app.type(`la = pt(-70,${DY}); lb = pt(70,${DY}); edge = ln(la, lb)`);
  await app.type("solve()");
});

test("the cursor is pulled to a crossing, and the marker names both curves", async () => {
  await app.type("point");
  await moveTo([CROSS_X, DY], 3, -3);
  assert.deepEqual(await snapState(), { kind: "intersection", targets: ["c1", "l1"] },
    "an intersection snap carries both curves, not one");
});

test("clicking there lands on the exact crossing and constrains it to both curves", async () => {
  const start = await app.model();
  const p = await pageAt([CROSS_X, DY], 3, -3);
  await app.page.mouse.click(p.x, p.y);
  await app.page.waitForTimeout(250);

  const now = await app.model();
  const [name, at] = Object.entries(now.points).find(([n]) => !(n in start.points))!;
  placed = name;
  assert.ok(Math.abs(at[0] - CROSS_X) < 1e-6 && Math.abs(at[1] - DY) < 1e-6,
    `expected the closed-form crossing (${CROSS_X}, ${DY}), got ${at}`);

  const applied = await relsNaming(name);
  assert.equal(applied.length, 2, `expected two relations on ${name}, got ${JSON.stringify(applied)}`);
  assert.ok(applied.some((r) => r.includes(`on ${name} l1`)), JSON.stringify(applied));
  assert.ok(applied.some((r) => r.includes(`oncircle ${name} c1`)), JSON.stringify(applied));
  assert.equal(await app.status(), "SOLVED", "two on-curve relations on one point is not a conflict");
});

test("both inferred relations wear a glyph", async () => {
  const mine = new Set((await relsNaming(placed)).map((r) => r.split(/\s+/)[0]));
  assert.equal(mine.size, 2);

  const drawn = await app.page.evaluate(() => (window as never as Probe).__neocad.engine.glyphs());
  const theirs = drawn.filter((g) => mine.has(g.relation));
  assert.equal(theirs.length, 2, `both inferred relations should be drawn, got ${JSON.stringify(drawn)}`);
  assert.deepEqual([...new Set(theirs.map((g) => g.op))].sort(), ["onCircle", "pointOnLine"]);
});

test("drag the line and the point rides the crossing", async () => {
  const start = await app.model();
  const was = start.points[placed];

  // Grab the edge by an endpoint — with nothing armed, a press on a point
  // drags it and the model follows. Tilting the edge moves the crossing.
  const from = await pageAt(start.points.p2);
  const to = await pageAt([start.points.p2[0], start.points.p2[1] - 26]);
  await app.page.mouse.move(from.x, from.y);
  await app.page.mouse.down();
  await app.page.mouse.move(to.x, to.y, { steps: 8 });
  await app.page.mouse.up();
  await app.page.waitForTimeout(400);

  const now = await app.model();
  const at = now.points[placed];
  assert.ok(Math.hypot(at[0] - was[0], at[1] - was[1]) > 1, `the point should have moved, it is still at ${at}`);

  // And where it moved to is still the crossing: on the rim, and on the edge.
  const ctr = now.points.p1;
  assert.ok(Math.abs(Math.hypot(at[0] - ctr[0], at[1] - ctr[1]) - now.radii.c1) < 1e-4,
    `still on the rim? |${at} - ${ctr}| vs r ${now.radii.c1}`);
  const [a, b] = [now.points.p2, now.points.p3];
  const cross = (b[0] - a[0]) * (at[1] - a[1]) - (b[1] - a[1]) * (at[0] - a[0]);
  assert.ok(Math.abs(cross) / Math.hypot(b[0] - a[0], b[1] - a[1]) < 1e-4,
    `still on the edge? off by ${Math.abs(cross) / Math.hypot(b[0] - a[0], b[1] - a[1])}`);
});

test("two Ctrl+Z unwind the drag and the placement", async () => {
  const before = await app.model();
  await undoKey();
  await undoKey();

  const now = await app.model();
  assert.equal(now.byKind.point, before.byKind.point - 1, "the placed point is gone");
  assert.deepEqual(await rels(), [], "and both relations went with it");
  assert.equal(await app.status(), "SOLVED");
  assert.deepEqual(app.pageErrors, [], "unwinding an inferred pair should not throw");
});

test("an existing point still beats a crossing", async () => {
  // Off the crossing, but inside the point tolerance — and further from the
  // cursor than the crossing, which is right under it.
  const near = (await app.repl(`pt(${CROSS_X + 1.5}, ${DY + 0.5})`)).value as string;
  await app.type("point");
  await moveTo([CROSS_X, DY]);
  const s = await snapState();
  assert.equal(s?.kind, "point", `the thing itself outranks a computed place; got ${JSON.stringify(s)}`);
  assert.deepEqual(s?.targets, [near]);
  await app.type("cancel()");
  await app.repl(`del(${JSON.stringify(near)})`);
});

test("parallel edges offer no crossing", async () => {
  await app.type("pa = pt(-70,-40); pb = pt(70,-40); low = ln(pa, pb)");
  await app.type("pc = pt(-70,-46); pd = pt(70,-46); lower = ln(pc, pd)");
  await app.type("par(low, lower); solve()");

  await app.type("point");
  // Midway between the two, where a crossing would have to be if there were one.
  await moveTo([-10, -43]);
  const s = await snapState();
  assert.notEqual(s?.kind, "intersection", `parallel lines do not cross; got ${JSON.stringify(s)}`);
  await app.type("cancel()");
});

test("an arc crosses only inside its own sweep", async () => {
  // A quarter arc of radius 30 about (0,0), from (30,0) round to (0,30): the
  // top-right quadrant only. Two upright edges cut its *circle* at x = ±21.21;
  // only the right-hand one cuts the arc.
  const q = 30 / Math.SQRT2;
  await app.type("ac = pt(0,0); as = pt(30,0); ae = pt(0,30); a1 = arc(ac, as, ae, 30)");
  await app.type(`ra = pt(${q},-8); rb = pt(${q},60); right = ln(ra, rb)`);
  await app.type(`lla = pt(${-q},-8); llb = pt(${-q},60); left = ln(lla, llb)`);
  await app.type("solve()");

  await app.type("point");
  await moveTo([q, q]);
  const on = await snapState();
  assert.equal(on?.kind, "intersection", `inside the sweep; got ${JSON.stringify(on)}`);
  assert.ok(on!.targets.includes("a1"), JSON.stringify(on));

  await moveTo([-q, q]);
  const off = await snapState();
  assert.notEqual(off?.kind, "intersection",
    `the circle is cut on the left but the arc does not reach; got ${JSON.stringify(off)}`);
  await app.type("cancel()");
});

test("snapping(false) turns the crossing off with everything else", async () => {
  await app.type("snapping(false)");
  await app.type("point");
  await moveTo([CROSS_X, DY], 3, -3);
  assert.equal(await snapState(), null, "one switch, as everywhere else");

  const start = await app.model();
  const relsBefore = await rels();
  const p = await pageAt([CROSS_X, DY], 3, -3);
  await app.page.mouse.click(p.x, p.y);
  await app.page.waitForTimeout(250);

  const now = await app.model();
  const [, at] = Object.entries(now.points).find(([n]) => !(n in start.points))!;
  assert.ok(Math.abs(at[0] - CROSS_X) > 1e-3, `it should land where the cursor was, got ${at}`);
  assert.deepEqual(await rels(), relsBefore, "and infer nothing, because there was no snap to infer from");
  await app.type("snapping(true)");
});

test("no uncaught page errors", () => {
  assert.deepEqual(app.pageErrors, []);
});
