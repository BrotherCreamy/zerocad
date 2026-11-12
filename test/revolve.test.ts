// Revolve: a closed profile turned about an axis in its plane — the profile
// left as it was, the axis read as a datum, one angle dimension, and for a
// partial turn an end face of real twins.
//
// Closed forms throughout, as extrude.test.ts does it and for its reason:
// "it solved" is what an end face in the wrong place also reports. Every twin
// is checked against its base turned about the axis by Rodrigues' formula
// written out here — not the module's matrix — and the sketch is on a frame
// tipped off every kernel axis (`tiltedFrame`), so an axis that is secretly
// the kernel's y cannot pass. `set` is checked to swing exactly the end face
// by exactly the new angle, and nothing else by anything at all.
//
// Read the replay case near the end first if you read one: a profile seeded
// across its own axis, fixed off it, reopens — the geometric refusals are the
// call's, never the replay's.

import { test } from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { ensureKernelLoaded } from "../src/kernel/problem.ts";
import { Model } from "../src/model.ts";
import { coincident, dist, fix, onPlane } from "../src/relations/basic.ts";
import { parallel, perpendicular } from "../src/relations/geometry.ts";
import { revolution } from "../src/relations/revolution.ts";
import { checkRevolve, del, extrude, fillet, hole as holeOp, revolve, revolveProfile, set, standsFor } from "../src/operations.ts";
import { open, save } from "../src/persist.ts";
import { neocadScope } from "../src/replenv.ts";
import { describePick } from "../src/picking.ts";
import { placeGlyphs } from "../src/glyphs.ts";
import { curveFrame } from "../src/curveplane.ts";
import { arcSamples } from "../src/arcgeom.ts";
import { worldToScreen } from "../src/view.ts";
import { axisFrame, tiltedFrame, type TiltedFrame } from "./frames.ts";
import { baseOf, polygon, ring } from "./profiles.ts";

async function loadKernel() {
  const bytes = await readFile(new URL("../src/kernel/wasm-gen/neocad_kernel_bg.wasm", import.meta.url));
  await ensureKernelLoaded(bytes);
}

const dot = (a: number[], b: number[]) => a.reduce((s, x, i) => s + x * b[i], 0);
const sub = (a: number[], b: number[]) => a.map((x, i) => x - b[i]);
const cross = (a: number[], b: number[]) => [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]];
const near = (a: number[], b: number[], tol = 1e-9) => Math.hypot(...sub(a, b)) <= tol;

/** `p` turned through `a` about the line through `o` along unit `k` — Rodrigues', written out. */
function turn(p: number[], o: number[], k: number[], a: number): number[] {
  const v = sub(p, o);
  const [c, s] = [Math.cos(a), Math.sin(a)];
  const kxv = cross(k, v);
  const kv = dot(k, v);
  return o.map((oi, i) => oi + v[i] * c + kxv[i] * s + k[i] * kv * (1 - c));
}

/** Turned about the tilted frame's own +y, through its origin: the axis most of this file uses. */
const aboutY = (t: TiltedFrame, p: number[], a: number) => turn(p, t.origin, t.uy, a);

/** Every point twin of a feature's angle is its base turned through `a` by `about`. */
function endAt(m: Model, angle: string, a: number, about: (p: number[], a: number) => number[], tol = 1e-9): void {
  for (const [twin, base] of baseOf(m, angle)) {
    const [te, be] = [m.entities.get(twin)!, m.entities.get(base)!];
    if (te.kind === "point") assert.ok(near(m.coords(twin), about(m.coords(base), a), tol), `${twin} is ${base} turned`);
    if (te.kind === "frame" && be.kind === "frame") {
      const [tp, bp] = [m.refsOf(te), m.refsOf(be)];
      tp.forEach((p, i) => assert.ok(near(m.coords(p), about(m.coords(bp[i]), a), tol), `${p} is ${bp[i]} turned`));
    }
  }
}

/** A rectangle to one side of the frame's +y axis: u from 10 to 30, v from 0 to 20. */
const BLOCK: [number, number][] = [[10, 0], [30, 0], [30, 20], [10, 20]];
const QUARTER = Math.PI / 2;

// --- the expansion ---------------------------------------------------------------

test("a partial revolve: a twin of every corner and edge, no frame, one angle dimension, one feature — each twin its base turned about the tilted frame's +y", async () => {
  await loadKernel();
  const m = new Model(3);
  const t = tiltedFrame(m);
  const { points, lines } = polygon(m, t, BLOCK);
  const [ents, rels] = [m.entities.size, m.relations.size];

  assert.equal(revolve(m, lines[0], "t.y", QUARTER), "e1");
  const f = m.featureOf("e1", "revolve");
  // Four corner twins and four twin edges — and no end frame since format 13:
  // a twin curve carries its own normal (docs/plans/frameless-curves.md).
  assert.equal(m.entities.size - ents, 4 + 4);
  assert.equal(m.relations.size - rels, 1, "one relation: the angle");
  assert.equal(f.angle, "d1", "a dimension, d-named");
  assert.equal(m.relationOf("d1").op, "revolution");
  assert.equal(f.axis, "t.y");
  assert.equal(f.frame, "t");
  assert.deepEqual(f.loops, [lines]);
  assert.deepEqual(f.twins[0].map((n) => m.entities.get(n)?.kind), ["line", "line", "line", "line"]);
  assert.equal(f.end, null, "no end frame");
  // Built on the profile, its frame and the axis's frame; owns none of them.
  for (const n of [...lines, "t"]) {
    assert.ok(f.names.includes(n), n);
    assert.ok(!f.owns.includes(n), `${n} is the sketch's, not the feature's`);
  }
  assert.equal(new Set(f.names).size, f.names.length, "each name once — the axis's frame is the sketch's here");

  // Four corner pairs; every twin where the turn puts it.
  const bases = baseOf(m, "d1");
  assert.equal(bases.size, 4);
  for (const p of points) assert.ok([...bases.values()].includes(p), `${p} has a twin`);
  endAt(m, "d1", QUARTER, (p, a) => aboutY(t, p, a));
  // A twin edge joins the twins of its base edge's ends, in the same direction.
  f.twins[0].forEach((tw, i) => {
    const [a, b] = m.line(tw).refs;
    assert.deepEqual([bases.get(a), bases.get(b)], m.line(lines[i]).refs);
  });

  assert.equal(m.solve().solved, true);
  assert.ok(m.solve().iterations <= 1, "seeded exactly where the angle holds it");
  // Journalled as the one call, with the profile resolved.
  // On the region made for it on the way (regions-as-operations.md).
  assert.deepEqual(m.journal.at(-2), { op: "region", args: [lines[0], "t", lines] });
  assert.deepEqual(m.journal.at(-1), { op: "revolve", args: ["rg1", "t.y", QUARTER, "t", [lines]] });
});

