// Through all is a relation to the far side's own geometry
// (docs/plans/through-all-relation.md, review item 8). The owner: *"correct
// relationships BETWEEN entities … bidirectional relationships everywhere by
// default"*; *"I should be able to pull on anything."*
//
// Until this, a through-all extrude's lid was held at a number the solids
// layer worked out — how far everything made before it stood — read through a
// hook as a constant inside the `extrusion` relation's length row. The first
// three tests are the three faults of that, each failing on the build before
// (measured there: the plate moved 0, no row named it, no relation was
// listed); the rest hold the design that replaced it.

import { test } from "node:test";
import assert from "node:assert/strict";
import { readFile, readdir } from "node:fs/promises";
import { Model, endLabel, endRelation, type ExtrudeFeature } from "../src/model.ts";
import { dist, onPlane } from "../src/relations/basic.ts";
import { parallel, perpendicular } from "../src/relations/geometry.ts";
import { del, endSaid, extrude, fillet, regen, revolve, set, setEnd } from "../src/operations.ts";
import { VERSION, open, save } from "../src/persist.ts";
import { neocadScope } from "../src/replenv.ts";
import { pullTo } from "../src/tools/engine.ts";
import { glyphSymbol, glyphText, placeGlyphs } from "../src/glyphs.ts";
import { describeFeature } from "../src/picking.ts";
import { organiserSections, shortOf } from "../src/organiser.ts";
import { linksOf, partnersOf, syncTwins, twinKind } from "../src/twins.ts";
import { chainsOf, insideBody } from "../src/modes.ts";
import { extrudeSpan } from "../src/solids.ts";
import { programOf } from "../src/bodies.ts";
import { Evaluator } from "../src/solids/evaluate.ts";
import { L, T, W, circleOn, loadSolver, onTop, plate, type Plate } from "./solids/scene.ts";
import { kernel, noKernel as skip } from "./solids/load.ts";
import { tiltedFrame, type TiltedFrame } from "./frames.ts";
import { polygon } from "./profiles.ts";
import "../src/modules/builtin.ts";

const sub = (a: number[], b: number[]) => a.map((x, i) => x - b[i]);
const dot = (a: number[], b: number[]) => a.reduce((s, x, i) => s + x * b[i], 0);
const unit = (a: number[]) => a.map((x) => x / Math.hypot(...a));
const cross = (a: number[], b: number[]) => [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]];
const near = (a: number, b: number, tol = 1e-6) => Math.abs(a - b) <= tol * Math.max(1, Math.abs(b));

function drag(m: Model, point: string, by: number[], frames = 12): boolean {
  const from = m.coords(point);
  for (let k = 1; k <= frames; k++) m.solveFrame(pullTo(m, point, from.map((c, i) => c + (by[i] * k) / frames)));
  return m.solve().solved;
}

/**
 * A free 100 × 60 plate, 10 thick, held to nothing but itself — and a circle
 * floating 20 above it, on no face, cut down through all. Nothing joins the
 * cut to the plate but what "through all" itself says.
 */
function floating(): { m: Model; base: string[]; lid: string[]; cut: string; rim: string; plate: string } {
  const m = new Model(3);
  const pts = [[0, 0], [100, 0], [100, 60], [0, 60]].map(([x, y]) => m.addPoint([x, y, 0]).name);
  const lines = pts.map((p, i) => m.addLine(p, pts[(i + 1) % 4]).name);
  for (let i = 0; i < 3; i++) perpendicular(m, lines[i], lines[i + 1]);
  dist(m, pts[0], pts[1], 100);
  dist(m, pts[1], pts[2], 60);
  const e1 = extrude(m, lines[0], 10);
  m.solve();
  const lid = m.featureOf(e1, "extrude").twins[0].map((l) => m.line(l).refs[0]);
  const c = m.addPoint([50, 30, 30]).name;
  const circle = m.addCircle(c, 5, [0, 0, 1]).name;
  // Facing the way it was drawn, as a circle the tools draw on a plane is held
  // to that plane: so the cut cannot lean to meet the plate, and the plate
  // must come.
  parallel(m, circle, "origin.z");
  const cut = extrude(m, circle, -1, { mode: "cut", into: e1, end: "through" });
  assert.ok(m.solve().solved);
  const rim = m.featureOf(cut, "extrude").twins[0][0];
  return { m, base: pts, lid, cut, rim, plate: e1 };
}

test("fault 1, one way: pulling a through cut's far rim takes the plate's far face with it", async () => {
  await loadSolver();
  const { m, base, rim } = floating();
  const centre = (m.entities.get(rim) as { center: string }).center;
  const was = base.map((p) => m.coords(p));
  const rimWas = m.coords(centre);
  assert.ok(drag(m, centre, [0, 0, -6]), "it solves");
  const moved = base.map((p, i) => sub(m.coords(p), was[i])[2]);
  // Measured before the change: 0.000, 0.000, 0.000, 0.000 — nothing joined them.
  // The plate is free and is pulled by one corner of its far face, so it
  // comes as a free body does, turning as it comes: the corner the lid is
  // held on goes all the way with the rim, and the plate is still the plate.
  const went = sub(m.coords(centre), rimWas)[2];
  assert.ok(went < -5, `the rim went with the hand: ${went.toFixed(3)}`);
  const far = base.indexOf(m.relationOf("e2_through").args[0] as string);
  assert.ok(far >= 0, "held on a corner of the plate's far face");
  assert.ok(Math.abs(moved[far] - went) < 1e-6, `that corner came with it: ${moved.map((d) => d.toFixed(3))}, the rim ${went.toFixed(3)}`);
  assert.ok(moved.some((dz) => Math.abs(dz) > 1), `the plate's far face moved: ${moved.map((d) => d.toFixed(3))}`);
  const side = (a: string, b: string) => Math.hypot(...sub(m.coords(a), m.coords(b)));
  assert.ok(Math.abs(side(base[0], base[1]) - 100) < 1e-6 && Math.abs(side(base[1], base[2]) - 60) < 1e-6, "still 100 by 60");
  // And the cut still ends on it: the rim's centre in the plane of the lid through that corner.
  const way = sub(m.coords(centre), m.coords((m.entities.get(m.featureOf("e2", "extrude").loops[0][0] as string) as { center: string }).center));
  const off = dot(sub(m.coords(base[far]), m.coords(centre)), way) / Math.hypot(...way);
  assert.ok(Math.abs(off) < 1e-6, `the lid on the far corner: ${off}`);
});

