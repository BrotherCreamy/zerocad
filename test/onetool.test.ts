// One circle tool and one arc tool, the method read from the gesture
// (docs/plans/one-circle-one-arc.md). The owner: *"why are there multiple circle
// tools and arc tools? they all achieve the same thing. surely just one tool,
// but different ways to set constraints."*
//
// Three kinds of claim. **Nothing was lost**: every gesture the four old tools
// knew, made with the two that replace them — locked to the old method, and
// left to read it — writes the file the old tool wrote, byte for byte, against
// fixtures recorded by the build before the change (test/fixtures/
// curve-tools-v13.json, written by the old circle, circle3, arc and arc3 tools).
// **Each gesture makes the constraints it says**: a drag a centre and a radius,
// three clicks three `onCircle`s, a click along an edge a `tan` — measured
// against the closed form after the solve, not against a SOLVED header. And
// **the plumbing**: the method is a declared choice the panel can lock,
// `circle3`/`arc3` arm the one tool locked, and two circles can now be tangent,
// in 3D as in 2D. What only a browser can show is in test/e2e/onetool.e2e.ts.

import { test } from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { ensureKernelLoaded } from "../src/kernel/problem.ts";
import { Model } from "../src/model.ts";
import { VERSION, open, save } from "../src/persist.ts";
import { findSnap } from "../src/snapping.ts";
import { pointOnWorkingPlane } from "../src/workplane.ts";
import { screenToPlane, worldToScreen, type View } from "../src/view.ts";
import { CircleTool } from "../src/tools/circle.ts";
import { ArcTool } from "../src/tools/arc.ts";
import { tangent } from "../src/relations/geometry.ts";
import { ToolEngine } from "../src/tools/engine.ts";
import { OptionMemory, declaredOptions, resolveOptions } from "../src/tools/options.ts";
import { TOOL_ALIASES, Tool as Base, aliasCommand, armedLine, defineTool, getToolCtor, listTools, type PointerInfo, type Tool, type ToolContext } from "../src/tools/tool.ts";
import { optionCommand } from "../src/panels.ts";
import { Repl } from "../src/repl.ts";
import { neocadScope } from "../src/replenv.ts";
import { curveFrame } from "../src/curveplane.ts";

async function loadKernel() {
  await ensureKernelLoaded(await readFile(new URL("../src/kernel/wasm-gen/neocad_kernel_bg.wasm", import.meta.url)));
}

type Step = ["down" | "move" | "up", number, number];
interface Fixture { view: View; gestures: Record<string, { tool: string; steps: Step[]; base?: boolean }>; files: Record<string, string> }
const FIXTURE: Fixture = JSON.parse(await readFile(new URL("./fixtures/curve-tools-v13.json", import.meta.url), "utf8"));
const view = FIXTURE.view;
// A v13 file as today's build writes it: the same journal, stamped with the
// current version. Version 14 (docs/plans/solids-kernel.md) added a feature's
// mode and changed nothing a curve tool writes, so this is the one byte that
// may differ — and the fixtures stay what the old build wrote.
const stamped = (file: string) => file.replace('"version": 13,', `"version": ${VERSION},`);
/**
 * What today's tool writes for the gesture: the old file, stamped, and in 3D
 * **without the ground holds** — the old tools held every curve drawn in a
 * fresh document to the origin's plane (`onPlane(p, "origin")`, `par(c,
 * "origin.z")`), and the owner's rule (docs/plans/profiles-held.md) is that
 * nothing is held to a plane nobody picked. Nothing else in the file may
 * differ: the same entities, the same other relations, the same positions.
 * Opening the old files still gives them back byte for byte (below) — an
 * old file's holds are its own, and stay.
 */
