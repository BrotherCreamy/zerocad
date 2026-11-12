// Shared setup for the end-to-end tests: a real browser driving the real app
// against a real dev server.
//
// These exist because a good deal of what this project does is only wrong
// once it is assembled. Seventy-six bugs so far were invisible to the unit tests and
// obvious within seconds of running the thing: a status readout that went
// stale, a fillet that satisfied every constraint to six decimal places while
// drawing a broken rectangle, an auto-naming loop that hung the tab, and a
// pan that silently did nothing mid-gesture. The unit suite covers the
// mathematics; this one covers the app.
//
// Run with `npm run test:e2e`. It reuses a dev server if one is already
// running on the expected port and otherwise starts and stops its own.

import { existsSync, readdirSync } from "node:fs";
import { join } from "node:path";
import { chromium, devices, type Browser, type Page } from "playwright";

/**
 * Where the app under test lives. run.ts sets this to the private server it
 * started for exactly this run; the 5173 fallback only matters when a single
 * spec file is run by hand against `npm run dev`.
 */
export const APP_URL = process.env.NEOCAD_E2E_URL ?? "http://localhost:5173/";

/**
 * WebGL on a machine with no GPU: SwiftShader, Chromium's software renderer,
 * asked for by name. A solid's faces are drawn by WebGL with a depth test
 * (src/facelayer.ts), and where the browser has no WebGL the app quietly falls
 * back to the painter's — so a suite run without it would test the fallback
 * and pass. Chromium is retiring the *automatic* fall back to SwiftShader for
 * WebGL; `--enable-unsafe-swiftshader` is its opt-in for keeping it (the
 * "unsafe" is about untrusted content on a real browser, not a test page), and
 * `--use-angle=swiftshader` pins the renderer so the pixels the tests read are
 * the same on every machine, GPU or none. (Chromium 141 here still fell back
 * without either; extrude.e2e.ts asserts the depth path is the one in use, so
 * a browser that stops doing so fails loudly rather than silently.)
 */
const SOFTWARE_GL = ["--use-angle=swiftshader", "--enable-unsafe-swiftshader"];

/**
 * Playwright refuses to launch unless the browser build it was compiled
 * against is present, and a machine may well have a different one installed
 * (a preinstalled image, a differently-pinned project). So: try the normal
 * path first, then fall back to any chromium under PLAYWRIGHT_BROWSERS_PATH,
 * and only then complain — with the command that fixes it. Exported for the
 * suites that need their own contexts (pwa.e2e.ts's phone emulation) and for
 * scripts/icons.ts, which rasterises with the same browser.
 */
export async function launchBrowser(extra: string[] = []): Promise<Browser> {
  try {
    return await chromium.launch({ args: [...SOFTWARE_GL, ...extra] });
  } catch (firstError) {
    for (const path of discoverChromium()) {
      try {
        return await chromium.launch({ executablePath: path, args: [...SOFTWARE_GL, ...extra] });
      } catch { /* try the next candidate */ }
    }
    throw new Error(
      `could not launch chromium. Install it with:\n\n    npx playwright install chromium\n\n` +
      `(original error: ${firstError instanceof Error ? firstError.message.split("\n")[0] : firstError})`,
    );
  }
}

function discoverChromium(): string[] {
  const root = process.env.PLAYWRIGHT_BROWSERS_PATH;
  if (!root || !existsSync(root)) return [];
  const found: string[] = [];
  for (const entry of readdirSync(root)) {
    if (!entry.startsWith("chromium")) continue;
    for (const rel of [
      ["chrome-linux", "chrome"],
      ["chrome-headless-shell-linux64", "chrome-headless-shell"],
      ["chrome-mac", "Chromium.app", "Contents", "MacOS", "Chromium"],
      ["chrome-win", "chrome.exe"],
    ]) {
      const candidate = join(root, entry, ...rel);
      if (existsSync(candidate)) found.push(candidate);
    }
  }
  // Prefer a full chromium over a headless shell: the shell cannot do
  // everything (downloads, some input paths) and the difference is confusing
  // to debug when it bites.
  return found.sort((a, b) => Number(b.includes("chrome-linux")) - Number(a.includes("chrome-linux")));
}

async function serverIsUp(): Promise<boolean> {
  try {
    const res = await fetch(APP_URL, { signal: AbortSignal.timeout(1500) });
    return res.ok;
  } catch {
    return false;
  }
}

