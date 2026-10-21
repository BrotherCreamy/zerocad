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
import { extrude, fillet, revolve } from "../src/operations.ts";
import { FACE_DARK, FACE_LIGHT, faceColour, facesToDraw, featureFaces, loopOutlines, orderedFaces, type Face } from "../src/faces.ts";
import { arcSegments } from "../src/arcgeom.ts";
import { findLoops, loopAt } from "../src/loops.ts";
import { hitTest } from "../src/picking.ts";
import { FRAME_ARM_PX } from "../src/framemarker.ts";
import { depth, orbitBy, viewAxes, worldToScreen, type View } from "../src/view.ts";
import { ExtrudeTool } from "../src/tools/extrude.ts";
import { RevolveTool } from "../src/tools/revolve.ts";
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

/** A rectangle with a line across it, flat on the kernel-aligned frame: two regions (loops.ts). */
function split(): { m: Model; lines: string[]; across: string } {
  const m = new Model(3);
  axisFrame(m);
  const pts = [[0, 0, 0], [40, 0, 0], [40, 30, 0], [0, 30, 0]].map((c) => m.addPoint(c).name);
  const lines = pts.map((p, i) => m.addLine(p, pts[(i + 1) % 4]).name);
  return { m, lines, across: m.addLine(m.addPoint([15, -10, 0]).name, m.addPoint([15, 40, 0]).name).name };
}

/** Two crossing circles, r = 10 and 12 apart: two crescents and a lens. */
function lens(): Model {
  const m = new Model(3);
  axisFrame(m);
  m.addCircle(m.addPoint([20, 15, 0]).name, 10, "f");
  m.addCircle(m.addPoint([32, 15, 0]).name, 10, "f");
  return m;
}

const shoelace = (o: number[][]) => Math.abs(o.reduce((s, p, i) => {
  const q = o[(i + 1) % o.length];
  return s + p[0] * q[1] - p[1] * q[0];
}, 0) / 2);

test("loopOutlines draws a part of an entity as that part: half a split rectangle stops at the crossing, a crescent at the lens", () => {
  const { m } = split();
  const loops = findLoops(m);
  const key = (p: number[]) => p.map((x) => Math.round(x * 1e9) / 1e9 + 0).join(",");
  const [left] = loopOutlines(m, [loops[0].members], 4);
  assert.deepEqual(left.map(key).sort(), ["0,0,0", "0,30,0", "15,0,0", "15,30,0"], "four corners, two of them crossings — not the whole bottom and top edges");
  assert.ok(Math.abs(shoelace(left) - 450) < 1e-9);

  const n = lens();
  // At 4000 px a unit, so the quarter-pixel sampling is fine enough to measure an area by.
  const outlines = findLoops(n).map((l) => loopOutlines(n, [l.members], 4000)[0]);
  const from = (p: number[], c: number[]) => Math.hypot(p[0] - c[0], p[1] - c[1]);
  const [inC1, outC1, inC2, outC2] = [(p: number[]) => from(p, [20, 15]) <= 10 + 1e-9, (p: number[]) => from(p, [20, 15]) >= 10 - 1e-9,
    (p: number[]) => from(p, [32, 15]) <= 10 + 1e-9, (p: number[]) => from(p, [32, 15]) >= 10 - 1e-9];
  assert.ok(outlines[0].every((p) => inC1(p) && outC2(p)), "the left crescent: in c1, out of c2");
  assert.ok(outlines[1].every((p) => inC1(p) && inC2(p)), "the lens: in both");
  assert.ok(outlines[2].every((p) => outC1(p) && inC2(p)), "the right crescent: in c2, out of c1");
  const lensArea = 200 * Math.acos(0.6) - 6 * 16;
  assert.ok(Math.abs(shoelace(outlines[1]) - lensArea) < 1e-2, `sampled as drawn: ${shoelace(outlines[1])} against ${lensArea}`);
});

