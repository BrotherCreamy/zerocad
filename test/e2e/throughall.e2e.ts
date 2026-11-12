// Through all is a relation (docs/plans/through-all-relation.md; review item 8,
// the owner: *"correct relationships BETWEEN entities … bidirectional
// relationships everywhere by default"*, *"I should be able to pull on
// anything"*), in the browser: a plate drawn and extruded with the tools, a
// circle on its top cut Through all from the Cut tool's end row — the relation
// `e2_through` listed, its mark on the far vertex and on the cut's own far
// rim, the lid on the plate's far face; the plate set deeper and a corner of
// it dragged, the cut still through; a depth dimension typed against it, a
// CONFLICT that names the relation; Up to face picked on a block's lid; and a
// cut through a revolve, whose label says "through (placed)" because a round
// far side has no vertex to hold. By mouse and on an iPhone 13 by finger. Set
// NEOCAD_E2E_SHOTS to keep the pictures (docs/images/510–524); look at them.

import { test } from "node:test";
import assert from "node:assert/strict";
import { existsSync, mkdirSync } from "node:fs";
import { join } from "node:path";
import { openApp, confirmAndRelease, type AppContext } from "./harness.ts";
import { fingers } from "./fingers.ts";

const built = existsSync(new URL("../../src/solids/smlib-gen/smlib.mjs", import.meta.url));
const skip = built ? false : "no SMLib build — run `npm run build:solids`";

const SHOTS = process.env.NEOCAD_E2E_SHOTS;

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
  // Clear of the drawing, so no hover tag is in the picture, and time for the faces to settle.
  await a.page.mouse.move(6, 420);
  await a.page.waitForTimeout(600);
  await a.page.screenshot({ path: join(SHOTS, `${name}.png`) });
}

type Neo = { __neocad: {
  model: {
    features: Map<string, { kind: string; extent?: string; upto?: string; depth: string; loops: (string | { name: string })[][]; twins: string[][] }>;
    relations: Map<string, { name: string; op: string; args: unknown[]; blocks: unknown[] }>;
    entities: Map<string, { kind: string; name: string; refs?: string[]; center?: string }>;
    coords(p: string): number[];
    journal: { op: string; args: unknown[] }[];
  };
  engine: { glyphs(): { relation: string; symbol: string; screen: [number, number]; isLabel: boolean; highlights: string[] }[] };
  bodies: { settled: boolean; views(): { features: string[]; result: { solid: { volume: number; validity: { manifold: boolean; failures: number }; faces: { name: string }[] } | null } }[] };
} };

const state = (a: AppContext) => a.page.evaluate(() => {
  const m = (window as never as Neo).__neocad.model;
  const features: Record<string, { extent: string | null; upto: string | null; depth: string; lidPoint: string | null }> = {};
  for (const [name, f] of m.features) {
    const t = f.twins[0]?.[0];
    const e = t ? m.entities.get(t) : undefined;
    const lidPoint = e ? (e.kind === "circle" || e.kind === "arc" ? e.center! : e.refs?.[0] ?? null) : null;
    features[name] = { extent: f.extent ?? null, upto: f.upto ?? null, depth: f.depth, lidPoint };
  }
  return {
    features,
    relations: [...m.relations.values()].map((r) => ({ name: r.name, op: r.op, args: r.args, rows: r.blocks.length })),
    points: Object.fromEntries([...m.entities.values()].filter((e) => e.kind === "point").map((e) => [e.name, m.coords(e.name)])),
    journal: m.journal.map((j) => j.op),
    lastOptions: m.journal.filter((j) => j.op === "extrude").at(-1)?.args.at(-1) ?? null,
  };
});
type State = Awaited<ReturnType<typeof state>>;

const glyphs = (a: AppContext) => a.page.evaluate(() => (window as never as Neo).__neocad.engine.glyphs());

/** How a feature's end reads on its depth's label (`endLabel`, model.ts) — asked of the model, since the label itself may be behind a face this view. */
const endLabelOf = (a: AppContext, feature: string) => a.page.evaluate(async (feature) => {
  const [modelPath] = ["/src/model.ts"];
  const { endLabel } = await import(modelPath);
  const m = (window as never as Neo).__neocad.model;
  return endLabel(m, m.features.get(feature)) as string | null;
}, feature);

/**
 * The bodies as the kernel last answered — once it has answered for
 * `feature`, where one is named: `settled` is still true from the body
 * before while the new program is on its way (seen under load: the plate's
 * body with no cut in it, read a moment after ✓).
 */
