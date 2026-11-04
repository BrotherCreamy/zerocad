// The curve tools and the typed curve commands make no frame
// (docs/plans/frameless-curves.md). The owner, twice: *"why when I create
// something, why does it first create a frame? … can I not just create a
// circle or whatever in space?"*
//
// A circle or arc carries its own normal. A tool's circle lies where the click
// is — on the plane being sketched on, else a solid's face under the cursor,
// else the origin's ground — and is held there by two ordinary relations it can
// see and delete: `onplane` on its centre and `par` on its normal. These used
// to type `plane(pt(…), null, null, { look: false })` first, in a fresh model,
// and a fillet a plane of its corner's points; nothing is typed now, and a
// fresh document drawn in gets one circle and nothing else.

import { test } from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { ensureKernelLoaded } from "../src/kernel/problem.ts";
import { Model } from "../src/model.ts";
import { extrude, del, set } from "../src/operations.ts";
import { open, save } from "../src/persist.ts";
import { neocadScope } from "../src/replenv.ts";
import { Repl } from "../src/repl.ts";
import { pointOnWorkingPlane } from "../src/workplane.ts";
import { orbitBy, screenToPlane, worldToScreen, type View } from "../src/view.ts";
import { CircleTool } from "../src/tools/circle.ts";
import { Circle3Tool } from "../src/tools/circle3.ts";
import { ArcTool } from "../src/tools/arc.ts";
import { Arc3Tool } from "../src/tools/arc3.ts";
import { FilletTool } from "../src/tools/fillet.ts";
import { featureHost, regionAtFor } from "./featurectx.ts";
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
const kinds = (m: Model) => [...m.entities.values()].map((e) => e.kind);
const relationsOf = (m: Model) => [...m.relations.values()].map((r) => [r.op, r.args]);

/** A view never turned, its middle at (400, 300) on screen, 2 px a unit. */
function flatView(): View {
  return { ox: 400, oy: 300, scale: 2 };
}

/**
 * A tool's context: a real command scope for `run` (which nothing should
 * call now), clicks read on the working plane through `view` as the engine
 * reads them, the region under a pixel as the engine finds it, and a pixel
 * read on any plane as the engine's `planeAt` does.
 */
function toolCtx(m: Model, view: View) {
  const repl = new Repl(neocadScope({ model: m, view, viewSize: () => [800, 600] }));
  const c = {
    model: m, options: {} as Record<string, unknown>, finished: false,
    log: [] as string[], typed: [] as string[],
    pickResult: null as Pick | null,
    requestRender() {},
    requestSolve() { m.solve(); },
    finish() { c.finished = true; },
    pick: () => c.pickResult,
    run(command: string) {
      c.typed.push(command);
      return repl.eval(command).then(() => {});
    },
    act(fn: () => void) { fn(); },
    regionAt: regionAtFor(m, view),
    planeAt: ([sx, sy]: [number, number], plane: { origin: number[]; u: number[]; v: number[] }) => screenToPlane(view, sx, sy, plane),
  };
  const host = featureHost(m, repl);
  const ctx = { ...c, log: (line: string) => { c.log.push(line); }, perform: host.perform };
  const at = (sx: number, sy: number): PointerInfo => {
    const { world, plane } = pointOnWorkingPlane(m, view, sx, sy);
    return { world, plane, screen: [sx, sy] };
  };
  return { ctx: ctx as unknown as ToolContext, c, at, repl, host };
}

// --- a fresh document --------------------------------------------------------------

