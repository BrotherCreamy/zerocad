// Regions split by a crossing, in a browser: a rectangle from the rectangle
// tool and a line drawn across it with the line tool, on a tilted sketch
// plane; then extrude armed, each half hovered — and each half extruded to its
// own depth, a stepped block from one sketch, Onshape's way. Then a lens of
// two crossing circles drawn with the circle tool, extruded by a click inside
// it.
//
// The unit suite has the mathematics (test/loops.test.ts: every case in
// docs/plans/regions-split.md, in 2D and on a tilted plane;
// test/regionfeatures.test.ts: the features over them). What only the
// assembled app can say is whether a line a person draws across a rectangle
// cuts it where the region preview can see — the green outline stopping at
// the crossing rather than running on round the whole rectangle — and whether
// a click there builds that half and no more: a solid whose walls stop at the
// line, whose second step stands beside the first, whose depth a `set` moves,
// which one Ctrl+Z takes away and a save/open brings back. Positions are
// checked against the canvas's own pixels as well as the model. Set
// NEOCAD_E2E_SHOTS to a directory to keep the screenshots; look at them.
//
// One app, tests in order: the states are cumulative.

import { test, before, after } from "node:test";
import assert from "node:assert/strict";
import { mkdirSync } from "node:fs";
import { join } from "node:path";
import { openApp, type AppContext } from "./harness.ts";

let app: AppContext;
before(async () => { app = await openApp(); });
after(async () => { await app.close(); });

const SHOTS = process.env.NEOCAD_E2E_SHOTS;
/** The page as it is — the hover left where it is, since the hover is the point. */
async function shot(name: string): Promise<void> {
  if (!SHOTS) return;
  mkdirSync(SHOTS, { recursive: true });
  await app.page.waitForTimeout(120);
  await app.page.screenshot({ path: join(SHOTS, `regions-${name}.png`) });
}

/** The sketch plane: loops.e2e.ts's and extrude.e2e.ts's, +x up 30°, +y leaning back 25°. */
const A = (30 * Math.PI) / 180, B = (25 * Math.PI) / 180;
const G_O = [10, 5, 6];
const G_X = [Math.cos(A), 0, Math.sin(A)];
const G_Y = [-Math.sin(A) * Math.sin(B), Math.cos(B), Math.cos(A) * Math.sin(B)];
const G_Z = [G_X[1] * G_Y[2] - G_X[2] * G_Y[1], G_X[2] * G_Y[0] - G_X[0] * G_Y[2], G_X[0] * G_Y[1] - G_X[1] * G_Y[0]];
/** A point of the sketch at (u, v), lifted `w` along its +z. */
const onG = (u: number, v: number, w = 0) => G_O.map((o, i) => o + u * G_X[i] + v * G_Y[i] + w * G_Z[i]);
/** A world point's (u, v, w) on the sketch plane. */
const inG = (p: number[]) => [G_X, G_Y, G_Z].map((ax) => ax.reduce((s, a, i) => s + a * (p[i] - G_O[i]), 0));

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
  await app.page.mouse.move(at.x, at.y);
  await app.page.waitForTimeout(40);
  await app.page.mouse.click(at.x, at.y);
  await app.page.waitForTimeout(160);
}

async function moveTo(sx: number, sy: number): Promise<void> {
  const at = await app.at(sx, sy);
  await app.page.mouse.move(at.x, at.y, { steps: 3 });
  await app.page.waitForTimeout(150);
}

/** The canvas's own pixel at (sx, sy), as drawn. */
const pixel = (sx: number, sy: number): Promise<number[]> => app.page.evaluate(([x, y]) => {
  const cv = document.getElementById("cv") as HTMLCanvasElement;
  const dpr = devicePixelRatio || 1;
  return [...cv.getContext("2d")!.getImageData(Math.round(x * dpr), Math.round(y * dpr), 1, 1).data];
}, [sx, sy]);

/**
 * Whether the sketch's point (u, v) is drawn in the region tools' green
 * (`REGION_GREEN`, #55c07a) — clearly greener than red and blue, which neither
 * an edge's own blue-grey (#afc6d9) nor the faint fill over the background is.
 */
