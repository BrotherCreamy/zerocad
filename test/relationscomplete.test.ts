// Every standard sketch relation, offered for whatever is picked
// (docs/plans/relations-complete.md). The owner: "Also need to figure out a
// way to do all the standard relations."
//
// The spec's table is the deliverable, so the first test *is* the table: one
// row per selection, the labels the constrain tool lists for it in the order
// it lists them, and every offered cell applied — by its `apply` on one copy
// of the fixture and by typing its `text` on another — to check the two make
// the same journal. A cell that is greyed (`off`) carries its reason and
// applies nothing. Then a test per new relation, in 2D and 3D: it holds, its
// gradient is there (the rank analysis counts the freedoms it takes — a
// residual that is a square would take none), and deleting it frees them.

import { test } from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { ensureKernelLoaded } from "../src/kernel/problem.ts";
import { Model } from "../src/model.ts";
import { dist, onPlane } from "../src/relations/basic.ts";
import { arcEndpoints, coradial, equalLength, intersection, pierce, symmetric } from "../src/relations/geometry.ts";
import { addSpline } from "../src/relations/spline.ts";
import { among } from "../src/relations/among.ts";
import { addEllipse, semiAxes } from "../src/kinds/ellipse.ts";
import { open, save } from "../src/persist.ts";
import { del } from "../src/operations.ts";
import { Repl } from "../src/repl.ts";
import { neocadScope } from "../src/replenv.ts";
import { constraintsFor } from "../src/dimensioning.ts";
import { menuFor } from "../src/menu.ts";
import { ConstrainTool } from "../src/tools/constrain.ts";
import type { ToolContext } from "../src/tools/tool.ts";
import type { Pick } from "../src/picking.ts";
import { tiltedFrame } from "./frames.ts";

await (async () => {
  const bytes = await readFile(new URL("../src/kernel/wasm-gen/neocad_kernel_bg.wasm", import.meta.url));
  await ensureKernelLoaded(bytes);
})();

const close = (a: number, b: number, tol = 1e-6, what = "") => assert.ok(Math.abs(a - b) < tol, `${what} ${a} vs ${b}`);

function solved(m: Model) {
  const r = m.solve();
  assert.equal(r.solved, true, JSON.stringify(r.offenders));
  assert.ok(r.maxResidual < 1e-6, `max residual ${r.maxResidual}`);
  return r;
}

/**
 * One of everything, laid out so that what should meet does: the spline s1
 * starts at l1's end and ends at a1's start; s3 starts where s1 ends; s2
 * starts at a1's end. In 3D the same drawing on the ground, and three points
 * up off it standing for a solid's face (`"k0.k1.k2"`).
 */
function fixture(dim: 2 | 3): Model {
  const m = new Model(dim);
  const P = (n: string, x: number, y: number, z = 0) => m.addPoint(dim === 3 ? [x, y, z] : [x, y], n).name;
  const L = (n: string, a: [number, number], b: [number, number]) => {
    P(`${n}a`, ...a); P(`${n}b`, ...b); m.addLine(`${n}a`, `${n}b`, n);
  };
  P("p", 3, 7); P("q", 20, 9); P("r", 11, -6); P("u", 25, 25); P("w", -8, 14);
  L("l1", [0, 0], [10, 0]); L("l2", [0, 3], [10, 5]); L("l3", [30, -10], [30, 10]);
  L("l4", [0, 20], [8, 24]); L("l5", [0, 30], [9, 31]);
  P("c1c", -20, 0); m.addCircle("c1c", 4, null, "c1");
  P("c2c", -10, 0); m.addCircle("c2c", 3, null, "c2");
  P("c3c", -30, 0); m.addCircle("c3c", 2, null, "c3");
  P("sp1", 14, 3); P("sp2", 18, 0);
  addSpline(m, ["l1b", "sp1", "sp2"], null, "s1");
  P("a1c", 22, 0); P("a1e", 26, 0); m.addArc("a1c", "sp2", "a1e", 4, null, "a1");
  P("a2c", 22, 20); P("a2s", 26, 20); P("a2e", 18, 20); m.addArc("a2c", "a2s", "a2e", 4, null, "a2");
  P("t1", 30, 4); P("t2", 34, 2);
  addSpline(m, ["a1e", "t1", "t2"], null, "s2");
  P("v1", 20, -4); P("v2", 23, -8);
  addSpline(m, ["sp2", "v1", "v2"], null, "s3");
  P("e1c", 0, -20); P("e1m", 6, -20); addEllipse(m, "e1c", "e1m", 3, null, "e1");
  P("e2c", 20, -20); P("e2m", 25, -20); addEllipse(m, "e2c", "e2m", 2, null, "e2");
  if (dim === 3) { P("k0", 0, 0, 5); P("k1", 10, 0, 5); P("k2", 0, 10, 5); }
  // A frame of the user's, not the default: a datum, picked by its arms.
  P("fo", 60, 60); P("fx", 70, 62); P("fy", 58, 70);
  m.addFrame("fo", "fx", dim === 3 ? "fy" : null, "f1");
  return m;
}

