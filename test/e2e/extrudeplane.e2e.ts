// The owner's first run, in a browser: a rectangle drawn in a fresh model, the
// extrude tool, a click inside — which used to answer "the loop of
// l1,l4,l3,l2 lies in no frame's plane …" as often as he clicked, and now picks
// the region, and Enter makes a solid (docs/plans/feature-dialog.md). The tool
// types the plane the sketch needs first, `plane(a, b, c, { look: false })`,
// then `extrude("l1", 10)`, so the log shows both and then `e1`; the view stays
// where it was; and the two are one undo step — the whole confirm is one user
// action — so one Ctrl+Z brings back the frameless rectangle exactly. Then the same from the
// command line, `extrude("l1", 15)`, one step; and once more with the tool
// from a turned view, where a positive depth must come toward the viewer.
//
// Set NEOCAD_E2E_SHOTS to a directory to keep the screenshots; look at them.
//
// One app, tests in order: the states are cumulative.

import { test, before, after } from "node:test";
import assert from "node:assert/strict";
import { mkdirSync } from "node:fs";
import { join } from "node:path";
import { openApp, type AppContext, confirmAndRelease } from "./harness.ts";

let app: AppContext;
before(async () => { app = await openApp(); });
after(async () => {
  assert.deepEqual(app.pageErrors, [], "nothing the page threw went uncaught");
  await app.close();
});

const SHOTS = process.env.NEOCAD_E2E_SHOTS;
async function shot(name: string): Promise<void> {
  if (!SHOTS) return;
  mkdirSync(SHOTS, { recursive: true });
  await app.page.mouse.move(2, 2); // no hover outline or tag in the picture
  await app.page.waitForTimeout(120);
  await app.page.screenshot({ path: join(SHOTS, `extrudeplane-${name}.png`) });
}

const dot = (a: number[], b: number[]) => a.reduce((s, x, i) => s + x * b[i], 0);
const sub = (a: number[], b: number[]) => a.map((x, i) => x - b[i]);
const dist3 = (a: number[], b: number[]) => Math.hypot(...sub(a, b));

async function leftDrag(a: [number, number], b: [number, number]): Promise<void> {
  const p = await app.at(...a), q = await app.at(...b);
  await app.page.mouse.move(p.x, p.y);
  await app.page.mouse.down();
  await app.page.mouse.move(q.x, q.y, { steps: 8 });
  await app.page.mouse.up();
  await app.page.waitForTimeout(220);
}

async function clickAt(sx: number, sy: number): Promise<void> {
  const at = await app.at(sx, sy);
  await app.page.mouse.move(at.x, at.y, { steps: 3 });
  await app.page.waitForTimeout(100);
  await app.page.mouse.click(at.x, at.y);
  await app.page.waitForTimeout(250);
}

async function key(combo: string): Promise<void> {
  await app.page.fill("#cmd", "");
  await app.page.keyboard.press(combo);
  await app.page.waitForTimeout(250);
}

async function saved(): Promise<string> {
  const r = await app.repl("save()");
  assert.equal(r.ok, true, r.error ?? "");
  return r.value as string;
}

const defaultFrame = async (): Promise<string | null> => (await app.repl("defaultFrame()")).value as string | null;

/** The camera's line of sight back at the viewer, and a frame's +z, read from the modules the app runs. */
const toward = (): Promise<number[]> => app.page.evaluate(async () => {
  const path = "/src/view.ts";
  const { viewAxes } = await import(path);
  return viewAxes((window as never as { __neocad: { engine: { view: unknown } } }).__neocad.engine.view).toward as number[];
});
const zOf = (frame: string): Promise<number[]> => app.page.evaluate(async (f) => {
  const path = "/src/relations/refs.ts";
  const { frameBasis } = await import(path);
  return frameBasis((window as never as { __neocad: { model: unknown } }).__neocad.model, f)().uz as number[];
}, frame);

interface SeenFeature { name: string; frame: string; value: number; pairs: [string, string][] }
const features = (): Promise<SeenFeature[]> => app.page.evaluate(() => {
  const { model } = (window as never as { __neocad: { model: {
    features: Map<string, { name: string; frame: string; depth: string }>;
    relations: Map<string, { args: unknown[] }>;
  } } }).__neocad;
  return [...model.features.values()].map((f) => {
    const args = model.relations.get(f.depth)!.args;
    const pairs: [string, string][] = [];
    for (let i = 2; i < args.length; i += 2) pairs.push([args[i] as string, args[i + 1] as string]);
    return { name: f.name, frame: f.frame, value: args[1] as number, pairs };
  });
});

/** Every point twin of `f` sits at its base plus its depth along its frame's +z — read off the frame here. */
async function lidAlong(f: SeenFeature): Promise<number[]> {
  const z = await zOf(f.frame);
  const { points } = await app.model();
  for (const [base, twin] of f.pairs) {
    if (!(base in points)) continue;
    const off = sub(points[twin], points[base]);
    assert.ok(dist3(off, z.map((c) => f.value * c)) < 1e-6, `${twin} is ${base} + ${f.value}·z: ${off}`);
  }
  return z;
}

/** The log's lines — one element each — with the class each is shown in. */
const logLines = (): Promise<{ text: string; cls: string }[]> => app.page.$$eval("#log > div",
  (els) => els.map((el) => ({ text: el.textContent ?? "", cls: el.className })));
/** The log's lines since `from` lines in. */
async function logSince(from: number): Promise<string[]> {
  return (await logLines()).slice(from).map((l) => l.text);
}
const logLength = async () => (await logLines()).length;

let rectangleFile = "";
/** Inside the rectangle, on screen. */
const INSIDE: [number, number] = [560, 400];

