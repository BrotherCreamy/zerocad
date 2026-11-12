// An extrude's two profiles are peers, related like a mirror's — nothing is
// consumed (docs/plans/linked-profiles.md).
//
// The owner: *"i mean kind of like mirror relations"*; *"in retrospect, i
// don't like the idea of anything being 'consumed' as this implies
// unidirectional hierarchy"*; *"after extrude, it should be impossible to tell
// which was the original and which is the derivative"*; and, answering what a
// deleted line and a trim mean (2026-11-12): *"Deleting a line would break it
// obviously. The other side of an extrude profile is an identically linked
// profile/sketch entities. If you change one the other follows
// automatically."* — *"If they are truly twinned profiles, then reining in one
// side should trim on the other also."* — *"I should be able to pull on
// anything."*
//
// So every test here asks the same thing of the lid as of the base, and where
// it edits one end it looks at the other. `linked-v19` is a file the build
// before this one wrote (test/fixtures/, made by a script that extruded five
// profiles and edited each the way a person would have then: a dimension set,
// a relation added to each end, a base relation deleted, a base corner
// filleted; an extrude deleted; a base line deleted and then a lid line; a
// circle extruded; a lid line deleted) with the geometry that build solved it
// to.

import { test } from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { ensureKernelLoaded } from "../src/kernel/problem.ts";
import { Model, type ExtrudeFeature } from "../src/model.ts";
import { del, extrude, fillet, regen, relinkOpen, revolve, set } from "../src/operations.ts";
import { circular, extend, linear, mirror, offset, trim } from "../src/sketchedit.ts";
import { edgeExtrude } from "../src/surfaces.ts";
import { coincident, dist, fix, onPlane } from "../src/relations/basic.ts";
import { angle, equalLength, parallel, perpendicular, radius, tangent } from "../src/relations/geometry.ts";
import { open, save, VERSION } from "../src/persist.ts";
import { linksOf, twinKind } from "../src/twins.ts";
import { featureFaces } from "../src/faces.ts";
import { chainsOf } from "../src/modes.ts";
import { organiserSections } from "../src/organiser.ts";
import { placeGlyphs } from "../src/glyphs.ts";
import { neocadScope } from "../src/replenv.ts";
import { pullTo } from "../src/tools/engine.ts";
import type { View } from "../src/view.ts";
import "../src/modules/builtin.ts";

async function loadKernel() {
  await ensureKernelLoaded(await readFile(new URL("../src/kernel/wasm-gen/neocad_kernel_bg.wasm", import.meta.url)));
}

const sub = (a: number[], b: number[]) => a.map((x, i) => x - b[i]);
const len = (a: number[]) => Math.hypot(...a);
const dot = (a: number[], b: number[]) => a.reduce((s, x, i) => s + x * b[i], 0);
const ok = (m: Model, what = "") => assert.equal(m.solve().solved, true, `solved ${what}`);

/** A rectangle 40 × 25 on the ground, its sides square, two of them dimensioned, extruded 10 — free to move, as the owner draws one. */
async function block(opts: { pinned?: boolean } = {}) {
  await loadKernel();
  const m = new Model(3);
  const P = [[0, 0, 0], [40, 0, 0], [40, 25, 0], [0, 25, 0]].map((c) => m.addPoint(c).name);
  const L = P.map((p, i) => m.addLine(p, P[(i + 1) % 4]).name);
  const r = [perpendicular(m, L[0], L[1]), perpendicular(m, L[1], L[2]), perpendicular(m, L[2], L[3])];
  const [w, h] = [dist(m, P[0], P[1], 40), dist(m, P[1], P[2], 25)];
  // Pinned: held where it is by exactly what that takes — a corner, a direction, and the ground under the far corner.
  if (opts.pinned) { fix(m, P[0], [0, 0, 0]); parallel(m, L[0], "origin.x"); onPlane(m, P[2], "origin"); }
  ok(m, "the sketch");
  const e = extrude(m, L[0], 10);
  ok(m, "extruded");
  const f = () => m.featureOf(e, "extrude");
  const lidOf = (p: string) => linksOf(m).find((l) => l.record === e)!.fwd.get(p)!;
  return { m, P, L, r, w, h, e, f, lidOf };
}

/** A drag as the engine does one: frames of pulls toward a moving target, then the release's solve. */
function drag(m: Model, point: string, by: number[], frames = 12): boolean {
  const from = m.coords(point);
  for (let k = 1; k <= frames; k++) m.solveFrame(pullTo(m, point, from.map((c, i) => c + (by[i] * k) / frames)));
  return m.solve().solved;
}

/** What a profile's own relations say, as op and arguments, for comparing one profile's with the other's. */
const said = (m: Model, names: readonly string[]) => names.map((n) => [m.relationOf(n).op, ...m.relationOf(n).args]);

// --- twins ----------------------------------------------------------------------

test("twins: every relation within the base has its twin on the lid — the same relation over the partner entities, named for its partner, and holding no rows", async () => {
  const { m, L, r, w, h, f, lidOf } = await block();
  const T = f().twins[0];
  for (const [i, name] of r.entries()) {
    const twin = m.relationOf(`${name}_e1`);
    assert.deepEqual([twin.op, ...twin.args], ["perpendicular", T[i], T[i + 1]], `${name}'s twin`);
    assert.deepEqual(twin.twin, { of: name, via: f().depth });
    assert.equal(twin.blocks.length, 0, "a linked twin holds no rows: its partner's, and the extrusion, already say it");
  }
  assert.deepEqual(m.relationOf(`${w}_e1`).args, [lidOf(m.line(L[0]).refs[0]), lidOf(m.line(L[0]).refs[1]), 40]);
  assert.deepEqual(m.relationOf(`${h}_e1`).args, [lidOf(m.line(L[1]).refs[0]), lidOf(m.line(L[1]).refs[1]), 25]);
});

