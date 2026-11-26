# Plan: a profile stays flat, a drag stays on its plane, and a refused body says so — the owner's hole that "changed to add"

**Status: built** (2026-11-26, branch `claude/flat-profile`). Bugs **83**
and **84** in docs/ARCHITECTURE.md's list. *As built* at the end has the
measurements, the decisions and what was left.

## What the owner saw

A plate from the Rectangle tool, extruded. A circle on its top, the Cut tool,
through all — a hole. Then the circle's centre dragged a little by finger.
The log: *solid: e1 cannot be laid out: its chord is not square to its
profile — an oblique extrude is drawn, and the kernel only sweeps square*.
The kernel built nothing; the plate was drawn as a plain prism from its own
faces and the cut's walls and cap hung under it as a solid — *"the cut
changed to add"*. His file (`test/fixtures/owner-lens-cut-v23.neocad.json`,
his numbers kept) has the circle crossing the plate's edge, so the Cut took
the lens: a D-shaped notch, 110 deep through an 85 plate.

## What was true (measured)

Two things, and the one that looked like the cause was not.

1. **His file never settled** (bug 84). Replayed headlessly, every
   `solve()` ran to the sixty-iteration cap and stopped 6e-3 off, and a
   further solve was the same again; the base was left 2.9e-3 off square
   along the chord. `problem.unmet(1e-6)` named eleven relations. Removing
   each relation in turn and solving: without `e2_perp` — the cut's chord
   square to its profile — the file settled in **four** iterations to
   1e-10; without anything else it stayed stuck. Iteration by iteration
   (`solve_step` called by hand, the normal equations' residual checked):
   the kernel's conjugate gradient was accurate to 1e-8; the linearised
   model itself predicted almost no descent at the damping a solve starts
   from (3.27e-2 → 2.56e-2), every undamped step was rejected as the unit
   normals' nonlinearity bit, λ grew by eight and shrank by three — a creep.
   The valley: `squareToProfile`'s rows for a curve member, `ĉ × n̂ = 0`,
   are **bare angles**. A turn of the 110-long chord by θ costs the row θ
   and moves the chord's end 110·θ; the rows that hold the chord's end are
   lengths. The review-solver rule — a row that reads a direction is paid
   in a length, or the solve meets it cheaply — had been applied to lines
   and never to curves (`k = 1` for normal rows, which the register had
   already queued for revisiting).
2. **The kernel's bar was tighter than the drawing's** (bug 83). The owner's
   box, flat to 4e-6 and square to 0.0002°, SOLVED, was refused: the bar was
   a millionth of the drawing's size (1.1e-4 here), and a drag's frames
   settle to the eye's precision, not that. Mid-drag the box was refused,
   its hole with it, and the cut built as a body of its own — `programOf`
   made a cut with no base before it the chain's first node, *new*, and the
   kernel swept the hole's shape as a boss.
3. **The drag's target was off the face.** A point held `onplane` a face,
   dragged, is read on the screen-parallel plane; the relation refuses the
   target, and what gives is whatever is free — the box tilted toward the
   finger a hair a frame while the circle moved 0.003 for forty pixels.
4. **A profile drawn line by line is flat by nothing of its own.** The first
   reproduction (a box typed as `pt`/`ln`, no relations) left its base 1e-4
   off flat after a drag; `e1_perp` implies a closed polygon flat only at
   convergence. The Rectangle tool's box carries its own `coplanar`, which
   is why the owner's base was flat and this was not his cause.

## Design, as built

1. **A curve's direction rows are paid in a length** (`src/relations/`):
   `squareToProfile`'s curve rows in the chord's length as the solve began;
   `par`/`perp`/`ang` with a circle's, arc's or ellipse's normal on a side in
   the curve's radius (`DirectionRef.scale`); the extrusion's normal row
   `n̂₂ − n̂₁` in the base curve's radius. Each a plain number frozen at the
   solve's start (`lengthBefore`/`valueBefore`), as every direction row's
   scale is, so the step cannot move it.
2. **The solids layer's bar is the drawing's own** (`refuseOblique`,
   `OFFENDING` = 0.05, exported from the kernel's problem): a profile the
   status calls SOLVED is built. The profile is laid out in the plane square
   to the chord whatever the bar, so the bar decides only whether a drawing
   within its own tolerance is built.
3. **A solve that stops at the cap is solved on** (`Model.solve`,
   `SOLVE_ON` = 3 more rounds): a drag's release goes through it, and the
   release is the one solve meant to finish.
4. **A cut with no base is no body** (`programOf`): left out and said
   (`e2 cannot be laid out: e1 is not built, so there is nothing for it to
   cut`), listed in `shells`; `drawn()` puts shells, and every cut left out
   of its body (`chainsOf`'s `left`), in `replaces`, so faces.ts draws no
   faces for them. **An unbuilt cut is drawn as outline only**: its profile,
   twin and chords as the geometry they are, no filled face. Decided over a
   tinted shell because the shell *is* what read as a boss, whatever its
   ink, and the outline says exactly what is there — geometry, no body.
5. **A refused feature's row says so** (`organiserSections(…, refusals)`,
   `Bodies.refusals()`): *not built*, the word alone in the kind's place
   (a longer detail is cut by the pane's width), in the warning ink
   (`data-warn`), the kernel's first line about it on hover and in the row's
   menu header (a finger's hold). The same for a kernel refusal (*could not
   be applied*), an idle cut (*cuts nothing*), a feature left out of its
   body. A record already *unbuilt* or *open* keeps its own word.
6. **An extrude holds its profile flat** — `flat("e1")`, `e1_flat`
   (`profileFlat`, `src/relations/profilesquare.ts`): one row per profile
   point from the fourth on, in the plane of the first three points, in the
   profile's order, that make a plane when it is made (not the largest
   triangle: a symmetric profile chose differently at the replay's seeds
   and in the solved drawing, so a saved file held another triangle than
   its drawing — shapes.e2e.ts's slot); made by the extrude's expansion beside
   `e1_perp`, named for the record and claiming no counter, listed, marked
   `▱`, deletable; not for a triangle or a lone circle (nothing to hold), not
   for a revolve (its `revolution` holds the profile in the axis's plane) nor
   an edge extrude (open curves, a drawn surface). **Not twinned**: the lid
   is flat by the extrusion. **Never named redundant** (`QUIET_OPS`): where
   the user's relations say it already — a rectangle's right angles and its
   coplanar — that is the feature agreeing with the drawing; a conflict still
   names it, since deleting it is how an oblique extrude is asked for. Format
   **24**: a file of 23 or before gains it at the replay step; a 24 file may
   carry `deleteRelation("e1_flat")`, which a 23 build would stop at.
7. **A drag of a point held on a plane moves in that plane**
   (`src/tools/dragplane.ts`, `heldPlane`): `onplane`, `coplanar`, a
   feature's `flat`; every governing point of what was grabbed must be held
   on one plane, else the engine falls back (a line from lid to ground, a
   point held on two planes, a plane seen edge-on). Put where the drag's
   plane is chosen (`ToolEngine.dragPointAt`), ahead of the chosen sketch
   plane and the facing plane.

## As built

### Measured

| | before | after |
|---|---|---|
| the owner's file, one plain solve | 60 iterations (the cap), 6e-3 left, every solve | 18 iterations, 6e-10 (38 with the model's kept-size probe and finish) |
| base off square along the chord | 2.9e-3 | 1e-9 |
| the kernel on his file | both features refused as oblique; the cut built as a boss | the plate with its notch, volume = ZeroCAD's own to 2e-7 |
| a 60-deep free box, circle dragged off its face, the settle | 60 iterations creeping, base 1e-4 off flat, circle normal 1.1° off the face | 7 iterations, 2.6e-12 |
| the owner's box by finger, forty pixels (browser) | the circle moved 0.003, the box tilted, e1 refused mid-drag | the circle slides along the face, the box's corners move < 1e-6, the hole stays |
| the lever alone: a circle extruded 110, its lid centre seeded 3 aside | — | square again in ≤ 15 iterations |

### Decisions, each vetoable (also in TODO.md's register)

- The curve rows' length is the **chord's**, the normal rows' the
  **radius's** — the natural lengths, and the register's own suggestion.
- The kernel's bar is **`OFFENDING`, absolute** (0.05), as the status's is.
  A tiny drawing (size 1) is built 5% off square; the status calls that
  solved too. A relative bar would need a second notion of tolerance.
- `SOLVE_ON` = 3: 240 iterations in all, what a stuck solve was measured
  creeping for; nothing settling took more than eighteen.
- An unbuilt cut is **outline only** (its geometry drawn, no faces), not a
  tinted shell.
- The row's word is **not built**, alone in the kind's place (the pane cut
  "extrude · cut · not built" to "not …"), in the warning ink, the reason
  on hover and in the menu header, which keeps the kind; a record unbuilt
  or open by its own doing keeps its word.
- `e1_flat` is made for **four points or more**, over the **first three
  points in profile order that make a plane** (deterministic across a
  replay; the largest triangle was not), **quiet** to the redundancy
  verdict, **not twinned**, format 24.
- The drag plane is the **held plane** first, then the chosen sketch plane,
  then the facing plane; a disagreement among the grabbed points falls back.

### Tests

`test/flatprofile.test.ts` (the owner's file settles and builds; the deep
box; the lever; the bar; the solve-on; the shell and the row; `e1_flat`
made, named, counted, listed, marked, deletable and journalled, one relation
for both profiles, the format fixture `flat-v23`, the owner's file's,
nothing more redundant); `test/dragplane.test.ts` (`heldPlane` by each
relation and its refusals; the owner's drag through the engine);
`test/e2e/flatprofile.e2e.ts` (the hole and the lens by finger and by
mouse; the refused row). Pictures 553–560.

### Left, and filed (TODO.md, *Next up*)

- A dragged free box answers an off-plane pull by tilting still — correct,
  *"I should be able to pull on anything"* — and its frames run to the cap
  with a compromise residual (4e-3): a kinematic frame against a rigid body
  is a least-squares compromise by construction. The release settles it.
- The `onCircle` rows and the remaining unit-angle rows (`par` of two
  curves' normals, a revolve's) were not re-measured for levers; the
  register's lever entries stay open.
- A free polygon's drag still keeps its edges' lengths and brings a lifted
  corner most of the way back (`keptSizes`), so an oblique extrude is made
  by `ang`, or by seeding — not by dragging a corner.
