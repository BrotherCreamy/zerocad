// A frame a feature makes reuses the points the feature already makes there
// (docs/plans/lid-frame-shares-points.md).
//
// The case worth reading first is the first one: the owner's plate, measured.
// A rectangle with a triangle inside, drawn frameless and extruded by the typed
// command, used to be 17 points with three pairs on one spot each — the lid
// frame's own three points, the sketch frame's moved by the depth, lying
// exactly on three lid corners, since a frameless sketch's frame is three of
// the outline's corners. *"i'm getting a lot of overlapping points. why is this
// happening?"* Now no two points share a place.
//
// "Shares a place" is measured here as it looks on the screen — two point
// entities within a millionth of each other after a solve — and the dimension
// is asked separately that it holds each place once, since a duplicate block
// solves just as well and is only visible as a redundancy.
//
// The old expansion is still the one a version-9 file replays with, so its
// names do not shift; the last third of the file is that.
//
// **Since format 11 an extrude makes no lid frame at all**
// (docs/plans/no-lid-frame.md, tested in nolidframe.test.ts). Version 10's
// shared lid frame is what a version-10 file still replays with, so the extrude
// cases here ask for it by name — the expansion `10` persist.ts writes into
// such a file's entries — and go on proving it. A revolve's end frames are
// today's, and are asked for as they always were.

import { test } from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { ensureKernelLoaded } from "../src/kernel/problem.ts";
import { Model, type ExtrudeFeature, type RevolveFeature } from "../src/model.ts";
import { dist, fix, onPlane } from "../src/relations/basic.ts";
import { parallel, pointOnLine } from "../src/relations/geometry.ts";
import { del, extrude, fillet, regen, revolve, set } from "../src/operations.ts";
import { VERSION, open, save } from "../src/persist.ts";
import { neocadScope } from "../src/replenv.ts";
import { Repl } from "../src/repl.ts";
import { tiltedFrame, type TiltedFrame } from "./frames.ts";
import { baseOf, polygon } from "./profiles.ts";

async function loadKernel() {
  const bytes = await readFile(new URL("../src/kernel/wasm-gen/neocad_kernel_bg.wasm", import.meta.url));
  await ensureKernelLoaded(bytes);
}

const sub = (a: number[], b: number[]) => a.map((x, i) => x - b[i]);
const near = (a: number[], b: number[], tol = 1e-9) => Math.hypot(...sub(a, b)) <= tol;
const cross = (a: number[], b: number[]) => [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]];
const dot = (a: number[], b: number[]) => a.reduce((s, x, i) => s + x * b[i], 0);

/**
 * Every two point entities on one spot, as `a=b` — what the owner saw as
 * doubled labels. Not counting the tilted fixture frame's own points (`t_o`,
 * …): the rectangles here start at its origin by construction, which is the
 * test's doing, not the feature's.
 */
function coincident(m: Model): string[] {
  const ps = [...m.entities.values()].filter((e) => e.kind === "point" && !/^[tu]_[oxy]$/.test(e.name)).map((e) => e.name);
  const out: string[] = [];
  for (let i = 0; i < ps.length; i++) {
    for (let j = i + 1; j < ps.length; j++) {
      if (near(m.coords(ps[i]), m.coords(ps[j]), 1e-6)) out.push(`${ps[i]}=${ps[j]}`);
    }
  }
  return out;
}

const points = (m: Model) => [...m.entities.values()].filter((e) => e.kind === "point").map((e) => e.name);
const allNames = (m: Model) => [...m.entities.keys(), ...m.relations.keys(), ...m.features.keys()];

/**
 * The dimension holds every twin once: no twin in two pairs, and — since the
 * revolution relation holds a frame pair's points itself — exactly one residual
 * block per point it holds, whichever pair names it.
 */
function heldOnce(m: Model, dimension: string): void {
  const args = m.relationOf(dimension).args.slice(2) as string[];
  const twins: string[] = [];
  for (let i = 0; i < args.length; i += 2) {
    const t = m.entities.get(args[i + 1])!;
    if (t.kind === "point") twins.push(t.name);
    if (t.kind === "frame") for (const p of m.refsOf(t)) if (!twins.includes(p)) twins.push(p);
  }
  for (let i = 0; i < args.length; i += 2) {
    if (m.entities.get(args[i + 1])!.kind === "point") {
      assert.equal(args.filter((a, k) => k % 2 === 1 && a === args[i + 1]).length, 1, `${args[i + 1]} in one pair`);
    }
  }
  const radii = args.filter((a, k) => k % 2 === 0 && ["arc", "circle"].includes(m.entities.get(a)!.kind)).length;
  assert.equal(m.relationOf(dimension).blocks.length, twins.length + radii, "one block a point, one a rim");
}