test("the circle tool in a fresh document makes one circle and no frame — on the origin's ground, held by relations it can see", async () => {
  await loadKernel();
  const m = new Model(3);
  const view = flatView();
  const { ctx, c, at } = toolCtx(m, view);
  const tool = new CircleTool(ctx);
  tool.onDown(at(431, 287));
  tool.onMove(at(451, 287));
  tool.onUp(at(451, 287));
  assert.equal(c.finished, true);
  assert.deepEqual(c.typed, [], "nothing typed first");
  assert.deepEqual(c.log, [], "nothing refused");
  assert.deepEqual(kinds(m), ["point", "circle"], "one circle and its centre — no frame");
  assert.deepEqual(frames(m), []);
  const circle = [...m.entities.values()].find((e) => e.kind === "circle")!.name;
  const centre = m.circle(circle).center;
  assert.deepEqual(m.normalOf(circle), [0, 0, 1], "facing up, off the origin's x–y plane");
  assert.ok(Math.abs(m.coords(centre)[2]) < 1e-12, "its centre on the ground");
  assert.ok(Math.abs(m.radius(circle) - 10) < 1e-9, "20 px at 2 px a unit");
  assert.deepEqual(relationsOf(m), [["onPlane", [centre, "origin"]], ["parallel", [circle, "origin.z"]]],
    "its centre on the origin's plane and its normal par to the origin's +z");
  assert.equal(m.solve().solved, true);
  const file = save(m);
  assert.equal(save(open(file)), file, "and the file reopens to itself");
});

test("deleting a drawn circle's par lets it turn in space; constrained to a line instead, it follows the line", async () => {
  await loadKernel();
  const m = new Model(3);
  const { ctx, at } = toolCtx(m, flatView());
  const tool = new CircleTool(ctx);
  tool.onDown(at(400, 300));
  tool.onUp(at(420, 300));
  const circle = [...m.entities.values()].find((e) => e.kind === "circle")!.name;
  const par = [...m.relations.values()].find((r) => r.op === "parallel")!.name;
  del(m, par);
  // A line standing up through the centre, and the circle told to face along it.
  const s = neocadScope({ model: m }) as Record<string, (...a: unknown[]) => unknown>;
  const ends = [s.pt(0, 0, 0) as string, s.pt(0, 6, 8) as string];
  ends.forEach((p, i) => s.fix(p, [[0, 0, 0], [0, 6, 8]][i]));
  const axis = s.ln(...ends) as string;
  s.par(circle, axis);
  assert.equal(m.solve().solved, true);
  assert.ok(Math.abs(Math.abs(dot(m.normalOf(circle), [0, 0.6, 0.8])) - 1) < 1e-9, `facing along the line: ${m.normalOf(circle)}`);
});

test("in a turned view the clicks still land on the ground: the 3-point circle lies in the origin's plane, all three rim points and the centre", async () => {
  await loadKernel();
  const m = new Model(3);
  const view = orbitBy(flatView(), 0.5, -0.4);
  const { ctx, c, at } = toolCtx(m, view);
  const tool = new Circle3Tool(ctx);
  tool.onDown(at(380, 290));
  tool.onDown(at(430, 280));
  tool.onDown(at(410, 330));
  assert.deepEqual(c.typed, []);
  assert.deepEqual(frames(m), []);
  const circle = [...m.entities.values()].find((e) => e.kind === "circle")!.name;
  assert.equal(m.solve().solved, true);
  for (const p of [...m.entities.values()].filter((e) => e.kind === "point")) {
    assert.ok(Math.abs(m.coords(p.name)[2]) < 1e-9, `${p.name} on the ground`);
  }
  assert.deepEqual(m.normalOf(circle), [0, 0, 1]);
});

test("the centre-point arc and the 3-point arc make no frame either: each faces the ground and is held there", async () => {
  await loadKernel();
  for (const Tool of [ArcTool, Arc3Tool]) {
    const m = new Model(3);
    const { ctx, c, at } = toolCtx(m, flatView());
    const tool = new Tool(ctx);
    for (const [x, y] of [[400, 300], [440, 300], [400, 260]]) tool.onDown(at(x, y));
    assert.deepEqual(c.typed, [], Tool.name);
    assert.deepEqual(frames(m), [], Tool.name);
    const arc = [...m.entities.values()].find((e) => e.kind === "arc")!.name;
    assert.deepEqual(m.normalOf(arc), [0, 0, 1]);
    assert.ok(relationsOf(m).some(([op, args]) => op === "parallel" && JSON.stringify(args) === JSON.stringify([arc, "origin.z"])), Tool.name);
    assert.equal(m.solve().solved, true);
  }
});

