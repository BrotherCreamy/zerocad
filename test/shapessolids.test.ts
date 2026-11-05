// The sketch shapes as solids (docs/plans/sketch-shapes.md): an ellipse, a slot
// and a polygon extruded, by volume — the solid kernel's (SMLib, through the
// profile the app hands it: an ellipse as its exact rational quadratic NURBS)
// and the exact B-rep's (solids.ts) — against the closed forms; and the STEP
// of an elliptic cylinder, both ways it is written: an ELLIPSE swept by a
// SURFACE_OF_LINEAR_EXTRUSION for a body of its own, the kernel's B-spline
// surface for a body a boolean made. Without the kernel build the kernel's
// half skips and says why, as every kernel test does.

import { addEllipse, checkEllipse, ellipseOf, semiAxes } from "../src/kinds/ellipse.ts";
// The ellipse is the sketch module's (docs/plans/workbenches.md): loaded, as the app loads it.
import "../src/modules/builtin.ts";
import { test } from "node:test";
import assert from "node:assert/strict";
import { Model } from "../src/model.ts";
import { extrude, revolve } from "../src/operations.ts";
import { onPlane } from "../src/relations/basic.ts";
import { majorAxis, minorAxis, parallel, radius } from "../src/relations/geometry.ts";
import { polygon, slot } from "../src/tools/shapes.ts";
import { programOf } from "../src/bodies.ts";
import { kernelBody } from "../src/kernelbrep.ts";
import { ellipseMember, kernelSweep, solidsOf } from "../src/solids.ts";
import { stepExport, type KernelSolid } from "../src/step.ts";
import { Evaluator } from "../src/solids/evaluate.ts";
import { insideProfile, memberPoints, nurbsPoint } from "../src/solids/profile.ts";
import { AP214_TYPES, checkShell, parseStep, refOf, type Value } from "./stepread.ts";
import { T, loadSolver, onTop, plate } from "./solids/scene.ts";
import { kernel, noKernel as skip } from "./solids/load.ts";

const STAMP = "2026-11-05T00:00:00";

/** An ellipse lying on the ground: centre (cx, cy), semi-axes a along `angle` and b, held level. */
function groundEllipse(m: Model, cx: number, cy: number, a: number, b: number, angle = 0): string {
  const c = m.addPoint([cx, cy, 0]).name;
  const end = m.addPoint([cx + a * Math.cos(angle), cy + a * Math.sin(angle), 0]).name;
  for (const p of [c, end]) onPlane(m, p, "origin");
  const e = addEllipse(m, c, end, b, [0, 0, 1]).name;
  parallel(m, e, "origin.z");
  majorAxis(m, e, a);
  minorAxis(m, e, b);
  return e;
}

/** The kernel's bodies of a model, and its STEP with them. */
async function kernelRun(m: Model, all = false) {
  const { program, chains } = programOf(m, all);
  const ev = new Evaluator(await kernel());
  const results = ev.run(program).bodies;
  const solids: KernelSolid[] = results.map((r) => ({
    body: kernelBody(m, r.name, ev.topology(r.name)!, r),
    features: chains.get(r.name)!.features.map((f) => f.name),
  }));
  return { results, step: stepExport(m, { name: "shapes", timestamp: STAMP }, solids) };
}

test("an ellipse's kernel member is an exact rational quadratic: every sample on the ellipse, closed", () => {
  const mem = ellipseMember([3, -2], [Math.cos(0.7), Math.sin(0.7)], 9, 4);
  assert.equal(mem.kind, "nurbs");
  const nurbs = mem as Extract<typeof mem, { kind: "nurbs" }>;
  for (let k = 0; k <= 400; k++) {
    const [x, y] = nurbsPoint(nurbs, k / 400);
    const [dx, dy] = [x - 3, y + 2];
    const [X, Y] = [dx * Math.cos(0.7) + dy * Math.sin(0.7), -dx * Math.sin(0.7) + dy * Math.cos(0.7)];
    assert.ok(Math.abs((X / 9) ** 2 + (Y / 4) ** 2 - 1) < 1e-12, `sample ${k}: ${X}, ${Y}`);
  }
  const pts = memberPoints(mem, 64);
  assert.deepEqual(pts[0], pts[64], "closed exactly");
  assert.ok(insideProfile({ loops: [[mem]] }, [3, -2]) && !insideProfile({ loops: [[mem]] }, [3, 3]));
});

