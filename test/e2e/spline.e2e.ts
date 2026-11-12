// The spline in a real browser (docs/plans/spline.md): drawn with its tool from
// the curves button — clicks for its points, a second click on the last to end
// it, a click on the first to close it — with a mouse on a desktop window, then
// with taps in iPhone 13 emulation (taps, not drags, where the plan allows: the
// touch harness's drags are slow under load, TODO.md). Checked against the
// model: the curve through every point as it is drawn and after a point is
// dragged, a dimension between its points, the context menu's Add point here,
// undo, a save and an open, an extrude. Set NEOCAD_E2E_SHOTS to a directory to
// keep the pictures — and look at them, the curve's smoothness at 3× and the
// wall's shading above all.

import { test, before, after } from "node:test";
import assert from "node:assert/strict";
import { mkdirSync } from "node:fs";
import { join } from "node:path";
import { openApp, forgetAutosave, type AppContext } from "./harness.ts";
import { fingers, type Fingers } from "./fingers.ts";
import { DEGREE, knotsOf, layout, numericGaps, pointAt, type BSpline } from "../../src/bspline.ts";

const SHOTS = process.env.NEOCAD_E2E_SHOTS;
async function shot(app: AppContext, name: string, clip?: { x: number; y: number; width: number; height: number }): Promise<void> {
  if (!SHOTS) return;
  mkdirSync(SHOTS, { recursive: true });
  await app.page.waitForTimeout(150);
  await app.page.screenshot({ path: join(SHOTS, `spline-${name}.png`), ...(clip ? { clip } : {}) });
}

/** The mouse parked on empty canvas, clear of the logo's tooltip and every panel, for a picture. */
const park = (app: AppContext) => app.page.mouse.move(1000, 220);

interface Probe {
  __neocad: {
    model: {
      entities: Map<string, { kind: string; name: string; points?: string[]; closed?: true; ctrl?: number[]; refs?: string[] }>;
      relations: Map<string, { op: string; args: unknown[] }>;
      coords(n: string): number[];
      problem: { getVar(i: number): number };
      features: Map<string, unknown>;
      journal: { op: string; args: unknown[] }[];
      dim: number;
    };
  };
}

/** The splines in the model: each its points, where they are, whether it is closed, and its solved control values. */
const splines = (app: AppContext) => app.page.evaluate(() => {
  const m = (window as never as Probe).__neocad.model;
  return [...m.entities.values()].filter((e) => e.kind === "spline").map((e) => ({
    name: e.name, points: e.points!, closed: e.closed === true,
    at: e.points!.map((p) => m.coords(p)), ctrl: e.ctrl!.map((i) => m.problem.getVar(i)), dim: m.dim,
  }));
});
type Seen = Awaited<ReturnType<typeof splines>>[number];

/** The curve a spline is, read here from what the page holds — the same arithmetic the app draws by (src/bspline.ts). */
function curveOf(s: Seen): BSpline {
  const L = layout(s.points.length, s.closed);
  const ctrl = L.ctrl.map((c) => ("unknown" in c ? s.ctrl.slice(c.unknown * s.dim, (c.unknown + 1) * s.dim) : s.at[c.point]));
  return { degree: DEGREE, knots: knotsOf(numericGaps(L, s.at)), ctrl };
}

/** How far the curve misses each of its points at its knot: the interpolation, measured. */
function miss(s: Seen): number {
  const c = curveOf(s);
  return Math.max(...s.at.map((p, k) => Math.hypot(...pointAt(c, c.knots[3 + k]).map((x, i) => x - p[i]))));
}

const relationOps = (app: AppContext) => app.page.evaluate(() =>
  [...(window as never as Probe).__neocad.model.relations.values()].map((r) => r.op));
const dist = (a: number[], b: number[]) => Math.hypot(...a.map((v, i) => v - b[i]));

