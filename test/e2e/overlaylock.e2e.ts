// See-through panels, each in a form of its own, and the lock
// (docs/plans/panels-overlay-lock.md), in a browser — with a mouse, and with a
// finger on an iPhone 13 and a Pixel 7, each held both ways up. The owner:
// "there should be a menu option to make the toolbars transparent to maximize
// visible viewport size. and also another option to lock the toolbars in
// place. note: things like the organiser toolbar etc need to have some kind of
// structure to their layout in order to make the transparent view work".
//
// What is checked, each way, over a busy model (two bodies, a boss added to
// one, two groups, three regions): see-through turned on from the logo menu's
// View section; every pane but the options panel boxless, the organiser a tree
// in its corner and the log a tail; **a press between two of the tree's rows,
// and one beside the tray's buttons, reaching the canvas** — measured by the
// point tool making a point there, and the same spot docked taken by the pane
// instead; **the contrast of the text as drawn against what is drawn behind
// it, sampled pixel by pixel, at least 4.5 : 1 over a light lid and over the
// dark ground**, and what it would be with no halo; the hand bringing the
// docked form back (a mouse's hover; a finger's tap, until the next tap
// outside); then the lock — no strip drawn, no grip, a drag on a strip's place
// moving nothing and saying why in the chip, and with see-through on too the
// strip's place the drawing's; on a phone both switches through a rotation,
// and a locked layout that no longer fits re-fitted and said. With a mouse,
// the log's lines fading and gone after ten seconds. Set NEOCAD_E2E_SHOTS to a
// directory to keep the pictures — and look at them: this is about what the
// drawing looks like with the chrome laid over it.

import { test, after } from "node:test";
import assert from "node:assert/strict";
import { mkdirSync } from "node:fs";
import { join } from "node:path";
import { openApp, settled, type AppContext, type OpenOptions } from "./harness.ts";
import { build, look, lookAlong } from "./scenes.ts";
import { fingers, type Fingers } from "./fingers.ts";

const SHOTS = process.env.NEOCAD_E2E_SHOTS;
const apps: AppContext[] = [];
after(async () => { for (const a of apps) await a.close(); });

/** Two bodies — a plate with a boss added, a block apart — two groups and their regions: an organiser with something in every section. */
const BUSY = `ls = poly([[0,0,0],[60,0,0],[60,40,0],[0,40,0]], "f"); extrude(ls[0], 8);
  model.addFrame(P([30,20,8]), P([31,20,8]), P([30,21,8]), "h");
  c = P([30,20,8]); onplane(c, "h"); k = model.addCircle(c, 10, "h").name; extrude(k, 15, "h");
  b = poly([[80,0,0],[110,0,0],[110,30,0],[80,30,0]], "f"); extrude(b[0], 20, "f", { mode: "new" });
  group(ls[0], ls[1]); group(b[0], b[1]);`;

/** A plate far bigger than the view, under everything: its lid is the light ground the text is read over. */
const LID = `L = poly([[-3000,-3000,-60],[3000,-3000,-60],[3000,3000,-60],[-3000,3000,-60]], "f"); extrude(L[0], 4, "f", { mode: "new" })`;

interface Box { x: number; y: number; w: number; h: number }
const intersect = (a: Box, b: Box) => a.x < b.x + b.w - 0.5 && b.x < a.x + a.w - 0.5 && a.y < b.y + b.h - 0.5 && b.y < a.y + a.h - 0.5;

async function shot(app: AppContext, name: string): Promise<void> {
  if (!SHOTS) return;
  mkdirSync(SHOTS, { recursive: true });
  await app.page.waitForTimeout(150);
  await app.page.screenshot({ path: join(SHOTS, `overlay-${name}.png`) });
}

/** What is on top at a window point: its id, or the panel it is in. */
const topAt = (app: AppContext, x: number, y: number) => app.page.evaluate(([x, y]) => {
  const el = document.elementFromPoint(x, y);
  if (!el) return "nothing";
  if (el.id === "cv") return "cv";
  const panel = el.closest<HTMLElement>(".panel[data-panel]");
  return panel ? `panel:${panel.dataset.panel}` : el.id || el.tagName;
}, [x, y]);

/** The see-through tree's rows as drawn, top to bottom. */
const treeRows = (app: AppContext) => app.page.$$eval(".otree .trow", (rs) => rs.map((r) => {
  const b = r.getBoundingClientRect();
  return { x: b.x, y: b.y, w: b.width, h: b.height, name: (r as HTMLElement).dataset.name ?? null, kind: (r as HTMLElement).dataset.kind };
}).filter((r) => r.w > 0));

