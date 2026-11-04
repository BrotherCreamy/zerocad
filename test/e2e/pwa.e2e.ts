// The hosted build, and the page that never scrolls or zooms
// (docs/plans/pwa-pages.md).
//
// The build is run here, into a private folder, and served from a sub-path —
// /zerocad/, as GitHub Pages serves the public repository the site is published from — by a static server that
// answers nothing outside it, so a URL that escapes the sub-path fails here
// as it would on Pages. With Pages' own ten-minute HTTP cache on every file,
// so a worker that fills its cache through the HTTP cache is caught too.
//
// The phone checks run in Chromium's iPhone 13 emulation, with real touch
// points through CDP. **The real device is iOS Safari, which this machine
// cannot run.** What Chromium can show is that the rules are in force and
// that each one is load-bearing: every check that something does *not*
// happen is preceded by a control in which the same driver makes it happen.
//
// Set NEOCAD_E2E_SHOTS to a directory to keep the phone screenshots; look at
// them — the safe areas a notch and a home indicator take are tinted in the
// "-safe" copies.
//
// Tests in order: the first two share a context (the second is the first's
// app gone offline).

import { test, before, after } from "node:test";
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { createServer } from "node:http";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, statSync } from "node:fs";
import { tmpdir } from "node:os";
import { extname, join, normalize } from "node:path";
import { devices, type Browser, type BrowserContext, type CDPSession, type Page } from "playwright";
import { APP_URL, launchBrowser } from "./harness.ts";

const root = new URL("../..", import.meta.url).pathname;
const BASE = "/zerocad/";
const SHOTS = process.env.NEOCAD_E2E_SHOTS;

/** The hosted build, into `out`, under a stamp of the test's choosing — which names the worker's cache. */
function buildPwa(out: string, stamp: string): void {
  const r = spawnSync(process.execPath, ["--experimental-strip-types", "scripts/pwa.ts", "--out", out, "--stamp", stamp], { cwd: root, encoding: "utf8" });
  if (r.status !== 0) throw new Error(`the PWA build failed:\n${r.stdout}\n${r.stderr}`);
}

const TYPES: Record<string, string> = {
  ".html": "text/html; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
  ".webmanifest": "application/manifest+json",
  ".png": "image/png",
  ".svg": "image/svg+xml",
};

interface Served { url: string; requests: string[]; misses: string[]; close(): Promise<void> }

/** `dir` at /zerocad/ on a free port, the way Pages serves the gh-pages branch. */
function serve(dir: string): Promise<Served> {
  const requests: string[] = [];
  const misses: string[] = [];
  const server = createServer((req, res) => {
    const path = decodeURIComponent(new URL(req.url ?? "/", "http://x").pathname);
    requests.push(path);
    if (path === BASE.slice(0, -1)) { res.writeHead(301, { location: BASE }).end(); return; }
    const rel = path.startsWith(BASE) ? normalize(path.slice(BASE.length)) : null;
    let file = rel !== null && !rel.startsWith("..") ? join(dir, rel) : null;
    if (file && existsSync(file) && statSync(file).isDirectory()) file = join(file, "index.html");
    if (!file || !existsSync(file)) { misses.push(path); res.writeHead(404).end("not found"); return; }
    res.writeHead(200, { "content-type": TYPES[extname(file)] ?? "application/octet-stream", "cache-control": "max-age=600" });
    res.end(readFileSync(file));
  });
  return new Promise((resolve) => server.listen(0, "127.0.0.1", () => {
    const { port } = server.address() as { port: number };
    resolve({
      url: `http://localhost:${port}${BASE}`,
      requests,
      misses,
      close: () => new Promise<void>((done) => { server.closeAllConnections(); server.close(() => done()); }),
    });
  }));
}

async function ready(page: Page): Promise<void> {
  await page.waitForFunction(() => document.getElementById("status")?.textContent?.includes("ready"), null, { timeout: 30_000 });
}

/** Types into the command line and presses Enter, as a user would. */
async function type(page: Page, source: string): Promise<void> {
  await page.fill("#cmd", source);
  await page.press("#cmd", "Enter");
  await page.waitForTimeout(150);
}

/** The worker that controls this page's scope, once it is active — its state and what it serves. */
async function activeWorker(page: Page): Promise<{ scope: string; script: string }> {
  return page.evaluate(async () => {
    const reg = await navigator.serviceWorker.ready;
    const worker = reg.active!;
    if (worker.state !== "activated") await new Promise((r) => worker.addEventListener("statechange", () => worker.state === "activated" && r(null)));
    return { scope: reg.scope, script: worker.scriptURL };
  });
}

