// Sketch editing (docs/plans/sketch-edit.md): trim, extend, offset, mirror,
// chamfer and the two patterns, headless. The owner: *"give me better sketch
// tools, relations, trim, slot... all the usual"*.
//
// The risky ones first, as the spec lists them: a trim across a profile under
// an extrude (it regenerates, or it refuses and says why — and then the model
// is exactly as it was, auto-name counters included); a circle trimmed to an
// arc keeping the oncircle points that survive; an offset of a closed chain
// closing; a mirror about an axis by name and about a tilted line in 3D; the
// chamfer's dimensions; patterns following their seed under a drag and a
// dimension's change; deleting a seed; and every operation's replay.
//
// Closed forms throughout: an expected place is worked out here by arithmetic,
// never read back through the relation that holds it.

import { test } from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { ensureKernelLoaded, type ResidualBlock } from "../src/kernel/problem.ts";
import { Dual } from "../src/kernel/dual.ts";
import { Model } from "../src/model.ts";
import { dist, fix } from "../src/relations/basic.ts";
import { onCircle, parallel, pointOnLine } from "../src/relations/geometry.ts";
import { rotated, rotation, translated } from "../src/relations/pattern.ts";
import { del, extrude, set } from "../src/operations.ts";
import { chamfer, circular, extend, linear, mirror, offset, patternNames, trim, walkChain } from "../src/sketchedit.ts";
import { cutsOf } from "../src/sketchgeom.ts";
import { open, save } from "../src/persist.ts";
import { findLoops } from "../src/loops.ts";
import { addEllipse } from "../src/kinds/ellipse.ts";
import { Repl } from "../src/repl.ts";
import { neocadScope } from "../src/replenv.ts";
import { axisFrame } from "./frames.ts";
import { tiltedFrame } from "./frames.ts";

await ensureKernelLoaded(await readFile(new URL("../src/kernel/wasm-gen/neocad_kernel_bg.wasm", import.meta.url)));

const sub = (a: number[], b: number[]) => a.map((x, i) => x - b[i]);
const near = (a: number[], b: number[], tol = 1e-6) => Math.hypot(...sub(a, b)) <= tol;
const close = (a: number, b: number, tol = 1e-6, what = "") => assert.ok(Math.abs(a - b) <= tol, `${what} ${a} vs ${b}`);

function solved(m: Model) {
  const r = m.solve();
  assert.equal(r.solved, true, JSON.stringify(r.offenders));
  assert.ok(r.maxResidual < 1e-6, `max residual ${r.maxResidual}`);
  return r;
}

/** A weak pull of `point` toward `to` — what a drag adds for one solve and stores nowhere. */
function pull(m: Model, point: string, to: number[]): ResidualBlock {
  return { varIndices: m.point(point).varIndices, fn: (l: Dual[]) => l.map((x, i) => x.sub(to[i]).mul(0.3)) };
}
function drag(m: Model, point: string, to: number[]) {
  m.problem.solve({ extra: [pull(m, point, to)] });
  solved(m);
}

/** Distance from p to the infinite line through a and b, in any dimension. */
function off(p: number[], a: number[], b: number[]): number {
  const u = sub(b, a), w = sub(p, a);
  const t = w.reduce((s, v, i) => s + v * u[i], 0) / u.reduce((s, v) => s + v * v, 0);
  return Math.hypot(...w.map((v, i) => v - t * u[i]));
}

/** A rectangle's four points and lines (bottom, right, top, left), its corners shared. */
function rect(m: Model, x0: number, y0: number, x1: number, y1: number) {
  const z = m.dim === 3 ? [0] : [];
  const p = [[x0, y0], [x1, y0], [x1, y1], [x0, y1]].map((c) => m.addPoint([...c, ...z]).name);
  const l = p.map((a, i) => m.addLine(a, p[(i + 1) % 4]).name);
  return { p, l };
}

/** A line between two new points. */
function seg(m: Model, a: number[], b: number[]): string {
  const z = m.dim === 3 && a.length === 2 ? [0] : [];
  return m.addLine(m.addPoint([...a, ...z]).name, m.addPoint([...b, ...z]).name).name;
}

/** Everything a model holds, as text — "nothing changed" is this not changing. */
const text = (m: Model) => save(m, false);

/** The next auto-names the model would hand out — what a refused call must not have moved. */
function nextNames(m: Model): string[] {
  const probe = open(save(m, false), m.dim);
  return [probe.addPoint().name, probe.addLine().name, dist(probe, probe.addPoint().name, probe.addPoint().name, 3)];
}

/** Save, open, save: the same text twice — the operation replays to the same model. */
function replays(m: Model): Model {
  const once = save(m);
  const back = open(once, m.dim);
  assert.equal(save(back), once, "the replay is the same model");
  return back;
}

// --- trim: the risky ones --------------------------------------------------------

