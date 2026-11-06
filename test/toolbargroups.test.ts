// Toolbar groups (docs/plans/toolbar-groups.md; the owner: "give me better
// sketch tools, relations, trim, slot... all the usual", and before that
// "Second row.... everything has to fit").
//
// The rule that decides which button a tool is on, the button list as the app
// has it today, the member a group's button shows and how it is remembered,
// and where a group's flyout goes — the arithmetic, over every iPhone in
// test/devices.ts. What a browser does with a hover, a hold and a slide is
// test/e2e/toolbargroups.e2e.ts's.

import { test } from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import {
  ENGINE_TOOLS, TOOL_ALIASES, TOOL_GROUPS, Tool, defineTool, groupCurrent, listTools, toolAlias, toolGroup, toolbarButtons,
} from "../src/tools/tool.ts";
import { GROUPS_KEY, GroupMemory, OptionMemory, parseGroupChoices, type OptionStorage } from "../src/tools/options.ts";
import {
  ACTIONS, COARSE, FINE, FLYOUT_GAP, arranged, cornerBox, defaultLayout, flyoutPlacement, flyoutSize, logoBox, optionsSize,
  fittedAt, linesOf, touchMetrics, type Layout, type Metrics, type Rect, type Size,
} from "../src/panels.ts";
import { HOLD_MS, HOLD_SLOP } from "../src/tooltip.ts";
import { ensureKernelLoaded } from "../src/kernel/problem.ts";
import { Model } from "../src/model.ts";
import { menuFor } from "../src/menu.ts";
import { Repl } from "../src/repl.ts";
import { neocadScope } from "../src/replenv.ts";
import { LONG_PRESS_MS, TAP_SLOP } from "../src/tools/gestures.ts";
import { SplineTool } from "../src/tools/spline.ts";
import { areaOf, everyWay } from "./devices.ts";

/** The built-ins, registered as main.ts registers them — read from its imports, as icons.test.ts does. */
async function registerBuiltIns(): Promise<void> {
  const main = await readFile(new URL("../src/main.ts", import.meta.url), "utf8");
  const files = [...main.matchAll(/^import "\.\/(modules\/[a-z0-9]+\.ts)";$/gm)].map((m) => m[1]);
  for (const f of files) await import(new URL(`../src/${f}`, import.meta.url).href);
}

const meets = (a: Rect, b: Rect) => a.x < b.x + b.w - 1e-6 && b.x < a.x + a.w - 1e-6 && a.y < b.y + b.h - 1e-6 && b.y < a.y + a.h - 1e-6;
const inside = (a: Rect, b: Rect) => a.x >= b.x - 1e-6 && a.y >= b.y - 1e-6 && a.x + a.w <= b.x + b.w + 1e-6 && a.y + a.h <= b.y + b.h + 1e-6;

// The registry is one per process, and these tests add to it in order: the
// first reads the app's own list before anything is defined over it.

test("the button list is thirteen today, with these names in this order — a group's button showing its first member", async () => {
  await registerBuiltIns();
  const buttons = toolbarButtons();
  // Thirteen: the dimension and constrain tools (docs/plans/sketch-relations.md)
  // share the relate group's button (tool.ts, TOOL_GROUPS: a fourteenth ran a
  // phone's column onto the command line),
  // and the sketch shapes (docs/plans/sketch-shapes.md) — the polygon and the
  // slot joined the rectangle's button, and the ellipse brought the curves
  // group's, after the arc as the table puts it.
  // The surface tool (docs/plans/surfaces.md) shares the extrude's button,
  // the sweep group's: still thirteen.
  assert.equal(buttons.length, 13);
  assert.deepEqual(buttons.map((b) => b.group ?? b.tools[0]),
    ["select", "hand", "point", "line", "shapes", "circle", "arc", "curves", "modify", "relate", "sweep", "revolve", "sketch"]);
  assert.deepEqual(buttons.find((b) => b.group === "sweep")!.tools, ["extrude", "surface"]);
  assert.deepEqual(buttons.find((b) => b.group === "shapes")!.tools, ["rectangle", "polygon", "slot", "region"]);
  // The spline joins the ellipse there (docs/plans/spline.md): still thirteen.
  assert.deepEqual(buttons.find((b) => b.group === "curves")!.tools, ["ellipse", "spline"]);
  assert.deepEqual(buttons.find((b) => b.group === "relate")!.tools, ["dimension", "constrain"]);
  // The solids module's round and chamfer join the sketch's fillet there
  // (docs/plans/solid-fillets.md), after the sketch's edits (docs/plans/
  // sketch-edit.md, bevel the sketch's chamfer): no button of their own.
  assert.deepEqual(buttons.find((b) => b.group === "modify")!.tools, ["fillet", "bevel", "trim", "extend", "offset", "mirror", "pattern", "round", "chamfer"]);
  // Every listed tool is on exactly one button.
  assert.deepEqual(buttons.flatMap((b) => b.tools).sort(), [...ENGINE_TOOLS, ...listTools()].sort());
});

