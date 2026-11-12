// A tool says how to use it (docs/plans/tool-howto.md; the owner, asked to try
// adding a parallel relation: "I don't even know how to add a parallel
// relation. Maybe a little tooltip should pop up when I hover over (desktop)
// or select (phone) a tool.").
//
// What is pure is pinned here: every registered tool has a how, three lines at
// most, in each hand's words; what a tool's tip then says, hovered and chosen;
// how long a chosen tip stays; where it goes on an iPhone 13 — over the panes
// that only say things, never over the tray, the tool's own options or the
// finger, off the drawing's middle; that it takes no touch (the stylesheet's
// rule, read off index.html); the setting; what a group's button says of its
// other tools; and that the empty palette's line names pairs the list really
// answers with the relations it names. That the tip shows as a finger chooses
// a tool, that taps go through it, and that Parallel is one tap from two
// tapped lines, is the browser's (test/e2e/toolhowto.e2e.ts).

import { test } from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { ENGINE_HOW, ENGINE_TOOLS, HOW_MAX_LINES, Tool, defineTool, howText, listTools, toolHow, type How } from "../src/tools/tool.ts";
import {
  COST_CONTROL, COST_MIDDLE, FINGER_CLEAR, GAP, MARGIN, READ_AGAIN_MAX_MS, READ_MAX_MS, READ_MIN_MS, STAY, TIPS_KEY,
  chosenPlacement, chosenTip, middleOf, readingMs, recallTips, rememberTips, tipText, type Box, type Tip,
} from "../src/tooltip.ts";
import { ALSO_NAMES_MAX, groupAlso, toolTip } from "../src/panels.ts";
import { TIPS_LABEL, tipsCommand } from "../src/appmenu.ts";
import { PICKING, paletteFor } from "../src/constraints.ts";
import { constraintsFor } from "../src/dimensioning.ts";
import { ensureKernelLoaded } from "../src/kernel/problem.ts";
import { Model } from "../src/model.ts";
import { Repl } from "../src/repl.ts";
import { neocadScope } from "../src/replenv.ts";
import { OptionMemory } from "../src/tools/options.ts";

/** The built-ins, as main.ts registers them — read from main.ts, as tooltips.test.ts does, so a new tool cannot slip past. */
async function builtIns(): Promise<string[]> {
  const main = await readFile(new URL("../src/main.ts", import.meta.url), "utf8");
  const files = [...main.matchAll(/^import "\.\/(modules\/[a-z0-9]+\.ts)";$/gm)].map((m) => m[1]);
  assert.ok(files.length >= 1, `main.ts's module imports: ${files.join(", ")}`);
  for (const f of files) await import(new URL(`../src/${f}`, import.meta.url).href);
  // The edit dialogs are unlisted — never on the toolbar — and are tools all the same.
  return [...ENGINE_TOOLS, ...listTools(), "edit extrude", "edit revolve"];
}

/** Every way a tool whose how depends on its options can be armed: each must read right. */
const ARMED: Readonly<Record<string, Record<string, unknown>[]>> = {
  circle: [{ method: "auto" }, { method: "centre" }, { method: "3pt" }, { method: "tangent" }],
  arc: [{ method: "auto" }, { method: "3pt" }, { method: "centre" }, { method: "tangent" }],
  slot: [{ width: 0 }, { width: 8 }],
  pattern: [{ kind: "linear" }, { kind: "circular" }],
};

// --- every tool has one -------------------------------------------------------

test("every registered tool says how it is used — Select, the Hand and the edit dialogs too — in three lines at most, in each hand's words", async () => {
  const names = await builtIns();
  assert.ok(names.length >= 30, `the tools there are: ${names.join(", ")}`);
  for (const name of names) {
    for (const options of ARMED[name] ?? [{}]) {
      const said = `${name} ${JSON.stringify(options)}`;
      const mouse = toolHow(name, "mouse", options);
      const finger = toolHow(name, "finger", options);
      assert.ok(mouse && finger, `${said} has a how`);
      assert.equal(mouse!.length, finger!.length, `${said}: as many steps for either hand`);
      assert.ok(mouse!.length >= 1 && mouse!.length <= HOW_MAX_LINES, `${said}: 1 to ${HOW_MAX_LINES} lines, not ${mouse!.length}`);
      for (const line of [...mouse!, ...finger!]) {
        // Two lines of a phone's tip at 100 %: it wraps at about 34 characters.
        assert.ok(line.length <= 68, `${said}: a step short enough for a phone's tip (${line.length}): ${line}`);
        assert.doesNotMatch(line, /\n/, `${said}: one line a step`);
        assert.match(line, /^[A-Z✓]/, `${said}: a sentence, said to a person: ${line}`);
        assert.match(line, /[.…]$/, `${said}: and finished as one: ${line}`);
        assert.doesNotMatch(line, /[{}]/, `${said}: no placeholder left unfilled: ${line}`);
        assert.doesNotMatch(line, /\b(arm|ctx|onDown|entity|entities|residual|pointer event)\b|\(\)/, `${said}: in a user's words, not the code's: ${line}`);
      }
      // A finger never clicks and a mouse never taps: the word is the hand's.
      for (const line of finger!) assert.doesNotMatch(line, /\bclick/i, `${said}: a finger's line says tap: ${line}`);
      for (const line of mouse!) assert.doesNotMatch(line, /\btap\b/i, `${said}: a mouse's line says click: ${line}`);
    }
  }
});