async function fresh(app: AppContext): Promise<void> {
  await app.page.evaluate(() => localStorage.clear());
  await forgetAutosave(app.page);
  await app.page.reload({ waitUntil: "networkidle" });
  await app.page.waitForFunction(() => document.getElementById("status")?.textContent?.includes("ready"), null, { timeout: 20_000 });
}

async function onCanvas(app: AppContext, world: number[]): Promise<[number, number]> {
  const [x, y] = await app.screenOf(world);
  for (const [dx, dy] of [[0, 0], [-12, 0], [12, 0], [0, -12], [0, 12]]) await app.at(x + dx, y + dy); // throws under a panel
  return [x, y];
}

/** Polls `read` until `want` says yes — never a fixed sleep — or fails saying what it last saw. */
async function settled<T>(app: AppContext, read: () => Promise<T>, want: (t: T) => boolean, what: string): Promise<T> {
  const deadline = Date.now() + 8000;
  for (;;) {
    const v = await read();
    if (want(v)) return v;
    if (Date.now() > deadline) assert.fail(`${what}: ${JSON.stringify(v)}`);
    await app.page.waitForTimeout(50);
  }
}

async function savedRoundTrip(app: AppContext): Promise<void> {
  const before = await app.repl("save()");
  assert.equal(before.ok, true, before.error ?? "");
  const text = before.value as string;
  assert.match(text, /"version": 20/);
  assert.match(text, /"splines"/, "the control points saved");
  const was = JSON.stringify(await splines(app));
  await app.type("pt(0, 0); pt(5, 5)"); // something to lose
  await app.repl(`SAVED = ${JSON.stringify(text)}`);
  const opened = await app.repl("open(SAVED)");
  assert.equal(opened.ok, true, opened.error ?? "");
  assert.equal(JSON.stringify(await splines(app)), was, "the same splines, point for point and control for control");
  const again = await app.repl("save()");
  assert.equal(again.value, text, "and saves back to the same bytes");
}

// ===== a mouse, on a desktop =========================================================

let desk: AppContext;
before(async () => { desk = await openApp(); });
after(async () => {
  assert.deepEqual(desk.pageErrors, [], "nothing the page threw went uncaught");
  await desk.close();
});

async function hover(world: number[]): Promise<void> {
  const at = await desk.at(...await onCanvas(desk, world));
  await desk.page.mouse.move(at.x, at.y, { steps: 5 });
  await desk.page.waitForTimeout(80);
}

async function click(world: number[]): Promise<void> {
  const at = await desk.at(...await onCanvas(desk, world));
  await desk.page.mouse.move(at.x, at.y, { steps: 3 });
  await desk.page.mouse.click(at.x, at.y);
  await desk.page.waitForTimeout(80);
}

async function drag(from: number[], to: number[]): Promise<void> {
  const a = await desk.at(...await onCanvas(desk, from));
  const b = await desk.at(...await onCanvas(desk, to));
  await desk.page.mouse.move(a.x, a.y, { steps: 3 });
  await desk.page.mouse.down();
  await desk.page.mouse.move(b.x, b.y, { steps: 10 });
  await desk.page.waitForTimeout(80);
  await desk.page.mouse.up();
}

const rectOf = (app: AppContext, sel: string) => app.page.$eval(sel, (el) => {
  const r = el.getBoundingClientRect();
  return { x: r.x, y: r.y, w: r.width, h: r.height };
});

const WAVE = [[-30, 0, 0], [-15, 12, 0], [0, -6, 0], [15, 10, 0], [30, 0, 0]];

