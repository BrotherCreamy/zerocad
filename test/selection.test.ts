// The canvas's selection (docs/plans/groups.md, phase 1): the model of it, the
// gestures that make it, the menu that acts on it and the commands that type
// it. The browser story — the highlight, the Delete key, a real mouse — is
// test/e2e/groups.e2e.ts.
//
// The rule these hold to: **with the command line empty a click selects; with
// text in it a click inserts the name**, and the selection is UI state, so
// nothing about it ever reaches the journal.

import { test } from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { ensureKernelLoaded } from "../src/kernel/problem.ts";
import { Model } from "../src/model.ts";
import { parallel } from "../src/relations/geometry.ts";
import { ToolEngine, type View } from "../src/tools/engine.ts";
import { Selection } from "../src/tools/selection.ts";
import { menuFor, type Menu } from "../src/menu.ts";
import { Repl } from "../src/repl.ts";
import { neocadScope } from "../src/replenv.ts";
import { save } from "../src/persist.ts";
import type { Pick } from "../src/picking.ts";
import "../src/modules/builtin.ts"; // registers the built-in tools, as the app does
import { axisFrame } from "./frames.ts";

async function loadKernel() {
  const bytes = await readFile(new URL("../src/kernel/wasm-gen/neocad_kernel_bg.wasm", import.meta.url));
  await ensureKernelLoaded(bytes);
}

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
 * Three points far apart in a 2D model, the identity view (y flipped), and an
 * engine whose command line holds `text` — empty unless a test writes into it.
 */
async function setup() {
  await loadKernel();
  const model = new Model(2);
  model.addPoint([100, -100], "a");
  model.addPoint([200, -100], "b");
  model.addPoint([300, -100], "c");
  model.addLine("a", "b", "l1");
  const { canvas, fire } = fakeCanvas();
  const view: View = { ox: 0, oy: 0, scale: 1 };
  const inserted: string[] = [];
  const line = { text: "" };
  const engine = new ToolEngine(model, canvas, view, {
    onSolveRender: () => { model.solve(); },
    onRenderOnly: () => {},
    onPick: (p) => { inserted.push(p.name); },
    composing: () => line.text.trim() !== "",
  });
  const click = (x: number, y: number, shiftKey = false) => {
    fire("pointerdown", { clientX: x, clientY: y, button: 0, buttons: 1, shiftKey });
    fire("pointerup", { clientX: x, clientY: y, button: 0, buttons: 0, shiftKey });
  };
  const box = (x0: number, y0: number, x1: number, y1: number, shiftKey = false) => {
    fire("pointerdown", { clientX: x0, clientY: y0, button: 0, buttons: 1, shiftKey });
    fire("pointermove", { clientX: x1, clientY: y1, button: -1, buttons: 1, shiftKey });
    fire("pointerup", { clientX: x1, clientY: y1, button: 0, buttons: 0, shiftKey });
  };
  return { model, engine, inserted, line, click, box };
}

test("the selection model: only, toggle, add, set, clear — in the order picked, no repeats", () => {
  const s = new Selection();
  s.only("p1");
  s.toggle("p2");
  s.toggle("p3");
  assert.deepEqual(s.names, ["p1", "p2", "p3"]);
  s.toggle("p2");
  assert.deepEqual(s.names, ["p1", "p3"], "a second toggle takes it out");
  s.add(["p3", "l1", "l1"]);
  assert.deepEqual(s.names, ["p1", "p3", "l1"], "add skips what is already there");
  s.set(["l2", "l2", "l3"]);
  assert.deepEqual(s.names, ["l2", "l3"]);
  s.only("p9");
  assert.deepEqual(s.names, ["p9"]);
  assert.equal(s.clear(), true);
  assert.equal(s.clear(), false, "nothing left to clear");
  assert.equal(s.size, 0);
});

test("prune drops names the model no longer answers to", async () => {
  await loadKernel();
  const m = new Model(2);
  m.addPoint([0, 0], "p1");
  const s = new Selection();
  s.set(["p1", "gone"]);
  assert.deepEqual(s.prune(m), ["p1"]);
});

test("with the command line empty a click selects, shift toggles, empty canvas clears — and nothing is inserted", async () => {
  const { engine, inserted, click } = await setup();
  click(100, 100);
  assert.deepEqual(engine.selection.names, ["a"]);
  click(200, 100);
  assert.deepEqual(engine.selection.names, ["b"], "a plain click replaces");
  click(300, 100, true);
  click(150, 100, true); // the line, between a and b
  assert.deepEqual(engine.selection.names, ["b", "c", "l1"], "shift adds");
  click(300, 100, true);
  assert.deepEqual(engine.selection.names, ["b", "l1"], "shift again drops");
  click(500, 400);
  assert.deepEqual(engine.selection.names, [], "a click on empty canvas clears");
  assert.deepEqual(inserted, [], "and no name went to the command line");
});

