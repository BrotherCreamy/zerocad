// Solids on the kernel, in a browser (docs/plans/solids-kernel.md): the
// owner's "I find it impossible to make anything beyond an extruded shape",
// answered by the tools. A plate drawn and extruded; a circle sketched on its
// top and extruded Cut, through — a hole; a circle sketched on its side and
// extruded with the default, Add — a boss; a dimension changed and the
// hole's rim dragged, and the body rebuilt each time; one undo; save, open;
// STEP exported and read back. Every step looked at: set NEOCAD_E2E_SHOTS to
// a directory to keep the screenshots.
//
// What only the assembled app can say: that the kernel's Worker loads from
// the dev server and answers; that a body of two features is drawn from the
// kernel's faces (the hole is a hole in the picture, not just in the numbers);
// that sketch on face finds a wall of a body the kernel built, which no loop
// of entities bounds any more; that the dialog's Cut is a button and its line
// is typed. Skips, saying so, without a kernel build.
//
// One app, tests in order: the states are cumulative.

import { test, before, after } from "node:test";
import assert from "node:assert/strict";
import { existsSync, mkdirSync } from "node:fs";
import { join } from "node:path";
import { openApp, type AppContext, confirmAndRelease } from "./harness.ts";

const built = existsSync(new URL("../../src/solids/smlib-gen/smlib.mjs", import.meta.url));
const skip = built ? false : "no SMLib build — run `npm run build:solids`";

let app: AppContext;
before(async () => { if (built) app = await openApp(); });
after(async () => { if (built) await app.close(); });

const SHOTS = process.env.NEOCAD_E2E_SHOTS;
async function shot(name: string): Promise<void> {
  if (!SHOTS) return;
  mkdirSync(SHOTS, { recursive: true });
  await app.page.mouse.move(2, 2);
  await app.page.waitForTimeout(150);
  await app.page.screenshot({ path: join(SHOTS, `solids-desktop-${name}.png`) });
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
  await app.page.waitForTimeout(220);
}

async function key(combo: string): Promise<void> {
  await app.page.fill("#cmd", "");
  await app.page.keyboard.press(combo);
  await app.page.waitForTimeout(250);
}

/** The kernel's view of the bodies once it has answered for the model as it is. */
interface Seen { name: string; features: string[]; volume: number; valid: boolean; faces: string[] }
async function settled(): Promise<{ bodies: Seen[]; report: string[] }> {
  await app.page.waitForFunction(() => {
    const b = (window as never as { __neocad: { bodies: { settled: boolean } } }).__neocad.bodies;
    return b.settled;
  }, undefined, { timeout: 20_000 });
  return app.page.evaluate(() => {
    const b = (window as never as { __neocad: { bodies: {
      views(): { name: string; features: string[]; result: { solid: { volume: number; validity: { manifold: boolean; failures: number };
        faces: { name: string }[] } } }[];
      report(): { lines: string[] };
    } } }).__neocad.bodies;
    return {
      bodies: b.views().map((v) => ({
        name: v.name, features: v.features, volume: v.result.solid.volume,
        valid: v.result.solid.validity.manifold && v.result.solid.validity.failures === 0,
        faces: [...new Set(v.result.solid.faces.map((f) => f.name))].sort(),
      })),
      report: b.report().lines,
    };
  });
}

const features = (): Promise<{ name: string; mode: string; into: string | null; depth: string }[]> => app.page.evaluate(() =>
  [...(window as never as { __neocad: { model: { features: Map<string, { name: string; mode?: string; into?: string; depth: string }> } } })
    .__neocad.model.features.values()].map((f) => ({ name: f.name, mode: f.mode ?? "new", into: f.into ?? null, depth: f.depth })));

async function saved(): Promise<string> {
  const r = await app.repl("save()");
  assert.equal(r.ok, true, r.error ?? "");
  return r.value as string;
}

// The plate: 80 × 50, 10 deep.
const W = 40, H = 25, T = 10;
const HOLE = [-15, 0, T], R = 6;
const SIDE = [15, -H, T / 2], BOSS_R = 4, BOSS = 8;
const plateVolume = 2 * W * 2 * H * T;

