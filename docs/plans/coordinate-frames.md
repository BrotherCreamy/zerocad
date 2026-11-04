# Plan: no world frame — coordinate frames are entities

> **Revised 2026-11-04 by [`frameless-curves.md`](frameless-curves.md)** (vetoable
> in the register): every document now has one fixed, built-in origin, which
> is what `fix` and the axis helpers mean with no default frame. What stays
> of this plan is that nothing else makes a frame unless asked.

**Status: SHIPPED, both halves** (2026-09-01). What the build decided along
the way, all of it now in `TODO.md`'s register: a frame is **read, not
pushed** — its two points are re-read at every evaluation but are not declared
as variables of the residuals that read them, because declaring them lets the
solver level a line by turning the frame instead (measured; see
`CONVERSATION_LOG.md` and `relations/refs.ts`). That is what makes the
closed-form test below true. `fix` above 2D keeps its gauge-relative meaning,
since one direction does not settle a 3D frame (*closed since*: 3D phase 1
gave 3D frames a y-ref and `fix` there a frame — see `3d-phase1.md`). The rectangle went intrinsic
in half 1 rather than half 2, because `hor` needs a frame and a clean sheet
has none.

The one thing this spec assumed and got wrong: it took for granted that
dragging a frame's x-ref would "turn the drawing rather than start a tug of
war". It does neither on its own — read-never-pushed also means the solver's
own step test *refuses* to move the frame, because turning it raises residuals
the step has no derivative for. Half 2 therefore moves a dragged datum
outright and lets the solve follow. See the register.

Owner's direction, verbatim intent: the
background grid is gone (already shipped); there should be **no built-in
origin and no built-in world coordinate system at all**, because an origin
tempts the user into relating geometry to a global frame; instead the user
can **define coordinate frames** as first-class things, and **set one as the
default frame**.

This is the largest semantic change since relations got names, so it ships
in two halves like free-entities did: **(1) model + relations**, **(2)
command surface + tools + drawing + e2e**. This spec covers both; the
worker builds half 1 first and lands it before starting half 2, so the
review can hold each in one hand.

Read `CLAUDE.md`, `docs/ARCHITECTURE.md`, and `docs/plans/free-entities.md`
— the constructor conventions (optional args, null-means-absent,
journal-as-the-call, non-degenerate seeds) all apply to the new
constructor.

## What "no world frame" means precisely

The kernel keeps its flat variable vector; numbers have to live somewhere.
That substrate is a *gauge*, not a frame: after this package **nothing in
the user-facing vocabulary can reference it**. Concretely:

- `hor`, `ver`, `fix` stop meaning "relative to the world" and start
  meaning "relative to a frame". Everything else (`dist`, `par`, `perp`,
  `ang`, `tan`, `on`, …) is already intrinsic and does not change.
- A drawing with no frame and no fix simply floats in the gauge. The solver
  already handles that — undimensioned geometry is the normal case here,
  and the damped step keeps unconstrained directions where they were
  seeded. Nothing needs anchoring for the mathematics to work.

## The frame entity

- `addFrame(origin?, xref?, name?)` — a frame is an **origin point plus a
  point that fixes the +x direction** (its distance is irrelevant, only the
  direction counts; the worker decides whether to normalise inside the
  residuals or divide by the live length — mind the degenerate case, and
  test it). +y is +x rotated a quarter turn counter-clockwise; in 2D that
  is fully determined. Like a line, a frame is purely referential — it owns
  no variables, and its two points are ordinary, draggable, constrainable
  points (free-entities conventions when omitted: auto-created,
  non-degenerate — seed them a sane span apart, and journal as the one
  call). Auto-names `f1`, `f2`, …
- Frames are entities in every downstream sense — `ls()`, `del` cascade
  (a frame takes its relations, not its points; deleting one of its points
  takes the frame — the line rules), hover, pick, drag (dragging a frame
  drags both its points by the offset, `dragGoverns` style), box select.