const current = (file: string) => {
  const saved = JSON.parse(stamped(file)) as { dim: number; journal: { op: string; args: unknown[] }[] };
  if (saved.dim !== 3) return stamped(file);
  const ground = (e: { op: string; args: unknown[] }) => (e.op === "onPlane" && e.args[1] === "origin") || (e.op === "parallel" && e.args[1] === "origin.z");
  return JSON.stringify({ ...saved, journal: saved.journal.filter((e) => !ground(e)) }, null, 2);
};

function ctxFor(m: Model, options: Record<string, unknown> = {}) {
  const said: string[] = [];
  const c = {
    model: m, options, finished: false, said,
    requestRender() {}, requestSolve() { m.solve(); }, finish() { c.finished = true; },
    log: (line: string) => { said.push(line); },
    planeAt: ([sx, sy]: [number, number], plane: { origin: number[]; u: number[]; v: number[] }) => screenToPlane(view, sx, sy, plane),
  };
  return c as typeof c & ToolContext;
}

/** A pointer at screen (sx, sy), read and snapped as the engine reads it — the fixture generator's own. */
function at(m: Model, sx: number, sy: number): PointerInfo {
  const snap = findSnap(m, view, sx, sy);
  if (m.dim === 3) {
    const { world, plane } = pointOnWorkingPlane(m, view, sx, sy);
    return { world: snap ? snap.world : world, plane, screen: [sx, sy], ...(snap ? { snap } : {}) };
  }
  const [x, y] = [(sx - view.ox) / view.scale, (view.oy - sy) / view.scale];
  return { world: snap ? snap.world : [x, y], screen: [sx, sy], ...(snap ? { snap } : {}) };
}

function play(m: Model, tool: Tool, steps: Step[]): void {
  for (const [kind, sx, sy] of steps) {
    const p = at(m, sx, sy);
    if (kind === "down") tool.onDown(p);
    else if (kind === "move") tool.onMove(p);
    else tool.onUp(p);
  }
}

/** The fixture's base drawing: a line l1 along y = −20 from x −40 to 40, and a point p3 at (30, 30). */
function withGeometry(dim: 2 | 3): Model {
  const m = new Model(dim);
  const z = dim === 3 ? [0] : [];
  const a = m.addPoint([-40, -20, ...z]).name, b = m.addPoint([40, -20, ...z]).name;
  m.addLine(a, b);
  m.addPoint([30, 30, ...z]);
  return m;
}

const S = (w: number[]): [number, number] => worldToScreen(view, w);
const click = (w: number[]): Step[] => { const [x, y] = S(w); return [["down", x, y], ["up", x, y]]; };
const drag = (from: number[], to: number[]): Step[] => {
  const [a, b] = [S(from), S(to)];
  return [["down", ...a], ["move", (a[0] + b[0]) / 2, (a[1] + b[1]) / 2], ["up", ...b]];
};
const presses = (steps: Step[]): Step[] => steps.filter(([k]) => k === "down");

function draw(dim: 2 | 3, base: boolean | undefined, Ctor: typeof CircleTool | typeof ArcTool, options: Record<string, unknown>, steps: Step[]) {
  const m = base ? withGeometry(dim) : new Model(dim);
  const ctx = ctxFor(m, options);
  const tool = new Ctor(ctx);
  play(m, tool, steps);
  m.solve();
  return { m, ctx, tool, file: save(m) };
}

const near = (a: number[], b: number[], tol = 1e-6) => Math.hypot(...a.map((v, i) => v - b[i])) <= tol;
const opsOf = (m: Model) => [...m.relations.values()].map((r) => [r.op, r.args]);

// --- nothing was lost --------------------------------------------------------------

