# Plan: no grip marks, and a tool palette that is just a line

**Status: built** (2026-10-29) — one PR against `claude/resume-tasks-o7q02e`
(branch `claude/tray-fixed-line`); every deviation is in `TODO.md`'s Done
entry, and the one place this text was wrong about the code is corrected below
and marked *(as built)*. The owner, verbatim:

> *you dont need those diag lines on every corner. also actually get rid of
> resizing altogether on the tool palette. its just a straight line that fits
> the number of tools it has in it, and can either be vert or horiz*

This reverses part of `docs/plans/panels-corners-wrap.md` (as built, an hour
old): the tray no longer resizes or wraps. Read `CLAUDE.md`, that spec and
`toolbar-icons-docking.md`, `src/panels.ts` (the grips, `resized`, `trayFit`,
`perLine`, `trayDepth`, `traySize`, `turned`, `apply`), `index.html`'s grip
and toolbar CSS, `test/panels.test.ts` and `test/e2e/panels.e2e.ts`.

## 1. Grips without marks

The log and the command line keep their four corner grips — resizing from
any corner stays — but **the diagonal marks go**. A grip is an invisible
12 px corner hot-spot carrying only the resize cursor; the cursor is the
affordance. Nothing else about resizing changes.

## 2. The tool palette is a line

The tray **has no grips and cannot be resized**. It is exactly one line of
its buttons — a column or a row — sized to the number of tools it holds
(`traySize(n, orient)`), re-sized by itself when a tool is defined, and
turned by dragging it against an edge as now. `trayFit`, `perLine`,
`trayDepth`, flex-wrap and every path that fitted a tray to a viewer's size
are deleted, not left idle; a stored tray rectangle's size is ignored on
load (its position and orientation are kept), and the storage key stays `v2`
with the size simply recomputed. A tray too long for the window is clipped
at the window's edge (a window that short is not a case to design for; say
so). The pushing rules stand: a tray growing for a new tool pushes a
neighbour, a dragged tray pushes and turns.

## Verification

Unit: the tray has no grips and `resized` on it is refused or a no-op by
construction *(as built: `resized` is arithmetic on a bare rectangle and does
not know what a tray is, so the refusal is in `dragStep`, the one step every
gesture takes and the only one told a panel is a tray — a resize grab on a
tray comes back with nothing moved — and `gripCorners(true)` is empty, so the
DOM half never makes a grip to start one)*; `traySize` is the only source of its size; a stored size is
ignored; the random walk no longer resizes trays and still holds its
invariants. E2e: no `.pgrip` under the tray; the log's grips carry no visible
mark (read the pixels of a corner against the panel's ground) but still
resize from each corner; defining a tool at the command line lengthens the
tray by one button; the tray still turns against the top edge. LOOK at a
screenshot of the tray and a panel corner. Full `npm run test:all`. Docs per
`CLAUDE.md`: CHANGELOG at the top quoting the owner; the register's panels
entry (the wrap rule struck in his words, the grip marks noted); STATUS;
`docs/plans/panels.md` and `panels-corners-wrap.md` caveats; this file
marked built.

## Delivery

Isolated worktree, branch `claude/tray-fixed-line` off the working-branch
tip, one PR against `claude/resume-tasks-o7q02e`. Do not merge; the
supervising session reviews.
