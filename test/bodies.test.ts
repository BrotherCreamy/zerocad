// Bodies through the app: features made the way the app makes them, their
// modes chosen by the default or typed, evaluated by the real kernel through
// the client (in-process — the e2e suite runs the real Worker), and checked
// by volume against closed forms, by validity, by name, and — for every body of
// one feature, which is every body an old file has — against solids.ts's own
// exact B-rep, the solid ZeroCAD drew and exported before the kernel shipped.

import { test } from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { Model } from "../src/model.ts";
import { extrude, revolve, set } from "../src/operations.ts";
import { open } from "../src/persist.ts";
import { Bodies, bodyFaces, programOf, type BodyView } from "../src/bodies.ts";
import { solidsOf } from "../src/solids.ts";
import { SolidsClient } from "../src/solids/client.ts";
import { Evaluator } from "../src/solids/evaluate.ts";
import { dot3, cross3 } from "../src/vec3.ts";
import { L, T, W, circleOn, loadSolver, onTop, plate } from "./solids/scene.ts";
import { polygon } from "./profiles.ts";
import { inProcessPort, kernel, noKernel as skip, smlibFactory } from "./solids/load.ts";

const neg = (v: number[]) => v.map((c) => -c);

/** Every body the model makes, all of them through the kernel (single features too). */
async function evaluateAll(m: Model) {
  const ev = new Evaluator(await kernel());
  return ev.run(programOf(m, true).program).bodies;
}

/** A Bodies over an in-process Worker, settled. */
async function settledBodies(m: Model): Promise<Bodies> {
  const client = new SolidsClient(() => inProcessPort(factory!));
  const bodies = new Bodies(client, () => {});
  bodies.sync(m);
  for (let i = 0; i < 200 && !bodies.settled; i++) await new Promise((r) => setTimeout(r, 5));
  assert.ok(bodies.settled, "the kernel answered");
  return bodies;
}
let factory: Awaited<ReturnType<typeof smlibFactory>> | null = null;

/** The owner's part: a plate, a hole cut through from the top, a boss added on a side. */
function ownersPart(m: Model) {
  const p = plate(m);
  const top = p.lid.slice(0, 3).join(".");
  const hole = extrude(m, circleOn(m, top, onTop(p, 30, 30), 5, p.t.uz), -T, { mode: "cut" });
  const side = [p.base[0], p.base[1], p.lid[0]].join(".");
  const boss = extrude(m, circleOn(m, side, p.t.at(70, 0, T / 2), 3, neg(p.t.uy)), 8);
  m.solve();
  return { p, hole, boss };
}

test("the owner's part: a plate, a hole cut through it, a boss on its side — one valid body of the right volume", { skip }, async () => {
  await loadSolver();
  factory = await smlibFactory();
  const m = new Model(3);
  const { p, hole, boss } = ownersPart(m);
  assert.deepEqual([m.featureOf(hole).mode, m.featureOf(boss).mode], ["cut", "add"], "the boss's add is the default");
  const bodies = await settledBodies(m);
  const views = bodies.views();
  assert.equal(views.length, 1, "one body");
  const v = views[0];
  assert.deepEqual(v.features, [p.feature, hole, boss]);
  const s = v.result.solid!;
  assert.deepEqual(s.validity, { manifold: true, failures: 0 });
  const want = L * W * T - Math.PI * 25 * T + Math.PI * 9 * 8;
  assert.ok(Math.abs(s.volume - want) < 1e-6 * want, `${s.volume} against ${want}`);
  const names = new Set(s.faces.map((f) => f.name));
  for (const n of ["e1.base", "e1.lid", "e1.m0", "e1.m1", "e1.m2", "e1.m3", `${hole}.m0`, `${boss}.m0`, `${boss}.lid`]) assert.ok(names.has(n), n);
  assert.ok(!names.has(`${hole}.lid`) && !names.has(`${hole}.base`), "a through hole has neither cap");
  assert.deepEqual(bodies.report().lines, []);
  // The faces are outward: the divergence theorem over them gives the volume back.
  const vol = v.faces.reduce((acc, f) => { const [a, b, c] = f.outlines[0]; return acc + dot3(a, cross3(b, c)) / 6; }, 0);
  assert.ok(Math.abs(vol - want) < 2e-3 * want, `the triangles enclose ${vol}`);
  // And every feature of the body is drawn by the kernel, none on its own.
  assert.deepEqual([...bodies.drawn().replaces].sort(), [p.feature, hole, boss].sort());
  assert.ok(v.faces.some((f) => f.edges.length), "the kernel's edges ride on its faces");
});

