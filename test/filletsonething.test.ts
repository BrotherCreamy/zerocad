// A fillet is one thing (docs/plans/fillets-one-thing.md). The owner:
// *"adding them to the originating chain/loop of a region of a body shouldn't
// break the body. The change should propagate through the entire hierarchy
// (yes: hierarchies do exist, but they are not timeline based). Also, adding a
// 2d fillet to the originating chain of a region of a body should produce an
// identical outcome to 3d filleting that edge. Also, the previous geometry
// should not be deleted - as in the two lines and corner point on the two
// linked sketches which form the extrude - it should be made into construction
// geometry. Note: anything can be construction. Lines, points, planes, bodies.
// Anything is fair game."*
//
// So each test here cuts a corner one way and asks what the other way gives,
// and asks the solid kernel for the body where there is one. `fillets-v21` is
// a file the build before this one wrote (test/fixtures/, by a script that
// filleted and chamfered corners before and after an extrude, rounded a wall
// edge and a lid edge with the kernel, and flagged a diagonal construction on
// one profile) with the geometry that build solved it to beside it.

import { test } from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import "../src/modules/builtin.ts";
import { ensureKernelLoaded } from "../src/kernel/problem.ts";
import { Model, ORIGIN, type ExtrudeFeature } from "../src/model.ts";
import { REPOINTED, construction, del, extrude, fillet, region, regen, set, standsFor } from "../src/operations.ts";
import { chamfer } from "../src/sketchedit.ts";
import { chamferEdges, filletEdges, profileCorner } from "../src/blends.ts";
import { dist, fix, onPlane } from "../src/relations/basic.ts";
import { angle, parallel, perpendicular, pointOnLine } from "../src/relations/geometry.ts";
import { open, save, VERSION } from "../src/persist.ts";
import { linksOf } from "../src/twins.ts";
import { findLoops } from "../src/loops.ts";
import { defaultMode, referenceFeatures } from "../src/modes.ts";
import { programOf } from "../src/bodies.ts";
import { Evaluator, type BodyResult } from "../src/solids/evaluate.ts";
import { stepExport } from "../src/step.ts";
import { organiserSections, rowMenu } from "../src/organiser.ts";
import { menuFor } from "../src/menu.ts";
import { neocadScope } from "../src/replenv.ts";
import { chamferFaceRefusal, chamferOfFace } from "../src/tools/plane.ts";
import { cornerAt } from "../src/tools/fillet.ts";
import { hitTest } from "../src/picking.ts";
import { worldToScreen } from "../src/view.ts";
import { faceKernelNames } from "../src/relations/solidref.ts";
import { tiltedFrame } from "./frames.ts";
import { polygon } from "./profiles.ts";
import { kernel, noKernel as skip } from "./solids/load.ts";

async function loadKernel() {
  await ensureKernelLoaded(await readFile(new URL("../src/kernel/wasm-gen/neocad_kernel_bg.wasm", import.meta.url)));
}

const sub = (a: number[], b: number[]) => a.map((x, i) => x - b[i]);
const len = (a: number[]) => Math.hypot(...a);
const ok = (m: Model, what = "") => assert.equal(m.solve().solved, true, `solved ${what}`);

/** A rectangle 40 × 25 on the ground, square, dimensioned and held where it is, extruded 10 — the owner's block. */
async function block(depth = 10) {
  await loadKernel();
  const m = new Model(3);
  const P = [[0, 0, 0], [40, 0, 0], [40, 25, 0], [0, 25, 0]].map((c) => m.addPoint(c).name);
  const L = P.map((p, i) => m.addLine(p, P[(i + 1) % 4]).name);
  const r = [perpendicular(m, L[0], L[1]), perpendicular(m, L[1], L[2]), perpendicular(m, L[2], L[3])];
  const d = [dist(m, P[0], P[1], 40), dist(m, P[1], P[2], 25)];
  fix(m, P[0], [0, 0, 0]); parallel(m, L[0], "origin.x"); onPlane(m, P[2], "origin");
  ok(m, "the sketch");
  const e = extrude(m, L[0], depth);
  ok(m, "extruded");
  const f = () => m.featureOf(e, "extrude");
  const lidOf = (p: string) => linksOf(m).find((l) => l.record === e)!.fwd.get(p)!;
  return { m, P, L, r, d, e, f, lidOf };
}

