# Plan: snap to intersections

**Status: shipped, pending review** (PR against `claude/resume-tasks-o7q02e`).
Built as specced. Two deviations worth knowing, both recorded in `TODO.md` and
`CONVERSATION_LOG.md`: the algebra is in **screen space** rather than world
space, so that picking's arc-sweep test could be shared literally rather than
re-derived in the opposite angular convention (it moved down into the new
`src/intersect.ts`, which `picking.ts` now imports); and degeneracy is judged
on the **pixel separation of the two candidate roots** rather than on a zero
discriminant, because a tangency the solver actually holds leaves those roots
about a thousandth of a pixel apart and an exact test would never fire.

The last gap in the snap vocabulary: points, midpoints and
along-a-curve exist; where two curves *cross* does not, and it is the place a
draughtsman most often actually means. Onshape snaps there and infers
coincidence with **both** curves — that pairing is the feature, not the X on
the screen.

Read `CLAUDE.md`, then `docs/ARCHITECTURE.md`. No kernel changes, no model
changes. This package touches `snapping.ts`, `place.ts`, the marker rendering,
and tests.

## Design

### The tier

Intersections slot **between** exact points and midpoints: an existing point
still wins (it is the thing itself), an intersection beats a derived midpoint
and beats either curve alone. Tolerance 8px, screen space, like everything.

### Finding them without pretending to be a CAS

Candidates are computed per cursor move, so the cost discipline matters more
than generality:

1. Prefilter: curves whose screen distance to the cursor is within the
   tolerance (the tier-3 logic already computes exactly this distance —
   reuse it, do not re-derive it).
2. Intersect the survivors pairwise — with a cursor on a crossing that is
   two or three curves, not n².
3. Line–line, line–circle, circle–circle, in closed form; segments within
   their extent, arcs within their sweep (the picking code has the sweep
   test — share it, one definition of "on the arc").
4. Nearest resulting crossing within tolerance wins the tier.

Parallel lines, tangent circles (single-root), and coincident curves produce
zero or degenerate candidates — return nothing rather than something clever.
A tangency is already *its own* relation; snapping should not manufacture a
phantom crossing out of one.

### The snap itself

`Snap` gains kind `"intersection"` carrying **both** curve names. The clean
shape is `targets: string[]` — and the existing kinds keep their single
`target` meaning through whatever compatibility shim costs least; follow the
types and keep `describeSnap` honest (`l1 × c2`). Marker: an ×, same family
as the square/triangle/circle.

### Inference is the point

`placePoint` on an intersection snap applies the on-curve relation for
**each** target — `pointOnLine` / `onCircle` twice over. That is what makes
the snapped point *stay* the crossing: drag either curve afterwards and the
point rides the intersection. Without this the snap is a one-frame courtesy;
with it, it is a constraint the user meant. (Two relations, two registry
entries, two glyphs — all of that machinery now exists and should just work;
the e2e must confirm it does, not assume.)

## Verification

The e2e that defines done: a line crossing a circle; arm the point tool; click
a few pixels off their crossing → the point lands on the *exact* crossing
(closed-form comparison, not tolerance-of-the-click), with both on-curve
relations inferred and named in the registry; drag the line — the point
follows the crossing; Ctrl+Z twice unwinds cleanly. Plus: an existing point
near a crossing still wins the snap; parallel lines produce no intersection
snap; an arc's crossing only exists within its sweep; `snapping(false)` kills
it like everything else; glyphs appear for the inferred pair.

Unit tests for the three closed forms including the degenerate cases, and the
tier ordering. Full `npm run test:all` per commit. Screenshots (20+) carrying
their own evidence — the × marker on a crossing mid-gesture, and an
after-drag frame proving the point rode the intersection. Docs duties per
`CLAUDE.md`; plan marked shipped-pending-review.

## Delivery

PR workflow: isolated worktree, branch `claude/intersection-snap` off the tip
of `claude/resume-tasks-o7q02e`, PR against the working branch, two commits
((1) intersection math + snapping tier + units; (2) inference + marker + e2e
+ docs). Do not merge; the supervising session reviews.
