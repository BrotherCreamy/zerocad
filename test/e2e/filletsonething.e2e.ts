// A fillet is one thing, in the real app, by mouse and on an iPhone 13 by
// finger (docs/plans/fillets-one-thing.md). The owner: *"adding them to the
// originating chain/loop of a region of a body shouldn't break the body … adding
// a 2d fillet to the originating chain of a region of a body should produce an
// identical outcome to 3d filleting that edge … the previous geometry should
// not be deleted … it should be made into construction geometry. Note:
// anything can be construction."*
//
// Each test draws a rectangle with the tool and extrudes it with the tool —
// the owner's drawing — and then: rounds a corner with the fillet tool and
// looks at the body, the construction lines and the other profile; types the
// same fillet as the solid's edge fillet in a second app and compares the two
// models; bevels a lid corner and finds it made on the base; makes a point and
// then the body construction and reads the inks off the picture; chamfers a
// lid rim with the kernel and is refused a sketch on that face; puts a boss on
// the lid and rounds the base's corner through both.
//
// Set NEOCAD_E2E_SHOTS to keep the pictures (docs/images/490–504); look at them.

import { test } from "node:test";
import assert from "node:assert/strict";
import { existsSync, mkdirSync } from "node:fs";
import { join } from "node:path";
import { openApp, confirmAndRelease, type AppContext } from "./harness.ts";
import { fingers } from "./fingers.ts";

const SHOTS = process.env.NEOCAD_E2E_SHOTS;
const built = existsSync(new URL("../../src/solids/smlib-gen/smlib.mjs", import.meta.url));
const skip = built ? false : "no SMLib build — run `npm run build:solids`";

async function withApp(options: Parameters<typeof openApp>[0], body: (a: AppContext) => Promise<void>): Promise<void> {
  const a = await openApp(options);
  try {
    await body(a);
  } finally {
    await a.close();
  }
}

async function shot(a: AppContext, name: string): Promise<void> {
  if (!SHOTS) return;
  mkdirSync(SHOTS, { recursive: true });
  await a.page.mouse.move(6, 420);
  await a.page.waitForTimeout(500);
  await a.page.screenshot({ path: join(SHOTS, `${name}.png`) });
}

type Feature = { open?: boolean; loops: (string | { name: string })[][]; twins: string[][]; walls: string[]; aside?: string[]; construction?: true; depth: string };
type Neo = { __neocad: {
  model: {
    features: Map<string, Feature>;
    blends: Map<string, { name: string; edges: string[] }>;
    relations: Map<string, { name: string; op: string; args: unknown[]; twin?: { of: string } }>;
    entities: Map<string, { kind: string; name: string; refs?: string[] }>;
    journal: { op: string; args: unknown[] }[];
    coords(p: string): number[];
    isConstruction(n: string): boolean;
  };
  bodies: { settled: boolean; views(): { name: string; features: string[]; result: { solid: { volume: number; validity: { manifold: boolean; failures: number }; faces: { name: string }[] } | null } }[] };
} };

/** The model as one thing another app's can be compared with, and as a test reads it. */
const state = (a: AppContext) => a.page.evaluate(() => {
  const m = (window as never as Neo).__neocad.model;
  const f = m.features.get("e1");
  return {
    feature: f ? { open: f.open === true, loops: f.loops.map((l) => l.map((x) => (typeof x === "string" ? x : x.name))), twins: f.twins, walls: f.walls,
      aside: f.aside ?? [], construction: f.construction === true, depth: f.depth } : null,
    entities: [...m.entities.values()].map((e) => [e.name, e.kind, e.refs ?? null, m.isConstruction(e.name)] as const),
    relations: [...m.relations.values()].map((r) => [r.name, r.op, r.args, r.twin?.of ?? null] as const),
    blends: [...m.blends.values()].map((b) => [b.name, b.edges] as const),
    journal: m.journal,
    points: Object.fromEntries([...m.entities.values()].filter((e) => e.kind === "point").map((e) => [e.name, m.coords(e.name)])),
    lines: [...m.entities.values()].filter((e) => e.kind === "line").map((e) => ({ name: e.name, refs: e.refs!, at: e.refs!.map((p) => m.coords(p)) })),
  };
});
type State = Awaited<ReturnType<typeof state>>;