test("a full revolve makes nothing: one dimension holding its profile on the axis's plane, a whole turn — and that is what no angle means", async () => {
  await loadKernel();
  const m = new Model(3);
  const t = tiltedFrame(m);
  const { points, lines } = polygon(m, t, BLOCK);
  const ents = m.entities.size;
  const f = m.featureOf(revolve(m, lines[0], "t.y"), "revolve");
  assert.equal(m.entities.size, ents, "no twins, no end frame");
  assert.deepEqual(f.twins, []);
  assert.equal(f.end, null);
  assert.deepEqual(f.owns, [f.angle]);
  const r = m.relationOf(f.angle);
  assert.equal(r.op, "revolution");
  // Until profiles-held.md it held nothing, and its args were the axis and the
  // angle alone. Now it names its profile, each point paired with itself (a
  // whole turn takes each onto itself), and holds those points in the plane
  // through the axis: one row a point but the farthest from the axis.
  assert.equal(r.args[0], "t.y");
  assert.equal(r.args[1], 2 * Math.PI);
  const named = r.args.slice(2) as string[];
  for (let i = 0; i < named.length; i += 2) assert.equal(named[i], named[i + 1], "each paired with itself");
  assert.deepEqual(new Set(named), new Set(points), "the profile's corners");
  assert.equal(r.blocks.length, points.length - 1, "the profile held on the axis's plane, nothing twinned");
  assert.deepEqual(m.journal.at(-1), { op: "revolve", args: ["rg1", "t.y", 2 * Math.PI, "t", [lines]] });
  // The other way round is a whole turn too.
  assert.equal(m.featureOf(revolve(m, lines[0], "t.y", -2 * Math.PI), "revolve").end, null);
  assert.equal(m.solve().solved, true);
});

test("a filleted profile: the arc's twin faces as its base does, turned — the same arc, the same radius and sweep, before and after a set", async () => {
  await loadKernel();
  const m = new Model(3);
  const t = tiltedFrame(m);
  const { lines } = polygon(m, t, BLOCK);
  const arc = fillet(m, lines[1], lines[2], 6);
  assert.equal(m.solve().solved, true);
  const f = m.featureOf(revolve(m, lines[0], "t.y", 1.2), "revolve");
  assert.deepEqual([...(f.loops[0] as string[])].sort(), [lines[0], standsFor(m, lines[1]), arc, standsFor(m, lines[2]), lines[3]].sort());
  const [base, twin] = [m.arc(arc), m.arc(f.twins[0][f.loops[0].indexOf(arc)])];
  const turned = (n: number[], a: number) => turn(n, [0, 0, 0], t.uy, a);
  assert.ok(near(m.normalOf(twin.name), turned(m.normalOf(arc), 1.2), 1e-9), "its normal is its base's turned");
  assert.ok(Math.abs(m.radius(twin.name) - m.radius(arc)) < 1e-12);
  assert.ok(m.relationOf(f.angle).args.includes(arc), "the radius is one of the angle's pairs");
  assert.equal(m.solve().solved, true);

  for (const a of [1.2, 4]) {
    if (a !== 1.2) { set(m, `${f.angle}.value`, a); assert.equal(m.solve().solved, true); }
    const [cb, ct] = [curveFrame(m, base)!, curveFrame(m, twin)!];
    assert.ok(near(m.normalOf(twin.name), turned(m.normalOf(arc), a), 1e-6), `held turned at ${a}`);
    assert.ok(Math.abs(cb.sweep - ct.sweep) < 1e-6 && cb.sweep < Math.PI, `the short arc both times: ${cb.sweep}, ${ct.sweep}`);
    const [sb, st] = [arcSamples(cb, 16), arcSamples(ct, 16)];
    sb.forEach((p, i) => assert.ok(near(st[i], aboutY(t, p, a), 1e-6), `sample ${i} at ${a}`));
  }
});

test("a circle turned partway — the end of a torus — is a twin circle facing its base turned; a whole turn of it makes nothing", async () => {
  await loadKernel();
  const m = new Model(3);
  const t = tiltedFrame(m);
  const c = ring(m, t, 25, 10, 6);
  const ents = m.entities.size;
  const f = m.featureOf(revolve(m, c, "t.y", 2), "revolve");
  // One centre twin and the twin circle — no end frame.
  assert.equal(m.entities.size - ents, 1 + 1);
  const twin = m.circle(f.twins[0][0]);
  assert.ok(near(m.normalOf(twin.name), turn(m.normalOf(c), [0, 0, 0], t.uy, 2)), "facing its base turned");
  assert.ok(near(m.coords(twin.center), aboutY(t, m.coords(m.circle(c).center), 2)));
  assert.equal(m.featureOf(revolve(m, c, "t.y"), "revolve").twins.length, 0);
});

