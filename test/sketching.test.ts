// Sketching on a plane, the rest of 3D phase 2: an off-plane point offered at
// its projection (a position aid that infers nothing), the curve tools drawing
// with no frame at all, `plane()` as "start sketching here",
// `frame()` facing a turned view, and the menu's "Sketch on this".

import { test } from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { ensureKernelLoaded } from "../src/kernel/problem.ts";
import { Model } from "../src/model.ts";
import { findSnap, describeSnap } from "../src/snapping.ts";
import { placePoint } from "../src/tools/place.ts";
import { sketchPlane } from "../src/workplane.ts";
import { alignView, orbitBy, viewAxes, worldToScreen, type View } from "../src/view.ts";
import { neocadScope } from "../src/replenv.ts";
import { menuFor } from "../src/menu.ts";
import { CircleTool } from "../src/tools/circle.ts";
import { Circle3Tool } from "../src/tools/circle3.ts";
import { ArcTool } from "../src/tools/arc.ts";
import { Arc3Tool } from "../src/tools/arc3.ts";
import type { PointerInfo, ToolContext } from "../src/tools/tool.ts";
import { tiltedFrame } from "./frames.ts";

async function loadKernel() {
  const bytes = await readFile(new URL("../src/kernel/wasm-gen/neocad_kernel_bg.wasm", import.meta.url));
  await ensureKernelLoaded(bytes);
}

const dot = (a: number[], b: number[]) => a.reduce((s, x, i) => s + x * b[i], 0);
const sub = (a: number[], b: number[]) => a.map((x, i) => x - b[i]);
const close = (a: number, b: number, tol = 1e-9) => Math.abs(a - b) <= tol;

function fakeCtx(model: Model, logged?: string[]) {
  const c = {
    model, options: {}, finished: false,
    requestRender() {}, requestSolve() { model.solve(); }, finish() { c.finished = true; },
    ...(logged ? { log: (line: string) => { logged.push(line); } } : {}),
  };
  return c as ToolContext & typeof c;
}

// --- the projected snap -------------------------------------------------------

/** A tilted sketch, looked at square-on, with a point a long way in front of it. */
function scene() {
  const m = new Model(3);
  const t = tiltedFrame(m);
  m.addPoint(t.at(12, 7, 40), "far"); // forty off the sketch, toward the viewer
  const view: View = alignView({ ox: 400, oy: 300, scale: 3 }, t.ux, t.uy, t.origin);
  return { m, t, view, sketch: sketchPlane(m)! };
}

test("an off-plane point is offered at its projection onto the sketch — the foot of the perpendicular", () => {
  const { m, t, view, sketch } = scene();
  const [sx, sy] = worldToScreen(view, t.at(12, 7));
  const snap = findSnap(m, view, sx + 2, sy - 1, sketch)!;
  assert.equal(snap.kind, "projected");
  assert.deepEqual(snap.targets, ["far"]);
  assert.ok(Math.hypot(...sub(snap.world, t.at(12, 7))) < 1e-9, `at ${snap.world}: on the sketch, under the point`);
  assert.equal(describeSnap(snap), "proj far");
  // Without a sketch plane nothing is projected: the point is itself, as ever.
  assert.equal(findSnap(m, view, sx + 2, sy - 1)!.kind, "point");
});

test("seen obliquely, the projection is still along the plane's normal, not the line of sight", () => {
  const { m, t, sketch } = scene();
  const view = orbitBy(alignView({ ox: 400, oy: 300, scale: 3 }, t.ux, t.uy, t.origin), 0.5, -0.3);
  const [sx, sy] = worldToScreen(view, t.at(12, 7));
  const snap = findSnap(m, view, sx, sy, sketch)!;
  assert.equal(snap.kind, "projected");
  assert.ok(Math.hypot(...sub(snap.world, t.at(12, 7))) < 1e-9);
  // The marker is where the foot is drawn, which is not where the point is.
  const [px, py] = worldToScreen(view, m.coords("far"));
  assert.ok(Math.hypot(px - sx, py - sy) > 20, "and the two are apart on screen, which is why the marker leads back");
});

