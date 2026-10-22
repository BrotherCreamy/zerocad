// Features over split regions: an extrude or revolve of a region a crossing or
// a T cut out of a sketch (docs/plans/regions-split.md, PR 2).
//
// The poster case is the stepped block — one sketch, a plate with a line
// drawn across it, each half extruded to its own depth — and the lens of two
// crossing circles. What has to be true, and is checked here in closed form on
// a frame tipped off every kernel axis:
//
// - a crossing the profile runs through becomes a **real point** held `on`
//   both edges, made by the operation and owned by the feature; the journal
//   names that point, never the crossing's key;
// - the region across the line, extruded second, finds that point held on both
//   edges — a T — and makes nothing more;
// - twins per vertex, a twin line or arc per portion, walls per vertex;
// - extrude's contracts carry over: `set` moves exactly its lid, `del` both
//   ways, the hover tag and `ls()`, and save/open/save byte-identical with a
//   set and a deletion in the history;
// - the faces are drawn between the points — after a drag too, where a span
//   found earlier would have left the cap behind.

import { test } from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { ensureKernelLoaded } from "../src/kernel/problem.ts";
import { Model, memberName, type Portion, type ProfileMember } from "../src/model.ts";
import { fix, onPlane } from "../src/relations/basic.ts";
import { pointOnLine } from "../src/relations/geometry.ts";
import { axisReader, turnPoint } from "../src/relations/revolution.ts";
import { del, extrude, extrudeProfile, profileOf, revolve, set } from "../src/operations.ts";
import { VERSION, open, save } from "../src/persist.ts";
import { findLoops, describeLoop } from "../src/loops.ts";
import { featureFaces } from "../src/faces.ts";
import { neocadScope } from "../src/replenv.ts";
import { describePick } from "../src/picking.ts";
import { tiltedFrame, type TiltedFrame } from "./frames.ts";
import { baseOf, polygon, ring } from "./profiles.ts";

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
 * A 40 × 30 plate on the tilted frame, with a line across it at u = 15 that
 * runs past both long edges: two regions, 15 × 30 and 25 × 30, each bounded by
 * parts of the bottom and top edges and of the line. Every point is fixed —
 * extrude's lesson: on a sketch nothing defines, a `set` is free to move the
 * base as well as the lid, and "moved exactly the lid" would test nothing.
 * The line's two fixes are returned, for the test that moves it.
 */
function plate() {
  const m = new Model(3);
  const t = tiltedFrame(m);
  const corners: [number, number][] = [[0, 0], [40, 0], [40, 30], [0, 30]];
  const { points, lines } = polygon(m, t, corners);
  points.forEach((p, i) => fix(m, p, [...corners[i], 0], t.name));
  const ends = [t.at(15, -10), t.at(15, 40)].map((w) => m.addPoint(w).name);
  for (const p of ends) onPlane(m, p, t.name);
  const holds = [fix(m, ends[0], [15, -10, 0], t.name), fix(m, ends[1], [15, 40, 0], t.name)];
  const across = m.addLine(ends[0], ends[1]).name;
  assert.equal(m.solve().solved, true);
  return { m, t, points, lines, ends, holds, across };
}

/** The points a feature made that are not twins or lid-frame points: the crossings it materialised. */
function materialised(m: Model, name: string): string[] {
  const f = m.features.get(name)!;
  const vertices = new Set(f.loops.flat().flatMap((x) => (typeof x === "string" ? [] : [x.from, x.to])));
  return f.owns.filter((n) => vertices.has(n));
}

