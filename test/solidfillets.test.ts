// Fillets and chamfers of a body's edges (docs/plans/solid-fillets.md), through
// the app's own path: features made by the operations, read off the model as a
// program (bodies.ts), evaluated by the real kernel, and checked against closed
// forms that never ask a kernel (the spike's parts, test/solids/parts.ts) — then
// the feature's place in the chain, the naming of what it makes, the model's
// edits of it, the memory over 200 rebuilds, and the edge picked by a pixel.
// Skips, saying so, without a kernel build.

import { test } from "node:test";
import assert from "node:assert/strict";
import "../src/modules/builtin.ts";
import { Model } from "../src/model.ts";
import { del, extrude, fillet, set } from "../src/operations.ts";
import { open, save } from "../src/persist.ts";
import { chamferEdges, filletEdges, setEdges } from "../src/blends.ts";
import { hide } from "../src/groups.ts";
import { chainsOf } from "../src/modes.ts";
import { Bodies, bodyFaces, programOf, type BodyView } from "../src/bodies.ts";
import { bodyEdges, edgeAt, faceEdges, tangentChain } from "../src/kerneledges.ts";
import { organiserSections } from "../src/organiser.ts";
import { neocadScope } from "../src/replenv.ts";
import { Evaluator, type BodyResult, type Node } from "../src/solids/evaluate.ts";
import { RECYCLE_BYTES, SolidsClient } from "../src/solids/client.ts";
import { occlusion } from "../src/occlusion.ts";
import { orbitBy, viewAxes, worldToScreen, type View } from "../src/view.ts";
import { dot3 } from "../src/vec3.ts";
import { L, T, W, circleOn, loadSolver, onTop, plate } from "./solids/scene.ts";
import { tiltedFrame } from "./frames.ts";
import { polygon } from "./profiles.ts";
import { PARTS } from "./solids/parts.ts";
import { rect, profile, roundedRect } from "./solids/profiles.ts";
import { inProcessPort, kernel, noKernel as skip, smlibFactory } from "./solids/load.ts";

/** The model's body `name` through the kernel, as the app evaluates it. */
async function evaluate(m: Model, name = "e1"): Promise<BodyResult> {
  const ev = new Evaluator(await kernel());
  const r = ev.run(programOf(m).program).bodies.find((b) => b.name === name);
  assert.ok(r, `${name} is a kernel body`);
  return r;
}

function solidOf(r: BodyResult): NonNullable<BodyResult["solid"]> {
  assert.ok(r.solid, `no solid: ${JSON.stringify(r.failed)}`);
  return r.solid;
}

const valid = (r: BodyResult) => assert.deepEqual(solidOf(r).validity, { manifold: true, failures: 0 });
const lidEdges = (r: BodyResult) => [...new Set(solidOf(r).edges.map((e) => e.name).filter((n) => n.split("|").includes("e1.lid")))];
const close = (a: number, b: number, rel = 1e-9, what = "") => assert.ok(Math.abs(a - b) <= rel * Math.max(1, Math.abs(b)), `${what} ${a} against ${b}`);

/** A filleted straight edge of length `len` removes (4 − π)/4 · r² · len: a square of r² less a quarter disc. */
const filletCut = (r: number, len: number) => ((4 - Math.PI) / 4) * r * r * len;

// ---- by volume, against closed forms ------------------------------------------------

test("one edge of a plate on a tilted frame, filleted: V − (4 − π)/4 · r² · L, and its face is named after its edge", { skip }, async () => {
  await loadSolver();
  const m = new Model(3);
  const p = plate(m);
  const e = filletEdges(m, p.feature, ["e1.lid|e1.m0"], 3);
  assert.equal(e, "e2");
  const r = await evaluate(m);
  valid(r);
  close(solidOf(r).volume, L * W * T - filletCut(3, L), 1e-9, "volume");
  const faces = new Set(solidOf(r).faces.map((f) => f.name));
  assert.ok(faces.has("e2.f0") && !faces.has("e1.lid|e1.m0"));
  assert.ok(!solidOf(r).edges.some((x) => x.name === "e1.lid|e1.m0"), "the edge is gone, rounded");
  for (const n of ["e1.lid|e2.f0", "e1.m0|e2.f0"]) assert.ok(solidOf(r).edges.some((x) => x.name === n), `${n}: the fillet's edges are named by its face`);
});

