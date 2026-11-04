// Construction geometry (docs/plans/construction.md). The owner: *"construction
// geometry should be a per entity flag"* — and, on why it must not be a
// group's: *"if it is a group based inherited thing, then geometry could be
// both construction geometry and not construction geometry simultaneously"*.
//
// So these hold the flag to being on the entity: set and cleared by a
// journalled operation that resolves groups and features to their curves at
// the call, saved and reopened byte for byte, gone with the entity, one entry
// per call. And they hold construction geometry to forming no regions — it
// bounds nothing, splits nothing, crosses nothing — while being an ordinary
// entity to everything else: picked and snapped to exactly as before.

import { test } from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { ensureKernelLoaded } from "../src/kernel/problem.ts";
import { Model } from "../src/model.ts";
import { pointOnLine } from "../src/relations/geometry.ts";
import { construction, del, extrude, fillet, regen } from "../src/operations.ts";
import { addTo, group, removeFrom } from "../src/groups.ts";
import { open, save } from "../src/persist.ts";
import { findLoops } from "../src/loops.ts";
import { describePick, hitTest } from "../src/picking.ts";
import { findSnap } from "../src/snapping.ts";
import { menuFor, type Menu } from "../src/menu.ts";
import { Repl } from "../src/repl.ts";
import { neocadScope } from "../src/replenv.ts";
import { UndoStack } from "../src/undo.ts";
import { declaredOptions } from "../src/tools/options.ts";
import { getToolCtor, type ToolContext } from "../src/tools/tool.ts";
import { CircleTool } from "../src/tools/circle.ts";
import { RectangleTool } from "../src/tools/rectangle.ts";
import "../src/tools/line.ts";
import "../src/tools/arc.ts";
import "../src/tools/arc3.ts";
import "../src/tools/circle3.ts";
import { worldToScreen, type View } from "../src/view.ts";
import { axisFrame, tiltedFrame } from "./frames.ts";
import { polygon, ring } from "./profiles.ts";

async function loadKernel() {
  const bytes = await readFile(new URL("../src/kernel/wasm-gen/neocad_kernel_bg.wasm", import.meta.url));
  await ensureKernelLoaded(bytes);
}

/** A 2D rectangle p1..p4 / l1..l4, 40 by 30, and a circle c1 of radius 5 inside it. */
async function sketch() {
  await loadKernel();
  const m = new Model(2);
  axisFrame(m);
  m.addPoint([0, 0], "p1");
  m.addPoint([40, 0], "p2");
  m.addPoint([40, 30], "p3");
  m.addPoint([0, 30], "p4");
  m.addLine("p1", "p2", "l1");
  m.addLine("p2", "p3", "l2");
  m.addLine("p3", "p4", "l3");
  m.addLine("p4", "p1", "l4");
  m.addPoint([20, 15], "p5");
  m.addCircle("p5", 5, null, "c1");
  return m;
}

/** A tilted 3D square with a ring inside it: what an extrude stands on. */
async function solidSketch() {
  await loadKernel();
  const m = new Model(3);
  const t = tiltedFrame(m);
  const { lines } = polygon(m, t, [[0, 0], [40, 0], [40, 30], [0, 30]]);
  const c = ring(m, t, 20, 15, 5);
  return { m, t, lines, c };
}

const last = (m: Model) => m.journal.at(-1);

// --- the flag, and its operation ------------------------------------------------

