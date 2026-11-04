// A circle is just a circle (docs/plans/frameless-curves.md), in a browser.
// The owner: "why everything need frame? why can not just put circle right
// there?" — so on a fresh document, the circle tool makes one circle and no
// frame, on the origin's ground; on a solid's lid it lands on the lid; a
// frameless rectangle extrudes without a frame being made; sketch on face sets
// the work plane and what is drawn next lies on it; and the origin is there
// from the start, drawn in RGB.
//
// What only the assembled app can say: which plane a click lands on (the face
// under the cursor is a picture's question), that the hold is two ordinary
// relations you can see and delete, and what a fresh document looks like.
// Set NEOCAD_E2E_SHOTS to a directory to keep the screenshots; look at them.

import { test, before, after } from "node:test";
import assert from "node:assert/strict";
import { mkdirSync } from "node:fs";
import { join } from "node:path";
import { openApp, forgetAutosave, type AppContext, confirmAndRelease } from "./harness.ts";
import { HELPERS, look } from "./scenes.ts";

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
  await app.page.waitForTimeout(150);
  await app.page.screenshot({ path: join(SHOTS, `frameless-${name}.png`) });
}

/** A fresh first start: no layout, no autosave — a new document. */
async function fresh(): Promise<void> {
  await app.page.evaluate(() => localStorage.clear());
  await forgetAutosave(app.page); // a reload here means the app's first start
  await app.page.reload({ waitUntil: "networkidle" });
  await app.page.waitForFunction(() => document.getElementById("status")?.textContent?.includes("ready"), null, { timeout: 20_000 });
}

const value = async (src: string): Promise<unknown> => {
  const r = await app.repl(src);
  assert.equal(r.ok, true, `${src} → ${r.error}`);
  return r.value;
};

async function drag(a: [number, number], b: [number, number]): Promise<void> {
  const p = await app.at(...a), q = await app.at(...b);
  await app.page.mouse.move(p.x, p.y, { steps: 3 });
  await app.page.waitForTimeout(80);
  await app.page.mouse.down();
  await app.page.mouse.move(q.x, q.y, { steps: 8 });
  await app.page.mouse.up();
  await app.page.waitForTimeout(250);
}

const near = (a: number[], b: number[], tol: number) => Math.hypot(...a.map((x, i) => x - b[i])) <= tol;
const parallelTo = (a: number[], b: number[]) =>
  Math.abs(Math.abs(a.reduce((s, x, i) => s + x * b[i], 0)) - Math.hypot(...a) * Math.hypot(...b)) < 1e-6;

/** The relations on `name`, as `[op, args]`. */
const relationsOn = async (name: string) => (await value(
  `[...model.relations.values()].filter((r) => r.args.includes(${JSON.stringify(name)})).map((r) => [r.op, r.args, r.name])`,
)) as [string, unknown[], string][];

// --- the origin's arms, as tooltips.e2e.ts reads a frame's -------------------

const markerOf = (name: string) => app.page.evaluate(async (n) => {
  const path = "/src/framemarker.ts";
  const { frameMarker } = await import(path);
  const hook = (window as never as { __neocad: { model: unknown; engine: { view: unknown } } }).__neocad;
  return frameMarker(hook.model, hook.engine.view, n) as { origin: number[]; x: number[]; y: number[]; z?: number[] };
}, name);
const inks = () => app.page.evaluate(async () => {
  const path = "/src/framemarker.ts";
  return (await import(path)).AXIS_INKS as Record<string, string>;
});
const rgb = (css: string) => [1, 3, 5].map((i) => parseInt(css.slice(i, i + 2), 16));
const far = (a: number[], b: number[]) => Math.max(...[0, 1, 2].map((i) => Math.abs(a[i] - b[i])));

/** Whether most of five samples along an arm are its ink exactly (tooltips.e2e.ts's `armIn`). */
async function armIn(origin: number[], tip: number[], css: string): Promise<{ ok: boolean; got: number[][] }> {
  const got: number[][] = [];
  for (const t of [0.3, 0.45, 0.6, 0.75, 0.88]) {
    const [cx, cy] = [origin[0] + (tip[0] - origin[0]) * t, origin[1] + (tip[1] - origin[1]) * t];
    const at: [number, number][] = [];
    for (let dy = -2; dy <= 2; dy++) for (let dx = -2; dx <= 2; dx++) at.push([Math.floor(cx + dx) + 0.5, Math.floor(cy + dy) + 0.5]);
    got.push((await app.pixels("drawing", at)).reduce((best, p) => (p[3] > best[3] ? p : best), [0, 0, 0, 0]));
  }
  return { ok: got.filter((p) => p[3] > 150 && far(p, rgb(css)) <= 2).length >= 3, got };
}

