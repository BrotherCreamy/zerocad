// Extrude: a closed loop expanded into a solid's worth of real geometry, held
// by one depth dimension.
//
// Closed forms throughout, for the reason the 3D suites use them: "it solved"
// is what a lid in the wrong place also reports. Every twin is checked at its
// base plus the depth along the sketch frame's +z — read off the frame here,
// independently of the relation — and `set` is checked to move exactly the
// lid by exactly the difference, and nothing else by anything at all.
//
// The sketch is drawn on a frame tipped off every kernel axis (`tiltedFrame`),
// so a +z that is secretly the kernel's z cannot pass.
//
// The case worth reading first is the replay one near the end: a profile built
// from free lines has no loop at all where a replay finds its points, which is
// why the journal carries the profile resolved.

import { test } from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { ensureKernelLoaded } from "../src/kernel/problem.ts";
import { Model } from "../src/model.ts";
import { coincident, dist, fix, onPlane } from "../src/relations/basic.ts";
import { parallel } from "../src/relations/geometry.ts";
import { extrusion } from "../src/relations/extrusion.ts";
import { DEFAULT_DEPTH, del, extrude, fillet, set } from "../src/operations.ts";
import { open, save } from "../src/persist.ts";
import { findLoops } from "../src/loops.ts";
import { neocadScope } from "../src/replenv.ts";
import { describePick } from "../src/picking.ts";
import { placeGlyphs } from "../src/glyphs.ts";
import { curveFrame } from "../src/curveplane.ts";
import { arcSamples } from "../src/arcgeom.ts";
import { axisFrame, tiltedFrame } from "./frames.ts";
import { baseOf, polygon, ring } from "./profiles.ts";

async function loadKernel() {
  const bytes = await readFile(new URL("../src/kernel/wasm-gen/neocad_kernel_bg.wasm", import.meta.url));
  await ensureKernelLoaded(bytes);
}

const dot = (a: number[], b: number[]) => a.reduce((s, x, i) => s + x * b[i], 0);
const sub = (a: number[], b: number[]) => a.map((x, i) => x - b[i]);
const near = (a: number[], b: number[], tol = 1e-9) => Math.hypot(...sub(a, b)) <= tol;

const W = 40, H = 30;

// --- the expansion -----------------------------------------------------------

test("a rectangle: four twins, four twin edges, four walls, a lid frame, one depth, one feature", async () => {
  await loadKernel();
  const m = new Model(3);
  const t = tiltedFrame(m);
  const { points, lines } = polygon(m, t, [[0, 0], [W, 0], [W, H], [0, H]]);
  const before = m.entities.size;
  const relsBefore = m.relations.size;

  assert.equal(extrude(m, lines[0], 20), "e1");
  const f = m.featureOf("e1", "extrude");
  const kinds = (names: string[]) => names.map((n) => m.entities.get(n)?.kind ?? (m.relations.has(n) ? "relation" : "?"));
  // Three lid-frame points and four corner twins; four twin edges and four walls.
  assert.equal(m.entities.size - before, 3 + 1 + 4 + 4 + 4);
  assert.equal(m.relations.size - relsBefore, 1, "one relation: the depth");
  assert.equal(f.depth, "d1", "a dimension, d-named");
  assert.equal(m.relationOf("d1").op, "extrusion");
  assert.deepEqual(f.loops, [lines]);
  assert.equal(f.twins[0].length, 4);
  assert.deepEqual(kinds(f.twins[0]), ["line", "line", "line", "line"]);
  assert.equal(f.walls.length, 4);
  assert.deepEqual(kinds(f.walls), ["line", "line", "line", "line"]);
  assert.equal(m.entities.get(f.top)?.kind, "frame");
  assert.equal(f.frame, t.name);
  // The record names the profile and its frame and owns none of them.
  for (const n of [...lines, t.name]) {
    assert.ok(f.names.includes(n), n);
    assert.ok(!f.owns.includes(n), `${n} is the sketch's, not the feature's`);
  }

  // Every twin is its base plus 20 along the frame's +z — the frame read here,
  // not through the relation.
  const bases = baseOf(m, "d1");
  assert.equal(bases.size, 4 + 3, "four corners and the three lid-frame points");
  for (const [twin, base] of bases) assert.ok(near(m.coords(twin), m.coords(base).map((c, i) => c + 20 * t.uz[i])), twin);
  for (const p of points) assert.ok([...bases.values()].includes(p), `${p} has a twin`);
  // Each wall runs from a corner to its own twin.
  for (const w of f.walls) {
    const [a, b] = m.line(w).refs;
    assert.equal(bases.get(b), a);
  }
  // A twin edge joins the twins of its base edge's ends, in the same direction.
  f.twins[0].forEach((tw, i) => {
    const [a, b] = m.line(tw).refs;
    assert.deepEqual([bases.get(a), bases.get(b)], m.line(lines[i]).refs);
  });

  assert.equal(m.solve().solved, true);
  assert.ok(m.solve().iterations <= 1, "seeded exactly where the depth holds it");

  // Journalled as the one call, with the frame and profile resolved.
  assert.deepEqual(m.journal.at(-1), { op: "extrude", args: [lines[0], 20, t.name, [lines]] });
});

