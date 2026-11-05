// Everything fits, in a browser (docs/plans/everything-fits.md; the owner:
// "Second row.... everything has to fit", and of the organiser on a phone:
// "show from start").
//
// Chromium emulating an iPhone — `isMobile`, `hasTouch`, so `(pointer:
// coarse)` matches — at every screen size in test/devices.ts, both ways up,
// installed and in Safari, with the safe-area insets iOS reports set through
// CDP's `Emulation.setSafeAreaInsetsOverride` (the descriptor alone reports
// none). What is checked on each: no two visible panes' rectangles intersect,
// none covers the corner (the logo and the status beside it), every pane is on
// screen, the organiser is there from the start, and the page reported no
// layout problem. Then on an iPhone 13 and an SE: the landscape tray is two
// rows; a held tooltip on a tray button does not cover the next button; and a
// pane docked against a tray keeps lying along it through a rotation that
// wraps the tray.
//
// Not Safari: this machine has no WebKit. Set NEOCAD_E2E_SHOTS to a directory
// to keep a picture of every device and orientation — and look at them.

import { test, after } from "node:test";
import assert from "node:assert/strict";
import { mkdirSync } from "node:fs";
import { join } from "node:path";
import { devices, type Browser, type BrowserContext, type CDPSession, type Page } from "playwright";
import { APP_URL, forgetAutosave, launchBrowser } from "./harness.ts";
import { IPHONES, windowOf, type IPhone, type Mode, type Turn } from "../devices.ts";

const SHOTS = process.env.NEOCAD_E2E_SHOTS;
const errors: string[] = [];
let browser: Browser | null = null;
after(async () => { await browser?.close(); });

interface Phone { context: BrowserContext; page: Page; cdp: CDPSession }

const SE = IPHONES.find((p) => p.w === 375 && p.h === 667)!;
const THIRTEEN = IPHONES.find((p) => p.w === 390 && p.h === 844)!;

async function ready(page: Page): Promise<void> {
  await page.waitForFunction(() => document.getElementById("status")?.textContent?.includes("ready"), null, { timeout: 20_000 });
}

/** A phone's page — `iPhone 13`'s touch, scale and user agent, at another window when asked. */
async function phone(): Promise<Phone> {
  browser ??= await launchBrowser();
  const { defaultBrowserType: _webkit, ...device } = devices["iPhone 13"];
  const context = await browser.newContext(device);
  const page = await context.newPage();
  page.on("pageerror", (e) => errors.push(String(e)));
  const cdp = await context.newCDPSession(page);
  await page.goto(APP_URL, { waitUntil: "networkidle" });
  await ready(page);
  return { context, page, cdp };
}

/** The phone held `turn`, `mode`: its window and insets set, and — with `fresh` — a first start: no layout, no autosave. */
async function hold(p: Phone, phoneOf: IPhone, turn: Turn, mode: Mode, fresh = true): Promise<void> {
  const win = windowOf(phoneOf, turn, mode);
  await p.page.setViewportSize({ width: win.w, height: win.h });
  await p.cdp.send("Emulation.setSafeAreaInsetsOverride", { insets: win.insets });
  if (fresh) {
    await p.page.evaluate(() => localStorage.clear());
    await forgetAutosave(p.page); // a reload here means the app's first start
    await p.page.reload({ waitUntil: "networkidle" });
    await ready(p.page);
  }
  await p.page.waitForTimeout(250);
  await p.page.evaluate(() => (document.activeElement as HTMLElement | null)?.blur());
}

interface Box { x: number; y: number; w: number; h: number }
const intersect = (a: Box, b: Box) => a.x < b.x + b.w - 0.5 && b.x < a.x + a.w - 0.5 && a.y < b.y + b.h - 0.5 && b.y < a.y + a.h - 0.5;