/** The owner's plate: a 60 × 40 rectangle with a triangle inside, free points level at z = 0, nothing else. */
function ownersPlate() {
  const m = new Model(3);
  const rect = [[0, 0], [60, 0], [60, 40], [0, 40]].map(([x, y]) => m.addPoint([x, y, 0]).name);
  const outline = rect.map((p, i) => m.addLine(p, rect[(i + 1) % 4]).name);
  const tri = [[20, 10], [40, 10], [30, 30]].map(([x, y]) => m.addPoint([x, y, 0]).name);
  tri.forEach((p, i) => m.addLine(p, tri[(i + 1) % 3]));
  return { m, rect, outline };
}

async function typed(m: Model, line: string): Promise<unknown> {
  const r = await new Repl(neocadScope({ model: m })).eval(line);
  assert.equal(r.ok, true, String(r.error?.message));
  return r.value;
}

// --- the expansion ---------------------------------------------------------------

test("the owner's plate with a hole, extruded frameless the version-10 way: 14 points, none on another — the lid frame stands on three lid corners", async () => {
  await loadKernel();
  const { m, rect, outline } = ownersPlate();
  // The frame the typed call makes for it (three of the outline's corners), then the old expansion.
  m.addFrame(rect[0], rect[1], rect[3], "f1");
  m.setDefaultFrame("f1");
  assert.equal(extrude(m, outline[0], 10, "f1", null, 10), "e1");
  assert.equal(m.solve().solved, true);
  const f = m.featureOf("e1", "extrude");
  const sketch = m.frame(f.frame);
  assert.deepEqual([sketch.origin, sketch.xref, sketch.yref].every((p) => rect.includes(p!)), true,
    "the frame typed for it is three of the outline's corners");

  // Seven corners, seven twins, and nothing else: was 17 points, three pairs.
  assert.equal(points(m).length, 14);
  assert.deepEqual(coincident(m), []);
  // The lid frame's points are the twins over the sketch frame's.
  const bases = baseOf(m, f.depth);
  const lid = m.frame(f.top!);
  assert.deepEqual([lid.origin, lid.xref, lid.yref].map((p) => bases.get(p!)), [sketch.origin, sketch.xref, sketch.yref]);
  for (const p of [lid.origin, lid.xref, lid.yref]) assert.ok(f.twins.flat().some((tw) => m.line(tw).refs.includes(p!)), `${p} is a lid corner`);
  // The depth holds seven places, once each.
  assert.equal(bases.size, 7);
  heldOnce(m, f.depth);
  // Owned once: a shared point is a twin, and only that.
  assert.equal(new Set(f.owns).size, f.owns.length);
  // The journal is the call, with the old expansion said in it (today's says nothing).
  assert.deepEqual((m.journal.at(-1)!.args as unknown[]).slice(4), [10]);

  // And it is still the lid: set moves it, the frame with it.
  set(m, `${f.depth}.value`, 25);
  assert.equal(m.solve().solved, true);
  for (const [twin, base] of bases) assert.ok(near(m.coords(twin), sub(m.coords(base), [0, 0, -25]), 1e-8), twin);
  assert.deepEqual(coincident(m), []);
});

