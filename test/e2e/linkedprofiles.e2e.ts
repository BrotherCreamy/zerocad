// An extrude's two profiles are peers, in the real app, by mouse and on an
// iPhone 13 by finger (docs/plans/linked-profiles.md). The owner: *"after
// extrude, it should be impossible to tell which was the original and which is
// the derivative"*; *"Deleting a line would break it obviously. The other side
// of an extrude profile is an identically linked profile/sketch entities. If
// you change one the other follows automatically."*; *"reining in one side
// should trim on the other also"*.
//
// Each test draws a rectangle with the tool and extrudes it with the tool —
// the owner's drawing — and then edits ONE profile and looks at the OTHER:
// a lid dimension set and the base measured; a lid corner dragged and the base
// corner; a lid edge deleted and the base edge gone, the body open, the edge
// drawn back and the body a solid; the extrude deleted and both sketches still
// there; a lid edge trimmed and the base edge trimmed.
//
// Set NEOCAD_E2E_SHOTS to keep the pictures (docs/images/443–458); look at them.

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

async function shot(a: AppContext, name: string): Promise<void> {
  if (!SHOTS) return;
  mkdirSync(SHOTS, { recursive: true });
  // Clear of the drawing, so no hover tag is in the picture, and time for the faces to settle.
  await a.page.mouse.move(6, 420);
  await a.page.waitForTimeout(500);
  await a.page.screenshot({ path: join(SHOTS, `${name}.png`) });
}

type Feature = { open?: boolean; unbuilt?: string; depth: string; loops: (string | { name: string })[][]; twins: string[][]; walls: string[] };
type Neo = { __neocad: {
  model: {
    features: Map<string, Feature>;
    relations: Map<string, { name: string; op: string; args: unknown[]; twin?: { of: string }; blocks: unknown[] }>;
    entities: Map<string, { kind: string; name: string; refs?: string[] }>;
    coords(p: string): number[];
  };
  engine: { glyphs(): { relation: string; symbol: string; screen: [number, number]; isLabel: boolean }[] };
} };

/** The model, as the test reads it: e1's record, every line with where its ends are, every relation. */
const state = (a: AppContext) => a.page.evaluate(() => {
  const m = (window as never as Neo).__neocad.model;
  const f = m.features.get("e1");
  const lines = [...m.entities.values()].filter((e) => e.kind === "line")
    .map((e) => ({ name: e.name, refs: e.refs!, at: e.refs!.map((p) => m.coords(p)) }));
  const pairs: Record<string, string> = {};
  const depth = f ? m.relations.get(f.depth) : undefined;
  if (depth) for (let i = 2; i + 1 < depth.args.length; i += 2) pairs[depth.args[i] as string] = depth.args[i + 1] as string;
  return {
    feature: f ? { open: f.open === true, unbuilt: f.unbuilt ?? null, loops: f.loops.map((l) => l.map((x) => (typeof x === "string" ? x : x.name))),
      twins: f.twins, walls: f.walls, depth: f.depth } : null,
    lines, pairs,
    points: Object.fromEntries([...m.entities.values()].filter((e) => e.kind === "point").map((e) => [e.name, m.coords(e.name)])),
    relations: [...m.relations.values()].map((r) => ({ name: r.name, op: r.op, args: r.args, twin: r.twin?.of ?? null, rows: r.blocks.length })),
    entities: [...m.entities.keys()],
  };
});
type State = Awaited<ReturnType<typeof state>>;

const glyphs = (a: AppContext) => a.page.evaluate(() => (window as never as Neo).__neocad.engine.glyphs());
const sub = (p: number[], q: number[]) => p.map((x, i) => x - q[i]);
const len = (p: number[]) => Math.hypot(...p);
const mid = (p: number[], q: number[]) => p.map((x, i) => (x + q[i]) / 2);
const lengthOf = (s: State, line: string) => { const l = s.lines.find((x) => x.name === line)!; return len(sub(l.at[1], l.at[0])); };

