// Touch targets that follow the interface size, and less air between tools
// (docs/plans/touch-density.md), in a browser. The owner, from his phone:
// *"for the scaling, the text resizes but the spacing between e.g menu items
// and toolbar items barely changes. Not sure why. There must be some scaling
// you're missing. Also in general the white space between eg the tools on the
// tool palettes is a bit too much"*.
//
// - On an iPhone 13, an iPhone SE, a Pixel 7 and a Pixel Tablet, both ways up,
//   at 80 %, 100 % and 130 %: every hit box under a finger is the target (44 at
//   100 %, 35 at 80 %, 57 at 130 %); a menu item is as tall as the target, so
//   it follows the size; the tray's tool is drawn at 0.8 of it.
// - On every device in the table, both ways up: the verdict is wholly inside
//   the corner from the solve until it has faded — the chip's next step stays
//   hidden for as long as the verdict needs the line (picture 196 had
//   `SOLVED 36 free` cut in half under the chip during the fade).
// - On an iPhone 13 and a Pixel 7 on their sides: a pane pushed to either side
//   edge is drawn at its rectangle, not out under the cutout (the owner: *"it
//   hits an invisible edge, but then the padding of the palette expands out to
//   touch the edge of the screen"*), and no drawn box is over another.
// - A stored layout a rotation cannot hold is re-fitted, said, and drawn with
//   no pane over another (his landscape picture: the log over the command
//   line's body).
//
// Set NEOCAD_E2E_SHOTS to keep the pictures — and look at them, at 1× and 3×.

import { test, after } from "node:test";
import assert from "node:assert/strict";
import { mkdirSync } from "node:fs";
import { join } from "node:path";
import { devices, type Browser, type BrowserContext, type CDPSession, type Page } from "playwright";
import { APP_URL, forgetAutosave, launchBrowser } from "./harness.ts";
import { ANDROIDS, IPHONES, androidWindowOf, windowOf, type Insets, type Turn } from "../devices.ts";

const SHOTS = process.env.NEOCAD_E2E_SHOTS;
const errors: string[] = [];
let browser: Browser | null = null;
after(async () => { await browser?.close(); });

interface Way { name: string; descriptor: "iPhone 13" | "Pixel 7"; screen?: { width: number; height: number }; win: (turn: Turn) => { w: number; h: number; insets: Insets } }
const iphone = (w: number, h: number): Way => {
  const p = IPHONES.find((q) => q.w === w && q.h === h)!;
  return { name: p.name.split(",")[0].replace(/ \(.*\)/, ""), descriptor: "iPhone 13", screen: { width: p.w, height: p.h }, win: (turn) => windowOf(p, turn, "installed") };
};
const android = (name: string): Way => {
  const d = ANDROIDS.find((q) => q.name.startsWith(name))!;
  return { name, descriptor: "Pixel 7", screen: { width: d.w, height: d.h }, win: (turn) => androidWindowOf(d, turn, "installed") };
};
const IPHONE13 = iphone(390, 844);
const SE = iphone(375, 667);
const PIXEL7 = android("Pixel 7, 7a");
const TABLET = android("Pixel Tablet");

interface Phone { context: BrowserContext; page: Page; cdp: CDPSession; errors: string[] }

async function ready(page: Page): Promise<void> {
  await page.waitForFunction(() => document.getElementById("status")?.textContent?.includes("ready"), null, { timeout: 20_000 });
}

/** A fresh start on `way` held `turn`, at the spin box's `scale`: no layout, no autosave. */
async function open(way: Way, turn: Turn, scale = 1, dsf?: number): Promise<Phone> {
  browser ??= await launchBrowser();
  const { defaultBrowserType: _b, ...device } = devices[way.descriptor];
  const win = way.win(turn);
  const screen = way.screen && (turn === "portrait" ? way.screen : { width: way.screen.height, height: way.screen.width });
  const context = await browser.newContext({ ...device, ...(screen ? { screen } : {}), viewport: { width: win.w, height: win.h }, ...(dsf ? { deviceScaleFactor: dsf } : {}) });
  const page = await context.newPage();
  const mine: string[] = [];
  page.on("pageerror", (e) => { mine.push(String(e)); errors.push(String(e)); });
  const cdp = await context.newCDPSession(page);
  await cdp.send("Emulation.setSafeAreaInsetsOverride", { insets: win.insets });
  await page.goto(APP_URL, { waitUntil: "networkidle" });
  await ready(page);
  await page.evaluate((s) => {
    localStorage.clear();
    if (s !== 1) localStorage.setItem("neocad.uiScale.v1", String(s));
  }, scale);
  await forgetAutosave(page);
  await page.reload({ waitUntil: "networkidle" });
  await ready(page);
  // Sent again once loaded, as fits.e2e.ts does: the first is sometimes not in force yet.
  await cdp.send("Emulation.setSafeAreaInsetsOverride", { insets: win.insets });
  await page.waitForTimeout(250);
  await page.evaluate(() => (document.activeElement as HTMLElement | null)?.blur());
  return { context, page, cdp, errors: mine };
}

