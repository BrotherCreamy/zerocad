# Plan: the two solver costs the review measured — a size pulled back that nobody could see move, and a drag frame five times dearer

**Status: built** (2026-11-12, branch `claude/solver-cost`; *As built* below —
the spec's premises were measured first and two of three did not hold).
From the register's measurements of the
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
in the manager's scratchpad (`bench/drag.ts`, `bench/edit.ts`); they are
`test/keptsizes.measure.ts` now, and *As built* re-makes the table — on the
kernel the table above was taken with, which turned out to be a debug
build, and on a release one.

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

## As built (2026-11-12)

Every number is `test/keptsizes.measure.ts`'s or `test/solver.measure.ts`'s
on this box (four shared cores), the best of five; the load is given with
each. Kernel solves and iterations do not depend on the load and are
asserted in `test/keptsizes.test.ts`.

### The kernel the table above was measured on

`src/kernel/wasm-gen` here was a **debug build**: `build:kernel` fails at
binaryen's download on this container and every worker fell back to
`build:kernel:dev` (`wasm-pack build --dev`, 148 KB, no optimisation).
Its linear algebra is ten times slower than a release build's (a kernel
step on forty rectangles mid-drag 1.7 ms against 0.09), so the table above
— and every kernel timing in the register before it — is a debug kernel's.
`build:kernel:noopt` (`wasm-pack build --release --no-opt`, 32 KB) is the
release kernel without the wasm-opt pass; CONTRIBUTING says to time nothing
on the dev kernel; both measure scripts print the kernel's size.

### The table, re-made

