// The solids the depth measurement draws and the depth e2e tests look at —
// one definition, so the views a test pins are views of the scene that was
// measured. Each is REPL source, typed into a fresh app.

import assert from "node:assert/strict";
import { existsSync } from "node:fs";
import { axisFrame, type AppContext } from "./harness.ts";

export interface Scene {
  name: string;
  what: string;
  /** A lone convex solid: the painter's cannot sort it wrong, so the two renderers must agree off the outlines. */
  convex?: boolean;
  /** Frames timed in the app, both ways. */
  timed?: boolean;
  source: string;
}

/**
 * Each scene is REPL source run on a fresh app with the suite's kernel-aligned
 * frame `f` as the default. `P` places a point, `poly` a closed polygon of
 * lines held on a frame's plane; both persist into the scope.
 */
export const HELPERS = `
P = (c) => model.addPoint(c).name;
poly = (cs, fr) => {
  const ps = cs.map(P);
  const ls = ps.map((p, i) => model.addLine(p, ps[(i + 1) % ps.length]).name);
  for (const p of ps) onplane(p, fr);
  return ls;
};
"ok"`;

export const SCENES: Scene[] = [
  {
    name: "box",
    what: "a lone box, 40 × 30 × 20 — convex: the painter's cannot sort it wrong",
    convex: true,
    source: `ls = poly([[0,0,0],[40,0,0],[40,30,0],[0,30,0]], "f"); extrude(ls[0], 20)`,
  },
  {
    name: "cylinder",
    what: "a lone cylinder, r 15 × 25 — convex, its wall a strip of quads",
    convex: true,
    source: `c = P([0,0,0]); onplane(c, "f"); k = model.addCircle(c, 15, "f").name; extrude(k, 25)`,
  },
  {
    name: "revolve-355",
    what: "the register's 355° revolve: a 30 × 30 block with a bore, turned 355° about f.y",
    source: `ls = poly([[10,-15,0],[40,-15,0],[40,15,0],[10,15,0]], "f");
      c = P([25,0,0]); onplane(c, "f"); bore = model.addCircle(c, 6, "f").name;
      hole(revolve(ls[0], "f.y", 355 * Math.PI / 180), bore)`, // a hole is said (regions-as-operations.md)
  },
  {
    name: "interpenetrating",
    // Two bodies, as the name says: driven into the bar, the second would add
    // to it by default (docs/plans/solids-kernel.md) and be one solid with no
    // interpenetration left to draw.
    what: "two interpenetrating extrudes: a 60 × 20 × 20 bar, and a 15 × 40 bar on a frame turned 20° driven 45 through it",
    source: `a = poly([[0,0,0],[60,0,0],[60,20,0],[0,20,0]], "f"); extrude(a[0], 20);
      t = 20 * Math.PI / 180; X = [Math.cos(t), Math.sin(t), 0]; O = [20, -12, 0];
      at = (u, v) => [O[0] + u * X[0], O[1] + u * X[1], v];
      model.addFrame(P(at(0, 0)), P(at(1, 0)), P(at(0, 1)), "g");
      b = poly([at(0,-10), at(15,-10), at(15,30), at(0,30)], "g"); extrude(b[0], -45, "g", { mode: "new" })`,
  },
  {
    name: "stepped-boss",
    what: "the stepped block — a 40 × 30 plate cut at 15, the halves extruded 10 and 20 — with a boss r 5 × 8 on the tall step's front wall",
    timed: true,
    source: `ls = poly([[0,0,0],[40,0,0],[40,30,0],[0,30,0]], "f");
      e = [P([15,-10,0]), P([15,40,0])]; for (const p of e) onplane(p, "f"); model.addLine(e[0], e[1]);
      extrude(ls[3], 10); extrude(ls[1], 20);
      model.addFrame(P([27,0,10]), P([28,0,10]), P([27,0,11]), "h");
      c = P([27.5,0,10]); onplane(c, "h"); k = model.addCircle(c, 5, "h").name; extrude(k, 8, "h")`,
  },
  {
    name: "filleted-turn",
    what: "a full turn of a 20 × 20 profile with one corner filleted r 6 — many strips",
    timed: true,
    source: `ls = poly([[10,0,0],[30,0,0],[30,20,0],[10,20,0]], "f"); fillet(ls[1], ls[2], 6); revolve(ls[0], "f.y")`,
  },
  {
    name: "boss-plate",
    // Last, so the measurement's seeds for the scenes before it are unchanged.
    what: "a boss on a plate: a 60 × 40 × 8 plate, and a boss r 10 × 15 on a frame on its lid",
    source: `ls = poly([[0,0,0],[60,0,0],[60,40,0],[0,40,0]], "f"); extrude(ls[0], 8);
      model.addFrame(P([30,20,8]), P([31,20,8]), P([30,21,8]), "h");
      c = P([30,20,8]); onplane(c, "h"); k = model.addCircle(c, 10, "h").name; extrude(k, 15, "h")`,
  },
];