test("the stepped block: each half of one sketch extruded to its own depth — the crossings made points by the first, found held by the second", async () => {
  await loadKernel();
  const { m, t, points, lines, across } = plate();
  const [l1, l2, l3, l4] = lines;
  const before = { entities: m.entities.size, relations: m.relations.size };

  // The left half's left side is in that half alone, so it names the region.
  assert.equal(extrude(m, l4, 10), "e1");
  const e1 = m.featureOf("e1", "extrude");
  const [x1, x2] = materialised(m, "e1");
  assert.deepEqual(e1.loops, [[
    { name: l1, from: points[0], to: x1 },
    { name: across, from: x1, to: x2 },
    { name: l3, from: x2, to: points[3] },
    l4,
  ]], "portions in their entities' own direction, between real points");
  // The two crossings, made the first two points of the expansion, each held
  // on both edges through it — the clause idiom, and the feature's own.
  assert.deepEqual(e1.owns.slice(0, 6).map((n) => m.entities.get(n)?.kind ?? m.relationOf(n).op),
    ["point", "pointOnLine", "pointOnLine", "point", "pointOnLine", "pointOnLine"]);
  assert.deepEqual(m.relationOf(e1.owns[1]).args, [x1, l1]);
  assert.deepEqual(m.relationOf(e1.owns[2]).args, [x1, across]);
  assert.deepEqual(m.relationOf(e1.owns[4]).args, [x2, across]);
  assert.deepEqual(m.relationOf(e1.owns[5]).args, [x2, l3]);
  assert.ok(near(m.coords(x1), t.at(15, 0)) && near(m.coords(x2), t.at(15, 30)), "seeded at the crossings");
  // Four twins, four twin lines, four walls, the lid frame's three points and
  // the frame, two crossings and their four holds, one depth.
  assert.equal(m.entities.size - before.entities, 2 + 3 + 1 + 4 + 4 + 4);
  assert.equal(m.relations.size - before.relations, 4 + 1);
  assert.deepEqual(e1.twins[0].map((n) => m.entities.get(n)?.kind), ["line", "line", "line", "line"]);
  assert.equal(e1.walls.length, 4);
  // The journal names the points, never the keys.
  assert.deepEqual(m.journal.at(-1), { op: "extrude", args: [l4, 10, t.name, e1.loops] });
  assert.ok(!JSON.stringify(m.journal).includes("×"));

  // The right half, by its right side: the crossings are points held on both
  // edges now — Ts — and nothing more is made.
  assert.equal(extrude(m, l2, 20), "e2");
  const e2 = m.featureOf("e2", "extrude");
  assert.deepEqual(materialised(m, "e2"), []);
  assert.deepEqual(e2.loops, [[
    { name: l1, from: x1, to: points[1] },
    l2,
    { name: l3, from: points[2], to: x2 },
    { name: across, from: x1, to: x2 },
  ]]);
  for (const x of [x1, x2]) {
    assert.ok(e2.names.includes(x) && !e2.owns.includes(x), `${x} is what e2 was built on, and e1's`);
  }

  assert.equal(m.solve().solved, true);
  // Every twin is its base plus its own depth along +z — the frame read here.
  for (const [f, d] of [[e1, 10], [e2, 20]] as const) {
    for (const [twin, base] of baseOf(m, f.depth)) {
      if (m.entities.get(twin)?.kind !== "point") continue;
      assert.ok(near(m.coords(twin), m.coords(base).map((c, i) => c + d * t.uz[i])), `${twin} over ${base} by ${d}`);
    }
  }
  // One sketch, two heights: the lid twins of the same crossing are two points, 10 apart.
  const over = (f: typeof e1, base: string) => [...baseOf(m, f.depth)].find(([, b]) => b === base)![0];
  assert.notEqual(over(e1, x1), over(e2, x1));
  assert.ok(Math.abs(local(t, m.coords(over(e2, x1)))[2] - local(t, m.coords(over(e1, x1)))[2] - 10) < 1e-9);
  assert.ok(near(m.coords(x1), t.at(15, 0)) && near(m.coords(x2), t.at(15, 30)), "the solve left the crossings where they cross");
});

test("set on either depth moves its own lid exactly, and nothing else — not the other step, not the crossings", async () => {
  await loadKernel();
  const { m, t, lines } = plate();
  const e1 = m.featureOf(extrude(m, lines[3], 10), "extrude");
  const e2 = m.featureOf(extrude(m, lines[1], 20), "extrude");
  m.solve();
  const lid1 = [...baseOf(m, e1.depth).keys()].filter((n) => m.entities.get(n)?.kind === "point");
  const all = [...m.entities.values()].filter((e) => e.kind === "point").map((e) => e.name);
  const was = new Map(all.map((n) => [n, m.coords(n)]));
  set(m, `${e1.depth}.value`, 16);
  assert.equal(m.solve().solved, true);
  for (const n of all) {
    const moved = lid1.includes(n) ? 6 : 0;
    const want = was.get(n)!.map((c, i) => c + moved * t.uz[i]);
    assert.ok(near(m.coords(n), want, 1e-8), `${n} moved ${moved}`);
  }
  assert.equal(m.relationOf(e2.depth).args[1], 20);
});

