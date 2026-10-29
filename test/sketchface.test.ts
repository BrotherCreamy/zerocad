// Sketching on a face: three of a loop's own points, ordered so the plane's +z
// faces the viewer — and so, on a solid, points out of it.
//
// Every orientation here is checked by building the frame the three points
// make and reading its +z through `frameBasis`, the function every relation
// reads — not by trusting the order the helper returned. And "out of the
// solid" is checked against the solid's own centroid, independently of which
// way anything was walked: the case worth reading first is the wall, where a
// circle sketched on the plane and extruded a positive depth must stand off
// the side of the plate rather than bore into it.

import { test } from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { ensureKernelLoaded } from "../src/kernel/problem.ts";
import { Model } from "../src/model.ts";
import { onPlane } from "../src/relations/basic.ts";
import { frameBasis } from "../src/relations/refs.ts";
import { del, extrude } from "../src/operations.ts";
import { findLoops, loopAt, type Loop } from "../src/loops.ts";
import { open, save } from "../src/persist.ts";
import { neocadScope } from "../src/replenv.ts";
import { Repl } from "../src/repl.ts";
import { menuFor } from "../src/menu.ts";
import { sketchFrameFor, sketchOnFaceCommand } from "../src/sketchface.ts";
import { SketchTool } from "../src/tools/sketch.ts";
import type { ToolContext } from "../src/tools/tool.ts";
import { alignView, orbitBy, viewAxes, worldToScreen, type View } from "../src/view.ts";
import { tiltedFrame, type TiltedFrame } from "./frames.ts";
import { baseOf, polygon, ring } from "./profiles.ts";

async function loadKernel() {
  const bytes = await readFile(new URL("../src/kernel/wasm-gen/neocad_kernel_bg.wasm", import.meta.url));
  await ensureKernelLoaded(bytes);
}

const dot = (a: number[], b: number[]) => a.reduce((s, x, i) => s + x * b[i], 0);
const sub = (a: number[], b: number[]) => a.map((x, i) => x - b[i]);
const neg = (a: number[]) => a.map((x) => -x);
const near = (a: number[], b: number[], tol = 1e-9) => Math.hypot(...sub(a, b)) <= tol;
const mean = (ps: number[][]) => ps[0].map((_, i) => ps.reduce((s, p) => s + p[i], 0) / ps.length);
const cross = (a: number[], b: number[]) => [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]];
const vertices = (l: Loop) => l.members.map((m) => m.from!);

/** The +z of the frame three points would make — built, read through `frameBasis`, and taken away again. */
function zOf(m: Model, [a, b, c]: string[]): number[] {
  const f = m.addFrame(a, b, c).name;
  const { uz } = frameBasis(m, f)();
  m.deleteEntity(f);
  return uz!;
}

/** A view looking at `n`'s side of a plane through `at`: toward the viewer is +n, then turned a little off square. */
function viewFrom(n: number[], inPlane: number[], at: number[]): View {
  const up = cross(n, inPlane);
  return orbitBy(alignView({ ox: 500, oy: 400, scale: 4 }, inPlane, up, at), 0.25, -0.2);
}

// --- the helper ---------------------------------------------------------------

test("a tilted square: its first corner and the corners either side, in loop order seen from +z and swapped seen from −z — +z toward the viewer both ways, +x along an edge", async () => {
  await loadKernel();
  const m = new Model(3);
  const t = tiltedFrame(m);
  polygon(m, t, [[0, 0], [20, 0], [20, 20], [0, 20]]);
  const [loop] = findLoops(m);
  const v = vertices(loop);

  const front = sketchFrameFor(m, loop, t.uz);
  assert.deepEqual(front, [v[0], v[1], v[3]]);
  assert.ok(near(zOf(m, front), t.uz), "seen from +z, the plane's +z is the frame's");

  const back = sketchFrameFor(m, loop, neg(t.uz));
  assert.deepEqual(back, [v[0], v[3], v[1]], "the x-ref and y-ref swapped");
  assert.ok(near(zOf(m, back), neg(t.uz)), "seen from −z, the plane's +z is −z");

  // Either way round the x-ref is a neighbour of the origin, so the sketch's
  // +x runs along an edge of the face — never across its diagonal, which is
  // what would leave `lookAt` showing the face tipped.
  for (const [a, b] of [front, back]) {
    assert.ok(loop.members.some((x) => (x.from === a && x.to === b) || (x.from === b && x.to === a)), `${a}→${b} is an edge`);
  }

  // Obliquely, only the side counts: a line of sight 80° off the normal still
  // gets the plane facing it.
  const oblique = t.uz.map((z, i) => Math.cos(1.4) * z + Math.sin(1.4) * t.ux[i]);
  assert.ok(dot(zOf(m, sketchFrameFor(m, loop, oblique)), oblique) > 0);
  assert.ok(dot(zOf(m, sketchFrameFor(m, loop, neg(oblique))), neg(oblique)) > 0);
  assert.equal(sketchOnFaceCommand(m, loop, t.uz), `plane(${front.map((p) => JSON.stringify(p)).join(", ")})`);
});

