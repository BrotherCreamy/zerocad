# Plan: a direction relation never shrinks a line, and a conflict names what made it

**Status: built** (2026-11-12), branch `claude/review-solver`, PR against
`claude/resume-tasks-o7q02e`. The design below is as it was queued; four
parts of it did not survive measuring, and *As built* at the end says which,
with every measurement the spec asks for. Review items 1 and 3 of TODO.md's register
(*Reviewed against the owner's principle*, 2026-11-09; CONVERSATION_LOG has
the reasoning). The owner, asked whether to queue them: *"All good."* And,
12 November: *"I should be able to pull on anything."*

Read `CLAUDE.md`, `docs/ARCHITECTURE.md` (the solver, diagnosis, conflicts),
`docs/plans/conflict-detection.md` (#81, as built), `profiles-held.md`
(why `perp(chord, e1)`'s rows are in lengths: a cosine row left corners
~1e-9 off on a 40-long edge), `constraints-palette.md` (the agreeing set),
`src/relations/*.ts`, `src/model.ts` (conflict search, `searchMs`),
`src/constraints.ts`, `test/conflicts.test.ts`.

## 1. Direction residuals are normalised

**True today**: `par`, `perp`, `tan` (and check `col`, `ang`, `sym`, `eq`
and every row built from `dot()`/`wedge()` of two line vectors) are products
of un-normalised directions, so shortening either line lowers the residual:
the solve pays for a `par` partly in length. Measured building the palette:
`par` typed between two free 60-long lines left them 8.8 and 1.2 long,
SOLVED (docs/images/422). The collapse check (#81) catches zero, not a
shrink.

**Design**: every direction row is written so its gradient along each
line's own direction is zero — the row turns lines, it never scales them.
Divide by the lengths (guarded: below the collapse threshold the row falls
back to the un-normalised form so the Jacobian stays finite, and the
collapse check remains the backstop), and multiply by one length that is
**not a variable of the row** (the model's length scale) so the row stays in
length units and keeps the accuracy `perp(chord, e1)`'s note records. No row
may be a square. Exact Jacobians through the existing dual numbers; nothing
in `src/kernel/` learns what a line is.

**Measure, before and after, in the spec's As built**: the two-free-lines
case (lengths kept to 1e-6 relative); a drag of one end of a `par` pair; the
rectangle and the prism (corners to 1e-9 at 40 long); iterations and wall
time on the repo's existing solver fixtures (no fixture more than 10% slower
without a written reason); every old-file fixture reopening to the same
shape within its test's tolerance.

## 3. A conflict names the relation whose addition made it

**True today**: QuickXplain names a minimal set and the interface says two
of it clash ("two of a set"), red.

**Design**: the model was consistent before the edit that broke it, so that
edit is the culprit, and the search is for *what it disagrees with*:
- a relation just added: named first, then the minimal set it cannot hold
  with: `CONFLICT r7 par l1 l2 — against r1, r2`;
- a dimension just `set`: that dimension, against its set;
- a drag: no conflict is declared by a drag (it stops, as today);
- a file opened in conflict, or an edit that is not one relation: the
  minimal set as today, none singled out.
The culprit is drawn in the conflict ink, the set it disagrees with in a
second, quieter ink (choose it, LOOK at it on the dark and light grounds,
say which in the register). The constraints palette shows both under one
heading with the culprit first and a delete on each. The search stays
bounded by `SEARCH_TRIALS` and `Model.searchMs`; past the bound the culprit
is still named (it is known without a search) and the set is "not found in
time". Feature-made relations may now be in the set (they are relations
like any other; item 4 is being built beside this) — if they are still
background when you build, say so and leave a test that will fail when that
changes.

## Tests

- Unit, 2D and 3D: every normalised row's gradient along its lines is zero
  (finite-difference check against the dual numbers); the measurements
  above as assertions; a conflict by addition names the added relation and
  its set; by `set`; an opened file; past the budget.
- E2E, mouse and iPhone 13: `par` on two free lines, lengths unchanged, LOOK;
  the owner's first bug again (parallel on two adjacent sides of a
  perp-held rectangle): the status and the palette name the parallel as the
  one that made it, the two perps as what it disagrees with. LOOK.

