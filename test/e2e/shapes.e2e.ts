// The sketch shapes in a real browser (docs/plans/sketch-shapes.md): the
// polygon, the slot and the ellipse, each drawn with its gesture — a mouse on a
// desktop window, then fingers in iPhone 13 emulation — and checked against the
// model: the entities and relations it left (and their glyphs on the canvas),
// a dimension holding, a drag the shape follows, undo, a save and an open, and
// an extrude. Set NEOCAD_E2E_SHOTS to a directory to keep the pictures — and
// look at them, the ellipse's wall shading above all.

import { test, before, after } from "node:test";
import assert from "node:assert/strict";
import { mkdirSync } from "node:fs";
import { join } from "node:path";
import { openApp, forgetAutosave, type AppContext } from "./harness.ts";
import { fingers, type Fingers } from "./fingers.ts";

const SHOTS = process.env.NEOCAD_E2E_SHOTS;
async function shot(app: AppContext, name: string): Promise<void> {
  if (!SHOTS) return;
  mkdirSync(SHOTS, { recursive: true });
  await app.page.waitForTimeout(150);
  await app.page.screenshot({ path: join(SHOTS, `shapes-${name}.png`) });
}

interface Probe {
  __neocad: {
    model: {
      entities: Map<string, { kind: string; name: string; refs?: string[]; center?: string; major?: string; minorVar?: number; construction?: true }>;
      relations: Map<string, { op: string; args: unknown[] }>;
      coords(n: string): number[];
      problem: { getVar(i: number): number };
      features: Map<string, unknown>;
    };
    engine: { glyphs(): { relation: string; op: string }[] };
  };
}

/** Every relation, as `[op, args]`, in the order made. */
const relations = (app: AppContext) => app.page.evaluate(() =>
  [...(window as never as Probe).__neocad.model.relations.values()].map((r) => [r.op, r.args] as [string, unknown[]]));
const ops = async (app: AppContext) => (await relations(app)).map(([op]) => op);
const count = (list: string[], op: string) => list.filter((o) => o === op).length;
/** The ops of the glyphs on the canvas now. */
const glyphOps = (app: AppContext) => app.page.evaluate(() => (window as never as Probe).__neocad.engine.glyphs().map((g) => g.op));
const entities = (app: AppContext) => app.page.evaluate(() =>
  [...(window as never as Probe).__neocad.model.entities.values()].map((e) => ({ ...e })));
const coords = (app: AppContext, n: string) => app.page.evaluate((x) => (window as never as Probe).__neocad.model.coords(x), n);
// The ellipse is the sketch module's now (docs/plans/workbenches.md): its semi-axes read off the entity, as `semiAxes` in kinds/ellipse.ts reads them.
const semiAxes = (app: AppContext, n: string) => app.page.evaluate((x) => {
  const m = (window as never as Probe).__neocad.model;
  const e = m.entities.get(x)!;
  const c = m.coords(e.center!), j = m.coords(e.major!);
  return { a: Math.hypot(...j.map((v, i) => v - c[i])), b: m.problem.getVar(e.minorVar!) };
}, n);

const dist = (a: number[], b: number[]) => Math.hypot(...a.map((v, i) => v - b[i]));

async function fresh(app: AppContext): Promise<void> {
  await app.page.evaluate(() => localStorage.clear());
  await forgetAutosave(app.page);
  await app.page.reload({ waitUntil: "networkidle" });
  await app.page.waitForFunction(() => document.getElementById("status")?.textContent?.includes("ready"), null, { timeout: 20_000 });
}

/** A world point's place on the canvas, a fingertip clear of every panel. */
async function onCanvas(app: AppContext, world: number[]): Promise<[number, number]> {
  const [x, y] = await app.screenOf(world);
  for (const [dx, dy] of [[0, 0], [-12, 0], [12, 0], [0, -12], [0, 12]]) await app.at(x + dx, y + dy); // throws under a panel
  return [x, y];
}

