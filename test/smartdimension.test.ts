// Smart dimension (docs/plans/smart-dimension.md): one dimension tool that
// dimensions virtually anything — the owner: *"Distance between two faces of
// a solid, or angle"*. Headless: the table, row by row in 2D and 3D, the face
// references, driving and driven, and what survives a save.
//
// Every row is checked twice: the text the tool types, and the value the
// relation it stands for holds once applied and solved — measured
// independently here, from coordinates, never through the relation.

import { test } from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { ensureKernelLoaded } from "../src/kernel/problem.ts";
import { Model } from "../src/model.ts";
import { dist, fix, onPlane } from "../src/relations/basic.ts";
import { arcEndpoints, parallel, perpendicular } from "../src/relations/geometry.ts";
import { measure, measured, setSolidReader } from "../src/relations/measure.ts";
import { angle3, arcLength, distAlong } from "../src/relations/smartdim.ts";
import { edgeSource, faceDistance, faceSource } from "../src/relations/solidref.ts";
import { del, extrude, set } from "../src/operations.ts";
import { open, save } from "../src/persist.ts";
import { dimensionFor, drivenBecause, takesThird } from "../src/dimensioning.ts";
import { placeGlyphs } from "../src/glyphs.ts";
import { neocadScope } from "../src/replenv.ts";
import { DimensionTool } from "../src/tools/dimension.ts";
import type { ToolContext } from "../src/tools/tool.ts";
import type { Pick } from "../src/picking.ts";
import { worldToScreen, type View } from "../src/view.ts";

const defaultView = (): View => ({ ox: 400, oy: 300, scale: 3 });
import { tiltedFrame } from "./frames.ts";
import { polygon } from "./profiles.ts";

await (async () => {
  const bytes = await readFile(new URL("../src/kernel/wasm-gen/neocad_kernel_bg.wasm", import.meta.url));
  await ensureKernelLoaded(bytes);
})();

const close = (a: number, b: number, tol = 1e-6, what = "") => assert.ok(Math.abs(a - b) < tol, `${what} ${a} vs ${b}`);
const sub = (a: number[], b: number[]) => a.map((v, i) => v - b[i]);
const dotN = (a: number[], b: number[]) => a.reduce((s, v, i) => s + v * b[i], 0);
const len = (a: number[]) => Math.hypot(...a);

function solved(m: Model) {
  const r = m.solve();
  assert.equal(r.solved, true, JSON.stringify(r.offenders));
  return r;
}

/** A 40 × 30 block, 20 deep, on a frame tipped off every kernel axis. */
function block(depth = 20) {
  const m = new Model(3);
  const t = tiltedFrame(m);
  const { points, lines } = polygon(m, t, [[0, 0], [40, 0], [40, 30], [0, 30]]);
  const e = extrude(m, lines[0], depth);
  solved(m);
  return { m, t, points, lines, e };
}

/** A right-angled wedge: a triangle with a 30° corner, extruded 10. */
function wedge() {
  const m = new Model(3);
  const t = tiltedFrame(m);
  const run = 40, rise = 40 * Math.tan(Math.PI / 6);
  const { points, lines } = polygon(m, t, [[0, 0], [run, 0], [run, rise]]);
  const e = extrude(m, lines[0], 10);
  solved(m);
  return { m, t, points, lines, e };
}

/** A 2D line with its two points. */
function line(m: Model, name: string, a: number[], b: number[]): string {
  m.addPoint(a, `${name}a`);
  m.addPoint(b, `${name}b`);
  return m.addLine(`${name}a`, `${name}b`, name).name;
}

// --- the face references -------------------------------------------------------

