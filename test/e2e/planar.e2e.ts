// 3D phase 2 in a browser: circles that lie in their plane, a sketch that can
// borrow a position from off it, and the conveniences for starting one.
//
// Closed forms throughout, for camera.e2e.ts's reason: "it solves" is what a
// sphere drawn as its silhouette also reported. A circle drawn on a tilted
// frame and seen at an angle must be inked exactly on the ellipse its plane
// projects to — every sampled rim point, computed here from the frame's own
// axes — and nowhere on the silhouette it used to be. A point held on that rim
// must still be on it, in its plane, after a mouse drags it. A point snapped by
// projection must land at the foot of the perpendicular and name nothing it was
// borrowed from.
//
// One app, tests in order: the states are cumulative.

import { test, before, after } from "node:test";
import assert from "node:assert/strict";
import { openApp, type AppContext } from "./harness.ts";

let app: AppContext;
before(async () => { app = await openApp(); });
after(async () => { await app.close(); });

const dot = (a: number[], b: number[]) => a.reduce((s, x, i) => s + x * b[i], 0);
const sub = (a: number[], b: number[]) => a.map((x, i) => x - b[i]);

/** The sketch plane: +x turned 30° up out of x–y, +y leaning back 25°. */
const A = (30 * Math.PI) / 180, B = (25 * Math.PI) / 180;
const G_O = [10, 5, 6];
const G_X = [Math.cos(A), 0, Math.sin(A)];
const G_Y = [-Math.sin(A) * Math.sin(B), Math.cos(B), Math.cos(A) * Math.sin(B)];
const G_Z = [G_X[1] * G_Y[2] - G_X[2] * G_Y[1], G_X[2] * G_Y[0] - G_X[0] * G_Y[2], G_X[0] * G_Y[1] - G_X[1] * G_Y[0]];
const onG = (u: number, v: number, w = 0) => G_O.map((o, i) => o + u * G_X[i] + v * G_Y[i] + w * G_Z[i]);
const inG = (p: number[]) => [dot(sub(p, G_O), G_X), dot(sub(p, G_O), G_Y), dot(sub(p, G_O), G_Z)];

/** Whether a small patch of the canvas has anything bright drawn in it (the background is near-black). */
async function inkAt(x: number, y: number, r = 2): Promise<boolean> {
  const at: [number, number][] = [];
  for (let py = y - r; py < y + r; py++) for (let px = x - r; px < x + r; px++) at.push([px, py]);
  // The drawing alone: an edge is ink on the 2D canvas, whatever is under it.
  return (await app.pixels("drawing", at)).some((d) => d[0] + d[1] + d[2] > 240 && d[3] > 0);
}

async function leftDrag(a: [number, number], b: [number, number]): Promise<void> {
  const p = await app.at(...a), q = await app.at(...b);
  await app.page.mouse.move(p.x, p.y);
  await app.page.mouse.down();
  await app.page.mouse.move(q.x, q.y, { steps: 8 });
  await app.page.mouse.up();
  await app.page.waitForTimeout(220);
}

async function clickAt(sx: number, sy: number): Promise<void> {
  const at = await app.at(sx, sy);
  await app.page.mouse.move(at.x, at.y, { steps: 3 });
  await app.page.mouse.click(at.x, at.y);
  await app.page.waitForTimeout(150);
}

const snapState = () => app.page.evaluate(() => {
  const s = (window as never as { __neocad: { engine: { snap: { kind: string; targets: string[]; world: number[] } | null } } })
    .__neocad.engine.snap;
  return s ? { kind: s.kind, targets: [...s.targets], world: [...s.world] } : null;
});

const circleOf = (name: string) => app.repl(`(() => { const c = model.circle(${JSON.stringify(name)}); ` +
  `return { center: model.coords(c.center), r: model.radius(c.name), plane: c.plane }; })()`)
  .then((r) => r.value as { center: number[]; r: number; plane: string });

// --- no plane, no circle --------------------------------------------------------