/**
 * The dev server is started by run.ts, not here — see the note there. This
 * only checks it is actually up, so a test run started the wrong way fails
 * with an explanation rather than a wall of connection errors.
 */
async function requireServer(): Promise<void> {
  if (await serverIsUp()) return;
  throw new Error(
    `no dev server at ${APP_URL}. Run the suite with \`npm run test:e2e\`, which starts its own ` +
    "on a private port — or start one with `npm run dev` and point NEOCAD_E2E_URL at it.",
  );
}

export interface AppContext {
  page: Page;
  browser: Browser;
  /**
   * Canvas-relative screen coordinates -> absolute page coordinates, for a
   * point where the canvas is actually what a pointer would hit.
   *
   * The canvas is the whole window (there is no header), and nothing in the page
   * resizes it any more — the log used to, taking height as a test typed into
   * it, which is gone with the chrome becoming floating panels. What took its
   * place is the panels themselves lying *over* the canvas: a click aimed at
   * drawing that a panel covers lands on the panel and does nothing to the
   * drawing, which reads as "the feature is broken" rather than "the
   * coordinate was wrong". So this asks the browser what is on top at that
   * pixel and refuses to hand back a point a panel would take.
   */
  at(sx: number, sy: number): Promise<{ x: number; y: number }>;
  /** Types a line into the command input and presses Enter, as a user would. */
  type(source: string): Promise<void>;
  /**
   * Evaluates in the page's own REPL and returns the result. Prefer `type`
   * when the point is that a user could have typed it; use this when the
   * result value is what's being checked.
   */
  repl(source: string): Promise<{ ok: boolean; value: unknown; error?: string }>;
  /** A summary of the model, safe to send across the page boundary. */
  model(): Promise<ModelSummary>;
  /**
   * The canvas's selection, as `sel()` lists it — what a click picks with the
   * command line empty (with text in it, a click inserts the name instead).
   */
  selection(): Promise<string[]>;
  /**
   * Where a world point is drawn right now, in canvas pixels — through the
   * app's own camera, so a test can aim at geometry however the view has been
   * turned. In a view that has never been turned this is the old 2D formula
   * (`ox + x·scale`, `oy − y·scale`), which is what most of the suite still
   * computes by hand.
   */
  screenOf(world: number[]): Promise<[number, number]>;
  /**
   * RGBA at each canvas pixel, read from one of the pictures — and a test says
   * which it means:
   *
   * - `"faces"`: the WebGL canvas the solids' faces are drawn on, alone —
   *   transparent (alpha 0) where no face is. What a test about a face's
   *   shade, even-odd or which face is in front reads; the entities drawn over
   *   it are not in it. Throws when the app is drawing faces by the painter's.
   * - `"drawing"`: the 2D canvas — entities, glyphs, a tool's preview, the
   *   empty-canvas hint, and (only on the painter's fallback) the faces.
   * - `"screen"`: the composed picture, as the browser shows it — a
   *   screenshot of the canvas area, panels and all, decoded.
   *
   * Points are in the CSS pixels every other coordinate here is in, and each
   * reads the pixel that contains it — so (x + 0.5, y + 0.5) is pixel (x, y)'s
   * middle, which is where the oracle should be asked about it.
   */
  pixels(of: Picture, at: [number, number][]): Promise<number[][]>;
  /** One pixel of `pixels`. */
  pixel(sx: number, sy: number, of: Picture): Promise<number[]>;
  /**
   * Which visible face is nearest the viewer at each pixel — worked out by
   * src/occlusion.ts, the module the app dims hidden edges with, casting the
   * pixel's ray against every visible face's plane (faces.ts's
   * faces, read in the world, never through either renderer) — with the fill
   * it should have, and how far the pixel is from the nearest outline of any
   * visible face, where anti-aliasing makes any colour fair. The oracle a
   * picture is checked against.
   */
  nearestFaces(at: [number, number][]): Promise<NearestFace[]>;
  /** How the app is drawing faces: `"depth"`, or `"painter's"` where it has no WebGL. */
  renderer(): Promise<string>;
  status(): Promise<string>;
  log(): Promise<string>;
  /** Anything the page threw that nothing caught. Should always be empty. */
  pageErrors: string[];
  close(): Promise<void>;
}

/** Which picture a pixel is read from — see `AppContext.pixels`. */
export type Picture = "faces" | "drawing" | "screen";

