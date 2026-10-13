// A solid's faces, and the tool that makes one by a click inside a region.
//
// The faces are display, so the claims worth pinning are the ones a picture
// would show wrong: which faces are drawn (the culling), which way each one
// faces (outward, worked out from the box's own centre here, never from the
// module's arithmetic), the order (a cap after every wall of its own), the
// shade (the cosine against the line of sight, computed here), and even-odd —
// an island in a hole is material, the ring around it is not — checked with a
// point-in-polygon written in this file.

import { test } from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { ensureKernelLoaded } from "../src/kernel/problem.ts";
import { Model } from "../src/model.ts";
import { onPlane } from "../src/relations/basic.ts";
import { extrude, fillet } from "../src/operations.ts";
import { FACE_DARK, FACE_LIGHT, faceColour, facesToDraw, featureFaces, loopOutlines, type Face } from "../src/faces.ts";
import { arcSegments } from "../src/arcgeom.ts";
import { findLoops, loopAt } from "../src/loops.ts";
import { depth, orbitBy, viewAxes, worldToScreen, type View } from "../src/view.ts";
import { ExtrudeTool } from "../src/tools/extrude.ts";
import { RectangleTool } from "../src/tools/rectangle.ts";
import type { ToolContext } from "../src/tools/tool.ts";
import { axisFrame } from "./frames.ts";

async function loadKernel() {
  const bytes = await readFile(new URL("../src/kernel/wasm-gen/neocad_kernel_bg.wasm", import.meta.url));
  await ensureKernelLoaded(bytes);
}

const dot = (a: number[], b: number[]) => a.reduce((s, x, i) => s + x * b[i], 0);
const sub = (a: number[], b: number[]) => a.map((x, i) => x - b[i]);
const mean = (pts: number[][]) => [0, 1, 2].map((i) => pts.reduce((s, p) => s + p[i], 0) / pts.length);

/** A box on the kernel-aligned frame: 40 × 30, extruded `d` up +z. */
function box(d = 20, corners: number[][] = [[0, 0, 0], [40, 0, 0], [40, 30, 0], [0, 30, 0]]) {
  const m = new Model(3);
  axisFrame(m);
  const pts = corners.map((c) => m.addPoint(c).name);
  const lines = pts.map((p, i) => m.addLine(p, pts[(i + 1) % pts.length]).name);
  for (const p of pts) onPlane(m, p, "f");
  const e = extrude(m, lines[0], d);
  return { m, lines, f: m.featureOf(e, "extrude") };
}

const ABOVE: View = { ox: 400, oy: 300, scale: 4 };

/** Even-odd membership, written here: how many outlines contain the point, flat in x–y. */
function material(outlines: number[][][], p: [number, number]): boolean {
  let count = 0;
  for (const o of outlines) {
    let inside = false;
    for (let i = 0, j = o.length - 1; i < o.length; j = i++) {
      const [a, b] = [o[i], o[j]];
      if ((a[1] > p[1]) !== (b[1] > p[1]) && p[0] < ((b[0] - a[0]) * (p[1] - a[1])) / (b[1] - a[1]) + a[0]) inside = !inside;
    }
    if (inside) count++;
  }
  return count % 2 === 1;
}

// --- which faces, which way ----------------------------------------------------

test("a box: two caps and four walls, every one facing out of the box", async () => {
  await loadKernel();
  const { m, f } = box();
  const faces = featureFaces(m, f, 4);
  assert.deepEqual(faces.map((x) => x.kind), ["base", "lid", "wall", "wall", "wall", "wall"]);
  const centre = [20, 15, 10];
  for (const face of faces) {
    assert.ok(Math.abs(Math.hypot(...face.normal) - 1) < 1e-12, "unit length");
    assert.ok(dot(face.normal, sub(face.centroid, centre)) > 0, `${face.kind} faces out`);
  }
  assert.deepEqual(faces[0].normal.map((x) => x + 0), [0, 0, -1]); // + 0 turns -0 into 0
  assert.deepEqual(faces[1].normal.map((x) => x + 0), [0, 0, 1]);
});

