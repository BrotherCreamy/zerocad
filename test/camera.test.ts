// The orthographic camera, and everything that reads the drawing through it.
//
// The claims worth pinning are closed-form, the way the rest of this suite
// pins geometry: an orbit by θ foreshortens the drawing by exactly cos θ; the
// pivot stays on its pixel to the last bit a float has; a pixel on a plane
// seen at an angle comes back as the point on that plane; an arc or a circle
// seen obliquely is picked and snapped where it is *drawn* — the ellipse its
// plane projects to — not where a sphere's silhouette would be. And the claim
// that keeps the 2D app's whole suite meaningful: a view that has never been
// turned is the 2D transform, exactly.

import { test } from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { ensureKernelLoaded } from "../src/kernel/problem.ts";
import { Model } from "../src/model.ts";
import {
  alignView, assignView, cameraPlane, depth, orbitBy, panBy, screenToPlane, screenToWorld,
  viewAxes, worldToScreen, zoomAbout, type View,
} from "../src/view.ts";
import { arcFrame, arcNormal, arcPoint, sweepsAs } from "../src/arcgeom.ts";
import { hitTest } from "../src/picking.ts";
import { findSnap } from "../src/snapping.ts";
import { selectInBox } from "../src/boxselect.ts";
import { frameMarker, FRAME_ARM_PX } from "../src/framemarker.ts";
import { placeGlyphs } from "../src/glyphs.ts";
import { radius } from "../src/relations/geometry.ts";
import { tiltedFrame } from "./frames.ts";

async function loadKernel() {
  const bytes = await readFile(new URL("../src/kernel/wasm-gen/neocad_kernel_bg.wasm", import.meta.url));
  await ensureKernelLoaded(bytes);
}

const v = (): View => ({ ox: 400, oy: 300, scale: 3 });
const close = (a: number, b: number, tol = 1e-9) => Math.abs(a - b) <= tol;
const near = (a: number[], b: number[], tol = 1e-9) => a.length === b.length && a.every((x, i) => close(x, b[i], tol));
const dot = (a: number[], b: number[]) => a.reduce((s, x, i) => s + x * b[i], 0);

// --- the camera --------------------------------------------------------------

test("a view that has never been turned is the 2D transform, bit for bit, and ignores depth", () => {
  const view = v();
  for (const [x, y] of [[0, 0], [10, -25], [-3.5, 7.25], [1e6, -1e-6], [0.1, 0.2]]) {
    const old: [number, number] = [view.ox + x * view.scale, view.oy - y * view.scale];
    assert.deepEqual(worldToScreen(view, [x, y]), old, "a 2D point");
    assert.deepEqual(worldToScreen(view, [x, y, 123.4]), old, "and a 3D one, seen from straight above");
  }
  assert.deepEqual(viewAxes(view).toward, [0, 0, 1], "looking down −z");
  // The 2D inverse is the old formula too.
  assert.deepEqual(screenToWorld(view, 700, 150), [(700 - 400) / 3, (300 - 150) / 3]);
});

test("orbiting by a yaw foreshortens the drawing by exactly cos(yaw), about the target", () => {
  const yaw = 0.6;
  const view = orbitBy(v(), yaw, 0);
  const o = worldToScreen(view, [0, 0, 0]);
  assert.deepEqual(o, [400, 300], "the target — the origin, by default — has not moved on screen");
  const x = worldToScreen(view, [10, 0, 0]);
  assert.ok(close(x[0] - 400, 30 * Math.cos(yaw)) && close(x[1], 300), `x foreshortened: ${x}`);
  const y = worldToScreen(view, [0, 10, 0]);
  assert.ok(close(y[1] - 300, -30) && close(y[0], 400), `y untouched by a yaw: ${y}`);
  // The near side (+z, toward where the viewer was) swings to the right.
  const z = worldToScreen(view, [0, 0, 10]);
  assert.ok(close(z[0] - 400, 30 * Math.sin(yaw)), `+z swings right: ${z}`);
  assert.ok(depth(view, [0, 0, 10]) > depth(view, [0, 0, -10]), "and is still the nearer");
});

