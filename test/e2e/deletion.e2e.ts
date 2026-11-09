// Deleting a constraint, in a browser, with a mouse.
//
// The story that defines the feature: two rectangles drawn so the second
// starts on the first's corner, which makes the tool infer a coincidence
// nobody typed. Hover the corner and the tag names it. Delete it, and the
// corners come apart under the cursor — which is the only way to *see* that a
// residual block really left the problem rather than merely leaving a list.
// Then Ctrl+Z twice and the drawing is byte-for-byte where it was, constraint
// and all, because the deletion is journalled like everything else.
//
// The unit suite covers the cascade arithmetic and the replay; what only a
// browser can answer is whether the constraint you can now see is the one you
// can now remove, and whether removing it is one undo step.

import { test, before, after } from "node:test";
import assert from "node:assert/strict";
import { openApp, sketchFrame, type AppContext } from "./harness.ts";

let app: AppContext;
before(async () => { app = await openApp(); });
after(async () => { await app.close(); });

/** The whole model as text — the same snapshot the undo stack stores. */
async function saved(): Promise<string> {
  const r = await app.repl("save()");
  assert.equal(r.ok, true, r.error ?? "");
  return r.value as string;
}

async function undoKey(): Promise<void> {
  await app.page.keyboard.press("Control+z");
  await app.page.waitForTimeout(220);
}

/** Canvas-relative screen position of a point, as the app itself computes it. */
async function screenOf(name: string): Promise<[number, number]> {
  return app.page.evaluate((n) => {
    const { model, engine } = (window as never as {
      __neocad: { model: { coords(x: string): number[] }; engine: { worldToScreen(w: number[]): [number, number] } };
    }).__neocad;
    return engine.worldToScreen(model.coords(n));
  }, name);
}

async function dragFromTo(from: [number, number], to: [number, number]) {
  const a = await app.at(...from);
  const b = await app.at(...to);
  await app.page.mouse.move(a.x, a.y);
  await app.page.mouse.down();
  await app.page.mouse.move(b.x, b.y, { steps: 8 });
  await app.page.mouse.up();
  await app.page.waitForTimeout(220);
}

/**
 * Types an entry and returns just the log it produced.
 *
 * Deliberately `type` rather than the REPL handle: an entry typed into the box
 * goes through the host's user-action bracket and is therefore one undo step,
 * which is half of what these tests are checking.
 */
async function typeAndRead(src: string): Promise<string> {
  const before = (await app.log()).length;
  await app.type(src);
  return (await app.log()).slice(before);
}

/** The names inside the `[a, b, c]` a `del` logs. */
function removedNames(logText: string): string[] {
  const m = /\[([^\]]*)\]/.exec(logText);
  assert.ok(m, `no list in ${JSON.stringify(logText)}`);
  return m[1].split(",").map((s) => s.trim()).filter(Boolean);
}

/** Moves the cursor over `name` and returns whatever the hover tag then says. */
async function hoverTag(name: string): Promise<string> {
  const [sx, sy] = await screenOf(name);
  const at = await app.at(sx, sy);
  await app.page.mouse.move(at.x - 30, at.y - 30); // arrive from somewhere else
  await app.page.mouse.move(at.x, at.y);
  await app.page.waitForTimeout(120);
  return app.page.$eval("#hovertag", (el) => ((el as HTMLElement).hidden ? "" : el.textContent ?? ""));
}

let attached = "";

test("the corner a tool inferred names its constraint on the hover tag", async () => {
  await app.type("rectangle");
  await dragFromTo([200, 90], [360, 210]);

  // The second rectangle starts three pixels off the first's far corner — a
  // miss by any exact measure, and exactly the aim a hand has.
  await app.type("rectangle");
  await dragFromTo([363, 207], [470, 330]);

  const m = await app.model();
  assert.equal(m.byKind.point, 8, "two rectangles");
  assert.deepEqual(m.points.p5, m.points.p3, "B's first corner is sitting on A's");
  assert.equal(await app.status(), "SOLVED");

  // Nobody typed this constraint; the tool inferred it. Now it has a name, and
  // the name is on the tag under the cursor. r6: a rectangle drawn with
  // nothing picked is a perp at every corner and one coplanar holding its
  // last corner in the plane of the other three (profiles-held.md), r1–r5 —
  // and the coplanar names p3, the third of those.
  assert.deepEqual((await app.repl('rels("p3")')).value, ["r5  coplanar p4 p1 p2 p3", "r6  coin p5 p3"]);
  const tag = await hoverTag("p3");
  assert.match(tag, /^p3\s+[-\d.,\s]+·\s+r5\s+r6$/, `hover tag was ${JSON.stringify(tag)}`);

  attached = await saved();
});

