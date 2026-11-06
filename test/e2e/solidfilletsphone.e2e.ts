// Fillets and chamfers under an iPhone 13's emulation (docs/plans/solid-fillets.md):
// the desktop's flow, by finger. A plate; the round tool armed; an edge
// tapped with a finger's reach; the preview while the finger holds the radius
// label and drags it (the kernel answers before the finger lifts); ✓ tapped;
// undo; a kernel edge tapped with nothing armed selects it; a chamfer the same.
// Set NEOCAD_E2E_SHOTS to keep the pictures.

import { test, before, after } from "node:test";
import assert from "node:assert/strict";
import { existsSync, mkdirSync } from "node:fs";
import { join } from "node:path";
import { openApp, type AppContext } from "./harness.ts";
import { fingers, type Fingers } from "./fingers.ts";

const built = existsSync(new URL("../../src/solids/smlib-gen/smlib.mjs", import.meta.url));
const skip = built ? false : "no SMLib build — run `npm run build:solids`";

let app: AppContext;
let hand: Fingers;
before(async () => {
  if (!built) return;
  app = await openApp({ device: "iPhone 13" });
  hand = await fingers(app);
});
after(async () => { if (built) await app.close(); });

const SHOTS = process.env.NEOCAD_E2E_SHOTS;
async function shot(name: string): Promise<void> {
  if (!SHOTS) return;
  mkdirSync(SHOTS, { recursive: true });
  await app.page.waitForTimeout(200);
  await app.page.screenshot({ path: join(SHOTS, `fillets-iphone-${name}.png`) });
}

async function type(line: string): Promise<void> {
  await app.type(line);
  await app.page.evaluate(() => (document.activeElement as HTMLElement | null)?.blur());
}

async function tapAt(world: number[], off: [number, number] = [0, 0]): Promise<void> {
  const [x, y] = await app.screenOf(world);
  await app.at(x + off[0], y + off[1]);
  await hand.tap(x + off[0], y + off[1]);
  await app.page.waitForTimeout(300);
}

async function dragOn(a: number[], b: number[]): Promise<void> {
  const [p, q] = [await app.screenOf(a), await app.screenOf(b)];
  await app.at(...p);
  await hand.drag(p, q, 12);
  await app.page.waitForTimeout(250);
}

async function tapButton(selector: string): Promise<void> {
  await app.page.tap(selector);
  await app.page.waitForTimeout(300);
}

type Neo = { __neocad: {
  bodies: { settled: boolean; trialAnswer(): { settled: boolean; why: string | null };
    views(): { result: { solid: { volume: number; validity: { manifold: boolean; failures: number }; faces: { name: string }[] } } }[] };
  model: { blends: Map<string, { name: string; kind: string; edges: string[]; size: string }> };
  engine: { selection: { edges: readonly string[] }; active: { handle?: { at: [number, number] } } | null };
} };

async function settled(): Promise<{ volume: number; valid: boolean; faces: string[] }[]> {
  await app.page.waitForFunction(() => (window as never as Neo).__neocad.bodies.settled, undefined, { timeout: 30_000 });
  return app.page.evaluate(() => (window as never as Neo).__neocad.bodies.views().map((v) => ({
    volume: v.result.solid.volume, valid: v.result.solid.validity.manifold && v.result.solid.validity.failures === 0,
    faces: [...new Set(v.result.solid.faces.map((f) => f.name))].sort(),
  })));
}

async function previewed(): Promise<{ why: string | null; volume: number | null }> {
  await app.page.waitForFunction(() => (window as never as Neo).__neocad.bodies.trialAnswer().settled, undefined, { timeout: 30_000 });
  await app.page.waitForTimeout(100);
  return app.page.evaluate(() => {
    const b = (window as never as Neo).__neocad.bodies;
    return { why: b.trialAnswer().why, volume: b.views()[0]?.result.solid.volume ?? null };
  });
}

