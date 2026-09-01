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
import "../src/tools/point.ts"; // registers the "point" tool, armed below

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
  // Every user-action phase in order, each tagged with how many solves had
  // happened by the time it arrived — which is how the "after" phase is checked
  // to land on the *settled* model rather than on a frame of the gesture.
  const actions: string[] = [];
  const engine = new ToolEngine(model, canvas, view, {
    onSolveRender: () => { counts.solves++; model.solve(); },
    onRenderOnly: () => { counts.renders++; },
    onPick: () => { counts.picks++; },
    onUserAction: (phase) => { actions.push(`${phase}@${counts.solves}`); },
  });
  return { model, engine, fire, counts, actions };
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

test("cancelling a selection box solves nothing, and selects nothing", async () => {
  const { engine, fire, counts } = await setup();

  // A press on empty space draws a box, and a box has never touched the model.
  fire("pointerdown", { clientX: 400, clientY: 300, button: 0, buttons: 1 });
  fire("pointermove", { clientX: 460, clientY: 340, button: -1, buttons: 1 });
  assert.ok(engine.box, "the box is up");

  engine.cancel();
  assert.equal(engine.box, null, "Escape drops it");
  assert.equal(counts.solves, 0);

  // The release that follows an Escape must not belatedly select: the press
  // state was cleared, so there is nothing left for it to complete.
  fire("pointerup", { clientX: 460, clientY: 340, button: 0, buttons: 0 });
  assert.equal(counts.picks, 0);
});

test("a left-drag on empty canvas draws a box and selects what it catches", async () => {
  const { engine, fire, counts } = await setup();
  const view = { ...engine.view };

  // The fixture's two points are at world (0,0) and (10,0), which this view
  // puts at screen (0,0) and (10,0). Dragging right→left over both is a
  // crossing box; either way it catches the pair.
  fire("pointerdown", { clientX: 40, clientY: 30, button: 0, buttons: 1 });
  fire("pointermove", { clientX: -20, clientY: -30, button: -1, buttons: 1 });
  assert.equal(engine.boxMode, "crossing", "right→left is a crossing box");

  fire("pointerup", { clientX: -20, clientY: -30, button: 0, buttons: 0 });
  assert.equal(counts.picks, 2, "both points went to the command line");
  assert.equal(engine.box, null, "and the box is gone");
  assert.deepEqual({ ...engine.view }, view, "a box is not a pan — the view did not move");
  assert.equal(counts.solves, 0, "selecting is not editing");
});

test("a box that catches nothing inserts nothing", async () => {
  const { fire, counts } = await setup();
  fire("pointerdown", { clientX: 300, clientY: 300, button: 0, buttons: 1 });
  fire("pointermove", { clientX: 380, clientY: 360, button: -1, buttons: 1 });
  fire("pointerup", { clientX: 380, clientY: 360, button: 0, buttons: 0 });
  assert.equal(counts.picks, 0);
});

