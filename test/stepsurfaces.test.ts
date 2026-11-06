// STEP for surfaces (docs/plans/surfaces.md): a sheet as a
// SHELL_BASED_SURFACE_MODEL — an OPEN_SHELL of ADVANCED_FACEs whose boundary
// edges each belong to one face — in a MANIFOLD_SURFACE_SHAPE_REPRESENTATION;
// a thickened surface as the solid it is. Read back by the suite's own Part 21
// reader (stepread.ts), then against what OpenCascade measured reading the
// committed fixtures (test/fixtures/step-surfaces/validated.json), as the
// solids' are (stepkernel.test.ts).
//
// Regenerating the fixtures: NEOCAD_STEP_OUT=<dir> writes every part's file
// and ZeroCAD's figures there, for the validator to read (step-export.md's
// procedure; the validator is never part of this repo).

import { test } from "node:test";
import assert from "node:assert/strict";
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import "../src/modules/builtin.ts";
import { Model } from "../src/model.ts";
import { programOf } from "../src/bodies.ts";
import { kernelBody } from "../src/kernelbrep.ts";
import { stepExport, type KernelSolid } from "../src/step.ts";
import { Evaluator, type BodyResult } from "../src/solids/evaluate.ts";
import { neocadScope } from "../src/replenv.ts";
import { AP214_TYPES, parseStep, refOf, type Value } from "./stepread.ts";
import { loadSolver } from "./solids/scene.ts";
import { kernel, noKernel as skip } from "./solids/load.ts";

const STAMP = "2026-11-06T00:00:00";
const FIXTURES = new URL("./fixtures/step-surfaces/", import.meta.url);

/** The types a surface file adds: the kernel's B-splines, and the surface model's own entities. */
const TYPES = new Set([...AP214_TYPES, "B_SPLINE_CURVE_WITH_KNOTS", "B_SPLINE_CURVE", "BOUNDED_CURVE", "CURVE",
  "GEOMETRIC_REPRESENTATION_ITEM", "RATIONAL_B_SPLINE_CURVE", "REPRESENTATION_ITEM",
  "B_SPLINE_SURFACE_WITH_KNOTS", "B_SPLINE_SURFACE", "BOUNDED_SURFACE", "SURFACE", "RATIONAL_B_SPLINE_SURFACE",
  "OPEN_SHELL", "SHELL_BASED_SURFACE_MODEL", "MANIFOLD_SURFACE_SHAPE_REPRESENTATION", "SHAPE_REPRESENTATION_RELATIONSHIP"]);

type Fn = (...a: unknown[]) => unknown;

interface SurfacePart {
  name: string;
  what: string;
  build(m: Model, s: Record<string, Fn>): void;
  /** The sheet's area (null: a solid), and the solid's volume (null: a sheet), in closed form. */
  area: number | null;
  volume: number | null;
}

/** A 60 × 40 rectangle on the ground: its four lines. */
function rectangle(m: Model, w = 30, h = 20): string[] {
  const p = [[-w, -h, 0], [w, -h, 0], [w, h, 0], [-w, h, 0]].map((q) => m.addPoint(q).name);
  return p.map((q, i) => m.addLine(q, p[(i + 1) % 4]).name);
}

const W = 30, H = 20, R = 6, UP = 15, F = 4, T = 2;
const holed = 4 * W * H - Math.PI * R * R;
const knitFilleted = holed + 2 * W * UP - 2 * F * 2 * W + (Math.PI / 2) * F * 2 * W;

/** The plate with its hole, the wall off its front edge, knitted, the join filleted: e2e's part. */
function plateAndWall(m: Model, s: Record<string, Fn>): void {
  const lines = rectangle(m);
  s.surface(lines[0]);
  const c = m.addCircle(m.addPoint([10, 0, 0]).name, R, [0, 0, 1]).name;
  s.trim("s1", c, [-15, 10, 0]);
  s.surface([lines[0]], UP);
  s.knit("s1", "s3");
  s.fillet("s1", ["s1.base|s3.m0"], F);
}

