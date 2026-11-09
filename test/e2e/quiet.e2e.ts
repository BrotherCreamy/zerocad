// Quiet geometry, in a browser (docs/plans/quiet-geometry.md). The owner: "I
// think points ought to disappear when they are the endpoint of a line or a
// corner (except when you hover over them), and lines ought to disappear when
// they form the edge of a solid (except when you hover over them)."
//
// Every claim is a pixel read, at a place worked out here from the geometry —
// where a corner's dot would be, where its name would sit, the middle of an
// edge — never by asking the module that decides. The stories: a rectangle
// drawn with the tool shows no corner dots until one is hovered, and then that
// one's dot and name; a corner dragged is drawn while it moves; extruded and
// turned, its edges are the face layer's fine dark line and nothing of the
// sketch is drawn over them, until an edge is hovered and is drawn lit with its
// ends; a `//` mark on a profile line is quiet until its line is hovered; the
// depth's value is there throughout; `view("hidden")` draws it all; the line
// tool snaps to a corner nobody can see, and shows it while it does; and the
// owner's plate with a hole reads as a clean solid.
//
// Set NEOCAD_E2E_SHOTS to a directory to keep the screenshots; look at them.

import { test, after } from "node:test";
import assert from "node:assert/strict";
import { mkdirSync } from "node:fs";
import { join } from "node:path";
import { axisFrame, openApp, type AppContext } from "./harness.ts";
import { lookAlong } from "./scenes.ts";

const SHOTS = process.env.NEOCAD_E2E_SHOTS;
const opened: AppContext[] = [];
after(async () => { for (const a of opened) await a.close(); });

async function fresh(): Promise<AppContext> {
  const app = await openApp();
  // What is drawn, not what is free: the sketch's own ink (docs/plans/sketch-relations.md).
  await app.repl("freeink(false)");
  opened.push(app);
  return app;
}

async function shot(app: AppContext, name: string): Promise<void> {
  if (!SHOTS) return;
  mkdirSync(SHOTS, { recursive: true });
  await app.page.screenshot({ path: join(SHOTS, `quiet-${name}.png`) });
}

const PLAIN = [175, 198, 217]; // #afc6d9: a point's dot and name, a sketch line
const LIT = [232, 163, 61]; // #e8a33d: what the cursor is over
const CASING = [10, 14, 19]; // main.ts's casing, the background's colour
const far = (a: number[], b: number[]) => Math.max(...[0, 1, 2].map((i) => Math.abs(a[i] - b[i])));

/**
 * Whether a drawing-canvas pixel is inked in `rgb`: that colour itself over
 * nothing, or — over a casing, where faces are drawn — on the line from the
 * casing to it, more than half the way.
 */
const inked = (p: number[], rgb: number[]) => {
  if (p[3] > 40 && far(p, rgb) <= 3) return true;
  if (p[3] < 200) return false;
  const d = [0, 1, 2].map((i) => rgb[i] - CASING[i]);
  const a = [0, 1, 2].reduce((s, i) => s + (p[i] - CASING[i]) * d[i], 0) / d.reduce((s, v) => s + v * v, 0);
  return a > 0.5 && Math.max(...[0, 1, 2].map((i) => Math.abs(p[i] - CASING[i] - a * d[i]))) <= 8;
};

/** The drawing canvas's pixels over a box, (x0, y0) to (x1, y1) inclusive, whole pixels. */
async function box(app: AppContext, x0: number, y0: number, x1: number, y1: number): Promise<number[][]> {
  const at: [number, number][] = [];
  for (let y = Math.floor(y0); y <= Math.floor(y1); y++) for (let x = Math.floor(x0); x <= Math.floor(x1); x++) at.push([x + 0.5, y + 0.5]);
  return app.pixels("drawing", at);
}

/**
 * A point's dot, read where no line through it can be: three pixels a diagonal
 * step of two from its centre, inside the 3.5 px dot and two pixels clear of
 * any edge the rectangle runs along its axes. Not the fourth, down and right,
 * where the glyphs anchored at a point sit (glyphs.ts). How many are inked.
 */