## Docs

CHANGELOG top; STATUS; ARCHITECTURE; the register (items 1 and 3 ticked,
each decision one line with its reason); the spec marked built with the
measurements.

## As built (2026-11-12)

Every number below is from `test/solver.measure.ts`, run on the commit
before the rows changed and on the final code. The same numbers are
assertions in `test/directionrows.test.ts`. Times were taken with three
other packages building on the same four cores (a load average of thirty):
each is the **best of three runs** of the script on the final code (and of
six on the commit before, three taken at the start and three beside the
final ones), and none is better than a factor of two from a quiet
machine's. Iterations and non-zeros do not depend on the load.

### 1. The rows — where the design changed

1. **An angle, not a sine or a cosine divided by the lengths.** L·sin θ has
   no gradient at 90°, so `par` on two lines exactly square (a rectangle's
   adjacent sides) did not move and read CONFLICT. The raw row hid this: at
   90° its whole gradient runs along the lines, so its only way down was
   shorter — the owner's first bug. The rows are the turn itself
   (`turnToParallel`, `turnToSquare`, `angleBetween`, vec.ts).
2. **Times the longer of the row's own lines as the solve began**, never
   under one unit — not the model's length scale. On forty rectangles two
   thousand across, the model's scale made a direction row fifty times a
   `dist` row and the solve went from 8 iterations to 23. The row's own
   line, read from the snapshot `Model.solve` takes on beginning
   (`Model.valueBefore`), is still no variable of the row, and is exactly
   the size the row it replaces had.
3. **The fallback floor is a thousandth of the drawing's size**, not the
   collapse threshold: a unit direction is one over the length stiff, and a
   triangle given two right angles crept toward its only answer (a side of
   no length) for sixty iterations, reached 2e-6·L and was called solved.
4. **Zero gradient along the line is necessary and not enough.** With every
   row's gradient along its lines exactly zero and nothing else, `perp`
   between the two free lines left them 169 long (third column below): the
   kernel's step moves each end along a straight line, damped per
   coordinate, and that stretches what it turns. So a block says which
   lines it reads for direction only (`addResidual`'s `turns`), and
   `Model.solve` solves on with their lengths pulled back and then released
   wherever a solve changed one (`keptSizes`).

Rows normalised: `par`, `perp`, `ang`, `col` (now a direction row and the
second line's middle on the first), `on`, `sym` (points, lines, an arc's
ends and centres), `tan` at a shared end (line–arc and arc–arc), `ang3`,
`corner` (review-relations' angle between two walls' lines; see *With
review-relations merged* below), and `perp(chord, e1)`'s edges (kept as a
cosine). `dist` to a line and `tan`
to a circle or an ellipse were normalised already and now say which line
they turn. `eq` and `sym`'s length row are about lengths and are as they
were. Nothing in `src/kernel/` learned what a line is: it gained
`solve({ stall })`, `unmet(tol)` and `handles()`.

Two things followed that the spec did not ask for, each forced by the rows:

- **A solve that fails is put back, as a collapse is.** A `par` and a `perp`
  on one pair of lines no longer fold a side; they have no answer, and least
  squares ends with the rectangle sheared 45°. The part goes back to where
  it was, after one more solve from where it stopped; the part is left out
  of the drag frames that follow; and a relation that does not hold is never
  called redundant (the two are one row to first order now).
- **`perp("l1", "l1")` is a conflict of one.** It solved, the line at nothing.

### The two free lines (60.133 and 60.828 long; `docs/images/422`'s drawing)

One relation added, then `Model.solve`. The lines it reads for their
direction, before the solve → after. 2D and 3D give the same figures to the
digits shown but for `col` before (3D: 22.521 and 38.107).

