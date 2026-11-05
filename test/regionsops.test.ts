// Regions as operations (docs/plans/regions-as-operations.md). The owner:
// *"rather than auto detecting regions + things inside that region which then
// get subtracted automatically, there should be explicit specification of
// positive region and negative region"* — and then, correcting himself:
// *"there should be no such thing as a negative face. a face is just a face.
// just like there should be no such thing as a negative solid, only an
// operation which subtracts one solid from another"*.
//
// So these hold a region to being its chain — region, subtract, add,
// intersect, each journalled, replayed and one undo step — with an area that
// is the faces' as loops.ts measures them; a feature to standing on a region
// and following it when it is edited, several features to one region; an old
// file's holes to opening as regions with the model unchanged (the fixture
// oracle: the same file replayed without the translation); hole and unhole to
// being aliases; a deleted face to being lost by the region (the decision);
// and the region tool to typing what a user could have.

import { test } from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { ensureKernelLoaded } from "../src/kernel/problem.ts";
import { Model, memberName } from "../src/model.ts";
import { Repl } from "../src/repl.ts";
import { neocadScope } from "../src/replenv.ts";
import { fromSaved, open, save, type SavedModel } from "../src/persist.ts";
import { UndoStack } from "../src/undo.ts";
import {
  add, del, extrude, hole, intersect, region, regionArea, regionAtPoint, regionProfile, regionText, revolve, subtract, unhole,
} from "../src/operations.ts";
import { findLoops } from "../src/loops.ts";
import { featureFaces } from "../src/faces.ts";
import { organiserSections, rowMenu } from "../src/organiser.ts";
import { RegionTool } from "../src/tools/regiontool.ts";
import type { ToolContext } from "../src/tools/tool.ts";
import { worldToScreen, type View } from "../src/view.ts";
import { regionAtFor } from "./featurectx.ts";
import { axisFrame } from "./frames.ts";
import "../src/modules/builtin.ts";

async function loadKernel() {
  const bytes = await readFile(new URL("../src/kernel/wasm-gen/neocad_kernel_bg.wasm", import.meta.url));
  await ensureKernelLoaded(bytes);
}

const ABOVE: View = { ox: 400, oy: 300, scale: 4 };
const close = (a: number, b: number, tol = 1e-6) => Math.abs(a - b) <= tol * Math.max(1, Math.abs(b));

/**
 * A 60 × 50 plate on the level frame `f`, a ring of radius 15 in it, an island
 * of radius 5 in the ring, and a square off to the side — every one a loop,
 * none a hole until an operation says so.
 */
function sheet() {
  const m = new Model(3);
  axisFrame(m);
  const box = (pts: number[][]) => {
    const ps = pts.map((c) => m.addPoint(c).name);
    return ps.map((p, i) => m.addLine(p, ps[(i + 1) % ps.length]).name);
  };
  const lines = box([[0, 0, 0], [60, 0, 0], [60, 50, 0], [0, 50, 0]]);
  const c = m.addPoint([30, 25, 0]).name;
  const ring = m.addCircle(c, 15, "f").name;
  const island = m.addCircle(c, 5, "f").name;
  const side = box([[80, 0, 0], [100, 0, 0], [100, 20, 0], [80, 20, 0]]);
  return { m, lines, ring, island, side };
}

/** The area findLoops gives the loop `member` is in, in `m`'s base plane. */
const loopArea = (m: Model, member: string) =>
  Math.abs(findLoops(m).find((l) => l.members.some((x) => x.name === member) && Math.abs(l.plane.origin[2]) < 1e-9)!.area);

// --- the chain -----------------------------------------------------------------------