test("every gesture the four old tools knew writes the old tool's file — the one tool locked to its method", async () => {
  await loadKernel();
  const as: Record<string, [typeof CircleTool | typeof ArcTool, string]> = {
    circle: [CircleTool, "centre"], circle3: [CircleTool, "3pt"], arc: [ArcTool, "centre"], arc3: [ArcTool, "3pt"],
  };
  for (const dim of [2, 3] as const) {
    for (const [name, g] of Object.entries(FIXTURE.gestures)) {
      const [Ctor, method] = as[g.tool];
      const want = current(FIXTURE.files[`${dim}D ${name}`]);
      assert.equal(draw(dim, g.base, Ctor, { method }, g.steps).file, want, `${dim}D ${name}, locked to ${method}`);
      // The 3-point tools decided on the press; a script of presses alone still draws.
      if (g.tool === "circle3" || g.tool === "arc3" || g.tool === "arc") {
        assert.equal(draw(dim, g.base, Ctor, { method }, presses(g.steps)).file, want, `${dim}D ${name}, presses alone`);
      }
    }
  }
});

test("…and left to read the gesture, the same gestures still draw the same files — clicks, drags and all", async () => {
  await loadKernel();
  for (const dim of [2, 3] as const) {
    const f = (name: string) => current(FIXTURE.files[`${dim}D ${name}`]);
    const g = FIXTURE.gestures;
    // A drag is a centre and a radius; three clicks on nothing are three points;
    // clicks with the arc are its centre, start and end.
    assert.equal(draw(dim, false, CircleTool, {}, g["circle drag"].steps).file, f("circle drag"), `${dim}D drag`);
    assert.equal(draw(dim, false, CircleTool, {}, g["circle3 clicks"].steps).file, f("circle3 clicks"), `${dim}D three clicks`);
    assert.equal(draw(dim, false, ArcTool, {}, g["arc clicks"].steps).file, f("arc clicks"), `${dim}D arc clicks`);
    assert.equal(draw(dim, true, ArcTool, {}, g["arc from a point"].steps).file, f("arc from a point"), `${dim}D arc from a point`);
    // The 3-point arc's two ends as one drag, then the bulge clicked.
    for (const name of ["arc3 above", "arc3 below", "arc3 from a point"]) {
      const [a, , b, , w, wu] = g[name].steps;
      const steps: Step[] = [a, ["move", (a[1] + b[1]) / 2, (a[2] + b[2]) / 2], ["up", b[1], b[2]], w, wu];
      assert.equal(draw(dim, g[name].base, ArcTool, {}, steps).file, f(name), `${dim}D ${name}, dragged end to end`);
    }
  }
});

test("old files open as they were: what the old tools wrote reopens to itself and solves where it stands", async () => {
  await loadKernel();
  for (const [name, file] of Object.entries(FIXTURE.files)) {
    const m = open(file);
    assert.equal(save(m), stamped(file), `${name} reopens to itself`);
    const before = save(m);
    assert.equal(m.solve().solved, true, name);
    assert.equal(save(m), before, `${name} solves without moving`);
  }
});

// --- each gesture's constraints ------------------------------------------------------

test("a drag is a centre and a radius: one point, one circle, nothing on its rim", async () => {
  await loadKernel();
  const { m, ctx } = draw(2, false, CircleTool, {}, drag([0, 0], [12, 5]));
  assert.equal(ctx.finished, true);
  assert.deepEqual([...m.entities.values()].map((e) => e.kind), ["point", "circle"]);
  assert.deepEqual(opsOf(m), [], "no relation: the radius is free, as the drag-out circle's always was");
  assert.ok(Math.abs(m.radius("c1") - 13) < 1e-9);
});

test("a click, then a drag: the click was the centre — the second press is no rim point", async () => {
  await loadKernel();
  const { m } = draw(2, false, CircleTool, {}, [...click([0, 0]), ...drag([20, 20], [30, 40])]);
  const c = m.circle("c1");
  assert.ok(near(m.coords(c.center), [0, 0]), `centre ${m.coords(c.center)}`);
  assert.ok(Math.abs(m.radius("c1") - 50) < 1e-9, `radius ${m.radius("c1")}: to where the drag let go`);
  assert.equal([...m.entities.values()].filter((e) => e.kind === "point").length, 1, "the drag's press made nothing");
});