/** A label, and `!` after it for a cell that is greyed with a reason. */
const labelsOf = (m: Model, picks: string[]) => constraintsFor(m, picks).map((a) => (a.off ? `${a.label}!` : a.label));

const FIVE = ["l1", "l2", "l3", "l4", "l5"];
const POINTS5 = ["p", "q", "r", "u", "w"];

/** The table, as built: picks, then what is listed for them, most likely first. Both dimensions unless marked. */
const TABLE: [string[], string[], (2 | 3)[]?][] = [
  // one pick
  [["p"], ["Fix"]],
  [["l1"], ["Horizontal", "Vertical", "Fix", "Length"]],
  [["c1"], ["Fix", "Diameter"]],
  [["a1"], ["Fix", "Radius"]],
  [["e1"], ["Fix", "Major semi-axis"]],
  [["s1"], ["Fix", "End to end"]],
  [["origin.x"], []],
  [["f1"], []],
  [["f1", "l1"], []],
  // two picks
  [["p", "q"], ["Coincident", "Horizontal", "Vertical", "Fix (both)", "Distance"]],
  [["p", "l1"], ["On", "Midpoint", "Distance"], [2]],
  [["l1", "p"], ["On", "Midpoint", "Distance"], [2]],
  [["p", "l1"], ["On", "Midpoint", "Pierce", "Distance"], [3]],
  [["p", "c1"], ["On", "Centre distance"], [2]],
  [["p", "c1"], ["On", "Pierce", "Centre distance"], [3]],
  [["p", "a1"], ["On", "Midpoint", "Centre distance"], [2]],
  [["p", "e1"], ["On"], [2]],
  [["p", "e1"], ["On", "Pierce"], [3]],
  [["p", "s1"], ["On"], [2]],
  [["p", "s1"], ["On", "Pierce"], [3]],
  [["p", "origin.x"], []],
  [["p", "origin.z"], ["On plane"], [3]],
  [["p", "k0.k1.k2"], ["On face"], [3]],
  [["l1", "l2"], ["Parallel", "Perpendicular", "Equal", "Collinear", "Horizontal (both)", "Vertical (both)", "Fix (both)", "Angle"]],
  [["l1", "origin.y"], ["Parallel", "Perpendicular"]],
  [["l1", "f1.x"], ["Parallel", "Perpendicular"]],
  [["l1", "origin.z"], ["Normal to plane", "Parallel to plane"], [3]],
  [["l1", "k0.k1.k2"], ["Normal to face", "Parallel to face"], [3]],
  [["l1", "c1"], ["Tangent", "Distance"]],
  [["l1", "a1"], ["Tangent", "Equal length", "Distance"]],
  [["l1", "e1"], ["Tangent"]],
  [["l1", "s1"], ["Tangent"]],
  [["l2", "s1"], ["Tangent!"]],
  [["c1", "c2"], ["Concentric", "Coradial", "Equal", "Tangent (outside)", "Tangent (inside)", "Fix (both)", "Centre distance"]],
  [["c1", "a2"], ["Concentric", "Coradial", "Equal", "Tangent (outside)", "Tangent (inside)", "Fix (both)", "Centre distance"]],
  [["a1", "s1"], ["Tangent"]],
  [["c1", "s1"], ["Tangent!"]],
  [["s1", "s3"], ["Tangent", "Fix (both)"]],
  [["s1", "s2"], ["Tangent!", "Fix (both)"]],
  [["c1", "e1"], ["Concentric"]],
  [["e1", "e2"], ["Concentric", "Fix (both)"]],
  [["e1", "s1"], []],
  [["origin.x", "origin.y"], []],
  [["k0.k1.k2", "origin.z"], [], [3]],
  // three picks
  [["p", "q", "r"], ["Midpoint", "Equal spacing", "Coincident (all 3)", "Horizontal (all 3)", "Vertical (all 3)", "Fix (all 3)", "Angle at a vertex"]],
  [["p", "q", "l3"], ["Symmetric"]],
  [["p", "q", "origin.y"], ["Symmetric"]],
  [["l1", "l2", "l3"], ["Equal (all 3)", "Parallel (all 3)", "Symmetric", "Collinear (all 3)", "Horizontal (all 3)", "Vertical (all 3)", "Fix (all 3)"]],
  [["l1", "l2", "origin.y"], ["Symmetric"]],
  [["c1", "c2", "l3"], ["Symmetric"]],
  [["a1", "a2", "l3"], ["Symmetric"]],
  [["p", "l1", "c1"], ["Intersection"]],
  [["p", "l1", "e1"], ["Intersection"]],
  [["c1", "c2", "c3"], ["Concentric (all 3)", "Coradial (all 3)", "Equal (all 3)", "Fix (all 3)"]],
  // many
  [FIVE, ["Equal (all 5)", "Parallel (all 5)", "Collinear (all 5)", "Horizontal (all 5)", "Vertical (all 5)", "Fix (all 5)"]],
  [POINTS5, ["Equal spacing", "Coincident (all 5)", "Horizontal (all 5)", "Vertical (all 5)", "Fix (all 5)"]],
  // a solid's own geometry the kernel computed: greyed, with the reason
  [["e9.lid|e9.m0"], ["Relate!"]],
  [["p", "e9.f2"], ["Relate!"]],
];

