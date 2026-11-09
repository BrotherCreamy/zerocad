// Mode feedback (docs/plans/mode-feedback.md; the owner: "it isnt obvious to me
// that is whats happening. needs clearer visual/contextual feedback to the
// user"): the plane being sketched on, found and named; the chip's three parts
// for each state; each tool's next step at each stage; Done typing
// `workplane(null)`, which journals and replays; and the focus rule, which
// chooses by the relation that holds a thing on the plane. What the browser
// shows of it is test/e2e/modefeedback.e2e.ts's.

import { test } from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { ensureKernelLoaded } from "../src/kernel/problem.ts";
import { Model } from "../src/model.ts";
import { open, save } from "../src/persist.ts";
import { Repl } from "../src/repl.ts";
import { neocadScope } from "../src/replenv.ts";
import { activePlane, focusOf, niceStep, outOfFocusInk, planePatch, sideName, GRID_PX, OUT_OF_FOCUS_KEEP } from "../src/activeplane.ts";
import { chipParts, chipText, doneCommand, guideText, planeMenu } from "../src/modechip.ts";
import { engineNext, press, type PointerInfo, type Tool, type ToolContext } from "../src/tools/tool.ts";
import { RectangleTool } from "../src/tools/rectangle.ts";
import { LineTool } from "../src/tools/line.ts";
import { CircleTool } from "../src/tools/circle.ts";
import { ArcTool } from "../src/tools/arc.ts";
import { PolygonTool } from "../src/tools/polygon.ts";
import { SlotTool } from "../src/tools/slot.ts";
import { EllipseTool } from "../src/tools/ellipse.ts";
import { PointTool } from "../src/tools/point.ts";
import { FilletTool } from "../src/tools/fillet.ts";
import { DimensionTool } from "../src/tools/dimension.ts";
import { ConstrainTool } from "../src/tools/constrain.ts";
import { ExtrudeTool } from "../src/tools/extrude.ts";
import { SketchTool } from "../src/tools/sketch.ts";
import { worldToScreen, type View } from "../src/view.ts";
import { hitTest } from "../src/picking.ts";
import { regionAtFor } from "./featurectx.ts";

async function loadKernel() {
  await ensureKernelLoaded(await readFile(new URL("../src/kernel/wasm-gen/neocad_kernel_bg.wasm", import.meta.url)));
}

const VIEW: View = { ox: 400, oy: 300, scale: 4 };

/** A model and its command line. */
async function drawn(...lines: string[]): Promise<{ m: Model; run: (line: string) => Promise<unknown> }> {
  await loadKernel();
  const m = new Model(3);
  const repl = new Repl(neocadScope({ model: m }));
  const run = async (line: string) => {
    const r = await repl.eval(line);
    assert.equal(r.ok, true, `${line}: ${r.error?.message}`);
    return r.value;
  };
  for (const l of lines) await run(l);
  m.solve();
  return { m, run };
}

/** An 80 × 50 plate 20 deep, from the origin's ground: its lid's corners are p5…p8, the twins of p1…p4. */
const PLATE = [
  "pt(-40,-25,0); pt(40,-25,0); pt(40,25,0); pt(-40,25,0)",
  'ln("p1","p2"); ln("p2","p3"); ln("p3","p4"); ln("p4","p1")',
  'extrude("l1", 20)',
];

// --- the plane: which, named --------------------------------------------------

test("no plane chosen: nothing is drawn, nothing named, nothing dimmed — the ground is not a mode", async () => {
  const { m } = await drawn(...PLATE);
  assert.equal(activePlane(m, 4), null);
  assert.equal(focusOf(m, null), null);
  assert.equal(chipParts(null, "select", "x", null).where, null);
});

