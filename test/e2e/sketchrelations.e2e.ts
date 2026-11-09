// The sketch-relations package in the real app (docs/plans/sketch-relations.md):
// the dimension tool on a line, an angle and a radius; the constrain tool on two
// selected lines; free entities in the free ink until dimensioned, the status's
// count going to zero; a conflict's relations named, drawn red, selected from
// the status and deleted. With a mouse and on an iPhone 13.
//
// The unit suite proves the rank analysis and the relations. What only a
// browser shows is whether the ink on the canvas is the analysis's answer, and
// whether the status a person reads says what the model is — the stale-readout
// bug this project has paid for more than once.

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
  await app.page.waitForTimeout(150);
  await app.page.screenshot({ path: join(SHOTS, `sketchrelations-${name}.png`) });
}

/** The free ink and the held one, as main.ts draws them. */
const FREE = [0x5a, 0xa2, 0xff];
const HELD = [0xaf, 0xc6, 0xd9];
const RED = [0xe0, 0x60, 0x5c];

interface Probe {
  __neocad: {
    diagnosis(): { dof: number; free: Set<string>; redundant: string[] } | null;
    model: { relations: Map<string, { op: string; args: unknown[] }>; coords(n: string): number[]; line(n: string): { refs: [string, string] } };
    engine: { glyphs(): { relation: string; symbol: string; screen: [number, number]; halfW: number; halfH: number }[] };
  };
}

const diag = (app: AppContext) => app.page.evaluate(() => {
  const d = (window as never as Probe).__neocad.diagnosis();
  return d ? { dof: d.dof, free: [...d.free].sort(), redundant: d.redundant } : null;
});
const relations = (app: AppContext) => app.page.evaluate(() =>
  [...(window as never as Probe).__neocad.model.relations.entries()].map(([name, r]) => ({ name, op: r.op, args: r.args })));
const glyphs = (app: AppContext) => app.page.evaluate(() => (window as never as Probe).__neocad.engine.glyphs());
const diagnosisText = (app: AppContext) => app.page.$eval("#diagnosis", (el) => el.textContent ?? "");

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
const close = (p: number[], want: number[], tol = 40) => Math.hypot(p[0] - want[0], p[1] - want[1], p[2] - want[2]) < tol;

async function click(app: AppContext, [sx, sy]: [number, number], shift = false): Promise<void> {
  const at = await app.at(sx, sy);
  if (shift) await app.page.keyboard.down("Shift");
  await app.page.mouse.click(at.x, at.y);
  if (shift) await app.page.keyboard.up("Shift");
  await app.page.waitForTimeout(120);
}

/** An empty spot on the canvas, clear of the drawing these tests make and of every pane. */
async function emptySpot(app: AppContext): Promise<[number, number]> {
  return app.screenOf([-60, -45, 0]);
}

async function park(app: AppContext): Promise<void> {
  const at = await app.at(...(await app.screenOf([-70, 40, 0])));
  await app.page.mouse.move(at.x, at.y);
  await app.page.waitForTimeout(100);
}

/** The group's button a tool is behind (tool.ts, TOOL_GROUPS), for the two this file presses. */
const GROUP_OF: Record<string, string> = { dimension: "relate", constrain: "relate" };

/**
 * Presses a tool's button — or, for a tool behind a group's button (constrain
 * is behind dimension's, the relate group's: tool.ts, TOOL_GROUPS), rests the
 * mouse on the group's button until its flyout opens and clicks the tool there
 * (docs/plans/toolbar-groups.md).
 */
async function pressButton(app: AppContext, tool: string): Promise<void> {
  const own = await app.page.$(`#toolbar button[data-tool="${tool}"]`);
  if (own) {
    await own.click();
  } else {
    const group = GROUP_OF[tool];
    assert.ok(group, `${tool} is on no button and in no group this helper knows`);
    await app.page.hover(`#toolbar button[data-group="${group}"]`);
    await app.page.waitForSelector(`#flyout button[data-tool="${tool}"]`, { state: "visible", timeout: 3000 });
    await app.page.click(`#flyout button[data-tool="${tool}"]`);
  }
  await app.page.waitForTimeout(150);
}

