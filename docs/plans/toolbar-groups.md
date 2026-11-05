# Plan: toolbar groups — one button per family, the rest a flyout away

**Status: built** (2026-11-05), on `claude/toolbar-groups`; see *As built*
at the end for every deviation. First of the sketch packages. The owner:
*"give me better sketch tools, relations, trim, slot... all the usual"* —
and before that *"Second row.... everything has to fit"*.

The toolbar has eleven buttons today (Select, Hand, point, line, rectangle,
circle, arc, fillet, extrude, revolve, sketch) and fits an iPhone 13 as one
column. The packages queued behind this one (`sketch-shapes.md`,
`sketch-edit.md`, `sketch-relations.md`, `spline.md`) add a dozen tools:
polygon, slot, ellipse, spline, chamfer, trim, extend, offset, mirror, pattern,
dimension, constrain. Twenty-three buttons fit no phone as a column and a
two-column tray hides the drawing. This package is the room they go into, so
the others can land in any order without each re-laying-out the tray.

Read `CLAUDE.md`, `everything-fits.md`, `tooltips-rgb-frames.md`,
`toolbar-icons-docking.md`, `tool-options.md`, `one-circle-one-arc.md` (the
aliases), `src/tools/tool.ts` (`toolbarTools`, `defineTool`, `TOOL_ALIASES`),
`src/tools/icons.ts`, `src/panels.ts`, `src/tooltip.ts`, `src/main.ts`'s
toolbar, `test/devices.ts`, and the fits, chrome, tooltips, touchlayout and
toolbar tests.

## Design

