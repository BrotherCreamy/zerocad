// The edge extrude (docs/plans/profiles-held.md): an edge E and a chord give
// its copy E′ — every point moved by the chord, every size and normal the same
// — the end chords base to copy, and the surface between them, derived. The
// owner: *"Edge extrude is a fundamental feature."* And a profile extrude is
// the edge extrude of every edge of the profile sharing one chord, which the
// last tests here check point for point.

import { test } from "node:test";
import assert from "node:assert/strict";
import "../src/modules/builtin.ts";
import { Model } from "../src/model.ts";
import { del, extrude, set } from "../src/operations.ts";
import { open, save } from "../src/persist.ts";
import { programOf } from "../src/bodies.ts";
import { describeSurface, isEdgeExtrude } from "../src/surfaces.ts";
import { neocadScope } from "../src/replenv.ts";
import { radius } from "../src/relations/geometry.ts";
import { pullTo } from "../src/tools/engine.ts";
import { Evaluator, type BodyResult } from "../src/solids/evaluate.ts";
import { kernel, noKernel as skip } from "./solids/load.ts";
import { loadSolver } from "./solids/scene.ts";
import { baseOf } from "./profiles.ts";

type Fn = (...a: unknown[]) => unknown;
const sub = (a: number[], b: number[]) => a.map((x, i) => x - b[i]);
const dot = (a: number[], b: number[]) => a.reduce((s, x, i) => s + x * b[i], 0);
const len = (a: number[]) => Math.hypot(...a);

function scene(): { m: Model; s: Record<string, Fn> } {
  const m = new Model(3);
  return { m, s: neocadScope({ model: m }) as Record<string, Fn> };
}

/** An L of two lines on the ground, sharing a corner: (0,0) → (30,0) → (30,20). */
function ell(m: Model): { pts: string[]; lines: string[] } {
  const pts = [[0, 0, 0], [30, 0, 0], [30, 20, 0]].map((c) => m.addPoint(c).name);
  return { pts, lines: [m.addLine(pts[0], pts[1]).name, m.addLine(pts[1], pts[2]).name] };
}

/** Each base point's copy, read off the record's extrusion. */
function copies(m: Model, record: string): Map<string, string> {
  const d = m.surfaceOf(record).size!;
  return new Map([...baseOf(m, d)].filter(([t]) => m.entities.get(t)?.kind === "point").map(([t, b]) => [b, t]));
}

/** The worst way the copy is not its base moved by one chord, square to the curves and the depth long. */
function edgeError(m: Model, record: string, lines: string[]): { translated: number; square: number; depth: number } {
  const d = m.relationOf(m.surfaceOf(record).size!).args[1] as number;
  const chords = [...copies(m, record)].map(([b, t]) => sub(m.coords(t), m.coords(b)));
  const dirs = lines.map((l) => sub(...(m.line(l).refs.map((p) => m.coords(p)).reverse() as [number[], number[]])));
  return {
    translated: Math.max(...chords.map((c) => len(sub(c, chords[0])))),
    square: Math.max(...chords.flatMap((c) => dirs.map((u) => Math.abs(dot(c, u)) / len(u)))),
    depth: Math.max(...chords.map((c) => Math.abs(len(c) - Math.abs(d)))),
  };
}

function assertEdge(m: Model, record: string, lines: string[], what: string, tol = 1e-7): void {
  const e = edgeError(m, record, lines);
  for (const [k, v] of Object.entries(e)) assert.ok(v <= tol, `${what}: ${k} off by ${v} — ${JSON.stringify(e)}`);
}

function drag(m: Model, point: string, by: number[], frames = 12): boolean {
  const from = m.coords(point);
  for (let k = 1; k <= frames; k++) m.solveFrame(pullTo(m, point, from.map((c, i) => c + (by[i] * k) / frames)));
  return m.solve().solved;
}