test("trim across a profile under an extrude regenerates the solid onto the face left — one entry, the regeneration resolved beside it", () => {
  const m = new Model(3);
  const { l } = rect(m, 0, 0, 40, 30);
  const e1 = m.featureOf(extrude(m, l[0], 10), "extrude");
  const cut = seg(m, [20, -10], [20, 40]);
  const before = m.journal.length;
  const out = trim(m, l[0], [30, 0, 0]);
  assert.deepEqual(out, [l[0]]);
  assert.equal(m.journal.length, before + 1, "one entry: the trim");
  const entry = m.journal.at(-1)!;
  assert.equal(entry.op, "trim");
  assert.equal((entry.args[3] as unknown[]).length, 1, "the feature it regenerated, resolved");
  // l1 now runs from its start to the cut, which is held on the cutting line.
  const l1 = m.line(l[0]);
  const end = l1.refs[1];
  assert.ok(near(m.coords(end), [20, 0, 0]), "l1 ends at the cut");
  assert.ok([...m.relations.values()].some((r) => r.op === "pointOnLine" && r.args[0] === end && r.args[1] === cut), "held on the cutter");
  // The solid stands on the left half: its outline runs along the cutter.
  const f = m.featureOf(e1.name, "extrude");
  const names = f.loops[0].map((x) => (typeof x === "string" ? x : x.name));
  assert.ok(names.includes(cut) && names.includes(l[0]) && names.includes(l[3]) && !names.includes(l[1]), `outline ${names}`);
  solved(m);
  // Every twin is over its base by the depth.
  for (const tw of f.twins.flat()) {
    const e = m.entities.get(tw);
    if (e?.kind !== "line") continue;
    for (const p of e.refs) assert.ok(Math.abs(m.coords(p)[2] - 10) < 1e-6, `${p} on the lid`);
  }
  replays(m);
});

test("a second trim at a crossing the extrude made real ends the curve at that point, which is the sketch's now: nothing redundant, and deleting the solid keeps the edge", () => {
  const m = new Model(3);
  const { l } = rect(m, 0, 0, 40, 30);
  const e1 = extrude(m, l[0], 10);
  seg(m, [20, -10], [20, 40]);
  trim(m, l[0], [30, 0, 0]);
  // The regeneration made the top edge's crossing a point of its own, held on both lines.
  const made = m.featureOf(e1).owns.filter((n) => m.entities.get(n)?.kind === "point" && near(m.coords(n), [20, 30, 0]));
  assert.equal(made.length, 1, "the crossing the extrude made real");
  trim(m, l[2], [30, 30, 0]);
  const [p] = made;
  assert.ok(m.line(l[2]).refs.includes(p), "the top edge ends at that point");
  assert.ok(!m.featureOf(e1).owns.includes(p), "and the solid no longer owns it");
  assert.ok(![...m.relations.values()].some((r) => r.op === "pointOnLine" && r.args[0] === p && r.args[1] === l[2]), "its hold on the edge it ends went");
  solved(m);
  assert.deepEqual(m.diagnose().redundant, [], "nothing said twice");
  const back = replays(m);
  assert.deepEqual(back.diagnose().redundant, []);
  del(m, e1);
  assert.ok(m.entities.has(l[2]) && m.entities.has(p), "deleting the solid keeps the sketch");
});

test("trim that would open a profile under an extrude refuses, says why, and leaves the model — names and counters — exactly as it was", () => {
  const m = new Model(3);
  const { l } = rect(m, 0, 0, 40, 30);
  extrude(m, l[0], 10);
  seg(m, [20, 10], [20, -10]); // a stub across the bottom edge only
  const was = text(m), next = nextNames(m), entries = m.journal.length;
  assert.throws(() => trim(m, l[0], [30, 0, 0]), (e: Error) => {
    assert.match(e.message, /trimming that piece of l1 leaves a feature nothing to stand on — e1:/);
    assert.match(e.message, /is gone|no closed loop/);
    return true;
  });
  assert.equal(text(m), was, "nothing changed");
  assert.equal(m.journal.length, entries, "nothing journalled");
  assert.deepEqual(nextNames(m), next, "no auto-name moved");
  // Without the solid the same trim is an ordinary trim.
  del(m, "e1");
  trim(m, l[0], [30, 0, 0]);
  assert.ok(near(m.coords(m.line(l[0]).refs[1]), [20, 0, 0]));
});

test("a region with no feature on it follows the regions rule: its face is found again from its members, changed", () => {
  const m = new Model(3);
  const { l } = rect(m, 0, 0, 40, 30);
  const scope = neocadScope({ model: m });
  (scope.region as (x: string) => string)(l[0]);
  seg(m, [20, -10], [20, 40]);
  trim(m, l[0], [30, 0, 0]);
  trim(m, l[2], [30, 30, 0]);
  // rg1's first face is l1's loop now: the left half, 20 × 30.
  const area = Math.abs(findLoops(m).find((lp) => lp.members.some((x) => x.name === l[0]))!.area);
  close(area, 600, 1e-6, "the left half");
  replays(m);
});