/** What a model's relations journal, in order — the thing `apply` and the typed text must agree on. */
const journal = (m: Model) => [...m.relations.values()].map((r) => `${r.op}(${JSON.stringify(r.args)})`);

for (const dim of [2, 3] as const) {
  test(`constraintsFor is the table, in ${dim}D: every cell's list, in order`, () => {
    const m = fixture(dim);
    for (const [picks, want, dims] of TABLE) {
      if (dims && !dims.includes(dim)) continue;
      assert.deepEqual(labelsOf(m, picks), want, picks.join(", "));
    }
  });

  test(`every offered cell, in ${dim}D: apply and the typed text make the same relations; a greyed one says why`, async () => {
    const base = fixture(dim);
    for (const [picks, , dims] of TABLE) {
      if (dims && !dims.includes(dim)) continue;
      const found = constraintsFor(base, picks);
      for (let i = 0; i < found.length; i++) {
        const cell = `${picks.join(", ")} → ${found[i].label}`;
        if (found[i].off) {
          assert.ok(found[i].off!.length > 10, `${cell} says why it is greyed`);
          continue;
        }
        // A dimension is the dimension tool's; its cells are checked there.
        if (["Length", "Radius", "Distance", "Angle"].includes(found[i].label)) continue;
        const a = fixture(dim), b = fixture(dim);
        const before = a.relations.size;
        constraintsFor(a, picks)[i].apply(a);
        assert.ok(a.relations.size > before, `${cell} made a relation`);
        const repl = new Repl(neocadScope({ model: b, arm: () => {}, view: { ox: 0, oy: 0, scale: 3 }, refresh: () => {} }));
        const r = await repl.eval(constraintsFor(b, picks)[i].text);
        assert.equal(r.ok, true, `${cell}: ${constraintsFor(b, picks)[i].text} — ${r.error?.message ?? ""}`);
        assert.deepEqual(journal(b), journal(a), cell);
      }
    }
  });
}

