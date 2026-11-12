// A click on a face lands on that face and is held there
// (docs/plans/click-on-face.md). The owner: *"if i am hovering over a face
// without an active on-plane constraint, it should constrain to the plane i
// am hovering over. like i should be able to do a 3 point circle with each
// point on a different face of the rect prism, by just orbiting around."*
//
// Headless, 3D: the relation — `onplane(p, "e1:l2")`, the face named by the
// line it is swept from (docs/plans/review-relations.md; it was the kernel's
// place for it, `e1.m1`, which a fillet of the profile renumbered) and read
// off its feature's record — follows a `set` of the
// depth and a save/open, goes with the feature, refuses a round face; `par`
// to a face holds a curve's normal; snaps on a face are the face's; the tools
// driven by hand with clicks that landed on faces; and the engine landing a
// drawing tool's click on the face drawn under the pixel. The browser half,
// where the faces are pixels and the hand is a mouse or a finger, is
// test/e2e/clickonface.e2e.ts.

import { test } from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { ensureKernelLoaded } from "../src/kernel/problem.ts";
import { Model, parseAxisRef, parseFaceName } from "../src/model.ts";
import { fix, onPlane } from "../src/relations/basic.ts";
import { parallel } from "../src/relations/geometry.ts";
import { faceDirection, onFace, planeNow } from "../src/relations/solidref.ts";
import { del, extrude, set } from "../src/operations.ts";
import { open, save } from "../src/persist.ts";
import { neocadScope } from "../src/replenv.ts";
import { glyphSymbol } from "../src/glyphs.ts";
import { findSnap } from "../src/snapping.ts";
import { isFacePlane, planeNormalRef, planeOfRef } from "../src/workplane.ts";
import { chipParts, chipText, landingLabel } from "../src/modechip.ts";
import { CurvePlane, holdCurve, holdOnSketchPlane, placePoint } from "../src/tools/place.ts";
import { CircleTool } from "../src/tools/circle.ts";
import { RectangleTool } from "../src/tools/rectangle.ts";
import { LineTool } from "../src/tools/line.ts";
import { ToolEngine } from "../src/tools/engine.ts";
import type { PointerInfo, ToolContext } from "../src/tools/tool.ts";
import { visibleFaces } from "../src/faces.ts";
import { occlusion } from "../src/occlusion.ts";
import { faceUnder } from "../src/solidpick.ts";
import { orbitBy, screenToPlane, viewAxes, worldToScreen, type Plane, type View } from "../src/view.ts";
import "../src/modules/builtin.ts"; // registers the built-in tools, as the app does

await (async () => {
  const bytes = await readFile(new URL("../src/kernel/wasm-gen/neocad_kernel_bg.wasm", import.meta.url));
  await ensureKernelLoaded(bytes);
})();

const sub = (a: number[], b: number[]) => a.map((v, i) => v - b[i]);
const dotN = (a: number[], b: number[]) => a.reduce((s, v, i) => s + v * b[i], 0);
const len = (a: number[]) => Math.hypot(...a);
const cross = (a: number[], b: number[]) => [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]];

function solved(m: Model) {
  const r = m.solve();
  assert.equal(r.solved, true, JSON.stringify(r.offenders));
  return r;
}

/** How far `q` is off the plane of `face`, now. */
const offFace = (m: Model, face: string, q: number[]) => {
  const pl = planeNow(m, face)!;
  return Math.abs(dotN(sub(q, pl.p), pl.n));
};

/**
 * A 60 × 40 × 20 block, as the owner makes a prism: a rectangle drawn free
 * on the ground and extruded. `held` fixes the four base corners where they
 * are, so a relation to a face moves only what it holds and a `set` of the
 * depth only the lid; free, a relation to a face is shared both ways and the
 * whole solid may move (every sketch is a 3D sketch, profiles-held.md).
 */
function block(held = false) {
  const m = new Model(3);
  const s = neocadScope({ model: m }) as Record<string, (...a: unknown[]) => unknown>;
  const pts = [[0, 0], [60, 0], [60, 40], [0, 40]].map(([x, y]) => s.pt(x, y, 0) as string);
  const ls = pts.map((p, i) => s.ln(p, pts[(i + 1) % 4]) as string);
  if (held) for (const p of pts) fix(m, p, m.coords(p), "origin");
  const e = extrude(m, ls[0], 20);
  solved(m);
  return { m, e, pts, ls };
}