async function dotAt(app: AppContext, [x, y]: [number, number], rgb: number[]): Promise<number> {
  const at: [number, number][] = [[-2, 2], [2, -2], [-2, -2]].map(([dx, dy]) => [x + dx, y + dy]);
  return (await app.pixels("drawing", at)).filter((p) => inked(p, rgb)).length;
}

/** A point's name: it sits 6 px right of the point with its baseline 6 px above. How many pixels of it are inked. */
async function nameAt(app: AppContext, [x, y]: [number, number], rgb: number[]): Promise<number> {
  return (await box(app, x + 7, y - 15, x + 20, y - 7)).filter((p) => inked(p, rgb)).length;
}

async function hoverAt(app: AppContext, [x, y]: [number, number]): Promise<void> {
  const p = await app.at(x, y);
  await app.page.mouse.move(p.x, p.y, { steps: 2 });
  await app.page.waitForTimeout(60);
}

/** Parks the cursor over empty canvas, so nothing is hovered. */
async function away(app: AppContext): Promise<void> {
  await hoverAt(app, [40, 300]);
}

/**
 * A 60 × 40 rectangle drawn with the rectangle tool by a real drag on the
 * default frame `f`, corner to corner — its points p1… and lines l1… in the
 * tool's order.
 */
async function drawRectangle(app: AppContext): Promise<{ corners: string[]; lines: string[] }> {
  await axisFrame(app);
  await app.type("rectangle");
  const a = await app.at(...(await app.screenOf([-30, -20, 0])));
  const b = await app.at(...(await app.screenOf([30, 20, 0])));
  await app.page.mouse.move(a.x, a.y);
  await app.page.mouse.down();
  await app.page.mouse.move(b.x, b.y, { steps: 8 });
  await app.page.mouse.up();
  await app.page.waitForTimeout(150);
  await app.page.keyboard.press("Escape");
  const m = await app.model();
  const corners = Object.keys(m.points).filter((n) => /^p\d+$/.test(n)).sort();
  const lines = m.lines.map((l) => l.name).sort();
  assert.equal(corners.length, 4, Object.keys(m.points).join(" "));
  assert.equal(lines.length, 4);
  await away(app);
  return { corners, lines };
}

const screenOfPoint = async (app: AppContext, name: string) => app.screenOf((await app.model()).points[name]);

test("a rectangle shows no corner dots or names — until a corner is hovered, and then that one's, lit", async () => {
  const app = await fresh();
  const { corners } = await drawRectangle(app);
  await shot(app, "rectangle");
  for (const c of corners) {
    const at = await screenOfPoint(app, c);
    assert.equal(await dotAt(app, at, PLAIN), 0, `no dot at ${c}`);
    assert.equal(await nameAt(app, at, PLAIN), 0, `no name beside ${c}`);
  }
  // The lines themselves are drawn: a rectangle on no solid is sketch geometry.
  const [ax, ay] = await screenOfPoint(app, corners[0]);
  const [bx, by] = await screenOfPoint(app, corners[1]);
  const mid = (await box(app, (ax + bx) / 2 - 1, (ay + by) / 2 - 1, (ax + bx) / 2 + 1, (ay + by) / 2 + 1)).filter((p) => inked(p, PLAIN));
  assert.ok(mid.length > 0, "the edge between them is drawn");

  // Hover one corner: its dot (lit, and larger) and its name are drawn, the others still are not.
  const hovered = corners[2];
  await hoverAt(app, await screenOfPoint(app, hovered));
  assert.equal((await app.repl("hover()")).value, hovered, "quiet is not hidden: the corner is what the cursor is over");
  await shot(app, "rectangle-hover");
  const at = await screenOfPoint(app, hovered);
  assert.equal(await dotAt(app, at, LIT), 3, "the hovered corner's dot, lit");
  assert.ok(await nameAt(app, at, LIT) > 4, "and its name");
  for (const c of corners.filter((x) => x !== hovered)) {
    const other = await screenOfPoint(app, c);
    assert.equal(await dotAt(app, other, PLAIN), 0, `still no dot at ${c}`);
  }
  await away(app);
  assert.equal(await dotAt(app, at, PLAIN) + await dotAt(app, at, LIT), 0, "the cursor gone, the corner is quiet again");
  assert.deepEqual(app.pageErrors, []);
});