export interface NearestFace {
  /** The face nearest the viewer at the pixel, or null where the ray meets no solid. */
  face: { id: number; feature: string; kind: string; rgb: number[] } | null;
  /** Distance in pixels to the nearest outline of any visible face. */
  edge: number;
}

export interface ModelSummary {
  size: number;
  byKind: Record<string, number>;
  points: Record<string, number[]>;
  radii: Record<string, number>;
  lines: { name: string; refs: [string, string] }[];
  /** Circles by name with the point their centre *is* — which for a free
   * circle is a point nothing named, so a test cannot hardcode it. */
  circles: { name: string; center: string }[];
  arcs: { name: string; center: string; start: string; end: string }[];
  journalOps: string[];
  activeTool: string | null;
  /**
   * The camera. `right`/`up`/`target` are absent until something turns or
   * moves it (see src/view.ts) — a view that has never been turned is the 2D
   * transform exactly.
   */
  view: { ox: number; oy: number; scale: number; right?: number[]; up?: number[]; target?: number[] };
}

export interface OpenOptions {
  /**
   * False takes WebGL away from the page before the app loads — every canvas's
   * `getContext("webgl")` answers null — so the app draws faces the one way it
   * can without it, by the painter's. The fallback's tests and the depth
   * measurement use it; nothing in the app knows it was done.
   */
  webgl?: boolean;
  /**
   * A phone to be, by Playwright's device name — `"iPhone 13"` or `"iPhone 13
   * landscape"`: its viewport, scale, `isMobile` and `hasTouch` (so the page's
   * `(pointer: coarse)` matches and taps are touch pointers), on Chromium,
   * which is the browser this machine has. Not Safari: what only WebKit does
   * is the owner's to try on the device (CHANGELOG, the touch entry). The
   * Android ones (docs/plans/android.md) are Chromium's own engine and input
   * pipeline, so for them the emulation is the browser; what it is not is the
   * device's system around it (its bars, its keyboard, its back gesture).
   */
  device?: "iPhone 13" | "iPhone 13 landscape" | "Pixel 7" | "Pixel 7 landscape" | "Galaxy S24" | "Galaxy S24 landscape";
  /** A user agent other than the device's — another browser's on the same engine (Samsung Internet's). */
  userAgent?: string;
  /** Flags for the browser — the system font scale stood in for, `--blink-settings=accessibilityFontScaleFactor=1.3`. */
  args?: string[];
  /**
   * A desktop window of another size than the suite's 1100×800. The golden
   * picture (hidden.e2e.ts) was recorded on a 1100×768 canvas — the 800 window
   * less the title bar there was then — and asks for that canvas again.
   */
  viewport?: { width: number; height: number };
  /**
   * A script run before the app's first line on every load of the page —
   * what the page's own APIs are to be (files.e2e.ts takes the file pickers
   * away, or stubs them and the share sheet, to play each platform).
   */
  init?: { fn: (arg: never) => void; arg?: unknown };
}

/**
 * Empties the app's autosave and stops it writing for the rest of this page's
 * life (docs/plans/files.md), so the next reload is the app's first start —
 * which is what every suite that reloads meant by one before there was an
 * autosave. Call it just before the reload.
 */
export async function forgetAutosave(page: Page): Promise<void> {
  await page.evaluate(() =>
    (window as unknown as { __neocad: { files: { forget(): Promise<void> } } }).__neocad.files.forget());
}

/**
 * Waits until the panels have arrived (docs/plans/panels-preview.md): at a drop
 * or an escape they glide onto their places for 120 ms, and a rectangle read in
 * the middle of that is a frame of the glide. Their places are final when it
 * starts; only the drawing catches up — so a test reading where a panel is
 * drawn waits for this, and one reading `layout()` need not.
 *
 * It waits for the drag to be over as well (`dragging` gone): the input a test
 * sends can be acknowledged before the page has handled it, and a check made
 * in between would find nothing settling yet and return mid-gesture.
 */
export async function settled(page: Page): Promise<void> {
  // And for the glide itself to have finished on every panel: its timer and
  // its transition are not the same clock, and under load the transition's
  // first frame can come late.
  await page.waitForFunction(() => {
    const v = document.getElementById("viewwrap");
    if (!v) return true;
    if (v.classList.contains("dragging") || v.classList.contains("settling")) return false;
    return !Array.from(v.querySelectorAll(":scope > .panel")).some((el) =>
      el.getAnimations().some((a) => a instanceof CSSTransition && a.playState === "running"));
  });
  await page.evaluate(() => new Promise<void>((r) => requestAnimationFrame(() => r())));
}