/**
 * The wall of `e` swept from `line`: its face name, as a relation holds it and
 * a tool is handed it — by the line (`e1:l2`), not by the line's place in the
 * profile (docs/plans/review-relations.md).
 */
function wallOf(m: Model, e: string, line: string): string {
  const f = m.features.get(e)!;
  const i = f.loops[0].findIndex((member) => member === line);
  assert.ok(i >= 0, `${line} is a member of ${e}`);
  return `${e}:${line}`;
}

// --- the relation ------------------------------------------------------------------

test("onplane(p, \"e1:l2\") holds a point on a wall by the face's name: the same op and glyph as any onplane, journalled with the face", () => {
  const { m, e, ls } = block(true);
  const wall = wallOf(m, e, ls[1]); // the +x wall, x = 60
  const p = m.addPoint([65, 20, 10]).name;
  const r = onPlane(m, p, wall);
  const entry = m.relationOf(r);
  assert.equal(entry.op, "onPlane");
  assert.deepEqual(entry.args, [p, wall]);
  assert.equal(glyphSymbol(entry), "▱");
  solved(m);
  assert.ok(offFace(m, wall, m.coords(p)) < 1e-9, `on the wall: ${m.coords(p)}`);
  assert.ok(Math.abs(m.coords(p)[0] - 60) < 1e-9, "the wall is x = 60, and the base fixed there keeps it so");
  assert.equal(m.journal.at(-1)?.op, "onPlane", "journalled as onPlane");
  assert.ok(m.relationsNaming(e).some((x) => x.name === r), "the relation names the feature, through the face");

  // Both ways: with nothing holding the base, the wall comes to meet the point
  // as much as the point goes to the wall — a relation between entities, not a
  // point pinned to a datum (profiles-held.md).
  const free = block(false);
  const wallF = wallOf(free.m, free.e, free.ls[1]);
  const q = free.m.addPoint([65, 20, 10]).name;
  onPlane(free.m, q, wallF);
  solved(free.m);
  assert.ok(offFace(free.m, wallF, free.m.coords(q)) < 1e-9, "met");
  const wallX = planeNow(free.m, wallF)!.p[0];
  assert.ok(wallX > 60 + 1e-3 && free.m.coords(q)[0] < 65 - 1e-3, `shared: the wall at x = ${wallX}, the point at x = ${free.m.coords(q)[0]}`);
});

test("a face's name is no frame axis, and the model knows a face's shape", () => {
  assert.deepEqual(parseFaceName("e1.m3"), { feature: "e1", role: "member", member: 3 });
  assert.deepEqual(parseFaceName("e2.lid"), { feature: "e2", role: "lid", member: -1 });
  assert.equal(parseFaceName("p1.p2.p3"), null);
  assert.equal(parseFaceName("f1.x"), null);
  assert.equal(parseAxisRef("e1.m3"), null, "a face name reads as no axis (a glyph of par(c, e1.m3) asked this and threw)");
  assert.throws(() => parseAxisRef("f1.w"), /not a frame axis/, "a mistyped axis still says so");
});

test("held on the lid, a point follows a set of the depth — the base fixed, exactly; the base free, with the solid", () => {
  const { m, e } = block(true);
  const q = m.addPoint([30, 20, 20]).name;
  onPlane(m, q, `${e}.lid`);
  solved(m);
  set(m, "d1.value", 30);
  solved(m);
  assert.ok(Math.abs(m.coords(q)[2] - 30) < 1e-6, `rode up to 30: ${m.coords(q)}`);
  assert.ok(offFace(m, `${e}.lid`, m.coords(q)) < 1e-9);

  // The owner's prism as drawn — nothing holds the base — shares the change:
  // the point is still on the lid, and the lid is still the depth above the
  // base, but the solid itself may have moved (the register says so).
  const free = block(false);
  const r = free.m.addPoint([30, 20, 20]).name;
  onPlane(free.m, r, `${free.e}.lid`);
  solved(free.m);
  set(free.m, "d1.value", 30);
  solved(free.m);
  assert.ok(offFace(free.m, `${free.e}.lid`, free.m.coords(r)) < 1e-9, "still on the lid");
  assert.ok(Math.abs(offFace(free.m, `${free.e}.base`, free.m.coords(r)) - 30) < 1e-6, "the lid is 30 above the base, and the point on it");
});