test("the spike's fillet-outline-and-top through the app: a rounded outline's lid, filleted, against Pappus", { skip }, async () => {
  await loadSolver();
  const part = PARTS.find((x) => x.name === "fillet-outline-and-top")!;
  const d = part.dims;
  const m = new Model(3);
  const t = tiltedFrame(m);
  const { lines } = polygon(m, t, [[0, 0], [d.L, 0], [d.L, d.W], [0, d.W]]);
  // Each corner rounded in the sketch, as a user would — then extruded.
  for (let i = 0; i < 4; i++) fillet(m, lines[i], lines[(i + 1) % 4], d.R);
  m.solve();
  extrude(m, lines[0], d.T);
  m.solve();
  const before = await evaluate(m).catch(() => null);
  assert.equal(before, null, "one extrude is no kernel body until it is rounded");
  const first = new Evaluator(await kernel()).run(programOf(m, true).program).bodies[0];
  const lid = lidEdges(first);
  assert.equal(lid.length, 8, "four lines and four arcs");
  filletEdges(m, "e1", lid, d.r);
  const r = await evaluate(m);
  valid(r);
  close(solidOf(r).volume, part.expect(d).volume, 1e-9, "volume");
  const made = [...new Set(solidOf(r).faces.map((f) => f.name))].filter((n) => n.startsWith("e2."));
  assert.deepEqual(made.sort(), lid.map((_, i) => `e2.f${i}`).sort(), "one face per edge, each named after it");
});

test("the spike's chamfer-top-edges through the app: a cube's lid chamfered, against inclusion–exclusion", { skip }, async () => {
  await loadSolver();
  const part = PARTS.find((x) => x.name === "chamfer-top-edges")!;
  const d = part.dims;
  const m = new Model(3);
  const t = tiltedFrame(m);
  const { lines } = polygon(m, t, [[0, 0], [d.a, 0], [d.a, d.a], [0, d.a]]);
  extrude(m, lines[0], d.a);
  m.solve();
  chamferEdges(m, "e1", ["e1.lid|e1.m0", "e1.lid|e1.m1", "e1.lid|e1.m2", "e1.lid|e1.m3"], d.c);
  const r = await evaluate(m);
  valid(r);
  close(solidOf(r).volume, part.expect(d).volume, 1e-9, "volume");
  // A chamfer's faces are flat, and the kernel says so of none of them as a plane (they are its B-splines).
  assert.equal(solidOf(r).faces.filter((f) => f.name.startsWith("e2.f")).length, 4);
});

test("a hole's rim chamfered: Pappus for the ring the setback removes", { skip }, async () => {
  await loadSolver();
  const m = new Model(3);
  const p = plate(m);
  const top = p.lid.slice(0, 3).join(".");
  const hole = extrude(m, circleOn(m, top, onTop(p, 50, 30), 8, p.t.uz), -T, { mode: "cut" });
  m.solve();
  chamferEdges(m, "e1", [`e1.lid|${hole}.m0`], 1.5);
  const r = await evaluate(m);
  valid(r);
  // A right triangle of legs c, its centroid c/3 out from the bore, swept round it.
  const c = 1.5;
  // To 1e-7: the kernel's chamfer of a circle is a B-spline cone, its volume integrated (measured 1.4e-8).
  close(solidOf(r).volume, L * W * T - Math.PI * 64 * T - (c * c / 2) * 2 * Math.PI * (8 + c / 3), 1e-7, "volume");
});

// ---- the chain -------------------------------------------------------------------------

