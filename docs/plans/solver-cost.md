# Plan: the two solver costs the review measured — a size pulled back that nobody could see move, and a drag frame five times dearer

**Status: queued** (2026-11-12). From the register's measurements of the
solver package (TODO.md, *A direction row costs more to solve*, "Measured at
the review"). Two numbers stood out of a table that was otherwise within
1–3× either way, and both are first-order in how the phone will feel.

## What is true today (measured 2026-11-12, load 5–9, best of five, base → merged)

| case | before | after |
|---|---|---|
| one dimension set: forty chained rectangles, **widths free** | 165 ms | **1407 ms** |
| one dimension set: forty chained rectangles, widths dimensioned | 1815 ms | 1121 ms |
| a drag frame: forty rectangles held `par` to the axes and dimensioned | 4.2 ms | **20.6 ms** |
| a drag frame: forty rectangles of four perps chained by `par` | 385 ms | 178 ms |

The scripts that made the table are `test/solver.measure.ts` and two more
in the manager's scratchpad (`bench/drag.ts`, `bench/edit.ts`, run as
`ROOT=<repo> node --experimental-strip-types …`); the worker makes them a
file under `test/` first, so the numbers can be made again.

### The edit: `Model.keptSizes` pulls forty sizes back that drifted by nothing

Every solve keeps the length of every line a direction block reads, unless
a relation changes it (the register: *a straight move that turns a line
stretches it*). `keptSizes` (src/model.ts) measures, after the plain
solve, every such line one of whose points moved; any whose size is off by
more than `KEPT` (1e-9, relative) is *drifted*, and the whole connected
part is then solved again with a pull on **every** held size in it, then
released, then — where the relations changed some anyway — pulled once
more and released, then the whole problem solved once more. For forty
chained rectangles with free widths, setting one dimension moves every
point by a hair (the chain's `dist`s and `par`s carry it along), so forty
sizes "drift" by 1e-7 and the part is the whole drawing: four extra solves
of everything to put back a change no one could see.

### The drag frame: a direction row's non-zeros

`par(l, "origin.x")` in 3D names six variables a row where the old
sine/cosine form named two, and the kernel's CG pays by the non-zero. A
frame of forty such rectangles went 4.2 → 20.6 ms. On the phone, where a
frame has 16 ms, that is the difference between a drag and a stutter.

## Design

1. **A drift that cannot be seen is not a drift.** `keptSizes` takes a size
   as drifted only when it is off by more than what a person can see on
   the drawing: a thousandth of the size *or* a thousandth of the drawing's
   extent (`ctx.L`), whichever is larger — the same floor `CHANGED` already
   uses to decide what the relations changed on purpose. `KEPT` (1e-9) stays
   as the floor for *is this size exactly back*, which is a different
   question. With that, the free-width case makes no pull at all after a
   dimension is set (every drift is ~1e-7), and the dimensioned case pulls
   the one rectangle whose height the dimension would otherwise have
   changed. Measure both, and the whole table, before and after.
2. **Only the part that drifted, not the part that is connected.** Today the
   pull goes on every held size in the connected part of the drifted ones;
   in a chained drawing that is the drawing. Pull only the sizes that
   drifted (by the rule in 1) plus those whose block shares a variable
   with one of them — one ring out, not the whole component — and solve
   `only` those blocks. If the release then leaves something else off,
   the next solve's `keptSizes` sees it; nothing is lost, it is just not
   paid for in advance.
3. **The direction row's cost is the kernel's, and is measured before it is
   touched.** Count, for the par-to-axes frame, the non-zeros per row and
   the CG iterations per LM step before and after the solver package, in
   `test/solver.measure.ts`. Then one of (in this order, stopping at the
   first that gives the frame back under 8 ms on this box): (a) the axis
   case rows against a **constant** direction need only the line's six
   variables, not twelve — make sure `par(line, frame axis)` is not
   building the axis as variables; (b) the direction row's three components
   are two independent rows (a unit vector against a constant has two
   degrees of freedom, not three) — a row that is a linear combination of
   the others costs CG an iteration for nothing; (c) if neither, say so
   with the numbers and file the kernel's CG preconditioner as the next
   item, with the register entry's "1.5× to 2.3×" refined to what was
   measured.
4. **Nothing visible changes.** Every picture in the solver package still
   holds: a rectangle pinned by one corner moves whole, a width set on it
   leaves its height exact, a level line pinned at one end is carried
   whole, the 5% drag cost of `test/directionrows.test.ts` stays pinned.

## Tests

- `test/keptsizes.measure.ts` (new; the bench scripts made a file): the
  table above, re-made on the base and on the branch, both printed by the
  test under `NEOCAD_TIMING` and the shape of the result asserted always:
  forty chained free-width rectangles, one dimension set → **zero** extra
  solves from `keptSizes` (count the solves by wrapping `problem.solve`,
  as `conflicts.test.ts` now does); the dimensioned case → the pull names
  at most the rectangles the dimension touches plus one ring.
- The solver package's own tests, unchanged and green: `directionrows`,
  `keptsizes`-related cases in `solver.test.ts` / `reviewsolver.test.ts`
  (whatever they are called — find them by `keptSizes` in the comments),
  the pictures' browser tests.
- A size that drifts by a visible amount (a `perp` pair's line stretched 2%
  by a straight step) is still pulled back — the existing case, kept.
- For 3: a test that the par-to-axes row has the non-zero count the chosen
  fix gives, so a later change that widens it again is caught.

## Vetoable, to be written into the register when built

- A size is "kept" to what can be seen (a thousandth), not to 1e-9.
- The pull is on the drifted sizes and one ring of neighbours, not on the
  connected component.
- Whichever of 3's (a)/(b) was done, and the frame time it bought.

## Left deliberately

- The kernel's CG preconditioner and a rotation-aware damping stay as they
  are (both in the register already); this plan spends nothing in
  `kernel-rs`.
- The phone is still unmeasured for any of this; the box's numbers are
  what there is until the owner runs the measure page.
