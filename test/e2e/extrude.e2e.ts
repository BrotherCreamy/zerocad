// 3D phase 4 in a browser: a profile drawn with the real tools on a tilted
// sketch, extruded by a click inside it, its depth set, looked at, sketched
// on, undone, and saved.
//
// The unit suite has the mathematics; what only the assembled app can say is
// whether a profile drawn the way a person draws one — the rectangle, fillet
// and circle tools on a tilted plane, plus an island typed into the hole —
// extrudes, from one click inside it, into the solid its own coordinates say;
// whether `set` typed at the command line moves the lid; whether the *pixels*
// are what even-odd promises (looking square-on down the lid: material filled,
// the hole's ring showing straight through, the island solid) and, turned,
// whether every pixel of the depth layer is the face nearest there; whether a
// sketch on the lid extrudes again; whether one Ctrl+Z takes a whole feature
// away; and whether the file reopens. Positions are checked against the
// drawing's own coordinates and the sketch frame's +z computed here.
//
// One app, tests in order: the states are cumulative.

import { test, before, after } from "node:test";
import assert from "node:assert/strict";
import { checkPicture, openApp, type AppContext } from "./harness.ts";

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
/** A point of the sketch at (u, v), lifted `w` along its +z — w = 35 is the lid once the depth is set. */
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

async function moveTo(sx: number, sy: number): Promise<void> {
  const at = await app.at(sx, sy);
  await app.page.mouse.move(at.x, at.y, { steps: 3 });
  await app.page.waitForTimeout(120);
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

/** faces.ts's fill for a face square to the viewer, read from the module the app runs. */
const squareOnFill = (): Promise<number[]> => app.page.evaluate(async () => {
  const path = "/src/faces.ts";
  const { FACE_LIGHT } = await import(path);
  return [...FACE_LIGHT, 255];
});

/**
 * The first of `candidates` (lid points) whose pixel nothing pickable is
 * over — no point, edge or mark within reach, as the app itself says through
 * `hover()`. Sketch geometry seen through a solid crosses its faces, so a
 * probe is chosen from a few rather than hardcoded onto one that a mark
 * happens to cover.
 */
async function clearSpot(candidates: number[][]): Promise<[number, number] | null> {
  for (const w of candidates) {
    const at = await app.screenOf(w);
    await moveTo(...at);
    if ((await app.repl("hover()")).value === null) return at;
  }
  return null;
}

/** Points of the lid at radius r about (cu, cv), at a few angles. */
const around = (cu: number, cv: number, r: number) =>
  [135, 45, 225, 315, 180, 90, 270, 0].map((deg) => onG(cu + r * Math.cos((deg * Math.PI) / 180), cv + r * Math.sin((deg * Math.PI) / 180), 35));

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
  await app.type("orbit(0.5, 0.35)");
  beforeExtrude = await saved();
});

test("the extrude tool: the region under the cursor is outlined; a click on nothing is refused aloud; a click inside extrudes it, hole and island and all", async () => {
  const m0 = await app.model();
  await app.type('arm("extrude", { depth: 20 })');

  // Hovering between the hole and the outline tints the region green.
  const inside = await app.screenOf(onG(36, 34));
  await moveTo(...inside);
  const tint = await app.pixel(...inside, "drawing");
  assert.ok(tint[1] > 35 && tint[1] > tint[0] + 15, `the preview's green under the cursor: ${tint}`);

  // A click where there is no region says so, and the tool stays armed.
  await clickAt(...await app.screenOf(onG(95, 25)));
  assert.match(await app.log(), /extrude: no closed region under the click/);
  assert.equal((await app.model()).activeTool, "extrude");
  assert.deepEqual(await features(), []);

  await clickAt(...inside);
  assert.equal((await app.model()).activeTool, null, "one click, then the tool is done");
  assert.equal(await app.status(), "SOLVED");
  const [f] = await features();
  assert.equal(f.name, "e1");
  const arc = (await app.model()).arcs[0].name;
  assert.equal(f.loops.length, 3, "the outline, the hole, the island");
  assert.deepEqual(f.loops[0].slice().sort(), [...outline, arc].sort());
  assert.deepEqual(f.loops.slice(1), [[hole], [island]]);
  assert.equal(f.walls.length, 5, "five corners have walls; circles have none");
  await lidAt(f, 20);
  const m = await app.model();
  for (const [n, p] of Object.entries(m0.points)) assert.ok(dist3(m.points[n], p) < 1e-6, `${n} stayed`);
  // Journalled as the call a typed extrude makes, with the profile resolved.
  const last = await app.page.evaluate(() => (window as never as { __neocad: { model: { journal: { op: string; args: unknown[] }[] } } }).__neocad.model.journal.at(-1));
  assert.equal(last!.op, "extrude");
  assert.deepEqual(last!.args.slice(1, 3), [20, "f1"]);
  const ls = (await app.repl("ls()")).value as string[];
  assert.match(ls.at(-1)!, /^e1  extrude of .* \+ 2 inside, depth d\d+ = 20 along f1, lid f2$/);
});

