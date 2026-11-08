// Sketch mode (docs/plans/sketch-mode.md). The owner: *"I need a way to
// natively sketch on a plane without it being a special feature. It should
// just add 'on plane' relations to each entity as it gets sketched. Also when I
// select this mode it should go normal to the plane/face."*
//
// Sketch mode is a mode, not a feature: the work plane set (`workplane(…)`),
// the view square to it, and everything drawn held on it by `onPlane`, one
// relation per point. These tests hold the house to that.
//
// **Table-driven over the tool registry**, so a drawing tool added later that
// forgets the plane fails here: every registered tool is either in `DRAWN`
// (with a gesture to drive it) or in `NOT_DRAWN` (with the reason it makes no
// point of its own), and a tool in neither fails the first test by name. The
// check itself is generic over kinds: the points a tool made are every new
// point entity — whatever kind of curve they belong to — so a new curve kind
// is held to the same rule without this file naming it.

import { test } from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { ensureKernelLoaded } from "../src/kernel/problem.ts";
import { Model } from "../src/model.ts";
import { extrude, revolve, set } from "../src/operations.ts";
import { neocadScope } from "../src/replenv.ts";
import { Repl } from "../src/repl.ts";
import { open, save } from "../src/persist.ts";
import { pointOnWorkingPlane } from "../src/workplane.ts";
import { findLoops } from "../src/loops.ts";
import { sketchFrameFor } from "../src/sketchface.ts";
import { activePlane, focusOf } from "../src/activeplane.ts";
import { screenToPlane, worldToScreen, type View } from "../src/view.ts";
import { getToolCtor, listTools, type PointerInfo, type Tool, type ToolContext } from "../src/tools/tool.ts";
import { regionAtFor } from "./featurectx.ts";
import { tiltedFrame } from "./frames.ts";
import "../src/modules/builtin.ts"; // registers the built-in tools, as the app does

async function loadKernel() {
  const bytes = await readFile(new URL("../src/kernel/wasm-gen/neocad_kernel_bg.wasm", import.meta.url));
  await ensureKernelLoaded(bytes);
}

type At = (sx: number, sy: number) => PointerInfo;
type Hand = { down(p: PointerInfo): void; move(p: PointerInfo): void; up(p: PointerInfo): void };
/** One way of drawing with a tool, around the pixel `c`: what its hand does, and what it is armed with. */
interface Gesture { options?: Record<string, unknown>; draw(t: Tool & Record<string, any>, at: At, c: [number, number]): void }

const click = (t: Tool, p: PointerInfo) => { t.onDown?.(p); t.onUp?.(p); };
const drag = (t: Tool, a: PointerInfo, b: PointerInfo) => { t.onDown?.(a); t.onMove?.(b); t.onUp?.(b); };

/**
 * **Every tool that puts a point where the hand is**, and how to draw with it
 * — every method the tool can be locked to. Clicks are free (no snap): a snap
 * to a vertex, a midpoint or a crossing pins the point outright and is held by
 * that instead (tools/place.ts), which `app3d.test.ts` checks.
 */