test("a version-10 lid frame over a sketch frame floating off the profile still makes its own three points — and over one that stands partly on it, only the ones it must", async () => {
  await loadKernel();
  const m = new Model(3);
  const t = tiltedFrame(m);
  // Clear of the frame's origin: a frame point on the same spot as a corner but
  // not joined to it is no vertex — the rule reads joins, never positions, as
  // a replay must — and its lid point would sit on the corner's twin.
  const { lines } = polygon(m, t, [[5, 5], [45, 5], [45, 35], [5, 35]]);
  const before = m.entities.size;
  const f = m.featureOf(extrude(m, lines[0], 20, null, null, 10), "extrude");
  // Three frame points, the frame, four twins, four twin edges, four walls: as it always was.
  assert.equal(m.entities.size - before, 3 + 1 + 4 + 4 + 4);
  const lid = m.frame(f.top!);
  for (const p of [lid.origin, lid.xref, lid.yref!]) assert.ok(f.owns.includes(p));
  const bases = baseOf(m, f.depth);
  assert.deepEqual([lid.origin, lid.xref, lid.yref].map((p) => bases.get(p!)), [`${t.name}_o`, `${t.name}_x`, `${t.name}_y`]);
  assert.equal(m.solve().solved, true);
  assert.deepEqual(coincident(m), []);
  heldOnce(m, f.depth);

  // A frame on two corners and a point off the profile: two shared, one made.
  const m2 = new Model(3);
  const t2 = tiltedFrame(m2);
  const p2 = polygon(m2, t2, [[0, 0], [40, 0], [40, 30], [0, 30]]);
  const off = m2.addPoint(t2.at(-10, 15)).name;
  onPlane(m2, off, t2.name);
  const half = m2.addFrame(p2.points[0], p2.points[1], off).name;
  const ents = m2.entities.size;
  const g = m2.featureOf(extrude(m2, p2.lines[0], 20, half, null, 10), "extrude");
  assert.equal(m2.entities.size - ents, 1 + 1 + 4 + 4 + 4, "one frame point, the frame, the twins, edges and walls");
  const gl = m2.frame(g.top!);
  const gb = baseOf(m2, g.depth);
  assert.deepEqual([gl.origin, gl.xref, gl.yref].map((p) => gb.get(p!)), [p2.points[0], p2.points[1], off]);
  assert.equal(gb.size, 4 + 1);
  assert.equal(m2.solve().solved, true);
  assert.ok(near(m2.coords(gl.yref!), t2.at(-10, 15, 20)), "the made point is the off-profile point moved by the depth");
  assert.deepEqual(coincident(m2), []);
  heldOnce(m2, g.depth);
});

test("a partial revolve's end frame stands on the end twins: no point of its own, and the angle holds each corner once", async () => {
  await loadKernel();
  const m = new Model(3);
  const t = tiltedFrame(m);
  const { points: corners, lines } = polygon(m, t, [[10, 0], [30, 0], [30, 20], [10, 20]]);
  // The frame a frameless sketch is given: three of its own corners.
  const own = m.addFrame(corners[0], corners[1], corners[3]).name;
  const ents = m.entities.size;
  const f = m.featureOf(revolve(m, lines[0], `${t.name}.y`, Math.PI / 2, own), "revolve") as RevolveFeature;
  // Four twins, four twin edges and the end frame: was three more points.
  assert.equal(m.entities.size - ents, 4 + 4 + 1);
  const end = m.frame(f.end!);
  const bases = baseOf(m, f.angle);
  assert.deepEqual([end.origin, end.xref, end.yref].map((p) => bases.get(p!)), [corners[0], corners[1], corners[3]]);
  assert.deepEqual(bases.get(f.end!), own, "the frame pair stays: it is what says the frame's bases are a datum");
  heldOnce(m, f.angle);
  assert.equal(m.relationOf(f.angle).blocks.length, 4);
  assert.equal(m.solve().solved, true);
  assert.deepEqual(coincident(m), []);

  // Every twin is its base turned about the frame's +y, through its origin — and so after a set.
  const turnY = (p: number[], a: number) => {
    const v = sub(p, t.origin);
    const kv = dot(t.uy, v), kxv = cross(t.uy, v);
    return t.origin.map((o, i) => o + v[i] * Math.cos(a) + kxv[i] * Math.sin(a) + t.uy[i] * kv * (1 - Math.cos(a)));
  };
  for (const a of [Math.PI / 2, 2]) {
    if (a !== Math.PI / 2) { set(m, `${f.angle}.value`, a); assert.equal(m.solve().solved, true); }
    for (const [twin, base] of bases) {
      if (m.entities.get(twin)!.kind === "point") assert.ok(near(m.coords(twin), turnY(m.coords(base), a), 1e-8), `${twin} at ${a}`);
    }
    assert.deepEqual(coincident(m), []);
  }

  // Over a floating frame the end frame still makes its own three, held whole by the frame pair.
  const n = new Model(3);
  const u = tiltedFrame(n);
  const q = polygon(n, u, [[10, 0], [30, 0], [30, 20], [10, 20]]);
  const g = n.featureOf(revolve(n, q.lines[0], `${u.name}.y`, Math.PI / 2), "revolve") as RevolveFeature;
  assert.equal(n.relationOf(g.angle).blocks.length, 4 + 3);
  assert.equal(n.solve().solved, true);
  assert.deepEqual(coincident(n), []);
  // Left as it was, and written down in TODO.md: turned about the sketch
  // frame's own +y, the end frame's origin and y-ref lie on the axis, so they
  // sit on the sketch frame's — points the feature did not make, which the
  // rule (the feature's own points) does not reach.
  const ge = n.frame(g.end!);
  assert.ok(near(n.coords(ge.origin), n.coords(`${u.name}_o`), 1e-9) && near(n.coords(ge.yref!), n.coords(`${u.name}_y`), 1e-9));
});