test("the fillet's place in the chain: after what it rounds, before what is made after it", { skip }, async () => {
  await loadSolver();
  const m = new Model(3);
  const p = plate(m);
  filletEdges(m, p.feature, ["e1.lid|e1.m0", "e1.lid|e1.m2"], 2);
  const top = p.lid.slice(0, 3).join(".");
  const hole = extrude(m, circleOn(m, top, onTop(p, 50, 30), 6, p.t.uz), -T, { mode: "cut" });
  m.solve();
  const [chain] = chainsOf(m).bodies;
  assert.deepEqual(chain.steps.map((s) => s.name), ["e1", "e2", hole]);
  assert.deepEqual(chain.features.map((s) => s.name), ["e1", hole], "the sweeps alone, as every sweep reader wants them");
  const prog = programOf(m).program.bodies[0].nodes;
  assert.deepEqual(prog.map((n) => [n.id, n.op]), [[1, "new"], [2, "fillet"], [3, "subtract"]]);
  const r = await evaluate(m);
  valid(r);
  close(solidOf(r).volume, L * W * T - 2 * filletCut(2, L) - Math.PI * 36 * T, 1e-9, "the cut cuts the rounded plate");
  // Hidden, a fillet is left out of its body, as a later feature is.
  hide(m, "e2");
  assert.deepEqual(chainsOf(m).bodies[0].steps.map((s) => s.name), ["e1", hole]);
  close(solidOf(await evaluate(m)).volume, L * W * T - Math.PI * 36 * T, 1e-9, "hidden, no fillet");
});

test("face fN is the one made of the blend's edge N, whatever order the kernel lists faces in", { skip }, async () => {
  await loadSolver();
  const k = await kernel();
  const XY = { origin: [0, 0, 0] as [number, number, number], x: [1, 0, 0] as [number, number, number], y: [0, 1, 0] as [number, number, number] };
  const box: Node = { id: 1, op: "new", sweep: { kind: "extrude", depth: 10 }, profile: profile(rect(0, 0, 100, 60)), at: XY };
  for (const order of [["e1.lid|e1.m0", "e1.lid|e1.m2"], ["e1.lid|e1.m2", "e1.lid|e1.m0"]]) {
    const r: BodyResult = new Evaluator(k).run({ bodies: [{ name: "b", nodes: [box, { id: 2, op: "fillet", edges: order, size: 3 }] }], prefix: "e", chord: 5e-4, angle: 10 }).bodies[0];
    // m0 is the edge along y = 0, m2 along y = 60.
    const y = (name: string): number => solidOf(r).faces.find((f) => f.name === name)!.point[1];
    const want = order.map((e) => (e.endsWith("m0") ? 0 : 60));
    assert.ok(Math.abs(y("e2.f0") - want[0]) < 3 && Math.abs(y("e2.f1") - want[1]) < 3, `${order}: f0 at y ${y("e2.f0")}, f1 at y ${y("e2.f1")}`);
  }
});

// ---- identity ---------------------------------------------------------------------------

test("a cut that takes every edge a fillet names: the fillet is left out, said, and the body is drawn cut", { skip }, async () => {
  await loadSolver();
  factory ??= await smlibFactory();
  const m = new Model(3);
  const p = plate(m);
  // The cutter on a frame parallel to the plate's, 5 below it, so it shares
  // no line with the plate (a rectangle drawn over the plate's own edges
  // would split the region it is extruded from).
  const below = tiltedFrame(m, "u", p.t.at(0, 0, -5));
  const { lines } = polygon(m, below, [[-5, -5], [L + 5, -5], [L + 5, 8], [-5, 8]]);
  extrude(m, lines[0], T + 10, { mode: "cut", into: "e1" });
  m.solve();
  filletEdges(m, "e1", ["e1.lid|e1.m0"], 2);
  const r = await evaluate(m);
  assert.equal(r.failed.length, 1);
  assert.match(r.failed[0].why, /none of the edges it fillets is on the body now/);
  valid(r);
  close(solidOf(r).volume, L * (W - 8) * T, 1e-9, "the body without it is the body now");
  // The page's side says so, and still draws the cut body: a blend's refusal is soft.
  const client = new SolidsClient(() => inProcessPort(factory!));
  const bodies = new Bodies(client, () => {});
  bodies.sync(m);
  for (let i = 0; i < 400 && !bodies.settled; i++) await new Promise((res) => setTimeout(res, 5));
  assert.ok(bodies.settled);
  assert.equal(bodies.views().length, 1, "drawn");
  close(bodies.views()[0].result.solid!.volume, L * (W - 8) * T, 1e-9, "drawn cut");
  assert.ok(bodies.report().lines.some((l) => l.startsWith("e3 could not be applied to e1: none of the edges")), bodies.report().lines.join(" / "));
  client.close();
});
let factory: Awaited<ReturnType<typeof smlibFactory>> | null = null;

