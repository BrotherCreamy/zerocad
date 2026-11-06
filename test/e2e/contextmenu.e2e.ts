// The right-click menu, in a browser, with a real mouse.
//
// Two things here can only be answered by a browser, and both are the reason
// the package exists rather than incidental to it.
//
// The first is the gesture. Right-press-and-release opens a menu; right-*drag*
// still pans. Nothing but a real pointer stream decides that correctly — the
// engine sees a press, some number of moves, and a release, and the split
// between the two lives entirely in whether those moves crossed three pixels.
//
// The second is that **an item is a shortcut to a command and nothing more**.
// The way to check that is not to inspect the menu's code but to click an item
// and then read the log, the journal and the undo stack: if Dimension really is
// `dist(...)` typed for you, then the log shows the line, the journal gains the
// relation and one Ctrl+Z takes the whole thing back. If it were anything else,
// at least one of those three would disagree.

import { test, before, after } from "node:test";
import assert from "node:assert/strict";
import { openApp, axisFrame, type AppContext } from "./harness.ts";

let app: AppContext;
before(async () => {
  app = await openApp();
  await axisFrame(app, [-70, -70]); // parked well clear of everything drawn below
});
after(async () => { await app.close(); });

/** Right-press and release in the same place: the gesture that opens a menu. */
async function rightClick(sx: number, sy: number): Promise<void> {
  const at = await app.at(sx, sy);
  await app.page.mouse.move(at.x, at.y);
  await app.page.mouse.down({ button: "right" });
  await app.page.mouse.up({ button: "right" });
  await app.page.waitForTimeout(120);
}

async function menuOpen(): Promise<boolean> {
  return app.page.$eval("#ctxmenu", (el) => !(el as HTMLElement).hidden);
}

async function header(): Promise<string> {
  return app.page.$eval("#ctxmenu", (el) => el.querySelector(".head")?.textContent ?? "");
}

/** The item labels on the open menu, in order. */
async function items(): Promise<string[]> {
  return app.page.$$eval("#ctxmenu .item", (els) =>
    els.map((el) => el.firstElementChild?.textContent ?? ""));
}

/** The command each item advertises beside its label. */
async function commands(): Promise<Record<string, string>> {
  return app.page.$$eval("#ctxmenu .item", (els) =>
    Object.fromEntries(els.map((el) => [
      el.firstElementChild?.textContent ?? "",
      el.querySelector(".cmd")?.textContent ?? "",
    ])));
}

async function choose(label: string): Promise<void> {
  const handle = await app.page.evaluateHandle((want) => {
    const rows = Array.from(document.querySelectorAll("#ctxmenu .item"));
    return rows.find((el) => el.firstElementChild?.textContent === want) ?? null;
  }, label);
  const el = handle.asElement();
  assert.ok(el, `no menu item labelled ${JSON.stringify(label)} — had ${(await items()).join(", ")}`);
  await el.click();
  await app.page.waitForTimeout(200);
}

/** Canvas-relative screen position of a named entity's point, as the app computes it. */
async function screenOf(name: string): Promise<[number, number]> {
  return app.page.evaluate((n) => {
    const { model, engine } = (window as never as {
      __neocad: { model: { coords(x: string): number[] }; engine: { worldToScreen(w: number[]): [number, number] } };
    }).__neocad;
    return engine.worldToScreen(model.coords(n));
  }, name);
}

async function undoKey(): Promise<void> {
  await app.page.keyboard.press("Control+z");
  await app.page.waitForTimeout(220);
}

async function dragFromTo(from: [number, number], to: [number, number]) {
  const a = await app.at(...from);
  const b = await app.at(...to);
  await app.page.mouse.move(a.x, a.y);
  await app.page.mouse.down();
  await app.page.mouse.move(b.x, b.y, { steps: 8 });
  await app.page.mouse.up();
  await app.page.waitForTimeout(220);
}

test("the empty-canvas menu arms a tool, and the log shows the command it typed", async () => {
  await rightClick(520, 160);
  assert.ok(await menuOpen(), "a right press released where it landed opens the menu");
  assert.equal(await header(), "", "there is nothing to name on empty canvas");
  // Undo and Redo end every menu (see undokeys.e2e.ts for what they do).
  assert.deepEqual(await items(), [
    // One circle and one arc (docs/plans/one-circle-one-arc.md); the shapes
    // group's polygon and slot under the rectangle's heading, and the ellipse
    // (docs/plans/sketch-shapes.md). A heading is no item.
    // The modify group whole: the sketch's corner fillet and the solids module's round and chamfer (docs/plans/solid-fillets.md).
    "Point", "Line", "Rectangle", "Polygon", "Slot", "Region", "Circle", "Arc", "Ellipse", "Fillet", "Chamfer", "Round", "Frame",
    "Undo", "Redo",
  ]);
  // The commands are on the menu, not hidden behind it: this is a shortcut to
  // the command line rather than a fourth way to edit the drawing.
  assert.equal((await commands()).Rectangle, 'arm("rectangle")');
  // A frame already exists (the fixture), so the item is the plain constructor.
  assert.equal((await commands()).Frame, "frame()");

  await choose("Rectangle");
  assert.equal(await menuOpen(), false, "choosing an item closes the menu");
  assert.equal((await app.model()).activeTool, "rectangle", "the tool is armed");
  assert.match(await app.log(), /> arm\("rectangle"\)/, "and the log shows what was typed");

  await dragFromTo([200, 120], [380, 260]);
  assert.equal((await app.model()).byKind.line, 4, "the armed tool then works like any other");
  assert.equal(await app.status(), "SOLVED");
});