test("a plane on the lid's corners is e1's top: the lid's outline to tint, its feature and side", async () => {
  const { m } = await drawn(...PLATE, 'workplane("p5.p6.p8")');
  const p = activePlane(m, 4)!;
  assert.equal(p.kind, "face");
  assert.equal(p.label, "e1's top");
  assert.equal(p.feature, "e1");
  assert.equal(p.side, "top");
  assert.ok(p.outlines && p.outlines[0].every((q) => Math.abs(q[2] - 20) < 1e-6), "the outline is the lid's, at z = 20");
  assert.deepEqual(p.n.map((c) => Math.round(c)), [0, 0, 1], "out of the solid");
});

test("the base is e1's bottom, a wall e1's side", async () => {
  const bottom = await drawn(...PLATE, 'workplane("p1.p4.p2")');
  assert.equal(activePlane(bottom.m, 4)!.label, "e1's bottom");
  // A wall: p1, p2 and p2's twin p6.
  const side = await drawn(...PLATE, 'workplane("p2.p1.p6")');
  const s = activePlane(side.m, 4)!;
  assert.equal(s.kind, "face");
  assert.equal(s.label, "e1's side");
});

test("a revolve's caps are its start and end; an extrude's its bottom and top", () => {
  assert.equal(sideName({ kind: "revolve" }, "base"), "start");
  assert.equal(sideName({ kind: "revolve" }, "end"), "end");
  assert.equal(sideName({ kind: "extrude" }, "lid"), "top");
  assert.equal(sideName({ kind: "extrude" }, "wall"), "side");
});

test("a round face is matched by its rim: a cylinder's top is e1's top", async () => {
  const { m, run } = await drawn("circ(pt(0,0,0), 15)");
  await run('extrude("c1", 10)');
  const rim = [...m.entities.values()].find((e) => e.kind === "circle" && e.name !== "c1")!;
  await run(`workplane(${JSON.stringify(rim.name)})`);
  const p = activePlane(m, 4)!;
  assert.equal(p.label, "e1's top");
});

test("a plain loop, no solid yet, is tinted as the loop and named by its members", async () => {
  const { m } = await drawn(PLATE[0], PLATE[1], 'workplane("p1.p2.p4")');
  const p = activePlane(m, 4)!;
  assert.equal(p.kind, "loop");
  assert.match(p.label, /^loop l\d,l\d,l\d…$/);
  assert.equal(p.outlines!.length, 1);
});

test("a frame's plane is named by the frame, and drawn as a patch", async () => {
  const { m } = await drawn("frame()", 'setDefaultFrame("f1")');
  const p = activePlane(m, 4)!;
  assert.equal(p.kind, "frame");
  assert.equal(p.label, "f1");
  assert.equal(p.outlines, null);
});

test("a default frame alone is named, not drawn: the tint, the patch and the focus follow the work plane", async () => {
  const { m, run } = await drawn("frame()", 'setDefaultFrame("f1")', "pt(5, 5, 0)");
  assert.equal(activePlane(m, 4)!.label, "f1", "named, for the chip");
  assert.equal(activePlane(m, 4, m.workPlane), null, "and not drawn: what main.ts draws is the work plane");
  assert.equal(focusOf(m, activePlane(m, 4, m.workPlane)), null, "so nothing typed under it is dimmed");
  await run('workplane("f1", { look: false })');
  const p = activePlane(m, 4, m.workPlane)!;
  assert.equal(p.kind, "frame", "a frame made the work plane is drawn, as a patch");
});

test("a plane whose named point is deleted is no plane: the deletion cleared it", async () => {
  const { m, run } = await drawn(PLATE[0], PLATE[1], 'workplane("p1.p2.p4")');
  await run('del("p4")');
  assert.equal(m.workPlane, null);
  assert.equal(activePlane(m, 4), null);
});

// --- the patch ------------------------------------------------------------------

test("the patch's grid follows the zoom: its step is the first 1·2·5×10ⁿ that is GRID_PX on screen", () => {
  const plane = { origin: [0, 0, 0], u: [1, 0, 0], v: [0, 1, 0] };
  assert.equal(niceStep(3.2), 5);
  assert.equal(niceStep(2), 2);
  assert.equal(niceStep(0.07), 0.1);
  for (const scale of [0.5, 1, 4, 16]) {
    const p = planePatch(plane, [], scale);
    assert.ok(p.step * scale >= GRID_PX - 1e-9, `${scale}: ${p.step} is at least ${GRID_PX} px`);
    assert.ok(p.step * scale < GRID_PX * 2.5 + 1e-9, `${scale}: and the next step down would not be`);
  }
  assert.ok(planePatch(plane, [], 1).step > planePatch(plane, [], 4).step, "zoomed in, the grid is finer in the world");
});