test("the constrain tool's how: what to tap, then where the relation is chosen — the owner's case", async () => {
  await builtIns();
  assert.deepEqual(toolHow("constrain", "finger"), [
    "Tap the things to relate: two lines, a line and a circle…",
    "Then choose from the list: Parallel, Tangent, Equal…",
  ]);
  assert.deepEqual(toolHow("constrain", "mouse"), [
    "Click the things to relate: two lines, a line and a circle…",
    "Then choose from the list: Parallel, Tangent, Equal…",
  ]);
  // And each relation it promises is one the list gives for the things it names.
  const m = new Model(2);
  for (const [n, c] of [["a", [0, 0]], ["b", [30, 4]], ["c", [0, 20]], ["d", [30, 12]], ["o", [50, 50]]] as const) m.addPoint([...c], n);
  m.addLine("a", "b", "l1");
  m.addLine("c", "d", "l2");
  m.addCircle("o", 8, null, "c1");
  m.addPoint([70, 70], "o2");
  m.addCircle("o2", 8, null, "c2");
  const labels = (names: string[]) => constraintsFor(m, names).filter((r) => !r.off).map((r) => r.label);
  assert.ok(labels(["l1", "l2"]).includes("Parallel") && labels(["l1", "l2"]).includes("Equal"), labels(["l1", "l2"]).join());
  assert.ok(labels(["l1", "c1"]).includes("Tangent"), labels(["l1", "c1"]).join());
});

test("a how that depends on how the tool is armed says the armed gesture: a circle locked to three points never says to drag", async () => {
  await builtIns();
  assert.match(toolHow("circle", "finger", { method: "auto" })![0], /^Press at the centre and drag/);
  const locked = toolHow("circle", "finger", { method: "3pt" })!;
  assert.deepEqual(locked, ["Tap three points for it to pass through.", "Locked to 3 points: the options unlock it."]);
  assert.ok(!locked.join(" ").includes("drag"));
  assert.match(toolHow("arc", "mouse", { method: "tangent" })![0], /^Press on the end of a line or arc/);
  // With no options said — a host that has none to give — it is the unlocked way.
  assert.deepEqual(toolHow("circle", "mouse"), toolHow("circle", "mouse", { method: "auto" }));
  assert.match(toolHow("slot", "finger", { width: 0 })![1], /tap to one side/);
  assert.match(toolHow("slot", "finger", { width: 8 })![1], /set in the options/);
  assert.match(toolHow("pattern", "finger", { kind: "circular" })![1], /^Tap the point to turn about/);
});

test("where the hands differ the line is each hand's own: a chain ends by Esc or by Cancel, a spline by a double-click or the tick", async () => {
  await builtIns();
  assert.equal(toolHow("line", "mouse")![2], "Esc ends the chain.");
  assert.equal(toolHow("line", "finger")![2], "Cancel (✕) ends the chain.");
  assert.match(toolHow("spline", "mouse")![1], /^Double-click the last point, or press Enter/);
  assert.equal(toolHow("spline", "finger")![1], "✓ in the options ends it.");
  assert.match(toolHow("select", "mouse")![0], /Shift-click/);
  assert.match(toolHow("select", "finger")![1], /Hold, then drag, to box/);
  assert.match(toolHow("hand", "mouse")![2], /Space/);
  assert.equal(toolHow("select", "finger")!.length, ENGINE_HOW.select.length);
  assert.equal(howText("{Tap} here, then {tap} there.", "mouse"), "Click here, then click there.");
  assert.equal(howText({ mouse: "Esc.", finger: "{Tap} ✕." }, "finger"), "Tap ✕.");
});

