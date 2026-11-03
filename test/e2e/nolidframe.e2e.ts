// An extrude makes no lid frame, in a browser (docs/plans/no-lid-frame.md).
//
// The owner's case, measured after the quiet-geometry merge: two rectangles,
// the extrude tool, a click in each, Enter. Both solids share the first
// rectangle's sketch frame — three of its corners — so for the second that
// frame stands off its profile, and a version-10 lid frame made three points
// of its own on the *first* solid's lid corners, each drawn, since a lid-frame
// point ends no line. *"i'm getting a lot of overlapping points. why is this
// happening?"* Now: no point on another, and no frame but the sketch's.
//
// Then a cylinder's top, which has no three points of its own: the sketch
// tool clicked on it types a plane made through its centre, held on its rim,
// and a circle drawn there extrudes into a boss standing on the top.
//
// Set NEOCAD_E2E_SHOTS to a directory to keep the screenshots, and look at
// them: no frame marker on either lid, no stray points.
//
// One app, tests in order: the states are cumulative.

import { test, before, after } from "node:test";
import assert from "node:assert/strict";
import { mkdirSync } from "node:fs";
import { join } from "node:path";
import { openApp, type AppContext } from "./harness.ts";

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
  await app.page.screenshot({ path: join(SHOTS, `nolidframe-${name}.png`) });
}

const sub = (a: number[], b: number[]) => a.map((x, i) => x - b[i]);
const dot = (a: number[], b: number[]) => a.reduce((s, x, i) => s + x * b[i], 0);

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

async function enter(): Promise<void> {
  await app.page.fill("#cmd", "");
  await app.page.keyboard.press("Enter");
  await app.page.waitForTimeout(300);
  await app.page.keyboard.press("Escape");
  await app.page.waitForTimeout(120);
}

/** Every two point entities on one spot, as `a=b`, read off the live model. */
async function coincident(): Promise<string[]> {
  const { points } = await app.model();
  const names = Object.keys(points);
  const out: string[] = [];
  for (let i = 0; i < names.length; i++) {
    for (let j = i + 1; j < names.length; j++) {
      if (Math.hypot(...sub(points[names[i]], points[names[j]])) < 1e-6) out.push(`${names[i]}=${names[j]}`);
    }
  }
  return out;
}

interface Seen { name: string; frame: string; top: string | null; twins: string[][]; pairs: [string, string][] }

const features = (): Promise<Seen[]> => app.page.evaluate(() => {
  const { model } = (window as never as { __neocad: { model: {
    features: Map<string, { name: string; frame: string; top?: string; twins: string[][]; depth: string }>;
    relations: Map<string, { args: unknown[] }>;
  } } }).__neocad;
  return [...model.features.values()].map((f) => {
    const args = model.relations.get(f.depth)!.args;
    const pairs: [string, string][] = [];
    for (let i = 2; i < args.length; i += 2) pairs.push([args[i] as string, args[i + 1] as string]);
    return { name: f.name, frame: f.frame, top: f.top ?? null, twins: f.twins, pairs };
  });
});

/** Every frame, with its origin's place and +z. */
const frames = (): Promise<{ name: string; origin: number[]; z: number[] }[]> => app.page.evaluate(async () => {
  const { model } = (window as never as { __neocad: { model: {
    entities: Map<string, { kind: string; name: string; origin?: string }>; coords(n: string): number[];
  } } }).__neocad;
  const path = "/src/relations/refs.ts";
  const { frameBasis } = await import(path);
  return [...model.entities.values()].filter((e) => e.kind === "frame")
    .map((e) => ({ name: e.name, origin: model.coords(e.origin!), z: frameBasis(model, e.name)().uz }));
});

