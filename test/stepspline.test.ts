// STEP of spline parts (docs/plans/spline.md), against what OpenCascade
// measured reading the committed fixtures (test/fixtures/step-spline/
// validated.json), as the solids' and the surfaces' are (stepkernel.test.ts,
// stepsurfaces.test.ts): an open spline's D, a closed spline, one on a tilted
// plane, a closed spline cut through a plate and another bossed on it (the
// solid kernel's body), a D revolved, and a loose spline as wireframe.
//
// The closed forms are the spline's own: its enclosed area as the vector area
// ½∮ p × p′ du and its first moment about an axis, each integrated per knot
// span by 5-point Gauss–Legendre — exact for a cubic (degree 5 and 8
// integrands) — and nothing of the solids' integrators.
//
// Regenerating the fixtures: NEOCAD_STEP_OUT=<dir> writes every part's file
// and ZeroCAD's volumes there, for the validator to read (step-export.md's
// procedure; the validator is never part of this repo).

import { test } from "node:test";
import assert from "node:assert/strict";
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import "../src/modules/builtin.ts";
import { Model } from "../src/model.ts";
import { extrude, revolve } from "../src/operations.ts";
import { fix, onPlane } from "../src/relations/basic.ts";
import { addSpline } from "../src/relations/spline.ts";
import { splineCurve } from "../src/kinds/spline.ts";
import { derivs, type BSpline } from "../src/bspline.ts";
import { solidsOf } from "../src/solids.ts";
import { stepExport, type KernelSolid } from "../src/step.ts";
import { programOf } from "../src/bodies.ts";
import { kernelBody } from "../src/kernelbrep.ts";
import { Evaluator } from "../src/solids/evaluate.ts";
import { parseStep } from "./stepread.ts";
import { L, T, W, loadSolver, onTop, plate } from "./solids/scene.ts";
import { kernel, noKernel } from "./solids/load.ts";

const STAMP = "2026-11-06T00:00:00";
const FIXTURES = new URL("./fixtures/step-spline/", import.meta.url);
const OUT = process.env.NEOCAD_STEP_OUT;

const GL = [
  [-0.906179845938664, 0.236926885056189], [-0.538469310105683, 0.478628670499366], [0, 0.568888888888889],
  [0.538469310105683, 0.478628670499366], [0.906179845938664, 0.236926885056189],
];

/** ∫ f(u) du over the spline's domain, span by span. */
function overSpans(c: BSpline, f: (p: number[], d: number[]) => number): number {
  const spans = [...new Set(c.knots)];
  let sum = 0;
  for (let k = 0; k + 1 < spans.length; k++) {
    const [a, b] = [spans[k], spans[k + 1]];
    for (const [x, w] of GL) {
      const [p, d] = derivs(c, (a + b) / 2 + ((b - a) / 2) * x, 1);
      sum += ((b - a) / 2) * w * f(p, d);
    }
  }
  return sum;
}

/** A closed spline's enclosed area in its own plane, whichever plane: |½∮ p × p′|. */
function enclosed(c: BSpline): number {
  const v = [0, 1, 2].map((i) => overSpans(c, (p, d) => {
    const [j, k] = [(i + 1) % 3, (i + 2) % 3];
    return ((p[j] ?? 0) * (d[k] ?? 0) - (p[k] ?? 0) * (d[j] ?? 0)) / 2;
  }));
  return Math.hypot(...v);
}

type Part = { name: string; what: string; kernel: boolean; curves: boolean; build(m: Model): number };

const BLOB = [[0, 0], [10, 8], [22, 3], [18, -9], [5, -7]];
const D = [[0, 0], [8, 12], [20, 15], [32, 9], [40, 0]];

/** Points held where they are, on the ground. */
function laid(m: Model, xy: number[][]): string[] {
  const p = xy.map(([x, y]) => m.addPoint([x, y, 0]).name);
  for (const q of p) { onPlane(m, q, "origin"); fix(m, q, m.coords(q)); }
  return p;
}