const panelBox = (app: AppContext, id: string) => app.page.$eval(`.panel[data-panel="${id}"]`, (el) => {
  const r = el.getBoundingClientRect();
  return { x: r.x, y: r.y, w: r.width, h: r.height };
});
const stripBox = (app: AppContext, id: string) => app.page.$eval(`.panel[data-panel="${id}"] > .ptitle`, (el) => {
  const r = el.getBoundingClientRect();
  return { x: r.x, y: r.y, w: r.width, h: r.height };
});
const points = async (app: AppContext) => (await app.model()).byKind.point ?? 0;
/**
 * The point count once a tap's point has had time to land, then a settle to
 * catch a second one. A fixed 150 ms read raced the tap at load 15 (24 !== 25
 * on a Pixel, a different orientation each run); a tap taken by a row instead
 * of the canvas still makes no point and still fails.
 */
async function pointsReach(app: AppContext, want: number, ms = 3000): Promise<number> {
  const deadline = Date.now() + ms;
  while ((await points(app)) < want && Date.now() < deadline) await app.page.waitForTimeout(25);
  await app.page.waitForTimeout(150);
  return points(app);
}

/** A press, the way this hand makes one. */
interface Hand { tap(x: number, y: number): Promise<void>; drag(from: [number, number], to: [number, number]): Promise<void>; fingers?: Fingers }
async function handOf(app: AppContext, touch: boolean): Promise<Hand> {
  if (touch) {
    const f = await fingers(app);
    return { fingers: f, tap: (x, y) => f.tap(x, y), drag: (a, b) => f.drag(a, b, 12) };
  }
  const m = app.page.mouse;
  return {
    async tap(x, y) { await m.click(x, y); },
    async drag(a, b) { await m.move(a[0], a[1]); await m.down(); await m.move(b[0], b[1], { steps: 12 }); await m.up(); },
  };
}

/** Every visible pane's rectangle, as drawn. */
const paneBoxes = (app: AppContext) => app.page.evaluate(() => {
  const out: Record<string, { x: number; y: number; w: number; h: number }> = {};
  for (const el of Array.from(document.querySelectorAll<HTMLElement>(".panel[data-panel]"))) {
    if (el.hidden) continue;
    const r = el.getBoundingClientRect();
    out[el.dataset.panel!] = { x: r.x, y: r.y, w: r.width, h: r.height };
  }
  return out;
});
function apart(boxes: Record<string, Box>, what: string): void {
  const ids = Object.keys(boxes);
  for (let i = 0; i < ids.length; i++) for (let j = i + 1; j < ids.length; j++) {
    assert.ok(!intersect(boxes[ids[i]], boxes[ids[j]]), `${what}: ${ids[i]} over ${ids[j]}`);
  }
}

// ---- contrast ------------------------------------------------------------------

/** WCAG's relative luminance of an sRGB pixel. */
function luminance([r, g, b]: number[]): number {
  const c = (v: number) => { const s = v / 255; return s <= 0.04045 ? s / 12.92 : ((s + 0.055) / 1.055) ** 2.4; };
  return 0.2126 * c(r) + 0.7152 * c(g) + 0.0722 * c(b);
}
const ratio = (a: number[], b: number[]) => {
  const [la, lb] = [luminance(a), luminance(b)];
  return (Math.max(la, lb) + 0.05) / (Math.min(la, lb) + 0.05);
};
const median = (xs: number[]) => { const s = [...xs].sort((a, b) => a - b); return s[Math.floor(s.length / 2)]; };

/** The clip of `box` as RGBA rows, decoded in the page (there is no PNG decoder here). */
async function grab(app: AppContext, box: Box, css: string): Promise<number[][]> {
  const style = await app.page.addStyleTag({ content: css || "/* as drawn */" });
  await app.page.evaluate(() => new Promise<void>((r) => requestAnimationFrame(() => requestAnimationFrame(() => r()))));
  const png = (await app.page.screenshot({ clip: { x: box.x, y: box.y, width: box.w, height: box.h } })).toString("base64");
  await style.evaluate((el) => (el as Element).remove());
  return app.page.evaluate(async (png) => {
    const img = new Image();
    img.src = `data:image/png;base64,${png}`;
    await img.decode();
    const c = document.createElement("canvas");
    [c.width, c.height] = [img.width, img.height];
    const g = c.getContext("2d", { willReadFrequently: true })!;
    g.drawImage(img, 0, 0);
    const d = g.getImageData(0, 0, img.width, img.height).data;
    const out: number[][] = [];
    for (let i = 0; i < d.length; i += 4) out.push([d[i], d[i + 1], d[i + 2]]);
    return out;
  }, png);
}

/**
 * **The contrast of text against what it is read on**, sampled: the text's
 * box shot as drawn (A), and again with its glyphs' fill taken away but its
 * halo left (B) — so B at each pixel is what is behind the ink there. The ink
 * is the pixels A and B differ most at (the strokes' cores, not their
 * anti-aliased edges); the contrast is WCAG's ratio between A and B at those,
 * the median taken. The same with the halo off too (C, D) says what the halo
 * is worth. `ground` is D's median luminance: what the text is over.
 */