test("the lid is a loop of its own, in the lid frame, with the profile's area — the twins are joined where the corners were", async () => {
  await loadKernel();
  const m = new Model(3);
  const t = tiltedFrame(m);
  const { lines } = polygon(m, t, [[0, 0], [W, 0], [W, H], [0, H]]);
  const f = m.featureOf(extrude(m, lines[0], 20), "extrude");
  const all = findLoops(m);
  const lid = all.find((l) => l.members.every((mm) => f.twins[0].includes(mm.name)));
  assert.ok(lid, "the top cap is a loop");
  assert.equal(lid!.plane.frame, f.top);
  assert.ok(Math.abs(lid!.area - W * H) < 1e-9, `area ${lid!.area}`);
  // A box's six faces: two caps and four walls.
  assert.equal(all.length, 6);
});

test("corners joined by coin, as the line tool joins them, get one twin each — and one wall", async () => {
  await loadKernel();
  const m = new Model(3);
  const t = tiltedFrame(m);
  // Four separate lines whose ends meet only through coin, eight points in all.
  const c: [number, number][] = [[0, 0], [W, 0], [W, H], [0, H]];
  const lines = c.map((a, i) => {
    const b = c[(i + 1) % 4];
    const l = m.addLine(m.addPoint(t.at(...a)).name, m.addPoint(t.at(...b)).name);
    for (const p of l.refs) onPlane(m, p, t.name);
    return l;
  });
  lines.forEach((l, i) => coincident(m, l.refs[1], lines[(i + 1) % 4].refs[0]));
  const f = m.featureOf(extrude(m, lines[0].name, 20), "extrude");
  assert.equal(f.walls.length, 4, "a wall per corner, not per point");
  assert.equal(baseOf(m, f.depth).size, 4 + 3);
  // So the lid's corners are shared points and the lid is a loop.
  assert.ok(findLoops(m).some((l) => l.plane.frame === f.top));
  assert.equal(m.solve().solved, true);
});

test("a filleted loop: the arc's twin is on the lid frame, the same arc, the same radius — and its centre has a twin but no wall", async () => {
  await loadKernel();
  const m = new Model(3);
  const t = tiltedFrame(m);
  const { lines } = polygon(m, t, [[0, 0], [W, 0], [W, H], [0, H]]);
  const arc = fillet(m, lines[0], lines[1], 8);
  assert.equal(m.solve().solved, true);
  const before = m.entities.size;

  const f = m.featureOf(extrude(m, lines[2], 15), "extrude");
  assert.deepEqual(f.loops, [[lines[0], arc, lines[1], lines[2], lines[3]]]);
  // Five corners and the centre, three lid-frame points; four twin lines, the
  // twin arc, five walls; the lid frame.
  assert.equal(m.entities.size - before, 6 + 3 + 4 + 1 + 5 + 1);
  assert.equal(f.walls.length, 5);
  const twinArc = m.arc(f.twins[0][1]);
  const base = m.arc(arc);
  assert.equal(twinArc.plane, f.top, "on the lid frame, so a sketch on the cap means what it says");
  assert.ok(Math.abs(m.radius(twinArc.name) - m.radius(arc)) < 1e-12);
  const bases = baseOf(m, f.depth);
  assert.equal(bases.get(twinArc.center), base.center);
  assert.equal(bases.get(twinArc.start), base.start);
  assert.equal(bases.get(twinArc.end), base.end);
  for (const w of f.walls) assert.notEqual(m.line(w).refs[0], base.center, "no wall at the centre");
  // The radius is one of the depth's pairs too.
  assert.ok(m.relationOf(f.depth).args.includes(arc));
  assert.equal(m.solve().solved, true);

  // Drawn, the twin is the same arc lifted: the same sweep, every sample the
  // base's plus the depth. And after a `set`, the new depth.
  set(m, `${f.depth}.value`, 25);
  assert.equal(m.solve().solved, true);
  const [a, b] = [curveFrame(m, base)!, curveFrame(m, twinArc)!];
  assert.ok(Math.abs(a.sweep - b.sweep) < 1e-6 && a.sweep < Math.PI, `the short arc both times: ${a.sweep}, ${b.sweep}`);
  const [sa, sb] = [arcSamples(a, 16), arcSamples(b, 16)];
  sa.forEach((p, i) => assert.ok(near(sb[i], p.map((c, k) => c + 25 * t.uz[k]), 1e-6), `sample ${i}`));
});