test("a quiet corner drags: it moves, and its dot is drawn while it does", async () => {
  const app = await fresh();
  const { corners } = await drawRectangle(app);
  const c = corners[2];
  const from = await screenOfPoint(app, c);
  const start = (await app.model()).points[c];
  const a = await app.at(...from);
  await app.page.mouse.move(a.x, a.y);
  await app.page.mouse.down();
  await app.page.mouse.move(a.x + 30, a.y - 20, { steps: 8 });
  await app.page.waitForTimeout(80);
  const now = await screenOfPoint(app, c);
  const mid = await dotAt(app, now, PLAIN);
  await shot(app, "drag");
  await app.page.mouse.up();
  await app.page.waitForTimeout(150);
  const end = (await app.model()).points[c];
  assert.ok(Math.hypot(end[0] - start[0], end[1] - start[1]) > 5, `the corner moved: ${start} → ${end}`);
  assert.equal(mid, 3, "its dot was drawn mid-drag, where it was");
  assert.equal(await app.status(), "SOLVED");
});

test("the line tool snaps to a corner nobody can see, shows it while it does, and starts the line there", async () => {
  const app = await fresh();
  const { corners } = await drawRectangle(app);
  const c = corners[0];
  const at = await screenOfPoint(app, c);
  await app.type("line");
  // Two pixels off: the snap pulls it in.
  await hoverAt(app, [at[0] + 2, at[1] + 2]);
  const snapped = await app.page.evaluate(() =>
    (window as never as { __neocad: { engine: { snap: { kind: string; targets: string[] } | null } } }).__neocad.engine.snap);
  assert.deepEqual(snapped && { kind: snapped.kind, targets: snapped.targets }, { kind: "point", targets: [c] });
  await shot(app, "snap");
  assert.equal(await dotAt(app, at, PLAIN), 3, "the snapped-to corner's dot is drawn");
  const p = await app.at(at[0] + 2, at[1] + 2);
  await app.page.mouse.click(p.x, p.y);
  const q = await app.at(at[0] - 60, at[1] + 50);
  await app.page.mouse.move(q.x, q.y, { steps: 4 });
  await app.page.mouse.click(q.x, q.y);
  await app.page.keyboard.press("Escape");
  await app.page.waitForTimeout(100);
  const m = await app.model();
  const fresh5 = m.lines.find((l) => !["l1", "l2", "l3", "l4"].includes(l.name));
  assert.ok(fresh5, m.lines.map((l) => l.name).join(" "));
  const start = m.points[fresh5!.refs[0]];
  const corner = m.points[c];
  assert.ok(Math.hypot(start[0] - corner[0], start[1] - corner[1], start[2] - corner[2]) < 1e-6,
    `the new line starts on the corner: ${start} against ${corner}`);
});

/** The rectangle extruded 20 and turned to look from the front, the right and above. */
async function extruded(app: AppContext): Promise<{ corners: string[]; lines: string[] }> {
  const r = await drawRectangle(app);
  const e = await app.repl(`extrude("${r.lines[0]}", 20)`);
  assert.equal(e.ok, true, e.error ?? "");
  await lookAlong(app, [1, -2, 1.5]);
  await away(app);
  return r;
}

/** The world middle of a line, and its two ends, from the model summary. */
async function lineGeometry(app: AppContext, name: string): Promise<{ a: number[]; b: number[]; mid: number[]; refs: [string, string] }> {
  const m = await app.model();
  const l = m.lines.find((x) => x.name === name)!;
  const [a, b] = l.refs.map((r) => m.points[r]);
  return { a, b, mid: a.map((v, i) => (v + b[i]) / 2), refs: l.refs };
}

