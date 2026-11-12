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
import { parallel } from "../src/relations/geometry.ts";
import { frameBasis, planeBasis } from "../src/relations/refs.ts";
import { del, extrude } from "../src/operations.ts";
import { findLoops, loopAt, type Loop } from "../src/loops.ts";
import { open, save } from "../src/persist.ts";
import { neocadScope } from "../src/replenv.ts";
import { Repl } from "../src/repl.ts";
import { menuFor } from "../src/menu.ts";
import { facePlaneFor as facePlane, drawOnFaceCommand } from "../src/faceplane.ts";
import { PlaneTool } from "../src/tools/plane.ts";
import { regionAtFor } from "./featurectx.ts";
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

/**
 * The normal of a face's plane — three of its points, read as the plane
 * reference "a.b.c" is (`planeBasis`), or a circle's own (docs/plans/
 * frameless-curves.md: sketch on face names the face, and makes nothing).
 */
function zOf(m: Model, p: string | string[]): number[] {
  const ref = Array.isArray(p) ? p.join(".") : p;
  return planeBasis(m, ref)().n;
}

/** `facePlaneFor` where the face has three points of its own to give — every face here but a circle's lid. */
function facePlaneFor(m: Model, loop: Loop, toward: number[]): [string, string, string] {
  const p = facePlane(m, loop, toward);
  const pts = p.split(".");
  assert.equal(pts.length, 3, `three of the face's own points, not a circle's plane: ${p}`);
  return pts as [string, string, string];
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

  const front = facePlaneFor(m, loop, t.uz);
  assert.deepEqual(front, [v[0], v[1], v[3]]);
  assert.ok(near(zOf(m, front), t.uz), "seen from +z, the plane's +z is the frame's");

  const back = facePlaneFor(m, loop, neg(t.uz));
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
  assert.ok(dot(zOf(m, facePlaneFor(m, loop, oblique)), oblique) > 0);
  assert.ok(dot(zOf(m, facePlaneFor(m, loop, neg(oblique))), neg(oblique)) > 0);
  assert.equal(drawOnFaceCommand(m, loop, t.uz), `workplane(${JSON.stringify(front.join("."))})`);
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
  const got = facePlaneFor(m, loops[0], t.uz);
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
    const got = facePlaneFor(m, loop, toward);
    assert.equal(got[0], p1, "the origin is the first real corner");
    assert.deepEqual(got.slice(1).sort(), [mid, p2].sort(), "with its two neighbours");
    assert.ok(near(zOf(m, got), toward));
  }
});

test("a whole circle's face is the circle itself — its own plane, whichever side it is seen from, and nothing made", async () => {
  await loadKernel();
  // A whole circle used to take its frame's three points, or have a plane made
  // through its centre with two points held on its rim. It carries its own
  // normal now, so its plane is itself (docs/plans/frameless-curves.md).
  const m = new Model(3);
  const t = tiltedFrame(m);
  const c = ring(m, t, 10, 5, 4);
  const [loop] = findLoops(m);
  const ents = m.entities.size;
  assert.equal(facePlane(m, loop, t.uz), c);
  assert.equal(facePlane(m, loop, neg(t.uz)), c, "a circle cannot be turned over as three points can");
  assert.ok(near(zOf(m, c), t.uz));
  assert.equal(m.entities.size, ents, "nothing made");
  assert.equal(drawOnFaceCommand(m, loop, t.uz), `workplane(${JSON.stringify(c)})`);
  // Off its sketch's plane — every extruded circle's lid — it is still itself.
  const lifted = m.addCircle(m.addPoint(t.at(30, 5, 3)).name, 2, t.name).name;
  const lid = findLoops(m).find((l) => l.members[0].name === lifted)!;
  assert.equal(facePlane(m, lid, t.uz), lifted);
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
  const got = facePlaneFor(m, loops[0], t.uz);
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
    const got = facePlaneFor(m, loop, toward);
    assert.ok(got.every((p) => m.entities.get(p)?.kind === "point"), `${got}: real points only`);
    assert.ok(got.every((p) => points.includes(p)), `${got}: the rectangle's own corners`);
    assert.ok(near(zOf(m, got), toward), "facing whoever looked");
  }
  // Below the line the region has two real corners and two crossings; the
  // corner test skips any corner whose neighbour is a crossing, and the
  // rectangle's other corners — ends of the edges it runs along — make the third.
  assert.equal(vertices(loops[0]).filter((v) => m.entities.has(v)).length, 2);
});

