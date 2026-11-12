// Every standard relation, in the real app (docs/plans/relations-complete.md),
// with a mouse and on an iPhone 13 by finger: five lines picked and Equal;
// a point on an ellipse; Tangent between an arc and a spline's end;
// Symmetric for two circles; Fix on a point, then a drag that cannot move it;
// a point On a solid's face; a cell greyed with its reason; and the list at
// the phone's width, where it has to fit.
//
// The unit suite proves the table and the relations. What only a browser
// shows is whether a pick lands as the name the table reads (a rim, a
// spline's curve, a face under an empty pixel), whether the row a finger
// presses types the line it says, whether the marks read — the padlock, ◎=,
// ⇌ on a rim — and whether the list fits a phone.

import { test, before, after } from "node:test";
import assert from "node:assert/strict";
import { existsSync, mkdirSync } from "node:fs";
import { join } from "node:path";
import { forgetAutosave, openApp, type AppContext } from "./harness.ts";
import { fingers, type Fingers } from "./fingers.ts";

const built = existsSync(new URL("../../src/solids/smlib-gen/smlib.mjs", import.meta.url));
const noSolids = built ? false : "no SMLib build — run `npm run build:solids`";

/** Where pictures go when asked for (NEOCAD_E2E_SHOTS), to be looked at. */
const SHOTS = process.env.NEOCAD_E2E_SHOTS;

interface Rel { name: string; op: string; args: unknown[] }
interface Probe {
  __neocad: {
    model: {
      relations: Map<string, { op: string; args: unknown[] }>;
      coords(n: string): number[];
      radius(n: string): number;
      circular(n: string): { center: string };
      line(n: string): { refs: [string, string] };
      entities: Map<string, { kind: string; center?: string; major?: string; minorVar?: number }>;
      problem: { getVar(i: number): number };
    };
    engine: { glyphs(): { relation: string; op: string; symbol: string; screen: [number, number] }[] };
  };
}

/** One way of working the app: a mouse on a desktop, or a finger on a phone. */
interface Hand {
  name: "desktop" | "iphone";
  app: AppContext;
  /** A press on the canvas, at canvas pixels clear of every pane. */
  press(at: [number, number]): Promise<void>;
  /** A press on the options panel's row with this label. */
  row(label: string): Promise<void>;
  /** A press-and-drag on the canvas. */
  drag(from: [number, number], to: [number, number]): Promise<void>;
  /**
   * Brings a quiet corner into sight (quiet.ts: a line's or an arc's end, and
   * the marks on it, are drawn only while the hand is on it) — the mouse
   * rests on it; a finger, which cannot hover, taps it and so selects it.
   */
  reveal(at: [number, number]): Promise<void>;
}

let desk: AppContext, phone: AppContext, f: Fingers;
let mouse: Hand, finger: Hand;

/** A row's middle, in canvas pixels — what a finger is given. */
const rowAt = (app: AppContext, label: string) => app.page.evaluate((want) => {
  const row = Array.from(document.querySelectorAll<HTMLElement>("#constraints .ocmd")).find((r) => r.querySelector(".olabel")?.textContent === want);
  if (!row) return null;
  const r = row.getBoundingClientRect(), c = document.getElementById("cv")!.getBoundingClientRect();
  return [r.x + r.width / 2 - c.x, r.y + r.height / 2 - c.y] as [number, number];
}, label);