| relation | before the change | the rows normalised and nothing else | as built | as built: worst change, of the length |
|---|---|---|---|---|
| `par(l1, l2)` | 8.763, 1.183 | 61.043, 62.390 | 60.133, 60.828 | 9.0e-11 |
| `perp(l1, l2)` | 56.237, 87.093 | 169.231, 168.843 | 60.133, 60.828 | 1.4e-9 |
| `ang(l1, l2, 60°)` | 61.459, 67.332 | 62.601, 63.201 | 60.133, 60.828 | 1.1e-9 |
| `col(l1, l2)` | 17.470, 2.865 | 61.072, 62.747 | 60.133, 60.828 | 1.0e-10 |
| `on(p3, l1)` — l1 | 21.180 | 62.051 | 60.133 | 3.5e-11 |
| `sym(p3, p4, l1)` — l1 | 37.461 | 62.937 | 60.133 | 7.2e-11 |
| `par(l1, origin.x)` — l1 | 60.000 | 60.569 | 60.133 | 2.7e-9 |

All solved, before and after. The spec asks 1e-6 of the length; the worst is
2.7e-9. (The middle column is an intermediate build — unit sine and cosine,
scaled by the drawing's size, no `keptSizes` — kept because it is the
measurement that showed the rows alone are not the fix.) Iterations: 9, 9,
7, 6, 6, 5, 3 before; 10 or 11 for each as built, the plain solve's and the
steer's together.

### A drag of one end of a par pair

Two parallel 60.133-long lines; one end of l1 pulled 20 across it in twelve
frames (`Model.solveFrame`), then released.

| | before | as built |
|---|---|---|
| l1, the one dragged | 60.133 → 85.301 | 60.133 → 64.461 |
| l2, not touched | 60.133 → **32.105** (47% shorter) | 60.133 → **58.280** (3.1% shorter) |
| still parallel (sine) | 8e-17 | 2e-13 |

Not 1e-6, and not steered: a pull on a size in a frame would move a free
rectangle whole under a dragged corner instead of resizing it. What is left
is the kernel's step (TODO.md has it, with what would fix it).

### The rectangle and the prism (40 × 30; four perps, in 3D the flat)

A corner moved by [3, 4] (in 3D [3, 4, 7]) and solved; then the rectangle
extruded 10, a lid corner dragged [12, −6, −8] and a base corner [3, −2, 9].
Every figure is a length: how far the worst corner's far end is off square
(|cos| × the longer side), and for the prism the four ways it can fail.

| | before | as built | asked |
|---|---|---|---|
| rectangle 2D, corners off square | 1.2e-12 | 2.6e-10 | 1e-9 |
| rectangle 3D, corners off square | 8.7e-15 | 2.9e-10 | 1e-9 |
| prism: base off flat | 1.0e-11 | 4.4e-12 | 1e-9 |
| prism: walls off square | 3.2e-11 | 3.8e-12 | 1e-9 |
| prism: walls off the depth | 4.1e-11 | 3.2e-11 | 1e-9 |
| prism: lid off the base translated | 3.2e-11 | 6.8e-12 | 1e-9 |
| prism: corners off square | 9.5e-15 | 2.8e-12 | 1e-9 |
| rectangle iterations, 2D / 3D | 4 / 7 | 9 / 11 | |

The rectangle's corners are less exact than they were by two orders and
inside what is asked by half of one: the raw `perp` row was |u||v|·cos, a
thirty times larger at 40 × 30 than a row scaled by one side, so the same
tolerance on the row was a tighter one on the angle.

### The solver fixtures: iterations and time

Each fixture opened and solved as filed; then every point moved a
deterministic 1% of the drawing's size and solved again, by the kernel alone
(`problem.solve()`: what the rows cost) and by `Model.solve()` (with the
collapse check, and now the steer). Milliseconds, best of three, under load.