test("edgeExtrude(chain, depth): a copy of every curve, a chord at every end, one depth and its perpendicular — and a record", async () => {
  await loadSolver();
  const { m, s } = scene();
  const { pts, lines } = ell(m);
  const [entities, relations] = [m.entities.size, m.relations.size];
  const name = s.edgeExtrude(lines[0], 10) as string;
  assert.equal(name, "s1");
  const rec = m.surfaceOf(name);
  assert.ok(isEdgeExtrude(m, rec));
  assert.deepEqual(rec.curves, lines);
  // Three points copied, two lines copied, three chords: eight entities.
  assert.equal(m.entities.size - entities, 3 + 2 + 3);
  // The depth, and the chord square to the curves — named for the record, so it claims no r.
  assert.equal(m.relations.size - relations, 2);
  assert.equal(m.relationOf(rec.size!).op, "extrusion");
  assert.equal(m.relationOf("s1_perp").op, "perpendicular");
  assert.equal(m.solve().solved, true);
  for (const [b, t] of copies(m, name)) assert.ok(len(sub(m.coords(t), [...m.coords(b).slice(0, 2), 10])) < 1e-9, `${b}'s copy 10 up`);
  assert.equal(copies(m, name).size, pts.length);
  assertEdge(m, name, lines, "as made");
  assert.match(describeSurface(m, rec), /^s1  edge extrude of l1 l2, depth d\d+ = 10$/);
  // Nothing it made is said twice.
  assert.deepEqual(m.diagnose().redundant, []);
});

test("both ways: a copy's corner dragged drags its base with it, and the chords stay one chord, square, the depth long", async () => {
  await loadSolver();
  for (const [which, by] of [["copy", [5, -4, 6]], ["base", [0, 3, -7]], ["copy", [-8, 2, -3]]] as const) {
    const { m, s } = scene();
    const { pts, lines } = ell(m);
    s.edgeExtrude(lines[0], 10);
    m.solve();
    const tw = copies(m, "s1");
    const point = which === "copy" ? tw.get(pts[2])! : pts[0];
    const was = m.coords(point);
    assert.equal(drag(m, point, [...by]), true, `${which} by ${by}: solves`);
    assert.ok(len(sub(m.coords(point), was)) > 1, "it went somewhere");
    assertEdge(m, "s1", lines, `${which} by ${by}`);
  }
});

test("set(depth): the copy moves, the base stays — across zero too; and an arc's copy keeps its radius as the base's changes", async () => {
  await loadSolver();
  const { m, s } = scene();
  const a = m.addPoint([0, 0, 0]).name, b = m.addPoint([20, 0, 0]).name;
  const l = m.addLine(a, b).name;
  const arc = m.addArc(m.addPoint([20, 10, 0]).name, b, m.addPoint([30, 10, 0]).name, 10, [0, 0, 1]).name;
  s.edgeExtrude([l, arc], 8);
  assert.equal(m.solve().solved, true);
  const d = m.surfaceOf("s1").size!;
  const tw = copies(m, "s1");
  for (const depth of [15, -6]) {
    set(m, `${d}.value`, depth);
    assert.equal(m.solve().solved, true);
    assert.ok(len(sub(m.coords(a), [0, 0, 0])) < 1e-9, `${depth}: the base stayed`);
    assert.ok(Math.abs(m.coords(tw.get(a)!)[2] - depth) < 1e-9, `${depth}: the copy at ${depth}`);
  }
  const copyArc = m.surfaceOf("s1").owns.find((n) => m.entities.get(n)?.kind === "arc")!;
  radius(m, arc, 12);
  assert.equal(m.solve().solved, true);
  assert.ok(Math.abs(m.radius(copyArc) - 12) < 1e-9, `the copy's radius followed: ${m.radius(copyArc)}`);
});

// Until linked profiles `del("s1")` took what the record made. Nothing is
// owned now (docs/plans/linked-profiles.md, item 4): the record goes with the
// relation that is the edge extrude, and the copies and the end chords stay.
test("s1_perp is an ordinary relation: deleted, the record stays; del of the record takes its extrusion and leaves the curves and their copies", async () => {
  await loadSolver();
  const { m, s } = scene();
  const { pts, lines } = ell(m);
  s.edgeExtrude(lines[0], 10);
  assert.deepEqual(del(m, "s1_perp"), ["s1_perp"]);
  assert.ok(m.surfaces.has("s1"));
  const made = m.surfaceOf("s1").owns;
  const depth = m.surfaceOf("s1").size!;
  const removed = del(m, "s1");
  assert.deepEqual(new Set(removed), new Set(["s1", depth]), "the record and the relation that is it");
  for (const n of [...pts, ...lines]) assert.ok(m.entities.has(n), `${n} kept`);
  for (const n of made) if (n !== depth) assert.ok(m.entities.has(n), `${n}, which it made, is plain geometry now`);
  assert.equal(m.solve().solved, true);
});