test("a tool from the command line may declare a how; it is not inherited, and one that is not lines of text is refused where it is written", async () => {
  await builtIns();
  class Stamp extends Tool {
    static readonly how: How = ["{Tap} where the stamp goes.", { mouse: "Esc puts it down.", finger: "Cancel puts it down." }];
    readonly name = "h_stamp";
  }
  defineTool("h_stamp", Stamp);
  assert.deepEqual(toolHow("h_stamp", "finger"), ["Tap where the stamp goes.", "Cancel puts it down."]);
  defineTool("h_bare", class extends Tool { readonly name = "h_bare"; });
  assert.equal(toolHow("h_bare", "mouse"), null, "none: its tip has no steps");
  const Circle = (await import("../src/tools/circle.ts")).CircleTool;
  defineTool("h_ring", class extends Circle {});
  assert.equal(toolHow("h_ring", "mouse"), null, "a circle's subclass registered as something else is not said to be used as a circle is");
  assert.equal(toolHow("nothing", "mouse"), null);
  // As a tool typed at the command line could have it, which no type checks.
  const bad = class extends Tool { readonly name = "h_bad"; };
  Object.defineProperty(bad, "how", { value: "tap it" });
  assert.throws(() => defineTool("h_bad", bad), /h_bad's static how must be a list of lines of text/);
  const mixed = class extends Tool { readonly name = "h_mixed"; };
  Object.defineProperty(mixed, "how", { value: ["fine", 3] });
  assert.throws(() => defineTool("h_mixed", mixed), /must be a list of lines of text/);
  const long = class extends Tool { readonly name = "h_long"; };
  Object.defineProperty(long, "how", { value: ["a.", "b.", "c.", "d."] });
  assert.throws(() => defineTool("h_long", long), /h_long's static how has 4 lines — a tip holds 3 at most/);
  assert.equal(listTools().includes("h_bad") || listTools().includes("h_long"), false, "refused before it is registered");
  // A how that is a function is asked when its tip shows: one that throws, or
  // answers something that is not lines, is a tip without steps — never an
  // error in whoever drew the tooltip.
  const thrower = class extends Tool { readonly name = "h_throw"; };
  Object.defineProperty(thrower, "how", { value: () => { throw new Error("no"); } });
  defineTool("h_throw", thrower);
  assert.equal(toolHow("h_throw", "mouse"), null);
  const wordy = class extends Tool { readonly name = "h_wordy"; };
  Object.defineProperty(wordy, "how", { value: () => ["a.", "b.", "c.", "d.", "e."] });
  defineTool("h_wordy", wordy);
  assert.deepEqual(toolHow("h_wordy", "mouse"), ["a.", "b.", "c."], "held to three");
});

// --- what the tip says ----------------------------------------------------------

test("a tool's tip carries its steps under what it does; a tool with none has the tip it always had", async () => {
  await builtIns();
  const how = toolHow("constrain", "mouse");
  const t = toolTip("constrain", "Relates what you pick: choose from the relations that apply", null, how);
  assert.deepEqual(t.how, how);
  assert.equal(tipText(t),
    "Constrain — Relates what you pick: choose from the relations that apply — Click the things to relate: two lines, a line and a circle… — " +
    'Then choose from the list: Parallel, Tangent, Equal… — arm("constrain")');
  assert.deepEqual(toolTip("h_bare", null, null, null), { name: "H_bare", summary: null, command: 'arm("h_bare")', key: null }, "no how key at all");
});

test("chosen: the first time its name, what it does, how and what else the button holds — not the command; from then on the steps alone", () => {
  const t: Tip = { name: "Constrain", summary: "Relates what you pick", command: 'arm("constrain")', key: "K", how: ["Tap two lines.", "Choose Parallel."], also: "Hold this button for Dimension." };
  assert.deepEqual(chosenTip(t, false), { name: "Constrain", summary: "Relates what you pick", how: ["Tap two lines.", "Choose Parallel."], also: "Hold this button for Dimension." });
  assert.deepEqual(chosenTip(t, true), { name: "", how: ["Tap two lines.", "Choose Parallel."] });
  // A tool that declares no how: its name and what it does, once; nothing to say again.
  assert.deepEqual(chosenTip({ name: "Stamp", summary: "Stamps" }, false), { name: "Stamp", summary: "Stamps", how: null, also: null });
  assert.equal(chosenTip({ name: "Stamp", summary: "Stamps" }, true), null);
});

test("a chosen tip stays as long as it takes to read: a second and 40 ms a character, 3 s at least, 10 at most — 5 for the steps alone", async () => {
  await builtIns();
  const tip = (name: string): Tip => chosenTip({ ...toolTip(name, null, null, toolHow(name, "finger")), summary: "x".repeat(55) }, false)!;
  const constrain = readingMs(tip("constrain"));
  assert.ok(constrain > 7000 && constrain <= READ_MAX_MS, `the constrain tool's, about nine seconds: ${constrain}`);
  assert.equal(readingMs({ name: "Hi" }), READ_MIN_MS, "never a blink");
  assert.equal(readingMs({ name: "x".repeat(900) }), READ_MAX_MS, "never in the way for long");
  const again = chosenTip(tip("constrain"), true)!;
  assert.ok(readingMs(again, true) <= READ_AGAIN_MAX_MS && readingMs(again, true) >= READ_MIN_MS, `again, briefly: ${readingMs(again, true)}`);
  assert.ok(readingMs(again, true) < constrain, "less long than the first time");
  assert.equal(readingMs({ name: "", how: ["x".repeat(500)] }, true), READ_AGAIN_MAX_MS);
});

test("a group's button says what else it holds, by name while that is short", () => {
  assert.equal(groupAlso(["dimension", "constrain"], "dimension"), "Hold this button for Constrain.");
  assert.equal(groupAlso(["dimension", "constrain"], "constrain"), "Hold this button for Dimension.");
  assert.equal(groupAlso(["extrude", "cut", "surface", "edge"], "extrude"), "Hold this button for Cut, Surface, Edge.");
  const modify = ["trim", "fillet", "bevel", "extend", "offset", "mirror", "pattern", "round", "chamfer"];
  assert.equal(groupAlso(modify, "trim"), "Hold this button for 8 more tools.", `past ${ALSO_NAMES_MAX} characters, how many`);
  assert.equal(groupAlso(["circle"], "circle"), null, "a button of one tool holds nothing else");
});

// --- where it goes --------------------------------------------------------------

// An upright iPhone 13 in Safari, as the app lays it out at 100 % (measured in
// the browser, 2026-11-12): the tray down the left, the organiser, the action
// strip and the log across the top, the command line along the bottom.
const PHONE: Box = { x: 0, y: 0, w: 390, h: 664 };
const TRAY: Box = { x: 8, y: 52, w: 43, h: 599 };
const ORGANISER: Box = { x: 59, y: 71, w: 112, h: 150 };
const LOG: Box = { x: 179, y: 122, w: 203, h: 60 };
const STRIP: Box = { x: 179, y: 52, w: 203, h: 43 };
const CMD: Box = { x: 59, y: 599, w: 331, h: 65 };
const CORNER: Box = { x: 0, y: 0, w: 390, h: 44 };
const PALETTE: Box = { x: 59, y: 404, w: 323, h: 187 };
const OPTIONS: Box = { x: 164, y: 430, w: 218, h: 161 };
const meet = (a: Box, b: Box) => a.x < b.x + b.w && b.x < a.x + a.w && a.y < b.y + b.h && b.y < a.y + a.h;
const boxed = (p: { x: number; y: number }, s: { w: number; h: number }): Box => ({ x: p.x, y: p.y, ...s });

test("iPhone 13: a chosen tool's tip lies over the organiser and the log — off the tray, the palette, the corner, the finger and the drawing's middle", () => {
  const size = { w: 320, h: 167 };
  for (const [what, button, own] of [
    ["the relate button, the palette up", { x: 12, y: 478, w: 35, h: 35 }, PALETTE],
    ["the sweep button, extrude's options up", { x: 12, y: 522, w: 35, h: 35 }, OPTIONS],
    ["Select, at the tray's top", { x: 12, y: 80, w: 35, h: 35 }, null],
  ] as const) {
    const finger = { x: button.x + button.w / 2, y: button.y + button.h / 2 };
    const keep = [TRAY, CORNER, ...(own ? [own] : [])];
    const p = chosenPlacement(size, PHONE, { anchor: button, finger, keep, free: [ORGANISER, LOG], controls: [STRIP, CMD] });
    const r = boxed(p, size);
    assert.equal(p.clear, true, what);
    for (const k of keep) assert.ok(!meet(r, k), `${what}: never over what is kept — ${JSON.stringify([r, k])}`);
    assert.ok(r.x >= TRAY.x + TRAY.w + GAP - 0.5, `${what}: a gap off the tray: ${r.x}`);
    assert.ok(r.x >= PHONE.x + MARGIN && r.x + r.w <= PHONE.w - MARGIN + 0.5 && r.y >= MARGIN && r.y + r.h <= PHONE.h - MARGIN, `${what}: inside the window: ${JSON.stringify(r)}`);
    assert.ok(Math.abs(r.x + r.w / 2 - finger.x) > FINGER_CLEAR || Math.abs(r.y + r.h / 2 - finger.y) > FINGER_CLEAR, `${what}: off the fingertip`);
    assert.ok(!meet(r, { x: finger.x - FINGER_CLEAR, y: finger.y - FINGER_CLEAR, w: 2 * FINGER_CLEAR, h: 2 * FINGER_CLEAR }), `${what}: a fingertip clear of the finger: ${JSON.stringify(r)}`);
    assert.ok(!meet(r, middleOf(PHONE)), `${what}: clear of the drawing's middle: ${JSON.stringify(r)}`);
    assert.ok(meet(r, ORGANISER) && meet(r, LOG), `${what}: over the panes that only say things: ${JSON.stringify(r)}`);
    assert.ok(r.y + r.h <= ORGANISER.y + ORGANISER.h + 12, `${what}: in the chrome above the drawing, not down in it: ${JSON.stringify(r)}`);
  }
});

test("the place is the one that hides least: free panes for nothing, a control at half the drawing's price, the middle at four times it", () => {
  const size = { w: 100, h: 50 };
  const win: Box = { x: 0, y: 0, w: 600, h: 300 };
  const anchor: Box = { x: 280, y: 280, w: 20, h: 16 };
  const pane: Box = { x: 450, y: 30, w: 120, h: 80 };
  // Wholly over a pane that only says things: nothing hidden that matters.
  const over = chosenPlacement(size, win, { anchor, free: [pane] });
  assert.equal(over.cost, 0);
  assert.ok(over.x >= pane.x && over.x + size.w <= pane.x + pane.w && over.y >= pane.y && over.y + size.h <= pane.y + pane.h, JSON.stringify(over));
  // The same pane a control, deep in the window: over it still (half price
  // beats bare drawing by more than a place's being higher is worth).
  const low: Box = { ...pane, y: 200 };
  const control = chosenPlacement(size, win, { anchor, controls: [low] });
  assert.equal(control.cost, COST_CONTROL * size.w * size.h);
  assert.ok(control.y >= low.y && control.y + size.h <= low.y + low.h, JSON.stringify(control));
  // **It keeps to one place**: a place higher up that hides no more than a
  // third of a tip over the least is taken for being the first reading down.
  const near: Box = { x: 450, y: 30, w: 120, h: 80 };
  const stays = chosenPlacement(size, win, { anchor, controls: [near] });
  assert.equal(stays.y, MARGIN, "the top of the window, part over the control and part over bare drawing");
  assert.ok(stays.cost > COST_CONTROL * size.w * size.h && stays.cost <= (COST_CONTROL + STAY) * size.w * size.h, String(stays.cost));
  // A short tip and a tall one therefore start at the same line.
  const tall = chosenPlacement({ w: 100, h: 110 }, win, { anchor, controls: [near] });
  assert.equal(tall.y, stays.y);
  // Nothing to lie over: bare drawing, at 1 a pixel — but not the middle, which is 1 + COST_MIDDLE.
  const bare = chosenPlacement(size, win, { anchor });
  assert.equal(bare.cost, size.w * size.h);
  assert.ok(!meet(boxed(bare, size), middleOf(win)), JSON.stringify(bare));
  assert.equal(COST_MIDDLE, 3);
  // Of equals, the first reading down: a tip is found by being where the last one was.
  assert.equal(bare.y, MARGIN);
  // A pane kept is never covered, though it is the only place that is free.
  const kept = chosenPlacement(size, win, { anchor, keep: [pane] });
  assert.ok(!meet(boxed(kept, size), pane));
  // A window with no room clear of what is kept: held inside, and said not to be clear.
  const none = chosenPlacement({ w: 300, h: 200 }, { x: 0, y: 0, w: 320, h: 220 }, { anchor, keep: [{ x: 100, y: 60, w: 120, h: 100 }] });
  assert.equal(none.clear, false);
  assert.ok(none.x >= 0 && none.y >= 0);
});

test("the chosen tool's tip takes no touch: its element has no pointer events, by the stylesheet's own rule", async () => {
  const html = await readFile(new URL("../index.html", import.meta.url), "utf8");
  const rule = html.match(/#tooltip,#chosentip\{([^}]*)\}/);
  assert.ok(rule, "the two tips share their card's rule");
  assert.match(rule![1], /pointer-events:none/);
  assert.match(html, /<div id="chosentip" role="status" aria-live="polite" hidden><\/div>/);
  // And nothing later in the stylesheet gives them back.
  for (const m of html.matchAll(/#chosentip[^{]*\{([^}]*)\}/g)) assert.doesNotMatch(m[1], /pointer-events:(?!none)/);
  // tooltip.ts is still a leaf: the tip is handed in, and it imports nothing.
  const src = await readFile(new URL("../src/tooltip.ts", import.meta.url), "utf8");
  assert.deepEqual([...src.matchAll(/^import .*$/gm)].map((m) => m[0]), []);
});

// --- the setting ----------------------------------------------------------------

test("the setting: on unless turned off, stored as the viewer's, typed as ui({ tips: false }) — and a browser that keeps nothing costs only the remembering", () => {
  const data = new Map<string, string>();
  const storage = { getItem: (k: string) => data.get(k) ?? null, setItem: (k: string, v: string) => void data.set(k, v), removeItem: (k: string) => void data.delete(k) };
  assert.equal(recallTips(storage), true, "on from the start");
  assert.equal(rememberTips(storage, false), true);
  assert.equal(data.get(TIPS_KEY), "off");
  assert.equal(recallTips(storage), false);
  assert.equal(rememberTips(storage, true), true);
  assert.equal(data.has(TIPS_KEY), false, "on is the default: nothing stored");
  assert.equal(recallTips(null), true);
  assert.equal(rememberTips(null, false), false);
  const broken = { getItem: () => { throw new Error("denied"); }, setItem: () => { throw new Error("denied"); }, removeItem: () => { throw new Error("denied"); } };
  assert.equal(recallTips(broken), true);
  assert.equal(rememberTips(broken, false), false);
  assert.equal(tipsCommand(false), "ui({ tips: false })");
  assert.equal(tipsCommand(true), "ui({ tips: true })");
  assert.equal(TIPS_LABEL, "Tips when a tool is chosen");
});

// --- the empty palette, and help() ----------------------------------------------

test("the empty palette teaches: it names what can be picked and what will be offered — and each pair it names is answered with a relation it names", () => {
  const m = new Model(2);
  for (const [n, c] of [["a", [0, 0]], ["b", [30, 4]], ["c", [0, 20]], ["d", [30, 12]], ["o", [50, 50]], ["p", [10, 40]]] as const) m.addPoint([...c], n);
  m.addLine("a", "b", "l1");
  m.addLine("c", "d", "l2");
  m.addCircle("o", 8, null, "c1");
  const waiting = paletteFor(m, [], [], [], true);
  assert.equal(waiting[0].empty, PICKING);
  assert.match(PICKING, /^pick what to relate — two lines, a line and a circle, a point and a line…/);
  assert.match(PICKING, /Parallel, Perpendicular, Tangent, Midpoint and the others that fit are then listed here$/);
  const labels = (names: string[]) => constraintsFor(m, names).filter((r) => !r.off).map((r) => r.label);
  assert.deepEqual(labels(["l1", "l2"]).slice(0, 2), ["Parallel", "Perpendicular"], "two lines: the first two rows");
  assert.ok(labels(["l1", "c1"]).includes("Tangent"), `a line and a circle: ${labels(["l1", "c1"])}`);
  assert.ok(labels(["p", "l1"]).includes("Midpoint"), `a point and a line: ${labels(["p", "l1"])}`);
});

test("help() says a tool's tip has the steps, that a finger's choice shows it, how to turn that off, and how a tool declares its own", async () => {
  await ensureKernelLoaded(await readFile(new URL("../src/kernel/wasm-gen/neocad_kernel_bg.wasm", import.meta.url)));
  await builtIns();
  const repl = new Repl(neocadScope({ model: new Model(3), optionMemory: new OptionMemory(null) }));
  const help = (await repl.eval("help()")).value as string;
  assert.match(help, /A tool's tooltip also says how it is used, a line a step/);
  assert.match(help, /a tool chosen by finger shows that tip unasked/);
  assert.match(help, /ui\(\{ tips: false \}\) turns it off/);
  assert.match(help, /static how = \["\{Tap\} where the stamp goes"/);
});
