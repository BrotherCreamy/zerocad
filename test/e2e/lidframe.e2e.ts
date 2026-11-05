// The owner's plate, in a browser: a rectangle drawn in a fresh model, a
// triangle inside it with the line tool, the extrude tool, a click in the
// plate, Enter — and, orbited, no point drawn on top of another. It used to be
// three: the lid frame's own points, the sketch frame's moved by the depth,
// landing on three lid corners, since a frameless sketch's frame is three of
// the outline's own corners — doubled labels, *"i'm getting a lot of
// overlapping points. why is this happening?"*
// (docs/plans/lid-frame-shares-points.md). Since format 11 there is no lid
// frame at all (docs/plans/no-lid-frame.md, and nolidframe.e2e.ts for the
// two-rectangle case that sharing could not fix), and since
// docs/plans/frameless-curves.md no sketch frame either — the plate lies on
// the origin's ground and runs along its +z — so this now reads: no frame at
// all, and still no point on another.
//
// Set NEOCAD_E2E_SHOTS to a directory to keep the screenshots; look at them —
// a doubled label is two names printed over each other at one dot.
//
// One app, tests in order: the states are cumulative.

import { test, before, after } from "node:test";
import assert from "node:assert/strict";
import { mkdirSync } from "node:fs";
import { join } from "node:path";
import { openApp, type AppContext } from "./harness.ts";

let app: AppContext;
before(async () => { app = await openApp(); });
after(async () => {
  assert.deepEqual(app.pageErrors, [], "nothing the page threw went uncaught");
  await app.close();
});

const SHOTS = process.env.NEOCAD_E2E_SHOTS;
async function shot(name: string): Promise<void> {
  if (!SHOTS) return;
  mkdirSync(SHOTS, { recursive: true });
  await app.page.mouse.move(2, 2); // no hover outline or tag in the picture
  await app.page.waitForTimeout(120);
  await app.page.screenshot({ path: join(SHOTS, `lidframe-${name}.png`) });
}

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
  await app.page.mouse.move(at.x, at.y, { steps: 3 });
  await app.page.waitForTimeout(100);
  await app.page.mouse.click(at.x, at.y);
  await app.page.waitForTimeout(250);
}

/**
 * Every two point entities drawn on one spot, as `a=b` — read off the live
 * model — split into the ones a `coincident` relation joins (a user's join:
 * the line tool closing the triangle back onto its first point makes a point
 * and joins it there, see below) and the ones nothing joins, which is what the
 * lid frame's own points were.
 */
async function coincident(): Promise<{ loose: string[]; joined: string[] }> {
  const { points } = await app.model();
  const joins = await app.page.evaluate(() => {
    const { model } = (window as never as { __neocad: { model: { relations: Map<string, { op: string; args: unknown[] }> } } }).__neocad;
    return [...model.relations.values()].filter((r) => r.op === "coincident").map((r) => `${r.args[0]}=${r.args[1]}`);
  });
  const names = Object.keys(points);
  const out = { loose: [] as string[], joined: [] as string[] };
  for (let i = 0; i < names.length; i++) {
    for (let j = i + 1; j < names.length; j++) {
      const [a, b] = [points[names[i]], points[names[j]]];
      if (Math.hypot(...a.map((x, k) => x - b[k])) >= 1e-6) continue;
      const pair = `${names[i]}=${names[j]}`;
      const joined = joins.includes(pair) || joins.includes(`${names[j]}=${names[i]}`);
      (joined ? out.joined : out.loose).push(pair);
    }
  }
  return out;
}

/** The sketch's one join: the triangle's closing click, a point of its own made on the first and joined to it. */
let closing = "";

/** The feature's lid frame (none, now), the plane it runs along, its point twins, every frame, and its corner count. */
const lid = (): Promise<{ top: string | null; frame: string; twins: string[]; frames: string[]; corners: number }> => app.page.evaluate(() => {
  const { model } = (window as never as { __neocad: { model: {
    features: Map<string, { top?: string; frame: string; depth: string; walls: string[] }>;
    relations: Map<string, { args: unknown[] }>;
    entities: Map<string, { kind: string; name: string }>;
  } } }).__neocad;
  const f = model.features.get("e1")!;
  const args = model.relations.get(f.depth)!.args as string[];
  const twins = args.filter((a, k) => k >= 3 && k % 2 === 1 && model.entities.get(a)?.kind === "point");
  const frames = [...model.entities.values()].filter((e) => e.kind === "frame").map((e) => e.name);
  return { top: f.top ?? null, frame: f.frame, twins, frames, corners: f.walls.length };
});

