// Regions split by a crossing, in a browser: a rectangle from the rectangle
// tool and a line drawn across it with the line tool, on a tilted sketch
// plane; then extrude armed and each half hovered.
//
// The unit suite has the mathematics (test/loops.test.ts: every case in
// docs/plans/regions-split.md, in 2D and on a tilted plane). What only the
// assembled app can say is whether a line a person draws across a rectangle
// cuts it where the region preview can see — the green outline stopping at
// the crossing rather than running on round the whole rectangle — and whether
// a click there is refused out loud, by name, building nothing, while
// features over split regions are not yet built. Positions are checked
// against the canvas's own pixels as well as the model. Set NEOCAD_E2E_SHOTS
// to a directory to keep the screenshots; look at them.
//
// One app, tests in order: the states are cumulative.

import { test, before, after } from "node:test";
import assert from "node:assert/strict";
import { mkdirSync } from "node:fs";
import { join } from "node:path";
import { openApp, type AppContext } from "./harness.ts";

let app: AppContext;
before(async () => { app = await openApp(); });
after(async () => { await app.close(); });

const SHOTS = process.env.NEOCAD_E2E_SHOTS;
/** The page as it is — the hover left where it is, since the hover is the point. */
async function shot(name: string): Promise<void> {
  if (!SHOTS) return;
  mkdirSync(SHOTS, { recursive: true });
  await app.page.waitForTimeout(120);
  await app.page.screenshot({ path: join(SHOTS, `regions-${name}.png`) });
}

/** The sketch plane: loops.e2e.ts's and extrude.e2e.ts's, +x up 30°, +y leaning back 25°. */
const A = (30 * Math.PI) / 180, B = (25 * Math.PI) / 180;
const G_O = [10, 5, 6];
const G_X = [Math.cos(A), 0, Math.sin(A)];
const G_Y = [-Math.sin(A) * Math.sin(B), Math.cos(B), Math.cos(A) * Math.sin(B)];
const onG = (u: number, v: number) => G_O.map((o, i) => o + u * G_X[i] + v * G_Y[i]);

async function leftDrag(a: [number, number], b: [number, number]): Promise<void> {
  const p = await app.at(...a), q = await app.at(...b);
  await app.page.mouse.move(p.x, p.y);
  await app.page.mouse.down();
  await app.page.mouse.move(q.x, q.y, { steps: 8 });
  await app.page.mouse.up();
  await app.page.waitForTimeout(220);
}

async function clickAt(sx: number, sy: number): Promise<void> {
  const at = await app.at(sx, sy);
  await app.page.mouse.move(at.x, at.y);
  await app.page.waitForTimeout(40);
  await app.page.mouse.click(at.x, at.y);
  await app.page.waitForTimeout(160);
}

async function moveTo(sx: number, sy: number): Promise<void> {
  const at = await app.at(sx, sy);
  await app.page.mouse.move(at.x, at.y, { steps: 3 });
  await app.page.waitForTimeout(150);
}

/** The canvas's own pixel at (sx, sy), as drawn. */
const pixel = (sx: number, sy: number): Promise<number[]> => app.page.evaluate(([x, y]) => {
  const cv = document.getElementById("cv") as HTMLCanvasElement;
  const dpr = devicePixelRatio || 1;
  return [...cv.getContext("2d")!.getImageData(Math.round(x * dpr), Math.round(y * dpr), 1, 1).data];
}, [sx, sy]);

/**
 * Whether the sketch's point (u, v) is drawn in the region tools' green
 * (`REGION_GREEN`, #55c07a) — clearly greener than red and blue, which neither
 * an edge's own blue-grey (#afc6d9) nor the faint fill over the background is.
 */
async function green(u: number, v: number): Promise<boolean> {
  const [r, g, b] = await pixel(...await app.screenOf(onG(u, v)));
  return g > r + 50 && g > b + 30;
}

let journal = 0;

