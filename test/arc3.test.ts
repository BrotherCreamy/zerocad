// The 3-point arc tool: which of the two arcs it picks, and what it commits.
//
// The claim that needed a test more than any other is the sweep. An arc that
// passes through the two endpoints but bulges the wrong way satisfies every
// residual in the model to machine precision and is still the wrong drawing —
// exactly the class of bug the register's fillet story is about. So the sweep
// assertions here are made against `withinSweep` and `screenAngle` themselves,
// the codebase's one definition of what is *on* an arc (intersect.ts, which
// picking.ts and the snapper both sit on), rather than against a second
// opinion written for the occasion. If the tool's world-space choice and that
// screen-space definition ever disagree, these fail.
//
// What only a browser can answer — that the preview is really drawn on the
// waypoint's side, and that the whole gesture is one Ctrl+Z — is in
// test/e2e/arc3.e2e.ts.

import { test } from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { ensureKernelLoaded } from "../src/kernel/problem.ts";
import { Model } from "../src/model.ts";
import { Arc3Tool, arcThrough } from "../src/tools/arc3.ts";
import { circumcircle } from "../src/tools/circumcircle.ts";
import { screenAngle, withinSweep } from "../src/intersect.ts";
import { fix } from "../src/relations/basic.ts";
import { findSnap } from "../src/snapping.ts";
import { save, open } from "../src/persist.ts";
import { screenToWorld, worldToScreen, type View } from "../src/view.ts";
import type { PointerInfo, ToolContext } from "../src/tools/tool.ts";
import { axisFrame, tiltedFrame } from "./frames.ts";
import { curveFrame } from "../src/curveplane.ts";

async function loadKernel() {
  const bytes = await readFile(new URL("../src/kernel/wasm-gen/neocad_kernel_bg.wasm", import.meta.url));
  await ensureKernelLoaded(bytes);
}

function fakeCtx(model: Model) {
  const c = {
    model,
    options: {},
    solves: 0,
    renders: 0,
    finished: false,
    requestRender() { c.renders++; },
    requestSolve() { c.solves++; model.solve(); },
    finish() { c.finished = true; },
  };
  return c as ToolContext & typeof c;
}

const view: View = { ox: 400, oy: 300, scale: 3 };

/** A click at a world position, with whatever the engine would have snapped it to. */
function clickAt(model: Model, world: number[]): PointerInfo {
  const [sx, sy] = worldToScreen(view, world);
  const snap = findSnap(model, view, sx, sy);
  const w = snap ? snap.world : screenToWorld(view, sx, sy);
  return { world: w, screen: [sx, sy], ...(snap ? { snap } : {}) };
}

/** A click at raw world coordinates, with no snapping at all. */
const raw = (world: number[]): PointerInfo => ({ world, screen: worldToScreen(view, world) });

const opsOf = (m: Model) => m.journal.map((e) => e.op);

const arcOf = (m: Model) =>
  [...m.entities.values()].find((e) => e.kind === "arc") as
    { kind: "arc"; name: string; center: string; start: string; end: string };

/**
 * Is `world` inside the committed arc's swept side, judged the way the rest of
 * the codebase judges it: screen angles through `withinSweep`, with the view
 * transform in between. No slack — a waypoint that only makes it in on
 * picking's pixel tolerance is not the arc the user drew.
 */
function sweepHolds(model: Model, arc: { center: string; start: string; end: string }, world: number[]): boolean {
  const [cx, cy] = worldToScreen(view, model.coords(arc.center));
  const at = (name: string) => screenAngle(cx, cy, ...(worldToScreen(view, model.coords(name)) as [number, number]));
  const here = screenAngle(cx, cy, ...(worldToScreen(view, world) as [number, number]));
  return withinSweep(at(arc.start), at(arc.end), here, 0);
}

// --- which of the two arcs ---------------------------------------------------