test("a rectangle whose first three vertices are on one line — an edge drawn as two lines through a midpoint — skips past the middle one", async () => {
  await loadKernel();
  // loops.ts joins at shared points and coins only, so a point held on an
  // edge by `on` is no vertex at all (a T splits nothing). The honest case of
  // three collinear vertices is an edge drawn as two lines meeting at a point.
  const m = new Model(3);
  const t = tiltedFrame(m);
  const [p0, mid, p1, p2, p3] = [[0, 0], [20, 0], [40, 0], [40, 30], [0, 30]].map(([u, w]) => m.addPoint(t.at(u, w)).name);
  for (const [a, b] of [[p0, mid], [mid, p1], [p1, p2], [p2, p3], [p3, p0]]) m.addLine(a, b);
  for (const p of [p0, mid, p1, p2, p3]) onPlane(m, p, t.name);
  const loops = findLoops(m);
  assert.equal(loops.length, 1);
  assert.deepEqual(vertices(loops[0]).slice(0, 3), [p0, mid, p1], "the precondition: the first three are on one line");
  const got = sketchFrameFor(m, loops[0], t.uz);
  assert.deepEqual(got, [p0, mid, p3], "the first corner, between the half-edge and the side");
  assert.ok(near(zOf(m, got), t.uz));
});

test("a loop that starts at a point partway along an edge skips it: no corner there, so the next vertex is the origin", async () => {
  await loadKernel();
  const m = new Model(3);
  const t = tiltedFrame(m);
  const [mid, p1, p2, p3, p0] = [[20, 0], [40, 0], [40, 30], [0, 30], [0, 0]].map(([u, w]) => m.addPoint(t.at(u, w)).name);
  // The half-edge from the midpoint is made first, so the loop starts there.
  for (const [a, b] of [[mid, p1], [p1, p2], [p2, p3], [p3, p0], [p0, mid]]) m.addLine(a, b);
  for (const p of [mid, p1, p2, p3, p0]) onPlane(m, p, t.name);
  const [loop] = findLoops(m);
  assert.equal(vertices(loop)[0], mid, "the precondition: the loop starts on the straight");
  for (const toward of [t.uz, neg(t.uz)]) {
    const got = sketchFrameFor(m, loop, toward);
    assert.equal(got[0], p1, "the origin is the first real corner");
    assert.deepEqual(got.slice(1).sort(), [mid, p2].sort(), "with its two neighbours");
    assert.ok(near(zOf(m, got), toward));
  }
});

test("a whole circle: its frame's own three points, the x-ref and y-ref swapped when the frame faces away", async () => {
  await loadKernel();
  const m = new Model(3);
  const t = tiltedFrame(m);
  ring(m, t, 10, 5, 4);
  const [loop] = findLoops(m);
  assert.deepEqual(sketchFrameFor(m, loop, t.uz), ["t_o", "t_x", "t_y"]);
  assert.deepEqual(sketchFrameFor(m, loop, neg(t.uz)), ["t_o", "t_y", "t_x"]);
  assert.ok(near(zOf(m, ["t_o", "t_y", "t_x"]), neg(t.uz)), "turned over, it faces −z");
});