async function contrast(app: AppContext, selector: string, fill: string): Promise<{ halo: number; bare: number; ground: number }> {
  const box = await app.page.$eval(selector, (el) => { const r = el.getBoundingClientRect(); return { x: r.x, y: r.y, w: r.width, h: r.height }; });
  assert.ok(box.w > 4 && box.h > 4, `${selector} is drawn: ${JSON.stringify(box)}`);
  const noFill = `${fill}{-webkit-text-fill-color:transparent !important;color:transparent !important}`;
  const noHalo = `${fill}{text-shadow:none !important}`;
  const [A, B, C, D] = [await grab(app, box, ""), await grab(app, box, noFill), await grab(app, box, noHalo), await grab(app, box, noFill + noHalo)];
  const core = (X: number[][], Y: number[][]) => {
    const d = X.map((p, i) => Math.hypot(p[0] - Y[i][0], p[1] - Y[i][1], p[2] - Y[i][2]));
    const top = Math.max(...d);
    const ink = d.map((v, i) => [v, i] as const).filter(([v]) => v >= 0.6 * top && v > 0).map(([, i]) => i);
    assert.ok(ink.length >= 6, `${selector}: some ink to sample (${ink.length} pixels)`);
    return median(ink.map((i) => ratio(X[i], Y[i])));
  };
  return { halo: core(A, B), bare: core(C, D), ground: median(D.map(luminance)) };
}

// ---- the suite, one way at a time -------------------------------------------------

const WAYS: { name: string; device?: OpenOptions["device"] }[] = [
  { name: "mouse" },
  { name: "iPhone 13 portrait", device: "iPhone 13" },
  { name: "iPhone 13 landscape", device: "iPhone 13 landscape" },
  { name: "Pixel 7 portrait", device: "Pixel 7" },
  { name: "Pixel 7 landscape", device: "Pixel 7 landscape" },
];

/** The samples whose contrast is measured: a tree row's name, the log's newest line, the command line's prompt text. */
const SAMPLES: [string, string][] = [
  [".otree .trow[data-kind='body'] .tname", ".otree .tname"],
  [".otail .tline:last-child", ".otail .tline"],
];

