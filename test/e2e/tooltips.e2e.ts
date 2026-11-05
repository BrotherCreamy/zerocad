// Tooltips on every control, and frames in RGB (docs/plans/tooltips-rgb-frames.md;
// the owner: "when I hover over tools, I should see a tooltip", and "a frame
// should be coloured or something so I can tell the orientation. use rgb
// colours like solidworks").
//
// With a mouse on a desktop window: a toolbar button's tooltip comes within
// half a second of a hover, names the tool, says what it does and the command
// it types, goes on leave, and comes at once on the next button; a press puts
// it away and arms the tool exactly as before. Under fingers in iPhone 13
// emulation: a hold shows a button's tooltip clear of the finger and does not
// arm the tool; a tap arms it; the action strip's buttons have theirs. And a
// frame's arms, read off the drawing canvas: x red, y green, z blue, all amber
// while it is hovered.
//
// Set NEOCAD_E2E_SHOTS to a directory to keep the pictures — the tooltip at
// 70 % and 130 % on a desktop and on a phone both ways up, and a frame on the
// ground, over a solid and in the hidden view. Look at them.

import { test, before, after } from "node:test";
import assert from "node:assert/strict";
import { mkdirSync } from "node:fs";
import { join } from "node:path";
import { openApp, axisFrame, PARKED, type AppContext, forgetAutosave } from "./harness.ts";
import { fingers } from "./fingers.ts";
import { build, scene } from "./scenes.ts";

const SHOTS = process.env.NEOCAD_E2E_SHOTS;
async function shot(app: AppContext, name: string): Promise<void> {
  if (!SHOTS) return;
  mkdirSync(SHOTS, { recursive: true });
  await app.page.screenshot({ path: join(SHOTS, `tooltips-${name}.png`) });
}

const apps: AppContext[] = [];
after(async () => { for (const a of apps) await a.close(); });

/** A fresh first start: no layout, no autosave, the command line left unfocused under a finger. */
async function fresh(app: AppContext): Promise<void> {
  await app.page.evaluate(() => localStorage.clear());
  await forgetAutosave(app.page); // a reload here means the app's first start
  await app.page.reload({ waitUntil: "networkidle" });
  await app.page.waitForFunction(() => document.getElementById("status")?.textContent?.includes("ready"), null, { timeout: 20_000 });
}

interface TipState { shown: boolean; text: string; box: { x: number; y: number; w: number; h: number } | null; side: string | null }
const tipState = (app: AppContext) => app.page.$eval("#tooltip", (el) => {
  const t = el as HTMLElement;
  const r = t.getBoundingClientRect();
  return {
    // Its parts in order, a space apart: the name, the key, what it does, the command or why not.
    shown: !t.hidden, text: t.hidden ? "" : [t.querySelector(".tname")?.firstChild?.textContent,
      ...[".tkey", ".tsum", ".tcmd", ".toff"].map((c) => t.querySelector(c)?.textContent)].filter((x) => x).join(" "),
    box: t.hidden ? null : { x: r.x, y: r.y, w: r.width, h: r.height }, side: t.dataset.side ?? null,
  };
}) as Promise<TipState>;

/** The tooltip once `want` holds of it, within `ms`. */
async function tipBecomes(app: AppContext, want: (t: TipState) => boolean, what: string, ms = 2000): Promise<TipState> {
  const deadline = Date.now() + ms;
  for (;;) {
    const t = await tipState(app);
    if (want(t)) return t;
    if (Date.now() > deadline) assert.fail(`${what}: ${JSON.stringify(t)}`);
    await app.page.waitForTimeout(25);
  }
}

const rectOf = (app: AppContext, selector: string) => app.page.$eval(selector, (el) => {
  const r = el.getBoundingClientRect();
  return { x: r.x, y: r.y, w: r.width, h: r.height };
});
const button = (tool: string) => `#toolbar button[data-tool="${tool}"]`;
const overlap = (a: { x: number; y: number; w: number; h: number }, b: { x: number; y: number; w: number; h: number }) =>
  a.x < b.x + b.w && b.x < a.x + a.w && a.y < b.y + b.h && b.y < a.y + a.h;
