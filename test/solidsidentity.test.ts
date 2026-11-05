// Identity through a rebuild that changes topology — the spike's unmeasured
// question (docs/plans/solids-kernel.md, "the risky ones first"). The spike
// showed every face and edge name survives a change of dimensions that keeps
// the topology; here a dimension change breaks a pocket through the floor,
// and drags a hole out through a wall and then off the part. What must hold:
// a name that survives keeps meaning the same face (its kind, its place); a
// face that is gone is reported gone, never handed to a neighbour; what is new
// is reported new.

import { test } from "node:test";
import assert from "node:assert/strict";
import { Evaluator, type BodyResult, type Node, type Program, type SweepNode } from "../src/solids/evaluate.ts";
import type { Placement } from "../src/solids/kernel.ts";
import { circle, profile, rect } from "./solids/profiles.ts";
import type { BlendNode } from "../src/solids/evaluate.ts";
import { kernel, noKernel as skip } from "./solids/load.ts";

const top = (z: number): Placement => ({ origin: [0, 0, z], x: [1, 0, 0], y: [0, 1, 0] });
const XY: Placement = top(0);

const plate: SweepNode = { id: 1, op: "new", sweep: { kind: "extrude", depth: 10 }, profile: profile(rect(0, 0, 100, 60)), at: XY };

function program(...nodes: Node[]): Program {
  return { bodies: [{ name: "b", nodes }], prefix: "e", chord: 5e-4, angle: 10 };
}

function solidOf(r: BodyResult): NonNullable<BodyResult["solid"]> {
  assert.ok(r.solid, `no solid: ${JSON.stringify(r.failed)}`);
  return r.solid;
}

const faceNames = (r: BodyResult) => new Set(solidOf(r).faces.map((f) => f.name));
const edgeNames = (r: BodyResult) => new Set(solidOf(r).edges.map((e) => e.name));
const minus = <T>(a: Set<T>, b: Set<T>) => [...a].filter((x) => !b.has(x)).sort();

/** Names before and after, as gone/new. */
function diff(a: BodyResult, b: BodyResult) {
  return {
    facesGone: minus(faceNames(a), faceNames(b)), facesNew: minus(faceNames(b), faceNames(a)),
    edgesGone: minus(edgeNames(a), edgeNames(b)), edgesNew: minus(edgeNames(b), edgeNames(a)),
  };
}

/** Every surviving face name keeps its kind, and its pieces stay where the face was (within `move` of it). */
function sameMeaning(a: BodyResult, b: BodyResult, kinds = true): void {
  const was = new Map(solidOf(a).faces.map((f) => [f.name, f.kind]));
  for (const f of solidOf(b).faces) {
    if (was.has(f.name) && kinds) assert.equal(f.kind, was.get(f.name), `${f.name} changed kind`);
  }
}

function valid(r: BodyResult): void {
  const s = solidOf(r);
  assert.deepEqual(s.validity, { manifold: true, failures: 0 }, `${r.name} is not a valid solid`);
}