test("a fresh document: nothing in it, and the origin drawn in RGB from the start — x red, y green, z blue when turned", async () => {
  await fresh();
  const m = await app.model();
  assert.equal(m.size, 0, "no entity: the origin is built in, not made");
  assert.deepEqual(m.journalOps, [], "and not journalled");
  assert.equal(await value('model.isFrame("origin")'), true);
  const ink = await inks();
  let marker = await markerOf("origin");
  for (const axis of ["x", "y"] as const) {
    const { ok, got } = await armIn(marker.origin, marker[axis], ink[axis]);
    assert.ok(ok, `the origin's ${axis} arm in ${ink[axis]} at start: ${JSON.stringify(got)}`);
  }
  await shot("fresh");
  await app.type("orbit(0.3, 0.8)");
  marker = await markerOf("origin");
  assert.ok(marker.z, "turned, its z arm is on screen");
  for (const axis of ["x", "y", "z"] as const) {
    const { ok, got } = await armIn(marker.origin, marker[axis]!, ink[axis]);
    assert.ok(ok, `turned, the ${axis} arm in ${ink[axis]}: ${JSON.stringify(got)}`);
  }
  await shot("fresh-turned");
  // Never deleted, by name or by its menu.
  const r = await app.repl('del("origin")');
  assert.equal(r.ok, false, "del refuses it");
  assert.equal(await value('model.isFrame("origin")'), true);
});

let circle = "";

test("a circle drawn on a fresh document is one circle and no frame, on the origin's ground, held by onplane and par", async () => {
  await fresh();
  await app.type("orbit(0.3, 0.8)");
  await app.type("circle");
  await drag([500, 380], [580, 380]);
  await app.type("cancel()");
  const m = await app.model();
  assert.deepEqual(m.byKind, { point: 1, circle: 1 }, `one circle and its centre, no frame: ${JSON.stringify(m.byKind)}`);
  circle = m.circles[0].name;
  const centre = m.circles[0].center;
  assert.ok(Math.abs(m.points[centre][2]) < 1e-9, `the centre is on the ground: ${m.points[centre]}`);
  const normal = (await value(`model.normalOf("${circle}")`)) as number[];
  assert.ok(parallelTo(normal, [0, 0, 1]), `facing the ground's normal: ${normal}`);
  // The hold is two ordinary relations, the same kinds a user writes.
  assert.deepEqual((await relationsOn(centre)).map(([op, args]) => [op, args]), [["onPlane", [centre, "origin"]]]);
  const pars = (await relationsOn(circle)).filter(([op]) => op === "parallel");
  assert.deepEqual(pars.map(([, args]) => args), [[circle, "origin.z"]]);
  assert.equal(await app.status(), "SOLVED");
  await shot("ground");

  // Delete the par, and the circle is free to turn: stand it square to a line
  // leaning 45° out of the ground and it follows — its centre still on the
  // ground. (Not to an axis at right angles to where it faces: a wedge is at
  // its maximum there, with no gradient to start the turn — `par` of two lines
  // at exactly 90° is the same.)
  await app.type(`del("${pars[0][2]}")`);
  // The line fixed — in the origin's coordinates, with no frame of our own —
  // so it is the circle that turns, not the line.
  await app.type(`la = pt(-40, 0, 0); lb = pt(-30, 0, 10); fix(la, [-40, 0, 0]); fix(lb, [-30, 0, 10]); lean = ln(la, lb)`);
  await app.type(`par("${circle}", lean)`);
  assert.equal(await app.status(), "SOLVED");
  const turned = (await value(`model.normalOf("${circle}")`)) as number[];
  assert.ok(parallelTo(turned, [1, 0, 1]), `turned to face along the line: ${turned}`);
  const at = (await app.model()).points[centre];
  assert.ok(Math.abs(at[2]) < 1e-9, "its centre still held on the ground");
  assert.equal((await app.model()).byKind.frame, undefined, "and still no frame");
  await shot("ground-turned");
});

