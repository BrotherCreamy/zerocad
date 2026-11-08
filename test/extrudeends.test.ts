// How an extrude ends (docs/plans/solid-tools-intuitive.md; the owner: "I'm
// still not clear on how to use the extrude cut tool. It doesn't make sense to
// me. Make it more intuitive"): blind, its depth, as it always was; through
// all, past the far side of everything made before it; symmetric, half each
// side of its sketch. Each is the record's (`extent`), journalled in the call's
// options, so it survives save/open and regeneration — and through all is
// relational: the depth dimension holds the lid past the body it goes through
// at every solve, so a cut through a plate follows the plate made deeper.

import { test } from "node:test";
import assert from "node:assert/strict";
import { Model } from "../src/model.ts";
import { extrude, regen, set, setEnd } from "../src/operations.ts";
import { open, save } from "../src/persist.ts";
import { neocadScope } from "../src/replenv.ts";
import { insideFeature, insideBody, chainsOf } from "../src/modes.ts";
import { kernelSweep } from "../src/solids.ts";
import { featureFaces } from "../src/faces.ts";
import { programOf } from "../src/bodies.ts";
import { Evaluator } from "../src/solids/evaluate.ts";
import { L, T, W, circleOn, loadSolver, onTop, plate } from "./solids/scene.ts";
import { kernel, noKernel as skip } from "./solids/load.ts";

const near = (a: number, b: number, tol = 1e-6) => Math.abs(a - b) <= tol * Math.max(1, Math.abs(b));

/** How far a feature's lid stands off its base along the tilted frame's +z: its first twin point's height. */
function lidHeight(m: Model, feature: string, base: number[], uz: number[]): number {
  const f = m.featureOf(feature, "extrude");
  const twin = m.entities.get(f.twins[0][0])!;
  const at = twin.kind === "circle" ? m.coords(twin.center) : twin.kind === "line" ? m.coords(twin.refs[0]) : null;
  assert.ok(at, `a twin with a point: ${twin.kind}`);
  return at.reduce((s, c, i) => s + (c - base[i]) * uz[i], 0);
}

test("symmetric: the lid at half the depth, the solid as far below the sketch as above it — and the dimension the whole depth", async () => {
  await loadSolver();
  const m = new Model(3);
  const p = plate(m);
  const top = p.lid.slice(0, 3).join(".");
  const c = circleOn(m, top, onTop(p, 50, 30), 6, p.t.uz);
  const e2 = extrude(m, c, 8, { end: "symmetric" });
  m.solve();
  const f = m.featureOf(e2, "extrude");
  assert.equal(f.extent, "symmetric");
  assert.equal(m.relationOf(f.depth).args[1], 8, "the dimension holds the whole depth");
  assert.ok(near(lidHeight(m, e2, p.t.at(0, 0, 0), p.t.uz), T + 4), "the lid four above the top");
  const inside = insideFeature(m, f);
  assert.ok(inside(p.t.at(50, 30, T + 3.9)) && inside(p.t.at(50, 30, T - 3.9)), "both sides of the sketch");
  assert.ok(!inside(p.t.at(50, 30, T + 4.1)) && !inside(p.t.at(50, 30, T - 4.1)), "and no further");
  // The kernel is handed the same span: from four below to four above.
  const sw = kernelSweep(m, f);
  assert.equal(sw.sweep.kind === "extrude" && sw.sweep.depth, 8);
  // Drawn so: the base cap four below the top, the lid four above.
  const faces = featureFaces(m, f, 1);
  const height = (kind: string) => {
    const face = faces.find((x) => x.kind === kind)!;
    return face.centroid.reduce((s, v, i) => s + (v - p.t.at(0, 0, 0)[i]) * p.t.uz[i], 0);
  };
  assert.ok(near(height("base"), T - 4) && near(height("lid"), T + 4), `base ${height("base")}, lid ${height("lid")}`);
  // Journalled in the call's options, beside the mode the default chose.
  const entry = m.journal.at(-1)!;
  assert.deepEqual(entry.args.at(-1), { mode: "add", into: p.feature, end: "symmetric" });
  // A set keeps it symmetric: twelve deep, six each side.
  set(m, `${f.depth}.value`, 12);
  m.solve();
  assert.ok(near(lidHeight(m, e2, p.t.at(0, 0, 0), p.t.uz), T + 6));
});