test("del: the second step takes nothing of the first; the first takes its crossings — and, as for a twin, the record and walls of a step built on them", async () => {
  await loadKernel();
  {
    const { m, lines } = plate();
    extrude(m, lines[3], 10);
    const e2 = m.featureOf(extrude(m, lines[1], 20), "extrude");
    const [x1, x2] = materialised(m, "e1");
    const removed = del(m, "e2");
    assert.deepEqual(removed.slice().sort(), ["e2", ...e2.owns].sort(), "the record and what it made");
    assert.ok(m.features.has("e1") && m.entities.has(x1) && m.entities.has(x2));
  }
  {
    const { m, lines, across, ends } = plate();
    const e1 = m.featureOf(extrude(m, lines[3], 10), "extrude");
    const e2 = m.featureOf(extrude(m, lines[1], 20), "extrude");
    const [x1, x2] = materialised(m, "e1");
    const standing = e2.walls.filter((w) => !m.line(w).refs.includes(x1) && !m.line(w).refs.includes(x2));
    assert.equal(standing.length, 2);
    const removed = del(m, "e1");
    for (const n of e1.owns) assert.ok(removed.includes(n), `${n} was e1's`);
    assert.ok(removed.includes("e2"), "e2 was built on e1's crossings");
    for (const w of e2.walls) assert.equal(m.entities.has(w), standing.includes(w), `${w}: a wall on a crossing goes with it`);
    for (const n of [...lines, across, ...ends]) assert.ok(m.entities.has(n), `${n}: the sketch stays`);
    assert.ok(!m.entities.has(x1) && !m.entities.has(x2));
    assert.equal(m.solve().solved, true);
  }
  {
    // A crossing deleted on its own takes every record naming it.
    const { m, lines } = plate();
    extrude(m, lines[3], 10);
    extrude(m, lines[1], 20);
    const [x1] = materialised(m, "e1");
    const removed = del(m, x1);
    assert.ok(removed.includes("e1") && removed.includes("e2"));
    assert.equal(m.features.size, 0);
  }
});

test("the hover tag and ls() name the portions by their points, as loops() now does", async () => {
  await loadKernel();
  const { m, points, lines, across } = plate();
  const scope = neocadScope({ model: m });
  const ex = scope.extrude as (member: string, depth?: number) => string;
  assert.equal(ex(lines[3], 10), "e1");
  ex(lines[1], 20);
  const [x1, x2] = materialised(m, "e1");
  const ls = (scope.ls as () => string[])();
  assert.ok(ls.includes(`e1  extrude of ${lines[0]}[${points[0]}→${x1}],${across}[${x1}→${x2}],${lines[2]}[${x2}→${points[3]}],${lines[3]}, `
    + "depth d1 = 10 along t, lid f1"), ls.join("\n"));
  assert.match(describePick(m, { name: x1, kind: "point", distance: 0 }), /·\s+e1 e2$/);
  assert.match(describePick(m, { name: m.relationsNaming(x1)[0].name, kind: "relation", distance: 0 }), /·\s+e1$/);
  // loops() reads the sketch's halves through the same points now.
  const listed = (scope.loops as () => string[])();
  assert.ok(listed.some((l) => l.startsWith(`loop of ${lines[0]}[${points[0]}→${x1}],${across}[${x1}→${x2}]`)), listed.join("\n"));
});

test("save, open, save is byte-identical with the stepped block, a set and a deletion in the history — the crossings made again under their names", async () => {
  await loadKernel();
  const { m, lines } = plate();
  const e1 = m.featureOf(extrude(m, lines[3], 10), "extrude");
  m.solve();
  extrude(m, lines[1], 20);
  m.solve();
  set(m, `${e1.depth}.value`, 14);
  m.solve();
  // A third, deleted: its own lid's region, later gone.
  const e3 = m.featureOf(extrude(m, e1.twins[0][0], 3, e1.top), "extrude");
  del(m, e3.name);
  m.solve();

  const once = save(m);
  assert.ok(JSON.parse(once).version >= 8, "portions came in with version 8");
  const reopened = open(once);
  assert.equal(save(reopened), once, "byte-identical");
  for (const name of ["e1", "e2"]) {
    const [a, b] = [m.featureOf(name), reopened.featureOf(name)];
    assert.deepEqual(b.loops, a.loops);
    assert.deepEqual(b.owns, a.owns);
    assert.deepEqual(b.names, a.names);
  }
  for (const x of materialised(m, "e1")) assert.ok(near(reopened.coords(x), m.coords(x)), `${x} where it was saved`);
  assert.equal(reopened.solve().solved, true);
});

