// 3D phase 2, planar discipline: circles and arcs lie in a plane — since
// docs/plans/frameless-curves.md, one they carry themselves, as a normal.
//
// Closed forms throughout, against frames tilted off every kernel axis — "it
// solved" is what a sphere-tangent line and a wrong-plane rim both report too.
// The claims:
//
//   * a 3D circle's normal is a seed — the drawing plane's at call time, or the
//     plane named — journalled as the call, and refused in 2D; nothing makes a
//     frame for it;
//   * the normal orients the rim through the circle's own centre and never pins
//     that centre: drag the centre off the plane and the rim goes with it,
//     parallel;
//   * `onCircle` and `tangent` in 3D are the planar rim, two blocks each, the
//     normal geometry the solver may turn — a free circle turns to meet them, a
//     held one (`par`) does not — and in 2D exactly the one block each they
//     always were, value for value;
//   * an arc turns about its own normal, never the kernel's +z;
//   * a planar circle is drawn, picked and lifted as the ellipse it projects to;
//   * deleting a frame takes the `par` holding a circle to it and leaves the
//     circle, and a fillet's arc follows its corner with no frame at all.

import { test } from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { ensureKernelLoaded } from "../src/kernel/problem.ts";
import { Model } from "../src/model.ts";
import { fix } from "../src/relations/basic.ts";
import { arcEndpoints, onCircle, parallel, radius, tangent } from "../src/relations/geometry.ts";
import { del, fillet } from "../src/operations.ts";
import { curveFrame, curvePlaneOf } from "../src/curveplane.ts";
import { arcPoint } from "../src/arcgeom.ts";
import { screenCurve } from "../src/projection.ts";
import { hitTest } from "../src/picking.ts";
import { alignView, orbitBy, viewAxes, worldToScreen, type View } from "../src/view.ts";
import { describePick } from "../src/picking.ts";
import { neocadScope } from "../src/replenv.ts";
import { axisFrame, tiltedFrame } from "./frames.ts";

async function loadKernel() {
  const bytes = await readFile(new URL("../src/kernel/wasm-gen/neocad_kernel_bg.wasm", import.meta.url));
  await ensureKernelLoaded(bytes);
}

const dot = (a: number[], b: number[]) => a.reduce((s, x, i) => s + x * b[i], 0);
const sub = (a: number[], b: number[]) => a.map((x, i) => x - b[i]);
const close = (a: number, b: number, tol = 1e-9) => Math.abs(a - b) <= tol;

/** Every stored residual's value and label, read straight off the problem. */
function residuals(m: Model): { r: number[]; labels: (string | undefined)[] } {
  return (m.problem as unknown as { evaluate(): { r: number[]; labels: (string | undefined)[] } }).evaluate();
}

/** A second tilted frame, not the default — the plane a test names when it means a particular one. */
function otherFrame(m: Model) {
  const keep = m.defaultFrame;
  const f = tiltedFrame(m, "w", [-4, 7, 1], 1.1, -0.5);
  m.setDefaultFrame(keep);
  return f;
}

// --- the plane reference --------------------------------------------------------

test("a 3D circle faces the drawing plane at call time, or the plane named — a seed, journalled as the call", () => {
  const m = new Model(3);
  const t = tiltedFrame(m);
  const w = otherFrame(m);
  m.addPoint(t.origin, "c");
  const c1 = m.addCircle("c", 5);
  const faces = (name: string, n: number[]) => close(dot(m.normalOf(name), n), 1);
  assert.ok(faces(c1.name, t.uz), "nothing said: the default frame's plane");
  assert.deepEqual(m.journal.at(-1), { op: "addCircle", args: ["c", 5, null, c1.name] }, "and the entry says what was said");
  const c2 = m.addCircle("c", 5, w.name);
  assert.ok(faces(c2.name, w.uz), "or the plane named");
  assert.deepEqual(m.journal.at(-1)!.args, ["c", 5, "w", c2.name]);
  // A seed and no more: moving the default afterwards changes nothing made,
  // and nothing holds the circle to either plane — that is a `par`'s job.
  m.setDefaultFrame("w");
  assert.ok(faces(c1.name, t.uz));
  assert.equal(m.relations.size, 0, "a constructor constrains nothing");
  const a = m.addArc("c", null, null, 3);
  assert.ok(faces(a.name, w.uz));
  assert.equal(m.journal.at(-1)!.args[4], null);
});

