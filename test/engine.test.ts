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
import { dist, fix } from "../src/relations/basic.ts";
import { parallel } from "../src/relations/geometry.ts";
import { ToolEngine, type View } from "../src/tools/engine.ts";
import "../src/tools/point.ts"; // registers the "point" tool, armed below
import { axisFrame } from "./frames.ts";

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
  // `fix` and the axis references are relative to a frame, so the fixture
  // makes one — and its origin and x-ref are ordinary points, which is why the
  // counts below are of four points rather than two.
  axisFrame(model);
  model.addPoint([0, 0], "a");
  model.addPoint([10, 0], "b");
  parallel(model, "a", "b", "f.x");
  fix(model, "a", [0, 0]);
  model.solve();

  const { canvas, fire } = fakeCanvas();
  const view: View = { ox: 0, oy: 0, scale: 1 };
  const counts = { solves: 0, renders: 0, picks: 0 };
  // Every user-action phase in order, each tagged with how many solves had
  // happened by the time it arrived — which is how the "after" phase is checked
  // to land on the *settled* model rather than on a frame of the gesture.
  const actions: string[] = [];
  /** Every context-menu request the engine made: what it landed on, and where. */
  const menus: { name: string | null; at: [number, number] }[] = [];
  const engine = new ToolEngine(model, canvas, view, {
    onSolveRender: () => { counts.solves++; model.solve(); },
    onRenderOnly: () => { counts.renders++; },
    onPick: () => { counts.picks++; },
    // These fixtures are about the gesture — click or drag, box or pan — so
    // they write a command: a pick is then an insertion, counted here. What a
    // click does with the command line empty (it selects) is tested below.
    composing: () => true,
    onUserAction: (phase) => { actions.push(`${phase}@${counts.solves}`); },
    onContextMenu: (pick, sx, sy) => { menus.push({ name: pick?.name ?? null, at: [sx, sy] }); },
  });
  return { model, engine, fire, counts, actions, menus };
}

// The right button's own click/drag split. `buttons: 2` is the right button
// held; `button: 2` is the right button being the one that changed.
const RIGHT_DOWN = { button: 2, buttons: 2 };
const RIGHT_HELD = { button: -1, buttons: 2 };
const RIGHT_UP = { button: 2, buttons: 0 };

test("a right press released where it landed asks for a menu, and does not pan", async () => {
  const { engine, fire, menus, counts } = await setup();
  const view = { ...engine.view };

  // On the point at (10, 0) — the menu has to be told what it landed on, since
  // the whole feature is that the items differ by kind.
  fire("pointerdown", { clientX: 10, clientY: 0, ...RIGHT_DOWN });
  fire("pointermove", { clientX: 11, clientY: 1, ...RIGHT_HELD }); // inside the threshold
  fire("pointerup", { clientX: 11, clientY: 1, ...RIGHT_UP });

  assert.deepEqual(menus, [{ name: "b", at: [11, 1] }]);
  assert.deepEqual({ ...engine.view }, view, "a press that did not move must not have panned");
  assert.equal(counts.picks, 0, "and it is not a pick either — the left button owns that");
});

test("a right press on empty canvas still asks for a menu, with nothing under it", async () => {
  const { fire, menus } = await setup();
  fire("pointerdown", { clientX: 400, clientY: 300, ...RIGHT_DOWN });
  fire("pointerup", { clientX: 400, clientY: 300, ...RIGHT_UP });
  assert.deepEqual(menus, [{ name: null, at: [400, 300] }]);
});