test("a version-7 file reads as it always did; one claiming 7 with a portion in it is refused at its step", async () => {
  await loadKernel();
  const m = new Model(3);
  const t = tiltedFrame(m);
  const { lines } = polygon(m, t, [[0, 0], [40, 0], [40, 30], [0, 30]]);
  extrude(m, lines[0], 10);
  m.solve();
  const v7 = { ...JSON.parse(save(m)), version: 7 };
  const reopened = open(JSON.stringify(v7));
  assert.deepEqual(reopened.featureOf("e1").loops, [lines]);
  assert.equal(save(reopened), JSON.stringify({ ...v7, version: VERSION }, null, 2), "re-saved current, every entry as it was");

  const split = plate();
  extrude(split.m, split.lines[3], 10);
  const forged = { ...JSON.parse(save(split.m)), version: 7 };
  const step = forged.journal.findIndex((e: { op: string }) => e.op === "extrude");
  assert.throws(() => open(JSON.stringify(forged)),
    new RegExp(`step ${step + 1}, extrude\\(.*\\): a version-7 file's profiles are whole members`));
});

test("a lens of two crossing circles extrudes: two crossings held on both rims, two twin arcs on the lid, two walls", async () => {
  await loadKernel();
  const m = new Model(3);
  const t = tiltedFrame(m);
  const [c1, c2] = [ring(m, t, 20, 15, 10), ring(m, t, 32, 15, 10)];
  assert.equal(m.solve().solved, true);
  const all = findLoops(m);
  const lens = all.findIndex((l) => l.members.every((x) => x.span !== null) && l.members.length === 2
    && all.filter((o) => o !== l).every((o) => o.area > l.area));
  const f = m.featureOf(extrudeProfile(m, profileOf(m, all, lens), 12), "extrude");
  const [x1, x2] = materialised(m, f.name);
  assert.equal(f.loops[0].length, 2);
  assert.deepEqual(f.loops[0].map(memberName).sort(), [c1, c2]);
  for (const x of [x1, x2]) {
    assert.deepEqual(m.relationsNaming(x).filter((r) => r.op === "onCircle").map((r) => r.args[1]).sort(), [c1, c2]);
  }
  assert.deepEqual(f.twins[0].map((n) => m.entities.get(n)?.kind), ["arc", "arc"]);
  assert.equal(f.walls.length, 2);
  assert.equal(m.solve().solved, true);
  // The crossings at (26, 15 ± 8), on both rims.
  const at = [x1, x2].map((x) => local(t, m.coords(x)).map((c) => Math.round(c * 1e9) / 1e9 + 0)).sort((a, b) => a[1] - b[1]);
  assert.deepEqual(at, [[26, 7, 0], [26, 23, 0]]);
  // Each twin arc: radius 10, its ends the twins of a base arc's ends, on the lid.
  for (const arc of f.twins[0]) {
    const a = m.entities.get(arc)!;
    assert.ok(a.kind === "arc" && a.plane === f.top);
    assert.ok(Math.abs(m.radius(arc) - 10) < 1e-9);
    for (const p of [a.start, a.end]) assert.ok(Math.abs(local(t, m.coords(p))[2] - 12) < 1e-9);
  }
  // The caps are the lens: area 200·acos(0.6) − 96, measured flat on the frame.
  const faces = featureFaces(m, f, 2000);
  const area = (o: number[][]) => Math.abs(o.reduce((s, p, i) => {
    const [a, b] = [local(t, p), local(t, o[(i + 1) % o.length])];
    return s + a[0] * b[1] - a[1] * b[0];
  }, 0) / 2);
  const want = 200 * Math.acos(0.6) - 96;
  for (const kind of ["base", "lid"] as const) {
    const cap = faces.find((x) => x.kind === kind)!;
    // Sampled as drawn — a quarter-pixel polyline at 2000 px a unit — so a few thousandths short.
    assert.ok(Math.abs(area(cap.outlines[0]) - want) < 1e-2, `${kind}: ${area(cap.outlines[0])} against ${want}`);
  }

  // A crescent beside it now runs between two held points — it makes no more.
  const again = findLoops(m);
  const crescent = again.findIndex((l) => l.plane.frame === t.name && l.members.some((x) => x.name === c1 && x.span !== null)
    && Math.abs(l.area - (Math.PI * 100 - want)) < 1e-6);
  const g = m.featureOf(extrudeProfile(m, profileOf(m, again, crescent), 5), "extrude");
  assert.deepEqual(materialised(m, g.name), []);
  assert.ok(g.names.includes(x1) && g.names.includes(x2));
  const reopened = open(save(m));
  assert.equal(save(reopened), save(m));
});

