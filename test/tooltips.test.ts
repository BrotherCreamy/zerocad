// Tooltips on every control and frames in RGB (docs/plans/tooltips-rgb-frames.md;
// the owner: "when I hover over tools, I should see a tooltip", and "a frame
// should be coloured or something so I can tell the orientation. use rgb
// colours like solidworks").
//
// What a tooltip says and where it goes are pure functions, so they are pinned
// here: every built-in tool says what it does, the text for a tool, an action
// and a key, the placement inside the window — a mouse's beside a column and
// below anything else, a finger's above the finger and clear of it, and a
// tray's never over the tray (docs/plans/everything-fits.md) — and the
// summaries reaching `tools()` and `help()`. The frame's inks are checked
// against the hidden view's dimming. How it looks and when it shows is the
// browser's (test/e2e/tooltips.e2e.ts).

import { test } from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { ENGINE_TOOLS, ENGINE_SUMMARIES, Tool, defineTool, listTools, toolSummary } from "../src/tools/tool.ts";
import { HOLD_MS, HOLD_SLOP, FINGER_CLEAR, GAP, MARGIN, MIN_TIP_W, roomBeside, tipPlacement, tipText, type Box } from "../src/tooltip.ts";
import { actionKey, actionTip, displayName, stripTip, toolTip, type ActionState } from "../src/panels.ts";
import { addTip, eyeTip, openTip, type OrganiserRow } from "../src/organiser.ts";
import { spinTip } from "../src/appmenu.ts";
import { LONG_PRESS_MS, TAP_SLOP } from "../src/tools/gestures.ts";
import { AXIS_INKS } from "../src/framemarker.ts";
import { HIDDEN_GROUND, hiddenInk } from "../src/occlusion.ts";
import { ensureKernelLoaded } from "../src/kernel/problem.ts";
import { Model } from "../src/model.ts";
import { Repl } from "../src/repl.ts";
import { neocadScope } from "../src/replenv.ts";
import { OptionMemory } from "../src/tools/options.ts";

/** The built-ins, as main.ts registers them — read from main.ts, as icons.test.ts does, so a new tool cannot slip past. */
async function builtIns(): Promise<string[]> {
  const main = await readFile(new URL("../src/main.ts", import.meta.url), "utf8");
  const files = [...main.matchAll(/^import "\.\/(modules\/[a-z0-9]+\.ts)";$/gm)].map((m) => m[1]);
  assert.ok(files.length >= 1, `main.ts's module imports: ${files.join(", ")}`);
  for (const f of files) await import(new URL(`../src/${f}`, import.meta.url).href);
  // The edit dialogs are unlisted — never on the toolbar — and are tools all the same.
  return [...ENGINE_TOOLS, ...listTools(), "edit extrude", "edit revolve"];
}

// --- the summaries ---------------------------------------------------------