test("a pitch foreshortens y by cos(pitch) and carries the near side down", () => {
  const pitch = 0.45;
  const view = orbitBy(v(), 0, pitch);
  const y = worldToScreen(view, [0, 10, 0]);
  assert.ok(close(y[1] - 300, -30 * Math.cos(pitch)) && close(y[0], 400), `y: ${y}`);
  const z = worldToScreen(view, [0, 0, 10]);
  assert.ok(close(z[1] - 300, 30 * Math.sin(pitch)), `+z swings down: ${z}`);
});

test("an orbit keeps a target that is not the origin on its pixel, and a thousand of them stay orthonormal", () => {
  let view: View = { ...v(), target: [12, -7, 4] };
  const pinned = worldToScreen(view, [12, -7, 4]);
  for (let i = 0; i < 1000; i++) view = orbitBy(view, 0.013 * Math.sin(i), 0.011 * Math.cos(i * 0.7));
  const still = worldToScreen(view, [12, -7, 4]);
  assert.ok(near(still, pinned, 1e-8), `the pivot drifted from ${pinned} to ${still}`);
  const { right, up } = viewAxes(view);
  assert.ok(close(dot(right, right), 1, 1e-12) && close(dot(up, up), 1, 1e-12) && close(dot(right, up), 0, 1e-12),
    "the camera's axes are still a right-handed orthonormal pair");
});

test("panning and zooming carry the target along on its pixel; turning back restores the view", () => {
  let view: View = v();
  view = panBy(view, 37, -12);
  view = zoomAbout(view, 610, 90, 1.7);
  // The target started on (400, 300) and is screen-anchored: it is still there.
  assert.ok(near(worldToScreen(view, view.target!), [400, 300], 1e-9), "the pivot stayed under its pixel");
  // So an orbit now is about whatever is in the middle of the window.
  const mid = view.target!;
  const turned = orbitBy(view, 0.3, -0.2);
  assert.ok(near(worldToScreen(turned, mid), [400, 300], 1e-9));
});

test("a pixel on a plane seen at an angle comes back as the point on that plane", () => {
  const view = orbitBy(orbitBy(v(), 0.7, 0), 0, -0.5);
  const plane = { origin: [3, 4, 5], u: [0.6, 0.8, 0], v: [0, 0, 1] };
  for (const [a, b] of [[0, 0], [10, -4], [-7.5, 22]]) {
    const w = plane.origin.map((o, i) => o + a * plane.u[i] + b * plane.v[i]);
    const [sx, sy] = worldToScreen(view, w);
    const back = screenToPlane(view, sx, sy, plane)!;
    assert.ok(near(back, w, 1e-9), `${w} -> ${[sx, sy]} -> ${back}`);
  }
});

test("a plane seen exactly edge-on has no crossing, and the camera plane always has one", () => {
  const view = v(); // looking down −z
  assert.equal(screenToPlane(view, 100, 100, { origin: [0, 0, 0], u: [1, 0, 0], v: [0, 0, 1] }), null);
  const cam = cameraPlane(orbitBy(view, 1.1, 0.4));
  assert.notEqual(screenToPlane(orbitBy(view, 1.1, 0.4), 100, 100, cam), null);
});

test("aligning to a tilted frame puts its +x right and +y up, with its origin held on screen", () => {
  const view = v();
  const ux = [0.6, 0, -0.8], uy = [0, 1, 0];
  const pivot = [5, 6, 7];
  const before = worldToScreen(view, pivot);
  const looked = alignView(view, ux, uy, pivot);
  assert.ok(near(worldToScreen(looked, pivot), before, 1e-9), "the frame's origin kept its pixel");
  const along = (u: number[]) => {
    const [a, b] = [worldToScreen(looked, pivot), worldToScreen(looked, pivot.map((p, i) => p + u[i]))];
    return [(b[0] - a[0]) / 3, (b[1] - a[1]) / 3];
  };
  assert.ok(near(along(ux), [1, 0], 1e-12) && near(along(uy), [0, -1], 1e-12), "x right, y up, full length");
  assert.deepEqual(looked.target, pivot, "and it is what the next orbit turns about");
});

