// The quiet rule (src/quiet.ts): which entities the shaded view leaves out until
// the hand is on them, which glyphs follow them out, and what reveals them.
//
// Every case is read off the model's own structure here — which point ends
// which line, which edge a feature's record names — rather than off the
// module's arithmetic, so a rule that drifted from the owner's words (an end, a
// corner, the edge of a solid) cannot pass by agreeing with itself. And no case
// asks what made a thing: a lid's corner and a sketch's corner are the same
// case (the owner: "why is a 3D corner any different from a 2D corner").

import { test } from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { ensureKernelLoaded } from "../src/kernel/problem.ts";
import { Model } from "../src/model.ts";
import { fix, onPlane } from "../src/relations/basic.ts";
import { parallel } from "../src/relations/geometry.ts";
import { extrude } from "../src/operations.ts";
import { placeGlyphs } from "../src/glyphs.ts";
import { visibleFaces } from "../src/faces.ts";
import { orbitBy, type View } from "../src/view.ts";
import { neocadScope } from "../src/replenv.ts";
import { drawn, entityDrawn, glyphDrawn, quietEntities, revealed } from "../src/quiet.ts";
import { hide } from "../src/groups.ts";
import { tiltedFrame } from "./frames.ts";
import { polygon, ring } from "./profiles.ts";

async function loadKernel() {
  const bytes = await readFile(new URL("../src/kernel/wasm-gen/neocad_kernel_bg.wasm", import.meta.url));
  await ensureKernelLoaded(bytes);
}

const SHADED = { shaded: true, faced: new Set<string>() };
const none = new Set<string>();

/** A rectangle, a lone point, a circle, and an arc with its own ends — on a tilted frame. */
function sketch() {
  const m = new Model(3);
  const t = tiltedFrame(m);
  const { points, lines } = polygon(m, t, [[0, 0], [40, 0], [40, 30], [0, 30]]);
  const lone = m.addPoint(t.at(60, 60)).name;
  onPlane(m, lone, t.name);
  const circle = ring(m, t, 70, 10, 5);
  const c = m.addPoint(t.at(20, -20)).name;
  onPlane(m, c, t.name);
  const arc = m.addArc(c, null, null, 8, t.name).name;
  return { m, t, points, lines, lone, circle, arc };
}

test("shaded, a corner is quiet — every end of a line or an arc — and a lone point, a centre, a frame and the lines themselves are not", async () => {
  await loadKernel();
  const { m, t, points, lines, lone, circle, arc } = sketch();
  const quiet = quietEntities(m, SHADED);
  const ends = new Set<string>();
  for (const e of m.entities.values()) {
    if (e.kind === "line") e.refs.forEach((p) => ends.add(p));
    if (e.kind === "arc") [e.start, e.end].forEach((p) => ends.add(p));
  }
  assert.deepEqual([...quiet].sort(), [...ends].sort(), "exactly the ends, and nothing that is not drawn as geometry");
  for (const p of points) assert.ok(quiet.has(p), `${p}, a rectangle's corner`);
  const a = m.arc(arc);
  assert.ok(quiet.has(a.start) && quiet.has(a.end), "an arc's ends");
  assert.ok(!quiet.has(a.center), "an arc's centre is drawn");
  assert.ok(!quiet.has(m.circular(circle).center), "a circle's centre is drawn");
  assert.ok(!quiet.has(lone), "an isolated point is drawn");
  for (const l of lines) assert.ok(!quiet.has(l), `${l}: a line on no solid is drawn`);
  assert.ok(!quiet.has(t.name) && !quiet.has(`${t.name}_o`), "a frame and its points are drawn");
});

test("a lone line's ends are ends: quiet, with the line drawn", async () => {
  await loadKernel();
  const m = new Model(3);
  const t = tiltedFrame(m);
  const [a, b] = [m.addPoint(t.at(0, 0)).name, m.addPoint(t.at(10, 0)).name];
  const l = m.addLine(a, b).name;
  const quiet = quietEntities(m, SHADED);
  assert.ok(quiet.has(a) && quiet.has(b));
  assert.ok(!quiet.has(l));
});

