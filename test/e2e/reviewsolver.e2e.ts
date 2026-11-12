// A direction relation turns lines and never scales them, and a conflict names
// the relation that made it (docs/plans/review-solver.md) — in the real app,
// with a mouse and by finger on an iPhone 13.
//
// The unit suite (test/directionrows.test.ts, test/culprit.test.ts) proves the
// rows and what is named. What only a browser shows:
// - that Parallel pressed in the constraints palette over two free lines
//   leaves the lines on the screen as long as they were — the picture of
//   docs/images/422, where they ended 8.8 and 1.2 long under SOLVED;
// - that the status, the glyphs and the palette each say **which** relation
//   made a conflict and which it is against, and that the two are told apart
//   on a phone's screen, where a glyph is a dozen pixels: the culprit's box
//   is filled with the conflict's ink, what it is against is outlined in a
//   quieter one.
//
// Pictures with NEOCAD_E2E_SHOTS, to be looked at. No fixed waits where a
// condition can be polled for.

import { test, before, after } from "node:test";
import assert from "node:assert/strict";
import { mkdirSync } from "node:fs";
import { join } from "node:path";
import { forgetAutosave, openApp, type AppContext } from "./harness.ts";
import { fingers, type Fingers } from "./fingers.ts";

const SHOTS = process.env.NEOCAD_E2E_SHOTS;
/** A picture of the whole page, or of `clip` (page pixels) at twice the size — a phone's glyph, large enough to judge. */
async function shot(app: AppContext, name: string, clip?: { x: number; y: number; width: number; height: number }): Promise<void> {
  if (!SHOTS) return;
  mkdirSync(SHOTS, { recursive: true });
  await app.page.evaluate(() => new Promise((r) => requestAnimationFrame(() => requestAnimationFrame(r))));
  await app.page.screenshot({ path: join(SHOTS, `${name}.png`), ...(clip ? { clip } : {}) });
}

/** The conflict's ink, the quieter ink of what a culprit is against, and a culprit's mark on its filled box (main.ts). */
const RED = [0xe0, 0x60, 0x5c];
const AGAINST = [0xb9, 0x8a, 0x86];

interface Probe {
  __neocad: {
    model: {
      relations: Map<string, { op: string; args: unknown[] }>;
      coords(n: string): number[];
      line(n: string): { refs: [string, string] };
    };
    engine: { glyphs(): { relation: string; symbol: string; screen: [number, number]; halfW: number; halfH: number }[]; model: { searchMs: number } };
    files: { flush(): Promise<void> };
  };
}

const relations = (app: AppContext) => app.page.evaluate(() =>
  [...(window as never as Probe).__neocad.model.relations.entries()].map(([name, r]) => ({ name, op: r.op, args: r.args })));
const glyphs = (app: AppContext) => app.page.evaluate(() => (window as never as Probe).__neocad.engine.glyphs());
const diagnosisText = (app: AppContext) => app.page.$eval("#diagnosis", (el) => el.textContent ?? "");
const lengths = (app: AppContext, lines: string[]) => app.page.evaluate((ls) => ls.map((l) => {
  const m = (window as never as Probe).__neocad.model;
  const [a, b] = m.line(l).refs.map((p) => m.coords(p));
  return Math.hypot(...a.map((v, i) => v - b[i]));
}), lines);
/** The sine of the angle between two lines, by the cross product. */
const sine = (app: AppContext, a: string, b: string) => app.page.evaluate(([la, lb]) => {
  const m = (window as never as Probe).__neocad.model;
  const dir = (l: string) => { const [p, q] = m.line(l).refs.map((n) => m.coords(n)); return q.map((v, i) => v - p[i]); };
  const [u, v] = [dir(la), dir(lb)];
  const c = [u[1] * v[2] - u[2] * v[1], u[2] * v[0] - u[0] * v[2], u[0] * v[1] - u[1] * v[0]];
  return Math.hypot(...c) / (Math.hypot(...u) * Math.hypot(...v));
}, [a, b]);

async function verdict(app: AppContext, want: string): Promise<void> {
  await app.page.waitForFunction((w) => document.getElementById("status")?.textContent === w, want, { timeout: 10_000 });
}

