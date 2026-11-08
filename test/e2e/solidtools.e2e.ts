// The solid tools a first-time user can use (docs/plans/solid-tools-intuitive.md;
// the owner: "Flip button." and "I'm still not clear on how to use the extrude
// cut tool. It doesn't make sense to me. Make it more intuitive, along with the
// other solid tools."), by mouse: an extrude flipped with the panel's ⇅ — the
// preview and the result the other way; a circle on the lid cut with the Cut
// tool and ✓ — a hole, no minus sign typed; Through all on a stepped body; the
// depth handle dragged; a revolve about the origin's own axis, flipped. The
// iPhone's, by finger, is solidtoolsphone.e2e.ts. Set NEOCAD_E2E_SHOTS to keep
// the pictures; look at them.

import { test, before, after } from "node:test";
import assert from "node:assert/strict";
import { existsSync, mkdirSync } from "node:fs";
import { join } from "node:path";
import { openApp, type AppContext } from "./harness.ts";

const built = existsSync(new URL("../../src/solids/smlib-gen/smlib.mjs", import.meta.url));
const skip = built ? false : "no SMLib build — run `npm run build:solids`";

let app: AppContext;
before(async () => { if (built) app = await openApp(); });
after(async () => { if (built) await app.close(); });

const SHOTS = process.env.NEOCAD_E2E_SHOTS;
async function shot(name: string): Promise<void> {
  if (!SHOTS) return;
  mkdirSync(SHOTS, { recursive: true });
  await app.page.mouse.move(1095, 300); // off the drawing, and off the logo (whose tooltip would cover the panel)
  await app.page.waitForTimeout(300);
  await app.page.screenshot({ path: join(SHOTS, `solidtools-desktop-${name}.png`) });
}

async function leftDrag(a: [number, number], b: [number, number], steps = 8): Promise<void> {
  const p = await app.at(...a), q = await app.at(...b);
  await app.page.mouse.move(p.x, p.y);
  await app.page.mouse.down();
  await app.page.mouse.move(q.x, q.y, { steps });
  await app.page.mouse.up();
  await app.page.waitForTimeout(250);
}

async function clickWorld(w: number[]): Promise<void> {
  const [sx, sy] = await app.screenOf(w);
  const at = await app.at(sx, sy);
  await app.page.mouse.click(at.x, at.y);
  await app.page.waitForTimeout(300);
}

async function press(selector: string): Promise<void> {
  await app.page.click(selector);
  await app.page.waitForTimeout(300);
}

type Neo = { __neocad: {
  bodies: { settled: boolean; views(): { features: string[]; result: { solid: { volume: number; validity: { manifold: boolean; failures: number }; faces: { name: string }[] } } }[] };
  model: { journal: { op: string; args: unknown[] }[]; features: Map<string, { kind: string; mode?: string; extent?: string; depth: string; angle: string }>;
    relations: Map<string, { args: unknown[] }> };
  engine: { active: { name: string; handle: { from: number[]; label: number[]; dir: number[] } | null } | null };
} };

async function bodies() {
  await app.page.waitForFunction(() => (window as never as Neo).__neocad.bodies.settled, undefined, { timeout: 20_000 });
  return app.page.evaluate(() => (window as never as Neo).__neocad.bodies.views().map((v) => ({
    features: v.features, volume: v.result.solid.volume,
    valid: v.result.solid.validity.manifold && v.result.solid.validity.failures === 0,
    faces: [...new Set(v.result.solid.faces.map((f) => f.name))].sort(),
  })));
}

/** The last line a confirm typed into the journal, as the log shows it. */
const lastExtrude = () => app.page.evaluate(() => {
  const j = (window as never as Neo).__neocad.model.journal.filter((e) => e.op === "extrude");
  return j.length ? j[j.length - 1].args : null;
});

/** A feature's dimension value: an extrude's depth, a revolve's angle. */
const valueOf = (feature: string) => app.page.evaluate((f) => {
  const m = (window as never as Neo).__neocad.model;
  const e = m.features.get(f)!;
  return m.relations.get(e.kind === "extrude" ? e.depth : e.angle)!.args[1] as number;
}, feature);

/** The depth handle as the armed tool last drew it, or null. */
const handle = () => app.page.waitForFunction(() => (window as never as Neo).__neocad.engine.active?.handle ?? null, undefined, { timeout: 30_000 })
  .then((h) => h.jsonValue() as Promise<{ from: number[]; label: number[]; dir: number[] }>);

const W = 30, H = 18, T = 10;