/** The kernel's bodies once it has answered for the model as it is. */
async function settled(a: AppContext): Promise<{ name: string; features: string[]; volume: number; valid: boolean; faces: string[] }[]> {
  await a.page.waitForFunction(() => (window as never as Neo).__neocad.bodies.settled, undefined, { timeout: 30_000 });
  return a.page.evaluate(() => (window as never as Neo).__neocad.bodies.views().filter((v) => v.result.solid).map((v) => ({
    name: v.name, features: v.features, volume: v.result.solid!.volume,
    valid: v.result.solid!.validity.manifold && v.result.solid!.validity.failures === 0,
    faces: [...new Set(v.result.solid!.faces.map((f) => f.name))].sort(),
  })));
}

const sub = (p: number[], q: number[]) => p.map((x, i) => x - q[i]);
const len = (p: number[]) => Math.hypot(...p);
const mid = (p: number[], q: number[]) => p.map((x, i) => (x + q[i]) / 2);
/** A filleted straight edge of length `l` removes (4 − π)/4 · r² · l. */
const filletCut = (r: number, l: number) => ((4 - Math.PI) / 4) * r * r * l;

interface Hand {
  device: "mouse" | "iPhone";
  click(at: [number, number]): Promise<void>;
  drag(from: [number, number], to: [number, number]): Promise<void>;
  confirm(): Promise<void>;
}

async function handOf(a: AppContext, device: Hand["device"]): Promise<Hand> {
  if (device === "mouse") {
    return {
      device,
      click: async (at) => { const c = await a.at(...at); await a.page.mouse.click(c.x, c.y); await a.page.waitForTimeout(250); },
      drag: async (from, to) => {
        const [p, q] = [await a.at(...from), await a.at(...to)];
        await a.page.mouse.move(p.x, p.y, { steps: 3 });
        await a.page.waitForTimeout(80);
        await a.page.mouse.down();
        await a.page.mouse.move(q.x, q.y, { steps: 10 });
        await a.page.mouse.up();
        await a.page.waitForTimeout(450);
      },
      confirm: () => confirmAndRelease(a),
    };
  }
  const f = await fingers(a);
  return {
    device,
    click: async (at) => { await a.at(...at); await f.tap(at[0], at[1]); await a.page.waitForTimeout(400); },
    drag: async (from, to) => { await a.at(...from); await f.drag(from, to, 12); await a.page.waitForTimeout(450); },
    confirm: async () => { await a.page.tap("#options .oact button.ok"); await a.page.waitForTimeout(350); },
  };
}

/** Types a command and leaves the canvas with the keys — a phone's keyboard put away. */
async function say(a: AppContext, source: string): Promise<void> {
  await a.type(source);
  await a.page.evaluate(() => (document.activeElement as HTMLElement | null)?.blur());
  await a.page.waitForTimeout(150);
}

/** The status's counts — `2 free · 4 agreeing` — without the verdict, which fades. */
const counts = (status: string) => status.replace(/SOLVED/, "").replace(/\s+/g, " ").trim();

/** The last lines of the log, for a failure's message. */
const said = async (a: AppContext) => (await a.log()).split("\n").slice(-5).join(" / ");

/** Nothing conflicts, nothing is thrown, and the status says solved. */
async function assertQuiet(a: AppContext, what: string): Promise<void> {
  const d = await a.page.$eval("#diagnosis", (el) => ({ cls: el.className, text: el.textContent ?? "" }));
  assert.notEqual(d.cls, "conflict", `${what}: no conflict (${d.text})`);
  assert.match(await a.status(), /SOLVED/, what);
  assert.deepEqual(a.pageErrors, [], what);
}

/**
 * The owner's drawing: a 50 × 30 rectangle drawn with the tool, held where it
 * is (a corner, a direction, the ground under the far corner), extruded 10
 * with the tool, looked at from above and to one side. By mouse the hidden
 * view, so the base under the solid and its construction lines are in the
 * picture; the phone keeps the shaded view it opens in.
 */
