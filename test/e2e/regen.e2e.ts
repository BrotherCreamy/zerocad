// Feature regeneration in a browser: a rectangle from the rectangle tool on a
// tilted sketch, extruded by a click inside it, then one of its base corners
// rounded with the fillet tool — two clicks, as anyone would do it.
//
// This is the bug the package exists for, and it was a picture before it was
// a number: before regeneration the lid stayed four-cornered over a rounded
// base, one lid edge leaning from above the tangent point to the far corner,
// with every relation satisfied. What only the assembled app can say is
// whether the lid a person sees after that fillet is rounded exactly as the
// base is — a twin arc over the arc, a wall at the new tangent point — whether
// `set` on the depth carries the rounded lid, whether one Ctrl+Z takes the
// fillet away and brings the four-cornered lid back, and whether the file
// reopens to itself. Positions are checked against the sketch frame's +z
// computed here. Set NEOCAD_E2E_SHOTS to a directory to keep the screenshots;
// look at them.
//
// One app, tests in order: the states are cumulative.

import { test, before, after } from "node:test";
import assert from "node:assert/strict";
import { mkdirSync } from "node:fs";
import { join } from "node:path";
import { openApp, type AppContext, confirmAndRelease } from "./harness.ts";

let app: AppContext;
before(async () => { app = await openApp(); });
after(async () => { await app.close(); });

const SHOTS = process.env.NEOCAD_E2E_SHOTS;
async function shot(name: string): Promise<void> {
  if (!SHOTS) return;
  mkdirSync(SHOTS, { recursive: true });
  await app.page.waitForTimeout(120);
  await app.page.screenshot({ path: join(SHOTS, `regen-${name}.png`) });
}

const sub = (a: number[], b: number[]) => a.map((x, i) => x - b[i]);
const dist3 = (a: number[], b: number[]) => Math.hypot(...sub(a, b));

/** The sketch plane: extrude.e2e.ts's, +x up 30°, +y leaning back 25°. */
const A = (30 * Math.PI) / 180, B = (25 * Math.PI) / 180;
const G_O = [10, 5, 6];
const G_X = [Math.cos(A), 0, Math.sin(A)];
const G_Y = [-Math.sin(A) * Math.sin(B), Math.cos(B), Math.cos(A) * Math.sin(B)];
const G_Z = [G_X[1] * G_Y[2] - G_X[2] * G_Y[1], G_X[2] * G_Y[0] - G_X[0] * G_Y[2], G_X[0] * G_Y[1] - G_X[1] * G_Y[0]];
/** A point of the sketch at (u, v), lifted `w` along its +z. */
const onG = (u: number, v: number, w = 0) => G_O.map((o, i) => o + u * G_X[i] + v * G_Y[i] + w * G_Z[i]);

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

/** Every point twin of a feature sits at its base plus `depth` along +z. */
async function lidAt(f: SeenFeature, depth: number): Promise<void> {
  const m = await app.model();
  for (const [base, twin] of f.pairs) {
    if (!(base in m.points)) continue; // a radius pair
    const off = sub(m.points[twin], m.points[base]);
    assert.ok(dist3(off, G_Z.map((z) => depth * z)) < 1e-6, `${twin} is ${base} + ${depth}·z: ${off}`);
  }
}

/** Where along an edge a click lands on the edge itself, clear of its marks. */
async function onEdge(name: string, t: number): Promise<[number, number]> {
  const m = await app.model();
  const l = m.lines.find((x) => x.name === name)!;
  const [a, b] = [await app.screenOf(m.points[l.refs[0]]), await app.screenOf(m.points[l.refs[1]])];
  return [a[0] + t * (b[0] - a[0]), a[1] + t * (b[1] - a[1])];
}

/** Pans so a world point sits in the middle of the canvas, clear of the panels. */
async function centre(w: number[]): Promise<void> {
  const [x, y] = await app.screenOf(w);
  await app.type(`pan(${Math.round(700 - x)}, ${Math.round(330 - y)})`);
}

let outline: string[] = [];
let corner = { legOne: "", legTwo: "", at: "" };
let beforeFillet = "";

test("a rectangle from the tool on a tilted sketch, extruded by a click inside it and Enter", async () => {
  const at = (p: number[]) => `pt(${p.join(", ")})`;
  await app.type(`go = ${at(G_O)}; gx = ${at(onG(20, 0))}; gy = ${at(onG(0, 20))}; g = plane(go, gx, gy)`);
  await app.type("rectangle");
  await leftDrag(await app.screenOf(onG(30, 10)), await app.screenOf(onG(70, 40)));
  const m = await app.model();
  outline = m.lines.map((l) => l.name);
  assert.equal(outline.length, 4);
  await app.type('arm("extrude", { depth: 20 })');
  await clickAt(...await app.screenOf(onG(50, 25)));
  await confirmAndRelease(app);
  const [f] = await features();
  assert.equal(f.name, "e1");
  assert.equal(f.walls.length, 4);
  await lidAt(f, 20);
  assert.equal(await app.status(), "SOLVED");
  // Turned, so the base's edges and the lid's are apart on screen and a click
  // can choose between them.
  await app.type("orbit(0.5, 0.35)");
  await centre(onG(50, 25, 10));
  await app.type("zoom(2.6)");
  await centre(onG(50, 25, 10));
  await app.page.mouse.move(5, 5);
  await shot("extruded");
  // The two base edges meeting at the corner nearest (70, 10).
  const m2 = await app.model();
  const near = (p: string) => dist3(m2.points[p], onG(70, 10));
  const lines = outline.map((n) => m2.lines.find((l) => l.name === n)!);
  const atCorner = lines.filter((l) => l.refs.some((p) => near(p) < 1e-3));
  assert.equal(atCorner.length, 2, "two edges meet at the corner");
  corner = {
    legOne: atCorner[0].name, legTwo: atCorner[1].name,
    at: atCorner[0].refs.find((p) => atCorner[1].refs.includes(p))!,
  };
  beforeFillet = await saved();
});

