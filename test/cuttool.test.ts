// The Cut tool and the flip (docs/plans/solid-tools-intuitive.md; the owner:
// "Flip button." and "I'm still not clear on how to use the extrude cut tool.
// It doesn't make sense to me. Make it more intuitive, along with the other
// solid tools."). Cut is a tool of its own whose direction defaults into the
// material — a region on a lid cuts down, one on the ground under a body cuts
// up, one beside every body goes the typed call's own way and is said to reach
// nothing — and what it types is the extrude call, so it replays as one. The
// flip is the depth negated: the typed line is the negated call, twice is back.

import { test } from "node:test";
import assert from "node:assert/strict";
import { Model } from "../src/model.ts";
import { Repl } from "../src/repl.ts";
import { neocadScope } from "../src/replenv.ts";
import { open, save } from "../src/persist.ts";
import { findLoops, loopAround } from "../src/loops.ts";
import "../src/modules/builtin.ts"; // the tools registered, as the app does
import { CutTool, ExtrudeTool, cutWay, depthStep, draggedDepth } from "../src/tools/extrude.ts";
import { RevolveTool } from "../src/tools/revolve.ts";
import { EditExtrudeTool, EditRevolveTool, editSteps } from "../src/tools/edit.ts";
import { declaredOptions } from "../src/tools/options.ts";
import { getToolCtor } from "../src/tools/tool.ts";
import type { RegionHit, ToolContext } from "../src/tools/tool.ts";
import { L, T, circleOn, loadSolver, onTop, plate, type Plate } from "./solids/scene.ts";
import { featureHost } from "./featurectx.ts";
import { menuFor } from "../src/menu.ts";
import { set } from "../src/operations.ts";
import { insideFeature } from "../src/modes.ts";

/** The region whose loop holds `at`, as a click there finds it with the viewer looking along −`toward`. */
function hitOn(m: Model, at: number[], toward: number[]): RegionHit {
  const loops = findLoops(m);
  const loop = loopAround(m, at, loops);
  assert.ok(loop, `a loop around ${at}`);
  return { loops, index: loops.indexOf(loop), toward, at };
}

/** A plate and a command line over it, as the tool's host has one. */
function scene(): { m: Model; repl: Repl; p: Plate } {
  const m = new Model(3);
  const p = plate(m);
  return { m, repl: new Repl(neocadScope({ model: m })), p };
}

/** A tool on `m` driven as the app drives it: a click on `hit`, then ✓, its lines typed into `repl`. */
async function confirmed(Tool: typeof ExtrudeTool, m: Model, repl: Repl, hit: RegionHit, options: Record<string, unknown>) {
  const host = featureHost(m, repl);
  const said: string[] = [];
  const ctx = {
    model: m, options, requestRender() {}, requestSolve() {}, finish() {},
    regionAt: () => hit, perform: host.perform, log: (line: string) => said.push(line),
  } as unknown as ToolContext;
  const t = new Tool(ctx);
  t.onDown({ world: hit.at, screen: [0, 0] });
  t.confirm();
  await host.settled();
  return { typed: host.typed, refused: host.refused, said, tool: t };
}

const neg = (v: number[]) => v.map((c) => -c);

test("Cut on a lid: into the plate, down, with no minus sign typed — the extrude call, mode cut", async () => {
  await loadSolver();
  const { m, repl, p } = scene();
  const top = p.lid.slice(0, 3).join(".");
  const c = circleOn(m, top, onTop(p, 50, 30), 5, p.t.uz);
  m.solve();
  const hit = hitOn(m, onTop(p, 50, 30), p.t.uz);
  assert.deepEqual(cutWay(m, hit, 10, "blind"), { way: -1, reaches: true }, "into the plate is against the lid's normal");
  const { typed, refused } = await confirmed(CutTool, m, repl, hit, { depth: 10, end: "blind" });
  assert.deepEqual(refused, []);
  assert.equal(typed.length, 1);
  assert.match(typed[0], new RegExp(`^extrude\\("${c}", -10.*\\{"mode":"cut"\\}\\)$`), typed[0]);
  const f = m.featureOf("e2", "extrude");
  assert.deepEqual([f.mode, f.into], ["cut", p.feature]);
});

