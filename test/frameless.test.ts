// Frameless curves (docs/plans/frameless-curves.md): a circle or arc carries
// its own normal, one origin is always present, and nothing makes a frame
// unless asked. The claims the spec lists that no older file already holds —
// the tools' in curvetoolplane.test.ts, old files' in oldfiles13.test.ts.

import { test } from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { ensureKernelLoaded } from "../src/kernel/problem.ts";
import { Model, ORIGIN, parsePointTriple, referentsOf } from "../src/model.ts";
import { fix, onPlane } from "../src/relations/basic.ts";
import { angle, arcEndpoints, parallel, perpendicular, radius } from "../src/relations/geometry.ts";
import { del, extrude, fillet, regen, revolve } from "../src/operations.ts";
import { open, save } from "../src/persist.ts";
import { curveFrame } from "../src/curveplane.ts";
import { frameBasis } from "../src/relations/refs.ts";
import { neocadScope } from "../src/replenv.ts";
import { menuFor } from "../src/menu.ts";
import { hitTest } from "../src/picking.ts";
import { worldToScreen } from "../src/view.ts";
import { FRAME_ARM_PX } from "../src/framemarker.ts";
import { tiltedFrame } from "./frames.ts";

async function loadKernel() {
  const bytes = await readFile(new URL("../src/kernel/wasm-gen/neocad_kernel_bg.wasm", import.meta.url));
  await ensureKernelLoaded(bytes);
}

const dot = (a: number[], b: number[]) => a.reduce((s, x, i) => s + x * b[i], 0);
const sub = (a: number[], b: number[]) => a.map((x, i) => x - b[i]);
const near = (a: number[], b: number[], tol = 1e-9) => Math.hypot(...sub(a, b)) <= tol;
const frames = (m: Model) => [...m.entities.values()].filter((e) => e.kind === "frame").map((e) => e.name);

// --- the normal ---------------------------------------------------------------------

test("a circle's normal solves and holds: knocked off a tilted frame's +z, par brings it back, and nothing shrinks it", async () => {
  await loadKernel();
  const m = new Model(3);
  const t = tiltedFrame(m);
  const c = m.addCircle(m.addPoint(t.origin).name, 5, [1, 2, 3]).name;
  const raw = () => m.circle(c).normal!.map((i) => m.problem.getVar(i));
  const before = Math.hypot(...raw());
  parallel(m, c, "t.z");
  assert.equal(m.solve().solved, true);
  assert.ok(Math.abs(Math.abs(dot(m.normalOf(c), t.uz)) - 1) < 1e-9, `faces the frame's +z: ${m.normalOf(c)}`);
  // Its length is a gauge, read normalised and pushed by nothing: the solve
  // turned it without shrinking it (a raw residual would have let it collapse).
  assert.ok(Math.hypot(...raw()) >= before - 1e-9, `length ${Math.hypot(...raw())}, was ${before}`);
  // And holds: the frame turned (its y-ref swung part way up off its plane —
  // not a right angle, where a wedge has no gradient to turn along, for a
  // circle as for a line), the circle follows.
  m.setCoords("t_y", t.at(0, 10, 6));
  assert.equal(m.solve().solved, true);
  const { uz } = frameBasis(m, "t")();
  assert.ok(Math.abs(Math.abs(dot(m.normalOf(c), uz!)) - 1) < 1e-9, `followed the frame: ${m.normalOf(c)}`);
});