async function green(u: number, v: number): Promise<boolean> {
  const [r, g, b] = await pixel(...await app.screenOf(onG(u, v)));
  return g > r + 50 && g > b + 30;
}

let journal = 0;

test("on a tilted sketch: a rectangle from the tool, and a line across it from the line tool, past both edges", async () => {
  const at = (p: number[]) => `pt(${p.join(", ")})`;
  await app.type(`go = ${at(G_O)}; gx = ${at(onG(20, 0))}; gy = ${at(onG(0, 20))}; g = plane(go, gx, gy)`);
  assert.equal((await app.repl("defaultFrame()")).value, "f1");

  await app.type("rectangle");
  await leftDrag(await app.screenOf(onG(30, 10)), await app.screenOf(onG(70, 40)));
  await app.type("line");
  await clickAt(...await app.screenOf(onG(45, -5)));
  await clickAt(...await app.screenOf(onG(45, 55)));
  await app.page.press("#cmd", "Escape");
  await app.page.waitForTimeout(150);
  // Closer, and clear of the panels, so the pictures show what a hover shows.
  await app.type("zoom(2.5)");
  const [cx, cy] = await app.screenOf(onG(50, 25));
  await app.type(`pan(${Math.round(700 - cx)}, ${Math.round(330 - cy)})`);
  const centred = await app.screenOf(onG(50, 25));
  assert.ok(Math.hypot(centred[0] - 700, centred[1] - 330) < 1, `the rectangle's middle is drawn at ${centred}`);
  const m = await app.model();
  assert.equal(m.lines.length, 5, "four sides and the line across");
  assert.equal(await app.status(), "SOLVED");

  // loops() says two regions, each bounded by parts of the edges the line
  // crosses and the part of the line between them — 15 × 30 and 25 × 30.
  const listed = (await app.repl("loops()")).value as string[];
  assert.equal(listed.length, 2, listed.join(" | "));
  const across = m.lines[4].name;
  assert.ok(listed.every((l) => l.includes(`${across}[`) && l.includes("×")), listed.join(" | "));
  const areas = listed.map((l) => Number(l.match(/area ([\d.]+)/)![1]));
  assert.ok(Math.abs(areas[0] - 450) < 1e-3 && Math.abs(areas[1] - 750) < 1e-3, `areas ${areas}`);
  journal = (await app.model()).journalOps.length;
});

test("extrude armed, each half hovered: the green outline runs to the crossing and stops there", async () => {
  await app.type("extrude");
  assert.equal((await app.model()).activeTool, "extrude");

  await moveTo(...await app.screenOf(onG(37, 25)));
  await shot("hover-left");
  assert.ok(await green(37, 10), "the left half's bottom edge is outlined");
  assert.ok(!(await green(60, 10)), "the bottom edge past the crossing is not");
  assert.ok(!(await green(70, 25)), "nor is the far side");
  assert.ok(await green(45, 25), "the line between the crossings is an edge of this half");
  assert.ok(!(await green(45, 0)), "and the line's stub outside the rectangle is an edge of nothing");

  await moveTo(...await app.screenOf(onG(60, 25)));
  await shot("hover-right");
  assert.ok(await green(60, 10), "now the right half's bottom edge is");
  assert.ok(!(await green(37, 10)), "and the left half's is not");
  assert.ok(await green(70, 25) && await green(45, 25));
  assert.ok(!(await green(30, 25)), "the left side is no edge of this half");
});

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

type Member = string | { name: string; from: string; to: string };
interface SeenFeature { name: string; loops: Member[][]; walls: string[]; owns: string[]; names: string[]; depth: string; pairs: [string, string][]; value: number }

/** The app's extrudes, with each depth's base/twin pairs read off its relation. */
const features = (): Promise<SeenFeature[]> => app.page.evaluate(() => {
  const { model } = (window as never as { __neocad: { model: {
    features: Map<string, { name: string; loops: Member[][]; walls: string[]; owns: string[]; names: string[]; depth: string }>;
    relations: Map<string, { args: unknown[] }>;
  } } }).__neocad;
  return [...model.features.values()].map((f) => {
    const args = model.relations.get(f.depth)!.args;
    const pairs: [string, string][] = [];
    for (let i = 2; i < args.length; i += 2) pairs.push([args[i] as string, args[i + 1] as string]);
    return { ...f, pairs, value: args[1] as number };
  });
});