async function block(a: AppContext, hand: Hand): Promise<State> {
  await say(a, 'arm("rectangle")');
  await hand.drag(await a.screenOf([-25, -15, 0]), await a.screenOf([25, 15, 0]));
  const drawn = await state(a);
  const bottom = drawn.lines.find((l) => Math.abs(l.at[0][1] + 15) < 1e-6 && Math.abs(l.at[1][1] + 15) < 1e-6)!;
  const far = Object.entries(drawn.points).find(([, c]) => Math.abs(c[0] - 25) < 1e-6 && Math.abs(c[1] - 15) < 1e-6)![0];
  await say(a, `fix("${bottom.refs[0]}", [${drawn.points[bottom.refs[0]].join(", ")}]); par("${bottom.name}", "origin.x"); onplane("${far}", "origin")`);
  await say(a, 'arm("extrude")');
  // The region under the click; a tap a loaded machine dropped is made again.
  for (let tries = 0; tries < 3; tries++) {
    await hand.click(await a.screenOf([8, 5, 0]));
    const armed = await a.page.waitForSelector("#options .oact button.ok:not([disabled])", { timeout: 2500 }).then(() => true, () => false);
    if (armed) break;
  }
  await hand.confirm();
  await say(a, hand.device === "mouse" ? 'orbit(0, -1.0); orbit(-0.8, 0); zoom(1.4); view("hidden")' : "orbit(0, -1.0); orbit(-0.8, 0)");
  await say(a, 'arm("select")');
  const s = await state(a);
  assert.ok(s.feature && s.feature.loops[0].length === 4, "e1 made");
  await assertQuiet(a, "the block");
  return s;
}

/** The base's line from `p` to `q` (either way round), as the state has it. */
const lineBetween = (s: State, p: number[], q: number[]) => s.lines.find((l) => l.at.every((c) => len(sub(c, p)) < 1e-6 || len(sub(c, q)) < 1e-6) && l.at.length === 2)!;

/**
 * A click that gives the fillet tool a line — along it, clear of the marks on
 * its middle and its corners, trying a few places until the tool has it.
 */
async function pickLeg(a: AppContext, hand: Hand, line: string, ends: number[][]): Promise<void> {
  const picked = () => a.page.evaluate(() => ((window as never as { __neocad: { engine: { active: { lines?: string[] } | null } } }).__neocad.engine.active?.lines ?? []));
  for (const t of [0.3, 0.7, 0.2, 0.8, 0.4, 0.6]) {
    await hand.click(await a.screenOf(ends[0].map((c, i) => c + t * (ends[1][i] - c))));
    if ((await picked()).includes(line)) return;
  }
  assert.fail(`${line} could not be given to the tool along its length — it has ${await picked()}: ${await said(a)}`);
}

/** The kernel's bodies: a body of one extrude is drawn by the app itself until a tool on kernel edges is armed, so one is, and let go. */
async function kernelBodies(a: AppContext): Promise<Awaited<ReturnType<typeof settled>>> {
  await say(a, 'arm("round")');
  const bodies = await settled(a);
  await say(a, 'arm("select")');
  return bodies;
}

// --- the fillet tool on a corner of the solid's sketch ----------------------------------------

/**
 * What a fillet of the base's front-right corner leaves, checked whichever
 * way the corner was cut: the corner and its two lines kept as construction
 * on both profiles, the chord between the corners with them; two shorter
 * lines and an arc on each; the record on the rounded loop; the body one
 * valid solid with five walls, its volume the block's less the corner.
 */
async function assertRounded(a: AppContext, made: State, s: State, r: number, what: string): Promise<void> {
  const f = s.feature!;
  assert.equal(f.loops[0].length, 5, `${what}: the rounded loop — ${await said(a)}`);
  assert.equal(f.aside.length, 7, `${what}: two lines and their twins, the corner and its twin, the chord — ${f.aside}`);
  const flagged = s.entities.filter(([, , , c]) => c).map(([n]) => n);
  for (const n of f.aside) assert.ok(flagged.includes(n), `${what}: ${n} is construction`);
  assert.equal(flagged.length, 7, `${what}: and nothing else is: ${flagged}`);
  // Nothing deleted: every entity the block had is still there, under its name.
  for (const [n] of made.entities) assert.ok(s.entities.some(([m]) => m === n), `${what}: ${n} still there`);
  // The corner is where it was, and its twin over it.
  const corner = f.aside.find((n) => s.entities.find(([m]) => m === n)![1] === "point")!;
  assert.ok(len(sub(s.points[corner], made.points[corner])) < 1e-6, `${what}: the corner did not move`);
  assert.ok(!f.open, `${what}: the body is not broken`);
  assert.equal(f.walls.length, 5);
  const twinArc = f.twins[0][f.loops[0].findIndex((n) => s.entities.find(([m]) => m === n)![1] === "arc")];
  assert.equal(s.entities.find(([m]) => m === twinArc)![1], "arc", `${what}: the lid is rounded too`);
  const bodies = await kernelBodies(a);
  const body = bodies.find((b) => b.name === "e1");
  assert.ok(body?.valid, `${what}: one valid body — ${JSON.stringify(bodies)}`);
  assert.ok(Math.abs(body!.volume - (50 * 30 * 10 - filletCut(r, 10))) < 1e-3, `${what}: volume ${body!.volume}`);
  assert.deepEqual(body!.faces, ["e1.base", "e1.lid", "e1.m0", "e1.m1", "e1.m2", "e1.m3", "e1.m4"], `${what}: five walls, no kernel blend`);
  assert.deepEqual(s.blends, [], `${what}: no kernel blend`);
  assert.equal(s.journal.filter((e) => e.op === "fillet").length, 1, `${what}: one journal entry`);
  assert.equal(s.journal.filter((e) => e.op === "filletEdges").length, 0, `${what}: the sketch's`);
}