test("the texts the table types are the house's names", () => {
  const m = fixture(3);
  const text = (picks: string[], label: string) => constraintsFor(m, picks).find((a) => a.label === label)?.text;
  assert.equal(text(["p"], "Fix"), 'fix("p", [3, 7, 0])');
  assert.equal(text(["p", "q", "r"], "Midpoint"), 'mid("p", "q", "r")');
  assert.equal(text(["p", "e1"], "On"), 'onellipse("p", "e1")');
  assert.equal(text(["p", "s1"], "On"), 'onspline("p", "s1")');
  assert.equal(text(["p", "k0.k1.k2"], "On face"), 'onplane("p", "k0.k1.k2")');
  assert.equal(text(["p", "origin.z"], "On plane"), 'onplane("p", "origin")');
  assert.equal(text(["l1", "k0.k1.k2"], "Normal to face"), 'par("l1", "k0.k1.k2")');
  assert.equal(text(["l1", "origin.z"], "Parallel to plane"), 'perp("l1", "origin.z")');
  assert.equal(text(["c1", "c2"], "Coradial"), 'corad("c1", "c2")');
  assert.equal(text(["c1", "c2"], "Tangent (outside)"), 'tan("c1", "c2", "outside")');
  assert.equal(text(["l1", "s1"], "Tangent"), 'tan("l1", "s1")');
  assert.equal(text(["c1", "c2", "l3"], "Symmetric"), 'sym("c1", "c2", "l3")');
  // Many at once is one call, one relation among them all (docs/plans/review-relations.md).
  assert.equal(text(FIVE, "Equal (all 5)"), 'eq("l1", "l2", "l3", "l4", "l5")');
  assert.equal(text(POINTS5, "Horizontal (all 5)"), `horizontal(${POINTS5.map((p) => JSON.stringify(p)).join(", ")})`);
  assert.equal(text(["l1", "l2"], "Horizontal (both)"), 'horizontal("l1"); horizontal("l2")');
  assert.equal(text(["a1"], "Fix"), 'fix("a1c", [22, 0, 0]); fix("sp2", [18, 0, 0]); fix("a1e", [26, 0, 0])');
  assert.match(constraintsFor(m, ["l2", "s1"])[0].off!, /neither end of "s1" meets "l2"/);
  assert.match(constraintsFor(m, ["e9.lid|e9.m0"])[0].off!, /solid kernel/);
});

// --- many at once ------------------------------------------------------------

test("many at once: five lines, Equal, is one relation among the five — one call, so one undo step", async () => {
  // It was four relations, each against the first pick (#82). One relation
  // among equals now (docs/plans/review-relations.md): test/reviewrelations.test.ts
  // has what that means for a member deleted, a join and an old file.
  const m = fixture(2);
  const equal = constraintsFor(m, FIVE).find((a) => a.label === "Equal (all 5)")!;
  assert.ok(!equal.text.includes("\n") && !equal.text.includes(";"), "one call on one line, so the command line makes it one undo step");
  const repl = new Repl(neocadScope({ model: m, arm: () => {}, view: { ox: 0, oy: 0, scale: 3 }, refresh: () => {} }));
  const before = m.relations.size;
  const r = await repl.eval(equal.text);
  assert.equal(r.ok, true, r.error?.message ?? "");
  const made = [...m.relations.values()].slice(before);
  assert.equal(made.length, 1, "one relation");
  assert.deepEqual(made[0].args, FIVE, "naming every pick, none of them more than another");
  solved(m);
  const len = (l: string) => Math.hypot(...m.coords(`${l}b`).map((v, i) => v - m.coords(`${l}a`)[i]));
  for (const l of FIVE) close(len(l), len("l1"), 1e-6, l);
});

