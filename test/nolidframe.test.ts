// An extrude makes no lid frame (docs/plans/no-lid-frame.md).
//
// The case worth reading first is the first one: the owner's, measured. Two
// rectangles drawn frameless and extruded together — the extrude tool, a click
// in each, Enter — share the first one's sketch frame, three of *its* corners.
// For the second solid that frame stands off its profile, so a version-10 lid
// frame made three points of its own, the sketch frame's moved by the depth:
// exactly on the first solid's lid corners, each drawn, since a lid-frame point
// ends no line. *"i'm getting a lot of overlapping points. why is this
// happening?"* Now there is no lid frame, and nothing to land anywhere.
//
// "On one spot" is measured as the screen shows it — two point entities within
// a millionth of each other after a solve. The rest proves that nothing which
// read the lid frame misses it: a twin curve names the sketch frame and is the
// same curve lifted, the depth moves the lid exactly, regeneration and `del`
// make and take what they should, and a sketch on a circle's lid — which has no
// three points of its own — gets a plane made through its centre.

import { test } from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { ensureKernelLoaded } from "../src/kernel/problem.ts";
import { Model } from "../src/model.ts";
import { fix, onPlane } from "../src/relations/basic.ts";
import { parallel } from "../src/relations/geometry.ts";
import { del, extrude, fillet, regen, set } from "../src/operations.ts";
import { VERSION, open, save } from "../src/persist.ts";
import { findLoops } from "../src/loops.ts";
import { neocadScope } from "../src/replenv.ts";
import { Repl } from "../src/repl.ts";
import { frameBasis } from "../src/relations/refs.ts";
import { curveFrame } from "../src/curveplane.ts";
import { arcSamples } from "../src/arcgeom.ts";
import { sketchFrameFor, sketchOnFaceCommand } from "../src/sketchface.ts";
import { tiltedFrame } from "./frames.ts";
import { baseOf, polygon, ring } from "./profiles.ts";

async function loadKernel() {
  const bytes = await readFile(new URL("../src/kernel/wasm-gen/neocad_kernel_bg.wasm", import.meta.url));
  await ensureKernelLoaded(bytes);
}

const sub = (a: number[], b: number[]) => a.map((x, i) => x - b[i]);
const dot = (a: number[], b: number[]) => a.reduce((s, x, i) => s + x * b[i], 0);
const near = (a: number[], b: number[], tol = 1e-9) => Math.hypot(...sub(a, b)) <= tol;

/** Every two point entities on one spot, as `a=b`, leaving out a tilted fixture frame's own points (the test's, not a feature's). */
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

const frames = (m: Model) => [...m.entities.values()].filter((e) => e.kind === "frame").map((e) => e.name);
const allNames = (m: Model) => [...m.entities.keys(), ...m.relations.keys(), ...m.features.keys()];

async function typed(m: Model, line: string): Promise<unknown> {
  const r = await new Repl(neocadScope({ model: m })).eval(line);
  assert.equal(r.ok, true, String(r.error?.message));
  return r.value;
}

/** Two 40 × 30 rectangles side by side, free points level at z = 0, nothing else — as the rectangle tool leaves them in a fresh model. */
function twoRectangles() {
  const m = new Model(3);
  const rect = (x0: number) => {
    const ps = [[x0, 0], [x0 + 40, 0], [x0 + 40, 30], [x0, 30]].map(([x, y]) => m.addPoint([x, y, 0]).name);
    return ps.map((p, i) => m.addLine(p, ps[(i + 1) % 4]).name);
  };
  return { m, left: rect(0), right: rect(60) };
}

// --- the measurement ----------------------------------------------------------------

