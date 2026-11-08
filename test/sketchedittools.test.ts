// The sketch-edit tools' gestures, headless (docs/plans/sketch-edit.md): each
// types the call a person could have typed, through a real command line, and
// the typed call is what the journal holds. Trim and extend commit on the one
// click (`run`); offset, mirror, bevel and pattern are feature tools — pick,
// preview, ✓ — whose confirm is one `perform`, one undo step in the app.

import { test } from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { ensureKernelLoaded } from "../src/kernel/problem.ts";
import { Model } from "../src/model.ts";
import { Repl } from "../src/repl.ts";
import { neocadScope } from "../src/replenv.ts";
import type { Pick } from "../src/picking.ts";
import type { PointerInfo, ToolContext } from "../src/tools/tool.ts";
import { TrimTool } from "../src/tools/trim.ts";
import { ExtendTool } from "../src/tools/extend.ts";
import { OffsetTool } from "../src/tools/offset.ts";
import { MirrorTool } from "../src/tools/mirror.ts";
import { BevelTool } from "../src/tools/bevel.ts";
import { PatternTool } from "../src/tools/pattern.ts";
import { featureHost } from "./featurectx.ts";
import { toolSummary } from "../src/tools/tool.ts";
import { TOOL_ICONS } from "../src/tools/icons.ts";
import "../src/modules/builtin.ts";

await ensureKernelLoaded(await readFile(new URL("../src/kernel/wasm-gen/neocad_kernel_bg.wasm", import.meta.url)));

/** A model with a 40 × 30 rectangle (l1–l4, bottom first) and a command line over it. */
async function drawing() {
  const m = new Model(3);
  const repl = new Repl(neocadScope({ model: m }));
  const r = await repl.eval("q = [pt(0, 0, 0), pt(40, 0, 0), pt(40, 30, 0), pt(0, 30, 0)]; edges = [0, 1, 2, 3].map((i) => ln(q[i], q[(i + 1) % 4]))");
  assert.ok(r.ok, String(r.error?.message));
  return { m, repl };
}

/** A tool's host: `pick` answers what the test says is under the cursor; `run` types into the command line. */
function host(m: Model, repl: Repl, options: Record<string, unknown> = {}) {
  let under: Pick | null = null;
  const ran: string[] = [];
  const said: string[] = [];
  const pending: Promise<unknown>[] = [];
  const fh = featureHost(m, repl);
  const ctx = {
    model: m, options, requestRender() {}, requestSolve() {}, finish() {},
    pick: () => under,
    run: (line: string) => {
      ran.push(line);
      // `arm` needs the app's engine; the line typed is what is checked of it.
      const p = repl.eval(line).then((res) => { if (!line.startsWith("arm(")) assert.ok(res.ok, `${line}: ${res.error?.message}`); });
      pending.push(p);
      return p;
    },
    log: (line: string) => said.push(line),
    perform: fh.perform,
    preview: fh.preview,
  } as unknown as ToolContext;
  return {
    ctx, ran, said, fh,
    at(kind: Pick["kind"], name: string, extra: Partial<Pick> = {}) { under = { name, kind, distance: 0, ...extra }; },
    none() { under = null; },
    async settled() { while (pending.length) await pending.shift(); await fh.settled(); },
  };
}

const press = (world: number[]): PointerInfo => ({ world, screen: [0, 0] });

test("the trim tool: a click on a piece types trim with the place, rounded; a curve nothing cuts is guidance", async () => {
  const { m, repl } = await drawing();
  await repl.eval("ln(pt(20, -10, 0), pt(20, 40, 0))");
  const h = host(m, repl);
  const t = new TrimTool(h.ctx);
  h.at("line", "l1");
  t.onMove(press([30.123456, 0, 0]));
  // A click is a press and a release in one place: the trim lands on the release
  // (docs/plans/trim-everything.md — a press may yet become a power-trim stroke).
  t.onDown(press([30.123456, 0, 0]));
  assert.equal(h.ran.length, 0, "nothing typed on the press");
  t.onUp(press([30.123456, 0, 0]));
  await h.settled();
  assert.deepEqual(h.ran, ['trim("l1", [30.1235,0,0])']);
  assert.equal(m.journal.at(-1)!.op, "trim");
  const lone = (await repl.eval("ln(pt(100, 0, 0), pt(110, 0, 0))")).value as string;
  h.at("line", lone);
  t.onDown(press([105, 0, 0]));
  t.onUp(press([105, 0, 0]));
  assert.equal(h.ran.length, 1, "nothing typed");
  assert.match(h.said.at(-1)!, /^trim: nothing cuts/);
  assert.equal(t.next("finger"), "tap a piece to trim it, or drag across pieces");
});

