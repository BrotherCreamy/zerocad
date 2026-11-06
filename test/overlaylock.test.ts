// See-through panels, each in a form of its own, and the lock
// (docs/plans/panels-overlay-lock.md). The owner: "there should be a menu
// option to make the toolbars transparent to maximize visible viewport size.
// and also another option to lock the toolbars in place. note: things like the
// organiser toolbar etc need to have some kind of structure to their layout in
// order to make the transparent view work. like how the feature tree in
// solidworks changes form when it is overlaid over the viewport vs being in a
// pane on the side".
//
// The pure half: each pane's see-through form is made from the same data as
// its docked form — the organiser's tree from the very sections the docked
// pane draws (its roots and children are the sections' rows), the log's tail
// from the docked log's last lines; the two switches are remembered beside the
// layout, typed, and never journalled; a locked drag moves nothing and pushes
// nobody; a locked layout re-fitted to a new area is named. The DOM half — what
// it looks like over the drawing, presses reaching the canvas, the contrast —
// is test/e2e/overlaylock.e2e.ts.

import { test } from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { ensureKernelLoaded } from "../src/kernel/problem.ts";
import { Model } from "../src/model.ts";
import { extrude } from "../src/operations.ts";
import { group, opengroup } from "../src/groups.ts";
import { Repl } from "../src/repl.ts";
import { neocadScope } from "../src/replenv.ts";
import { collapsedNote, organiserSections, organiserTree, type OrganiserRow } from "../src/organiser.ts";
import { TAIL_HOLD_MS, TAIL_LIFE_MS, TAIL_LINES, logTail, tailOpacity, type LogEntry } from "../src/logtail.ts";
import {
  LOCKED_GUIDE, NO_SWITCHES, SWITCHES_KEY, beginDrag, describeSwitches, dragTo, dropOf, ghostsOf, hugOf, loadSwitches,
  panelsLine, parseSwitches, refitted, saveSwitches, stripTip, switchesFrom, type Layout, type PanelSwitches, type StorageLike,
} from "../src/panels.ts";
import { SWITCH_ITEMS, switchCommand } from "../src/appmenu.ts";
import { tiltedFrame } from "./frames.ts";
import { polygon } from "./profiles.ts";

async function loadKernel() {
  const bytes = await readFile(new URL("../src/kernel/wasm-gen/neocad_kernel_bg.wasm", import.meta.url));
  await ensureKernelLoaded(bytes);
}

/** Two bodies — a plate with a boss added and a second block — two groups, one open, and their regions. */
function busy(): Model {
  const m = new Model(3);
  const t = tiltedFrame(m);
  const a = polygon(m, t, [[0, 0], [40, 0], [40, 30], [0, 30]]);
  const e1 = extrude(m, a.lines[0], 10);
  const b = polygon(m, t, [[10, 10], [20, 10], [20, 20], [10, 20]]);
  extrude(m, b.lines[0], -14, { mode: "add", into: e1 });
  const c = polygon(m, t, [[60, 0], [80, 0], [80, 20], [60, 20]]);
  extrude(m, c.lines[0], 8, { mode: "new" });
  group(m, a.lines[0], a.lines[1]);
  opengroup(m, group(m));
  m.solve();
  return m;
}

const rowKey = (r: OrganiserRow) => `${r.name}|${r.detail}|${r.tapCommand}`;

test("the organiser's see-through tree is the docked sections' rows: bodies as roots with their chains, Groups and Regions each a root, nothing else", async () => {
  await loadKernel();
  const m = busy();
  const sections = organiserSections(m, []);
  const tree = organiserTree(sections);
  const of = (id: string) => sections.find((s) => s.id === id)!.rows;
  // Every row of every section is in the tree exactly once, and nothing else is.
  const inTree = tree.flatMap((n) => [...(n.row ? [n.row] : []), ...n.children.map((c) => c.row!)]).map(rowKey).sort();
  const docked = sections.flatMap((s) => s.rows).map(rowKey).sort();
  assert.deepEqual(inTree, docked, "the tree's roots and children are the sections' rows");
  // The roots: each body, then the Groups heading, then the Regions heading — the Bodies and Features headings gone.
  assert.deepEqual(tree.map((n) => [n.kind, n.label, n.row === null]), [
    ["body", "e1", false], ["body", "e3", false], ["group", "Groups", true], ["region", "Regions", true],
  ]);
  // A body's children are its chain's feature rows, in chain order — the docked Features rows, the same objects' words.
  assert.deepEqual(tree[0].children.map((c) => [c.kind, c.label, c.row!.detail]), [["feature", "e1", "extrude"], ["feature", "e2", "extrude · add"]]);
  assert.deepEqual(tree[1].children.map((c) => c.label), ["e3"]);
  assert.deepEqual(tree[2].children.map((c) => c.row), of("groups"), "a heading's children are that section's rows themselves");
  assert.deepEqual(tree[3].children.map((c) => c.row), of("regions"));
  // The same actions: a node's row is the docked row, so its tap and its menu are.
  assert.equal(tree[0].row!.tapCommand, of("bodies")[0].tapCommand);
  assert.equal(tree[2].children[1].row!.open, true, "the open group is marked as the docked row marks it");
  // Collapsed (the default) a body says its last feature beside it, a heading its count, a lone body nothing.
  assert.equal(collapsedNote(tree[0]), "› e2 extrude · add");
  assert.equal(collapsedNote(tree[1]), "");
  assert.equal(collapsedNote(tree[2]), "2");
});