test("the patch is sized to what is on the plane, and at least three steps from its origin each way", () => {
  const plane = { origin: [0, 0, 0], u: [1, 0, 0], v: [0, 1, 0] };
  const empty = planePatch(plane, [], 1);
  const [a, , c] = empty.corners;
  assert.ok(a[0] <= -3 * empty.step && c[0] >= 3 * empty.step);
  const wide = planePatch(plane, [[500, 0, 0], [-20, 300, 0]], 1);
  assert.ok(wide.corners[2][0] >= 500 && wide.corners[2][1] >= 300, "it reaches past the drawing");
  assert.ok(wide.lines.length > 0 && wide.lines.length <= 80, "a grid, never a lattice to count");
});

// --- focus --------------------------------------------------------------------

test("focus chooses by the relation that holds a thing on the plane, never by where it lies", async () => {
  const { m, run } = await drawn(...PLATE, 'workplane("p5.p6.p8")');
  // Held: a point onplane'd to the lid. Merely there: one at z = 20 with no relation.
  const held = (await run("pt(0, 0, 20)")) as string;
  await run(`onplane(${JSON.stringify(held)}, "p5.p6.p8")`);
  const loose = (await run("pt(10, 0, 20)")) as string;
  const ground = (await run("pt(0, 60, 0)")) as string;
  const f = focusOf(m, activePlane(m, 4))!;
  assert.ok(f.has(held), "held on the plane: in focus");
  assert.ok(!f.has(loose), "on the plane by position only: out of focus");
  assert.ok(!f.has(ground), "elsewhere: out of focus");
  for (const n of ["p5", "p6", "p8"]) assert.ok(f.has(n), `${n}, which the plane is made of`);
  for (const n of m.features.get("e1")!.owns.filter((x) => m.entities.has(x))) assert.ok(f.has(n), `${n}: the solid the face belongs to`);
  for (const n of ["l1", "p1"]) assert.ok(f.has(n), `${n}: its profile`);
});

test("a line is in focus when both its ends are; a circle when its centre is, or a par holds it to the plane", async () => {
  const { m, run } = await drawn(...PLATE, 'workplane("p5.p6.p8")');
  const a = (await run("pt(-5, -5, 20)")) as string;
  const b = (await run("pt(5, 5, 20)")) as string;
  await run(`onplane(${JSON.stringify(a)}, "p5.p6.p8")`);
  const half = (await run(`ln(${JSON.stringify(a)}, pt(9, 9, 40))`)) as string;
  await run(`onplane(${JSON.stringify(b)}, "p5.p6.p8")`);
  const whole = (await run(`ln(${JSON.stringify(a)}, ${JSON.stringify(b)})`)) as string;
  const free = (await run("circ(pt(0, 0, 50), 3)")) as string;
  await run(`par(${JSON.stringify(free)}, "p5.p6.p8")`);
  const f = focusOf(m, activePlane(m, 4))!;
  assert.ok(f.has(whole));
  assert.ok(!f.has(half), "one end off the plane");
  assert.ok(f.has(free), "held parallel to the plane by its par");
});

test("the out-of-focus ink is one step dimmed: the colour taken toward the canvas's ground, its hue kept", () => {
  assert.equal(outOfFocusInk("#afc6d9"), "#" + [0xaf, 0xc6, 0xd9].map((c, i) =>
    Math.round(OUT_OF_FOCUS_KEEP * c + (1 - OUT_OF_FOCUS_KEEP) * [0x0a, 0x0e, 0x13][i]).toString(16).padStart(2, "0")).join(""));
  const blue = outOfFocusInk("#5aa2ff");
  assert.ok(parseInt(blue.slice(5, 7), 16) > parseInt(blue.slice(1, 3), 16), "a free line out of focus is still blue");
  assert.equal(outOfFocusInk("rgb(1, 2, 3)"), "rgb(1, 2, 3)", "what it cannot read, it leaves");
});

