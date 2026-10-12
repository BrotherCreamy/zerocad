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
import "../src/tools/point.ts";
import "../src/tools/line.ts";
import "../src/tools/rectangle.ts";
import "../src/tools/circle.ts";
import "../src/tools/circle3.ts";
import "../src/tools/arc.ts";
import "../src/tools/arc3.ts";
import "../src/tools/fillet.ts";

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

test("a line's menu names it, and offers insert, delete and a dimension", async () => {
  await loadKernel();
  const model = new Model(2);
  const a = model.addPoint([0, 0]).name;
  const b = model.addPoint([30, 40]).name;
  const l = model.addLine(a, b).name;

  const menu = menuFor(model, pickOf(model, l));
  assert.match(menu.header!, new RegExp(`^${l}\\b`));
  assert.deepEqual(labels(menu), ["Insert name", "Delete", "Dimension"]);
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

test("Fix is offered on points only, and is disabled with the standing message when no frame exists", async () => {
  await loadKernel();
  const model = new Model(2);
  const p = model.addPoint([3, 4]).name;

  const noFrame = item(menuFor(model, pickOf(model, p)), "Fix").action;
  assert.equal(noFrame.do, "disabled");
  // The model's own wording, not a copy of it — one message for the menu and
  // the command line both.
  assert.match(noFrame.do === "disabled" ? noFrame.why : "", /no default frame/);
  assert.match(noFrame.do === "disabled" ? noFrame.why : "", /frame\(\).*setDefaultFrame\(\)/);

  // Nothing was created by asking: the whole point of the disabled item.
  assert.equal(model.entities.size, 1);
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

  // No default frame: shown, disabled, carrying the model's own message.
  const item = menuFor(model, pickOf(model, p)).items.find((i) => i.label === "Fix")!;
  assert.equal(item.action.do, "disabled");

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
    "Point", "Line", "Rectangle", "Circle", "3 point circle", "Arc", "3 point arc", "Fillet", "Frame",
  ]);
  // A typo in the table would be a menu item that throws when chosen, and
  // nothing else would catch it.
  for (const label of labels(menu).slice(0, -1)) {
    const command = commandFor(menu, label);
    const tool = command.match(/^arm\("(.+)"\)$/)?.[1];
    assert.ok(tool, `${label} should arm a tool, got ${command}`);
    assert.ok(getToolCtor(tool!), `${label} arms "${tool}", which is not a registered tool`);
  }
});

test("the Frame item makes the first frame the default and later ones not", async () => {
  await loadKernel();
  const model = new Model(2);
  // No frame at all: the one click has to leave a *usable* frame behind, or
  // hor/ver/fix go on refusing and the item has done nothing visible.
  assert.equal(commandFor(menuFor(model, null), "Frame"), "setDefaultFrame(frame())");

  axisFrame(model);
  // A second frame is a deliberate extra datum; repointing the default would
  // silently move every bare `hor` in the drawing.
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
