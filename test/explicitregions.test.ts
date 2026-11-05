// A feature's region is explicit: its outline and the holes the user
// confirmed (docs/plans/explicit-regions.md). The owner, on how a later hole
// joins an extrude: *"there should be some kind of relationship between the
// loops > region > extrude"*, and then *"I don't think coplanarity should be
// used as an automatic basis for deciding which entities to include in a
// region."*
//
// So these hold regeneration to adding no loop the record does not name and
// re-walking each recorded hole by its own members; `hole`/`unhole` to being
// the only way in and out, journalled, saved, replayed, one undo step each;
// a hole's loop going — deleted, flagged construction — to filling the hole
// and never taking the solid; the creating dialog to proposing the loops
// inside and letting a click take one out; the menu to offering what the call
// would take; the edit dialog to typing what it shows; and a file saved by
// the build before all this to opening as the solids it was saved with.

import { test } from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { ensureKernelLoaded } from "../src/kernel/problem.ts";
import { Model, type ExtrudeFeature } from "../src/model.ts";
import { Repl } from "../src/repl.ts";
import { neocadScope } from "../src/replenv.ts";
import { open, save } from "../src/persist.ts";
import { UndoStack } from "../src/undo.ts";
import { del, fillet, hole, regen, unhole } from "../src/operations.ts";
import { featureFaces } from "../src/faces.ts";
import { menuFor } from "../src/menu.ts";
import { ExtrudeTool } from "../src/tools/extrude.ts";
import { EditExtrudeTool, editSteps } from "../src/tools/edit.ts";
import { listTools, type ToolContext } from "../src/tools/tool.ts";
import { screenToPlane, worldToScreen, type View } from "../src/view.ts";
import { featureHost, regionAtFor } from "./featurectx.ts";

async function loadKernel() {
  const bytes = await readFile(new URL("../src/kernel/wasm-gen/neocad_kernel_bg.wasm", import.meta.url));
  await ensureKernelLoaded(bytes);
}

/** Square-on from above, the kernel's +z toward the viewer. */
const ABOVE: View = { ox: 400, oy: 300, scale: 4 };

/**
 * A 40 × 30 plate on a level frame, held as a fillet can work on it (two
 * corners fixed, every edge along an axis) — `l1` bottom, `l2` right, `l3`
 * top, `l4` left — and whatever else `more` types. Built by typed lines, so
 * two built alike are the same model. `name` reads back a variable typed.
 */
async function plate(more: string[] = []): Promise<{ m: Model; repl: Repl; log: string[]; name: (v: string) => Promise<string> }> {
  await loadKernel();
  const m = new Model(3);
  const log: string[] = [];
  const repl = new Repl(neocadScope({ model: m, view: ABOVE, log: (l) => log.push(l) }));
  for (const line of [
    "setDefaultFrame(frame(pt(0, 0, 0), pt(1, 0, 0), pt(0, 1, 0)))",
    "a = pt(0, 0, 0); b = pt(40, 0, 0); c = pt(40, 30, 0); d = pt(0, 30, 0)",
    "l1 = ln(a, b); l2 = ln(b, c); l3 = ln(c, d); l4 = ln(d, a)",
    "fix(a, [0, 0, 0]); fix(c, [40, 30, 0]); par(l1, xaxis()); par(l2, yaxis()); par(l3, xaxis()); par(l4, yaxis())",
    ...more,
  ]) {
    const r = await repl.eval(line);
    assert.equal(r.ok, true, `${line}: ${r.error?.message}`);
  }
  assert.equal(m.solve().solved, true);
  return { m, repl, log, name: async (v) => (await repl.eval(v)).value as string };
}

/** A circle of radius `r` at (x, y) on the plate, centre and size held. */
const circle = (v: string, x: number, y: number, r: number) =>
  `${v} = circ(pt(${x}, ${y}, 0), ${r}); fix(model.circle(${v}).center, [${x}, ${y}, 0]); rad(${v}, ${r})`;