/** The lid's front edge, seen from the front-right-above: the twin of the profile's bottom (y = −20) line. */
async function lidFront(app: AppContext): Promise<string> {
  const m = await app.model();
  const found = m.lines.find((l) => l.refs.every((r) => m.points[r][1] === -20 && m.points[r][2] === 20));
  assert.ok(found, "the lid's front edge");
  return found!.name;
}

test("extruded and turned: no sketch line over the solid's edges, the face layer's fine dark line along them, and a hovered edge lit with its ends", async () => {
  const app = await fresh();
  await extruded(app);
  await shot(app, "extruded");
  const solid = await app.page.evaluate(async () => {
    const path = "/src/faces.ts";
    const { SOLID_EDGE } = await import(path);
    return [1, 3, 5].map((i) => parseInt((SOLID_EDGE as string).slice(i, i + 2), 16));
  });
  const edge = await lidFront(app);
  const g = await lineGeometry(app, edge);
  // Along the edge, at a quarter and three quarters (clear of the depth's label at the middle of a wall).
  for (const t of [0.25, 0.4, 0.6, 0.75]) {
    const w = g.a.map((v, i) => v + t * (g.b[i] - v));
    const [x, y] = (await app.screenOf(w)).map(Math.floor) as [number, number];
    const drawing = await box(app, x - 1, y - 1, x + 1, y + 1);
    assert.equal(drawing.filter((p) => p[3] > 0).length, 0, `nothing of the sketch drawn over the edge at ${t}`);
    // The darkest of the pixels the line can cover, against the lid's own
    // fill a few pixels in from it: a 1.2 px line anti-aliased across two
    // pixels does not reach its full ink in either, so it is asked to take the
    // face at least two thirds of the way there.
    const faces = await app.pixels("faces",
      [-1, 0, 1].flatMap((dy) => [-1, 0, 1].map((dx) => [x + dx + 0.5, y + dy + 0.5] as [number, number])));
    const darkest = faces.reduce((best, p) => (p[0] + p[1] + p[2] < best[0] + best[1] + best[2] ? p : best));
    const [{ face }] = await app.nearestFaces([[x + 0.5, y - 5.5]]);
    assert.ok(face?.kind === "lid", `a few pixels up from the edge is the lid (${face?.kind})`);
    const toward = [0, 1, 2].reduce((s, i) => s + (face!.rgb[i] - darkest[i]), 0) / [0, 1, 2].reduce((s, i) => s + (face!.rgb[i] - solid[i]), 0);
    assert.ok(toward > 0.66, `the fine edge line is on the faces' canvas at ${t}: ${darkest}, ${Math.round(toward * 100)}% of the way from the lid's ${face!.rgb} to ${solid}`);
  }
  // No corner of the solid is dotted.
  const m = await app.model();
  const ends = new Set(m.lines.flatMap((l) => l.refs));
  const lidCorners = Object.entries(m.points).filter(([n, c]) => c[2] === 20 && ends.has(n)).map(([n]) => n);
  assert.equal(lidCorners.length, 4);
  for (const c of g.refs) {
    const at = await app.screenOf(m.points[c]);
    assert.equal(await dotAt(app, at, PLAIN), 0, `no dot at the lid corner ${c}`);
  }

  // Hovered: the edge is drawn lit along its length, and its two ends are drawn.
  const [hx, hy] = await app.screenOf(g.a.map((v, i) => v + 0.3 * (g.b[i] - v)));
  await hoverAt(app, [hx, hy]);
  assert.equal((await app.repl("hover()")).value, edge, "the edge is under the cursor");
  await shot(app, "extruded-hover-edge");
  for (const t of [0.6, 0.75]) {
    const [x, y] = (await app.screenOf(g.a.map((v, i) => v + t * (g.b[i] - v)))).map(Math.floor) as [number, number];
    const lit = (await box(app, x - 1, y - 1, x + 1, y + 1)).filter((p) => inked(p, LIT));
    assert.ok(lit.length > 0, `the hovered edge is lit at ${t}`);
  }
  for (const c of g.refs) {
    const [x, y] = await app.screenOf(m.points[c]);
    const px = await box(app, x - 3, y - 3, x + 3, y + 3);
    assert.ok(px.filter((p) => inked(p, PLAIN)).length > 6, `its end ${c} is drawn`);
  }
  assert.deepEqual(app.pageErrors, []);
});