test("with no frame, the circle tool refuses out loud, and the menu says why before you try", async () => {
  await app.type("circle");
  await clickAt(300, 200);
  assert.match(await app.log(), /circle: no default frame — frame\(\) then setDefaultFrame\(\), or say which frame/);
  assert.equal((await app.model()).size, 0, "nothing was placed on the way to the refusal");
  await app.type("cancel()");

  const at = await app.at(500, 300);
  await app.page.mouse.move(at.x, at.y);
  await app.page.mouse.down({ button: "right" });
  await app.page.mouse.up({ button: "right" });
  await app.page.waitForTimeout(120);
  // The tools that are off; Undo and Redo are off or not by the history, not the frame.
  const off = (await app.page.$$eval("#ctxmenu .item.off", (els) => els.map((el) => el.firstElementChild?.textContent ?? "")))
    .filter((label) => label !== "Undo" && label !== "Redo");
  assert.deepEqual(off, ["Circle", "3 point circle", "Arc", "3 point arc", "Fillet"], "shown, disabled, with the reason under each");
  await app.page.keyboard.press("Escape");
});

// --- a circle on a tilted plane --------------------------------------------------

let circle = "";

test("plane() starts a sketch on a tilted frame: the default, looked at square-on, journalling only the model", async () => {
  const at = (p: number[]) => `pt(${p.join(", ")})`;
  await app.type(`go = ${at(G_O)}; gx = ${at(onG(20, 0))}; gy = ${at(onG(0, 20))}; g = plane(go, gx, gy)`);
  assert.equal((await app.repl("defaultFrame()")).value, "f1");
  const view = (await app.model()).view;
  assert.ok(view.right!.every((x, i) => Math.abs(x - G_X[i]) < 1e-9) && view.up!.every((x, i) => Math.abs(x - G_Y[i]) < 1e-9),
    "square to the frame, +x right and +y up");
  const ops = (await app.model()).journalOps;
  assert.deepEqual(ops.slice(-2), ["addFrame", "setDefaultFrame"], "and nothing about the camera");
});

test("a circle drawn on it lies in its plane, and seen at an angle is inked on its ellipse — not on a silhouette", async () => {
  await app.type("circle");
  const c = await app.screenOf(onG(15, 10));
  const scale = (await app.model()).view.scale;
  await leftDrag(c, [c[0] + 25 * scale, c[1]]);
  const m = await app.model();
  circle = m.circles[0].name;
  const k = await circleOf(circle);
  assert.equal(k.plane, "f1", "given the sketch's plane");
  assert.ok(Math.abs(inG(k.center)[2]) < 1e-9, "its centre on the sketch");
  assert.ok(Math.abs(k.r - 25) < 1e-6, `radius ${k.r}`);
  assert.equal(await app.status(), "SOLVED");

  // A radian about the screen's vertical: the circle's plane is now well off
  // square, and its ellipse is cos(1) as wide as it is tall.
  await app.type("orbit(1, 0)");
  const rim = (t: number) => k.center.map((x, i) => x + k.r * (Math.cos(t) * G_X[i] + Math.sin(t) * G_Y[i]));
  for (let j = 0; j < 12; j++) {
    const t = (j * Math.PI) / 6;
    const [sx, sy] = await app.screenOf(rim(t));
    assert.ok(await inkAt(sx, sy), `the rim at ${(j * 30)}° is inked where its plane projects it`);
  }
  // Where the sphere's silhouette was — r·scale out along the screen's right
  // from the centre — the ellipse has pulled in by 1 − cos(1) of that.
  const [cx, cy] = await app.screenOf(k.center);
  const s2 = (await app.model()).view.scale;
  assert.ok(k.r * s2 * (1 - Math.cos(1)) > 30, "far enough in to tell");
  assert.ok(!(await inkAt(cx + k.r * s2, cy)) && !(await inkAt(cx - k.r * s2, cy)),
    "and nothing is drawn on the silhouette it used to be");
});

