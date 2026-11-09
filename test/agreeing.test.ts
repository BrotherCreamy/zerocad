// Redundancy counted, not blamed (TODO.md's register, the owner's principle:
// *agreeing over-constraint is normal*; docs/plans/constraints-palette.md).
//
// A relation every row of which the earlier rows imply is still found
// (`redundant`, the later way of saying one thing), but what is *said* is the
// **agreeing set**: the relations that together say something more than once,
// none of them to blame — four perpendiculars on a rectangle, not "r4". The
// status counts them; the constraints palette lists them.

import { test } from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { Problem, ensureKernelLoaded } from "../src/kernel/problem.ts";
import { Model } from "../src/model.ts";
import { onPlane } from "../src/relations/basic.ts";
import { arcEndpoints, equalLength, parallel, perpendicular } from "../src/relations/geometry.ts";
import { dist } from "../src/relations/basic.ts";
import { diagnosisLine } from "../src/statusline.ts";
import { tiltedFrame } from "./frames.ts";

await (async () => {
  const bytes = await readFile(new URL("../src/kernel/wasm-gen/neocad_kernel_bg.wasm", import.meta.url));
  await ensureKernelLoaded(bytes);
})();

function solved(m: Model) {
  const r = m.solve();
  assert.equal(r.solved, true, JSON.stringify(r.offenders));
  return r;
}

/** A 2D line with its two points. */
function line(m: Model, name: string, a: number[], b: number[]): string {
  m.addPoint(a, `${name}a`);
  m.addPoint(b, `${name}b`);
  return m.addLine(`${name}a`, `${name}b`, name).name;
}

/** The rectangle tool's rectangle: four corners, four edges, four right angles (profiles-held.md). */
function perpRectangle(m: Model, w = 40, h = 25): string[] {
  const corners = [[0, 0], [w, 0], [w, h], [0, h]];
  corners.forEach((c, i) => m.addPoint(c, `k${i}`));
  for (let i = 0; i < 4; i++) m.addLine(`k${i}`, `k${(i + 1) % 4}`, `e${i}`);
  return [0, 1, 2, 3].map((i) => perpendicular(m, `e${i}`, `e${(i + 1) % 4}`));
}

const sorted = (sets: readonly (readonly string[])[]) => sets.map((s) => [...s].sort()).sort((a, b) => a.join().localeCompare(b.join()));

test("the kernel: a block whose rows are implied names the blocks it agrees with, each one needed", () => {
  const p = new Problem();
  const x = p.addVar(1), y = p.addVar(2), z = p.addVar(3);
  const a = p.addResidual([x, y], ([u, v]) => [u.sub(v)]);
  const b = p.addResidual([y, z], ([u, v]) => [u.sub(v)]);
  const c = p.addResidual([x, z], ([u, v]) => [u.sub(v)]); // implied by a and b together
  const d = p.addResidual([x], ([u]) => [u.sub(5)]);        // independent of all of them
  const an = p.analyse({ agreeing: true });
  assert.deepEqual(an.dependent.map((e) => e.block), [c]);
  assert.deepEqual(an.agreeing, [{ block: c, with: [a, b] }], `d takes no part: ${JSON.stringify(an.agreeing)}`);
  void d;
});

test("the kernel: a row said three times — the ones no single removal frees fall back to the whole support", () => {
  const p = new Problem();
  const x = p.addVar(1), y = p.addVar(2);
  const a = p.addResidual([x, y], ([u, v]) => [u.sub(v)]);
  const b = p.addResidual([x, y], ([u, v]) => [u.sub(v)]);
  const c = p.addResidual([x, y], ([u, v]) => [u.sub(v)]);
  const an = p.analyse({ agreeing: true });
  // b is implied by a alone; c by a or b — removing either leaves it implied,
  // so neither is needed on its own, and the set is everything that agrees.
  assert.deepEqual(an.agreeing, [{ block: b, with: [a] }, { block: c, with: [a, b] }]);
});

test("four perpendiculars on a rectangle: one agreeing set of all four, and the fourth is the one found redundant", () => {
  const m = new Model(2);
  const perps = perpRectangle(m);
  solved(m);
  const d = m.diagnose();
  assert.deepEqual(d.redundant, [perps[3]], "the later way of saying it is still found");
  assert.deepEqual(sorted(d.agreeing), [perps.slice().sort()], "and the set says all four agree, none blamed");
});

test("perpendicular twice: the two agree", () => {
  const m = new Model(2);
  line(m, "l1", [0, 0], [10, 0]);
  line(m, "l2", [0, 0], [1, 10]);
  const first = perpendicular(m, "l1", "l2");
  const again = perpendicular(m, "l2", "l1");
  solved(m);
  assert.deepEqual(sorted(m.diagnose().agreeing), [[first, again].sort()]);
});

test("an eq the rectangle already implies joins the perps' set, and the dimensions that take no part stay out", () => {
  const m = new Model(2);
  const perps = perpRectangle(m);
  const d1 = dist(m, "k0", "k1", 40);
  const d2 = dist(m, "k1", "k2", 25);
  const eq = equalLength(m, "e0", "e2");
  solved(m);
  const d = m.diagnose();
  assert.ok(d.redundant.includes(eq), `the eq is implied: ${d.redundant}`);
  assert.equal(d.agreeing.length, 1, `one set, the perps' and the eq's merged: ${JSON.stringify(d.agreeing)}`);
  const set = d.agreeing[0];
  assert.ok(set.includes(eq), "the eq is in it");
  assert.ok(perps.some((p) => set.includes(p)), "with the right angles that imply it");
  assert.ok(!set.includes(d1) && !set.includes(d2), `the dimensions say something of their own: ${set}`);
});

test("the shipped tools' structural rows agree with nothing: a 3D arc on its plane, made in the arc tool's order", () => {
  const m = new Model(3);
  const t = tiltedFrame(m);
  m.addPoint(t.at(0, 0), "c"); m.addPoint(t.at(10, 0), "s"); m.addPoint(t.at(0, 10), "e");
  for (const p of ["s", "e"]) onPlane(m, p, t.name);
  m.addArc("c", "s", "e", 10, t.name, "a1");
  onPlane(m, "c", t.name);
  parallel(m, "a1", `${t.name}.z`);
  arcEndpoints(m, "a1");
  solved(m);
  const d = m.diagnose();
  assert.deepEqual(d.redundant, []);
  assert.deepEqual(d.agreeing, [], "a relation with rows of its own is not said twice");
});

test("the status counts the agreeing relations and names none: '5 free · 4 agreeing', muted", () => {
  assert.deepEqual(diagnosisLine(true, 5, [], [], [["r1", "r2", "r3", "r4"]]),
    { cls: "agreeing", parts: ["5 free", " · ", "4 agreeing"], fades: false });
  assert.deepEqual(diagnosisLine(true, 0, [], [], [["r1", "r2"], ["r2", "r5"]]).parts, ["0 free", " · ", "3 agreeing"]);
  assert.deepEqual(diagnosisLine(true, 2, [], [], []), { cls: "", parts: ["2 free"], fades: true });
});
