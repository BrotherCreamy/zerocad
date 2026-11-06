# Plan: panels push one another, and the grasp point stays the same

**Status: built** (2026-10-26) — one PR against `claude/resume-tasks-o7q02e`
(branch `claude/panels-push`); every deviation is in `TODO.md`'s Done entry,
and the places this text was wrong are corrected below and marked *(as
built)*. **Rule 2 below was then reversed by the owner** — *"actually the
grasp point should stay the same"* — and the reversal is built too (2026-10-27,
branch `claude/grab-stays`); see the last section. **And the push is now previewed** (the owner,
2026-11-05; built by [`panels-preview.md`](panels-preview.md)): during a drag
the other panels do not move — ghosts show where this resolver would push
them — and the drop commits it; the rules below are unchanged. **And a drag
no longer pushes — superseded for the strip** (the owner, 2026-11-06: *"When I
push toolbars around, they should be able to reorder with other toolbars. So
reshuffle rather than push."*; built by
[`panels-reshuffle.md`](panels-reshuffle.md)): a pane dragged by its strip
reorders along its edge, is inserted into another, trades places with a
floating pane, or stops flush, and a pane it then lands on moves to the
nearest free place — with this push's zero-motion search as the fallback
where there is none. The push below stands whole for a resize by a grip and
for `apply`, and rule 1 (no overlap) stands for everything. The owner's direction, verbatim:

> *shouldn't be able to drag windows over other windows. they should collide
> and push one another around. not collide like physics, just push. also when
> i grab a window at a point on that window, then push it up against
> something, the grab point should kind of slip, so that when i push it back
> in the opposite direction, it doesnt have to get back to the original slip
> point*

Read `CLAUDE.md`, `docs/plans/panels.md` and `toolbar-icons-docking.md`
(the "as built" sections), `src/panels.ts` end to end — `constrain`,
`moved`, `resized`, `orientationFor`, `turned`, the drag gesture and the
re-basing it already does when a tray turns — `test/panels.test.ts` and
`test/e2e/panels.e2e.ts`.

## The two rules

1. **Panels never overlap.** Not during a drag, not after a resize, not when
   a tray turns or grows, not on load. ~~A dragged panel~~ *(superseded for a
   drag by [`panels-reshuffle.md`](panels-reshuffle.md); a resized one still
   does)* A dragged panel that meets another
   **pushes it**, and that one pushes whatever it meets, in a chain. Nothing
   springs back: a pushed panel stays where it was pushed. When a push would
   put any panel in the chain outside the area, the chain cannot move, and
   the dragged panel **stops** flush against it — the window edge is the one
   immovable thing.
2. ~~**The grab point slips.**~~ *(Withdrawn by the owner, 2026-10-27 —
   see the last section: the grab is fixed at the moment the panel is
   taken.)* The drag's offset from the pointer to the
   panel is re-based whenever the panel is stopped short of where the
   pointer asked (blocked at the window edge, or by a chain against it). So
   when the pointer reverses, the panel follows at once, from where it is,
   and the pointer never has to travel back to the original grab point. The
   tray already re-bases when it turns (`turned`); this is the same idea,
   applied every move.

## Design

- **One resolver, pure, in `panels.ts`:** `pushed(id, want, layout, area,
  minSizes, motion)` — the panel `id` wants rectangle `want`; `motion` is the
  pointer's movement since the last event. It returns the new layout for
  every panel and where `id` actually ended up. Overlap with another panel is
  resolved by moving *that* panel along the **dominant axis of `motion`**
  (the axis with the larger component; ties go to x) by exactly the amount
  that separates them, then resolving what it now overlaps, breadth first,
  never revisiting a panel. *(As built: each axis of `motion` in turn, the
  larger first — a tray resting on the log dragged right with a pixel of
  downward drift would otherwise throw the log sideways by the tray's width;
  face-on the two agree. A panel is revisited when a longer push reaches it
  later, or two are left overlapping. What pushes is the mover's swept
  rectangle, so a fast flick cannot pass through a narrow panel.)* If any
  panel in the chain would leave the area
  (`constrain` with no give), the push fails and `id` is placed as far along
  `motion` as it can go with the chain still inside — found by the largest
  travel that resolves (a short binary search over the travel is fine; say
  so in the comment), so the dragged panel stops flush, not short. *(As
  built: exact, not searched — the overshoot grows one for one with the
  travel, so the travel pulled back by it is the largest that fits.)* "Just
  push": no velocities, no bounce, no sliding round corners — a panel pushed
  along x never moves in y.