test("on a tilted sketch: a rectangle from the tool, and a line across it from the line tool, past both edges", async () => {
  const at = (p: number[]) => `pt(${p.join(", ")})`;
  await app.type(`go = ${at(G_O)}; gx = ${at(onG(20, 0))}; gy = ${at(onG(0, 20))}; g = plane(go, gx, gy)`);
  assert.equal((await app.repl("defaultFrame()")).value, "f1");

  await app.type("rectangle");
  await leftDrag(await app.screenOf(onG(30, 10)), await app.screenOf(onG(70, 40)));
  await app.type("line");
  await clickAt(...await app.screenOf(onG(45, -5)));
  await clickAt(...await app.screenOf(onG(45, 55)));
  await app.page.press("#cmd", "Escape");
  await app.page.waitForTimeout(150);
  // Closer, and clear of the panels, so the pictures show what a hover shows.
  await app.type("zoom(2.5)");
  const [cx, cy] = await app.screenOf(onG(50, 25));
  await app.type(`pan(${Math.round(700 - cx)}, ${Math.round(330 - cy)})`);
  const centred = await app.screenOf(onG(50, 25));
  assert.ok(Math.hypot(centred[0] - 700, centred[1] - 330) < 1, `the rectangle's middle is drawn at ${centred}`);
  const m = await app.model();
  assert.equal(m.lines.length, 5, "four sides and the line across");
  assert.equal(await app.status(), "SOLVED");

  // loops() says two regions, each bounded by parts of the edges the line
  // crosses and the part of the line between them — 15 × 30 and 25 × 30.
  const listed = (await app.repl("loops()")).value as string[];
  assert.equal(listed.length, 2, listed.join(" | "));
  const across = m.lines[4].name;
  assert.ok(listed.every((l) => l.includes(`${across}[`) && l.includes("×")), listed.join(" | "));
  const areas = listed.map((l) => Number(l.match(/area ([\d.]+)/)![1]));
  assert.ok(Math.abs(areas[0] - 450) < 1e-3 && Math.abs(areas[1] - 750) < 1e-3, `areas ${areas}`);
  journal = (await app.model()).journalOps.length;
});

test("extrude armed, each half hovered: the green outline runs to the crossing and stops there", async () => {
  await app.type("extrude");
  assert.equal((await app.model()).activeTool, "extrude");

  await moveTo(...await app.screenOf(onG(37, 25)));
  await shot("hover-left");
  assert.ok(await green(37, 10), "the left half's bottom edge is outlined");
  assert.ok(!(await green(60, 10)), "the bottom edge past the crossing is not");
  assert.ok(!(await green(70, 25)), "nor is the far side");
  assert.ok(await green(45, 25), "the line between the crossings is an edge of this half");
  assert.ok(!(await green(45, 0)), "and the line's stub outside the rectangle is an edge of nothing");

  await moveTo(...await app.screenOf(onG(60, 25)));
  await shot("hover-right");
  assert.ok(await green(60, 10), "now the right half's bottom edge is");
  assert.ok(!(await green(37, 10)), "and the left half's is not");
  assert.ok(await green(70, 25) && await green(45, 25));
  assert.ok(!(await green(30, 25)), "the left side is no edge of this half");
});

test("a click in a split half is refused out loud, by name, and builds nothing; the tool stays armed", async () => {
  await clickAt(...await app.screenOf(onG(60, 25)));
  const log = await app.log();
  assert.match(log, /extrude: this region is bounded by part of l\d+ \(from [^)]+\) — extruding split regions is not built yet/);
  const m = await app.model();
  assert.equal(m.journalOps.length, journal, "nothing journalled");
  assert.equal(m.activeTool, "extrude", "armed still, for a click somewhere it can extrude");
  assert.equal((await app.repl("model.features.size")).value, 0);
  await shot("refused");
  await app.page.press("#cmd", "Escape");
});

test("no uncaught page errors", () => {
  assert.deepEqual(app.pageErrors, []);
});
