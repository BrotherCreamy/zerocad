// What of the drawing lies behind a solid's faces (src/occlusion.ts) — the
// question the app asks to dim hidden edges, and the e2e oracle asks to grade
// the depth layer's picture.
//
// The claims are the spec's: a point behind a box's near face is hidden, one on
// a far face's edge seen through the box is hidden, one on a near face's own
// edge is not, nothing is hidden with no faces, the tolerance holds at grazing
// angles where a depth measured along the ray would not, and a line crossing
// behind a box is three runs whose seams are within a sample spacing of where
// the box's outline really crosses it. "Behind" is decided here by geometry
// written in this file (which faces of a box face a direction, where a box's
// outline is), never by the module's own arithmetic.

import { test } from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { ensureKernelLoaded } from "../src/kernel/problem.ts";
import { Model } from "../src/model.ts";
import { onPlane } from "../src/relations/basic.ts";
import { extrude } from "../src/operations.ts";
import { SOLID_EDGE, faceRGB, visibleFaces } from "../src/faces.ts";
import {
  HIDDEN_GROUND, HIDDEN_KEEP, SAMPLE_PX, SLACK_PX, covers, hidden, hiddenInk, inkRuns, nearestFace, occlusion, outlineDistance,
} from "../src/occlusion.ts";
import { worldToScreen, type View } from "../src/view.ts";
import { axisFrame } from "./frames.ts";

async function loadKernel() {
  const bytes = await readFile(new URL("../src/kernel/wasm-gen/neocad_kernel_bg.wasm", import.meta.url));
  await ensureKernelLoaded(bytes);
}

const unit = (v: number[]) => { const l = Math.hypot(...v); return v.map((x) => x / l); };
const cross = (a: number[], b: number[]) => [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]];

/**
 * The view looking along −`toward` with +z as near "up" as it can be — or,
 * looking straight down, +x right and +y up: a camera written down, not orbited.
 */
function seenFrom(toward: number[], scale = 4, ox = 400, oy = 300): View {
  const t = unit(toward);
  const side = cross([0, 0, 1], t);
  const right = Math.hypot(...side) > 1e-9 ? unit(side) : [1, 0, 0];
  return { ox, oy, scale, right, up: cross(t, right) };
}

/** A real box from the real extrude, 40 × 30 × 20 on the kernel-aligned frame — its faces as the app gets them. */
function box() {
  const m = new Model(3);
  axisFrame(m);
  const pts = [[0, 0, 0], [40, 0, 0], [40, 30, 0], [0, 30, 0]].map((c) => m.addPoint(c).name);
  const lines = pts.map((p, i) => m.addLine(p, pts[(i + 1) % pts.length]).name);
  for (const p of pts) onPlane(m, p, "f");
  extrude(m, lines[0], 20);
  return m;
}

/** From the front, the right and above: the lid, the front (−y) and the right (+x) walls face the viewer. */
const CORNER = [1, -2, 1.5];

test("from a corner: a point inside the box is hidden, and so is a far face's edge seen through it — but a near face's own edges, and the silhouette, are not", async () => {
  await loadKernel();
  const m = box();
  const view = seenFrom(CORNER);
  const faces = visibleFaces(m, view);
  assert.deepEqual(faces.map((f) => f.kind).sort(), ["lid", "wall", "wall"], "the lid and two walls face the viewer");
  const occ = occlusion(faces, view);
  // Behind the near faces.
  assert.equal(hidden(occ, [20, 15, 10]), true, "the box's middle");
  // On faces turned away — the back (+y) and left (−x) walls, the base — so
  // seen through the box: the back-left upright, the back edge of the base.
  assert.equal(hidden(occ, [0, 30, 10]), true, "the far upright, both of its faces turned away");
  assert.equal(hidden(occ, [20, 30, 0]), true, "the base's back edge");
  // On the near faces' own edges: in their planes, so nothing is in front.
  assert.equal(hidden(occ, [20, 0, 20]), false, "the lid's front edge, shared by the lid and the front wall");
  assert.equal(hidden(occ, [40, 0, 10]), false, "the front-right upright, shared by two near walls");
  assert.equal(hidden(occ, [40, 15, 20]), false, "the lid's right edge");
  // A near face beside one turned away: the silhouette.
  assert.equal(hidden(occ, [20, 0, 0]), false, "the base's front edge, on the silhouette");
  assert.equal(hidden(occ, [0, 15, 20]), false, "the lid's left edge, on the silhouette");
  // In front of the box altogether, and beside it.
  assert.equal(hidden(occ, [20, -10, 10]), false, "in front of the front wall");
  assert.equal(hidden(occ, [80, 15, 10]), false, "off to one side");
  // Every corner of the box: hidden exactly when all three of its faces are turned away.
  for (const x of [0, 40]) for (const y of [0, 30]) for (const z of [0, 20]) {
    const allAway = x === 0 && y === 30 && z === 0;
    assert.equal(hidden(occ, [x, y, z]), allAway, `corner ${[x, y, z]}`);
  }
});

