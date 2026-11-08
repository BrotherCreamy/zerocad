// A feature's entities are related to each other: a prism stays a prism,
// whichever corner is dragged (docs/plans/profiles-held.md).
//
// The owner: *"Why is it that after I extrude I can drag a corner of the
// extrude and it deforms the solid? I think it's missing adding in
// relations"* — and, of the first plan, which tied what is sketched to the
// ground: *"It's not about being tied to the ground plane, it's about correct
// relationships BETWEEN entities. Part of the concept of this CAD is to have
// bidirectional relationships everywhere by default."*
//
// So every test here asks a property of the solid and none asks which
// relation holds it: the base flat, every wall square to it and as long as
// the depth, the lid the base translated. Measured in the browser before the
// change (the spec): a lid corner dragged 60×30 px took its base 18.2 below
// the ground, the base tilted while every wall stayed along the world's z,
// and the status said SOLVED.

import { test } from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { ensureKernelLoaded } from "../src/kernel/problem.ts";
import { Model } from "../src/model.ts";
import { extrude } from "../src/operations.ts";
import { neocadScope } from "../src/replenv.ts";
import { Repl } from "../src/repl.ts";
import { pointOnWorkingPlane } from "../src/workplane.ts";
import { screenToPlane, worldToScreen, type View } from "../src/view.ts";
import { getToolCtor, type PointerInfo, type Tool, type ToolContext } from "../src/tools/tool.ts";
import { pullTo } from "../src/tools/engine.ts";
import { regionAtFor } from "./featurectx.ts";
import { tiltedFrame } from "./frames.ts";
import { baseOf, polygon } from "./profiles.ts";
import "../src/modules/builtin.ts";

async function loadKernel() {
  const bytes = await readFile(new URL("../src/kernel/wasm-gen/neocad_kernel_bg.wasm", import.meta.url));
  await ensureKernelLoaded(bytes);
}

const sub = (a: number[], b: number[]) => a.map((x, i) => x - b[i]);
const dot = (a: number[], b: number[]) => a.reduce((s, x, i) => s + x * b[i], 0);
const cross = (a: number[], b: number[]) => [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]];
const len = (a: number[]) => Math.hypot(...a);

/** How far a solid is from a right prism: the worst of the four ways it can fail, each in drawing units. */
function prismError(m: Model, feature: string): { flat: number; square: number; depth: number; translated: number } {
  const f = m.featureOf(feature, "extrude");
  const d = m.relationOf(f.depth).args[1] as number;
  const pairs = [...baseOf(m, f.depth)].filter(([t, b]) => m.entities.get(t)?.kind === "point" && m.entities.get(b)?.kind === "point");
  const B = pairs.map(([, b]) => m.coords(b)), T = pairs.map(([t]) => m.coords(t));
  // The base's plane, from the three of its points that span it best.
  let n = [0, 0, 0];
  for (let i = 0; i < B.length; i++) for (let j = i + 1; j < B.length; j++) for (let k = j + 1; k < B.length; k++) {
    const c = cross(sub(B[j], B[i]), sub(B[k], B[i]));
    if (len(c) > len(n)) n = c;
  }
  n = n.map((x) => x / len(n));
  const walls = T.map((t, i) => sub(t, B[i]));
  return {
    flat: Math.max(...B.map((b) => Math.abs(dot(sub(b, B[0]), n)))),
    square: Math.max(...walls.map((w) => len(cross(w, n)))),
    depth: Math.max(...walls.map((w) => Math.abs(len(w) - Math.abs(d)))),
    translated: Math.max(...walls.map((w) => len(sub(w, walls[0])))),
  };
}

function assertPrism(m: Model, feature: string, what: string, tol = 1e-7): void {
  const e = prismError(m, feature);
  for (const [k, v] of Object.entries(e)) assert.ok(v <= tol, `${what}: ${k} off by ${v} — ${JSON.stringify(e)}`);
}

/** A drag as the engine does one: frames of pulls toward a moving target, then the release's solve. */
function drag(m: Model, point: string, by: number[], frames = 12): boolean {
  const from = m.coords(point);
  for (let k = 1; k <= frames; k++) m.solveFrame(pullTo(m, point, from.map((c, i) => c + (by[i] * k) / frames)));
  return m.solve().solved;
}

/** A fresh 3D document's tool host, as the app wires one: nothing chosen to sketch on. */
function host(m: Model, view: View) {
  const repl = new Repl(neocadScope({ model: m, view, viewSize: () => [800, 600] }));
  const ctx = {
    model: m, options: {}, log() {}, requestRender() {}, requestSolve() { m.solve(); }, finish() {},
    pick: () => null, run: (c: string) => repl.eval(c).then(() => {}), act(fn: () => void) { fn(); },
    regionAt: regionAtFor(m, view),
    planeAt: ([sx, sy]: [number, number], plane: { origin: number[]; u: number[]; v: number[] }) => screenToPlane(view, sx, sy, plane),
  } as unknown as ToolContext;
  const at = (sx: number, sy: number): PointerInfo => {
    const { world, plane } = pointOnWorkingPlane(m, view, sx, sy);
    return { world, plane, screen: [sx, sy] } as PointerInfo;
  };
  return { ctx, at, repl };
}

