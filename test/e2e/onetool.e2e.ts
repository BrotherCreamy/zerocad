// One circle tool and one arc tool, the method read from the gesture
// (docs/plans/one-circle-one-arc.md). The owner: *"why are there multiple circle
// tools and arc tools? they all achieve the same thing. surely just one tool,
// but different ways to set constraints."*
//
// Each gesture is made by a real hand — a mouse on a desktop window, then
// fingers in iPhone 13 emulation — and checked three ways: the model (the circle
// or arc it built, against a closed form computed here), the relations it made
// (`rels`, as the user would read them), and the options panel (the method it
// says it read, while the gesture is under way). The unit suite has the rest
// (test/onetool.test.ts). Set NEOCAD_E2E_SHOTS to a directory to keep the
// pictures, and look at them.

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
  await app.page.waitForTimeout(120);
  await app.page.screenshot({ path: join(SHOTS, `onetool-${name}.png`) });
}

const PANEL = '.panel[data-panel="options"]';
/** What the method row says: the drop-down's shown words, whether lit as a reading, and its value. */
async function method(app: AppContext): Promise<{ label: string; lit: boolean; value: string } | null> {
  return app.page.evaluate((sel) => {
    const panel = document.querySelector<HTMLElement>(sel);
    const pick = panel?.querySelector<HTMLSelectElement>('select[data-option="method"]');
    if (!panel || panel.hidden || !pick) return null;
    return { label: pick.selectedOptions[0]?.textContent ?? "", lit: pick.classList.contains("oread"), value: pick.value };
  }, PANEL);
}

/** Every relation, as `[op, args]`, in the order made. */
const relations = (app: AppContext) => app.page.evaluate(() =>
  [...(window as unknown as { __neocad: { model: { relations: Map<string, { op: string; args: unknown[] }> } } }).__neocad.model.relations.values()]
    .map((r) => [r.op, r.args] as [string, unknown[]]));

/** The relations a drawing tool made beyond the two that hold a curve on the ground. */
const drawn = async (app: AppContext) => (await relations(app)).filter(([op]) => op !== "onPlane" && op !== "parallel");

async function fresh(app: AppContext): Promise<void> {
  // The remembered method is the viewer's, in this browser's storage: cleared,
  // so a lock one test made is not the next test's start.
  await app.page.evaluate(() => localStorage.clear());
  await forgetAutosave(app.page); // a reload here means the app's first start
  await app.page.reload({ waitUntil: "networkidle" });
  await app.page.waitForFunction(() => document.getElementById("status")?.textContent?.includes("ready"), null, { timeout: 20_000 });
}

/** A world point's place on the canvas, a fingertip clear of every panel. */
async function onCanvas(app: AppContext, world: number[]): Promise<[number, number]> {
  const [x, y] = await app.screenOf(world);
  for (const [dx, dy] of [[0, 0], [-12, 0], [12, 0], [0, -12], [0, 12]]) await app.at(x + dx, y + dy); // throws under a panel
  return [x, y];
}

/** The model once `want` holds of it, within a few seconds. */
async function settled(app: AppContext, want: (m: Awaited<ReturnType<AppContext["model"]>>) => boolean, what: string) {
  const deadline = Date.now() + 5000;
  for (;;) {
    const m = await app.model();
    if (want(m)) return m;
    if (Date.now() > deadline) assert.fail(`${what}: ${JSON.stringify({ byKind: m.byKind, activeTool: m.activeTool })}`);
    await app.page.waitForTimeout(50);
  }
}

/** The circle through three points (2D), worked out here so the app cannot mark its own work. */
function circumOf(a: number[], b: number[], c: number[]): { center: number[]; radius: number } {
  const bx = b[0] - a[0], by = b[1] - a[1], cx = c[0] - a[0], cy = c[1] - a[1];
  const d = 2 * (bx * cy - by * cx);
  const bb = bx * bx + by * by, cc = cx * cx + cy * cy;
  const ux = (cy * bb - by * cc) / d, uy = (bx * cc - cx * bb) / d;
  return { center: [a[0] + ux, a[1] + uy], radius: Math.hypot(ux, uy) };
}
const dist = (a: number[], b: number[]) => Math.hypot(...a.map((v, i) => v - b[i]));