test("deleting it lets the corners come apart, and two undos put them back", async () => {
  assert.deepEqual(removedNames(await typeAndRead('del("r6")')), ["r6"],
    "a relation takes nothing else with it");
  assert.equal(await app.status(), "SOLVED", "and the header is not left reading the old verdict");
  assert.deepEqual((await app.repl('rels("p3")')).value, ["r5  coplanar p4 p1 p2 p3"], "nothing ties that corner to the other rectangle now");

  const [sx, sy] = await screenOf("p3");
  await dragFromTo([sx, sy], [sx - 70, sy - 55]);

  const apart = await app.model();
  const gap = Math.hypot(apart.points.p3[0] - apart.points.p5[0], apart.points.p3[1] - apart.points.p5[1]);
  assert.ok(gap > 5, `the corners should have separated, but are ${gap} apart`);
  assert.equal(apart.byKind.point, 8, "nothing was deleted by the drag");

  // Two actions were taken — one `del`, one drag — so two keystrokes go back.
  await undoKey();
  await undoKey();
  assert.equal(await saved(), attached, "geometry and journal both back, to the byte");
  assert.deepEqual((await app.repl('rels("p3")')).value, ["r5  coplanar p4 p1 p2 p3", "r6  coin p5 p3"],
    "and the registry with them — it is rebuilt by the same replay");

  const back = await app.model();
  assert.deepEqual(back.points.p5, back.points.p3, "the corners are attached again");
});

test("deleting a point takes what could not survive without it", async () => {
  // A fillet makes an arc, and an arc in the 3D app lies in a frame's plane:
  // a sketch frame first, parked out of the way, in the plane the rectangles
  // were drawn in.
  await sketchFrame(app);
  await app.type('fillet("l1", "l2", 12)');
  assert.equal(await app.status(), "SOLVED");
  const before = await app.model();
  assert.equal(before.byKind.arc, 1);

  // p2 is where l1 and l2 met, and the fillet reused it as a tangent point, so
  // it is now an endpoint of l1 *and* of the arc. All three go, and with them
  // every relation naming any of them — but p1 and p3 stay: they were the
  // drawing's points before any of this.
  const removed = removedNames(await typeAndRead('del("p2")'));
  const after = await app.model();
  assert.ok(removed.includes("p2") && removed.includes("l1") && removed.includes("a1"),
    `expected the corner, its edge and the arc, got ${JSON.stringify(removed)}`);
  assert.ok(!removed.includes("p1") && !removed.includes("p3"),
    "a curve does not take the drawing's points with it");
  assert.equal(after.byKind.arc, undefined, "the arc is gone");
  assert.ok(after.points.p1 && after.points.p3, "the neighbouring corners are not");
  assert.equal(await app.status(), "SOLVED", "and what is left still solves");
  assert.deepEqual(app.pageErrors, [], "nothing threw while rendering the remains");

  await undoKey(); // one action, one keystroke — the confirmation story
  assert.equal((await app.model()).byKind.arc, 1, "all of it came back at once");
});

test("a solve after a deletion moves nothing and produces no NaNs", async () => {
  // The deleted points' variables are still in the flat vector, referenced by
  // nothing. They have to be inert, not merely unused.
  const before = (await app.model()).points;
  await app.type('del("p6")');
  await app.type("solve()");
  const after = (await app.model()).points;
  assert.equal(await app.status(), "SOLVED");
  for (const [name, at] of Object.entries(after)) {
    assert.ok(at.every(Number.isFinite), `${name} went to ${at}`);
    if (before[name]) {
      assert.ok(Math.hypot(at[0] - before[name][0], at[1] - before[name][1]) < 1e-6,
        `${name} moved from ${before[name]} to ${at} when nothing asked it to`);
    }
  }
  await undoKey();
});

test("del of nonsense fails with a reason and changes nothing", async () => {
  const here = await saved();
  await app.type('del("r99")');
  assert.match(await app.log(), /"r99" is not an entity or a relation/);
  assert.equal(await saved(), here);
});

test("no uncaught page errors", () => {
  assert.deepEqual(app.pageErrors, []);
});