test("arcThrough: the waypoint is inside the sweep, whichever side it is on", () => {
  const a = [0, 0], b = [10, 0];
  // Above the chord and below it: the same two endpoints, opposite bulges, and
  // the tool has to hand back the opposite start/end assignment for them.
  const above = arcThrough(a, b, [5, 4])!;
  const below = arcThrough(a, b, [5, -4])!;
  assert.ok(above && below);
  assert.notEqual(above.startIndex, below.startIndex,
    "the two bulges cannot both start at the same end — one of them is the other's complement");

  // And the circle is the same one either way it is asked, which is what makes
  // the startIndex the *entire* difference between the two arcs.
  const straight = arcThrough(a, b, [5, 4])!;
  const swapped = arcThrough(b, a, [5, 4])!;
  assert.ok(Math.hypot(straight.center[0] - swapped.center[0], straight.center[1] - swapped.center[1]) < 1e-12);
  assert.ok(Math.abs(straight.radius - swapped.radius) < 1e-12);
});

test("arcThrough: the sweep it chooses is the one intersect.ts agrees contains the waypoint", () => {
  // A ring of waypoints around a fixed chord, so both sides and both click
  // orders are covered, and every one is checked against the shared definition
  // of "on the arc" rather than against the formula that produced it.
  const chord: [number[], number[]] = [[-6, 2], [7, -3]];
  for (const flip of [false, true]) {
    const [a, b] = flip ? [chord[1], chord[0]] : chord;
    for (let t = 0; t < 16; t++) {
      const w = [Math.cos((t / 16) * Math.PI * 2) * 9 + 1, Math.sin((t / 16) * Math.PI * 2) * 9 - 1];
      const found = arcThrough(a, b, w);
      if (!found) continue; // a waypoint that happened to land on the chord
      const ends = [a, b];
      const start = ends[found.startIndex], end = ends[1 - found.startIndex];
      // Screen space, y-down, exactly as picking and intersection ask it.
      const sc = (p: number[]) => worldToScreen(view, p) as [number, number];
      const [cx, cy] = sc(found.center);
      // The waypoint is on the circle by construction, so its angle about the
      // centre is all that is left to check.
      assert.ok(
        withinSweep(screenAngle(cx, cy, ...sc(start)), screenAngle(cx, cy, ...sc(end)),
          screenAngle(cx, cy, ...sc(w)), 0),
        `waypoint ${w} (flip ${flip}) fell outside the sweep the tool chose`);
      // And not vacuously: the middle of the *other* arc between the same two
      // endpoints is outside the sweep. (The antipode of the waypoint would
      // not do — on a major arc it is swept too.)
      const ang = (p: number[]) => Math.atan2(p[1] - found.center[1], p[0] - found.center[0]);
      const span = (ang(end) - ang(start) + Math.PI * 2) % (Math.PI * 2);
      const otherMid = ang(end) + (Math.PI * 2 - span) / 2;
      const outside = [
        found.center[0] + found.radius * Math.cos(otherMid),
        found.center[1] + found.radius * Math.sin(otherMid),
      ];
      assert.ok(
        !withinSweep(screenAngle(cx, cy, ...sc(start)), screenAngle(cx, cy, ...sc(end)),
          screenAngle(cx, cy, ...sc(outside)), 0),
        `the middle of the other arc from ${w} (flip ${flip}) should not be swept`);
    }
  }
});

test("arcThrough: collinear clicks have no arc", () => {
  assert.equal(arcThrough([0, 0], [10, 0], [25, 0]), null, "a waypoint on the chord's line");
  assert.equal(arcThrough([0, 0], [10, 0], [5, 0]), null, "a waypoint on the chord itself");
  assert.equal(arcThrough([0, 0], [10, 0], [10, 0]), null, "a waypoint on an endpoint");
});

// --- the gesture -------------------------------------------------------------