test("a right DRAG still pans, and asks for no menu — the release decides, not the press", async () => {
  const { engine, fire, menus } = await setup();
  const before = { ...engine.view };

  fire("pointerdown", { clientX: 200, clientY: 200, ...RIGHT_DOWN });
  fire("pointermove", { clientX: 240, clientY: 230, ...RIGHT_HELD });
  fire("pointermove", { clientX: 280, clientY: 260, ...RIGHT_HELD });
  fire("pointerup", { clientX: 280, clientY: 260, ...RIGHT_UP });

  assert.deepEqual(menus, [], "a drag is a pan and nothing else");
  // The first frame past the threshold is what carries the view, so at most one
  // threshold's worth of travel is dropped — which is what makes the split free.
  assert.ok(engine.view.ox > before.ox + 60 && engine.view.ox <= before.ox + 80,
    `the view panned with the cursor: ox went ${before.ox} → ${engine.view.ox}`);
  assert.ok(engine.view.oy > before.oy + 40 && engine.view.oy <= before.oy + 60,
    `and in y too: oy went ${before.oy} → ${engine.view.oy}`);
});

test("the middle button is navigation only — it never asks for a menu", async () => {
  const { fire, menus } = await setup();
  fire("pointerdown", { clientX: 300, clientY: 300, button: 1, buttons: 4 });
  fire("pointerup", { clientX: 300, clientY: 300, button: 1, buttons: 0 });
  assert.deepEqual(menus, [], "one button that unambiguously means pan is worth keeping");
});

test("a right click taken during a left drag opens nothing over the gesture", async () => {
  const { fire, menus } = await setup();

  // Pressing a second button while one is held arrives as a *move* with the
  // mask updated, never as another pointerdown — the bug that made mid-gesture
  // panning silently do nothing, and the reason this path is worth a test.
  fire("pointerdown", { clientX: 10, clientY: 0, button: 0, buttons: 1 });
  fire("pointermove", { clientX: 40, clientY: 20, button: -1, buttons: 1 });
  fire("pointermove", { clientX: 40, clientY: 20, button: -1, buttons: 3 }); // right goes down too
  fire("pointermove", { clientX: 40, clientY: 20, button: -1, buttons: 1 }); // and comes back up

  assert.deepEqual(menus, [], "the left drag is still in progress; nothing may interrupt it");
});

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

  // The drawing's two points are at world (0,0) and (10,0), which this view
  // puts at screen (0,0) and (10,0); the fixture frame's origin and x-ref sit
  // at (0,0) and (1,0) beside them, and the frame's own axes marker reaches
  // 30px out of that origin. Dragging right→left over the lot is a crossing
  // box; either way it catches all four points and the frame.
  fire("pointerdown", { clientX: 40, clientY: 30, button: 0, buttons: 1 });
  fire("pointermove", { clientX: -20, clientY: -30, button: -1, buttons: 1 });
  assert.equal(engine.boxMode, "crossing", "right→left is a crossing box");

  fire("pointerup", { clientX: -20, clientY: -30, button: 0, buttons: 0 });
  assert.equal(counts.picks, 5, "every point in the box, and the frame, went to the command line");
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
  // becomes a box. (The edge and rim cases are below, on a fixture that has
  // some.)
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

// --- dragging an edge, a rim, an arc ---------------------------------------
//
// Dragging a whole entity is dragging every point it is made of by the same
// offset, as a *target*: one soft pull each, toward that point's grab-time
// position plus however far the cursor has travelled. Nothing about the
// gesture is new — it is the point drag with more than one pull — so what
// these check is the arithmetic of the offset (which is what a rigid
// translation means), and that the tiers underneath still decide correctly
// what a press grabbed.

/**
 * A free line, a free circle and a free arc, none of them constrained. The
 * view is `setup`'s, so a client coordinate is a world coordinate with y
 * flipped: world (0,0) is screen (0,0) and world (60,-20) is screen (60,20).
 *
 * The three are placed well apart, and each drag below presses at a spot that
 * is far from every point in the model — the point tier wins outright inside
 * 8px, and a test that accidentally grabbed an endpoint would still pass for
 * the wrong reason.
 */