test("the tree leaves empty sections out — no Groups root with no group, nothing at all for an empty model", async () => {
  await loadKernel();
  assert.deepEqual(organiserTree(organiserSections(new Model(3))), []);
  const m = new Model(3);
  const t = tiltedFrame(m);
  extrude(m, polygon(m, t, [[0, 0], [10, 0], [10, 10], [0, 10]]).lines[0], 5);
  m.solve();
  assert.deepEqual(organiserTree(organiserSections(m)).map((n) => n.label), ["e1", "Regions"]);
});

test("a feature in no body's chain is a root of its own, not lost", () => {
  const row = (name: string, extra: Partial<OrganiserRow> = {}): OrganiserRow => ({
    name, detail: "extrude", count: 1, eye: "shown", eyeCommand: null, tapCommand: `select("${name}")`, selected: false, open: null, openCommand: null, ...extra,
  });
  const tree = organiserTree([
    { id: "bodies", title: "Bodies", rows: [row("e1", { chain: ["e1"] })], empty: null },
    { id: "groups", title: "Groups", rows: [], empty: "none" },
    { id: "features", title: "Features", rows: [row("e1"), row("e9")], empty: "none" },
  ]);
  assert.deepEqual(tree.map((n) => [n.kind, n.label, n.children.length]), [["body", "e1", 1], ["feature", "e9", 0]]);
});

test("the log's see-through tail: the docked log's last three lines, whole for 3 s, fading, gone at 10 s", () => {
  assert.equal(TAIL_LINES, 3);
  const entries: LogEntry[] = [0, 1000, 2000, 9000].map((at, i) => ({ text: `line ${i}`, cls: i === 3 ? "err" : "out", at }));
  const at10 = logTail(entries, 11_200);
  // The last three of the docked log, oldest first; the one at 0 is not among them, and the one at 1000 has aged out.
  assert.deepEqual(at10.map((l) => l.text), ["line 2", "line 3"]);
  assert.equal(at10[1].cls, "err", "said in its own colour");
  assert.ok(at10[0].opacity < at10[1].opacity, "older is fainter");
  assert.deepEqual(logTail(entries, 9500).map((l) => l.text), ["line 1", "line 2", "line 3"]);
  assert.equal(tailOpacity(0), 1);
  assert.equal(tailOpacity(TAIL_HOLD_MS), 1);
  assert.ok(tailOpacity((TAIL_HOLD_MS + TAIL_LIFE_MS) / 2) > 0.4 && tailOpacity((TAIL_HOLD_MS + TAIL_LIFE_MS) / 2) < 0.6);
  assert.equal(tailOpacity(TAIL_LIFE_MS), 0);
  assert.deepEqual(logTail(entries, 20_000), [], "a quiet log is an empty tail");
});

/** A storage that throws on every touch, as a private window's does. */
const throwing: StorageLike = {
  getItem() { throw new Error("denied"); }, setItem() { throw new Error("denied"); }, removeItem() { throw new Error("denied"); },
};
function memory(): StorageLike & { data: Map<string, string> } {
  const data = new Map<string, string>();
  return { data, getItem: (k) => data.get(k) ?? null, setItem: (k, v) => { data.set(k, v); }, removeItem: (k) => { data.delete(k); } };
}

test("the two switches are remembered beside the layout, under their own key, and survive a throwing storage", () => {
  const s = memory();
  assert.deepEqual(loadSwitches(s), NO_SWITCHES, "off by default");
  assert.equal(saveSwitches(s, { overlay: true, locked: false }), true);
  assert.deepEqual(JSON.parse(s.data.get(SWITCHES_KEY)!), { overlay: true, locked: false });
  assert.notEqual(SWITCHES_KEY, "neocad.panels.v3", "not in the layout's own record, which layout(\"reset\") empties");
  assert.deepEqual(loadSwitches(s), { overlay: true, locked: false });
  assert.deepEqual(loadSwitches(throwing), NO_SWITCHES);
  assert.equal(saveSwitches(throwing, { overlay: true, locked: true }), false);
  assert.deepEqual(parseSwitches("{\"overlay\":\"yes\",\"locked\":1}"), NO_SWITCHES, "only a boolean counts");
  assert.deepEqual(parseSwitches("not json"), NO_SWITCHES);
});

