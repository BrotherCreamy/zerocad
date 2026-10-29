// The first run, end to end, pointer only: what a newcomer does in a fresh
// model with nothing typed — the owner's standing direction ("i should be able
// to very simply extrude etc, not get a bunch of errors. and same with every
// other tool", docs/plans/effortless.md) as one test.
//
// The rectangle tool draws; the circle tool draws a circle inside it, making
// the plane it needs (the plane line appears in the log, no greyed button, no
// red); the extrude tool, clicked outside every region, says where to click and
// lights the regions it could take — read off the pixels — and a click inside
// makes the solid; the fillet tool rounds a corner; the revolve tool misses,
// is told, then hits; the sketch tool starts a sketch on the lid. Every tool is
// armed by its toolbar button, every gesture is a mouse, and at the end the
// log holds no red line.
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

/** Arms a tool the way a newcomer does: its toolbar button, clicked. */
async function press(tool: string): Promise<void> {
  const b = await app.page.$eval(`#toolbar button[data-tool="${tool}"]`, (el) => {
    const r = el.getBoundingClientRect();
    return { x: r.x + r.width / 2, y: r.y + r.height / 2, off: (el as HTMLButtonElement).disabled };
  });
  assert.equal(b.off, false, `${tool}'s button is not greyed`);
  await app.page.mouse.click(b.x, b.y);
  await app.page.waitForTimeout(80);
  assert.equal((await app.model()).activeTool, tool, `${tool} armed by its button`);
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

test("the circle tool draws a circle inside it, typing the plane it needs: the line in the log, nothing red", async () => {
  await press("circle");
  const from = (await logLines()).length;
  await leftDrag(CENTRE, [CENTRE[0] + 30, CENTRE[1]]);
  const lines = (await logLines()).slice(from);
  assert.ok(lines.some((l) => /^> plane\(pt\(-?[\d.]+, -?[\d.]+, 0\), null, null, \{ look: false \}\)$/.test(l.text)),
    `the plane, typed: ${lines.map((l) => l.text).join(" | ")}`);
  assert.deepEqual(lines.filter((l) => l.cls === "err"), [], "nothing red");
  const m = await app.model();
  assert.equal(m.byKind.circle, 1);
  assert.equal(m.byKind.frame, 1);
  assert.ok(await defaultFrame(), "the plane is the default now");
  assert.equal(await app.status(), "SOLVED");
  await shot("2-circle");
});

test("the extrude tool: a click outside every region says where to click and lights the regions; a click inside makes the solid", async () => {
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
  assert.equal((await app.model()).byKind.frame, 1, "and nothing was made");
  await shot("3-extrude-miss");

  await clickAt(480, 455);
  const last = (await logLines()).at(-1)!;
  assert.match(last.text, /^e1 {2}extrude of /);
  assert.equal(last.cls, "out");
  assert.equal(await app.status(), "SOLVED");
  await shot("4-solid");
});

test("the fillet tool rounds a corner of the base, and the lid with it", async () => {
  await press("fillet");
  const m = await app.model();
  // The base's right edge and bottom edge, clicked near the corner they share
  // (screen right-bottom). In a view never turned the lid is drawn right over
  // the base, and a click on the edge picks the base's line, which was drawn first.
  const [[x0, y0], [x1, y1]] = RECT;
  await clickAt(x1, y0 + (y1 - y0) * 0.7);
  await clickAt(x0 + (x1 - x0) * 0.7, y1);
  const after = await app.model();
  assert.equal(after.byKind.arc, 2, "the arc, and its twin on the lid");
  assert.equal(after.byKind.line, m.byKind.line + 1, "one line more: the lid's wall at the new tangent point");
  assert.equal(await app.status(), "SOLVED");
  await shot("5-fillet");
});

test("turned by a right-drag, the revolve tool: a miss says so; a click inside the hole's lid circle chooses it; a miss says what to click and lights the axes; a lid edge revolves it", async () => {
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
  await shot("6-revolve-axes", OUTSIDE);
  assert.ok(await lit(...off), `the lid edge ${edge.name} is lit as an axis: ${await app.pixel(off[0] + 0.5, off[1] + 0.5, "drawing")} at ${off}`);
  await clickAt(Math.round(mid[0]), Math.round(mid[1]));
  const last = (await logLines()).at(-1)!;
  assert.match(last.text, /^e2 {2}revolve of /, `revolved: ${last.text}`);
  assert.equal(await app.status(), "SOLVED");
  await shot("7-revolved");
});

test("the sketch tool on the lid starts a sketch there: plane(a, b, c) typed, the default now", async () => {
  await press("sketch");
  const before = await defaultFrame();
  const m = await app.model();
  const top = Math.max(...Object.values(m.points).map((p) => p[2]));
  // Inside the lid, by the corner the fillet did not round: a quarter of the
  // way along the diagonal from the base's top-left corner, lifted to the lid.
  const corners = Object.values(m.points).filter((p) => Math.abs(p[2] - top) < 1e-6);
  const xs = corners.map((p) => p[0]), ys = corners.map((p) => p[1]);
  const at = [Math.min(...xs) + (Math.max(...xs) - Math.min(...xs)) * 0.15, Math.max(...ys) - (Math.max(...ys) - Math.min(...ys)) * 0.15, top];
  const from = (await logLines()).length;
  const [sx, sy] = await app.screenOf(at);
  await clickAt(Math.round(sx), Math.round(sy));
  const typed = (await logLines()).slice(from).filter((l) => l.text.startsWith("> "));
  assert.equal(typed.length, 1, `one line: ${typed.map((l) => l.text)}`);
  assert.match(typed[0].text, /^> plane\("p\d+", "p\d+", "p\d+"\)$/);
  const now = await defaultFrame();
  assert.ok(now && now !== before, "a new default frame, on the lid");
  await shot("8-sketch-on-lid");
});

test("and at the end the log holds no red line", async () => {
  const red = (await logLines()).filter((l) => l.cls === "err");
  assert.deepEqual(red, []);
  assert.equal(await app.status(), "SOLVED");
});
