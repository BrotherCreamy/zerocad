// Format version 7, and the translation that gives files from before it the
// plane every 3D circle and arc now carries — the rule written out at the top
// of src/planetranslation.ts, one claim per test.

import { test } from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { ensureKernelLoaded } from "../src/kernel/problem.ts";
import { Model } from "../src/model.ts";
import { FORMAT, VERSION, open, save } from "../src/persist.ts";
import { fillet } from "../src/operations.ts";
import { curveFrame } from "../src/curveplane.ts";
import { arcPoint } from "../src/arcgeom.ts";
import { tiltedFrame } from "./frames.ts";

async function loadKernel() {
  const bytes = await readFile(new URL("../src/kernel/wasm-gen/neocad_kernel_bg.wasm", import.meta.url));
  await ensureKernelLoaded(bytes);
}

const dot = (a: number[], b: number[]) => a.reduce((s, x, i) => s + x * b[i], 0);
const sub = (a: number[], b: number[]) => a.map((x, i) => x - b[i]);
const close = (a: number, b: number, tol = 1e-9) => Math.abs(a - b) <= tol;

type Entry = { op: string; args: unknown[] };
const file = (version: number, dim: number, journal: Entry[], points: Record<string, number[]> = {}) =>
  JSON.stringify({ format: FORMAT, version, dim, journal, values: { points, radii: {} } });

/** A 3D frame's entries, kernel-aligned or tilted by turning +y up toward +z. */
function frameEntries(name: string, origin: number[], ux: number[], uy: number[]): Entry[] {
  const at = (v: number[]) => origin.map((o, i) => o + 10 * v[i]);
  return [
    { op: "addPoint", args: [origin, `${name}_o`] },
    { op: "addPoint", args: [at(ux), `${name}_x`] },
    { op: "addPoint", args: [at(uy), `${name}_y`] },
    { op: "addFrame", args: [`${name}_o`, `${name}_x`, `${name}_y`, name] },
  ];
}

test("version 7: circles and arcs carry their plane before their name, and a 3D file round-trips", async () => {
  await loadKernel();
  assert.equal(VERSION, 7);
  const m = new Model(3);
  const t = tiltedFrame(m);
  m.addPoint(t.at(1, 2), "c");
  m.addCircle("c", 4, null, "k");
  m.addArc("c", null, null, 3, null, "a");
  const text = save(m);
  const saved = JSON.parse(text);
  assert.equal(saved.version, 7);
  assert.deepEqual(saved.journal.find((e: Entry) => e.op === "addCircle").args, ["c", 4, "t", "k"]);
  assert.deepEqual(saved.journal.find((e: Entry) => e.op === "addArc").args, ["c", null, null, 3, "t", "a"]);
  const back = open(text);
  assert.equal(back.circle("k").plane, "t");
  assert.equal(back.arc("a").plane, "t");
  assert.equal(save(back), text, "stable");
});

test("a 2D file from before 7 opens into 2D with null planes, name where the name goes now", async () => {
  await loadKernel();
  const m = open(file(6, 2, [
    { op: "addPoint", args: [[0, 0], "c"] },
    { op: "addCircle", args: ["c", 5, "k"] },
    { op: "addArc", args: ["c", null, null, 5, "a"] },
  ]));
  assert.equal(m.circle("k").plane, undefined);
  assert.deepEqual(m.journal[1], { op: "addCircle", args: ["c", 5, null, "k"] });
  assert.deepEqual(m.journal[2], { op: "addArc", args: ["c", null, null, 5, null, "a"] });
  const again = save(m);
  assert.equal(save(open(again)), again, "and re-saves as 7, stably");
});

test("a v6 3D circle takes the default frame at its step", async () => {
  await loadKernel();
  const m = open(file(6, 3, [
    ...frameEntries("f1", [0, 0, 0], [1, 0, 0], [0, 1, 0]),
    ...frameEntries("f2", [0, 0, 50], [1, 0, 0], [0, 0, 1]),
    { op: "setDefaultFrame", args: ["f2"] },
    { op: "addPoint", args: [[3, 0, 50], "c"] },
    { op: "addCircle", args: ["c", 5, "k"] },
  ]));
  assert.equal(m.circle("k").plane, "f2");
  assert.deepEqual(m.journal.find((e) => e.op === "addCircle")!.args, ["c", 5, "f2", "k"]);
});

test("a v6 3D arc takes the frame whose +z is nearest its own normal — not the default", async () => {
  await loadKernel();
  const t = 0.6;
  const wallY = [0, Math.cos(t), Math.sin(t)]; // a frame tipped t about +x
  const m = open(file(6, 3, [
    ...frameEntries("floor", [0, 0, 0], [1, 0, 0], [0, 1, 0]),
    ...frameEntries("wall", [0, 0, 0], [1, 0, 0], wallY),
    { op: "setDefaultFrame", args: ["floor"] },
    { op: "addPoint", args: [[0, 0, 0], "c"] },
    { op: "addPoint", args: [[8, 0, 0], "s"] },
    { op: "addPoint", args: [wallY.map((x) => 8 * x), "e"] },
    { op: "addArc", args: ["c", "s", "e", 8, "a"] },
  ]));
  assert.equal(m.arc("a").plane, "wall", "the arc lies in the wall's plane, and is given it");
  assert.equal(m.journal.find((e) => e.op === "addArc")!.args[4], "wall");
  // And it is the arc v6 drew: the quarter from s to e.
  const f = curveFrame(m, m.arc("a"))!;
  assert.ok(close(f.sweep, Math.PI / 2), `swept ${f.sweep}`);
});

