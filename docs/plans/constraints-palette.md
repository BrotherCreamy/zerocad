# Plan: a constraints palette of its own, as a workbench

**Status: queued** (2026-11-09). The owner: *"the constraint list should not be
on the features palette, it should be a separate constraints palette. although
i think it should still be installed as a workbench."*

## What is true today

The constrain tool's list (`constraintsFor`) is drawn in the **tool options
pane** (`src/tools/options.ts`, panels.ts), the same pane extrude's depth and
the dimension tool's ⌀/R live in. It appears only while the constrain tool is
armed, and on an iPhone it is tall enough (7 rows for two circles, 8 for two
lines) to cover the drawing, including what was picked (TODO.md,
2026-11-08). The context menu shows the same list under a Constrain heading.

Read `CLAUDE.md`, `docs/ARCHITECTURE.md`, `docs/plans/workbenches.md` (what a
module and a workbench are; the organiser is a module), `panels.md` and its
successors (`panels-push.md`, `panels-reshuffle.md`, `everything-fits.md`:
how panes find room), `relations-complete.md`, `tool-options.md`,
`src/organiser.ts` (a palette that is a module), `src/panels.ts`,
`src/tools/constrain.ts`, `src/dimensioning.ts`, `src/modules/*.ts`.

## Design

1. **A palette, not a tool pane.** `constraints` is a panel like the
   organiser: titled, dockable, movable, remembered, open or closed by the
   app menu and the toolbar's panels control. It shows, for the **current
   selection**, whatever tool is armed:
   - the relations that apply (`constraintsFor`), one row each, greyed with
     the reason where one does not;
   - below them, the relations the selection **already has**, each with its
     glyph, its value for a dimension, and a delete control. Clicking one
     selects it.
   With nothing selected it lists the drawing's relations, newest first, so
   it is also the place to see what holds a drawing.
2. **The constrain tool stays**, as the way to pick by clicking; its own
   options pane goes. Picks made with it, or with select, both feed the
   palette. A row pressed types the relation, as today.
3. **Room on a phone.** The palette docks at the bottom on an upright iPhone
   13 and at the side when landscape, as the panels' make-room already
   places panes, and it is sized so that a two-line selection's 8 rows plus
   the existing relations fit without covering the picks. Measure the owner's
   case: two circles picked, the list up, both circles and the mirror line
   visible. If 8 rows cannot fit, the likeliest 4 show and a "more…" row
   opens the rest.
4. **A workbench.** The palette is a module (`src/modules/constraints.ts`),
   in the `part` workbench by default, and removable like any module that is
   not built in. Say in `help()` and in the workbench list what it is.
5. **The context menu** keeps its Constrain heading for a right-click or
   long-press.

## Tests

- Unit: the module registers; the palette's rows equal `constraintsFor` plus
  the selection's relations; a row press types the call; delete removes.
- E2E, mouse and iPhone 13: two circles picked, the palette up, both circles
  and the line still visible and tappable (the Symmetric case); a dimension
  edited from the palette; the palette hidden and shown; the workbench
  without it. LOOK at the pictures.

## Docs

CHANGELOG top, quoting the owner; STATUS; ARCHITECTURE (palettes as modules);
the register; `help()`; the TODO item "the constrain list covers what it is
about, on a phone" ticked; the spec marked built.
