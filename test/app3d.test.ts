// The app on a 3D model: tools drawing on a sketch plane, the engine's working
// plane and its gestures, the command surface's lifts, and 2D files opening
// lifted.
//
// Closed-form wherever the claim is geometric — "it solved" is what a tool that
// drew on the wrong plane would also report. The browser half of this story,
// where the gestures are a real mouse and the foreshortening is pixels, is
// test/e2e/camera.e2e.ts.

import { test } from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { ensureKernelLoaded } from "../src/kernel/problem.ts";
import { Model } from "../src/model.ts";
import { neocadScope } from "../src/replenv.ts";
import { open, save, FORMAT, VERSION } from "../src/persist.ts";
import { fillet } from "../src/operations.ts";
import { ToolEngine } from "../src/tools/engine.ts";
import { RectangleTool } from "../src/tools/rectangle.ts";
import { LineTool } from "../src/tools/line.ts";
import { ArcTool } from "../src/tools/arc.ts";
import { placePoint } from "../src/tools/place.ts";
import { findSnap } from "../src/snapping.ts";
import { curveFrame } from "../src/curveplane.ts";
import { orbitBy, viewAxes, worldToScreen, type Plane, type View } from "../src/view.ts";
import type { PointerInfo, ToolContext } from "../src/tools/tool.ts";
import "../src/modules/builtin.ts"; // registers the built-in tools, as the app does
import { tiltedFrame, type TiltedFrame } from "./frames.ts";

async function loadKernel() {
  const bytes = await readFile(new URL("../src/kernel/wasm-gen/neocad_kernel_bg.wasm", import.meta.url));
  await ensureKernelLoaded(bytes);
}

function fakeCtx(model: Model) {
  const c = {
    model,
    options: {},
    finished: false,
    requestRender() {},
    requestSolve() { model.solve(); },
    finish() { c.finished = true; },
  };
  return c as ToolContext & typeof c;
}

const dot = (a: number[], b: number[]) => a.reduce((s, x, i) => s + x * b[i], 0);
const sub = (a: number[], b: number[]) => a.map((x, i) => x - b[i]);
const close = (a: number, b: number, tol = 1e-9) => Math.abs(a - b) <= tol;
/** How far a point is off a frame's plane. */
const off = (f: TiltedFrame, p: number[]) => dot(sub(p, f.origin), f.uz);
const planeOf = (f: TiltedFrame): Plane => ({ origin: f.origin, u: f.ux, v: f.uy });
const click = (f: TiltedFrame, u: number, v: number): PointerInfo =>
  ({ world: f.at(u, v), screen: [0, 0], plane: planeOf(f) });
const opsOf = (m: Model) => m.journal.map((e) => e.op);

// --- tools on a sketch plane ---------------------------------------------------

test("a rectangle drawn on a tilted frame lies in its plane, along its axes, held there", async () => {
  await loadKernel();
  const model = new Model(3);
  const f = tiltedFrame(model);
  const tool = new RectangleTool(fakeCtx(model));
  tool.onDown(click(f, 2, 3));
  tool.onUp(click(f, 32, 23));

  const corners = ["p1", "p2", "p3", "p4"].map((n) => model.coords(n));
  for (const p of corners) assert.ok(close(off(f, p), 0), `a corner is off the plane by ${off(f, p)}`);
  // Along the frame's own axes: the derived corners are (32,3) and (2,23).
  const inFrame = (p: number[]) => [dot(sub(p, f.origin), f.ux), dot(sub(p, f.origin), f.uy)];
  assert.deepEqual(corners.map((p) => inFrame(p).map((x) => Math.round(x * 1e9) / 1e9)),
    [[2, 3], [32, 3], [32, 23], [2, 23]]);
  // All four held on the sketch — the derived two as well, or the box could
  // fold out of the plane about its own diagonal.
  assert.deepEqual(model.journal.filter((e) => e.op === "onPlane").map((e) => e.args).sort(),
    [["p1", "t"], ["p2", "t"], ["p3", "t"], ["p4", "t"]]);
  assert.equal(model.solve().solved, true);
});

