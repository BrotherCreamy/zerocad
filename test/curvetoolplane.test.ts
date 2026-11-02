// The curve tools and the typed curve commands make their plane.
//
// A fresh 3D model has no default frame, and a circle or an arc in 3D is given
// one's plane (see `CircleEntity`). These used to be greyed out on the toolbar
// and the menu until a frame existed — the first thing a newcomer met after a
// rectangle. Now, as extrude does for a frameless sketch, the tool makes the
// plane the click already lands on — `plane(pt(…), null, null, { look: false
// })`, typed so the log teaches it — and carries on; the fillet tool makes its
// corner's; and `circ()`, `arc()` and `fillet(…)` typed do the same at the
// command line in one entry, so one undo step. The model's own "no default
// frame" refusal stays as the guard under them, and is tested to stand.

import { test } from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { ensureKernelLoaded } from "../src/kernel/problem.ts";
import { Model } from "../src/model.ts";
import { frameBasis } from "../src/relations/refs.ts";
import { filletNeedsFrame } from "../src/operations.ts";
import { open, save } from "../src/persist.ts";
import { neocadScope } from "../src/replenv.ts";
import { Repl } from "../src/repl.ts";
import { UndoStack } from "../src/undo.ts";
import { pointOnWorkingPlane, framePlane } from "../src/workplane.ts";
import { liesOn, orbitBy, viewAxes, worldToScreen, type View } from "../src/view.ts";
import { clickPlaneCommand } from "../src/tools/place.ts";
import { CircleTool } from "../src/tools/circle.ts";
import { Circle3Tool } from "../src/tools/circle3.ts";
import { ArcTool } from "../src/tools/arc.ts";
import { Arc3Tool } from "../src/tools/arc3.ts";
import { FilletTool } from "../src/tools/fillet.ts";
import { featureHost } from "./featurectx.ts";
import type { Pick } from "../src/picking.ts";
import type { PointerInfo, ToolContext } from "../src/tools/tool.ts";

async function loadKernel() {
  const bytes = await readFile(new URL("../src/kernel/wasm-gen/neocad_kernel_bg.wasm", import.meta.url));
  await ensureKernelLoaded(bytes);
}

const dot = (a: number[], b: number[]) => a.reduce((s, x, i) => s + x * b[i], 0);
const sub = (a: number[], b: number[]) => a.map((x, i) => x - b[i]);
const near = (a: number[], b: number[], tol = 1e-9) => Math.hypot(...sub(a, b)) <= tol;
const frames = (m: Model) => [...m.entities.values()].filter((e) => e.kind === "frame").map((e) => e.name);

/** A view never turned, its middle at (400, 300) on screen, 2 px a unit. */
function flatView(): View {
  return { ox: 400, oy: 300, scale: 2 };
}

/**
 * A tool's context with `run` typed into a real scope (settling once the line
 * has run, as the host's submit does), `act` counting the steps it bracketed,
 * and clicks read on the working plane through `view`, as the engine reads
 * them.
 */
function toolCtx(m: Model, view: View) {
  const repl = new Repl(neocadScope({ model: m, view, viewSize: () => [800, 600] }));
  const c = {
    model: m, options: {} as Record<string, unknown>, finished: false,
    log: [] as string[], typed: [] as string[], acts: 0, pending: [] as Promise<unknown>[],
    pickResult: null as Pick | null,
    requestRender() {},
    requestSolve() { m.solve(); },
    finish() { c.finished = true; },
    pick: () => c.pickResult,
    run(command: string) {
      c.typed.push(command);
      const p = repl.eval(command).then((r) => { if (!r.ok) c.log.push(String(r.error?.message)); });
      c.pending.push(p);
      return p;
    },
    act(fn: () => void) { c.acts++; fn(); },
    settled: async () => { while (c.pending.length) await c.pending.shift(); await new Promise((r) => setTimeout(r, 0)); },
  };
  // A feature's confirm, as the host types it: every line into the same scope, one user action.
  const host = featureHost(m, repl);
  const ctx = { ...c, log: (line: string) => { c.log.push(line); }, perform: host.perform };
  /** A click at a screen pixel, read where the engine would read it. */
  const at = (sx: number, sy: number): PointerInfo => {
    const { world, plane } = pointOnWorkingPlane(m, view, sx, sy);
    return { world, plane, screen: [sx, sy] };
  };
  return { ctx: ctx as unknown as ToolContext, c, at, repl, host };
}

