// Sketch editing (docs/plans/sketch-edit.md), driven the way a person drives
// it. The owner: *"give me better sketch tools, relations, trim, slot... all
// the usual"*.
//
// A rectangle drawn with the rectangle tool, then each edit by its tool's
// gesture on it: the bevel (the sketch's chamfer) by a click on a corner and
// ✓; an offset by a click on an edge, the cursor outside, ✓; the extrude of
// the bevelled outline; a trim across it by a click on the piece — the solid
// regenerates onto what is left; an extend by a click near a free end; a
// mirror of a shape about a line, picked then ✓ then the line; a linear
// pattern of a selected circle, ✓. Each one typed line, one Ctrl+Z, and the
// whole saved and opened again byte for byte. Then the trim, the bevel and the
// offset by taps on an iPhone 13.
//
// Set NEOCAD_E2E_SHOTS to a directory to keep the screenshots, and look at
// them. One app per device, tests in order: the states are cumulative.

import { test, before, after } from "node:test";
import assert from "node:assert/strict";
import { mkdirSync } from "node:fs";
import { join } from "node:path";
import { openApp, axisFrame, type AppContext } from "./harness.ts";
import { fingers } from "./fingers.ts";

const SHOTS = process.env.NEOCAD_E2E_SHOTS;
async function shot(app: AppContext, name: string): Promise<void> {
  if (!SHOTS) return;
  mkdirSync(SHOTS, { recursive: true });
  await app.page.waitForTimeout(200);
  await app.page.screenshot({ path: join(SHOTS, `sketchedit-${name}.png`) });
}

const value = async (app: AppContext, src: string) => {
  const r = await app.repl(src);
  assert.ok(r.ok, `${src}: ${r.error}`);
  return r.value;
};
const typedLines = (app: AppContext) => app.page.$$eval("#log .in", (els) => els.map((e) => (e.textContent ?? "").replace(/^> /, "")));
const near = (a: number[], b: number[], tol = 1e-4) => Math.hypot(...a.map((v, i) => v - (b[i] ?? 0))) <= tol;

/** The line whose two ends are at these places, by name. */
async function lineAt(app: AppContext, a: number[], b: number[]): Promise<string> {
  const m = await app.model();
  const l = m.lines.find((x) => {
    const [p, q] = x.refs.map((n) => m.points[n]);
    return (near(p, a, 1e-3) && near(q, b, 1e-3)) || (near(p, b, 1e-3) && near(q, a, 1e-3));
  });
  assert.ok(l, `a line from ${a} to ${b}`);
  return l!.name;
}

// --- the mouse -------------------------------------------------------------------

let app: AppContext;
before(async () => {
  app = await openApp();
  await axisFrame(app, [-150, -110]);
});
after(async () => {
  assert.deepEqual(app.pageErrors, [], "nothing the page threw went uncaught");
  await app.close();
});

async function move(world: number[]): Promise<{ x: number; y: number }> {
  const [sx, sy] = await app.screenOf(world);
  const at = await app.at(sx, sy);
  await app.page.mouse.move(at.x, at.y, { steps: 3 });
  await app.page.waitForTimeout(120);
  return at;
}
async function click(world: number[]): Promise<void> {
  await move(world);
  await app.page.mouse.down();
  await app.page.mouse.up();
  await app.page.waitForTimeout(400);
}
async function key(k: string): Promise<void> {
  await app.page.fill("#cmd", "");
  await app.page.keyboard.press(k);
  await app.page.waitForTimeout(400);
}
/** One Ctrl+Z gives back exactly the model before; Ctrl+Y the one after. */
async function undoesInOne(before: unknown): Promise<void> {
  const after = await value(app, "save(model, false)");
  await key("Control+z");
  assert.equal(await value(app, "save(model, false)"), before, "one Ctrl+Z: the model before the edit");
  await key("Control+y");
  assert.equal(await value(app, "save(model, false)"), after, "Ctrl+Y: the edit again");
}