test("a region is its chain: region, then subtract, add, intersect — each one journal entry with its face resolved, rg-named", async () => {
  await loadKernel();
  const { m, lines, ring, island } = sheet();
  const n = m.journal.length;
  const r = region(m, lines[0]);
  assert.equal(r, "rg1", "rg, not r: r1 is a relation's name, f1 a frame's");
  subtract(m, r, ring);
  add(m, r, island);
  assert.equal(regionText(m, r), `rg1 = ${lines[0]}–${lines[3]} − ${ring} + ${island}`);
  assert.deepEqual(m.journal.slice(n), [
    { op: "region", args: [lines[0], "f", lines] },
    { op: "subtract", args: [r, ring, [ring], []] },
    { op: "add", args: [r, island, [island], []] },
  ]);
  assert.deepEqual(m.regionEntry(r).steps.map((s) => s.op), ["region", "subtract", "add"]);
  // Replayed from the journal, nothing found: the same chain.
  const back = open(save(m));
  assert.equal(regionText(back, r), regionText(m, r));
  assert.equal(save(back), save(m), "byte for byte");
});

test("subtract, add and intersect by area, against loops.ts's own areas", async () => {
  await loadKernel();
  const { m, lines, ring, island, side } = sheet();
  const [plate, R, I] = [loopArea(m, lines[0]), loopArea(m, ring), loopArea(m, island)];
  assert.ok(close(plate, 3000) && close(R, Math.PI * 225, 1e-9) && close(I, Math.PI * 25, 1e-9));
  const r = region(m, lines[0]);
  assert.ok(close(regionArea(m, r), plate), "a face is its loop's whole inside: the circles inside are part of it");
  subtract(m, r, ring);
  assert.ok(close(regionArea(m, r), plate - R), "the ring taken out, its island with it");
  add(m, r, island);
  assert.ok(close(regionArea(m, r), plate - R + I), "the island put back");
  intersect(m, r, ring);
  assert.ok(close(regionArea(m, r), I), "what the region and the ring's face share: the island");
  // A second region beside: a face of the square, then the plate added to it.
  const s = region(m, side[0]);
  add(m, s, lines[0]);
  assert.ok(close(regionArea(m, s), 400 + plate), "two faces apart, one region of both");
});

