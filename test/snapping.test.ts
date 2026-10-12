import { test } from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { ensureKernelLoaded } from "../src/kernel/problem.ts";
import { Model } from "../src/model.ts";
import { findSnap, describeSnap, SNAP_POINT } from "../src/snapping.ts";
import { worldToScreen, type View } from "../src/view.ts";

async function loadKernel() {
  const bytes = await readFile(new URL("../src/kernel/wasm-gen/neocad_kernel_bg.wasm", import.meta.url));
  await ensureKernelLoaded(bytes);
}

const view: View = { ox: 400, oy: 300, scale: 3 };
const at = (w: number[]) => worldToScreen(view, w);
const near = (a: number[], b: number[], tol = 1e-6) =>
  Math.abs(a[0] - b[0]) < tol && Math.abs(a[1] - b[1]) < tol;

test("snaps to an existing point, exactly", async () => {
  const m = new Model(2);
  m.addPoint([10, 20], "a");
  const [sx, sy] = at([10, 20]);
  const snap = findSnap(m, view, sx + 3, sy - 2);
  assert.equal(snap?.kind, "point");
  assert.equal(snap?.targets[0], "a");
  assert.ok(near(snap!.world, [10, 20]), `expected exactly (10,20), got ${snap!.world}`);
});

test("returns nothing when there is nothing near", async () => {
  const m = new Model(2);
  m.addPoint([10, 20], "a");
  const [sx, sy] = at([10, 20]);
  assert.equal(findSnap(m, view, sx + 60, sy + 60), null);
});

test("snaps to the middle of an edge", async () => {
  const m = new Model(2);
  m.addPoint([0, 0], "a");
  m.addPoint([40, 0], "b");
  m.addLine("a", "b", "l");
  const [sx, sy] = at([20, 0]);
  const snap = findSnap(m, view, sx + 2, sy + 2);
  assert.equal(snap?.kind, "midpoint");
  assert.equal(snap?.targets[0], "l");
  assert.ok(near(snap!.world, [20, 0]), `got ${snap!.world}`);
});

test("an endpoint wins over the edge it belongs to", async () => {
  const m = new Model(2);
  m.addPoint([0, 0], "a");
  m.addPoint([40, 0], "b");
  m.addLine("a", "b", "l");
  const [sx, sy] = at([0, 0]);
  const snap = findSnap(m, view, sx + 2, sy);
  assert.equal(snap?.kind, "point", "an exact point beats a point merely on the line");
  assert.equal(snap?.targets[0], "a");
});

test("a midpoint wins over the same edge's length", async () => {
  const m = new Model(2);
  m.addPoint([0, 0], "a");
  m.addPoint([40, 0], "b");
  m.addLine("a", "b", "l");
  const [sx, sy] = at([20, 0]);
  const snap = findSnap(m, view, sx, sy + 3);
  assert.equal(snap?.kind, "midpoint");
});

test("snaps onto a line's length away from its middle", async () => {
  const m = new Model(2);
  m.addPoint([0, 0], "a");
  m.addPoint([40, 0], "b");
  m.addLine("a", "b", "l");
  const [sx, sy] = at([32, 0]);
  const snap = findSnap(m, view, sx, sy + 3);
  assert.equal(snap?.kind, "curve");
  assert.ok(Math.abs(snap!.world[1]) < 1e-6, "pulled onto the line");
  assert.ok(Math.abs(snap!.world[0] - 32) < 1e-6, "and along it, where the cursor was");
});

test("snaps onto a circle's rim", async () => {
  await loadKernel();
  const m = new Model(2);
  m.addPoint([0, 0], "ctr");
  m.addCircle("ctr", 30, null, "c");
  const [sx, sy] = at([30, 0]);
  const snap = findSnap(m, view, sx + 3, sy);
  assert.equal(snap?.kind, "curve");
  assert.equal(snap?.targets[0], "c");
  assert.ok(Math.abs(Math.hypot(...snap!.world) - 30) < 1e-6, `radius ${Math.hypot(...snap!.world)}`);
});

