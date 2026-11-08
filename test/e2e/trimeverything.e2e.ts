// Trim every sketch curve, and power trim (docs/plans/trim-everything.md),
// driven the way a person drives it. The owner: *"Also need trim for sketch
// entities"*.
//
// With a mouse: an ellipse crossed by a line, the piece under the cursor red,
// a click trims it to an elliptical arc; a spline crossed by a circle, trimmed
// to a spline of control points; a sketch of crossing lines power-trimmed by
// dragging across it, every piece red as it is crossed, one typed entry, one
// Ctrl+Z. On an iPhone 13 by finger: the same three, by taps and a drag of one
// finger — which must not pan — and Undo on the action strip. And the toolbar
// at the phone's width: the modify button's face is trim.
//
// Set NEOCAD_E2E_SHOTS to a directory to keep the screenshots, and look at
// them. Each test opens its own app.

import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdirSync } from "node:fs";
import { join } from "node:path";
import { openApp, axisFrame, type AppContext } from "./harness.ts";
import { fingers } from "./fingers.ts";

const SHOTS = process.env.NEOCAD_E2E_SHOTS;
async function shot(app: AppContext, name: string): Promise<void> {
  if (!SHOTS) return;
  mkdirSync(SHOTS, { recursive: true });
  await app.page.waitForTimeout(200);
  await app.page.screenshot({ path: join(SHOTS, `trimeverything-${name}.png`) });
}

const value = async (app: AppContext, src: string) => {
  const r = await app.repl(src);
  assert.ok(r.ok, `${src}: ${r.error}`);
  return r.value;
};
const typedLines = (app: AppContext) => app.page.$$eval("#log .in", (els) => els.map((e) => (e.textContent ?? "").replace(/^> /, "")));
const kind = (app: AppContext, name: string) => value(app, `model.entities.get("${name}").kind`);
/** Whether a pixel is the cut's red (#e8806c), not the drawing's ink. */
const reddish = (c: number[]) => c[0] > c[1] + 40 && c[0] > c[2] + 40;

/** The mouse's moves and clicks, at world places. */
function mouse(app: AppContext) {
  const to = async (world: number[]) => {
    const [sx, sy] = await app.screenOf(world);
    const at = await app.at(sx, sy);
    await app.page.mouse.move(at.x, at.y, { steps: 3 });
    await app.page.waitForTimeout(150);
    return at;
  };
  return {
    to,
    async click(world: number[]) {
      await to(world);
      await app.page.mouse.down();
      await app.page.mouse.up();
      await app.page.waitForTimeout(400);
    },
  };
}

/** The ellipse and the line across it, the spline and the circle across it: one drawing, left and right. */
async function curves(app: AppContext): Promise<{ el: string; sp: string }> {
  await axisFrame(app, [-150, -110]);
  const el = await value(app, "el = ellipse(pt(-35, 0, 0), 25, 12)") as string;
  await app.type("ln(pt(-70, 4, 0), pt(0, 4, 0))");
  const sp = await value(app, "sp = spline([10, -5, 0], [25, 15, 0], [40, -15, 0], [55, 0, 0])") as string;
  await app.type("circ(pt(50, 3, 0), 9)");
  await app.type("solve()");
  return { el, sp };
}