test("a circle is a tube: two rims, two centres, no walls — the cylinder is drawn, not built", async () => {
  await loadKernel();
  const m = new Model(3);
  const t = tiltedFrame(m);
  const c = ring(m, t, 10, 10, 9);
  const before = m.entities.size;
  const f = m.featureOf(extrude(m, c, 12), "extrude");
  assert.deepEqual(f.loops, [[c]]);
  assert.deepEqual(f.walls, []);
  // One centre twin and the lid frame's three points; the twin circle; the frame.
  assert.equal(m.entities.size - before, 1 + 3 + 1 + 1);
  const twin = m.circle(f.twins[0][0]);
  assert.equal(twin.plane, f.top);
  assert.ok(near(m.coords(twin.center), m.coords(m.circle(c).center).map((x, i) => x + 12 * t.uz[i])));
  // Set the base radius and the twin follows: the radius pair holds it.
  m.problem.setVar(m.circle(c).radiusVar, 9);
  const { radius } = await import("../src/relations/geometry.ts");
  radius(m, c, 11);
  assert.equal(m.solve().solved, true);
  assert.ok(Math.abs(m.radius(twin.name) - 11) < 1e-9, `the twin's radius is ${m.radius(twin.name)}`);
});

test("a loop with a hole extrudes with it: the hole gets twins too, and a hole's island is part of the profile", async () => {
  await loadKernel();
  const m = new Model(3);
  const t = tiltedFrame(m);
  const { lines } = polygon(m, t, [[0, 0], [60, 0], [60, 50], [0, 50]]);
  const hole = ring(m, t, 30, 25, 15);
  // The island shares the hole's centre point — concentric, as a hand would
  // draw it by clicking the centre again.
  const island = m.addCircle(m.circle(hole).center, 5, t.name).name;
  assert.equal(m.solve().solved, true);

  const f = m.featureOf(extrude(m, lines[0], 20), "extrude");
  assert.deepEqual(f.loops, [lines, [hole], [island]], "the outline, the hole, and the island inside the hole");
  assert.equal(f.twins.length, 3);
  assert.equal(m.circle(f.twins[2][0]).center, m.circle(f.twins[1][0]).center, "one shared centre, one shared twin");
  assert.equal(f.walls.length, 4, "walls at the outline's corners; circles have none");
  assert.match(describePick(m, { name: lines[0], kind: "line", distance: 0 }), /·\s+e1$/);

  // The hole alone — clicked inside, or named — is a solid plug of its own
  // with the island as *its* hole.
  const g = m.featureOf(extrude(m, hole, 5, t.name), "extrude");
  assert.deepEqual(g.loops, [[hole], [island]]);
});

// --- set ---------------------------------------------------------------------

