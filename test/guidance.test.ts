// A miss is guidance, and what would work is lit.
//
// Every tool refusal about the click rather than the model now says, in one
// short line, what would work — logged with the "guide" outcome, which the host
// shows muted and in the header's note, never red — and leaves the tool armed.
// While a click-inside tool is armed, every region it could take is lit
// (`litRegions`); once the revolve tool has a profile, every axis it could turn
// about is (`revolveAxes`). Each sentence is pinned here word for word, since
// the words are the feature; the pixels are test/e2e/firstrun.e2e.ts's.

import { test } from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { ensureKernelLoaded } from "../src/kernel/problem.ts";
import { Model } from "../src/model.ts";
import { findLoops } from "../src/loops.ts";
import { hitTest } from "../src/picking.ts";
import { worldToScreen, type View } from "../src/view.ts";
import { edgeOn, litRegions, missedRegion, regionKey } from "../src/tools/region.ts";
import { ExtrudeTool } from "../src/tools/extrude.ts";
import { RevolveTool, revolveAxes } from "../src/tools/revolve.ts";
import { SketchTool } from "../src/tools/sketch.ts";
import { FilletTool } from "../src/tools/fillet.ts";
import { regionAtFor } from "./featurectx.ts";
import { Circle3Tool } from "./lockedtools.ts";
import { Arc3Tool } from "./lockedtools.ts";
import type { Pick } from "../src/picking.ts";
import type { ToolContext } from "../src/tools/tool.ts";
import { axisFrame } from "./frames.ts";

async function loadKernel() {
  const bytes = await readFile(new URL("../src/kernel/wasm-gen/neocad_kernel_bg.wasm", import.meta.url));
  await ensureKernelLoaded(bytes);
}

const ABOVE: View = { ox: 400, oy: 300, scale: 4 };

/** A tool's context answering regions and picks from `view`, recording every line with its outcome. */
function toolCtx(model: Model, view: View, options: Record<string, unknown> = {}) {
  const c = {
    model, options, finished: false, said: [] as { line: string; outcome?: string }[],
    pickResult: undefined as Pick | null | undefined,
    requestRender() {},
    requestSolve() { model.solve(); },
    finish() { c.finished = true; },
    regionAt: regionAtFor(model, view),
    pick: ([sx, sy]: [number, number]) => (c.pickResult !== undefined ? c.pickResult : hitTest(model, view, sx, sy)),
    log(line: string, outcome?: "refused" | "done" | "guide") { c.said.push({ line, outcome }); },
  };
  return c as ToolContext & typeof c;
}

const at = (w: number[]) => ({ world: w, screen: worldToScreen(ABOVE, w) });

/** A 60 × 50 rectangle with a circle inside it, flat on the kernel-aligned frame. */
function holed(): { m: Model; lines: string[]; hole: string } {
  const m = new Model(3);
  axisFrame(m);
  const pts = [[0, 0, 0], [60, 0, 0], [60, 50, 0], [0, 50, 0]].map((c) => m.addPoint(c).name);
  const lines = pts.map((p, i) => m.addLine(p, pts[(i + 1) % 4]).name);
  const hole = m.addCircle(m.addPoint([30, 25, 0]).name, 8).name;
  return { m, lines, hole };
}

// --- what is lit ------------------------------------------------------------------

test("the regions lit are every loop's region — the outline around its hole, and the hole on its own — less the one hovered", async () => {
  await loadKernel();
  const { m, hole } = holed();
  const loops = findLoops(m);
  assert.equal(loops.length, 2);
  const all = litRegions(loops, null);
  assert.equal(all.length, 2, "both");
  const outer = all.find((r) => !loops[r.index].members.some((x) => x.name === hole))!;
  assert.match(regionKey(outer), /\|/, "the outline's region carries its hole, so the hole stays clear in its fill");
  const rest = litRegions(loops, outer);
  assert.deepEqual(rest.map((r) => loops[r.index].members.map((x) => x.name)), [[hole]], "the hovered one is drawn brighter on its own");
  assert.deepEqual(litRegions([], null), [], "nothing closed, nothing lit");
});

test("a loop seen edge-on is not lit: its outline on screen is thinner than it is long", () => {
  assert.equal(edgeOn([[0, 0], [100, 0], [100, 100], [0, 100]]), false, "a square face-on");
  assert.equal(edgeOn([[0, 0], [100, 0], [100, 1], [0, 1]]), true, "a wall seen from above");
  assert.equal(edgeOn([[0, 0], [100, 0], [0, 0.01]]), true);
});

test("the axes lit for a revolve are exactly the ones it would turn about: in the plane, the profile to one side", async () => {
  await loadKernel();
  const m = new Model(3);
  axisFrame(m); // f, along the kernel's axes, at the origin
  const pts = [[10, 0, 0], [20, 0, 0], [20, 10, 0], [10, 10, 0]].map((c) => m.addPoint(c).name);
  const lines = pts.map((p, i) => m.addLine(p, pts[(i + 1) % 4]).name);
  const beside = m.addLine(m.addPoint([-5, -10, 0]).name, m.addPoint([-5, 30, 0]).name).name;
  const above = m.addLine(m.addPoint([0, 0, 5]).name, m.addPoint([0, 10, 5]).name).name;
  // A frame whose +y runs straight through the rectangle: a line there would
  // split the region (loops.ts), an arm only crosses it.
  const g = m.addFrame(m.addPoint([15, 5, 0]).name, m.addPoint([16, 5, 0]).name, m.addPoint([15, 6, 0]).name).name;
  const loops = findLoops(m);
  const index = loops.findIndex((l) => l.members.every((x) => lines.includes(x.name)));
  assert.ok(index >= 0);
  const axes = revolveAxes(m, { loops, index });
  for (const l of lines) assert.ok(axes.includes(l), `its own edge ${l}: ${axes}`);
  assert.ok(axes.includes(beside), "a line beside it in its plane");
  assert.ok(!axes.includes(above), "not a line off its plane");
  assert.ok(axes.includes("f.x") && axes.includes("f.y"), "the frame's two arms along its edges' lines");
  assert.ok(!axes.includes("f.z"), "not its normal");
  assert.ok(!axes.includes(`${g}.y`) && !axes.includes(`${g}.x`), "not an arm through it");
});

