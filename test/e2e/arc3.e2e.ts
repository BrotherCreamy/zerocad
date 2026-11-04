// The 3-point arc, driven by a real mouse in a real browser. Since
// docs/plans/one-circle-one-arc.md it is the one arc tool locked to three
// points — `arc3` typed arms exactly that — and every claim below is kept, of
// it; the tool armed is named `arc`.
//
// The unit suite already proves the sweep choice and the composition. What
// only this can answer is the part between the click and the drawing: whether
// the dashed preview is genuinely on the screen after two clicks *and on the
// waypoint's side of the chord* (an arc that previews the wrong way round is
// the fillet bug all over again — every number right, the picture wrong),
// whether the three-click gesture is one Ctrl+Z rather than three, whether an
// endpoint aimed at an existing corner picks up the coincidence `rels()`
// should list, and whether a collinear third click refuses without throwing
// anything at the page.
//
// Every geometric assertion is against the closed-form circumcircle of the
// points the tool actually placed and the waypoint that was clicked, computed
// here so the app cannot mark its own work.

import { test, before, after } from "node:test";
import assert from "node:assert/strict";
import { FIXTURE_ENTITIES, FIXTURE_JOURNAL, openApp, sketchFrame, type AppContext } from "./harness.ts";

/** Anything the page wrote to the console, which is where a tool's refusal went before the log pane. */
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
 * every click below lands on. An arc lies in a plane, and in the 3D app the
 * tool refuses without a default frame to give it one.
 */
async function reset(): Promise<void> {
  await app.type(`open(${JSON.stringify(EMPTY)})`);
  await sketchFrame(app);
}

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
 * preview in. The ground is nearly black and the geometry pale blue, so a hit
 * here means a live preview really was rendered.
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

/**
 * Canvas coordinates to world, through the app's own view — which the model
 * summary hands over, so this is the same transform the click went through
 * rather than a guess at it.
 */
function toWorld(view: { ox: number; oy: number; scale: number }, sx: number, sy: number): number[] {
  return [(sx - view.ox) / view.scale, (view.oy - sy) / view.scale];
}

/**
 * Is `p` inside the arc's swept side? World coordinates and the world-space
 * CCW convention main.ts draws with, written out here so the app is not asked
 * to confirm its own convention.
 */
function swept(centre: number[], start: number[], end: number[], p: number[]): boolean {
  const ang = (q: number[]) => Math.atan2(q[1] - centre[1], q[0] - centre[0]);
  const ccw = (from: number, to: number) => ((to - from) % (Math.PI * 2) + Math.PI * 2) % (Math.PI * 2);
  return ccw(ang(start), ang(p)) <= ccw(ang(start), ang(end));
}

/**
 * The point halfway along the sweep — the top of the bulge, which is the part
 * of the drawing a person actually looks at to see which way round the arc
 * went. Which side of the chord the *centre* falls on is not that: an arc more
 * than half the circle has its centre on the same side as its bulge and an arc
 * less than half has it on the other, so a test written about the centre asks
 * a question whose answer flips with the sagitta.
 */
function bulge(centre: number[], start: number[], end: number[], radius: number): number[] {
  const ang = (q: number[]) => Math.atan2(q[1] - centre[1], q[0] - centre[0]);
  const span = ((ang(end) - ang(start)) % (Math.PI * 2) + Math.PI * 2) % (Math.PI * 2);
  const mid = ang(start) + span / 2;
  return [centre[0] + radius * Math.cos(mid), centre[1] + radius * Math.sin(mid)];
}

// --- the gesture -------------------------------------------------------------