test("twins claim no name counter: the relation made after an extrude is named as it would have been with none", async () => {
  const { m, L } = await block();
  assert.equal(equalLength(m, L[0], L[2]), "r4");
  assert.equal(dist(m, m.line(L[0]).refs[0], m.line(L[2]).refs[0], 47), "d4", "d1 and d2 the sides, d3 the depth");
});

test("which relations twin: shapes and directions do, positions and what reaches outside the profile do not", async () => {
  const { m, P, L, f } = await block();
  const outside = m.addPoint([80, 0, 0]).name;
  const far = m.addLine(m.addPoint([80, 10, 0]).name, m.addPoint([90, 30, 0]).name).name;
  const twinOf = (name: string) => [...m.relations.values()].find((x) => x.twin?.of === name);
  // Directions: a frame's axis is a direction, and its twin names the same axis.
  const level = parallel(m, L[0], "origin.x");
  assert.deepEqual(twinOf(level)?.args, [f().twins[0][0], "origin.x"]);
  const turned = angle(m, L[0], L[1], Math.PI / 2);
  assert.deepEqual(twinOf(turned)?.args, [f().twins[0][0], f().twins[0][1], Math.PI / 2]);
  // Positions: they would pin the lid where the base is.
  assert.equal(twinOf(fix(m, P[0], [0, 0, 0])), undefined, "fix");
  assert.equal(twinOf(onPlane(m, P[1], "origin")), undefined, "onplane");
  // Outside the profile: a twin would hold the lid to what the base is held to.
  assert.equal(twinOf(dist(m, P[1], outside, 40)), undefined, "a dist to another sketch's point");
  assert.equal(twinOf(equalLength(m, L[0], far)), undefined, "an eq with a line elsewhere");
  assert.equal(twinOf(parallel(m, L[1], far)), undefined, "a par with a line elsewhere");
  // The register's table, as the modules declare it.
  for (const op of ["dist", "coincident", "midpoint", "pointOnLine", "equalLength", "symmetric", "collinear", "equalSpacing", "coplanar",
    "radius", "diameter", "onCircle", "concentric", "coradial", "equalRadius", "tangent", "arcEndpoints", "intersection", "onEllipse",
    "majorAxis", "minorAxis"]) assert.equal(twinKind(op), "shape", op);
  for (const op of ["parallel", "perpendicular", "angle"]) assert.equal(twinKind(op), "direction", op);
  for (const op of ["fix", "onPlane", "pierce", "measure", "onSpline", "extrusion", "revolution", "translated", "rotated", "rotation"]) {
    assert.equal(twinKind(op), null, op);
  }
  ok(m);
});

test("a relation added later to either profile gets its twin at once — on the base from the lid, as on the lid from the base", async () => {
  const { m, L, f } = await block();
  const T = f().twins[0];
  const onBase = parallel(m, L[0], L[2]);
  assert.deepEqual(said(m, [`${onBase}_e1`]), [["parallel", T[0], T[2]]]);
  const onLid = equalLength(m, T[1], T[3]);
  const back = m.relationOf(`${onLid}_e1`);
  assert.deepEqual([back.op, ...back.args, back.twin?.of], ["equalLength", L[1], L[3], onLid], "the lid's relation is said of the base");
  assert.ok(m.relationOf(onLid).blocks.length > 0 && back.blocks.length === 0, "whichever was typed holds the rows");
  ok(m);
});

test("a dimension pair shares one value: set either and both change, and the solid follows from either end", async () => {
  const { m, P, w, f, lidOf } = await block();
  const width = (a: string, b: string) => len(sub(m.coords(b), m.coords(a)));
  set(m, `${w}.value`, 55);
  ok(m);
  assert.equal(m.relationOf(`${w}_e1`).args[2], 55, "the lid's reads what the base's was set to");
  assert.ok(Math.abs(width(lidOf(P[0]), lidOf(P[1])) - 55) < 1e-7);
  // The lid's dimension drives the base.
  set(m, `${w}_e1.value`, 30);
  ok(m);
  assert.equal(m.relationOf(w).args[2], 30, "and the base's what the lid's was");
  assert.ok(Math.abs(width(P[0], P[1]) - 30) < 1e-7 && Math.abs(width(lidOf(P[0]), lidOf(P[1])) - 30) < 1e-7);
  assert.equal(m.relationOf(`${w}_e1`).blocks.length, 0, "still no rows of its own");
  // One entry each, and a replay sets both.
  assert.deepEqual(m.journal.slice(-2), [{ op: "set", args: [`${w}.value`, 55] }, { op: "set", args: [`${w}_e1.value`, 30] }]);
  const back = open(save(m, false));
  assert.equal(back.relationOf(w).args[2], 30);
  assert.equal(back.relationOf(`${w}_e1`).args[2], 30);
  assert.equal(f().open, undefined);
});

