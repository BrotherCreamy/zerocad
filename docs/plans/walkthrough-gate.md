# Plan: the walkthrough gate — the first ten minutes, by finger and by mouse, before anything else

**Status: built** (2026-11-26, branch `claude/walkthrough-gate`). Bugs
**85** and **86** in docs/ARCHITECTURE.md's list. *As built* at the end has
the measurements, the decisions and what was left.

## Why

The owner, 2026-11-26, after a hole in a block failed four different ways on
the build he had (bugs 80–84): *"this is pretty basic stuff."* Every one of
the four passed the whole unit suite and was obvious within seconds in a
browser. The promise made was a **walkthrough gate**: the first ten minutes
of the app, done by finger on the iPhone emulation and by mouse, from a
blank canvas, checked on the body afterwards, run on every merge before
anything else. Two halves existed — `cutpaths.e2e.ts` (draw, extrude, cut,
both orders, both tools) and `flatprofile.e2e.ts` (nudge the circle, the
hole stays). Two were missing: **undo and redo through the whole sequence**,
and **save and reopen** to the same solids. And one fault was still filed:
the lens cut's circle nudged by finger left the release's solve stalled at
3.5e-7, and picture 560's log carried the kernel's refusal of a frame's
boolean.

## What it is

`test/e2e/walkthrough.e2e.ts`, one file, parameterised by hand (iPhone 13
by finger through CDP; a mouse), every step asserted on the model and the
log, never only on the screen. `npm run gate:walkthrough` runs exactly that
file; it is the first thing run on every merge.

The sequence, per hand:

1. **A blank canvas** — no lines, the snapshot taken.
2. **Rectangle** (the tool's button, a drag): four lines, SOLVED.
3. **Extrude** (the tool's button, a press inside, ✓): twelve edges, the log
   says `e1  extrude of l1,l2,l3,l4, depth d1 = 10`. The view turned to a
   corner, as the owner's screenshots are.
4. **A circle by a press straight on the lid**, no plane chosen: the app's
   own face pick says the press lands on `e1.lid` first; then one circle,
   its centre on the lid near its middle, held there by `onplane(p, e1.lid)`,
   its normal `par` to the lid, radius about 12.
5. **Cut**, the Cut tool from the Extrude button's flyout (a hover by mouse;
   by finger a press on the group's button slid past the slop, the finger
   gliding onto the item and lifting), a press inside the circle, ✓ — the
   tool's default depth, 10, which is why the box is 10 thick: a hole right
   through by ✓ alone, as the owner presses it.
6. **The hole is through**: the circle and its twin at z = 10 and 0; the
   features `[extrude], [extrude · cut into e1]`; the log carries none of
   *cuts nothing*, *does not reach*, *nothing of the body would be left*,
   *could not be applied*, *subtract failed*, *cannot be laid out*, *not
   built*; the bodies layer's one view is `e1[e1+e2]`, nothing skipped, no
   report line, no organiser row in the warning ink, the body row says
   `e1 − e2`; the kernel's volume is 80·80·10 − πr²·10 to 1e-3. (The kernel's
   answer is asynchronous: every reading of the bodies layer waits for a
   volume that has stopped changing.)
7. **The centre nudged** forty pixels along and sixteen down: still the hole
   (the same checks), the circle slid more than 3, the base's four corners
   coplanar to 1e-6 and moved under 1e-2, a further `solve()` 0 iterations,
   the kernel's volume the same to 1e-3.
8. **Undo back to the blank canvas one step at a time** — Ctrl+Z, or the
   action strip's Undo by finger — each landing on the snapshot taken after
   the step before, with its point count and feature count; the blank canvas
   at the end.
9. **Redo** forward through the same snapshots to the hole: built again, the
   kernel's volume the one before to 1e-6.
10. **Save, as a person does it**: the app menu's Save. On the desktop the
    (stubbed) save picker writes the file; on the phone the (stubbed) share
    sheet is handed it. The file's text is exactly `save()`'s.
11. **The page reloaded**: the autosave brings the drawing back, as a phone's
    app resumes. Then the app menu's **New** (a blank canvas), then **Open…**
    of the saved file — the desktop's picker, the phone's file input.
12. **The same solids**: the hole's checks again; every point where it was
    to 1e-6; the kernel's volume the same to 1e-6; the same face count.
13. **The hole still nudges** in the reopened file.

Beside it, per hand:

