// 3D phase 3 in a browser: closed loops drawn with the real tools, found, and
// clicked inside.
//
// The unit suite has the mathematics; what only the assembled app can say is
// whether a loop drawn the way a person draws one — the rectangle tool, the
// fillet tool, the circle tool, on a tilted sketch, in a turned view — is the
// loop `loops()` reports, with the area its own coordinates say it has, and
// whether `loopAt` agrees with a real click about where "inside" is. The click
// side is a probe: a listener reads the pointer event exactly as the tool
// engine does (client position less the canvas's corner) and asks `loopAt`,
// imported from the dev server — the module itself, run against the app's own
// model and camera. Nothing in the app calls `loopAt` yet, and the click must
// go on doing exactly what it did: pick nothing, type nothing.
//
// One app, tests in order: the states are cumulative.

import { test, before, after } from "node:test";
import assert from "node:assert/strict";
import { openApp, type AppContext } from "./harness.ts";

let app: AppContext;
before(async () => { app = await openApp(); });
after(async () => { await app.close(); });

const dot = (a: number[], b: number[]) => a.reduce((s, x, i) => s + x * b[i], 0);
const sub = (a: number[], b: number[]) => a.map((x, i) => x - b[i]);

/** The sketch plane: +x turned 30° up out of x–y, +y leaning back 25° — planar.e2e.ts's. */
const A = (30 * Math.PI) / 180, B = (25 * Math.PI) / 180;
const G_O = [10, 5, 6];
const G_X = [Math.cos(A), 0, Math.sin(A)];
const G_Y = [-Math.sin(A) * Math.sin(B), Math.cos(B), Math.cos(A) * Math.sin(B)];
const G_Z = [G_X[1] * G_Y[2] - G_X[2] * G_Y[1], G_X[2] * G_Y[0] - G_X[0] * G_Y[2], G_X[0] * G_Y[1] - G_X[1] * G_Y[0]];
const onG = (u: number, v: number) => G_O.map((o, i) => o + u * G_X[i] + v * G_Y[i]);
const inG = (p: number[]) => [dot(sub(p, G_O), G_X), dot(sub(p, G_O), G_Y)];

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
  await app.page.mouse.click(at.x, at.y);
  await app.page.waitForTimeout(150);
}

interface SeenLoop { members: string[]; area: number; parent: number | null; frame: string | null; normal: number[] }

/** `findLoops` on the app's own model, run in the page from the module the dev server serves. */
const pageLoops = (): Promise<SeenLoop[]> => app.page.evaluate(async () => {
  const path = "/src/loops.ts"; // a variable, so the type checker leaves the browser's import alone
  const { findLoops } = await import(path);
  const { model } = (window as never as { __neocad: { model: unknown } }).__neocad;
  return (findLoops(model) as { members: { name: string }[]; area: number; parent: number | null; plane: { frame: string | null; normal: number[] } }[])
    .map((l) => ({ members: l.members.map((m) => m.name), area: l.area, parent: l.parent, frame: l.plane.frame, normal: l.plane.normal }));
});

/**
 * A real click at (sx, sy), with `loopAt` asked about the very position the
 * pointer event carried, read the tool engine's way. Returns that position and
 * the loop's members and area, or null for no loop.
 */
async function clickProbe(sx: number, sy: number): Promise<{ at: [number, number]; loop: { members: string[]; area: number } | null }> {
  await app.page.evaluate(() => {
    const w = window as never as { __probe?: Promise<unknown> };
    const cv = document.getElementById("cv")!;
    cv.addEventListener("pointerdown", (e) => {
      const r = cv.getBoundingClientRect();
      const x = e.clientX - r.left, y = e.clientY - r.top; // engine.ts's reading, exactly
      w.__probe = (async () => {
        const path = "/src/loops.ts";
        const { loopAt } = await import(path);
        const { model, engine } = (window as never as { __neocad: { model: unknown; engine: { view: unknown } } }).__neocad;
        const loop = loopAt(model, engine.view, x, y) as { members: { name: string }[]; area: number } | null;
        return { at: [x, y], loop: loop && { members: loop.members.map((m) => m.name), area: loop.area } };
      })();
    }, { once: true, capture: true });
  });
  // Aimed at empty canvas — no point, curve or glyph within reach — or "the
  // click picked nothing" would be a statement about the aim, not the app.
  const at = await app.at(sx, sy);
  await app.page.mouse.move(at.x, at.y, { steps: 3 });
  await app.page.waitForTimeout(80);
  assert.equal((await app.repl("hover()")).value, null, `(${sx}, ${sy}) is over something`);
  await clickAt(sx, sy);
  return app.page.evaluate(() => (window as never as { __probe: Promise<never> }).__probe);
}

const cmd = () => app.page.$eval("#cmd", (el) => (el as HTMLInputElement).value);

// --- drawn with the tools --------------------------------------------------------

let rectangle: string[] = [];
let arc = "";
let ring = "";

