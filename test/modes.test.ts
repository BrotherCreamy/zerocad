// What a new extrude or revolve does to a body when its call says nothing —
// and what it does when it says (docs/plans/solids-kernel.md). The defaults are
// Onshape's: touching or overlapping a body adds to it, touching none is a new
// body; cut is chosen. Decided at the call, from the live geometry, and
// journalled resolved, so a replay decides nothing — and an old file's
// features, which carry no mode, are each a body of their own, as they were.

import { test } from "node:test";
import assert from "node:assert/strict";
import { Model } from "../src/model.ts";
import { extrude, revolve } from "../src/operations.ts";
import { open, save } from "../src/persist.ts";
import { neocadScope } from "../src/replenv.ts";
import { chainsOf, defaultMode, insideBody, insideFeature, modeOf } from "../src/modes.ts";
import { organiserSections } from "../src/organiser.ts";
import { L, T, W, circleOn, loadSolver, onTop, plate } from "./solids/scene.ts";
import { polygon } from "./profiles.ts";
import { parallel } from "../src/relations/geometry.ts";

const neg = (v: number[]) => v.map((c) => -c);

test("the plate's own inside: closed form, on the tilted frame", async () => {
  await loadSolver();
  const m = new Model(3);
  const p = plate(m);
  const inside = insideFeature(m, m.featureOf(p.feature));
  assert.ok(inside(p.t.at(50, 30, 5)));
  assert.ok(!inside(p.t.at(50, 30, 11)), "above the lid");
  assert.ok(!inside(p.t.at(50, 30, -1)), "below the base");
  assert.ok(!inside(p.t.at(101, 30, 5)), "beside it");
});

test("a circle sketched on the plate's top: extruded out it adds (a boss), in it adds too — and says it runs into material, where the dialog offers Cut", async () => {
  await loadSolver();
  const m = new Model(3);
  const p = plate(m);
  const top = p.lid.slice(0, 3).join(".");
  const boss = circleOn(m, top, onTop(p, 30, 30), 6, p.t.uz);
  const e2 = extrude(m, boss, 8);
  m.solve();
  const f2 = m.featureOf(e2);
  assert.equal(f2.mode, "add");
  assert.equal(f2.into, p.feature);
  // The journal says it, resolved: a replay decides nothing.
  const entry = m.journal[m.journal.length - 1];
  assert.deepEqual(entry.args[entry.args.length - 1], { mode: "add", into: p.feature });

  const hole = circleOn(m, top, onTop(p, 70, 30), 4, p.t.uz);
  const e3 = extrude(m, hole, -T - 2);
  m.solve();
  assert.equal(m.featureOf(e3).mode, "add", "into the body is still add by default — cut is chosen");
  const choice = defaultMode(m, m.featureOf(e3));
  assert.equal(choice.into_material, true, "and runs into the material: what makes the dialog offer Cut");
  assert.equal(defaultMode(m, m.featureOf(e2)).into_material, false, "the boss stands out from the face");
});

test("a circle well off the plate is a new body; one overlapping it from the side adds", async () => {
  await loadSolver();
  const m = new Model(3);
  const p = plate(m);
  const away = circleOn(m, p.t.name, p.t.at(200, 30), 5, p.t.uz);
  const e2 = extrude(m, away, 10);
  assert.equal(modeOf(m.featureOf(e2)), "new");
  assert.equal(m.featureOf(e2).mode, undefined, "a new body's record carries no mode, as an old file's does");
  const entry = m.journal[m.journal.length - 1];
  assert.ok(!entry.args.some((a) => a !== null && typeof a === "object" && !Array.isArray(a)), "and its entry no options");
  // Over the plate's edge, a little above it, pushed down into it: overlaps it.
  const c = m.addPoint(p.t.at(L, 30, T + 2)).name;
  const over = m.addCircle(c, 5, p.t.uz).name;
  parallel(m, over, "t.z");
  assert.equal(m.featureOf(extrude(m, over, -4)).mode, "add");
});

test("a boss on a side face adds; the chains follow the order features were made", async () => {
  await loadSolver();
  const m = new Model(3);
  const p = plate(m);
  // The wall along the frame's x at v = 0: two base corners and a lid corner, facing −y, out of the plate.
  const side = [p.base[0], p.base[1], p.lid[0]].join(".");
  const boss = circleOn(m, side, p.t.at(50, 0, T / 2), 3, neg(p.t.uy));
  const e2 = extrude(m, boss, 8);
  m.solve();
  assert.deepEqual([m.featureOf(e2).mode, m.featureOf(e2).into], ["add", p.feature]);
  const top = p.lid.slice(0, 3).join(".");
  const e3 = extrude(m, circleOn(m, top, onTop(p, 50, 30), 4, p.t.uz), -T, { mode: "cut" });
  m.solve();
  const chains = chainsOf(m);
  assert.deepEqual(chains.bodies.map((c) => [c.name, c.features.map((f) => f.name)]), [[p.feature, [p.feature, e2, e3]]]);
  const inside = insideBody(m, chains.bodies[0]);
  assert.ok(!inside(p.t.at(50, 30, 5)), "the hole is not material");
  assert.ok(inside(p.t.at(20, 30, 5)), "the plate beside it is");
  assert.ok(inside(p.t.at(50, -4, T / 2)), "the boss is");
  // The organiser's Bodies: one, named by its first feature, its chain signed.
  const [bodies, , features] = organiserSections(m);
  assert.deepEqual(bodies.rows.map((r) => [r.name, r.detail, r.count, r.eyeCommand]), [[p.feature, `+${e2} −${e3}`, 3, `hide("${p.feature}")`]]);
  assert.deepEqual(features.rows.map((r) => r.detail), ["extrude", "extrude · add", "extrude · cut"]);
});