test("construction sets the flag on the entity, construction(…, false) clears it; each is one journal entry", async () => {
  const m = await sketch();
  assert.equal(m.isConstruction("c1"), false);
  assert.deepEqual(construction(m, "c1"), ["c1"]);
  assert.equal(m.isConstruction("c1"), true);
  assert.equal(m.circle("c1").construction, true, "on the entity itself");
  assert.deepEqual(last(m), { op: "construction", args: ["c1"] });
  const n = m.journal.length;
  assert.deepEqual(construction(m, "c1"), [], "already construction: nothing changes");
  assert.equal(m.journal.length, n, "and nothing is journalled, so it is no undo step");
  assert.deepEqual(construction(m, "c1", false), ["c1"]);
  assert.equal(m.isConstruction("c1"), false);
  assert.equal("construction" in m.circle("c1"), false, "cleared is absent, the same object as never flagged");
  assert.deepEqual(last(m), { op: "construction", args: ["c1", false] });
  assert.deepEqual(construction(m, "l1", "l2", true), ["l1", "l2"], "an explicit true is the same as none");
});

test("points, frames and relations among the names are passed over; a call naming no curve is refused", async () => {
  const m = await sketch();
  assert.deepEqual(construction(m, "p1", "l1", "p2"), ["l1"]);
  assert.deepEqual(last(m), { op: "construction", args: ["l1"] }, "the journal names only what it flagged");
  assert.throws(() => construction(m, "p1"), /"p1" has no line, arc or circle in it — only they bound regions/);
  assert.throws(() => construction(m, "f"), /only they bound regions/, "a frame bounds nothing");
  assert.throws(() => construction(m), /construction needs a name/);
  assert.throws(() => construction(m, "nope"), /"nope" is not an entity/);
  assert.throws(() => construction(m, 3), /construction takes names, then true or false/);
  assert.throws(() => m.setConstruction("p1", true), /"p1" is not a line, arc or circle/, "the primitive refuses too");
});

test("a group expands to its members at the call, and later membership changes never alter a flag", async () => {
  const m = await sketch();
  group(m, "l1", "l2", "p1");
  assert.deepEqual(construction(m, "g1"), ["l1", "l2"]);
  assert.deepEqual(last(m), { op: "construction", args: ["l1", "l2"] }, "journalled resolved, not as g1");
  addTo(m, "g1", "l3");
  assert.equal(m.isConstruction("l3"), false, "a member added later is not construction");
  removeFrom(m, "g1", "l1");
  assert.equal(m.isConstruction("l1"), true, "a member taken out stays construction");
  assert.deepEqual(construction(m, "g1", false), ["l2"], "g1 is l2 and l3 now, and only l2 was flagged");
  assert.equal(m.isConstruction("l1"), true);
  assert.ok(!m.groups.has("construction"), "and nothing about it is a group's");
});

test("a feature expands to the curves it made, at the call", async () => {
  const { m, lines } = await solidSketch();
  const e = extrude(m, lines[0], 20);
  const f = m.featureOf(e, "extrude");
  const flagged = construction(m, e);
  const made = [...f.twins.flat(), ...f.walls];
  assert.deepEqual([...flagged].sort(), [...made].sort(), "its twins and walls — never its profile, which it does not own");
  assert.ok(lines.every((l) => !m.isConstruction(l)));
  assert.equal(last(m)!.args.includes(e), false, "journalled as the curves, not the feature's name");
});

test("deleting an entity takes its flag with it; a fillet of two construction legs is construction", async () => {
  const m = await sketch();
  construction(m, "l1", "l2");
  const arc = fillet(m, "l1", "l2", 4);
  assert.equal(m.isConstruction(arc), true, "both legs were construction, so the rounding is");
  construction(m, "l3");
  const real = fillet(m, "l3", "l4", 4);
  assert.equal(m.isConstruction(real), false, "one real leg: the arc is real");
  const reopened = open(save(m));
  assert.equal(reopened.isConstruction(arc), true, "replayed, the fillet makes the same construction arc");
  del(m, "c1");
  assert.equal(m.isConstruction("c1"), false);
  assert.equal(open(save(m)).entities.has("c1"), false);
});

// --- saving and undo --------------------------------------------------------------