test("through all: a cut from the top goes past the plate's far side, and follows the plate when it is made deeper", async () => {
  await loadSolver();
  const m = new Model(3);
  const p = plate(m);
  const top = p.lid.slice(0, 3).join(".");
  const hole = circleOn(m, top, onTop(p, 50, 30), 5, p.t.uz);
  // The depth's number is only its sign: which way.
  const e2 = extrude(m, hole, -1, { mode: "cut", end: "through" });
  m.solve();
  const f = m.featureOf(e2, "extrude");
  assert.deepEqual([f.mode, f.into, f.extent], ["cut", p.feature, "through"]);
  // Ten down to the plate's base, and a unit past it (a tenth of ten is less than one).
  assert.ok(near(lidHeight(m, e2, p.t.at(0, 0, 0), p.t.uz), -1), `the lid one below the base: ${lidHeight(m, e2, p.t.at(0, 0, 0), p.t.uz)}`);
  const body = () => insideBody(m, chainsOf(m).bodies[0]);
  assert.ok(!body()(p.t.at(50, 30, 0.5)), "no material left at the bottom of the hole");
  // The plate twice as deep: the cut's lid follows, by the solve alone.
  set(m, `${m.featureOf(p.feature, "extrude").depth}.value`, 2 * T);
  m.solve();
  assert.ok(near(lidHeight(m, e2, p.t.at(0, 0, 0), p.t.uz), -2), `a tenth past the deeper base: ${lidHeight(m, e2, p.t.at(0, 0, 0), p.t.uz)}`);
  assert.ok(!body()(p.t.at(50, 30, 0.5)), "still through");
  assert.ok(body()(p.t.at(20, 30, 0.5)), "the plate beside it is material");
});

test("through all on a stepped body: through the boss and the plate under it", async () => {
  await loadSolver();
  const m = new Model(3);
  const p = plate(m);
  const top = p.lid.slice(0, 3).join(".");
  extrude(m, circleOn(m, top, onTop(p, 50, 30), 12, p.t.uz), 15); // a boss fifteen high
  m.solve();
  const bossTop = m.featureOf("e2", "extrude");
  // On the boss's top: its twin circle is a plane of its own.
  const lidCircle = bossTop.twins[0][0];
  const hole = circleOn(m, lidCircle, onTop(p, 50, 30).map((c, i) => c + 15 * p.t.uz[i]), 4, p.t.uz);
  const e3 = extrude(m, hole, -1, { mode: "cut", end: "through" });
  m.solve();
  // From 25 up down past 0: 25 deep and 2.5 more.
  const h = lidHeight(m, e3, p.t.at(0, 0, 0), p.t.uz);
  assert.ok(near(h, -2.5), `the lid below the plate's base: ${h}`);
  const inside = insideBody(m, chainsOf(m).bodies[0]);
  assert.ok(!inside(p.t.at(50, 30, 20)) && !inside(p.t.at(50, 30, 5)), "a hole through boss and plate");
  assert.ok(inside(p.t.at(42, 30, 20)), "the boss's wall beside the hole");
});

test("each end condition survives save/open byte for byte, and a regeneration keeps it", async () => {
  await loadSolver();
  const m = new Model(3);
  const p = plate(m);
  const top = p.lid.slice(0, 3).join(".");
  extrude(m, circleOn(m, top, onTop(p, 30, 30), 5, p.t.uz), -1, { mode: "cut", end: "through" });
  extrude(m, circleOn(m, top, onTop(p, 70, 30), 5, p.t.uz), 6, { end: "symmetric" });
  m.solve();
  const file = save(m);
  const back = open(file);
  assert.equal(save(back), file);
  assert.deepEqual([...back.features.values()].map((f) => f.kind === "extrude" ? f.extent ?? "blind" : null), ["blind", "through", "symmetric"]);
  back.solve();
  assert.ok(near(lidHeight(back, "e2", p.t.at(0, 0, 0), p.t.uz), -1), "through, after the replay");
  assert.ok(near(lidHeight(back, "e3", p.t.at(0, 0, 0), p.t.uz), T + 3), "symmetric, after the replay");
  // Regenerated (the profile brought back into step): still how it ended.
  regen(back, "e2");
  regen(back, "e3");
  back.solve();
  assert.equal(back.featureOf("e2", "extrude").extent, "through");
  assert.equal(back.featureOf("e3", "extrude").extent, "symmetric");
  assert.ok(near(lidHeight(back, "e2", p.t.at(0, 0, 0), p.t.uz), -1));
  // And the regenerated file opens to the same.
  const again = open(save(back));
  again.solve();
  assert.equal(again.featureOf("e2", "extrude").extent, "through");
});