test("a point on the rim stays on the tilted rim — in its plane — when a mouse drags it", async () => {
  // Square-on again to place it, then turned to drag it.
  await app.type("lookAt()");
  const k = await circleOf(circle);
  const target = k.center.map((x, i) => x + k.r * (Math.cos(0.7) * G_X[i] + Math.sin(0.7) * G_Y[i]));
  const before = await app.model();
  await app.type("point");
  const [sx, sy] = await app.screenOf(target);
  await clickAt(sx + 1, sy - 1);
  const after = await app.model();
  const placed = Object.keys(after.points).find((n) => !(n in before.points))!;
  const held = (await app.repl(`rels(${JSON.stringify(placed)})`)).value as string[];
  assert.ok(held.some((r) => r.includes(`oncircle ${placed} ${circle}`)), JSON.stringify(held));

  await app.type("orbit(0.6, -0.4)");
  const from = await app.screenOf(after.points[placed]);
  await leftDrag(from, [from[0] + 40, from[1] + 30]);
  const now = await app.model();
  const k2 = await circleOf(circle);
  const rel = sub(now.points[placed], k2.center);
  assert.ok(Math.hypot(...sub(now.points[placed], after.points[placed])) > 2, "it moved");
  assert.ok(Math.abs(Math.hypot(...rel) - k2.r) < 1e-6, `on the circle: ${Math.hypot(...rel)} vs ${k2.r}`);
  assert.ok(Math.abs(dot(rel, G_Z)) < 1e-6, `and in its plane: ${dot(rel, G_Z)} off`);
  assert.equal(await app.status(), "SOLVED");
});

// --- borrowing a position from off the sketch ---------------------------------------

test("a point off the sketch snaps at its projection, with the hollow marker, and infers nothing", async () => {
  await app.type("lookAt()");
  await app.type(`far = pt(${onG(-20, -12, 35).join(", ")})`);
  await app.type("orbit(0.3, -0.25)");
  await app.type("point");
  const foot = onG(-20, -12);
  const [sx, sy] = await app.screenOf(foot);
  const at = await app.at(sx + 2, sy + 1);
  await app.page.mouse.move(at.x, at.y, { steps: 3 });
  await app.page.waitForTimeout(150);
  const snap = await snapState();
  const farName = (await app.repl("far")).value as string;
  assert.equal(snap?.kind, "projected", JSON.stringify(snap));
  assert.deepEqual(snap!.targets, [farName], "named for the point it borrows from");
  assert.ok(Math.hypot(...sub(snap!.world, foot)) < 1e-9, `the foot of the perpendicular: ${snap!.world}`);
  // The marker is dashed and hollow at the foot, with a leader back to the
  // point: the square's corner is inked, its centre is a ring, not a fill.
  assert.ok(await inkAt(sx - 6, sy - 6, 1.5), "the dashed square is drawn round the foot");

  const relsBefore = (await app.repl(`rels(${JSON.stringify(farName)})`)).value as string[];
  const before = await app.model();
  await app.page.mouse.click(at.x, at.y);
  await app.page.waitForTimeout(200);
  const now = await app.model();
  const placed = Object.keys(now.points).find((n) => !(n in before.points))!;
  assert.ok(Math.hypot(...sub(now.points[placed], foot)) < 1e-9, "placed at the foot, on the sketch");
  assert.deepEqual((await app.repl(`rels(${JSON.stringify(farName)})`)).value, relsBefore,
    "nothing names the point it was borrowed from");
  assert.deepEqual(((await app.repl(`rels(${JSON.stringify(placed)})`)).value as string[]).map((r) => r.split(/\s+/)[1]),
    ["onplane"], "only the sketch's own hold");
  assert.equal(await app.status(), "SOLVED");
});

// --- Sketch on this ---------------------------------------------------------------

