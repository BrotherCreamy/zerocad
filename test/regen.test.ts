// Feature regeneration: a feature's expansion is a function of its profile,
// and follows it when the profile is restructured — keeping every twin and wall
// whose vertex or member is still there (docs/plans/feature-regeneration.md).
//
// The case worth reading first is the first one: the bug, measured. Extrude a
// rectangle, fillet a base corner, and before this package the lid stayed a
// four-cornered quadrilateral over a rounded base — every relation satisfied.
// It is reproduced here with the fillet's regeneration handed an empty list,
// which is exactly what a version-8 file's fillet did and still does.
//
// Closed forms throughout, as the extrude and revolve suites do it, on a frame
// tipped off every kernel axis: every twin is checked at its base plus the
// depth (or turned through the angle) by arithmetic written here, never read
// back through the relation that holds it.

import { test } from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { ensureKernelLoaded } from "../src/kernel/problem.ts";
import { Model, type ExtrudeFeature, type ProfileMember } from "../src/model.ts";
import { dist, fix, onPlane } from "../src/relations/basic.ts";
import { parallel } from "../src/relations/geometry.ts";
import { del, extrude, fillet, regen, revolve, set } from "../src/operations.ts";
import { open, save, VERSION } from "../src/persist.ts";
import { findLoops } from "../src/loops.ts";
import { neocadScope } from "../src/replenv.ts";
import { tiltedFrame, type TiltedFrame } from "./frames.ts";
import { baseOf, polygon } from "./profiles.ts";

async function loadKernel() {
  const bytes = await readFile(new URL("../src/kernel/wasm-gen/neocad_kernel_bg.wasm", import.meta.url));
  await ensureKernelLoaded(bytes);
}

const dot = (a: number[], b: number[]) => a.reduce((s, x, i) => s + x * b[i], 0);
const sub = (a: number[], b: number[]) => a.map((x, i) => x - b[i]);
const cross = (a: number[], b: number[]) => [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]];
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

// --- the bug, measured --------------------------------------------------------

test("the bug, measured: a fillet that regenerates nothing leaves the lid four-cornered, one edge leaning from over the tangent point to the far corner", async () => {
  await loadKernel();
  const { m, t, points, lines } = rectangle();
  const e1 = m.featureOf(extrude(m, lines[0], 20), "extrude");
  // An empty list of regenerated features: what a version-8 file's fillet did.
  fillet(m, lines[0], lines[1], 8, null, []);
  assert.equal(m.solve().solved, true, "every relation satisfied");
  const f = m.featureOf("e1", "extrude");
  assert.deepEqual(f, e1, "the record exactly as it was");
  assert.deepEqual(f.loops, [lines], "still four lines — no arc in the profile");
  assert.equal([...m.entities.values()].filter((e) => e.kind === "arc").length, 1, "no twin arc");
  // The corner point is leg one's tangent point now, and its twin went with it.
  assert.ok(near(local(t, m.coords(points[1])), [32, 0, 0], 1e-2));
  const tl2 = m.line(f.twins[0][1]);
  const [a, b] = tl2.refs.map((p) => local(t, m.coords(p)));
  assert.ok(near(a, [32, 0, 20], 1e-2) && near(b, [40, 30, 20], 1e-6), `leg two's twin runs ${a} → ${b}`);
  // Leg two is plumb; its twin leans 8 across 30 — atan(8/30), about 14.9°.
  const lean = (Math.atan2(Math.abs(b[0] - a[0]), b[1] - a[1]) * 180) / Math.PI;
  assert.ok(Math.abs(lean - 14.93) < 0.05, `the lid's edge leans ${lean}°`);
  // The new tangent point has no twin and no wall: four walls, four twins.
  assert.equal(f.walls.length, 4);
  const t2 = m.line(lines[1]).refs[0];
  assert.equal(twinOver(m, f.depth, t2), undefined);
});

// --- fillet regenerates --------------------------------------------------------