test("with no frame at all, a 3D circle or arc faces the origin's +z — and no frame is made", () => {
  const m = new Model(3);
  const c = m.addCircle();
  const a = m.addArc();
  assert.deepEqual(m.normalOf(c.name), [0, 0, 1]);
  assert.deepEqual(m.normalOf(a.name), [0, 0, 1]);
  assert.equal([...m.entities.values()].filter((e) => e.kind === "frame").length, 0, "nothing makes a frame unless asked");
  m.addPoint([0, 0, 0], "p");
  assert.throws(() => m.addCircle("p", 2, "p"), /"p" is not a plane/);
  assert.throws(() => m.addCircle("p", 2, [0, 0, 0]), /three numbers with a direction/);
});

test("a 2D circle refuses a normal — it lies in the one plane there is — and journals none", () => {
  const m = new Model(2);
  axisFrame(m);
  assert.throws(() => m.addCircle(null, 3, "f"), /a 2D circle takes no normal/);
  assert.throws(() => m.addArc(null, null, null, 3, [0, 0, 1]), /a 2D arc takes no normal/);
  const c = m.addCircle(null, 3);
  assert.equal(c.normal, undefined);
  assert.deepEqual(m.journal.at(-1)!.args, [null, 3, null, c.name]);
});

test("the plane orients the rim through the circle's own centre, and dragging the centre off the frame carries it parallel", () => {
  const m = new Model(3);
  const t = tiltedFrame(m);
  m.addPoint(t.at(3, 4), "c");
  const circ = m.addCircle("c", 6).name;
  const rimOf = () => {
    const f = curveFrame(m, m.circle(circ))!;
    return Array.from({ length: 12 }, (_, k) => arcPoint(f, (2 * Math.PI * k) / 12));
  };
  for (const p of rimOf()) {
    assert.ok(close(dot(sub(p, t.origin), t.uz), 0), "a centre on the frame: the rim is on its plane");
    assert.ok(close(Math.hypot(...sub(p, t.at(3, 4))), 6));
  }
  // Nine units off the frame's surface, and nothing pulls it back: a plane is
  // an orientation, not a constraint on the centre.
  m.setCoords("c", t.at(3, 4, 9));
  assert.equal(m.solve().solved, true);
  assert.ok(close(dot(sub(m.coords("c"), t.origin), t.uz), 9), "the centre stayed where it was put");
  for (const p of rimOf()) {
    assert.ok(close(dot(sub(p, t.origin), t.uz), 9), "and the whole rim went with it, parallel");
    assert.ok(close(Math.hypot(...sub(p, t.at(3, 4, 9))), 6));
  }
  assert.deepEqual(curvePlaneOf(m, circ).n.map((x) => Math.round(x * 1e12) / 1e12),
    t.uz.map((x) => Math.round(x * 1e12) / 1e12), "the rim's normal is the frame's +z");
});

test("a free arc in 3D is seeded in the plane it faces, a quarter turn about its normal", () => {
  const m = new Model(3);
  const t = tiltedFrame(m);
  m.addPoint(t.at(1, 1), "c");
  const a = m.addArc("c", null, null, 4);
  for (const end of [a.start, a.end]) {
    const rel = sub(m.coords(end), t.at(1, 1));
    assert.ok(close(Math.hypot(...rel), 4) && close(dot(rel, t.uz), 0), `${end} on the rim, in the plane`);
  }
  const f = curveFrame(m, a)!;
  assert.ok(close(f.sweep, Math.PI / 2), "a quarter, counter-clockwise about its own normal");
  assert.ok(close(dot(f.normal, t.uz), 1));
});

// --- onCircle and tangent: the planar rim -----------------------------------------