test("two rectangles extruded together: no frame but the sketch's, and no two points on one spot — a version-10 build laid three", async () => {
  await loadKernel();
  // As the extrude tool does it: the first region gets a frame of its own
  // corners (typed before it), and the second is parallel to that frame, so it
  // is oriented by it too.
  const { m, left, right } = twoRectangles();
  assert.equal(await typed(m, `extrude("${left[0]}", 10)`), "e1");
  assert.equal(await typed(m, `extrude("${right[0]}", 10)`), "e2");
  assert.equal(m.solve().solved, true);
  const [e1, e2] = [m.featureOf("e1", "extrude"), m.featureOf("e2", "extrude")];
  assert.equal(e2.frame, e1.frame, "one sketch frame for both");
  assert.deepEqual(frames(m), [e1.frame], "and it is the only frame");
  assert.deepEqual(coincident(m), [], "no two points on one spot");
  assert.equal([...m.entities.values()].filter((e) => e.kind === "point").length, 8 + 8, "eight corners, eight twins");
  for (const f of [e1, e2]) {
    assert.equal(f.top, undefined);
    assert.equal(baseOf(m, f.depth).size, 4, "the depth holds the four corners and nothing else");
  }

  // The same sketch the way a version-10 build expanded it: the second lid
  // frame's own three points on the first lid's corners — the owner's report.
  // The frame is the one the typed call made above, three of the left
  // rectangle's corners, made here by hand so the old expansion can be asked for.
  const old = twoRectangles();
  const sketch = m.frame(e1.frame);
  old.m.addFrame(sketch.origin, sketch.xref, sketch.yref!, "f1");
  extrude(old.m, old.left[0], 10, "f1", null, 10);
  extrude(old.m, old.right[0], 10, "f1", null, 10);
  assert.equal(old.m.solve().solved, true);
  const second = old.m.featureOf("e2", "extrude");
  const lidRefs = old.m.refsOf(old.m.frame(second.top!));
  const firstLid = new Set(baseOf(old.m, old.m.featureOf("e1", "extrude").depth).keys());
  const pairs = coincident(old.m).map((pair) => pair.split("="));
  assert.equal(pairs.length, 3, `measured before: ${coincident(old.m)}`);
  for (const [a, b] of pairs) {
    assert.ok((lidRefs.includes(a) && firstLid.has(b)) || (lidRefs.includes(b) && firstLid.has(a)),
      `${a}=${b}: the second lid frame's own point on a first-lid corner`);
  }
  assert.equal(frames(old.m).length, 1 + 2, "the sketch frame and a lid frame each");
});

// --- what read the lid frame ------------------------------------------------------------

test("a twin circle names the sketch frame and is the same circle lifted — drawn, solved and set exactly as before", async () => {
  await loadKernel();
  const m = new Model(3);
  const t = tiltedFrame(m);
  const c = ring(m, t, 10, 10, 6);
  const f = m.featureOf(extrude(m, c, 12), "extrude");
  const twin = m.circle(f.twins[0][0]);
  assert.equal(twin.plane, t.name, "an orientation, which a translation keeps");
  assert.equal(m.solve().solved, true);
  for (const depth of [12, 30, -7]) {
    if (depth !== 12) set(m, `${f.depth}.value`, depth);
    assert.equal(m.solve().solved, true);
    const [a, b] = [curveFrame(m, m.circle(c))!, curveFrame(m, twin)!];
    const [sa, sb] = [arcSamples(a, 24), arcSamples(b, 24)];
    sa.forEach((p, i) => assert.ok(near(sb[i], p.map((x, k) => x + depth * t.uz[k]), 1e-8), `depth ${depth}, sample ${i}`));
    assert.ok(Math.abs(m.radius(twin.name) - 6) < 1e-9);
  }
});

test("set on the depth moves the lid exactly — every twin by the difference along +z — and nothing else", async () => {
  await loadKernel();
  const m = new Model(3);
  const t = tiltedFrame(m);
  const uv: [number, number][] = [[0, 0], [40, 0], [40, 30], [0, 30]];
  const { points, lines } = polygon(m, t, uv);
  points.forEach((p, i) => fix(m, p, [...uv[i], 0], t.name));
  const f = m.featureOf(extrude(m, lines[0], 20), "extrude");
  assert.equal(m.solve().solved, true);
  const was = new Map([...m.entities.values()].filter((e) => e.kind === "point").map((e) => [e.name, m.coords(e.name)]));
  set(m, `${f.depth}.value`, 33);
  assert.equal(m.solve().solved, true);
  const lid = new Set(baseOf(m, f.depth).keys());
  assert.equal(lid.size, 4);
  for (const [p, c] of was) {
    const want = lid.has(p) ? c.map((x, i) => x + 13 * t.uz[i]) : c;
    assert.ok(near(m.coords(p), want, 1e-9), `${p}`);
  }
});