before(async () => {
  desk = await openApp();
  phone = await openApp({ device: "iPhone 13" });
  mouse = {
    name: "desktop",
    app: desk,
    async press(at) {
      const p = await desk.at(...at);
      await desk.page.mouse.click(p.x, p.y);
      await desk.page.waitForTimeout(150);
    },
    async row(label) {
      // The mouse itself, at the row's middle: a greyed row is aria-disabled, which
      // a locator refuses to click and a hand does not.
      const box = await desk.page.locator("#constraints .ocmd", { has: desk.page.locator(".olabel", { hasText: new RegExp(`^${label.replace(/[()]/g, "\\$&")}$`) }) }).boundingBox();
      assert.ok(box, `a row labelled ${label}`);
      await desk.page.mouse.click(box!.x + box!.width / 2, box!.y + box!.height / 2);
      await desk.page.waitForTimeout(300);
    },
    async drag(from, to) {
      const p = await desk.at(...from), q = await desk.at(...to);
      await desk.page.mouse.move(p.x, p.y);
      await desk.page.mouse.down();
      await desk.page.mouse.move(q.x, q.y, { steps: 10 });
      await desk.page.mouse.up();
      await desk.page.waitForTimeout(300);
    },
    async reveal(at) {
      const p = await desk.at(...at);
      await desk.page.mouse.move(p.x, p.y);
      await desk.page.waitForTimeout(200);
    },
  };
  finger = {
    name: "iphone",
    app: phone,
    async press(at) {
      await phone.at(...at); // throws if a pane is there
      await f.tap(...at);
      await phone.page.waitForTimeout(250);
    },
    async row(label) {
      const at = await rowAt(phone, label);
      assert.ok(at, `a row labelled ${label}`);
      await f.tap(...at!);
      await phone.page.waitForTimeout(300);
    },
    async drag(from, to) {
      await phone.at(...from);
      await f.drag(from, to, 12);
      await phone.page.waitForTimeout(300);
    },
    async reveal(at) {
      await finger.press(at);
    },
  };
});
after(async () => { await desk.close(); await phone.close(); });

async function fresh(hand: Hand): Promise<void> {
  const app = hand.app;
  await app.page.evaluate(() => localStorage.clear());
  await forgetAutosave(app.page);
  await app.page.reload({ waitUntil: "networkidle" });
  await app.page.waitForFunction(() => document.getElementById("status")?.textContent?.includes("ready"), null, { timeout: 20_000 });
  if (hand.name === "iphone") f = await fingers(phone);
}

/** Types a line, then lets go of the command line, as a hand does before it touches the drawing again. */
async function type(hand: Hand, line: string): Promise<void> {
  await hand.app.type(line);
  await hand.app.page.evaluate(() => (document.activeElement as HTMLElement | null)?.blur());
}

async function shot(hand: Hand, name: string): Promise<void> {
  if (!SHOTS) return;
  mkdirSync(SHOTS, { recursive: true });
  await hand.app.page.waitForTimeout(200);
  await hand.app.page.screenshot({ path: join(SHOTS, `relations-${hand.name}-${name}.png`) });
}

const relations = (app: AppContext): Promise<Rel[]> => app.page.evaluate(() =>
  [...(window as never as Probe).__neocad.model.relations.entries()].map(([name, r]) => ({ name, op: r.op, args: r.args })));
const coords = (app: AppContext, n: string): Promise<number[]> => app.page.evaluate((p) => (window as never as Probe).__neocad.model.coords(p), n);
const glyphs = (app: AppContext) => app.page.evaluate(() => (window as never as Probe).__neocad.engine.glyphs());
const rows = (app: AppContext) => app.page.$$eval("#constraints .ocmd", (els) => els.map((e) => ({
  label: e.querySelector(".olabel")?.textContent ?? "", command: (e as HTMLElement).dataset.command ?? "", off: e.classList.contains("off"),
  more: e.classList.contains("more"),
})));

/** A point along a line, `t` of the way from its first end, in canvas pixels. */
async function along(app: AppContext, line: string, t: number): Promise<[number, number]> {
  const [a, b] = await app.page.evaluate((l) => {
    const m = (window as never as Probe).__neocad.model;
    const refs = m.line(l).refs;
    return [m.coords(refs[0]), m.coords(refs[1])];
  }, line);
  return app.screenOf(a.map((v, i) => v + t * (b[i] - v)));
}

/**
 * A pixel near `guess` (world) where a press picks `name` — a curve's, away
 * from the points on it, which win a press outright (picking.ts's tiers; a
 * finger's reach is 2.75 times a mouse's). Searched outward on screen from the
 * guess, and asked of the engine's own pick, so it is the pixel the press
 * will land on.
 */
