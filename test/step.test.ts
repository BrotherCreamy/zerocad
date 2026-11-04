// STEP export (docs/plans/step-export.md): the model's solids as an ISO
// 10303-21 file another CAD tool reads as the part it is.
//
// "It wrote a file" proves nothing — a file that looks right and fails to
// import is worse than none. So the files are read back here with a Part 21
// parser of this suite's own, and checked the way a kernel would check them:
// every `#n` referenced is defined, every entity type is one of the AP214
// set the exporter is allowed (the set OpenCascade read without a warning),
// every loop closes, every edge is used by exactly two faces in opposite
// senses, every vertex lies on its edges' curves and its faces' surfaces, and
// each shell's Euler characteristic is what its genus says. Then ZeroCAD's own
// volume and extent against the closed forms — and against what OpenCascade
// measured reading the committed fixtures (test/fixtures/step/validated.json,
// how it was read and when are in that file).
//
// Regenerating the fixtures: NEOCAD_STEP_OUT=<dir> npm test writes every
// part's file and ZeroCAD's figures there, for the validator to read.

import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { readFile } from "node:fs/promises";
import { ensureKernelLoaded } from "../src/kernel/problem.ts";
import { Model } from "../src/model.ts";
import { real, str, stepExport, stepFileName, STEP_SCHEMA, STEP_TYPE, STEP_UNCERTAINTY } from "../src/step.ts";
import { solidsOf, surfaceNormal, type Surface } from "../src/solids.ts";
import { neocadScope } from "../src/replenv.ts";
import { hide, show } from "../src/groups.ts";
import { extrude } from "../src/operations.ts";
import { exportRoute } from "../src/files.ts";
import { axisFrame } from "./frames.ts";
import { polygon } from "./profiles.ts";
import { parts, type Part } from "./stepparts.ts";
import { AP214_TYPES, checkShell, coordsOf, genus, parseStep, refOf, type ShellStats, type StepFile, type Value } from "./stepread.ts";

async function loadKernel() {
  const bytes = await readFile(new URL("../src/kernel/wasm-gen/neocad_kernel_bg.wasm", import.meta.url));
  await ensureKernelLoaded(bytes);
}

const FIXTURES = new URL("./fixtures/step/", import.meta.url);
const STAMP = "2026-11-04T00:00:00";

// ---- geometry: every vertex where its curves and surfaces say ----------------------------

function vec(f: StepFile, id: number): number[] {
  return coordsOf(f, id);
}

function placement(f: StepFile, id: number): { o: number[]; z: number[]; x: number[] } {
  const a = f.data.get(id)!;
  assert.equal(a.types[0], "AXIS2_PLACEMENT_3D");
  return { o: vec(f, refOf(a.args[1])), z: vec(f, refOf(a.args[2])), x: vec(f, refOf(a.args[3])) };
}

const sub = (a: number[], b: number[]) => a.map((x, i) => x - b[i]);
const dot = (a: number[], b: number[]) => a.reduce((s, x, i) => s + x * b[i], 0);
const len = (a: number[]) => Math.hypot(...a);
const radial = (p: number[], o: number[], z: number[]) => { const d = sub(p, o); const h = dot(d, z); return d.map((x, i) => x - h * z[i]); };