const stampOf = (page: Page) => page.$eval("#buildstamp", (el) => el.textContent ?? "");
const cacheKeys = (page: Page) => page.evaluate(() => caches.keys());

/** A line drawn and its middle read off the 2D canvas: the app is drawing, not just loaded. */
async function drawsALine(page: Page): Promise<void> {
  await type(page, "a = pt(-30,-10); b = pt(30,10); ln(a, b)");
  const px = await page.evaluate(() => {
    const { engine } = (window as unknown as { __neocad: { engine: { worldToScreen(w: number[]): [number, number] } } }).__neocad;
    const [x, y] = engine.worldToScreen([0, 0, 0]);
    const cv = document.getElementById("cv") as HTMLCanvasElement;
    const dpr = cv.width / cv.getBoundingClientRect().width;
    return [...cv.getContext("2d")!.getImageData(Math.floor(x * dpr), Math.floor(y * dpr), 1, 1).data];
  });
  assert.ok(px[3] > 0, `the line's middle is drawn (got rgba ${px})`);
}

let browser: Browser;
let work: string;
before(async () => {
  browser = await launchBrowser();
  work = mkdtempSync(join(tmpdir(), "neocad-pwa-"));
});
after(async () => {
  await browser?.close();
  rmSync(work, { recursive: true, force: true });
});

// ---------------------------------------------------------------- hosting

let hosted: { context: BrowserContext; page: Page; served: Served; errors: string[] };

test("served from /zerocad/, the hosted build loads, solves and registers its worker; nothing is asked for outside the sub-path", async () => {
  const dir = join(work, "a");
  buildPwa(dir, "e2e-first");
  const served = await serve(dir);
  const context = await browser.newContext();
  const page = await context.newPage();
  const errors: string[] = [];
  page.on("pageerror", (e) => errors.push(String(e)));
  hosted = { context, page, served, errors };

  await page.goto(served.url, { waitUntil: "load" });
  await ready(page);
  assert.equal(await page.title(), "ZeroCAD");
  assert.equal(await stampOf(page), "build e2e-first");

  await type(page, 'pt(0,0); pt(10,0); dist("p1","p2",45)');
  assert.equal(await page.$eval("#status", (el) => el.textContent), "SOLVED");
  const gap = await page.evaluate(() => {
    const { model } = (window as unknown as { __neocad: { model: { coords(n: string): number[] } } }).__neocad;
    const [a, b] = [model.coords("p1"), model.coords("p2")];
    return Math.hypot(...a.map((v, i) => v - b[i]));
  });
  assert.ok(Math.abs(gap - 45) < 1e-6, `solved to 45 (got ${gap})`);

  const worker = await activeWorker(page);
  assert.equal(worker.scope, served.url, "the worker's scope is the sub-path, not the origin");
  assert.equal(worker.script, `${served.url}sw.js`);
  assert.deepEqual(await cacheKeys(page), ["zerocad-e2e-first"]);

  assert.deepEqual(served.misses, [], "every request found its file");
  for (const path of served.requests) assert.ok(path.startsWith(BASE), `${path} is under ${BASE}`);
});

test("the manifest, as an installer reads it: standalone, and every icon it and the head name resolves to a PNG of its size", async () => {
  const { page } = hosted;
  const found = await page.evaluate(async () => {
    const link = document.querySelector<HTMLLinkElement>('link[rel="manifest"]')!;
    const res = await fetch(link.href);
    const manifest = await res.json();
    const load = (url: string) => new Promise<[number, number, string]>((resolve, reject) => {
      const img = new Image();
      img.onload = () => resolve([img.naturalWidth, img.naturalHeight, url]);
      img.onerror = () => reject(new Error(`${url} did not load`));
      img.src = url;
    });
    const icons = await Promise.all((manifest.icons as { src: string; sizes: string }[]).map(async (i) => ({
      sizes: i.sizes, got: await load(new URL(i.src, res.url).href),
    })));
    const apple = await load(document.querySelector<HTMLLinkElement>('link[rel="apple-touch-icon"]')!.href);
    return {
      type: res.headers.get("content-type"),
      display: manifest.display,
      start: new URL(manifest.start_url, res.url).href,
      scope: new URL(manifest.scope, res.url).href,
      icons,
      apple,
      metas: Object.fromEntries(Array.from(document.querySelectorAll<HTMLMetaElement>("meta[name]")).map((m) => [m.name, m.content])),
    };
  });
  assert.equal(found.display, "standalone");
  assert.equal(found.start, hosted.served.url);
  assert.equal(found.scope, hosted.served.url);
  assert.ok(found.icons.length >= 3);
  for (const { sizes, got } of found.icons) assert.equal(`${got[0]}x${got[1]}`, sizes, got[2]);
  assert.deepEqual(found.apple.slice(0, 2), [180, 180]);
  assert.equal(found.metas["apple-mobile-web-app-capable"], "yes");
  assert.equal(found.metas["apple-mobile-web-app-status-bar-style"], "black-translucent");
  assert.match(found.metas.viewport, /user-scalable=no/);
  assert.deepEqual(hosted.served.misses, []);
});