test("seen from straight above only the lid is drawn — square on, at full shade — and the base and walls are culled", async () => {
  await loadKernel();
  const { m, f } = box();
  const drawn = facesToDraw(m, ABOVE);
  assert.equal(drawn.length, 1);
  assert.equal(drawn[0].kind, "lid");
  assert.equal(drawn[0].shade, 1);
  const lid = m.featureOf(f.name, "extrude").twins[0].map((l) => m.line(l).refs[0]);
  const want = lid.map((p) => worldToScreen(ABOVE, m.coords(p)));
  for (const p of want) assert.ok(drawn[0].outlines[0].some((q) => Math.hypot(q[0] - p[0], q[1] - p[1]) < 1e-9));
});

test("from a corner, exactly the faces turned toward the viewer, each shaded by its cosine to the line of sight, far to near", async () => {
  await loadKernel();
  const { m } = box();
  for (const [yaw, pitch] of [[0.6, 0.5], [-0.9, 0.3], [2.4, -0.7], [0.2, 1.2]]) {
    const view = orbitBy(ABOVE, yaw, pitch);
    const { toward } = viewAxes(view);
    // The box's six outward normals, written down rather than computed.
    const all: Record<string, number[]> = { base: [0, 0, -1], lid: [0, 0, 1], s: [0, -1, 0], e: [1, 0, 0], n: [0, 1, 0], w: [-1, 0, 0] };
    const facing = Object.values(all).filter((n) => dot(n, toward) > 1e-9).map((n) => dot(n, toward)).sort();
    const drawn = facesToDraw(m, view);
    assert.deepEqual(drawn.map((d) => d.shade).sort(), facing.map((s) => Math.min(1, s)), `${yaw}, ${pitch}`);
    for (let i = 1; i < drawn.length; i++) assert.ok(drawn[i].depth >= drawn[i - 1].depth, "far to near");
  }
});

test("a negative depth puts the lid below: its cap faces −z and the profile's faces +z", async () => {
  await loadKernel();
  const { m, f } = box(-15);
  const [base, lid] = featureFaces(m, f, 4);
  assert.deepEqual(base.normal.map((x) => x + 0), [0, 0, 1]);
  assert.deepEqual(lid.normal.map((x) => x + 0), [0, 0, -1]);
  for (const face of featureFaces(m, f, 4)) assert.ok(dot(face.normal, sub(face.centroid, [20, 15, -7.5])) > 0, face.kind);
});

test("a profile drawn clockwise still faces out — the winding is read, not assumed", async () => {
  await loadKernel();
  const { m, f } = box(20, [[0, 0, 0], [0, 30, 0], [40, 30, 0], [40, 0, 0]]);
  for (const face of featureFaces(m, f, 4)) assert.ok(dot(face.normal, sub(face.centroid, [20, 15, 10])) > 0, face.kind);
});

test("a curved wall is a strip of quads at the curve's drawing resolution, each facing out", async () => {
  await loadKernel();
  const m = new Model(3);
  axisFrame(m);
  const pts = [[0, 0, 0], [40, 0, 0], [40, 30, 0], [0, 30, 0]].map((c) => m.addPoint(c).name);
  const lines = pts.map((p, i) => m.addLine(p, pts[(i + 1) % 4]).name);
  const arc = fillet(m, lines[0], lines[1], 8);
  const f = m.featureOf(extrude(m, lines[0], 20), "extrude");
  const scale = 4;
  const walls = featureFaces(m, f, scale).filter((x) => x.kind === "wall");
  const n = arcSegments(Math.PI / 2, 8 * scale);
  assert.equal(walls.length, 4 + n, "four flat walls and the arc's strip");
  const centre = m.coords(m.arc(arc).center);
  // Each piece of the strip faces away from the fillet's centre: out of the solid.
  const strip = walls.filter((w) => Math.abs(Math.hypot(...sub(w.centroid, centre).slice(0, 2)) - 8 * Math.cos(Math.PI / 4 / n)) < 1e-6);
  assert.equal(strip.length, n);
  for (const w of strip) assert.ok(dot(w.normal, sub(w.centroid, centre)) > 0);
});