test("the hold survives a save and an open, and a set on the copy", () => {
  const { m, e, ls } = block(true);
  const wall = wallOf(m, e, ls[1]);
  const p = m.addPoint([60, 10, 5]).name;
  const r = onPlane(m, p, wall);
  solved(m);
  const copy = open(save(m, false), 3);
  solved(copy);
  assert.deepEqual(copy.relationOf(r).args, [p, wall]);
  set(copy, "d1.value", 25);
  solved(copy);
  assert.ok(offFace(copy, wall, copy.coords(p)) < 1e-9, "on the wall after the set on the copy");
  assert.ok(Math.abs(copy.coords(p)[0] - 60) < 1e-9);
});

test("deleting the feature takes the relation naming its face; the point stays", () => {
  const { m, e, ls } = block();
  const wall = wallOf(m, e, ls[1]);
  const p = m.addPoint([60, 10, 5]).name;
  const r = onPlane(m, p, wall);
  del(m, e);
  assert.equal(m.relations.has(r), false, "the onplane went with e1");
  assert.equal(m.entities.has(p), true, "the point was never the feature's");
  solved(m);
});

test("a round face holds nothing: onplane refuses it with the reason, and a point placed on it is placed and said", () => {
  const m = new Model(3);
  const s = neocadScope({ model: m }) as Record<string, (...a: unknown[]) => unknown>;
  const c = s.circ(s.pt(0, 0, 0), 15) as string;
  const e = extrude(m, c, 10);
  solved(m);
  const wall = `${e}.m0`;
  assert.equal(isFacePlane(m, wall), false);
  assert.throws(() => onPlane(m, m.addPoint([15, 0, 5]).name, wall), /not flat/);
  assert.throws(() => onFace(m, m.addPoint([15, 0, 5]).name, "e7.lid"), /no face of a feature/);
  const said: string[] = [];
  const ctx = { model: m, options: {}, requestRender() {}, requestSolve() {}, finish() {}, log: (line: string) => said.push(line) } as unknown as ToolContext;
  const before = m.relations.size;
  const p = placePoint(ctx, { world: [15, 0, 5], screen: [0, 0], face: { name: wall, flat: false } });
  assert.equal(m.relations.size, before, "nothing holds it");
  assert.deepEqual(m.coords(p), [15, 0, 5], "placed where the click landed");
  assert.match(said.join("\n"), /round face, or one only the kernel knows: nothing holds it/);
});

test("par(c, \"e1:l2\") holds a circle's normal to a wall's; par to a cap is a datum, two datums refused", () => {
  const { m, e, ls } = block();
  const wall = wallOf(m, e, ls[1]);
  const c = m.addCircle(m.addPoint([60, 20, 10]).name, 5, [0.2, 1, 0.3]).name;
  assert.equal(planeNormalRef(m, wall), wall, "a face is its own normal reference");
  parallel(m, c, wall);
  solved(m);
  const n = m.normalOf(c);
  const want = planeNow(m, wall)!.n;
  assert.ok(len(cross(n, want)) < 1e-9, `the circle faces as the wall does: ${n} vs ${want}`);
  assert.equal(faceDirection(m, `${e}.lid`)?.frame, `${e}.lid`, "a cap's normal is a datum");
  assert.equal(faceDirection(m, wall)?.frame, null, "a wall's is its line's ends — variables");
  assert.throws(() => parallel(m, `${e}.lid`, `${e}.base`), /both datums/);
  assert.equal(faceDirection(m, "p1"), null);
});

// --- the tools, by hand -------------------------------------------------------------

/** A click on face `face` at the world point `at`, as the engine hands it to a tool. */
function clickOn(m: Model, face: string, at: number[], screen: [number, number] = [0, 0]): PointerInfo {
  const plane = planeOfRef(m, face)!;
  return { world: at, screen, plane, face: { name: face, flat: true } };
}

function toolCtx(m: Model) {
  const ctx = {
    model: m, options: {}, requestRender() {}, requestSolve() { m.solve(); }, finish() {}, log() {},
    planeAt: (_s: [number, number], plane: Plane) => plane.origin,
  } as unknown as ToolContext;
  return ctx;
}

