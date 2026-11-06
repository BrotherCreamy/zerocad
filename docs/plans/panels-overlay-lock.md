# Plan: see-through panels, each in an overlay form of its own, and a lock

**Status: built** (2026-11-06), on `claude/panels-overlay-lock`; see *As
built* at the end for what was measured and every deviation. Queued
2026-11-06, after `panels-preview.md` (both are the resolver's and the
panels' drawing; this one builds on the preview's drag). The owner: *"there should be a menu option to make the toolbars
transparent to maximize visible viewport size. and also another option to
lock the toolbars in place. note: things like the organiser toolbar etc need
to have some kind of structure to their layout in order to make the
transparent view work. like how the feature tree in solidworks changes form
when it is overlaid over the viewport vs being in a pane on the side"*.

## What is true today

Every pane (`panels.ts`) is an opaque box with a strip, a border and a
background, placed by the resolver; the canvas is visible only where no
pane is. On a phone the panes take a large share of the screen. A pane can
always be dragged by its strip, and a tray turned by pushing it to an edge.
The organiser is a list of sections (Bodies, Groups, Features, Regions) with
headings and rows, drawn for an opaque box.

Read `CLAUDE.md`, `docs/ARCHITECTURE.md` ("The chrome floats, and its layout
is the viewer's"), `panels.md`, `panels-push.md`, `panels-preview.md` (as
built), `everything-fits.md`, `chrome-logo-scale.md`, `mode-feedback.md`
(the chip and the drawn plane, which must stay legible over the drawing),
`organiser.md`, `src/panels.ts`, `src/organiser.ts`, `src/appmenu.ts`,
`src/main.ts`'s panels, `index.html`'s panel styles, and the panels, fits,
chrome, organiser and touchlayout tests.

## Design

- **Two switches in the logo menu's View section**, each a check item, the
  viewer's (remembered with the layout, never in a file, never journalled —
  as the interface size is), and typed: `panels({ overlay: true })`,
  `panels({ locked: true })`; `panels()` says both.
- **Overlay** — *see-through panels*. Every pane loses its box: no
  background, no border, no strip. What is left is its **content drawn
  straight over the drawing**, legible on either ground (the dark canvas
  and a light solid's face): text and glyphs get a thin dark halo
  (`paint-order: stroke` / a 1–2 px text-shadow, at the interface size), and
  buttons a faint backplate only under the hand. **Empty space is the
  drawing's**: only content takes a press (`pointer-events` on the content,
  not the pane), so a tap between two organiser rows, or beside a tray's
  buttons, reaches the canvas — measured, not assumed.
- **Each pane has an overlay form of its own**, because a box's layout read
  through is clutter (the owner's SolidWorks comparison: the FeatureManager
  flown out over the view is a compact tree, not the docked pane made
  transparent):
  - **Toolbar** — the buttons alone, in their column or row, no tray; the
    group mark and the flyout unchanged.
  - **Organiser** — a **tree that hugs its corner**: one indented column of
    rows, each an icon (body, feature, region, group) and its name, a
    body's chain as its children (`e1` › `e2 cut`, `e3 fillet`), groups and
    regions as their own roots; section headings become those roots, not
    labels in a box; collapsed by default to bodies and their last feature,
    each root a tap to open; empty sections not drawn at all. Its rows are
    the docked organiser's rows, the same actions on them.
  - **Log** — the last three lines, fading with age (a line goes after ten
    seconds), over the drawing; tapping the area brings the whole log back
    as a docked pane until the next tap outside it.
  - **Command line** — the input alone, an underline and the prompt, at the
    bottom edge; the keyboard behaves as now.
  - **Action strip** (undo, redo, delete, cancel) — the buttons alone.
  - **The options panel, the feature dialog, menus, tooltips and the mode
    chip stay opaque**: they are read and typed into, not looked through.
    The chip keeps its own legibility rules (`mode-feedback.md`).
  - A pane under the hand (hover, or a finger on it) is drawn in its docked
    form for as long as the hand is there, so a row can be read against a
    busy drawing; it fades back when the hand leaves.
- **Lock** — *panels stay where they are*. Strips and grips are not drawn
  and take no press, a drag on a pane does nothing to its place, a push
  never moves it, and a rotation keeps the docking it has (the resolver
  still runs, so a locked layout that no longer fits after a rotation is
  re-fitted once, said in the status, and stays locked). A press on where a
  strip would be says *"panels are locked — unlock in the menu"* in the
  chip's guidance. With both on, the drawing has every pixel the content
  does not.