async function selected(app: AppContext, want: string[]): Promise<void> {
  const deadline = Date.now() + 5000;
  for (;;) {
    const now = (await app.selection()).sort();
    if (JSON.stringify(now) === JSON.stringify([...want].sort())) return;
    if (Date.now() > deadline) assert.deepEqual(now, [...want].sort(), "the selection");
    await app.page.evaluate(() => new Promise((r) => requestAnimationFrame(r)));
  }
}

let desk: AppContext;
let phone: AppContext;
let f: Fingers;
before(async () => {
  desk = await openApp();
  phone = await openApp({ device: "iPhone 13" });
});
after(async () => { await desk.close(); await phone.close(); });

async function fresh(app: AppContext): Promise<void> {
  await app.page.evaluate(() => localStorage.clear());
  await forgetAutosave(app.page);
  await app.page.reload({ waitUntil: "networkidle" });
  await app.page.waitForFunction(() => document.getElementById("status")?.textContent?.includes("ready"), null, { timeout: 20_000 });
  if (app === phone) f = await fingers(phone);
  await patient(app);
}

/**
 * Lifts the conflict search's clock from the model on the page. What a
 * conflict names is asked here of the trials, not of how busy the machine is:
 * with three other suites on this box (a load of thirty on four cores) the
 * 500 ms bound ran out on a rectangle's extrude and the status read "against
 * a set not found in time" — the bound doing its job, which
 * test/culprit.test.ts tests. A model an undo, a redo or a reload opens is a
 * new one, and is asked again.
 */
async function patient(app: AppContext): Promise<void> {
  await app.page.evaluate(() => { (window as never as Probe).__neocad.engine.model.searchMs = Infinity; });
}

/** Types a line, then lets go of the command line, as a hand does before it touches the drawing again. */
async function type(app: AppContext, line: string): Promise<void> {
  await app.type(line);
  await app.page.evaluate(() => (document.activeElement as HTMLElement | null)?.blur());
}

/** A point along a line, `t` of the way from its first end, in canvas pixels. */
async function along(app: AppContext, line: string, t: number): Promise<[number, number]> {
  const [a, b] = await app.page.evaluate((l) => {
    const m = (window as never as Probe).__neocad.model;
    const refs = m.line(l).refs;
    return [m.coords(refs[0]), m.coords(refs[1])];
  }, line);
  return app.screenOf(a.map((v, i) => v + t * (b[i] - v)));
}

/** A canvas pixel in the middle of `sel`. */
const middleOf = (app: AppContext, sel: string) => app.page.$eval(sel, (el) => {
  const r = el.getBoundingClientRect(), c = document.getElementById("cv")!.getBoundingClientRect();
  return [r.x + r.width / 2 - c.x, r.y + r.height / 2 - c.y] as [number, number];
});

/** A press on the drawing at a canvas pixel — a click, or a tap; refused by the harness where a pane is in the way. */
async function press(app: AppContext, at: [number, number], shift = false): Promise<void> {
  const p = await app.at(...at);
  if (app === phone) { await f.tap(...at); return; }
  if (shift) await app.page.keyboard.down("Shift");
  await app.page.mouse.click(p.x, p.y);
  if (shift) await app.page.keyboard.up("Shift");
}

/** A press on a piece of the chrome (a button, a palette row), by its selector. */
async function pressChrome(app: AppContext, sel: string): Promise<void> {
  await app.page.waitForSelector(sel, { state: "visible", timeout: 5000 });
  if (app === phone) await f.tap(...await middleOf(app, sel));
  else await app.page.click(sel);
}

/** Arms the constrain tool from the toolbar's relate group — a hover and a click, or a held finger and a tap. */
async function armConstrain(app: AppContext): Promise<void> {
  if (app === phone) await f.hold(...await middleOf(app, '#toolbar button[data-group="relate"]'), 700);
  else await app.page.hover('#toolbar button[data-group="relate"]');
  await pressChrome(app, '#flyout button[data-tool="constrain"]');
}