test("par, perp and ang read a curve as its normal — dimension-generically in 3D — and a 2D curve, which has none, is refused", async () => {
  await loadKernel();
  const m = new Model(3);
  const a = m.addCircle(m.addPoint([0, 0, 0]).name, 3, [0, 0, 1]).name;
  const b = m.addCircle(m.addPoint([20, 0, 0]).name, 3, [0, 0.3, 1]).name;
  const l = m.addLine(m.addPoint([0, 0, 0]).name, m.addPoint([10, 0, 0]).name).name;
  for (const p of m.line(l).refs) fix(m, p, m.coords(p));
  parallel(m, a, "origin.z");
  perpendicular(m, b, l); // the line lies in b's plane: b's normal square to it
  angle(m, b, a, Math.PI / 6);
  assert.equal(m.solve().solved, true);
  assert.ok(near(m.normalOf(a), [0, 0, 1]));
  assert.ok(Math.abs(dot(m.normalOf(b), [1, 0, 0])) < 1e-9, "square to the line");
  assert.ok(Math.abs(Math.abs(dot(m.normalOf(b), m.normalOf(a))) - Math.cos(Math.PI / 6)) < 1e-9, "30° from a's");
  const flat = new Model(2);
  const c = flat.addCircle(flat.addPoint([0, 0]).name, 3).name;
  const l2 = flat.addLine().name;
  assert.throws(() => parallel(flat, c, l2), /lies in the one plane a 2D model has/);
});

test("an arc's sweep is about its own normal, from its own start: on a tilted plane, flipping the normal draws the complement", () => {
  const m = new Model(3);
  const t = tiltedFrame(m);
  const [c, s, e] = [t.at(0, 0), t.at(10, 0), t.at(0, 10)].map((p) => m.addPoint(p).name);
  const up = m.addArc(c, s, e, 10, t.uz).name;
  const down = m.addArc(c, s, e, 10, t.uz.map((x) => -x)).name;
  const [fu, fd] = [curveFrame(m, m.arc(up))!, curveFrame(m, m.arc(down))!];
  assert.ok(Math.abs(fu.sweep - Math.PI / 2) < 1e-9, `a quarter about +z: ${fu.sweep}`);
  assert.ok(Math.abs(fd.sweep - (3 * Math.PI) / 2) < 1e-9, `three quarters about −z: ${fd.sweep}`);
  assert.ok(near(fu.u, t.ux, 1e-12) && near(fd.u, t.ux, 1e-12), "both measured from the start, no reference axis");
});

test("arcends in 3D keeps a free arc's ends on its rim and in its plane — and the arc turns to meet them", async () => {
  await loadKernel();
  const m = new Model(3);
  const [c, s, e] = [[0, 0, 0], [10, 0, 0], [0, 6, 8]].map((p) => m.addPoint(p).name);
  for (const p of [c, s, e]) fix(m, p, m.coords(p));
  const a = m.addArc(c, s, e, null, [0, 0, 1]).name; // seeded flat, its end up off that plane
  arcEndpoints(m, a);
  assert.equal(m.solve().solved, true);
  const n = m.normalOf(a);
  assert.ok(Math.abs(dot(n, [10, 0, 0])) < 1e-6 && Math.abs(dot(n, [0, 6, 8])) < 1e-6, `stood up into its ends' plane: ${n}`);
  assert.ok(Math.abs(m.radius(a) - 10) < 1e-6);
});

// --- the origin ---------------------------------------------------------------------

test("the origin exists in every model that holds frames, is referable as a frame, and is no entity, never journalled", () => {
  for (const dim of [2, 3]) {
    const m = new Model(dim);
    assert.equal(m.isFrame(ORIGIN), true);
    assert.equal(m.has(ORIGIN), true, "its name is taken");
    assert.equal(m.entities.has(ORIGIN), false, "and is no entity");
    assert.deepEqual(m.frameNames(), [ORIGIN]);
    assert.equal(m.resolveFrame(), ORIGIN);
    assert.deepEqual(m.journal, [], "nothing journalled for it");
    assert.throws(() => m.addPoint(null, ORIGIN), /"origin" already exists/);
  }
  assert.equal(new Model(4).isFrame(ORIGIN), false, "no frames in 4D, so no origin");
});