test("trim of a circle leaves an arc under its name, keeping the oncircle points on the piece that stays and freeing the one on the piece that goes", () => {
  const m = new Model(2);
  axisFrame(m);
  const c = m.addCircle(m.addPoint([0, 0]).name, 10).name;
  const across = seg(m, [-20, 0], [20, 0]); // cuts the circle at (±10, 0)
  const top = m.addPoint([0, 10]).name, bottom = m.addPoint([0, -10]).name;
  const rTop = onCircle(m, top, c), rBottom = onCircle(m, bottom, c);
  const rad = [...m.relations.values()].length;
  void rad;
  solved(m);
  const out = trim(m, c, [0, -10]); // the lower half goes
  assert.deepEqual(out, [c]);
  const arc = m.arc(c);
  assert.ok(near(m.coords(arc.start), [10, 0]) && near(m.coords(arc.end), [-10, 0]), "the upper half, start to end counter-clockwise");
  assert.ok(m.relations.has(rTop), "the point on the piece kept keeps its oncircle");
  assert.ok(!m.relations.has(rBottom), "the point on the piece that went is freed");
  assert.ok(m.entities.has(bottom), "and stays a point");
  assert.ok([...m.relations.values()].some((r) => r.op === "arcEndpoints" && r.args[0] === c), "held arcends");
  for (const p of [arc.start, arc.end]) {
    assert.ok([...m.relations.values()].some((r) => r.op === "pointOnLine" && r.args[0] === p && r.args[1] === across), `${p} on the cutter`);
  }
  solved(m);
  // The cut follows the cutter: lift the line, the arc's ends ride up it.
  fix(m, m.line(across).refs[0], [-20, 4]);
  fix(m, m.line(across).refs[1], [20, 4]);
  fix(m, arc.center, [0, 0]);
  solved(m);
  for (const p of [arc.start, arc.end]) close(m.coords(p)[1], 4, 1e-6, `${p} rode the cutter`);
  replays(m);
});

test("trim out of the middle of a line leaves two, held collinear; the line's relations stay with the piece from its start", () => {
  const m = new Model(2);
  axisFrame(m);
  const l = seg(m, [0, 0], [30, 0]);
  const a = seg(m, [10, -5], [10, 5]), b = seg(m, [20, -5], [20, 5]);
  const level = parallel(m, l, "f.x");
  const out = trim(m, l, [15, 0]);
  assert.equal(out.length, 2);
  const [, piece] = out;
  assert.ok(near(m.coords(m.line(l).refs[1]), [10, 0]) && near(m.coords(m.line(piece).refs[0]), [20, 0]));
  assert.ok(m.relations.has(level), "par stays on l");
  assert.ok([...m.relations.values()].some((r) => r.op === "collinear" && r.args[0] === l && r.args[1] === piece));
  void a; void b;
  solved(m);
  replays(m);
});

test("trim to a T ends at the stem's own point; the end it lost goes, with the dimension that named it", () => {
  const m = new Model(2);
  const l = seg(m, [0, 0], [30, 0]);
  const stemFoot = m.addPoint([10, 0]).name;
  const stem = m.addLine(stemFoot, m.addPoint([10, 8]).name).name;
  pointOnLine(m, stemFoot, l);
  const start = m.line(l).refs[0];
  const d = dist(m, start, m.addPoint([0, -5]).name, 5);
  trim(m, l, [4, 0]);
  assert.equal(m.line(l).refs[0], stemFoot, "l starts at the T's point");
  assert.ok(!m.entities.has(start) && !m.relations.has(d), "the end it lost went, and what named it");
  assert.ok(![...m.relations.values()].some((r) => r.op === "pointOnLine" && r.args[0] === stemFoot && r.args[1] === l),
    "the hold on its own line said nothing any more, and went");
  void stem;
  solved(m);
  replays(m);
});

test("trim of an arc's end re-points it and its arcends holds the new end", () => {
  const m = new Model(2);
  const c = m.addPoint([0, 0]).name;
  const arc = m.addArc(c, m.addPoint([10, 0]).name, m.addPoint([-10, 0]).name, 10).name;
  const ends = [...m.relations.values()].length;
  void ends;
  const ae = (() => { const { arcEndpoints } = { arcEndpoints: 0 }; void arcEndpoints; return null; })();
  void ae;
  const across = seg(m, [0, -5], [0, 20]);
  const scope = neocadScope({ model: m });
  (scope.arcends as (a: string) => string)(arc);
  trim(m, arc, [8, 6]); // the piece from the start (10, 0) to the cut at (0, 10)
  const a = m.arc(arc);
  assert.ok(near(m.coords(a.start), [0, 10]));
  const holds = [...m.relations.values()].find((r) => r.op === "arcEndpoints")!;
  assert.ok(holds, "arcends kept, same name");
  solved(m);
  // Drag the cutter: the start rides it, on the circle.
  fix(m, m.line(across).refs[0], [3, -5]);
  fix(m, m.line(across).refs[1], [3, 20]);
  fix(m, c, [0, 0]);
  solved(m);
  close(m.coords(a.start)[0], 3, 1e-6, "on the cutter");
  close(Math.hypot(...m.coords(a.start)), m.radius(arc), 1e-6, "on the arc's circle");
  replays(m);
});