/** A point along `line` the drawing shows — the first of `ts` no pane lies over (the harness's `at` says which do). */
async function clearAlong(app: AppContext, line: string, ts: number[]): Promise<[number, number]> {
  let refused: unknown;
  for (const t of ts) {
    const at = await along(app, line, t);
    try { await app.at(...at); return at; } catch (e) { refused = e; }
  }
  throw refused;
}

/** Picks two lines with nothing armed, arms constrain, and presses Parallel's row in the palette. Returns the par's name. */
async function parallelFromPalette(app: AppContext, a: string, b: string, ta = 0.3, tb = 0.3): Promise<string> {
  await type(app, "select");
  await press(app, await clearAlong(app, a, [ta, 0.5, 0.4, 0.6, 0.2]));
  await press(app, await clearAlong(app, b, [tb, 0.5, 0.4, 0.6, 0.2]), true);
  await selected(app, [a, b]);
  await armConstrain(app);
  await pressChrome(app, `#constraints .ocmd[data-command='par("${a}", "${b}")']`);
  await app.page.waitForFunction(([x, y]) => [...(window as never as Probe).__neocad.model.relations.values()]
    .some((r) => r.op === "parallel" && r.args[0] === x && r.args[1] === y), [a, b], { timeout: 5000 });
  return (await relations(app)).find((r) => r.op === "parallel" && r.args[0] === a && r.args[1] === b)!.name;
}

/** The mouse moved off the drawing, so no hover outranks an ink. A finger hovers nothing. */
async function park(app: AppContext): Promise<void> {
  if (app === phone) return;
  const at = await app.at(...(await app.screenOf([-70, 40, 0])));
  await app.page.mouse.move(at.x, at.y);
  await app.page.evaluate(() => new Promise((r) => requestAnimationFrame(() => requestAnimationFrame(r))));
}

const close = (p: number[], want: number[], tol = 32) => Math.hypot(p[0] - want[0], p[1] - want[1], p[2] - want[2]) < tol;

/**
 * How each glyph of each relation is drawn, read off the drawing: `filled`
 * when the inside of its box, at a corner clear of its mark, is the conflict's
 * ink; else the ink of its outline, at the middle of its top edge (boxes side
 * by side share their left and right edges) — `red`, `against`, or `plain`.
 */
async function glyphInks(app: AppContext): Promise<Record<string, string[]>> {
  const out: Record<string, string[]> = {};
  const near = async ([x, y]: [number, number], want: number[]) => {
    const at: [number, number][] = [];
    for (let dx = -1; dx <= 1; dx++) for (let dy = -1; dy <= 1; dy++) at.push([Math.round(x) + dx, Math.round(y) + dy]);
    const px = await app.pixels("drawing", at);
    return px.some((p) => close(p, want));
  };
  for (const g of await glyphs(app)) {
    const [x, y] = g.screen;
    const inside: [number, number] = [x - g.halfW + 3, y - g.halfH + 3];
    const edge: [number, number] = [x, y - g.halfH];
    const ink = (await near(inside, RED)) ? "filled" : (await near(edge, RED)) ? "red" : (await near(edge, AGAINST)) ? "against" : "plain";
    (out[g.relation] ??= []).push(ink);
  }
  return out;
}

// --- 1: par on two free lines ---------------------------------------------------------------------

/**
 * docs/images/422's drawing, typed: two free lines, 60.1 and 60.8 long. On the
 * phone a little lower, in the band the drawing shows between the panes at
 * the top (the organiser, the log) and the palette the constrain tool brings
 * up at the bottom.
 */
async function twoFreeLines(app: AppContext): Promise<number[]> {
  const up = app === phone ? -12 : 0;
  await type(app, `ln(pt(-30, ${up}), pt(30, ${up + 4})); ln(pt(-30, ${up + 25}), pt(30, ${up + 15}))`);
  await app.page.waitForFunction(() => (window as never as Probe).__neocad.model.relations !== undefined);
  assert.deepEqual((await app.model()).lines.map((l) => l.name), ["l1", "l2"]);
  return lengths(app, ["l1", "l2"]);
}

