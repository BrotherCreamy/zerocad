// Surfaces in the kernel (docs/plans/surfaces.md): what SMLib gives for sheet
// bodies, through the evaluator's surface nodes, each by area or volume
// against the closed form — never against another kernel answer.
//
// Needs the SMLib build (npm run build:solids); skips and says why without one.

import { test } from "node:test";
import assert from "node:assert/strict";
import { Evaluator, type BodyResult, type Node, type Program } from "../src/solids/evaluate.ts";
import { SURFACE_IDS } from "../src/solids/naming.ts";
import type { Member, Placement } from "../src/solids/kernel.ts";
import { XY } from "../src/solids/kernel.ts";
import { kernel as k, noKernel as skip } from "./solids/load.ts";
import { circle, profile, rect } from "./solids/profiles.ts";

const S = (n: number) => SURFACE_IDS + n;
const line = (a: [number, number], b: [number, number]): Member => ({ kind: "line", from: a, to: b });
/** The plane x–z, through the origin: a profile drawn in it stands up off the ground. */
const XZ: Placement = { origin: [0, 0, 0], x: [1, 0, 0], y: [0, 0, 1] };

async function run(nodes: Node[], name = "s1"): Promise<BodyResult> {
  const ev = new Evaluator(await k());
  const p: Program = { bodies: [{ name, nodes }], prefix: "e", chord: 5e-4, angle: 10 };
  const r = ev.run(p).bodies[0];
  ev.clear();
  return r;
}

const area = (r: BodyResult) => r.solid!.faces.reduce((a, f) => a + f.area, 0);
const near = (a: number, b: number, tol = 1e-6) => assert.ok(Math.abs(a - b) <= tol * Math.max(1, Math.abs(b)), `${a} is not ${b}`);

/** A wall: the line (0,0)–(len,0) on the ground swept `h` up. */
function wall(id: number, from: [number, number], to: [number, number], h: number): Node {
  return { id: S(id), op: "sheet", sweep: { kind: "extrude", depth: h }, profile: profile([line(from, to)]), at: XY };
}

test("an extruded surface: a sheet of the curve's length by the depth, its boundary edges named by the sweep", { skip }, async () => {
  const r = await run([wall(1, [0, 0], [20, 0], 10)]);
  assert.deepEqual(r.failed, []);
  near(area(r), 200);
  assert.equal(r.solid!.validity.manifold, false);
  assert.deepEqual(r.solid!.faces.map((f) => f.name), ["s1.m0"]);
  assert.deepEqual(r.solid!.edges.map((e) => e.name).sort(), ["s1.m0|s1.base", "s1.m0|s1.end", "s1.m0|s1.lid", "s1.m0|s1.start"]);
});

test("a revolved surface: a line turned whole about the axis is the cylinder 2πrh, its seam no boundary", { skip }, async () => {
  const r = await run([{ id: S(1), op: "sheet", sweep: { kind: "revolve", point: [0, 0], dir: [0, 1], degrees: 360 }, profile: profile([line([5, 0], [5, 10])]), at: XY }]);
  near(area(r), 2 * Math.PI * 5 * 10, 1e-5);
  const names = r.solid!.edges.map((e) => e.name).sort();
  assert.deepEqual(names, ["s1.m0:seam", "s1.m0|s1.end", "s1.m0|s1.start"]);
});

test("a planar surface: the region's area, a rectangle less a hole, its edges named by the members they run along", { skip }, async () => {
  const r = await run([{ id: S(1), op: "planar", profile: profile(rect(0, 0, 20, 10), circle(10, 5, 3)), at: XY }]);
  near(area(r), 200 - 9 * Math.PI, 1e-6);
  assert.deepEqual(r.solid!.faces.map((f) => f.name), ["s1.base"]);
  assert.ok(r.solid!.edges.every((e) => /^s1\.base\|s1\.m\d$/.test(e.name)), r.solid!.edges.map((e) => e.name).join());
});

test("trim by a curve: a circle projected through a flat sheet keeps the side the point is on; the edges it does not cut keep their names", { skip }, async () => {
  const flat: Node = { id: S(1), op: "sheet", sweep: { kind: "extrude", depth: -10 }, profile: profile([line([0, 0], [20, 0])]), at: XZ };
  const hole: Node = { id: S(2), op: "trim", curve: { member: circle(10, 5, 3)[0], at: { ...XY, origin: [0, 0, 5] }, dir: [0, 0, -1] }, keep: [1, 1, 0] };
  const outside = await run([flat, hole]);
  assert.deepEqual(outside.failed, []);
  near(area(outside), 200 - 9 * Math.PI, 1e-6);
  const names = outside.solid!.edges.map((e) => e.name);
  for (const kept of ["s1.m0|s1.base", "s1.m0|s1.lid", "s1.m0|s1.start", "s1.m0|s1.end"]) assert.ok(names.includes(kept), `${kept} in ${names}`);
  assert.ok(names.includes("s1.m0|s2"), `the trim's own edge in ${names}`);
  const inside = await run([flat, { ...hole, keep: [10, 5, 0] }]);
  near(area(inside), 9 * Math.PI, 1e-6);
});

