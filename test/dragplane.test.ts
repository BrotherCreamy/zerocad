// A drag of a point held on a plane moves it in that plane (src/tools/dragplane.ts;
// docs/plans/flat-profile.md, bug 83). The owner's circle, held on a face of a
// free prism by `onplane`, dragged by finger: the cursor was read on the
// screen-parallel plane, so the target sat off the face, the relation refused
// it, and what gave was the prism — tilted a hair toward the finger each
// frame while the circle stayed put (0.003 for forty pixels, measured). Read
// on the face's plane, the circle slides and the prism stands still.

import { test } from "node:test";
import assert from "node:assert/strict";
import { Model } from "../src/model.ts";
import { Repl } from "../src/repl.ts";
import { neocadScope } from "../src/replenv.ts";
import { coplanar, onPlane } from "../src/relations/basic.ts";
import { ToolEngine } from "../src/tools/engine.ts";
import { heldPlane } from "../src/tools/dragplane.ts";
import { orbitBy, worldToScreen, type Plane, type View } from "../src/view.ts";
import { cross3, dot3, sub3, unit3 } from "../src/vec3.ts";
import "../src/modules/builtin.ts";
import { loadSolver } from "./solids/scene.ts";

const normalOf = (p: Plane) => unit3(cross3(p.u, p.v))!;
const offPlaneOf = (p: Plane, at: number[]) => Math.abs(dot3(sub3(at, p.origin), normalOf(p)));

async function typed(): Promise<{ m: Model; say: (s: string) => Promise<unknown> }> {
  await loadSolver();
  const m = new Model(3);
  const repl = new Repl(neocadScope({ model: m }));
  const say = async (src: string) => { const r = await repl.eval(src); if (!r.ok) throw new Error(`${src}: ${(r.error as Error | undefined)?.message}`); return r.value; };
  return { m, say };
}

test("heldPlane: the plane a point is held on — by onplane (a frame, three points, a face), coplanar, or a feature's flat", async () => {
  const { m, say } = await typed();
  await say("a = pt(0, 0, 0); b = pt(40, 0, 0); c = pt(40, 30, 0); d = pt(0, 30, 0); ln(a, b); ln(b, c); ln(c, d); ln(d, a); extrude(\"l1\", 20)");
  await say("q = pt(5, 5, 20); onplane(q, \"p5.p6.p8\")");
  await say("g = pt(7, 7, 0); onplane(g, \"origin\")");
  await say("k = pt(1, 2, 3); coplanar(k, \"p2\", \"p3\", \"p6\")");
  m.solve();
  // The prism is free, and the coplanar point may have turned it a little: each plane is read off its own points.
  const planeOf = (a: string, b: string, c: string) => ({ at: m.coords(a), n: unit3(cross3(sub3(m.coords(b), m.coords(a)), sub3(m.coords(c), m.coords(a))))! });
  const same = (p: Plane | null, want: { at: number[]; n: number[] }) =>
    !!p && Math.abs(Math.abs(dot3(normalOf(p), want.n)) - 1) < 1e-9 && Math.abs(dot3(sub3(p.origin, want.at), want.n)) < 1e-9;
  // A point on the lid's plane, by three of the lid's points: the lid's plane, facing as the three turn it.
  const lid = heldPlane(m, ["p9"]);
  assert.ok(same(lid, planeOf("p5", "p6", "p8")), "held on the lid");
  assert.ok(offPlaneOf(lid!, m.coords("p9")) < 1e-9);
  // On the origin's plane.
  const ground = heldPlane(m, ["p10"])!;
  assert.ok(ground && Math.abs(ground.origin[2]) < 1e-12 && Math.abs(Math.abs(normalOf(ground)[2]) - 1) < 1e-9);
  // Coplanar with a wall's three corners: that wall's plane.
  assert.ok(same(heldPlane(m, ["p11"]), planeOf("p2", "p3", "p6")), "coplanar: the wall's plane");
  // A profile corner held flat with the rest by e1_flat: the base's plane.
  assert.ok(same(heldPlane(m, ["p4"]), planeOf("p1", "p2", "p3")), "the profile's plane, by the feature's flat");
  // A face by name.
  await say("w = pt(40, 10, 10); onplane(w, \"e1:l2\")");
  m.solve();
  assert.ok(same(heldPlane(m, ["p12"]), planeOf("p2", "p3", "p6")), "a wall by name");
});