test("set on the depth moves the whole lid by exactly the difference along +z, and nothing else at all", async () => {
  await loadKernel();
  const m = new Model(3);
  const t = tiltedFrame(m);
  // A fully defined sketch — every corner and the hole's centre fixed in the
  // frame, the hole's radius dimensioned — so "nothing else moves" is exact
  // rather than true up to whatever freedom the sketch had. (A free sketch is
  // free: the damped step shares its first correction between a twin and its
  // base, and a base with room to move keeps a little of it — measured at 7e-7
  // for an undimensioned filleted rectangle, most of it the tangency, which
  // pins a tangent point only to second order.)
  const uv: [number, number][] = [[0, 0], [W, 0], [W, H], [0, H]];
  const corners = uv.map(([u, v]) => m.addPoint(t.at(u, v)).name);
  const lines = corners.map((p, i) => m.addLine(p, corners[(i + 1) % 4]).name);
  corners.forEach((p, i) => fix(m, p, [...uv[i], 0], t.name));
  const centre = m.addPoint(t.at(15, 15)).name;
  fix(m, centre, [15, 15, 0], t.name);
  const hole = m.addCircle(centre, 5, t.name).name;
  const { radius } = await import("../src/relations/geometry.ts");
  radius(m, hole, 5);
  assert.equal(m.solve().solved, true);
  const f = m.featureOf(extrude(m, lines[0], 20), "extrude");
  assert.deepEqual(f.loops, [lines, [hole]]);
  assert.equal(m.solve().solved, true);

  const points = [...m.entities.values()].filter((e) => e.kind === "point").map((e) => e.name);
  const was = new Map(points.map((p) => [p, m.coords(p)]));
  const radii = new Map([...m.entities.values()].filter((e) => e.kind === "circle" || e.kind === "arc").map((e) => [e.name, m.radius(e.name)]));

  assert.equal(set(m, `${f.depth}.value`, 35), f.depth, "the same name, edited in place");
  assert.equal(m.solve().solved, true);
  const lid = new Set(f.owns);
  for (const p of points) {
    const want = lid.has(p) ? was.get(p)!.map((c, i) => c + 15 * t.uz[i]) : was.get(p)!;
    assert.ok(near(m.coords(p), want), `${p}: ${m.coords(p)} vs ${want}`);
  }
  for (const [c, r] of radii) assert.ok(Math.abs(m.radius(c) - r) < 1e-9, `${c} kept its radius`);
  assert.deepEqual(m.journal.at(-1), { op: "set", args: [`${f.depth}.value`, 35] });

  // A refused depth leaves the old one standing.
  assert.throws(() => set(m, `${f.depth}.value`, 0), /non-zero depth/);
  assert.equal(m.relationOf(f.depth).args[1], 35);
  // And a negative one extrudes the other way.
  set(m, `${f.depth}.value`, -10);
  assert.equal(m.solve().solved, true);
  const [twin, base] = [...baseOf(m, f.depth)][0];
  assert.ok(Math.abs(dot(sub(m.coords(twin), m.coords(base)), t.uz) + 10) < 1e-9);
});

test("the twins are ordinary geometry: a diagonal held to 50 and the depth set, the free width gives way — √(50² − h² − d²)", async () => {
  await loadKernel();
  // The CHANGELOG's demonstration, closed-form. A rectangle whose height is
  // dimensioned and whose width is free; one corner fixed; all on the frame.
  const m = new Model(3);
  axisFrame(m);
  const p = [[0, 0, 0], [40, 0, 0], [40, 30, 0], [0, 30, 0]].map((c) => m.addPoint(c).name);
  const l = p.map((a, i) => m.addLine(a, p[(i + 1) % 4]).name);
  parallel(m, l[0], "f.x"); parallel(m, l[2], "f.x");
  parallel(m, l[1], "f.y"); parallel(m, l[3], "f.y");
  fix(m, p[0], [0, 0, 0]);
  dist(m, p[1], p[2], 30);
  for (const q of p) onPlane(m, q, "f");
  assert.equal(m.solve().solved, true);

  const f = m.featureOf(extrude(m, l[0], 20), "extrude");
  const twinOf = new Map([...baseOf(m, f.depth)].map(([tw, b]) => [b, tw]));
  // The lid's corner over p1, held 50 from the opposite corner of the base.
  dist(m, twinOf.get(p[0])!, p[2], 50);
  assert.equal(m.solve().solved, true);
  const width = () => m.coords(p[1])[0] - m.coords(p[0])[0];
  assert.ok(Math.abs(width() - Math.sqrt(50 ** 2 - 30 ** 2 - 20 ** 2)) < 1e-6, `width ${width()}`);

  set(m, `${f.depth}.value`, 30);
  assert.equal(m.solve().solved, true);
  assert.ok(Math.abs(width() - Math.sqrt(50 ** 2 - 30 ** 2 - 30 ** 2)) < 1e-6, `width ${width()}`);
  assert.ok(Math.abs(m.coords(twinOf.get(p[0])!)[2] - 30) < 1e-9, "and the lid is at the new depth");
});

test("the lid frame is held to the sketch frame as a datum: moving the sketch frame carries the lid, the lid never turns the sketch", async () => {
  await loadKernel();
  const m = new Model(3);
  const t = tiltedFrame(m);
  const { lines } = polygon(m, t, [[0, 0], [W, 0], [W, H], [0, H]]);
  const f = m.featureOf(extrude(m, lines[0], 20), "extrude");
  const top = m.frame(f.top);

  // Pull the lid frame's origin away and solve: the sketch frame does not move.
  const frameWas = ["t_o", "t_x", "t_y"].map((n) => m.coords(n));
  m.setCoords(top.origin, m.coords(top.origin).map((c) => c + 7));
  assert.equal(m.solve().solved, true);
  ["t_o", "t_x", "t_y"].forEach((n, i) => assert.ok(near(m.coords(n), frameWas[i], 0), `${n} did not move at all`));
  assert.ok(near(m.coords(top.origin), m.coords("t_o").map((c, i) => c + 20 * t.uz[i])), "and the lid frame went back");

  // Move the sketch frame: the lid frame follows within the same solve.
  for (const n of ["t_o", "t_x", "t_y"]) m.setCoords(n, m.coords(n).map((c, i) => c + [3, -2, 5][i]));
  assert.equal(m.solve().solved, true);
  for (const [n, tn] of [["t_o", top.origin], ["t_x", top.xref], ["t_y", top.yref!]]) {
    assert.ok(near(m.coords(tn), m.coords(n).map((c, i) => c + 20 * t.uz[i])), tn);
  }
});