test("onCircle in 3D is distance and plane, two blocks, closed form against a tilted frame", () => {
  const m = new Model(3);
  const t = tiltedFrame(m);
  m.addPoint(t.at(2, 1), "c");
  const circ = m.addCircle("c", 5).name;
  // A point 3 along +x, 4 along +y and 2 off the plane: 7 off on the distance
  // (|(3,4,2)| = √29), 2 off the plane.
  m.addPoint(t.at(5, 5, 2), "q");
  const before = m.problem.blockCount;
  onCircle(m, "q", circ);
  assert.equal(m.problem.blockCount - before, 2, "the distance block and the plane block");
  const { r, labels } = residuals(m);
  const at = (label: string) => r[labels.indexOf(label)];
  assert.ok(close(at(`oncircle(q,${circ})`), Math.sqrt(29) - 5), `distance residual ${at(`oncircle(q,${circ})`)}`);
  assert.ok(close(at(`oncircle(q,${circ})|plane`), 2), `plane residual ${at(`oncircle(q,${circ})|plane`)}`);
});

test("onCircle in 3D puts a point on the planar rim, not on the sphere", async () => {
  await loadKernel();
  const m = new Model(3);
  const t = tiltedFrame(m);
  m.addPoint(t.at(2, 1), "c");
  fix(m, "c", [2, 1, 0]);
  const circ = m.addCircle("c", 5).name;
  radius(m, circ, 5);
  parallel(m, circ, "t.z"); // held on the frame's plane, as a tool holds what it draws
  m.addPoint(t.at(5, 5, 2), "q");
  onCircle(m, "q", circ);
  assert.equal(m.solve().solved, true);
  const rel = sub(m.coords("q"), t.at(2, 1));
  assert.ok(close(Math.hypot(...rel), 5, 1e-7), `on the circle: ${Math.hypot(...rel)}`);
  assert.ok(close(dot(rel, t.uz), 0, 1e-7), `and in its plane: ${dot(rel, t.uz)} off`);
});

test("a circle's normal is geometry: a free circle turns to meet a point held on it; one held by par does not", async () => {
  await loadKernel();
  // Free: only the centre and the radius are pinned, and a point off the
  // circle's plane is held on its rim. The circle turns to take it in — what
  // "free to turn in space" means (docs/plans/frameless-curves.md).
  const m = new Model(3);
  const t = tiltedFrame(m);
  m.addPoint(t.at(0, 0), "c");
  fix(m, "c", [0, 0, 0]);
  const circ = m.addCircle("c", 4).name;
  radius(m, circ, 4);
  m.addPoint(t.at(0, 0, 4), "q"); // straight above the centre, 4 off its plane
  fix(m, "q", [0, 0, 4]);
  onCircle(m, "q", circ);
  assert.equal(m.solve().solved, true);
  assert.ok(close(dot(m.normalOf(circ), t.uz), 0, 1e-6), "it stood up: its normal now lies in the frame's plane");
  // Held: the same, with the normal par to the frame's +z, and the point
  // free. Now the point comes down onto the rim, and the circle stays level.
  const n = new Model(3);
  const u = tiltedFrame(n);
  n.addPoint(u.at(0, 0), "c");
  fix(n, "c", [0, 0, 0]);
  const held = n.addCircle("c", 4).name;
  radius(n, held, 4);
  parallel(n, held, "t.z");
  n.addPoint(u.at(4, 0, 5), "q");
  onCircle(n, "q", held);
  assert.equal(n.solve().solved, true);
  assert.ok(close(Math.abs(dot(n.normalOf(held), u.uz)), 1, 1e-9), "still level with the frame");
  assert.ok(close(dot(sub(n.coords("q"), u.origin), u.uz), 0, 1e-7), "and the point met it in its plane");
});