test("three clicks are three points on the rim, and the circle is their circumcircle", async () => {
  await loadKernel();
  const { m } = draw(2, false, CircleTool, {}, [...click([0, 0]), ...click([16, 0]), ...click([0, 12])]);
  assert.deepEqual(opsOf(m).map(([op]) => op), ["onCircle", "onCircle", "onCircle"]);
  assert.ok(near(m.coords(m.circle("c1").center), [8, 6]) && Math.abs(m.radius("c1") - 10) < 1e-6);
});

/** The perpendicular distance from `p` to the line through `a` and `b`, in 2D. */
const toLine = (p: number[], a: number[], b: number[]) =>
  Math.abs((b[0] - a[0]) * (p[1] - a[1]) - (b[1] - a[1]) * (p[0] - a[0])) / Math.hypot(b[0] - a[0], b[1] - a[1]);

test("a click along a line, as a rim point, makes the circle tangent to the line instead", async () => {
  await loadKernel();
  for (const dim of [2, 3] as const) {
    const { m, ctx } = draw(dim, true, CircleTool, {}, [...click([10, -20]), ...click([-10, 10]), ...click([20, 10])]);
    assert.equal(ctx.finished, true, `${dim}D`);
    const rels = opsOf(m).filter(([op]) => op !== "onPlane" && op !== "parallel");
    assert.deepEqual(rels, [["tangent", ["l1", "c1"]], ["onCircle", ["p4", "c1"]], ["onCircle", ["p5", "c1"]]],
      `${dim}D: a tangency for the click on l1, the other two rim points — and no point left on the line`);
    assert.equal(m.solve().solved, true);
    const c = m.coords(m.circle("c1").center), r = m.radius("c1");
    // Closed form: centre on x = 5 (the two points' bisector), r = cy + 20 → cy = −1.25.
    assert.ok(near(c.slice(0, 2), [5, -1.25]) && Math.abs(r - 18.75) < 1e-6, `${dim}D: centre ${c}, r ${r}`);
    assert.ok(Math.abs(toLine(c, [-40, -20], [40, -20]) - r) < 1e-6, `${dim}D: touching l1`);
  }
});

test("a click on a circle's rim makes the new circle touch it — from outside, as the clicks have it", async () => {
  await loadKernel();
  const m = new Model(2);
  const k = m.addCircle(m.addPoint([0, 0]).name, 10).name;
  const ctx = ctxFor(m);
  const tool = new CircleTool(ctx);
  play(m, tool, [...click([10, 0]), ...click([30, 0]), ...click([20, 8])]);
  const made = [...m.entities.values()].find((e) => e.kind === "circle" && e.name !== k)!.name;
  const tan = [...m.relations.values()].find((r) => r.op === "tangent")!;
  assert.deepEqual(tan.args, [k, made, "outside"], "journalled with the side it was read as");
  assert.equal(m.solve().solved, true);
  const d = Math.hypot(...m.coords(m.circle(made).center));
  assert.ok(Math.abs(d - (m.radius(made) + 10)) < 1e-6, `|c − k| ${d} = r + 10`);
  for (const p of [[30, 0], [20, 8]]) assert.ok(Math.abs(Math.hypot(...m.coords(m.circle(made).center).map((v, i) => v - p[i])) - m.radius(made)) < 1e-6);
});

test("a drag let go along a line is a circle touching it; let go on a point, through it", async () => {
  await loadKernel();
  const t = draw(2, true, CircleTool, {}, drag([0, 0], [15, -20]));
  assert.deepEqual(opsOf(t.m), [["tangent", ["l1", "c1"]]]);
  assert.ok(Math.abs(t.m.radius("c1") - 20) < 1e-9, "the radius that touches, not the one dragged to");
  const p = draw(2, true, CircleTool, {}, drag([0, 0], [30, 30]));
  assert.deepEqual(opsOf(p.m), [["onCircle", ["p3", "c1"]]]);
  assert.ok(Math.abs(p.m.radius("c1") - Math.hypot(30, 30)) < 1e-9);
  // Locked to centre · radius, the rim infers nothing — the old drag-out circle.
  const old = draw(2, true, CircleTool, { method: "centre" }, drag([0, 0], [15, -20]));
  assert.deepEqual(opsOf(old.m), []);
});