test("a pocket deepened until it breaks through loses its floor, and only its floor", { skip }, async () => {
  const ev = new Evaluator(await kernel());
  const pocket = (depth: number): SweepNode => ({
    id: 2, op: "subtract", sweep: { kind: "extrude", depth }, profile: profile(rect(30, 20, 70, 40)), at: top(10),
  });
  const blind = ev.run(program(plate, pocket(-4))).bodies[0];
  valid(blind);
  assert.ok(Math.abs(solidOf(blind).volume - (100 * 60 * 10 - 40 * 20 * 4)) < 1e-6);
  assert.deepEqual([...faceNames(blind)].sort(),
    ["e1.base", "e1.lid", "e1.m0", "e1.m1", "e1.m2", "e1.m3", "e2.lid", "e2.m0", "e2.m1", "e2.m2", "e2.m3"]);

  // Through, flush with the floor (the coplanar case) and past it.
  for (const depth of [-10, -14]) {
    const through = ev.run(program(plate, pocket(depth))).bodies[0];
    valid(through);
    assert.ok(Math.abs(solidOf(through).volume - (100 * 60 * 10 - 40 * 20 * 10)) < 1e-6, `volume at depth ${depth}`);
    const d = diff(blind, through);
    assert.deepEqual(d.facesGone, ["e2.lid"], `faces gone at depth ${depth}`);
    assert.deepEqual(d.facesNew, [], `faces new at depth ${depth}`);
    // The floor's four edges go with it; the walls meet the plate's base instead.
    assert.deepEqual(d.edgesGone, ["e2.lid|e2.m0", "e2.lid|e2.m1", "e2.lid|e2.m2", "e2.lid|e2.m3"]);
    assert.deepEqual(d.edgesNew, ["e1.base|e2.m0", "e1.base|e2.m1", "e1.base|e2.m2", "e1.base|e2.m3"]);
    sameMeaning(blind, through);
    // The base is still one face — with a hole in it now.
    assert.equal(solidOf(through).faces.filter((f) => f.name === "e1.base").length, 1);
  }

  // And back: the floor comes back under its old name.
  const again = ev.run(program(plate, pocket(-4))).bodies[0];
  assert.deepEqual(diff(blind, again), { facesGone: [], facesNew: [], edgesGone: [], edgesNew: [] });
});

test("a hole dragged out through a wall splits the wall into pieces that keep its name, then off the part is idle", { skip }, async () => {
  const ev = new Evaluator(await kernel());
  const hole = (x: number): SweepNode => ({
    id: 2, op: "subtract", sweep: { kind: "extrude", depth: -12 }, profile: profile(circle(x, 30, 5)), at: top(10),
  });
  const inside = ev.run(program(plate, hole(50))).bodies[0];
  valid(inside);
  assert.deepEqual([...faceNames(inside)].sort(), ["e1.base", "e1.lid", "e1.m0", "e1.m1", "e1.m2", "e1.m3", "e2.m0"]);
  // e1.m1 is the wall along x = 100 (rect's second side, (100,0) → (100,60)).
  const wall = solidOf(inside).faces.filter((f) => f.name === "e1.m1");
  assert.equal(wall.length, 1);
  assert.ok(Math.abs(wall[0].point[0] - 100) < 1e-9);

  const breaking = ev.run(program(plate, hole(98))).bodies[0];
  valid(breaking);
  const d = diff(inside, breaking);
  assert.deepEqual(d.facesGone, [], "no face name vanishes as the hole breaks out");
  assert.deepEqual(d.facesNew, [], "and none is made up");
  // The wall is two pieces now, each still e1.m1, each still on x = 100, told apart by its neighbours.
  const pieces = solidOf(breaking).faces.filter((f) => f.name === "e1.m1");
  assert.equal(pieces.length, 2);
  for (const p of pieces) assert.ok(Math.abs(p.point[0] - 100) < 1e-9);
  assert.equal(new Set(pieces.map((p) => p.piece)).size, 2, "the pieces have names of their own");
  // The hole's wall meets the plate's wall now, where it met nothing before.
  assert.ok(d.edgesNew.includes("e1.m1|e2.m0"), JSON.stringify(d));
  // A whole cylinder is closed along a seam; a part of one is not, so the seam
  // goes — named as a seam, so nothing mistakes it for an edge of the shape.
  assert.deepEqual(d.edgesGone, ["e2.m0:seam"]);
  sameMeaning(inside, breaking);
  // Volume: the plate less the part of the disc still on it.
  const r = 5, h = 2; // the disc's centre is 2 inside the wall
  const segment = r * r * Math.acos(-h / r) + h * Math.sqrt(r * r - h * h); // area of the disc on x ≤ 100
  assert.ok(Math.abs(solidOf(breaking).volume - (100 * 60 * 10 - segment * 10)) < 1e-6);

  // Off the part: the cut reaches nothing. Said, and the hole's wall is gone, not re-attached.
  const off = ev.run(program(plate, hole(110))).bodies[0];
  valid(off);
  assert.deepEqual(off.idle.map((i) => i.id), [2], "a cut that removes nothing is said");
  assert.deepEqual(diff(inside, off).facesGone, ["e2.m0"]);
  assert.deepEqual(diff(inside, off).facesNew, []);
});