test("offline after the first load — the network gone and the server stopped — it still starts, solves and draws", async () => {
  const { context, page, served, errors } = hosted;
  await context.setOffline(true);
  await served.close();
  await page.reload({ waitUntil: "load" });
  await ready(page);
  assert.ok(await page.evaluate(() => navigator.serviceWorker.controller !== null), "served by the worker");
  await drawsALine(page);
  // A second start, as from the home screen, with no window of it open.
  await page.close();
  const again = await context.newPage();
  again.on("pageerror", (e) => errors.push(String(e)));
  await again.goto(served.url, { waitUntil: "load" });
  await ready(again);
  await type(again, 'pt(0,0); pt(10,0); dist("p1","p2",45)');
  assert.equal(await again.$eval("#status", (el) => el.textContent), "SOLVED");
  assert.deepEqual(errors, []);
  await context.close();
});

test("a new deploy waits while the app is open — never swapped under the hand — and is what the next start gets", async () => {
  const dir = join(work, "update");
  buildPwa(dir, "e2e-old");
  const served = await serve(dir);
  const context = await browser.newContext();
  try {
    const page = await context.newPage();
    await page.goto(served.url, { waitUntil: "load" });
    await ready(page);
    await activeWorker(page);
    // The very first visit is not the worker's (nothing claims it), so the
    // app as it is used from then on — a start the worker serves — is a reload.
    await page.reload({ waitUntil: "load" });
    await ready(page);
    assert.ok(await page.evaluate(() => navigator.serviceWorker.controller !== null), "served by the worker");
    assert.equal(await stampOf(page), "build e2e-old");
    await type(page, "pt(5,5)");
    await page.evaluate(() => { (window as unknown as { untouched: boolean }).untouched = true; });

    buildPwa(dir, "e2e-new");
    // What a launch does on its own: ask whether the worker has changed.
    await page.evaluate(async () => {
      const reg = (await navigator.serviceWorker.getRegistration())!;
      await reg.update();
      const waiting = reg.installing ?? reg.waiting;
      if (waiting && waiting.state !== "installed") {
        await new Promise((r) => waiting.addEventListener("statechange", () => waiting.state === "installed" && r(null)));
      }
    });
    assert.deepEqual((await cacheKeys(page)).sort(), ["zerocad-e2e-new", "zerocad-e2e-old"], "the new version's cache filled beside the old");
    assert.ok(await page.evaluate(() => (window as unknown as { untouched?: boolean }).untouched), "the open app was not reloaded");
    assert.equal(await stampOf(page), "build e2e-old");
    // A second window while the first is open still gets the version in use.
    const second = await context.newPage();
    await second.goto(served.url, { waitUntil: "load" });
    await ready(second);
    assert.equal(await stampOf(second), "build e2e-old");

    // Every window closed: the next start is the new version. The browser
    // activates the waiting worker once the last window has gone, which it
    // does a moment after the close — so a start is retried, as a user
    // reopening the app would.
    await page.close();
    await second.close();
    let stamp = "";
    for (let tries = 0; tries < 20 && stamp !== "build e2e-new"; tries++) {
      await new Promise((r) => setTimeout(r, 250));
      const next = await context.newPage();
      await next.goto(served.url, { waitUntil: "load" });
      await ready(next);
      stamp = await stampOf(next);
      if (stamp === "build e2e-new") {
        await activeWorker(next);
        assert.deepEqual(await cacheKeys(next), ["zerocad-e2e-new"], "the old version's cache is gone");
      }
      await next.close();
    }
    assert.equal(stamp, "build e2e-new");
  } finally {
    await context.close();
    await served.close();
  }
});

