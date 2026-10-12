// Entities defined by constraints, not constructors: every constructor
// argument is optional, whatever is missing is auto-created free with a
// non-degenerate seed, and the constructor journals as the one call that was
// made (never its expansion). See docs/plans/free-entities.md.
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { ensureKernelLoaded } from "../src/kernel/problem.ts";
import { Model } from "../src/model.ts";
import { fix } from "../src/relations/basic.ts";
import { onCircle, radius, tangent } from "../src/relations/geometry.ts";
import { del } from "../src/operations.ts";
import { save, open } from "../src/persist.ts";
import { neocadScope } from "../src/replenv.ts";
import { axisFrame } from "./frames.ts";

async function loadKernel() {
  const bytes = await readFile(new URL("../src/kernel/wasm-gen/neocad_kernel_bg.wasm", import.meta.url));
  await ensureKernelLoaded(bytes);
}

test("addPoint() with no coords seeds at the origin, in any dimension", () => {
  const m2 = new Model(2);
  assert.deepEqual(m2.coords(m2.addPoint().name), [0, 0]);
  const m3 = new Model(3);
  assert.deepEqual(m3.coords(m3.addPoint().name), [0, 0, 0]);
});

test("addPoint still validates coords it IS given", () => {
  const m = new Model(2);
  assert.throws(() => m.addPoint([1, 2, 3]), /2 coordinates/);
});

test("addLine() auto endpoints can never seed degenerate", () => {
  const m = new Model(2);
  const l = m.addLine();
  const [a, b] = l.refs;
  const d = Math.hypot(...m.coords(a).map((v, i) => v - m.coords(b)[i]));
  assert.ok(d > 1, `auto endpoints seeded ${d} apart — a zero-length seed breaks tan/par/ang`);
});

test("addLine with one endpoint given seeds the other apart from it", () => {
  const m = new Model(2);
  m.addPoint([5, 7], "here");
  const l1 = m.addLine("here");
  const other1 = l1.refs.find((n) => n !== "here")!;
  assert.ok(Math.hypot(...m.coords(other1).map((v, i) => v - [5, 7][i])) > 1);
  const l2 = m.addLine(null, "here"); // null means the same as absent (JSON journals)
  const other2 = l2.refs.find((n) => n !== "here")!;
  assert.ok(Math.hypot(...m.coords(other2).map((v, i) => v - [5, 7][i])) > 1);
  assert.equal(l1.refs[0], "here");
  assert.equal(l2.refs[1], "here");
});

test("addLine still rejects the same point twice", () => {
  const m = new Model(2);
  m.addPoint([0, 0], "a");
  assert.throws(() => m.addLine("a", "a"), /two different points/);
});

test("addCircle() auto-creates a real, named, first-class center point", async () => {
  await loadKernel();
  const m = new Model(2);
  axisFrame(m); // what the `fix` below is relative to — see test/frames.ts
  const c = m.addCircle();
  const center = m.point(c.center); // throws if not a real point entity
  assert.deepEqual(m.coords(center.name), [0, 0]);
  assert.equal(m.radius(c.name), Model.DEFAULT_RADIUS);
  // First-class means constrainable like any other point.
  fix(m, center.name, [3, 4]);
  assert.equal(m.solve().solved, true);
  assert.deepEqual(m.coords(center.name).map(Math.round), [3, 4]);
});

test("addCircle partial forms: center only, radius only", () => {
  const m = new Model(2);
  m.addPoint([1, 2], "ctr");
  const c1 = m.addCircle("ctr");
  assert.equal(c1.center, "ctr");
  assert.equal(m.radius(c1.name), Model.DEFAULT_RADIUS);
  const c2 = m.addCircle(null, 42);
  assert.notEqual(c2.center, "ctr");
  assert.equal(m.radius(c2.name), 42);
});

test("addCircle keeps positive-radius validation for a radius it IS given", () => {
  const m = new Model(2);
  assert.throws(() => m.addCircle(null, -1), /positive radius/);
  assert.throws(() => m.addCircle(null, 0), /positive radius/);
});

test("addArc() seeds a non-degenerate quarter arc", () => {
  const m = new Model(2);
  const a = m.addArc();
  assert.deepEqual(m.coords(a.center), [0, 0]);
  assert.deepEqual(m.coords(a.start), [Model.DEFAULT_RADIUS, 0]);
  assert.deepEqual(m.coords(a.end), [0, Model.DEFAULT_RADIUS]);
  assert.notEqual(a.start, a.end);
});

