import { test } from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { ensureKernelLoaded } from "../src/kernel/problem.ts";
import { Model } from "../src/model.ts";
import { dist, fix } from "../src/relations/basic.ts";
import {
  angle, arcEndpoints, concentric, equalLength, equalRadius, onCircle,
  parallel, perpendicular, pointOnLine, radius, symmetric, tangent,
} from "../src/relations/geometry.ts";
import { axisFrame } from "./frames.ts";

async function loadKernel() {
  const bytes = await readFile(new URL("../src/kernel/wasm-gen/neocad_kernel_bg.wasm", import.meta.url));
  await ensureKernelLoaded(bytes);
}

/** A 2D model with a fully-fixed reference line "ref" from (0,0) to (1,0). */
function withRefLine(m: Model) {
  m.addPoint([0, 0], "r0");
  m.addPoint([1, 0], "r1");
  fix(m, "r0", [0, 0]);
  fix(m, "r1", [1, 0]);
  m.addLine("r0", "r1", "ref");
}

function ok(m: Model) {
  const report = m.solve();
  assert.equal(report.solved, true, JSON.stringify(report.offenders));
  return report;
}

/** Perpendicular distance from a point to the infinite line through a and b. */
function distToLine(p: number[], a: number[], b: number[]): number {
  const u = b.map((bi, i) => bi - a[i]);
  const w = p.map((pi, i) => pi - a[i]);
  const len = Math.hypot(...u);
  const proj = w.reduce((s, wi, i) => s + wi * u[i], 0) / len;
  const perp = w.map((wi, i) => wi - (proj * u[i]) / len);
  return Math.hypot(...perp);
}

test("parallel: a free line swings to match a fixed one", async () => {
  await loadKernel();
  const m = new Model(2);
  axisFrame(m); // hor/ver/fix are frame-relative now — see test/frames.ts
  withRefLine(m);
  m.addPoint([0, 5], "a");
  m.addPoint([3, 7], "b");
  fix(m, "a", [0, 5]);
  m.addLine("a", "b", "l");
  parallel(m, "ref", "l");
  ok(m);
  const [, by] = m.coords("b");
  assert.ok(Math.abs(by - 5) < 1e-6, `parallel to a horizontal ref should level out, got y=${by}`);
});

test("perpendicular: a free line squares up against a fixed one", async () => {
  await loadKernel();
  const m = new Model(2);
  axisFrame(m); // hor/ver/fix are frame-relative now — see test/frames.ts
  withRefLine(m);
  m.addPoint([0, 0], "a");
  m.addPoint([3, 7], "b");
  fix(m, "a", [0, 0]);
  m.addLine("a", "b", "l");
  perpendicular(m, "ref", "l");
  ok(m);
  const [bx] = m.coords("b");
  assert.ok(Math.abs(bx) < 1e-6, `perpendicular to a horizontal ref should be vertical, got x=${bx}`);
});

test("angle: 60 degrees off a fixed reference line", async () => {
  await loadKernel();
  const m = new Model(2);
  axisFrame(m); // hor/ver/fix are frame-relative now — see test/frames.ts
  withRefLine(m);
  m.addPoint([0, 0], "a");
  m.addPoint([3, 1], "b");
  fix(m, "a", [0, 0]);
  m.addLine("a", "b", "l");
  dist(m, "a", "b", 1); // pin the length so only the direction is free
  angle(m, "ref", "l", Math.PI / 3);
  ok(m);
  const [bx, by] = m.coords("b");
  const theta = Math.acos(bx / Math.hypot(bx, by)); // angle against (1,0)
  assert.ok(Math.abs(theta - Math.PI / 3) < 1e-6, `expected 60deg, got ${(theta * 180) / Math.PI}`);
});

test("pointOnLine: a stray point slides onto the line", async () => {
  await loadKernel();
  const m = new Model(2);
  axisFrame(m); // hor/ver/fix are frame-relative now — see test/frames.ts
  m.addPoint([0, 0], "a");
  m.addPoint([10, 10], "b");
  fix(m, "a", [0, 0]);
  fix(m, "b", [10, 10]);
  m.addLine("a", "b", "l");
  m.addPoint([5, 0], "q");
  pointOnLine(m, "q", "l");
  ok(m);
  const [qx, qy] = m.coords("q");
  assert.ok(Math.abs(qx - qy) < 1e-6, `q should land on y=x, got (${qx}, ${qy})`);
});