test("locked to 3 points, a click along a line is a rim point on it, as circle3's was; locked to tangent, only curves", async () => {
  await loadKernel();
  const three = draw(2, true, CircleTool, { method: "3pt" }, [...click([10, -20]), ...click([-10, 10]), ...click([20, 10])]);
  assert.ok(opsOf(three.m).some(([op, args]) => op === "pointOnLine" && (args as string[])[1] === "l1"));
  assert.ok(!opsOf(three.m).some(([op]) => op === "tangent"));
  const tan = draw(2, true, CircleTool, { method: "tangent" }, click([0, 10]));
  assert.match(tan.ctx.said[0], /^circle: \{tap\} on a line, circle or arc for it to touch/);
  // Locked to centre: two clicks, centre then rim — Onshape's centre-point circle.
  const centre = draw(2, false, CircleTool, { method: "centre" }, [...click([0, 0]), ...click([3, 4])]);
  assert.equal(centre.ctx.finished, true);
  assert.ok(Math.abs(centre.m.radius("c1") - 5) < 1e-9);
});

test("the arc dragged from a line's end, bulged near the smooth way on, is pulled onto it and held tangent", async () => {
  await loadKernel();
  for (const dim of [2, 3] as const) {
    // l1 ends at (40, −20) heading +x: the arc leaving it smoothly for (60, 0) is
    // centred straight above that end, at (40, 0), radius 20.
    const { m, ctx } = draw(dim, true, ArcTool, {}, [...drag([40, -20], [60, 0]), ...click([54.5, -14])]);
    assert.equal(ctx.finished, true, `${dim}D`);
    assert.ok(opsOf(m).some(([op, args]) => op === "tangent" && JSON.stringify(args) === '["l1","a1"]'), `${dim}D: tan(l1, a1)`);
    assert.equal(m.solve().solved, true);
    const a = m.arc("a1");
    assert.ok(near(m.coords(a.center).slice(0, 2), [40, 0]) && Math.abs(m.radius("a1") - 20) < 1e-6, `${dim}D: ${m.coords(a.center)} r ${m.radius("a1")}`);
    // And it is the quarter that leaves along +x, not the three-quarter turn back.
    const f = curveFrame(m, a)!;
    assert.ok(Math.abs(f.sweep - Math.PI / 2) < 1e-6, `${dim}D: sweep ${f.sweep}`);
  }
  // A bulge well off the smooth arc is a plain 3-point arc.
  const off = draw(2, true, ArcTool, {}, [...drag([40, -20], [60, 0]), ...click([45, 5])]);
  assert.ok(!opsOf(off.m).some(([op]) => op === "tangent"));
});

test("locked to tangent, the arc leaves a line's or an arc's end smoothly, to where the end is put", async () => {
  await loadKernel();
  const line = draw(2, true, ArcTool, { method: "tangent" }, drag([40, -20], [60, 0]));
  assert.equal(line.ctx.finished, true, "the drag is the whole gesture");
  assert.ok(near(line.m.coords(line.m.arc("a1").center), [40, 0]));
  assert.ok(opsOf(line.m).some(([op]) => op === "tangent"));
  // Clicked instead: start, then end.
  const clicked = draw(2, true, ArcTool, { method: "tangent" }, [...click([40, -20]), ...click([60, 0])]);
  assert.equal(clicked.file, line.file, "two clicks and one drag build the same arc");
  // Off an arc's end: a quarter from (10, 0) round to (0, 10) heads −x at its end.
  const m = new Model(2);
  const k = m.addArc(m.addPoint([0, 0]).name, m.addPoint([10, 0]).name, m.addPoint([0, 10]).name, 10).name;
  const ctx = ctxFor(m, { method: "tangent" });
  const tool = new ArcTool(ctx);
  play(m, tool, drag([0, 10], [-20, 0]));
  const made = [...m.entities.values()].find((e) => e.kind === "arc" && e.name !== k)!.name;
  const tan = [...m.relations.values()].find((r) => r.op === "tangent")!;
  assert.deepEqual(tan.args, [k, made, "inside"], "the old arc inside the new one's circle");
  assert.equal(m.solve().solved, true);
  assert.ok(near(m.coords(m.arc(made).center), [0, -15]) && Math.abs(m.radius(made) - 25) < 1e-6);
  // Started in empty space, it says what would work.
  const empty = draw(2, false, ArcTool, { method: "tangent" }, click([5, 5]));
  assert.match(empty.ctx.said[0], /^arc: start on the end of a line or arc/);
});