test("drawn over a solid's lid, a circle lands on the lid — not the ground under it — and still no frame is made", async () => {
  await fresh();
  for (const src of [HELPERS, `ls = poly([[0,0,0],[40,0,0],[40,30,0],[0,30,0]], "origin"); extrude(ls[0], 20)`, "solve(); refresh(); 'built'"]) {
    const r = await app.repl(src);
    assert.equal(r.ok, true, `${src} → ${r.error}`);
  }
  assert.equal((await app.model()).byKind.frame, undefined, "the box itself made none");
  await look(app, 0.5, 0.7);
  const [cx, cy] = await app.screenOf([20, 15, 20]); // the lid's centre
  const [rx, ry] = await app.screenOf([28, 15, 20]);
  await app.type("circle");
  await drag([cx, cy], [rx, ry]);
  await app.type("cancel()");
  const m = await app.model();
  assert.equal(m.byKind.circle, 1);
  assert.equal(m.byKind.frame, undefined, "no frame for it");
  const c = m.circles[0];
  const centre = m.points[c.center];
  assert.ok(near(centre, [20, 15, 20], 0.6), `on the lid where it was clicked: ${centre}`);
  assert.ok(parallelTo((await value(`model.normalOf("${c.name}")`)) as number[], [0, 0, 1]), "facing up, as the lid does");
  // Held on the lid's own points — the plane follows the solid.
  const on = (await relationsOn(c.center)).find(([op]) => op === "onPlane");
  assert.ok(on && /^p\d+\.p\d+\.p\d+$/.test(String(on[1][1])), `held on three of the lid's points: ${JSON.stringify(on)}`);
  await value('set(model.featureOf("e1", "extrude").depth + ".value", 35); solve(); refresh(); "ok"');
  const grown = (await app.model()).points[c.center];
  assert.ok(Math.abs(grown[2] - 35) < 1e-6, `the box grew and the circle rode up with the lid: ${grown}`);
  await value('set(model.featureOf("e1", "extrude").depth + ".value", 20); solve(); refresh(); "ok"');
  await shot("face");
});

test("a frameless rectangle extrudes along the ground's normal with the tool, and no frame is made", async () => {
  await fresh();
  await app.type("rectangle");
  await drag([420, 260], [600, 400]);
  await app.type("cancel()");
  assert.equal((await app.model()).byKind.frame, undefined);
  await app.type("extrude");
  const at = await app.at(510, 330);
  await app.page.mouse.click(at.x, at.y);
  await app.page.waitForTimeout(250);
  await confirmAndRelease(app);
  const m = await app.model();
  assert.equal(m.byKind.frame, undefined, `no frame: ${JSON.stringify(m.byKind)}`);
  assert.equal(await value("model.features.size"), 1);
  assert.equal(await value('model.featureOf("e1", "extrude").frame'), "origin", "along the origin's +z");
  assert.ok(!(await app.log()).includes("plane("), "no plane() typed");
  assert.equal(await app.status(), "SOLVED");
});

test("sketch on face, then draw: the work plane is the face, and the circle lies on it wherever it is clicked", async () => {
  await fresh();
  for (const src of [HELPERS, `ls = poly([[0,0,0],[40,0,0],[40,30,0],[0,30,0]], "origin"); extrude(ls[0], 20)`, "solve(); refresh(); 'built'"]) {
    assert.equal((await app.repl(src)).ok, true, src);
  }
  await look(app, 0.5, 0.7);
  const [cx, cy] = await app.screenOf([20, 15, 20]);
  await app.type('arm("sketch")');
  const at = await app.at(cx, cy);
  await app.page.mouse.click(at.x, at.y);
  await app.page.waitForTimeout(400);
  const plane = (await value("model.workPlane")) as string;
  assert.match(plane, /^p\d+\.p\d+\.p\d+$/, "the work plane is three of the lid's points");
  assert.match(await app.log(), /> workplane\("p\d+\.p\d+\.p\d+"\)/, "typed, as every tool's command is");
  assert.equal((await app.model()).byKind.frame, undefined, "and nothing was made");
  // Looked at square-on: draw a circle off the lid's outline, and it is on
  // the lid's plane all the same — the work plane is a plane, not a face.
  const [ox, oy] = await app.screenOf([60, 15, 20]);
  const [rx, ry] = await app.screenOf([66, 15, 20]);
  await app.type("circle");
  await drag([ox, oy], [rx, ry]);
  await app.type("cancel()");
  const m = await app.model();
  const c = m.circles[0];
  assert.ok(Math.abs(m.points[c.center][2] - 20) < 1e-6, `on the lid's plane: ${m.points[c.center]}`);
  assert.equal(m.byKind.frame, undefined);
  const pars = (await relationsOn(c.name)).filter(([op]) => op === "parallel");
  assert.deepEqual(pars.map(([, args]) => args), [[c.name, plane]], "its normal held to the work plane's");
  await shot("workplane");
  // Undo the circle and the sketch: one step each, and the work plane goes.
  await app.type("workplane(null)");
  assert.equal(await value("model.workPlane"), null);
});
