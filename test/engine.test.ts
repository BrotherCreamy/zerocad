// The tool engine's gesture handling, driven by synthetic pointer events
// against a stand-in canvas.
//
// The end-to-end suite drives the same code with a real mouse in a real
// browser and is the authority on whether a drag *works*; what these add is
// the cases that are awkward to stage there — chiefly what happens when a
// gesture is abandoned rather than completed, which has no mouse event of its
// own and is otherwise reachable only through the keyboard.

import { test } from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { ensureKernelLoaded } from "../src/kernel/problem.ts";
import { Model } from "../src/model.ts";
import { fix, horizontal } from "../src/relations/basic.ts";
import { ToolEngine, type View } from "../src/tools/engine.ts";

async function loadKernel() {
  const bytes = await readFile(new URL("../src/kernel/wasm-gen/neocad_kernel_bg.wasm", import.meta.url));
  await ensureKernelLoaded(bytes);
}

/**
 * Enough of a canvas for the engine: it listens for pointer events, asks for a
 * 2d context it only uses to draw a tool's overlay, and measures its own box
 * to turn client coordinates into canvas-local ones.
 */
function fakeCanvas() {
  const listeners = new Map<string, ((e: unknown) => void)[]>();
  const canvas = {
    addEventListener(type: string, fn: (e: unknown) => void) {
      listeners.set(type, [...(listeners.get(type) ?? []), fn]);
    },
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

/**
 * A level pair of points with the left one pinned, and an engine driving it.
 * The view is the identity apart from y running the other way, so a client
 * coordinate is a world coordinate and the arithmetic in each test stays
 * readable.
 */
async function setup() {
  await loadKernel();
  const model = new Model(2);
  model.addPoint([0, 0], "a");
  model.addPoint([10, 0], "b");
  horizontal(model, "a", "b");
  fix(model, "a", [0, 0]);
  model.solve();

  const { canvas, fire } = fakeCanvas();
  const view: View = { ox: 0, oy: 0, scale: 1 };
  const counts = { solves: 0, renders: 0, picks: 0 };
  const engine = new ToolEngine(model, canvas, view, {
    onSolveRender: () => { counts.solves++; model.solve(); },
    onRenderOnly: () => { counts.renders++; },
    onPick: () => { counts.picks++; },
  });
  return { model, engine, fire, counts };
}

test("cancelling mid-drag settles the model instead of keeping the pull", async () => {
  const { model, engine, fire, counts } = await setup();

  fire("pointerdown", { clientX: 10, clientY: 0, button: 0, buttons: 1 });
  fire("pointermove", { clientX: 60, clientY: 40, button: -1, buttons: 1 });

  // Mid-drag the pull is being weighed against the constraints, so it has bent
  // them: the fixed point is off its fix and the pair is no longer level.
  // That is correct while the button is down and wrong the moment it isn't.
  assert.ok(Math.abs(model.coords("a")[1]) > 0.1,
    `expected the pull to have bent the fix mid-drag, a = ${model.coords("a")}`);
  assert.equal(counts.solves, 0, "intermediate frames do not go through the solve path");

  engine.cancel();

  assert.equal(counts.solves, 1, "cancel settles through the host's solve path, so the status line is true");
  assert.ok(Math.abs(model.coords("a")[1]) < 1e-6 && Math.abs(model.coords("a")[0]) < 1e-6,
    `the fixed point came back: a = ${model.coords("a")}`);
  assert.ok(Math.abs(model.coords("b")[1] - model.coords("a")[1]) < 1e-6,
    `the pair is level again: b = ${model.coords("b")}`);
});

test("cancelling a press that never became a drag solves nothing", async () => {
  const { engine, fire, counts } = await setup();

  fire("pointerdown", { clientX: 10, clientY: 0, button: 0, buttons: 1 });
  fire("pointermove", { clientX: 11, clientY: 1, button: -1, buttons: 1 }); // inside the 3px threshold
  engine.cancel();

  assert.equal(counts.solves, 0, "nothing moved, so there is nothing to settle");
  assert.ok(counts.renders > 0, "but the canvas is still repainted");
});

test("cancelling a pan solves nothing either", async () => {
  const { engine, fire, counts } = await setup();

  // A press on empty space: it pans, and a pan has never touched the model.
  fire("pointerdown", { clientX: 400, clientY: 300, button: 0, buttons: 1 });
  fire("pointermove", { clientX: 460, clientY: 340, button: -1, buttons: 1 });
  engine.cancel();

  assert.equal(counts.solves, 0);
});

test("releasing a drag settles it, and a release without movement picks", async () => {
  const { fire, counts } = await setup();

  fire("pointerdown", { clientX: 10, clientY: 0, button: 0, buttons: 1 });
  fire("pointermove", { clientX: 40, clientY: 0, button: -1, buttons: 1 });
  fire("pointerup", { clientX: 40, clientY: 0, button: 0, buttons: 0 });
  assert.equal(counts.solves, 1, "release settles");
  assert.equal(counts.picks, 0, "a drag is not a pick");

  // Same button, same point, no movement: today's click, unchanged.
  fire("pointerdown", { clientX: 40, clientY: 0, button: 0, buttons: 1 });
  fire("pointerup", { clientX: 40, clientY: 0, button: 0, buttons: 0 });
  assert.equal(counts.picks, 1, "the name still goes to the command line");
  assert.equal(counts.solves, 1, "and nothing was solved for it");
});