test("fault 2, the Jacobian: a row of a through cut names the far side's variables", async () => {
  await loadSolver();
  const m = new Model(3);
  const p = plate(m);
  const top = p.lid.slice(0, 3).join(".");
  const e2 = extrude(m, circleOn(m, top, onTop(p, 50, 30), 5, p.t.uz), -1, { mode: "cut", end: "through" });
  assert.ok(m.solve().solved);
  const f = m.featureOf(e2, "extrude");
  const lidVars = new Set(m.point((m.entities.get(f.twins[0][0]) as { center: string }).center).varIndices);
  const plateVars = new Set([...p.base, ...p.lid].flatMap((q) => m.point(q).varIndices));
  const both = m.problem.handles().filter((h) => {
    const vars = m.problem.varsOf(h);
    return vars.some((v) => lidVars.has(v)) && vars.some((v) => plateVars.has(v));
  });
  assert.ok(both.length > 0, "some row reads the cut's lid and the plate together — it depends on both and says so");
  // The lid stands on the far face, not past it: the plate's base, T below its top.
  const lidAt = dot(sub(m.coords((m.entities.get(f.twins[0][0]) as { center: string }).center), p.t.at(0, 0, 0)), p.t.uz);
  assert.ok(Math.abs(lidAt) < 1e-6, `the lid on the plate's base: ${lidAt} (the plate is ${T} thick)`);
});

test("fault 3, nothing to see: the relation is listed — a far vertex of the plate on the cut's lid, named for the cut", async () => {
  await loadSolver();
  const m = new Model(3);
  const p = plate(m);
  const top = p.lid.slice(0, 3).join(".");
  const e2 = extrude(m, circleOn(m, top, onTop(p, 50, 30), 5, p.t.uz), -1, { mode: "cut", end: "through" });
  m.solve();
  const r = m.relations.get(`${e2}_through`);
  assert.ok(r, `${e2}_through is a relation`);
  assert.equal(r.op, "onPlane");
  assert.equal(r.args[1], `${e2}.lid`);
  assert.ok(p.base.includes(r.args[0] as string), `the far vertex is one of the plate's base corners: ${r.args[0]}`);
});

// ---- the design -----------------------------------------------------------------

/** The plate with a round hole cut through all from its top, as the Cut tool makes one. */
async function holed(): Promise<{ m: Model; p: Plate; e2: string; f: ExtrudeFeature; top: string }> {
  await loadSolver();
  const m = new Model(3);
  const p = squared(m, plate(m));
  const top = p.lid.slice(0, 3).join(".");
  const e2 = extrude(m, circleOn(m, top, onTop(p, 50, 30), 5, p.t.uz), -1, { mode: "cut", end: "through" });
  assert.ok(m.solve().solved);
  return { m, p, e2, f: m.featureOf(e2, "extrude"), top };
}

/**
 * The plate's profile held as the rectangle tool draws one — three right
 * angles and two sides sized. `plate()` holds its corners to the frame and
 * nothing more, which is less than any sketch the app draws: with a cap's
 * normal now an exact row (solidref.ts, `readPlane`), a relation to a cap of
 * a profile that no direction relation holds can be met by shearing that
 * profile into a sliver, a solution the collapse check does not see (TODO.md).
 */
function squared(m: Model, p: Plate): Plate {
  for (let i = 0; i < 3; i++) perpendicular(m, p.lines[i], p.lines[i + 1]);
  dist(m, p.base[0], p.base[1], L);
  dist(m, p.base[1], p.base[2], W);
  m.solve();
  return p;
}

/** A pocket's square on the plate's top, held as the rectangle tool holds one. */
function pocketOn(m: Model, p: Plate, top: string, at: [number, number][]): string[] {
  const sq = at.map(([u, v]) => m.addPoint(onTop(p, u, v)).name);
  const sl = sq.map((q, i) => m.addLine(q, sq[(i + 1) % 4]).name);
  for (const q of sq) onPlane(m, q, top);
  for (let i = 0; i < 3; i++) perpendicular(m, sl[i], sl[i + 1]);
  dist(m, sq[0], sq[1], Math.hypot(at[1][0] - at[0][0], at[1][1] - at[0][1]));
  dist(m, sq[1], sq[2], Math.hypot(at[2][0] - at[1][0], at[2][1] - at[1][1]));
  return sl;
}

/** How far a point stands off the plate's base plane, along the plate's frame's +z. */
const height = (m: Model, p: Plate, point: string) => dot(sub(m.coords(point), p.t.at(0, 0, 0)), p.t.uz);
/** The first point of a feature's lid: a rim's centre, a line's first end. */
function lidPoint(m: Model, feature: string): string {
  const t = m.entities.get(m.featureOf(feature, "extrude").twins[0][0])!;
  return t.kind === "circle" || t.kind === "arc" ? t.center : (t as { refs: string[] }).refs[0];
}
/** A feature's chord in the plate's frame: across, across, along. */
function chordOf(m: Model, p: Plate, feature: string): number[] {
  const pairs = m.relationOf(m.featureOf(feature, "extrude").depth).args.slice(2) as string[];
  const d = sub(m.coords(pairs[1]), m.coords(pairs[0]));
  return [p.t.ux, p.t.uy, p.t.uz].map((a) => dot(d, a));
}

test("listed, marked, deletable: the relation is an ordinary onplane with a glyph on the far vertex and on the cut's far rim — and it has no twin", async () => {
  const { m, p, e2, f } = await holed();
  const r = m.relationOf(`${e2}_through`);
  assert.equal(endRelation(m, f), r);
  assert.equal(glyphSymbol(r), "▱", "the mark every point on a plane wears");
  const marks = placeGlyphs(m, { ox: 400, oy: 300, scale: 3 }).filter((g) => g.relation === r.name);
  assert.equal(marks.length, 2, "one on the far vertex, one on the cut's own far rim");
  assert.ok(marks.some((g) => g.highlights.includes(r.args[0] as string)));
  // rels() lists it like any other, and the record does not name it: it relates to it.
  const scope = neocadScope({ model: m }) as Record<string, (...a: unknown[]) => unknown>;
  assert.ok((scope.rels() as string[]).some((l) => l.startsWith(`${e2}_through`)), "in rels()");
  assert.ok(!f.names.includes(r.name) && !f.owns.includes(r.name));
  // A relation to a face has no twin — though the far vertex is half of the plate's linked pair.
  assert.equal(twinKind("onPlane"), null);
  syncTwins(m);
  assert.ok(![...m.relations.values()].some((x) => x.twin?.of === r.name), "no twin of it");
  assert.ok(partnersOf(m, r.args[0] as string).length > 0, "its point has a partner on the plate's other profile");
  // The cut's own two profiles are still linked: the missing length row changed no pair.
  assert.ok(linksOf(m).some((l) => l.record === e2));
  // The depth's label says how it ends, and that a relation holds it.
  assert.equal(endLabel(m, f), "through all");
  assert.equal(glyphText(m, m.relationOf(f.depth)), "through all");
  assert.match(describeFeature(m, f), new RegExp(`through all \\(${e2}_through\\)`));
  void p;
});

