# Plan: box select, and live solve for typed edits

**Status: shipped, pending review.** Both parts built as specified, in the two
commits asked for. Two things the spec did not anticipate, both recorded in
`TODO.md` and `CONVERSATION_LOG.md`: `boxselect.ts` became a fourth peer file
beside `picking.ts` rather than living inside it, and Escape turned out to have
been bound to the command input, which a mouse press on the canvas blurs — so
it was deaf during exactly the gestures it exists to abandon, and moved to
`window`.

**Status when written: queued.** Two concerns, two clearly separated commits — the second
is a small pre-existing bug fix that needs a semantic decision recorded, and
it rides along because it is too small to carry PR overhead alone.

Read `CLAUDE.md`, then `docs/ARCHITECTURE.md`.

## Part 1 — live solve for typed edits *(commit 1)*

The bug PR #4's worker found by looking at its own screenshot: a relation
typed at the command line adds its residual and redraws, but the header keeps
its old verdict — `SOLVED` over a drawing that plainly violates what was just
typed. The stale-readout incident class, again.

The decision that fixes it, recorded here so it is a decision: **a command
entry that changed the model re-solves through the host**, the way tools,
drags and `del` already do. This is Onshape's continuous solve and it is
cellwork's "live constraint solving" — both ancestors agree. The undo bracket
in `main.ts` already computes "did this entry change the model" by snapshot
comparison; reuse that answer rather than building a second one or, worse,
enumerating which commands are edits. `ls()` and `help()` must demonstrably
not solve; a contradictory `rad()` must flip the header to `CONFLICT` with no
`solve()` typed. Some existing e2e specs type `solve()` where it is now
redundant — leave them (harmless) unless one *asserts* staleness that no
longer exists, in which case fix the assertion and say so.

## Part 2 — box select *(commit 2)*

### The decision being reversed, in the open

The decision register says: with nothing armed, left-drag on empty canvas
**pans** (cellwork's habit). Onshape and SolidWorks both make that gesture
**box select**, and the standing rule — tools work like Onshape, so people
arrive knowing them — outranks the register entry. So: left-drag on empty
canvas becomes box select; panning remains on middle- and right-drag and on
the `pan()` command. The register in `TODO.md` must be updated by this
package, with the reversal noted — and the owner can veto it there.

Presses that are *not* on empty canvas keep their meanings: on a point,
kinematic drag; on other geometry, the old behaviour (a moved press pans —
edge-dragging is a known follow-up, and a box that starts on an edge is not a
box in either ancestor CAD).

### Direction semantics — the part users already know

The SolidWorks/Onshape convention, exactly:

- **Left→right: window select.** Only entities *fully contained* in the box.
  Drawn as a solid-edged translucent rectangle.
- **Right→left: crossing select.** Anything the box *touches*. Drawn dashed,
  in a visibly different tint.

Containment/touching are screen-space tests: a point by its position; a line
contained when both endpoints are, touched when it intersects the rectangle
or an endpoint is inside (`intersect.ts` has segment–segment — reuse it); a
circle/arc contained when its whole extent is, touched when the rim passes
through the rectangle (careful: a rectangle wholly inside a circle touches
nothing — the rim is the entity, same rule picking already follows).

### What selecting *is*

Nothing new: the names drop into the command line, comma-separated and
quoted, exactly as a click does — a box is a multi-click. Empty box, empty
result, nothing inserted. Escape mid-drag cancels the box. Glyphs are not
box-selectable (they are UI; a box full of `r`-names nobody asked for would
be noise — the flow for relations stays hover-and-click).

## Verification

Part 1 e2e: under-constrained sketch, type `dist(...)` → header updates with
no `solve()`; type a contradictory `rad()` → `CONFLICT`, no `solve()`;
`ls()`/`help()` provably do not solve. Part 2 e2e: window box over half a
drawing inserts exactly the contained names; crossing box the other direction
picks up the touched-but-not-contained edge the window box excluded; the two
rectangles render distinguishably (assert the mode, not pixels); Escape
cancels; a box that starts on a point drags instead; pan still works on
middle/right. Unit tests for the containment/touch predicates per entity
kind. Full `npm run test:all` per commit; screenshots (23+) that carry their
own evidence — both box styles mid-drag with their results in the log; look
at them. Docs duties per `CLAUDE.md`, including the register edit in
`TODO.md`.

## Delivery

PR workflow: isolated worktree, branch `claude/box-select` off the tip of
`claude/resume-tasks-o7q02e`, PR against the working branch. Do not merge;
the supervising session reviews.