test("a rectangle with the rectangle tool, its corner bevelled by a click on the corner and ✓ — chamfer typed, one undo step", async () => {
  await app.type("rectangle");
  const a = await move([-60, -40, 0]);
  await app.page.mouse.down();
  const b = await app.at(...await app.screenOf([60, 40, 0]));
  await app.page.mouse.move(b.x, b.y, { steps: 10 });
  await app.page.mouse.up();
  await app.page.waitForTimeout(300);
  void a;
  await key("Escape");
  assert.equal((await app.model()).byKind.line, 4, "the rectangle");
  const before = await value(app, "save(model, false)");
  await app.type('arm("bevel", { setback: 12 })');
  assert.equal((await app.model()).activeTool, "bevel");
  await click([60, 40, 0]); // the corner: both its lines
  await shot(app, "1-bevel-previewed");
  await key("Enter");
  const typed = (await typedLines(app)).at(-1)!;
  assert.match(typed, /^chamfer\("l\d+", "l\d+", 12\)$/);
  assert.equal((await app.model()).byKind.line, 5, "the corner cut by a line");
  await app.page.mouse.move(10, 10);
  await shot(app, "2-bevelled");
  await undoesInOne(before);
  await key("Escape");
});

test("the offset tool: a click on an edge, the cursor outside, ✓ — the bevelled outline offset outward, one typed line", async () => {
  const before = await value(app, "save(model, false)");
  await app.type('arm("offset", { distance: 6 })');
  await click([0, -40, 0]);
  await move([0, -55, 0]); // outside: outward
  await shot(app, "3-offset-previewed");
  await key("Enter");
  const typed = (await typedLines(app)).at(-1)!;
  assert.match(typed, /^offset\(\["l\d+"(,"l\d+"){4}\], 6\)$/, typed);
  const m = await app.model();
  assert.equal(m.byKind.line, 10, "five copies");
  // The bottom edge's copy is six below it.
  assert.ok(Object.values(m.points).some((p) => Math.abs(p[1] + 46) < 1e-6), "a copy at y = −46");
  await key("Escape");
  await app.page.mouse.move(10, 10);
  await shot(app, "4-offset");
  await undoesInOne(before);
  // Taken away again for what follows: an offset ring round the outline would
  // leave the extrude's region two faces to choose between once a line crosses
  // both, and a trim then refuses, saying so (test/sketchedit.test.ts).
  await key("Control+z");
  assert.equal(await value(app, "save(model, false)"), before);
});

test("extrude the bevelled outline, then trim across it: the click on the piece types trim, and the solid regenerates onto the side left", async () => {
  await app.type('arm("extrude", { depth: 15 })');
  await click([-30, 0, 0]);
  await key("Enter");
  await key("Escape");
  assert.equal(await value(app, "model.features.size"), 1);
  const bottom = await lineAt(app, [-60, -40, 0], [60, -40, 0]);
  const top = await lineAt(app, [-60, 40, 0], [48, 40, 0]);
  await app.type("ln(pt(20, -70, 0), pt(20, 70, 0))");
  const before = await value(app, "save(model, false)");
  await app.type("trim");
  await move([40, -40, 0]);
  // The piece a click takes is drawn in the cut's red under the cursor.
  const [px, py] = await app.screenOf([40, -40, 0]);
  const red = await app.pixel(px, py, "drawing");
  assert.ok(red[0] > red[1] + 40 && red[0] > red[2] + 40, `the piece drawn red: ${red}`);
  await shot(app, "5-trim-hover");
  await click([40, -40, 0]);
  assert.match((await typedLines(app)).at(-1)!, new RegExp(`^trim\\("${bottom}", \\[40,-40,0\\]\\)$`));
  const endsAt = async (l: string) => value(app, `model.line("${l}").refs.map((p) => model.coords(p))`) as Promise<number[][]>;
  assert.ok((await endsAt(bottom)).some((q) => near(q, [20, -40, 0], 1e-6)), "the bottom edge ends at the cutter");
  await click([40, 40, 0]);
  assert.match((await typedLines(app)).at(-1)!, new RegExp(`^trim\\("${top}", `));
  assert.ok((await endsAt(top)).some((q) => near(q, [20, 40, 0], 1e-6)), "the top edge too");
  const outline = await value(app, 'model.featureOf("e1").loops[0].map((m) => typeof m === "string" ? m : m.name)') as string[];
  assert.ok(outline.includes(bottom) && outline.includes(top), `the solid stands on what is left: ${outline}`);
  assert.ok(outline.some((n) => n !== bottom && n !== top && n.startsWith("l")), "along the cutter");
  assert.deepEqual(await value(app, "model.diagnose().redundant"), [], "nothing said twice: the crossing the extrude made real is a corner of the sketch now");
  await key("Escape");
  await app.page.mouse.move(10, 10);
  await shot(app, "6-trimmed-solid-regenerated");
  const after = await value(app, "save(model, false)");
  await key("Control+z");
  assert.notEqual(await value(app, "save(model, false)"), after);
  await key("Control+z");
  assert.equal(await value(app, "save(model, false)"), before, "two trims, two Ctrl+Z");
  await key("Control+y");
  await key("Control+y");
  assert.equal(await value(app, "save(model, false)"), after);
});

