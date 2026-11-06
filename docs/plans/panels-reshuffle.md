# Plan: panels reshuffle — a dragged panel takes its place among the others, they don't get shoved

**Status: built** (2026-11-06), on `claude/panels-reshuffle`; see *As built*
at the end for what was measured and every deviation. Queued after
`touch-density.md` (both change `panels.ts`; this one changes what the drag
preview previews). The owner:
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

## As built

Built on `claude/panels-reshuffle` (2026-11-06). By file: `src/panels.ts`
(the reshuffle's pure half — `Edge`, `EDGES`, `orientAlong`, `edgeGap`,
`EDGE_REACH`, `reachOf`, `edgesOf`, `sequences`, `runOf`, `reordered`,
`inserted`, `wrapped`, `landing`/`furthest`, `reshuffled`, `NO_ROOM`,
`NO_SWAP`; `Drag.refused`; `dragTo` asking `reshuffled` for a drag by the
strip and the old push only for a grip; `dropOf` refusing a refused spot; in
`Panels`, the refused ghost's `data-note` and the status's word); `index.html`
(the note on a refused ghost); `src/modules/interface.ts` (`help()`). Tests:
`test/panelsreshuffle.test.ts` (12, the spec's list and a 1 500-gesture
walk), `test/e2e/panelsreshuffle.e2e.ts` (23: a mouse, an iPhone 13 and a
Pixel 7 both ways up, each reordering, inserting, swapping and Escaping; a
lock; an edge with no room), and the suites that asserted the push in a drag
(`panelspreview.test.ts`, `overlaylock.test.ts`, `panels.e2e.ts`,
`panelspreview.e2e.ts`), which now assert the reshuffle.

**How it works.** At every move the preview is still the drop at this spot —
one step from the layout at the press (`dragTo`) — but the step is
`reshuffled`, not the push. It reads each edge's sequence from where the panes
were at the press (`sequences`: every pane whose side is within `reachOf` of
that edge, in order along it) and decides from where the hand has the held
pane now:

1. **Still on an edge it was on at the press** (of two, a corner, the one
   running the way it has moved further): it **reorders** (`reordered`). Its
   leading edge past a neighbour's middle, it takes that neighbour's slot —
   and on down the line. The block from its old slot to its new one is laid
   out again in the new order from the block's first place, each pane its own
   length and the gaps between the places kept, so the block's ends do not
   move and nothing outside it does. Short of any middle it slides, and stops
   flush against whatever it meets.
2. **On another edge**: it is **inserted** (`inserted`) where the hand has it
   along the edge, as far off it as the hand has it, between the two whose
   middles are either side of its own; lying on the one before, it goes just
   after it; those after it make room, each only as far as it must (an 8 px
   gap, or the gap two neighbours already had where that was less); where
   the last would leave the edge, the line closes back from the far end. A
   tray takes the way that edge runs — in its ghost; in the hand it keeps its
   shape until the drop.
3. **No room on that edge**: a **second line** beside the first line's panes
   it lies along, 8 px further off (`wrapped`); failing that the preview is
   **refused**: the start, the held pane's ghost at home with *no room on
   this edge* written on it, and at the drop nothing moves and the status says
   *no room on this edge — nothing moved*.
4. **On no edge, its middle on a pane that is on no edge**: the two **trade
   places**, each at the other's top-left corner, its own size, held inside;
   where that would put one on a third pane (or the two on each other — their
   sizes differ), refused: *no room to trade places there*.
5. **Anywhere else**: it lands where the hand has it if that lies on
   nothing; else at the furthest point toward the hand that does, along the
   line from its place at the press and then along each axis
   (`landing`). **Nothing is pushed by a drag.**

**Measured** (a scratch walk over the unit test's own 1 500 random gestures on
a phone's defaults, both ways up, four moves each; Node on the shared box):
`dragTo` per move 0.009 ms median, 0.03–0.05 ms p95, 3–5 ms max (a GC).
Outcomes upright / on its side: moved 470 / 453, refused for no room 206 /
232, refused a trade 31 / 39, unchanged 42 / 25, back 1 / 1. Random spots
are often against an edge with no room on it — the push used to make that
room; now it is a refusal, said.

Pictures: docs/images/224–231, each looked at (below, *Pictures*).

Deviations and additions — each a decision, vetoable (also in `TODO.md`'s
register):

- **The sequence is read, not stored.** The spec has the order kept as a list
  per edge and positions laid out from it. Built: the order is read from the
  positions at every press, and the layout is stored as it was (v3 dockings,
  unchanged) — so `refit` and the bottom-only bleed are untouched, and an old
  layout "is read into the order of its positions" by construction (unit
  test: a v2 layout migrated, re-laid and arranged gives the same sequences).
  The cost: a reordered pair that is not flush (a gap between them) is not
  docked to each other, so a rotation re-lays each by its own share of the
  room, and in principle two of very different sizes could come back in the
  other order. Not seen; not tested.
- **"On an edge" is within reach, and never both of a pair**: 16 px at a
  mouse's 100 %, at least half a target under a finger (22 at a phone's
  100 %) — more than the defaults' 8 px margin, so a fresh screen's panes are
  on their edges. A pane against two opposite edges (a phone's command line
  edge to edge) is on neither of them: in a side's sequence it would be a
  slot as wide as the screen, which no pane beside another could take.
- **Past the middle is the held pane's leading edge** past the neighbour's
  middle, the way it is moving from the press.