test("a centre that a line also ends at is still a centre, and drawn", async () => {
  await loadKernel();
  const m = new Model(3);
  const t = tiltedFrame(m);
  const circle = ring(m, t, 0, 0, 10);
  const c = m.circular(circle).center;
  const rim = m.addPoint(t.at(10, 0)).name;
  m.addLine(c, rim);
  const quiet = quietEntities(m, SHADED);
  assert.ok(!quiet.has(c), "the circle's middle keeps its one mark");
  assert.ok(quiet.has(rim), "the other end is an end");
});

test("the hidden and wire views draw everything: nothing is quiet outside the shaded one", async () => {
  await loadKernel();
  const { m, lines } = sketch();
  const e = extrude(m, lines[0], 20);
  assert.equal(quietEntities(m, { shaded: false, faced: new Set([e]) }).size, 0);
});

/** A box: the sketch's rectangle extruded 20, with the record of what bounds it. */
function box() {
  const s = sketch();
  const f = s.m.featureOf(extrude(s.m, s.lines[0], 20), "extrude");
  return { ...s, f };
}

test("a solid's own edges — profile, twins, walls — are quiet while it has faces on screen, and drawn when it has none", async () => {
  await loadKernel();
  const { m, f, lines } = box();
  const edges = [...lines, ...f.twins.flat(), ...f.walls];
  const faced = quietEntities(m, { shaded: true, faced: new Set([f.name]) });
  for (const l of edges) assert.ok(faced.has(l), `${l} bounds a face`);
  // A solid that cannot be laid out has no faces, so no face layer draws its
  // outline: its edges are sketch geometry again.
  const faceless = quietEntities(m, SHADED);
  for (const l of edges) assert.ok(!faceless.has(l), `${l}: no faces, no face line, so drawn`);
  // And a real view's faces name the solid.
  const view = orbitBy({ ox: 400, oy: 300, scale: 3 }, 0.6, 0.5);
  assert.deepEqual([...new Set(visibleFaces(m, view).map((x) => x.feature))], [f.name]);
});

test("a lid's corners are quiet for the reason a sketch's are — they end lines — and a point the extrude made that ends nothing is drawn", async () => {
  await loadKernel();
  const { m, f } = box();
  const quiet = quietEntities(m, { shaded: true, faced: new Set([f.name]) });
  const lidCorners = f.walls.map((w) => m.line(w).refs[1]);
  for (const p of lidCorners) assert.ok(quiet.has(p), `${p}, a lid corner`);
  // Today's extrude makes no point that ends nothing: no lid frame, so nothing
  // drawn over the sketch frame's points (docs/plans/no-lid-frame.md).
  const ends = (n: Model) => new Set([...n.entities.values()].flatMap((e) => (e.kind === "line" ? e.refs : [])));
  const loose = (n: Model, owns: string[]) => owns.filter((p) => n.entities.get(p)?.kind === "point" && !ends(n).has(p));
  assert.deepEqual(loose(m, f.owns), []);
  assert.ok(!f.owns.some((n) => m.entities.get(n)?.kind === "frame"));

  // Nothing is treated differently because a feature made it: a version-10
  // file's lid frame over a floating sketch frame has reference points that
  // end no line, so they are isolated points and drawn, and the frame too.
  const s = sketch();
  const old = s.m.featureOf(extrude(s.m, s.lines[0], 20, null, null, 10), "extrude");
  const oldQuiet = quietEntities(s.m, { shaded: true, faced: new Set([old.name]) });
  assert.equal(loose(s.m, old.owns).length, 3, "the old lid frame's three");
  for (const p of loose(s.m, old.owns)) assert.ok(!oldQuiet.has(p), `${p}: made by e1, but an end of nothing`);
  assert.ok(!oldQuiet.has(old.top!), "the lid's frame is drawn — frames are never quiet");
});