const blends = () => app.page.evaluate(() =>
  [...(window as never as Neo).__neocad.model.blends.values()].map((b) => ({ name: b.name, kind: b.kind, edges: b.edges, size: b.size })));

const W = 30, H = 18, T = 8, R = 2;
const plate = 2 * W * 2 * H * T;
const filletCut = (r: number, len: number) => ((4 - Math.PI) / 4) * r * r * len;

test("on an iPhone: a plate, the round tool, an edge tapped — the kernel's preview — ✓ tapped: a fillet", { skip }, async () => {
  await type("plane()");
  await type("rectangle");
  await dragOn([-W, -H, 0], [W, H, 0]);
  await type(`arm("extrude", { depth: ${T} })`);
  await tapAt([0, 0, 0]);
  await tapButton("#options .oact button.ok");
  await type("orbit(-0.6, -1.0)");
  await type(`arm("round", { radius: ${R} })`);
  await settled();
  // The front lid edge, tapped a few pixels off it: a finger's reach takes it.
  await tapAt([0, -H, T], [0, 6]);
  const p = await previewed();
  assert.equal(p.why, null);
  assert.ok(p.volume !== null && Math.abs(p.volume - (plate - filletCut(R, 2 * W))) < 1e-3, `preview ${p.volume}`);
  await shot("1-preview");
  await tapButton("#options .oact button.ok");
  const b = await blends();
  assert.equal(b.length, 1);
  const [s] = await settled();
  assert.ok(s.valid && s.faces.includes("e2.f0"));
  assert.ok(Math.abs(s.volume - (plate - filletCut(R, 2 * W))) < 1e-3);
  await shot("2-filleted");
});

test("on an iPhone: the radius label held and dragged — the preview while the finger holds — then ✓, then undo", { skip }, async () => {
  await type('edit("e2")');
  await previewed();
  const handle = await app.page.evaluate(() => (window as never as Neo).__neocad.engine.active?.handle?.at ?? null);
  assert.ok(handle, "the radius label is on the drawing");
  await app.at(handle[0], handle[1]);
  await hand.down(handle);
  // Held past a tap's time, then moved: a drag of the label.
  await app.page.waitForTimeout(120);
  await hand.glide(8, [handle[0] + 18, handle[1] - 26]);
  await app.page.waitForTimeout(500);
  const held = await previewed();
  assert.equal(held.why, null);
  assert.ok(held.volume !== null && held.volume < plate - filletCut(R, 2 * W) - 1, `the finger still down, the preview is bigger: ${held.volume}`);
  await shot("3-finger-holds-the-radius");
  await hand.up();
  await app.page.waitForTimeout(400);
  await tapButton("#options .oact button.ok");
  const size = (await blends())[0].size;
  const r = (await app.repl(`model.relationOf("${size}").args[0]`)).value as number;
  assert.ok(r > R, `the radius set: ${r}`);
  await type("undo()");
  const back = (await app.repl(`model.relationOf("${size}").args[0]`)).value as number;
  assert.equal(back, R, "one undo puts it back");
});

test("on an iPhone: nothing armed, a kernel edge tapped — selected; a chamfer of another edge, ✓ tapped", { skip }, async () => {
  await type('arm("select")');
  // The back lid edge, long on screen: a short one's corners are within a
  // finger's reach of its middle, and a corner wins, as it should.
  await tapAt([0, H, T]);
  const sel = await app.page.evaluate(() => [...(window as never as Neo).__neocad.engine.selection.edges]);
  assert.equal(sel.length, 1, `a tap on an edge selects it: ${sel}`);
  await shot("4-edge-tapped");
  await type('arm("chamfer", { setback: 1.5, tangent: false })');
  const p = await previewed();
  assert.equal(p.why, null, "the chamfer starts from the edge selected");
  await tapButton("#options .oact button.ok");
  const b = await blends();
  assert.equal(b.at(-1)!.kind, "chamfer");
  const [s] = await settled();
  assert.ok(s.valid);
  await shot("5-chamfered");
  assert.deepEqual(app.pageErrors, []);
});