- **The default frame** is a model-level pointer: `setDefaultFrame(name)`
  (journaled; `null` to clear; deleting the default frame clears it —
  journal that expansion, deletion's own rule). New models have **no**
  default frame: a frame exists only because a user made one.

## The relations

- `hor(line, frame?)` / `ver(line, frame?)` (point forms keep working the
  same way): parallel / perpendicular to the frame's x-direction. The
  wedge/dot forms already exist in `relations/vec.ts`; take the frame's
  point variables **lazily**, the house rule, so a frame whose points an
  operation re-targets keeps its relations honest.
- `fix(point, coords, frame?)`: the point's position *in frame
  coordinates* — origin plus coords[0] along +x plus coords[1] along +y.
- In all three, `frame` omitted means **the default frame at call time**
  (resolve the name at call time and journal it resolved — a journal entry
  must not depend on what the default was later). No frame given and no
  default set: **throw**, with a message that says the fix: "no default
  frame — frame() then setDefaultFrame(), or say which frame". This makes
  the temptation the owner described impossible rather than discouraged.
- The journal for these relations therefore always carries an explicit
  frame name. **Old saved files break** — they carry frameless
  `hor`/`ver`/`fix` entries and there is no frame to resolve them against.
  That is accepted and goes in the CHANGELOG in bold: pre-release, one
  owner, and a compatibility shim would preserve exactly the semantics the
  owner asked to remove. (`replayTable` should reject them with the same
  clear message, not silently skip.)

## Tools and inference (half 2)

- `frame()` at the command line, free-entities conventions (view-centre
  seeding for the auto origin; the x-ref seeded to its right).
  `setDefaultFrame`/`defaultFrame()` as commands; `help()` updated.
- **The rectangle tool goes intrinsic**: `par` opposite edges, `perp` one
  corner — a rectangle is a rectangle in any frame, and the tool no longer
  needs `hor`/`ver` at all. (With a default frame set it STILL draws the
  intrinsic form; a user who wants the rectangle level says so with one
  `hor`. This is the smallest honest rule — the alternative, tools that
  secretly change vocabulary depending on ambient state, is the kind of
  magic this codebase keeps refusing.) ⚠ Flag this in the register — it is
  a deviation from Onshape, which infers H/V against its sketch frame; the
  owner can veto it there.
- **The line tool's H/V inference applies only when a default frame is
  set**, and infers `hor(l, thatFrame)` — inference against a frame nobody
  chose would be the temptation coming back in through the pointer.
- A frame draws as a small axes marker at its origin: two short arrows
  along +x and +y, the default frame drawn a touch brighter. Keep it in
  the entity layer of `render()`, not the glyph layer — a frame is
  geometry, not annotation.

## Verification

Half 1 unit: frame construction (all arg forms, degenerate-seed
impossibility, journal-as-one-call, round-trip byte-identical);
`hor`/`ver`/`fix` against a frame whose x-ref is not axis-aligned (the
drawing solves "level" along a tilted frame — the closed-form check, not
`solved:true`); the no-frame throw; default-frame resolution journaled
resolved; deletion cascade including the default-pointer clear. Existing
tests that used world `fix`/`hor`/`ver` gain a one-line fixture frame —
mechanical, but read each one as you touch it.
Half 2 e2e: make a frame, set default, draw with the tools, tilt the frame
by dragging its x-ref and watch the whole "level" drawing rotate with it —
that screenshot is the package's poster. Plus: no-frame flow errors
legibly at the REPL; rectangle is draggable-rigid in any frame; save/open
round-trips; the H/V-inference-only-with-default rule. Full
`npm run test:all` per commit. Docs duties per `CLAUDE.md`; the register
entry for this decision is already in `TODO.md` — extend it with what you
decide along the way, flagged where it deviates from Onshape.

## Delivery

Isolated worktree, branch `claude/coordinate-frames` off the working-branch
tip. **Two PRs, in order** (half 1 lands before half 2 starts), both
against `claude/resume-tasks-o7q02e`. Do not merge; the supervising session
reviews. Nothing else is in flight; the footprint is genuinely wide, so
keep commits small and reasoned.