test("a face is named as the kernel names it, and maps to what made it", () => {
  const { m, lines, e } = block();
  const lid = faceSource(m, `${e}.lid`);
  assert.equal(lid?.kind, "cap");
  const wall = faceSource(m, `${e}.m2`);
  assert.ok(wall?.kind === "wall" && wall.entity === lines[2] && wall.shape === "plane");
  assert.equal(faceSource(m, `${e}.m9`), null, "no ninth member");
  assert.equal(faceSource(m, "e7.lid"), null, "no such feature");
  // An edge between two of its faces is the entity it is.
  const f = m.featureOf(e, "extrude");
  assert.equal(edgeSource(m, `${e}.base|${e}.m1`), lines[1]);
  assert.equal(edgeSource(m, `${e}.lid|${e}.m1`), f.twins[0][1]);
  const side = edgeSource(m, `${e}.m0|${e}.m1`)!;
  assert.ok(f.walls.includes(side), "the wall line at the corner the two share");
  assert.ok(m.line(side).refs.includes(m.line(lines[0]).refs[1]));
});

// --- the table, solids ---------------------------------------------------------

test("two opposite walls of a block are two lines: the distance between them is dist on its sketch, and setting it moves the solid", () => {
  const { m, lines, e } = block();
  const plan = dimensionFor(m, [`${e}.m0`, `${e}.m2`]);
  assert.equal(plan?.text, `dist("${lines[0]}", "${lines[2]}", 30)`);
  const d = plan!.apply(m);
  solved(m);
  set(m, `${d}.value`, 45);
  solved(m);
  // The block is wider: the lid's far edge moved with its base.
  const f = m.featureOf(e, "extrude");
  const [a, b] = [m.line(f.twins[0][0]).refs[0], m.line(f.twins[0][2]).refs[0]];
  const width = measured(m, ["dist", f.twins[0][0], f.twins[0][2]]);
  close(width, 45, 1e-6, "the lid followed");
  void a; void b;
});

test("the angle between two walls of a wedge is the angle between their lines", () => {
  const { m, lines, e } = wedge();
  const plan = dimensionFor(m, [`${e}.m0`, `${e}.m2`]);
  assert.equal(plan?.text, `ang("${lines[0]}", "${lines[2]}", deg(150))`);
  const flip = dimensionFor(m, [`${e}.m0`, `${e}.m1`]);
  assert.equal(flip?.text, `ang("${lines[0]}", "${lines[1]}", deg(90))`);
});

test("an extrude's lid and its own base are its depth: the tool edits that, and makes nothing new", () => {
  const { m, e } = block();
  const f = m.featureOf(e, "extrude");
  const plan = dimensionFor(m, [`${e}.lid`, `${e}.base`]);
  assert.equal(plan?.edits, f.depth);
  assert.equal(plan?.reading, "20");
  assert.equal(plan?.text, `set("${f.depth}.value", `);
  const before = m.relations.size;
  assert.equal(plan!.apply(m), f.depth);
  assert.equal(m.relations.size, before, "nothing made");
});

test("a point to a face is fdist: setting it moves the point, and it survives save and open", () => {
  const { m, t, e } = block();
  // A free point above the block — off the sketch plane, held nowhere.
  const p = m.addPoint(t.at(10, 10, 32)).name;
  fix(m, p, [10, 10, 32], t.name);
  del(m, [...m.relations.values()].at(-1)!.name);
  const plan = dimensionFor(m, [`${e}.lid`, p]);
  assert.equal(plan?.text, `fdist("${e}.lid", "${p}", 12)`);
  const d = plan!.apply(m);
  assert.match(d, /^d\d+$/, "a dimension, d-named");
  solved(m);
  set(m, `${d}.value`, 5);
  solved(m);
  const lid = m.coords(m.line(m.featureOf(e, "extrude").twins[0][0]).refs[0]);
  close(Math.abs(dotN(sub(m.coords(p), lid), t.uz)), 5, 1e-6, "five above the lid, square to it");
  const back = open(save(m), 3);
  solved(back);
  assert.equal(back.relations.get(d)?.op, "faceDistance");
  close(Math.abs(dotN(sub(back.coords(p), lid), t.uz)), 5, 1e-6, "replayed");
  // And the 3D test of the generic claim: its row is one condition.
  const free = back.diagnose().dof;
  del(back, d);
  assert.equal(back.diagnose().dof, free + 1, "fdist took exactly one freedom");
});