test("a lens of two crossing circles has no point at all but their centres: it takes a circle's own plane, as a whole circle does", async () => {
  await loadKernel();
  const m = new Model(3);
  const t = tiltedFrame(m);
  ring(m, t, 10, 5, 10);
  ring(m, t, 22, 5, 10);
  const lens = findLoops(m).find((l) => l.area < 100)!; // the crescents are each over 200
  const got = facePlane(m, lens, t.uz);
  assert.equal(m.entities.get(got)?.kind, "circle", `a circle's own plane: ${got}`);
  assert.ok(near(zOf(m, got), t.uz));
});

test("refusals, by name: a D on a semicircle has no three points off one line; a plane seen edge-on; a 2D drawing", async () => {
  await loadKernel();
  const m = new Model(3);
  const t = tiltedFrame(m);
  // A semicircle closed by its diameter: both ends and the centre on one line.
  const [c, s, e] = [[10, 0], [20, 0], [0, 0]].map(([u, w]) => m.addPoint(t.at(u, w)).name);
  const arc = m.addArc(c, s, e, null, t.name).name;
  const line = m.addLine(e, s).name;
  const [d] = findLoops(m);
  assert.deepEqual(d.members.map((x) => x.name).sort(), [arc, line].sort());
  assert.throws(() => facePlaneFor(m, d, t.uz), new RegExp(`loop of .*${line}.* has no three points off one line`));

  // (A circle whose frame had collapsed used to be refused here: a circle
  // carries its own normal now, and has no frame to collapse.)

  // Edge-on: neither side faces the viewer.
  const q = new Model(3);
  const w = tiltedFrame(q);
  polygon(q, w, [[0, 0], [20, 0], [20, 20], [0, 20]]);
  const [sq] = findLoops(q);
  assert.throws(() => facePlaneFor(q, sq, w.ux), /edge-on to the view/);

  // A 2D drawing is one plane already, and a 2D frame takes no y-ref.
  const two = new Model(2);
  const pts = [[0, 0], [10, 0], [10, 10]].map((p) => two.addPoint(p).name);
  pts.forEach((p, i) => two.addLine(p, pts[(i + 1) % 3]));
  const [tri] = findLoops(two);
  assert.throws(() => facePlane(two, tri, [0, 0, 1]), /a 2D drawing is one plane already/);
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
    const z = zOf(m, facePlaneFor(m, loop, viewAxes(view).toward));
    assert.ok(near(z, face.n, 1e-7), `${what}: +z ${z} is the outward normal ${face.n}`);
  }
});

test("the Onshape sequence: a circle sketched on a wall and extruded a positive depth stands off the plate — a boss, not a bore", async () => {
  await loadKernel();
  const { m, t, centroid } = plate();
  const wall = t.at(20, 0, 5);
  const view = viewFrom(neg(t.uy), t.ux, wall);
  const loop = clicked(m, view, wall);
  const [a, b, c] = facePlaneFor(m, loop, viewAxes(view).toward);

  // What the tool types, typed: the work plane set to the wall's own points.
  // No frame is made (docs/plans/frameless-curves.md).
  const scope = neocadScope({ model: m }) as Record<string, (...x: unknown[]) => unknown>;
  const ref = `${a}.${b}.${c}`;
  assert.equal(scope.workplane(ref), ref);
  assert.equal(m.drawingPlane(), ref);
  assert.deepEqual([...m.entities.values()].filter((x) => x.kind === "frame").map((x) => x.name), [t.name], "only the sketch's own");
  const centre = m.addPoint(wall).name;
  onPlane(m, centre, ref);
  const boss = m.addCircle(centre, 4).name; // seeded facing the work plane
  parallel(m, boss, ref);
  const e = extrude(m, boss, 6);
  m.solve();
  const g = m.featureOf(e, "extrude");
  assert.equal(g.frame, ref, "along the wall it was sketched on");
  const twinOf = new Map([...baseOf(m, g.depth)].map(([twin, base]) => [base, twin]));
  const lidCentre = m.coords(twinOf.get(centre)!);
  assert.ok(near(lidCentre, wall.map((w, i) => w - 6 * t.uy[i]), 1e-6), `the boss's lid is 6 out from the wall, along −y: ${lidCentre}`);
  // The outward-boss assertion the spec names: the new lid sits farther from
  // the plate's centroid than the wall does.
  const fromCentroid = (q: number[]) => Math.hypot(...sub(q, centroid));
  assert.ok(fromCentroid(lidCentre) > fromCentroid(wall) + 5.9, `${fromCentroid(lidCentre)} beyond ${fromCentroid(wall)}`);
  // The boss's rim faces as its base does, and there is no lid frame.
  const rim = m.circle(g.twins[0][0]);
  assert.ok(near(m.normalOf(rim.name), m.normalOf(boss), 1e-9));
  assert.equal(g.top, undefined, "and there is no lid frame to stand there");

  // The plane follows the solid — it is the plate's own points, read as a
  // datum — so the plate growing leaves it on the same wall, facing out.
  scope.set(`${m.featureOf("e1", "extrude").depth}.value`, 25);
  m.solve();
  assert.ok(near(zOf(m, ref), neg(t.uy), 1e-9), "still facing out after the plate grew");

  // Deleting the plate used to take the boss's record and clear the work
  // plane: the wall's points went with the plate. They stay now — a feature
  // relates, it does not own (docs/plans/linked-profiles.md) — so the boss
  // still stands on them, and so does the plane.
  del(m, "e1");
  assert.ok(m.entities.has(boss), "the circle stays");
  assert.ok(m.features.has(e), "and the boss: the wall's points are plain geometry now, still there to stand on");
  assert.equal(m.workPlane, ref, "and the work plane, which names them");
  assert.deepEqual(m.journal.filter((j) => j.op === "setWorkPlane").map((j) => j.args), [[ref]]);
});

