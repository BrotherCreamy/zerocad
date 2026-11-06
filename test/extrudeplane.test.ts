// Extrude (and revolve) on a sketch no frame of the user's orients: no frame is
// made for it (docs/plans/frameless-curves.md).
//
// The owner's first run — a rectangle drawn in a fresh model, the extrude tool,
// a click inside — was once refused eight times with "lies in no frame's
// plane"; then the call made a frame of three of the loop's own points first.
// Every document has the origin now, and a loop drawn level lies in its plane,
// so it runs along the origin's +z. A loop parallel to no frame at all runs
// along its own plane, named by three of its points ("p1.p2.p4") facing the
// viewer — the points that frame was made of — and nothing is made.

import { test } from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { ensureKernelLoaded } from "../src/kernel/problem.ts";
import { Model } from "../src/model.ts";
import { frameBasis } from "../src/relations/refs.ts";
import { extrude, revolve } from "../src/operations.ts";
import { findLoops } from "../src/loops.ts";
import { open, save } from "../src/persist.ts";
import { neocadScope } from "../src/replenv.ts";
import { Repl } from "../src/repl.ts";
import { ExtrudeTool } from "../src/tools/extrude.ts";
import { featureHost, regionAtFor } from "./featurectx.ts";
import { RevolveTool } from "../src/tools/revolve.ts";
import type { Pick } from "../src/picking.ts";
import type { ToolContext } from "../src/tools/tool.ts";
import { alignView, viewAxes, worldToScreen, type View } from "../src/view.ts";
import { axisFrame } from "./frames.ts";
import { baseOf } from "./profiles.ts";

async function loadKernel() {
  const bytes = await readFile(new URL("../src/kernel/wasm-gen/neocad_kernel_bg.wasm", import.meta.url));
  await ensureKernelLoaded(bytes);
}

const sub = (a: number[], b: number[]) => a.map((x, i) => x - b[i]);
const near = (a: number[], b: number[], tol = 1e-9) => Math.hypot(...sub(a, b)) <= tol;
const frames = (m: Model) => [...m.entities.values()].filter((e) => e.kind === "frame").map((e) => e.name);

/** A rectangle of free points and lines, level at z = `z` — what the rectangle tool draws in a model with no frame. */
function rectangle(m: Model, x0 = 0, y0 = 0, w = 40, h = 30, z = 0): { points: string[]; lines: string[] } {
  const points = [[x0, y0], [x0 + w, y0], [x0 + w, y0 + h], [x0, y0 + h]].map(([x, y]) => m.addPoint([x, y, z]).name);
  const lines = points.map((p, i) => m.addLine(p, points[(i + 1) % 4]).name);
  return { points, lines };
}

/** Every point twin of `feature` sits at its base plus `along` — base and twin read off the depth dimension. */
function lidAlong(m: Model, feature: string, along: number[]): void {
  const f = m.featureOf(feature);
  for (const [twin, base] of baseOf(m, f.kind === "extrude" ? f.depth : f.angle)) {
    if (m.entities.get(base)?.kind !== "point") continue;
    assert.ok(near(sub(m.coords(twin), m.coords(base)), along, 1e-6), `${twin} is ${base} + ${along}: ${m.coords(twin)}`);
  }
}

/** A view of the z = 0 plane from +z (`side` 1) or from −z (`side` −1), square-on. */
function viewFromSide(side: 1 | -1): View {
  return alignView({ ox: 500, oy: 400, scale: 4 }, [side, 0, 0], [0, 1, 0], [20, 15, 0]);
}

// --- the command layer ---------------------------------------------------------