test("Cut on the ground under a body: up into it; beside every body: the call's own way, and it reaches nothing", async () => {
  await loadSolver();
  const { m, p } = scene();
  // On the plate's own sketch plane, inside its footprint: the plate is above.
  circleOn(m, p.t.name, p.t.at(50, 30, 0), 5, p.t.uz);
  // On the same plane, well beside it: nothing either way.
  circleOn(m, p.t.name, p.t.at(L + 40, 30, 0), 5, p.t.uz);
  m.solve();
  assert.deepEqual(cutWay(m, hitOn(m, p.t.at(50, 30, 0), p.t.uz), 10, "blind"), { way: 1, reaches: true }, "up, into the plate");
  // Seen from below, the same answer: which way is into the material is the bodies', not the viewer's.
  assert.deepEqual(cutWay(m, hitOn(m, p.t.at(50, 30, 0), neg(p.t.uz)), 10, "blind").reaches, true);
  assert.deepEqual(cutWay(m, hitOn(m, p.t.at(L + 40, 30, 0), p.t.uz), 10, "blind"), { way: 1, reaches: false }, "beside it");
  // Through all looks the whole drawing's length; symmetric both ways.
  assert.equal(cutWay(m, hitOn(m, p.t.at(50, 30, 0), p.t.uz), 0.5, "through").reaches, true);
  assert.equal(cutWay(m, hitOn(m, p.t.at(50, 30, 0), p.t.uz), 4, "symmetric").reaches, true);
});

test("Cut's lines replay: typed by hand into a twin, the same journal; saved and opened, the same file", async () => {
  await loadSolver();
  const a = scene(), b = scene();
  for (const s of [a, b]) circleOn(s.m, s.p.lid.slice(0, 3).join("."), onTop(s.p, 50, 30), 5, s.p.t.uz);
  a.m.solve();
  b.m.solve();
  const { typed } = await confirmed(CutTool, a.m, a.repl, hitOn(a.m, onTop(a.p, 50, 30), a.p.t.uz), { depth: 4, end: "through" });
  // Typed as the tool types it; the far vertex the call finds is the journal's, not the line's.
  assert.match(typed[0], /\{"mode":"cut","end":"through"\}\)$/, typed[0]);
  for (const line of typed) assert.equal((await b.repl.eval(line)).ok, true, line);
  assert.deepEqual(a.m.journal, b.m.journal);
  const file = save(a.m);
  assert.equal(save(open(file)), file);
});