test("a circle's lid and base, each from its own outside: their own planes, the circles' normals — a curve drawn there is turned to face the viewer", async () => {
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
    const plane = facePlane(m, loop, viewAxes(view).toward);
    assert.equal(m.entities.get(plane)?.kind, "circle", `${what}: the circle itself`);
    // A circle cannot be turned over: the base's faces up, into the cylinder.
    // What faces out is decided where it matters — the curve drawn on it
    // (tools/place.ts) — and the lid's points out by its own.
    if (what === "lid") assert.ok(dot(zOf(m, plane), sub(world, centroid)) > 0, `${what}: out of the cylinder`);
  }
  assert.ok(m.features.has(e));
});

// --- the journal, the tool and the menu ------------------------------------------

test("workplane(\"a.b.c\") on a face journals one entry, names the face and makes nothing — and the file reopens byte for byte", async () => {
  await loadKernel();
  const { m, t } = plate();
  const view = viewFrom(neg(t.uy), t.ux, t.at(20, 0, 5));
  const loop = clicked(m, view, t.at(20, 0, 5));
  const command = drawOnFaceCommand(m, loop, viewAxes(view).toward);
  const before = m.journal.length;
  const ents = m.entities.size;
  const repl = new Repl(neocadScope({ model: m }));
  const r = await repl.eval(command);
  assert.equal(r.ok, true, String(r.error));
  const [a, b, c] = facePlaneFor(m, loop, viewAxes(view).toward);
  assert.deepEqual(m.journal.slice(before).map((j) => [j.op, j.args]), [["setWorkPlane", [`${a}.${b}.${c}`]]],
    "the work plane, by the face's own points — no frame");
  assert.equal(m.entities.size, ents);
  const file = save(m);
  assert.equal(save(open(file)), file);
  assert.equal(open(file).workPlane, `${a}.${b}.${c}`);
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
    regionAt: regionAtFor(m, view),
    log: (line: string) => { log.push(line); },
    run: (command: string) => { typed.push(command); pending.push(repl.eval(command)); },
    settled: () => Promise.all(pending),
  };
  return c as ToolContext & typeof c;
}

const info = (screen: [number, number]) => ({ world: [0, 0, 0], screen });

