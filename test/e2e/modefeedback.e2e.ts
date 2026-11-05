// Mode feedback in a browser (docs/plans/mode-feedback.md; the owner: "it
// isnt obvious to me that is whats happening. needs clearer visual/contextual
// feedback to the user").
//
// With a mouse: the sketch tool clicked on a plate's lid sets the plane, and
// the lid is tinted and the chip says `on e1's top`; turned, and turned to look
// from below, the tint is still drawn (fainter from behind); the chip's Done
// ends the plane and leaves the camera; its plane menu offers Look at, Change…
// and Done; the ghost of the next point is at the cursor; the fillet tool
// lights the corners it can take; a miss is answered in the chip, not the
// status; what is not held on the plane is drawn dimmed; the tool's name opens
// its options. Under a finger (iPhone 13, both ways up): the same chip, Done
// in one tap, the lifted mark over the finger, and the chip over no pane. The
// chip over no pane on every phone of the device table is fits.e2e.ts's.
//
// Set NEOCAD_E2E_SHOTS to a directory to keep the pictures; look at them —
// this package is about what is seen.

import { test, before, after } from "node:test";
import assert from "node:assert/strict";
import { mkdirSync } from "node:fs";
import { join } from "node:path";
import { openApp, forgetAutosave, type AppContext } from "./harness.ts";
import { fingers } from "./fingers.ts";

const SHOTS = process.env.NEOCAD_E2E_SHOTS;
async function shot(app: AppContext, name: string): Promise<void> {
  if (!SHOTS) return;
  mkdirSync(SHOTS, { recursive: true });
  await app.page.waitForTimeout(150);
  await app.page.screenshot({ path: join(SHOTS, `modefeedback-${name}.png`) });
}

/** What the chip says, part by part. */
const chip = (app: AppContext) => app.page.$eval("#mode", (el) => {
  const d = (el as HTMLElement).dataset;
  return { where: d.where ?? "", what: d.what ?? "", next: d.next ?? "", guiding: d.guiding === "true" };
});

/** An 80 × 50 plate 20 deep on the ground; its lid's corners are p5…p8. */
async function plate(app: AppContext): Promise<void> {
  await app.type("pt(-40,-25,0); pt(40,-25,0); pt(40,25,0); pt(-40,25,0)");
  await app.type('ln("p1","p2"); ln("p2","p3"); ln("p3","p4"); ln("p4","p1")');
  await app.type('extrude("l1", 20)');
}

async function fresh(app: AppContext): Promise<void> {
  await app.page.evaluate(() => localStorage.clear());
  await forgetAutosave(app.page);
  await app.page.reload({ waitUntil: "networkidle" });
  await app.page.waitForFunction(() => document.getElementById("status")?.textContent?.includes("ready"), null, { timeout: 20_000 });
}

async function clickAt(app: AppContext, sx: number, sy: number): Promise<void> {
  const at = await app.at(sx, sy);
  await app.page.mouse.click(at.x, at.y);
  await app.page.waitForTimeout(200);
}

/** The plane's tint at a pixel: the drawing canvas, green over nothing else. */
async function tint(app: AppContext, world: number[]): Promise<number[]> {
  const [x, y] = await app.screenOf(world);
  return app.pixel(x + 0.5, y + 0.5, "drawing");
}
const greenish = ([r, g, b, a]: number[]) => a > 0 && g > r + 10 && g > b;

// --- with a mouse ---------------------------------------------------------------

let app: AppContext;
before(async () => { app = await openApp(); });
after(async () => { await app.close(); });

test("the sketch tool clicked on the lid: the lid tinted, the chip says on e1's top · select · …, one typed line", async () => {
  await plate(app);
  assert.deepEqual(await chip(app), { where: "", what: "select", next: "click a thing, or drag to box", guiding: false },
    "no plane: the chip's first part is empty — drawing on the ground is not a mode");
  assert.equal((await tint(app, [0, 0, 20]))[3], 0, "and nothing is tinted");
  await app.page.click('#toolbar button[data-tool="sketch"]');
  assert.equal((await chip(app)).next, "click inside a lit face to sketch on it");
  const [x, y] = await app.screenOf([0, 0, 20]);
  await clickAt(app, x, y);
  assert.match(await app.log(), /> workplane\("p\d+\.p\d+\.p\d+"\)/, "typed, as the sketch tool always has");
  const c = await chip(app);
  assert.equal(c.where, "on e1's top");
  assert.ok(greenish(await tint(app, [5, 5, 20])), "the lid is tinted");
  await shot(app, "sketch-on-the-lid");
  assert.deepEqual(app.pageErrors, []);
});