test("headless, with no command line at all, the curve tools draw as they do in the app — there is nothing to type", async () => {
  await loadKernel();
  const m = new Model(3);
  const at = (x: number, y: number): PointerInfo => ({ world: [x, y, 0], screen: [0, 0] });
  const ctx = { model: m, options: {}, requestRender() {}, requestSolve() {}, finish() {} } as unknown as ToolContext;
  const tool = new CircleTool(ctx);
  tool.onDown(at(0, 0));
  tool.onUp(at(5, 0));
  assert.deepEqual(kinds(m), ["point", "circle"]);
});

// --- on a solid's face -------------------------------------------------------------

/** A 40 × 30 × 10 block extruded off the ground in a fresh document, seen from above. */
async function block() {
  const m = new Model(3);
  const s = neocadScope({ model: m }) as Record<string, (...a: unknown[]) => unknown>;
  const pts = [[0, 0], [40, 0], [40, 30], [0, 30]].map(([x, y]) => s.pt(x, y, 0) as string);
  const ls = pts.map((p, i) => s.ln(p, pts[(i + 1) % 4]) as string);
  const e = extrude(m, ls[0], 10);
  assert.equal(m.solve().solved, true);
  return { m, e };
}

test("a circle drawn over a solid's top face lies on the face — held to the face's own points, and following it", async () => {
  await loadKernel();
  const { m, e } = await block();
  const view = flatView();
  const { ctx, at } = toolCtx(m, view);
  const tool = new CircleTool(ctx);
  // Over the middle of the top, as seen from above.
  const [sx, sy] = worldToScreen(view, [20, 15, 10]);
  tool.onDown(at(sx, sy));
  tool.onUp(at(sx + 10, sy));
  assert.deepEqual(frames(m), [], "no frame for the face either");
  const circle = [...m.entities.values()].find((x) => x.kind === "circle")!.name;
  const centre = m.circle(circle).center;
  assert.ok(near(m.coords(centre), [20, 15, 10], 1e-6), `on the top, not the ground: ${m.coords(centre)}`);
  const held = [...m.relations.values()].filter((r) => r.args.includes(centre) || r.args.includes(circle));
  const face = held.find((r) => r.op === "onPlane")!.args[1] as string;
  assert.equal(face.split(".").length, 3, `held on three of the face's points: ${face}`);
  assert.ok(held.some((r) => r.op === "parallel" && r.args[1] === face), "its normal par to the face's");
  assert.ok(Math.abs(dot(m.normalOf(circle), [0, 0, 1]) - 1) < 1e-9, "facing out of the top");
  // Set the depth: the circle rides with the lid, wherever the solve puts it.
  set(m, `${m.featureOf(e, "extrude").depth}.value`, 25);
  assert.equal(m.solve().solved, true);
  const lidZ = m.coords(m.line(m.featureOf(e, "extrude").twins[0][0]).refs[0])[2];
  const baseZ = m.coords(m.line(m.featureOf(e, "extrude").loops[0][0] as string).refs[0])[2];
  assert.ok(Math.abs(lidZ - baseZ - 25) < 1e-6, "the depth holds");
  assert.ok(Math.abs(m.coords(centre)[2] - lidZ) < 1e-6, `followed the lid: ${m.coords(centre)} at ${lidZ}`);
});

test("a circle over a plain sketch region lies on the ground — only a solid's face is a place a click lands on", async () => {
  await loadKernel();
  const m = new Model(3);
  const s = neocadScope({ model: m }) as Record<string, (...a: unknown[]) => unknown>;
  const pts = [[0, 0], [40, 0], [40, 30], [0, 30]].map(([x, y]) => s.pt(x, y, 0) as string);
  pts.forEach((p, i) => s.ln(p, pts[(i + 1) % 4]));
  const view = flatView();
  const { ctx, at } = toolCtx(m, view);
  const tool = new CircleTool(ctx);
  const [sx, sy] = worldToScreen(view, [20, 15, 0]);
  tool.onDown(at(sx, sy));
  tool.onUp(at(sx + 10, sy));
  assert.ok(relationsOf(m).some(([op, args]) => op === "onPlane" && (args as unknown[])[1] === "origin"));
});

