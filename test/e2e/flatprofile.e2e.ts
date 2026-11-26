// The owner's two scenes of 2026-11-26, by finger on an iPhone and by mouse
// (docs/plans/flat-profile.md; bugs 83 and 84):
//
// 1. A box from the Rectangle tool, extruded; the Plane tool on its lid; a
//    circle; Cut, through all — a hole; then the circle's centre dragged a
//    little. Before: the drag's target sat off the face (the screen-parallel
//    plane), the free box tilted toward the finger, the solids layer refused
//    the box as oblique at its 1e-6 bar, the hole was gone and the cut's
//    walls and cap were drawn as a boss. Now the circle slides along the
//    face, the box stands still, and the hole stays.
// 2. The same box, the circle drawn across its edge — the Cut takes the lens,
//    a D-shaped notch — then the centre nudged. Before: the drawing never
//    settled (a bare-angle row against a long chord) and the kernel refused
//    the plate. Now it settles in one solve, and an undo puts the circle back.
// And the row a refused body gets: *not built*, in the warning ink, with the
// kernel's reason.
//
// Every assertion is read off the model and the bodies layer, not the log —
// the log keeps what was said earlier. NEOCAD_E2E_SHOTS keeps the pictures
// (docs/images/553–560); look at them.

import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdirSync } from "node:fs";
import { join } from "node:path";
import { openApp, type AppContext } from "./harness.ts";
import { fingers } from "./fingers.ts";

const SHOTS = process.env.NEOCAD_E2E_SHOTS;
const T = 10;

interface Hand {
  device: "mouse" | "iPhone";
  button(selector: string): Promise<void>;
  click(world: number[]): Promise<void>;
  drag(from: number[], to: number[]): Promise<void>;
  /** A drag that starts on a world point and moves the hand by pixels — a finger's nudge, wherever the eye is. */
  nudge(from: number[], dx: number, dy: number): Promise<void>;
}

async function handOf(a: AppContext, device: Hand["device"]): Promise<Hand> {
  const centre = async (selector: string): Promise<[number, number]> =>
    a.page.$eval(selector, (el) => { const r = (el as HTMLElement).getBoundingClientRect(); return [r.x + r.width / 2, r.y + r.height / 2] as [number, number]; });
  if (device === "mouse") {
    const mouseDrag = async (p: { x: number; y: number }, q: { x: number; y: number }) => {
      await a.page.mouse.move(p.x, p.y, { steps: 3 });
      await a.page.waitForTimeout(80);
      await a.page.mouse.down();
      await a.page.mouse.move(q.x, q.y, { steps: 12 });
      await a.page.mouse.up();
      await a.page.waitForTimeout(600);
    };
    return {
      device,
      button: async (sel) => { const [x, y] = await centre(sel); await a.page.mouse.click(x, y); await a.page.waitForTimeout(300); },
      click: async (w) => { const c = await a.at(...await a.screenOf(w)); await a.page.mouse.move(c.x, c.y, { steps: 3 }); await a.page.waitForTimeout(80); await a.page.mouse.click(c.x, c.y); await a.page.waitForTimeout(350); },
      drag: async (from, to) => mouseDrag(await a.at(...await a.screenOf(from)), await a.at(...await a.screenOf(to))),
      nudge: async (from, dx, dy) => { const p = await a.at(...await a.screenOf(from)); await mouseDrag(p, { x: p.x + dx, y: p.y + dy }); },
    };
  }
  const f = await fingers(a);
  return {
    device,
    button: async (sel) => { const [x, y] = await centre(sel); await f.tap(x, y); await a.page.waitForTimeout(500); },
    click: async (w) => { const s = await a.screenOf(w); await a.at(s[0], s[1]); await f.tap(s[0], s[1]); await a.page.waitForTimeout(500); },
    drag: async (from, to) => { const s = await a.screenOf(from), e = await a.screenOf(to); await a.at(s[0], s[1]); await f.drag(s, e, 12); await a.page.waitForTimeout(600); },
    nudge: async (from, dx, dy) => { const s = await a.screenOf(from); await a.at(s[0], s[1]); await f.drag(s, [s[0] + dx, s[1] + dy], 12); await a.page.waitForTimeout(900); },
  };
}

async function shot(a: AppContext, name: string): Promise<void> {
  if (!SHOTS) return;
  mkdirSync(SHOTS, { recursive: true });
  await a.page.waitForTimeout(500);
  await a.page.screenshot({ path: join(SHOTS, `${name}.png`) });
}