- **Everything fits still holds**, in both forms and locked or not: nothing
  overlaps, nothing is under an inset or the status, on every device in the
  table (and the Android rows once `android.md` lands).

## Tests

Unit: each pane's overlay form from the same data as its docked form (the
organiser tree's roots and children equal the sections' rows); the two
switches remembered and not journalled; a locked layout refuses a drag and a
push. E2E (mouse and iPhone 13, portrait and landscape): overlay on — the
canvas takes a press between organiser rows and beside the toolbar's buttons;
text legible over a light lid and the dark ground (sampled contrast ≥ 4.5:1
under the halo); the hover brings the docked form back; the log's lines fade;
lock on — strips gone, a drag does nothing, the guidance says why; both on
after a rotation; the fits suite with each. LOOK at each picture: this is
about what the drawing looks like with the chrome laid over it.

## Docs

CHANGELOG at the top quoting the owner; ARCHITECTURE ("The chrome floats"
gains the overlay forms and the lock); the register (the overlay forms per
pane, the halo, the opaque exceptions, the lock's rules) as vetoable;
STATUS; README's panels paragraph; `help()`; the spec marked built with the
deviations.

## As built

Built on `claude/panels-overlay-lock` (2026-11-06). By file: `src/panels.ts`
(the switches — `PanelSwitches`, `SWITCHES_KEY`, `parseSwitches`,
`loadSwitches`, `saveSwitches`, `switchesFrom`, `panelsLine`,
`describeSwitches`; `hugOf`; `refitted`; the locked drag, `beginDrag`'s
`locked` with `dragTo` and `dropOf` honouring it; in `Panels`,
`getSwitches`/`setSwitches`, the hand — `hand`, `pinned`, `HAND_LINGER_MS`,
`OPAQUE_PANES` — `data-hug`, `onLocked`, `onRefit`, `stripTip`'s locked
words); `src/organiser.ts` (`organiserTree`, `collapsedNote`, `TreeNode`, a
row's `chain`, the tree's DOM in `Organiser`); `src/logtail.ts` (new: the
log's tail, pure and its element); `src/appmenu.ts` (the View section's two
boxes, `SWITCH_ITEMS`, `switchCommand`); `src/replenv.ts` (`panels()`);
`src/main.ts` (the wiring: the log's stamps and tail, the tree, the chip's
guidance, the status's re-fit note, the menu's switches); `index.html` (the
tree's and the tail's elements; every rule of the see-through forms, the
halo and the lock); `src/modules/interface.ts` (`help()`). Tests:
`test/overlaylock.test.ts` (10), `test/e2e/overlaylock.e2e.ts` (12: a mouse,
an iPhone 13 and a Pixel 7 both ways up, each see-through and locked; the
re-fit; the log's fade), and `test/e2e/fits.e2e.ts` (+4: every iPhone and
every Android way see-through and locked). Pictures: docs/images/195–205, each looked at.

**Each pane's form, as built.**

| Pane | Docked | See-through |
|---|---|---|
| Toolbar, action strip | a tray: strip, ground, buttons | the buttons alone where they were, each glyph haloed; a faint backplate under a mouse; the group mark and the flyout unchanged |
| Organiser | Bodies, Groups, Features, Regions: rows with count, eye, open marker; the ＋ | a tree in its pane's corner: each body a root with its chain as children, the Groups and Regions headings each a root with their rows; collapsed to the body and `› its last feature`, a heading to its count; empty sections absent; icon and name only |
| Log | every line, scrolling | the last three lines, whole for 3 s and gone at 10 s, in their colours |
| Command line | strip, ground, `>`, input, hint | the `>` and the input on an underline, at the pane's bottom; no hint |
| Options panel (and the feature dialog in it), menus, flyout, tooltip, mode chip | — | unchanged, opaque |

**The halo**: every see-through text carries eight 1 px offsets and a 3 px
glow in the drawing's ground (`#0a0e13`), each times the interface size; a
glyph two 1 px drop-shadows. **Measured**, the text's box shot as drawn and
with its glyphs' fill taken away (halo left), WCAG's ratio read at the
strokes' cores: over a light lid (luminance 0.59), a tree row's name 10.4 : 1
under a mouse and 16.5 : 1 on the iPhone 13 and the Pixel 7, the log's line
10.1 and 14.6 : 1 — against 1.2–1.4 : 1 without the halo; over the dark
ground 10.0–16.5 : 1 either way.

**Presses through a pane.** See-through, a pane's box takes no press
(`pointer-events: none`) and its content does (the tray's buttons, the
tree's rows, the tail's lines, the command line's row). Measured with the
point tool on each of the five ways: a press midway between two of the
tree's rows makes a point there, and so does one on the tray's strip's place
beside its buttons; docked, the same spots are the organiser's and the
toolbar's.

**The lock, as built.** No strip is drawn (its ground, border, dots and word
transparent) and no grip is (`display: none`, so no press). The strip still
takes a press on its own band, which moves nothing and says *"panels are
locked — unlock in the menu"* in the chip's guidance; its finger's 44 px
reach out over the drawing goes. A gesture taken locked is a locked `Drag`:
`dragTo` keeps the start at every spot (no pane dragged, none pushed, no
ghost) and `dropOf` commits nothing (`locked`). With see-through on too, the
strip's place is the drawing's. The resolver still runs on every `apply`:
when the area changed and any pane is not where its docking or its default
asked (`refitted`), the status says *"panels re-fitted to this screen —
still locked"* (a longer first wording was clipped by the corner's room on a
landscape phone — seen in the picture); the re-fit is not stored, and turning
back puts every pane where it was locked (e2e).

Deviations and additions — each a decision, vetoable (also in `TODO.md`'s
register):

- **A mouse over a see-through pane brings its box back, not its docked
  form**: ground, border and strip under the same content, so a row reads
  against a busy drawing and the strip can be dragged. The spec has the
  docked form under the hand; under a mouse that turns the tree into the
  sections the moment the pointer reaches a root to open it, so the tree
  could never be used with a mouse. **A press on a pane's content brings
  the docked form** (`pinned`) — the organiser's every column, the whole
  log — until the next press outside it, for any hand. That is the spec's
  rule for the log, made every pane's, and a finger's only way to a strip.
  A tree root's disclosure and a heading pin nothing: they are the tree's.
- **A finger's tree rows are 22 px apart**, drawn 26 px at a phone's 100 %
  — not 44 px targets. Chromium (Android's engine) moves a touch onto the
  nearest control its contact area reaches: with an 8 px fingertip, a tap in
  the middle of every gap up to 18 px went to a row (measured); 20 px was the
  first clear. A row a target tall, as docked, would leave the drawing no
  gap at all. A mouse's rows are 3 px apart.
- **The tree's shape**: section headings became roots for Groups and Regions
  (each holding its rows); the Bodies and Features headings dissolve into a
  root per body with its chain — the first feature included, so `e1` is
  under `e1`, as it is in both docked sections. Collapsed, a body says its
  last feature beside its name (`e1 › e2 extrude · add`) rather than under
  it. A body's name selects, its ▸ opens; a heading opens wherever it is
  tapped. A feature in no body's chain would be a root of its own (none is
  today). The eye, the count, the open marker and the ＋ are the docked
  form's; see-through, the open group's icon is amber, a hidden row struck
  through, a selected one violet.
- **"Hugs its corner"** is the corner of the pane nearest the area's corner
  it lies in (`hugOf`, by which half its middle is in each way). The tree
  sits in that corner of its pane; the log's lines keep to its top or bottom
  but read left to right; the command line's row stays at its pane's bottom
  wherever the pane is.
- **The log's fade**: whole for 3 s, then linearly to nothing at 10 s (a CSS
  animation started at the line's age; `logTail` is the rule). A log hugging
  its pane's top has its lines where its strip was, so there the strip's
  place is the log's, not the drawing's.
- **The switches are stored under their own key**, `neocad.panels.switches.v1`,
  beside the layout's rather than in it: `layout("reset")` puts the panes
  back and leaves how they are drawn alone. `layout("reset")` still moves
  panes while locked — it is typed, and the way back.
- **The lock leaves the resolver alone**: a pane shown again, a tray grown
  by a new tool, the options panel coming and going are placed as before,
  and nothing of it is stored. Only a hand's gesture is refused.
- **The strip's tooltip** says the panels are locked, and where to unlock.
- **Every pane fades** between its forms (0.2 s on its ground, border and
  shadow); the organiser's and the log's bodies swap at once.

Limitations left in place, deliberately:

- **An empty organiser draws nothing see-through**, so there is nothing to
  hover or press: its ＋ is reachable only docked (the menu's box, or
  `opengroup(group())` typed).
- **A small pane scrolls its tree**: the organiser a portrait phone gives
  (121 × 183 on a 390 pt phone) shows about four roots at a finger's
  spacing; the rest scroll.
- **A fatter fingertip** than the emulation's 8 px may still be moved onto a
  row by Android's touch adjustment; iOS adjusts differently. Not tried on
  either device.
- **At a desktop's 100 %** the halo makes small type read heavier; the
  contrast is measured, the taste is not.