test("on a tilted sketch: a rectangle from the tool, one corner filleted with the tool, an island from the circle tool", async () => {
  const at = (p: number[]) => `pt(${p.join(", ")})`;
  await app.type(`go = ${at(G_O)}; gx = ${at(onG(20, 0))}; gy = ${at(onG(0, 20))}; g = plane(go, gx, gy)`);
  assert.equal((await app.repl("defaultFrame()")).value, "f1");

  await app.type("rectangle");
  await leftDrag(await app.screenOf(onG(30, 10)), await app.screenOf(onG(70, 40)));
  let m = await app.model();
  rectangle = m.lines.map((l) => l.name);
  assert.equal(rectangle.length, 4);

  // The fillet tool: two clicks, on the bottom edge and the right one.
  await app.type('arm("fillet", { radius: 8 })');
  await clickAt(...await app.screenOf(onG(50, 10)));
  await clickAt(...await app.screenOf(onG(70, 25)));
  m = await app.model();
  assert.equal(m.arcs.length, 1, "the corner was rounded");
  arc = m.arcs[0].name;

  // The radius is dragged out to the left: released to the right, at (59, 25),
  // it lands within a few pixels of the fillet arc's circle — on no part of
  // the arc, but face-on snapping offers an arc's whole circle (snapping.ts
  // says so), and the radius quietly became 8.86.
  await app.type("circle");
  const c = await app.screenOf(onG(50, 25));
  await leftDrag(c, [c[0] - 9 * m.view.scale, c[1]]);
  m = await app.model();
  ring = m.circles[0].name;
  assert.ok(Math.abs(m.radii[ring] - 9) < 1e-3, `an island of radius 9: ${m.radii[ring]}`);
  assert.equal(await app.status(), "SOLVED");
  for (const [name, p] of Object.entries(m.points)) {
    if (!["p1", "p2", "p3"].includes(name)) assert.ok(Math.abs(dot(sub(p, G_O), G_Z)) < 1e-6, `${name} is on the sketch`);
  }
});

test("turned to look at it obliquely, loops() lists the outline and the island inside it, with their closed-form areas", async () => {
  await app.type("orbit(0.5, -0.35)");
  const journal = (await app.model()).journalOps.length;

  await app.type("loops()");
  const listed = (await app.repl("loops()")).value as string[];
  assert.equal(listed.length, 2, listed.join(" | "));
  const outline = [rectangle[0], arc, ...rectangle.slice(1)].join(",");
  assert.match(listed[0], new RegExp(`^loop of ${outline} in f1, area [\\d.]+$`), "the outline, through the arc, counter-clockwise about f1's +z");
  assert.match(listed[1], new RegExp(`^loop of ${ring} in f1, area [\\d.]+, inside ${outline}$`), "the island, inside it");
  assert.match(await app.log(), new RegExp(`loop of ${outline} in f1`), "and the typed entry printed it");

  // The areas the drawing's own coordinates say: the rectangle's sides read
  // off its two untouched corners, less a filleted corner; the island's πr².
  const m = await app.model();
  // p4 and p6 are the corners the drag pressed and released on (p1–p3 are the
  // frame's); the fillet moved p5, the corner it rounded.
  const [a, c] = [inG(m.points.p4), inG(m.points.p6)];
  const w = c[0] - a[0], h = c[1] - a[1];
  const want = [w * h - 64 * (1 - Math.PI / 4), Math.PI * m.radii[ring] ** 2];
  assert.ok(Math.abs(w - 40) < 1e-3 && Math.abs(h - 30) < 1e-3, `the rectangle is 40 × 30: ${w} × ${h}`);
  const seen = await pageLoops();
  for (let i = 0; i < 2; i++) {
    assert.ok(Math.abs(seen[i].area - want[i]) < 1e-6, `loop ${i}: area ${seen[i].area}, expected ${want[i]}`);
    assert.equal(listed[i].match(/area ([\d.]+)/)![1], String(Number(want[i].toFixed(3))), "and the listing rounds the same number");
    assert.ok(seen[i].normal.every((x, k) => Math.abs(x - G_Z[k]) < 1e-12), "in the sketch's plane, about its +z");
  }
  assert.equal(seen[1].parent, 0);

  const after = await app.model();
  assert.equal(after.journalOps.length, journal, "asking journalled nothing");
  assert.equal(after.size, m.size, "and made nothing");
});

test("a real click inside the outline is inside it by loopAt, on the island is the island — and the click itself still picks nothing", async () => {
  await app.page.fill("#cmd", "");
  const inside = await clickProbe(...await app.screenOf(onG(36, 34)));
  const expected = (await app.screenOf(onG(36, 34))).map((x) => Math.round(x));
  assert.ok(Math.hypot(inside.at[0] - expected[0], inside.at[1] - expected[1]) < 1.5, `the click landed at ${inside.at}`);
  assert.deepEqual(inside.loop?.members, [rectangle[0], arc, ...rectangle.slice(1)], "between the island and the outline: the outline");
  assert.equal(await cmd(), "", "the click typed nothing — no click behaviour changed");

  // Below-left of the island's centre: clear of the centre point, of its
  // glyph (which sits up and to the right) and of the rim.
  const island = await clickProbe(...await app.screenOf(onG(46, 21.5)));
  assert.deepEqual(island.loop?.members, [ring], "on the island: the island, the innermost loop");
  assert.equal(await cmd(), "");

  // Just past the rounded corner, inside where the square corner was.
  const corner = await clickProbe(...await app.screenOf(onG(69.5, 10.5)));
  assert.equal(corner.loop, null, "outside the fillet's arc is outside the loop");
  const beside = await clickProbe(...await app.screenOf(onG(85, 25)));
  assert.equal(beside.loop, null, "and beside it, nothing");
  assert.equal(await cmd(), "");
  assert.equal(await app.status(), "SOLVED");
});

test("no uncaught page errors", () => {
  assert.deepEqual(app.pageErrors, []);
});
