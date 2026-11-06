// Surfaces through the app's own path (docs/plans/surfaces.md): records made by
// the typed calls, read off the model as a program (bodies.ts), evaluated by
// the real kernel, and checked by area or volume against the closed form —
// then the chain, the names an edge keeps through a trim, the shared verbs
// told apart, save and open, deletion, the organiser. The kernel part skips,
// saying so, without an SMLib build; the model part runs anyway.

import { test } from "node:test";
import assert from "node:assert/strict";
import "../src/modules/builtin.ts";
import { Model } from "../src/model.ts";
import { del, extrude, set } from "../src/operations.ts";
import { open, save } from "../src/persist.ts";
import { programOf } from "../src/bodies.ts";
import { surfaceChains } from "../src/surfaces.ts";
import { organiserSections, rowMenu } from "../src/organiser.ts";
import { neocadScope } from "../src/replenv.ts";
import { Evaluator, type BodyResult } from "../src/solids/evaluate.ts";
import { kernel, noKernel as skip } from "./solids/load.ts";
import { loadSolver } from "./solids/scene.ts";
import { hide } from "../src/groups.ts";

type Fn = (...a: unknown[]) => unknown;

function seg(m: Model, a: number[], b: number[]): string {
  return m.addLine(m.addPoint(a).name, m.addPoint(b).name).name;
}

/** A line and the one joined to its end. */
function corner(m: Model, a: number[], b: number[], c: number[]): [string, string] {
  const p = m.addPoint(a).name, q = m.addPoint(b).name, r = m.addPoint(c).name;
  return [m.addLine(p, q).name, m.addLine(q, r).name];
}

async function evaluate(m: Model, name = "s1"): Promise<BodyResult> {
  const ev = new Evaluator(await kernel());
  const r = ev.run(programOf(m).program).bodies.find((b) => b.name === name);
  ev.clear();
  assert.ok(r, `${name} is a body of the program`);
  return r;
}

const solid = (r: BodyResult) => { assert.ok(r.solid, `no solid: ${JSON.stringify(r.failed)}`); return r.solid; };
const area = (r: BodyResult) => solid(r).faces.reduce((a, f) => a + f.area, 0);
const close = (a: number, b: number, rel = 1e-6, what = "") => assert.ok(Math.abs(a - b) <= rel * Math.max(1, Math.abs(b)), `${what} ${a} against ${b}`);
const edges = (r: BodyResult) => solid(r).edges.map((e) => e.name);

function scene(): { m: Model; s: Record<string, Fn> } {
  const m = new Model(3);
  return { m, s: neocadScope({ model: m }) as Record<string, Fn> };
}

// ---- making them, by area -----------------------------------------------------------

test("surface(curve, depth): the chain through it swept along its plane's normal — a record, a dimension, a sheet of length × depth", { skip }, async () => {
  const { m, s } = scene();
  const l = seg(m, [0, 0, 0], [20, 0, 0]);
  assert.equal(s.surface(l, 10), "s1");
  const rec = m.surfaceOf("s1");
  assert.equal(rec.kind, "extrude");
  assert.deepEqual(rec.curves, [l]);
  assert.equal(m.relationOf(rec.size!).op, "surfaceDepth");
  const r = await evaluate(m);
  assert.deepEqual(r.failed, []);
  close(area(r), 200);
  assert.equal(solid(r).validity.manifold, false);
  assert.deepEqual([...edges(r)].sort(), ["s1.m0|s1.base", "s1.m0|s1.end", "s1.m0|s1.lid", "s1.m0|s1.start"]);
  // The depth is a dimension: set re-runs it.
  set(m, `${rec.size}.value`, 15);
  close(area(await evaluate(m)), 300);
});

test("a corner's chain swept, then thickened: two walls, and the solid round them by volume", { skip }, async () => {
  const { m, s } = scene();
  const [a] = corner(m, [0, 0, 0], [10, 0, 0], [10, 10, 0]);
  s.surface(a, 5);
  close(area(await evaluate(m)), 100);
  assert.equal(s.thicken("s1", 1), "s2");
  const r = await evaluate(m);
  assert.equal(solid(r).validity.manifold, true);
  // One side or the other of the corner: 5 · (10·1 + 10·1 ± 1) — the walls meet square either way.
  const v = solid(r).volume;
  assert.ok(Math.abs(v - 105) < 1e-6 || Math.abs(v - 95) < 1e-6, `volume ${v}`);
  assert.throws(() => s.thicken("s1", 1), /s1 is a solid now \(s2 thickened it\)/);
});

