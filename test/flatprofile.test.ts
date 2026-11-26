// The owner's lens cut, and what it taught (docs/plans/flat-profile.md).
//
// The owner, 2026-11-26: a plate drawn with the Rectangle tool and extruded,
// a circle on its top crossing one edge, the Cut tool — a D-shaped notch —
// and then the circle's centre nudged. The log said *e1 cannot be laid out:
// its chord is not square to its profile*, the kernel built nothing, the
// plate was drawn as a plain prism and the cut's walls and cap hung below it
// as a boss. His file is `test/fixtures/owner-lens-cut-v23.neocad.json`,
// kept with his numbers.
//
// **Bug 84 — the drawing never settled.** Every solve of his file ran to
// the sixty-iteration cap and stopped 6e-3 off, and the base was left 3e-3
// off square along the chord, past the solids layer's bar. Removing one
// relation — `e2_perp`, the cut's chord square to its profile — let the
// same file settle in four iterations to 1e-10. Its rows for the circle,
// `ĉ × n̂ = 0`, were bare angles: a turn of the 110-long chord by θ cost the
// row θ but moved the chord's end 110·θ, so the damped step could only
// creep along that valley. Paid in the chord's length, as the line rows are
// paid in their edge's, the fight is gone: the file settles in one solve.
// The same bar for every unit-angle row a curve gives — `par(c1, plane)`
// and the extrusion's normal row, paid in the circle's radius — is the
// decision the register had queued (TODO.md: *the curve's radius is the
// natural one*), taken here and measured below.

import { test } from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { Model } from "../src/model.ts";
import { Repl } from "../src/repl.ts";
import { neocadScope } from "../src/replenv.ts";
import { open } from "../src/persist.ts";
import { extrudeSpan, solidsOf } from "../src/solids.ts";
import { Bodies, programOf } from "../src/bodies.ts";
import { organiserSections, rowMenu } from "../src/organiser.ts";
import { del, extrude, revolve } from "../src/operations.ts";
import { open as openFile, save } from "../src/persist.ts";
import { profileFlat } from "../src/relations/profilesquare.ts";
import { GLYPH_SYMBOL } from "../src/glyphs.ts";
import { describeRelation } from "../src/picking.ts";
import { OFFENDING } from "../src/kernel/problem.ts";
import { T, circleOn, onTop, plate } from "./solids/scene.ts";
import { Evaluator } from "../src/solids/evaluate.ts";
import { pullTo } from "../src/tools/engine.ts";
import "../src/modules/builtin.ts";
import { loadSolver } from "./solids/scene.ts";
import { kernel, noKernel as skip } from "./solids/load.ts";

const sub = (a: number[], b: number[]) => a.map((x, i) => x - b[i]);
const dot = (a: number[], b: number[]) => a.reduce((s, x, i) => s + x * b[i], 0);
const cross = (a: number[], b: number[]) => [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]];
const len = (a: number[]) => Math.hypot(...a);
const unit = (a: number[]) => a.map((x) => x / len(a));

/** How far `d` is off the plane through `a`, `b`, `c`. */
function offPlane(m: Model, a: string, b: string, c: string, d: string): number {
  const P = (n: string) => m.coords(n);
  const n = unit(cross(sub(P(b), P(a)), sub(P(c), P(a))));
  return Math.abs(dot(sub(P(d), P(a)), n));
}

/** The angle, in degrees, between the plane through `a`, `b`, `c`'s normal and the chord `from` → `to`. */
function offSquare(m: Model, a: string, b: string, c: string, from: string, to: string): number {
  const P = (n: string) => m.coords(n);
  const n = unit(cross(sub(P(b), P(a)), sub(P(c), P(a))));
  const chord = unit(sub(P(to), P(from)));
  // By the sine: an arccosine cannot resolve an angle under 1e-8 next to 1.
  return (Math.asin(Math.min(1, len(cross(n, chord)))) * 180) / Math.PI;
}

async function ownersFile(): Promise<Model> {
  await loadSolver();
  return open(await readFile(new URL("./fixtures/owner-lens-cut-v23.neocad.json", import.meta.url), "utf8"));
}

