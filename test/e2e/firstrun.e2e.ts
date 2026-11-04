// The first run, end to end, pointer only: what a newcomer does in a fresh
// model with nothing typed — the owner's standing direction ("i should be able
// to very simply extrude etc, not get a bunch of errors. and same with every
// other tool", docs/plans/effortless.md) as one test.
//
// The rectangle tool draws; the circle tool draws a circle inside it, on the
// ground, making no frame for it (docs/plans/frameless-curves.md; no greyed button, no
// red); the extrude tool, clicked outside every region, says where to click and
// lights the regions it could take — read off the pixels — a click inside picks
// the region and previews the solid, and the ✓ builds it; the fillet tool picks
// a corner's two lines and Enter rounds it; the revolve tool misses, is told,
// picks a profile and an axis, and Enter turns it; and the lid, clicked with
// nothing armed, is selected, so the sketch tool's button starts a sketch on it
// at once. Every tool is armed by its toolbar button, every gesture is a mouse
// or the Enter key, and at the end the log holds no red line — pick, preview,
// confirm (docs/plans/feature-dialog.md).
//
// Set NEOCAD_E2E_SHOTS to a directory to keep the screenshots; look at them.
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
async function shot(name: string, hover?: [number, number]): Promise<void> {
  if (!SHOTS) return;
  mkdirSync(SHOTS, { recursive: true });
  if (hover) {
    const at = await app.at(...hover);
    await app.page.mouse.move(at.x, at.y);
  }
  await app.page.waitForTimeout(150);
  await app.page.screenshot({ path: join(SHOTS, `firstrun-${name}.png`) });
}

/**
 * Arms a tool the way a newcomer does: its toolbar button, clicked. `stays`
 * false for a tool that may be done with its gesture by the time the button
 * is up (sketch, armed on a face already selected).
 */
async function press(tool: string, stays = true): Promise<void> {
  const b = await app.page.$eval(`#toolbar button[data-tool="${tool}"]`, (el) => {
    const r = el.getBoundingClientRect();
    return { x: r.x + r.width / 2, y: r.y + r.height / 2, off: (el as HTMLButtonElement).disabled };
  });
  assert.equal(b.off, false, `${tool}'s button is not greyed`);
  await app.page.mouse.click(b.x, b.y);
  await app.page.waitForTimeout(80);
  if (stays) assert.equal((await app.model()).activeTool, tool, `${tool} armed by its button`);
}

async function leftDrag(a: [number, number], b: [number, number]): Promise<void> {
  const p = await app.at(...a), q = await app.at(...b);
  await app.page.mouse.move(p.x, p.y);
  await app.page.mouse.down();
  await app.page.mouse.move(q.x, q.y, { steps: 8 });
  await app.page.mouse.up();
  await app.page.waitForTimeout(250);
}

async function clickAt(sx: number, sy: number): Promise<void> {
  const at = await app.at(sx, sy);
  await app.page.mouse.move(at.x, at.y, { steps: 3 });
  await app.page.waitForTimeout(80);
  await app.page.mouse.click(at.x, at.y);
  await app.page.waitForTimeout(250);
}

/** The log's lines, with the class each is shown in. */
const logLines = (): Promise<{ text: string; cls: string }[]> => app.page.$$eval("#log > div",
  (els) => els.map((el) => ({ text: el.textContent ?? "", cls: el.className })));
const stepNote = () => app.page.$eval("#stepnote", (el) => ({ text: el.textContent ?? "", cls: el.className }));
const defaultFrame = async (): Promise<string | null> => (await app.repl("defaultFrame()")).value as string | null;

/** Whether a drawing-canvas pixel is lit: the tools' green, faint, over nothing else. */
async function lit(sx: number, sy: number): Promise<boolean> {
  const [r, g, b, a] = await app.pixel(sx + 0.5, sy + 0.5, "drawing");
  return a > 0 && g > r + 10 && g > b;
}