// --- the line the tools type ------------------------------------------------------

test("the line a curve tool types: the click, to three decimals, refs left to frame()'s seeding, the view left alone", () => {
  assert.equal(clickPlaneCommand([12.34567, -7, 0]), "plane(pt(12.346, -7, 0), null, null, { look: false })");
  assert.equal(clickPlaneCommand([-0.0001, 1e-12, 3.5]), "plane(pt(0, 0, 3.5), null, null, { look: false })",
    "negative zero is written as zero");
});

// --- the tools --------------------------------------------------------------------

test("the circle tool in a fresh 3D model types the plane the press landed on, then draws on it — no refusal, the view unturned", async () => {
  await loadKernel();
  const m = new Model(3);
  const view = flatView();
  const seen = JSON.stringify(view);
  const { ctx, c, at } = toolCtx(m, view);
  const tool = new CircleTool(ctx);
  const press = at(431, 287);
  tool.onDown(press);
  await c.settled();
  assert.deepEqual(c.typed, [clickPlaneCommand(press.world)], "one line, typed");
  assert.deepEqual(c.log, [], "nothing refused");
  const f = m.defaultFrame!;
  assert.deepEqual(frames(m), [f], "the plane is the default");
  assert.ok(near(frameBasis(m, f)().uz!, [0, 0, 1]), "facing the viewer of a view never turned");
  assert.ok(near(frameBasis(m, f)().origin, press.world, 1e-3), "its origin at the click");

  tool.onMove(at(451, 287));
  tool.onUp(at(451, 287));
  assert.equal(c.finished, true);
  assert.equal(c.acts, 0, "the plane was in before the release, so the circle is the release's own step");
  const [circle] = [...m.entities.values()].filter((e) => e.kind === "circle");
  assert.equal(m.circle(circle.name).plane, f, "given the plane just made");
  assert.ok(Math.abs(m.radius(circle.name) - 10) < 1e-9, "20 px at 2 px a unit");
  assert.ok(liesOn(framePlane(m)!, m.coords(m.circle(circle.name).center)), "its centre on the sketch");
  assert.equal(m.solve().solved, true);
  assert.equal(JSON.stringify(view), seen, "the view did not turn");
  assert.deepEqual(m.journal.map((j) => j.op).slice(0, 3), ["addPoint", "addFrame", "setDefaultFrame"],
    "the frame's entries come first, so a replay finds it");
  const file = save(m);
  assert.equal(save(open(file)), file, "and the file reopens to itself");
});

test("a release that comes before the typed plane has gone in waits for it, and is a step of its own", async () => {
  await loadKernel();
  const m = new Model(3);
  const { ctx, c, at } = toolCtx(m, flatView());
  const tool = new CircleTool(ctx);
  tool.onDown(at(400, 300));
  tool.onUp(at(420, 300)); // in the same breath: the typed line has not run yet
  assert.equal([...m.entities.values()].some((e) => e.kind === "circle"), false, "held, not made inside the plane's step");
  await c.settled();
  assert.equal(c.acts, 1, "made once the plane was in, bracketed by itself");
  assert.equal([...m.entities.values()].filter((e) => e.kind === "circle").length, 1);
  assert.equal(m.solve().solved, true);
});

test("in a turned view the 3-point circle's plane faces the viewer, and all three rim points and the centre lie on it", async () => {
  await loadKernel();
  const m = new Model(3);
  const view = orbitBy(flatView(), 0.7, -0.4);
  const { ctx, c, at } = toolCtx(m, view);
  const tool = new Circle3Tool(ctx);
  tool.onDown(at(380, 290));
  await c.settled();
  tool.onDown(at(440, 300));
  tool.onDown(at(410, 340));
  assert.equal(c.finished, true, `${c.log}`);
  const f = m.defaultFrame!;
  const uz = frameBasis(m, f)().uz!;
  assert.ok(dot(uz, viewAxes(view).toward) > 1 - 1e-12, `+z toward the viewer: ${uz}`);
  const plane = framePlane(m)!;
  const [circle] = [...m.entities.values()].filter((e) => e.kind === "circle");
  for (const p of [...m.relationsNaming(circle.name).map((r) => r.args[0] as string), m.circle(circle.name).center]) {
    assert.ok(liesOn(plane, m.coords(p)), `${p} on the sketch`);
  }
  assert.equal(m.solve().solved, true);
});