/** Where each world point the test aims at actually landed: the points the tool placed, by name. */
const pointsOf = async (app: AppContext) => (await app.model()).points;

// ===== a mouse, on a desktop =========================================================

let desk: AppContext;
before(async () => { desk = await openApp(); });
after(async () => {
  assert.deepEqual(desk.pageErrors, [], "nothing the page threw went uncaught");
  await desk.close();
});

async function click(world: number[]): Promise<void> {
  const [sx, sy] = await onCanvas(desk, world);
  const at = await desk.at(sx, sy);
  await desk.page.mouse.move(at.x, at.y, { steps: 3 });
  await desk.page.mouse.click(at.x, at.y);
  await desk.page.waitForTimeout(120);
}

async function hover(world: number[]): Promise<void> {
  const [sx, sy] = await onCanvas(desk, world);
  const at = await desk.at(sx, sy);
  await desk.page.mouse.move(at.x, at.y, { steps: 4 });
  await desk.page.waitForTimeout(120);
}

/** A press at `from`, moved to `to` — and, unless `hold`, released there. */
async function drag(from: number[], to: number[], hold = false): Promise<void> {
  const a = await desk.at(...await onCanvas(desk, from));
  const b = await desk.at(...await onCanvas(desk, to));
  await desk.page.mouse.move(a.x, a.y, { steps: 3 });
  await desk.page.mouse.down();
  await desk.page.mouse.move(b.x, b.y, { steps: 8 });
  await desk.page.waitForTimeout(80);
  if (!hold) {
    await desk.page.mouse.up();
    await desk.page.waitForTimeout(120);
  }
}

async function pressButton(tool: string): Promise<void> {
  const b = await desk.page.$eval(`#toolbar button[data-tool="${tool}"]`, (el) => {
    const r = el.getBoundingClientRect();
    return { x: r.x + r.width / 2, y: r.y + r.height / 2 };
  });
  await desk.page.mouse.click(b.x, b.y);
  await desk.page.waitForTimeout(100);
}

test("desktop: one circle and one arc on the toolbar — thirteen buttons — and circle3, arc3 typed arm the one tool, locked", async () => {
  await fresh(desk);
  const tools = await desk.page.$$eval("#toolbar button", (bs) => bs.map((b) => (b as HTMLElement).dataset.tool));
  assert.equal(tools.length, 13, `Select, the Hand and eleven buttons of tools: ${tools.join(" ")}`);
  assert.equal(tools.filter((t) => t === "circle").length, 1);
  assert.equal(tools.filter((t) => t === "arc").length, 1);
  assert.ok(!tools.includes("circle3") && !tools.includes("arc3"), "no 3-point buttons");
  await desk.type("circle3");
  assert.match(await desk.log(), /armed: circle3 — the circle tool, locked to 3 points, arm\("circle", \{method: "3pt"\}\)/);
  assert.equal((await desk.model()).activeTool, "circle");
  assert.deepEqual(await method(desk), { label: "3 points", lit: false, value: "3pt" }, "the panel shows the lock");
  const lit = await desk.page.$$eval("#toolbar button[aria-pressed=true]", (els) => els.map((el) => (el as HTMLElement).dataset.tool));
  assert.deepEqual(lit, ["circle"], "the circle button is the one lit");
  await desk.type('arm("arc3")');
  assert.equal((await desk.model()).activeTool, "arc");
  assert.equal((await method(desk))?.value, "3pt");
  await shot(desk, "desk-arc3-typed");
  // Back to reading the gesture, for the tests that follow.
  await desk.type('arm("arc", { method: "auto" })');
  await desk.type('arm("circle", { method: "auto" })');
  await desk.page.keyboard.press("Escape");
});

