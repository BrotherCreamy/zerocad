// A tool's declared options (src/tools/options.ts): the declaration checked
// when the tool is defined, `arm` checked against it and filled from it, the
// last values remembered per viewer — through a storage shim, and through one
// that throws on every touch — and the command surface listing them. The panel
// built from them is in test/panels.test.ts (its arithmetic) and
// test/e2e/tooloptions.e2e.ts (the browser).

import { test } from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { ensureKernelLoaded } from "../src/kernel/problem.ts";
import { Model } from "../src/model.ts";
import { Repl } from "../src/repl.ts";
import { neocadScope } from "../src/replenv.ts";
import { Tool, defineTool, getToolCtor } from "../src/tools/tool.ts";
import { ToolEngine, type View } from "../src/tools/engine.ts";
import {
  OPTIONS_KEY, OptionMemory, declaredOptions, describeValues, explicitOptions, parseRemembered, resolveOptions,
  unitSymbol, type OptionSpecs, type OptionStorage,
} from "../src/tools/options.ts";
import "../src/modules/builtin.ts"; // registers the built-in tools, as the app does
import "../src/modules/builtin.ts"; // registers the built-in tools, as the app does
import "../src/modules/builtin.ts"; // registers the built-in tools, as the app does
import "../src/modules/builtin.ts"; // registers the built-in tools, as the app does

async function loadKernel() {
  await ensureKernelLoaded(await readFile(new URL("../src/kernel/wasm-gen/neocad_kernel_bg.wasm", import.meta.url)));
}

/** A `localStorage` stand-in that keeps what it is given. */
function memoryStorage(): OptionStorage & { data: Map<string, string> } {
  const data = new Map<string, string>();
  return {
    data,
    getItem: (k) => data.get(k) ?? null,
    setItem: (k, v) => { data.set(k, v); },
    removeItem: (k) => { data.delete(k); },
  };
}

/** What a private window hands the app: every touch throws. */
const throwing: OptionStorage = {
  getItem() { throw new Error("SecurityError"); },
  setItem() { throw new Error("QuotaExceededError"); },
  removeItem() { throw new Error("SecurityError"); },
};

const EXTRUDE = () => declaredOptions(getToolCtor("extrude"));

// --- the declaration ------------------------------------------------------------

test("the three built-ins that take a number declare it, with the default they always used", () => {
  const ex = EXTRUDE();
  assert.deepEqual(Object.keys(ex), ["depth", "end", "mode"], "and what the solid does to a body (docs/plans/solids-kernel.md), and how it ends (solid-tools-intuitive.md)");
  assert.equal(ex.mode.default, "auto");
  assert.equal(ex.mode.remember, false, "a cut chosen once is not the next feature's");
  assert.equal(ex.depth.default, 10);
  assert.equal(ex.depth.unit, "length");
  const rv = declaredOptions(getToolCtor("revolve"));
  assert.deepEqual(Object.keys(rv), ["angle", "mode"]);
  assert.equal(rv.angle.default, 2 * Math.PI, "a whole turn, in radians");
  assert.equal(rv.angle.unit, "angle");
  const fl = declaredOptions(getToolCtor("fillet"));
  assert.deepEqual(Object.keys(fl), ["radius"]);
  assert.equal(fl.radius.default, 10);
  assert.deepEqual(declaredOptions(getToolCtor("point")), {}, "a tool that declares nothing has none");
});