async function filletByTool(a: AppContext, hand: Hand, pictures: { rounded: string; typed: string }): Promise<State> {
  const made = await block(a, hand);
  const before = await a.status();
  const R = 6;
  // The front-right corner: by mouse, the base's two lines picked one after the
  // other in the hidden view; by finger, the lid's corner point tapped — the
  // corner click takes both of its lines, and asked of the lid the fillet is
  // made on the base all the same.
  await say(a, `arm("fillet", { radius: ${R} })`);
  const front = lineBetween(made, [-25, -15, 0], [25, -15, 0]);
  const right = lineBetween(made, [25, -15, 0], [25, 15, 0]);
  if (hand.device === "mouse") {
    await pickLeg(a, hand, front.name, front.at);
    await pickLeg(a, hand, right.name, right.at);
  } else {
    const cornerBase = Object.entries(made.points).find(([, c]) => len(sub(c, [25, -15, 0])) < 1e-6)![0];
    const lidCorner = Object.entries(made.points).find(([, c]) => len(sub(c, [25, -15, 10])) < 1e-6)![0];
    assert.ok(cornerBase && lidCorner);
    await hand.click(await a.screenOf([25, -15, 10]));
  }
  await hand.confirm();
  await say(a, 'arm("select")');
  const s = await state(a);
  await assertRounded(a, made, s, R, `the fillet tool by ${hand.device}`);
  // The cut adds nothing free and nothing agreeing: the status counts what they counted before it.
  assert.equal(counts(await a.status()), counts(before), `the status's counts, ${await a.status()} for ${before}`);
  const entry = s.journal.find((e) => e.op === "fillet")!;
  assert.deepEqual(entry.args.slice(0, 3), [front.name, right.name, R], `made on the base, whichever profile it was picked on: ${JSON.stringify(entry.args)}`);
  await assertQuiet(a, "rounded");
  await shot(a, pictures.rounded);
  return s;
}

test("by mouse: the fillet tool on two lines of an extruded rectangle rounds the body and keeps the corner as construction on both profiles; the solid's edge fillet typed is the same model", { skip }, () =>
  withApp({}, async (a) => {
    const byTool = await filletByTool(a, await handOf(a, "mouse"), { rounded: "490-the-fillet-tool-on-a-base-corner-the-body-rounded-the-corner-kept-as-construction", typed: "" });
    // The other route, in a second app: the solid's edge between the two walls, by name.
    await withApp({}, async (b) => {
      const hand = await handOf(b, "mouse");
      const made = await block(b, hand);
      await say(b, 'fillet("e1", ["e1.m0|e1.m1"], 6)');
      const s = await state(b);
      await assertRounded(b, made, s, 6, "the edge fillet typed");
      const same = (x: State) => ({ entities: x.entities, relations: x.relations, feature: x.feature, blends: x.blends, journal: x.journal });
      assert.deepEqual(same(s), same(byTool), "indistinguishable: the same entities, relations, record and journal");
      await assertQuiet(b, "typed");
      await shot(b, "491-the-solids-edge-fillet-typed-the-same-model-entity-for-entity");
    });
  }));

test("on an iPhone 13, by finger: the fillet tool tapped on the lid's corner rounds the body — made on the base, both profiles construction at the corner", { skip }, () =>
  withApp({ device: "iPhone 13" }, async (a) => {
    await filletByTool(a, await handOf(a, "iPhone"), { rounded: "500-iphone-the-fillet-tool-on-the-lids-corner-the-body-rounded", typed: "" });
  }));

// --- the bevel tool on a lid corner ------------------------------------------------------------------

