// What the right-click menu offers, which is the half of src/menu.ts that has
// no DOM in it: which items appear for which pick kind, what command each one
// types, and that the numbers in those commands are the drawing's *current*
// measurements rather than anything invented.
//
// The load-bearing claim the whole feature rests on is that **no item does
// anything except type a command** — so these tests assert on command *strings*
// and then, in a couple of places, actually evaluate one to check it does what
// its label promises. Nothing here builds a menu on screen; the browser story
// is test/e2e/contextmenu.e2e.ts.

import { test } from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { ensureKernelLoaded } from "../src/kernel/problem.ts";
import { Model } from "../src/model.ts";
import { menuFor, dimensionCommand, type Menu, type MenuItem } from "../src/menu.ts";
import { getToolCtor } from "../src/tools/tool.ts";
import { fix } from "../src/relations/basic.ts";
import type { Pick } from "../src/picking.ts";
import { axisFrame } from "./frames.ts";
import "../src/modules/builtin.ts"; // registers the built-in tools, as the app does
import "../src/modules/builtin.ts"; // registers the built-in tools, as the app does
import "../src/modules/builtin.ts"; // registers the built-in tools, as the app does
import "../src/modules/builtin.ts"; // registers the built-in tools, as the app does
import "../src/modules/builtin.ts"; // registers the built-in tools, as the app does
import "../src/modules/builtin.ts"; // registers the built-in tools, as the app does
import "../src/modules/builtin.ts"; // registers the built-in tools, as the app does

async function loadKernel() {
  const bytes = await readFile(new URL("../src/kernel/wasm-gen/neocad_kernel_bg.wasm", import.meta.url));
  await ensureKernelLoaded(bytes);
}

/** A pick of the kind the engine would hand the menu for this entity. */
function pickOf(model: Model, name: string): Pick {
  return { name, kind: model.entities.get(name)!.kind, distance: 0 };
}

const labels = (m: Menu) => m.items.map((i) => i.label);
const item = (m: Menu, label: string): MenuItem => {
  const found = m.items.find((i) => i.label === label);
  assert.ok(found, `no "${label}" item — menu had ${labels(m).join(", ")}`);
  return found;
};
const commandFor = (m: Menu, label: string): string => {
  const a = item(m, label).action;
  assert.equal(a.do, "run", `"${label}" is not a run item`);
  return a.do === "run" ? a.command : "";
};

test("a line's menu names it, and offers insert, delete, a dimension and construction", async () => {
  await loadKernel();
  const model = new Model(2);
  const a = model.addPoint([0, 0]).name;
  const b = model.addPoint([30, 40]).name;
  const l = model.addLine(a, b).name;

  const menu = menuFor(model, pickOf(model, l));
  assert.match(menu.header!, new RegExp(`^${l}\\b`));
  assert.deepEqual(labels(menu), ["Insert name", "Delete", "Dimension", "Construction"]);
  assert.deepEqual(item(menu, "Insert name").action, { do: "insert", name: l });
  assert.equal(commandFor(menu, "Delete"), `del("${l}")`);
  // 3-4-5: the dimension is the length as it stands, between the endpoints by
  // name — not between the line's own name, which `dist` does not take.
  assert.equal(commandFor(menu, "Dimension"), `dist("${a}", "${b}", 50)`);
});

test("the dimension is the current measurement, so it holds what it measures", async () => {
  await loadKernel();
  const model = new Model(2);
  const a = model.addPoint([0, 0]).name;
  const b = model.addPoint([7.5, 0]).name;
  const l = model.addLine(a, b).name;

  const command = commandFor(menuFor(model, pickOf(model, l)), "Dimension");
  assert.equal(command, `dist("${a}", "${b}", 7.5)`);
  // The point of "current": applying it moves nothing, because the drawing
  // already satisfies it.
  const before = [model.coords(a), model.coords(b)];
  model.relation("dist", [a, b, 7.5], () => {});
  assert.deepEqual([model.coords(a), model.coords(b)], before);
});

