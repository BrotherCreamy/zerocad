// No title bar (docs/plans/chrome-logo-scale.md), in a browser: the logo over
// the drawing and the app menu it opens; the interface size — each device's
// own 100 %, drawn small and hit at 44 under a finger — and what it scales;
// panels to the very edge of an iPhone's glass with its real safe-area
// insets; panes hidden and shown; and docking that survives a rotation.
//
// The phone is Chromium's iPhone 13 at home-screen size (390×844, standalone:
// no browser bars) with iOS's insets set through CDP's
// `Emulation.setSafeAreaInsetsOverride` — the descriptor alone reports none,
// and "clear of the notch" would only pass. Not Safari: Dynamic Type and the
// real keyboard are the owner's to see.
//
// Set NEOCAD_E2E_SHOTS to a directory to keep pictures — portrait and
// landscape at three sizes, and the desktop — and look at them.

import { test, after } from "node:test";
import assert from "node:assert/strict";
import { mkdirSync } from "node:fs";
import { join } from "node:path";
import { devices, type Browser, type BrowserContext, type CDPSession, type Page } from "playwright";
import { APP_URL, forgetAutosave, launchBrowser } from "./harness.ts";

const SHOTS = process.env.NEOCAD_E2E_SHOTS;
const INSETS = {
  portrait: { top: 47, right: 0, bottom: 34, left: 0 },
  landscape: { top: 0, right: 47, bottom: 21, left: 47 },
};
const SIZE = { portrait: { width: 390, height: 844 }, landscape: { width: 844, height: 390 } };
type Orientation = keyof typeof INSETS;

let browser: Browser | null = null;
const errors: string[] = [];
async function theBrowser(): Promise<Browser> {
  browser ??= await launchBrowser();
  return browser;
}
after(async () => { await browser?.close(); });

interface Phone { context: BrowserContext; page: Page; cdp: CDPSession }

async function ready(page: Page): Promise<void> {
  await page.waitForFunction(() => document.getElementById("status")?.textContent?.includes("ready"), null, { timeout: 20_000 });
}

/** An iPhone 13 at home-screen size with iOS's insets, the app loaded. */
async function phone(orientation: Orientation = "portrait", context?: BrowserContext): Promise<Phone> {
  const { defaultBrowserType: _webkit, ...device } = devices["iPhone 13"];
  const ctx = context ?? await (await theBrowser()).newContext({ ...device, viewport: SIZE[orientation] });
  const page = await ctx.newPage();
  page.on("pageerror", (e) => errors.push(String(e)));
  const cdp = await ctx.newCDPSession(page);
  await cdp.send("Emulation.setSafeAreaInsetsOverride", { insets: INSETS[orientation] });
  await page.goto(APP_URL, { waitUntil: "networkidle" });
  await ready(page);
  await page.evaluate(() => (document.activeElement as HTMLElement | null)?.blur());
  return { context: ctx, page, cdp };
}

async function rotate(p: Phone, orientation: Orientation): Promise<void> {
  await p.page.setViewportSize(SIZE[orientation]);
  await p.cdp.send("Emulation.setSafeAreaInsetsOverride", { insets: INSETS[orientation] });
  await p.page.waitForTimeout(400);
}

async function desktop(): Promise<Page> {
  const page = await (await theBrowser()).newPage({ viewport: { width: 1100, height: 800 } });
  page.on("pageerror", (e) => errors.push(String(e)));
  await page.goto(APP_URL, { waitUntil: "networkidle" });
  await ready(page);
  return page;
}

interface Box { x: number; y: number; w: number; h: number; right: number; bottom: number }
const boxOf = (page: Page, selector: string) => page.$eval(selector, (el) => {
  const r = el.getBoundingClientRect();
  return { x: r.x, y: r.y, w: r.width, h: r.height, right: r.right, bottom: r.bottom };
}) as Promise<Box>;
const panel = (id: string) => `.panel[data-panel="${id}"]`;
const repl = (page: Page, src: string) => page.evaluate(async (s) => {
  const r = await (window as unknown as { __neocad: { repl: { eval(s: string): Promise<{ ok: boolean; value: unknown; error?: Error }> } } })
    .__neocad.repl.eval(s);
  return { ok: r.ok, value: r.value, error: r.error?.message };
}, src);
const log = (page: Page) => page.$eval("#log", (el) => el.textContent ?? "");
const view = (page: Page) => page.evaluate(() =>
  ({ ...(window as unknown as { __neocad: { engine: { view: Record<string, unknown> } } }).__neocad.engine.view }));