async function curvePixel(app: AppContext, name: string, guess: number[]): Promise<[number, number]> {
  const [gx, gy] = await app.screenOf(guess);
  const at = await app.page.evaluate(([x0, y0, want]) => {
    const e = (window as never as { __neocad: { engine: { pickAt(x: number, y: number): { name: string } | null } } }).__neocad.engine;
    for (let r = 0; r <= 40; r += 2) {
      for (let k = 0; k < Math.max(1, r * 2); k++) {
        const t = (k / Math.max(1, r * 2)) * 2 * Math.PI;
        const [x, y] = [Math.round(x0 + r * Math.cos(t)), Math.round(y0 + r * Math.sin(t))];
        if (e.pickAt(x, y)?.name === want) return [x, y] as [number, number];
      }
    }
    return null;
  }, [gx, gy, name] as const);
  assert.ok(at, `a pixel near ${guess} that picks ${name}`);
  return at!;
}

/** What the constrain tool has picked, and which tool is armed — what a failure should say. */
const state = (app: AppContext) => app.page.evaluate(() => {
  const e = (window as never as { __neocad: { engine: { armed: { name: string } | null; active: { picks?: string[] } | null } } }).__neocad.engine;
  return JSON.stringify({ armed: e.armed?.name ?? null, picks: e.active?.picks ?? null });
});

/** The picking green (tools/region.ts's REGION_GREEN), within two pixels of `at` on the drawing. */
async function greenNear(app: AppContext, [x, y]: [number, number]): Promise<boolean> {
  const at: [number, number][] = [];
  for (let dx = -2; dx <= 2; dx++) for (let dy = -2; dy <= 2; dy++) at.push([Math.round(x) + dx, Math.round(y) + dy]);
  const px = await app.pixels("drawing", at);
  return px.some((p) => Math.hypot(p[0] - 0x55, p[1] - 0xc0, p[2] - 0x7a) < 40);
}

/** A name the command line bound, as the model calls it. */
const named = async (app: AppContext, v: string) => (await app.repl(v)).value as string;

/** Where on screen a point is. */
const pointAt = async (app: AppContext, p: string) => app.screenOf(await coords(app, p));

/** The constrain tool, armed by its button — behind the relate group's (a hover on a desktop, a long-press on a phone). */
async function armConstrain(hand: Hand): Promise<void> {
  const page = hand.app.page;
  if (hand.name === "desktop") {
    await page.hover('#toolbar button[data-group="relate"]');
    await page.waitForSelector('#flyout button[data-tool="constrain"]', { state: "visible", timeout: 3000 });
    await page.click('#flyout button[data-tool="constrain"]');
  } else {
    const mid = (sel: string) => page.$eval(sel, (el) => {
      const r = el.getBoundingClientRect(), c = document.getElementById("cv")!.getBoundingClientRect();
      return [r.x + r.width / 2 - c.x, r.y + r.height / 2 - c.y] as [number, number];
    });
    await f.hold(...await mid('#toolbar button[data-group="relate"]'), 700);
    await page.waitForSelector('#flyout button[data-tool="constrain"]', { state: "visible", timeout: 3000 });
    await f.tap(...await mid('#flyout button[data-tool="constrain"]'));
  }
  await page.waitForTimeout(200);
}

/** Every row of the options panel wholly on screen — what "the list fits" means. */
async function rowsFit(app: AppContext): Promise<{ fit: boolean; rows: number; bottom: number; height: number }> {
  return app.page.$$eval("#constraints .ocmd", (els) => {
    const rs = els.map((e) => e.getBoundingClientRect());
    const fit = rs.every((r) => r.top >= 0 && r.bottom <= innerHeight && r.left >= 0 && r.right <= innerWidth && r.height >= 14);
    return { fit, rows: rs.length, bottom: Math.max(...rs.map((r) => r.bottom)), height: innerHeight };
  });
}

const len = (a: number[], b: number[]) => Math.hypot(...a.map((v, i) => v - b[i]));