/** How far `p` is from a curve or surface instance. */
function distance(f: StepFile, id: number, p: number[]): number {
  const e = f.data.get(id)!;
  const t = e.types[0];
  if (t === "LINE") {
    const o = vec(f, refOf(e.args[1]));
    const d = vec(f, refOf(f.data.get(refOf(e.args[2]))!.args[1]));
    return len(radial(p, o, d));
  }
  if (t === "SURFACE_OF_REVOLUTION") {
    const ax = f.data.get(refOf(e.args[2]))!;
    const [o, k] = [vec(f, refOf(ax.args[1])), vec(f, refOf(ax.args[2]))];
    const c = f.data.get(refOf(e.args[1]))!;
    const pc = placement(f, refOf(c.args[1]));
    const r = c.args[2] as number;
    // Turn p into the swept circle's plane, about the axis, and measure to the circle there.
    const rho = len(radial(p, o, k)), h = dot(sub(p, o), k);
    const inPlane = radial(pc.o, o, k);
    const out = len(inPlane) > 1e-12 ? inPlane.map((x) => x / len(inPlane)) : unitPerp(k, pc.z);
    const q = o.map((x, i) => x + h * k[i] + rho * out[i]);
    const q2 = o.map((x, i) => x + h * k[i] - rho * out[i]);
    return Math.min(...[q, q2].map((qq) => Math.abs(len(sub(qq, pc.o)) - r) + Math.abs(dot(sub(qq, pc.o), pc.z))));
  }
  const pl = placement(f, refOf(e.args[1]));
  const [r0, r1] = [e.args[2] as number, e.args[3] as number];
  const rr = radial(p, pl.o, pl.z);
  switch (t) {
    case "CIRCLE": return Math.hypot(len(rr) - r0, dot(sub(p, pl.o), pl.z));
    case "PLANE": return Math.abs(dot(sub(p, pl.o), pl.z));
    case "CYLINDRICAL_SURFACE": return Math.abs(len(rr) - r0);
    case "CONICAL_SURFACE": {
      const h = dot(sub(p, pl.o), pl.z);
      return Math.abs(len(rr) - (r0 + h * Math.tan(r1))) * Math.cos(r1);
    }
    case "SPHERICAL_SURFACE": return Math.abs(len(sub(p, pl.o)) - r0);
    case "TOROIDAL_SURFACE": {
      const h = dot(sub(p, pl.o), pl.z);
      return Math.abs(Math.hypot(len(rr) - r0, h) - r1);
    }
  }
  throw new Error(`no distance to a ${t}`);
}

function unitPerp(k: number[], n: number[]): number[] {
  const c = [k[1] * n[2] - k[2] * n[1], k[2] * n[0] - k[0] * n[2], k[0] * n[1] - k[1] * n[0]];
  return c.map((x) => x / len(c));
}

/** The worst distance of any vertex from a curve or surface it is on, across the file. */
function worstGap(f: StepFile): number {
  let worst = 0;
  const point = (vp: number) => vec(f, refOf(f.data.get(vp)!.args[1]));
  for (const e of f.data.values()) {
    if (e.types[0] === "EDGE_CURVE") {
      for (const v of [refOf(e.args[1]), refOf(e.args[2])]) worst = Math.max(worst, distance(f, refOf(e.args[3]), point(v)));
    }
    if (e.types[0] === "ADVANCED_FACE") {
      const surface = refOf(e.args[2]);
      for (const b of (e.args[1] as Value[]).map(refOf)) {
        const loop = f.data.get(refOf(f.data.get(b)!.args[1]))!;
        for (const oe of (loop.args[1] as Value[]).map(refOf)) {
          const edge = f.data.get(refOf(f.data.get(oe)!.args[3]))!;
          for (const v of [refOf(edge.args[1]), refOf(edge.args[2])]) worst = Math.max(worst, distance(f, surface, point(v)));
        }
      }
    }
  }
  return worst;
}

// ---- what each part must be ---------------------------------------------------------------

/** Per part: each body's faces by surface type, its shells' genus, and its entity count — pinned. */
const PINNED: Record<string, { surfaces: Record<string, number>[]; genus: number[][] }> = {
  "box": { surfaces: [{ PLANE: 6 }], genus: [[0]] },
  "plate-hole": { surfaces: [{ PLANE: 6, CYLINDRICAL_SURFACE: 2 }], genus: [[1]] },
  "fillet": { surfaces: [{ PLANE: 6, CYLINDRICAL_SURFACE: 1 }], genus: [[0]] },
  "cylinder": { surfaces: [{ PLANE: 2, CYLINDRICAL_SURFACE: 2 }], genus: [[0]] },
  "partial-revolve": { surfaces: [{ PLANE: 4, CYLINDRICAL_SURFACE: 2 }], genus: [[0]] },
  "cone-torus": { surfaces: [{ PLANE: 4, CONICAL_SURFACE: 2, TOROIDAL_SURFACE: 2, CYLINDRICAL_SURFACE: 2 }], genus: [[1]] },
  "two-bodies": { surfaces: [{ PLANE: 6 }, { PLANE: 2, CYLINDRICAL_SURFACE: 2 }], genus: [[0], [0]] },
  "tilted": { surfaces: [{ PLANE: 6, CYLINDRICAL_SURFACE: 2 }], genus: [[1]] },
  "sphere": { surfaces: [{ SPHERICAL_SURFACE: 2 }], genus: [[0]] },
  // A ring: the arc swept outside, the line parallel to the axis inside.
  "spindle": { surfaces: [{ SURFACE_OF_REVOLUTION: 2, CYLINDRICAL_SURFACE: 2 }], genus: [[1]] },
  // The outer shell a ring (genus 1), and the cavity a torus's (genus 1).
  "cavity": { surfaces: [{ PLANE: 4, CYLINDRICAL_SURFACE: 4, TOROIDAL_SURFACE: 4 }], genus: [[1, 1]] },
  "island": { surfaces: [{ PLANE: 6, CYLINDRICAL_SURFACE: 2 }, { PLANE: 2, CYLINDRICAL_SURFACE: 2 }], genus: [[1], [0]] },
  "tilted-revolve": { surfaces: [{ PLANE: 4, CYLINDRICAL_SURFACE: 2, TOROIDAL_SURFACE: 1 }], genus: [[0]] },
  "wireframe": { surfaces: [{ PLANE: 6 }], genus: [[0]] },
};