const DRAWN: Record<string, Gesture[]> = {
  point: [{ draw: (t, at, [x, y]) => click(t, at(x + 5, y + 5)) }],
  line: [{ draw: (t, at, [x, y]) => { click(t, at(x - 30, y)); click(t, at(x + 30, y + 10)); click(t, at(x + 10, y + 40)); t.onCancel?.(); } }],
  rectangle: [{ draw: (t, at, [x, y]) => drag(t, at(x - 30, y - 20), at(x + 30, y + 20)) }],
  polygon: [{ draw: (t, at, [x, y]) => drag(t, at(x, y), at(x + 30, y + 5)) }],
  slot: [{ draw: (t, at, [x, y]) => { drag(t, at(x - 30, y), at(x + 30, y)); click(t, at(x, y + 12)); } }],
  circle: [
    { options: { method: "centre" }, draw: (t, at, [x, y]) => drag(t, at(x, y), at(x + 30, y)) },
    { options: { method: "3pt" }, draw: (t, at, [x, y]) => { click(t, at(x - 30, y)); click(t, at(x, y - 30)); click(t, at(x + 30, y)); } },
  ],
  arc: [
    { options: { method: "centre" }, draw: (t, at, [x, y]) => { click(t, at(x, y)); click(t, at(x + 30, y)); click(t, at(x, y - 30)); } },
    { options: { method: "3pt" }, draw: (t, at, [x, y]) => { drag(t, at(x - 30, y), at(x + 30, y)); click(t, at(x, y - 20)); } },
  ],
  ellipse: [{ draw: (t, at, [x, y]) => { drag(t, at(x, y), at(x + 40, y)); click(t, at(x, y + 15)); } }],
  spline: [{ draw: (t, at, [x, y]) => { for (const [dx, dy] of [[-40, 0], [-10, -20], [20, 10], [40, -5]]) t.onUp?.(at(x + dx, y + dy)); t.confirm!(); } }],
};

/**
 * **Every other tool, with why it puts no point where the hand is.** A tool in
 * neither table fails the first test: say which it is.
 */
const NOT_DRAWN: Record<string, string> = {
  region: "makes a region of faces already drawn — no point",
  fillet: "rounds a corner already drawn: its new points are held on the lines it trims, which are on the plane",
  bevel: "cuts a corner already drawn, as the fillet does",
  trim: "cuts curves already drawn at their crossings: its points are on the curves",
  extend: "carries a curve's end to another curve: on that curve",
  offset: "copies — held to the plane by the copies' own test below",
  mirror: "copies — the copies' test below",
  pattern: "copies — the copies' test below",
  dimension: "makes relations, no point",
  constrain: "makes relations, no point",
  extrude: "a solid feature: its points are the profile's, moved",
  revolve: "a solid feature: its points are the profile's, turned",
  sketch: "chooses the plane; draws nothing",
  round: "a solid's edge fillet: the kernel's, no model point",
  chamfer: "a solid's edge chamfer: the kernel's, no model point",
  surface: "a surface of faces already drawn — no point",
};

test("every registered tool is either a drawing tool with a gesture here, or says why it makes no point of its own", () => {
  for (const name of listTools()) {
    const inDrawn = Object.hasOwn(DRAWN, name), inNot = Object.hasOwn(NOT_DRAWN, name);
    assert.ok(inDrawn !== inNot,
      `${name}: add it to DRAWN in test/sketchmode.test.ts with a gesture (every point it makes must be held onPlane on the work plane), `
      + "or to NOT_DRAWN with the reason it makes none");
  }
  for (const name of [...Object.keys(DRAWN), ...Object.keys(NOT_DRAWN)]) {
    assert.ok(getToolCtor(name), `${name} is in a table here but no module registers it`);
  }
});

// --- the planes --------------------------------------------------------------------

/** A 60 × 40 × 20 block off the ground, made the way the extrude tool makes it. */
function block() {
  const m = new Model(3);
  const s = neocadScope({ model: m }) as Record<string, (...a: unknown[]) => unknown>;
  const pts = [[0, 0], [60, 0], [60, 40], [0, 40]].map(([x, y]) => s.pt(x, y, 0) as string);
  const ls = pts.map((p, i) => s.ln(p, pts[(i + 1) % 4]) as string);
  const e = extrude(m, ls[0], 20);
  assert.equal(m.solve().solved, true);
  return { m, e };
}

/** The face of `m` whose plane's normal and a point on it pass `pred`, as sketch on face names it, seen from outside along `toward`. */
function faceRef(m: Model, toward: number[], pred: (n: number[], o: number[]) => boolean): string {
  for (const l of findLoops(m)) {
    const { u, v, origin } = l.plane;
    const n = [u[1] * v[2] - u[2] * v[1], u[2] * v[0] - u[0] * v[2], u[0] * v[1] - u[1] * v[0]];
    if (pred(n, origin)) return sketchFrameFor(m, l, toward);
  }
  throw new Error("no such face");
}