/** A 40 × 30 rectangle held as regen.test.ts holds one a fillet can work on, with the sketch frame a frameless sketch gets — three of its own corners. */
function heldRectangle() {
  const m = new Model(3);
  const t = tiltedFrame(m);
  const { points: ps, lines } = polygon(m, t, [[0, 0], [40, 0], [40, 30], [0, 30]]);
  fix(m, ps[0], [0, 0, 0], t.name);
  fix(m, ps[2], [40, 30, 0], t.name);
  lines.forEach((l, i) => parallel(m, l, i % 2 === 0 ? `${t.name}.x` : `${t.name}.y`));
  const own = m.addFrame(ps[0], ps[1], ps[3]).name;
  assert.equal(m.solve().solved, true);
  return { m, t, ps, lines, own };
}

test("a fillet after the extrude regenerates with no frame made: a twin arc on the sketch frame, no two points on one spot, a no-op regen moves no name", async () => {
  await loadKernel();
  const { m, t, lines, own } = heldRectangle();
  extrude(m, lines[0], 20, own);
  const framesBefore = frames(m);
  const arc = fillet(m, lines[0], lines[1], 8);
  assert.equal(m.solve().solved, true);
  const f = m.featureOf("e1", "extrude");
  assert.equal(f.loops[0].length, 5, "rounded");
  assert.deepEqual(frames(m), framesBefore, "regenerating made no frame");
  assert.equal(f.top, undefined);
  const ta = m.arc(f.twins[0][1]);
  assert.equal(ta.plane, m.arc(arc).plane, "the twin arc keeps its base's frame");
  assert.deepEqual(coincident(m), []);
  assert.equal(baseOf(m, f.depth).size, 5 + 1 + 1, "five corners, the centre, the radius");
  for (const [twin, base] of baseOf(m, f.depth)) {
    if (m.entities.get(twin)!.kind === "point") assert.ok(near(m.coords(twin), m.coords(base).map((c, i) => c + 20 * t.uz[i]), 1e-7), twin);
  }
  const names = allNames(m);
  regen(m, "e1");
  assert.deepEqual(allNames(m), names);
});

test('del("e1") takes exactly what it made — twins, walls, depth, no frame — and leaves the sketch and its typed frame', async () => {
  await loadKernel();
  const { m, left } = twoRectangles();
  const entities = [...m.entities.keys()];
  const relations = [...m.relations.keys()];
  await typed(m, `extrude("${left[0]}", 10)`);
  const f = m.featureOf("e1", "extrude");
  assert.deepEqual(f.owns.map((n) => m.entities.get(n)?.kind ?? m.relationOf(n).op).sort(),
    [...Array(4).fill("point"), ...Array(8).fill("line"), "extrusion"].sort(), "four twins, four twin edges, four walls, the depth");
  const removed = del(m, "e1");
  assert.deepEqual(new Set(removed), new Set(["e1", ...f.owns]));
  assert.equal(removed.length, new Set(removed).size);
  assert.deepEqual([...m.entities.keys()], [...entities, f.frame], "the sketch, and the frame the typed call made for it");
  assert.deepEqual([...m.relations.keys()], relations);
  assert.equal(m.solve().solved, true);
});

test("a new file says nothing new: the extrude entry is the call, the version is 11 or later, and save, open, save is byte-identical", async () => {
  await loadKernel();
  const { m, left, right } = twoRectangles();
  await typed(m, `extrude("${left[0]}", 10)`);
  await typed(m, `extrude("${right[0]}", 15)`);
  set(m, `${m.featureOf("e2", "extrude").depth}.value`, 20);
  m.solve();
  const once = save(m);
  assert.equal(JSON.parse(once).version, VERSION);
  assert.ok(VERSION >= 11, "11 is where the lid frame went; 12 changed only groups");
  for (const e of JSON.parse(once).journal.filter((j: { op: string }) => j.op === "extrude")) {
    assert.equal(e.args.length, 4, "member, depth, frame, profile — no expansion");
  }
  const back = open(once);
  assert.equal(save(back), once, "byte-identical");
  assert.equal(save(open(save(back))), once, "and again");
  assert.deepEqual(allNames(back), allNames(m));
  assert.deepEqual(back.featureOf("e2"), m.featureOf("e2"));
  assert.equal(back.solve().solved, true);
  assert.deepEqual(coincident(back), []);
});

// --- a sketch on a circle's lid ------------------------------------------------------