const window = (app: AppContext) => app.page.evaluate(() => ({ w: innerWidth, h: innerHeight }));
const insideWindow = async (app: AppContext, b: { x: number; y: number; w: number; h: number }) => {
  const w = await window(app);
  return b.x >= 0 && b.y >= 0 && b.x + b.w <= w.w && b.y + b.h <= w.h;
};

/**
 * How long after the pointer reached `selector` its tooltip showed — timed in
 * the page, from the pointerover to the tooltip showing what it says now, so
 * the test's own round trips are not counted.
 */
async function hoverDelay(app: AppContext, selector: string): Promise<number> {
  await app.page.evaluate((sel) => {
    const w = window as unknown as { __tip?: { over?: number; shown?: number } };
    w.__tip = {};
    const target = document.querySelector(sel)!;
    target.addEventListener("pointerover", () => { w.__tip!.over ??= performance.now(); }, { once: true });
    const tip = document.getElementById("tooltip")!;
    // Shown, or — moving straight from one control to the next — showing
    // something else than it was: polled each frame, which is fine enough
    // for "under 100 ms" and "300 to 500 ms".
    const before = tip.hidden ? null : tip.textContent;
    const poll = () => {
      if (!tip.hidden && w.__tip!.over !== undefined && tip.textContent !== before) w.__tip!.shown = performance.now();
      else requestAnimationFrame(poll);
    };
    requestAnimationFrame(poll);
  }, selector);
  const r = await rectOf(app, selector);
  await app.page.mouse.move(r.x + r.w / 2, r.y + r.h / 2, { steps: 2 });
  await app.page.waitForFunction(() => (window as unknown as { __tip: { shown?: number } }).__tip.shown !== undefined, null, { timeout: 2000 });
  return app.page.evaluate(() => {
    const t = (window as unknown as { __tip: { over: number; shown: number } }).__tip;
    return t.shown - t.over;
  });
}

// --- a mouse --------------------------------------------------------------------

let desk: AppContext;
before(async () => { desk = await openApp(); apps.push(desk); });

test("desktop: a toolbar button's tooltip comes within half a second — the name, what it does, the command — beside the column, and goes on leave", async () => {
  await fresh(desk);
  // Out in the drawing first, so the hover is a fresh one.
  await desk.page.mouse.move(700, 400);
  // The circle: a button of its own. The rectangle's is the shapes group's
  // now (docs/plans/sketch-shapes.md), whose hover opens a flyout instead.
  const delay = await hoverDelay(desk, button("circle"));
  assert.ok(delay >= 300 && delay <= 500, `shown ${Math.round(delay)} ms after the pointer arrived: a short hover, not at once and not a native title's wait`);
  const t = await tipState(desk);
  assert.equal(t.text, 'Circle Draws a circle: drag out from its centre, or click 3 points or edges arm("circle")');
  // The native title has gone, so two never show at once; the accessible name stays.
  const b = await desk.page.$eval(button("circle"), (el) => ({
    title: el.getAttribute("title"), label: el.getAttribute("aria-label"), described: el.getAttribute("aria-describedby"),
  }));
  assert.deepEqual(b, { title: null, label: "circle", described: "tooltip" });
  // Beside the column, not over the buttons the pointer runs along next.
  const bar = await rectOf(desk, '.panel[data-panel="toolbar"]');
  assert.equal(t.side, "right");
  assert.ok(!overlap(t.box!, bar), `clear of the toolbar: ${JSON.stringify(t.box)} against ${JSON.stringify(bar)}`);
  assert.ok(await insideWindow(desk, t.box!));
  // Styled at the interface size, like the hover tag.
  const font = await desk.page.$eval("#tooltip", (el) => parseFloat(getComputedStyle(el).fontSize));
  assert.equal(font, 11, "the hover tag's 11 px at 100 %");

  await desk.page.mouse.move(700, 400);
  await tipBecomes(desk, (s) => !s.shown, "gone on leave", 150);
  assert.equal(await desk.page.$eval(button("circle"), (el) => el.getAttribute("aria-describedby")), null);
  assert.deepEqual(desk.pageErrors, []);
});