test("a lid corner dragged takes the base corner with it, and a base corner the lid — the solid a right prism either way", async () => {
  for (const which of ["lid", "base"] as const) {
    const { m, P, lidOf } = await block();
    const [grab, other] = which === "lid" ? [lidOf(P[2]), P[2]] : [P[2], lidOf(P[2])];
    const [g0, o0] = [m.coords(grab), m.coords(other)];
    assert.equal(drag(m, grab, [9, -4, 3]), true);
    const moved = sub(m.coords(other), o0);
    assert.ok(len(sub(m.coords(grab), g0)) > 1, "the corner went");
    assert.ok(len(moved) > 1, `${which} dragged: the other profile's corner followed (${moved.map((c) => c.toFixed(2))})`);
    assert.ok(Math.abs(len(sub(m.coords(lidOf(P[2])), m.coords(P[2]))) - 10) < 1e-6, "still the depth apart");
    for (const p of P) assert.ok(len(sub(sub(m.coords(lidOf(p)), m.coords(p)), sub(m.coords(lidOf(P[0])), m.coords(P[0])))) < 1e-6, "one chord");
  }
});

// --- the pair is one ---------------------------------------------------------------

test("nothing orange: a pair is one statement — an extrude adds nothing redundant, and nothing agreeing, to what the sketch said", async () => {
  const { m, L } = await block({ pinned: true });
  const d = m.diagnose();
  assert.deepEqual([d.redundant, d.agreeing], [[], []], "ten twins, none counted");
  // What the sketch itself says twice is still said, once: the fourth right angle.
  const fourth = perpendicular(m, L[3], L[0]);
  const after = m.diagnose();
  assert.deepEqual(after.redundant, [fourth]);
  assert.ok(after.agreeing.every((set) => set.every((n) => !m.relationOf(n).twin)), `no twin in an agreeing set: ${JSON.stringify(after.agreeing)}`);
  assert.equal(after.agreeing.flat().length, 4, "the four right angles, as before there were twins");
});

test("a conflict names a pair once, by the relation that was made — its twin never", async () => {
  const { m, L } = await block({ pinned: true });
  m.searchMs = 60_000;
  const p = parallel(m, L[0], L[1]);
  assert.ok(m.relations.has(`${p}_e1`), "the par has its twin on the lid");
  const report = m.solve();
  assert.equal(report.solved, false);
  const named = m.conflicting(report).relations;
  assert.ok(named.includes(p), `the par is named: ${named}`);
  assert.ok(named.every((n) => !m.relationOf(n).twin), `no twin is named: ${named}`);
  assert.equal(new Set(named).size, named.length);
  // Deleting it — either end — takes the pair, and the drawing solves.
  del(m, `${p}_e1`);
  assert.ok(!m.relations.has(p));
  ok(m);
});

// --- deleting -----------------------------------------------------------------------

test("deleting a relation deletes its twin while both profiles exist — from either end, one entry, and a replay takes both", async () => {
  const { m, r } = await block();
  assert.deepEqual(del(m, r[0]), [r[0], `${r[0]}_e1`]);
  assert.deepEqual(del(m, `${r[1]}_e1`), [r[1], `${r[1]}_e1`], "asked of the lid's, the base's goes with it");
  assert.deepEqual(m.journal.slice(-2), [{ op: "deleteRelation", args: [r[0]] }, { op: "deleteRelation", args: [`${r[1]}_e1`] }]);
  const back = open(save(m, false));
  for (const n of [r[0], r[1], `${r[0]}_e1`, `${r[1]}_e1`]) assert.ok(!back.relations.has(n), n);
  assert.ok(back.relations.has(r[2]) && back.relations.has(`${r[2]}_e1`));
});

test("deleting the extrude leaves two full sketches: both profiles, the chords, and each profile's own relations — holding, each on its own", async () => {
  const { m, P, L, r, w, h, e, f, lidOf } = await block();
  const { twins: [T], walls, depth } = f();
  const lid = P.map(lidOf);
  const base = [...r, w, h];
  assert.deepEqual(del(m, e), [e, depth, "e1_perp"]);
  for (const n of [...P, ...L, ...lid, ...T, ...walls]) assert.ok(m.entities.has(n), `${n} stays`);
  // The lid says of itself everything the base says of itself.
  const carry = new Map<string, string>([...P.map((p, i): [string, string] => [p, lid[i]]), ...L.map((l, i): [string, string] => [l, T[i]])]);
  assert.deepEqual(said(m, base.map((n) => `${n}_e1`)), said(m, base).map((s) => s.map((a) => (typeof a === "string" ? carry.get(a) ?? a : a))));
  for (const n of base.map((x) => `${x}_e1`)) {
    const x = m.relationOf(n);
    assert.ok(!x.twin && !x.asleep && x.blocks.length > 0, `${n} is an ordinary relation, with rows`);
  }
  ok(m);
  // No longer linked: each sketch is its own. The lid's width set leaves the base's.
  set(m, `${w}_e1.value`, 60);
  ok(m);
  assert.ok(Math.abs(len(sub(m.coords(lid[1]), m.coords(lid[0]))) - 60) < 1e-7, "the lid is 60 wide");
  assert.ok(Math.abs(len(sub(m.coords(P[1]), m.coords(P[0]))) - 40) < 1e-7, "the base still 40");
  assert.equal(m.relationOf(w).args[2], 40);
  // And the lid keeps its shape by its own relations: a corner dragged leaves it a 60 × 25 rectangle.
  drag(m, lid[2], [6, 9, 4]);
  assert.ok(Math.abs(dot(sub(m.coords(lid[1]), m.coords(lid[0])), sub(m.coords(lid[2]), m.coords(lid[1])))) < 1e-5, "square at its corner");
  assert.ok(Math.abs(len(sub(m.coords(lid[2]), m.coords(lid[1]))) - 25) < 1e-6, "25 deep");
  // Journalled with no entity deleted, and replayed to the same relations.
  const back = open(save(m, false));
  assert.deepEqual([...back.relations.keys()], [...m.relations.keys()]);
  assert.deepEqual([...back.entities.keys()], [...m.entities.keys()]);
  for (const n of back.relations.keys()) assert.ok(back.relationOf(n).blocks.length > 0 && !back.relationOf(n).twin, `${n} reopened with its rows`);
  ok(back);
});