// --- the chip -------------------------------------------------------------------

test("the chip's three parts: no plane; a face; a frame; a tool mid-gesture; guidance outranking the step", () => {
  const none = chipParts(null, "select", engineNext("select", "mouse"), null);
  assert.equal(chipText(none), "select · click a thing, or drag to box");
  assert.equal(chipText(chipParts("e1's top", "circle", "drag the radius", null)), "on e1's top · circle · drag the radius");
  assert.equal(chipText(chipParts("f1", "line", "click the start", null)), "on f1 · line · click the start");
  const guided = chipParts("e1's top", "extrude", "click inside a closed shape", "click inside a closed outline — the ones I can see are lit");
  assert.equal(guided.next, "click inside a closed outline — the ones I can see are lit");
  assert.equal(guided.guiding, true);
  assert.equal(chipText(chipParts(null, "mine", null, null)), "mine", "a tool that says nothing: its name alone");
  assert.equal(engineNext("hand", "finger"), "drag anywhere to pan");
  assert.equal(engineNext("select", "finger"), "tap a thing, or hold and drag to box");
  assert.equal(press("finger"), "tap");
  assert.equal(press("mouse"), "click");
});

test("guidance in the chip is the log's sentence without the tool's name, which the chip says already", () => {
  assert.equal(guideText("extrude: click inside a closed outline", "extrude"), "click inside a closed outline");
  assert.equal(guideText("edit extrude: nothing changed", "edit extrude"), "nothing changed");
  assert.equal(guideText("circle: those three are on one line", null), "those three are on one line");
  assert.equal(guideText("no prefix here", "line"), "no prefix here");
});

test("Done types workplane(null) for a face, setDefaultFrame(null) for a default frame, nothing with no plane", async () => {
  const face = await drawn(...PLATE, 'workplane("p5.p6.p8")');
  assert.equal(doneCommand(face.m), "workplane(null)");
  const frame = await drawn("frame()", 'setDefaultFrame("f1")');
  assert.equal(doneCommand(frame.m), "setDefaultFrame(null)");
  const none = await drawn(...PLATE);
  assert.equal(doneCommand(none.m), null);
  const menu = planeMenu(face.m, activePlane(face.m, 4)!);
  assert.deepEqual(menu.items.map((i) => [i.label, i.action.do === "run" ? i.action.command : ""]), [
    ["Look at", 'lookAt("p5.p6.p8")'], ["Change…", 'arm("sketch")'], ["Done", "workplane(null)"],
  ]);
});

test("workplane(null) ends the plane: journalled as typed, and replayed by open", async () => {
  const { m, run } = await drawn(...PLATE, 'workplane("p5.p6.p8")');
  const before = m.journal.length;
  await run("workplane(null)");
  assert.deepEqual(m.journal.slice(before).map((j) => [j.op, j.args]), [["setWorkPlane", [null]]]);
  assert.equal(m.workPlane, null);
  assert.equal(activePlane(m, 4), null, "the tint goes, the chip's first part empties");
  const reopened = open(save(m));
  assert.equal(reopened.workPlane, null);
  assert.deepEqual(reopened.journal.map((j) => j.op), m.journal.map((j) => j.op));
  // And the file with the plane still set reopens with it set.
  const set = await drawn(...PLATE, 'workplane("p5.p6.p8")');
  assert.equal(open(save(set.m)).workPlane, "p5.p6.p8");
  const doneFrame = await drawn("frame()", 'setDefaultFrame("f1")', "setDefaultFrame(null)");
  assert.equal(open(save(doneFrame.m)).defaultFrame, null);
});

// --- each tool's next step, at each stage -------------------------------------

