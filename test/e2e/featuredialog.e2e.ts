// Pick → preview → confirm, pointer only — the owner, 2026-11-02: "extrude and
// other tools should work like they do in other cad software. just click on the
// region or select the loop and hit the tickbox or enter or something"
// (docs/plans/feature-dialog.md).
//
// Two rectangles drawn with the rectangle tool, the view turned so a lid is
// somewhere else on screen than its base. Then: arm extrude, click both — both
// solids previewed (pixels on the would-be lids, in the drawing and not in the
// faces picture, since nothing is built), type 25 in the depth field and see
// the preview's lid move, press Enter — two solids, one undo step, one Ctrl+Z
// takes both; ✓ does the same; Escape drops the picks with nothing built and
// the tool released; click, click; a region preselected with nothing armed,
// then the toolbar's extrude, then ✓; revolve with a region, an axis, its
// preview and Enter; fillet's two lines, the arc previewed, ✓; and with
// nothing armed a click on a line still names it, a drag on empty canvas still
// boxes, and a right-click still opens the menu.
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
async function shot(name: string): Promise<void> {
  if (!SHOTS) return;
  mkdirSync(SHOTS, { recursive: true });
  await app.page.waitForTimeout(150);
  await app.page.screenshot({ path: join(SHOTS, `featuredialog-${name}.png`) });
}

