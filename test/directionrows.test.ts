// A direction relation turns lines and never scales them
// (docs/plans/review-solver.md, item 1 of the review against the owner's
// principle). Measured before the rows were normalised: `par` typed between
// two free lines 60.1 and 60.8 long left them 8.8 and 1.2 long, SOLVED
// (docs/images/422) — the row was |u||v|·sin, and shortening either line
// lowered it, so the solve paid for the parallel mostly in length.
//
// Three things are asked here, each in 2D and in 3D:
// - of every row that reads a line for its direction: its gradient along that
//   line is zero (so it cannot be met by a change of length), and the dual
//   numbers' gradient is the finite differences' (so it is still exact);
// - of the solve: the spec's measurements, as assertions — the two free lines
//   under each relation, a drag, the rectangle, the prism;
// - of the places a sine or a cosine is flat: a `par` on two lines exactly
//   square, a `perp` on two exactly parallel, an `ang` on two along one line
//   — each turns, where the normalised sine and cosine would have had no
//   gradient and the raw ones only the one that shortens a line.

import { test } from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { ensureKernelLoaded } from "../src/kernel/problem.ts";
import { Dual } from "../src/kernel/dual.ts";
import { Model } from "../src/model.ts";
import { coplanar, dist, fix } from "../src/relations/basic.ts";
import { angle, collinear, parallel, perpendicular, pointOnLine, symmetric, tangent } from "../src/relations/geometry.ts";
import { angle3 } from "../src/relations/smartdim.ts";
import { extrude } from "../src/operations.ts";
import { open } from "../src/persist.ts";
import { pullTo } from "../src/tools/engine.ts";
import { baseOf } from "./profiles.ts";
import "../src/modules/builtin.ts";

await ensureKernelLoaded(await readFile(new URL("../src/kernel/wasm-gen/neocad_kernel_bg.wasm", import.meta.url)));

const sub = (a: number[], b: number[]) => a.map((x, i) => x - b[i]);
const dot = (a: number[], b: number[]) => a.reduce((s, x, i) => s + x * b[i], 0);
const cross = (a: number[], b: number[]) => [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]];
const len = (a: number[]) => Math.hypot(...a);
const lengthOf = (m: Model, l: string) => len(sub(m.coords(m.line(l).refs[1]), m.coords(m.line(l).refs[0])));
/** The sine of the angle between two lines, as lines: 0 when parallel either way round. By the cross product: √(1 − cos²) is noise near a root. */
function sinBetween(m: Model, a: string, b: string): number {
  const u = sub(m.coords(m.line(a).refs[1]), m.coords(m.line(a).refs[0])), v = sub(m.coords(m.line(b).refs[1]), m.coords(m.line(b).refs[0]));
  const pad = (w: number[]) => [w[0], w[1], w[2] ?? 0];
  return len(cross(pad(u), pad(v))) / (len(u) * len(v));
}
const cosBetween = (m: Model, a: string, b: string) => {
  const u = sub(m.coords(m.line(a).refs[1]), m.coords(m.line(a).refs[0])), v = sub(m.coords(m.line(b).refs[1]), m.coords(m.line(b).refs[0]));
  return dot(u, v) / (len(u) * len(v));
};

/** The drawing of docs/images/422: two free lines, as `ln(pt(-30, 0), pt(30, 4)); ln(pt(-30, 25), pt(30, 15))` leaves them. */
function twoLines(dim: number, lift = false): Model {
  const m = new Model(dim);
  // `lift` takes the four ends off any one plane, so a 3D row is asked about three components, not one.
  const z = (h: number) => (dim === 3 ? [lift ? h : 0] : []);
  m.addPoint([-30, 0, ...z(3)], "p1"); m.addPoint([30, 4, ...z(-5)], "p2");
  m.addPoint([-30, 25, ...z(11)], "p3"); m.addPoint([30, 15, ...z(2)], "p4");
  m.addLine("p1", "p2", "l1"); m.addLine("p3", "p4", "l2");
  return m;
}

// --- the bug, and the spec's first measurement ---------------------------------------------------

