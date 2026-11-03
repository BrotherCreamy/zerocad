// A solid is opaque, in a browser (docs/plans/opaque-solids.md). The owner:
// "when you extrude a solid, it should look like a solid" / "It should be
// opaque".
//
// Shaded, the default: what is behind a visible face — a point, its name, an
// edge — is not drawn, and a click where it projects does not pick it.
// `view("hidden")` draws it (dimmed, for an edge) and picks it;
// `view("wire")` draws no faces at all. The mode is the viewer's: it survives
// a reload, and is in neither a saved file nor the undo history. The faces'
// contrast is measured off the composed picture. The empty-canvas hint is
// gone while a rectangle is being dragged out.
//
// What is behind is chosen by geometry written down here — the box's corner
// all three of whose faces are turned away from a camera written down — and
// checked against the oracle's picture (`nearestFaces`), never by asking the
// module that hides it.
//
// Set NEOCAD_E2E_SHOTS to a directory to keep the screenshots; look at them.

import { test, after } from "node:test";
import assert from "node:assert/strict";
import { mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { openApp, type AppContext } from "./harness.ts";
import { build, lookAlong, scene } from "./scenes.ts";

const SHOTS = process.env.NEOCAD_E2E_SHOTS;
const opened: AppContext[] = [];
after(async () => { for (const a of opened) await a.close(); });

async function fresh(): Promise<AppContext> {
  const app = await openApp();
  opened.push(app);
  return app;
}

async function shot(app: AppContext, name: string): Promise<void> {
  if (!SHOTS) return;
  mkdirSync(SHOTS, { recursive: true });
  await app.page.screenshot({ path: join(SHOTS, `opaque-${name}.png`) });
}

/** From the front, the right and above: the lid, the front (−y) and the right (+x) walls face the viewer. */
const CORNER = [1, -2, 1.5];
/** The box's corner on its base, back and left walls — all three turned away from CORNER. */
const FAR = [0, 30, 0];
/** The middle of the base's back edge: on the base and the back wall, both turned away. */
const BACK_EDGE = [20, 30, 0];

const PLAIN = [175, 198, 217]; // #afc6d9, a point's dot and name
const rgbOf = (css: string): number[] => css.startsWith("#")
  ? [1, 3, 5].map((i) => parseInt(css.slice(i, i + 2), 16))
  : css.match(/\d+/g)!.map(Number);
const far = (a: number[], b: number[]) => Math.max(...[0, 1, 2].map((i) => Math.abs(a[i] - b[i])));

/** The app's own constants, read from the modules that define them, so a test cannot drift from them. */
async function inks(app: AppContext): Promise<{ solid: number[]; dimmedSolid: number[]; background: number[] }> {
  return app.page.evaluate(async () => {
    const facesPath = "/src/faces.ts";
    const occPath = "/src/occlusion.ts";
    const { SOLID_EDGE } = await import(facesPath);
    const { hiddenInk } = await import(occPath);
    const rgb = (css: string) => css.startsWith("#")
      ? [1, 3, 5].map((i) => parseInt(css.slice(i, i + 2), 16))
      : css.match(/\d+/g)!.map(Number);
    return { solid: rgb(SOLID_EDGE), dimmedSolid: rgb(hiddenInk(SOLID_EDGE)), background: [10, 14, 19] };
  });
}

/** The drawing canvas's pixels in a box `r` px either way of a screen point. */
async function patch(app: AppContext, [x, y]: [number, number], r: number): Promise<number[][]> {
  const at: [number, number][] = [];
  for (let dy = -r; dy <= r; dy++) for (let dx = -r; dx <= r; dx++) at.push([x + dx + 0.5, y + dy + 0.5]);
  return app.pixels("drawing", at);
}

/** main.ts's casing, the background's colour, under every light mark where faces are drawn. */
const CASING = [10, 14, 19];

/**
 * How many of a patch's pixels are inked in `rgb`: over nothing, that colour
 * itself (the canvas hands back unpremultiplied colour); over its casing, the
 * colour laid on the casing by how much the mark covers the pixel — so on the
 * line from the casing to the colour, more than half the way along.
 */
const inkedIn = (px: number[][], rgb: number[]) => px.filter((p) => {
  if (p[3] > 40 && far(p, rgb) <= 3) return true;
  if (p[3] < 200) return false;
  const d = [0, 1, 2].map((i) => rgb[i] - CASING[i]);
  const a = [0, 1, 2].reduce((s, i) => s + (p[i] - CASING[i]) * d[i], 0) / d.reduce((s, v) => s + v * v, 0);
  return a > 0.5 && Math.max(...[0, 1, 2].map((i) => Math.abs(p[i] - CASING[i] - a * d[i]))) <= 8;
}).length;

/** The box, built and turned so its far corner is behind it, with the names the test needs. */
async function boxFromCorner(app: AppContext): Promise<{ corner: string; back: string }> {
  await build(app, scene("box").source);
  await lookAlong(app, CORNER);
  const m = await app.model();
  const corner = Object.entries(m.points).find(([, c]) => c.every((v, i) => v === FAR[i]))?.[0];
  assert.ok(corner, "the far corner's point");
  const back = m.lines.find((l) => l.refs.every((n) => m.points[n][1] === 30 && m.points[n][2] === 0))?.name;
  assert.ok(back, "the base's back edge");
  const [{ face }] = await app.nearestFaces([await app.screenOf(FAR)]);
  assert.ok(face !== null && face.kind !== "base", `the far corner's pixel is on the solid's near side (${face?.kind})`);
  const [{ face: overBack }] = await app.nearestFaces([await app.screenOf(BACK_EDGE)]);
  assert.ok(overBack !== null, "so is the back edge's middle");
  return { corner: corner!, back: back! };
}

test("shaded, by default: the far corner's point, its name and the edge behind the box are not drawn; hidden draws all three; wire draws no faces", async () => {
  const app = await fresh();
  assert.equal((await app.repl("view()")).value, "shaded", "shaded is the default");
  await boxFromCorner(app);
  const { solid, dimmedSolid } = await inks(app);
  const [cx, cy] = (await app.screenOf(FAR)).map(Math.floor) as [number, number];
  // The name sits 6 px right of and 6 px above the point, on its baseline.
  const nameAt: [number, number] = [cx + 12, cy - 10];
  const edgeAt = (await app.screenOf(BACK_EDGE)).map(Math.floor) as [number, number];
  await shot(app, "box-shaded");

  // Shaded: nothing in the point's ink at its dot or its name, and nothing at
  // all where the back edge runs — the lid is what is there.
  assert.equal(inkedIn(await patch(app, [cx, cy], 2), PLAIN), 0, "no dot at the far corner");
  assert.equal(inkedIn(await patch(app, nameAt, 4), PLAIN), 0, "no name beside it");
  assert.equal((await patch(app, edgeAt, 1)).filter((p) => p[3] > 0).length, 0, "no stroke where the back edge runs");
  const [{ face: lid }] = await app.nearestFaces([[edgeAt[0] + 0.5, edgeAt[1] + 0.5]]);
  const seen = await app.pixel(edgeAt[0] + 0.5, edgeAt[1] + 0.5, "screen");
  assert.ok(lid && far(seen, lid.rgb) <= 3, `on screen it is the face in front: ${seen} against ${lid?.rgb}`);
  // The near faces' own edges are drawn, in the solid's dark ink: the lid's
  // front edge, shared by the lid and the front wall. Since quiet geometry
  // (quiet-geometry.md) the face layer draws it, as part of the solid, and
  // the sketch drawing leaves it alone until it is hovered — so it is read
  // off the faces' picture, the darkest pixel a 1.2 px line can cover taken
  // at least two thirds of the way from the lid's fill to the ink.
  const front = (await app.screenOf([20, 0, 20])).map(Math.floor) as [number, number];
  assert.equal((await patch(app, front, 1)).filter((p) => p[3] > 0).length, 0, "the sketch draws nothing over it");
  const under: [number, number][] = [];
  for (let dy = -1; dy <= 1; dy++) for (let dx = -1; dx <= 1; dx++) under.push([front[0] + dx + 0.5, front[1] + dy + 0.5]);
  const ink = (await app.pixels("faces", under)).reduce((best, p) => (p[0] + p[1] + p[2] < best[0] + best[1] + best[2] ? p : best));
  const [{ face: lidFill }] = await app.nearestFaces([[front[0] + 0.5, front[1] - 5.5]]);
  assert.ok(lidFill?.kind === "lid", `a few pixels up from the front edge is the lid (${lidFill?.kind})`);
  const toward = [0, 1, 2].reduce((s, i) => s + (lidFill!.rgb[i] - ink[i]), 0) / [0, 1, 2].reduce((s, i) => s + (lidFill!.rgb[i] - solid[i]), 0);
  assert.ok(toward > 0.66 && ink[3] > 150, `the lid's front edge in the solid's ink ${solid}: ${ink}, ${Math.round(toward * 100)}% of the way`);

  // Hidden: the dot and its name are back, in the point's own ink, and the
  // edge in the dimmed solid ink.
  assert.equal((await app.repl('view("hidden")')).value, "hidden");
  await shot(app, "box-hidden");
  assert.ok(inkedIn(await patch(app, [cx, cy], 2), PLAIN) > 4, "the dot at the far corner");
  assert.ok(inkedIn(await patch(app, nameAt, 4), PLAIN) > 4, "its name");
  const dim = (await patch(app, edgeAt, 2)).reduce((best, p) => (p[3] > best[3] ? p : best));
  assert.ok(far(dim, dimmedSolid) <= 3 && dim[3] > 150, `the back edge, dimmed: ${dimmedSolid} against ${dim}`);

  // Wire: the faces canvas is empty everywhere the box was, and the drawing
  // is the sketch's own colours — the dark ink is for a solid's faces.
  assert.equal((await app.repl('view("wire")')).value, "wire");
  await shot(app, "box-wire");
  const samples: [number, number][] = [];
  for (const w of [[20, 15, 20], [20, 0, 10], [40, 15, 10], FAR]) {
    const [x, y] = await app.screenOf(w);
    samples.push([x + 0.5, y + 0.5]);
  }
  for (const p of await app.pixels("faces", samples)) assert.equal(p[3], 0, `no face drawn: ${p}`);
  assert.ok(inkedIn(await patch(app, [cx, cy], 2), PLAIN) > 4, "the far corner's dot, nothing in front of it");
  const plainEdge = (await patch(app, front, 2)).reduce((best, p) => (p[3] > best[3] ? p : best));
  assert.ok(far(plainEdge, PLAIN) <= 3, `the lid's front edge in the sketch colour, with no face under it: ${plainEdge}`);
  assert.deepEqual(app.pageErrors, []);
});

test("a click where the hidden corner projects does not pick it in a shaded view, and does in a hidden one", async () => {
  const app = await fresh();
  const { corner } = await boxFromCorner(app);
  const [cx, cy] = await app.screenOf(FAR);
  const at = await app.at(cx, cy);
  const clickPicks = async () => {
    await app.page.fill("#cmd", "");
    await app.page.mouse.move(at.x - 40, at.y - 40);
    await app.page.mouse.click(at.x, at.y);
    await app.page.waitForTimeout(120);
    return app.selection();
  };
  assert.ok(!(await clickPicks()).includes(corner), "shaded: the click does not select the corner");
  // Nor does hovering there light it.
  await app.page.mouse.move(at.x + 1, at.y + 1);
  await app.page.waitForTimeout(100);
  assert.notEqual((await app.repl("hover()")).value, corner, "shaded: hovering there is not hovering it");
  await app.repl('view("hidden")');
  assert.deepEqual(await clickPicks(), [corner], "hidden: the same click selects it");
});

/** WCAG's relative luminance and contrast ratio. */
function contrast(a: number[], b: number[]): number {
  const lum = (c: number[]) => {
    const [r, g, bl] = c.slice(0, 3).map((v) => { const s = v / 255; return s <= 0.04045 ? s / 12.92 : ((s + 0.055) / 1.055) ** 2.4; });
    return 0.2126 * r + 0.7152 * g + 0.0722 * bl;
  };
  const [hi, lo] = [lum(a), lum(b)].sort((x, y) => y - x);
  return (hi + 0.05) / (lo + 0.05);
}

test("the faces' contrast, read off the composed picture: each face well off the background, and the three faces of the box told apart", async () => {
  const app = await fresh();
  await boxFromCorner(app);
  // The middle of each visible face, and a pixel of the canvas well away from
  // the solid and every mark.
  const where = { lid: [20, 15, 20], front: [20, 0, 10], right: [40, 15, 10] } as const;
  const at: [number, number][] = [];
  for (const w of Object.values(where)) {
    const [x, y] = await app.screenOf([...w]);
    at.push([x + 0.5, y + 0.5]);
  }
  at.push([900.5, 560.5]);
  const px = await app.pixels("screen", at);
  const [lid, front, right, ground] = px;
  const oracle = await app.nearestFaces(at.slice(0, 3));
  oracle.forEach((o, i) => assert.ok(o.face && far(px[i], o.face.rgb) <= 3, `face ${i}: ${px[i]} is the oracle's ${o.face?.rgb}`));
  assert.ok(far(ground, [10, 14, 19]) <= 1, `the canvas's ground is the page's: ${ground}`);
  const numbers = {
    lid: { rgb: lid.slice(0, 3), againstBackground: contrast(lid, ground) },
    front: { rgb: front.slice(0, 3), againstBackground: contrast(front, ground) },
    right: { rgb: right.slice(0, 3), againstBackground: contrast(right, ground) },
    lidFront: contrast(lid, front), lidRight: contrast(lid, right), frontRight: contrast(front, right),
  };
  console.log(`# measured face contrast: ${JSON.stringify(numbers)}`);
  if (SHOTS) {
    mkdirSync(SHOTS, { recursive: true });
    writeFileSync(join(SHOTS, "opaque-contrast.json"), JSON.stringify(numbers, null, 2));
  }
  for (const f of [numbers.lid, numbers.front, numbers.right]) assert.ok(f.againstBackground >= 4.5, `${f.rgb}: ${f.againstBackground.toFixed(2)}:1 against the background`);
  for (const k of ["lidFront", "lidRight", "frontRight"] as const) assert.ok(numbers[k] >= 1.3, `${k}: ${numbers[k].toFixed(2)}:1`);
});

test("the mode is the viewer's: it survives a reload, and is in neither a saved file nor the undo history", async () => {
  const app = await fresh();
  await app.type("pt(10, 10)");
  await app.type('view("wire")');
  assert.equal((await app.repl("view()")).value, "wire");
  // Not an undo step: Ctrl+Z takes back the point, and the mode stays.
  await app.page.keyboard.press("Control+z");
  await app.page.waitForTimeout(120);
  assert.equal((await app.model()).byKind.point ?? 0, 0, "the undo took the point");
  assert.equal((await app.repl("view()")).value, "wire", "and left the mode alone");
  await app.page.keyboard.press("Control+y");
  await app.page.waitForTimeout(120);
  // Not in a file: the text save() writes says nothing of it.
  const saved = (await app.repl("save()")).value as string;
  assert.equal(typeof saved, "string");
  assert.ok(!/wire|shaded|viewMode/.test(saved), "the saved file does not mention the mode");
  assert.ok(!(await app.model()).journalOps.some((op) => /view/i.test(op)), "nor does the journal");
  // A reload: the same browser, the mode read back from its storage.
  await app.page.reload({ waitUntil: "networkidle" });
  await app.page.waitForFunction(() => document.getElementById("status")?.textContent?.includes("ready"), null, { timeout: 20_000 });
  assert.equal((await app.repl("view()")).value, "wire", "after a reload");
  await app.repl('view("shaded")');
});

test("the View row on the empty-canvas menu: the current mode marked, and a choice typed as view() into the log", async () => {
  const app = await fresh();
  const at = await app.at(800, 200);
  await app.page.mouse.click(at.x, at.y, { button: "right" });
  await app.page.waitForSelector("#ctxmenu:not([hidden]) .row");
  const row = await app.page.$$eval("#ctxmenu .row .choice", (els) => els.map((e) => [e.textContent, e.classList.contains("on")]));
  assert.deepEqual(row, [["Shaded", true], ["Hidden", false], ["Wire", false]]);
  await shot(app, "menu");
  await app.page.click('#ctxmenu .row .choice:text("Hidden")');
  await app.page.waitForTimeout(120);
  assert.equal((await app.repl("view()")).value, "hidden");
  assert.match(await app.log(), /> view\("hidden"\)/, "typed, as every item is");
  await app.page.mouse.click(at.x, at.y, { button: "right" });
  await app.page.waitForSelector("#ctxmenu:not([hidden]) .row");
  const after = await app.page.$$eval("#ctxmenu .row .choice.on", (els) => els.map((e) => e.textContent));
  assert.deepEqual(after, ["Hidden"], "the mark moved");
  await app.page.keyboard.press("Escape");
});

test("the empty-canvas hint is gone while a rectangle is being dragged out, and back if the gesture is abandoned", async () => {
  const app = await fresh();
  const [w, h] = await app.page.$eval("#cv", (el) => [el.clientWidth, el.clientHeight]);
  const band: [number, number][] = [];
  for (let y = Math.round(h / 2 - 30); y < Math.round(h / 2 + 30); y += 2) {
    for (let x = Math.round(w / 2 - 300); x < Math.round(w / 2 + 300); x += 2) band.push([x, y]);
  }
  const inkInBand = async () => (await app.pixels("drawing", band)).filter((d) => d[3] > 0).length;
  assert.ok(await inkInBand() > 50, "the hint, before anything");
  await app.type('arm("rectangle")');
  assert.ok(await inkInBand() > 50, "armed but not yet pressed: still there");
  // Dragged well clear of the band, so any ink left there could only be the hint.
  const a = await app.at(w - 260, 110);
  const b = await app.at(w - 140, 190);
  await app.page.mouse.move(a.x, a.y);
  await app.page.mouse.down();
  await app.page.mouse.move((a.x + b.x) / 2, (a.y + b.y) / 2);
  await app.page.mouse.move(b.x, b.y);
  await app.page.waitForTimeout(120);
  assert.equal((await app.model()).size, 0, "nothing made yet: the rectangle is a preview");
  await shot(app, "hint-during-drag");
  assert.equal(await inkInBand(), 0, "the hint is gone while the preview is on screen");
  await app.page.keyboard.press("Escape");
  await app.page.mouse.up();
  await app.page.waitForTimeout(120);
  assert.equal((await app.model()).size, 0);
  assert.ok(await inkInBand() > 50, "the gesture abandoned: the hint is back");
});

test("no uncaught page errors", () => {
  for (const a of opened) assert.deepEqual(a.pageErrors, []);
});
