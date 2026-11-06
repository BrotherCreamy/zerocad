# Plan: panels reshuffle — a dragged panel takes its place among the others, they don't get shoved

**Status: queued** (2026-11-06), after `touch-density.md` (both change
`panels.ts`; this one changes what the drag preview previews). The owner:
*"When I push toolbars around, they should be able to reorder with other
toolbars. So reshuffle rather than push."*

## What is true today

`panels-push.md` built pushing: a panel dragged into another moves the other
out of the way along the drag, in chains, and the panels end up wherever the
push left them. `panels-preview.md` made that a preview (ghosts) committed at
the drop, decided by the spot the hand is at. A panel never changes **order**
with another: the command line dragged over the log pushes the log along,
it does not trade places with it.

Read `CLAUDE.md`, `docs/ARCHITECTURE.md` ("The chrome floats"),
`panels.md`, `panels-push.md`, `panels-preview.md`, `panels-corners-wrap.md`,
`panels-overlay-lock.md`, `touch-density.md` (as built), `everything-fits.md`,
`src/panels.ts` (the resolver, `dragStep`, docking, chains, `arranged`),
`src/main.ts`'s panel dragging, and the panels, panelspreview, fits, chrome
and touchlayout tests.

## Design

- **Panels along an edge are a sequence.** The panes docked to one edge (or
  docked against each other in a chain along it) are kept as an ordered list
  for that edge: top to bottom on a side edge, left to right on the top or
  bottom. Their positions are laid out from the order — each one after the
  last, a gap apart — not remembered as coordinates, so a reorder is a new
  order and the layout follows.
- **Dragging along an edge reorders.** A pane dragged along its edge past
  the middle of a neighbour takes the neighbour's slot, and the neighbour
  moves into the slot it left (and so on down the line, as a dock's icons
  do). The ghosts show the new order at every move (the preview's rule
  stands: the preview is the drop at this spot, decided from the press).
- **Dragging to another edge inserts.** A pane brought to another edge is
  inserted into that edge's sequence where the hand is, between the two it
  lands between; the rest of that edge closes up or makes room. A tray that
  turns at the edge (row to column) turns as it does now, at the drop.
- **Dropping on a floating pane swaps.** A pane not docked to anything,
  dropped on another floating pane, trades places with it (each takes the
  other's position, clamped inside the area). Dropped on empty space, a pane
  floats where it is put, as now.
- **Push is gone as the default; it stays where order cannot help**: when a
  pane is inserted into an edge with no room for it, the edge's sequence
  wraps to a second line (as the tray's lines do) or, failing that, the
  resolver refuses and the preview says "no room on this edge". Nothing is
  ever pushed off screen.
- **The logo's corner is still fixed**; a sequence starts after it.
- **Lock** (`panels-overlay-lock.md`) refuses reordering as it refuses
  dragging.
- Old layouts translate: the panes along an edge are read into a sequence in
  the order of their positions.

## Tests

Unit: an edge's sequence from positions; a reorder past a neighbour's middle
swaps exactly those two; a drag down a column of four moves the held pane
through the order; insert into another edge between the right two; a
floating swap; no room → wrap, then refusal; old layouts read into the same
order. E2E (mouse, iPhone 13 and a Pixel, portrait and landscape): drag the
command line past the log — they trade places, ghosts first; drag the
organiser to the other side — inserted where dropped; drag a floating pane
onto another — swapped; Escape mid-reorder commits nothing; the fits suite.
LOOK at each picture.

## Docs

CHANGELOG at the top quoting the owner; ARCHITECTURE ("The chrome floats":
sequences, not pushes); `panels-push.md` marked superseded where it is; the
register (sequence per edge, swap for floating, wrap then refuse) as
vetoable; STATUS; README's panels paragraph; `help()`; the spec marked built
with the deviations.
