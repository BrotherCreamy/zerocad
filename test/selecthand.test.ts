// Select and the Hand (docs/plans/select-hand.md; the owner: "there is no
// hand/selction tool. would be nice since a lot of people are used to that").
// Select is "no tool" given a name; the Hand changes how a press that moves is
// read — a pan from wherever it lands — and Space holds one over whatever is
// armed. Against a stand-in canvas, as touch.test.ts drives the engine: the
// e2e suite (selecthand.e2e.ts) is the authority on a real browser's events.

import { test } from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { ensureKernelLoaded } from "../src/kernel/problem.ts";
import { Model } from "../src/model.ts";
import { ToolEngine, type View } from "../src/tools/engine.ts";
import { type Clock } from "../src/tools/gestures.ts";
import { defineTool, toolbarTools, listTools, Tool } from "../src/tools/tool.ts";
import { actionCommand } from "../src/panels.ts";
import { viewAxes, worldToScreen } from "../src/view.ts";
import "../src/modules/builtin.ts"; // registers the built-in tools, as the app does
import "../src/modules/builtin.ts"; // registers the built-in tools, as the app does
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

function engineOn(model: Model, view: View) {
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
  const clock = new FakeClock();
  const actions: string[] = [];
  const engine = new ToolEngine(model, canvas as unknown as HTMLCanvasElement, view, {
    onSolveRender: () => { model.solve(); },
    onRenderOnly: () => {},
    onUserAction: (phase) => { actions.push(phase); },
    clock,
  });
  const mouse = {
    down: (x: number, y: number) => fire("pointerdown", { pointerType: "mouse", clientX: x, clientY: y, button: 0, buttons: 1 }),
    move: (x: number, y: number) => fire("pointermove", { pointerType: "mouse", clientX: x, clientY: y, button: -1, buttons: 1 }),
    up: (x: number, y: number) => fire("pointerup", { pointerType: "mouse", clientX: x, clientY: y, button: 0, buttons: 0 }),
    drag(from: [number, number], to: [number, number]) {
      this.down(...from);
      for (let s = 1; s <= 4; s++) this.move(from[0] + (to[0] - from[0]) * s / 4, from[1] + (to[1] - from[1]) * s / 4);
      this.up(...to);
    },
  };
  const finger = {
    drag(from: [number, number], to: [number, number]) {
      const at = (x: number, y: number) => ({ pointerId: 7, pointerType: "touch", clientX: x, clientY: y });
      fire("pointerdown", { ...at(...from), button: 0, buttons: 1 });
      for (let s = 1; s <= 4; s++) {
        clock.advance(16);
        fire("pointermove", { ...at(from[0] + (to[0] - from[0]) * s / 4, from[1] + (to[1] - from[1]) * s / 4), button: -1, buttons: 1 });
      }
      fire("pointerup", { ...at(...to), button: 0, buttons: 0 });
    },
  };
  return { engine, canvas, mouse, finger, actions };
}

/** A 2D drawing whose view is the identity with y flipped: world (x, y) is canvas (x, −y). */
async function sketch() {
  await loadKernel();
  const model = new Model(2);
  axisFrame(model);
  model.addPoint([100, -100], "a");
  model.addPoint([300, -100], "b");
  model.addLine("a", "b", "l1");
  model.solve();
  return { model, view: { ox: 0, oy: 0, scale: 1 } as View };
}

