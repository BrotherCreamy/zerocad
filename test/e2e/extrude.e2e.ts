// 3D phase 4 in a browser: a profile drawn with the real tools on a tilted
// sketch, extruded, its depth set, undone, and saved.
//
// The unit suite has the mathematics; what only the assembled app can say is
// whether a profile drawn the way a person draws one — the rectangle, fillet
// and circle tools on a tilted plane, plus an island typed into the hole —
// extrudes into the solid its own coordinates say it should, whether `set`
// typed at the command line moves the lid and the header stays honest, whether
// one Ctrl+Z takes the whole feature away, and whether the file reopens.
// Every position is checked against the drawing's own coordinates and the
// sketch frame's +z computed here, never against `solved: true`.
//
// One app, tests in order: the states are cumulative.

import { test, before, after } from "node:test";
import assert from "node:assert/strict";
import { openApp, type AppContext } from "./harness.ts";

let app: AppContext;
before(async () => { app = await openApp(); });
after(async () => { await app.close(); });

const dot = (a: number[], b: number[]) => a.reduce((s, x, i) => s + x * b[i], 0);
const sub = (a: number[], b: number[]) => a.map((x, i) => x - b[i]);
const dist3 = (a: number[], b: number[]) => Math.hypot(...sub(a, b));

/** The sketch plane: planar.e2e.ts's and loops.e2e.ts's, +x up 30°, +y leaning back 25°. */
const A = (30 * Math.PI) / 180, B = (25 * Math.PI) / 180;
const G_O = [10, 5, 6];
const G_X = [Math.cos(A), 0, Math.sin(A)];
const G_Y = [-Math.sin(A) * Math.sin(B), Math.cos(B), Math.cos(A) * Math.sin(B)];
const G_Z = [G_X[1] * G_Y[2] - G_X[2] * G_Y[1], G_X[2] * G_Y[0] - G_X[0] * G_Y[2], G_X[0] * G_Y[1] - G_X[1] * G_Y[0]];
const onG = (u: number, v: number) => G_O.map((o, i) => o + u * G_X[i] + v * G_Y[i]);

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
  await app.page.mouse.click(at.x, at.y);
  await app.page.waitForTimeout(150);
}

async function key(combo: string): Promise<void> {
  await app.page.fill("#cmd", "");
  await app.page.keyboard.press(combo);
  await app.page.waitForTimeout(220);
}

async function saved(): Promise<string> {
  const r = await app.repl("save()");
  assert.equal(r.ok, true, r.error ?? "");
  return r.value as string;
}

interface SeenFeature {
  name: string; loops: string[][]; twins: string[][]; walls: string[]; top: string; depth: string; owns: string[];
  pairs: [string, string][]; value: number;
}

/** The app's features, with each depth's base/twin pairs read off its relation. */
const features = (): Promise<SeenFeature[]> => app.page.evaluate(() => {
  const { model } = (window as never as { __neocad: { model: {
    features: Map<string, { name: string; loops: string[][]; twins: string[][]; walls: string[]; top: string; depth: string; owns: string[] }>;
    relations: Map<string, { args: unknown[] }>;
  } } }).__neocad;
  return [...model.features.values()].map((f) => {
    const args = model.relations.get(f.depth)!.args;
    const pairs: [string, string][] = [];
    for (let i = 2; i < args.length; i += 2) pairs.push([args[i] as string, args[i + 1] as string]);
    return { ...f, pairs, value: args[1] as number };
  });
});

let outline: string[] = [];
let hole = "";
let island = "";
let beforeExtrude = "";

test("on a tilted sketch: a rectangle, a filleted corner and a hole from the tools, an island typed into the hole", async () => {
  const at = (p: number[]) => `pt(${p.join(", ")})`;
  await app.type(`go = ${at(G_O)}; gx = ${at(onG(20, 0))}; gy = ${at(onG(0, 20))}; g = plane(go, gx, gy)`);
  await app.type("rectangle");
  await leftDrag(await app.screenOf(onG(30, 10)), await app.screenOf(onG(70, 40)));
  let m = await app.model();
  outline = m.lines.map((l) => l.name);
  await app.type('arm("fillet", { radius: 8 })');
  await clickAt(...await app.screenOf(onG(50, 10)));
  await clickAt(...await app.screenOf(onG(70, 25)));
  await app.type("circle");
  const c = await app.screenOf(onG(48, 25));
  await leftDrag(c, [c[0] - 9 * (await app.model()).view.scale, c[1]]);
  m = await app.model();
  hole = m.circles[0].name;
  assert.ok(Math.abs(m.radii[hole] - 9) < 1e-3, `a hole of radius 9: ${m.radii[hole]}`);
  // The island: a circle on the sketch, concentric with the hole, typed.
  await app.type(`ic = ${at(onG(48, 25))}; onplane(ic); island = circ(ic, 4)`);
  island = (await app.repl("island")).value as string;
  assert.equal(await app.status(), "SOLVED");
  await app.type("orbit(0.5, -0.35)");
  beforeExtrude = await saved();
});