let desk: AppContext;
before(async () => { desk = await openApp(); });
after(async () => { await desk.close(); });

test("desktop: a drawn rectangle is free ink until fixed and dimensioned, the status counting down to 0 free", async () => {
  await fresh(desk);
  await desk.type("rectangle");
  const [a, b] = [await desk.screenOf([-20, -10, 0]), await desk.screenOf([30, 20, 0])];
  const from = await desk.at(...a), to = await desk.at(...b);
  await desk.page.mouse.move(from.x, from.y);
  await desk.page.mouse.down();
  for (let i = 1; i <= 8; i++) await desk.page.mouse.move(from.x + ((to.x - from.x) * i) / 8, from.y + ((to.y - from.y) * i) / 8);
  await desk.page.mouse.up();
  await desk.page.waitForTimeout(200);
  await desk.type("select");
  assert.equal(await desk.status(), "SOLVED");
  const lines = (await desk.model()).lines.map((l) => l.name);
  assert.equal(lines.length, 4, "a rectangle");
  let d = (await diag(desk))!;
  // The tool's rectangle is a right angle at every corner — not held level —
  // so it can move (2), turn (1), and stretch both ways (2). The four right
  // angles say one thing more than once, and the status counts them, muted,
  // naming none (profiles-held.md; the register's "redundancy counted, not
  // blamed on the newest relation" — it used to say `redundant r4`).
  assert.equal(d.dof, 5, `where it is, which way, how big: ${JSON.stringify(d)}`);
  assert.match(await diagnosisText(desk), /^5 free · 4 agreeing$/);
  await park(desk);
  assert.ok(close(await inkNear(desk, await along(desk, lines[0], 0.3), FREE), FREE), "an edge in the free ink");
  await shot(desk, "1-free-rectangle");

  // Pin a corner where it is, then dimension two sides with the tool.
  const corner = (await desk.model()).lines[0].refs[0];
  const at = (await desk.model()).points[corner];
  await desk.type(`fix("${corner}", [${at[0]}, ${at[1]}])`);
  d = (await diag(desk))!;
  assert.equal(d.dof, 3, "which way it turns, its width and its height");
  // Level it with the constrain tool: its bottom edge, then Horizontal.
  await pressButton(desk, "constrain");
  await click(desk, await along(desk, lines[0], 0.3));
  await desk.page.click(`#constraints .ocmd[data-command='horizontal("${lines[0]}")']`);
  await desk.page.waitForTimeout(250);
  d = (await diag(desk))!;
  assert.equal(d.dof, 2, "its width and height");
  await pressButton(desk, "dimension");
  for (const l of lines.slice(0, 2)) {
    await click(desk, await along(desk, l, 0.3));
    await click(desk, await emptySpot(desk));
  }
  await made(desk, ["dist"], 2);
  const dims = (await relations(desk)).filter((r) => r.op === "dist");
  assert.equal(dims.length, 2, JSON.stringify(dims));
  assert.equal(await desk.status(), "SOLVED");
  d = (await diag(desk))!;
  assert.equal(d.dof, 0, JSON.stringify(d));
  assert.deepEqual(d.free, []);
  assert.match(await diagnosisText(desk), /^0 free · 4 agreeing$/);
  await desk.type("select");
  await park(desk);
  assert.ok(close(await inkNear(desk, await along(desk, lines[2], 0.3), HELD), HELD), "and now in the held ink");
  // The labels hold what was measured, as the menu's Dimension would: 50 × 30.
  const labels = (await glyphs(desk)).filter((g) => dims.some((r) => r.name === g.relation)).map((g) => g.symbol).sort();
  assert.deepEqual(labels, ["30", "50"]);
  await shot(desk, "2-held-rectangle");
});

