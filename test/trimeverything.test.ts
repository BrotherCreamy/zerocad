// Trim every sketch curve (docs/plans/trim-everything.md). The owner: *"Also
// need trim for sketch entities"*.
//
// Each curve kind trimmed against the others: the right piece goes, and what
// is kept is the same curve it was — read back off the entity, against the
// curve as it stood before the trim, never through the relation that holds
// it. An ellipse's piece is an elliptical arc (`earc`); a spline's a spline of
// control points (`bspline`) — the piece of an interpolant is exactly a
// clamped B-spline, by knot insertion.

import { test } from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { ensureKernelLoaded } from "../src/kernel/problem.ts";
import { Model, isClosedEntity } from "../src/model.ts";
import { trim } from "../src/sketchedit.ts";
import { open, save } from "../src/persist.ts";
import { addEllipse, addEllipticArc } from "../src/kinds/ellipse.ts";
import { addBSpline } from "../src/kinds/spline.ts";
import { addSpline } from "../src/relations/spline.ts";
import { onEllipse } from "../src/relations/geometry.ts";
import { cutsOf, distanceToCurve, pointOn } from "../src/sketchgeom.ts";
import { curveFrame } from "../src/curveplane.ts";
import { arcPoint } from "../src/arcgeom.ts";
import "../src/modules/builtin.ts";

await ensureKernelLoaded(await readFile(new URL("../src/kernel/wasm-gen/neocad_kernel_bg.wasm", import.meta.url)));

const sub = (a: number[], b: number[]) => a.map((x, i) => x - b[i]);
const near = (a: number[], b: number[], tol = 1e-6) => Math.hypot(...sub(a, b)) <= tol;

function solved(m: Model) {
  const r = m.solve();
  assert.equal(r.solved, true, JSON.stringify(r.offenders));
  assert.ok(r.maxResidual < 1e-6, `max residual ${r.maxResidual}`);
  return r;
}

/** A line between two new points. */
function seg(m: Model, a: number[], b: number[]): string {
  const z = m.dim === 3 && a.length === 2 ? [0] : [];
  return m.addLine(m.addPoint([...a, ...z]).name, m.addPoint([...b, ...z]).name).name;
}

/** Save, open, save: the same text twice — the trim replays to the same model. */
function replays(m: Model): Model {
  const once = save(m);
  const back = open(once, m.dim);
  assert.equal(save(back), once, "the replay is the same model");
  return back;
}

/** How far `p` is from the ellipse with semi-axes a, b along x and y about `c` — zero on it. */
function offEllipse(p: number[], c: number[], a: number, b: number): number {
  return Math.abs(Math.hypot((p[0] - c[0]) / a, (p[1] - c[1]) / b) - 1);
}

test("an ellipse crossed by a line trims to an elliptical arc under its own name: the piece clicked goes, the rest is the same ellipse", () => {
  const m = new Model(2);
  const c = m.addPoint([0, 0]).name;
  const el = addEllipse(m, c, m.addPoint([20, 0]).name, 10).name;
  seg(m, [-30, 4], [30, 4]); // crosses the ellipse at y = 4, x = ±20·√(1 − 0.16)
  solved(m);
  const out = trim(m, el, [0, -10]); // the lower, larger piece goes
  assert.deepEqual(out, [el]);
  const e = m.entities.get(el)!;
  assert.equal(e.kind, "earc", "an elliptical arc, under the ellipse's name");
  const x = 20 * Math.sqrt(1 - 0.16);
  const arc = e as Extract<typeof e, { kind: "earc" }>;
  assert.ok(near(m.coords(arc.start), [x, 4]) && near(m.coords(arc.end), [-x, 4]), "kept: the top, start to end counter-clockwise");
  solved(m);
  // The kept piece is the same curve: every point along it on the old ellipse, and above the cut.
  const f = curveFrame(m, e)!;
  for (let k = 0; k <= 16; k++) {
    const p = arcPoint(f, (k / 16) * f.sweep);
    assert.ok(offEllipse(p, [0, 0], 20, 10) < 1e-9, `sample ${k} on the old ellipse`);
    assert.ok(p[1] >= 4 - 1e-9, `sample ${k} on the kept side: ${p}`);
  }
  replays(m);
});

// --- every kind against every kind ---------------------------------------------

/** Where a 2D drawing's (x, y) lands: the plane itself in 2D, a plane tipped in no frame's way in 3D. */
interface Sheet { at: (x: number, y: number) => number[]; normal: number[] | null }

function sheet(dim: 2 | 3): Sheet {
  if (dim === 2) return { at: (x, y) => [x, y], normal: null };
  const unit = (v: number[]) => { const l = Math.hypot(...v); return v.map((x) => x / l); };
  const u = unit([1, 0, 0.4]);
  const w = [0, 1, 0.3];
  const d = w.reduce((s, x, i) => s + x * u[i], 0);
  const v = unit(w.map((x, i) => x - d * u[i]));
  const n = [u[1] * v[2] - u[2] * v[1], u[2] * v[0] - u[0] * v[2], u[0] * v[1] - u[1] * v[0]];
  const o = [1, 2, 3];
  return { at: (x, y) => o.map((c, i) => c + x * u[i] + y * v[i]), normal: n };
}

type Build = (m: Model, s: Sheet) => string;
const pt = (m: Model, s: Sheet, x: number, y: number) => m.addPoint(s.at(x, y)).name;
const deg = Math.PI / 180;