test("a band across a circle runs along two arcs of it: one entity, two portions, two twin arcs — and the file says so", async () => {
  await loadKernel();
  const m = new Model(3);
  const t = tiltedFrame(m);
  const c = ring(m, t, 20, 15, 10);
  const across = [10, 20].map((v) => {
    const ends = [t.at(0, v), t.at(40, v)].map((w) => m.addPoint(w).name);
    for (const p of ends) onPlane(m, p, t.name);
    return m.addLine(ends[0], ends[1]).name;
  });
  assert.equal(m.solve().solved, true);
  const all = findLoops(m);
  const band = all.findIndex((l) => l.members.length === 4 && across.every((a) => l.members.some((x) => x.name === a)));
  assert.ok(band >= 0, all.map((l) => describeLoop(l, all)).join("\n"));
  const f = m.featureOf(extrudeProfile(m, profileOf(m, all, band), 8), "extrude");
  const arcs = f.loops[0].filter((x): x is Portion => typeof x !== "string" && x.name === c);
  assert.equal(arcs.length, 2);
  assert.equal(materialised(m, f.name).length, 4);
  assert.deepEqual(f.twins[0].map((n) => m.entities.get(n)!.kind).sort(), ["arc", "arc", "line", "line"]);
  assert.equal(m.solve().solved, true);
  const once = save(m);
  assert.equal(save(open(once)), once);
});

test("a region cut by Ts is extruded between the held points it already had — nothing made, and deleting a T takes the record", async () => {
  await loadKernel();
  const m = new Model(3);
  const t = tiltedFrame(m);
  const { points, lines } = polygon(m, t, [[0, 0], [40, 0], [40, 30], [0, 30]]);
  // A line from a point held on the bottom edge to one held on the top.
  const [a, b] = [t.at(15, 0), t.at(15, 30)].map((w) => m.addPoint(w).name);
  pointOnLine(m, a, lines[0]);
  pointOnLine(m, b, lines[2]);
  for (const p of [a, b]) onPlane(m, p, t.name);
  const stem = m.addLine(a, b).name;
  assert.equal(m.solve().solved, true);
  const relations = m.relations.size;
  const f = m.featureOf(extrude(m, lines[3], 10), "extrude");
  assert.deepEqual(f.loops, [[{ name: lines[0], from: points[0], to: a }, stem, { name: lines[2], from: b, to: points[3] }, lines[3]]]);
  assert.deepEqual(materialised(m, f.name), []);
  assert.equal(m.relations.size, relations + 1, "the depth and nothing else");
  assert.ok(f.names.includes(a) && f.names.includes(b));
  assert.ok(del(m, a).includes(f.name));
});

test("a crossing materialised by hand — pt(on(_, l1), on(_, l5)) — is a T to the extrude: named, not owned, and left by del", async () => {
  await loadKernel();
  const { m, t, lines, across } = plate();
  const x = m.addPoint(t.at(15, 0)).name;
  pointOnLine(m, x, lines[0]);
  pointOnLine(m, x, across);
  m.solve();
  const f = m.featureOf(extrude(m, lines[3], 10), "extrude");
  const made = materialised(m, f.name);
  assert.equal(made.length, 1, "only the top crossing is made");
  assert.ok(f.names.includes(x) && !f.owns.includes(x));
  del(m, f.name);
  assert.ok(m.entities.has(x));
  assert.ok(!m.entities.has(made[0]));
});

