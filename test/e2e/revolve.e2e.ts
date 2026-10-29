// 3D phase 5 in a browser: a plate drawn and extruded with the real tools on a
// tilted sketch, then a filleted profile beside it revolved three quarters of
// a turn about the sketch frame's +y — by the revolve tool's two clicks, the
// second on the frame marker's arm — its angle set, looked at, undone, saved.
//
// The unit suite has the mathematics; what only the assembled app can say is
// whether the two-click gesture works on the real canvas (the region outlined
// under the cursor, a click on nothing refused aloud, the axis shown dashed
// before the click that takes it), whether the end face lands where its own
// coordinates say, whether `set` typed at the command line swings it and
// relabels it, whether one Ctrl+Z takes the whole feature away, and whether the
// shaded surface — derived every frame, stored nowhere — is drawn right: every
// pixel the face nearest there, its start cap at the cap's own shade.
// Positions are checked against the drawing's own coordinates and a rotation
// about the sketch's +y computed here.
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
const cross = (a: number[], b: number[]) => [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]];
const dist3 = (a: number[], b: number[]) => Math.hypot(...sub(a, b));

/** The sketch plane: extrude.e2e.ts's, +x up 30°, +y leaning back 25°. */
const A = (30 * Math.PI) / 180, B = (25 * Math.PI) / 180;
const G_O = [10, 5, 6];
const G_X = [Math.cos(A), 0, Math.sin(A)];
const G_Y = [-Math.sin(A) * Math.sin(B), Math.cos(B), Math.cos(A) * Math.sin(B)];
const onG = (u: number, v: number) => G_O.map((o, i) => o + u * G_X[i] + v * G_Y[i]);

/** `p` turned through `a` about the sketch's +y, through its origin — Rodrigues', written out. */
function aboutY(p: number[], a: number): number[] {
  const v = sub(p, G_O);
  const kxv = cross(G_Y, v);
  const kv = dot(G_Y, v);
  return G_O.map((o, i) => o + v[i] * Math.cos(a) + kxv[i] * Math.sin(a) + G_Y[i] * kv * (1 - Math.cos(a)));
}

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

/** The 2D canvas's pixel at (sx, sy): where a tool's preview is drawn. */
const pixel = (sx: number, sy: number): Promise<number[]> => app.pixel(sx, sy, "drawing");

const green = (px: number[]) => px[1] > 35 && px[1] > px[0] + 15;

interface SeenFeature {
  name: string; kind: string; axis?: string; angle?: string; end?: string | null; loops: string[][]; twins: string[][];
  owns: string[]; pairs: [string, string][]; value: number;
}

/** The app's features, with each one's dimension pairs and value read off its relation. */
const features = (): Promise<SeenFeature[]> => app.page.evaluate(() => {
  const { model } = (window as never as { __neocad: { model: {
    features: Map<string, { kind: string; depth?: string; angle?: string } & Record<string, unknown>>;
    relations: Map<string, { args: unknown[] }>;
  } } }).__neocad;
  return [...model.features.values()].map((f) => {
    const args = model.relations.get((f.kind === "revolve" ? f.angle : f.depth)!)!.args;
    const pairs: [string, string][] = [];
    for (let i = 2; i < args.length; i += 2) pairs.push([args[i] as string, args[i + 1] as string]);
    return { ...f, pairs, value: args[1] as number } as never;
  });
});

/** Every point twin of the revolve sits at its base turned through `a` about the sketch's +y. */
async function endAt(f: SeenFeature, a: number): Promise<void> {
  const m = await app.model();
  let n = 0;
  for (const [base, twin] of f.pairs) {
    if (!(base in m.points)) continue; // a radius pair, or the frames'
    assert.ok(dist3(m.points[twin], aboutY(m.points[base], a)) < 1e-6, `${twin} is ${base} turned ${a}`);
    n++;
  }
  assert.ok(n >= 6, `${n} corners and the fillet's centre checked`);
}

