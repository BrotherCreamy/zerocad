// The engine under fingers (docs/plans/touch.md): synthetic touch pointers
// against a stand-in canvas, with the recogniser's clock faked so a long-press
// is a number rather than a wait. gestures.test.ts checks what a finger is
// decided to mean; this checks what the engine then does with it — that each
// gesture reaches the path a mouse already uses, and that a mouse is
// untouched by any of it. The e2e suite (touch.e2e.ts) is the authority on a
// real browser's touch events; this covers the cases that are awkward there.

import { test } from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { ensureKernelLoaded } from "../src/kernel/problem.ts";
import { Model } from "../src/model.ts";
import { LIFT, ToolEngine, type View } from "../src/tools/engine.ts";
import { LONG_PRESS_MS, type Clock } from "../src/tools/gestures.ts";
import { PICK_POINT, TOUCH_REACH } from "../src/picking.ts";
import { viewAxes } from "../src/view.ts";
import "../src/tools/point.ts";
import "../src/tools/rectangle.ts";
import { axisFrame } from "./frames.ts";

async function loadKernel() {
  const bytes = await readFile(new URL("../src/kernel/wasm-gen/neocad_kernel_bg.wasm", import.meta.url));
  await ensureKernelLoaded(bytes);
}

class FakeClock implements Clock {
  t = 0;
  private timers: { at: number; fn: () => void; live: boolean }[] = [];
  now(): number { return this.t; }
  after(ms: number, fn: () => void): () => void {
    const timer = { at: this.t + ms, fn, live: true };
    this.timers.push(timer);
    return () => { timer.live = false; };
  }
  advance(ms: number): void {
    this.t += ms;
    for (const x of this.timers) if (x.live && x.at <= this.t) { x.live = false; x.fn(); }
  }
}

function fakeCanvas() {
  const listeners = new Map<string, ((e: unknown) => void)[]>();
  const canvas = {
    style: {} as Record<string, string>,
    addEventListener(type: string, fn: (e: unknown) => void) {
      listeners.set(type, [...(listeners.get(type) ?? []), fn]);
    },
    getContext: () => ({}),
    getBoundingClientRect: () => ({ left: 0, top: 0, x: 0, y: 0, width: 800, height: 600 }),
    setPointerCapture() {},
    releasePointerCapture() {},
  };
  const fire = (type: string, e: Record<string, unknown>) => {
    for (const fn of listeners.get(type) ?? []) fn({ preventDefault() {}, pointerId: 1, type, ...e });
  };
  return { canvas, fire };
}

/** An engine on `model`, with every callback it makes recorded. */
function engineOn(model: Model, view: View, composing = false) {
  const { canvas, fire } = fakeCanvas();
  const clock = new FakeClock();
  const log = { menus: [] as (string | null)[], withdrawn: 0, picks: [] as string[], actions: [] as string[] };
  const engine = new ToolEngine(model, canvas as unknown as HTMLCanvasElement, view, {
    onSolveRender: () => { model.solve(); },
    onRenderOnly: () => {},
    onPick: (p) => { log.picks.push(p.name); },
    composing: () => composing,
    onUserAction: (phase) => { log.actions.push(phase); },
    onContextMenu: (pick) => { log.menus.push(pick?.name ?? null); },
    onContextMenuWithdrawn: () => { log.withdrawn++; },
    clock,
  });
  /** One finger's events, `pointerType: "touch"`, by id. */
  const finger = (id: number) => ({
    down: (x: number, y: number) => fire("pointerdown", { pointerId: id, pointerType: "touch", clientX: x, clientY: y, button: 0, buttons: 1 }),
    move: (x: number, y: number) => fire("pointermove", { pointerId: id, pointerType: "touch", clientX: x, clientY: y, button: -1, buttons: 1 }),
    up: (x: number, y: number) => fire("pointerup", { pointerId: id, pointerType: "touch", clientX: x, clientY: y, button: 0, buttons: 0 }),
  });
  const tap = (x: number, y: number) => {
    const f = finger(1);
    f.down(x, y);
    clock.advance(60);
    f.up(x, y);
  };
  return { engine, canvas, fire, clock, log, finger, tap };
}