/** Every visible pane's drawn rectangle, the logo's and the corner's — in window pixels. */
const chrome = (page: Page) => page.evaluate(() => {
  const box = (el: Element) => { const r = el.getBoundingClientRect(); return { x: r.x, y: r.y, w: r.width, h: r.height }; };
  const panes: Record<string, { x: number; y: number; w: number; h: number }> = {};
  for (const el of Array.from(document.querySelectorAll<HTMLElement>(".panel[data-panel]"))) {
    if (!el.hidden) panes[el.dataset.panel!] = box(el);
  }
  // What covers is its text, as far as the corner shows it: the corner clips
  // what will not fit its room (index.html), so each piece is cut to its box.
  const clip = box(document.getElementById("corner")!);
  const texts = Array.from(document.querySelectorAll<HTMLElement>("#corner > *"))
    .filter((el) => !el.hidden && el.textContent && getComputedStyle(el).display !== "none").map(box)
    .map((t) => {
      const [x, y] = [Math.max(t.x, clip.x), Math.max(t.y, clip.y)];
      return { x, y, w: Math.min(t.x + t.w, clip.x + clip.w) - x, h: Math.min(t.y + t.h, clip.y + clip.h) - y };
    })
    .filter((t) => t.w > 0 && t.h > 0);
  return { panes, logo: box(document.getElementById("logo")!), corner: texts, w: innerWidth, h: innerHeight };
});

/** What the fit rule forbids on the page as it is now. */
async function breaches(page: Page): Promise<string[]> {
  const c = await chrome(page);
  const out: string[] = [];
  const ids = Object.keys(c.panes);
  for (let i = 0; i < ids.length; i++) {
    const a = c.panes[ids[i]];
    if (a.x < -0.5 || a.y < -0.5 || a.x + a.w > c.w + 0.5 || a.y + a.h > c.h + 0.5) out.push(`${ids[i]} off screen ${JSON.stringify(a)}`);
    if (intersect(a, c.logo)) out.push(`${ids[i]} over the logo`);
    for (const t of c.corner) if (intersect(a, t)) out.push(`${ids[i]} over the corner's text ${JSON.stringify(t)}`);
    for (let j = i + 1; j < ids.length; j++) if (intersect(a, c.panes[ids[j]])) out.push(`${ids[i]} over ${ids[j]}`);
  }
  return out;
}

const repl = (page: Page, src: string) => page.evaluate(async (s) => {
  const r = await (window as unknown as { __neocad: { repl: { eval(s: string): Promise<{ ok: boolean; error?: Error }> } } }).__neocad.repl.eval(s);
  return { ok: r.ok, error: r.error?.message };
}, src);

/** A rectangle in the middle of the drawing, so a picture shows what the panes leave of it. */
async function drawing(page: Page): Promise<void> {
  const r = await repl(page, [
    'model.addPoint([150, 150, 0], "f_o"); model.addPoint([151, 150, 0], "f_x"); model.addPoint([150, 151, 0], "f_y");',
    'model.addFrame("f_o", "f_x", "f_y", "f"); model.setDefaultFrame("f");',
    "pt(-25,-15); pt(25,-15); pt(25,15); pt(-25,15);",
    'ln("p1","p2"); ln("p2","p3"); ln("p3","p4"); ln("p4","p1"); refresh(); "drawn"',
  ].join(" "));
  assert.ok(r.ok, r.error ?? "drawn");
}

async function shot(page: Page, name: string): Promise<void> {
  if (!SHOTS) return;
  mkdirSync(SHOTS, { recursive: true });
  await page.waitForTimeout(150);
  await page.screenshot({ path: join(SHOTS, `fits-${name}.png`) });
}

const slug = (p: IPhone) => `${p.w}x${p.h}`;