test("refusals say why and change nothing: a face outside, one already in, a disjoint intersect, an empty region, another plane", async () => {
  await loadKernel();
  const { m, lines, ring, side } = sheet();
  const whole = region(m, lines[0]);
  assert.throws(() => add(m, whole, ring), /is in rg1 already — adding it changes nothing/, "inside the face: in it already");
  assert.throws(() => intersect(m, whole, lines[1]), /rg1 is inside .* already — intersecting changes nothing/);
  const r = whole;
  subtract(m, r, ring);
  const n = m.journal.length;
  assert.throws(() => subtract(m, r, side[0]), new RegExp(`${side[0]}–${side[3]} is not inside rg1 — subtracting it takes nothing away`));
  assert.throws(() => subtract(m, r, ring), /is not inside rg1 — subtracting it takes nothing away/, "taken out already");
  assert.throws(() => intersect(m, r, side[0]), /rg1 and .* share nothing — intersecting would leave rg1 empty/);
  assert.throws(() => subtract(m, r, lines[2]), /would leave rg1 empty — del\("rg1"\) removes it/);
  assert.throws(() => subtract(m, "rg9", ring), /"rg9" is not a region — regions are named rg1, rg2/);
  assert.throws(() => subtract(m, lines[0], ring), /is a line, not a region/);
  assert.throws(() => region(m, "p1"), /is not a line, arc, circle or ellipse/);
  const up = m.addFrame(m.addPoint([0, 0, 0]).name, m.addPoint([1, 0, 0]).name, m.addPoint([0, 0, 1]).name).name;
  const tall = m.addCircle(m.addPoint([20, 0, 10]).name, 3, up).name;
  assert.throws(() => subtract(m, r, tall), /loop is not in rg1's plane/);
  assert.equal(m.journal.length, n + 6, "only the frame (three points and itself) and the circle (its centre and itself) went in");
  assert.equal(m.regionEntry(r).steps.length, 2);
});

// --- features on a region ----------------------------------------------------------------

test("a feature stands on a region and follows it: subtract regenerates it, journalled with what it rebuilt; a bare face makes its region", async () => {
  await loadKernel();
  const { m, lines, ring, island } = sheet();
  const e = extrude(m, lines[0], 10);
  const f0 = m.featureOf(e);
  assert.equal(f0.region, "rg1", "made on the way");
  assert.deepEqual(f0.loops, [lines], "no hole proposed: the owner's rule");
  subtract(m, "rg1", ring);
  assert.deepEqual(m.featureOf(e).loops, [lines, [ring]], "the region changed, and the solid with it");
  assert.deepEqual(m.journal.at(-1), { op: "subtract", args: ["rg1", ring, [ring], [[e, [lines, [ring]]]]] });
  add(m, "rg1", island);
  assert.deepEqual(m.featureOf(e).loops, [lines, [ring], [island]]);
  assert.equal(m.solve().solved, true);
  const lid = featureFaces(m, m.featureOf(e), ABOVE.scale).find((x) => x.kind === "lid")!;
  assert.equal(lid.outlines.length, 3, "the lid carries the ring and the island, even-odd");
  const reopened = open(save(m));
  assert.deepEqual(reopened.featureOf(e).loops, m.featureOf(e).loops);
  assert.equal(save(reopened), save(m));
});

test("two features on one region: both regenerate when it changes, and revolve takes a region as extrude does", async () => {
  await loadKernel();
  const { m, lines, ring } = sheet();
  const r = region(m, lines[0]);
  const up = extrude(m, r, 10);
  const down = extrude(m, r, -4);
  assert.deepEqual([m.featureOf(up).region, m.featureOf(down).region], [r, r]);
  subtract(m, r, ring);
  assert.deepEqual(m.featureOf(up).loops, [lines, [ring]]);
  assert.deepEqual(m.featureOf(down).loops, [lines, [ring]]);
  const out = m.journal.at(-1)!.args[3] as [string, unknown][];
  assert.deepEqual(out.map(([n]) => n), [up, down], "the entry names both, in the order they were made");
  assert.equal(m.solve().solved, true);
  // A revolve on a region beside the axis.
  const block = [[70, 0, 0], [90, 0, 0], [90, 20, 0], [70, 20, 0]].map((c) => m.addPoint(c).name);
  const edges = block.map((p, i) => m.addLine(p, block[(i + 1) % 4]).name);
  const s = region(m, edges[0]);
  const t = revolve(m, s, "f.y", Math.PI / 2);
  assert.equal(m.featureOf(t).region, s);
  assert.deepEqual(m.journal.at(-1)!.args.slice(0, 2), [s, "f.y"]);
});

test("a face added beside a region merges with it: two halves of a split rectangle are one outline, and extrude one solid", async () => {
  await loadKernel();
  const m = new Model(3);
  axisFrame(m);
  const ps = [[0, 0, 0], [40, 0, 0], [40, 30, 0], [0, 30, 0]].map((c) => m.addPoint(c).name);
  const lines = ps.map((p, i) => m.addLine(p, ps[(i + 1) % 4]).name);
  const across = m.addLine(m.addPoint([15, -5, 0]).name, m.addPoint([15, 35, 0]).name).name;
  assert.equal(findLoops(m).length, 2, "the line splits the rectangle");
  const r = region(m, lines[3]); // the left half: only it has the left side
  assert.ok(close(regionArea(m, r), 15 * 30));
  add(m, r, lines[1]);
  assert.ok(close(regionArea(m, r), 40 * 30), "both halves");
  const p = regionProfile(m, r);
  assert.equal(p.loops.length, 1, "one outline, the edge between the halves cancelled");
  assert.deepEqual(p.loops[0].map(memberName).sort(), [...lines].sort(), "the rectangle's four sides, whole again");
  assert.ok(!p.loops[0].some((x) => memberName(x) === across));
  const e = extrude(m, r, 5);
  assert.equal(m.solve().solved, true);
  assert.deepEqual(m.featureOf(e).loops[0].map(memberName).sort(), [...lines].sort());
});

test("a region of two pieces is refused for a feature, saying what would do — before anything changes", async () => {
  await loadKernel();
  const { m, lines, side } = sheet();
  const r = region(m, side[0]);
  add(m, r, lines[0]);
  const n = m.journal.length;
  assert.throws(() => extrude(m, r, 10), /rg1 is 2 separate pieces — .* make a region of each piece, or add the face that joins them/);
  assert.equal(m.journal.length, n);
  assert.equal(m.features.size, 0);
});

// --- hole and unhole, aliases ----------------------------------------------------------

test("hole and unhole are aliases: the region step that gives the loop its meaning, journalled as that step", async () => {
  await loadKernel();
  const { m, lines, ring, island } = sheet();
  const e = extrude(m, lines[0], 10);
  hole(m, e, ring);
  assert.deepEqual(m.journal.at(-1)!.op, "subtract");
  hole(m, e, island);
  assert.deepEqual(m.journal.at(-1)!.op, "add", "an island inside a hole is put back: even-odd, as hole always meant");
  assert.equal(regionText(m, "rg1"), `rg1 = ${lines[0]}–${lines[3]} − ${ring} + ${island}`);
  unhole(m, e, ring);
  assert.deepEqual(m.journal.at(-1)!.op, "add", "filled — its island with it");
  assert.deepEqual(m.featureOf(e).loops, [lines]);
  // Typed, the same; and help says they are aliases.
  const repl = new Repl(neocadScope({ model: m }));
  assert.equal((await repl.eval(`hole("e1", "${ring}")`)).ok, true);
  assert.deepEqual(m.featureOf(e).loops, [lines, [ring]]);
  const help = (await repl.eval("help()")).value as string;
  assert.match(help, /hole\("e1", "c1"\) and unhole\("e1", "c1"\) are aliases now/);
  assert.match(help, /region\("l1"\) — rg1/);
});

test("a version-16 file's hole and unhole open as the region steps they meant, the model unchanged", async () => {
  await loadKernel();
  // Built today, then written back the way format 16 wrote it: no region
  // entries, the extrude on its member, hole/unhole by the feature.
  const { m, lines, ring } = sheet();
  const e = extrude(m, lines[0], 10);
  hole(m, e, ring);
  unhole(m, e, ring);
  hole(m, e, ring);
  m.solve();
  const today = JSON.parse(save(m)) as SavedModel;
  const old: SavedModel = { ...today, version: 16, journal: [] };
  for (const j of today.journal) {
    if (j.op === "region") continue;
    if (j.op === "extrude") old.journal.push({ op: "extrude", args: [lines[0], ...j.args.slice(1)] });
    else if (j.op === "subtract") old.journal.push({ op: "hole", args: [e, j.args[1], j.args[3]] });
    else if (j.op === "add") old.journal.push({ op: "unhole", args: [e, j.args[1], j.args[3]] });
    else old.journal.push(j);
  }
  const opened = open(JSON.stringify(old));
  assert.deepEqual(opened.journal.filter((j) => ["region", "subtract", "add", "extrude"].includes(j.op)).map((j) => j.op),
    ["region", "extrude", "subtract", "add", "subtract"]);
  assert.equal(regionText(opened, "rg1"), regionText(m, "rg1"));
  assert.deepEqual(opened.featureOf(e), m.featureOf(e));
  assert.equal(save(opened), save(m), "the same file, once opened: today's vocabulary, byte for byte");
});

// --- the fixture oracle ----------------------------------------------------------------

/** What a model is, region records aside: every entity, relation and feature record, and every point where it is. */
function snapshot(m: Model) {
  const features = [...m.features.values()].map((f) => {
    const { region: _region, ...rest } = f;
    return rest;
  });
  return {
    entities: [...m.entities.values()].map((e) => [e.name, e.kind]),
    relations: [...m.relations.values()].map((r) => [r.name, r.op, JSON.stringify(r.args)]),
    features,
    points: [...m.entities.values()].filter((e) => e.kind === "point").map((e) => [e.name, m.coords(e.name).map((c) => c.toFixed(9))]),
  };
}

// Every journal fixture with a feature in it, its holes regions now. The
// oracle is the file itself replayed without the region translation — every
// other translation of its version as before, each feature entry run as
// written (the extrude on its member, the holes in its loops), which is what
// the build before ran — and the two models must be the same thing for thing.
// (oldfiles13.test.ts holds the same files to the geometry the old build
// recorded.)
for (const name of ["pre-explicit-regions", "features-v12", "curves-v12", "flat2d-v12", "shapes-v15"]) {
  test(`${name}: opens with its holes as regions, the model the same as the file replayed as written`, async () => {
    await loadKernel();
    const text = await readFile(new URL(`./fixtures/${name}.neocad.json`, import.meta.url), "utf8");
    const saved = JSON.parse(text) as SavedModel;
    const translated = open(text, 3);
    const asWritten = fromSaved(saved, 3, { regions: false });
    assert.deepEqual(snapshot(translated), snapshot(asWritten));
    assert.equal(asWritten.regions.size, 0, "as written, no regions");
    for (const f of translated.features.values()) {
      assert.ok(f.region && translated.regions.has(f.region), `${f.name} stands on a region`);
      const r = translated.regionEntry(f.region!);
      assert.equal(r.steps.length, f.loops.length, `${f.name}: a step per loop of its profile`);
    }
    const resaved = save(translated);
    assert.equal(save(open(resaved)), resaved, "and today's file is stable");
  });
}

test("pre-explicit-regions: e1's holes, two of them taken in by the old inference, are rg1's subtracts", async () => {
  await loadKernel();
  const m = open(await readFile(new URL("./fixtures/pre-explicit-regions.neocad.json", import.meta.url), "utf8"), 3);
  assert.deepEqual([...m.regions.keys()].map((r) => regionText(m, r)), ["rg1 = l1–l4 − c1 − c3 − c5", "rg2 = l14–l17 − c7"]);
  const ops = m.journal.map((j) => j.op);
  // The steps the fillet and regen took in, each just before the entry that rebuilt with it.
  assert.equal(ops[ops.indexOf("fillet") - 1], "subtract");
  assert.equal(ops[ops.indexOf("regen") - 1], "subtract");
});

// --- a face a region names, deleted -----------------------------------------------------

// The decision (vetoable, TODO.md): the region loses the face — as deleting a
// hole's circle filled the hole before regions — rather than the deletion
// being refused. Its first face going takes the region, as an outline's going
// takes the feature.
test("deleting a face a region subtracts: the region loses that step, the solid fills, one undo step puts it back", async () => {
  await loadKernel();
  const { m, lines, ring } = sheet();
  const e = extrude(m, lines[0], 10);
  subtract(m, "rg1", ring);
  const before = save(m);
  const stack = new UndoStack<string>();
  stack.push(before);
  const n = m.journal.length;
  const removed = del(m, ring);
  assert.ok(removed.includes(ring));
  assert.ok(m.features.has(e), "the solid survives");
  assert.deepEqual(m.featureOf(e).loops, [lines], "filled");
  assert.equal(regionText(m, "rg1"), `rg1 = ${lines[0]}–${lines[3]}`, "the region lost the face");
  assert.deepEqual(m.journal[n], { op: "deleteRegionSteps", args: ["rg1", [1], [[e, [lines]]]] });
  const after = save(m);
  assert.equal(save(open(after)), after);
  const undone = open(stack.undo(after)!);
  assert.equal(regionText(undone, "rg1"), `rg1 = ${lines[0]}–${lines[3]} − ${ring}`, "one undo: the face and the step back");
});

test("deleting a region's first face takes the region with the features on it; del(\"rg1\") takes them too, the sketch kept", async () => {
  await loadKernel();
  {
    const { m, lines } = sheet();
    const e = extrude(m, lines[0], 10);
    const gone = del(m, lines[2]);
    assert.ok(gone.includes(e) && gone.includes("rg1"));
    assert.equal(m.regions.size, 0);
  }
  {
    const { m, lines, ring } = sheet();
    const r = region(m, lines[0]);
    subtract(m, r, ring);
    const e = extrude(m, r, 10);
    const gone = del(m, r);
    assert.deepEqual([gone.includes(e), gone.at(-1)], [true, r]);
    assert.equal(m.features.size + m.regions.size, 0);
    for (const l of lines) assert.ok(m.entities.has(l), `${l} kept`);
    assert.equal(m.journal.at(-1)!.op, "deleteRegion");
    assert.equal(save(open(save(m))), save(m));
  }
});

// --- the command line, the organiser -------------------------------------------------

test("typed: region, subtract, add, intersect — each one line, its chain in the log; extrude on a bare face names the region it made", async () => {
  await loadKernel();
  const { m, lines, ring, island } = sheet();
  const log: string[] = [];
  const repl = new Repl(neocadScope({ model: m, log: (l) => log.push(l) }));
  const ok = async (line: string) => {
    const r = await repl.eval(line);
    assert.equal(r.ok, true, `${line}: ${r.error?.message}`);
    return r.value;
  };
  assert.equal(await ok(`r = region("${lines[0]}")`), "rg1");
  await ok(`subtract(r, "${ring}")`);
  await ok(`add(r, "${island}")`);
  assert.ok(log.includes(`rg1 = ${lines[0]}–${lines[3]} − ${ring} + ${island}`), log.join(" | "));
  assert.equal(await ok("extrude(r, 10)"), "e1");
  const side = m.addLine(m.addPoint([80, 0, 0]).name, m.addPoint([90, 0, 0]).name).name;
  void side;
  const ls = (await ok("ls()")) as string[];
  assert.ok(ls.includes(`rg1 = ${lines[0]}–${lines[3]} − ${ring} + ${island}  (e1 on it)`), ls.join("\n"));
  // A bare face: its region named in the log.
  const sq = [[70, 30, 0], [80, 30, 0], [80, 40, 0], [70, 40, 0]].map((c) => m.addPoint(c).name);
  const sql = sq.map((p, i) => m.addLine(p, sq[(i + 1) % 4]).name);
  await ok(`extrude("${sql[0]}", 5)`);
  assert.ok(log.some((l) => l.startsWith(`rg2 = ${sql[0]}–${sql[3]}  (made for e2)`)), log.join(" | "));
});

test("the organiser's Regions: a row per region, its chain, the eye hiding it by name, Edit, Extrude and Delete", async () => {
  await loadKernel();
  const { m, lines, ring } = sheet();
  const r = region(m, lines[0]);
  subtract(m, r, ring);
  const regions = organiserSections(m).find((s) => s.id === "regions")!;
  assert.deepEqual(regions.rows.map((x) => [x.name, x.detail, x.count, x.eye, x.eyeCommand]),
    [[r, `${lines[0]}–${lines[3]} − ${ring}`, 2, "shown", `hide("${r}")`]]);
  const menu = rowMenu(m, r)!;
  assert.deepEqual(menu.items.map((i) => [i.label, i.action.do === "run" ? i.action.command : ""]),
    [[`Edit ${r}`, `edit("${r}")`], [`Extrude ${r}`, `extrude("${r}")`], ["Delete", `del("${r}")`]]);
  const repl = new Repl(neocadScope({ model: m }));
  assert.equal((await repl.eval(`hide("${r}")`)).ok, true);
  assert.equal(organiserSections(m).find((s) => s.id === "regions")!.rows[0].eye, "hidden");
  assert.equal(regionAtPoint(m, [5, 5, 0]), null, "a hidden region is not there to be clicked into");
  assert.equal((await repl.eval(`show("${r}")`)).ok, true);
  assert.equal(regionAtPoint(m, [5, 5, 0]), r);
  assert.equal(regionAtPoint(m, [30, 25, 0]), null, "inside the face it subtracted: not in it");
});

// --- the region tool -----------------------------------------------------------------

function toolCtx(m: Model, options: Record<string, unknown> = {}, target?: string) {
  const said: string[] = [];
  const ctx = {
    model: m, options: { mode: "subtract", ...options }, requestRender() {}, requestSolve() {}, finish() {},
    regionAt: regionAtFor(m, ABOVE), log: (l: string) => said.push(l), ...(target ? { target } : {}),
  } as unknown as ToolContext;
  return { ctx, said };
}

test("the region tool: a click makes a region, a click inside subtracts (the default), the mode row adds or ∩s, Esc puts it down", async () => {
  await loadKernel();
  const { m, lines, ring, island, side } = sheet();
  const { ctx, said } = toolCtx(m);
  const tool = new RegionTool(ctx);
  const click = (x: number, y: number) => tool.onDown({ world: [x, y, 0], screen: worldToScreen(ABOVE, [x, y, 0]) });
  assert.equal(tool.next("mouse"), "click a face to make a region of it");
  click(4, 4);
  assert.equal(tool.held, "rg1");
  assert.equal(tool.next("finger"), "tap a face to subtract rg1");
  click(20, 25); // in the ring, outside the island
  assert.equal(regionText(m, "rg1"), `rg1 = ${lines[0]}–${lines[3]} − ${ring}`);
  ctx.options = { mode: "add" };
  click(30, 25); // the island
  assert.equal(regionText(m, "rg1"), `rg1 = ${lines[0]}–${lines[3]} − ${ring} + ${island}`);
  // A click that would do nothing is guidance, and the region stays in hand.
  click(30, 25);
  assert.match(said.at(-1)!, /^region: .* is in rg1 already — adding it changes nothing$/);
  assert.equal(tool.held, "rg1");
  ctx.options = { mode: "new" };
  click(90, 10);
  assert.equal(tool.held, "rg2", "New makes another, which is then in hand");
  assert.equal(regionText(m, "rg2"), `rg2 = ${side[0]}–${side[3]}`);
  assert.equal(tool.clear(), true, "Esc puts it down");
  assert.equal(tool.held, null);
  ctx.options = { mode: "subtract" };
  click(4, 4);
  assert.equal(tool.held, "rg1", "inside a region with none in hand: that one, taken in hand, nothing typed");
  assert.equal(m.regions.size, 2);
  click(200, 200);
  assert.match(said.at(-1)!, /^region: click inside a closed outline/);
});

test("the region tool types what a user could have, one line each — and armed on a region by edit(\"rg1\")", async () => {
  await loadKernel();
  const { m, lines, ring } = sheet();
  const typed: string[] = [];
  const repl = new Repl(neocadScope({ model: m }));
  const { ctx } = toolCtx(m);
  ctx.run = async (line: string) => { typed.push(line); await repl.eval(line); };
  const tool = new RegionTool(ctx);
  const click = (x: number, y: number) => tool.onDown({ world: [x, y, 0], screen: worldToScreen(ABOVE, [x, y, 0]) });
  click(4, 4);
  await new Promise((r) => setTimeout(r, 0));
  click(20, 25);
  await new Promise((r) => setTimeout(r, 0));
  assert.deepEqual(typed, [`region("${lines[0]}")`, `subtract("rg1", "${ring}")`]);
  // Armed on a region: it is in hand from the start.
  const armed: unknown[] = [];
  const r2 = new Repl(neocadScope({ model: m, arm: (...a: unknown[]) => { armed.push(a); } }));
  assert.equal((await r2.eval('edit("rg1")')).value, "editing rg1");
  assert.deepEqual(armed, [["region", {}, "rg1"]]);
  const held = new RegionTool(toolCtx(m, {}, "rg1").ctx);
  assert.equal(held.held, "rg1");
});