async function bodies(a: AppContext, feature?: string) {
  await a.page.waitForFunction((f) => {
    const b = (window as never as Neo).__neocad.bodies;
    return b.settled && (f === undefined || b.views().some((v) => v.features.includes(f)));
  }, feature, { timeout: 60_000 });
  return a.page.evaluate(() => (window as never as Neo).__neocad.bodies.views().map((v) => ({
    features: v.features, volume: v.result.solid?.volume ?? null,
    valid: !!v.result.solid && v.result.solid.validity.manifold && v.result.solid.validity.failures === 0,
    faces: v.result.solid ? [...new Set(v.result.solid.faces.map((f) => f.name))].sort() : [],
  })));
}

/** A hand: the mouse, or a finger on the iPhone — the same gestures, each as its device makes them. */
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
      click: async (at) => { const c = await a.at(...at); await a.page.mouse.move(c.x, c.y, { steps: 3 }); await a.page.waitForTimeout(80); await a.page.mouse.click(c.x, c.y); await a.page.waitForTimeout(300); },
      drag: async (from, to) => {
        const [p, q] = [await a.at(...from), await a.at(...to)];
        await a.page.mouse.move(p.x, p.y, { steps: 3 });
        await a.page.waitForTimeout(80);
        await a.page.mouse.down();
        await a.page.mouse.move(q.x, q.y, { steps: 12 });
        await a.page.mouse.up();
        await a.page.waitForTimeout(500);
      },
      confirm: () => confirmAndRelease(a),
    };
  }
  const f = await fingers(a);
  return {
    device,
    click: async (at) => { await a.at(...at); await f.tap(at[0], at[1]); await a.page.waitForTimeout(450); },
    drag: async (from, to) => { await a.at(...from); await f.drag(from, to, 12); await a.page.waitForTimeout(500); },
    confirm: async () => { await a.page.tap("#options .oact button.ok"); await a.page.waitForTimeout(400); },
  };
}

/** Types a command and leaves the canvas with the keys — a phone's keyboard put away. */
async function say(a: AppContext, source: string): Promise<void> {
  await a.type(source);
  await a.page.evaluate(() => (document.activeElement as HTMLElement | null)?.blur());
  await a.page.waitForTimeout(200);
}

const T = 10;
/** The plate's half sides; a rectangle the tools draw on the ground, extruded the default depth. */
const [PW, PH] = [25, 15];

/**
 * The owner's drawing: a rectangle drawn with the tool, extruded with the
 * tool, looked at from a corner; a circle drawn on its top and cut Through all
 * from the Cut tool's end row.
 */
async function plateWithHole(a: AppContext, hand: Hand): Promise<State> {
  await say(a, 'arm("rectangle")');
  await hand.drag(await a.screenOf([-PW, -PH, 0]), await a.screenOf([PW, PH, 0]));
  await say(a, 'arm("extrude")');
  await hand.click(await a.screenOf([8, 5, 0]));
  await hand.confirm();
  // A circle on the lid, with the sketch tool on it as the owner draws one.
  await say(a, 'arm("sketch")');
  await hand.click(await a.screenOf([-15, 8, T]));
  await say(a, 'arm("circle")');
  await hand.drag(await a.screenOf([0, 0, T]), await a.screenOf([4, 0, T]));
  await say(a, 'arm("cut")');
  await hand.click(await a.screenOf([0, 0, T]));
  // The end condition, a drop-down where the depth's label is.
  assert.equal(await a.page.$eval('#options select.obeside[data-option="end"]', (x) => (x as HTMLSelectElement).value), "blind");
  await a.page.selectOption('#options select.obeside[data-option="end"]', "through");
  await a.page.waitForTimeout(350);
  await hand.confirm();
  await say(a, "workplane(null)");
  // From above and to one side, once the sketch has let the view go: the lid, two walls, and the far corner.
  await say(a, "orbit(0, -1.0); orbit(-0.8, 0)" + (hand.device === "mouse" ? "; zoom(1.4)" : ""));
  await say(a, 'arm("select")');
  const s = await state(a);
  const cut = Object.keys(s.features).find((n) => s.features[n].extent === "through");
  assert.ok(cut, `a through cut was made — log: ${(await a.log()).slice(-600)}`);
  return s;
}