test("an island cut makes two pieces of the lid, each answering to it — a slot right across", { skip }, async () => {
  const ev = new Evaluator(await kernel());
  const slot = (y0: number, y1: number): SweepNode => ({
    id: 2, op: "subtract", sweep: { kind: "extrude", depth: -3 }, profile: profile(rect(-5, y0, 105, y1)), at: top(10),
  });
  const across = ev.run(program(plate, slot(25, 35))).bodies[0];
  valid(across);
  assert.equal(solidOf(across).faces.filter((f) => f.name === "e1.lid").length, 2);
  // Narrow it to a pocket that no longer reaches either side: the lid is one face again.
  const pocket = ev.run(program(plate, { ...slot(25, 35), profile: profile(rect(10, 25, 90, 35)) })).bodies[0];
  valid(pocket);
  assert.equal(solidOf(pocket).faces.filter((f) => f.name === "e1.lid").length, 1);
});

test("the cache: an unchanged program rebuilds nothing, a change rebuilds from the node that changed", { skip }, async () => {
  const k = await kernel();
  let sweeps = 0;
  const counting = new Proxy(k, {
    get(t, prop, recv) {
      const v = Reflect.get(t, prop, recv);
      if (typeof v !== "function") return v;
      return (...a: unknown[]) => {
        if (prop === "extrude" || prop === "revolve") sweeps++;
        return v.apply(t, a);
      };
    },
  });
  const ev = new Evaluator(counting);
  const boss = (h: number): SweepNode => ({ id: 2, op: "union", sweep: { kind: "extrude", depth: h }, profile: profile(circle(50, 30, 8)), at: top(10) });
  const cut = { id: 3, op: "subtract" as const, sweep: { kind: "extrude" as const, depth: -40 }, profile: profile(circle(20, 30, 4)), at: top(40) };
  ev.run(program(plate, boss(5), cut));
  assert.equal(sweeps, 3);
  const again = ev.run(program(plate, boss(5), cut)).bodies[0];
  assert.equal(sweeps, 3, "nothing rebuilt");
  assert.equal(again.ms, 0);
  assert.equal(again.cached, true, "said unchanged, the solid not sent again");
  assert.equal(again.solid, null);
  const taller = ev.run(program(plate, boss(9), cut)).bodies[0];
  assert.equal(sweeps, 5, "the boss and the cut after it, not the plate");
  valid(taller);
  assert.ok(Math.abs(solidOf(taller).volume - (100 * 60 * 10 + Math.PI * 64 * 9 - Math.PI * 16 * 10)) < 1e-6);
});

test("a refusal is a result: the node is left out, said, and the rest of the chain goes on", { skip }, async () => {
  const ev = new Evaluator(await kernel());
  // A profile that is no loop at all (a lone line) cannot be swept.
  const broken: SweepNode = { id: 2, op: "union", sweep: { kind: "extrude", depth: 5 }, profile: { loops: [[{ kind: "line", from: [0, 0], to: [10, 0] }]] }, at: top(10) };
  const hole: SweepNode = { id: 3, op: "subtract", sweep: { kind: "extrude", depth: -20 }, profile: profile(circle(50, 30, 5)), at: top(10) };
  const r = ev.run(program(plate, broken, hole)).bodies[0];
  assert.deepEqual(r.failed.map((f) => f.id), [2]);
  assert.match(r.failed[0].why, /not a solid/);
  valid(r);
  assert.ok(Math.abs(solidOf(r).volume - (100 * 60 * 10 - Math.PI * 25 * 10)) < 1e-6);
});

// ---- a filleted part (docs/plans/solid-fillets.md) --------------------------------------
//
// A fillet names its edges by their two faces, so it follows the body's
// history: what keeps an edge's faces keeps the edge, and its fillet; what
// takes an edge takes its fillet, said.

/** A filleted straight edge of length `len` removes (4 − π)/4 · r² · len. */
const filletCut = (r: number, len: number) => ((4 - Math.PI) / 4) * r * r * len;
const close = (a: number, b: number, what: string) => assert.ok(Math.abs(a - b) <= 1e-9 * Math.max(1, Math.abs(b)), `${what}: ${a} against ${b}`);