async function say(a: AppContext, source: string): Promise<void> {
  await a.type(source);
  await a.page.evaluate(() => (document.activeElement as HTMLElement | null)?.blur());
  await a.page.waitForTimeout(250);
}

async function ready(a: AppContext): Promise<void> {
  await a.page.waitForFunction(() => document.getElementById("status")?.textContent?.includes("ready"), null, { timeout: 20_000 });
  await a.page.waitForTimeout(400);
}

/** The box the owner draws: the Rectangle tool, the Extrude tool, ✓ — a box 80 × 80 × 10 — seen from a corner, as his screenshots are. */
async function box(a: AppContext, h: Hand): Promise<void> {
  await h.button('#toolbar button[data-tool="rectangle"]');
  await h.drag([-40, -40, 0], [40, 40, 0]);
  await h.button('#toolbar button[data-tool="extrude"]');
  await h.click([0, 0, 0]);
  await a.page.click("#options .oact button.ok");
  await a.page.waitForTimeout(700);
  const m = await a.model();
  assert.equal(m.byKind.line, 12, "a box: twelve edges");
  await say(a, "orbit(0, -1.0); orbit(-0.8, 0); zoom(1.1)");
}

/** The Plane tool on the lid, a circle from `centre` out to `rim` on it, Cut through all at `inside`; the plane let go. */
async function cutOnLid(a: AppContext, h: Hand, centre: number[], rim: number[], inside: number[]): Promise<void> {
  await h.button('#toolbar button[data-tool="plane"]');
  await h.click([-30, 30, T]);
  await h.button('#toolbar button[data-tool="circle"]');
  await h.drag(centre, rim);
  await say(a, 'arm("cut")');
  await h.click(inside);
  await a.page.selectOption('#options select.obeside[data-option="end"]', "through");
  await a.page.waitForTimeout(300);
  await a.page.click("#options .oact button.ok");
  await a.page.waitForTimeout(900);
  await say(a, "workplane(null)");
  // The Plane tool turned the view square to the lid, and letting the plane
  // go does not turn it back: looked at from a corner again, as the owner's
  // screenshots are, so the finger's plane is not the face's.
  await say(a, "orbit(0, -1.0); orbit(-0.8, 0); zoom(1.1)");
  await say(a, 'arm("select")');
}

interface Reading {
  features: [string, string | null, string | null][];
  views: string[];
  skipped: { feature: string; why: string }[];
  report: string[];
  replaces: string[];
  centre: number[];
  centreOffLid: number;
  baseOff: number;
  settleIterations: number;
  settleMax: number;
  volume: number | null;
  radius: number | null;
  status: string;
  rows: { name: string; detail: string; warn: boolean }[];
}

/** Everything the assertions read: the features, the bodies layer's word, the geometry, and a further solve's work. */
async function read(a: AppContext): Promise<Reading> {
  return a.page.evaluate(() => {
    const N = (window as unknown as { __neocad: { model: any; bodies: any } }).__neocad; // eslint-disable-line @typescript-eslint/no-explicit-any
    const m = N.model, B = N.bodies;
    const P = (n: string): number[] => m.coords(n);
    const sub = (u: number[], v: number[]) => u.map((x, i) => x - v[i]);
    const cross = (u: number[], v: number[]) => [u[1] * v[2] - u[2] * v[1], u[2] * v[0] - u[0] * v[2], u[0] * v[1] - u[1] * v[0]];
    const dot = (u: number[], v: number[]) => u.reduce((s, x, i) => s + x * v[i], 0);
    const unit = (u: number[]) => { const l = Math.hypot(...u); return u.map((x) => x / l); };
    const off = (a: string, b: string, c: string, d: string) => Math.abs(dot(sub(P(d), P(a)), unit(cross(sub(P(b), P(a)), sub(P(c), P(a))))));
    const views = B.views();
    const rows = Array.from(document.querySelectorAll("#organiser .orow")).map((r) => ({
      name: r.querySelector(".oname")?.textContent ?? "", detail: r.querySelector(".odetail")?.textContent ?? "", warn: (r as HTMLElement).dataset.warn !== undefined,
    }));
    return {
      features: [...m.features.values()].map((f: any) => [f.kind, f.mode ?? null, f.into ?? null]), // eslint-disable-line @typescript-eslint/no-explicit-any
      views: views.map((v: any) => `${v.name}[${v.features.join("+")}]`), // eslint-disable-line @typescript-eslint/no-explicit-any
      skipped: B.current?.skipped ?? [], report: B.report().lines, replaces: [...B.drawn().replaces],
      centre: P("p9"), centreOffLid: off("p5", "p6", "p8", "p9"), baseOff: off("p1", "p2", "p3", "p4"),
      settleIterations: m.problem.solve().iterations,
      settleMax: m.problem.solve().maxResidual,
      volume: views[0]?.result?.solid?.volume ?? null,
      radius: m.entities.has("c1") ? m.radius("c1") : null,
      status: document.getElementById("status")?.textContent ?? "",
      rows,
    };
  });
}