for (const way of WAYS) {
  const touch = way.device !== undefined;
  const slug = way.name.replace(/\s+/g, "-").toLowerCase();
  test(`${way.name}: see-through from the menu — every pane its own form; presses between rows and beside the tray reach the canvas; text ≥ 4.5:1 on a light lid and the dark ground; the hand brings the docked form back`, async () => {
    const app = await openApp(way.device ? { device: way.device } : {});
    apps.push(app);
    await build(app, BUSY);
    await look(app, 0.6, 0.9, 0.36);
    await app.page.evaluate(() => (document.activeElement as HTMLElement | null)?.blur());
    const hand = await handOf(app, touch);
    await shot(app, `${slug}-docked`);

    // On from the logo menu's View section, which types the line.
    const logo = await app.page.$eval("#logo", (el) => { const r = el.getBoundingClientRect(); return [r.x + r.width / 2, r.y + r.height / 2]; });
    await hand.tap(logo[0], logo[1]);
    await app.page.waitForSelector("#appmenu:not([hidden]) [data-switch='overlay']");
    // A phone's menu scrolls: the View section brought into it first.
    const box = await app.page.$eval("#appmenu [data-switch='overlay'] input", (el) => {
      el.scrollIntoView({ block: "center" });
      const r = el.getBoundingClientRect();
      return [r.x + r.width / 2, r.y + r.height / 2];
    });
    await hand.tap(box[0], box[1]);
    await app.page.waitForTimeout(200);
    assert.match(await app.log(), /> panels\(\{ overlay: true \}\)/, "the menu typed the line");
    assert.equal(await app.page.$eval("#appmenu [data-switch='overlay'] input", (el) => (el as HTMLInputElement).checked), true, "and its box is ticked");
    await hand.tap(logo[0], logo[1]); // closes the menu
    await app.page.waitForTimeout(250); // the boxes' fade
    assert.equal(await app.page.$eval("#viewwrap", (el) => el.classList.contains("overlay")), true);

    // Every pane but the options panel: no ground, no border, no press of its own.
    const forms = await app.page.evaluate(() => Array.from(document.querySelectorAll<HTMLElement>(".panel[data-panel]")).filter((el) => !el.hidden).map((el) => {
      const s = getComputedStyle(el);
      return { id: el.dataset.panel!, bg: s.backgroundColor, events: s.pointerEvents, strip: el.querySelector<HTMLElement>(":scope > .ptitle") ? getComputedStyle(el.querySelector(":scope > .ptitle")!).visibility : "none" };
    }));
    for (const f of forms) {
      assert.deepEqual([f.bg, f.events, f.strip], ["rgba(0, 0, 0, 0)", "none", "hidden"], `${way.name}: ${f.id} is boxless, takes no press, has no strip`);
    }
    // The organiser a tree, the log a tail of at most three lines, the docked bodies not drawn.
    assert.equal(await app.page.$eval("#organiser", (el) => getComputedStyle(el).display), "none");
    assert.equal(await app.page.$eval("#log", (el) => getComputedStyle(el).display), "none");
    const rows = await treeRows(app);
    assert.deepEqual(rows.map((r) => [r.kind, r.name]), [["body", "e1"], ["body", "e3"], ["group", null], ["region", null]],
      `${way.name}: collapsed, the bodies and the Groups and Regions roots`);
    assert.ok((await app.page.$$(".otail .tline")).length <= 3);
    // Wholly inside its pane, hugging a corner of it.
    const org = await panelBox(app, "organiser");
    const tree = await app.page.$eval(".otree", (el) => { const r = el.getBoundingClientRect(); return { x: r.x, y: r.y, w: r.width, h: r.height }; });
    assert.ok(tree.x >= org.x - 0.5 && tree.y >= org.y - 0.5 && tree.x + tree.w <= org.x + org.w + 0.5 && tree.y + tree.h <= org.y + org.h + 0.5,
      `${way.name}: the tree inside its pane ${JSON.stringify({ tree, org })}`);
    const hug = await app.page.$eval('.panel[data-panel="organiser"]', (el) => (el as HTMLElement).dataset.hug!);
    const near = (a: number, b: number) => Math.abs(a - b) <= 2;
    assert.ok(hug.endsWith("e") ? near(tree.x + tree.w, org.x + org.w) : near(tree.x, org.x), `${way.name}: hugs the ${hug} side across`);
    assert.ok(hug.startsWith("s") ? near(tree.y + tree.h, org.y + org.h) : near(tree.y, org.y), `${way.name}: and the ${hug} side up and down`);
    await shot(app, `${slug}-see-through`);

    // **A press between two rows reaches the canvas**: the point tool makes a point there.
    const [r1, r2] = [rows[0], rows[1]];
    const gap = r2.y - (r1.y + r1.h);
    assert.ok(gap >= 3, `${way.name}: a gap between rows (${gap.toFixed(1)} px)`);
    const between: [number, number] = [r1.x + Math.min(r1.w, r2.w) / 2, r1.y + r1.h + gap / 2];
    assert.equal(await topAt(app, ...between), "cv", `${way.name}: between e1 and e3 is the canvas's`);
    await app.type('arm("point")');
    await app.page.evaluate(() => (document.activeElement as HTMLElement | null)?.blur());
    let before = await points(app);
    await hand.tap(...between);
    assert.equal(await pointsReach(app, before + 1), before + 1, `${way.name}: the press between two rows made a point`);
    // Beside the tray's buttons: the strip's place, which draws nothing and takes nothing.
    const strip = await stripBox(app, "toolbar");
    const beside: [number, number] = [strip.x + strip.w / 2, strip.y + strip.h / 2];
    assert.equal(await topAt(app, ...beside), "cv", `${way.name}: the strip's place beside the buttons is the canvas's`);
    // The point tool puts itself down after its point: armed again.
    await app.type('arm("point")');
    await app.page.evaluate(() => (document.activeElement as HTMLElement | null)?.blur());
    before = await points(app);
    await hand.tap(...beside);
    assert.equal(await pointsReach(app, before + 1), before + 1, `${way.name}: the press beside the buttons made a point`);
    // And a button still is a button.
    const pointBtn = await app.page.$eval('#toolbar button[data-tool="point"]', (el) => { const r = el.getBoundingClientRect(); return [r.x + r.width / 2, r.y + r.height / 2]; });
    assert.match(await topAt(app, pointBtn[0], pointBtn[1]), /^panel:toolbar$/);
    // Docked, the same two spots are the panes' (the measurement's control).
    await app.repl("panels({ overlay: false })");
    await app.page.waitForTimeout(250);
    assert.equal(await topAt(app, ...between), "panel:organiser", `${way.name}: docked, the organiser takes it`);
    assert.equal(await topAt(app, ...beside), "panel:toolbar");
    await app.repl("panels({ overlay: true })");
    await app.type('arm("select")');
    await app.page.evaluate(() => (document.activeElement as HTMLElement | null)?.blur());
    await app.page.waitForTimeout(250);

    // A root opens to its children — the body's chain — see-through, the tap on
    // its disclosure bringing no docked form; and closes again.
    const pinnedOn = () => app.page.$eval('.panel[data-panel="organiser"]', (el) => el.classList.contains("pinned"));
    const toggleAt = () => app.page.$eval('.otree .tnode[data-key="body:e1"] > .trow .ttog', (el) => { const r = el.getBoundingClientRect(); return [r.x + r.width / 2, r.y + r.height / 2]; });
    let toggle = await toggleAt();
    await hand.tap(toggle[0], toggle[1]);
    await app.page.waitForTimeout(250);
    assert.deepEqual((await treeRows(app)).map((r) => r.name), ["e1", "e1", "e2", "e3", null, null], `${way.name}: e1 open, its chain under it`);
    assert.equal(await pinnedOn(), false, `${way.name}: opening a root keeps the tree`);
    assert.deepEqual(await app.page.$$eval('.otree .tnode[data-key="body:e1"] .tkids .trow', (rs) => rs.map((r) => [(r as HTMLElement).dataset.kind, r.textContent])),
      [["feature", "e1extrude"], ["feature", "e2extrude · add"]]);
    await shot(app, `${slug}-a-root-open`);
    // A tree hugging its pane's bottom grew upward: its ▸ is somewhere else now.
    toggle = await toggleAt();
    await hand.tap(toggle[0], toggle[1]);
    await app.page.waitForTimeout(250);
    assert.equal((await treeRows(app)).length, 4, "closed again");

    // Outside: the drawing's middle row, wherever it is clear of every pane.
    const outside = await app.page.evaluate(() => {
      const [w, h] = [innerWidth, innerHeight];
      for (let y = h * 0.55; y < h * 0.9; y += 9) for (let x = w * 0.3; x < w * 0.9; x += 9) {
        if (document.elementFromPoint(x, y)?.id === "cv") return [x, y] as [number, number];
      }
      return null;
    });
    assert.ok(outside, "somewhere on the drawing to tap");
    // The hand on a pane: a mouse over it gives it its box back, the tree kept.
    const e3 = (await treeRows(app)).find((r) => r.name === "e3")!;
    const organiser = '.panel[data-panel="organiser"]';
    if (!touch) {
      await app.page.mouse.move(e3.x + e3.w / 2, e3.y + e3.h / 2);
      await app.page.waitForTimeout(300);
      assert.equal(await app.page.$eval(organiser, (el) => el.classList.contains("hand")), true, "hovered");
      assert.equal(await app.page.$eval(organiser, (el) => getComputedStyle(el).backgroundColor), "rgb(14, 20, 27)", "on its ground");
      assert.equal(await app.page.$eval(`${organiser} > .ptitle`, (el) => getComputedStyle(el).visibility), "visible", "its strip there to drag by");
      assert.equal(await app.page.$eval("#organiser", (el) => getComputedStyle(el).display), "none", "the tree kept");
      await shot(app, `${slug}-hovered`);
      await app.page.mouse.move(outside[0], outside[1]);
      await app.page.waitForTimeout(500);
      assert.equal(await app.page.$eval(organiser, (el) => el.classList.contains("hand")), false, "the hand gone, it fades back");
    }
    // A press on a row: the row's select, and the pane docked until the next press outside.
    await hand.tap(e3.x + e3.w / 2, e3.y + e3.h / 2);
    await app.page.waitForTimeout(300);
    assert.match(await app.log(), /> select\("e3"\)/, `${way.name}: the tap typed the row's select`);
    assert.ok((await app.selection()).length > 0, `${way.name}: and selected it`);
    assert.equal(await pinnedOn(), true, `${way.name}: and the pane is docked until the next press outside`);
    assert.notEqual(await app.page.$eval("#organiser", (el) => getComputedStyle(el).display), "none", "the docked rows");
    await shot(app, `${slug}-pressed-docked`);
    await hand.tap(...outside);
    await app.page.waitForTimeout(300);
    assert.equal(await pinnedOn(), false, `${way.name}: a press outside puts it back`);
    await settled(app.page);

    // **Contrast**: over the dark ground — the view turned away from the model — then over a light lid.
    await lookAlong(app, [0.2, -0.3, 1], 0.05, [5000, 5000]);
    await app.type("solve()"); // a fresh line for the log's tail
    await app.page.evaluate(() => (document.activeElement as HTMLElement | null)?.blur());
    await app.page.waitForTimeout(250);
    for (const [sel, fill] of SAMPLES) {
      const c = await contrast(app, sel, fill);
      console.log(`  ${way.name} — ${sel} over the ground (${c.ground.toFixed(3)}): ${c.halo.toFixed(2)}:1 with the halo, ${c.bare.toFixed(2)}:1 without`);
      assert.ok(c.ground < 0.02, `${way.name}: ${sel} is over the dark ground (${c.ground})`);
      assert.ok(c.halo >= 4.5, `${way.name}: ${sel} over the ground at ${c.halo.toFixed(2)}:1`);
    }
    const lid = await app.repl(`${LID}; solve(); refresh(); "lid"`);
    assert.ok(lid.ok, lid.error ?? "the lid");
    await lookAlong(app, [0.15, -0.25, 1], 3, [0, 0]);
    await app.page.waitForFunction(() => {
      const b = (window as never as { __neocad: { bodies?: { settled: boolean } } }).__neocad.bodies;
      return !b || b.settled;
    }, undefined, { timeout: 20_000 });
    await app.type("solve()");
    await app.page.evaluate(() => (document.activeElement as HTMLElement | null)?.blur());
    await app.page.waitForTimeout(300);
    await shot(app, `${slug}-over-a-light-lid`);
    for (const [sel, fill] of SAMPLES) {
      const c = await contrast(app, sel, fill);
      console.log(`  ${way.name} — ${sel} over the lid (${c.ground.toFixed(3)}): ${c.halo.toFixed(2)}:1 with the halo, ${c.bare.toFixed(2)}:1 without`);
      assert.ok(c.ground > 0.3, `${way.name}: ${sel} is over a light lid (${c.ground})`);
      assert.ok(c.halo >= 4.5, `${way.name}: ${sel} over a light lid at ${c.halo.toFixed(2)}:1`);
      assert.ok(c.halo > c.bare, `${way.name}: the halo is what makes it legible (${c.bare.toFixed(2)}:1 without)`);
    }
    assert.deepEqual(app.pageErrors, []);
  });

  test(`${way.name}: locked — no strip or grip drawn, a drag on a strip's place moves nothing and the chip says why; with see-through too, the strip's place is the drawing's`, async () => {
    const app = await openApp(way.device ? { device: way.device } : {});
    apps.push(app);
    await build(app, BUSY);
    await look(app, 0.6, 0.9, 0.36);
    await app.type("panels({ locked: true })");
    await app.page.evaluate(() => (document.activeElement as HTMLElement | null)?.blur());
    await app.page.waitForTimeout(250);
    const hand = await handOf(app, touch);
    const drawn = await app.page.evaluate(() => Array.from(document.querySelectorAll<HTMLElement>(".panel[data-panel]")).filter((el) => !el.hidden).map((el) => {
      const s = el.querySelector<HTMLElement>(":scope > .ptitle");
      const cs = s ? getComputedStyle(s) : null;
      return {
        id: el.dataset.panel!, bg: cs?.backgroundColor, image: cs?.backgroundImage, ink: cs?.color,
        grips: Array.from(el.querySelectorAll<HTMLElement>(":scope > .pgrip")).filter((g) => getComputedStyle(g).display !== "none").length,
      };
    }));
    for (const d of drawn) {
      assert.deepEqual([d.bg, d.image, d.ink, d.grips], ["rgba(0, 0, 0, 0)", "none", "rgba(0, 0, 0, 0)", 0], `${way.name}: ${d.id}'s strip not drawn, no grip`);
    }
    await shot(app, `${slug}-locked`);
    const stored = await app.page.evaluate(() => localStorage.getItem("neocad.panels.v3"));
    const was = await paneBoxes(app);
    for (const id of ["log", "toolbar"]) {
      const s = await stripBox(app, id);
      const from: [number, number] = [s.x + s.w / 2, s.y + s.h / 2];
      await hand.drag(from, [from[0] + 80, from[1] + 120]);
      await settled(app.page);
      assert.deepEqual(await paneBoxes(app), was, `${way.name}: dragged by its strip's place, ${id} — and every pane — stayed`);
      assert.equal(await app.page.$eval("#mode", (el) => (el as HTMLElement).dataset.next ?? el.textContent), "panels are locked — unlock in the menu",
        `${way.name}: the chip says why`);
    }
    assert.equal(await app.page.evaluate(() => localStorage.getItem("neocad.panels.v3")), stored, "nothing stored");
    // Both on: the strip's place is the drawing's — the lock takes no press there either.
    await app.repl("panels({ overlay: true })");
    await app.page.waitForTimeout(250);
    // (The tray's: a see-through log hugging its top has its lines where its strip was.)
    const s = await stripBox(app, "toolbar");
    assert.equal(await topAt(app, s.x + s.w / 2, s.y + s.h / 2), "cv", `${way.name}: both on, the tray's strip's place is the canvas's`);
    await shot(app, `${slug}-locked-see-through`);

    if (touch) {
      // Through a rotation, both on: still both, nothing over anything, nothing stored.
      const vp = app.page.viewportSize()!;
      for (const size of [{ width: vp.height, height: vp.width }, vp]) {
        await app.page.setViewportSize(size);
        await app.page.waitForTimeout(400);
        assert.deepEqual(await app.page.$eval("#viewwrap", (el) => [el.classList.contains("overlay"), el.classList.contains("locked")]), [true, true]);
        apart(await paneBoxes(app), `${way.name} turned to ${size.width}×${size.height}`);
        assert.equal(await app.page.evaluate(() => localStorage.getItem("neocad.panels.v3")), stored, "a rotation stores nothing");
        if (size !== vp) await shot(app, `${slug}-locked-see-through-turned`);
        // The defaults fit both ways up: no re-fit to say.
        assert.doesNotMatch(await app.page.$eval("#stepnote", (el) => el.textContent ?? ""), /re-fitted/, `${way.name}: the defaults needed no re-fit`);
      }
    }
    assert.deepEqual(app.pageErrors, []);
  });
}