const PARTS: Part[] = [
  {
    name: "spline-d", what: "an open spline over a line: a D, extruded 12", kernel: false, curves: false,
    build(m) {
      const p = laid(m, D);
      const s = addSpline(m, p);
      m.addLine(p[4], p[0]);
      extrude(m, s, 12);
      // The line along y = 0 adds nothing to ½∮ p × p′: the spline's own sweep is the D's area.
      return 12 * Math.abs(overSpans(splineCurve(m, s), (p, d) => (p[0] * d[1] - p[1] * d[0]) / 2));
    },
  },
  {
    name: "closed-spline", what: "a closed spline through five points, extruded 6", kernel: false, curves: false,
    build(m) {
      const s = addSpline(m, laid(m, BLOB), true);
      extrude(m, s, 6);
      return 6 * enclosed(splineCurve(m, s));
    },
  },
  {
    name: "tilted-spline", what: "a closed spline on a plane tipped 0.5 rad about x, in no frame's plane, extruded 9", kernel: false, curves: false,
    build(m) {
      const v = [0, Math.cos(0.5), Math.sin(0.5)];
      const p = [[0, 0], [12, 9], [24, 2], [17, -10], [4, -6]].map(([x, y]) => m.addPoint([2 + x, 3 + y * v[1], 4 + y * v[2]]).name);
      for (const q of p) fix(m, q, m.coords(q));
      const s = addSpline(m, p, true);
      extrude(m, s, 9);
      return 9 * enclosed(splineCurve(m, s));
    },
  },
  {
    name: "plate-spline-hole-boss", what: "the tilted plate, a closed spline cut through it from the top and a smaller one bossed 5 on it: the solid kernel's body", kernel: true, curves: false,
    build(m) {
      const pl = plate(m);
      m.solve(); // the lid where it is before points are laid on it
      const top = pl.lid.slice(0, 3).join(".");
      const blobAt = (u: number, v: number, k: number) => {
        const p = BLOB.map(([x, y]) => m.addPoint(onTop(pl, u + k * x, v + k * y)).name);
        for (const q of p) onPlane(m, q, top); // on the lid — fix would read a tilted frame's coordinates
        return addSpline(m, p, true);
      };
      const hole = blobAt(20, 30, 1);
      extrude(m, hole, -T, { mode: "cut" });
      const boss = blobAt(65, 30, 0.6);
      extrude(m, boss, 5);
      m.solve();
      return L * W * T - enclosed(splineCurve(m, hole)) * T + enclosed(splineCurve(m, boss)) * 5;
    },
  },
  {
    name: "spline-revolved", what: "the D in the xz plane turned a quarter about its straight side: a surface of revolution of the spline", kernel: false, curves: false,
    build(m) {
      const p = D.map(([x, z]) => m.addPoint([x, 0, z]).name);
      for (const q of p) fix(m, q, m.coords(q));
      const s = addSpline(m, p);
      const axis = m.addLine(p[4], p[0]).name;
      revolve(m, s, axis, Math.PI / 2);
      // Pappus: the turn by the D's first moment about the x axis, ∬ z dA = |∮ z²/2 dx|.
      return (Math.PI / 2) * Math.abs(overSpans(splineCurve(m, s), (p, d) => (p[2] * p[2] * d[0]) / 2));
    },
  },
  {
    name: "spline-wireframe", what: "the closed spline extruded 6, and a loose open spline beside it written as wireframe", kernel: false, curves: true,
    build(m) {
      const s = addSpline(m, laid(m, BLOB), true);
      extrude(m, s, 6);
      addSpline(m, laid(m, [[40, 0], [50, 10], [60, -5], [72, 4]]));
      return 6 * enclosed(splineCurve(m, s));
    },
  },
];

