// Entities defined by constraints, not constructors — in a browser, typed at
// the real command line.
//
// The unit suite already proves the mathematics: a `circle()` pinned by three
// `oncircle`s lands on the closed-form circumcircle. What it cannot see is
// everything between the keystroke and the drawing, which is where this
// project's bugs have actually lived. So the two examples the owner asked for
// are typed here *verbatim* (modulo names), through the same input a user
// types into, and checked on three counts the unit tests do not reach:
//
//   1. the geometry is right when read back out of the live model;
//   2. it got there **without `solve()` being typed** — a free circle that
//      needs a manual solve to move is not the feature that was asked for;
//   3. a piece nobody placed appears where the user is looking, not at the
//      world origin off the edge of the window.
//
// The last of those is why the view-centre test reads pixels rather than
// coordinates. "The circle is at the middle of the view" is a claim about what
// is on screen, and a number agreeing with a number would prove nothing about
// whether anything was drawn.

import { test, before, after } from "node:test";
import assert from "node:assert/strict";
import { axisFrame, openApp, distanceToLine, type AppContext } from "./harness.ts";

let app: AppContext;
before(async () => { app = await openApp(); });
after(async () => { await app.close(); });

/** An empty saved model — the shortest honest way back to a clean sheet. */
const EMPTY = JSON.stringify({
  format: "neocad-model", version: 1, dim: 2,
  journal: [], values: { points: {}, radii: {} },
});

async function reset(): Promise<void> {
  await app.type(`open(${JSON.stringify(EMPTY)})`);
  // A clean sheet has no frame at all now, and `fix` needs one. Hence the
  // extra three points in every count below: the frame's origin, x-ref and y-ref.
  await axisFrame(app);
}

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
    model.solve = (...args: unknown[]) => { w.__solves++; return original(...args); };
  });
}

const solves = () => app.page.evaluate(() => (window as never as { __solves: number }).__solves);

interface Probe {
  __neocad: {
    model: { coords(n: string): number[]; circle(n: string): { center: string } };
    engine: { worldToScreen(w: number[]): [number, number] };
  };
}

const screenOfWorld = (world: number[]): Promise<[number, number]> =>
  app.page.evaluate((w) => (window as never as Probe).__neocad.engine.worldToScreen(w), world);

/**
 * Whether the patch holds any of the pale blue (#afc6d9) the renderer draws
 * geometry in. The grid is nearly black and the ground darker still, so a hit
 * means a real edge or rim was drawn there.
 */
function geometryIn(x: number, y: number, w: number, h: number): Promise<boolean> {
  return app.page.evaluate(([px, py, pw, ph]) => {
    const cv = document.getElementById("cv") as HTMLCanvasElement;
    const dpr = cv.width / cv.getBoundingClientRect().width;
    const g = cv.getContext("2d")!;
    const d = g.getImageData(Math.round(px * dpr), Math.round(py * dpr),
      Math.max(1, Math.round(pw * dpr)), Math.max(1, Math.round(ph * dpr))).data;
    for (let i = 0; i < d.length; i += 4) {
      if (d[i] > 130 && d[i + 1] > 150 && d[i + 2] > 170) return true;
    }
    return false;
  }, [x, y, w, h]);
}

// --- the owner's first example ---------------------------------------------