test("addArc partial form seeds around the center it was given", () => {
  const m = new Model(2);
  m.addPoint([10, 20], "c");
  const a = m.addArc("c", null, null, 5);
  assert.deepEqual(m.coords(a.start), [15, 20]);
  assert.deepEqual(m.coords(a.end), [10, 25]);
  assert.equal(m.radius(a.name), 5);
});

test("an auto-seeded arc below 2D is refused, not built degenerate", () => {
  const m = new Model(1);
  assert.throws(() => m.addArc(), /2 dimensions/);
});

test("a free constructor journals as ONE call — its expansion journals nothing", () => {
  const m = new Model(2);
  m.addCircle();
  m.addLine();
  m.addArc();
  const ops = m.journal.map((e) => e.op);
  assert.deepEqual(ops, ["addCircle", "addLine", "addArc"],
    "auto-created sub-entities must not journal individually (the PR #3 double-journal trap)");
});

test("the three-point circle: circle(), three onCircles, exact circumcircle", async () => {
  await loadKernel();
  const m = new Model(2);
  axisFrame(m);
  // Circumcircle of (0,0), (8,0), (0,6) is centered (4,3) with radius 5.
  m.addPoint([0, 0], "p1"); fix(m, "p1", [0, 0]);
  m.addPoint([8, 0], "p2"); fix(m, "p2", [8, 0]);
  m.addPoint([0, 6], "p3"); fix(m, "p3", [0, 6]);
  const c = m.addCircle();
  onCircle(m, "p1", c.name);
  onCircle(m, "p2", c.name);
  onCircle(m, "p3", c.name);
  const report = m.solve();
  assert.equal(report.solved, true, JSON.stringify(report.offenders));
  const [cx, cy] = m.coords(c.center);
  assert.ok(Math.abs(cx - 4) < 1e-6 && Math.abs(cy - 3) < 1e-6, `center landed at ${cx},${cy}`);
  assert.ok(Math.abs(m.radius(c.name) - 5) < 1e-6, `radius landed at ${m.radius(c.name)}`);
});

test("tangent + point + radius pins a free circle on all three counts", async () => {
  await loadKernel();
  const m = new Model(2);
  axisFrame(m);
  m.addPoint([0, 0], "a"); fix(m, "a", [0, 0]);
  m.addPoint([30, 0], "b"); fix(m, "b", [30, 0]);
  m.addLine("a", "b", "l1"); // the x-axis
  m.addPoint([10, 8], "p3"); fix(m, "p3", [10, 8]);
  const c = m.addCircle();
  tangent(m, "l1", c.name);
  onCircle(m, "p3", c.name);
  radius(m, c.name, 4);
  const report = m.solve();
  assert.equal(report.solved, true, JSON.stringify(report.offenders));
  const [cx, cy] = m.coords(c.center);
  assert.ok(Math.abs(m.radius(c.name) - 4) < 1e-6);
  assert.ok(Math.abs(Math.abs(cy) - 4) < 1e-6, `tangent to y=0 means |cy|=r, got ${cy}`);
  assert.ok(Math.abs(Math.hypot(cx - 10, cy - 8) - 4) < 1e-6, "p3 must sit on the rim");
});

test("a free-circle model survives save/open byte-for-byte and stays live", async () => {
  await loadKernel();
  const m = new Model(2);
  axisFrame(m);
  m.addPoint([0, 0], "p1"); fix(m, "p1", [0, 0]);
  m.addPoint([8, 0], "p2"); fix(m, "p2", [8, 0]);
  m.addPoint([0, 6], "p3"); fix(m, "p3", [0, 6]);
  const c = m.addCircle();
  onCircle(m, "p1", c.name);
  onCircle(m, "p2", c.name);
  onCircle(m, "p3", c.name);
  m.solve();

  const first = save(m);
  const reopened = open(first);
  // Deterministic re-expansion: same entities, same auto-names, same journal.
  assert.equal(save(reopened), first);
  // And live: the replayed constraints still bite after a nudge.
  reopened.setCoords(reopened.circle(c.name).center, [100, 100]);
  assert.equal(reopened.solve().solved, true);
  const [cx, cy] = reopened.coords(reopened.circle(c.name).center);
  assert.ok(Math.abs(cx - 4) < 1e-6 && Math.abs(cy - 3) < 1e-6);
});