test("a revolved surface, a planar one and a body's face: each by its closed form", { skip }, async () => {
  await loadSolver();
  const { m, s } = scene();
  const l = seg(m, [5, 0, 0], [5, 10, 0]);
  const axis = seg(m, [0, 0, 0], [0, 10, 0]);
  assert.equal(s.surface(l, axis), "s1");
  close(area(await evaluate(m)), 2 * Math.PI * 5 * 10, 1e-5);
  const sq = [[30, 0, 0], [50, 0, 0], [50, 10, 0], [30, 10, 0]].map((p) => m.addPoint(p).name);
  const lines = sq.map((p, i) => m.addLine(p, sq[(i + 1) % 4]).name);
  assert.equal(s.surface(lines[0]), "s2");
  close(area(await evaluate(m, "s2")), 200);
  const e = extrude(m, lines[0], 4);
  m.solve();
  assert.equal(s.surface(`${e}.lid`), "s3");
  const lid = await evaluate(m, "s3");
  close(area(lid), 200);
  assert.ok(edges(lid).every((n) => new RegExp(`^s3\\.m0\\|${e}\\.m\\d$`).test(n)), edges(lid).join());
});

// ---- the operations ----------------------------------------------------------------

test("trim by a curve keeps the side the point is on, and the edges it does not cut keep their names", { skip }, async () => {
  const { m, s } = scene();
  const l = seg(m, [0, 0, 0], [20, 0, 0]);
  s.surface(l, 10);
  // A circle in a plane facing the wall, at y = −5: projected along its normal it bores the wall.
  const c = m.addCircle(m.addPoint([10, -5, 5]).name, 3, [0, 1, 0]).name;
  assert.equal(s.trim("s1", c, [2, 0, 5]), "s2");
  const r = await evaluate(m);
  assert.deepEqual(r.failed, []);
  close(area(r), 200 - 9 * Math.PI);
  for (const kept of ["s1.m0|s1.base", "s1.m0|s1.lid", "s1.m0|s1.start", "s1.m0|s1.end"]) assert.ok(edges(r).includes(kept), kept);
  assert.ok(edges(r).includes("s1.m0|s2"), "the trim's own edge is the trim's");
  // The sketch's trim is untouched: a curve first is a curve's trim.
  assert.throws(() => s.trim(l, [5, 0, 0]), /nothing cuts|cut/);
});

test("trim by a surface where it crosses; extend at the lid and at an open end, before the trim applies", { skip }, async () => {
  const { m, s } = scene();
  s.surface(seg(m, [0, 0, 0], [20, 0, 0]), 10);
  // A cutter taller than the wall, so the wall extended is still cut right across.
  s.surface(seg(m, [5, -5, 0], [5, 5, 0]), 30);
  assert.equal(s.trim("s1", "s2", [15, 0, 5]), "s3");
  close(area(await evaluate(m)), 150);
  assert.equal(s.extend("s1", "s1.m0|s1.lid", 5), "s4");
  close(area(await evaluate(m)), 15 * 15);
  s.extend("s1", "s1.m0|s1.end", 5);
  close(area(await evaluate(m)), 20 * 15);
  assert.throws(() => s.extend("s1", "s1.m0|s3", 2), /boundary edge of the sweep/);
  // The sketch's extend is the sketch's: a lone line has nothing to reach.
  const l = seg(m, [0, 20, 0], [5, 20, 0]);
  assert.throws(() => s.extend(l, [1, 20, 0]), /nothing lies past/);
});

