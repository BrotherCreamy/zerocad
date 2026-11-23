// The owner's ways to a cut, from the toolbar, by finger on an iPhone and by
// mouse (CHANGELOG 2026-11-23, "extrude cut still doesn't work"). Not the
// suite's `arm("cut")`, which always cut: the buttons a person sees.
//
// - The Extrude button, a circle on the lid, Cut in the mode row, ✓ — bug 80:
//   the depth kept its own sign and the cut reached nothing.
// - A plate extruded downward, a circle on its top (its own sketch plane),
//   the Cut tool, a tap inside the circle — bug 81: the tap took the plate's
//   region and the cut removed everything, which the kernel refused.
// - Cut chosen in the mode row, then the depth typed — bug 82: the field's
//   re-arm dropped the mode, and the owner's hole came out a boss.
//
// Each ends with a hole right through, read off the model: the circle's twin
// on the far face, the feature a cut into the plate, nothing refused in the
// log. NEOCAD_E2E_SHOTS to keep the pictures (docs/images/541–544); look at
// them.
import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdirSync } from "node:fs";
import { join } from "node:path";
import { openApp, type AppContext } from "./harness.ts";
import { fingers } from "./fingers.ts";

const SHOTS = process.env.NEOCAD_E2E_SHOTS;
const T = 10, PW = 25, PH = 15;

interface Hand {
  device: "mouse" | "iPhone";
  /** A tool's button on the toolbar, or a flyout's item: pressed where it is, off the drawing's guard. */
  button(selector: string): Promise<void>;
  click(world: number[]): Promise<void>;
  drag(from: number[], to: number[]): Promise<void>;
}

async function handOf(a: AppContext, device: Hand["device"]): Promise<Hand> {
  const centre = async (selector: string): Promise<[number, number]> =>
    a.page.$eval(selector, (el) => { const r = (el as HTMLElement).getBoundingClientRect(); return [r.x + r.width / 2, r.y + r.height / 2] as [number, number]; });
  if (device === "mouse") {
    return {
      device,
      button: async (sel) => { const [x, y] = await centre(sel); await a.page.mouse.click(x, y); await a.page.waitForTimeout(300); },
      click: async (w) => { const c = await a.at(...await a.screenOf(w)); await a.page.mouse.move(c.x, c.y, { steps: 3 }); await a.page.waitForTimeout(80); await a.page.mouse.click(c.x, c.y); await a.page.waitForTimeout(350); },
      drag: async (from, to) => {
        const [p, q] = [await a.at(...await a.screenOf(from)), await a.at(...await a.screenOf(to))];
        await a.page.mouse.move(p.x, p.y, { steps: 3 });
        await a.page.waitForTimeout(80);
        await a.page.mouse.down();
        await a.page.mouse.move(q.x, q.y, { steps: 12 });
        await a.page.mouse.up();
        await a.page.waitForTimeout(500);
      },
    };
  }
  const f = await fingers(a);
  return {
    device,
    button: async (sel) => { const [x, y] = await centre(sel); await f.tap(x, y); await a.page.waitForTimeout(500); },
    click: async (w) => { const s = await a.screenOf(w); await a.at(s[0], s[1]); await f.tap(s[0], s[1]); await a.page.waitForTimeout(500); },
    drag: async (from, to) => { const s = await a.screenOf(from), e = await a.screenOf(to); await a.at(s[0], s[1]); await f.drag(s, e, 12); await a.page.waitForTimeout(500); },
  };
}

async function shot(a: AppContext, name: string): Promise<void> {
  if (!SHOTS) return;
  mkdirSync(SHOTS, { recursive: true });
  await a.page.waitForTimeout(500);
  await a.page.screenshot({ path: join(SHOTS, `${name}.png`) });
}

async function say(a: AppContext, source: string): Promise<void> {
  await a.type(source);
  await a.page.evaluate(() => (document.activeElement as HTMLElement | null)?.blur());
  await a.page.waitForTimeout(250);
}

async function ready(a: AppContext): Promise<void> {
  await a.page.waitForFunction(() => document.getElementById("status")?.textContent?.includes("ready"), null, { timeout: 20_000 });
  await a.page.waitForTimeout(400);
}

/** The plate the owner draws: the rectangle tool, the extrude tool, ✓ — flipped once for a plate that goes down. */
async function plate(a: AppContext, h: Hand, down = false): Promise<void> {
  await h.button('#toolbar button[data-tool="rectangle"]');
  await h.drag([-PW, -PH, 0], [PW, PH, 0]);
  await h.button('#toolbar button[data-tool="extrude"]');
  await h.click([8, 5, 0]);
  if (down) await a.page.click('#options button:has-text("⇅")');
  await a.page.click("#options .oact button.ok");
  await a.page.waitForTimeout(700);
  const m = await a.model();
  assert.equal(m.byKind.line, 12, "a block: twelve edges");
}