/** How far a point stands off the plane of the plate's base — its first three corners, wherever a drag has taken the plate. */
function offBase(s: State, q: string): number {
  const [A, B, C] = ["p1", "p2", "p3"].map((n) => s.points[n]);
  const sub = (u: number[], v: number[]) => u.map((x, i) => x - v[i]);
  const u = sub(B, A), v = sub(C, A);
  const n = [u[1] * v[2] - u[2] * v[1], u[2] * v[0] - u[0] * v[2], u[0] * v[1] - u[1] * v[0]];
  const len = Math.hypot(...n);
  return Math.abs(sub(s.points[q], A).reduce((acc, x, i) => acc + (x * n[i]) / len, 0));
}

/** The far vertex and the lid of a through cut, as the model holds them. */
function throughOf(s: State, cut: string): { relation: string; far: string; lid: string } {
  const r = s.relations.find((x) => x.name === `${cut}_through`);
  assert.ok(r, `${cut}_through is a relation: ${s.relations.map((x) => x.name).join(" ")}`);
  assert.equal(r.op, "onPlane");
  assert.equal(r.args[1], `${cut}.lid`);
  return { relation: r.name, far: r.args[0] as string, lid: s.features[cut].lidPoint! };
}

/** The through cut: the relation listed and marked at both ends, the lid on the plate's far face; set deeper, it follows; a corner dragged, it is still through. */
async function throughCut(a: AppContext, hand: Hand, pictures: { made: string; deeper: string; dragged: string; conflict: string }): Promise<void> {
  let s = await plateWithHole(a, hand);
  const cut = Object.keys(s.features).find((n) => s.features[n].extent === "through")!;
  const { relation, far, lid } = throughOf(s, cut);
  // Held on a corner of the plate's base — the far side of what it goes through — and the lid is there, not a tenth past.
  assert.ok(Math.abs(s.points[far][2]) < 1e-6, `the far vertex on the ground: ${far} at ${s.points[far]}`);
  assert.ok(Math.abs(s.points[lid][2]) < 1e-6, `the cut's lid on the plate's base: ${s.points[lid]}`);
  assert.deepEqual((s.lastOptions as { end: string; to: string }).to, far, "journalled with the far vertex it found");
  // Marked on the far vertex (and on the cut's own far rim, which from above
  // is under the plate's base, so that mark is behind a face and not drawn).
  const marks = (await glyphs(a)).filter((g) => g.relation === relation);
  assert.ok(marks.length >= 1 && marks.every((g) => g.symbol === "▱"), `marked: ${JSON.stringify(marks)}`);
  assert.ok(marks.some((g) => g.highlights.includes(far)), "the mark on the far vertex");
  // The depth's label says how it ends, and the body is a hole right through.
  assert.equal(await endLabelOf(a, cut), "through all");
  let [b] = await bodies(a, cut);
  assert.ok(b.valid && b.faces.includes(`${cut}.m0`) && !b.faces.includes(`${cut}.lid`), `a hole right through: ${b.faces}`);
  assert.match(await a.status(), /SOLVED/);
  await shot(a, pictures.made);

  // The plate twice as deep: the far vertex moves nowhere (the plate grows up
  // from the ground), the cut's base rides up with the top, and the lid stays
  // on the far face — the relation, not a number.
  await say(a, 'set("d1.value", 20)');
  s = await state(a);
  assert.ok(Math.abs(s.points[lid][2]) < 1e-6, `still on the base: ${s.points[lid]}`);
  [b] = await bodies(a);
  assert.ok(b.valid && !b.faces.includes(`${cut}.lid`), `still through: ${b.faces}`);
  assert.match(await a.status(), /SOLVED/);
  await shot(a, pictures.deeper);

  // A corner of the plate's top dragged along the ground — the plate resized,
  // the hole and its relation along with it.
  const corner = Object.entries(s.points).find(([, at]) => Math.abs(at[0] - PW) < 1e-6 && Math.abs(at[1] - PH) < 1e-6 && Math.abs(at[2] - 20) < 1e-6)?.[0];
  assert.ok(corner, "the plate's top corner");
  const from = await a.screenOf(s.points[corner]);
  const to = await a.screenOf([PW + 12, PH + 6, 20]);
  await hand.drag(from, to);
  s = await state(a);
  const moved = Math.hypot(s.points[corner][0] - PW, s.points[corner][1] - PH);
  assert.ok(moved > 3, `the corner came: ${s.points[corner]}`);
  assert.ok(offBase(s, lid) < 1e-6, `the lid still on the base after the drag (the plate may have turned: nothing holds it to the ground): ${offBase(s, lid)}`);
  assert.match(await a.status(), /SOLVED/);
  await shot(a, pictures.dragged);

  // A depth dimension of a person's own against it: the cut 15 deep through a plate 20 thick.
  const pairs = s.relations.find((r) => r.name === s.features[cut].depth)!.args.slice(2) as string[];
  await say(a, `dist("${pairs[0]}", "${pairs[1]}", 15)`);
  const status = await a.status();
  assert.match(status, /CONFLICT/, `a conflict: ${status}`);
  assert.ok(status.includes(relation) || (await a.log()).includes(relation), `${relation} named: ${status}`);
  await shot(a, pictures.conflict);
  assert.deepEqual(a.pageErrors, []);
}