const heldOn = (m: Model, p: string) => m.relationsNaming(p).filter((r) => r.op === "onPlane" && r.args[0] === p).map((r) => r.args[1] as string);

test("the circle tool, centre then rim on a wall: the centre onplane the wall, the normal par to it", () => {
  const { m, e, ls } = block();
  const wall = wallOf(m, e, ls[1]);
  const t = new CircleTool({ ...toolCtx(m), options: { method: "centre" } } as ToolContext);
  t.onDown(clickOn(m, wall, [60, 20, 10], [10, 10]));
  t.onUp(clickOn(m, wall, [60, 20, 10], [10, 10]));
  t.onDown(clickOn(m, wall, [60, 26, 10], [40, 10]));
  t.onUp(clickOn(m, wall, [60, 26, 10], [40, 10]));
  const c = [...m.entities.values()].find((x) => x.kind === "circle");
  assert.ok(c && c.kind === "circle", "a circle was drawn");
  assert.deepEqual(heldOn(m, c.center), [wall]);
  const par = m.relationsNaming(c.name).find((r) => r.op === "parallel");
  assert.deepEqual(par?.args, [c.name, wall]);
  solved(m);
  assert.ok(len(cross(m.normalOf(c.name), planeNow(m, wall)!.n)) < 1e-9);
});

test("the circle tool, three clicks on three faces: each point onplane its own face, the circle through them, held to no plane", () => {
  const { m, e, ls } = block();
  const [wallX, wallY, lid] = [wallOf(m, e, ls[1]), wallOf(m, e, ls[2]), `${e}.lid`];
  const t = new CircleTool({ ...toolCtx(m), options: { method: "3pt" } } as ToolContext);
  const clicks = [clickOn(m, wallX, [60, 20, 10], [10, 10]), clickOn(m, wallY, [30, 40, 12], [50, 10]), clickOn(m, lid, [40, 15, 20], [30, 50])];
  for (const c of clicks) { t.onDown(c); t.onUp(c); }
  const circle = [...m.entities.values()].find((x) => x.kind === "circle");
  assert.ok(circle && circle.kind === "circle", "a circle through three faces");
  const rim = m.relationsNaming(circle.name).filter((r) => r.op === "onCircle").map((r) => r.args[0] as string);
  assert.equal(rim.length, 3);
  assert.deepEqual(rim.map((p) => heldOn(m, p)).flat().sort(), [lid, wallX, wallY].sort());
  assert.equal(m.relationsNaming(circle.name).filter((r) => r.op === "parallel").length, 0, "in no one plane: nothing holds its normal");
  solved(m);
  for (const [i, p] of rim.entries()) assert.ok(offFace(m, heldOn(m, p)[0], m.coords(p)) < 1e-9, `point ${i} on its face`);
  // The circle's normal was seeded as the plane through the three, not the first face's.
  const [a, b, c] = clicks.map((k) => k.world);
  const n = cross(sub(b, a), sub(c, a));
  assert.ok(len(cross(m.normalOf(circle.name), n.map((v) => v / len(n)))) < 1e-6, `faces the three: ${m.normalOf(circle.name)}`);
});

test("the rectangle tool on a wall: all four corners held on it, and no coplanar of its own; the line tool, an end on each of two faces", () => {
  const { m, e, ls } = block();
  const wall = wallOf(m, e, ls[1]);
  const t = new RectangleTool(toolCtx(m));
  t.onDown(clickOn(m, wall, [60, 10, 5], [10, 10]));
  t.onUp(clickOn(m, wall, [60, 30, 15], [40, 40]));
  const corners = [...m.entities.values()].filter((x) => x.kind === "point").slice(-4).map((x) => x.name);
  for (const p of corners) assert.deepEqual(heldOn(m, p), [wall], `${p} on the wall`);
  assert.equal([...m.relations.values()].filter((r) => r.op === "coplanar" && r.args.some((a) => corners.includes(a as string))).length, 0);
  solved(m);
  const line = new LineTool(toolCtx(m));
  line.onDown(clickOn(m, wall, [60, 20, 10], [10, 10]));
  line.onDown(clickOn(m, `${e}.lid`, [30, 20, 20], [50, 50]));
  line.onCancel();
  const made = [...m.entities.values()].filter((x) => x.kind === "line").at(-1)!;
  assert.ok(made.kind === "line");
  assert.deepEqual(heldOn(m, made.refs[0]), [wall]);
  assert.deepEqual(heldOn(m, made.refs[1]), [`${e}.lid`]);
  solved(m);
});

