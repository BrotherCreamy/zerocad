# Plan: a constraints palette of its own, as a workbench

**Status: built** (2026-11-09, `claude/constraints-palette`; see *As built*
at the end for every deviation). The owner: *"the constraint list should not be
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

## As built (2026-11-09)

Every point of the design above is built, with these deviations and
decisions, each also in TODO.md's register as vetoable:

1. **Palette** (`src/constraints.ts`, pure `paletteFor` + a thin DOM half;
   the pane in index.html as `data-panel="constraints"`). Sections: *relate
   l1, l2* (the `constraintsFor` rows, a greyed one with its reason, a press
   types the line), *l1, l2 have* (the relations naming them or a point they
   are built of — `constrainedBy`, so a line's `dist` between its ends is the
   line's — newest first: the glyph's own mark via `glyphText`, the name,
   what it says, a dimension's value in a field typing `set`, × typing
   `del`; a tap types `select`, a right-click or a held finger opens the
   glyph's menu), and with nothing selected *relations* (all, newest first)
   and *agreeing* (one section per set, `Diagnosis.agreeing`). The constrain
   tool armed with nothing picked says *pick what to relate*.
2. **The constrain tool stays**; `Tool.related()` hands its picks to the
   palette; `commands()` stays for a workbench without the module, where the
   options pane lists them as before. A row pressed with nothing armed
   **keeps the selection** (Onshape clears it) so the held list shows the
   new relation and a second needs no reselecting.
3. **Room on a phone — deviations.** *Hidden from the start, everywhere*,
   summoned by the constrain tool (panels.ts `startHidden`, `summoned`),
   gone when the tool is put down unless shown from Panes. A desktop was to
   start with it up (right edge above the organiser, 240 × 300, where it
   goes when shown), until the first full run found twenty-five e2e tests
   clicking drawing there. *Three
   rows, not four*: a row is a target tall and a strip's hit box reaches a
   target up over the drawing, and four put that reach over the lower part
   of what the relation tests pick. *Landscape at the left under the logo*,
   not beside the right-hand column, which lay over the drawing's middle.
   The rows shown are measured against the pane's real height on each build
   — the likeliest that fit and *N more…* — so the viewer's taller pane shows
   more. Measured, the owner's case: two circles picked on an iPhone 13
   upright, the palette up, both rims and the mirror line clear of every
   pane (`relationscomplete.e2e.ts`, which now picks the circles first).
4. **A workbench module** (`src/modules/constraints.ts`, help only); `part`,
   `sketch` and `surfaces` name it; a workbench that does not has no pane
   (`Panels`' `present`: out of the layout and Panes, `ui({ show })` refused
   by name). The constrain tool cannot summon a pane that is not there.
5. **The context menu's Constrain heading** is untouched.
6. **The register's item 2**, built here: `Problem.analyse({ agreeing })`
   finds each implied block's least implying set (one elimination per
   candidate with its rows left out; the whole support where no single one
   is needed; bounded by 40 trials / 150 ms); `Model.diagnose().agreeing`
   names the sets, merged where they overlap; the status reads
   `0 free · 4 agreeing`, muted, naming none; `redundant` is kept, unsaid,
   for the dimension tool's "already held". Expectations changed: the three
   `redundant rN` status matches and the `#diagnosis` class (`agreeing`).
7. **Bug 71**: the first tap after arming was lost on the phone — the strip's
   reach plus touch adjustment took a tap 30 px above the pane. The harness's
   `at` now refuses a point within a strip's reach under a finger; the
   five-lines test draws a little higher.
8. **Opaque see-through**, as the options panel: read and typed into.