test("the caps and walls are drawn between the points as they are now: drag the line across, and the cap follows its crossings", async () => {
  await loadKernel();
  const { m, t, points, lines, ends, holds } = plate();
  const f = m.featureOf(extrude(m, lines[3], 10), "extrude");
  const [x1] = materialised(m, f.name);
  const corners = (kind: "base" | "lid") => featureFaces(m, f, 4).find((x) => x.kind === kind)!.outlines[0]
    .map((p) => local(t, p).map((c) => Math.round(c * 1e6) / 1e6 + 0).join(",")).sort();
  assert.deepEqual(corners("base"), ["0,0,0", "0,30,0", "15,0,0", "15,30,0"]);
  // Move the line to u = 25 — re-fixed there, as a drag would leave it — and
  // the crossings ride it, and the cap and lid with them.
  del(m, ...holds);
  fix(m, ends[0], [25, -10, 0], t.name);
  fix(m, ends[1], [25, 40, 0], t.name);
  assert.equal(m.solve().solved, true);
  assert.ok(Math.abs(local(t, m.coords(x1))[0] - 25) < 1e-6, `the crossing followed: ${local(t, m.coords(x1))}`);
  assert.deepEqual(corners("base"), ["0,0,0", "0,30,0", "25,0,0", "25,30,0"]);
  assert.deepEqual(corners("lid"), ["0,0,10", "0,30,10", "25,0,10", "25,30,10"]);
  assert.ok(near(m.coords(points[0]), t.at(0, 0)));
  assert.equal(featureFaces(m, f, 4).filter((x) => x.kind === "wall").length, 4);
});

test("a revolve of a split half about the line that cut it: crossings made, end twins turned in closed form, set swings them, the file round-trips", async () => {
  await loadKernel();
  const { m, t, lines, across } = plate();
  const quarter = Math.PI / 2;
  const f = m.featureOf(revolve(m, lines[1], across, quarter), "revolve");
  const [x1, x2] = materialised(m, f.name);
  assert.ok(x1 && x2, "both crossings made");
  assert.deepEqual(f.loops[0].map((x: ProfileMember) => memberName(x)), [lines[0], lines[1], lines[2], across]);
  assert.deepEqual(f.twins[0].map((n) => m.entities.get(n)?.kind), ["line", "line", "line", "line"]);
  assert.equal(m.solve().solved, true);
  const ax = axisReader(m, across).read();
  const check = (angle: number) => {
    for (const [twin, base] of baseOf(m, f.angle)) {
      if (m.entities.get(twin)?.kind !== "point") continue;
      assert.ok(near(m.coords(twin), turnPoint(m.coords(base), ax, angle), 1e-8), `${twin} is ${base} turned ${angle}`);
    }
  };
  check(quarter);
  // The crossings are on the axis, so their twins sit where they do.
  for (const x of [x1, x2]) {
    const tw = [...baseOf(m, f.angle)].find(([, b]) => b === x)![0];
    assert.ok(near(m.coords(tw), m.coords(x), 1e-8));
  }
  set(m, `${f.angle}.value`, Math.PI);
  assert.equal(m.solve().solved, true);
  check(Math.PI);
  const once = save(m);
  assert.equal(save(open(once)), once);

  // A whole turn makes its crossings too — its surface is swept between them.
  const n = plate();
  const g = n.m.featureOf(revolve(n.m, n.lines[1], n.across), "revolve");
  assert.equal(materialised(n.m, g.name).length, 2);
  assert.deepEqual(g.twins, []);
  assert.ok(featureFaces(n.m, g, 4).length > 0);
});

test("refused before anything is made: a split half crossing its axis leaves no point, no hold, no entry", async () => {
  await loadKernel();
  const { m, t, lines } = plate();
  // A short line clear of the plate, above it, whose line runs through the
  // left half at u = 8: it cuts no edge, so the halves are as they were.
  const axis = m.addLine(m.addPoint(t.at(8, 50)).name, m.addPoint(t.at(8, 60)).name).name;
  assert.equal(m.solve().solved, true);
  const [journal, size, rels] = [m.journal.length, m.entities.size, m.relations.size];
  assert.throws(() => revolve(m, lines[3], axis), new RegExp(`the profile ${lines[0]}\\[p1→${lines[0]}×l5\\],.* crosses the axis ${axis}`));
  assert.equal(m.entities.size, size, "no point made at the crossings");
  assert.equal(m.relations.size, rels);
  assert.equal(m.journal.length, journal);
  // About the line that cut it, the same half turns.
  assert.equal(revolve(m, lines[3], "l5"), "e1");
});