test("one Ctrl+Z takes the whole feature away, and Ctrl+Shift+Z puts it back", async () => {
  const after = await saved();
  await key("Control+z");
  assert.deepEqual(await features(), []);
  assert.equal(await saved(), beforeExtrude, "back to the sketch, byte for byte");
  await key("Control+Shift+z");
  assert.equal(await saved(), after);
});

test("set the depth from the command line: the lid moves to 35, the walls stretch, the label says 35", async () => {
  const [f] = await features();
  await app.type(`set("${f.depth}.value", 35)`);
  assert.equal(await app.status(), "SOLVED");
  await lidAt(f, 35);
  const m = await app.model();
  for (const w of f.walls) {
    const l = m.lines.find((x) => x.name === w)!;
    assert.ok(Math.abs(dist3(m.points[l.refs[0]], m.points[l.refs[1]]) - 35) < 1e-6, `${w} is 35 long`);
  }
  const label = await app.page.evaluate((d) => {
    const { engine } = (window as never as { __neocad: { engine: { glyphs(): { relation: string; symbol: string }[] } } }).__neocad;
    return engine.glyphs().find((g) => g.relation === d)?.symbol;
  }, f.depth);
  assert.equal(label, "35");
});

test("looking straight down the lid, the pixels are even-odd: the cap is filled, the hole's ring shows straight through, the island is solid — and none of it picks", async () => {
  const [f] = await features();
  await app.type(`lookAt("${f.top}"); zoom(1.6)`);
  const fill = await squareOnFill();
  const probes: [string, number[][], "face" | "empty"][] = [
    ["the cap, between the outline and the hole", [onG(36, 34, 35), onG(40, 15, 35), onG(64, 35, 35), onG(35, 20, 35)], "face"],
    ["the ring between the hole and the island", around(48, 25, 6.5), "empty"],
    ["the island", around(48, 25, 2.2), "face"],
  ];
  for (const [what, candidates, want] of probes) {
    // Clear of every point, edge and mark: a face is under the cursor, and a
    // face picks nothing.
    const at = await clearSpot(candidates);
    assert.ok(at, `somewhere on ${what} is clear of the drawing's marks`);
    const px = await app.pixel(...at, "faces");
    if (want === "face") assert.deepEqual(px, fill, `${what}: the lid's square-on fill`);
    else assert.equal(px[3], 0, `${what}: nothing drawn, through both caps: ${px}`);
  }

  // With nothing armed, a click on a face is still a click on nothing: no
  // name typed, no feature, no region selected.
  const cap = await app.screenOf(onG(36, 34, 35));
  await clickAt(...cap);
  assert.equal(await app.page.$eval("#cmd", (el) => (el as HTMLInputElement).value), "");
  assert.equal((await features()).length, 1);
});

test("a circle sketched on the lid, on the lid's own frame, extrudes again by a click inside it: a boss", async () => {
  const [f] = await features();
  await app.type(`setDefaultFrame("${f.top}")`);
  await app.type("circle");
  const c = await app.screenOf(onG(60, 33, 35));
  await leftDrag(c, [c[0] - 3 * (await app.model()).view.scale, c[1]]);
  const m = await app.model();
  const boss = m.circles.at(-1)!;
  assert.ok(Math.abs(m.radii[boss.name] - 3) < 1e-3, `radius 3: ${m.radii[boss.name]}`);
  assert.ok(Math.abs(dot(sub(m.points[boss.center], onG(0, 0, 35)), G_Z)) < 1e-6, "on the lid's plane");

  await app.type('arm("extrude", { depth: 10 })');
  await clickAt(...await app.screenOf(onG(60.5, 33.5, 35)));
  const all = await features();
  assert.equal(all.length, 2);
  const g = all[1];
  assert.deepEqual(g.loops, [[boss.name]], "the innermost region under the click: the circle, not the lid round it");
  await lidAt(g, 10);
  const m2 = await app.model();
  const twin = g.pairs.find(([b]) => b === boss.center)![1];
  assert.ok(Math.abs(dot(sub(m2.points[twin], onG(0, 0, 45)), G_Z)) < 1e-6, "the boss's lid is 45 up");
  assert.equal(await app.status(), "SOLVED");
});