async function shapes() {
  await loadKernel();
  const model = new Model(2);
  axisFrame(model); // what `fix` and `f.x` below mean — see test/frames.ts
  model.addPoint([0, 0], "a");
  model.addPoint([60, 0], "b");
  model.addLine("a", "b", "l1");
  model.addPoint([100, -100], "cc");
  model.addCircle("cc", 30, null, "c1");
  model.addPoint([200, -200], "ac");
  model.addPoint([240, -200], "as");
  model.addPoint([200, -160], "ae");
  model.addArc("ac", "as", "ae", 40, null, "a1");
  model.solve();

  const { canvas, fire } = fakeCanvas();
  const view: View = { ox: 0, oy: 0, scale: 1 };
  const counts = { solves: 0, renders: 0, picks: 0 };
  const actions: string[] = [];
  const engine = new ToolEngine(model, canvas, view, {
    onSolveRender: () => { counts.solves++; model.solve(); },
    onRenderOnly: () => { counts.renders++; },
    onPick: () => { counts.picks++; },
    // These fixtures are about the gesture — click or drag, box or pan — so
    // they write a command: a pick is then an insertion, counted here. What a
    // click does with the command line empty (it selects) is tested below.
    composing: () => true,
    onUserAction: (phase) => { actions.push(`${phase}@${counts.solves}`); },
  });
  return { model, engine, fire, counts, actions };
}

/** Press at (x0,y0), move by (dx,dy) screen pixels, release. */
function dragBy(fire: (t: string, e: Record<string, unknown>) => void,
                x0: number, y0: number, dx: number, dy: number): void {
  fire("pointerdown", { clientX: x0, clientY: y0, button: 0, buttons: 1 });
  fire("pointermove", { clientX: x0 + dx / 2, clientY: y0 + dy / 2, button: -1, buttons: 1 });
  fire("pointermove", { clientX: x0 + dx, clientY: y0 + dy, button: -1, buttons: 1 });
  fire("pointerup", { clientX: x0 + dx, clientY: y0 + dy, button: 0, buttons: 0 });
}

/** How far each named point has moved from `from`, componentwise. */
function moved(model: Model, from: Record<string, number[]>): Record<string, number[]> {
  return Object.fromEntries(Object.entries(from).map(([n, was]) =>
    [n, model.coords(n).map((c, i) => c - was[i])]));
}

test("dragging a free edge moves both endpoints by the drag offset", async () => {
  const { model, engine, fire, counts } = await shapes();
  const before = { a: model.coords("a"), b: model.coords("b") };
  const view = { ...engine.view };

  // The middle of l1, 30px from either endpoint. 30 right and 20 up on screen
  // is +30, +20 in world, y being flipped.
  dragBy(fire, 30, 0, 30, -20);

  const d = moved(model, before);
  for (const [name, delta] of Object.entries(d)) {
    assert.ok(Math.abs(delta[0] - 30) < 1e-6 && Math.abs(delta[1] - 20) < 1e-6,
      `${name} moved by ${delta}, not by the drag offset (30, 20)`);
  }
  assert.deepEqual({ ...engine.view }, view, "an edge drag moves the drawing, not the view");
  assert.equal(engine.box, null, "and it is not a selection box either");
  assert.equal(counts.picks, 0, "a drag is not a pick");
  assert.equal(counts.solves, 1, "it settled once, on release");
});

test("an edge with a fixed endpoint strains toward the cursor and settles legally", async () => {
  const { model, fire } = await shapes();
  fix(model, "a", [0, 0]);
  model.solve();
  const b0 = model.coords("b");

  dragBy(fire, 30, 0, 40, 0); // 40px right, along the edge

  const a = model.coords("a");
  assert.ok(Math.hypot(a[0], a[1]) < 1e-6, `the fixed endpoint ended at ${a}`);
  // The other end is free, so it goes exactly where the pull asked — which is
  // the drag offset, not half of it: this is a translation as a *target*, and
  // the constraint took its share out of the fixed end alone.
  const b = model.coords("b");
  assert.ok(Math.abs(b[0] - (b0[0] + 40)) < 1e-6 && Math.abs(b[1] - b0[1]) < 1e-6,
    `the free end went to ${b}, not to ${[b0[0] + 40, b0[1]]}`);
});