const PARTS: SurfacePart[] = [
  {
    name: "planar-holed", what: "a rectangle's planar surface, trimmed by a circle on it",
    build(m, s) {
      const lines = rectangle(m);
      s.surface(lines[0]);
      const c = m.addCircle(m.addPoint([10, 0, 0]).name, R, [0, 0, 1]).name;
      s.trim("s1", c, [-15, 10, 0]);
    },
    area: holed, volume: null,
  },
  {
    name: "revolved-sheet", what: "a line turned whole about a parallel axis: a cylinder sheet, r 5 h 10",
    build(m, s) {
      const l = m.addLine(m.addPoint([5, 0, 0]).name, m.addPoint([5, 10, 0]).name).name;
      const axis = m.addLine(m.addPoint([0, 0, 0]).name, m.addPoint([0, 10, 0]).name).name;
      s.surface(l, axis);
    },
    area: 2 * Math.PI * 5 * 10, volume: null,
  },
  {
    name: "knit-filleted", what: "the holed plate and a wall off its front edge, knitted, the join filleted r 4",
    build: plateAndWall,
    area: knitFilleted, volume: null,
  },
  {
    name: "knit-thickened", what: "the same thickened 2: a solid",
    build(m, s) {
      plateAndWall(m, s);
      s.thicken("s1", T);
    },
    area: null,
    // The flat parts their area by T; the quarter cylinder, thickened off its
    // convex side (the sheet's normal, as measured), (π/2)·L·((F + T)² − F²)/2.
    volume: knitFilleted * T + (Math.PI / 2) * (2 * W) * T * T / 2,
  },
];

async function exported(part: SurfacePart) {
  await loadSolver();
  const m = new Model(3);
  const s = neocadScope({ model: m }) as Record<string, Fn>;
  part.build(m, s);
  m.solve();
  const { program, chains } = programOf(m);
  const ev = new Evaluator(await kernel());
  const results = ev.run(program).bodies;
  const solids: KernelSolid[] = results.map((r) => ({
    body: kernelBody(m, r.name, ev.topology(r.name)!, r),
    features: chains.get(r.name)!.features.map((f) => f.name),
  }));
  ev.clear();
  return { m, results, x: stepExport(m, { name: part.name, timestamp: STAMP }, solids) };
}

const area = (r: BodyResult) => r.solid!.faces.reduce((a, f) => a + f.area, 0);
const OUT = process.env.NEOCAD_STEP_OUT;

test("every surface part exports a file a reader can walk: known types, refs defined; a sheet an open shell whose edges are used once or twice, twice each way", { skip }, async () => {
  const summary: Record<string, unknown> = {};
  for (const part of PARTS) {
    const { results, x } = await exported(part);
    for (const r of results) assert.deepEqual(r.failed, [], `${part.name}: nothing refused`);
    const f = parseStep(x.text);
    for (const e of f.data.values()) {
      for (const t of e.types) assert.ok(TYPES.has(t), `${part.name}: ${t} is a type the exporter writes`);
      for (const r of e.refs) assert.ok(f.data.has(r), `${part.name}: #${e.id} refers to #${r}, which is defined`);
    }
    const of = (t: string) => [...f.data.values()].filter((e) => e.types[0] === t);
    if (part.area !== null) {
      assert.equal(of("SHELL_BASED_SURFACE_MODEL").length, 1, `${part.name}: one surface model`);
      assert.equal(of("MANIFOLD_SOLID_BREP").length, 0);
      assert.equal(of("MANIFOLD_SURFACE_SHAPE_REPRESENTATION").length, 1, "the product's shape is the surfaces'");
      // Each edge of the open shell: once (a boundary) or twice, in opposite senses (shared).
      const shell = of("OPEN_SHELL")[0];
      const uses = new Map<number, boolean[]>();
      for (const fr of shell.args[1] as Value[]) {
        const face = f.data.get(refOf(fr))!;
        for (const b of face.args[1] as Value[]) {
          const loop = f.data.get(refOf(f.data.get(refOf(b))!.args[1] as Value))!;
          for (const oe of loop.args[1] as Value[]) {
            const o = f.data.get(refOf(oe))!;
            const edge = refOf(o.args[3] as Value);
            uses.set(edge, [...(uses.get(edge) ?? []), o.args[4] === true]);
          }
        }
      }
      for (const [edge, senses] of uses) {
        assert.ok(senses.length === 1 || (senses.length === 2 && senses[0] !== senses[1]), `${part.name}: edge #${edge} used ${JSON.stringify(senses)}`);
      }
      const r = results[0];
      assert.ok(Math.abs(area(r) - part.area) < 1e-6 * part.area, `${part.name}: the kernel's area ${area(r)} against ${part.area}`);
    } else {
      assert.equal(of("MANIFOLD_SOLID_BREP").length, 1, `${part.name}: a solid`);
      const v = results[0].solid!.volume;
      assert.ok(part.volume !== null && Math.abs(v - part.volume) < 1e-6 * part.volume, `${part.name}: the kernel's volume ${v} against ${part.volume}`);
      assert.equal(of("SHELL_BASED_SURFACE_MODEL").length, 0);
    }
    if (OUT) {
      mkdirSync(OUT, { recursive: true });
      writeFileSync(`${OUT}/${part.name}.step`, x.text);
      summary[part.name] = {
        what: part.what, area: part.area, volume: part.volume,
        zerocad: results.map((r) => ({ name: r.name, area: area(r), volume: r.solid!.volume, manifold: r.solid!.validity.manifold, faces: r.solid!.faces.length })),
      };
    }
  }
  if (OUT) writeFileSync(`${OUT}/zerocad.json`, JSON.stringify(summary, null, 1));
});