test("the three-point circle, typed: circle() then three oncircles, no solve()", async () => {
  await reset();
  // Three points nailed down. Circumcircle of (0,0), (8,0), (0,6) is centred
  // (4,3) with radius 5 — closed form, so this is an exact target, not a
  // "solved: true".
  await app.type('fix(pt(0,0), [0,0]); fix(pt(8,0), [8,0]); fix(pt(0,6), [0,6])');
  await countSolves();

  await app.type("c = circle()");
  const seeded = await app.model();
  assert.equal(seeded.byKind.circle, 1, "circle() with no arguments made a circle");
  assert.equal(seeded.byKind.point, 4 + 3, "and a real, named centre point of its own");

  // The owner's example, verbatim apart from the point names.
  await app.type('oncircle("p1", c); oncircle("p2", c); oncircle("p3", c)');

  assert.ok(await solves() > 0, "typing the relations must have re-solved on its own");
  assert.equal(await app.status(), "SOLVED");

  const m = await app.model();
  // Read the centre through the circle rather than by name: it is a point
  // nobody named, so the test must not pretend to know what it is called.
  const centre = m.points[m.circles[0].center];
  assert.ok(Math.abs(centre[0] - 4) < 1e-6 && Math.abs(centre[1] - 3) < 1e-6,
    `centre landed at ${centre}, not the circumcentre (4, 3) — and nobody typed solve()`);
  assert.ok(Math.abs(m.radii.c1 - 5) < 1e-6, `radius landed at ${m.radii.c1}, not 5`);
});

test("and the free circle is a first-class thing afterwards: rels, glyphs, del, undo", async () => {
  const before = await app.model();
  const centreName = before.circles[0].center;

  // Its auto-created centre answers to `rels` like any point the user placed,
  // and is describable, hoverable and pickable for the same reason: nothing
  // downstream can tell it apart from one that was typed.
  const onCentre = await app.repl(`rels(${JSON.stringify(centreName)})`);
  assert.ok(Array.isArray(onCentre.value));
  const listed = await app.repl("ls()");
  assert.ok((listed.value as string[]).some((l) => l.startsWith(`${centreName}  point`)),
    `the auto-created centre must show up in ls() like any other point: ${JSON.stringify(listed.value)}`);
  const named = await app.repl("rels()");
  const all = (named.value as string[]).join("\n");
  assert.equal((all.match(/oncircle/g) ?? []).length, 3,
    `the three constraints that define the circle must be listed: ${all}`);

  // And the cursor finds it: a point nobody typed the coordinates of is
  // hoverable exactly like one that was. Glyphs go off for this one check —
  // this drawing is dense enough that a constraint mark sits over the centre,
  // and marks outrank points in the picking tiers by design.
  await app.type("glyphs(false)");
  const [hx, hy] = await screenOfWorld(before.points[centreName]);
  const at = await app.at(hx, hy);
  await app.page.mouse.move(at.x, at.y);
  await app.page.waitForTimeout(120);
  const tag = await app.page.$eval("#hovertag", (el) =>
    (el as HTMLElement).hidden ? null : el.textContent);
  assert.ok(tag?.startsWith(centreName), `expected the hover tag to name ${centreName}, got ${tag}`);
  await app.type("glyphs(true)");

  // The glyph layer covers relations on auto-created pieces without being told.
  const marks = await app.page.evaluate(() =>
    (window as never as { __neocad: { engine: { glyphs(): { relation: string }[] } } })
      .__neocad.engine.glyphs().length);
  assert.ok(marks >= 3, `each onCircle should be wearing a mark; saw ${marks}`);

  // Deleting the circle takes its constraints and leaves its centre, exactly as
  // it does for a circle whose centre the user placed by hand.
  // Typed, not evaluated behind the app's back: what counts as one undo step
  // is decided in main.ts around a *submitted* entry, so a `del` sneaked
  // straight into the evaluator would leave the next `undo()` undoing the
  // entry before it.
  await app.type('removed = del("c1")');
  const removed = await app.repl("removed");
  assert.ok((removed.value as string[]).includes("c1"));
  let m = await app.model();
  assert.equal(m.byKind.circle, undefined, "the circle is gone");
  assert.ok(m.points[centreName], "its auto-created centre outlives it, like any centre");

  await app.type("undo()");
  m = await app.model();
  assert.equal(m.byKind.circle, 1, "and undo brings the whole thing back");
  const back = m.points[m.circles[0].center];
  assert.ok(Math.abs(back[0] - 4) < 1e-6 && Math.abs(back[1] - 3) < 1e-6,
    "including the solution it was sitting on");
});

// --- the owner's second example --------------------------------------------