test("Arc3Tool: three clicks commit one arc, two endpoints and one arcEndpoints", async () => {
  await loadKernel();
  const model = new Model(2);
  const ctx = fakeCtx(model);
  const tool = new Arc3Tool(ctx);

  tool.onDown(raw([0, 0]));
  assert.equal(model.entities.size, 0, "the first click commits nothing");
  tool.onMove(raw([4, 4]));
  tool.onDown(raw([8, 0]));
  assert.equal(model.entities.size, 0, "nor does the second — it is a live preview");
  assert.equal(ctx.finished, false, "and the tool is still armed, mid-gesture");

  tool.onDown(raw([4, 4])); // the waypoint, above the chord
  assert.equal(ctx.finished, true, "the third click ends the gesture");
  assert.equal(ctx.solves, 1, "and solves exactly once");

  const byKind = (k: string) => [...model.entities.values()].filter((e) => e.kind === k);
  assert.equal(byKind("arc").length, 1);
  // Three points: the two endpoints, plus the free arc's own centre. **Not
  // four** — the waypoint is a choice, not geometry, and Onshape does not keep
  // it either. This assertion is the whole of that decision.
  assert.equal(byKind("point").length, 3, "the waypoint must not have become a point");
  assert.equal([...model.relations.values()].filter((r) => r.op === "arcEndpoints").length, 1);

  // Seeded at the circumcircle of the three clicks, exactly.
  const arc = arcOf(model);
  const want = circumcircle([0, 0], [8, 0], [4, 4])!;
  const centre = model.coords(arc.center);
  assert.ok(Math.hypot(centre[0] - want.center[0], centre[1] - want.center[1]) < 1e-6, `centre ${centre}`);
  assert.ok(Math.abs(model.radius(arc.name) - want.radius) < 1e-6, `radius ${model.radius(arc.name)}`);

  // And it is drawn through the click that chose it.
  assert.ok(sweepHolds(model, arc, [4, 4]), "the committed arc has to sweep through the waypoint");
  assert.ok(!sweepHolds(model, arc, [4, -4]), "and not through the other side of the circle");
});

test("Arc3Tool: the same two endpoints with the waypoint below sweep the other way", async () => {
  await loadKernel();
  const model = new Model(2);
  const tool = new Arc3Tool(fakeCtx(model));
  tool.onDown(raw([0, 0]));
  tool.onDown(raw([8, 0]));
  tool.onDown(raw([4, -4])); // below the chord this time

  const arc = arcOf(model);
  assert.ok(sweepHolds(model, arc, [4, -4]), "the arc must follow the waypoint to the other side");
  assert.ok(!sweepHolds(model, arc, [4, 4]));
  // Both clicks are still endpoints; only which one is called `start` moved.
  const ends = new Set([arc.start, arc.end]);
  assert.equal(ends.size, 2);
  for (const p of [[0, 0], [8, 0]]) {
    assert.ok([...ends].some((n) => Math.hypot(model.coords(n)[0] - p[0], model.coords(n)[1] - p[1]) < 1e-9),
      `${p} should still be one of the arc's ends`);
  }
});

test("Arc3Tool: it journals as the calls a user could have typed, and reopens identically", async () => {
  await loadKernel();
  const model = new Model(2);
  const tool = new Arc3Tool(fakeCtx(model));
  tool.onDown(raw([-20, 5]));
  tool.onDown(raw([14, -3]));
  tool.onDown(raw([2, 26]));

  // No new journal op was needed for this tool, which is the evidence that it
  // is a composition and not a new kind of thing: every one of these was
  // already in persist.ts's replay table before it was written.
  assert.deepEqual(opsOf(model), [
    "addPoint", "addPoint", // the two endpoints
    "addArc", "setCoords", // the free arc, its centre seeded at the answer
    "arcEndpoints", // and the one relation that makes it an arc
  ]);
  // Journalled as *free*: a null centre, so a replay makes the centre point
  // itself rather than seeing a stray point it cannot account for.
  const addArc = model.journal.find((e) => e.op === "addArc")!;
  assert.equal(addArc.args[0], null, `the centre argument must be null: ${JSON.stringify(addArc.args)}`);

  const text = save(model, false);
  const reopened = open(text);
  assert.equal(save(reopened, false), text, "a gesture must survive save/open byte for byte");
  assert.equal(reopened.relations.size, model.relations.size);
  // The reopened arc sweeps the same way — the start/end assignment is in the
  // journal, so it cannot come back the other way round.
  const a = arcOf(model), b = arcOf(reopened);
  assert.deepEqual(
    [model.coords(a.start), model.coords(a.end)],
    [reopened.coords(b.start), reopened.coords(b.end)]);
});