/** A square hole of lines from (x, y), side `s`: its lines are `${v}[0..3]`, so it has corners and walls. */
const square = (v: string, x: number, y: number, s: number) =>
  `${v}p = [pt(${x}, ${y}, 0), pt(${x + s}, ${y}, 0), pt(${x + s}, ${y + s}, 0), pt(${x}, ${y + s}, 0)]; `
  + `${v} = [0, 1, 2, 3].map((i) => ln(${v}p[i], ${v}p[(i + 1) % 4])); `
  + `${v}p.forEach((p, i) => fix(p, [[${x}, ${y}], [${x + s}, ${y}], [${x + s}, ${y + s}], [${x}, ${y + s}]][i].concat(0)))`;

const loopsOf = (m: Model, e = "e1") => m.featureOf(e).loops;

// --- regeneration adds nothing ---------------------------------------------------

// The behaviour this replaces, inverted. It was: a circle drawn inside an
// extruded outline became a hole the next time anything regenerated the
// extrude, because it was coplanar and inside. The owner: "I don't think
// coplanarity should be used as an automatic basis for deciding which
// entities to include in a region."
test("regen with a loop drawn inside since the extrude leaves it out — the record is the membership", async () => {
  const { m, name } = await plate([circle("h1", 10, 15, 4), "extrude(l1, 12)", circle("h2", 28, 15, 3)]);
  const [h1, h2] = [await name("h1"), await name("h2")];
  assert.deepEqual(loopsOf(m).slice(1), [[h1]], "built with the circle inside it then");
  const twins = m.featureOf("e1").twins.flat();
  regen(m, "e1");
  assert.deepEqual(loopsOf(m).slice(1), [[h1]], `${h2} is inside and coplanar, and not part of the region`);
  assert.deepEqual(m.featureOf("e1").twins.flat(), twins, "nothing made for it");
  assert.deepEqual(m.journal.at(-1), { op: "regen", args: ["e1", [["e1", loopsOf(m)]]] });
});

test("a fillet on an outline corner keeps the recorded holes and adds none", async () => {
  const { m, name } = await plate([circle("h1", 10, 15, 4), "extrude(l1, 12)", circle("h2", 28, 15, 3)]);
  const [h1, l1, l2] = [await name("h1"), await name("l1"), await name("l2")];
  const twin = m.featureOf("e1").twins[1][0];
  fillet(m, l1, l2, 5);
  assert.equal(m.solve().solved, true);
  const f = m.featureOf("e1", "extrude");
  assert.equal(f.loops[0].length, 5, "the outline rounded");
  assert.deepEqual(f.loops.slice(1), [[h1]], "the hole kept, the circle drawn since left out");
  assert.equal(f.twins[1][0], twin, "the hole's twin is the one it had");
});

test("a recorded hole whose loop has gone is filled by regen, and the command line says so", async () => {
  const { m, repl, log } = await plate([square("s", 20, 10, 8), "extrude(l1, 12)"]);
  const s = (await repl.eval("s")).value as string[];
  assert.deepEqual(loopsOf(m).slice(1).map((l) => [...l].sort()), [[...s].sort()]);
  const walls = (m.featureOf("e1") as ExtrudeFeature).walls.length;
  // One side's end re-pointed off the corner: the square no longer closes.
  const loose = (await repl.eval("pt(50, 50, 0)")).value as string;
  m.retargetLine(s[1], m.line(s[1]).refs[1], loose);
  const r = await repl.eval('regen("e1")');
  assert.equal(r.ok, true, `${r.error?.message}`);
  assert.equal(r.value, "e1", "regen still returns the feature");
  assert.deepEqual(loopsOf(m), [loopsOf(m)[0]], "filled");
  assert.equal((m.featureOf("e1") as ExtrudeFeature).walls.length, walls - 4, "its four walls gone with it");
  assert.ok(log.includes(`e1: hole ${s[0]}–${s[3]} is gone, filled`), `said: ${log.join(" | ")}`);
});

// --- hole and unhole -------------------------------------------------------------