test("a dimension changes, the body rebuilds; a refusal keeps the last good body and says why", { skip }, async () => {
  await loadSolver();
  factory ??= await smlibFactory();
  const m = new Model(3);
  const { hole } = ownersPart(m);
  const bodies = await settledBodies(m);
  const before = bodies.views()[0].result.solid!.volume;
  set(m, `${m.featureOf(hole, "extrude").depth}.value`, -5); // the hole half way down: a blind hole
  m.solve();
  bodies.sync(m);
  for (let i = 0; i < 200 && !bodies.settled; i++) await new Promise((r) => setTimeout(r, 5));
  const after = bodies.views()[0].result.solid!;
  assert.ok(Math.abs(after.volume - before - Math.PI * 25 * 5) < 1e-6 * before, "half the hole filled back in");
  assert.ok(after.faces.some((f) => f.name === `${hole}.lid`), "and it has a floor now: its own lid");
});

test("a cut that reaches nothing is said, and the body is drawn uncut", { skip }, async () => {
  await loadSolver();
  factory ??= await smlibFactory();
  const m = new Model(3);
  const p = plate(m);
  const top = p.lid.slice(0, 3).join(".");
  const c = circleOn(m, top, onTop(p, 30, 30), 5, p.t.uz);
  const e2 = extrude(m, c, 6, { mode: "cut", into: p.feature }); // up, away from the plate
  m.solve();
  const bodies = await settledBodies(m);
  assert.deepEqual(bodies.report().lines, [`${e2} cuts nothing from ${p.feature} — it does not reach it`]);
  assert.ok(Math.abs(bodies.views()[0].result.solid!.volume - L * W * T) < 1e-6 * L * W * T);
});

test("a sketch on a face a cut removed stays where the face was, and the face's name is reported gone, not re-attached", { skip }, async () => {
  await loadSolver();
  factory ??= await smlibFactory();
  const m = new Model(3);
  const p = plate(m);
  // A boss on the top, then a sketch on the boss's lid, extruded: a second boss on the first.
  const top = p.lid.slice(0, 3).join(".");
  const b1 = extrude(m, circleOn(m, top, onTop(p, 50, 30), 10, p.t.uz), 5);
  m.solve();
  const lid1 = m.featureOf(b1, "extrude");
  const circle = m.entities.get(lid1.twins[0][0])!;
  assert.equal(circle.kind, "circle");
  const b2 = extrude(m, circleOn(m, circle.name, p.t.at(50, 30, T + 5), 4, p.t.uz), 3);
  m.solve();
  const centre = m.coords((m.entities.get(m.featureOf(b2).loops[0][0] as string) as { center: string }).center);
  // Now cut the first boss's lid away entirely: a disc wider than the boss,
  // down from where its lid is — the disc alone, not the loops inside it,
  // which a typed member would take as holes (explicit regions).
  const disc = circleOn(m, circle.name, p.t.at(50, 30, T + 5), 12, p.t.uz);
  const cut = extrude(m, disc, -2, circle.name, [[disc]], null, { mode: "cut" });
  m.solve();
  const bodies = await settledBodies(m);
  const names = new Set(bodies.views()[0].result.solid!.faces.map((f) => f.name));
  assert.ok(!names.has(`${b1}.lid`), "the face the second boss was sketched on is gone");
  assert.deepEqual(bodies.report().lines, [`${b2} is drawn on ${b1}.lid, which ${p.feature} no longer has — it stays where that face was`]);
  // The sketch did not jump: its circle's centre is where it was, on where the lid was.
  const now = m.coords((m.entities.get(m.featureOf(b2).loops[0][0] as string) as { center: string }).center);
  assert.ok(Math.hypot(...now.map((x, i) => x - centre[i])) < 1e-9);
  // And the second boss is a lump of its own now, standing on nothing: still one body, still valid.
  const s = bodies.views()[0].result.solid!;
  assert.equal(s.validity.failures, 0);
  assert.ok(Math.abs(s.volume - (L * W * T + Math.PI * 100 * 3 + Math.PI * 16 * 3)) < 1e-6 * L * W * T);
  assert.ok(names.has(`${cut}.lid`), "the cut's lid is the first boss's top now");
});