test("a v6 arc reads its plane from the saved coordinates, not the replay's seeds", async () => {
  await loadKernel();
  // The three-point arc's shape: a free centre seeded at the origin and only
  // moved later. Its ends lie in a tilted plane; the replay alone would read
  // the plane through the origin seed.
  const t = 0.8;
  const v = [0, Math.cos(t), Math.sin(t)];
  const on = (a: number, b: number) => [a, b * v[1], b * v[2]].map((x, i) => x + [0, 0, 20][i]);
  // A quarter in the tilted plane, its centre a seed at the origin until the
  // saved values move it: the plane through the seed and the two ends is
  // neither frame's, and the right answer comes only from the saved values.
  const m2 = open(file(6, 3, [
    ...frameEntries("flat", [0, 0, 0], [1, 0, 0], [0, 1, 0]),
    ...frameEntries("tip", [0, 0, 20], [1, 0, 0], v),
    { op: "setDefaultFrame", args: ["flat"] },
    { op: "addPoint", args: [on(10, 0), "s"] },
    { op: "addPoint", args: [on(0, 10), "e"] },
    { op: "addArc", args: [null, "s", "e", 10, "a"] },
    { op: "setCoords", args: ["p1", on(0, 0)] },
  ], { s: on(10, 0), e: on(0, 10), p1: on(0, 0) }));
  assert.equal(m2.arc("a").plane, "tip");
  assert.ok(close(curveFrame(m2, m2.arc("a"))!.sweep, Math.PI / 2));
});

test("a v6 arc whose frame faces the other way from the kernel's +z is swapped end for end, so it opens as the arc it was", async () => {
  await loadKernel();
  const m = open(file(6, 3, [
    // The only frame faces down: +x along x, +y along −y, so +z is −z.
    ...frameEntries("down", [0, 0, 0], [1, 0, 0], [0, -1, 0]),
    { op: "setDefaultFrame", args: ["down"] },
    { op: "addPoint", args: [[0, 0, 0], "c"] },
    { op: "addPoint", args: [[10, 0, 0], "s"] },
    { op: "addPoint", args: [[0, 10, 0], "e"] },
    { op: "addArc", args: ["c", "s", "e", 10, "a"] },
  ]));
  // Version 6 drew counter-clockwise about +z: the quarter from (10,0) to (0,10).
  const f = curveFrame(m, m.arc("a"))!;
  assert.ok(close(f.sweep, Math.PI / 2), `the quarter, not the three quarters: ${f.sweep}`);
  const mid = arcPoint(f, f.sweep / 2);
  assert.ok(close(mid[0], 10 * Math.SQRT1_2) && close(mid[1], 10 * Math.SQRT1_2), `through ${mid}`);
  assert.equal(m.arc("a").start, "e", "stored the other way round about the frame's +z");
  assert.deepEqual(m.journal.find((e) => e.op === "addArc")!.args, ["c", "e", "s", 10, "down", "a"],
    "and so it re-saves");
  const text = save(m);
  assert.ok(close(curveFrame(open(text), open(text).arc("a"))!.sweep, Math.PI / 2), "and reopens the same");
});

test("a file with no frame at all gets one of the translation's own, in the curve's plane, on its centre", async () => {
  await loadKernel();
  // A 2D drawing with a circle and no frame, opened into the 3D app.
  const m = open(file(5, 2, [
    { op: "addPoint", args: [[40, 30], "c"] },
    { op: "addCircle", args: ["c", 12, "k"] },
    { op: "addPoint", args: [[0, 0], "plane"] }, // a name the translation must not take
  ]), 3);
  const made = m.circle("k").plane!;
  assert.equal(made, "plane2", "never a name the file uses");
  const fr = m.frame(made);
  assert.deepEqual(m.coords(fr.origin), [40, 30, 0], "its origin on the circle's centre");
  assert.deepEqual(curveFrame(m, m.circle("k"))!.normal, [0, 0, 1], "in the kernel's x–y plane, where every 2D drawing lived");
  const ops = m.journal.map((e) => e.op);
  assert.deepEqual(ops.slice(0, 6), ["addPoint", "addPoint", "addPoint", "addPoint", "addFrame", "addCircle"],
    "made just before the circle that needs it");
  assert.equal(m.solve().solved, true);
  const text = save(m);
  assert.equal(save(open(text)), text, "an ordinary frame from then on: it re-saves and reopens");
});

