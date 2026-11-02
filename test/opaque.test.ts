// A solid is opaque (docs/plans/opaque-solids.md). The owner: "when you
// extrude a solid, it should look like a solid" / "It should be opaque".
//
// So in a shaded view what is behind a visible face is neither drawn nor aimed
// at — and the drawing, the pick, the snapper, box select and the glyphs all
// ask one module the one question (occlusion.ts's `inSight`), with one
// `Occlusion` a frame. These are the pure halves of that: occlusion for a
// point, a label's anchor and a frame's origin; `hitTest`, `findSnap` and
// `selectInBox` skipping a point behind a box while keeping one on its near
// face's edge; the glyphs; and the three view modes' rules. Which points are
// behind is decided here by the box's geometry, written down — the corner all
// three of whose faces are turned away from a camera written down — never by
// asking the module under test.

import { test } from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { ensureKernelLoaded } from "../src/kernel/problem.ts";
import { Model } from "../src/model.ts";
import { dist, onPlane } from "../src/relations/basic.ts";
import { extrude } from "../src/operations.ts";
import { visibleFaces } from "../src/faces.ts";
import { inSight, occlusion, visibleRuns, type Occlusion } from "../src/occlusion.ts";
import { hitTest } from "../src/picking.ts";
import { findSnap } from "../src/snapping.ts";
import { boxFrom, selectInBox } from "../src/boxselect.ts";
import { placeGlyphs } from "../src/glyphs.ts";
import { frameBasis } from "../src/relations/refs.ts";
import { worldToScreen, type View } from "../src/view.ts";
import {
  DEFAULT_VIEW_MODE, VIEW_MODES, VIEW_MODE_KEY, drawsFaces, isViewMode, opaque, recallViewMode, rememberViewMode, viewModeError,
} from "../src/viewmode.ts";
import { axisFrame } from "./frames.ts";

async function loadKernel() {
  const bytes = await readFile(new URL("../src/kernel/wasm-gen/neocad_kernel_bg.wasm", import.meta.url));
  await ensureKernelLoaded(bytes);
}

const unit = (v: number[]) => { const l = Math.hypot(...v); return v.map((x) => x / l); };
const cross = (a: number[], b: number[]) => [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]];

/** The view looking along −`toward`, +z as near up as it goes: a camera written down. */
function seenFrom(toward: number[], scale = 4, ox = 400, oy = 300): View {
  const t = unit(toward);
  const right = unit(cross([0, 0, 1], t));
  return { ox, oy, scale, right, up: cross(t, right) };
}

/** From the front, the right and above: the lid, the front (−y) and the right (+x) walls face the viewer. */
const CORNER = [1, -2, 1.5];
/** The box's corner on the base, the back and the left wall — all three turned away from CORNER. */
const FAR = [0, 30, 0];
/** On the lid's front edge, where the lid and the front wall meet: on two near faces. */
const NEAR_EDGE = [20, 0, 20];

/**
 * A real box from the real extrude, 40 × 30 × 20, and two loose points: one at
 * the far corner's place (a point of its own, so the box's corner `p4` and it
 * are the same question twice) and one on the lid's front edge.
 */
async function box() {
  await loadKernel();
  const m = new Model(3);
  axisFrame(m);
  const pts = [[0, 0, 0], [40, 0, 0], [40, 30, 0], [0, 30, 0]].map((c) => m.addPoint(c).name);
  const lines = pts.map((p, i) => m.addLine(p, pts[(i + 1) % pts.length]).name);
  for (const p of pts) onPlane(m, p, "f");
  extrude(m, lines[0], 20);
  const far = pts[3];
  assert.deepEqual(m.coords(far), FAR);
  const near = m.addPoint(NEAR_EDGE).name;
  const view = seenFrom(CORNER);
  const occ = occlusion(visibleFaces(m, view), view);
  return { m, view, occ, far, near, lines };
}

