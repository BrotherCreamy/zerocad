// The open group and the organiser pane (docs/plans/organiser.md).
//
// The owner: *"create a new group and "open" the group, which means any
// entities which get created become a part of that group."* So these hold the
// open group to being **journalled document state** — `opengroup`/`closegroup`
// are entries, a replay reopens it at the same step and so adds the same
// entities to the same group, and an undo (a snapshot reopened) puts it back —
// and hold *every* way an entity is made to joining it: a typed constructor, a
// tool's gesture, a fillet's arc, an extrude's twins. Then what this package
// reversed of groups.md: a group may be empty, and an old file that relied on
// an emptied group going still opens. Then rename, the regeneration rule, and
// the pane's pure half — what it shows and what each control types.

import { test } from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { ensureKernelLoaded } from "../src/kernel/problem.ts";
import { Model } from "../src/model.ts";
import { fix } from "../src/relations/basic.ts";
import { parallel } from "../src/relations/geometry.ts";
import { del, extrude, fillet } from "../src/operations.ts";
import { addTo, closegroup, group, hide, members, opengroup, removeFrom, rename, ungroup } from "../src/groups.ts";
import { FORMAT, VERSION, open, save } from "../src/persist.ts";
import { describePick } from "../src/picking.ts";
import { Repl } from "../src/repl.ts";
import { neocadScope } from "../src/replenv.ts";
import { RectangleTool } from "../src/tools/rectangle.ts";
import type { ToolContext } from "../src/tools/tool.ts";
import { addCommand, organiserSections, rowMenu } from "../src/organiser.ts";
import { defaultLayout, parseStored } from "../src/panels.ts";
import { axisFrame, tiltedFrame } from "./frames.ts";
import { polygon } from "./profiles.ts";

async function loadKernel() {
  const bytes = await readFile(new URL("../src/kernel/wasm-gen/neocad_kernel_bg.wasm", import.meta.url));
  await ensureKernelLoaded(bytes);
}

function fakeCtx(model: Model): ToolContext {
  return {
    model, options: {},
    requestRender() {}, requestSolve() { model.solve(); }, finish() {},
  } as ToolContext;
}

/** A REPL over `m` with a selection and a log, as the app's. */
function repl(m: Model) {
  let held: readonly string[] = [];
  const said: string[] = [];
  const r = new Repl(neocadScope({
    model: m,
    log: (line) => { said.push(line); },
    selection: (names) => { if (names !== undefined) held = [...names]; return [...held]; },
  }));
  const run = async (src: string) => {
    const out = await r.eval(src);
    assert.equal(out.ok, true, `${src}: ${out.error?.message}`);
    return out.value;
  };
  return { run, said, eval: (src: string) => r.eval(src) };
}

/** A 40 × 30 rectangle on a tilted frame, held so a fillet works on it. */
function rectangle(m: Model) {
  const t = tiltedFrame(m);
  const { points, lines } = polygon(m, t, [[0, 0], [40, 0], [40, 30], [0, 30]]);
  fix(m, points[0], [0, 0, 0], t.name);
  fix(m, points[2], [40, 30, 0], t.name);
  lines.forEach((l, i) => parallel(m, l, i % 2 === 0 ? `${t.name}.x` : `${t.name}.y`));
  assert.equal(m.solve().solved, true);
  return { t, points, lines };
}

const entityNames = (m: Model) => new Set(m.entities.keys());
const madeSince = (m: Model, before: Set<string>) => [...m.entities.keys()].filter((n) => !before.has(n));

// --- the open group -----------------------------------------------------------

