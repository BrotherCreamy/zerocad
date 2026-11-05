# Plan: toolbar groups — one button per family, the rest a flyout away

**Status: queued** (2026-11-05), first of the sketch packages. The owner:
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
