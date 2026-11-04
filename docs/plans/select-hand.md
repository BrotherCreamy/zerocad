# Plan: a Select tool and a Hand tool, first on the toolbar

**Status: built** (2026-11-04), on `claude/select-hand`, after
`chrome-logo-scale.md` merged; see *As built* at the end for every deviation.
The text below is corrected in place where it was wrong about the code,
marked *(corrected)*. The owner: *"there is no hand/selction tool. would be
nice since a lot of people are used to that"*.

Today "no tool armed" *is* selection — a click selects, a drag on an entity
moves it, a left-drag on empty canvas boxes (in 2D and 3D alike; *corrected*:
it said "boxes (2D) or orbits (3D)", but the mouse's right button orbits and
its left always boxes), and under a finger one finger on empty canvas orbits
(pans, in 2D) and two pan — but nothing on screen says so, and panning needs
a middle button or two fingers.

Read `CLAUDE.md`, `docs/plans/effortless.md`, `touch.md`, `box-select.md`,
`toolbar-icons-docking.md`, `chrome-logo-scale.md` (as built),
`src/tools/engine.ts` (idle gestures, `arm`, the finger recogniser's sink),
`src/tools/tool.ts`, the toolbar in `src/panels.ts`, `src/toolavail.ts`,
`src/main.ts` (keydown, the toolbar sync), and the toolbar e2e tests.

## Design

- **Select** — an arrow, the toolbar's first button. **Lit whenever no tool is
  armed**; a tap puts the armed tool down (a feature dialog's picks dropped,
  as Escape does) and leaves the selection alone. Typed as `arm("select")`,
  which means "no tool", so the button, the command line and the toolbar's
  lit state all read one thing. Everything it does is what "no tool" does
  now — no behaviour changes.
- **Hand** — the second button. Armed (`arm("hand")`), **a left-drag or a
  one-finger drag pans the view from anywhere**, over geometry too (nothing is
  moved); the wheel and a pinch still zoom; a tap still selects. It stays
  armed until another tool is chosen, like any tool. On a desktop, **holding
  Space** is a temporary hand (released, the previous tool is back) — skip it
  while the command line has focus.
- Icons in the toolbar's existing style (`toolbar-icons-docking.md`),
  checked at every interface size.
- Escape with a tool armed lights Select again; `cancel()` and the action
  strip's Cancel do too. *(Corrected:* with a feature's picks made, the
  first Escape drops the picks and keeps the tool, as it always has; the
  second lights Select. Pressing Select drops both at once.)

## Tests

Unit: `arm("select")` disarms and keeps the selection; the hand's drag
mapping (pan in 2D and 3D, the point under the cursor stays under it).

E2E, mouse and iPhone 13: Select is lit at start and after Escape; tapping it
puts a half-picked extrude down; with the Hand armed a drag starting on a
line pans and the line has not moved; one finger pans with the Hand and
orbits without it; Space-drag pans and gives the previous tool back; every
existing toolbar test passes with two more buttons (update counts where they
are asserted, and say where). LOOK at the toolbar in both orientations.

## Docs

CHANGELOG at the top quoting the owner; the register (Select is "no tool",
the Hand pans from anywhere, Space is a temporary hand) as vetoable; STATUS;
README; `help()`; the spec marked built.

## As built