/** Each relation of two free lines, with the lines it reads for their direction and so must not scale. */
const TURNS: [string, string[], (m: Model) => void, (m: Model) => number][] = [
  ["par(l1, l2)", ["l1", "l2"], (m) => { parallel(m, "l1", "l2"); }, (m) => sinBetween(m, "l1", "l2")],
  ["perp(l1, l2)", ["l1", "l2"], (m) => { perpendicular(m, "l1", "l2"); }, (m) => Math.abs(cosBetween(m, "l1", "l2"))],
  ["ang(l1, l2, 60°)", ["l1", "l2"], (m) => { angle(m, "l1", "l2", Math.PI / 3); }, (m) => Math.abs(cosBetween(m, "l1", "l2") - 0.5)],
  ["col(l1, l2)", ["l1", "l2"], (m) => { collinear(m, "l1", "l2"); }, (m) => sinBetween(m, "l1", "l2")],
  // `on` and `sym` move p3 and p4, which are l2's ends: l2's length is theirs to change, l1's is not.
  ["on(p3, l1)", ["l1"], (m) => { pointOnLine(m, "p3", "l1"); }, () => 0],
  ["sym(p3, p4, l1)", ["l1"], (m) => { symmetric(m, "p3", "p4", "l1"); }, () => 0],
  ["par(l1, origin.x)", ["l1"], (m) => { parallel(m, "l1", "origin.x"); }, () => 0],
  ["dist(p3, l1, 10)", ["l1"], (m) => { dist(m, "p3", "l1", 10); }, () => 0],
];

for (const dim of [2, 3]) {
  for (const [name, lines, add, off] of TURNS) {
    test(`${dim}D: ${name} between free lines turns them — ${lines.join(" and ")} keep${lines.length > 1 ? "" : "s"} length to 1e-6 of it`, () => {
      const m = twoLines(dim, true);
      const was = lines.map((l) => lengthOf(m, l));
      add(m);
      const report = m.solve();
      assert.equal(report.solved, true, JSON.stringify(report.offenders));
      assert.ok(off(m) < 1e-9, `and the relation holds: off by ${off(m)}`);
      lines.forEach((l, i) => {
        const now = lengthOf(m, l);
        assert.ok(Math.abs(now - was[i]) / was[i] < 1e-6, `${l} was ${was[i].toFixed(6)} long and is ${now.toFixed(6)}`);
      });
    });
  }

  test(`${dim}D: a drag of one end of a par pair leaves the line not touched within 5% of its length (it lost 47%)`, () => {
    // Not 1e-6: a frame is one solve of the kernel's, and its step moves each
    // end along a straight line weighted coordinate by coordinate, which is
    // not a turn. The row no longer asks for the shortening; the step still
    // costs a little (measured 3.1%). A pull on the size cannot be added to a
    // frame: it would move a free rectangle whole under a dragged corner
    // instead of resizing it (`Model.solveFrame`).
    const m = twoLines(dim);
    m.setCoords("p4", dim === 3 ? [30, 29, 0] : [30, 29]);
    parallel(m, "l1", "l2");
    assert.equal(m.solve().solved, true);
    const was = lengthOf(m, "l2");
    const from = m.coords("p2");
    const by = dim === 3 ? [0, 20, 0] : [0, 20];
    for (let k = 1; k <= 12; k++) m.solveFrame(pullTo(m, "p2", from.map((c, i) => c + (by[i] * k) / 12)));
    assert.equal(m.solve().solved, true);
    assert.ok(sinBetween(m, "l1", "l2") < 1e-9, "still parallel");
    assert.ok(len(sub(m.coords("p2"), from.map((c, i) => c + by[i]))) < 1e-6, "and the end is under the hand");
    const now = lengthOf(m, "l2");
    assert.ok(Math.abs(now - was) / was < 0.05, `l2 was ${was.toFixed(3)} long and is ${now.toFixed(3)}`);
  });
}

// --- where a sine or a cosine is flat -------------------------------------------------------------

