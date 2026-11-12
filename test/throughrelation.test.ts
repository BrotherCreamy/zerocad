// Through all is a relation to the far side's own geometry
// (docs/plans/through-all-relation.md, review item 8). The owner: *"correct
// relationships BETWEEN entities … bidirectional relationships everywhere by
// default"*; *"I should be able to pull on anything."*
//
// Until this, a through-all extrude's lid was held at a number the solids
// layer worked out — how far everything made before it stood — read through a
// hook as a constant inside the `extrusion` relation's length row. The first
// three tests are the three faults of that, each failing on the build before
// (measured there: the plate moved 0, no row named it, no relation was
// listed); the rest hold the design that replaced it.

import { test } from "node:test";
import assert from "node:assert/strict";
import { Model } from "../src/model.ts";
import { dist } from "../src/relations/basic.ts";
import { perpendicular } from "../src/relations/geometry.ts";
import { extrude } from "../src/operations.ts";
import { pullTo } from "../src/tools/engine.ts";
import { T, circleOn, loadSolver, onTop, plate } from "./solids/scene.ts";
import "../src/modules/builtin.ts";

const sub = (a: number[], b: number[]) => a.map((x, i) => x - b[i]);
const dot = (a: number[], b: number[]) => a.reduce((s, x, i) => s + x * b[i], 0);

function drag(m: Model, point: string, by: number[], frames = 12): boolean {
  const from = m.coords(point);
  for (let k = 1; k <= frames; k++) m.solveFrame(pullTo(m, point, from.map((c, i) => c + (by[i] * k) / frames)));
  return m.solve().solved;
}

/**
 * A free 100 × 60 plate, 10 thick, held to nothing but itself — and a circle
 * floating 20 above it, on no face, cut down through all. Nothing joins the
 * cut to the plate but what "through all" itself says.
 */
function floating(): { m: Model; base: string[]; lid: string[]; cut: string; rim: string; plate: string } {
  const m = new Model(3);
  const pts = [[0, 0], [100, 0], [100, 60], [0, 60]].map(([x, y]) => m.addPoint([x, y, 0]).name);
  const lines = pts.map((p, i) => m.addLine(p, pts[(i + 1) % 4]).name);
  for (let i = 0; i < 3; i++) perpendicular(m, lines[i], lines[i + 1]);
  dist(m, pts[0], pts[1], 100);
  dist(m, pts[1], pts[2], 60);
  const e1 = extrude(m, lines[0], 10);
  m.solve();
  const lid = m.featureOf(e1, "extrude").twins[0].map((l) => m.line(l).refs[0]);
  const c = m.addPoint([50, 30, 30]).name;
  const circle = m.addCircle(c, 5, [0, 0, 1]).name;
  const cut = extrude(m, circle, -1, { mode: "cut", into: e1, end: "through" });
  assert.ok(m.solve().solved);
  const rim = m.featureOf(cut, "extrude").twins[0][0];
  return { m, base: pts, lid, cut, rim, plate: e1 };
}

test("fault 1, one way: pulling a through cut's far rim takes the plate's far face with it", async () => {
  await loadSolver();
  const { m, base, rim } = floating();
  const centre = (m.entities.get(rim) as { center: string }).center;
  const was = base.map((p) => m.coords(p));
  assert.ok(drag(m, centre, [0, 0, -6]), "it solves");
  const moved = base.map((p, i) => sub(m.coords(p), was[i])[2]);
  // The far face is the plate's base; it has come at least half the way the hand went.
  assert.ok(moved.every((dz) => dz < -3), `the plate's far face followed the rim: ${moved.map((d) => d.toFixed(3))}`);
  // And the cut still ends on it: the rim's centre in the plane of the base.
  assert.ok(Math.abs(m.coords(centre)[2] - m.coords(base[0])[2]) < 1e-6, "the lid on the far face");
});

test("fault 2, the Jacobian: a row of a through cut names the far side's variables", async () => {
  await loadSolver();
  const m = new Model(3);
  const p = plate(m);
  const top = p.lid.slice(0, 3).join(".");
  const e2 = extrude(m, circleOn(m, top, onTop(p, 50, 30), 5, p.t.uz), -1, { mode: "cut", end: "through" });
  assert.ok(m.solve().solved);
  const f = m.featureOf(e2, "extrude");
  const lidVars = new Set(m.point((m.entities.get(f.twins[0][0]) as { center: string }).center).varIndices);
  const plateVars = new Set([...p.base, ...p.lid].flatMap((q) => m.point(q).varIndices));
  const both = m.problem.handles().filter((h) => {
    const vars = m.problem.varsOf(h);
    return vars.some((v) => lidVars.has(v)) && vars.some((v) => plateVars.has(v));
  });
  assert.ok(both.length > 0, "some row reads the cut's lid and the plate together — it depends on both and says so");
  // The lid stands on the far face, not past it: the plate's base, T below its top.
  const lidAt = dot(sub(m.coords((m.entities.get(f.twins[0][0]) as { center: string }).center), p.t.at(0, 0, 0)), p.t.uz);
  assert.ok(Math.abs(lidAt) < 1e-6, `the lid on the plate's base: ${lidAt} (the plate is ${T} thick)`);
});

test("fault 3, nothing to see: the relation is listed — a far vertex of the plate on the cut's lid, named for the cut", async () => {
  await loadSolver();
  const m = new Model(3);
  const p = plate(m);
  const top = p.lid.slice(0, 3).join(".");
  const e2 = extrude(m, circleOn(m, top, onTop(p, 50, 30), 5, p.t.uz), -1, { mode: "cut", end: "through" });
  m.solve();
  const r = m.relations.get(`${e2}_through`);
  assert.ok(r, `${e2}_through is a relation`);
  assert.equal(r.op, "onPlane");
  assert.equal(r.args[1], `${e2}.lid`);
  assert.ok(p.base.includes(r.args[0] as string), `the far vertex is one of the plate's base corners: ${r.args[0]}`);
});