test("a star names fewer relations in a conflict than a chain would — and one relation among many names itself once", () => {
  // The measurement #82 chose the star by, kept as the record of it: with two
  // of eight lines dimensioned to different lengths, a star's conflict is the
  // two dimensions and the two eqs that reach them, wherever they are; a
  // chain's is every eq on the path between them — up to n − 1 of them. One
  // relation among the eight (relations/among.ts) is named once whichever two
  // disagree, which is fewer than either.
  const named = (shape: "star" | "chain", a: number, b: number) => {
    const m = new Model(2);
    for (let i = 0; i < 8; i++) {
      m.addPoint([0, i * 10], `a${i}`); m.addPoint([10 + i, i * 10], `b${i}`); m.addLine(`a${i}`, `b${i}`, `l${i}`);
    }
    for (let i = 1; i < 8; i++) equalLength(m, shape === "star" ? "l0" : `l${i - 1}`, `l${i}`);
    dist(m, `a${a}`, `b${a}`, 10);
    dist(m, `a${b}`, `b${b}`, 20);
    m.searchMs = Infinity; // what is named is asked of the trials, not of a loaded box's clock
    return m.conflicting(m.solve()).relations.length;
  };
  assert.equal(named("star", 1, 7), 4);
  assert.equal(named("chain", 1, 7), 8);
  assert.equal(named("star", 0, 7), 3);
  assert.equal(named("chain", 0, 7), 9);
  // The one case a chain wins: the two neighbours in it.
  assert.equal(named("star", 2, 3), 4);
  assert.equal(named("chain", 2, 3), 3);
  const among8 = (a: number, b: number) => {
    const m = new Model(2);
    for (let i = 0; i < 8; i++) {
      m.addPoint([0, i * 10], `a${i}`); m.addPoint([10 + i, i * 10], `b${i}`); m.addLine(`a${i}`, `b${i}`, `l${i}`);
    }
    const r = among(m, "equalLength", ...Array.from({ length: 8 }, (_, i) => `l${i}`));
    dist(m, `a${a}`, `b${a}`, 10);
    dist(m, `a${b}`, `b${b}`, 20);
    m.searchMs = Infinity;
    const names = m.conflicting(m.solve()).relations;
    assert.equal(names.filter((n) => n === r).length, 1, "named once");
    return names.length;
  };
  for (const [a, b] of [[1, 7], [0, 7], [2, 3]]) assert.equal(among8(a, b), 3, `the relation and the two dimensions, for ${a} and ${b}`);
});

// --- the new relation, and the new forms of old ones ----------------------------

/** A line with its two points, at coordinates in the model's own dimension. */
function line(m: Model, n: string, a: number[], b: number[]): string {
  m.addPoint(a, `${n}a`); m.addPoint(b, `${n}b`);
  return m.addLine(`${n}a`, `${n}b`, n).name;
}

const sub = (a: number[], b: number[]) => a.map((v, i) => v - b[i]);
/** Distance from p to the infinite line through a, b. */
function off(p: number[], a: number[], b: number[]): number {
  const u = sub(b, a), w = sub(p, a);
  const t = dotv(w, u) / dotv(u, u);
  return lenv(w.map((v, i) => v - t * u[i]));
}
/** The tilted frame's unit normal, from its three points. */
function tiltedNormal(m: Model): number[] {
  const [o, x, y] = ["t_o", "t_x", "t_y"].map((p) => m.coords(p));
  const [u, v] = [sub(x, o), sub(y, o)];
  const n = [u[1] * v[2] - u[2] * v[1], u[2] * v[0] - u[0] * v[2], u[0] * v[1] - u[1] * v[0]];
  return n.map((c) => c / lenv(n));
}
const dotv = (a: number[], b: number[]) => a.reduce((s, v, i) => s + v * b[i], 0);
const lenv = (a: number[]) => Math.hypot(...a);
/** The mirror of `p` in the line through `s` along `e − s` — in 3D, the half-turn about it. */
function mirror(p: number[], s: number[], e: number[]): number[] {
  const u = sub(e, s).map((v) => v / lenv(sub(e, s)));
  const d = sub(p, s);
  const along = dotv(d, u);
  return s.map((v, i) => v + 2 * along * u[i] - d[i]);
}

