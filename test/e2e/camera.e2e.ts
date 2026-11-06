// The app in 3D: a real mouse orbiting a real camera, and the drawing on the
// other side of it.
//
// The assertions are closed-form wherever the claim is geometric, for the
// reason frames.e2e.ts gives: "it still solves" is what a tool that drew on the
// wrong plane also reports. So an orbit by a measured drag must foreshorten the
// drawing by *exactly* cos of the angle that drag means; a rectangle drawn on a
// tilted plane seen at an angle must have every corner on that plane to the
// solver's precision, with the two clicked ones under the cursor that clicked
// them. And the foreshortening is checked in the bitmap too — an edge drawn
// where the projection says, and nothing where it used to be — because a
// camera that the numbers agree with and the renderer ignores is exactly the
// kind of bug this suite exists for.
//
// One app, tests in order: the states are cumulative.

import { test, before, after } from "node:test";
import assert from "node:assert/strict";
import { axisFrame, openApp, type AppContext } from "./harness.ts";

let app: AppContext;
before(async () => { app = await openApp(); });
after(async () => { await app.close(); });

/** Radians per pixel of right-drag — the engine's ORBIT_PER_PIXEL. */
const ORBIT_PER_PIXEL = Math.PI / 360;

const dot = (a: number[], b: number[]) => a.reduce((s, x, i) => s + x * b[i], 0);
const sub = (a: number[], b: number[]) => a.map((x, i) => x - b[i]);

const screenOfPoint = async (name: string) => app.screenOf((await app.model()).points[name]);

/** Whether a small patch of the canvas has anything drawn in it (the background is near-black). */
async function inkAt(x: number, y: number, r = 2): Promise<boolean> {
  const at: [number, number][] = [];
  for (let py = y - r; py < y + r; py++) for (let px = x - r; px < x + r; px++) at.push([px, py]);
  // The drawing alone: an edge is ink on the 2D canvas, whatever is under it.
  return (await app.pixels("drawing", at)).some((d) => d[0] + d[1] + d[2] > 240 && d[3] > 0);
}

/** A real right-button drag by (dx, dy) pixels, starting somewhere empty. */
async function rightDrag(sx: number, sy: number, dx: number, dy: number): Promise<void> {
  const from = await app.at(sx, sy);
  await app.page.mouse.move(from.x, from.y);
  await app.page.mouse.down({ button: "right" });
  await app.page.mouse.move(from.x + dx, from.y + dy, { steps: 8 });
  await app.page.mouse.up({ button: "right" });
  await app.page.waitForTimeout(150);
}

/** A left drag from one canvas point to another, through the armed tool. */
async function leftDrag(a: [number, number], b: [number, number]): Promise<void> {
  const p = await app.at(...a), q = await app.at(...b);
  await app.page.mouse.move(p.x, p.y);
  await app.page.mouse.down();
  await app.page.mouse.move(q.x, q.y, { steps: 8 });
  await app.page.mouse.up();
  await app.page.waitForTimeout(220);
}

const menuOpen = () => app.page.$eval("#ctxmenu", (el) => !(el as HTMLElement).hidden);

test("the app boots 3D, square-on: a 2D hand still types two numbers", async () => {
  assert.equal((await app.repl("model.dim")).value, 3, "one model, and it is a 3D one");
  const view = (await app.model()).view;
  assert.equal(view.right, undefined, "a camera nobody has turned: the top view, which is the 2D transform");
  await app.type("pt(10, 20)");
  assert.deepEqual((await app.model()).points.p1, [10, 20, 0], "pt(x, y) is pt(x, y, 0)");
  await app.type('del("p1")');
});

/** The rectangle's corners, in the order the tool made them: a, b, c, d. */
let corners: string[] = [];

