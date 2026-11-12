// Smart dimension in the real app (docs/plans/smart-dimension.md) — the owner:
// *"Dim tool needs to be similar in functionality to Solidworks smart
// dimension. I should be able to use it to dimension virtually anything.
// Distance between two faces of a solid, or angle"*. With a mouse, and on an
// iPhone 13 by finger:
//
// - two faces of an extruded block picked, the label placed, then its value
//   set by a double-click (a double-tap) on the label — the block changes;
// - the angle between two faces of a wedge;
// - a circle's diameter and an arc's radius, SolidWorks' defaults;
// - horizontal or vertical, by where the label is put;
// - two faces whose distance both depths already hold — made driven, and said.
//
// The unit suite holds the table. What only a browser shows is whether a
// face under the hand is the face lit and the face picked, and whether the
// number on the drawing is the one typed. Set NEOCAD_E2E_SHOTS to keep the
// pictures; look at them.

import { test, before, after } from "node:test";
import assert from "node:assert/strict";
import { mkdirSync } from "node:fs";
import { join } from "node:path";
import { forgetAutosave, openApp, type AppContext } from "./harness.ts";
import { fingers, type Fingers } from "./fingers.ts";

const SHOTS = process.env.NEOCAD_E2E_SHOTS;
async function shot(app: AppContext, name: string): Promise<void> {
  if (!SHOTS) return;
  mkdirSync(SHOTS, { recursive: true });
  await app.page.waitForTimeout(200);
  await app.page.screenshot({ path: join(SHOTS, `smartdim-${name}.png`) });
}

interface Probe {
  __neocad: {
    model: {
      relations: Map<string, { op: string; args: unknown[] }>;
      coords(n: string): number[];
      line(n: string): { refs: [string, string] };
      radius(n: string): number;
    };
    engine: {
      active: { picks?: string[] } | null;
      glyphs(): { relation: string; op: string; symbol: string; screen: [number, number] }[];
    };
  };
}

const relations = (app: AppContext) => app.page.evaluate(() =>
  [...(window as never as Probe).__neocad.model.relations.entries()].map(([name, r]) => ({ name, op: r.op, args: r.args })));
const glyphs = (app: AppContext) => app.page.evaluate(() => (window as never as Probe).__neocad.engine.glyphs());
const picks = (app: AppContext) => app.page.evaluate(() => [...((window as never as Probe).__neocad.engine.active?.picks ?? [])]);

async function fresh(app: AppContext): Promise<void> {
  await app.page.evaluate(() => localStorage.clear());
  await forgetAutosave(app.page);
  await app.page.reload({ waitUntil: "networkidle" });
  await app.page.waitForFunction(() => document.getElementById("status")?.textContent?.includes("ready"), null, { timeout: 20_000 });
}

/** Typed, then the command line let go of, as a hand does before it touches the drawing again. */
async function type(app: AppContext, line: string): Promise<void> {
  await app.type(line);
  await app.page.evaluate(() => (document.activeElement as HTMLElement | null)?.blur());
  await app.page.waitForTimeout(150);
}

/** A closed polygon on the ground, extruded: `pts` its corners, `depth` how far. Its lines are l1… in order. */
async function solid(app: AppContext, pts: [number, number][], depth: number): Promise<void> {
  const names = pts.map((_, i) => `q${i}`);
  await type(app, `plane(); ${pts.map(([x, y], i) => `${names[i]} = pt(${x}, ${y}, 0)`).join("; ")}`);
  await type(app, names.map((n, i) => `ln(${n}, ${names[(i + 1) % names.length]})`).join("; "));
  // Held on the plane, as a sketch tool holds what it draws (typed points are held by nothing).
  await type(app, names.map((n) => `onplane(${n})`).join("; "));
  await type(app, `extrude("l1", ${depth})`);
}

const STEP: [number, number][] = [[0, 0], [40, 0], [40, 15], [20, 15], [20, 30], [0, 30]];
const WEDGE: [number, number][] = [[0, 0], [40, 0], [0, 40 * Math.tan(Math.PI / 6)]];
/** From in front, to the right and above: the step's two +x walls, the wedge's front and its slope, all in sight. */
const CORNER = "orbit(0, -0.9); orbit(-1.2, 0)";