interface Validated {
  kernel: string;
  read: string;
  tolerance: { volume: string; box: string };
  parts: Record<string, { valid: boolean; volume: number; box: number[][]; bodies: number; strict: boolean }>;
}

function exported(p: Part) {
  return stepExport(p.model, { name: p.name, timestamp: STAMP, curves: p.curves !== undefined });
}

/** Each body's shells, walked and counted. */
function bodiesOf(f: StepFile): { name: string; shells: ShellStats[] }[] {
  const out: { name: string; shells: ShellStats[] }[] = [];
  for (const e of f.data.values()) {
    if (e.types[0] === "MANIFOLD_SOLID_BREP") out.push({ name: e.args[0] as string, shells: [checkShell(f, refOf(e.args[1]), e.args[0] as string)] });
    if (e.types[0] === "BREP_WITH_VOIDS") {
      const voids = (e.args[2] as Value[]).map(refOf).map((v) => {
        const ocs = f.data.get(v)!;
        assert.equal(ocs.types[0], "ORIENTED_CLOSED_SHELL");
        assert.equal(ocs.args[3], false, "a void is its cavity's shell turned inside out, as OpenCascade writes one");
        return checkShell(f, refOf(ocs.args[2]), `${e.args[0]} void`);
      });
      out.push({ name: e.args[0] as string, shells: [checkShell(f, refOf(e.args[1]), e.args[0] as string), ...voids] });
    }
  }
  return out;
}

// ---- the tests ------------------------------------------------------------------------------

test("every test part exports a file a reader can walk: refs defined, AP214 types only, closed loops, each edge twice and once each way, the genus its shape has", async () => {
  await loadKernel();
  for (const p of parts()) {
    const x = exported(p);
    const f = parseStep(x.text);
    for (const e of f.data.values()) {
      for (const t of e.types) assert.ok(AP214_TYPES.has(t), `${p.name}: ${t} is one of the AP214 types the exporter writes`);
      for (const r of e.refs) assert.ok(f.data.has(r), `${p.name}: #${e.id} refers to #${r}, which is defined`);
    }
    const bodies = bodiesOf(f);
    assert.equal(bodies.length, p.bodies, `${p.name}: ${p.bodies} bodies`);
    const pin = PINNED[p.name];
    assert.ok(pin, `${p.name} is pinned`);
    bodies.forEach((b, i) => {
      const all: Record<string, number> = {};
      for (const s of b.shells) for (const [k, n] of Object.entries(s.surfaces)) all[k] = (all[k] ?? 0) + n;
      assert.deepEqual(all, pin.surfaces[i], `${p.name} ${b.name}: its faces, by surface`);
      assert.deepEqual(b.shells.map(genus), pin.genus[i], `${p.name} ${b.name}: each shell's genus`);
    });
    // Every vertex on every curve and surface it bounds, well inside the
    // uncertainty the file declares.
    assert.ok(worstGap(f) < STEP_UNCERTAINTY / 10, `${p.name}: vertices on their curves and surfaces (worst ${worstGap(f).toExponential(2)})`);
  }
});

test("ZeroCAD's volumes are the closed forms, to rounding — Green's theorem for an extrude's area, Pappus for a revolve", async () => {
  await loadKernel();
  for (const p of parts()) {
    const total = exported(p).bodies.reduce((s, b) => s + b.volume, 0);
    if (p.volume !== null) assert.ok(Math.abs(total - p.volume) <= 1e-9 * p.volume, `${p.name}: ${total} is ${p.volume}`);
    else assert.ok(total > 0, `${p.name}: a positive volume`);
  }
});