test("desktop: moving from one button to the next shows that one at once; a press puts it away and arms the tool as it always did", async () => {
  await fresh(desk);
  await desk.page.mouse.move(700, 400);
  await hoverDelay(desk, button("circle"));
  const next = await hoverDelay(desk, button("arc"));
  assert.ok(next < 100, `the next button's at once: ${Math.round(next)} ms`);
  assert.match((await tipState(desk)).text, /^Arc /);
  // Select's and the Hand's say their keys.
  await hoverDelay(desk, button("hand"));
  assert.equal((await tipState(desk)).text, 'Hand hold Space Pans the view: drag from anywhere, over the drawing too arm("hand")');

  const r = await rectOf(desk, button("circle"));
  await desk.page.mouse.move(r.x + r.w / 2, r.y + r.h / 2);
  await tipBecomes(desk, (s) => s.text.startsWith("Circle "), "the circle's tip");
  await desk.page.mouse.down();
  assert.equal((await tipState(desk)).shown, false, "a press puts it away at once");
  await desk.page.mouse.up();
  assert.equal((await desk.model()).activeTool, "circle", "and the click armed the tool, as before");
  assert.match(await desk.log(), /> arm\("circle"\)/, "typed through the command line");
  await desk.page.waitForTimeout(600);
  assert.equal((await tipState(desk)).shown, false, "and it does not come back while the pointer stays");
  await desk.page.keyboard.press("Escape");
});

test("desktop: every icon and short word in the chrome has a tooltip and no native title — the toolbar, the strips, the organiser's ＋, the logo", async () => {
  await fresh(desk);
  const all = await desk.page.$$eval("[data-tip]", (els) => els.map((el) => ({
    what: (el as HTMLElement).dataset.tool ?? el.id ?? el.className, title: el.getAttribute("title"),
  })));
  assert.deepEqual(all.filter((a) => a.title !== null), [], "no control with a tooltip keeps a title");
  const tools = await desk.page.$$eval("#toolbar button", (els) => els.filter((el) => !el.hasAttribute("data-tip")).length);
  assert.equal(tools, 0, "every toolbar button");
  for (const sel of ["#logo", '.panel[data-panel="toolbar"] > .ptitle', '.panel[data-panel="log"] > .ptitle', ".padd"]) {
    assert.equal(await desk.page.$eval(sel, (el) => el.hasAttribute("data-tip")), true, sel);
  }
  // The organiser's ＋ inside its strip is the ＋, not the strip.
  await desk.page.mouse.move(700, 400);
  await hoverDelay(desk, ".padd");
  assert.equal((await tipState(desk)).text, "New group Makes an empty group and opens it, so what you draw next joins it opengroup(group())");
  await hoverDelay(desk, '.panel[data-panel="toolbar"] > .ptitle');
  assert.match((await tipState(desk)).text, /^Tools Drag to move it/);
  // A tool defined at the command line gets one: its summary if it says one, else its name and command.
  await desk.type('defineTool("stamp", class extends Tool { static summary = "Stamps a point where you click"; name = "stamp"; onDown(p) { pt(p.world[0], p.world[1]); this.ctx.finish(); } })');
  await desk.page.mouse.move(700, 400);
  await hoverDelay(desk, button("stamp"));
  assert.equal((await tipState(desk)).text, 'Stamp Stamps a point where you click arm("stamp")');
  assert.deepEqual(desk.pageErrors, []);
});

test("desktop: LOOK — a tooltip at 70 % and 130 %", async () => {
  for (const [scale, name] of [[0.7, "70"], [1.3, "130"]] as const) {
    await fresh(desk);
    await desk.type(`ui({ scale: ${scale} })`);
    await desk.page.mouse.move(700, 400);
    await hoverDelay(desk, button("extrude"));
    const t = await tipState(desk);
    const font = await desk.page.$eval("#tooltip", (el) => parseFloat(getComputedStyle(el).fontSize));
    assert.ok(Math.abs(font - 11 * scale) < 0.05, `drawn at the interface size: ${font}px at ${scale}`);
    assert.ok(await insideWindow(desk, t.box!));
    await shot(desk, `desktop-${name}`);
  }
  await desk.type('ui({ scale: "default" })');
});

// --- a frame in RGB ---------------------------------------------------------------