test("bug 84: the owner's lens cut settles — one solve, under twenty iterations, to 1e-9, the plate flat and square to its chord", async () => {
  const m = await ownersFile();
  const report = m.solve();
  assert.equal(report.solved, true);
  // Before: sixty iterations every solve, 6e-3 left, and a further solve the same again.
  assert.ok(report.maxResidual <= 1e-9, `left ${report.maxResidual}`);
  assert.equal(m.problem.solve().iterations, 0, "settled: a further solve has nothing to do");
  // The kernel's own count, on a fresh open (the model's solve adds its kept-size probe and finish): eighteen when this was written.
  const fresh = await ownersFile();
  const plain = fresh.problem.solve();
  assert.ok(plain.iterations <= 20 && plain.iterations < 60, `${plain.iterations} iterations`);
  assert.ok(offPlane(m, "p1", "p2", "p3", "p4") < 1e-9, "the plate's base is flat");
  assert.ok(offSquare(m, "p1", "p2", "p3", "p2", "p5") < 1e-7, "its chord is square to it");
  // What the kernel sees: both features lay out (before, both were refused as oblique).
  for (const f of ["e1", "e2"]) assert.doesNotThrow(() => extrudeSpan(m, m.featureOf(f, "extrude")), f);
});

test("bug 84: the owner's plate is built with its D-shaped notch, of the right volume", { skip }, async () => {
  const m = await ownersFile();
  m.solve();
  const ev = new Evaluator(await kernel());
  const bodies = ev.run(programOf(m, true).program).bodies;
  assert.equal(bodies.length, 1, "one body: the plate less the notch");
  const [b] = bodies;
  assert.deepEqual(b.failed, [], "nothing refused");
  assert.deepEqual(b.idle, [], "the cut cuts");
  assert.ok(b.solid, "a solid");
  // The plate, less the part of the circle inside it — the circle less the
  // segment beyond its edge l2 — through its whole thickness. The plate is
  // tilted 0.9° off the origin's plane as a free body may be, so the
  // distances are taken in the world, not read off coordinates.
  const P = (n: string) => m.coords(n);
  const plate = len(sub(P("p2"), P("p1"))) * len(sub(P("p3"), P("p2"))) * 85;
  const r = m.radius("c1");
  const d = len(cross(sub(P("p9"), P("p2")), unit(sub(P("p3"), P("p2"))))); // the centre's distance from l2
  assert.ok(d > 0 && d < r, "the circle crosses the edge");
  const segment = r * r * Math.acos(d / r) - d * Math.sqrt(r * r - d * d);
  const want = plate - (Math.PI * r * r - segment) * 85;
  assert.ok(Math.abs(b.solid.volume - want) / want < 1e-3, `volume ${b.solid.volume}, expected ${want}`);
  // And exactly what ZeroCAD's own measure of the two features says (solids.ts): the cut is 110 deep through 85.
  const own = Object.fromEntries(solidsOf(m).bodies.map((x) => [x.feature, x.volume]));
  const exact = own.e1 - (own.e2 * 85) / 110;
  assert.ok(Math.abs(b.solid.volume - exact) / exact < 1e-6, `volume ${b.solid.volume}, ZeroCAD's own ${exact}`);
});

/**
 * The owner's first scene, 60 deep: a box drawn line by line and squared by
 * hand, a circle held on its lid, a through-all cut, then the circle's centre
 * pulled as a screen-plane drag pulls it — a little off the face, which a
 * free box answers by tilting. Before the chord's length was on the curve
 * rows the settle after such a drag crept for sixty iterations at a time and
 * left the base 1e-4 off flat and the circle's normal 1.1° off the face;
 * `refuseOblique` then refused the box and the hole with it.
 */