test("tangent in 3D: the line lies in the circle's plane and touches it once", async () => {
  await loadKernel();
  const m = new Model(3);
  const t = tiltedFrame(m);
  m.addPoint(t.at(0, 0), "c");
  fix(m, "c", [0, 0, 0]);
  const circ = m.addCircle("c", 5).name;
  radius(m, circ, 5);
  parallel(m, circ, "t.z");
  // A line well above the plane and not at the right distance.
  m.addPoint(t.at(-10, 8, 4), "a");
  m.addPoint(t.at(10, 7, -3), "b");
  m.addLine("a", "b", "l");
  const before = m.problem.blockCount;
  tangent(m, "l", circ);
  assert.equal(m.problem.blockCount - before, 2, "the distance block and the plane block");
  assert.equal(m.solve().solved, true);
  const [a, b] = [m.coords("a"), m.coords("b")];
  for (const p of [a, b]) assert.ok(close(dot(sub(p, t.origin), t.uz), 0, 1e-7), "both ends in the plane");
  // In the plane, its distance from the centre is the radius.
  const u = sub(b, a), w = sub(t.origin, a);
  const along = dot(w, u) / dot(u, u);
  const foot = a.map((x, i) => x + along * u[i]);
  assert.ok(close(Math.hypot(...sub(foot, t.origin)), 5, 1e-7), "and it touches the rim");
});

test("in 2D, onCircle, tangent and arcends are the blocks they always were, value for value", () => {
  const m = new Model(2);
  m.addPoint([1, 2], "c");
  const circ = m.addCircle("c", 5).name;
  m.addPoint([7, 10], "q");
  let n = m.problem.blockCount;
  onCircle(m, "q", circ);
  assert.equal(m.problem.blockCount - n, 1, "one block: no trivially-zero plane block in 2D");
  m.addPoint([-6, 9], "a");
  m.addPoint([8, 9], "b");
  m.addLine("a", "b", "l");
  n = m.problem.blockCount;
  tangent(m, "l", circ);
  assert.equal(m.problem.blockCount - n, 1);
  m.addPoint([6, 2], "s");
  m.addPoint([1, 7], "e");
  const arc = m.addArc("c", "s", "e", 5).name;
  n = m.problem.blockCount;
  arcEndpoints(m, arc);
  assert.equal(m.problem.blockCount - n, 2, "two onCircles, one block each");
  // The values: today's formulas, written out here.
  const { r, labels } = residuals(m);
  assert.deepEqual(labels, [`oncircle(q,${circ})`, `tan(l,${circ})`, `oncircle(s,${arc})`, `oncircle(e,${arc})`]);
  assert.ok(close(r[0], Math.hypot(6, 8) - 5));
  assert.ok(close(r[1], 7 - 5), "the centre is 7 below a level line at y = 9");
  assert.ok(close(r[2], 0) && close(r[3], 0));
});

test("arcends in 3D holds both ends on the arc's plane as well as its circle", () => {
  const m = new Model(3);
  const t = tiltedFrame(m);
  m.addPoint(t.at(0, 0), "c");
  m.addPoint(t.at(5, 0), "s");
  m.addPoint(t.at(0, 5), "e");
  const arc = m.addArc("c", "s", "e", 5).name;
  const n = m.problem.blockCount;
  arcEndpoints(m, arc);
  assert.equal(m.problem.blockCount - n, 4);
});

// --- which way round: the frame's +z ---------------------------------------------

test("an arc turns about its frame's +z — an upside-down frame draws the arc it was given, not its complement", () => {
  const m = new Model(3);
  // A frame whose +z is the kernel's −z: +x along x, +y along −y.
  m.addPoint([0, 0, 0], "o"); m.addPoint([1, 0, 0], "x"); m.addPoint([0, -1, 0], "y");
  m.addFrame("o", "x", "y", "down");
  m.setDefaultFrame("down");
  m.addPoint([0, 0, 0], "c");
  m.addPoint([10, 0, 0], "s");
  m.addPoint([0, -10, 0], "e");
  const arc = m.addArc("c", "s", "e", 10);
  const f = curveFrame(m, arc)!;
  // Counter-clockwise about −z from +x to −y is a quarter. The kernel's rule
  // turned about +z and drew three quarters.
  assert.ok(close(f.sweep, Math.PI / 2), `swept ${f.sweep}`);
  assert.deepEqual(f.normal.map((x) => x + 0), [0, 0, -1]);
  const mid = arcPoint(f, f.sweep / 2);
  assert.ok(close(mid[0], 10 * Math.SQRT1_2) && close(mid[1], -10 * Math.SQRT1_2), `through ${mid}`);
});