test("the centre-point arc: a click, then start and end — or, from the centre, one stroke from start to end", async () => {
  await loadKernel();
  const clicks = draw(2, false, ArcTool, {}, [...click([0, 0]), ...click([10, 0]), ...click([0, 14])]);
  const stroke = draw(2, false, ArcTool, {}, [...click([0, 0]), ...drag([10, 0], [0, 14])]);
  assert.equal(stroke.file, clicks.file);
  assert.deepEqual(opsOf(clicks.m), [["arcEndpoints", ["a1"]]]);
  // Locked to centre, a first drag is the radius: centre out to the start.
  const radius = draw(2, false, ArcTool, { method: "centre" }, [...drag([0, 0], [10, 0]), ...click([0, 14])]);
  assert.equal(radius.file, clicks.file);
});

// --- reading, locking, the old names --------------------------------------------------

test("the tools say what they have read: centre mid-drag, 3 points after two clicks, tangent along an edge — nothing when locked", async () => {
  await loadKernel();
  const m = withGeometry(2);
  const tool = new CircleTool(ctxFor(m));
  assert.deepEqual(tool.read(), {});
  const [d, mv] = drag([0, 0], [5, 5]);
  tool.onDown(at(m, d[1], d[2]));
  assert.deepEqual(tool.read(), {}, "a press alone says nothing yet");
  tool.onMove(at(m, mv[1], mv[2]));
  assert.deepEqual(tool.read(), { method: "centre" });
  tool.onMove(at(m, ...S([15, -20])));
  assert.deepEqual(tool.read(), { method: "tangent" }, "over l1 the rim would touch it");
  tool.onCancel();
  for (const [k, x, y] of [...click([0, 0]), ...click([10, 10])]) (k === "down" ? tool.onDown : tool.onUp).call(tool, at(m, x, y));
  assert.deepEqual(tool.read(), { method: "3pt" });
  tool.onMove(at(m, ...S([15, -20])));
  assert.deepEqual(tool.read(), { method: "tangent" });
  assert.deepEqual(new CircleTool(ctxFor(m, { method: "3pt" })).read(), {}, "locked, there is nothing to read");
  const arc = new ArcTool(ctxFor(m));
  for (const [k, x, y] of click([0, 0])) (k === "down" ? arc.onDown : arc.onUp).call(arc, at(m, x, y));
  assert.deepEqual(arc.read(), { method: "centre" });
});

test("the method is a declared choice: auto by default, each lock by name, anything else refused naming them", () => {
  for (const tool of ["circle", "arc"]) {
    const specs = declaredOptions(getToolCtor(tool), tool);
    assert.equal(specs.method.default, "auto", tool);
    assert.deepEqual(resolveOptions(tool, specs, {}), { construction: false, method: "auto" }, tool);
    assert.deepEqual(resolveOptions(tool, specs, { method: "3pt" }).method, "3pt");
    assert.throws(() => resolveOptions(tool, specs, { method: "three" }),
      new RegExp(`${tool}'s method is one of "auto", .*"3pt".*, not "three"`));
    // A remembered word that is no choice now is passed over, as any stale value is.
    assert.equal(resolveOptions(tool, specs, {}, { method: "spiral" }).method, "auto");
  }
  assert.deepEqual(Object.keys(declaredOptions(getToolCtor("circle"), "circle").method.choices!), ["auto", "centre", "3pt", "tangent"]);
  assert.deepEqual(Object.values(declaredOptions(getToolCtor("circle"), "circle").method.choices!), ["auto", "centre · radius", "3 points", "tangent"]);
});