let afterFillet = "";

test("the fillet tool rounds a base corner — and the lid is rounded exactly as the base is", async () => {
  const journal = (await app.model()).journalOps.length;
  await app.type('arm("fillet", { radius: 8 })');
  await clickAt(...await onEdge(corner.legOne, 0.4));
  await clickAt(...await onEdge(corner.legTwo, 0.4));
  await app.page.mouse.move(5, 5);
  await shot("fillet-previewed");
  await confirmAndRelease(app);
  await shot("filleted");
  assert.equal(await app.status(), "SOLVED");
  const m = await app.model();
  assert.equal(m.byKind.arc, 2, `the arc, and its twin on the lid: ${JSON.stringify(m.arcs)}`);
  assert.equal(m.journalOps.length, journal + 1, "one entry: the fillet, regenerating inside it");
  assert.equal(m.journalOps.at(-1), "fillet");
  const [f] = await features();
  assert.equal(f.name, "e1");
  assert.equal(f.loops[0].length, 5, "the profile runs round the arc");
  assert.equal(f.walls.length, 5, "a wall at the new tangent point too");
  await lidAt(f, 20);
  // The twin arc: on the lid frame, about the centre's twin, the base arc's radius.
  const [base, twin] = [m.arcs[0], m.arcs[1]];
  const pairOf = (b: string) => f.pairs.find(([x]) => x === b)?.[1];
  assert.equal(twin.center, pairOf(base.center));
  assert.equal(twin.start, pairOf(base.start));
  assert.equal(twin.end, pairOf(base.end));
  assert.ok(Math.abs(m.radii[twin.name] - 8) < 1e-6);
  // In the sketch's own terms: the lid's arc sits 20 over the base's, rounded
  // exactly as it is.
  assert.ok(dist3(m.points[twin.center], m.points[base.center].map((c, i) => c + 20 * G_Z[i])) < 1e-6);
  // Leg two's twin is the edge it was, re-pointed at the new tangent point's twin.
  const legTwo = m.lines.find((l) => l.name === corner.legTwo)!;
  const twinLegTwo = m.lines.find((l) => l.name === f.twins[0][f.loops[0].indexOf(corner.legTwo)])!;
  assert.deepEqual(twinLegTwo.refs, legTwo.refs.map((p) => pairOf(p)));
  afterFillet = await saved();
});

test("turned, the lid shows its rounded corner over the base's", async () => {
  await app.type("orbit(-0.9, 0.25)");
  await centre(onG(50, 25, 10));
  await app.page.mouse.move(5, 5);
  await shot("filleted-turned");
  await app.type("orbit(0.9, -0.25)");
  await centre(onG(50, 25, 10));
});

test("set the depth from the command line: the rounded lid moves to 35, twin arc and all", async () => {
  const [f] = await features();
  await app.type(`set("${f.depth}.value", 35)`);
  assert.equal(await app.status(), "SOLVED");
  await lidAt((await features())[0], 35);
  const m = await app.model();
  for (const w of f.walls) {
    const l = m.lines.find((x) => x.name === w)!;
    assert.ok(Math.abs(dist3(m.points[l.refs[0]], m.points[l.refs[1]]) - 35) < 1e-6, `${w} is 35 long`);
  }
  await app.page.mouse.move(5, 5);
  await shot("set");
  await key("Control+z");
  assert.equal(await saved(), afterFillet, "the set undone, byte for byte");
});

test("one Ctrl+Z takes the fillet away and brings the four-cornered lid back; Ctrl+Shift+Z rounds it again", async () => {
  await key("Control+z");
  assert.equal(await saved(), beforeFillet, "back to the extruded rectangle, byte for byte");
  const [f] = await features();
  assert.equal(f.loops[0].length, 4);
  assert.equal(f.walls.length, 4);
  assert.equal((await app.model()).byKind.arc ?? 0, 0);
  await app.page.mouse.move(5, 5);
  await shot("undone");
  await key("Control+Shift+z");
  assert.equal(await saved(), afterFillet);
});

test("save and open: the same file back, byte for byte, the lid still rounded — and regen on it changes nothing", async () => {
  const file = await saved();
  assert.equal(JSON.parse(file).version, 9);
  await app.type(`open(${JSON.stringify(file)})`);
  assert.equal(await app.status(), "SOLVED");
  assert.equal(await saved(), file);
  const [f] = await features();
  assert.equal(f.loops[0].length, 5);
  assert.equal((await app.model()).byKind.arc, 2);
  await lidAt(f, 20);
  const before = await app.model();
  await app.type(`regen("${f.name}")`);
  assert.equal(await app.status(), "SOLVED");
  const after = await app.model();
  assert.deepEqual(Object.keys(after.points), Object.keys(before.points), "no name made or lost");
  assert.deepEqual(after.journalOps, [...before.journalOps, "regen"]);
});

test("no uncaught page errors", () => {
  assert.deepEqual(app.pageErrors, []);
});