test("equalLength: one segment takes the other's length", async () => {
  await loadKernel();
  const m = new Model(2);
  axisFrame(m); // hor/ver/fix are frame-relative now — see test/frames.ts
  m.addPoint([0, 0], "a");
  m.addPoint([4, 0], "b");
  fix(m, "a", [0, 0]);
  fix(m, "b", [4, 0]);
  m.addLine("a", "b", "l1");
  m.addPoint([0, 5], "c");
  m.addPoint([10, 5], "d");
  fix(m, "c", [0, 5]);
  m.addLine("c", "d", "l2");
  equalLength(m, "l1", "l2");
  ok(m);
  const [cx, cy] = m.coords("c");
  const [dx, dy] = m.coords("d");
  assert.ok(Math.abs(Math.hypot(dx - cx, dy - cy) - 4) < 1e-6);
});

test("radius + onCircle: the rim finds the point, the point finds the rim", async () => {
  await loadKernel();
  const m = new Model(2);
  axisFrame(m); // hor/ver/fix are frame-relative now — see test/frames.ts
  m.addPoint([0, 0], "ctr");
  fix(m, "ctr", [0, 0]);
  m.addCircle("ctr", 1, "c");
  radius(m, "c", 5);
  m.addPoint([3, 3], "q");
  onCircle(m, "q", "c");
  ok(m);
  assert.ok(Math.abs(m.radius("c") - 5) < 1e-6, `radius = ${m.radius("c")}`);
  const [qx, qy] = m.coords("q");
  assert.ok(Math.abs(Math.hypot(qx, qy) - 5) < 1e-6, `q at distance ${Math.hypot(qx, qy)}`);
});

test("concentric + equalRadius: a second circle matches the first", async () => {
  await loadKernel();
  const m = new Model(2);
  axisFrame(m); // hor/ver/fix are frame-relative now — see test/frames.ts
  m.addPoint([2, 3], "c1ctr");
  fix(m, "c1ctr", [2, 3]);
  m.addCircle("c1ctr", 7, "c1");
  radius(m, "c1", 7);
  m.addPoint([-4, 9], "c2ctr");
  m.addCircle("c2ctr", 1, "c2");
  concentric(m, "c1", "c2");
  equalRadius(m, "c1", "c2");
  ok(m);
  assert.deepEqual(m.coords("c2ctr").map((v) => Math.round(v * 1e6) / 1e6), [2, 3]);
  assert.ok(Math.abs(m.radius("c2") - 7) < 1e-6);
});

test("tangent: a free radius grows until the circle kisses a fixed line", async () => {
  await loadKernel();
  const m = new Model(2);
  axisFrame(m); // hor/ver/fix are frame-relative now — see test/frames.ts
  m.addPoint([0, 0], "ctr");
  fix(m, "ctr", [0, 0]);
  m.addCircle("ctr", 1, "c");
  m.addPoint([-10, 8], "a");
  m.addPoint([10, 8], "b");
  fix(m, "a", [-10, 8]);
  fix(m, "b", [10, 8]);
  m.addLine("a", "b", "l");
  tangent(m, "l", "c");
  ok(m);
  assert.ok(Math.abs(m.radius("c") - 8) < 1e-6, `radius = ${m.radius("c")}, expected 8`);
});

test("tangent: a free line slides in until it kisses a fixed circle", async () => {
  await loadKernel();
  const m = new Model(2);
  axisFrame(m); // hor/ver/fix are frame-relative now — see test/frames.ts
  m.addPoint([0, 0], "ctr");
  fix(m, "ctr", [0, 0]);
  m.addCircle("ctr", 5, "c");
  radius(m, "c", 5);
  m.addPoint([-10, 8], "a");
  m.addPoint([10, 8], "b");
  m.addLine("a", "b", "l");
  tangent(m, "l", "c");
  ok(m);
  const d = distToLine([0, 0], m.coords("a"), m.coords("b"));
  assert.ok(Math.abs(d - 5) < 1e-6, `line sits ${d} from the center, expected 5`);
});