test("panels({...}) at the command line: sets either or both, says both, refuses what it does not take — and journals nothing", async () => {
  await loadKernel();
  const m = busy();
  const before = m.journal.length;
  const storage = memory();
  let now: PanelSwitches = { ...NO_SWITCHES };
  const repl = new Repl(neocadScope({
    model: m,
    panels: (o) => panelsLine(() => now, (s) => { now = s; saveSwitches(storage, s); }, o),
  }));
  const run = async (src: string) => {
    const r = await repl.eval(src);
    assert.equal(r.ok, true, `${src}: ${r.error?.message}`);
    return String(r.value);
  };
  assert.match(await run("panels()"), /see-through off, locked off/);
  assert.match(await run("panels({ overlay: true })"), /see-through on, locked off/);
  assert.match(await run("panels({ locked: true })"), /see-through on, locked on/, "one key leaves the other as it was");
  assert.match(await run("panels({ overlay: false, locked: false })"), /see-through off, locked off/);
  assert.deepEqual(JSON.parse(storage.data.get(SWITCHES_KEY)!), { overlay: false, locked: false }, "stored as set");
  for (const bad of ['panels({ overlay: "yes" })', "panels({ lock: true })", "panels(true)"]) {
    const r = await repl.eval(bad);
    assert.equal(r.ok, false, bad);
    assert.match(r.error!.message, /overlay|locked/, `${bad} says what it takes`);
  }
  assert.equal(m.journal.length, before, "not one entry journalled: the switches are the viewer's, not the drawing's");
  assert.throws(() => switchesFrom(NO_SWITCHES, null));
  assert.match(describeSwitches({ overlay: true, locked: true }), /panels\(\{ overlay: true \}\), panels\(\{ locked: true \}\)/);
});

test("the menu's View switches type the command: See-through panels, Lock panels", () => {
  assert.deepEqual(SWITCH_ITEMS.map((i) => i.label), ["See-through panels", "Lock panels"]);
  assert.equal(switchCommand("overlay", true), "panels({ overlay: true })");
  assert.equal(switchCommand("locked", false), "panels({ locked: false })");
});

const area = { w: 1000, h: 700 };
const layout: Layout = {
  toolbar: { x: 8, y: 40, w: 28, h: 300, orient: "column" },
  log: { x: 44, y: 40, w: 300, h: 150 },
  cmd: { x: 44, y: 600, w: 400, h: 44 },
};
const mins = () => ({ w: 10, h: 10 });

test("a locked layout refuses a drag and a push: the held panel stays, nothing is pushed, nothing is ghosted, the drop commits nothing", () => {
  // Unlocked, the tray dragged right into the log moves up against it (it
  // pushed the log until docs/plans/panels-reshuffle.md; now nothing is pushed).
  const free = dragTo(beginDrag("toolbar", "move", { x: 20, y: 45 }, layout), { x: 120, y: 45 }, area, mins);
  assert.notDeepEqual(free.preview.toolbar, layout.toolbar, "unlocked, the tray would move");
  assert.deepEqual(ghostsOf(free).toolbar, { ...layout.toolbar, x: layout.log.x - layout.toolbar.w }, "flush against the log");
  // Locked, the same drag and the same push move nothing.
  let drag = beginDrag("toolbar", "move", { x: 20, y: 45 }, layout, "se", 12, true);
  for (const p of [{ x: 60, y: 45 }, { x: 120, y: 45 }, { x: 400, y: 500 }]) {
    drag = dragTo(drag, p, area, mins);
    assert.deepEqual(drag.preview, layout, `at ${JSON.stringify(p)}: the preview is the layout as it was`);
    assert.deepEqual(drag.held, layout.toolbar, "the held panel is where it was");
    assert.deepEqual(ghostsOf(drag), {}, "no ghost");
  }
  const drop = dropOf(drag, { x: 400, y: 500 }, area, 2);
  assert.deepEqual([drop.outcome, drop.layout], ["locked", layout]);
  // A resize by a grip is a drag too.
  const grip = dragTo(beginDrag("log", "resize", { x: 344, y: 190 }, layout, "se", undefined, true), { x: 500, y: 400 }, area, mins);
  assert.deepEqual(grip.preview, layout);
  assert.equal(dropOf(grip, { x: 500, y: 400 }, area, 2).outcome, "locked");
  assert.equal(LOCKED_GUIDE, "panels are locked — unlock in the menu");
  assert.match(stripTip("Log", false, true).off ?? "", /unlock/, "the strip's tooltip says it too");
});

test("a locked layout re-fitted to a new area is named: the panes whose place is not where their docking asked", () => {
  const shown: Layout = { ...layout, log: { ...layout.log, y: 200 } };
  assert.deepEqual(refitted(layout, shown, ["toolbar", "log", "cmd"]), ["log"]);
  assert.deepEqual(refitted(layout, layout, ["toolbar", "log", "cmd"]), []);
  assert.deepEqual(refitted(layout, shown, ["toolbar"]), [], "only the panes asked about — the stored ones");
});

test("see-through content hugs the corner of its pane nearest the area's corner it is in", () => {
  assert.equal(hugOf({ x: 900, y: 500, w: 90, h: 190 }, area), "se");
  assert.equal(hugOf({ x: 8, y: 40, w: 28, h: 300 }, area), "nw");
  assert.equal(hugOf({ x: 800, y: 8, w: 190, h: 200 }, area), "ne");
  assert.equal(hugOf({ x: 8, y: 600, w: 560, h: 90 }, area), "sw");
});