test("a shape begun on a face is laid out on it: the rim dragged over the ground is read back on the face; the ground holds nothing", () => {
  const { m, e, ls } = block();
  const wall = wallOf(m, e, ls[1]);
  const ctx = toolCtx(m);
  const plane = new CurvePlane(ctx, "circle");
  plane.begin(clickOn(m, wall, [60, 20, 10]));
  assert.equal(plane.plane, wall);
  const onGround: PointerInfo = { world: [70, 20, 0], screen: [5, 5], plane: planeOfRef(m, "origin")! };
  // Read again on the wall (the fake `planeAt` answers the plane's own point), and no longer on the ground's face.
  const settled = plane.settle(onGround);
  assert.ok(offFace(m, wall, settled.world) < 1e-9, "re-read onto the wall");
  assert.equal(settled.face, undefined);
  // A click that is a point of its own keeps its face.
  const own = plane.settleOwn(clickOn(m, `${e}.lid`, [30, 20, 20]));
  assert.equal(own.face?.name, `${e}.lid`);
  // The ground: a gesture begun there holds nothing, face or not.
  const ground = new CurvePlane(ctx, "circle");
  ground.begin(onGround);
  assert.equal(ground.plane, "origin");
  assert.equal(holdOnSketchPlane(m, m.addPoint([70, 20, 0]).name, "origin"), null);
  const c = m.addCircle(m.addPoint([70, 20, 0]).name, 3, [0, 0, 1]);
  assert.deepEqual(holdCurve(m, c.name, c.center, "origin"), []);
  // A face holds, chosen or not.
  const q = m.addPoint([60, 5, 5]).name;
  assert.ok(holdOnSketchPlane(m, q, wall));
  assert.deepEqual(heldOn(m, q), [wall]);
});

// --- snaps on a face --------------------------------------------------------------

test("with a face under the hand, a ground vertex behind it is not offered as itself — only its projection, which infers nothing", () => {
  const { m, e, ls } = block();
  const wall = wallOf(m, e, ls[1]); // x = 60
  // A loose vertex beyond the wall, on the ground, exactly behind the wall's middle when seen from +x.
  const behind = m.addPoint([80, 20, 10]).name;
  solved(m);
  const view: View = orbitBy(orbitBy({ ox: 400, oy: 300, scale: 4 }, 0, -Math.PI / 2), -Math.PI / 2, 0);
  const [sx, sy] = worldToScreen(view, [60, 20, 10]);
  const at = worldToScreen(view, m.coords(behind));
  assert.ok(Math.hypot(at[0] - sx, at[1] - sy) < 2, `the vertex shares the pixel: ${at} vs ${[sx, sy]}`);
  const free = findSnap(m, view, sx, sy, null, null, 1);
  assert.equal(free?.kind, "point");
  assert.equal(free?.targets[0], behind, "without the face, the click would pin to the vertex behind");
  const onFaceSnap = findSnap(m, view, sx, sy, planeOfRef(m, wall), null, 1);
  assert.notEqual(onFaceSnap?.kind, "point", `on the face, the vertex is not a place to land: ${JSON.stringify(onFaceSnap)}`);
  if (onFaceSnap) {
    assert.equal(onFaceSnap.kind, "projected");
    assert.ok(offFace(m, wall, onFaceSnap.world) < 1e-9, "its projection is on the face");
  }
});

// --- the engine --------------------------------------------------------------------

function fakeCanvas() {
  const listeners = new Map<string, ((e: unknown) => void)[]>();
  const canvas = {
    addEventListener(type: string, fn: (e: unknown) => void) { listeners.set(type, [...(listeners.get(type) ?? []), fn]); },
    getContext: () => ({}),
    getBoundingClientRect: () => ({ left: 0, top: 0, x: 0, y: 0, width: 800, height: 600 }),
    setPointerCapture() {},
    releasePointerCapture() {},
  };
  const fire = (type: string, e: Record<string, unknown>) => {
    for (const fn of listeners.get(type) ?? []) fn({ preventDefault() {}, pointerId: 1, ...e });
  };
  return { canvas: canvas as unknown as HTMLCanvasElement, fire };
}