test("desktop: the circle, pressed and dragged — a centre and a radius; the panel reads centre · radius while the drag is under way", async () => {
  await fresh(desk);
  await pressButton("circle");
  assert.deepEqual(await method(desk), { label: "auto", lit: false, value: "auto" }, "nothing read before a press");
  await drag([0, 0], [16, 12], true);
  assert.deepEqual(await method(desk), { label: "centre · radius", lit: true, value: "auto" });
  await shot(desk, "desk-circle-drag");
  await desk.page.mouse.up();
  const m = await settled(desk, (m) => m.byKind.circle === 1, "the drag drew a circle");
  const c = m.circles[0];
  assert.ok(dist(m.points[c.center], [0, 0, 0]) < 0.5, `centred on the press: ${m.points[c.center]}`);
  assert.ok(Math.abs(m.radii[c.name] - 20) < 0.5, `radius to the release: ${m.radii[c.name]}`);
  assert.deepEqual(await drawn(desk), [], "and nothing on its rim: the radius is free");
  assert.equal(m.byKind.point, 1);
});

test("desktop: the circle, three clicks — through all three; the panel reads 3 points from the second", async () => {
  await fresh(desk);
  await pressButton("circle");
  await click([-20, 0]);
  assert.equal((await method(desk))?.label, "auto", "one click is a centre or a rim point, not said yet");
  await click([10, 15]);
  assert.deepEqual(await method(desk), { label: "3 points", lit: true, value: "auto" });
  await hover([5, -20]);
  await shot(desk, "desk-circle-3pt");
  await click([5, -20]);
  const m = await settled(desk, (m) => m.byKind.circle === 1, "three clicks drew a circle");
  const c = m.circles[0];
  const rim = Object.entries(m.points).filter(([n]) => n !== c.center).map(([, p]) => p);
  assert.equal(rim.length, 3, "three rim points");
  const want = circumOf(rim[0], rim[1], rim[2]);
  assert.ok(dist(m.points[c.center].slice(0, 2), want.center) < 1e-6 && Math.abs(m.radii[c.name] - want.radius) < 1e-6,
    `the circumcircle of the three it placed: ${m.points[c.center]} r ${m.radii[c.name]}`);
  assert.deepEqual((await drawn(desk)).map(([op]) => op), ["onCircle", "onCircle", "onCircle"]);
  assert.equal(await desk.status(), "SOLVED");
  await shot(desk, "desk-circle-3pt-done");
});

test("desktop: a rim click on a line makes the circle tangent to it — the panel reads tangent, rels lists tan, and it touches", async () => {
  await fresh(desk);
  await desk.type("ln(pt(-40, -20, 0), pt(40, -20, 0))");
  await pressButton("circle");
  await click([12, -20]); // along l1, away from its middle and its ends
  await click([-10, 10]);
  assert.deepEqual(await method(desk), { label: "tangent", lit: true, value: "auto" });
  await hover([20, 10]);
  await shot(desk, "desk-circle-tangent-preview");
  await click([20, 10]);
  const m = await settled(desk, (m) => m.byKind.circle === 1, "the circle was drawn");
  const c = m.circles[0].name;
  const rels = await drawn(desk);
  assert.deepEqual(rels.filter(([op]) => op === "tangent").map(([, a]) => a), [["l1", c]], `tan(l1, ${c}): ${JSON.stringify(rels)}`);
  assert.equal(rels.filter(([op]) => op === "onCircle").length, 2, "the other two clicks are rim points");
  assert.ok(!rels.some(([op]) => op === "pointOnLine"), "and no point was left on the line");
  assert.equal(await desk.status(), "SOLVED");
  const ctr = m.points[m.circles[0].center];
  assert.ok(Math.abs((ctr[1] + 20) - m.radii[c]) < 1e-6, `touching y = −20: centre ${ctr}, r ${m.radii[c]}`);
  await shot(desk, "desk-circle-tangent");
  // One gesture, one undo step: the circle, its rim points and the tangency together.
  await desk.page.keyboard.press("Control+z");
  await settled(desk, (m) => !m.byKind.circle && m.byKind.line === 1, "one undo took it all");
});

