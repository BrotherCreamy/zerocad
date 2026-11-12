// The owner's part on an iPhone (emulated: iPhone 13, touch, Chromium — the
// device itself is the owner's to try): the plate drawn with a finger and
// extruded by tapping its region and ✓; a circle sketched on its top with a
// finger, the dialog's Cut tapped, ✓ — a hole; a circle on its side, ✓ with
// the default — a boss; a dimension changed — the body rebuilt. What the
// desktop suite (solids.e2e.ts) cannot say: that the mode row is a finger's
// target, and that a body the kernel built is drawn and picked on a phone.
// Set NEOCAD_E2E_SHOTS to keep the screenshots; look at them.

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
  await app.page.screenshot({ path: join(SHOTS, `solids-iphone-${name}.png`) });
}

/**
 * Types a line, then lets go of the command line, as a hand does before it
 * touches the drawing again (touch.e2e.ts does the same): typing focused it.
 */
async function type(line: string): Promise<void> {
  await app.type(line);
  await app.page.evaluate(() => (document.activeElement as HTMLElement | null)?.blur());
}

async function tapAt(world: number[]): Promise<void> {
  const [x, y] = await app.screenOf(world);
  await app.at(x, y); // refuses a point a panel covers
  await hand.tap(x, y);
  await app.page.waitForTimeout(250);
}

async function dragOn(a: number[], b: number[]): Promise<void> {
  const [p, q] = [await app.screenOf(a), await app.screenOf(b)];
  await app.at(...p);
  await hand.drag(p, q, 12);
  await app.page.waitForTimeout(250);
}

/** Taps a button of the chrome, as a finger does. */
async function tapButton(selector: string): Promise<void> {
  await app.page.tap(selector);
  await app.page.waitForTimeout(300);
}

async function settled(): Promise<{ features: string[]; volume: number; valid: boolean; faces: string[] }[]> {
  await app.page.waitForFunction(() => (window as never as { __neocad: { bodies: { settled: boolean } } }).__neocad.bodies.settled,
    undefined, { timeout: 20_000 });
  return app.page.evaluate(() => (window as never as { __neocad: { bodies: { views(): { features: string[];
    result: { solid: { volume: number; validity: { manifold: boolean; failures: number }; faces: { name: string }[] } } }[] } } })
    .__neocad.bodies.views().map((v) => ({
      features: v.features, volume: v.result.solid.volume,
      valid: v.result.solid.validity.manifold && v.result.solid.validity.failures === 0,
      faces: [...new Set(v.result.solid.faces.map((f) => f.name))].sort(),
    })));
}

const modes = (): Promise<string[]> => app.page.evaluate(() =>
  [...(window as never as { __neocad: { model: { features: Map<string, { mode?: string }> } } }).__neocad.model.features.values()]
    .map((f) => f.mode ?? "new"));

const W = 30, H = 18, T = 8;

test("on an iPhone: a plate drawn with a finger, its region tapped, ✓ — a plate", { skip }, async () => {
  await type("plane()");
  await type("rectangle");
  await dragOn([-W, -H, 0], [W, H, 0]);
  await type(`arm("extrude", { depth: ${T} })`);
  await tapAt([0, 0, 0]);
  await tapButton("#options .oact button.ok");
  assert.deepEqual(await modes(), ["new"]);
  await type("orbit(-0.6, -1.0)");
  await shot("1-plate");
});

test("on an iPhone: a circle on the top, Cut tapped in the dialog, ✓ — a hole through", { skip }, async () => {
  await type("plane");
  await tapAt([W - 6, H - 6, T]);
  await type("circle");
  await dragOn([-12, 0, T], [-7, 0, T]);
  await type(`arm("extrude", { depth: -${T} })`);
  await tapAt([-12, 0, T]);
  // The mode row is a finger's target: Cut, tapped.
  const box = await app.page.$eval('#options .ochoose[data-choice="cut"]', (b) => { const r = b.getBoundingClientRect(); return [r.width, r.height]; });
  assert.ok(box[0] >= 25 && box[1] >= 18, `the Cut button is drawn at a size to read: ${box}`);
  await tapButton('#options .ochoose[data-choice="cut"]');
  assert.equal(await app.page.$eval('#options .ochoose[data-choice="cut"]', (b) => b.getAttribute("aria-pressed")), "true");
  await app.page.waitForTimeout(400);
  await shot("2a-cut-preview");
  await tapButton("#options .oact button.ok");
  assert.deepEqual(await modes(), ["new", "cut"]);
  const [b] = await settled();
  assert.ok(b.valid);
  assert.ok(b.faces.includes("e2.m0") && !b.faces.includes("e2.lid"), `a hole right through: ${b.faces}`);
  await type('lookAt("f1"); orbit(-0.6, -1.0)');
  await shot("2-hole");
});

test("on an iPhone: a circle on the side, ✓ with the default — a boss added; a dimension changed — rebuilt", { skip }, async () => {
  await type('lookAt("f1"); orbit(-0.25, -1.2)');
  await type("plane");
  await tapAt([10, -H, T / 2]);
  // Square to the wall now, which is only 8 deep: closer, so a finger's reach
  // starting the circle is on the wall and not on its edges.
  await type("zoom(2.5)");
  await shot("3a-on-the-wall");
  await type("circle");
  await dragOn([10, -H, T / 2], [12.5, -H, T / 2]);
  assert.equal((await app.model()).circles.length, 3, "a circle on the wall");
  await type("arm(\"extrude\", { depth: 6 })");
  await tapAt([10, -H, T / 2]);
  await app.page.waitForTimeout(400);
  await tapButton("#options .oact button.ok");
  assert.deepEqual(await modes(), ["new", "cut", "add"]);
  // On the side: the boss's profile centre on the wall, y = -H.
  const m = await app.model();
  const boss = m.circles[2];
  assert.ok(Math.abs(m.points[boss.center][1] + H) < 1e-6, `on the wall: ${m.points[boss.center]}`);
  let [b] = await settled();
  assert.deepEqual(b.features, ["e1", "e2", "e3"]);
  assert.ok(b.valid);
  await type('lookAt("f1"); orbit(-0.6, -1.0)');
  // The organiser's body row in a phone's narrow pane: its name whole, the
  // chain after it giving way (looked at: it once read "−e2 +e3 3", no e1).
  const row = await app.page.$eval('#organiser .osect[data-section="bodies"] .orow', (el) => {
    const name = el.querySelector(".oname") as HTMLElement;
    const r = name.getBoundingClientRect(), pane = el.getBoundingClientRect();
    return { text: name.textContent, clipped: name.scrollWidth > name.clientWidth + 1, inside: r.left >= pane.left && r.right <= pane.right };
  });
  assert.deepEqual(row, { text: "e1", clipped: false, inside: true }, "the body's name shown whole");
  await shot("3-boss");
  const before = b.volume;
  await type('set("d1.value", 12)');
  [b] = await settled();
  // A finger's rectangle is where the finger put it, not to the millimetre: the volume grows, by four of its depth.
  assert.ok(b.volume > before + 1000, `the plate thickened: ${before} → ${b.volume}`);
  assert.ok(b.faces.includes("e2.lid"), "the hole blind now");
  await shot("4-thicker");
  assert.deepEqual(app.pageErrors, []);
});