test("a hole's walls face into the hole, an island's out of it — and even-odd makes the island material and the ring around it empty", async () => {
  await loadKernel();
  const m = new Model(3);
  axisFrame(m);
  const pts = [[0, 0, 0], [60, 0, 0], [60, 50, 0], [0, 50, 0]].map((c) => m.addPoint(c).name);
  const lines = pts.map((p, i) => m.addLine(p, pts[(i + 1) % 4]).name);
  const c = m.addPoint([30, 25, 0]).name;
  const hole = m.addCircle(c, 15, "f").name;
  const island = m.addCircle(c, 5, "f").name;
  const f = m.featureOf(extrude(m, lines[0], 20), "extrude");
  assert.deepEqual(f.loops, [lines, [hole], [island]]);

  const scale = 3;
  const faces = featureFaces(m, f, scale);
  const lid = faces.find((x) => x.kind === "lid")!;
  assert.equal(lid.outlines.length, 3);
  const flat = lid.outlines;
  assert.equal(material(flat, [5, 5]), true, "between the outline and the hole: material");
  assert.equal(material(flat, [30 + 10, 25]), false, "in the ring between the hole and the island: empty");
  assert.equal(material(flat, [30 + 2, 25]), true, "on the island: material, for nothing but the rule");

  const centre = [30, 25];
  const radial = (w: Face) => Math.hypot(w.centroid[0] - centre[0], w.centroid[1] - centre[1]);
  const walls = faces.filter((x) => x.kind === "wall");
  const holeWalls = walls.filter((w) => Math.abs(radial(w) - 15) < 0.5);
  const islandWalls = walls.filter((w) => Math.abs(radial(w) - 5) < 0.5);
  assert.equal(holeWalls.length, arcSegments(2 * Math.PI, 15 * scale));
  assert.equal(islandWalls.length, arcSegments(2 * Math.PI, 5 * scale));
  const out = (w: Face) => dot(w.normal.slice(0, 2), sub(w.centroid.slice(0, 2), centre));
  for (const w of holeWalls) assert.ok(out(w) < 0, "a hole's wall faces into the hole");
  for (const w of islandWalls) assert.ok(out(w) > 0, "an island's wall faces out into the ring");

  // Seen from above: the lid, and nothing in the ring — the walls are edge-on
  // and the profile's cap faces away.
  const drawn = facesToDraw(m, ABOVE);
  assert.deepEqual(drawn.map((d) => d.kind), ["lid"]);
  assert.equal(drawn[0].outlines.length, 3);
});

test("a cap is drawn after every wall of its own — a grazing view where its centroid is behind its hole's far wall does not paint the wall over it", async () => {
  await loadKernel();
  // A hole near one end of a long, deep solid: from a grazing angle the far
  // wall of the hole is nearer than the lid's middle.
  const m = new Model(3);
  axisFrame(m);
  const pts = [[0, 0, 0], [120, 0, 0], [120, 30, 0], [0, 30, 0]].map((c) => m.addPoint(c).name);
  const lines = pts.map((p, i) => m.addLine(p, pts[(i + 1) % 4]).name);
  m.addCircle(m.addPoint([105, 15, 0]).name, 10, "f");
  const f = m.featureOf(extrude(m, lines[0], 40), "extrude");
  let centroidWouldFail = false;
  for (const [yaw, pitch] of [[1.2, 0.2], [-1.3, 0.25], [1.45, 0.1], [0.4, 0.3]]) {
    const view = orbitBy(ABOVE, yaw, pitch);
    const drawn = facesToDraw(m, view);
    const capAt = drawn.findIndex((d) => d.kind !== "wall");
    assert.ok(capAt >= 0, "a cap is in view");
    assert.equal(capAt, drawn.length - 1, `${yaw}, ${pitch}: the cap is the last face drawn`);
    const cap = featureFaces(m, f, view.scale).find((x) => x.kind === drawn[capAt].kind)!;
    const walls = featureFaces(m, f, view.scale).filter((x) => x.kind === "wall" && dot(x.normal, viewAxes(view).toward) > 1e-9);
    if (walls.some((w) => depth(view, w.centroid) > depth(view, cap.centroid))) centroidWouldFail = true;
  }
  assert.ok(centroidWouldFail, "and at least one of these views is one a centroid sort gets wrong");
});