test("a rectangle drawn face-on on the default frame foreshortens by exactly cos(yaw) when orbited", async () => {
  await axisFrame(app);
  const before = await app.model();
  await app.type("rectangle");
  const a = await app.screenOf([-30, 20, 0]);
  const c = await app.screenOf([30, -20, 0]);
  await leftDrag(a, c);

  const m = await app.model();
  corners = Object.keys(m.points).filter((n) => !(n in before.points));
  assert.equal(corners.length, 4);
  for (const n of corners) assert.equal(m.points[n][2], 0, `${n} is on the sketch plane`);
  const held = (await app.repl("rels()")).value as string[];
  assert.equal(held.filter((r) => r.includes("onplane")).length, 4, `every corner is held there: ${held.join(" | ")}`);
  assert.equal(await app.status(), "SOLVED");

  const scale = m.view.scale;
  const [pa, pb, pc] = corners;
  const width = async () => Math.abs((await screenOfPoint(pb))[0] - (await screenOfPoint(pa))[0]);
  const height = async () => Math.abs((await screenOfPoint(pc))[1] - (await screenOfPoint(pb))[1]);
  assert.ok(Math.abs((await width()) - 60 * scale) < 1e-6 && Math.abs((await height()) - 40 * scale) < 1e-6);
  // Where the right-hand edge is drawn before the orbit — checked in pixels.
  const rightEdgeWas = await screenOfPoint(pb);
  const midRight: [number, number] = [rightEdgeWas[0], (rightEdgeWas[1] + (await screenOfPoint(pc))[1]) / 2];
  assert.ok(await inkAt(...midRight), "the right edge is drawn where the projection put it");

  // 120px of right-drag is a third of a turn about the screen's vertical.
  await rightDrag(820, 120, 120, 0);
  const yaw = 120 * ORBIT_PER_PIXEL;
  const view = (await app.model()).view;
  const expectRight = [Math.cos(yaw), 0, Math.sin(yaw)];
  assert.ok(view.right && view.right.every((x, i) => Math.abs(x - expectRight[i]) < 1e-9),
    `the camera's right is ${view.right}, expected ${expectRight}`);
  assert.ok(Math.abs((await width()) - 60 * scale * Math.cos(yaw)) < 1e-6,
    `the width is ${await width()}, expected 60 · ${scale} · cos(π/3) = ${60 * scale * Math.cos(yaw)}`);
  assert.ok(Math.abs((await height()) - 40 * scale) < 1e-6, "and a yaw leaves the height alone");

  // In the pixels: the right edge is drawn at its new place, and the canvas is
  // empty where it used to be.
  const now = await screenOfPoint(pb);
  assert.ok(await inkAt(now[0], midRight[1]), "the right edge is drawn where it now projects");
  assert.ok(!(await inkAt(...midRight)), "and nothing is left where it was");
});

test("lookAt puts the sketch square-on again, the full size it was drawn", async () => {
  await app.type("lookAt()");
  const view = (await app.model()).view;
  assert.ok(view.right!.every((x, i) => Math.abs(x - [1, 0, 0][i]) < 1e-12));
  assert.ok(view.up!.every((x, i) => Math.abs(x - [0, 1, 0][i]) < 1e-12));
  const [p1, p2] = [await screenOfPoint(corners[0]), await screenOfPoint(corners[1])];
  assert.ok(Math.abs(Math.abs(p2[0] - p1[0]) - 60 * view.scale) < 1e-6);
});

/** A frame tipped out of every kernel plane: +x turned `a` up out of x–y, +y leaning back `b`. */
const A = (30 * Math.PI) / 180, B = (25 * Math.PI) / 180;
const G_O = [70, 60, 10];
const G_X = [Math.cos(A), 0, Math.sin(A)];
const G_Y = [-Math.sin(A) * Math.sin(B), Math.cos(B), Math.cos(A) * Math.sin(B)];
const G_Z = [G_X[1] * G_Y[2] - G_X[2] * G_Y[1], G_X[2] * G_Y[0] - G_X[0] * G_Y[2], G_X[0] * G_Y[1] - G_X[1] * G_Y[0]];
const onG = (u: number, v: number) => G_O.map((o, i) => o + u * G_X[i] + v * G_Y[i]);