// --- deletion ------------------------------------------------------------------

test('del("e1") takes the lid, the walls, the lid frame and the depth, and leaves the sketch exactly as it was', async () => {
  await loadKernel();
  const m = new Model(3);
  const t = tiltedFrame(m);
  const { lines } = polygon(m, t, [[0, 0], [W, 0], [W, H], [0, H]]);
  fillet(m, lines[0], lines[1], 6);
  ring(m, t, 15, 15, 5);
  assert.equal(m.solve().solved, true);
  const entities = [...m.entities.keys()];
  const relations = [...m.relations.keys()];
  const coords = new Map(entities.filter((n) => m.entities.get(n)!.kind === "point").map((n) => [n, m.coords(n)]));

  const e = extrude(m, lines[0], 20);
  const f = m.featureOf(e, "extrude");
  const journalAt = m.journal.length;
  const removed = del(m, e);

  assert.equal(removed[0], e, "the record first");
  assert.equal(removed[1], f.depth);
  assert.deepEqual(new Set(removed), new Set([e, ...f.owns]), "exactly what the feature made");
  assert.deepEqual([...m.entities.keys()], entities, "the sketch, entity for entity");
  assert.deepEqual([...m.relations.keys()], relations);
  assert.equal(m.features.size, 0);
  assert.equal(m.solve().solved, true);
  for (const [n, c] of coords) assert.ok(near(m.coords(n), c), `${n} did not move`);
  // Journalled as its expansion, one primitive per name, the record first.
  assert.deepEqual(m.journal.slice(journalAt).map((j) => j.op),
    ["deleteFeature", "deleteRelation", ...removed.slice(2).map(() => "deleteEntity")]);
});

test("deleting a piece of a feature — a profile edge, a lid edge, a wall, the depth — takes its record and nothing more", async () => {
  await loadKernel();
  const build = () => {
    const m = new Model(3);
    const t = tiltedFrame(m);
    const { lines } = polygon(m, t, [[0, 0], [W, 0], [W, H], [0, H]]);
    const f = m.featureOf(extrude(m, lines[0], 20), "extrude");
    return { m, lines, f };
  };

  // A profile edge: the record goes; the lid, the walls and the depth stay —
  // ordinary geometry, still held, drawn without faces.
  {
    const { m, lines, f } = build();
    assert.deepEqual(del(m, lines[2]), [f.name, lines[2]]);
    assert.equal(m.features.size, 0);
    for (const n of f.owns) assert.ok(m.has(n), `${n} stayed`);
    assert.equal(m.solve().solved, true);
  }
  // A wall.
  {
    const { m, f } = build();
    assert.deepEqual(del(m, f.walls[1]), [f.name, f.walls[1]]);
    assert.ok(m.relations.has(f.depth));
  }
  // The depth: the record goes and the lid is free.
  {
    const { m, f } = build();
    assert.deepEqual(del(m, f.depth), [f.name, f.depth]);
    assert.equal(m.solve().solved, true);
  }
  // A lid corner: its edges and wall go with it (they need it), the depth names
  // it, and the record names all of them.
  {
    const { m, f } = build();
    const corner = m.line(f.walls[0]).refs[1];
    const removed = del(m, corner);
    assert.equal(removed[0], f.name);
    assert.ok(removed.includes(f.depth));
    assert.ok(removed.includes(f.walls[0]));
    assert.equal(m.solve().solved, true);
  }
  // The primitives refuse to leave a record naming nothing.
  {
    const { m, f } = build();
    assert.throws(() => m.deleteRelation(f.depth), /"d1" is still part of e1/);
    // (A wall line is named by no relation, so only the record holds it.)
    assert.throws(() => m.deleteEntity(f.walls[0]), new RegExp(`"${f.walls[0]}" is still part of e1`));
  }
});