test("desktop: locked in the panel to 3 points, a drag is a click; the lock is typed, remembered, and shows", async () => {
  await fresh(desk);
  await pressButton("circle");
  await desk.page.selectOption(`${PANEL} select[data-option="method"]`, "3pt");
  await desk.page.waitForTimeout(150);
  assert.match(await desk.log(), /> arm\("circle", \{method: "3pt"\}\)/, "the panel typed the lock");
  assert.deepEqual(await method(desk), { label: "3 points", lit: false, value: "3pt" });
  await drag([0, 0], [16, 12]);
  let m = await desk.model();
  assert.equal(m.byKind.circle, undefined, "a drag drew no centre-and-radius circle: locked, a press is a rim point");
  await click([20, -10]);
  await click([-15, 5]);
  m = await settled(desk, (m) => m.byKind.circle === 1, "the third press made the circle");
  assert.equal((await drawn(desk)).filter(([op]) => op === "onCircle").length, 3);
  // Remembered like any option: across a reload, armed from its button.
  await forgetAutosave(desk.page);
  await desk.page.reload({ waitUntil: "networkidle" });
  await desk.page.waitForFunction(() => document.getElementById("status")?.textContent?.includes("ready"), null, { timeout: 20_000 });
  await pressButton("circle");
  assert.equal((await method(desk))?.value, "3pt", "the lock outlives the reload");
  await shot(desk, "desk-circle-locked");
  await desk.page.selectOption(`${PANEL} select[data-option="method"]`, "auto");
  await desk.page.waitForTimeout(150);
  assert.match(await desk.log(), /> arm\("circle", \{method: "auto"\}\)/);
  await desk.page.keyboard.press("Escape");
});

test("desktop: the arc, dragged end to end then its bulge clicked — through all three; the panel reads 3 points", async () => {
  await fresh(desk);
  await pressButton("arc");
  await drag([-20, 0], [20, 0]);
  assert.deepEqual(await method(desk), { label: "3 points", lit: true, value: "auto" });
  await hover([0, 12]);
  await shot(desk, "desk-arc-3pt-preview");
  await click([0, 12]);
  const m = await settled(desk, (m) => m.byKind.arc === 1, "the arc was drawn");
  const a = m.arcs[0];
  const [s, e] = [m.points[a.start], m.points[a.end]];
  const want = circumOf(s, e, [0, 12]);
  assert.ok(dist(m.points[a.center].slice(0, 2), want.center) < 0.5 && Math.abs(m.radii[a.name] - want.radius) < 0.5,
    `the circle through both ends and the bulge: ${m.points[a.center]} r ${m.radii[a.name]}`);
  assert.equal(m.byKind.point, 3, "two ends and the arc's own centre: the bulge is kept as nothing");
  assert.equal(await desk.status(), "SOLVED");
  await shot(desk, "desk-arc-3pt");
});

test("desktop: the arc, a click first — the centre — then start and end; the panel reads centre · ends", async () => {
  await fresh(desk);
  await pressButton("arc");
  await click([0, 0]);
  assert.deepEqual(await method(desk), { label: "centre · ends", lit: true, value: "auto" });
  await click([20, 0]);
  await hover([0, 20]);
  await shot(desk, "desk-arc-centre-preview");
  await click([0, 20]);
  const m = await settled(desk, (m) => m.byKind.arc === 1, "the arc was drawn");
  const a = m.arcs[0];
  assert.ok(dist(m.points[a.center], [0, 0, 0]) < 0.5, `about the first click: ${m.points[a.center]}`);
  assert.ok(Math.abs(dist(m.points[a.start], m.points[a.center]) - m.radii[a.name]) < 1e-6);
  assert.ok(Math.abs(dist(m.points[a.end], m.points[a.center]) - m.radii[a.name]) < 1e-6);
  assert.deepEqual((await drawn(desk)).map(([op]) => op), ["arcEndpoints"]);
  await shot(desk, "desk-arc-centre");
});

