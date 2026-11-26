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
import { programOf } from "../src/bodies.ts";
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