test("the engine lands a drawing tool's click on the face drawn under the pixel, names it before the click, and not with a sketch plane chosen", () => {
  const { m, e, ls } = block();
  const { canvas, fire } = fakeCanvas();
  const view: View = orbitBy(orbitBy({ ox: 400, oy: 300, scale: 4 }, 0, -1.0), -0.8, 0);
  const engine = new ToolEngine(m, canvas, view, { onSolveRender: () => { m.solve(); }, onRenderOnly: () => {} });
  const faces = visibleFaces(m, view);
  engine.drawnFaces = { faces, occ: occlusion(faces, view) };
  const wall = wallOf(m, e, ls[1]);
  const [sx, sy] = worldToScreen(view, [60, 20, 10]);
  // A drawn face carries the kernel's tag, its place in the profile; the engine hands it on by the line it is swept from.
  assert.equal(faceUnder(engine.drawnFaces, sx, sy)?.name, `${e}.m${m.features.get(e)!.loops[0].indexOf(ls[1])}`, "the wall is drawn under the pixel");
  engine.arm("point");
  fire("pointermove", { clientX: sx, clientY: sy, button: -1, buttons: 0 });
  assert.equal(engine.landing?.face, wall);
  assert.equal(engine.landing?.flat, true);
  assert.equal(chipText(chipParts(landingLabel(engine.landing), "point", "click where the point goes", null, true)), `on ${wall} · point · click where the point goes`);
  fire("pointerdown", { clientX: sx, clientY: sy, button: 0, buttons: 1 });
  const p = [...m.entities.values()].filter((x) => x.kind === "point").at(-1)!.name;
  assert.ok(offFace(m, wall, m.coords(p)) < 1e-6, `landed on the wall: ${m.coords(p)}`);
  assert.deepEqual(heldOn(m, p), [wall]);
  assert.equal(engine.landing, null, "the tool finished: nothing to land on");

  // With a sketch plane chosen, the click lands on it, whatever is under the pixel (case 1).
  m.setWorkPlane("origin");
  engine.arm("point");
  fire("pointermove", { clientX: sx, clientY: sy, button: -1, buttons: 0 });
  assert.equal(engine.landing, null);
  fire("pointerdown", { clientX: sx, clientY: sy, button: 0, buttons: 1 });
  const q = [...m.entities.values()].filter((x) => x.kind === "point").at(-1)!.name;
  assert.ok(Math.abs(m.coords(q)[2]) < 1e-9, `on the chosen ground: ${m.coords(q)}`);
  assert.deepEqual(heldOn(m, q), ["origin"]);
  m.setWorkPlane(null);

  // A tool that does not place points is not landed: the dimension tool picks by pixel.
  engine.arm("dimension");
  fire("pointermove", { clientX: sx, clientY: sy, button: -1, buttons: 0 });
  assert.equal(engine.landing, null);
});

test("the chip: where the next click lands is said, not offered; a round face says so", () => {
  const land = chipParts("e1.m3", "circle", "press at the centre", null, true);
  assert.equal(land.where, "on e1.m3");
  assert.equal(land.landing, true);
  assert.equal(chipParts("e1's top", "circle", "x", null).landing, false, "a chosen plane is a mode");
  assert.equal(chipParts(null, "circle", "x", null, true).landing, false);
  assert.equal(landingLabel({ face: "e1.m0", flat: false }), "e1.m0, not held");
  assert.equal(landingLabel({ face: "e1.lid", flat: true }), "e1.lid");
  assert.equal(landingLabel(null), null);
});

test("a face the engine lands on, seen from behind the solid, is read facing the viewer", () => {
  const { m, e } = block();
  const view: View = orbitBy({ ox: 400, oy: 300, scale: 4 }, 0, Math.PI); // from below: the base faces the viewer
  const faces = visibleFaces(m, view);
  const occ = occlusion(faces, view);
  const [sx, sy] = worldToScreen(view, [30, 20, 0]);
  const under = faceUnder({ faces, occ }, sx, sy);
  assert.equal(under?.name, `${e}.base`);
  const on = planeOfRef(m, `${e}.base`)!;
  const hit = screenToPlane(view, sx, sy, on)!;
  assert.ok(Math.abs(hit[2]) < 1e-9, "the click lands on the base");
  assert.ok(dotN(cross(on.u, on.v), viewAxes(view).toward) !== 0);
});