// --- regeneration and deletion -------------------------------------------------------

/**
 * A 40 × 30 rectangle on the tilted frame, held as regen.test.ts holds one a
 * fillet can work on, with the sketch frame a frameless sketch gets — three of
 * its own corners, the bottom-left, bottom-right and top-left.
 */
function heldRectangle() {
  const m = new Model(3);
  const t = tiltedFrame(m);
  const corners: [number, number][] = [[0, 0], [40, 0], [40, 30], [0, 30]];
  const { points: ps, lines } = polygon(m, t, corners);
  fix(m, ps[0], [0, 0, 0], t.name);
  fix(m, ps[2], [40, 30, 0], t.name);
  lines.forEach((l, i) => parallel(m, l, i % 2 === 0 ? `${t.name}.x` : `${t.name}.y`));
  const own = m.addFrame(ps[0], ps[1], ps[3]).name;
  assert.equal(m.solve().solved, true);
  return { m, t, ps, lines, own };
}

test("a fillet after a version-10 extrude regenerates with the lid frame still on its corners: no two points on one spot, every place held once", async () => {
  await loadKernel();
  const { m, t, ps, lines, own } = heldRectangle();
  const f0 = m.featureOf(extrude(m, lines[0], 20, own, null, 10), "extrude");
  const lid = m.frame(f0.top!);
  assert.deepEqual(coincident(m), []);

  // The corner at (40, 0) is the sketch frame's x-ref, and so its twin the lid frame's.
  fillet(m, lines[0], lines[1], 8);
  assert.equal(m.solve().solved, true);
  const f = m.featureOf("e1", "extrude") as ExtrudeFeature;
  assert.equal(f.loops[0].length, 5, "rounded");
  assert.equal(m.frame(f.top!).xref, lid.xref, "the lid frame keeps its points");
  const bases = baseOf(m, f.depth);
  assert.equal(bases.get(lid.xref), ps[1], "still the twin of the corner, now leg one's tangent point");
  assert.deepEqual(coincident(m), []);
  heldOnce(m, f.depth);
  assert.equal(new Set(f.owns).size, f.owns.length, "owned once");
  for (const [twin, base] of bases) {
    if (m.entities.get(twin)!.kind === "point") assert.ok(near(m.coords(twin), m.coords(base).map((c, i) => c + 20 * t.uz[i]), 1e-7), twin);
  }
  // A no-op regen moves no name.
  const names = allNames(m);
  regen(m, "e1");
  assert.deepEqual(allNames(m), names);
});