- **Drag** calls `pushed` on every move with the panel's wanted rectangle
  from the pointer and the re-based offset; **after each move, offset :=
  pointer − where the panel ended up** (the slip; *withdrawn 2026-10-27,
  last section*). **Resize** by the grip
  calls `pushed` with the grown rectangle and a motion equal to the grip's
  movement, so growing into a neighbour pushes it, and stops at the edge.
  **Turning** a tray (`turned`) and a tray growing for a new tool go through
  `pushed` too, with a motion of zero: ties resolve along x, and a panel in
  the way is pushed rather than covered. *(As built: x away from the mover,
  then x the other way, then y the same; if none fits, nothing moves and the
  tray does not turn. The grip slips like the strip — withdrawn with the
  strip's, 2026-10-27.)*
- **Load and window resize** (`apply`): the stored layout is placed in panel
  order and each panel is `pushed` into a non-overlapping place with zero
  motion *(as built: `settled` — each panel landing on an earlier one is
  pushed out of that one's way, earlier panels holding their places, so a
  grown toolbar is not knocked off the left edge by the log; a window too
  small to hold them all side by side leaves the last one over its
  neighbour, nothing shrunk to make room)*, so a layout from before this rule, or a window shrunk until the
  defaults would overlap, comes up overlap-free. The invariant "no two
  panels overlap" holds after every `apply`, and a debug assertion in
  `place` checks it in tests.
- **Stored state:** a pushed panel has been arranged, so it is stored at its
  pushed position like one the viewer dragged. The storage key stays `v2`
  (nothing about the stored shape changes).
- **Snap-turning stays as built** (6 px, `orientationFor`): with panels
  touching flush after a push, "beside" is exactly contact, and the tray
  turns against a panel's edge the moment it is pushed up to it.

## Verification

Unit: pushing one panel along x and along y; a chain of two; a chain
blocked at the window edge stops the mover flush (to the pixel) and leaves
the chain unmoved; diagonal motion pushes along the dominant axis only; a
pushed panel stays after the mover retreats; resize pushes and stops; turning
into a neighbour pushes it; load de-overlaps an overlapping stored layout;
2 000 random drags over three panels never produce an overlap or a pixel
outside the area; the slip — after a blocked move the returned offset equals
pointer minus the panel's actual position, so one reversed move moves the
panel. E2e (`panels.e2e.ts`): drag the tray into the log and watch the log
move; keep pushing until the log reaches the bottom edge *(as built: the
command line sits under the log in the default layout, so the log pushes it
and the chain reaches the bottom edge through it)* and assert the tray
stops flush against the log; move the pointer back one step and assert the
tray moved immediately by that step (the slip, measured); drag the log into
the command line and both move; resize the log into the command line;
reload keeps the pushed positions; `layout("reset")` restores; after a
scripted sequence of random drags no two panel rectangles overlap. LOOK at
the screenshots. Full `npm run test:all`. Docs per `CLAUDE.md`: CHANGELOG
at the top quoting the owner; the register's panels entry (the "overlaps
it" caveat replaced by the two rules, with his words); STATUS;
`docs/plans/panels.md` caveats; this file marked built.

## Delivery

Isolated worktree, branch `claude/panels-push` off the working-branch tip,
one PR against `claude/resume-tasks-o7q02e`. Do not merge; the supervising
session reviews.

## Reversed by the owner (2026-10-27): the grasp point stays the same

**Status: built** (2026-10-27) — one PR against `claude/resume-tasks-o7q02e`
(branch `claude/grab-stays`); every deviation is in `TODO.md`'s Done entry
and marked *(as built)* below.

> *actually the grasp point should stay the same*

Rule 2 above is withdrawn. **The grab is fixed at the moment the panel is
taken**: the offset from the pointer to the panel never re-bases. A panel
stopped short (at the window edge, or by a chain against it) stays where it
stopped while the pointer goes on; it moves again only when the pointer
comes back past the point where it left the panel behind, and then the
panel is once more exactly under the hand where it was grabbed. The grip is
the same: a resize stopped short resumes only when the pointer returns. The
one place the grab must change is a tray **turning** under the hand (it is a
new shape): the hand keeps the *same point of the panel* as nearly as the
new shape allows — the same fraction along the strip — not a fresh offset.
Rule 1 (push, never overlap) stands unchanged. *(As built: `regrasped` keeps
the fraction along the strip and the depth into it. Where the turn puts the
tray is still `turned`'s, the edge it met held, so a tray turned against a
bottom or right edge lies there away from the hand until the next move. A
turn that, under the hand, would turn straight back is refused — with the grab
fixed, a row held high on its strip just under the top, eased onto the right
edge, otherwise flipped on every move. And a move that ends short of the hand
with nothing stopping it asks `pushed` again, up to three rounds: `pushed`
takes the larger axis first, so a panel slid clear of what stopped it along
the other axis had not yet tried again. And the DOM half hands `dragStep`
the pointer in the canvas area's coordinates rather than the window's — a
grab held for the whole gesture has to be a point of the panel, and in window
coordinates it carried the header's height.)*

Verification: the unit slip test inverts — stopped short by `d`, a move back
of less than `d` moves nothing, a move back of `d` puts the panel under the
hand where it was grabbed; the random walk asserts the panel is always under
its grab point whenever it is not blocked; the e2e measures the same in the
browser (step back short: no move; step back past: the tray follows). Docs:
every "slips" sentence in the register, STATUS, ARCHITECTURE, `panels.ts`'s
header and this file's title replaced by the fixed-grab rule in the owner's
words; CHANGELOG at the top.