test("the plane tool: a click on nothing is refused aloud and it stays armed; a click inside a wall types workplane(\"a.b.c\") and finishes", async () => {
  await loadKernel();
  const { m, t, centroid } = plate();
  const wall = t.at(20, 0, 5);
  const view = viewFrom(neg(t.uy), t.ux, wall);
  const log: string[] = [], typed: string[] = [];
  const ctx = toolCtx(m, view, log, typed);
  const tool = new PlaneTool(ctx);
  assert.equal(tool.snaps, false, "it chooses a face, not a place");

  tool.onDown(info(worldToScreen(view, t.at(80, -40, 5))));
  // In 3D the ground's named planes are there to take too (docs/plans/sketch-mode.md), so the miss says so.
  assert.match(log.join("\n"), /^plane: \{tap\} inside a lit face, or a lit plane — or choose Top, Front or Right in the options$/);
  assert.equal(ctx.finished, false);
  assert.deepEqual(typed, []);

  tool.onMove(info(worldToScreen(view, wall)));
  assert.ok(ctx.renders > 0, "hovering the wall redraws, to outline it");
  tool.onDown(info(worldToScreen(view, wall)));
  await ctx.settled();
  assert.equal(ctx.finished, true);
  assert.equal(typed.length, 1);
  assert.match(typed[0], /^workplane\("p\d+\.p\d+\.p\d+"\)$/);
  assert.equal(m.defaultFrame, t.name, "no frame made, so the default is as it was");
  const z = zOf(m, m.workPlane!);
  assert.ok(dot(z, sub(wall, centroid)) > 0, "facing out of the plate");
});

test("headless, with no command line to type into, the tool throws rather than half-commit", async () => {
  await loadKernel();
  const { m, t } = plate();
  const view = viewFrom(t.uz, t.ux, t.at(20, 15, 10));
  const ctx = toolCtx(m, view, [], []);
  const bare = { ...ctx, run: undefined, log: undefined } as unknown as ToolContext;
  const tool = new PlaneTool(bare);
  const frames = [...m.entities.values()].filter((e) => e.kind === "frame").length;
  assert.throws(() => tool.onDown(info(worldToScreen(view, t.at(20, 15, 10)))), /no command line here/);
  assert.equal([...m.entities.values()].filter((e) => e.kind === "frame").length, frames);
});

test("the menu: Draw on this face only inside a region, typing the tool's own line; disabled with the reason where no plane can be made; absent in 2D", async () => {
  await loadKernel();
  const { m, t } = plate();
  const wall = t.at(20, 0, 5);
  const view = viewFrom(neg(t.uy), t.ux, wall);
  const loops = findLoops(m);
  const loop = loopAt(m, view, ...worldToScreen(view, wall), loops)!;
  const region = { loops, index: loops.indexOf(loop), toward: viewAxes(view).toward, at: wall };
  const item = menuFor(m, null, region).items.find((i) => i.label === "Draw on this face");
  assert.deepEqual(item?.action, { do: "run", command: drawOnFaceCommand(m, loop, region.toward) });
  assert.ok(!menuFor(m, null).items.some((i) => i.label === "Draw on this face"), "not outside a region");
  assert.ok(!menuFor(m, null, null).items.some((i) => i.label === "Draw on this face"));
  // The rest of the empty-canvas menu is unchanged by it — but for Edit e1 and
  // Flip direction, since a wall is a face of a feature (docs/plans/explicit-
  // regions.md) — and the face's own items come first, under them the tools
  // (on an iPhone the tools filled the screen and hid them: solid-tools-intuitive.md, W15).
  const onFace = menuFor(m, null, region).items;
  assert.deepEqual(onFace.slice(0, 4).map((i) => i.label), ["Draw on this face", "Edit e1", "Flip direction", "Tools"]);
  assert.deepEqual(onFace.slice(4), menuFor(m, null).items);

  // A D on a semicircle: shown, disabled, with the helper's own reason.
  const n = new Model(3);
  const u = tiltedFrame(n);
  const [c, s, e] = [[10, 0], [20, 0], [0, 0]].map(([x, y]) => n.addPoint(u.at(x, y)).name);
  n.addArc(c, s, e, null, u.name);
  n.addLine(e, s);
  const dl = findLoops(n);
  const off = menuFor(n, null, { loops: dl, index: 0, toward: u.uz, at: u.at(5, 1) }).items[0];
  assert.equal(off.label, "Draw on this face");
  assert.equal(off.action.do, "disabled");
  assert.match((off.action as { why: string }).why, /no three points off one line/);

  // 2D: a drawing that is one plane already offers nothing to sketch on.
  const flat = new Model(2);
  const pts = [[0, 0], [10, 0], [10, 10]].map((p) => flat.addPoint(p).name);
  pts.forEach((p, i) => flat.addLine(p, pts[(i + 1) % 3]));
  const tl = findLoops(flat);
  assert.ok(!menuFor(flat, null, { loops: tl, index: 0, toward: [0, 0, 1], at: [5, 1] }).items.some((i) => i.label === "Draw on this face"));
});