test("Dimension on an edge holds it at the length it already has", async () => {
  const before = await app.model();
  const l = before.lines[0];
  const [a, b] = [before.points[l.refs[0]], before.points[l.refs[1]]];
  const length = Math.hypot(b[0] - a[0], b[1] - a[1]);

  // Right-click the middle of that edge.
  const [ax, ay] = await screenOf(l.refs[0]);
  const [bx, by] = await screenOf(l.refs[1]);
  await rightClick((ax + bx) / 2, (ay + by) / 2);

  assert.match(await header(), new RegExp(`^${l.name}\\b`), "the menu names what it is about");
  assert.deepEqual(await items(), ["Insert name", "Delete", "Dimension", "Construction", "Undo", "Redo"]);
  const command = (await commands()).Dimension;
  assert.match(command, /^dist\("p\d+", "p\d+", [\d.]+\)$/, `Dimension typed ${command}`);
  const asked = Number(/, ([\d.]+)\)$/.exec(command)![1]);
  assert.ok(Math.abs(asked - length) < 0.01,
    `the value should be the current measurement ${length}, not ${asked}`);

  const relsBefore = ((await app.repl("rels()")).value as string[]).length;
  await choose("Dimension");

  assert.equal(await menuOpen(), false);
  assert.match(await app.log(), new RegExp(`> ${command.replace(/[()"]/g, "\\$&")}`),
    "the log records exactly the command the item advertised");
  const rels = (await app.repl("rels()")).value as string[];
  assert.equal(rels.length, relsBefore + 1, "one relation, not two");
  assert.ok(rels.some((r) => /dist/.test(r)), `a dist was added: ${rels.join(" | ")}`);
  assert.equal(await app.status(), "SOLVED", "the drawing already satisfied it, so nothing conflicts");

  // "Hold it where it is": the geometry did not move.
  const after = await app.model();
  for (const [name, at] of Object.entries(before.points)) {
    assert.ok(Math.hypot(after.points[name][0] - at[0], after.points[name][1] - at[1]) < 0.01,
      `${name} moved from ${at} to ${after.points[name]} — a current-value dimension must not`);
  }
});

test("that whole action was one undo step, and journalled as the command it typed", async () => {
  const ops = (await app.model()).journalOps;
  assert.equal(ops[ops.length - 1], "dist", "the journal gained the relation, not a menu entry");
  assert.ok(!ops.some((op) => /menu|context/i.test(op)), `no menu op in ${ops.join(",")}`);

  const rels = ((await app.repl("rels()")).value as string[]).length;
  await undoKey();
  assert.equal(((await app.repl("rels()")).value as string[]).length, rels - 1,
    "one keystroke took the whole thing back");
  assert.equal(await app.status(), "SOLVED");
});

test("Delete on a constraint glyph removes that relation", async () => {
  // Give the drawing a constraint with a mark of its own to aim at, then click
  // the mark rather than the geometry — the glyph tier is what makes a relation
  // right-clickable at all.
  await app.type('dist("p1", "p2", 60)');
  const relation = (await app.repl("rels()")).value as string[];
  const name = relation[relation.length - 1].split(/\s+/)[0];

  const at = await app.page.evaluate((r) => {
    const { engine } = (window as never as {
      __neocad: { engine: { glyphs(): { relation: string; screen: [number, number] }[] } };
    }).__neocad;
    return engine.glyphs().find((g) => g.relation === r)?.screen ?? null;
  }, name);
  assert.ok(at, `no glyph on screen for ${name}`);

  await rightClick(at![0], at![1]);
  assert.equal(await header(), `${name}  dist p1 p2 60`, "the header is the relation, spelled as typed");
  // A `dist` is a dimension, so it has a value to set as well as a relation to
  // delete. A constraint glyph gets Delete alone — that pair is covered in the
  // unit suite, and the Set value… item is exercised in its own test below.
  assert.deepEqual(await items(), ["Set value…", "Delete", "Undo", "Redo"]);
  assert.equal((await commands()).Delete, `del("${name}")`);

  await choose("Delete");
  assert.ok(!((await app.repl("rels()")).value as string[]).some((r) => r.startsWith(`${name} `)),
    "the relation is gone");
  assert.match(await app.log(), new RegExp(`> del\\("${name}"\\)`));
  assert.equal(await app.status(), "SOLVED");
});