async function deepBox(): Promise<Model> {
  await loadSolver();
  const m = new Model(3);
  const repl = new Repl(neocadScope({ model: m }));
  const say = async (s: string) => { const r = await repl.eval(s); if (!r.ok) throw new Error(`${s}: ${(r.error as Error | undefined)?.message}`); };
  await say('a0 = pt(-20, -20, 0); a1 = pt(20, -20, 0); a2 = pt(20, 20, 0); a3 = pt(-20, 20, 0); ln(a0, a1); ln(a1, a2); ln(a2, a3); ln(a3, a0); extrude("l1", 60)');
  await say('perp("l1","l2"); perp("l2","l3"); perp("l3","l4"); perp("l4","l1"); coplanar("p4","p1","p2","p3")');
  await say('workplane("p5.p6.p8")');
  await say('c = pt(0, 0, 60); onplane(c, "p5.p6.p8"); circle(c, 8, [0, 0, 1]); par("c1", "p5.p6.p8")');
  await say('extrude("c1", -10, {"mode": "cut", "end": "through"})');
  await say("workplane(null)");
  m.solve();
  return m;
}

test("bug 84: a deep free box's circle dragged a little off its face — the settle converges and the box is flat again", async () => {
  const m = await deepBox();
  const c0 = m.coords("p9");
  for (let i = 1; i <= 14; i++) {
    m.solveFrame(pullTo(m, "p9", [c0[0] + (10 * i) / 14, c0[1] - (3.5 * i) / 14, c0[2] + (0.3 * i) / 14]));
  }
  const report = m.solve();
  assert.equal(report.solved, true);
  assert.ok(report.iterations <= 20, `${report.iterations} iterations (sixty, creeping, before)`);
  assert.equal(m.problem.solve().iterations, 0, "settled");
  assert.ok(offPlane(m, "p1", "p2", "p3", "p4") < 1e-9, `base ${offPlane(m, "p1", "p2", "p3", "p4")} off flat (1e-4 before)`);
  assert.ok(offSquare(m, "p1", "p2", "p3", "p1", "p5") < 1e-7, "square to its chord");
  const slid = len(sub(m.coords("p9"), c0));
  assert.ok(slid > 9, `the circle slid ${slid} along the face`);
  assert.doesNotThrow(() => extrudeSpan(m, m.featureOf("e1", "extrude")), "the box lays out, so the hole is built");
});

test("the lever itself: a tall extruded circle whose chord is leaned by a seed comes back square in a few iterations", async () => {
  await loadSolver();
  const m = new Model(3);
  const repl = new Repl(neocadScope({ model: m }));
  const say = async (s: string) => { const r = await repl.eval(s); if (!r.ok) throw new Error(`${s}: ${(r.error as Error | undefined)?.message}`); };
  await say('c = pt(0, 0, 0); circle(c, 12, [0, 0, 1]); extrude("c1", 110)');
  m.solve();
  const f = m.featureOf("e1", "extrude");
  const twin = m.relationOf(f.depth).args[3] as string; // the chord pair's twin: the lid's centre
  // Leaned: the lid centre moved 3 sideways, the normals left as they were.
  const t = m.coords(twin);
  m.setCoords(twin, [t[0] + 3, t[1], t[2]]);
  const report = m.solve();
  assert.equal(report.solved, true);
  assert.ok(report.iterations <= 15, `${report.iterations} iterations`);
  assert.ok(report.maxResidual <= 1e-9, `left ${report.maxResidual}`);
  const chord = unit(sub(m.coords(twin), m.coords("p1")));
  const n = unit(m.oriented("c1").normal!.map((v) => m.problem.getVar(v)));
  assert.ok(Math.abs(Math.abs(dot(chord, n)) - 1) < 1e-9, "the chord is along the circle's normal again");
});

// ---- bug 83: the kernel's bar, the release's solve, the shell, the row -----------------

test("bug 83: the solids layer's squareness bar is the drawing's own tolerance, not a millionth", async () => {
  await loadSolver();
  const m = new Model(3);
  const p = plate(m);
  const f = m.featureOf(p.feature, "extrude");
  assert.doesNotThrow(() => extrudeSpan(m, f));
  // A corner lifted along the chord by less than the bar: still built — the
  // status calls such a drawing SOLVED, and a drag's frames leave this much.
  const corner = p.base[0];
  const was = m.coords(corner);
  const lift = (by: number) => m.setCoords(corner, was.map((c, i) => c + by * p.t.uz[i]));
  lift(OFFENDING * 0.5);
  assert.doesNotThrow(() => extrudeSpan(m, f), "within the drawing's tolerance: built");
  lift(OFFENDING * 2);
  assert.throws(() => extrudeSpan(m, f), /oblique/, "past it: drawn, not built, and said");
  lift(0);
});