test("opengroup / closegroup: journalled document state, a no-op journals nothing, replayed and undone with the file", async () => {
  await loadKernel();
  const m = new Model(2);
  assert.equal(group(m), "g1", "a group may start empty — one opened to be drawn into does");
  assert.deepEqual(members(m, "g1"), []);
  assert.equal(opengroup(m, "g1"), "g1");
  assert.equal(m.openGroup, "g1");
  assert.deepEqual(m.journal.at(-1), { op: "opengroup", args: ["g1"] });
  const n = m.journal.length;
  opengroup(m, "g1");
  assert.equal(m.journal.length, n, "opening what is open changes nothing, so journals nothing");
  const before = save(m, false); // what the app's undo snapshots
  m.addPoint([1, 2], "p1");
  m.addLine("p1", null, "l1");
  assert.deepEqual(members(m, "g1"), ["p1", "p2", "l1"], "every entity made joins — the line's own endpoint too");
  assert.deepEqual(m.journal.slice(-2).map((e) => e.op), ["addPoint", "addLine"], "in the entry that made it: no addTo of its own");
  assert.equal(closegroup(m), "g1");
  assert.equal(m.openGroup, null);
  assert.deepEqual(m.journal.at(-1), { op: "closegroup", args: [] });
  assert.equal(closegroup(m), null, "closing with nothing open is nothing");
  assert.deepEqual(m.journal.at(-1), { op: "closegroup", args: [] }, "and journals nothing");
  m.addPoint([5, 5], "p9");
  assert.deepEqual(members(m, "g1"), ["p1", "p2", "l1"], "closed: nothing more joins");

  const reopened = open(save(m));
  assert.deepEqual(members(reopened, "g1"), ["p1", "p2", "l1"], "replay reopens it at its step, so the same entities join");
  assert.equal(reopened.openGroup, null);
  assert.equal(save(reopened), save(m), "and saves byte for byte");

  const undone = open(before);
  assert.equal(undone.openGroup, "g1", "an undo to before the drawing gives the open group back");
  undone.addPoint([0, 0], "p3");
  assert.deepEqual(members(undone, "g1"), ["p3"]);

  assert.throws(() => opengroup(m, "p1"), /"p1" is not a group/);
  assert.throws(() => opengroup(m), /opengroup takes the name of a group/);
});

test("an open group saved open is open in the file: what is drawn after reopening joins it", async () => {
  await loadKernel();
  const m = new Model(2);
  opengroup(m, group(m, { name: "frame" }));
  m.addPoint([0, 0]);
  const reopened = open(save(m));
  assert.equal(reopened.openGroup, "frame");
  reopened.addPoint([1, 1]);
  assert.deepEqual(members(reopened, "frame"), ["p1", "p2"]);
});

test("ungroup of the open group closes it; opening another switches; a feature cannot be opened", async () => {
  await loadKernel();
  const m = new Model(3);
  const { lines } = rectangle(m);
  group(m, { name: "a" });
  group(m, { name: "b" });
  opengroup(m, "a");
  opengroup(m, "b");
  assert.equal(m.openGroup, "b", "one at a time");
  ungroup(m, "b");
  assert.equal(m.openGroup, null, "a group that is not there is not open");
  extrude(m, lines[0], 10);
  assert.throws(() => opengroup(m, "e1"), /"e1" is a feature — its members follow its profile/);
  const reopened = open(save(m));
  assert.equal(reopened.openGroup, null);
});