const type = async (page: Page, line: string) => {
  await page.fill("#cmd", line);
  await page.press("#cmd", "Enter");
  await page.evaluate(() => (document.activeElement as HTMLElement | null)?.blur());
};

async function fingerTap(cdp: CDPSession, x: number, y: number, hold = 0): Promise<void> {
  await cdp.send("Input.dispatchTouchEvent", { type: "touchStart", touchPoints: [{ x, y, id: 1, radiusX: 8, radiusY: 8, force: 1 }] });
  if (hold) await new Promise((r) => setTimeout(r, hold));
  await cdp.send("Input.dispatchTouchEvent", { type: "touchEnd", touchPoints: [] });
}

async function fingerDrag(cdp: CDPSession, from: [number, number], to: [number, number], steps = 16): Promise<void> {
  const at = (x: number, y: number) => [{ x, y, id: 1, radiusX: 8, radiusY: 8, force: 1 }];
  const frame = () => new Promise((r) => setTimeout(r, 16));
  await cdp.send("Input.dispatchTouchEvent", { type: "touchStart", touchPoints: at(...from) });
  await frame();
  for (let i = 1; i <= steps; i++) {
    await cdp.send("Input.dispatchTouchEvent", { type: "touchMove", touchPoints: at(from[0] + ((to[0] - from[0]) * i) / steps, from[1] + ((to[1] - from[1]) * i) / steps) });
    await frame();
  }
  await cdp.send("Input.dispatchTouchEvent", { type: "touchEnd", touchPoints: [] });
}

async function shot(page: Page, name: string): Promise<void> {
  if (!SHOTS) return;
  mkdirSync(SHOTS, { recursive: true });
  await page.waitForTimeout(200);
  await page.screenshot({ path: join(SHOTS, `density-${name}.png`) });
}

interface Box { x: number; y: number; w: number; h: number }
const intersect = (a: Box, b: Box) => a.x < b.x + b.w - 0.5 && b.x < a.x + a.w - 0.5 && a.y < b.y + b.h - 0.5 && b.y < a.y + a.h - 0.5;

/** Every visible pane's drawn box, in window pixels. */
const drawn = (page: Page) => page.evaluate(() => {
  const out: Record<string, { x: number; y: number; w: number; h: number; bleed: string }> = {};
  for (const el of Array.from(document.querySelectorAll<HTMLElement>(".panel[data-panel]"))) {
    if (el.hidden) continue;
    const r = el.getBoundingClientRect();
    out[el.dataset.panel!] = { x: r.x, y: r.y, w: r.width, h: r.height, bleed: el.dataset.bleed ?? "" };
  }
  return out;
});
function overDrawn(boxes: Record<string, Box>): string[] {
  const ids = Object.keys(boxes);
  const out: string[] = [];
  for (let i = 0; i < ids.length; i++) for (let j = i + 1; j < ids.length; j++) if (intersect(boxes[ids[i]], boxes[ids[j]])) out.push(`${ids[i]} over ${ids[j]}`);
  return out;
}

// ---- every hit box is the target; menus follow the size; the tool fills its target ----------

/** The target at the spin box's `scale` (panels.ts's `target`, at the default text size). */
const targetAt = (scale: number) => Math.max(32, Math.round(44 * scale));
const SIZES = [0.8, 1, 1.3];
/** What each menu item measured, for the report and the spec's As built: device, way up, size → px. */
const menuHeights: string[] = [];

