// A tool's options, visible and editable where the tool is used — the owner's
// standing direction (docs/plans/effortless.md): *"if the tool has options,
// there should also be some kind of e.g. pop-up menu that allows me to set them
// visually, or it happens in the terminal or whatever"*. Both, as one thing:
// arming a tool that declares options shows a small panel beside the tray, a
// field edited there types `arm("extrude", {depth: 25})` through the command
// line, and the value is remembered as the next default — across a reload,
// since it is the viewer's, like the layout.
//
// Driven pointer-first and checked the way the toolbar is: by the log (the
// panel types), the model (the extrude really is 25 deep), and the panel's
// rectangle (beside the tray, gone when the tool is, pushing and pushed). Set
// NEOCAD_E2E_SHOTS to a directory to keep the pictures — and look at them.
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
  assert.deepEqual(app.pageErrors, [], "nothing the page threw went uncaught — no overlap reported either");
  await app.close();
});

interface Box { x: number; y: number; width: number; height: number }
const rectOf = (selector: string): Promise<Box> => app.page.$eval(selector, (el) => {
  const r = el.getBoundingClientRect();
  return { x: r.x, y: r.y, width: r.width, height: r.height };
});
const PANEL = '.panel[data-panel="options"]';
const FIELD = (option: string) => `${PANEL} input[data-option="${option}"]`;
const visible = () => app.page.$eval(PANEL, (el) => !(el as HTMLElement).hidden && (el as HTMLElement).offsetWidth > 0);
const field = (option: string) => app.page.inputValue(FIELD(option));
const strip = () => app.page.$eval(`${PANEL} > .ptitle`, (el) => el.textContent);
const logLines = (): Promise<{ text: string; cls: string }[]> => app.page.$$eval("#log > div",
  (els) => els.map((el) => ({ text: el.textContent ?? "", cls: el.className })));

const SHOTS = process.env.NEOCAD_E2E_SHOTS;
/** The tray and the options panel together at their own size, and the whole window. */
async function shot(name: string): Promise<void> {
  if (!SHOTS) return;
  mkdirSync(SHOTS, { recursive: true });
  await app.page.waitForTimeout(120);
  const tb = await rectOf('.panel[data-panel="toolbar"]');
  const op = await rectOf(PANEL);
  const m = 12;
  const x0 = Math.max(0, Math.min(tb.x, op.x) - m), y0 = Math.max(0, Math.min(tb.y, op.y) - m);
  const x1 = Math.max(tb.x + tb.width, op.x + op.width) + m, y1 = Math.max(tb.y + tb.height, op.y + op.height) + m;
  await app.page.screenshot({ path: join(SHOTS, `tooloptions-${name}-panel.png`), clip: { x: x0, y: y0, width: x1 - x0, height: y1 - y0 } });
  await app.page.screenshot({ path: join(SHOTS, `tooloptions-${name}.png`) });
}

async function press(tool: string): Promise<void> {
  const b = await rectOf(`#toolbar button[data-tool="${tool}"]`);
  await app.page.mouse.click(b.x + b.width / 2, b.y + b.height / 2);
  await app.page.waitForTimeout(80);
  assert.equal((await app.model()).activeTool, tool, `${tool} armed by its button`);
}

async function clickAt(sx: number, sy: number): Promise<void> {
  const at = await app.at(sx, sy);
  await app.page.mouse.move(at.x, at.y, { steps: 3 });
  await app.page.waitForTimeout(80);
  await app.page.mouse.click(at.x, at.y);
  await app.page.waitForTimeout(300);
}

/** Replaces a field's text as a hand does: click into it, select it all, type. */
async function typeInto(option: string, text: string): Promise<void> {
  await app.page.click(FIELD(option), { clickCount: 3 });
  await app.page.keyboard.press("Control+A");
  await app.page.keyboard.type(text);
}

/** How deep the drawing is along z: a sketch at z = 0 and a lid where the extrude put it. */
async function zExtent(): Promise<number> {
  const zs = Object.values((await app.model()).points).map((p) => p[2] ?? 0);
  return Math.max(...zs) - Math.min(...zs);
}

async function reloadApp(): Promise<void> {
  await app.page.reload({ waitUntil: "networkidle" });
  await app.page.waitForFunction(() => document.getElementById("status")?.textContent?.includes("ready"));
}

const RECT: [[number, number], [number, number]] = [[460, 320], [660, 480]];
const INSIDE: [number, number] = [560, 400];

test("nothing armed, no options panel; the rectangle tool, which has none, shows none either", async () => {
  assert.equal(await visible(), false);
  await press("rectangle");
  assert.equal(await visible(), false, "a tool without options gets no panel");
  const p = await app.at(...RECT[0]), q = await app.at(...RECT[1]);
  await app.page.mouse.move(p.x, p.y);
  await app.page.mouse.down();
  await app.page.mouse.move(q.x, q.y, { steps: 8 });
  await app.page.mouse.up();
  await app.page.waitForTimeout(250);
  assert.equal((await app.model()).byKind.line, 4);
});