test("every way an entity is made joins the open group: a typed constructor, a tool's gesture, a fillet, an extrude — and replay reproduces it", async () => {
  await loadKernel();
  const m = new Model(3);
  const { t, lines } = rectangle(m);
  const { run } = repl(m);
  await run('opengroup(group({ name: "work" }))');

  // Typed: a point and a line, and the line's auto-made end with it.
  let before = entityNames(m);
  await run("pt(100, 100)");
  await run("line()");
  const typed = madeSince(m, before);
  assert.equal(typed.length, 4);
  assert.deepEqual(members(m, "work"), typed);

  // A tool's gesture: the rectangle tool's four corners and four edges.
  before = entityNames(m);
  const tool = new RectangleTool(fakeCtx(m));
  const plane = { origin: t.origin, u: t.ux, v: t.uy };
  tool.onDown({ world: t.at(200, 0), screen: [0, 0], plane });
  tool.onUp({ world: t.at(260, 40), screen: [60, 40], plane });
  const drawn = madeSince(m, before);
  assert.equal(drawn.length, 8, "4 points and 4 lines");
  for (const n of drawn) assert.ok(members(m, "work").includes(n), `${n} joined`);

  // An extrude: its twins, walls (and nothing of the profile, which was already the sketch's).
  before = entityNames(m);
  extrude(m, lines[0], 20);
  const solid = madeSince(m, before);
  assert.ok(solid.length >= 12, "twins and walls");
  for (const n of solid) assert.ok(members(m, "work").includes(n), `${n} joined`);
  assert.ok(!members(m, "work").includes(m.featureOf("e1", "extrude").depth), "a relation made is not an entity made");

  // A fillet: its arc and tangent points.
  before = entityNames(m);
  fillet(m, lines[0], lines[1], 5);
  const round = madeSince(m, before);
  assert.ok(round.some((n) => m.entities.get(n)?.kind === "arc"));
  for (const n of round) assert.ok(members(m, "work").includes(n), `${n} joined`);

  const reopened = open(save(m));
  assert.deepEqual(members(reopened, "work"), members(m, "work"), "the replay adds the same entities to the same group");
  assert.equal(save(reopened), save(m));
});

test("regeneration: a feature's new pieces join the groups that held all it made — not the open group", async () => {
  await loadKernel();
  const m = new Model(3);
  const { lines } = rectangle(m);
  opengroup(m, group(m, { name: "solid" }));
  extrude(m, lines[0], 20);
  closegroup(m);
  const made = m.featureOf("e1").owns.filter((n) => m.entities.has(n));
  assert.deepEqual(members(m, "solid"), made, "at creation, what it made joined the open group");
  group(m, made[0], { name: "one" }); // holds a piece of it, not all
  opengroup(m, group(m, { name: "sketch" }));
  const before = entityNames(m);
  fillet(m, lines[0], lines[1], 5);
  const fresh = madeSince(m, before);
  const own = new Set(m.featureOf("e1").owns);
  const twins = fresh.filter((n) => own.has(n));
  const base = fresh.filter((n) => !own.has(n));
  assert.ok(twins.length >= 4, "the regeneration made a twin arc, its ends and their walls");
  for (const n of twins) {
    assert.ok(members(m, "solid").includes(n), `${n} joined the group that held the whole solid`);
    assert.ok(!members(m, "sketch").includes(n), `${n} did not join the open group`);
    assert.ok(!members(m, "one").includes(n), `${n} did not join a group holding only part of it`);
  }
  for (const n of base) assert.ok(members(m, "sketch").includes(n), `the fillet's own ${n} joined the open group`);
  assert.equal(m.featureOf("e1").owns.filter((n) => m.entities.has(n)).every((n) => members(m, "solid").includes(n)), true,
    "so the group still holds the whole solid");
  const reopened = open(save(m));
  for (const g of ["solid", "sketch", "one"]) assert.deepEqual(members(reopened, g), members(m, g), `${g} replays`);
});

// --- a group may be empty -----------------------------------------------------

test("a group may be empty: removeFrom and deleting the last member leave it; ungroup removes it", async () => {
  await loadKernel();
  const m = new Model(2);
  axisFrame(m);
  m.addPoint([0, 0], "a");
  m.addPoint([5, 0], "b");
  group(m, "a", "b");
  assert.deepEqual(removeFrom(m, "g1", "a"), ["b"]);
  del(m, "b");
  assert.ok(m.groups.has("g1"), "the last member deleted leaves the group, empty");
  assert.deepEqual(members(m, "g1"), []);
  assert.deepEqual(m.journal.slice(-2), [{ op: "removeFrom", args: ["g1", "b"] }, { op: "deleteEntity", args: ["b"] }],
    "the deletion's expansion is what it was; only what it means for g1 changed");
  assert.deepEqual(hide(m, "g1"), [], "hiding an empty group hides nothing");
  addTo(m, "g1", "a");
  assert.deepEqual(members(m, "g1"), ["a"], "and it can be filled again");
  const reopened = open(save(m));
  assert.deepEqual(members(reopened, "g1"), ["a"]);
  ungroup(m, "g1");
  assert.equal(m.groups.has("g1"), false);
});