test("an extrude flipped with ⇅: the handle turns round, the preview and the solid go below the sketch", { skip }, async () => {
  await app.type("arm(\"rectangle\")");
  await leftDrag(await app.screenOf([-W, -H, 0]), await app.screenOf([W, H, 0]));
  await app.type("orbit(-0.6, -1.0)");
  await app.type('arm("extrude")');
  await clickWorld([0, 0, 0]);
  const up = await handle();
  await shot("1-extrude-preview");
  // The ⇅ beside the depth, with its tooltip's name.
  assert.equal(await app.page.$eval("#options button.oflip", (b) => b.getAttribute("aria-label")), "Flip direction");
  await press("#options button.oflip");
  assert.equal(await app.page.$eval('#options input.oval[data-option="depth"]', (f) => (f as HTMLInputElement).value), "-10");
  assert.match(await app.log(), /arm\("extrude", \{depth: -10\}\)/);
  await app.page.waitForFunction((before) => {
    const h = (window as never as Neo).__neocad.engine.active?.handle;
    return !!h && h.dir[1] * before < 0;
  }, up.dir[1], { timeout: 30_000 });
  await shot("2-extrude-flipped-preview");
  await press("#options .oact button.ok");
  const args = await lastExtrude();
  assert.equal(args?.[1], -10, `the negated call: ${JSON.stringify(args)}`);
  // Built below the sketch: a lid corner ten under the ground (a body of one
  // feature is drawn live, not by the kernel, so it is the model that says).
  const lid = await app.page.evaluate(() => {
    const m = (window as never as { __neocad: { model: { featureOf(n: string): { twins: string[][] }; entities: Map<string, { refs: string[] }>; coords(p: string): number[] } } }).__neocad.model;
    const twin = m.entities.get(m.featureOf("e1").twins[0][0])!;
    return m.coords(twin.refs[0]);
  });
  assert.ok(Math.abs(lid[2] + T) < 1e-6, `the lid at z = -10: ${lid}`);
  await shot("3-extrude-flipped-built");
  // Flip it back for the rest: the menu's Flip direction would do it too; set is what it types.
  await app.type(`set("${await app.page.evaluate(() => (window as never as Neo).__neocad.model.features.get("e1")!.depth)}.value", 10)`);
  assert.equal(await valueOf("e1"), 10);
});

test("a circle on the lid, the Cut tool, ✓: a hole down through the plate — no minus sign typed", { skip }, async () => {
  await app.type('arm("sketch")');
  await clickWorld([W - 5, H - 5, T]);
  await app.type("arm(\"circle\")");
  await leftDrag(await app.screenOf([-12, 0, T]), await app.screenOf([-7, 0, T]));
  await app.type("orbit(-0.6, -1.0)");
  // Cut is on the extrude's button: its flyout, then Cut.
  await app.page.hover('#toolbar button[data-group="sweep"]');
  await app.page.mouse.down();
  await app.page.waitForSelector('#flyout button[data-tool="cut"]', { state: "visible", timeout: 5000 });
  await app.page.mouse.up();
  await press('#flyout button[data-tool="cut"]');
  assert.equal(await app.page.evaluate(() => (window as never as Neo).__neocad.engine.active?.name), "cut");
  await clickWorld([-12, 0, T]);
  await handle();
  await shot("4-cut-preview");
  assert.equal(await app.page.$eval('#options input.oval[data-option="depth"]', (f) => (f as HTMLInputElement).value), "10", "a positive depth: into the material");
  assert.match((await app.page.textContent("#mode")) ?? "", /✓ to cut/);
  await press("#options .oact button.ok");
  const args = await lastExtrude();
  assert.equal(args?.[1], -10, `into the plate is against the lid's normal, typed: ${JSON.stringify(args)}`);
  assert.deepEqual(args?.at(-1), { mode: "cut", into: "e1" });
  const [b] = await bodies();
  assert.ok(b.valid);
  assert.ok(b.faces.includes("e2.m0") && !b.faces.includes("e2.lid"), `a hole right through: ${b.faces}`);
  await app.type('workplane(null)');
  // Close enough to see into the hole, and back.
  await app.type("zoom(3)");
  await shot("5-cut-hole");
  await app.type("zoom(1 / 3)");
});