test("Flip: the depth negated is the negated call, and twice is back where it was", async () => {
  await loadSolver();
  const lines: string[] = [];
  for (const depth of [12, -12, 12]) {
    const { m, repl, p } = scene();
    circleOn(m, p.lid.slice(0, 3).join("."), onTop(p, 50, 30), 5, p.t.uz);
    m.solve();
    const { typed } = await confirmed(ExtrudeTool, m, repl, hitOn(m, onTop(p, 50, 30), p.t.uz), { depth, end: "blind", mode: "auto" });
    lines.push(typed[0]);
  }
  assert.match(lines[0], /^extrude\("c\d+", 12/);
  assert.equal(lines[1], lines[0].replace(", 12", ", -12"), "flipped: the same call with the depth negated");
  assert.equal(lines[2], lines[0], "flipped back");
  // Cut flipped goes out of the material, and says it reaches nothing — before ✓, as guidance.
  const { m, repl, p } = scene();
  circleOn(m, p.lid.slice(0, 3).join("."), onTop(p, 50, 30), 5, p.t.uz);
  m.solve();
  const hit = hitOn(m, onTop(p, 50, 30), p.t.uz);
  assert.equal(cutWay(m, hit, -10, "blind").way, -1, "the way into the material does not depend on the sign");
  const { typed } = await confirmed(CutTool, m, repl, hit, { depth: -10, end: "blind" });
  assert.match(typed[0], /, 10, .*"mode":"cut"/, `out of the lid: ${typed[0]}`);
});

test("the flip is declared where a direction is a number: extrude's and cut's depth, revolve's angle, and the edit dialogs'", () => {
  for (const [tool, option] of [["extrude", "depth"], ["cut", "depth"], ["revolve", "angle"], ["edit extrude", "depth"], ["edit revolve", "angle"]]) {
    assert.equal(declaredOptions(getToolCtor(tool), tool)[option].flip, true, `${tool}'s ${option}`);
  }
  // Cut has no mode row — it is a cut — and the extrude keeps its row, the expert's way.
  assert.deepEqual(Object.keys(declaredOptions(CutTool)), ["depth", "end"]);
  assert.deepEqual(Object.keys(declaredOptions(ExtrudeTool)), ["depth", "end", "mode"]);
  assert.deepEqual(Object.keys(declaredOptions(EditExtrudeTool)), ["depth", "end"]);
  assert.equal(declaredOptions(EditRevolveTool).angle.flip, true);
  assert.equal(declaredOptions(RevolveTool).angle.flip, true);
  // A flip on what is no number is refused at the declaration.
  assert.throws(() => declaredOptions({ options: { mode: { default: "a", choices: { a: "A" }, flip: true } } }, "t"), /flip .* only for a number/);
});

test("the edit dialog's end row types setEnd before the depth, and nothing when it is unchanged", async () => {
  await loadSolver();
  const { m, p } = scene();
  const top = p.lid.slice(0, 3).join(".");
  const scope = neocadScope({ model: m }) as Record<string, (...a: unknown[]) => unknown>;
  scope.extrude(circleOn(m, top, onTop(p, 50, 30), 5, p.t.uz), -4, { mode: "cut" });
  m.solve();
  const f = m.featureOf("e2", "extrude");
  const lines = (end: string | null, value: number | null) =>
    editSteps("e2", [], value, end).map((s) => s(m)).filter((x) => x !== null).map((x) => ("text" in x! ? x.text : "call"));
  assert.deepEqual(lines("blind", -4), [], "nothing changed, nothing typed");
  assert.deepEqual(lines("through", -4), ['setEnd("e2", "through")']);
  assert.deepEqual(lines("through", 4), ['setEnd("e2", "through")', `set("${f.depth}.value", 4)`], "the flip is the depth negated");
});

test("the menu: Flip direction on an extrude's depth dimension and on its face, typing the depth negated — and run, it flips", async () => {
  await loadSolver();
  const { m, p } = scene();
  const f = m.featureOf(p.feature, "extrude");
  const flip = (pick: { name: string; kind: string }) => menuFor(m, pick as never).items.find((i) => /^Flip/.test(i.label));
  const onDimension = flip({ name: f.depth, kind: "relation" });
  assert.deepEqual(onDimension && [onDimension.label, onDimension.action], ["Flip direction", { do: "run", command: `set("${f.depth}.value", -${T})` }]);
  const onFace = flip({ name: f.twins[0][0], kind: "line" });
  assert.deepEqual(onFace && [onFace.label, onFace.action], ["Flip direction", { do: "run", command: `set("${f.depth}.value", -${T})` }],
    "on a piece of the solid, beside Edit e1");
  // No flip on a dimension with no direction: a fillet's radius, a dist.
  const d = m.relation("dist", [p.base[0], p.base[1], 100], () => {});
  assert.equal(flip({ name: d, kind: "relation" }), undefined);
  set(m, `${f.depth}.value`, -T);
  m.solve();
  assert.ok(insideFeature(m, f)(p.t.at(50, 30, -5)) && !insideFeature(m, f)(p.t.at(50, 30, 5)), "flipped: below its sketch");
});

test("the depth handle's arithmetic: deeper along it, shallower against, through zero a flip, snapped to round values and never 0", () => {
  // Four pixels a unit: the step is the first of 1, 2, 5 × 10ⁿ that is six pixels or more.
  assert.equal(depthStep(4), 2);
  assert.equal(depthStep(40), 0.2);
  assert.equal(depthStep(0.5), 20);
  assert.equal(draggedDepth(10, 3.2, 1), 13, "along the arrow: deeper");
  assert.equal(draggedDepth(10, -3.2, 1), 7, "against it: shallower");
  assert.equal(draggedDepth(-10, 3.2, 1), -13, "a negative depth deepens the other way, along its own arrow");
  assert.equal(draggedDepth(10, -14, 1), -4, "through zero: flipped");
  assert.equal(draggedDepth(10, -10.2, 1), -1, "never 0: a step on, the way the drag went");
  assert.equal(draggedDepth(10, -9.8, 1), 1);
  assert.equal(draggedDepth(10, 0.04, 0.2), 10);
});

test("Cut with nothing to cut into: the depth's own way, and the tool says it reaches no solid, muted", async () => {
  await loadSolver();
  const m = new Model(3);
  const repl = new Repl(neocadScope({ model: m }));
  for (const line of ["c = circ(pt(0, 0, 0), 5)"]) assert.equal((await repl.eval(line)).ok, true);
  m.solve();
  const hit = hitOn(m, [0, 0, 0], [0, 0, 1]);
  assert.deepEqual(cutWay(m, hit, 10, "blind"), { way: 1, reaches: false });
  void T;
});
