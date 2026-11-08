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
  assert.deepEqual(builtin, ["core", "sketch", "solids", "surfaces", "dimensions", "files", "step", "organiser", "interface"]);
  // The tray: core's tools, then the sketch module's, then the solids', then the surfaces' (docs/plans/surfaces.md).
  // The spline after the ellipse, on the curves button (docs/plans/spline.md).
  assert.deepEqual(listTools(), ["point", "line", "rectangle", "polygon", "slot", "region", "circle", "arc", "ellipse", "spline", "fillet",
    "bevel", "trim", "extend", "offset", "mirror", "pattern", "dimension", "constrain", "extrude", "revolve", "sketch", "round", "chamfer",
    "surface"]);
  // The menu's tool items and the File items, module by module.
  assert.deepEqual(menuToolItems().map((i) => i.tool), ["point", "line", "rectangle", "circle", "arc", "ellipse", "spline", "fillet"]);
  assert.deepEqual(fileMenuItems().map((i) => i.label), ["New", "Open…", "Save", "Share…", "Export STEP…"]);
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
    "onEllipse", "majorAxis", "fillet", "hole", "extrude", "revolve", "regen", "set", "construction", "group", "hide",
    "region", "subtract", "add", "intersect", "deleteRegionSteps", "deleteRegion",
    "filletEdges", "chamferEdges", "setEdges",
    "surfaceExtrude", "surfaceRevolve", "surfacePlanar", "surfaceFace", "trimSurface", "extendSurface", "knit", "offsetSurface",
    "thicken", "solidify", "filletSurfaces", "chamferSurfaces"]) {
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
  assert.deepEqual(TOOL_GROUPS.shapes, ["rectangle", "polygon", "slot", "region", "t_ga", "t_gb"]);
  assert.deepEqual(toolbarButtons().find((x) => x.group === "shapes")!.tools, ["rectangle", "polygon", "slot", "region", "t_ga", "t_gb"]);
  removeModule("ext_a");
  assert.deepEqual(TOOL_GROUPS.shapes, ["rectangle", "polygon", "slot", "region", "t_gb"]);
  assert.equal(getToolCtor("t_ga"), undefined);
  assert.equal(TOOL_ICONS.t_ga, undefined);
  removeModule("ext_b");
  forgetKinds(a);
  forgetKinds(b);
  assert.throws(() => removeModule("sketch"), /built in/);
});

test("the workbenches: part is today's toolbar exactly, sketch is core and sketch", () => {
  // surfaces (docs/plans/surfaces.md) is the part's modules: surfacing is done beside solids.
  assert.deepEqual(listWorkbenches().map((w) => w.name), ["part", "sketch", "surfaces"]);
  assert.deepEqual(workbenchTools("part"), listTools());
  assert.deepEqual(workbenchTools("surfaces"), listTools());
  assert.deepEqual(workbenchTools("sketch"), ["point", "line", "rectangle", "polygon", "slot", "region", "circle", "arc", "ellipse",
    "spline", "fillet", "bevel", "trim", "extend", "offset", "mirror", "pattern", "dimension", "constrain"]);
  assert.equal(onWorkbench("sketch", "extrude"), false);
});

test("the extension point is real: the five files the spec names never mention the ellipse", async () => {
  for (const f of ["model.ts", "loops.ts", "faces.ts", "picking.ts", "step.ts"]) {
    const text = await readFile(new URL(`../src/${f}`, import.meta.url), "utf8");
    assert.doesNotMatch(text, /ellipse/i, `src/${f} names the ellipse`);
  }
});

