// A click on a face lands on that face, is held there, and says so before
// the click (docs/plans/click-on-face.md). The owner: *"when i make a
// rectangular prism, i attempt to draw an e.g. circle on another face, but it
// still draws the circle on the XY plane. Why? if i am hovering over a face
// without an active on-plane constraint, it should constrain to the plane i
// am hovering over … it should come up with an on-plane constraint indicator
// before i click (and highlight the plane i am hovering over)"*.
//
// The first two tests are the owner's report as a reproduction — bug 72 in
// docs/ARCHITECTURE.md's list, which had two legs. A rectangle drawn and
// extruded with the tools, the view orbited, the circle tool armed: (a) a
// click on a wall's middle was swallowed — the press settled onto the face,
// the release was compared to it raw, and the two differed, so a click read
// as a zero-length drag and the gesture started over; (b) a press near a
// wall's edge snapped to the edge, and a snapped press never asked what face
// it was on, so the circle was laid on the ground through a point of the
// wall: the owner's *"still draws the circle on the XY plane"*. Then the
// design: the centre held by `onplane` naming the wall and the circle's
// normal `par` to it; a three-point circle with a point on each of three
// faces, each held to its own; the depth set and the points riding along; a
// rectangle's four corners on one face; the face lit and named before the
// click. By mouse, and on an iPhone 13 by finger. Set NEOCAD_E2E_SHOTS to
// keep the pictures; look at them.

import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdirSync } from "node:fs";
import { join } from "node:path";
import { openApp, confirmAndRelease, type AppContext } from "./harness.ts";
import { fingers } from "./fingers.ts";

const SHOTS = process.env.NEOCAD_E2E_SHOTS;
/** Each test its own app, closed however the test ends. */
async function withApp(options: Parameters<typeof openApp>[0], body: (a: AppContext) => Promise<void>): Promise<void> {
  const a = await openApp(options);
  try {
    await body(a);
  } finally {
    await a.close();
  }
}

async function shot(a: AppContext, name: string, still = false, quick = false): Promise<void> {
  if (!SHOTS) return;
  mkdirSync(SHOTS, { recursive: true });
  // Off the drawing, and off the logo, whose tooltip would be in the picture.
  if (!still) await a.page.mouse.move(600, 120);
  // `quick`: a finger is down, and the press must not run into a long-press.
  if (!quick) await a.page.waitForTimeout(350);
  await a.page.screenshot({ path: join(SHOTS, `clickonface-${name}.png`) });
}

type Neo = { __neocad: { model: {
  features: Map<string, { depth: string; loops: string[][]; twins: string[][]; walls: string[] }>;
  relations: Map<string, { op: string; args: unknown[] }>;
  entities: Map<string, { kind: string; name: string; refs?: string[]; center?: string }>;
  coords(p: string): number[];
  line(n: string): { refs: [string, string] };
}; engine: { view: unknown; drawnFaces: unknown; occlusion: unknown } } };

const sub = (a: number[], b: number[]) => a.map((x, i) => x - b[i]);
const dot = (a: number[], b: number[]) => a.reduce((s, x, i) => s + x * b[i], 0);
const cross = (a: number[], b: number[]) => [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]];
const len = (a: number[]) => Math.hypot(...a);

/** A face of e1 as the kernel names it, with its plane now — read through the app's own solidref.ts. */
interface FacePlane { name: string; p: number[]; n: number[] }
const facePlane = (a: AppContext, name: string) => a.page.evaluate(async (name) => {
  // The app's own module, by a path tsc does not try to follow (as the harness's oracle imports its own).
  const [solidrefPath] = ["/src/relations/solidref.ts"];
  const { planeNow } = await import(solidrefPath);
  const m = (window as never as Neo).__neocad.model;
  return { name, ...planeNow(m, name)! } as FacePlane;
}, name);

/**
 * The faces of e1 drawn this frame, each with the middle of the pixels it is
 * in front at and how many — walls first, as the owner aimed at one. Asked of
 * the app's own face pick (solidpick.ts), cell by cell, so the pixel a test
 * aims at is one the app itself says is that face.
 */