test("grouping is the table: shapes, curves, modify and relate, in their order; Select, the Hand and the rest alone", () => {
  assert.deepEqual(Object.keys(TOOL_GROUPS), ["shapes", "curves", "modify", "relate", "sweep"]);
  assert.deepEqual(TOOL_GROUPS.shapes, ["rectangle", "polygon", "slot", "region"]);
  assert.deepEqual(TOOL_GROUPS.curves, ["ellipse", "spline"]);
  // The sketch module's table — its edits, bevel its chamfer (docs/plans/
  // sketch-edit.md) — then what the solids module adds: round and chamfer.
  assert.deepEqual(TOOL_GROUPS.modify, ["fillet", "bevel", "trim", "extend", "offset", "mirror", "pattern", "round", "chamfer"]);
  // Dimension and constrain share a button since a fourteenth ran a phone's
  // column onto the command line (tool.ts, beside the table).
  assert.deepEqual(TOOL_GROUPS.relate, ["dimension", "constrain"]);
  assert.equal(toolGroup("rectangle"), "shapes");
  assert.equal(toolGroup("fillet"), "modify");
  assert.equal(toolGroup("constrain"), "relate");
  assert.deepEqual(TOOL_GROUPS.sweep, ["extrude", "surface"]);
  for (const alone of ["select", "hand", "point", "line", "circle", "arc", "revolve", "sketch"]) {
    assert.equal(toolGroup(alone), null, alone);
  }
  // Queued and not yet built: named by the table all the same, so the
  // package that adds one needs no edit here.
  assert.equal(toolGroup("polygon"), "shapes");
  assert.equal(toolGroup("ellipse"), "curves");
  assert.equal(toolGroup("trim"), "modify");
  // The table's every name is a member of one group only.
  const all = Object.values(TOOL_GROUPS).flat();
  assert.equal(new Set(all).size, all.length);
});

test("aliases are unaffected: circle3 and arc3 arm the one tool, are on no button, and name no group", () => {
  for (const [name, alias] of Object.entries(TOOL_ALIASES)) {
    assert.equal(toolAlias(name)?.tool, alias.tool);
    assert.equal(toolGroup(name), null);
    assert.ok(!toolbarButtons().some((b) => b.tools.includes(name)), `${name} has no button`);
  }
});

test("a tool with static group joins it, after the table's members — and its button stands where the group's first member does", () => {
  class Stamp extends Tool { static group = "shapes"; name = "t_stamp"; }
  defineTool("t_stamp", Stamp);
  assert.equal(toolGroup("t_stamp"), "shapes");
  const shapes = toolbarButtons().find((b) => b.group === "shapes")!;
  assert.deepEqual(shapes.tools, ["rectangle", "polygon", "slot", "region", "t_stamp"]);
  assert.equal(toolbarButtons().length, 13, "no new button");
  assert.equal(toolbarButtons().findIndex((b) => b.group === "shapes"), 4, "where the rectangle's was");
  // A table member registered after it still comes first in the group's order
  // — a stand-in for the chamfer (the solids module's is the real one, and
  // round comes after the table's members as t_late does).
  class Stamp2 extends Tool { static group = "modify"; name = "t_late"; }
  defineTool("t_late", Stamp2);
  class Chamfer extends Tool { name = "chamfer"; }
  defineTool("chamfer", Chamfer);
  assert.deepEqual(toolbarButtons().find((b) => b.group === "modify")!.tools, ["fillet", "bevel", "trim", "extend", "offset", "mirror", "pattern", "round", "chamfer", "t_late"]);
});