test("the centre-point arc and the 3-point arc make their plane at the first click too", async () => {
  await loadKernel();
  for (const Tool of [ArcTool, Arc3Tool]) {
    const m = new Model(3);
    const { ctx, c, at } = toolCtx(m, flatView());
    const tool = new Tool(ctx);
    tool.onDown(at(400, 300));
    await c.settled();
    assert.equal(c.typed.length, 1, tool.name);
    if (Tool === ArcTool) { tool.onDown(at(440, 300)); tool.onDown(at(400, 340)); }
    else { tool.onDown(at(440, 300)); tool.onDown(at(420, 280)); }
    assert.equal(c.finished, true, `${tool.name}: ${c.log}`);
    const [arc] = [...m.entities.values()].filter((e) => e.kind === "arc");
    assert.equal(m.arc(arc.name).plane, m.defaultFrame, tool.name);
    assert.equal(m.solve().solved, true, tool.name);
  }
});

test("headless, with no command line to type into, the curve tools refuse the first click in the model's words and place nothing", () => {
  for (const Tool of [CircleTool, Circle3Tool, ArcTool, Arc3Tool]) {
    const m = new Model(3);
    const logged: string[] = [];
    const bare = { model: m, options: {}, requestRender() {}, requestSolve() {}, finish() {}, log: (l: string) => { logged.push(l); } };
    const tool = new Tool(bare as unknown as ToolContext);
    const click: PointerInfo = { world: [1, 2, 0], screen: [0, 0] };
    tool.onDown(click);
    tool.onUp(click);
    assert.equal(m.entities.size, 0, `${tool.name} placed nothing`);
    assert.match(logged[0] ?? "", new RegExp(`^${tool.name}: no default frame`), `${tool.name}: ${logged}`);
  }
});

/** A rectangle of free points and lines, level at z = 0 — what the rectangle tool draws in a model with no frame. */
function rectangle(m: Model): { points: string[]; lines: string[] } {
  const points = [[0, 0], [40, 0], [40, 30], [0, 30]].map(([x, y]) => m.addPoint([x, y, 0]).name);
  const lines = points.map((p, i) => m.addLine(p, points[(i + 1) % 4]).name);
  return { points, lines };
}

test("the fillet tool on a frameless corner, confirmed, types a plane of the corner's own points, +z toward the viewer, then the fillet — one user action", async () => {
  await loadKernel();
  const m = new Model(3);
  const { points, lines } = rectangle(m);
  const view = flatView();
  const { ctx, c, at, host } = toolCtx(m, view);
  const tool = new FilletTool(ctx);
  c.pickResult = { name: lines[0], kind: "line", distance: 0 };
  tool.onDown(at(410, 300));
  c.pickResult = { name: lines[1], kind: "line", distance: 0 };
  tool.onDown(at(480, 280));
  assert.deepEqual(host.typed, [], "picking types nothing");
  tool.confirm();
  await host.settled();
  // The shared point, then the legs' far ends — turned over so (b − a) × (c − a) faces the viewer.
  assert.deepEqual(host.typed, [`plane("${points[1]}", "${points[2]}", "${points[0]}", { look: false })`,
    `fillet("${lines[0]}", "${lines[1]}", 10)`]);
  assert.equal(host.performs, 1, "one user action");
  assert.equal(c.finished, true, `a confirm releases the tool: ${c.log}`);
  const f = m.defaultFrame!;
  assert.ok(near(frameBasis(m, f)().uz!, [0, 0, 1]), "+z toward the viewer");
  const [arc] = [...m.entities.values()].filter((e) => e.kind === "arc");
  assert.equal(m.arc(arc.name).plane, f);
  assert.equal(m.solve().solved, true);
});

test("a corner the fillet would refuse types no plane first", async () => {
  await loadKernel();
  const m = new Model(3);
  const { lines } = rectangle(m);
  assert.throws(() => filletNeedsFrame(m, lines[0], lines[1], 500), /too large/);
  assert.throws(() => filletNeedsFrame(m, lines[0], lines[2], 5), /do not meet/);
  const { ctx, c, at, host } = toolCtx(m, flatView());
  ctx.options.radius = 500;
  const tool = new FilletTool(ctx);
  c.pickResult = { name: lines[0], kind: "line", distance: 0 };
  tool.onDown(at(410, 300));
  c.pickResult = { name: lines[1], kind: "line", distance: 0 };
  tool.onDown(at(480, 280));
  tool.confirm();
  await host.settled();
  assert.deepEqual(host.typed, [], "nothing typed");
  assert.deepEqual(frames(m), []);
  assert.match(host.refused.join("\n"), /too large/);
});