/**
 * Waits for `count` relations of `ops` to exist: the dimension tool tries a
 * dimension on a copy before it types it (smart-dimension.md), so its commit
 * lands a moment after the click, not within it.
 */
async function made(app: AppContext, ops: string[], count: number): Promise<void> {
  await app.page.waitForFunction(([ops, count]) =>
    [...(window as never as Probe).__neocad.model.relations.values()].filter((r) => (ops as string[]).includes(r.op)).length >= (count as number),
  [ops, count] as const, { timeout: 20_000 });
}

// A whole circle's diameter, SolidWorks' default (docs/plans/smart-dimension.md).
test("desktop: the dimension tool on an angle and a diameter — two lines then a click, a circle then a click", async () => {
  await fresh(desk);
  await desk.type('a = pt(0, 0); b = pt(40, 0); c = pt(30, 30); ln(a, b); ln(a, c); circ(pt(-30, 10), 12)');
  await pressButton(desk, "dimension");
  await click(desk, await along(desk, "l1", 0.7));
  await click(desk, await along(desk, "l2", 0.7));
  await click(desk, await emptySpot(desk));
  const [x, y] = await desk.screenOf([-30, 22, 0]);
  await click(desk, [x, y]);
  await click(desk, await emptySpot(desk));
  await made(desk, ["angle", "diameter"], 2);
  const dims = (await relations(desk)).filter((r) => r.op === "angle" || r.op === "diameter");
  assert.deepEqual(dims.map((r) => r.op), ["angle", "diameter"]);
  assert.ok(Math.abs((dims[0].args[2] as number) - Math.PI / 4) < 1e-9, "45°, as measured");
  assert.equal(dims[1].args[1], 24);
  const symbols = (await glyphs(desk)).filter((g) => dims.some((r) => r.name === g.relation)).map((g) => g.symbol);
  assert.deepEqual(symbols.sort(), ["45°", "⌀24"]);
  assert.match(await desk.log(), /ang\("l1", "l2", deg\(45\)\)/, "typed as the command it is");
  assert.equal(await desk.status(), "SOLVED");
  await desk.type("select");
  await park(desk);
  await shot(desk, "3-angle-and-radius");
});

test("desktop: two lines selected, constrain from the relate button's flyout lists what they take, and Parallel makes them parallel", async () => {
  await fresh(desk);
  await desk.type('ln(pt(-30, 0), pt(30, 4)); ln(pt(-30, 25), pt(30, 15))');
  await click(desk, await along(desk, "l1", 0.3));
  await click(desk, await along(desk, "l2", 0.3), true);
  assert.deepEqual((await desk.selection()).sort(), ["l1", "l2"]);
  await pressButton(desk, "constrain");
  const rows = await desk.page.$$eval("#constraints .ocmd", (els) => els.map((e) => (e as HTMLElement).dataset.command));
  assert.deepEqual(rows.slice(0, 4), ['par("l1", "l2")', 'perp("l1", "l2")', 'eq("l1", "l2")', 'col("l1", "l2")']);
  await shot(desk, "4-constrain-panel");
  await desk.page.click('#constraints .ocmd[data-command="par(\\"l1\\", \\"l2\\")"]');
  await desk.page.waitForTimeout(250);
  const par = (await relations(desk)).filter((r) => r.op === "parallel");
  assert.deepEqual(par.map((r) => r.args), [["l1", "l2"]]);
  const m = await desk.model();
  const dir = (n: string) => { const l = m.lines.find((x) => x.name === n)!; const [p, q] = [m.points[l.refs[0]], m.points[l.refs[1]]]; return [q[0] - p[0], q[1] - p[1]]; };
  const [u, v] = [dir("l1"), dir("l2")];
  assert.ok(Math.abs(u[0] * v[1] - u[1] * v[0]) < 1e-6, "parallel");
  assert.equal(await desk.page.$$eval("#constraints .ocmd", (els) => els.length), 0, "the picks are spent");
  assert.equal((await desk.repl("undo()")).ok, true);
  assert.equal((await relations(desk)).filter((r) => r.op === "parallel").length, 0, "one undo step");
});