/** The scene by name. */
export function scene(name: string): Scene {
  const found = SCENES.find((x) => x.name === name);
  if (!found) throw new Error(`no scene ${name}`);
  return found;
}

const KERNEL_BUILT = existsSync(new URL("../../src/solids/smlib-gen/smlib.mjs", import.meta.url));

/** Builds a scene in the app on the suite's kernel-aligned default frame `f`, solved and drawn. */
export async function build(app: AppContext, source: string): Promise<void> {
  await axisFrame(app);
  for (const src of [HELPERS, source, "solve(); refresh(); 'built'"]) {
    const r = await app.repl(src);
    assert.equal(r.ok, true, `${src}\n→ ${r.error}`);
  }
  assert.ok((await app.repl("model.features.size")).value as number > 0, "a solid was built");
  // A boss on a body adds to it (docs/plans/solids-kernel.md), and the body is
  // then the solid kernel's, which answers from its Worker a moment later —
  // the first time, after the Worker has started. The picture is asked of
  // once it has. (With no kernel build there is no answer to wait for: the
  // body is drawn as its features, and the tests that need it say so.)
  if (KERNEL_BUILT) await app.page.waitForFunction(() => {
    const b = (window as never as { __neocad: { bodies?: { settled: boolean } } }).__neocad.bodies;
    return !b || b.settled;
  }, undefined, { timeout: 20_000 });
}

/**
 * Turns the app's view to `orbitBy(fitted, yaw, pitch)`, where `fitted` is the
 * top view centred on the scene's points with the farthest of them `fill` of
 * the canvas's short side out — the measurement's own views, so a test can
 * pin one by the angles it was drawn at — then moved `shift` pixels on screen
 * (to keep it clear of the panels in a picture), and redraws.
 */
export async function look(app: AppContext, yaw: number, pitch: number, fill = 0.32, shift: [number, number] = [0, 0]): Promise<void> {
  await app.page.evaluate(async ([yaw, pitch, fill, dx, dy]) => {
    const viewPath = "/src/view.ts";
    const { assignView, orbitBy } = await import(viewPath);
    const hook = (window as never as { __neocad: {
      model: { entities: Map<string, { kind: string; name: string }>; coords(n: string): number[] };
      engine: { view: unknown }; render(): void;
    } }).__neocad;
    const cv = document.getElementById("cv") as HTMLCanvasElement;
    const W = Math.round(cv.getBoundingClientRect().width), H = Math.round(cv.getBoundingClientRect().height);
    const pts = [...hook.model.entities.values()].filter((e) => e.kind === "point").map((e) => hook.model.coords(e.name));
    const c = [0, 1, 2].map((i) => (Math.min(...pts.map((p) => p[i])) + Math.max(...pts.map((p) => p[i]))) / 2);
    const r = Math.max(...pts.map((p) => Math.hypot(p[0] - c[0], p[1] - c[1], p[2] - c[2])));
    const scale = (fill * Math.min(W, H)) / r;
    const turned = orbitBy({ ox: W / 2 - c[0] * scale, oy: H / 2 + c[1] * scale, scale, target: c }, yaw, pitch);
    assignView(hook.engine.view, { ...turned, ox: turned.ox + dx, oy: turned.oy + dy });
    hook.render();
  }, [yaw, pitch, fill, ...shift]);
}