test("turned, the tint is still there; seen from below, fainter — the lid is behind the plate", async () => {
  await app.type("orbit(0.6, 0.5)");
  const front = await tint(app, [5, 5, 20]);
  assert.ok(greenish(front), `turned: still tinted, ${front}`);
  await shot(app, "turned");
  await app.type("orbit(0, 2.4)");
  const behind = await tint(app, [5, 5, 20]);
  assert.ok(behind[3] > 0 && behind[3] < front[3], `from behind it is fainter: ${behind[3]} under ${front[3]}`);
  assert.equal((await chip(app)).where, "on e1's top", "and the chip still says where");
  await shot(app, "from-below");
  await app.type("orbit(0, -2.4)");
});

test("a circle armed: the chip says the stage — press at the centre, drag the radius — and a ghost dot is at the cursor", async () => {
  await app.type("lookAt(workplane())");
  await app.page.click('#toolbar button[data-tool="circle"]');
  assert.equal((await chip(app)).what, "circle");
  assert.equal((await chip(app)).next, "press at the centre, or click 3 points");
  const [x, y] = await app.screenOf([-15, 5, 20]);
  const at = await app.at(x, y);
  await app.page.mouse.move(at.x - 10, at.y - 10);
  await app.page.mouse.move(at.x, at.y, { steps: 2 });
  await app.page.waitForTimeout(100);
  const ghost = await app.pixel(x + 0.5, y + 0.5, "drawing");
  assert.ok(greenish(ghost) && ghost[3] > 60, `the ghost of the point a click would place: ${ghost}`);
  await app.page.mouse.down();
  await app.page.mouse.move(at.x + 20, at.y, { steps: 4 });
  assert.equal((await chip(app)).next, "drag the radius");
  await shot(app, "drag-the-radius");
  await app.page.mouse.up();
  await app.page.waitForTimeout(200);
  assert.equal((await app.model()).byKind.circle, 1);
  assert.equal((await chip(app)).next, "press at the centre, or click 3 points", "the next circle");
});

test("what is held on the plane is in full ink, the rest one step dimmed — drawing only, the pick unchanged", async () => {
  // A line on the ground beside the plate, held by nothing to the lid.
  await app.type("arm(\"select\")");
  await app.type('ln(pt(60,0,0), pt(90,0,0))');
  const [x, y] = await app.screenOf([75, 0, 0]);
  const inPlane = await app.pixel(x + 0.5, y + 0.5, "drawing");
  await app.type("workplane(null)");
  const free = await app.pixel(x + 0.5, y + 0.5, "drawing");
  const sum = (p: number[]) => p[0] + p[1] + p[2];
  assert.ok(sum(inPlane) < sum(free) * 0.75, `dimmed while the lid is the plane: ${inPlane} against ${free}`);
  // The pick is the same either way.
  await app.type('workplane("p5.p6.p8", { look: false })');
  const hit = await app.page.evaluate(([sx, sy]) => (window as unknown as { __neocad: { engine: { pickAt(x: number, y: number): { name: string } | null } } }).__neocad.engine.pickAt(sx, sy)?.name ?? null, [x, y]);
  assert.match(String(hit), /^l\d+$/, "still picked while dimmed");
  await shot(app, "focus");
});