for (const dim of [2, 3]) {
  const z = dim === 3 ? [0] : [];
  /** Two free lines from the same four corners: `square` at a right angle, else along one line's direction. */
  const pair = (square: boolean): Model => {
    const m = new Model(dim);
    m.addPoint([0, 0, ...z], "a"); m.addPoint([40, 0, ...z], "b");
    m.addPoint([50, 5, ...z], "c"); m.addPoint(square ? [50, 35, ...z] : [80, 5, ...z], "d");
    m.addLine("a", "b", "l1"); m.addLine("c", "d", "l2");
    return m;
  };

  test(`${dim}D: par on two lines exactly square turns them — a sine is flat there, an angle is not`, () => {
    const m = pair(true);
    const r = parallel(m, "l1", "l2");
    const report = m.solve();
    assert.equal(report.solved, true, `CONFLICT ${m.conflicting(report).relations} — ${JSON.stringify(report.offenders)}`);
    assert.ok(sinBetween(m, "l1", "l2") < 1e-9);
    assert.ok(Math.abs(lengthOf(m, "l1") - 40) < 1e-4 && Math.abs(lengthOf(m, "l2") - 30) < 1e-4, `${lengthOf(m, "l1")}, ${lengthOf(m, "l2")}`);
    void r;
  });

  test(`${dim}D: perp on two lines exactly parallel turns them — a cosine is flat there`, () => {
    const m = pair(false);
    perpendicular(m, "l1", "l2");
    const report = m.solve();
    assert.equal(report.solved, true, JSON.stringify(report.offenders));
    assert.ok(Math.abs(cosBetween(m, "l1", "l2")) < 1e-9);
    assert.ok(Math.abs(lengthOf(m, "l1") - 40) < 1e-4 && Math.abs(lengthOf(m, "l2") - 30) < 1e-4, `${lengthOf(m, "l1")}, ${lengthOf(m, "l2")}`);
  });

  test(`${dim}D: ang of 30° on two lines exactly parallel turns them — and on two exactly opposite`, () => {
    for (const flip of [false, true]) {
      const m = pair(false);
      if (flip) { const [c, d] = [m.coords("c"), m.coords("d")]; m.setCoords("c", d); m.setCoords("d", c); }
      angle(m, "l1", "l2", Math.PI / 6);
      const report = m.solve();
      assert.equal(report.solved, true, `${flip ? "opposite" : "parallel"}: ${JSON.stringify(report.offenders)}`);
      assert.ok(Math.abs(cosBetween(m, "l1", "l2") - Math.cos(Math.PI / 6)) < 1e-9, `${flip ? "opposite" : "parallel"}: cos ${cosBetween(m, "l1", "l2")}`);
      assert.ok(Math.abs(lengthOf(m, "l1") - 40) < 1e-4 && Math.abs(lengthOf(m, "l2") - 30) < 1e-4);
    }
  });

  test(`${dim}D: ang3 on three points in a line opens the angle`, () => {
    const m = new Model(dim);
    m.addPoint([0, 0, ...z], "v"); m.addPoint([40, 0, ...z], "a"); m.addPoint([25, 0, ...z], "b");
    angle3(m, "v", "a", "b", Math.PI / 4);
    assert.equal(m.solve().solved, true);
    const [u, w] = [sub(m.coords("a"), m.coords("v")), sub(m.coords("b"), m.coords("v"))];
    assert.ok(Math.abs(dot(u, w) / (len(u) * len(w)) - Math.SQRT1_2) < 1e-9);
  });
}

// --- every normalised row: its gradient along its lines is zero, and is the finite differences' --------

interface Captured { vars: number[]; fn: (l: Dual[]) => Dual[]; label: string }

/** The blocks `add` adds, as the kernel was handed them, with their variables as they stand. */
function blocksOf(m: Model, add: () => void): Captured[] {
  const out: { v: number[] | (() => number[]); fn: (l: Dual[]) => Dual[]; label: string }[] = [];
  const real = m.problem.addResidual.bind(m.problem);
  m.problem.addResidual = (v, fn, label) => { out.push({ v, fn, label: label ?? "" }); return real(v, fn, label); };
  try { add(); } finally { m.problem.addResidual = real; }
  return out.map((b) => ({ vars: typeof b.v === "function" ? b.v() : b.v, fn: b.fn, label: b.label }));
}