for (const dim of [2, 3] as const) {
  const at = (m: Model) => {
    if (dim === 2) return (x: number, y: number) => [x, y];
    const t = tiltedFrame(m);
    return (x: number, y: number) => t.at(x, y);
  };
  /**
   * In 3D, every point held on the tilted sketch plane, as the tools hold
   * what they draw there — so the freedoms counted are the sketch's: a point
   * nothing holds on the plane is free off it, and a solve that moved one off
   * would add a freedom the relation had nothing to do with.
   */
  const hold = (m: Model) => {
    if (dim === 2) return;
    for (const e of [...m.entities.values()]) if (e.kind === "point" && !e.name.startsWith("t_")) onPlane(m, e.name, "t");
  };
  /** What a relation takes in 3D beyond 2D: a circle's normal tied to another's, two freedoms. */
  const normals = dim === 3 ? 2 : 0;

  test(`coradial in ${dim}D: one centre and one radius — and in 3D one plane; deleting it frees them`, () => {
    const m = new Model(dim);
    const xy = at(m);
    m.addPoint(xy(0, 0), "o1"); m.addCircle("o1", 5, null, "c1");
    m.addPoint(xy(1, 2), "o2"); m.addCircle("o2", 3, null, "c2");
    hold(m);
    const free = m.diagnose().dof;
    const r = coradial(m, "c1", "c2");
    solved(m);
    for (let i = 0; i < dim; i++) close(m.coords("o1")[i], m.coords("o2")[i], 1e-7, "centre");
    close(m.radius("c1"), m.radius("c2"), 1e-7, "radius");
    // A centre (on the plane, two) and a radius; in 3D the normals parallel as well.
    assert.equal(free - m.diagnose().dof, 3 + normals, "the freedoms it takes");
    del(m, r);
    assert.equal(m.diagnose().dof, free, "deleting it frees them");
  });

  test(`sym of two lines about a line in ${dim}D: the second is the first's mirror, either way round`, () => {
    const m = new Model(dim);
    const xy = at(m);
    line(m, "ax", xy(0, -10), xy(0, 10));
    line(m, "l1", xy(-8, 1), xy(-3, 4));
    // Drawn roughly mirrored but with its ends the other way round.
    line(m, "l2", xy(2.5, 4.5), xy(7, 0));
    hold(m);
    const free = m.diagnose().dof;
    const r = symmetric(m, "l1", "l2", "ax");
    solved(m);
    const [s, e] = [m.coords("axa"), m.coords("axb")];
    const ends2 = [m.coords("l2a"), m.coords("l2b")];
    for (const p of ["l1a", "l1b"]) {
      const want = mirror(m.coords(p), s, e);
      assert.ok(ends2.some((q) => lenv(sub(q, want)) < 1e-6), `${p}'s mirror is an end of l2`);
    }
    assert.equal(free - m.diagnose().dof, 4, "a segment's worth of freedoms, on the plane");
    del(m, r);
    assert.equal(m.diagnose().dof, free);
  });

  test(`sym of two circles about a line in ${dim}D: mirrored centres, equal radii`, () => {
    const m = new Model(dim);
    const xy = at(m);
    line(m, "ax", xy(0, -10), xy(0, 10));
    m.addPoint(xy(-6, 2), "o1"); m.addCircle("o1", 3, null, "c1");
    m.addPoint(xy(5, 3), "o2"); m.addCircle("o2", 2, null, "c2");
    hold(m);
    const free = m.diagnose().dof;
    const r = symmetric(m, "c1", "c2", "ax");
    solved(m);
    const want = mirror(m.coords("o1"), m.coords("axa"), m.coords("axb"));
    close(lenv(sub(m.coords("o2"), want)), 0, 1e-6, "centre mirrored");
    close(m.radius("c1"), m.radius("c2"), 1e-7, "radius");
    assert.equal(free - m.diagnose().dof, 3 + normals, "centre, radius and — in 3D — plane");
    del(m, r);
    assert.equal(m.diagnose().dof, free);
  });

  test(`sym of two arcs about a line in ${dim}D: the circles mirrored, and each end the other's mirror`, () => {
    const m = new Model(dim);
    const xy = at(m);
    line(m, "ax", xy(0, -10), xy(0, 10));
    m.addPoint(xy(-6, 0), "o1"); m.addPoint(xy(-3, 0), "s1"); m.addPoint(xy(-6, 3), "e1");
    m.addArc("o1", "s1", "e1", 3, null, "a1");
    m.addPoint(xy(6.3, 0.2), "o2"); m.addPoint(xy(6, 2.8), "s2"); m.addPoint(xy(3.2, 0), "e2");
    m.addArc("o2", "s2", "e2", 3, null, "a2");
    // As every tool-made arc is: its ends on its rim.
    arcEndpoints(m, "a1"); arcEndpoints(m, "a2");
    hold(m);
    solved(m);
    const free = m.diagnose().dof;
    const r = symmetric(m, "a1", "a2", "ax");
    solved(m);
    const [s, e] = [m.coords("axa"), m.coords("axb")];
    close(lenv(sub(m.coords("o2"), mirror(m.coords("o1"), s, e))), 0, 1e-6, "centre");
    // A mirror turns an arc's direction round: its start is the other's end.
    close(lenv(sub(m.coords("e2"), mirror(m.coords("s1"), s, e))), 0, 1e-6, "start ↔ end");
    close(lenv(sub(m.coords("s2"), mirror(m.coords("e1"), s, e))), 0, 1e-6, "end ↔ start");
    // A centre (two on the plane), a radius, an angle for each end. In 3D no
    // more: an arc's ends on its rim and on the plane already set its normal.
    assert.equal(free - m.diagnose().dof, 5, "the freedoms it takes");
    del(m, r);
    assert.equal(m.diagnose().dof, free);
  });

  test(`sym of two lines about a frame's axis in ${dim}D: the axis read as a located line`, () => {
    const m = new Model(dim);
    const xy = at(m);
    line(m, "l1", xy(-8, 1), xy(-3, 4));
    line(m, "l2", xy(3, 4), xy(8, 1));
    const axis = dim === 2 ? "origin.y" : "t.y";
    symmetric(m, "l1", "l2", axis);
    solved(m);
    const o = dim === 2 ? [0, 0] : m.coords("t_o"), y = dim === 2 ? [0, 1] : m.coords("t_y");
    const ends2 = [m.coords("l2a"), m.coords("l2b")];
    for (const p of ["l1a", "l1b"]) {
      const want = mirror(m.coords(p), o, y);
      assert.ok(ends2.some((q) => lenv(sub(q, want)) < 1e-6), `${p} mirrored about ${axis}`);
    }
  });

  test(`intersection and pierce take an ellipse and a spline in ${dim}D`, () => {
    const m = new Model(dim);
    const xy = at(m);
    m.addPoint(xy(0, 0), "ec"); m.addPoint(xy(6, 0), "em"); addEllipse(m, "ec", "em", 3, null, "e1");
    line(m, "l1", xy(-10, 1), xy(10, 1));
    m.addPoint(xy(5, 2), "p");
    intersection(m, "p", "l1", "e1");
    solved(m);
    const q = m.coords("p");
    // On the line, and on the ellipse: (x/a)² + (y/b)² = 1 in its own frame,
    // a and b as they are now — the solve may have moved them too.
    const [c, mj] = [m.coords("ec"), m.coords("em")];
    const { a, b } = semiAxes(m, "e1");
    const u = sub(mj, c).map((v) => v / lenv(sub(mj, c)));
    const x = dotv(sub(q, c), u), y2 = dotv(sub(q, c), sub(q, c)) - x * x;
    close((x / a) ** 2 + y2 / (b * b), 1, 1e-6, "on the ellipse");
    close(off(q, m.coords("l1a"), m.coords("l1b")), 0, 1e-6, "on the line");
    if (dim === 3) {
      // A spline through the sketch plane, and the point where it pierces it.
      m.addPoint(xy(0, 0).map((v, i) => v + [0, 0, -4][i]), "z0");
      m.addPoint(xy(1, 1).map((v, i) => v + [0, 0, 1][i]), "z1");
      m.addPoint(xy(2, 0).map((v, i) => v + [0, 0, 5][i]), "z2");
      addSpline(m, ["z0", "z1", "z2"], null, "s1");
      m.addPoint(xy(1, 1), "pp");
      pierce(m, "pp", "s1", "t");
      solved(m);
      close(dotv(sub(m.coords("pp"), m.coords("t_o")), tiltedNormal(m)), 0, 1e-6, "on the sketch plane");
    }
  });
}