test("desktop: the arc dragged from a line's end and bulged the smooth way is snapped tangent — tan(l1, a1), and it leaves the line smoothly", async () => {
  await fresh(desk);
  await desk.type("ln(pt(-40, -20, 0), pt(0, -20, 0))");
  await pressButton("arc");
  // From l1's end at (0, −20), heading +x, to (20, 0): the smooth arc is centred
  // straight above the end, at (0, 0), radius 20 — and its middle is at 45°.
  await drag([0, -20], [20, 0]);
  const bulge = [20 * Math.SQRT1_2 + 0.3, -20 * Math.SQRT1_2 - 0.2, 0];
  await hover(bulge);
  assert.deepEqual(await method(desk), { label: "tangent", lit: true, value: "auto" });
  await shot(desk, "desk-arc-tangent-preview");
  await click(bulge);
  const m = await settled(desk, (m) => m.byKind.arc === 1, "the arc was drawn");
  const a = m.arcs[0];
  const rels = await drawn(desk);
  assert.ok(rels.some(([op, args]) => op === "tangent" && JSON.stringify(args) === JSON.stringify(["l1", a.name])), JSON.stringify(rels));
  assert.equal(await desk.status(), "SOLVED");
  const c = m.points[a.center];
  assert.ok(Math.abs(c[0]) < 1e-3 && Math.abs(m.radii[a.name] - (c[1] + 20)) < 1e-6, `centred above the line's end and touching it: ${c}, r ${m.radii[a.name]}`);
  await shot(desk, "desk-arc-tangent");
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

/** A selector's middle, in canvas pixels. */
const middleOf = (selector: string) => phone.page.$eval(selector, (el) => {
  const r = el.getBoundingClientRect();
  const c = document.getElementById("cv")!.getBoundingClientRect();
  return [r.x + r.width / 2 - c.x, r.y + r.height / 2 - c.y] as [number, number];
});

const tap = async (world: number[]) => { await f.tap(...await onCanvas(phone, world)); await phone.page.waitForTimeout(80); };

/**
 * One finger from `from` to `to`, rested there before it lifts — as a hand
 * placing a point does. Lifted mid-glide the drag is a fling to Chromium, and a
 * tap within ~150 ms of a fling is swallowed as the tap that stopped it
 * (touch.e2e.ts measured it); the tool's next tap would be lost.
 */
async function fingerDrag(from: number[], to: number[], look?: () => Promise<void>): Promise<void> {
  const a = await onCanvas(phone, from), b = await onCanvas(phone, to);
  await f.down(a);
  await f.glide(8, b);
  await phone.page.waitForTimeout(120);
  await f.move(b);
  await phone.page.waitForTimeout(120);
  await look?.();
  await f.up();
  await phone.page.waitForTimeout(150);
}

async function tapButton(tool: string): Promise<void> {
  await f.tap(...await middleOf(`#toolbar button[data-tool="${tool}"]`));
  await settled(phone, (m) => m.activeTool === tool, `the ${tool} button armed it`);
}

test("iPhone 13: one circle and one arc on the toolbar; a finger's drag is a centre and a radius, the panel saying so", async () => {
  await freshPhone();
  const tools = await phone.page.$$eval("#toolbar button", (bs) => bs.map((b) => (b as HTMLElement).dataset.tool));
  assert.equal(tools.length, 13, tools.join(" "));
  await shot(phone, "phone-toolbar");
  await tapButton("circle");
  await fingerDrag([0, 0], [12, 9], async () => {
    assert.deepEqual(await method(phone), { label: "centre · radius", lit: true, value: "auto" });
    await shot(phone, "phone-circle-drag");
  });
  const m = await settled(phone, (m) => m.byKind.circle === 1, "the finger drew a circle");
  const c = m.circles[0];
  assert.ok(dist(m.points[c.center], [0, 0, 0]) < 1, `centred where the finger landed: ${m.points[c.center]}`);
  assert.ok(Math.abs(m.radii[c.name] - 15) < 1, `out to where it lifted: ${m.radii[c.name]}`);
  assert.deepEqual(await drawn(phone), []);
});

test("iPhone 13: three taps are a circle through all three; the panel reads 3 points from the second", async () => {
  await freshPhone();
  await tapButton("circle");
  await tap([-15, 0]);
  await tap([10, 12]);
  assert.deepEqual(await method(phone), { label: "3 points", lit: true, value: "auto" });
  await shot(phone, "phone-circle-3pt");
  await tap([5, -15]);
  const m = await settled(phone, (m) => m.byKind.circle === 1, "three taps drew a circle");
  const c = m.circles[0];
  const rim = Object.entries(m.points).filter(([n]) => n !== c.center).map(([, p]) => p);
  const want = circumOf(rim[0], rim[1], rim[2]);
  assert.ok(dist(m.points[c.center].slice(0, 2), want.center) < 1e-6 && Math.abs(m.radii[c.name] - want.radius) < 1e-6);
  assert.deepEqual((await drawn(phone)).map(([op]) => op), ["onCircle", "onCircle", "onCircle"]);
  await shot(phone, "phone-circle-3pt-done");
});

test("iPhone 13: a tap on a line as a rim point is a tangency", async () => {
  await freshPhone();
  await phone.type("ln(pt(-30, -15, 0), pt(30, -15, 0))");
  await phone.page.evaluate(() => (document.activeElement as HTMLElement | null)?.blur());
  await tapButton("circle");
  await tap([9, -15]);
  await tap([-8, 8]);
  assert.equal((await method(phone))?.label, "tangent");
  await tap([15, 8]);
  const m = await settled(phone, (m) => m.byKind.circle === 1, "the circle was drawn");
  const c = m.circles[0].name;
  assert.deepEqual((await drawn(phone)).filter(([op]) => op === "tangent").map(([, a]) => a), [["l1", c]]);
  const ctr = m.points[m.circles[0].center];
  assert.ok(Math.abs((ctr[1] + 15) - m.radii[c]) < 1e-6, `touching the line: ${ctr}, r ${m.radii[c]}`);
  await shot(phone, "phone-circle-tangent");
});

test("iPhone 13: the arc — a finger dragged end to end, then a tap for the bulge; or three taps about a centre", async () => {
  await freshPhone();
  await tapButton("arc");
  await fingerDrag([-15, 0], [15, 0]);
  assert.deepEqual(await method(phone), { label: "3 points", lit: true, value: "auto" });
  await tap([0, 9]);
  let m = await settled(phone, (m) => m.byKind.arc === 1, "the dragged arc was drawn");
  assert.equal(m.byKind.point, 3, "two ends and a centre");
  await shot(phone, "phone-arc-3pt");

  await freshPhone();
  await tapButton("arc");
  await tap([0, -20]);
  assert.equal((await method(phone))?.label, "centre · ends");
  await tap([12, -20]);
  await tap([0, -8]);
  m = await settled(phone, (m) => m.byKind.arc === 1, "the centre-point arc was drawn");
  const a = m.arcs.find((x) => dist(m.points[x.center], [0, -20, 0]) < 1);
  assert.ok(a, `one arc about the first tap: ${JSON.stringify(m.arcs.map((x) => m.points[x.center]))}`);
  await shot(phone, "phone-arc-centre");
});
