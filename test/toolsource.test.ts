// A saved file carries the source of tools authored at the command line — as
// text, and only as text.
//
// The claim these tests exist to defend is not "tools round-trip" but the
// stronger one underneath it: **nothing in a file runs that the user did not
// type**. So most of what is checked below is an absence — a marker that was
// not set, a name that did not register, a journal entry that was not written
// — and the sources used are deliberately loud about it: each would announce
// itself if anything ever evaluated it.

import { test } from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { ensureKernelLoaded } from "../src/kernel/problem.ts";
import { Model } from "../src/model.ts";
import { Repl } from "../src/repl.ts";
import { neocadScope } from "../src/replenv.ts";
import { VERSION, open as openModel, save, savedTools, type SavedModel } from "../src/persist.ts";
import { ToolSourceStore, carriedNotice, carryIntoSession } from "../src/toolsource.ts";
import { defineTool, getToolCtor, listTools } from "../src/tools/tool.ts";
import "../src/tools/point.ts"; // a built-in, registered the way built-ins are
import { axisFrame } from "./frames.ts";

async function loadKernel() {
  const bytes = await readFile(new URL("../src/kernel/wasm-gen/neocad_kernel_bg.wasm", import.meta.url));
  await ensureKernelLoaded(bytes);
}

/**
 * A command line with everything this feature needs wired: a store of its own
 * (so tests do not share one), the entry seam, a log to read back, and a host
 * that can swap the model — which is what `open()` requires.
 *
 * The `currentEntry` line is the whole capture seam. Nothing else connects the
 * evaluator's knowledge of the entry text to the command surface's knowledge
 * of what a tool is.
 */
function session(first = new Model(2)) {
  const store = new ToolSourceStore();
  const logged: string[] = [];
  let model = first;
  const repl = new Repl();
  const wire = () => repl.define(neocadScope({
    model,
    toolSources: store,
    currentEntry: () => repl.entry,
    log: (line) => { logged.push(line); },
    openModel: (json) => { model = openModel(json); wire(); },
  }));
  wire();
  return { repl, store, logged, model: () => model };
}

async function run(repl: Repl, src: string) {
  const r = await repl.eval(src);
  assert.equal(r.ok, true, `entry failed: ${r.error?.message}`);
  return r;
}

const value = async (repl: Repl, src: string) => (await run(repl, src)).value;

// --- capture ---------------------------------------------------------------

test("the entry that defined a tool is captured whole, helpers and all", async () => {
  const { repl, store } = session();
  // Two statements: one the class needs, one that registers it. A capture that
  // sliced out the class expression would lose the first and produce a source
  // that cannot be pasted back.
  const entry = 'sideLength = 40;\ndefineTool("t_whole", class extends Tool { name = "t_whole"; });';
  await run(repl, entry);

  assert.equal(store.get("t_whole"), entry, "the whole entry, not the class expression");
  assert.ok(listTools().includes("t_whole"), "and it registered like any other tool");
});

test("redefining a tool replaces its stored source", async () => {
  const { repl, store } = session();
  await run(repl, 'defineTool("t_redef", class extends Tool { name = "t_redef"; }); // first');
  await run(repl, 'defineTool("t_redef", class extends Tool { name = "t_redef"; }); // second');
  assert.match(store.get("t_redef")!, /second/);
  assert.doesNotMatch(store.get("t_redef")!, /first/);
  assert.equal(store.names().filter((n) => n === "t_redef").length, 1);
});

test("an entry that defines two tools is stored whole under both names", async () => {
  const { repl, store } = session();
  const entry = 'defineTool("t_pair_a", class extends Tool { name = "t_pair_a"; });'
    + ' defineTool("t_pair_b", class extends Tool { name = "t_pair_b"; });';
  await run(repl, entry);
  // Correct — the entry is what would have to be pasted to get either back —
  // and worth knowing: pasting one of them defines both.
  assert.equal(store.get("t_pair_a"), entry);
  assert.equal(store.get("t_pair_b"), entry);
});

test("built-ins are never captured, and neither is a defineTool nobody typed", async () => {
  const { repl, store } = session();
  // `point` registered itself from its own module at import time, which does
  // not go through the command surface at all. Nothing had to check for it.
  assert.ok(listTools().includes("point"));
  assert.equal(store.get("point"), undefined);

  // The registry's own function, called directly: no entry in flight, and
  // nothing recorded even though this is the same call the wrapper makes.
  defineTool("t_direct", class { name = "t_direct"; } as never);
  assert.equal(store.get("t_direct"), undefined);

  // And the wrapper with no `currentEntry` handle — a host that never wired
  // the seam — registers without capturing rather than guessing.
  const unwired = new Repl(neocadScope({ model: new Model(2), toolSources: store }));
  await run(unwired, 'defineTool("t_unwired", class extends Tool { name = "t_unwired"; });');
  assert.ok(listTools().includes("t_unwired"));
  assert.equal(store.get("t_unwired"), undefined);

  const saved = JSON.parse(await value(repl, "save()") as string) as SavedModel;
  assert.equal(saved.tools, undefined, "so a session that authored nothing saves no tools field");
});