test("typed: extrude(member, depth, { mode: \"cut\" }) cuts the body it touches, journalled with the body resolved; options must come last", async () => {
  await loadSolver();
  const m = new Model(3);
  const p = plate(m);
  const top = p.lid.slice(0, 3).join(".");
  const hole = circleOn(m, top, onTop(p, 50, 30), 5, p.t.uz);
  const scope = neocadScope({ model: m }) as Record<string, (...a: unknown[]) => unknown>;
  const e2 = scope.extrude(hole, -12, { mode: "cut" }) as string;
  assert.deepEqual([m.featureOf(e2).mode, m.featureOf(e2).into], ["cut", p.feature]);
  const entry = m.journal[m.journal.length - 1];
  assert.equal(entry.op, "extrude");
  assert.deepEqual(entry.args[entry.args.length - 1], { mode: "cut", into: p.feature });
  assert.throws(() => scope.extrude(hole, -12, { mode: "drill" }), /mode is one of "new", "add", "cut", "intersect"/);
  assert.throws(() => scope.extrude(hole, -12, { mode: "cut", into: "e9" }), /"e9" is not a feature/);
  assert.throws(() => scope.extrude(hole, -12, { mode: "new", into: p.feature }), /makes a body of its own/);
  assert.throws(() => scope.extrude(hole, -12, { mode: "cut" }, "f1"), /come last/);
  assert.throws(() => scope.extrude(hole, -12, { colour: "red" }), /no option "colour"/);
});

test("save, open: the modes come back, byte-identical, and a replay decides nothing from positions", async () => {
  await loadSolver();
  const m = new Model(3);
  const p = plate(m);
  const top = p.lid.slice(0, 3).join(".");
  extrude(m, circleOn(m, top, onTop(p, 30, 30), 6, p.t.uz), 8);
  extrude(m, circleOn(m, top, onTop(p, 70, 30), 4, p.t.uz), -12, { mode: "cut" });
  m.solve();
  const file = save(m);
  const back = open(file);
  assert.equal(save(back), file);
  assert.deepEqual([...back.features.values()].map((f) => [f.name, f.mode ?? "new", f.into ?? null]),
    [["e1", "new", null], ["e2", "add", "e1"], ["e3", "cut", "e1"]]);
  // A replayed entry with no options is new however it lies: here the boss's
  // options are cut off the entry, and the feature it replays to is new.
  const saved = JSON.parse(file);
  const boss = saved.journal.find((j: { op: string; args: unknown[] }) => j.op === "extrude" && (j.args.at(-1) as { mode?: string })?.mode === "add");
  boss.args = boss.args.slice(0, 4);
  const stripped = open(JSON.stringify(saved));
  assert.equal(stripped.featureOf("e2").mode, undefined, "no options: new, though it stands on the plate");
});

test("an old file's features carry no mode: every one a body of its own, as two overlapping extrudes always were", async () => {
  await loadSolver();
  const m = new Model(3);
  const p = plate(m);
  // Overlapping the plate — a circle over its corner, a little above it,
  // pushed down into it — made new as an old file's feature was.
  const c = m.addPoint(p.t.at(L, W, T + 2)).name;
  const ring = m.addCircle(c, 8, p.t.uz).name;
  parallel(m, ring, "t.z");
  extrude(m, ring, -6, null, null, null, { mode: "new" });
  m.solve();
  const back = open(save(m));
  assert.deepEqual(chainsOf(back).bodies.map((c) => c.features.map((f) => f.name)), [["e1"], ["e2"]]);
});

test("a cut whose body is deleted is left out and said; an add whose body is deleted stands alone", async () => {
  await loadSolver();
  const m = new Model(3);
  const p = plate(m);
  const top = p.lid.slice(0, 3).join(".");
  extrude(m, circleOn(m, top, onTop(p, 30, 30), 6, p.t.uz), 8);
  extrude(m, circleOn(m, top, onTop(p, 70, 30), 4, p.t.uz), -12, { mode: "cut" });
  m.features.delete("e1"); // the record alone, as a hand-edited file could leave it
  const chains = chainsOf(m);
  assert.deepEqual(chains.bodies.map((c) => c.name), ["e2"]);
  assert.match(chains.alone[0].why, /adds to e1, which is no longer there/);
  assert.match(chains.left[0].why, /cuts e1, which is no longer there/);
});

test("a revolve's inside, closed form: a partial turn holds what it swept and not what it did not", async () => {
  await loadSolver();
  const m = new Model(3);
  const p = plate(m);
  // A rectangle beside the plate turned a quarter about the frame's y axis.
  const sq = polygon(m, p.t, [[-30, 0], [-20, 0], [-20, 10], [-30, 10]]);
  const e2 = revolve(m, sq.lines[0], "t.y", Math.PI / 2);
  m.solve();
  const inside = insideFeature(m, m.featureOf(e2));
  // Right-handed about +y carries −x toward +z.
  const at = (a: number, r: number, h: number) => p.t.at(-r * Math.cos(a), h, r * Math.sin(a));
  assert.ok(inside(at(Math.PI / 4, 25, 5)));
  assert.ok(!inside(at(-Math.PI / 4, 25, 5)), "the other way round");
  assert.ok(!inside(at(Math.PI / 4, 35, 5)), "beyond the profile");
  void W;
});