test("Arc3Tool: the endpoints hold the arc, and the bulge is deliberately free", async () => {
  await loadKernel();
  const model = new Model(2);
  const tool = new Arc3Tool(fakeCtx(model));
  tool.onDown(raw([0, 0]));
  tool.onDown(raw([8, 0]));
  tool.onDown(raw([4, 4]));

  const arc = arcOf(model);
  const ends = [arc.start, arc.end];
  // The frame goes in after the clicks, so it snapped to nothing.
  axisFrame(model);
  // Move one end and pin both: `arcEndpoints` has to drag the circle along,
  // because it is the only thing tying the arc to its endpoints at all.
  model.setCoords(ends[0], model.coords(ends[0]).map((v, i) => v + (i === 1 ? 6 : 2)));
  for (const n of ends) fix(model, n, model.coords(n));
  const report = model.solve();
  assert.equal(report.solved, true, JSON.stringify(report.offenders));

  const centre = model.coords(arc.center);
  const r = model.radius(arc.name);
  for (const n of ends) {
    const p = model.coords(n);
    assert.ok(Math.abs(Math.hypot(p[0] - centre[0], p[1] - centre[1]) - r) < 1e-6,
      `${n} at ${p} came off the rim: centre ${centre}, r ${r}`);
  }

  // And the documented limitation, asserted rather than merely written down.
  // Two endpoints, a centre and a radius are seven unknowns against
  // `arcEndpoints`' two equations, so the *bulge* is free on purpose — tools
  // do not dimension what they draw. Shove the centre along the endpoints'
  // perpendicular bisector and the system is just as satisfied as before, at a
  // visibly different radius: that spare degree of freedom is the waypoint's
  // absence, and it is a decision rather than an oversight.
  const wasR = model.radius(arc.name);
  const [e0, e1] = ends.map((n) => model.coords(n));
  const mid = [(e0[0] + e1[0]) / 2, (e0[1] + e1[1]) / 2];
  const perp = [-(e1[1] - e0[1]), e1[0] - e0[0]];
  const scale = 3 / Math.hypot(perp[0], perp[1]);
  model.setCoords(arc.center, [mid[0] + perp[0] * scale, mid[1] + perp[1] * scale]);
  assert.equal(model.solve().solved, true, "the shoved arc is still a solved system");
  assert.ok(Math.abs(model.radius(arc.name) - wasR) > 1e-3,
    `the bulge should have been free to move: r went ${wasR} -> ${model.radius(arc.name)}`);
  for (const n of ends) {
    const p = model.coords(n);
    const c = model.coords(arc.center);
    assert.ok(Math.abs(Math.hypot(p[0] - c[0], p[1] - c[1]) - model.radius(arc.name)) < 1e-6,
      "and the endpoints are still on the rim, which is the part that is not free");
  }
});

// --- refusing what is not an arc ---------------------------------------------

