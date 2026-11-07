// Conflict detection in the real app (docs/plans/conflict-detection.md). The
// owner: "I'm able to add a parallel relation to a set of perpendicular
// relation lines. This is a bug." A rectangle drawn with the tool, its
// inferred relations in place, and Parallel added between two adjacent sides
// from the constrain tool: CONFLICT, the two relations that cannot both hold
// drawn red, the rectangle not folded, and Delete on one of them clearing it.
// With a mouse and on an iPhone 13; then undo, a reload by autosave and a drag
// on the drawing holding the conflict.
//
// The unit suite proves which relations are named. What only a browser shows
// is that the rectangle on the screen did not fold, that the verdict says
// CONFLICT over a drawing every number of which says solved, and that the ink
// is the answer's.
//
// No fixed waits: every step polls for what it is waiting on.

import { test, before, after } from "node:test";
import assert from "node:assert/strict";
import { mkdirSync } from "node:fs";
import { join } from "node:path";
import { forgetAutosave, openApp, type AppContext } from "./harness.ts";
import { fingers, type Fingers } from "./fingers.ts";

/** Where pictures go when asked for (NEOCAD_E2E_SHOTS), to be looked at. */
const SHOTS = process.env.NEOCAD_E2E_SHOTS;
async function shot(app: AppContext, name: string): Promise<void> {
  if (!SHOTS) return;
  mkdirSync(SHOTS, { recursive: true });
  // Two frames, so the picture is of what the last change drew.
  await app.page.evaluate(() => new Promise((r) => requestAnimationFrame(() => requestAnimationFrame(r))));
  await app.page.screenshot({ path: join(SHOTS, `conflicts-${name}.png`) });
}

/** The conflict ink, as main.ts draws it. */
const RED = [0xe0, 0x60, 0x5c];

interface Probe {
  __neocad: {
    model: {
      relations: Map<string, { op: string; args: unknown[] }>;
      coords(n: string): number[];
      line(n: string): { refs: [string, string] };
    };
    engine: { glyphs(): { relation: string; symbol: string; screen: [number, number]; halfW: number; halfH: number }[] };
    files: { flush(): Promise<void> };
  };
}

const relations = (app: AppContext) => app.page.evaluate(() =>
  [...(window as never as Probe).__neocad.model.relations.entries()].map(([name, r]) => ({ name, op: r.op, args: r.args })));
const glyphs = (app: AppContext) => app.page.evaluate(() => (window as never as Probe).__neocad.engine.glyphs());
const diagnosisText = (app: AppContext) => app.page.$eval("#diagnosis", (el) => el.textContent ?? "");
const lengths = (app: AppContext, lines: string[]) => app.page.evaluate((ls) => ls.map((l) => {
  const m = (window as never as Probe).__neocad.model;
  const [a, b] = m.line(l).refs.map((p) => m.coords(p));
  return Math.hypot(...a.map((v, i) => v - b[i]));
}), lines);

/** Waits until the verdict reads `want`. */
async function verdict(app: AppContext, want: string): Promise<void> {
  await app.page.waitForFunction((w) => document.getElementById("status")?.textContent === w, want, { timeout: 10_000 });
}

/** Waits until the selection is `want`, a frame at a time. */
async function selected(app: AppContext, want: string[]): Promise<void> {
  const deadline = Date.now() + 5000;
  for (;;) {
    const now = (await app.selection()).sort();
    if (JSON.stringify(now) === JSON.stringify([...want].sort())) return;
    if (Date.now() > deadline) assert.deepEqual(now, [...want].sort(), "the selection");
    await app.page.evaluate(() => new Promise((r) => requestAnimationFrame(r)));
  }
}

async function fresh(app: AppContext): Promise<void> {
  await app.page.evaluate(() => localStorage.clear());
  await forgetAutosave(app.page);
  await app.page.reload({ waitUntil: "networkidle" });
  await app.page.waitForFunction(() => document.getElementById("status")?.textContent?.includes("ready"), null, { timeout: 20_000 });
}

/** A point along a line, `t` of the way from its first end, in canvas pixels. */
async function along(app: AppContext, line: string, t: number): Promise<[number, number]> {
  const [a, b] = await app.page.evaluate((l) => {
    const m = (window as never as Probe).__neocad.model;
    const refs = m.line(l).refs;
    return [m.coords(refs[0]), m.coords(refs[1])];
  }, line);
  return app.screenOf(a.map((v, i) => v + t * (b[i] - v)));
}

