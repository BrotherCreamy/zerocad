// The module unit and the entity extension point (docs/plans/workbenches.md):
// the tables are filled from modules in module order; a module that registers
// a name twice, or one another module has, is refused with that name and
// leaves nothing behind; a group extended by two modules keeps both lists in
// module order; the ellipse lives in the sketch module and the five files the
// spec names never mention it; and every fixture replays as it did.

import { test } from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { ensureKernelLoaded } from "../src/kernel/problem.ts";
import { Model } from "../src/model.ts";
import { open, save } from "../src/persist.ts";
import { neocadScope } from "../src/replenv.ts";
import {
  defineModule, getModule, loadedModules, menuToolItems, moduleRelations, removeModule, forgetKinds,
  replayEntries, fileMenuItems, listWorkbenches, workbenchTools, onWorkbench,
} from "../src/modules.ts";
import { TOOL_GROUPS, Tool, getToolCtor, listTools, toolbarButtons } from "../src/tools/tool.ts";
import { TOOL_ICONS, svg } from "../src/tools/icons.ts";
import "../src/modules/builtin.ts";

async function loadKernel() {
  await ensureKernelLoaded(await readFile(new URL("../src/kernel/wasm-gen/neocad_kernel_bg.wasm", import.meta.url)));
}

class Stamp extends Tool {
  readonly name = "stamp";
}

test("the built-in modules load in order, and the tables are filled from them in that order", () => {
  const builtin = loadedModules().filter((m) => m.origin === "builtin").map((m) => m.name);
  assert.deepEqual(builtin, ["core", "sketch", "solids", "step", "files", "organiser", "interface"]);
  // The tray: core's tools, then the sketch module's, then the solids'.
  assert.deepEqual(listTools(), ["point", "line", "rectangle", "polygon", "slot", "circle", "arc", "ellipse", "fillet",
    "dimension", "constrain", "extrude", "revolve", "sketch"]);
  // The menu's tool items and the File items, module by module.
  assert.deepEqual(menuToolItems().map((i) => i.tool), ["point", "line", "rectangle", "circle", "arc", "ellipse", "fillet"]);
  assert.deepEqual(fileMenuItems().map((i) => i.label), ["Export STEP…", "New", "Open…", "Save", "Share…"]);
  // Relations: core's before the sketch module's.
  const ops = moduleRelations().map((r) => r.op);
  assert.ok(ops.indexOf("dist") < ops.indexOf("radius") && ops.indexOf("radius") < ops.indexOf("onEllipse"));
  // Every glyph a module brought, and only those.
  for (const m of loadedModules()) for (const icon of Object.keys(m.spec.icons ?? {})) assert.ok(TOOL_ICONS[icon], icon);
});

test("persist.ts's replay table is the modules' ops: the model's own edits, every relation, operation and entity constructor", async () => {
  await loadKernel();
  const ops = replayEntries(new Model(3)).map(([op]) => op);
  for (const op of ["addPoint", "addLine", "addFrame", "deleteEntity", "addCircle", "addArc", "addEllipse", "dist", "parallel",
    "onEllipse", "majorAxis", "fillet", "hole", "extrude", "revolve", "regen", "set", "construction", "group", "hide"]) {
    assert.ok(ops.includes(op), `${op} replays`);
  }
  assert.equal(new Set(ops).size, ops.length, "no op twice");
  assert.ok(!ops.includes("horizontal"), "typed-only spellings journal what they expand to");
  assert.equal(getModule("sketch")!.ops.includes("addEllipse"), true, "the ellipse's constructor is the sketch module's");
});

test("a module that registers a name twice, or one another module has, is refused with the name — and registers nothing", () => {
  assert.throws(() => defineModule("dup", { tools: { point: Stamp } }), /"point".*module "core" already has/);
  assert.throws(() => defineModule("dup", { relations: { mine: { names: ["par"], slots: [], fn: () => "" } } }),
    /relation "par".*module "core"/);
  assert.throws(() => defineModule("dup", { operations: { fillet: () => null } }), /op "fillet".*module "sketch"/);
  assert.throws(() => defineModule("dup", {
    tools: { t_a: Stamp },
    relations: { one: { names: ["twice"], slots: [], fn: () => "" }, two: { names: ["twice"], slots: [], fn: () => "" } },
  }), /registers relation "twice" twice/);
  assert.equal(getToolCtor("t_a"), undefined, "the refused module's tool was never registered");
  assert.equal(getModule("dup"), undefined);
  assert.throws(() => defineModule("core", {}), /already loaded/);
});

test("a group extended by two modules keeps both lists, in module order; removing a module takes its members away", () => {
  const a = defineModule("ext_a", { tools: { t_ga: Stamp }, groups: { shapes: ["t_ga"] }, icons: { t_ga: svg("t_ga", "") } });
  const b = defineModule("ext_b", { tools: { t_gb: Stamp }, groups: { shapes: ["t_gb"] } });
  assert.deepEqual(TOOL_GROUPS.shapes, ["rectangle", "polygon", "slot", "t_ga", "t_gb"]);
  assert.deepEqual(toolbarButtons().find((x) => x.group === "shapes")!.tools, ["rectangle", "polygon", "slot", "t_ga", "t_gb"]);
  removeModule("ext_a");
  assert.deepEqual(TOOL_GROUPS.shapes, ["rectangle", "polygon", "slot", "t_gb"]);
  assert.equal(getToolCtor("t_ga"), undefined);
  assert.equal(TOOL_ICONS.t_ga, undefined);
  removeModule("ext_b");
  forgetKinds(a);
  forgetKinds(b);
  assert.throws(() => removeModule("sketch"), /built in/);
});

test("the workbenches: part is today's toolbar exactly, sketch is core and sketch", () => {
  assert.deepEqual(listWorkbenches().map((w) => w.name), ["part", "sketch"]);
  assert.deepEqual(workbenchTools("part"), listTools());
  assert.deepEqual(workbenchTools("sketch"), ["point", "line", "rectangle", "polygon", "slot", "circle", "arc", "ellipse",
    "fillet", "dimension", "constrain"]);
  assert.equal(onWorkbench("sketch", "extrude"), false);
});

test("the extension point is real: the five files the spec names never mention the ellipse", async () => {
  for (const f of ["model.ts", "loops.ts", "faces.ts", "picking.ts", "step.ts"]) {
    const text = await readFile(new URL(`../src/${f}`, import.meta.url), "utf8");
    assert.doesNotMatch(text, /ellipse/i, `src/${f} names the ellipse`);
  }
});

test("a file written before the re-cut — every sketch-shapes piece and an extruded ellipse — replays to the same bytes", async () => {
  await loadKernel();
  const text = await readFile(new URL("./fixtures/shapes-v15.neocad.json", import.meta.url), "utf8");
  const m = open(text);
  assert.equal(save(m, true), text);
  // And it is the ellipse it was: drawn by the sketch module's kind.
  const s = neocadScope({ model: m }) as Record<string, (...a: unknown[]) => unknown>;
  assert.match(String(s.ls()), /el1\s+ellipse/);
});
