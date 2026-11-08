// The default for sketch entities is no plane (docs/plans/profiles-held.md).
// The owner: *"the default for sketch entities is no plane. Every sketch is a
// 3D sketch, unless you enter into active on-plane constraint."*
//
// So in a 3D document where nothing is picked to sketch on — no work plane,
// no default frame — a drawing tool holds nothing to any plane: where a click
// lands (the ground, or a face under the cursor) is a position, not a
// relation. A curve is held by nothing but its own definition. Measured
// before this rule: a circle drawn in a fresh document came with
// `onPlane(p1, origin)` and `par(c1, origin.z)`, an arc with three onPlanes
// and a par, a slot with six and two; the rectangle and the line with none.
//
// Sketch mode is where the holds are, and test/sketchmode.test.ts keeps them.

import { test } from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { ensureKernelLoaded } from "../src/kernel/problem.ts";
import { Model } from "../src/model.ts";
import { neocadScope } from "../src/replenv.ts";
import { Repl } from "../src/repl.ts";
import { pointOnWorkingPlane } from "../src/workplane.ts";
import { screenToPlane, type View } from "../src/view.ts";
import { getToolCtor, type PointerInfo, type Tool, type ToolContext } from "../src/tools/tool.ts";
import { regionAtFor } from "./featurectx.ts";
import "../src/modules/builtin.ts";

async function loadKernel() {
  const bytes = await readFile(new URL("../src/kernel/wasm-gen/neocad_kernel_bg.wasm", import.meta.url));
  await ensureKernelLoaded(bytes);
}

type At = (sx: number, sy: number) => PointerInfo;
const click = (t: Tool, p: PointerInfo) => { t.onDown?.(p); t.onUp?.(p); };
const drag = (t: Tool, a: PointerInfo, b: PointerInfo) => { t.onDown?.(a); t.onMove?.(b); t.onUp?.(b); };

/** Every drawing tool and a gesture for it, about (400, 300) — sketchmode.test.ts's table, every method. */
const DRAWN: [string, Record<string, unknown>, (t: Tool & Record<string, any>, at: At) => void][] = [
  ["point", {}, (t, at) => click(t, at(405, 305))],
  ["line", {}, (t, at) => { click(t, at(370, 300)); click(t, at(430, 310)); t.onCancel?.(); }],
  ["rectangle", {}, (t, at) => drag(t, at(370, 280), at(430, 320))],
  ["polygon", {}, (t, at) => drag(t, at(400, 300), at(430, 305))],
  ["slot", {}, (t, at) => { drag(t, at(370, 300), at(430, 300)); click(t, at(400, 312)); }],
  ["circle", { method: "centre" }, (t, at) => drag(t, at(400, 300), at(430, 300))],
  ["circle", { method: "3pt" }, (t, at) => { click(t, at(370, 300)); click(t, at(400, 270)); click(t, at(430, 300)); }],
  ["arc", { method: "centre" }, (t, at) => { click(t, at(400, 300)); click(t, at(430, 300)); click(t, at(400, 270)); }],
  ["arc", { method: "3pt" }, (t, at) => { drag(t, at(370, 300), at(430, 300)); click(t, at(400, 280)); }],
  ["ellipse", {}, (t, at) => { drag(t, at(400, 300), at(440, 300)); click(t, at(400, 315)); }],
  ["spline", {}, (t, at) => { for (const [dx, dy] of [[-40, 0], [-10, -20], [20, 10], [40, -5]]) t.onUp?.(at(400 + dx, 300 + dy)); t.confirm!(); }],
];

function host(m: Model, view: View, options: Record<string, unknown>) {
  const repl = new Repl(neocadScope({ model: m, view, viewSize: () => [800, 600] }));
  const ctx = {
    model: m, options, log() {}, requestRender() {}, requestSolve() { m.solve(); }, finish() {},
    pick: () => null, run: (c: string) => repl.eval(c).then(() => {}), act(fn: () => void) { fn(); },
    regionAt: regionAtFor(m, view),
    planeAt: ([sx, sy]: [number, number], plane: { origin: number[]; u: number[]; v: number[] }) => screenToPlane(view, sx, sy, plane),
  } as unknown as ToolContext;
  const at: At = (sx, sy) => {
    const { world, plane } = pointOnWorkingPlane(m, view, sx, sy);
    return { world, plane, screen: [sx, sy] } as PointerInfo;
  };
  return { ctx, at };
}

/** The relations that tie anything to a plane: an onPlane, or a curve's normal held to a plane's normal. */
function planeHolds(m: Model, made: readonly string[]): string[] {
  return made.filter((n) => {
    const r = m.relationOf(n);
    if (r.op === "onPlane") return true;
    return r.op === "parallel" && r.args.some((a) => typeof a === "string" && /^origin(\.|$)|\.z$/.test(a));
  }).map((n) => { const r = m.relationOf(n); return `${r.op}(${r.args.join(", ")})`; });
}

test("in a fresh 3D document, with no plane picked, no drawing tool holds anything to a plane — every sketch is a 3D sketch", async () => {
  await loadKernel();
  const failures: string[] = [];
  for (const [tool, options, gesture] of DRAWN) {
    const m = new Model(3);
    const { ctx, at } = host(m, { ox: 400, oy: 300, scale: 2 }, options);
    const t = new (getToolCtor(tool)!)(ctx) as Tool & Record<string, any>;
    gesture(t, at);
    const label = `${tool}${options.method ? ` (${options.method})` : ""}`;
    if (![...m.entities.values()].some((e) => e.kind === "point")) { failures.push(`${label}: drew nothing`); continue; }
    const held = planeHolds(m, [...m.relations.keys()]);
    if (held.length) failures.push(`${label}: ${held.join(" ")}`);
    if (!m.solve().solved) failures.push(`${label}: did not solve`);
  }
  assert.deepEqual(failures, []);
});

test("a circle drawn with nothing picked is still a circle in a plane of its own: its normal is its own, and it lies where it was drawn", async () => {
  await loadKernel();
  const m = new Model(3);
  const { ctx, at } = host(m, { ox: 400, oy: 300, scale: 2 }, { method: "centre" });
  drag(new (getToolCtor("circle")!)(ctx) as Tool, at(400, 300), at(430, 300));
  const c = [...m.entities.values()].find((e) => e.kind === "circle")!;
  assert.equal(m.solve().solved, true);
  // Seeded on the ground, facing up, where the click landed — a position, held by nothing.
  assert.deepEqual(m.normalOf(c.name).map((x) => Math.round(x * 1e9) / 1e9), [0, 0, 1]);
  assert.ok(Math.abs(m.coords((c as { center: string }).center)[2]) < 1e-12);
  assert.deepEqual([...m.relations.values()].map((r) => r.op), [], "nothing but its own definition");
});