test("occlusion, for a point, a label's anchor and a frame's origin: behind the box is out of sight, on its near faces and above it is not — and nothing is hidden with no occlusion to ask", async () => {
  const { m, occ } = await box();
  // A point: one sample.
  assert.equal(inSight(occ, FAR), false, "the far corner");
  assert.equal(inSight(occ, NEAR_EDGE), true, "a point on the lid's front edge");
  assert.equal(inSight(occ, [20, 15, 10]), false, "the box's middle");
  // A label's anchor: a dimension between two points inside the box is
  // labelled at its middle, inside the box; one between two points on the
  // lid at its middle, on the lid.
  assert.equal(inSight(occ, [20, 15, 5]), false, "the anchor of a label inside the box");
  assert.equal(inSight(occ, [20, 5, 20]), true, "the anchor of a label on the lid");
  // A frame's origin: under the base, seen from above through the box; and
  // hanging over the lid.
  m.addFrame(m.addPoint([20, 15, -10]).name, m.addPoint([21, 15, -10]).name, m.addPoint([20, 16, -10]).name, "under");
  m.addFrame(m.addPoint([20, 15, 30]).name, m.addPoint([21, 15, 30]).name, m.addPoint([20, 16, 30]).name, "over");
  assert.equal(inSight(occ, frameBasis(m, "under")().origin), false, "a frame under the box");
  assert.equal(inSight(occ, frameBasis(m, "over")().origin), true, "a frame over it");
  // No occlusion is "nothing hides anything": a plain sketch, or the hidden
  // and wire modes.
  assert.equal(inSight(null, FAR), true);
});

test("hitTest: shaded, a click on the far corner does not pick it, a click on the near edge's point does — and with nothing hiding, both pick as they always did", async () => {
  const { m, view, occ, far, near } = await box();
  const [fx, fy] = worldToScreen(view, FAR);
  assert.equal(hitTest(m, view, fx, fy)?.name, far, "no occlusion: the far corner picks");
  const shaded = hitTest(m, view, fx, fy, occ);
  assert.notEqual(shaded?.name, far, "shaded: it is behind the box");
  // Nothing else is near enough to that pixel to pick either: every edge
  // meeting there is behind the box too, and the lid's corner above it is
  // further than a pick radius.
  assert.equal(shaded, null, "and nothing hidden under it picks in its place");
  const [nx, ny] = worldToScreen(view, NEAR_EDGE);
  assert.equal(hitTest(m, view, nx, ny, occ)?.name, near, "the near edge's point: on the surface, so in sight");
  assert.equal(hitTest(m, view, nx, ny)?.name, near);
});

test("hitTest: an edge picks where its nearest place is in sight, and not along its hidden part", async () => {
  const { m, view, occ, lines } = await box();
  // The base's back edge, (40, 30, 0)–(0, 30, 0), runs behind the box; the
  // front edge, (0, 0, 0)–(40, 0, 0), is on the silhouette.
  const back = lines[2];
  const front = lines[0];
  const [bx, by] = worldToScreen(view, [20, 30, 0]);
  assert.equal(hitTest(m, view, bx, by)?.name, back, "no occlusion: the back edge picks along its middle");
  assert.notEqual(hitTest(m, view, bx, by, occ)?.name, back, "shaded: its middle is behind the box");
  const [qx, qy] = worldToScreen(view, [20, 0, 0]);
  // The front edge is the profile's, and its twin and walls are elsewhere: a
  // pixel on it is the edge itself.
  assert.equal(hitTest(m, view, qx, qy + 2, occ)?.name, front, "the front edge, on the silhouette, picks");
});

