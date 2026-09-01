# Plan: dragging geometry (kinematic drag)

**Status: queued.** Do not start until the inference/line-tool work from
`onshape-inference.md` is reviewed and pushed.

The defining interaction of a constraint sketcher, and the one Onshape users
reach for first: with nothing armed, grab a point and pull. The geometry
follows the cursor *while every constraint holds* — drag the free corner of a
constrained rectangle and the rectangle stays a rectangle, resizing as you
pull. cellwork proved the mechanism this plan ports; read its pointer handling
if in doubt (`/home/user/cellwork/index.html`, the `mouse.drag` path).

Read `CLAUDE.md` and `docs/ARCHITECTURE.md` first, as always.

## Mechanism

Each pointer move during a drag runs a solve with a **temporary soft pull**
added: two extra residuals `(p.x - cursor.x) * w` and `(p.y - cursor.y) * w`
with `w = 0.12` (cellwork's weight — small enough that real constraints
dominate, large enough that free geometry tracks the cursor). The pull is
never stored; on release, one final solve *without* it settles the model and
updates the status line.

### Part 1 — the kernel learns temporary residuals

`Problem.solve()` gains an option: `extra?: ResidualBlock[]`.

- Extra blocks are evaluated alongside the stored ones for every iteration of
  that solve, and are gone when it returns — nothing is added to `blocks`.
- Extra blocks are **excluded from the offender report**. A soft pull never
  reaches zero (that is what "soft" means), and it must not paint the header
  `CONFLICT` mid-drag. The stored blocks' rows come first in evaluation
  order, so the row-count boundary is a clean way to know which residuals may
  accuse.

This is an explicitly authorized change to `src/kernel/problem.ts` — the
previous plan's "stay out of the kernel" rule does not apply here, because
this is a legitimate, geometry-free extension of the least-squares surface:
"solve, with these additional residuals, once". Nothing about points or
cursors goes in that file. If you find geometry creeping in, stop.

Unit tests: a pull moves an otherwise-free variable toward the target; the
same `Problem` solved again without extras is unaffected (nothing was
stored); a deliberately unsatisfiable pull does not appear in `offenders`;
a pull fighting a real constraint loses (constraint holds to tolerance,
pulled point lands on the constraint surface nearest the target).

### Part 2 — the engine drags

In the idle path (`src/tools/engine.ts`, no tool armed), a left press that
hit-tests to a **point** (tier 1 only, v1) becomes a *potential* drag instead
of a potential pan:

- Move beyond the existing 3px threshold → kinematic drag. Each move: solve
  with the pull toward the cursor's world position, then render. Direct
  `model.problem.solve({ extra })` + `onRenderOnly()` for the intermediate
  frames — the status line deliberately does not churn mid-drag.
- Release after dragging → one ordinary solve through the host's solve path
  (`onSolveRender`), so the status line shows the settled truth.
- Release *without* crossing the threshold → exactly today's click: the
  point's name drops into the command line. Nothing about picking changes.
- A press on a line/circle/arc or empty space → exactly today's behaviour
  (pan on move, pick on click). Dragging edges is real in Onshape and is a
  follow-up, not this.

Hover stays suppressed during the drag, and no snapping applies to a drag in
v1 (Onshape does infer while dragging; deliberately deferred — note it in the
docs as a known difference).

A `fix`ed point needs no special casing: the pull (w=0.12) loses to the fix
residuals (w=1) and the point effectively stays put, which is the right
behaviour and falls out of the mathematics.

## What this deliberately does not include

- No journal entries. A drag changes *values*, not structure; saved files
  already carry solved coordinates, so save-after-drag round-trips. Test it.
- No undo. Nothing has undo yet; it is next in the queue after this and the
  docs should say a drag is only undone by dragging back, for now.
- No edge/circle dragging, no inference during drag — both noted follow-ups.

## Verification

The e2e that defines done: draw a rectangle (its edges carry `hor`/`ver`),
`fix` one corner from the command line, then mouse-drag the opposite corner
50px and release. Every edge must still be exactly horizontal or vertical,
the fixed corner must not have moved, the dragged corner must have moved
substantially toward where the cursor went, and the status must read SOLVED.
Also: drag a point that has a `dist` to a fixed point — after release the
distance is exact and the angle changed. And the no-movement release still
inserts the name (regression on picking).

Full `npm run test:all` green before each commit, docs duties per
`CLAUDE.md` (CHANGELOG at top with a screenshot you have actually looked at,
STATUS, TODO tick, CONVERSATION_LOG reasoning entry).

Two commits: (1) kernel extras + unit tests; (2) engine drag + e2e + docs.
Commit locally, do not push — the supervising session reviews and pushes.