for (const way of [IPHONE13, SE, PIXEL7, TABLET]) {
  for (const turn of ["portrait", "landscape"] as const) {
    test(`${way.name} ${turn}: at 80 %, 100 % and 130 % every hit box is the target, a menu item is a target tall, and a tray's tool is drawn at 0.8 of it`, async () => {
      for (const scale of SIZES) {
        const p = await open(way, turn, scale);
        const where = `${way.name} ${turn} at ${Math.round(scale * 100)} %`;
        try {
          const want = targetAt(scale);
          // A tool with options (✓/✗ and option rows), then the long-press menu.
          // At 130 % a feature's three rows of options fit no phone's side
          // view and no SE (the guarantee above 100 % is shorter now that the
          // target grows: fits.test.ts) — a drawing tool's one row there, and
          // on the SE none.
          const tool = scale <= 1 || way === TABLET ? "extrude" : way === SE ? "select" : "rectangle";
          await type(p.page, `arm("${tool}")`);
          await p.page.waitForTimeout(200);
          const at = await p.page.evaluate(() => {
            const cv = document.getElementById("cv")!.getBoundingClientRect();
            // The spot nearest the drawing's middle clear all round — the diagonals too — of every pane by a fingertip and Chromium's touch adjustment (24 px): 16 straight across was not, on an SE on its side at 130 %, and the press went to the tray's corner.
            const bare = (x: number, y: number) => [[0, 0], [-24, 0], [24, 0], [0, -24], [0, 24], [-17, -17], [17, -17], [-17, 17], [17, 17]].every(([dx, dy]) => document.elementFromPoint(x + dx, y + dy)?.id === "cv");
            const spots: [number, number][] = [];
            for (let y = cv.y + 40; y < cv.bottom - 40; y += 6) for (let x = cv.x + 40; x < cv.right - 40; x += 6) spots.push([x, y]);
            const [cx, cy] = [cv.x + cv.width / 2, cv.y + cv.height / 2];
            spots.sort((a, b) => Math.hypot(a[0] - cx, a[1] - cy) - Math.hypot(b[0] - cx, b[1] - cy));
            return spots.find(([x, y]) => bare(x, y)) ?? null;
          });
          assert.ok(at, `${where}: a bare spot to long-press`);
          await fingerTap(p.cdp, at[0], at[1], 700);
          await p.page.waitForTimeout(200);
          const m = await p.page.evaluate((want) => {
            const off: string[] = [];
            const hit = (el: Element) => {
              const r = el.getBoundingClientRect();
              const b = getComputedStyle(el, "::before");
              const has = b.content !== "none" && b.content !== "normal";
              return { w: Math.max(r.width, has ? parseFloat(b.width) || 0 : 0), h: Math.max(r.height, has ? parseFloat(b.height) || 0 : 0) };
            };
            // Equal to the target where the face is smaller; never less.
            const check = (what: string, el: Element, w = true, h = true) => {
              const r = el.getBoundingClientRect();
              const x = hit(el);
              const fits = (v: number, face: number) => Math.abs(v - Math.max(want, face)) < 0.6;
              if ((w && !fits(x.w, r.width)) || (h && !fits(x.h, r.height))) off.push(`${what} ${x.w.toFixed(1)}×${x.h.toFixed(1)} (face ${r.width.toFixed(1)}×${r.height.toFixed(1)})`);
            };
            for (const b of Array.from(document.querySelectorAll(".tray button"))) check(`button ${(b as HTMLElement).dataset.tool ?? (b as HTMLElement).dataset.action}`, b);
            for (const s of Array.from(document.querySelectorAll(".panel:not([hidden])>.ptitle"))) check(`strip of ${(s.parentElement as HTMLElement).dataset.panel}`, s, false, true);
            for (const g of Array.from(document.querySelectorAll(".panel:not([hidden])>.pgrip"))) check(`grip ${(g as HTMLElement).dataset.corner}`, g);
            for (const r of Array.from(document.querySelectorAll("#options .orow"))) check("option row", r, false, true);
            for (const b of Array.from(document.querySelectorAll("#options .oact button"))) check("✓/✗", b);
            for (const b of Array.from(document.querySelectorAll("#mode button"))) if ((b as HTMLElement).offsetParent) check(`chip ${b.className}`, b, false, true);
            const items = Array.from(document.querySelectorAll<HTMLElement>("#ctxmenu .item"));
            for (const i of items) check(`menu ${i.textContent}`, i, false, true);
            const tool = document.querySelector<HTMLElement>('#toolbar button[data-tool="line"]')!;
            const glyph = tool.querySelector("svg")!.getBoundingClientRect();
            return { off, items: items.length, item: items[0]?.getBoundingClientRect().height ?? 0, button: tool.getBoundingClientRect().width, glyph: glyph.width };
          }, want);
          assert.ok(m.items > 0, `${where}: the long-press menu was open to be measured`);
          assert.deepEqual(p.errors, [], `${where}: no layout problem`);
          assert.deepEqual(m.off, [], `${where}: every hit box ${want}`);
          assert.ok(Math.abs(m.item - want) < 0.6, `${where}: a menu item ${m.item} tall, the target ${want}`);
          assert.equal(m.button, Math.round(0.8 * 44 * scale), `${where}: the tool drawn at 0.8 of its target`);
          menuHeights.push(`${where}: menu item ${m.item} px, tool ${m.button} px, glyph ${m.glyph} px, target ${want}`);
          // The app menu's rows and the spin box too.
          await p.page.keyboard.press("Escape");
          const logo = await p.page.$eval("#logo", (el) => { const r = el.getBoundingClientRect(); return [r.x + r.width / 2, r.y + r.height / 2]; });
          await fingerTap(p.cdp, logo[0], logo[1]);
          await p.page.waitForSelector("#appmenu:not([hidden])");
          const app = await p.page.evaluate(() => ({
            items: Array.from(document.querySelectorAll<HTMLElement>("#appmenu .item")).filter((i) => i.offsetParent).map((i) => i.getBoundingClientRect().height),
            spin: Array.from(document.querySelectorAll<HTMLElement>("#appmenu .spin button")).map((b) => [b.getBoundingClientRect().width, b.getBoundingClientRect().height]),
          }));
          for (const h of app.items) assert.ok(h >= want - 0.5 && h <= want + 12, `${where}: an app-menu row ${h}, the target ${want}`);
          for (const [w, h] of app.spin) assert.ok(Math.abs(h - want) < 0.6 && w >= want - 0.5, `${where}: the spin box's buttons ${w}×${h}`);
          if (scale === 1 && turn === "portrait") await shot(p.page, `${way.name.toLowerCase().replace(/\s+/g, "-")}-app-menu-100`);
        } finally {
          await p.context.close();
        }
      }
    });
  }
}

