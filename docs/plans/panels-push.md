# Plan: panels push one another, and the grab point slips

**Status: queued** (2026-10-26). The owner's direction, verbatim:

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
   a tray turns or grows, not on load. A dragged panel that meets another
   **pushes it**, and that one pushes whatever it meets, in a chain. Nothing
   springs back: a pushed panel stays where it was pushed. When a push would
   put any panel in the chain outside the area, the chain cannot move, and
   the dragged panel **stops** flush against it — the window edge is the one
   immovable thing.
2. **The grab point slips.** The drag's offset from the pointer to the
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
  never revisiting a panel. If any panel in the chain would leave the area
  (`constrain` with no give), the push fails and `id` is placed as far along
  `motion` as it can go with the chain still inside — found by the largest
  travel that resolves (a short binary search over the travel is fine; say
  so in the comment), so the dragged panel stops flush, not short. "Just
  push": no velocities, no bounce, no sliding round corners — a panel pushed
  along x never moves in y.
- **Drag** calls `pushed` on every move with the panel's wanted rectangle
  from the pointer and the re-based offset; **after each move, offset :=
  pointer − where the panel ended up** (the slip). **Resize** by the grip
  calls `pushed` with the grown rectangle and a motion equal to the grip's
  movement, so growing into a neighbour pushes it, and stops at the edge.
  **Turning** a tray (`turned`) and a tray growing for a new tool go through
  `pushed` too, with a motion of zero: ties resolve along x, and a panel in
  the way is pushed rather than covered.
- **Load and window resize** (`apply`): the stored layout is placed in panel
  order and each panel is `pushed` into a non-overlapping place with zero
  motion, so a layout from before this rule, or a window shrunk until the
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
move; keep pushing until the log reaches the bottom edge and assert the tray
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