test("with no faces nothing is hidden: a plain sketch's polyline is one run in full ink", async () => {
  await loadKernel();
  const m = new Model(3);
  axisFrame(m);
  const view = seenFrom(CORNER);
  assert.deepEqual(visibleFaces(m, view), [], "a model with no solid has no faces");
  const occ = occlusion(visibleFaces(m, view), view);
  assert.equal(hidden(occ, [0, 0, -50]), false);
  const world = [[-10, 0, 0], [10, 5, -3], [30, -2, 8]];
  const runs = inkRuns(occ, world);
  assert.equal(runs.length, 1);
  assert.equal(runs[0].hidden, false);
  assert.deepEqual(runs[0].points, world.map((w) => worldToScreen(view, w)), "exactly the polyline's own points");
});

test("at a grazing angle a face does not hide its own boundary, nor a point a quarter-pixel behind its plane — but a pixel behind, under it, is hidden", async () => {
  await loadKernel();
  const m = box();
  // Within about a degree of edge-on to the lid, from the front.
  const g = 0.02;
  const view = seenFrom([0, -1, g]);
  const occ = occlusion(visibleFaces(m, view), view);
  const lid = occ.faces.find((f) => f.normal[2] > 0.5)!;
  assert.ok(lid.facing > 0 && lid.facing < 0.03, `the lid is seen nearly edge-on (cos ${lid.facing.toFixed(4)})`);
  for (const p of [[20, 0, 20], [20, 30, 20], [0, 15, 20], [40, 15, 20], [20, 15, 20]]) {
    assert.equal(hidden(occ, p), false, `${p}, in the lid's plane`);
  }
  // A point in the lid's middle, slightly under its plane. Seen this close to
  // edge-on, a quarter-pixel under the plane is a dozen pixels behind it along
  // the ray — a depth compared along the ray would hide it; square to the
  // plane it is within the slack, as the curves' chord error is.
  const pixel = 1 / view.scale;
  const quarter = [20, 15, 20 - 0.25 * pixel];
  const one = [20, 15, 20 - 1 * pixel];
  for (const p of [quarter, one]) assert.ok(covers(lid, ...worldToScreen(view, p)), `${p}: its pixel is on the lid`);
  const alongRay = (0.25 * pixel) / lid.facing / pixel;
  assert.ok(alongRay > 10 * SLACK_PX, `a quarter-pixel under the plane is ${alongRay.toFixed(1)} px behind it along the ray`);
  assert.equal(hidden(occ, quarter), false, "a quarter-pixel under: within the slack");
  assert.equal(hidden(occ, one), true, "a pixel under, and under the lid: hidden");
});

test("the slack is half a pixel square to the plane, at any zoom: a point just past it under a face is hidden, one just inside it is not", async () => {
  await loadKernel();
  const m = box();
  for (const scale of [0.5, 4, 300]) {
    const view = seenFrom([0, 0, 1], scale);
    const occ = occlusion(visibleFaces(m, view), view);
    const pixel = 1 / scale;
    assert.equal(hidden(occ, [20, 15, 20 - 0.9 * SLACK_PX * pixel]), false, `scale ${scale}: inside the slack`);
    assert.equal(hidden(occ, [20, 15, 20 - 1.1 * SLACK_PX * pixel]), true, `scale ${scale}: past it`);
  }
});