/** A frame's marker on screen: the origin and each arm's tip, from the module the drawing uses. */
const markerOf = (app: AppContext, name: string) => app.page.evaluate(async (n) => {
  const path = "/src/framemarker.ts";
  const { frameMarker } = await import(path);
  const hook = (window as never as { __neocad: { model: unknown; engine: { view: unknown } } }).__neocad;
  return frameMarker(hook.model, hook.engine.view, n) as { origin: number[]; x: number[]; y: number[]; z?: number[] };
}, name);

const inks = (app: AppContext) => app.page.evaluate(async () => {
  const path = "/src/framemarker.ts";
  return (await import(path)).AXIS_INKS as Record<string, string>;
});
const rgb = (css: string) => [1, 3, 5].map((i) => parseInt(css.slice(i, i + 2), 16));

/**
 * The ink an arm is drawn in, `t` of the way out along it: of the drawing
 * canvas's pixels within two of that point, the most opaque — the 2D canvas
 * hands colour back unpremultiplied, so a stroke's pixel over nothing is the
 * stroke's own colour however little of it the stroke covers.
 */
async function armInk(app: AppContext, origin: number[], tip: number[], t = 0.6): Promise<number[]> {
  const [cx, cy] = [origin[0] + (tip[0] - origin[0]) * t, origin[1] + (tip[1] - origin[1]) * t];
  const at: [number, number][] = [];
  for (let dy = -2; dy <= 2; dy++) for (let dx = -2; dx <= 2; dx++) at.push([Math.floor(cx + dx) + 0.5, Math.floor(cy + dy) + 0.5]);
  return (await app.pixels("drawing", at)).reduce((best, p) => (p[3] > best[3] ? p : best), [0, 0, 0, 0]);
}
const far = (a: number[], b: number[]) => Math.max(...[0, 1, 2].map((i) => Math.abs(a[i] - b[i])));

/**
 * Whether an arm is drawn in `css`: sampled at five places along it, most of
 * them must be that ink exactly — a frame's x-ref and y-ref are points, and a
 * point's dot may sit on its arm at one of them.
 */
async function armIn(app: AppContext, origin: number[], tip: number[], css: string): Promise<{ ok: boolean; got: number[][] }> {
  const got: number[][] = [];
  for (const t of [0.3, 0.45, 0.6, 0.75, 0.88]) got.push(await armInk(app, origin, tip, t));
  // Alpha is coverage: a thin stroke along a pixel column never covers one whole.
  return { ok: got.filter((p) => p[3] > 150 && far(p, rgb(css)) <= 2).length >= 3, got };
}

/**
 * Whether an arm over a solid is drawn in full `css` over its casing: there
 * the stroke and its dark rim share the drawing canvas, so a pixel on the arm
 * is the ink laid over the casing by how much the stroke covers it — on the
 * line from the casing to the ink, most of the way to the ink
 * (hidden.e2e.ts's `casedInk`). Two of the five samples, the solid's own edges
 * crossing the others.
 */
async function armCased(app: AppContext, origin: number[], tip: number[], css: string): Promise<{ ok: boolean; got: number[][] }> {
  const casing = [10, 14, 19];
  const ink = rgb(css);
  const d = [0, 1, 2].map((i) => ink[i] - casing[i]);
  const dd = d.reduce((acc, v) => acc + v * v, 0);
  const got: number[][] = [];
  let hits = 0;
  for (const t of [0.3, 0.45, 0.6, 0.75, 0.88]) {
    const [cx, cy] = [origin[0] + (tip[0] - origin[0]) * t, origin[1] + (tip[1] - origin[1]) * t];
    const at: [number, number][] = [];
    for (let dy = -2; dy <= 2; dy++) for (let dx = -2; dx <= 2; dx++) at.push([Math.floor(cx + dx) + 0.5, Math.floor(cy + dy) + 0.5]);
    const ps = await app.pixels("drawing", at);
    const on = ps.filter((p) => {
      if (p[3] < 200) return false;
      const a = [0, 1, 2].reduce((acc, i) => acc + (p[i] - casing[i]) * d[i], 0) / dd;
      return a > 0.6 && Math.max(...[0, 1, 2].map((i) => Math.abs(p[i] - casing[i] - a * d[i]))) <= 8;
    });
    if (on.length) hits++;
    got.push(on[0] ?? ps[12]);
  }
  return { ok: hits >= 2, got };
}