function ctxFor(m: Model, options: Record<string, unknown> = {}) {
  const c = {
    model: m, options, finished: false,
    requestRender() {}, requestSolve() { m.solve(); }, finish() { c.finished = true; },
    regionAt: regionAtFor(m, VIEW),
    pick: ([sx, sy]: [number, number]) => hitTest(m, VIEW, sx, sy),
    log() {},
  };
  return c as unknown as ToolContext;
}
/** A pointer at `w`, read on the ground (the default frame's plane, as the engine reports it). */
const at = (w: number[]): PointerInfo => ({ world: w, screen: worldToScreen(VIEW, w), plane: { origin: [0, 0, 0], u: [1, 0, 0], v: [0, 1, 0] } });
const nexts = (t: Tool) => [t.next!("mouse"), t.next!("finger")];

test("the rectangle: press at a corner, then drag to the opposite one", async () => {
  const { m } = await drawn("frame()", 'setDefaultFrame("f1")');
  const t = new RectangleTool(ctxFor(m));
  assert.equal(t.next!("mouse"), "press at a corner");
  t.onDown(at([0, 0, 0]));
  assert.equal(t.next!("mouse"), "drag to the opposite corner");
  t.onUp(at([20, 10, 0]));
  assert.equal(t.next!("mouse"), "press at a corner", "built: the next one");
});

test("the line: the start, the end, then the next end — and the chain is what it has placed", async () => {
  const { m } = await drawn("frame()", 'setDefaultFrame("f1")');
  const t = new LineTool(ctxFor(m));
  assert.deepEqual(nexts(t), ["click the start", "tap the start"]);
  t.onDown(at([0, 0, 0]));
  assert.deepEqual(nexts(t), ["click the end", "tap the end"]);
  assert.deepEqual(t.placed!(), [], "nothing placed until the first segment");
  t.onDown(at([20, 0, 0]));
  assert.deepEqual(nexts(t), ["click the next end — Esc ends the chain", "tap the next end — Cancel ends the chain"]);
  t.onDown(at([20, 15, 0]));
  const placed = t.placed!();
  assert.equal(placed.filter((n) => m.entities.get(n)?.kind === "line").length, 2, "both lines of the chain");
  assert.equal(placed.filter((n) => m.entities.get(n)?.kind === "point").length, 3, "and their three points");
  t.onCancel();
  assert.deepEqual(t.placed!(), [], "ended: in the sketch's own ink again");
});

test("the circle: centre then radius; three points counted; auto offers both until the gesture says", async () => {
  const { m } = await drawn("frame()", 'setDefaultFrame("f1")');
  const centre = new CircleTool(ctxFor(m, { method: "centre" }));
  assert.equal(centre.next!("mouse"), "press at the centre");
  centre.onDown(at([0, 0, 0]));
  centre.onMove(at([10, 0, 0]));
  assert.equal(centre.next!("mouse"), "drag the radius");
  const three = new CircleTool(ctxFor(m, { method: "3pt" }));
  assert.equal(three.next!("finger"), "tap the first point");
  three.onDown(at([0, 0, 0]));
  assert.equal(three.next!("finger"), "tap the second point");
  three.onDown(at([10, 0, 0]));
  assert.equal(three.next!("finger"), "tap the third point");
  const auto = new CircleTool(ctxFor(m, { method: "auto" }));
  assert.equal(auto.next!("mouse"), "press at the centre, or click 3 points");
  auto.onDown(at([0, 0, 0]));
  auto.onUp(at([0, 0, 0]));
  assert.equal(auto.next!("mouse"), "drag the radius, or click the second point");
  auto.onDown(at([10, 0, 0]));
  auto.onUp(at([10, 0, 0]));
  assert.equal(auto.next!("finger"), "tap the third point");
});

