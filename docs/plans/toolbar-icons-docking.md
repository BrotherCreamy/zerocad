# Plan: the tool tray — icons, kept inside, turning with the edge it meets

**Status: built** (2026-10-22) — one PR against `claude/resume-tasks-o7q02e`
(branch `claude/toolbar-icons-docking`); deviations are in `TODO.md`'s Done
entry, and the two that changed what this spec says are corrected in place
below and marked *(as built)*. The owner's direction, verbatim, on the
panels package:

> *I shouldnt be able to slide the tooltrays off the edge. they should stay
> fully within the viewport borders*
> *tools should be icons*
> *when I push a vertical tooltray against a top or bottom edge, it should
> become horizontal etc and vice versa. that includes pushing it up against a
> vertical/horizontal edge of another tooltray*

Three defaults the panels package shipped with a veto are hereby vetoed:
"a panel may be parked mostly off an edge" (`KEEP`), "labels are the tool
names, not icons", and a tray that is always a column. Read `CLAUDE.md`,
`docs/plans/panels.md` and `toolbar-availability.md`, `src/panels.ts` end to
end, `index.html`'s panel and toolbar CSS, the `Toolbar` host and
`syncToolbar` in `src/main.ts`, `src/tools/tool.ts` (`listTools`,
`defineTool`), `test/panels.test.ts` and `test/e2e/panels.e2e.ts`.

## 1. Fully inside

`constrain` holds every panel **wholly within the area**: `0 ≤ x ≤ area.w − w`
and `0 ≤ y ≤ area.h − h`, a panel larger than the area shrunk to fit as now.
`KEEP` and the "parked mostly off" reasoning go. A stored position that is
now outside is pulled in on load, as a smaller window already does. Resizing
by the grip cannot push a panel out either (it already cannot).

## 2. Icons

Every built-in tool has an **icon**: a small inline SVG (no dependency, no
font, no image file — a handful of strokes each, 16 px, drawn in the
button's current colour so the armed amber and the disabled grey apply to the
glyph exactly as they applied to the label). The icon is the whole button;
**the tool's name is its tooltip**, with the command under it
(`circle — arm("circle")`), and for a disabled tool the reason, as now.
*(As built: `circle — <reason>` — the name still leads, since with an icon
on its face a reason alone would never say which tool is greyed.)*
Glyphs: point (a dot), line, rectangle, circle, circle3 (a circle through
three dots), arc, arc3 (an arc through three dots), fillet (a corner with its
inside rounded), extrude (a square with a raised face), revolve (a profile
with a turning arrow), sketch (a plane with a pencil). Keep them to the one
visual family: same stroke width, same corner radius, no fills but the dot.
**A tool defined at the command line has no icon**; it gets the generic
glyph — a small square carrying the first two letters of its name — so it is
still a button and still readable. Register this as the rule: an icon is a
property of a built-in tool's definition (a static on the tool class, or a
table keyed by name beside the registry — choose, say why), never guessed.

## 3. Turning with the edge it meets

The tray has an **orientation**, column or row. **While it is dragged**, the
moment it comes within a snap distance (8 px, say — *as built, 6: the defaults
sit 8 px off every edge, and at 8 the untouched toolbar dragged along the top
would turn on its first pixel*) of:
- the area's **top or bottom edge**, or the **horizontal edge** (top or
  bottom) of another panel it is beside → it becomes a **row**;
- the area's **left or right edge**, or the **vertical edge** of another
  panel it is beside → it becomes a **column**;
- both at once (a corner) → it keeps the orientation it has;
and it re-sizes to its content in that orientation (a row is one button
high and as wide as its buttons; a column the reverse) and is re-constrained
to stay inside, keeping the edge it is against. Live, during the drag, so the
viewer sees it turn as they push — not on release. "Beside" another panel
means the tray's edge is within the snap distance of that panel's edge and
the two overlap along that edge. The orientation is stored with the layout
(the storage key becomes `v2`; an old `v1` layout reads as nothing, i.e. the
defaults — per-viewer state, costs nothing). A resized tray (the grip) keeps
its orientation and scrolls as now.

The log and the command line are panels, not trays: they keep their shape.
Build the rule as a pure function in `panels.ts` (`orientationFor(rect,
current, area, others, snap)`) tested without a DOM, and keep the DOM half
thin as the file's header promises.

## Verification

Unit: `constrain` never leaves a pixel of a panel outside, from every side and
for a panel bigger than the area; `orientationFor` for each edge of the area,
each edge of another panel (beside and not beside), the corner case, and
"nowhere near anything → unchanged"; the icon table covers every registered
built-in and the generic glyph takes any other name. E2e (extend
`panels.e2e.ts`): drag the tray toward the right edge past it → it stops
flush inside; drag it to the top edge → it turns into a row, flush with the
top; drag it to the left edge → a column again; drag it up against the log's
top edge → a row; against the log's right edge → a column; reload keeps the
orientation; `layout("reset")` restores the column; every button holds an
SVG and a tooltip carrying the name; a command-line-defined tool gets the
generic glyph; the armed button's glyph is amber and a disabled one's is
grey. LOOK at the screenshots at the toolbar's size: each icon must say
which tool it is to someone who knows the tools. Full `npm run test:all`.
Docs per `CLAUDE.md`: CHANGELOG at the top quoting the owner's three lines;
the register's panels entry updated (the three vetoes, with his words) and
the open-decision list's item 6 struck; STATUS; `docs/plans/panels.md`'s
caveats; this file marked built.

## Delivery

Isolated worktree, branch `claude/toolbar-icons-docking` off the
working-branch tip, one PR against `claude/resume-tasks-o7q02e`. Do not
merge; the supervising session reviews.
