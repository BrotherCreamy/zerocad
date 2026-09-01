// The undo stack, and the comparison the host's policy is built on.
//
// Two halves, deliberately kept apart. The first is the stack as pure
// bookkeeping — no model, no browser, a few microseconds — which is what
// undo.ts is generic for. The second is the part that only means anything with
// a real model behind it: that a snapshot of a model is a *value*, so "did this
// action change anything" and "put the model back" are both answered by the
// same serialised text. The keystrokes and the one-step-per-action policy that
// sits on top of this live in main.ts and are covered by test/e2e/undo.e2e.ts,
// which is the only place they exist.

import { test } from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { ensureKernelLoaded } from "../src/kernel/problem.ts";
import { Model } from "../src/model.ts";
import { Repl } from "../src/repl.ts";
import { neocadScope } from "../src/replenv.ts";
import { open as openModel, save } from "../src/persist.ts";
import { UndoStack, DEFAULT_LIMIT } from "../src/undo.ts";

async function loadKernel() {
  const bytes = await readFile(new URL("../src/kernel/wasm-gen/neocad_kernel_bg.wasm", import.meta.url));
  await ensureKernelLoaded(bytes);
}

// --- the stack ------------------------------------------------------------

test("undo walks back through the states that were pushed, redo walks forward", () => {
  const s = new UndoStack<string>();
  s.push("a");
  s.push("b");
  // "c" is where we are now; it was never pushed, because the state you are in
  // is not a state you can go back to.
  assert.equal(s.depth, 2);
  assert.equal(s.undo("c"), "b");
  assert.equal(s.undo("b"), "a");
  assert.equal(s.canUndo, false);
  assert.equal(s.undo("a"), undefined, "nothing to go back to");

  assert.equal(s.redo("a"), "b");
  assert.equal(s.redo("b"), "c", "and forward again to where we started");
  assert.equal(s.canRedo, false);
  assert.equal(s.redo("c"), undefined);
});

test("a redundant undo mutates nothing", () => {
  const s = new UndoStack<string>();
  assert.equal(s.undo("a"), undefined);
  assert.equal(s.redo("a"), undefined);
  // Crucially it did not record "a" as somewhere to come back to: a Ctrl+Z at
  // the beginning of a session must not leave a redo behind.
  assert.equal(s.depth, 0);
  assert.equal(s.redoDepth, 0);
});

test("a fresh action truncates the redo branch", () => {
  const s = new UndoStack<string>();
  s.push("a");
  s.push("b");
  assert.equal(s.undo("c"), "b");
  assert.equal(s.redoDepth, 1, "there is a way forward, for now");

  s.push("b"); // the user drew something instead of redoing
  assert.equal(s.redoDepth, 0, "and now there is not");
  assert.equal(s.redo("x"), undefined);
});

test("the stack forgets its oldest steps rather than refusing new ones", () => {
  const s = new UndoStack<string>(3);
  for (const v of ["a", "b", "c", "d", "e"]) s.push(v);
  assert.equal(s.depth, 3);
  assert.deepEqual([s.undo("f"), s.undo("e"), s.undo("d")], ["e", "d", "c"]);
  assert.equal(s.undo("c"), undefined, "a and b fell off the far end");
  assert.equal(new UndoStack().limit, DEFAULT_LIMIT);
  assert.throws(() => new UndoStack(0), /at least one step/);
});

test("pushIfChanged records only what changed", () => {
  const s = new UndoStack<string>();
  assert.equal(s.pushIfChanged("same", "same"), false);
  assert.equal(s.depth, 0, "an action that changed nothing is not a step");
  assert.equal(s.pushIfChanged("before", "after"), true);
  assert.equal(s.depth, 1);
});

test("clear forgets both directions", () => {
  const s = new UndoStack<string>();
  s.push("a");
  s.undo("b");
  s.clear();
  assert.equal(s.canUndo, false);
  assert.equal(s.canRedo, false);
});

// --- snapshots of a real model --------------------------------------------

/** The host's command surface, with no browser under it. */
function scoped(model: Model) {
  return new Repl(neocadScope({ model, refresh: () => {} }));
}

const snapshot = (m: Model) => save(m, false);