interface Seen { name: string; at: [number, number]; area: number; box: [number, number, number, number] }
async function facesInSight(a: AppContext): Promise<Seen[]> {
  const found = await a.page.evaluate(async () => {
    const [solidpickPath] = ["/src/solidpick.ts"];
    const { faceUnder } = await import(solidpickPath);
    const { engine } = (window as never as Neo).__neocad;
    const cv = document.getElementById("cv") as HTMLCanvasElement;
    const step = 4;
    const sums: Record<string, { sx: number; sy: number; n: number; box: [number, number, number, number] }> = {};
    for (let y = step / 2; y < cv.clientHeight; y += step) {
      for (let x = step / 2; x < cv.clientWidth; x += step) {
        const f = faceUnder(engine.drawnFaces, x, y);
        if (!f) continue;
        const s = sums[f.name] ?? { sx: 0, sy: 0, n: 0, box: [x, y, x, y] };
        s.sx += x; s.sy += y; s.n += 1;
        s.box = [Math.min(s.box[0], x), Math.min(s.box[1], y), Math.max(s.box[2], x), Math.max(s.box[3], y)];
        sums[f.name] = s;
      }
    }
    return Object.entries(sums).map(([name, s]) => ({ name, at: [Math.round(s.sx / s.n), Math.round(s.sy / s.n)] as [number, number], area: s.n * step * step, box: s.box }));
  });
  const walls = found.filter((f) => f.name.includes(".m")).sort((p, q) => q.area - p.area);
  return [...walls, ...found.filter((f) => !f.name.includes(".m"))];
}

/** The face the app says is drawn under a pixel, by name, or null. */
const faceAt = (a: AppContext, at: [number, number]) => a.page.evaluate(async (at) => {
  const [solidpickPath] = ["/src/solidpick.ts"];
  const { faceUnder } = await import(solidpickPath);
  const { engine } = (window as never as Neo).__neocad;
  return faceUnder(engine.drawnFaces, at[0], at[1])?.name ?? null;
}, at);

const relations = (a: AppContext) => a.page.evaluate(() =>
  [...(window as never as Neo).__neocad.model.relations.entries()].map(([name, r]) => ({ name, op: r.op, args: r.args })));

const circles = (a: AppContext) => a.page.evaluate(() => {
  const m = (window as never as Neo).__neocad.model;
  return [...m.entities.values()].filter((e) => e.kind === "circle").map((e) => ({ name: e.name, center: e.center!, at: m.coords(e.center!) }));
});

const normalOf = (a: AppContext, curve: string) => a.page.evaluate((c) => (window as never as Neo & { __neocad: { model: { normalOf(n: string): number[] } } }).__neocad.model.normalOf(c), curve);
const coords = (a: AppContext, p: string) => a.page.evaluate((p) => (window as never as Neo).__neocad.model.coords(p), p);

/** The faces a point is held on by `onplane`, by name. */
const heldOn = async (a: AppContext, p: string) => (await relations(a)).filter((r) => r.op === "onPlane" && r.args[0] === p).map((r) => r.args[1] as string);

/** How far `q` is off the plane of `face`. */
const offFace = (face: FacePlane, q: number[]) => Math.abs(dot(sub(q, face.p), face.n));
/** How far `n` is from parallel to the face's normal: the sine of the angle between them. */
const offNormal = (face: FacePlane, n: number[]) => len(cross(n.map((c) => c / len(n)), face.n));

/** From in front, to the right and above: the lid and two walls each a hand's breadth on screen (measured, test/e2e's probe). */
const THREE_FACES = "orbit(0, -1.0); orbit(-0.8, 0)";

/** A rectangle drawn and extruded with the tools, as the owner makes a prism; the view orbited so three faces show. */
async function prism(a: AppContext): Promise<void> {
  await a.type('arm("rectangle")');
  const [p, q] = [await a.at(460, 320), await a.at(660, 480)];
  await a.page.mouse.move(p.x, p.y, { steps: 3 });
  await a.page.mouse.down();
  await a.page.mouse.move(q.x, q.y, { steps: 10 });
  await a.page.mouse.up();
  await a.page.waitForTimeout(300);
  await a.type('arm("extrude")');
  const c = await a.at(560, 400);
  await a.page.mouse.click(c.x, c.y);
  await a.page.waitForTimeout(300);
  await confirmAndRelease(a);
  // Closer, so a wall is a hand's breadth on screen and the pictures read.
  await a.type(`${THREE_FACES}; zoom(1.5)`);
  await a.page.evaluate(() => (document.activeElement as HTMLElement | null)?.blur());
}