test("desktop: a conflict names its relations, draws them red, and one is selected from the status and deleted", async () => {
  await fresh(desk);
  await desk.type('a = pt(-20, 0); b = pt(20, 0); ln(a, b); dist(a, b, 40); dist(a, b, 60)');
  assert.equal(await desk.status(), "CONFLICT");
  assert.match(await diagnosisText(desk), /^(d1 · d2|d2 · d1) cannot all hold$/);
  assert.match(await desk.log(), /these cannot all hold: (d1 {2}dist p1 p2 40 · d2 {2}dist p1 p2 60|d2 {2}dist p1 p2 60 · d1 {2}dist p1 p2 40)/);
  await park(desk);
  for (const g of await glyphs(desk)) {
    assert.ok(close(await inkNear(desk, [g.screen[0] + g.halfW - 1, g.screen[1]], RED), RED, 30), `${g.relation}'s box in the conflict ink`);
  }
  await shot(desk, "5-conflict-in-red");
  await desk.page.click('#diagnosis .rel[data-relation="d2"]');
  await desk.page.waitForTimeout(120);
  assert.deepEqual(await desk.selection(), ["d2"]);
  await desk.page.keyboard.press("Delete");
  await desk.page.waitForTimeout(250);
  assert.deepEqual((await relations(desk)).map((r) => r.name), ["d1"]);
  assert.equal(await desk.status(), "SOLVED");
  assert.match(await diagnosisText(desk), /free$/);
  await park(desk);
  await shot(desk, "6-conflict-deleted");
});

test("desktop: two relations that agree are counted, muted, named by neither, and fail nothing", async () => {
  await fresh(desk);
  await desk.type('a = pt(0, 0); b = pt(30, 0); c = pt(0, 20); ln(a, b); ln(a, c); perp("l1", "l2"); perp("l2", "l1")');
  assert.equal(await desk.status(), "SOLVED");
  // It used to read `redundant r2` — the second perp blamed for agreeing with
  // the first (the register, 2026-11-09: redundancy counted, not blamed).
  assert.match(await diagnosisText(desk), /free · 2 agreeing$/);
  assert.equal(await desk.page.$eval("#diagnosis", (el) => el.className), "agreeing");
  // The palette names them, with nothing selected, as one agreeing set.
  await desk.type("select");
  const agreeing = await desk.page.$$eval('#constraints [data-section="agreeing"] .crow', (els) => els.map((e) => (e as HTMLElement).dataset.name));
  assert.deepEqual(agreeing, ["r1", "r2"]);
  // Muted as a count is, never orange: it agrees (docs/plans/profiles-held.md).
  assert.equal(await desk.page.$eval("#diagnosis", (el) => getComputedStyle(el).color), "rgb(122, 139, 155)");
});

test("no uncaught page errors on the desktop", () => {
  assert.deepEqual(desk.pageErrors, []);
});

// --- iPhone 13 ------------------------------------------------------------------

let phone: AppContext;
let f: Fingers;
before(async () => { phone = await openApp({ device: "iPhone 13" }); });
after(async () => { await phone.close(); });

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

/** A tap on the canvas: `at` must be clear of every pane. `chrome` taps a button or a row instead. */
async function tap(at: [number, number], chrome = false): Promise<void> {
  if (!chrome) await phone.at(...at); // throws if a pane is there
  await f.tap(...at);
  await phone.page.waitForTimeout(250);
}