test("iPhone 13: a locked layout that no longer fits after a rotation is re-fitted once, said in the status, and stays locked — turned back, every pane is where it was locked", async () => {
  const app = await openApp({ device: "iPhone 13" });
  apps.push(app);
  // The log left floating near the top in portrait: on its side it keeps its
  // share of the free room, which lays it over where the command line's
  // default is in landscape (the top row) — the resolver pushes the line out
  // of its way, and that is a re-fit.
  const area = { w: 390, h: 664 };
  const stored = { log: { at: { x: 100, y: 120, w: 200, h: 100, area, scale: 1.3, dock: {} } } };
  await app.page.evaluate((s) => {
    localStorage.setItem("neocad.panels.v3", JSON.stringify({ panels: s }));
    localStorage.setItem("neocad.panels.switches.v1", JSON.stringify({ overlay: false, locked: true }));
  }, stored);
  await app.page.reload({ waitUntil: "networkidle" });
  await app.page.waitForFunction(() => document.getElementById("status")?.textContent?.includes("ready"));
  const portrait = await paneBoxes(app);
  const vp = app.page.viewportSize()!;
  assert.equal(await app.page.$eval("#viewwrap", (el) => el.classList.contains("locked")), true, "locked from storage");
  await app.page.setViewportSize({ width: vp.height, height: vp.width });
  await app.page.waitForTimeout(400);
  assert.match(await app.page.$eval("#stepnote", (el) => el.textContent ?? ""), /panels re-fitted to this screen — still locked/, "the re-fit is said");
  apart(await paneBoxes(app), "on its side");
  assert.equal(await app.page.$eval("#viewwrap", (el) => el.classList.contains("locked")), true, "still locked");
  await shot(app, "iphone-13-locked-re-fitted-on-its-side");
  await app.page.setViewportSize(vp);
  await app.page.waitForTimeout(400);
  assert.deepEqual(await paneBoxes(app), portrait, "turned back, every pane where it was locked");
  assert.deepEqual(app.pageErrors, []);
});