/** Typed, then the command line let go of, as a hand does before it touches the drawing again. */
async function type(a: AppContext, line: string): Promise<void> {
  await a.type(line);
  await a.page.evaluate(() => (document.activeElement as HTMLElement | null)?.blur());
  await a.page.waitForTimeout(120);
}

async function click(a: AppContext, at: [number, number]): Promise<void> {
  const p = await a.at(...at);
  await a.page.mouse.move(p.x, p.y, { steps: 3 });
  await a.page.waitForTimeout(120);
  await a.page.mouse.click(p.x, p.y);
  await a.page.waitForTimeout(250);
}

async function hover(a: AppContext, at: [number, number]): Promise<void> {
  const p = await a.at(...at);
  await a.page.mouse.move(p.x, p.y, { steps: 3 });
  await a.page.waitForTimeout(250);
}

async function drag(a: AppContext, from: [number, number], to: [number, number]): Promise<void> {
  const p = await a.at(...from), q = await a.at(...to);
  await a.page.mouse.move(p.x, p.y, { steps: 3 });
  await a.page.waitForTimeout(100);
  await a.page.mouse.down();
  await a.page.mouse.move(q.x, q.y, { steps: 10 });
  await a.page.mouse.up();
  await a.page.waitForTimeout(300);
}

const chip = (a: AppContext) => a.page.$eval("#mode", (el) => ({
  where: el.dataset.where ?? "", landing: el.dataset.landing ?? "", what: el.dataset.what ?? "", next: el.dataset.next ?? "",
}));

/** A pixel of the drawing canvas that is the landing's amber wash: some ink, and more red than green than blue. */
async function assertLit(a: AppContext, at: [number, number], what: string): Promise<void> {
  const [r, g, b, alpha] = await a.pixel(at[0] + 0.5, at[1] + 0.5, "drawing");
  assert.ok(alpha > 40 && r > g && g > b, `${what}: the face is lit amber at (${at}) — got rgba(${r},${g},${b},${alpha})`);
}

/**
 * A pixel just inside one of a wall's edges — its base line, its twin or a
 * chord — within a mouse's curve-snap reach of the edge and clear of its ends
 * and its middle, whose own snaps pin a point outright: where a press snaps
 * *along* the edge. The owner's finger on a phone's small face lands there
 * more often than not. Null when no edge of the wall offers such a place.
 */
async function nearEdge(a: AppContext, wall: { name: string; at: [number, number] }): Promise<[number, number] | null> {
  const edges = await a.page.evaluate((name) => {
    const m = (window as never as Neo).__neocad.model;
    const f = m.features.get("e1")!;
    const i = Number(name.split(".m")[1]);
    const ends = m.line(f.loops[0][i]).refs;
    const lines = [f.loops[0][i], f.twins[0][i], ...f.walls.filter((w) => m.entities.get(w)?.kind === "line" && m.line(w).refs.some((p) => ends.includes(p)))];
    return lines.map((l) => m.line(l).refs.map((p) => m.coords(p)));
  }, wall.name);
  for (const [p, q] of edges) {
    const [sp, sq] = [await a.screenOf(p), await a.screenOf(q)];
    const length = Math.hypot(sq[0] - sp[0], sq[1] - sp[1]);
    // Three tenths along: at least 14 px from the near end (a vertex snaps
    // within 10) and from the middle (a midpoint within 8), so only the edge
    // itself is within reach; then three pixels in from it, inside the face.
    if (length * 0.2 < 14) continue;
    const on: [number, number] = [sp[0] + (sq[0] - sp[0]) * 0.3, sp[1] + (sq[1] - sp[1]) * 0.3];
    const toward = [wall.at[0] - on[0], wall.at[1] - on[1]];
    const d = Math.hypot(...toward);
    if (d < 12) continue;
    return [on[0] + (3 * toward[0]) / d, on[1] + (3 * toward[1]) / d];
  }
  return null;
}