test("two rectangles, the extrude tool, a click in each, Enter: two solids on one sketch frame, no lid frame, no point on another", async () => {
  assert.equal((await app.model()).byKind.frame ?? 0, 0, "a fresh model has no frame");
  await app.type("rectangle");
  await leftDrag([300, 300], [460, 440]);
  await app.type("rectangle");
  await leftDrag([540, 300], [700, 440]);
  const drawn = await app.model();
  assert.equal(drawn.byKind.line, 8);
  assert.equal(drawn.byKind.point, 8);
  assert.deepEqual(await coincident(), [], "the sketch: eight corners, none on another");

  await app.type("extrude");
  await clickAt(380, 370);
  await clickAt(620, 370);
  await enter();
  const all = await features();
  assert.equal(all.length, 2, "two solids");
  assert.equal(await app.status(), "SOLVED");
  assert.equal(all[0].frame, all[1].frame, "on one sketch frame — the first rectangle's corners");
  for (const f of all) assert.equal(f.top, null, `${f.name} has no lid frame`);
  const fs = await frames();
  assert.deepEqual(fs.map((f) => f.name), [all[0].frame], "the only frame is the sketch's");
  assert.ok(Math.abs(fs[0].origin[2]) < 1e-9, "and it stands on the base, not on a lid");

  const m = await app.model();
  assert.equal(m.byKind.point, 8 + 8, "eight corners and eight twins: was 19, three on the first lid's corners");
  assert.deepEqual(await coincident(), [], "no two points on one spot");
  for (const f of all) assert.equal(f.pairs.length, 4, `${f.name}'s depth holds its four corners and nothing else`);

  await app.type("orbit(0.5, 0.35)");
  await app.page.waitForTimeout(200);
  await shot("1-two-boxes");
  await app.type("zoom(1.8)");
  await app.page.waitForTimeout(200);
  await shot("2-two-boxes-closer");
  // As drawn: no two dots on one pixel.
  const { points } = await app.model();
  const screen = await Promise.all(Object.values(points).map((p) => app.screenOf(p)));
  let closest = Infinity;
  for (let i = 0; i < screen.length; i++) {
    for (let j = i + 1; j < screen.length; j++) closest = Math.min(closest, Math.hypot(screen[i][0] - screen[j][0], screen[i][1] - screen[j][1]));
  }
  assert.ok(closest > 1, `no two points drawn on one pixel: closest ${closest.toFixed(2)} px`);
});

test("save and open: the same names, still one frame and no point on another — and the extrude entries are the calls", async () => {
  const before = (await app.repl("save()")).value as string;
  const file = JSON.parse(before);
  assert.equal(file.version, 11);
  for (const e of file.journal.filter((j: { op: string }) => j.op === "extrude")) assert.equal(e.args.length, 4);
  const r = await app.repl(`open(${JSON.stringify(before)})`);
  assert.equal(r.ok, true, r.error ?? "");
  await app.page.waitForTimeout(200);
  assert.equal((await app.repl("save()")).value, before, "byte-identical");
  assert.deepEqual(await coincident(), []);
  assert.equal((await frames()).length, 1);
});

/** Pans `world` to a little right of the canvas's middle, clear of the panels. */
async function centreOn(world: number[]): Promise<void> {
  const [sx, sy] = await app.screenOf(world);
  const [w, h] = await app.page.$eval("#cv", (el) => [el.clientWidth, el.clientHeight]);
  await app.type(`pan(${Math.round(w / 2 + 60 - sx)}, ${Math.round(h / 2 - 60 - sy)})`);
  await app.page.waitForTimeout(150);
}