/** A block's rows and their gradients, by the dual numbers, at the model's values. */
function rowsAt(m: Model, b: Captured): Dual[] {
  return b.fn(b.vars.map((i, slot) => Dual.variable(m.problem.getVar(i), slot)));
}

/**
 * A row's derivative in one of the model's variables. A block may read a
 * variable in more than one place (a profile corner is two edges' end, and
 * the chord's), each its own slot of the gradient: this is their sum.
 */
function partial(row: Dual, b: Captured, gi: number): number {
  let d = 0;
  b.vars.forEach((v, slot) => { if (v === gi) d += row.grad.get(slot) ?? 0; });
  return d;
}

/** The same rows' values with variable `slot` moved by `h`: what a finite difference reads. */
function valuesAt(m: Model, b: Captured, slot: number, h: number): number[] {
  return b.fn(b.vars.map((i, s) => Dual.constant(m.problem.getVar(i) + (s === slot ? h : 0)))).map((r) => r.val);
}

/**
 * A line a row must not scale, as its two points, and how that is asked:
 * - `ends` (the default): either end slid along the line alone changes
 *   nothing — a row that reads the line for its direction, or as an infinite
 *   line;
 * - `scale`: the two ends moved apart about the middle changes nothing — a
 *   row that reads the line for its direction and its middle (`col`'s second
 *   line), which sliding one end would move;
 * - `ray`: the second point slid along the line changes nothing, the first
 *   being something else's as well (the end a line shares with an arc).
 */
type Segment = [string, string] | [string, string, "ends" | "scale" | "ray"];

/**
 * Asserts, of every row of every block: its gradient is the central
 * difference's, and its derivative along each of `segments` is zero.
 */
function checkRows(m: Model, blocks: Captured[], segments: Segment[], what: string): void {
  assert.ok(blocks.length > 0, `${what}: no block`);
  // Take the values the rows are scaled by, as a solve would on beginning (a row's scale must not move under the differences).
  m.valueBefore(0);
  for (const b of blocks) {
    const rows = rowsAt(m, b);
    const scale = Math.max(1, ...rows.flatMap((r) => [...r.grad.values()].map(Math.abs)));
    rows.forEach((row, k) => {
      b.vars.forEach((_, slot) => {
        const h = 1e-5;
        const fd = (valuesAt(m, b, slot, h)[k] - valuesAt(m, b, slot, -h)[k]) / (2 * h);
        const ad = row.grad.get(slot) ?? 0;
        assert.ok(Math.abs(fd - ad) < 1e-6 * scale, `${what} ${b.label} row ${k}: d/d(var ${slot}) is ${ad} by the duals and ${fd} by differences`);
      });
      for (const [a, c, how = "ends"] of segments) {
        const [pa, pc] = [m.point(a).varIndices, m.point(c).varIndices];
        const u = sub(m.coords(c), m.coords(a));
        // The row's derivative as `a` moves by `wa`·u and `c` by `wc`·u.
        const slide = (wa: number, wc: number) => {
          let d = 0;
          pa.forEach((gi, i) => { d += partial(row, b, gi) * u[i] * wa; });
          pc.forEach((gi, i) => { d += partial(row, b, gi) * u[i] * wc; });
          return d;
        };
        const moves = how === "scale" ? [slide(-0.5, 0.5)] : how === "ray" ? [slide(0, 1)] : [slide(1, 0), slide(0, 1)];
        for (const along of moves) {
          assert.ok(Math.abs(along) < 1e-9 * scale * len(u), `${what} ${b.label} row ${k}: lengthening ${a}–${c} (${how}) changes it at ${along} per unit`);
        }
      }
    });
  }
}