// --- bug 72: the owner's report, both legs -----------------------------------------

test("bug 72 (a), by mouse: a prism, the view orbited, the circle tool's centre clicked on a wall — one circle, its centre on the wall, not swallowed", () => withApp({}, async (a) => {
  await prism(a);
  const [wall] = await facesInSight(a);
  assert.ok(wall?.name.includes(".m"), `a wall of the prism in sight: ${JSON.stringify(await facesInSight(a))}`);
  const face = await facePlane(a, wall.name);
  await type(a, 'arm("circle", { method: "centre" })');
  await click(a, wall.at);
  await click(a, [wall.at[0] + 18, wall.at[1] - 10]);
  const made = await circles(a);
  assert.equal(made.length, 1, `one circle drawn by a click at the centre and a click at the rim (before: the click on the face was swallowed) — log: ${await a.log()}`);
  const centre = made[0].at;
  assert.ok(Math.abs(centre[2]) > 1, `the centre is off the ground: ${JSON.stringify(centre)}`);
  assert.ok(offFace(face, centre) < 1e-6, `the centre lies on ${face.name}: ${JSON.stringify(centre)} is ${offFace(face, centre)} off it`);
  assert.ok(offNormal(face, await normalOf(a, made[0].name)) < 1e-6, `the circle faces as ${face.name} does`);
  // Held, visibly: the centre onplane the wall, the normal par to it.
  assert.deepEqual(await heldOn(a, made[0].center), [wall.name], `the centre is held on ${wall.name}`);
  const par = (await relations(a)).find((r) => r.op === "parallel" && r.args[0] === made[0].name);
  assert.equal(par?.args[1], wall.name, `the circle's normal is par to ${wall.name}: ${JSON.stringify(par)}`);
  assert.match(await a.status(), /SOLVED/);
  await shot(a, "mouse-1-a-circle-on-the-wall");
  assert.deepEqual(a.pageErrors, []);
}));

test("bug 72 (b), by mouse — the owner's words: a press beside a wall's edge, snapped to it, dragged out — the circle is on the wall, not on the x–y plane", () => withApp({}, async (a) => {
  await prism(a);
  const [wall] = await facesInSight(a);
  const face = await facePlane(a, wall.name);
  const at = await nearEdge(a, wall);
  assert.ok(at, `${wall.name} has a side edge in sight to press beside`);
  await type(a, 'arm("circle")');
  await hover(a, at);
  // The scenario is the snapped one: the press is pulled onto the wall's side edge.
  const snap = await a.page.evaluate(() => (window as never as { __neocad: { engine: { snap: { kind: string; targets: string[] } | null } } }).__neocad.engine.snap);
  assert.ok(snap && snap.kind === "curve", `the press beside the edge snaps along it: ${JSON.stringify(snap)}`);
  await drag(a, at, [wall.at[0], wall.at[1]]);
  const made = await circles(a);
  assert.equal(made.length, 1, `one circle drawn — log: ${await a.log()}`);
  const n = await normalOf(a, made[0].name);
  assert.ok(offNormal(face, n) < 1e-6, `the circle faces as ${face.name} does, not the x–y plane: its normal is ${JSON.stringify(n)}`);
  assert.ok(offFace(face, made[0].at) < 1e-6, `its centre lies on ${face.name}`);
  // The snap still won over the face: the centre is held on the edge it was aimed along, and on the face.
  const ops = (await relations(a)).filter((r) => r.args[0] === made[0].center).map((r) => r.op).sort();
  assert.deepEqual(ops, ["onPlane", "pointOnLine"], `the centre on the edge and on the face: ${ops}`);
  assert.match(await a.status(), /SOLVED/);
  assert.deepEqual(a.pageErrors, []);
}));

// --- the design, by mouse ------------------------------------------------------------