test("the extend tool: hover near a free end shows where it reaches, a click extends it — one typed line", async () => {
  const stub = await value(app, "ln(pt(90, -20, 0), pt(100, -20, 0))") as string;
  await app.type("ln(pt(130, -40, 0), pt(130, 0, 0))");
  const before = await value(app, "save(model, false)");
  await app.type("extend");
  await move([99, -20, 0]);
  const [gx, gy] = await app.screenOf([118, -20, 0]);
  const green = await app.pixel(gx, gy, "drawing");
  assert.ok(green[1] > green[0] && green[3] > 0, `the reach drawn green: ${green}`);
  await shot(app, "7-extend-hover");
  await click([99, -20, 0]);
  const end = await value(app, `model.line("${stub}").refs[1]`) as string;
  assert.equal((await typedLines(app)).at(-1), `extend("${stub}", "${end}")`);
  assert.ok(near(await value(app, `model.coords("${end}")`) as number[], [130, -20, 0], 1e-6));
  await undoesInOne(before);
  await key("Escape");
});

test("the mirror tool: two lines picked, ✓, the mirror line clicked, ✓ — mirror typed, the copies held by sym", async () => {
  const l1 = await value(app, "ln(pt(90, 20, 0), pt(110, 50, 0))") as string;
  const l2 = await value(app, `ln(model.line("${l1}").refs[1], pt(110, 20, 0))`) as string;
  const axis = await value(app, "ln(pt(120, 10, 0), pt(120, 60, 0))") as string;
  const before = await value(app, "save(model, false)");
  await app.type("mirror");
  await click([100, 35, 0]);
  await click([110, 30, 0]);
  await key("Enter");
  await click([120, 45, 0]);
  await shot(app, "8-mirror-previewed");
  await key("Enter");
  assert.equal((await typedLines(app)).at(-1), `mirror(["${l1}","${l2}"], "${axis}")`);
  // Three points, the corner the two lines share mirrored once.
  assert.equal(await value(app, `[...model.relations.values()].filter((r) => r.op === "symmetric").length`), 3, "three points mirrored, the shared corner once");
  const pts = Object.values((await app.model()).points);
  for (const q of [[150, 20, 0], [130, 50, 0], [130, 20, 0]]) assert.ok(pts.some((x) => near(x, q, 1e-6)), `a copy at ${q}`);
  await key("Escape");
  await app.page.mouse.move(10, 10);
  await shot(app, "9-mirrored");
  await undoesInOne(before);
});