test("hitTest: a frame under the box does not pick by its arm when shaded; one over it does", async () => {
  const { m, view, occ } = await box();
  m.addFrame(m.addPoint([20, 15, -10]).name, m.addPoint([21, 15, -10]).name, m.addPoint([20, 16, -10]).name, "under");
  m.addFrame(m.addPoint([20, 15, 30]).name, m.addPoint([21, 15, 30]).name, m.addPoint([20, 16, 30]).name, "over");
  // Two-thirds of the way out along each frame's +x arm, clear of its origin point.
  const armAt = (o: number[]) => worldToScreen(view, [o[0] + (0.66 * 36) / view.scale, o[1], o[2]]);
  const [ux, uy] = armAt([20, 15, -10]);
  assert.equal(hitTest(m, view, ux, uy)?.name, "under", "no occlusion: the frame under the box picks");
  assert.notEqual(hitTest(m, view, ux, uy, occ)?.name, "under", "shaded: it does not");
  const [ox, oy] = armAt([20, 15, 30]);
  assert.equal(hitTest(m, view, ox, oy, occ)?.name, "over", "the frame over the box picks shaded too");
});

test("findSnap: shaded, nothing behind the box is offered — not the far corner, not its projection — while the point on the near edge is", async () => {
  const { m, view, occ, far, near } = await box();
  const [fx, fy] = worldToScreen(view, FAR);
  const plain = findSnap(m, view, fx, fy);
  assert.equal(plain?.kind, "point");
  assert.equal(plain?.targets[0], far, "no occlusion: the far corner snaps");
  const shaded = findSnap(m, view, fx, fy, null, occ);
  assert.ok(!shaded || !shaded.targets.includes(far), `shaded: not the far corner (${shaded?.kind} ${shaded?.targets})`);
  const [nx, ny] = worldToScreen(view, NEAR_EDGE);
  const kept = findSnap(m, view, nx, ny, null, occ);
  assert.equal(kept?.kind, "point");
  assert.equal(kept?.targets[0], near, "the near edge's point snaps, shaded");
  // On a sketch plane the far corner is not on, it would be offered at its
  // projection — a vertex seen and aimed at from off the plane — but not one
  // out of sight. A plane tilted to all three axes, out in front of the box,
  // so no two of the box's corners share a foot on it.
  const n = unit([1, 1, 1]);
  const o = [-30, -30, -30];
  const off = { origin: o, u: unit([1, -1, 0]), v: unit([1, 1, -2]) };
  const along = FAR.reduce((s, c, i) => s + (c - o[i]) * n[i], 0);
  const foot = FAR.map((c, i) => c - along * n[i]);
  const [px, py] = worldToScreen(view, foot);
  const projected = findSnap(m, view, px, py, off);
  assert.equal(projected?.kind, "projected", "no occlusion: the far corner is offered at its projection");
  assert.equal(projected?.targets[0], far);
  const hiddenProjection = findSnap(m, view, px, py, off, occ);
  assert.ok(!hiddenProjection || !hiddenProjection.targets.includes(far), "shaded: a hidden vertex is not projected");
});

test("selectInBox: shaded, a box round the far corner does not take it, nor the edges running behind; a box round the near point does — both ways round", async () => {
  const { m, view, occ, far, near, lines } = await box();
  const around = (w: number[], r = 6) => {
    const [x, y] = worldToScreen(view, w);
    return { x0: x - r, y0: y - r, x1: x + r, y1: y + r };
  };
  for (const mode of ["window", "crossing"] as const) {
    assert.ok(selectInBox(m, view, around(FAR), mode).includes(far), `${mode}, no occlusion: the far corner`);
    assert.ok(!selectInBox(m, view, around(FAR), mode, occ).includes(far), `${mode}, shaded: not the far corner`);
    assert.ok(selectInBox(m, view, around(NEAR_EDGE), mode, occ).includes(near), `${mode}, shaded: the near edge's point`);
  }
  // A crossing box over the middle of the base's back edge touches it on
  // screen — but there it is behind the box.
  const back = lines[2];
  assert.ok(selectInBox(m, view, around([20, 30, 0], 3), "crossing").includes(back), "no occlusion: the back edge");
  assert.ok(!selectInBox(m, view, around([20, 30, 0], 3), "crossing", occ).includes(back), "shaded: not the back edge");
  // A window round the whole drawing contains everything; shaded, it takes
  // only what has some part in sight.
  const all = boxFrom(0, 0, 800, 600).rect;
  const seen = selectInBox(m, view, all, "window", occ);
  assert.ok(seen.includes(lines[0]), "the front edge, on the silhouette");
  assert.ok(!seen.includes(far), "and still not the far corner");
  assert.ok(selectInBox(m, view, all, "window").includes(far));
});