for (const which of ["desktop", "iphone"] as const) {
  const hand = () => (which === "desktop" ? mouse : finger);

  test(`${which}: five lines picked, Equal (all 5) — one relation among the five, one undo step`, async () => {
    const h = hand();
    await fresh(h);
    // Spaced to the room an iPhone 13 has between its panes: the constraints
    // palette docks at the bottom while the constrain tool is armed, and its
    // strip's hit box reaches a target up over the drawing (index.html) — a
    // fifth line at y −18 was under that reach — while a first line at y 36
    // was a finger's radius from the organiser's bottom edge, and the tap was
    // the organiser's (docs/plans/constraints-palette.md; harness.ts's `at`).
    await type(h, "ln(pt(-45, 30), pt(-5, 32)); ln(pt(-45, 20), pt(-15, 22)); ln(pt(-45, 10), pt(-2, 8)); ln(pt(-45, 0), pt(-20, -3)); ln(pt(-45, -10), pt(-18, -12))");
    await armConstrain(h);
    for (const l of ["l1", "l2", "l3", "l4", "l5"]) await h.press(await along(h.app, l, 0.5));
    let listed = await rows(h.app);
    assert.equal(listed[0]?.label, "Equal (all 5)", await state(h.app));
    const fits = await rowsFit(h.app);
    assert.ok(fits.fit, `every row shown is on screen: ${JSON.stringify(fits)}`);
    await shot(h, "1-five-lines-picked");
    // On a phone the palette shows the likeliest and a more… row (the two
    // lines' test below measures that); opened, the list is the whole one.
    const more = listed.find((r) => r.more);
    if (more) { await h.row(more.label); listed = await rows(h.app); }
    assert.deepEqual(listed.map((r) => r.label), ["Equal (all 5)", "Parallel (all 5)", "Collinear (all 5)", "Horizontal (all 5)", "Vertical (all 5)", "Fix (all 5)"], await state(h.app));
    // One call, one relation among the five: it was four eqs, each against
    // the first pick (docs/plans/review-relations.md).
    assert.equal(listed[0].command, 'eq("l1", "l2", "l3", "l4", "l5")');
    await h.row("Equal (all 5)");
    const eqs = (await relations(h.app)).filter((r) => r.op === "equalLength");
    assert.deepEqual(eqs.map((r) => r.args), [["l1", "l2", "l3", "l4", "l5"]]);
    assert.equal(await h.app.status(), "SOLVED");
    const lengths = await h.app.page.evaluate(() => {
      const m = (window as never as Probe).__neocad.model;
      return ["l1", "l2", "l3", "l4", "l5"].map((l) => { const [a, b] = m.line(l).refs.map((p) => m.coords(p)); return Math.hypot(...a.map((v, i) => v - b[i])); });
    });
    for (const x of lengths) assert.ok(Math.abs(x - lengths[0]) < 1e-6, `equal: ${lengths}`);
    assert.equal((await glyphs(h.app)).filter((g) => g.op === "equalLength").length, 5, "an = on each of the five, and no line wearing four");
    await type(h, "select");
    await shot(h, "2-five-lines-equal");
    assert.equal((await h.app.repl("undo()")).ok, true);
    assert.equal((await relations(h.app)).filter((r) => r.op === "equalLength").length, 0, "one undo step takes it");
  });

  test(`${which}: two lines' list — eight rows, most likely first; on a phone the likeliest, and more… opens the rest`, async () => {
    const h = hand();
    await fresh(h);
    await type(h, "ln(pt(-30, 0), pt(30, 4)); ln(pt(-30, 25), pt(30, 15))");
    await type(h, "constrain");
    await h.press(await along(h.app, "l1", 0.3));
    await h.press(await along(h.app, "l2", 0.3));
    const all = ["Parallel", "Perpendicular", "Equal", "Collinear", "Horizontal (both)", "Vertical (both)", "Fix (both)", "Angle"];
    let listed = await rows(h.app);
    const fits = await rowsFit(h.app);
    assert.ok(fits.fit, `every row shown is on screen: ${JSON.stringify(fits)}`);
    if (which === "desktop") {
      assert.deepEqual(listed.map((r) => r.label), all);
    } else {
      // The palette's rows are a finger's target tall, and the pane docked at
      // the bottom holds a few of them: the likeliest show, most likely first,
      // and the more… row opens the rest (docs/plans/constraints-palette.md).
      const more = listed.find((r) => r.more);
      assert.ok(more, `a more… row: ${JSON.stringify(listed)}`);
      const shown = listed.filter((r) => !r.more).map((r) => r.label);
      assert.ok(shown.length >= 1 && shown.length < all.length, `some but not all: ${shown}`);
      assert.deepEqual(shown, all.slice(0, shown.length), "the likeliest, in order");
      assert.match(more!.label, new RegExp(`^${all.length - shown.length} more…$`));
      await shot(h, "3a-two-lines-the-likeliest-and-more");
      await h.row(more!.label);
      listed = await rows(h.app);
      assert.deepEqual(listed.map((r) => r.label), all, "more… opened the rest");
      // Opened, the pane scrolls: its last row can be brought wholly into its box.
      const reach = await h.app.page.evaluate(() => {
        const rows = Array.from(document.querySelectorAll<HTMLElement>("#constraints .ocmd"));
        const last = rows[rows.length - 1];
        last.scrollIntoView({ block: "end" });
        const r = last.getBoundingClientRect(), p = document.getElementById("constraints")!.getBoundingClientRect();
        return { ok: r.top >= p.top - 0.5 && r.bottom <= p.bottom + 0.5, r: [r.top, r.bottom], p: [p.top, p.bottom] };
      });
      assert.ok(reach.ok, `the last row reachable by a scroll: ${JSON.stringify(reach)}`);
    }
    await shot(h, "3-two-lines-list");
  });

  test(`${which}: a point on an ellipse — the point, the rim, On`, async () => {
    const h = hand();
    await fresh(h);
    await type(h, 'e = ellipse(pt(0, 0), pt(25, 0), 12); p = pt(8, 28)');
    const [p, e] = [await named(h.app, "p"), await named(h.app, "e")];
    await type(h, "constrain");
    await h.press(await pointAt(h.app, p));
    const th = (160 * Math.PI) / 180;
    await h.press(await curvePixel(h.app, e, [25 * Math.cos(th), 12 * Math.sin(th), 0]));
    const listed = await rows(h.app);
    assert.equal(listed[0]?.label, "On", await state(h.app));
    assert.equal(listed[0].command, `onellipse("${p}", "${e}")`);
    await h.row("On");
    const on = (await relations(h.app)).filter((r) => r.op === "onEllipse");
    assert.equal(on.length, 1);
    assert.equal(await h.app.status(), "SOLVED");
    const { q, c, m, b } = await h.app.page.evaluate((pt) => {
      const md = (window as never as Probe).__neocad.model;
      const e = md.entities.get(md.relations.get([...md.relations.keys()].at(-1)!)!.args[1] as string)!;
      return { q: md.coords(pt), c: md.coords(e.center!), m: md.coords(e.major!), b: md.problem.getVar(e.minorVar!) };
    }, p);
    const a = len(m, c), u = m.map((v, i) => (v - c[i]) / a);
    const x = q.reduce((s, v, i) => s + (v - c[i]) * u[i], 0), r2 = q.reduce((s, v, i) => s + (v - c[i]) ** 2, 0);
    assert.ok(Math.abs((x / a) ** 2 + (r2 - x * x) / (b * b) - 1) < 1e-6, "on the ellipse");
    await type(h, "select");
    await shot(h, "4-point-on-ellipse");
  });

  test(`${which}: Tangent between an arc and a spline's end`, async () => {
    const h = hand();
    await fresh(h);
    // The arc from (0, 0) round to (-20, 20) about (-20, 0), and a spline
    // leaving its start the wrong way (down and out) — Tangent turns it.
    // Through-points well apart: a finger's reach is 22 px, and a press near
    // one would pick the point.
    await type(h, 'c = pt(-20, 0); s = pt(0, 0); e = pt(-20, 20); a = arc(c, s, e, 20); arcends(a); sp = spline(s, [24, -14, 0], [44, -6, 0])');
    const [a, sp] = [await named(h.app, "a"), await named(h.app, "sp")];
    await type(h, "constrain");
    await h.press(await curvePixel(h.app, a, [-20 + 20 * Math.SQRT1_2, 20 * Math.SQRT1_2, 0]));
    // On the spline, between its first two through-points (a press on one of
    // them would pick the point).
    const onSpline = await curvePixel(h.app, sp, [12, -8, 0]);
    await h.press(onSpline);
    // A picked spline is marked in the picking green, as a picked arc is (it
    // drew nothing — bug 53, found by looking at this test's iPhone picture).
    await h.app.page.mouse.move(2, 2);
    assert.ok(await greenNear(h.app, onSpline), "the spline drawn in the picking green");
    const listed = await rows(h.app);
    assert.deepEqual(listed.map((r) => r.label), ["Tangent"], await state(h.app));
    assert.equal(listed[0].off, false);
    await shot(h, "5-arc-and-spline-picked");
    await h.row("Tangent");
    const tan = (await relations(h.app)).filter((r) => r.op === "tangent");
    assert.equal(tan.length, 1);
    assert.equal(tan[0].args[2], "start", "held at the spline's start, the end it shares with the arc");
    assert.equal(await h.app.status(), "SOLVED", "the solve holds the join smooth");
    assert.ok((await glyphs(h.app)).some((g) => g.op === "tangent"), "a ⌒ at the join");
    await type(h, "select");
    // The join is a quiet corner, and its ⌒ quiet with it until the hand is on it.
    await h.reveal(await pointAt(h.app, await named(h.app, "s")));
    await shot(h, "6-arc-spline-tangent");
  });

  test(`${which}: Symmetric for two circles about a line — mirrored centres, equal radii, ⇌ on each rim`, async () => {
    const h = hand();
    await fresh(h);
    await type(h, "circ(pt(-22, 8), 10); circ(pt(16, 14), 8); ln(pt(0, -25), pt(0, 35))");
    await type(h, "constrain");
    // The owner's order: the two circles first, then the mirror line. Two
    // circles' list is seven rows, and when it was the options pane it covered
    // the second circle and the line on an iPhone (TODO.md, 2026-11-08). The
    // constraints palette is docked at the bottom instead
    // (docs/plans/constraints-palette.md): with both circles picked, both
    // rims and the line's upper half are clear of every pane — `at` throws
    // for a pixel a pane would take — and the list shows its likeliest rows.
    await h.press(await curvePixel(h.app, "c1", [-22, 18, 0]));
    await h.press(await curvePixel(h.app, "c2", [16, 22, 0]));
    const two = await rows(h.app);
    assert.equal(two[0]?.label, "Concentric", await state(h.app));
    for (const w of [[-22, 18, 0], [-32, 8, 0], [-22, -2, 0], [16, 22, 0], [24, 14, 0], [16, 6, 0], [0, 30, 0], [0, 10, 0]]) {
      const [sx, sy] = await h.app.screenOf(w);
      await h.app.at(sx, sy);
    }
    await shot(h, "7a-two-circles-picked-the-palette-up-the-line-in-sight");
    await h.press(await along(h.app, "l1", 0.85));
    const listed = await rows(h.app);
    assert.deepEqual(listed.map((r) => r.label), ["Symmetric"], await state(h.app));
    assert.equal(listed[0].command, 'sym("c1", "c2", "l1")');
    await h.row("Symmetric");
    assert.equal(await h.app.status(), "SOLVED");
    const g = await h.app.page.evaluate(() => {
      const m = (window as never as Probe).__neocad.model;
      return { o1: m.coords(m.circular("c1").center), o2: m.coords(m.circular("c2").center), r1: m.radius("c1"), r2: m.radius("c2"),
        a: m.coords(m.line("l1").refs[0]), b: m.coords(m.line("l1").refs[1]) };
    });
    const u = g.b.map((v, i) => v - g.a[i]), uu = u.reduce((s, v) => s + v * v, 0);
    const d = g.o1.map((v, i) => v - g.a[i]), t = d.reduce((s, v, i) => s + v * u[i], 0) / uu;
    const mirror = g.a.map((v, i) => v + 2 * t * u[i] - d[i]);
    assert.ok(len(mirror, g.o2) < 1e-6, `c2's centre is c1's mirrored: ${g.o2} vs ${mirror}`);
    assert.ok(Math.abs(g.r1 - g.r2) < 1e-6, "equal radii");
    assert.equal((await glyphs(h.app)).filter((x) => x.op === "symmetric").length, 2, "⇌ on each circle");
    // And a coradial pair beside it, for its mark.
    await type(h, "circ(pt(40, -15), 5); circ(pt(43, -13), 7); corad(\"c3\", \"c4\")");
    assert.ok((await glyphs(h.app)).some((x) => x.op === "coradial" && x.symbol === "◎="), "◎= at the shared centre");
    await type(h, "select");
    await shot(h, "7-symmetric-circles");
  });

  test(`${which}: Fix on a point, then a drag that cannot move it — and the other end still moves`, async () => {
    const h = hand();
    await fresh(h);
    await type(h, "ln(pt(-20, 0), pt(20, 10))");
    await type(h, "constrain");
    await h.press(await pointAt(h.app, "p1"));
    const listed = await rows(h.app);
    assert.deepEqual(listed.map((r) => r.label), ["Fix"]);
    assert.equal(listed[0].command, 'fix("p1", [-20, 0, 0])');
    await h.row("Fix");
    assert.equal((await relations(h.app)).filter((r) => r.op === "fix").length, 1);
    assert.ok((await glyphs(h.app)).some((g) => g.op === "fix"), "a mark on it");
    await type(h, "select");
    // A line's end is a quiet corner, and its padlock quiet with it until the hand is on it.
    await h.reveal(await pointAt(h.app, "p1"));
    await shot(h, "8-fixed-point-padlock");
    const before = await coords(h.app, "p1");
    const at = await pointAt(h.app, "p1");
    await h.drag(at, [at[0] + 60, at[1] - 40]);
    const after = await coords(h.app, "p1");
    assert.ok(len(before, after) < 1e-6, `the fixed point stayed: ${before} → ${after}`);
    const free = await coords(h.app, "p2");
    const at2 = await pointAt(h.app, "p2");
    await h.drag(at2, [at2[0] + 30, at2[1] + 30]);
    assert.ok(len(free, await coords(h.app, "p2")) > 1, "the other end is not fixed, and moves");
    assert.equal(await h.app.status(), "SOLVED");
    await shot(h, "9-after-the-drags");
  });

  test(`${which}: a line and a spline that meet nowhere — Tangent greyed, and a press says why`, async () => {
    const h = hand();
    await fresh(h);
    await type(h, "ln(pt(-30, 0), pt(0, 0)); spline([5, 15, 0], [25, 28, 0], [45, 18, 0])");
    await type(h, "constrain");
    await h.press(await along(h.app, "l1", 0.5));
    await h.press(await curvePixel(h.app, "sp1", [15, 22, 0]));
    const listed = await rows(h.app);
    assert.deepEqual(listed.map((r) => [r.label, r.off]), [["Tangent", true]], await state(h.app));
    await shot(h, "10-tangent-greyed");
    await h.row("Tangent");
    assert.equal((await relations(h.app)).filter((r) => r.op === "tangent").length, 0, "a greyed row types nothing");
    assert.match(await h.app.log(), /neither end of "sp1" meets "l1"/, "and says why");
  });

  test(`${which}: a point On a solid's face — the point, then the box's top`, { skip: noSolids }, async () => {
    const h = hand();
    await fresh(h);
    await type(h, "a = pt(-20, -12); b = pt(20, -12); c = pt(20, 12); d = pt(-20, 12); ln(a, b); ln(b, c); ln(c, d); ln(d, a)");
    await type(h, 'extrude("l1", 15); p = pt(-34, 24)');
    await type(h, "orbit(0.3, 0.5)");
    await h.app.page.waitForFunction(() => (window as never as { __neocad: { bodies: { settled: boolean } } }).__neocad.bodies.settled,
      undefined, { timeout: 20_000 });
    const p = (await h.app.repl("p")).value as string;
    await type(h, "constrain");
    await h.press(await pointAt(h.app, p));
    await h.press(await h.app.screenOf([2, 3, 15]));
    const listed = await rows(h.app);
    assert.equal(listed[0]?.label, "On face", `${JSON.stringify(listed)} ${await state(h.app)}`);
    assert.match(listed[0].command, new RegExp(`^onplane\\("${p}", "p\\d+\\.p\\d+\\.p\\d+"\\)$`));
    await shot(h, "11-point-and-face-picked");
    await h.row("On face");
    assert.equal(await h.app.status(), "SOLVED");
    const z = (await coords(h.app, p))[2];
    assert.ok(Math.abs(z - 15) < 1e-6, `on the top, 15 up: ${z}`);
    await type(h, "select");
    await shot(h, "12-point-on-the-face");
  });
}

test("no uncaught page errors", () => {
  assert.deepEqual(desk.pageErrors, []);
  assert.deepEqual(phone.pageErrors, []);
});
