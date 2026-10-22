// Feature regeneration: a feature's expansion is a function of its profile,
// and follows it when the profile is restructured — keeping every twin and wall
// whose vertex or member is still there (docs/plans/feature-regeneration.md).
//
// This half is the diff and rebuild and its explicit door, `regen("e1")`; the
// automatic trigger inside `fillet` comes with its own cases.
//
// Closed forms throughout, as the extrude and revolve suites do it, on a frame
// tipped off every kernel axis: every twin is checked at its base plus the
// depth by arithmetic written here, never read back through the relation that
// holds it.

import { test } from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { ensureKernelLoaded } from "../src/kernel/problem.ts";
import { Model } from "../src/model.ts";
import { dist, fix, onPlane } from "../src/relations/basic.ts";
import { parallel } from "../src/relations/geometry.ts";
import { extrude, regen } from "../src/operations.ts";
import { open, save } from "../src/persist.ts";
import { neocadScope } from "../src/replenv.ts";
import { tiltedFrame, type TiltedFrame } from "./frames.ts";
import { baseOf, polygon } from "./profiles.ts";

async function loadKernel() {
  const bytes = await readFile(new URL("../src/kernel/wasm-gen/neocad_kernel_bg.wasm", import.meta.url));
  await ensureKernelLoaded(bytes);
}

const dot = (a: number[], b: number[]) => a.reduce((s, x, i) => s + x * b[i], 0);
const sub = (a: number[], b: number[]) => a.map((x, i) => x - b[i]);
const near = (a: number[], b: number[], tol = 1e-9) => Math.hypot(...sub(a, b)) <= tol;
/** A point's (u, v, w) in the tilted frame. */
const local = (t: TiltedFrame, p: number[]) => [t.ux, t.uy, t.uz].map((ax) => dot(sub(p, t.origin), ax));

/**
 * A 40 × 30 rectangle on the tilted frame, held as a person holds one a fillet
 * can work on: two opposite corners fixed and every edge parallel to an axis
 * (a fixed corner at the fillet would pin the tangent point to it). `[l1, l2,
 * l3, l4]` run bottom, right, top, left; the corner filleted below is l1–l2's,
 * at (40, 0), and its rounded form is known in closed form: tangent points at
 * (32, 0) and (40, 8), centre (32, 8).
 */
function rectangle(corners: [number, number][] = [[0, 0], [40, 0], [40, 30], [0, 30]]) {
  const m = new Model(3);
  const t = tiltedFrame(m);
  const { points, lines } = polygon(m, t, corners);
  fix(m, points[0], [...corners[0], 0], t.name);
  fix(m, points[2], [...corners[2], 0], t.name);
  lines.forEach((l, i) => parallel(m, l, i % 2 === 0 ? `${t.name}.x` : `${t.name}.y`));
  assert.equal(m.solve().solved, true);
  return { m, t, points, lines };
}

/** Every point twin of a dimension's pairs is its base plus `depth` along +z. */
function lidAt(m: Model, t: TiltedFrame, dimension: string, depth: number, tol = 1e-8): void {
  for (const [twin, base] of baseOf(m, dimension)) {
    if (m.entities.get(twin)?.kind !== "point") continue;
    assert.ok(near(m.coords(twin), m.coords(base).map((c, i) => c + depth * t.uz[i]), tol), `${twin} is ${base} + ${depth}·z`);
  }
}

/** The twin a dimension holds over `base`. */
const twinOver = (m: Model, dimension: string, base: string) => [...baseOf(m, dimension)].find(([, b]) => b === base)?.[0];

/** Everything that answers to a name — entities, relations, features — for "nothing was renamed". */
const allNames = (m: Model) => [...m.entities.keys(), ...m.relations.keys(), ...m.features.keys()];

// --- regen ------------------------------------------------------------------

test("regen on an untouched feature is a no-op that journals once: the same names, the same record, the same pairs", async () => {
  await loadKernel();
  const { m, lines } = rectangle();
  extrude(m, lines[0], 20);
  m.solve();
  const [names, record, pairs, length] = [allNames(m), structuredClone(m.featureOf("e1")), m.relationOf("d1").args.slice(), m.journal.length];
  assert.equal(regen(m, "e1"), "e1");
  assert.deepEqual(allNames(m), names);
  assert.deepEqual(m.featureOf("e1"), record);
  assert.deepEqual(m.relationOf("d1").args, pairs);
  assert.equal(m.journal.length, length + 1);
  assert.deepEqual(m.journal.at(-1), { op: "regen", args: ["e1", [["e1", record.loops]]] });
  assert.equal(m.solve().solved, true);
});