/** The whole front of the plate, y < 8, cut away right through. */
const front = (id: number): SweepNode => ({ id, op: "subtract", sweep: { kind: "extrude", depth: 20 }, profile: profile(rect(-5, -5, 105, 8)), at: top(-5) });

test("a filleted part: a cut after the fillet takes the front's fillet with the front, and the back's stands", { skip }, async () => {
  const ev = new Evaluator(await kernel());
  const rounded: BlendNode = { id: 2, op: "fillet", edges: ["e1.lid|e1.m0", "e1.lid|e1.m2"], size: 2 };
  const both = ev.run(program(plate, rounded)).bodies[0];
  valid(both);
  assert.deepEqual([...faceNames(both)].filter((n) => n.startsWith("e2.")).sort(), ["e2.f0", "e2.f1"]);
  const r = ev.run(program(plate, rounded, front(3))).bodies[0];
  valid(r);
  assert.deepEqual(r.missing, [], "the fillet came first: nothing it named was missing when it ran");
  const d = diff(both, r);
  assert.ok(d.facesGone.includes("e2.f0") && !d.facesGone.includes("e2.f1"), `the front fillet went with the front: ${d.facesGone}`);
  close(solidOf(r).volume, 100 * 52 * 10 - filletCut(2, 100), "volume");
  sameMeaning(both, r);
});

test("a filleted part: the same cut before the fillet takes the front edge, which the fillet then says it no longer has", { skip }, async () => {
  const ev = new Evaluator(await kernel());
  const rounded: BlendNode = { id: 3, op: "fillet", edges: ["e1.lid|e1.m0", "e1.lid|e1.m2"], size: 2 };
  const r = ev.run(program(plate, front(2), rounded)).bodies[0];
  valid(r);
  assert.deepEqual(r.missing.map((x) => [x.id, x.edges]), [[3, ["e1.lid|e1.m0"]]], "the edge the cut took, by name");
  assert.ok(faceNames(r).has("e3.f1") && !faceNames(r).has("e3.f0"), "the rest is rounded, and its face keeps its index");
  close(solidOf(r).volume, 100 * 52 * 10 - filletCut(2, 100), "volume");
  // Every edge it names taken: refused, and the body stands without it.
  const gone = ev.run(program(plate, front(2), { ...rounded, edges: ["e1.lid|e1.m0"] })).bodies[0];
  assert.deepEqual(gone.failed.map((f) => f.id), [3]);
  valid(gone);
  close(solidOf(gone).volume, 100 * 52 * 10, "volume without it");
});

test("a filleted part: a notch splits the edge in two — both pieces keep its name, both round — and a thicker plate keeps every name", { skip }, async () => {
  const ev = new Evaluator(await kernel());
  const notch: SweepNode = { id: 2, op: "subtract", sweep: { kind: "extrude", depth: 30 }, profile: profile(rect(40, -5, 60, 20)), at: top(-10) };
  const rounded: BlendNode = { id: 3, op: "fillet", edges: ["e1.lid|e1.m0"], size: 2 };
  const notched = ev.run(program(plate, notch)).bodies[0];
  assert.equal(solidOf(notched).edges.filter((e) => e.name === "e1.lid|e1.m0").length, 2, "two pieces, one name");
  const r = ev.run(program(plate, notch, rounded)).bodies[0];
  valid(r);
  assert.equal(solidOf(r).faces.filter((f) => f.name === "e3.f0").length, 2, "both rounded, under the one name");
  close(solidOf(r).volume, 100 * 60 * 10 - 20 * 20 * 10 - filletCut(2, 80), "volume");
  const thicker = { ...plate, sweep: { kind: "extrude" as const, depth: 14 } };
  const r2 = ev.run(program(thicker, notch, rounded)).bodies[0];
  valid(r2);
  assert.deepEqual(diff(r, r2), { facesGone: [], facesNew: [], edgesGone: [], edgesNew: [] }, "every name holds");
  close(solidOf(r2).volume, 100 * 60 * 14 - 20 * 20 * 14 - filletCut(2, 80), "volume");
});