test("trim by a surface: a wall cut where another crosses it, the side the point is on kept", { skip }, async () => {
  const cutter = [wall(2, [5, -5], [5, 5], 10)];
  const r = await run([wall(1, [0, 0], [20, 0], 10), { id: S(3), op: "trim", by: cutter, keep: [15, 0, 5] }]);
  assert.deepEqual(r.failed, []);
  near(area(r), 150);
  assert.ok(r.solid!.edges.some((e) => e.name === "s1.m0|s3"));
});

test("knit: two walls meeting at a corner are one sheet, the corner one edge named by both faces", { skip }, async () => {
  const r = await run([wall(1, [0, 0], [10, 0], 5), { id: S(3), op: "knit", with: [[wall(2, [10, 0], [10, 10], 5)]], tolerance: 1e-4 }]);
  assert.deepEqual(r.failed, []);
  near(area(r), 100);
  assert.deepEqual(r.solid!.faces.map((f) => f.name).sort(), ["s1.m0", "s2.m0"]);
  const shared = r.solid!.edges.filter((e) => !e.lamina).map((e) => e.name);
  assert.deepEqual(shared, ["s1.m0|s2.m0"]);
  const apart = await run([wall(1, [0, 0], [10, 0], 5), { id: S(3), op: "knit", with: [[wall(2, [11, 0], [11, 10], 5)]], tolerance: 1e-4 }]);
  assert.match(apart.failed[0]?.why ?? "", /do not meet/);
});

test("fillet between two knitted surfaces: the corner rounded, area 100 − 2rh + (π/2)rh", { skip }, async () => {
  const r0 = [wall(1, [0, 0], [10, 0], 5), { id: S(3), op: "knit", with: [[wall(2, [10, 0], [10, 10], 5)]], tolerance: 1e-4 } as Node];
  const r = await run([...r0, { id: S(4), op: "pairFillet", a: [S(1)], b: [S(2)], with: null, keep: [null, null], size: 2 }]);
  assert.deepEqual(r.failed, []);
  near(area(r), 100 - 2 * 2 * 5 + (Math.PI / 2) * 2 * 5, 1e-6);
  assert.ok(r.solid!.faces.some((f) => f.name === "s4.f0"));
  const c = await run([...r0, { id: S(4), op: "pairChamfer", a: [S(1)], b: [S(2)], with: null, keep: [null, null], size: 2 }]);
  near(area(c), 100 - 2 * 2 * 5 + Math.SQRT2 * 2 * 5, 1e-6);
});

test("fillet between two crossing surfaces: each trimmed back to the other (the larger piece), knitted, rounded", { skip }, async () => {
  // A wall along x (0–20) and one along y at x = 5 (−5 to 5): kept, 15 × 10 and 5 × 10.
  const r = await run([wall(1, [0, 0], [20, 0], 10), { id: S(3), op: "pairFillet", a: [S(1)], b: [S(2)], with: [wall(2, [5, -5], [5, 5], 10)], keep: [null, null], size: 2 }]);
  assert.deepEqual(r.failed, []);
  near(area(r), 150 + 50 - 2 * 2 * 10 + (Math.PI / 2) * 2 * 10, 1e-6);
});