/** A 2D drawing whose view is the identity with y flipped: world (x, y) is canvas (x, −y)… so put things at negative y. */
async function sketch() {
  await loadKernel();
  const model = new Model(2);
  axisFrame(model);
  model.addPoint([100, -100], "a");
  model.addPoint([300, -100], "b");
  model.addPoint([300, -300], "c");
  model.addLine("a", "b", "l1");
  model.addLine("b", "c", "l2");
  model.solve();
  return { model, view: { ox: 0, oy: 0, scale: 1 } as View };
}

test("the canvas's touches are claimed: touch-action none, so a pinch is not the page's zoom", async () => {
  const { model, view } = await sketch();
  const { canvas } = engineOn(model, view);
  assert.equal(canvas.style.touchAction, "none");
});

test("a tap selects; a tap on another adds it; a tap on a selected one drops it; a tap on empty canvas clears", async () => {
  const { model, view } = await sketch();
  const { engine, tap } = engineOn(model, view);
  tap(100, 100);
  assert.deepEqual([...engine.selection.names], ["a"]);
  tap(200, 100); // the middle of l1
  assert.deepEqual([...engine.selection.names], ["a", "l1"], "toggled in: there is no shift on glass");
  tap(100, 100);
  assert.deepEqual([...engine.selection.names], ["l1"], "and out again");
  tap(600, 500);
  assert.deepEqual([...engine.selection.names], [], "empty canvas clears");
});

test("a finger reaches further than a mouse: 2.75× every radius, so a point is a 44 px target", async () => {
  const { model, view } = await sketch();
  const { engine, tap, fire } = engineOn(model, view);
  const off = PICK_POINT * TOUCH_REACH - 2; // 20 px from a: inside a finger's reach, far outside a mouse's
  // A mouse there picks nothing (the line l1 runs from a to the right, so go up-left).
  const d = off / Math.SQRT2;
  fire("pointerdown", { pointerType: "mouse", clientX: 100 - d, clientY: 100 - d, button: 0, buttons: 1 });
  fire("pointerup", { pointerType: "mouse", clientX: 100 - d, clientY: 100 - d, button: 0, buttons: 0 });
  assert.deepEqual([...engine.selection.names], [], "a mouse 20 px off a point misses it");
  tap(100 - d, 100 - d);
  assert.deepEqual([...engine.selection.names], ["a"], "a finger 20 px off takes it");
});

test("with text in the command line a tap inserts the name, and the selection is left alone", async () => {
  const { model, view } = await sketch();
  const { engine, tap, log } = engineOn(model, view, true);
  tap(300, 300);
  assert.deepEqual(log.picks, ["c"]);
  assert.equal(engine.selection.size, 0);
});

test("one finger on a point drags it, as the left button does — one user action, settled on release", async () => {
  const { model, view } = await sketch();
  const { finger, log } = engineOn(model, view);
  const f = finger(1);
  f.down(300, 300);
  f.move(320, 300);
  f.move(340, 310);
  f.up(340, 310);
  const [x, y] = model.coords("c");
  assert.ok(Math.abs(x - 340) < 1 && Math.abs(y + 310) < 1, `c followed the finger: ${x}, ${y}`);
  assert.deepEqual(log.actions, ["before", "after"]);
});

test("one finger on empty canvas pans a 2D view, and orbits a 3D one", async () => {
  const { model, view } = await sketch();
  const two = engineOn(model, view);
  const f = two.finger(1);
  f.down(600, 500);
  f.move(630, 520);
  f.up(630, 520);
  assert.ok(two.engine.view.ox > 20 && two.engine.view.right === undefined, "panned, nothing turned");

  const m3 = new Model(3);
  const three = engineOn(m3, { ox: 400, oy: 300, scale: 2 });
  const g = three.finger(1);
  g.down(300, 300);
  g.move(340, 300);
  g.move(380, 300);
  g.up(380, 300);
  assert.ok(viewAxes(three.engine.view).right[2] > 0.1, "the drawing turned");
  assert.equal(three.engine.view.ox, 400, "about its target");
  assert.equal(three.engine.selection.size, 0, "and an orbit selects nothing");
});