/** The model as one thing another model can be compared with: every entity with what it refers to, every relation, every record, the flags. */
function shape(m: Model) {
  const refs = (e: { kind: string; name: string }) => m.refsOf(e as never);
  return {
    entities: [...m.entities.values()].map((e) => [e.name, e.kind, refs(e), m.isConstruction(e.name)]),
    relations: [...m.relations.values()].map((r) => [r.name, r.op, r.args, r.twin?.of ?? null]),
    features: [...m.features.values()].map((f) => ({ ...f })),
    blends: [...m.blends.keys()],
    journal: m.journal,
  };
}

/** The body `name` as the kernel builds it, with its faces named. */
async function body(m: Model, name = "e1"): Promise<{ volume: number; faces: string[]; valid: boolean }> {
  const ev = new Evaluator(await kernel());
  const r: BodyResult | undefined = ev.run(programOf(m, true).program).bodies.find((b) => b.name === name);
  assert.ok(r?.solid, `${name} built: ${JSON.stringify(r?.failed)}`);
  return { volume: r.solid.volume, faces: r.solid.faces.map((f) => f.name).sort(), valid: r.solid.validity.manifold && r.solid.validity.failures === 0 };
}

/** The arc's end a cut laid on `line`, held `on` it. */
function touchOn(m: Model, arc: string, line: string): string {
  const a = m.arc(arc);
  return [a.start, a.end].find((e) => [...m.relations.values()].some((r) => r.op === "pointOnLine" && r.args[0] === e && r.args[1] === line))!;
}

/** A filleted straight edge of length `len` removes (4 − π)/4 · r² · len: a square of r² less a quarter disc. */
const filletCut = (r: number, l: number) => ((4 - Math.PI) / 4) * r * r * l;

// --- the corner is kept -------------------------------------------------------------------

test("a sketch fillet on an extruded corner keeps the two lines and the corner — construction, on both profiles — and the body is rounded, not broken", async () => {
  const { m, P, L, r, f, lidOf } = await block();
  const before = { entities: m.entities.size, relations: m.relations.size };
  const arc = fillet(m, L[0], L[1], 5);
  ok(m, "filleted");
  // Nothing was deleted or re-pointed: the two lines run where they did, with their relations.
  assert.deepEqual([m.line(L[0]).refs, m.line(L[1]).refs], [[P[0], P[1]], [P[1], P[2]]]);
  assert.ok(m.relations.has(r[0]) && m.relations.has(r[1]), "the right angle at the corner, and the next one, still said");
  assert.ok(len(sub(m.coords(P[1]), [40, 0, 0])) < 1e-9, "the corner is still the corner — a dimension to it still measures the sharp corner");
  const lid = [L[0], L[1], P[1]].map(lidOf);
  for (const n of [L[0], L[1], P[1], ...lid]) assert.ok(m.isConstruction(n), `${n} is construction`);
  const chord = f().aside!.find((n) => m.entities.get(n)!.kind === "line" && m.line(n).refs.includes(P[1]) && m.line(n).refs.includes(lid[2]))!;
  assert.ok(chord && m.isConstruction(chord), "the chord between the two corners too");
  // What is new: a tangent point on each line (held `on` it), a shorter line from each far end, the arc — and the same on the lid.
  const [t1, t2] = [touchOn(m, arc, L[0]), touchOn(m, arc, L[1])];
  assert.ok(t1 && t2, "each end of the arc is held on the line it touches");
  const [s0, s1] = [standsFor(m, L[0]), standsFor(m, L[1])];
  assert.deepEqual([m.line(s0).refs, m.line(s1).refs], [[P[0], t1], [t2, P[2]]], "the shorter lines, from each far end to the tangent point");
  assert.deepEqual(f().loops, [[L[2], L[3], s0, arc, s1]]);
  assert.deepEqual(f().twins[0].map((n) => m.entities.get(n)!.kind), ["line", "line", "line", "arc", "line"]);
  assert.equal(m.entities.size - before.entities, 6 + 8, "six made by the cut, eight by the lid following it");
  assert.equal(f().aside!.length, 7, "two lines and their twins, the corner and its twin, the chord");
  // The two construction lines are still a pair: a relation on one is twinned to the other.
  const eq = dist(m, P[0], P[1], 40.5);
  assert.deepEqual(m.relationOf(`${eq}_e1`).args, [lidOf(P[0]), lidOf(P[1]), 40.5]);
  del(m, eq);
  // A drag of the depth still leaves a right prism with a rounded corner.
  set(m, `${f().depth}.value`, 16);
  ok(m, "deeper");
  for (const [b, t] of linksOf(m)[0].fwd) {
    if (m.entities.get(b)!.kind !== "point") continue;
    assert.ok(len(sub(sub(m.coords(t), m.coords(b)), [0, 0, 16])) < 1e-6, `${b} → ${t} is the chord`);
  }
  assert.deepEqual(m.diagnose().redundant, [], "nothing redundant: the join form of the tangency, not the distance form");
  // An angle typed afterwards, on a line from a corner, is met (a probe once
  // read a conflict here: it had named the fillet's own shorter line, l5).
  const far = m.addPoint([60, 120, 0]).name;
  const l5 = m.addLine(P[1], far).name;
  angle(m, L[0], l5, Math.PI / 6);
  ok(m, "an angle after the fillet");
});