test("a menu item's height follows the interface size (the owner's complaint, measured)", () => {
  // Printed for the spec's As built; the claims are the tests above.
  console.log(menuHeights.join("\n"));
  assert.ok(menuHeights.length >= SIZES.length * 8, "every device, way up and size measured");
});

// ---- the verdict is never cut ---------------------------------------------------------------

/**
 * From a solve until it has faded, `SOLVED` and its count are wholly inside the
 * corner's room — sampled every frame for 4.2 s, the 3 s it shows and the
 * 0.6 s fade with room either side. With a sketch plane set and nothing armed,
 * the chip is three parts long (`on f Done · select · tap a thing, or hold and
 * drag to box`), which on an upright phone is two lines: the case picture 196
 * showed cut.
 */
async function verdictCuts(p: Phone): Promise<{ cut: string[]; samples: number; yielded: boolean; whole: boolean }> {
  await p.page.evaluate(async () => {
    const r = (window as never as { __neocad: { repl: { eval(s: string): Promise<unknown> } } }).__neocad.repl;
    await r.eval('model.addPoint([150, 150, 0], "f_o"); model.addPoint([151, 150, 0], "f_x"); model.addPoint([150, 151, 0], "f_y"); model.addFrame("f_o", "f_x", "f_y", "f"); model.setDefaultFrame("f"); "framed"');
  });
  // A typed line solves and says the verdict, as a person's would.
  await type(p.page, "pt(-25,-15); pt(25,-15); pt(25,15); pt(-25,15); ln(\"p1\",\"p2\"); ln(\"p2\",\"p3\")");
  return p.page.evaluate(() => new Promise((resolve) => {
    const cut: string[] = [];
    let samples = 0;
    let yielded = false;
    const t0 = performance.now();
    const corner = document.getElementById("corner")!;
    const mode = document.getElementById("mode")!;
    const tick = () => {
      const room = corner.getBoundingClientRect();
      for (const id of ["status", "diagnosis"]) {
        const el = document.getElementById(id)!;
        const s = getComputedStyle(el);
        if (!el.textContent || s.display === "none" || Number(s.opacity) <= 0.01) continue;
        samples++;
        const b = el.getBoundingClientRect();
        if (b.bottom > room.bottom + 0.5 || b.right > room.right + 0.5 || b.top < room.top - 0.5)
          cut.push(`${Math.round(performance.now() - t0)} ms: ${id} "${el.textContent}" at ${Math.round(b.top)}–${Math.round(b.bottom)} in ${Math.round(room.top)}–${Math.round(room.bottom)}, opacity ${s.opacity}`);
      }
      if (mode.classList.contains("tight")) yielded = true;
      if (performance.now() - t0 < 4200) requestAnimationFrame(tick);
      else resolve({ cut: cut.slice(0, 5), samples, yielded, whole: !mode.classList.contains("tight") });
    };
    requestAnimationFrame(tick);
  }));
}