// --- drawn, picked and lifted as an ellipse -----------------------------------------

/** A circle on a tilted frame, and a view square to the frame and then turned a radian away. */
function obliqueCircle() {
  const m = new Model(3);
  const t = tiltedFrame(m);
  m.addPoint(t.at(0, 0), "c");
  const circ = m.addCircle("c", 20).name;
  const view: View = orbitBy(alignView({ ox: 400, oy: 300, scale: 4 }, t.ux, t.uy, t.origin), 1, 0);
  return { m, t, circ, view };
}

test("a planar circle seen obliquely is a closed polyline on its projected ellipse", () => {
  const { m, t, circ, view } = obliqueCircle();
  const shape = screenCurve(m, view, m.circle(circ), 4)!;
  assert.equal(shape.curve.kind, "polyline", "not a circle on screen any more: an ellipse");
  const pts = (shape.curve as { pts: [number, number][] }).pts;
  assert.ok(close(pts[0][0], pts.at(-1)![0]) && close(pts[0][1], pts.at(-1)![1]), "closed");
  // Every vertex is on the ellipse: c' + 20·scale·(cos s·P·u + sin s·P·v) for
  // the matching angle. Read the angle back from the pixel through P⁻¹ and
  // check the radius in the plane.
  const c = worldToScreen(view, t.origin);
  const { right, up } = viewAxes(view);
  const [p, q, r, s] = [dot(t.ux, right), dot(t.uy, right), dot(t.ux, up), dot(t.uy, up)];
  const det = p * s - q * r;
  for (const pt of pts) {
    const [dx, dy] = [(pt[0] - c[0]) / view.scale, -(pt[1] - c[1]) / view.scale];
    const [a, b] = [(s * dx - q * dy) / det, (p * dy - r * dx) / det];
    assert.ok(close(Math.hypot(a, b), 20, 1e-6), `a vertex ${Math.hypot(a, b)} from the centre in the plane`);
  }
  // And foreshortened: along the screen's right the ellipse is cos(1) of 20.
  const xs = pts.map((x) => x[0]);
  assert.ok(close((Math.max(...xs) - Math.min(...xs)) / 2, 20 * view.scale * Math.cos(1), 0.05),
    `half-width ${(Math.max(...xs) - Math.min(...xs)) / 2}`);
});

test("a pixel on the ellipse lifts to a point of the rim — on the circle and in its plane", () => {
  const { m, t, circ, view } = obliqueCircle();
  const want = t.at(20 * Math.cos(2.2), 20 * Math.sin(2.2));
  const px = worldToScreen(view, want);
  const shape = screenCurve(m, view, m.circle(circ), 4)!;
  const got = shape.lift([px[0] + 0.5, px[1] - 0.5]);
  const rel = sub(got, t.origin);
  assert.ok(close(Math.hypot(...rel), 20, 1e-6) && close(dot(rel, t.uz), 0, 1e-9), `lifted to ${got}`);
  assert.ok(Math.hypot(...sub(got, want)) < 0.5, "next to the point aimed at");
  assert.equal(hitTest(m, view, px[0], px[1])?.name, circ, "and it picks there");
  // Where the silhouette would have been, in the same direction, nothing.
  const c = worldToScreen(view, t.origin);
  const d = [px[0] - c[0], px[1] - c[1]];
  const len = Math.hypot(d[0], d[1]);
  if (20 * view.scale - len > 12) {
    const sil: [number, number] = [c[0] + (d[0] / len) * 20 * view.scale, c[1] + (d[1] / len) * 20 * view.scale];
    assert.equal(hitTest(m, view, ...sil), null);
  }
});

test("face-on, a planar circle is still the exact circle it always was", () => {
  const { m, t, circ } = obliqueCircle();
  const face = alignView({ ox: 400, oy: 300, scale: 4 }, t.ux, t.uy, t.origin);
  const shape = screenCurve(m, face, m.circle(circ), 4)!;
  assert.equal(shape.curve.kind, "circle");
  // A 2D model's circles, in a view nobody turned, too.
  const m2 = new Model(2);
  m2.addPoint([0, 0], "c");
  const c2 = m2.addCircle("c", 9).name;
  assert.equal(screenCurve(m2, { ox: 0, oy: 0, scale: 1 }, m2.circle(c2), 4)!.curve.kind, "circle");
});