test("a line crossing behind a box from straight above is three runs — full, dimmed, full — each seam within a sample spacing of the box's edge", async () => {
  await loadKernel();
  const m = box();
  const view = seenFrom([0, 0, 1]);
  const occ = occlusion(visibleFaces(m, view), view);
  // Under the lid, at half its height, out past both sides.
  const [a, b] = [[-20, 15, 10], [60, 15, 10]];
  const runs = inkRuns(occ, [a, b]);
  assert.deepEqual(runs.map((r) => r.hidden), [false, true, false]);
  const [left, right] = [worldToScreen(view, [0, 15, 10])[0], worldToScreen(view, [40, 15, 10])[0]];
  const seams = [runs[0].points.at(-1)!, runs[1].points.at(-1)!];
  assert.deepEqual(runs[1].points[0], seams[0], "a run starts where the last one stopped");
  assert.deepEqual(runs[2].points[0], seams[1]);
  assert.ok(Math.abs(seams[0][0] - left) <= SAMPLE_PX, `the first seam at ${seams[0][0]}, the lid's edge at ${left}`);
  assert.ok(Math.abs(seams[1][0] - right) <= SAMPLE_PX, `the second at ${seams[1][0]}, the edge at ${right}`);
  // The runs are the line drawn, only cut: they begin and end at its own ends.
  assert.deepEqual(runs[0].points[0], worldToScreen(view, a));
  assert.deepEqual(runs[2].points.at(-1), worldToScreen(view, b));
  for (const r of runs) for (const p of r.points) assert.ok(Math.abs(p[1] - runs[0].points[0][1]) < 1e-9, "every point on the line");
});

test("the seam's slack is bounded by the sample spacing whatever the line and the view", async () => {
  await loadKernel();
  const m = box();
  // A fixed sequence, so a failure is the same failure twice.
  let s = 7;
  const rand = () => ((s = (s * 16807) % 2147483647) / 2147483647);
  let seams = 0;
  for (let k = 0; k < 40; k++) {
    const view = seenFrom([rand() * 2 - 1, rand() * 2 - 1, rand() * 2 - 1], 2 + rand() * 6);
    const occ = occlusion(visibleFaces(m, view), view);
    const a = [rand() * 100 - 30, rand() * 90 - 30, rand() * 60 - 20];
    const b = [rand() * 100 - 30, rand() * 90 - 30, rand() * 60 - 20];
    const runs = inkRuns(occ, [a, b]);
    const [sa, sb] = [worldToScreen(view, a), worldToScreen(view, b)];
    const len = Math.hypot(sb[0] - sa[0], sb[1] - sa[1]);
    for (let i = 0; i + 1 < runs.length; i++) {
      // Where along the line the seam is, and the true change found near it by
      // bisection on `hidden`: on one side of it the runs' own answers.
      const seam = runs[i].points.at(-1)!;
      const t = Math.hypot(seam[0] - sa[0], seam[1] - sa[1]) / len;
      const at = (u: number) => hidden(occ, a.map((x, c) => x + u * (b[c] - x)));
      let [lo, hi] = [Math.max(0, t - SAMPLE_PX / len), Math.min(1, t + SAMPLE_PX / len)];
      assert.equal(at(lo), runs[i].hidden, `view ${k}: a sample spacing before the seam is the run before it`);
      assert.equal(at(hi), runs[i + 1].hidden, `view ${k}: a sample spacing after is the run after`);
      for (let n = 0; n < 40; n++) { const mid = (lo + hi) / 2; if (at(mid) === runs[i].hidden) lo = mid; else hi = mid; }
      assert.ok(Math.abs(lo - t) * len <= SAMPLE_PX / 2 + 1e-6, `view ${k}: seam ${(Math.abs(lo - t) * len).toFixed(2)} px from the change`);
      seams++;
    }
  }
  assert.ok(seams > 15, `${seams} seams checked`);
});