test("knit two sheets into one, then fillet the join: area 100 − 2rh + (π/2)rh; the chamfer the same with a flat", { skip }, async () => {
  const { m, s } = scene();
  const a = seg(m, [0, 0, 0], [10, 0, 0]);
  const b = seg(m, [10, 0, 0], [10, 10, 0]);
  s.surface([a], 5);
  s.surface([b], 5);
  assert.equal(s.knit("s1", "s2"), "s3");
  const chains = surfaceChains(m).chains;
  assert.deepEqual(chains.map((c) => c.name), ["s1"], "s2 is part of s1");
  const k = await evaluate(m);
  close(area(k), 100);
  assert.deepEqual(solid(k).edges.filter((e) => !e.lamina).map((e) => e.name), ["s1.m0|s2.m0"]);
  assert.equal(s.fillet("s1", "s2", 2), "s4");
  const f = await evaluate(m);
  assert.deepEqual(f.failed, []);
  close(area(f), 100 - 2 * 2 * 5 + (Math.PI / 2) * 2 * 5);
  assert.ok(solid(f).faces.some((x) => x.name === "s4.f0"));
  del(m, "s4");
  assert.equal(s.chamfer("s1", "s2", 2), "s5");
  close(area(await evaluate(m)), 100 - 2 * 2 * 5 + Math.SQRT2 * 2 * 5);
});

test("fillet between two surfaces that only cross: each trimmed back to the other, knitted, rounded — in one record", { skip }, async () => {
  const { m, s } = scene();
  s.surface(seg(m, [0, 0, 0], [20, 0, 0]), 10);
  s.surface(seg(m, [5, -5, 0], [5, 5, 0]), 10);
  assert.equal(s.fillet("s1", "s2", 2), "s3");
  assert.deepEqual(surfaceChains(m).chains.map((c) => c.name), ["s1"]);
  const r = await evaluate(m);
  assert.deepEqual(r.failed, []);
  close(area(r), 150 + 50 - 2 * 2 * 10 + (Math.PI / 2) * 2 * 10);
});

test("a closed knit: a square tube and two planar caps, closed into a solid of 1000, or thickened into a hollow of 12³ − 10³", { skip }, async () => {
  const { m, s } = scene();
  const sq = (z: number) => {
    const p = [[0, 0, z], [10, 0, z], [10, 10, z], [0, 10, z]].map((q) => m.addPoint(q).name);
    return p.map((q, i) => m.addLine(q, p[(i + 1) % 4]).name);
  };
  const bottom = sq(0);
  s.surface(bottom[0], 10);
  s.surface(bottom[1]);
  s.surface(sq(10)[0]);
  assert.equal(s.knit("s1", "s2", "s3"), "s4");
  const closed = await evaluate(m);
  close(area(closed), 600);
  assert.equal(s.solidify("s1"), "s5");
  close(solid(await evaluate(m)).volume, 1000);
  del(m, "s5");
  assert.equal(s.thicken("s1", 1), "s6");
  close(solid(await evaluate(m)).volume, 12 ** 3 - 10 ** 3);
});

test("offset: a new surface along the other's normals, the other kept", { skip }, async () => {
  const { m, s } = scene();
  const l = seg(m, [5, 0, 0], [5, 10, 0]);
  s.surface(l, seg(m, [0, 0, 0], [0, 10, 0]));
  assert.equal(s.offset("s1", 2), "s2");
  close(area(await evaluate(m, "s2")), 2 * Math.PI * 7 * 10, 1e-5);
  close(area(await evaluate(m, "s1")), 2 * Math.PI * 5 * 10, 1e-5);
  assert.deepEqual(surfaceChains(m).chains.map((c) => c.name), ["s1", "s2"]);
});

// ---- the model ---------------------------------------------------------------------

test("the shared verbs: a surface first is the surface's, anything else the sketch's or the solid's, journalled apart", async () => {
  await loadSolver();
  const { m, s } = scene();
  const [a, b] = corner(m, [0, 0, 0], [10, 0, 0], [10, 10, 0]);
  s.surface(a, 5);
  s.surface(seg(m, [0, 20, 0], [10, 20, 0]), 5);
  s.offset("s1", 1);
  s.knit("s1", "s2");
  const ops = (m.journal ?? []).map((e: { op: string }) => e.op);
  void ops;
  const text = save(m, false);
  for (const op of ["surfaceExtrude", "offsetSurface", "knit"]) assert.ok(text.includes(`"${op}"`), op);
  // The sketch's fillet of two lines is still the sketch's: an arc, no surface record.
  const before = m.surfaces.size;
  const arc = s.fillet(a, b, 2) as string;
  assert.equal(m.entities.get(arc)?.kind, "arc");
  assert.equal(m.surfaces.size, before);
  assert.ok(!save(m, false).includes('"filletSurfaces"'));
});