test("construction in the history saves and reopens byte for byte, flags and all", async () => {
  const m = await sketch();
  group(m, "l1", "l3");
  construction(m, "g1");
  construction(m, "c1");
  construction(m, "l3", false);
  m.solve();
  const once = save(m);
  const reopened = open(once);
  for (const n of ["l1", "l2", "l3", "l4", "c1"]) assert.equal(reopened.isConstruction(n), m.isConstruction(n), n);
  assert.equal(save(reopened), once, "byte for byte");
  assert.equal(save(open(save(reopened))), once, "and again");
});

test("one undo step each: the snapshot before a construction call reopens without it", async () => {
  const m = await sketch();
  const stack = new UndoStack<string>();
  stack.push(save(m));
  construction(m, "c1");
  const after = save(m);
  const back = stack.undo(after);
  assert.ok(back !== undefined);
  assert.equal(open(back).isConstruction("c1"), false, "undone");
  const again = stack.redo(back);
  assert.ok(again !== undefined);
  assert.equal(open(again).isConstruction("c1"), true, "redone");
});

// --- loops ignore it ---------------------------------------------------------------

test("a construction circle inside a rectangle leaves one region, with no hole", async () => {
  const m = await sketch();
  const before = findLoops(m);
  assert.equal(before.length, 2, "the rectangle and the circle");
  assert.equal(before[0].children.length, 1, "the circle is a hole in the rectangle");
  construction(m, "c1");
  const loops = findLoops(m);
  assert.equal(loops.length, 1);
  assert.deepEqual(loops[0].members.map((x) => x.name).sort(), ["l1", "l2", "l3", "l4"]);
  assert.deepEqual(loops[0].children, [], "no hole");
  construction(m, "c1", false);
  assert.equal(findLoops(m).length, 2, "cleared, it bounds again");
});

test("a construction line across a rectangle leaves one region, uncut: it splits nothing and crosses nothing", async () => {
  const m = await sketch();
  del(m, "c1");
  // Ends held on the rectangle's sides — a T at each — and crossing nothing else.
  m.addPoint([20, 0], "q1");
  m.addPoint([20, 30], "q2");
  m.addLine("q1", "q2", "l9");
  pointOnLine(m, "q1", "l1");
  pointOnLine(m, "q2", "l3");
  assert.equal(findLoops(m).length, 2, "real, it splits the rectangle in two");
  construction(m, "l9");
  const loops = findLoops(m);
  assert.equal(loops.length, 1);
  assert.ok(loops[0].members.every((x) => x.span === null), "every side whole: a point held on it cuts nothing there");
  // And a free construction line straight across, crossing two sides in their interiors.
  m.addPoint([-10, 10], "q3");
  m.addPoint([50, 20], "q4");
  m.addLine("q3", "q4", "l10");
  assert.ok(findLoops(m).length > 1, "real, crossing it splits the rectangle");
  construction(m, "l10");
  const crossed = findLoops(m);
  assert.equal(crossed.length, 1, "construction, there is no crossing");
  assert.ok(crossed[0].members.every((x) => x.span === null));
});

test("a construction outline is no loop at all; in 3D on a tilted plane as in 2D", async () => {
  const { m, lines, c } = await solidSketch();
  assert.equal(findLoops(m).length, 2);
  construction(m, c);
  assert.equal(findLoops(m).length, 1);
  assert.deepEqual(findLoops(m)[0].children, []);
  construction(m, ...lines);
  assert.equal(findLoops(m).length, 0, "nothing real is closed");
});

// --- features ----------------------------------------------------------------------