test("an old file that relied on an emptied group going still opens: translated to the ungroup it meant", async () => {
  await loadKernel();
  // A version-11 file, as the groups build wrote it: g1 emptied by a typed
  // removeFrom, g2 by a deletion's cascade — and then both names used again,
  // which that build allowed because both groups had gone.
  const v11 = {
    format: FORMAT, version: 11, dim: 2,
    journal: [
      { op: "addPoint", args: [[0, 0], "p1"] },
      { op: "addPoint", args: [[5, 0], "p2"] },
      { op: "group", args: ["p1", { name: "g1" }] },
      { op: "removeFrom", args: ["g1", "p1"] },
      { op: "group", args: ["p2", { name: "g2" }] },
      { op: "removeFrom", args: ["g2", "p2"] },
      { op: "deleteEntity", args: ["p2"] },
      { op: "group", args: ["p1", { name: "g1" }] },
      { op: "addPoint", args: [[9, 9], "g2"] },
    ],
    values: { points: {}, radii: {} },
  };
  const m = open(JSON.stringify(v11));
  assert.deepEqual(members(m, "g1"), ["p1"]);
  assert.equal(m.entities.get("g2")?.kind, "point");
  const ops = m.journal.map((e) => e.op);
  assert.deepEqual(ops, ["addPoint", "addPoint", "group", "removeFrom", "ungroup", "group", "removeFrom", "ungroup", "deleteEntity", "group", "addPoint"],
    "each emptying gets the ungroup that build did silently, so the re-saved file means what it meant");
  const resaved = JSON.parse(save(m));
  assert.equal(resaved.version, VERSION);
  assert.ok(VERSION >= 12);
  assert.equal(save(open(save(m))), save(m), "and re-saves byte for byte from then on");
  // The same file claiming today's version keeps the empty groups, and so fails at the name.
  assert.throws(() => open(JSON.stringify({ ...v11, version: VERSION })), /step 8, group.*"g1" already exists/);
});

// --- rename -------------------------------------------------------------------

test("rename(g, name): the model's name rules, journalled, replayed; the open group follows; only groups", async () => {
  await loadKernel();
  const m = new Model(3);
  const { lines } = rectangle(m);
  group(m, lines[0], lines[1]);
  opengroup(m, "g1");
  assert.equal(rename(m, "g1", "edges"), "edges");
  assert.deepEqual(m.journal.at(-1), { op: "rename", args: ["g1", "edges"] });
  assert.equal(m.openGroup, "edges", "still open, under its new name");
  assert.deepEqual(members(m, "edges"), [lines[0], lines[1]]);
  assert.equal(m.groups.has("g1"), false);
  assert.throws(() => rename(m, "edges", lines[2]), /already exists/);
  assert.throws(() => rename(m, "edges", "a.b"), /cannot contain a dot/);
  assert.throws(() => rename(m, lines[0], "x"), /only a group can be renamed/);
  extrude(m, lines[0], 10);
  assert.throws(() => rename(m, "e1", "x"), /"e1" is a feature/);
  assert.equal(rename(m, "edges", "edges"), "edges");
  assert.deepEqual(m.journal.filter((e) => e.op === "rename").length, 1, "renaming to its own name journals nothing");
  group(m, { name: "later" });
  rename(m, "later", "g7");
  assert.equal(group(m), "g8", "a gN name moves the counter past it, as any name given does");
  const reopened = open(save(m));
  assert.deepEqual([...reopened.groups.keys()], [...m.groups.keys()], "same names, same order");
  assert.equal(reopened.openGroup, "edges");
  assert.equal(save(reopened), save(m));
});