- **A reorder is a dock's**, the block laid out again with its gaps kept; the
  spec's "each one after the last, a gap apart" is the gap the places had.
- **"The rest of that edge closes up or makes room"**: built as the
  destination making room. The edge the pane left is left as it was — a pane
  the hand did not take moves only to make room for it. (Closing up the
  source would have the desktop's log and command line jump from the bottom
  to the top when the tray leaves the left edge.)
- **A reorder or a trade that would put a pane on another is refused, said**
  — not pushed. Upright in Safari the phone's command line runs down the right
  edge under the log; past the log's middle the 331 px line in the log's slot
  would lie on the organiser, so that is *no room on this edge*.
- **Any pane may trade places with a floating one** — the spec says "a pane
  not docked to anything"; built for any held pane on no edge now, whatever
  it was on at the press. By top-left corner, as the spec's "each takes the
  other's position".
- **A drag elsewhere stops flush rather than pushing**, and lands past what it
  crossed: the first build stopped a pane at the first thing on the line
  from the press, so the action strip carried over the log to empty drawing
  stopped on the log. (Found reasoning about the e2e's set-up, before a
  browser ran it.)
- **When a tray turns.** Inserted into an edge it does not lie along; and
  when it has left the edge it lay along for another it was on (a row in a
  landscape phone's bottom-left corner slid up the left edge becomes a
  column). One that lay along none of its edges — the phone's action strip,
  a row down the right edge — keeps its way as it moves along, until it is
  pressed right up against that edge (within `SNAP`, 6 px, the turn's own
  reach): then it turns, as a tray always has against the edge it meets
  (`chrome.e2e.ts` docks the strip to the right edge that way, and is what
  found the first build missing it — ARCHITECTURE's bug 44). In free space
  it still turns against a pane's edge or the area's (the owner's *"that
  includes pushing it up against a vertical/horizontal edge of another
  tooltray"*), where the turned shape lies on nothing.
- **The logo's corner**: an edge's run stops at a fixed panel on it, so the
  left edge's starts under the logo and the top's right of it.
- **A resize by a grip still pushes**, and so does `apply` (`settled`: a tray
  grown for a new tool, a pane shown again). Neither has an order to change.
- **The refusal is written on the ghost** (amber on a dark pill, the
  outline the ghosts' solid translucent white), and in the status at the
  drop.
- **The e2e pairs on a phone.** The command line and the log share no edge
  on a phone (upright the line is along the bottom, the log down the right;
  on its side the line is along the top), so "the command line past the log"
  is the mouse's; upright the log passes the action strip, on its side the
  command line does. `panelspreview.e2e.ts`'s "onto the log" became the same
  pairs, and its upright tray turn goes to the bottom — a row along the top
  of an upright phone is refused (below).
- **`chrome.e2e.ts`'s docking test** brought the log against the turned
  strip by pushing it right far past it; carried to the edge now it is
  inserted under the strip, so the test takes it 10 px into the strip, short
  of the edge's reach, where it stops flush against the strip's left — the
  same docking, reached without a push.
- **`touchdensity.e2e.ts`'s side-edge bleed test** took the landscape strip
  to the right edge and 60 px down into the log and the organiser, which the
  push made room for; now there is none there (refused, said), so it slides
  the strip straight along the top to the right edge. Its claim — drawn at
  the safe area's line — is unchanged.
- **The files the brief listed**: there is no `panelspush.e2e.ts` (the push's
  e2e lives in `panels.e2e.ts`) and `touchlayout` is a unit test; both were
  run as what they are.

Limitations left in place, deliberately:

- **No push means no room is made across an edge.** The toolbar brought to the
  top of an upright phone is refused: the organiser and the action strip
  are under the logo's row, and nothing moves them out of the way. Bring it
  to the bottom (a second line above the command line), or move them first.
  A third of random drops are refusals (above).
- **A refused ghost's word in a narrow column** wraps a word to a line
  (picture 231): legible, cramped.
- **Trades by top-left corner** refuse two floating panes of very different
  sizes close together (the bigger at the smaller's corner lies on it).
- **Not tried on an iPhone**; the phones are Chromium's emulation.

## Pictures

Each looked at, at full size:

- **224** — a mouse, the command line held past the log's middle: the line in
  the hand over the log, the log and the rest at half, a ghost where the line
  will be (the log's old top) and one where the log will be (ending where the
  line ended). Busy where the held line covers the log's ghost, but each
  outline reads as an outline.
- **225** — dropped: the command line above the log, both in the column
  they shared, nothing else moved.
- **226** — an iPhone 13 upright, the log held past the action strip's
  middle: the log's ghost at the strip's place under the logo's row, the
  strip's ghost below it at a 2 px line, the organiser and the tray faint.
- **227** — on its side, the command line slid right along the top past the
  strip: the strip's ghost where the line began, the line's ending at the
  strip's right end; the log and the organiser down the right edge faint and
  unmoved.
- **228** — the organiser dropped on the right edge, between the log and the
  command line, where the finger left it; nothing else moved.
- **229** — a mouse, the organiser held over a floating log: the log's ghost
  at the organiser's place above, the organiser's at the log's.
- **230** — the tray dragged down the left edge past the log and the command
  line: both their ghosts up where the tray was, the tray in the hand at the
  bottom over the command line, its own ghost under it.
- **231** — an iPhone 13 upright, the tray taken to the top: its ghost at home
  down the left with *no room on this edge* on it in amber — a word to a
  line in the narrow column (a limitation, above), legible.