for (const end of ["base", "lid"] as const) {
  test(`deleting a line of the ${end} deletes its twin and leaves the body open — the surviving walls swept, no cap, the row marked open — and redrawing it on the ${end} closes the body`, async () => {
    const { m, P, L, r, e, f, lidOf } = await block({ pinned: true });
    const T = f().twins[0].slice();
    const facesWere = featureFaces(m, f(), 4);
    assert.deepEqual(facesWere.map((x) => x.kind).sort(), ["base", "lid", "wall", "wall", "wall", "wall"]);
    const removed = del(m, end === "base" ? L[1] : T[1]);
    assert.deepEqual(new Set(removed), new Set([L[1], T[1], r[0], `${r[0]}_e1`, r[1], `${r[1]}_e1`]), "the line, its twin, and the relations on either");
    assert.ok(m.features.has(e), "the extrude stays as a record");
    assert.equal(f().open, true);
    assert.deepEqual([f().loops, f().twins], [[[L[0], L[2], L[3]]], [[T[0], T[2], T[3]]]]);
    assert.equal(f().walls.length, 4, "every corner still stands");
    ok(m, "open");
    // Drawn: a wall per surviving edge, from both sides, and no base or lid.
    const faces = featureFaces(m, f(), 4);
    assert.deepEqual(faces.map((x) => x.kind), Array(6).fill("wall"));
    assert.equal(new Set(faces.map((x) => x.name)).size, 3, "three walls");
    for (const name of new Set(faces.map((x) => x.name))) {
      const [a, b] = faces.filter((x) => x.name === name);
      assert.ok(len(a.normal.map((c, i) => c + b.normal[i])) < 1e-12, "each seen from either side");
    }
    // No body, and it says why; the organiser's row says open.
    assert.deepEqual(chainsOf(m).bodies, []);
    assert.match(chainsOf(m).left[0].why, /open/);
    assert.equal(organiserSections(m).find((s) => s.id === "features")!.rows[0].detail, "extrude · open");
    // Still one translated pair: a lid corner dragged takes its base corner.
    const was = m.coords(P[3]);
    m.deleteRelation("r4"); // the fix, so it can move
    drag(m, lidOf(P[3]), [5, 3, 0]);
    assert.ok(len(sub(m.coords(P[3]), was)) > 1, "the open walls still move as one");

    // Redrawn — on the same end it was deleted from — it twins at once, and the body closes.
    const [a, b] = end === "base" ? [P[1], P[2]] : [lidOf(P[1]), lidOf(P[2])];
    const again = m.addLine(a, b).name;
    assert.equal(f().open, undefined, "closed again");
    const k = f().loops[0].findIndex((x) => x === again || f().twins[0][f().loops[0].indexOf(x)] === again);
    assert.ok(k >= 0, "the new line is an edge of the profile");
    const [bl, tl] = [f().loops[0][k] as string, f().twins[0][k]];
    assert.deepEqual([...m.line(bl).refs].sort(), [P[1], P[2]].sort(), "its base edge runs between the base corners");
    assert.deepEqual([...m.line(tl).refs].sort(), [lidOf(P[1]), lidOf(P[2])].sort(), "and its lid edge between theirs");
    assert.equal(f().loops[0].length, 4);
    ok(m, "closed");
    assert.deepEqual(featureFaces(m, f(), 4).map((x) => x.kind).sort(), ["base", "lid", "wall", "wall", "wall", "wall"]);
    assert.equal(chainsOf(m).bodies.length, 1);
    assert.equal(organiserSections(m).find((s) => s.id === "features")!.rows[0].detail, "extrude");
    // A relation on the redrawn edge twins like any other.
    const sq = perpendicular(m, L[0], bl);
    assert.deepEqual(m.relationOf(`${sq}_e1`).args, [T[0], tl]);
    // Replayed: opened at the same step and closed at the same step, name for name.
    const text = save(m, false);
    const back = open(text);
    assert.deepEqual(back.featureOf(e), m.featureOf(e));
    assert.deepEqual([...back.entities.keys()], [...m.entities.keys()]);
    assert.deepEqual([...back.relations.keys()], [...m.relations.keys()]);
    assert.equal(save(back, false), text);
  });
}

test("deleting a corner of either profile takes both corners, their edges and the wall — the extrusion holding the pairs left", async () => {
  const { m, P, L, e, f, lidOf } = await block();
  const corner = lidOf(P[2]);
  const wall = f().walls.find((w) => m.line(w).refs.includes(P[2]))!;
  const T = f().twins[0].slice();
  const removed = del(m, corner);
  for (const n of [P[2], corner, wall, L[1], L[2], T[1], T[2]]) assert.ok(removed.includes(n), `${n} went`);
  assert.equal(f().open, true);
  assert.deepEqual(f().loops, [[L[0], L[3]]]);
  assert.ok(!m.relationOf(f().depth).args.includes(corner) && !m.relationOf(f().depth).args.includes(P[2]));
  ok(m);
  assert.ok(m.features.has(e));
});