test("assignView copies the orientation in place, so the engine and the REPL share one camera", () => {
  const held = v();
  assignView(held, orbitBy(held, 0.5, 0.2));
  assert.ok(held.right && held.up && held.target, "the turned view's axes and target arrived");
  const untouched = v();
  assignView(untouched, panBy(untouched, 0, 0));
  assert.equal(untouched.right, undefined, "and a view nobody turned still has no orientation");
});

test("the 2D inverse in a turned view is where the pixel's ray meets z = 0", () => {
  const view = orbitBy(v(), 0.4, -0.3);
  const w = [17, -9];
  const [sx, sy] = worldToScreen(view, w);
  assert.ok(near(screenToWorld(view, sx, sy), w, 1e-9));
});

// --- which way round an arc goes ----------------------------------------------

const UP = [0, 0, 1];

test("a 2D arc turns about +z, exactly as main.ts always drew it", () => {
  assert.deepEqual(arcNormal([0, 0], [10, 0], [0, 10], UP), [0, 0, 1]);
  assert.deepEqual(arcNormal([0, 0], [0, 10], [10, 0], UP), [0, 0, 1], "the side, not the order");
  const f = arcFrame([0, 0], [10, 0], [0, 10], 10, UP)!;
  assert.ok(close(f.sweep, Math.PI / 2), "a quarter turn counter-clockwise");
  const g = arcFrame([0, 0], [0, 10], [10, 0], 10, UP)!;
  assert.ok(close(g.sweep, (3 * Math.PI) / 2), "and the other way round is the reflex arc");
  // A semicircle has no plane of its own; it takes the one with +z.
  assert.deepEqual(arcNormal([0, 0], [10, 0], [-10, 0], UP), [0, 0, 1]);
});

test("in 3D the normal is the plane's, on its frame's +z side — never the kernel's", () => {
  // The x–z plane, turned about by a frame whose +z is −y: the side is the
  // frame's, whichever way round the kernel would have had it.
  const n = arcNormal([0, 0, 0], [0, 0, 5], [5, 0, 0], [0, -1, 0])!;
  assert.deepEqual(n.map((x) => x + 0), [0, -1, 0]);
  // A plane tipped past the vertical: the kernel's rule flipped it to its
  // upper side, so it drew as its complement. About its frame it does not.
  const t = 2.5;
  const side = [0, -Math.sin(t), Math.cos(t)]; // the plane's normal, below the horizon
  const tipped = arcNormal([0, 0, 0], [1, 0, 0], [0, Math.cos(t), Math.sin(t)], side)!;
  assert.ok(close(dot(tipped, side), 1), `about the frame's +z, which points down here: ${tipped}`);
  const f = arcFrame([0, 0, 0], [1, 0, 0], [0, Math.cos(t), Math.sin(t)], 1, side)!;
  assert.ok(close(f.sweep, Math.PI / 2), "and it is the quarter, as drawn — not the three quarters");
  // A half-turn takes the plane through its diameter nearest the frame's.
  const half = arcNormal([0, 0, 0], [5, 0, 0], [-5, 0, 0], [0, Math.SQRT1_2, Math.SQRT1_2])!;
  assert.ok(close(half[0], 0) && close(half[1], Math.SQRT1_2) && close(half[2], Math.SQRT1_2), `${half}`);
});

