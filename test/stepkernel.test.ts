// STEP for the bodies the solid kernel builds (docs/plans/solids-kernel.md):
// one solid per body, its topology the kernel's, each face on the analytic
// surface its feature says (a cut's wall a cylinder, a boss's lid a plane) and
// on the kernel's own NURBS where none does, its edges lines and circles where
// they are and the kernel's B-splines where they are not (a boss on a curved
// wall). Read back by the suite's own Part 21 reader (stepread.ts) with every
// topological rule a kernel checks, then against what OpenCascade measured
// reading the committed fixtures (test/fixtures/step-kernel/validated.json).
//
// Regenerating the fixtures: NEOCAD_STEP_OUT=<dir> writes every part's file
// and ZeroCAD's figures there, for the validator to read (step-export.md's
// procedure; the validator is never part of this repo).

import { test } from "node:test";
import assert from "node:assert/strict";
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { Model } from "../src/model.ts";
import { extrude, revolve } from "../src/operations.ts";
import { programOf } from "../src/bodies.ts";
import { kernelBody } from "../src/kernelbrep.ts";
import { stepExport, STEP_UNCERTAINTY, type KernelSolid } from "../src/step.ts";
import { Evaluator } from "../src/solids/evaluate.ts";
import { parallel } from "../src/relations/geometry.ts";
import { AP214_TYPES, checkShell, genus, parseStep, refOf, type Value } from "./stepread.ts";
import { L, T, W, circleOn, loadSolver, onTop, plate } from "./solids/scene.ts";
import { polygon } from "./profiles.ts";
import { kernel, noKernel as skip } from "./solids/load.ts";

const neg = (v: number[]) => v.map((c) => -c);
const STAMP = "2026-11-04T00:00:00";
const FIXTURES = new URL("./fixtures/step-kernel/", import.meta.url);

/** The types a kernel body adds to the exporter's set: its B-splines, exactly. */
const KERNEL_TYPES = new Set([...AP214_TYPES, "B_SPLINE_CURVE_WITH_KNOTS", "B_SPLINE_CURVE", "BOUNDED_CURVE", "CURVE",
  "GEOMETRIC_REPRESENTATION_ITEM", "RATIONAL_B_SPLINE_CURVE", "REPRESENTATION_ITEM",
  "B_SPLINE_SURFACE_WITH_KNOTS", "B_SPLINE_SURFACE", "BOUNDED_SURFACE", "SURFACE", "RATIONAL_B_SPLINE_SURFACE"]);

interface KernelPart {
  name: string;
  what: string;
  build(m: Model): void;
  /** The volume in closed form, or null where there is none to hand (a boss on a cylinder). */
  volume: number | null;
}