test("a wall line is no edge of either profile: deleted alone, the body is still closed, and a solid", async () => {
  const { m, f } = await block();
  const [w] = f().walls;
  assert.deepEqual(del(m, w), [w]);
  assert.equal(f().open, undefined);
  assert.equal(chainsOf(m).bodies.length, 1);
  assert.equal(featureFaces(m, f(), 4).length, 6);
});

// --- trim and extend ----------------------------------------------------------------

/** A line drawn on the block's lid, held there, across the lid's first edge at x = 20. */
function cutterOnLid(m: Model, e: string) {
  const [a, b] = [m.addPoint([20, -6, 10]).name, m.addPoint([20, 12, 10]).name];
  const cutter = m.addLine(a, b).name;
  onPlane(m, a, `${e}.lid`);
  onPlane(m, b, `${e}.lid`);
  ok(m, "the cutter");
  return cutter;
}

test("a trim on the lid trims the base too: both edges end at the cut, the lid's end held on the curve that cut it, the body open", async () => {
  const { m, L, e, f } = await block({ pinned: true });
  const cutter = cutterOnLid(m, e);
  const [bl, tl] = [L[0], f().twins[0][0]];
  const notes: string[] = [];
  assert.deepEqual(trim(m, tl, [32, 0, 10], undefined, undefined, notes), [bl], "the one operation, made on its partner");
  ok(m, "trimmed");
  const [be, te] = [m.line(bl).refs[1], m.line(tl).refs[1]];
  assert.ok(len(sub(m.coords(be), [20, 0, 0])) < 1e-6, `the base edge ends at the cut: ${m.coords(be)}`);
  assert.ok(len(sub(m.coords(te), [20, 0, 10])) < 1e-6, `and the lid edge: ${m.coords(te)}`);
  assert.ok([...m.relations.values()].some((x) => x.op === "pointOnLine" && x.args[0] === te && x.args[1] === cutter), "the cut is a relation, on the lid");
  assert.equal(f().open, true);
  assert.match(notes.join("\n"), /e1 is open now/);
  assert.ok(f().walls.some((w) => m.line(w).refs.includes(be) && m.line(w).refs.includes(te)), "a wall at the new end");
  // The cutter moved along the edge, both ends follow: the cut is held, both ways.
  const [a] = m.line(cutter).refs;
  drag(m, a, [4, 0, 0]);
  ok(m);
  assert.ok(Math.abs(m.coords(te)[0] - m.coords(be)[0]) < 1e-6 && Math.abs(m.coords(be)[0] - 20) > 0.5, "the base end went with the lid's");
  // One entry, the base curve's; replayed to the same model.
  const entry = m.journal.filter((j) => j.op === "trim").at(-1)!;
  assert.equal(entry.args[0], bl);
  const back = open(save(m, false));
  assert.deepEqual(back.featureOf(e), m.featureOf(e));
  assert.deepEqual([...back.relations.keys()], [...m.relations.keys()]);
  ok(back);
});

test("a trim on the base trims the lid too — the same result from the other end", async () => {
  const { m, L, e, f } = await block({ pinned: true });
  const [a, b] = [m.addPoint([20, -6, 0]).name, m.addPoint([20, 12, 0]).name];
  m.addLine(a, b);
  ok(m);
  const tl = f().twins[0][0];
  trim(m, L[0], [32, 0, 0]);
  ok(m, "trimmed");
  assert.ok(len(sub(m.coords(m.line(L[0]).refs[1]), [20, 0, 0])) < 1e-6);
  assert.ok(len(sub(m.coords(m.line(tl).refs[1]), [20, 0, 10])) < 1e-6, "the lid edge was reined in with it");
  assert.equal(f().open, true);
  assert.equal(m.features.has(e), true);
});

test("an extend on the lid's free end extends the base's: both ends reach the edge, and the body can be closed again", async () => {
  const { m, P, L, e, f, lidOf } = await block({ pinned: true });
  // Opened by a trim on the base, back to a line across it.
  const cut = m.addLine(m.addPoint([20, -6, 0]).name, m.addPoint([20, 12, 0]).name).name;
  trim(m, L[0], [32, 0, 0]);
  del(m, cut);
  ok(m, "open");
  const tl = f().twins[0][0];
  const [be, te] = [m.line(L[0]).refs[1], m.line(tl).refs[1]];
  for (const x of [...m.relationsNaming(be), ...m.relationsNaming(te)]) if (x.op === "pointOnLine") del(m, x.name);
  // Extended on the lid, to the lid's next edge (named: the wall at that corner lies the same way off).
  extend(m, tl, te, f().twins[0][1]);
  ok(m, "extended");
  assert.ok([...m.relations.values()].some((x) => x.twin && x.op === "pointOnLine" && x.args[0] === be && x.args[1] === L[1]),
    "the hold on the lid's edge has its twin: the base's end on the base's edge");
  assert.ok(len(sub(m.coords(te), m.coords(lidOf(P[1])))) < 1e-6, `the lid's end is back at the corner: ${m.coords(te)}`);
  assert.ok(len(sub(m.coords(be), m.coords(P[1]))) < 1e-6, `and the base's with it: ${m.coords(be)}`);
  // The end joined to the corner — on the lid, as a snap joins it — is joined on
  // the base by the twin, and the profile walks closed: a solid again, at once.
  coincident(m, te, lidOf(P[1]));
  assert.equal(f().open, undefined, "closed by a coin typed on the lid");
  ok(m, "closed");
  assert.equal(chainsOf(m).bodies.length, 1);
  assert.equal(f().loops[0].length, 4);
  assert.deepEqual(featureFaces(m, f(), 4).map((x) => x.kind).sort(), ["base", "lid", "wall", "wall", "wall", "wall"]);
  assert.ok(m.features.has(e));
});

