// The canvas's selection, with a real mouse (docs/plans/groups.md, phase 1).
//
// What only a browser can answer: that a click with the command line empty
// selects and the selection is *drawn* (in its own violet, not the hover's
// amber), that text in the command line still turns a click into an inserted
// name, that the right-click menu and the Delete key act on what is selected
// and type the command they ran, and that none of it is an undo step until
// something is actually deleted.
//
// Set NEOCAD_E2E_SHOTS to a directory to keep the screenshots; look at them.

import { test, before, after } from "node:test";
import assert from "node:assert/strict";
import { mkdirSync } from "node:fs";
import { join } from "node:path";
import { openApp, axisFrame, PARKED, type AppContext } from "./harness.ts";

let app: AppContext;
before(async () => {
  app = await openApp();
  await axisFrame(app, [-90, -60]);
  await app.type("pt(-40,-20); pt(40,-20); pt(40,30); pt(-40,30)");
  await app.type('ln("p1","p2"); ln("p2","p3"); ln("p3","p4"); ln("p4","p1")');
});
after(async () => { await app.close(); });

const SHOTS = process.env.NEOCAD_E2E_SHOTS;
async function shot(name: string): Promise<void> {
  if (!SHOTS) return;
  mkdirSync(SHOTS, { recursive: true });
  await app.page.screenshot({ path: join(SHOTS, `selection-${name}.png`) });
}

/** The selection's violet (tools/selection.ts), as bytes. */
const VIOLET = [0xc4, 0x6c, 0xff];
const near = (p: number[], c: number[], tol = 40) => p.slice(0, 3).every((v, i) => Math.abs(v - c[i]) <= tol);

async function midOf(a: string, b: string): Promise<[number, number]> {
  const m = await app.model();
  const [pa, pb] = await Promise.all([app.screenOf(m.points[a]), app.screenOf(m.points[b])]);
  return [Math.round((pa[0] + pb[0]) / 2), Math.round((pa[1] + pb[1]) / 2)];
}

async function clickAt(sx: number, sy: number, shift = false): Promise<void> {
  const at = await app.at(sx, sy);
  if (shift) await app.page.keyboard.down("Shift");
  await app.page.mouse.click(at.x, at.y);
  if (shift) await app.page.keyboard.up("Shift");
  await app.page.waitForTimeout(150);
}

/** Whether any pixel in a small square round (sx, sy) is the selection's violet. */
async function violetNear(sx: number, sy: number, r = 3): Promise<boolean> {
  const at: [number, number][] = [];
  for (let dx = -r; dx <= r; dx++) for (let dy = -r; dy <= r; dy++) at.push([sx + dx + 0.5, sy + dy + 0.5]);
  return (await app.pixels("drawing", at)).some((p) => p[3] > 200 && near(p, VIOLET));
}

async function park(): Promise<void> {
  const p = await app.at(...PARKED);
  await app.page.mouse.move(p.x, p.y);
  await app.page.waitForTimeout(100);
}

test("a click selects an edge, and it is drawn in the selection's violet, not the hover's amber", async () => {
  await app.page.fill("#cmd", "");
  const mid = await midOf("p1", "p2");
  assert.equal(await violetNear(...mid), false, "nothing violet before");
  await clickAt(...mid);
  assert.deepEqual(await app.selection(), ["l1"]);
  await park();
  assert.equal(await violetNear(...mid), true, "the selected edge is violet with the cursor away");
  await shot("1-edge-selected");
});

test("shift-click adds a second edge; selecting is not an undo step", async () => {
  const journal = (await app.model()).journalOps.length;
  await clickAt(...await midOf("p3", "p4"), true);
  assert.deepEqual(await app.selection(), ["l1", "l3"]);
  assert.equal((await app.model()).journalOps.length, journal, "nothing journalled");
  // The last step is the four lines typed; were selecting a step, Ctrl+Z would
  // take back the selection and leave them.
  await app.page.keyboard.press("Control+z");
  await app.page.waitForTimeout(200);
  assert.equal((await app.model()).byKind.line ?? 0, 0, "Ctrl+Z went past the selection to the lines");
  await app.page.keyboard.press("Control+y");
  await app.page.waitForTimeout(200);
  assert.equal((await app.model()).byKind.line, 4);
});