test("the origin cannot be deleted — by the primitive or by del — and the menu offers no Delete on it", () => {
  const m = new Model(3);
  assert.throws(() => m.deleteEntity(ORIGIN), /the origin is part of every model/);
  assert.throws(() => del(m, ORIGIN));
  const menu = menuFor(m, { name: ORIGIN, kind: "frame", distance: 0, axis: "z" });
  assert.ok(!menu.items.some((i) => i.label === "Delete"), menu.items.map((i) => i.label).join(", "));
  assert.ok(menu.items.some((i) => i.label === "Sketch on this"));
});

test("the origin is drawn and picked as a frame: its +z arm is what a revolve about origin.z clicks", () => {
  const m = new Model(3);
  // Looking along −y at the x–z plane: the origin's +z arm runs up the screen.
  const view = { ox: 400, oy: 300, scale: 3, right: [1, 0, 0], up: [0, 0, 1], target: [0, 0, 0] };
  const [ox, oy] = worldToScreen(view, [0, 0, 0]);
  const hit = hitTest(m, view, ox, oy - FRAME_ARM_PX * 0.6);
  assert.equal(hit?.name, ORIGIN);
  assert.equal(hit?.axis, "z");
});

test("an origin point: fix and onplane against the origin, journalled by its name, reopen as they were", async () => {
  await loadKernel();
  const m = new Model(3);
  const p = m.addPoint([3, 4, 5]).name;
  fix(m, p, [1, 2, 0], ORIGIN);
  const q = m.addPoint([7, 7, 7]).name;
  onPlane(m, q);
  assert.equal(m.solve().solved, true);
  assert.ok(near(m.coords(p), [1, 2, 0], 1e-6));
  assert.ok(Math.abs(m.coords(q)[2]) < 1e-6, "on the origin's x–y plane, the drawing plane with nothing chosen");
  const text = save(m);
  assert.equal(save(open(text)), text);
  assert.deepEqual(open(text).relationOf("r2").args, [q, "origin"]);
});

// --- plane references and the work plane ---------------------------------------------

test("a plane through three points is one string, \"p1.p2.p3\": parsed, and its points seen by the cascade", () => {
  assert.deepEqual(parsePointTriple("p1.p2.p3"), ["p1", "p2", "p3"]);
  assert.equal(parsePointTriple("f1.x"), null, "an axis has one dot");
  assert.equal(parsePointTriple("p1"), null);
  assert.deepEqual(referentsOf("p1.p2.p3"), ["p1", "p2", "p3"]);
  assert.deepEqual(referentsOf("f1.z"), ["f1"]);
  const m = new Model(3);
  const [a, b, c] = [[0, 0, 5], [10, 0, 5], [0, 10, 5]].map((p) => m.addPoint(p).name);
  const q = m.addPoint([3, 3, 0]).name;
  const r = onPlane(m, q, `${a}.${b}.${c}`);
  assert.deepEqual(m.relationsNaming(b).map((x) => x.name), [r]);
  const gone = del(m, b);
  assert.ok(gone.includes(r), "deleting one of the face's points takes what was held to it");
  assert.throws(() => m.planeKind(`${a}.${a}.${c}`), /names a point twice/);
  assert.throws(() => m.planeKind("nope"), /is not a plane/);
});

test("the work plane: set to a face, journalled, drawn on, cleared by setDefaultFrame and by deleting what it names — and it round-trips", async () => {
  await loadKernel();
  const m = new Model(3);
  const [a, b, c] = [[0, 0, 5], [10, 0, 5], [0, 10, 5]].map((p) => m.addPoint(p).name);
  const face = `${a}.${b}.${c}`;
  m.setWorkPlane(face);
  assert.equal(m.drawingPlane(), face);
  const circle = m.addCircle(m.addPoint([2, 2, 5]).name, 1).name;
  assert.ok(near(m.normalOf(circle), [0, 0, 1]), "a circle typed bare faces the work plane");
  const text = save(m);
  assert.equal(open(text).workPlane, face);
  assert.equal(save(open(text)), text);
  m.setDefaultFrame(ORIGIN);
  assert.equal(m.workPlane, null, "choosing a frame clears it");
  assert.equal(m.defaultFrame, null, "and the origin is no default: it is what none means");
  m.setWorkPlane(face);
  del(m, a);
  assert.equal(m.workPlane, null, "a face whose point went is no plane to draw on");
  assert.deepEqual(m.journal.filter((j) => j.op === "setWorkPlane").at(-1)!.args, [null], "and the clearing is journalled");
  assert.throws(() => new Model(2).setWorkPlane(ORIGIN), /one plane already/);
});