test("Done ends the plane: workplane(null) typed, the tint gone, the chip's first part empty, the camera where it was", async () => {
  const view = (await app.model()).view;
  await app.page.click("#mode .done");
  await app.page.waitForTimeout(200);
  assert.match(await app.log(), /> workplane\(null\)\s*origin\s*$/);
  assert.equal((await chip(app)).where, "");
  assert.equal((await tint(app, [5, 5, 20]))[3], 0, "the tint has gone");
  assert.deepEqual((await app.model()).view, view, "the camera stays");
  assert.equal(await app.page.$eval("#mode .plane", (el) => (el as HTMLElement).hidden), true);
  await shot(app, "done");
  await app.type("undo()");
  assert.equal((await chip(app)).where, "on e1's top", "and one undo puts it back");
});

test("the plane's part opens its menu: Look at, Change…, Done — each a command", async () => {
  await app.page.click("#mode .where");
  await app.page.waitForTimeout(150);
  const items = await app.page.$$eval("#ctxmenu .item", (els) => els.map((el) => [el.firstElementChild?.textContent ?? "", el.querySelector(".cmd")?.textContent ?? ""]));
  assert.deepEqual(items, [["Look at", 'lookAt("p5.p6.p8")'], ["Change…", 'arm("sketch")'], ["Done", "workplane(null)"]]);
  await shot(app, "plane-menu");
  await app.page.click("#ctxmenu .item >> text=Change…");
  await app.page.waitForTimeout(150);
  assert.equal((await app.model()).activeTool, "sketch");
});

test("a miss is answered in the chip's third part — muted, the tool armed — and not in the status's note", async () => {
  // The undo above left its own note ("undid"), which is the status's to say; let it go first.
  await app.page.waitForFunction(() => document.getElementById("stepnote")?.textContent === "", null, { timeout: 4000 });
  await app.page.click('#toolbar button[data-tool="extrude"]');
  assert.equal((await chip(app)).next, "click inside a closed shape");
  await clickAt(app, 700, 120);
  const c = await chip(app);
  assert.equal(c.guiding, true);
  assert.match(c.next, /closed outline/);
  assert.equal(await app.page.$eval("#stepnote", (el) => el.textContent ?? ""), "");
  await shot(app, "guidance");
  const [x, y] = await app.screenOf([0, 0, 20]);
  await clickAt(app, x, y);
  assert.equal((await chip(app)).next, "✓ to extrude", "a region picked: the chip says what ✓ does");
  await app.page.keyboard.press("Escape");
  await app.page.keyboard.press("Escape");
});

test("the fillet tool lights the corners it can take; the tool's name opens its options", async () => {
  await fresh(app);
  await app.type("pt(-40,-25,0); pt(40,-25,0); pt(40,25,0); pt(-40,25,0)");
  await app.type('ln("p1","p2"); ln("p2","p3"); ln("p3","p4"); ln("p4","p1")');
  await app.page.mouse.move(2, 400);
  const [x, y] = await app.screenOf([-40, -25, 0]);
  const quiet = await app.pixel(x + 0.5, y + 0.5, "drawing");
  await app.page.click('#toolbar button[data-tool="fillet"]');
  await app.page.mouse.move(2, 400);
  await app.page.waitForTimeout(100);
  const lit = await app.pixel(x + 0.5, y + 0.5, "drawing");
  assert.ok(greenish(lit) && lit[3] > 150, `a quiet corner, lit for the taking: ${quiet} → ${lit}`);
  assert.equal((await chip(app)).next, "click a lit corner, or a line");
  await shot(app, "fillet-lights-corners");
  await app.page.click("#mode .what");
  await app.page.waitForTimeout(100);
  const opts = await app.page.$eval('.panel[data-panel="options"]', (el) => ({ hidden: (el as HTMLElement).hidden, flash: el.classList.contains("flash") }));
  assert.deepEqual(opts, { hidden: false, flash: true });
  assert.deepEqual(app.pageErrors, []);
});

// --- under a finger ---------------------------------------------------------------