test("Through all on a stepped body: a boss on the plate, a hole from the boss's top through both", { skip }, async () => {
  // The boss: a rectangle on the lid, extruded up 15.
  await app.type('arm("sketch")');
  await clickWorld([W - 3, H - 3, T]);
  await app.type("arm(\"rectangle\")");
  await leftDrag(await app.screenOf([5, -10, T]), await app.screenOf([25, 10, T]));
  await app.type('arm("extrude", { depth: 15 })');
  await clickWorld([15, 0, T]);
  await press("#options .oact button.ok");
  await app.type('arm("sketch")');
  await clickWorld([22, 7, T + 15]);
  await app.type("arm(\"circle\")");
  await leftDrag(await app.screenOf([15, 0, T + 15]), await app.screenOf([18, 0, T + 15]));
  await app.type("orbit(-0.6, -1.0)");
  await app.type('arm("cut")');
  await clickWorld([15, 0, T + 15]);
  await press('#options .ochoose[data-choice="through"]');
  assert.equal(await app.page.$eval('#options .ochoose[data-choice="through"]', (x) => x.getAttribute("aria-pressed")), "true");
  await shot("6-through-all-preview");
  await press("#options .oact button.ok");
  const args = await lastExtrude();
  assert.deepEqual(args?.at(-1), { mode: "cut", into: "e1", end: "through" }, JSON.stringify(args));
  const [b] = await bodies();
  assert.ok(b.valid);
  const cut = b.features.at(-1)!;
  assert.ok(b.faces.includes(`${cut}.m0`) && !b.faces.includes(`${cut}.lid`), `through boss and plate: ${b.faces}`);
  // The plate made deeper: the hole goes through it still.
  await app.type('set("d1.value", 20)');
  const [deeper] = await bodies();
  assert.ok(deeper.valid && !deeper.faces.includes(`${cut}.lid`), `still through: ${deeper.faces}`);
  await app.type('workplane(null)');
  await app.type("zoom(2.5)");
  await shot("7-through-all-built");
  await app.type("zoom(1 / 2.5)");
});

test("the depth handle dragged by the mouse: the depth follows in round steps, typed as arm when let go", { skip }, async () => {
  await app.type("workplane(null)");
  await app.type("arm(\"rectangle\")");
  await leftDrag(await app.screenOf([60, -10, 0]), await app.screenOf([80, 10, 0]));
  await app.type('arm("extrude", { depth: 10 })');
  await clickWorld([70, 0, 0]);
  const h = await handle();
  const mid: [number, number] = [(h.from[0] + h.label[0]) / 2, (h.from[1] + h.label[1]) / 2];
  // Along the arrow, sixty pixels: deeper.
  await leftDrag(mid, [mid[0] + h.dir[0] * 60, mid[1] + h.dir[1] * 60], 12);
  const depth = Number(await app.page.$eval('#options input.oval[data-option="depth"]', (f) => (f as HTMLInputElement).value));
  assert.ok(depth > 10, `deeper: ${depth}`);
  assert.ok(Number.isInteger(depth), `a round value: ${depth}`);
  assert.match(await app.log(), new RegExp(`arm\\("extrude", \\{depth: ${depth}\\}\\)`));
  await shot("8-handle-dragged");
  await app.type("cancel()");
});

test("a revolve about the origin's own y axis, flipped: a half turn the other way", { skip }, async () => {
  // A drawing of its own: the plate above stands over the origin, and an arm
  // under a solid is hidden from the hand as from the eye (ARCHITECTURE, opaque).
  await app.close();
  app = await openApp();
  await app.type("arm(\"rectangle\")");
  await leftDrag(await app.screenOf([8, 30, 0]), await app.screenOf([16, 44, 0]));
  await app.type("arm(\"revolve\", { angle: 3.14159 })");
  await clickWorld([12, 37, 0]);
  // The origin's y arm, twenty pixels out along it: lit, and taken (it was refused: W9).
  const [o, y1] = [await app.screenOf([0, 0, 0]), await app.screenOf([0, 1, 0])];
  const len = Math.hypot(y1[0] - o[0], y1[1] - o[1]);
  const onArm = await app.at(o[0] + ((y1[0] - o[0]) / len) * 20, o[1] + ((y1[1] - o[1]) / len) * 20);
  await app.page.mouse.click(onArm.x, onArm.y);
  await app.page.waitForTimeout(300);
  assert.doesNotMatch(await app.log(), /origin\.y is not in its plane/);
  await press("#options button.oflip");
  assert.equal(await app.page.$eval('#options input.oval[data-option="angle"]', (f) => (f as HTMLInputElement).value), "-3.14159");
  await app.type("orbit(-0.6, -1.0)");
  await shot("9-revolve-flipped");
  await press("#options .oact button.ok");
  const j = await app.page.evaluate(() => (window as never as Neo).__neocad.model.journal.filter((e) => e.op === "revolve").at(-1)!.args);
  assert.equal(j[1], "origin.y");
  assert.equal(j[2], -3.14159);
  assert.deepEqual(app.pageErrors, []);
});