test("the right-click menu on a selected edge acts on the whole selection, and types its command", async () => {
  await app.repl('select("l1", "l3")');
  const at = await app.at(...await midOf("p1", "p2"));
  await app.page.mouse.move(at.x, at.y);
  await app.page.mouse.down({ button: "right" });
  await app.page.mouse.up({ button: "right" });
  await app.page.waitForTimeout(150);
  const head = await app.page.$eval("#ctxmenu", (el) => el.querySelector(".head")?.textContent ?? "");
  assert.match(head, /^2 selected/);
  const del = await app.page.$$eval("#ctxmenu .item", (els) =>
    els.map((el) => el.querySelector(".cmd")?.textContent ?? "").find((c) => c.startsWith("del(")));
  assert.equal(del, 'del("l1", "l3")');
  await app.page.keyboard.press("Escape");
});

test("with text in the command line a click still inserts the name, and the selection stays", async () => {
  await app.repl('select("l1")');
  await app.page.fill("#cmd", "dist(");
  const m = await app.model();
  const p2 = await app.screenOf(m.points.p2);
  await clickAt(p2[0], p2[1]);
  assert.equal(await app.page.inputValue("#cmd"), 'dist("p2"');
  assert.deepEqual(await app.selection(), ["l1"]);
  await app.page.fill("#cmd", "");
});

test("Escape clears the selection", async () => {
  await app.repl('select("l1", "l2")');
  await app.page.keyboard.press("Escape");
  await app.page.waitForTimeout(100);
  assert.deepEqual(await app.selection(), []);
});

test("the Delete key deletes the selection — typed, one undo step", async () => {
  await app.page.fill("#cmd", "");
  await clickAt(...await midOf("p2", "p3"));
  await clickAt(...await midOf("p4", "p1"), true);
  assert.deepEqual(await app.selection(), ["l2", "l4"]);
  await app.page.keyboard.press("Delete");
  await app.page.waitForTimeout(250);
  assert.match(await app.log(), /> del\("l2", "l4"\)/, "the log shows what the key typed");
  assert.equal((await app.model()).byKind.line, 2);
  assert.deepEqual(await app.selection(), [], "the deleted names have left the selection");
  await app.page.keyboard.press("Control+z");
  await app.page.waitForTimeout(250);
  assert.equal((await app.model()).byKind.line, 4, "one Ctrl+Z puts both back");
});

test("the Delete key is the command line's while it has the focus, text or none", async () => {
  await app.repl('select("l1")');
  await app.page.fill("#cmd", "abc");
  await app.page.focus("#cmd");
  await app.page.keyboard.press("Home");
  await app.page.keyboard.press("Delete");
  await app.page.waitForTimeout(150);
  assert.equal(await app.page.inputValue("#cmd"), "bc", "the key edited the text");
  for (let i = 0; i < 3; i++) await app.page.keyboard.press("Delete");
  await app.page.waitForTimeout(150);
  assert.equal(await app.page.inputValue("#cmd"), "", "emptied it");
  await app.page.keyboard.press("Delete");
  await app.page.waitForTimeout(150);
  assert.equal((await app.model()).byKind.line, 4, "and an empty, focused command line deleted nothing either");
  await app.repl("select()");
});

test("the selection reads on a solid's light faces, rimmed as every light mark is there", async () => {
  await app.type('extrude("l1", 20)');
  await app.repl("orbit(0.6, 0.5)");
  await app.page.waitForTimeout(150);
  const feature = await app.repl('ls().filter((l) => l.startsWith("e1")).length');
  assert.equal(feature.value, 1, "a solid to look at");
  // Every edge of the lid: the twins the extrude made.
  const lid = await app.repl('model.features.get("e1").twins[0]');
  await app.repl(`select(...${JSON.stringify(lid.value)})`);
  await park();
  await shot("2-lid-selected");
  // Somewhere along the first lid edge, the violet is drawn.
  const twin = (lid.value as string[])[0];
  const refs = await app.repl(`model.line("${twin}").refs`);
  const [a, b] = refs.value as string[];
  const m = await app.model();
  const [pa, pb] = await Promise.all([app.screenOf(m.points[a]), app.screenOf(m.points[b])]);
  const mid: [number, number] = [Math.round((pa[0] + pb[0]) / 2), Math.round((pa[1] + pb[1]) / 2)];
  assert.equal(await violetNear(...mid), true, "a selected lid edge is violet over the faces");
  await app.repl("select()");
  await app.repl("orbit(-0.6, -0.5)");
});

test("no uncaught page errors", () => {
  assert.deepEqual(app.pageErrors, []);
});