test("every iPhone, both ways up, installed and in Safari: no pane over another, over the logo or over the status; all on screen; the organiser shown", async () => {
  const p = await phone();
  try {
    for (const ph of IPHONES) {
      for (const turn of ["portrait", "landscape"] as const) {
        for (const mode of ["installed", "safari"] as const) {
          await hold(p, ph, turn, mode);
          await drawing(p.page);
          const where = `${ph.name}, ${turn}, ${mode}`;
          assert.deepEqual(await breaches(p.page), [], where);
          const org = await chrome(p.page).then((c) => c.panes.organiser);
          assert.ok(org && org.w > 100 && org.h > 60, `${where}: the organiser is there from the start ${JSON.stringify(org)}`);
          assert.deepEqual(errors, [], `${where}: the page reported no layout problem`);
          await shot(p.page, `${slug(ph)}-${turn}-${mode}`);
        }
      }
    }
    // The owner's phone size at a larger interface size, both ways up.
    for (const turn of ["portrait", "landscape"] as const) {
      await hold(p, THIRTEEN, turn, "installed");
      assert.ok((await repl(p.page, "ui({ scale: 1.3 })")).ok);
      await p.page.waitForTimeout(250);
      await drawing(p.page);
      assert.deepEqual(await breaches(p.page), [], `iPhone 13 ${turn} at 130 %`);
      assert.deepEqual(errors, []);
      await shot(p.page, `${slug(THIRTEEN)}-${turn}-installed-130`);
    }
  } finally {
    await p.context.close();
  }
});

// The mode chip at its longest (docs/plans/mode-feedback.md): a plane set — the
// drawing's default frame, so the chip's first part and its Done are there —
// and the circle tool armed, whose options panel is open and whose next step
// is the chip's longest line. The chip is in the corner, so the corner's text
// is what is checked: over no pane, on every phone of the table, both ways up,
// installed and in Safari.
test("every iPhone, both ways up, installed and in Safari, with a sketch plane and a tool armed: the mode chip over no pane", async () => {
  const p = await phone();
  try {
    for (const ph of IPHONES) {
      for (const turn of ["portrait", "landscape"] as const) {
        for (const mode of ["installed", "safari"] as const) {
          await hold(p, ph, turn, mode);
          await drawing(p.page);
          assert.ok((await repl(p.page, 'arm("circle")')).ok);
          await p.page.evaluate(() => (window as unknown as { __neocad: { render(): void } }).__neocad.render());
          await p.page.waitForTimeout(150);
          const where = `${ph.name}, ${turn}, ${mode}`;
          const said = await p.page.$eval("#mode", (el) => ({ ...(el as HTMLElement).dataset }));
          assert.equal(said.where, "on f", `${where}: the chip says where`);
          assert.equal(said.what, "circle", where);
          assert.deepEqual(await breaches(p.page), [], where);
          // Its parts are inside the corner's room, not clipped away: Done can be reached.
          const done = await p.page.$eval("#mode .done", (el) => {
            const r = el.getBoundingClientRect();
            const c = document.getElementById("corner")!.getBoundingClientRect();
            return r.width > 0 && r.bottom <= c.bottom + 0.5 && r.right <= c.right + 0.5;
          });
          assert.ok(done, `${where}: Done is on screen, inside the corner's room`);
          assert.deepEqual(errors, [], `${where}: the page reported no layout problem`);
          await shot(p.page, `chip-${slug(ph)}-${turn}-${mode}`);
        }
      }
    }
  } finally {
    await p.context.close();
  }
});