/** Every point twin of a feature sits at its base plus `depth` along the sketch's +z. */
async function lidAt(f: SeenFeature, depth: number): Promise<void> {
  const m = await app.model();
  for (const [base, twin] of f.pairs) {
    if (!(base in m.points)) continue; // a radius pair
    const off = inG(m.points[twin].map((c, i) => c - m.points[base][i] + G_O[i]));
    assert.ok(Math.hypot(off[0], off[1], off[2] - depth) < 1e-6, `${twin} is ${base} + ${depth}·z: ${off}`);
  }
}

/** The points a feature made at crossings: the ends of its portions that it owns. */
const crossingsOf = (f: SeenFeature) =>
  [...new Set(f.loops.flat().flatMap((m) => (typeof m === "string" ? [] : [m.from, m.to])))].filter((p) => f.owns.includes(p));

let beforeSteps = "";
let x1 = "", x2 = "";

test("a click in the right half extrudes that half — its walls stop at the line, the crossings made points held on both edges", async () => {
  beforeSteps = await saved();
  await app.type('arm("extrude", { depth: 20 })');
  await clickAt(...await app.screenOf(onG(60, 25)));
  const log = await app.log();
  assert.doesNotMatch(log, /extrude: /, "nothing refused");
  const [f] = await features();
  assert.ok(f, "a feature");
  assert.equal(f.name, "e1");
  const m = await app.model();
  const across = m.lines[4].name;
  [x1, x2] = crossingsOf(f);
  assert.ok(x1 && x2, `two crossings made points: ${JSON.stringify(f.loops)}`);
  for (const [x, v] of [[x1, 10], [x2, 40]] as const) {
    const at = inG(m.points[x]);
    assert.ok(Math.hypot(at[0] - 45, at[1] - v, at[2]) < 1e-6, `${x} where the line crosses v = ${v}: ${at}`);
  }
  const rels = (await app.repl(`rels("${x1}")`)).value as string[];
  assert.ok(rels.some((r) => r.includes(`on ${x1} ${across}`)), rels.join(" | "));
  assert.equal(await app.status(), "SOLVED");
  await lidAt(f, 20);
  // The journal entry names the points, never the crossing keys.
  const entry = (await app.model()).journalOps.at(-1);
  assert.equal(entry, "extrude");
  assert.ok(!(await saved()).includes("×"), "no key in the file");
  assert.equal(journal + 1, (await app.model()).journalOps.length, "one entry for the whole feature");
  await shot("right-step");
});

test("the left half, armed shallower: a second step from the same sketch, standing on the first one's crossings", async () => {
  await app.type('arm("extrude", { depth: 10 })');
  await clickAt(...await app.screenOf(onG(37, 25)));
  const all = await features();
  assert.equal(all.length, 2, (await app.log()).split("\n").slice(-3).join(" | "));
  const g = all[1];
  assert.deepEqual(crossingsOf(g), [], "nothing more made: the crossings are points held on both edges now");
  assert.ok(g.names.includes(x1) && g.names.includes(x2));
  assert.equal(await app.status(), "SOLVED");
  await lidAt(g, 10);
  await lidAt(all[0], 20);
  const ls = (await app.repl("ls()")).value as string[];
  assert.ok(ls.some((l) => l.startsWith("e2  extrude of ") && l.includes(`[${x1}→${x2}]`) && l.includes("depth d") && l.includes("= 10")), ls.join("\n"));
  await app.page.press("#cmd", "Escape");
  await app.page.mouse.move(5, 5);
  // The poster: turned so both steps and the riser between them show.
  await app.type("orbit(0.9, 0.6)");
  await shot("stepped-block");
});

test("set the shallow step's depth live: its lid moves, the tall one does not; one Ctrl+Z puts it back", async () => {
  const [, e2] = await features();
  const before = await saved();
  await app.type(`set("${e2.depth}.value", 4)`);
  assert.equal(await app.status(), "SOLVED");
  await lidAt((await features())[1], 4);
  await lidAt((await features())[0], 20);
  await shot("stepped-set");
  await key("Control+z");
  assert.equal(await saved(), before, "the set undone, byte for byte");
  await lidAt((await features())[1], 10);
});