test("the committed fixtures are what OpenCascade read as valid closed solids, and today's export is the same part: its volume and extent, and its entities type for type", async () => {
  await loadKernel();
  const validated = JSON.parse(readFileSync(new URL("validated.json", FIXTURES), "utf8")) as Validated;
  const list = parts();
  assert.deepEqual(Object.keys(validated.parts).sort(), list.map((p) => p.name).sort(), "every part was validated");
  for (const p of list) {
    const v = validated.parts[p.name];
    assert.equal(v.valid, true, `${p.name}: OpenCascade found it a valid closed solid`);
    assert.equal(v.strict, true, `${p.name}: and so did the read without shape healing`);
    const x = exported(p);
    assert.equal(x.bodies.length, v.bodies);
    const volume = x.bodies.reduce((s, b) => s + b.volume, 0);
    assert.ok(Math.abs(volume - v.volume) <= 1e-9 * v.volume, `${p.name}: ZeroCAD's volume ${volume} is OpenCascade's ${v.volume}`);
    const lo = [0, 1, 2].map((i) => Math.min(...x.bodies.map((b) => b.box[0][i])));
    const hi = [0, 1, 2].map((i) => Math.max(...x.bodies.map((b) => b.box[1][i])));
    for (let i = 0; i < 3; i++) {
      assert.ok(Math.abs(lo[i] - v.box[0][i]) <= 1e-6 && Math.abs(hi[i] - v.box[1][i]) <= 1e-6, `${p.name}: extent along axis ${i}`);
    }
    // The fixture is the file that was read; today's must be the same part
    // entity for entity (the numbers may differ in their last digits as the
    // solver does, which the volume and extent above bound).
    const fixture = parseStep(readFileSync(new URL(`${p.name}.step`, FIXTURES), "utf8"));
    const now = parseStep(x.text);
    const census = (f: StepFile) => [...f.data.values()].map((e) => e.types.join("+")).sort().join(",");
    assert.equal(census(now), census(fixture), `${p.name}: the same entities as the validated fixture`);
  }
});

test("the header: AP214's schema, the document's name and the stamp, millimetres and radians, a length uncertainty", async () => {
  await loadKernel();
  const p = parts()[0];
  const x = stepExport(p.model, { name: "Bracket “v2” — it's", timestamp: STAMP });
  const f = parseStep(x.text);
  assert.ok(f.header.includes(`FILE_SCHEMA(('${STEP_SCHEMA}'));`));
  assert.equal(STEP_SCHEMA, "AUTOMOTIVE_DESIGN { 1 0 10303 214 1 1 1 1 }");
  const name = f.header.find((l) => l.startsWith("FILE_NAME("))!;
  assert.ok(name.includes(`'2026-11-04T00:00:00'`), name);
  // Out of ASCII as \X2\…\X0\, a quote doubled.
  assert.ok(name.includes("'Bracket \\X2\\201C\\X0\\v2\\X2\\201D\\X0\\ \\X2\\2014\\X0\\ it''s.step'"), name);
  const types = [...f.data.values()].flatMap((e) => e.types);
  for (const t of ["PRODUCT", "PRODUCT_DEFINITION", "PRODUCT_DEFINITION_SHAPE", "SHAPE_DEFINITION_REPRESENTATION", "ADVANCED_BREP_SHAPE_REPRESENTATION", "MANIFOLD_SOLID_BREP"]) {
    assert.ok(types.includes(t), t);
  }
  const mm = [...f.data.values()].find((e) => e.types.includes("LENGTH_UNIT"))!;
  assert.deepEqual(mm.parts.get("SI_UNIT"), [{ enum: "MILLI" }, { enum: "METRE" }]);
  const rad = [...f.data.values()].find((e) => e.types.includes("PLANE_ANGLE_UNIT"))!;
  assert.deepEqual(rad.parts.get("SI_UNIT"), [null, { enum: "RADIAN" }]);
  assert.ok(x.text.includes(`LENGTH_MEASURE(${real(STEP_UNCERTAINTY)})`));
  // Each body is named for its feature, so a receiving tool lists e1, e2.
  const brep = [...f.data.values()].find((e) => e.types[0] === "MANIFOLD_SOLID_BREP")!;
  assert.equal(brep.args[0], "e1");
});