test("with no default frame, Fix is in the origin's coordinates — and choosing it makes no frame", async () => {
  const [sx, sy] = await screenOf("p1");
  await rightClick(sx, sy);
  assert.deepEqual(await items(), ["Insert name", "Delete", "Fix", "Undo", "Redo"], "a point has no natural dimension");
  // Three frame coordinates: the app is 3D, and so is the fixture frame.
  assert.match((await commands()).Fix, /^fix\("p1", \[-?[\d.]+, -?[\d.]+, -?[\d.]+\]\)$/,
    "with a frame set, Fix is a command like any other");

  await app.page.keyboard.press("Escape");
  await app.type("setDefaultFrame(null)");

  // This used to be shown disabled, "no default frame — frame() then
  // setDefaultFrame()". Every document has the origin now
  // (docs/plans/frameless-curves.md), and fix with no frame named and no
  // default means it — so the item is a command like any other, in the
  // origin's coordinates (which are the kernel's: p1's own numbers).
  await rightClick(sx, sy);
  const off = (await app.page.$$eval("#ctxmenu .item.off", (els) => els.map((e) => e.textContent ?? "")))
    .filter((label) => label !== "Undo" && label !== "Redo");
  assert.deepEqual(off, [], "Fix is not disabled");
  const p1 = (await app.model()).points.p1;
  const typed = (await commands()).Fix;
  const at = JSON.parse(typed.replace(/^fix\("p1", /, "").replace(/\)$/, "")) as number[];
  assert.ok(at.length === 3 && at.every((x, i) => Math.abs(x - p1[i]) < 1e-3), `${typed} is p1 where it is: ${p1}`);
  await app.page.keyboard.press("Escape");

  // Still never silently create a frame: choosing it fixes the point, nothing more.
  const before = (await app.model()).byKind.frame;
  await rightClick(sx, sy);
  await choose("Fix");
  assert.equal((await app.model()).byKind.frame, before, "no frame made");
  assert.equal((await app.repl("defaultFrame()")).value, null);
  assert.deepEqual((await app.repl("model.journal.at(-1)")).value, { op: "fix", args: ["p1", at, "origin"] }, "fixed in the origin");
  await app.type("undo()");
  await app.type('setDefaultFrame("f")');
});

test("Escape closes the menu; so does a press elsewhere, and that press does not also reach the canvas", async () => {
  await rightClick(520, 400);
  assert.ok(await menuOpen());
  await app.page.keyboard.press("Escape");
  assert.equal(await menuOpen(), false, "Escape closes it");

  await rightClick(520, 400);
  assert.ok(await menuOpen());
  // A left press on the canvas well away from the menu. It closes the menu and
  // is swallowed: without that, dismissing a menu would also start a selection
  // box or drop a name into the command line.
  const before = await app.page.$eval("#cmd", (el) => (el as HTMLInputElement).value);
  const away = await app.at(120, 400);
  await app.page.mouse.click(away.x, away.y);
  await app.page.waitForTimeout(150);
  assert.equal(await menuOpen(), false, "a click away closes it");
  assert.equal(await app.page.$eval("#cmd", (el) => (el as HTMLInputElement).value), before,
    "and the click that dismissed it did not also pick");
});

test("a right DRAG orbits and opens no menu — the release decides, as the register promised", async () => {
  // The promise was that a menu would cost the right button nothing, because
  // the release decides. It held through the 3D package's change of what a
  // right-drag *is* — Onshape's orbit, where in 2D it panned — because that
  // change is past the threshold and the menu is before it.
  const before = (await app.model()).view;
  const from = await app.at(500, 300);
  const to = await app.at(560, 350);
  await app.page.mouse.move(from.x, from.y);
  await app.page.mouse.down({ button: "right" });
  await app.page.mouse.move(to.x, to.y, { steps: 8 });
  await app.page.mouse.up({ button: "right" });
  await app.page.waitForTimeout(150);

  assert.equal(await menuOpen(), false, "a drag is an orbit, not a menu");
  const after = (await app.model()).view;
  assert.ok(after.right && after.up && Math.abs(after.up[2]) > 0.1,
    `the view should have turned: ${JSON.stringify(before)} → ${JSON.stringify(after)}`);

  // And square-on again, so nothing after this is drawn at an angle.
  await app.type("lookAt()");
});

test("no uncaught page errors", () => {
  assert.deepEqual(app.pageErrors, []);
});