// --- what is said -----------------------------------------------------------------

test("extrude and sketch, a click on no region: guidance, the tool still armed — and, with nothing closed at all, what to do first", async () => {
  await loadKernel();
  const { m } = holed();
  for (const Tool of [ExtrudeTool, SketchTool]) {
    const ctx = toolCtx(m, ABOVE);
    const tool = new Tool(ctx);
    tool.onDown(at([90, 90, 0]));
    assert.deepEqual(ctx.said, [{ line: `${tool.name}: click inside a closed outline — the ones I can see are lit`, outcome: "guide" }]);
    assert.equal(ctx.finished, false, `${tool.name} stays armed`);
  }
  const bare = new Model(3);
  axisFrame(bare);
  const ctx = toolCtx(bare, ABOVE);
  new ExtrudeTool(ctx).onDown(at([0, 0, 0]));
  assert.deepEqual(ctx.said, [{ line: "extrude: no closed outline yet — draw one, then click inside it", outcome: "guide" }]);
  assert.equal(missedRegion(bare), "no closed outline yet — draw one, then click inside it");
  // Headless there is no one to guide, and a caller: it throws the same words.
  assert.throws(() => new ExtrudeTool({ ...toolCtx(m, ABOVE), log: undefined }).onDown(at([90, 90, 0])),
    /click inside a closed outline/);
});

test("revolve: a miss, then a profile, then a miss for the axis, then an axis it would not turn about — each guidance, the profile kept", async () => {
  await loadKernel();
  const { m } = holed();
  // Climbing out of the plane, so it neither splits the region nor is an axis for it.
  const across = m.addLine(m.addPoint([30, -10, 0]).name, m.addPoint([30, 60, 30]).name).name;
  const ctx = toolCtx(m, ABOVE);
  const tool = new RevolveTool(ctx);
  tool.onDown(at([90, 90, 0]));
  tool.onDown(at([5, 5, 0])); // inside the outline, outside the hole
  ctx.pickResult = null;
  tool.onDown(at([90, 90, 0]));
  ctx.pickResult = { name: across, kind: "line", distance: 0 };
  tool.onDown(at([30, 40, 0]));
  assert.deepEqual(ctx.said, [
    { line: "revolve: click inside a closed outline — the ones I can see are lit", outcome: "guide" },
    { line: "revolve: now click a line, or a frame's arm, to turn it about", outcome: "guide" },
    { line: `revolve: ${across} is not in its plane, or crosses it — click a lit one`, outcome: "guide" },
  ]);
  assert.equal(ctx.finished, false);
});

test("fillet: nothing, the wrong kind, the same line, lines that do not meet — each says what was clicked and what fillet wants", async () => {
  await loadKernel();
  const { m, lines, hole } = holed();
  const ctx = toolCtx(m, ABOVE);
  const tool = new FilletTool(ctx);
  const click = (pick: Pick | null) => { ctx.pickResult = pick; tool.onDown(at([0, 0, 0])); };
  click(null);
  click({ name: hole, kind: "circle", distance: 0 });
  click({ name: lines[0], kind: "line", distance: 0 });
  click(null);
  click({ name: lines[0], kind: "line", distance: 0 });
  click({ name: hole, kind: "circle", distance: 0 });
  click({ name: lines[2], kind: "line", distance: 0 });
  assert.deepEqual(ctx.said.map((s) => s.line), [
    "fillet: click a line — fillet wants two lines that share a corner",
    `fillet: ${hole} is a circle — fillet wants two lines that share a corner`,
    `fillet: now click a line that meets ${lines[0]}`,
    `fillet: that is ${lines[0]} again — click the line it shares a corner with`,
    `fillet: ${hole} is a circle — click a line that meets ${lines[0]}`,
    `fillet: ${lines[0]} and ${lines[2]} do not meet — fillet wants two lines that share a corner`,
  ]);
  assert.ok(ctx.said.every((s) => s.outcome === "guide"));
  click({ name: lines[1], kind: "line", distance: 0 });
  tool.confirm();
  assert.equal([...m.entities.values()].filter((e) => e.kind === "arc").length, 1,
    "and the first line was kept throughout: the corner rounds");
});

test("the 3-point tools, three clicks on one line: guidance, the first two kept", async () => {
  await loadKernel();
  for (const Tool of [Circle3Tool, Arc3Tool]) {
    const m = new Model(2);
    const ctx = toolCtx(m, ABOVE);
    const tool = new Tool(ctx);
    for (const x of [0, 10, 25]) tool.onDown({ world: [x, 0], screen: [0, 0] });
    assert.deepEqual(ctx.said, [{ line: `${tool.name}: those three are on one line — click the third off it`, outcome: "guide" }]);
    tool.onDown({ world: [5, 8], screen: [0, 0] });
    assert.equal(ctx.finished, true, `${tool.name}: the obvious next click works`);
  }
});