test("an elliptic cylinder: the exact B-rep's volume is πab·d, its wall a surface of linear extrusion over two half ellipses", async () => {
  await loadSolver();
  const m = new Model(3);
  const e = groundEllipse(m, 5, 5, 12, 5, 0.4);
  extrude(m, e, 8);
  assert.equal(m.solve().solved, true);
  const { bodies, skipped } = solidsOf(m);
  assert.deepEqual(skipped, []);
  assert.ok(Math.abs(bodies[0].volume - Math.PI * 12 * 5 * 8) < 1e-6, `volume ${bodies[0].volume}`);
  const kinds = bodies[0].outer.faces.map((f) => f.surface.kind);
  assert.deepEqual(kinds, ["plane", "plane", "extrusion", "extrusion"]);
  // The box is the ellipse's own: half-widths √(a²cos²θ + b²sin²θ) along x.
  const hx = Math.hypot(12 * Math.cos(0.4), 5 * Math.sin(0.4));
  assert.ok(Math.abs(bodies[0].box[1][0] - (5 + hx)) < 1e-6 && Math.abs(bodies[0].box[1][2] - 8) < 1e-9);
});

test("the solid kernel extrudes an ellipse, a slot and a polygon to their closed-form volumes", { skip }, async () => {
  await loadSolver();
  const m = new Model(3);
  const e = groundEllipse(m, 0, 0, 10, 4);
  extrude(m, e, 7);
  // A slot, 30 between centres and 10 wide, its width and length dimensioned.
  const a = m.addPoint([0, 40, 0]).name, b = m.addPoint([30, 40, 0]).name;
  for (const p of [a, b]) onPlane(m, p, "origin");
  const s = slot(m, a, b, 10, "origin");
  radius(m, s.arcs[0], 5);
  extrude(m, s.sides[0], 5);
  // A hexagon of circumradius 10.
  const c = m.addPoint([0, -40, 0]).name, v = m.addPoint([10, -40, 0]).name;
  for (const p of [c, v]) onPlane(m, p, "origin");
  const h = polygon(m, c, v, 6, true, "origin");
  radius(m, h.circle, 10);
  extrude(m, h.sides[0], 3);
  assert.equal(m.solve().solved, true);
  const profile = kernelSweep(m, m.featureOf("e1", "extrude")).profile;
  assert.deepEqual(profile.loops.map((l) => l.map((x) => x.kind)), [["nurbs"]], "the ellipse goes to the kernel as itself");
  // Every body, a feature of its own as well: the kernel measured against solids.ts.
  const { results } = await kernelRun(m, true);
  const volume = (f: string) => results.find((r) => r.name === f)!.solid!.volume;
  const want = { e1: Math.PI * 40 * 7, e2: (10 * 30 + Math.PI * 25) * 5, e3: (3 * Math.sqrt(3) / 2) * 100 * 3 };
  for (const [f, v] of Object.entries(want)) {
    const r = results.find((x) => x.name === f)!;
    assert.deepEqual(r.failed, [], f);
    assert.deepEqual(r.solid!.validity, { manifold: true, failures: 0 }, `${f}: a valid solid`);
    assert.ok(Math.abs(volume(f) - v) < 1e-6 * v, `${f}: the kernel's ${volume(f)} against ${v}`);
  }
  // And the exact B-rep agrees.
  for (const body of solidsOf(m).bodies) {
    const v = want[body.feature as keyof typeof want];
    assert.ok(Math.abs(body.volume - v) < 1e-6 * v, `${body.feature}: solids.ts ${body.volume} against ${v}`);
  }
});