test("thicken: a flat sheet, a cylinder and a holed sheet by their volumes", { skip }, async () => {
  const flat = await run([{ id: S(1), op: "sheet", sweep: { kind: "extrude", depth: -10 }, profile: profile([line([0, 0], [20, 0])]), at: XZ }, { id: S(2), op: "thicken", distance: 2 }]);
  assert.deepEqual(flat.failed, []);
  assert.equal(flat.solid!.validity.manifold, true);
  near(flat.solid!.volume, 400);
  const cyl = await run([{ id: S(1), op: "sheet", sweep: { kind: "revolve", point: [0, 0], dir: [0, 1], degrees: 360 }, profile: profile([line([5, 0], [5, 10])]), at: XY }, { id: S(2), op: "thicken", distance: 2 }]);
  // Outward: the shell between r 5 and r 7.
  near(cyl.solid!.volume, Math.PI * (49 - 25) * 10, 1e-5);
  const holed = await run([
    { id: S(1), op: "sheet", sweep: { kind: "extrude", depth: -10 }, profile: profile([line([0, 0], [20, 0])]), at: XZ },
    { id: S(2), op: "trim", curve: { member: circle(10, 5, 3)[0], at: { ...XY, origin: [0, 0, 5] }, dir: [0, 0, -1] }, keep: [1, 1, 0] },
    { id: S(3), op: "thicken", distance: 1 },
  ]);
  near(holed.solid!.volume, 200 - 9 * Math.PI, 1e-6);
  assert.ok(holed.solid!.faces.some((f) => f.name.startsWith("s3.f")), "the walls are the thicken's");
});

test("a closed knit closes into a solid: a square tube and its two caps, 10 × 10 × 10", { skip }, async () => {
  const tube: Node = { id: S(1), op: "sheet", sweep: { kind: "extrude", depth: 10 }, profile: profile(rect(0, 0, 10, 10)), at: XY };
  const cap = (id: number, z: number): Node => ({ id: S(id), op: "planar", profile: profile(rect(0, 0, 10, 10)), at: { ...XY, origin: [0, 0, z] } });
  const r = await run([tube, { id: S(4), op: "knit", with: [[cap(2, 0)], [cap(3, 10)]], tolerance: 1e-4 }, { id: S(5), op: "solidify" }]);
  assert.deepEqual(r.failed, []);
  assert.equal(r.solid!.validity.manifold, true);
  near(r.solid!.volume, 1000);
  const open = await run([tube, { id: S(4), op: "knit", with: [[cap(2, 0)]], tolerance: 1e-4 }, { id: S(5), op: "solidify" }]);
  assert.match(open.failed[0]?.why ?? "", /not closed — 4 edges/);
});

test("a body's face as a surface, and an offset of a surface: areas, and names of their own", { skip }, async () => {
  const body: Node = { id: 1, op: "new", sweep: { kind: "extrude", depth: 5 }, profile: profile(rect(0, 0, 10, 20)), at: XY };
  const lid = await run([{ id: S(1), op: "face", of: [body], face: "e1.lid" }]);
  assert.deepEqual(lid.failed, []);
  near(area(lid), 200);
  assert.deepEqual(lid.solid!.faces.map((f) => f.name), ["s1.m0"]);
  assert.ok(lid.solid!.edges.every((e) => /^s1\.m0\|e1\.m\d$/.test(e.name)), lid.solid!.edges.map((e) => e.name).join());
  const cyl: Node = { id: S(1), op: "sheet", sweep: { kind: "revolve", point: [0, 0], dir: [0, 1], degrees: 360 }, profile: profile([line([5, 0], [5, 10])]), at: XY };
  const off = await run([{ id: S(2), op: "offset", of: [cyl], distance: 2 }], "s2");
  near(area(off), 2 * Math.PI * 7 * 10, 1e-5);
  assert.deepEqual(off.solid!.faces.map((f) => f.name), ["s2.m0"]);
  const gone = await run([{ id: S(1), op: "face", of: [body], face: "e1.m9" }]);
  assert.match(gone.failed[0]?.why ?? "", /no face e1\.m9/);
});

test("SMLib's own face–face blend exists, and does not trim: a quarter cylinder r 2 over both surfaces' reach along the crossing", { skip }, async () => {
  // What surfaces.md asked to be said: the kernel's face–face blend
  // (SmApiSurfaceSurfaceFillet) makes the blend surface between two faces'
  // untrimmed surfaces and leaves both whole, so a fillet between surfaces
  // that do not share an edge is built from trim, knit and the edge fillet.
  const K = await k();
  const a = K.sheetExtrude(profile([line([0, 0], [10, 0])]), -10, XZ);
  const b = K.sheetExtrude(profile([line([5, -5], [5, 5])]), 10, { ...XY, origin: [0, 0, -5] });
  const blend = K.faceBlend(a, 0, b, 0, 2, false);
  const faces = K.faces(blend);
  assert.equal(faces.length, 1);
  // Along the crossing (y) a reaches 0–10 and b −5–5: the blend runs over both, 15, at radius 2, a quarter turn.
  near(faces[0].area, (Math.PI / 2) * 2 * 15, 1e-5);
  near(K.faces(a).reduce((s, f) => s + f.area, 0), 100);
  for (const h of [a, b, blend]) K.free(h);
});