test("a hole comes with the region: its twin too, and a hole's island — each said by a region step", async () => {
  await loadKernel();
  const m = new Model(3);
  const t = tiltedFrame(m);
  const { lines } = polygon(m, t, [[10, 0], [50, 0], [50, 40], [10, 40]]);
  const hole = ring(m, t, 30, 20, 10);
  const island = m.addCircle(m.circle(hole).center, 4, t.name).name;
  const e = revolve(m, lines[0], "t.y", 3);
  assert.deepEqual(m.featureOf(e).loops, [lines], "a loop inside is no hole until an operation names it");
  holeOp(m, e, hole);
  holeOp(m, e, island);
  const f = m.featureOf(e, "revolve");
  assert.deepEqual(f.loops, [lines, [hole], [island]]);
  assert.equal(f.twins.length, 3);
  assert.equal(m.circle(f.twins[2][0]).center, m.circle(f.twins[1][0]).center, "one shared centre, one shared twin");
  endAt(m, f.angle, 3, (p, a) => aboutY(t, p, a));
  assert.match(describePick(m, { name: lines[0], kind: "line", distance: 0 }), /·\s+e1$/);
});

test("an arc facing the other way from the sketch turns the same way: its twin's normal is its own turned", async () => {
  await loadKernel();
  const m = new Model(3);
  const t = tiltedFrame(m);
  // Before format 13 an arc on a second, upside-down frame needed that frame
  // turned too, so its twin turned the same way. An arc carries its own normal
  // now, and the angle holds its twin's at that normal turned.
  const { lines } = polygon(m, t, BLOCK);
  const arc = fillet(m, lines[1], lines[2], 6, t.uz.map((x) => -x));
  assert.ok(near(m.normalOf(arc), t.uz.map((x) => -x)), "the arc faces −z of the sketch");
  assert.equal(m.solve().solved, true);
  const f = m.featureOf(revolve(m, lines[0], "t.y", 1), "revolve");
  const twin = m.arc(f.twins[0][2]);
  assert.ok(near(m.normalOf(twin.name), turn(m.normalOf(arc), [0, 0, 0], t.uy, 1), 1e-9));
  endAt(m, f.angle, 1, (p, a) => aboutY(t, p, a));
  const [cb, ct] = [curveFrame(m, m.arc(arc))!, curveFrame(m, twin)!];
  assert.ok(Math.abs(cb.sweep - ct.sweep) < 1e-9 && cb.sweep < Math.PI, "the same short arc");
});

// --- set ------------------------------------------------------------------------------