test("on a tilted frame seen at an angle, a drawn rectangle lies in its plane, under the cursor", async () => {
  const at = (p: number[]) => `pt(${p.join(", ")})`;
  await app.type(`go = ${at(G_O)}; gx = ${at(onG(20, 0))}; gy = ${at(onG(0, 20))}; g = frame(go, gx, gy); setDefaultFrame(g)`);
  await app.type("orbit(0.45, -0.5)");
  const before = await app.model();

  await app.type("rectangle");
  // Two corners aimed at by pixel, near the frame's origin on screen.
  const o = await app.screenOf(G_O);
  const a: [number, number] = [o[0] + 25, o[1] - 20];
  const c: [number, number] = [o[0] + 160, o[1] - 120];
  await leftDrag(a, c);

  const m = await app.model();
  const fresh = Object.keys(m.points).filter((n) => !(n in before.points));
  assert.equal(fresh.length, 4, `four new corners: ${fresh}`);
  for (const n of fresh) {
    const off = dot(sub(m.points[n], G_O), G_Z);
    assert.ok(Math.abs(off) < 1e-9, `${n} is ${off} off the tilted plane`);
  }
  // The two clicked corners are under the cursor that clicked them — to the
  // precision a pointer event carries its position in, a few hundred-
  // thousandths of a pixel.
  const [pa, pc] = [await app.screenOf(m.points[fresh[0]]), await app.screenOf(m.points[fresh[2]])];
  assert.ok(Math.hypot(pa[0] - a[0], pa[1] - a[1]) < 1e-3 && Math.hypot(pc[0] - c[0], pc[1] - c[1]) < 1e-3,
    `clicked at ${a} and ${c}, landed at ${pa} and ${pc}`);
  // And the box is laid out along the frame's own axes, as a sketch's is.
  const uv = (p: number[]) => [dot(sub(p, G_O), G_X), dot(sub(p, G_O), G_Y)];
  const [ua, ub, uc, ud] = fresh.map((n) => uv(m.points[n]));
  assert.ok(Math.abs(ub[1] - ua[1]) < 1e-9 && Math.abs(ub[0] - uc[0]) < 1e-9, "b = (c.u, a.v)");
  assert.ok(Math.abs(ud[0] - ua[0]) < 1e-9 && Math.abs(ud[1] - uc[1]) < 1e-9, "d = (a.u, c.v)");
  assert.equal(await app.status(), "SOLVED");
});

test("a drag in a turned view slides a sketch point within its plane", async () => {
  const m = await app.model();
  const name = Object.keys(m.points).at(-1)!;
  const from = await app.screenOf(m.points[name]);
  await leftDrag(from, [from[0] + 30, from[1] + 25]);
  const p = (await app.model()).points[name];
  assert.ok(Math.abs(dot(sub(p, G_O), G_Z)) < 1e-6, "still in the tilted plane");
  assert.ok(Math.hypot(...sub(p, m.points[name])) > 3, "and it moved");
  assert.equal(await app.status(), "SOLVED");
});

test("the wheel zooms toward the cursor in a turned view: the point under it stays under it", async () => {
  const pixel: [number, number] = [520, 260];
  const was = await app.page.evaluate(([x, y]) =>
    (window as never as { __neocad: { engine: { screenToWorld(a: number, b: number): number[] } } })
      .__neocad.engine.screenToWorld(x, y), pixel);
  const at = await app.at(...pixel);
  await app.page.mouse.move(at.x, at.y);
  await app.page.mouse.wheel(0, -300);
  await app.page.waitForTimeout(150);
  const still = await app.screenOf(was);
  assert.ok(Math.hypot(still[0] - pixel[0], still[1] - pixel[1]) < 1e-3, `drifted to ${still}`);
  assert.ok(Math.abs(dot(sub(was, G_O), G_Z)) < 1e-9, "a point of the working plane — the tilted sketch's");
  await app.page.mouse.wheel(0, 300);
  await app.page.waitForTimeout(150);
});

