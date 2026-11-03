// Groups, hide and show, driven the way a user drives them (docs/plans/
// groups.md, phase 1): a rectangle and a circle drawn, the rectangle boxed and
// grouped from the right-click menu, two edges shift-clicked and grouped, a
// group selected from a member's menu, the rectangle extruded and its sketch
// hidden — the solid stays, the sketch is gone from the picture and the hand —
// everything shown again, the Delete key on a selection, every step undone,
// and a file with groups and a hidden group saved and opened.
//
// Set NEOCAD_E2E_SHOTS to a directory to keep the screenshots; look at them.
// The two that matter are the selection on the dark ground and on a solid's
// light faces.

import { test, before, after } from "node:test";
import assert from "node:assert/strict";
import { mkdirSync } from "node:fs";
import { join } from "node:path";
import { openApp, axisFrame, type AppContext } from "./harness.ts";

let app: AppContext;
before(async () => {
  app = await openApp();
  await axisFrame(app, [-150, -110]); // parked clear of everything drawn below
});
after(async () => { await app.close(); });

const SHOTS = process.env.NEOCAD_E2E_SHOTS;
async function shot(name: string): Promise<void> {
  if (!SHOTS) return;
  mkdirSync(SHOTS, { recursive: true });
  await app.page.screenshot({ path: join(SHOTS, `groups-${name}.png`) });
}

/** Empty canvas, clear of the drawing, the frame and every panel. */
const EMPTY: [number, number] = [930, 160];

async function press(sx: number, sy: number, button: "left" | "right" = "left", shift = false): Promise<void> {
  const at = await app.at(sx, sy);
  await app.page.mouse.move(at.x, at.y);
  if (shift) await app.page.keyboard.down("Shift");
  await app.page.mouse.down({ button });
  await app.page.mouse.up({ button });
  if (shift) await app.page.keyboard.up("Shift");
  await app.page.waitForTimeout(160);
}

async function drag(from: [number, number], to: [number, number]): Promise<void> {
  const a = await app.at(...from);
  const b = await app.at(...to);
  await app.page.mouse.move(a.x, a.y);
  await app.page.mouse.down();
  await app.page.mouse.move(b.x, b.y, { steps: 8 });
  await app.page.mouse.up();
  await app.page.waitForTimeout(220);
}

async function items(): Promise<string[]> {
  return app.page.$$eval("#ctxmenu .item", (els) => els.map((el) => el.firstElementChild?.textContent ?? ""));
}

async function choose(label: string): Promise<string> {
  const handle = await app.page.evaluateHandle((want) => {
    const rows = Array.from(document.querySelectorAll("#ctxmenu .item"));
    return rows.find((el) => el.firstElementChild?.textContent === want) ?? null;
  }, label);
  const el = handle.asElement();
  assert.ok(el, `no menu item labelled ${JSON.stringify(label)} — had ${(await items()).join(", ")}`);
  const command = await el.evaluate((row) => row.querySelector(".cmd")?.textContent ?? "");
  await el.click();
  await app.page.waitForTimeout(250);
  return command;
}

async function key(k: string): Promise<void> {
  await app.page.keyboard.press(k);
  await app.page.waitForTimeout(250);
}

/** Where a line's middle is drawn now. */
async function midOf(line: string): Promise<[number, number]> {
  const m = await app.model();
  const l = m.lines.find((x) => x.name === line)!;
  const [a, b] = await Promise.all(l.refs.map((p) => app.screenOf(m.points[p])));
  return [Math.round((a[0] + b[0]) / 2), Math.round((a[1] + b[1]) / 2)];
}

/** What the cursor finds at (sx, sy) — the engine's own pick. */
async function pickAt(sx: number, sy: number): Promise<string | null> {
  const at = await app.at(sx, sy);
  await app.page.mouse.move(at.x, at.y);
  await app.page.waitForTimeout(120);
  return (await app.repl("hover()")).value as string | null;
}

async function hoverTag(): Promise<string> {
  return app.page.$eval("#hovertag", (el) => ((el as HTMLElement).hidden ? "" : el.textContent ?? ""));
}

const value = async (src: string) => (await app.repl(src)).value;

/** The rectangle's four lines and four corners, learnt once it is drawn. */
let rect: { lines: string[]; points: string[] };
let circle: string;