test("and the spline went through it too: the same five files never mention it (docs/plans/spline.md)", async () => {
  for (const f of ["model.ts", "loops.ts", "faces.ts", "picking.ts", "step.ts"]) {
    const text = await readFile(new URL(`../src/${f}`, import.meta.url), "utf8");
    // Its kind, its file, its structure: what code would name (a comment may say "a spline" as an example).
    assert.doesNotMatch(text, /["']spline["']|kinds\/spline|\bsplineOf\b|\bSplineEntity\b|\bsplineCurve\b/, `src/${f} names the spline`);
  }
});

test("a file written before the re-cut — every sketch-shapes piece and an extruded ellipse — replays to the same bytes", async () => {
  await loadKernel();
  const text = await readFile(new URL("./fixtures/shapes-v15.neocad.json", import.meta.url), "utf8");
  const m = open(text);
  // Saved again it is the same file but for its version — 16 added the head's
  // workbench and modules, and a file that uses neither changes nothing else
  // — and its extrude standing on a region (17, docs/plans/regions-as-
  // operations.md): the face is a region first, the feature on it after.
  // 18 brought the spline (docs/plans/spline.md), which a file with none of
  // its own writes nothing for.
  const want = JSON.parse(text);
  want.version = 18;
  const at = want.journal.findIndex((e: { op: string }) => e.op === "extrude");
  const [member, , frame, loops] = want.journal[at].args;
  want.journal.splice(at, 1, { op: "region", args: [member, frame, loops[0]] },
    { op: "extrude", args: ["rg1", ...want.journal[at].args.slice(1)] });
  assert.deepEqual(JSON.parse(save(m, true)), want);
  // And it is the ellipse it was: drawn by the sketch module's kind.
  const s = neocadScope({ model: m }) as Record<string, (...a: unknown[]) => unknown>;
  assert.match(String(s.ls()), /el1\s+ellipse/);
});

test("a declared kind's own variables count in the diagnosis: an ellipse whose minor nothing holds is free", async () => {
  await loadKernel();
  for (const [dim, free] of [[2, 1], [3, 2]] as const) {
    const model = new Model(dim);
    const s = neocadScope({ model }) as Record<string, (...a: unknown[]) => unknown>;
    const c = s.pt(0, 0) as string;
    const e = s.ellipse(c, 30, 12) as string;
    const major = (model.entities.get(e) as unknown as { major: string }).major;
    s.fix(c, [0, 0]);
    s.fix(major, [30, 0]);
    model.solve();
    // 2D: the minor. 3D: the minor, and the turn about the major axis.
    assert.equal(model.diagnose().dof, free, `${dim}D`);
    assert.ok(model.diagnose().free.has(e));
    s.minor(e, 12);
    if (dim === 3) s.par(e, "origin.z");
    model.solve();
    assert.equal(model.diagnose().dof, 0, `${dim}D, held`);
  }
});

/** The entry a person types: one tool, one relation and one entity kind, in one module. */
const PINS = `defineModule("pins", {
  tools: { pin: class extends Tool { name = "pin"; onUp(p) { addPin(pt(...p.world)); this.ctx.finish(); } } },
  relations: {
    level: { names: ["level"], slots: ["a", "b"], fn: (model, a, b) => model.relation("level", [a, b], () => {
      const A = model.point(a), B = model.point(b);
      model.addResidual([A.varIndices[1], B.varIndices[1]], (l) => [l[0].sub(l[1])]);
    }) },
  },
  entities: [{
    kind: "pin", noun: "a pin", refs: (e) => [e.at],
    add: { op: "addPin", fn: (model, at, name) => {
      const [nm] = model.claimFirst("pin", name, () => null);
      const e = { kind: "pin", name: nm, at };
      model.place(e);
      model.record("addPin", [at, nm]);
      return e;
    } },
    // A cross, 4 units each way, drawn and picked as one polyline.
    samples: (model, name) => {
      const [x, y, z] = model.coords(model.entities.get(name).at);
      return [[x - 4, y, z], [x + 4, y, z], [x, y, z], [x, y - 4, z], [x, y + 4, z]];
    },
  }],
})`;

test("a module defined at the command line — a tool, a relation, an entity kind — is drawn, picked, saved and opened; without it the file says what is missing and the rest is intact", async () => {
  await loadKernel();
  const { Repl } = await import("../src/repl.ts");
  const { ToolSourceStore } = await import("../src/toolsource.ts");
  const { hitTest } = await import("../src/picking.ts");
  const { sampledWorld } = await import("../src/projection.ts");
  const { lastOpen, savedHead } = await import("../src/persist.ts");
  const model = new Model(3);
  const sources = new ToolSourceStore();
  let repl: InstanceType<typeof Repl>;
  repl = new Repl(neocadScope({ model, toolSources: sources, currentEntry: () => repl.entry, rescope: (b) => repl.define(b) }));
  const defined = await repl.eval(PINS);
  assert.ok(defined.ok, String(defined.error?.message));
  assert.match(String(defined.value), /tools pin; relations level; entities pin/);
  assert.ok(getToolCtor("pin"), "its tool is registered");
  // Drawn: the polyline its kind samples. Built by its constructor, held by its relation.
  const run = async (line: string) => { const r = await repl.eval(line); assert.ok(r.ok, `${line}: ${r.error?.message}`); return r.value; };
  const a = await run("pt(0, 0, 0)") as string;
  const b = await run("pt(30, 7, 0)") as string;
  const pin = await run(`addPin("${b}")`) as string;
  assert.equal(pin, "pin1");
  await run(`fix("${a}", [0, 0, 0])`);
  await run(`level("${a}", "${b}")`);
  model.solve();
  assert.ok(Math.abs(model.coords(b)[1]) < 1e-6, "the relation held");
  const world = sampledWorld(model, model.entities.get(pin)!);
  assert.equal(world?.length, 5);
  // Picked: a pixel on one of its arms, away from its point.
  const view = { ox: 400, oy: 300, scale: 4 };
  const [sx, sy] = [400 + (30 + 3) * 4, 300];
  assert.equal(hitTest(model, view, sx, sy)?.name, pin);
  // Saved: the head records the module, the file carries its source as text.
  const text = await run("save()") as string;
  const saved = JSON.parse(text);
  assert.deepEqual(saved.modules.map((m: { name: string; ops: string[] }) => [m.name, m.ops.sort()]), [["pins", ["addPin", "level"]]]);
  assert.ok(saved.tools.some((t: { name: string; source: string }) => t.name === "pins" && t.source.includes("defineModule")));
  // Opened with it: the same drawing.
  const again = open(text);
  assert.equal(again.entities.get(pin)?.kind, "pin");
  assert.equal(save(again, true, saved.tools), text.replace(/,\n  "workbench": "[^"]*"/, ""));
  // Opened on a device without it: what is missing is said, and everything else is there.
  const pins = removeModule("pins");
  forgetKinds(pins);
  assert.deepEqual(savedHead(text).missing.map((m) => m.name), ["pins"]);
  const without = open(text);
  assert.deepEqual(lastOpen().missing.map((m) => m.name), ["pins"]);
  assert.equal(lastOpen().skipped, 2, "addPin and level, nothing else");
  assert.ok(without.entities.has(a) && without.entities.has(b), "the points are there");
  assert.equal(without.entities.has(pin), false);
  assert.equal(without.relations.size, 1, "the fix is there; the level is not");
  assert.deepEqual(without.coords(b), model.coords(b), "and where it was saved");
});

test("a workbench file: its manifest is read without running it, loading it registers exactly that, and a file whose manifest and source disagree is refused with what was not shown", async () => {
  await loadKernel();
  const { Repl } = await import("../src/repl.ts");
  const { loadingFile, readManifest, textHash, getWorkbench } = await import("../src/modules.ts");
  const pins = await readFile(new URL("./fixtures/workbenches/pins.zerocad.js", import.meta.url), "utf8");
  const liar = await readFile(new URL("./fixtures/workbenches/liar.zerocad.js", import.meta.url), "utf8");
  assert.deepEqual(readManifest(pins), {
    name: "pins", label: "Pins", workbench: "pins", tools: ["pin"], relations: ["level"], operations: [], entities: ["pin"],
  });
  assert.throws(() => readManifest("defineModule('x', {})"), /no \/\* zerocad-workbench/);
  assert.equal(getModule("pins"), undefined, "reading ran nothing");

  const model = new Model(3);
  let repl: InstanceType<typeof Repl>;
  repl = new Repl(neocadScope({ model, currentEntry: () => repl.entry, rescope: (b) => repl.define(b) }));
  const load = async (source: string, fileName: string) => loadingFile(
    { fileName, hash: textHash(source), manifest: readManifest(source) },
    async () => { const r = await repl.eval(source); if (!r.ok) throw r.error; },
  );
  await load(pins, "pins.zerocad.js");
  const m = getModule("pins")!;
  assert.deepEqual(m.origin, { file: "pins.zerocad.js", hash: textHash(pins) });
  assert.deepEqual([m.tools, m.entities, m.ops.sort()], [["pin"], ["pin"], ["addPin", "level"]]);
  assert.deepEqual(getWorkbench("pins")?.modules, ["core", "sketch", "pins"]);
  assert.deepEqual(workbenchTools("pins").slice(-1), ["pin"], "its tool is on its own tray");
  assert.equal(onWorkbench("part", "pin"), false, "and not on part's");

  await assert.rejects(load(liar, "liar.zerocad.js"), /refused — the file registers relations its manifest does not show: sneak/);
  assert.equal(getModule("liar"), undefined, "nothing of it was registered");
  assert.equal(getToolCtor("dot"), undefined);

  forgetKinds(removeModule("pins"));
  assert.equal(getWorkbench("pins"), undefined, "its workbench went with it");
});