test("the rows: a through extrude's extrusion gives no length row, and the through relation's one row reads six variables — the far vertex's and the lid point's", async () => {
  const { m, e2, f } = await holed();
  const count = (name: string) => m.relationOf(name).blocks.reduce((n, b) => n + m.problem.rowsOf(b), 0);
  const through = m.relationOf(`${e2}_through`);
  assert.equal(through.blocks.length, 1);
  assert.equal(count(through.name), 1, "one row");
  const vars = m.problem.varsOf(through.blocks[0]);
  // The lid's normal is a datum — the chord's way, read as numbers at every
  // evaluation (solidref.ts, `readPlane`), as every relation on a cap has read
  // it since #89. The row is exact in both points' positions and not in the
  // lid's turn; what making the turn a column costs and buys is measured in
  // the spec's As built, and the choice is in the register.
  const want = [...m.point(through.args[0] as string).varIndices, ...m.point(lidPoint(m, e2)).varIndices];
  assert.deepEqual([...vars].sort((a, b) => a - b), [...want].sort((a, b) => a - b), "the far vertex and the lid's own point, and nothing else");
  // The same extrude blind has one row more: the chord's length.
  const held = count(f.depth);
  setEnd(m, e2, "blind");
  assert.equal(count(f.depth), held + 1, "blind, the length row is back");
  setEnd(m, e2, "through");
  assert.equal(count(f.depth), held, "and gone again while the relation holds the lid");
  // Taken away by any road, the row is back: an extrude is never left with neither.
  m.deleteRelation(`${e2}_through`);
  assert.equal(count(f.depth), held + 1);
  assert.equal(endLabel(m, f), "through (placed)", "and the label no longer says a relation holds it");
});

test("it follows, settled: the plate set deeper from either side, the chord square and the lid on the far face — in a handful of iterations where it took 35", async () => {
  const { m, p, e2 } = await holed();
  set(m, `${m.featureOf(p.feature, "extrude").depth}.value`, 2 * T);
  const r = m.solve();
  assert.ok(r.solved);
  const c = chordOf(m, p, e2);
  // Measured before the change: 35 iterations, and the lid 2 past the far face. As built: 8.
  assert.ok(r.iterations <= 16, `iterations: ${r.iterations}`);
  assert.ok(Math.hypot(c[0], c[1]) < 1e-7, `the chord has not leaned: ${Math.hypot(c[0], c[1])}`);
  assert.ok(near(Math.abs(c[2]), 2 * T), `as deep as the plate: ${c[2]}`);
  assert.ok(Math.abs(height(m, p, lidPoint(m, e2))) < 1e-6, "the lid on the plate's base");
  // A second solve has nothing to do: it has settled.
  const again = m.solve();
  assert.ok(again.iterations <= 1 && again.maxResidual < 1e-7, `settled: ${again.iterations} iterations, ${again.maxResidual}`);
  const inside = insideBody(m, chainsOf(m).bodies[0]);
  assert.ok(!inside(p.t.at(50, 30, 0.5)) && !inside(p.t.at(50, 30, 19.5)), "a hole right through");
  assert.ok(inside(p.t.at(20, 30, 0.5)), "the plate beside it is material");
});

test("a cut from below: the plate's depth moves the far vertex, and set seats the cut's lid on it before the solve", async () => {
  await loadSolver();
  const m = new Model(3);
  const p = squared(m, plate(m));
  // On the plate's base (the frame's own plane), cut up through all: the far side is the plate's top.
  const c = m.addPoint(p.t.at(50, 30, 0)).name;
  onPlane(m, c, p.t.name);
  const circle = m.addCircle(c, 5, p.t.name).name;
  const e2 = extrude(m, circle, 1, { mode: "cut", into: p.feature, end: "through" });
  assert.ok(m.solve().solved);
  const r = m.relationOf(`${e2}_through`);
  assert.ok(p.lid.includes(r.args[0] as string), `held on a corner of the plate's top: ${r.args[0]}`);
  assert.ok(near(height(m, p, lidPoint(m, e2)), T));
  set(m, `${m.featureOf(p.feature, "extrude").depth}.value`, 25);
  // Seated: before any solve the lid is already where the relation wants it.
  assert.ok(near(height(m, p, lidPoint(m, e2)), 25), `seated at the new top: ${height(m, p, lidPoint(m, e2))}`);
  const report = m.solve();
  assert.ok(report.solved && report.iterations <= 3, `nothing left for the solve: ${report.iterations}`);
});

test("through cuts do not compound: a second one stands on the far face too, not a tenth past the first one's tool", async () => {
  const { m, p, top } = await holed();
  const sl = pocketOn(m, p, top, [[60, 20], [80, 20], [80, 40], [60, 40]]);
  const e3 = extrude(m, sl[0], -1, { mode: "cut", end: "through" });
  assert.ok(m.solve().solved);
  // Measured before: with the plate 14 deep the hole's lid was 1.4 past the base and the pocket's 2.94.
  assert.ok(Math.abs(height(m, p, lidPoint(m, e3))) < 1e-6, `the pocket's lid on the base: ${height(m, p, lidPoint(m, e3))}`);
  assert.ok(p.base.includes(m.relationOf(`${e3}_through`).args[0] as string), "held on the plate, not on the hole");
});

test("deleting the relation leaves a blind cut where it stood, in one journalled step; the snapshot before it is through again", async () => {
  const { m, p, e2, f } = await holed();
  const before = save(m);
  const scope = neocadScope({ model: m }) as Record<string, (...a: unknown[]) => unknown>;
  const journal = m.journal.length;
  assert.deepEqual(scope.del(`${e2}_through`), [`${e2}_through`]);
  assert.equal(m.journal.length, journal + 1, "one step");
  const entry = m.journal.at(-1)!;
  assert.equal(entry.op, "setEnd");
  assert.deepEqual(entry.args.slice(0, 2), [e2, "blind"]);
  assert.ok(near(entry.args[2] as number, -T), `the depth it stood at, in the entry: ${entry.args[2]}`);
  assert.equal(f.extent, undefined);
  assert.ok(!m.relations.has(`${e2}_through`));
  assert.ok(near(m.relationOf(f.depth).args[1] as number, -T));
  assert.ok(m.solve().solved);
  assert.ok(Math.abs(height(m, p, lidPoint(m, e2))) < 1e-6, "it has not moved");
  assert.equal(m.features.get(e2)?.unbuilt, undefined, "and is still a cut");
  // It replays to the same thing, measuring nothing.
  const back = open(save(m));
  assert.equal(back.featureOf(e2, "extrude").extent, undefined);
  assert.ok(near(back.relationOf(f.depth).args[1] as number, -T));
  // Undo is the host's snapshot of the step before: through again, held.
  const undone = open(before);
  assert.ok(endRelation(undone, undone.featureOf(e2, "extrude")));
});