test("arming extrude by its button shows the options panel beside the tray: depth, 10, ✓ and ✗, no grips", async () => {
  await press("extrude");
  assert.equal(await visible(), true);
  assert.equal(await strip(), "extrude", "the strip names the tool");
  assert.equal(await field("depth"), "10");
  const labels = await app.page.$$eval(`${PANEL} .olabel`, (els) => els.map((el) => el.textContent));
  assert.deepEqual(labels, ["depth"]);
  const tb = await rectOf('.panel[data-panel="toolbar"]');
  const op = await rectOf(PANEL);
  assert.equal(op.x, tb.x + tb.width + 8, "beside the column, a margin off it, on its free side");
  assert.equal(op.y, tb.y, "lined up with its top");
  assert.equal(op.height, 16 + 8 + 2 * 22, "strip, padding, border, the depth's row and the ✓ ✗ row");
  assert.deepEqual(await app.page.$$eval(`${PANEL} .oact button`, (els) => els.map((el) => el.textContent)), ["✓", "✗"]);
  assert.equal(await app.page.$$eval(`${PANEL} > .pgrip`, (els) => els.length), 0, "not resizable");
  await shot("armed");
});

test("25 typed in the field and Enter: the log shows the arm line it typed, and the next extrude is 25 deep", async () => {
  const from = (await logLines()).length;
  await typeInto("depth", "25");
  await app.page.keyboard.press("Enter");
  await app.page.waitForTimeout(150);
  const lines = (await logLines()).slice(from);
  assert.deepEqual(lines.slice(0, 2).map((l) => l.text), ['> arm("extrude", {depth: 25})', "armed: extrude"]);
  assert.deepEqual(lines.filter((l) => l.cls === "err"), [], "nothing red");
  assert.equal(await field("depth"), "25");
  assert.equal((await app.model()).activeTool, "extrude", "still armed");
  const listed = (await app.repl("tools()")).value as string[];
  assert.deepEqual(listed.filter((t) => t.startsWith("extrude")), ["extrude  { depth: 25 }  (default { depth: 10 })"],
    "tools() lists what arm would use now");
  await shot("typed");

  await clickAt(...INSIDE);
  await app.page.fill("#cmd", "");
  await app.page.keyboard.press("Enter");
  await app.page.waitForTimeout(250);
  assert.ok((await logLines()).some((l) => /^> plane\(/.test(l.text)), "the frameless rectangle got its plane, typed");
  assert.ok((await logLines()).some((l) => /^> extrude\("l\d+", 25\)$/.test(l.text)), "and the extrude, 25 deep");
  assert.ok(Math.abs((await zExtent()) - 25) < 1e-6, `25 deep: ${await zExtent()}`);
});

test("the extrude done, the tool is released and the panel goes; re-armed, 25 is remembered", async () => {
  // A confirm releases the tool, as Onshape's ✓ closes its dialog.
  assert.equal((await app.model()).activeTool, null, "released by the confirm");
  assert.equal(await visible(), false, "gone with the tool");
  await press("extrude");
  assert.equal(await visible(), true);
  assert.equal(await field("depth"), "25", "the last value is the default now");
  await app.page.keyboard.press("Escape");
  await app.page.waitForTimeout(80);
  assert.equal(await visible(), false, "Escape releases the tool, and the panel goes with it");
});

test("reloaded, still 25 — the viewer's, like the layout — and never in the journal or the file", async () => {
  await reloadApp();
  await press("extrude");
  assert.equal(await field("depth"), "25");
  const saved = (await app.repl("save()")).value as string;
  assert.doesNotMatch(saved, /depth"?\s*:\s*25/, "the saved file knows nothing of it");
  const stored = await app.page.evaluate(() => localStorage.getItem("neocad.toolOptions.v1"));
  assert.deepEqual(JSON.parse(stored!), { extrude: { depth: 25 } }, "under its own key");
});

test("arm typed by hand shows in the panel, and a refused one leaves the panel and the tool as they were", async () => {
  await app.type('arm("extrude", { depth: 40 })');
  assert.equal(await field("depth"), "40");
  await app.type('arm("extrude", { dpth: 3 })');
  const last = (await logLines()).at(-1)!;
  assert.match(last.text, /extrude has no option "dpth" — its options are \{ depth: 10 \}/);
  assert.equal(await field("depth"), "40");
  assert.equal((await app.model()).activeTool, "extrude", "a typo did not disarm it");
});

test("Escape in the field puts the value back and keeps the tool; text that is not a number does too", async () => {
  const from = (await logLines()).length;
  await typeInto("depth", "77");
  await app.page.keyboard.press("Escape");
  await app.page.waitForTimeout(80);
  assert.equal(await field("depth"), "40");
  assert.equal((await app.model()).activeTool, "extrude", "the field's Escape is the field's");
  await typeInto("depth", "deep");
  await app.page.keyboard.press("Enter");
  await app.page.waitForTimeout(80);
  assert.equal(await field("depth"), "40");
  assert.deepEqual((await logLines()).slice(from).filter((l) => l.text.startsWith("> ")), [], "neither typed anything");
});

test("a field left mid-edit commits before the click that leaves it is handled", async () => {
  assert.equal((await app.model()).activeTool, "extrude");
  const from = (await logLines()).length;
  await typeInto("depth", "12");
  await clickAt(850, 200); // empty canvas: a miss, answered with guidance
  const lines = (await logLines()).slice(from).map((l) => l.text);
  assert.equal(lines[0], '> arm("extrude", {depth: 12})', `the edit, first: ${lines.join(" | ")}`);
  assert.equal(await field("depth"), "12");
});

test("a tool defined at the command line with a static options gets the panel, a flag as a checkbox", async () => {
  await app.type('defineTool("gear", class extends Tool { name = "gear"; static options = { teeth: { default: 12, unit: "teeth" }, flip: { default: false, label: "flip it" } }; })');
  await app.type('arm("gear")');
  assert.equal(await visible(), true);
  assert.equal(await strip(), "gear");
  const rows = await app.page.$$eval(`${PANEL} .orow`, (els) => els.map((el) => ({
    label: el.querySelector(".olabel")!.textContent, unit: el.querySelector(".ounit")!.textContent,
    type: (el.querySelector("input") as HTMLInputElement).type,
  })));
  assert.deepEqual(rows, [{ label: "teeth", unit: "teeth", type: "text" }, { label: "flip it", unit: "", type: "checkbox" }]);
  assert.equal((await rectOf(PANEL)).height, 16 + 8 + 2 * 22, "two rows");
  await app.page.click(FIELD("flip"));
  await app.page.waitForTimeout(120);
  assert.equal((await logLines()).find((l) => l.text === '> arm("gear", {flip: true})')?.cls, "in", "the checkbox types too");
  assert.equal(await app.page.isChecked(FIELD("flip")), true);
  await shot("gear");
  await app.type('arm("line")');
  assert.equal(await visible(), false, "a tool with none, none");
  await app.type("cancel()");
});

test("the panel pushes and is pushed like any panel, and its place is the viewer's across a reload", async () => {
  await app.type('arm("extrude")');
  const dragStrip = async (selector: string, dx: number, dy: number) => {
    const s = await rectOf(`${selector} > .ptitle`);
    await app.page.mouse.move(s.x + s.width / 2, s.y + s.height / 2);
    await app.page.mouse.down();
    await app.page.mouse.move(s.x + s.width / 2 + dx, s.y + s.height / 2 + dy, { steps: 10 });
    await app.page.mouse.up();
    await app.page.waitForTimeout(100);
  };
  const LOG = '.panel[data-panel="log"]';
  await dragStrip(PANEL, 300, 200); // out into the drawing, over the log's columns
  await dragStrip(LOG, 60, 0); // and the log out from under the tray's column, so only the options panel is above it
  const op = await rectOf(PANEL);
  const log0 = await rectOf(LOG);
  assert.ok(op.x < log0.x + log0.width && op.x + op.width > log0.x, "above the log, sharing its columns");

  // The log dragged up into it pushes it up by exactly the overlap.
  const into = log0.y - (op.y + op.height) + 40;
  await dragStrip(LOG, 0, -into);
  const pushedUp = await rectOf(PANEL);
  const log1 = await rectOf(LOG);
  assert.ok(Math.abs(pushedUp.y - (op.y - 40)) <= 1, `pushed up by the 40 px it was covered: ${op.y} → ${pushedUp.y}; log ${JSON.stringify(log0)} → ${JSON.stringify(log1)}, options ${JSON.stringify(op)}`);
  assert.ok(pushedUp.y + pushedUp.height <= log1.y + 0.5, "flush, not over it");

  // It dragged down into the log pushes the log down.
  await dragStrip(PANEL, 0, 30 + (log1.y - (pushedUp.y + pushedUp.height)));
  const log2 = await rectOf(LOG);
  const op2 = await rectOf(PANEL);
  assert.ok(log2.y > log1.y + 25, `the log was pushed down: ${log1.y} → ${log2.y}`);
  assert.ok(op2.y + op2.height <= log2.y + 0.5, "and nothing overlaps");
  await shot("moved");

  await reloadApp();
  await press("extrude");
  const back = await rectOf(PANEL);
  assert.ok(Math.abs(back.x - op2.x) <= 0.5 && Math.abs(back.y - op2.y) <= 0.5, "where the viewer left it");
  await app.type('layout("reset")');
  await app.page.waitForTimeout(80);
  const tb = await rectOf('.panel[data-panel="toolbar"]');
  assert.equal((await rectOf(PANEL)).x, tb.x + tb.width + 8, "and back beside the tray on a reset");
});