test("a malformed declaration is refused at defineTool, by name, and nothing is registered", () => {
  // As a tool typed at the command line declares it: plain JavaScript, no types to catch it.
  const bad = (options: unknown) => class extends Tool { readonly name = "bad"; static options = options as OptionSpecs; };
  assert.throws(() => defineTool("t_bad1", bad({ size: { unit: "length" } })), /t_bad1's option size needs a default that is a number, true\/false or a choice/);
  // A word is a choice now (docs/plans/one-circle-one-arc.md) — and a choice
  // with no list of what it may be is refused, by name, as a bad default was.
  assert.throws(() => defineTool("t_bad2", bad({ size: { default: "5" } })), /is a choice, and needs its choices/);
  assert.throws(() => defineTool("t_bad3", bad({ size: { default: NaN } })), /needs a default/);
  assert.throws(() => defineTool("t_bad4", bad([1, 2])), /static options must be an object/);
  assert.throws(() => defineTool("t_bad5", bad({ size: { default: 1, unit: 3 } })), /unit is text/);
  for (const n of ["t_bad1", "t_bad2", "t_bad3", "t_bad4", "t_bad5"]) assert.equal(getToolCtor(n), undefined, n);
  defineTool("t_good", bad({ size: { default: 5, unit: "length" }, flip: { default: false } }));
  assert.ok(getToolCtor("t_good"), "a well-formed one, a flag among it, registers");
});

// --- arm, checked and filled ----------------------------------------------------

test("arm fills every declared option: typed, else remembered, else the default", () => {
  const specs = EXTRUDE();
  assert.deepEqual(resolveOptions("extrude", specs, undefined), { depth: 10, end: "blind", mode: "auto" });
  assert.deepEqual(resolveOptions("extrude", specs, {}), { depth: 10, end: "blind", mode: "auto" });
  assert.deepEqual(resolveOptions("extrude", specs, { depth: 25 }), { depth: 25, end: "blind", mode: "auto" });
  assert.deepEqual(resolveOptions("extrude", specs, {}, { depth: 25 }), { depth: 25, end: "blind", mode: "auto" }, "remembered");
  assert.deepEqual(resolveOptions("extrude", specs, { depth: -4 }, { depth: 25 }), { depth: -4, end: "blind", mode: "auto" }, "typed beats remembered");
  // A remembered value that would not pass now is passed over, not refused: nobody typed it.
  assert.deepEqual(resolveOptions("extrude", specs, {}, { depth: 0 }), { depth: 10, end: "blind", mode: "auto" });
  assert.deepEqual(resolveOptions("extrude", specs, {}, { depth: "deep" }), { depth: 10, end: "blind", mode: "auto" });
  const two: OptionSpecs = { size: { default: 5 }, flip: { default: false } };
  assert.deepEqual(resolveOptions("t", two, { flip: true }), { size: 5, flip: true }, "a flag fills like a number");
});

test("arm refuses, in one line naming the options the tool has: an unknown option, a wrong type, a value it cannot take", () => {
  const specs = EXTRUDE();
  const refusal = (given: unknown) => {
    try { resolveOptions("extrude", specs, given); } catch (e) { return (e as Error).message; }
    return null;
  };
  assert.equal(refusal({ dpth: 25 }), 'extrude has no option "dpth" — its options are { depth: 10, end: "blind", mode: "auto" }');
  assert.equal(refusal({ depth: "25" }), 'extrude\'s depth is a number, not "25" — its options are { depth: 10, end: "blind", mode: "auto" }');
  assert.equal(refusal({ depth: Infinity }), "extrude's depth is a number, not Infinity — its options are { depth: 10, end: \"blind\", mode: \"auto\" }");
  assert.equal(refusal({ depth: 0 }), "extrude's depth cannot be 0 — its options are { depth: 10, end: \"blind\", mode: \"auto\" }");
  assert.match(refusal(25)!, /^extrude's options are named: arm\("extrude", \{ depth: 10, end: "blind", mode: "auto" \}\)/);
  assert.equal(refusal({ mode: "drill" }), 'extrude\'s mode is one of "auto", "new", "add", "cut", "intersect", not "drill" — its options are { depth: 10, end: "blind", mode: "auto" }');
  for (const r of [refusal({ dpth: 1 }), refusal({ depth: "x" }), refusal(25)]) assert.doesNotMatch(r!, /\n/, "one line");
  const flag: OptionSpecs = { flip: { default: false } };
  assert.throws(() => resolveOptions("t", flag, { flip: 1 }), /t's flip is true or false, not 1 — its options are \{ flip: false \}/);
  assert.throws(() => resolveOptions("revolve", declaredOptions(getToolCtor("revolve")), { angle: 7 }), /revolve's angle must be/);
  assert.throws(() => resolveOptions("fillet", declaredOptions(getToolCtor("fillet")), { radius: -1 }), /fillet's radius must be more than 0/);
});

test("a tool that declares nothing is armed as it always was: what it is given, untouched", () => {
  const given = { radius: 4, anything: "at all" };
  assert.equal(resolveOptions("point", {}, given), given, "the very object");
  assert.deepEqual(resolveOptions("point", {}, undefined), {});
});

test("only the declared options a call names are what it remembers", () => {
  const specs = EXTRUDE();
  assert.deepEqual(explicitOptions(specs, { depth: 25 }), { depth: 25 });
  assert.deepEqual(explicitOptions(specs, {}), {});
  assert.deepEqual(explicitOptions(specs, undefined), {});
  assert.deepEqual(explicitOptions({}, { depth: 25 }), {}, "nothing declared, nothing remembered");
});

test("the panel's unit text: nothing for a length, rad for an angle, anything else as declared", () => {
  assert.equal(unitSymbol("length"), "");
  assert.equal(unitSymbol(undefined), "");
  assert.equal(unitSymbol("angle"), "rad");
  assert.equal(unitSymbol("teeth"), "teeth");
  assert.equal(describeValues(declaredOptions(getToolCtor("revolve")), { angle: 2 * Math.PI, mode: "auto" }), '{ angle: 6.283185, mode: "auto" }');
});

// --- remembered values ------------------------------------------------------------

test("remembered values round-trip through storage, under their own key, and a fresh page reads them back", () => {
  const storage = memoryStorage();
  const first = new OptionMemory(storage);
  assert.deepEqual(first.recall("extrude"), {});
  assert.equal(first.remember("extrude", { depth: 25 }), true);
  first.remember("revolve", { angle: Math.PI });
  assert.deepEqual([...storage.data.keys()], [OPTIONS_KEY], "one key of its own, not the layout's");
  assert.notEqual(OPTIONS_KEY, "neocad.panels.v2");
  const reloaded = new OptionMemory(storage);
  assert.deepEqual(reloaded.recall("extrude"), { depth: 25 });
  assert.deepEqual(reloaded.recall("revolve"), { angle: Math.PI });
  reloaded.remember("extrude", { depth: 40 });
  assert.deepEqual(new OptionMemory(storage).recall("extrude"), { depth: 40 }, "the latest wins");
  assert.equal(first.remember("extrude", {}), false, "nothing named, nothing written");
});

test("a storage that throws on every touch never throws out, and still remembers for the session", () => {
  const memory = new OptionMemory(throwing);
  assert.deepEqual(memory.recall("extrude"), {});
  assert.equal(memory.remember("extrude", { depth: 25 }), false, "storage did not take it…");
  assert.deepEqual(memory.recall("extrude"), { depth: 25 }, "…and the page remembers it anyway");
  const none = new OptionMemory(null);
  none.remember("extrude", { depth: 7 });
  assert.deepEqual(none.recall("extrude"), { depth: 7 }, "no storage at all, the same");
});

test("stored values are read leniently: not JSON is nothing, a bad value costs only itself", () => {
  assert.deepEqual(parseRemembered(null), {});
  assert.deepEqual(parseRemembered("not json"), {});
  assert.deepEqual(parseRemembered("[1,2]"), {});
  assert.deepEqual(parseRemembered(JSON.stringify({ extrude: { depth: 25, junk: "x", inf: null }, revolve: 3, fillet: { radius: true } })),
    // A word is kept — it may be a choice's (a curve tool's method) — and
    // judged against the declaration only when the tool is armed.
    { extrude: { depth: 25, junk: "x" }, fillet: { radius: true } });
  const storage = memoryStorage();
  storage.setItem(OPTIONS_KEY, "{oops");
  assert.deepEqual(new OptionMemory(storage).recall("extrude"), {});
});

// --- the engine arms through all of it ------------------------------------------

function fakeCanvas(): HTMLCanvasElement {
  return {
    addEventListener() {},
    getContext: () => ({}),
    getBoundingClientRect: () => ({ left: 0, top: 0, x: 0, y: 0, width: 800, height: 600 }),
    setPointerCapture() {},
    releasePointerCapture() {},
  } as unknown as HTMLCanvasElement;
}

function engine(memory = new OptionMemory(null)) {
  const view: View = { ox: 0, oy: 0, scale: 1 };
  return new ToolEngine(new Model(3), fakeCanvas(), view, {
    onSolveRender: () => {}, onRenderOnly: () => {}, optionMemory: memory,
  });
}

test("the engine arms with every option filled, remembers what was typed, and a refused arm leaves the tool as it was", async () => {
  await loadKernel();
  const storage = memoryStorage();
  const e = engine(new OptionMemory(storage));
  e.arm("extrude");
  assert.deepEqual(e.armed, { name: "extrude", options: { depth: 10, end: "blind", mode: "auto" } });
  assert.deepEqual((e.active as unknown as { ctx: { options: unknown } }).ctx.options, { depth: 10, end: "blind", mode: "auto" }, "the tool reads them filled");
  e.arm("extrude", { depth: 25 });
  e.cancel();
  e.arm("extrude");
  assert.deepEqual(e.armed?.options, { depth: 25, end: "blind", mode: "auto" }, "re-armed, the last value is the default");
  // A mode is never the next default: a cut chosen once is not the next feature's.
  e.arm("extrude", { mode: "cut" });
  e.cancel();
  e.arm("extrude");
  assert.deepEqual(e.armed?.options, { depth: 25, end: "blind", mode: "auto" }, "the mode starts from auto again");
  assert.deepEqual(engine(new OptionMemory(storage)).armed, null);
  const reloaded = engine(new OptionMemory(storage));
  reloaded.arm("extrude");
  assert.deepEqual(reloaded.armed?.options, { depth: 25, end: "blind", mode: "auto" }, "and after a reload");

  const before = e.active;
  assert.throws(() => e.arm("extrude", { dpth: 30 }), /extrude has no option "dpth" — its options are \{ depth: 10, end: "blind", mode: "auto" \}/);
  assert.equal(e.active, before, "the same tool, still armed — a typo does not disarm it");
  assert.deepEqual(e.armed?.options, { depth: 25, end: "blind", mode: "auto" });
  assert.throws(() => e.arm("extrude", { depth: 0 }), /cannot be 0/);
  e.arm("extrude");
  assert.deepEqual(e.armed?.options, { depth: 25, end: "blind", mode: "auto" }, "a refused value is not remembered");
});

test("a tool defined at the command line with a static options gets all of it by declaring it", async () => {
  await loadKernel();
  const armed: { name: string; options?: Record<string, unknown> }[] = [];
  const memory = new OptionMemory(null);
  const e = engine(memory);
  const repl = new Repl(neocadScope({
    model: new Model(3),
    arm: (name, options) => { e.arm(name, options); armed.push({ name, options: e.armed?.options }); },
    optionMemory: memory,
  }));
  const def = await repl.eval('defineTool("t_gear", class extends Tool { name = "t_gear"; '
    + 'static options = { teeth: { default: 12, unit: "teeth" }, flip: { default: false } }; })');
  assert.equal(def.ok, true, String(def.error?.message));
  assert.equal((await repl.eval('arm("t_gear")')).value, "armed: t_gear");
  assert.deepEqual(armed.at(-1)?.options, { teeth: 12, flip: false });
  const bad = await repl.eval('arm("t_gear", { teth: 3 })');
  assert.equal(bad.ok, false);
  assert.equal(bad.error?.message, 't_gear has no option "teth" — its options are { teeth: 12, flip: false }');
  await repl.eval('arm("t_gear", { teeth: 20 })');
  const listed = (await repl.eval("tools()")).value as string[];
  assert.ok(listed.includes("t_gear  { teeth: 20, flip: false }  (default { teeth: 12, flip: false })"), listed.join("\n"));
});

test("tools() lists each tool's options with what arm would use, and help() says how", async () => {
  await loadKernel();
  const repl = new Repl(neocadScope({ model: new Model(3), optionMemory: new OptionMemory(null) }));
  const listed = (await repl.eval("tools()")).value as string[];
  // Each line then says what the tool does (its `static summary`, after a dash).
  const line = (start: string) => listed.find((l) => l === start || l.startsWith(`${start}  — `));
  assert.ok(line('extrude  { depth: 10, end: "blind", mode: "auto" }'), listed.join("\n"));
  assert.ok(line('revolve  { angle: 6.283185, mode: "auto" }'));
  assert.ok(line("fillet  { radius: 10 }"));
  assert.ok(line("point"), "a tool with none is its bare name");
  const help = (await repl.eval("help()")).value as string;
  assert.match(help, /static options = \{ depth: \{ default: 10, unit: "length" \} \}/);
  assert.match(help, /tools\(\) lists them/);
  assert.match(help, /remembered/);
});