/** Up to face: a boss on the plate extruded up to a taller block's lid, by the tool's end row and one press on that face. */
async function upToFace(a: AppContext, hand: Hand, pictures: { held: string }): Promise<void> {
  await say(a, 'arm("rectangle")');
  await hand.drag(await a.screenOf([-PW, -PH, 0]), await a.screenOf([PW, PH, 0]));
  await say(a, 'arm("extrude")');
  await hand.click(await a.screenOf([8, 5, 0]));
  await hand.confirm();
  // The block beside it, three times as tall.
  await say(a, 'arm("rectangle")');
  await hand.drag(await a.screenOf([PW + 10, -PH, 0]), await a.screenOf([PW + 30, PH, 0]));
  await say(a, 'arm("extrude", { depth: 30 })');
  await hand.click(await a.screenOf([PW + 20, 0, 0]));
  await hand.confirm();
  // A circle on the plate's top, extruded up to the block's lid.
  await say(a, 'arm("sketch")');
  await hand.click(await a.screenOf([-15, 8, T]));
  await say(a, 'arm("circle")');
  await hand.drag(await a.screenOf([0, 0, T]), await a.screenOf([4, 0, T]));
  await say(a, 'arm("extrude", { depth: 5 })');
  await hand.click(await a.screenOf([0, 0, T]));
  await a.page.selectOption('#options select.obeside[data-option="end"]', "upto");
  await a.page.waitForTimeout(350);
  // One more press, on the face it ends on: the block's lid.
  await hand.click(await a.screenOf([PW + 20, 0, 30]));
  await hand.confirm();
  await say(a, "workplane(null)");
  await say(a, "orbit(0, -1.0); orbit(-0.8, 0)");
  await say(a, 'arm("select")');
  const s = await state(a);
  const boss = Object.keys(s.features).find((n) => s.features[n].extent === "upto");
  assert.ok(boss, `a boss up to a face — log: ${(await a.log()).slice(-800)}`);
  assert.equal(s.features[boss].upto, "e2.lid");
  const r = s.relations.find((x) => x.name === `${boss}_upto`);
  assert.ok(r && r.op === "onPlane" && r.args[1] === "e2.lid", `${boss}_upto holds the lid point on the block's lid: ${JSON.stringify(r)}`);
  assert.ok(Math.abs(s.points[s.features[boss].lidPoint!][2] - 30) < 1e-6, `the boss's lid at the block's: ${s.points[s.features[boss].lidPoint!]}`);
  assert.equal(await endLabelOf(a, boss), "up to e2.lid");
  // The block set taller: the boss follows.
  await say(a, 'set("d2.value", 36)');
  const t = await state(a);
  assert.ok(Math.abs(t.points[t.features[boss].lidPoint!][2] - 36) < 1e-6, `the boss up to the taller block: ${t.points[t.features[boss].lidPoint!]}`);
  assert.match(await a.status(), /SOLVED/);
  const [plateBody] = await bodies(a, boss);
  assert.ok(plateBody.valid && plateBody.features.includes(boss), `the boss added to the plate's body: ${JSON.stringify(plateBody)}`);
  await shot(a, pictures.held);
  assert.deepEqual(a.pageErrors, []);
}