test("workplane() at the command line: sets, reports and clears; the sketch flow without a frame", async () => {
  await loadKernel();
  const m = new Model(3);
  const s = neocadScope({ model: m }) as Record<string, (...a: unknown[]) => unknown>;
  assert.equal(s.workplane(), ORIGIN, "nothing chosen: the origin's plane");
  const c = s.circ(s.pt(0, 0, 4), 6, [0, 1, 0]) as string;
  assert.equal(s.workplane(c), c);
  assert.equal(m.drawingPlane(), c);
  assert.equal(s.workplane(null), ORIGIN);
  assert.deepEqual(frames(m), []);
});

// --- features of frameless profiles --------------------------------------------------

test("extrude, fillet and regeneration of a frameless profile make no frame, and the lid stays its base moved", async () => {
  await loadKernel();
  const m = new Model(3);
  const pts = [[0, 0, 0], [40, 0, 0], [40, 30, 0], [0, 30, 0]].map((p) => m.addPoint(p).name);
  const ls = pts.map((p, i) => m.addLine(p, pts[(i + 1) % 4]).name);
  const e = extrude(m, ls[0], 10);
  const arc = fillet(m, ls[1], ls[2], 5);
  assert.equal(m.solve().solved, true);
  const f = m.featureOf(e, "extrude");
  assert.equal(f.frame, ORIGIN);
  assert.deepEqual(f.loops[0], [ls[0], ls[1], arc, ls[2], ls[3]], "regenerated by the fillet");
  regen(m, e);
  assert.equal(m.solve().solved, true);
  const twin = f.twins[0][2];
  assert.ok(near(m.normalOf(twin), m.normalOf(arc), 1e-12), "the twin arc faces as its base");
  assert.deepEqual(frames(m), []);
  // A partial revolve of a frameless profile makes no end frame either.
  const n = new Model(3);
  const q = [[10, 0, 0], [20, 0, 0], [20, 10, 0], [10, 10, 0]].map((p) => n.addPoint(p).name);
  const ql = q.map((p, i) => n.addLine(p, q[(i + 1) % 4]).name);
  fillet(n, ql[1], ql[2], 3);
  const r = revolve(n, ql[0], "origin.y", 0.5);
  assert.equal(n.featureOf(r, "revolve").end, null);
  assert.deepEqual(frames(n), []);
  assert.equal(n.solve().solved, true);
  const text = save(m);
  assert.equal(save(open(text)), text);
});

test("a radius on a held circle and a free one: rad reads only the radius, so neither turns", async () => {
  await loadKernel();
  const m = new Model(3);
  const c = m.addCircle(m.addPoint([0, 0, 0]).name, 3, [0.3, 0, 1]).name;
  radius(m, c, 7);
  const was = m.normalOf(c);
  assert.equal(m.solve().solved, true);
  assert.ok(near(m.normalOf(c), was), "nothing read its normal, so nothing moved it");
});