test("by mouse: a three-point circle with a point on each of three faces, each held to its own; the depth set, the points ride along", () => withApp({}, async (a) => {
  await prism(a);
  const faces = await facesInSight(a);
  assert.ok(faces.length >= 3, `three faces in sight: ${JSON.stringify(faces)}`);
  const [wallA, wallB, lid] = [faces[0], faces[1], faces.find((f) => f.name === "e1.lid")!];
  assert.ok(lid, "the lid in sight");
  await type(a, 'arm("circle", { method: "3pt" })');
  // Before the click: the face under the hand lit, the mark and its name beside the cursor, the chip saying where.
  await hover(a, wallA.at);
  assert.deepEqual(await chip(a), { where: `on ${wallA.name}`, landing: "true", what: "circle", next: "click the first point" });
  await assertLit(a, [wallA.at[0] - 10, wallA.at[1] + 10], "hovering the wall");
  await shot(a, "mouse-0-hovering-a-wall-lit-and-named", true);
  await click(a, wallA.at);
  await hover(a, wallB.at);
  assert.equal((await chip(a)).where, `on ${wallB.name}`, "the chip follows the hand to the next face");
  await click(a, wallB.at);
  await hover(a, lid.at);
  await shot(a, "mouse-2-two-points-on-two-walls-the-third-over-the-lid", true);
  await click(a, lid.at);
  const made = await circles(a);
  assert.equal(made.length, 1, `one circle through three faces — log: ${await a.log()}`);
  const rels = await relations(a);
  const rim = rels.filter((r) => r.op === "onCircle" && r.args[1] === made[0].name).map((r) => r.args[0] as string);
  assert.equal(rim.length, 3, "three points on the circle");
  const planes = new Set<string>();
  for (const p of rim) {
    const on = await heldOn(a, p);
    assert.equal(on.length, 1, `${p} is held on one face: ${on}`);
    planes.add(on[0]);
    const face = await facePlane(a, on[0]);
    assert.ok(offFace(face, await coords(a, p)) < 1e-6, `${p} lies on ${on[0]}`);
  }
  assert.deepEqual([...planes].sort(), [wallA.name, wallB.name, lid.name].sort(), "one point on each of the three faces");
  assert.equal(rels.filter((r) => r.op === "parallel" && r.args[0] === made[0].name).length, 0, "a circle through three faces lies in none, and its normal is held to none");
  assert.match(await a.status(), /SOLVED/);
  await shot(a, "mouse-3-the-circle-through-three-faces");
  // The depth set: the lid's point rides up with the lid, every point still on
  // its face. Measured against the solid, not the ground: nothing holds the
  // base (every sketch is a 3D sketch), and a circle pinned to three faces
  // lets the minimum-norm solve share the change with the solid itself
  // (docs/plans/click-on-face.md, As built).
  await type(a, 'set("d1.value", 20)');
  await a.page.waitForTimeout(300);
  const base = await facePlane(a, "e1.base");
  for (const p of rim) {
    const [on] = await heldOn(a, p);
    const face = await facePlane(a, on);
    const q = await coords(a, p);
    assert.ok(offFace(face, q) < 1e-6, `after set: ${p} still lies on ${on} (${JSON.stringify(q)})`);
    if (on === "e1.lid") assert.ok(Math.abs(offFace(base, q) - 20) < 1e-6, `the lid's point rode up to 20 above the base: ${JSON.stringify(q)}, ${offFace(base, q)} above`);
  }
  assert.match(await a.status(), /SOLVED/);
  await shot(a, "mouse-4-the-depth-set-to-20-the-points-ride");
  assert.deepEqual(a.pageErrors, []);
}));