test("bug 83: a solve that stopped at the cap is solved on, so a drag's release finishes", async () => {
  await loadSolver();
  const m = new Model(3);
  plate(m);
  m.solve();
  // The kernel's solve stubbed to report the cap once: the model asks again.
  const real = m.problem.solve.bind(m.problem);
  let calls = 0;
  m.problem.solve = (opts) => {
    calls++;
    const r = real(opts);
    return calls === 1 && !opts?.extra && !opts?.only ? { ...r, iterations: 60 } : r;
  };
  const report = m.solve();
  m.problem.solve = real;
  assert.ok(calls >= 2, `asked again after the cap (${calls} solves)`);
  assert.equal(report.solved, true);
  assert.ok(report.iterations >= 60, "the report counts every round");
  assert.equal(m.problem.solve().iterations, 0, "settled");
});

test("bug 83: a cut whose plate is not built is no body of its own — left out, said, and not drawn as a solid", async () => {
  await loadSolver();
  const m = new Model(3);
  const p = plate(m);
  const top = p.lid.slice(0, 3).join(".");
  const hole = extrude(m, circleOn(m, top, onTop(p, 30, 30), 5, p.t.uz), -T, { mode: "cut" });
  m.solve();
  // The plate's base corner lifted along the chord past the bar — the owner's
  // case, a drawing the kernel refuses as oblique — so the plate is not laid
  // out, and the cut has nothing to cut.
  const corner = p.base[0];
  m.setCoords(corner, m.coords(corner).map((c, i) => c + 2 * OFFENDING * p.t.uz[i]));
  const prog = programOf(m);
  assert.deepEqual(prog.program.bodies, [], "no body: the cut is not built as one (it was, as 'new' — a boss of the hole's shape)");
  assert.deepEqual(prog.skipped.map((s) => s.feature), [p.feature, hole]);
  assert.match(prog.skipped[1].why, new RegExp(`^${p.feature} is not built, so there is nothing for it to cut`));
  assert.deepEqual(prog.shells, [hole]);
  // What the face layer is handed: the cut's faces are nobody's to draw.
  const bodies = new Bodies(null, () => {});
  bodies.sync(m);
  assert.ok(bodies.drawn().replaces.has(hole), "the cut's faces are not drawn as a solid's");
  assert.ok(!bodies.drawn().replaces.has(p.feature), "the plate's own faces stand in for it, as a drawn-not-built body's do");
  // And the rows: both say not built, in the warning ink, with the reason.
  const refusals = bodies.refusals();
  assert.match(refusals.get(hole) ?? "", /cannot be laid out: e1 is not built/);
  const rows = organiserSections(m, [], null, refusals).find((s) => s.id === "features")!.rows;
  const row = rows.find((r) => r.name === hole)!;
  assert.equal(row.detail, "not built", "the word alone: the pane's width cuts a longer detail");
  assert.equal(row.warn, refusals.get(hole));
  assert.equal(rows.find((r) => r.name === p.feature)!.detail, "not built");
  assert.match(rows.find((r) => r.name === p.feature)!.warn ?? "", /oblique/, "the plate's row says why it was refused");
  // A record unbuilt by its own deletion says so as before, whatever the solids layer adds.
  del(m, m.featureOf(p.feature, "extrude").depth!);
  assert.equal(organiserSections(m, [], null, new Map([[p.feature, "x"]])).find((s) => s.id === "features")!.rows.find((r) => r.name === p.feature)!.detail, "extrude · unbuilt");
  assert.match(rowMenu(m, hole, [], null, refusals)!.header ?? "", /not built: e2 cannot be laid out/);
  // Without the word from the solids layer the rows are as they were.
  assert.equal(organiserSections(m).find((s) => s.id === "features")!.rows.find((r) => r.name === hole)!.detail, "extrude · cut");
});