test("a corner a version-10 lid frame stands on leaves the profile: its twin stays as the lid frame's own point, held by its own pair — its wall goes", async () => {
  await loadKernel();
  const { m, t, ps, lines, own } = heldRectangle();
  for (const p of ps) fix(m, p, [...[[0, 0], [40, 0], [40, 30], [0, 30]][ps.indexOf(p)], 0] as number[], t.name);
  const f0 = m.featureOf(extrude(m, lines[3], 10, own, null, 10), "extrude");
  const lidX = m.frame(f0.top!).xref;
  const wallX = f0.walls.find((w) => m.line(w).refs[0] === ps[1])!;
  // A line across at u = 15: the left half is the profile now, and (40, 0) is not in it.
  const ends = [t.at(15, -10), t.at(15, 40)].map((w) => m.addPoint(w).name);
  ends.forEach((p, i) => { onPlane(m, p, t.name); fix(m, p, [15, i === 0 ? -10 : 40, 0], t.name); });
  m.addLine(ends[0], ends[1]);
  assert.equal(m.solve().solved, true);

  regen(m, "e1");
  assert.equal(m.solve().solved, true);
  const f = m.featureOf("e1", "extrude") as ExtrudeFeature;
  assert.ok(m.entities.has(lidX), "the lid frame's point survives its corner");
  assert.equal(m.frame(f.top!).xref, lidX);
  assert.ok(f.owns.includes(lidX));
  assert.ok(!m.entities.has(wallX), "the corner's wall is gone");
  assert.equal(f.walls.length, 4);
  const bases = baseOf(m, f.depth);
  assert.equal(bases.get(lidX), ps[1], "held over the sketch frame's x-ref, as a frame point of its own");
  assert.ok(near(m.coords(lidX), t.at(40, 0, 10), 1e-8));
  assert.deepEqual(coincident(m), []);
  heldOnce(m, f.depth);
});

test("a sketch-frame point the profile comes to run through takes the version-10 lid point already over it — regenerating lays no second point there", async () => {
  await loadKernel();
  const m = new Model(3);
  const t = tiltedFrame(m);
  const corners: [number, number][] = [[0, 0], [40, 0], [40, 30], [0, 30]];
  const { points: ps, lines } = polygon(m, t, corners);
  ps.forEach((p, i) => fix(m, p, [...corners[i], 0], t.name));
  // A point held on the bottom edge — no vertex of the rectangle — as the frame's x-ref.
  const x = m.addPoint(t.at(15, 0)).name;
  pointOnLine(m, x, lines[0]);
  fix(m, x, [15, 0, 0], t.name);
  const fr = m.addFrame(ps[0], x, ps[3]).name;
  assert.equal(m.solve().solved, true);
  const f0 = m.featureOf(extrude(m, lines[3], 10, fr, null, 10), "extrude");
  const lidX = m.frame(f0.top!).xref;
  assert.ok(!f0.twins.flat().some((tw) => m.line(tw).refs.includes(lidX)), "over no corner yet: the lid frame's own");
  assert.equal(baseOf(m, f0.depth).get(lidX), x);

  // A line up from it: now a T, a vertex of the left half.
  const top = m.addPoint(t.at(15, 40)).name;
  onPlane(m, top, t.name);
  fix(m, top, [15, 40, 0], t.name);
  m.addLine(x, top);
  assert.equal(m.solve().solved, true);
  regen(m, "e1");
  assert.equal(m.solve().solved, true);
  const f = m.featureOf("e1", "extrude") as ExtrudeFeature;
  assert.ok(f.walls.some((w) => m.line(w).refs[0] === x && m.line(w).refs[1] === lidX), "the T's wall stands to the lid point");
  assert.ok(f.twins.flat().some((tw) => m.line(tw).refs.includes(lidX)), "a lid corner now");
  assert.deepEqual(coincident(m), []);
  heldOnce(m, f.depth);
  assert.equal(new Set(f.owns).size, f.owns.length);
});

test('del("e1") takes exactly what it made — the twins its frame stands on once — and leaves the sketch and the typed frame', async () => {
  await loadKernel();
  const { m } = ownersPlate();
  const entities = [...m.entities.keys()];
  const relations = [...m.relations.keys()];
  await typed(m, `extrude("l1", 10)`);
  const f = m.featureOf("e1", "extrude");
  const removed = del(m, "e1");
  assert.equal(removed.length, new Set(removed).size);
  assert.deepEqual(new Set(removed), new Set(["e1", ...f.owns]), "the record and what it owns, each once");
  assert.deepEqual([...m.entities.keys()], [...entities, f.frame], "the sketch, and the frame the typed call made for it");
  assert.deepEqual([...m.relations.keys()], relations);
  assert.equal(m.solve().solved, true);
});

// --- the file ---------------------------------------------------------------------

/**
 * What a version-10 build wrote for a plate whose sketch frame floats off it
 * (the case where its lid frame made three points of its own): the extrude,
 * then a point drawn after and a relation on a lid-frame point. Built with the
 * expansion `10`, which a version-10 entry does not say, so it is struck.
 */