test("a solid that cannot be laid out costs its own faces and nothing else — the render loop never throws", async () => {
  await loadKernel();
  const { m } = box();
  const other = m.addPoint([100, 0, 0]).name; // nothing to do with the solid
  assert.ok(other);
  // Collapse the sketch frame: its +z is gone.
  m.setCoords("f_x", m.coords("f_o"));
  m.setCoords("f_y", m.coords("f_o"));
  assert.deepEqual(facesToDraw(m, orbitBy(ABOVE, 0.5, 0.5)), []);
});

test("the shade runs from a quarter of the way up the surface tones to the top, and nothing outside", () => {
  const rgb = (s: string) => s.match(/\d+/g)!.map(Number);
  assert.deepEqual(rgb(faceColour(1)), FACE_LIGHT);
  assert.deepEqual(rgb(faceColour(0)), FACE_DARK.map((d, i) => Math.round(d + (FACE_LIGHT[i] - d) * 0.25)));
  assert.deepEqual(rgb(faceColour(7)), FACE_LIGHT);
  for (let s = 0; s < 1; s += 0.1) assert.ok(rgb(faceColour(s))[0] <= rgb(faceColour(s + 0.1))[0]);
});

test("loopOutlines walks a loop closed whatever direction its members run", async () => {
  await loadKernel();
  const { m, lines } = box();
  const [o] = loopOutlines(m, [[lines[0], lines[2], lines[1], lines[3]].sort()], 4);
  assert.equal(o.length, 4);
  assert.ok(Math.abs(Math.abs(o.reduce((s, p, i) => {
    const q = o[(i + 1) % o.length];
    return s + p[0] * q[1] - p[1] * q[0];
  }, 0) / 2) - 1200) < 1e-9, "the rectangle's own area, so the corners were visited in order");
});

// --- the tool ----------------------------------------------------------------------

function toolCtx(model: Model, view: View, options: Record<string, unknown> = {}, log?: string[]) {
  const c = {
    model, options, solves: 0, renders: 0, finished: false,
    requestRender() { c.renders++; },
    requestSolve() { c.solves++; model.solve(); },
    finish() { c.finished = true; },
    regionAt: ([sx, sy]: [number, number]) => {
      const loops = findLoops(model);
      const loop = loopAt(model, view, sx, sy, loops);
      return loop ? { loops, index: loops.indexOf(loop) } : null;
    },
    ...(log ? { log: (line: string) => { log.push(line); } } : {}),
  };
  return c as ToolContext & typeof c;
}

/** An outline with a hole and an island, flat on the kernel-aligned frame. */
function ringed(): { m: Model; lines: string[]; hole: string; island: string } {
  const m = new Model(3);
  axisFrame(m);
  const pts = [[0, 0, 0], [60, 0, 0], [60, 50, 0], [0, 50, 0]].map((c) => m.addPoint(c).name);
  const lines = pts.map((p, i) => m.addLine(p, pts[(i + 1) % 4]).name);
  const c = m.addPoint([30, 25, 0]).name;
  return { m, lines, hole: m.addCircle(c, 15, "f").name, island: m.addCircle(c, 5, "f").name };
}