test("typed extrude on a frameless rectangle makes no frame: it runs along the origin's +z, journalled as its region and the call", async () => {
  await loadKernel();
  const m = new Model(3);
  const { lines } = rectangle(m);
  const repl = new Repl(neocadScope({ model: m }));
  const before = m.journal.length;
  const r = await repl.eval(`extrude("${lines[0]}", 12)`);
  assert.equal(r.ok, true, String(r.error?.message));
  assert.equal(r.value, "e1");
  assert.deepEqual(frames(m), [], "nothing makes a frame unless asked");
  assert.equal(m.defaultFrame, null);
  // The face's region, made on the way, then the feature on it — one line typed.
  assert.deepEqual(m.journal.slice(before).map((j) => j.op), ["region", "extrude"]);
  assert.deepEqual(m.journal.at(-2)!.args, [lines[0], "origin", lines]);
  assert.deepEqual(m.journal.at(-1)!.args, ["rg1", 12, "origin", [lines]]);
  assert.equal(m.solve().solved, true);
  lidAlong(m, "e1", [0, 0, 12]);
});

test("the file replays it: the same names, byte-identical, and the reopened drawing extrudes along the same plane", async () => {
  await loadKernel();
  const m = new Model(3);
  const { lines } = rectangle(m);
  await new Repl(neocadScope({ model: m })).eval(`extrude("${lines[0]}", 12)`);
  m.solve();
  const file = save(m);
  const back = open(file);
  assert.equal(save(back), file);
  assert.equal(back.featureOf("e1").frame, "origin");
  assert.equal(back.solve().solved, true);
  lidAlong(back, "e1", [0, 0, 12]);
});

test("a model whose default frame is not parallel keeps it, and the loop still runs along the origin's +z", async () => {
  await loadKernel();
  const m = new Model(3);
  const o = m.addPoint([100, 0, 0]).name, x = m.addPoint([101, 0, 0]).name, y = m.addPoint([100, 0, 1]).name;
  const g = m.addFrame(o, x, y).name;
  m.setDefaultFrame(g);
  const { lines } = rectangle(m);
  extrude(m, lines[0], 5);
  assert.equal(m.defaultFrame, g);
  assert.deepEqual(frames(m), [g]);
  assert.equal(m.featureOf("e1").frame, "origin");
});

test("a frame that orients the loop is used, as it always was", async () => {
  await loadKernel();
  const m = new Model(3);
  axisFrame(m, "g", [0, 0, 0]);
  const { lines } = rectangle(m);
  extrude(m, lines[0], 5);
  assert.equal(m.featureOf("e1").frame, "g");
});

test("the sign of a positive depth on a loop no frame orients: along its own normal headless, toward the viewer from either side", async () => {
  await loadKernel();
  // Standing up, tipped about x: parallel to no frame's plane, the origin's included.
  const standing = () => {
    const m = new Model(3);
    const c = Math.cos(0.4), s = Math.sin(0.4);
    const pts = [[0, 0], [40, 0], [40, 30], [0, 30]].map(([px, py]) => m.addPoint([px, py * c, py * s]).name);
    const lines = pts.map((p, i) => m.addLine(p, pts[(i + 1) % 4]).name);
    return { m, lines, n: [0, -s, c] };
  };
  // Headless: loops.ts's normal, the side whose largest component is positive.
  {
    const { m, lines, n } = standing();
    extrude(m, lines[0], 6);
    assert.equal(m.featureOf("e1").frame.split(".").length, 3, "three of its own points");
    assert.equal(m.solve().solved, true);
    lidAlong(m, "e1", n.map((v) => 6 * v));
  }
  // Typed in the app, seen from either side: toward whoever typed it.
  for (const side of [1, -1] as const) {
    const { m, lines, n } = standing();
    const view = alignView({ ox: 500, oy: 400, scale: 4 }, [side, 0, 0], [0, Math.cos(0.4), Math.sin(0.4)], [20, 0, 0]);
    const toward = viewAxes(view).toward;
    const r = await new Repl(neocadScope({ model: m, view })).eval(`extrude("${lines[0]}", 6)`);
    assert.equal(r.ok, true, String(r.error?.message));
    assert.deepEqual(frames(m), []);
    assert.equal(m.solve().solved, true);
    const way = Math.sign(n.reduce((s, v, i) => s + v * toward[i], 0));
    lidAlong(m, "e1", n.map((v) => 6 * way * v));
  }
});