for (const which of ["desktop", "iPhone 13"] as const) {
  test(`${which}: Parallel pressed over two free lines turns them — each as long as it was (it left them 8.8 and 1.2)`, async () => {
    const app = which === "desktop" ? desk : phone;
    await fresh(app);
    const was = await twoFreeLines(app);
    assert.ok(Math.abs(was[0] - Math.hypot(60, 4)) < 1e-9 && Math.abs(was[1] - Math.hypot(60, 10)) < 1e-9, `as typed: ${was}`);
    const par = await parallelFromPalette(app, "l1", "l2");
    await verdict(app, "SOLVED");
    const now = await lengths(app, ["l1", "l2"]);
    now.forEach((v, i) => assert.ok(Math.abs(v - was[i]) / was[i] < 1e-6, `l${i + 1} was ${was[i].toFixed(6)} long and is ${v.toFixed(6)}`));
    assert.ok((await sine(app, "l1", "l2")) < 1e-9, "and they are parallel");
    assert.ok((await relations(app)).some((r) => r.name === par));
    await park(app);
    await shot(app, which === "desktop" ? "460-parallel-pressed-over-two-free-lines-both-as-long-as-they-were" : "461-iphone-parallel-tapped-both-lines-as-long-as-they-were");
  });
}

// --- 3: the owner's first bug, named ------------------------------------------------------------

/** The rectangle tool dragged out; its four sides and four right angles read back. */
async function drawRectangle(app: AppContext): Promise<{ lines: string[]; perps: string[]; before: number[] }> {
  await type(app, "rectangle");
  const [a, b] = app === phone ? [await app.screenOf([-18, -2, 0]), await app.screenOf([18, 28, 0])] : [await app.screenOf([-25, -12, 0]), await app.screenOf([25, 18, 0])];
  if (app === phone) {
    await app.at(...a);
    await f.drag(a, b, 12);
  } else {
    const from = await app.at(...a), to = await app.at(...b);
    await app.page.mouse.move(from.x, from.y);
    await app.page.mouse.down();
    for (let i = 1; i <= 8; i++) await app.page.mouse.move(from.x + ((to.x - from.x) * i) / 8, from.y + ((to.y - from.y) * i) / 8);
    await app.page.mouse.up();
  }
  await app.page.waitForFunction(() => (window as never as Probe).__neocad.model.relations.size >= 4);
  await type(app, "select");
  await verdict(app, "SOLVED");
  const lines = (await app.model()).lines.map((l) => l.name);
  const perps = (await relations(app)).filter((r) => r.op === "perpendicular");
  assert.equal(perps.length, 4, "the tool's right angles, one a corner");
  return { lines, perps: perps.map((r) => r.name), before: await lengths(app, lines) };
}