/** Every glyph the engine places this frame, with what it is and where. */
async function glyphs(app: AppContext): Promise<{ relation: string; op: string; screen: [number, number]; about: string[]; isLabel: boolean }[]> {
  return app.page.evaluate(() => (window as never as {
    __neocad: { engine: { glyphs(): { relation: string; op: string; screen: [number, number]; about: string[]; isLabel: boolean }[] } };
  }).__neocad.engine.glyphs().map((g) => ({ relation: g.relation, op: g.op, screen: g.screen, about: g.about, isLabel: g.isLabel })));
}

/** How many pixels of a glyph's box are filled — its box is dark and nearly opaque, the canvas clear around it. */
async function glyphInk(app: AppContext, [x, y]: [number, number]): Promise<number> {
  return (await box(app, x - 4, y - 3, x + 4, y + 3)).filter((p) => p[3] > 150).length;
}

test("a ⊥ mark on a profile line is quiet until that line is hovered; the depth's value is drawn throughout", async () => {
  const app = await fresh();
  const { lines } = await drawRectangle(app);
  const front = lines[0];
  const before = await glyphs(app);
  // A ⊥ since the rectangle is a perp at every corner (profiles-held.md); it was a //.
  const mark = before.find((g) => g.op === "perpendicular" && g.about.includes(front));
  assert.ok(mark, `a ⊥ on ${front}: ${JSON.stringify(before)}`);
  assert.ok(await glyphInk(app, mark!.screen) > 30, "on a sketch, the mark is drawn");
  await app.repl(`extrude("${front}", 20)`);
  await lookAlong(app, [1, -2, 1.5]);
  await away(app);
  const marks = await glyphs(app);
  const par = marks.find((g) => g.relation === mark!.relation && g.about.includes(front))!;
  const depth = marks.find((g) => g.op === "extrusion")!;
  assert.ok(par && depth, JSON.stringify(marks));
  await shot(app, "glyph-quiet");
  assert.equal(await glyphInk(app, par.screen), 0, "on the solid's edge, the ⊥ is quiet");
  assert.ok(await glyphInk(app, depth.screen) > 30, "the depth's value is drawn");

  // Hover the line it is on: the mark is drawn.
  const g = await lineGeometry(app, front);
  await hoverAt(app, await app.screenOf(g.a.map((v, i) => v + 0.35 * (g.b[i] - v))));
  assert.equal((await app.repl("hover()")).value, front);
  await shot(app, "glyph-hover-line");
  assert.ok(await glyphInk(app, par.screen) > 30, "the line hovered, its ⊥ is drawn");
  assert.ok(await glyphInk(app, depth.screen) > 30, "the depth's value still");
  // The mark itself is still under the hand, as a quiet corner is: hovered, it stays.
  await hoverAt(app, par.screen);
  assert.equal((await app.repl("hover()")).value, par.relation, "the mark itself is hovered");
  assert.ok(await glyphInk(app, par.screen) > 30);
  await away(app);
  assert.equal(await glyphInk(app, par.screen), 0, "and quiet again once the cursor leaves");
  assert.ok(await glyphInk(app, depth.screen) > 30, "the depth's value throughout");
});