test("a circle part under a lid: runs alternate, and one crossing the circle's start is joined back into one", async () => {
  await loadKernel();
  const m = box();
  const view = seenFrom([0, 0, 1]);
  const occ = occlusion(visibleFaces(m, view), view);
  // Round the box's middle at half its height, wide enough to leave it: its
  // start, at +x, is outside — so the first and the last samples are both in
  // full ink and are one run.
  const ring = Array.from({ length: 65 }, (_, k) => [20 + 22 * Math.cos((k * 2 * Math.PI) / 64), 15 + 22 * Math.sin((k * 2 * Math.PI) / 64), 10]);
  ring[64] = ring[0];
  const open = inkRuns(occ, ring);
  const closed = inkRuns(occ, ring, true);
  assert.equal(open[0].hidden, false);
  assert.equal(open.at(-1)!.hidden, false);
  assert.equal(closed.length, open.length - 1, "the two runs either side of the start are one");
  for (let i = 0; i < closed.length; i++) assert.notEqual(closed[i].hidden, closed[(i + 1) % closed.length].hidden, "they alternate, round");
  // 44 across, round a 40 × 30 lid: outside it at ±x and ±y, under it across
  // each of its four corners.
  assert.equal(closed.filter((r) => r.hidden).length, 4, "under the lid four times, once a corner");
  // A ring wholly under the lid is one dimmed run.
  const inner = Array.from({ length: 33 }, (_, k) => [20 + 8 * Math.cos((k * 2 * Math.PI) / 32), 15 + 8 * Math.sin((k * 2 * Math.PI) / 32), 10]);
  assert.deepEqual(inkRuns(occ, inner, true).map((r) => r.hidden), [true]);
});

test("the oracle's two questions: the face nearest the viewer at a pixel, and how far the pixel is from an outline", async () => {
  await loadKernel();
  const m = box();
  const view = seenFrom(CORNER);
  const faces = visibleFaces(m, view);
  const occ = occlusion(faces, view);
  const [x, y] = worldToScreen(view, [20, 15, 20]);
  const near = nearestFace(occ, x, y)!;
  assert.equal(faces[near.index].kind, "lid");
  const toward = unit(CORNER);
  assert.ok(Math.abs(near.depth - (20 * toward[0] + 15 * toward[1] + 20 * toward[2])) < 1e-9, "the lid's depth there");
  const [fx, fy] = worldToScreen(view, [20, 0, 10]);
  assert.equal(faces[nearestFace(occ, fx, fy)!.index].normal[1], -1, "the front wall at its own middle");
  assert.equal(nearestFace(occ, 5, 5), null, "nothing in a far corner of the screen");
  // An outline's distance: 2 px square off the middle of the lid's front
  // edge on screen, toward the lid's inside.
  const [ea, eb, inner] = [[10, 0, 20], [30, 0, 20], [20, 15, 20]].map((w) => worldToScreen(view, w));
  const along = unit([eb[0] - ea[0], eb[1] - ea[1], 0]);
  let off = [-along[1], along[0]];
  const mid = [(ea[0] + eb[0]) / 2, (ea[1] + eb[1]) / 2];
  if ((inner[0] - mid[0]) * off[0] + (inner[1] - mid[1]) * off[1] < 0) off = off.map((c) => -c);
  const [px, py] = [mid[0] + 2 * off[0], mid[1] + 2 * off[1]];
  assert.ok(Math.abs(outlineDistance(occ, px, py) - 2) < 1e-9, `${outlineDistance(occ, px, py)}`);
  assert.equal(outlineDistance(occ, 5, 5), Infinity, "beyond the reach of every face");
});

test("hidden ink keeps an edge's own hue and takes it toward the faces' shadow end: plain stays blue-grey, amber stays amber, the solid's dark edge goes lighter", () => {
  const ground = HIDDEN_GROUND;
  const parse = (css: string) => css.match(/\d+/g)!.map(Number);
  const hex = (css: string) => [1, 3, 5].map((i) => parseInt(css.slice(i, i + 2), 16));
  for (const css of ["#afc6d9", "#e8a33d", "#c9dcec", "#7b93a8", SOLID_EDGE]) {
    const rgb = hex(css);
    const dim = parse(hiddenInk(css));
    assert.deepEqual(dim, rgb.map((c, i) => Math.round(HIDDEN_KEEP * c + (1 - HIDDEN_KEEP) * ground[i])), css);
    const order = (v: number[]) => [0, 1, 2].sort((i, j) => v[j] - v[i]).join();
    assert.equal(order(dim), order(rgb), `${css}: the same channels lead, so the same hue family`);
    // Toward the faces from either side: the faces are a light body now, so a
    // light sketch ink is taken down to them and the solid's dark edge up.
    for (let i = 0; i < 3; i++) {
      assert.ok(Math.min(rgb[i], ground[i]) - 0.5 <= dim[i] && dim[i] <= Math.max(rgb[i], ground[i]) + 0.5, `${css}: channel ${i} between the edge and the faces`);
    }
  }
  assert.equal(hiddenInk("rebeccapurple"), "rebeccapurple", "a colour it cannot read is left alone");
});