test("every body of one feature: the kernel's volume is solids.ts's, for the fixtures and a revolve", { skip }, async () => {
  await loadSolver();
  const files = ["features-v12", "pre-explicit-regions", "curves-v12"];
  let checked = 0;
  for (const f of files) {
    const m = open(await readFile(new URL(`./fixtures/${f}.neocad.json`, import.meta.url), "utf8"));
    m.solve();
    const exact = solidsOf(m);
    const got = await evaluateAll(m);
    for (const b of got) {
      if (!b.solid) continue;
      // solids.ts splits a feature with an island into one body per piece; the kernel makes one solid of it.
      const mine = exact.bodies.filter((x) => x.feature === b.name).reduce((s, x) => s + x.volume, 0);
      assert.ok(Math.abs(b.solid.volume - mine) < 1e-6 * Math.max(1, mine), `${f} ${b.name}: kernel ${b.solid.volume}, solids.ts ${mine}`);
      assert.equal(b.solid.validity.manifold, true, `${f} ${b.name} manifold`);
      checked++;
    }
  }
  const m = new Model(3);
  const p = plate(m);
  const sq = polygon(m, p.t, [[-30, 0], [-20, 0], [-20, 10], [-30, 10]]);
  revolve(m, sq.lines[0], "t.y", Math.PI / 2);
  revolve(m, polygon(m, p.t, [[-60, 0], [-50, 0], [-50, 10], [-60, 10]]).lines[0], "t.y");
  m.solve();
  const exact = solidsOf(m);
  for (const b of await evaluateAll(m)) {
    const mine = exact.bodies.filter((x) => x.feature === b.name).reduce((s, x) => s + x.volume, 0);
    assert.ok(Math.abs(b.solid!.volume - mine) < 1e-6 * mine, `${b.name}: kernel ${b.solid!.volume}, solids.ts ${mine}`);
    checked++;
  }
  assert.ok(checked >= 5, `${checked} bodies checked`);
});

test("an old file opens to the same solids: no feature has a mode, no body is the kernel's, nothing is sent", async () => {
  await loadSolver();
  for (const f of ["features-v12", "pre-explicit-regions", "curves-v12", "flat2d-v12"]) {
    const m = open(await readFile(new URL(`./fixtures/${f}.neocad.json`, import.meta.url), "utf8"));
    assert.ok([...m.features.values()].every((x) => x.mode === undefined), f);
    assert.deepEqual(programOf(m).program.bodies, [], `${f}: every body is one feature, drawn as it always was`);
    const bodies = new Bodies(null, () => {});
    bodies.sync(m);
    assert.deepEqual(bodies.drawn().replaces.size, 0);
  }
});

// The spike's other parts through the app: the owner's part above is the flush
// cut (a hole exactly as deep as the plate, its lid on the plate's base) and the
// side boss; this is the coplanar union, a boss standing on the top.
test("a boss standing on the top: the coplanar union, made through the app", { skip }, async () => {
  await loadSolver();
  const m = new Model(3);
  const p = plate(m);
  const top = p.lid.slice(0, 3).join(".");
  // A boss standing on the top (coplanar union, the classic failure).
  extrude(m, circleOn(m, top, onTop(p, 20, 30), 6, p.t.uz), 4);
  m.solve();
  const r = (await evaluateAll(m)).find((b) => b.name === p.feature)!;
  assert.deepEqual(r.solid!.validity, { manifold: true, failures: 0 });
  assert.ok(Math.abs(r.solid!.volume - (L * W * T + Math.PI * 36 * 4)) < 1e-6 * L * W * T);
  const v: BodyView = { name: r.name, features: [], result: r, faces: bodyFaces(r) };
  assert.ok(v.faces.length > 0);
});