// A group's flyout open (docs/plans/toolbar-groups.md): two padding tools give
// shapes and modify a second member each — the packages that fill them have
// not landed — so the flyout's room is exercised on every phone now. Thirteen
// buttons now (dimension and constrain share the relate group's); the flyout, opened by a long-press, overlaps no pane, the
// tray, the logo or the corner, and is on screen; closed, everything fits as
// above. (The arithmetic at every queued size, up to modify's seven, is
// toolbargroups.test.ts's.)
test("every iPhone, both ways up, installed and in Safari, with a group's flyout open: over nothing, on screen; closed, everything fits", async () => {
  const p = await phone();
  try {
    for (const ph of IPHONES) {
      for (const turn of ["portrait", "landscape"] as const) {
        for (const mode of ["installed", "safari"] as const) {
          await hold(p, ph, turn, mode);
          for (const [t, g] of [["t_pad1", "shapes"], ["t_pad2", "modify"]]) {
            // Typed, so the entry brings the toolbar up to date.
            await p.page.fill("#cmd", `defineTool("${t}", class extends Tool { static group = "${g}"; name = "${t}"; })`);
            await p.page.press("#cmd", "Enter");
          }
          await p.page.waitForTimeout(200);
          await p.page.evaluate(() => (document.activeElement as HTMLElement | null)?.blur());
          const where = `${ph.name}, ${turn}, ${mode}`;
          assert.equal(await p.page.$$eval("#toolbar button", (bs) => bs.length), 13, `${where}: thirteen buttons`);
          for (const g of ["shapes", "modify"]) {
            const b = await p.page.$eval(`#toolbar button[data-group="${g}"]`, (el) => {
              const r = el.getBoundingClientRect();
              return { x: r.x + r.width / 2, y: r.y + r.height / 2 };
            });
            await p.cdp.send("Input.dispatchTouchEvent", { type: "touchStart", touchPoints: [{ ...b, id: 1, radiusX: 8, radiusY: 8, force: 1 }] });
            await p.page.waitForTimeout(700);
            await p.cdp.send("Input.dispatchTouchEvent", { type: "touchEnd", touchPoints: [] });
            await p.page.waitForTimeout(100);
            const fly = await p.page.$eval("#flyout", (el) => {
              const r = el.getBoundingClientRect();
              return (el as HTMLElement).hidden ? null : { x: r.x, y: r.y, w: r.width, h: r.height };
            });
            assert.ok(fly, `${where}: ${g}'s flyout opened`);
            const c = await chrome(p.page);
            assert.ok(fly.x >= -0.5 && fly.y >= -0.5 && fly.x + fly.w <= c.w + 0.5 && fly.y + fly.h <= c.h + 0.5, `${where}: ${g}'s flyout on screen`);
            for (const [id, r] of Object.entries(c.panes)) assert.ok(!intersect(fly, r), `${where}: ${g}'s flyout over ${id} ${JSON.stringify({ fly, r })}`);
            assert.ok(!intersect(fly, c.logo), `${where}: over the logo`);
            for (const t of c.corner) assert.ok(!intersect(fly, t), `${where}: over the corner's text`);
            if (g === "modify") await shot(p.page, `flyout-${slug(ph)}-${turn}-${mode}`);
            await p.page.keyboard.press("Escape");
            await p.page.waitForTimeout(50);
            assert.equal(await p.page.$eval("#flyout", (el) => (el as HTMLElement).hidden), true, `${where}: closed`);
          }
          assert.deepEqual(await breaches(p.page), [], `${where}, closed`);
          assert.deepEqual(errors, [], `${where}: the page reported no layout problem`);
        }
      }
    }
  } finally {
    await p.context.close();
  }
});