const PARTS: KernelPart[] = [
  {
    name: "owner-part", what: "a plate, a hole cut through from the top, a boss on a side",
    build(m) {
      const p = plate(m);
      const top = p.lid.slice(0, 3).join(".");
      extrude(m, circleOn(m, top, onTop(p, 30, 30), 5, p.t.uz), -T, { mode: "cut" });
      extrude(m, circleOn(m, [p.base[0], p.base[1], p.lid[0]].join("."), p.t.at(70, 0, T / 2), 3, neg(p.t.uy)), 8);
    },
    volume: L * W * T - Math.PI * 25 * T + Math.PI * 9 * 8,
  },
  {
    name: "pocket-boss-breakout", what: "a blind pocket, a boss standing on the top, a hole breaking out through a wall",
    build(m) {
      const p = plate(m);
      const top = p.lid.slice(0, 3).join(".");
      extrude(m, circleOn(m, top, onTop(p, 25, 30), 8, p.t.uz), -4, { mode: "cut" });
      extrude(m, circleOn(m, top, onTop(p, 60, 30), 6, p.t.uz), 5);
      // Across the lid's edge: the whole circle, not the loops its crossing makes.
      const c = circleOn(m, top, onTop(p, 98, 30), 5, p.t.uz);
      extrude(m, c, -T - 2, top, [[c]], null, { mode: "cut" });
    },
    volume: (() => {
      const r = 5, h = 2;
      const segment = r * r * Math.acos(-h / r) + h * Math.sqrt(r * r - h * h);
      return L * W * T - Math.PI * 64 * 4 + Math.PI * 36 * 5 - segment * T;
    })(),
  },
  {
    name: "boss-on-cylinder", what: "a cylinder lying on its side, a boss stood on its curved wall: edges no circle or line is",
    build(m) {
      const p = plate(m);
      // A rod along the plate's top, half sunk into it: its wall meets the boss in a general curve.
      const c = m.addPoint(p.t.at(-30, 30, 20)).name;
      const rod = m.addCircle(c, 8, p.t.ux).name;
      parallel(m, rod, "t.x");
      extrude(m, rod, 60, null, null, null, { mode: "new" });
      const boss = m.addPoint(p.t.at(0, 30, 35)).name;
      const ring = m.addCircle(boss, 3, p.t.uz).name;
      parallel(m, ring, "t.z");
      extrude(m, ring, -10, null, null, null, { mode: "add", into: "e2" });
    },
    volume: null,
  },
  {
    name: "turned-and-drilled", what: "a revolved collar, drilled through across its axis",
    build(m) {
      const p = plate(m);
      const sq = polygon(m, p.t, [[-40, 0], [-30, 0], [-30, 20], [-40, 20]]);
      revolve(m, sq.lines[0], "t.y");
      // A hole across, through both walls: a cylinder meeting two cylinders.
      const c = m.addPoint(p.t.at(-60, 10, 0)).name;
      const drill = m.addCircle(c, 3, p.t.ux).name;
      parallel(m, drill, "t.x");
      extrude(m, drill, 120, null, null, null, { mode: "cut", into: "e2" });
    },
    volume: null,
  },
];

async function exported(part: KernelPart) {
  const m = new Model(3);
  part.build(m);
  m.solve();
  const { program, chains } = programOf(m);
  const ev = new Evaluator(await kernel());
  const results = ev.run(program).bodies;
  const solids: KernelSolid[] = results.map((r) => ({
    body: kernelBody(m, r.name, ev.topology(r.name)!, r),
    features: chains.get(r.name)!.features.map((f) => f.name),
  }));
  return { m, results, x: stepExport(m, { name: part.name, timestamp: STAMP }, solids) };
}

const OUT = process.env.NEOCAD_STEP_OUT;

/** Parts OpenCascade's strict read rejects, and why — see the last test. */
const STRICT_FAILS = new Set(["turned-and-drilled"]);

test("every kernel part exports a file a reader can walk: refs defined, known types, closed loops, each edge twice once each way", { skip }, async () => {
  await loadSolver();
  const summary: Record<string, unknown> = {};
  for (const part of PARTS) {
    const { results, x } = await exported(part);
    const f = parseStep(x.text);
    for (const e of f.data.values()) {
      for (const t of e.types) assert.ok(KERNEL_TYPES.has(t), `${part.name}: ${t} is a type the exporter writes`);
      for (const r of e.refs) assert.ok(f.data.has(r), `${part.name}: #${e.id} refers to #${r}, which is defined`);
    }
    const breps = [...f.data.values()].filter((e) => e.types[0] === "MANIFOLD_SOLID_BREP");
    for (const b of breps) {
      const stats = checkShell(f, refOf(b.args[1] as Value), `${part.name} ${b.args[0]}`, true);
      assert.ok(Number.isInteger(genus(stats)), `${part.name}: a whole genus`);
    }
    const kernelBodies = results.length;
    assert.ok(kernelBodies >= 1);
    for (const r of results) {
      assert.deepEqual(r.failed, [], `${part.name}: nothing refused`);
      assert.deepEqual(r.solid!.validity, { manifold: true, failures: 0 }, `${part.name}: a valid solid`);
    }
    if (part.volume !== null) {
      const v = results.reduce((s, r) => s + r.solid!.volume, 0);
      assert.ok(Math.abs(v - part.volume) < 1e-6 * part.volume, `${part.name}: the kernel's ${v} against ${part.volume}`);
    }
    if (OUT) {
      mkdirSync(OUT, { recursive: true });
      writeFileSync(`${OUT}/${part.name}.step`, x.text);
      summary[part.name] = { what: part.what, closed: part.volume, bodies: x.bodies.map((b) => ({ name: b.name, volume: b.volume, box: b.box, faces: b.outer.faces.length })) };
    }
  }
  if (OUT) writeFileSync(`${OUT}/zerocad.json`, JSON.stringify(summary, null, 1));
});