for (const which of ["desktop", "iPhone 13"] as const) {
  test(`${which}: Parallel across a corner of the rectangle — the status, the glyphs and the palette name the par as what made it, that corner's perp as what it is against`, async () => {
    const app = which === "desktop" ? desk : phone;
    await fresh(app);
    const drawn = await drawRectangle(app);
    const corner = drawn.perps[0];
    const par = await parallelFromPalette(app, drawn.lines[0], drawn.lines[1], 0.3, 0.7);
    await verdict(app, "CONFLICT");

    // The rectangle did not move: nothing sheared to a compromise, nothing folded.
    const now = await lengths(app, drawn.lines);
    now.forEach((l, i) => assert.ok(Math.abs(l - drawn.before[i]) < 1e-6, `${drawn.lines[i]} as it was: ${l} vs ${drawn.before[i]}`));

    // The status: the par first, by what it says, then what it is against.
    assert.equal(await diagnosisText(app), `${par} par ${drawn.lines[0]} ${drawn.lines[1]} — against ${corner}`);
    assert.deepEqual(await app.page.$$eval("#diagnosis .rel.culprit", (els) => els.map((e) => (e as HTMLElement).dataset.relation)), [par]);
    assert.deepEqual(await app.page.$$eval("#diagnosis .rel.against", (els) => els.map((e) => (e as HTMLElement).dataset.relation)), [corner]);
    // And the two are not the one colour: the culprit on the conflict's ink, the other in the quieter ink.
    const inks = await app.page.evaluate(() => {
      const of = (sel: string) => { const s = getComputedStyle(document.querySelector(sel)!); return { color: s.color, background: s.backgroundColor }; };
      return { culprit: of("#diagnosis .rel.culprit"), against: of("#diagnosis .rel.against") };
    });
    assert.equal(inks.culprit.background, "rgb(224, 96, 92)", "the culprit's name on the conflict's ink");
    assert.equal(inks.against.color, "rgb(185, 138, 134)", "what it is against in the quieter ink");
    assert.notEqual(inks.against.background, inks.culprit.background);
    // The log says it in words.
    const logged = (await app.log()).split("\n").filter((l) => l.includes("CONFLICT")).join(" | ");
    assert.match(logged, new RegExp(`CONFLICT — ${par}\\s+par ${drawn.lines[0]} ${drawn.lines[1]} made it: it cannot hold against ${corner}\\s+perp ${drawn.lines[0]} ${drawn.lines[1]}`), logged);

    // The glyphs: the par's filled, the corner perp's outlined in the quieter ink, every other relation's plain.
    await park(app);
    const drawnInks = await glyphInks(app);
    assert.ok(drawnInks[par]?.length && drawnInks[par].every((k) => k === "filled"), `the par, every glyph of it filled: ${JSON.stringify(drawnInks)}`);
    assert.ok(drawnInks[corner]?.length && drawnInks[corner].every((k) => k === "against"), `the corner's perp in the quieter ink: ${JSON.stringify(drawnInks)}`);
    for (const [n, ks] of Object.entries(drawnInks)) if (n !== par && n !== corner) assert.ok(ks.every((k) => k === "plain"), `${n} is in no conflict: ${JSON.stringify(drawnInks)}`);

    // The palette: one heading, first; the culprit first and marked; a delete on each.
    const section = await app.page.$eval('#constraints .csect', (el) => ({
      id: (el as HTMLElement).dataset.section,
      head: el.querySelector(".chead")?.textContent ?? "",
      rows: Array.from(el.querySelectorAll(".crow")).map((r) => ({ name: (r as HTMLElement).dataset.name, role: (r as HTMLElement).dataset.role, del: (r.querySelector(".cdel") as HTMLElement | null)?.dataset.command })),
    }));
    assert.equal(section.id, "conflict", "the first section of the pane");
    assert.match(section.head, new RegExp(`^conflict${par} made it · against 1$`));
    assert.deepEqual(section.rows, [{ name: par, role: "culprit", del: `del("${par}")` }, { name: corner, role: "against", del: `del("${corner}")` }]);
    const rowInks = await app.page.evaluate(() => {
      const g = (role: string) => { const s = getComputedStyle(document.querySelector(`#constraints .csect[data-section="conflict"] .crow[data-role="${role}"] .cglyph`)!); return { color: s.color, background: s.backgroundColor }; };
      return { culprit: g("culprit"), against: g("against") };
    });
    assert.equal(rowInks.culprit.background, "rgb(224, 96, 92)", "the culprit's mark filled, as its glyph is");
    assert.equal(rowInks.against.color, "rgb(185, 138, 134)");
    await shot(app, which === "desktop" ? "462-the-owners-first-bug-the-par-named-against-its-corners-perp" : "464-iphone-the-par-named-against-its-corners-perp");
    // The rectangle and its glyphs, close: what the two inks look like at the size they are drawn.
    const cv = await app.page.$eval("#cv", (el) => { const r = el.getBoundingClientRect(); return { x: r.x, y: r.y }; });
    const [tl, br] = [await app.screenOf(app === phone ? [-22, 32, 0] : [-30, 23, 0]), await app.screenOf(app === phone ? [34, -6, 0] : [36, -17, 0])];
    await shot(app, which === "desktop" ? "463-the-glyphs-close-the-culprit-filled-what-it-is-against-outlined" : "465-iphone-the-glyphs-close",
      { x: cv.x + tl[0], y: cv.y + tl[1], width: br[0] - tl[0], height: br[1] - tl[1] });

    // × on the culprit's row clears it; what it was against has held all along, and is plain again.
    await pressChrome(app, `#constraints .csect[data-section="conflict"] .crow[data-name="${par}"] .cdel`);
    await verdict(app, "SOLVED");
    assert.ok(!(await relations(app)).some((r) => r.name === par), "the par is gone");
    await park(app);
    const after = await glyphInks(app);
    assert.deepEqual(Object.entries(after).filter(([, ks]) => ks.some((k) => k !== "plain")), [], "no glyph left in a conflict's ink");
    assert.equal(await app.page.$('#constraints .csect[data-section="conflict"]'), null, "and the palette's heading is gone");
  });
}