- **A tool may declare `static group`.** Tools in one group share one
  toolbar button. The button shows the group's **current** tool: the member
  armed last from that group (per viewer, remembered like options are —
  `optionMemory`'s owner, not storage in the engine), the first member by
  default. A tap or click on the button arms the current tool, as any button
  does. Ungrouped tools keep a button of their own.
- **The flyout.** The rest of a group opens beside the button, as a row (a
  column when the tray is docked top or bottom), each item a button with its
  icon and its tooltip, the current one marked:
  - mouse: **hover** the button a moment (the tooltip's delay) or **press and
    hold**; click an item to arm it; the flyout closes on arming, on leaving
    it, and on Escape;
  - touch: **press and slide** out of the button onto an item and lift — one
    gesture, as a phone keyboard's accents — or **long-press** to open it and
    tap an item; a tap elsewhere closes it. A plain tap never opens it: a
    tap arms the shown tool, and the recogniser's rules in `gestures.ts`
    stand (the tray is the host's, not the canvas's; use the same
    thresholds).
  - A small mark in the button's corner says a group is there (a triangle,
    two pixels; look at it at 1× and 3×).
- **Grouping is a table in `tool.ts`**, beside `TOOL_ICONS`' style, and the
  default is this (vetoable in TODO.md):
  - `select`, `hand` — the engine's, never grouped;
  - `point`, `line` — alone, the two most used;
  - **shapes**: `rectangle`, then `polygon`, `slot` as they arrive;
  - `circle`, `arc` — alone;
  - **curves**: `ellipse`, `spline` as they arrive (the group exists only
    once a member does: a group of none shows no button);
  - **modify**: `fillet`, then `chamfer`, `trim`, `extend`, `offset`,
    `mirror`, `pattern`;
  - `extrude`, `revolve`, `sketch` — alone;
  - a tool defined at the command line with a `group` joins it; without one
    it is its own button, as now.
  So the tray shows eleven buttons today and at most fourteen when every
  queued package has landed.
- **Typed names are untouched.** `arm("polygon")` arms it and the shapes
  button shows it. The menu's tool items list every tool, grouped under the
  same headings. `help()` says which tools share a button.
- **Everything fits still holds**: `trayRoom`, the wrap and the device table
  are unchanged in principle; the flyout is a panel that bleeds like the
  others and is clamped on screen, never under the tray or the status, and
  never over the canvas corner the status line uses. On the SE the flyout
  may need to be two rows; say so in the test.
- A flyout item's long-press shows its tooltip (touch) as a tray button's
  does; its hover does on a mouse.

## Tests

Unit: grouping from the table; a tool with `static group` joins it; the
current member follows the last armed and is remembered; the button list is
eleven today with these names in this order; aliases unaffected; an unknown
group name is a plain button. E2E (mouse, iPhone 13, iPhone SE, landscape and
portrait): hover opens, click arms and closes; press-and-slide arms on a
phone; long-press opens, tap arms; the shown icon changes; nothing overlaps
on any device in the table with the flyout open and closed; the tooltip on an
item; the fits suite's counts updated, claims kept. Add two padding tools
with groups in the fits test so the flyout's room is exercised before the
other packages land. LOOK at each picture.

## Docs

CHANGELOG at the top quoting the owner; the register (groups and the default
table; press-and-slide on touch) as vetoable; STATUS; README's toolbar
paragraph; `help()`; the spec marked built with the deviations.

## As built

Built on `claude/toolbar-groups` (2026-11-05). By file: `src/tools/tool.ts`
(`TOOL_GROUPS`, `Tool.group`, `toolGroup`, `toolbarButtons`, `groupCurrent`,
`defineTool` refusing a group that is not a name); `src/tools/options.ts`
(`GroupMemory`, `GROUPS_KEY` = `neocad.toolGroups.v1`, `parseGroupChoices`);
`src/panels.ts` (`flyoutSize`, `flyoutPlacement`, `FlyoutHost`,
`ToolbarHost.buttons`/`current`/`remember`/`flyout`, the `Toolbar`'s group
buttons and flyout gestures; it now imports `HOLD_MS`, `HOLD_SLOP`,
`HOVER_MS`, `WARM_MS` from `tooltip.ts`); `src/tooltip.ts` (a tip may be
told boxes to keep off, `AttachOptions.clear`); `src/main.ts` (the host:
`groupMemory`, the flyout's bounds, what it keeps off, the tray counted in
buttons); `src/menu.ts` (`heading` items, `toolItems`); `src/replenv.ts`
(`help()`'s tools marked `[group]`, `groupLines`); `index.html` (`#flyout`,
the corner mark, `.sub` in the menu). Tests: `test/toolbargroups.test.ts`
(46), `test/e2e/toolbargroups.e2e.ts` (8), a new test in
`test/e2e/fits.e2e.ts`, one in `test/tooltips.test.ts`.

**The grouping, as built** (unchanged from the default above):

| Button | Members, in order | Today |
|---|---|---|
| select, hand | the engine's, never grouped | 2 buttons |
| point, line | alone | 2 buttons |
| **shapes** | rectangle, polygon, slot | rectangle only — a plain button |
| circle, arc | alone | 2 buttons |
| **curves** | ellipse, spline | no member yet — no button |
| **modify** | fillet, chamfer, trim, extend, offset, mirror, pattern | fillet only — a plain button |
| extrude, revolve, sketch | alone | 3 buttons |

Eleven buttons today, in the same order as before; fourteen once every
queued package has landed (curves gains one).

**How each gesture opens it.** Mouse: rest on the button `HOVER_MS` (400 ms,
the tooltip's), at once if another flyout is open or closed within
`WARM_MS`; or press and hold `HOLD_MS` (500 ms) — the lift then arms
nothing and it stays open; click an item. It closes on arming, 300 ms
(`FLYOUT_LEAVE_MS`) after the pointer is off both the button and the
flyout, on Escape, and on a press anywhere else. Finger: press, move past
`HOLD_SLOP` (8 px = `TAP_SLOP`) — the flyout opens under the moving finger,
the item under it lit (`.hot`) — and lift on an item to arm it, or anywhere
else to put it away; or hold `HOLD_MS` (= `LONG_PRESS_MS`) to open it, lift,
and tap an item. A plain tap arms the button's tool and opens nothing. The
button holds the pointer (`setPointerCapture`) and finds the item by
position at the lift; the canvas recogniser is untouched.

Deviations and additions — each a decision, vetoable:

- **The flyout holds the whole group, the current one outlined**, not only
  "the rest": a family is easier to read whole, and the current member is
  then where the eye already is. The armed one is amber, as on the tray.
- **A group's button has no tooltip of its own once it opens a flyout.** The
  hover and the hold that show a plain button's tooltip are what open the
  flyout; showing both put the tip where the flyout goes. Each item carries
  its tooltip (hover, or a finger's hold, which arms nothing on the lift).
  Its accessible name is still the tool's, with `aria-haspopup` and
  `aria-expanded`.
- **A group of one is a plain button**: no mark, no flyout, its tooltip as
  before. That is every group today, so the app looks and behaves exactly as
  it did until a second member lands; the tests pad the groups with tools
  defined at the command line.
- **The class's own `static group` wins over the table**, so a tool can
  leave a family (`static group = null` is a button of its own); a name not
  in the table is a button of its own (the spec's "unknown group is a plain
  button"); a group that is not text is refused by `defineTool`, as a
  malformed summary is. Not inherited, as a summary is not.
- **A group's button stands where its first registered member does**, its
  members in the table's order then any that joined, in registration order.
  So curves will sit wherever the ellipse's import is put in `main.ts`; the
  package that adds it should import it after `arc.ts` to match the table
  above.
- **The menu lists a group under its heading only when it has two or more
  members**, and only for the tools it already offered (point, line,
  rectangle, circle, arc, fillet) and their groups — it never offered
  extrude, revolve or sketch on empty canvas, and still does not. The heading
  is a new, inert menu row (`{ do: "heading" }`).
- **The flyout is not a layout panel.** It is a fixed element over the
  panels, placed when it opens (`flyoutPlacement`): beside the tray on the
  side with more room, a row beside a column and a column over a row, level
  with its button, slid along the tray to the nearest place clear of every
  other pane, wrapped into more lines where the way out is short. It never
  covers the tray, the logo or the corner's status text, and stays inside
  the safe area — so it never needs to bleed, and does not. Where no clear
  place exists it covers the least it can (`clear: false`); no device in
  the table comes to that. It closes on a window resize rather than
  following the tray.
- **Escape closes the flyout and only that**: the armed tool stays armed;
  the next Escape is the app's. A press elsewhere closes it and goes on to do
  what it does there (it is not swallowed, unlike the context menu's).
- **Press-and-slide works under a mouse too** (press, drag onto an item,
  release): the same code, and harmless.
- **Found by looking: an item's tooltip lay over the tray.** Above or below
  the flyout and centred on its item, a tip slid back over the tray's
  buttons (screenshots at the first run). `tipPlacement` now takes boxes to
  keep off (`clear`), and slides past them along the side it is on; a flyout
  item's tip keeps off its tray. Tested in unit and e2e.
- **The mark** is a right triangle in the bottom-right corner, legs 4 px and
  2 px in from the corner at 100 %, in the glyph's ink at 75 %: at 1× it is a
  few pixels, read as a corner flag (docs/images/111); at 3× it is crisp and
  does not touch the rectangle's or the fillet's glyph (113, 114).
- **`touch-action: none` on a group's button**, so a finger's slide is not
  taken by the browser as a pan.
- **The tray is sized in buttons, not tools** (`toolbarButtons().length`
  where it was `toolbarTools().length`); the same number today.
- **`help()`** marks each grouped tool `[group]` in its tools list, then
  says which tools share a button now, how to open one, and the groups with
  no tool yet. `tools()` is unchanged.

Limitations left in place, deliberately:

- **Not tried on an iPhone.** Pointer capture of a touch, `touch-action`
  and `elementFromPoint` during a slide are standard and work in Chromium's
  emulation; whether iOS Safari sends a click after a long touch on the
  button is unknown, and it is swallowed if it comes.
- **No keyboard way through a flyout**: Tab reaches the group's button,
  Enter arms its current tool; the other members are a typed `arm()` away.
- **Chromium drops the tap that follows a fast slide** (a fling — noted in
  `test/e2e/fingers.ts`); the e2e test pauses before its next tap. Not
  something a hand does.
- **The arithmetic test places buttons by the stylesheet's grid**, to the
  pixel or two; the e2e suite is the authority, and checks every iPhone in
  the table with a flyout open.