/** Arms a tool the way a newcomer does: its toolbar button, clicked. */
async function press(tool: string): Promise<void> {
  const b = await app.page.$eval(`#toolbar button[data-tool="${tool}"]`, (el) => {
    const r = el.getBoundingClientRect();
    return { x: r.x + r.width / 2, y: r.y + r.height / 2 };
  });
  await app.page.mouse.click(b.x, b.y);
  await app.page.waitForTimeout(120);
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

async function clickAt(sx: number, sy: number, modifiers: ("Shift")[] = []): Promise<void> {
  const at = await app.at(sx, sy);
  await app.page.mouse.move(at.x, at.y, { steps: 3 });
  await app.page.waitForTimeout(60);
  for (const m of modifiers) await app.page.keyboard.down(m);
  await app.page.mouse.click(at.x, at.y);
  for (const m of modifiers) await app.page.keyboard.up(m);
  // Long enough for the preview's copy to be built and drawn.
  await app.page.waitForTimeout(350);
}

/** A key with the command line empty — where the focus nearly always is. */
async function key(combo: string): Promise<void> {
  await app.page.fill("#cmd", "");
  await app.page.keyboard.press(combo);
  await app.page.waitForTimeout(350);
}

/** The mouse parked where it hovers nothing, so no hover outline is in a pixel read. */
async function park(): Promise<void> {
  const p = await app.at(...PARK);
  await app.page.mouse.move(p.x, p.y);
  await app.page.waitForTimeout(150);
}

const logLines = (): Promise<{ text: string; cls: string }[]> => app.page.$$eval("#log > div",
  (els) => els.map((el) => ({ text: el.textContent ?? "", cls: el.className })));
const typedSince = async (from: number) => (await logLines()).slice(from).map((l) => l.text).filter((t) => t.startsWith("> "));
const okButton = () => app.page.$eval("#options .oact button.ok", (el) => {
  const r = el.getBoundingClientRect();
  return { x: r.x + r.width / 2, y: r.y + r.height / 2, disabled: (el as HTMLButtonElement).disabled };
});
const noButton = () => app.page.$eval("#options .oact button.no", (el) => {
  const r = el.getBoundingClientRect();
  return { x: r.x + r.width / 2, y: r.y + r.height / 2 };
});

/** Whether a drawing-canvas pixel carries the preview: something drawn there, and no built face under it. */
async function previewed(world: number[]): Promise<boolean> {
  const [sx, sy] = await app.screenOf(world);
  const [, , , a] = await app.pixel(sx + 0.5, sy + 0.5, "drawing");
  const [, , , fa] = await app.pixel(sx + 0.5, sy + 0.5, "faces");
  return a > 0 && fa === 0;
}

/** Whether a solid's face is drawn at a world point, in the faces picture. */
async function built(world: number[]): Promise<boolean> {
  const [sx, sy] = await app.screenOf(world);
  const [, , , a] = await app.pixel(sx + 0.5, sy + 0.5, "faces");
  return a > 0;
}

const R1: [[number, number], [number, number]] = [[380, 340], [470, 420]];
const R2: [[number, number], [number, number]] = [[560, 340], [650, 420]];
const mid = (r: [[number, number], [number, number]]): [number, number] => [(r[0][0] + r[1][0]) / 2, (r[0][1] + r[1][1]) / 2];
const PARK: [number, number] = [760, 250];

/** Each rectangle's middle in the world, on its base — read once both are drawn. */
let base1: number[] = [], base2: number[] = [];
const lift = (p: number[], z: number) => [p[0], p[1], z];

test("two rectangles from the rectangle tool, the view turned so a lid is not over its base", async () => {
  await press("rectangle");
  await leftDrag(...R1);
  await press("rectangle");
  await leftDrag(...R2);
  assert.equal((await app.model()).byKind.line, 8);
  const m = await app.model();
  const centre = (names: string[]) => [0, 1].map((i) => names.reduce((s, p) => s + m.points[p][i], 0) / names.length);
  const pts = m.lines.flatMap((l) => l.refs);
  const left = [...new Set(pts)].filter((p) => m.points[p][0] < 0);
  const right = [...new Set(pts)].filter((p) => m.points[p][0] > 0);
  base1 = [...centre(left), 0];
  base2 = [...centre(right), 0];
  await app.type("orbit(0.4, 1)");
  await park();
  await shot("1-rectangles");
});

/** Where each rectangle's middle is on screen now. */
const inside = async (base: number[]): Promise<[number, number]> => {
  const [x, y] = await app.screenOf(base);
  return [Math.round(x), Math.round(y)];
};

test("extrude armed by its button; a click in each rectangle picks both and previews both solids — nothing built, ✓ lit", async () => {
  await press("extrude");
  const ok0 = await okButton();
  assert.equal(ok0.disabled, true, "✓ is off with nothing picked");
  await clickAt(...await inside(base1));
  await clickAt(...await inside(base2));
  await park();
  assert.equal((await app.model()).journalOps.includes("extrude"), false, "nothing built");
  assert.ok(await previewed(lift(base1, 10)), "the first lid, previewed at the armed depth");
  assert.ok(await previewed(lift(base2, 10)), "the second lid too");
  assert.equal(await built(lift(base1, 10)), false, "and no face is drawn there: it is a preview");
  assert.equal((await okButton()).disabled, false, "✓ is on");
  await shot("2-two-previewed");
});

test("typing 25 in the depth field moves the previewed lids; Enter in the field commits it and confirms — two solids, two typed lines, one undo step", async () => {
  assert.equal(await previewed(lift(base1, 25)), false, "nothing yet where a 25-deep lid would be");
  await app.page.click('#options input.oval[data-option="depth"]', { clickCount: 3 });
  await app.page.keyboard.type("25");
  await app.page.waitForTimeout(400);
  await park();
  assert.ok(await previewed(lift(base1, 25)), "the lid moved up to 25 as it was typed");
  assert.ok(await previewed(lift(base2, 25)));
  const typedBefore = (await logLines()).length;
  assert.deepEqual(await typedSince(typedBefore), []);
  await shot("3-depth-25");

  const from = (await logLines()).length;
  await app.page.focus('#options input.oval[data-option="depth"]');
  await app.page.keyboard.press("Enter");
  await app.page.waitForTimeout(500);
  const typed = await typedSince(from);
  assert.equal(typed[0], '> arm("extrude", {depth: 25})', `the field's line first: ${typed}`);
  const plane = typed.slice(1).filter((t) => /^> (plane|frame)\(/.test(t));
  assert.equal(plane.length, 1, `one plane for the frameless sketch: ${typed}`);
  const extrudes = typed.filter((t) => /^> extrude\("l\d+", 25\)$/.test(t));
  assert.equal(extrudes.length, 2, `one extrude a region: ${typed}`);
  assert.deepEqual((await logLines()).filter((l) => l.cls === "err"), [], "nothing red");
  const m = await app.model();
  assert.equal(m.journalOps.filter((o) => o === "extrude").length, 2, "two solids");
  // Released, as Onshape's ✓ closes its dialog: kept armed, the tool lit every
  // face of the solid it had just built as a region it could take next.
  assert.equal(m.activeTool, null, "a confirm releases the tool");
  await park();
  assert.ok(await built(lift(base1, 25)), "the first lid, built at 25");
  assert.ok(await built(lift(base2, 25)), "the second");
  assert.equal(await app.status(), "SOLVED");
  await shot("4-built");

  await key("Control+z");
  const after = await app.model();
  assert.equal(after.journalOps.filter((o) => o === "extrude").length, 0, "one Ctrl+Z takes both solids");
  assert.equal(after.byKind.frame ?? 0, 0, "and the plane made for them");
  assert.equal(after.activeTool, null, "and the tool stays released");
});

test("✓ does the same: two picks, the button, two solids — and one Ctrl+Z", async () => {
  await press("extrude");
  await clickAt(...await inside(base1));
  await clickAt(...await inside(base2));
  const ok = await okButton();
  assert.equal(ok.disabled, false);
  await app.page.mouse.click(ok.x, ok.y);
  await app.page.waitForTimeout(500);
  assert.equal((await app.model()).journalOps.filter((o) => o === "extrude").length, 2);
  await key("Control+z");
  assert.equal((await app.model()).journalOps.filter((o) => o === "extrude").length, 0);
});

test("Escape drops the picks and the preview, nothing built, the tool armed; a second Escape releases it", async () => {
  await press("extrude");
  await clickAt(...await inside(base1));
  await park();
  assert.ok(await previewed(lift(base1, 25)));
  await key("Escape");
  await park();
  assert.equal(await previewed(lift(base1, 25)), false, "the preview is gone");
  const m = await app.model();
  assert.equal(m.journalOps.includes("extrude"), false, "nothing built");
  assert.equal(m.activeTool, "extrude", "the tool still armed");
  // ✗ is the same key: pick, ✗, nothing.
  await clickAt(...await inside(base2));
  const no = await noButton();
  await app.page.mouse.click(no.x, no.y);
  await app.page.waitForTimeout(250);
  assert.equal((await okButton()).disabled, true, "✗ dropped the pick");
  assert.equal((await app.model()).activeTool, "extrude");
  await key("Escape");
  assert.equal((await app.model()).activeTool, null, "the second Escape releases the tool");
});

test("the quick path: click, click on the same region builds it", async () => {
  await press("extrude");
  const at = await inside(base1);
  await clickAt(...at);
  await clickAt(...at);
  assert.equal((await app.model()).journalOps.filter((o) => o === "extrude").length, 1);
  await key("Control+z");
  await key("Escape");
});

test("with nothing armed a click inside a region selects it — lit — then the toolbar's extrude starts from it, and ✓ builds it", async () => {
  assert.equal((await app.model()).activeTool, null);
  const at = await inside(base2);
  const before = await app.pixel(at[0] + 0.5, at[1] + 0.5, "drawing");
  await clickAt(...at);
  await park();
  const lit = await app.pixel(at[0] + 0.5, at[1] + 0.5, "drawing");
  assert.ok(lit[1] > before[1] + 10 || (before[3] === 0 && lit[3] > 0), `the region is lit: ${before} → ${lit}`);
  await shot("5-preselected");
  await press("extrude");
  await park();
  assert.equal((await okButton()).disabled, false, "the selection came with it");
  assert.ok(await previewed(lift(base2, 25)), "and is previewed at once");
  const ok = await okButton();
  await app.page.mouse.click(ok.x, ok.y);
  await app.page.waitForTimeout(500);
  assert.equal((await app.model()).journalOps.filter((o) => o === "extrude").length, 1);
  await key("Control+z");
  await key("Escape");
  await key("Escape");
});

test("with nothing armed a click on a line still names it, a click on empty canvas clears a selection, a drag still boxes, a right-click still opens the menu", async () => {
  const m = await app.model();
  const edge = m.lines[0];
  const [a, b] = await Promise.all(edge.refs.map((p) => app.screenOf(m.points[p])));
  await app.page.fill("#cmd", "");
  await clickAt(Math.round((a[0] + b[0]) / 2), Math.round((a[1] + b[1]) / 2));
  assert.match(await app.page.inputValue("#cmd"), new RegExp(`"${edge.name}"`), "the click on a line names it");
  await app.page.fill("#cmd", "");

  await clickAt(...await inside(base1));
  await clickAt(...PARK);
  await press("extrude");
  assert.equal((await okButton()).disabled, true, "the click on empty canvas cleared the selection");
  await key("Escape");

  // A box from empty canvas over the left rectangle names every entity it holds.
  await leftDrag([340, 300], [500, 460]);
  assert.ok((await app.page.inputValue("#cmd")).includes(`"${edge.name}"`) || (await app.page.inputValue("#cmd")).length > 0,
    "the box selected");
  await app.page.fill("#cmd", "");

  const r = await app.at(...PARK);
  await app.page.mouse.click(r.x, r.y, { button: "right" });
  await app.page.waitForTimeout(200);
  assert.equal(await app.page.$eval("#ctxmenu", (el) => !(el as HTMLElement).hidden), true, "the menu opened");
  await key("Escape");
});

test("revolve: a region, an axis, the solid previewed, Enter builds it", async () => {
  // A line beside the left rectangle, in its plane, to turn it about.
  await app.type('ln(pt(-90, -30, 0), pt(-90, 30, 0))');
  await press("revolve");
  await clickAt(...await inside(base1));
  const m = await app.model();
  const axis = m.lines.at(-1)!;
  const [a, b] = await Promise.all(axis.refs.map((p) => app.screenOf(m.points[p])));
  await clickAt(Math.round((a[0] + b[0]) / 2), Math.round((a[1] + b[1]) / 2));
  await park();
  // A whole turn about x = −90 sweeps the rectangle's middle round to the far side.
  const far = [-180 - base1[0], base1[1], 0];
  assert.ok(await previewed(far), "the far side of the turn, previewed");
  await shot("6-revolve-previewed");
  const from = (await logLines()).length;
  await key("Enter");
  const typed = await typedSince(from);
  assert.ok(typed.some((t) => new RegExp(`^> revolve\\("l\\d+", "${axis.name}"\\)$`).test(t)), `typed: ${typed}`);
  assert.equal((await app.model()).journalOps.filter((o) => o === "revolve").length, 1);
  await park();
  assert.ok(await built(far));
  await shot("7-revolved");
  await key("Escape");
});

test("fillet: two lines that share a corner, the arc previewed, ✓ rounds it", async () => {
  await press("fillet");
  const m = await app.model();
  // The right rectangle's two edges at its corner of largest x and y.
  const right = m.lines.filter((l) => l.refs.every((p) => m.points[p][0] > 0 && Math.abs(m.points[p][2]) < 1e-9));
  const corner = right.flatMap((l) => l.refs).reduce((best, p) => (m.points[p][0] + m.points[p][1] > m.points[best][0] + m.points[best][1] ? p : best));
  const legs = right.filter((l) => l.refs.includes(corner));
  assert.equal(legs.length, 2);
  for (const leg of legs) {
    const [a, b] = await Promise.all(leg.refs.map((p) => app.screenOf(m.points[p])));
    // A third of the way from the corner, clear of the corner's point.
    const [c, o] = leg.refs[0] === corner ? [a, b] : [b, a];
    await clickAt(Math.round(c[0] + (o[0] - c[0]) / 3), Math.round(c[1] + (o[1] - c[1]) / 3));
  }
  await park();
  assert.equal((await app.model()).byKind.arc ?? 0, 0, "nothing rounded yet");
  // The arc's middle, previewed: radius 10 in from both legs, along the bisector.
  const [cx, cy] = [m.points[corner][0], m.points[corner][1]];
  const arcMid = [cx - 10 + 10 * Math.SQRT1_2, cy - 10 + 10 * Math.SQRT1_2, 0];
  const [sx, sy] = await app.screenOf(arcMid);
  const near = await app.pixels("drawing", [[sx, sy], [sx + 1, sy], [sx, sy + 1], [sx - 1, sy], [sx, sy - 1]].map(([x, y]) => [x + 0.5, y + 0.5] as [number, number]));
  assert.ok(near.some(([r, g, b, a]) => a > 0 && g > r + 20 && g > b), `the arc, previewed in green: ${JSON.stringify(near)}`);
  await shot("8-fillet-previewed");
  const ok = await okButton();
  assert.equal(ok.disabled, false);
  await app.page.mouse.click(ok.x, ok.y);
  await app.page.waitForTimeout(500);
  assert.equal((await app.model()).byKind.arc, 1, "rounded");
  assert.equal(await app.status(), "SOLVED");
  await shot("9-filleted");
});

test("and the log holds no red line", async () => {
  assert.deepEqual((await logLines()).filter((l) => l.cls === "err"), []);
});