test("view(\"hidden\") draws everything: every corner's dot and the solid's edges in their ink", async () => {
  const app = await fresh();
  const { corners } = await extruded(app);
  assert.equal((await app.repl('view("hidden")')).value, "hidden");
  await away(app);
  await shot(app, "hidden");
  const m = await app.model();
  // The front-bottom-left corner is in front of everything from here.
  const near = corners.find((c) => m.points[c][0] === -30 && m.points[c][1] === -20)!;
  const [x, y] = await app.screenOf(m.points[near]);
  assert.ok((await box(app, x - 2, y - 2, x + 2, y + 2)).filter((p) => inked(p, PLAIN)).length > 8, "a profile corner's dot");
  const edge = await lidFront(app);
  const g = await lineGeometry(app, edge);
  const [ex, ey] = (await app.screenOf(g.a.map((v, i) => v + 0.6 * (g.b[i] - v)))).map(Math.floor) as [number, number];
  const ink = (await box(app, ex - 1, ey - 1, ex + 1, ey + 1)).reduce((best, p) => (p[3] > best[3] ? p : best));
  assert.ok(ink[3] > 150, `the lid's edge drawn in the drawing again: ${ink}`);
  // And the same in the wire view, which has no faces to put a line on.
  assert.equal((await app.repl('view("wire")')).value, "wire");
  await away(app);
  assert.ok((await box(app, x - 2, y - 2, x + 2, y + 2)).filter((p) => inked(p, PLAIN)).length > 8, "wire: the corner's dot");
  const wire = (await box(app, ex - 1, ey - 1, ex + 1, ey + 1)).filter((p) => inked(p, PLAIN));
  assert.ok(wire.length > 0, "wire: the edge in the sketch's ink");
  await app.repl('view("shaded")');
});

test("the owner's plate with a hole reads as a clean solid: no dots, no names, the edges the face layer's", async () => {
  const app = await fresh();
  // Sketched as the tools sketch a frameless outline: the plane made on three
  // of its own corners, and no lid frame (no-lid-frame.md), so nothing but the
  // corners is at a corner.
  const src = `P = (c) => model.addPoint(c).name;
    ps = [[0,0,0],[60,0,0],[60,40,0],[0,40,0]].map(P);
    fr = plane(ps[0], ps[1], ps[3], { look: false });
    ls = ps.map((p, i) => model.addLine(p, ps[(i + 1) % 4]).name);
    onplane(ps[2], fr);
    c = P([30,20,0]); onplane(c, fr); h = model.addCircle(c, 9, fr).name;
    hole(extrude(ls[0], 10), h); solve(); refresh(); "plate"`; // the hole said (regions-as-operations.md)
  const r = await app.repl(src);
  assert.equal(r.ok, true, r.error ?? "");
  await lookAlong(app, [1, -1.6, 1.4]);
  await away(app);
  await shot(app, "plate-with-hole");
  const m = await app.model();
  // Every corner, base and lid: no dot and no name in the point's ink. The
  // only points that end no line are the two circles' centres — no frame
  // point of its own stands on a corner any more.
  const ends = new Set(m.lines.flatMap((l) => l.refs));
  const corners = Object.entries(m.points).filter(([n]) => ends.has(n));
  assert.equal(corners.length, 8, "the plate's eight corners");
  const loose = Object.entries(m.points).filter(([n]) => !ends.has(n));
  assert.deepEqual(loose.map(([, c]) => [c[0], c[1]]), [[30, 20], [30, 20]], `only the centres end nothing: ${JSON.stringify(loose)}`);
  // Where a frame stands on a corner (the sketch's — there is no lid frame
  // above it any more), its marker is drawn from that corner — frame markers
  // stay — and its arms, letters and name lie where a dot and a name would be
  // read, so neither is asked of that corner.
  const origins = await app.page.evaluate(() => [...(window as never as {
    __neocad: { model: { entities: Map<string, { kind: string; origin?: string }> } };
  }).__neocad.model.entities.values()].filter((e) => e.kind === "frame").map((e) => e.origin!));
  assert.equal(origins.length, 1, "the sketch frame, and no lid frame");
  assert.equal(origins.filter((o) => ends.has(o)).length, 1, "the sketch frame on a corner");
  let dots = 0, names = 0;
  for (const [n, c] of corners) {
    const at = await app.screenOf(c);
    if (origins.includes(n)) continue;
    dots += await dotAt(app, at, PLAIN);
    names += await nameAt(app, at, PLAIN);
  }
  assert.equal(dots, 0, "no corner dot anywhere");
  assert.equal(names, 0, "no corner name anywhere");
  // The only light marks left on the drawing are the hole's centre, the
  // frame's marker and the depth's value: count the sketch-ink pixels and
  // hold them to that small budget.
  const ink = await app.page.evaluate(() => {
    const cv = document.getElementById("cv") as HTMLCanvasElement;
    const g = cv.getContext("2d")!;
    const d = g.getImageData(0, 0, cv.width, cv.height).data;
    let n = 0;
    for (let k = 0; k < d.length; k += 4) if (d[k + 3] > 200 && Math.abs(d[k] - 175) < 8 && Math.abs(d[k + 1] - 198) < 8 && Math.abs(d[k + 2] - 217) < 8) n++;
    return n;
  });
  assert.ok(ink < 600, `the sketch's ink is only a centre, a frame and a label: ${ink} pixels`);
  assert.deepEqual(app.pageErrors, []);
});