test("save and open: replayed name for name, journalled as edgeExtrude, and re-saved byte for byte", async () => {
  await loadSolver();
  const { m, s } = scene();
  const { lines } = ell(m);
  s.edgeExtrude(lines[0], 10);
  m.solve();
  const text = save(m);
  assert.ok(text.includes('"edgeExtrude"'));
  const back = open(text);
  assert.deepEqual([...back.surfaces.values()], [...m.surfaces.values()]);
  assert.deepEqual([...back.relations.keys()], [...m.relations.keys()]);
  for (const n of m.entities.keys()) if (m.entities.get(n)!.kind === "point") assert.deepEqual(back.coords(n), m.coords(n), n);
  assert.equal(save(back), text);
});

test("a profile extrude is the edge extrude of every edge of its profile, sharing one chord: the same copies, point for point", async () => {
  await loadSolver();
  const square = (m: Model) => {
    const P = [[0, 0, 0], [30, 0, 0], [30, 20, 0], [0, 20, 0]].map((c) => m.addPoint(c).name);
    return { P, L: P.map((p, i) => m.addLine(p, P[(i + 1) % 4]).name) };
  };
  const a = new Model(3), b = new Model(3);
  const A = square(a), B = square(b);
  const f = a.featureOf(extrude(a, A.L[0], 12), "extrude");
  (neocadScope({ model: b }) as Record<string, Fn>).edgeExtrude(B.L[0], 12);
  a.solve(); b.solve();
  const fa = new Map([...baseOf(a, f.depth)].map(([t, base]) => [base, t]));
  const fb = copies(b, "s1");
  for (let i = 0; i < 4; i++) assert.ok(len(sub(a.coords(fa.get(A.P[i])!), b.coords(fb.get(B.P[i])!))) < 1e-12, `corner ${i}`);
  // And they are held alike: one dimension of the same op, one perpendicular to the record.
  assert.equal(a.relationOf(f.depth).op, b.relationOf(b.surfaceOf("s1").size!).op);
  assert.equal(a.relationOf(`${f.name}_perp`).op, b.relationOf("s1_perp").op);
});

// ---- the sheet, by the kernel -------------------------------------------------------

async function evaluate(m: Model, name = "s1"): Promise<BodyResult> {
  const ev = new Evaluator(await kernel());
  const r = ev.run(programOf(m).program).bodies.find((x) => x.name === name);
  ev.clear();
  assert.ok(r, `${name} is a body of the program`);
  return r;
}

test("the sheet between E and E′ is built: length × depth, and it follows a dragged copy", { skip }, async () => {
  await loadSolver();
  const { m, s } = scene();
  const { pts, lines } = ell(m);
  s.edgeExtrude(lines[0], 10);
  m.solve();
  const area = (r: BodyResult) => { assert.ok(r.solid, JSON.stringify(r.failed)); return r.solid.faces.reduce((x, f) => x + f.area, 0); };
  assert.ok(Math.abs(area(await evaluate(m)) - 50 * 10) < 1e-6);
  // The whole thing turned by a drag of a copy's corner: the sheet is laid out along the chord, so its area is the same.
  assert.equal(drag(m, copies(m, "s1").get(pts[2])!, [6, 0, 4]), true);
  const chord = sub(m.coords(copies(m, "s1").get(pts[0])!), m.coords(pts[0]));
  const lengths = lines.map((l) => len(sub(...(m.line(l).refs.map((p) => m.coords(p)) as [number[], number[]]))));
  assert.ok(Math.abs(area(await evaluate(m)) - (lengths[0] + lengths[1]) * len(chord)) < 1e-6);
});