test("hole adds the loop a member is in, unhole takes it out — each one entry, journalled with what it rebuilt, and the solid follows", async () => {
  const { m, name } = await plate(["extrude(l1, 12)", circle("h", 20, 15, 5)]);
  const h = await name("h");
  const outline = loopsOf(m)[0];
  const n = m.journal.length;
  assert.equal(hole(m, "e1", h), "e1");
  assert.deepEqual(loopsOf(m), [outline, [h]]);
  assert.equal(m.journal.length, n + 1);
  assert.deepEqual(m.journal.at(-1), { op: "hole", args: ["e1", h, [["e1", [outline, [h]]]]] });
  assert.equal(m.solve().solved, true);
  const f = m.featureOf("e1", "extrude");
  const tw = m.circle(f.twins[1][0]);
  assert.ok(Math.abs(m.coords(tw.center)[2] - 12) < 1e-9 && Math.abs(m.radius(tw.name) - 5) < 1e-9, "a twin rim on the lid");
  const lid = featureFaces(m, f, ABOVE.scale).find((x) => x.kind === "lid")!;
  assert.equal(lid.outlines.length, 2, "the lid carries the hole");

  assert.equal(unhole(m, "e1", h), "e1");
  assert.deepEqual(loopsOf(m), [outline]);
  assert.ok(!m.entities.has(tw.name), "the rim went");
  assert.deepEqual(m.journal.at(-1), { op: "unhole", args: ["e1", h, [["e1", [outline]]]] });
});

test("hole and unhole round-trip save and open, replay byte for byte, and are one undo step each", async () => {
  const { m, repl, name } = await plate(["extrude(l1, 12)", circle("h", 20, 15, 5)]);
  const h = await name("h");
  const stack = new UndoStack<string>();
  stack.push(save(m));
  assert.equal((await repl.eval(`hole("e1", "${h}")`)).ok, true);
  const holed = save(m);
  const back = open(holed);
  assert.deepEqual(back.featureOf("e1").loops, loopsOf(m), "the file has the hole");
  assert.equal(save(back), holed, "byte for byte");
  stack.push(holed);
  assert.equal((await repl.eval(`unhole("e1", "${h}")`)).ok, true);
  const filled = save(m);
  assert.equal(open(filled).featureOf("e1").loops.length, 1);
  assert.equal(save(open(filled)), filled, "byte for byte");
  const undone = stack.undo(filled)!;
  assert.equal(open(undone).featureOf("e1").loops.length, 2, "one undo puts the hole back");
  assert.equal(open(stack.undo(undone)!).featureOf("e1").loops.length, 1, "a second takes it away");
});

test("an island: hole on a circle inside a hole puts solid back inside it, by even-odd; unhole of the hole takes the island too", async () => {
  const { m, name } = await plate([circle("h", 20, 15, 8), "extrude(l1, 12)", circle("i", 20, 15, 3)]);
  const [h, i] = [await name("h"), await name("i")];
  hole(m, "e1", i);
  assert.deepEqual(loopsOf(m).slice(1), [[h], [i]]);
  unhole(m, "e1", h);
  assert.deepEqual(loopsOf(m).slice(1), [], "the island had no hole to be an island in");
});