test("with no WebGL the painter's fallback draws the same fine edge line, into the drawing, after each face", async () => {
  const app = await openApp({ webgl: false });
  // What is drawn, not what is free: the sketch's own ink (docs/plans/sketch-relations.md).
  await app.repl("freeink(false)");
  opened.push(app);
  assert.equal(await app.renderer(), "painter's");
  await extruded(app);
  await shot(app, "painter");
  const solid = await app.page.evaluate(async () => {
    const path = "/src/faces.ts";
    const { SOLID_EDGE } = await import(path);
    return [1, 3, 5].map((i) => parseInt((SOLID_EDGE as string).slice(i, i + 2), 16));
  });
  const g = await lineGeometry(app, await lidFront(app));
  for (const t of [0.25, 0.75]) {
    const [x, y] = (await app.screenOf(g.a.map((v, i) => v + t * (g.b[i] - v)))).map(Math.floor) as [number, number];
    const under = await box(app, x - 1, y - 1, x + 1, y + 1);
    const darkest = under.reduce((best, p) => (p[0] + p[1] + p[2] < best[0] + best[1] + best[2] ? p : best));
    const [{ face }] = await app.nearestFaces([[x + 0.5, y - 5.5]]);
    assert.ok(face?.kind === "lid", `a few pixels up from the edge is the lid (${face?.kind})`);
    const toward = [0, 1, 2].reduce((s, i) => s + (face!.rgb[i] - darkest[i]), 0) / [0, 1, 2].reduce((s, i) => s + (face!.rgb[i] - solid[i]), 0);
    assert.ok(toward > 0.66, `the painter's edge line at ${t}: ${darkest}, ${Math.round(toward * 100)}% of the way from ${face!.rgb} to ${solid}`);
  }
  assert.deepEqual(app.pageErrors, []);
});

/** Whether a drawing pixel is in the selection's violet (tools/selection.ts's `SELECTION`), over nothing or its casing. */
const VIOLET = [196, 108, 255];

test("a selected quiet corner, and a selected solid edge, are drawn — in the selection's colour — until the selection is cleared", async () => {
  const app = await fresh();
  const { corners } = await drawRectangle(app);
  const c = corners[2];
  const at = await screenOfPoint(app, c);
  assert.equal(await dotAt(app, at, PLAIN) + await dotAt(app, at, VIOLET), 0, "quiet at rest");
  await app.repl(`select("${c}")`);
  await away(app);
  await shot(app, "selected-corner");
  assert.equal(await dotAt(app, at, VIOLET), 3, "selected, its dot is drawn, violet");
  assert.ok(await nameAt(app, at, VIOLET) > 4, "and its name");
  await app.repl("select()");
  await away(app);
  assert.equal(await dotAt(app, at, VIOLET) + await dotAt(app, at, PLAIN), 0, "cleared, quiet again");

  // Extruded: a selected edge of the solid is drawn over the face line, violet, with its ends.
  const e = await app.repl(`extrude("l1", 20)`);
  assert.equal(e.ok, true, e.error ?? "");
  await lookAlong(app, [1, -2, 1.5]);
  await away(app);
  const edge = await lidFront(app);
  const g = await lineGeometry(app, edge);
  const [x, y] = (await app.screenOf(g.a.map((v, i) => v + 0.6 * (g.b[i] - v)))).map(Math.floor) as [number, number];
  assert.equal((await box(app, x - 1, y - 1, x + 1, y + 1)).filter((p) => p[3] > 0).length, 0, "quiet before it is selected");
  await app.repl(`select("${edge}")`);
  await away(app);
  await shot(app, "selected-edge");
  assert.ok((await box(app, x - 1, y - 1, x + 1, y + 1)).filter((p) => inked(p, VIOLET)).length > 0, "selected: drawn violet");
  const m = await app.model();
  for (const end of g.refs) {
    const [ex, ey] = await app.screenOf(m.points[end]);
    assert.ok((await box(app, ex - 3, ey - 3, ex + 3, ey + 3)).filter((p) => inked(p, PLAIN)).length > 6, `with its end ${end}`);
  }
  assert.deepEqual(app.pageErrors, []);
});