test("a face of one block to a face of another, both held by their depths: redundant, so made driven", () => {
  const { m, t } = block();
  const { lines } = polygon(m, t, [[60, 0], [80, 0], [80, 10], [60, 10]]);
  const e2 = extrude(m, lines[0], 35);
  solved(m);
  const plan = dimensionFor(m, ["e1.lid", `${e2}.lid`]);
  assert.equal(plan?.text, `fdist("e1.lid", "${e2}.lid", 15)`);
  const copy = open(save(m), 3);
  const made = plan!.apply(copy);
  assert.match(drivenBecause(copy, made) ?? "", /already held/);
  assert.equal(plan!.driven?.text, `measure("fdist", "e1.lid", "${e2}.lid")`);
  // The driven one reads the same number, and holds nothing.
  const r = plan!.driven!.apply(m);
  close(measured(m, m.relations.get(r)!.args), 15);
  assert.equal(m.relations.get(r)!.blocks.length, 0);
});

test("a conflicting dimension is made driven too, and one that drives is left driving", () => {
  const m = new Model(2);
  line(m, "l1", [0, 0], [10, 0]);
  fix(m, "l1a", [0, 0]);
  fix(m, "l1b", [10, 0]);
  const plan = dimensionFor(m, ["l1"])!;
  const made = plan.apply(m);
  assert.match(drivenBecause(m, made) ?? "", /already held/, "both ends fixed: its length is held");
  const n = new Model(2);
  line(n, "l1", [0, 0], [10, 0]);
  const ok = dimensionFor(n, ["l1"])!.apply(n);
  assert.equal(drivenBecause(n, ok), null);
  // A conflict: the length fixed by two pins, then asked to be something else.
  const c = new Model(2);
  line(c, "l1", [0, 0], [10, 0]);
  fix(c, "l1a", [0, 0]);
  fix(c, "l1b", [10, 0]);
  const bad = dist(c, "l1a", "l1b", 12);
  assert.match(drivenBecause(c, bad) ?? "", /conflict/);
});

test("faces at an angle that no line holds: the angle between them, driven", () => {
  const { m, t, e } = block();
  // A second block standing on the first's sketch plane, turned 30° about it — a
  // different extrude, walls along the same direction: their lines' angle.
  const c = Math.cos(Math.PI / 6), s = Math.sin(Math.PI / 6);
  const { lines } = polygon(m, t, [[60, 0], [60 + 10 * c, 10 * s], [60 + 10 * c - 10 * s, 10 * s + 10 * c], [60 - 10 * s, 10 * c]]);
  const e2 = extrude(m, lines[0], 5);
  solved(m);
  const plan = dimensionFor(m, [`${e}.m0`, `${e2}.m0`]);
  assert.equal(plan?.text, `ang("l1", "${lines[0]}", deg(30))`);
  // A wall and a lid are square by construction: driven.
  const sq = dimensionFor(m, [`${e}.m0`, `${e}.lid`]);
  assert.equal(sq?.text, `measure("fangle", "${e}.m0", "${e}.lid")`);
  assert.equal(sq?.reading, "(90°)");
});

test("a round wall is the circle it was swept from: ⌀ for a whole one, driving", () => {
  const m = new Model(3);
  const t = tiltedFrame(m);
  const c = m.addPoint(t.at(0, 0)).name;
  onPlane(m, c, t.name);
  const ring = m.addCircle(c, 6, t.name).name;
  parallel(m, ring, `${t.name}.z`);
  const e = extrude(m, ring, 10);
  solved(m);
  assert.equal(dimensionFor(m, [`${e}.m0`])?.text, `dia("${ring}", 12)`);
  assert.equal(dimensionFor(m, [`${e}.m0`], { radial: "radius" })?.text, `rad("${ring}", 6)`);
});