test("mouse: an ellipse crossed by a line — the piece under the cursor red, a click trims it to an elliptical arc; a spline crossed by a circle, to a spline of control points; Ctrl+Z restores each whole", async () => {
  const app = await openApp();
  try {
    const { el, sp } = await curves(app);
    const m = mouse(app);
    await app.type("trim");
    await app.page.waitForTimeout(300);
    // The chip says the tool armed by name at once — before any pointer event (it said Select: a stale readout, found here).
    assert.equal(await app.page.$eval("#mode", (el) => (el as HTMLElement).dataset.next), "click a piece to trim it, or drag across pieces");
    // The ellipse's lower piece, below the line: red under the cursor.
    await m.to([-35, -12, 0]);
    const [px, py] = await app.screenOf([-35, -12, 0]);
    assert.ok(reddish(await app.pixel(px, py, "drawing")), "the piece a click takes, drawn red");
    await shot(app, "360-ellipse-piece-red");
    await m.click([-35, -12, 0]);
    assert.match((await typedLines(app)).at(-1)!, new RegExp(`^trim\\("${el}", \\[-35,-12,0\\]\\)$`));
    assert.equal(await kind(app, el), "earc", "an elliptical arc, under the ellipse's name");
    await app.page.mouse.move(5, 5);
    await shot(app, "361-ellipse-trimmed-to-an-elliptical-arc");
    // The spline's end inside the circle.
    const end = await value(app, `model.entities.get("${sp}").points[3]`) as string;
    const near = await value(app, `(() => { const c = model.coords("${end}"); return [c[0] - 3, c[1] + 0.6, 0]; })()`) as number[];
    await m.to(near);
    await shot(app, "362-spline-piece-in-the-circle-red");
    await m.click(near);
    assert.match((await typedLines(app)).at(-1)!, new RegExp(`^trim\\("${sp}", `));
    assert.equal(await kind(app, sp), "bspline", "a spline of control points, under the spline's name");
    const ctrl = await value(app, `model.entities.get("${sp}").points.length`) as number;
    assert.ok(ctrl >= 4, `its control points: ${ctrl}`);
    await app.page.mouse.move(5, 5);
    await shot(app, "363-spline-trimmed-its-control-points");
    assert.equal(await app.status(), "SOLVED");
    // One Ctrl+Z each, and each curve is whole again.
    await app.page.fill("#cmd", "");
    await app.page.keyboard.press("Escape");
    await app.page.keyboard.press("Control+z");
    await app.page.waitForTimeout(400);
    assert.equal(await kind(app, sp), "spline", "the spline whole again");
    await app.page.keyboard.press("Control+z");
    await app.page.waitForTimeout(400);
    assert.equal(await kind(app, el), "ellipse", "the ellipse whole again");
    // Saved and opened after redoing both: the same model, byte for byte.
    await app.page.keyboard.press("Control+y");
    await app.page.keyboard.press("Control+y");
    await app.page.waitForTimeout(400);
    assert.equal(await kind(app, sp), "bspline");
    const text = await value(app, "save()") as string;
    assert.equal((await app.repl(`open(${JSON.stringify(text)})`)).ok, true);
    await app.page.waitForTimeout(400);
    assert.equal(await value(app, "save()"), text);
    assert.deepEqual(app.pageErrors, []);
  } finally {
    await app.close();
  }
});

/** A grid of crossing lines: three across, three down, each crossing all three of the others. */
async function grid(app: AppContext): Promise<void> {
  await axisFrame(app, [-150, -110]);
  for (const y of [-20, 0, 20]) await app.type(`ln(pt(-40, ${y}, 0), pt(40, ${y}, 0))`);
  for (const x of [-20, 0, 20]) await app.type(`ln(pt(${x}, -40, 0), pt(${x}, 40, 0))`);
}

/** Where the lines of the grid are now, as their ends rounded. */
async function gridLines(app: AppContext): Promise<string[]> {
  const m = await app.model();
  return m.lines.map((l) => l.refs.map((p) => m.points[p].slice(0, 2).map((v) => Math.round(v)).join(",")).join("–")).sort();
}