test("every new op and form replays from a saved file", () => {
  const m = new Model(3);
  const t = tiltedFrame(m);
  m.addPoint(t.at(0, -10), "a"); m.addPoint(t.at(0, 10), "b"); m.addLine("a", "b", "ax");
  m.addPoint(t.at(-6, 2), "o1"); m.addCircle("o1", 3, null, "c1");
  m.addPoint(t.at(5, 3), "o2"); m.addCircle("o2", 2, null, "c2");
  m.addPoint(t.at(-6, -6), "o3"); m.addCircle("o3", 2, null, "c3");
  m.addPoint(t.at(-8, 1), "l1a"); m.addPoint(t.at(-3, 4), "l1b"); m.addLine("l1a", "l1b", "l1");
  m.addPoint(t.at(3, 4), "l2a"); m.addPoint(t.at(8, 1), "l2b"); m.addLine("l2a", "l2b", "l2");
  m.addPoint(t.at(0, 0), "ec"); m.addPoint(t.at(6, 0), "em"); addEllipse(m, "ec", "em", 3, null, "e1");
  m.addPoint(t.at(5, 2), "p");
  coradial(m, "c1", "c3");
  symmetric(m, "c1", "c2", "ax");
  symmetric(m, "l1", "l2", "t.y");
  intersection(m, "p", "l1", "e1");
  m.solve();
  const text = save(m);
  const back = open(text, 3);
  assert.equal(save(back), text, "byte-identical round trip");
  assert.deepEqual(journal(back), journal(m));
  assert.deepEqual([...back.relations.values()].map((r) => r.op), ["coradial", "symmetric", "symmetric", "intersection"]);
});