// --- old files ------------------------------------------------------------------------

interface Recorded {
  points: Record<string, number[]>;
  radii: Record<string, number>;
  kinds: Record<string, string>;
  relations: [string, string, unknown[]][];
  features: string[];
  named: { eA: string; eD: string; lidLine: string; A: { P: string[]; L: string[] }; C: { L: string[] }; circle: string };
}

test("a file from before linked profiles opens to the model it was — every name kept — and is linked from then on; its deletions mean what they meant", async () => {
  await loadKernel();
  const text = await readFile(new URL("./fixtures/linked-v19.neocad.json", import.meta.url), "utf8");
  const want = JSON.parse(await readFile(new URL("./fixtures/linked-v19.geometry.json", import.meta.url), "utf8")) as Recorded;
  assert.equal(JSON.parse(text).version, 19);
  const m = open(text, 3);
  // Every entity, relation and feature it had, under the name it had.
  assert.deepEqual([...m.entities.keys()].sort(), Object.keys(want.kinds).sort());
  for (const [n, k] of Object.entries(want.kinds)) assert.equal(m.entities.get(n)!.kind, k, n);
  assert.deepEqual([...m.features.keys()], want.features);
  const mine = [...m.relations.values()].filter((r) => !r.twin);
  assert.deepEqual(mine.map((r) => [r.name, r.op, r.args]), want.relations, "no name shifted, and nothing it said changed");
  ok(m, "as it opens");
  for (const [p, at] of Object.entries(want.points)) assert.ok(len(sub(m.coords(p), at)) < 1e-6, `${p} where that build left it`);
  for (const [c, r] of Object.entries(want.radii)) assert.ok(Math.abs(m.radius(c) - r) < 1e-6, c);

  // The extrudes that stand are linked: the base's relations each said of the lid.
  const { eA, eD, A, circle, lidLine } = want.named;
  const fA = m.featureOf(eA, "extrude");
  const twins = [...m.relations.values()].filter((r) => r.twin);
  assert.ok(twins.length > 0);
  assert.ok(twins.every((r) => r.blocks.length === 0 && m.relations.has(r.twin!.of)));
  assert.deepEqual(m.relationOf(`r1_${eA}`).args, [fA.twins[0][fA.loops[0].indexOf(A.L[0])], fA.twins[0][fA.loops[0].indexOf(A.L[1])]]);
  assert.equal(m.relationOf(`d10_${eD}`).op, "radius", "the circle's radius, said of its rim on the lid");
  assert.equal(m.relationOf(`d10_${eD}`).args[0], m.featureOf(eD, "extrude").twins[0][0]);
  // The fillet's relations regenerated onto the lid's arc.
  assert.ok(twins.some((r) => r.op === "tangent") && twins.some((r) => r.op === "arcEndpoints"));
  // The lid dimension that person typed, repeating the base's: no second twin was made for it.
  const lidDims = [...m.relations.values()].filter((r) => r.op === "dist" && r.args.every((a) => typeof a !== "string" || !A.P.includes(a))
    && r.args.includes(m.line(lidLine).refs[0]));
  assert.equal(lidDims.filter((r) => !r.twin).length, 1, "d4, the one typed");
  assert.equal(lidDims.filter((r) => r.twin).length, 1, "and d1's twin");
  // The records that went, went as they did then: their extrusions link nothing.
  assert.deepEqual(linksOf(m).map((l) => l.record), [eA, eD]);
  for (const j of m.journal.filter((x) => x.op === "deleteFeature")) assert.deepEqual(j.args.slice(1), ["unlinked"], "marked on the way in");
  assert.ok(![...m.relations.values()].some((r) => r.twin && !linksOf(m).some((l) => l.via === r.twin!.via)), "no twin across a link that is not one");
  const dA = m.diagnose();
  assert.ok(dA.agreeing.every((s) => s.every((n) => !m.relationOf(n).twin)));

  // Re-saved as the current format, stably; and worked on, linked.
  const once = save(m);
  assert.equal(JSON.parse(once).version, VERSION);
  const back = open(once, 3);
  assert.equal(save(back), once);
  assert.deepEqual([...back.relations.keys()], [...m.relations.keys()]);
  set(m, `d10_${eD}.value`, 9);
  ok(m);
  assert.ok(Math.abs(m.radius(circle) - 9) < 1e-7, "the lid rim's radius set, the base circle follows");
  assert.deepEqual(del(m, eD).slice(0, 2), [eD, m.journal.at(-1)!.args[0] === `${eD}_perp` ? "d11" : "d11"]);
  assert.ok(m.entities.has(m.relationOf(`d10_${eD}`).args[0] as string), "and a deletion now leaves the lid");
  assert.ok(m.relationOf(`d10_${eD}`).blocks.length > 0);
});

// --- item 4: features relate, they do not own -------------------------------------------