export async function openApp(options: OpenOptions = {}): Promise<AppContext> {
  await requireServer();
  const browser = await launchBrowser(options.args);
  let page: Page;
  if (options.device) {
    // The descriptor names WebKit as its browser; everything else in it is
    // what Chromium emulates.
    const { defaultBrowserType: _webkit, ...phone } = devices[options.device];
    page = await (await browser.newContext({ ...phone, ...(options.userAgent ? { userAgent: options.userAgent } : {}) })).newPage();
    // A phone lays a page out 980 px wide unless the page asks for the
    // device's width. The PWA package (docs/plans/pwa-pages.md) owns the
    // page's head and adds the real meta; until then the suite asks for the
    // same thing, so these tests see the phone's own width either way. Put in
    // the moment <head> exists — the app's module runs before
    // DOMContentLoaded and measures the page — and first in it, so a page's
    // own viewport meta, parsed after, is the one that counts (the last wins).
    await page.addInitScript(() => {
      const add = () => {
        if (!document.head) return false;
        const meta = document.createElement("meta");
        meta.name = "viewport";
        meta.content = "width=device-width, initial-scale=1";
        document.head.prepend(meta);
        return true;
      };
      if (add()) return;
      const watch = new MutationObserver(() => { if (add()) watch.disconnect(); });
      watch.observe(document, { childList: true, subtree: true });
    });
  } else {
    page = await browser.newPage({ viewport: options.viewport ?? { width: 1100, height: 800 } });
  }
  if (options.webgl === false) {
    await page.addInitScript(() => {
      const real = HTMLCanvasElement.prototype.getContext;
      HTMLCanvasElement.prototype.getContext = function (this: HTMLCanvasElement, kind: string, ...rest: unknown[]) {
        return /webgl/.test(kind) ? null : (real as (...a: unknown[]) => unknown).call(this, kind, ...rest);
      } as typeof real;
    });
  }
  if (options.init) {
    await page.addInitScript(options.init.fn as (arg: unknown) => void, options.init.arg);
  }
  const pageErrors: string[] = [];
  page.on("pageerror", (e) => pageErrors.push(String(e)));

  await page.goto(APP_URL, { waitUntil: "networkidle" });
  await page.waitForFunction(
    () => document.getElementById("status")?.textContent?.includes("ready"),
    null,
    { timeout: 20_000 },
  );

  return {
    page,
    browser,
    pageErrors,
    async at(sx, sy) {
      const { box, panel } = await page.$eval("#cv", (el, [sx, sy]) => {
        const r = el.getBoundingClientRect();
        const [px, py] = [r.x + sx, r.y + sy];
        const top = document.elementFromPoint(px, py);
        // A panel, or the logo — the one piece of chrome in the corner that
        // takes a press.
        let covering = top?.closest<HTMLElement>(".panel[data-panel], #logo") ?? null;
        // Under a finger a strip's hit box reaches up over the drawing to a
        // whole target (index.html's `.ptitle::before`), and Chromium's touch
        // adjustment snaps a tap within the finger's radius (fingers.ts, 8 px)
        // onto it — so a point just above a pane is the pane's too. Found by
        // the constraints palette docked at a phone's bottom: the first tap on
        // a line above it went to the strip, and `elementFromPoint` had said
        // the canvas.
        if (!covering && matchMedia("(pointer: coarse)").matches) {
          const target = parseFloat(getComputedStyle(document.documentElement).getPropertyValue("--target")) || 44;
          const radius = 8;
          // A pane's own edge, too: a tap with its centre on the organiser's
          // bottom edge went to its "none —" line (the five-lines test, with
          // the lines drawn higher). Only the edge: three pixels off it the
          // canvas wins, as the touch suite's taps beside the organiser show —
          // the adjustment prefers the node under the centre, and reaches
          // further only for a strip (below), which is a drag handle.
          const edge = 1;
          for (const pane of Array.from(document.querySelectorAll<HTMLElement>(".panel[data-panel]:not([hidden])"))) {
            const b = pane.getBoundingClientRect();
            if (px + edge > b.left && px - edge < b.right && py + edge > b.top && py - edge < b.bottom) { covering = pane; break; }
          }
          for (const strip of covering ? [] : Array.from(document.querySelectorAll<HTMLElement>(".panel[data-panel]:not([hidden]) > .ptitle"))) {
            const s = strip.getBoundingClientRect();
            const reach = Math.max(s.height, target);
            const wide = Math.max(s.width, target);
            const band = { left: s.left + s.width / 2 - wide / 2, right: s.left + s.width / 2 + wide / 2, top: s.bottom - reach, bottom: s.bottom };
            if (px + radius > band.left && px - radius < band.right && py + radius > band.top && py - radius < band.bottom) {
              covering = strip.parentElement as HTMLElement;
              break;
            }
          }
        }
        return {
          box: { x: r.x, y: r.y, width: r.width, height: r.height },
          panel: covering ? covering.dataset.panel ?? covering.id ?? "?" : null,
        };
      }, [sx, sy]);
      if (sx < 0 || sy < 0 || sx > box.width || sy > box.height) {
        throw new Error(
          `(${sx}, ${sy}) is outside the canvas, which is ` +
          `${Math.round(box.width)}x${Math.round(box.height)}.`,
        );
      }
      if (panel) {
        throw new Error(
          `(${sx}, ${sy}) is under the ${panel} panel, which would take the press instead of the ` +
          `canvas. Aim the test somewhere the drawing is visible, or move the panel first.`,
        );
      }
      return { x: box.x + sx, y: box.y + sy };
    },
    async type(source) {
      await page.fill("#cmd", source);
      await page.press("#cmd", "Enter");
      await page.waitForTimeout(140);
    },
    async repl(source) {
      return page.evaluate(async (src) => {
        const r = await (window as never as PageGlobals).__neocad.repl.eval(src);
        return { ok: r.ok, value: r.value, error: r.error?.message };
      }, source);
    },
    async selection() {
      return page.evaluate(async () => {
        const r = await (window as never as PageGlobals).__neocad.repl.eval("sel()");
        return r.value as string[];
      });
    },
    async model() {
      return page.evaluate(() => {
        const { model, engine } = (window as never as PageGlobals).__neocad;
        const all = [...model.entities.values()];
        const of = (k: string) => all.filter((e) => e.kind === k);
        return {
          size: model.entities.size,
          byKind: all.reduce<Record<string, number>>((acc, e) => {
            acc[e.kind] = (acc[e.kind] ?? 0) + 1;
            return acc;
          }, {}),
          points: Object.fromEntries(of("point").map((e) => [e.name, model.coords(e.name)])),
          radii: Object.fromEntries([...of("circle"), ...of("arc")].map((e) => [e.name, model.radius(e.name)])),
          lines: of("line").map((e) => ({ name: e.name, refs: e.refs })),
          circles: of("circle").map((e) => ({ name: e.name, center: e.center })),
          arcs: of("arc").map((e) => ({ name: e.name, center: e.center, start: e.start, end: e.end })),
          journalOps: model.journal.map((j) => j.op),
          activeTool: engine.active ? engine.active.name : null,
          view: { ...engine.view },
        };
      });
    },
    screenOf: (world) => page.evaluate(
      (w) => (window as never as PageGlobals).__neocad.engine.worldToScreen(w),
      world,
    ),
    async pixels(of, at) {
      if (of === "screen") {
        // The browser's own composition: one screenshot of the canvas's box,
        // decoded back in the page where there is something to decode it.
        const box = await page.$eval("#cv", (el) => {
          const r = el.getBoundingClientRect();
          return { x: r.x, y: r.y, width: r.width, height: r.height };
        });
        const png = (await page.screenshot({ clip: box })).toString("base64");
        return page.evaluate(async ([png, at]) => {
          const img = new Image();
          img.src = `data:image/png;base64,${png}`;
          await img.decode();
          const c = document.createElement("canvas");
          [c.width, c.height] = [img.width, img.height];
          const g = c.getContext("2d", { willReadFrequently: true })!;
          g.drawImage(img, 0, 0);
          const k = img.width / (document.getElementById("cv") as HTMLCanvasElement).getBoundingClientRect().width;
          return at.map(([x, y]) => [...g.getImageData(Math.floor(x * k), Math.floor(y * k), 1, 1).data]);
        }, [png, at] as [string, [number, number][]]);
      }
      return page.evaluate(([of, at]) => {
        const cv = document.getElementById("cv") as HTMLCanvasElement;
        const dpr = cv.width / cv.getBoundingClientRect().width;
        let g = cv.getContext("2d")!;
        if (of === "faces") {
          if ((window as never as PageGlobals).__neocad.faces !== "depth") {
            throw new Error("the app is drawing faces by the painter's, into the drawing: read \"drawing\" or \"screen\"");
          }
          // Copied through a 2D canvas, which hands back what was drawn
          // without the premultiplication WebGL stores it with.
          const faces = document.getElementById("faces") as HTMLCanvasElement;
          const c = document.createElement("canvas");
          [c.width, c.height] = [faces.width, faces.height];
          g = c.getContext("2d", { willReadFrequently: true })!;
          g.drawImage(faces, 0, 0);
        }
        return at.map(([x, y]) => [...g.getImageData(Math.floor(x * dpr), Math.floor(y * dpr), 1, 1).data]);
      }, [of, at] as [Picture, [number, number][]]);
    },
    async pixel(sx, sy, of) {
      return (await (this as AppContext).pixels(of, [[sx, sy]]))[0];
    },
    nearestFaces: (at) => page.evaluate(async (at) => {
      // The app's own occlusion module (src/occlusion.ts) — the one place the
      // question "which face is in front at this pixel" is answered off the
      // GPU, so the oracle and the app's dimmed hidden edges cannot disagree
      // about it. It casts the pixel's ray at the faces' planes in the world
      // (faces.ts's faces, never either renderer's picture).
      const [facesPath, occlusionPath] = ["/src/faces.ts", "/src/occlusion.ts"];
      const { faceRGB, visibleFaces } = await import(facesPath);
      const { nearestFace, occlusion, outlineDistance } = await import(occlusionPath);
      const { model, engine } = (window as never as PageGlobals).__neocad;
      type F = { feature: string; kind: string; shade: number; face?: number; normal: number[]; outlines: number[][][] };
      // The kernel's bodies in place of their features' own faces, as main.ts
      // hands them to the face layer (docs/plans/solids-kernel.md) — the
      // last good answer, which is what is on the screen.
      const kernel = (window as never as { __neocad: { bodies?: { drawn(): unknown } } }).__neocad.bodies?.drawn() ?? null;
      const faces = visibleFaces(model, engine.view, new Set(), kernel) as F[];
      const occ = occlusion(faces, engine.view);
      // A kernel body's face is drawn as triangles, one `Face` each (bodies.ts).
      // Those of one kernel face lying in one plane are one shade, so they are
      // one face here — their shared sides are no outline anything is drawn
      // along. A curved face's triangles shade apart, and stay apart. (The
      // normals to a thousandth: the kernel's positions are single precision,
      // and a thin triangle's normal is read off them.)
      const group = (i: number): number | string => {
        const f = faces[i];
        return typeof f.face === "number" ? `${f.feature}#${f.face}#${f.normal.map((c) => c.toFixed(3)).join(",")}` : i;
      };
      const groups = faces.map((_, i) => group(i));
      const ids = new Map([...new Set(groups.filter((g) => typeof g === "string"))].map((g, k) => [g, -1 - k]));
      // A side two triangles of one such face share is inside it: no outline.
      const sideKey = (g: string, a: number[], b: number[]) =>
        [g, ...[a, b].map((p) => p.map((c) => c.toFixed(4)).join(",")).sort()].join("|");
      const sides = new Map<string, number>();
      faces.forEach((f, i) => {
        const g = groups[i];
        if (typeof g !== "string") return;
        const o = f.outlines[0];
        for (let k = 0; k < o.length; k++) {
          const key = sideKey(g, o[k], o[(k + 1) % o.length]);
          sides.set(key, (sides.get(key) ?? 0) + 1);
        }
      });
      const inside = (i: number, k: number) => {
        const g = groups[i];
        if (typeof g !== "string") return false;
        const o = faces[i].outlines[0];
        return (sides.get(sideKey(g, o[k], o[(k + 1) % o.length])) ?? 0) > 1;
      };
      type Occ = { faces: { screen: [number, number][][]; box: number[]; facing: number }[] };
      const toSegment = (x: number, y: number, a: [number, number], b: [number, number]) => {
        const [dx, dy] = [b[0] - a[0], b[1] - a[1]];
        const t = Math.max(0, Math.min(1, ((x - a[0]) * dx + (y - a[1]) * dy) / (dx * dx + dy * dy || 1)));
        return Math.hypot(x - a[0] - t * dx, y - a[1] - t * dy);
      };
      return at.map(([x, y]) => {
        const best = nearestFace(occ, x, y) as { index: number } | null;
        const f = best ? faces[best.index] : null;
        const g = best ? groups[best.index] : null;
        // Three pixels out from every face's screen box: further than that
        // from an outline is "far" (JSON has no Infinity) — `outlineDistance`,
        // but for the sides inside a kernel face, which no outline is.
        let edge = 99;
        if (ids.size === 0) edge = Math.min(99, outlineDistance(occ, x, y, 3) as number);
        else (occ as Occ).faces.forEach((o, i) => {
          if (!(o.facing > 0)) return;
          if (x < o.box[0] - 3 || y < o.box[1] - 3 || x > o.box[2] + 3 || y > o.box[3] + 3) return;
          for (const s of o.screen) for (let k = 0; k < s.length; k++) {
            if (!inside(i, k)) edge = Math.min(edge, toSegment(x, y, s[k], s[(k + 1) % s.length]));
          }
        });
        const id = typeof g === "string" ? ids.get(g)! : best?.index ?? -1;
        return { face: f ? { id, feature: f.feature, kind: f.kind, rgb: faceRGB(f.shade) } : null, edge };
      });
    }, at),
    renderer: () => page.evaluate(() => (window as never as PageGlobals).__neocad.faces),
    status: () => page.$eval("#status", (el) => el.textContent ?? ""),
    log: () => page.$eval("#log", (el) => el.textContent ?? ""),
    async close() {
      await browser.close();
    },
  };
}