/** The drawing's colour there, or within two pixels of it — whichever is nearest `want`. */
async function inkNear(app: AppContext, [x, y]: [number, number], want: number[]): Promise<number[]> {
  const at: [number, number][] = [];
  for (let dx = -2; dx <= 2; dx++) for (let dy = -2; dy <= 2; dy++) at.push([Math.round(x) + dx, Math.round(y) + dy]);
  const px = await app.pixels("drawing", at);
  const d = (p: number[]) => Math.hypot(p[0] - want[0], p[1] - want[1], p[2] - want[2]);
  return px.reduce((best, p) => (d(p) < d(best) ? p : best));
}
const close = (p: number[], want: number[], tol = 30) => Math.hypot(p[0] - want[0], p[1] - want[1], p[2] - want[2]) < tol;

/**
 * Whether each glyph of each relation wears the conflict ink, by relation: a
 * relation between two lines is drawn once on each. Read on the top edge of
 * its box, at its middle, since boxes side by side share their left and right
 * edges.
 */
async function redGlyphs(app: AppContext): Promise<Record<string, boolean[]>> {
  const out: Record<string, boolean[]> = {};
  for (const g of await glyphs(app)) {
    (out[g.relation] ??= []).push(close(await inkNear(app, [g.screen[0], g.screen[1] - g.halfH], RED), RED));
  }
  return out;
}

/** The rectangle's four sides, its tool's right angle, and their lengths as drawn. */
interface Drawn { lines: string[]; perp: string; before: number[] }

/** The mouse moved off the drawing, so no hover outranks the conflict ink. A finger hovers nothing. */
async function park(app: AppContext): Promise<void> {
  if (app === phone) return;
  const at = await app.at(...(await app.screenOf([-70, 40, 0])));
  await app.page.mouse.move(at.x, at.y);
}

let desk: AppContext;
before(async () => { desk = await openApp(); });
after(async () => { await desk.close(); });

/** The rectangle tool, dragged with the mouse; the tool's own relations read back. */
async function drawRectangle(app: AppContext): Promise<Drawn> {
  await app.type("rectangle");
  const [a, b] = [await app.screenOf([-25, -12, 0]), await app.screenOf([25, 18, 0])];
  const from = await app.at(...a), to = await app.at(...b);
  await app.page.mouse.move(from.x, from.y);
  await app.page.mouse.down();
  for (let i = 1; i <= 8; i++) await app.page.mouse.move(from.x + ((to.x - from.x) * i) / 8, from.y + ((to.y - from.y) * i) / 8);
  await app.page.mouse.up();
  await app.page.waitForFunction(() => (window as never as Probe).__neocad.model.relations.size >= 3);
  await app.type("select");
  await verdict(app, "SOLVED");
  const lines = (await app.model()).lines.map((l) => l.name);
  assert.equal(lines.length, 4);
  const perps = (await relations(app)).filter((r) => r.op === "perpendicular");
  assert.equal(perps.length, 1, "the tool's right angle");
  assert.deepEqual(perps[0].args, [lines[0], lines[1]], "on the first corner");
  return { lines, perp: perps[0].name, before: await lengths(app, lines) };
}

/** Selects two adjacent sides with the mouse, and presses Parallel in the constrain tool. */
async function parallelFromConstrain(app: AppContext, lines: string[]): Promise<string> {
  const p = await app.at(...(await along(app, lines[0], 0.3)));
  await app.page.mouse.click(p.x, p.y);
  const q = await app.at(...(await along(app, lines[1], 0.3)));
  await app.page.keyboard.down("Shift");
  await app.page.mouse.click(q.x, q.y);
  await app.page.keyboard.up("Shift");
  await selected(app, [lines[0], lines[1]]);
  // Constrain is behind the relate group's button (toolbar-groups.md).
  await app.page.hover('#toolbar button[data-group="relate"]');
  await app.page.waitForSelector('#flyout button[data-tool="constrain"]', { state: "visible", timeout: 3000 });
  await app.page.click('#flyout button[data-tool="constrain"]');
  const row = `#options .ocmd[data-command='par("${lines[0]}", "${lines[1]}")']`;
  await app.page.waitForSelector(row, { state: "visible", timeout: 3000 });
  await app.page.click(row);
  await app.page.waitForFunction(() => [...(window as never as Probe).__neocad.model.relations.values()].some((r) => r.op === "parallel"
    && JSON.stringify(r.args) === JSON.stringify([...(window as never as Probe).__neocad.model.relations.values()].find((x) => x.op === "perpendicular")?.args)));
  return (await relations(app)).find((r) => r.op === "parallel" && r.args[0] === lines[0] && r.args[1] === lines[1])!.name;
}