test("a frame's arms: x red, y green, z blue on the ground — and all amber while it is hovered", async () => {
  await fresh(desk);
  await desk.type('frame(); orbit(0.3, 0.8)');
  const f = (await desk.repl('[...model.entities.values()].filter((e) => e.kind === "frame").at(-1).name')).value as string;
  const marker = await markerOf(desk, f);
  assert.ok(marker.z, "turned, the z arm is on screen");
  const ink = await inks(desk);
  for (const axis of ["x", "y", "z"] as const) {
    const { ok, got } = await armIn(desk, marker.origin, marker[axis]!, ink[axis]);
    assert.ok(ok, `${axis} arm in ${ink[axis]}: got ${JSON.stringify(got)}`);
  }
  assert.ok(rgb(ink.x)[0] > 200 && rgb(ink.y)[1] > 200 && rgb(ink.z)[2] > 200, "red, green, blue");
  await shot(desk, "frame-ground");

  // Hovered — on its +x arm, clear of the origin's own point — the whole marker lights.
  const on = await desk.at(marker.origin[0] + (marker.x[0] - marker.origin[0]) * 0.5, marker.origin[1] + (marker.x[1] - marker.origin[1]) * 0.5);
  await desk.page.mouse.move(on.x, on.y);
  await desk.page.waitForTimeout(150);
  assert.equal((await desk.repl("hover()")).value, f);
  for (const axis of ["x", "y", "z"] as const) {
    const { ok, got } = await armIn(desk, marker.origin, marker[axis]!, "#e8a33d");
    assert.ok(ok, `${axis} arm lit amber: got ${JSON.stringify(got)}`);
  }
  await shot(desk, "frame-lit");
  await desk.page.mouse.move(700, 700);
});

test("LOOK — a frame over a solid, in the shaded and the hidden view", async () => {
  await fresh(desk);
  await build(desk, `${scene("box").source};
    model.addFrame(P([20,15,30]), P([21,15,30]), P([20,16,30]), "g");
    model.addFrame(P([20,15,-10]), P([21,15,-10]), P([20,16,-10]), "k")`);
  await desk.type("lookAt(); orbit(0.3, 0.9); zoom(1.6)");
  // g floats over the box's lid: its arms are over the solid's light faces,
  // drawn over their dark casing — still their own inks.
  const marker = await markerOf(desk, "g");
  const ink = await inks(desk);
  for (const axis of ["x", "y"] as const) {
    const { ok, got } = await armCased(desk, marker.origin, marker[axis], ink[axis]);
    assert.ok(ok, `g's ${axis} arm, over the solid, in its own ink over its casing: ${JSON.stringify(got)}`);
  }
  await shot(desk, "frame-solid");
  await desk.type('view("hidden")');
  await shot(desk, "frame-hidden");
  await desk.type('view("shaded")');
  assert.deepEqual(desk.pageErrors, []);
});

// --- fingers --------------------------------------------------------------------

/** A selector's middle, in canvas pixels — what the fingers helper takes. */
const middleOf = (app: AppContext, selector: string) => app.page.$eval(selector, (el) => {
  const r = el.getBoundingClientRect();
  const c = document.getElementById("cv")!.getBoundingClientRect();
  return [r.x + r.width / 2 - c.x, r.y + r.height / 2 - c.y] as [number, number];
});

let phone: AppContext;
before(async () => { phone = await openApp({ device: "iPhone 13" }); apps.push(phone); });

async function freshPhone(app: AppContext): Promise<void> {
  await fresh(app);
  await axisFrame(app, PARKED);
  await app.page.evaluate(() => (document.activeElement as HTMLElement | null)?.blur());
}