test("three clicks draw the arc through the two ends and the waypoint", async () => {
  await reset();
  await app.type("arc3");
  assert.ok((await app.log()).includes("armed: arc3"), "a bare tool name arms it, like every other tool");

  await click(240, 300); // endpoint
  let m = await app.model();
  assert.equal(m.size, FIXTURE_ENTITIES, "the first click commits nothing");
  assert.equal(m.activeTool, "arc", "and the tool stays armed — the gesture spans three clicks");

  await click(460, 300); // the other endpoint
  m = await app.model();
  assert.equal(m.size, FIXTURE_ENTITIES, "nor does the second");
  assert.equal(m.activeTool, "arc");

  // The dashed arc through the two clicks and the cursor, bulging *upward*
  // because the cursor is above the chord. Screen y grows downward, so the top
  // of the preview is at centre_y - radius. Checked well away from all three
  // clicks, so a hit cannot be a click marker mistaken for the arc.
  await moveTo(300, 210);
  const preview = circumOf([240, 300], [460, 300], [300, 210]);
  const [px, py] = [preview.center[0], preview.center[1] - preview.radius];
  assert.ok(await previewIn(px - 8, py - 8, 16, 16),
    `no dashed preview above the chord at (${Math.round(px)}, ${Math.round(py)})`);
  // And nothing on the far side: the preview shows *an* arc, not the circle.
  assert.ok(!(await previewIn(preview.center[0] - 8, preview.center[1] + preview.radius - 8, 16, 16)),
    "the preview drew the whole circle — the third click chooses one arc of it, not both");

  await click(300, 210);
  await app.page.waitForTimeout(200);

  m = await app.model();
  assert.equal(m.byKind.arc, 1, "one arc");
  // Three points, not four: the waypoint is a choice, not geometry. Onshape
  // does not keep it and neither does this.
  assert.equal(m.byKind.point - 3, 3, "two endpoints and the free arc's own centre — the waypoint is not kept");
  assert.equal(m.activeTool, null, "the gesture completed and the tool stood down");
  assert.equal(await app.status(), "SOLVED");
  // After the sketch frame's own entries: each placed point held on the sketch
  // plane, and the arc's centre with them — and the arc's own normal held to
  // the frame's +z by a `par`, since an arc carries its own normal and names no
  // frame (docs/plans/frameless-curves.md).
  assert.deepEqual(m.journalOps.slice(FIXTURE_JOURNAL),
    ["addPoint", "onPlane", "addPoint", "onPlane", "addArc", "setCoords", "onPlane", "parallel", "arcEndpoints"],
    "no new journal op was needed, which is what makes this a composition");

  // The exact claim: the arc is seeded at the circumcircle of the two points
  // it placed and the waypoint that was clicked, to 1e-6, computed here.
  const arc = m.arcs[0];
  const [start, end] = [m.points[arc.start], m.points[arc.end]];
  const centre = m.points[arc.center];
  const waypoint = toWorld(m.view, 300, 210);
  const want = circumOf(start, end, waypoint);
  assert.ok(Math.hypot(centre[0] - want.center[0], centre[1] - want.center[1]) < 1e-6,
    `centre ${centre}, circumcentre ${want.center}`);
  assert.ok(Math.abs(m.radii[arc.name] - want.radius) < 1e-6,
    `radius ${m.radii[arc.name]}, circumradius ${want.radius}`);

  // And — the assertion the picture is about — the sweep goes the waypoint's
  // way round, not the other.
  assert.ok(swept(centre, start, end, waypoint), `the arc does not sweep through the waypoint ${waypoint}`);
  const top = bulge(centre, start, end, m.radii[arc.name]);
  assert.ok(top[1] > start[1],
    `the arc bulges to y=${top[1]}, which is not above the chord at y=${start[1]}`);
  const other = [2 * centre[0] - waypoint[0], 2 * centre[1] - waypoint[1]];
  assert.ok(!swept(centre, start, end, other), "and it is one arc of the circle, not the whole of it");

  // The relation that makes it an arc rather than three loose numbers is there
  // to be read, deleted and dragged against.
  const rels = (await app.repl("rels()")).value as string[];
  assert.equal(rels.filter((r) => r.includes("arcends")).length, 1,
    `arcEndpoints must be listed: ${JSON.stringify(rels)}`);
});

test("the whole three-click gesture is one undo step", async () => {
  await app.page.fill("#cmd", "");
  await app.page.keyboard.press("Control+z");
  await app.page.waitForTimeout(250);

  const m = await app.model();
  assert.equal(m.size, FIXTURE_ENTITIES,
    `one Ctrl+Z must take the arc, its endpoints and its centre together — left ${JSON.stringify(m.byKind)}`);
  const rels = (await app.repl("rels()")).value as string[];
  assert.deepEqual(rels, [], "including the relation the gesture added");

  // And redo puts the lot back, which is the same claim from the other side.
  await app.page.keyboard.press("Control+Shift+z");
  await app.page.waitForTimeout(250);
  assert.equal((await app.model()).byKind.arc, 1);
});

