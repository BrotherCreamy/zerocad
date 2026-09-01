# Plan: dragging an edge or a rim

**Status: shipped, pending review.** Built as specified. Two things the spec
left open, both decided in the build and recorded in `CONVERSATION_LOG.md`:
single-point drags moved to the same offset form rather than keeping a second
code path (so a point grabbed off-centre no longer jumps to the cursor), and a
press that lands on a **constraint glyph** still pans — it is now the only
left-drag that does, the alternative being a press that does nothing visible at
all.

The one leftover from the old mouse map: a left-drag that starts on an edge,
a rim or an arc still pans. Onshape drags the geometry. The register's mouse
entry already reads "left-drag on any other geometry pans" only because
nothing better existed; this package retires that clause. After it, with
nothing armed: a point drags, empty canvas box-selects, and **any other
geometry drags too**. Panning keeps middle-drag, right-drag and `pan()` —
the same argument the box-select package already made, finished.

Read `CLAUDE.md`, then `docs/ARCHITECTURE.md`, then `docs/plans/`'s
`kinematic-drag.md` and `box-select.md` — this package composes the two.

## Design

**Dragging an edge is dragging both its endpoints by the same offset.** The
kinematic machinery already exists (`Problem.solve({extra})`, the soft-pull
blocks the point drag uses, weight and all). An edge drag adds one soft pull
per endpoint, each pulling toward `endpoint's grab-time position + (cursor −
grab point)`, so the edge translates rigidly *as a target* while every
constraint still gets its say — exactly how Onshape feels: drag an edge of a
constrained rectangle and the whole rectangle follows; drag one held by a
`fix` and it strains toward the cursor without breaking anything.

- **A circle's rim drags its centre** (one pull). A radius is not changed by
  dragging the rim — that is what the centre-out `circle` tool and `rad` are
  for, and Onshape agrees: dragging a circle moves it.
- **An arc's rim drags centre, start and end** (three pulls, same offset).
- Grab-time positions are captured once at press, like the point drag's —
  the geometry moves under the cursor from then on.
- Settling, cancel, undo bracketing: identical to the point drag. One drag =
  one user action = one undo step, Escape settles the same way release does.
  The existing `engine.cancel()` path must keep working unchanged.
- Hit test at press decides: point beats edge (existing pick tiers already
  say so); a press on a glyph still grabs nothing and starts nothing.

## What this deliberately does not do

- **No vertex-drag-through-edge**: pressing within the point tolerance of an
  endpoint drags the point, as today. The tiers already encode this.
- **No rigid rotation.** Translation only; the solver resolves the rest.
- Box select, pan bindings, wheel zoom: untouched. The box-select e2e suite
  is the regression net for "a press on geometry is not a box".

## Verification

Unit (engine): an edge drag moves both endpoints of a free line by the drag
offset; a drag of an edge with a `fix`ed endpoint strains and settles legally
(endpoint stays fixed, the free end follows); a rim drag translates a free
circle without changing its radius (pin to 1e-6); cancel mid-drag settles and
is one undo step; a press on an edge that never moves is still a pick.
E2e: drag an edge of the constrained rectangle and the rectangle follows
(hor/ver/dist all still hold after settle, SOLVED); drag a free circle by its
rim and its centre lands where the offset says, radius unchanged; the
box-select and pan suites still pass untouched. Screenshots at the next free
`docs/images/` numbers, carrying their own evidence (before/during/after,
`rels()` in frame where it earns its place). Full `npm run test:all` per
commit. Docs duties per `CLAUDE.md`; the register's mouse entry gets the
final wording and this package's note.

## Delivery

Isolated worktree, branch `claude/edge-drag` off the working-branch tip, PR
against `claude/resume-tasks-o7q02e`. Do not merge; the supervising session
reviews. Expected footprint: `src/tools/engine.ts`, tests, docs — nothing
else. If you find yourself editing `replenv.ts`, `main.ts` or `tools/*.ts`,
stop and say why in the PR instead: two sibling packages are in flight in
those files.