test("a version-7 2D file — null planes — lifts into 3D the same way, its curves given a plane", async () => {
  await loadKernel();
  // What the library writes for a 2D model today: the plane slot is there,
  // and null, which is exactly what a 3D model cannot take.
  const m2 = new Model(2);
  m2.addPoint([40, 30], "c");
  m2.addCircle("c", 12, null, "k");
  m2.addArc("c", null, null, 8, null, "a");
  m2.addPoint([0, 0], "q"); m2.addPoint([30, 0], "r"); m2.addPoint([0, 30], "s");
  m2.addLine("r", "q", "l1"); m2.addLine("q", "s", "l2");
  const text = save(m2);
  assert.equal(JSON.parse(text).version, 7);
  const m = open(text, 3);
  const plane = m.circle("k").plane!;
  assert.equal(m.arc("a").plane, plane, "one frame of the translation's own, for every curve in the 2D drawing");
  assert.deepEqual(m.coords(m.frame(plane).origin), [40, 30, 0]);
  assert.equal(m.solve().solved, true);
  // And a fillet typed into the lifted drawing finds that plane to round in.
  m.setDefaultFrame(plane);
  assert.equal(m.arc(fillet(m, "l1", "l2", 5)).plane, plane);
});

test("an arc in a plane no frame shares gets a translation frame in that plane", async () => {
  await loadKernel();
  const t = 1.0;
  const v = [0, Math.cos(t), Math.sin(t)];
  const m = open(file(6, 3, [
    ...frameEntries("flat", [0, 0, 0], [1, 0, 0], [0, 1, 0]),
    { op: "setDefaultFrame", args: ["flat"] },
    { op: "addPoint", args: [[0, 0, 5], "c"] },
    { op: "addPoint", args: [[6, 0, 5], "s"] },
    { op: "addPoint", args: [v.map((x, i) => 6 * x + [0, 0, 5][i]), "e"] },
    { op: "addArc", args: ["c", "s", "e", 6, "a"] },
  ]));
  const plane = m.arc("a").plane!;
  assert.notEqual(plane, "flat", "the default does not fit, and is not forced on it");
  const n = curveFrame(m, m.arc("a"))!.normal;
  const want = [0, -Math.sin(t), Math.cos(t)]; // x × v, on the kernel's +z side
  assert.ok(n.every((x, i) => close(x, want[i])), `its own plane: ${n}`);
  assert.ok(close(curveFrame(m, m.arc("a"))!.sweep, Math.PI / 2));
  assert.deepEqual(m.coords(m.frame(plane).origin), [0, 0, 5], "on the arc's centre");
  // The frame's entries come before the arc's in the journal, so the file reopens.
  const ops = m.journal.map((e) => e.op === "addFrame" ? `addFrame:${e.args[3]}` : e.op);
  assert.ok(ops.indexOf(`addFrame:${plane}`) < ops.indexOf("addArc"), ops.join(" "));
  const text = save(m);
  assert.equal(save(open(text)), text);
});

test("a frame the file later deletes is no candidate — the deletion would be refused at its step", async () => {
  await loadKernel();
  const m = open(file(6, 3, [
    ...frameEntries("gone", [0, 0, 0], [1, 0, 0], [0, 1, 0]),
    ...frameEntries("kept", [0, 0, 0], [1, 0, 0], [0, 1, 0]),
    { op: "setDefaultFrame", args: ["gone"] },
    { op: "addPoint", args: [[0, 0, 0], "c"] },
    { op: "addCircle", args: ["c", 5, "k"] },
    { op: "setDefaultFrame", args: [null] },
    { op: "deleteEntity", args: ["gone"] },
  ]));
  assert.equal(m.circle("k").plane, "kept");
  assert.equal(m.entities.has("gone"), false, "and the deletion went through");
});

test("a v6 fillet is given the frame its corner lies in", async () => {
  await loadKernel();
  const t = 0.5;
  const v = [0, Math.cos(t), Math.sin(t)];
  const at = (a: number, b: number) => [a, b * v[1], b * v[2]];
  const m = open(file(6, 3, [
    ...frameEntries("flat", [0, 0, 0], [1, 0, 0], [0, 1, 0]),
    ...frameEntries("tip", [0, 0, 0], [1, 0, 0], v),
    { op: "setDefaultFrame", args: ["flat"] },
    { op: "addPoint", args: [at(30, 0), "a"] },
    { op: "addPoint", args: [at(0, 0), "k"] },
    { op: "addPoint", args: [at(0, 30), "b"] },
    { op: "addLine", args: ["a", "k", "l1"] },
    { op: "addLine", args: ["k", "b", "l2"] },
    { op: "fillet", args: ["l1", "l2", 6] },
  ]));
  assert.deepEqual(m.journal.find((e) => e.op === "fillet")!.args, ["l1", "l2", 6, "tip"]);
  assert.equal(m.solve().solved, true);
  const arc = [...m.entities.values()].find((e) => e.kind === "arc")!;
  const c = m.coords((arc as { center: string }).center);
  assert.ok(Math.hypot(...sub(c, at(6, 6))) < 1e-6, `centre ${c}`);
  const f = curveFrame(m, arc)!;
  assert.ok(f.sweep < Math.PI, "the short way round");
  assert.ok(close(Math.abs(dot(f.normal, [0, -Math.sin(t), Math.cos(t)])), 1));
});