// ---- the extrude's own flat-profile relation, e1_flat ------------------------------------

/** A free pentagon and a free box, drawn line by line and extruded — profiles nothing of the user's holds flat. */
async function freeProfiles(): Promise<{ m: Model; say: (s: string) => Promise<unknown> }> {
  await loadSolver();
  const m = new Model(3);
  const repl = new Repl(neocadScope({ model: m }));
  const say = async (src: string) => { const r = await repl.eval(src); if (!r.ok) throw new Error(`${src}: ${(r.error as Error | undefined)?.message}`); return r.value; };
  const pent = [0, 1, 2, 3, 4].map((i) => { const t = (i / 5) * 2 * Math.PI + 0.3; return [20 * Math.cos(t), 20 * Math.sin(t), 0]; });
  await say(pent.map((q, i) => `a${i} = pt(${q.map((c) => c.toFixed(6)).join(", ")})`).join("; "));
  await say('ln(a0, a1); ln(a1, a2); ln(a2, a3); ln(a3, a4); ln(a4, a0); extrude("l1", 30)');
  await say("b0 = pt(50, -15, 0); b1 = pt(80, -15, 0); b2 = pt(80, 15, 0); b3 = pt(50, 15, 0); bl = ln(b0, b1); ln(b1, b2); ln(b2, b3); ln(b3, b0); extrude(bl, 25)");
  m.solve();
  return { m, say };
}

test("e1_flat: an extrude of four points or more makes it, named for the record, one row per point from the fourth, the largest triangle first", async () => {
  const { m } = await freeProfiles();
  const pent = m.relationOf("e1_flat"), box = m.relationOf("e2_flat");
  assert.equal(pent.op, "profileFlat");
  assert.deepEqual(pent.args.slice(0, 1), ["e1"]);
  assert.equal(pent.args.length, 1 + 5, "every point of the pentagon, named — so a point deleted takes it");
  assert.equal(pent.blocks.length, 2, "five points: two rows");
  assert.equal(box.blocks.length, 1, "four points: one row");
  assert.equal(pent.twin, undefined, "not twinned: the lid is flat by the extrusion");
  assert.ok(![...m.relations.keys()].some((n) => n.startsWith("e1_flat_") || n.startsWith("e2_flat_")), "and no twin of it was made");
  // Listed as any relation is, described, and with a mark.
  assert.match(describeRelation(pent), /^e1_flat  flat e1 p\d+/);
  assert.equal(GLYPH_SYMBOL.profileFlat, "▱");
  assert.equal(m.solve().solved, true);
});

test("e1_flat: a triangle and a lone circle have nothing to hold and get none; a revolve makes none; 2D has no plane to be flat in", async () => {
  await loadSolver();
  const m = new Model(3);
  const repl = new Repl(neocadScope({ model: m }));
  const say = async (src: string) => { const r = await repl.eval(src); if (!r.ok) throw new Error(`${src}: ${(r.error as Error | undefined)?.message}`); return r.value; };
  await say('t0 = pt(0, 0, 0); t1 = pt(30, 0, 0); t2 = pt(0, 20, 0); ln(t0, t1); ln(t1, t2); ln(t2, t0); extrude("l1", 10)');
  await say("c = pt(60, 0, 0); circle(c, 8, [0, 0, 1]); extrude(\"c1\", 10)");
  await say("q0 = pt(100, 10, 0); q1 = pt(120, 10, 0); q2 = pt(120, 30, 0); q3 = pt(100, 30, 0); ql = ln(q0, q1); ln(q1, q2); ln(q2, q3); ln(q3, q0)");
  const turned = revolve(m, (await say("ql")) as string, "origin.y", Math.PI / 2);
  assert.deepEqual([...m.relations.keys()].filter((n) => n.endsWith("_flat")), [], "triangle, circle, revolve: none");
  assert.throws(() => profileFlat(m, "e1"), /3 points — it is flat already/);
  assert.throws(() => profileFlat(m, "e2"), /1 point — it is flat already/);
  assert.throws(() => profileFlat(m, turned), /no extrude/);
  assert.throws(() => profileFlat(new Model(2), "e1"), /2D/);
});