test("draw a rectangle and a circle", async () => {
  await app.type("rectangle");
  await drag([420, 240], [620, 400]);
  await app.type("circ(pt(85, 0), 15)");
  const m = await app.model();
  const lines = m.lines.map((l) => l.name);
  assert.equal(lines.length, 4);
  rect = { lines, points: [...new Set(m.lines.flatMap((l) => l.refs))] };
  circle = m.circles[0].name;
  assert.equal(await app.status(), "SOLVED");
});

test("box-select the rectangle, right-click a selected edge → Group: g1 in the log and on hover", async () => {
  await app.page.fill("#cmd", "");
  await drag([395, 215], [645, 425]);
  const selected = await app.selection();
  assert.deepEqual([...selected].sort(), [...rect.points, ...rect.lines].sort(), "the box selected the rectangle");
  await shot("1-selected-on-the-ground");

  await press(...await midOf(rect.lines[0]), "right");
  assert.deepEqual((await items()).slice(0, 3), ["Group", "Delete", "Hide"]);
  const typed = await choose("Group");
  assert.match(typed, /^group\(/);
  assert.match(await app.log(), /> group\(.*\)\s*g1/s, "the log shows the line typed and its answer");
  assert.deepEqual([...(await value('members("g1")') as string[])].sort(), [...selected].sort());

  await app.page.mouse.move(0, 0);
  await pickAt(...await midOf(rect.lines[1]));
  assert.match(await hoverTag(), / {2}· {2}g1$/, `the tag ends with the group: ${await hoverTag()}`);
});

test("click empty canvas, shift-click two edges, Group: g2 — overlapping g1", async () => {
  await press(...EMPTY);
  assert.deepEqual(await app.selection(), [], "empty canvas cleared the selection");
  await press(...await midOf(rect.lines[0]));
  await press(...await midOf(rect.lines[2]), "left", true);
  assert.deepEqual(await app.selection(), [rect.lines[0], rect.lines[2]]);
  await press(...await midOf(rect.lines[2]), "right");
  assert.equal(await choose("Group"), `group("${rect.lines[0]}", "${rect.lines[2]}")`);
  assert.deepEqual(await value(`groups("${rect.lines[0]}")`), ["g1", "g2"], "membership overlaps");
  await pickAt(...await midOf(rect.lines[2]));
  assert.match(await hoverTag(), / {2}· {2}g1 g2$/);
});

test("select g1 from a member's menu", async () => {
  await press(...EMPTY);
  const m = await app.model();
  const corner = await app.screenOf(m.points[rect.points[0]]);
  await press(Math.round(corner[0]), Math.round(corner[1]), "right");
  assert.ok((await items()).includes("Select g1"), `items: ${(await items()).join(", ")}`);
  assert.equal(await choose("Select g1"), 'select("g1")');
  assert.deepEqual([...(await app.selection())].sort(), [...rect.points, ...rect.lines].sort());
});

/** The sketch line whose middle the cursor reaches once the solid is up — a front edge. */
let front: { line: string; at: [number, number] };

test("extrude the rectangle and turn the view; the selection reads on the solid's light faces", async () => {
  await app.type(`extrude("${rect.lines[0]}", 25)`);
  await app.type("orbit(0.5, 0.6)");
  assert.equal((await app.model()).journalOps.filter((o) => o === "extrude").length, 1);
  for (const line of rect.lines) {
    const at = await midOf(line);
    if (await pickAt(...at) === line) { front = { line, at }; break; }
  }
  assert.ok(front, "some edge of the sketch is in sight at its middle");
  await app.repl('select("g1")');
  await app.page.mouse.move(0, 0);
  await app.page.waitForTimeout(150);
  await shot("2-selected-on-the-solid");
});

test("hide the sketch group from the menu: the solid stays, the sketch is gone from the picture and cannot be clicked", async () => {
  const listed = await value("ls().length");
  const sel = await app.selection();
  await press(...front.at, "right");
  assert.equal(await choose("Hide"), `hide(${sel.map((n) => `"${n}"`).join(", ")})`);
  assert.deepEqual(await app.selection(), [], "what is hidden has left the selection");
  assert.equal(await value("ls().length"), listed, "nothing was deleted");
  // The solid's faces are still drawn: what they hide is still worked out.
  const faced = await app.page.evaluate(() =>
    (window as never as { __neocad: { engine: { occlusion: unknown } } }).__neocad.engine.occlusion !== null);
  assert.equal(faced, true, "the solid's faces are drawn");
  assert.notEqual(await pickAt(...front.at), front.line, "the hidden edge cannot be hovered");
  await press(...front.at);
  assert.ok(!(await app.selection()).includes(front.line), "nor clicked");
  await app.page.mouse.move(0, 0);
  await app.page.waitForTimeout(150);
  await shot("3-sketch-hidden");
  assert.equal(await app.status(), "SOLVED", "and it is all still solved");
});

test("Show all, from the empty-canvas menu", async () => {
  await press(...EMPTY, "right");
  assert.equal(await choose("Show all"), "show()");
  assert.equal(await pickAt(...front.at), front.line, "the edge is back under the hand");
});

test("the Delete key deletes the selection — and the cascade empties nothing it should not", async () => {
  await press(...EMPTY);
  await app.repl(`select("${circle}")`);
  // The press on the canvas above took the focus off the command line, as a
  // hand's does; the key is the drawing's.
  await key("Delete");
  assert.match(await app.log(), new RegExp(`> del\\("${circle}"\\)`));
  assert.equal((await app.model()).byKind.circle ?? 0, 0);
  assert.deepEqual(await value("groups()"), ["g1", "g2"]);
});

test("every step undoes, one Ctrl+Z each — and redoes", async () => {
  const state = async () => ({
    circles: (await app.model()).byKind.circle ?? 0,
    hidden: ((await value("ls()")) as string[]).filter((l) => l.endsWith("(hidden)")).length,
    features: (await app.model()).journalOps.filter((o) => o === "extrude").length,
    groups: (await value("groups()")) as string[],
  });
  const now = await state();
  assert.deepEqual(now, { circles: 0, hidden: 0, features: 1, groups: ["g1", "g2"] });
  const seen = [now];
  // Delete, show, hide, the orbit (not a step), the extrude, then the two groups.
  for (let i = 0; i < 5; i++) {
    await key("Control+z");
    seen.push(await state());
  }
  assert.deepEqual(seen.map((s) => [s.circles, s.hidden > 0, s.features, (s.groups as string[]).join(" ")]), [
    [0, false, 1, "g1 g2"],
    [1, false, 1, "g1 g2"], // the delete undone
    [1, true, 1, "g1 g2"],  // the show undone: hidden again
    [1, false, 1, "g1 g2"], // the hide undone
    [1, false, 0, "g1 g2"], // the extrude undone
    [1, false, 0, "g1"],    // the second group undone
  ]);
  await key("Control+z");
  assert.deepEqual(await value("groups()"), [], "the first group undone");
  for (let i = 0; i < 4; i++) await key("Control+y");
  assert.deepEqual(await state(), { circles: 1, hidden: 8, features: 1, groups: ["g1", "g2"] },
    "redone as far as the hide");
});

test("save and open with groups and a hidden group in the history", async () => {
  await app.type("t = save()");
  await app.type("open(t)");
  assert.deepEqual(await value("groups()"), ["g1", "g2"]);
  assert.deepEqual(await value('members("g2")'), [rect.lines[0], rect.lines[2]]);
  const hidden = ((await value("ls()")) as string[]).filter((l) => l.endsWith("(hidden)")).map((l) => l.split(/\s+/)[0]);
  assert.deepEqual(hidden.sort(), [...rect.points, ...rect.lines].sort(), "g1 is still hidden");
  assert.equal(await value("save() === t"), true, "and saving again is the same file, byte for byte");
  assert.notEqual(await pickAt(...front.at), front.line, "the reopened drawing hides it from the hand too");
});

test("with text in the command line a click still inserts a name", async () => {
  await app.type("show()");
  await app.page.fill("#cmd", "members(");
  await press(...front.at);
  assert.equal(await app.page.inputValue("#cmd"), `members("${front.line}"`);
  await app.page.fill("#cmd", "");
});

test("no uncaught page errors", () => {
  assert.deepEqual(app.pageErrors, []);
});