test("every built-in tool says what it does in one line of a person's words — Select and the Hand too", async () => {
  for (const name of await builtIns()) {
    const s = toolSummary(name);
    assert.ok(s, `${name} has a summary`);
    assert.doesNotMatch(s!, /\n/, `${name}: one line`);
    assert.ok(s!.length <= 70, `${name}: short enough for a tooltip (${s!.length}): ${s}`);
    assert.match(s!, /^[A-Z]/, `${name}: a sentence, said to a person: ${s}`);
    assert.doesNotMatch(s!, /\b(arm|ctx|onDown|entity|residual)\b|\(/, `${name}: in user words, not the code's: ${s}`);
  }
  assert.equal(toolSummary("rectangle"), "Draws a rectangle: drag from corner to corner", "the spec's own example");
  assert.equal(toolSummary("hand"), ENGINE_SUMMARIES.hand);
});

test("a tool from the command line may declare a summary; without one it has none, and a subclass does not inherit its parent's", async () => {
  await builtIns();
  class Stamp extends Tool {
    static readonly summary = "Stamps a point where you click";
    readonly name = "t_stamp";
  }
  defineTool("t_stamp", Stamp);
  assert.equal(toolSummary("t_stamp"), "Stamps a point where you click");
  defineTool("t_bare", class extends Tool { readonly name = "t_bare"; });
  assert.equal(toolSummary("t_bare"), null, "none: shown by its name");
  const Circle = (await import("../src/tools/circle.ts")).CircleTool;
  defineTool("t_ring", class extends Circle {});
  assert.equal(toolSummary("t_ring"), null, "a circle's subclass registered as something else does not say it draws a circle");
  assert.equal(toolSummary("nothing"), null);
  // As a tool typed at the command line could have it, which no type checks.
  const bad = class extends Tool { readonly name = "t_bad"; };
  Object.defineProperty(bad, "summary", { value: 3 });
  assert.throws(() => defineTool("t_bad", bad),
    /t_bad's static summary must be one line of text/);
  assert.equal(listTools().includes("t_bad"), false, "refused before it is registered");
});

test("tools() ends each line with what the tool does, and help() lists the toolbar with the same words", async () => {
  await ensureKernelLoaded(await readFile(new URL("../src/kernel/wasm-gen/neocad_kernel_bg.wasm", import.meta.url)));
  await builtIns();
  const repl = new Repl(neocadScope({ model: new Model(3), optionMemory: new OptionMemory(null) }));
  const listed = (await repl.eval("tools()")).value as string[];
  assert.ok(listed.includes(`select  — ${toolSummary("select")}`), listed.join("\n"));
  assert.ok(listed.includes("rectangle  { construction: false }  — Draws a rectangle: drag from corner to corner"), listed.join("\n"));
  assert.ok(listed.includes(`extrude  { depth: 10, end: "blind", mode: "auto" }  — ${toolSummary("extrude")}`));
  assert.ok(listed.includes("t_bare"), "a tool with no summary is its bare line");
  const help = (await repl.eval("help()")).value as string;
  for (const name of ["select", "hand", "rectangle", "extrude"]) {
    assert.ok(help.includes(`${name.padEnd(10)} ${toolSummary(name)}`), `help() says what ${name} does`);
  }
  assert.ok(help.includes("t_stamp    Stamps a point where you click"), "a command-line tool's summary too");
  assert.match(help, /static summary = /);
});

// --- what a tooltip says ----------------------------------------------------

test("a tool's tooltip: its name, what it does, the command it types — and the Hand's key", async () => {
  await builtIns();
  const t = toolTip("rectangle", toolSummary("rectangle"));
  assert.deepEqual(t, { name: "Rectangle", summary: "Draws a rectangle: drag from corner to corner", command: 'arm("rectangle")', key: null });
  assert.equal(tipText(t), 'Rectangle — Draws a rectangle: drag from corner to corner — arm("rectangle")');
  assert.equal(tipText(toolTip("hand", toolSummary("hand"), "hold Space")),
    `Hand (hold Space) — ${ENGINE_SUMMARIES.hand} — arm("hand")`);
  assert.equal(tipText(toolTip("t_bare")), 'T_bare — arm("t_bare")', "no summary: the name and the command");
  assert.equal(displayName("circle3"), "Circle3");
  assert.equal(displayName(""), "");
});

test("an action's tooltip names what it would type now, or why it would do nothing, with its key", () => {
  const idle: ActionState = { canUndo: false, canRedo: false, selected: [], armed: false };
  const busy: ActionState = { canUndo: true, canRedo: true, selected: ["l1", "l2"], armed: false };
  assert.equal(tipText(actionTip("delete", busy, actionKey("delete", false))),
    'Delete selection (Delete) — Deletes what is selected — del("l1", "l2")');
  assert.equal(tipText(actionTip("delete", idle, "Delete")), "Delete selection (Delete) — Deletes what is selected — select something first");
  assert.equal(actionTip("delete", { ...busy, armed: true }).off, "put the tool down first — Delete is for the selection");
  assert.equal(tipText(actionTip("undo", busy, actionKey("undo", false))), "Undo (Ctrl+Z) — Takes back the last change to the drawing — undo()");
  assert.equal(actionTip("undo", idle).off, "nothing to undo");
  assert.equal(actionTip("redo", busy).command, "redo()");
  assert.equal(actionTip("cancel", idle).off, "nothing to cancel");
  assert.deepEqual(["undo", "redo", "delete", "cancel"].map((a) => actionKey(a as never, true)), ["⌘Z", "⇧⌘Z", "Delete", "Esc"]);
  assert.deepEqual(["undo", "redo"].map((a) => actionKey(a as never, false)), ["Ctrl+Z", "Ctrl+Y"]);
});

test("the other controls' tooltips: a strip, the organiser's ＋, eye and marker, the spin box", () => {
  assert.deepEqual(stripTip("Tools", true).name, "Tools");
  assert.equal(stripTip("Log", false).command, undefined, "a strip types nothing");
  assert.equal(addTip([]).command, "opengroup(group())");
  assert.equal(addTip(["l1"]).command, 'group("l1")');
  const row: OrganiserRow = {
    name: "g1", detail: "", count: 2, eye: "shown", eyeCommand: 'hide("g1")', selected: false, open: false,
    openCommand: 'opengroup("g1")', tapCommand: 'select("g1")',
  } as OrganiserRow;
  assert.deepEqual([eyeTip(row).name, eyeTip(row).command], ["Hide g1", 'hide("g1")']);
  assert.equal(eyeTip({ ...row, eye: "hidden", eyeCommand: 'show("g1")' }).name, "Show g1");
  assert.match(eyeTip({ ...row, eye: "none", eyeCommand: null }).off!, /empty/);
  assert.equal(openTip(row).name, "Open g1");
  assert.equal(openTip({ ...row, open: true, openCommand: "closegroup()" }).command, "closegroup()");
  assert.equal(spinTip("inc", 1, "ui({ scale: 1.1 })").command, "ui({ scale: 1.1 })");
  assert.equal(spinTip("inc", 1.6, null).off, "already the largest, 160%");
  assert.match(spinTip("val", 0.8, 'ui({ scale: "default" })').name, /80/);
});

// --- where it goes ----------------------------------------------------------

const WINDOW: Box = { x: 0, y: 0, w: 390, h: 664 };
const TIP = { w: 180, h: 48 };
const inside = (p: { x: number; y: number }, b: Box = WINDOW) =>
  p.x >= b.x + MARGIN && p.y >= b.y + MARGIN && p.x + TIP.w <= b.x + b.w - MARGIN && p.y + TIP.h <= b.y + b.h - MARGIN;
const overlaps = (p: { x: number; y: number }, r: Box) =>
  p.x < r.x + r.w && r.x < p.x + TIP.w && p.y < r.y + r.h && r.y < p.y + TIP.h;

test("a mouse's tooltip: beside a column of buttons (on the roomier side), below anything else, and inside the window", () => {
  const button = { x: 4, y: 200, w: 20, h: 20 };
  const p = tipPlacement(button, TIP, WINDOW, { along: "column" });
  assert.equal(p.side, "right", "right of a column on the left edge");
  assert.equal(p.x, button.x + button.w + GAP);
  assert.ok(inside(p) && !overlaps(p, button));
  const right = { x: 366, y: 200, w: 20, h: 20 };
  assert.equal(tipPlacement(right, TIP, WINDOW, { along: "column" }).side, "left", "left of a column on the right edge");
  const plain = { x: 100, y: 100, w: 20, h: 20 };
  const q = tipPlacement(plain, TIP, WINDOW);
  assert.deepEqual([q.side, q.y], ["below", 120 + GAP]);
  assert.equal(q.x, 110 - TIP.w / 2 < MARGIN ? MARGIN : 110 - TIP.w / 2, "centred under it");
  // At the bottom, above it; at a corner, slid along to stay in.
  const low = { x: 360, y: 640, w: 20, h: 20 };
  const r = tipPlacement(low, TIP, WINDOW);
  assert.equal(r.side, "above");
  assert.ok(inside(r), JSON.stringify(r));
  assert.equal(r.x, WINDOW.w - MARGIN - TIP.w, "slid in from the right edge");
});

test("a finger's tooltip on a control of its own: above the finger and clear of it, and never off the window", () => {
  const button = { x: 120, y: 300, w: 26, h: 26 };
  const finger = { x: 133, y: 313 };
  const p = tipPlacement(button, TIP, WINDOW, { finger });
  assert.equal(p.side, "above");
  assert.ok(p.y + TIP.h <= finger.y - FINGER_CLEAR, "its bottom clear above the fingertip");
  assert.ok(inside(p));
  // Inside a safe area: the bounds are the window less its insets.
  const safe: Box = { x: 0, y: 47, w: 390, h: 844 - 47 - 34 };
  const atTop = { x: 4, y: 60, w: 26, h: 26 };
  const s = tipPlacement(atTop, TIP, safe, { finger: { x: 17, y: 73 } });
  assert.ok(inside(s, safe), `kept inside the safe area: ${JSON.stringify(s)}`);
  // A window smaller than the tooltip: clamped in from the top-left, rather than lost.
  const tiny = tipPlacement(button, { w: 500, h: 900 }, WINDOW);
  assert.deepEqual([tiny.x, tiny.y], [MARGIN, MARGIN]);
});

// docs/plans/everything-fits.md: "a held tooltip never covers the control's
// own neighbours". It used to go above the finger in a column too — over the
// buttons above the one held.
test("a finger's tooltip in a tray never covers the tray: beside a column, on the drawing's side; above or below a row; clear of the finger", () => {
  // A column of two lines down the left edge, the finger on the first line's fifth button.
  const tray = { x: 8, y: 52, w: 78, h: 335 };
  const button = { x: 12, y: 52 + 25 + 4 * 44, w: 26, h: 26 };
  const finger = { x: 25, y: button.y + 13 };
  const p = tipPlacement(button, TIP, WINDOW, { finger, along: "column", line: tray });
  assert.equal(p.side, "right", "the drawing's side");
  assert.ok(!overlaps(p, tray), `clear of every line of the tray: ${JSON.stringify(p)}`);
  assert.ok(p.x >= finger.x + FINGER_CLEAR && inside(p));
  // The same column on the right edge: its tip on the left.
  const rightTray = { ...tray, x: WINDOW.w - 8 - tray.w };
  const q = tipPlacement({ ...button, x: rightTray.x + 4 }, TIP, WINDOW, { finger: { ...finger, x: rightTray.x + 17 }, along: "column", line: rightTray });
  assert.equal(q.side, "left");
  assert.ok(!overlaps(q, rightTray));
  // A row of two lines along the bottom: above it — not over the line above the button held.
  const row = { x: 8, y: WINDOW.h - 78, w: 335, h: 78 };
  const low = { x: 8 + 25 + 3 * 44, y: WINDOW.h - 30, w: 26, h: 26 };
  const r = tipPlacement(low, TIP, WINDOW, { finger: { x: low.x + 13, y: low.y + 13 }, along: "row", line: row });
  assert.equal(r.side, "above");
  assert.ok(!overlaps(r, row) && r.y + TIP.h <= low.y + 13 - FINGER_CLEAR);
  // The action strip at the top right, under the logo's row: no room above, so below — never over the strip.
  const strip = { x: WINDOW.w - 8 - 203, y: 52, w: 203, h: 34 };
  const undo = { x: strip.x + 25, y: 56, w: 26, h: 26 };
  const f2 = { x: undo.x + 13, y: undo.y + 13 };
  const t = tipPlacement(undo, TIP, WINDOW, { finger: f2, along: "row", line: strip });
  assert.equal(t.side, "below");
  assert.ok(!overlaps(t, strip) && t.y >= f2.y + FINGER_CLEAR && inside(t), JSON.stringify(t));
});

test("a finger's hold is the canvas recogniser's: the same time and the same slop", () => {
  assert.equal(HOLD_MS, LONG_PRESS_MS);
  assert.equal(HOLD_SLOP, TAP_SLOP);
});

// --- frames in RGB ----------------------------------------------------------

/** A colour's hue, in degrees. */
function hue([r, g, b]: number[]): number {
  const [max, min] = [Math.max(r, g, b), Math.min(r, g, b)];
  if (max === min) return 0;
  const d = max - min;
  const h = max === r ? ((g - b) / d) % 6 : max === g ? (b - r) / d + 2 : (r - g) / d + 4;
  return (h * 60 + 360) % 360;
}

test("a frame's inks: x red, y green, z blue — each led by its own channel, and still in the hidden view's dimmed ink", () => {
  const hex = (css: string) => [1, 3, 5].map((i) => parseInt(css.slice(i, i + 2), 16));
  const parse = (css: string) => css.match(/\d+/g)!.map(Number);
  const lead = (v: number[]) => v.indexOf(Math.max(...v));
  for (const [axis, channel] of [["x", 0], ["y", 1], ["z", 2]] as const) {
    const ink = hex(AXIS_INKS[axis]);
    assert.equal(lead(ink), channel, `${axis} is led by ${"rgb"[channel]}`);
    const dim = parse(hiddenInk(AXIS_INKS[axis]));
    assert.equal(lead(dim), channel, `${axis}, dimmed behind a face, keeps its hue: rgb(${dim})`);
    // And keeps near its hue, so a dimmed red does not turn mauve.
    const shift = Math.abs(hue(dim) - hue(ink));
    assert.ok(Math.min(shift, 360 - shift) < 25, `${axis}: rgb(${dim}) from rgb(${ink}) toward ${HIDDEN_GROUND} turns ${shift}°`);
  }
  // Red and green apart in lightness, not only hue — for a red–green colour-blind eye.
  const lin = (c: number) => { const v = c / 255; return v <= 0.04045 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4; };
  const lum = (css: string) => { const [r, g, b] = hex(css).map(lin); return 0.2126 * r + 0.7152 * g + 0.0722 * b; };
  assert.ok(lum(AXIS_INKS.y) - lum(AXIS_INKS.x) > 0.2, `${lum(AXIS_INKS.x)} against ${lum(AXIS_INKS.y)}`);
  // Each reads on the dark ground: 4.5 : 1 at least.
  const ground = (0.05 + lum("#0a0e13"));
  for (const axis of ["x", "y", "z"] as const) assert.ok((lum(AXIS_INKS[axis]) + 0.05) / ground >= 4.5, axis);
});

// Found when the tray became eleven buttons (docs/plans/one-circle-one-arc.md):
// on an iPhone SE a single column runs the screen's height, a tip wider than the
// room beside it fitted no side, and the fallback clamped it back over the column.
// The host narrows a column's tip to `roomBeside` first, so it wraps beside it.
test("a tip too wide for the room beside a column is given exactly that room, and then fits beside it", () => {
  const phone = { x: 0, y: 0, w: 375, h: 667 };
  const tray = { x: 8, y: 52, w: 34, h: 560 };
  const button = { x: 12, y: 52 + 25 + 4 * 44, w: 26, h: 26 };
  const finger = { x: 25, y: button.y + 13 };
  const over = (p: { x: number; y: number }, w: number, h: number) =>
    p.x < tray.x + tray.w && tray.x < p.x + w && p.y < tray.y + tray.h && tray.y < p.y + h;
  const room = roomBeside(tray, phone, finger);
  assert.equal(room, 375 - MARGIN - (finger.x + FINGER_CLEAR + GAP), "right of the finger's clearance, the wider side");
  const wide = tipPlacement(button, { w: 338, h: 60 }, phone, { finger, along: "column", line: tray });
  assert.ok(over(wide, 338, 60), "at its own width it lands on the tray — the case being fixed");
  const narrowed = tipPlacement(button, { w: room, h: 90 }, phone, { finger, along: "column", line: tray });
  assert.equal(narrowed.side, "right");
  assert.ok(!over(narrowed, room, 90) && narrowed.x >= finger.x + FINGER_CLEAR);
  assert.ok(room >= MIN_TIP_W);
});

test("a flyout item's tip keeps off the tray it opened from as well as the flyout — slid past it (docs/plans/toolbar-groups.md)", () => {
  // A row flyout right of a column tray, held under a finger: above it, centred
  // on the item, the tip lay over the tray's buttons (seen in a screenshot).
  const bounds = { x: 0, y: 0, w: 390, h: 760 };
  const tray: Box = { x: 8, y: 60, w: 34, h: 600 };
  const fly: Box = { x: 46, y: 380, w: 96, h: 34 };
  const item: Box = { x: 50, y: 384, w: 26, h: 26 };
  const size = { w: 200, h: 60 };
  const finger = { x: 63, y: 397 };
  const meets = (p: { x: number; y: number }, o: Box) => p.x < o.x + o.w && o.x < p.x + size.w && p.y < o.y + o.h && o.y < p.y + size.h;
  const plain = tipPlacement(item, size, bounds, { finger, along: "row", line: fly });
  assert.ok(meets(plain, tray), "not told of the tray, it lies over it");
  const told = tipPlacement(item, size, bounds, { finger, along: "row", line: fly, clear: [tray] });
  assert.ok(!meets(told, tray) && !meets(told, fly), JSON.stringify(told));
  assert.equal(told.side, "above");
  assert.equal(told.x, tray.x + tray.w + GAP);
});