test("desktop: with that corner's perp deleted the par is still what made it; undone and redone it is named as it was; reopened, the set with none singled out", async () => {
  await fresh(desk);
  const drawn = await drawRectangle(desk);
  const par = await parallelFromPalette(desk, drawn.lines[0], drawn.lines[1], 0.3, 0.7);
  await verdict(desk, "CONFLICT");
  const first = await diagnosisText(desk);
  assert.equal(first, `${par} par ${drawn.lines[0]} ${drawn.lines[1]} — against ${drawn.perps[0]}`);

  // Undo, then redo: a new model each time, told who had held.
  await type(desk, "select");
  await desk.page.keyboard.press("Control+z");
  await verdict(desk, "SOLVED");
  await patient(desk);
  await desk.page.keyboard.press("Control+Shift+z");
  await verdict(desk, "CONFLICT");
  // The redo's own solve ran on the clock; solved again off it, what is named is the trials' answer.
  await patient(desk);
  await type(desk, "solve()");
  await verdict(desk, "CONFLICT");
  assert.equal(await diagnosisText(desk), first, "redone, the par is named as what made it, as the first time");

  // The corner's perp deleted: the par has still never held.
  await type(desk, `del("${drawn.perps[0]}")`);
  await verdict(desk, "CONFLICT");
  const then = await diagnosisText(desk);
  assert.match(then, new RegExp(`^${par} par ${drawn.lines[0]} ${drawn.lines[1]} — against r\\d+, r\\d+$`), then);
  const against = await desk.page.$$eval("#diagnosis .rel.against", (els) => els.map((e) => (e as HTMLElement).dataset.relation!));
  assert.ok(against.length === 2 && against.every((n) => drawn.perps.slice(1).includes(n)), `two of the far perps: ${against}`);
  await park(desk);
  await shot(desk, "468-the-corners-perp-deleted-the-par-still-named-against-the-two-far-perps");

  // Reopened by autosave: nothing in an opened file has held here.
  await desk.page.evaluate(() => (window as never as Probe).__neocad.files.flush());
  await desk.page.reload({ waitUntil: "networkidle" });
  await desk.page.waitForFunction(() => (window as never as Probe).__neocad?.model?.relations?.size >= 4, null, { timeout: 20_000 });
  await verdict(desk, "CONFLICT");
  await patient(desk);
  await type(desk, "solve()");
  await verdict(desk, "CONFLICT");
  const opened = await diagnosisText(desk);
  assert.match(opened, / cannot all hold$/, opened);
  assert.equal((await desk.page.$$("#diagnosis .rel.culprit")).length, 0, "none singled out");
  const named = await desk.page.$$eval("#diagnosis .rel", (els) => els.map((e) => (e as HTMLElement).dataset.relation!));
  assert.ok(named.includes(par));
  await park(desk);
  const inks = await glyphInks(desk);
  for (const n of named) assert.ok(inks[n]?.every((k) => k === "red"), `${n} outlined in the conflict's ink, as every member of a set is: ${JSON.stringify(inks)}`);
  await shot(desk, "469-reopened-the-set-none-singled-out-every-member-outlined-red");
});

// --- the two inks over a solid's lit face ----------------------------------------------------------