test("the body, measured: V − (4 − π)/4 · r² · depth, every face accounted for, no kernel blend in the chain", { skip }, async () => {
  const { m, L } = await block();
  const plain = await body(m);
  fillet(m, L[0], L[1], 5);
  ok(m);
  const rounded = await body(m);
  assert.ok(rounded.valid);
  assert.ok(Math.abs(rounded.volume - (plain.volume - filletCut(5, 10))) < 1e-6, `${rounded.volume}`);
  assert.deepEqual(rounded.faces, ["e1.base", "e1.lid", "e1.m0", "e1.m1", "e1.m2", "e1.m3", "e1.m4"], "five walls, the arc's among them");
  assert.equal(m.blends.size, 0);
});

// --- one thing: the sketch's fillet and the solid's edge fillet are the same call -------

test("filleting the solid's edge between two walls is the sketch's fillet of that corner: the same entities, relations, records, journal and body", { skip }, async () => {
  const a = await block();
  const b = await block();
  const fromSketch = fillet(a.m, a.L[0], a.L[1], 5);
  const fromEdge = filletEdges(b.m, "e1", ["e1.m0|e1.m1"], 5);
  assert.equal(fromEdge, fromSketch, "the same arc, under the same name");
  ok(a.m); ok(b.m);
  assert.deepEqual(shape(b.m), shape(a.m), "indistinguishable afterwards");
  assert.deepEqual(a.m.journal.at(-1), { op: "fillet", args: [a.L[0], a.L[1], 5, null, [["e1", a.f().loops]]] });
  assert.equal(b.m.blends.size, 0, "no kernel blend: the body is swept from the rounded loop");
  const [A, B] = [await body(a.m), await body(b.m)];
  assert.deepEqual(B, A, "face for face");
  // And the chamfer: the same, with a line for the arc.
  const c = await block();
  const d = await block();
  assert.equal(chamferEdges(d.m, "e1", ["e1.m0|e1.m1"], 4), chamfer(c.m, c.L[0], c.L[1], 4));
  ok(c.m); ok(d.m);
  assert.deepEqual(shape(d.m), shape(c.m));
  assert.deepEqual(await body(d.m), await body(c.m));
  assert.ok(Math.abs((await body(c.m)).volume - (10000 - 8 * 10)) < 1e-9, "a 4 × 4 corner halved, 10 deep");
});