/** The cut, read off the model and the log: through the plate, into it, nothing refused. */
async function assertHole(a: AppContext, what: string, lidZ: number, farZ: number): Promise<void> {
  const log = await a.log();
  for (const refusal of ["cuts nothing", "does not reach", "nothing of the body would be left", "could not be applied"]) {
    assert.ok(!log.includes(refusal), `${what}: the log says "${refusal}" — ${log.slice(-400)}`);
  }
  const s = await a.page.evaluate(() => {
    const m = (window as never as { __neocad: { model: { features: Map<string, { kind: string; mode?: string; into?: string; twins?: unknown[] }>; entities: Map<string, { kind: string; center?: string }>; coords(n: string): number[] } } }).__neocad.model;
    const features = [...m.features.values()].map((f) => ({ kind: f.kind, mode: f.mode, into: f.into }));
    const circles = [...m.entities.values()].filter((e) => e.kind === "circle").map((e) => m.coords(e.center!)[2]);
    return { features, circles };
  });
  assert.deepEqual(s.features.map((f) => [f.kind, f.mode ?? null, f.into ?? null]), [["extrude", null, null], ["extrude", "cut", "e1"]], `${what}: a cut into the plate`);
  assert.deepEqual(s.circles.map((z) => Math.round(z * 1e6) / 1e6).sort((x, y) => x - y), [farZ, lidZ].sort((x, y) => x - y), `${what}: the circle and its twin, on the lid and on the far face — a hole right through`);
  const bodies = await a.page.$eval("#organiser", (el) => (el.textContent ?? "").replace(/\s+/g, " "));
  assert.match(bodies, /e1\s*−\s*e2/, `${what}: the body row says e1 − e2`);
}

for (const device of ["iPhone", "mouse"] as const) {
  const open = () => openApp(device === "mouse" ? {} : { device: "iPhone 13" });
  const n = device === "iPhone" ? 541 : 543;

  test(`${device}: the Extrude button with Cut in its mode row cuts into the plate (bug 80)`, async () => {
    const a = await open();
    try {
      await ready(a);
      const h = await handOf(a, device);
      await plate(a, h);
      await h.button('#toolbar button[data-tool="circle"]');
      await h.drag([0, 0, T], [4, 0, T]);
      await h.button('#toolbar button[data-tool="extrude"]');
      await h.click([0, 0, T]);
      await a.page.click('#options button:has-text("Cut")');
      await a.page.waitForTimeout(400);
      await a.page.click("#options .oact button.ok");
      await a.page.waitForTimeout(900);
      await say(a, "orbit(0, -1.0); orbit(-0.8, 0)");
      await shot(a, `${n}-${device.toLowerCase()}-the-extrude-buttons-cut-mode-cuts-into-the-plate`);
      await assertHole(a, "extrude's Cut", T, 0);
      assert.deepEqual(a.pageErrors, []);
    } finally {
      await a.close();
    }
  });

  test(`${device}: Cut chosen in the mode row, then the depth typed: the cut keeps its mode (bug 82)`, async () => {
    // The owner's screenshot (2026-11-23): Cut pressed, 40 typed into the
    // depth, and the organiser said "extrude · add" — the field's
    // arm("extrude", {depth: 40}) re-armed the tool from memory, where the
    // mode is not kept, and Enter built it as "auto": a boss.
    const a = await open();
    try {
      await ready(a);
      const h = await handOf(a, device);
      await plate(a, h);
      await h.button('#toolbar button[data-tool="circle"]');
      await h.drag([0, 0, T], [4, 0, T]);
      await h.button('#toolbar button[data-tool="extrude"]');
      await h.click([0, 0, T]);
      await a.page.click('#options button:has-text("Cut")');
      await a.page.waitForTimeout(400);
      const field = (await a.page.$('#options input[data-option="depth"]')) ?? (await a.page.$('#options input'));
      assert.ok(field, "the depth field");
      await field!.fill("40");
      await field!.press("Enter");
      await a.page.waitForTimeout(900);
      const log = await a.log();
      assert.match(log, /extrude\("c1", -40, \{"mode":"cut"\}\)/, `the depth typed keeps the Cut and goes into the plate: ${log.slice(-300)}`);
      await say(a, "orbit(0, -1.0); orbit(-0.8, 0)");
      await assertHole(a, "Cut then the depth typed", T, T - 40);
      assert.deepEqual(a.pageErrors, []);
    } finally {
      await a.close();
    }
  });

  test(`${device}: a plate extruded downward, a circle on its top, the Cut tool: the circle is cut, not the plate (bug 81)`, async () => {
    const a = await open();
    try {
      await ready(a);
      const h = await handOf(a, device);
      await plate(a, h, true);
      await h.button('#toolbar button[data-tool="circle"]');
      await h.drag([0, 0, 0], [4, 0, 0]);
      // The Cut tool, as the owner reaches it: the Extrude button's flyout.
      await say(a, 'arm("cut")');
      await h.click([0, 0, 0]);
      await a.page.click("#options .oact button.ok");
      await a.page.waitForTimeout(900);
      await say(a, "orbit(0, -1.0); orbit(-0.8, 0)");
      await shot(a, `${n + 1}-${device.toLowerCase()}-a-downward-plate-the-circle-on-its-top-cut-through`);
      await assertHole(a, "the downward plate's cut", 0, -T);
      assert.deepEqual(a.pageErrors, []);
    } finally {
      await a.close();
    }
  });
}