test("Arc3Tool: a collinear third click is refused, and the gesture stays live", async () => {
  await loadKernel();
  const model = new Model(2);
  const ctx = fakeCtx(model);
  const tool = new Arc3Tool(ctx);

  tool.onDown(raw([0, 0]));
  tool.onDown(raw([10, 0]));
  tool.onDown(raw([25, 0])); // dead on the line through the two endpoints

  assert.equal(model.entities.size, 0, "nothing may be built for an arc that cannot exist");
  assert.equal(model.relations.size, 0);
  assert.equal(ctx.finished, false, "and the tool stays armed rather than dropping the gesture");
  assert.equal(ctx.solves, 0, "there is nothing to solve, so nothing was solved");

  // The two endpoints are still held, so aiming the waypoint off the line
  // finishes the gesture that was already half done.
  tool.onDown(raw([5, 8]));
  assert.equal(ctx.finished, true);
  const arc = arcOf(model);
  const want = circumcircle([0, 0], [10, 0], [5, 8])!;
  assert.ok(Math.abs(model.radius(arc.name) - want.radius) < 1e-6);
});

test("Arc3Tool: the collinear refusal reaches the log pane when there is one", async () => {
  await loadKernel();
  const model = new Model(2);
  const ctx = fakeCtx(model) as ReturnType<typeof fakeCtx> & { log(l: string): void; lines: string[] };
  ctx.lines = [];
  ctx.log = (l: string) => ctx.lines.push(l);
  const tool = new Arc3Tool(ctx);

  tool.onDown(raw([0, 0]));
  tool.onDown(raw([10, 0]));
  tool.onDown(raw([25, 0]));
  assert.equal(ctx.lines.length, 1);
  assert.match(ctx.lines[0], /arc3: .*lie on one line/);
});

test("Arc3Tool: a second click on top of the first is a double-click, not an endpoint", async () => {
  await loadKernel();
  const model = new Model(2);
  const ctx = fakeCtx(model);
  const tool = new Arc3Tool(ctx);

  tool.onDown(raw([3, 3]));
  tool.onDown(raw([3, 3])); // swallowed: an arc needs two different ends
  assert.equal(model.entities.size, 0);
  tool.onDown(raw([11, 3])); // so *this* is the second endpoint, not the waypoint
  assert.equal(ctx.finished, false, "the gesture still wants its waypoint");
  tool.onDown(raw([7, 6]));
  assert.equal(ctx.finished, true);
  assert.equal([...model.entities.values()].filter((e) => e.kind === "point").length, 3);
});

test("Arc3Tool: a near-collinear commit is the user's to make, and goes through", async () => {
  await loadKernel();
  const model = new Model(2);
  const ctx = fakeCtx(model);
  const tool = new Arc3Tool(ctx);
  tool.onDown(raw([0, 0]));
  tool.onDown(raw([10, 0]));
  tool.onDown(raw([5, 1e-4])); // visibly straight, mathematically not

  assert.equal(ctx.finished, true, "a very flat arc is still an arc");
  assert.ok(model.radius(arcOf(model).name) > 1e5, `radius ${model.radius(arcOf(model).name)}`);
});

test("Arc3Tool: cancelling forgets the clicks so far", async () => {
  await loadKernel();
  const model = new Model(2);
  const ctx = fakeCtx(model);
  const tool = new Arc3Tool(ctx);
  tool.onDown(raw([0, 0]));
  tool.onDown(raw([8, 0]));
  tool.onCancel();
  // Three fresh clicks, not one: the two before the cancel are gone.
  tool.onDown(raw([0, 0]));
  tool.onDown(raw([8, 0]));
  assert.equal(model.entities.size, 0, "the cancelled clicks must not count toward the next gesture");
  tool.onDown(raw([4, 4]));
  assert.equal(ctx.finished, true);
});