function toolCtx(model: Model, view: View, options: Record<string, unknown> = {}, log?: string[]) {
  const c = {
    model, options, solves: 0, renders: 0, finished: false,
    requestRender() { c.renders++; },
    requestSolve() { c.solves++; model.solve(); },
    finish() { c.finished = true; },
    regionAt: ([sx, sy]: [number, number]) => {
      const loops = findLoops(model);
      const loop = loopAt(model, view, sx, sy, loops);
      return loop ? { loops, index: loops.indexOf(loop), toward: viewAxes(view).toward } : null;
    },
    // The engine's own answer, as the revolve tool's second click asks it.
    pick: ([sx, sy]: [number, number]) => hitTest(model, view, sx, sy),
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

test("on a split region the extrude tool outlines the half under the cursor, and a click there is refused by name, the tool still armed", async () => {
  await loadKernel();
  const { m, lines } = split();
  const log: string[] = [];
  const ctx = toolCtx(m, ABOVE, {}, log);
  const tool = new ExtrudeTool(ctx);
  const at = (x: number, y: number) => worldToScreen(ABOVE, [x, y, 0]);
  tool.onMove({ world: [5, 15, 0], screen: at(5, 15) });
  tool.onMove({ world: [6, 15, 0], screen: at(6, 15) });
  assert.equal(ctx.renders, 1, "one region, asked about twice");
  tool.onMove({ world: [30, 15, 0], screen: at(30, 15) });
  assert.equal(ctx.renders, 2, "across the line is another region");
  // What the preview draws: the right half's corners and nothing of the left.
  const drawn: number[][] = [];
  const g = new Proxy({}, {
    get: (_t, k) => (typeof k === "string" && /Style|lineWidth/.test(k) ? undefined
      : (...a: unknown[]) => { if (k === "moveTo" || k === "lineTo") drawn.push(a as number[]); }),
    set: () => true,
  }) as unknown as CanvasRenderingContext2D;
  tool.render({ g, worldToScreen: (w) => worldToScreen(ABOVE, w), scale: ABOVE.scale });
  const corners = [[15, 0], [40, 0], [40, 30], [15, 30]].map(([x, y]) => at(x, y).map((c) => Math.round(c)).join(","));
  assert.deepEqual(drawn.map((p) => p.map((c) => Math.round(c)).join(",")).sort(), corners.sort());

  const journal = m.journal.length;
  tool.onDown({ world: [30, 15, 0], screen: at(30, 15) });
  assert.match(log.at(-1)!, new RegExp(`^extrude: this region is bounded by part of ${lines[0]} \\(from .*\\) — extruding split regions is not built yet`));
  assert.equal(ctx.finished, false);
  assert.equal(m.features.size, 0);
  assert.equal(m.journal.length, journal, "nothing half-built");
});

test("hovering from a crescent to the lens to the other crescent redraws each time: three regions of parts of the same two circles", async () => {
  await loadKernel();
  const m = lens();
  const ctx = toolCtx(m, ABOVE);
  const tool = new ExtrudeTool(ctx);
  for (const x of [12, 26, 40]) tool.onMove({ world: [x, 15, 0], screen: worldToScreen(ABOVE, [x, 15, 0]) });
  assert.equal(ctx.renders, 3);
});

test("the revolve tool on a split region, the line that splits it the axis: refused by name, the half still chosen", async () => {
  await loadKernel();
  const { m, lines, across } = split();
  const log: string[] = [];
  const ctx = toolCtx(m, ABOVE, {}, log);
  const tool = new RevolveTool(ctx);
  const at = (x: number, y: number) => worldToScreen(ABOVE, [x, y, 0]);
  tool.onDown({ world: [30, 15, 0], screen: at(30, 15) });
  assert.equal(ctx.pick([...at(15, 36)] as [number, number])?.name, across, "the click below lands on the line");
  tool.onDown({ world: [15, 36, 0], screen: at(15, 36) });
  assert.match(log.at(-1)!, new RegExp(`^revolve: this region is bounded by part of ${lines[0]} \\(from .*\\) — revolving split regions is not built yet`));
  assert.equal(ctx.finished, false);
  assert.equal(m.features.size, 0);
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

// --- a revolve's faces ------------------------------------------------------------------
//
// The same claims, for a surface no entity is: which way every quad faces
// (worked out here from the solid's own shape — away from the axis on the
// outside, toward it on the inside, along it at the ends), that each quad's
// claimed normal is its own plane's, the caps (only when partial), the number
// of steps (from the swept radius), and a torus sorting sanely at an angle.

/** A block 10 to 30 out from the kernel-aligned frame's +y — the kernel's y — and 20 tall, revolved about it. */
function turnedBlock(angle?: number, corners: number[][] = [[10, 0, 0], [30, 0, 0], [30, 20, 0], [10, 20, 0]]) {
  const m = new Model(3);
  axisFrame(m);
  const pts = corners.map((c) => m.addPoint(c).name);
  const lines = pts.map((p, i) => m.addLine(p, pts[(i + 1) % pts.length]).name);
  for (const p of pts) onPlane(m, p, "f");
  const f = m.featureOf(revolve(m, lines[0], "f.y", angle), "revolve");
  return { m, lines, f };
}

/** How far a point is from the kernel's y axis. */
const radial = (p: number[]) => Math.hypot(p[0], p[2]);
const near = (a: number[], b: number[], tol: number) => Math.hypot(...sub(a, b)) <= tol;
const cross = (a: number[], b: number[]) => [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]];
const unit = (v: number[]) => v.map((c) => c / Math.hypot(...v));

/** A quad's own normal, from its diagonals — whichever way round. */
const planeOf = (q: number[][]) => unit(cross(sub(q[2], q[0]), sub(q[3], q[1])));

/** A washer's wall, by where its centroid is: the top, the bottom, the outside or the inside. */
function washerWall(w: Face): "top" | "bottom" | "outer" | "inner" {
  if (Math.abs(w.centroid[1] - 20) < 1e-9) return "top";
  if (Math.abs(w.centroid[1]) < 1e-9) return "bottom";
  return radial(w.centroid) > 20 ? "outer" : "inner";
}

/** That wall's outward direction at its centroid, written down from the shape. */
function washerOut(w: Face): number[] {
  const c = w.centroid;
  const out = [c[0] / radial(c), 0, c[2] / radial(c)];
  switch (washerWall(w)) {
    case "top": return [0, 1, 0];
    case "bottom": return [0, -1, 0];
    case "outer": return out;
    case "inner": return out.map((x) => -x);
  }
}

test("a block turned a whole turn is a washer: rings of quads, no caps, every quad facing out of it along its own plane's normal", async () => {
  await loadKernel();
  const { m, f } = turnedBlock();
  const scale = 4;
  const faces = featureFaces(m, f, scale);
  const steps = arcSegments(2 * Math.PI, 30 * scale);
  assert.equal(faces.length, 4 * steps, "four members, one ring each, no caps");
  assert.ok(faces.every((x) => x.kind === "wall"));
  const kinds = new Map<string, number>();
  for (const w of faces) {
    kinds.set(washerWall(w), (kinds.get(washerWall(w)) ?? 0) + 1);
    assert.ok(Math.abs(Math.hypot(...w.normal) - 1) < 1e-12, "unit length");
    assert.ok(near(w.normal, washerOut(w), 1e-9), `${washerWall(w)} faces out: ${w.normal}`);
    assert.ok(Math.abs(Math.abs(dot(w.normal, planeOf(w.outlines[0]))) - 1) < 1e-9, "square to its own quad");
  }
  assert.deepEqual([...kinds.values()], [steps, steps, steps, steps]);
});

test("turned a quarter: the start cap faces back against the sweep, the end cap on along it — and the last ring of every wall is the end face's twins", async () => {
  await loadKernel();
  // About +y, a quarter turn carries +x to −z: the material leaves the profile
  // (in z = 0, at x > 0) toward −z, so the start cap faces +z; the end face
  // lies in x = 0 at z < 0 and faces −x.
  const { m, f } = turnedBlock(Math.PI / 2);
  const faces = featureFaces(m, f, 4);
  const [base, end] = [faces.find((x) => x.kind === "base")!, faces.find((x) => x.kind === "end")!];
  assert.ok(near(base.normal, [0, 0, 1], 1e-12));
  assert.ok(near(end.normal, [-1, 0, 0], 1e-12));
  assert.equal(faces.filter((x) => x.kind !== "wall").length, 2);
  for (const w of faces.filter((x) => x.kind === "wall")) assert.ok(near(w.normal, washerOut(w), 1e-9), washerWall(w));
  const twins = f.twins[0].flatMap((l) => m.line(l).refs).map((p) => m.coords(p));
  for (const p of end.outlines[0]) assert.ok(twins.some((q) => near(p, q, 0)), "the end cap is the twins, exactly");
  const lastRing = faces.filter((x) => x.kind === "wall").flatMap((w) => w.outlines[0]).filter((p) => Math.abs(p[0]) < 1e-9 && p[2] < 0);
  for (const p of lastRing) assert.ok(twins.some((q) => near(p, q, 0)), "the walls meet the end face on its own points");
});

test("seen from above, the quarter turn shows its start cap square-on, drawn last, and the bore it looks down into — and not its end cap", async () => {
  await loadKernel();
  const { m } = turnedBlock(Math.PI / 2);
  const drawn = facesToDraw(m, ABOVE);
  assert.equal(drawn.at(-1)!.kind, "base");
  assert.equal(drawn.at(-1)!.shade, 1);
  assert.ok(!drawn.some((d) => d.kind === "end"), "the end cap faces −x, edge-on to this view");
  for (let i = 1; i < drawn.length; i++) assert.ok(drawn[i].depth >= drawn[i - 1].depth, "far to near");
});

test("steps are sized from the swept radius: more when zoomed in, fewer for a profile near the axis", async () => {
  await loadKernel();
  const { m, f } = turnedBlock();
  assert.equal(featureFaces(m, f, 16).length, 4 * arcSegments(2 * Math.PI, 30 * 16));
  assert.ok(arcSegments(2 * Math.PI, 30 * 16) > arcSegments(2 * Math.PI, 30 * 4));
  const near1 = turnedBlock(undefined, [[1, 0, 0], [3, 0, 0], [3, 2, 0], [1, 2, 0]]);
  assert.equal(featureFaces(near1.m, near1.f, 4).length, 4 * arcSegments(2 * Math.PI, 3 * 4));
});

test("a semicircle on its diameter turns into a sphere: every quad faces away from the centre, and the diameter on the axis sweeps nothing", async () => {
  await loadKernel();
  const m = new Model(3);
  axisFrame(m);
  const [lo, hi, c] = [m.addPoint([0, -10, 0]).name, m.addPoint([0, 10, 0]).name, m.addPoint([0, 0, 0]).name];
  const arc = m.addArc(c, lo, hi, 10, "f").name;
  const diameter = m.addLine(hi, lo).name;
  const f = m.featureOf(revolve(m, diameter, "f.y"), "revolve");
  assert.deepEqual(f.loops[0].slice().sort(), [arc, diameter].sort());
  const scale = 4;
  const faces = featureFaces(m, f, scale);
  assert.equal(faces.length, arcSegments(2 * Math.PI, 10 * scale) * arcSegments(Math.PI, 10 * scale), "the arc's pieces, one ring each");
  for (const w of faces) {
    assert.ok(dot(w.normal, w.centroid) > 0, "away from the centre");
    assert.ok(w.outlines[0].some((p) => radial(p) > 1e-9), "nothing lies along the axis");
  }
});

test("a torus at an angle: every quad faces out of its tube, and what is drawn is exactly what faces the viewer, far to near", async () => {
  await loadKernel();
  const m = new Model(3);
  axisFrame(m);
  const ring = m.addCircle(m.addPoint([25, 10, 0]).name, 8, "f").name;
  const f = m.featureOf(revolve(m, ring, "f.y"), "revolve");
  const scale = 4;
  const faces = featureFaces(m, f, scale);
  assert.equal(faces.length, arcSegments(2 * Math.PI, 33 * scale) * arcSegments(2 * Math.PI, 8 * scale));
  for (const w of faces) {
    const c = w.centroid;
    const tube = [(25 * c[0]) / radial(c), 10, (25 * c[2]) / radial(c)];
    assert.ok(dot(w.normal, sub(c, tube)) > 0, "out of the tube");
    assert.ok(Math.abs(Math.abs(dot(w.normal, planeOf(w.outlines[0]))) - 1) < 1e-6, "square to its own quad");
  }
  const view = orbitBy(ABOVE, 0.5, 0.6);
  const { toward } = viewAxes(view);
  const drawn = facesToDraw(m, view);
  assert.equal(drawn.length, faces.filter((w) => dot(w.normal, toward) > 1e-9).length);
  assert.ok(drawn.length > faces.length / 3 && drawn.length < (2 * faces.length) / 3, `about half: ${drawn.length} of ${faces.length}`);
  for (let i = 1; i < drawn.length; i++) assert.ok(drawn[i].depth >= drawn[i - 1].depth, "far to near");
});

test("a hole in the profile turns into a tunnel: its walls face into it, and both caps carry it even-odd", async () => {
  await loadKernel();
  const m = new Model(3);
  axisFrame(m);
  const pts = [[10, 0, 0], [50, 0, 0], [50, 40, 0], [10, 40, 0]].map((c) => m.addPoint(c).name);
  const lines = pts.map((p, i) => m.addLine(p, pts[(i + 1) % 4]).name);
  const hole = m.addCircle(m.addPoint([30, 20, 0]).name, 8, "f").name;
  const f = m.featureOf(revolve(m, lines[0], "f.y", 2), "revolve");
  assert.deepEqual(f.loops, [lines, [hole]]);
  const faces = featureFaces(m, f, 3);
  for (const cap of faces.filter((x) => x.kind !== "wall")) assert.equal(cap.outlines.length, 2, `${cap.kind}: the outline and the hole`);
  const tunnel = faces.filter((w) => {
    if (w.kind !== "wall") return false;
    const c = w.centroid;
    return Math.hypot(radial(c) - 30, c[1] - 20) < 8.5;
  });
  assert.ok(tunnel.length > 0);
  for (const w of tunnel) {
    const c = w.centroid;
    const core = [(30 * c[0]) / radial(c), 20, (30 * c[2]) / radial(c)];
    assert.ok(dot(w.normal, sub(c, core)) < 0, "into the tunnel");
  }
});

/**
 * How many sampled pixels have a face painted over one that is nearer there,
 * for faces in draw order — where a cap is one of the two. The true depth at a
 * pixel is read off each face's own plane (screen-linear over a triangle of its
 * outline); samples are each face's middle and points toward its corners.
 */
function capsPaintedWrong(view: View, faces: { kind: string; outlines: number[][][] }[]): number {
  const scr = faces.map((f) => f.outlines.map((o) => o.map((w) => worldToScreen(view, w))));
  const covers = (i: number, p: number[]) => scr[i].reduce((n, o) => n + (material([o.map(([x, y]) => [x, y, 0])], [p[0], p[1]]) ? 1 : 0), 0) % 2 === 1;
  const depthAt = (i: number, p: number[]) => {
    const o = faces[i].outlines[0], s = scr[i][0];
    for (let k = 1; k + 1 < o.length; k++) {
      const [a, b, c] = [s[0], s[k], s[k + 1]];
      const det = (b[0] - a[0]) * (c[1] - a[1]) - (c[0] - a[0]) * (b[1] - a[1]);
      if (Math.abs(det) < 1) continue; // a sliver gives no depth worth trusting
      const u = ((p[0] - a[0]) * (c[1] - a[1]) - (c[0] - a[0]) * (p[1] - a[1])) / det;
      const v = ((b[0] - a[0]) * (p[1] - a[1]) - (p[0] - a[0]) * (b[1] - a[1])) / det;
      const d = [o[0], o[k], o[k + 1]].map((w) => depth(view, w));
      return d[0] + u * (d[1] - d[0]) + v * (d[2] - d[0]);
    }
    return NaN;
  };
  let wrong = 0;
  for (let i = 0; i < faces.length; i++) {
    const o = scr[i][0];
    const mid = [o.reduce((s, p) => s + p[0], 0) / o.length, o.reduce((s, p) => s + p[1], 0) / o.length];
    for (const p of [mid, ...o.map((q) => [mid[0] * 0.6 + q[0] * 0.4, mid[1] * 0.6 + q[1] * 0.4])]) {
      if (!covers(i, p)) continue;
      const di = depthAt(i, p);
      for (let j = i + 1; j < faces.length; j++) {
        if (faces[i].kind === "wall" && faces[j].kind === "wall") continue;
        if (!covers(j, p)) continue;
        if (depthAt(j, p) < di - 1e-6 * Math.max(1, Math.abs(di))) wrong++;
      }
    }
  }
  return wrong;
}

test("a revolve past 300° wraps round in front of its own start cap — the cap goes before those walls, where its nearest point alone painted it over them", async () => {
  await loadKernel();
  const m = new Model(3);
  axisFrame(m);
  const pts = [[10, -15, 0], [40, -15, 0], [40, 15, 0], [10, 15, 0]].map((c) => m.addPoint(c).name);
  const lines = pts.map((p, i) => m.addLine(p, pts[(i + 1) % 4]).name);
  m.addCircle(m.addPoint([25, 0, 0]).name, 6, "f");
  revolve(m, lines[0], "f.y", 5.6); // 321°
  let nearestWouldFail = false;
  for (const [yaw, pitch] of [[0, -0.7], [0.26, -0.7], [5.5, 0.7], [1.05, -0.3]]) {
    const view = orbitBy({ ox: 400, oy: 300, scale: 3 }, yaw, pitch);
    const ordered = orderedFaces(m, view);
    assert.equal(capsPaintedWrong(view, ordered), 0, `${yaw}, ${pitch}`);
    // The same faces with every cap keyed by its nearest point, as an extrude's are.
    const nearest = ordered
      .map((f) => ({ ...f, depth: f.kind === "wall" ? f.depth : Math.max(...f.outlines.flat().map((w) => depth(view, w))) }))
      .sort((a, b) => a.depth - b.depth);
    if (capsPaintedWrong(view, nearest) > 0) nearestWouldFail = true;
  }
  assert.ok(nearestWouldFail, "and at least one of these views is one the nearest-point key alone gets wrong");
});

// --- the revolve tool -------------------------------------------------------------------

/** The kernel-aligned frame's +y arm, a little way out: where a hand clicks it in the top view. */
const yArm = (): [number, number] => {
  const [ox, oy] = worldToScreen(ABOVE, [0, 0, 0]);
  return [ox, oy - FRAME_ARM_PX * 0.6];
};

test("the revolve tool: a click inside a region, then on a frame's +y arm — revolved about f.y, and the journal says what a typed call would", async () => {
  await loadKernel();
  const m = new Model(3);
  axisFrame(m);
  const pts = [[10, 0, 0], [30, 0, 0], [30, 20, 0], [10, 20, 0]].map((c) => m.addPoint(c).name);
  const lines = pts.map((p, i) => m.addLine(p, pts[(i + 1) % 4]).name);
  const ctx = toolCtx(m, ABOVE, { angle: 1.5 });
  const tool = new RevolveTool(ctx);
  const inside = worldToScreen(ABOVE, [20, 10, 0]);
  assert.equal(tool.snaps, false);

  tool.onMove({ world: [20, 10, 0], screen: inside });
  assert.equal(ctx.renders, 1, "the region appeared");
  tool.onDown({ world: [20, 10, 0], screen: inside });
  assert.equal(ctx.finished, false, "one click is half the gesture");
  assert.equal(m.features.size, 0);
  assert.deepEqual(hitTest(m, ABOVE, ...yArm()), { name: "f", kind: "frame", distance: 0, axis: "y" });
  tool.onDown({ world: [0, 0, 0], screen: yArm() });
  assert.equal(ctx.finished, true);
  assert.equal(ctx.solves, 1);
  assert.deepEqual(m.journal.at(-1), { op: "revolve", args: [lines[0], "f.y", 1.5, "f", [lines]] });
});

test("the second click: nothing there is refused aloud, another region is taken instead, an axis revolve refuses is logged and the profile kept — then a line does it", async () => {
  await loadKernel();
  const m = new Model(3);
  axisFrame(m);
  const block = [[10, 0, 0], [30, 0, 0], [30, 20, 0], [10, 20, 0]].map((c) => m.addPoint(c).name);
  const lines = block.map((p, i) => m.addLine(p, block[(i + 1) % 4]).name);
  const other = [[10, 40, 0], [30, 40, 0], [30, 60, 0], [10, 60, 0]].map((c) => m.addPoint(c).name);
  const others = other.map((p, i) => m.addLine(p, other[(i + 1) % 4]).name);
  // Seen from above it runs straight through the block; it climbs out of the
  // block's plane, so it is no axis for it — and, being in no plane of the
  // block's, cuts no region of it (a line in the plane would: loops.ts).
  const across = m.addLine(m.addPoint([20, -10, 0]).name, m.addPoint([20, 30, 30]).name).name;
  const beside = m.addLine(m.addPoint([-5, -10, 0]).name, m.addPoint([-5, 70, 0]).name).name;
  const log: string[] = [];
  const ctx = toolCtx(m, ABOVE, {}, log);
  const tool = new RevolveTool(ctx);
  const at = (x: number, y: number) => worldToScreen(ABOVE, [x, y, 0]);

  tool.onDown({ world: [80, 80, 0], screen: at(80, 80) });
  assert.match(log.at(-1)!, /^revolve: no closed region under the click/);
  tool.onDown({ world: [15, 5, 0], screen: at(15, 5) });
  tool.onDown({ world: [80, 80, 0], screen: at(80, 80) });
  assert.match(log.at(-1)!, /^revolve: no line or frame axis under the click/);
  // Inside the other block: that is the profile now — and back inside the
  // first, that again. Neither is a refusal.
  tool.onDown({ world: [15, 50, 0], screen: at(15, 50) });
  tool.onDown({ world: [15, 5, 0], screen: at(15, 5) });
  assert.equal(log.length, 2, "re-choosing a region is not a refusal");
  // That line as the axis: refused, and the block stays chosen.
  tool.onDown({ world: [20, 25, 0], screen: at(20, 25) });
  assert.match(log.at(-1)!, new RegExp(`^revolve: the axis ${across} leans 36.87° out of the plane of the profile l1,l2,l3,l4`));
  assert.equal(ctx.finished, false);
  // Hovering a line now shows it as the axis, dashed.
  tool.onMove({ world: [-5, 50, 0], screen: at(-5, 50) });
  const calls: string[] = [];
  const g = new Proxy({}, {
    get: (_t, k) => (typeof k === "string" && /Style|lineWidth/.test(k) ? undefined : (...a: unknown[]) => { calls.push(String(k)); return a; }),
    set: () => true,
  }) as unknown as CanvasRenderingContext2D;
  tool.render({ g, worldToScreen: (w) => worldToScreen(ABOVE, w), scale: ABOVE.scale });
  assert.ok(calls.includes("setLineDash"), "the axis, dashed");
  tool.onDown({ world: [-5, 50, 0], screen: at(-5, 50) });
  assert.equal(ctx.finished, true);
  const f = m.featureOf("e1", "revolve");
  assert.deepEqual([f.axis, f.loops], [beside, [lines]]);
  assert.ok(others.every((l) => !f.names.includes(l)));
});

test("a click on no region, headless, throws — the extrude tool's convention", async () => {
  await loadKernel();
  const m = new Model(3);
  axisFrame(m);
  assert.throws(() => new RevolveTool(toolCtx(m, ABOVE)).onDown({ world: [80, 80, 0], screen: worldToScreen(ABOVE, [80, 80, 0]) }),
    /no closed region/);
});