test("deleting a free circle leaves its auto center, like any circle's center", async () => {
  await loadKernel();
  const m = new Model(2);
  m.addPoint([0, 0], "p1");
  const c = m.addCircle();
  onCircle(m, "p1", c.name);
  const center = c.center;
  const removed = del(m, c.name);
  assert.ok(removed.includes(c.name));
  assert.ok(!m.has(c.name));
  assert.ok(m.has(center), "the auto center is a first-class point and outlives the circle");
  assert.equal(m.relationsNaming(c.name).length, 0, "the onCircle must not survive the circle");
});

test("auto-name counters stay deterministic across a round trip with deletions", async () => {
  await loadKernel();
  const m = new Model(2);
  m.addCircle(); // c1, auto center p1
  del(m, "c1");
  const c2 = m.addCircle(); // c2, auto center p2 — p1's name is spent
  assert.equal(c2.name, "c2");
  const reopened = open(save(m));
  assert.equal(save(reopened), save(m));
  // The next auto-name in the reopened model matches what the original would give.
  assert.equal(reopened.addCircle().name, m.addCircle().name);
});

// --- the command layer -----------------------------------------------------
//
// The same freedom through the surface a user actually types at, plus the one
// thing the model deliberately cannot do: put a piece nobody placed in the
// middle of the window rather than at the world origin.

type Scope = Record<string, unknown>;

/** The command surface, headless by default; pass a viewport to seed from it. */
function scopeOf(model: Model, viewport?: Viewport): Scope {
  return neocadScope({
    model,
    ...(viewport ? { view: viewport.view, viewSize: () => viewport.size } : {}),
  });
}

interface Viewport {
  view: { ox: number; oy: number; scale: number };
  size: [number, number];
}

/** A viewport whose centre is world (225, -175), so a seed there is unmistakable. */
function offCentreViewport(): Viewport {
  return { view: { ox: 100, oy: 50, scale: 2 }, size: [1100, 800] };
}

const call = (s: Scope, name: string, ...args: unknown[]) =>
  (s[name] as (...a: unknown[]) => string)(...args);

test("every creator command takes no arguments at all", () => {
  const m = new Model(2);
  const s = scopeOf(m);
  assert.equal(m.entities.get(call(s, "pt"))?.kind, "point");
  assert.equal(m.entities.get(call(s, "ln"))?.kind, "line");
  assert.equal(m.entities.get(call(s, "circ"))?.kind, "circle");
  assert.equal(m.entities.get(call(s, "arc"))?.kind, "arc");
});

test("the long names are the same three functions, not a second implementation", () => {
  const s = scopeOf(new Model(2));
  assert.equal(s.point, s.pt);
  assert.equal(s.line, s.ln);
  assert.equal(s.circle, s.circ);
});

test("headless, a free constructor still journals as the ONE call the model layer writes", () => {
  const m = new Model(2);
  const s = scopeOf(m);
  call(s, "circ");
  call(s, "ln");
  assert.deepEqual(m.journal.map((e) => e.op), ["addCircle", "addLine"],
    "with no viewport there is no coordinate to pass down, so nothing is added above the model");
  assert.deepEqual(m.coords(m.circle("c1").center), [0, 0], "and the model's plain default stands");
});

test("with a viewport, a free piece lands in the middle of the view", () => {
  const m = new Model(2);
  const s = scopeOf(m, offCentreViewport());
  assert.deepEqual(m.coords(call(s, "pt")), [225, -175]);
  assert.deepEqual(m.coords(m.circle(call(s, "circ")).center), [225, -175]);
  assert.deepEqual(m.coords(m.arc(call(s, "arc")).center), [225, -175]);
  assert.deepEqual(m.coords(m.line(call(s, "ln")).refs[0]), [225, -175]);
});

test("panning moves where the next free piece appears", () => {
  const m = new Model(2);
  const vp = offCentreViewport();
  const s = scopeOf(m, vp);
  assert.deepEqual(m.coords(m.circle(call(s, "circ")).center), [225, -175]);
  vp.view.ox -= 200; // the window now looks 100 world units further right
  assert.deepEqual(m.coords(m.circle(call(s, "circ")).center), [325, -175]);
});