test("symmetric: a point mirrors across a fixed line", async () => {
  await loadKernel();
  const m = new Model(2);
  axisFrame(m); // hor/ver/fix are frame-relative now — see test/frames.ts
  m.addPoint([0, 0], "s");
  m.addPoint([0, 10], "e");
  fix(m, "s", [0, 0]);
  fix(m, "e", [0, 10]); // the y-axis
  m.addLine("s", "e", "axis");
  m.addPoint([3, 4], "a");
  fix(m, "a", [3, 4]);
  m.addPoint([1, 1], "b");
  symmetric(m, "a", "b", "axis");
  ok(m);
  const [bx, by] = m.coords("b");
  assert.ok(Math.abs(bx + 3) < 1e-6 && Math.abs(by - 4) < 1e-6, `mirror of (3,4) should be (-3,4), got (${bx}, ${by})`);
});

test("arcEndpoints: both ends are pulled onto the arc's own circle", async () => {
  await loadKernel();
  const m = new Model(2);
  axisFrame(m); // hor/ver/fix are frame-relative now — see test/frames.ts
  m.addPoint([0, 0], "ctr");
  fix(m, "ctr", [0, 0]);
  m.addPoint([10, 0], "s");
  m.addPoint([0, 10], "e");
  m.addArc("ctr", "s", "e", 5, "arc");
  radius(m, "arc", 5);
  arcEndpoints(m, "arc");
  ok(m);
  assert.ok(Math.abs(Math.hypot(...m.coords("s")) - 5) < 1e-6);
  assert.ok(Math.abs(Math.hypot(...m.coords("e")) - 5) < 1e-6);
});

// --- the genericity claim, checked rather than asserted ---------------------

test("3D: perpendicular is the identical code, one dimension up", async () => {
  await loadKernel();
  const m = new Model(3);
  m.addPoint([0, 0, 0], "r0");
  m.addPoint([1, 0, 0], "r1");
  fix(m, "r0", [0, 0, 0]);
  fix(m, "r1", [1, 0, 0]);
  m.addLine("r0", "r1", "ref");
  m.addPoint([0, 0, 0], "a");
  m.addPoint([1, 1, 1], "b");
  fix(m, "a", [0, 0, 0]);
  m.addLine("a", "b", "l");
  perpendicular(m, "ref", "l");
  ok(m);
  const [bx] = m.coords("b");
  assert.ok(Math.abs(bx) < 1e-6, `perpendicular to the x-axis means x=0, got ${bx}`);
});

test("3D: parallel uses all three wedge components, not just one", async () => {
  await loadKernel();
  const m = new Model(3);
  m.addPoint([0, 0, 0], "r0");
  m.addPoint([1, 2, 3], "r1");
  fix(m, "r0", [0, 0, 0]);
  fix(m, "r1", [1, 2, 3]);
  m.addLine("r0", "r1", "ref");
  m.addPoint([0, 0, 0], "a");
  m.addPoint([5, 1, 0], "b");
  fix(m, "a", [0, 0, 0]);
  m.addLine("a", "b", "l");
  parallel(m, "ref", "l");
  dist(m, "a", "b", Math.sqrt(14)); // pin the length so the answer is exactly +/-(1,2,3)
  ok(m);
  const b = m.coords("b");
  const k = b[0]; // scale factor against (1,2,3)
  assert.ok(Math.abs(b[1] - 2 * k) < 1e-6 && Math.abs(b[2] - 3 * k) < 1e-6, `b=${b} is not a multiple of (1,2,3)`);
  assert.ok(Math.abs(Math.abs(k) - 1) < 1e-6, `expected |k|=1, got ${k}`);
});

test("3D: symmetric about a line is a half-turn, and still solves", async () => {
  await loadKernel();
  const m = new Model(3);
  m.addPoint([0, 0, 0], "s");
  m.addPoint([0, 0, 10], "e");
  fix(m, "s", [0, 0, 0]);
  fix(m, "e", [0, 0, 10]); // the z-axis
  m.addLine("s", "e", "axis");
  m.addPoint([3, 4, 7], "a");
  fix(m, "a", [3, 4, 7]);
  m.addPoint([1, 1, 1], "b");
  symmetric(m, "a", "b", "axis");
  ok(m);
  const [bx, by, bz] = m.coords("b");
  assert.ok(
    Math.abs(bx + 3) < 1e-6 && Math.abs(by + 4) < 1e-6 && Math.abs(bz - 7) < 1e-6,
    `half-turn of (3,4,7) about z should be (-3,-4,7), got (${bx}, ${by}, ${bz})`,
  );
});