/** A cut through a revolve: placed where the measure says, said so, and labelled "through (placed)". */
async function throughRevolve(a: AppContext, hand: Hand, pictures: { placed: string }): Promise<void> {
  // A rod along x: a 40 × 8 rectangle on the ground turned about its own long edge.
  const names = await a.repl('[pt(-20, 0), pt(20, 0), pt(20, 8), pt(-20, 8)]') as { value: string[] };
  const [p1, p2, p3, p4] = names.value;
  const lines = await a.repl(`[ln("${p1}", "${p2}"), ln("${p2}", "${p3}"), ln("${p3}", "${p4}"), ln("${p4}", "${p1}")]`) as { value: string[] };
  await say(a, `revolve("${lines.value[1]}", "${lines.value[0]}")`);
  // A circle 20 above the rod's axis, facing down, cut through all: the rod's far side is round.
  const c = (await a.repl("pt(0, 0, 20)")).value as string;
  const circle = (await a.repl(`circ("${c}", 3, "origin")`)).value as string;
  await say(a, `extrude("${circle}", -1, { mode: "cut", into: "e1", end: "through" })`);
  await say(a, "orbit(0, -1.0); orbit(-0.8, 0)" + (hand.device === "mouse" ? "; zoom(1.3)" : ""));
  const s = await state(a);
  const cut = Object.keys(s.features).find((n) => s.features[n].extent === "through");
  assert.ok(cut, `a through cut — log: ${(await a.log()).slice(-600)}`);
  assert.ok(!s.relations.some((r) => r.name === `${cut}_through`), "nothing claims to hold it: the rod's far side has no vertex");
  // Placed: twenty down to the axis, eight more to the far side, and a tenth of that past.
  const depth = s.relations.find((r) => r.name === s.features[cut].depth)!.args[1] as number;
  assert.ok(Math.abs(depth + 30.8) < 0.1, `placed at ${depth}`);
  assert.equal(typeof (s.lastOptions as { to: unknown }).to, "number", "journalled with the depth it was placed at");
  assert.equal(await endLabelOf(a, cut), "through (placed)");
  assert.match(await a.log(), /through e1 as it stands — a round far side is not held; set the end again after changing it/);
  assert.match(await a.status(), /SOLVED/);
  // And the kernel cuts it: a hole down through the rod, no cap.
  const [b] = await bodies(a, cut);
  assert.ok(b.valid && b.faces.includes(`${cut}.m0`) && !b.faces.includes(`${cut}.lid`), `a hole through the rod: ${b.faces}`);
  await shot(a, pictures.placed);
  assert.deepEqual(a.pageErrors, []);
}

// --- by mouse ------------------------------------------------------------------------

test("by mouse: a circle on the plate cut Through all — the relation listed and marked, the lid on the far face; the plate set deeper and a corner dragged, still through; a dimension against it, a conflict that names it", { skip }, () =>
  withApp({}, async (a) => throughCut(a, await handOf(a, "mouse"), {
    made: "510-the-through-cut-its-relation-marked-on-the-far-corner-and-the-far-rim",
    deeper: "511-the-plate-set-deeper-the-cut-follows",
    dragged: "512-a-plate-corner-dragged-the-cut-still-through",
    conflict: "513-a-depth-dimension-against-it-the-conflict-names-the-relation",
  })));

test("by mouse: Up to face — a boss extruded up to a taller block's lid by the end row and one press on that face, held both ways", { skip }, () =>
  withApp({}, async (a) => upToFace(a, await handOf(a, "mouse"), { held: "514-up-to-face-the-boss-held-to-the-blocks-lid" })));

test("by mouse: a cut through a revolve is placed, said, and labelled through (placed)", { skip }, () =>
  withApp({}, async (a) => throughRevolve(a, await handOf(a, "mouse"), { placed: "515-through-a-revolve-placed-not-held" })));

// --- on an iPhone 13, by finger ----------------------------------------------------------

test("on an iPhone 13, by finger: the through cut, the plate set deeper and a corner dragged, and the conflict", { skip }, () =>
  withApp({ device: "iPhone 13" }, async (a) => throughCut(a, await handOf(a, "iPhone"), {
    made: "516-iphone-the-through-cut-its-relation-marked",
    deeper: "517-iphone-the-plate-set-deeper-the-cut-follows",
    dragged: "518-iphone-a-plate-corner-dragged-the-cut-still-through",
    conflict: "519-iphone-a-depth-dimension-against-it-the-conflict",
  })));

test("on an iPhone 13, by finger: Up to face by the end row and one tap on the block's lid", { skip }, () =>
  withApp({ device: "iPhone 13" }, async (a) => upToFace(a, await handOf(a, "iPhone"), { held: "520-iphone-up-to-face-the-boss-held-to-the-blocks-lid" })));

test("on an iPhone 13: a cut through a revolve is placed and says so", { skip }, () =>
  withApp({ device: "iPhone 13" }, async (a) => throughRevolve(a, await handOf(a, "iPhone"), { placed: "521-iphone-through-a-revolve-placed-not-held" })));