test("a place on the sketch outranks a projection; a projection outranks a bare curve", () => {
  const { m, t, view, sketch } = scene();
  const [sx, sy] = worldToScreen(view, t.at(12, 7));
  m.addPoint(t.at(13, 7), "real"); // on the sketch, a few pixels away
  assert.deepEqual(findSnap(m, view, sx, sy, sketch)!.targets, ["real"], "a point on the sketch wins at any distance in tolerance");
  m.deleteEntity("real");
  m.addPoint(t.at(0, 6.5), "la"); m.addPoint(t.at(30, 6.5), "lb");
  m.addLine("la", "lb", "edge"); // an edge on the sketch, passing a pixel or so from the projection
  assert.equal(findSnap(m, view, sx, sy, sketch)!.kind, "projected", "a vertex aimed at beats an edge passed over");
});

test("placing at a projection infers nothing about the point it borrowed — only the sketch's own hold", () => {
  const { m, t, view, sketch } = scene();
  const [sx, sy] = worldToScreen(view, t.at(12, 7));
  const snap = findSnap(m, view, sx, sy, sketch)!;
  const ctx = fakeCtx(m);
  const before = m.relationsNaming("far").length;
  const placed = placePoint(ctx, { world: snap.world, screen: [sx, sy], snap, plane: sketch } as PointerInfo);
  assert.equal(m.relationsNaming("far").length, before, "nothing names the point it was projected from");
  assert.deepEqual(m.relationsNaming(placed).map((r) => r.op), ["onPlane"], "held on the sketch, as a click in space is");
  assert.ok(close(dot(sub(m.coords(placed), t.origin), t.uz), 0), "and it is on it");
});

// --- the curve tools need a plane -------------------------------------------------

// Nothing to make, so nothing to refuse (docs/plans/frameless-curves.md).
test("headless in 3D with no default frame and no command line, the circle and arc tools draw — on the origin's ground, no frame", async () => {
  await loadKernel();
  for (const Tool of [CircleTool, Circle3Tool, ArcTool, Arc3Tool]) {
    const m = new Model(3);
    const logged: string[] = [];
    const tool = new Tool(fakeCtx(m, logged));
    const at = (w: number[]): PointerInfo => ({ world: w, screen: [0, 0] });
    if (Tool === CircleTool) {
      tool.onDown(at([1, 2, 0]));
      tool.onUp(at([6, 2, 0])); // a drag, centre to rim
    } else {
      for (const w of [[1, 2, 0], [6, 2, 0], [1, 7, 0]]) { tool.onDown(at(w)); tool.onUp(at(w)); }
    }
    assert.deepEqual(logged, [], `${tool.name} refused nothing`);
    assert.ok([...m.entities.values()].some((e) => e.kind === "circle" || e.kind === "arc"), `${tool.name} drew`);
    assert.ok([...m.entities.values()].every((e) => e.kind !== "frame"), `${tool.name} made no frame`);
  }
});

test("in 2D the curve tools need nothing: a 2D circle has no plane", async () => {
  await loadKernel();
  const m = new Model(2);
  const tool = new CircleTool(fakeCtx(m));
  tool.onDown({ world: [0, 0], screen: [0, 0] });
  tool.onUp({ world: [5, 0], screen: [0, 0] });
  assert.equal([...m.entities.values()].filter((e) => e.kind === "circle").length, 1);
});

test("the circle tool on a tilted sketch makes a circle in the sketch's plane", async () => {
  await loadKernel();
  const m = new Model(3);
  const t = tiltedFrame(m);
  const plane = { origin: t.origin, u: t.ux, v: t.uy };
  const tool = new CircleTool(fakeCtx(m));
  tool.onDown({ world: t.at(4, 4), screen: [0, 0], plane });
  tool.onUp({ world: t.at(4, 10), screen: [0, 0], plane });
  const circle = [...m.entities.values()].find((e) => e.kind === "circle")!;
  assert.ok(close(dot(m.normalOf(circle.name), t.uz), 1), "facing the sketch's +z");
  assert.ok([...m.relations.values()].some((r) => r.op === "parallel" && r.args[0] === circle.name && r.args[1] === "t.z"),
    "and held to it");
  assert.ok(close(m.radius(circle.name), 6));
});

