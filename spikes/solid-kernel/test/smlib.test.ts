// The spike's API against a real SMLib build. Needs SMLIB_DIR (a directory
// holding the smlib.mjs and smlib.wasm that ../smlib/build.sh makes); without
// it every test here skips and says why — the build is minutes of C++ and
// is not committed.

import { test } from "node:test";
import assert from "node:assert/strict";
import { existsSync } from "node:fs";
import { pathToFileURL } from "node:url";
import { identity, runPart } from "../src/bench.ts";
import { XY } from "../src/kernel.ts";
import { nameAll, tagExtrude } from "../src/naming.ts";
import { PARTS } from "../src/parts.ts";
import { circle, profile, rect } from "../src/profiles.ts";
import { SmlibKernel, type SmModule } from "../src/smlib.ts";

const dir = process.env.SMLIB_DIR;
const skip = !dir || !existsSync(`${dir}/smlib.mjs`) ? "SMLIB_DIR does not name an SMLib build" : false;

let kernel: SmlibKernel | null = null;
async function k(): Promise<SmlibKernel> {
  if (!kernel) {
    const factory = (await import(pathToFileURL(`${dir}/smlib.mjs`).href)).default as () => Promise<SmModule>;
    kernel = new SmlibKernel(await factory());
  }
  return kernel;
}

/**
 * The one part whose build does not give back all it takes: filleting the
 * eight lid edges of a rounded outline (lines and arcs, tangent chain) keeps
 * ~150 kB a time inside SMLib — measured, see the spec's Findings. A fillet of
 * a box's or a cylinder's lid edges keeps nothing.
 */
const LEAKS = "fillet-outline-and-top";

test("a box: volume, box, validity, eight-sided topology", { skip }, async () => {
  const K = await k();
  const s = K.extrude(profile(rect(0, 0, 10, 20)), 30);
  assert.ok(Math.abs(K.volume(s) - 6000) < 1e-6);
  assert.deepEqual(K.bbox(s).map((p) => p.map((x) => Math.round(x * 1e6) / 1e6)), [[0, 0, 0], [10, 20, 30]]);
  assert.deepEqual(K.validity(s), { manifold: true, failures: 0 });
  assert.equal(K.faces(s).length, 6);
  assert.equal(K.edges(s).length, 12);
  K.free(s);
});

test("tessellation: every triangle names a face, and every face has triangles", { skip }, async () => {
  const K = await k();
  const s = K.extrude(profile(rect(0, 0, 10, 10), circle(5, 5, 2)), 4);
  const n = K.faces(s).length;
  const mesh = K.tessellate(s, 0, 15);
  assert.ok(mesh.faceOf.length > 0);
  assert.ok(mesh.faceOf.every((f) => f < n));
  assert.equal(new Set(mesh.faceOf).size, n);
  K.free(s);
});

test("edge polylines: every edge sampled once, a circle's ends meeting, a line's at its vertices", { skip }, async () => {
  const K = await k();
  const s = K.extrude(profile(rect(0, 0, 10, 10), circle(5, 5, 2)), 4);
  const edges = K.edges(s);
  const lines = K.edgePolylines(s, 10);
  assert.deepEqual(lines.map((l) => l.edge).sort((a, b) => a - b), edges.map((_, i) => i));
  for (const { edge, points } of lines) {
    const n = points.length / 3;
    assert.ok(n >= 2);
    const first = [points[0], points[1], points[2]], last = [points[n * 3 - 3], points[n * 3 - 2], points[n * 3 - 1]];
    const e = edges[edge];
    for (let i = 0; i < 3; i++) {
      assert.ok(Math.abs(first[i] - e.start[i]) < 1e-4 || Math.abs(first[i] - e.end[i]) < 1e-4, `edge ${edge} starts off its vertex`);
      assert.ok(Math.abs(last[i] - e.end[i]) < 1e-4 || Math.abs(last[i] - e.start[i]) < 1e-4, `edge ${edge} ends off its vertex`);
    }
  }
  K.free(s);
});

test("a chamfer's distance is the setback along each face", { skip }, async () => {
  // SmApiFilletEdges with the linear cross-section: measured against both
  // readings, it is the setback (the part's closed form), not the width across.
  const r = runPart(await k(), PARTS.find((p) => p.name === "chamfer-top-edges")!);
  assert.ok(r.volumeError! < 1e-12);
});

test("a tag set on a face is read back, and survives a copy", { skip }, async () => {
  const K = await k();
  const p = profile(rect(0, 0, 10, 10));
  const s = K.extrude(p, 5);
  tagExtrude(K, s, 7, p, 5, XY);
  const tags = K.faces(s).map((f) => f.tag).sort();
  assert.deepEqual(tags, [7000, 7001, 7002, 7003, 7004, 7005]);
  const c = K.copy(s);
  assert.deepEqual(K.faces(c).map((f) => f.tag).sort(), tags);
  assert.equal(nameAll(K, c).ambiguous, 0);
  K.free(s); K.free(c);
});

test("exact geometry comes back: a cylinder wall is a cylinder of the profile's radius, with a NURBS net", { skip }, async () => {
  const K = await k();
  const s = K.extrude(profile(circle(0, 0, 3)), 2);
  const wall = K.faces(s).findIndex((f) => f.kind === "cylinder");
  assert.ok(wall >= 0);
  assert.ok(Math.abs(K.faces(s)[wall].radius - 3) < 1e-9);
  const n = K.faceNurbs(s, wall);
  assert.ok(n.rational, "a circle is rational");
  assert.equal(n.points.length, n.count[0] * n.count[1] * 4);
  K.free(s);
});

for (const part of PARTS) {
  test(`part ${part.name}: ${part.tests}`, { skip }, async () => {
    const r = runPart(await k(), part);
    assert.ok(r.ok, JSON.stringify(r));
    assert.equal(r.unassigned, 0, "every triangle on a face");
    assert.equal(r.naming?.ambiguous, 0, "every face named uniquely");
  });
}

test("identity: after every dimension changes, every face and edge name is found again", { skip }, async () => {
  const K = await k();
  for (const p of PARTS) {
    const r = identity(K, p);
    assert.ok(!("error" in r), JSON.stringify(r));
    if ("error" in r) continue;
    assert.ok(r.sameNames, `${p.name}: lost ${r.lost} gained ${r.gained}`);
    assert.ok(r.kindsKept, p.name);
  }
});

test("heap: rebuilding a part gives back what it took — but for the one known leak", { skip }, async () => {
  const K = await k();
  for (const p of PARTS) {
    K.free(p.build(K, p.dims));
    const before = K.heapInUse();
    for (let i = 0; i < 10; i++) K.free(p.build(K, i % 2 ? p.changed : p.dims));
    const perBuild = (K.heapInUse() - before) / 10;
    if (p.name === LEAKS) assert.ok(perBuild > 50_000, `${p.name} no longer leaks (${perBuild} B) — update the Findings`);
    else assert.ok(perBuild < 1_000, `${p.name} keeps ${perBuild} bytes a build`);
  }
});

test("a coplanar union merges the touching faces, and the merged face keeps one feature's tag", { skip }, async () => {
  const K = await k();
  const p = PARTS.find((x) => x.name === "touching-union")!;
  const s = p.build(K, p.dims);
  const names = nameAll(K, s).faces.sort();
  // Six faces: the two boxes' fronts, backs, bottoms and tops each merged into one.
  assert.equal(names.length, 6);
  assert.ok(!names.includes("F2.m0") && !names.includes("F2.base") && !names.includes("F2.lid"), names.join(" "));
  K.free(s);
});