test("sketch on a cylinder's top: a plane made through the lid's centre, held on its rim — it faces out, follows the depth, and a boss on it stands off the lid", async () => {
  await loadKernel();
  const m = new Model(3);
  const t = tiltedFrame(m);
  const c = ring(m, t, 10, 10, 6);
  const f = m.featureOf(extrude(m, c, 8), "extrude");
  m.solve();
  const rim = f.twins[0][0];
  const centre = m.circle(rim).center;
  const lid = findLoops(m).find((l) => l.members.length === 1 && l.members[0].name === rim)!;
  assert.ok(lid, "the top is a loop");

  // No three points of its own, and no frame on its plane: one is made.
  const p = sketchFrameFor(m, lid, t.uz);
  assert.ok(!Array.isArray(p), "a plane to make");
  assert.equal(p.origin, centre, "through the lid's own centre — no second point there");
  assert.equal(p.on, rim);
  const command = sketchOnFaceCommand(m, lid, t.uz);
  assert.match(command, new RegExp(`^plane\\("${centre}", pt\\([^)]*, oncircle\\(_, "${rim}"\\)\\), pt\\([^)]*, oncircle\\(_, "${rim}"\\)\\)\\)$`));

  const before = m.journal.length;
  const frame = await typed(m, command) as string;
  assert.deepEqual(m.journal.slice(before).map((j) => j.op), ["addPoint", "onCircle", "addPoint", "onCircle", "addFrame", "setDefaultFrame"],
    "the typed line's own calls, the clause idiom's order");
  assert.equal(m.defaultFrame, frame);
  assert.equal(m.solve().solved, true);
  const fr = m.frame(frame);
  assert.equal(fr.origin, centre);
  const { uz } = frameBasis(m, frame)();
  assert.ok(near(uz!, t.uz, 1e-9), "facing out of the top, as the circle's frame does");
  for (const q of [fr.xref, fr.yref!]) assert.ok(Math.abs(Math.hypot(...sub(m.coords(q), m.coords(centre))) - 6) < 1e-9, `${q} on the rim: ${Math.hypot(...sub(m.coords(q), m.coords(centre)))}`);
  assert.ok(Math.abs(m.radius(rim) - 6) < 1e-12 && Math.abs(m.radius(c) - 6) < 1e-12, "seeded exactly on the rim, so no radius gave way to the holds");
  assert.deepEqual(coincident(m), [], "no point on another");

  // Seen from below, the same lid's plane is turned over.
  const under = sketchFrameFor(m, lid, t.uz.map((x) => -x));
  assert.ok(!Array.isArray(under));
  const made = under.refs;
  const n = (([a, b]) => { const u = sub(a, m.coords(centre)), v = sub(b, m.coords(centre));
    return [u[1] * v[2] - u[2] * v[1], u[2] * v[0] - u[0] * v[2], u[0] * v[1] - u[1] * v[0]]; })(made);
  assert.ok(dot(n, t.uz) < 0, "+z toward whoever looked, from either side");

  // It is the lid's plane, not the place the lid was: set the depth and the
  // frame rises with it, square as ever.
  set(m, `${f.depth}.value`, 20);
  assert.equal(m.solve().solved, true);
  assert.ok(near(m.coords(centre), m.coords(m.circle(c).center).map((x, i) => x + 20 * t.uz[i]), 1e-9));
  assert.ok(near(frameBasis(m, frame)().uz!, t.uz, 1e-9), "not tipped by the lid moving");
  for (const q of [fr.xref, fr.yref!]) assert.ok(Math.abs(dot(sub(m.coords(q), m.coords(centre)), t.uz)) < 1e-9, `${q} still in the lid's plane`);

  // A boss sketched on it and extruded stands off the top.
  const bc = await typed(m, `pt(${m.coords(centre).join(", ")})`) as string;
  onPlane(m, bc, frame);
  const boss = m.addCircle(bc, 2, frame).name;
  const g = m.featureOf(extrude(m, boss, 5), "extrude");
  assert.equal(m.solve().solved, true);
  const bossLid = [...baseOf(m, g.depth)].find(([, b]) => b === bc)![0];
  assert.ok(Math.abs(dot(sub(m.coords(bossLid), m.coords(m.circle(c).center)), t.uz) - 25) < 1e-6, "20 of cylinder and 5 of boss");

  // And the file reopens as it was.
  const once = save(m);
  assert.equal(save(open(once)), once);
});
