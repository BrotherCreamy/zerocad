# Plan: a conflict is a conflict even when the solver can satisfy it by collapsing something

**Status: built** (2026-11-07), branch `claude/conflict-detection`, PR against
`claude/resume-tasks-o7q02e`. The deviations are under "As built" at the
bottom.

The owner: *"Just noticed I'm able to add a
parallel relation to a set of perpendicular relation lines. This is a bug.
Solver needs to see this kind of thing. For any feature combination and
relation type, and should be able to catch that for any chain of conflicting
relationships."*

## What is true today (measured)

A rectangle drawn as four points and four lines, with `perp("l1","l2")`,
`perp("l2","l3")` and `perp("l3","l4")`. Then `par("l1","l2")`:

| | solved | max residual | lengths l1, l2, l3, l4 | diagnose |
|---|---|---|---|---|
| 2D | **true** | 5e-12 | 5.99, **0.0000**, 5.99, **0.008** | dof 5, r4 "redundant" |
| 3D | **true** | 6e-11 | 5.99, **0.0000**, 5.99, **0.010** | dof 5 |

The solver satisfies every relation by shrinking l2 to a point: a line of zero
length is parallel and perpendicular to everything. The verdict says SOLVED.
In 2D the new relation is even called *redundant* (orange), because at the
collapsed state its row depends on the others.

Today a conflict is reported only when the solve **fails** (`Model.conflicting`
names the relations whose blocks stayed large). Anything a collapse can
satisfy slips through. That covers every inconsistent set of direction
relations (`par`, `perp`, `ang`, tangency, `sym`'s direction rows, a loop of
perpendiculars), and some size relations (a line tangent to a circle and
through its centre: radius 0).

Read `CLAUDE.md`, `docs/ARCHITECTURE.md` (the solver, diagnosis, the
relation/operation split), `constraint-deletion.md`, `src/model.ts`
(`diagnose`, `conflicting`, `solve`), `src/kernel/problem.ts` (`solve`,
`analyse`), `kernel-rs/src/analysis.rs`, `src/relations/`, `src/modules.ts`
(`EntityKindSpec`), `src/main.ts`'s solve and verdict path (`showDiagnosis`,
`conflicted`, the CONFLICT status), and the diagnosis tests.

## Design

