import { test } from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { ensureKernelLoaded } from "../src/kernel/problem.ts";
import { Model } from "../src/model.ts";
import { save, open, toSaved } from "../src/persist.ts";
import { dist, fix, midpoint } from "../src/relations/basic.ts";
import { parallel, radius, tangent, onCircle } from "../src/relations/geometry.ts";
import { fillet } from "../src/operations.ts";
import { RectangleTool } from "../src/tools/rectangle.ts";
import type { ToolContext } from "../src/tools/tool.ts";
import { axisFrame } from "./frames.ts"; // hor/ver/fix are frame-relative now

async function loadKernel() {
  const bytes = await readFile(new URL("../src/kernel/wasm-gen/neocad_kernel_bg.wasm", import.meta.url));
  await ensureKernelLoaded(bytes);
}

/** Everything a reopened model should agree with the original about. */
function shape(m: Model) {
  return {
    dim: m.dim,
    entities: [...m.entities.values()].map((e) => JSON.stringify(e)).sort(),
    points: Object.fromEntries([...m.entities.values()].filter((e) => e.kind === "point")
      .map((e) => [e.name, m.coords(e.name).map((v) => Math.round(v * 1e9) / 1e9)])),
    radii: Object.fromEntries([...m.entities.values()].filter((e) => e.kind === "circle" || e.kind === "arc")
      .map((e) => [e.name, Math.round(m.radius(e.name) * 1e9) / 1e9])),
  };
}

test("a model survives a save/open round trip, geometry and all", async () => {
  await loadKernel();
  const m = new Model(2);
  axisFrame(m);
  m.addPoint([0, 0], "a");
  m.addPoint([3, 4], "b");
  fix(m, "a", [0, 0]);
  dist(m, "a", "b", 10);
  m.addLine("a", "b", "l");
  m.solve();

  const reopened = open(save(m));
  assert.deepEqual(shape(reopened), shape(m));
  assert.equal(reopened.solve().solved, true);
});

test("the reopened model is still live — constraints replayed, not just coordinates", async () => {
  await loadKernel();
  const m = new Model(2);
  axisFrame(m);
  m.addPoint([0, 0], "a");
  m.addPoint([3, 4], "b");
  fix(m, "a", [0, 0]);
  dist(m, "a", "b", 10);
  m.solve();

  const reopened = open(save(m));
  // Shove a point well off its constraint; solving must pull it back, which
  // it can only do if the residual blocks were genuinely rebuilt.
  reopened.setCoords("b", [1, 1]);
  const report = reopened.solve();
  assert.equal(report.solved, true, JSON.stringify(report.offenders));
  assert.ok(Math.abs(Math.hypot(...reopened.coords("b")) - 10) < 1e-6, "the distance constraint came back to life");
});

test("saving preserves the solution an under-constrained model happened to land on", async () => {
  await loadKernel();
  const m = new Model(2);
  axisFrame(m);
  m.addPoint([0, 0], "a");
  m.addPoint([6, 8], "b"); // only the distance is constrained, so the angle is free
  fix(m, "a", [0, 0]);
  dist(m, "a", "b", 10);
  m.solve();
  const original = m.coords("b");

  const reopened = open(save(m));
  const restored = reopened.coords("b");
  assert.ok(Math.abs(restored[0] - original[0]) < 1e-9 && Math.abs(restored[1] - original[1]) < 1e-9,
    `expected the saved configuration ${original}, got ${restored}`);
});

test("a fillet is saved as the one call that was made, not its expansion", async () => {
  await loadKernel();
  const m = new Model(2);
  axisFrame(m);
  m.addPoint([0, 20], "a");
  m.addPoint([0, 0], "p");
  m.addPoint([20, 0], "b");
  fix(m, "a", [0, 20]);
  fix(m, "b", [20, 0]);
  m.addLine("a", "p", "l1");
  m.addLine("p", "b", "l2");
  parallel(m, "l1", "f.y");
  parallel(m, "l2", "f.x");
  fillet(m, "l1", "l2", 5);
  m.solve();

  const saved = toSaved(m);
  const fillets = saved.journal.filter((e) => e.op === "fillet");
  assert.equal(fillets.length, 1);
  assert.deepEqual(fillets[0].args, ["l1", "l2", 5]);
  assert.equal(saved.journal.filter((e) => e.op === "tangent").length, 0,
    "the relations the fillet expands into are not journalled separately");

  const reopened = open(JSON.stringify(saved));
  assert.deepEqual(shape(reopened), shape(m));
  assert.equal(reopened.solve().solved, true);
});