test("Part 21's spelling: a REAL always has its point, an exponent its E; a string quotes, doubles and escapes", () => {
  assert.equal(real(1), "1.");
  assert.equal(real(0), "0.");
  assert.equal(real(-0), "0.");
  assert.equal(real(-2.5), "-2.5");
  assert.equal(real(1e-7), "1.E-7");
  assert.equal(real(1.5e-7), "1.5E-7");
  assert.equal(real(1e21), "1.E21");
  assert.equal(Number(real(Math.PI)), Math.PI, "the shortest text that reads back as the same double");
  assert.throws(() => real(NaN), /cannot hold/);
  assert.equal(str("e1"), "'e1'");
  assert.equal(str("it's"), "'it''s'");
  assert.equal(str("a\\b"), "'a\\\\b'");
  assert.equal(str("π"), "'\\X2\\03C0\\X0\\'");
  assert.equal(stepFileName("plate/2"), "plate-2.step");
  assert.equal(stepFileName(""), "Untitled.step");
  assert.equal(STEP_TYPE, "model/step");
});

test("with no solid it says so and writes nothing; a hidden solid is left out and named, and all hidden says why", async () => {
  await loadKernel();
  const m = new Model(3);
  axisFrame(m, "f");
  const t = { name: "f", origin: [0, 0, 0], ux: [1, 0, 0], uy: [0, 1, 0], uz: [0, 0, 1], at: (u: number, v: number) => [u, v, 0] };
  const { lines } = polygon(m, t, [[0, 0], [10, 0], [10, 10], [0, 10]]);
  assert.throws(() => stepExport(m), /there is no solid to export — extrude or revolve a region first/);
  extrude(m, lines[0], 5);
  const b = polygon(m, t, [[20, 0], [30, 0], [30, 10], [20, 10]]);
  extrude(m, b.lines[0], 5);
  m.solve();
  hide(m, "e1");
  const x = stepExport(m, { timestamp: STAMP });
  assert.deepEqual(x.bodies.map((y) => y.name), ["e2"]);
  assert.deepEqual(x.skipped, [{ feature: "e1", why: "hidden" }]);
  hide(m, "e2");
  assert.throws(() => stepExport(m), /there is no solid to export — e1: hidden; e2: hidden/);
  show(m);
  assert.equal(stepExport(m).bodies.length, 2);
});

test("the wireframe: curves: true writes the loose line, arc and circle — not the construction line, not a hidden solid's sketch, not a solid's own edges", async () => {
  await loadKernel();
  const p = parts().find((q) => q.name === "wireframe")!;
  const x = exported(p);
  assert.equal(x.curves, 3);
  const f = parseStep(x.text);
  const set = [...f.data.values()].find((e) => e.types[0] === "GEOMETRIC_CURVE_SET")!;
  const members = (set.args[1] as Value[]).map((v) => f.data.get(refOf(v))!);
  assert.deepEqual(members.map((e) => e.types[0]).sort(), ["CIRCLE", "TRIMMED_CURVE", "TRIMMED_CURVE"]);
  assert.ok([...f.data.values()].some((e) => e.types[0] === "GEOMETRICALLY_BOUNDED_WIREFRAME_SHAPE_REPRESENTATION"));
  // Off by default.
  const plain = stepExport(p.model, { timestamp: STAMP });
  assert.equal(plain.curves, 0);
  assert.ok(!plain.text.includes("GEOMETRIC_CURVE_SET"));
});