for (const device of ["iPhone 13", "iPhone 13 landscape"] as const) {
  test(`${device}: sketch on the lid by tap, the chip and the tint; the lifted mark over the finger; Done in one tap; the chip over no pane`, async () => {
    const phone = await openApp({ device });
    try {
      const f = await fingers(phone);
      await phone.repl("pt(-20,-12,0); pt(20,-12,0); pt(20,12,0); pt(-20,12,0)");
      await phone.repl('ln("p1","p2"); ln("p2","p3"); ln("p3","p4"); ln("p4","p1")');
      await phone.repl('extrude("l1", 10)');
      await phone.repl("refresh()");
      await phone.page.waitForTimeout(200);
      assert.equal((await chip(phone)).next, "tap a thing, or hold and drag to box", "a finger's words from the start");
      const middle = async (sel: string) => phone.page.$eval(sel, (el) => {
        const r = el.getBoundingClientRect();
        const c = document.getElementById("cv")!.getBoundingClientRect();
        return [r.x + r.width / 2 - c.x, r.y + r.height / 2 - c.y] as [number, number];
      });
      await f.tap(...await middle('#toolbar button[data-tool="sketch"]'));
      await phone.page.waitForTimeout(250);
      const [lx, ly] = await phone.screenOf([2, 2, 10]);
      await phone.at(lx, ly);
      await f.tap(lx, ly);
      await phone.page.waitForTimeout(400);
      assert.equal((await chip(phone)).where, "on e1's top");
      assert.ok(greenish(await tint(phone, [2, 2, 10])), "the lid tinted");
      await f.tap(...await middle('#toolbar button[data-tool="circle"]'));
      await phone.page.waitForTimeout(250);
      const [cx, cy] = await phone.screenOf([-3, 0, 10]);
      await f.down([cx, cy]);
      await f.glide(6, [cx + 18, cy + 4]);
      const disc = (await phone.pixels("drawing", [[cx + 18 + 0.5, cy + 4 - 56 + 0.5]]))[0];
      assert.ok(disc[3] > 150, `the lifted mark above the finger: ${disc}`);
      assert.equal((await chip(phone)).next, "drag the radius");
      await shot(phone, `${device.replace(/ /g, "-")}-finger`);
      await phone.page.waitForTimeout(120);
      await f.move([cx + 18, cy + 4]);
      await phone.page.waitForTimeout(120);
      await f.up();
      // A tap straight after a moving lift is a fling's stop to Chromium, and
      // is swallowed (touch.e2e.ts): rest before the next one.
      await phone.page.waitForTimeout(400);
      // The chip over no pane.
      const over = await phone.page.evaluate(() => {
        const box = (el: Element) => el.getBoundingClientRect();
        const c = box(document.getElementById("mode")!);
        return Array.from(document.querySelectorAll<HTMLElement>(".panel[data-panel]")).filter((p) => !p.hidden).map((p) => [p.dataset.panel, box(p)] as const)
          .filter(([, r]) => c.x < r.right - 0.5 && r.x < c.right - 0.5 && c.y < r.bottom - 0.5 && r.y < c.bottom - 0.5).map(([id]) => id);
      });
      assert.deepEqual(over, [], "the chip over no pane");
      // The verdict is never cut for the chip: while it shows, it is inside the
      // corner's room, the chip's next step giving way where it must; once
      // it fades, the chip has its whole line back.
      const verdict = () => phone.page.evaluate(() => {
        const s = document.getElementById("status")!;
        const room = document.getElementById("corner")!.getBoundingClientRect();
        return { shown: s.dataset.faded === undefined, inside: s.getBoundingClientRect().bottom <= room.bottom + 0.5,
          yielded: document.getElementById("mode")!.className };
      });
      const v = await verdict();
      if (v.shown) assert.ok(v.inside, `the verdict is inside the corner's room (${v.yielded || "chip whole"})`);
      await phone.page.waitForFunction(() => document.getElementById("status")?.dataset.faded !== undefined, null, { timeout: 6000 });
      await phone.page.waitForTimeout(100);
      assert.equal((await verdict()).yielded, "", "faded: the chip whole again");
      await f.tap(...await middle("#mode .done"));
      await phone.page.waitForTimeout(300);
      assert.match(await phone.log(), /> workplane\(null\)/);
      assert.equal((await chip(phone)).where, "", "Done, in one tap");
      assert.deepEqual(phone.pageErrors, []);
    } finally {
      await phone.close();
    }
  });
}