function version10File() {
  const m = new Model(3);
  const t = tiltedFrame(m);
  const { lines } = polygon(m, t, [[5, 5], [45, 5], [45, 35], [5, 35]]);
  extrude(m, lines[0], 20, t.name, null, 10);
  m.solve();
  const lidO = m.frame(m.featureOf("e1", "extrude").top!).origin;
  const later = m.addPoint([80, 80, 0]).name;
  dist(m, later, lidO, 50);
  assert.equal(m.solve().solved, true);
  const saved = JSON.parse(save(m));
  for (const e of saved.journal) if (e.op === "extrude") e.args = e.args.slice(0, 4);
  saved.version = 10;
  return { m, saved, later, lidO };
}

test("a version-10 file reopens with its lid frame and the same names, the expansion said in the entry from then on — byte-identical twice over", async () => {
  await loadKernel();
  const { m, saved, later, lidO } = version10File();
  const opened = open(JSON.stringify(saved));
  assert.deepEqual(allNames(opened), allNames(m), "no name shifted");
  assert.deepEqual(opened.featureOf("e1"), m.featureOf("e1"), "the record the old build made, lid frame and all");
  assert.equal(opened.featureOf("e1").expansion, 10);
  assert.deepEqual(opened.relationsNaming(later).map((r) => r.args), [[later, lidO, 50]]);
  assert.equal(opened.solve().solved, true);
  assert.deepEqual(coincident(opened), []);

  const resaved = save(opened);
  assert.equal(JSON.parse(resaved).version, VERSION);
  assert.deepEqual(JSON.parse(resaved).journal.find((e: { op: string }) => e.op === "extrude").args.slice(4), [10],
    "the expansion written in, so the file keeps meaning it");
  assert.equal(save(open(resaved)), resaved, "byte-identical from here on");
  assert.equal(save(open(save(open(resaved)))), resaved);

  // Why it is kept: read as today's expansion the extrude makes four entities
  // fewer, so the point drawn after it takes another name and the relation on
  // the lid frame's origin names a point that is never made.
  assert.throws(() => open(JSON.stringify({ ...saved, version: VERSION })), /is not a point/);
});

/**
 * What a version-9 build wrote for the owner's plate: the frame its tool typed,
 * the extrude — with three lid-frame points of its own, before the twins — then
 * a point drawn after and a relation on it. Built with the old expansion (`9`),
 * which is the one thing an old build's entry does not say, so it is struck.
 */
function version9File() {
  const { m } = ownersPlate();
  m.addFrame("p1", "p2", "p4", "f1");
  m.setDefaultFrame("f1");
  extrude(m, "l1", 10, "f1", null, 9);
  m.solve();
  assert.equal(points(m).length, 17);
  assert.equal(coincident(m).length, 3, "the old expansion, measured: three pairs");
  const later = m.addPoint([80, 80, 0]).name;
  assert.equal(later, "p18", "named after the old expansion's 17");
  dist(m, later, "p16", 50);
  assert.equal(m.solve().solved, true);
  const saved = JSON.parse(save(m));
  for (const e of saved.journal) if (e.op === "extrude") e.args = e.args.slice(0, 4);
  saved.version = 9;
  return { m, saved, later };
}

test("a version-9 file with an extrude and a relation on a later-named point reopens with the same names and solves — the old expansion, said in the entry from then on", async () => {
  await loadKernel();
  const { m, saved, later } = version9File();
  const opened = open(JSON.stringify(saved));
  assert.deepEqual(allNames(opened), allNames(m), "no name shifted");
  assert.deepEqual(opened.relationsNaming(later).map((r) => r.args), [[later, "p16", 50]]);
  assert.deepEqual(opened.featureOf("e1"), m.featureOf("e1"), "the record the old build made");
  assert.equal(opened.featureOf("e1").expansion, 9);
  assert.equal(opened.solve().solved, true);
  for (const p of points(m)) assert.ok(near(opened.coords(p), m.coords(p), 1e-8), `${p} where it was saved`);

  const resaved = save(opened);
  const entry = JSON.parse(resaved).journal.find((e: { op: string }) => e.op === "extrude");
  assert.deepEqual(entry.args.slice(4), [9], "the expansion written in, so the file keeps meaning it");
  assert.equal(JSON.parse(resaved).version, VERSION);
  assert.equal(save(open(resaved)), resaved, "byte-identical from here on");
  assert.equal(save(open(save(open(resaved)))), resaved);

  // Why it is kept: the same entries read as today's expansion make no lid
  // frame, so the relation drawn after the extrude names a point that is never
  // made, and the file fails at that step.
  assert.throws(() => open(JSON.stringify({ ...saved, version: VERSION })), /step 19, dist\("p18", "p16", 50\): "p16" is not a point/);
});