test("one Ctrl+Z at a time takes each step away whole — crossings and all — and Ctrl+Shift+Z brings them back", async () => {
  const after = await saved();
  await key("Control+z");
  assert.equal((await features()).length, 1);
  await key("Control+z");
  assert.equal((await features()).length, 0);
  assert.equal(await saved(), beforeSteps, "back to the sketch, byte for byte: no crossing point left behind");
  await key("Control+Shift+z");
  await key("Control+Shift+z");
  assert.equal(await saved(), after);
});

test("save and open: the same file back, byte for byte, both steps in it, the crossings under the names they had", async () => {
  const file = await saved();
  assert.equal(JSON.parse(file).version, 8);
  await app.type(`open(${JSON.stringify(file)})`);
  assert.equal(await app.status(), "SOLVED");
  assert.equal(await saved(), file);
  const all = await features();
  assert.deepEqual(all.map((f) => [f.name, f.value]), [["e1", 20], ["e2", 10]]);
  assert.deepEqual(crossingsOf(all[0]), [x1, x2]);
  await shot("stepped-reopened");
});

test("a lens: two crossing circles from the circle tool, the lens between them extruded by a click inside it", async () => {
  await app.page.press("#cmd", "Escape");
  // Square-on again to draw, with the lens's site in the middle of the screen.
  await app.type('lookAt("f1")');
  const [sx, sy] = await app.screenOf(onG(97, 25));
  await app.type(`pan(${Math.round(700 - sx)}, ${Math.round(330 - sy)})`);
  // Centres 14 apart, radius 10: a lens 6 wide. Each circle its own arming —
  // a drawing tool finishes with its shape.
  for (const cu of [90, 104]) {
    await app.type("circle");
    const c = await app.screenOf(onG(cu, 25));
    const r = await app.screenOf(onG(cu + 10, 25));
    await leftDrag(c, r);
  }
  await app.page.press("#cmd", "Escape");
  await shot("lens-drawn");
  const m = await app.model();
  const rings = m.circles.slice(-2);
  assert.equal(rings.length, 2);
  for (const c of rings) assert.ok(Math.abs(m.radii[c.name] - 10) < 0.5, `${c.name} r ${m.radii[c.name]}`);
  const listed = (await app.repl("loops()")).value as string[];
  assert.ok(listed.filter((l) => l.includes(`${rings[0].name}[`) && l.includes(`${rings[1].name}[`)).length >= 3,
    `two crescents and a lens: ${listed.join(" | ")}`);

  await app.type('arm("extrude", { depth: 15 })');
  await clickAt(...await app.screenOf(onG(97, 25)));
  const all = await features();
  assert.equal(all.length, 3, (await app.log()).split("\n").slice(-3).join(" | "));
  const lens = all[2];
  assert.deepEqual(lens.loops[0].map((x) => (typeof x === "string" ? x : x.name)).sort(), rings.map((c) => c.name).sort());
  assert.equal(crossingsOf(lens).length, 2);
  assert.equal(lens.walls.length, 2);
  assert.equal(await app.status(), "SOLVED");
  await lidAt(lens, 15);
  await app.page.press("#cmd", "Escape");
  await app.page.mouse.move(5, 5);
  await shot("lens-square");
  // Turned, close up on the lens; then both solids in one picture.
  await app.type("orbit(0.9, 0.6)");
  const centre = async (u: number, w: number) => {
    const [mx, my] = await app.screenOf(onG(u, 25, w));
    await app.type(`pan(${Math.round(700 - mx)}, ${Math.round(330 - my)})`);
  };
  await centre(97, 7);
  await app.type("zoom(1.6)");
  await centre(97, 7);
  await shot("lens");
  await app.type("zoom(0.6)");
  await centre(70, 10);
  await shot("poster");
  const file = await saved();
  await app.type(`open(${JSON.stringify(file)})`);
  assert.equal(await saved(), file, "and it reopens to itself");
});

test("no uncaught page errors", () => {
  assert.deepEqual(app.pageErrors, []);
});