test("desktop: the curves button offers the spline; clicked points, a second click on the last — the curve through every point, one undo step", async () => {
  await fresh(desk);
  // The curves button opens ellipse and spline (docs/plans/toolbar-groups.md): a hover, then a click.
  await desk.page.mouse.move(700, 400);
  const b = await rectOf(desk, '#toolbar button[data-group="curves"]');
  await desk.page.mouse.move(b.x + b.w / 2, b.y + b.h / 2, { steps: 2 });
  await desk.page.waitForFunction(() => !(document.getElementById("flyout") as HTMLElement).hidden, null, { timeout: 3000 });
  const items = await desk.page.$$eval("#flyout button", (bs) => bs.map((x) => (x as HTMLElement).dataset.tool));
  assert.deepEqual(items, ["ellipse", "spline"]);
  await shot(desk, "desk-curves-flyout");
  const it = await rectOf(desk, '#flyout button[data-tool="spline"]');
  await desk.page.mouse.move(it.x + it.w / 2, it.y + it.h / 2, { steps: 3 });
  await desk.page.mouse.click(it.x + it.w / 2, it.y + it.h / 2);
  assert.equal((await desk.model()).activeTool, "spline");

  const before = await desk.repl("save(model, false)");
  for (const p of WAVE.slice(0, 4)) await click(p);
  await hover(WAVE[4]);
  await shot(desk, "desk-spline-growing");
  assert.equal((await splines(desk)).length, 0, "nothing made until it ends");
  await click(WAVE[4]);
  await click(WAVE[4]); // the second click on the last point: the end
  const [s] = await settled(desk, () => splines(desk), (x) => x.length === 1, "a spline");
  assert.equal(s.points.length, 5);
  assert.equal(s.closed, false);
  s.at.forEach((p, k) => assert.ok(dist(p, WAVE[k]) < 0.6, `point ${k} where it was clicked: ${p}`));
  assert.ok(miss(s) < 1e-9, `through every point: ${miss(s)}`);
  const ops = (await desk.model()).journalOps;
  assert.equal(ops.filter((o) => o === "addSpline").length, 1);
  await desk.page.keyboard.press("Escape");
  await park(desk);
  await shot(desk, "desk-spline");
  // One undo step takes the whole gesture.
  await desk.page.keyboard.press("Control+z");
  await settled(desk, () => desk.repl("save(model, false)"), (x) => x.value === before.value, "undone to before it");
  await desk.page.keyboard.press("Control+y");
  await settled(desk, () => splines(desk), (x) => x.length === 1, "redone");
});

test("desktop: a through-point dragged — the curve follows, still through every point; a dimension between its points holds", async () => {
  const [s] = await splines(desk);
  const p = s.points[2];
  await drag(s.at[2], [4, -16, 0]);
  const [t] = await settled(desk, () => splines(desk), (x) => dist(x[0].at[2], [4, -16, 0]) < 0.6, "the point dragged");
  assert.ok(miss(t) < 1e-9, `still through every point after the drag: ${miss(t)}`);
  assert.equal(t.points[2], p);
  await park(desk);
  await shot(desk, "desk-spline-dragged");
  // A dimension between its two ends, typed as the dimension tool types it.
  await desk.type(`dist("${s.points[0]}", "${s.points[4]}", 70)`);
  const [u] = await settled(desk, () => splines(desk), (x) => Math.abs(dist(x[0].at[0], x[0].at[4]) - 70) < 1e-6, "70 between its ends");
  assert.ok(miss(u) < 1e-9);
  await park(desk);
  await shot(desk, "desk-spline-dimensioned");
});