test("every feature deleted leaves its geometry whole: extrude, cut, edge extrude, revolve — and offset, mirror and the patterns, which never owned any", async () => {
  await loadKernel();
  const whole = (m: Model, names: Iterable<string>, what: string) => { for (const n of names) assert.ok(m.entities.has(n), `${what}: ${n} is still there`); };
  const rect = (m: Model, x: number, y: number, w: number, h: number, z = 0) => {
    const P = [[x, y, z], [x + w, y, z], [x + w, y + h, z], [x, y + h, z]].map((c) => m.addPoint(c).name);
    return { P, L: P.map((p, i) => m.addLine(p, P[(i + 1) % 4]).name) };
  };
  // Extrude, and a cut into it.
  {
    const m = new Model(3);
    const plate = rect(m, 0, 0, 60, 40);
    const e1 = extrude(m, plate.L[0], 10);
    const pocket = rect(m, 10, 10, 20, 15, 10);
    const e2 = extrude(m, pocket.L[0], -4, "origin", null, null, { mode: "cut", into: e1 });
    ok(m);
    const made = [...m.featureOf(e2, "extrude").owns, ...m.featureOf(e1, "extrude").owns].filter((n) => m.entities.has(n));
    assert.equal(m.featureOf(e2, "extrude").mode, "cut");
    assert.deepEqual(del(m, e2), [e2, "d2", "e2_perp"]);
    assert.deepEqual(del(m, e1), [e1, "d1", "e1_perp"]);
    whole(m, [...plate.P, ...plate.L, ...pocket.P, ...pocket.L, ...made], "extrude and cut");
    ok(m);
  }
  // Edge extrude.
  {
    const m = new Model(3);
    const [a, b, c] = [[0, 0, 0], [30, 0, 0], [30, 20, 0]].map((p) => m.addPoint(p).name);
    const [l1, l2] = [m.addLine(a, b).name, m.addLine(b, c).name];
    const sq = perpendicular(m, l1, l2);
    const s = edgeExtrude(m, [l1, l2], 12);
    ok(m);
    const made = m.surfaceOf(s).owns.filter((n) => m.entities.has(n));
    assert.ok(m.relations.has(`${sq}_${s}`), "an edge extrude's copy is linked as an extrude's lid is");
    assert.deepEqual(del(m, s), [s, "d1", `${s}_perp`]);
    whole(m, [a, b, c, l1, l2, ...made], "edge extrude");
    assert.ok(m.relationOf(`${sq}_${s}`).blocks.length > 0 && !m.relationOf(`${sq}_${s}`).twin, "its copy keeps the right angle, its own now");
    ok(m);
  }
  // Revolve.
  {
    const m = new Model(3);
    const r = rect(m, 10, 0, 15, 20);
    const e = revolve(m, r.L[0], "origin.y", 2);
    ok(m);
    const f = m.featureOf(e, "revolve");
    const made = f.owns.filter((n) => m.entities.has(n));
    assert.ok(made.length > 0);
    assert.deepEqual(del(m, e), [e, f.angle]);
    whole(m, [...r.P, ...r.L, ...made], "revolve");
    ok(m);
  }
  // Offset, mirror, linear and circular pattern: each is relations between entities, and no record.
  {
    const m = new Model(3);
    const r = rect(m, 0, 0, 30, 20);
    const copies = offset(m, r.L, 4);
    const axis = m.addLine(m.addPoint([50, -10, 0]).name, m.addPoint([50, 40, 0]).name).name;
    const mirrored = mirror(m, r.L, axis);
    const row = linear(m, [r.L[0]], 0, 30, 3);
    const centre = m.addPoint([-30, -30, 0]).name;
    const ring = circular(m, [r.L[1]], centre, Math.PI / 2, 3);
    ok(m);
    assert.equal(m.features.size + m.surfaces.size + m.blends.size, 0, "none of them is a record: there is nothing to own with");
    const all = [...m.entities.keys()];
    const held = [...m.relations.values()].filter((x) => ["symmetric", "translated", "rotated", "rotation", "parallel", "dist", "coplanar"].includes(x.op));
    assert.ok(held.length > 8);
    // Every relation any of them made is deletable like any other, and takes nothing with it.
    for (const x of held) assert.deepEqual(del(m, x.name), [x.name]);
    whole(m, all, "offset, mirror, patterns");
    for (const n of [...copies, ...mirrored, ...row, ...ring]) assert.ok(m.entities.has(n));
    ok(m);
  }
});

test("a relation a feature made is deleted like any other: the depth leaves the extrude unbuilt and both profiles their own; the perpendicular leaves it standing", async () => {
  const { m, r, e, f } = await block();
  // The perpendicular: the chord is free to lean, the record stays.
  assert.deepEqual(del(m, "e1_perp"), ["e1_perp"]);
  assert.equal(f().unbuilt, undefined);
  // The depth — the extrusion, the link itself.
  const depth = f().depth;
  assert.deepEqual(del(m, depth), [depth]);
  assert.match(f().unbuilt ?? "", /its depth d3 is deleted/);
  assert.equal(organiserSections(m).find((s) => s.id === "features")!.rows[0].detail, "extrude · unbuilt");
  assert.deepEqual(featureFaces(m, f(), 4), [], "nothing is drawn of it");
  assert.match(chainsOf(m).left[0].why, /depth d3 is deleted/);
  assert.equal(linksOf(m).length, 0, "the link went with the relation that was it");
  for (const n of r) assert.ok(m.relationOf(`${n}_e1`).blocks.length > 0 && !m.relationOf(`${n}_e1`).twin, "the lid's relations are its own now");
  ok(m);
  for (const n of [...f().twins[0], ...f().walls]) assert.ok(m.entities.has(n));
  // Replayed the same, and the record goes when asked.
  const back = open(save(m, false));
  assert.match((back.featureOf(e) as ExtrudeFeature).unbuilt ?? "", /depth/);
  assert.deepEqual(del(m, e), [e]);
});