const line = (a: [number, number], b: [number, number]): Build => (m, s) => m.addLine(pt(m, s, ...a), pt(m, s, ...b)).name;
const arc = (c: [number, number], r: number, from: number, to: number): Build => (m, s) =>
  m.addArc(pt(m, s, ...c), pt(m, s, c[0] + r * Math.cos(from * deg), c[1] + r * Math.sin(from * deg)),
    pt(m, s, c[0] + r * Math.cos(to * deg), c[1] + r * Math.sin(to * deg)), r, s.normal).name;
const circle = (c: [number, number], r: number): Build => (m, s) => m.addCircle(pt(m, s, ...c), r, s.normal).name;
/** An ellipse: semi-axis `a` toward `dir` (degrees), `b` across. */
const ellipse = (c: [number, number], a: number, b: number, dir = 0): Build => (m, s) =>
  addEllipse(m, pt(m, s, ...c), pt(m, s, c[0] + a * Math.cos(dir * deg), c[1] + a * Math.sin(dir * deg)), b, s.normal).name;
/** An elliptical arc of the same, from eccentric anomaly `from` to `to` (degrees), its ends held on it. */
const earc = (c: [number, number], a: number, b: number, dir: number, from: number, to: number): Build => (m, s) => {
  const [ux, uy] = [Math.cos(dir * deg), Math.sin(dir * deg)];
  const at = (t: number) => [c[0] + a * Math.cos(t * deg) * ux - b * Math.sin(t * deg) * uy, c[1] + a * Math.cos(t * deg) * uy + b * Math.sin(t * deg) * ux] as [number, number];
  const [st, en] = [pt(m, s, ...at(from)), pt(m, s, ...at(to))];
  const e = addEllipticArc(m, pt(m, s, ...c), pt(m, s, c[0] + a * ux, c[1] + a * uy), b, st, en, s.normal).name;
  onEllipse(m, st, e);
  onEllipse(m, en, e);
  return e;
};
const spline = (...p: [number, number][]): Build => (m, s) => addSpline(m, p.map((q) => pt(m, s, ...q)));
const bspline = (knots: number[], ...p: [number, number][]): Build => (m, s) => addBSpline(m, p.map((q) => pt(m, s, ...q)), knots).name;

/** What is trimmed: each kind once, about the origin and about 30 across. */
const TARGETS: Record<string, Build> = {
  line: line([-20, -1], [20, 1]),
  arc: arc([0, -20], 24, 45, 135),
  circle: circle([0, 0], 10),
  ellipse: ellipse([0, 0], 15, 7),
  earc: earc([0, 0], 15, 7, 0, 20, 170),
  spline: spline([-15, -4], [-5, 5], [5, -5], [15, 4]),
  bspline: bspline([0, 0, 0, 0, 0.5, 1, 1, 1, 1], [-15, 2], [-8, -9], [0, 9], [8, -9], [15, 2]),
};

/** What cuts it: each kind once, standing across the targets near x = 3. */
const CUTTERS: Record<string, Build> = {
  line: line([3, -14], [4, 14]),
  arc: arc([40, 0], 37, 158, 202),
  circle: circle([3, 1], 11),
  ellipse: ellipse([3, 0], 13, 6, 90),
  earc: earc([3, 0], 13, 6, 90, 20, 160),
  spline: spline([3, -14], [1, -5], [5, 5], [3, 14]),
  bspline: bspline([0, 0, 0, 0, 0.5, 1, 1, 1, 1], [6, -14], [0, -6], [6, 0], [0, 6], [6, 14]),
};

/** Trims `target`'s first piece where `cutter` crosses it, and checks it: the piece gone, what is kept the same curve. */
function trimmedAgainst(dim: 2 | 3, target: string, cutter: string): void {
  const m = new Model(dim);
  const s = sheet(dim);
  const t = TARGETS[target](m, s);
  CUTTERS[cutter](m, s);
  solved(m);
  const closed = isClosedEntity(m.entities.get(t)!);
  const cuts = cutsOf(m, t);
  assert.ok(cuts.length >= (closed ? 2 : 1), `${cutter} cuts ${target} ${cuts.length} times`);
  // The piece from the curve's start (a closed one's: from its first cut) to the next cut.
  const [a, b] = closed ? [cuts[0].t, cuts[1].t] : [0, cuts[0].t];
  const place = pointOn(m, t, (a + b) / 2);
  const before = open(save(m), dim);
  const out = trim(m, t, place);
  const size = 30;
  for (const n of out) {
    for (let k = 0; k <= 40; k++) {
      const p = pointOn(m, n, k / 40);
      const d = distanceToCurve(before, t, p);
      assert.ok(d < 1e-6 * size, `${dim}D ${target}×${cutter}: ${n} at ${k / 40} is ${d} off the ${target} it was`);
    }
    assert.ok(distanceToCurve(m, n, place) > 1e-3 * size, `${dim}D ${target}×${cutter}: the piece clicked is gone from ${n}`);
  }
  solved(m);
  replays(m);
}

/** How a test's title names each kind. */
const NOUN: Record<string, string> = {
  line: "a line", arc: "an arc", circle: "a circle", ellipse: "an ellipse", earc: "an elliptical arc",
  spline: "a spline", bspline: "a spline of control points",
};

for (const dim of [2, 3] as const) {
  for (const target of Object.keys(TARGETS)) {
    test(`${dim}D: ${NOUN[target]} trimmed by each kind — the piece goes, the rest is the curve it was, and it replays`, () => {
      for (const cutter of Object.keys(CUTTERS)) trimmedAgainst(dim, target, cutter);
    });
  }
}