test("iPhone 13: a tap on a line, a tap on empty canvas — a dimension; and its edges go from the free ink to the held", async () => {
  await freshPhone();
  await phone.type('a = pt(0, 0); b = pt(30, 0); ln(a, b); fix(a, [0, 0]); par("l1", xaxis())');
  await phone.page.evaluate(() => (document.activeElement as HTMLElement | null)?.blur());
  assert.equal((await diag(phone))!.dof, 1, "its length");
  assert.ok(close(await inkNear(phone, await along(phone, "l1", 0.5), FREE), FREE), "free");
  await tap(await middleOf('#toolbar button[data-tool="dimension"]'), true);
  await tap(await along(phone, "l1", 0.25));
  await tap(await phone.screenOf([10, -25, 0]));
  await made(phone, ["dist"], 1);
  const dims = (await relations(phone)).filter((r) => r.op === "dist");
  assert.deepEqual(dims.map((r) => r.args), [["p1", "p2", 30]]);
  assert.equal((await diag(phone))!.dof, 0);
  assert.match(await diagnosisText(phone), /^0 free$/);
  assert.ok(close(await inkNear(phone, await along(phone, "l1", 0.5), HELD), HELD), "held");
  await shot(phone, "7-phone-dimensioned");
});

test("iPhone 13: two lines tapped, constrain from the relate button's flyout, a tap on Parallel", async () => {
  await freshPhone();
  await phone.type('ln(pt(-20, 0), pt(20, 3)); ln(pt(-20, 25), pt(20, 15))');
  await phone.page.evaluate(() => (document.activeElement as HTMLElement | null)?.blur());
  await tap(await along(phone, "l1", 0.3));
  await tap(await along(phone, "l2", 0.3));
  assert.deepEqual((await phone.selection()).sort(), ["l1", "l2"], "a tap adds to the selection on a phone");
  // Constrain is behind dimension's button, the relate group's (tool.ts,
  // TOOL_GROUPS): a long-press opens the flyout, a tap on the item arms it
  // (docs/plans/toolbar-groups.md).
  await f.hold(...await middleOf('#toolbar button[data-group="relate"]'), 700);
  await phone.page.waitForSelector('#flyout button[data-tool="constrain"]', { state: "visible", timeout: 3000 });
  await tap(await middleOf('#flyout button[data-tool="constrain"]'), true);
  const rows = await phone.page.$$eval("#constraints .ocmd", (els) => els.map((e) => (e as HTMLElement).dataset.command));
  assert.equal(rows[0], 'par("l1", "l2")');
  await shot(phone, "8-phone-constrain-panel");
  await tap(await middleOf('#constraints .ocmd[data-command="par(\\"l1\\", \\"l2\\")"]'), true);
  assert.deepEqual((await relations(phone)).filter((r) => r.op === "parallel").map((r) => r.args), [["l1", "l2"]]);
});

test("no uncaught page errors on the phone", () => {
  assert.deepEqual(phone.pageErrors, []);
});

test("iPhone 13 landscape: thirteen buttons take two rows, every one on screen, and the diagnosis reads beside the verdict", async () => {
  const land = await openApp({ device: "iPhone 13 landscape" });
  try {
    await fresh(land);
    await land.type('a = pt(0, 0); b = pt(40, 0); c = pt(0, 25); ln(a, b); ln(a, c); dist(a, b, 40); perp("l1", "l2")');
    await land.page.evaluate(() => (document.activeElement as HTMLElement | null)?.blur());
    const bs = await land.page.$$eval("#toolbar button", (els) => els.map((b) => {
      const r = b.getBoundingClientRect();
      return { y: Math.round(r.y), inside: r.left >= 0 && r.top >= 0 && r.right <= innerWidth && r.bottom <= innerHeight };
    }));
    assert.equal(bs.length, 13);
    assert.equal(new Set(bs.map((b) => b.y)).size, 2, "two rows");
    assert.ok(bs.every((b) => b.inside), "every button wholly on screen");
    assert.match(await diagnosisText(land), /^\d+ free$/);
    await shot(land, "9-phone-landscape-two-rows");
    assert.deepEqual(land.pageErrors, []);
  } finally {
    await land.close();
  }
});