test("desktop: the context menu on the curve adds a point where it was clicked; saved and opened, the same curve", async () => {
  const [s] = await splines(desk);
  const c = curveOf(s);
  const mid = pointAt(c, (c.knots[4] + c.knots[5]) / 2);
  const at = await desk.at(...await onCanvas(desk, mid));
  await desk.page.mouse.move(at.x, at.y, { steps: 3 });
  await desk.page.mouse.down({ button: "right" });
  await desk.page.mouse.up({ button: "right" });
  await desk.page.waitForFunction(() => !(document.getElementById("ctxmenu") as HTMLElement).hidden, null, { timeout: 3000 });
  const labels = await desk.page.$$eval("#ctxmenu .item", (els) => els.map((el) => el.firstElementChild?.textContent ?? ""));
  assert.ok(labels.includes("Add point here") && labels.some((l) => l.startsWith("Remove point")), JSON.stringify(labels));
  await shot(desk, "desk-spline-menu");
  await desk.page.click('#ctxmenu .item:has-text("Add point here")');
  const [t] = await settled(desk, () => splines(desk), (x) => x[0].points.length === 6, "a sixth point");
  assert.ok(dist(t.at[2], mid) < 0.5, `added on the curve where it was clicked: ${t.at[2]} against ${mid}`);
  assert.ok(miss(t) < 1e-9);
  assert.equal((await desk.model()).journalOps.at(-1), "addThrough");
  await savedRoundTrip(desk);
});

test("desktop: closed by two lines under it and extruded — a smooth wall — then undone", async () => {
  const [s] = await splines(desk);
  // Down and back under the wave, clear of it: a line straight across would
  // cross the dragged-down point's dip, and a region bounded by part of a
  // spline is refused (test/splineedit.test.ts says so).
  await desk.type(`q = pt(0, -40); ln("${s.points.at(-1)}", q); ln(q, "${s.points[0]}")`);
  await desk.type(`extrude("${s.name}", 12)`);
  await settled(desk, () => desk.model(), (x) => x.journalOps.includes("extrude"), "extruded");
  await desk.type("orbit(0.5, 0.6)");
  await park(desk);
  await shot(desk, "desk-spline-extruded");
  // Close, so the wall fills the picture: its shading has to run smoothly
  // along the spline, and the curve has to be smooth at three times the zoom.
  await desk.type("orbit(0.15, 0.5); zoom(3)");
  await park(desk);
  await shot(desk, "desk-spline-wall-3x");
  // And the trough, where it bends hardest, close up.
  const [tx, ty] = await desk.screenOf(curveOf((await splines(desk))[0]).ctrl[3]);
  await shot(desk, "desk-spline-trough-3x", { x: Math.max(0, tx - 160), y: Math.max(0, ty - 110), width: 320, height: 220 });
  await desk.page.keyboard.press("Control+z");
  await settled(desk, () => desk.page.evaluate(() => (window as never as Probe).__neocad.model.features.size), (n) => n === 0, "the extrude undone");
});

test("desktop: a click on the first point closes it — a closed spline, C² round its seam, a loop of its own", async () => {
  await fresh(desk);
  await desk.type('arm("spline")');
  const ring = [[0, 0, 0], [20, 8, 0], [30, -10, 0], [10, -20, 0]];
  for (const p of ring) await click(p);
  await hover(ring[0]);
  await shot(desk, "desk-spline-closing");
  await click(ring[0]);
  const [s] = await settled(desk, () => splines(desk), (x) => x.length === 1, "a closed spline");
  assert.equal(s.closed, true);
  assert.equal(s.points.length, 4);
  assert.ok(miss(s) < 1e-9);
  await desk.page.keyboard.press("Escape");
  await park(desk);
  await shot(desk, "desk-closed-spline");
  const loops = await desk.repl("loops()");
  assert.match(JSON.stringify(loops.value), /loop of sp1 /, JSON.stringify(loops.value));
  await desk.type('extrude("sp1", 6); orbit(0.45, 0.65)');
  await settled(desk, () => desk.model(), (x) => x.journalOps.includes("extrude"), "extruded");
  await desk.type("zoom(2)");
  await park(desk);
  await shot(desk, "desk-closed-spline-extruded");
});

// ===== fingers, iPhone 13 ===========================================================

let phone: AppContext;
let f: Fingers;
before(async () => { phone = await openApp({ device: "iPhone 13" }); });
after(async () => {
  assert.deepEqual(phone.pageErrors, [], "nothing the page threw went uncaught");
  await phone.close();
});