for (const which of ["desktop", "iPhone 13"] as const) {
  test(`${which}: the same two inks over a solid's lit face — the culprit filled, what it is against outlined, on the lighter ground`, async () => {
    // The canvas is dark; the lightest ground a glyph is ever drawn on is a
    // shaded solid's face. A rectangle extruded and looked at from above: its
    // lid fills the rectangle, and a perp and then a par typed on two of the
    // lid's edges put a culprit's glyph and its set's on that face.
    const app = which === "desktop" ? desk : phone;
    await fresh(app);
    const drawn = await drawRectangle(app);
    await type(app, `extrude("${drawn.lines[0]}", 10)`);
    await verdict(app, "SOLVED");
    const model = await app.model();
    const up = (n: string) => Math.abs(model.points[n][2] - 10) < 1e-6;
    const lid = model.lines.filter((l) => up(l.refs[0]) && up(l.refs[1]));
    assert.equal(lid.length, 4, "the lid's four edges");
    const [a, b] = [lid[0], lid.find((l) => l !== lid[0] && l.refs.some((r) => lid[0].refs.includes(r)))!];
    await type(app, `perp("${a.name}", "${b.name}")`);
    await verdict(app, "SOLVED");
    const square = (await relations(app)).filter((r) => r.op === "perpendicular" && r.args[0] === a.name).at(-1)!.name;
    await type(app, `par("${a.name}", "${b.name}")`);
    await verdict(app, "CONFLICT");
    const par = (await relations(app)).find((r) => r.op === "parallel")!.name;
    assert.equal(await diagnosisText(app), `${par} par ${a.name} ${b.name} — against ${square}`);
    await park(app);
    // The ground under one of the par's glyphs is the lit face, not the canvas
    // (it has a glyph on each of its two edges, and one of them stands outside the lid).
    await shot(app, which === "desktop" ? "466-over-a-solids-lit-face-the-culprit-filled-what-it-is-against-outlined" : "467-iphone-over-a-solids-lit-face");
    const grounds: number[][] = [];
    for (const g of (await glyphs(app)).filter((x) => x.relation === par || x.relation === square)) {
      // Just outside the box, above and below it: one or the other is the face where the glyph stands on its edge.
      for (const dy of [-g.halfH - 5, g.halfH + 5]) grounds.push(await app.pixel(Math.round(g.screen[0]), Math.round(g.screen[1] + dy), "screen"));
    }
    assert.ok(grounds.some((p) => p[0] + p[1] + p[2] > 3 * 0x80), `a lit face beside a glyph of the conflict, not the canvas's near-black: ${JSON.stringify(grounds)}`);
    const inks = await glyphInks(app);
    assert.ok(inks[par]?.length && inks[par].every((k) => k === "filled"), `the par filled: ${JSON.stringify(inks)}`);
    assert.ok(inks[square]?.length && inks[square].every((k) => k === "against"), `the perp in the quieter ink: ${JSON.stringify(inks)}`);
  });
}

test("desktop: a dimension set to what cannot hold — that dimension named, and nothing moved", async () => {
  await fresh(desk);
  // A level rectangle 40 by 25, its diagonal dimensioned at what it is.
  await type(desk, 'const a = pt(0, 0), b = pt(40, 0), c = pt(40, 25), d = pt(0, 25)');
  await type(desk, 'ln("p1", "p2"); ln("p2", "p3"); ln("p3", "p4"); ln("p4", "p1")');
  await type(desk, 'par("l1", "origin.x"); par("l2", "origin.y"); par("l3", "origin.x"); par("l4", "origin.y"); fix("p1", [0, 0, 0])');
  await type(desk, 'dist("p1", "p2", 40); dist("p2", "p3", 25)');
  await type(desk, `dist("p1", "p3", ${Math.hypot(40, 25)})`);
  await verdict(desk, "SOLVED");
  const diag = (await relations(desk)).filter((r) => r.op === "dist").at(-1)!.name;
  const before = await lengths(desk, ["l1", "l2", "l3", "l4"]);
  await type(desk, `set("${diag}.value", 30)`);
  await verdict(desk, "CONFLICT");
  const said = await diagnosisText(desk);
  assert.match(said, new RegExp(`^${diag} dist p1 p3 30 — against `), said);
  assert.deepEqual(await desk.page.$$eval("#diagnosis .rel.culprit", (els) => els.map((e) => (e as HTMLElement).dataset.relation)), [diag]);
  (await lengths(desk, ["l1", "l2", "l3", "l4"])).forEach((l, i) => assert.ok(Math.abs(l - before[i]) < 1e-9, `nothing moved: ${l} vs ${before[i]}`));
});

test("no uncaught page errors", () => {
  assert.deepEqual(desk.pageErrors, []);
  assert.deepEqual(phone.pageErrors, []);
});