/**
 * The body built with its cut, nothing refused, the drawing settled, and no
 * shell drawn. `settled`: a further solve has nothing to do at all. (Until
 * bug 85 a finger's nudge of the lens left the release stalled a few 1e-7
 * off, and this took "to the eye" for it; every nudge settles exactly now,
 * and the loosened form is kept only so a regression says which it was.)
 */
function assertBuilt(r: Reading, what: string, settled: "exactly" | "to the eye" = "exactly"): void {
  assert.deepEqual(r.features, [["extrude", null, null], ["extrude", "cut", "e1"]], `${what}: the box and a cut into it`);
  assert.deepEqual(r.views, ["e1[e1+e2]"], `${what}: the kernel built the box with its cut`);
  assert.deepEqual(r.skipped, [], `${what}: nothing refused`);
  assert.deepEqual(r.report, [], `${what}: nothing to say against the bodies`);
  if (settled === "exactly") assert.equal(r.settleIterations, 0, `${what}: settled — a further solve has nothing to do`);
  else assert.ok(r.settleMax < 1e-6, `${what}: settled to the eye — a further solve leaves ${r.settleMax}`);
  assert.match(r.status, /SOLVED/, `${what}: ${r.status}`);
  assert.ok(r.rows.every((row) => !row.warn), `${what}: no row in the warning ink`);
}