test("a sketch on the lid goes with the feature; a second extrude on the lid loses only its record", async () => {
  await loadKernel();
  const m = new Model(3);
  const t = tiltedFrame(m);
  const { lines } = polygon(m, t, [[0, 0], [W, 0], [W, H], [0, H]]);
  const f = m.featureOf(extrude(m, lines[0], 20), "extrude");
  // A circle sketched on the cap, on the lid frame.
  const c = m.addPoint(m.coords(m.frame(f.top).origin).map((x, i) => x + 10 * t.ux[i] + 10 * t.uy[i])).name;
  onPlane(m, c, f.top);
  const cap = m.addCircle(c, 3, f.top).name;
  // A second extrude, on the lid's own loop — named through the lid frame,
  // since every lid edge is also the edge of a wall.
  assert.throws(() => extrude(m, f.twins[0][0], 10), /is in 2 loops/);
  const g = m.featureOf(extrude(m, f.twins[0][0], 10, f.top), "extrude");
  assert.deepEqual(g.loops[0].slice().sort(), f.twins[0].slice().sort());

  const removed = del(m, f.name);
  assert.ok(removed.includes(cap), "the circle on the lid frame needs the frame");
  assert.ok(removed.includes(g.name), "the second extrude's profile was the first's lid");
  // Its walls stood on the first lid's corners and need them; its own lid does not.
  assert.ok(removed.includes(g.walls[0]));
  assert.ok(!removed.includes(g.twins[0][0]), "but the second lid is its own, and stays");
  assert.ok(!removed.includes(g.top));
  assert.equal(m.features.size, 0);
  for (const l of lines) assert.ok(m.entities.has(l));
});

// --- refusals ----------------------------------------------------------------------

test("refusals say why, and leave no trace — not a journal entry, an entity or a name", async () => {
  await loadKernel();
  const m = new Model(3);
  const t = tiltedFrame(m);
  const { lines } = polygon(m, t, [[0, 0], [W, 0], [W, H], [0, H]]);
  // A second rectangle sharing the right-hand edge: that edge is in two loops.
  const q = [m.addPoint(t.at(80, 0)).name, m.addPoint(t.at(80, H)).name];
  const right = m.line(lines[1]).refs;
  const extra = [m.addLine(right[0], q[0]).name, m.addLine(q[0], q[1]).name, m.addLine(q[1], right[1]).name];
  // An open polyline, and a bow-tie whose edges cross.
  const open1 = [m.addPoint(t.at(0, 60)).name, m.addPoint(t.at(20, 60)).name, m.addPoint(t.at(20, 80)).name];
  const polyline = [m.addLine(open1[0], open1[1]).name, m.addLine(open1[1], open1[2]).name];
  const bow = [[100, 0], [130, 30], [130, 0], [100, 30]].map(([u, v]) => m.addPoint(t.at(u, v)).name);
  const tie = bow.map((p, i) => m.addLine(p, bow[(i + 1) % 4]).name);
  const journal = m.journal.length, size = m.entities.size;

  assert.throws(() => extrude(m, lines[1], 10), /"l2" is in 2 loops — loop of .* in t, .*; loop of .* in t, .*\. Name the frame/);
  assert.throws(() => extrude(m, polyline[0], 10), /is in no closed loop — loops\(\) lists/);
  assert.throws(() => extrude(m, tie[0], 10), /is in no closed loop .* do not cross one another/);
  assert.throws(() => extrude(m, "t_o", 10), /"t_o" is not a line, arc or circle/);
  assert.throws(() => extrude(m, "nope", 10), /"nope" is not a line, arc or circle/);
  assert.throws(() => extrude(m, lines[0], 0), /non-zero depth/);
  assert.throws(() => extrude(m, lines[0], NaN), /non-zero depth/);
  // Narrowed by a frame no loop of it is parallel to.
  const side = m.addFrame(m.addPoint([0, 0, 0]).name, m.addPoint([0, 0, 1]).name, m.addPoint([0, 1, 0]).name).name;
  assert.throws(() => extrude(m, lines[0], 10, side), new RegExp(`no closed loop parallel to ${side}`));
  assert.throws(() => new Model(2) && extrude(new Model(2), "l1", 10), /needs a 3D model/);

  assert.equal(m.journal.length, journal + 4, "only the side frame's own four entries");
  assert.equal(m.entities.size, size + 4);
  assert.equal(m.features.size, 0);
  // The extra rectangle's own edge is in one loop, and that one extrudes as e1.
  assert.equal(extrude(m, extra[1], 10), "e1");
});