test("an arc's frame puts every point on its circle, in its plane, start to end", () => {
  const c = [1, 2, 3], s = [1 + 4, 2, 3], e = [1, 2, 3 + 4];
  const f = arcFrame(c, s, e, 4, [0, -1, 0])!;
  for (let k = 0; k <= 8; k++) {
    const p = arcPoint(f, (f.sweep * k) / 8);
    assert.ok(close(Math.hypot(...p.map((x, i) => x - c[i])), 4), "on the circle");
    assert.ok(close(dot(p.map((x, i) => x - c[i]), f.normal), 0), "in the plane");
  }
  assert.ok(near(arcPoint(f, 0), s) && near(arcPoint(f, f.sweep), e), "from start to end");
});

test("sweepsAs says whether a tool's counter-clockwise is the drawn one", () => {
  // Counter-clockwise from (10,0) to (0,10) seen from +z is the quarter arc; seen
  // from −z it is the other one, so a tool looking from below must swap.
  assert.equal(sweepsAs([0, 0, 0], [10, 0, 0], [0, 10, 0], [0, 0, 1], UP), true);
  assert.equal(sweepsAs([0, 0, 0], [10, 0, 0], [0, 10, 0], [0, 0, -1], UP), false);
  // And against a plane whose +z is −z, the other way about.
  assert.equal(sweepsAs([0, 0, 0], [10, 0, 0], [0, 10, 0], [0, 0, 1], [0, 0, -1]), false);
});

// --- the drawing through the camera -------------------------------------------

/** A turned view looking at a tilted frame obliquely, and a model with one arc on that frame. */
function obliqueArcScene() {
  const model = new Model(3);
  const f = tiltedFrame(model);
  model.addPoint(f.at(0, 0), "c");
  model.addPoint(f.at(20, 0), "s");
  model.addPoint(f.at(0, 20), "e");
  model.addArc("c", "s", "e", 20, null, "a1");
  // Square to the frame, then turned a radian away: its plane foreshortened
  // to cos(1) along +x, so the drawn arc is a good deal of ellipse.
  const view: View = orbitBy(alignView({ ox: 400, oy: 300, scale: 4 }, f.ux, f.uy, f.origin), 1, 0);
  return { model, f, view };
}

test("an arc seen obliquely is picked on its ellipse, not on its sphere's silhouette", () => {
  const { model, f, view } = obliqueArcScene();
  // The point of the arc the view foreshortens most — where the drawn ellipse
  // and the silhouette circle are furthest apart.
  const c = worldToScreen(view, f.at(0, 0));
  // Clear of both ends, which are points and would win the pick outright.
  const onArc = Array.from({ length: 61 }, (_, k) => (k + 15) * Math.PI / 180)
    .map((t) => worldToScreen(view, f.at(20 * Math.cos(t), 20 * Math.sin(t))));
  const drawn = onArc.reduce((best, p) =>
    Math.hypot(p[0] - c[0], p[1] - c[1]) < Math.hypot(best[0] - c[0], best[1] - c[1]) ? p : best);
  assert.equal(hitTest(model, view, ...drawn)?.name, "a1", "on the drawn curve, it picks");
  // Where the silhouette circle would put it, in the same direction from the
  // centre — well outside the ellipse.
  const d = [drawn[0] - c[0], drawn[1] - c[1]];
  const len = Math.hypot(d[0], d[1]);
  const silR = 20 * view.scale;
  const sil: [number, number] = [c[0] + (d[0] / len) * silR, c[1] + (d[1] / len) * silR];
  assert.ok(silR - len > 15, `the ellipse is well inside the silhouette here (${len}px vs ${silR}px)`);
  assert.equal(hitTest(model, view, ...sil), null, "on the silhouette, where nothing is drawn, nothing");
});

test("a snap along an oblique arc lifts to a point of the arc — on its circle and its plane", () => {
  const { model, f, view } = obliqueArcScene();
  const on = worldToScreen(view, f.at(20 * Math.cos(0.9), 20 * Math.sin(0.9)));
  const snap = findSnap(model, view, on[0] + 2, on[1] - 1)!;
  assert.equal(snap.kind, "curve");
  assert.equal(snap.targets[0], "a1");
  const rel = snap.world.map((x, i) => x - f.origin[i]);
  assert.ok(close(Math.hypot(...rel), 20, 1e-6), `radius ${Math.hypot(...rel)}`);
  assert.ok(close(dot(rel, f.uz), 0, 1e-9), "and in the arc's plane — not wherever the pixel's ray hit");
});