| case | base, debug kernel (load 0–2) | base, release kernel (load 0–2) | built, release kernel (load 2–6) |
|---|---|---|---|
| one dimension set: forty chained rectangles, **widths free** | 1287 ms | 238 ms — 4 solves, 41 iterations, widths left **1e-2** off | **109 ms** — 5 solves, 19 iterations, 3e-11 |
| one dimension set: forty chained rectangles, widths dimensioned | 904 ms | 186 ms — 6 solves, 27 iterations | **143 ms** — 5 solves, 21 iterations |
| one dimension set: forty par-to-axes rectangles, a width ×1.25 | 412 ms | 75 ms — 6 solves, 24 iterations | **57 ms** — 5 solves, 19 iterations |
| a drag frame: forty rectangles held `par` to the axes and dimensioned | 23.0 ms | 8.2–9.1 ms | 8.5 ms (not this package's to change; see 3) |
| a drag frame: forty rectangles of four perps chained by `par` | 188 ms | 37 ms | unchanged |
| one rectangle, a width set | — | 1.4 ms — 6 solves, 12 iterations | 1.3 ms — 5 solves, 12 iterations |

### 1. A drift that cannot be seen — what was true

The spec: setting the gap moves every point by a hair and fifty-six sizes
drift by 1e-7. Measured (a bare `problem.solve` after the `set`, every
line's length against before): **fifty-two drift by 1.3e-7 and four by
3.1%** (1.24 of 40) — the straight step opens the gap by narrowing the two
rectangles beside it, and `keptSizes` was right to bring them back; with
every size kept the chain opens instead (r0 moves −0.85, r39 +1.64). In
the dimensioned case **78 of 82** sizes drift by more than a thousandth:
the chain shears as the width grows, every height 0.5–1.4 off along it,
r20's own 5.5. So the threshold decides only *whether* `keptSizes` runs,
never how much it pulls, and nearly every edit crosses it.

Three thresholds were tried against the pictures:

| rule | the free-width gap | the level line pinned at one end (slides 1e-5 of its length) | a rectangle 3% narrower in a drawing 1990 across |
|---|---|---|---|
| 1e-9 (as it was) | pulls | carried whole | pulled back |
| a thousandth of the size (the spec) | pulls | **left 5e-4 off** — `directionrows.test.ts` fails | pulled back |
| …or a thousandth of L, whichever is larger (the spec) | **no pull** | left off | **left 3% narrower** |
| **1e-6 of the size** (built, `DRIFT`) | pulls | carried whole | pulled back |

### 2. One ring — measured and rejected

Pull only the four drifted widths, over the component: the pull is met by
narrowing r24 and r27 instead, **1.25 off** — a free size that is not
pulled is where a pull goes. One ring of blocks round the drifted sizes
(`Problem.reach` at depth 0), solved `only` among them: **0.63 off** the
same way, and a ring cannot translate a chain at all. The pull on every
held size of the component stays.

### Where the time went, and what replaced the one pull

Each of the base's kernel solves traced on the free-width gap: plain 6
iterations; the pull **30** (its cap), ending with the widths **2.7e-4**
short; release 5; whole 0 — the base left the widths 1e-2 off. The pull is
weak (`STEER`, relative to the size: a fortieth of a `dist` row's weight on
a 40-long line) so that a size a dimension owns stays with the dimension,
and a weak compromise is a step the kernel's conjugate gradient cannot take
exactly. Counted by a TypeScript mirror of `solver.rs` on the pull's own
Jacobian (480 variables, 516 rows, 2860 non-zeros):

| λ | CG iterations (cap 200) | residual left | uncapped |
|---|---|---|---|
| 1e-3 | 179 | 8.7e-11 | 179 |
| 1e-4 | 200 | 3.2e-7 | 373 |
| 1e-5 | 200 | 6.5e-5 | 480 (n), 2.2e-6 |
| 1e-6 … 1e-8 | 200 | 2.3e-4 … 2.7e-4 | 480, ~1e-4 |

so from the second LM step on the step is inexact and LM creeps (the
kernel's step 2–3.7 ms here, against 0.09 on a frame).

Tried, with the result on both chained cases (free widths / widths
dimensioned, worst other size left off):

| pull | free-width gap | dimensioned width |
|---|---|---|
| relative, weight 1 (the base) | 1.1e-2, 35 iterations | 3.5e-9 |
| a length, weight 1 | **2.7e-11, 9 iterations** | **2.80** — the owned width pulled halfway, the release wanders |
| a length, weight 0.1 | 4.0e-6, 33 iterations | 7.4e-2 |
| **probe (0.1, 4 iterations) then finish (1) on the free sizes** | **3.0e-11, 13 iterations** | **3.5e-11, 10 iterations** |

The probe's reading, after four iterations: a size the relations own keeps
**0.98** of its change (the two widths the dimension set); a free one keeps
**0.00–0.12** (the chain's heights, the gap's four widths) — or more than
it had, where the probe disturbs it (a rectangle's height 2e-6 out became
7e-4 under a probe on its width), which is why `OWNED` reads "moved less
than half its drift" and not "still off by more than half". With the probe
relative at weight 1 the free widths kept 0.45, too near a half to read;
at 0.3 the owned widths kept 0.82–0.85. The finish pulls only the free
sizes, as a `dist` row would (a residual of one per unit of length): nothing
fights it, its steps are exact, and the release has nothing to do (0
iterations in every case measured). The base's second round — "what the
relations changed anyway is theirs" — is gone with the reason for it.

### 3. The direction row's cost — the census

Forty par-to-axes rectangles, release kernel, the frame pulling one free
corner up 9 in thirty frames:

| state | rows | non-zeros | `par` rows | `dist` rows | evaluate | kernel step (λ 1e-3) | CG iterations |
|---|---|---|---|---|---|---|---|
| at rest | 582 | 841 | 480 rows, **2.0** nnz each, 160 identically zero | 99 rows, 2.0 | 0.90 ms | 0.005 ms | 0 |
| the first frame's pull | 585 | 844 | 2.0 | 2.0 | 0.87 ms | 0.012 ms | 2 |
| ten frames in | 585 | 1286 | **2.8** | **4.0** | 1.22 ms | **0.091 ms** | 15–17, whatever λ |

A frame is 5.1 LM iterations and about six evaluations: **the kernel is
0.5 ms of the 8.5**, the rows' evaluation the rest (on the debug kernel the
step was 1.7 ms and the frame 23). The `par` rows have the non-zeros the
raw rows had at rest — a unit direction's gradient is diagonal exactly on
the axis — and grow less than the `dist` rows do off it.

- **(a)** holds: `par(line, axis)` reads the line's six variables and never
  the frame's (`directionOf` gives an axis `width: 0`); pinned by a test.
- **(b)**, two rows for three against a constant: not done. The turn
  vector is perpendicular to the axis, so (I − ââᵀ)J = J for its Jacobian
  and the three components' normal equations are exactly the two projected
  rows' — the kernel does identical work either way — while projecting onto
  a tilted frame's plane is two Dual dot products a row, dearer than the
  dead component it saves (for a coordinate axis that component is a
  product of constant zeros, about a third of the wedge's 1.5 µs).
- **(c)**: the frame is 8.2–9.1 ms on this box against the spec's 8, and
  the item to file is not the CG preconditioner (for the frame) but the
  rows' evaluation: a `par(line, axis)` block is **5.1 µs** — `unit` 0.7,
  the wedge 1.5, the dot 1.0, `turnFactor` 1.0, the scaling by `f` and `k`
  2.2 — nearly all of it Map allocation in `Dual`. A constant-aware
  `Dual.mul` (an operand with no gradient treated as a number) was tried:
  the block 4.1 µs, the frame 10.7 against 12.3/12.6 ms at a load of 3–5,
  within the noise, so not taken. Filed in the register with these numbers,
  and the CG cap filed where it does bite: the probe's weak system, above.

### 4. Nothing visible changes

`directionrows.test.ts`'s 77 pass unchanged: the level line pinned at one
end carried whole, the width set that leaves the height exact (to 1e-9
now; it was 6.6e-5 before the probe's "moved less than half" reading), the
perp pair kept, the 5% drag cost pinned. `reviewsolver.e2e.ts` and
`conflicts.e2e.ts`, 17 browser tests of pictures 460–469: pass. One unit
bound moved, `conflicts.test.ts`'s bounded search (≤ 8 kernel solves for
five trials → ≤ 35): the `par` across a corner folds a side now where it
sheared, because the under-determined chain's free coordinates stand 3e-3
elsewhere after the drag's release, and a folding trial costs seven solves
(push, steer, push). Checked from three more starting points each: the
base shears from all four, this build folds from two of four; both are the
design's verdict with the right culprit.

### Tests

`test/keptsizes.test.ts` (6): the free-width gap — five kernel solves
whatever the drawing's size, the probe over all 160 held sizes and the
finish over all 160, every size to 1e-9, the chain opening; the dimensioned
width — probe 160, finish 158, the two owned sides never pulled, every
other size to 1e-9; a fix moved 5 on the axis-held chain, moved whole; the
perp pair, pulled; a drift of 1e-7 left alone (one solve); `par(line,
axis)` reading six variables and a row at most six non-zeros. Unit total
2143 (2137 before).

### Vetoable (written into the register)

- `DRIFT` is 1e-6 of the size, not a thousandth and not a share of L.
- Every held size of the component is pulled, not one ring.
- The pull is a probe (0.1, four iterations, owned = moved less than half)
  then a finish (1) on the free sizes; the second round is gone.
- The axis row keeps three components in 3D.
- `build:kernel:noopt` is the fallback and the measure scripts say which
  kernel they ran on; CLAUDE.md still names `build:kernel:dev`.
- The conflict test's bounded search allows seven solves a trial.

### Left

- The direction rows' evaluation (the register has the numbers and the
  first thing to try); the CG cap against a weak pull (`kernel-rs`); the
  phone, still unmeasured.