test("the snap radius is in screen pixels, so it survives zooming", async () => {
  const m = new Model(2);
  m.addPoint([100, 100], "a");
  for (const scale of [0.5, 3, 40]) {
    const v: View = { ox: 400, oy: 300, scale };
    const [sx, sy] = worldToScreen(v, [100, 100]);
    assert.ok(findSnap(m, v, sx + SNAP_POINT - 2, sy), `inside the radius at scale ${scale}`);
    assert.equal(findSnap(m, v, sx + SNAP_POINT + 4, sy), null, `outside it at scale ${scale}`);
  }
});

test("snapping never changes the model", async () => {
  const m = new Model(2);
  m.addPoint([10, 20], "a");
  const before = m.entities.size;
  const [sx, sy] = at([10, 20]);
  findSnap(m, view, sx, sy);
  assert.equal(m.entities.size, before, "a snap moves the cursor, it does not build anything");
  assert.deepEqual(m.coords("a"), [10, 20], "and does not move what it snapped to");
});

test("describeSnap says what was caught and how", async () => {
  assert.equal(describeSnap({ world: [], screen: [0, 0], kind: "point", targets: ["p1"] }), "p1");
  assert.equal(describeSnap({ world: [], screen: [0, 0], kind: "midpoint", targets: ["l1"] }), "mid l1");
  assert.equal(describeSnap({ world: [], screen: [0, 0], kind: "curve", targets: ["c1"] }), "on c1");
  assert.equal(describeSnap({ world: [], screen: [0, 0], kind: "intersection", targets: ["l1", "c2"] }),
    "l1 × c2", "both curves, because both are what it means");
});

// --- intersections ----------------------------------------------------------
//
// The tier between exact points and midpoints. What is being checked is mostly
// *ordering* — the maths itself lives in intersect.test.ts — plus the one
// property the maths cannot have on its own: that the snap carries both names.

/** A horizontal edge, a vertical edge crossing it at (20, 0), and a circle. */
function crossingScene() {
  const m = new Model(2);
  m.addPoint([-40, 0], "ha"); m.addPoint([60, 0], "hb"); m.addLine("ha", "hb", "h");
  // Deliberately *not* centred on the crossing: its midpoint is (20, 4), four
  // world units — twelve screen pixels — above it, so the two tiers can be
  // put in genuine competition below.
  m.addPoint([20, -40], "va"); m.addPoint([20, 48], "vb"); m.addLine("va", "vb", "v");
  return m;
}

test("two crossing edges snap to their crossing, carrying both names", async () => {
  const m = crossingScene();
  const [sx, sy] = at([20, 0]);
  const snap = findSnap(m, view, sx + 2, sy + 2);
  assert.equal(snap?.kind, "intersection");
  assert.deepEqual([...snap!.targets].sort(), ["h", "v"]);
  assert.ok(near(snap!.world, [20, 0]), `expected exactly (20,0), got ${snap!.world}`);
});

test("a crossing beats a midpoint that is nearer to the cursor", async () => {
  const m = crossingScene();
  const [cx, cy] = at([20, 0]);   // the crossing
  const [mx, my] = at([20, 4]);   // the vertical edge's middle, 12px above it
  const cursor: [number, number] = [cx, cy - 7];
  assert.equal(Math.hypot(mx - cursor[0], my - cursor[1]), 5, "the midpoint really is the nearer of the two");
  const snap = findSnap(m, view, ...cursor);
  assert.equal(snap?.kind, "intersection", "a place both curves agree on beats a property of one");
});

test("an existing point still beats a crossing", async () => {
  const m = crossingScene();
  m.addPoint([20.5, 0.5], "here");
  const [sx, sy] = at([20, 0]);
  const snap = findSnap(m, view, sx, sy);
  assert.equal(snap?.kind, "point", "the thing itself beats a place computed from two curves");
  assert.equal(snap?.targets[0], "here");
});

