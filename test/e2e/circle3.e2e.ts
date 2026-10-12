// The 3-point circle tool, driven by a real mouse in a real browser.
//
// The unit suite already proves the closed form and the composition. What only
// this can answer is the part between the click and the drawing: whether the
// dashed preview is genuinely *on the screen* after two clicks (a preview that
// exists only in the tool's state is not a preview), whether the whole
// three-click gesture is one Ctrl+Z rather than three, whether a click aimed at
// an existing corner really picks up the coincidence `rels()` should list, and
// whether a collinear third click refuses without throwing anything at the page.
//
// Every geometric assertion is against the closed-form circumcircle of the
// points the tool actually placed — the free-entities house standard — rather
// than against a `SOLVED` header, which a wrong circle would also earn.

import { test, before, after } from "node:test";
import assert from "node:assert/strict";
import { FIXTURE_ENTITIES, openApp, sketchFrame, type AppContext } from "./harness.ts";

/** Anything the page wrote to the console, which is where a tool's refusal goes. */
const warnings: string[] = [];

let app: AppContext;
before(async () => {
  app = await openApp();
  app.page.on("console", (m) => { if (m.type() === "warning") warnings.push(m.text()); });
});
after(async () => { await app.close(); });

/** An empty saved model — the shortest honest way back to a clean sheet. */
const EMPTY = JSON.stringify({
  format: "neocad-model", version: 1, dim: 2,
  journal: [], values: { points: {}, radii: {} },
});

/**
 * A clean sheet with a sketch frame on it — parked off-canvas, in the plane
 * every click below lands on. A circle lies in a plane, and in the 3D app the
 * tool refuses without a default frame to give it one.
 */
async function reset(): Promise<void> {
  await app.type(`open(${JSON.stringify(EMPTY)})`);
  await sketchFrame(app);
}

/** The sketch frame's own points, which are no part of what a test drew. */
const drawn = (points: Record<string, number[]>) => Object.entries(points).filter(([n]) => !n.startsWith("f_"));

async function click(sx: number, sy: number): Promise<void> {
  const at = await app.at(sx, sy);
  await app.page.mouse.move(at.x, at.y, { steps: 3 });
  await app.page.mouse.click(at.x, at.y);
  await app.page.waitForTimeout(120);
}

async function moveTo(sx: number, sy: number): Promise<void> {
  const at = await app.at(sx, sy);
  await app.page.mouse.move(at.x, at.y, { steps: 4 });
  await app.page.waitForTimeout(120);
}

/**
 * Whether the patch holds any of the amber (#e8a33d) every tool draws its
 * preview in. The ground and grid are nearly black and the geometry is pale
 * blue, so a hit here means a live preview really was rendered.
 */
function previewIn(x: number, y: number, w: number, h: number): Promise<boolean> {
  return app.page.evaluate(([px, py, pw, ph]) => {
    const cv = document.getElementById("cv") as HTMLCanvasElement;
    const dpr = cv.width / cv.getBoundingClientRect().width;
    const g = cv.getContext("2d")!;
    const d = g.getImageData(Math.round(px * dpr), Math.round(py * dpr),
      Math.max(1, Math.round(pw * dpr)), Math.max(1, Math.round(ph * dpr))).data;
    for (let i = 0; i < d.length; i += 4) {
      if (d[i] > 150 && d[i + 1] > 90 && d[i + 1] < 200 && d[i + 2] < 130) return true;
    }
    return false;
  }, [x, y, w, h]);
}

/** The circumcircle of three points, computed here so the app cannot mark its own work. */
function circumOf(a: number[], b: number[], c: number[]): { center: number[]; radius: number } {
  const bx = b[0] - a[0], by = b[1] - a[1];
  const cx = c[0] - a[0], cy = c[1] - a[1];
  const d = 2 * (bx * cy - by * cx);
  const bb = bx * bx + by * by, cc = cx * cx + cy * cy;
  const ux = (cy * bb - by * cc) / d;
  const uy = (bx * cc - cx * bb) / d;
  return { center: [a[0] + ux, a[1] + uy], radius: Math.hypot(ux, uy) };
}

// --- the gesture -----------------------------------------------------------