test("asked of the lid's two edges, the fillet is made on the profile the record is rebuilt from, and comes out the same", async () => {
  const a = await block();
  const b = await block();
  const [l0, l1] = [a.lidOf(a.L[0]), a.lidOf(a.L[1])];
  assert.equal(fillet(a.m, l0, l1, 5), fillet(b.m, b.L[0], b.L[1], 5));
  ok(a.m); ok(b.m);
  assert.deepEqual(shape(a.m), shape(b.m), "whichever end the corner was picked on");
  assert.deepEqual(a.m.journal.at(-1), b.m.journal.at(-1), "one journal entry, the base's");
});

test("a lid's rim edge is not a profile corner: the kernel's blend, as before, on that end only — the sketch untouched, nothing construction", { skip }, async () => {
  const { m, L } = await block();
  assert.equal(profileCorner(m, "e1.lid|e1.m0"), null);
  assert.deepEqual(profileCorner(m, "e1.m0|e1.m1"), [L[0], L[1]]);
  assert.deepEqual(profileCorner(m, "e1.m1|e1.m0"), [L[1], L[0]], "either way round");
  const e2 = filletEdges(m, "e1", ["e1.lid|e1.m0"], 3);
  assert.equal(m.blends.get(e2)?.kind, "fillet");
  assert.ok([...m.entities.keys()].every((n) => !m.isConstruction(n)), "no sketch entity was replaced, so none is construction");
  assert.deepEqual(m.featureOf("e1", "extrude").loops, [L]);
  const r = await body(m);
  assert.ok(r.valid && r.faces.includes("e2.f0"));
  assert.ok(Math.abs(r.volume - (10000 - filletCut(3, 40))) < 1e-6);
});

test("a list of both kinds of edge: the kernel's record for the rims, the sketch's cut for the corners — and the record's edges follow the walls' new places", { skip }, async () => {
  const { m, L } = await block();
  const made = filletEdges(m, "e1", ["e1.lid|e1.m2", "e1.m0|e1.m1"], 3);
  ok(m);
  assert.equal(made, "e2", "the record's name, where there is a record");
  const b = m.blendOf("e2");
  // The wall swept from l3 was place 2; after the cut the profile is walked l3, l4, …, so it is place 0.
  assert.deepEqual(faceKernelNames(m, `e1:${L[2]}`), ["e1.m0"]);
  assert.deepEqual(b.edges, ["e1.lid|e1.m0"], "the rim edge, by the wall's place now");
  const r = await body(m);
  assert.ok(r.valid && r.faces.includes("e2.f0") && r.faces.length === 8, `${r.faces}`);
  assert.ok(Math.abs(r.volume - (10000 - filletCut(3, 10) - filletCut(3, 40))) < 1e-6, `${r.volume}`);
});

// --- the hierarchy ------------------------------------------------------------------------------

test("a solid standing on the lid is cut at that corner too — the same cut seen from the other profile — and the body stays one valid body", { skip }, async () => {
  const { m, L, f } = await block();
  const e2 = extrude(m, f().twins[0][0], 6, ORIGIN);
  ok(m);
  assert.equal(m.featureOf(e2, "extrude").mode, "add");
  const before = await body(m);
  const arc = fillet(m, L[0], L[1], 5);
  ok(m, "filleted through both");
  const regenerated = (m.journal.at(-1)!.args[4] as [string][]).map(([n]) => n);
  assert.deepEqual(regenerated, ["e1", e2]);
  const g = m.featureOf(e2, "extrude");
  assert.equal(g.loops[0].length, 5);
  assert.equal(g.aside!.length, 7, "the lid's two lines and corner, their twins on e2's lid, and the chord: set aside on e2 as on e1");
  assert.ok(g.aside!.every((n) => m.isConstruction(n)));
  assert.ok(g.loops[0].includes(f().twins[0][f().loops[0].indexOf(arc)]), "e2's profile runs along e1's twin arc");
  const after = await body(m);
  assert.ok(after.valid);
  assert.ok(Math.abs(after.volume - (before.volume - filletCut(5, 16))) < 1e-6, `${after.volume} for ${before.volume}`);
});