test("the extrude tool: hovering inside outlines the region, a click there extrudes it with its holes, and the journal says what a typed call would", async () => {
  await loadKernel();
  const { m, lines, hole, island } = ringed();
  const ctx = toolCtx(m, ABOVE, { depth: 12 });
  const tool = new ExtrudeTool(ctx);
  const at = (x: number, y: number) => worldToScreen(ABOVE, [x, y, 0]);

  tool.onMove({ world: [5, 5, 0], screen: at(5, 5) });
  assert.equal(ctx.renders, 1, "the region appeared");
  tool.onMove({ world: [6, 5, 0], screen: at(6, 5) });
  assert.equal(ctx.renders, 1, "and the same region again asks for nothing");

  tool.onDown({ world: [5, 5, 0], screen: at(5, 5) });
  assert.equal(ctx.finished, true);
  assert.equal(ctx.solves, 1);
  const f = m.featureOf("e1", "extrude");
  assert.deepEqual(f.loops, [lines, [hole], [island]], "between the outline and the hole: the outline, with its hole and the hole's island");
  assert.deepEqual(m.journal.at(-1), { op: "extrude", args: [lines[0], 12, "f", [lines, [hole], [island]]] });
});

test("a click on the island takes the island; a click in the ring takes the hole's loop, the island its hole", async () => {
  await loadKernel();
  for (const [x, want] of [[31, "island"], [40, "hole"]] as const) {
    const r = ringed();
    const ctx = toolCtx(r.m, ABOVE);
    new ExtrudeTool(ctx).onDown({ world: [x, 25, 0], screen: worldToScreen(ABOVE, [x, 25, 0]) });
    const f = r.m.featureOf("e1", "extrude");
    assert.deepEqual(f.loops, want === "island" ? [[r.island]] : [[r.hole], [r.island]]);
    assert.equal(r.m.relationOf(f.depth).args[1], 10, "no depth armed: the default");
  }
});

test("a click on no region is refused out loud and the tool stays armed — and headless it throws", async () => {
  await loadKernel();
  const { m } = ringed();
  const lines: string[] = [];
  const ctx = toolCtx(m, ABOVE, {}, lines);
  const tool = new ExtrudeTool(ctx);
  const outside = worldToScreen(ABOVE, [80, 80, 0]);
  tool.onDown({ world: [80, 80, 0], screen: outside });
  assert.match(lines[0], /^extrude: no closed region under the click/);
  assert.equal(ctx.finished, false);
  assert.equal(m.features.size, 0);
  assert.throws(() => new ExtrudeTool(toolCtx(m, ABOVE)).onDown({ world: [80, 80, 0], screen: outside }), /no closed region/);
});

test("the extrude tool asks the engine for no snap; the tools that place points still do", async () => {
  await loadKernel();
  const m = new Model(3);
  assert.equal(new ExtrudeTool(toolCtx(m, ABOVE)).snaps, false);
  assert.equal(new RectangleTool(toolCtx(m, ABOVE)).snaps, true);
});

test("its preview fills the region even-odd and strokes it", async () => {
  await loadKernel();
  const { m } = ringed();
  const ctx = toolCtx(m, ABOVE);
  const tool = new ExtrudeTool(ctx);
  tool.onMove({ world: [5, 5, 0], screen: worldToScreen(ABOVE, [5, 5, 0]) });
  const calls: string[] = [];
  const g = new Proxy({}, {
    get: (_t, k) => (k === "fillStyle" || k === "strokeStyle" || k === "lineWidth" ? undefined : (...a: unknown[]) => { calls.push(`${String(k)}(${a.filter((x) => typeof x === "string").join(",")})`); }),
    set: () => true,
  }) as unknown as CanvasRenderingContext2D;
  tool.render({ g, worldToScreen: (w) => worldToScreen(ABOVE, w), scale: ABOVE.scale });
  assert.ok(calls.includes("fill(evenodd)"));
  assert.equal(calls.filter((c) => c === "closePath()").length, 3, "the outline, the hole and the island");
  assert.ok(calls.includes("stroke()"));
});