test("the arc: end to end then the bulge; or the centre, its start and end", async () => {
  const { m } = await drawn("frame()", 'setDefaultFrame("f1")');
  const t = new ArcTool(ctxFor(m, { method: "auto" }));
  assert.equal(t.next!("mouse"), "drag end to end, or click the centre");
  t.onDown(at([0, 0, 0]));
  t.onMove(at([20, 0, 0]));
  assert.equal(t.next!("mouse"), "drag to the other end");
  t.onUp(at([20, 0, 0]));
  assert.equal(t.next!("mouse"), "click the bulge");
  const c = new ArcTool(ctxFor(m, { method: "centre" }));
  assert.equal(c.next!("mouse"), "press at the centre");
  c.onDown(at([0, 0, 0]));
  c.onUp(at([0, 0, 0]));
  assert.equal(c.next!("finger"), "tap the start");
});

test("the polygon, the slot and the ellipse: their two places, then the slot's width and the ellipse's minor", async () => {
  const { m } = await drawn("frame()", 'setDefaultFrame("f1")');
  const poly = new PolygonTool(ctxFor(m));
  assert.equal(poly.next!("mouse"), "press at the centre");
  poly.onDown(at([0, 0, 0]));
  assert.equal(poly.next!("mouse"), "drag to a corner");
  poly.onUp(at([0, 0, 0]));
  assert.equal(poly.next!("finger"), "tap a corner", "a click, then a click");
  const slot = new SlotTool(ctxFor(m));
  assert.equal(slot.next!("mouse"), "press at the first centre");
  slot.onDown(at([0, 0, 0]));
  slot.onMove(at([30, 0, 0]));
  assert.equal(slot.next!("mouse"), "drag to the second centre");
  slot.onUp(at([30, 0, 0]));
  assert.equal(slot.next!("mouse"), "click the width");
  const ell = new EllipseTool(ctxFor(m));
  assert.equal(ell.next!("mouse"), "press at the centre");
  ell.onDown(at([0, 0, 0]));
  ell.onMove(at([30, 0, 0]));
  ell.onUp(at([30, 0, 0]));
  assert.equal(ell.next!("finger"), "tap the minor axis's end");
});

test("the point, the sketch tool, the dimension and constrain tools say what to click", async () => {
  const { m } = await drawn(...PLATE);
  assert.equal(new PointTool(ctxFor(m)).next!("finger"), "tap where the point goes");
  assert.equal(new SketchTool(ctxFor(m)).next!("mouse"), "click a lit face or plane to sketch on it");
  const d = new DimensionTool(ctxFor(m));
  assert.equal(d.next!("mouse"), "click what to dimension");
  d.picks = ["l1"];
  assert.equal(d.next!("mouse"), "click empty space to place it", "a line alone is a dimension");
  const k = new ConstrainTool(ctxFor(m));
  assert.equal(k.next!("mouse"), "click what to relate");
  k.picks = ["l1", "l2"];
  // "from the list": the constraints palette's, or on a workbench without
  // the palette's module the options pane's (docs/plans/constraints-palette.md).
  assert.equal(k.next!("mouse"), "choose a relation from the list, or pick more");
});

test("the extrude tool: a region, then ✓ to extrude; the fillet: a lit corner, a line that meets it, ✓", async () => {
  const { m } = await drawn(PLATE[0], PLATE[1]);
  const e = new ExtrudeTool(ctxFor(m, { depth: 10, mode: "auto" }));
  assert.equal(e.next!("finger"), "tap inside a closed shape");
  e.onDown(at([0, 0, 0]));
  assert.equal(e.next!("mouse"), "✓ to extrude");
  const f = new FilletTool(ctxFor(m, { radius: 3 }));
  assert.equal(f.next!("mouse"), "click a lit corner, or a line");
  const corners = f.takes!();
  assert.deepEqual([...corners].sort(), ["p1", "p2", "p3", "p4"], "every corner two lines meet at, lit");
  f.lines = ["l1"];
  assert.equal(f.next!("mouse"), "click a line that meets l1");
  assert.deepEqual([...f.takes!()].sort(), ["l2", "l4"], "the lines that share a corner with it");
  f.lines = ["l1", "l2"];
  assert.equal(f.next!("mouse"), "✓ to round the corner");
  assert.deepEqual(f.takes!(), [], "nothing more to take");
});