for (const dim of [2, 3]) {
  const L1: Segment = ["p1", "p2"], L2: Segment = ["p3", "p4"];
  const CASES: [string, (m: Model) => void, Segment[]][] = [
    ["par(l1, l2)", (m) => { parallel(m, "l1", "l2"); }, [L1, L2]],
    ["par(p1, p2, l2)", (m) => { parallel(m, "p1", "p2", "l2"); }, [L1, L2]],
    ["par(l1, origin.x)", (m) => { parallel(m, "l1", "origin.x"); }, [L1]],
    ["perp(l1, l2)", (m) => { perpendicular(m, "l1", "l2"); }, [L1, L2]],
    ["perp(l1, origin.y)", (m) => { perpendicular(m, "l1", "origin.y"); }, [L1]],
    ["ang(l1, l2, 50°)", (m) => { angle(m, "l1", "l2", (50 * Math.PI) / 180); }, [L1, L2]],
    ["ang(l1, origin.x, 20°)", (m) => { angle(m, "l1", "origin.x", (20 * Math.PI) / 180); }, [L1]],
    ["on(p3, l1)", (m) => { pointOnLine(m, "p3", "l1"); }, [L1]],
    // Its second line is read for its direction and its middle: lengthened about the middle it changes nothing.
    ["col(l1, l2)", (m) => { collinear(m, "l1", "l2"); }, [L1, ["p3", "p4", "scale"]]],
    ["sym(p3, p4, l1)", (m) => { symmetric(m, "p3", "p4", "l1"); }, [L1]],
    ["dist(p3, l1, 10)", (m) => { dist(m, "p3", "l1", 10); }, [L1]],
    ["dist(l1, l2, 10)", (m) => { dist(m, "l1", "l2", 10); }, [L1, ["p3", "p4", "scale"]]],
    // Its arms run from the vertex: either far end slid along its arm changes nothing.
    ["ang3(p1, p2, p4, 40°)", (m) => { angle3(m, "p1", "p2", "p4", (40 * Math.PI) / 180); }, [["p1", "p2", "ray"], ["p1", "p4", "ray"]]],
  ];
  for (const [name, add, segments] of CASES) {
    test(`${dim}D: ${name} — every row's gradient along its lines is zero, and is the finite differences'`, () => {
      const m = twoLines(dim, true);
      checkRows(m, blocksOf(m, () => add(m)), segments, name);
    });
  }

  test(`${dim}D: sym(l2, l3, l1) — the mirror line and both lines are turned, never scaled, by its middle and direction rows`, () => {
    const m = twoLines(dim, true);
    const z = dim === 3 ? [4] : [];
    m.addPoint([-20, -18, ...z], "p5"); m.addPoint([35, -9, ...z], "p6"); m.addLine("p5", "p6", "l3");
    const blocks = blocksOf(m, () => symmetric(m, "l2", "l3", "l1"));
    // The length row is the one row that is about lengths: it says they are equal.
    checkRows(m, blocks.filter((b) => !b.label.endsWith("|len")), [["p1", "p2"]], "sym of lines, the mirror");
    checkRows(m, blocks.filter((b) => b.label.endsWith("|dir") || b.label.endsWith("|mid")), [["p3", "p4", "scale"], ["p5", "p6", "scale"]], "sym of lines, the two");
  });

  test(`${dim}D: tan(line, arc) at a shared end — the line is turned, never scaled`, () => {
    const m = new Model(dim);
    const z = dim === 3 ? [0] : [];
    m.addPoint([0, 0, ...z], "c"); m.addPoint([10, 0, ...z], "s"); m.addPoint([0, 10, ...z], "e");
    m.addPoint([-17, 14, ...z], "q");
    m.addArc("c", "s", "e", 10, dim === 3 ? "origin" : null, "a1");
    m.addLine("e", "q", "l1");
    const blocks = blocksOf(m, () => tangent(m, "l1", "a1"));
    // The shared end is the arc's too, so it is the far end that is slid; and
    // the radius is read for its direction as the line is, so the centre slid
    // along it (a larger or smaller arc through the same end) changes nothing.
    checkRows(m, blocks.filter((b) => !b.label.endsWith("|plane")), [["e", "q", "ray"], ["e", "c", "ray"]], "tan at a shared end");
  });
}