test("a press that grabbed a point drags it, and draws no box", async () => {
  const { engine, fire, counts } = await setup();
  const before = { ...engine.view };

  // The rule has two halves and this is the second: only a press on *nothing*
  // becomes a box. (The e2e suite covers the third case — a press on an edge,
  // which still pans — since this fixture has no edge to aim at.)
  fire("pointerdown", { clientX: 10, clientY: 0, button: 0, buttons: 1 });
  fire("pointermove", { clientX: 70, clientY: 40, button: -1, buttons: 1 });
  assert.equal(engine.box, null, "a press on a point drags it, and draws no box");
  fire("pointerup", { clientX: 70, clientY: 40, button: 0, buttons: 0 });

  assert.deepEqual({ ...engine.view }, before, "and it did not pan either");
  assert.equal(counts.picks, 0);
  assert.equal(counts.solves, 1, "it was a drag, so it settled");
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

// --- the user-action bracket ----------------------------------------------
//
// The engine reports "a gesture began" and "a gesture ended" and nothing more;
// what main.ts hangs on that is undo. These tests are about the property the
// host depends on and cannot check for itself: the two phases always come in
// pairs, and "after" arrives once the model has settled. An unpaired "before"
// would leave the host's bracket open for the rest of the session — a failure
// with no symptom until the next thing the user does goes unrecorded.

test("a drag brackets from its first moving frame to its settling solve", async () => {
  const { fire, actions, counts } = await setup();

  fire("pointerdown", { clientX: 10, clientY: 0, button: 0, buttons: 1 });
  assert.deepEqual(actions, [], "a press is not yet a gesture — it may still be a pick");

  fire("pointermove", { clientX: 40, clientY: 0, button: -1, buttons: 1 });
  assert.deepEqual(actions, ["before@0"], "the state to go back to is the one before the first frame");
  fire("pointermove", { clientX: 60, clientY: 0, button: -1, buttons: 1 });
  assert.deepEqual(actions, ["before@0"], "and a drag is one action however many frames it takes");

  fire("pointerup", { clientX: 60, clientY: 0, button: 0, buttons: 0 });
  assert.deepEqual(actions, ["before@0", "after@1"], "closed *after* the settling solve");
  assert.equal(counts.solves, 1);
});

test("a cancelled drag closes its bracket, because it settles like a release", async () => {
  const { engine, fire, actions } = await setup();

  fire("pointerdown", { clientX: 10, clientY: 0, button: 0, buttons: 1 });
  fire("pointermove", { clientX: 40, clientY: 0, button: -1, buttons: 1 });
  engine.cancel();

  // Escape mid-drag leaves geometry behind exactly as a release does, so it is
  // the same one step. Leaving it open would also strand the host's bracket.
  assert.deepEqual(actions, ["before@0", "after@1"]);
});

test("a pick, a pan and a box are not user actions at all", async () => {
  const { fire, actions } = await setup();

  // Pressed and released on a point without moving: a pick.
  fire("pointerdown", { clientX: 10, clientY: 0, button: 0, buttons: 1 });
  fire("pointerup", { clientX: 11, clientY: 0, button: 0, buttons: 0 });
  // Pressed on empty space and moved: a selection box. Selecting is not
  // editing, and this one catches both points on the way past.
  fire("pointerdown", { clientX: 400, clientY: 300, button: 0, buttons: 1 });
  fire("pointermove", { clientX: -20, clientY: -20, button: -1, buttons: 1 });
  fire("pointerup", { clientX: -20, clientY: -20, button: 0, buttons: 0 });
  // Right-dragged: a pan. The view is not the model.
  fire("pointerdown", { clientX: 400, clientY: 300, button: 2, buttons: 2 });
  fire("pointermove", { clientX: 460, clientY: 340, button: -1, buttons: 2 });
  fire("pointerup", { clientX: 460, clientY: 340, button: 2, buttons: 0 });

  assert.deepEqual(actions, [], "none of the three changes the model, and none opens a bracket");
});

test("an armed tool brackets its press and its release", async () => {
  const { engine, fire, actions, model } = await setup();
  engine.arm("point");

  const before = model.entities.size;
  fire("pointerdown", { clientX: 100, clientY: 100, button: 0, buttons: 1 });
  fire("pointerup", { clientX: 100, clientY: 100, button: 0, buttons: 0 });

  // The point tool commits on the press and finishes there, so the release
  // reaches no tool at all — hence one pair, not two. The rectangle commits the
  // other way round, on release, which is exactly why both are bracketed and
  // the host is left to notice which one changed anything.
  assert.equal(model.entities.size, before + 1, "the click placed a point");
  assert.deepEqual(actions, ["before@0", "after@1"]);
});

test("a tool that throws still closes its bracket", async () => {
  const { engine, fire, actions } = await setup();
  engine.arm("point");
  (engine as unknown as { active: { onDown(): void } }).active.onDown = () => { throw new Error("boom"); };

  assert.throws(() => fire("pointerdown", { clientX: 5, clientY: 5, button: 0, buttons: 1 }), /boom/);
  assert.deepEqual(actions, ["before@0", "after@0"], "the bracket is closed in a finally");
});