test("an untouched face keeps its analytic surface; the owner's part has no B-spline at all", { skip }, async () => {
  await loadSolver();
  const { x } = await exported(PARTS[0]);
  const f = parseStep(x.text);
  const count = (t: string) => [...f.data.values()].filter((e) => e.types.includes(t)).length;
  assert.equal(count("MANIFOLD_SOLID_BREP"), 1, "one solid: the body, not three features");
  assert.equal(count("PLANE"), 7, "six sides and the boss's end");
  // A whole cylinder is two halves, as solids.ts writes one (kernelbrep.ts's splitSeams).
  assert.equal(count("CYLINDRICAL_SURFACE"), 4, "the hole and the boss, each in two halves");
  assert.equal(count("B_SPLINE_SURFACE_WITH_KNOTS") + count("B_SPLINE_CURVE_WITH_KNOTS"), 0, "every face and edge analytic");
  assert.equal(count("CIRCLE"), 8, "the hole's two rims and the boss's two, each two half circles");
  assert.ok(x.text.includes("LENGTH_MEASURE(1.E-7)"), "and the file claims the 1e-7 it holds");
  void STEP_UNCERTAINTY;
});

test("a boss on a curved wall: the edge where they meet is the kernel's B-spline, exactly", { skip }, async () => {
  await loadSolver();
  const { x } = await exported(PARTS[2]);
  const f = parseStep(x.text);
  const splines = [...f.data.values()].filter((e) => e.types.includes("B_SPLINE_CURVE_WITH_KNOTS"));
  assert.ok(splines.length >= 1, "an intersection curve no circle is");
});

test("the committed fixtures are what OpenCascade read as valid closed solids, and today's export is the same part", { skip }, async () => {
  await loadSolver();
  const file = new URL("validated.json", FIXTURES);
  if (!existsSync(file)) assert.fail("test/fixtures/step-kernel/validated.json is missing — validate the kernel parts (see the top of this file)");
  const validated = JSON.parse(readFileSync(file, "utf8")) as { parts: Record<string, { valid: boolean; strict: boolean; volume: number; zerocadVolume: number; closedForm: number | null; bodies: number }> };
  assert.deepEqual(Object.keys(validated.parts).sort(), PARTS.map((p) => p.name).sort(), "every part was validated");
  for (const part of PARTS) {
    const v = validated.parts[part.name];
    assert.equal(v.valid, true, `${part.name}: OpenCascade found it a valid closed solid`);
    // The strict read, without healing, takes every part but one: a seam face a
    // boolean crossed (a full revolve drilled across, through its seam) keeps
    // its seam, and OpenCascade's unhealed translation computes a negative
    // area on the concave ones. Known and left (kernelbrep.ts's splitSeams;
    // TODO.md); the healed read, which is every application's, takes it.
    assert.equal(v.strict, !STRICT_FAILS.has(part.name), `${part.name}: the read without healing`);
    const { x } = await exported(part);
    const volume = x.bodies.reduce((s, b) => s + b.volume, 0);
    // To a part in a billion where every edge is a line or a circle; where the
    // kernel's intersection curves bound a face, OpenCascade's integral and
    // the kernel's differ by about a part in a million — and the kernel's is
    // the nearer to a closed form where one could be worked out (the boss on
    // the rod: 72265.68564 by numerical integration, kernel 72265.68543,
    // OpenCascade 72265.60145).
    const tol = v.closedForm === null ? 2e-6 : 1e-9;
    assert.ok(Math.abs(volume - v.volume) <= tol * v.volume, `${part.name}: ZeroCAD's volume ${volume} is OpenCascade's ${v.volume}`);
    if (v.closedForm !== null) assert.ok(Math.abs(v.volume - v.closedForm) <= 1e-9 * v.closedForm, `${part.name}: OpenCascade's volume is the closed form`);
    const census = (text: string) => [...parseStep(text).data.values()].map((e) => e.types.join("+")).sort().join(",");
    assert.equal(census(x.text), census(readFileSync(new URL(`${part.name}.step`, FIXTURES), "utf8")), `${part.name}: the same entities as the validated fixture`);
  }
});
