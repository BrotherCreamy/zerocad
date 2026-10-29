# Plan: resize from any corner, and a tray that wraps

**Status: built** (2026-10-29) — one PR against `claude/resume-tasks-o7q02e`
(branch `claude/panels-corners-wrap`); every deviation is in `TODO.md`'s Done
entry, and the places this text was wrong or silent are corrected below and
marked *(as built)*.

**Caveats since overturned** (owner, the same day; built by
[`tray-fixed-line.md`](tray-fixed-line.md)): *"you dont need those diag lines
on every corner. also actually get rid of resizing altogether on the tool
palette. its just a straight line that fits the number of tools it has in it,
and can either be vert or horiz"*. So §2 is gone entirely — the tray has **no
grips and no wrap**, `trayFit` / `perLine` / `trayDepth` and the flex-wrap are
deleted, and the tray is always one line (`traySize`), its stored size
ignored. §1 stands for the log and the command line, except that the "same
12 px triangle as today's" is now **drawn as nothing**: the hot-spot and its
cursor remain, the diagonal marks do not. The rest of this file is the record
of what was built and then removed.

The owner's direction, verbatim:

> *allow me to rescale the popup windows from any corner. the tool palette
> should wrap the icons also - i.e. if it is vertical and i decrease vertical
> size, it should create a second column.*

Read `CLAUDE.md`, `docs/plans/panels.md`, `toolbar-icons-docking.md` and
`panels-push.md` ("as built" sections, including the fixed-grab reversal),
`src/panels.ts` end to end (`resized`, `pushed`, `dragStep`, `traySize`,
`orientationFor`, `turned`, the grip gesture), `index.html`'s panel and
toolbar CSS, `test/panels.test.ts` and `test/e2e/panels.e2e.ts`.

## 1. Any corner

Every panel has **four grips**, one per corner, each the same 12 px triangle
as today's bottom-right one, with the cursor that matches its diagonal
(`nwse-resize` / `nesw-resize`). Dragging a corner moves that corner and its
two edges; the opposite corner stays put. The grab stays fixed (the owner's
rule): the grip is under the hand except when stopped. Everything already
true of the one grip holds for all four: the panel never leaves the area or
drops below its minimum, growing into a neighbour pushes it, a resize
stopped by a chain against the window edge stops flush, and the layout is
stored. Make `resized` take which corner, as a pure function, and test each
corner against each edge and against a neighbour. A tray's grips resize the
tray like any panel; turning still happens only on a strip drag. *(As built:
like any panel along the tray's run; across it, the depth is the buttons' —
see §2 — so a column's corner dragged sideways moves nothing.)*

## 2. The tray wraps

The tray's buttons flow in a **grid**, not a single line. A column tray that
is made shorter than its buttons need **wraps into a second column** (then a
third), and a row tray made narrower wraps into a second row — CSS flex-wrap
in the orientation's direction, the panel's content box deciding, so the
same rule serves a tray resized by any corner and one that gained a tool.
`traySize(n, o)` becomes "the size a tray *wants* for n buttons in one
line", used for a turn and for the defaults; a tray the viewer has resized
keeps its size and wraps inside it. The minimum size is one button either
way. Scrolling goes: a tray can always wrap to fit, so the scrollbar is
retired. A turned tray (column ↔ row) re-sizes to one line in the new
direction as now. Layout storage is unchanged (`v2`: rectangle and
orientation; the wrap is derived).

*(As built: "the panel's content box deciding" cannot be the whole rule — a
corner moves both edges, and a column made shorter but no wider would wrap its
second column out of sight. So `trayFit(r, buttons, area, corner, room?)` keeps
the **run as the viewer left it** — between one button and one line of all of
them; a tray is never longer than its buttons — and makes the **depth exactly
the lines** the stylesheet's flex-wrap makes at that run, which the arithmetic
matches to the pixel. The opposite corner stays put, so a tray wrapped from a
west or north corner grows its new line that way. Where there is no room for
another line — the window edge, or a chain against it — the tray keeps the
lines that fit and the shortening stops, as at a minimum. `apply` fits too, so
a tool defined into a shortened tray, or a window too short for one line,
wraps.)*

## Verification

Unit: `resized` for each corner (grows and shrinks, the opposite corner
fixed, the minimum, the area's edges, a neighbour pushed, a blocked chain
stopping flush, the grab under the hand when not blocked); the random walk
extended to drag random corners as well as strips, asserting no overlap, no
pixel outside and no panel below its minimum. E2e: resize the log from each
of its four corners and assert the opposite corner did not move; shrink the
tray's height from its bottom-right corner until it wraps and assert two
columns (button positions); do the same to a row from the right and assert
two rows; turn a wrapped tray and assert it comes up one line; define a tool
at the command line and assert the wrapped tray still shows every button
with no scrollbar; LOOK at the screenshots of the wrapped tray at both
orientations. Full `npm run test:all`. Docs per `CLAUDE.md`: CHANGELOG at
the top quoting the owner; the register's panels entry (the "scrolls rather
than grows" caveat replaced); STATUS; `docs/plans/panels.md` caveats; this
file marked built. *(As built: the caveat was in STATUS's panels entry, not
the register's; it is replaced there, and the register entry gained the two
new rules in the owner's words.)*

## Delivery

Isolated worktree, branch `claude/panels-corners-wrap` off the working-branch
tip, one PR against `claude/resume-tasks-o7q02e`. Do not merge; the
supervising session reviews.