test("a long-press is the menu, for what it landed on; long-press then drag withdraws it and boxes, adding", async () => {
  const { model, view } = await sketch();
  const { engine, finger, clock, log, tap } = engineOn(model, view);
  const f = finger(1);
  f.down(300, 300);
  clock.advance(LONG_PRESS_MS + 1);
  assert.deepEqual(log.menus, ["c"]);
  f.up(300, 300);
  assert.equal(engine.selection.size, 0, "the lift after a long-press picks nothing");

  tap(100, 100); // select a, so the box is seen to add
  const g = finger(2);
  g.down(250, 50); // right of a, above l1
  clock.advance(LONG_PRESS_MS + 1);
  assert.deepEqual(log.menus, ["c", null]);
  g.move(350, 350); // a window over b and c and l2
  assert.equal(log.withdrawn, 1, "the menu is told to go");
  assert.ok(engine.box, "and a box is drawn");
  g.up(350, 350);
  assert.deepEqual([...engine.selection.names].sort(), ["a", "b", "c", "l2"]);
  assert.equal(engine.box, null);
});

test("two fingers pan by the centroid and zoom about it: the world point under the centroid stays under it", async () => {
  const { model, view } = await sketch();
  const { engine, finger } = engineOn(model, view);
  const [f, g] = [finger(1), finger(2)];
  f.down(400, 300);
  g.down(500, 300);
  // Centroid 450,300 → 470,320, spread 100 → 200.
  const under = engine.screenToWorld(450, 300);
  f.move(370, 320);
  g.move(570, 320);
  f.up(370, 320);
  g.up(570, 320);
  assert.ok(Math.abs(engine.view.scale - 2) < 1e-9, `zoomed ×2: ${engine.view.scale}`);
  const [sx, sy] = engine.worldToScreen(under);
  assert.ok(Math.abs(sx - 470) < 1e-6 && Math.abs(sy - 320) < 1e-6, `the point under the centroid moved with it: ${sx}, ${sy}`);
  assert.equal(engine.selection.size, 0);
});

test("a tool armed: a tap is its click, one finger's drag its gesture — a rectangle, with one undo step", async () => {
  const { model, view } = await sketch();
  const { engine, finger, tap, log } = engineOn(model, view);
  engine.arm("point");
  const points = () => [...model.entities.values()].filter((e) => e.kind === "point").length;
  const n = points();
  tap(500, 400);
  assert.equal(points(), n + 1, "one point, from one tap");
  assert.ok([...model.entities.values()].some((e) => e.kind === "point" && Math.abs(model.coords(e.name)[0] - 500) < 1e-6
    && Math.abs(model.coords(e.name)[1] + 400) < 1e-6), "where the finger landed");

  const before = model.entities.size;
  engine.arm("rectangle");
  log.actions.length = 0;
  const f = finger(1);
  f.down(450, 450);
  f.move(480, 470);
  f.move(600, 560);
  f.up(600, 560);
  assert.equal(model.entities.size, before + 8, "four corners and four sides");
  assert.equal(log.actions.filter((a) => a === "before").length, 2, "the press and the release, each bracketed, as a mouse's");
});

test("the tool's press is held until the finger decides: a pinch that began as one finger gives the tool nothing", async () => {
  const { model, view } = await sketch();
  const { engine, finger } = engineOn(model, view);
  engine.arm("point");
  const before = model.entities.size;
  const [f, g] = [finger(1), finger(2)];
  f.down(500, 400);
  g.down(560, 420);
  f.move(480, 400);
  g.move(600, 420);
  f.up(480, 400);
  g.up(600, 420);
  assert.equal(model.entities.size, before, "no point placed");
  assert.equal(engine.active?.name, "point", "still armed");
});