// Thirteen buttons since the relate group's button (dimension and constrain,
// docs/plans/sketch-relations.md) and the sketch shapes' curves group
// (docs/plans/sketch-shapes.md); eleven, since one circle tool and one arc
// (docs/plans/one-circle-one-arc.md), fitted the 13's landscape in one row,
// where thirteen take two, as the SE does either way. The claim
// is the same — as many lines as the room needs, every button on screen,
// filled line by line.
for (const [ph, lines] of [[THIRTEEN, 2], [SE, 2]] as [typeof THIRTEEN, number][]) {
  test(`${ph.name}: the landscape tray is ${lines === 1 ? "one row" : "two rows"}, every button on screen, in order line by line`, async () => {
    const p = await phone();
    try {
      for (const mode of ["installed", "safari"] as const) {
        await hold(p, ph, "landscape", mode);
        const rows = await p.page.$$eval("#toolbar button", (bs) => bs.map((b) => {
          const r = b.getBoundingClientRect();
          return { x: Math.round(r.x), y: Math.round(r.y), w: r.width, h: r.height, tool: (b as HTMLElement).dataset.tool };
        }));
        const ys = [...new Set(rows.map((r) => r.y))].sort((a, b) => a - b);
        assert.equal(ys.length, lines, `${mode}: ${lines} row(s) ${JSON.stringify(ys)}`);
        if (lines > 1) assert.ok(ys[1] - ys[0] >= 44, `${mode}: a finger's target apart: ${ys[1] - ys[0]}`);
        // Filled line by line: the first row's buttons, left to right, are the first tools.
        const first = rows.filter((r) => r.y === ys[0]);
        assert.deepEqual(rows.slice(0, first.length), first, "the first line is the first tools");
        assert.ok(first.every((r, i) => i === 0 || r.x > first[i - 1].x));
        const { w, h } = await p.page.evaluate(() => ({ w: innerWidth, h: innerHeight }));
        for (const r of rows) assert.ok(r.x >= 0 && r.y >= 0 && r.x + r.w <= w && r.y + r.h <= h, `${r.tool} wholly on screen`);
        assert.equal(await p.page.$eval('.panel[data-panel="toolbar"]', (el) => (el as HTMLElement).dataset.lines), String(lines));
        const said = await p.page.evaluate(async () => {
          const r = await (window as unknown as { __neocad: { repl: { eval(s: string): Promise<{ value: unknown }> } } }).__neocad.repl.eval("layout()");
          return String(r.value);
        });
        if (lines > 1) assert.match(said, /toolbar .* row ×2/, "and layout() says so");
        else assert.match(said, /toolbar .* row(?! ×)/, "and layout() says so");
      }
    } finally {
      await p.context.close();
    }
  });
}

/** A finger held on `(x, y)` for the tooltip's hold, the tip's box read while it is still down, then lifted. */
async function heldTip(p: Phone, x: number, y: number, picture?: string): Promise<Box | null> {
  await p.cdp.send("Input.dispatchTouchEvent", { type: "touchStart", touchPoints: [{ x, y, id: 1, radiusX: 8, radiusY: 8, force: 1 }] });
  await p.page.waitForTimeout(750);
  const tip = await p.page.$eval("#tooltip", (el) => {
    if ((el as HTMLElement).hidden) return null;
    const r = el.getBoundingClientRect();
    return { x: r.x, y: r.y, w: r.width, h: r.height };
  });
  if (picture) await shot(p.page, picture); // while it is up: lifted, it lingers and goes
  await p.cdp.send("Input.dispatchTouchEvent", { type: "touchEnd", touchPoints: [] });
  await p.page.waitForTimeout(1700); // its linger
  return tip;
}

const buttons = (page: Page, selector: string) => page.$$eval(selector, (bs) => bs.map((b) => {
  const r = b.getBoundingClientRect();
  return { x: r.x, y: r.y, w: r.width, h: r.height };
}));

for (const ph of [THIRTEEN, SE]) {
  test(`${ph.name}: a held tooltip on a tray button covers none of its neighbours — down the column, along both rows, on the action strip`, async () => {
    const p = await phone();
    try {
      for (const turn of ["portrait", "landscape"] as const) {
        await hold(p, ph, turn, "installed");
        for (const tray of ["#toolbar button", "#actions button"]) {
          const bs = await buttons(p.page, tray);
          // The sixth tool (or the strip's second button), and the last — on the
          // second line where the tray wrapped. Not the fifth: that is the shapes
          // group's button, whose hold opens its flyout instead (toolbar-groups.md).
          for (const i of tray.startsWith("#toolbar") ? [5, bs.length - 1] : [1]) {
            const b = bs[i];
            const tip = await heldTip(p, b.x + b.w / 2, b.y + b.h / 2, `tip-${slug(ph)}-${turn}-${tray.slice(1, 8)}-${i}`);
            assert.ok(tip, `${ph.name} ${turn}: ${tray} ${i} showed its tip`);
            bs.forEach((n, k) => assert.ok(!intersect(tip!, n), `${ph.name} ${turn}: the tip of ${tray} ${i} covers button ${k}: ${JSON.stringify({ tip, n })}`));
          }
        }
      }
      assert.deepEqual(errors, []);
    } finally {
      await p.context.close();
    }
  });
}

