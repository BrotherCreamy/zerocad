// Construction geometry driven the way a user drives it (docs/plans/
// construction.md): a rectangle and a circle inside it, the circle made
// construction from its own right-click menu, the rectangle extruded — no
// hole — then the circle made not construction, which adds no hole by itself
// or by `regen("e1")`, and its menu's *Add as hole to e1* cutting it; a
// circle drawn with the circle tool's `construction` box ticked; and
// the look, on the dark ground and over a solid's light faces: thin, muted, a
// solid line, never dashed (a dash means selection here).
//
// Set NEOCAD_E2E_SHOTS to a directory to keep the screenshots, and look at
// them: the two that matter are construction-ground and construction-solid.
//
// One app, tests in order: the states are cumulative.

import { test, before, after } from "node:test";
import assert from "node:assert/strict";
import { mkdirSync } from "node:fs";
import { join } from "node:path";
import { openApp, axisFrame, confirmAndRelease, type AppContext } from "./harness.ts";

let app: AppContext;
before(async () => {
  app = await openApp();
  await axisFrame(app, [-150, -110]); // parked clear of everything drawn below
});
after(async () => {
  assert.deepEqual(app.pageErrors, [], "nothing the page threw went uncaught");
  await app.close();
});

const SHOTS = process.env.NEOCAD_E2E_SHOTS;
async function shot(name: string): Promise<void> {
  if (!SHOTS) return;
  mkdirSync(SHOTS, { recursive: true });
  await app.page.waitForTimeout(120);
  await app.page.screenshot({ path: join(SHOTS, `construction-${name}.png`) });
}

async function press(sx: number, sy: number, button: "left" | "right" = "left"): Promise<void> {
  const at = await app.at(sx, sy);
  await app.page.mouse.move(at.x, at.y);
  await app.page.mouse.down({ button });
  await app.page.mouse.up({ button });
  await app.page.waitForTimeout(180);
}

async function drag(from: [number, number], to: [number, number]): Promise<void> {
  const a = await app.at(...from);
  const b = await app.at(...to);
  await app.page.mouse.move(a.x, a.y);
  await app.page.mouse.down();
  await app.page.mouse.move(b.x, b.y, { steps: 8 });
  await app.page.mouse.up();
  await app.page.waitForTimeout(220);
}

async function items(): Promise<string[]> {
  return app.page.$$eval("#ctxmenu .item", (els) => els.map((el) => el.firstElementChild?.textContent ?? ""));
}

async function choose(label: string): Promise<string> {
  const handle = await app.page.evaluateHandle((want) => {
    const rows = Array.from(document.querySelectorAll("#ctxmenu .item"));
    return rows.find((el) => el.firstElementChild?.textContent === want) ?? null;
  }, label);
  const el = handle.asElement();
  assert.ok(el, `no menu item labelled ${JSON.stringify(label)} — had ${(await items()).join(", ")}`);
  const command = await el.evaluate((row) => row.querySelector(".cmd")?.textContent ?? "");
  await el.click();
  await app.page.waitForTimeout(250);
  return command;
}

async function key(k: string): Promise<void> {
  await app.page.fill("#cmd", "");
  await app.page.keyboard.press(k);
  await app.page.waitForTimeout(250);
}

async function hoverTag(sx: number, sy: number): Promise<string> {
  await app.page.mouse.move(0, 0);
  const at = await app.at(sx, sy);
  await app.page.mouse.move(at.x, at.y);
  await app.page.waitForTimeout(150);
  return app.page.$eval("#hovertag", (el) => ((el as HTMLElement).hidden ? "" : el.textContent ?? ""));
}

const value = async (src: string) => (await app.repl(src)).value;
const isConstruction = (name: string) => value(`model.isConstruction(${JSON.stringify(name)})`) as Promise<boolean>;
const profileLoops = () => value('model.featureOf("e1").loops.length') as Promise<number>;

/** The rectangle, the circle in it, and the screen points this suite aims at. */
const RECT: [[number, number], [number, number]] = [[420, 240], [620, 400]];
const CENTRE: [number, number] = [520, 320];
const RIM: [number, number] = [560, 320];
/** Inside the rectangle, outside the circle. */
const BETWEEN: [number, number] = [445, 265];
let circle = "";

test("draw a rectangle and a circle inside it: two regions, the circle a hole", async () => {
  await app.type("rectangle");
  await drag(...RECT);
  await app.type("circle");
  await drag(CENTRE, RIM);
  await app.type("cancel()");
  const m = await app.model();
  assert.equal(m.lines.length, 4);
  circle = m.circles[0].name;
  assert.equal(((await value("loops()")) as string[]).length, 2);
  assert.equal(await app.status(), "SOLVED");
});