test("iPhone 13: holding a toolbar button shows its tooltip clear of the finger and does not arm the tool; a tap arms it", async () => {
  await freshPhone(phone);
  const f = await fingers(phone);
  const at = await middleOf(phone, button("circle"));
  await f.hold(...at, 750, true);
  const t = await tipBecomes(phone, (s) => s.shown, "the hold's tooltip");
  assert.equal(t.text, 'Circle Draws a circle: drag out from its centre, or click 3 points or edges arm("circle")');
  // Clear of the finger: above it or beside it, never under it.
  const cv = await rectOf(phone, "#cv");
  const [fx, fy] = [cv.x + at[0], cv.y + at[1]];
  const clear = t.box!.y + t.box!.h <= fy - 20 || t.box!.x >= fx + 20 || t.box!.x + t.box!.w <= fx - 20;
  assert.ok(clear, `clear of the finger at ${fx}, ${fy}: ${JSON.stringify(t.box)}`);
  assert.ok(await insideWindow(phone, t.box!));
  await shot(phone, "phone-held");
  await f.up();
  await phone.page.waitForTimeout(200);
  assert.equal((await phone.model()).activeTool, null, "lifting after the hold pressed nothing");
  assert.doesNotMatch(await phone.log(), /arm\("circle"\)/, "nothing typed");
  // It stays a moment to be read, then goes.
  assert.equal((await tipState(phone)).shown, true, "still there just after the lift");
  await tipBecomes(phone, (s) => !s.shown, "gone a moment later", 3000);

  // A tap is a press, as it always was — its timing untouched.
  await f.tap(...at);
  assert.equal((await phone.model()).activeTool, "circle", "a tap arms it");
  assert.equal((await tipState(phone)).shown, false, "and shows no tooltip");
  await phone.type("cancel()");
  assert.deepEqual(phone.pageErrors, []);
});

test("iPhone 13: the action strip's buttons have tooltips — a hold on Undo says what it would type and undoes nothing", async () => {
  await freshPhone(phone);
  const ids = await phone.page.$$eval("#actions button", (els) => els.map((el) => ({
    action: (el as HTMLElement).dataset.action, tip: el.hasAttribute("data-tip"), title: el.getAttribute("title"),
  })));
  assert.deepEqual(ids, ["undo", "redo", "delete", "cancel"].map((action) => ({ action, tip: true, title: null })));
  await phone.type("pt(10, 10)");
  await phone.page.evaluate(() => (document.activeElement as HTMLElement | null)?.blur());
  const before = (await phone.model()).size;
  const f = await fingers(phone);
  await f.hold(...await middleOf(phone, '#actions button[data-action="undo"]'), 750, true);
  const t = await tipBecomes(phone, (s) => s.shown, "Undo's tooltip");
  assert.equal(t.text, "Undo ⌘Z Takes back the last change to the drawing undo()");
  assert.ok(await insideWindow(phone, t.box!));
  await shot(phone, "phone-strip");
  await f.up();
  await phone.page.waitForTimeout(300);
  assert.equal((await phone.model()).size, before, "the hold undid nothing");
  // A disabled one says why.
  await f.hold(...await middleOf(phone, '#actions button[data-action="redo"]'), 750, true);
  assert.equal((await tipBecomes(phone, (s) => s.shown, "Redo's tooltip")).text, "Redo ⇧⌘Z Puts back the change you last took back nothing to redo");
  await f.up();
  assert.deepEqual(phone.pageErrors, []);
});

test("iPhone 13: LOOK — a held tooltip in portrait and landscape at 70 % and 130 %", async () => {
  const land = await openApp({ device: "iPhone 13 landscape" });
  apps.push(land);
  for (const [app, orient] of [[phone, "portrait"], [land, "landscape"]] as const) {
    for (const [scale, name] of [[0.7, "70"], [1.3, "130"]] as const) {
      await freshPhone(app);
      await app.type(`ui({ scale: ${scale} })`);
      await app.page.evaluate(() => (document.activeElement as HTMLElement | null)?.blur());
      const f = await fingers(app);
      await f.hold(...await middleOf(app, button("extrude")), 750, true);
      const t = await tipBecomes(app, (s) => s.shown, `${orient} ${name}`);
      assert.ok(await insideWindow(app, t.box!), `${orient} ${name}: inside the window — ${JSON.stringify(t.box)}`);
      await shot(app, `phone-${orient}-${name}`);
      await f.up();
      await tipBecomes(app, (s) => !s.shown, "gone", 3000);
    }
    await app.type('ui({ scale: "default" })');
  }
  assert.deepEqual(land.pageErrors, []);
});

test("no uncaught page errors", () => {
  for (const a of apps) assert.deepEqual(a.pageErrors, []);
});