test("3D: perp(chord, e1) — every profile edge and the chord are turned, never scaled", () => {
  const m = new Model(3);
  [[0, 0, 0], [40, 0, 0], [40, 30, 0], [0, 30, 0]].forEach((c, i) => m.addPoint(c, `p${i + 1}`));
  for (let i = 1; i <= 4; i++) m.addLine(`p${i}`, `p${(i % 4) + 1}`, `l${i}`);
  const e = extrude(m, "l1", 10);
  assert.equal(m.solve().solved, true);
  const f = m.featureOf(e, "extrude");
  const pairs = [...baseOf(m, f.depth)];
  // Off its root, so a row that could be lowered by a shorter edge would show it.
  m.setCoords(pairs[0][0], m.coords(pairs[0][0]).map((c, i) => c + [3, -2, 1][i]));
  m.setCoords("p3", m.coords("p3").map((c, i) => c + [1, 2, 4][i]));
  const perp = m.relationOf(`${e}_perp`);
  const chord = [perp.args[0], perp.args[1]] as [string, string];
  // The stored block's own function is not handed out, so the relation is made again beside it and that one read.
  const [block] = blocksOf(m, () => perpendicular(m, chord[0], chord[1], e));
  // The finite differences, and the chord: lengthened at its far end (its foot is a profile corner), it changes no row.
  checkRows(m, [block], [[chord[0], chord[1], "ray"]], "perp(chord, e1)");
  // One row an edge, in the profile's order. An edge's own row does not change
  // as that edge is lengthened (its neighbours' rows do: its ends are theirs,
  // and moving them turns the neighbours). Lengthened at the end that is not
  // the chord's foot, where it has one: moving the foot turns the chord.
  m.valueBefore(0);
  const rows = rowsAt(m, block);
  const edges = f.loops.flat().map((mem) => m.line(typeof mem === "string" ? mem : mem.name).refs as [string, string]);
  assert.equal(rows.length, edges.length);
  edges.forEach(([a, c], k) => {
    const [fixed, moved] = c === chord[0] ? [c, a] : [a, c];
    const u = sub(m.coords(moved), m.coords(fixed));
    let d = 0;
    m.point(moved).varIndices.forEach((gi, i) => { d += partial(rows[k], block, gi) * u[i]; });
    assert.ok(Math.abs(d) < 1e-9 * len(u), `the row of ${a}–${c}: lengthening it changes it at ${d} per unit`);
    assert.ok(Math.abs(rows[k].val) > 1e-3, "and it was asked off its root, where a row that shrank would show");
  });
});

// --- the rectangle and the prism: corners to 1e-9 at 40 long ----------------------------------------

/** A 40 × 30 rectangle as the tool leaves one: four perps, and in 3D the flat. */
function rectangle(dim: number): Model {
  const m = new Model(dim);
  const z = dim === 3 ? [0] : [];
  [[0, 0], [40, 0], [40, 30], [0, 30]].forEach(([x, y], i) => m.addPoint([x, y, ...z], `p${i + 1}`));
  for (let i = 1; i <= 4; i++) m.addLine(`p${i}`, `p${(i % 4) + 1}`, `l${i}`);
  for (let i = 1; i <= 4; i++) perpendicular(m, `l${i}`, `l${(i % 4) + 1}`);
  if (dim === 3) coplanar(m, "p4", "p1", "p2", "p3");
  return m;
}

/** How far the worst corner is from square, as the length its far end is off by: |cos| × the longer side. */
function cornerError(m: Model): number {
  let worst = 0;
  for (let i = 1; i <= 4; i++) {
    const [a, b] = [`l${i}`, `l${(i % 4) + 1}`];
    worst = Math.max(worst, Math.abs(cosBetween(m, a, b)) * Math.max(lengthOf(m, a), lengthOf(m, b)));
  }
  return worst;
}