test("save and open: every record back by replay, the same chain, the same dimensions", async () => {
  await loadSolver();
  const { m, s } = scene();
  s.surface(seg(m, [0, 0, 0], [20, 0, 0]), 10);
  s.surface(seg(m, [5, -5, 0], [5, 5, 0]), 10);
  const c = m.addCircle(m.addPoint([15, -5, 5]).name, 2, [0, 1, 0]).name;
  s.trim("s1", c, [2, 0, 5]);
  s.extend("s1", "s1.m0|s1.lid", 5);
  s.fillet("s1", "s2", 2, [[15, 0, 5], null]);
  s.thicken("s1", 1);
  const text = save(m);
  const back = open(text);
  assert.deepEqual([...back.surfaces.values()], [...m.surfaces.values()]);
  assert.deepEqual(surfaceChains(back), surfaceChains(m));
  assert.equal(save(back), text);
});

test("deleting: a curve takes the surface swept from it and every record after; del of a record takes it and its dimension", async () => {
  await loadSolver();
  const { m, s } = scene();
  const l = seg(m, [0, 0, 0], [20, 0, 0]);
  s.surface(l, 10);
  s.surface(seg(m, [5, -5, 0], [5, 5, 0]), 10);
  s.trim("s1", "s2", [15, 0, 5]);
  s.offset("s1", 2);
  const dim = m.surfaceOf("s4").size!;
  del(m, "s4");
  assert.ok(!m.surfaces.has("s4") && !m.relations.has(dim), "the offset and its distance");
  // The cutter deleted takes the trim that names it; the line deleted takes s1.
  del(m, "s2");
  assert.deepEqual([...m.surfaces.keys()], ["s1"]);
  s.thicken("s1", 1);
  del(m, l);
  assert.equal(m.surfaces.size, 0);
  assert.ok(![...m.relations.values()].some((r) => r.op.startsWith("surface")), "no dimension is left holding nothing");
});

test("refusals say what to do, before anything is made", async () => {
  await loadSolver();
  const { m, s } = scene();
  const l = seg(m, [0, 0, 0], [20, 0, 0]);
  assert.throws(() => s.surface(l, 0), /a number other than 0/);
  // Not a surface: the sketch's trim, which says what it takes.
  assert.throws(() => s.trim("s9", l, [0, 0, 0]), /trim takes a line, an arc or a circle/);
  s.surface(l, 10);
  assert.throws(() => s.trim("s1", "s1", [0, 0, 0]), /cannot trim itself/);
  assert.throws(() => s.trim("s1", l, [0, 0]), /\[x, y, z\]/);
  assert.throws(() => s.knit("s1"), /takes the surfaces/);
  assert.throws(() => s.fillet("s1", "s1", 2), /takes two/);
  assert.throws(() => s.thicken("s1", 0), /other than 0/);
  const flat = new Model(2);
  const f = (neocadScope({ model: flat }) as Record<string, Fn>);
  const l2 = flat.addLine(flat.addPoint([0, 0]).name, flat.addPoint([1, 0]).name).name;
  assert.throws(() => f.surface(l2, 3), /surfaces are 3D/);
  assert.equal(m.surfaces.size, 1);
});

test("the organiser: a Surfaces section, a row per surface with its chain, hidden by its first record; its menu types", async () => {
  await loadSolver();
  const { m, s } = scene();
  s.surface(seg(m, [0, 0, 0], [10, 0, 0]), 5);
  s.surface(seg(m, [10, 0, 0], [10, 10, 0]), 5);
  s.knit("s1", "s2");
  s.fillet("s1", "s2", 1);
  const sec = organiserSections(m).find((x) => x.id === "surfaces")!;
  assert.ok(sec, "a Surfaces section");
  assert.deepEqual(sec.rows.map((r) => r.name), ["s1"]);
  assert.match(sec.rows[0].detail, /extrude \+s2 ⌒s4/);
  assert.equal(sec.rows[0].eyeCommand, 'hide("s1")');
  hide(m, "s1");
  assert.equal(programOf(m).program.bodies.length, 0, "hidden, it is not built");
  const menu = rowMenu(m, "s1")!;
  const labels = menu.items.map((i) => i.label);
  for (const want of ["Thicken…", "Offset…", "Delete"]) assert.ok(labels.includes(want), `${want} in ${labels}`);
});
