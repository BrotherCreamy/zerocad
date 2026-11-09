// The constraints palette's pure half (docs/plans/constraints-palette.md): the
// module registers and the built-in workbenches name it; the palette's rows
// for a selection are `constraintsFor`'s plus the relations the selection
// has, newest first; a dimension's row carries its value and the `set` line;
// with nothing selected the drawing's relations and the agreeing sets; and
// the constrain tool hands the palette its picks (`related`). Headless.

import { test } from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { ensureKernelLoaded } from "../src/kernel/problem.ts";
import { Model } from "../src/model.ts";
import { dist } from "../src/relations/basic.ts";
import { parallel, perpendicular } from "../src/relations/geometry.ts";
import { constraintsFor } from "../src/dimensioning.ts";
import { paletteFor, heldRow, setCommand, type ApplyRow, type HeldRow } from "../src/constraints.ts";
import { getModule, getWorkbench, listWorkbenches } from "../src/modules.ts";
import { ConstrainTool } from "../src/tools/constrain.ts";
import type { ToolContext } from "../src/tools/tool.ts";
import "../src/modules/builtin.ts";

await (async () => {
  const bytes = await readFile(new URL("../src/kernel/wasm-gen/neocad_kernel_bg.wasm", import.meta.url));
  await ensureKernelLoaded(bytes);
})();

function line(m: Model, name: string, a: number[], b: number[]): string {
  m.addPoint(a, `${name}a`);
  m.addPoint(b, `${name}b`);
  return m.addLine(`${name}a`, `${name}b`, name).name;
}

test("the constraints module is built in, registers nothing but help, and every built-in workbench names it", () => {
  const mod = getModule("constraints");
  assert.ok(mod, "loaded");
  assert.equal(mod!.origin, "builtin");
  assert.deepEqual([mod!.tools, mod!.relations, mod!.ops, mod!.entities], [[], [], [], []]);
  assert.ok((mod!.spec.help as string[]).some((l) => l.includes("Constraints palette")));
  for (const w of listWorkbenches().filter((x) => x.origin === "builtin")) {
    assert.ok(w.modules.includes("constraints"), `${w.name} has the palette`);
  }
  assert.ok(getWorkbench("part")!.modules.includes("constraints"));
});

test("two lines selected: the apply rows are constraintsFor's, in its order, and the held rows are what the lines already have, newest first", () => {
  const m = new Model(2);
  line(m, "l1", [0, 0], [30, 4]);
  line(m, "l2", [0, 25], [30, 15]);
  const par = parallel(m, "l1", "l2");
  const d = dist(m, "l1a", "l1b", 30);
  m.solve();
  const sections = paletteFor(m, ["l1", "l2"], ["l1", "l2"]);
  assert.deepEqual(sections.map((s) => s.id), ["apply", "held"]);
  const apply = sections[0].rows as ApplyRow[];
  assert.deepEqual(apply.map((r) => [r.label, r.command]), constraintsFor(m, ["l1", "l2"]).map((a) => [a.label, a.text]));
  assert.equal(apply[0].command, 'par("l1", "l2")');
  const held = sections[1].rows as HeldRow[];
  // d names l1's ends — l1's relation, through its points — and is newer than the par.
  assert.deepEqual(held.map((r) => r.name), [d, par]);
  assert.equal(held[1].tapCommand, `select(${JSON.stringify(par)})`);
  assert.equal(held[1].deleteCommand, `del(${JSON.stringify(par)})`);
  assert.equal(held[1].glyph, "//", "the mark it wears on the drawing");
  assert.equal(held[1].value, null, "a par has no value to set");
  assert.equal(held[0].value, 30);
  assert.equal(held[0].glyph, "30", "a dimension's row shows its value, as its glyph does");
  assert.equal(setCommand(d, 45), `set("${d}.value", 45)`);
  assert.equal(sections[0].title, "relate l1, l2");
});