test("fillet after extrude regenerates: five corner twins and the centre's, a twin arc on the lid frame, five walls, the depth holding them all — the record rewritten, the name kept", async () => {
  await loadKernel();
  const { m, t, points, lines } = rectangle();
  const e1 = m.featureOf(extrude(m, lines[0], 20), "extrude");
  m.solve();
  const [ents, rels] = [m.entities.size, m.relations.size];
  const keptTwins = e1.twins[0].slice();
  const keptWalls = e1.walls.slice();
  const keptCorners = points.map((p) => twinOver(m, e1.depth, p)!);

  const arc = fillet(m, lines[0], lines[1], 8);
  const ab = m.arc(arc);
  const t2 = m.line(lines[1]).refs[0];
  // The fillet's own three (tangent point, centre, arc); then the regeneration's
  // four (the tangent point's twin, the centre's, the twin arc, one wall).
  assert.equal(m.entities.size - ents, 3 + 4);
  assert.equal(m.relations.size - rels, 4, "the fillet's four relations; the depth is rebuilt, not added");
  assert.equal(m.features.size, 1);
  const f = m.featureOf("e1", "extrude");
  assert.equal(f.depth, e1.depth, "the same dimension");
  assert.equal(f.top, e1.top, "the same lid frame");
  assert.deepEqual(f.loops, [[lines[0], arc, lines[1], lines[2], lines[3]]], "the arc between the legs, in the record's own order");
  assert.deepEqual(f.twins[0].map((n) => m.entities.get(n)?.kind), ["line", "arc", "line", "line", "line"]);
  assert.deepEqual([f.twins[0][0], ...f.twins[0].slice(2)], keptTwins, "every twin edge kept, under its name");
  assert.equal(f.walls.length, 5);
  for (const w of keptWalls) assert.ok(f.walls.includes(w), `${w} kept`);
  // The dimension holds exactly the new twins: five corners and the centre, the
  // arc's radius, the lid frame's three points.
  const pairs = baseOf(m, f.depth);
  assert.equal(pairs.size, 5 + 1 + 1 + 3);
  for (const p of [...points, t2, ab.center]) assert.ok([...pairs.values()].includes(p), `${p} has a twin`);
  points.forEach((p, i) => assert.equal(twinOver(m, f.depth, p), keptCorners[i], `${p} keeps its twin`));
  assert.equal(m.relationOf(f.depth).args[1], 20, "the same value");

  // The twin arc: about the centre's twin, between the twins of the arc's own
  // ends, on the lid frame, the same radius.
  const ta = m.arc(f.twins[0][1]);
  assert.equal(ta.plane, f.top);
  assert.equal(ta.center, twinOver(m, f.depth, ab.center));
  assert.equal(ta.start, twinOver(m, f.depth, ab.start));
  assert.equal(ta.end, twinOver(m, f.depth, ab.end));
  // Leg two's twin is the same entity, re-pointed at the new tangent point's twin.
  assert.deepEqual(m.line(f.twins[0][2]).refs, [twinOver(m, f.depth, t2), twinOver(m, f.depth, points[2])]);
  const wall = f.walls.find((w) => m.line(w).refs[0] === t2);
  assert.ok(wall, "a wall at the new tangent point");
  assert.equal(m.line(wall!).refs[1], twinOver(m, f.depth, t2));

  assert.equal(m.solve().solved, true);
  lidAt(m, t, f.depth, 20);
  assert.ok(Math.abs(m.radius(ta.name) - 8) < 1e-9);
  // In closed form: the lid's corner is rounded exactly as the base's.
  assert.ok(near(local(t, m.coords(ta.center)), [32, 8, 20], 1e-2));
  assert.ok(near(local(t, m.coords(twinOver(m, f.depth, t2)!)), [40, 8, 20], 1e-2));
  // The lid is a loop with the base's area: the rectangle less the corner the
  // arc cut off, r² − πr²/4.
  const lid = findLoops(m).find((l) => l.members.some((mm) => mm.name === ta.name));
  assert.ok(lid && lid.plane.frame === f.top);
  assert.ok(Math.abs(lid!.area - (1200 - 64 + 16 * Math.PI)) < 0.1, `lid area ${lid!.area}`);

  // One journal entry, the call, with what it regenerated resolved.
  assert.deepEqual(m.journal.at(-1), { op: "fillet", args: [lines[0], lines[1], 8, t.name, [["e1", f.loops]]] });
  assert.equal(m.journal.filter((e) => e.op === "fillet").length, 1);
});