test("mouse: power trim — a press dragged across the grid draws its stroke, each piece red as it is crossed; the release types one entry, one Ctrl+Z", async () => {
  const app = await openApp();
  try {
    await grid(app);
    const before = await gridLines(app);
    const entries = (await typedLines(app)).length;
    await app.type("trim");
    // Down the gap between x = 0 and x = 20, crossing the three across-lines' pieces there.
    const [x0, y0] = await app.screenOf([10, 30, 0]);
    const [x1, y1] = await app.screenOf([10, -30, 0]);
    const start = await app.at(x0, y0);
    const box = { x: start.x - x0, y: start.y - y0 };
    await app.page.mouse.move(start.x, start.y);
    await app.page.mouse.down();
    for (let k = 1; k <= 12; k++) {
      await app.page.mouse.move(box.x + x0 + ((x1 - x0) * k) / 16, box.y + y0 + ((y1 - y0) * k) / 16);
      await app.page.waitForTimeout(30);
    }
    // Mid-stroke: the piece of the top line it crossed is red, and nothing is trimmed yet.
    const [rx, ry] = await app.screenOf([4, 20, 0]);
    assert.ok(reddish(await app.pixel(rx, ry, "drawing")), "a crossed piece red, mid-stroke");
    assert.equal((await typedLines(app)).length, entries + 1, "nothing typed before the release but `trim`");
    await shot(app, "364-power-trim-mid-stroke");
    for (let k = 13; k <= 16; k++) {
      await app.page.mouse.move(box.x + x0 + ((x1 - x0) * k) / 16, box.y + y0 + ((y1 - y0) * k) / 16);
      await app.page.waitForTimeout(30);
    }
    await app.page.mouse.up();
    await app.page.waitForTimeout(500);
    const last = (await typedLines(app)).at(-1)!;
    assert.equal((last.match(/trim\(/g) ?? []).length, 3, `three trims in one entry: ${last}`);
    const after = await gridLines(app);
    for (const y of [-20, 0, 20]) {
      assert.ok(!after.some((l) => l === `0,${y}–20,${y}` || l === `20,${y}–0,${y}`), `the piece 0–20 on y = ${y} gone`);
    }
    await app.page.mouse.move(5, 5);
    await shot(app, "365-power-trimmed");
    assert.equal(await app.status(), "SOLVED");
    await app.page.keyboard.press("Escape");
    await app.page.keyboard.press("Control+z");
    await app.page.waitForTimeout(500);
    assert.deepEqual(await gridLines(app), before, "one Ctrl+Z takes all three back");
    assert.deepEqual(app.pageErrors, []);
  } finally {
    await app.close();
  }
});

test("iPhone 13: a tap trims the ellipse's piece and the spline's; a finger dragged across the grid power-trims it without panning; Undo on the strip takes it back", async () => {
  const p = await openApp({ device: "iPhone 13" });
  try {
    const { el, sp } = await curves(p);
    await p.type("zoom(0.55)");
    const f = await fingers(p);
    const tap = async (world: number[]) => {
      const [sx, sy] = await p.screenOf(world);
      await p.at(sx, sy); // refuses a point a panel covers
      await f.tap(sx, sy);
      await p.page.waitForTimeout(500);
    };
    await p.type("trim");
    await p.page.waitForTimeout(300);
    assert.equal(await p.page.$eval("#mode", (el) => (el as HTMLElement).dataset.next), "tap a piece to trim it, or drag across pieces", "a finger's word");
    await tap([-35, -12, 0]);
    assert.equal(await kind(p, el), "earc");
    const end = await value(p, `model.entities.get("${sp}").points[3]`) as string;
    const near = await value(p, `(() => { const c = model.coords("${end}"); return [c[0] - 3, c[1] + 0.6, 0]; })()`) as number[];
    await tap(near);
    assert.equal(await kind(p, sp), "bspline");
    await shot(p, "366-iphone-ellipse-and-spline-trimmed-by-taps");
    assert.deepEqual(p.pageErrors, []);
  } finally {
    await p.close();
  }
  const q = await openApp({ device: "iPhone 13" });
  try {
    await grid(q);
    await q.type("zoom(0.6)");
    const before = await gridLines(q);
    const view = await value(q, "JSON.stringify(view())").catch(() => null);
    await q.type("trim");
    const f = await fingers(q);
    const [x0, y0] = await q.screenOf([10, 30, 0]);
    const [x1, y1] = await q.screenOf([10, -30, 0]);
    await q.at(x0, y0);
    await q.at(x1, y1);
    const [sx, sy] = await q.screenOf([0, 0, 0]);
    await f.down([x0, y0]);
    await f.glide(10, [(x0 + x1) / 2 + 0.5 * (x1 - x0) * 0.2, y0 + (y1 - y0) * 0.6]);
    await shot(q, "367-iphone-power-trim-mid-stroke");
    await f.glide(6, [x1, y1]);
    await f.up();
    await q.page.waitForTimeout(600);
    // The stroke was the tool's, not a pan: the origin is where it was on screen.
    const [ax, ay] = await q.screenOf([0, 0, 0]);
    assert.ok(Math.hypot(ax - sx, ay - sy) < 0.5, `the view did not pan: ${[sx, sy]} → ${[ax, ay]}`);
    void view;
    const last = (await typedLines(q)).at(-1)!;
    assert.equal((last.match(/trim\(/g) ?? []).length, 3, `three trims in one entry: ${last}`);
    await shot(q, "368-iphone-power-trimmed");
    // Undo on the action strip: the three back at once.
    await q.page.click('#actions button[data-action="undo"]');
    await q.page.waitForTimeout(500);
    assert.deepEqual(await gridLines(q), before, "one Undo takes all three back");
    assert.deepEqual(q.pageErrors, []);
  } finally {
    await q.close();
  }
});

test("iPhone 13: the toolbar at the phone's width — the modify button's face is trim, and it stays the last armed", async () => {
  const p = await openApp({ device: "iPhone 13" });
  try {
    const face = () => p.page.$eval('#toolbar button[data-group="modify"]', (el) => (el as HTMLElement).dataset.tool);
    assert.equal(await face(), "trim", "trim heads the modify group");
    await shot(p, "369-iphone-toolbar-modify-face-trim");
    await p.type("fillet");
    await p.page.waitForTimeout(200);
    assert.equal(await face(), "fillet", "the face follows the member armed last");
    await p.type("cancel()");
    assert.deepEqual(p.pageErrors, []);
  } finally {
    await p.close();
  }
});