/** What is on top at each point, by what it is: the canvas, the logo, a panel, or something else. */
const topAt = (page: Page, points: [number, number][]) => page.evaluate((pts) => pts.map(([x, y]) => {
  const el = document.elementFromPoint(x, y);
  if (!el) return "nothing";
  if (el.id === "cv") return "canvas";
  if (el.closest("#logo")) return "logo";
  // The mode chip's parts (docs/plans/mode-feedback.md): the plane's name, its
  // Done and the tool's name each take a press; nothing else in the corner does.
  if (el.closest("#mode button")) return "chip";
  const p = el.closest<HTMLElement>(".panel[data-panel]");
  return p ? `panel ${p.dataset.panel}` : el.id || el.tagName;
}), points);

/** A one-finger drag through CDP's touch input, in page pixels. */
async function fingerDrag(cdp: CDPSession, from: [number, number], to: [number, number], steps = 12): Promise<void> {
  const at = (x: number, y: number) => [{ x, y, id: 1, radiusX: 8, radiusY: 8, force: 1 }];
  // A frame apart, as a hand's moves arrive: the touch recogniser tells a
  // drag from a tap and a hold by time as well as distance.
  const frame = () => new Promise((r) => setTimeout(r, 16));
  await cdp.send("Input.dispatchTouchEvent", { type: "touchStart", touchPoints: at(...from) });
  await frame();
  for (let i = 1; i <= steps; i++) {
    await cdp.send("Input.dispatchTouchEvent", {
      type: "touchMove", touchPoints: at(from[0] + ((to[0] - from[0]) * i) / steps, from[1] + ((to[1] - from[1]) * i) / steps),
    });
    await frame();
  }
  await cdp.send("Input.dispatchTouchEvent", { type: "touchEnd", touchPoints: [] });
}

/** The first point of the drawing a fingertip can land on clear all round — off every panel and menu. */
const bareCanvas = (page: Page) => page.evaluate(() => {
  const cv = document.getElementById("cv")!;
  const bare = (x: number, y: number) => [[0, 0], [-14, 0], [14, 0], [0, -14], [0, 14]]
    .every(([dx, dy]) => document.elementFromPoint(x + dx, y + dy) === cv);
  for (let y = innerHeight - 120; y > 60; y -= 20) for (let x = innerWidth - 30; x > 30; x -= 20) if (bare(x, y)) return [x, y] as [number, number];
  return null;
});

async function fingerTap(cdp: CDPSession, x: number, y: number): Promise<void> {
  await cdp.send("Input.dispatchTouchEvent", { type: "touchStart", touchPoints: [{ x, y, id: 1, radiusX: 8, radiusY: 8, force: 1 }] });
  await cdp.send("Input.dispatchTouchEvent", { type: "touchEnd", touchPoints: [] });
}

/** A panel dragged by its strip, by a finger, from the strip's middle. */
async function dragStrip(p: Phone, id: string, dx: number, dy: number): Promise<void> {
  const s = await boxOf(p.page, `${panel(id)} > .ptitle`);
  const [x, y] = [s.x + s.w / 2, s.y + s.h / 2];
  await fingerDrag(p.cdp, [x, y], [x + dx, y + dy], 16);
  await p.page.waitForTimeout(120);
}

async function shot(page: Page, name: string): Promise<void> {
  if (!SHOTS) return;
  mkdirSync(SHOTS, { recursive: true });
  await page.waitForTimeout(150);
  await page.screenshot({ path: join(SHOTS, `chrome-${name}.png`) });
}

// --- no title bar ----------------------------------------------------------