test("a right click in a turned view still opens the menu for what is under it", async () => {
  const m = await app.model();
  const name = Object.keys(m.points).at(-2)!;
  const [sx, sy] = await app.screenOf(m.points[name]);
  const at = await app.at(sx, sy);
  const viewBefore = (await app.model()).view;
  await app.page.mouse.move(at.x, at.y);
  await app.page.mouse.down({ button: "right" });
  await app.page.mouse.up({ button: "right" });
  await app.page.waitForTimeout(150);
  assert.ok(await menuOpen(), "released where it landed: the menu");
  const head = await app.page.$eval("#ctxmenu", (el) => el.textContent ?? "");
  assert.ok(head.includes(name), `the menu is about ${name}: ${head}`);
  assert.deepEqual((await app.model()).view, viewBefore, "and the view did not turn");
  await app.page.keyboard.press("Escape");
});

test("a dimension's label and witness lines follow the projection", async () => {
  const m = await app.model();
  const [a, b] = Object.keys(m.points).slice(-4, -2);
  await app.type(`dist("${a}", "${b}", 45)`);
  assert.equal(await app.status(), "SOLVED");
  const glyph = await app.page.evaluate(() => {
    const e = (window as never as { __neocad: { engine: { glyphs(): { op: string; symbol: string; anchor: number[]; ends?: number[][] }[] } } }).__neocad.engine;
    return e.glyphs().find((g) => g.op === "dist");
  });
  assert.ok(glyph, "the dimension wears its label");
  assert.equal(glyph.symbol, "45");
  const now = await app.model();
  const [sa, sb] = [await app.screenOf(now.points[a]), await app.screenOf(now.points[b])];
  assert.ok(Math.hypot(glyph.ends![0][0] - sa[0], glyph.ends![0][1] - sa[1]) < 1e-6
    && Math.hypot(glyph.ends![1][0] - sb[0], glyph.ends![1][1] - sb[1]) < 1e-6, "its ends are the projected points");
  assert.ok(Math.hypot(glyph.anchor[0] - (sa[0] + sb[0]) / 2, glyph.anchor[1] - (sa[1] + sb[1]) / 2) < 1e-6,
    "and it hangs off their projected middle");
  assert.ok(Math.abs(Math.hypot(...sub(now.points[b], now.points[a])) - 45) < 1e-6, "45, measured in 3D");
});

test("a tool's gesture survives being orbited through", async () => {
  const before = await app.model();
  await app.type("rectangle");
  const o = await app.screenOf(onG(-60, 0));
  const start = await app.at(o[0], o[1]);
  await app.page.mouse.move(start.x, start.y);
  await app.page.mouse.down();
  await app.page.mouse.move(start.x - 40, start.y - 30, { steps: 3 });
  // Orbit mid-gesture with the other hand: a second button while one is held
  // arrives as a move with the mask changed, never a pointerdown.
  await app.page.mouse.down({ button: "right" });
  await app.page.mouse.move(start.x - 10, start.y - 30, { steps: 4 });
  await app.page.mouse.up({ button: "right" });
  assert.equal((await app.model()).activeTool, "rectangle", "still armed");
  await app.page.mouse.move(start.x - 90, start.y - 70, { steps: 4 });
  await app.page.mouse.up();
  await app.page.waitForTimeout(220);
  const m = await app.model();
  const fresh = Object.keys(m.points).filter((n) => !(n in before.points));
  assert.equal(fresh.length, 4, "the interrupted rectangle still committed");
  for (const n of fresh) assert.ok(Math.abs(dot(sub(m.points[n], G_O), G_Z)) < 1e-9, `${n} on the sketch plane`);
  assert.equal(await app.status(), "SOLVED");
});

/** What the 2D app wrote: a tilted frame, a point fixed in it, a filleted corner. */
function legacyFile(version: 4 | 5): string {
  const t = 0.4;
  return JSON.stringify({
    format: "neocad-model", version, dim: 2,
    journal: [
      { op: "addPoint", args: [[0, 0], "o"] },
      { op: "addPoint", args: [[Math.cos(t), Math.sin(t)], "x"] },
      { op: "addFrame", args: version === 4 ? ["o", "x", "base"] : ["o", "x", null, "base"] },
      { op: "setDefaultFrame", args: ["base"] },
      { op: "addPoint", args: [[0, 0], "p"] },
      { op: "fix", args: ["p", [30, 20], "base"] },
      { op: "addPoint", args: [[-40, 0], "a"] },
      { op: "addPoint", args: [[-40, -30], "k"] },
      { op: "addPoint", args: [[0, -30], "b"] },
      { op: "addLine", args: ["a", "k", "l1"] },
      { op: "addLine", args: ["k", "b", "l2"] },
      { op: "fillet", args: ["l1", "l2", 8] },
    ],
    values: { points: {}, radii: {} },
  });
}