test("a free line's endpoints are still seeded apart when the view places them", () => {
  const m = new Model(2);
  const s = scopeOf(m, offCentreViewport());
  const [a, b] = m.line(call(s, "ln")).refs;
  const d = Math.hypot(...m.coords(a).map((v, i) => v - m.coords(b)[i]));
  assert.ok(d > 1, `view seeding must not collapse the line: endpoints ${d} apart`);
});

test("an argument that WAS given still decides where its neighbours go", () => {
  const m = new Model(2);
  const s = scopeOf(m, offCentreViewport());
  m.addPoint([0, 0], "here");
  // The missing endpoint belongs beside the one that was named, not in the
  // middle of the window — dragging it across the drawing would be worse.
  const other = m.line(call(s, "ln", "here")).refs.find((n) => n !== "here")!;
  assert.ok(Math.hypot(...m.coords(other)) < 50, `auto endpoint ran off to ${m.coords(other)}`);
  // Same for a centre that was named: the view has no say.
  assert.deepEqual(m.coords(m.circle(call(s, "circ", "here")).center), [0, 0]);
});

test("explicit coordinates are never overridden by the view", () => {
  const m = new Model(2);
  const s = scopeOf(m, offCentreViewport());
  assert.deepEqual(m.coords(call(s, "pt", 3, 4)), [3, 4]);
  assert.equal(m.radius(call(s, "circ", null, 7)), 7);
});

test("a 3D model seeds where a click in the middle of the view would land", () => {
  // With no default frame that is the plane facing the viewer through the
  // orbit target — z = 0, in a view that has never been turned — so the 3D
  // seed is the 2D one with no depth.
  const m = new Model(3);
  const s = scopeOf(m, offCentreViewport());
  assert.deepEqual(m.coords(call(s, "pt")), [225, -175, 0]);
  // A circle, though, is refused there: in 3D it needs a plane, and with no
  // frame there is none to give it — refused *before* the view-centre anchor
  // is made, so the failed call leaves no stray point behind.
  const before = m.entities.size;
  assert.throws(() => call(s, "circ"), /no default frame — frame\(\) then setDefaultFrame\(\)/);
  assert.throws(() => call(s, "arc"), /no default frame/);
  assert.equal(m.entities.size, before, "and nothing was made on the way to the refusal");
  // With a frame it seeds there, like the point.
  m.addPoint([0, 0, 0], "o"); m.addPoint([1, 0, 0], "x"); m.addPoint([0, 1, 0], "y");
  m.addFrame("o", "x", "y", "f");
  assert.deepEqual(m.coords(m.circle(call(s, "circ", null, null, "f")).center), [225, -175, 0]);
});

test("...and on the default frame's plane, when there is one — even a tilted one", () => {
  const m = new Model(3);
  // A plane through (0, 0, 10) tipped 30° about the kernel's x axis.
  const t = Math.PI / 6;
  m.addPoint([0, 0, 10], "o");
  m.addPoint([1, 0, 10], "x");
  m.addPoint([0, Math.cos(t), 10 + Math.sin(t)], "y");
  m.addFrame("o", "x", "y", "f");
  m.setDefaultFrame("f");
  const s = scopeOf(m, offCentreViewport());
  const p = m.coords(call(s, "pt"));
  // Looked at straight down, the middle of the view is still (225, -175) in x
  // and y; the depth is wherever that ray meets the tilted plane.
  assert.ok(Math.abs(p[0] - 225) < 1e-9 && Math.abs(p[1] + 175) < 1e-9, `p = ${p}`);
  assert.ok(Math.abs(p[2] - (10 + -175 * Math.tan(t))) < 1e-9, `on the plane: p = ${p}`);
});

test("a model that is neither 2D nor 3D falls back to the plain defaults", () => {
  // No view can show a 4D model, so there is no middle to offer; the
  // alternative is a coordinate-count mismatch thrown from addPoint.
  const m = new Model(4);
  const s = scopeOf(m, offCentreViewport());
  assert.deepEqual(m.coords(call(s, "pt")), [0, 0, 0, 0]);
});

test("a view-seeded model round-trips through save/open unchanged", async () => {
  await loadKernel();
  const m = new Model(2);
  const s = scopeOf(m, offCentreViewport());
  call(s, "circ");
  call(s, "ln");
  m.solve();
  const first = save(m);
  assert.equal(save(open(first)), first,
    "the coordinate the view chose is in the journal, so replay never re-asks the window");
});