test("desktop: no header; the logo top-left; the status beside it; only the logo and the chip's parts take a press in the corner", async () => {
  const page = await desktop();
  try {
    assert.equal(await page.$$eval("header", (h) => h.length), 0, "there is no title bar");
    const cv = await boxOf(page, "#cv");
    assert.deepEqual([cv.x, cv.y, cv.w, cv.h], [0, 0, 1100, 800], "the drawing is the whole window");
    const logo = await boxOf(page, "#logo");
    assert.deepEqual([logo.x, logo.y], [0, 0]);
    const mark = await boxOf(page, "#logo svg");
    assert.ok(mark.h >= 18 && mark.h <= 28, `the mark is tiny: ${mark.h}px`);
    const status = await boxOf(page, "#status");
    assert.ok(status.x >= logo.right && status.y < logo.bottom, "the status after the logo, in its row");
    // Every point of the corner band but the logo and the mode chip's parts —
    // the tool's name, with nothing armed: Select, and no plane — is the
    // drawing's, the status included.
    const parts = await page.$$eval("#mode button", (bs) => bs.filter((b) => b.getClientRects().length).map((b) => {
      const r = b.getBoundingClientRect();
      return { x: r.x, y: r.y, right: r.right, bottom: r.bottom };
    }));
    assert.equal(parts.length, 1, "with no plane, the chip's one part that is a button is the tool's name");
    const band: [number, number][] = [];
    for (let x = 2; x < 400; x += 12) for (let y = 2; y < 40; y += 9) band.push([x, y]);
    const tops = await topAt(page, band);
    band.forEach(([x, y], i) => {
      const inLogo = x < logo.right && y < logo.bottom;
      const inChip = parts.some((r) => x >= r.x && x < r.right && y >= r.y && y < r.bottom);
      assert.equal(tops[i], inLogo ? "logo" : inChip ? "chip" : "canvas", `at (${x}, ${y})`);
    });
    // A right-drag that starts on the status text orbits the drawing.
    const before = await view(page);
    await page.mouse.move(status.x + 10, status.y + status.h / 2);
    await page.mouse.down({ button: "right" });
    await page.mouse.move(status.x + 120, status.y + 60, { steps: 8 });
    await page.mouse.up({ button: "right" });
    assert.notDeepEqual((await view(page)).right, before.right, "the drag reached the canvas and turned the view");
    await shot(page, "desktop");
  } finally {
    await page.close();
  }
});

for (const orientation of ["portrait", "landscape"] as const) {
  test(`iPhone 13 ${orientation}, real insets: the logo inside the safe area, the drawing to the glass, a drag beside the logo reaches the canvas`, async () => {
    const p = await phone(orientation);
    try {
      const ins = INSETS[orientation];
      const size = SIZE[orientation];
      const cv = await boxOf(p.page, "#cv");
      assert.deepEqual([cv.x, cv.y, cv.w, cv.h], [0, 0, size.width, size.height], "the drawing runs under the status bar and the home indicator");
      const logo = await boxOf(p.page, "#logo");
      assert.deepEqual([logo.x, logo.y], [ins.left, ins.top], "the logo at the safe area's corner");
      assert.ok(logo.w >= 44 && logo.h >= 44, `and a finger's target: ${logo.w}×${logo.h}`);
      const mark = await boxOf(p.page, "#logo svg");
      assert.ok(mark.h >= 22 && mark.h <= 28, `drawn ${mark.h}px — the spec's 22–28`);
      const status = await boxOf(p.page, "#status");
      assert.ok(status.y >= ins.top && status.x >= logo.right, "the status inside the safe area, after the logo");
      // On the status is the drawing; beside the logo is the mode chip's tool
      // name, which takes a press (docs/plans/mode-feedback.md), or the drawing.
      const tops = await topAt(p.page, [[logo.right + 6, logo.y + logo.h / 2], [status.x + 5, status.y + status.h / 2]]);
      assert.ok(["canvas", "chip"].includes(tops[0]), `beside the logo: ${tops[0]}`);
      assert.equal(tops[1], "canvas", "on the status is the drawing");
      const before = await view(p.page);
      // A fingertip clear of the logo: the browser moves a touch that lands
      // within a finger's width of a button onto the button (touch
      // adjustment — measured: 16 px off the logo's edge went to the logo), as
      // a phone does. 40 px right of it, on the status, is the drawing's.
      const near: [number, number][] = [[logo.right + 40, logo.y + logo.h / 2], [logo.x + logo.w / 2, logo.bottom + 40]];
      const free = (await topAt(p.page, near)).indexOf("canvas");
      assert.ok(free >= 0, "beside the logo, right of it or under it, is the drawing");
      const [sx, sy] = near[free];
      await fingerDrag(p.cdp, [sx, sy], [sx + 80, sy + 200]);
      await p.page.waitForTimeout(150);
      const after = await view(p.page);
      assert.notDeepEqual([after.right, after.up], [before.right, before.up], "one finger from beside the logo turned the drawing");
    } finally {
      await p.context.close();
    }
  });
}