const EVERY: { way: Way; turn: Turn }[] = [];
for (const p of IPHONES) for (const turn of ["portrait", "landscape"] as const) EVERY.push({ way: iphone(p.w, p.h), turn });
for (const d of ANDROIDS) for (const turn of ["portrait", "landscape"] as const) EVERY.push({ way: android(d.name), turn });

test(`every device in the table, both ways up (${EVERY.length} ways): the verdict wholly inside the corner from the solve until it has faded; the chip whole again after`, async () => {
  const fails: string[] = [];
  let yieldedSomewhere = 0;
  // Three at a time: each way is 4 s of watching.
  for (let i = 0; i < EVERY.length; i += 3) {
    await Promise.all(EVERY.slice(i, i + 3).map(async ({ way, turn }) => {
      const p = await open(way, turn);
      try {
        const r = await verdictCuts(p);
        const where = `${way.name} ${turn}`;
        if (r.samples === 0) fails.push(`${where}: no verdict seen`);
        if (r.cut.length) fails.push(`${where}: ${r.cut.join("; ")}`);
        if (!r.whole) fails.push(`${where}: the chip not whole again after the fade`);
        if (r.yielded) yieldedSomewhere++;
        if (way === IPHONE13 && turn === "portrait") await shot(p.page, "iphone-13-after-the-fade-the-chip-whole");
      } finally {
        await p.context.close();
      }
    }));
  }
  assert.deepEqual(fails, []);
  assert.ok(yieldedSomewhere > 0, "somewhere the chip gave the verdict its line — the case under test was reached");
});

// ---- bleed only at the bottom; nothing drawn over anything ------------------------------

for (const way of [IPHONE13, PIXEL7]) {
  test(`${way.name} on its side: a pane pushed to either side edge is drawn at its rectangle, not under the cutout; one in the bottom corner reaches down only; no drawn box over another`, async () => {
    const p = await open(way, "landscape");
    try {
      const win = way.win("landscape");
      const strip = (id: string) => p.page.$eval(`.panel[data-panel="${id}"] > .ptitle`, (el) => { const r = el.getBoundingClientRect(); return [r.x + r.width / 2, r.y + r.height / 2] as [number, number]; });
      const settle = () => p.page.waitForTimeout(450);
      // The action strip as far right as it goes, the toolbar as far left.
      const a = await strip("actions");
      await fingerDrag(p.cdp, a, [win.w - 4, a[1] + 60]);
      await settle();
      const t = await strip("toolbar");
      await fingerDrag(p.cdp, t, [4, t[1] - 120]);
      await settle();
      let d = await drawn(p.page);
      assert.ok(Math.abs(d.actions.x + d.actions.w - (win.w - win.insets.right)) < 0.6, `the strip at the safe area's right line, not the glass: ${JSON.stringify(d.actions)}`);
      assert.ok(Math.abs(d.toolbar.x - win.insets.left) < 0.6, `the toolbar at the safe area's left line: ${JSON.stringify(d.toolbar)}`);
      for (const [id, b] of Object.entries(d)) assert.doesNotMatch(b.bleed, /left|right|top/, `${id} reaches under no side or top inset`);
      assert.deepEqual(overDrawn(d), [], "no drawn box over another");
      await shot(p.page, `${way.name.toLowerCase().replace(/[\s,]+/g, "-")}-on-its-side-docked-to-both-sides`);
      // The log into the bottom-left corner: down to the glass, not under the cutout.
      const l = await strip("log");
      await fingerDrag(p.cdp, l, [win.insets.left + 60, win.h - 4]);
      await settle();
      d = await drawn(p.page);
      const log = d.log;
      if (log.bleed === "bottom") {
        assert.ok(Math.abs(log.y + log.h - win.h) < 0.6, `on the bottom edge it reaches the glass: ${JSON.stringify(log)}`);
      }
      assert.ok(log.x >= win.insets.left - 0.5, `and not under the cutout: ${JSON.stringify(log)}`);
      assert.deepEqual(overDrawn(d), [], "no drawn box over another");
      assert.deepEqual(p.errors, [], "and no layout problem reported");
    } finally {
      await p.context.close();
    }
  });
}