test("tangent + through-point + radius, typed: circle(); tan(l1,c); oncircle(p3,c); rad(c,d)", async () => {
  await reset();
  await app.type('fix(pt(0,0), [0,0]); fix(pt(30,0), [30,0]); line("p1", "p2")'); // the x-axis
  await app.type('fix(pt(10,8), [10,8])');
  await countSolves();

  await app.type("c = circle()");
  await app.type('tan("l1", c); oncircle("p3", c); rad(c, 4)');

  assert.ok(await solves() > 0, "no solve() was typed, and the drawing moved anyway");
  assert.equal(await app.status(), "SOLVED");

  const m = await app.model();
  const centre = m.points[m.circles[0].center];
  const r = m.radii.c1;
  assert.ok(Math.abs(r - 4) < 1e-6, `radius is ${r}`);
  assert.ok(Math.abs(distanceToLine(centre, m.points.p1, m.points.p2) - r) < 1e-6,
    "tangent means the centre stands exactly r from the line");
  assert.ok(Math.abs(Math.hypot(centre[0] - 10, centre[1] - 8) - r) < 1e-6,
    "and p3 sits exactly on the rim");
});

// --- a free line, defined only by what it touches ---------------------------

test("a free line() made tangent to two circles", async () => {
  await reset();
  // Both radii are *constrained*, not merely seeded: a constructor argument
  // only ever seeds a variable, so without these the solver is free to shrink
  // a circle onto the line and call it tangent.
  await app.type('fix(pt(0,0), [0,0]); circ("p1", 6); rad("c1", 6)');
  await app.type('fix(pt(40,0), [40,0]); circ("p2", 10); rad("c2", 10)');
  await countSolves();

  await app.type("t = line()"); // both endpoints auto-created, seeded apart
  const fresh = await app.model();
  assert.equal(fresh.lines.length, 1);
  const [a, b] = fresh.lines[0].refs;
  assert.ok(Math.hypot(fresh.points[a][0] - fresh.points[b][0], fresh.points[a][1] - fresh.points[b][1]) > 1,
    "a zero-length seed has no direction, and tan divides by it");

  await app.type('tan(t, "c1"); tan(t, "c2")');
  assert.ok(await solves() > 0);
  assert.equal(await app.status(), "SOLVED");

  const m = await app.model();
  const [pa, pb] = m.lines[0].refs.map((n) => m.points[n]);
  assert.ok(Math.abs(distanceToLine(m.points.p1, pa, pb) - 6) < 1e-6,
    "the line stands 6 from the first centre");
  assert.ok(Math.abs(distanceToLine(m.points.p2, pa, pb) - 10) < 1e-6,
    "and 10 from the second — a line defined by nothing but what it touches");
});

// --- where a piece nobody placed appears ------------------------------------

test("a free circle appears in the middle of the view, wherever the view has been panned", async () => {
  await reset();
  await app.type("pan(-260, 140)"); // put the world origin well off to one side
  await app.type("circle()");

  const m = await app.model();
  const centre = m.points[m.circles[0].center];
  assert.ok(Math.hypot(centre[0], centre[1]) > 20,
    `the seed must follow the view, not sit at the origin — got ${centre}`);

  const box = await app.page.$eval("#cv", (el) => {
    const r = el.getBoundingClientRect();
    return { width: r.width, height: r.height };
  });
  const [sx, sy] = await screenOfWorld(centre);
  assert.ok(Math.abs(sx - box.width / 2) < 1.5 && Math.abs(sy - box.height / 2) < 1.5,
    `the free circle's centre should be at the middle of the canvas, and is at (${sx}, ${sy}) ` +
    `of ${Math.round(box.width)}x${Math.round(box.height)}`);

  // And it is actually drawn there: the rim is r*scale to the right of centre.
  const [rimX, rimY] = await screenOfWorld([centre[0] + m.radii.c1, centre[1]]);
  assert.ok(await geometryIn(rimX - 3, rimY - 3, 6, 6),
    "nothing was drawn where the circle's rim should be — the numbers can agree and the screen stay empty");
});

test("no uncaught page errors", () => {
  assert.deepEqual(app.pageErrors, []);
});