test("a point snap is the point itself, however deep it is", () => {
  const model = new Model(3);
  model.addPoint([10, -4, 37], "deep");
  const view = orbitBy(v(), 0.8, 0.3);
  const [sx, sy] = worldToScreen(view, [10, -4, 37]);
  assert.deepEqual(findSnap(model, view, sx + 3, sy)!.world, [10, -4, 37]);
});

test("two lines that cross on screen but not in space are no crossing to snap to", async () => {
  await loadKernel();
  const model = new Model(3);
  // One line in z = 0, one in z = 30, crossing in plan.
  for (const [n, w] of [["a", [-20, 0, 0]], ["b", [20, 0, 0]], ["c", [0, -20, 30]], ["d", [0, 20, 30]]] as const) {
    model.addPoint([...w], n);
  }
  model.addLine("a", "b", "l1");
  model.addLine("c", "d", "l2");
  const top = v();
  const [sx, sy] = worldToScreen(top, [0, 0, 0]);
  const snap = findSnap(model, top, sx + 2, sy + 2);
  assert.notEqual(snap?.kind, "intersection", "seen from above they cross; in space they are 30 apart");
  // Brought into one plane, the same pixel *is* a crossing, and lifts onto both.
  model.setCoords("c", [0, -20, 0]);
  model.setCoords("d", [0, 20, 0]);
  const real = findSnap(model, orbitBy(top, 0.4, -0.3), ...worldToScreen(orbitBy(top, 0.4, -0.3), [0, 0, 0]))!;
  assert.equal(real.kind, "intersection");
  assert.ok(near(real.world, [0, 0, 0], 1e-9), `the crossing is at ${real.world}`);
});

test("drawing on a sketch plane, a vertex seen through it is no place to snap to", () => {
  // Looking square-on at a wall (the x–z plane at y = 40) with a floor corner
  // seventy units behind the very pixel aimed at, and one on the wall itself
  // a hair further from the cursor.
  const model = new Model(3);
  model.addPoint([40, -30, 0], "behind");
  model.addPoint([40.5, 40, 0], "onWall");
  const view = alignView(v(), [1, 0, 0], [0, 0, 1], [0, 40, 0]);
  const wall = { origin: [0, 40, 0], u: [1, 0, 0], v: [0, 0, 1] };
  const [sx, sy] = worldToScreen(view, [40, 40, 0]);
  assert.equal(findSnap(model, view, sx, sy)?.targets[0], "behind", "with no sketch, the nearest pixel wins, as ever");
  assert.equal(findSnap(model, view, sx, sy, wall)?.targets[0], "onWall", "on the sketch, only the sketch's own");
  // An edge running away through the wall: square-on it is a line along the
  // wall's foot, but only one pixel of it is *on* the wall.
  model.addPoint([10, -30, 0], "far");
  model.addPoint([70, 70, 0], "near");
  model.addLine("far", "near", "l1");
  const [ex, ey] = worldToScreen(view, [25, 40, 0]); // where the edge is at y = −5
  assert.equal(findSnap(model, view, ex, ey)?.targets[0], "l1", "with no sketch, it is a curve to snap along");
  assert.equal(findSnap(model, view, ex, ey, wall), null, "on the sketch, that pixel of it is not on the wall");
});