test("a free body pulled by a point held to its face still moves: nothing pins a profile to make the other follow", async () => {
  const { m, P, e, lidOf } = await block();
  const q = m.addPoint([20, 12, 10]).name;
  onPlane(m, q, `${e}.lid`);
  ok(m);
  const was = [...P, ...P.map(lidOf)].map((p) => m.coords(p));
  assert.equal(drag(m, q, [0, 0, 14]), true);
  const moved = [...P, ...P.map(lidOf)].map((p, i) => len(sub(m.coords(p), was[i])));
  assert.ok(Math.max(...moved) > 3, `the solid went with the point: ${moved.map((x) => x.toFixed(1))}`);
  assert.ok(Math.abs(dot(sub(m.coords(q), m.coords(lidOf(P[0]))), sub(m.coords(lidOf(P[0])), m.coords(P[0])))) < 1e-5, "the point still on the lid");
  // And the base is as free as the lid: nothing in the link fixes either.
  assert.ok(P.every((p) => m.diagnose().free.has(p)) && P.every((p) => m.diagnose().free.has(lidOf(p))));
});

// --- what fillets-one-thing stands on, and the edges ---------------------------------------

test("a sketch fillet on the base regenerates the lid, and its relations twin onto the lid's arc; a relation typed on the lid's arc survives its being made again", async () => {
  const { m, L, f } = await block();
  const arc = fillet(m, L[0], L[1], 5);
  ok(m);
  const k = f().loops[0].indexOf(arc);
  const lidArc = f().twins[0][k];
  assert.equal(m.entities.get(lidArc)?.kind, "arc");
  const rad = [...m.relations.values()].find((x) => x.op === "radius" && x.args[0] === arc)!;
  assert.deepEqual(m.relationOf(`${rad.name}_e1`).args, [lidArc, 5]);
  assert.ok([...m.relations.values()].some((x) => x.twin && x.op === "tangent" && x.args.includes(lidArc)));
  set(m, `${rad.name}_e1.value`, 7);
  ok(m);
  assert.ok(Math.abs(m.radius(arc) - 7) < 1e-7 && Math.abs(m.radius(lidArc) - 7) < 1e-7, "the lid's radius drives the base's");
});

test("a lid that is another extrude's profile carries a relation on: a twin of a twin, set and deleted as one chain", async () => {
  const { m, L, w, f } = await block();
  const T = f().twins[0];
  const e2 = extrude(m, T[0], 6, `${m.line(T[0]).refs[0]}.${m.line(T[1]).refs[0]}.${m.line(T[2]).refs[0]}`);
  ok(m);
  const top = m.featureOf(e2, "extrude").twins[0];
  assert.ok(m.relations.has(`${w}_e1_${e2}`), "the width, said of the second lid");
  set(m, `${w}_e1_${e2}.value`, 48);
  ok(m);
  assert.deepEqual([m.relationOf(w).args[2], m.relationOf(`${w}_e1`).args[2]], [48, 48]);
  const p = parallel(m, top[0], top[2]);
  assert.ok(m.relations.has(`${p}_${e2}`) && m.relations.has(`${p}_${e2}_e1`), "and one typed on the top is said of both below");
  assert.deepEqual(m.relationOf(`${p}_${e2}_e1`).args, [L[0], L[2]]);
  assert.equal(del(m, `${p}_${e2}`).length, 3);
});

test("a twin's mark is drawn on both ends; a dimension's on one, the end nearer the viewer", async () => {
  const { m, r, w } = await block({ pinned: true });
  const above: View = { ox: 400, oy: 300, scale: 4 };
  const marks = placeGlyphs(m, above);
  assert.ok(marks.some((g) => g.relation === r[0]) && marks.some((g) => g.relation === `${r[0]}_e1`), "a right angle is marked at both corners");
  const dims = marks.filter((g) => g.relation === w || g.relation === `${w}_e1`);
  assert.deepEqual(dims.map((g) => g.relation), [`${w}_e1`], "from above, the lid's — never both, one over the other");
  const { orbitBy } = await import("../src/view.ts");
  const below = orbitBy(above, 0, Math.PI);
  const under = placeGlyphs(m, below).filter((g) => g.relation === w || g.relation === `${w}_e1`);
  assert.deepEqual(under.map((g) => g.relation), [w], "from below, the base's");
});

test("in a 2D model nothing links and nothing follows: a relation is made as it always was", async () => {
  await loadKernel();
  const m = new Model(2);
  const [a, b] = [m.addPoint([0, 0]).name, m.addPoint([10, 0]).name];
  const l = m.addLine(a, b).name;
  const c = m.addCircle(m.addPoint([5, 8]).name, 3).name;
  assert.equal(tangent(m, l, c), "r1");
  assert.equal(radius(m, c, 3), "d1");
  assert.equal(coincident(m, a, m.addPoint([0, 0]).name), "r2");
  assert.equal(linksOf(m).length, 0);
  assert.equal(relinkOpen(m), false);
  assert.ok([...m.relations.values()].every((r) => !r.twin && r.blocks.length > 0));
  ok(m);
});

test("the command line: ls() and rels() say which relations are a pair, and an open extrude says so", async () => {
  const { m, L, r, e } = await block();
  const scope = neocadScope({ model: m }) as Record<string, (...a: unknown[]) => unknown>;
  const rels = (scope.rels as () => string[])().join("\n");
  assert.match(rels, new RegExp(`${r[0]}_e1 .*⇄ ${r[0]}`), rels);
  del(m, L[2]);
  const ls = (scope.ls as () => string[])().join("\n");
  assert.match(ls, new RegExp(`${e}  extrude .*open`), ls);
});