/** Points the app's camera along −`toward`, +z as near up as it goes, fitting the scene as `look` does, and redraws. */
export async function lookAlong(app: AppContext, toward: number[], fill = 0.3, shift: [number, number] = [100, -60]): Promise<void> {
  await app.page.evaluate(async ([toward, fill, dx, dy]) => {
    const viewPath = "/src/view.ts";
    const { assignView } = await import(viewPath);
    const hook = (window as never as { __neocad: {
      model: { entities: Map<string, { kind: string; name: string }>; coords(n: string): number[] };
      engine: { view: unknown }; render(): void;
    } }).__neocad;
    const unit = (v: number[]) => { const l = Math.hypot(...v); return v.map((x) => x / l); };
    const cross = (a: number[], b: number[]) => [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]];
    const dot = (a: number[], b: number[]) => a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
    const t = unit(toward);
    const right = unit(cross([0, 0, 1], t));
    const up = cross(t, right);
    const cv = document.getElementById("cv") as HTMLCanvasElement;
    const W = cv.getBoundingClientRect().width, H = cv.getBoundingClientRect().height;
    const pts = [...hook.model.entities.values()].filter((e) => e.kind === "point").map((e) => hook.model.coords(e.name));
    const c = [0, 1, 2].map((i) => (Math.min(...pts.map((p) => p[i])) + Math.max(...pts.map((p) => p[i]))) / 2);
    const r = Math.max(...pts.map((p) => Math.hypot(p[0] - c[0], p[1] - c[1], p[2] - c[2])));
    const scale = (fill * Math.min(W, H)) / r;
    // The scene's middle on the canvas's, moved by the shift.
    assignView(hook.engine.view, { scale, right, up, target: c, ox: W / 2 + dx - dot(c, right) * scale, oy: H / 2 + dy + dot(c, up) * scale });
    hook.render();
  }, [toward, fill, ...shift] as [number[], number, number, number]);
}

/**
 * The app's own frames, timed: `renderer` is what the app says it drew faces
 * with, `submit` the milliseconds `render()` holds the main thread, `frame` the
 * milliseconds between presented frames.
 */
export interface Frames { renderer: string; submit: number; frame: number; frames: number; faces: number }

/**
 * The app's real frames, in the page: the view turned a little each frame, as
 * an orbit turns it, `render()` called, and the next animation frame awaited
 * — so a frame the renderer has not finished, on the main thread or in the GPU
 * process, holds the next one back and shows in the interval. Timing the two
 * renderers on canvases of their own instead was tried and abandoned: Chrome
 * moves a 2D canvas that is read back into CPU memory, so forcing a painted
 * frame to finish changed what was being timed.
 */
export function appFrames(args: { frames: number }) {
  return (async () => {
    const viewPath = "/src/view.ts", facesPath = "/src/faces.ts";
    const { assignView, orbitBy } = await import(viewPath);
    const { visibleFaces } = await import(facesPath);
    const hook = (window as never as { __neocad: {
      model: { entities: Map<string, { kind: string; name: string }>; coords(n: string): number[] };
      engine: { view: { ox: number; oy: number; scale: number } }; render(): void; faces?: string;
    } }).__neocad;
    const { model, engine } = hook;
    const cv = document.getElementById("cv") as HTMLCanvasElement;
    const W = cv.getBoundingClientRect().width, H = cv.getBoundingClientRect().height;
    const pts = [...model.entities.values()].filter((e) => e.kind === "point").map((e) => model.coords(e.name));
    const c = [0, 1, 2].map((i) => (Math.min(...pts.map((p) => p[i])) + Math.max(...pts.map((p) => p[i]))) / 2);
    const r = Math.max(...pts.map((p) => Math.hypot(p[0] - c[0], p[1] - c[1], p[2] - c[2])));
    const scale = (0.32 * Math.min(W, H)) / r;
    // A three-quarter view to start from, the same for both renderers.
    assignView(engine.view, orbitBy({ ox: W / 2 - c[0] * scale, oy: H / 2 + c[1] * scale, scale, target: c }, 0.6, 0.5));
    const next = () => new Promise((done) => requestAnimationFrame(done));
    const turn = () => assignView(engine.view, orbitBy(engine.view, 0.02, 0.005));
    for (let i = 0; i < 10; i++) { turn(); hook.render(); await next(); }
    let submit = 0;
    const t0 = performance.now();
    for (let i = 0; i < args.frames; i++) {
      turn();
      const t = performance.now();
      hook.render();
      submit += performance.now() - t;
      await next();
    }
    const frame = (performance.now() - t0) / args.frames;
    return { renderer: hook.faces ?? "painter's", submit: submit / args.frames, frame, frames: args.frames, faces: (visibleFaces(model, engine.view) as unknown[]).length };
  })();
}