// --- the command surface ------------------------------------------------------

test("the command line: opengroup, closegroup and rename are commands; ls says what is open and what is empty; help says it all", async () => {
  await loadKernel();
  const m = new Model(2);
  const { run, said } = repl(m);
  assert.equal(await run("opengroup(group())"), "g1");
  await run("pt(1, 2)");
  const ls = (await run("ls()")) as string[];
  assert.ok(ls.includes("g1  group of p1  (open — new geometry joins it)"), ls.join("\n"));
  await run("closegroup()");
  await run('removeFrom("g1", "p1")');
  assert.match(said.at(-1)!, /g1 is empty now — ungroup\("g1"\) removes it/);
  assert.ok(((await run("ls()")) as string[]).includes("g1  group of nothing yet"));
  assert.equal(await run('rename("g1", "holes")'), "holes");
  const help = (await run("help()")) as string;
  for (const word of ["opengroup", "closegroup", "rename(", "Organiser"]) assert.ok(help.includes(word), `help mentions ${word}`);
});

test("the hover tag of new geometry names the open group, marked", async () => {
  await loadKernel();
  const m = new Model(2);
  opengroup(m, group(m));
  m.addPoint([0, 0], "p1");
  assert.match(describePick(m, { name: "p1", kind: "point", distance: 0 }), /·  g1 \(open\)$/);
  closegroup(m);
  assert.match(describePick(m, { name: "p1", kind: "point", distance: 0 }), /·  g1$/);
});

// --- the pane: what it shows and what each control types -----------------------

test("the pane's sections: a group row is its name, count, eye and open marker; a feature row its kind and what it made", async () => {
  await loadKernel();
  const m = new Model(3);
  const { lines } = rectangle(m);
  extrude(m, lines[0], 10);
  group(m, lines[0], lines[1]);
  opengroup(m, group(m));
  hide(m, lines[1]);
  const [bodies, groups, features] = organiserSections(m, [lines[0]]);
  assert.equal(groups.title, "Groups");
  assert.deepEqual(groups.rows.map((r) => [r.name, r.count, r.eye, r.open]), [["g1", 2, "partial", false], ["g2", 0, "none", true]]);
  assert.equal(groups.rows[0].eyeCommand, 'show("g1")', "anything hidden in it: the eye shows it all");
  assert.equal(groups.rows[1].eyeCommand, null, "nothing to hide in an empty group");
  assert.equal(groups.rows[0].tapCommand, 'select("g1")');
  assert.equal(groups.rows[0].openCommand, 'opengroup("g1")');
  assert.equal(groups.rows[1].openCommand, "closegroup()");
  assert.equal(groups.rows[0].selected, false, "one of two selected is not the row");
  assert.equal(organiserSections(m, [lines[0], lines[1]])[1].rows[0].selected, true);
  assert.equal(features.title, "Features");
  // The body e1 makes, alone (docs/plans/solids-kernel.md): its eye the feature's.
  assert.deepEqual(bodies.rows.map((r) => [r.name, r.detail, r.count, r.eye, r.eyeCommand]), [["e1", "", 1, "shown", 'hide("e1")']]);
  const e1 = features.rows[0];
  assert.deepEqual([e1.name, e1.detail, e1.count, e1.eye, e1.open, e1.eyeCommand], ["e1", "extrude", m.featureOf("e1").owns.length, "shown", null, 'hide("e1")']);
  hide(m, "e1");
  assert.equal(organiserSections(m)[2].rows[0].eyeCommand, 'show("e1")');
  assert.deepEqual(organiserSections(new Model(2)).map((s) => s.rows.length), [0, 0, 0, 0, 0]);
  // Regions, last: the one e1 was made on, its chain the row's detail.
  const regions = organiserSections(m)[3];
  assert.equal(regions.title, "Regions");
  assert.deepEqual(regions.rows.map((r) => [r.name, r.detail, r.count, r.eyeCommand]), [["rg1", `${lines[0]}–${lines[3]}`, 1, 'hide("rg1")']]);
  // With no body, Bodies is not shown at all: Features already says how to
  // make one, and the line twice pushed Groups out of a phone's pane.
  assert.deepEqual(organiserSections(new Model(2)).map((s) => s.empty === null), [true, false, false, true]);
});