test("the logo opens the app menu; Escape closes it; a tap outside closes it and draws nothing", async () => {
  const p = await phone();
  try {
    const logo = await boxOf(p.page, "#logo");
    await fingerTap(p.cdp, logo.x + logo.w / 2, logo.y + logo.h / 2);
    await p.page.waitForTimeout(150);
    assert.equal(await p.page.$eval("#appmenu", (m) => (m as HTMLElement).hidden), false, "open");
    const menu = await boxOf(p.page, "#appmenu");
    assert.ok(menu.y >= logo.bottom - 1 && menu.x <= logo.x + 1, "anchored under the logo");
    const sections = await p.page.$$eval("#appmenu .sect", (s) => s.map((e) => (e as HTMLElement).dataset.section));
    assert.deepEqual(sections, ["File", "Interface size", "Panes", "View", "About"]);
    await p.page.keyboard.press("Escape");
    assert.equal(await p.page.$eval("#appmenu", (m) => (m as HTMLElement).hidden), true, "Escape closed it");
    await fingerTap(p.cdp, logo.x + logo.w / 2, logo.y + logo.h / 2);
    await p.page.waitForTimeout(150);
    await repl(p.page, 'arm("point")');
    const count = () => p.page.evaluate(() => (window as unknown as { __neocad: { model: { entities: Map<string, unknown> } } }).__neocad.model.entities.size);
    const before = await count();
    const away = await bareCanvas(p.page);
    assert.ok(away, "somewhere off the menu to tap");
    await fingerTap(p.cdp, ...away!);
    await p.page.waitForTimeout(200);
    assert.equal(await p.page.$eval("#appmenu", (m) => (m as HTMLElement).hidden), true, "a tap outside closed it");
    assert.equal(await count(), before, "and the tap that closed it placed no point");
  } finally {
    await p.context.close();
  }
});

test("File: the items type the files package's commands and the STEP export; one whose command is gone is off with its reason; the name line is the document's", async () => {
  const page = await desktop();
  try {
    await page.click("#logo");
    const items = await page.$$eval("#appmenu .sect[data-section=File] .item", (els) =>
      els.map((e) => [(e as HTMLElement).dataset.command, e.classList.contains("off")]));
    assert.deepEqual(items, [["newFile()", false], ["openFile()", false], ["saveFile()", false], ["shareFile()", false], ["exportStep()", false]],
      "all five, on: the files package and step export define them");
    assert.equal(await page.$eval("#appmenu .docname", (e) => e.textContent ?? ""), "Untitled", "a fresh document, clean");
    // New types newFile() through the command line, as every item types.
    await page.click('#appmenu .item[data-command="newFile()"]');
    await page.waitForTimeout(200);
    assert.match(await log(page), /> newFile\(\)/);
    assert.equal(await page.$eval("#appmenu", (m) => (m as HTMLElement).hidden), true, "and closed the menu");
    // An edit makes the document dirty: the name line says so.
    await repl(page, "pt(1, 2)");
    await page.click("#logo");
    assert.equal(await page.$$eval("#appmenu .docname .dirty", (d) => d.length), 1, "the unsaved dot");
    await page.keyboard.press("Escape");
    // A command the scope no longer has: its item is off, and says why.
    await repl(page, "shareFile = undefined");
    await page.click("#logo");
    const off = await page.$eval('#appmenu .item[data-command="shareFile()"]', (e) => [e.classList.contains("off"), (e as HTMLElement).dataset.why]);
    assert.deepEqual(off, [true, "shareFile() is not in this build yet"]);
  } finally {
    await page.close();
  }
});