test("placePoint holds a point on the sketch only where the snap leaves it free to go", async () => {
  await loadKernel();
  const model = new Model(3);
  const f = tiltedFrame(model);
  const ctx = fakeCtx(model);
  const onPlaneOf = (n: string) => model.relationsNaming(n).filter((r) => r.op === "onPlane").length;

  const free = placePoint(ctx, click(f, 5, 5));
  assert.equal(onPlaneOf(free), 1, "a click in empty space lands on the plane and is held there");

  // A vertex snap pins the point outright: no plane on top.
  model.addPoint(f.at(10, 0), "v");
  const snapped = placePoint(ctx, {
    ...click(f, 10, 0),
    snap: { world: f.at(10, 0), screen: [0, 0], kind: "point", targets: ["v"] },
  });
  assert.equal(onPlaneOf(snapped), 0);
  assert.ok(opsOf(model).includes("coincident"));

  // A click that landed off the plane — a snap carried it onto geometry above
  // the sketch — is not held to a plane it is not on.
  model.addPoint(f.at(0, 0, 9), "above");
  model.addPoint(f.at(10, 0, 9), "above2");
  model.addLine("above", "above2", "lab");
  const along = placePoint(ctx, {
    world: f.at(4, 0, 9), screen: [0, 0], plane: planeOf(f),
    snap: { world: f.at(4, 0, 9), screen: [0, 0], kind: "curve", targets: ["lab"] },
  });
  assert.equal(onPlaneOf(along), 0, "on a line nine units above the sketch");
  assert.equal(model.solve().solved, true, "and nothing conflicts");
});

test("the line tool infers against a tilted 3D frame's own axes, in its plane", async () => {
  await loadKernel();
  const model = new Model(3);
  const f = tiltedFrame(model);
  const tool = new LineTool(fakeCtx(model));
  tool.onDown(click(f, 0, 0));
  // Two degrees off the frame's +x, measured in its plane.
  const t = (2 * Math.PI) / 180;
  tool.onDown(click(f, 40 * Math.cos(t), 40 * Math.sin(t)));
  const par = model.journal.find((e) => e.op === "parallel");
  assert.deepEqual(par?.args, ["l1", "t.x"], "the line form, against the frame's x");
  // Placed on the axis already, so the constraint lands satisfied.
  const [a, b] = [model.coords("p1"), model.coords("p2")];
  const d = sub(b, a);
  assert.ok(close(dot(d, f.uy), 0) && close(dot(d, f.uz), 0), `along +x exactly: ${d}`);
  assert.ok(close(dot(d, f.ux), 40 * Math.cos(t)), "the aimed length along that axis");
});

test("the centre-point arc sweeps counter-clockwise as the viewer sees it, from either side", async () => {
  await loadKernel();
  for (const facing of [1, -1]) {
    const model = new Model(3);
    const f = tiltedFrame(model);
    // The working plane as the engine reports it: its front toward the viewer.
    // From behind the frame, that is the frame's plane with +y flipped.
    const plane: Plane = { origin: f.origin, u: f.ux, v: f.uy.map((c) => c * facing) };
    const at = (u: number, v: number): PointerInfo => ({ world: f.at(u, v * facing), screen: [0, 0], plane });
    const tool = new ArcTool(fakeCtx(model));
    // Centre, then start at "3 o'clock", then end at "12 o'clock" — as the
    // viewer sees the plane. Counter-clockwise for them is the quarter arc.
    tool.onDown(at(0, 0));
    tool.onDown(at(10, 0));
    tool.onDown(at(0, 10));
    const arc = [...model.entities.values()].find((e) => e.kind === "arc")!;
    const af = curveFrame(model, arc)!;
    assert.ok(close(af.sweep, Math.PI / 2, 1e-9),
      `seen from the ${facing > 0 ? "front" : "back"}, the drawn arc sweeps ${af.sweep}, not a quarter turn`);
  }
});

test("fillet rounds a corner on a tilted plane: tangent, in the plane, the short way round", async () => {
  await loadKernel();
  const model = new Model(3);
  const f = tiltedFrame(model);
  model.addPoint(f.at(30, 0), "a");
  model.addPoint(f.at(0, 0), "k");
  model.addPoint(f.at(0, 30), "b");
  model.addLine("a", "k", "l1");
  model.addLine("k", "b", "l2");
  const arcName = fillet(model, "l1", "l2", 8);
  assert.equal(model.solve().solved, true);
  const arc = model.arc(arcName);
  const c = model.coords(arc.center);
  const expected = f.at(8, 8);
  assert.ok(Math.hypot(...sub(c, expected)) < 1e-6, `centre at ${c}, expected ${expected}`);
  const af = curveFrame(model, arc)!;
  assert.ok(close(af.sweep, Math.PI / 2, 1e-6), `the drawn arc is the quarter, not the reflex: ${af.sweep}`);
});