test("by mouse: a rectangle dragged on a wall has its four corners held on it; a line from a wall to the lid, an end on each", () => withApp({}, async (a) => {
  await prism(a);
  const faces = await facesInSight(a);
  const [wall, lid] = [faces[0], faces.find((f) => f.name === "e1.lid")!];
  const face = await facePlane(a, wall.name);
  await type(a, 'arm("rectangle")');
  // Well inside the wall: a corner on its edge would snap there, and the snap
  // would rightly win over the face (a probe found a wall 25 px tall) — and a
  // wall is a parallelogram on screen, so a box round its middle has to be
  // small to stay on it. Both ends checked to be the wall's.
  let corners: [number, number][] | null = null;
  for (const k of [0.12, 0.08, 0.05, 0.03]) {
    const [hx, hy] = [(wall.box[2] - wall.box[0]) * k, (wall.box[3] - wall.box[1]) * k * 0.6];
    const tried: [number, number][] = [[wall.at[0] - hx, wall.at[1] - hy], [wall.at[0] + hx, wall.at[1] + hy]];
    const on = await Promise.all(tried.map((c) => faceAt(a, c)));
    if (on.every((f) => f === wall.name)) { corners = tried; break; }
  }
  assert.ok(corners, `a box round ${wall.name}'s middle with both corners on it (box ${wall.box}, middle ${wall.at})`);
  const hx = corners[1][0] - wall.at[0];
  await drag(a, corners[0], corners[1]);
  const rels = await relations(a);
  const held = rels.filter((r) => r.op === "onPlane" && r.args[1] === wall.name).map((r) => r.args[0] as string);
  assert.equal(held.length, 4, `four corners held on ${wall.name}: ${held}`);
  for (const p of held) assert.ok(offFace(face, await coords(a, p)) < 1e-6, `${p} lies on the wall`);
  assert.equal(rels.filter((r) => r.op === "coplanar" && r.args.some((p) => held.includes(p as string))).length, 0, "held on the face, the box needs no coplanar of its own");
  await type(a, 'arm("line")');
  await click(a, [wall.at[0] - hx * 1.5, wall.at[1]]);
  await click(a, lid.at);
  await a.page.keyboard.press("Escape");
  await a.page.waitForTimeout(200);
  const line = await a.page.evaluate(() => {
    const m = (window as never as Neo).__neocad.model;
    return [...m.entities.values()].filter((e) => e.kind === "line").map((e) => e.refs!).at(-1)!;
  });
  assert.deepEqual(await heldOn(a, line[0]), [wall.name], "the line's start is held on the wall");
  assert.deepEqual(await heldOn(a, line[1]), ["e1.lid"], "its end on the lid");
  assert.match(await a.status(), /SOLVED/);
  await shot(a, "mouse-5-a-rectangle-on-the-wall-a-line-up-onto-the-lid");
  assert.deepEqual(a.pageErrors, []);
}));

// --- on an iPhone 13, by finger -------------------------------------------------------

/** The prism by finger, as profilesheld.e2e draws it: the shapes button, a drag, the sweep button, a tap inside, ✓. */
async function fingerPrism(a: AppContext): Promise<Awaited<ReturnType<typeof fingers>>> {
  const hand = await fingers(a);
  const tap = async (selector: string) => { await a.page.tap(selector); await a.page.waitForTimeout(350); };
  await tap('#toolbar button[data-group="shapes"]');
  await hand.drag(await a.screenOf([-25, -15, 0]), await a.screenOf([25, 15, 0]), 12);
  await a.page.waitForTimeout(400);
  await tap('#toolbar button[data-group="sweep"]');
  const [x, y] = await a.screenOf([12, 6, 0]);
  await a.at(x, y);
  await hand.tap(x, y);
  await a.page.waitForTimeout(400);
  await tap("#options .oact button.ok");
  // Zoomed so a wall is a hand's breadth: at the phone's own scale a wall's
  // edge midpoints are within a finger's midpoint snap of its middle, and a
  // tap there would rightly be pinned to the edge rather than held on the face.
  await type(a, `${THREE_FACES}; zoom(1.8)`);
  return hand;
}

/**
 * A finger put down on `at` for a look — the face lit and named while it is
 * down — pictured, and lifted well inside a long-press's 500 ms; then
 * whatever the press was read as is dropped (Escape) and the tool armed
 * afresh with `arm`, so the taps that follow are the whole gesture.
 */
async function lookWithFinger(a: AppContext, hand: Awaited<ReturnType<typeof fingers>>, at: [number, number], picture: string, arm: string): Promise<void> {
  await a.at(...at);
  await hand.down(at);
  await shot(a, picture, true, true);
  await hand.up();
  await a.page.waitForTimeout(200);
  await a.page.keyboard.press("Escape");
  await a.page.waitForTimeout(150);
  await type(a, arm);
}