interface Stage { m: Model; ref: string; centre: number[] }
/** Every kind of plane the owner listed: the ground's three, a block's top and wall, a revolve's end, a circle's face, a tilted frame, three points at an angle. */
const PLANES: Record<string, () => Stage> = {
  Top: () => ({ m: new Model(3), ref: "origin", centre: [10, 5, 0] }),
  Front: () => ({ m: new Model(3), ref: "origin.xz", centre: [10, 0, 5] }),
  Right: () => ({ m: new Model(3), ref: "origin.yz", centre: [0, 10, 5] }),
  "a block's top": () => {
    const { m } = block();
    return { m, ref: faceRef(m, [0, 0, 1], (n, o) => Math.abs(n[2]) > 0.9 && Math.abs(o[2] - 20) < 1e-6), centre: [30, 20, 20] };
  },
  "a block's side wall": () => {
    const { m } = block();
    return { m, ref: faceRef(m, [0, -1, 0], (n, o) => Math.abs(n[1]) > 0.9 && Math.abs(o[1]) < 1e-6), centre: [30, 0, 10] };
  },
  "a revolve's end": () => {
    const m = new Model(3);
    const s = neocadScope({ model: m }) as Record<string, (...a: unknown[]) => unknown>;
    const pts = [[10, 0], [30, 0], [30, 20], [10, 20]].map(([x, z]) => s.pt(x, 0, z) as string);
    const ls = pts.map((p, i) => s.ln(p, pts[(i + 1) % 4]) as string);
    revolve(m, ls[0], "origin.z", Math.PI / 2);
    assert.equal(m.solve().solved, true);
    // A quarter turn about z from the x–z plane: the end is the y–z plane's x < 0 side … or +y; whichever is not the start.
    const ref = faceRef(m, [-1, 0, 0], (n, o) => Math.abs(n[0]) > 0.9 && Math.abs(o[0]) < 1e-6);
    return { m, ref, centre: [0, 20, 10] };
  },
  "a cylinder's top": () => {
    const m = new Model(3);
    const s = neocadScope({ model: m }) as Record<string, (...a: unknown[]) => unknown>;
    const e = extrude(m, s.circle(s.pt(0, 0, 0) as string, 30) as string, 10);
    assert.equal(m.solve().solved, true);
    return { m, ref: m.featureOf(e, "extrude").twins[0][0], centre: [0, 0, 10] };
  },
  "a tilted frame": () => {
    const m = new Model(3);
    const f = tiltedFrame(m);
    m.setDefaultFrame(null);
    return { m, ref: "t", centre: f.at(20, 20) };
  },
  "three points at an angle": () => {
    const m = new Model(3);
    const s = neocadScope({ model: m }) as Record<string, (...a: unknown[]) => unknown>;
    const ps = [[0, 0, 0], [40, 0, 20], [0, 30, 10]].map((p) => s.pt(...p) as string);
    ps.forEach((p, i) => s.fix(p, [[0, 0, 0], [40, 0, 20], [0, 30, 10]][i]));
    return { m, ref: ps.join("."), centre: [15, 10, 10] };
  },
};

/**
 * A tool's context in the app's shape: clicks read on the working plane through
 * `view` as the engine reads them, a real command line for `workplane(…)`.
 */
function host(m: Model, view: View, options: Record<string, unknown> = {}) {
  const repl = new Repl(neocadScope({ model: m, view, viewSize: () => [800, 600] }));
  const log: string[] = [];
  const ctx = {
    model: m, options, log: (l: string) => { log.push(l); },
    requestRender() {}, requestSolve() { m.solve(); }, finish() {},
    pick: () => null, run: (c: string) => repl.eval(c).then(() => {}), act(fn: () => void) { fn(); },
    regionAt: regionAtFor(m, view),
    planeAt: ([sx, sy]: [number, number], plane: { origin: number[]; u: number[]; v: number[] }) => screenToPlane(view, sx, sy, plane),
  } as unknown as ToolContext;
  const at: At = (sx, sy) => {
    const { world, plane } = pointOnWorkingPlane(m, view, sx, sy);
    return { world, plane, screen: [sx, sy] };
  };
  return { ctx, at, repl, log };
}