1. **A solve that collapses geometry is not a solution.** Each entity kind
   declares its **non-degeneracy measures** through `EntityKindSpec`, not a
   table in `model.ts`:
   - a line's length;
   - a circle's and an arc's radius;
   - an ellipse's two axes;
   - a spline's spacing between consecutive through-points;
   - a frame's axes (if a frame can degenerate).

   A measure that was above `ε·L` before a solve and below it after is a
   **collapse**. L is the drawing's size, not a fixed millimetre count; choose
   ε by measurement and say why. A measure that was already ~0 before (a point
   on top of another as a user drew it), or that the user's own relation sets
   to zero (`dist(p, q, 0)`, `coin` of a line's ends), is not a collapse.
   Dimension-generic, proved in 2D and 3D.
2. **A collapse is a CONFLICT, and the geometry is not left collapsed.**
   - The solve's result is rolled back to the state before it, so the drawing
     does not visibly fold.
   - The new relation **stays**, as Onshape keeps a conflicting constraint, so
     the person can see it and delete it.
   - The verdict reads CONFLICT. The relations in the conflict are drawn in
     the conflict ink, and the log names them, as a failed solve's do today.
3. **Name the conflict minimally, for any chain**: an irreducible
   conflicting set (deletion filter / QuickXplain over the relations in the
   affected connected component). A relation belongs if the set without it
   solves with no collapse. Do this for collapse conflicts **and** for today's
   failed-solve conflicts, which currently name every block that stayed
   large. Examples it must name exactly:
   - `par(l1,l2)` + `perp(l1,l2)`: both.
   - `par(l1,l2)`, `par(l2,l3)`, `perp(l1,l3)`: all three.
   - A triangle with three `perp`s: all three.
   - `ang(l1,l2,30°)` + `par(l1,l2)`: both.
   - A tangent line through the circle's centre: the tangent and the
     incidence.
   - A conflicting chain that runs through an extrude's twins: a relation on
     the lid against one on the base.
4. **When it runs.**
   - After a structural change: a relation added, set or deleted, an
     operation, or a file opened.
   - At a drag's end, not on every drag frame. A drag that would collapse
     something stops at the last state with no collapse, or is refused at the
     end; choose, measure and say which.
   - Measure the cost on the largest fixture drawings and report it. The
     deletion filter is many solves, so bound it, and keep the verdict
     responsive.
5. **Redundant stays what it is**: consistent, and saying nothing new. A
   relation is only called redundant at a state with no collapse.
6. **Prevention is not in scope.** Changing the residuals of `par`, `perp`
   and the rest, for instance normalised so collapse no longer satisfies them,
   would alter every drawing's solving. Write it down as considered; build
   detection.

## Tests

**Unit** (2D and 3D each):
- Every example in Design 3, named exactly.
- The rectangle above: CONFLICT, the geometry unchanged from before the
  `par`, and `par` kept.
- A user's own `dist(p,q,0)`: not a collapse.
- A point drawn on another: not a collapse.
- Deleting the conflicting relation: SOLVED again, with no glyph left red.
- A relation added to a drawing that already holds a conflict.
- Undo after a conflict.
- Save/open of a drawing with a conflict in it: still CONFLICT on open.
- The cost, on a large fixture.

**E2E** (mouse and iPhone 13):
- Draw a rectangle, let inference add its relations, then add `par` between
  two adjacent sides with the constrain tool.
- Assert: CONFLICT, both relations red, the rectangle not folded, Delete on
  one of them clears it.
- LOOK at the picture.

## Docs

- CHANGELOG at the top, quoting the owner.
- ARCHITECTURE: diagnosis, and what a conflict is now.
- The register entries, vetoable: ε, rollback, the minimal set, when it runs.
- STATUS.
- `help()` where it explains CONFLICT.
- The spec marked built, with its deviations.

## As built

Built as designed, with these deviations, each decided while building and
each tested:

1. **A threshold alone cannot tell a collapse from a small size.** A collapse
   a residual meets quadratically (a closed triangle's second right angle)
   stalls at ~4e-5·L, the size of a real detail. So a measure that fell past
   `SUSPECT` = 1e-2·L (and to a tenth of what it was) is **pushed**: pulled
   toward zero, then released. A collapse stays; a size a relation set comes
   back, and the solve's own state is restored. ε = 1e-6 is then measured
   across the whole unit suite: collapses end at ≤ 4.6e-10·L, real sizes
   that halved stay ≥ 2e-4·L.
2. **A collapse is retried steered before it is believed**, in the user's
   solve and in every trial of the search: each size is pulled toward what
   it was, then released. Without it the search named `{par, perp(l2,l3)}`
   on the owner's rectangle, which a turned side satisfies. With it, a
   consistent set the bare solver folds (3D, `par(l1,l2)` with
   `perp(l2,l3)`) now solves unfolded: the user's drawing folds less, not
   only reports more.
3. **The user's own zero is one relation**: a measure is exempt if one
   relation alone, tried from the state before, collapses it too. No list of
   which relation may zero what. Consequences, pinned by tests and in TODO:
   two `coin`s through a third point on a line's ends are a conflict, and
   `perp("l1", "l1")` folds l1 and reads as meant.
4. **Measures for the built-in kinds are answered in `model.ts` by name**,
   as their refs and variables already are (`refsOf`, `ownVars`). Line,
   circle, arc and frame have no `EntityKindSpec` to declare through. Every
   declared kind does declare its own (`measures` on the ellipse and the
   spline), as the design asks. A measure is a function of variables (Duals),
   so it can be read at the state before a solve and pulled on.
5. **"A triangle with three perps: all three"** cannot be built as written.
   A closed triangle already conflicts at its second right angle, and that
   test names those two. The plan's "all three" is three lines with no
   corners, each square to the next. In 3D it also names the six `onPlane`
   holds: three directions can be square to each other in space, and it is
   the holds that make it a conflict.
6. **The rectangle holds two irreducible conflicts**: `{par, perp(l1,l2)}`
   and `{par, perp(l2,l3), perp(l3,l4)}`. The one named is the one on the
   folded side, because candidates are ordered nearest what failed
   (relations naming the folded entity, then `Problem.reach`). Delete that
   perp and the other is named next.
7. **Rollback is per connected component**, not of the whole drawing, so an
   edit elsewhere lands while a conflict stands. A feature's own relations
   (an extrude's depth) are never named: they are background in every trial,
   since they cannot be deleted alone.
8. **The drag stops at the last state with no collapse**, frame by frame,
   with a cheaper check (no push, no search). A drawing holding a conflict
   does not move in that part until it is deleted.
9. **The search rings outward**: candidates within reach −1, 0, 1, 2, 4, … of
   what failed are tried in turn, and the first ring that conflicts by itself
   is searched. On forty chained rectangles this took the search from 300 to
   ~130 ms.
10. **Two bugs the browser found** (ARCHITECTURE's 49 and 50). A conflict's
    name clicked in the status while a tool was armed: Delete did nothing.
    And a drawing restored by autosave never solved at start, so a conflict
    opened reading "ready".

**Cost** (the CHANGELOG entry has every number): the check on a solve that
folds nothing is within noise; with a conflict made in the largest fixtures,
solve 12–33 ms and search 7–72 ms; on forty chained rectangles (280
relations) solve ~130 ms and search ~145 ms, bounded at 200 trials and 500 ms.