test("with the work plane set to a face, every click lands on it — what sketch on face is for", async () => {
  await loadKernel();
  const { m, e } = await block();
  const f = m.featureOf(e, "extrude");
  // The lid's own corners, as sketch on face would name them.
  const [a, b] = m.line(f.twins[0][0]).refs;
  const d = m.line(f.twins[0][3]).refs[0];
  m.setWorkPlane(`${a}.${b}.${d}`);
  const view = orbitBy(flatView(), 0.3, 0.2);
  const { ctx, at } = toolCtx(m, view);
  const tool = new CircleTool(ctx);
  tool.onDown(at(400, 300));
  tool.onUp(at(420, 300));
  const circle = [...m.entities.values()].find((x) => x.kind === "circle")!.name;
  assert.ok(Math.abs(m.coords(m.circle(circle).center)[2] - 10) < 1e-6, "on the lid's plane");
  assert.ok(relationsOf(m).some(([op, args]) => op === "parallel" && (args as unknown[])[1] === `${a}.${b}.${d}`));
});

// --- the fillet --------------------------------------------------------------------

test("the fillet tool on a frameless corner types the fillet and nothing before it — no frame", async () => {
  await loadKernel();
  const m = new Model(3);
  const s = neocadScope({ model: m }) as Record<string, (...a: unknown[]) => unknown>;
  const k = s.pt(0, 0, 0) as string;
  const l1 = s.ln(s.pt(30, 0, 0), k) as string;
  const l2 = s.ln(k, s.pt(0, 30, 0)) as string;
  const { ctx, host } = toolCtx(m, flatView());
  const tool = new FilletTool(ctx);
  (tool as unknown as { lines: string[] }).lines = [l1, l2];
  (tool as unknown as { confirm(): void }).confirm();
  await host.settled();
  assert.deepEqual(host.typed, [`fillet("${l1}", "${l2}", 10)`]);
  assert.deepEqual(frames(m), []);
  const arc = [...m.entities.values()].find((x) => x.kind === "arc")!.name;
  assert.ok(Math.abs(Math.abs(m.normalOf(arc)[2]) - 1) < 1e-12, "facing its corner's plane");
});

// --- typed ---------------------------------------------------------------------------

test("typed circ() and arc() make no frame and hold nothing — free, facing the drawing plane; a plane named holds them to it", async () => {
  await loadKernel();
  const m = new Model(3);
  const repl = new Repl(neocadScope({ model: m }));
  assert.equal((await repl.eval("circ()")).ok, true);
  assert.equal((await repl.eval("arc()")).ok, true);
  assert.deepEqual(frames(m), []);
  assert.equal(m.relations.size, 0, "an argument is never a constraint, and none was given");
  assert.deepEqual(m.journal.map((j) => j.op), ["addCircle", "addArc"], "one entry each");
  // A plane named: seeded facing it, and held by a par.
  const r = await repl.eval('circ(null, 3, "origin")');
  assert.equal(r.ok, true);
  assert.deepEqual(relationsOf(m), [["parallel", [r.value, "origin.z"]]]);
  // Three numbers are a seed and nothing more.
  const t = await repl.eval("circ(null, 3, [0, 1, 0])");
  assert.deepEqual(m.normalOf(t.value as string), [0, 1, 0]);
  assert.equal(m.relations.size, 1);
});

test("typed fillet on a frameless corner makes no frame: one entry, the call", async () => {
  await loadKernel();
  const m = new Model(3);
  const repl = new Repl(neocadScope({ model: m }));
  await repl.eval("k = pt(0, 0, 0); l1 = ln(pt(30, 0, 0), k); l2 = ln(k, pt(0, 30, 0))");
  const before = m.journal.length;
  assert.equal((await repl.eval('fillet("l1", "l2", 5)')).ok, true);
  assert.deepEqual(m.journal.slice(before).map((j) => [j.op, j.args]), [["fillet", ["l1", "l2", 5]]]);
  assert.deepEqual(frames(m), []);
});