// --- structure ------------------------------------------------------------------

test("deleting a frame takes the par holding a circle to it, and leaves the circle, free to turn", () => {
  const m = new Model(3);
  const t = tiltedFrame(m);
  m.addPoint(t.at(0, 0), "c");
  const circ = m.addCircle("c", 3).name;
  const arc = m.addArc("c", null, null, 2).name;
  const held = parallel(m, circ, "t.z");
  assert.doesNotThrow(() => m.dependents("t").length, "no curve stands on a frame any more");
  assert.deepEqual(m.dependents("t").map((e) => e.name), []);
  const removed = del(m, "t");
  assert.ok(removed.includes(held) && removed.includes("t"), JSON.stringify(removed));
  assert.ok(m.entities.has(circ) && m.entities.has(arc) && m.entities.has("c"), "the curves and their centre stay");
  assert.ok(close(dot(m.normalOf(circ), t.uz), 1), "facing where the frame faced");
});

test("a fillet in 3D needs no frame: its arc faces its corner, and its tangents keep it there as the corner turns", async () => {
  await loadKernel();
  const m = new Model(3);
  const t = tiltedFrame(m);
  m.addPoint(t.at(30, 0), "a"); m.addPoint(t.at(0, 0), "k"); m.addPoint(t.at(0, 30), "b");
  m.addLine("a", "k", "l1"); m.addLine("k", "b", "l2");
  // A corner standing up out of the default frame's plane: its legs span x and z.
  // It used to be refused, naming the frame; now it is rounded in its own plane.
  m.addPoint(t.at(-30, 0), "a2"); m.addPoint(t.at(-60, 0), "k2"); m.addPoint(t.at(-60, 0, 30), "b2");
  m.addLine("a2", "k2", "m1"); m.addLine("k2", "b2", "m2");
  const journal = m.journal.length;
  assert.throws(() => fillet(m, "l1", "l2", 500), /too large/);
  assert.equal(m.journal.length, journal, "a refused fillet leaves no entry — or the file would not reopen");
  const arc = fillet(m, "l1", "l2", 5);
  assert.ok(close(Math.abs(dot(m.normalOf(arc), t.uz)), 1), "the arc faces its corner's plane");
  assert.deepEqual(m.journal.at(-1), { op: "fillet", args: ["l1", "l2", 5] }, "and names no plane");
  const up = fillet(m, "m1", "m2", 5);
  assert.ok(close(Math.abs(dot(m.normalOf(up), t.uy)), 1), "the standing corner's arc faces its own plane");
  assert.equal([...m.entities.values()].filter((e) => e.kind === "frame").length, 1, "and no frame was made for either");
  assert.equal(m.solve().solved, true);
});

test("a 2D fillet's entry is the three arguments it always was, and a side is refused", () => {
  const m = new Model(2);
  m.addPoint([30, 0], "a"); m.addPoint([0, 0], "k"); m.addPoint([0, 30], "b");
  m.addLine("a", "k", "l1"); m.addLine("k", "b", "l2");
  assert.throws(() => fillet(m, "l1", "l2", 5, [0, 0, 1]), /a 2D fillet takes no side/);
  fillet(m, "l1", "l2", 5);
  assert.deepEqual(m.journal.at(-1), { op: "fillet", args: ["l1", "l2", 5] });
});

test("ls() and the hover tag say which way a circle faces", () => {
  const m = new Model(3);
  m.addPoint([0, 0, 0], "c");
  const circ = m.addCircle("c", 4, [0, 1, 0]).name;
  const s = neocadScope({ model: m }) as Record<string, (...a: unknown[]) => unknown>;
  assert.ok((s.ls() as string[]).some((l) => l.startsWith(circ) && l.includes("facing (0.000, 1.000, 0.000)")));
  assert.match(describePick(m, { name: circ, kind: "circle", distance: 0 }), new RegExp(`^${circ}  r 4  facing 0, 1, 0`));
});