| fixture | opened: iterations | opened: ms | opened: moved from the file | jiggled, kernel: iterations | ms | jiggled, model: iterations | ms |
|---|---|---|---|---|---|---|---|
| bracket.zerocad, before | 0 | 0.06 | 0 | 5 | 0.47 | 5 | 0.52 |
| bracket.zerocad, as built | 0 | 0.09 | 0 | 5 | 0.87 | 10 | 2.61 |
| curves-v12, before | 0 | 0.09 | 0 | 5 | 2.80 | 5 | 2.30 |
| curves-v12, as built | 0 | 0.10 | 0 | 5 | 2.42 | 5 | 2.74 |
| features-v12, before | 0 | 0.65 | 0 | 11 | 59.36 | 11 | 52.02 |
| features-v12, as built | 0 | 0.75 | 0 | 12 | 71.21 | 24 | 121.58 |
| flat2d-v12 (no relations) | 0 | 0.00 | 0 | 0 | 0.00 | 0 | 0.00 |
| pre-explicit-regions, before | 8 | 32.74 | 1.8e-3 | 9 | 74.02 | 9 | 71.60 |
| pre-explicit-regions, as built | 5 | 36.11 | 1.8e-3 | 10 | 91.53 | 17 | 184.26 |
| shapes-v15, before | 0 | 0.53 | 0 | 6 | 15.27 | 6 | 14.98 |
| shapes-v15, as built | 0 | 0.59 | 0 | 5 | 12.57 | 14 | 30.46 |
| forty rectangles (280 relations; jiggled ±0.5), before | 0 | 1.19 | 0 | 8 | 126.21 | 8 | 155.72 |
| forty rectangles, as built | 0 | 1.99 | 0 | 8 | 295.30 | 22 | 960.45 |

**More than 10% slower, and why.** Three things, each of them the change
itself rather than an accident of it:

- **The kernel's solve of a par-heavy drawing, 1.5× to 2.3× at the same
  iterations.** Forty rectangles: 8 iterations and 17 evaluations before and
  after, and a Jacobian of **2629 non-zeros where it had 1353**. A unit
  direction depends on every coordinate of both ends, so `par(l,
  "origin.x")` in 3D has 6 non-zeros a row where the raw wedge against a
  constant axis had 2, and the kernel's conjugate-gradient step pays by the
  non-zero. The table's row says 2.3× (126 → 295 ms); measured apart from
  it, twelve solves a run and the least of six runs each, 135 ms
  before and 209 ms as built, 1.5×. The load does not let the two
  be told apart; the second has four times the samples. The rows' own
  evaluation went from 0.94 ms to 2.03 ms a pass, seventeen passes a solve.
  `features-v12`, `pre-explicit-regions` and `bracket` are slower by the
  kernel alone for the same reason (1.2×, 1.2×, 1.9× of half a
  millisecond); `curves-v12` and `shapes-v15` are not.
- **`Model.solve` of a drawing every size of which is wrong, 2× to 6×.** The
  jiggle moves every point, so every line's length is off before the solve
  begins, and `keptSizes` then solves on to bring back lengths that were
  never right (forty rectangles: 22 iterations for 8, and 960 ms for 156;
  `features-v12` 24 for 11, `shapes-v15` 14 for 6). It is the measure's
  worst case, not a drawing's: an edit changes a few sizes, and the steer
  is of that part only. Opened as filed, where nothing moves, no fixture
  takes an iteration more than it did.
- **A solve at rest costs a scan it did not**: each turned line whose points
  moved is measured, and each relation is marked as having held. Forty
  rectangles at rest: 1.19 ms before, 1.99 ms as built, zero
  iterations both.

**A solve that fails** is no slower than it was. Forty rectangles with a
`par` across one corner (the least of nine solves before and nine as built,
the same load): the solve 874 ms before and 780 ms as built, both refused;
the search for what it disagrees with 507 ms before — its bound, and it
named eight relations, the culprit seventh — and 197 ms as built, naming
the `par` against three. Once in nine the search ran out its 500 ms and said
*against a set not found in time*; the culprit was named all the same. The
conflict over a solid's lid of picture 466: solve 777 ms, search 169 ms.