test("a plate, drawn and extruded: a body of one feature, drawn as it always was — nothing sent to the kernel", { skip }, async () => {
  await app.type("plane()");
  await app.type("rectangle");
  await leftDrag(await app.screenOf([-W, -H, 0]), await app.screenOf([W, H, 0]));
  await app.type(`arm("extrude", { depth: ${T} })`);
  await clickAt(...await app.screenOf([0, 0, 0]));
  await confirmAndRelease(app);
  assert.deepEqual((await features()).map((f) => [f.name, f.mode]), [["e1", "new"]]);
  const s = await settled();
  assert.deepEqual(s.bodies, [], "a body of one feature is faces.ts's, live");
  await app.type("orbit(-0.6, -1.0); zoom(1.6)");
  await shot("1-plate");
});

test("a circle sketched on the top, extruded Cut through: a hole — in the numbers and in the picture", { skip }, async () => {
  await app.type("sketch");
  await clickAt(...await app.screenOf([W - 8, H - 8, T]));
  assert.match((await app.repl("model.workPlane")).value as string, /^p\d+\.p\d+\.p\d+$/, "sketching on the lid");
  await app.type("circle");
  await leftDrag(await app.screenOf(HOLE), await app.screenOf([HOLE[0] + R, HOLE[1], HOLE[2]]));
  await app.type(`arm("extrude", { depth: -${T}, mode: "cut" })`);
  // The dialog's Cut button is down.
  const pressed = await app.page.$eval('#options .ochoose[data-choice="cut"]', (b) => b.getAttribute("aria-pressed"));
  assert.equal(pressed, "true");
  await clickAt(...await app.screenOf(HOLE));
  await app.page.waitForTimeout(400);
  await shot("2a-cut-preview");
  await confirmAndRelease(app);
  const log = await app.log();
  assert.match(log, /> extrude\("c\d+", -10, \{"mode":"cut"\}\)/, `typed with its mode: ${log.slice(-400)}`);
  assert.deepEqual((await features()).map((f) => [f.name, f.mode, f.into]), [["e1", "new", null], ["e2", "cut", "e1"]]);
  const s = await settled();
  assert.equal(s.bodies.length, 1);
  const b = s.bodies[0];
  assert.deepEqual(b.features, ["e1", "e2"]);
  assert.ok(b.valid);
  assert.ok(Math.abs(b.volume - (plateVolume - Math.PI * R * R * T)) < 0.1, `volume ${b.volume}`);
  assert.ok(b.faces.includes("e2.m0") && !b.faces.includes("e2.lid"), `a through hole's wall and no floor: ${b.faces}`);
  // Looking straight down the hole, the kernel's picture has no face there:
  // the faces canvas is clear at the hole's centre.
  await app.type('lookAt("f1")');
  const [hx, hy] = await app.screenOf(HOLE);
  const px = await app.pixel(hx, hy, "faces");
  assert.equal(px[3], 0, `nothing drawn through the hole: ${px}`);
  const solidPx = await app.pixel(...await app.screenOf([W - 5, H - 5, T]), "faces");
  assert.ok(solidPx[3] > 200, "the lid beside it is");
  await app.type("orbit(-0.6, -1.0)");
  await shot("2-hole");
});

test("a circle sketched on the side, extruded with the default: Add — a boss, the side found on the kernel's body", { skip }, async () => {
  await app.type('lookAt("f1"); orbit(-0.25, -1.2); zoom(1.2)');
  await app.type("sketch");
  await clickAt(...await app.screenOf(SIDE));
  const plane = (await app.repl("model.workPlane")).value as string;
  assert.match(plane, /^p\d+\.p\d+\.p\d+$/, `on the near wall: ${plane}`);
  await app.type("circle");
  await leftDrag(await app.screenOf(SIDE), await app.screenOf([SIDE[0] + BOSS_R, SIDE[1], SIDE[2]]));
  await app.type(`arm("extrude", { depth: ${BOSS} })`);
  await clickAt(...await app.screenOf(SIDE));
  await app.page.waitForTimeout(400);
  // Left at auto, the dialog shows what auto comes to: Add.
  const resolved = await app.page.$eval('#options .ochoose[data-choice="add"]', (b) => b.classList.contains("resolved"));
  assert.ok(resolved, "auto resolves to Add, shown dimly down");
  await shot("3a-boss-preview");
  await confirmAndRelease(app);
  assert.deepEqual((await features()).map((f) => [f.name, f.mode, f.into]), [["e1", "new", null], ["e2", "cut", "e1"], ["e3", "add", "e1"]]);
  const s = await settled();
  const b = s.bodies[0];
  assert.deepEqual(b.features, ["e1", "e2", "e3"]);
  assert.ok(b.valid);
  const want = plateVolume - Math.PI * R * R * T + Math.PI * BOSS_R * BOSS_R * BOSS;
  assert.ok(Math.abs(b.volume - want) < 0.1, `volume ${b.volume}, want ${want}`);
  assert.deepEqual(s.report, []);
  await app.type('lookAt("f1"); orbit(-0.6, -1.0); zoom(0.8)');
  await shot("3-boss");
});