test("a command that changes nothing snapshots identically, and one that does not, does not", async () => {
  await loadKernel();
  const model = new Model(2);
  const repl = scoped(model);
  await repl.eval("pt(0,0); pt(10,0)");

  // This is the whole of the policy: the host cannot know what `ls()` means,
  // and does not have to. It knows the model before and the model after.
  const before = snapshot(model);
  for (const inert of ["ls()", "help()", "coords(\"p1\")", "journal()", "2 + 2"]) {
    await repl.eval(inert);
    assert.equal(snapshot(model), before, `${inert} changed the model`);
  }

  await repl.eval('dist("p1", "p2", 4)');
  assert.notEqual(snapshot(model), before, "a relation is a change");
});

test("a value-only change is a change too — which is why this is not journal truncation", async () => {
  await loadKernel();
  const model = new Model(2);
  model.addPoint([0, 0], "a");
  model.addPoint([10, 0], "b");
  const before = snapshot(model);

  // What a drag does: no journal entry, different coordinates. A design that
  // undid by truncating the journal would see nothing here at all.
  model.withoutRecording(() => model.setCoords("b", [4, 7]));
  const after = snapshot(model);
  assert.deepEqual(
    JSON.parse(before).journal,
    JSON.parse(after).journal,
    "the journal is identical...",
  );
  assert.notEqual(before, after, "...and the snapshot still differs");

  const back = openModel(before);
  assert.deepEqual(back.coords("b"), [10, 0]);
});

test("a walk back through a session lands on exactly the states it passed through", async () => {
  await loadKernel();
  let model = new Model(2);
  const stack = new UndoStack<string>();

  // Three actions, in the shape of the story the e2e tells with a mouse: build
  // a shape, change its structure, then move a point without journalling
  // anything.
  const states = [snapshot(model)];
  const act = async (run: () => unknown | Promise<unknown>) => {
    const before = snapshot(model);
    await run();
    stack.pushIfChanged(before, snapshot(model));
    states.push(snapshot(model));
  };
  const typed = (src: string) => () => scoped(model).eval(src);

  await act(typed("pt(-40,-30); pt(40,-30); pt(40,30); pt(-40,30);"
    + 'ln("p1","p2"); ln("p2","p3"); ln("p3","p4"); ln("p4","p1");'
    + 'hor("l1"); ver("l2"); hor("l3"); ver("l4"); solve()'));
  await act(typed('fillet("l1", "l2", 8)'));
  // A drag, in the only part of it that survives: coordinates moved, nothing
  // journalled.
  await act(() => {
    model.withoutRecording(() => model.setCoords("p3", [50, 40]));
    model.solve();
  });

  assert.equal(stack.depth, 3);
  assert.equal(states.length, 4);

  // Back through every state, then forward through every state. The assertion
  // is on the *text*, which is the strongest available: two models whose saved
  // form is byte-identical have the same entities, the same journal and the
  // same solved coordinates.
  for (let i = states.length - 1; i > 0; i--) {
    const target = stack.undo(snapshot(model));
    assert.equal(target, states[i - 1], `undo ${states.length - i} landed elsewhere`);
    model = openModel(target!);
    assert.equal(snapshot(model), states[i - 1], "and reopening it is the same model again");
  }
  assert.equal(stack.canUndo, false);

  for (let i = 1; i < states.length; i++) {
    const target = stack.redo(snapshot(model));
    assert.equal(target, states[i], `redo ${i} landed elsewhere`);
    model = openModel(target!);
  }
  assert.equal(snapshot(model), states[states.length - 1], "back where the session was");
});

test("undo() and redo() are commands, and say so when there is no host", async () => {
  await loadKernel();
  const model = new Model(2);
  const seen: string[] = [];
  const repl = new Repl(neocadScope({
    model,
    undo: () => { seen.push("undo"); return "undid"; },
    redo: () => { seen.push("redo"); return "redid"; },
  }));
  assert.equal((await repl.eval("undo()")).value, "undid");
  assert.equal((await repl.eval("redo()")).value, "redid");
  assert.deepEqual(seen, ["undo", "redo"]);

  assert.match((await repl.eval("help()")).value as string, /undo\(\)/, "and are in help()");

  // Outside the browser there is no history to move through, and saying so is
  // better than pretending the call worked.
  const hostless = new Repl(neocadScope({ model }));
  assert.match((await hostless.eval("undo()")).error!.message, /no undo history/);
});