test("e1_flat: deletable like e1_perp — the deletion journalled and replayed — and with the perpendicular gone too, the extrude is the user's to lean", async () => {
  const { m } = await freeProfiles();
  const [, qa, qb, qc, qd] = m.relationOf("e2_flat").args as string[];
  assert.deepEqual(del(m, "e2_flat"), ["e2_flat"]);
  assert.equal(m.journal.at(-1)!.op, "deleteRelation");
  const back = openFile(save(m, false));
  assert.ok(!back.relations.has("e2_flat") && back.relations.has("e1_flat"), "replayed: the one deleted stays deleted, the other is made again under its name");
  // A closed polygon whose every edge is square to one chord is flat at
  // convergence all the same (`e2_perp`): a corner pulled up comes back.
  const corner = qd;
  const was = m.coords(corner);
  for (let i = 1; i <= 8; i++) m.solveFrame(pullTo(m, corner, [was[0], was[1], was[2] + i]));
  assert.equal(m.solve().solved, true);
  assert.ok(offPlane(m, qa, qb, qc, qd) < 1e-9, "still flat, by the perpendicular");
  // With the perpendicular deleted too, nothing holds the profile flat: it
  // leans — an oblique extrude, drawn and not built, as the user asked for.
  assert.deepEqual(del(m, "e2_perp"), ["e2_perp"]);
  // The corner and its twin seated 8 up (a drag's pull, released, has its
  // edges' lengths kept and the corner brought most of the way back — a
  // free box's answer to a hand; a seed is where a point is put): nothing
  // holds the profile flat now, and the solve leaves it where it is.
  const d2 = m.relationOf(m.featureOf("e2", "extrude").depth).args.slice(2) as string[];
  const twin = d2[d2.indexOf(qd) + 1];
  for (const q of [qd, twin]) m.setCoords(q, m.coords(q).map((c, i) => c + (i === 2 ? 8 : 0)));
  assert.equal(m.solve().solved, true);
  assert.ok(offPlane(m, qa, qb, qc, qd) > 5, `${offPlane(m, qa, qb, qc, qd)} off flat: nothing brings it back`);
  assert.throws(() => extrudeSpan(m, m.featureOf("e2", "extrude")), /oblique/);
  // The pentagon, still held: a corner pulled the same way comes back flat.
  const a = m.relationOf("e1_flat").args[1] as string;
  const at = m.coords(a);
  for (let i = 1; i <= 8; i++) m.solveFrame(pullTo(m, a, [at[0] + 0.4 * i, at[1] + 0.5 * i, at[2] + i]));
  assert.equal(m.solve().solved, true);
  const [, pa, pb, pc, pd, pe] = m.relationOf("e1_flat").args as string[];
  assert.ok(offPlane(m, pa, pb, pc, pd) < 1e-9 && offPlane(m, pa, pb, pc, pe) < 1e-9, "flat to 1e-9");
  assert.doesNotThrow(() => extrudeSpan(m, m.featureOf("e1", "extrude")));
});

test("e1_flat: one relation suffices for both profiles — a lid corner dragged leaves base and lid flat, the lid the base moved", async () => {
  const { m } = await freeProfiles();
  const f = m.featureOf("e1", "extrude");
  const pairs = m.relationOf(f.depth).args.slice(2) as string[];
  const twinOf = new Map<string, string>();
  for (let i = 0; i + 1 < pairs.length; i += 2) if (m.entities.get(pairs[i])?.kind === "point") twinOf.set(pairs[i], pairs[i + 1]);
  const [, pa, pb, pc, pd, pe] = m.relationOf("e1_flat").args as string[];
  const lidCorner = twinOf.get(pd)!;
  const was = m.coords(lidCorner);
  for (let i = 1; i <= 10; i++) m.solveFrame(pullTo(m, lidCorner, [was[0] + 0.6 * i, was[1] - 0.3 * i, was[2] + 0.8 * i]));
  assert.equal(m.solve().solved, true);
  assert.ok(offPlane(m, pa, pb, pc, pd) < 1e-9 && offPlane(m, pa, pb, pc, pe) < 1e-9, "the base is flat");
  const [la, lb, lc, ld, le] = [pa, pb, pc, pd, pe].map((q) => twinOf.get(q)!);
  assert.ok(offPlane(m, la, lb, lc, ld) < 1e-9 && offPlane(m, la, lb, lc, le) < 1e-9, "and so is the lid, by the extrusion alone");
  const chord = sub(m.coords(la), m.coords(pa));
  for (const q of [pb, pc, pd, pe]) assert.ok(len(sub(sub(m.coords(twinOf.get(q)!), m.coords(q)), chord)) < 1e-9, `${q}'s twin is it moved by the one chord`);
  assert.ok(len(sub(m.coords(lidCorner), was)) > 5, "and the prism moved with the hand, as a free body may");
});