test("hiding the sketch of an extruded rectangle leaves the base outlined: the face layer's line is the solid's, not the sketch's", async () => {
  const app = await fresh();
  const { corners, lines } = await extruded(app);
  const solid = await app.page.evaluate(async () => {
    const path = "/src/faces.ts";
    const { SOLID_EDGE } = await import(path);
    return [1, 3, 5].map((i) => parseInt((SOLID_EDGE as string).slice(i, i + 2), 16));
  });
  const grouped = await app.repl(`group(${[...lines, ...corners].map((n) => JSON.stringify(n)).join(", ")})`);
  assert.equal(grouped.ok, true, grouped.error ?? "");
  const hidden = await app.repl(`hide(${JSON.stringify(grouped.value)})`);
  assert.equal(hidden.ok, true, hidden.error ?? "");
  await away(app);
  await shot(app, "sketch-hidden");
  // The base's front edge — the profile's bottom line, now hidden — seen
  // along the bottom of the front wall from here.
  const base = await lineGeometry(app, lines[0]);
  assert.ok(base.a[1] === -20 && base.b[1] === -20 && base.a[2] === 0, "the profile's front line");
  for (const t of [0.3, 0.7]) {
    const w = base.a.map((v, i) => v + t * (base.b[i] - v));
    const [x, y] = (await app.screenOf(w)).map(Math.floor) as [number, number];
    assert.equal((await box(app, x - 1, y - 1, x + 1, y + 1)).filter((p) => p[3] > 0).length, 0, `the sketch's line is not drawn at ${t}`);
    const under: [number, number][] = [];
    for (let dy = -1; dy <= 1; dy++) for (let dx = -1; dx <= 1; dx++) under.push([x + dx + 0.5, y + dy + 0.5]);
    const darkest = (await app.pixels("faces", under)).reduce((best, p) => (p[0] + p[1] + p[2] < best[0] + best[1] + best[2] ? p : best));
    const [{ face }] = await app.nearestFaces([[x + 0.5, y - 5.5]]);
    assert.ok(face?.kind === "wall", `above the base's front edge is the front wall (${face?.kind})`);
    const toward = [0, 1, 2].reduce((s, i) => s + (face!.rgb[i] - darkest[i]), 0) / [0, 1, 2].reduce((s, i) => s + (face!.rgb[i] - solid[i]), 0);
    assert.ok(toward > 0.66, `the base edge is still outlined at ${t}: ${darkest}, ${Math.round(toward * 100)}% of the way from ${face!.rgb} to ${solid}`);
    // Hidden is not quiet: the cursor on it finds no line to light.
    await hoverAt(app, [x, y]);
    assert.notEqual((await app.repl("hover()")).value, lines[0], "a hidden line is not hovered");
    assert.equal((await box(app, x - 1, y - 1, x + 1, y + 1)).filter((p) => inked(p, LIT)).length, 0, "nor drawn lit");
    await away(app);
  }
  assert.deepEqual(app.pageErrors, []);
});