test("a cylinder's top, sketched on with the sketch tool: a plane made through its centre and held on its rim, facing out; a circle on it extrudes into a boss on the top", async () => {
  // A circle beside the boxes, on the same sketch, extruded 20 — typed, since
  // the point is what the sketch tool does on its top.
  const pts = Object.values((await app.model()).points);
  const at = [Math.max(...pts.map((p) => p[0])) + 40, pts.reduce((s, p) => s + p[1], 0) / pts.length, 0];
  const r = await app.repl(`cc = pt(${at.join(", ")}); onplane(cc); cy = circ(cc, 15); extrude(cy, 20)`);
  assert.equal(r.ok, true, r.error ?? "");
  await app.page.waitForTimeout(150);
  const all = await features();
  assert.equal(all.length, 3, "a cylinder");
  const cyl = all[2];
  assert.equal(cyl.top, null);
  const rim = cyl.twins[0][0];
  const centre = (await app.repl("cc")).value as string;
  const top = cyl.pairs.find(([b]) => b === centre)![1];
  const m1 = await app.model();
  const up = sub(m1.points[top], m1.points[centre]);
  assert.ok(Math.abs(Math.hypot(...up) - 20) < 1e-6, "the top is 20 over the base");

  // The top facing the camera (the boxes' view is turned up toward it), the
  // sketch tool clicked on it, off its centre point.
  await centreOn(m1.points[top]);
  const framesBefore = (await frames()).length;
  await app.type("sketch");
  await clickAt(...await app.screenOf(m1.points[top].map((c, i) => c + (i === 0 ? 6 : 0))));
  const log = await app.log();
  const typed = log.match(/> plane\("(p\d+)", pt\([^)]*, oncircle\(_, "(c\d+)"\)\), pt\([^)]*, oncircle\(_, "c\d+"\)\)\)/);
  assert.ok(typed, `the sketch tool typed a plane made on the top: ${log.slice(-400)}`);
  assert.equal(typed[1], top, "through the top's own centre");
  assert.equal(typed[2], rim, "held on the top's rim");
  const fs = await frames();
  assert.equal(fs.length, framesBefore + 1, "one frame made");
  const made = fs.at(-1)!;
  assert.equal((await app.repl("defaultFrame()")).value, made.name, "and it is the default: the next drawing goes on the top");
  assert.ok(Math.abs(dot(made.z, up) - 20) < 1e-6, `+z straight out of the top: ${made.z}`);
  assert.deepEqual(await coincident(), [], "no point on another — the plane's origin is the top's own centre");
  assert.equal(await app.status(), "SOLVED");
  await shot("3-cylinder-sketch-plane");

  // A circle on the top, extruded: a boss standing on it.
  await app.type("circle");
  const c = await app.screenOf(m1.points[top]);
  await leftDrag(c, [c[0] + 18, c[1]]);
  const m2 = await app.model();
  const boss = m2.circles.at(-1)!;
  assert.notEqual(boss.name, rim);
  assert.ok(Math.abs(dot(sub(m2.points[boss.center], m2.points[top]), made.z)) < 1e-6, "drawn on the top's plane");
  await app.type('arm("extrude", { depth: 10 })');
  await clickAt(...await app.screenOf(m2.points[boss.center].map((v, i) => v + (i === 0 ? 1 : 0))));
  await enter();
  const after = await features();
  assert.equal(after.length, 4, "the boss");
  const bossTop = after[3].pairs.find(([b]) => b === boss.center)![1];
  const m3 = await app.model();
  assert.ok(Math.abs(dot(sub(m3.points[bossTop], m3.points[top]), made.z) - 10) < 1e-6, "standing 10 off the top, not into it");
  assert.equal(await app.status(), "SOLVED");
  await app.type("orbit(0.3, 0.3)");
  await centreOn(m3.points[top]);
  await shot("4-boss-on-cylinder");

  // The plane is the top's, not the place the top was: set the cylinder's
  // depth and the frame rises with it, square as ever.
  const depth = await app.page.evaluate(() => (window as never as { __neocad: { model: { features: Map<string, { depth: string }> } } })
    .__neocad.model.features.get("e3")!.depth);
  await app.type(`set("${depth}.value", 30)`);
  assert.equal(await app.status(), "SOLVED");
  const moved = (await frames()).find((f) => f.name === made.name)!;
  const m4 = await app.model();
  assert.ok(Math.hypot(...sub(moved.origin, m4.points[top])) < 1e-9, "the frame's origin is the risen top's centre");
  assert.ok(Math.abs(dot(moved.z, up) - 20) < 1e-6, "still facing straight out");
  assert.ok(Math.abs(dot(sub(m4.points[top], m4.points[centre]), up) / 20 - 30) < 1e-6, "and the top is 30 up");
});
