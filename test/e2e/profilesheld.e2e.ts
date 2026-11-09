// The owner's drag, in the real app, by mouse and on an iPhone 13 by finger
// (docs/plans/profiles-held.md): *"Why is it that after I extrude I can drag a
// corner of the extrude and it deforms the solid? I think it's missing adding
// in relations"*. A rectangle drawn with the tool in a fresh document,
// extruded 10 with the tool, the view orbited, a lid corner dragged: the solid
// stays a right prism — its base flat, every wall square to it and as long as
// the depth, the lid the base translated — and the status reads SOLVED.
//
// Measured before the change, with the probe this is made from: the lid corner
// p5 dragged 60×30 px took its base p2 from z 0 to −18.2, the base tilted
// while every wall stayed along the world's z, and the status said SOLVED.
// Set NEOCAD_E2E_SHOTS to keep the before and after pictures; look at them.

import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdirSync } from "node:fs";
import { join } from "node:path";
import { openApp, confirmAndRelease, type AppContext } from "./harness.ts";
import { fingers } from "./fingers.ts";

const SHOTS = process.env.NEOCAD_E2E_SHOTS;
/** Each test its own app, closed however the test ends — a failed assertion must not leave a browser holding the run open. */
async function withApp(options: Parameters<typeof openApp>[0], body: (a: AppContext) => Promise<void>): Promise<void> {
  const a = await openApp(options);
  try {
    await body(a);
  } finally {
    await a.close();
  }
}

type Neo = { __neocad: { model: {
  features: Map<string, { depth: string }>;
  relations: Map<string, { args: unknown[] }>;
  entities: Map<string, { kind: string }>;
  coords(p: string): number[];
} } };

/** The extrude's base/twin point pairs and its depth, as they stand. */
const solid = (a: AppContext) => a.page.evaluate(() => {
  const m = (window as never as Neo).__neocad.model;
  const f = m.features.get("e1")!;
  const args = m.relations.get(f.depth)!.args;
  const pairs: [number[], number[], string, string][] = [];
  for (let i = 2; i < args.length; i += 2) {
    const [b, t] = [args[i] as string, args[i + 1] as string];
    if (m.entities.get(b)?.kind === "point" && m.entities.get(t)?.kind === "point") pairs.push([m.coords(b), m.coords(t), b, t]);
  }
  return { depth: args[1] as number, pairs };
});

const sub = (a: number[], b: number[]) => a.map((x, i) => x - b[i]);
const dot = (a: number[], b: number[]) => a.reduce((s, x, i) => s + x * b[i], 0);
const cross = (a: number[], b: number[]) => [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]];
const len = (a: number[]) => Math.hypot(...a);

/** How far from a right prism, each way, in drawing units. */
function prismError(s: Awaited<ReturnType<typeof solid>>): Record<string, number> {
  const B = s.pairs.map((p) => p[0]), T = s.pairs.map((p) => p[1]);
  let n = [0, 0, 0];
  for (let i = 0; i < B.length; i++) for (let j = i + 1; j < B.length; j++) for (let k = j + 1; k < B.length; k++) {
    const c = cross(sub(B[j], B[i]), sub(B[k], B[i]));
    if (len(c) > len(n)) n = c;
  }
  n = n.map((x) => x / len(n));
  const walls = T.map((t, i) => sub(t, B[i]));
  return {
    flat: Math.max(...B.map((b) => Math.abs(dot(sub(b, B[0]), n)))),
    square: Math.max(...walls.map((w) => len(cross(w, n)))),
    depth: Math.max(...walls.map((w) => Math.abs(len(w) - Math.abs(s.depth)))),
    translated: Math.max(...walls.map((w) => len(sub(w, walls[0])))),
  };
}

function assertPrism(s: Awaited<ReturnType<typeof solid>>, what: string): void {
  const e = prismError(s);
  for (const [k, v] of Object.entries(e)) assert.ok(v <= 1e-6, `${what}: ${k} off by ${v} — ${JSON.stringify(e)}`);
}

async function shot(a: AppContext, name: string): Promise<void> {
  if (!SHOTS) return;
  mkdirSync(SHOTS, { recursive: true });
  await a.page.waitForTimeout(400);
  await a.page.screenshot({ path: join(SHOTS, `profilesheld-${name}.png`) });
}

/**
 * What the status says beside the verdict, and in what colour: an agreeing
 * relation — the rectangle's fourth perp — is said in the muted grey, never
 * orange (docs/plans/profiles-held.md, the owner's point 4), and nothing
 * conflicts.
 */
async function assertNothingOrange(a: AppContext, what: string): Promise<void> {
  const d = await a.page.$eval("#diagnosis", (el) => ({ cls: el.className, color: getComputedStyle(el).color }));
  assert.notEqual(d.cls, "conflict", `${what}: no conflict`);
  assert.equal(d.color, "rgb(122, 139, 155)", `${what}: said muted, if said at all`);
}