test("the owner's sequence: a rectangle in a fresh model, the extrude tool, a click inside — a solid; the log shows the plane typed and e1; the view did not turn", async () => {
  assert.equal(await defaultFrame(), null, "a fresh model has no frame");
  assert.equal((await app.model()).byKind.frame ?? 0, 0);

  await app.type("rectangle");
  await leftDrag([460, 320], [660, 480]);
  const drawn = await app.model();
  assert.equal(drawn.byKind.line, 4, "the rectangle");
  assert.equal(drawn.byKind.frame ?? 0, 0, "and still no frame");
  rectangleFile = await saved();
  await shot("1-rectangle");

  await app.type("extrude");
  assert.equal((await app.model()).activeTool, "extrude");
  const view = (await app.model()).view;
  const from = await logLength();
  await clickAt(...INSIDE);
  assert.deepEqual(await features(), [], "a click picks");
  await key("Enter");

  const lines = await logSince(from);
  assert.ok(!lines.some((l) => /lies in no frame's plane/.test(l)), `no refusal: ${lines.join(" | ")}`);
  const typed = lines.filter((l) => l.startsWith("> "));
  assert.equal(typed.length, 2, `two lines typed: ${lines.join(" | ")}`);
  assert.match(typed[0], /^> plane\("p\d+", "p\d+", "p\d+", \{ look: false \}\)$/);
  assert.match(typed[1], /^> extrude\("l\d+", 10\)$/);
  const made = await defaultFrame();
  assert.ok(made, "the plane is the default now");
  assert.equal(lines[lines.indexOf(typed[0]) + 1], made, "and the log answers with its name");
  assert.match(lines.at(-1)!, new RegExp(`^e1  extrude of l\\d+,l\\d+,l\\d+,l\\d+, depth d\\d+ = \\d+ along ${made}, lid f\\d+$`),
    "then says what the click made");
  assert.equal((await logLines()).at(-1)!.cls, "out", "as an answer, not an error");

  const [e1] = await features();
  assert.equal(e1?.name, "e1", "a solid");
  assert.equal(e1.frame, made);
  const z = await lidAlong(e1);
  assert.ok(dot(z, await toward()) > 0.99, `+z toward the viewer: ${z}`);
  assert.deepEqual((await app.model()).view, view, "the view did not turn");
  assert.equal((await app.model()).activeTool, "extrude", "built, and the tool stays armed");
  await key("Escape");
  assert.equal(await app.status(), "SOLVED");
  // Its sketch plane is three of the rectangle's own corners: no point was made for it.
  const m = await app.model();
  const [a, b, c] = [...typed[0].matchAll(/"(p\d+)"/g)].map((x) => x[1]);
  const corners = new Set(drawn.lines.flatMap((l) => l.refs));
  assert.ok([a, b, c].every((p) => corners.has(p)), `${a} ${b} ${c} are corners of the rectangle`);
  assert.equal(m.byKind.frame, 2, "the sketch plane and the lid's frame");
  await shot("2-solid");
});

test("one Ctrl+Z brings the rectangle back frameless: the solid and the plane made for it were one confirm", async () => {
  await key("Control+z");
  assert.deepEqual(await features(), [], "it takes the solid");
  assert.equal(await saved(), rectangleFile, "and the plane: the rectangle exactly as drawn");
  assert.equal(await defaultFrame(), null);
  assert.equal((await app.model()).byKind.frame ?? 0, 0);
  await shot("3-undone");
});

test("typed, extrude(\"l1\", 15) does the same as one step: the frame from the loop's points, then the solid toward the viewer", async () => {
  const view = (await app.model()).view;
  await app.type('extrude("l1", 15)');
  const log = await app.log();
  assert.ok(log.trimEnd().endsWith("e1"), `answered e1: ${log.slice(-200)}`);
  const [e1] = await features();
  assert.equal(e1.value, 15);
  assert.equal(e1.frame, await defaultFrame(), "made the default, as there was none");
  const z = await lidAlong(e1);
  assert.ok(dot(z, await toward()) > 0.99, `+z toward the viewer: ${z}`);
  assert.deepEqual((await app.model()).view, view, "the view did not turn");
  assert.equal(await app.status(), "SOLVED");
  // The file reopens to the same thing: the frame's entry is there before the extrude's that names it.
  const file = await saved();
  await app.type(`open(${JSON.stringify(file)})`);
  assert.equal(await app.status(), "SOLVED");
  assert.equal(await saved(), file, "byte-identical after a round trip");
  // Opening the same file changed nothing, so it is no undo step: one Ctrl+Z
  // is the typed line, and it takes the extrude and its frame together.
  await key("Control+z");
  assert.equal(await saved(), rectangleFile, "one step took the extrude and its frame together");
});

test("from a turned view, the tool's solid comes toward the viewer, and the view stays turned exactly as it was", async () => {
  await app.type("orbit(0.6, -0.5)");
  const seen = await toward();
  assert.ok(Math.abs(dot(seen, [0, 0, 1])) < 0.95, `turned off square: ${seen}`);
  const view = (await app.model()).view;
  await app.type("extrude");
  const centre = (await app.model()).points;
  const mid = Object.values(centre).reduce((s, p) => s.map((v, i) => v + p[i] / 4), [0, 0, 0]);
  await clickAt(...await app.screenOf(mid));
  await confirmAndRelease(app);
  const [e1] = await features();
  assert.equal(e1?.name, "e1");
  const z = await lidAlong(e1);
  assert.ok(dot(z, seen) > 0, `+z on the viewer's side: ${z} against ${seen}`);
  assert.deepEqual((await app.model()).view, view, "not turned square-on");
  assert.equal(await app.status(), "SOLVED");
  await shot("4-turned");
});