test("a lens of two arcs has only two vertices: an arc's centre is the third point", async () => {
  await loadKernel();
  const m = new Model(3);
  const t = tiltedFrame(m);
  const [a, b, c1, c2] = [[0, 0], [20, 0], [10, -10], [10, 10]].map(([u, w]) => m.addPoint(t.at(u, w)).name);
  // Below the chord about c1 runs counter-clockwise from b to a over the top;
  // the other bulges below, a to b about c2.
  m.addArc(c1, b, a, null, t.name);
  m.addArc(c2, a, b, null, t.name);
  const loops = findLoops(m);
  assert.equal(loops.length, 1, "one lens");
  const got = sketchFrameFor(m, loops[0], t.uz);
  assert.equal(new Set(got).size, 3);
  assert.ok(got.includes(c1) || got.includes(c2), `a centre among ${got}`);
  assert.ok(near(zOf(m, got), t.uz));
});

test("a region cut off by crossings: its crossings are no points, so the plane is made of its real corners and its edges' own ends", async () => {
  await loadKernel();
  const m = new Model(3);
  const t = tiltedFrame(m);
  const { points } = polygon(m, t, [[0, 0], [40, 0], [40, 30], [0, 30]]);
  m.addLine(m.addPoint(t.at(-10, 10)).name, m.addPoint(t.at(50, 10)).name);
  const loops = findLoops(m);
  assert.equal(loops.length, 2);
  for (const [loop, toward] of [[loops[0], t.uz], [loops[1], neg(t.uz)]] as const) {
    const got = sketchFrameFor(m, loop, toward);
    assert.ok(got.every((p) => m.entities.get(p)?.kind === "point"), `${got}: real points only`);
    assert.ok(got.every((p) => points.includes(p)), `${got}: the rectangle's own corners`);
    assert.ok(near(zOf(m, got), toward), "facing whoever looked");
  }
  // Below the line the region has two real corners and two crossings; the
  // corner test skips any corner whose neighbour is a crossing, and the
  // rectangle's other corners — ends of the edges it runs along — make the third.
  assert.equal(vertices(loops[0]).filter((v) => m.entities.has(v)).length, 2);
});

test("a lens of two crossing circles has no point at all but their centres: it takes a circle's frame, as a whole circle does", async () => {
  await loadKernel();
  const m = new Model(3);
  const t = tiltedFrame(m);
  ring(m, t, 10, 5, 10);
  ring(m, t, 22, 5, 10);
  const lens = findLoops(m).find((l) => l.area < 100)!; // the crescents are each over 200
  assert.deepEqual(sketchFrameFor(m, lens, t.uz), ["t_o", "t_x", "t_y"]);
  assert.deepEqual(sketchFrameFor(m, lens, neg(t.uz)), ["t_o", "t_y", "t_x"]);
});

test("refusals, by name: a D on a semicircle has no three points off one line; a circle off its frame's plane; a plane seen edge-on; a 2D drawing", async () => {
  await loadKernel();
  const m = new Model(3);
  const t = tiltedFrame(m);
  // A semicircle closed by its diameter: both ends and the centre on one line.
  const [c, s, e] = [[10, 0], [20, 0], [0, 0]].map(([u, w]) => m.addPoint(t.at(u, w)).name);
  const arc = m.addArc(c, s, e, null, t.name).name;
  const line = m.addLine(e, s).name;
  const [d] = findLoops(m);
  assert.deepEqual(d.members.map((x) => x.name).sort(), [arc, line].sort());
  assert.throws(() => sketchFrameFor(m, d, t.uz), new RegExp(`loop of .*${line}.* has no three points off one line`));

  // A circle lifted off its frame's plane is parallel to it, not in it.
  const n = new Model(3);
  const u = tiltedFrame(n);
  const lifted = n.addCircle(n.addPoint(u.at(5, 5, 3)).name, 2, u.name).name;
  const [ring1] = findLoops(n);
  assert.throws(() => sketchFrameFor(n, ring1, u.uz), new RegExp(`"${lifted}" lies parallel to its frame "t" but off its plane`));

  // Edge-on: neither side faces the viewer.
  const q = new Model(3);
  const w = tiltedFrame(q);
  polygon(q, w, [[0, 0], [20, 0], [20, 20], [0, 20]]);
  const [sq] = findLoops(q);
  assert.throws(() => sketchFrameFor(q, sq, w.ux), /edge-on to the view/);

  // A 2D drawing is one plane already, and a 2D frame takes no y-ref.
  const flat = new Model(2);
  const pts = [[0, 0], [10, 0], [10, 10]].map((p) => flat.addPoint(p).name);
  pts.forEach((p, i) => flat.addLine(p, pts[(i + 1) % 3]));
  const [tri] = findLoops(flat);
  assert.throws(() => sketchFrameFor(flat, tri, [0, 0, 1]), /a 2D drawing is one plane already/);
});