/** The +y arm of the sketch frame's marker, 60% out: where a hand clicks it. */
async function yArm(): Promise<[number, number]> {
  const { scale } = (await app.model()).view;
  return app.screenOf(onG(0, (0.6 * 36) / scale));
}

let beforeRevolve = "";

test("on a tilted sketch: a plate drawn and extruded by the tools, and beside it a rectangle with a filleted corner", async () => {
  const at = (p: number[]) => `pt(${p.join(", ")})`;
  await app.type(`go = ${at(G_O)}; gx = ${at(onG(20, 0))}; gy = ${at(onG(0, 20))}; g = plane(go, gx, gy)`);
  await app.type("rectangle");
  await leftDrag(await app.screenOf(onG(-50, -45)), await app.screenOf(onG(50, -12)));
  await app.type('arm("extrude", { depth: 8 })');
  await clickAt(...await app.screenOf(onG(0, -30)));
  assert.deepEqual((await features()).map((f) => f.name), ["e1"]);

  await app.type("rectangle");
  await leftDrag(await app.screenOf(onG(12, 0)), await app.screenOf(onG(30, 30)));
  await app.type('arm("fillet", { radius: 7 })');
  await clickAt(...await app.screenOf(onG(30, 12)));
  await clickAt(...await app.screenOf(onG(20, 30)));
  const m = await app.model();
  assert.equal(m.arcs.length, 1, "the corner is rounded");
  assert.ok(Math.abs(m.radii[m.arcs[0].name] - 7) < 1e-6);
  assert.equal(await app.status(), "SOLVED");
  beforeRevolve = await saved();
});

test("the revolve tool: the region is outlined; a click on nothing is refused aloud; a click inside chooses it; the axis under the cursor is shown dashed; a click on the frame's +y arm revolves it", async () => {
  await app.type(`arm("revolve", { angle: 3 * Math.PI / 2 })`);
  const inside = await app.screenOf(onG(18, 12));
  await moveTo(...inside);
  assert.ok(green(await pixel(...inside)), "the preview's green under the cursor");

  await clickAt(...await app.screenOf(onG(80, 50)));
  assert.match(await app.log(), /revolve: click inside a closed outline — the ones I can see are lit/);
  assert.equal((await app.model()).activeTool, "revolve");

  await clickAt(...inside);
  assert.equal((await app.model()).activeTool, "revolve", "half the gesture");
  assert.equal((await features()).length, 1);
  // Over the arm: the axis is drawn dashed in the tool's green, beyond the
  // marker and along the profile's height — somewhere on it, between dashes.
  await moveTo(...await yArm());
  let seen = 0;
  for (let v = 4; v <= 34; v += 1.5) if (green(await pixel(...await app.screenOf(onG(0, v))))) seen++;
  assert.ok(seen >= 4, `the dashed axis is on the canvas (${seen} green samples along it)`);
  // A second click on no axis — empty canvas, in no region — says so, and
  // keeps the profile chosen.
  await clickAt(...await app.screenOf(onG(80, 50)));
  assert.match(await app.log(), /revolve: now click a line, or a frame.s arm, to turn it about/);

  await clickAt(...await yArm());
  assert.equal((await app.model()).activeTool, null, "two clicks, then the tool is done");
  assert.equal(await app.status(), "SOLVED");
  const f = (await features())[1];
  assert.equal(f.kind, "revolve");
  assert.equal(f.axis, "f1.y");
  assert.ok(Math.abs(f.value - 1.5 * Math.PI) < 1e-12);
  assert.equal(f.loops[0].length, 5, "four lines and the fillet");
  await endAt(f, 1.5 * Math.PI);
  const last = await app.page.evaluate(() => (window as never as { __neocad: { model: { journal: { op: string; args: unknown[] }[] } } }).__neocad.model.journal.at(-1));
  assert.equal(last!.op, "revolve");
  assert.deepEqual(last!.args.slice(1, 4), ["f1.y", 1.5 * Math.PI, "f1"]);
  const ls = (await app.repl("ls()")).value as string[];
  assert.match(ls.at(-1)!, /^e2  revolve of .*, angle d\d+ = 270° about f1\.y, end f\d+$/);
});