test("circles, arcs and tangency round-trip", async () => {
  await loadKernel();
  const m = new Model(2);
  axisFrame(m);
  m.addPoint([0, 0], "ctr");
  fix(m, "ctr", [0, 0]);
  m.addCircle("ctr", 1, "c");
  m.addPoint([-10, 8], "u");
  m.addPoint([10, 8], "v");
  fix(m, "u", [-10, 8]);
  fix(m, "v", [10, 8]);
  m.addLine("u", "v", "l");
  tangent(m, "l", "c");
  m.addPoint([9, 0], "q");
  onCircle(m, "q", "c");
  m.solve();

  const reopened = open(save(m));
  assert.deepEqual(shape(reopened), shape(m));
  assert.ok(Math.abs(reopened.radius("c") - 8) < 1e-6);
});

test("geometry drawn with a tool saves like anything else", async () => {
  await loadKernel();
  const m = new Model(2);
  const ctx: ToolContext = {
    model: m,
    options: {},
    requestRender: () => {},
    requestSolve: () => { m.solve(); },
    finish: () => {},
  };
  const tool = new RectangleTool(ctx);
  tool.onDown({ world: [0, 0], screen: [0, 0] });
  tool.onUp({ world: [40, 25], screen: [0, 0] });

  const reopened = open(save(m));
  assert.deepEqual(shape(reopened), shape(m));
  assert.equal([...reopened.entities.values()].filter((e) => e.kind === "line").length, 4);
});

test("both forms of midpoint survive the round trip, each as the form it was called in", async () => {
  await loadKernel();
  const m = new Model(2);
  axisFrame(m);
  m.addPoint([0, 0], "a");
  m.addPoint([40, 0], "b");
  m.addPoint([40, 40], "c");
  m.addLine("a", "b", "l");
  m.addPoint([20, 0], "pointForm");
  m.addPoint([20, 0], "lineForm");
  fix(m, "a", [0, 0]);
  fix(m, "b", [40, 0]);
  midpoint(m, "pointForm", "a", "b"); // captures these two points
  midpoint(m, "lineForm", "l");       // means "the middle of this edge"
  m.solve();

  const once = save(m);
  assert.equal(save(open(once)), once, "the arity each was called with is what is saved");
  const reopened = open(once);
  assert.deepEqual(shape(reopened), shape(m));

  // The distinction has to survive too, not just the coordinates: re-point the
  // edge, and only the line form follows it.
  reopened.retargetLine("l", "b", "c");
  fix(reopened, "c", [40, 40]);
  assert.equal(reopened.solve().solved, true);
  const at = (n: string, x: number, y: number) => {
    const c = reopened.coords(n);
    return Math.hypot(c[0] - x, c[1] - y) < 1e-6 ? true : `${n} is at ${c}`;
  };
  assert.equal(at("lineForm", 20, 20), true, "the line form should follow the re-pointed edge");
  assert.equal(at("pointForm", 20, 0), true, "the point form should stay on the two points it named");
});

test("constraints a tool inferred are saved like any other, and re-solve the same", async () => {
  await loadKernel();
  const m = new Model(2);
  axisFrame(m);
  m.addPoint([10, 10], "a");
  const ctx: ToolContext = {
    model: m,
    options: {},
    requestRender: () => {},
    requestSolve: () => { m.solve(); },
    finish: () => {},
  };
  // A rectangle whose first corner was clicked onto the existing point `a`,
  // exactly as the engine would hand it over after a snap.
  const tool = new RectangleTool(ctx);
  tool.onDown({ world: [10, 10], screen: [0, 0], snap: { world: [10, 10], screen: [0, 0], kind: "point", targets: ["a"] } });
  tool.onUp({ world: [60, 40], screen: [0, 0] });
  assert.ok(m.journal.some((e) => e.op === "coincident"), "sanity: the inference happened");

  const once = save(m);
  assert.equal(save(open(once)), once);
  const reopened = open(once);
  assert.deepEqual(shape(reopened), shape(m));

  // Still a live constraint after the round trip, not just matching numbers.
  fix(reopened, "a", [80, 5]);
  assert.equal(reopened.solve().solved, true);
  const corner = reopened.coords("p1"); // the rectangle's first corner — `a` took no auto-name
  assert.ok(Math.hypot(corner[0] - 80, corner[1] - 5) < 1e-6, `the corner should have followed a, got ${corner}`);
});

test("open and save again produces an identical file", async () => {
  await loadKernel();
  const m = new Model(2);
  axisFrame(m);
  m.addPoint([0, 0], "a");
  m.addPoint([5, 5], "b");
  fix(m, "a", [0, 0]);
  dist(m, "a", "b", 10);
  m.addLine("a", "b", "l");
  m.solve();

  const once = save(m);
  const twice = save(open(once));
  assert.equal(twice, once, "a round trip must be a fixed point, or repeated saves drift");
});

test("a 3D model round-trips too", async () => {
  await loadKernel();
  const m = new Model(3);
  // A 3D frame, with its y-ref, is part of what has to survive the trip now
  // that `fix` needs one in 3D as well.
  axisFrame(m);
  m.addPoint([0, 0, 0], "a");
  m.addPoint([1, 1, 1], "b");
  fix(m, "a", [0, 0, 0]);
  dist(m, "a", "b", 5);
  m.solve();
  const once = save(m);
  const reopened = open(once);
  assert.equal(reopened.dim, 3);
  assert.deepEqual(shape(reopened), shape(m));
  assert.equal(reopened.frame("f").yref, "f_y");
  assert.equal(save(reopened), once, "byte for byte");
});

