# Plan: 3D phase 5 — revolve

**Status: in flight** (2026-10-13). Final package of the owner's original
ask ("extrude, revolve etc"); fifth of [`3d-roadmap.md`](3d-roadmap.md).
Read the roadmap, `CLAUDE.md`, `docs/ARCHITECTURE.md`, and above all
`docs/plans/3d-phase4-extrude.md` plus `src/faces.ts` and the feature
machinery in `src/model.ts`/`operations.ts` — revolve is extrude's
sibling and must feel like one package wrote them.

## Where revolve differs from extrude, and why

Extrude's expansion is finite: a twin per vertex. A revolve's sweep is
not — there is no finite set of entities that IS a surface of revolution.
The roadmap settled this: **the profile stays fully constrainable live
geometry; the swept surface is display, derived parametrically every
frame** (exactly as extrude's faces already are — `faces.ts` recomputes
from live geometry; revolve just derives more).

What *is* real and solver-held:
- the profile (whatever loop the user revolves — unchanged, theirs);
- the **axis**: an axis reference (`"f1.x"` syntax — the machinery
  exists) or a line name; read as a datum either way (a revolve must
  never push its own axis);
- the **angle**: one `d`-named `revolution` dimension (join
  `DIMENSION_OPS`, `REBUILD`, the whole set-machinery — radians stored,
  degrees on the label, the documented seam, same as `ang`);
- for a full 360° nothing else; for a partial revolve, **end-profile
  twins**: the profile's points copied and held at the swept angle about
  the axis by the revolution dimension's blocks (rotation about an
  axis-datum is a closed form in the residual — components, never a
  norm-square), so the end face is real, constrainable geometry and
  `set("dN.value", θ)` swings it. A full revolve that is later `set` to a
  partial angle: decide honestly — recommendation: the angle is given at
  creation (`revolve(member, axisRef, angle?)`, default 2π) and a full
  revolve creates no twins; changing a full revolve to partial is a new
  feature, not a `set` (document it; a `set` on a full revolve's
  dimension throws with that explanation).

## Design

- `revolve(member, axis, angle?)` — operation, `asOperation`, journal
  carries the resolved profile exactly as extrude's does (same measured
  reason) and the resolved axis reference. The loop must be coplanar with
  the axis's direction lying IN the profile's plane (a revolve about an
  axis out of plane is not a solid of revolution — throw, name the
  geometry), and the profile must sit on one side of the axis (crossing
  it self-intersects — throw; touching it is allowed and closes the
  surface on the axis, the classic sphere/cone case).
- Feature record in the same `e` registry: profile members, axis ref,
  angle dimension, end-twin names when partial.
- **Display** (`faces.ts` grows a sibling deriver): sweep each profile
  member around the axis in angular steps matched to the drawing
  resolution (`arcSegments`' spirit — steps from the swept radius so
  close-in geometry doesn't facet); wall strips per step; caps only for
  partial revolves (the two profile faces — even-odd, holes ride along
  as in extrude); the same painter's/culling/headlight pipeline. A
  revolved circle (torus) works by construction — test it renders and
  sorts sanely at one orbit angle rather than chasing perfection;
  interpenetration limits inherit extrude's documented ones.
- **Tool**: `arm("revolve", {angle})`, click inside a region
  (`regionAt`), then one click on a line or an axis-bearing frame arm to
  pick the axis (two-click gesture, fillet's shape); refusals via
  `ctx.log`. Command and tool both return the feature name.
- `del("eN")` cascade, hover `· eN`, `ls()`, persistence, double-save
  byte-identity with a set-and-delete history: all exactly extrude's
  contracts — the test matrix transfers nearly verbatim; reuse its
  helpers rather than copying them.

## Verification

Unit: the throws (axis out of plane, profile crossing the axis, set on a
full revolve); partial-revolve end twins at closed-form rotated positions
against a tilted frame's axis; `set` swings the end face exactly and
moves nothing else (fully defined profile, extrude's lesson); touching-
the-axis profiles close on the axis; journal round-trips; deletion both
directions. E2e: revolve a filleted profile 270° about a frame axis on a
tilted plane via the tool, orbit — the poster: extrude's plate joined by
a revolved solid in one scene; `set` the angle live; undo in one step;
save/open. LOOK at every screenshot; revolve shading at grazing angles is
exactly where sorting lies. Full `npm run test:all` per commit. Docs per
`CLAUDE.md`; roadmap phase 5 marked; the owner's original sentence
("extrude, revolve etc") quoted closed in the CHANGELOG entry.

## Delivery

Isolated worktree, branch `claude/3d-phase5-revolve` off the
working-branch tip, one PR against `claude/resume-tasks-o7q02e` (two if
it outgrows one hand — extrude's split is the precedent; say which). Do
not merge; the supervising session reviews.