- **The Extrude button's own Cut mode**, chosen after the pick and before
  it (bugs 80 and 82's path, the one the toolbar puts first): the hole both
  times, with an Undo between that takes back exactly the cut.
- **The owner's lens**: the Plane tool on the lid, a circle crossing the
  plate's edge, the Cut tool from the flyout, through all — the D-shaped
  notch, its volume the closed form to 1e-3 — nudged −24, +8 pixels: still
  built, no boolean failure in the log, the circle moved more than 2, a
  further `solve()` 0 iterations; Undo puts the circle back.

Pictures 561–568: the hole, the hole nudged, the file reopened, the lens
nudged — iPhone, then mouse.

Six tests. Under two minutes with the runner's two workers on a shared
four-core box (the iPhone walkthrough 33 s, the mouse's 23 s; the Cut-mode
pair 15 and 11 s; the lens pair 18 and 14 s).

## Bug 85 — the lens cut nudged by finger: a datum that wandered

### What was true (measured)

Reproduced from the flatprofile scene in the browser with the solver hooked
(`Model.solveFrame` and `Model.solve` wrapped on the page), and the browser's
model saved and studied headlessly.

- **The circle moved**, by finger and by mouse alike, 7 units for the
  −24, +8 pixel nudge, the press landing on `p9` every time. The *0.02* the
  previous package measured did not come back in nine runs; it was most
  likely the suite's load (coalesced frames at the cap, below). The gate's
  assertion will say if it returns.
- **Every drag frame ran to the sixty-iteration cap at 1e-4 to 3e-4** —
  a hundred times worse than the plain hole's frames, which also run to
  the cap but at 1e-6, the pull's own row (the kinematic compromise against
  a free body already filed).
- **The release took 24 iterations by finger, 29 by mouse**, and settled.
  By finger the log carried, once, *e2 could not be applied to e1: the cut
  failed: subtract failed (status 1001)* — a frame's geometry, 1e-4 off,
  refused by SMLib and the last good body kept.
- **The stall reproduces headlessly with small frames**: twelve frames of
  0.5 in the lid's plane, then a release — 60 iterations, 4.5e-8 left,
  `d1, r7, r8, d2, e2_through` unmet at 1e-8. Twelve frames of 6: the
  release 20, settled. Removing `e2_through` alone: the release 2
  iterations; removing `d1`: 4. No single relation's removal frees the
  frames.
- **The undamped step did not descend.** At the stalled state (50
  variables, 49 rows, max residual 8.2e-6, `onplane(p1,e2.lid)` the largest)
  one Gauss–Newton step at λ = 1e-10, which the linearised model promises
  takes the residual to zero, took it from 8.2e-6 to 7.7e-6. A row's model
  was wrong.
- **Which row**: `onplane(p1, e2.lid)`, `e2_through`. `readPlane` reads a
  cap as its first point and **the cap's normal as a datum** — `capNormal`
  → `extrudeNormal`, the chord `p10 → p12` normalised, read fresh at every
  evaluation but no column of the row (the register's decision in
  through-all-relation.md, *the row is exact in both points, not in the
  lid's turn*). Its true derivative is a lever: a tilt of the chord by θ
  moves the row |p1 − p12|·θ, forty here. `extrudeNormal` fell back to the
  frame's own normal only while the chord was within **1e-9** of it. The
  lens's frames tilt the chord — a crossing point slides along the plate's
  edge, the chord's far end chases it — by a millionth a step, which turned
  the datum a millionth, which moved the row 4e-5: as much as the step had
  meant to fix. A hole never showed it: its frames move the circle whole and
  never tilt the chord.

### What was tried

| | frames (12 × 0.5) | release after | undamped step at the stall | `throughrelation` and `clickonface` tests |
|---|---|---|---|---|
| before | 60 it at 3e-6–8e-6 | **60 it, 4.5e-8 left** | 8.6e-6 → 7.8e-6 | pass |
| A: the chord as Duals of the row | 60 it at 5e-8–4e-7 | 8 it, 6.5e-10 | 3.4e-7 → 1.4e-7 | **4 fail**: a `dist` 15 against a through cut through a plate 10 thick is SOLVED, the hole slid along the plate and the cut leaning; a boss pulled up to a free block's lid takes the block 1.05 of the 2.5 before |
| C: the face's own plane as Duals (a curve member's normal, else three points) | as A | as A | — | **4 fail**: the same lean, through the small circle's normal paid in its radius 5 |
| **H: the datum stands still — the frame's normal within `OFFENDING`, the chord past it** | 60 it at 3e-6–8e-6 | **11 it, 4.4e-10** | 8.15e-6 → 3.3e-6 | pass |