test("a circle and an arc are dimensioned by radius, a point and a frame not at all", async () => {
  await loadKernel();
  const model = new Model(2);
  const c = model.addCircle(model.addPoint([0, 0]).name, 12.25).name;
  assert.equal(commandFor(menuFor(model, pickOf(model, c)), "Dimension"), `rad("${c}", 12.25)`);

  const arc = model.addArc(model.addPoint([50, 0]).name, null, null, 8).name;
  assert.equal(commandFor(menuFor(model, pickOf(model, arc)), "Dimension"), `rad("${arc}", 8)`);

  // A point has no single natural dimension and a frame's arm length means
  // nothing, so neither gets the item at all rather than getting a bad one.
  const p = model.addPoint([1, 2]).name;
  assert.equal(dimensionCommand(model, pickOf(model, p)), null);
  assert.ok(!labels(menuFor(model, pickOf(model, p))).includes("Dimension"));

  const f = axisFrame(model, "fr", [100, 100]);
  assert.equal(dimensionCommand(model, pickOf(model, f)), null);
  assert.ok(!labels(menuFor(model, pickOf(model, f))).includes("Dimension"));
});

test("Fix is offered on points only — in the origin's coordinates with no frame chosen, and nothing made by asking", async () => {
  await loadKernel();
  const model = new Model(2);
  const p = model.addPoint([3, 4]).name;

  // It used to be disabled with "no default frame": every model has the
  // origin now (docs/plans/frameless-curves.md), and a bare fix means it.
  assert.equal(commandFor(menuFor(model, pickOf(model, p)), "Fix"), `fix("${p}", [3, 4])`);
  assert.equal(model.entities.size, 1, "nothing was created by asking");
  assert.equal(model.defaultFrame, null);

  axisFrame(model);
  assert.equal(commandFor(menuFor(model, pickOf(model, p)), "Fix"), `fix("${p}", [3, 4])`);

  // Not on anything else.
  const l = model.addLine(p, model.addPoint([9, 9]).name).name;
  assert.ok(!labels(menuFor(model, pickOf(model, l))).includes("Fix"));
});

test("Fix pins where the point is in the frame's coordinates, not in the kernel's", async () => {
  await loadKernel();
  const model = new Model(2);
  // A frame turned 90° and moved off the gauge's origin: frame coordinates and
  // raw coordinates now disagree about everything, which is the case that tells
  // the two apart.
  const o = model.addPoint([10, 5], "o").name;
  const x = model.addPoint([10, 6], "x").name; // +x points along world +y
  model.addFrame(o, x, null, "f");
  model.setDefaultFrame("f");
  const p = model.addPoint([13, 9]).name;

  // p - origin = (3, 4); along the frame's +x (world +y) that is 4, and along
  // its +y (world -x) that is -3.
  assert.equal(commandFor(menuFor(model, pickOf(model, p)), "Fix"), `fix("${p}", [4, -3])`);

  // And the claim underneath: running it holds the point exactly where it is.
  fix(model, p, [4, -3]);
  const report = model.solve();
  assert.ok(report.solved, "a fix at the current position should solve");
  assert.deepEqual(model.coords(p).map((v) => Math.round(v * 1e6) / 1e6), [13, 9]);
});

test("Fix in a 3D model is frame coordinates too — three of them, not the kernel's numbers", async () => {
  // This menu used to type raw coordinates in 3D, back when `fix` there was
  // gauge-relative. With that form gone, raw numbers would be read in the
  // default frame and fling the point to wherever they land in it.
  await loadKernel();
  const model = new Model(3);
  // A frame whose +x is world +y and whose plane is world y–z, so its +z is
  // world +x: every frame coordinate is a different raw one.
  const o = model.addPoint([10, 5, 2], "o").name;
  const x = model.addPoint([10, 6, 2], "x").name;
  const y = model.addPoint([10, 5, 7], "y").name;
  model.addFrame(o, x, y, "f");
  const p = model.addPoint([13, 9, 7]).name; // (3, 4, 5) from the origin, in world terms

  // No default frame: the origin's coordinates, which are the kernel's.
  assert.equal(commandFor(menuFor(model, pickOf(model, p)), "Fix"), `fix("${p}", [13, 9, 7])`);

  model.setDefaultFrame("f");
  assert.equal(commandFor(menuFor(model, pickOf(model, p)), "Fix"), `fix("${p}", [4, 5, 3])`);
  fix(model, p, [4, 5, 3]);
  assert.ok(model.solve().solved);
  assert.deepEqual(model.coords(p).map((v) => Math.round(v * 1e6) / 1e6), [13, 9, 7],
    "running what the menu typed holds the point exactly where it is");
});