test("the toolbar's list is Select, the Hand, then the registry — and neither name can be defined over", () => {
  assert.deepEqual(toolbarTools().slice(0, 2), ["select", "hand"]);
  assert.deepEqual(toolbarTools().slice(2), listTools());
  assert.ok(!listTools().includes("select") && !listTools().includes("hand"), "they are not classes in the registry");
  for (const name of ["select", "hand"]) {
    assert.throws(() => defineTool(name, class extends Tool { name = name; }), /the toolbar's own/);
  }
});

test('with nothing armed, Select is lit; arm("hand") lights the Hand; arm("select") lights Select again', async () => {
  const { model, view } = await sketch();
  const { engine } = engineOn(model, view);
  assert.equal(engine.lit, "select");
  engine.arm("hand");
  assert.equal(engine.lit, "hand");
  assert.equal(engine.active, null, "the Hand is no tool: nothing is active");
  assert.equal(engine.armed, null, "and nothing is armed for an undo to re-arm as a tool");
  engine.arm("select");
  assert.equal(engine.lit, "select");
  assert.equal(engine.hand, false);
  engine.arm("rectangle");
  assert.equal(engine.lit, "rectangle");
  engine.arm("hand");
  assert.equal(engine.lit, "hand", "the Hand puts a tool down");
  assert.equal(engine.active, null);
  engine.arm("point");
  assert.equal([engine.lit, engine.hand].join(), "point,false", "and a tool puts the Hand down");
});

test('arm("select") puts a half-drawn rectangle down and keeps the selection', async () => {
  const { model, view } = await sketch();
  const { engine, mouse } = engineOn(model, view);
  engine.arm("rectangle");
  engine.select(["l1"]); // typed select() while armed: a selection that is there to keep
  const size = model.entities.size;
  mouse.down(500, 400);
  mouse.move(600, 500);
  engine.arm("select");
  mouse.up(600, 500);
  assert.equal(engine.active, null, "disarmed");
  assert.equal(model.entities.size, size, "and the rectangle was never built — not even by the release");
  assert.deepEqual([...engine.selection.names], ["l1"], "the selection left alone");

  engine.arm("hand");
  assert.deepEqual([...engine.selection.names], ["l1"], "the Hand does not spend it either");
  engine.arm("select");
  assert.deepEqual([...engine.selection.names], ["l1"]);
});

test("Select and the Hand take no options, refused before anything is put down", async () => {
  const { model, view } = await sketch();
  const { engine } = engineOn(model, view);
  engine.arm("point");
  assert.throws(() => engine.arm("select", { depth: 3 }), /select takes no options/);
  assert.throws(() => engine.arm("hand", { x: 1 }), /hand takes no options/);
  assert.equal(engine.lit, "point", "the armed tool is as it was");
});

test("the Hand: a left-drag starting on a point pans the 2D view, the point under the cursor stays under it, nothing moves", async () => {
  const { model, view } = await sketch();
  const { engine, mouse, actions } = engineOn(model, view);
  engine.arm("hand");
  const before = model.coords("a");
  mouse.drag([100, 100], [160, 140]);
  assert.deepEqual(model.coords("a"), before, "a has not moved");
  assert.deepEqual(worldToScreen(engine.view, model.coords("a")), [160, 140], "and it is where the cursor let go");
  assert.equal(engine.selection.size, 0, "a pan selects nothing");
  assert.deepEqual(actions, [], "and is no user action: the view is not the model");
  assert.equal(engine.box, null, "no box either");
});

test("the Hand pans a 3D view too — not an orbit — the point under the cursor staying under it", async () => {
  await loadKernel();
  const model = new Model(3);
  model.addPoint([10, 20, 0], "p");
  const { engine, mouse, finger } = engineOn(model, { ox: 400, oy: 300, scale: 2 });
  engine.arm("hand");
  const [sx, sy] = worldToScreen(engine.view, [10, 20, 0]);
  mouse.drag([sx, sy], [sx + 40, sy + 25]);
  const [x1, y1] = worldToScreen(engine.view, [10, 20, 0]);
  assert.ok(Math.abs(x1 - (sx + 40)) < 1e-9 && Math.abs(y1 - (sy + 25)) < 1e-9, `under the cursor: ${x1}, ${y1}`);
  assert.deepEqual(model.coords("p"), [10, 20, 0], "p has not moved");
  assert.equal(engine.view.right, undefined, "nothing turned");

  // A finger: the same pan, from empty canvas, where without the Hand it orbits.
  finger.drag([200, 200], [230, 260]);
  const [x2, y2] = worldToScreen(engine.view, [10, 20, 0]);
  assert.ok(Math.abs(x2 - (x1 + 30)) < 1e-9 && Math.abs(y2 - (y1 + 60)) < 1e-9, `a finger panned it: ${x2}, ${y2}`);
  assert.equal(engine.view.right, undefined, "and did not orbit");
  engine.arm("select");
  finger.drag([200, 200], [260, 200]);
  assert.ok(viewAxes(engine.view).right[2] !== 0, "without it, the same finger turns the drawing");
});

test("the Hand: a finger on a point pans and leaves it; a click still selects", async () => {
  const { model, view } = await sketch();
  const { engine, mouse, finger } = engineOn(model, view);
  engine.arm("hand");
  finger.drag([100, 100], [130, 90]);
  assert.deepEqual(model.coords("a"), [100, -100], "a finger on a with the Hand moves the view, not a");
  assert.deepEqual(worldToScreen(engine.view, [100, -100]), [130, 90]);
  const [lx, ly] = worldToScreen(engine.view, [200, -100]); // the middle of l1, wherever the pan put it
  mouse.down(lx, ly);
  mouse.up(lx, ly);
  assert.deepEqual([...engine.selection.names], ["l1"], "a click that never moved picks, as with nothing armed");
  assert.equal(engine.lit, "hand", "and the Hand stays armed");
});

test("Space held is a Hand over the armed tool: a drag pans, nothing is drawn, and the tool is lit again after", async () => {
  const { model, view } = await sketch();
  const { engine, mouse, canvas } = engineOn(model, view);
  engine.arm("rectangle");
  const size = model.entities.size;
  assert.equal(engine.hold(true), true);
  assert.equal(engine.hold(true), false, "a held key repeats; nothing changes twice");
  assert.equal(engine.lit, "hand");
  assert.equal(canvas.style.cursor, "grab");
  mouse.down(500, 400);
  assert.equal(canvas.style.cursor, "grabbing");
  mouse.move(520, 420);
  mouse.move(540, 450);
  mouse.up(540, 450);
  assert.equal(canvas.style.cursor, "grab");
  assert.deepEqual([engine.view.ox, engine.view.oy], [40, 50], "panned by the drag");
  assert.equal(model.entities.size, size, "no rectangle");
  mouse.down(600, 300);
  mouse.up(600, 300);
  assert.equal(model.entities.size, size, "and a still click under Space reaches no one");
  assert.equal(engine.selection.size, 0);
  engine.hold(false);
  assert.equal(engine.lit, "rectangle", "the tool that was armed is back");
  assert.equal(engine.active?.name, "rectangle", "it never went anywhere");
  assert.equal(canvas.style.cursor, "");

  // Let go mid-pan: the pan runs to its release, and the tool does not get a stray release.
  engine.hold(true);
  mouse.down(100, 300);
  mouse.move(120, 300);
  engine.hold(false);
  mouse.move(150, 300);
  mouse.up(150, 300);
  assert.deepEqual([engine.view.ox, engine.view.oy], [90, 50]);
  assert.equal(model.entities.size, size);
  mouse.drag([300, 400], [400, 500]);
  assert.ok(model.entities.size > size, "and the next drag is the rectangle's again");
});

test("Escape, cancel() and the action strip's Cancel put the Hand down", async () => {
  const { model, view } = await sketch();
  const { engine } = engineOn(model, view);
  engine.arm("hand");
  assert.equal(engine.escape(), "cancelled");
  assert.equal(engine.lit, "select");
  engine.arm("hand");
  engine.cancel();
  assert.equal(engine.lit, "select");
  const state = { canUndo: false, canRedo: false, selected: [] as string[], armed: false };
  assert.equal(actionCommand("cancel", { ...state, hand: true }), "cancel()", "Cancel is offered with only the Hand armed");
  assert.equal(actionCommand("cancel", state), null);
  assert.equal(actionCommand("delete", { ...state, hand: true, selected: ["l1"] }), 'del("l1")',
    "and Delete still deletes what a tap under the Hand selected");
});