test("a second finger mid-rectangle drops the rectangle — nothing committed, the tool still armed and fresh", async () => {
  const { model, view } = await sketch();
  const { engine, finger } = engineOn(model, view);
  engine.arm("rectangle");
  const armed = engine.active;
  const before = model.entities.size;
  const [f, g] = [finger(1), finger(2)];
  f.down(450, 450);
  f.move(500, 500);
  f.move(560, 540);
  g.down(700, 300);
  g.move(720, 300);
  f.up(560, 540);
  g.up(720, 300);
  assert.equal(model.entities.size, before, "the half-drawn rectangle was not built");
  assert.equal(engine.active?.name, "rectangle");
  assert.notEqual(engine.active, armed, "a fresh instance: no gesture left in it");
  // ...and it draws the next one normally.
  const h = finger(3);
  h.down(450, 450);
  h.move(600, 560);
  h.up(600, 560);
  assert.equal(model.entities.size, before + 8);
});

test("a third finger drops everything until the hand is off — a dragged point is settled, not left pulled", async () => {
  const { model, view } = await sketch();
  const { finger, log } = engineOn(model, view);
  const [f, g, h] = [finger(1), finger(2), finger(3)];
  f.down(300, 300);
  f.move(330, 300);
  g.down(600, 100);
  h.down(650, 150);
  const at = model.coords("c");
  f.move(400, 400);
  g.move(500, 100);
  f.up(400, 400);
  g.up(500, 100);
  h.up(650, 150);
  assert.deepEqual(model.coords("c"), at, "nothing moved after the fingers were spent");
  assert.deepEqual(log.actions, ["before", "after"], "the drag that was abandoned is still one balanced action");
});

test("Escape (cancel) with a finger mid-drag: the finger is spent, and its next moves draw nothing", async () => {
  const { model, view } = await sketch();
  const { engine, finger } = engineOn(model, view);
  engine.arm("rectangle");
  const before = model.entities.size;
  const f = finger(1);
  f.down(450, 450);
  f.move(500, 500);
  engine.cancel();
  f.move(600, 560);
  f.up(600, 560);
  assert.equal(model.entities.size, before);
  assert.equal(engine.active, null);
});

test("a finger down reveals what is under it, as a hover does, and lifting ends it", async () => {
  const { model, view } = await sketch();
  const { engine, finger } = engineOn(model, view);
  const f = finger(1);
  f.down(300, 300);
  assert.equal(engine.hover?.name, "c");
  assert.deepEqual(engine.contact, [300, 300]);
  f.up(300, 300);
  assert.equal(engine.hover, null);
  assert.equal(engine.contact, null);
});

test("with a tool armed a finger down snaps at a finger's reach and keeps the contact for the lifted mark", async () => {
  const { model, view } = await sketch();
  const { engine, finger } = engineOn(model, view);
  engine.arm("point");
  const f = finger(1);
  f.down(318, 300); // 18 px from c: a mouse's 10 px snap would miss it
  assert.equal(engine.snap?.kind, "point");
  assert.deepEqual(engine.snap?.targets, ["c"]);
  assert.deepEqual(engine.contact, [318, 300]);
  assert.ok(LIFT >= 44, "lifted at least a fingertip clear");
  f.up(318, 300);
  assert.equal(engine.snap, null, "no marker left behind once the finger is off");
  assert.ok([...model.entities.values()].some((e) => e.kind === "point" && e.name !== "c"
    && Math.abs(model.coords(e.name)[0] - 300) < 1e-6), "the tap placed a point on c's place, snapped");
});

test("a mouse is untouched: a left drag on empty canvas is still a box, not an orbit", async () => {
  await loadKernel();
  const m3 = new Model(3);
  const { engine, fire } = engineOn(m3, { ox: 400, oy: 300, scale: 2 });
  fire("pointerdown", { pointerType: "mouse", clientX: 300, clientY: 300, button: 0, buttons: 1 });
  fire("pointermove", { pointerType: "mouse", clientX: 360, clientY: 340, button: -1, buttons: 1 });
  assert.ok(engine.box, "a box");
  assert.equal(engine.view.right, undefined, "no turn");
  fire("pointerup", { pointerType: "mouse", clientX: 360, clientY: 340, button: 0, buttons: 0 });
});