A and C mend the valley completely and reopen exactly what the register
measured and refused: a variable normal lets a relation on a cap be met by
leaning, and the lean is cheap because the rows that hold the normal are
paid in a short length (the chord's 15, the circle's 5) while the row that
reads it has a lever the drawing's width. H keeps the datum and makes it a
datum: a number that does not move with the step. The bar is the drawing's
own, as `refuseOblique`'s is — the lid point's offset from the line the
frame's normal would put it on, under 0.05 — so within it the chord is
square as far as the status, the kernel and the eye are concerned, and the
row is exact in both its points and nothing else moves it; `e2_perp`, whose
rows are exact, keeps the chord square. Past it the body has turned (an
`ang`, a free body dragged round — the up-to-face test's block comes
turning, and passes) and the chord is what the cap faces along, as before.

### After (browser, both hands)

| | before | after |
|---|---|---|
| the release, by finger | 24 iterations (and 60 at 3.5e-7 under load) | 12–14, to 5e-10 |
| the release, by mouse | 29 | 13–14 |
| a further `solve()` | 0 (or 60, stalled) | 0, both hands |
| the kernel's boolean | refused a frame once by finger (status 1001) | nothing refused, both hands, every run |
| the frames | 60 at 1e-4–3e-4 | 60 at 1e-4–2e-4 (unchanged; see *Left*) |
| the circle's slide | 7 | 7 |

`flatprofile.e2e.ts`'s finger assertions are the mouse's again: settled
exactly, slid more than 2.

## Bug 86 — a hole the kernel remembered and the page forgot

Found by the gate's undo and reopen steps, in the first run. The evaluator
(`src/solids/evaluate.ts`, `body`) answers a program it has already built
with `cached: true` and no solid — *the caller has it from last time* — and
lets a body's chain go only when a program without that body reaches it.
`Bodies.sync` answers the **empty** program on the page and sends nothing,
and `take` then deleted the body's last answer with the body. So a hole cut,
**undone and cut again the same**, or a file **saved, New, and opened
again**, sent the kernel the program it had, the kernel said *cached*, and
the page had nothing to draw: the box without its hole, nothing refused, for
as long as the drawing stayed the same (the organiser row still said
`e1 − e2`). Redo did not show it only because redo's program differed from
the empty one in between in the other direction. The page now forgets a
body's answer only when the kernel forgets its chain — on an answer of the
kernel's own to a program without it. `test/bodies.test.ts` has the case,
through the in-process Worker; it fails without the one-line fix.

## Decisions, each vetoable (also in TODO.md's register)

- **A cap's normal stays a datum**, as the register had it; **the datum
  reads the frame's normal while the chord is square to it within
  `OFFENDING`** (0.05, absolute: the lid point's lateral offset), the chord
  past that. The switch is a step: at the bar a row on the cap jumps by
  lever × bar / chord — 0.2 for the lens — which the next frame works off.
  A smooth blend between the two readings was not built; measured only
  where a body turns whole (the up-to-face test), which passes.
- **The chord as Duals and the face's own plane as Duals were rejected**
  for reopening the lean, with the numbers above.
- **The page keeps a body's last answer across an empty program it
  answered itself** — one answer per body name, kept until the kernel is
  told of a program without the body or the Worker is replaced.
- **The gate is one file, run alone first.** Its main path is the Cut tool
  from the flyout with the default depth; the Extrude button's Cut mode and
  the lens are tests beside it. The file APIs are stubbed as files.e2e.ts
  stubs them; the reload asserts the autosave, then New, then Open.
- **Pictures 561–568**, four a hand.

## Left, and filed (TODO.md, *Next up*)

- **The lens's frames still run to the cap at 1e-4** (a hole's at 1e-6).
  What is left is the three-point plane `p5.p6.p8` read as a datum by `r6
  onplane(p9, …)`, `r7 par(c1, …)` and `e2_through`'s frame normal: the
  box, free, moves a hair each frame (0.001–0.01 along its normal over the
  nudge), and the datum's origin and normal move with it, unmodelled —
  the undamped step at the stall now descends 8.15e-6 → 3.3e-6, the rest
  the datum's. The architecture's *every other frame is a datum* holds
  this; the release settles it in a dozen iterations.
- **The radius drifts under a drag of the centre**: 18 → 20.6 for the
  7-unit nudge, both hands, before and after. A circle whose radius nothing
  dimensions, with two points held on it and on an edge, shares the centre's
  motion between the radius and the crossing points, and `keptSizes` keeps
  no radius. Whether the circle should move whole is the owner's call.
- **A lens cut's flat wall lies on the plate's wall** by construction — a
  coincident-face boolean. A frame 1e-4 off made SMLib fail once (status
  1001) before the fix and never after, but the geometry is delicate; the
  robust answer is a margin outward for a profile member lying on a body's
  wall, as `throughPast` gives a through cut's end.
- **The 0.02 slide by finger** was not reproduced; the gate holds slid > 2.