test("with text in the command line a click inserts the name and leaves the selection alone", async () => {
  const { engine, inserted, line, click, box } = await setup();
  click(100, 100);
  line.text = "dist(";
  click(200, 100);
  box(250, 50, 350, 150);
  assert.deepEqual(inserted, ["b", "c"], "the click and the box both inserted");
  assert.deepEqual(engine.selection.names, ["a"], "the selection is as it was");
});

test("a box selects what it catches, shift adding, and an empty plain box clears", async () => {
  const { engine, box } = await setup();
  box(50, 50, 250, 150); // a window round a, b and the line
  assert.deepEqual(engine.selection.names, ["a", "b", "l1"]);
  box(250, 50, 350, 150, true);
  assert.deepEqual(engine.selection.names, ["a", "b", "l1", "c"], "shift adds");
  box(250, 50, 350, 150);
  assert.deepEqual(engine.selection.names, ["c"], "a plain box replaces");
  box(500, 300, 600, 400);
  assert.deepEqual(engine.selection.names, [], "an empty plain box empties it");
});

test("Escape clears the selection and says so; arming a tool spends it", async () => {
  const { engine, click } = await setup();
  click(100, 100);
  assert.equal(engine.escape(), "cleared");
  assert.deepEqual(engine.selection.names, []);
  assert.equal(engine.escape(), "cancelled", "nothing left to clear");
  click(100, 100);
  engine.arm("point");
  assert.deepEqual(engine.selection.names, [], "a tool armed starts from its own picks");
});

test("select() sets exactly what it is given; selecting changes neither the journal nor the file", async () => {
  const { engine, model, click } = await setup();
  const before = save(model, false);
  click(100, 100);
  engine.select(["c", "l1"]);
  assert.deepEqual(engine.selection.names, ["c", "l1"]);
  assert.equal(save(model, false), before, "UI state: not journalled, not saved, not an undo step");
});

/** A model with a frame, two lines and a relation on one of them — for the menu and the commands. */
async function drawing() {
  await loadKernel();
  const m = new Model(2);
  axisFrame(m);
  const l1 = m.addLine().name;
  const l2 = m.addLine().name;
  const r = parallel(m, l1, "f.x");
  return { m, l1, l2, r };
}

const pickOf = (m: Model, name: string): Pick =>
  ({ name, kind: m.entities.get(name)?.kind ?? "relation", distance: 0 });
const labels = (menu: Menu) => menu.items.map((i) => i.label);
const command = (menu: Menu, label: string) => {
  const a = menu.items.find((i) => i.label === label)?.action;
  return a?.do === "run" ? a.command : null;
};

test("the menu acts on the selection when the right-click lands on part of it, or on empty canvas", async () => {
  const { m, l1, l2, r } = await drawing();
  const sel = [l1, l2, r];
  const on = menuFor(m, pickOf(m, l2), null, null, null, sel);
  assert.match(on.header!, /^3 selected/);
  assert.equal(command(on, "Delete"), `del("${l1}", "${l2}", "${r}")`);

  const empty = menuFor(m, null, null, null, null, sel);
  assert.equal(command(empty, "Delete"), `del("${l1}", "${l2}", "${r}")`, "on empty canvas too");
  assert.ok(labels(empty).includes("Line"), "and the empty canvas's own items follow");

  const off = menuFor(m, pickOf(m, l1), null, null, null, [l2]);
  assert.equal(command(off, "Delete"), `del("${l1}")`, "a right-click on something not selected is about that thing");
  assert.equal(menuFor(m, null).header, null, "nothing selected: the empty-canvas menu as ever");
});

test("the one thing selected, right-clicked, is its own menu", async () => {
  const { m, l1 } = await drawing();
  const menu = menuFor(m, pickOf(m, l1), null, null, null, [l1]);
  assert.deepEqual(labels(menu).slice(0, 2), ["Insert name", "Delete"]);
  assert.ok(labels(menu).includes("Dimension"), "its own items stay");
  assert.equal(command(menu, "Delete"), `del("${l1}")`);
});

test("sel() and select() type the selection — and refuse a name nothing answers to, changing nothing", async () => {
  const { m, l1, l2 } = await drawing();
  let held: string[] = [];
  const repl = new Repl(neocadScope({
    model: m,
    selection: (names) => {
      if (names !== undefined) held = [...names];
      return held;
    },
  }));
  assert.deepEqual((await repl.eval(`select("${l1}", "${l2}")`)).value, [l1, l2]);
  assert.deepEqual((await repl.eval("sel()")).value, [l1, l2]);
  const bad = await repl.eval(`select("${l1}", "nope")`);
  assert.equal(bad.ok, false);
  assert.match(bad.error!.message, /"nope" is not/);
  assert.deepEqual(held, [l1, l2], "refused before it changed anything");
  assert.deepEqual((await repl.eval("select()")).value, [], "select() clears");
  const headless = new Repl(neocadScope({ model: m }));
  assert.match((await headless.eval("sel()")).error!.message, /no viewport/);
});