test("regen refuses a name that is no feature, and a feature whose profile is gone — leaving it as it was, and the journal too", async () => {
  await loadKernel();
  const { m, t, lines } = rectangle();
  extrude(m, lines[0], 20);
  assert.throws(() => regen(m, "e9"), /"e9" is not a feature — regen takes a feature's name/);
  assert.throws(() => regen(m, lines[0]), new RegExp(`"${lines[0]}" is a line, not a feature`));
  assert.throws(() => regen(m, "d1"), /"d1" is a relation, not a feature/);
  // Leg two re-pointed by hand at a point off the corner: the loop is open.
  const stray = m.addPoint(t.at(50, -5)).name;
  m.retargetLine(lines[1], m.line(lines[1]).refs[0], stray);
  const [record, length, names] = [structuredClone(m.featureOf("e1")), m.journal.length, allNames(m)];
  assert.throws(() => regen(m, "e1"), /e1's profile is gone — "l1" is in no closed loop parallel to t now/);
  assert.deepEqual(m.featureOf("e1"), record);
  assert.equal(m.journal.length, length);
  assert.deepEqual(allNames(m), names);
});

/**
 * regionfeatures.test.ts's plate: 40 × 30, every corner fixed — a `regen` here
 * restructures by a line drawn across, not by a fillet — and the line, when
 * asked for, across it at u = 15 running past both long edges.
 */
function plate() {
  const m = new Model(3);
  const t = tiltedFrame(m);
  const corners: [number, number][] = [[0, 0], [40, 0], [40, 30], [0, 30]];
  const { points, lines } = polygon(m, t, corners);
  points.forEach((p, i) => fix(m, p, [...corners[i], 0], t.name));
  const across = () => {
    const ends = [t.at(15, -10), t.at(15, 40)].map((w) => m.addPoint(w).name);
    ends.forEach((p, i) => { onPlane(m, p, t.name); fix(m, p, [15, i === 0 ? -10 : 40, 0], t.name); });
    return m.addLine(ends[0], ends[1]).name;
  };
  assert.equal(m.solve().solved, true);
  return { m, t, points, lines, across };
}

test("regen after a line is drawn across: the crossings made points, the corners beyond the line released with their twins and walls — and a relation on one of those walls with them — the surviving edges' twins re-pointed, not remade", async () => {
  await loadKernel();
  const { m, t, points, lines, across } = plate();
  const [l1, l2, l3, l4] = lines;
  const e1 = m.featureOf(extrude(m, l4, 10), "extrude");
  m.solve();
  const wallOf = (p: string) => e1.walls.find((w) => m.line(w).refs[0] === p)!;
  const [gone, stays] = [wallOf(points[1]), wallOf(points[0])];
  const onGone = dist(m, ...m.line(gone).refs as [string, string], 10);
  const onStays = dist(m, ...m.line(stays).refs as [string, string], 10);
  const twins = { bottom: e1.twins[0][0], right: e1.twins[0][1], top: e1.twins[0][2], left: e1.twins[0][3] };
  const line = across();
  assert.equal(m.solve().solved, true);

  regen(m, "e1");
  const f = m.featureOf("e1", "extrude");
  const outer = f.loops[0];
  // The left half now: the bottom and top edges as far as the line, the line between them, the left side.
  assert.deepEqual(outer.map((x) => (typeof x === "string" ? x : x.name)), [l1, line, l3, l4]);
  const x1 = (outer[0] as { to: string }).to, x2 = (outer[2] as { from: string }).from;
  assert.deepEqual(outer, [{ name: l1, from: points[0], to: x1 }, { name: line, from: x1, to: x2 }, { name: l3, from: x2, to: points[3] }, l4]);
  for (const x of [x1, x2]) assert.ok(f.owns.includes(x), `${x} made and owned`);
  assert.ok(near(local(t, m.coords(x1)), [15, 0, 0]) && near(local(t, m.coords(x2)), [15, 30, 0]));
  // The corners beyond the line, with their twins and walls, and what was on them.
  for (const p of [points[1], points[2]]) assert.equal(twinOver(m, f.depth, p), undefined, `${p} has left the profile`);
  assert.ok(!m.entities.has(gone) && !m.relations.has(onGone), "the vanished corner's wall, and the relation on it");
  assert.ok(m.entities.has(stays) && m.relations.has(onStays), "a surviving corner's wall, and the relation on it");
  assert.ok(!m.entities.has(twins.right), "the right side's twin went with it");
  // The bottom and top edges' twins are the same entities, re-pointed at the crossings' twins.
  assert.deepEqual(f.twins[0][0], twins.bottom);
  assert.deepEqual(f.twins[0][2], twins.top);
  assert.deepEqual(m.line(twins.bottom).refs, [twinOver(m, f.depth, points[0]), twinOver(m, f.depth, x1)]);
  assert.equal(f.walls.length, 4);
  assert.equal(m.solve().solved, true);
  lidAt(m, t, f.depth, 10);
  assert.deepEqual(m.journal.at(-1), { op: "regen", args: ["e1", [["e1", f.loops]]] });

  // The file names the points, never the keys, and reopens to itself.
  const once = save(m);
  assert.ok(!once.includes("×"));
  const back = open(once);
  assert.equal(save(back), once);
  assert.deepEqual(back.featureOf("e1"), f);
});


test("the command line: regen returns the feature, help() lists it, and a non-feature is refused by name", async () => {
  await loadKernel();
  const { m, lines } = rectangle();
  const scope = neocadScope({ model: m });
  assert.equal((scope.extrude as (member: string, depth?: number) => string)(lines[0], 20), "e1");
  const rg = scope.regen as (f: string) => string;
  assert.equal(rg("e1"), "e1");
  assert.match((scope.help as () => string)(), /regen\("e1"\)/);
  assert.throws(() => rg("nothing"), /"nothing" is not a feature/);
});