/** The distance between two lines' middles, square to the first — what `dist` between them holds. */
const lineGap = (app: AppContext, a: string, b: string) => app.page.evaluate(([a, b]) => {
  const m = (window as never as Probe).__neocad.model;
  const [p, q] = m.line(a).refs.map((n) => m.coords(n));
  const [c, d] = m.line(b).refs.map((n) => m.coords(n));
  const mid = c.map((v, i) => (v + d[i]) / 2);
  const u = q.map((v, i) => v - p[i]), w = mid.map((v, i) => v - p[i]);
  const t = w.reduce((s, v, i) => s + v * u[i], 0) / u.reduce((s, v) => s + v * v, 0);
  return Math.hypot(...w.map((v, i) => v - t * u[i]));
}, [a, b]);

// --- desktop ------------------------------------------------------------------

let desk: AppContext;
before(async () => { desk = await openApp(); });
after(async () => { await desk.close(); });

async function click(app: AppContext, world: number[]): Promise<void> {
  const at = await app.at(...(await app.screenOf(world)));
  await app.page.mouse.click(at.x, at.y);
  await app.page.waitForTimeout(150);
}

async function hover(app: AppContext, world: number[]): Promise<void> {
  const at = await app.at(...(await app.screenOf(world)));
  await app.page.mouse.move(at.x, at.y);
  await app.page.waitForTimeout(150);
}

test("desktop: two faces of a stepped block, then a double-click on the label and a value — the block changes", async () => {
  await fresh(desk);
  await solid(desk, STEP, 20);
  await type(desk, `${CORNER}; zoom(3.5); pan(-60, 90); arm("dimension")`);
  // The step's near +x wall, lit under the hand before it is picked.
  await hover(desk, [40, 7, 10]);
  await shot(desk, "1-face-under-the-hand");
  await click(desk, [40, 7, 10]);
  await click(desk, [20, 26, 14]);
  assert.deepEqual(await picks(desk), ["e1:l2", "e1:l4"], "the step's two +x walls, each by the line it is swept from");
  await hover(desk, [55, 30, 10]);
  await shot(desk, "2-two-faces-picked");
  await click(desk, [55, 30, 10]);
  await desk.page.mouse.move(5, 300);
  await shot(desk, "2b-placed");
  await desk.page.waitForTimeout(400);
  const dims = (await relations(desk)).filter((r) => r.op === "dist");
  assert.deepEqual(dims.map((r) => r.args), [["l2", "l4", 20]], "the walls are their lines: dist on the sketch");
  // A double-click on the label opens its value, as Set value… does.
  const label = (await glyphs(desk)).find((g) => g.relation === dims[0].name)!;
  assert.equal(label.symbol, "20");
  const at = await desk.at(...label.screen);
  await desk.page.mouse.dblclick(at.x, at.y);
  await desk.page.waitForTimeout(200);
  assert.equal(await desk.page.inputValue("#cmd"), `set("${dims[0].name}.value", `);
  await desk.page.type("#cmd", "30)");
  await desk.page.press("#cmd", "Enter");
  await desk.page.waitForTimeout(400);
  const gap = await lineGap(desk, "l2", "l4");
  assert.ok(Math.abs(gap - 30) < 1e-6, `the step is 30 deep now: ${gap}; ${(await desk.log()).split("\n").slice(-6).join(" / ")}`);
  assert.equal(await desk.status(), "SOLVED");
  await desk.page.mouse.move(700, 560);
  await shot(desk, "3-the-step-set-to-30");
  // The dimension is the sketch's, labelled on the sketch: from here the step, set deeper, hides its own label
  // behind the near wall (looked at, smartdim-3) — a limitation filed in TODO.md, not asserted away.
  assert.deepEqual((await relations(desk)).find((r) => r.name === dims[0].name)?.args, ["l2", "l4", 30]);
});

test("desktop: the angle between two faces of a wedge is the wedge's", async () => {
  await fresh(desk);
  await solid(desk, WEDGE, 10);
  await type(desk, `${CORNER}; zoom(4); pan(-80, 90); arm("dimension")`);
  await click(desk, [20, 0, 5]);
  await click(desk, [20, WEDGE[2][1] / 2, 5]);
  assert.deepEqual(await picks(desk), ["e1:l1", "e1:l2"], "the front and the slope");
  await click(desk, [55, 10, 5]);
  await desk.page.waitForTimeout(400);
  const a = (await relations(desk)).find((r) => r.op === "cornerAngle")!;
  assert.ok(a, "the corner their two lines make");
  assert.deepEqual(a.args.slice(0, 2), ["l1", "l2"], "naming the lines the walls are swept from, not three points");
  assert.ok(Math.abs((a.args[2] as number) - Math.PI / 6) < 1e-9, `30°: ${a.args[2]}`);
  assert.ok((await glyphs(desk)).some((g) => g.symbol === "30°"), "drawn as 30°");
  await desk.page.mouse.move(700, 560);
  await shot(desk, "4-the-wedge-is-30");
});