test("setEnd each way: blind is as deep as it was typed, through holds again, symmetric and back — and every journal replays to the same file", async () => {
  await loadSolver();
  const m = new Model(3);
  const p = plate(m);
  const top = p.lid.slice(0, 3).join(".");
  const scope = neocadScope({ model: m }) as Record<string, (...a: unknown[]) => unknown>;
  const e2 = scope.extrude(circleOn(m, top, onTop(p, 50, 30), 5, p.t.uz), -4, { mode: "cut" }) as string;
  m.solve();
  const f = m.featureOf(e2, "extrude");
  assert.ok(near(height(m, p, lidPoint(m, e2)), T - 4));
  scope.setEnd(e2, "through");
  const far = m.relationOf(`${e2}_through`).args[0];
  assert.deepEqual(m.journal.at(-1), { op: "setEnd", args: [e2, "through", far] }, "journalled with the far vertex it found");
  // Seated by the operation: on the far face before any solve.
  assert.ok(Math.abs(height(m, p, lidPoint(m, e2))) < 1e-6);
  assert.ok(m.solve().solved);
  assert.equal(m.relationOf(f.depth).args[1], -4, "the depth keeps its number: what it is when blind again");
  for (const how of ["symmetric", "through", "blind"]) {
    scope.setEnd(e2, how);
    assert.ok(m.solve().solved, how);
    assert.equal(m.relations.has(`${e2}_through`), how === "through", how);
  }
  assert.ok(near(height(m, p, lidPoint(m, e2)), T - 4), "blind again, as deep as it was");
  scope.setEnd(e2, "through");
  m.solve();
  const file = save(m);
  const back = open(file);
  assert.equal(save(back), file, "byte for byte");
  assert.deepEqual(back.relationOf(`${e2}_through`).args, m.relationOf(`${e2}_through`).args);
  back.solve();
  assert.ok(Math.abs(height(back, p, lidPoint(back, e2))) < 1e-6);
  // The refusals say what would do.
  assert.throws(() => setEnd(m, e2, "sideways"), /setEnd's end is "blind" \(the depth\), "through" \(through all\), "upto" \(up to a face\) or "symmetric"/);
  assert.throws(() => setEnd(m, e2, "through", 0 as unknown), /is what its end resolved to/);
  assert.throws(() => setEnd(m, e2, "through", "l1"), /not a point/);
  assert.throws(() => setEnd(m, e2, "upto"), /ends on a face/);
  assert.throws(() => scope.extrude("c9", -4, { end: "upto" }), /ends on a face/);
});

test("turned round by its depth's sign, a through cut takes the far side on the new side — journalled as the setEnd it is", async () => {
  await loadSolver();
  const m = new Model(3);
  const p = plate(m);
  // A circle in the middle of the plate's thickness, on a plane of its own.
  const c = m.addPoint(p.t.at(50, 30, 4)).name;
  const circle = m.addCircle(c, 5, p.t.uz).name;
  const e2 = extrude(m, circle, -1, { mode: "cut", into: p.feature, end: "through" });
  assert.ok(m.solve().solved);
  const f = m.featureOf(e2, "extrude");
  assert.ok(p.base.includes(m.relationOf(`${e2}_through`).args[0] as string), "down: the base");
  const scope = neocadScope({ model: m }) as Record<string, (...a: unknown[]) => unknown>;
  scope.set(`${f.depth}.value`, 1);
  assert.ok(p.lid.includes(m.relationOf(`${e2}_through`).args[0] as string), `up: the top — ${m.relationOf(`${e2}_through`).args[0]}`);
  assert.deepEqual(m.journal.slice(-2).map((j) => j.op), ["set", "setEnd"]);
  assert.ok(m.solve().solved);
  assert.ok(near(height(m, p, lidPoint(m, e2)), T));
  const back = open(save(m));
  assert.equal(save(back), save(m));
});

test("a par on a cut's wall: the steer that keeps a turned line's length lets the through relation's change stand", async () => {
  const { m, p, top } = await holed();
  const sl = pocketOn(m, p, top, [[60, 20], [80, 20], [80, 40], [60, 40]]);
  const e3 = extrude(m, sl[0], -1, { mode: "cut", end: "through" });
  m.solve();
  const walls = m.featureOf(e3, "extrude").walls;
  parallel(m, walls[0], walls[1]);
  assert.ok(m.solve().solved);
  set(m, `${m.featureOf(p.feature, "extrude").depth}.value`, 2 * T);
  const r = m.solve();
  assert.ok(r.solved);
  const c = chordOf(m, p, e3);
  assert.ok(near(Math.abs(c[2]), 2 * T) && Math.hypot(c[0], c[1]) < 1e-6, `the pocket as deep as the plate: ${c}`);
  assert.ok(Math.abs(height(m, p, lidPoint(m, e3))) < 1e-6);
});

test("a dimension against it is a conflict that names the through relation", async () => {
  const { m, p, e2, f } = await holed();
  // (With the lid's normal a variable of the row this is no conflict: the
  // hole slides 150 along the plate's top and the cut leans half a degree
  // against its par, every row under the offender threshold — measured, and
  // why the normal stays a datum; the spec's As built.)
  const pairs = m.relationOf(f.depth).args.slice(2) as string[];
  // The cut fifteen deep, by a dimension of a person's own — through a plate ten thick.
  const d = dist(m, pairs[0], pairs[1], 15);
  m.searchMs = 60_000;
  const report = m.solve();
  assert.ok(!report.solved, "CONFLICT");
  const said = m.conflicting(report);
  const named = said.conflicts.flatMap((c) => [c.culprit, ...c.set]).filter((n): n is string => typeof n === "string");
  assert.ok([...named, ...said.relations].includes(d), `the dimension: ${JSON.stringify(said)}`);
  assert.ok([...named, ...said.relations].includes(`${e2}_through`), `and the through relation, by name: ${JSON.stringify(said)}`);
  // Nothing moved: a failed solve is put back.
  assert.ok(Math.abs(height(m, p, lidPoint(m, e2))) < 1e-6);
});

test("the far vertex deleted: the cut is blind where it stood, journalled ahead of the deletion", async () => {
  const { m, p, e2, f } = await holed();
  const far = m.relationOf(`${e2}_through`).args[0] as string;
  const scope = neocadScope({ model: m }) as Record<string, (...a: unknown[]) => unknown>;
  const at = m.journal.length;
  const removed = scope.del(far) as string[];
  assert.ok(removed.includes(`${e2}_through`) && removed.includes(far));
  const ops = m.journal.slice(at).map((j) => j.op);
  assert.ok(ops.indexOf("setEnd") >= 0 && ops.indexOf("setEnd") < ops.indexOf("deleteEntity"), `setEnd before the deletions: ${ops}`);
  assert.equal(f.extent, undefined);
  assert.ok(near(m.relationOf(f.depth).args[1] as number, -T));
  const back = open(save(m));
  assert.equal(save(back), save(m));
  void p;
});

test("deleting the cut itself: a round hole's through relation goes with the record; a pocket's is re-held on its lid's own points", async () => {
  const { m, p, e2, top } = await holed();
  const sl = pocketOn(m, p, top, [[60, 20], [80, 20], [80, 40], [60, 40]]);
  const e3 = extrude(m, sl[0], -1, { mode: "cut", end: "through" });
  m.solve();
  const removed = del(m, e2);
  assert.ok(removed.includes(`${e2}_through`), `a rim's lid has one point — nothing to re-hold it on: ${removed}`);
  del(m, e3);
  // linked-profiles' rule for a point held on a face of a record going (`rehold`).
  const left = m.relationOf(`${e3}_through`);
  assert.equal(left.op, "coplanar");
  assert.ok(m.solve().solved);
});

// ---- which point, and when it is chosen again --------------------------------------

/**
 * A block whose far side is slanted: a quadrilateral in the frame's plane,
 * extruded 40 along +z. Seen from a cut going along −y of the frame, its far
 * side is the edge from (0, −a) to (60, −b): slanted when a ≠ b.
 */
function slanted(m: Model, t: TiltedFrame, a: number, b: number): { e1: string; pts: string[] } {
  const { points, lines } = polygon(m, t, [[0, -a], [60, -b], [60, 20], [0, 20]]);
  const e1 = extrude(m, lines[0], 40);
  m.solve();
  return { e1, pts: points };
}

test("a slanted far side: the farthest vertex is taken; turned until another is farther, the row says it stops short and one tap takes the far side again", async () => {
  await loadSolver();
  const m = new Model(3);
  const t = tiltedFrame(m);
  const { e1, pts } = slanted(m, t, 30, 10);
  // A circle on the block's top face (v = 20), cut down the frame's −y through all.
  const f1 = m.featureOf(e1, "extrude");
  const topLine = f1.loops[0][2] as string, topTwin = f1.twins[0][2];
  const [a, b] = m.line(topLine).refs, [a2] = m.line(topTwin).refs;
  const plane = `${a}.${b}.${a2}`;
  const c = m.addPoint(t.at(30, 20, 20)).name;
  onPlane(m, c, plane);
  const circle = m.addCircle(c, 5, t.uy).name;
  parallel(m, circle, plane);
  const e2 = extrude(m, circle, -1, plane, { mode: "cut", into: e1, end: "through" });
  assert.ok(m.solve().solved);
  const r = m.relationOf(`${e2}_through`);
  const twinOf = new Map((m.relationOf(f1.depth).args.slice(2) as string[]).reduce<[string, string][]>((acc, x, i, all) => (i % 2 ? acc : [...acc, [x, all[i + 1]]]), []));
  // (0, −30) is the lowest corner; it and its twin are as far as each other, and the lower name is taken.
  const lowest = [pts[0], twinOf.get(pts[0])!].sort((x, y) => x.localeCompare(y, "en", { numeric: true }))[0];
  assert.equal(r.args[0], lowest);
  const way = unit(sub(m.coords(lidPoint(m, e2)), m.coords(c)));
  const off = (q: string) => dot(sub(m.coords(q), m.coords(c)), way);
  assert.ok(near(off(lowest), 50), `fifty down from the top to the low corner: ${off(lowest)}`);
  assert.equal(shortOf(m, m.featureOf(e2, "extrude")), null, "it goes through");

  // The slant turned the other way: (60, −10) becomes (60, −45), now the lowest.
  for (const q of [pts[1], twinOf.get(pts[1])!]) m.setCoords(q, m.coords(q).map((x, i) => x - 35 * t.uy[i]));
  assert.ok(m.solve().solved);
  assert.equal(m.relationOf(`${e2}_through`).args[0], lowest, "never re-pointed inside a solve");
  const short = shortOf(m, m.featureOf(e2, "extrude"));
  assert.ok(short, "the row says so");
  assert.match(short.summary, new RegExp(`^${e2} stops short of (${pts[1]}|${twinOf.get(pts[1])})`));
  assert.equal(short.command, `setEnd("${e2}", "through")`);
  const row = organiserSections(m).find((s) => s.id === "features")!.rows.find((x) => x.name === e2)!;
  assert.ok(row.detail.endsWith("· short") && row.fix?.command === short.command, JSON.stringify(row));
  // One tap.
  const scope = neocadScope({ model: m }) as Record<string, (...a: unknown[]) => unknown>;
  scope.setEnd(e2, "through");
  const now = m.relationOf(`${e2}_through`).args[0] as string;
  assert.ok([pts[1], twinOf.get(pts[1])].includes(now), `re-picked: ${now}`);
  assert.ok(m.solve().solved);
  assert.equal(shortOf(m, m.featureOf(e2, "extrude")), null);
  assert.equal(organiserSections(m).find((s) => s.id === "features")!.rows.find((x) => x.name === e2)!.fix, undefined);
});

test("a regeneration chooses the far point again: the block it goes through regenerated after a turn re-picks the far vertex, and the far corner filleted away leaves a placed end — each in the regeneration's own entry", async () => {
  await loadSolver();
  const m = new Model(3);
  const t = tiltedFrame(m);
  const { e1, pts } = slanted(m, t, 30, 10);
  const f1 = m.featureOf(e1, "extrude");
  const topLine = f1.loops[0][2] as string, topTwin = f1.twins[0][2];
  const [a, b] = m.line(topLine).refs, [a2] = m.line(topTwin).refs;
  const plane = `${a}.${b}.${a2}`;
  const c = m.addPoint(t.at(30, 20, 20)).name;
  onPlane(m, c, plane);
  const circle = m.addCircle(c, 5, t.uy).name;
  parallel(m, circle, plane);
  const e2 = extrude(m, circle, -1, plane, { mode: "cut", into: e1, end: "through" });
  assert.ok(m.solve().solved);
  const twinOf = new Map((m.relationOf(f1.depth).args.slice(2) as string[]).reduce<[string, string][]>((acc, x, i, all) => (i % 2 ? acc : [...acc, [x, all[i + 1]]]), []));
  const was = m.relationOf(`${e2}_through`).args[0] as string;
  assert.ok([pts[0], twinOf.get(pts[0])].includes(was));
  // The slant turned the other way, then the block regenerated (nothing of its profile changed): the end is chosen again.
  for (const q of [pts[1], twinOf.get(pts[1])!]) m.setCoords(q, m.coords(q).map((x, i) => x - 35 * t.uy[i]));
  assert.ok(m.solve().solved);
  regen(m, e1);
  const now = m.relationOf(`${e2}_through`).args[0] as string;
  assert.ok([pts[1], twinOf.get(pts[1])].includes(now), `re-picked: ${now}`);
  const entry = m.journal.at(-1)!;
  assert.equal(entry.op, "regen");
  assert.deepEqual((entry.args[1] as unknown[][]).find((y) => y[2] === "end"), [e2, [], "end", now], "in the regen's own entry");
  assert.ok(m.solve().solved);
  assert.equal(shortOf(m, m.featureOf(e2, "extrude")), null);
  // That corner rounded: a fillet's arc bulges past both its tangent points,
  // so the far side is round, and the end is placed — said by the label, and
  // the choice in the fillet's own entry.
  const legs = [f1.loops[0][0], f1.loops[0][1]].map((x) => (typeof x === "string" ? x : x.name)).filter((l) => m.line(l).refs.includes(pts[1]));
  assert.equal(legs.length, 2, `two legs at the far corner: ${legs}`);
  fillet(m, legs[0], legs[1], 6);
  assert.ok(m.solve().solved);
  const g = m.featureOf(e2, "extrude");
  assert.equal(endRelation(m, g), null, "no vertex is the far side now");
  assert.equal(endLabel(m, g), "through (placed)");
  const placed = (m.journal.at(-1)!.args.at(-1) as unknown[][]).find((y) => y[2] === "end")!;
  assert.equal(placed[0], e2);
  assert.equal(typeof placed[3], "number", `placed at a depth: ${JSON.stringify(placed)}`);
  const back = open(save(m));
  assert.equal(save(back), save(m));
  assert.equal(back.relations.has(`${e2}_through`), false);
  assert.equal(back.relationOf(back.featureOf(e2, "extrude").depth).args[1], placed[3], "a replay is handed the depth");
});

// ---- round and kernel-only far sides: placed, and said -----------------------------

test("through a revolve: placed where the measure says, held by an ordinary depth, and the label and the log say so — nothing claims to hold", async () => {
  await loadSolver();
  const m = new Model(3);
  const t = tiltedFrame(m);
  // A rod along the frame's x: a 60 × 8 rectangle turned about its long edge on the axis.
  const { lines } = polygon(m, t, [[0, 0], [60, 0], [60, 8], [0, 8]]);
  const e1 = revolve(m, lines[0], lines[0]);
  m.solve();
  // A circle 20 above the rod, facing down the frame's z.
  const c = m.addPoint(t.at(30, 0, 20)).name;
  const circle = m.addCircle(c, 3, t.uz).name;
  const logged: string[] = [];
  const scope = neocadScope({ model: m, log: (s: string) => { logged.push(s); } } as never) as Record<string, (...a: unknown[]) => unknown>;
  const e2 = scope.extrude(circle, -1, { mode: "cut", into: e1, end: "through" }) as string;
  assert.ok(m.solve().solved);
  const f = m.featureOf(e2, "extrude");
  assert.equal(f.extent, "through");
  assert.equal(endRelation(m, f), null, "no relation: nothing in the model is the rod's far side");
  assert.ok(!m.relations.has(`${e2}_through`));
  // Twenty down to the axis, eight more to the far side, and a tenth of that past (2.8).
  const depth = m.relationOf(f.depth).args[1] as number;
  assert.ok(Math.abs(depth + 30.8) < 0.05, `placed at ${depth}`);
  assert.equal(endLabel(m, f), "through (placed)");
  assert.equal(glyphText(m, m.relationOf(f.depth)), "through (placed)");
  assert.ok(logged.some((l) => /through e1 as it stands — a round far side is not held; set the end again after changing it/.test(l)), logged.join("\n"));
  // Journalled with the depth it was placed at, so a replay measures nothing.
  const opts = m.journal.filter((j) => j.op === "extrude").at(-1)!.args.at(-1) as { end: string; to: number };
  assert.equal(opts.end, "through");
  assert.equal(opts.to, depth);
  const back = open(save(m));
  assert.equal(save(back), save(m));
});

test("through into nothing is the blind extrude it was typed as, and says so", async () => {
  await loadSolver();
  const m = new Model(3);
  const p = plate(m);
  const top = p.lid.slice(0, 3).join(".");
  // Cut *up* through all from the plate's top: everything is below.
  const e2 = extrude(m, circleOn(m, top, onTop(p, 50, 30), 4, p.t.uz), 7, { mode: "cut", into: p.feature, end: "through" });
  m.solve();
  const f = m.featureOf(e2, "extrude");
  assert.ok(near(height(m, p, lidPoint(m, e2)), T + 7), "seven up, as typed");
  assert.equal(endRelation(m, f), null);
  assert.deepEqual((m.journal.at(-1)!.args.at(-1) as { to: unknown }).to, null);
  assert.match(endSaid(m, e2)!, /meets no solid that way/);
  // Beside the plate, it meets nothing either: what it goes through is what its profile meets.
  const away = extrude(m, circleOn(m, top, p.t.at(L + 40, W + 40, T), 4, p.t.uz), -1, { mode: "cut", into: p.feature, end: "through" });
  m.solve();
  assert.equal(endRelation(m, m.featureOf(away, "extrude")), null);
  assert.ok(near(height(m, p, lidPoint(m, away)), T - 1), "one down, as typed");
});

// ---- up to face: the same relation, the other way round ----------------------------

test("up to face: held on a parallel face both ways; refused in words on a slanted one; placed and said on a face only the kernel knows", async () => {
  await loadSolver();
  const m = new Model(3);
  const p = squared(m, plate(m));
  const top = p.lid.slice(0, 3).join(".");
  // A second block beside the plate, 30 tall, its base held square and sized
  // as the rectangle tool draws one: its lid is a face parallel to the plate's top.
  const { points: bp, lines: bl } = polygon(m, p.t, [[120, 0], [160, 0], [160, 40], [120, 40]]);
  for (let i = 0; i < 3; i++) perpendicular(m, bl[i], bl[i + 1]);
  dist(m, bp[0], bp[1], 40);
  dist(m, bp[1], bp[2], 40);
  const block = extrude(m, bl[0], 30, { mode: "new" });
  m.solve();
  // A boss on the plate's top, up to the block's lid.
  const scope = neocadScope({ model: m }) as Record<string, (...a: unknown[]) => unknown>;
  const e3 = scope.extrude(circleOn(m, top, onTop(p, 50, 30), 6, p.t.uz), 5, { end: "upto", face: `${block}.lid` }) as string;
  const f = m.featureOf(e3, "extrude");
  assert.equal(f.extent, "upto");
  const r = m.relationOf(`${e3}_upto`);
  assert.deepEqual([r.op, r.args], ["onPlane", [lidPoint(m, e3), `${block}.lid`]]);
  // Seated by the operation, and it solves there.
  assert.ok(near(height(m, p, lidPoint(m, e3)), 30));
  assert.ok(m.solve().solved);
  assert.equal(endLabel(m, f), `up to ${block}.lid`);
  assert.deepEqual(m.journal.at(-1)!.args.at(-1), { mode: "add", into: p.feature, end: "upto", face: `${block}.lid` });
  // One way: the block set taller, the boss follows.
  set(m, `${m.featureOf(block, "extrude").depth}.value`, 42);
  assert.ok(m.solve().solved);
  assert.ok(near(height(m, p, lidPoint(m, e3)), 42), `the boss up to the taller block: ${height(m, p, lidPoint(m, e3))}`);
  // The other way: the boss's lid pulled. The block's base is on the frame and
  // its depth is 42, so nothing can give but the pull — and a drag that fights
  // what pins a body leaves the solve creeping (TODO.md; the spec's As built,
  // measured both ways). So the other way is shown on a block that is free to
  // come: the same block, its base let off the frame.
  for (const q of bp) del(m, m.relationsNaming(q).find((x) => x.op === "onPlane")!.name);
  assert.ok(m.solve().solved);
  const lidOfBlock = (m.featureOf(block, "extrude").twins[0].map((l) => m.line(l).refs[0]))[0];
  const blockWas = height(m, p, lidOfBlock);
  assert.ok(drag(m, lidPoint(m, e3), p.t.uz.map((c) => 5 * c)));
  assert.ok(height(m, p, lidOfBlock) - blockWas > 2.5, `the block's lid came with the boss's: ${height(m, p, lidOfBlock) - blockWas}`);
  // A free body pulled by one corner of its lid comes turning, as the plate
  // did in the first test: the boss's lid is on the block's lid, wherever
  // that plane now is, and the block is still the block.
  const blockLid = m.featureOf(block, "extrude").twins[0].map((l) => m.line(l).refs[0]);
  const blockBase = m.featureOf(block, "extrude").loops[0].map((l) => m.line(l as string).refs[0]);
  const [A, B, C] = blockLid.map((q) => m.coords(q));
  const n = unit(cross(sub(B, A), sub(C, A)));
  assert.ok(Math.abs(dot(sub(m.coords(lidPoint(m, e3)), A), n)) < 1e-6, "still on the block's lid");
  assert.ok(blockLid.every((q, i) => near(Math.hypot(...sub(m.coords(q), m.coords(blockBase[i]))), 42)), "and the block still 42 tall, moved whole");
  assert.ok(near(Math.hypot(...sub(m.coords(blockBase[1]), m.coords(blockBase[0]))), 40), "its base still 40 wide");
  // A set that would turn it away from its face is refused, in words.
  assert.throws(() => scope.set(`${f.depth}.value`, -5), /only says which way e3 goes — it ends on e2\.lid/);
  // Replays to the same file.
  const back = open(save(m));
  assert.equal(save(back), save(m));
  assert.ok(back.relations.has(`${e3}_upto`));

  // A face behind the sketch turns the extrude round first: up to the plate's base, from its top.
  const e4 = scope.extrude(circleOn(m, top, onTop(p, 20, 30), 3, p.t.uz), 5, { mode: "cut", end: "upto", face: `${p.feature}.base` }) as string;
  assert.ok(m.solve().solved);
  assert.ok(Math.abs(height(m, p, lidPoint(m, e4))) < 1e-6, "down to the base");
  assert.equal(m.relationOf(m.featureOf(e4, "extrude").depth).args[1], -5, "turned round, and journalled so");
  assert.equal(m.journal.filter((j) => j.op === "extrude").at(-1)!.args[1], -5);

  // A wall of the plate is square to the sketch, not parallel to it: refused, saying why.
  const wall = `${p.feature}:${p.lines[0]}`;
  assert.throws(() => scope.setEnd(e3, "upto", wall), /is not parallel to e3's profile — a lid on it would not be this profile moved, and the kernel sweeps square/);
  assert.equal(m.featureOf(e3, "extrude").upto, `${block}.lid`, "and nothing changed");
  // Its own face is no face to end on.
  assert.throws(() => scope.setEnd(e3, "upto", `${e3}.lid`), /own face/);

  // A face only the kernel knows: nothing in the model says where it is.
  assert.throws(() => scope.setEnd(e3, "upto", "e9.f0"), /a face only the solid kernel knows — nothing in the model says where it is; pick it with the tool, or give the point/);
  const logged: string[] = [];
  const said = neocadScope({ model: m, log: (s: string) => { logged.push(s); } } as never) as Record<string, (...a: unknown[]) => unknown>;
  // Placed at the point it was picked at — 18 above the plate's base — and said.
  said.setEnd(e3, "upto", "e9.f0", p.t.at(55, 35, 18));
  const g = m.featureOf(e3, "extrude");
  assert.equal(endRelation(m, g), null, "nothing claims to hold it");
  assert.ok(!m.relations.has(`${e3}_upto`));
  assert.ok(m.solve().solved);
  assert.ok(near(height(m, p, lidPoint(m, e3)), 18), `placed: ${height(m, p, lidPoint(m, e3))}`);
  assert.equal(endLabel(m, g), "up to e9.f0 (placed)");
  assert.ok(logged.some((l) => /up to e9\.f0 as it stands — a face that is round or the kernel's alone is not held; set the end again after changing it/.test(l)), logged.join("\n"));
  const j = m.journal.at(-1)!;
  assert.deepEqual(j.args.slice(0, 3), [e3, "upto", "e9.f0"]);
  assert.ok(near(j.args[3] as number, 18 - T), "journalled with the depth it was placed at");
  const again = open(save(m));
  assert.equal(save(again), save(m));
});

// ---- an old file ---------------------------------------------------------------------

interface Recorded {
  version: number; volumes: number[]; faces: string[][]; features: [string, string, string][];
  relations: [string, string, unknown[]][]; kinds: Record<string, string>; points: Record<string, number[]>;
  named: { plate: string; hole: string; pocket: string; base: string[]; lid: string[]; uz: number[]; origin: number[] };
}

test("a file from before the relation: every name kept, each through cut held on the far face once the saved drawing is back, re-saved in the new form and reopened the same", async () => {
  await loadSolver();
  const text = await readFile(new URL("./fixtures/through-v21.neocad.json", import.meta.url), "utf8");
  const want = JSON.parse(await readFile(new URL("./fixtures/through-v21.geometry.json", import.meta.url), "utf8")) as Recorded;
  assert.equal(JSON.parse(text).version, 21);
  const m = open(text, 3);
  assert.deepEqual([...m.entities.keys()].sort(), Object.keys(want.kinds).sort());
  assert.deepEqual([...m.features.values()].map((f) => [f.name, f.kind === "extrude" ? f.extent ?? "blind" : "revolve", f.mode ?? "new"]), want.features);
  // Every relation it had, under the name it had — and one more for each through cut.
  const mine = [...m.relations.values()].filter((r) => !r.twin);
  const { hole, pocket, base, uz, origin } = want.named;
  assert.deepEqual(mine.filter((r) => !r.name.endsWith("_through")).map((r) => [r.name, r.op, r.args]), want.relations);
  for (const cut of [hole, pocket]) {
    const r = m.relationOf(`${cut}_through`);
    assert.equal(r.op, "onPlane");
    assert.equal(r.args[1], `${cut}.lid`);
    assert.ok(base.includes(r.args[0] as string), `${cut} held on the plate's base: ${r.args[0]}`);
  }
  // Written at the journal's end as the setEnds they are; the old entries as they were.
  assert.deepEqual(m.journal.slice(-2).map((j) => [j.op, j.args[0], j.args[1], typeof j.args[2]]), [["setEnd", hole, "through", "string"], ["setEnd", pocket, "through", "string"]]);
  assert.ok(m.solve().solved);
  // Every point where that build left it — but the two lids, which were 1.4 and 2.94 past the far face and are on it now.
  const lids = new Set([hole, pocket].flatMap((c) => m.featureOf(c, "extrude").owns.filter((n) => m.entities.get(n)?.kind === "point")));
  for (const [q, at] of Object.entries(want.points)) {
    const off = Math.hypot(...sub(m.coords(q), at));
    if (!lids.has(q)) assert.ok(off < 1e-6, `${q} where that build left it: ${off}`);
    else assert.ok(Math.abs(dot(sub(m.coords(q), origin), uz)) < 1e-6, `${q} on the far face`);
  }
  const once = save(m);
  assert.equal(JSON.parse(once).version, VERSION);
  const again = open(once, 3);
  assert.equal(save(again), once, "stable in the new form");
  assert.ok(again.solve().solved);
});

test("…and to the same solid, by the kernel's own volume", { skip }, async () => {
  await loadSolver();
  const text = await readFile(new URL("./fixtures/through-v21.neocad.json", import.meta.url), "utf8");
  const want = JSON.parse(await readFile(new URL("./fixtures/through-v21.geometry.json", import.meta.url), "utf8")) as Recorded;
  const ev = new Evaluator(await kernel());
  const volumeOf = (m: Model) => {
    const [body] = ev.run(programOf(m, true).program).bodies;
    assert.deepEqual(body.solid!.validity, { manifold: true, failures: 0 });
    assert.deepEqual(body.solid!.faces.map((f) => f.name).sort(), want.faces[0], "the same faces: a hole and a pocket right through, neither with a cap");
    return body.solid!.volume;
  };
  const m = open(text, 3);
  m.solve();
  const v = volumeOf(m);
  assert.ok(Math.abs(v - want.volumes[0]) < 1e-6 * want.volumes[0], `${v} against ${want.volumes[0]}`);
  const again = open(save(m), 3);
  again.solve();
  const v2 = new Evaluator(await kernel()).run(programOf(again, true).program).bodies[0].solid!.volume;
  assert.ok(Math.abs(v2 - want.volumes[0]) < 1e-6 * want.volumes[0], `reopened: ${v2}`);
});

test("the kernel builds a through cut past its lid, and an add through to a face flush with it", { skip }, async () => {
  const { m, p, e2 } = await holed();
  const f = m.featureOf(e2, "extrude");
  // The tool body runs a unit past the lid (a tenth of ten is less than one); the drawn lid does not.
  assert.ok(near(extrudeSpan(m, f).depth, -(T + 1)));
  assert.ok(near(Math.abs(chordOf(m, p, e2)[2]), T));
  const ev = new Evaluator(await kernel());
  const [body] = ev.run(programOf(m, true).program).bodies;
  const want = L * W * T - Math.PI * 25 * T;
  assert.deepEqual(body.solid!.validity, { manifold: true, failures: 0 });
  assert.ok(Math.abs(body.solid!.volume - want) < 1e-6 * want, `${body.solid!.volume} against ${want}`);
  const names = new Set(body.solid!.faces.map((x) => x.name));
  assert.ok(names.has(`${e2}.m0`) && !names.has(`${e2}.lid`) && !names.has(`${e2}.base`), `no cap: ${[...names]}`);
});

// ---- the layer rule ------------------------------------------------------------------

test("the hook is gone: no throughReach anywhere in src, and nothing in relations/ or model.ts imports the solids layer", async () => {
  const root = new URL("../src/", import.meta.url);
  const files: string[] = [];
  const walk = async (dir: URL) => {
    for (const e of await readdir(dir, { withFileTypes: true })) {
      if (e.name === "smlib-gen" || e.name === "wasm-gen") continue;
      const u = new URL(e.name + (e.isDirectory() ? "/" : ""), dir);
      if (e.isDirectory()) await walk(u);
      else if (e.name.endsWith(".ts")) files.push(u.pathname);
    }
  };
  await walk(root);
  assert.ok(files.length > 100);
  for (const f of files) {
    const text = await readFile(f, "utf8");
    // Named in a comment that says what used to be is fine; called, defined or imported is not.
    const code = text.split("\n").filter((l) => !/^\s*(\/\/|\*|\/\*)/.test(l)).join("\n");
    assert.ok(!/defineThroughReach|throughReach/.test(code), `${f} still has the hook`);
    const below = f.includes("/src/relations/") || f.endsWith("/src/model.ts") || f.includes("/src/kernel/");
    if (below) {
      const imports = [...text.matchAll(/from\s+"([^"]+)"/g)].map((x) => x[1]);
      const up = imports.filter((i) => /(^|\/)(solids|modes|bodies|farside|operations|faces)\.ts$/.test(i) || i.includes("/solids/"));
      assert.deepEqual(up, [], `${f} reaches up into the solids layer`);
    }
  }
});