/** A hand: the mouse, or a finger on the iPhone — the same gestures, each as its device makes them. */
interface Hand {
  device: "mouse" | "iPhone";
  click(at: [number, number]): Promise<void>;
  drag(from: [number, number], to: [number, number]): Promise<void>;
  /** ✓ on a feature tool's dialog. */
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

/** The owner's drawing: a rectangle drawn with the tool, extruded with the tool, looked at from a corner. */
async function block(a: AppContext, hand: Hand): Promise<State> {
  await say(a, 'arm("rectangle")');
  await hand.drag(await a.screenOf([-25, -15, 0]), await a.screenOf([25, 15, 0]));
  await say(a, 'arm("extrude")');
  await hand.click(await a.screenOf([8, 5, 0]));
  await hand.confirm();
  // From above and to one side: the lid, and two walls down to the base.
  await say(a, hand.device === "mouse" ? "orbit(0, -1.0); orbit(-0.8, 0); zoom(1.5)" : "orbit(0, -1.0); orbit(-0.8, 0)");
  await say(a, 'arm("select")');
  const s = await state(a);
  assert.ok(s.feature, "e1 made");
  assert.equal(s.feature.loops[0].length, 4);
  // The rectangle's relations are each said of the lid too, and hold no rows of their own.
  const twins = s.relations.filter((r) => r.twin !== null);
  assert.ok(twins.length >= 4, `the rectangle's relations twinned: ${twins.map((r) => r.name)}`);
  assert.ok(twins.every((r) => r.rows === 0));
  assert.match(await a.status(), /SOLVED/);
  return s;
}

/** The last lines of the log, for a failure's message. */
const said = async (a: AppContext) => (await a.log()).split("\n").slice(-5).join(" / ");

/**
 * A click that picks a line — along it, clear of the marks that sit on its
 * middle and its corners (a mark outranks the line under it, and a twin's
 * mark is drawn on the lid as its partner's is on the base).
 */
async function pickLine(a: AppContext, hand: Hand, line: string, ends: number[][]): Promise<void> {
  for (const t of [0.3, 0.7, 0.2, 0.8, 0.4, 0.6]) {
    await hand.click(await a.screenOf(ends[0].map((c, i) => c + t * (ends[1][i] - c))));
    if ((await a.selection()).join() === line) return;
    await a.page.keyboard.press("Escape");
    await a.page.waitForTimeout(150);
  }
  assert.fail(`${line} could not be picked along its length — the selection is ${await a.selection()}`);
}

/** Nothing conflicts and nothing is said in the redundancy's colour for being a pair. */
async function assertQuiet(a: AppContext, what: string): Promise<void> {
  const d = await a.page.$eval("#diagnosis", (el) => ({ cls: el.className, text: el.textContent ?? "" }));
  assert.notEqual(d.cls, "conflict", `${what}: no conflict (${d.text})`);
  assert.match(await a.status(), /SOLVED/, what);
  assert.deepEqual(a.pageErrors, [], what);
}

// --- a dimension set on the lid, a lid corner dragged ---------------------------------------

async function dimensionAndDrag(a: AppContext, hand: Hand, pictures: { one: string; set: string; drag: string }): Promise<void> {
  const made = await block(a, hand);
  const f = made.feature!;
  const [base, lid] = [f.loops[0][0], f.twins[0][0]];
  const [p, q] = made.lines.find((l) => l.name === base)!.refs;
  const width = Math.round(lengthOf(made, base));
  // Held where it was drawn, as a sketch on a chosen plane is — a corner, a
  // direction, the ground under the far corner — so a dimension set is seen as
  // the one edge growing. (Free, the solve shares the change out and the block
  // turns as it grows: true, and harder to read in a picture.) By mouse every
  // edge is drawn, the hidden ones dimmed — the base is under the solid, and
  // both profiles wear their marks; the phone keeps the shaded view it opens in.
  const far = made.lines.find((l) => l.name === f.loops[0][2])!.refs[0];
  await say(a, `fix("${p}", [${made.points[p].join(", ")}]); par("${base}", "origin.x"); onplane("${far}", "origin")${hand.device === "mouse" ? '; view("hidden")' : ""}`);
  await say(a, `dist("${p}", "${q}", ${width})`);
  const s1 = await state(a);
  const dim = s1.relations.find((r) => r.op === "dist" && r.twin === null)!;
  const twin = s1.relations.find((r) => r.twin === dim.name)!;
  assert.deepEqual(twin.args, [made.pairs[p], made.pairs[q], width], "the base's dimension is said of the lid's edge");
  // One label for the pair, not two: the lid's, the end nearer the viewer.
  const labels = (await glyphs(a)).filter((g) => g.relation === dim.name || g.relation === twin.name);
  assert.deepEqual(labels.map((g) => g.relation), [twin.name], "one label, on the end nearer the viewer");
  await shot(a, pictures.one);

  // Set on the lid — by a double-click on its label where there is a mouse — and the base measured.
  if (hand.device === "mouse") {
    const at = await a.at(...labels[0].screen);
    await a.page.mouse.dblclick(at.x, at.y);
    await a.page.waitForTimeout(250);
    assert.equal(await a.page.inputValue("#cmd"), `set("${twin.name}.value", `, "the label opens the lid's dimension");
    await a.page.type("#cmd", `${width + 14})`);
    await a.page.press("#cmd", "Enter");
    await a.page.waitForTimeout(450);
    await a.page.evaluate(() => (document.activeElement as HTMLElement | null)?.blur());
  } else {
    await say(a, `set("${twin.name}.value", ${width + 14})`);
  }
  const s2 = await state(a);
  assert.ok(Math.abs(lengthOf(s2, lid) - (width + 14)) < 1e-6, `the lid's edge is ${width + 14}: ${lengthOf(s2, lid)}`);
  assert.ok(Math.abs(lengthOf(s2, base) - (width + 14)) < 1e-6, `and the base's edge followed: ${lengthOf(s2, base)}`);
  assert.equal(s2.relations.find((r) => r.name === dim.name)!.args[2], width + 14, "one value, both ends");
  await assertQuiet(a, "after the set");
  await shot(a, pictures.set);

  // A lid corner dragged — the far one, which nothing but the rectangle holds:
  // its base corner goes with it, and the block is deeper front to back.
  const corner = made.pairs[far];
  const from = await a.screenOf(s2.points[corner]);
  await hand.drag(from, [from[0] + (hand.device === "mouse" ? 50 : 36), from[1] - (hand.device === "mouse" ? 45 : 32)]);
  const s3 = await state(a);
  assert.ok(len(sub(s3.points[corner], s2.points[corner])) > 1, `the lid corner moved: ${await said(a)}`);
  assert.ok(len(sub(s3.points[far], s2.points[far])) > 1, `the base corner went with it: ${s2.points[far]} → ${s3.points[far]}`);
  assert.ok(Math.abs(s3.points[far][2]) < 1e-6, "still on the ground it is held on");
  const chords = Object.entries(s3.pairs).filter(([b]) => s3.points[b]).map(([b, t]) => sub(s3.points[t], s3.points[b]));
  for (const c of chords) assert.ok(len(sub(c, chords[0])) < 1e-6, "every corner one chord from its partner still");
  assert.ok(Math.abs(lengthOf(s3, base) - (width + 14)) < 1e-6 && Math.abs(lengthOf(s3, lid) - (width + 14)) < 1e-6, "and the dimension held on both");
  await assertQuiet(a, "after the drag");
  await shot(a, pictures.drag);
}

test("by mouse: a dimension on the base is one label, on the lid; set there, the base follows; a lid corner dragged takes the base corner", () =>
  withApp({}, async (a) => dimensionAndDrag(a, await handOf(a, "mouse"), {
    one: "443-a-dimension-on-the-base-drawn-once-on-the-lid",
    set: "444-the-lids-dimension-set-the-base-follows",
    drag: "445-a-lid-corner-dragged-the-base-corner-with-it",
  })));

test("on an iPhone 13, by finger: the lid's dimension set and the base follows; a lid corner dragged takes the base corner", () =>
  withApp({ device: "iPhone 13" }, async (a) => dimensionAndDrag(a, await handOf(a, "iPhone"), {
    one: "451-iphone-a-dimension-on-the-base-drawn-once-on-the-lid",
    set: "452-iphone-the-lids-dimension-set-the-base-follows",
    drag: "453-iphone-a-lid-corner-dragged-the-base-corner-with-it",
  })));

// --- an edge deleted, drawn back; the extrude deleted ----------------------------------------

async function openCloseDelete(a: AppContext, hand: Hand, pictures: { open: string; closed: string; gone: string }): Promise<void> {
  const made = await block(a, hand);
  const f = made.feature!;
  // The lid's edge nearest the viewer's right: deleted by selecting it and pressing Delete, or by name on the phone.
  const k = 1;
  const [base, lid] = [f.loops[0][k], f.twins[0][k]];
  const lidLine = made.lines.find((l) => l.name === lid)!;
  // By mouse: picked, and Delete pressed. On the phone, by its name — a tap on
  // an edge under a finger takes whichever mark is nearest, and the deletion
  // is the same call either way.
  if (hand.device === "mouse") {
    await pickLine(a, hand, lid, lidLine.at);
    await a.page.keyboard.press("Delete");
    await a.page.waitForTimeout(450);
  } else {
    await say(a, `del("${lid}")`);
  }
  const open = await state(a);
  assert.ok(!open.entities.includes(lid), "the lid's edge is gone");
  assert.ok(!open.entities.includes(base), "and the base's with it");
  assert.ok(open.feature, "the extrude stays as a record");
  assert.equal(open.feature.open, true, "open");
  assert.equal(open.feature.loops[0].length, 3);
  assert.equal(open.feature.walls.length, 4, "every corner still stands");
  // The organiser's row says so.
  const organiser = await a.page.evaluate(() => document.querySelector("#organiser")?.textContent ?? "");
  if (/e1/.test(organiser)) assert.match(organiser, /extrude · open/, `the Features row says open: ${organiser}`);
  await assertQuiet(a, "open");
  await shot(a, pictures.open);

  // Drawn back, on the base, with the line tool: corner to corner.
  const baseLine = made.lines.find((l) => l.name === base)!;
  await say(a, 'arm("line")');
  await hand.click(await a.screenOf(open.points[baseLine.refs[0]]));
  await hand.click(await a.screenOf(open.points[baseLine.refs[1]]));
  await a.page.keyboard.press("Escape");
  await say(a, 'arm("select")');
  const closed = await state(a);
  assert.equal(closed.feature!.open, false, `closed again: ${JSON.stringify(closed.feature!.loops)} · ${(await a.log()).split("\n").slice(-4).join(" / ")}`);
  assert.equal(closed.feature!.loops[0].length, 4);
  const [again, twinAgain] = [closed.feature!.loops[0], closed.feature!.twins[0]].map((l) => l.find((n) => !made.entities.includes(n))!);
  assert.ok(again && twinAgain, "the new edge has its twin on the other profile");
  const lidEnds = closed.lines.find((l) => l.name === twinAgain)!.at;
  assert.ok(lidEnds.every((p) => lidLine.at.some((q) => len(sub(p, q)) < 1e-5)), "the lid's edge is back where it was");
  await assertQuiet(a, "closed");
  await shot(a, pictures.closed);

  // The extrude deleted: both sketches and the chords, every relation each had.
  const before = closed.entities.length;
  await say(a, 'del("e1"); select()');
  const gone = await state(a);
  assert.equal(gone.feature, null);
  assert.equal(gone.entities.length, before, "not one entity went with it");
  for (const n of [...closed.feature!.loops[0], ...closed.feature!.twins[0], ...closed.feature!.walls]) assert.ok(gone.entities.includes(n), `${n} stays`);
  assert.ok(gone.relations.every((r) => r.twin === null && r.rows > 0), "every relation is its own now, and holds what it says");
  const squares = gone.relations.filter((r) => r.op === "perpendicular");
  assert.ok(squares.length >= 4 && squares.length % 2 === 0, `each profile kept its right angles: ${squares.map((r) => r.name)}`);
  await assertQuiet(a, "the extrude deleted");
  await shot(a, pictures.gone);
}

test("by mouse: a lid edge deleted takes the base edge and leaves the body open; drawn back on the base it is a solid; the extrude deleted leaves both sketches", () =>
  withApp({}, async (a) => openCloseDelete(a, await handOf(a, "mouse"), {
    open: "446-a-lid-edge-deleted-both-edges-gone-the-body-open",
    closed: "447-the-edge-drawn-back-on-the-base-a-solid-again",
    gone: "448-the-extrude-deleted-both-sketches-and-the-chords",
  })));

test("on an iPhone 13, by finger: a lid edge deleted leaves the body open; drawn back it is a solid; the extrude deleted leaves both sketches", () =>
  withApp({ device: "iPhone 13" }, async (a) => openCloseDelete(a, await handOf(a, "iPhone"), {
    open: "454-iphone-a-lid-edge-deleted-the-body-open",
    closed: "455-iphone-the-edge-drawn-back-a-solid-again",
    gone: "456-iphone-the-extrude-deleted-both-sketches",
  })));

// --- a trim on the lid ---------------------------------------------------------------------------

async function trimBoth(a: AppContext, hand: Hand, pictures: { before: string; after: string }): Promise<void> {
  const made = await block(a, hand);
  const f = made.feature!;
  const [base, lid] = [f.loops[0][0], f.twins[0][0]];
  const edge = made.lines.find((l) => l.name === lid)!;
  // A line drawn on the lid's face, across that edge at its middle: typed, held on the face as a click there holds it.
  const m = mid(edge.at[0], edge.at[1]);
  const inward = sub(mid(...(made.lines.find((l) => l.name === f.twins[0][2])!.at as [number[], number[]])), m);
  const u = inward.map((c) => c / len(inward));
  const [p, q] = [m.map((c, i) => c - 6 * u[i]), m.map((c, i) => c + 9 * u[i])];
  await say(a, `a = pt(${p.join(", ")}); b = pt(${q.join(", ")}); cutter = ln(a, b); onplane(a, "e1.lid"); onplane(b, "e1.lid")`);
  await assertQuiet(a, "the cutter drawn");
  await shot(a, pictures.before);
  // The trim tool, on the half of the lid's edge toward its far end — well along it, clear of the cutter under a finger.
  await say(a, 'arm("trim")');
  await hand.click(await a.screenOf(m.map((c, i) => c + 0.7 * (edge.at[1][i] - c))));
  await say(a, 'arm("select")');
  const s = await state(a);
  const [bl, tl] = [s.lines.find((l) => l.name === base)!, s.lines.find((l) => l.name === lid)!];
  assert.ok(Math.abs(len(sub(tl.at[1], tl.at[0])) - lengthOf(made, lid) / 2) < 1e-4, `the lid's edge is reined in to the cut: ${len(sub(tl.at[1], tl.at[0]))} — ${await said(a)}`);
  assert.ok(Math.abs(len(sub(bl.at[1], bl.at[0])) - lengthOf(made, base) / 2) < 1e-4, `and the base's edge with it: ${len(sub(bl.at[1], bl.at[0]))}`);
  assert.equal(s.feature!.open, true, "the body is open: its loop no longer closes");
  assert.equal(s.feature!.walls.length, 5, "a wall at the new end");
  assert.ok(s.relations.some((r) => r.op === "pointOnLine" && r.args[0] === tl.refs[1]), "the cut is a relation, on the lid where the cutter is");
  await assertQuiet(a, "trimmed");
  await shot(a, pictures.after);
}

test("by mouse: the trim tool on a lid edge trims the base edge too", () =>
  withApp({}, async (a) => trimBoth(a, await handOf(a, "mouse"), {
    before: "449-a-line-drawn-on-the-lid-across-an-edge",
    after: "450-the-lids-edge-trimmed-and-the-bases-with-it",
  })));

test("on an iPhone 13, by finger: the trim tool on a lid edge trims the base edge too", () =>
  withApp({ device: "iPhone 13" }, async (a) => trimBoth(a, await handOf(a, "iPhone"), {
    before: "457-iphone-a-line-drawn-on-the-lid-across-an-edge",
    after: "458-iphone-the-lids-edge-trimmed-and-the-bases-with-it",
  })));