test("on an iPhone 13, by finger: a tap on a wall lands and holds the circle's centre there, the face lit and named while the finger is down", () => withApp({ device: "iPhone 13" }, async (a) => {
  const hand = await fingerPrism(a);
  const [wall] = await facesInSight(a);
  assert.ok(wall?.name.includes(".m"), `a wall in sight: ${JSON.stringify(await facesInSight(a))}`);
  const face = await facePlane(a, wall.name);
  const arm = 'arm("circle", { method: "centre" })';
  await type(a, arm);
  // The finger down on the wall: the chip saying where and the face lit, read
  // while it is down and lifted within a tap's time; then the picture, by a
  // second short press, and the tool afresh.
  await a.at(...wall.at);
  await hand.down(wall.at);
  assert.deepEqual(await chip(a), { where: `on ${wall.name}`, landing: "true", what: "circle", next: "press at the centre" });
  await assertLit(a, [wall.at[0] - 8, wall.at[1] + 8], "the finger on the wall");
  await hand.up();
  await a.page.waitForTimeout(200);
  await a.page.keyboard.press("Escape");
  await type(a, arm);
  await lookWithFinger(a, hand, wall.at, "iphone-0-a-finger-on-a-wall-lit-and-named", arm);
  await a.at(...wall.at);
  await hand.tap(...wall.at);
  await a.page.waitForTimeout(350);
  const rim: [number, number] = [wall.at[0] + 14, wall.at[1] - 8];
  await a.at(...rim);
  await hand.tap(...rim);
  await a.page.waitForTimeout(400);
  const made = await circles(a);
  assert.equal(made.length, 1, `one circle by two taps — log: ${await a.log()}`);
  assert.ok(offFace(face, made[0].at) < 1e-6, `the centre lies on ${wall.name}`);
  assert.ok(offNormal(face, await normalOf(a, made[0].name)) < 1e-6, "the circle faces as the wall does");
  assert.deepEqual(await heldOn(a, made[0].center), [wall.name]);
  assert.match(await a.status(), /SOLVED/);
  await shot(a, "iphone-1-the-circle-on-the-wall");
  assert.deepEqual(a.pageErrors, []);
}));

test("on an iPhone 13, by finger: three taps on three faces make a circle through them, each point held to its face", () => withApp({ device: "iPhone 13" }, async (a) => {
  const hand = await fingerPrism(a);
  const faces = await facesInSight(a);
  const [wallA, wallB, lid] = [faces[0], faces[1], faces.find((f) => f.name === "e1.lid")!];
  assert.ok(wallB?.name.includes(".m") && lid, `three faces in sight: ${JSON.stringify(faces)}`);
  const arm = 'arm("circle", { method: "3pt" })';
  await type(a, arm);
  // The finger on the lid before anything is tapped: named in the chip; pictured; then the tool afresh and the three taps.
  await a.at(...lid.at);
  await hand.down(lid.at);
  assert.equal((await chip(a)).where, "on e1.lid");
  await hand.up();
  await a.page.waitForTimeout(200);
  await a.page.keyboard.press("Escape");
  await type(a, arm);
  await lookWithFinger(a, hand, lid.at, "iphone-2-a-finger-on-the-lid-the-three-point-circle-armed", arm);
  for (const f of [wallA, wallB, lid]) {
    await a.at(...f.at);
    await hand.tap(...f.at);
    await a.page.waitForTimeout(350);
  }
  const made = await circles(a);
  assert.equal(made.length, 1, `one circle through three faces — log: ${await a.log()}`);
  const rels = await relations(a);
  const rim = rels.filter((r) => r.op === "onCircle" && r.args[1] === made[0].name).map((r) => r.args[0] as string);
  const planes: string[] = [];
  for (const p of rim) {
    const on = await heldOn(a, p);
    assert.equal(on.length, 1, `${p} held on one face: ${on}`);
    planes.push(on[0]);
    assert.ok(offFace(await facePlane(a, on[0]), await coords(a, p)) < 1e-6, `${p} lies on ${on[0]}`);
  }
  assert.deepEqual(planes.sort(), [wallA.name, wallB.name, "e1.lid"].sort());
  assert.match(await a.status(), /SOLVED/);
  await shot(a, "iphone-3-the-circle-through-three-faces");
  assert.deepEqual(a.pageErrors, []);
}));