test("typed revolve makes no frame: the loop is turned in its own plane, and an axis it would refuse makes nothing", async () => {
  await loadKernel();
  const m = new Model(3);
  const { lines } = rectangle(m, 10, 0, 10, 10);
  const axis = m.addLine(m.addPoint([0, 0, 0]).name, m.addPoint([0, 10, 0]).name).name;
  const off = m.addLine(m.addPoint([0, 0, 5]).name, m.addPoint([0, 10, 5]).name).name;
  const repl = new Repl(neocadScope({ model: m }));
  const before = m.journal.length;
  const bad = await repl.eval(`revolve("${lines[0]}", "${off}", 1)`);
  assert.equal(bad.ok, false);
  assert.equal(m.journal.length, before, "refused, and nothing made");
  const r = await repl.eval(`revolve("${lines[0]}", "${axis}", 1)`);
  assert.equal(r.ok, true, String(r.error?.message));
  assert.deepEqual(frames(m), []);
  assert.equal(m.featureOf("e1", "revolve").frame, "origin");
  assert.equal(m.featureOf("e1", "revolve").end, null, "and no end frame");
});

test("plane(a, b, c, { look: false }) makes the frame and the default without turning the view; plane(a, b, c) still turns it", async () => {
  await loadKernel();
  const m = new Model(3);
  const [a, b, c] = [[0, 0, 0], [1, 0, 1], [0, 1, 0]].map((p) => m.addPoint(p).name);
  const view: View = alignView({ ox: 500, oy: 400, scale: 4 }, [1, 0, 0], [0, 1, 0], [0, 0, 0]);
  const repl = new Repl(neocadScope({ model: m, view }));
  const seen = JSON.stringify(view);
  const r = await repl.eval(`plane("${a}", "${b}", "${c}", { look: false })`);
  assert.equal(r.ok, true, String(r.error?.message));
  assert.equal(m.defaultFrame, r.value);
  assert.equal(JSON.stringify(view), seen, "not turned");
  await repl.eval(`plane("${a}", "${b}", "${c}")`);
  assert.notEqual(JSON.stringify(view), seen, "the plain call looks at it, as ever");
  const bad = await repl.eval(`plane("${a}", "${b}", "${c}", false)`);
  assert.match(bad.error!.message, /\{ look: false \}/);
});

// --- the tools -----------------------------------------------------------------

/**
 * A tool's context with the engine's regionAt and pick answered from `view`,
 * and a feature's confirm typed into a real scope as the host types it
 * (`featureHost`): every line in order, one user action.
 */
function toolCtx(m: Model, view: View, options: Record<string, unknown> = {}) {
  const repl = new Repl(neocadScope({ model: m, view }));
  const host = featureHost(m, repl, view);
  const c = {
    model: m, options, finished: false, log: [] as string[], said: [] as string[], typed: host.typed,
    requestRender() {},
    requestSolve() { m.solve(); },
    finish() { c.finished = true; },
    regionAt: regionAtFor(m, view),
    pickResult: null as Pick | null,
    pick: () => c.pickResult,
    logLine(line: string, outcome?: "refused" | "done" | "guide") { (outcome === "done" ? c.said : c.log).push(line); },
    perform: host.perform,
    settled: () => host.settled(),
    host,
  };
  const ctx = { ...c, log: (line: string, outcome?: "refused" | "done" | "guide") => c.logLine(line, outcome) };
  return { ctx: ctx as unknown as ToolContext, c };
}

const info = (screen: [number, number]) => ({ world: [0, 0, 0], screen });