test("set swings the end face to exactly the new angle and moves nothing else at all", async () => {
  await loadKernel();
  const m = new Model(3);
  const t = tiltedFrame(m);
  // Fully defined — every corner fixed in the frame — so "nothing else moves"
  // is exact rather than true up to the sketch's own freedom (extrude's lesson).
  const corners = BLOCK.map(([u, v]) => m.addPoint(t.at(u, v)).name);
  const lines = corners.map((p, i) => m.addLine(p, corners[(i + 1) % 4]).name);
  corners.forEach((p, i) => fix(m, p, [...BLOCK[i], 0], t.name));
  assert.equal(m.solve().solved, true);
  const f = m.featureOf(revolve(m, lines[0], "t.y", QUARTER), "revolve");
  assert.equal(m.solve().solved, true);

  const points = [...m.entities.values()].filter((e) => e.kind === "point").map((e) => e.name);
  const was = new Map(points.map((p) => [p, m.coords(p)]));
  const theta = (200 * Math.PI) / 180;
  assert.equal(set(m, `${f.angle}.value`, theta), f.angle, "the same name, edited in place");
  assert.equal(m.solve().solved, true);
  const end = new Set(f.owns);
  for (const p of points) {
    if (!end.has(p)) assert.ok(near(m.coords(p), was.get(p)!), `${p} did not move`);
  }
  endAt(m, f.angle, theta, (p, a) => aboutY(t, p, a));
  assert.deepEqual(m.journal.at(-1), { op: "set", args: [`${f.angle}.value`, theta] });

  // A refused value leaves the old one standing; a whole turn is refused with
  // why; a negative angle turns the other way.
  assert.throws(() => set(m, `${f.angle}.value`, 0), /non-zero angle in radians/);
  assert.throws(() => set(m, `${f.angle}.value`, 2 * Math.PI), /cannot be turned all the way round onto its start/);
  assert.throws(() => set(m, `${f.angle}.value`, 7), /at most a whole turn/);
  assert.throws(() => set(m, `${f.angle}.value`, "90" as never), /set needs a number of radians \(the label reads degrees/);
  assert.equal(m.relationOf(f.angle).args[1], theta);
  set(m, `${f.angle}.value`, -1);
  assert.equal(m.solve().solved, true);
  endAt(m, f.angle, -1, (p, a) => aboutY(t, p, a));
});

test("set on a free profile's revolve swings the end face alone: the profile stays where it was and as long as it was", async () => {
  // The drawing of test/e2e/revolve.e2e.ts: a rectangle as the rectangle tool
  // leaves one — on a plane, a right angle at every corner, fixed nowhere —
  // with a corner filleted, revolved 270° about the frame's +y, and its angle
  // then set to 180°. The swing is a quarter turn, which no straight step
  // makes: a solve left to find it shares it between the end face and the
  // profile. Measured before the end was seated (`seatTurned`): the profile
  // slid 0.2 and its base edge came out 17.81 long for 18 while the sketch's
  // direction rows were products of its lines' lengths and so twenty times
  // stiffer than the feature's; with those rows turning lines and never
  // scaling them (docs/plans/review-solver.md) it slid 6. Seated, nothing
  // but the end face has anything to do.
  await loadKernel();
  const m = new Model(3);
  const t = tiltedFrame(m);
  const { lines } = polygon(m, t, [[12, 0], [30, 0], [30, 30], [12, 30]]);
  lines.forEach((l, i) => perpendicular(m, l, lines[(i + 1) % 4]));
  const arc = fillet(m, lines[1], lines[2], 7);
  assert.equal(m.solve().solved, true);
  const f = m.featureOf(revolve(m, lines[0], "t.y", 1.5 * Math.PI), "revolve");
  assert.equal(m.solve().solved, true);

  const end = new Set(f.owns);
  const profile = [...m.entities.values()].filter((e) => e.kind === "point" && !end.has(e.name)).map((e) => e.name);
  const was = new Map(profile.map((p) => [p, m.coords(p)]));
  const twinArc = f.twins[0][f.loops[0].indexOf(arc)];
  set(m, `${f.angle}.value`, Math.PI);
  const report = m.solve();
  assert.equal(report.solved, true);
  assert.equal(report.iterations, 0, "seated where the new angle puts it, the solve begins at a root");
  for (const p of profile) assert.ok(near(m.coords(p), was.get(p)!), `${p} of the profile did not move: ${m.coords(p)} from ${was.get(p)}`);
  endAt(m, f.angle, Math.PI, (p, a) => aboutY(t, p, a));
  assert.ok(near(m.normalOf(twinArc), turn(m.normalOf(arc), [0, 0, 0], t.uy, Math.PI)), "and the fillet's twin faces as its base does, turned");

  // The other way round, and a small change: the same.
  for (const a of [-2, 0.3]) {
    set(m, `${f.angle}.value`, a);
    assert.equal(m.solve().solved, true);
    for (const p of profile) assert.ok(near(m.coords(p), was.get(p)!), `${p} of the profile did not move at ${a}`);
    endAt(m, f.angle, a, (q, b) => aboutY(t, q, b));
  }
});

test("set on a full revolve's angle refuses, saying a partial revolve is a new feature — and leaves it as it was", async () => {
  await loadKernel();
  const m = new Model(3);
  const t = tiltedFrame(m);
  const { lines } = polygon(m, t, BLOCK);
  const f = m.featureOf(revolve(m, lines[0], "t.y"), "revolve");
  const journal = m.journal.length;
  assert.throws(() => set(m, `${f.angle}.value`, QUARTER),
    /a full revolve has no end face for an angle to swing — a partial revolve is a new feature, not a new value: del the revolve, then revolve its profile again about t\.y/);
  assert.equal(m.relationOf(f.angle).args[1], 2 * Math.PI);
  assert.equal(m.journal.length, journal, "and journals nothing");
  // Setting it to a whole turn again is no change, and allowed.
  set(m, `${f.angle}.value`, -2 * Math.PI);
});

test("the end face is ordinary geometry: a twin corner held 26 from the profile's inner corner, the free width gives way — and gives way again when the angle is set", async () => {
  await loadKernel();
  // Closed form: two points at radii b and a from the axis, the same height,
  // θ apart about it, are √(a² + b² − 2ab·cos θ) apart; so a = b·cos θ +
  // √(D² − b²·sin² θ). The inner edge is fixed at u = 10 (b), the outer is free.
  const m = new Model(3);
  const t = tiltedFrame(m);
  const { points, lines } = polygon(m, t, BLOCK);
  fix(m, points[0], [10, 0, 0], t.name);
  fix(m, points[3], [10, 20, 0], t.name);
  parallel(m, lines[0], "t.x");
  parallel(m, lines[2], "t.x");
  parallel(m, lines[1], "t.y");
  assert.equal(m.solve().solved, true);
  const f = m.featureOf(revolve(m, lines[0], "t.y", QUARTER), "revolve");
  const twinOf = new Map([...baseOf(m, f.angle)].map(([tw, b]) => [b, tw]));
  dist(m, twinOf.get(points[1])!, points[0], 26);
  assert.equal(m.solve().solved, true);
  const outer = () => dot(sub(m.coords(points[1]), t.origin), t.ux);
  const want = (a: number) => 10 * Math.cos(a) + Math.sqrt(26 ** 2 - 100 * Math.sin(a) ** 2);
  assert.ok(Math.abs(outer() - want(QUARTER)) < 1e-6, `outer edge at ${outer()}, want 24`);
  set(m, `${f.angle}.value`, Math.PI / 3);
  assert.equal(m.solve().solved, true);
  assert.ok(Math.abs(outer() - want(Math.PI / 3)) < 1e-6, `outer edge at ${outer()}, want ${want(Math.PI / 3)}`);
  endAt(m, f.angle, Math.PI / 3, (p, a) => aboutY(t, p, a), 1e-6);
});

// --- the axis ---------------------------------------------------------------------------

test("a frame's axis is a datum: pulling the end face never moves it; a line's is the user's, pushed both ways; moving either carries the end face", async () => {
  await loadKernel();
  // A frame axis: the frame is the sketch's, and nothing of the revolve moves it.
  {
    const m = new Model(3);
    const t = tiltedFrame(m);
    const { lines } = polygon(m, t, BLOCK);
    const f = m.featureOf(revolve(m, lines[0], "t.y", 2), "revolve");
    const frameWas = ["t_o", "t_x", "t_y"].map((n) => m.coords(n));
    const tw = m.line(f.twins[0][1]).refs[0];
    m.setCoords(tw, m.coords(tw).map((c) => c + 7));
    assert.equal(m.solve().solved, true);
    ["t_o", "t_x", "t_y"].forEach((n, i) => assert.ok(near(m.coords(n), frameWas[i], 0), `${n} did not move at all`));
    endAt(m, f.angle, 2, (p, a) => aboutY(t, p, a), 1e-7);
  }
  // A line axis whose ends nothing else holds. Until profiles-held.md it was a
  // datum too and did not move by a bit; now it is the user's line, read as
  // the variables it is (the owner's "bidirectional relationships everywhere
  // by default"), so the pull on the end face may move it — and whatever it
  // does, the end face is the profile turned about where the line now is.
  {
    const m = new Model(3);
    const t = tiltedFrame(m);
    const { lines } = polygon(m, t, BLOCK);
    const ends = [m.addPoint(t.at(0, -5)).name, m.addPoint(t.at(0, 25)).name];
    const axis = m.addLine(ends[0], ends[1]).name;
    const f = m.featureOf(revolve(m, lines[0], axis, 2), "revolve");
    const was = ends.map((p) => m.coords(p));
    const tw = m.line(f.twins[0][1]).refs[0];
    m.setCoords(tw, m.coords(tw).map((c) => c - 5));
    assert.equal(m.solve().solved, true);
    const moved = Math.max(...ends.map((p, i) => Math.hypot(...sub(m.coords(p), was[i]))));
    assert.ok(moved > 1e-6, `the line took part of the pull: ${moved}`);
    {
      const [a, b] = ends.map((p) => m.coords(p));
      const k = sub(b, a).map((c) => c / Math.hypot(...sub(b, a)));
      endAt(m, f.angle, 2, (p, x) => turn(p, a, k, x), 1e-7);
    }

    m.setCoords(ends[1], t.at(-3, 25));
    assert.equal(m.solve().solved, true);
    const [a, b] = ends.map((p) => m.coords(p));
    const k = sub(b, a).map((c) => c / Math.hypot(...sub(b, a)));
    endAt(m, f.angle, 2, (p, x) => turn(p, a, k, x), 1e-7);
  }
});

test("a profile's own edge as the axis — the cylinder case: the edge's ends are their own twins' places, the far corners turn", async () => {
  await loadKernel();
  const m = new Model(3);
  const t = tiltedFrame(m);
  const { points, lines } = polygon(m, t, BLOCK);
  // l4 runs from (10, 20) to (10, 0): on the axis it turns about.
  const f = m.featureOf(revolve(m, lines[0], lines[3], 2.5), "revolve");
  assert.ok(f.names.filter((n) => n === lines[3]).length === 1, "named once, though it is profile and axis both");
  assert.equal(m.solve().solved, true);
  const twinOf = new Map([...baseOf(m, f.angle)].map(([tw, b]) => [b, tw]));
  for (const p of [points[0], points[3]]) assert.ok(near(m.coords(twinOf.get(p)!), m.coords(p)), `${p}'s twin sits on it`);
  const [a, b] = m.line(lines[3]).refs.map((p) => m.coords(p));
  const k = sub(b, a).map((c) => c / Math.hypot(...sub(b, a)));
  endAt(m, f.angle, 2.5, (p, x) => turn(p, a, k, x));

  // Those two corners are the axis, a line the user drew — read as variables
  // since profiles-held.md, where they were a datum: pull one's twin away and
  // the solve splits the pull between twin and corner (the corner held onPlane,
  // so within the sketch), and the twin ends on its corner wherever that is.
  const tw = twinOf.get(points[0])!;
  m.setCoords(tw, m.coords(tw).map((c) => c + 6));
  assert.equal(m.solve().solved, true);
  assert.ok(near(m.coords(tw), m.coords(points[0]), 1e-9), "its twin is on it again");
  const [a2, b2] = m.line(lines[3]).refs.map((p) => m.coords(p));
  const k2 = sub(b2, a2).map((c) => c / Math.hypot(...sub(b2, a2)));
  endAt(m, f.angle, 2.5, (p, x) => turn(p, a2, k2, x), 1e-7);
});

test("touching the axis closes the solid on it: a semicircle on its diameter, a right triangle on a leg — both allowed, their on-axis corners their own twins' places", async () => {
  await loadKernel();
  const m = new Model(3);
  const t = tiltedFrame(m);
  // A semicircle: a diameter on the axis (u = 0, v from −10 to 10), an arc out
  // to u = 10 — counter-clockwise from the bottom about +z.
  const [lo, hi, c] = [m.addPoint(t.at(0, -10)).name, m.addPoint(t.at(0, 10)).name, m.addPoint(t.at(0, 0)).name];
  for (const p of [lo, hi, c]) onPlane(m, p, t.name);
  const diameter = m.addLine(hi, lo).name;
  m.addArc(c, lo, hi, 10, t.name);
  const sphere = m.featureOf(revolve(m, diameter, "t.y"), "revolve");
  assert.equal(sphere.end, null);
  // A right triangle with a leg on the axis.
  const { points, lines } = polygon(m, t, [[0, 30], [12, 30], [0, 50]]);
  const cone = m.featureOf(revolve(m, lines[0], "t.y", 2), "revolve");
  const twinOf = new Map([...baseOf(m, cone.angle)].map(([tw, b]) => [b, tw]));
  assert.ok(near(m.coords(twinOf.get(points[0])!), m.coords(points[0])));
  assert.ok(near(m.coords(twinOf.get(points[2])!), m.coords(points[2])));
  assert.ok(!near(m.coords(twinOf.get(points[1])!), m.coords(points[1]), 1));
  assert.equal(m.solve().solved, true);
});

// --- refusals --------------------------------------------------------------------------

test("refusals name the geometry and leave no trace: an axis leaning out of the plane, one beside it, a profile across it, a rim bulging over it", async () => {
  await loadKernel();
  const m = new Model(3);
  const t = tiltedFrame(m);
  const { lines } = polygon(m, t, BLOCK);
  // An axis parallel to the plane, five off it.
  const beside = m.addLine(m.addPoint(t.at(0, 0, 5)).name, m.addPoint(t.at(0, 10, 5)).name).name;
  // A circle whose centre is clear of t.y but whose rim reaches over it.
  const over = ring(m, t, 8, 60, 10);
  // A D: a line at u = 2 closed by the short arc bulging the other way, to u ≈ −2.1.
  const [d0, d1, dc] = [t.at(2, 80), t.at(2, 100), t.at(12, 90)].map((w) => m.addPoint(w).name);
  const chord = m.addLine(d0, d1).name;
  m.addArc(dc, d1, d0, Math.hypot(10, 10), t.name);
  for (const p of [d0, d1, dc]) onPlane(m, p, t.name);
  assert.equal(m.solve().solved, true);
  const [journal, size] = [m.journal.length, m.entities.size];

  assert.throws(() => revolve(m, lines[0], "t.z"), /the axis t\.z leans 90° out of the plane of the profile l1,l2,l3,l4 \(t's\) — a revolve turns a profile about an axis lying in its own plane/);
  assert.throws(() => revolve(m, lines[0], beside), new RegExp(`the axis ${beside} runs 5 off the plane of the profile l1,l2,l3,l4 \\(t's\\), parallel to it`));
  assert.throws(() => revolve(m, over, "t.y"), /crosses the axis t\.y/);
  assert.throws(() => revolve(m, chord, "t.y"), /crosses the axis t\.y/);
  assert.throws(() => revolve(m, lines[0], "nope"), /"nope" is not a line or a frame axis/);
  assert.throws(() => revolve(m, lines[0], "t_o"), /"t_o" is not a line or a frame axis/);
  assert.throws(() => revolve(m, lines[0], "t.w"), /"t\.w" is not a frame axis/);
  assert.throws(() => revolve(m, lines[0], "t.y", 0), /an angle in radians, more than 0 and at most a whole turn/);
  assert.throws(() => revolve(m, lines[0], "t.y", NaN), /an angle in radians/);
  assert.throws(() => revolve(m, lines[0], "t.y", 7), /at most a whole turn/);
  assert.throws(() => revolve(m, "t_o", "t.y"), /"t_o" is not a line, arc, circle, ellipse or spline — revolve names a member/);
  assert.throws(() => revolve(new Model(2), "l1", "f.y"), /revolve needs a 3D model/);

  assert.equal(m.journal.length, journal, "not a journal entry");
  assert.equal(m.entities.size, size, "not an entity");
  assert.equal(m.features.size, 0);
  assert.equal(revolve(m, lines[0], "t.y", 1), "e1", "and the next name is the first");

  // A line through the middle of a block, its axis: it cuts the block in two
  // (loops.ts). Handed over whole, as a profile drawn before the line was, the
  // block is refused for crossing the axis, as it always was; each half only
  // touches the line it was cut by, and turns about it — measured over its own
  // parts of the edges, not the whole edges that run on across.
  const n = new Model(3);
  const u = tiltedFrame(n);
  const block = polygon(n, u, BLOCK).lines;
  const middle = n.addLine(n.addPoint(u.at(20, -5)).name, n.addPoint(u.at(20, 25)).name).name;
  assert.throws(() => revolve(n, block[0], middle), /"l1" is in 2 loops/);
  assert.throws(() => revolveProfile(n, { frame: u.name, loops: [block] }, middle),
    new RegExp(`the profile l1,l2,l3,l4 crosses the axis ${middle} — turned about it, it would pass through itself`));
  assert.equal(n.features.size, 0);
  assert.equal(revolve(n, block[1], middle), "e1");
});

test("which loop is exactly extrude's question, asked in revolve's words — and after a revolve the profile is still in one loop", async () => {
  await loadKernel();
  const m = new Model(3);
  const t = tiltedFrame(m);
  const { lines } = polygon(m, t, BLOCK);
  // A second block sharing the right-hand edge: that edge is in two loops.
  const q = [m.addPoint(t.at(50, 0)).name, m.addPoint(t.at(50, 20)).name];
  const right = m.line(lines[1]).refs;
  m.addLine(right[0], q[0]); m.addLine(q[0], q[1]); m.addLine(q[1], right[1]);
  assert.throws(() => revolve(m, lines[1], "t.y"), /"l2" is in 2 loops — .* \(revolve\("l2", axis, angle, "f1"\)\), .* with the revolve tool/);
  const open1 = m.addLine(m.addPoint(t.at(0, 60)).name, m.addPoint(t.at(20, 60)).name).name;
  assert.throws(() => revolve(m, open1, "t.y"), /is in no closed loop/);
  // A loop in no frame of the user's: it lies in the origin's plane, and is
  // revolved in it — no frame is made (docs/plans/frameless-curves.md).
  const n = new Model(3);
  const pts = [[10, 0, 0], [20, 0, 0], [20, 10, 0], [10, 10, 0]].map((c) => n.addPoint(c).name);
  const ls = pts.map((p, i) => n.addLine(p, pts[(i + 1) % 4]).name);
  const axis = n.addLine(n.addPoint([0, 0, 0]).name, n.addPoint([0, 10, 0]).name).name;
  assert.equal(n.featureOf(revolve(n, ls[0], axis, 1), "revolve").frame, "origin");
  assert.equal([...n.entities.values()].filter((e) => e.kind === "frame").length, 0);
  // Unlike an extrude, a revolve makes no walls along the profile's edges, so
  // its profile edges are each still in one loop and can be revolved again.
  revolve(m, lines[0], "t.y", 1);
  assert.equal(revolve(m, lines[0], "t.y", 2), "e2");
});

test("a revolve's end face is a loop in the end frame — an extrude takes it", async () => {
  await loadKernel();
  const m = new Model(3);
  const t = tiltedFrame(m);
  const { lines } = polygon(m, t, BLOCK);
  const f = m.featureOf(revolve(m, lines[0], "t.y", 1), "revolve");
  const g = m.featureOf(extrude(m, f.twins[0][0], 4, f.end), "extrude");
  assert.deepEqual(g.loops[0].slice().sort(), f.twins[0].slice().sort());
  assert.equal(m.solve().solved, true);
});

// --- deletion --------------------------------------------------------------------------

// It took the end face until linked profiles (docs/plans/linked-profiles.md,
// item 4: a feature relates, it does not own). The record goes with the
// relation that is the revolve — the angle — and the end face is plain geometry.
test('del("e1") takes the record and the angle, and leaves the sketch and the end face; a full revolve had only its angle', async () => {
  await loadKernel();
  const m = new Model(3);
  const t = tiltedFrame(m);
  const { lines } = polygon(m, t, BLOCK);
  fillet(m, lines[1], lines[2], 5);
  ring(m, t, 22, 10, 3);
  assert.equal(m.solve().solved, true);
  const entities = [...m.entities.keys()];
  const relations = [...m.relations.keys()];
  const coords = new Map(entities.filter((n) => m.entities.get(n)!.kind === "point").map((n) => [n, m.coords(n)]));

  const e = revolve(m, lines[0], "t.y", 2);
  const f = m.featureOf(e, "revolve");
  const journalAt = m.journal.length;
  const made = f.owns.filter((n) => m.entities.has(n));
  assert.ok(made.length > 0, "a partial turn made an end face");
  const removed = del(m, e);
  assert.deepEqual(removed, [e, f.angle], "the record first, then the relation that is it");
  assert.deepEqual([...m.entities.keys()], [...entities, ...made], "the sketch, then the end face — all of it");
  assert.deepEqual([...m.relations.keys()], relations);
  assert.equal(m.solve().solved, true);
  for (const [n, c] of coords) assert.ok(near(m.coords(n), c), `${n} did not move`);
  assert.deepEqual(m.journal.slice(journalAt).map((j) => j.op), ["deleteFeature", "deleteRelation"]);

  const before = [...m.entities.keys()];
  const full = m.featureOf(revolve(m, lines[0], "t.y"), "revolve");
  assert.deepEqual(del(m, full.name), [full.name, full.angle]);
  assert.deepEqual([...m.entities.keys()], before);
});

test("deleting a piece — a profile edge, an end twin, the angle, the axis line — takes the record, and only what needed that piece", async () => {
  await loadKernel();
  const build = () => {
    const m = new Model(3);
    const t = tiltedFrame(m);
    const { lines } = polygon(m, t, BLOCK);
    const axis = m.addLine(m.addPoint(t.at(0, -5)).name, m.addPoint(t.at(0, 25)).name).name;
    const f = m.featureOf(revolve(m, lines[0], axis, 2), "revolve");
    return { m, lines, axis, f };
  };
  // A profile edge: the record goes; the end face and the angle stay, ordinary
  // geometry still held, drawn without faces.
  {
    const { m, lines, f } = build();
    // And the region whose first face it bounded.
    assert.deepEqual(del(m, lines[2]), [f.name, lines[2], "rg1"]);
    for (const n of f.owns) assert.ok(m.has(n), `${n} stayed`);
    assert.equal(m.solve().solved, true);
  }
  // An end twin edge, which nothing but the record names.
  {
    const { m, f } = build();
    assert.deepEqual(del(m, f.twins[0][1]), [f.name, f.twins[0][1]]);
    assert.ok(m.relations.has(f.angle));
  }
  // The angle: deletable like any relation (docs/plans/linked-profiles.md).
  // The record stays and says why it builds nothing; the end face is free.
  {
    const { m, f } = build();
    assert.deepEqual(del(m, f.angle), [f.angle]);
    assert.match(m.featureOf(f.name, "revolve").unbuilt ?? "", /angle .* is deleted/);
    assert.equal(m.solve().solved, true);
  }
  // The axis line: the angle reads it, so the angle goes with it, and the
  // record with both — the end face stays, unheld.
  {
    const { m, axis, f } = build();
    assert.deepEqual(del(m, axis), [f.name, f.angle, axis]);
    assert.ok(f.twins.flat().every((n) => m.entities.has(n)));
  }
  // The primitive refuses to leave a record naming an entity that is gone.
  {
    const { m, f } = build();
    assert.throws(() => m.deleteEntity(f.twins[0][0]), new RegExp(`"${f.twins[0][0]}" is still part of ${f.name}`));
  }
});

// --- the journal -------------------------------------------------------------------------

test("save, open, save is byte-identical with revolves, a set and deletions in the history — and the records come back", async () => {
  await loadKernel();
  const m = new Model(3);
  const t = tiltedFrame(m);
  const { lines } = polygon(m, t, BLOCK);
  fillet(m, lines[1], lines[2], 5);
  ring(m, t, 22, 10, 3);
  m.solve();
  const f = m.featureOf(revolve(m, lines[0], "t.y", 2), "revolve");
  set(m, `${f.angle}.value`, 4);
  m.solve();
  const g = m.featureOf(revolve(m, lines[0], "t.y"), "revolve");
  del(m, g.name);
  const h = m.featureOf(revolve(m, lines[0], "t.y", 1), "revolve");
  del(m, h.twins[0][0]); // only the record, and the edge
  m.solve();

  const once = save(m);
  const reopened = open(once);
  assert.equal(save(reopened), once, "byte for byte");
  assert.deepEqual([...reopened.features.values()], [...m.features.values()]);
  assert.equal(reopened.solve().solved, true);
  assert.ok(once.includes('"revolve"'));
});

test("a profile seeded across its axis, fixed off it, reopens — the geometric refusals are the call's, never the replay's", async () => {
  await loadKernel();
  const m = new Model(3);
  axisFrame(m);
  // Seeded straddling f.y, then fixed into a block clear of it.
  const seeds = [[-10, 0, 0], [10, 0, 0], [10, 20, 0], [-10, 20, 0]];
  const pts = seeds.map((c) => m.addPoint(c).name);
  const ls = pts.map((p, i) => m.addLine(p, pts[(i + 1) % 4]).name);
  BLOCK.forEach(([u, v], i) => fix(m, pts[i], [u, v, 0]));
  assert.equal(m.solve().solved, true);
  const e = revolve(m, ls[0], "f.y", 2);
  m.solve();

  // Where a replay finds the profile before the saved values go back: across the axis.
  const file = JSON.parse(save(m));
  file.journal = file.journal.filter((j: { op: string }) => j.op !== "revolve");
  file.values = { points: {}, radii: {} };
  const atSeeds = open(JSON.stringify(file));
  assert.throws(() => checkRevolve(atSeeds, { frame: "f", loops: [ls] }, "f.y"), /crosses the axis f\.y/,
    "a re-asked refusal would fail the file here");

  const reopened = open(save(m));
  assert.ok(reopened.features.has(e));
  assert.equal(reopened.solve().solved, true);
  assert.equal(save(reopened), save(m));
});

test("coin-joined corners, as the line tool joins them, get one twin each and the end face is a loop", async () => {
  await loadKernel();
  const m = new Model(3);
  const t = tiltedFrame(m);
  const ls = BLOCK.map((a, i) => {
    const b = BLOCK[(i + 1) % 4];
    const l = m.addLine(m.addPoint(t.at(...a)).name, m.addPoint(t.at(...b)).name);
    for (const p of l.refs) onPlane(m, p, t.name);
    return l;
  });
  ls.forEach((l, i) => coincident(m, l.refs[1], ls[(i + 1) % 4].refs[0]));
  const f = m.featureOf(revolve(m, ls[0].name, "t.y", 1), "revolve");
  assert.equal(baseOf(m, f.angle).size, 4, "a twin per corner, not per point");
  const g = m.featureOf(extrude(m, f.twins[0][0], 3, f.end), "extrude");
  assert.equal(g.loops[0].length, 4);
  assert.equal(m.solve().solved, true);
});

// --- the surface ---------------------------------------------------------------------------

test("the command line: revolve returns the feature, ls() lists it in degrees, rels() and the hover tag give the radians a set takes", async () => {
  await loadKernel();
  const m = new Model(3);
  const t = tiltedFrame(m);
  const { lines } = polygon(m, t, BLOCK);
  const scope = neocadScope({ model: m });
  const rev = scope.revolve as (member: string, axis: string, angle?: number) => string;
  const yaxis = scope.yaxis as () => string;
  assert.equal(rev(lines[0], yaxis(), QUARTER), "e1");
  const f = m.featureOf("e1", "revolve");
  const ls = (scope.ls as () => string[])();
  // The feature's line, then what it made as a count under it (quiet-geometry.md).
  assert.equal(ls.at(-2), "e1  revolve of l1,l2,l3,l4, angle d1 = 90° about t.y, partial");
  assert.match(ls.at(-1)!, /^    \d+ made — members\("e1"\) lists them$/);
  const corner = m.line(f.twins[0][0]).refs[0];
  assert.deepEqual((scope.rels as (n?: string) => string[])(corner), [`d1  revolution ${QUARTER} (90°) about t.y, 4 pairs`]);
  assert.equal(describePick(m, { name: "d1", kind: "relation", distance: 0 }), `d1  revolution ${QUARTER} (90°) about t.y, 4 pairs  ·  e1`);
  assert.match(describePick(m, { name: f.twins[0][2], kind: "line", distance: 0 }), /·\s+e1$/);
  // A full turn says so, everywhere.
  rev(lines[0], "t.y");
  const ls2 = (scope.ls as () => string[])();
  assert.equal(ls2.at(-2), "e2  revolve of l1,l2,l3,l4, angle d2 = 360° about t.y, a full turn");
  assert.equal(ls2.at(-1), `    1 made — members("e2") lists them`, "a full turn makes only its dimension");
  assert.deepEqual((scope.rels as (n?: string) => string[])().at(-1), `d2  revolution ${2 * Math.PI} (360°) about t.y, a full turn`);
  assert.match((scope.help as () => string)(), /revolve\(member, axis, angle\?, frame\?\)/);
});

test("the angle wears degrees halfway round the first corner's path, nudged off the axis; a full turn's sits at the axis", async () => {
  await loadKernel();
  const m = new Model(3);
  const t = tiltedFrame(m);
  const { lines } = polygon(m, t, BLOCK);
  const f = m.featureOf(revolve(m, lines[0], "t.y", (270 * Math.PI) / 180), "revolve");
  const view = { ox: 400, oy: 300, scale: 3 };
  const label = placeGlyphs(m, view).find((g) => g.relation === f.angle)!;
  assert.equal(label.symbol, "270°");
  assert.equal(label.isLabel, true);
  const first = m.relationOf(f.angle).args[2] as string;
  assert.ok(near(label.anchor, worldToScreen(view, aboutY(t, m.coords(first), (135 * Math.PI) / 180))));
  // Hovering it lights what it holds and the axis's frame.
  assert.ok(label.highlights.includes("t"));
  assert.ok(label.highlights.includes(first));

  const g = m.featureOf(revolve(m, lines[0], "t.y"), "revolve");
  const full = placeGlyphs(m, view).find((x) => x.relation === g.angle)!;
  assert.equal(full.symbol, "360°");
  assert.ok(near(full.anchor, worldToScreen(view, t.origin)));
});

test("a revolution is 3D-only, takes pairs or a whole turn, and refuses zero and more than a turn", async () => {
  await loadKernel();
  const flat = new Model(2);
  axisFrame(flat);
  assert.throws(() => revolution(flat, "f.y", 1), /needs a 3D model/);
  const m = new Model(3);
  axisFrame(m);
  m.addPoint([1, 0, 0], "a");
  m.addPoint([0, 1, 0], "b");
  assert.throws(() => revolution(m, "f.z", 1, "a"), /base\/twin pairs/);
  assert.throws(() => revolution(m, "f.z", 0, "a", "b"), /non-zero angle/);
  assert.throws(() => revolution(m, "f.z", 7, "a", "b"), /at most a whole turn/);
  assert.throws(() => revolution(m, "f.z", 1), /a full revolve has no end face/);
  assert.throws(() => revolution(m, "f.z", 2 * Math.PI, "a", "b"), /cannot be turned all the way round/);
  assert.throws(() => revolution(m, "f.z", 1, "a", "f"), /not a pair a revolution can hold/);
  assert.throws(() => revolution(m, "a", 1, "a", "b"), /"a" is not a line or a frame axis/);
  assert.equal(m.relations.size, 0, "and a refused one leaves nothing behind");
  // The one that works: a point a quarter turn round f's z, held exactly.
  revolution(m, "f.z", QUARTER, "a", "b");
  assert.equal(m.solve().solved, true);
  const [a, b] = [m.coords("a"), m.coords("b")];
  assert.ok(near(b, turn(a, [0, 0, 0], [0, 0, 1], QUARTER)));
});