test("a profile member that is only part of a longer line is not quiet: most of that line may be off the solid", async () => {
  await loadKernel();
  const m = new Model(3);
  const t = tiltedFrame(m);
  const corners: [number, number][] = [[0, 0], [40, 0], [40, 30], [0, 30]];
  const { points, lines } = polygon(m, t, corners);
  points.forEach((p, i) => fix(m, p, [...corners[i], 0], t.name));
  const ends = [t.at(15, -10), t.at(15, 40)].map((w) => m.addPoint(w).name);
  for (const p of ends) { onPlane(m, p, t.name); }
  fix(m, ends[0], [15, -10, 0], t.name);
  fix(m, ends[1], [15, 40, 0], t.name);
  const across = m.addLine(ends[0], ends[1]).name;
  assert.equal(m.solve().solved, true);
  const f = m.featureOf(extrude(m, lines[3], 10), "extrude");
  assert.ok(f.loops[0].some((x) => typeof x !== "string" && x.name === across), "the profile runs along part of the crossing line");
  const quiet = quietEntities(m, { shaded: true, faced: new Set([f.name]) });
  assert.ok(quiet.has(lines[3]), "the left edge is wholly the solid's");
  assert.ok(!quiet.has(across) && !quiet.has(lines[0]) && !quiet.has(lines[2]), "lines only part of which bound it are drawn");
});

test("revealed: what is named, and a line's or arc's ends with it — so a hovered edge is drawn with its corners", async () => {
  await loadKernel();
  const { m, lines, arc, circle } = sketch();
  const l = m.line(lines[0]);
  const a = m.arc(arc);
  assert.deepEqual([...revealed(m, [lines[0]])].sort(), [lines[0], ...l.refs].sort());
  assert.deepEqual([...revealed(m, [arc])].sort(), [arc, a.start, a.end, a.center].sort());
  assert.deepEqual([...revealed(m, [circle])].sort(), [circle, m.circular(circle).center].sort());
  assert.deepEqual([...revealed(m, [l.refs[0]])], [l.refs[0]], "a point reveals itself only");
  assert.deepEqual([...revealed(m, ["r9"])], ["r9"], "a name that is no entity is carried and harmless");
});

test("drawn: a quiet corner is drawn when hovered, selected, the snap target or dragged — they are all one reveal — and a quiet edge when it or its glyph is hovered", async () => {
  await loadKernel();
  const { m, f, points } = box();
  const quiet = quietEntities(m, { shaded: true, faced: new Set([f.name]) });
  const corner = points[1];
  assert.equal(drawn(corner, quiet, none), false, "a corner at rest is not drawn");
  // The host makes one reveal of every source (main.ts): the hover's lit set,
  // the selection, the snap's targets, what is under an armed tool, the drag.
  for (const [why, names] of [["hovered", [corner]], ["selected", [corner]], ["snapped to", [corner]], ["dragged", [corner]]] as const) {
    assert.equal(drawn(corner, quiet, revealed(m, names)), true, why);
  }
  const wall = f.walls[1];
  const shown = revealed(m, [wall]);
  assert.equal(drawn(wall, quiet, shown), true, "the hovered edge");
  for (const p of m.line(wall).refs) assert.equal(drawn(p, quiet, shown), true, `with its end ${p}`);
  assert.equal(drawn(f.walls[2], quiet, shown), false, "and not its neighbour");
  const lone = [...m.entities.values()].find((e) => e.kind === "point" && !quiet.has(e.name))!;
  assert.equal(drawn(lone.name, quiet, none), true, "what is not quiet is drawn without asking");
});

