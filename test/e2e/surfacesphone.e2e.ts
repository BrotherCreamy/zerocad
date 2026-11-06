// Surfaces under an iPhone 13's emulation (docs/plans/surfaces.md): the
// desktop's flow, by finger. A rectangle; its face tapped with the surface
// tool and ✓ tapped; a circle; the trim tool — the surface tapped where it is
// kept, then the circle; a wall swept off the front edge; the two knitted from
// the surface's menu, opened by a held finger; the join tapped with the round
// tool, the kernel's preview, ✓; thickened; exported through the share sheet.
// Set NEOCAD_E2E_SHOTS to keep the pictures.
//
// No fixed sleeps but a long-press's own hold: every step polls for the state
// it waits on.

import { test, before, after } from "node:test";
import assert from "node:assert/strict";
import { existsSync, mkdirSync } from "node:fs";
import { join } from "node:path";
import { openApp, type AppContext } from "./harness.ts";
import { fingers, type Fingers } from "./fingers.ts";

const built = existsSync(new URL("../../src/solids/smlib-gen/smlib.mjs", import.meta.url));
const skip = built ? false : "no SMLib build — run `npm run build:solids`";

/** A share sheet that records what it is handed (step.e2e.ts's), before the app's first line. */
function sheet(): void {
  const w = window as unknown as { __shared: unknown[] };
  w.__shared = [];
  Object.defineProperty(navigator, "canShare", { configurable: true, value: (d: { files?: File[] }) => !!d?.files?.length });
  Object.defineProperty(navigator, "share", {
    configurable: true,
    value: async (d: { files: File[] }) => {
      for (const f of d.files) w.__shared.push({ name: f.name, type: f.type, text: await f.text() });
    },
  });
}

let app: AppContext;
let hand: Fingers;
before(async () => {
  if (!built) return;
  app = await openApp({ device: "iPhone 13", init: { fn: sheet, arg: undefined } });
  hand = await fingers(app);
});
after(async () => {
  if (!built) return;
  assert.deepEqual(app.pageErrors, [], "nothing the page threw went uncaught");
  await app.close();
});

const frames = () => app.page.evaluate(() => new Promise<void>((r) => requestAnimationFrame(() => requestAnimationFrame(() => r()))));

const SHOTS = process.env.NEOCAD_E2E_SHOTS;
async function shot(name: string): Promise<void> {
  if (!SHOTS) return;
  mkdirSync(SHOTS, { recursive: true });
  await frames();
  await app.page.screenshot({ path: join(SHOTS, `surfaces-iphone-${name}.png`) });
}

async function type(line: string): Promise<void> {
  await app.type(line);
  await app.page.evaluate(() => (document.activeElement as HTMLElement | null)?.blur());
}

async function tapAt(world: number[], off: [number, number] = [0, 0]): Promise<void> {
  const [x, y] = await app.screenOf(world);
  await app.at(x + off[0], y + off[1]);
  await hand.tap(x + off[0], y + off[1]);
  await frames();
}

async function dragOn(a: number[], b: number[]): Promise<void> {
  const [p, q] = [await app.screenOf(a), await app.screenOf(b)];
  await app.at(...p);
  await hand.drag(p, q, 12);
  await frames();
}

/** ✓ in the options panel, tapped. */
async function tapOk(): Promise<void> {
  await app.page.tap("#options .oact button.ok");
  await frames();
}

/**
 * Of these places on the plate, the first where a finger would land on the
 * surface `body` and on nothing nearer — no curve in its reach, no other
 * surface in front — asked of the page's own picking, so the test does not
 * guess the view.
 */
async function clearOn(body: string, places: number[][]): Promise<number[]> {
  for (const w of places) {
    const [x, y] = await app.screenOf(w);
    const ok = await app.page.evaluate(([sx, sy, b]) => {
      const n = (window as never as { __neocad: { engine: { view: unknown; pickAt(x: number, y: number): unknown }; model: { hidden: Set<string> };
        bodies: { faceAt(v: unknown, x: number, y: number, h: Set<string>): { body: string } | null } } }).__neocad;
      return n.engine.pickAt(sx as number, sy as number) === null && n.bodies.faceAt(n.engine.view, sx as number, sy as number, n.model.hidden)?.body === b;
    }, [x, y, body] as const);
    if (ok) return w;
  }
  throw new Error(`no place clear on ${body} among ${JSON.stringify(places)}`);
}

/** A finger held on the drawing until the menu opens; its items. */
async function menuAt(world: number[]): Promise<string[]> {
  const [x, y] = await app.screenOf(world);
  await app.at(x, y);
  await hand.hold(x, y, 700);
  await app.page.waitForFunction(() => !(document.querySelector("#ctxmenu") as HTMLElement).hidden);
  return app.page.$$eval("#ctxmenu .item", (els) => els.map((i) => i.firstElementChild?.textContent ?? ""));
}

async function tapItem(label: string): Promise<void> {
  await app.page.locator("#ctxmenu .item", { hasText: label }).first().tap();
  await app.page.waitForFunction(() => (document.querySelector("#ctxmenu") as HTMLElement).hidden);
}