// The debug hook main.ts installs on window. Not a public API — it exists for
// exactly this, and for poking at the app in devtools.
interface PageGlobals {
  __neocad: {
    model: {
      entities: Map<string, { kind: string; name: string; refs: [string, string]; center: string; start: string; end: string }>;
      coords(name: string): number[];
      radius(name: string): number;
      journal: { op: string; args: unknown[] }[];
    };
    engine: {
      active: { name: string } | null;
      view: { ox: number; oy: number; scale: number; right?: number[]; up?: number[] };
      worldToScreen(world: number[]): [number, number];
    };
    repl: { eval(src: string): Promise<{ ok: boolean; value: unknown; error?: Error }> };
    faces: string;
  };
}

/**
 * Adds the suite's fixture coordinate frame and makes it the default, so that
 * `fix` and `xaxis()` typed into a test mean what they meant before frames
 * existed: there is no world frame any more, and without one those refuse to
 * run at all.
 *
 * Aligned with the kernel's own axes and, by default, sitting on its origin,
 * so frame coordinates and the numbers these tests were written with are the
 * same numbers. `at` parks it somewhere else for the tests that would
 * otherwise keep snapping to it — a frame's points are ordinary points, and
 * snapping does not know they belong to a frame.
 *
 * The app is 3D, so the frame is a 3D one: an origin, an x-ref one unit along
 * the kernel's x and a y-ref one unit along its y, in z = 0. Its plane is
 * therefore the plane every 2D test was already drawing in, and its +z the
 * kernel's — which is also why, as the default frame, it is where every click
 * lands and what every placed point is held on (`onPlane`).
 *
 * Built through `model` rather than the `frame()` command so that its points
 * can be named: an auto-named set would take `p1`, `p2` and `p3` and shift
 * every name the tests below assert against. The command surface's own
 * `frame()` is exercised in repl.e2e.ts.
 */