test("a second cut at the far end of a line set aside cuts the shorter line in its place: four corners rounded are four construction lines, four real ones and four arcs", { skip }, async () => {
  const { m, L, P, f } = await block();
  const arcs = [0, 1, 2, 3].map((i) => fillet(m, L[i], L[(i + 1) % 4], 5));
  ok(m);
  assert.ok(L.every((l) => m.isConstruction(l)) && P.every((p) => m.isConstruction(p)), "the rectangle as drawn, all construction");
  const real = [...m.entities.values()].filter((e) => e.kind === "line" && !m.isConstruction(e.name) && !f().walls.includes(e.name) && !f().twins.flat().includes(e.name));
  assert.equal(real.length, 4, `four shorter lines on the base, not a construction line stacked on a construction line: ${real.map((e) => e.name)}`);
  assert.equal(f().loops[0].length, 8);
  assert.deepEqual([...findLoops(m)].filter((l) => l.members.length === 8).length, 2, "the rounded loop on each profile");
  const r = await body(m);
  assert.ok(r.valid);
  assert.ok(Math.abs(r.volume - (10000 - 4 * filletCut(5, 10))) < 1e-6);
  // The fillet tool's corner click at a cut corner takes the two lines that bound there, not the construction ones.
  const T = touchOn(m, arcs[0], L[1]);
  assert.deepEqual(cornerAt(m, T), null, "an arc's end is no corner of two lines (and a wall standing on it is no leg)");
  // A line set aside stands for its piece: the loop can be named by it.
  assert.equal(standsFor(m, L[0]), f().loops[0].find((x) => m.line(x as string).refs.includes(touchOn(m, arcs[0], L[0]))));
});

test("the fillet tool's corner click: a corner already cut at the far end has a construction line and a real one ending there — the real pair is the one meant", async () => {
  const { m, L, P } = await block();
  fillet(m, L[0], L[1], 5);
  assert.deepEqual(cornerAt(m, P[2])?.sort(), [standsFor(m, L[1]), L[2]].sort(), "l2 is construction now; its piece and l3 bound there");
  assert.deepEqual(cornerAt(m, P[1]), [L[0], L[1]], "with no real line at the old corner, the two construction ones");
});

test("a click on the shorter line, which lies along the construction line it was cut from, picks the shorter line: a real curve wins the tie", async () => {
  const { m, L } = await block();
  fillet(m, L[0], L[1], 5);
  const view = { ox: 400, oy: 300, scale: 6 };
  // Halfway along the bottom edge both lines pass; the sharp corner's end is the construction line's alone.
  const [sx, sy] = worldToScreen(view, [20, 0, 0]);
  assert.equal(hitTest(m, view, sx, sy + 1)?.name, standsFor(m, L[0]), "the shorter line, not the construction line over it");
  // Between the tangent point (35, 0) and the corner (40, 0), just below the
  // line: clear of both points' reach and of the arc's at this scale.
  const [cx, cy] = worldToScreen(view, [38.5, -0.5, 0]);
  assert.equal(hitTest(m, view, cx, cy)?.name, L[0], "where only the construction line runs, it picks");
});

// --- anything can be construction ----------------------------------------------------------------