// --- the interface size ----------------------------------------------------

/** A drawing with a dimension label and a mark on it. */
async function dimensioned(page: Page): Promise<void> {
  await repl(page, "plane()");
  await repl(page, "pt(-25,-15); pt(25,-15); pt(25,15); pt(-25,15)");
  await repl(page, 'ln("p4","p5"); ln("p5","p6"); ln("p6","p7"); ln("p7","p4"); par("l1", xaxis()); dist("p4","p5", 50); refresh()');
}

/** Each glyph's box, and the font the canvas drew each label in. */
async function marks(page: Page): Promise<{ label: { halfW: number; halfH: number; font: string }; mark: { halfH: number } }> {
  return page.evaluate(() => {
    const nc = (window as unknown as { __neocad: { engine: { glyphs(): { isLabel: boolean; halfW: number; halfH: number; symbol: string }[] }; render(): void } }).__neocad;
    const g = (document.getElementById("cv") as HTMLCanvasElement).getContext("2d")!;
    const fonts: Record<string, string> = {};
    const real = g.fillText;
    g.fillText = function (this: CanvasRenderingContext2D, text: string, x: number, y: number) {
      fonts[text] = this.font;
      return real.call(this, text, x, y);
    } as typeof g.fillText;
    (window as unknown as { __neocad: { render(): void } }).__neocad.render();
    g.fillText = real;
    const gl = nc.engine.glyphs();
    const label = gl.find((m) => m.isLabel)!;
    const mark = gl.find((m) => !m.isLabel)!;
    return { label: { halfW: label.halfW, halfH: label.halfH, font: fonts[label.symbol] }, mark: { halfH: mark.halfH } };
  });
}

test("desktop: 100 % is today's look — 20 px buttons, the same glyphs — and the spin box reads 100%", async () => {
  const page = await desktop();
  try {
    assert.equal(await page.$eval("#toolbar button", (b) => (b as HTMLElement).offsetWidth), 20);
    await dimensioned(page);
    const m = await marks(page);
    assert.equal(m.mark.halfH, 8);
    assert.match(m.label.font, /^12px /);
    await page.click("#logo");
    assert.equal(await page.$eval("#appmenu .spin .val", (e) => e.textContent), "100%");
  } finally {
    await page.close();
  }
});

test("iPhone 13: 100 % is the phone's own — buttons drawn 1.3 × the desktop's, every one hit over 44 px; the spin box reads 100%", async () => {
  const p = await phone();
  try {
    await p.page.$eval("#logo", (l) => (l as HTMLElement).click());
    assert.equal(await p.page.$eval("#appmenu .spin .val", (e) => e.textContent), "100%");
    await p.page.keyboard.press("Escape");
    const b = await p.page.$$eval("#toolbar button", (bs) => bs.map((el) => {
      const r = el.getBoundingClientRect();
      const before = getComputedStyle(el, "::before");
      return { w: r.width, h: r.height, x: r.x + r.width / 2, y: r.y + r.height / 2, hitW: parseFloat(before.width), hitH: parseFloat(before.height), tool: (el as HTMLElement).dataset.tool };
    }));
    assert.equal(b[0].w, 26, `drawn at 1.3 × 20: ${b[0].w}`);
    for (const one of b) assert.ok(one.hitW >= 44 && one.hitH >= 44, `${one.tool}'s hit box ${one.hitW}×${one.hitH}`);
    // And a press does land on it 21 px off its middle either way, along the
    // tray and across it — not on its neighbour, not on the drawing.
    const hits = await p.page.evaluate((bs) => bs.flatMap(({ x, y, tool }) =>
      [[0, -21], [0, 21], [-21, 0], [21, 0]].map(([dx, dy]) => {
        const el = document.elementFromPoint(x + dx, y + dy)?.closest<HTMLElement>("button");
        return el?.dataset.tool === tool ? null : `${tool} at (${dx}, ${dy}): ${el?.dataset.tool ?? document.elementFromPoint(x + dx, y + dy)?.id}`;
      })).filter(Boolean), b);
    assert.deepEqual(hits, []);
    // The strips are drawn thin and grabbed over 44.
    const strip = await p.page.$eval(`${panel("cmd")} > .ptitle`, (el) => ({ h: el.getBoundingClientRect().height, hit: parseFloat(getComputedStyle(el, "::before").height) }));
    assert.ok(strip.h < 30 && strip.hit >= 44, `the command line's strip drawn ${strip.h}, hit ${strip.hit}`);
    await shot(p.page, "portrait-100");
  } finally {
    await p.context.close();
  }
});