export async function axisFrame(app: AppContext, at: [number, number] = [0, 0], asDefault = true): Promise<void> {
  const r = await app.repl(
    `model.addPoint([${at[0]}, ${at[1]}, 0], "f_o");` +
    `model.addPoint([${at[0] + 1}, ${at[1]}, 0], "f_x");` +
    `model.addPoint([${at[0]}, ${at[1] + 1}, 0], "f_y");` +
    `model.addFrame("f_o", "f_x", "f_y", "f");` +
    (asDefault ? `model.setDefaultFrame("f");` : "") + ` refresh(); "framed"`,
  );
  if (!r.ok) throw new Error(`could not build the fixture frame: ${r.error}`);
}

/** How many entities `axisFrame` adds: the frame and its three points. */
export const FIXTURE_ENTITIES = 4;

/** How many journal entries `axisFrame` adds: three points, the frame, and the default. */
export const FIXTURE_JOURNAL = 5;

/**
 * Where a test parks its sketch frame when all it needs is for one to *exist*:
 * far off the canvas in every direction a test clicks, so nothing snaps to its
 * points, and in the kernel's x–y plane, so it is the plane every 2D-written
 * test was already drawing in.
 */
export const PARKED: [number, number] = [150, 150];

/**
 * A default frame to sketch on, parked out of the way — what a test that draws
 * a circle or an arc needs before anything else since 3D phase 2: in a 3D model
 * a circle lies in a plane, and the tools refuse with no default frame to give
 * them (see src/tools/place.ts). Every point a tool then places is held on the
 * frame's plane with `onplane`, which the assertions below it account for.
 */