/** The owner's drawing: a rectangle drawn with the tool in a fresh 3D document, extruded 10. */
async function ownersBlock() {
  await loadKernel();
  const m = new Model(3);
  const view: View = { ox: 400, oy: 300, scale: 3 };
  const { ctx, at } = host(m, view);
  const t = new (getToolCtor("rectangle")!)(ctx) as Tool;
  const [a, b] = [at(300, 220), at(500, 380)];
  t.onDown?.(a); t.onMove?.(b); t.onUp?.(b);
  assert.equal(m.solve().solved, true);
  const edge = [...m.entities.values()].find((e) => e.kind === "line")!.name;
  const e = extrude(m, edge, 10);
  assert.equal(m.solve().solved, true);
  const f = m.featureOf(e, "extrude");
  const twinOf = new Map([...baseOf(m, f.depth)].map(([t, b]) => [b, t]));
  return { m, e, f, twinOf, view };
}

test("the owner's case: a lid corner of an extruded rectangle pulled anywhere leaves a right prism, and it solves", async () => {
  for (const by of [[12, -6, 0], [12, -6, -8], [-5, 4, 9], [0, 0, -15]]) {
    const { m, e, f, twinOf } = await ownersBlock();
    const lid = twinOf.get(m.line(f.loops[0][0] as string).refs[0])!;
    assertPrism(m, e, "before");
    const was = m.coords(lid);
    assert.equal(drag(m, lid, by), true, `${JSON.stringify(by)}: solves`);
    assertPrism(m, e, `lid corner pulled by ${JSON.stringify(by)}`);
    // It went somewhere: a drag the relations swallowed whole would pass the prism test and help nobody.
    assert.ok(len(sub(m.coords(lid), was)) > 1, `${JSON.stringify(by)}: the corner moved`);
  }
});

test("a base corner pulled out of the plane takes the lid with it — both ways — and the solid stays a right prism", async () => {
  for (const by of [[0, 0, 7], [4, -3, -6]]) {
    const { m, e, f } = await ownersBlock();
    const base = m.line(f.loops[0][0] as string).refs[0];
    assert.equal(drag(m, base, by), true);
    assertPrism(m, e, `base corner pulled by ${JSON.stringify(by)}`);
  }
});

test("a free pentagon — five typed points, no relation — extruded and pulled stays flat, and a right prism", async () => {
  await loadKernel();
  const m = new Model(3);
  const P = [[0, 0, 0], [30, 0, 0], [40, 20, 0], [15, 35, 0], [-8, 18, 0]].map((c) => m.addPoint(c).name);
  const L = P.map((p, i) => m.addLine(p, P[(i + 1) % P.length]).name);
  const e = extrude(m, L[0], 12);
  assert.equal(m.solve().solved, true);
  const f = m.featureOf(e, "extrude");
  const twinOf = new Map([...baseOf(m, f.depth)].map(([t, b]) => [b, t]));
  assert.equal(drag(m, twinOf.get(P[2])!, [6, -4, 10]), true);
  assertPrism(m, e, "pentagon, lid corner pulled");
  assert.equal(drag(m, P[4], [0, 0, -9]), true);
  assertPrism(m, e, "pentagon, base corner pulled");
});

test("a sketch-mode profile (every point onPlane a tilted frame) makes the same solid as it always did, to 1e-9, and nothing reads redundant", async () => {
  await loadKernel();
  const m = new Model(3);
  const t = tiltedFrame(m);
  const { points, lines } = polygon(m, t, [[0, 0], [40, 0], [40, 30], [0, 30]]);
  const e = extrude(m, lines[0], 20);
  assert.equal(m.solve().solved, true);
  const f = m.featureOf(e, "extrude");
  const twinOf = new Map([...baseOf(m, f.depth)].map(([tw, b]) => [b, tw]));
  const z = m.planeValues(t.name)!.n;
  const check = (what: string) => {
    for (const p of points) {
      const want = m.coords(p).map((c, i) => c + 20 * z[i]);
      assert.ok(len(sub(m.coords(twinOf.get(p)!), want)) <= 1e-9, `${what}: ${p}'s twin is its base + 20 along the frame's +z`);
    }
    assert.deepEqual(m.diagnose().redundant, [], `${what}: nothing redundant`);
  };
  check("as made");
  assert.equal(drag(m, twinOf.get(points[1])!, [5, 3, 4]), true);
  check("after a lid corner is pulled");
});