test("a stored layout a rotation cannot hold: re-fitted, said, nothing drawn over anything — and turned back, the panes are where they were left", async () => {
  // The places a Pro Max on its side left — found by touchdensity.test.ts's
  // fuzz: upright, the resolver finds no layout for them all.
  const PROMAX = IPHONES.find((q) => q.w === 440)!;
  const way: Way = { name: "iPhone 17 Pro Max", descriptor: "iPhone 13", screen: { width: 440, height: 956 }, win: (turn) => windowOf(PROMAX, turn, "installed") };
  const side = { w: 956 - 124, h: 440 - 40 };
  const stored = {
    log: { at: { x: 607, y: 300, w: 203, h: 60, area: side, scale: 1.3, dock: { left: "toolbar" }, oy: -57 } },
    cmd: { at: { x: 427, y: 141, w: 405, h: 65, area: side, scale: 1.3, dock: { right: "edge" } } },
    actions: { at: { x: 629, y: 84, w: 203, h: 43, orient: "row", area: side, scale: 1.3, dock: { right: "edge" } } },
    organiser: { at: { x: 221, y: 111, w: 203, h: 246, area: side, scale: 1.3, dock: { bottom: "toolbar" }, ox: 213 } },
  };
  const p = await open(way, "landscape");
  try {
    await p.page.evaluate((s) => localStorage.setItem("neocad.panels.v3", JSON.stringify({ panels: s })), stored);
    await forgetAutosave(p.page);
    await p.page.reload({ waitUntil: "networkidle" });
    await ready(p.page);
    await p.page.waitForTimeout(300);
    const left = await drawn(p.page);
    assert.deepEqual(overDrawn(left), [], "on its side, as left: nothing over anything");
    const turnTo = async (turn: Turn) => {
      const win = way.win(turn);
      await p.page.setViewportSize({ width: win.w, height: win.h });
      await p.cdp.send("Emulation.setSafeAreaInsetsOverride", { insets: win.insets });
      await p.page.waitForTimeout(500);
    };
    await turnTo("portrait");
    const up = await drawn(p.page);
    assert.deepEqual(overDrawn(up), [], `upright: re-fitted, nothing over anything ${JSON.stringify(up)}`);
    assert.match(await p.page.$eval("#stepnote", (el) => el.textContent ?? ""), /panels re-fitted to this screen/, "and said");
    await shot(p.page, "iphone-17-pro-max-a-stored-layout-re-fitted-upright");
    await turnTo("landscape");
    const back = await drawn(p.page);
    for (const id of Object.keys(left)) assert.deepEqual(back[id], left[id], `turned back: ${id} where it was left`);
    assert.deepEqual(p.errors, [], "no layout problem reported on the way");
  } finally {
    await p.context.close();
  }
});

// ---- pictures (NEOCAD_E2E_SHOTS): the tray at 1× and 3×, both ways up ----------------------

test("pictures: an iPhone 13 at 100 % and 80 %, upright and on its side, at 1× and 3×", { skip: !SHOTS }, async () => {
  for (const dsf of [1, 3]) {
    for (const turn of ["portrait", "landscape"] as const) {
      for (const scale of [1, 0.8]) {
        const p = await open(IPHONE13, turn, scale, dsf);
        try {
          await p.page.evaluate(async () => {
            const r = (window as never as { __neocad: { repl: { eval(s: string): Promise<unknown> } } }).__neocad.repl;
            await r.eval('model.addPoint([150, 150, 0], "f_o"); model.addPoint([151, 150, 0], "f_x"); model.addPoint([150, 151, 0], "f_y"); model.addFrame("f_o", "f_x", "f_y", "f"); model.setDefaultFrame("f");'
              + ' pt(-25,-15); pt(25,-15); pt(25,15); pt(-25,15); ln("p1","p2"); ln("p2","p3"); ln("p3","p4"); ln("p4","p1"); refresh(); "drawn"');
          });
          await type(p.page, 'arm("rectangle")');
          await p.page.waitForTimeout(3800); // past the verdict's fade, the chip whole
          await shot(p.page, `iphone-13-${turn}-${Math.round(scale * 100)}-${dsf}x`);
        } finally {
          await p.context.close();
        }
      }
    }
  }
});

test("nothing the pages threw went uncaught", () => {
  assert.deepEqual(errors, []);
});