test("SMLib will not fillet an edge that runs into an earlier fillet at a corner — and the refusal says what to do", { skip }, async () => {
  await loadSolver();
  const m = new Model(3);
  const p = plate(m);
  filletEdges(m, p.feature, ["e1.lid|e1.m0"], 3);
  filletEdges(m, p.feature, ["e1.lid|e1.m1"], 2);
  const r = await evaluate(m);
  assert.equal(r.failed.length, 1, "pinned: if this starts passing, SMLib has learnt it and the limitation can go");
  assert.match(r.failed[0].why, /runs into an earlier fillet — add it to that fillet instead/);
  // Both in one fillet: fine.
  setEdges(m, "e2", ["e1.lid|e1.m0", "e1.lid|e1.m1"]);
  del(m, "e3");
  const both = await evaluate(m);
  valid(both);
  assert.deepEqual(both.failed, []);
});

// ---- the model's edits ---------------------------------------------------------------------

test("the radius is a dimension: set, save and open, undo by replay; del of either takes both; refusals in words", { skip }, async () => {
  await loadSolver();
  const m = new Model(3);
  const p = plate(m);
  const e = filletEdges(m, p.feature, ["e1.lid|e1.m0"], 3);
  const b = m.blendOf(e);
  assert.equal(b.size, "d2");
  assert.deepEqual(m.relationOf(b.size).args, [3]);
  assert.equal(set(m, "d2.value", 4.5), "d2");
  close(solidOf(await evaluate(m)).volume, L * W * T - filletCut(4.5, L), 1e-9, "set");
  assert.throws(() => set(m, "d2.value", 0), /a fillet's radius is a length more than 0/);
  assert.deepEqual(m.relationOf("d2").args, [4.5], "a refused set leaves the value");
  // Save and open: the journal replays it, no kernel asked.
  const text = save(m);
  const journal = JSON.parse(text).journal as { op: string; args: unknown[] }[];
  assert.deepEqual(journal.filter((j) => ["filletEdges", "set"].includes(j.op)).map((j) => j.op), ["filletEdges", "set"]);
  const m2 = open(text, 3);
  assert.deepEqual(m2.blendOf("e2"), m.blendOf("e2"));
  close(solidOf(await evaluate(m2)).volume, L * W * T - filletCut(4.5, L), 1e-9, "reopened");
  // setEdges, in place.
  setEdges(m2, "e2", ["e1.lid|e1.m0", "e1.lid|e1.m2"]);
  assert.deepEqual(m2.blendOf("e2").edges, ["e1.lid|e1.m0", "e1.lid|e1.m2"]);
  close(solidOf(await evaluate(m2)).volume, L * W * T - 2 * filletCut(4.5, L), 1e-9, "two edges");
  // del of the dimension takes the fillet (the inward rule); del of the fillet takes its dimension.
  const m3 = open(text, 3);
  assert.deepEqual(del(m3, "d2"), ["e2", "d2"]);
  assert.equal(m3.blends.size, 0);
  const m4 = open(text, 3);
  assert.deepEqual(del(m4, "e2"), ["e2", "d2"]);
  assert.ok(!m4.relations.has("d2"));
  // Refusals.
  assert.throws(() => filletEdges(m, "e9", ["e1.lid|e1.m0"], 2), /takes the body first/);
  assert.throws(() => filletEdges(m, "e1", [], 2), /a list of edges/);
  assert.throws(() => filletEdges(m, "e1", ["l1"], 2), /is not an edge's name/);
  assert.throws(() => filletEdges(m, "e1", ["e1.lid|e1.m0"], -1), /more than 0/);
  assert.throws(() => filletEdges(new Model(2), "e1", ["e1.lid|e1.m0"], 2), /2D model has no solid/);
  assert.throws(() => setEdges(m, "e1", ["e1.lid|e1.m0"]), /takes a fillet or a chamfer first/);
});

test("a body deleted leaves its fillet out, said; the organiser lists a fillet among the features and in its body's chain", { skip }, async () => {
  await loadSolver();
  const m = new Model(3);
  const p = plate(m);
  filletEdges(m, p.feature, ["e1.lid|e1.m0"], 3);
  chamferEdges(m, p.feature, ["e1.lid|e1.m2"], 1);
  const [bodies, , features] = organiserSections(m, []);
  assert.equal(bodies.rows[0].detail, "⌒e2 ⌔e3");
  assert.deepEqual(features.rows.map((r) => [r.name, r.detail]), [["e1", "extrude"], ["e2", "fillet"], ["e3", "chamfer"]]);
  del(m, "e1");
  const chains = chainsOf(m);
  assert.deepEqual(chains.left.map((l) => l.feature), ["e2", "e3"]);
  assert.match(chains.left[0].why, /it fillets edges of e1, which is no longer there/);
});

// ---- memory -----------------------------------------------------------------------------------

test("200 fillet rebuilds stay under the Worker's cap — the rounded outline's lid, the spike's leaking case", { skip }, async () => {
  await loadSolver();
  factory ??= await smlibFactory();
  const part = PARTS.find((x) => x.name === "fillet-outline-and-top")!;
  const d = part.dims;
  const m = new Model(3);
  const t = tiltedFrame(m);
  const { lines } = polygon(m, t, [[0, 0], [d.L, 0], [d.L, d.W], [0, d.W]]);
  for (let i = 0; i < 4; i++) fillet(m, lines[i], lines[(i + 1) % 4], d.R);
  m.solve();
  extrude(m, lines[0], d.T);
  m.solve();
  const lid = Array.from({ length: 8 }, (_, i) => `e1.lid|e1.m${i}`);
  filletEdges(m, "e1", lid, d.r);
  const client = new SolidsClient(() => inProcessPort(factory!));
  const heap: { inUse: number; reserved: number }[] = [];
  const t0 = performance.now();
  for (let i = 0; i < 200; i++) {
    // A new radius each time: the fillet is rebuilt, the extrude below it comes from the cache.
    set(m, `${m.blendOf("e2").size}.value`, 2 + (i % 20) * 0.05);
    const r = await client.run(programOf(m).program);
    assert.ok(r.bodies[0].solid, `rebuild ${i}: ${JSON.stringify(r.bodies[0].failed)}`);
    heap.push(r.heap);
  }
  const ms = performance.now() - t0;
  const mb = (n: number) => (n / 2 ** 20).toFixed(1);
  const first = heap[0], last = heap.at(-1)!;
  const peak = Math.max(...heap.map((h) => h.reserved));
  const perRebuild = (last.inUse - first.inUse) / (heap.length - 1);
  console.log(`# 200 fillet rebuilds: in use ${mb(first.inUse)} → ${mb(last.inUse)} MB (${(perRebuild / 1024).toFixed(0)} kB a rebuild), `
    + `linear memory peak ${mb(peak)} MB against the ${mb(RECYCLE_BYTES)} MB recycle; ${client.history.recycled} recycled; ${(ms / 200).toFixed(0)} ms a rebuild`);
  assert.ok(peak < RECYCLE_BYTES, "under the cap without a recycle");
  client.close();
});

// ---- picking -------------------------------------------------------------------------------------

test("an edge picked by a pixel: on it, its name; a finger's reach further; nothing past it; nothing behind a face", { skip }, async () => {
  await loadSolver();
  const m = new Model(3);
  const p = plate(m);
  filletEdges(m, p.feature, ["e1.lid|e1.m0"], 3);
  const r = await evaluate(m);
  const v: BodyView = { name: "e1", features: ["e1"], result: r, faces: bodyFaces(r) };
  let view: View = { ox: 400, oy: 300, scale: 4, target: p.t.at(L / 2, W / 2, T / 2) };
  view = orbitBy(view, -0.6, -1.0);
  const s = solidOf(r);
  const back = s.edges.find((e) => e.name === "e1.lid|e1.m2")!;
  const [x, y] = worldToScreen(view, back.mid);
  // Square to the edge on screen: what "off it" means.
  const [ax, ay] = worldToScreen(view, back.start), [bx, by] = worldToScreen(view, back.end);
  const len = Math.hypot(bx - ax, by - ay);
  const [nx, ny] = [-(by - ay) / len, (bx - ax) / len];
  const off = (d: number): [number, number] => [x + nx * d, y + ny * d];
  assert.equal(edgeAt([v], view, x, y)?.name, "e1.lid|e1.m2");
  assert.equal(edgeAt([v], view, ...off(4))?.name, "e1.lid|e1.m2", "within a line's 5 px");
  assert.equal(edgeAt([v], view, ...off(9)), null, "not 9 px off");
  assert.equal(edgeAt([v], view, ...off(9), null, 22 / 8)?.name, "e1.lid|e1.m2", "a finger reaches 2.75 times as far");
  // The base's edges are behind the body from above: hidden by the faces' own occlusion, not picked.
  const { toward } = viewAxes(view);
  const occ = occlusion(v.faces.filter((f) => dot3(f.normal, toward) > 0), view);
  const under = s.edges.find((e) => e.name === "e1.base|e1.m2")!;
  const [ux, uy] = worldToScreen(view, under.mid);
  const seen = edgeAt([v], view, ux, uy, occ);
  assert.notEqual(seen?.name, "e1.base|e1.m2", `the base's back edge is behind the plate: ${seen?.name}`);
  assert.equal(edgeAt([v], view, ux, uy, null)?.name, "e1.base|e1.m2", "with nothing in front (the wireframe), it picks");
});

test("tangent chains: a rounded outline's lid edge takes all eight; a box's takes one; a face takes its own", { skip }, async () => {
  await loadSolver();
  const k = await kernel();
  const XY = { origin: [0, 0, 0] as [number, number, number], x: [1, 0, 0] as [number, number, number], y: [0, 1, 0] as [number, number, number] };
  const rounded: Node = { id: 1, op: "new", sweep: { kind: "extrude", depth: 15 }, profile: profile(roundedRect(0, 0, 60, 40, 8)), at: XY };
  const box: Node = { id: 1, op: "new", sweep: { kind: "extrude", depth: 15 }, profile: profile(rect(0, 0, 60, 40)), at: XY };
  const run = (n: Node) => new Evaluator(k).run({ bodies: [{ name: "e1", nodes: [n] }], prefix: "e", chord: 5e-4, angle: 10 }).bodies[0];
  const rv: BodyView = (() => { const r = run(rounded); return { name: "e1", features: ["e1"], result: r, faces: bodyFaces(r) }; })();
  const chain = tangentChain(rv, "e1.lid|e1.m0");
  assert.equal(chain.length, 8, `the whole rim: ${chain}`);
  assert.ok(chain.every((n) => n.startsWith("e1.lid|")), "and only the rim");
  const bv: BodyView = (() => { const r = run(box); return { name: "e1", features: ["e1"], result: r, faces: bodyFaces(r) }; })();
  assert.deepEqual(tangentChain(bv, "e1.lid|e1.m0"), ["e1.lid|e1.m0"], "a box's edges meet at corners");
  const lid = bv.result.solid!.faces.findIndex((f) => f.name === "e1.lid");
  assert.deepEqual(faceEdges(bv, lid).sort(), ["e1.lid|e1.m0", "e1.lid|e1.m1", "e1.lid|e1.m2", "e1.lid|e1.m3"]);
  assert.equal(bodyEdges(bv).length, 12);
});

test("the tessellation follows the radius: a fillet's facets turn at most the kernel's 10° whatever its size", { skip }, async () => {
  await loadSolver();
  const k = await kernel();
  const XY = { origin: [0, 0, 0] as [number, number, number], x: [1, 0, 0] as [number, number, number], y: [0, 1, 0] as [number, number, number] };
  const box: Node = { id: 1, op: "new", sweep: { kind: "extrude", depth: 20 }, profile: profile(rect(0, 0, 100, 60)), at: XY };
  const across: number[] = [];
  for (const r of [0.5, 3, 12]) {
    const res: BodyResult = new Evaluator(k).run({ bodies: [{ name: "b", nodes: [box, { id: 2, op: "fillet", edges: ["e1.lid|e1.m0"], size: r }] }], prefix: "e", chord: 5e-4, angle: 10 }).bodies[0];
    const s = solidOf(res);
    const fi = s.faces.findIndex((f) => f.name === "e2.f0");
    const faces = bodyFaces(res).filter((f) => f.face === fi);
    // The facets across the round: their normals' angles about the edge (along x), distinct to a tenth of a degree.
    const angles = [...new Set(faces.map((f) => Math.round((Math.atan2(f.normal[2], -f.normal[1]) * 180) / Math.PI * 10) / 10))].sort((a, b) => a - b);
    const steps = angles.slice(1).map((a, i) => a - angles[i]);
    assert.ok(Math.max(...steps) <= 10 + 1e-6, `r ${r}: the facets turn ${Math.max(...steps)}° at most`);
    across.push(angles.length);
  }
  assert.ok(Math.max(...across) - Math.min(...across) <= 1, `as many facets across a radius of 0.5 as of 12: ${across}`);
});

// ---- the command line ----------------------------------------------------------------------

test("typed: fillet with a list of edges is the solid's, with two lines the sketch's; chamfer, setEdges, ls() and help() say it", async () => {
  await loadSolver();
  const m = new Model(3);
  const p = plate(m);
  const scope = neocadScope({ model: m });
  const fl = scope.fillet as (a: string, b: string | string[], r: number) => string;
  const ch = scope.chamfer as (a: string, b: string[], r: number) => string;
  const se = scope.setEdges as (a: string, b: string[]) => string;
  assert.equal(fl(p.feature, ["e1.lid|e1.m0"], 3), "e2");
  assert.equal(m.blendOf("e2").kind, "fillet");
  assert.equal(ch(p.feature, ["e1.lid|e1.m2"], 1.5), "e3");
  assert.equal(se("e2", ["e1.lid|e1.m0", "e1.lid|e1.m1"]), "e2");
  assert.deepEqual(m.journal.slice(-3).map((j) => j.op), ["filletEdges", "chamferEdges", "setEdges"]);
  const ls = (scope.ls as () => string[])();
  assert.ok(ls.some((l) => l.startsWith("e2  fillet of 2 edges of e1, radius d2 = 3")), ls.join("\n"));
  assert.ok(ls.some((l) => l.startsWith("e3  chamfer of 1 edge of e1, setback d3 = 1.5")));
  const help = (scope.help as () => string)();
  assert.match(help, /fillet\("e1", \["e1\.lid\|e1\.m0", …\], 3\)/);
  assert.match(help, /arm\("round", \{ radius: 3 \}\)/);
  // The sketch's corner fillet is unchanged: two lines.
  const m2 = new Model(3);
  const t = tiltedFrame(m2);
  const { lines } = polygon(m2, t, [[0, 0], [40, 0], [40, 30], [0, 30]]);
  const arc = (neocadScope({ model: m2 }).fillet as (a: string, b: string, r: number) => string)(lines[0], lines[1], 5);
  assert.equal(m2.entities.get(arc)?.kind, "arc");
  assert.equal(m2.blends.size, 0);
});

// ---- the size label's drag --------------------------------------------------------------

// Found by recording the phone test's gesture (docs/plans/touch-density.md):
// the label is placed again every frame from the latest preview, which can
// stand it off another face of the fillet, another way. Read live, the drag's
// direction flipped mid-gesture and the radius fell to its floor — the phone
// test failed whenever a preview landed between two moves.
test("a drag of the size label runs the way the label stood when pressed, whatever face a later preview puts it on", async () => {
  const { EdgeFilletTool } = await import("../src/tools/blend.ts");
  const ctx = { options: { radius: 2 }, solids: null, requestRender() {}, model: new Model(3) };
  const tool = new EdgeFilletTool(ctx as never);
  const inside = tool as unknown as { handle: { at: [number, number]; dir: [number, number] } | null; dragged: number | null };
  inside.handle = { at: [100, 100], dir: [0, -1] };
  const at = (x: number, y: number) => ({ screen: [x, y] as [number, number], world: [0, 0, 0] }) as never;
  tool.onDown(at(100, 100));
  tool.onMove(at(100, 90));
  const out = inside.dragged!;
  assert.ok(out > 2, `out along the label: ${out}`);
  // A preview arrives: the label now stands off another face, pointing back.
  inside.handle = { at: [90, 130], dir: [0, 1] };
  tool.onMove(at(100, 80));
  assert.ok(inside.dragged! > out, `further out still, not back to the floor: ${inside.dragged}`);
});