async function settled<T>(app: AppContext, read: () => Promise<T>, want: (t: T) => boolean, what: string): Promise<T> {
  const deadline = Date.now() + 5000;
  for (;;) {
    const v = await read();
    if (want(v)) return v;
    if (Date.now() > deadline) assert.fail(`${what}: ${JSON.stringify(v)}`);
    await app.page.waitForTimeout(50);
  }
}

/** The corners of a closed chain of lines, regular: every side one length, every corner one distance from `c`. */
async function regular(app: AppContext, centre: string, corners: string[]): Promise<{ sides: number[]; reach: number[] }> {
  const at = await Promise.all(corners.map((p) => coords(app, p)));
  const c = await coords(app, centre);
  return { sides: at.map((p, k) => dist(at[(k + 1) % at.length], p)), reach: at.map((p) => dist(p, c)) };
}
const spread = (xs: number[]) => Math.max(...xs) - Math.min(...xs);

/** The polygon the model holds: its centre (the construction circle's) and its corners in order. */
async function polygonOf(app: AppContext): Promise<{ centre: string; corners: string[]; circle: string }> {
  const es = await entities(app);
  const circle = es.find((e) => e.kind === "circle" && e.construction)!;
  const lines = es.filter((e) => e.kind === "line" && !e.construction);
  return { centre: circle.center!, corners: lines.map((l) => l.refs![0]), circle: circle.name };
}