test("a dimension changed and the hole's rim dragged: the body rebuilds; one undo puts the rim back", { skip }, async () => {
  const depth = (await features()).find((f) => f.name === "e1")!.depth;
  await app.type(`set("${depth}.value", 16)`);
  let s = await settled();
  const thick = 2 * W * 2 * H * 16 - Math.PI * R * R * T + Math.PI * BOSS_R * BOSS_R * BOSS;
  assert.ok(Math.abs(s.bodies[0].volume - thick) < 0.1, `the plate thickened, the hole now blind: ${s.bodies[0].volume}`);
  assert.ok(s.bodies[0].faces.includes("e2.lid"), "and the hole has a floor");
  await shot("4a-thicker");

  // Drag the hole by its rim (a rim drags its centre: docs/plans/edge-drag.md)
  // out through the plate's left wall: the kernel rebuilds a body of another
  // topology — the wall split in two by the hole breaking out — and the
  // names hold (test/solidsidentity.test.ts measures that in full).
  await app.type('lookAt("f1")');
  const before = await saved();
  const rim = await app.screenOf([HOLE[0] + R, HOLE[1], 16]);
  const out = -W + 3 - HOLE[0]; // the centre 3 inside the wall, the rim 3 past it
  await leftDrag(rim, await app.screenOf([HOLE[0] + R + out, HOLE[1], 16]));
  s = await settled();
  const m = await app.model();
  const centre = m.points[m.circles[0].center];
  assert.ok(Math.abs(centre[0] - (HOLE[0] + out)) < 0.5, `the hole's centre followed the hand: ${centre}`);
  const b = s.bodies[0];
  assert.ok(b.valid);
  assert.ok(b.volume > thick + 1, `part of the hole is off the plate now: ${b.volume} against ${thick}`);
  assert.ok(b.faces.includes("e2.m0") && b.faces.includes("e2.lid"), `the hole's wall and floor keep their names: ${b.faces}`);
  await app.type("orbit(-0.6, -1.0)");
  await shot("4b-dragged");
  await key("Control+z");
  assert.equal(await saved(), before, "one undo takes the drag back");
  s = await settled();
  assert.ok(Math.abs(s.bodies[0].volume - thick) < 0.1, "and the body with it");
});

test("save, open: the same body; STEP exports it and reads back as one solid", { skip }, async () => {
  const file = await saved();
  const was = (await settled()).bodies[0];
  await app.page.evaluate((text) => { (window as unknown as { SAVED: string }).SAVED = text; }, file);
  const opened = await app.repl("open(SAVED)");
  assert.equal(opened.ok, true, opened.error ?? "");
  const now = (await settled()).bodies[0];
  assert.deepEqual(now.features, was.features);
  assert.ok(Math.abs(now.volume - was.volume) < 1e-6);
  assert.deepEqual(now.faces, was.faces);
  await shot("5-reopened");
  const [download] = await Promise.all([app.page.waitForEvent("download"), app.type('exportStep("part")')]);
  const path = await download.path();
  assert.ok(path);
  const text = (await import("node:fs")).readFileSync(path, "utf8");
  assert.match(text, /^ISO-10303-21;/);
  assert.equal((text.match(/MANIFOLD_SOLID_BREP/g) ?? []).length, 1, "one solid: the body, not three features");
  assert.ok((text.match(/ADVANCED_FACE/g) ?? []).length >= 9);
  assert.deepEqual(app.pageErrors, []);
});