`pre-explicit-regions` opens in 5 iterations where it took 8: it is older
than the extrude's own perpendicular and regenerates under it on opening.

### Old files

The residual's form is not journalled and no format changed. Every fixture
opens and solves moving nothing (to 1e-9) but `pre-explicit-regions`, which
moves 1.8e-3 as it regenerates — the same figure before and after
(`test/directionrows.test.ts`, the last test). `oldfiles13.test.ts`,
`onetool.test.ts` and every other fixture-reading test pass unchanged.

### 3. The conflict — as built

- **The culprit is known, not found**: `Model` remembers each relation as it
  stood the last time a solve solved its part (`settled`), and the one
  relation of a failed part that has not held is it — just added, or its
  value just `set`. So it is named past the search's bound, after an edit
  elsewhere, and after what it was against is deleted (it is then found
  against something else).
- **The set**: QuickXplain over the rest with the culprit in every trial,
  nearest first, one relation tried alone before any larger set.
- **None singled out**: a file opened in conflict, an edit of more than one
  relation. An undo and a redo hand on what had held (`inheritHeld`).
- **A drag**: declares nothing; the part holding a conflict stays put.
- **Said**: `r7 par l1 l2 — against r1, r2` in the status; the log in
  words; the culprit's glyph filled with the conflict's ink (#e0605c), what
  it is against outlined in a quieter one (#b98a86), a set with none singled
  out outlined in the conflict's ink as before; the palette's `conflict`
  heading first, the culprit first, × on each.
- **Where the spec's e2e says "the two perps"**: on the rectangle tool's
  four-perp rectangle the least set a corner's `par` cannot hold with is
  that corner's one perp, and that is what is named; delete it and the two
  far perps are (picture 468).
- **Feature-made relations are still background** to the search:
  `test/culprit.test.ts` has the test written to fail when that changes.
- **Bug 74**: a conflict on a solid's edges drew nothing red, the glyphs
  being quiet with their anchors. A relation in a conflict is always drawn.

### With review-relations merged (one relation among many; `corner`)

review-relations (#91) went into the working branch first, so this branch
merged it and was measured again on the result. "Before" in this section is
that branch alone, which has the raw rows; the drawing is four free lines,
none parallel to another, in 3D no three of their ends in a plane
(`test/solver.measure.ts`, the two sections after the par pair's drag).

| relation | before | as built | as built: worst change, of the length |
|---|---|---|---|
| `par(l1, l2, l3, l4)`, one relation, 2D | 60.133, 60.828, 55.317, 56.921 → 40.914, 30.846, 89.496, 122.998 | each as it was | 1.8e-9 |
| the same, 3D | 60.663, 61.490, 56.214, 58.864 → 33.926, 41.947, 15.698, 99.296 | each as it was | 2.2e-10 |
| `col(l1, l2, l3, l4)`, one relation, 2D | → 24.593, 23.456, 72.675, 99.472 | each as it was | 2.2e-9 |
| the same, 3D | → 3.240, 43.508, 21.097, 92.748 | each as it was | 2.7e-10 |
| `corner(l1, l2, 60°)`, 2D | 60.133, 60.828 → 61.459, 67.332 | each as it was | 1.1e-9 |
| the same, 3D | 60.663, 61.490 → 68.597, 89.026 | each as it was | 1.3e-9 |
| a drag of one end of one of four parallel lines: the worst of the three not touched | 54.120 → 28.975 (46% shorter) | 54.120 → 52.373 (3.2% shorter) | |

All solved, before and after; 4 to 7 iterations before, 11 as built.

- **A relation among many needed no edit.** Its rows are the pair's own,
  each member with the first listed, inside one `model.relation`
  (`relations/among.ts`), so they are the normalised rows and each says
  which two lines it turns.
- **`corner` did.** New in review-relations, it was u·w − |u||w| cos θ: the
  shape this spec removes. It is now `ang`'s row on the two rays out of the
  corner, says which lines it turns, and its gradient along either is zero
  (`test/directionrows.test.ts`). The fixture that holds one
  (`review-relations-wedge-v19`) reopens moving nothing.
- **The culprit, with a relation among many.** One relation is one name
  however many row blocks it owns, said with every member: `r5 par l1 l2 m1
  — against r1`. A `join` changes a relation's members, so the relation as
  it now stands has not held: it is the culprit of the conflict a join
  makes, and `leave` clears it (`test/culprit.test.ts`, 2D and 3D; the e2e's
  eighth test).
- **A fault of this package's own, found by the join.** In 3D that failing
  solve folded the far side rather than stopping; the search's first ring is
  then the relations naming what folded, the two far corners' perps; and
  "one relation before any larger set" was asked of that ring alone, so the
  status read `against r8, r7` where the corner's own perp is the one a
  person reads. The single relations are now asked of the nearest dozen of
  all the others, whichever ring first clashed.
- **Its three fixtures** (format 19, saved by the raw rows), opened and
  solved, then jiggled as the table above — iterations before → as built:
  `review-relations-v19` 0 → 0 opened (moved 0), kernel 9 → 7, model 9 → 7;
  `review-relations-drift-v19` 2 → 2 opened (moved 4.3e-5 both: it is filed
  that far off its relations, on purpose), kernel 9 → 6, model 9 → 13;
  `review-relations-wedge-v19` 0 → 0 opened (moved 0), kernel 7 → 5, model
  7 → 13. Times, best of three at the same load, model: 21.8 → 58.3 ms,
  17.0 → 44.5 ms, 1.2 → 3.3 ms — the 2× to 3× of a drawing every length of
  which was moved at once, as above.
- **No format bump**: this package journals nothing new; the file's number
  is review-relations' 20.

### Tests

- `test/directionrows.test.ts` (77): the two free lines under nine
  relations, 2D and 3D; four free lines under one relation among them; the
  drag; where a sine or a cosine is flat; every
  normalised row's gradient along its lines zero and equal to the finite
  differences', 2D and 3D; `perp(chord, e1)`; the rectangle and the prism to
  1e-9; a size no relation asked to change; a line drawn as a point; every
  fixture reopening to its shape.
- `test/culprit.test.ts` (23): by addition, by `set`, an opened file, more
  than one relation, past the budget, undo and redo, a relation among many
  and a join, a feature's relations, the status line and the palette.
- `test/conflicts.test.ts`: what read `collapsed` says which it is now; the
  triangle and the lid against its base still collapse and are still found.
- `test/e2e/reviewsolver.e2e.ts` (10, mouse and iPhone 13) and
  `test/e2e/conflicts.e2e.ts` in the new words.

### Pictures

| | |
|---|---|
| 460 | desktop: Parallel pressed over the two free lines of picture 422 — both still 60 long, parallel, SOLVED |
| 461 | iPhone 13: the same by finger |
| 462 | desktop: the owner's first bug — `r6 par l1 l2 — against r1` in the status, r6 on a red pill; the palette's `conflict` heading with r6 first; the par's two glyphs filled red, the corner perp's two outlined pink |
| 463 | the rectangle's glyphs close, at the size they are drawn |
| 464 | iPhone 13: the same conflict by finger, the palette up at the bottom |
| 465 | iPhone 13: the glyphs close — two filled red, two outlined in the quieter ink, four plain |
| 466 | desktop: the two inks over a solid's lit face (the lightest ground a glyph is drawn on) |
| 467 | iPhone 13: the same |
| 468 | the corner's perp deleted: the par still named, now against the two far perps |
| 469 | reopened by autosave: the set, none singled out, every member outlined red |
