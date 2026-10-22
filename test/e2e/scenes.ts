// The solids the depth measurement draws and the depth e2e tests look at —
// one definition, so the views a test pins are views of the scene that was
// measured. Each is REPL source, typed into a fresh app.

import assert from "node:assert/strict";
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
      c = P([25,0,0]); onplane(c, "f"); model.addCircle(c, 6, "f");
      revolve(ls[0], "f.y", 355 * Math.PI / 180)`,
  },
  {
    name: "interpenetrating",
    what: "two interpenetrating extrudes: a 60 × 20 × 20 bar, and a 15 × 40 bar on a frame turned 20° driven 45 through it",
    source: `a = poly([[0,0,0],[60,0,0],[60,20,0],[0,20,0]], "f"); extrude(a[0], 20);
      t = 20 * Math.PI / 180; X = [Math.cos(t), Math.sin(t), 0]; O = [20, -12, 0];
      at = (u, v) => [O[0] + u * X[0], O[1] + u * X[1], v];
      model.addFrame(P(at(0, 0)), P(at(1, 0)), P(at(0, 1)), "g");
      b = poly([at(0,-10), at(15,-10), at(15,30), at(0,30)], "g"); extrude(b[0], -45, "g")`,
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
];

/** The scene by name. */
export function scene(name: string): Scene {
  const found = SCENES.find((x) => x.name === name);
  if (!found) throw new Error(`no scene ${name}`);
  return found;
}

/** Builds a scene in the app on the suite's kernel-aligned default frame `f`, solved and drawn. */
export async function build(app: AppContext, source: string): Promise<void> {
  await axisFrame(app);
  for (const src of [HELPERS, source, "solve(); refresh(); 'built'"]) {
    const r = await app.repl(src);
    assert.equal(r.ok, true, `${src}\n→ ${r.error}`);
  }
  assert.ok((await app.repl("model.features.size")).value as number > 0, "a solid was built");
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