test("three clicks on empty canvas draw the circle through all three", async () => {
  await reset();
  await app.type("circle3");
  assert.ok((await app.log()).includes("armed: circle3"), "a bare tool name arms it, like every other tool");

  await click(240, 200);
  let m = await app.model();
  assert.equal(m.size, FIXTURE_ENTITIES, "the first click commits nothing");
  assert.equal(m.activeTool, "circle3", "and the tool stays armed — the gesture spans three clicks");

  await click(420, 180);
  m = await app.model();
  assert.equal(m.size, FIXTURE_ENTITIES, "nor does the second");
  assert.equal(m.activeTool, "circle3");

  // The dashed circumcircle through the two clicks and the cursor. The patch
  // checked is the top of that rim — worked out here in screen pixels from the
  // same closed form, and nowhere near any of the three clicks, so a hit
  // cannot be the click markers being mistaken for the circle.
  await moveTo(330, 320);
  const preview = circumOf([240, 200], [420, 180], [330, 320]);
  const [px, py] = [preview.center[0], preview.center[1] - preview.radius];
  assert.ok(await previewIn(px - 8, py - 8, 16, 16),
    `no dashed preview was drawn at (${Math.round(px)}, ${Math.round(py)}), where the rim has to pass`);

  await click(330, 320);
  await app.page.waitForTimeout(200);

  m = await app.model();
  assert.equal(m.byKind.circle, 1, "one circle");
  assert.equal(drawn(m.points).length, 4, "three rim points and the free circle's own centre");
  assert.equal(m.activeTool, null, "the gesture completed and the tool stood down");
  assert.equal(await app.status(), "SOLVED");

  // The exact claim: the circle is the circumcircle of the three points it
  // placed, to 1e-6, computed independently of the app.
  const rim = drawn(m.points).filter(([n]) => n !== m.circles[0].center).map(([, c]) => c);
  assert.equal(rim.length, 3);
  const want = circumOf(rim[0], rim[1], rim[2]);
  const centre = m.points[m.circles[0].center];
  assert.ok(Math.hypot(centre[0] - want.center[0], centre[1] - want.center[1]) < 1e-6,
    `centre ${centre}, circumcentre ${want.center}`);
  assert.ok(Math.abs(m.radii[m.circles[0].name] - want.radius) < 1e-6,
    `radius ${m.radii[m.circles[0].name]}, circumradius ${want.radius}`);

  // And it is a *composition*, not a computed circle: the three relations that
  // define it are there to be read, deleted and dragged against.
  const rels = (await app.repl("rels()")).value as string[];
  assert.equal(rels.filter((r) => r.includes("oncircle")).length, 3,
    `the three oncircles must be listed: ${JSON.stringify(rels)}`);
});

test("the whole three-click gesture is one undo step", async () => {
  await app.page.fill("#cmd", "");
  await app.page.keyboard.press("Control+z");
  await app.page.waitForTimeout(250);

  const m = await app.model();
  assert.equal(m.size, FIXTURE_ENTITIES,
    `one Ctrl+Z must take the circle, its rim points and its relations together — left ${JSON.stringify(m.byKind)}`);
  const rels = (await app.repl("rels()")).value as string[];
  assert.deepEqual(rels, [], "including the constraints the gesture added");

  // And redo puts the lot back, which is the same claim from the other side.
  await app.page.keyboard.press("Control+Shift+z");
  await app.page.waitForTimeout(250);
  assert.equal((await app.model()).byKind.circle, 1);
});

// --- what makes it compose --------------------------------------------------

test("a 3-point circle clicked through an existing point picks up the coincidence", async () => {
  await reset();
  // Two corners of a rectangle, drawn with the tool that makes them, so the
  // points clicked on below are ordinary geometry rather than a fixture.
  await app.type("rectangle");
  const a = await app.at(200, 140);
  const b = await app.at(400, 280);
  await app.page.mouse.move(a.x, a.y);
  await app.page.mouse.down();
  await app.page.mouse.move(b.x, b.y, { steps: 8 });
  await app.page.mouse.up();
  await app.page.waitForTimeout(200);

  assert.equal(drawn((await app.model()).points).length, 4, "the rectangle is there to click on");

  await app.type("circle3");
  await click(200, 140); // dead on one corner
  await click(400, 280); // dead on the opposite one
  await click(300, 380); // and one on empty canvas below
  await app.page.waitForTimeout(250);

  const m = await app.model();
  assert.equal(m.byKind.circle, 1);
  assert.equal(await app.status(), "SOLVED");

  const rels = (await app.repl("rels()")).value as string[];
  const coincidences = rels.filter((r) => r.includes("coin"));
  assert.equal(coincidences.length, 2,
    `both clicks aimed at a corner should have inferred a coincidence: ${JSON.stringify(rels)}`);

  // Not just listed — held. The two corners are on the rim to solver tolerance.
  const centre = m.points[m.circles[0].center];
  const r = m.radii[m.circles[0].name];
  for (const corner of ["p1", "p3"]) {
    const p = m.points[corner];
    assert.ok(Math.abs(Math.hypot(p[0] - centre[0], p[1] - centre[1]) - r) < 1e-6,
      `${corner} at ${p} is not on the rim (centre ${centre}, r ${r})`);
  }
});

// --- refusing what is not a circle ------------------------------------------

test("a collinear third click is refused rather than solved", async () => {
  await reset();
  await app.type("circle3");
  warnings.length = 0;

  // Three clicks on one horizontal screen row, which is one horizontal world
  // row: the view transform is affine, so straight on screen is straight in
  // the model.
  await click(240, 260);
  await click(360, 260);
  await click(500, 260);
  await app.page.waitForTimeout(200);

  const m = await app.model();
  assert.equal(m.size, FIXTURE_ENTITIES, "nothing may be built for a circle that cannot exist");
  assert.equal(m.activeTool, "circle3", "and the tool stays armed, holding the two good clicks");
  // The refusal reaches the app's own log pane — the tool-voice change moved
  // it there from console.warn, where no user would ever have seen it.
  assert.match(await app.log(), /circle3: .*lie on one line/,
    "the refusal has to say why, in the pane the user reads");
  assert.equal(warnings.length, 0, "and nothing needs the console any more");

  // The two good clicks survived, so aiming the third off the line finishes
  // the gesture that was already half done.
  await click(360, 380);
  await app.page.waitForTimeout(250);
  const after = await app.model();
  assert.equal(after.byKind.circle, 1, "a third click off the line completes it");
  assert.equal(after.activeTool, null);
  assert.equal(await app.status(), "SOLVED");
});

test("no uncaught page errors", () => {
  assert.deepEqual(app.pageErrors, []);
});