test("right-click the circle → Construction: typed, one region left, the tag says so, one undo step", async () => {
  await app.page.fill("#cmd", "");
  await press(...RIM, "right");
  assert.ok((await items()).includes("Construction"), `had ${(await items()).join(", ")}`);
  const typed = await choose("Construction");
  assert.equal(typed, `construction("${circle}")`);
  assert.match(await app.log(), new RegExp(`> construction\\("${circle}"\\)`), "the log shows the line it typed");
  assert.equal(await isConstruction(circle), true);
  assert.equal(((await value("loops()")) as string[]).length, 1, "the circle bounds nothing now");
  // A circle carries its own normal, so the tag says which way it faces where
  // it named its frame ("in f") — docs/plans/frameless-curves.md.
  assert.match(await hoverTag(...RIM), new RegExp(`^${circle} {2}r [\\d.]+ {2}facing -?[\\d.]+, -?[\\d.]+, -?[\\d.]+ {2}construction`));

  await key("Control+z");
  assert.equal(await isConstruction(circle), false, "undone");
  await key("Control+Shift+z");
  assert.equal(await isConstruction(circle), true, "redone");
  await press(...RIM, "right");
  assert.ok((await items()).includes("Not construction"), "the menu now offers the way back");
  await key("Escape");
});

test("extrude the rectangle: no hole where the construction circle is", async () => {
  await app.type('arm("extrude")');
  await press(...BETWEEN);
  await confirmAndRelease(app);
  assert.equal(await profileLoops(), 1, "a profile of one loop: no hole");
  const px = await app.pixel(CENTRE[0] + 0.5, CENTRE[1] + 0.5, "faces");
  assert.equal(px[3], 255, `the lid is whole over the circle's centre: ${px}`);
});

test("made not construction from its menu (in the hidden view, where it can be reached): no hole by itself, nor by regen — Add as hole to e1 cuts it", async () => {
  // Shaded, the solid is opaque and the circle under its lid cannot be
  // clicked; the hidden view draws it dimmed and keeps it pickable.
  await app.type('view("hidden")');
  await press(...RIM, "right");
  const typed = await choose("Not construction");
  assert.equal(typed, `construction("${circle}", false)`);
  assert.equal(await isConstruction(circle), false);
  assert.equal(await profileLoops(), 1, "the solid does not change by itself");
  await app.type('regen("e1")');
  assert.equal(await profileLoops(), 1, "nor does regen: inside is not membership (docs/plans/explicit-regions.md)");
  await press(...RIM, "right");
  assert.equal(await choose("Add as hole to e1"), `hole("e1", "${circle}")`);
  assert.equal(await profileLoops(), 2, "said to be a hole, it is one");
  await app.type('view("shaded")');
  const px = await app.pixel(CENTRE[0] + 0.5, CENTRE[1] + 0.5, "faces");
  assert.equal(px[3], 0, `straight down the hole there is no face: ${px}`);
});

/** A construction circle and a plain one, side by side on the ground, for the look. */
const C_CENTRE: [number, number] = [820, 560];
const C_RIM: [number, number] = [870, 560];
let drawn = "";

test("the circle tool's construction box: ticked, it types arm(…, {construction: true}) and the next circle is construction", async () => {
  await app.type("circle");
  const box = '.panel[data-panel="options"] input[data-option="construction"]';
  assert.equal(await app.page.isChecked(box), false, "off unless asked");
  await app.page.click(box);
  await app.page.waitForTimeout(150);
  assert.match(await app.log(), /> arm\("circle", \{construction: true\}\)/, "the box types the arm line");
  assert.equal(await app.page.isChecked(box), true);
  const had = new Set((await app.model()).circles.map((c) => c.name)); // the hole, and its twin on the lid
  await drag(C_CENTRE, C_RIM);
  const m = await app.model();
  const made = m.circles.map((c) => c.name).filter((n) => !had.has(n));
  assert.equal(made.length, 1);
  assert.equal(await isConstruction(made[0]), true, "construction from the start");
  drawn = made[0];
  assert.equal(m.journalOps.at(-1), "construction", "journalled straight after the circle");
  await app.type("cancel()");
  const listed = (await value("tools()")) as string[];
  assert.ok(listed.some((l) => l.startsWith('circle  { construction: true, method: "auto" }  (default { construction: false, method: "auto" })  — ')),
    "remembered like any option");
  await app.type('arm("circle", { construction: false })');
  await app.type("cancel()");
});

/** The colour of each pixel along a radial line through a circle's rim, out from `c`. */
async function radial(c: [number, number], r: number): Promise<number[][]> {
  const at: [number, number][] = [];
  for (let d = r - 5; d <= r + 5; d += 0.5) at.push([c[0] + d + 0.25, c[1] + 0.25]);
  return app.pixels("drawing", at);
}
/**
 * How much ink a radial cut through a stroke carries: the coverage summed
 * across it, which is the stroke's width however anti-aliasing spreads it.
 */