test("e1_flat: a file from the build before opens with the relation on each extrude, its points where they were and its volumes the same", async () => {
  await loadSolver();
  const text = await readFile(new URL("./fixtures/flat-v23.neocad.json", import.meta.url), "utf8");
  const want = JSON.parse(await readFile(new URL("./fixtures/flat-v23.geometry.json", import.meta.url), "utf8")) as { version: number; points: Record<string, number[]>; volumes: Record<string, number> };
  assert.equal(JSON.parse(text).version, 23);
  const m = openFile(text);
  assert.deepEqual([...m.relations.keys()], ["d1", "e1_perp", "e1_flat", "d2", "e2_perp", "e2_flat"], "the names it had, and the flat relations gained at the replay step");
  assert.equal(m.solve().solved, true);
  for (const [q, at] of Object.entries(want.points)) assert.ok(len(sub(m.coords(q), at)) < 1e-9, `${q} where that build left it`);
  const own = Object.fromEntries(solidsOf(m).bodies.map((b) => [b.feature, b.volume]));
  for (const [f, v] of Object.entries(want.volumes)) assert.ok(Math.abs(own[f] - v) / v < 1e-9, `${f}'s volume`);
  assert.equal(JSON.parse(save(m, false)).version, 24, "and re-saves in the new form");
});

test("e1_flat: the owner's file opens with the plate held flat over its four corners, and the lens cut — three points — with none", async () => {
  const m = await ownersFile();
  assert.deepEqual(m.relationOf("e1_flat").args, ["e1", "p1", "p2", "p3", "p4"].slice(0, 1).concat((m.relationOf("e1_flat").args as string[]).slice(1)));
  assert.equal(m.relationOf("e1_flat").args.length, 5);
  assert.ok(!m.relations.has("e2_flat"));
  assert.equal(m.solve().solved, true);
  assert.equal(m.problem.solve().iterations, 0, "still settles");
});

test("e1_flat: a box drawn square by hand reads nothing more redundant with it than without — the feature agreeing with the drawing is not named", async () => {
  await loadSolver();
  const m = new Model(3);
  const repl = new Repl(neocadScope({ model: m }));
  const say = async (src: string) => { const r = await repl.eval(src); if (!r.ok) throw new Error(`${src}: ${(r.error as Error | undefined)?.message}`); return r.value; };
  await say('a0 = pt(0, 0, 0); a1 = pt(40, 0, 0); a2 = pt(40, 30, 0); a3 = pt(0, 30, 0); ln(a0, a1); ln(a1, a2); ln(a2, a3); ln(a3, a0)');
  await say('perp("l1","l2"); perp("l2","l3"); perp("l3","l4"); perp("l4","l1"); coplanar("p4","p1","p2","p3")');
  m.solve();
  const before = m.diagnose();
  await say('extrude("l1", 20)');
  m.solve();
  const after = m.diagnose();
  assert.ok(m.relations.has("e1_flat"));
  assert.deepEqual(after.redundant, before.redundant, `the same relations redundant (${before.redundant}), e1_flat not among them`);
  assert.deepEqual(after.agreeing.map((s) => [...s].sort()), before.agreeing.map((s) => [...s].sort()));
});