test("trim refuses what it cannot cut, in words that say what would", () => {
  const m = new Model(2);
  const lone = seg(m, [0, 0], [10, 0]);
  assert.throws(() => trim(m, lone, [5, 0]), /nothing cuts l1 — .*del\("l1"\)/);
  const c = m.addCircle(m.addPoint([0, 20]).name, 5).name;
  seg(m, [0, 10], [0, 22]); // cuts the circle once, at (0, 15)
  assert.throws(() => trim(m, c, [0, 25]), /cut only once/);
  const el = addEllipse(m, m.addPoint([50, 0]).name, m.addPoint([60, 0]).name, 4).name;
  assert.throws(() => trim(m, el, [50, 4]), /ellipse/);
  assert.throws(() => trim(m, lone, [5]), /takes a place/);
  const m3 = new Model(3);
  const { l } = rect(m3, 0, 0, 10, 10);
  const e = m3.featureOf(extrude(m3, l[0], 5), "extrude");
  const twin = e.owns.find((n) => m3.entities.get(n)?.kind === "line")!;
  assert.throws(() => trim(m3, twin, [5, 0, 5]), /part of e1's solid/);
});

test("cuts: a crossing, a T and a held crossing point, in order along the curve; tangency and its own ends cut nothing", () => {
  const m = new Model(2);
  const l = seg(m, [0, 0], [40, 0]);
  seg(m, [10, -5], [10, 5]);                       // a crossing at 10
  const foot = m.addPoint([20, 0]).name;
  m.addLine(foot, m.addPoint([20, 5]).name);       // a T at 20
  m.addCircle(m.addPoint([30, 5]).name, 5);        // tangent at 30
  m.addLine(m.line(l).refs[1], m.addPoint([45, 9]).name); // from its own end
  const cuts = cutsOf(m, l);
  assert.deepEqual(cuts.map((c) => c.t * 40), [10, 20]);
  assert.equal(cuts[1].point, foot);
});

// --- extend ------------------------------------------------------------------------

test("extend carries a line on to the next curve, its end held on it; an arc round its circle; a corner refuses", () => {
  const m = new Model(2);
  axisFrame(m);
  const l = seg(m, [0, 0], [10, 0]);
  const wall = seg(m, [30, -10], [30, 10]);
  seg(m, [50, -10], [50, 10]);
  const end = m.line(l).refs[1];
  assert.equal(extend(m, l, end), l);
  assert.ok(near(m.coords(end), [30, 0]), "to the first along it");
  assert.ok([...m.relations.values()].some((r) => r.op === "pointOnLine" && r.args[0] === end && r.args[1] === wall));
  solved(m);
  const arc = m.addArc(m.addPoint([0, 40]).name, m.addPoint([10, 40]).name, m.addPoint([0, 50]).name, 10).name;
  const floor = seg(m, [-20, 40], [-5, 40]); // the circle meets it at (−10, 40)
  extend(m, arc, [1, 50]);
  assert.ok(near(m.coords(m.arc(arc).end), [-10, 40]), "round to the line");
  void floor;
  const { l: box } = rect(m, 100, 0, 110, 10);
  assert.throws(() => extend(m, box[0], m.line(box[0]).refs[1]), /is also l\d+'s — extend lengthens a free end/);
  const lone = seg(m, [0, -60], [5, -60]);
  assert.throws(() => extend(m, lone, m.line(lone).refs[1]), /nothing lies past/);
  solved(m);
  replays(m);
});

// --- offset ----------------------------------------------------------------------

test("offset of a closed chain is a closed chain, outward for a positive distance, each copy par and dist from its original", () => {
  const m = new Model(3);
  const { l } = rect(m, 0, 0, 40, 30);
  const copies = offset(m, l, 5);
  assert.equal(copies.length, 4);
  const loops = findLoops(m);
  const outer = loops.find((lp) => lp.members.some((x) => copies.includes(x.name)))!;
  assert.deepEqual(new Set(outer.members.map((x) => x.name)), new Set(copies), "the copies are one loop");
  close(Math.abs(outer.area), 50 * 40, 1e-6, "outward by 5");
  solved(m);
  for (let i = 0; i < 4; i++) {
    const [o, c] = [m.line(l[i]), m.line(copies[i])];
    const [a, b] = o.refs.map((p) => m.coords(p));
    for (const p of c.refs) close(off(m.coords(p), a, b), 5, 1e-6, `${copies[i]} 5 from ${l[i]}`);
  }
  // Inward is the negative distance, and closes as well.
  const inner = offset(m, l, -5);
  const loopIn = findLoops(m).find((lp) => lp.members.some((x) => inner.includes(x.name)))!;
  close(Math.abs(loopIn.area), 30 * 20, 1e-6, "inward by 5");
  replays(m);
});

test("offset follows its original: dimension the original and the copy keeps its distance", () => {
  const m = new Model(2);
  axisFrame(m);
  const { p, l } = rect(m, 0, 0, 40, 30);
  fix(m, p[0], [0, 0]);
  l.forEach((x, i) => parallel(m, x, i % 2 === 0 ? "f.x" : "f.y"));
  const w = dist(m, p[0], p[1], 40), h = dist(m, p[1], p[2], 30);
  const copies = offset(m, l, 4);
  solved(m);
  set(m, `${w}.value`, 60);
  set(m, `${h}.value`, 20);
  solved(m);
  for (let i = 0; i < 4; i++) {
    const [a, b] = m.line(l[i]).refs.map((q) => m.coords(q));
    for (const q of m.line(copies[i]).refs) close(off(m.coords(q), a, b), 4, 1e-6, `${copies[i]}`);
  }
  const corner = m.line(copies[1]).refs[0];
  assert.ok(near(m.coords(corner), [64, -4]), `the corner followed: ${m.coords(corner)}`);
});

test("offset of a filleted outline: arcs about the same centre, tangent to the lines' copies, the chain closed", () => {
  const m = new Model(2);
  const { l } = rect(m, 0, 0, 40, 30);
  const scope = neocadScope({ model: m });
  const fillet = scope.fillet as (a: string, b: string, r: number) => string;
  const arc = fillet(l[0], l[1], 8);
  solved(m);
  const chain = [l[0], arc, l[1], l[2], l[3]];
  const { closed, walk } = walkChain(m, chain);
  assert.equal(closed, true);
  assert.equal(walk.length, 5);
  const copies = offset(m, chain, 3);
  const arcCopy = copies[chain.indexOf(arc)];
  assert.equal(m.arc(arcCopy).center, m.arc(arc).center, "the same centre point");
  assert.ok([...m.relations.values()].some((r) => r.op === "tangent" && r.args.includes(arcCopy)), "tan, not a radius");
  solved(m);
  close(m.radius(arcCopy), 11, 1e-6, "r + d outward");
  const loop = findLoops(m).find((lp) => lp.members.some((x) => x.name === arcCopy))!;
  assert.deepEqual(new Set(loop.members.map((x) => x.name)), new Set(copies));
  replays(m);
});

test("offset of a circle is a circle about the same centre; of an open chain, its ends square across; past a radius it refuses", () => {
  const m = new Model(2);
  const c = m.addCircle(m.addPoint([0, 0]).name, 10).name;
  const [cc] = offset(m, c, 2);
  close(m.radius(cc), 12, 1e-9);
  assert.equal(m.circle(cc).center, m.circle(c).center);
  assert.throws(() => offset(m, c, -10), /more than c1's radius/);
  const a = m.addPoint([50, 0]).name, b = m.addPoint([70, 0]).name, d = m.addPoint([70, 15]).name;
  const l1 = m.addLine(a, b).name, l2 = m.addLine(b, d).name;
  const copies = offset(m, [l1, l2], 2);
  solved(m);
  // Left of l1 as drawn (a → b is +x) is +y: the copy of l1 at y = 2, of l2 at x = 68.
  close(m.coords(m.line(copies[0]).refs[0])[1], 2);
  close(m.coords(m.line(copies[1]).refs[1])[0], 68);
  assert.ok([...m.relations.values()].filter((r) => r.op === "perpendicular" && r.args.length === 3).length === 2, "two ends held square");
  assert.throws(() => offset(m, [l1, c], 1), /circle is a chain on its own/);
  const far = seg(m, [100, 0], [110, 0]);
  assert.throws(() => offset(m, [l1, far], 1), /not joined to/);
  replays(m);
});

// --- mirror ------------------------------------------------------------------------

test("mirror about a frame's axis by name: copies held by sym, a point on the axis its own mirror, an arc's sense turned", () => {
  const m = new Model(3);
  const p0 = m.addPoint([0, 10, 0]).name, p1 = m.addPoint([20, 10, 0]).name, p2 = m.addPoint([20, 30, 0]).name;
  const l1 = m.addLine(p0, p1).name, l2 = m.addLine(p1, p2).name;
  const arc = m.addArc(m.addPoint([30, 30, 0]).name, m.addPoint([40, 30, 0]).name, m.addPoint([30, 40, 0]).name, 10).name;
  const copies = mirror(m, [l1, l2, arc], "origin.y");
  const [c1, c2, ca] = copies;
  assert.equal(m.line(c1).refs[0], p0, "the point on the axis is shared");
  assert.ok(near(m.coords(m.line(c2).refs[1]), [-20, 30, 0]));
  assert.ok([...m.relations.values()].some((r) => r.op === "symmetric" && r.args[2] === "origin.y"));
  solved(m);
  // The arc's copy: its ends mirrored, and still the short quarter about the mirrored centre.
  const a = m.arc(ca);
  assert.ok(near(m.coords(a.center), [-30, 30, 0]));
  const s = m.coords(a.start), e = m.coords(a.end);
  assert.ok((near(s, [-40, 30, 0]) && near(e, [-30, 40, 0])) || (near(s, [-30, 40, 0]) && near(e, [-40, 30, 0])));
  // The copy follows: drag the original's corner.
  drag(m, p2, [25, 36, 0]);
  const q = m.coords(p2);
  assert.ok(near(m.coords(m.line(c2).refs[1]), [-q[0], q[1], q[2]], 1e-6), "the mirror followed");
  replays(m);
});

test("mirror about a tilted line in 3D is the half-turn about it, and the copy follows the line as it turns", () => {
  const m = new Model(3);
  const t = tiltedFrame(m);
  void t;
  const axisA = m.addPoint([1, 2, 3]).name, axisB = m.addPoint([4, 6, 8]).name;
  const axis = m.addLine(axisA, axisB).name;
  const l = seg(m, [5, -1, 2], [9, 3, -4]);
  const [copy] = mirror(m, [l], axis);
  solved(m);
  const o = m.coords(axisA), u = sub(m.coords(axisB), o);
  const len = Math.hypot(...u);
  const half = (x: number[]) => {
    const along = sub(x, o).reduce((s, v, i) => s + (v * u[i]) / len, 0);
    return o.map((oi, i) => 2 * (oi + (along * u[i]) / len) - x[i]);
  };
  const [a, b] = m.line(l).refs.map((p) => m.coords(p));
  const [ca, cb] = m.line(copy).refs.map((p) => m.coords(p));
  assert.ok(near(ca, half(a)) && near(cb, half(b)), "each end its half-turn about the line");
  // Turn the mirror line: the copy turns with it.
  fix(m, axisA, [1, 2, 3], "origin");
  fix(m, m.line(l).refs[0], [5, -1, 2], "origin");
  fix(m, m.line(l).refs[1], [9, 3, -4], "origin");
  fix(m, axisB, [2, 7, 5], "origin");
  solved(m);
  const u2 = sub(m.coords(axisB), m.coords(axisA));
  const l2 = Math.hypot(...u2);
  const half2 = (x: number[]) => {
    const o2 = m.coords(axisA);
    const along = sub(x, o2).reduce((s, v, i) => s + (v * u2[i]) / l2, 0);
    return o2.map((oi, i) => 2 * (oi + (along * u2[i]) / l2) - x[i]);
  };
  assert.ok(near(m.coords(m.line(copy).refs[0]), half2([5, -1, 2])), "followed the turned line");
  replays(m);
});

test("mirror refuses an ellipse, a frame axis that is not one, and a line that is not there", () => {
  const m = new Model(2);
  const l = seg(m, [0, 0], [5, 5]);
  const el = addEllipse(m, m.addPoint([20, 0]).name, m.addPoint([25, 0]).name, 2).name;
  assert.throws(() => mirror(m, [el], "origin.y"), /ellipse/);
  assert.throws(() => mirror(m, [l], "origin.z"), /z/);
  assert.throws(() => mirror(m, [l], "c9"), /a line or a frame's axis/);
});

// --- chamfer -----------------------------------------------------------------------

test("chamfer's dimensions: one setback is a dist and an equal spacing, two are two dists; the corner stays, held where the legs meet", () => {
  const m = new Model(2);
  axisFrame(m);
  const { p, l } = rect(m, 0, 0, 40, 30);
  fix(m, p[0], [0, 0]);
  l.forEach((x, i) => parallel(m, x, i % 2 === 0 ? "f.x" : "f.y"));
  dist(m, p[0], p[1], 40);
  dist(m, p[1], p[2], 30);
  const corner = p[1];
  const cut = chamfer(m, l[0], l[1], 5);
  solved(m);
  const [t1, t2] = m.line(cut).refs;
  assert.ok(near(m.coords(t1), [35, 0]) && near(m.coords(t2), [40, 5]));
  assert.ok(near(m.coords(corner), [40, 0]), "the corner stays at the corner");
  const ops = [...m.relations.values()].filter((r) => r.args.includes(corner)).map((r) => r.op);
  assert.ok(ops.includes("intersection") && ops.includes("dist") && ops.includes("equalSpacing"), ops.join(","));
  const d = [...m.relations.values()].find((r) => r.op === "dist" && r.args[0] === corner && r.args[1] === t1)!;
  set(m, `${d.name}.value`, 8);
  solved(m);
  assert.ok(near(m.coords(t1), [32, 0]) && near(m.coords(t2), [40, 8]), "one dimension moves both ends");
  // Two setbacks.
  const cut2 = chamfer(m, l[2], l[3], 6, 3);
  solved(m);
  const [u1, u2] = m.line(cut2).refs;
  assert.ok(near(m.coords(u1), [6, 30]) && near(m.coords(u2), [0, 27]), `${m.coords(u1)} ${m.coords(u2)}`);
  assert.throws(() => chamfer(m, l[0], l[2], 1), /do not meet/);
  assert.throws(() => chamfer(m, l[1], l[2], 50), /runs past/);
  replays(m);
});

test("chamfer on an extruded corner regenerates the lid: five twins, the corner's wall gone, the lid cut as the base is", () => {
  const m = new Model(3);
  const { p, l } = rect(m, 0, 0, 40, 30);
  const e1 = m.featureOf(extrude(m, l[0], 10), "extrude");
  const cut = chamfer(m, l[0], l[1], 5);
  const f = m.featureOf(e1.name, "extrude");
  assert.equal(f.loops[0].length, 5, "the outline has the chamfer in it");
  assert.ok(f.loops[0].some((x) => (typeof x === "string" ? x : x.name) === cut));
  assert.ok(!f.names.includes(p[1]), "the old corner is no vertex of the profile now");
  solved(m);
  const entry = m.journal.at(-1)!;
  assert.equal(entry.op, "chamfer");
  assert.equal(entry.args.length, 5, "with the regeneration resolved");
  replays(m);
});

// --- patterns ------------------------------------------------------------------------

test("a linear pattern follows its seed when the seed is dragged and when its spacing is set", () => {
  const m = new Model(2);
  axisFrame(m);
  const { p, l } = rect(m, 0, 0, 10, 5);
  const copies = linear(m, l, 20, 0, 3);
  assert.ok(copies.includes(`${l[0]}_2`) && copies.includes(`${l[0]}_3`) && copies.includes(`${p[0]}_3`), copies.join(","));
  solved(m);
  assert.ok(near(m.coords(`${p[2]}_3`), [50, 5]));
  drag(m, p[2], [14, 9]);
  const moved = m.coords(p[2]);
  assert.ok(near(m.coords(`${p[2]}_2`), [moved[0] + 20, moved[1]], 1e-6), "copy 2 followed the seed");
  assert.ok(near(m.coords(`${p[2]}_3`), [moved[0] + 40, moved[1]], 1e-6), "copy 3 followed the seed");
  const spacing = [...m.relations.values()].find((r) => r.op === "dist" && r.args[0] === p[0])!;
  set(m, `${spacing.name}.value`, 25);
  solved(m);
  const seed = m.coords(p[1]);
  assert.ok(near(m.coords(`${p[1]}_3`), [seed[0] + 50, seed[1]], 1e-6), "one dimension spaced them all");
  replays(m);
});

test("a circular pattern follows its seed under a drag and turns with its one rotation dimension", () => {
  const m = new Model(2);
  const centre = m.addPoint([0, 0]).name;
  const hole = m.addCircle(m.addPoint([20, 0]).name, 3).name;
  const copies = circular(m, [hole], centre, 2 * Math.PI, 4);
  assert.deepEqual(copies.filter((c) => m.entities.get(c)?.kind === "circle"), [`${hole}_2`, `${hole}_3`, `${hole}_4`]);
  solved(m);
  const at = (c: string) => m.coords(m.circle(c).center);
  assert.ok(near(at(`${hole}_2`), [0, 20]) && near(at(`${hole}_3`), [-20, 0]) && near(at(`${hole}_4`), [0, -20]));
  fix(m, centre, [0, 0], "origin");
  drag(m, m.circle(hole).center, [0, 30]);
  assert.ok(near(at(`${hole}_2`), [-30, 0], 1e-6) && near(at(`${hole}_3`), [0, -30], 1e-6), "the copies turned with the seed");
  const turn = [...m.relations.values()].find((r) => r.op === "rotation")!;
  set(m, `${turn.name}.value`, Math.PI / 4);
  solved(m);
  const s = at(hole), r = Math.hypot(...s), a0 = Math.atan2(s[1], s[0]);
  assert.ok(near(at(`${hole}_3`), [r * Math.cos(a0 + Math.PI / 2), r * Math.sin(a0 + Math.PI / 2)], 1e-6), "a step of 45° now");
  close(m.radius(`${hole}_3`), 3, 1e-9, "the seed's radius");
  replays(m);
});

test("a circular pattern over part of a turn spreads its copies from the seed to the last, the centre never copied", () => {
  const m = new Model(3);
  const centre = m.addPoint([0, 0, 0]).name;
  const l = m.addLine(centre, m.addPoint([10, 0, 0]).name).name;
  const copies = circular(m, [l], centre, Math.PI / 2, 3);
  solved(m);
  assert.equal(m.line(`${l}_3`).refs[0], centre, "the centre is shared, not copied");
  assert.ok(near(m.coords(m.line(`${l}_3`).refs[1]), [0, 10, 0]), "the last at a quarter turn");
  assert.ok(near(m.coords(m.line(`${l}_2`).refs[1]), [10 * Math.SQRT1_2, 10 * Math.SQRT1_2, 0]));
  void copies;
  replays(m);
});

test("deleting a pattern's seed deletes no copy: the copies keep what holds them to one another and go free of it", () => {
  const m = new Model(2);
  const { p, l } = rect(m, 0, 0, 10, 5);
  const copies = linear(m, l, 20, 0, 3);
  const removed = del(m, ...p);
  for (const c of copies.filter((x) => !x.startsWith("l") || x.includes("_"))) {
    if (removed.includes(c)) assert.fail(`${c} went with the seed`);
  }
  for (const c of [`${l[0]}_2`, `${l[0]}_3`, `${p[0]}_2`, `${p[0]}_3`]) assert.ok(m.entities.has(c), `${c} stays`);
  // Copy 2 and 3 still step as one another: what named the seed went, what named only copies stayed.
  assert.ok([...m.relations.values()].every((r) => r.op !== "translated" || !r.args.some((a) => p.includes(a as string))));
  solved(m);
  replays(m);
});

test("the pattern naming: copy k of l1 is l1_k, and a second pattern of the same seed takes a letter", () => {
  const m = new Model(2);
  const l = seg(m, [0, 0], [5, 0]);
  linear(m, [l], 10, 0, 2);
  assert.ok(m.entities.has(`${l}_2`));
  assert.equal(patternNames(m, [l], 2)(l, 2), `${l}_2b`);
  linear(m, [l], 0, 10, 2);
  assert.ok(m.entities.has(`${l}_2b`));
});

// --- the relations a pattern is held by, in 3D ---------------------------------------

test("translated, rotation and rotated are dimension-generic: they hold on a tilted plane in 3D, each a linear block of three", () => {
  const m = new Model(3);
  const t = tiltedFrame(m);
  const at = (u: number, v: number) => t.origin.map((o, i) => o + u * t.ux[i] + v * t.uy[i]);
  const [a, b, c, d] = [at(1, 1), at(4, 2), at(7, -3), at(0, 0)].map((x) => m.addPoint(x).name);
  const tr = translated(m, c, d, a, b);
  solved(m);
  assert.ok(near(sub(m.coords(d), m.coords(c)), sub(m.coords(b), m.coords(a))), "the same step");
  assert.equal(m.relations.get(tr)!.blocks.length, 1);
  const o = m.addPoint(at(0, 0)).name, p = m.addPoint(at(5, 0)).name, q = m.addPoint(at(3, 3)).name;
  rotation(m, p, q, o, Math.PI / 3, t.name);
  const x = m.addPoint(at(2, 1)).name, y = m.addPoint(at(0, 0.5)).name;
  rotated(m, x, y, o, p, q, t.name);
  solved(m);
  const loc = (n: string) => { const w = sub(m.coords(n), m.coords(o)); return [w.reduce((s, v, i) => s + v * t.ux[i], 0), w.reduce((s, v, i) => s + v * t.uy[i], 0), w.reduce((s, v, i) => s + v * t.uz[i], 0)]; };
  const turn = (v: number[], th: number) => [v[0] * Math.cos(th) - v[1] * Math.sin(th), v[0] * Math.sin(th) + v[1] * Math.cos(th), v[2]];
  assert.ok(near(loc(q), turn(loc(p), Math.PI / 3)), "q is p turned 60° about the plane's normal");
  assert.ok(near(loc(y), turn(loc(x), Math.PI / 3)), "y is x turned as q is p");
  assert.throws(() => rotation(new Model(4), "a", "b", "c", 1), /a 4D model/);
});

test("sym about a frame's axis is dimension-generic, a half-turn about the axis in 3D", () => {
  const m = new Model(3);
  const t = tiltedFrame(m);
  const a = m.addPoint(t.origin.map((o, i) => o + 3 * t.ux[i] + 2 * t.uy[i] + 1 * t.uz[i])).name;
  const b = m.addPoint(t.origin.map((o) => o + 1)).name;
  const scope = neocadScope({ model: m });
  (scope.sym as (a: string, b: string, l: string) => string)(a, b, `${t.name}.x`);
  fix(m, a, [3, 2, 1], t.name);
  solved(m);
  const w = sub(m.coords(b), t.origin);
  const local = [t.ux, t.uy, t.uz].map((ax) => w.reduce((s, v, i) => s + v * ax[i], 0));
  assert.ok(near(local, [3, -2, -1]), `the half-turn about f.x: ${local}`);
});

// --- typed, and replayed ------------------------------------------------------------

test("every edit is one typed call, journalled as itself and replayed: trim, extend, offset, mirror, chamfer, linear, circular", async () => {
  const m = new Model(3);
  const repl = new Repl(neocadScope({ model: m }));
  const run = async (src: string) => {
    const r = await repl.eval(src);
    assert.ok(r.ok, `${src}: ${r.error?.message}`);
    return r.value;
  };
  await run("q = [pt(0, 0, 0), pt(40, 0, 0), pt(40, 30, 0), pt(0, 30, 0)]; edges = [0, 1, 2, 3].map((i) => ln(q[i], q[(i + 1) % 4]))");
  await run("cross = ln(pt(20, -10, 0), pt(20, 40, 0))");
  const ops: string[] = [];
  const typed = async (src: string, op: string) => {
    const n = m.journal.length;
    await run(src);
    assert.ok(m.journal.slice(n).some((e) => e.op === op), `${src} journalled as ${op}`);
    ops.push(op);
  };
  await typed('trim("l5", [20, 35, 0])', "trim");
  const stub = await run("ln(pt(50, 0, 0), pt(55, 0, 0))") as string;
  await run("ln(pt(70, -5, 0), pt(70, 5, 0))");
  await typed(`extend(${JSON.stringify(stub)}, ${JSON.stringify(m.line(stub).refs[1])})`, "extend");
  await typed('offset(["l1", "l2", "l3", "l4"], 4)', "offset");
  await typed('mirror(["l5"], "origin.y")', "mirror");
  await typed('chamfer("l2", "l3", 3)', "chamfer");
  await typed('linear(["l4"], -10, 0, 2)', "linear");
  await typed('circular(["l1"], "p1", Math.PI, 3)', "circular");
  solved(m);
  const back = replays(m);
  for (const op of ops) assert.ok(back.journal.some((e) => e.op === op), `${op} replayed`);
});