test("a model with surfaces and a solid: the solid the product's shape, the surfaces related to it", { skip }, async () => {
  await loadSolver();
  const m = new Model(3);
  const s = neocadScope({ model: m }) as Record<string, Fn>;
  const lines = rectangle(m);
  s.surface(lines[0]);
  const far = rectangle(m, 5, 5).map((l) => l);
  void far;
  (s.extrude as Fn)(far[0], 3);
  m.solve();
  const ev = new Evaluator(await kernel());
  const { program, chains } = programOf(m);
  const results = ev.run(program).bodies;
  const solids = results.map((r) => ({ body: kernelBody(m, r.name, ev.topology(r.name)!, r), features: chains.get(r.name)!.features.map((f) => f.name) }));
  ev.clear();
  const x = stepExport(m, { name: "both", timestamp: STAMP }, solids);
  const f = parseStep(x.text);
  const of = (t: string) => [...f.data.values()].filter((e) => e.types[0] === t);
  assert.equal(of("MANIFOLD_SOLID_BREP").length, 1, "the extrude");
  assert.equal(of("SHELL_BASED_SURFACE_MODEL").length, 1, "the surface");
  assert.equal(of("ADVANCED_BREP_SHAPE_REPRESENTATION").length, 1);
  assert.equal(of("MANIFOLD_SURFACE_SHAPE_REPRESENTATION").length, 1);
  assert.equal(of("SHAPE_REPRESENTATION_RELATIONSHIP").length, 1, "related to the solids', as the wireframe is");
  assert.deepEqual(x.bodies.map((b) => b.name), ["e1", "s1"], "the feature first, then the surface");
});

test("the committed fixtures are what OpenCascade read — a shell of the closed-form area, a valid solid — and today's export is the same part", { skip }, async () => {
  const file = new URL("validated.json", FIXTURES);
  if (!existsSync(file)) assert.fail("test/fixtures/step-surfaces/validated.json is missing — validate the surface parts (see the top of this file)");
  const validated = JSON.parse(readFileSync(file, "utf8")) as { parts: Record<string, {
    valid: boolean; shells: number; solids: number; freeEdges: number; area: number; volume: number | null; readerFails: number;
  }> };
  assert.deepEqual(Object.keys(validated.parts).sort(), PARTS.map((p) => p.name).sort(), "every part was validated");
  for (const part of PARTS) {
    const v = validated.parts[part.name];
    assert.equal(v.valid, true, `${part.name}: OpenCascade's checker found it valid`);
    assert.equal(v.readerFails, 0, `${part.name}: read without a failure`);
    const { results, x } = await exported(part);
    if (part.area !== null) {
      assert.equal(v.solids, 0);
      assert.equal(v.shells, 1, `${part.name}: one shell`);
      assert.ok(v.freeEdges > 0, `${part.name}: open — it has a boundary`);
      assert.ok(Math.abs(v.area - part.area) <= 1e-6 * part.area, `${part.name}: OpenCascade's area ${v.area} is the closed form ${part.area}`);
      assert.ok(Math.abs(area(results[0]) - v.area) <= 1e-6 * v.area, `${part.name}: ZeroCAD's area is OpenCascade's`);
    } else {
      assert.equal(v.solids, 1, `${part.name}: one solid`);
      assert.ok(v.volume !== null && Math.abs(results[0].solid!.volume - v.volume) <= 1e-6 * v.volume, `${part.name}: ZeroCAD's volume ${results[0].solid!.volume} is OpenCascade's ${v.volume}`);
      assert.ok(Math.abs(v.volume - part.volume!) <= 1e-6 * part.volume!, `${part.name}: OpenCascade's volume ${v.volume} is the closed form ${part.volume}`);
    }
    const census = (text: string) => [...parseStep(text).data.values()].map((e) => e.types.join("+")).sort().join(",");
    assert.equal(census(x.text), census(readFileSync(new URL(`${part.name}.step`, FIXTURES), "utf8")), `${part.name}: the same entities as the validated fixture`);
  }
});