for (const dim of [2, 3]) {
  test(`${dim}D: the rectangle, a corner moved and solved — every corner square to 1e-9 at 40 long`, () => {
    const m = rectangle(dim);
    assert.equal(m.solve().solved, true);
    const by = dim === 3 ? [3, 4, 7] : [3, 4];
    m.setCoords("p3", m.coords("p3").map((c, i) => c + by[i]));
    assert.equal(m.solve().solved, true);
    assert.ok(cornerError(m) < 1e-9, `off square by ${cornerError(m)}`);
    assert.ok([1, 2, 3, 4].every((i) => lengthOf(m, `l${i}`) > 20), "and it is still a rectangle of about that size");
  });
}

test("3D: the prism, a lid corner dragged and then a base corner — flat, square, the depth and translated to 1e-9", () => {
  const m = rectangle(3);
  assert.equal(m.solve().solved, true);
  const e = extrude(m, "l1", 10);
  assert.equal(m.solve().solved, true);
  const f = m.featureOf(e, "extrude");
  const pairs = [...baseOf(m, f.depth)].filter(([t, b]) => m.entities.get(t)?.kind === "point" && m.entities.get(b)?.kind === "point");
  const twinOf = new Map(pairs.map(([t, b]) => [b, t]));
  const drag = (p: string, by: number[]) => {
    const from = m.coords(p);
    for (let k = 1; k <= 12; k++) m.solveFrame(pullTo(m, p, from.map((c, i) => c + (by[i] * k) / 12)));
    assert.equal(m.solve().solved, true);
  };
  drag(twinOf.get("p3")!, [12, -6, -8]);
  drag("p1", [3, -2, 9]);
  const B = pairs.map(([, b]) => m.coords(b)), T = pairs.map(([t]) => m.coords(t));
  let n = [0, 0, 0];
  for (let i = 0; i < B.length; i++) for (let j = i + 1; j < B.length; j++) for (let k = j + 1; k < B.length; k++) {
    const c = cross(sub(B[j], B[i]), sub(B[k], B[i]));
    if (len(c) > len(n)) n = c;
  }
  n = n.map((x) => x / len(n));
  const walls = T.map((t, i) => sub(t, B[i]));
  const err = {
    flat: Math.max(...B.map((b) => Math.abs(dot(sub(b, B[0]), n)))),
    square: Math.max(...walls.map((w) => len(cross(w, n)))),
    depth: Math.max(...walls.map((w) => Math.abs(len(w) - 10))),
    translated: Math.max(...walls.map((w) => len(sub(w, walls[0])))),
    corners: cornerError(m),
  };
  for (const [k, v] of Object.entries(err)) assert.ok(v < 1e-9, `${k} off by ${v} — ${JSON.stringify(err)}`);
});

// --- a size no relation asked to change -------------------------------------------------------------

for (const dim of [2, 3]) {
  const z = dim === 3 ? [0] : [];
  test(`${dim}D: a level line whose one end is pinned somewhere else is carried there whole`, () => {
    // What it did when its row was linear and could do nothing else: the
    // angle's row lets the far end slide along the line (5e-4 on 50, measured)
    // unless the solve is asked to keep what it turned (`Model.keptSizes`).
    const m = new Model(dim);
    m.addPoint([0, 0, ...z], "a"); m.addPoint([50, 0, ...z], "b"); m.addLine("a", "b", "l1");
    parallel(m, "l1", "origin.x");
    assert.equal(m.solve().solved, true);
    fix(m, "a", [0, 30, ...z], "origin");
    assert.equal(m.solve().solved, true);
    assert.ok(len(sub(m.coords("b"), [50, 30, ...z])) < 1e-6, `b at ${m.coords("b")}`);
  });

  test(`${dim}D: a width set on a rectangle of four perps leaves its height exactly as it was`, () => {
    const m = rectangle(dim);
    assert.equal(m.solve().solved, true);
    dist(m, "p1", "p2", 55);
    assert.equal(m.solve().solved, true);
    assert.ok(Math.abs(lengthOf(m, "l1") - 55) < 1e-9 && Math.abs(lengthOf(m, "l3") - 55) < 1e-9, "the width is the one asked for");
    assert.ok(Math.abs(lengthOf(m, "l2") - 30) < 1e-6 && Math.abs(lengthOf(m, "l4") - 30) < 1e-6, `the height: ${lengthOf(m, "l2")}, ${lengthOf(m, "l4")}`);
    assert.ok(cornerError(m) < 1e-9);
  });

  test(`${dim}D: a line no relation reads for its direction still stretches to a coin on its end`, () => {
    const m = new Model(dim);
    m.addPoint([0, 0, ...z], "a"); m.addPoint([50, 0, ...z], "b"); m.addLine("a", "b", "l1");
    m.addPoint([80, 10, ...z], "q"); fix(m, "q", [80, 10, ...z], "origin");
    fix(m, "a", [0, 0, ...z], "origin");
    assert.equal(m.solve().solved, true);
    const { coincident } = { coincident: (x: Model, p: string, r: string) => dist(x, p, r, 0) };
    coincident(m, "b", "q");
    assert.equal(m.solve().solved, true);
    assert.ok(Math.abs(lengthOf(m, "l1") - Math.hypot(80, 10)) < 1e-6, `it is as long as it has to be: ${lengthOf(m, "l1")}`);
  });
}