test("a relation on a surviving twin survives the fillet, and so does one on the filleted corner's wall — the corner survives, as leg one's tangent point", async () => {
  await loadKernel();
  const { m, points, lines } = rectangle();
  const f = m.featureOf(extrude(m, lines[0], 20), "extrude");
  const wallAtCorner = f.walls.find((w) => m.line(w).refs[0] === points[1])!;
  const onTwin = parallel(m, f.twins[0][2], "t.x");
  const onWall = dist(m, ...m.line(wallAtCorner).refs as [string, string], 20);
  fillet(m, lines[0], lines[1], 8);
  assert.ok(m.relations.has(onTwin) && m.relations.has(onWall));
  const g = m.featureOf("e1", "extrude");
  assert.ok(g.walls.includes(wallAtCorner), "the corner's wall stands, on the tangent point now");
  assert.equal(m.entities.get(g.twins[0][2])?.kind, "line");
  assert.equal(g.twins[0][3], m.relationOf(onTwin).args[0], "the twin the relation is on is still the feature's");
  assert.equal(m.entities.get(g.twins[0][1])?.kind, "arc", "and the lid was rounded round them");
  assert.equal(m.solve().solved, true);
});

test("a corner two features share — the plate extruded up and down from one sketch — regenerates both, in one call", async () => {
  await loadKernel();
  const { m, t, lines } = rectangle();
  extrude(m, lines[0], 20);
  extrude(m, lines[0], -10, t.name);
  const arc = fillet(m, lines[0], lines[1], 8);
  const entry = m.journal.at(-1)!;
  assert.equal(entry.op, "fillet");
  assert.deepEqual((entry.args[4] as [string, unknown][]).map(([n]) => n), ["e1", "e2"]);
  assert.equal(m.solve().solved, true);
  for (const [name, depth] of [["e1", 20], ["e2", -10]] as const) {
    const f = m.featureOf(name, "extrude");
    assert.deepEqual(f.loops, [[lines[0], arc, lines[1], lines[2], lines[3]]], name);
    assert.equal(m.entities.get(f.twins[0][1])?.kind, "arc", `${name} has a twin arc`);
    assert.equal(f.walls.length, 5);
    lidAt(m, t, f.depth, depth);
  }
});

test("a solid standing on the lid follows too: filleting the base re-points the lid's edge, and the boss on the lid regenerates from it", async () => {
  await loadKernel();
  const { m, t, lines } = rectangle();
  const e1 = m.featureOf(extrude(m, lines[0], 20), "extrude");
  m.solve();
  // The whole lid extruded again, 5 more: its profile is e1's twin edges.
  const e2 = m.featureOf(extrude(m, e1.twins[0][0], 5, e1.top), "extrude");
  m.solve();
  fillet(m, lines[0], lines[1], 8);
  const regenerated = (m.journal.at(-1)!.args[4] as [string, unknown][]).map(([n]) => n);
  assert.deepEqual(regenerated, ["e1", "e2"], "e1 by its legs, e2 by the lid edge e1 re-pointed");
  const f1 = m.featureOf("e1", "extrude");
  const f2 = m.featureOf("e2", "extrude");
  assert.equal(f2.loops[0].length, 5);
  assert.ok(f2.loops[0].includes(f1.twins[0][1]), "e2's profile runs along e1's twin arc");
  assert.equal(m.entities.get(f2.twins[0][f2.loops[0].indexOf(f1.twins[0][1])])?.kind, "arc");
  assert.equal(m.solve().solved, true);
  lidAt(m, t, f1.depth, 20);
  // e2's frame is e1's lid frame, whose +z is the sketch's.
  lidAt(m, t, f2.depth, 5);
  assert.equal(e2.name, f2.name);
});

test("set on the depth after the fillet carries the rounded lid: every twin, the arc's centre too, to exactly the new depth", async () => {
  await loadKernel();
  const { m, t, lines } = rectangle();
  extrude(m, lines[0], 20);
  fillet(m, lines[0], lines[1], 8);
  m.solve();
  const f = m.featureOf("e1", "extrude");
  assert.equal(baseOf(m, f.depth).size, 5 + 1 + 1 + 3, "the depth holds the rounded lid");
  set(m, `${f.depth}.value`, 35);
  assert.equal(m.solve().solved, true);
  lidAt(m, t, f.depth, 35);
  for (const w of f.walls) {
    const [a, b] = m.line(w).refs.map((p) => m.coords(p));
    assert.ok(Math.abs(Math.hypot(...sub(b, a)) - 35) < 1e-8, `${w} is 35 long`);
  }
});