// --- the command line -------------------------------------------------------------

/** One entry as the host runs it: snapshot, evaluate, push the step if it changed anything. */
async function entry(repl: Repl, m: Model, undo: UndoStack<string>, src: string) {
  const before = save(m, false);
  const r = await repl.eval(src);
  undo.pushIfChanged(before, save(m, false));
  return r;
}

test("typed circ() with no default frame makes one at the view centre, facing the viewer, and says so — one entry, one undo step", async () => {
  await loadKernel();
  const m = new Model(3);
  const view = orbitBy(flatView(), 0.5, 0.3);
  const said: string[] = [];
  const repl = new Repl(neocadScope({ model: m, view, viewSize: () => [800, 600], log: (l) => { said.push(l); } }));
  const undo = new UndoStack<string>();
  const empty = save(m, false);
  const r = await entry(repl, m, undo, "circ()");
  assert.equal(r.ok, true, r.error?.message ?? "");
  const f = m.defaultFrame!;
  assert.ok(f, "made, and the default");
  assert.ok(dot(frameBasis(m, f)().uz!, viewAxes(view).toward) > 1 - 1e-12, "facing the viewer");
  assert.ok(near(worldToScreen(view, frameBasis(m, f)().origin), [400, 300], 1e-6), "at the middle of the view");
  assert.equal(m.circle(r.value as string).plane, f);
  assert.match(said.join("\n"), new RegExp(`^circ: no default frame, so ${f} was made at the view centre, facing you$`));
  const ops = m.journal.map((j) => j.op);
  assert.ok(ops.indexOf("setDefaultFrame") < ops.indexOf("addCircle"), "the frame is journalled first");
  assert.equal(undo.depth, 1, "one step");
  assert.equal(undo.undo(save(m, false)), empty, "and undoing it takes frame and circle together");
});

test("typed arc() does the same; headless the frame is the model's own seed, at the origin along x and y", async () => {
  await loadKernel();
  const m = new Model(3);
  const repl = new Repl(neocadScope({ model: m }));
  const r = await repl.eval("arc()");
  assert.equal(r.ok, true, r.error?.message ?? "");
  const f = m.defaultFrame!;
  const b = frameBasis(m, f)();
  assert.ok(near(b.origin, [0, 0, 0]) && near(b.uz!, [0, 0, 1]));
  assert.equal(m.arc(r.value as string).plane, f);
  assert.equal(m.solve().solved, true);
});

test("a typed circle that is refused makes no frame; one with a frame named, or a default, makes none either", async () => {
  await loadKernel();
  const m = new Model(3);
  const repl = new Repl(neocadScope({ model: m }));
  assert.equal((await repl.eval("circ(null, -2)")).ok, false);
  assert.equal((await repl.eval('arc("nope")')).ok, false);
  assert.equal((await repl.eval('arc(null, "p9", "p9")')).ok, false);
  assert.deepEqual(frames(m), [], "nothing made on the way to a refusal");
  assert.equal(m.entities.size, 0);
  await repl.eval("circ()");
  await repl.eval("circ()");
  assert.equal(frames(m).length, 1, "the second circle uses the first one's frame");
  // The model's own refusal still stands underneath, for anything that skips the command layer.
  assert.throws(() => new Model(3).addCircle(), /no default frame/);
});

test("typed fillet on a frameless corner makes a frame of the corner's points first — and refused, makes none", async () => {
  await loadKernel();
  const m = new Model(3);
  const { points, lines } = rectangle(m);
  const repl = new Repl(neocadScope({ model: m }));
  assert.equal((await repl.eval(`fillet("${lines[0]}", "${lines[1]}", 500)`)).ok, false);
  assert.deepEqual(frames(m), []);
  const r = await repl.eval(`fillet("${lines[0]}", "${lines[1]}", 5)`);
  assert.equal(r.ok, true, r.error?.message ?? "");
  const f = m.defaultFrame!;
  assert.deepEqual([m.frame(f).origin], [points[1]], "on the corner's own shared point");
  assert.ok(near(frameBasis(m, f)().uz!, [0, 0, 1]), "headless: up, for a corner drawn level");
  assert.equal(m.arc(r.value as string).plane, f);
  assert.equal(m.solve().solved, true);
  const file = save(m);
  assert.equal(save(open(file)), file, "and it replays to itself");
});
