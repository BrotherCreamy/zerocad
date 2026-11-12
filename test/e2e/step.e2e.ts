// STEP export in the running app (docs/plans/step-export.md): the app menu's
// Export STEP… and a typed exportStep() deliver a .step file — Playwright's
// download on a desktop, the share sheet (stubbed to record what it is
// handed) under iPhone 13 emulation — and with no solid the log says so and
// no file goes anywhere.
//
// What the file holds is the unit suite's to check (test/step.test.ts), and a
// real kernel's (test/fixtures/step/validated.json); this checks that the app
// gets it to a person, named and typed, through the menu and the command line.

import { test, after } from "node:test";
import assert from "node:assert/strict";
import { mkdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { openApp, type AppContext } from "./harness.ts";

/** Where pictures go when NEOCAD_E2E_SHOTS names a folder, to be looked at. */
const SHOTS = process.env.NEOCAD_E2E_SHOTS;

const opened: AppContext[] = [];
after(async () => { for (const app of opened) await app.close(); });

interface Shared { name: string; type: string; text: string }

/**
 * Before the app's first line: a share sheet that records the files it is
 * handed, or none at all (Linux Chromium has no Web Share; a desktop export
 * downloads whatever the sheet would do).
 */
function sheet(on: boolean) {
  const w = window as unknown as { __shared: unknown[] };
  w.__shared = [];
  const nav = navigator as unknown as Record<string, unknown>;
  if (!on) {
    delete nav.share;
    delete nav.canShare;
    return;
  }
  Object.defineProperty(navigator, "canShare", { configurable: true, value: (d: { files?: File[] }) => !!d?.files?.length });
  Object.defineProperty(navigator, "share", {
    configurable: true,
    value: async (d: { files: File[] }) => {
      for (const f of d.files) w.__shared.push({ name: f.name, type: f.type, text: await f.text() });
    },
  });
}

async function start(share: boolean, device?: "iPhone 13"): Promise<AppContext> {
  const app = await openApp({ device, init: { fn: sheet, arg: share } });
  opened.push(app);
  return app;
}

/** A 40 × 20 rectangle, extruded 10: one solid, e1. */
async function solid(app: AppContext): Promise<void> {
  await app.type("pt(0, 0); pt(40, 0); pt(40, 20); pt(0, 20)");
  await app.type('ln("p1", "p2"); ln("p2", "p3"); ln("p3", "p4"); ln("p4", "p1")');
  await app.type('extrude("l1", 10)');
  assert.equal(await app.status(), "SOLVED");
}

/** The file's text is a STEP file of one solid, e1. */
function isStep(text: string): void {
  assert.ok(text.startsWith("ISO-10303-21;\nHEADER;"), "a Part 21 file");
  assert.ok(text.includes("FILE_SCHEMA(('AUTOMOTIVE_DESIGN { 1 0 10303 214 1 1 1 1 }'));"), "AP214");
  assert.equal(text.match(/MANIFOLD_SOLID_BREP\('e1'/g)?.length, 1, "one body, named for the feature");
  assert.ok(text.trimEnd().endsWith("END-ISO-10303-21;"));
}

async function shot(app: AppContext, name: string): Promise<void> {
  if (!SHOTS) return;
  mkdirSync(SHOTS, { recursive: true });
  await app.page.screenshot({ path: join(SHOTS, `step-${name}.png`) });
}

test("the app menu's Export STEP… types exportStep() and downloads Untitled.step, a STEP file of the solid", async () => {
  const app = await start(false);
  await solid(app);
  await app.page.click("#logo");
  const item = '#appmenu .item[data-command="exportStep()"]';
  assert.equal(await app.page.$eval(item, (e) => e.classList.contains("off")), false, "on: the command exists");
  assert.match(await app.page.$eval(item, (e) => e.textContent ?? ""), /Export STEP…/);
  await shot(app, "1-menu");
  const [download] = await Promise.all([app.page.waitForEvent("download"), app.page.click(item)]);
  assert.equal(download.suggestedFilename(), "Untitled.step");
  isStep(readFileSync(await download.path(), "utf8"));
  const log = await app.log();
  assert.match(log, /> exportStep\(\)/, "typed through the command line, so the log shows it");
  assert.match(log, /downloaded Untitled\.step: e1 \(1 body\)/);
  assert.equal(await app.page.$eval("#appmenu", (m) => (m as HTMLElement).hidden), true, "and closed the menu");
  // A copy for another tool, not the document: nothing journalled, still unsaved.
  const doc = await app.page.evaluate(() =>
    (window as unknown as { __neocad: { files: { document(): { name: string; dirty: boolean } } } }).__neocad.files.document());
  assert.deepEqual(doc, { name: "Untitled", dirty: true });
  assert.deepEqual(app.pageErrors, []);
});

test("typed, exportStep(\"bracket\", { curves: true }) downloads bracket.step with the loose sketch curves beside the solid", async () => {
  const app = await start(false);
  await solid(app);
  // The extrude's twins and walls took the next names, so ask what these get.
  const line = (await app.repl("ln(pt(0, 40), pt(30, 50))")).value as string;
  const [download] = await Promise.all([app.page.waitForEvent("download"), app.type('exportStep("bracket", { curves: true })')]);
  assert.equal(download.suggestedFilename(), "bracket.step");
  const text = readFileSync(await download.path(), "utf8");
  isStep(text);
  assert.equal(text.match(new RegExp(`TRIMMED_CURVE\\('${line}'`, "g"))?.length, 1, `the loose line, by its name ${line}`);
  assert.equal(text.match(/TRIMMED_CURVE\(/g)?.length, 1, "and none of the solid's own edges");
  assert.match(await app.log(), /downloaded bracket\.step: e1 \(1 body\); 1 loose curve/);
  assert.deepEqual(app.pageErrors, []);
});

test("on an iPhone, exportStep() goes to the share sheet: one model/step file, named for the document", async () => {
  const app = await start(true, "iPhone 13");
  await solid(app);
  await app.type("exportStep()");
  await app.page.waitForFunction(() => (window as unknown as { __shared: unknown[] }).__shared.length === 1);
  const [file] = await app.page.evaluate(() => (window as unknown as { __shared: Shared[] }).__shared);
  assert.equal(file.name, "Untitled.step");
  assert.equal(file.type, "model/step");
  isStep(file.text);
  assert.match(await app.log(), /exported Untitled\.step — through the share sheet: e1 \(1 body\)/);
  await shot(app, "2-phone");
  assert.deepEqual(app.pageErrors, []);
});

test("with no solid, Export STEP… says so in the log and no file goes anywhere — no download, no share", async () => {
  for (const phone of [false, true]) {
    const app = await start(phone, phone ? "iPhone 13" : undefined);
    let downloads = 0;
    app.page.on("download", () => { downloads++; });
    await app.type("pt(0, 0); pt(40, 0)");
    await app.type('ln("p1", "p2")');
    if (phone) await app.type("exportStep()");
    else {
      await app.page.click("#logo");
      await app.page.click('#appmenu .item[data-command="exportStep()"]');
    }
    await app.page.waitForTimeout(500);
    assert.match(await app.log(), /there is no solid to export — extrude or revolve a region first/);
    assert.equal(downloads, 0, "nothing downloaded");
    assert.deepEqual(await app.page.evaluate(() => (window as unknown as { __shared: unknown[] }).__shared), [], "nothing shared");
    if (!phone) await shot(app, "3-none");
  }
});