test("sketched on a cylinder's base, a boss comes out at the viewer: the rim's plane faces up into the solid, so the loop's own is used", async () => {
  await loadKernel();
  const { orientingPlane } = await import("../src/operations.ts");
  const { findLoops } = await import("../src/loops.ts");
  const m = new Model(3);
  const base = m.addCircle(m.addPoint([0, 0, 0]).name, 10, [0, 0, 1]).name;
  extrude(m, base, 20);
  assert.equal(m.solve().solved, true);
  // Seen from below, the base face is the rim `base`, which cannot be turned
  // over (sketchface.ts): the work plane faces +z, into the cylinder.
  m.setWorkPlane(base);
  const centre = m.addPoint([2, 1, 0]).name;
  onPlane(m, centre, base);
  const boss = m.addCircle(centre, 3, [0, 0, -1]).name; // the tool seeds it facing the viewer
  parallel(m, boss, base);
  assert.equal(m.solve().solved, true);
  const below = [0, 0, -1];
  const loop = findLoops(m).find((l) => l.members.length === 1 && l.members[0].name === boss)!;
  const plane = orientingPlane(m, loop, below);
  assert.equal(plane, boss, "not the rim, which faces away: the boss's own plane, which faces the viewer");
  const e = extrude(m, boss, 5, plane);
  assert.equal(m.solve().solved, true);
  const twin = m.featureOf(e, "extrude").twins[0][0];
  const lid = m.coords(m.circle(twin).center);
  assert.ok(near(lid, [2, 1, -5], 1e-6), `out of the base, not into the solid: ${lid}`);
  // Seen from above, the same rim faces the viewer and is kept.
  assert.equal(orientingPlane(m, loop, [0, 0, 1]), base, "a curve plane that faces the viewer is the drawing plane, as ever");
  assert.deepEqual(frames(m), []);
});

test("an old file that already called something \"origin\" opens with it renamed — everywhere it is named — and re-saves as the current format", async () => {
  await loadKernel();
  const file = JSON.stringify({
    format: "neocad-model", version: 12, dim: 3,
    journal: [
      { op: "addPoint", args: [[1, 2, 0], "origin"] },
      { op: "addPoint", args: [[5, 2, 0], "p2"] },
      { op: "addPoint", args: [[1, 6, 0], "p3"] },
      { op: "addLine", args: ["origin", "p2", "l1"] },
      { op: "addFrame", args: ["origin", "p2", "p3", "f1"] },
      { op: "onPlane", args: ["p3", "f1"] },
      { op: "parallel", args: ["l1", "f1.x"] },
    ],
    values: { points: { origin: [1, 2, 0], p2: [5, 2, 0], p3: [1, 6, 0] }, radii: {} },
  });
  const m = open(file);
  assert.ok(m.isFrame(ORIGIN) && !m.entities.has(ORIGIN), "the built-in is the built-in");
  assert.equal(m.entities.get("origin2")?.kind, "point", "the file's own is origin2");
  assert.deepEqual(m.coords("origin2"), [1, 2, 0]);
  assert.deepEqual(m.line("l1").refs, ["origin2", "p2"]);
  assert.equal(m.frame("f1").origin, "origin2");
  assert.equal(m.solve().solved, true);
  const text = save(m);
  assert.equal(JSON.parse(text).version, 16);
  assert.equal(save(open(text)), text);
});

test("xaxis() means the work plane's when the work plane is a frame — else the default's, else the origin's", async () => {
  await loadKernel();
  const m = new Model(3);
  const scope = neocadScope({ model: m }) as Record<string, (...x: unknown[]) => unknown>;
  assert.equal(scope.xaxis(), "origin.x");
  const f1 = m.addFrame().name;
  const f2 = m.addFrame().name;
  m.setDefaultFrame(f1);
  assert.equal(scope.xaxis(), `${f1}.x`);
  m.setWorkPlane(f2);
  assert.equal(scope.xaxis(), `${f2}.x`, "a frame work plane is the one meant");
  const g = m.frame(f2);
  m.setWorkPlane(`${g.origin}.${g.xref}.${g.yref}`);
  assert.equal(scope.xaxis(), `${f1}.x`, "three points name no x: the default's");
  assert.equal(scope.xaxis(f2), `${f2}.x`, "and a frame named is that frame");
});