test("a box catches an oblique arc by what is drawn", () => {
  const { model, f, view } = obliqueArcScene();
  const pts = Array.from({ length: 33 }, (_, k) => worldToScreen(view, f.at(20 * Math.cos((k / 32) * Math.PI / 2), 20 * Math.sin((k / 32) * Math.PI / 2))));
  const xs = pts.map((p) => p[0]), ys = pts.map((p) => p[1]);
  const tight = { x0: Math.min(...xs) - 2, y0: Math.min(...ys) - 2, x1: Math.max(...xs) + 2, y1: Math.max(...ys) + 2 };
  assert.ok(selectInBox(model, view, tight, "window").includes("a1"), "a window just round the drawn arc contains it");
  const midArc = worldToScreen(view, f.at(20 * Math.SQRT1_2, 20 * Math.SQRT1_2));
  const small = { x0: midArc[0] - 3, y0: midArc[1] - 3, x1: midArc[0] + 3, y1: midArc[1] + 3 };
  assert.ok(selectInBox(model, view, small, "crossing").includes("a1"), "a crossing box on its middle touches it");
});

test("a 3D frame's marker has three arms that foreshorten, and face-on its +z is a dot", () => {
  const model = new Model(3);
  const f = tiltedFrame(model);
  const view = v();
  const m = frameMarker(model, view, f.name)!;
  const len = (tip: number[]) => Math.hypot(tip[0] - m.origin[0], tip[1] - m.origin[1]);
  // Seen from above, an arm is FRAME_ARM_PX times how much of its axis lies in x–y.
  assert.ok(close(len(m.x), FRAME_ARM_PX * Math.hypot(f.ux[0], f.ux[1])));
  assert.ok(close(len(m.y), FRAME_ARM_PX * Math.hypot(f.uy[0], f.uy[1])));
  assert.ok(close(len(m.z!), FRAME_ARM_PX * Math.hypot(f.uz[0], f.uz[1])));
  // Looked at square-on, +x and +y are full length and +z points at the viewer.
  const face = frameMarker(model, alignView(view, f.ux, f.uy, f.origin), f.name)!;
  const flen = (tip: number[]) => Math.hypot(tip[0] - face.origin[0], tip[1] - face.origin[1]);
  assert.ok(close(flen(face.x), FRAME_ARM_PX) && close(flen(face.y), FRAME_ARM_PX) && close(flen(face.z!), 0, 1e-9));
});

test("a circle's glyph sits on its planar rim, up and to the right as the viewer sees it", async () => {
  await loadKernel();
  const model = new Model(3);
  const f = tiltedFrame(model);
  model.addPoint(f.at(5, 5), "c");
  const circ = model.addCircle("c", 10).name;
  radius(model, circ, 10);
  const view = orbitBy(v(), 0.9, -0.6);
  const g = placeGlyphs(model, view).find((x) => x.op === "radius")!;
  // Read the anchor pixel back into the circle's plane: a pixel offset from the
  // projected centre is P·(a, b)·scale, where P is how the plane's +x and +y
  // land on screen (world-up), so (a, b) = P⁻¹·offset/scale.
  const centre = worldToScreen(view, f.at(5, 5));
  const { right, up } = viewAxes(view);
  const [p, q, r, s] = [dot(f.ux, right), dot(f.uy, right), dot(f.ux, up), dot(f.uy, up)];
  const [dx, dy] = [(g.anchor[0] - centre[0]) / view.scale, -(g.anchor[1] - centre[1]) / view.scale];
  const det = p * s - q * r;
  const [a, b] = [(s * dx - q * dy) / det, (p * dy - r * dx) / det];
  assert.ok(close(Math.hypot(a, b), 10, 1e-9),
    `the anchor is ${Math.hypot(a, b)} from the centre in the circle's own plane — on its rim, not a sphere's silhouette`);
  // Up and to the right of the centre on *screen*, at 45°, as in 2D — and well
  // inside where the silhouette would have put it, the plane being tilted.
  assert.ok(close(Math.atan2(dy, dx), Math.PI / 4, 1e-9), `at ${Math.atan2(dy, dx)} rad on screen`);
  assert.ok(Math.hypot(dx, dy) < 10 - 1, "foreshortened, as the drawn ellipse is");
});