/** How far a point is off a plane reference, now. */
function offPlane(m: Model, ref: string, p: string): number {
  const pv = m.planeValues(ref)!;
  const x = m.coords(p);
  return Math.abs([0, 1, 2].reduce((s, i) => s + (x[i] - pv.origin[i]) * pv.n[i], 0));
}

/** The points `m` gained since `before`, and the plane each is held on by onPlane (the ones `ref` holds). */
function newPoints(m: Model, before: ReadonlySet<string>): string[] {
  return [...m.entities.values()].filter((e) => e.kind === "point" && !before.has(e.name)).map((e) => e.name);
}
const heldOn = (m: Model, p: string, ref: string) =>
  [...m.relations.values()].some((r) => r.op === "onPlane" && r.args[0] === p && r.args[1] === ref);

test("on every kind of plane, every point every drawing tool makes is held by onPlane to it — one relation per point — and lies on it", async () => {
  await loadKernel();
  const failures: string[] = [];
  for (const [plane, stage] of Object.entries(PLANES)) {
    for (const [tool, gestures] of Object.entries(DRAWN)) {
      for (const g of gestures) {
        const label = `${plane}: ${tool}${g.options?.method ? ` (${g.options.method})` : ""}`;
        const { m, ref, centre } = stage();
        const view: View = { ox: 400, oy: 300, scale: 2 };
        const { ctx, at, repl } = host(m, view, { ...(g.options ?? {}) });
        const set = await repl.eval(`workplane(${JSON.stringify(ref)})`);
        if (!set.ok) { failures.push(`${label}: workplane refused — ${set.error?.message}`); continue; }
        const before = new Set(m.entities.keys());
        const t = new (getToolCtor(tool)!)(ctx) as Tool & Record<string, any>;
        try {
          g.draw(t, at, worldToScreen(view, centre) as [number, number]);
        } catch (e) {
          failures.push(`${label}: threw ${(e as Error).message}`);
          continue;
        }
        const pts = newPoints(m, before);
        if (!pts.length) { failures.push(`${label}: made no point`); continue; }
        const unheld = pts.filter((p) => !heldOn(m, p, ref));
        if (unheld.length) failures.push(`${label}: ${unheld.join(", ")} of ${pts.length} not held onPlane to ${ref}`);
        const twice = pts.filter((p) => [...m.relations.values()].filter((r) => r.op === "onPlane" && r.args[0] === p).length > 1);
        if (twice.length) failures.push(`${label}: ${twice.join(", ")} held twice`);
        if (!m.solve().solved) failures.push(`${label}: did not solve`);
        const off = pts.filter((p) => offPlane(m, ref, p) > 1e-6);
        if (off.length) failures.push(`${label}: ${off.join(", ")} off the plane`);
      }
    }
  }
  assert.deepEqual(failures, []);
});

// --- copies ---------------------------------------------------------------------------

/**
 * A rectangle and a circle drawn on `ref` with the tools — every point held to
 * it, the circle par to it — and a line on it to mirror about.
 */