const inked = (px: number[][]) => px.reduce((s, p) => s + p[3] / 255, 0);
const brightest = (px: number[][]) => px.reduce((b, p) => (p[0] + p[1] + p[2] > b[0] + b[1] + b[2] ? p : b), [0, 0, 0, 0]);

test("the look on the dark ground: thin, a muted teal of its own, and a solid line all the way round", async () => {
  // A plain circle of the same size below it, typed, for the comparison.
  const m = await app.model();
  const centre = m.points[m.circles.find((c) => c.name === drawn)!.center];
  const r = m.radii[drawn];
  await app.type(`plain = circ(pt(${centre[0]}, ${centre[1] - 3 * r}, ${centre[2] ?? 0}), ${r})`);
  await app.page.mouse.move(0, 0);
  await app.page.waitForTimeout(150);
  await shot("ground");

  const [cx, cy] = await app.screenOf(centre);
  const [px, py] = await app.screenOf([centre[0], centre[1] - 3 * r, centre[2] ?? 0]);
  const rr = r * m.view.scale;
  const cons = await radial([cx, cy], rr);
  const plain = await radial([px, py], rr);
  assert.ok(inked(cons) > 0 && inked(plain) > 0, "both drawn");
  assert.ok(inked(cons) < inked(plain), `thinner than a plain curve: ${inked(cons).toFixed(2)} against ${inked(plain).toFixed(2)}`);
  const c = brightest(cons), p = brightest(plain);
  assert.ok(c[1] > c[0] + 15, `a teal of its own, green over red: ${c}`);
  assert.ok(c[0] + c[1] + c[2] < p[0] + p[1] + p[2], `muted against the plain ink: ${c} against ${p}`);

  // Never dashed: every one of 90 samples round the rim carries ink.
  const round: [number, number][] = [];
  for (let k = 0; k < 90; k++) {
    const a = (2 * Math.PI * k) / 90;
    round.push([cx + rr * Math.cos(a), cy - rr * Math.sin(a)]);
  }
  const rim = await app.pixels("drawing", round);
  const gaps = round.filter((_, i) => {
    // The pixel or one of its neighbours, so anti-aliasing on a curve at 0.9px cannot fake a gap.
    return rim[i][3] < 30;
  });
  if (gaps.length) {
    const near = await app.pixels("drawing", gaps.flatMap(([x, y]) => [[x + 1, y], [x - 1, y], [x, y + 1], [x, y - 1]] as [number, number][]));
    for (let i = 0; i < gaps.length; i++) {
      assert.ok(near.slice(4 * i, 4 * i + 4).some((q) => q[3] >= 30), `a gap in the rim at ${gaps[i]}: dashed?`);
    }
  }
});

test("the look on a solid: a construction line across the lid is drawn thin and teal over the light face, unbroken", async () => {
  // A line just above the lid (the extrude's default depth, 10), across it.
  const lid = 10.2;
  const at = async (sx: number, sy: number) => {
    const v = (await app.model()).view;
    return [(sx - v.ox) / v.scale, -(sy - v.oy) / v.scale, lid];
  };
  const a = await at(430, 380), b = await at(610, 250);
  await app.type(`lc = ln(pt(${a.join(", ")}), pt(${b.join(", ")})); construction(lc)`);
  const lc = (await value("lc")) as string;
  assert.equal(await isConstruction(lc), true);
  await app.page.mouse.move(0, 0);
  await app.page.waitForTimeout(150);
  await shot("solid");

  const [sa, sb] = [await app.screenOf(a), await app.screenOf(b)];
  const along: [number, number][] = [];
  for (let k = 2; k < 40; k++) {
    const t = k / 41;
    along.push([sa[0] + t * (sb[0] - sa[0]), sa[1] + t * (sb[1] - sa[1])]);
  }
  // Clear of the hole and the circle's rim, which the line crosses.
  const [cx, cy] = CENTRE;
  const clear = along.filter(([x, y]) => Math.abs(Math.hypot(x - cx, y - cy) - 40) > 6);
  const px = await app.pixels("drawing", clear);
  const face = await app.pixels("faces", clear);
  let teal = 0;
  clear.forEach((_, i) => {
    const q = px[i];
    if (q[3] > 200 && q[1] > q[0] + 15) teal++;
  });
  assert.ok(face.filter((f) => f[3] === 255).length > clear.length / 2, "most of the line is over the lid");
  assert.ok(teal >= clear.length * 0.9, `the teal mark, unbroken, along ${teal} of ${clear.length} samples`);
});