// --- refusing bad input ----------------------------------------------------

test("open refuses anything that is not a model file, with a reason", async () => {
  assert.throws(() => open("{ not json"), /not valid JSON/);
  assert.throws(() => open('{"hello": 1}'), /not a neocad model/);
  assert.throws(() => open(JSON.stringify({ format: "neocad-model", version: 99, journal: [] })),
    /version 99.*only reads up to/);
  assert.throws(() => open(JSON.stringify({ format: "neocad-model", version: 1 })), /no journal/);
});

test("open will only perform calls that are part of the public API", async () => {
  // A file naming something outside the replay table is refused rather than
  // reached for — a saved model is data, not a script.
  const hostile = JSON.stringify({
    format: "neocad-model", version: 1, dim: 2,
    journal: [{ op: "constructor", args: [] }],
    values: { points: {}, radii: {} },
  });
  assert.throws(() => open(hostile), /"constructor" is not something a model file may do/);

  const alsoHostile = JSON.stringify({
    format: "neocad-model", version: 1, dim: 2,
    journal: [{ op: "__proto__", args: [] }],
    values: { points: {}, radii: {} },
  });
  assert.throws(() => open(alsoHostile), /is not something a model file may do/);
});

test("a journal step that cannot run says which step and why", async () => {
  await loadKernel();
  const broken = JSON.stringify({
    format: "neocad-model", version: 1, dim: 2,
    journal: [
      { op: "addPoint", args: [[0, 0], "a"] },
      { op: "dist", args: ["a", "nonexistent", 5] },
    ],
    values: { points: {}, radii: {} },
  });
  assert.throws(() => open(broken), /step 2, dist\(.*nonexistent.*\): "nonexistent" is not a point/);
});

test("radii are restored for arcs as well as circles", async () => {
  await loadKernel();
  const m = new Model(2);
  axisFrame(m);
  m.addPoint([0, 0], "ctr");
  m.addPoint([10, 0], "s");
  m.addPoint([0, 10], "e");
  fix(m, "ctr", [0, 0]);
  m.addArc("ctr", "s", "e", 10, "arc");
  radius(m, "arc", 10);
  m.solve();
  const reopened = open(save(m));
  assert.ok(Math.abs(reopened.radius("arc") - 10) < 1e-9);
  assert.deepEqual(shape(reopened), shape(m));
});

// --- naming, which a replay leans on harder than anything else -------------

test("auto-naming skips over names already taken, however many in a row", async () => {
  const m = new Model(2);
  // Claim the first few auto-names explicitly, in the order a replay would.
  m.addPoint([0, 0], "p1");
  m.addPoint([1, 1], "p2");
  m.addPoint([2, 2], "p3");
  // The next auto-named point must land clear of all of them. Before the
  // counter fix this looped forever rather than returning.
  const next = m.addPoint([3, 3]);
  assert.equal(next.name, "p4");
  assert.equal(m.entities.size, 4);
});

test("auto-naming steps past a gap rather than reusing a taken name", async () => {
  const m = new Model(2);
  m.addPoint([0, 0], "p9");
  const a = m.addPoint([1, 1]);
  assert.equal(a.name, "p10", "an explicit p9 moves the counter past it");
  m.addLine("p9", "p10", "l5");
  assert.equal(m.addLine("p9", "p10").name, "l6");
});

test("a reopened model can still be drawn on — the fillet case that hung", async () => {
  await loadKernel();
  const m = new Model(2);
  axisFrame(m);
  // Auto-named throughout, the way the tools and the command line produce it.
  const a = m.addPoint([0, 20]).name;
  const p = m.addPoint([0, 0]).name;
  const b = m.addPoint([20, 0]).name;
  fix(m, a, [0, 20]);
  fix(m, b, [20, 0]);
  const l1 = m.addLine(a, p).name;
  const l2 = m.addLine(p, b).name;
  parallel(m, l1, "f.y");
  parallel(m, l2, "f.x");
  fillet(m, l1, l2, 5);
  m.solve();

  const reopened = open(save(m));
  assert.deepEqual(shape(reopened), shape(m));

  // The fillet's replay auto-names points *after* the journal has claimed
  // p1..pN explicitly, which is exactly the collision that used to spin.
  // Adding more geometry afterwards must also keep working.
  const fresh = reopened.addPoint([99, 99]);
  assert.ok(!reopened.entities.has(fresh.name) || reopened.entities.get(fresh.name) === fresh);
  assert.equal(reopened.solve().solved, true);
  assert.ok(reopened.entities.size > m.entities.size, "the new point really was added");
});