async function bevelLid(a: AppContext, hand: Hand, picture: string): Promise<void> {
  const made = await block(a, hand);
  await say(a, 'arm("bevel", { setback: 5 })');
  // The lid's back-left corner, tapped: its two lid edges, made on the base.
  await hand.click(await a.screenOf([-25, 15, 10]));
  await hand.confirm();
  await say(a, 'arm("select")');
  const s = await state(a);
  const f = s.feature!;
  assert.equal(f.loops[0].length, 5, `the loop has the chamfer's line — ${await said(a)}`);
  assert.equal(f.aside.length, 7);
  const cut = s.journal.find((e) => e.op === "chamfer")!;
  const back = lineBetween(made, [-25, 15, 0], [25, 15, 0]);
  const left = lineBetween(made, [-25, 15, 0], [-25, -15, 0]);
  assert.deepEqual([...(cut.args.slice(0, 2) as string[])].sort(), [back.name, left.name].sort(), `made on the base's two lines: ${JSON.stringify(cut.args)}`);
  assert.equal(cut.args[2], 5);
  const corner = Object.entries(made.points).find(([, c]) => len(sub(c, [-25, 15, 0])) < 1e-6)![0];
  assert.ok(len(sub(s.points[corner], [-25, 15, 0])) < 1e-6 && s.entities.find(([n]) => n === corner)![3], "the corner stays, construction");
  const bodies = await kernelBodies(a);
  assert.ok(bodies[0]?.valid && Math.abs(bodies[0].volume - (15000 - 12.5 * 10)) < 1e-3, `a 5 × 5 corner halved, 10 deep: ${JSON.stringify(bodies)}`);
  await assertQuiet(a, "bevelled");
  await shot(a, picture);
}

test("by mouse: the bevel tool on the lid's corner chamfers the base's corner too — the body cut, the corner kept", { skip }, () =>
  withApp({}, async (a) => bevelLid(a, await handOf(a, "mouse"), "492-the-bevel-tool-on-the-lids-corner-the-body-chamfered-both-profiles")));

test("on an iPhone 13, by finger: the bevel tool on the lid's corner", { skip }, () =>
  withApp({ device: "iPhone 13" }, async (a) => bevelLid(a, await handOf(a, "iPhone"), "501-iphone-the-bevel-tool-on-the-lids-corner")));

// --- anything can be construction ----------------------------------------------------------------------

async function constructionEverything(a: AppContext, hand: Hand, pictures: { point: string; body: string }): Promise<void> {
  const made = await block(a, hand);
  const lidCorner = Object.entries(made.points).find(([, c]) => len(sub(c, [25, -15, 10])) < 1e-6)![0];
  // A point: flagged with its partner, drawn as a ring, still held.
  await say(a, `construction("${lidCorner}")`);
  const s1 = await state(a);
  const flagged = s1.entities.filter(([, , , c]) => c).map(([n]) => n);
  const baseCorner = Object.entries(made.points).find(([, c]) => len(sub(c, [25, -15, 0])) < 1e-6)![0];
  assert.deepEqual(flagged.sort(), [lidCorner, baseCorner].sort(), "the lid's corner and its partner on the base");
  assert.equal(s1.feature!.loops[0].length, 4, "a construction point is a corner of the profile still: it bounds no edge in parts");
  await assertQuiet(a, "a construction point");
  await shot(a, pictures.point);
  // The body: its faces in the construction ink, its row saying so, left out of an export.
  const before = await a.pixel(...(await a.screenOf([8, 5, 10])), "faces");
  await say(a, 'construction("e1")');
  const s2 = await state(a);
  assert.equal(s2.feature!.construction, true);
  await a.page.waitForTimeout(400);
  const after = await a.pixel(...(await a.screenOf([8, 5, 10])), "faces");
  assert.ok(after[3] > 0 && before[3] > 0, `a face under the pixel both times: ${before} → ${after}`);
  assert.ok(after[1] > after[0] + 20 && after[1] > after[2], `the lid is drawn in the construction ink's teal now: ${after} (was ${before})`);
  const organiser = await a.page.evaluate(() => document.querySelector("#organiser")?.textContent ?? "");
  if (/e1/.test(organiser)) assert.match(organiser, /construction/, `the row says construction: ${organiser}`);
  const exported = await a.repl("exportStep()");
  assert.equal(exported.ok, false);
  assert.match(exported.error ?? "", /e1: construction/, "a construction body is not exported");
  await assertQuiet(a, "a construction body");
  await shot(a, pictures.body);
  await say(a, 'construction("e1", false)');
  assert.equal((await state(a)).feature!.construction, false);
  assert.equal((await a.repl("exportStep()")).ok, true, "and exported again");
}