test("Sketch on this, on a frame, types the default and the lookAt — and one Ctrl+Z undoes the edit", async () => {
  await app.type("lookAt()");
  // A second frame, flat, off to the side: right-click its +x arm.
  await app.type("ho = pt(-60, -40, 0); hx = pt(-40, -40, 0); hy = pt(-60, -20, 0); h = frame(ho, hx, hy)");
  await app.type("orbit(0.2, 0.3)");
  const [ox, oy] = await app.screenOf([-60, -40, 0]);
  const [xx, xy] = await app.screenOf([-50, -40, 0]);
  // The marker's arm is a fixed pixel length; aim along it, a few pixels out.
  const len = Math.hypot(xx - ox, xy - oy);
  const aim: [number, number] = [ox + ((xx - ox) / len) * 14, oy + ((xy - oy) / len) * 14];
  const a = await app.at(...aim);
  await app.page.mouse.move(a.x, a.y);
  await app.page.mouse.down({ button: "right" });
  await app.page.mouse.up({ button: "right" });
  await app.page.waitForTimeout(150);
  const head = await app.page.$eval("#ctxmenu", (el) => el.querySelector(".head")?.textContent ?? "");
  assert.match(head, /^f2/, `the menu is the frame's: ${head}`);
  const handle = await app.page.evaluateHandle(() =>
    Array.from(document.querySelectorAll("#ctxmenu .item")).find((el) => el.firstElementChild?.textContent === "Sketch on this") ?? null);
  const el = handle.asElement();
  assert.ok(el, "a frame's menu offers Sketch on this");
  await el.click();
  await app.page.waitForTimeout(200);
  assert.match(await app.log(), /> setDefaultFrame\("f2"\); lookAt\("f2"\)/, "typed, as every item is");
  assert.equal((await app.repl("defaultFrame()")).value, "f2");
  const view = (await app.model()).view;
  assert.ok(Math.abs(view.right![0] - 1) < 1e-9 && Math.abs(view.up![1] - 1) < 1e-9, "square to f2");

  await app.page.fill("#cmd", "");
  await app.page.keyboard.press("Control+z");
  await app.page.waitForTimeout(220);
  assert.equal((await app.repl("defaultFrame()")).value, "f1", "the default is the edit, and it undoes");
});

// --- an old file --------------------------------------------------------------------

test("a version-6 file with arcs opens with their planes resolved — by normal, not by default", async () => {
  const wallY = [0, Math.cos(1.1), Math.sin(1.1)];
  const f = (n: string, o: number[], ux: number[], uy: number[]) => [
    { op: "addPoint", args: [o, `${n}_o`] },
    { op: "addPoint", args: [o.map((x, i) => x + 10 * ux[i]), `${n}_x`] },
    { op: "addPoint", args: [o.map((x, i) => x + 10 * uy[i]), `${n}_y`] },
    { op: "addFrame", args: [`${n}_o`, `${n}_x`, `${n}_y`, n] },
  ];
  const file = JSON.stringify({
    format: "neocad-model", version: 6, dim: 3,
    journal: [
      ...f("floor", [0, 0, 0], [1, 0, 0], [0, 1, 0]),
      ...f("wall", [0, 30, 0], [1, 0, 0], wallY),
      { op: "setDefaultFrame", args: ["floor"] },
      { op: "addPoint", args: [[0, 0, 0], "c"] },
      { op: "addPoint", args: [[20, 0, 0], "s"] },
      { op: "addPoint", args: [[0, 20, 0], "e"] },
      { op: "addArc", args: ["c", "s", "e", 20, "low"] },
      { op: "addPoint", args: [[0, 30, 0], "c2"] },
      { op: "addPoint", args: [[20, 30, 0], "s2"] },
      { op: "addPoint", args: [wallY.map((x, i) => 20 * x + [0, 30, 0][i]), "e2"] },
      { op: "addArc", args: ["c2", "s2", "e2", 20, "high"] },
      { op: "addCircle", args: ["c", 8, "ring"] },
    ],
    values: { points: {}, radii: {} },
  });
  await app.type(`open(${JSON.stringify(file)})`);
  assert.equal(await app.status(), "SOLVED");
  const planes = (await app.repl('[model.arc("low").plane, model.arc("high").plane, model.circle("ring").plane]')).value;
  assert.deepEqual(planes, ["floor", "wall", "floor"],
    "the arc on the wall is given the wall, though the floor was the default");
  const saved = JSON.parse((await app.repl("save()")).value as string);
  assert.equal(saved.version, 9); // the current version
  assert.deepEqual(saved.journal.find((e: { op: string; args: unknown[] }) => e.op === "addArc" && e.args[5] === "high").args,
    ["c2", "s2", "e2", 20, "wall", "high"]);
});

test("no uncaught page errors", () => {
  assert.deepEqual(app.pageErrors, []);
});