test("a version-9 partial revolve is given its old expansion; a whole turn, which makes no frame, passes untouched", async () => {
  await loadKernel();
  const m = new Model(3);
  const t = tiltedFrame(m);
  const { points: ps, lines } = polygon(m, t, [[10, 0], [30, 0], [30, 20], [10, 20]]);
  const own = m.addFrame(ps[0], ps[1], ps[3]).name;
  revolve(m, lines[0], `${t.name}.y`, Math.PI / 2, own, null, 9);
  const q = polygon(m, t, [[40, 0], [50, 0], [50, 10], [40, 10]]);
  revolve(m, q.lines[0], `${t.name}.y`, null, t.name);
  m.addPoint([1, 2, 3]);
  assert.equal(m.solve().solved, true);
  const saved = JSON.parse(save(m));
  const revolves = saved.journal.filter((e: { op: string }) => e.op === "revolve");
  assert.deepEqual(revolves.map((e: { args: unknown[] }) => e.args.length), [6, 5]);
  revolves[0].args = revolves[0].args.slice(0, 5);
  saved.version = 9;
  const opened = open(JSON.stringify(saved));
  assert.deepEqual(allNames(opened), allNames(m));
  assert.deepEqual(opened.featureOf("e1"), m.featureOf("e1"));
  assert.equal(opened.relationOf(opened.featureOf("e1", "revolve").angle).blocks.length, 4 + 3,
    "its end frame's own three, held whole, as they were");
  const back = JSON.parse(save(opened)).journal.filter((e: { op: string }) => e.op === "revolve");
  assert.deepEqual(back.map((e: { args: unknown[] }) => e.args.length), [6, 5]);
  assert.equal(opened.solve().solved, true);
});

test("a version-9 regeneration replays the old way too: a fillet after an old extrude reopens under the names its file holds", async () => {
  await loadKernel();
  const { m, ps, lines, own } = heldRectangle();
  extrude(m, lines[0], 20, own, null, 9);
  fillet(m, lines[0], lines[1], 8);
  const later = m.addPoint([70, 70, 0]).name;
  assert.equal(m.solve().solved, true);
  assert.equal(coincident(m).length, 3, "the old lid frame over three corners, regenerated as the old build did");
  const saved = JSON.parse(save(m));
  for (const e of saved.journal) if (e.op === "extrude") e.args = e.args.slice(0, 4);
  saved.version = 9;
  const opened = open(JSON.stringify(saved));
  assert.deepEqual(allNames(opened), allNames(m));
  assert.deepEqual(opened.featureOf("e1"), m.featureOf("e1"));
  assert.ok(opened.entities.has(later) && opened.entities.has(ps[1]));
  assert.equal(opened.solve().solved, true);
});

test("an expansion other than an old file's or today's is refused, naming what it is for", async () => {
  await loadKernel();
  const m = new Model(3);
  const t = tiltedFrame(m);
  const { lines } = polygon(m, t, [[0, 0], [40, 0], [40, 30], [0, 30]]);
  assert.throws(() => extrude(m, lines[0], 20, null, null, 7), /extrude's expansion is 9 or 10 \(a file of version 9 or 10/);
  assert.throws(() => extrude(m, lines[0], 20, null, null, 12), /extrude's expansion is 9 or 10/);
  assert.throws(() => revolve(m, lines[0], `${t.name}.y`, 1, null, null, 8), /revolve's expansion is 9 \(/);
  // A revolve has no expansion 11: its end frames are today's, and stay.
  assert.throws(() => revolve(m, lines[0], `${t.name}.y`, 1, null, null, 11), /revolve's expansion is 9 \(/);
  assert.equal(m.features.size, 0);
  assert.equal(extrude(m, lines[0], 20, null, null, 11), "e1", "today's, said out loud, is today's");
  assert.equal((m.journal.at(-1)!.args as unknown[]).length, 4);
  assert.equal(m.featureOf("e1").expansion, 11);
});

export type { TiltedFrame };