test("static group is the class's own: a subclass of a grouped tool is not in its group", () => {
  class Base extends Tool { static group = "modify"; name = "t_base"; }
  class Derived extends Base { name = "t_derived"; }
  defineTool("t_base", Base);
  defineTool("t_derived", Derived);
  assert.equal(toolGroup("t_base"), "modify");
  assert.equal(toolGroup("t_derived"), null, "not inherited, as a summary is not");
});

test("an unknown group name is a plain button; null is too; a group that is not a name is refused where it is written", () => {
  const before = toolbarButtons().length;
  class Odd extends Tool { static group = "widgets"; name = "t_odd"; }
  defineTool("t_odd", Odd);
  assert.equal(toolGroup("t_odd"), null);
  assert.deepEqual(toolbarButtons().at(-1), { group: null, tools: ["t_odd"] });
  // A tool the table would group, declaring null, is a button of its own — a
  // stand-in for the spline, written before it was built; the real one is
  // put back after (docs/plans/spline.md), so the tests below see the
  // curves button as it is.
  class Lone extends Tool { static group = null; name = "spline"; }
  defineTool("spline", Lone);
  assert.equal(toolGroup("spline"), null);
  assert.equal(toolbarButtons().length, before + 2);
  defineTool("spline", SplineTool);
  assert.equal(toolGroup("spline"), "curves");
  assert.throws(() => defineTool("t_bad", class extends Tool { static group = 3 as unknown as string; name = "t_bad"; }), /static group must be a group's name/);
  assert.ok(!listTools().includes("t_bad"), "refused before anything is registered");
});

test("a group's button stands where its first member registered: curves after the arc, where main.ts imports the ellipse", () => {
  const buttons = toolbarButtons();
  const at = (g: string) => buttons.findIndex((b) => b.group === g || b.tools[0] === g);
  assert.equal(at("curves"), at("arc") + 1);
  assert.equal(at("modify"), at("curves") + 1);
  // A group of none shows no button: one defined at the command line with
  // a name in no table, and no members, is nowhere.
  assert.ok(!buttons.some((b) => b.group !== null && b.tools.length === 0));
});

test("the current member: the last armed while it is a member, else the first", () => {
  const b = { group: "shapes", tools: ["rectangle", "polygon", "slot"] };
  assert.equal(groupCurrent(b, null), "rectangle", "the first by default");
  assert.equal(groupCurrent(b, "polygon"), "polygon");
  assert.equal(groupCurrent(b, "circle"), "rectangle", "a name no longer in the group is forgotten, not shown");
});

/** A storage like localStorage, as options' tests use. */
function shim(): OptionStorage & { data: Map<string, string> } {
  const data = new Map<string, string>();
  return { data, getItem: (k) => data.get(k) ?? null, setItem: (k, v) => { data.set(k, v); }, removeItem: (k) => { data.delete(k); } };
}

test("the current member is remembered for the viewer, under its own key, and survives a storage that throws", () => {
  const s = shim();
  const m = new GroupMemory(s);
  assert.equal(m.recall("shapes"), null);
  assert.equal(m.remember("shapes", "polygon"), true);
  assert.equal(m.remember("shapes", "polygon"), false, "no change, no write");
  assert.equal(JSON.parse(s.data.get(GROUPS_KEY)!).shapes, "polygon");
  // A reload: a new memory over the same storage.
  assert.equal(new GroupMemory(s).recall("shapes"), "polygon");
  assert.equal(groupCurrent({ group: "shapes", tools: ["rectangle", "polygon"] }, new GroupMemory(s).recall("shapes")), "polygon");
  // Leniently read: junk is nothing remembered, a wrong value is dropped alone.
  assert.deepEqual(parseGroupChoices("not json"), {});
  assert.deepEqual(parseGroupChoices(JSON.stringify({ shapes: "slot", modify: 4 })), { shapes: "slot" });
  const no = () => { throw new Error("private window"); };
  const throwing: OptionStorage = { getItem: no, setItem: no, removeItem: no };
  const t = new GroupMemory(throwing);
  assert.equal(t.remember("modify", "trim"), false);
  assert.equal(t.recall("modify"), "trim", "still remembered for as long as the page is open");
  assert.equal(new GroupMemory(null).remember("modify", "trim"), false);
});

test("the flyout's numbers are the recogniser's: a slide past its slop, a hold of its long-press", () => {
  assert.equal(HOLD_SLOP, TAP_SLOP);
  assert.equal(HOLD_MS, LONG_PRESS_MS);
});

// --- where the flyout goes ---------------------------------------------------------

const bounds: Rect = { x: 0, y: 0, w: 390, h: 760 };

test("flyoutSize: a tray's family without the strip — one line, or wrapped a whole button pitch apart", () => {
  const one = flyoutSize(3, "row", COARSE);
  assert.deepEqual(one, { w: 8 + 3 * COARSE.button + 2 * COARSE.gap, h: 8 + COARSE.button });
  const two = flyoutSize(7, "column", COARSE, 2);
  assert.deepEqual(two, { w: 8 + COARSE.button + (COARSE.button + COARSE.gap), h: 8 + 4 * COARSE.button + 3 * COARSE.gap });
  assert.ok(COARSE.button + COARSE.gap >= 44, "under a finger the items are a whole target apart");
});

test("beside a column: a row on the drawing's side, level with its button, never over the tray", () => {
  const tray = { x: 8, y: 60, w: 34, h: 500 };
  const button = { x: 12, y: 240, w: 26, h: 26 };
  const p = flyoutPlacement({ button, tray, along: "column", items: 3, m: COARSE, bounds, keep: [], avoid: [] });
  assert.equal(p.orient, "row");
  assert.equal(p.side, "right");
  assert.equal(p.rect.x, tray.x + tray.w + FLYOUT_GAP);
  assert.equal(p.rect.y, button.y - 4, "its first item level with the button");
  assert.ok(p.clear && !meets(p.rect, tray));
  // A column against the right edge opens to its left.
  const right = flyoutPlacement({ button: { ...button, x: 352 }, tray: { ...tray, x: 348 }, along: "column", items: 3, m: COARSE, bounds, keep: [], avoid: [] });
  assert.equal(right.side, "left");
  assert.equal(right.rect.x + right.rect.w, 348 - FLYOUT_GAP);
});

test("over a row: a column above it — and wrapped into more lines where the way up is short", () => {
  const area = { x: 0, y: 0, w: 667, h: 375 };
  const tray = { x: 8, y: 260, w: 400, h: 107 };
  const button = { x: 200, y: 264, w: 26, h: 26 };
  const tall = flyoutPlacement({ button, tray, along: "row", items: 3, m: COARSE, bounds: area, keep: [], avoid: [] });
  assert.equal(tall.orient, "column");
  assert.equal(tall.side, "above");
  assert.equal(tall.rect.y + tall.rect.h, tray.y - FLYOUT_GAP);
  assert.equal(tall.rect.x, button.x - 4);
  assert.equal(tall.lines, 1);
  const seven = flyoutPlacement({ button, tray, along: "row", items: 7, m: COARSE, bounds: area, keep: [], avoid: [] });
  assert.ok(seven.lines >= 2, `7 × 44 does not fit 252 px: ${seven.lines} lines`);
  assert.ok(inside(seven.rect, area) && seven.clear);
});

test("slid along the tray off a pane in the way, to the nearest clear place; never over what it must keep", () => {
  const tray = { x: 8, y: 60, w: 34, h: 500 };
  const button = { x: 12, y: 240, w: 26, h: 26 };
  const log = { x: 50, y: 200, w: 300, h: 80 };
  const p = flyoutPlacement({ button, tray, along: "column", items: 3, m: COARSE, bounds, keep: [], avoid: [log] });
  assert.ok(p.clear && !meets(p.rect, log));
  assert.equal(p.rect.y, log.y + log.h + FLYOUT_GAP, "just below the log, the nearer way");
  // The corner is never covered, even where nothing else is free.
  const corner = { x: 0, y: 0, w: 390, h: 760 - 100 };
  const q = flyoutPlacement({ button: { ...button, y: 20 }, tray, along: "column", items: 3, m: COARSE, bounds, keep: [corner], avoid: [] });
  assert.ok(!meets(q.rect, corner), JSON.stringify(q));
  // Nowhere clear of a pane: the place covering least of it, said not clear.
  const wall = { x: 40, y: 0, w: 350, h: 760 };
  const r = flyoutPlacement({ button, tray, along: "column", items: 3, m: COARSE, bounds, keep: [], avoid: [wall] });
  assert.equal(r.clear, false);
  assert.ok(inside(r.rect, bounds) && !meets(r.rect, tray));
});

// --- everything fits, with a flyout open --------------------------------------------

// Thirteen: the relate group's button (dimension and constrain) and the curves group's.
const TOOLS = 13;
/** Where the tray's `i`th button is, in a tray placed at `t` (the stylesheet's grid: strip, padding, a pitch a button). */
function buttonAt(t: Layout[string], i: number, m: Metrics): Rect {
  const lines = linesOf(t, m);
  const per = Math.ceil(TOOLS / lines);
  const [line, k] = [Math.floor(i / per), i % per];
  const pitch = m.button + m.gap;
  return t.orient === "row"
    ? { x: t.x + 1 + m.title + 3 + k * pitch, y: t.y + 1 + 3 + line * pitch, w: m.button, h: m.button }
    : { x: t.x + 1 + 3 + line * pitch, y: t.y + 1 + m.title + 3 + k * pitch, w: m.button, h: m.button };
}

function laidOut(area: Size, m: Metrics, rows: number | null): Layout {
  const defaults = defaultLayout(area, TOOLS, m);
  const trays = { toolbar: TOOLS, actions: ACTIONS.length };
  const order = ["toolbar", "log", "organiser", "actions", "cmd"];
  const fixed: Layout = { logo: { x: 0, y: 0, ...logoBox(m), fixed: true } };
  if (rows === null) {
    const { options: _unused, ...d } = defaults;
    return arranged(order, {}, d, trays, area, {}, m, fixed).layout;
  }
  const size = optionsSize(rows, m);
  const first = arranged(order, {}, defaults, trays, area, {}, m, fixed).layout;
  const d = { ...defaults, options: fittedAt(defaults.options, first.toolbar, size, area) };
  return arranged([...order, "options"], {}, d, trays, area, { options: size }, m, fixed).layout;
}

for (const { phone, turn, mode } of everyWay()) {
  test(`a flyout fits: ${phone.name}, ${turn}, ${mode === "installed" ? "installed" : "in Safari"} — shapes and modify at every size they will have`, () => {
    const area = areaOf(phone, turn, mode);
    const all: Rect = { x: 0, y: 0, ...area };
    for (const rows of [null, 1]) {
      const layout = laidOut(area, COARSE, rows);
      const tray = layout.toolbar;
      const avoid = Object.entries(layout).filter(([id, r]) => id !== "toolbar" && !r.fixed).map(([, r]) => r);
      const keep = [layout.logo, cornerBox(COARSE)];
      // The shapes button is the fifth, curves the eighth, modify the ninth;
      // each at every size it has or will have once the queued packages land.
      for (const [index, sizes] of [[4, [3]], [7, [1, 2]], [8, [2, 4, 7]]] as const) {
        for (const items of sizes) {
          const where = `${area.w}×${area.h}, options ${rows}, button ${index}, ${items} items`;
          const p = flyoutPlacement({ button: buttonAt(tray, index, COARSE), tray, along: tray.orient!, items, m: COARSE, bounds: all, keep, avoid });
          assert.ok(inside(p.rect, all), `${where}: on screen ${JSON.stringify(p)}`);
          assert.ok(!meets(p.rect, tray), `${where}: not over the tray`);
          for (const k of keep) assert.ok(!meets(p.rect, k), `${where}: not over the logo or the corner`);
          assert.ok(p.clear, `${where}: over no pane ${JSON.stringify({ p, avoid })}`);
          assert.equal(p.orient, tray.orient === "column" ? "row" : "column");
        }
      }
    }
  });
}

test("a mouse's flyout on a desktop window: beside the column, one row, clear of everything", () => {
  const area = { w: 1100, h: 800 };
  const layout = defaultLayout(area, TOOLS, FINE);
  const tray = layout.toolbar;
  const avoid = Object.entries(layout).filter(([id]) => id !== "toolbar" && id !== "options").map(([, r]) => r);
  const p = flyoutPlacement({ button: buttonAt(tray, 8, FINE), tray, along: "column", items: 7, m: FINE, bounds: { x: 0, y: 0, ...area }, keep: [cornerBox(FINE)], avoid });
  assert.deepEqual([p.orient, p.lines, p.side, p.clear], ["row", 1, "right", true]);
});

test("at a larger interface size the flyout still fits beside a phone's tray, at 120 %", () => {
  const m = touchMetrics(1.3 * 1.2, 1.3);
  for (const { phone, turn, mode } of everyWay()) {
    const area = areaOf(phone, turn, mode);
    const layout = laidOut(area, m, null);
    const tray = layout.toolbar;
    const avoid = Object.entries(layout).filter(([id, r]) => id !== "toolbar" && !r.fixed).map(([, r]) => r);
    const p = flyoutPlacement({ button: buttonAt(tray, 8, m), tray, along: tray.orient!, items: 7, m, bounds: { x: 0, y: 0, ...area }, keep: [layout.logo, cornerBox(m)], avoid });
    assert.ok(inside(p.rect, { x: 0, y: 0, ...area }) && !meets(p.rect, tray), `${phone.name} ${turn} ${mode}`);
    assert.ok(p.clear, `${phone.name} ${turn} ${mode} at 120 %: ${JSON.stringify(p)}`);
  }
});

// --- the menu and help(), from the same table ----------------------------------------

test("the menu's tool items: a group of more than one under its heading, every member an item in the button's order", async () => {
  await ensureKernelLoaded(await readFile(new URL("../src/kernel/wasm-gen/neocad_kernel_bg.wasm", import.meta.url)));
  const menu = menuFor(new Model(2), null);
  const rows = menu.items.map((i) => (i.action.do === "heading" ? `# ${i.label}` : i.label));
  // By now the shapes group holds the rectangle, the polygon, the slot and
  // t_stamp, and modify the fillet, the stand-in chamfer, t_late and t_base
  // (the tests above): each under its heading. The curves group has two
  // members since the spline (docs/plans/spline.md), so it has a heading too.
  assert.deepEqual(rows.slice(0, rows.indexOf("Frame")),
    ["Point", "Line", "# Shapes", "Rectangle", "Polygon", "Slot", "Region", "T_stamp", "Circle", "Arc", "# Curves", "Ellipse", "Spline",
      "# Modify", "Fillet", "Bevel", "Trim", "Extend", "Offset", "Mirror", "Pattern", "Round", "Chamfer", "T_late", "T_base"]);
  const polygon = menu.items.find((i) => i.label === "Polygon")!;
  assert.deepEqual(polygon.action, { do: "run", command: 'arm("polygon")' });
});

test("help() says which tools share a button, how to open it, and how a tool joins one", async () => {
  const repl = new Repl(neocadScope({ model: new Model(2), optionMemory: new OptionMemory(null) }));
  const help = (await repl.eval("help()")).value as string;
  assert.match(help, /rectangle +.*\[shapes\]/);
  // The curves group shares its button since the spline joined the ellipse (docs/plans/spline.md).
  assert.match(help, /Sharing a button now: rectangle \/ polygon \/ slot \/ region \/ t_stamp; ellipse \/ spline; fillet \/ bevel \/ trim \/ extend \/ offset \/ mirror \/ pattern \/ round \/ chamfer \/ t_late \/ t_base; dimension \/ constrain; extrude \/ surface\./);
  assert.match(help, /static group = "shapes"/);
  assert.match(help, /slides off it onto one and lifts/);
  const tools = (await repl.eval("tools()")).value as string[];
  assert.ok(tools.some((l) => l.startsWith("polygon")), "tools() still lists every tool, grouped or not");
});