test("a dimension glyph's menu is its description, Set value… and Delete", async () => {
  await loadKernel();
  const model = new Model(2);
  const a = model.addPoint([0, 0]).name;
  const b = model.addPoint([50, 0]).name;
  const d = model.relation("dist", [a, b, 50], () => {});
  assert.equal(d, "d1", "a dist is a dimension");

  const menu = menuFor(model, { name: d, kind: "relation", distance: 0 });
  assert.equal(menu.header, `${d}  dist ${a} ${b} 50`);
  assert.deepEqual(labels(menu), ["Set value…", "Delete"]);
  assert.equal(commandFor(menu, "Delete"), `del("${d}")`);

  // It *types* rather than runs: the number is the user's to supply, and an
  // item that ran something would have had to invent one.
  const setItem = menu.items.find((i) => i.label === "Set value…")!;
  assert.deepEqual(setItem.action, { do: "type", text: `set("${d}.value", ` });
});

test("a constraint glyph's menu has no Set value… — there is no value to set", async () => {
  await loadKernel();
  const model = new Model(2);
  const a = model.addPoint([0, 0]).name;
  const b = model.addPoint([50, 0]).name;
  const r = model.relation("coincident", [a, b], () => {});
  assert.equal(r, "r1", "a coincidence is a constraint");

  const menu = menuFor(model, { name: r, kind: "relation", distance: 0 });
  assert.deepEqual(labels(menu), ["Delete"]);
});

test("empty canvas arms the tools, and every tool name it types is registered", async () => {
  await loadKernel();
  const model = new Model(2);
  const menu = menuFor(model, null);

  assert.equal(menu.header, null);
  assert.deepEqual(labels(menu), [
    // One circle and one arc (docs/plans/one-circle-one-arc.md): the 3-point
    // items went with their tools. The shapes group whole under its heading:
    // this test registers the built-in modules as the app does, and a module
    // is registered whole (it used to import the rectangle alone).
    // The region tool is the shapes group's last (docs/plans/regions-as-operations.md); the modify
    // group under its heading once the solids module brings its round and chamfer (docs/plans/solid-fillets.md).
    // The sketch's edits join modify after the fillet (docs/plans/sketch-edit.md).
    // The spline joins the ellipse, so the curves group has a heading (docs/plans/spline.md).
    "Point", "Line", "Shapes", "Rectangle", "Polygon", "Slot", "Region", "Circle", "Arc", "Curves", "Ellipse", "Spline", "Modify", "Fillet",
    "Bevel", "Trim", "Extend", "Offset", "Mirror", "Pattern", "Round", "Chamfer", "Frame",
  ]);
  // A typo in the table would be a menu item that throws when chosen, and
  // nothing else would catch it.
  for (const label of labels(menu).slice(0, -1).filter((l) => l !== "Shapes" && l !== "Modify" && l !== "Curves")) {
    const command = commandFor(menu, label);
    const tool = command.match(/^arm\("(.+)"\)$/)?.[1];
    assert.ok(tool, `${label} should arm a tool, got ${command}`);
    assert.ok(getToolCtor(tool!), `${label} arms "${tool}", which is not a registered tool`);
  }
});

test("the Frame item makes a frame and nothing more — never the default", async () => {
  await loadKernel();
  const model = new Model(2);
  // It used to make a drawing's first frame the default, since fix and the
  // axes meant nothing without one. They mean the origin now; a frame made
  // from the menu is a datum asked for, and choosing it is the user's next step.
  assert.equal(commandFor(menuFor(model, null), "Frame"), "frame()");
  axisFrame(model);
  assert.equal(commandFor(menuFor(model, null), "Frame"), "frame()");
});