test("turned, the solid is shaded by depth: every pixel off an outline is the nearest face's own shade — both lids over their walls — and the screen shows a lid pixel as it is", async () => {
  await app.type("orbit(0.45, 0.4)");
  assert.equal(await app.renderer(), "depth", "the depth layer draws the faces, not the painter's fallback");
  const pic = await checkPicture(app, 6);
  assert.ok(pic.onFace > 300, `${pic.onFace} samples on the solids`);
  assert.deepEqual(pic.wrong, [], "every sample is the face nearest the viewer there");
  for (const face of ["e1.lid", "e2.lid", "e1.wall"]) assert.ok(pic.seen.has(face), `${face} is in the picture: ${[...pic.seen]}`);

  // What the eye gets: at a spot of the lid clear of every mark (asked of the
  // app's own hover), the composed picture is the lid's own fill.
  const at = await clearSpot([onG(36, 34, 35), onG(40, 15, 35), onG(35, 20, 35), onG(64, 35, 35), onG(55, 14, 35), onG(33, 37, 35)]);
  assert.ok(at, "somewhere on the lid is clear of the drawing's marks");
  const [{ face }] = await app.nearestFaces([at]);
  assert.equal(`${face?.feature}.${face?.kind}`, "e1.lid");
  assert.deepEqual(await app.pixel(...at, "screen"), [...face!.rgb, 255]);
  await app.page.mouse.move(5, 5);
});

test("hovering a wall names the feature it belongs to", async () => {
  const [f] = await features();
  const m = await app.model();
  // Somewhere along some wall the wall itself is what is under the cursor.
  let found = "";
  for (const name of f.walls) {
    const wall = m.lines.find((x) => x.name === name)!;
    const [a, b] = [await app.screenOf(m.points[wall.refs[0]]), await app.screenOf(m.points[wall.refs[1]])];
    for (const t of [0.5, 0.35, 0.65]) {
      await moveTo(a[0] + t * (b[0] - a[0]), a[1] + t * (b[1] - a[1]));
      if ((await app.repl("hover()")).value === name) { found = name; break; }
    }
    if (found) break;
  }
  assert.ok(found, "a wall can be hovered");
  assert.match(await app.page.$eval("#hovertag", (el) => el.textContent ?? ""), /·\s+e1$/);
  await app.page.mouse.move(5, 5);
});

test("save and open: the same file back, byte for byte, both solids in it", async () => {
  const file = await saved();
  await app.type(`open(${JSON.stringify(file)})`);
  assert.equal(await app.status(), "SOLVED");
  assert.equal(await saved(), file);
  const all = await features();
  assert.deepEqual(all.map((x) => [x.name, x.value]), [["e1", 35], ["e2", 10]]);
});

test('del("e2", "e1") takes both solids and leaves the sketch — the same entities, not moved by the deletion', async () => {
  const before = await app.model();
  const bossCentre = before.circles.at(-2)!.center; // the circle drawn on the lid, before its twin
  await app.type('del("e2", "e1")');
  assert.deepEqual(await features(), []);
  const now = JSON.parse(await saved());
  const was = JSON.parse(beforeExtrude);
  // The sketch's entities, and nothing of either solid — except the centre of
  // the circle drawn on the lid. The circle went with the lid frame it was
  // drawn on, which it cannot be without; its centre is a point the circle
  // tool placed, and deleting a circle never takes its points.
  const after = await app.model();
  assert.ok(!after.circles.some((c) => c.center === bossCentre), "the lid's circle is gone");
  assert.deepEqual(Object.keys(now.values.points).sort(), [...Object.keys(was.values.points), bossCentre].sort());
  // Compared with just before the deletion, not with before the extrude: the
  // tools draw an undimensioned sketch, and the solves since were free to move
  // it within its own freedom (a corner wandered 1e-5 during the `set`). What
  // the deletion must not do is move it at all.
  for (const n of Object.keys(was.values.points)) {
    assert.ok(dist3(now.values.points[n], before.points[n]) < 1e-9, `${n} did not move`);
  }
  assert.equal(await app.status(), "SOLVED");
});

test("no uncaught page errors", () => {
  assert.deepEqual(app.pageErrors, []);
});