test("the in-flight entry is visible while it runs and gone afterwards", async () => {
  const { repl } = session();
  repl.define({ peek: () => repl.entry });
  assert.equal(repl.entry, null);
  assert.equal(await value(repl, "peek()"), "peek()");
  assert.equal(repl.entry, null, "and it does not linger between entries");
});

// --- what save writes ------------------------------------------------------

test("save carries the source, and a session with no tools writes the file it always did", async () => {
  await loadKernel();
  const model = new Model(2);
  axisFrame(model);
  const { repl, store } = session(model);

  const before = await value(repl, "save()") as string;
  assert.equal("tools" in JSON.parse(before), false, "absent, not an empty array");

  const entry = 'defineTool("t_saved", class extends Tool { name = "t_saved"; });';
  await run(repl, entry);
  const after = JSON.parse(await value(repl, "save()") as string) as SavedModel;
  assert.deepEqual(after.tools, [{ name: "t_saved", source: entry }]);
  // Whatever the current version is — the point is that carrying tools did not
  // move it. (It was 4 when this was written; 3D frames moved it to 5 for a
  // reason of their own.)
  assert.equal(after.version, VERSION, "an additive optional field is not a format break");
  assert.equal(JSON.parse(before).version, VERSION);

  // The rest of the file is untouched — the tools ride beside the journal.
  assert.deepEqual(after.journal, JSON.parse(before).journal);
  assert.deepEqual(store.all(), [{ name: "t_saved", source: entry }]);
});

test("defining a tool journals nothing and is not an edit to the drawing", async () => {
  await loadKernel();
  const model = new Model(2);
  axisFrame(model);
  const { repl } = session(model);

  const journalBefore = model.journal.length;
  // This is the exact comparison main.ts's undo bracket makes: snapshot
  // before, snapshot after, record a step only if they differ. `save(model)`
  // without tools is what a snapshot is, so authoring a tool must leave it
  // byte-identical or every definition would land on the undo stack.
  const snapshotBefore = save(model, false);

  await run(repl, 'defineTool("t_nojournal", class extends Tool { name = "t_nojournal"; });');

  assert.equal(model.journal.length, journalBefore, "a tool is not something done to the model");
  assert.equal(save(model, false), snapshotBefore, "and not an undo step either");
});

// --- what open does, and mostly does not -----------------------------------

/** A source that would be unmissable if anything ever evaluated it. */
const LOUD = 'itRan = "RAN"; defineTool("t_gear", class extends Tool { name = "t_gear"; '
  + 'onDown(p) { pt(p.world[0], p.world[1]); this.ctx.finish(); } });';

function fileCarrying(sources: { name: string; source: string }[]): string {
  const model = new Model(2);
  axisFrame(model);
  return save(model, true, sources);
}

test("open surfaces a carried tool and evaluates nothing", async () => {
  await loadKernel();
  const { repl, store, logged, model } = session();
  repl.define({ fileText: fileCarrying([{ name: "t_gear", source: LOUD }]) });

  assert.equal(await value(repl, "open(fileText)"), "opened");

  assert.deepEqual(logged, [
    'this file carries the source of tool "t_gear" — toolSource("t_gear") shows it; paste it to enable',
  ]);
  assert.equal(logged[0], carriedNotice("t_gear"), "and the app has one place that phrases it");

  // The three ways the file could have run and did not.
  assert.equal(getToolCtor("t_gear"), undefined, "nothing registered");
  assert.equal(repl.scope.itRan, undefined, "no bare assignment landed in the scope");
  assert.deepEqual(model().journal.map((j) => j.op), ["addPoint", "addPoint", "addFrame", "setDefaultFrame"],
    "the journal is the file's geometry and nothing else");

  // It is held as text, and says so in the listing.
  assert.equal(store.get("t_gear"), LOUD);
  const listed = await value(repl, "tools()") as string[];
  assert.ok(listed.includes('t_gear (source only — toolSource("t_gear") to see it)'));
  assert.equal(listed.includes("t_gear"), false, "not listed as if it were armable");
});