async function exported(part: Part) {
  await loadSolver();
  const m = new Model(3);
  const closedForm = part.build(m);
  assert.ok(m.solve().solved, `${part.name}: solved`);
  if (!part.kernel) {
    const x = stepExport(m, { name: part.name, timestamp: STAMP, curves: part.curves });
    return { closedForm, x, volume: solidsOf(m).bodies.reduce((t, b) => t + b.volume, 0) };
  }
  const { program, chains } = programOf(m);
  const ev = new Evaluator(await kernel());
  const results = ev.run(program).bodies;
  for (const r of results) assert.deepEqual(r.failed, [], `${part.name}: nothing refused`);
  const solids: KernelSolid[] = results.map((r) => ({
    body: kernelBody(m, r.name, ev.topology(r.name)!, r),
    features: chains.get(r.name)!.features.map((f) => f.name),
  }));
  ev.clear();
  return { closedForm, x: stepExport(m, { name: part.name, timestamp: STAMP }, solids), volume: results.reduce((t, r) => t + r.solid!.volume, 0) };
}

const census = (text: string) => [...parseStep(text).data.values()].map((e) => e.types.join("+")).sort().join(",");

/**
 * Parts OpenCascade's strict read (no healing) rejects, and why. Neither is the
 * spline's: each fails the same way with no spline in it, measured, and the
 * healed read — every application's — takes both, at the closed-form volume.
 */
const STRICT_FAILS = new Map([
  // The kernel closes the hole's wall along a seam it uses twice, and
  // kernelbrep.ts's splitSeams halves only circles: a concave seam face, the
  // same negative area turned-and-drilled has (stepkernel.test.ts). The boss's
  // wall, convex, reads.
  ["plate-spline-hole-boss", "a closed B-spline wall keeps its seam"],
  // The D's two ends are on the axis: the wall of a partial revolve meets the
  // axis at two poles. A circular segment and a triangle turned a quarter the
  // same way fail the same way, from this branch and from the one before it.
  ["spline-revolved", "a partial revolve's wall that meets its axis"],
]);

for (const part of PARTS) {
  test(`${part.name}: ${part.what} — OpenCascade read the committed file valid${STRICT_FAILS.has(part.name) ? "" : ", strict too"}, its volume the closed form, and today's export is the same part`, { skip: part.kernel ? noKernel : false }, async () => {
    const { closedForm, x, volume } = await exported(part);
    if (OUT) {
      mkdirSync(OUT, { recursive: true });
      writeFileSync(`${OUT}/${part.name}.step`, x.text);
      writeFileSync(`${OUT}/${part.name}.json`, JSON.stringify({ what: part.what, closedForm, zerocadVolume: volume, looseCurves: x.curves }, null, 1));
    }
    assert.ok(Math.abs(volume - closedForm) <= 1e-6 * closedForm, `${part.name}: ZeroCAD's volume ${volume} is the closed form ${closedForm}`);
    const file = new URL("validated.json", FIXTURES);
    if (!existsSync(file)) assert.fail("test/fixtures/step-spline/validated.json is missing — validate the spline parts (see the top of this file)");
    const validated = JSON.parse(readFileSync(file, "utf8")) as { parts: Record<string, {
      valid: boolean; strict: boolean; solids: number; volume: number; looseEdges: number; surfaces: Record<string, number>;
    }> };
    const v = validated.parts[part.name];
    assert.ok(v, `${part.name} was validated`);
    assert.equal(v.valid, true, `${part.name}: OpenCascade's checker found it valid, healed as an application reads it`);
    assert.equal(v.strict, !STRICT_FAILS.has(part.name), `${part.name}: strictly, with no healing but the pcurves a file without them needs — ${STRICT_FAILS.get(part.name) ?? "read"}`);
    assert.equal(v.solids, 1, `${part.name}: one solid`);
    assert.ok(Math.abs(v.volume - closedForm) <= 1e-6 * closedForm, `${part.name}: OpenCascade's volume ${v.volume} is the closed form ${closedForm}`);
    assert.equal(v.looseEdges, part.curves ? 1 : 0, `${part.name}: the loose spline is the wireframe's one edge`);
    assert.equal(census(x.text), census(readFileSync(new URL(`${part.name}.step`, FIXTURES), "utf8")), `${part.name}: the same entities as the validated fixture`);
  });
}