test("by mouse: a point is construction with its partner, and a body is construction — drawn as reference, said in its row, not exported", () =>
  withApp({}, async (a) => constructionEverything(a, await handOf(a, "mouse"), {
    point: "493-a-construction-point-a-ring-on-both-profiles",
    body: "494-a-construction-body-drawn-as-reference",
  })));

test("on an iPhone 13: a construction point and a construction body", () =>
  withApp({ device: "iPhone 13" }, async (a) => constructionEverything(a, await handOf(a, "iPhone"), {
    point: "502-iphone-a-construction-point",
    body: "503-iphone-a-construction-body",
  })));

// --- review item 7: a kernel chamfer's face is not sketched on ---------------------------------------------

test("by mouse: the sketch tool on a kernel chamfer's face is refused, saying why; on the lid beside it, it sketches", { skip }, () =>
  withApp({}, async (a) => {
    const hand = await handOf(a, "mouse");
    await block(a, hand);
    await say(a, 'view("shaded"); chamfer("e1", ["e1.lid|e1.m0"], 4)');
    const bodies = await kernelBodies(a);
    assert.ok(bodies[0]?.faces.includes("e2.f0"), `the kernel's chamfer: ${JSON.stringify(bodies)}`);
    await say(a, 'arm("plane")');
    // The chamfer's face runs along the front of the lid, from y = −15 to −11 at the top, at 45°: its middle.
    await hand.click(await a.screenOf([0, -13, 8]));
    const log = await a.log();
    assert.match(log, /that face is e2's — a chamfer the solid kernel cut along an edge/, `refused, in words: ${await said(a)}`);
    const frames = (await state(a)).entities.filter(([, k]) => k === "frame").length;
    assert.equal(frames, 0, "no frame was made on the face");
    await hand.click(await a.screenOf([0, 5, 10]));
    assert.match(await a.log(), /workplane\(/, `the lid beside it is sketched on: ${await said(a)}`);
    await assertQuiet(a, "sketch on the lid");
    await shot(a, "495-a-kernel-chamfers-face-refused-as-a-sketch-plane-the-lid-taken");
  }));

// --- the hierarchy ----------------------------------------------------------------------------------------------

test("by mouse: a boss on the lid, then the base's corner rounded: the cut propagates through both bodies, nothing timeline-based", { skip }, () =>
  withApp({}, async (a) => {
    const hand = await handOf(a, "mouse");
    const made = await block(a, hand);
    await say(a, 'view("shaded"); arm("extrude", { depth: 6 })');
    await hand.click(await a.screenOf([8, 5, 10]));
    await hand.confirm();
    await say(a, 'arm("select")');
    const two = await state(a);
    const e2 = await a.page.evaluate(() => [...(window as never as Neo).__neocad.model.features.keys()]);
    assert.deepEqual(e2, ["e1", "e2"], `the boss: ${await said(a)}`);
    const before = await settled(a);
    assert.equal(before.length, 1, "one body of two features");
    const front = lineBetween(made, [-25, -15, 0], [25, -15, 0]);
    const right = lineBetween(made, [25, -15, 0], [25, 15, 0]);
    await say(a, `fillet("${front.name}", "${right.name}", 6)`);
    const s = await state(a);
    const regenerated = (s.journal.at(-1)!.args[4] as [string][]).map(([n]) => n);
    assert.deepEqual(regenerated, ["e1", "e2"], "both records brought into step, in one call");
    const g = await a.page.evaluate(() => { const f = (window as never as Neo).__neocad.model.features.get("e2")!; return { loops: f.loops.length ? f.loops[0].length : 0, aside: f.aside ?? [] }; });
    assert.equal(g.loops, 5, "e2's profile is rounded too");
    assert.equal(g.aside.length, 7, "the lid's lines and corner set aside on e2, as the base's on e1");
    const after = await settled(a);
    assert.ok(after[0]?.valid, `one valid body still: ${JSON.stringify(after)}`);
    assert.ok(Math.abs(after[0].volume - (before[0].volume - filletCut(6, 16))) < 1e-3, `rounded through 16 deep: ${after[0].volume} for ${before[0].volume}`);
    assert.ok(two.entities.every(([n]) => s.entities.some(([m]) => m === n)), "nothing deleted on either body");
    await assertQuiet(a, "rounded through both");
    await shot(a, "496-a-boss-on-the-lid-and-the-base-corner-rounded-through-both");
  }));
