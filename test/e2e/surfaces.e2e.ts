// Surfaces in a browser, with a mouse (docs/plans/surfaces.md): the owner's
// "please add solid and surface fillet tools if possible" and "also fillets and
// chamfers for surfaces". A rectangle drawn on the ground; its face made a
// planar surface with the surface tool; a circle drawn inside it and the
// surface trimmed by it with the trim tool; a wall swept up from the
// rectangle's front edge; the two knitted from the surface's own menu; the
// join filleted with the round tool, previewed; the knit thickened into a
// solid; STEP exported. Each step checked against the closed form, and looked
// at: set NEOCAD_E2E_SHOTS to keep the pictures.
//
// No fixed sleeps: every step polls for the state it waits on (the kernel's
// answer, the record, the menu), and a picture waits for two frames.
//
// One app, tests in order: the states are cumulative. Skips, saying so,
// without a kernel build.

import { test, before, after } from "node:test";
import assert from "node:assert/strict";
import { existsSync, mkdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { openApp, type AppContext } from "./harness.ts";

const built = existsSync(new URL("../../src/solids/smlib-gen/smlib.mjs", import.meta.url));
const skip = built ? false : "no SMLib build — run `npm run build:solids`";

let app: AppContext;
before(async () => { if (built) app = await openApp(); });
after(async () => {
  if (!built) return;
  assert.deepEqual(app.pageErrors, [], "nothing the page threw went uncaught");
  await app.close();
});

/** Two animation frames: what was asked to draw has drawn. */
const frames = () => app.page.evaluate(() => new Promise<void>((r) => requestAnimationFrame(() => requestAnimationFrame(() => r()))));

const SHOTS = process.env.NEOCAD_E2E_SHOTS;
async function shot(name: string, keepMouse = false): Promise<void> {
  if (!SHOTS) return;
  mkdirSync(SHOTS, { recursive: true });
  if (!keepMouse) await app.page.mouse.move(2, 2);
  await frames();
  await app.page.screenshot({ path: join(SHOTS, `surfaces-desktop-${name}.png`) });
}

type View = { name: string; result: { solid: { volume: number; validity: { manifold: boolean; failures: number };
  faces: { name: string; area: number }[]; edges: { name: string; lamina: boolean }[] } } };
type Neo = {
  __neocad: {
    bodies: { settled: boolean; views(): View[]; trialAnswer(): { settled: boolean; why: string | null }; report(): { lines: string[] } };
    model: { surfaces: Map<string, { name: string; kind: string; into?: string; with?: string[]; edges?: string[] }> };
    engine: { active: { name: string } | null };
  };
};

/** The surfaces' views once the kernel has answered for the model as it is. */
async function settled(): Promise<{ name: string; area: number; volume: number; manifold: boolean; failures: number; faces: string[]; shared: string[] }[]> {
  await app.page.waitForFunction(() => (window as never as Neo).__neocad.bodies.settled, undefined, { timeout: 30_000 });
  return app.page.evaluate(() => (window as never as Neo).__neocad.bodies.views().map((v) => ({
    name: v.name,
    area: v.result.solid.faces.reduce((a, f) => a + f.area, 0),
    volume: v.result.solid.volume,
    manifold: v.result.solid.validity.manifold,
    failures: v.result.solid.validity.failures,
    faces: [...new Set(v.result.solid.faces.map((f) => f.name))].sort(),
    shared: [...new Set(v.result.solid.edges.filter((e) => !e.lamina).map((e) => e.name))].sort(),
  })));
}

/** Polls until the model has a surface record of this name. */
async function record(name: string): Promise<{ name: string; kind: string; into?: string; with?: string[]; edges?: string[] }> {
  await app.page.waitForFunction((n) => (window as never as Neo).__neocad.model.surfaces.has(n), name, { timeout: 10_000 });
  return app.page.evaluate((n) => {
    const s = (window as never as Neo).__neocad.model.surfaces.get(n)!;
    return { name: s.name, kind: s.kind, into: s.into, with: s.with, edges: s.edges };
  }, name);
}

async function point(world: number[]): Promise<{ x: number; y: number }> {
  const [sx, sy] = await app.screenOf(world);
  return app.at(sx, sy);
}

async function hoverAt(world: number[]): Promise<void> {
  const at = await point(world);
  await app.page.mouse.move(at.x - 4, at.y - 4);
  await app.page.mouse.move(at.x, at.y, { steps: 3 });
  await frames();
}

async function clickAt(world: number[]): Promise<void> {
  await hoverAt(world);
  await app.page.mouse.down();
  await app.page.mouse.up();
  await frames();
}

async function drag(a: number[], b: number[]): Promise<void> {
  const p = await point(a), q = await point(b);
  await app.page.mouse.move(p.x, p.y);
  await app.page.mouse.down();
  await app.page.mouse.move(q.x, q.y, { steps: 8 });
  await app.page.mouse.up();
  await frames();
}

/** Enter on an empty command line: the armed tool's ✓. Then Escape, letting the tool go. */
async function confirm(): Promise<void> {
  await app.page.fill("#cmd", "");
  await app.page.keyboard.press("Enter");
  await frames();
  await app.page.keyboard.press("Escape");
  await frames();
}

/** Right-clicks at a world point and answers the menu's items, waiting for it to open. */
async function menuAt(world: number[]): Promise<{ head: string; items: string[] }> {
  const at = await point(world);
  await app.page.mouse.move(at.x, at.y);
  await app.page.mouse.down({ button: "right" });
  await app.page.mouse.up({ button: "right" });
  await app.page.waitForFunction(() => !(document.querySelector("#ctxmenu") as HTMLElement).hidden);
  return app.page.$eval("#ctxmenu", (el) => ({
    head: el.querySelector(".head")?.textContent ?? "",
    items: Array.from(el.querySelectorAll(".item")).map((i) => i.firstElementChild?.textContent ?? ""),
  }));
}

async function menuItem(label: string): Promise<void> {
  await app.page.locator("#ctxmenu .item", { hasText: label }).first().click();
  await app.page.waitForFunction(() => (document.querySelector("#ctxmenu") as HTMLElement).hidden);
}

const typed = () => app.page.$$eval("#log .in", (els) => els.map((e) => (e.textContent ?? "").replace(/^> /, "")));
const near = (a: number, b: number, rel = 1e-6) => Math.abs(a - b) <= rel * Math.max(1, Math.abs(b));

// The rectangle 60 × 40 on the ground, a hole r 6 at (10, 0), a wall 15 up off the front edge (y = −20).
const W = 30, H = 20, R = 6, CX = 10, UP = 15, F = 4, T = 2, C = 3;
const plate = 4 * W * H - Math.PI * R * R;

test("a rectangle's face, clicked with the surface tool: a planar surface s1, its area the rectangle's", { skip }, async () => {
  await app.type("plane()");
  await app.type("rectangle");
  await drag([-W, -H, 0], [W, H, 0]);
  await app.type("orbit(-0.5, -0.9); zoom(1.4)");
  await app.type("arm(\"surface\")");
  await clickAt([-W / 2, H / 2, 0]);
  await shot("1-face-picked", true);
  await confirm();
  const s1 = await record("s1");
  assert.equal(s1.kind, "planar");
  const s = await settled();
  assert.equal(s.length, 1);
  assert.equal(s[0].name, "s1");
  assert.ok(near(s[0].area, 4 * W * H), `area ${s[0].area}`);
  assert.equal(s[0].manifold, false, "a sheet: no inside");
  assert.ok((await typed()).some((l) => /^surface\("l\d+"\)$/.test(l)), "the confirm typed surface(member)");
  await shot("2-planar-surface");
});

test("a circle drawn on it, and the trim tool: pressed where it is kept, then the circle — a hole, 2400 − 36π", { skip }, async () => {
  await app.type(`circle(pt(${CX}, 0, 0), ${R})`);
  await app.type("arm(\"trim\")");
  await clickAt([-W / 2, H / 2, 0]);
  await shot("3-trim-holds-the-surface", true);
  await clickAt([CX + R, 0, 0]);
  const s2 = await record("s2");
  assert.equal(s2.kind, "trim");
  assert.equal(s2.into, "s1");
  const s = await settled();
  assert.ok(near(s[0].area, plate, 1e-5), `area ${s[0].area} against ${plate}`);
  assert.ok((await typed()).some((l) => /^trim\("s1", "c\d+", \[/.test(l)), "the tool typed trim(surface, curve, point)");
  await app.page.keyboard.press("Escape");
  await shot("4-trimmed");
});

test("a wall swept up off the front edge — the surface tool, chain off, a curve clicked — and knitted from the menu", { skip }, async () => {
  await app.type(`arm("surface", { depth: ${UP}, chain: false })`);
  await clickAt([0, -H, 0]);
  await shot("5-wall-preview", true);
  await confirm();
  const s3 = await record("s3");
  assert.equal(s3.kind, "extrude");
  let s = await settled();
  assert.deepEqual(s.map((x) => x.name), ["s1", "s3"]);
  assert.ok(near(s.find((x) => x.name === "s3")!.area, 2 * W * UP));
  // The planar surface's own menu, on a right-click.
  const m = await menuAt([-W / 2, H / 2, 0]);
  assert.match(m.head, /^s1 /);
  for (const want of ["Thicken…", "Offset…", "Knit with s3", "Solidify", "Delete"]) assert.ok(m.items.includes(want), `${want} in ${m.items}`);
  await menuItem("Knit with s3");
  const s4 = await record("s4");
  assert.equal(s4.kind, "knit");
  assert.deepEqual(s4.with, ["s3"]);
  s = await settled();
  assert.deepEqual(s.map((x) => x.name), ["s1"], "s3 is part of s1 now: one sheet");
  assert.ok(near(s[0].area, plate + 2 * W * UP, 1e-5));
  assert.equal(s[0].shared.length, 1, `one shared edge, the join: ${s[0].shared}`);
  assert.match(s[0].shared[0], /^s1\.base\|s3\.m0$|^s3\.m0\|s1\.base$/);
  await shot("6-knitted");
});

/** The model's size, to undo back to: its surface records and entities. */
const counts = () => app.page.evaluate(() => {
  const m = (window as never as { __neocad: { model: { surfaces: Map<string, unknown>; entities: Map<string, unknown> } } }).__neocad.model;
  return `${m.surfaces.size}/${m.entities.size}`;
});

/** Ctrl+Z until the model is back to `want`, polling after each for the step to land. */
async function undoTo(want: string): Promise<void> {
  for (let i = 0; i < 8 && (await counts()) !== want; i++) {
    const was = await counts();
    await app.page.fill("#cmd", "");
    await app.page.keyboard.press("Control+z");
    await app.page.waitForFunction(([w, f]) => {
      const m = (window as never as { __neocad: { model: { surfaces: Map<string, unknown>; entities: Map<string, unknown> } } }).__neocad.model;
      const now = `${m.surfaces.size}/${m.entities.size}`;
      return now !== w || now === f;
    }, [was, want] as const, { timeout: 10_000 });
  }
  assert.equal(await counts(), want, "undone back to the knitted sheet");
}

test("the join chamfered with the chamfer tool from the modify group: the setback typed, previewed, ✓ — chamferSurfaces, the closed form; a trim of the wall's name is s1's", { skip }, async () => {
  const knitted = (await settled())[0].area;
  const back = await counts();
  // Armed from the modify group's flyout, as a mouse does it: a hover opens it, a click on the item arms.
  const b = await app.page.$eval('#toolbar button[data-group="modify"]', (el) => { const r = el.getBoundingClientRect(); return [r.x + r.width / 2, r.y + r.height / 2]; });
  await app.page.mouse.move(700, 300);
  await app.page.mouse.move(b[0], b[1], { steps: 2 });
  await app.page.waitForFunction(() => {
    const f = document.querySelector("#flyout") as HTMLElement;
    return !f.hidden && f.dataset.group === "modify";
  });
  await app.page.click('#flyout button[data-tool="chamfer"]');
  await app.page.waitForFunction(() => (window as never as Neo).__neocad.engine.active?.name === "chamfer");
  // The setback from the options panel.
  await app.page.click('#options input.oval[data-option="setback"]', { clickCount: 3 });
  await app.page.keyboard.type(String(C));
  await app.page.waitForFunction((c) => (document.querySelector('#options input.oval[data-option="setback"]') as HTMLInputElement).value === String(c), C);
  await hoverAt([0, -H, 0]);
  await clickAt([0, -H, 0]);
  await app.page.waitForFunction(() => (window as never as Neo).__neocad.bodies.trialAnswer().settled, undefined, { timeout: 30_000 });
  assert.equal(await app.page.evaluate(() => (window as never as Neo).__neocad.bodies.trialAnswer().why), null, "the preview is the kernel's, refused by nothing");
  await shot("7a-chamfer-preview", true);
  await app.page.click("#options .oact button.ok");
  const s5 = await record("s5");
  assert.equal(s5.kind, "chamfer");
  assert.equal(s5.edges?.length, 1);
  const entry = await app.page.evaluate(() => {
    const j = (window as never as { __neocad: { model: { journal: { op: string; args: unknown[] }[] } } }).__neocad.model.journal;
    return j.filter((e) => e.op === "chamferSurfaces").at(-1) ?? null;
  });
  assert.ok(entry, "journalled as chamferSurfaces — neither the sketch's chamfer nor the solid's");
  assert.equal(entry.args[0], "s1");
  assert.equal(entry.args[2], C, `its setback, ${C}: ${JSON.stringify(entry.args)}`);
  const s = await settled();
  // Each side cut back C along 2W of join, a flat C√2 wide in its place — the unit test's closed form and tolerance.
  const expect = knitted - 2 * C * 2 * W + Math.SQRT2 * C * 2 * W;
  assert.ok(near(s[0].area, expect, 1e-6), `area ${s[0].area} against ${expect}`);
  assert.ok(s[0].faces.includes("s5.f0"), `the chamfer's face is s5's: ${s[0].faces}`);
  // s3, the wall, is part of s1: a trim of it is recorded as s1's.
  await app.page.keyboard.press("Escape");
  await app.type(`line(pt(${W - 6}, ${-H - 5}, 0), pt(${W - 6}, ${H + 5}, 0))`);
  const lineName = await app.page.evaluate(() => {
    const m = (window as never as { __neocad: { model: { entities: Map<string, { kind: string }> } } }).__neocad.model;
    return [...m.entities.entries()].filter(([, e]) => e.kind === "line").at(-1)![0];
  });
  await app.type(`trim("s3", "${lineName}", [${-W / 2}, ${H / 2}, 0])`);
  const s6 = await record("s6");
  assert.equal(s6.kind, "trim");
  assert.equal(s6.into, "s1", "the knitted wall's name answers for the sheet it is part of");
  assert.deepEqual((await settled()).map((x) => x.name), ["s1"]);
  // Back to the knitted sheet for the fillet that follows: the names counted again from s5.
  await undoTo(back);
  assert.ok(near((await settled())[0].area, knitted), "the knitted area again");
});

test("the join filleted with the round tool: clicked, previewed, ✓ — the closed form, one record", { skip }, async () => {
  await app.type(`arm("round", { radius: ${F} })`);
  await hoverAt([0, -H, 0]);
  await clickAt([0, -H, 0]);
  await app.page.waitForFunction(() => (window as never as Neo).__neocad.bodies.trialAnswer().settled, undefined, { timeout: 30_000 });
  assert.equal((await app.page.evaluate(() => (window as never as Neo).__neocad.bodies.trialAnswer().why)), null);
  await shot("7-fillet-preview");
  await confirm();
  const s5 = await record("s5");
  assert.equal(s5.kind, "fillet");
  assert.equal(s5.edges?.length, 1);
  const s = await settled();
  const expect = plate + 2 * W * UP - 2 * F * 2 * W + (Math.PI / 2) * F * 2 * W;
  assert.ok(near(s[0].area, expect, 1e-5), `area ${s[0].area} against ${expect}`);
  assert.ok(s[0].faces.includes("s5.f0"), `the fillet's face is s5's: ${s[0].faces}`);
  assert.ok((await typed()).some((l) => /^fillet\("s1", \["[^"]+"\], 4\)$/.test(l)), "✓ typed fillet(surface, [edge], r)");
  await shot("8-filleted");
});

test("thickened from the menu: Thicken… types up to the number; the solid's volume is the sheet's area by the thickness", { skip }, async () => {
  const before = (await settled())[0].area;
  await menuAt([-W / 2, H / 2, 0]);
  await menuItem("Thicken…");
  assert.equal(await app.page.inputValue("#cmd"), 'thicken("s1", ');
  await app.page.focus("#cmd");
  await app.page.keyboard.type(`${T})`);
  await app.page.keyboard.press("Enter");
  const s6 = await record("s6");
  assert.equal(s6.kind, "thicken");
  const s = await settled();
  assert.equal(s[0].manifold, true, "a solid now");
  assert.equal(s[0].failures, 0);
  // The flat parts are their area by T exactly; the fillet's quarter cylinder,
  // thickened off its convex side or into its concave one, is
  // (π/2)·L·((F ± T)² − F²)/2 — its area by T, ± (π/2)·L·T²/2.
  const curl = (Math.PI / 2) * (2 * W) * T * T / 2;
  const outward = before * T + curl, inward = before * T - curl;
  assert.ok(near(s[0].volume, outward, 1e-5) || near(s[0].volume, inward, 1e-5), `volume ${s[0].volume} against ${outward} or ${inward}`);
  await shot("9-thickened");
});

test("exported: a STEP file with the solid in it, the surface's chain its body", { skip }, async () => {
  const [download] = await Promise.all([app.page.waitForEvent("download"), app.type('exportStep("surfaces")')]);
  assert.equal(download.suggestedFilename(), "surfaces.step");
  const text = readFileSync(await download.path(), "utf8");
  assert.match(text, /MANIFOLD_SOLID_BREP\('s1'/);
  assert.match(await app.log(), /downloaded surfaces\.step: s1 \(1 body\)/);
});

test("one undo takes the thicken back: a sheet again, exported as a surface model", { skip }, async () => {
  await app.page.fill("#cmd", "");
  await app.page.keyboard.press("Control+z");
  await app.page.waitForFunction(() => !(window as never as Neo).__neocad.model.surfaces.has("s6"));
  const s = await settled();
  assert.equal(s[0].manifold, false);
  const [download] = await Promise.all([app.page.waitForEvent("download"), app.type('exportStep("sheet")')]);
  const text = readFileSync(await download.path(), "utf8");
  assert.match(text, /SHELL_BASED_SURFACE_MODEL\('s1'/);
  assert.match(text, /OPEN_SHELL/);
  assert.match(text, /MANIFOLD_SURFACE_SHAPE_REPRESENTATION/);
});