test("a hostile source sits inert through open, list, print and save", async () => {
  await loadKernel();
  const hostile = 'wasRun = "RAN"; throw new Error("a saved file must never run");';
  const { repl, logged } = session();
  repl.define({ fileText: fileCarrying([{ name: "t_hostile", source: hostile }]) });

  await run(repl, "open(fileText)");
  assert.equal(logged.length, 1);
  assert.equal(repl.scope.wasRun, undefined);

  // Listed, printed and written back out — every path a source travels — and
  // it is still a string at the end of each of them.
  await run(repl, "tools()");
  assert.equal(await value(repl, 'toolSource("t_hostile")'), hostile);
  const round = JSON.parse(await value(repl, "save()") as string) as SavedModel;
  assert.deepEqual(round.tools, [{ name: "t_hostile", source: hostile }]);
  assert.equal(repl.scope.wasRun, undefined, "still nothing ran");
  assert.equal(getToolCtor("t_hostile"), undefined);
});

test("toolSource refuses a name it has no source for", async () => {
  const { repl } = session();
  const r = await repl.eval('toolSource("point")');
  assert.equal(r.ok, false);
  assert.match(r.error!.message, /no source stored for "point"/);
});

// --- the round trip, ending in a paste -------------------------------------

test("the paste is the consent: open, read, paste, arm, and it saves forward", async () => {
  await loadKernel();
  const { repl, store, logged, model } = session();
  repl.define({ fileText: fileCarrying([{ name: "t_gear", source: LOUD }]) });
  await run(repl, "open(fileText)");
  assert.equal(logged.length, 1);
  assert.equal(getToolCtor("t_gear"), undefined);

  // What the user reads, and then types back. Taking the text from the command
  // rather than from the fixture is the point: this is the file's own source
  // making the trip, not a copy the test kept.
  const printed = await value(repl, 'toolSource("t_gear")') as string;
  const pasted = await repl.eval(printed);
  assert.equal(pasted.ok, true, `pasting failed: ${pasted.error?.message}`);

  // Now — and only now — it ran, because a person ran it.
  assert.equal(repl.scope.itRan, "RAN");
  assert.ok(getToolCtor("t_gear"), "the tool is registered and armable");
  assert.ok((await value(repl, "tools()") as string[]).includes("t_gear"));

  // The paste was an ordinary entry, so the wrapper captured it exactly as it
  // captures anything typed here — and the next save carries it forward.
  assert.equal(store.get("t_gear"), printed);
  const again = JSON.parse(await value(repl, "save()") as string) as SavedModel;
  assert.deepEqual(again.tools, [{ name: "t_gear", source: LOUD }]);
  assert.deepEqual(again.journal, model().journal, "and the drawing is still the file's");
});

// --- the store's two rules -------------------------------------------------

test("a definition this session watched wins over a file's version of the same name", () => {
  const store = new ToolSourceStore();
  store.capture("t_rule", "the live one");
  const taken = store.carry([{ name: "t_rule", source: "the file's one" }]);
  assert.deepEqual(taken, [], "nothing new to tell the user about");
  assert.equal(store.get("t_rule"), "the live one", "the store matches what is registered");
});

test("opening a second file drops the first file's carried sources", () => {
  const store = new ToolSourceStore();
  store.capture("t_mine", "typed here");
  store.carry([{ name: "t_first", source: "from file one" }]);
  store.carry([{ name: "t_second", source: "from file two" }]);
  assert.deepEqual(store.names().sort(), ["t_mine", "t_second"]);
  assert.equal(store.get("t_first"), undefined, "it belonged to a drawing no longer open");
});

test("a carried name that is already a registered tool gets no paste-it line", () => {
  const store = new ToolSourceStore();
  const lines = carryIntoSession([{ name: "point", source: "pretending to be the built-in" }], store);
  assert.deepEqual(lines, [], '"paste it to enable" would not be true of something already armable');
  assert.equal(store.get("point"), "pretending to be the built-in", "still stored, still only text");
});

// --- reading the field -----------------------------------------------------

test("savedTools reads only well-shaped entries and refuses nothing else", () => {
  assert.deepEqual(savedTools('{"format":"neocad-model"}'), [], "a file with no tools carries none");
  assert.deepEqual(savedTools("not json at all"), []);
  assert.deepEqual(
    savedTools(JSON.stringify({
      tools: [
        { name: "ok", source: "text" },
        { name: "missing source" },
        { source: "missing name" },
        { name: 7, source: "wrong type" },
        "a bare string",
        null,
      ],
    })),
    [{ name: "ok", source: "text" }],
    "a mangled entry is skipped — a tool source is not load-bearing for the drawing",
  );
});
