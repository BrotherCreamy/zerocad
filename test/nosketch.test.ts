// There is no sketch (docs/plans/no-sketch.md; the owner: *"There is no such
// thing as a sketch. There are geometry groups … I want geometry to be able
// to belong to multiple groups."*). The model never had one; the **word** was
// everywhere a person read — a "sketch" tool, "Sketch on this face", a
// "Sketch" workbench, `help()` — and said that geometry is inside a
// container. This file pins its going: no string a person reads says it, the
// one exception being the module id `sketch`, which files name and a rename
// of which would be a format change for nothing; and what the old names
// still open — `arm("sketch")` arms the plane tool, `workbench("sketch")` and
// a file saved in it open the drawing workbench.
//
// And the guidance a tool says while running — "{tap} a line" — is the hand's
// word, as the how-lines are (docs/plans/tool-howto.md): the engine fills the
// placeholder for the hand on the canvas, and no tool keeps a line in one
// hand's spelling (picture 503 said "click a thing" on a phone).

import { test } from "node:test";
import assert from "node:assert/strict";
import { readFile, readdir } from "node:fs/promises";
import { join } from "node:path";
import { ensureKernelLoaded } from "../src/kernel/problem.ts";
import { Model } from "../src/model.ts";
import "../src/modules/builtin.ts";
import {
  ENGINE_SUMMARIES, ENGINE_TOOLS, aliasCommand, engineNext, listTools, toolAlias, toolHow, toolSummary, type Hand,
} from "../src/tools/tool.ts";
import { ToolEngine, type View } from "../src/tools/engine.ts";
import {
  WORKBENCH_ALIASES, activeWorkbench, getModule, getWorkbench, listWorkbenches, loadedModules, moduleHelp, setActiveWorkbench, workbenchName,
} from "../src/modules.ts";
import { menuFor } from "../src/menu.ts";
import { planeMenu } from "../src/modechip.ts";
import { activePlane } from "../src/activeplane.ts";
import { open, save, savedHead } from "../src/persist.ts";
import { axisFrame } from "./frames.ts";

const SRC = new URL("../src/", import.meta.url).pathname;

async function loadKernel() {
  const bytes = await readFile(new URL("../src/kernel/wasm-gen/neocad_kernel_bg.wasm", import.meta.url));
  await ensureKernelLoaded(bytes);
}

/** Every `.ts` under src/, less the generated kernels. */
async function sources(dir = SRC): Promise<string[]> {
  const out: string[] = [];
  for (const entry of await readdir(dir, { withFileTypes: true })) {
    if (entry.name === "wasm-gen" || entry.name === "smlib-gen") continue;
    const path = join(dir, entry.name);
    if (entry.isDirectory()) out.push(...await sources(path));
    else if (entry.name.endsWith(".ts")) out.push(path);
  }
  return out;
}