test("visibleRuns: a line all behind the box is no run at all, one in front of it is itself — and with no occlusion, every line is itself", async () => {
  const { view, occ } = await box();
  assert.deepEqual(visibleRuns(occ, view, [[5, 25, 2], [35, 25, 2]]), [], "inside the box, under the lid");
  const before = [[0, -10, 0], [40, -10, 0]];
  assert.deepEqual(visibleRuns(occ, view, before), [before.map((w) => worldToScreen(view, w))], "in front of the box");
  assert.deepEqual(visibleRuns(null, view, [[5, 25, 2], [35, 25, 2]]), [[[5, 25, 2], [35, 25, 2]].map((w) => worldToScreen(view, w))]);
});

test("placeGlyphs: shaded, a dimension labelled inside the box is not placed — so not drawn or clicked — and one on the lid is", async () => {
  const { m, view, occ } = await box();
  const [a, b] = [m.addPoint([10, 15, 5]).name, m.addPoint([30, 15, 5]).name];
  const inside = dist(m, a, b, 20);
  const [c, d] = [m.addPoint([5, 5, 20]).name, m.addPoint([35, 5, 20]).name];
  const onLid = dist(m, c, d, 30);
  const placed = (o: Occlusion | null) => new Set(placeGlyphs(m, view, o).map((g) => g.relation));
  assert.ok(placed(null).has(inside) && placed(null).has(onLid), "no occlusion: both labels");
  assert.ok(!placed(occ).has(inside), "shaded: not the one inside the box");
  assert.ok(placed(occ).has(onLid), "shaded: the one on the lid");
});

// --- the three modes ----------------------------------------------------------

test("the three modes' rules: shaded draws faces and hides behind them; hidden draws faces and hides nothing; wire draws none", () => {
  assert.deepEqual([...VIEW_MODES], ["shaded", "hidden", "wire"]);
  assert.equal(DEFAULT_VIEW_MODE, "shaded", "opaque by default — the owner's ask");
  assert.deepEqual(VIEW_MODES.map((m) => [m, drawsFaces(m), opaque(m)]), [
    ["shaded", true, true],
    ["hidden", true, false],
    ["wire", false, false],
  ]);
  for (const m of VIEW_MODES) assert.ok(isViewMode(m));
  for (const x of ["Shaded", "solid", "", null, undefined, 3]) assert.equal(isViewMode(x), false, String(x));
  assert.match(viewModeError("glass").message, /"shaded", "hidden", "wire"/, "the refusal names the three");
});

test("a mode is remembered in storage under its own key, and anything unreadable there is the default", () => {
  const store = new Map<string, string>();
  const storage = { getItem: (k: string) => store.get(k) ?? null, setItem: (k: string, v: string) => { store.set(k, v); } };
  assert.equal(recallViewMode(storage), "shaded", "nothing stored: the default");
  assert.equal(rememberViewMode(storage, "wire"), true);
  assert.deepEqual([...store], [[VIEW_MODE_KEY, "wire"]], "one key, the mode's name");
  assert.equal(recallViewMode(storage), "wire");
  store.set(VIEW_MODE_KEY, "glass");
  assert.equal(recallViewMode(storage), "shaded", "a value it does not know: the default");
  assert.equal(recallViewMode(null), "shaded", "no storage at all");
  assert.equal(rememberViewMode(null, "hidden"), false);
  const throwing = { getItem: () => { throw new Error("denied"); }, setItem: () => { throw new Error("full"); } };
  assert.equal(recallViewMode(throwing), "shaded", "a storage that throws on read");
  assert.equal(rememberViewMode(throwing, "hidden"), false, "or on write");
});