// --- revolve ---------------------------------------------------------------

/** Turned through `a` about the tilted frame's own +y, through its origin — Rodrigues', written out. */
function aboutY(t: TiltedFrame, p: number[], a: number): number[] {
  const v = sub(p, t.origin);
  const [c, s] = [Math.cos(a), Math.sin(a)];
  const kxv = cross(t.uy, v);
  const kv = dot(t.uy, v);
  return t.origin.map((o, i) => o + v[i] * c + kxv[i] * s + t.uy[i] * kv * (1 - c));
}

test("a partial revolve regenerates likewise: a twin arc on the end frame, the new tangent point and the centre turned — the end face rounded as the profile is", async () => {
  await loadKernel();
  const { m, t, points, lines } = rectangle([[10, 0], [30, 0], [30, 20], [10, 20]]);
  const quarter = Math.PI / 2;
  const e1 = m.featureOf(revolve(m, lines[0], "t.y", quarter), "revolve");
  m.solve();
  const keptTwins = e1.twins[0].slice();
  const arc = fillet(m, lines[0], lines[1], 5);
  const f = m.featureOf("e1", "revolve");
  assert.equal(f.angle, e1.angle);
  assert.equal(f.end, e1.end, "the same end frame");
  assert.deepEqual(f.loops, [[lines[0], arc, lines[1], lines[2], lines[3]]]);
  assert.deepEqual(f.twins[0].map((n) => m.entities.get(n)?.kind), ["line", "arc", "line", "line", "line"]);
  assert.deepEqual([f.twins[0][0], ...f.twins[0].slice(2)], keptTwins);
  const ta = m.arc(f.twins[0][1]);
  assert.equal(ta.plane, f.end);
  // Five corners and the centre, the arc's radius, the frame pair.
  assert.equal(baseOf(m, f.angle).size, 5 + 1 + 1 + 1);
  assert.equal(m.solve().solved, true);
  for (const [twin, base] of baseOf(m, f.angle)) {
    if (m.entities.get(twin)?.kind !== "point") continue;
    assert.ok(near(m.coords(twin), aboutY(t, m.coords(base), quarter), 1e-8), `${twin} is ${base} turned`);
  }
  assert.ok(Math.abs(m.radius(ta.name) - 5) < 1e-9);
  assert.equal(twinOver(m, f.angle, points[0]), twinOver(m, e1.angle, points[0]));
});

test("a whole-turn revolve regenerates its record only — it has no end face to round — and the sweep is drawn round the arc", async () => {
  await loadKernel();
  const { m, lines } = rectangle([[10, 0], [30, 0], [30, 20], [10, 20]]);
  revolve(m, lines[0], "t.y");
  const before = m.entities.size;
  const arc = fillet(m, lines[0], lines[1], 5);
  const f = m.featureOf("e1", "revolve");
  assert.deepEqual(f.loops, [[lines[0], arc, lines[1], lines[2], lines[3]]]);
  assert.deepEqual(f.twins, []);
  assert.equal(f.end, null);
  assert.equal(m.entities.size - before, 3, "the fillet's own three, nothing more");
  assert.ok(f.names.includes(arc));
  assert.deepEqual(m.journal.at(-1)!.args[4], [["e1", f.loops]]);
});

// --- regen ------------------------------------------------------------------