/** CONFLICT, named exactly `names`, both red and nothing else red, and the rectangle as it was. */
async function assertConflict(app: AppContext, drawn: Drawn, names: string[]): Promise<void> {
  await verdict(app, "CONFLICT");
  const said = await diagnosisText(app);
  assert.match(said, / cannot all hold$/);
  const named = await app.page.$$eval("#diagnosis .rel", (els) => els.map((e) => (e as HTMLElement).dataset.relation!));
  assert.deepEqual(named.sort(), [...names].sort(), `the diagnosis names the two: ${said}`);
  const now = await lengths(app, drawn.lines);
  now.forEach((l, i) => assert.ok(Math.abs(l - drawn.before[i]) < 1e-6, `${drawn.lines[i]} as it was: ${l} vs ${drawn.before[i]}`));
  await park(app);
  await app.page.evaluate(() => new Promise((r) => requestAnimationFrame(() => requestAnimationFrame(r))));
  const red = await redGlyphs(app);
  for (const n of names) assert.ok(red[n]?.length && red[n].every(Boolean), `${n} in the conflict ink, every glyph of it: ${JSON.stringify(red)}`);
  for (const [n, on] of Object.entries(red)) if (!names.includes(n)) assert.ok(!on.some(Boolean), `${n} is not in the conflict: ${JSON.stringify(red)}`);
}

test("desktop: Parallel across the rectangle tool's right angle — CONFLICT, both red, nothing folds; Delete on one clears it", async () => {
  await fresh(desk);
  const drawn = await drawRectangle(desk);
  const par = await parallelFromConstrain(desk, drawn.lines);
  await assertConflict(desk, drawn, [drawn.perp, par]);
  assert.match(await desk.log(), /CONFLICT — these cannot all hold without collapsing l\d:/, "the log says what would have folded");
  await shot(desk, "1-parallel-across-a-right-angle");

  // The par, clicked in the status and deleted.
  await desk.page.click(`#diagnosis .rel[data-relation="${par}"]`);
  await selected(desk, [par]);
  await desk.page.keyboard.press("Delete");
  await verdict(desk, "SOLVED");
  assert.ok(!(await relations(desk)).some((r) => r.name === par), "the par is gone");
  await park(desk);
  await desk.page.evaluate(() => new Promise((r) => requestAnimationFrame(() => requestAnimationFrame(r))));
  const red = await redGlyphs(desk);
  assert.deepEqual(Object.entries(red).filter(([, on]) => on.some(Boolean)), [], "no glyph left red");
  await shot(desk, "2-the-par-deleted");
});

test("desktop: undo after the conflict — SOLVED, the par gone", async () => {
  await fresh(desk);
  const drawn = await drawRectangle(desk);
  const par = await parallelFromConstrain(desk, drawn.lines);
  await assertConflict(desk, drawn, [drawn.perp, par]);
  await desk.page.evaluate(() => (document.activeElement as HTMLElement | null)?.blur());
  await desk.page.keyboard.press("Control+z");
  await verdict(desk, "SOLVED");
  assert.ok(!(await relations(desk)).some((r) => r.op === "parallel" && r.args[1] === drawn.lines[1]), "the par undone");
});

test("desktop: a reload by autosave opens the drawing still in CONFLICT, the same two named", async () => {
  await fresh(desk);
  const drawn = await drawRectangle(desk);
  const par = await parallelFromConstrain(desk, drawn.lines);
  await assertConflict(desk, drawn, [drawn.perp, par]);
  await desk.page.evaluate(() => (window as never as Probe).__neocad.files.flush());
  await desk.page.reload({ waitUntil: "networkidle" });
  await desk.page.waitForFunction(() => (window as never as Probe).__neocad?.model?.relations?.size >= 4, null, { timeout: 20_000 });
  await assertConflict(desk, drawn, [drawn.perp, par]);
});

test("desktop: a drag on the drawing holding the conflict folds nothing, and the verdict stays", async () => {
  await fresh(desk);
  const drawn = await drawRectangle(desk);
  const par = await parallelFromConstrain(desk, drawn.lines);
  await assertConflict(desk, drawn, [drawn.perp, par]);
  await desk.type("select");
  const corner = (await desk.model()).lines[1].refs[1];
  const from = await desk.at(...(await desk.screenOf((await desk.model()).points[corner])));
  await desk.page.mouse.move(from.x, from.y);
  await desk.page.mouse.down();
  for (let i = 1; i <= 10; i++) await desk.page.mouse.move(from.x - 8 * i, from.y + 3 * i);
  // Mid-drag: still nothing folded.
  const mid = await lengths(desk, drawn.lines);
  assert.ok(mid.every((l) => l > 5), `mid-drag: ${mid}`);
  await desk.page.mouse.up();
  await assertConflict(desk, drawn, [drawn.perp, par]);
});