test("heldPlane: null where nothing holds the point on a plane, where two planes hold it, where a line spans two planes — and in 2D", async () => {
  const { m, say } = await typed();
  await say("a = pt(0, 0, 0); b = pt(40, 0, 0); c = pt(40, 30, 0); d = pt(0, 30, 0); ln(a, b); ln(b, c); ln(c, d); ln(d, a)");
  await say("free = pt(3, 4, 5)");
  await say("two = pt(0, 0, 0); onplane(two, \"origin\"); onplane(two, \"origin.xz\")");
  await say("e = pt(0, 0, 0); f = pt(10, 0, 0); onplane(e, \"origin\"); onplane(f, \"origin\"); lf = ln(e, f)");
  await say("g = pt(0, 0, 10); onplane(g, \"origin.xz\"); lg = ln(e, g)");
  m.solve();
  assert.equal(heldPlane(m, ["p5"]), null, "a free point");
  assert.equal(heldPlane(m, ["p6"]), null, "held on two planes: a line of its own");
  assert.ok(heldPlane(m, ["p7", "p8"]), "a line whose ends share a plane moves in it");
  assert.equal(heldPlane(m, ["p7", "p9"]), null, "a line from one plane to another");
  assert.equal(heldPlane(m, []), null);
  assert.equal(heldPlane(m, ["l1"]), null, "only points are held on planes");
  const flat = new Model(2);
  flat.addPoint([1, 2], "a");
  assert.equal(heldPlane(flat, ["a"]), null, "2D is one plane already");
  // A plane since collapsed, or a reference gone, is no plane: never a throw.
  const g = new Model(3);
  g.addPoint([0, 0, 0], "a"); g.addPoint([1, 0, 0], "b"); g.addPoint([2, 0, 0], "c"); g.addPoint([5, 5, 5], "q");
  assert.throws(() => coplanar(g, "q", "a", "b", "c"), /one line/);
  onPlane(g, "q", "origin");
  assert.ok(heldPlane(g, ["q"]));
});

function fakeCanvas() {
  const listeners = new Map<string, ((e: unknown) => void)[]>();
  const canvas = {
    addEventListener(type: string, fn: (e: unknown) => void) { listeners.set(type, [...(listeners.get(type) ?? []), fn]); },
    getContext: () => ({}),
    getBoundingClientRect: () => ({ left: 0, top: 0, x: 0, y: 0, width: 800, height: 600 }),
    setPointerCapture() {},
    releasePointerCapture() {},
  };
  const fire = (type: string, e: Record<string, unknown>) => {
    for (const fn of listeners.get(type) ?? []) fn({ preventDefault() {}, pointerId: 1, ...e });
  };
  return { canvas: canvas as unknown as HTMLCanvasElement, fire };
}

test("the owner's drag, through the engine: the circle's centre held on a face of a free prism, dragged in a turned view, slides along the face — the prism does not tilt", async () => {
  const { m, say } = await typed();
  // The Rectangle tool's box: four right angles and its coplanar, extruded; a circle on its lid, held there.
  await say("a = pt(-40, -40, 0); b = pt(40, -40, 0); c = pt(40, 40, 0); d = pt(-40, 40, 0); ln(a, b); ln(b, c); ln(c, d); ln(d, a)");
  await say('perp("l1","l2"); perp("l2","l3"); perp("l3","l4"); perp("l4","l1"); coplanar("p4","p1","p2","p3"); extrude("l1", 10)');
  await say('q = pt(0, 0, 10); onplane(q, "p5.p6.p8"); circle(q, 12, [0, 0, 1]); par("c1", "p5.p6.p8")');
  m.solve();
  const view: View = orbitBy({ ox: 400, oy: 300, scale: 3 }, -0.8, -1.0);
  const { canvas, fire } = fakeCanvas();
  let solves = 0;
  const engine = new ToolEngine(m, canvas, view, {
    onSolveRender: () => { solves++; m.solve(); },
    onRenderOnly: () => {},
    onContextMenu: () => {},
  });
  assert.ok(engine);
  const corners = ["p1", "p2", "p3", "p4"].map((p) => m.coords(p));
  const centre = m.coords("p9");
  const [sx, sy] = worldToScreen(view, centre);
  const under = (engine as unknown as { pickAt(x: number, y: number): { name: string } | null }).pickAt(sx, sy);
  assert.equal(under?.name, "p9", "the press lands on the centre");
  fire("pointerdown", { clientX: sx, clientY: sy, button: 0, buttons: 1 });
  for (let i = 1; i <= 10; i++) fire("pointermove", { clientX: sx + 4 * i, clientY: sy + 1.6 * i, button: -1, buttons: 1 });
  fire("pointerup", { clientX: sx + 40, clientY: sy + 16, button: 0, buttons: 0 });
  assert.equal(solves, 1, "the release settles");
  const moved = Math.hypot(...sub3(m.coords("p9"), centre));
  assert.ok(moved > 5, `the circle slid ${moved} along the face (0.003 before, the prism tilting instead)`);
  const lidN = unit3(cross3(sub3(m.coords("p6"), m.coords("p5")), sub3(m.coords("p8"), m.coords("p5"))))!;
  assert.ok(Math.abs(dot3(sub3(m.coords("p9"), m.coords("p5")), lidN)) < 1e-6, "still on the face");
  ["p1", "p2", "p3", "p4"].forEach((p, i) => assert.ok(Math.hypot(...sub3(m.coords(p), corners[i])) < 1e-6, `${p} did not move: the prism stands still`));
  assert.equal(m.problem.solve().iterations, 0, "and nothing is left for a further solve");
});
