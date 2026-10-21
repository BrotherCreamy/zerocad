// Shared setup for the end-to-end tests: a real browser driving the real app
// against a real dev server.
//
// These exist because a good deal of what this project does is only wrong
// once it is assembled. Seven bugs so far were invisible to the unit tests and
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
import { chromium, type Browser, type Page } from "playwright";

/**
 * Where the app under test lives. run.ts sets this to the private server it
 * started for exactly this run; the 5173 fallback only matters when a single
 * spec file is run by hand against `npm run dev`.
 */
export const APP_URL = process.env.NEOCAD_E2E_URL ?? "http://localhost:5173/";

/**
 * Playwright refuses to launch unless the browser build it was compiled
 * against is present, and a machine may well have a different one installed
 * (a preinstalled image, a differently-pinned project). So: try the normal
 * path first, then fall back to any chromium under PLAYWRIGHT_BROWSERS_PATH,
 * and only then complain — with the command that fixes it.
 */
async function launchBrowser(): Promise<Browser> {
  try {
    return await chromium.launch();
  } catch (firstError) {
    for (const path of discoverChromium()) {
      try {
        return await chromium.launch({ executablePath: path });
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
   * The canvas is the whole area under the header, and nothing in the page
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
   * Where a world point is drawn right now, in canvas pixels — through the
   * app's own camera, so a test can aim at geometry however the view has been
   * turned. In a view that has never been turned this is the old 2D formula
   * (`ox + x·scale`, `oy − y·scale`), which is what most of the suite still
   * computes by hand.
   */
  screenOf(world: number[]): Promise<[number, number]>;
  status(): Promise<string>;
  log(): Promise<string>;
  /** Anything the page threw that nothing caught. Should always be empty. */
  pageErrors: string[];
  close(): Promise<void>;
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

export async function openApp(): Promise<AppContext> {
  await requireServer();
  const browser = await launchBrowser();
  const page = await browser.newPage({ viewport: { width: 1100, height: 800 } });
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
        const top = document.elementFromPoint(r.x + sx, r.y + sy);
        const covering = top?.closest<HTMLElement>(".panel[data-panel]");
        return {
          box: { x: r.x, y: r.y, width: r.width, height: r.height },
          panel: covering ? covering.dataset.panel ?? "?" : null,
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
      view: { ox: number; oy: number; scale: number };
      worldToScreen(world: number[]): [number, number];
    };
    repl: { eval(src: string): Promise<{ ok: boolean; value: unknown; error?: Error }> };
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

/** Perpendicular distance from a point to the infinite line through a and b. */
export function distanceToLine(p: number[], a: number[], b: number[]): number {
  const u = b.map((bi, i) => bi - a[i]);
  const w = p.map((pi, i) => pi - a[i]);
  const len = Math.hypot(...u);
  const along = w.reduce((s, wi, i) => s + wi * u[i], 0) / len;
  return Math.hypot(...w.map((wi, i) => wi - (along * u[i]) / len));
}
