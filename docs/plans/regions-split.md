# Plan: regions under crossings and T-junctions

**Status: queued** (2026-10-21), two PRs. Second of the register's "Next up"
queue, and the one ⚠ deviation from Onshape in the loop policy: *"Onshape
splits regions at every intersection; this model only knows what it was
told."* The owner's standing rule — tools work like Onshape — decides it:
**a crossing and a T split regions.** Read `CLAUDE.md`, `docs/ARCHITECTURE.md`,
`docs/plans/3d-phase3-loops.md` and `3d-phase4-extrude.md`, `src/loops.ts`
end to end, `src/faces.ts` (`loopOutlines` and the cap/wall derivation),
`src/tools/region.ts`, `src/operations.ts` (`extrude`, `revolve`,
`profileOf`, `regionOf`, `planExtrude`, the expansion and the deletion
rules), `src/persist.ts` (`VERSION`, the replay table), and the register's 3D
entries in `TODO.md`.

## What stays true, and what changes

`loops.ts`'s honesty line — **joined means held, never near** — stands. What
changes is the reading of two cases the line was applied to too bluntly:

- **A T is held.** An end held on an edge by `on` (a point held on a line; for
  an arc or circle, `oncircle` where it applies — read `relations/geometry.ts`
  and say which relations place a point on which curves) is not proximity: a
  relation holds it there, and the next drag cannot pull it off. So the edge
  is **split at that point** for loop purposes, into the pieces either side.
  Chains through `coin` count, exactly as joins do.
- **A crossing is geometry, not a join** — nothing holds it. But the *regions*
  of a drawing are a question asked of its geometry as it stands (so is
  `loopAt`), and a crossing bounds regions just as Onshape says. So for
  **finding** regions, two coplanar edges that cross are split at a **virtual
  vertex** — a vertex that is no entity, named by the two edges that make it.
  The old rule "a component whose edges cross yields no loops" is retired.
  Where a crossing has to become something *held* — a feature's profile — it
  is **materialised**: a real point held `on` both edges, which is the clause
  idiom `pt(on(_, "l1"), on(_, "l2"))` made by the operation (PR 2).

## PR 1 — `loops.ts` sees Ts and crossings (pure, plus the region preview)

- **A member walks a portion of its entity.** `LoopMember` says which: from
  which vertex to which, and (for the arithmetic — area, winding, outline) the
  parameter span on the entity. A vertex is a point entity's name, or a
  crossing's key — a string that can never be an entity name (the model
  reserves the dot for axis refs; choose a spelling such as `l1×l2`, document
  it, and make `describeLoop` print it legibly). `from`/`to` stay strings;
  add what the portion needs rather than redesigning the type.
- **Splitting.** Per plane: every held on-point splits its edge; every pair of
  coplanar edges that cross in their interiors (line–line, line–arc, arc–arc,
  and whole circles — closed forms, no sampling; tangency and an end on the
  other edge are not crossings) splits both. Then the existing face walk runs
  on the subdivided graph unchanged in spirit: angular order at every vertex,
  minimal cycles, containment reported.
- **Expected results, as tests:** a rectangle with one line across it is two
  regions; with two crossing lines across it, four; a line through a
  rectangle's edge (a T on each side) splits it; a lens of two crossing
  circles is three regions (two crescents and the lens); a line that only
  *touches* a circle (tangent) splits nothing; two lines whose crossing lies
  beyond an end split nothing; a stray line through a region's interior that
  does not reach its boundary splits nothing (a dangling edge is dropped, as
  now). A 3D tilted plane for each. `loopAt` picks the right sub-region.
- **The region preview** (`loopOutlines` in `faces.ts`, used by
  `tools/region.ts`) draws portions, not whole members, so the extrude,
  revolve and sketch tools outline exactly the sub-region under the cursor.
  E2e: draw a rectangle with a line across it, arm `extrude`, hover each
  half, screenshot both — LOOK: the green outline must stop at the crossing.
- `loops()` lists portions legibly. Nothing in `operations.ts` changes in PR 1
  **except** that `extrude`/`revolve` must **refuse, by name, a profile with a
  portion or a virtual vertex** until PR 2 lands (a clear sentence: "this
  region is bounded by part of l1 — extruding split regions is not built
  yet"), so PR 1 cannot produce a half-built feature. Test that refusal.

## PR 2 — features over split regions

- **Materialise, then expand.** Before twins are made, every virtual vertex of
  the profile becomes a real point held `on` both edges (`oncircle` for
  curves) — made inside the feature's own `asOperation`, recorded as the
  feature's (its deletion cascade treats them as it treats twins; a
  materialised point another relation has since used is handled exactly as a
  twin in that position is — read the deletion rules and match them). A T's
  point is already real and needs nothing.
- **Twins per vertex, twin curves per portion**: a portion of a line twins to
  a line between the twins of its ends; a portion of an arc to an arc about
  the twinned centre between the twins of its ends; walls per vertex class as
  now. The base cap, the lid and the walls in `faces.ts` are drawn from
  portions. A revolve's sweep and end twins likewise.
- **The journal carries the resolved profile with portions.** Today it is
  `string[][]` of member names; extend the entry so a member may carry its
  ends (`{name, from, to}`), keep bare names meaning whole members, bump
  `VERSION` to 8 with the reading rule for 7 unchanged (an old file's
  profile is whole members), double-save byte-identity as always.
- **`set` on the depth, `del` in both directions, hover `· eN`, `ls()`:**
  extrude's contracts transfer; the test matrix does too.
- E2e poster: a plate with a line across its sketch, each half extruded to a
  different depth — a stepped block from one sketch, the Onshape way — and a
  lens region of two crossing circles extruded. Orbit, LOOK, `set` a depth
  live, undo, save/open.

## Verification and docs

Full `npm run test:all` per commit. Docs per `CLAUDE.md`: CHANGELOG at the
top for each PR; the register's ⚠ loop-policy entry rewritten to the new
rule (keep the "joined means held" sentence and say how crossings fit it);
the queue item ticked after PR 2; STATUS; `docs/ARCHITECTURE.md`'s loops
section; this file's status per PR; `loops.ts`'s header rewritten — it is the
design record of the policy and must not describe the old one.

## Delivery

Isolated worktree, branch `claude/regions-split-1` (then `-2`) off the
working-branch tip, one PR each against `claude/resume-tasks-o7q02e`. Do not
merge; the supervising session reviews. PR 2 starts only after PR 1 merges.