type Neo = { __neocad: {
  bodies: { settled: boolean; trialAnswer(): { settled: boolean; why: string | null };
    views(): { name: string; result: { solid: { volume: number; validity: { manifold: boolean };
      faces: { name: string; area: number }[]; edges: { name: string; lamina: boolean }[] } } }[] };
  model: { surfaces: Map<string, { kind: string; with?: string[] }> };
} };

async function settled(): Promise<{ name: string; area: number; manifold: boolean; volume: number; faces: string[] }[]> {
  await app.page.waitForFunction(() => (window as never as Neo).__neocad.bodies.settled, undefined, { timeout: 30_000 });
  return app.page.evaluate(() => (window as never as Neo).__neocad.bodies.views().map((v) => ({
    name: v.name, area: v.result.solid.faces.reduce((a, f) => a + f.area, 0), manifold: v.result.solid.validity.manifold,
    volume: v.result.solid.volume, faces: [...new Set(v.result.solid.faces.map((f) => f.name))].sort(),
  })));
}

async function kind(name: string): Promise<string> {
  await app.page.waitForFunction((n) => (window as never as Neo).__neocad.model.surfaces.has(n), name, { timeout: 10_000 });
  return app.page.evaluate((n) => (window as never as Neo).__neocad.model.surfaces.get(n)!.kind, name);
}

const near = (a: number, b: number, rel = 1e-5) => Math.abs(a - b) <= rel * Math.max(1, Math.abs(b));

const W = 24, H = 16, R = 5, CX = 8, UP = 12, F = 3, T = 2, C = 2;
const plate = 4 * W * H - Math.PI * R * R;
/** A place on the plate well clear of every curve, for a finger. */
const IN = [-W / 2, -H / 4, 0];
/** Places on the plate to hold a finger on, back to front. */
const PLACES = [[-W / 2, H / 2, 0], [-W * 0.7, H / 3, 0], [W / 2, H / 2, 0], [-W / 2, 0, 0], [W * 0.6, -H / 3, 0]];

test("on an iPhone: a rectangle's face tapped with the surface tool, ✓ tapped — a planar surface", { skip }, async () => {
  await type("plane()");
  await type("rectangle");
  await dragOn([-W, -H, 0], [W, H, 0]);
  await type("orbit(-0.6, -1.0); zoom(1.3)");
  await type('arm("surface")');
  await tapAt(IN);
  await tapOk();
  assert.equal(await kind("s1"), "planar");
  const [s] = await settled();
  assert.ok(near(s.area, 4 * W * H), `area ${s.area}`);
  await shot("1-planar");
});

test("on an iPhone: trimmed by a circle — the surface tapped where it is kept, then the circle", { skip }, async () => {
  await type(`circle(pt(${CX}, 0, 0), ${R})`);
  await type('arm("trim")');
  await tapAt(IN);
  await tapAt([CX + R, 0, 0]);
  assert.equal(await kind("s2"), "trim");
  const [s] = await settled();
  assert.ok(near(s.area, plate), `area ${s.area} against ${plate}`);
  await shot("2-trimmed");
});

test("on an iPhone: a wall swept down off the front edge, and the two knitted from the menu a held finger opens", { skip }, async () => {
  // Hanging below the ground, so from above it is behind the plate and never over it for a finger.
  await type(`arm("surface", { depth: -${UP}, chain: false })`);
  await tapAt([0, -H, 0], [0, 4]);
  await tapOk();
  assert.equal(await kind("s3"), "extrude");
  await settled();
  await type('arm("select")');
  const items = await menuAt(await clearOn("s1", PLACES));
  assert.ok(items.includes("Knit with s3"), `the surface's menu: ${items}`);
  await tapItem("Knit with s3");
  assert.equal(await kind("s4"), "knit");
  const s = await settled();
  assert.deepEqual(s.map((x) => x.name), ["s1"]);
  assert.ok(near(s[0].area, plate + 2 * W * UP));
  await shot("3-knitted");
});

/** A selector's middle, in the canvas's coordinates the fingers take. */
const middleOf = (selector: string) => app.page.$eval(selector, (el) => {
  const r = el.getBoundingClientRect();
  const c = document.getElementById("cv")!.getBoundingClientRect();
  return [r.x + r.width / 2 - c.x, r.y + r.height / 2 - c.y] as [number, number];
});

const counts = () => app.page.evaluate(() => {
  const m = (window as never as { __neocad: { model: { surfaces: Map<string, unknown>; entities: Map<string, unknown> } } }).__neocad.model;
  return `${m.surfaces.size}/${m.entities.size}`;
});