export async function sketchFrame(app: AppContext): Promise<void> {
  await axisFrame(app, PARKED);
}

/** What `checkPicture` found. */
export interface PictureCheck {
  /** Samples clear of every outline, so ones whose colour is a fair question. */
  checked: number;
  /** Of those, the ones on a face. */
  onFace: number;
  /** Which faces were seen at least once, as `feature.kind`. */
  seen: Set<string>;
  /** Every sample whose pixel is not the nearest face's fill (or not empty where no face is). */
  wrong: { at: [number, number]; want: string; got: number[] }[];
}

/**
 * The faces' picture checked against the oracle (`nearestFaces`): a grid of
 * samples every `step` pixels over the canvas — or over `box` — and at each
 * one more than two pixels from any edge, the faces canvas must hold the
 * fill of the face nearest the viewer there, or nothing where no solid is. A
 * level of slack for the float the colour goes through; none for which face.
 */
export async function checkPicture(app: AppContext, step = 8, box?: [number, number, number, number]): Promise<PictureCheck> {
  const [x0, y0, x1, y1] = box ?? await app.page.$eval("#cv", (el) => [0, 0, el.clientWidth, el.clientHeight] as [number, number, number, number]);
  const at: [number, number][] = [];
  for (let y = y0 + step / 2; y < y1; y += step) for (let x = x0 + step / 2; x < x1; x += step) at.push([Math.floor(x) + 0.5, Math.floor(y) + 0.5]);
  // Two pixels to each corner of every sample too: where the nearest face
  // changes between them the sample is on an edge — an outline, or one no
  // outline draws, where one solid passes through another.
  const corners = at.flatMap(([x, y]) => [[x - 2, y - 2], [x + 2, y - 2], [x - 2, y + 2], [x + 2, y + 2]] as [number, number][]);
  const [want, got, around] = await Promise.all([app.nearestFaces(at), app.pixels("faces", at), app.nearestFaces(corners)]);
  const out: PictureCheck = { checked: 0, onFace: 0, seen: new Set(), wrong: [] };
  at.forEach((p, i) => {
    const { face, edge } = want[i];
    if (edge <= 2) return;
    if (around.slice(4 * i, 4 * i + 4).some((c) => (c.face?.id ?? -1) !== (face?.id ?? -1))) return;
    out.checked++;
    const px = got[i];
    if (!face) {
      if (px[3] !== 0) out.wrong.push({ at: p, want: "nothing", got: px });
      return;
    }
    out.onFace++;
    out.seen.add(`${face.feature}.${face.kind}`);
    if (px[3] !== 255 || face.rgb.some((c, k) => Math.abs(c - px[k]) > 1)) {
      out.wrong.push({ at: p, want: `${face.feature}.${face.kind} rgb(${face.rgb})`, got: px });
    }
  });
  return out;
}

/** Perpendicular distance from a point to the infinite line through a and b. */
export function distanceToLine(p: number[], a: number[], b: number[]): number {
  const u = b.map((bi, i) => bi - a[i]);
  const w = p.map((pi, i) => pi - a[i]);
  const len = Math.hypot(...u);
  const along = w.reduce((s, wi, i) => s + wi * u[i], 0) / len;
  return Math.hypot(...w.map((wi, i) => wi - (along * u[i]) / len));
}

/**
 * A feature tool's picks confirmed and the tool put down: Enter with the
 * command line empty (✓'s key — docs/plans/feature-dialog.md), then Escape,
 * which with nothing left picked releases the tool. For a test written when a
 * feature was built by the click that picked it and the tool was done
 * afterwards; a test about the dialog presses the keys itself.
 */
export async function confirmAndRelease(app: AppContext): Promise<void> {
  await app.page.fill("#cmd", "");
  await app.page.keyboard.press("Enter");
  await app.page.waitForTimeout(250);
  await app.page.keyboard.press("Escape");
  await app.page.waitForTimeout(120);
}