test("a loop in no frame's orientation is refused rather than given a frame nobody chose", async () => {
  await loadKernel();
  const m = new Model(3);
  const pts = [[0, 0, 0], [10, 0, 0], [10, 10, 0], [0, 10, 0]].map((c) => m.addPoint(c).name);
  const l = pts.map((p, i) => m.addLine(p, pts[(i + 1) % 4]).name);
  assert.throws(() => extrude(m, l[0], 5), /lies in no frame's plane, and no frame is parallel to it/);
  // A frame parallel to it, anywhere, is enough: the direction is its +z.
  axisFrame(m, "g", [100, 100, 50]);
  const f = m.featureOf(extrude(m, l[0], 5), "extrude");
  assert.equal(f.frame, "g");
  assert.equal(m.solve().solved, true);
  assert.ok(near(m.coords(m.line(f.walls[0]).refs[1]), [0, 0, 5]));
});

test("a given profile is walked by its joins and refused where it does not close", async () => {
  await loadKernel();
  const m = new Model(3);
  const t = tiltedFrame(m);
  const { lines } = polygon(m, t, [[0, 0], [W, 0], [W, H], [0, H]]);
  const c = ring(m, t, 10, 10, 3);
  assert.throws(() => extrude(m, lines[0], 5, t.name, [[lines[0], lines[2], lines[1], lines[3]]]), /"l1" and "l3" do not meet/);
  assert.throws(() => extrude(m, lines[0], 5, t.name, [lines.slice(0, 3)]), /"l3" and "l1" do not meet/);
  assert.throws(() => extrude(m, lines[0], 5, t.name, [[...lines, c]]), /a circle is a loop on its own/);
  assert.throws(() => extrude(m, lines[0], 5, t.name, [[lines[0]]]), /a loop of one member is a circle/);
  assert.throws(() => extrude(m, lines[0], 5, t.name, [[c]]), /"l1" is not in the loops given/);
  assert.throws(() => extrude(m, lines[0], 5, t.name, [lines, lines]), /appears twice/);
  assert.throws(() => extrude(m, lines[0], 5, null, [lines]), /needs the frame/);
  assert.throws(() => extrude(m, lines[0], 5, t.name, "l1" as never), /lists of member names/);
  // Walked backwards is still closed.
  assert.equal(extrude(m, lines[0], 5, t.name, [lines.slice().reverse()]), "e1");
});

// --- the journal ----------------------------------------------------------------------

test("save, open, save is byte-identical with an extrude, a set and a deletion in the history — and the records come back", async () => {
  await loadKernel();
  const m = new Model(3);
  const t = tiltedFrame(m);
  const { lines } = polygon(m, t, [[0, 0], [W, 0], [W, H], [0, H]]);
  fillet(m, lines[0], lines[1], 6);
  ring(m, t, 15, 15, 5);
  m.solve();
  const f = m.featureOf(extrude(m, lines[0], 20), "extrude");
  set(m, `${f.depth}.value`, 32);
  m.solve();
  const g = m.featureOf(extrude(m, f.twins[0][0], 8, f.top), "extrude");
  m.solve();
  del(m, g.name);
  m.solve();
  // And a deletion that takes only a record.
  const h = m.featureOf(extrude(m, f.twins[0][2], 4, f.top), "extrude");
  del(m, h.walls[0]);
  m.solve();

  const once = save(m);
  const reopened = open(once);
  assert.equal(save(reopened), once, "byte for byte");
  assert.deepEqual([...reopened.features.values()], [...m.features.values()]);
  assert.equal(reopened.solve().solved, true);
  assert.ok(once.includes('"deleteFeature"'));
});

test("a profile built from free lines has no loop where a replay finds it — the resolved profile is what reopens it", async () => {
  await loadKernel();
  const m = new Model(3);
  axisFrame(m);
  // Four `ln()`s, seeded on top of one another, then joined and fixed into a
  // rectangle by relations alone.
  const ls = [m.addLine(), m.addLine(), m.addLine(), m.addLine()];
  ls.forEach((l, i) => coincident(m, l.refs[1], ls[(i + 1) % 4].refs[0]));
  [[0, 0, 0], [40, 0, 0], [40, 30, 0], [0, 30, 0]].forEach((at, i) => fix(m, ls[i].refs[0], at));
  assert.equal(m.solve().solved, true);
  const e = extrude(m, ls[0].name, 10);
  m.solve();

  // What a replay sees before the saved values go back: the seeds.
  const seeds = JSON.parse(save(m));
  seeds.journal = seeds.journal.filter((j: { op: string }) => j.op !== "extrude");
  seeds.values = { points: {}, radii: {} };
  assert.deepEqual(findLoops(open(JSON.stringify(seeds))), [], "no loop at the seeds — a re-found profile would fail here");

  const reopened = open(save(m));
  assert.ok(reopened.features.has(e));
  assert.equal(reopened.solve().solved, true);
});

test("a hand-edited file's extrude fails at its own step, saying why", async () => {
  await loadKernel();
  const m = new Model(3);
  const t = tiltedFrame(m);
  const { lines } = polygon(m, t, [[0, 0], [W, 0], [W, H], [0, H]]);
  extrude(m, lines[0], 20);
  const file = JSON.parse(save(m));
  const step = file.journal.findIndex((j: { op: string }) => j.op === "extrude");
  file.journal[step].args[3] = [["l1", "l3", "l2", "l4"]];
  assert.throws(() => open(JSON.stringify(file)), new RegExp(`step ${step + 1}, extrude\\(.*\\): "l1" and "l3" do not meet`));
});

// --- the surface ------------------------------------------------------------------------

test("the command line: extrude returns the feature, ls() lists it, rels() and the hover tag say what the depth is", async () => {
  await loadKernel();
  const m = new Model(3);
  const t = tiltedFrame(m);
  const { lines } = polygon(m, t, [[0, 0], [W, 0], [W, H], [0, H]]);
  const scope = neocadScope({ model: m });
  const ex = scope.extrude as (member: string, depth?: number, frame?: string) => string;
  assert.equal(ex(lines[0], 20), "e1");
  const f = m.featureOf("e1", "extrude");
  const ls = (scope.ls as () => string[])();
  assert.equal(ls.at(-1), "e1  extrude of l1,l2,l3,l4, depth d1 = 20 along t, lid f1");
  // A lid corner is held by the depth and nothing else.
  const corner = m.line(f.walls[0]).refs[1];
  assert.deepEqual((scope.rels as (n?: string) => string[])(corner), ["d1  extrusion 20 along t.z, 7 pairs"]);
  assert.equal(describePick(m, { name: "d1", kind: "relation", distance: 0 }), "d1  extrusion 20 along t.z, 7 pairs  ·  e1");
  assert.match(describePick(m, { name: f.walls[0], kind: "line", distance: 0 }), /·\s+e1$/);
  assert.match((scope.help as () => string)(), /extrude\(member, depth\?, frame\?\)/);
  // No depth: the seed every free entity gets.
  const g = m.featureOf(ex(f.twins[0][0], undefined, f.top), "extrude");
  assert.equal(m.relationOf(g.depth).args[1], DEFAULT_DEPTH);
  assert.equal(DEFAULT_DEPTH, Model.DEFAULT_RADIUS);
});

test("the depth wears its value as a label on the first wall, with witness lines from base to twin", async () => {
  await loadKernel();
  const m = new Model(3);
  const t = tiltedFrame(m);
  const { lines } = polygon(m, t, [[0, 0], [W, 0], [W, H], [0, H]]);
  const f = m.featureOf(extrude(m, lines[0], 20), "extrude");
  const view = { ox: 400, oy: 300, scale: 3 };
  const label = placeGlyphs(m, view).find((g) => g.relation === f.depth)!;
  assert.equal(label.symbol, "20");
  assert.equal(label.isLabel, true);
  const [a, b] = m.line(f.walls[0]).refs;
  const { worldToScreen } = await import("../src/view.ts");
  assert.ok(label.ends && near(label.ends[0], worldToScreen(view, m.coords(a))) && near(label.ends[1], worldToScreen(view, m.coords(b))));
  // Hovering it lights up everything it holds, the sketch frame among them.
  assert.ok(label.highlights.includes(t.name));
  assert.ok(label.highlights.includes(b));
});

test("an extrusion is 3D-only, needs pairs, and refuses a zero depth", async () => {
  await loadKernel();
  const flat = new Model(2);
  axisFrame(flat);
  flat.addPoint([0, 0], "a");
  flat.addPoint([1, 0], "b");
  assert.throws(() => extrusion(flat, "f", 1, "a", "b"), /needs a 3D model/);
  const m = new Model(3);
  axisFrame(m);
  m.addPoint([0, 0, 0], "a");
  m.addPoint([0, 0, 1], "b");
  assert.throws(() => extrusion(m, "f", 1, "a"), /base\/twin pairs/);
  assert.throws(() => extrusion(m, "f", 0, "a", "b"), /non-zero depth/);
  assert.throws(() => extrusion(m, "f", 1, "a", "f"), /not a pair an extrusion can hold/);
  assert.equal(m.relations.size, 0, "and a refused one leaves nothing behind");
});