test("ui({ scale }) changes a tool button's size, a glyph's drawn size and a dimension label's font — and survives a reload", async () => {
  const page = await desktop();
  try {
    await dimensioned(page);
    const at1 = await marks(page);
    const r = await repl(page, "ui({ scale: 1.5 })");
    assert.ok(r.ok, r.error ?? "");
    assert.match(String(r.value), /interface 150%/);
    assert.equal(await page.$eval("#toolbar button", (b) => (b as HTMLElement).offsetWidth), 30);
    const at15 = await marks(page);
    assert.equal(at15.mark.halfH, at1.mark.halfH * 1.5, "a glyph's box — its drawn size, and its hit box");
    assert.ok(Math.abs(at15.label.halfW - at1.label.halfW * 1.5) < 1e-9);
    assert.match(at15.label.font, /^18px /, "the dimension label's type");
    assert.equal((await repl(page, "journal()")).value?.toString().includes("ui("), false, "nothing journalled");
    await forgetAutosave(page);
    await page.reload({ waitUntil: "networkidle" });
    await ready(page);
    assert.equal(await page.$eval("#toolbar button", (b) => (b as HTMLElement).offsetWidth), 30, "kept, on this device");
    const held = await repl(page, "ui({ scale: 9 })");
    assert.match(String(held.value), /held to 160%/);
    const bad = await repl(page, 'ui({ zoom: 2 })');
    assert.equal(bad.ok, false);
    assert.match(bad.error!, /ui\(\) takes scale, show and hide/);
    await repl(page, 'ui({ scale: "default" })');
    assert.equal(await page.$eval("#toolbar button", (b) => (b as HTMLElement).offsetWidth), 20);
  } finally {
    await page.close();
  }
});

test("the spin box: − and + step 10 %, finger-sized; the number goes back to 100 %; each types ui({ scale })", async () => {
  const p = await phone();
  try {
    const open = async () => {
      const logo = await boxOf(p.page, "#logo");
      await fingerTap(p.cdp, logo.x + logo.w / 2, logo.y + logo.h / 2);
      await p.page.waitForTimeout(150);
    };
    await open();
    for (const sel of [".dec", ".val", ".inc"]) {
      const b = await boxOf(p.page, `#appmenu .spin ${sel}`);
      assert.ok(b.w >= 44 && b.h >= 44, `${sel} is a finger's target: ${b.w}×${b.h}`);
    }
    const tap = async (sel: string) => {
      const b = await boxOf(p.page, `#appmenu .spin ${sel}`);
      await fingerTap(p.cdp, b.x + b.w / 2, b.y + b.h / 2);
      await p.page.waitForTimeout(200);
    };
    const reads = () => p.page.$eval("#appmenu .spin .val", (e) => e.textContent);
    await tap(".dec");
    assert.equal(await reads(), "90%", "the menu stays open, showing it");
    assert.match(await log(p.page), /> ui\(\{ scale: 0\.9 \}\)/);
    assert.equal(await p.page.$eval("#toolbar button", (b) => (b as HTMLElement).offsetWidth), Math.round(20 * 1.3 * 0.9));
    for (let i = 0; i < 4; i++) await tap(".dec");
    assert.equal(await reads(), "60%");
    assert.equal(await p.page.$eval("#appmenu .spin .dec", (b) => (b as HTMLButtonElement).disabled), true, "the end is off");
    await tap(".val");
    assert.equal(await reads(), "100%");
    assert.match(await log(p.page), /> ui\(\{ scale: "default" \}\)/);
    await tap(".inc");
    assert.equal(await reads(), "110%");
    await shot(p.page, "portrait-menu");
  } finally {
    await p.context.close();
  }
});