// --- the tool and the menu --------------------------------------------------------

/** A context whose pick answers from a script. */
function scripted(m: Model, picks: (Pick | null)[]) {
  const ctx: ToolContext = {
    model: m, options: {}, prenamed: [],
    requestRender() {}, requestSolve() { m.solve(); }, finish() {},
    pick: () => picks.shift() ?? null,
    log: () => {},
  };
  return ctx;
}

const at0 = { world: [0, 0], screen: [0, 0] as [number, number] };

test("the constrain tool takes a frame's arm as its axis", () => {
  const m = fixture(2);
  const tool = new ConstrainTool(scripted(m, [
    { name: "l1", kind: "line", distance: 0 },
    { name: "origin", kind: "frame", distance: 0, axis: "y" },
  ]));
  tool.onArmed();
  tool.onDown(at0); tool.onDown(at0);
  assert.deepEqual(tool.picks, ["l1", "origin.y"]);
  assert.deepEqual(tool.commands().map((c) => c.command), ['par("l1", "origin.y")', 'perp("l1", "origin.y")']);
});

test("a greyed cell is greyed in the tool's list and the menu, with its reason", () => {
  const m = fixture(2);
  const tool = new ConstrainTool(scripted(m, []));
  tool.picks = ["l2", "s1"];
  const [cmd] = tool.commands();
  assert.equal(cmd.label, "Tangent");
  assert.match(cmd.off ?? "", /meets/);
  const menu = menuFor(m, { name: "l2", kind: "line", distance: 0 }, null, null, null, ["l2", "s1"]);
  const item = menu.items.find((i) => i.label === "Tangent")!;
  assert.equal(item.action.do, "disabled");
});

test("Symmetric takes its picks in any order: the line is the mirror wherever it was picked", () => {
  // Found merging #84: two circles then the line listed Symmetric, the line
  // first listed nothing — and the iPhone's seven-row list for two circles
  // covers the line, so the line first is the order a finger needs.
  const m = new Model(2);
  m.addPoint([-22, 8], "o1"); m.addCircle("o1", 10, null, "c1");
  m.addPoint([16, 14], "o2"); m.addCircle("o2", 8, null, "c2");
  m.addPoint([0, -25], "la"); m.addPoint([0, 35], "lb"); m.addLine("la", "lb", "l1");
  m.addPoint([-5, 0], "pa"); m.addPoint([5, 0], "pb");
  for (const picks of [["c1", "c2", "l1"], ["l1", "c1", "c2"], ["c1", "l1", "c2"]]) {
    const s = constraintsFor(m, picks).filter((a) => a.label === "Symmetric");
    assert.equal(s.length, 1, picks.join(", "));
    assert.match(s[0].text, /^sym\("c[12]", "c[12]", "l1"\)$/, picks.join(", "));
  }
  for (const picks of [["l1", "pa", "pb"], ["pa", "l1", "pb"]]) {
    assert.equal(constraintsFor(m, picks).find((a) => a.label === "Symmetric")?.text.endsWith('"l1")'), true, picks.join(", "));
  }
});