test("one Ctrl+Z takes the whole revolve away, and Ctrl+Shift+Z puts it back", async () => {
  const after = await saved();
  await key("Control+z");
  assert.deepEqual((await features()).map((f) => f.name), ["e1"]);
  assert.equal(await saved(), beforeRevolve, "back to the sketch, byte for byte");
  await key("Control+Shift+z");
  assert.equal(await saved(), after);
});

test("set the angle from the command line: the end face swings to a half turn, and its label says 180°", async () => {
  const f = (await features())[1];
  await app.type(`set("${f.angle}.value", Math.PI)`);
  assert.equal(await app.status(), "SOLVED");
  await endAt(f, Math.PI);
  const label = await app.page.evaluate((d) => {
    const { engine } = (window as never as { __neocad: { engine: { glyphs(): { relation: string; symbol: string }[] } } }).__neocad;
    return engine.glyphs().find((g) => g.relation === d)?.symbol;
  }, f.angle!);
  assert.equal(label, "180°");
});

test("turned, the solid is shaded from its live profile, by depth: every pixel off an outline is the nearest face's shade, the start cap among them, and a pixel of it clear of every mark", async () => {
  await app.type("lookAt(g); orbit(0.9, 0.3)");
  assert.equal(await app.renderer(), "depth");
  const pic = await checkPicture(app, 6);
  assert.ok(pic.onFace > 300, `${pic.onFace} samples on the solids`);
  assert.deepEqual(pic.wrong, [], "every sample is the face nearest the viewer there");
  assert.ok(pic.seen.has("e2.base"), `the start cap faces this view: ${[...pic.seen]}`);
  assert.ok(pic.seen.has("e2.wall"), "and the swept surface");
  assert.ok(![...pic.seen].some((f) => f === "e2.lid"), "a revolve has no lid; its far cap is its end");

  // A pixel of the start cap, clear of every mark (asked of the app's own
  // hover), is the cap's own fill in the composed picture too.
  let hit: [number, number] | null = null;
  for (const [u, v] of [[15, 6], [26, 6], [16, 22], [24, 14], [20, 26], [14, 15]]) {
    const at = await app.screenOf(onG(u, v));
    await moveTo(...at);
    if ((await app.repl("hover()")).value !== null) continue;
    const [{ face, edge }] = await app.nearestFaces([at]);
    if (face?.feature !== "e2" || face.kind !== "base" || edge <= 2) continue;
    hit = at;
    assert.deepEqual(await app.pixel(...at, "screen"), [...face.rgb, 255]);
    break;
  }
  assert.ok(hit, "somewhere on the start cap is clear of the drawing's marks");
  await app.page.mouse.move(5, 5);
});

test("save and open: the same file back, byte for byte, the plate and the revolve both in it", async () => {
  const file = await saved();
  await app.type(`open(${JSON.stringify(file)})`);
  assert.equal(await app.status(), "SOLVED");
  assert.equal(await saved(), file);
  assert.deepEqual((await features()).map((x) => [x.name, x.kind, x.value]), [["e1", "extrude", 8], ["e2", "revolve", Math.PI]]);
});

test('del("e2") takes the end face and the angle and leaves the profile where it was', async () => {
  const before = await app.model();
  const f = (await features())[1];
  await app.type('del("e2")');
  assert.deepEqual((await features()).map((x) => x.name), ["e1"]);
  const after = await app.model();
  for (const n of f.owns) assert.ok(!(n in after.points) && !after.lines.some((l) => l.name === n), `${n} went`);
  for (const n of f.loops[0]) assert.ok(after.lines.some((l) => l.name === n) || after.arcs.some((a) => a.name === n), `${n} stayed`);
  for (const [n, p] of Object.entries(after.points)) assert.ok(dist3(p, before.points[n]) < 1e-9, `${n} did not move`);
  assert.equal(await app.status(), "SOLVED");
});

test("no uncaught page errors", () => {
  assert.deepEqual(app.pageErrors, []);
});