test("no menu item does anything but type — nothing here journals an op of its own", async () => {
  await loadKernel();
  const model = new Model(2);
  axisFrame(model);
  const p = model.addPoint([1, 2]).name;
  const l = model.addLine(p, model.addPoint([5, 2]).name).name;
  const c = model.addCircle(model.addPoint([0, 20]).name, 4).name;
  const before = model.journal.length;

  // Building every menu the app can show, for every kind, and asking each item
  // what it would do. A menu that touched the model would show up here.
  for (const pick of [null, pickOf(model, p), pickOf(model, l), pickOf(model, c)]) {
    for (const i of menuFor(model, pick).items) assert.ok(i.action.do);
  }
  assert.equal(model.journal.length, before);
  assert.ok(!model.journal.some((e) => /menu/i.test(e.op)), "the menu is not a journalled operation");
});

test("Undo and Redo sit at the bottom of every menu, disabled with the reason when there is nothing that way", async () => {
  await loadKernel();
  const model = new Model(2);
  axisFrame(model);
  const p = model.addPoint([1, 2]).name;
  const q = model.addPoint([5, 2]).name;
  const l = model.addLine(p, q).name;
  const d = model.relation("dist", [p, q, 4], () => {});
  const glyph: Pick = { name: d, kind: "relation", distance: 0 };

  for (const pick of [null, pickOf(model, p), pickOf(model, l), glyph]) {
    const where = pick?.kind ?? "empty canvas";
    const both = menuFor(model, pick, null, { canUndo: true, canRedo: true });
    assert.deepEqual(labels(both).slice(-2), ["Undo", "Redo"], `at the bottom of the ${where} menu`);
    // Typed, like every item: the step is the one `undo()` takes.
    assert.equal(commandFor(both, "Undo"), "undo()");
    assert.equal(commandFor(both, "Redo"), "redo()");

    const neither = menuFor(model, pick, null, { canUndo: false, canRedo: false });
    assert.deepEqual(item(neither, "Undo").action, { do: "disabled", why: "nothing to undo" });
    assert.deepEqual(item(neither, "Redo").action, { do: "disabled", why: "nothing to redo" });

    const back = menuFor(model, pick, null, { canUndo: true, canRedo: false });
    assert.equal(commandFor(back, "Undo"), "undo()");
    assert.equal(item(back, "Redo").action.do, "disabled");

    // With no history handed in, the menu is only about the pick — which is
    // what every other test in this file is asserting on.
    assert.ok(!labels(menuFor(model, pick)).includes("Undo"), where);
  }
});

test("the View row: on empty canvas, given the mode, one item of three choices — each typing its view(), the one in force marked — and on nothing else", async () => {
  await loadKernel();
  const model = new Model(3);
  axisFrame(model);
  const p = model.addPoint([1, 2, 0]).name;
  for (const mode of ["shaded", "hidden", "wire"] as const) {
    const menu = menuFor(model, null, null, { canUndo: false, canRedo: false }, mode);
    const view = item(menu, "View");
    assert.equal(view.action.do, "choose");
    const choices = view.action.do === "choose" ? view.action.choices : [];
    assert.deepEqual(choices.map((c) => [c.label, c.command]), [
      ["Shaded", 'view("shaded")'], ["Hidden", 'view("hidden")'], ["Wire", 'view("wire")'],
    ]);
    assert.deepEqual(choices.filter((c) => c.current).map((c) => c.command), [`view("${mode}")`], `${mode} is the one marked`);
    // Above Undo and Redo, which stay at the bottom of every menu.
    assert.deepEqual(labels(menu).slice(-3), ["View", "Undo", "Redo"]);
  }
  assert.ok(!labels(menuFor(model, pickOf(model, p), null, null, "shaded")).includes("View"), "not on an entity's menu");
  assert.ok(!labels(menuFor(model, null)).includes("View"), "not when the host says nothing of a mode");
});