test("an elliptic hole through a plate, and an elliptic boss on it: the kernel's volume, and its NURBS wall in the STEP", { skip }, async () => {
  await loadSolver();
  const m = new Model(3);
  const p = plate(m);
  const top = p.lid.slice(0, 3).join(".");
  const oval = (u: number, v: number, a: number, b: number) => {
    const c = m.addPoint(onTop(p, u, v)).name;
    const end = m.addPoint(onTop(p, u + a, v)).name;
    for (const q of [c, end]) onPlane(m, q, top);
    const e = addEllipse(m, c, end, b, p.t.uz).name;
    parallel(m, e, top);
    majorAxis(m, e, a);
    minorAxis(m, e, b);
    return e;
  };
  extrude(m, oval(30, 30, 12, 6), -T, { mode: "cut" });
  extrude(m, oval(75, 30, 8, 4), 5);
  assert.equal(m.solve().solved, true);
  const { results, step } = await kernelRun(m);
  assert.equal(results.length, 1, "one body: the plate, cut and added to");
  const r = results[0];
  assert.deepEqual(r.solid!.validity, { manifold: true, failures: 0 });
  const want = 100 * 60 * T - Math.PI * 72 * T + Math.PI * 32 * 5;
  assert.ok(Math.abs(r.solid!.volume - want) < 1e-6 * want, `the kernel's ${r.solid!.volume} against ${want}`);
  const f = parseStep(step.text);
  const count = (t: string) => [...f.data.values()].filter((e) => e.types.includes(t)).length;
  assert.ok(count("B_SPLINE_SURFACE_WITH_KNOTS") >= 2, "each elliptic wall the kernel's B-spline surface");
  for (const b of [...f.data.values()].filter((e) => e.types[0] === "MANIFOLD_SOLID_BREP")) {
    checkShell(f, refOf(b.args[1] as Value), "plate", true);
  }
});

test("STEP of an elliptic cylinder of its own: ELLIPSEs and a SURFACE_OF_LINEAR_EXTRUSION, a closed shell, each edge twice", async () => {
  await loadSolver();
  const m = new Model(3);
  extrude(m, groundEllipse(m, 0, 0, 10, 4, 0.3), 6);
  m.solve();
  const x = stepExport(m, { name: "oval", timestamp: STAMP, curves: true });
  const f = parseStep(x.text);
  const types = new Set([...AP214_TYPES, "ELLIPSE", "SURFACE_OF_LINEAR_EXTRUSION"]);
  for (const e of f.data.values()) for (const t of e.types) assert.ok(types.has(t), `${t} is a type the exporter writes`);
  const count = (t: string) => [...f.data.values()].filter((e) => e.types.includes(t)).length;
  assert.equal(count("ELLIPSE"), 4 + 2, "two half ellipses at the base and the lid — each edge its own curve — and the wall's two sweeps");
  assert.equal(count("SURFACE_OF_LINEAR_EXTRUSION"), 2, "the wall in two halves, as a cylinder is");
  const ellipses = [...f.data.values()].filter((e) => e.types[0] === "ELLIPSE");
  for (const e of ellipses) assert.ok(Math.abs((e.args[2] as number) - 10) < 1e-9 && Math.abs((e.args[3] as number) - 4) < 1e-9);
  const brep = [...f.data.values()].find((e) => e.types[0] === "MANIFOLD_SOLID_BREP")!;
  const stats = checkShell(f, refOf(brep.args[1] as Value), "oval", true);
  assert.equal(stats.faces, 4);
});

test("revolving an ellipse is refused by name, as out of scope — whichever member is named", async () => {
  await loadSolver();
  const m = new Model(3);
  const e = groundEllipse(m, 20, 0, 6, 3);
  assert.throws(() => revolve(m, e, "origin.y"), /"el1" is an ellipse — revolving an ellipse is not supported yet/);
  assert.equal(m.features.size, 0, "nothing made");
});