/** The lid corner nearest the viewer's top right — the one the owner would grab — and where it is drawn. */
async function lidCorner(a: AppContext): Promise<{ name: string; at: [number, number]; was: number[] }> {
  const s = await solid(a);
  let best: { name: string; at: [number, number]; was: number[] } | null = null;
  for (const [, t, , name] of s.pairs) {
    const at = await a.screenOf(t);
    if (!best || at[0] - at[1] > best.at[0] - best.at[1]) best = { name, at, was: t };
  }
  return best!;
}

test("by mouse: a rectangle extruded, the view orbited, a lid corner dragged — still a right prism, and SOLVED", () => withApp({}, async (a) => {
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
  await a.type("orbit(-0.6, -1.0)");
  await a.type('arm("select")');
  assertPrism(await solid(a), "as made");
  await shot(a, "mouse-0-before");
  const lid = await lidCorner(a);
  const [from, to] = [await a.at(...lid.at), await a.at(lid.at[0] + 60, lid.at[1] + 30)];
  await a.page.mouse.move(from.x, from.y, { steps: 3 });
  await a.page.waitForTimeout(80);
  await a.page.mouse.down();
  await a.page.mouse.move(to.x, to.y, { steps: 10 });
  await a.page.mouse.up();
  await a.page.waitForTimeout(500);
  // The picture first, so a failing run keeps one of what failed.
  await shot(a, "mouse-1-after");
  const after = await solid(a);
  const moved = after.pairs.find((x) => x[3] === lid.name)![1];
  assert.ok(len(sub(moved, lid.was)) > 1, `the corner moved: ${JSON.stringify(lid.was)} → ${JSON.stringify(moved)}`);
  assertPrism(after, "after the lid corner's drag");
  assert.match(await a.status(), /SOLVED/);
  await assertNothingOrange(a, "mouse");
  assert.deepEqual(a.pageErrors, []);
}));

test("on an iPhone 13, by finger: a rectangle extruded, a lid corner dragged — still a right prism, and SOLVED", () => withApp({ device: "iPhone 13" }, async (a) => {
  const hand = await fingers(a);
  const tap = async (selector: string) => { await a.page.tap(selector); await a.page.waitForTimeout(350); };
  const fingerDrag = async (from: [number, number], to: [number, number]) => {
    await a.at(...from);
    await hand.drag(from, to, 12);
    await a.page.waitForTimeout(400);
  };
  await tap('#toolbar button[data-group="shapes"]');
  await fingerDrag(await a.screenOf([-25, -15, 0]), await a.screenOf([25, 15, 0]));
  await tap('#toolbar button[data-group="sweep"]');
  const [x, y] = await a.screenOf([12, 6, 0]);
  await a.at(x, y);
  await hand.tap(x, y);
  await a.page.waitForTimeout(400);
  await tap("#options .oact button.ok");
  await a.type("orbit(-0.6, -1.0)");
  await a.page.evaluate(() => (document.activeElement as HTMLElement | null)?.blur());
  await a.type('arm("select")');
  await a.page.evaluate(() => (document.activeElement as HTMLElement | null)?.blur());
  const made = await solid(a);
  assert.equal(made.depth, 10, "extruded 10, the tool's default");
  assertPrism(made, "as made");
  await shot(a, "iphone-0-before");
  const lid = await lidCorner(a);
  await fingerDrag(lid.at, [lid.at[0] + 40, lid.at[1] + 20]);
  await shot(a, "iphone-1-after");
  const after = await solid(a);
  const moved = after.pairs.find((x) => x[3] === lid.name)![1];
  assert.ok(len(sub(moved, lid.was)) > 1, `the finger moved the corner: ${JSON.stringify(lid.was)} → ${JSON.stringify(moved)}`);
  assertPrism(after, "after the finger's drag");
  assert.match(await a.status(), /SOLVED/);
  await assertNothingOrange(a, "iPhone");
  assert.deepEqual(a.pageErrors, []);
}));

// --- the edge extrude: the primitive, a tool of its own -------------------------

type NeoS = { __neocad: { model: {
  surfaces: Map<string, { size?: string; curves?: string[] }>;
  relations: Map<string, { op: string; args: unknown[] }>;
  entities: Map<string, { kind: string; refs?: string[] }>;
  coords(p: string): number[];
} } };