test("the ＋ types a group of the selection, or with nothing selected a new empty group opened at once", () => {
  assert.equal(addCommand(["l1", "p2"]), 'group("l1", "p2")');
  assert.equal(addCommand([]), "opengroup(group())");
});

test("a row's menu: Rename, Add/Remove selection, Open/Close, Ungroup for a group; Edit and Delete for a feature — each its command", async () => {
  await loadKernel();
  const m = new Model(3);
  const { lines } = rectangle(m);
  extrude(m, lines[0], 10);
  group(m, lines[0]);
  const items = (sel: string[]) => rowMenu(m, "g1", sel)!.items.map((i) => [i.label, i.action.do === "run" ? i.action.command
    : i.action.do === "type" ? i.action.text : i.action.do === "disabled" ? `off: ${i.action.why}` : ""]);
  assert.deepEqual(items([lines[0], lines[1]]), [
    ["Rename…", 'rename("g1", "'],
    ["Add selection", `addTo("g1", "${lines[1]}")`],
    ["Remove selection", `removeFrom("g1", "${lines[0]}")`],
    ["Open", 'opengroup("g1")'],
    ["Ungroup", 'ungroup("g1")'],
  ]);
  assert.deepEqual(items([]).slice(1, 3), [["Add selection", "off: select something to add first"], ["Remove selection", "off: select members to remove first"]]);
  opengroup(m, "g1");
  assert.deepEqual(items([])[3], ["Close", "closegroup()"]);
  assert.match(rowMenu(m, "g1")!.header!, /g1  group of 1 member  ·  open/);
  assert.deepEqual(rowMenu(m, "e1")!.items.map((i) => [i.label, i.action.do === "run" ? i.action.command : ""]),
    [["Edit e1", 'edit("e1")'], ["Delete", 'del("e1")']]);
  assert.equal(rowMenu(m, lines[0]), null);
});

test("every command the pane types is one the command line takes", async () => {
  await loadKernel();
  const m = new Model(3);
  const { lines } = rectangle(m);
  extrude(m, lines[0], 10);
  const { run } = repl(m);
  await run(addCommand([]));
  await run(addCommand([lines[0]]));
  const typed: string[] = [];
  for (const s of organiserSections(m, [lines[1]])) {
    for (const r of s.rows) {
      typed.push(r.tapCommand);
      if (r.eyeCommand) typed.push(r.eyeCommand);
      if (r.openCommand) typed.push(r.openCommand);
      for (const i of rowMenu(m, r.name, [lines[1]])!.items) if (i.action.do === "run" && !i.action.command.startsWith("edit") && !i.action.command.startsWith("del")) typed.push(i.action.command);
    }
  }
  for (const c of typed) await run(c);
  assert.ok(typed.length >= 10);
});

test("a pane that starts hidden (the organiser, on a phone) is kept shown by saying so: the stored layout keeps hidden: false", () => {
  const text = JSON.stringify({ panels: { organiser: { hidden: false }, log: { hidden: true }, cmd: { hidden: "yes" } } });
  assert.deepEqual(parseStored(text), { organiser: { hidden: false }, log: { hidden: true } }, "a flag, either way; anything else dropped");
  const d = defaultLayout({ w: 1100, h: 800 }, 11);
  assert.deepEqual(d.organiser, { x: 1100 - 8 - 190, y: 800 - 8 - 260, w: 190, h: 260 }, "a desktop's: the bottom-right corner");
});