// The finger's gap between the tree's rows was measured at 100 %, against
// Chromium's touch adjustment (8 px fingertip: every gap to 18 px went to a
// row, 20 was the first clear), and kept at 22 px. Now the target follows the
// interface size (docs/plans/touch-density.md), so the gap is half a target
// and never under 22: at 80 % half a target would be 17, inside the reach.
// Rechecked where it changes and where it is held, on Android's engine and the
// iPhone's emulation alike.
for (const device of ["iPhone 13", "Pixel 7"] as const) {
  test(`${device}: see-through, a tap midway between two of the tree's rows reaches the canvas at 80 %, 100 % and 130 % — the gap half a target, never under 22`, async () => {
    const app = await openApp({ device });
    apps.push(app);
    await build(app, BUSY);
    await look(app, 0.6, 0.9, 0.36);
    const hand = await handOf(app, true);
    for (const [scale, gap] of [[0.8, 22], [1, 22], [1.3, 28.5]] as const) {
      await app.type(`ui({ scale: ${scale} }); panels({ overlay: true }); arm("point")`);
      await app.page.evaluate(() => (document.activeElement as HTMLElement | null)?.blur());
      // The new size in force first — under load the old rows can stand still
      // for a while before it applies — then the panes glide to their places:
      // measured once the rows stand still.
      const want = `${Math.max(32, Math.round(44 * scale))}px`;
      await app.page.waitForFunction((w) => document.documentElement.style.getPropertyValue("--target") === w, want, { timeout: 10_000 });
      let rows = await treeRows(app);
      for (let i = 0; i < 20; i++) {
        await app.page.waitForTimeout(100);
        const again = await treeRows(app);
        const still = JSON.stringify(again) === JSON.stringify(rows);
        rows = again;
        if (still && rows.length >= 2) break;
      }
      const [r1, r2] = rows;
      const measured = r2.y - (r1.y + r1.h);
      assert.ok(Math.abs(measured - gap) < 0.6, `${device} at ${scale * 100} %: a gap of ${measured.toFixed(1)} px, wanted ${gap}`);
      const between: [number, number] = [r1.x + Math.min(r1.w, r2.w) / 2, r1.y + r1.h + measured / 2];
      assert.equal(await topAt(app, ...between), "cv", `${device} at ${scale * 100} %: midway is the canvas's`);
      const before = await points(app);
      // What the press met, said if it made no point: it failed so twice in
      // full gates at load 10–18 and never alone (docs/plans/touch-density.md).
      await app.page.evaluate(() => {
        const w = window as unknown as { __met?: string[] };
        w.__met = [];
        if ((window as unknown as { __metOn?: boolean }).__metOn) return;
        (window as unknown as { __metOn?: boolean }).__metOn = true;
        for (const t of ["pointerdown", "pointerup", "click"]) document.addEventListener(t, (e) => {
          const el = e.target as HTMLElement;
          const p = e as PointerEvent;
          w.__met!.push(`${t} ${Math.round(p.clientX)},${Math.round(p.clientY)} on ${el.id || el.className || el.tagName}${el.closest?.(".trow") ? " (a row)" : ""}`);
        }, { capture: true });
      });
      await hand.tap(...between);
      await app.page.waitForTimeout(200);
      // **The claim is where the finger's press lands**, after Chromium's
      // touch adjustment: on the drawing, not moved onto a row. Whether the
      // point tool then makes its point is the recogniser's: in both gate
      // failures the press went down and up on the canvas with the point tool
      // armed and no point came — the tap's timing under load, the register's
      // open touch-harness item — so the point is reported, not required.
      const met = await app.page.evaluate(() => ((window as unknown as { __met?: string[] }).__met ?? []));
      const made = (await points(app)) - before;
      // Read as a long-press under load, the tap opens the menu instead of
      // making a point — and the menu would then lie over the next size's
      // midpoint. Said, and closed.
      if (await app.page.$eval("#ctxmenu", (m) => !(m as HTMLElement).hidden)) {
        met.push("the tap was read as a long-press: the menu opened");
        await app.page.keyboard.press("Escape");
        await app.page.waitForTimeout(100);
      }
      assert.match(met.find((m) => m.startsWith("pointerdown")) ?? "", / on cv$/,
        `${device} at ${scale * 100} %: the finger's press at ${between.map(Math.round)} went to the canvas, not a row: ${met.join("; ")} (points made: ${made})`);
      assert.ok(!met.some((m) => m.includes("(a row)")), `${device} at ${scale * 100} %: nothing of the tap reached a row: ${met.join("; ")}`);
    }
    assert.deepEqual(app.pageErrors, []);
  });
}