test("a face only the kernel knows — a fillet's — is measured, never held", () => {
  const { m, e } = block();
  setSolidReader((name) => name === "e2.f0" ? { kind: "cylinder", point: [0, 0, 0], radius: 3 }
    : name === "e2.f1" ? { kind: "plane", point: m.coords("t_o"), normal: [0, 0, 1] }
      : name === "e9.lid|e2.f0" ? { kind: "edge", length: 7.5, ends: [[0, 0, 0], [7.5, 0, 0]] } : null);
  try {
    assert.equal(dimensionFor(m, ["e2.f0"])?.text, 'measure("diameter", "e2.f0")');
    assert.equal(dimensionFor(m, ["e2.f0"])?.reading, "(⌀6)");
    assert.equal(dimensionFor(m, ["e9.lid|e2.f0"])?.text, 'measure("length", "e9.lid|e2.f0")');
    // Asked for a driving one, still driven: nothing holds it.
    const plan = dimensionFor(m, ["e2.f0"], { driven: false })!;
    assert.match(plan.text, /^measure/);
    const r = plan.apply(m);
    close(measured(m, m.relations.get(r)!.args), 6);
    // A model face against the kernel's: the reading, driven.
    const x = dimensionFor(m, [`${e}.lid`, "e2.f1"]);
    assert.match(x?.text ?? "", /^measure\("(fdist|fangle)"/);
  } finally {
    setSolidReader(null);
  }
});

test("deleting a feature takes the dimensions on its faces", () => {
  const { m, t, e } = block();
  const p = m.addPoint(t.at(10, 10, 32)).name;
  const d = faceDistance(m, `${e}.lid`, p, 12);
  const r = measure(m, "fdist", `${e}.lid`, p);
  solved(m);
  const gone = del(m, e);
  assert.ok(gone.includes(d) && gone.includes(r), gone.join(" "));
  solved(m);
});

test("the glyph of a face distance is its number, between the point and its foot on the face", () => {
  const { m, t, e } = block();
  const p = m.addPoint(t.at(10, 10, 32)).name;
  faceDistance(m, `${e}.lid`, p, 12);
  measure(m, "fdist", `${e}.lid`, p);
  const view = defaultView();
  const gs = placeGlyphs(m, view).filter((g) => g.op === "faceDistance" || g.op === "measure");
  assert.deepEqual(gs.map((g) => g.symbol).sort(), ["(12)", "12"]);
  const g = gs[0];
  const [sp] = [worldToScreen(view, m.coords(p))];
  assert.ok(g.ends && Math.hypot(g.ends[1][0] - sp[0], g.ends[1][1] - sp[1]) < 1e-6, "a witness to the point");
});

// --- the table, the sketch -----------------------------------------------------

test("2D: what the tool types for each row", () => {
  const m = new Model(2);
  line(m, "l1", [0, 0], [10, 0]);
  line(m, "l2", [0, 0], [10, 10]);
  line(m, "l3", [0, 5], [10, 5]);
  m.addPoint([3, 7], "p");
  m.addPoint([0, 0], "c0"); m.addCircle("c0", 4, null, "c1");
  m.addPoint([20, 0], "a0"); m.addPoint([25, 0], "as"); m.addPoint([20, 5], "ae");
  m.addArc("a0", "as", "ae", 5, null, "a1");
  m.addPoint([30, 3], "q0"); m.addCircle("q0", 2, null, "c2");
  const t = (names: string[], o = {}) => dimensionFor(m, names, o)?.text ?? null;
  assert.equal(t(["c1"]), 'dia("c1", 8)', "a whole circle: its diameter");
  assert.equal(t(["a1"]), 'rad("a1", 5)', "an arc: its radius");
  assert.equal(t(["c1"], { radial: "radius" }), 'rad("c1", 4)');
  assert.equal(t(["a1"], { radial: "diameter" }), 'dia("a1", 10)');
  assert.equal(t(["p", "c1"]), 'dist("p", "c0", 7.616)', "a point to a circle: to its centre");
  assert.equal(t(["c1", "p"]), 'dist("c0", "p", 7.616)');
  assert.equal(t(["c1", "c2"]), 'dist("c0", "q0", 30.15)', "centre to centre");
  assert.equal(t(["l3", "c2"]), 'dist("q0", "l3", 2)', "a circle's centre to a line");
  // At p = (3, 7): toward (0, 0) is (−3, −7), toward (10, 0) is (7, −7); cos = 28 / (√58 · √98).
  assert.equal(t(["p", "l1a", "l1b"]), `ang3("p", "l1a", "l1b", deg(${Math.round(Math.acos(28 / Math.sqrt(58 * 98)) * 180 / Math.PI * 1000) / 1000}))`, "three points: the angle at the first");
  assert.equal(t(["p", "l1", "l2"]), 'ang("l1", "l2", deg(45))', "a point and two lines: their angle");
  assert.equal(t(["a1", "as", "ae"]), 'arclen("a1", 7.854)', "an arc and its ends: its length");
  assert.equal(t(["as", "a1", "ae"]), 'arclen("a1", 7.854)', "in any order");
  assert.equal(t(["l1", "origin.y"]), 'ang("l1", "origin.y", deg(90))', "a line and an axis: the angle");
  assert.equal(t(["p", "origin.x"]), 'along("origin", "p", "origin.y", 7)', "a point and an axis: how far from it");
  assert.equal(t(["l1", "origin.x"]), null, "parallel to the axis: nothing to say yet");
  assert.ok(takesThird(m, ["p", "l1a"], "l1b"), "two points take a third");
  assert.ok(!takesThird(m, ["c1", "c2"], "p"));
});

test("horizontal, vertical or aligned, by where the label is put", () => {
  const m = new Model(2);
  line(m, "l1", [0, 0], [30, 40]);
  const view = defaultView();
  const at = (x: number, y: number) => ({ toScreen: (w: number[]) => worldToScreen(view, w), at: worldToScreen(view, [x, y]) });
  assert.equal(dimensionFor(m, ["l1"], { place: at(15, 60) })?.text, 'along("l1a", "l1b", "origin.x", 30)', "above both: horizontal");
  assert.equal(dimensionFor(m, ["l1"], { place: at(-20, 20) })?.text, 'along("l1a", "l1b", "origin.y", 40)', "beside both: vertical");
  assert.equal(dimensionFor(m, ["l1"], { place: at(20, 10) })?.text, 'dist("l1a", "l1b", 50)', "between: aligned");
  assert.equal(dimensionFor(m, ["l1"])?.text, 'dist("l1a", "l1b", 50)', "nowhere: aligned");
  assert.equal(dimensionFor(m, ["l1a", "l1b"], { place: at(15, -10) })?.text, 'along("l1a", "l1b", "origin.x", 30)', "two points as well");
  // A level line placed above is its true length: aligned, not along.
  line(m, "l2", [0, 100], [10, 100]);
  assert.equal(dimensionFor(m, ["l2"], { place: at(5, 120) })?.text, 'dist("l2a", "l2b", 10)');
  // Driven, the same reading.
  assert.equal(dimensionFor(m, ["l1"], { place: at(15, 60), driven: true })?.text, 'measure("along", "l1a", "l1b", "origin.x")');
});

test("an ellipse: its major, or its minor where the label is put nearer that axis", () => {
  const m = new Model(2);
  const s = neocadScope({ model: m }) as Record<string, (...a: unknown[]) => unknown>;
  m.addPoint([0, 0], "e0");
  m.addPoint([20, 0], "e1x");
  const e = s.ellipse("e0", "e1x", 8) as string;
  const view = defaultView();
  assert.equal(dimensionFor(m, [e])?.text, `major("${e}", 20)`);
  assert.equal(dimensionFor(m, [e], { place: { toScreen: (w: number[]) => worldToScreen(view, w), at: worldToScreen(view, [0, 30]) } })?.text, `minor("${e}", 8)`);
});

test("along, ang3 and arclen hold what they say, in 2D and in 3D, and set re-runs each", () => {
  for (const dim of [2, 3]) {
    const m = new Model(dim);
    const at = (...v: number[]) => v.slice(0, dim).concat(new Array(Math.max(0, dim - v.length)).fill(0));
    if (dim === 3) tiltedFrame(m);
    const p = m.addPoint(at(1, 2, 0.5)).name, q = m.addPoint(at(9, 7, 1)).name, r = m.addPoint(at(-3, 8, 2)).name;
    const d = distAlong(m, p, q, m.axisRef("x"), 12);
    const a = angle3(m, p, q, r, Math.PI / 3);
    solved(m);
    const ux = dim === 3 ? m.frame(m.defaultFrame!) && (() => {
      const o = m.coords(m.frame(m.defaultFrame!).origin), x = m.coords(m.frame(m.defaultFrame!).xref);
      const u = sub(x, o); return u.map((v) => v / len(u));
    })() : [1, 0];
    close(Math.abs(dotN(sub(m.coords(q), m.coords(p)), ux as number[])), 12, 1e-6, `${dim}D along`);
    const [u, w] = [sub(m.coords(q), m.coords(p)), sub(m.coords(r), m.coords(p))];
    close(Math.acos(dotN(u, w) / (len(u) * len(w))), Math.PI / 3, 1e-6, `${dim}D ang3`);
    set(m, `${d}.value`, 5);
    set(m, `${a}.value`, Math.PI / 4);
    solved(m);
    close(measured(m, ["along", p, q, m.relations.get(d)!.args[2]]), 5, 1e-6);
    close(measured(m, ["angle3", p, q, r]), Math.PI / 4, 1e-6);
    // An arc: its length r·θ.
    const c = m.addPoint(at(30, 0, 0)).name;
    const s0 = m.addPoint(at(40, 0, 0)).name, e0 = m.addPoint(at(30, 10, 0)).name;
    const arc = m.addArc(c, s0, e0, 10, dim === 3 ? m.defaultFrame : null).name;
    arcEndpoints(m, arc);
    if (dim === 3) parallel(m, arc, `${m.defaultFrame}.z`);
    close(measured(m, ["arclen", arc]), (10 * Math.PI) / 2, 1e-6, `${dim}D a quarter`);
    const L = arcLength(m, arc, 20);
    fix(m, c, dim === 3 ? [30, 0, 0] : [30, 0], dim === 3 ? m.defaultFrame : null);
    perpendicular(m, m.addLine(c, s0).name, m.addLine(c, e0).name);
    solved(m);
    close(measured(m, ["arclen", arc]), 20, 1e-6, `${dim}D arclen`);
    close(Math.abs(m.radius(arc)) * Math.PI / 2, 20, 1e-6, "a quarter turn of r = 40/π");
    void L;
  }
});

test("save and open replays every new dimension", () => {
  const m = new Model(2);
  line(m, "l1", [0, 0], [30, 40]);
  m.addPoint([20, 0], "a0"); m.addPoint([25, 0], "as"); m.addPoint([20, 5], "ae");
  m.addArc("a0", "as", "ae", 5, null, "a1");
  const made = [
    distAlong(m, "l1a", "l1b", "origin.x", 30),
    angle3(m, "l1a", "l1b", "as", 0.3),
    arcLength(m, "a1", 7.854),
    measure(m, "along", "l1a", "l1b", "origin.y"),
    measure(m, "arclen", "a1"),
  ];
  const back = open(save(m), 2);
  for (const n of made) assert.deepEqual(back.relations.get(n)?.args, m.relations.get(n)?.args, n);
  assert.deepEqual([...back.relations.keys()], [...m.relations.keys()]);
});

test("measureOf says what the tool would dimension, and makes nothing", () => {
  const { m, e } = block();
  const said: string[] = [];
  const s = neocadScope({ model: m, log: (l: string) => said.push(l) } as Parameters<typeof neocadScope>[0]) as Record<string, (...a: unknown[]) => unknown>;
  const before = m.journal.length;
  assert.equal(s.measureOf(`${e}.m0`, `${e}.m2`), "30");
  assert.equal(m.journal.length, before);
});

// --- the tool -------------------------------------------------------------------

/** A context whose pick answers from a script. */
function scripted(m: Model, picks: (Pick | null)[], options: Record<string, unknown> = {}) {
  const said: string[] = [];
  const edited: string[] = [];
  const ctx: ToolContext = {
    model: m, options,
    requestRender() {}, requestSolve() { m.solve(); }, finish() {},
    pick: () => picks.shift() ?? null,
    log: (l: string) => { said.push(l); },
    editDimension: (name: string) => { edited.push(name); },
  };
  return { ctx, said, edited };
}
const at0 = { world: [0, 0], screen: [0, 0] as [number, number] };
const face = (name: string): Pick => ({ name, kind: "face", distance: 0 });

test("the tool: two faces then a click — and a lid with its base opens the depth instead", async () => {
  const { m, lines, e } = block();
  const { ctx } = scripted(m, [face(`${e}.m0`), face(`${e}.m2`), null]);
  const tool = new DimensionTool(ctx);
  tool.onDown(at0); tool.onDown(at0); tool.onDown(at0);
  await tool.settled;
  const last = [...m.relations.values()].at(-1)!;
  assert.deepEqual([last.op, ...last.args], ["dist", lines[0], lines[2], 30]);
  const f = m.featureOf(e, "extrude");
  const two = scripted(m, [face(`${e}.lid`), face(`${e}.base`), null]);
  const t2 = new DimensionTool(two.ctx);
  const n = m.relations.size;
  t2.onDown(at0); t2.onDown(at0); t2.onDown(at0);
  await t2.settled;
  assert.deepEqual(two.edited, [f.depth]);
  assert.equal(m.relations.size, n);
  assert.match(two.said.join("\n"), /depth/);
});

test("the tool makes a redundant dimension driven, and says so in one line", async () => {
  const m = new Model(2);
  line(m, "l1", [0, 0], [10, 0]);
  fix(m, "l1a", [0, 0]);
  fix(m, "l1b", [10, 0]);
  const { ctx, said } = scripted(m, [{ name: "l1", kind: "line", distance: 0 }, null]);
  const tool = new DimensionTool(ctx);
  tool.onDown(at0); tool.onDown(at0);
  await tool.settled;
  const last = [...m.relations.values()].at(-1)!;
  assert.deepEqual([last.op, ...last.args], ["measure", "dist", "l1a", "l1b"]);
  assert.equal(said.filter((l) => /driven/.test(l)).length, 1, said.join("\n"));
  assert.ok(!m.journal.some((j) => j.op === "deleteRelation"), "headless, the trial was on a copy");
});

test("the tool: three points make an angle at the first; a third thing that makes nothing starts again", async () => {
  const m = new Model(2);
  line(m, "l1", [0, 0], [10, 0]);
  m.addPoint([0, 10], "p");
  m.addPoint([0, 0], "c0"); m.addCircle("c0", 4, null, "c1");
  const P = (n: string): Pick => ({ name: n, kind: "point", distance: 0 });
  const { ctx } = scripted(m, [P("l1a"), P("l1b"), P("p"), null]);
  const tool = new DimensionTool(ctx);
  tool.onDown(at0); tool.onDown(at0); tool.onDown(at0);
  assert.deepEqual(tool.picks, ["l1a", "l1b", "p"]);
  tool.onDown(at0);
  await tool.settled;
  const last = [...m.relations.values()].at(-1)!;
  assert.equal(last.op, "angle3");
  close(last.args[3] as number, Math.PI / 2, 1e-9);
  const again = scripted(m, [P("l1a"), P("p"), { name: "c1", kind: "circle", distance: 0 }]);
  const t2 = new DimensionTool(again.ctx);
  t2.onDown(at0); t2.onDown(at0); t2.onDown(at0);
  assert.deepEqual(t2.picks, ["c1"], "two points and a circle make nothing: it starts again from the circle");
});