test("one point selected: Fix applies; nothing else, and the empty note says to pick another", () => {
  const m = new Model(2);
  line(m, "l1", [0, 0], [30, 4]);
  const [apply, held] = paletteFor(m, ["l1a"]);
  assert.deepEqual((apply.rows as ApplyRow[]).map((r) => r.label), ["Fix"]);
  assert.equal(held.rows.length, 0);
  assert.equal(held.empty, "no relation yet");
});

test("a relation's name in the selection is not what the palette is about: it lists for the entities", () => {
  const m = new Model(2);
  line(m, "l1", [0, 0], [30, 4]);
  line(m, "l2", [0, 25], [30, 15]);
  const par = parallel(m, "l1", "l2");
  const sections = paletteFor(m, [par, "l1", "l2"], [par]);
  assert.equal(sections[0].title, "relate l1, l2");
  const held = sections[1].rows as HeldRow[];
  assert.equal(held[0].selected, true, "the selected relation's row is lit");
});

test("nothing selected: every relation newest first, and the agreeing sets under them", () => {
  const m = new Model(2);
  [[0, 0], [40, 0], [40, 25], [0, 25]].forEach((c, i) => m.addPoint(c, `k${i}`));
  for (let i = 0; i < 4; i++) m.addLine(`k${i}`, `k${(i + 1) % 4}`, `e${i}`);
  const perps = [0, 1, 2, 3].map((i) => perpendicular(m, `e${i}`, `e${(i + 1) % 4}`));
  const d = dist(m, "k0", "k1", 40);
  m.solve();
  const diag = m.diagnose();
  const sections = paletteFor(m, [], [], diag.agreeing);
  assert.deepEqual(sections.map((s) => s.id), ["all", "agreeing"]);
  assert.deepEqual((sections[0].rows as HeldRow[]).map((r) => r.name), [d, ...perps.slice().reverse()]);
  assert.equal(sections[0].note, "5");
  assert.deepEqual((sections[1].rows as HeldRow[]).map((r) => r.name).sort(), perps.slice().sort(), "the four right angles agree");
  assert.match(sections[1].note, /^4 say one thing — none is wrong$/);
  // No agreeing set, no section.
  assert.deepEqual(paletteFor(m, [], [], []).map((s) => s.id), ["all"]);
});

test("heldRow of an angle carries rad as its unit; of a dist, none", () => {
  const m = new Model(2);
  line(m, "l1", [0, 0], [30, 0]);
  const d = dist(m, "l1a", "l1b", 30);
  assert.equal(heldRow(m, m.relationOf(d), []).unit, "");
  assert.equal(heldRow(m, m.relationOf(d), []).text, "dist l1a l1b 30");
});

test("the constrain tool hands the palette its picks through related(), and spends them when a row ran", () => {
  const m = new Model(2);
  line(m, "l1", [0, 0], [30, 4]);
  line(m, "l2", [0, 25], [30, 15]);
  const ctx = { model: m, prenamed: ["l1", "l2"], requestRender() {}, requestSolve() {}, finish() {} } as unknown as ToolContext;
  const tool = new ConstrainTool(ctx);
  tool.onArmed();
  assert.deepEqual([...tool.related()], ["l1", "l2"]);
  const [apply] = paletteFor(m, tool.related());
  assert.equal((apply.rows as ApplyRow[])[0].command, 'par("l1", "l2")');
  tool.ran();
  assert.deepEqual([...tool.related()], [], "spent");
  assert.equal(paletteFor(m, tool.related())[0].id, "all", "with nothing picked and no tool the palette lists the drawing");
  // The tool armed with nothing picked: the palette says what it waits for.
  const waiting = paletteFor(m, tool.related(), [], [], true);
  assert.deepEqual(waiting.map((s) => [s.id, s.rows.length]), [["apply", 0]]);
  assert.match(waiting[0].empty!, /^pick what to relate/);
});