test("mouse: the log's see-through lines fade with age and are gone after ten seconds; a click on one brings the docked log back until a click outside", async () => {
  const app = await openApp();
  apps.push(app);
  await app.type("panels({ overlay: true })");
  for (const src of ["1 + 1", "2 + 2"]) await app.type(src);
  await app.page.evaluate(() => (document.activeElement as HTMLElement | null)?.blur());
  const tail = () => app.page.$$eval(".otail .tline", (ls) => ls.map((l) => ({ text: l.textContent, opacity: Number(getComputedStyle(l).opacity) })));
  const now = await tail();
  assert.equal(now.length, 3, "three lines");
  assert.deepEqual(now.map((l) => l.text), (await app.page.$$eval("#log > div", (ds) => ds.slice(-3).map((d) => d.textContent))), "the docked log's last three");
  assert.ok(now.every((l) => l.opacity > 0.95), `new, whole: ${JSON.stringify(now)}`);
  await shot(app, "mouse-log-tail");
  await app.page.waitForTimeout(6_500);
  const later = await tail();
  assert.ok(later.every((l) => l.opacity < 0.8 && l.opacity > 0.1), `fading: ${JSON.stringify(later)}`);
  // A click on a line: the whole log, docked, until a click outside.
  const line = await app.page.$eval(".otail .tline:last-child", (el) => { const r = el.getBoundingClientRect(); return [r.x + r.width / 2, r.y + r.height / 2]; });
  await app.page.mouse.click(line[0], line[1]);
  await app.page.mouse.move(line[0] + 400, line[1] - 300);
  await app.page.waitForTimeout(400);
  assert.equal(await app.page.$eval('.panel[data-panel="log"]', (el) => el.classList.contains("pinned")), true, "clicked, the log is docked though the mouse left");
  assert.notEqual(await app.page.$eval("#log", (el) => getComputedStyle(el).display), "none");
  await app.page.mouse.click(line[0] + 400, line[1] - 300);
  await app.page.waitForTimeout(300);
  assert.equal(await app.page.$eval('.panel[data-panel="log"]', (el) => el.classList.contains("pinned")), false, "a click outside puts it back");
  await app.page.waitForTimeout(4_000);
  assert.deepEqual(await tail(), [], "ten seconds on, the tail is empty");
  assert.deepEqual(app.pageErrors, []);
});