test("desktop: a circle's diameter and an arc's radius, by default", async () => {
  await fresh(desk);
  await type(desk, 'c = circ(pt(-20, 0), 10); s = pt(30, 0); e = pt(20, 10); arc(pt(20, 0), s, e, 10); arcends("a1"); zoom(2); arm("dimension")');
  await click(desk, [-20, 10, 0]);
  await click(desk, [-20, -25, 0]);
  await click(desk, [20 + 10 * Math.SQRT1_2, 10 * Math.SQRT1_2, 0]);
  await click(desk, [40, 25, 0]);
  await desk.page.waitForTimeout(400);
  const rs = (await relations(desk)).filter((r) => r.op === "diameter" || r.op === "radius");
  assert.deepEqual(rs.map((r) => [r.op, ...r.args]), [["diameter", "c1", 20], ["radius", "a1", 10]]);
  const symbols = (await glyphs(desk)).map((g) => g.symbol);
  assert.ok(symbols.includes("⌀20") && symbols.includes("R10"), symbols.join(" "));
  await desk.page.mouse.move(700, 560);
  await shot(desk, "5-circle-diameter-arc-radius");
});

test("desktop: horizontal or vertical, by where the label is put", async () => {
  await fresh(desk);
  await type(desk, 'ln(pt(0, 0), pt(30, 20)); zoom(2.5); arm("dimension")');
  await click(desk, [15, 10, 0]);
  await click(desk, [15, 35, 0]); // above both: horizontal
  await click(desk, [15, 10, 0]);
  await click(desk, [-15, 10, 0]); // beside both: vertical
  await desk.page.waitForTimeout(400);
  const along = (await relations(desk)).filter((r) => r.op === "distAlong");
  assert.deepEqual(along.map((r) => [r.args[2], r.args[3]]), [["origin.x", 30], ["origin.y", 20]]);
  const symbols = (await glyphs(desk)).map((g) => g.symbol);
  assert.ok(symbols.includes("30") && symbols.includes("20"), symbols.join(" "));
  await desk.page.mouse.move(700, 560);
  await shot(desk, "6-horizontal-and-vertical");
});