// --- on a solid: out of it, wherever it is clicked ---------------------------------

/** A 40 × 30 plate on the tilted frame, extruded 10 — and its centroid. */
function plate(): { m: Model; t: TiltedFrame; lines: string[]; centroid: number[] } {
  const m = new Model(3);
  const t = tiltedFrame(m);
  const { lines } = polygon(m, t, [[0, 0], [40, 0], [40, 30], [0, 30]]);
  extrude(m, lines[0], 10);
  m.solve();
  return { m, t, lines, centroid: t.at(20, 15, 5) };
}

/** The loop the pixel over `world` is inside, as the engine's `regionAt` finds it. */
function clicked(m: Model, view: View, world: number[]): Loop {
  const loops = findLoops(m);
  const hit = loopAt(m, view, ...worldToScreen(view, world), loops);
  assert.ok(hit, `a face under ${world}`);
  return hit;
}

/** Where the face's plane is, and which way out of the solid it faces, from the centroid. */
function outward(m: Model, loop: Loop, centroid: number[]): { at: number[]; n: number[] } {
  const at = mean(vertices(loop).map((p) => m.coords(p)));
  const n = loop.plane.normal;
  return { at, n: dot(sub(at, centroid), n) > 0 ? n : neg(n) };
}

test("every face of a plate, clicked from outside: the lid, the base from below and all four walls — the plane's +z points out of the solid", async () => {
  await loadKernel();
  const { m, t, centroid } = plate();
  const faces: [string, number[], number[]][] = [
    ["the lid", t.at(20, 15, 10), t.ux],
    ["the base, from below", t.at(20, 15, 0), t.ux],
    ["the near wall", t.at(20, 0, 5), t.ux],
    ["the right wall", t.at(40, 15, 5), t.uy],
    ["the far wall", t.at(20, 30, 5), t.ux],
    ["the left wall", t.at(0, 15, 5), t.uy],
  ];
  for (const [what, world, along] of faces) {
    const n = sub(world, centroid);
    // Look at the face from its own outside: toward the viewer is the face's
    // outward side, which is what back-face culling leaves clickable.
    const view = viewFrom(n.map((x) => x / Math.hypot(...n)), along, world);
    const loop = clicked(m, view, world);
    const face = outward(m, loop, centroid);
    assert.ok(near(face.at, world, 1e-6), `${what}: the click found that face (its middle is ${face.at})`);
    const z = zOf(m, sketchFrameFor(m, loop, viewAxes(view).toward));
    assert.ok(near(z, face.n, 1e-7), `${what}: +z ${z} is the outward normal ${face.n}`);
  }
});

test("the Onshape sequence: a circle sketched on a wall and extruded a positive depth stands off the plate — a boss, not a bore", async () => {
  await loadKernel();
  const { m, t, centroid } = plate();
  const wall = t.at(20, 0, 5);
  const view = viewFrom(neg(t.uy), t.ux, wall);
  const loop = clicked(m, view, wall);
  const [a, b, c] = sketchFrameFor(m, loop, viewAxes(view).toward);

  // What the tool types, typed: a frame on the wall's own points, the default.
  const scope = neocadScope({ model: m }) as Record<string, (...x: unknown[]) => unknown>;
  const f = scope.plane(a, b, c) as string;
  assert.equal(m.defaultFrame, f);
  const centre = m.addPoint(wall).name;
  onPlane(m, centre, f);
  const boss = m.addCircle(centre, 4, f).name;
  const e = extrude(m, boss, 6);
  m.solve();
  const g = m.featureOf(e, "extrude");
  const twinOf = new Map([...baseOf(m, g.depth)].map(([twin, base]) => [base, twin]));
  const lidCentre = m.coords(twinOf.get(centre)!);
  assert.ok(near(lidCentre, wall.map((w, i) => w - 6 * t.uy[i]), 1e-6), `the boss's lid is 6 out from the wall, along −y: ${lidCentre}`);
  // The outward-boss assertion the spec names: the new lid sits farther from
  // the plate's centroid than the wall does.
  const fromCentroid = (p: number[]) => Math.hypot(...sub(p, centroid));
  assert.ok(fromCentroid(lidCentre) > fromCentroid(wall) + 5.9, `${fromCentroid(lidCentre)} beyond ${fromCentroid(wall)}`);
  const lid = m.coords(m.frame(g.top).origin);
  assert.ok(Math.abs(dot(sub(lid, wall), t.uy) + 6) < 1e-6, "the boss's lid frame is on its lid plane, outside the plate");

  // The frame follows the solid — it is the plate's own points, read as a
  // datum — so the plate growing leaves it on the same wall, facing out.
  scope.set(`${m.featureOf("e1", "extrude").depth}.value`, 25);
  m.solve();
  assert.ok(near(frameBasis(m, f)().uz!, neg(t.uy), 1e-9), "still facing out after the plate grew");

  // Deleting the frame takes what was drawn on it and the boss's record, and
  // nothing of the plate.
  const plateOwns = [...m.featureOf("e1", "extrude").owns];
  del(m, f);
  assert.ok(!m.entities.has(boss), "the circle drawn on the frame went with it");
  assert.ok(!m.features.has(e), "the boss's record names the frame, so it went too");
  assert.ok(m.features.has("e1"));
  assert.ok(plateOwns.every((n) => m.has(n)), "every piece of the plate stayed");
});