test("at the smallest size a point is still picked at a finger's reach", async () => {
  const p = await phone();
  try {
    await repl(p.page, "ui({ scale: 0.6 })");
    await repl(p.page, "plane()");
    const made = await repl(p.page, "pt(30, -40)");
    const name = String(made.value);
    const [x, y] = await p.page.evaluate((n) => {
      const nc = (window as unknown as { __neocad: { model: { coords(n: string): number[] }; engine: { worldToScreen(w: number[]): [number, number] } } }).__neocad;
      return nc.engine.worldToScreen(nc.model.coords(n));
    }, name);
    // 18 px off — inside a finger's 22, three times a mouse's 8 at this size's
    // dot of 3 px. The drawn dot shrank; the reach did not.
    await fingerTap(p.cdp, x + 18, y);
    await p.page.waitForTimeout(200);
    assert.deepEqual((await repl(p.page, "sel()")).value, [name]);
  } finally {
    await p.context.close();
  }
});

// --- to the very edge --------------------------------------------------------

test("portrait: the command line is docked to the bottom by default — its ground to the glass, its input above the home indicator", async () => {
  const p = await phone();
  try {
    const cmd = await boxOf(p.page, panel("cmd"));
    assert.deepEqual([cmd.x, cmd.right, cmd.bottom], [0, 390, 844], "edge to edge, on the screen's bottom");
    const input = await boxOf(p.page, "#cmd");
    assert.ok(input.bottom <= 844 - 34, `the input above the inset: ${input.bottom}`);
    assert.equal(await p.page.$eval(panel("cmd"), (el) => (el as HTMLElement).dataset.bleed), "bottom");
  } finally {
    await p.context.close();
  }
});

test("dragged up and back down, the command line docks with its bottom at the screen's bottom and its input above the inset", async () => {
  const p = await phone();
  try {
    // Up off the bottom — not far: the tray's column ends a little above it.
    await dragStrip(p, "cmd", 0, -60);
    const up = await boxOf(p.page, panel("cmd"));
    assert.ok(up.bottom < 844 - 34 - 20, `moved up: ${up.bottom}`);
    assert.equal(await p.page.$eval(panel("cmd"), (el) => (el as HTMLElement).dataset.bleed ?? ""), "", "floating: drawn where it is");
    await dragStrip(p, "cmd", 0, 600);
    const down = await boxOf(p.page, panel("cmd"));
    assert.equal(down.bottom, 844, "its bottom edge is the screen's");
    const input = await boxOf(p.page, "#cmd");
    assert.ok(input.bottom <= 844 - 34);
    await shot(p.page, "portrait-docked");
  } finally {
    await p.context.close();
  }
});

// --- panes -----------------------------------------------------------------

test("a pane hidden from the menu is gone, stays gone through a reload, and comes back where it was", async () => {
  const page = await desktop();
  try {
    await page.click("#logo");
    const listed = await page.$$eval("#appmenu .item.check", (els) => els.map((e) => (e as HTMLElement).dataset.pane));
    const present = await page.$$eval(".panel[data-panel]", (els) => els.map((e) => (e as HTMLElement).dataset.panel));
    assert.deepEqual(listed, present, "a box per panel the page has, in its order — none hard-coded");
    const was = await boxOf(page, panel("log"));
    await page.click('#appmenu .item.check[data-pane="log"] input');
    await page.waitForTimeout(150);
    assert.equal(await page.$eval(panel("log"), (el) => (el as HTMLElement).hidden), true);
    assert.match(await log(page), /> ui\(\{ hide: "log" \}\)/);
    assert.equal(await page.$eval("#appmenu", (m) => (m as HTMLElement).hidden), false, "the menu stays open for the next");
    await forgetAutosave(page);
    await page.reload({ waitUntil: "networkidle" });
    await ready(page);
    assert.equal(await page.$eval(panel("log"), (el) => (el as HTMLElement).hidden), true, "kept, on this device");
    await repl(page, 'ui({ show: "log" })');
    assert.deepEqual(await boxOf(page, panel("log")), was, "back where it was");
    const bad = await repl(page, 'ui({ hide: "nope" })');
    assert.equal(bad.ok, false);
    assert.match(bad.error!, /there is no "nope" pane/);
  } finally {
    await page.close();
  }
});