test('extrude("l1", 20) typed: one feature, the hole and the island in its profile, every twin its base plus 20 along the sketch\'s +z', async () => {
  const m0 = await app.model();
  await app.type(`extrude("${outline[0]}", 20)`);
  assert.match(await app.log(), /> extrude\("l1", 20\)e1/, "the entry printed the feature it made");
  assert.equal(await app.status(), "SOLVED");
  const [f] = await features();
  assert.equal(f.name, "e1");
  const arc = (await app.model()).arcs[0].name;
  assert.equal(f.loops.length, 3, "the outline, the hole, the island");
  assert.deepEqual(f.loops[0].slice().sort(), [...outline, arc].sort());
  assert.deepEqual(f.loops.slice(1), [[hole], [island]]);
  // Five corners have walls; circles have none.
  assert.equal(f.walls.length, 5);

  const m = await app.model();
  for (const [base, twin] of f.pairs) {
    if (!(base in m.points)) continue; // a radius pair
    const off = sub(m.points[twin], m.points[base]);
    assert.ok(dist3(off, G_Z.map((z) => 20 * z)) < 1e-6, `${twin} is ${base} + 20·z: ${off}`);
  }
  // Nothing of the sketch moved.
  for (const [n, p] of Object.entries(m0.points)) assert.ok(dist3(m.points[n], p) < 1e-6, `${n} stayed`);
  const ls = (await app.repl("ls()")).value as string[];
  assert.match(ls.at(-1)!, /^e1  extrude of .* \+ 2 inside, depth d\d+ = 20 along f1, lid f2$/);
});

test("set the depth from the command line: the lid moves to 35, the walls stretch, the header stays SOLVED", async () => {
  const [f] = await features();
  await app.type(`set("${f.depth}.value", 35)`);
  assert.equal(await app.status(), "SOLVED");
  const m = await app.model();
  for (const [base, twin] of f.pairs) {
    if (!(base in m.points)) continue;
    assert.ok(dist3(sub(m.points[twin], m.points[base]), G_Z.map((z) => 35 * z)) < 1e-6, twin);
  }
  for (const w of f.walls) {
    const l = m.lines.find((x) => x.name === w)!;
    assert.ok(Math.abs(dist3(m.points[l.refs[0]], m.points[l.refs[1]]) - 35) < 1e-6, `${w} is 35 long`);
  }
  // The depth's label says so.
  const label = await app.page.evaluate((d) => {
    const { engine } = (window as never as { __neocad: { engine: { glyphs(): { relation: string; symbol: string }[] } } }).__neocad;
    return engine.glyphs().find((g) => g.relation === d)?.symbol;
  }, f.depth);
  assert.equal(label, "35");
});

test("hovering a wall names the feature it belongs to", async () => {
  const [f] = await features();
  const m = await app.model();
  const wall = m.lines.find((x) => x.name === f.walls[2])!;
  const [a, b] = [await app.screenOf(m.points[wall.refs[0]]), await app.screenOf(m.points[wall.refs[1]])];
  const at = await app.at((a[0] * 2 + b[0]) / 3, (a[1] * 2 + b[1]) / 3);
  await app.page.mouse.move(at.x, at.y, { steps: 3 });
  await app.page.waitForTimeout(120);
  assert.equal((await app.repl("hover()")).value, wall.name);
  assert.match(await app.page.$eval("#hovertag", (el) => el.textContent ?? ""), /·\s+e1$/);
  await app.page.mouse.move(5, 5);
});

test("Ctrl+Z undoes the set, and one more takes the whole feature away; redo brings both back", async () => {
  const afterSet = await saved();
  await key("Control+z");
  assert.equal((await features())[0].value, 20, "the set, undone");
  await key("Control+z");
  assert.deepEqual(await features(), [], "the extrude, undone in one step");
  assert.equal(await saved(), beforeExtrude, "back to the sketch, byte for byte");
  await key("Control+Shift+z");
  await key("Control+Shift+z");
  assert.equal(await saved(), afterSet);
  assert.equal(await app.status(), "SOLVED");
});

test("save and open: the same file back, byte for byte, with the solid in it", async () => {
  const file = await saved();
  await app.type(`open(${JSON.stringify(file)})`);
  assert.equal(await app.status(), "SOLVED");
  assert.equal(await saved(), file);
  const [f] = await features();
  assert.equal(f.name, "e1");
  assert.equal(f.value, 35);
});

test('del("e1") takes the solid and leaves the sketch — the same entities, not moved by the deletion', async () => {
  const before = (await app.model()).points;
  await app.type('del("e1")');
  assert.deepEqual(await features(), []);
  const now = JSON.parse(await saved());
  const was = JSON.parse(beforeExtrude);
  // The same entities as before the extrude; the journal now also says what was
  // made and removed, which is the history and not the drawing.
  assert.deepEqual(Object.keys(now.values.points).sort(), Object.keys(was.values.points).sort());
  // Compared with just before the deletion, not with before the extrude: the
  // tools draw an undimensioned sketch, and the solves since were free to move
  // it within its own freedom (a corner wandered 1e-5 during the `set`). What
  // the deletion must not do is move it at all.
  for (const n of Object.keys(was.values.points)) {
    assert.ok(dist3(now.values.points[n], before[n]) < 1e-9, `${n} did not move`);
  }
  assert.equal(await app.status(), "SOLVED");
});

test("no uncaught page errors", () => {
  assert.deepEqual(app.pageErrors, []);
});