// --- plane() and frame() ------------------------------------------------------------

test("plane() makes a frame facing the view, makes it the default, looks at it — and journals only the model's half", () => {
  const m = new Model(3);
  const view: View = orbitBy({ ox: 400, oy: 300, scale: 3 }, 0.7, -0.4);
  const s = neocadScope({ model: m, view, viewSize: () => [800, 600] }) as Record<string, (...a: unknown[]) => unknown>;
  const turned = viewAxes(view);
  const name = s.plane() as string;
  assert.equal(m.defaultFrame, name, "the default — that is what starting a sketch means");
  const f = m.frame(name);
  const o = m.coords(f.origin);
  // In the middle of the view, its +x and +y the screen's right and up as they
  // were: a plane facing the viewer, which is the plane they were looking at.
  assert.ok(Math.hypot(...sub(worldToScreen(view, o), [400, 300])) < 1e-6, "in the middle of the view");
  const ux = sub(m.coords(f.xref), o), uy = sub(m.coords(f.yref!), o);
  assert.ok(close(dot(ux, turned.right), Math.hypot(...ux)) && close(dot(uy, turned.up), Math.hypot(...uy)),
    "along the turned screen's right and up, not the kernel's x and y");
  // Square-on now (lookAt), which for a plane already facing the viewer is the
  // same orientation.
  const now = viewAxes(view);
  assert.ok(now.right.every((x, i) => close(x, turned.right[i], 1e-12)));
  assert.deepEqual(m.journal.map((e) => e.op), ["addPoint", "addPoint", "addPoint", "addFrame", "setDefaultFrame"],
    "the frame and the default; the camera is not a thing a drawing remembers");
});

test("frame() in a view nobody turned journals what it always did", () => {
  const m = new Model(3);
  const s = neocadScope({ model: m, view: { ox: 400, oy: 300, scale: 3 }, viewSize: () => [800, 600] }) as
    Record<string, (...a: unknown[]) => unknown>;
  s.frame();
  assert.deepEqual(m.journal.map((e) => e.op), ["addPoint", "addFrame"]);
  assert.deepEqual(m.journal[1].args, ["p1", null, null, "f1"]);
});

// --- the menu ---------------------------------------------------------------------

test("a frame's menu offers Sketch on this: the default, then look at it — typed, like every item", () => {
  const m = new Model(3);
  const t = tiltedFrame(m);
  m.setDefaultFrame(null);
  const menu = menuFor(m, { name: t.name, kind: "frame", distance: 0 });
  const item = menu.items.find((i) => i.label === "Sketch on this");
  assert.ok(item, menu.items.map((i) => i.label).join(", "));
  assert.deepEqual(item.action, { do: "run", command: 'setDefaultFrame("t"); lookAt("t")' });
  // And the command does what the label says.
  const view: View = { ox: 400, oy: 300, scale: 3 };
  const s = neocadScope({ model: m, view }) as Record<string, (...a: unknown[]) => unknown>;
  s.setDefaultFrame("t");
  s.lookAt("t");
  assert.equal(m.defaultFrame, "t");
  assert.ok(viewAxes(view).right.every((x, i) => close(x, t.ux[i], 1e-12)));
});

test("on empty canvas in 3D with no default frame, the curve tools are offered like any other — they need no plane made", () => {
  const m = new Model(3);
  const menu = menuFor(m, null);
  for (const label of ["Circle", "3 point circle", "Arc", "3 point arc", "Fillet", "Point", "Line", "Rectangle"]) {
    assert.equal(menu.items.find((i) => i.label === label)!.action.do, "run", label);
  }
  tiltedFrame(m);
  assert.equal(menuFor(m, null).items.find((i) => i.label === "Circle")!.action.do, "run", "and with a default frame");
  assert.equal(menuFor(new Model(2), null).items.find((i) => i.label === "Circle")!.action.do, "run",
    "and a 2D model never needed one");
});