Built on `claude/select-hand`. By file: `src/tools/tool.ts` (`SELECT`,
`HAND`, `ENGINE_TOOLS`, `toolbarTools()`, and `defineTool` refusing the two
names); `src/tools/engine.ts` (`arm("select")`/`arm("hand")` through
`putDown`, `hand`, `hold` for Space, `handOn`, `lit`, the Hand's press in
`dispatch` and the finger's `dragStart`, the grab cursor); `src/tools/icons.ts`
(the arrow and the open hand); `src/main.ts` (the toolbar's list and lit
button, the tray's count, Space, the bare names, the Hand kept through an
undo); `src/panels.ts` (`ActionState.hand`, the phone's portrait default);
`src/replenv.ts` (`tools()`, `help()`). Tests: `test/selecthand.test.ts` (9),
`test/e2e/selecthand.e2e.ts` (8: four with a mouse, three under fingers in
iPhone 13 portrait, one in landscape), one more in `test/touchlayout.test.ts`.

Deviations and additions — each a decision, vetoable:

- **Select and the Hand are the engine's, not classes in the registry.** A
  Tool is handed world coordinates and has no camera to pan, and the Hand's
  tap must still reach the selection, which is the engine's. So
  `listTools()` is unchanged, `toolbarTools()` is Select, the Hand, then it,
  and `tools()` lists the two first. `defineTool("hand", …)` is refused
  where it is typed — a class under either name could never be armed.
- **Space is an overlay, not a disarm and re-arm**: the armed tool stays
  armed underneath, so a half-drawn rectangle or a half-picked extrude is
  there, as it was, when Space comes up. Only a press made while Space is
  held pans; a pan begun under it runs to its release. A still click under
  Space reaches no one (not the tool, which never saw the press; not the
  selection, which is no business of a tool's gesture).
- **Space is skipped while anything that takes keys has the focus**, not
  only the command line: an options field, and a focused button (whose
  Space presses it). The printable-key routing into the command line skips
  Space for the same reason: a command never starts with one. A window that
  loses focus mid-hold lets the Hand go.
- **The Hand does not spend the selection** (arming a tool does), and
  `arm("select")` keeps it: Select is "stop drawing", not "forget what I
  picked". Escape and `cancel()` put down the Hand and the selection
  together, as they put down a tool and the selection.
- **The Hand survives an undo** (main.ts's `step` re-arms it, as it re-arms
  a tool). Opening a file puts it down, as it puts a tool down.
- **A cursor**: an open hand over the canvas while a press would pan, a
  closed one while it pans. Not in the spec; a hand tool without one reads as
  broken.
- **The bare names arm them**: `hand`, and `select` — which until now
  printed the `select(...)` function, the canvas-selection command. The
  bare-name shortcut is "a tool's name arms it", and the toolbar says
  `select` is a tool's name.
- **The Hand's options are refused**: `arm("hand", {x: 1})` throws before
  anything is put down, as an option a tool does not have does.
- **The phone's portrait default, where the column is too long**: thirteen
  buttons at a finger's 44 px pitch are a 599 px column, which in Chromium's
  iPhone 13 (390 × 664: Safari's page, its bars taking what the installed
  app has) ran 44 px down onto the edge-to-edge command line, and the two
  were drawn one over the other (a window too small for the resolver to part
  them, so the dev build's overlap check said nothing). Measured in the
  screenshot, fixed in `touchLayout`: where the column would reach the line,
  the line starts right of it, still docked to the bottom and the right
  edge. The installed app (390 × 763) is edge to edge, as before.
- **Counts updated where asserted**: `panels.e2e.ts` (`TOOLS` 11 → 13, and
  the pressed button after Escape or a finished gesture is now Select),
  `touch.e2e.ts` (13 buttons; the portrait command line edge to edge *or*
  beside the column), `touchlayout.test.ts` and `chrome.test.ts` (13),
  `icons.test.ts` (the table covers Select and the Hand).
- **Two existing tests changed their fixture, not their claim.**
  `panels.e2e.ts`'s push-chain test lifts the log 200 px, not 250 (it would
  have landed on the longer column). `chrome.e2e.ts`'s docking-through-
  rotation test docks the **action strip** to the right edge where it docked
  the toolbar, and floats the command line where it floated the strip: a
  13-button line turned to a row along a landscape iPhone's right edge
  leaves 151 px of the 750 px area, less than a log's least width of 160, so
  no pane can rest against it there. The strip is four buttons whatever the
  toolbar holds.
- **The README's phone screenshots are regenerated** from `chrome.e2e.ts`'s
  pictures (`chrome-portrait-100.png`, `chrome-landscape-100.png`), which is
  where they came from.

Limitations left in place, deliberately:

- **A 13-button toolbar and the log do not fit side by side across a
  landscape iPhone** (above). Docked so, the log is held at the area's edge
  and overlaps the row by 9 px; nothing reports it, because the resolver
  says no layout exists. A shorter tray (a second line, or a fold) is the
  owner's to ask for: he vetoed wrapping (`tray-fixed-line.md`).
- **Not tried on iOS Safari**: the Hand under a finger is the recogniser's
  ordinary drag, which the touch package measured in emulation only.
- **Space on a hardware keyboard under a finger** (an iPad): a finger's
  drag under it pans, but a tap still reaches the armed tool — the mouse's
  still click under Space reaches no one. Untested on a device.