async function drawnOn(stage: Stage) {
  const { m, ref, centre } = stage;
  const view: View = { ox: 400, oy: 300, scale: 2 };
  const { ctx, at, repl } = host(m, view);
  assert.equal((await repl.eval(`workplane(${JSON.stringify(ref)})`)).ok, true);
  const c = worldToScreen(view, centre) as [number, number];
  const names = () => new Set(m.entities.keys());
  let before = names();
  DRAWN.rectangle[0].draw(new (getToolCtor("rectangle")!)(ctx) as never, at, c);
  const rect = [...m.entities.values()].filter((e) => e.kind === "line" && !before.has(e.name)).map((e) => e.name);
  before = names();
  DRAWN.circle[0].draw(new (getToolCtor("circle")!)({ ...ctx, options: { method: "centre" } }) as never, at, [c[0] + 100, c[1]]);
  const circle = [...m.entities.values()].find((e) => e.kind === "circle" && !before.has(e.name))!.name;
  before = names();
  const lt = new (getToolCtor("line")!)(ctx) as Tool;
  click(lt, at(c[0] - 80, c[1] - 60));
  click(lt, at(c[0] - 80, c[1] + 60));
  lt.onCancel?.();
  const axis = [...m.entities.values()].find((e) => e.kind === "line" && !before.has(e.name))!.name;
  const centrePoint = [...m.entities.values()].find((e) => e.kind === "point" && !before.has(e.name))!.name;
  assert.equal(m.solve().solved, true);
  return { m, ref, repl, rect, circle, axis, centrePoint };
}

test("copies of geometry on the plane — offset, mirror, linear and circular patterns — are held to the same plane, every copied point", async () => {
  await loadKernel();
  const failures: string[] = [];
  for (const plane of ["a tilted frame", "a block's top", "Front"]) {
    for (const op of ["offset", "mirror", "linear", "circular"]) {
      let d: Awaited<ReturnType<typeof drawnOn>>;
      try {
        d = await drawnOn(PLANES[plane]());
      } catch (e) {
        failures.push(`${plane}: ${op}: could not draw the seed — ${(e as Error).message}`);
        continue;
      }
      const { m, ref, repl, rect, circle, axis, centrePoint } = d;
      const before = new Set(m.entities.keys());
      const what = JSON.stringify([...rect, circle]);
      const line = op === "offset" ? `offset(${JSON.stringify(rect)}, 3)` : op === "mirror" ? `mirror(${what}, "${axis}")`
        : op === "linear" ? `linear(${what}, 70, 0, 3)` : `circular(${what}, "${centrePoint}", 2 * Math.PI, 3)`;
      const r = await repl.eval(line);
      if (!r.ok) { failures.push(`${plane}: ${line} refused — ${r.error?.message}`); continue; }
      const pts = newPoints(m, before);
      const unheld = pts.filter((p) => !heldOn(m, p, ref));
      if (unheld.length) failures.push(`${plane}: ${op}: ${unheld.length} of ${pts.length} copied points not held onPlane to ${ref}`);
      if (!m.solve().solved) failures.push(`${plane}: ${op}: did not solve`);
      // Pushed off the plane, they come back: held, not merely placed.
      const pv = m.planeValues(ref)!;
      for (const p of pts) m.point(p).varIndices.forEach((gi, i) => m.problem.setVar(gi, m.problem.getVar(gi) + 3 * pv.n[i]));
      m.solve();
      const off = pts.filter((p) => offPlane(m, ref, p) > 1e-6);
      if (off.length) failures.push(`${plane}: ${op}: ${off.length} of ${pts.length} copied points stayed off the plane when pushed`);
    }
  }
  assert.deepEqual(failures, []);
});

// --- focus ---------------------------------------------------------------------------------

test("everything drawn on the plane is in focus — a spline too, and any kind, by the points it is built of", async () => {
  await loadKernel();
  const { m, ref, centre } = PLANES.Top();
  const view: View = { ox: 400, oy: 300, scale: 2 };
  const { ctx, at, repl } = host(m, view);
  assert.equal((await repl.eval(`workplane(${JSON.stringify(ref)})`)).ok, true);
  const c = worldToScreen(view, centre) as [number, number];
  for (const [tool, gestures] of Object.entries(DRAWN)) {
    for (const g of gestures) g.draw(new (getToolCtor(tool)!)({ ...ctx, options: { ...(g.options ?? {}) } }) as never, at, c);
  }
  assert.equal(m.solve().solved, true);
  const focus = focusOf(m, activePlane(m, 2))!;
  const out = [...m.entities.values()].filter((e) => !focus.has(e.name)).map((e) => `${e.kind} ${e.name}`);
  assert.deepEqual(out, [], "nothing drawn on the plane is dimmed");
});