test("every refusal says what would work, and changes nothing", async () => {
  const { m, repl, name } = await plate([
    circle("h", 10, 15, 4), "extrude(l1, 12)",
    circle("out", 70, 15, 4),
    "loose = ln(pt(20, 5, 0), pt(25, 5, 0))",
    "up = frame(pt(0, 0, 0), pt(1, 0, 0), pt(0, 0, 1)); tall = circ(pt(20, 0, 5), 2, up)",
    circle("ok", 28, 15, 3),
  ]);
  const [h, out, loose, tall, ok] = await Promise.all(["h", "out", "loose", "tall", "ok"].map(name));
  const l2 = await name("l2");
  const n = m.journal.length;
  const refuses = (call: () => unknown, re: RegExp) => assert.throws(call, re);
  refuses(() => hole(m, "e1", out), new RegExp(`^Error: ${out} is not inside e1's outline l1–l4 — move it in, or extrude it on its own$`));
  refuses(() => hole(m, "e1", h), new RegExp(`^Error: ${h} is already a hole of e1$`));
  refuses(() => hole(m, "e1", loose), new RegExp(`^Error: ${loose} is in no closed loop — loops\\(\\) lists`));
  refuses(() => hole(m, "e1", l2), new RegExp(`^Error: ${l2} is part of e1's outline l1–l4 — a hole is a loop inside it$`));
  refuses(() => hole(m, "e1", tall), new RegExp(`^Error: ${tall}'s loop is not parallel to e1's sketch frame f1`));
  refuses(() => hole(m, "e1", "p1"), /is not a line, arc, circle or ellipse/);
  refuses(() => hole(m, "e9", ok), /"e9" is not a feature — hole takes a feature's name/);
  refuses(() => unhole(m, "e1", ok), new RegExp(`^Error: "${ok}" is not a hole of e1 — its hole is ${h}$`));
  assert.equal(m.journal.length, n, "nothing journalled");
  assert.deepEqual(loopsOf(m).slice(1), [[h]]);
  // Typed, the same words, and the line still says it.
  const r = await repl.eval(`hole("e1", "${out}")`);
  assert.equal(r.ok, false);
  assert.match(r.error!.message, /move it in, or extrude it on its own/);
  unhole(m, "e1", h);
  refuses(() => unhole(m, "e1", h), new RegExp(`is not a hole of e1 — e1 has no holes$`));
});

test("revolve takes a hole the same way: turned, it is a tunnel round the axis", async () => {
  const { m, name } = await plate([
    "q = [pt(60, 0, 0), pt(80, 0, 0), pt(80, 20, 0), pt(60, 20, 0)]",
    "m1 = ln(q[0], q[1]); m2 = ln(q[1], q[2]); m3 = ln(q[2], q[3]); m4 = ln(q[3], q[0])",
    "q.forEach((p, i) => fix(p, [[60, 0], [80, 0], [80, 20], [60, 20]][i].concat(0)))",
    "ax = ln(pt(50, -10, 0), pt(50, 30, 0)); fix(model.line(ax).refs[0], [50, -10, 0]); fix(model.line(ax).refs[1], [50, 30, 0])",
    "revolve(m1, ax, Math.PI)",
    circle("h", 70, 10, 4),
  ]);
  const h = await name("h");
  const r = m.featureOf("e1", "revolve");
  assert.equal(r.loops.length, 1);
  const faces = () => featureFaces(m, m.featureOf("e1"), ABOVE.scale);
  const before = faces().length;
  hole(m, "e1", h);
  assert.equal(m.solve().solved, true);
  const f = m.featureOf("e1", "revolve");
  assert.deepEqual(f.loops.slice(1), [[h]]);
  assert.equal(m.entities.get(f.twins[1][0])?.kind, "circle", "a twin rim on the end face");
  assert.ok(faces().length > before, "the tunnel's surface is drawn");
  assert.equal(open(save(m)).featureOf("e1").loops.length, 2);
});

// --- a hole's loop going -----------------------------------------------------------

test("deleting a hole's circle fills it: the solid survives, its hole's rim goes — journalled as the unhole it is, then the deletion", async () => {
  const { m, name } = await plate([circle("h", 10, 15, 4), "extrude(l1, 12)"]);
  const h = await name("h");
  const rim = m.featureOf("e1").twins[1][0];
  const n = m.journal.length;
  const removed = del(m, h);
  assert.ok(m.features.has("e1"), "the solid survives");
  assert.equal(loopsOf(m).length, 1, "filled");
  assert.ok(removed.includes(h) && removed.includes(rim), `the circle and its rim: ${removed}`);
  assert.equal(m.journal[n].op, "unhole");
  assert.ok(m.journal.slice(n + 1).some((j) => j.op === "deleteEntity" && j.args[0] === h));
  const text = save(m);
  assert.equal(open(text).featureOf("e1").loops.length, 1);
  assert.equal(save(open(text)), text);
});

test("deleting a corner of a square hole fills it, walls and all", async () => {
  const { m, repl } = await plate([square("s", 20, 10, 8), "extrude(l1, 12)"]);
  const sp = (await repl.eval("sp")).value as string[];
  const f0 = m.featureOf("e1") as ExtrudeFeature;
  assert.equal(f0.walls.length, 8);
  del(m, sp[0]);
  assert.ok(m.features.has("e1"));
  const f = m.featureOf("e1") as ExtrudeFeature;
  assert.equal(f.loops.length, 1);
  assert.equal(f.walls.length, 4, "the hole's walls gone");
  assert.ok(f.walls.every((w) => m.entities.has(w)));
  assert.equal(m.solve().solved, true);
});

test("deleting an outline member still takes the record, as it always did", async () => {
  const { m, name } = await plate([circle("h", 10, 15, 4), "extrude(l1, 12)"]);
  del(m, await name("l2"));
  assert.equal(m.features.size, 0);
});

// --- a file from before ------------------------------------------------------------

// Written by the build before this change (ff72571), typing: the plate; a
// circle h1 inside; extrude(l1, 12); a circle h2 inside; fillet(l1, l2, 5);
// a circle h3 inside; regen("e1"); then a square off to the side with a circle
// in it, revolved half a turn about a line beside it. That build took h2 in
// as a hole when the fillet regenerated e1, and h3 when regen did — which
// this build would not, but a file never re-finds a profile: its entries
// carry the loops they were built with.
test("a file saved before this change opens to the same solids, and regenerates to them — no format bump", async () => {
  await loadKernel();
  const text = await readFile(new URL("./fixtures/pre-explicit-regions.neocad.json", import.meta.url), "utf8");
  assert.equal(JSON.parse(text).version, 11);
  const m = open(text, 3);
  assert.deepEqual(m.featureOf("e1").loops, [["l1", "a1", "l2", "l3", "l4"], ["c1"], ["c3"], ["c5"]]);
  assert.deepEqual(m.featureOf("e1").twins, [["l5", "a2", "l6", "l7", "l8"], ["c2"], ["c4"], ["c6"]]);
  assert.deepEqual(m.featureOf("e2").loops, [["l14", "l15", "l16", "l17"], ["c7"]]);
  assert.deepEqual(m.featureOf("e2").twins, [["l19", "l20", "l21", "l22"], ["c8"]]);
  assert.equal(save(open(save(m))), save(m), "re-saves stably");
  // Regenerated by this build: the recorded holes, each found by its own members, and nothing else.
  const loops = m.featureOf("e1").loops;
  regen(m, "e1");
  regen(m, "e2");
  assert.deepEqual(m.featureOf("e1").loops, loops);
  assert.deepEqual(m.featureOf("e2").loops, [["l14", "l15", "l16", "l17"], ["c7"]]);
  assert.equal(m.solve().solved, true);
});

// --- the creating dialog ------------------------------------------------------------

test("the creating dialog: a click proposes the hole, a click on the hole takes it out, ✓ types the loops outright", async () => {
  const { m, repl, name } = await plate([circle("h", 20, 15, 5)]);
  const h = await name("h");
  const host = featureHost(m, repl, ABOVE);
  const ctx = {
    model: m, options: { depth: 10 }, requestRender() {}, requestSolve() {}, finish() {},
    regionAt: regionAtFor(m, ABOVE), perform: host.perform,
  } as unknown as ToolContext;
  const t = new ExtrudeTool(ctx);
  const click = (x: number, y: number) => t.onDown({ world: [x, y, 0], screen: worldToScreen(ABOVE, [x, y, 0]) });
  click(4, 4);
  assert.equal(t.picks.size, 1, "the plate, with its hole proposed");
  click(20, 15);
  assert.equal(t.picks.size, 1, "the hole's click is not a second region");
  assert.equal(t.picks.without(0).length, 1, "it took the hole out");
  click(21, 14);
  assert.equal(t.picks.without(0).length, 0, "and back in");
  click(20, 15);
  t.confirm();
  await host.settled();
  assert.deepEqual(host.typed, [`extrude("l1", 10, "f1", ${JSON.stringify([["l1", "l2", "l3", "l4"]])})`]);
  assert.deepEqual(loopsOf(m), [loopsOf(m)[0]], "a solid with no hole");
  assert.ok(m.entities.has(h), "the circle is still there, inside and not a hole");
});

test("the creating dialog: a click on a solid island is still a region of its own", async () => {
  const { m, repl } = await plate([circle("h", 20, 15, 8), circle("i", 20, 15, 3)]);
  const host = featureHost(m, repl, ABOVE);
  const ctx = {
    model: m, options: { depth: 10 }, requestRender() {}, requestSolve() {}, finish() {},
    regionAt: regionAtFor(m, ABOVE), perform: host.perform,
  } as unknown as ToolContext;
  const t = new ExtrudeTool(ctx);
  const click = (x: number, y: number) => t.onDown({ world: [x, y, 0], screen: worldToScreen(ABOVE, [x, y, 0]) });
  click(4, 4);
  click(20, 15); // the island: two loops down, solid
  assert.equal(t.picks.size, 2);
  assert.equal(t.picks.without(0).length, 0);
});

// --- the menu ----------------------------------------------------------------------

test("the menu: Add as hole on a loop inside an outline, Remove hole on a hole, Edit e1 on the solid — each typing its call", async () => {
  const { m, name } = await plate([circle("h", 10, 15, 4), "extrude(l1, 12)", circle("c", 28, 15, 3)]);
  const [h, c, l2] = [await name("h"), await name("c"), await name("l2")];
  const items = (n: string) => menuFor(m, { kind: m.entities.get(n)!.kind, name: n } as never).items
    .filter((i) => /hole|Edit/.test(i.label)).map((i) => [i.label, i.action.do === "run" ? i.action.command : ""]);
  assert.deepEqual(items(c), [["Add as hole to e1", `hole("e1", "${c}")`]]);
  assert.deepEqual(items(h), [["Remove hole from e1", `unhole("e1", "${h}")`], ["Edit e1", 'edit("e1")']]);
  assert.deepEqual(items(l2), [["Edit e1", 'edit("e1")']], "an outline member: no hole item");
  const tw = m.featureOf("e1").twins[0][0];
  assert.deepEqual(items(tw), [["Edit e1", 'edit("e1")']], "a piece the feature made");
});

// --- the edit dialog ----------------------------------------------------------------

test("the edit dialog: toggling the circle in and changing the depth types hole and set as one user action; ✓ with nothing changed closes", async () => {
  const { m, repl, name } = await plate(["extrude(l1, 12)", circle("c", 28, 15, 3)]);
  const c = await name("c");
  const depth = m.featureOf("e1", "extrude").depth;
  assert.ok(!listTools().includes("edit extrude"), "not on the toolbar");
  const host = featureHost(m, repl, ABOVE);
  let finished = 0;
  const ctx = {
    model: m, options: { depth: 12 }, target: "e1", requestRender() {}, requestSolve() {}, finish() { finished++; },
    regionAt: regionAtFor(m, ABOVE), perform: host.perform,
    planeAt: (s: [number, number], plane: { origin: number[]; u: number[]; v: number[] }) => screenToPlane(ABOVE, ...s, plane),
  } as unknown as ToolContext;
  const t = new EditExtrudeTool(ctx);
  t.onArmed?.();
  assert.deepEqual(t.replaces(), ["e1"]);
  t.onDown({ world: [28, 15, 0], screen: worldToScreen(ABOVE, [28, 15, 0]) });
  ctx.options = { depth: 20 };
  t.confirm();
  await host.settled();
  assert.deepEqual(host.typed, [`hole("e1", "${c}")`, `set("${depth}.value", 20)`]);
  assert.equal(host.performs, 1, "one user action");
  assert.deepEqual(loopsOf(m).slice(1), [[c]]);
  assert.equal(m.relationOf(depth).args[1], 20);
  assert.equal(finished, 1, "released");

  // The steps on their own: nothing toggled, the same value — nothing typed.
  assert.deepEqual(editSteps("e1", [], 20).map((s) => s(m)), [null]);
});

test("edit(\"e1\") arms the dialog on the feature with its value; help lists hole, unhole and edit", async () => {
  const { m } = await plate(["extrude(l1, 12)"]);
  const armed: unknown[] = [];
  const repl = new Repl(neocadScope({ model: m, arm: (...a: unknown[]) => { armed.push(a); } }));
  const r = await repl.eval('edit("e1")');
  assert.equal(r.ok, true, `${r.error?.message}`);
  assert.deepEqual(armed, [["edit extrude", { depth: 12 }, "e1"]]);
  assert.equal((await repl.eval('edit("l1")')).ok, false);
  const help = (await repl.eval("help()")).value as string;
  for (const word of ['hole("e1"', "unhole(", 'edit("e1")']) assert.ok(help.includes(word), `help mentions ${word}`);
});