test("typed, the lines replay: extrude with { end }, and setEnd changing it afterwards — and the refusals say what would do", async () => {
  await loadSolver();
  const m = new Model(3);
  const p = plate(m);
  const top = p.lid.slice(0, 3).join(".");
  const hole = circleOn(m, top, onTop(p, 50, 30), 5, p.t.uz);
  const scope = neocadScope({ model: m }) as Record<string, (...a: unknown[]) => unknown>;
  const e2 = scope.extrude(hole, -4, { mode: "cut" }) as string;
  m.solve();
  assert.ok(near(lidHeight(m, e2, p.t.at(0, 0, 0), p.t.uz), T - 4), "blind, four down");
  scope.setEnd(e2, "through");
  m.solve();
  assert.ok(near(lidHeight(m, e2, p.t.at(0, 0, 0), p.t.uz), -1), "through all now");
  assert.deepEqual(m.journal.at(-1), { op: "setEnd", args: [e2, "through"] });
  const back = open(save(m));
  back.solve();
  assert.equal(back.featureOf(e2, "extrude").extent, "through");
  scope.setEnd(e2, "blind");
  m.solve();
  assert.ok(near(lidHeight(m, e2, p.t.at(0, 0, 0), p.t.uz), T - 4), "blind again, as deep as it was");
  assert.throws(() => scope.extrude(hole, -4, { end: "upTo" }), /end is "blind" \(the depth\), "through" \(through all\) or "symmetric"/);
  assert.throws(() => setEnd(m, e2, "sideways"), /setEnd's end is "blind"/);
  assert.throws(() => setEnd(m, "l1", "through"), /setEnd/);
  // A revolve has no end condition to take.
  assert.throws(() => scope.revolve(hole, "t.x", 1, { end: "through" }), /revolve has no option "end"/);
});

test("through all into nothing is the blind extrude it was typed as — nothing made before it stands that way", async () => {
  await loadSolver();
  const m = new Model(3);
  const p = plate(m);
  // A circle on the plate's top, cut *up* "through all": everything before it is below.
  const top = p.lid.slice(0, 3).join(".");
  const up = circleOn(m, top, onTop(p, 50, 30), 4, p.t.uz);
  const e2 = extrude(m, up, 7, { mode: "cut", into: p.feature, end: "through" });
  m.solve();
  assert.ok(near(lidHeight(m, e2, p.t.at(0, 0, 0), p.t.uz), T + 7), `seven up, as typed: ${lidHeight(m, e2, p.t.at(0, 0, 0), p.t.uz)}`);
  // Beside the plate, cut down, it goes as far as the plate is deep: through
  // all is past everything made before, wherever it stands across the sketch.
  const away = circleOn(m, top, p.t.at(L + 40, W + 40, T), 4, p.t.uz);
  const e3 = extrude(m, away, -1, { mode: "cut", into: p.feature, end: "through" });
  m.solve();
  assert.ok(near(lidHeight(m, e3, p.t.at(0, 0, 0), p.t.uz), -1));
});

// ---- the solid kernel builds what the lid bounds -------------------------------

test("the kernel builds them: a hole through all has neither cap and the plate's volume less a cylinder; a symmetric boss its whole depth", { skip }, async () => {
  await loadSolver();
  const m = new Model(3);
  const p = plate(m);
  const top = p.lid.slice(0, 3).join(".");
  const hole = extrude(m, circleOn(m, top, onTop(p, 30, 30), 5, p.t.uz), -1, { mode: "cut", end: "through" });
  // Symmetric about the top: four of its eight into the plate (adding nothing there), four above.
  const boss = extrude(m, circleOn(m, top, onTop(p, 70, 30), 3, p.t.uz), 8, { end: "symmetric" });
  m.solve();
  const ev = new Evaluator(await kernel());
  const [body] = ev.run(programOf(m, true).program).bodies;
  const s = body.solid!;
  assert.deepEqual(s.validity, { manifold: true, failures: 0 });
  const want = L * W * T - Math.PI * 25 * T + Math.PI * 9 * 4;
  assert.ok(Math.abs(s.volume - want) < 1e-6 * want, `${s.volume} against ${want}`);
  const names = new Set(s.faces.map((f) => f.name));
  assert.ok(names.has(`${hole}.m0`) && !names.has(`${hole}.lid`) && !names.has(`${hole}.base`), `a hole right through: ${[...names]}`);
  assert.ok(names.has(`${boss}.lid`), "the boss's lid, four above the top");
  // Made deeper, the plate keeps its hole through: the cut follows it.
  set(m, `${m.featureOf(p.feature, "extrude").depth}.value`, 2 * T);
  m.solve();
  const [deeper] = ev.run(programOf(m, true).program).bodies;
  const want2 = L * W * 2 * T - Math.PI * 25 * 2 * T + Math.PI * 9 * 4;
  assert.ok(Math.abs(deeper.solid!.volume - want2) < 1e-6 * want2, `${deeper.solid!.volume} against ${want2}`);
});
