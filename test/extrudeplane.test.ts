// Extrude (and revolve) on a sketch no frame orients: the call makes the
// frame first, from three of the loop's own points, and carries on.
//
// The owner's first run — a rectangle drawn in a fresh model, the extrude tool,
// a click inside — was refused eight times with "lies in no frame's plane". A
// frame on the loop's own plane, from its own points, is not a datum nobody
// chose: it is what "Sketch on this face" makes. So the command layer
// (`extrude`/`revolve` typed) makes it as its own journalled call before the
// operation, and the tools type `plane(a, b, c, { look: false })` (or
// `frame(a, b, c)`, when there is a default already) before theirs.
// `operations.ts`'s `extrude` still refuses a frameless loop: that refusal is
// now the guard that the layer above did its job, and is tested to still
// stand.
//
// Closed forms throughout: the rectangle is level at z = 0, so its own plane's
// +z is the kernel's +z (headless, by loops.ts's normal) or the viewer's side
// (with a view), and every twin is checked at its base plus the depth along it.

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
import { featurePlaneCommand, sketchFrameFor } from "../src/sketchface.ts";
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

test("typed extrude on a frameless rectangle makes a frame of three of its points, sets it the default, and extrudes along its +z — journalled as addFrame, setDefaultFrame, extrude", async () => {
  await loadKernel();
  const m = new Model(3);
  const { lines } = rectangle(m);
  const [loop] = findLoops(m);
  assert.equal(loop.plane.frame, null, "no frame orients it");
  // The operation itself still refuses: the guard the layer above is held to.
  assert.throws(() => extrude(m, lines[0], 20), /lies in no frame's plane, and no frame is parallel to it/);

  const expected = sketchFrameFor(m, loop, loop.plane.normal);
  const before = m.journal.length;
  const repl = new Repl(neocadScope({ model: m }));
  const r = await repl.eval(`extrude("${lines[0]}", 20)`);
  assert.equal(r.ok, true, String(r.error?.message));
  assert.equal(r.value, "e1");

  const [f1] = frames(m).filter((f) => f !== m.featureOf("e1", "extrude").top);
  assert.equal(m.defaultFrame, f1, "made the default: there was none");
  const fr = m.frame(f1);
  assert.deepEqual([fr.origin, fr.xref, fr.yref], expected, "sketchFrameFor's three points — a corner and its neighbours");
  assert.ok(near(frameBasis(m, f1)().uz!, [0, 0, 1]), "headless, +z is the loop's own normal: up for a level sketch");
  assert.equal(m.featureOf("e1", "extrude").frame, f1);

  const entries = m.journal.slice(before);
  assert.deepEqual(entries.map((j) => j.op), ["addFrame", "setDefaultFrame", "extrude"]);
  assert.deepEqual(entries[0].args, [...expected, f1]);
  assert.equal(entries[2].args[2], f1, "the extrude entry names the frame made before it");

  assert.equal(m.solve().solved, true);
  lidAlong(m, "e1", [0, 0, 20]);
});

test("the file replays it: the same names, byte-identical, and the reopened drawing extrudes along the same frame", async () => {
  await loadKernel();
  const m = new Model(3);
  const { lines } = rectangle(m);
  const repl = new Repl(neocadScope({ model: m }));
  assert.equal((await repl.eval(`extrude("${lines[0]}", 12)`)).value, "e1");
  const file = save(m);
  const back = open(file);
  assert.equal(save(back), file, "byte-identical double save");
  assert.equal(back.defaultFrame, m.defaultFrame);
  assert.equal(back.featureOf("e1", "extrude").frame, m.featureOf("e1", "extrude").frame);
  assert.deepEqual(frames(back), frames(m));
  assert.equal(back.solve().solved, true);
  lidAlong(back, "e1", [0, 0, 12]);
});

test("a model whose default frame is merely not parallel keeps its default: the new frame is only the sketch's", async () => {
  await loadKernel();
  const m = new Model(3);
  // A default standing on its side: its +z is the kernel's −y, nowhere near the sketch's normal.
  const o = m.addPoint([100, 0, 0], "g_o").name, x = m.addPoint([101, 0, 0], "g_x").name, y = m.addPoint([100, 0, 1], "g_y").name;
  m.addFrame(o, x, y, "g");
  m.setDefaultFrame("g");
  const { lines } = rectangle(m);
  const before = m.journal.length;
  const repl = new Repl(neocadScope({ model: m }));
  const r = await repl.eval(`extrude("${lines[0]}", 5)`);
  assert.equal(r.ok, true, String(r.error?.message));
  assert.equal(m.defaultFrame, "g", "the default stays");
  assert.deepEqual(m.journal.slice(before).map((j) => j.op), ["addFrame", "extrude"], "no setDefaultFrame");
  const made = m.journal[before].args[3] as string;
  assert.equal(m.featureOf("e1", "extrude").frame, made);
  assert.equal(m.solve().solved, true);
  lidAlong(m, "e1", [0, 0, 5]);
});

test("a frame that already orients the loop is used, and nothing is made", async () => {
  await loadKernel();
  const m = new Model(3);
  axisFrame(m, "g", [100, 100, 50]); // parallel, off the sketch's plane: enough, as before
  const { lines } = rectangle(m);
  const before = m.journal.length;
  const repl = new Repl(neocadScope({ model: m }));
  assert.equal((await repl.eval(`extrude("${lines[0]}", 5)`)).value, "e1");
  assert.deepEqual(m.journal.slice(before).map((j) => j.op), ["extrude"]);
  assert.equal(m.featureOf("e1", "extrude").frame, "g");
});

test("the sign of a positive depth: along the loop's normal headless, and toward the viewer from either side in the app", async () => {
  await loadKernel();
  // Headless, a sketch standing upright in the x–z plane: loops.ts's normal is
  // the one whose largest component is positive, +y — and so is the lid.
  const up = new Model(3);
  const pts = [[0, 0, 0], [10, 0, 0], [10, 0, 10], [0, 0, 10]].map((c) => up.addPoint(c).name);
  const ls = pts.map((p, i) => up.addLine(p, pts[(i + 1) % 4]).name);
  assert.equal((await new Repl(neocadScope({ model: up })).eval(`extrude("${ls[0]}", 3)`)).value, "e1");
  assert.equal(up.solve().solved, true);
  lidAlong(up, "e1", [0, 3, 0]);

  for (const side of [1, -1] as const) {
    const m = new Model(3);
    const { lines } = rectangle(m);
    const view = viewFromSide(side);
    assert.ok(near(viewAxes(view).toward, [0, 0, side]));
    const seen = JSON.stringify(view);
    const r = await new Repl(neocadScope({ model: m, view })).eval(`extrude("${lines[0]}", 7)`);
    assert.equal(r.ok, true, String(r.error?.message));
    assert.equal(m.solve().solved, true);
    lidAlong(m, "e1", [0, 0, 7 * side]);
    assert.equal(JSON.stringify(view), seen, "the view did not turn");
  }
});

test("a typed extrude that would be refused makes nothing: a zero depth, a member in no loop", async () => {
  await loadKernel();
  const m = new Model(3);
  const { lines } = rectangle(m);
  const loose = m.addLine(m.addPoint([0, 50, 0]).name, m.addPoint([10, 50, 0]).name).name;
  const before = m.journal.length;
  const repl = new Repl(neocadScope({ model: m }));
  const zero = await repl.eval(`extrude("${lines[0]}", 0)`);
  assert.equal(zero.ok, false);
  assert.match(zero.error!.message, /non-zero depth/);
  const none = await repl.eval(`extrude("${loose}", 5)`);
  assert.match(none.error!.message, /is in no closed loop/);
  assert.equal(m.journal.length, before, "no frame left behind");
  assert.deepEqual(frames(m), []);
});

test("typed revolve likewise: a frame on the loop's points, the default, then the revolve — and an axis it would refuse makes nothing", async () => {
  await loadKernel();
  const m = new Model(3);
  const { lines } = rectangle(m, 10, 0, 10, 10);
  const axis = m.addLine(m.addPoint([0, 0, 0]).name, m.addPoint([0, 10, 0]).name).name;
  const off = m.addLine(m.addPoint([0, 0, 5]).name, m.addPoint([0, 10, 5]).name).name;
  const repl = new Repl(neocadScope({ model: m }));

  // Refused on the geometry — the axis off the profile's plane — before any frame is made.
  const before = m.journal.length;
  const bad = await repl.eval(`revolve("${lines[0]}", "${off}", 1)`);
  assert.equal(bad.ok, false);
  assert.match(bad.error!.message, /runs 5 off the plane of the profile/);
  assert.equal(m.journal.length, before);
  assert.deepEqual(frames(m), []);

  const r = await repl.eval(`revolve("${lines[0]}", "${axis}", Math.PI / 2)`);
  assert.equal(r.ok, true, String(r.error?.message));
  assert.equal(r.value, "e1");
  const entries = m.journal.slice(before);
  assert.deepEqual(entries.map((j) => j.op), ["addFrame", "setDefaultFrame", "revolve"]);
  const made = entries[0].args[3] as string;
  assert.equal(m.defaultFrame, made);
  assert.equal(m.featureOf("e1", "revolve").frame, made);
  const file = save(m);
  assert.equal(save(open(file)), file);
});

// --- plane's option ------------------------------------------------------------

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

test("the extrude tool on a frameless rectangle, confirmed, types plane(a, b, c, { look: false }), then the extrude along it — one user action, the view unturned", async () => {
  await loadKernel();
  const m = new Model(3);
  rectangle(m);
  const view = viewFromSide(1);
  const seen = JSON.stringify(view);
  const { ctx, c } = toolCtx(m, view, { depth: 20 });
  const [loop] = findLoops(m);
  const command = featurePlaneCommand(m, loop, viewAxes(view).toward);
  assert.match(command, /^plane\("p\d+", "p\d+", "p\d+", \{ look: false \}\)$/);

  const tool = new ExtrudeTool(ctx);
  tool.onDown(info(worldToScreen(view, [20, 15, 0])));
  assert.deepEqual(c.typed, [], "a click picks, and types nothing");
  assert.equal(tool.confirm(), true);
  await c.settled();
  assert.deepEqual(c.typed, [command, 'extrude("l1", 20)'], "the plane, then the extrude, typed");
  assert.equal(c.host.performs, 1, "as one user action");
  assert.equal(c.finished, false, "the tool stays armed");
  assert.deepEqual(c.log, [], "nothing refused");
  assert.match(c.said.join("\n"), /^e1 {2}extrude of /, "the log says what it made");
  const f = m.featureOf("e1", "extrude");
  assert.equal(f.frame, m.defaultFrame);
  assert.ok(near(frameBasis(m, f.frame)().uz!, [0, 0, 1]), "+z toward the viewer");
  assert.equal(m.solve().solved, true);
  lidAlong(m, "e1", [0, 0, 20]);
  assert.equal(JSON.stringify(view), seen, "the view did not turn");
  assert.deepEqual(m.journal.slice(-3).map((j) => j.op), ["addFrame", "setDefaultFrame", "extrude"]);
});

test("with a default frame that is not parallel, the tool types frame(a, b, c) and leaves the default alone; seen from below, a positive depth comes toward the viewer", async () => {
  await loadKernel();
  const m = new Model(3);
  const o = m.addPoint([100, 0, 0]).name, x = m.addPoint([101, 0, 0]).name, y = m.addPoint([100, 0, 1]).name;
  const g = m.addFrame(o, x, y).name;
  m.setDefaultFrame(g);
  rectangle(m);
  const view = viewFromSide(-1);
  const { ctx, c } = toolCtx(m, view, { depth: 6 });
  const tool = new ExtrudeTool(ctx);
  tool.onDown(info(worldToScreen(view, [20, 15, 0])));
  tool.confirm();
  await c.settled();
  assert.equal(c.typed.length, 2);
  assert.match(c.typed[0], /^frame\("p\d+", "p\d+", "p\d+"\)$/);
  assert.match(c.typed[1], /^extrude\("l\d+", 6\)$/);
  assert.equal(m.defaultFrame, g);
  assert.equal(m.solve().solved, true);
  lidAlong(m, "e1", [0, 0, -6]);
});

test("headless, with no command line, the extrude tool refuses a frameless region exactly as before — the operation's guard", async () => {
  await loadKernel();
  const m = new Model(3);
  rectangle(m);
  const view = viewFromSide(1);
  const { ctx } = toolCtx(m, view);
  const bare = { ...ctx, perform: undefined, log: undefined } as unknown as ToolContext;
  const before = m.journal.length;
  const tool = new ExtrudeTool(bare);
  tool.onDown(info(worldToScreen(view, [20, 15, 0])));
  assert.throws(() => tool.confirm(), /lies in no frame's plane/);
  assert.equal(m.journal.length, before);
});

test("the revolve tool: a frameless region, then an axis, confirmed — the plane typed, then the revolve; an axis it refuses is not picked", async () => {
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
  // Not one of the axes it lit: said short, as guidance (guidance.test.ts).
  assert.match(c.log[0], new RegExp(`^revolve: ${off} is not in its plane, or crosses it — click a lit one$`));
  assert.deepEqual(frames(m), []);

  c.pickResult = { kind: "line", name: axis } as Pick;
  tool.onDown(info([0, 0]));
  assert.equal(tool.axis, axis);
  tool.onDown(info([0, 0])); // the axis again: the quick path
  await c.settled();
  assert.equal(c.typed.length, 2);
  assert.match(c.typed[0], /^plane\(.*\{ look: false \}\)$/);
  assert.equal(c.typed[1], `revolve("l1", "${axis}", ${Math.PI})`);
  assert.match(c.said.join("\n"), /^e1 {2}revolve of /);
  assert.equal(m.featureOf("e1", "revolve").frame, m.defaultFrame);
});