test("dragging a rim translates a circle and does not resize it", async () => {
  const { model, fire } = await shapes();
  const c0 = model.coords("cc");
  const r0 = model.radius("c1");

  // Screen (130,100) is on the rim: the centre is world (100,-100), and 30
  // world units to its right.
  dragBy(fire, 130, 100, 30, -20);

  const c = model.coords("cc");
  assert.ok(Math.abs(c[0] - (c0[0] + 30)) < 1e-6 && Math.abs(c[1] - (c0[1] + 20)) < 1e-6,
    `the centre went to ${c}, not to ${[c0[0] + 30, c0[1] + 20]}`);
  // The radius is what a rim drag must *not* touch — dragging a circle moves
  // it, and resizing is `rad` and the centre-out tool's job.
  assert.ok(Math.abs(model.radius("c1") - r0) < 1e-6,
    `the radius went from ${r0} to ${model.radius("c1")}`);
});

test("dragging an arc's rim carries its centre and both endpoints", async () => {
  const { model, fire } = await shapes();
  const before = { ac: model.coords("ac"), as: model.coords("as"), ae: model.coords("ae") };
  const r0 = model.radius("a1");

  // 45° round the arc from its start, which is inside the sweep and 40px from
  // the centre — well clear of every point in the model.
  const [x, y] = [200 + 40 * Math.SQRT1_2, 200 - 40 * Math.SQRT1_2];
  dragBy(fire, x, y, 30, -20);

  for (const [name, delta] of Object.entries(moved(model, before))) {
    assert.ok(Math.abs(delta[0] - 30) < 1e-6 && Math.abs(delta[1] - 20) < 1e-6,
      `${name} moved by ${delta}, not by the drag offset (30, 20)`);
  }
  assert.ok(Math.abs(model.radius("a1") - r0) < 1e-6, "and the arc is the same size it was");
});

test("cancelling an edge drag settles it, and it is still one action", async () => {
  const { model, engine, fire, actions, counts } = await shapes();
  fix(model, "a", [0, 0]);
  model.solve();

  fire("pointerdown", { clientX: 30, clientY: 0, button: 0, buttons: 1 });
  fire("pointermove", { clientX: 90, clientY: -40, button: -1, buttons: 1 });
  assert.ok(Math.hypot(...model.coords("a")) > 0.1,
    `mid-drag the pull has bent the fix, a = ${model.coords("a")}`);
  assert.equal(counts.solves, 0, "intermediate frames do not go through the solve path");

  engine.cancel();

  assert.ok(Math.hypot(...model.coords("a")) < 1e-6,
    `Escape settled the model: a = ${model.coords("a")}`);
  assert.deepEqual(actions, ["before@0", "after@1"], "one action, closed after the settling solve");
});

test("a press on an edge that never moves is still a pick", async () => {
  const { model, fire, counts } = await shapes();
  const before = { a: model.coords("a"), b: model.coords("b") };

  fire("pointerdown", { clientX: 30, clientY: 0, button: 0, buttons: 1 });
  fire("pointermove", { clientX: 32, clientY: 1, button: -1, buttons: 1 }); // inside the 3px threshold
  fire("pointerup", { clientX: 32, clientY: 1, button: 0, buttons: 0 });

  assert.equal(counts.picks, 1, "the edge's name goes to the command line, as it always did");
  assert.equal(counts.solves, 0, "and nothing was dragged");
  for (const [name, delta] of Object.entries(moved(model, before))) {
    assert.ok(Math.hypot(...delta) < 1e-9, `${name} moved by ${delta} on a click`);
  }
});