test("clicking the waypoint below the chord bulges the arc the other way", async () => {
  await reset();
  await app.type("arc3");
  await click(240, 300);
  await click(460, 300);
  await moveTo(300, 420);
  // The bottom of the preview, on the cursor's side of the chord.
  const preview = circumOf([240, 300], [460, 300], [300, 420]);
  assert.ok(await previewIn(preview.center[0] - 8, preview.center[1] + preview.radius - 8, 16, 16),
    "the preview must follow the cursor to the other side of the chord");

  await click(300, 420);
  await app.page.waitForTimeout(200);
  const m = await app.model();
  const arc = m.arcs[0];
  const [start, end, centre] = [m.points[arc.start], m.points[arc.end], m.points[arc.center]];
  const waypoint = toWorld(m.view, 300, 420);
  assert.ok(swept(centre, start, end, waypoint), "the committed arc must sweep through the lower waypoint");
  // World y grows upward, so a waypoint below the chord on screen is below it
  // in world, and the bulge has to follow it there.
  const top = bulge(centre, start, end, m.radii[arc.name]);
  assert.ok(top[1] < start[1],
    `the arc bulges to y=${top[1]}, which is not below the chord at y=${start[1]}`);
});

// --- what makes it compose ---------------------------------------------------

test("an endpoint clicked on an existing corner picks up the coincidence", async () => {
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
  assert.equal((await app.model()).byKind.point - 3, 4, "the rectangle is there to click on");

  await app.type("arc3");
  await click(200, 140); // dead on one corner
  await click(400, 280); // dead on the opposite one
  await click(430, 120); // and a waypoint on empty canvas
  await app.page.waitForTimeout(250);

  const m = await app.model();
  assert.equal(m.byKind.arc, 1);
  assert.equal(await app.status(), "SOLVED");

  const rels = (await app.repl("rels()")).value as string[];
  const coincidences = rels.filter((r) => r.includes("coin"));
  assert.equal(coincidences.length, 2,
    `both clicks aimed at a corner should have inferred a coincidence: ${JSON.stringify(rels)}`);

  // Not just listed — held. The two corners are on the rim to solver tolerance.
  const arc = m.arcs[0];
  const centre = m.points[arc.center];
  const r = m.radii[arc.name];
  for (const corner of ["p1", "p3"]) {
    const p = m.points[corner];
    assert.ok(Math.abs(Math.hypot(p[0] - centre[0], p[1] - centre[1]) - r) < 1e-6,
      `${corner} at ${p} is not on the rim (centre ${centre}, r ${r})`);
  }
});

// --- refusing what is not an arc ---------------------------------------------

test("a collinear third click is refused rather than solved", async () => {
  await reset();
  await app.type("arc3");
  warnings.length = 0;

  // Three clicks on one horizontal screen row, which is one horizontal world
  // row: the view transform is affine, so straight on screen is straight in
  // the model.
  await click(240, 260);
  await click(360, 260);
  await click(500, 260);
  await app.page.waitForTimeout(200);

  const m = await app.model();
  assert.equal(m.size, FIXTURE_ENTITIES, "nothing may be built for an arc that cannot exist");
  assert.equal(m.activeTool, "arc", "and the tool stays armed, holding the two endpoints");
  assert.match(await app.log(), /arc: those three are on one line — click the third off it/,
    "the refusal has to say why, in the pane the user reads");
  assert.equal(warnings.length, 0, "and nothing needs the console");

  // The two endpoints survived, so aiming the waypoint off the line finishes
  // the gesture that was already half done.
  await click(360, 380);
  await app.page.waitForTimeout(250);
  const after = await app.model();
  assert.equal(after.byKind.arc, 1, "a waypoint off the line completes it");
  assert.equal(after.activeTool, null);
  assert.equal(await app.status(), "SOLVED");
});

test("no uncaught page errors", () => {
  assert.deepEqual(app.pageErrors, []);
});