for (const device of ["iPhone", "mouse"] as const) {
  const open = () => openApp(device === "mouse" ? {} : { device: "iPhone 13" });
  const n = device === "mouse" ? { before: 553, after: 555, refused: 557, lens: 559 } : { before: 0, after: 556, refused: 558, lens: 560 };

  test(`${device}: the owner's hole — the circle's centre dragged slides along the face, the box stands still, the hole stays (bug 83)`, async () => {
    const a = await open();
    try {
      await ready(a);
      const h = await handOf(a, device);
      await box(a, h);
      await cutOnLid(a, h, [0, 0, T], [12, 0, T], [0, 0, T]);
      const before = await read(a);
      assertBuilt(before, "as made");
      assert.ok(before.centreOffLid < 1e-6, `the circle's centre on the lid: ${before.centreOffLid} off`);
      assert.ok(Math.hypot(...before.centre.slice(0, 2)) < 1, `and near its middle (a hand lands on pixels): ${before.centre}`);
      const corners = await a.page.evaluate(() => ["p1", "p2", "p3", "p4"].map((p) => (window as unknown as { __neocad: { model: { coords(n: string): number[] } } }).__neocad.model.coords(p)));
      if (n.before) await shot(a, `${n.before}-${device.toLowerCase()}-the-owners-hole-before-the-drag`);
      // The drag: forty pixels along, sixteen down, from the centre — the owner's nudge.
      await h.nudge([0, 0, T], 40, 16);
      const after = await read(a);
      assertBuilt(after, "after the drag");
      const slid = Math.hypot(...after.centre.map((c, i) => c - before.centre[i]));
      assert.ok(slid > 3, `the circle slid ${slid} along the face (0.003 before, the box tilting instead)`);
      assert.ok(after.centreOffLid < 1e-6, `still on the face: ${after.centreOffLid} off`);
      assert.ok(after.baseOff < 1e-6, `the box's base coplanar to 1e-6: ${after.baseOff}`);
      const moved = await a.page.evaluate((was) => ["p1", "p2", "p3", "p4"].map((p, i) => Math.hypot(...(window as unknown as { __neocad: { model: { coords(n: string): number[] } } }).__neocad.model.coords(p).map((c, k) => c - was[i][k]))), corners);
      // To a hundredth: a free body shares a hair of each kinematic frame's
      // step (2e-4 measured by finger), which is what "pull on anything" means;
      // what matters is that it did not tilt toward the finger (0.07 before).
      assert.ok(moved.every((d) => d < 1e-2), `the box stood still: ${moved}`);
      await shot(a, `${n.after}-${device.toLowerCase()}-after-the-drag-the-circle-slid-and-the-hole-stays`);

      // A body the solids layer refuses says so in its row: the perpendicular
      // replaced by an angle — a drafted, oblique box, which the kernel does
      // not sweep (profiles-held.md: drawn, not built).
      await say(a, 'del("e1_perp"); ang("l9", "e1", 0.3)');
      await a.page.waitForTimeout(900);
      const refused = await read(a);
      assert.match(refused.status, /SOLVED/, refused.status);
      assert.deepEqual(refused.views, [], "nothing built");
      assert.deepEqual(refused.skipped.map((s) => s.feature), ["e1", "e2"], `both refused: ${JSON.stringify(refused.skipped)}`);
      assert.match(refused.skipped[0].why, /oblique/);
      assert.match(refused.skipped[1].why, /e1 is not built, so there is nothing for it to cut/);
      assert.ok(refused.replaces.includes("e2"), "the cut's faces are not drawn as a solid's (the boss)");
      // The Features rows (the Bodies section names e1 too, with its chain as its detail).
      const e1 = refused.rows.find((r) => r.name === "e1" && r.warn)!, e2 = refused.rows.find((r) => r.name === "e2" && r.warn)!;
      assert.deepEqual([e1?.detail, e1?.warn], ["not built", true], "the box's row says so, in the warning ink");
      assert.deepEqual([e2?.detail, e2?.warn], ["not built", true], "and the cut's");
      await shot(a, `${n.refused}-${device.toLowerCase()}-a-refused-body-says-not-built-in-its-row`);
      assert.deepEqual(a.pageErrors, []);
    } finally {
      await a.close();
    }
  });

  test(`${device}: the owner's lens — a circle across the box's edge, Cut, the centre nudged: it settles and stays built; undo puts it back (bug 84)`, async () => {
    const a = await open();
    try {
      await ready(a);
      const h = await handOf(a, device);
      await box(a, h);
      // The circle's centre 10 in from the edge at x = 40, its radius 18 (the
      // rim taken upward, clear of every edge a finger's reach would snap it
      // to): it crosses the edge, and the Cut takes the lens inside.
      await cutOnLid(a, h, [30, 0, T], [30, 18, T], [36, 0, T]);
      const made = await read(a);
      assertBuilt(made, "the lens cut");
      // The notch: the box less the part of the circle inside it — the circle less
      // the segment beyond the edge at x = 40 — through its whole thickness.
      const r = made.radius!, d = 40 - made.centre[0];
      assert.ok(d > 0 && d < r, `the circle crosses the edge: centre ${made.centre}, radius ${r}`);
      const segment = r * r * Math.acos(d / r) - d * Math.sqrt(r * r - d * d);
      const want = 80 * 80 * T - (Math.PI * r * r - segment) * T;
      assert.ok(made.volume !== null && Math.abs(made.volume - want) / want < 1e-3, `the kernel's notch: ${made.volume}, the closed form ${want}`);
      const profile = await a.page.evaluate(() => JSON.stringify([...(window as unknown as { __neocad: { model: { features: Map<string, { loops: unknown }> } } }).__neocad.model.features.values()][1].loops));
      assert.match(profile, /\{"name":"l\d+","from":"p\d+","to":"p\d+"\}/, `the cut's profile is the lens — a piece of the lid's edge and a piece of the circle: ${profile}`);
      await h.nudge([30, 0, T], -24, 8);
      const nudged = await read(a);
      // Both hands: the circle slides and the drawing settles exactly. By
      // finger the release's solve used to stall at 3.5e-7 on the cut's own
      // rows, and the kernel refused a frame's boolean (bug 85: the cap's
      // normal, a datum, wandered with the chord's every micro-tilt;
      // docs/plans/walkthrough-gate.md). The walkthrough gate holds the same.
      assertBuilt(nudged, "after the nudge");
      const slid = Math.hypot(...nudged.centre.map((c, i) => c - made.centre[i]));
      assert.ok(slid > 2, `the circle moved ${slid} (0.02 by finger once, the stall)`);
      assert.ok(nudged.baseOff < 1e-6, `the box flat: ${nudged.baseOff}`);
      await shot(a, `${n.lens}-${device.toLowerCase()}-the-lens-cut-nudged-still-built`);
      await say(a, "undo()");
      await a.page.waitForTimeout(900);
      const undone = await read(a);
      assertBuilt(undone, "after undo");
      assert.ok(Math.hypot(...undone.centre.map((c, i) => c - made.centre[i])) < 1e-6, "the circle back where it was");
      assert.deepEqual(a.pageErrors, []);
    } finally {
      await a.close();
    }
  });
}