/** s1's base/copy point pairs, and its curves' directions, as they stand. */
const edges = (a: AppContext) => a.page.evaluate(() => {
  const m = (window as never as NeoS).__neocad.model;
  const s = m.surfaces.get("s1");
  if (!s) return null;
  const args = m.relations.get(s.size!)!.args;
  const pairs: [number[], number[], string, string][] = [];
  for (let i = 2; i < args.length; i += 2) {
    const [b, t] = [args[i] as string, args[i + 1] as string];
    if (m.entities.get(b)?.kind === "point" && m.entities.get(t)?.kind === "point") pairs.push([m.coords(b), m.coords(t), b, t]);
  }
  const dirs = (s.curves ?? []).map((c) => { const [p, q] = m.entities.get(c)!.refs!.map((x) => m.coords(x)); return q.map((v, i) => v - p[i]); });
  return { depth: args[1] as number, pairs, dirs, perp: m.relations.get("s1_perp")?.op ?? null };
});

function assertEdgeExtrude(s: NonNullable<Awaited<ReturnType<typeof edges>>>, what: string): void {
  const chords = s.pairs.map(([b, t]) => sub(t, b));
  const worst = {
    translated: Math.max(...chords.map((c) => len(sub(c, chords[0])))),
    square: Math.max(...chords.flatMap((c) => s.dirs.map((u) => Math.abs(dot(c, u)) / len(u)))),
    depth: Math.max(...chords.map((c) => Math.abs(len(c) - Math.abs(s.depth)))),
  };
  for (const [k, v] of Object.entries(worst)) assert.ok(v <= 1e-6, `${what}: ${k} off by ${v} — ${JSON.stringify(worst)}`);
}

/** The edge tool on an L of two lines, then a copy's far corner dragged: one chord still, square, the depth long. */
async function edgeCase(a: AppContext, device: "mouse" | "iPhone"): Promise<void> {
  await a.type("p = pt(0, 0, 0); q = pt(30, 0, 0); r = pt(30, 20, 0); ln(p, q); ln(q, r)");
  await a.type('arm("edge")');
  await a.page.evaluate(() => (document.activeElement as HTMLElement | null)?.blur());
  const [x, y] = await a.screenOf([15, 0, 0]);
  if (device === "mouse") {
    const c = await a.at(x, y);
    await a.page.mouse.click(c.x, c.y);
    await a.page.waitForTimeout(300);
    await confirmAndRelease(a);
  } else {
    const hand = await fingers(a);
    await a.at(x, y);
    await hand.tap(x, y);
    await a.page.waitForTimeout(400);
    await a.page.tap("#options .oact button.ok");
    await a.page.waitForTimeout(350);
  }
  await a.type("orbit(-0.6, -1.0)");
  await a.type('arm("select")');
  await a.page.evaluate(() => (document.activeElement as HTMLElement | null)?.blur());
  const made = await edges(a);
  assert.ok(made, "s1 made");
  assert.equal(made.pairs.length, 3, "three points copied");
  assert.equal(made.perp, "perpendicular", "s1_perp beside it");
  assertEdgeExtrude(made, `${device}: as made`);
  await shot(a, `edge-${device}-0-before`);
  // The copy of r, the L's far end: pulled across, it must take every copy and every base with it.
  const far = made.pairs.find((p) => len(sub(p[0], [30, 20, 0])) < 1e-9)!;
  const at = await a.screenOf(far[1]);
  if (device === "mouse") {
    const [from, to] = [await a.at(...at), await a.at(at[0] + 50, at[1] + 30)];
    await a.page.mouse.move(from.x, from.y, { steps: 3 });
    await a.page.waitForTimeout(80);
    await a.page.mouse.down();
    await a.page.mouse.move(to.x, to.y, { steps: 10 });
    await a.page.mouse.up();
  } else {
    const hand = await fingers(a);
    await a.at(...at);
    await hand.drag(at, [at[0] + 40, at[1] + 20], 12);
  }
  await a.page.waitForTimeout(500);
  await shot(a, `edge-${device}-1-after`);
  const after = (await edges(a))!;
  const moved = after.pairs.find((p) => p[3] === far[3])![1];
  assert.ok(len(sub(moved, far[1])) > 1, `${device}: the copy's corner moved: ${JSON.stringify(far[1])} → ${JSON.stringify(moved)}`);
  assertEdgeExtrude(after, `${device}: after the copy's corner was dragged`);
  assert.match(await a.status(), /SOLVED/);
  await assertNothingOrange(a, `${device} edge`);
  assert.deepEqual(a.pageErrors, []);
}

test("by mouse: the edge tool on an L of two lines, a copy's corner dragged — one chord, square, the depth long, SOLVED", () =>
  withApp({}, (a) => edgeCase(a, "mouse")));

test("on an iPhone 13, by finger: the edge tool on an L, a copy's corner dragged — one chord, square, SOLVED", () =>
  withApp({ device: "iPhone 13" }, (a) => edgeCase(a, "iPhone")));