// --- the engine ----------------------------------------------------------------

function fakeCanvas() {
  const listeners = new Map<string, ((e: unknown) => void)[]>();
  const canvas = {
    addEventListener(type: string, fn: (e: unknown) => void) {
      listeners.set(type, [...(listeners.get(type) ?? []), fn]);
    },
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

function engineOn(model: Model, view: View) {
  const { canvas, fire } = fakeCanvas();
  const menus: (string | null)[] = [];
  const engine = new ToolEngine(model, canvas, view, {
    onSolveRender: () => { model.solve(); },
    onRenderOnly: () => {},
    onContextMenu: (pick) => { menus.push(pick?.name ?? null); },
  });
  return { engine, fire, menus };
}

test("in a 3D model the right button orbits past the threshold, and still opens a menu released in place", async () => {
  await loadKernel();
  const model = new Model(3);
  const view: View = { ox: 400, oy: 300, scale: 2 };
  const { engine, fire, menus } = engineOn(model, view);

  fire("pointerdown", { clientX: 300, clientY: 300, button: 2, buttons: 2 });
  fire("pointermove", { clientX: 340, clientY: 300, button: -1, buttons: 2 });
  fire("pointermove", { clientX: 380, clientY: 300, button: -1, buttons: 2 });
  fire("pointerup", { clientX: 380, clientY: 300, button: 2, buttons: 0 });
  assert.deepEqual(menus, [], "a drag is an orbit, not a menu");
  const { right } = viewAxes(engine.view);
  assert.ok(right[2] > 0.1, `the view turned: right is now ${right}`);
  assert.equal(engine.view.ox, 400, "about the target, which is the origin here, so its pixel held");

  fire("pointerdown", { clientX: 200, clientY: 200, button: 2, buttons: 2 });
  fire("pointerup", { clientX: 200, clientY: 200, button: 2, buttons: 0 });
  assert.deepEqual(menus, [null], "released where it landed, it is still the menu");

  const before = { ...engine.view };
  fire("pointerdown", { clientX: 500, clientY: 500, button: 1, buttons: 4 });
  fire("pointermove", { clientX: 530, clientY: 510, button: -1, buttons: 4 });
  fire("pointerup", { clientX: 530, clientY: 510, button: 1, buttons: 0 });
  assert.ok(engine.view.ox > before.ox + 20, "the middle button pans");
  assert.deepEqual(engine.view.right, before.right, "and never turns anything");
});

test("in a 2D model the right button still pans — there is nothing to turn", async () => {
  await loadKernel();
  const model = new Model(2);
  const { engine, fire } = engineOn(model, { ox: 0, oy: 0, scale: 1 });
  fire("pointerdown", { clientX: 200, clientY: 200, button: 2, buttons: 2 });
  fire("pointermove", { clientX: 260, clientY: 230, button: -1, buttons: 2 });
  fire("pointerup", { clientX: 260, clientY: 230, button: 2, buttons: 0 });
  assert.ok(engine.view.ox > 40 && engine.view.right === undefined);
});

test("a click lands on the default frame's plane, however the view is turned", async () => {
  await loadKernel();
  const model = new Model(3);
  const f = tiltedFrame(model);
  const view = orbitBy({ ox: 400, oy: 300, scale: 3 }, 0.6, -0.35);
  const { engine } = engineOn(model, view);
  for (const [sx, sy] of [[400, 300], [120, 80], [700, 520]]) {
    const w = engine.screenToWorld(sx, sy);
    assert.ok(close(off(f, w), 0, 1e-9), `(${sx}, ${sy}) landed ${off(f, w)} off the plane`);
    assert.deepEqual(worldToScreen(view, w).map((x) => Math.round(x * 1e6) / 1e6), [sx, sy], "under the cursor");
  }
});

test("a drag moves the grabbed point parallel to the working plane, never along its normal", async () => {
  await loadKernel();
  const model = new Model(3);
  const f = tiltedFrame(model);
  model.addPoint(f.at(10, 10, 6), "q"); // six units above the sketch
  const view = orbitBy({ ox: 400, oy: 300, scale: 3 }, 0.5, -0.3);
  const { fire } = engineOn(model, view);
  const [sx, sy] = worldToScreen(view, model.coords("q"));
  fire("pointerdown", { clientX: sx, clientY: sy, button: 0, buttons: 1 });
  fire("pointermove", { clientX: sx + 40, clientY: sy - 25, button: -1, buttons: 1 });
  fire("pointerup", { clientX: sx + 40, clientY: sy - 25, button: 0, buttons: 0 });
  const q = model.coords("q");
  assert.ok(close(off(f, q), 6, 1e-6), `still six above the plane: ${off(f, q)}`);
  assert.ok(Math.hypot(...sub(q, f.at(10, 10, 6))) > 5, "and it really moved");
});

// --- the command surface -------------------------------------------------------

test("pt(x, y) and fix(p, [x, y]) in a 3D model mean z = 0 — the seed, and the frame's plane", async () => {
  await loadKernel();
  const model = new Model(3);
  const s = neocadScope({ model }) as Record<string, (...a: unknown[]) => unknown>;
  const p = s.pt(4, 5) as string;
  assert.deepEqual(model.coords(p), [4, 5, 0]);
  tiltedFrame(model);
  s.fix(p, [3, 7]);
  const entry = model.journal.find((e) => e.op === "fix")!;
  assert.deepEqual(entry.args, [p, [3, 7, 0], "t"], "journalled lifted, so the file says what it means");
  assert.throws(() => s.pt(1), /needs 3 coordinates/, "a wrong count still meets the model's own message");
});

test("orbit and lookAt move the camera and journal nothing", async () => {
  await loadKernel();
  const model = new Model(3);
  const f = tiltedFrame(model);
  const view: View = { ox: 400, oy: 300, scale: 3 };
  const s = neocadScope({ model, view }) as Record<string, (...a: unknown[]) => unknown>;
  const journal = model.journal.length;
  s.orbit(0.4, -0.2);
  assert.ok(view.right && Math.abs(view.right[0] - 1) > 1e-3, "the view turned");
  s.lookAt();
  const { right, up } = viewAxes(view);
  assert.ok(right.every((c, i) => close(c, f.ux[i], 1e-12)) && up.every((c, i) => close(c, f.uy[i], 1e-12)),
    "the default frame is square to the screen, +x right, +y up");
  assert.equal(model.journal.length, journal, "a view is not an edit to the drawing");
  assert.throws(() => s.orbit("left"), /two angles/);
});

// --- opening 2D files into the 3D app --------------------------------------------

const TILT = 0.5;

/** A 2D file as each older build wrote it: a tilted frame, a fixed point, a fillet. */
function file2D(version: 4 | 5): string {
  const frame = version === 4 ? ["o", "x", "base"] : ["o", "x", null, "base"];
  return JSON.stringify({
    format: FORMAT, version, dim: 2,
    journal: [
      { op: "addPoint", args: [[4, 6], "o"] },
      { op: "addPoint", args: [[4 + Math.cos(TILT), 6 + Math.sin(TILT)], "x"] },
      { op: "addFrame", args: frame },
      { op: "setDefaultFrame", args: ["base"] },
      // An auto-named frame whose pieces the model makes: their names, and the
      // names after them, must come out as the 2D replay gave them.
      { op: "addFrame", args: version === 4 ? [null, null, "f2"] : [null, null, null, "f2"] },
      { op: "addPoint", args: [[0, 0], "p"] },
      { op: "fix", args: ["p", [3, 4], "base"] },
      { op: "addPoint", args: [[50, 0], "p3"] },
      { op: "addPoint", args: [[50, 40], "k"] },
      { op: "addPoint", args: [[90, 40], "q"] },
      { op: "addLine", args: ["p3", "k", "l1"] },
      { op: "addLine", args: ["k", "q", "l2"] },
      { op: "fillet", args: ["l1", "l2", 6] },
    ],
    values: { points: {}, radii: {} },
  });
}

test("v4 and v5 2D files open into a 3D model lifted: z = 0, frames on that plane, fix meaning what it meant", async () => {
  await loadKernel();
  for (const version of [4, 5] as const) {
    const m = open(file2D(version), 3);
    assert.equal(m.dim, 3);
    assert.equal(m.frame("base").yref, "base_y", "the y-ref a 3D frame needs, named after its frame");
    assert.equal(m.frame("f2").origin, "p1", "an auto-created origin keeps the 2D replay's name");
    assert.equal(m.frame("f2").xref, "p2");
    assert.equal(m.solve().solved, true, `v${version} solves`);
    for (const e of m.entities.values()) {
      if (e.kind === "point") assert.equal(m.coords(e.name)[2], 0, `${e.name} has no depth`);
    }
    // fix(p, [3, 4]) in the tilted frame lands where it did in 2D.
    const [c, s] = [Math.cos(TILT), Math.sin(TILT)];
    const p = m.coords("p");
    assert.ok(Math.hypot(p[0] - (4 + 3 * c - 4 * s), p[1] - (6 + 3 * s + 4 * c), p[2]) < 1e-9, `p at ${p}`);
    assert.deepEqual(m.journal.find((e) => e.op === "fix")!.args, ["p", [3, 4, 0], "base"]);
    // The fillet re-expanded in 3D and drew the short arc.
    const arc = [...m.entities.values()].find((e) => e.kind === "arc")!;
    const af = curveFrame(m, arc)!;
    assert.ok(af.sweep < Math.PI, `the fillet's arc is the short one: ${af.sweep}`);
  }
});

test("a lifted frame's +y is its 2D +y, even when the drawing turned it past where its seed was", async () => {
  await loadKernel();
  // Saved with its x-ref swung round to point down the kernel's −x: the y-ref
  // a replay seeds from the *journal's* numbers would be on the wrong side, and
  // only the saved coordinates know better.
  const text = JSON.stringify({
    format: FORMAT, version: 5, dim: 2,
    journal: [
      { op: "addPoint", args: [[0, 0], "o"] },
      { op: "addPoint", args: [[1, 0], "x"] },
      { op: "addFrame", args: ["o", "x", null, "f"] },
      { op: "setDefaultFrame", args: ["f"] },
      { op: "addPoint", args: [[0, 0], "p"] },
      { op: "fix", args: ["p", [0, 10], "f"] },
    ],
    values: { points: { o: [0, 0], x: [-1, 0], p: [0, -10] }, radii: {} },
  });
  const m = open(text, 3);
  assert.equal(m.solve().solved, true);
  // +x is −x, so +y (a quarter turn counter-clockwise) is −y: (0, 10) in the
  // frame is (0, −10) in the world, exactly where the 2D drawing had it.
  const p = m.coords("p");
  assert.ok(Math.hypot(p[0], p[1] + 10, p[2]) < 1e-9, `p at ${p}`);
});

test("a lifted file re-saves as a 3D file of the current version that reopens to itself", async () => {
  await loadKernel();
  const m = open(file2D(5), 3);
  m.solve();
  const text = save(m);
  const saved = JSON.parse(text);
  assert.equal(saved.version, VERSION);
  assert.equal(saved.version, 22);
  assert.equal(saved.dim, 3);
  assert.equal(save(open(text, 3)), text, "stable from here on");
  assert.equal(save(open(text)), text, "and a 3D file opens as itself without being asked");
});

test("a y-ref is never named after something the file already uses", async () => {
  await loadKernel();
  const text = JSON.stringify({
    format: FORMAT, version: 5, dim: 2,
    journal: [
      { op: "addPoint", args: [[0, 0], "o"] },
      { op: "addPoint", args: [[1, 0], "x"] },
      { op: "addFrame", args: ["o", "x", null, "f"] },
      { op: "addPoint", args: [[5, 5], "f_y"] }, // a point the user called f_y
    ],
    values: { points: {}, radii: {} },
  });
  const m = open(text, 3);
  assert.equal(m.frame("f").yref, "f_y2");
  assert.equal(m.point("f_y").kind, "point");
});

test("the library still opens a 2D file as 2D, and refuses to squash a 3D one", async () => {
  await loadKernel();
  assert.equal(open(file2D(5)).dim, 2, "nobody asked for 3");
  const m3 = new Model(3);
  m3.addPoint([1, 2, 3]);
  assert.throws(() => open(save(m3), 2), /3D file cannot open as a 2D model/);
});