test("a construction point cuts no edge it is held on: no vertex, no T", async () => {
  await loadKernel();
  const m = new Model(2);
  const P = [[0, 0], [40, 0], [40, 30], [0, 30]].map((c) => m.addPoint(c).name);
  const L = P.map((p, i) => m.addLine(p, P[(i + 1) % 4]).name);
  // A divider across the rectangle, each end held on an edge: two Ts, two halves.
  const t = m.addPoint([20, 0]).name;
  const w = m.addPoint([20, 30]).name;
  m.addLine(w, t);
  pointOnLine(m, t, L[0]);
  pointOnLine(m, w, L[2]);
  ok(m);
  assert.equal(findLoops(m).length, 2, "two halves");
  assert.ok(findLoops(m).some((l) => l.members.some((x) => x.name === L[0] && x.span)), "a T: the bottom edge bounds in parts");
  assert.deepEqual(construction(m, t, w), [t, w]);
  assert.deepEqual(findLoops(m).map((l) => l.members.map((x) => x.name)), [L], "construction points are no vertices: one loop, the edges whole");
  assert.equal(m.solve().solved, true, "still held on the lines");
  // A profile's vertex cannot be construction: the record stands on it.
  construction(m, t, w, false);
  const n = new Model(3);
  const Q = [[0, 0, 0], [40, 0, 0], [40, 30, 0], [0, 30, 0]].map((c) => n.addPoint(c).name);
  const K = Q.map((p, i) => n.addLine(p, Q[(i + 1) % 4]).name);
  const cut = n.addLine(n.addPoint([20, -5, 0]).name, n.addPoint([20, 35, 0]).name).name;
  const v = n.addPoint([20, 0, 0]).name;
  pointOnLine(n, v, K[0]); pointOnLine(n, v, cut);
  const w2 = n.addPoint([20, 30, 0]).name;
  pointOnLine(n, w2, K[2]); pointOnLine(n, w2, cut);
  ok(n);
  extrude(n, K[1], 10);
  assert.throws(() => construction(n, v), /is where e1's profile is cut — a vertex of it/);
});

test("a construction frame is a reference plane: never the plane a feature is laid out by unless it is named; a construction body is reference: not joined, not exported, drawn as such", async () => {
  await loadKernel();
  const m = new Model(3);
  const t = tiltedFrame(m);
  const { lines } = polygon(m, t, [[0, 0], [30, 0], [30, 20], [0, 20]]);
  ok(m);
  assert.deepEqual(construction(m, t.name), [t.name]);
  assert.ok(m.isConstruction(t.name));
  const e = extrude(m, lines[0], 8);
  assert.notEqual(m.featureOf(e).frame, t.name, "laid out by the loop's own plane, not the construction frame");
  assert.equal(extrude(m, lines[0], -8, t.name), "e2", "named, it is the plane as ever");
  assert.equal(m.featureOf("e2").frame, t.name);
  del(m, "e2");
  assert.throws(() => construction(m, ORIGIN), /the origin is every model's own datum/);
  // The body.
  assert.deepEqual(construction(m, e), [e]);
  assert.deepEqual([...referenceFeatures(m)], [e]);
  const n = new Model(3);
  const P = [[0, 0, 0], [40, 0, 0], [40, 25, 0], [0, 25, 0]].map((c) => n.addPoint(c).name);
  const L = P.map((p, i) => n.addLine(p, P[(i + 1) % 4]).name);
  const base = extrude(n, L[0], 10);
  ok(n);
  construction(n, base);
  // A boss drawn on its lid: a body of its own, not an add into the reference body.
  const f = n.featureOf(base, "extrude");
  const boss = extrude(n, f.twins[0][0], 5, ORIGIN);
  assert.equal(n.featureOf(boss).mode, undefined, `a new body, not joined to a construction one: ${defaultMode(n, n.featureOf(boss)).mode}`);
  assert.equal(extrude(n, f.twins[0][0], 3, ORIGIN, { mode: "add", into: base }), "e3", "named, it joins");
  assert.equal(n.featureOf("e3").mode, "add");
  del(n, "e3");
  const exported = stepExport(n);
  assert.deepEqual(exported.bodies.map((b) => b.feature), [boss]);
  assert.deepEqual(exported.skipped, [{ feature: base, why: "construction" }]);
  const row = organiserSections(n).find((s) => s.id === "features")!.rows.find((r) => r.name === base)!;
  assert.match(row.detail, /construction/);
  assert.ok(rowMenu(n, base)!.items.some((i) => i.label === "Not construction"));
  assert.ok(rowMenu(n, boss)!.items.some((i) => i.label === "Construction"), "one row on every kind");
  assert.ok(menuFor(n, { name: P[0], kind: "point", distance: 0 } as never).items.some((i) => i.label === "Construction"));
  construction(n, base, false);
  assert.equal(stepExport(n).bodies.length, 2);
});

test("a linked profile's entity is flagged with its partner, and the entry lists both; a file from before 22 flags exactly what it names", async () => {
  const { m, L, lidOf } = await block();
  const diag = m.addLine(m.line(L[0]).refs[0], m.line(L[1]).refs[1]).name;
  m.addLine(lidOf(m.line(L[0]).refs[0]), lidOf(m.line(L[1]).refs[1]));
  ok(m);
  const partner = linksOf(m)[0].fwd.get(diag)!;
  assert.deepEqual(construction(m, diag), [diag, partner]);
  assert.deepEqual(m.journal.at(-1), { op: "construction", args: [diag, partner] });
  assert.deepEqual(construction(m, partner, false), [partner, diag], "from either end");
  assert.deepEqual(construction(m, diag, { alone: true }), [diag], "an old file's: the name alone");
  assert.deepEqual(m.journal.at(-1), { op: "construction", args: [diag, { alone: true }] });
  assert.ok(!m.isConstruction(partner));
});

// --- review item 7: a chamfer's own face is not sketched on --------------------------------------

test("a kernel chamfer's face is refused as a sketch plane, saying why and what works; a chamfer of a profile corner is a wall, sketched on like any", async () => {
  const { m } = await block();
  const e2 = chamferEdges(m, "e1", ["e1.lid|e1.m0"], 2);
  assert.equal(chamferOfFace(m, `${e2}.f0`), e2);
  assert.equal(chamferOfFace(m, "e1.lid"), null);
  assert.equal(chamferOfFace(m, "e1.m0"), null);
  assert.match(chamferFaceRefusal(e2), new RegExp(`that face is ${e2}'s — a chamfer the solid kernel cut along an edge`));
  assert.match(chamferFaceRefusal(e2), /a chamfer between two walls is the profile's own/);
  // The corner chamfer: a wall swept from a line, with points of its own.
  const line = chamferEdges(m, "e1", ["e1.m1|e1.m2"], 3);
  assert.ok(m.entities.get(line)?.kind === "line", "the sketch's chamfer line");
  assert.ok(m.featureOf("e1", "extrude").loops[0].includes(line), "a member of the profile: its wall is a face with points, like any wall");
});

// --- old files ---------------------------------------------------------------------------------------

interface Recorded {
  points: Record<string, number[]>;
  radii: Record<string, number>;
  kinds: Record<string, string>;
  lines: Record<string, string[]>;
  flagged: string[];
  relations: [string, string, unknown[]][];
  features: { name: string; loops: unknown[][]; twins: string[][]; walls?: string[] }[];
  blends: string[];
  named: { eA: string; arcA: string; chA: string; A: { P: string[]; L: string[] }; eB: string; bf: string; bc: string; eC: string; diagBase: string; diagLid: string };
}

test("a file from before 22 opens to the model it was — every fillet and chamfer cut as that build cut it, every construction flag on what it named — and is this build's from then on", async () => {
  await loadKernel();
  const text = await readFile(new URL("./fixtures/fillets-v21.neocad.json", import.meta.url), "utf8");
  const want = JSON.parse(await readFile(new URL("./fixtures/fillets-v21.geometry.json", import.meta.url), "utf8")) as Recorded;
  assert.equal(JSON.parse(text).version, 21);
  const m = open(text, 3);
  assert.deepEqual([...m.entities.keys()].sort(), Object.keys(want.kinds).sort(), "every entity, under its name");
  for (const [n, k] of Object.entries(want.kinds)) assert.equal(m.entities.get(n)!.kind, k, n);
  for (const [n, refs] of Object.entries(want.lines)) assert.deepEqual(m.line(n).refs, refs, `${n} runs as it did: the legs re-pointed, as that build left them`);
  assert.deepEqual([...m.entities.keys()].filter((n) => m.isConstruction(n)).sort(), [...want.flagged].sort(), "flagged exactly what it flagged — no partner");
  assert.deepEqual([...m.features.keys()], want.features.map((f) => f.name));
  for (const f of want.features) {
    const g = m.featureOf(f.name);
    assert.deepEqual(g.loops, f.loops, `${f.name}'s profile`);
    assert.deepEqual(g.twins, f.twins);
    if (f.walls) assert.deepEqual((g as ExtrudeFeature).walls, f.walls);
    assert.equal(g.aside, undefined, "nothing set aside by a fillet of that build");
  }
  assert.deepEqual([...m.blends.keys()], want.blends);
  const mine = [...m.relations.values()].filter((r) => !r.twin);
  assert.deepEqual(mine.map((r) => [r.name, r.op, r.args]), want.relations, "no name shifted, and nothing it said changed");
  ok(m, "as it opens");
  for (const [p, at] of Object.entries(want.points)) assert.ok(len(sub(m.coords(p), at)) < 1e-6, `${p} where that build left it`);
  for (const [c, r] of Object.entries(want.radii)) assert.ok(Math.abs(m.radius(c) - r) < 1e-6, c);
  // Every older cut is marked, and the marks stay when the file is saved again.
  const once = save(m);
  const saved = JSON.parse(once);
  assert.equal(saved.version, VERSION);
  for (const e of saved.journal) {
    if (e.op === "fillet" || e.op === "chamfer") assert.equal(e.args.at(-1), REPOINTED, `${e.op}(${e.args.slice(0, 2)}) marked`);
    if (e.op === "construction") assert.deepEqual(e.args.at(-1), { alone: true });
  }
  const back = open(once, 3);
  assert.equal(save(back), once, "re-saved stably");
  assert.deepEqual([...back.relations.keys()], [...m.relations.keys()]);
  // And worked on, it is this build's: a corner cut now is kept.
  const { A, eA } = want.named;
  const arc = fillet(m, A.L[1], A.L[2], 3);
  ok(m, "a new fillet in an old file");
  assert.ok(m.isConstruction(A.L[1]) && m.isConstruction(A.L[2]), "kept as construction");
  assert.ok(m.featureOf(eA).loops[0].includes(arc));
  assert.equal(m.journal.at(-1)!.args.at(-1) !== REPOINTED, true, "a new entry carries no mark");
});

test("the marks are refused where they do not belong, and a two-line fillet or chamfer typed carries none", async () => {
  await loadKernel();
  const m = new Model(2);
  const P = [[0, 0], [40, 0], [40, 30]].map((c) => m.addPoint(c).name);
  const [a, b] = [m.addLine(P[0], P[1]).name, m.addLine(P[1], P[2]).name];
  assert.throws(() => fillet(m, a, b, 3, null, null, "sideways"), /fillet's last argument is a file's from before format 22/);
  assert.throws(() => chamfer(m, a, b, 3, null, null, "sideways"), /chamfer's last argument is a file's from before format 22/);
  const s = neocadScope({ model: m }) as Record<string, (...x: unknown[]) => unknown>;
  s.fillet(a, b, 3);
  assert.deepEqual(m.journal.at(-1), { op: "fillet", args: [a, b, 3] });
  assert.match(String(s.help()), /construction\(\.\.\.names\)/);
  assert.match(String(s.help()), /two lines and their corner stay, as construction/);
  assert.match(String(s.help()), /a point cuts no edge it is on/);
});

// --- a region's member ------------------------------------------------------------------------------------

test("a line set aside stands for the piece made in its place: extrude, revolve and region named by the line a person still sees", async () => {
  await loadKernel();
  const m = new Model(3);
  const P = [[0, 0, 0], [40, 0, 0], [40, 25, 0], [0, 25, 0]].map((c) => m.addPoint(c).name);
  const L = P.map((p, i) => m.addLine(p, P[(i + 1) % 4]).name);
  fillet(m, L[0], L[1], 5);
  ok(m);
  const rg = region(m, L[0]);
  assert.equal(m.regionEntry(rg).steps[0].member, standsFor(m, L[0]), "the region names the piece");
  const e = extrude(m, L[0], 10);
  assert.equal(m.featureOf(e).loops[0].length, 5);
  assert.ok(!m.featureOf(e).loops[0].includes(L[0]) && m.featureOf(e).loops[0].includes(standsFor(m, L[0])));
  regen(m, e);
  ok(m);
});