test("the trim tool takes the edge, not the corner, when a corner's point wins the pick", async () => {
  const { m, repl } = await drawing();
  await repl.eval("ln(pt(20, -10, 0), pt(20, 40, 0))");
  const h = host(m, repl);
  const t = new TrimTool(h.ctx);
  h.at("point", m.line("l1").refs[1]); // the bottom-right corner, pressed just left of it along l1
  t.onDown(press([38.5, 0.3, 0]));
  t.onUp(press([38.5, 0.3, 0]));
  await h.settled();
  assert.match(h.ran[0], /^trim\("l1", /);
});

test("the extend tool: a click near an end types extend for that end", async () => {
  const { m, repl } = await drawing();
  const stub = (await repl.eval("ln(pt(50, 10, 0), pt(55, 10, 0))")).value as string;
  await repl.eval("ln(pt(70, 0, 0), pt(70, 20, 0))");
  const h = host(m, repl);
  const t = new ExtendTool(h.ctx);
  h.at("line", stub);
  t.onDown(press([54, 10, 0]));
  await h.settled();
  assert.deepEqual(h.ran, [`extend("${stub}", "${m.line(stub).refs[1]}")`]);
  assert.ok(Math.abs(m.coords(m.line(stub).refs[1])[0] - 70) < 1e-9);
  h.at("line", "l1");
  t.onDown(press([39, 0, 0]));
  assert.match(h.said.at(-1)!, /^extend: .* is also l2's — extend lengthens a free end/);
});

test("the offset tool: a click takes the chain, the cursor's side is the sign, ✓ types one offset", async () => {
  const { m, repl } = await drawing();
  const h = host(m, repl, { distance: 5, construction: false });
  const t = new OffsetTool(h.ctx);
  h.at("line", "l1");
  t.onDown(press([20, -2, 0]));
  assert.deepEqual(t.chain, ["l1", "l2", "l3", "l4"]);
  t.onMove(press([20, -3, 0])); // outside: outward
  assert.equal(t.dialog().ready, true);
  t.confirm();
  await h.settled();
  assert.deepEqual(h.fh.typed, ['offset(["l1","l2","l3","l4"], 5)']);
  assert.equal(h.fh.performs, 1);
  assert.equal([...m.entities.values()].filter((e) => e.kind === "line").length, 8);
  // Inside the rectangle is the other side: a negative distance.
  const t2 = new OffsetTool(h.ctx);
  h.at("line", "l1");
  t2.onDown(press([20, 2, 0]));
  t2.onMove(press([20, 3, 0]));
  t2.confirm();
  await h.settled();
  assert.equal(h.fh.typed.at(-1), 'offset(["l1","l2","l3","l4"], -5)');
});

test("the offset tool: a drag sets the distance and types it into the option", async () => {
  const { m, repl } = await drawing();
  const h = host(m, repl, { distance: 5, construction: false });
  const t = new OffsetTool(h.ctx);
  h.at("line", "l1");
  t.onDown(press([20, -1, 0]));
  h.none();
  t.onDown(press([20, -1, 0]));
  t.onMove(press([20, -7.5, 0]));
  t.onUp();
  await h.settled();
  assert.deepEqual(h.ran, ['arm("offset", {"distance":7.5})']);
});

test("the mirror tool: a preselection, then the line — a frame's axis by its marker's arm — and ✓", async () => {
  const { m, repl } = await drawing();
  const h = host(m, repl);
  (h.ctx as { prenamed?: string[] }).prenamed = ["l1", "l2", "r9"];
  const t = new MirrorTool(h.ctx);
  t.onArmed();
  assert.deepEqual(t.set, ["l1", "l2"], "only what a mirror copies");
  h.at("frame", "origin", { axis: "y" });
  t.onDown(press([0, 0, 0]));
  assert.equal(t.line, "origin.y");
  t.onDown(press([0, 0, 0])); // the line again: ✓
  await h.settled();
  assert.deepEqual(h.fh.typed, ['mirror(["l1", "l2"], "origin.y")'].map((x) => x.replace(/", "/g, '","')));
  assert.equal(m.journal.at(-1)!.op, "mirror");
});

test("the mirror tool with nothing selected: clicks pick the set, ✓ moves to the line", async () => {
  const { m, repl } = await drawing();
  const h = host(m, repl);
  const t = new MirrorTool(h.ctx);
  h.at("line", "l2");
  t.onDown(press([40, 15, 0]));
  assert.deepEqual(t.set, ["l2"]);
  assert.equal(t.confirm(), true);
  assert.equal(t.next("mouse"), "click the mirror line — a line or an axis");
  h.at("line", "l4");
  t.onDown(press([0, 15, 0]));
  t.confirm();
  await h.settled();
  assert.equal(h.fh.typed.length, 1);
  assert.match(h.fh.typed[0], /^mirror\(\["l2"\], "l4"\)$/);
});

test("the bevel tool is the fillet's gesture with a setback: two lines, ✓, chamfer typed", async () => {
  const { m, repl } = await drawing();
  const h = host(m, repl, { setback: 4, other: 0 });
  const t = new BevelTool(h.ctx);
  h.at("line", "l1");
  t.onDown(press([20, 0, 0]));
  h.at("line", "l2");
  t.onDown(press([40, 15, 0]));
  t.confirm();
  await h.settled();
  assert.deepEqual(h.fh.typed, ['chamfer("l1", "l2", 4)']);
  assert.equal(m.journal.at(-1)!.op, "chamfer");
  assert.equal(t.name, "bevel");
  // Two setbacks.
  const h2 = host(m, repl, { setback: 3, other: 2 });
  const t2 = new BevelTool(h2.ctx);
  h2.at("line", "l3");
  t2.onDown(press([20, 30, 0]));
  h2.at("line", "l4");
  t2.onDown(press([0, 15, 0]));
  t2.confirm();
  await h2.settled();
  assert.deepEqual(h2.fh.typed, ['chamfer("l3", "l4", 3, 2)']);
});

test("the pattern tool: linear from a selection and the panel's step; circular asks for its centre", async () => {
  const { m, repl } = await drawing();
  const h = host(m, repl, { kind: "linear", count: 3, dx: 50, dy: 0, angle: 2 * Math.PI });
  (h.ctx as { prenamed?: string[] }).prenamed = ["l1", "l2", "l3", "l4"];
  const t = new PatternTool(h.ctx);
  t.onArmed();
  assert.equal(t.dialog().ready, true);
  t.confirm();
  await h.settled();
  assert.equal(h.fh.typed.length, 1);
  assert.match(h.fh.typed[0], /^linear\(\["l1", ?"l2", ?"l3", ?"l4"\], 50, 0, 3\)$/);
  assert.ok(m.entities.has("l1_3"));
  const c = (await repl.eval("circ(pt(100, 0, 0), 3)")).value as string;
  const h2 = host(m, repl, { kind: "circular", count: 4, dx: 20, dy: 0, angle: 2 * Math.PI });
  const t2 = new PatternTool(h2.ctx);
  h2.at("circle", c);
  t2.onDown(press([103, 0, 0]));
  assert.equal(t2.dialog().ready, false, "a centre is still wanted");
  t2.confirm();
  assert.equal(t2.next("mouse"), "click the centre to turn about");
  const centre = (await repl.eval("pt(80, 0, 0)")).value as string;
  h2.at("point", centre);
  t2.onDown(press([80, 0, 0]));
  t2.confirm();
  await h2.settled();
  assert.match(h2.fh.typed[0], new RegExp(`^circular\\(\\["${c}"\\], "${centre}", 6.28318\\d*, 4\\)$`));
  assert.ok(m.entities.has(`${c}_4`));
});

test("every edit tool says what it does and has a glyph", () => {
  for (const t of ["bevel", "trim", "extend", "offset", "mirror", "pattern"]) {
    assert.ok(toolSummary(t), `${t} has a summary`);
    assert.ok(TOOL_ICONS[t], `${t} has a glyph`);
  }
});