test("the pattern tool: a circle selected, Pattern armed, ✓ — linear typed, copies named c1_2, c1_3", async () => {
  const c = await value(app, "circ(pt(-120, 60, 0), 6)") as string;
  await key("Escape");
  await click([-114, 60, 0]); // select the circle, nothing armed
  assert.deepEqual(await app.selection(), [c]);
  const before = await value(app, "save(model, false)");
  await app.type('arm("pattern", { kind: "linear", dx: 20, dy: 0, count: 3 })');
  await shot(app, "10-pattern-previewed");
  await key("Enter");
  assert.equal((await typedLines(app)).at(-1), `linear(["${c}"], 20, 0, 3)`);
  assert.ok(await value(app, `model.entities.has("${c}_3")`), "named after the seed");
  await key("Escape");
  await app.page.mouse.move(10, 10);
  await shot(app, "11-patterned");
  await undoesInOne(before);
});

test("saved and opened: the same model, byte for byte — every edit replays", async () => {
  const text = await value(app, "save()") as string;
  const r = await app.repl(`open(${JSON.stringify(text)})`);
  assert.equal(r.ok, true, String(r.error));
  await app.page.waitForTimeout(400);
  assert.equal(await value(app, "save()"), text);
  const ops = await value(app, "model.journal.map((e) => e.op)") as string[];
  for (const op of ["chamfer", "trim", "extend", "mirror", "linear"]) assert.ok(ops.includes(op), `${op} in the journal`);
  assert.equal(await app.status(), "SOLVED");
});

// --- a finger -------------------------------------------------------------------

test("iPhone 13: a trim by a tap on the piece, a bevel by a tap on the corner and ✓, an offset by a tap and ✓; undo; save and open", async () => {
  const p = await openApp({ device: "iPhone 13" });
  try {
    await axisFrame(p, [-150, -110]);
    for (const line of [
      "q = [pt(-40, -30, 0), pt(40, -30, 0), pt(40, 30, 0), pt(-40, 30, 0)]",
      "edges = [0, 1, 2, 3].map((i) => ln(q[i], q[(i + 1) % 4]))",
      "cut = ln(pt(10, -50, 0), pt(10, 50, 0))",
      "zoom(0.7)",
    ]) await p.type(line);
    const f = await fingers(p);
    const tap = async (world: number[]) => {
      const [sx, sy] = await p.screenOf(world);
      await p.at(sx, sy); // refuses a point a panel covers
      await f.tap(sx, sy);
      await p.page.waitForTimeout(450);
    };
    const typed = () => p.page.$$eval("#log .in", (els) => els.map((e) => (e.textContent ?? "").replace(/^> /, "")));
    await p.type("trim");
    await tap([25, -30, 0]);
    assert.equal(await p.page.$eval("#mode", (el) => (el as HTMLElement).dataset.next), "tap the piece to trim away", "a finger's word");
    assert.match((await typed()).at(-1)!, /^trim\("l\d+", \[25,-30,0\]\)$/);
    await shot(p, "12-phone-trimmed");
    const trimmed = await value(p, "save(model, false)");
    await p.type("undo()");
    assert.notEqual(await value(p, "save(model, false)"), trimmed, "undone");
    await p.type("redo()");
    assert.equal(await value(p, "save(model, false)"), trimmed, "and redone");
    await p.type("cancel()");
    await p.type('arm("bevel", { setback: 8 })');
    await tap([-40, 30, 0]);
    await p.page.fill("#cmd", "");
    await p.page.keyboard.press("Enter");
    await p.page.waitForTimeout(400);
    assert.match((await typed()).at(-1)!, /^chamfer\("l\d+", "l\d+", 8\)$/);
    await p.type("cancel()");
    await p.type('arm("offset", { distance: 4 })');
    await tap([-40, 0, 0]);
    await shot(p, "13-phone-offset-previewed");
    await tap([-40, 0, 0]); // the chain again: ✓
    assert.match((await typed()).at(-1)!, /^offset\(\["l\d+"(,"l\d+")*\], -?4\)$/);
    await shot(p, "14-phone-offset");
    const text = await value(p, "save()") as string;
    assert.equal((await p.repl(`open(${JSON.stringify(text)})`)).ok, true);
    await p.page.waitForTimeout(400);
    assert.equal(await value(p, "save()"), text);
    assert.deepEqual(p.pageErrors, []);
  } finally {
    await p.close();
  }
});