function fakeCanvas(): HTMLCanvasElement {
  return {
    addEventListener() {},
    getContext: () => ({}),
    getBoundingClientRect: () => ({ left: 0, top: 0, x: 0, y: 0, width: 800, height: 600 }),
    setPointerCapture() {},
    releasePointerCapture() {},
  } as unknown as HTMLCanvasElement;
}

test("circle3 and arc3 arm the one tool, locked to 3 points — listed as that, on no toolbar, the lock not carried to the button", async () => {
  await loadKernel();
  const memory = new OptionMemory(null);
  const e = new ToolEngine(new Model(3), fakeCanvas(), { ox: 0, oy: 0, scale: 1 }, { onSolveRender() {}, onRenderOnly() {}, optionMemory: memory });
  e.arm("circle3");
  assert.deepEqual(e.armed, { name: "circle", options: { construction: false, method: "3pt" } });
  assert.ok(e.active instanceof CircleTool);
  e.arm("arc3", { construction: true });
  assert.deepEqual(e.armed, { name: "arc", options: { construction: true, method: "3pt" } }, "its other options pass through");
  assert.ok(e.active instanceof ArcTool);
  e.arm("circle");
  assert.equal(e.armed?.options.method, "auto", "the alias's lock is not remembered: the Circle button still reads the gesture");
  e.arm("circle", { method: "3pt" });
  e.arm("circle");
  assert.equal(e.armed?.options.method, "3pt", "a lock armed by name is, like any option");
  e.arm("circle", { method: "auto" });
  assert.ok(!listTools().includes("circle3") && !listTools().includes("arc3"), "no button of their own");
  assert.equal(getToolCtor("circle3"), undefined);
  assert.equal(aliasCommand("circle3"), 'arm("circle", {method: "3pt"})');
  assert.equal(armedLine("arc3"), 'armed: arc3 — the arc tool, locked to 3 points, arm("arc", {method: "3pt"})');
  assert.deepEqual(Object.keys(TOOL_ALIASES), ["circle3", "arc3", "sketch"]);

  const armed: string[] = [];
  const repl = new Repl(neocadScope({ model: new Model(3), arm: (name, options) => { e.arm(name, options); armed.push(e.armed!.name); }, optionMemory: memory }));
  assert.equal((await repl.eval('arm("circle3")')).value, 'armed: circle3 — the circle tool, locked to 3 points, arm("circle", {method: "3pt"})');
  assert.deepEqual(armed, ["circle"]);
  const listed = (await repl.eval("tools()")).value as string[];
  assert.ok(listed.some((l) => l.startsWith('circle3  — the circle tool, locked to 3 points: arm("circle", {method: "3pt"})')), listed.join("\n"));
});

// --- two circles touching -----------------------------------------------------------------