test("a crossing beats merely being along one of the curves", async () => {
  const m = crossingScene();
  const [sx, sy] = at([20, 0]);
  // 5px off along the horizontal edge — without the tier this is a "curve" snap.
  assert.equal(findSnap(m, view, sx + 5, sy)?.kind, "intersection");
  // 20px away it is back to being just a point on the edge.
  assert.equal(findSnap(m, view, sx + 20, sy)?.kind, "curve");
});

test("parallel edges produce no crossing to snap to", async () => {
  const m = new Model(2);
  m.addPoint([-40, 0], "a"); m.addPoint([60, 0], "b"); m.addLine("a", "b", "l1");
  m.addPoint([-40, 1], "c"); m.addPoint([60, 1], "d"); m.addLine("c", "d", "l2");
  const [sx, sy] = at([10, 0.5]);
  const snap = findSnap(m, view, sx, sy);
  assert.notEqual(snap?.kind, "intersection", `got ${JSON.stringify(snap)}`);
});

test("a line crossing a circle snaps to the rim crossing", async () => {
  await loadKernel();
  const m = new Model(2);
  m.addPoint([0, 0], "ctr"); m.addCircle("ctr", 30, null, "c");
  m.addPoint([-50, 0], "a"); m.addPoint([50, 0], "b"); m.addLine("a", "b", "l");
  const [sx, sy] = at([30, 0]);
  const snap = findSnap(m, view, sx + 2, sy - 2);
  assert.equal(snap?.kind, "intersection");
  assert.deepEqual([...snap!.targets].sort(), ["c", "l"]);
  assert.ok(near(snap!.world, [30, 0]), `expected exactly (30,0), got ${snap!.world}`);
});

test("a tangent line is not a crossing", async () => {
  await loadKernel();
  const m = new Model(2);
  m.addPoint([0, 0], "ctr"); m.addCircle("ctr", 30, null, "c");
  // Tangent at (0, 30). The segment runs off-centre so its own midpoint is
  // nowhere near, leaving the tangency as the only thing that could be caught.
  m.addPoint([-50, 30], "a"); m.addPoint([60, 30], "b"); m.addLine("a", "b", "l");
  const [sx, sy] = at([0, 30]);
  const snap = findSnap(m, view, sx, sy + 1);
  assert.equal(snap?.kind, "curve", `a touch is not a crossing; got ${JSON.stringify(snap)}`);
});

test("an arc only crosses within its own sweep", async () => {
  await loadKernel();
  const q = 30 / Math.SQRT2; // 21.213…, where x = y on a circle of radius 30

  // A quarter arc from (30,0) round to (0,30) — the top-right quadrant — and a
  // vertical edge at x, crossing the arc's *circle* at (x, ±|q|) either way.
  const scene = (x: number) => {
    const m = new Model(2);
    m.addPoint([0, 0], "ctr"); m.addPoint([30, 0], "s"); m.addPoint([0, 30], "e");
    m.addArc("ctr", "s", "e", 30, null, "arc");
    m.addPoint([x, -50], "a"); m.addPoint([x, 50], "b"); m.addLine("a", "b", "l");
    return m;
  };

  const missed = at([-q, q]);
  assert.notEqual(findSnap(scene(-q), view, ...missed)?.kind, "intersection",
    "the circle is cut on the left, but the arc does not go there");

  const hit = at([q, q]);
  const snap = findSnap(scene(q), view, hit[0] + 2, hit[1]);
  assert.equal(snap?.kind, "intersection", `got ${JSON.stringify(snap)}`);
  assert.deepEqual([...snap!.targets].sort(), ["arc", "l"]);
  assert.ok(near(snap!.world, [q, q]), `got ${snap!.world}`);
});