// ---------------------------------------------------------------- the phone

type Pt = { x: number; y: number };

async function touches(cdp: CDPSession, type: "touchStart" | "touchMove" | "touchEnd", points: Pt[]): Promise<void> {
  await cdp.send("Input.dispatchTouchEvent", { type, touchPoints: points.map((p, id) => ({ ...p, id })) });
}

/** One finger from `a` to `b`, in steps, as a swipe. */
async function drag(cdp: CDPSession, a: Pt, b: Pt, steps = 12): Promise<void> {
  await touches(cdp, "touchStart", [a]);
  for (let i = 1; i <= steps; i++) await touches(cdp, "touchMove", [{ x: a.x + ((b.x - a.x) * i) / steps, y: a.y + ((b.y - a.y) * i) / steps }]);
  await touches(cdp, "touchEnd", []);
}

/** Two fingers spreading apart about `c` — the pinch that zooms a page. */
async function spread(cdp: CDPSession, c: Pt, steps = 12): Promise<void> {
  const at = (r: number) => [{ x: c.x - r, y: c.y }, { x: c.x + r, y: c.y }];
  await touches(cdp, "touchStart", at(15));
  for (let i = 1; i <= steps; i++) await touches(cdp, "touchMove", at(15 + i * 10));
  await touches(cdp, "touchEnd", []);
}

/** What would show a page moved or zoomed. */
const pageState = (page: Page) => page.evaluate(() => ({
  scrollY: window.scrollY,
  scrollTop: document.scrollingElement!.scrollTop,
  bodyTop: document.body.scrollTop,
  appTop: document.getElementById("app")?.getBoundingClientRect().top ?? 0,
  scale: visualViewport!.scale,
  offset: visualViewport!.offsetTop + visualViewport!.offsetLeft,
}));
const STILL = { scrollY: 0, scrollTop: 0, bodyTop: 0, appTop: 0, scale: 1, offset: 0 };

async function phone(options: { landscape?: boolean } = {}): Promise<{ context: BrowserContext; page: Page; cdp: CDPSession }> {
  const device = devices[options.landscape ? "iPhone 13 landscape" : "iPhone 13"];
  const context = await browser.newContext({ ...device });
  const page = await context.newPage();
  return { context, page, cdp: await context.newCDPSession(page) };
}

async function centreOf(page: Page, selector: string): Promise<Pt> {
  return page.$eval(selector, (el) => {
    const r = el.getBoundingClientRect();
    return { x: r.x + r.width / 2, y: r.y + r.height / 2 };
  });
}

test("the drivers have teeth: on an ordinary page in the same emulation, a swipe scrolls and a pinch zooms", async () => {
  const { context, page, cdp } = await phone();
  try {
    await page.setContent(`<meta name="viewport" content="width=device-width, initial-scale=1"><div style="height:3000px">tall</div>`);
    await drag(cdp, { x: 200, y: 500 }, { x: 200, y: 150 });
    await page.waitForTimeout(300);
    assert.ok((await pageState(page)).scrollY > 100, "the swipe scrolled it");
    await spread(cdp, { x: 195, y: 300 });
    await page.waitForTimeout(300);
    assert.ok((await pageState(page)).scale > 1.5, "the pinch zoomed it");
  } finally {
    await context.close();
  }
});