// --- docking through a rotation ----------------------------------------------

test("a tray docked to the right edge and a pane against it stay so through portrait → landscape → portrait; a floating pane stays inside", async () => {
  const p = await phone();
  try {
    // **The tray here is the action strip**, where it was the toolbar until
    // Select and the Hand (docs/plans/select-hand.md): thirteen buttons at a
    // finger's 44 px pitch are a 599 px line, which in landscape turns to a
    // row along the right edge and leaves 151 px of a 750 px area beside it —
    // less than a log's least width of 160, so no pane fits against it there.
    // The strip is four buttons whatever the toolbar holds.
    //
    // The log narrowed first, out of the way of the column the strip turns
    // into; the strip right until the edge stops it, and against that edge it
    // turns, a column; the log brought down beside it, and pushed right until
    // the strip stops it.
    const se = await boxOf(p.page, `${panel("log")} > .pgrip[data-corner="se"]`);
    await fingerDrag(p.cdp, [se.right - 4, se.bottom - 4], [se.right - 4 - 250, se.bottom - 4], 12);
    await p.page.waitForTimeout(120);
    await dragStrip(p, "actions", 400, 0);
    await dragStrip(p, "log", 0, 60);
    await dragStrip(p, "log", 300, 0);
    // The command line, floating: narrowed, and lifted off every edge and every panel.
    const ne = await boxOf(p.page, `${panel("cmd")} > .pgrip[data-corner="ne"]`);
    await fingerDrag(p.cdp, [ne.right - 4, ne.y + 4], [ne.right - 4 - 150, ne.y + 4], 12);
    await p.page.waitForTimeout(120);
    await dragStrip(p, "cmd", 60, -150);
    const check = async (orientation: Orientation) => {
      const size = SIZE[orientation];
      const ins = INSETS[orientation];
      const [tb, log, line] = [await boxOf(p.page, panel("actions")), await boxOf(p.page, panel("log")), await boxOf(p.page, panel("cmd"))];
      assert.equal(tb.right, size.width, `${orientation}: the strip against the right edge — reaching under the inset to the glass`);
      assert.ok(tb.h > tb.w, `${orientation}: a column, turned by the edge`);
      assert.equal(log.right, tb.x, `${orientation}: the log against the strip's left ${JSON.stringify({ tb, log, line })}`);
      assert.ok(log.bottom > tb.y && log.y < tb.bottom, `${orientation}: beside it, not off its end`);
      assert.ok(line.x >= ins.left && line.y >= ins.top && line.right <= size.width - ins.right && line.bottom <= size.height - ins.bottom,
        `${orientation}: the floating command line inside the safe area ${JSON.stringify(line)}`);
      assert.deepEqual(errors, [], "and no two panels overlapped on the way");
    };
    await check("portrait");
    await shot(p.page, "dock-portrait");
    await rotate(p, "landscape");
    await check("landscape");
    await shot(p.page, "dock-landscape");
    await rotate(p, "portrait");
    await check("portrait");
    // And through a reload in landscape: it is what was stored, not what was on screen.
    await rotate(p, "landscape");
    await forgetAutosave(p.page);
    await p.page.reload({ waitUntil: "networkidle" });
    await ready(p.page);
    await p.page.waitForTimeout(200);
    await check("landscape");
  } finally {
    await p.context.close();
  }
});

// --- pictures ----------------------------------------------------------------

test("pictures: portrait and landscape at three sizes, with a drawing on them", { skip: !SHOTS }, async () => {
  for (const orientation of ["portrait", "landscape"] as const) {
    for (const s of [0.7, 1, 1.3]) {
      const p = await phone(orientation);
      try {
        await repl(p.page, `ui({ scale: ${s} })`);
        await dimensioned(p.page);
        await p.page.evaluate(() => (window as unknown as { __neocad: { render(): void } }).__neocad.render());
        await shot(p.page, `${orientation}-${Math.round(s * 100)}`);
      } finally {
        await p.context.close();
      }
    }
  }
});

test("nothing the pages threw went uncaught", () => {
  assert.deepEqual(errors, []);
});