test("tan between two circles: outside or inside, read off the drawing when not said, journalled, replayed", async () => {
  await loadKernel();
  const m = new Model(2);
  const a = m.addCircle(m.addPoint([0, 0]).name, 10).name;
  const b = m.addCircle(m.addPoint([25, 0]).name, 12).name;
  const c = m.addCircle(m.addPoint([3, 0]).name, 4).name;
  const out = tangent(m, a, b);
  const inn = tangent(m, a, c);
  assert.deepEqual(m.relationOf(out).args, [a, b, "outside"]);
  assert.deepEqual(m.relationOf(inn).args, [a, c, "inside"]);
  assert.equal(m.solve().solved, true);
  const d = (x: string, y: string) => Math.hypot(...m.coords(m.circle(x).center).map((v, i) => v - m.coords(m.circle(y).center)[i]));
  assert.ok(Math.abs(d(a, b) - (m.radius(a) + m.radius(b))) < 1e-9);
  assert.ok(Math.abs(d(a, c) - Math.abs(m.radius(a) - m.radius(c))) < 1e-9);
  const file = save(m);
  assert.equal(save(open(file)), file, "the side is in the file, and replays");
  assert.throws(() => tangent(m, a, b, "sideways"), /"outside" or "inside", not "sideways"/);
  assert.throws(() => tangent(m, "l9" as string, a, "inside"), /only between two circles/);
});

test("tan between two circles in 3D: the second turns into the first's plane and touches it — the same relation one dimension up", async () => {
  await loadKernel();
  const m = new Model(3);
  // A tilted plane's normal, and a circle on it; the other circle starts facing straight up, off it.
  const n = [0, -0.6, 0.8];
  const a = m.addCircle(m.addPoint([0, 0, 0]).name, 10, n).name;
  const b = m.addCircle(m.addPoint([18, 3, 5]).name, 6, [0, 0, 1]).name;
  tangent(m, a, b, "outside");
  // Hold the first where it is, so the second is the one that moves.
  const s = neocadScope({ model: m }) as Record<string, (...args: unknown[]) => unknown>;
  s.fix(m.circle(a).center, [0, 0, 0]);
  s.rad(a, 10);
  const [p, q] = [s.pt(0, 0, 0) as string, s.pt(0, -6, 8) as string];
  s.fix(p, [0, 0, 0]);
  s.fix(q, [0, -6, 8]);
  s.par(a, s.ln(p, q) as string);
  const report = m.solve();
  assert.equal(report.solved, true, JSON.stringify(report.offenders));
  const na = m.normalOf(a), nb = m.normalOf(b);
  const unit = (v: number[]) => v.map((x) => x / Math.hypot(...v));
  assert.ok(Math.abs(Math.abs(unit(na).reduce((t, x, i) => t + x * unit(nb)[i], 0)) - 1) < 1e-9, `parallel normals ${na} ${nb}`);
  const cb = m.coords(m.circle(b).center), ca = m.coords(m.circle(a).center);
  assert.ok(Math.abs(cb.map((v, i) => v - ca[i]).reduce((t, x, i) => t + x * unit(na)[i], 0)) < 1e-9, "the second's centre in the first's plane");
  assert.ok(Math.abs(Math.hypot(...cb.map((v, i) => v - ca[i])) - (m.radius(a) + m.radius(b))) < 1e-9, "and touching");
  assert.equal([...m.relations.values()].filter((r) => r.op === "tangent").length, 1, "one relation, deletable as one");
});

test("a choice is declared with its words, and a malformed one is refused where it is written", async () => {
  const bad = (options: unknown) => class extends Base { readonly name = "bad"; static options = options as never; };
  assert.throws(() => defineTool("t_choice1", bad({ how: { default: "a" } })), /is a choice, and needs its choices/);
  assert.throws(() => defineTool("t_choice2", bad({ how: { default: "c", choices: { a: "A", b: "B" } } })), /its default "c" is not one of its choices/);
  assert.throws(() => defineTool("t_choice3", bad({ how: { default: 1, choices: { a: "A" } } })), /choices are for an option whose default is one of them/);
  assert.throws(() => defineTool("t_choice4", bad({ how: { default: "a", choices: { a: 1 } } })), /needs its choices/);
  defineTool("t_choice5", bad({ how: { default: "a", choices: { a: "A", b: "B" } } }));
  assert.ok(getToolCtor("t_choice5"), "a well-formed choice registers");
  // What the panel types when one is picked: the word quoted, as a person would type it.
  assert.equal(optionCommand("circle", "method", "3pt"), 'arm("circle", {method: "3pt"})');
});
