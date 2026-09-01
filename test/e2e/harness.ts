// Shared setup for the end-to-end tests: a real browser driving the real app
// against a real dev server.
//
// These exist because a good deal of what this project does is only wrong
// once it is assembled. Four bugs so far were invisible to the unit tests and
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
   * Canvas-relative screen coordinates -> absolute page coordinates.
   *
   * Measured fresh every time rather than cached: the log pane grows as a test
   * types into it, which moves the canvas's bottom edge up. A cached rect
   * silently sends later clicks past the edge of the canvas, where they do
   * nothing and the failure looks like the feature is broken.
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
  view: { ox: number; oy: number; scale: number };
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
      const box = await page.$eval("#cv", (el) => {
        const r = el.getBoundingClientRect();
        return { x: r.x, y: r.y, width: r.width, height: r.height };
      });
      // A point outside the canvas is never what a test meant, and a mouse
      // event there lands on the log pane and does nothing — which reads as
      // "the feature is broken" rather than "the coordinate was wrong". The
      // canvas shrinks as the log fills, so this is easy to do by accident.
      if (sx < 0 || sy < 0 || sx > box.width || sy > box.height) {
        throw new Error(
          `(${sx}, ${sy}) is outside the canvas, which is currently ` +
          `${Math.round(box.width)}x${Math.round(box.height)}. The canvas shrinks as the log pane ` +
          `fills, so pick coordinates that fit the smaller size.`,
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
    engine: { active: { name: string } | null; view: { ox: number; oy: number; scale: number } };
    repl: { eval(src: string): Promise<{ ok: boolean; value: unknown; error?: Error }> };
  };
}

/**
 * Adds the suite's fixture coordinate frame and makes it the default, so that
 * `hor`, `ver` and `fix` typed into a test mean what they meant before frames
 * existed: there is no world frame any more, and without one those three
 * refuse to run at all.
 *
 * Aligned with the kernel's own axes and, by default, sitting on its origin,
 * so frame coordinates and the numbers these tests were written with are the
 * same numbers. `at` parks it somewhere else for the tests that would
 * otherwise keep snapping to it — a frame's origin and x-ref are ordinary
 * points, and snapping does not know they belong to a frame.
 *
 * Built through `model` rather than the `frame()` command so that its two
 * points can be named: an auto-named pair would take `p1` and `p2` and shift
 * every name the tests below assert against. The command surface's own
 * `frame()` is exercised in repl.e2e.ts.
 */
export async function axisFrame(app: AppContext, at: [number, number] = [0, 0]): Promise<void> {
  const r = await app.repl(
    `model.addPoint([${at[0]}, ${at[1]}], "f_o");` +
    `model.addPoint([${at[0] + 1}, ${at[1]}], "f_x");` +
    `model.addFrame("f_o", "f_x", "f"); model.setDefaultFrame("f"); refresh(); "framed"`,
  );
  if (!r.ok) throw new Error(`could not build the fixture frame: ${r.error}`);
}

/** How many entities `axisFrame` adds: the frame and its two points. */
export const FIXTURE_ENTITIES = 3;

/** Perpendicular distance from a point to the infinite line through a and b. */
export function distanceToLine(p: number[], a: number[], b: number[]): number {
  const u = b.map((bi, i) => bi - a[i]);
  const w = p.map((pi, i) => pi - a[i]);
  const len = Math.hypot(...u);
  const along = w.reduce((s, wi, i) => s + wi * u[i], 0) / len;
  return Math.hypot(...w.map((wi, i) => wi - (along * u[i]) / len));
}