test("on an iPhone: the join chamfered — chamfer tapped in the modify group's flyout, its setback typed in the panel, the join tapped, ✓ tapped", { skip }, async () => {
  const knitted = (await settled())[0].area;
  const back = await counts();
  // A held finger opens the group's flyout (toolbar-groups.md); a tap on the item arms it.
  await hand.hold(...await middleOf('#toolbar button[data-group="modify"]'), 700, true);
  await app.page.waitForFunction(() => {
    const f = document.querySelector("#flyout") as HTMLElement;
    return !f.hidden && f.dataset.group === "modify";
  });
  await hand.up();
  await hand.tap(...await middleOf('#flyout button[data-tool="chamfer"]'));
  await app.page.waitForFunction(() => (window as never as { __neocad: { engine: { active: { name: string } | null } } }).__neocad.engine.active?.name === "chamfer");
  // The setback entered in the options panel: a tap on the field, a number, no drag.
  const field = '#options input.oval[data-option="setback"]';
  await app.page.tap(field);
  await app.page.fill(field, String(C));
  await app.page.waitForFunction(([s, c]) => (document.querySelector(s) as HTMLInputElement).value === c, [field, String(C)] as const);
  await app.page.evaluate(() => (document.activeElement as HTMLElement | null)?.blur());
  await tapAt([0, -H, 0], [0, 5]);
  await app.page.waitForFunction(() => (window as never as Neo).__neocad.bodies.trialAnswer().settled, undefined, { timeout: 30_000 });
  assert.equal(await app.page.evaluate(() => (window as never as Neo).__neocad.bodies.trialAnswer().why), null);
  await tapOk();
  assert.equal(await kind("s5"), "chamfer");
  const entry = await app.page.evaluate(() => {
    const j = (window as never as { __neocad: { model: { journal: { op: string; args: unknown[] }[] } } }).__neocad.model.journal;
    return j.filter((e) => e.op === "chamferSurfaces").at(-1) ?? null;
  });
  assert.ok(entry, "journalled as chamferSurfaces");
  assert.equal(entry.args[2], C, `the setback typed in the panel: ${JSON.stringify(entry.args)}`);
  const [s] = await settled();
  const expect = knitted - 2 * C * 2 * W + Math.SQRT2 * C * 2 * W;
  assert.ok(near(s.area, expect, 1e-6), `area ${s.area} against ${expect}`);
  assert.ok(s.faces.includes("s5.f0"));
  await shot("4a-chamfered");
  // Back to the knitted sheet for the fillet: the action strip's Undo, tapped until it is.
  for (let i = 0; i < 4 && (await counts()) !== back; i++) {
    const was = await counts();
    await hand.tap(...await middleOf('#actions button[data-action="undo"]'));
    await app.page.waitForFunction((w) => {
      const m = (window as never as { __neocad: { model: { surfaces: Map<string, unknown>; entities: Map<string, unknown> } } }).__neocad.model;
      return `${m.surfaces.size}/${m.entities.size}` !== w;
    }, was, { timeout: 10_000 });
  }
  assert.equal(await counts(), back, "undone back to the knitted sheet");
  assert.ok(near((await settled())[0].area, knitted));
  await type('arm("select")');
});

test("on an iPhone: the join tapped with the round tool — the preview — ✓ tapped", { skip }, async () => {
  await type(`arm("round", { radius: ${F} })`);
  await tapAt([0, -H, 0], [0, 5]);
  await app.page.waitForFunction(() => (window as never as Neo).__neocad.bodies.trialAnswer().settled, undefined, { timeout: 30_000 });
  assert.equal(await app.page.evaluate(() => (window as never as Neo).__neocad.bodies.trialAnswer().why), null);
  await shot("4-fillet-preview");
  await tapOk();
  assert.equal(await kind("s5"), "fillet");
  const [s] = await settled();
  const expect = plate + 2 * W * UP - 2 * F * 2 * W + (Math.PI / 2) * F * 2 * W;
  assert.ok(near(s.area, expect), `area ${s.area} against ${expect}`);
  assert.ok(s.faces.includes("s5.f0"));
  await shot("5-filleted");
});

test("on an iPhone: thickened from the menu, and exported through the share sheet as a solid", { skip }, async () => {
  const before = (await settled())[0].area;
  await type('arm("select")');
  await menuAt(await clearOn("s1", PLACES));
  await tapItem("Thicken…");
  assert.equal(await app.page.inputValue("#cmd"), 'thicken("s1", ');
  await app.page.focus("#cmd");
  await app.page.keyboard.type(`${T})`);
  await app.page.keyboard.press("Enter");
  assert.equal(await kind("s6"), "thicken");
  const [s] = await settled();
  assert.equal(s.manifold, true);
  const curl = (Math.PI / 2) * (2 * W) * T * T / 2;
  assert.ok(near(s.volume, before * T + curl) || near(s.volume, before * T - curl), `volume ${s.volume}`);
  await app.page.evaluate(() => (document.activeElement as HTMLElement | null)?.blur());
  await shot("6-thickened");
  await type("exportStep()");
  await app.page.waitForFunction(() => (window as unknown as { __shared: unknown[] }).__shared.length === 1);
  const [file] = await app.page.evaluate(() => (window as unknown as { __shared: { name: string; type: string; text: string }[] }).__shared);
  assert.equal(file.type, "model/step");
  assert.match(file.text, /MANIFOLD_SOLID_BREP\('s1'/);
});