for (const where of ["the dev server", "the hosted build"] as const) {
  test(`iPhone 13, ${where}: a wheel, a swipe on the chrome and a pinch anywhere leave the page where it was, at scale 1`, async () => {
    let served: Served | undefined;
    if (where === "the hosted build") {
      const dir = join(work, "phone");
      if (!existsSync(dir)) buildPwa(dir, "e2e-phone");
      served = await serve(dir);
    }
    const { context, page, cdp } = await phone();
    const errors: string[] = [];
    page.on("pageerror", (e) => errors.push(String(e)));
    try {
      await page.goto(served?.url ?? APP_URL, { waitUntil: "load" });
      await ready(page);
      await page.$eval("#cmd", (el: HTMLInputElement) => el.blur());
      assert.deepEqual(await pageState(page), STILL, "at rest");

      // The logo is the chrome in the corner now that there is no header:
      // the swipes and the pinch that went to the header go to it.
      const header = await centreOf(page, "#logo");
      await page.mouse.move(header.x, header.y);
      await page.mouse.wheel(0, 600);
      await page.waitForTimeout(250);
      assert.deepEqual(await pageState(page), STILL, "after a wheel over the logo");

      await drag(cdp, header, { x: header.x, y: header.y + 400 });
      await drag(cdp, { x: header.x, y: header.y + 300 }, header);
      const tray = await centreOf(page, '.panel[data-panel="toolbar"] #toolbar');
      await drag(cdp, tray, { x: tray.x, y: tray.y - 300 });
      await page.waitForTimeout(300);
      assert.deepEqual(await pageState(page), STILL, "after swipes on the logo and the tray");

      for (const target of [header, await centreOf(page, "#cv")]) {
        await spread(cdp, target);
        await page.waitForTimeout(300);
        assert.deepEqual(await pageState(page), STILL, `after a pinch at ${JSON.stringify(target)}`);
      }

      const style = await page.evaluate(() => {
        const s = (sel: string) => getComputedStyle(document.querySelector(sel)!);
        // touch-action is not inherited, but what a touch may do is the
        // intersection over its target's ancestors — so the body's
        // `manipulation` is in force over all the chrome.
        return {
          canvas: [s("#cv").touchAction, s("#cv").userSelect],
          body: [s("body").touchAction, s("body").userSelect],
          chrome: [s("#logo").userSelect, s("#toolbar").userSelect],
          cmd: s("#cmd").userSelect,
          log: s("#log").userSelect,
        };
      });
      assert.deepEqual(style.canvas, ["none", "none"], "the canvas takes every touch itself and selects nothing");
      assert.deepEqual(style.body, ["manipulation", "none"], "the page: no double-tap zoom, no selection");
      assert.deepEqual(style.chrome, ["none", "none"], "the chrome selects nothing");
      assert.equal(style.cmd, "text", "the command line still selects");
      assert.equal(style.log, "text", "the log still selects");

      const cancelled = await page.evaluate(() => ["gesturestart", "gesturechange", "gestureend"].map((type) => {
        const e = new Event(type, { bubbles: true, cancelable: true });
        document.getElementById("cv")!.dispatchEvent(e);
        return e.defaultPrevented;
      }));
      assert.deepEqual(cancelled, [true, true, true], "WebKit's pinch events are cancelled wherever they start");
      assert.deepEqual(errors, []);
    } finally {
      await context.close();
      await served?.close();
    }
  });
}

test("iPhone 13 as iOS Safari treats it — the viewport's no-zoom ignored — a pinch on the chrome is still refused, and only because of the page lock", async () => {
  // iOS Safari ignores user-scalable=no. So the app is served with its
  // viewport's limits taken out before it is parsed, and pinched over the
  // header: once with the page lock's listeners dropped (the control: it
  // zooms), once as it is (it does not).
  const relaxed = async (page: Page, dropLock: boolean) => {
    await page.route(APP_URL, async (route) => {
      const res = await route.fetch();
      const html = (await res.text()).replace(/maximum-scale=1, user-scalable=no, /, "");
      assert.ok(!html.includes("user-scalable=no"));
      await route.fulfill({ response: res, body: html });
    });
    if (dropLock) {
      await page.addInitScript(() => {
        const real = EventTarget.prototype.addEventListener;
        EventTarget.prototype.addEventListener = function (this: EventTarget, type: string, ...rest: unknown[]) {
          if (this === document && (type === "touchmove" || type.startsWith("gesture"))) return;
          return (real as (...a: unknown[]) => void).call(this, type, ...rest);
        } as typeof real;
      });
    }
    await page.goto(APP_URL, { waitUntil: "load" });
    await ready(page);
  };
  for (const dropLock of [true, false]) {
    const { context, page, cdp } = await phone();
    try {
      await relaxed(page, dropLock);
      await spread(cdp, await centreOf(page, "#logo"));
      await page.waitForTimeout(300);
      const { scale } = await pageState(page);
      if (dropLock) assert.ok(scale > 1.5, `without the lock the pinch zooms (scale ${scale})`);
      else assert.equal(scale, 1, "with it, it does not");
      if (!dropLock) {
        // And over the drawing, where touch-action alone refuses it.
        await spread(cdp, await centreOf(page, "#cv"));
        await page.waitForTimeout(300);
        assert.equal((await pageState(page)).scale, 1);
      }
    } finally {
      await context.close();
    }
  }
});