test("a glyph follows its anchor: quiet on a quiet edge or corner, drawn with it — a dimension always", async () => {
  await loadKernel();
  const { m, f, lines, points, lone, t } = box();
  const par = parallel(m, lines[0], `${t.name}.x`);
  const coin = fix(m, points[2], [40, 30, 0], t.name); // a mark at a corner
  const held = fix(m, lone, [60, 60, 0], t.name);
  const view: View = orbitBy({ ox: 400, oy: 300, scale: 3 }, 0.6, 0.5);
  const quiet = quietEntities(m, { shaded: true, faced: new Set([f.name]) });
  // Both ends of each linked pair placed (as when lit), since this test is
  // about where a glyph is anchored, not which end of a pair is drawn — that
  // is linkedprofiles.test.ts's.
  const lit = new Set([par, coin, held].flatMap((r) => [r, ...m.linkedRelations(r)]));
  const marks = placeGlyphs(m, view, null, lit);
  const of = (r: string) => marks.filter((g) => g.relation === r);
  assert.deepEqual(of(par)[0].about, [lines[0]], "a par mark is about its line");
  assert.deepEqual(of(coin)[0].about, [points[2]], "a corner's mark is about its corner");
  assert.equal(glyphDrawn(of(par)[0], quiet, none, null), false, "on a solid's quiet edge: quiet");
  assert.equal(glyphDrawn(of(par)[0], quiet, revealed(m, [lines[0]]), null), true, "drawn when the line is hovered");
  assert.equal(glyphDrawn(of(par)[0], quiet, none, par), true, "and when the mark itself is — it is still picked");
  assert.equal(glyphDrawn(of(coin)[0], quiet, none, null), false, "at a quiet corner: quiet");
  assert.equal(glyphDrawn(of(coin)[0], quiet, revealed(m, [lines[1]]), null), true, "drawn with a line that reveals the corner");
  assert.equal(glyphDrawn(of(held)[0], quiet, none, null), true, "on a lone point, which is drawn: drawn");
  const depth = of(f.depth)[0];
  assert.equal(depth.isLabel, true);
  assert.equal(glyphDrawn(depth, quiet, none, null), true, "the depth's value stays: it is what the user edits");
  // The same par mark on a sketch with no solid is on a drawn line: drawn.
  assert.equal(glyphDrawn(of(par)[0], quietEntities(m, SHADED), none, null), true);
});

test("ls() lists a feature's output as a count under its line, and members() expands it", async () => {
  await loadKernel();
  const { m, f, lines, points } = box();
  const scope = neocadScope({ model: m });
  const ls = (scope.ls as () => string[])();
  const made = f.owns.filter((n) => m.entities.has(n));
  assert.ok(made.length > 10, "a box makes a lot");
  for (const n of made) assert.ok(!ls.some((l) => l.startsWith(`${n} `)), `${n} is not a line of its own`);
  for (const n of [...lines, ...points]) assert.ok(ls.some((l) => l.startsWith(`${n} `)), `${n}, the user's, is`);
  const at = ls.findIndex((l) => l.startsWith(`${f.name}  extrude of`));
  assert.ok(at >= 0, ls.join("\n"));
  // The count is of exactly what members() lists — the groups package's, which
  // reads a feature as a read-only group of what it made, its depth included.
  const members = (scope.members as (n: string) => string[])(f.name);
  assert.deepEqual(members, f.owns, "what the feature made, in the order made");
  assert.ok(members.includes(f.depth), "its dimension with it");
  assert.equal(ls[at + 1], `    ${members.length} made — members("${f.name}") lists them`);
  // Hidden pieces are still counted, and the count says how many.
  (scope.hide as (...n: string[]) => string[])(f.walls[0]);
  const after = (scope.ls as () => string[])();
  assert.equal(after[after.findIndex((l) => l.startsWith(`${f.name}  extrude of`)) + 1],
    `    ${members.length} made, 1 hidden — members("${f.name}") lists them`);
});

test("hidden outranks revealed: a hidden corner or edge stays undrawn however it is revealed, and what is not hidden is untouched", async () => {
  await loadKernel();
  const { m, f, points } = box();
  const quiet = quietEntities(m, { shaded: true, faced: new Set([f.name]) });
  const [corner, wall] = [points[1], f.walls[1]];
  const everything = revealed(m, [corner, wall]);
  assert.equal(entityDrawn(m, corner, quiet, everything), true, "revealed, and not hidden: drawn");
  hide(m, corner, wall);
  assert.equal(entityDrawn(m, corner, quiet, everything), false, "hidden: not drawn though selected, snapped to or dragged");
  assert.equal(entityDrawn(m, wall, quiet, everything), false, "nor a hidden edge");
  const other = points[2];
  assert.equal(entityDrawn(m, other, quiet, revealed(m, [other])), true, "a neighbour is still revealed as before");
  // In the hidden view nothing is quiet, and a hidden thing is still not drawn.
  assert.equal(entityDrawn(m, corner, quietEntities(m, { shaded: false, faced: new Set() }), new Set()), false);
});