test("a circle's lid and base, each from its own outside, get planes facing out — the swap is what makes the base face down", async () => {
  await loadKernel();
  const m = new Model(3);
  const t = tiltedFrame(m);
  const r = ring(m, t, 10, 10, 5);
  const e = extrude(m, r, 8);
  m.solve();
  const centroid = t.at(10, 10, 4);
  for (const [what, world, toward] of [["lid", t.at(10, 10, 8), t.uz], ["base", t.at(10, 10, 0), neg(t.uz)]] as const) {
    const view = viewFrom(toward, t.ux, world);
    const loop = clicked(m, view, world);
    assert.equal(loop.members.length, 1, `${what}: a whole circle`);
    const z = zOf(m, sketchFrameFor(m, loop, viewAxes(view).toward));
    assert.ok(dot(z, sub(world, centroid)) > 0, `${what}: out of the cylinder`);
  }
  assert.ok(m.features.has(e));
});

// --- the journal, the tool and the menu ------------------------------------------

test("plane(a, b, c) on a face journals what any typed plane() does, and the file reopens byte for byte", async () => {
  await loadKernel();
  const { m, t } = plate();
  const view = viewFrom(neg(t.uy), t.ux, t.at(20, 0, 5));
  const loop = clicked(m, view, t.at(20, 0, 5));
  const command = sketchOnFaceCommand(m, loop, viewAxes(view).toward);
  const before = m.journal.length;
  const repl = new Repl(neocadScope({ model: m }));
  const r = await repl.eval(command);
  assert.equal(r.ok, true, String(r.error));
  const [a, b, c] = sketchFrameFor(m, loop, viewAxes(view).toward);
  assert.deepEqual(m.journal.slice(before).map((j) => [j.op, j.args]), [
    ["addFrame", [a, b, c, r.value]],
    ["setDefaultFrame", [r.value]],
  ], "a frame and the default — nothing about faces");
  const file = save(m);
  assert.equal(save(open(file)), file);
});

/** The tool's context, with the engine's regionAt answered from `view` and run typed into a real scope. */
function toolCtx(m: Model, view: View, log: string[], typed: string[]) {
  const repl = new Repl(neocadScope({ model: m }));
  const pending: Promise<unknown>[] = [];
  const c = {
    model: m, options: {}, finished: false, renders: 0,
    requestRender() { c.renders++; },
    requestSolve() { m.solve(); },
    finish() { c.finished = true; },
    regionAt: ([sx, sy]: [number, number]) => {
      const loops = findLoops(m);
      const loop = loopAt(m, view, sx, sy, loops);
      return loop ? { loops, index: loops.indexOf(loop), toward: viewAxes(view).toward } : null;
    },
    log: (line: string) => { log.push(line); },
    run: (command: string) => { typed.push(command); pending.push(repl.eval(command)); },
    settled: () => Promise.all(pending),
  };
  return c as ToolContext & typeof c;
}

const info = (screen: [number, number]) => ({ world: [0, 0, 0], screen });