test("iPhone 13: a pane docked against a tray keeps lying along it when a rotation wraps the tray, and back", async () => {
  const p = await phone();
  try {
    await hold(p, THIRTEEN, "portrait", "installed");
    // Stored as the viewer would leave them, docked: the toolbar a column
    // against the left edge, the log against its right two thirds of the way
    // down it, the rest at their defaults. (The gestures that dock are
    // chrome.e2e.ts's; this is about what a rotation does with the docking.)
    // The left edge, because a landscape phone's defaults put a column of
    // panes down the right edge: a tray docked there would push them, and
    // they the log, which is the resolver keeping everything apart — not the
    // docking this is about.
    const area = { w: 390, h: 844 - 47 - 34 };
    const col = { w: 34, h: 21 + 6 + 13 * 44 };
    const stored = {
      panels: {
        toolbar: { at: { x: 0, y: 60, ...col, orient: "column", area, scale: 1.3, dock: { left: "edge" } } },
        log: { at: { x: col.w, y: 460, w: 200, h: 60, area, scale: 1.3, dock: { left: "toolbar" }, oy: 400 } },
      },
    };
    await p.page.evaluate((s) => localStorage.setItem("neocad.panels.v3", JSON.stringify(s)), stored);
    await forgetAutosave(p.page);
    await p.page.reload({ waitUntil: "networkidle" });
    await ready(p.page);
    // Thirteen buttons, as this was written for: the toolbar had eleven from
    // one circle tool and one arc (docs/plans/one-circle-one-arc.md) and two
    // tools defined at the command line here put back the length this rotation
    // was measured at; since the dimension and constrain tools
    // (docs/plans/sketch-relations.md, one button as the relate group) and
    // the curves group's button (docs/plans/sketch-shapes.md) it has thirteen
    // of its own. What is under test is the docking, not the count. (At eleven
    // the landscape column is two lines, too tall to start under the logo's
    // corner from where the portrait one stood, and the resolver sets it beside
    // the corner instead: TODO.md, found by this package.)
    await p.page.waitForTimeout(250);
    const check = async (turn: Turn, lines: string) => {
      const c = await chrome(p.page);
      const [tb, log] = [c.panes.toolbar, c.panes.log];
      assert.equal(Math.round(tb.x), 0, `${turn}: the tray against the left edge, reaching under any inset`);
      assert.equal(await p.page.$eval('.panel[data-panel="toolbar"]', (el) => (el as HTMLElement).dataset.lines), lines, `${turn}: ${lines} line(s)`);
      assert.ok(tb.h > tb.w, `${turn}: still a column`);
      assert.equal(Math.round(log.x), Math.round(tb.x + tb.w), `${turn}: the log against its right ${JSON.stringify({ tb, log })}`);
      assert.ok(log.y >= tb.y - 0.5 && log.y + log.h <= tb.y + tb.h + 0.5, `${turn}: wholly along it, not off its end ${JSON.stringify({ tb, log })}`);
      assert.deepEqual(await breaches(p.page), [], turn);
      assert.deepEqual(errors, [], `${turn}: no layout problem reported`);
    };
    await check("portrait", "1");
    await shot(p.page, "dock-wrap-portrait");
    await hold(p, THIRTEEN, "landscape", "installed", false);
    await check("landscape", "3");
    await shot(p.page, "dock-wrap-landscape");
    await hold(p, THIRTEEN, "portrait", "installed", false);
    await check("portrait", "1");
  } finally {
    await p.context.close();
  }
});

test("nothing the pages threw went uncaught", () => {
  assert.deepEqual(errors, []);
});