test("v4 and v5 2D files open lifted: depth zero, a y-ref per frame, the same meaning", async () => {
  for (const version of [4, 5] as const) {
    await app.type(`open(${JSON.stringify(legacyFile(version))})`);
    assert.equal(await app.status(), "SOLVED", `the v${version} file solves`);
    assert.equal((await app.repl("model.dim")).value, 3);
    const m = await app.model();
    for (const [n, p] of Object.entries(m.points)) assert.equal(p[2], 0, `${n} lifted to z = 0`);
    assert.equal((await app.repl('model.frame("base").yref')).value, "base_y");
    // fix(p, [30, 20]) in a frame turned 0.4 rad: where it always was.
    const p = m.points.p;
    const [c, s] = [Math.cos(0.4), Math.sin(0.4)];
    assert.ok(Math.hypot(p[0] - (30 * c - 20 * s), p[1] - (30 * s + 20 * c)) < 1e-6, `p at ${p}`);
    assert.equal(m.byKind.arc, 1, "the fillet re-expanded in 3D");
  }
  const saved = JSON.parse((await app.repl("save()")).value as string);
  assert.equal(saved.version, 17); // the current version
  assert.equal(saved.dim, 3, "and saves back as what it now is");
  // The fillet's arc was given the side of the frame the 2D drawing was in —
  // the only one it had, whose +z is the lifted kernel's — and its entry says
  // so. It used to name the frame; a fillet needs none now, only which way its
  // arc faces (docs/plans/frameless-curves.md).
  const args = saved.journal.find((e: { op: string }) => e.op === "fillet").args;
  assert.deepEqual(args.slice(0, 3), ["l1", "l2", 8]);
  assert.ok(Math.hypot(args[3][0], args[3][1], args[3][2] - 1) < 1e-9, `facing +z: ${JSON.stringify(args)}`);
});

test("sketching square-on, a vertex seen through the sketch is not snapped to; one on it is", async () => {
  const empty = JSON.stringify({ format: "neocad-model", version: 6, dim: 3, journal: [], values: { points: {}, radii: {} } });
  await app.type(`open(${JSON.stringify(empty)})`);
  // A floor with a corner on the wall's foot and one seventy units in front of
  // it, then the wall — the x–z plane at y = 40 — looked at square-on.
  await app.type("back = pt(40, 40, 0); front = pt(0, -30, 0)");
  await app.type("wo = pt(-60, 40, 0); wx = pt(-40, 40, 0); wy = pt(-60, 40, 20); wall = frame(wo, wx, wy); setDefaultFrame(wall); lookAt(wall)");
  await app.type("point");
  const target = await app.screenOf([0, 40, 0]); // the same pixel as `front`
  const at = await app.at(...target);
  await app.page.mouse.move(at.x - 2, at.y + 1);
  await app.page.mouse.click(at.x - 2, at.y + 1);
  await app.page.waitForTimeout(150);
  let m = await app.model();
  const placed = Object.keys(m.points).at(-1)!;
  assert.ok(Math.abs(m.points[placed][1] - 40) < 1e-9, `the point is on the wall, at ${m.points[placed]}`);
  assert.equal(m.journalOps.includes("coincident"), false, "and not joined to the corner behind it");

  await app.type("point");
  const onFoot = await app.screenOf([40, 40, 0]);
  const at2 = await app.at(...onFoot);
  await app.page.mouse.click(at2.x + 3, at2.y - 2);
  await app.page.waitForTimeout(150);
  m = await app.model();
  assert.ok(m.journalOps.includes("coincident"), "a corner that is on the sketch is still found");
  assert.equal(await app.status(), "SOLVED");
});

test("no uncaught page errors", () => {
  assert.deepEqual(app.pageErrors, []);
});