test("the owner's sequence: a rectangle, a triangle inside it, the region tool, the extrude tool, Enter — a plate with a hole", async () => {
  assert.equal((await app.model()).byKind.frame ?? 0, 0, "a fresh model has no frame");
  await app.type("rectangle");
  await leftDrag([440, 300], [700, 500]);
  await app.type("line");
  for (const p of [[520, 450], [620, 450], [570, 360], [520, 450]] as [number, number][]) await clickAt(...p);
  await app.page.press("#cmd", "Escape");
  await app.page.waitForTimeout(150);
  const drawn = await app.model();
  assert.equal(drawn.byKind.line, 4 + 3, "the rectangle and the triangle");
  assert.equal(drawn.byKind.frame ?? 0, 0, "and still no frame");
  await shot("1-sketch");
  // Not this package's, and left as the line tool has it (TODO.md): a click
  // snapped onto an existing point makes a point of its own there and joins
  // it, the chain's own first point included — so the triangle is four points,
  // two of them one corner, joined. The lid has one twin for that corner.
  const sketch = await coincident();
  assert.deepEqual(sketch.loose, [], "nothing on one spot that nothing joins");
  assert.equal(sketch.joined.length, 1, `the closing corner: ${sketch.joined}`);
  closing = sketch.joined[0];

  // The triangle a hole, said with the region tool (docs/plans/regions-as-
  // operations.md: a loop inside is no hole until an operation names it).
  await app.type("region");
  await clickAt(470, 330); // the plate's face
  await clickAt(570, 425); // the triangle's: subtracted
  await app.page.press("#cmd", "Escape");
  await app.page.press("#cmd", "Escape");
  await app.page.waitForTimeout(150);
  await app.type("extrude");
  await clickAt(470, 330); // inside the plate, outside the hole: rg1
  await app.page.fill("#cmd", "");
  await app.page.keyboard.press("Enter");
  await app.page.waitForTimeout(300);
  await app.page.keyboard.press("Escape");
  await app.page.waitForTimeout(120);

  const m = await app.model();
  assert.equal(m.journalOps.filter((o) => o === "extrude").length, 1, "one solid");
  assert.equal(await app.status(), "SOLVED");
  const l = await lid();
  assert.equal(l.corners, 7, "walls at the rectangle's four corners and the triangle's three");
  assert.equal(m.byKind.point, 8 + 7, "eight sketch points, seven twins (one per corner): nothing else");
  assert.equal(l.top, null, "no lid frame");
  assert.equal(l.frame, "origin", "along the origin's +z");
  assert.deepEqual(l.frames, [], "and no frame at all — it used to be the sketch frame alone");
});

test("orbited: no two points on one spot — no lid frame, each corner twinned once — and the picture shows no doubled label", async () => {
  await app.type("orbit(0.5, 0.35)");
  await app.page.waitForTimeout(200);
  await shot("2-orbited");
  await app.type("zoom(2)");
  await app.page.waitForTimeout(200);
  await shot("3-closer");
  const after = await coincident();
  assert.deepEqual(after.loose, [], "was three pairs, all on the lid");
  assert.deepEqual(after.joined, [closing], "and the sketch's one join, as drawn");
  const l = await lid();
  const { points } = await app.model();
  assert.equal(l.twins.length, 7, `each corner has its one twin: ${l.twins}`);

  // As drawn: two dots on one pixel print two names over each other, which is
  // what the owner saw. None but the sketch's own join.
  const names = Object.keys(points);
  const screen = await Promise.all(names.map((n) => app.screenOf(points[n])));
  let closest = Infinity;
  for (let i = 0; i < screen.length; i++) {
    for (let j = i + 1; j < screen.length; j++) {
      if ([`${names[i]}=${names[j]}`, `${names[j]}=${names[i]}`].includes(closing)) continue;
      closest = Math.min(closest, Math.hypot(screen[i][0] - screen[j][0], screen[i][1] - screen[j][1]));
    }
  }
  assert.ok(closest > 1, `no two dots drawn on one pixel: closest ${closest.toFixed(2)} px`);

  // Close in on a lid corner — the first twin, where the lid frame's marker
  // used to stand: a picture to look at, label by label.
  await app.type("zoom(3)");
  const [ox, oy] = await app.screenOf(points[l.twins[0]]);
  await app.type(`pan(${Math.round(700 - ox)}, ${Math.round(330 - oy)})`);
  await app.page.waitForTimeout(200);
  const centred = await app.screenOf(points[l.twins[0]]);
  assert.ok(Math.hypot(centred[0] - 700, centred[1] - 330) < 2, `the lid corner is drawn at ${centred}`);
  await shot("4-lid-origin");
});

test("save and open: the same names, still no point on another", async () => {
  const before = (await app.repl("save()")).value as string;
  assert.equal(JSON.parse(before).version, 17);
  const r = await app.repl(`open(${JSON.stringify(before)})`);
  assert.equal(r.ok, true, r.error ?? "");
  await app.page.waitForTimeout(200);
  assert.equal((await app.repl("save()")).value, before, "byte-identical");
  assert.deepEqual(await coincident(), { loose: [], joined: [closing] });
});
