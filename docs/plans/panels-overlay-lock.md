# Plan: see-through panels, each in an overlay form of its own, and a lock

**Status: queued** (2026-11-06), after `panels-preview.md` (both are the
resolver's and the panels' drawing; this one builds on the preview's
drag). The owner: *"there should be a menu option to make the toolbars
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