test("Arc3Tool in 3D: the arc is in the clicks' plane, through the waypoint, held on the sketch", async () => {
  await loadKernel();
  const model = new Model(3);
  const f = tiltedFrame(model);
  const plane = { origin: f.origin, u: f.ux, v: f.uy };
  const ctx = fakeCtx(model);
  const tool = new Arc3Tool(ctx);
  // Ends at (−10, 0) and (10, 0) in the frame, waypoint *below* them at (0, −6):
  // in frame coordinates this is the lower arc, whichever way the plane faces.
  const click = (u: number, v: number): PointerInfo => ({ world: f.at(u, v), screen: [0, 0], plane });
  tool.onDown(click(-10, 0));
  tool.onDown(click(10, 0));
  tool.onDown(click(0, -6));
  assert.equal(ctx.finished, true);

  const arc = arcOf(model);
  const c = model.coords(arc.center);
  // The circumcircle in the plane: centre on the frame's y axis, at v where
  // 10² + v² = (v + 6)², i.e. v = 16/3 — above the chord, the waypoint below.
  const expected = f.at(0, 16 / 3);
  assert.ok(Math.hypot(...c.map((v, i) => v - expected[i])) < 1e-9, `centre at ${c}, expected ${expected}`);

  // The arc the renderer will draw — laid out by the same rule — goes through
  // the waypoint, not round the other side.
  const af = curveFrame(model, model.arc(arc.name))!;
  const w = f.at(0, -6);
  const d = w.map((v, i) => v - af.center[i]);
  let t = Math.atan2(d.reduce((s, x, i) => s + x * af.v[i], 0), d.reduce((s, x, i) => s + x * af.u[i], 0));
  if (t < 0) t += 2 * Math.PI;
  assert.ok(t < af.sweep, `the waypoint is ${t} round a ${af.sweep} sweep — the other arc was drawn`);

  // Endpoints and centre are all held on the sketch plane.
  const held = model.journal.filter((e) => e.op === "onPlane").map((e) => e.args[0]);
  assert.deepEqual(held.sort(), [arc.start, arc.end, arc.center].sort());
  assert.equal(model.solve().solved, true);
});

// --- snapping and inference, which is what makes it compose ------------------

test("Arc3Tool: an endpoint clicked on an existing point is coincident with it", async () => {
  await loadKernel();
  const model = new Model(2);
  model.addPoint([0, 0], "a");
  model.addPoint([8, 0], "b");

  const ctx = fakeCtx(model);
  const tool = new Arc3Tool(ctx);
  tool.onDown(clickAt(model, [0, 0])); // straight onto a
  tool.onDown(clickAt(model, [8, 0])); // straight onto b
  tool.onDown(raw([4, 4])); // and a waypoint on empty canvas

  // Pinned after the clicks, so the fixture frame's origin — which also sits
  // at (0,0) — is not there to compete with `a` for the first snap.
  axisFrame(model);
  fix(model, "a", [0, 0]);
  fix(model, "b", [8, 0]);

  const coincidences = [...model.relations.values()].filter((r) => r.op === "coincident");
  assert.equal(coincidences.length, 2,
    `both snapped clicks should have inferred a coincidence: ${JSON.stringify(
      [...model.relations.values()].map((r) => `${r.op}(${r.args.join(",")})`))}`);
  assert.ok(coincidences.some((r) => r.args.includes("a")));
  assert.ok(coincidences.some((r) => r.args.includes("b")));

  // The arc really does end on the two corners it was drawn from — the "an arc
  // from this corner to that one is three clicks" case the tool exists for.
  assert.equal(model.solve().solved, true);
  const arc = arcOf(model);
  const centre = model.coords(arc.center);
  const r = model.radius(arc.name);
  for (const p of [[0, 0], [8, 0]]) {
    assert.ok(Math.abs(Math.hypot(p[0] - centre[0], p[1] - centre[1]) - r) < 1e-6,
      `${p} is not on the rim: centre ${centre}, r ${r}`);
  }
  // The waypoint added nothing at all to the model — no point, no relation.
  assert.equal([...model.entities.values()].filter((e) => e.kind === "point" && !["a", "b"].includes(e.name)).length,
    5, "two endpoints, the arc's centre, and the fixture frame's two points");
});