test("desktop: two lids both depths already hold — made driven, and the log says so", async () => {
  await fresh(desk);
  await solid(desk, [[0, 0], [30, 0], [30, 20], [0, 20]], 10);
  await type(desk, 'r0 = pt(40, 10, 0); r1 = pt(60, 10, 0); r2 = pt(60, 30, 0); r3 = pt(40, 30, 0); k = ln(r0, r1); ln(r1, r2); ln(r2, r3); ln(r3, r0); onplane(r0); onplane(r1); onplane(r2); onplane(r3); extrude(k, 25)');
  await type(desk, 'orbit(0, -0.9); zoom(2); arm("dimension")');
  await click(desk, [15, 10, 10]);
  await click(desk, [50, 20, 25]);
  assert.deepEqual(await picks(desk), ["e1.lid", "e2.lid"]);
  await click(desk, [35, -15, 0]);
  await desk.page.waitForTimeout(800);
  const m = (await relations(desk)).filter((r) => r.op === "measure");
  assert.deepEqual(m.map((r) => r.args), [["fdist", "e1.lid", "e2.lid"]], (await desk.log()).split("\n").slice(-5).join(" / "));
  assert.match(await desk.log(), /made driven — what it measures is already held/);
  assert.ok((await glyphs(desk)).some((g) => g.symbol === "(15)"), "a reference dimension, in parentheses");
  await desk.page.mouse.move(700, 560);
  await shot(desk, "7-lid-to-lid-driven");
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

async function tap(world: number[]): Promise<void> {
  const at = await phone.screenOf(world);
  await phone.at(...at); // throws if a pane is there
  await f.tap(...at);
  await phone.page.waitForTimeout(300);
}

test("iPhone 13: two faces tapped, a tap to place, a double-tap on the label — the block changes", async () => {
  await freshPhone();
  await solid(phone, STEP, 20);
  await type(phone, `${CORNER}; zoom(2.1); pan(-30, 90); arm("dimension")`);
  await tap([40, 7, 10]);
  await tap([20, 26, 14]);
  assert.deepEqual(await picks(phone), ["e1:l2", "e1:l4"]);
  await shot(phone, "8-iphone-two-faces-tapped");
  // Empty canvas above the block, clear of the panes: where the label goes.
  await phone.at(110, 262);
  await f.tap(110, 262);
  await phone.page.waitForTimeout(300);
  await phone.page.waitForTimeout(400);
  const dims = (await relations(phone)).filter((r) => r.op === "dist");
  assert.deepEqual(dims.map((r) => r.args), [["l2", "l4", 20]]);
  const label = (await glyphs(phone)).find((g) => g.relation === dims[0].name)!;
  await phone.at(...label.screen);
  await f.doubleTap(...label.screen);
  await phone.page.waitForTimeout(300);
  assert.equal(await phone.page.inputValue("#cmd"), `set("${dims[0].name}.value", `, `a double-tap opens the value: ${(await phone.log()).split("\n").slice(-4).join(" / ")} · ${JSON.stringify(label.screen)} · ${JSON.stringify((await glyphs(phone)).filter((g) => g.op === "dist"))}`);
  await phone.page.type("#cmd", "22)");
  await phone.page.press("#cmd", "Enter");
  await phone.page.waitForTimeout(400);
  await phone.page.evaluate(() => (document.activeElement as HTMLElement | null)?.blur());
  assert.ok(Math.abs(await lineGap(phone, "l2", "l4") - 22) < 1e-6, "the step is 22 deep now");
  await shot(phone, "9-iphone-the-step-set-to-22");
});

test("iPhone 13: the wedge's angle, by finger", async () => {
  await freshPhone();
  await solid(phone, WEDGE, 10);
  await type(phone, `${CORNER}; zoom(1.6); arm("dimension")`);
  await tap([20, 0, 5]);
  await tap([20, WEDGE[2][1] / 2, 5]);
  assert.deepEqual(await picks(phone), ["e1:l1", "e1:l2"]);
  await tap([50, 10, 5]);
  await phone.page.waitForTimeout(400);
  const a = (await relations(phone)).find((r) => r.op === "cornerAngle")!;
  assert.ok(a && Math.abs((a.args[2] as number) - Math.PI / 6) < 1e-9);
  await shot(phone, "10-iphone-the-wedge-is-30");
});

// A phone's default view is 3 px to a unit: every target here is ≥ 8 units —
// a finger's 22 px point reach — from every other, or the tap takes a point.
test("iPhone 13: a circle's ⌀ and an arc's R, by finger", async () => {
  await freshPhone();
  await type(phone, 'c = circ(pt(-20, 0), 10); s = pt(40, -10); e = pt(25, 5); arc(pt(25, -10), s, e, 15); arcends("a1"); arm("dimension")');
  await tap([-20 - 10 * Math.SQRT1_2, -10 * Math.SQRT1_2, 0]);
  await tap([-20, -25, 0]);
  await tap([25 + 15 * Math.SQRT1_2, -10 + 15 * Math.SQRT1_2, 0]);
  await tap([45, 15, 0]);
  await phone.page.waitForTimeout(400);
  const rs = await relations(phone);
  assert.deepEqual(rs.filter((r) => r.op === "diameter" || r.op === "radius").map((r) => [r.op, ...r.args]),
    [["diameter", "c1", 20], ["radius", "a1", 15]]);
  const symbols = (await glyphs(phone)).map((g) => g.symbol);
  assert.ok(symbols.includes("⌀20") && symbols.includes("R15"), symbols.join(" "));
  await shot(phone, "11-iphone-circle-diameter-arc-radius");
});

test("iPhone 13: horizontal, then vertical, by where the finger puts the label", async () => {
  await freshPhone();
  await type(phone, 'ln(pt(-30, 0), pt(0, 20)); arm("dimension")');
  await tap([-15, 10, 0]);
  await tap([-5, 30, 0]); // above both: horizontal
  await tap([-15, 10, 0]);
  await tap([-40, 10, 0]); // beside both: vertical
  await phone.page.waitForTimeout(400);
  const along = (await relations(phone)).filter((r) => r.op === "distAlong");
  assert.deepEqual(along.map((r) => [r.args[2], r.args[3]]), [["origin.x", 30], ["origin.y", 20]]);
  await shot(phone, "12-iphone-horizontal-and-vertical");
});

test("no uncaught page errors on the phone", () => {
  assert.deepEqual(phone.pageErrors, []);
});