test("no uncaught page errors on the desktop", () => {
  assert.deepEqual(desk.pageErrors, []);
});

// --- iPhone 13 ------------------------------------------------------------------

let phone: AppContext;
let f: Fingers;
before(async () => { phone = await openApp({ device: "iPhone 13" }); });
after(async () => { await phone.close(); });

const middleOf = (selector: string) => phone.page.$eval(selector, (el) => {
  const r = el.getBoundingClientRect();
  const c = document.getElementById("cv")!.getBoundingClientRect();
  return [r.x + r.width / 2 - c.x, r.y + r.height / 2 - c.y] as [number, number];
});

/** A tap on the canvas: `at` must be clear of every pane. `chrome` taps a button or a row instead. */
async function tap(at: [number, number], chrome = false): Promise<void> {
  if (!chrome) await phone.at(...at); // throws if a pane is there
  await f.tap(...at);
}

test("iPhone 13: a rectangle drawn with a finger, two sides tapped, Parallel tapped — CONFLICT, both red, Delete clears it", async () => {
  await fresh(phone);
  await phone.page.evaluate(() => (document.activeElement as HTMLElement | null)?.blur());
  f = await fingers(phone);
  await phone.type("rectangle");
  await phone.page.evaluate(() => (document.activeElement as HTMLElement | null)?.blur());
  const [p, q] = [await phone.screenOf([-18, -14, 0]), await phone.screenOf([18, 16, 0])];
  await phone.at(...p);
  await f.drag(p, q, 12);
  await phone.page.waitForFunction(() => (window as never as Probe).__neocad.model.relations.size >= 3);
  await phone.type("select");
  await phone.page.evaluate(() => (document.activeElement as HTMLElement | null)?.blur());
  await verdict(phone, "SOLVED");
  const lines = (await phone.model()).lines.map((l) => l.name);
  const perp = (await relations(phone)).find((r) => r.op === "perpendicular")!.name;
  const drawn: Drawn = { lines, perp, before: await lengths(phone, lines) };

  await tap(await along(phone, lines[0], 0.3));
  await tap(await along(phone, lines[1], 0.7)); // clear of its corner and of the glyphs at its middle
  await selected(phone, [lines[0], lines[1]]);
  // Constrain is behind the relate group's button: a long-press opens the flyout.
  await f.hold(...await middleOf('#toolbar button[data-group="relate"]'), 700);
  await phone.page.waitForSelector('#flyout button[data-tool="constrain"]', { state: "visible", timeout: 3000 });
  await tap(await middleOf('#flyout button[data-tool="constrain"]'), true);
  const row = `#options .ocmd[data-command='par("${lines[0]}", "${lines[1]}")']`;
  await phone.page.waitForSelector(row, { state: "visible", timeout: 3000 });
  await tap(await middleOf(row), true);
  await phone.page.waitForFunction(() => [...(window as never as Probe).__neocad.model.relations.values()].some((r) => r.op === "parallel"
    && (r.args as string[]).length === 2 && [...(window as never as Probe).__neocad.model.relations.values()].filter((x) => x.op === "parallel").length === 3));
  const par = (await relations(phone)).find((r) => r.op === "parallel" && r.args[0] === lines[0] && r.args[1] === lines[1])!.name;
  await assertConflict(phone, drawn, [perp, par]);
  await shot(phone, "3-iphone-parallel-across-a-right-angle");

  await tap(await middleOf(`#diagnosis .rel[data-relation="${par}"]`), true);
  await selected(phone, [par]);
  // The action strip's Delete: a finger's Delete key.
  await tap(await middleOf('#actions button[data-action="delete"]'), true);
  await verdict(phone, "SOLVED");
  assert.ok(!(await relations(phone)).some((r) => r.name === par), "the par is gone");
  const red = await redGlyphs(phone);
  assert.deepEqual(Object.entries(red).filter(([, on]) => on.some(Boolean)), [], "no glyph left red");
  await shot(phone, "4-iphone-the-par-deleted");
});

test("no uncaught page errors on the phone", () => {
  assert.deepEqual(phone.pageErrors, []);
});