test("a press on a constraint glyph drags nothing, boxes nothing, and pans", async () => {
  const { model, engine, fire, counts } = await shapes();
  parallel(model, "l1", "f.x");
  const before = { a: model.coords("a"), b: model.coords("b") };
  const view = { ...engine.view };

  const glyph = engine.glyphs()[0];
  assert.ok(glyph, "the relation wears a mark");
  const [gx, gy] = glyph.screen;
  dragBy(fire, gx, gy, 40, -20);

  // A glyph is UI, not geometry: it has no position of its own to move, and it
  // is not empty canvas either, so a box would be wrong too. What is left is
  // the pan — the last left-drag in the app that still pans.
  for (const [name, delta] of Object.entries(moved(model, before))) {
    assert.ok(Math.hypot(...delta) < 1e-9, `${name} moved by ${delta} — the glyph dragged geometry`);
  }
  assert.equal(engine.box, null, "and drew no box");
  assert.equal(counts.solves, 0, "nothing to settle");
  assert.ok(Math.abs(engine.view.ox - view.ox - 40) < 1e-6, `panned by ${engine.view.ox - view.ox}`);
});

// --- dragging a datum -------------------------------------------------------

test("dragging a frame's x-ref turns it, and the levelled drawing follows", async () => {
  const { model, fire } = await shapes();
  parallel(model, "l1", "f.x"); // level with the fixture frame, which sits on the origin
  model.solve();

  // The fixture frame's x-ref is one unit out, at screen (1, 0) in this view.
  // Ten pixels up is a 84° turn — big, so nothing here can pass by accident.
  dragBy(fire, 1, 0, 0, -10);

  const [o, x] = [model.coords("f_o"), model.coords("f_x")];
  const tilt = Math.atan2(x[1] - o[1], x[0] - o[0]);
  assert.ok(Math.abs(tilt - Math.atan2(10, 1)) < 1e-6,
    `the frame turned to ${(tilt * 180) / Math.PI}°, not to ${(Math.atan2(10, 1) * 180) / Math.PI}°`);

  // The whole of the point: a pull alone cannot move a datum. The frame's
  // points are not variables of the `par` residual that reads them, so the
  // damped solve rejects every step that turns the frame — it raises a
  // residual it cannot see how to lower — and the frame sits still. Measured
  // at three thousandths of a degree before this was fixed.
  const [a, b] = [model.coords("a"), model.coords("b")];
  const d = [b[0] - a[0], b[1] - a[1]];
  const u = [Math.cos(tilt), Math.sin(tilt)];
  const len = Math.hypot(d[0], d[1]);
  assert.ok(Math.abs((d[0] * u[1] - d[1] * u[0]) / len) < 1e-6,
    `the edge is ${(Math.asin((d[0] * u[1] - d[1] * u[0]) / len) * 180) / Math.PI}° off the frame it is level with`);
});

test("a datum that is also ordinary geometry still obeys its constraints", async () => {
  const { model, fire } = await shapes();
  // The frame's x-ref held a unit away from an ordinary point of the drawing.
  // The outright move puts it where the cursor asked; the solve that follows is
  // where the relation gets its say, exactly as it does for any other point —
  // so the gesture degrades to the kinematic drag rather than overriding it.
  dist(model, "f_x", "a", 1);
  model.solve();

  dragBy(fire, 1, 0, 0, -40);

  const [x, a] = [model.coords("f_x"), model.coords("a")];
  const away = Math.hypot(x[0] - a[0], x[1] - a[1]);
  assert.ok(Math.abs(away - 1) < 1e-6, `the dimension should still hold exactly; it reads ${away}`);
  assert.ok(x[1] < 40, `and the point is not simply where the cursor asked: ${x}`);
});

test("armed reports what arm was given while the tool is armed, and nothing once it is not", async () => {
  const { engine } = await setup();
  // Read through a function: TypeScript would otherwise keep the first
  // assertion's narrowing to null across the calls that change the answer.
  const armed = () => engine.armed;
  assert.equal(armed(), null);
  const options = { radius: 4 };
  engine.arm("point", options);
  // The very options object, so a re-arm (an undo keeps the tool) hands the
  // fresh instance exactly what the first one had.
  assert.deepEqual(armed(), { name: "point", options });
  assert.equal(armed()?.options, options);
  engine.cancel();
  assert.equal(armed(), null, "a cancelled tool is not armed, whatever it was armed with");
});