/** iPhone 13's safe areas, in CSS pixels, as iOS reports them to a standalone app. */
const INSETS = {
  portrait: { top: 47, right: 0, bottom: 34, left: 0 },
  landscape: { top: 0, right: 47, bottom: 21, left: 47 },
};

test("iPhone 13 at home-screen size, portrait and landscape: the drawing to the glass; the logo, the status and every panel's content clear of the notch and the home indicator", async () => {
  const dir = join(work, "phone");
  if (!existsSync(dir)) buildPwa(dir, "e2e-phone");
  const served = await serve(dir);
  // Standalone: the whole screen is the app's, the status bar over it.
  const { context, page, cdp } = await phone();
  try {
    for (const orientation of ["portrait", "landscape"] as const) {
      const size = orientation === "portrait" ? { width: 390, height: 844 } : { width: 844, height: 390 };
      const inset = INSETS[orientation];
      await page.setViewportSize(size);
      await cdp.send("Emulation.setSafeAreaInsetsOverride", { insets: inset });
      if (orientation === "portrait") {
        await page.goto(served.url, { waitUntil: "load" });
        await ready(page);
        await page.$eval("#cmd", (el: HTMLInputElement) => el.blur());
      }
      await page.waitForTimeout(400);
      const safe = { left: inset.left, top: inset.top, right: size.width - inset.right, bottom: size.height - inset.bottom };
      const boxes = await page.evaluate(() => {
        const box = (el: Element) => {
          const r = el.getBoundingClientRect();
          return { left: r.left, top: r.top, right: r.right, bottom: r.bottom };
        };
        // A panel's content: its box less the padding it takes where it
        // reaches under an inset (panels.ts's bleed).
        const content = (el: HTMLElement) => {
          const r = el.getBoundingClientRect();
          const c = getComputedStyle(el);
          return { left: r.left + parseFloat(c.paddingLeft), top: r.top + parseFloat(c.paddingTop),
            right: r.right - parseFloat(c.paddingRight), bottom: r.bottom - parseFloat(c.paddingBottom) };
        };
        return {
          header: document.querySelectorAll("header").length,
          words: [document.getElementById("logo")!, ...Array.from(document.querySelectorAll("#corner > span"))]
            .filter((s) => (s as HTMLElement).offsetWidth > 0).map(box),
          drawing: box(document.getElementById("viewwrap")!),
          panels: Array.from(document.querySelectorAll<HTMLElement>(".panel[data-panel]")).filter((p) => !p.hidden).map((p) => ({ id: p.dataset.panel, ...content(p) })),
        };
      });
      const inside = (what: string, b: { left: number; top: number; right: number; bottom: number }) => {
        const tol = 0.5;
        assert.ok(b.left >= safe.left - tol && b.top >= safe.top - tol && b.right <= safe.right + tol && b.bottom <= safe.bottom + tol,
          `${orientation}: ${what} ${JSON.stringify(b)} is inside the safe area ${JSON.stringify(safe)}`);
      };
      assert.equal(boxes.header, 0, "there is no title bar");
      for (const [i, w] of boxes.words.entries()) inside(`the logo and the status #${i}`, w);
      assert.deepEqual(boxes.drawing, { left: 0, top: 0, right: size.width, bottom: size.height },
        "the drawing runs to the glass, under the status bar and the home indicator");
      for (const p of boxes.panels) inside(`the ${p.id} panel's content`, p);
      assert.deepEqual(await pageState(page), STILL);

      if (SHOTS) {
        mkdirSync(SHOTS, { recursive: true });
        await page.screenshot({ path: join(SHOTS, `pwa-iphone13-${orientation}.png`) });
        // The same with the unsafe bands tinted, to look at.
        await page.evaluate((i) => {
          for (const [side, px] of Object.entries(i)) {
            if (!px) continue;
            const d = document.createElement("div");
            d.className = "unsafe-band";
            d.style.cssText = `position:fixed;z-index:999;background:#ff00ff55;pointer-events:none;${side}:0;` +
              (side === "top" || side === "bottom" ? `left:0;right:0;height:${px}px` : `top:0;bottom:0;width:${px}px`);
            document.body.appendChild(d);
          }
        }, inset);
        await page.screenshot({ path: join(SHOTS, `pwa-iphone13-${orientation}-safe.png`) });
        await page.evaluate(() => document.querySelectorAll(".unsafe-band").forEach((d) => d.remove()));
      }
    }
  } finally {
    await context.close();
    await served.close();
  }
});