test("regen on an untouched feature is a no-op that journals once: the same names, the same record, the same pairs", async () => {
  await loadKernel();
  const { m, lines } = rectangle();
  extrude(m, lines[0], 20);
  fillet(m, lines[0], lines[1], 8);
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

// --- the file, and undo -------------------------------------------------------

test("save, open, save is byte-identical with a fillet after an extrude, a set, a regen and a deletion in the history — the same names come back", async () => {
  await loadKernel();
  const { m, lines } = rectangle();
  const e1 = m.featureOf(extrude(m, lines[0], 20), "extrude");
  m.solve();
  const boss = m.featureOf(extrude(m, e1.twins[0][2], 4, e1.top), "extrude");
  m.solve();
  fillet(m, lines[0], lines[1], 8);
  m.solve();
  set(m, `${e1.depth}.value`, 25);
  m.solve();
  regen(m, "e1");
  del(m, boss.name);
  m.solve();

  const once = save(m);
  assert.equal(JSON.parse(once).version, VERSION);
  const back = open(once);
  assert.equal(save(back), once, "byte-identical");
  assert.deepEqual(allNames(back), allNames(m), "the same names, in the same order");
  assert.deepEqual(back.featureOf("e1"), m.featureOf("e1"));
  assert.equal(back.featureOf("e1").loops[0].length, 5, "rounded, by the replayed fillet");
  assert.equal(back.solve().solved, true);
});

test("undo of the fillet is one step and brings the four-cornered lid back", async () => {
  await loadKernel();
  const { m, lines } = rectangle();
  extrude(m, lines[0], 20);
  m.solve();
  // The host's undo bracket: a snapshot either side, one step if they differ.
  const before = save(m, false);
  const length = m.journal.length;
  fillet(m, lines[0], lines[1], 8);
  m.solve();
  assert.equal(m.journal.length, length + 1, "one entry, so one step");
  assert.notEqual(save(m, false), before);
  const undone = open(before);
  const f = undone.featureOf("e1", "extrude");
  assert.deepEqual(f.loops, [lines]);
  assert.deepEqual(f.twins[0].map((n) => undone.entities.get(n)?.kind), ["line", "line", "line", "line"]);
  assert.equal(f.walls.length, 4);
  assert.equal(save(undone, false), before);
});

test("a version-8 file's fillet after an extrude opens as it was — regenerating nothing — and re-saves with that said; a fillet no feature stood on passes untouched", async () => {
  await loadKernel();
  const { m, lines } = rectangle();
  extrude(m, lines[0], 20);
  m.solve();
  fillet(m, lines[0], lines[1], 8, null, []);
  // Drawn after the fillet, so the file names a point the regeneration would claim.
  const later = m.addPoint([60, 60, 0]).name;
  m.solve();
  // What a version-8 build wrote: the four arguments, and nothing regenerated.
  const v8 = JSON.parse(save(m));
  v8.version = 8;
  const entry = v8.journal.find((e: { op: string }) => e.op === "fillet");
  entry.args = entry.args.slice(0, 4);
  // Why the translation is needed: read without it, the fillet regenerates on
  // replay, claims the next auto-names, and the point drawn after it fails.
  assert.throws(() => open(JSON.stringify({ ...v8, version: VERSION })), new RegExp(`\"${later}\" already exists`));
  const opened = open(JSON.stringify(v8));
  assert.deepEqual(opened.featureOf("e1"), m.featureOf("e1"), "the square lid, as the old build left it");
  assert.deepEqual(allNames(opened), allNames(m));
  const resaved = JSON.parse(save(opened));
  assert.equal(resaved.version, VERSION);
  assert.deepEqual(resaved.journal.find((e: { op: string }) => e.op === "fillet").args, [...entry.args, []]);

  // A 3D fillet before any feature, from a version-8 file: untouched.
  const { m: n, lines: k } = rectangle();
  fillet(n, k[0], k[1], 8);
  const plain = JSON.parse(save(n));
  plain.version = 8;
  const back = JSON.parse(save(open(JSON.stringify(plain))));
  assert.deepEqual(back.journal, plain.journal);
});

// --- the command line ---------------------------------------------------------

test("the command line: regen returns the feature, help() lists it, and a typed fillet regenerates as the call does", async () => {
  await loadKernel();
  const { m, lines } = rectangle();
  const scope = neocadScope({ model: m });
  const ex = scope.extrude as (member: string, depth?: number) => string;
  const fl = scope.fillet as (a: string, b: string, r: number) => string;
  const rg = scope.regen as (f: string) => string;
  assert.equal(ex(lines[0], 20), "e1");
  const arc = fl(lines[0], lines[1], 8);
  assert.ok((m.featureOf("e1", "extrude") as ExtrudeFeature).loops[0].includes(arc as ProfileMember));
  assert.equal(rg("e1"), "e1");
  assert.match((scope.help as () => string)(), /regen\("e1"\)/);
  assert.throws(() => rg("nothing"), /"nothing" is not a feature/);
});