async function savedRoundTrip(app: AppContext): Promise<void> {
  const before = await app.repl("save()");
  assert.equal(before.ok, true, before.error ?? "");
  const text = before.value as string;
  assert.match(text, /"version": 23/);
  const was = await relations(app);
  await app.type("pt(0, 0); pt(5, 5)"); // something to lose
  await app.repl(`SAVED = ${JSON.stringify(text)}`);
  const opened = await app.repl("open(SAVED)");
  assert.equal(opened.ok, true, opened.error ?? "");
  assert.deepEqual(await relations(app), was, "the same relations, by op and argument");
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

async function drag(from: number[], to: number[]): Promise<void> {
  const a = await desk.at(...await onCanvas(desk, from));
  const b = await desk.at(...await onCanvas(desk, to));
  await desk.page.mouse.move(a.x, a.y, { steps: 3 });
  await desk.page.mouse.down();
  await desk.page.mouse.move(b.x, b.y, { steps: 10 });
  await desk.page.waitForTimeout(80);
  await desk.page.mouse.up();
  await desk.page.waitForTimeout(150);
}

async function hover(world: number[]): Promise<void> {
  const at = await desk.at(...await onCanvas(desk, world));
  await desk.page.mouse.move(at.x, at.y, { steps: 5 });
  await desk.page.waitForTimeout(120);
}

async function click(world: number[]): Promise<void> {
  const at = await desk.at(...await onCanvas(desk, world));
  await desk.page.mouse.move(at.x, at.y, { steps: 3 });
  await desk.page.mouse.click(at.x, at.y);
  await desk.page.waitForTimeout(150);
}

const rectOf = (app: AppContext, sel: string) => app.page.$eval(sel, (el) => {
  const r = el.getBoundingClientRect();
  return { x: r.x, y: r.y, w: r.width, h: r.height };
});

test("desktop: the shapes button opens rectangle, polygon, slot; the polygon armed from it is dragged out centre to corner — regular, held so", async () => {
  await fresh(desk);
  // The flyout: a hover on the shapes button, then a click on the polygon.
  await desk.page.mouse.move(700, 400);
  const b = await rectOf(desk, '#toolbar button[data-group="shapes"]');
  await desk.page.mouse.move(b.x + b.w / 2, b.y + b.h / 2, { steps: 2 });
  await desk.page.waitForFunction(() => !(document.getElementById("flyout") as HTMLElement).hidden, null, { timeout: 3000 });
  const items = await desk.page.$$eval("#flyout button", (bs) => bs.map((x) => (x as HTMLElement).dataset.tool));
  assert.deepEqual(items, ["rectangle", "polygon", "slot", "region"]); // the region tool last (regions-as-operations.md)
  await shot(desk, "desk-shapes-flyout");
  const it = await rectOf(desk, '#flyout button[data-tool="polygon"]');
  await desk.page.mouse.move(it.x + it.w / 2, it.y + it.h / 2, { steps: 3 });
  await desk.page.mouse.click(it.x + it.w / 2, it.y + it.h / 2);
  assert.equal((await desk.model()).activeTool, "polygon");

  await drag([0, 0, 0], [20, 5, 0]);
  const m = await settled(desk, () => desk.model(), (x) => x.byKind.line === 6, "six sides");
  assert.equal(m.byKind.circle, 1, "the construction circle");
  const o = await ops(desk);
  assert.equal(count(o, "onCircle"), 6);
  assert.equal(count(o, "equalLength"), 5);
  const { centre, corners } = await polygonOf(desk);
  assert.ok(dist(await coords(desk, centre), [0, 0, 0]) < 0.5, "centred on the press");
  assert.ok(Math.abs(dist(await coords(desk, corners[0]), [0, 0, 0]) - Math.hypot(20, 5)) < 0.6, "a corner at the release");
  let r = await regular(desk, centre, corners);
  assert.ok(spread(r.sides) < 1e-6 && spread(r.reach) < 1e-6, JSON.stringify(r));
  // The relations wear their glyphs.
  const g = await glyphOps(desk);
  for (const op of ["onCircle", "equalLength"]) assert.ok(g.includes(op), `a ${op} glyph on the canvas: ${g.join(" ")}`);
  await desk.page.keyboard.press("Escape");
  await shot(desk, "desk-polygon");

  // A side dimensioned: the polygon stays regular at that size.
  await desk.type(`dist("${corners[1]}", "${corners[2]}", 30)`);
  r = await settled(desk, () => regular(desk, centre, corners), (x) => Math.abs(x.sides[1] - 30) < 1e-6, "the side at 30");
  assert.ok(spread(r.sides) < 1e-6 && spread(r.reach) < 1e-6, `regular at 30: ${JSON.stringify(r)}`);
  // A corner dragged (nothing armed): it turns, and stays regular.
  const before = await coords(desk, corners[3]);
  await drag(before, [before[0] + 15, before[1] - 25, 0]);
  const after = await coords(desk, corners[3]);
  assert.ok(dist(before, after) > 1, "the corner moved");
  r = await regular(desk, centre, corners);
  assert.ok(spread(r.sides) < 1e-6 && spread(r.reach) < 1e-6 && Math.abs(r.sides[0] - 30) < 1e-6, `dragged, still regular at 30: ${JSON.stringify(r)}`);
  await shot(desk, "desk-polygon-dimensioned-and-turned");

  await savedRoundTrip(desk);
  // Undo, back to before the polygon: the open, the drag, the dimension, the polygon.
  for (let k = 0; k < 6 && (await desk.model()).byKind.line; k++) {
    await desk.page.keyboard.press("Control+z");
    await desk.page.waitForTimeout(220);
  }
  assert.equal((await desk.model()).byKind.line ?? 0, 0, "undone to nothing");
});

test("desktop: the slot — dragged centre to centre, a click for its width — its width and length dimensioned, extruded", async () => {
  await fresh(desk);
  await desk.type('arm("slot")');
  await drag([-20, 0, 0], [20, 0, 0]);
  assert.equal((await desk.model()).byKind.line ?? 0, 0, "nothing yet: the width is still to choose");
  await hover([0, 8, 0]);
  await shot(desk, "desk-slot-width");
  await click([0, 8, 0]);
  const m = await settled(desk, () => desk.model(), (x) => x.byKind.arc === 2, "two arcs");
  assert.equal(m.byKind.line, 3, "two sides and the construction axis");
  const o = await ops(desk);
  assert.deepEqual([count(o, "arcEndpoints"), count(o, "equalRadius"), count(o, "perpendicular")], [2, 1, 4]);
  const arcs = m.arcs.map((a) => a.name);
  assert.ok(Math.abs(m.radii[arcs[0]] - 8) < 0.5, `the width from the click: r ${m.radii[arcs[0]]}`);
  const g = await glyphOps(desk);
  for (const op of ["arcEndpoints", "equalRadius", "perpendicular"]) assert.ok(g.includes(op), `${op}'s glyph: ${g.join(" ")}`);
  await desk.page.keyboard.press("Escape");
  // Width 12 (a radius of 6) and 50 between centres.
  const axis = (await entities(desk)).find((e) => e.kind === "line" && e.construction)!;
  await desk.type(`rad("${arcs[0]}", 6); dist("${axis.refs![0]}", "${axis.refs![1]}", 50)`);
  await settled(desk, () => desk.model(), (x) => Math.abs(x.radii[arcs[1]] - 6) < 1e-6
    && Math.abs(dist(x.points[axis.refs![0]], x.points[axis.refs![1]]) - 50) < 1e-6, "width 12, length 50");
  await shot(desk, "desk-slot-dimensioned");
  const side = (await entities(desk)).find((e) => e.kind === "line" && !e.construction)!;
  await desk.type(`extrude("${side.name}", 10)`);
  await settled(desk, () => desk.model(), (x) => x.journalOps.includes("extrude"), "extruded");
  await desk.type("orbit(0.5, 0.6)");
  await shot(desk, "desk-slot-extruded");
  await savedRoundTrip(desk);
});

test("desktop: the ellipse — dragged centre to major end, a click for the minor — dimensioned, dragged, undone, saved, extruded", async () => {
  await fresh(desk);
  // The curves button: a click arms its current member, the ellipse — the
  // first of the group, the spline after it (docs/plans/spline.md).
  await desk.page.click('#toolbar button[data-group="curves"]');
  assert.equal((await desk.model()).activeTool, "ellipse");
  await drag([0, 0, 0], [24, 8, 0]);
  await hover([-3, 9, 0]);
  await shot(desk, "desk-ellipse-minor");
  await click([-3, 9, 0]);
  const es = await settled(desk, () => entities(desk), (x) => x.some((e) => e.kind === "ellipse"), "an ellipse");
  const e = es.find((x) => x.kind === "ellipse")!;
  const { a, b } = await semiAxes(desk, e.name);
  assert.ok(Math.abs(a - Math.hypot(24, 8)) < 0.6, `the major from the drag: ${a}`);
  // The minor: the click's distance from the major axis.
  const u = [24, 8].map((x) => x / Math.hypot(24, 8));
  const want = Math.abs(-3 * -u[1] + 9 * u[0]);
  assert.ok(Math.abs(b - want) < 0.6, `the minor from the click: ${b} against ${want}`);
  const o = await ops(desk);
  // Laid out on the ground and held there by nothing: no plane was picked
  // (docs/plans/profiles-held.md). It was [2, 1] — centre and major end onplane, normal par.
  assert.deepEqual([count(o, "onPlane"), count(o, "parallel")], [0, 0], "no plane picked, so nothing held to one");
  await desk.page.keyboard.press("Escape");
  await shot(desk, "desk-ellipse");

  // Dimensioned from the menu's items, as typed.
  await desk.type(`major("${e.name}", 30); minor("${e.name}", 12)`);
  await settled(desk, () => semiAxes(desk, e.name), (s) => Math.abs(s.a - 30) < 1e-6 && Math.abs(s.b - 12) < 1e-6, "30 × 12");
  const g = await glyphOps(desk);
  assert.ok(g.includes("majorAxis") && g.includes("minorAxis"), `both semi-axes labelled: ${g.join(" ")}`);
  const end = await coords(desk, e.major!);
  // The major end dragged: the ellipse turns with it, its axes held.
  await drag(end, [end[0] - 10, end[1] + 18, 0]);
  const turned = await coords(desk, e.major!);
  assert.ok(dist(turned, end) > 1, "the major end moved");
  const s = await semiAxes(desk, e.name);
  assert.ok(Math.abs(s.a - 30) < 1e-6 && Math.abs(s.b - 12) < 1e-6, `turned, still 30 × 12: ${JSON.stringify(s)}`);
  await shot(desk, "desk-ellipse-dimensioned-and-turned");
  await savedRoundTrip(desk);
  // Undo the open, the drag and the dimensions; then the ellipse is still there.
  await desk.page.keyboard.press("Control+z");
  await desk.page.waitForTimeout(220);
  await desk.type(`extrude("${e.name}", 15)`);
  await settled(desk, () => desk.model(), (x) => x.journalOps.includes("extrude"), "extruded");
  await desk.type("orbit(0.4, 0.7)");
  await shot(desk, "desk-elliptic-cylinder-shaded");
  // Low, so the wall fills the picture: its shading has to run smoothly round
  // the ellipse, light where it faces the headlight and dark at the silhouette.
  await desk.type("orbit(0.2, 0.55); zoom(3)");
  await shot(desk, "desk-elliptic-cylinder-wall");
  // Undo the extrude: no feature.
  await desk.page.keyboard.press("Control+z");
  await desk.page.waitForTimeout(250);
  assert.equal(await desk.page.evaluate(() => (window as never as Probe).__neocad.model.features.size), 0, "the extrude undone");
});

test("desktop: a line drawn onto an ellipse ends on it — onellipse inferred — and a line tangent to it is held so", async () => {
  await fresh(desk);
  await desk.type('ellipse(pt(0, 0), 30, 12)');
  await desk.type('arm("line")');
  await click([-40, 20, 0]);
  await click([0, 12, 0]); // on the minor end: a snap along the curve
  await desk.page.keyboard.press("Escape");
  await desk.page.keyboard.press("Escape");
  const o = await ops(desk);
  assert.ok(o.includes("onEllipse"), `inferred: ${o.join(" ")}`);
  const l = (await entities(desk)).find((e) => e.kind === "line")!;
  await desk.type(`tan("${l.name}", "el1")`);
  await settled(desk, () => ops(desk), (x) => x.includes("tangent"), "tangent");
  // Tangent to the ellipse as it now is (nothing held its size or its turn):
  // in its own axes, the line's lowest value of the implicit form is zero.
  const el = (await entities(desk)).find((e) => e.kind === "ellipse")!;
  const [c, m] = await Promise.all([coords(desk, el.center!), coords(desk, el.major!)]);
  const { a, b } = await semiAxes(desk, "el1");
  const u = [m[0] - c[0], m[1] - c[1]].map((x) => x / a);
  const local = (w: number[]) => [(w[0] - c[0]) * u[0] + (w[1] - c[1]) * u[1], -(w[0] - c[0]) * u[1] + (w[1] - c[1]) * u[0]];
  const [p, q] = (await Promise.all(l.refs!.map((n) => coords(desk, n)))).map(local);
  const D = q.map((x, i) => x - p[i]);
  const A = (D[0] / a) ** 2 + (D[1] / b) ** 2, B = 2 * (p[0] * D[0] / (a * a) + p[1] * D[1] / (b * b));
  const t = -B / (2 * A);
  const low = ((p[0] + t * D[0]) / a) ** 2 + ((p[1] + t * D[1]) / b) ** 2 - 1;
  assert.ok(Math.abs(low) < 1e-5, `tangent: ${low}`);
  // And the end it was snapped onto is still on it.
  assert.ok(Math.abs((q[0] / a) ** 2 + (q[1] / b) ** 2 - 1) < 1e-6, "on it");
  await shot(desk, "desk-line-tangent-to-ellipse");
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

const tap = async (world: number[]) => { await f.tap(...await onCanvas(phone, world)); await phone.page.waitForTimeout(120); };

/** One finger from `from` to `to`, rested there before it lifts (onetool.e2e.ts's reason). */
async function fingerDrag(from: number[], to: number[]): Promise<void> {
  const a = await onCanvas(phone, from), b = await onCanvas(phone, to);
  await f.down(a);
  await f.glide(8, b);
  await phone.page.waitForTimeout(120);
  await f.move(b);
  await phone.page.waitForTimeout(120);
  await f.up();
  await phone.page.waitForTimeout(200);
}

test("iPhone 13: the polygon by a press and a slide onto it in the shapes flyout, then a finger dragged centre to corner", async () => {
  await freshPhone();
  const from = await middleOf('#toolbar button[data-group="shapes"]');
  await f.down(from);
  // Slide out of the button: the flyout opens under the finger; lift on the polygon.
  const out: [number, number] = [from[0] + 30, from[1]];
  await f.glide(4, out);
  await phone.page.waitForFunction(() => !(document.getElementById("flyout") as HTMLElement).hidden, null, { timeout: 3000 });
  const target = await middleOf('#flyout button[data-tool="polygon"]');
  await f.glide(6, target);
  await phone.page.waitForTimeout(120);
  await f.up();
  await settled(phone, () => phone.model(), (m) => m.activeTool === "polygon", "the slide armed the polygon");
  await phone.page.waitForTimeout(300);

  await fingerDrag([0, 0, 0], [0, 25, 0]);
  const m = await settled(phone, () => phone.model(), (x) => x.byKind.line === 6, "six sides");
  assert.equal(m.byKind.circle, 1);
  const { centre, corners } = await polygonOf(phone);
  const r = await regular(phone, centre, corners);
  assert.ok(spread(r.sides) < 1e-6 && spread(r.reach) < 1e-6 && Math.abs(r.reach[0] - 25) < 1.5, JSON.stringify(r));
  await shot(phone, "phone-polygon");
  await phone.type("cancel()");
  await savedRoundTrip(phone);
});

test("iPhone 13: the slot — a finger dragged centre to centre, then a tap for the width", async () => {
  await freshPhone();
  await phone.type('arm("slot")');
  await phone.page.evaluate(() => (document.activeElement as HTMLElement | null)?.blur());
  await fingerDrag([-15, -10, 0], [15, -10, 0]);
  assert.equal((await phone.model()).byKind.arc ?? 0, 0, "the width still to choose");
  await tap([0, -3, 0]);
  const m = await settled(phone, () => phone.model(), (x) => x.byKind.arc === 2, "the slot");
  const r = m.radii[m.arcs[0].name];
  assert.ok(Math.abs(r - 7) < 1, `the width from the tap: r ${r}`);
  await shot(phone, "phone-slot");
  await phone.type("cancel()");
});

test("iPhone 13: the ellipse — tapped from its button, a finger dragged out, a tap for the minor — and extruded", async () => {
  await freshPhone();
  // A tap on the curves button arms its current member, the ellipse (the spline after it).
  await f.tap(...await middleOf('#toolbar button[data-group="curves"]'));
  await settled(phone, () => phone.model(), (m) => m.activeTool === "ellipse", "the ellipse button armed it");
  await phone.page.waitForTimeout(300);
  await fingerDrag([0, 0, 0], [20, 0, 0]);
  await tap([5, 9, 0]);
  const es = await settled(phone, () => entities(phone), (x) => x.some((e) => e.kind === "ellipse"), "an ellipse");
  const e = es.find((x) => x.kind === "ellipse")!;
  const { a, b } = await semiAxes(phone, e.name);
  assert.ok(Math.abs(a - 20) < 1.5 && Math.abs(b - 9) < 1.5, `20 × 9 from the hand: ${a} × ${b}`);
  await phone.type("cancel()");
  await phone.type(`extrude("${e.name}", 8); orbit(0.5, 0.6)`);
  await settled(phone, () => phone.model(), (x) => x.journalOps.includes("extrude"), "extruded");
  await shot(phone, "phone-elliptic-cylinder");
});