/** The last line of the log, which must be the tool's guidance: muted, never red — and in the header's note. */
async function guided(expected: RegExp): Promise<void> {
  const last = (await logLines()).at(-1)!;
  assert.match(last.text, expected);
  assert.equal(last.cls, "out", `guidance is muted, not red: "${last.text}"`);
  const note = await stepNote();
  assert.equal(note.text, last.text, "and said in the header's note");
  assert.equal(note.cls, "guide");
}

const RECT: [[number, number], [number, number]] = [[460, 320], [660, 480]];
const CENTRE: [number, number] = [560, 400];
const OUTSIDE: [number, number] = [400, 250];

test("a fresh model: no frame, and no tool greyed", async () => {
  assert.equal((await app.model()).size, 0);
  assert.equal(await defaultFrame(), null);
  const off = await app.page.$$eval("#toolbar button", (els) => els.filter((el) => (el as HTMLButtonElement).disabled).length);
  assert.equal(off, 0);
});

test("the rectangle tool draws a rectangle", async () => {
  await press("rectangle");
  await leftDrag(...RECT);
  const m = await app.model();
  assert.equal(m.byKind.line, 4);
  assert.equal(m.byKind.frame ?? 0, 0, "and needed no frame");
  await shot("1-rectangle");
});

test("the circle tool draws a circle inside it, on the ground, making nothing for it: nothing typed, nothing red", async () => {
  await press("circle");
  const from = (await logLines()).length;
  await leftDrag(CENTRE, [CENTRE[0] + 30, CENTRE[1]]);
  const lines = (await logLines()).slice(from);
  // It used to type plane(pt(…), null, null, { look: false }) first, a frame
  // at the click; a circle now carries its own normal and lies on the
  // origin's ground (docs/plans/frameless-curves.md).
  assert.ok(!lines.some((l) => /^> (plane|frame)\(/.test(l.text)), `no plane typed: ${lines.map((l) => l.text).join(" | ")}`);
  assert.deepEqual(lines.filter((l) => l.cls === "err"), [], "nothing red");
  const m = await app.model();
  assert.equal(m.byKind.circle, 1);
  assert.equal(m.byKind.frame ?? 0, 0, "no frame");
  assert.equal(await defaultFrame(), null, "and no default");
  assert.equal(await app.status(), "SOLVED");
  await shot("2-circle");
});

test("the extrude tool: a click outside every region says where to click and lights the regions; a click inside picks and previews; ✓ makes the solid", async () => {
  await press("extrude");
  // Lit as soon as it is armed: inside the rectangle and inside the circle,
  // and nothing outside them.
  const park = await app.at(...OUTSIDE);
  await app.page.mouse.move(park.x, park.y);
  await app.page.waitForTimeout(120);
  assert.ok(await lit(480, 340), "the rectangle, around the hole, is lit");
  // Up and left of the centre: clear of the frame marker, the labels and the onplane glyph.
  assert.ok(await lit(CENTRE[0] - 14, CENTRE[1] - 9), "the circle is lit, as a region of its own");
  assert.ok(!(await lit(...OUTSIDE)), "outside every region, nothing");

  await clickAt(...OUTSIDE);
  await guided(/^extrude: click inside a closed outline — the ones I can see are lit$/);
  assert.equal((await app.model()).activeTool, "extrude", "the tool stays armed");
  assert.equal((await app.model()).byKind.frame ?? 0, 0, "and nothing was made");
  await shot("3-extrude-miss");

  await clickAt(480, 455);
  assert.equal((await app.model()).journalOps.includes("extrude"), false, "a click picks: nothing built");
  await shot("4-extrude-previewed", OUTSIDE);
  const ok = await app.page.$eval("#options .oact button.ok", (el) => {
    const r = el.getBoundingClientRect();
    return { x: r.x + r.width / 2, y: r.y + r.height / 2, off: (el as HTMLButtonElement).disabled };
  });
  assert.equal(ok.off, false, "the ✓ is lit");
  await app.page.mouse.click(ok.x, ok.y);
  await app.page.waitForTimeout(300);
  const last = (await logLines()).at(-1)!;
  assert.match(last.text, /^e1 {2}extrude of /);
  assert.equal(last.cls, "out");
  assert.equal(await app.status(), "SOLVED");
  await shot("5-solid");
});

test("the fillet tool picks a corner of the base, and Enter rounds it, and the lid with it", async () => {
  await press("fillet");
  const m = await app.model();
  // The base's right edge and bottom edge, clicked near the corner they share
  // (screen right-bottom). In a view never turned the lid is drawn right over
  // the base, and a click on the edge picks the base's line, which was drawn first.
  const [[x0, y0], [x1, y1]] = RECT;
  await clickAt(x1, y0 + (y1 - y0) * 0.7);
  await clickAt(x0 + (x1 - x0) * 0.7, y1);
  assert.equal((await app.model()).byKind.arc ?? 0, 0, "picked, not yet rounded");
  await shot("6-fillet-previewed", OUTSIDE);
  await app.page.keyboard.press("Enter");
  await app.page.waitForTimeout(300);
  const after = await app.model();
  assert.equal(after.byKind.arc, 2, "the arc, and its twin on the lid");
  assert.equal(after.byKind.line, m.byKind.line + 1, "one line more: the lid's wall at the new tangent point");
  assert.equal(await app.status(), "SOLVED");
  await shot("7-fillet");
});

test("turned by a right-drag, the revolve tool: a miss says so; a click inside the hole's lid circle chooses it; a miss says what to click and lights the axes; a lid edge is the axis, and Enter revolves it", async () => {
  // Orbit with the mouse, so the lid's edges and the base's are apart on screen.
  const from = await app.at(760, 420), to = await app.at(860, 350);
  await app.page.mouse.move(from.x, from.y);
  await app.page.mouse.down({ button: "right" });
  await app.page.mouse.move(to.x, to.y, { steps: 6 });
  await app.page.mouse.up({ button: "right" });
  await app.page.waitForTimeout(200);

  await press("revolve");
  await clickAt(...OUTSIDE);
  await guided(/^revolve: click inside a closed outline — the ones I can see are lit$/);

  // The lid's circle: the twin of the circle's centre, on screen.
  const m = await app.model();
  const z = (p: string) => m.points[p][2];
  const top = Math.max(...Object.values(m.points).map((p) => p[2]));
  const lidCentre = m.circles.map((c) => c.center).find((p) => Math.abs(z(p) - top) < 1e-6)!;
  assert.ok(lidCentre, "the circle's twin on the lid");
  const [cx, cy] = await app.screenOf(m.points[lidCentre]);
  await clickAt(Math.round(cx + 8), Math.round(cy + 8));
  assert.equal((await logLines()).at(-1)!.text.startsWith("revolve:"), true, "the miss is still the last thing said");

  await clickAt(...OUTSIDE);
  await guided(/^revolve: now click a line, or a frame's arm, to turn it about$/);

  // A lid edge: both its points at the top. Lit — two pixels off its middle,
  // clear of its own ink — and then clicked.
  const edge = m.lines.find((l) => l.refs.every((p) => Math.abs(z(p) - top) < 1e-6))!;
  const [a, b] = await Promise.all(edge.refs.map((p) => app.screenOf(m.points[p])));
  const mid: [number, number] = [(a[0] + b[0]) / 2, (a[1] + b[1]) / 2];
  const len = Math.hypot(b[0] - a[0], b[1] - a[1]);
  const off: [number, number] = [Math.round(mid[0] - ((b[1] - a[1]) / len) * 2), Math.round(mid[1] + ((b[0] - a[0]) / len) * 2)];
  await shot("8-revolve-axes", OUTSIDE);
  assert.ok(await lit(...off), `the lid edge ${edge.name} is lit as an axis: ${await app.pixel(off[0] + 0.5, off[1] + 0.5, "drawing")} at ${off}`);
  await clickAt(Math.round(mid[0]), Math.round(mid[1]));
  await shot("9-revolve-previewed", OUTSIDE);
  await app.page.keyboard.press("Enter");
  await app.page.waitForTimeout(300);
  const last = (await logLines()).at(-1)!;
  assert.match(last.text, /^e2 {2}revolve of /, `revolved: ${last.text}`);
  assert.equal(await app.status(), "SOLVED");
  await shot("10-revolved");
});

test("the lid clicked with nothing armed is selected, and the sketch tool's button starts a sketch on it: workplane(a.b.c) typed, no frame made", async () => {
  await app.page.keyboard.press("Escape"); // the revolve tool, put down
  await app.page.waitForTimeout(100);
  assert.equal((await app.model()).activeTool, null);
  const before = await defaultFrame();
  const m = await app.model();
  const top = Math.max(...Object.values(m.points).map((p) => p[2]));
  // Inside the lid, by the corner the fillet did not round: a quarter of the
  // way along the diagonal from the base's top-left corner, lifted to the lid.
  const corners = Object.values(m.points).filter((p) => Math.abs(p[2] - top) < 1e-6);
  const xs = corners.map((p) => p[0]), ys = corners.map((p) => p[1]);
  // With nothing armed a click on an edge names the edge — and the base's edges
  // are drawn through the lid — so the spot is one where nothing picks and the
  // region under it is the lid's: asked of the app's own pick and region.
  const spots = [0.15, 0.25, 0.35, 0.2, 0.3].flatMap((u) => [0.15, 0.25, 0.35, 0.2].map((v) =>
    [Math.min(...xs) + (Math.max(...xs) - Math.min(...xs)) * u, Math.max(...ys) - (Math.max(...ys) - Math.min(...ys)) * v, top]));
  let at: number[] | null = null;
  for (const spot of spots) {
    const [x, y] = (await app.screenOf(spot)).map(Math.round);
    const clear = await app.page.evaluate(([x, y, top]) => {
      const { engine, model } = (window as never as { __neocad: {
        engine: { pickAt(x: number, y: number): unknown; regionAt(x: number, y: number): { loops: { members: { name: string }[]; plane: { origin: number[] } }[]; index: number } | null };
        model: { coords(n: string): number[] };
      } }).__neocad;
      const r = engine.regionAt(x, y);
      return engine.pickAt(x, y) === null && r !== null && Math.abs(r.loops[r.index].plane.origin[2] - top) < 1e-6;
    }, [x, y, top]);
    if (clear) { at = spot; break; }
  }
  assert.ok(at, "somewhere on the lid picks nothing");
  const from = (await logLines()).length;
  const [sx, sy] = await app.screenOf(at);
  await clickAt(Math.round(sx), Math.round(sy));
  await shot("11-lid-selected", OUTSIDE);
  await press("sketch", false);
  await app.page.waitForTimeout(250);
  const typed = (await logLines()).slice(from).filter((l) => l.text.startsWith("> ") && !l.text.startsWith("> arm("));
  assert.equal(typed.length, 1, `one line: ${typed.map((l) => l.text)}`);
  // The work plane, set to three of the lid's points — no frame made, so the
  // default is what it was (docs/plans/frameless-curves.md; this used to type
  // plane(a, b, c), a new default frame on them).
  assert.match(typed[0].text, /^> workplane\("p\d+\.p\d+\.p\d+"\)$/);
  assert.equal(await defaultFrame(), before, "the default untouched");
  assert.equal((await app.model()).byKind.frame ?? 0, 0, "and still no frame");
  const plane = (await app.repl("model.workPlane")).value as string;
  const lid = plane.split(".").map((p) => (m.points[p] ?? [0, 0, NaN])[2]);
  assert.ok(lid.every((z) => Math.abs(z - top) < 1e-6), `the work plane is on the lid: ${plane} at z ${lid}`);
  await shot("12-sketch-on-lid");
});

test("and at the end the log holds no red line", async () => {
  const red = (await logLines()).filter((l) => l.cls === "err");
  assert.deepEqual(red, []);
  assert.equal(await app.status(), "SOLVED");
});