// --- a line too short to have a direction ------------------------------------------------------------

for (const dim of [2, 3]) {
  const z = dim === 3 ? [0] : [];
  test(`${dim}D: a line drawn as a point satisfies par, perp and ang as it always did, and its rows are finite`, () => {
    for (const add of [
      (m: Model) => parallel(m, "l1", "l2"),
      (m: Model) => perpendicular(m, "l1", "l2"),
      (m: Model) => angle(m, "l1", "l2", 0.4),
      (m: Model) => collinear(m, "l2", "l1"),
    ]) {
      const m = new Model(dim);
      m.addPoint([3, 3, ...z], "a"); m.addPoint([3, 3, ...z], "b"); m.addPoint([0, 9, ...z], "c"); m.addPoint([20, 14, ...z], "d");
      m.addLine("a", "b", "l1"); m.addLine("c", "d", "l2");
      const blocks = blocksOf(m, () => add(m));
      for (const b of blocks) {
        for (const row of rowsAt(m, b)) {
          assert.ok(Number.isFinite(row.val), `${b.label}: ${row.val}`);
          for (const g of row.grad.values()) assert.ok(Number.isFinite(g), `${b.label}: a gradient of ${g}`);
        }
      }
      const report = m.solve();
      assert.equal(report.solved, true, JSON.stringify(report.offenders));
      assert.ok(Math.abs(lengthOf(m, "l2") - Math.hypot(20, 5)) < 1e-6, "and the other line is not moved to suit a point");
    }
  });
}

// --- the fixtures reopen to the shapes they were saved as ---------------------------------------------

test("every old-file fixture reopens to the shape it was saved as: nothing moves but what a regeneration moved before", async () => {
  // The residual's form is not journalled, so a file's roots are the roots it
  // was saved at: opening one and solving moves nothing. One fixture is older
  // than the extrude's own perpendicular and regenerates under it on open;
  // it moved 1.8e-3 before the rows changed and moves the same now.
  const moved: Record<string, number> = {};
  for (const name of ["bracket.zerocad", "curves-v12.neocad", "features-v12.neocad", "flat2d-v12.neocad", "pre-explicit-regions.neocad", "shapes-v15.neocad"]) {
    const m = open(await readFile(new URL(`./fixtures/${name}.json`, import.meta.url), "utf8"));
    const filed = m.problem.snapshot();
    const report = m.solve();
    assert.equal(report.solved, true, `${name}: ${JSON.stringify(report.offenders)}`);
    moved[name] = Math.max(0, ...filed.map((v, i) => Math.abs(m.problem.getVar(i) - v)));
  }
  for (const [name, d] of Object.entries(moved)) {
    if (name === "pre-explicit-regions.neocad") assert.ok(d > 1e-4 && d < 2e-3, `${name} moved ${d}`);
    else assert.ok(d < 1e-9, `${name} moved ${d}`);
  }
});