test("same_sense is read off the geometry: each face's surface normal against the way out of the material, at a point inside it", async () => {
  await loadKernel();
  // A surface's own normal, per Part 42, is what same_sense compares against:
  // outward for a cylinder, sphere and torus, and for a cone radial minus
  // tan α along its axis.
  const cone: Surface = { kind: "cone", origin: [0, 0, 0], axis: [0, 0, 1], ref: [1, 0, 0], r: 1, semiAngle: Math.PI / 4 };
  const n = surfaceNormal(cone, [2, 0, 1]);
  assert.ok(Math.abs(n[0] - Math.SQRT1_2) < 1e-12 && Math.abs(n[2] + Math.SQRT1_2) < 1e-12, `a 45° cone's normal ${n}`);
  const torus: Surface = { kind: "torus", origin: [0, 0, 0], axis: [0, 0, 1], ref: [1, 0, 0], major: 10, minor: 2 };
  assert.deepEqual(surfaceNormal(torus, [12, 0, 0]).map((c) => Math.round(c * 1e12) / 1e12), [1, 0, 0]);
  assert.deepEqual(surfaceNormal(torus, [8, 0, 0]).map((c) => Math.round(c * 1e12) / 1e12), [-1, 0, 0]);
  // An extrude grown the other way (a negative depth) turns every face over
  // with it and stays a closed, outward solid.
  const m = new Model(3);
  axisFrame(m, "f");
  const t = { name: "f", origin: [0, 0, 0], ux: [1, 0, 0], uy: [0, 1, 0], uz: [0, 0, 1], at: (u: number, v: number) => [u, v, 0] };
  const { lines } = polygon(m, t, [[0, 0], [10, 0], [10, 10], [0, 10]]);
  extrude(m, lines[0], -4);
  m.solve();
  const [body] = solidsOf(m).bodies;
  assert.ok(Math.abs(body.volume - 400) < 1e-9);
  assert.deepEqual(body.box, [[0, 0, -4], [10, 10, 0]]);
  const f = parseStep(stepExport(m, { timestamp: STAMP }).text);
  assert.equal(bodiesOf(f).length, 1);
});

test("exportStep(): through the host's export with the document's name and model/step; a name and curves given; journals nothing; refused without a host or a solid", async () => {
  await loadKernel();
  const p = parts()[0];
  const sent: { text: string; name: string; type: string }[] = [];
  const scope = neocadScope({
    model: p.model,
    document: () => ({ name: "plate", dirty: false }),
    exportFile: async (text, name, type) => { sent.push({ text, name, type }); return `downloaded ${name}`; },
  }) as Record<string, (...a: unknown[]) => unknown>;
  const before = p.model.journal.length;
  assert.equal(await scope.exportStep(), "downloaded plate.step: e1 (1 body)");
  assert.equal(sent[0].name, "plate.step");
  assert.equal(sent[0].type, "model/step");
  assert.ok(sent[0].text.startsWith("ISO-10303-21;\nHEADER;"));
  assert.equal(await scope.exportStep("bracket"), "downloaded bracket.step: e1 (1 body)");
  assert.equal(await scope.exportStep({ curves: true }), "downloaded plate.step: e1 (1 body)");
  assert.equal(await scope.exportStep("b2", { curves: true }), "downloaded b2.step: e1 (1 body)");
  assert.throws(() => scope.exportStep({ curve: true }), /takes \{ curves: true \}/);
  assert.equal(p.model.journal.length, before, "an export journals nothing");
  assert.ok((scope.help() as string).includes("exportStep(name?)"), "help() lists it");

  const bare = neocadScope({ model: p.model }) as Record<string, (...a: unknown[]) => unknown>;
  assert.throws(() => bare.exportStep(), /no download or share sheet in this environment/);
  const empty = neocadScope({ model: new Model(3), exportFile: async () => "x" }) as Record<string, (...a: unknown[]) => unknown>;
  assert.throws(() => empty.exportStep(), /there is no solid to export/);
});

test("an export goes to the share sheet under a finger where it takes the file, and is a download everywhere else", () => {
  assert.equal(exportRoute({ phone: true, shareFiles: true }), "share");
  assert.equal(exportRoute({ phone: true, shareFiles: false }), "download");
  // A desktop's sheet has no "save" (saveRoute's reason), and a picker or a
  // handle is for the document, which an export is not.
  assert.equal(exportRoute({ phone: false, shareFiles: true, savePicker: true, handle: true }), "download");
});

// Writes every part's file and ZeroCAD's figures, for the validator — only when asked.
const out = process.env.NEOCAD_STEP_OUT;
if (out) {
  test(`writes the test parts to ${out}`, async () => {
    await loadKernel();
    mkdirSync(out, { recursive: true });
    const figures: Record<string, unknown> = {};
    for (const p of parts()) {
      const x = exported(p);
      writeFileSync(`${out}/${p.name}.step`, x.text);
      figures[p.name] = { what: p.what, closed: p.volume, bodies: x.bodies.map((b) => ({ name: b.name, volume: b.volume, box: b.box })) };
    }
    writeFileSync(`${out}/zerocad.json`, JSON.stringify(figures, null, 1) + "\n");
  });
}