test("the sketch tool: a click on nothing is refused aloud and it stays armed; a click inside a wall types plane(a, b, c) and finishes", async () => {
  await loadKernel();
  const { m, t, centroid } = plate();
  const wall = t.at(20, 0, 5);
  const view = viewFrom(neg(t.uy), t.ux, wall);
  const log: string[] = [], typed: string[] = [];
  const ctx = toolCtx(m, view, log, typed);
  const tool = new SketchTool(ctx);
  assert.equal(tool.snaps, false, "it chooses a face, not a place");

  tool.onDown(info(worldToScreen(view, t.at(80, -40, 5))));
  assert.match(log.join("\n"), /^sketch: click inside a closed outline — the ones I can see are lit$/);
  assert.equal(ctx.finished, false);
  assert.deepEqual(typed, []);

  tool.onMove(info(worldToScreen(view, wall)));
  assert.ok(ctx.renders > 0, "hovering the wall redraws, to outline it");
  tool.onDown(info(worldToScreen(view, wall)));
  await ctx.settled();
  assert.equal(ctx.finished, true);
  assert.equal(typed.length, 1);
  assert.match(typed[0], /^plane\("p\d+", "p\d+", "p\d+"\)$/);
  const f = m.defaultFrame!;
  const z = frameBasis(m, f)().uz!;
  assert.ok(dot(z, sub(wall, centroid)) > 0, "facing out of the plate");
});

test("headless, with no command line to type into, the tool throws rather than half-commit", async () => {
  await loadKernel();
  const { m, t } = plate();
  const view = viewFrom(t.uz, t.ux, t.at(20, 15, 10));
  const ctx = toolCtx(m, view, [], []);
  const bare = { ...ctx, run: undefined, log: undefined } as unknown as ToolContext;
  const tool = new SketchTool(bare);
  const frames = [...m.entities.values()].filter((e) => e.kind === "frame").length;
  assert.throws(() => tool.onDown(info(worldToScreen(view, t.at(20, 15, 10)))), /no command line here/);
  assert.equal([...m.entities.values()].filter((e) => e.kind === "frame").length, frames);
});

test("the menu: Sketch on this face only inside a region, typing the tool's own line; disabled with the reason where no plane can be made; absent in 2D", async () => {
  await loadKernel();
  const { m, t } = plate();
  const wall = t.at(20, 0, 5);
  const view = viewFrom(neg(t.uy), t.ux, wall);
  const loops = findLoops(m);
  const loop = loopAt(m, view, ...worldToScreen(view, wall), loops)!;
  const region = { loops, index: loops.indexOf(loop), toward: viewAxes(view).toward };
  const item = menuFor(m, null, region).items.find((i) => i.label === "Sketch on this face");
  assert.deepEqual(item?.action, { do: "run", command: sketchOnFaceCommand(m, loop, region.toward) });
  assert.ok(!menuFor(m, null).items.some((i) => i.label === "Sketch on this face"), "not outside a region");
  assert.ok(!menuFor(m, null, null).items.some((i) => i.label === "Sketch on this face"));
  // The rest of the empty-canvas menu is unchanged by it.
  assert.deepEqual(menuFor(m, null, region).items.slice(0, -1), menuFor(m, null).items);

  // A D on a semicircle: shown, disabled, with the helper's own reason.
  const n = new Model(3);
  const u = tiltedFrame(n);
  const [c, s, e] = [[10, 0], [20, 0], [0, 0]].map(([x, y]) => n.addPoint(u.at(x, y)).name);
  n.addArc(c, s, e, null, u.name);
  n.addLine(e, s);
  const dl = findLoops(n);
  const off = menuFor(n, null, { loops: dl, index: 0, toward: u.uz }).items.at(-1)!;
  assert.equal(off.label, "Sketch on this face");
  assert.equal(off.action.do, "disabled");
  assert.match((off.action as { why: string }).why, /no three points off one line/);

  // 2D: a drawing that is one plane already offers nothing to sketch on.
  const flat = new Model(2);
  const pts = [[0, 0], [10, 0], [10, 10]].map((p) => flat.addPoint(p).name);
  pts.forEach((p, i) => flat.addLine(p, pts[(i + 1) % 3]));
  const tl = findLoops(flat);
  assert.ok(!menuFor(flat, null, { loops: tl, index: 0, toward: [0, 0, 1] }).items.some((i) => i.label === "Sketch on this face"));
});