test("a feature's profile member is refused by name, before anything changes", async () => {
  const { m, lines, c } = await solidSketch();
  const e = extrude(m, lines[0], 20);
  assert.equal(m.featureOf(e).loops.length, 2, "the ring is a hole");
  const n = m.journal.length;
  assert.throws(() => construction(m, lines[1]), new RegExp(`"${lines[1]}" is part of ${e}'s profile — a solid's profile cannot stop being a boundary`));
  assert.throws(() => construction(m, c), new RegExp(`is part of ${e}'s profile`), "a hole's member too");
  group(m, lines[2], c);
  assert.throws(() => construction(m, "g1"), /is part of e1's profile/);
  assert.equal(m.journal.length, n + 1, "only the group went in");
  assert.ok([...lines, c].every((x) => !m.isConstruction(x)), "and nothing was flagged");
});

test("extrude refuses a construction member by name, typed or with its loops given", async () => {
  const { m, lines, c } = await solidSketch();
  construction(m, ...lines);
  assert.throws(() => extrude(m, lines[0], 20), new RegExp(`"${lines[0]}" is construction geometry, which bounds no region — construction\\("${lines[0]}", false\\)`));
  construction(m, ...lines, false);
  construction(m, c);
  assert.throws(() => extrude(m, lines[0], 20, "t", [lines, [c]]), new RegExp(`"${c}" is construction geometry`),
    "a profile handed over whole is told what findLoops would leave out");
});

test("extruded over a construction circle there is no hole; cleared, regen brings the hole", async () => {
  const { m, lines, c } = await solidSketch();
  construction(m, c);
  const e = extrude(m, lines[0], 20);
  assert.equal(m.featureOf(e).loops.length, 1, "no hole");
  construction(m, c, false);
  assert.equal(m.featureOf(e).loops.length, 1, "clearing it changes no solid by itself (until features follow their regions)");
  regen(m, e);
  assert.equal(m.featureOf(e).loops.length, 2, "regen finds the hole");
  const reopened = open(save(m));
  assert.equal(reopened.featureOf(e).loops.length, 2, "and the file agrees");
});

// --- the rest of the app treats it as any entity -----------------------------------

/** Zoomed in enough that the circle's rim is clear of its centre's pick radius. */
const VIEW: View = { ox: 0, oy: 0, scale: 4 };

test("picking and snapping are unchanged by the flag", async () => {
  const m = await sketch();
  const probes: [number, number][] = [[20, 0], [40, 0], [25, 15], [20, 20], [0, 15], [30, 30]];
  const read = () => probes.map((w) => {
    const [sx, sy] = worldToScreen(VIEW, w);
    const s = findSnap(m, VIEW, sx, sy);
    return { pick: hitTest(m, VIEW, sx, sy)?.name ?? null, snap: s ? `${s.kind} ${s.targets.join(",")}` : null };
  });
  const before = read();
  assert.ok(before.some((r) => r.pick === "c1"), "the circle is under one of the probes");
  construction(m, "c1", "l1", "l2", "l3", "l4");
  assert.deepEqual(read(), before);
});

test("the hover tag says construction, right after what the thing is", async () => {
  const m = await sketch();
  construction(m, "c1");
  const tag = describePick(m, { name: "c1", kind: "circle", distance: 0 });
  assert.match(tag, /^c1 {2}r 5 {2}construction$/);
  assert.doesNotMatch(describePick(m, { name: "l1", kind: "line", distance: 0 }), /construction/);
});

const labels = (menu: Menu) => menu.items.map((i) => i.label);
const command = (menu: Menu, label: string) => {
  const a = menu.items.find((i) => i.label === label)?.action;
  return a?.do === "run" ? a.command : null;
};

test("the menu: Construction or Not construction on a curve, and over a selection's curves", async () => {
  const m = await sketch();
  const circle = menuFor(m, { name: "c1", kind: "circle", distance: 0 });
  assert.equal(command(circle, "Construction"), 'construction("c1")');
  assert.ok(!labels(circle).includes("Not construction"));
  construction(m, "c1");
  const flagged = menuFor(m, { name: "c1", kind: "circle", distance: 0 });
  assert.equal(command(flagged, "Not construction"), 'construction("c1", false)');
  assert.ok(!labels(flagged).includes("Construction"));
  assert.ok(!labels(menuFor(m, { name: "p1", kind: "point", distance: 0 })).some((l) => /onstruction/.test(l)),
    "a point has no flag to offer");

  const sel = ["l1", "p1", "c1"];
  const on = menuFor(m, { name: "l1", kind: "line", distance: 0 }, null, null, null, sel);
  assert.equal(command(on, "Construction"), 'construction("l1", "c1")', "the curves only — the corner would be passed over");
  assert.equal(command(on, "Not construction"), 'construction("l1", "c1", false)', "a mix offers both");
  const single = menuFor(m, { name: "l2", kind: "line", distance: 0 }, null, null, null, ["l2"]);
  assert.equal(labels(single).filter((l) => l === "Construction").length, 1, "the one selected: offered once");
});

test("the command surface: the log says what was passed over, ls() marks it, help() explains it", async () => {
  const m = await sketch();
  const said: string[] = [];
  const repl = new Repl(neocadScope({ model: m, log: (line) => { said.push(line); } }));
  const run = async (src: string) => {
    const r = await repl.eval(src);
    assert.equal(r.ok, true, `${src}: ${r.error?.message}`);
    return r.value;
  };
  assert.deepEqual(await run('construction("l1", "p1")'), ["l1"]);
  assert.match(said.at(-1)!, /^p1 passed over — only lines, arcs and circles bound regions/);
  const ls = (await run("ls()")) as string[];
  assert.ok(ls.some((l) => l.startsWith("l1") && l.endsWith("(construction)")), ls.join("\n"));
  assert.ok(!ls.some((l) => l.startsWith("l2") && l.includes("construction")));
  assert.deepEqual(await run('construction("l1", false)'), ["l1"]);
  assert.match((await run("help()")) as string, /construction\(\.\.\.names, false\)/);
  const bad = await repl.eval('construction("p1")');
  assert.equal(bad.ok, false);
});

// --- the drawing tools' option -----------------------------------------------------

function fakeCtx(model: Model, options: Record<string, unknown>): ToolContext {
  return { model, options, requestRender() {}, requestSolve() { model.solve(); }, finish() {} };
}

test("every drawing tool declares a construction option, false unless asked", () => {
  for (const tool of ["line", "rectangle", "circle", "circle3", "arc", "arc3"]) {
    assert.deepEqual(declaredOptions(getToolCtor(tool), tool), { construction: { default: false } }, tool);
  }
  assert.deepEqual(declaredOptions(getToolCtor("point")), {}, "a point takes no flag, so its tool has no option");
});

test("a circle drawn with { construction: true } is construction from the start, in the same gesture", async () => {
  await loadKernel();
  const m = new Model(2);
  const tool = new CircleTool(fakeCtx(m, { construction: true }));
  tool.onDown({ world: [0, 0], screen: [0, 0] });
  tool.onUp({ world: [10, 0], screen: [10, 0] });
  const circle = [...m.entities.values()].find((e) => e.kind === "circle")!;
  assert.equal(m.isConstruction(circle.name), true);
  assert.deepEqual(last(m), { op: "construction", args: [circle.name] }, "journalled straight after the shape");
  assert.equal(findLoops(m).length, 0);

  const plain = new CircleTool(fakeCtx(m, { construction: false }));
  plain.onDown({ world: [50, 0], screen: [0, 0] });
  plain.onUp({ world: [60, 0], screen: [10, 0] });
  assert.equal(findLoops(m).length, 1, "drawn without it, the next circle is a region");

  const rect = new RectangleTool(fakeCtx(m, { construction: true }));
  rect.onDown({ world: [100, 0], screen: [0, 0] });
  rect.onUp({ world: [140, 30], screen: [40, 30] });
  const lines = [...m.entities.values()].filter((e) => e.kind === "line");
  assert.equal(lines.length, 4);
  assert.ok(lines.every((l) => m.isConstruction(l.name)), "all four sides");
  assert.equal(findLoops(m).length, 1, "still only the plain circle");
});