/** The text with its comments taken out — a comment may say the word, as history; a string may not. */
function withoutComments(text: string): string {
  return text.replace(/\/\*[\s\S]*?\*\//g, "").replace(/(^|[^:"'`])\/\/.*$/gm, "$1");
}

/** The string literals of a source: double- and single-quoted, and template literals (their `${…}` left in). */
function literals(text: string): string[] {
  return [...withoutComments(text).matchAll(/"(?:[^"\\\n]|\\.)*"|'(?:[^'\\\n]|\\.)*'|`(?:[^`\\]|\\.)*`/g)].map((m) => m[0]);
}

// --- the word is gone --------------------------------------------------------------

test("no string in src/ says sketch — the module id, quoted, is the one exception; a file's path is not a string a person reads", async () => {
  const found: string[] = [];
  for (const file of await sources()) {
    const text = await readFile(file, "utf8");
    for (const lit of literals(text)) {
      // The module id is `"sketch"`, and only ever that: a help line naming a
      // module list or a workbench's modules says it quoted, and nothing else.
      const rest = lit.replaceAll('"sketch"', "").replaceAll("\\\"sketch\\\"", "");
      if (!/sketch/i.test(rest)) continue;
      if (/\.ts["'`]$/.test(lit) || /\.md\b/.test(lit)) continue; // an import, a plan file named as history
      found.push(`${file.slice(SRC.length)}: ${lit.slice(0, 100)}`);
    }
  }
  assert.deepEqual(found, [], `strings that still say sketch:\n${found.join("\n")}`);
});

test("nothing a person reads at run time says sketch: tool names, summaries and how-lines, module and workbench labels, help(), the menus and the chip", async () => {
  await loadKernel();
  const said: string[] = [];
  // The module id, quoted, is the one word allowed (help's example of a workbench's module list).
  const check = (what: string, text: string | null | undefined) => {
    for (const line of (text ?? "").split("\n")) if (/sketch/i.test(line.replaceAll('"sketch"', ""))) said.push(`${what}: ${line}`);
  };
  const tools = [...ENGINE_TOOLS, ...listTools()];
  for (const name of tools) {
    check(`tool name`, name);
    for (const hand of ["mouse", "finger"] as const) {
      check(`${name}'s summary (${hand})`, toolSummary(name, hand));
      for (const line of toolHow(name, hand) ?? []) check(`${name}'s how (${hand})`, line);
    }
  }
  for (const m of loadedModules()) check(`module ${m.name}'s label`, m.spec.label);
  for (const w of listWorkbenches()) { check("workbench name", w.name); check("workbench label", w.label); }
  check("help()", moduleHelp().join("\n"));
  // The face menu and the frame menu, in a 3D model with a loop and a frame.
  const m = new Model(3);
  const f = axisFrame(m);
  const pts = [[0, 0, 0], [40, 0, 0], [40, 30, 0], [0, 30, 0]].map((c) => m.addPoint(c).name);
  pts.forEach((p, i) => m.addLine(p, pts[(i + 1) % 4]));
  const { findLoops } = await import("../src/loops.ts");
  const loops = findLoops(m);
  const face = menuFor(m, null, { loops, index: 0, toward: [0, 0, 1], at: [5, 5, 0] });
  for (const i of face.items) check("face menu item", i.label);
  assert.ok(face.items.some((i) => i.label === "Draw on this face"), face.items.map((i) => i.label).join(", "));
  const frame = menuFor(m, { name: f, kind: "frame", distance: 0 }, null);
  for (const i of frame.items) check("frame menu item", i.label);
  assert.ok(frame.items.some((i) => i.label === "Draw on this"), frame.items.map((i) => i.label).join(", "));
  // The chip's plane menu, with the default frame chosen.
  m.setDefaultFrame(f);
  const plane = activePlane(m, 4);
  assert.ok(plane, "a plane chosen");
  const chip = planeMenu(m, plane!);
  check("chip menu header", chip.header);
  for (const i of chip.items) { check("chip menu item", i.label); if (i.action.do === "run") check("chip menu command", i.action.command); }
  assert.equal(chip.header, `drawing on ${plane!.label}`);
  assert.deepEqual(said, [], said.join("\n"));
});

// --- what the old names still open ---------------------------------------------------

test("arm(\"sketch\") arms the plane tool, as an alias that says so; the plane tool is registered under plane and no tool under sketch", () => {
  assert.ok(listTools().includes("plane"));
  assert.ok(!listTools().includes("sketch"));
  assert.equal(toolAlias("sketch")?.tool, "plane");
  assert.equal(aliasCommand("sketch"), 'arm("plane", {})');
});

test("workbench(\"sketch\") and a file saved in it open the drawing workbench — never listed, never written back", async () => {
  await loadKernel();
  assert.deepEqual(WORKBENCH_ALIASES, { sketch: "drawing" });
  assert.deepEqual(listWorkbenches().map((w) => w.name), ["part", "drawing", "surfaces"], "the old name is not a workbench");
  assert.equal(getWorkbench("drawing")?.label, "Drawing");
  assert.equal(workbenchName("sketch"), "drawing");
  assert.equal(workbenchName("part"), "part");
  assert.equal(workbenchName("gears"), "gears", "a name that is neither is handed back, for the refusal to name");
  assert.equal(getWorkbench("sketch")?.name, "drawing");
  const was = activeWorkbench();
  try {
    setActiveWorkbench("sketch");
    assert.equal(activeWorkbench(), "drawing");
    assert.throws(() => setActiveWorkbench("gears"), /no workbench "gears"/);
  } finally {
    setActiveWorkbench(was);
  }
  // A file from before, its head naming the old workbench: read as data it
  // says what it said, and the app opens it in the workbench that is now
  // (main.ts reads it through `getWorkbench`); saved again, it says the new name.
  const m = new Model(3);
  m.addPoint([1, 2, 0]);
  const old = save(m, true, [], { workbench: "sketch" });
  assert.equal(JSON.parse(old).workbench, "sketch");
  assert.equal(savedHead(old).workbench, "sketch");
  assert.equal(getWorkbench(savedHead(old).workbench!)?.name, "drawing");
  const again = open(old);
  assert.equal(again.entities.size, 1);
  assert.equal(JSON.parse(save(again, true, [], { workbench: getWorkbench("sketch")!.name })).workbench, "drawing");
  // The module id is unchanged, so a file or a workbench naming the module still finds it.
  assert.equal(getModule("sketch")?.spec.label, "Drawing: curves, shapes, the curve relations and the fillet");
});

// --- a tool's running guidance is the hand's word -----------------------------------

test("every tool's summary says tap to a finger and click to a mouse, as its how-lines do — Select's and the Hand's too", () => {
  for (const name of [...ENGINE_TOOLS, ...listTools()]) {
    const mouse = toolSummary(name, "mouse"), finger = toolSummary(name, "finger");
    assert.ok(mouse && finger, `${name} has a summary`);
    assert.doesNotMatch(finger!, /\bclick/i, `${name}'s summary to a finger: ${finger}`);
    assert.doesNotMatch(mouse!, /\btap\b/i, `${name}'s summary to a mouse: ${mouse}`);
    assert.doesNotMatch(mouse! + finger!, /[{}]/, `${name}'s summary has no placeholder left: ${mouse}`);
  }
  assert.equal(toolSummary("select"), ENGINE_SUMMARIES.select.replace("{tap}", "click"), "typed, tools() reads as a mouse");
  assert.equal(engineNext("select", "finger"), "tap a thing, or hold and drag to box");
  assert.equal(engineNext("select", "mouse"), "click a thing, or drag to box");
});

test("no tool keeps a guidance line in one hand's spelling: a literal in src/tools that says click is a per-hand form, on a line that names the finger's", async () => {
  const found: string[] = [];
  for (const file of await sources(join(SRC, "tools"))) {
    const text = withoutComments(await readFile(file, "utf8"));
    for (const [n, line] of text.split("\n").entries()) {
      const lits = literals(line).filter((l) => /\bclick/i.test(l));
      if (!lits.length) continue;
      // The per-hand forms name both hands on the line: `{ mouse: "Click…",
      // finger: "Tap…" }`, `hand === "finger" ? "tap…" : "click…"`, `press`.
      if (/finger/.test(line)) continue;
      found.push(`${file.slice(SRC.length)}:${n + 1}: ${lits.join(" ")}`);
    }
  }
  assert.deepEqual(found, [], `one-hand guidance:\n${found.join("\n")}`);
});

test("the engine fills {tap} in every line a tool logs, for the hand on the canvas — once in the engine, not in each tool", async () => {
  await loadKernel();
  const model = new Model(3);
  axisFrame(model);
  const lines: [string, string | undefined][] = [];
  const canvas = {
    addEventListener() {}, getContext: () => ({}), setPointerCapture() {}, releasePointerCapture() {},
    getBoundingClientRect: () => ({ left: 0, top: 0, x: 0, y: 0, width: 800, height: 600 }),
  } as unknown as HTMLCanvasElement;
  const view: View = { ox: 400, oy: 300, scale: 4 };
  const engine = new ToolEngine(model, canvas, view, {
    onSolveRender: () => { model.solve(); }, onRenderOnly: () => {},
    onLog: (line, outcome) => { lines.push([line, outcome]); },
  });
  engine.arm("plane");
  const log = engine.active!.ctx.log!;
  for (const hand of ["mouse", "finger"] as Hand[]) {
    engine.pointing = hand;
    log("{Tap} a lit face — then {tap} inside it", "guide");
    log("extrude(\"c1\", -1, { mode: \"cut\" })", "done"); // braces that are not the placeholder are left alone
  }
  assert.deepEqual(lines, [
    ["Click a lit face — then click inside it", "guide"], ["extrude(\"c1\", -1, { mode: \"cut\" })", "done"],
    ["Tap a lit face — then tap inside it", "guide"], ["extrude(\"c1\", -1, { mode: \"cut\" })", "done"],
  ]);
  // And the plane tool's own miss, through the engine, is the finger's word.
  engine.pointing = "finger";
  engine.active!.onDown({ world: [500, 500, 0], screen: [2400, -1700] });
  assert.equal(lines.at(-1)![0], "plane: tap inside a lit face, or a lit plane — or choose Top, Front or Right in the options");
});