async function freshPhone(): Promise<void> {
  await fresh(phone);
  await phone.page.evaluate(() => (document.activeElement as HTMLElement | null)?.blur());
  f = await fingers(phone);
}

const middleOf = (selector: string) => phone.page.$eval(selector, (el) => {
  const r = el.getBoundingClientRect();
  const c = document.getElementById("cv")!.getBoundingClientRect();
  return [r.x + r.width / 2 - c.x, r.y + r.height / 2 - c.y] as [number, number];
});

/** A tap on a world point, and the frames it takes to land — polled, not slept. */
async function tap(world: number[]): Promise<void> {
  const before = await phone.page.evaluate(() => performance.now());
  await f.tap(...await onCanvas(phone, world));
  await phone.page.waitForFunction((t) => performance.now() > t + 30, before);
}

test("iPhone 13: the spline armed from the curves flyout by a held finger and a tap; tapped points; ✓ ends it", async () => {
  await freshPhone();
  await f.hold(...await middleOf('#toolbar button[data-group="curves"]'), 700, true);
  await phone.page.waitForFunction(() => {
    const el = document.querySelector("#flyout") as HTMLElement;
    return !el.hidden && el.dataset.group === "curves";
  });
  await f.up();
  await f.tap(...await middleOf('#flyout button[data-tool="spline"]'));
  await settled(phone, () => phone.model(), (m) => m.activeTool === "spline", "the spline armed");
  const pts = [[-20, -10, 0], [-8, 8, 0], [6, -4, 0], [20, 10, 0]];
  for (const p of pts) await tap(p);
  await settled(phone, () => phone.page.$eval("#options .oact button.ok", (b) => !(b as HTMLButtonElement).disabled), (x) => x, "✓ ready");
  await shot(phone, "phone-spline-growing");
  await phone.page.tap("#options .oact button.ok");
  const [s] = await settled(phone, () => splines(phone), (x) => x.length === 1, "a spline");
  assert.equal(s.points.length, 4);
  assert.equal(s.closed, false);
  s.at.forEach((p, k) => assert.ok(dist(p, pts[k]) < 1.5, `point ${k} where it was tapped: ${p}`));
  assert.ok(miss(s) < 1e-9);
  await phone.type("cancel()");
  await shot(phone, "phone-spline");
  // A dimension between two of its points, and the curve through them still.
  await phone.type(`dist("${s.points[1]}", "${s.points[2]}", 20)`);
  const [t] = await settled(phone, () => splines(phone), (x) => Math.abs(dist(x[0].at[1], x[0].at[2]) - 20) < 1e-6, "20 apart");
  assert.ok(miss(t) < 1e-9);
  await savedRoundTrip(phone);
});

test("iPhone 13: a closed spline, tapped round and closed by a tap on its first point — extruded, undone by the action strip", async () => {
  await freshPhone();
  await phone.type('arm("spline")');
  await phone.page.evaluate(() => (document.activeElement as HTMLElement | null)?.blur());
  const ring = [[0, 0, 0], [18, 8, 0], [24, -10, 0], [6, -18, 0]];
  for (const p of ring) await tap(p);
  await tap(ring[0]);
  const [s] = await settled(phone, () => splines(phone), (x) => x.length === 1, "closed");
  assert.equal(s.closed, true);
  assert.ok(miss(s) < 1e-9);
  await phone.type("cancel()");
  await phone.type(`extrude("${s.name}", 8); orbit(0.5, 0.6)`);
  await settled(phone, () => phone.model(), (x) => x.journalOps.includes("extrude"), "extruded");
  await shot(phone, "phone-closed-spline-extruded");
  await phone.type("orbit(0.15, 0.5); zoom(3)");
  await shot(phone, "phone-spline-wall-3x");
  await f.tap(...await middleOf('#actions button[data-action="undo"]'));
  await settled(phone, () => phone.page.evaluate(() => (window as never as Probe).__neocad.model.features.size), (n) => n === 0, "undone");
});