test("the extrude tool on a frameless rectangle, confirmed, types the extrude and nothing before it — one user action, no frame", async () => {
  await loadKernel();
  const m = new Model(3);
  rectangle(m);
  const view = viewFromSide(1);
  const seen = JSON.stringify(view);
  const { ctx, c } = toolCtx(m, view, { depth: 20 });
  const tool = new ExtrudeTool(ctx);
  tool.onDown(info(worldToScreen(view, [20, 15, 0])));
  assert.deepEqual(c.typed, [], "a click picks, and types nothing");
  assert.equal(tool.confirm(), true);
  await c.settled();
  assert.deepEqual(c.typed, ['extrude("l1", 20)'], "the extrude, typed, alone");
  assert.equal(c.host.performs, 1);
  assert.deepEqual(c.log, [], "nothing refused");
  assert.match(c.said.join("\n"), /^e1 {2}extrude of /, "the log says what it made");
  assert.deepEqual(frames(m), []);
  assert.equal(m.featureOf("e1").frame, "origin");
  assert.equal(m.solve().solved, true);
  lidAlong(m, "e1", [0, 0, 20]);
  assert.equal(JSON.stringify(view), seen, "the view did not turn");
});

test("seen from below, a frameless rectangle on the ground still runs along the origin's +z — a frame orients it, as one always did", async () => {
  await loadKernel();
  const m = new Model(3);
  rectangle(m);
  const view = viewFromSide(-1);
  const { ctx, c } = toolCtx(m, view, { depth: 6 });
  const tool = new ExtrudeTool(ctx);
  tool.onDown(info(worldToScreen(view, [20, 15, 0])));
  tool.confirm();
  await c.settled();
  assert.deepEqual(c.typed, ['extrude("l1", 6)']);
  assert.equal(m.solve().solved, true);
  lidAlong(m, "e1", [0, 0, 6]);
});

test("headless, with no command line, the extrude tool extrudes a frameless region by the operation's own call", async () => {
  await loadKernel();
  const m = new Model(3);
  rectangle(m);
  const view = viewFromSide(1);
  const { ctx } = toolCtx(m, view);
  const bare = { ...ctx, perform: undefined, log: undefined } as unknown as ToolContext;
  const tool = new ExtrudeTool(bare);
  tool.onDown(info(worldToScreen(view, [20, 15, 0])));
  tool.confirm();
  assert.equal(m.features.size, 1);
  assert.deepEqual(frames(m), []);
});

test("the revolve tool: a frameless region, then an axis, confirmed — the revolve typed alone; an axis it refuses is not picked", async () => {
  await loadKernel();
  const m = new Model(3);
  rectangle(m, 10, 0, 10, 10);
  const axis = m.addLine(m.addPoint([0, 0, 0]).name, m.addPoint([0, 10, 0]).name).name;
  const off = m.addLine(m.addPoint([0, 0, 5]).name, m.addPoint([0, 10, 5]).name).name;
  const view = viewFromSide(1);
  const { ctx, c } = toolCtx(m, view, { angle: Math.PI });
  const tool = new RevolveTool(ctx);
  tool.onDown(info(worldToScreen(view, [15, 5, 0])));
  assert.deepEqual(c.typed, []);

  c.pickResult = { kind: "line", name: off } as Pick;
  tool.onDown(info([0, 0]));
  assert.equal(tool.axis, null, "not picked");
  assert.equal(tool.confirm(), true, "a confirm then says what is missing");
  await c.settled();
  assert.deepEqual(c.typed, [], "and types nothing");
  assert.match(c.log[0], new RegExp(`^revolve: ${off} is not in its plane, or crosses it — click a lit one$`));

  c.pickResult = { kind: "line", name: axis } as Pick;
  tool.onDown(info([0, 0]));
  assert.equal(tool.axis, axis);
  tool.onDown(info([0, 0])); // the axis again: the quick path
  await c.settled();
  assert.deepEqual(c.typed, [`revolve("l1", "${axis}", ${Math.PI})`]);
  assert.match(c.said.join("\n"), /^e1 {2}revolve of /);
  assert.deepEqual(frames(m), []);
  assert.equal(m.featureOf("e1", "revolve").frame, "origin");
});
