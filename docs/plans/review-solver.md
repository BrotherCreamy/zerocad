# Plan: a direction relation never shrinks a line, and a conflict names what made it

**Status: queued** (2026-11-12). Review items 1 and 3 of TODO.md's register
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
