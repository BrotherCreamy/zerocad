# Plan: regions under crossings and T-junctions

**Status: both PRs built.** PR 1 (2026-10-21, branch
`claude/regions-split-1`; see "PR 1 as built" below for what differs from this
text); PR 2 (2026-10-22, branch `claude/regions-split-2`; see "PR 2 as built").
Two PRs. Second of the register's "Next up"
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
  crossing's key — a string that can never be an entity name (choose a
  spelling such as `l1×l2`, document it, and make `describeLoop` print it
  legibly). `from`/`to` stay strings; add what the portion needs rather than
  redesigning the type. *Corrected while building:* this said "the model
  reserves the dot for axis refs" as though that kept `l1×l2` from being a
  name. It does not — only the dot is reserved, and `×` is a legal name
  character. Since nothing in `model.ts` changes in PR 1, the guarantee is
  made where the key is: a key that is already a name gets a prime (′) until
  it is not, so a vertex is a crossing exactly when the model has no point by
  that name.
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

### PR 1 as built (2026-10-21)

Everything above, with these differences — each is also in `TODO.md`'s
register and the PR:

- **The key** is `l1×l5`: the edges through the crossing in creation order,
  `×`-joined, numbered `#1`, `#2` along the first-named edge when the same
  edges cross more than once (`c1×c2#1`), primed past any existing name (see
  the correction above). Crossings at one spot are one vertex named by all of
  them (`l5×l6×l7`); a crossing within tolerance of a held point *is* that
  point (a crossing already materialised by `pt(on(_, "l1"), on(_, "l2"))`).
- **`LoopMember.span`**: `[start, end]` as fractions of the entity in its own
  direction (a circle from its frame's +x; the end past 1 across its seam),
  null for the whole entity — whichever way the loop walks it.
- **A member is as long as the loop allows** — not in the text above.
  Consecutive parts of one entity walked the same way are one member, so a cut
  that is no corner of the loop (a free point held on an edge, a T whose stem
  goes nowhere, a stub poking out through one edge) is not listed and the loop
  is whole members. Without it, any such cut would have made a plain
  rectangle "split", and extrude would have refused it.
- **Which relations hold a point on which curves:** `on` (`pointOnLine`) on a
  line, `oncircle` (`onCircle`) on an arc or circle — and the **line form of
  `mid`** (`midpoint(m, l)`), which a midpoint snap infers; the spec named
  only the first two. Each cuts only *within* its edge. The point-pair `mid`
  and `tan` cut nothing; `arcends` are an arc's own ends.
- **`loops()` and the hover key label a portion in its entity's own
  direction** (`l3[l3×l5→p4]`), not as walked: two vertices on a circle bound
  two arcs of it, and the crescents either side of a lens run between the same
  two crossings — as walked, their labels tied and the hover did not redraw.
- **Tangency is a distance**: a curve within the length tolerance of touching
  is tangent. The old test (roots closer than the tolerance) would have read a
  solved tangency, whose roots are √(2rδ) apart, as a crossing. Two lines
  cross only when each one's ends straddle the other by more than the
  tolerance, so lines lying along each other never do.
- **Planes from crossing lines**: three lines that only cross one another
  bound a triangle with no joined corner, so a pair of crossing lines is now a
  candidate plane too. The pair searches are swept and boxed — they run on
  every hover (measured in the PR: 3.6 ms on 400 coplanar lines, 2.8 before).
- **`sketchface.ts` changed** (the spec did not mention it): a crossing is a
  vertex but no point, so the corner search skips it and falls back to the
  parted entities' own ends; a region bounded by parts of circles alone (a
  lens) takes a circle's frame, as a whole circle does.
- **The refusal** lives in `profileOf`, which `extrude(member)`, `revolve(member)`
  and all three tools pass through; it reads *"this region is bounded by part
  of l1 (from l1×l5 to p5) — extruding split regions is not built yet. …"*. A
  journal's handed-over profile (names only) is never split, and is not
  refused.
- **Two older tests drew a line through a profile as a revolve axis**; such a
  line now splits the profile. The unit test moved that case to its own model
  (refused as split; handed over whole, still refused for crossing the axis),
  and the tool test's refused axis now leans out of the plane instead.

## PR 2 — features over split regions

*Found while building PR 1, for whoever builds this:*

- **A crossing's key is not stable** — it is named by position along the
  first edge, and a drag can change how many crossings there are. Never
  journal a key: materialise at the call, journal the real points.
- **A span is a snapshot**, and `loopOutlines` re-reads the live entity over
  it; good for a preview, wrong for a cap. Caps over portions must be drawn
  between the materialised points (or the T's own), as twins are.
- **A T that is no corner of a loop is not in its members** (members are as
  long as the loop allows). Extruding the region on one side of a T alone is
  then whole members; extruding both sides is where the T matters.
- **Remove the refusal** in `profileOf` (and its tests in `extrude.test.ts`,
  `revolve.test.ts`, `faces.test.ts` and `test/e2e/regions.e2e.ts`, which say
  "not built yet").

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

### PR 2 as built (2026-10-22)

Everything above, in one PR whose code is one commit (the display half turned
out to be one function in `faces.ts`, too small to stand alone), with these
differences — each also in `TODO.md`'s queue entry and the PR:

- **The journal's `{name, from, to}` runs in the entity's own direction**
  (a line from its first point, an arc from its start, a circle
  counter-clockwise about its frame's +z) — `memberLabel`'s order. The spec
  did not say; as walked, two points on a circle would not say which of its
  two arcs is meant. The walk order is read off the joins, as for a whole
  member.
- **The entry names points its own body made, so it is read after the body.**
  `Model.asOperation` now takes its arguments as an array or a function; the
  extrude and revolve pass a function. Not in the spec, which said "journal the
  real points" without noticing that their names do not exist until the body
  has claimed them.
- **A replay that meets a vertex the model has no point by makes it under that
  name**, held on the edges that meet there — the rule loops.ts reads a vertex
  by (`isVirtual`), carried into the file — seeded where the edges' lines come
  closest (lines) or between their first points (curves): a placeholder the
  saved values replace, as they replace every twin's seed. A vertex spelled
  with `×` that is no point is refused at the door, so no key can be kept by
  hand either.
- **A materialised point is held on every edge the profile bounds there**, not
  only "both": three lines through one spot can put a different pair of edges
  at the corner in two loops of one region. Usually that is two.
- **The new entry point `extrudeProfile`** (the tool's door, as
  `revolveProfile` already was): a found `Profile` carries `crossings`, where
  each key is now, which the journal never sees.
- **The record names a portion's pre-existing end points** (a T's point, or a
  crossing another feature made), so deleting one takes the record and a
  record never names a point that is gone.
- **One entity may be in a profile as several portions** — a band across a
  circle runs along two arcs of it — so the given-profile check refuses only a
  whole member twice, a portion twice, or a whole member beside a part of it.
- **A whole-turn revolve materialises too**: its surface is swept between the
  profile's points every frame, and a portion needs real ends to be swept
  between.
- **`checkRevolve` measures a portion over its own part**, from where its ends
  are (a crossing's where `profileOf` found it): the half of a rectangle cut by
  a line only touches that line, though the edges it is cut from run on across,
  and revolves about it. PR 1's test of that case now asserts the revolve.
- **The lid needed nothing**: its twins are whole lines and arcs between twin
  points; only the base cap and the walls and sweeps that pair with it are
  drawn from portions (`portionPath`, ends pinned to the points themselves).
- **A version-7 file holding a portion is refused at its step** — the spec said
  only that version 7 reads as before, which it does; a 7 with a portion in it
  is a hand edit, and is told so rather than read as 8.
- **The e2e poster** builds on PR 1's own e2e (`regions.e2e.ts`): the plate and
  line drawn there, each half clicked with its own depth, the lens drawn beside
  it with the circle tool. `docs/images/76-…` and `77-…`.

*Found while building, left deliberately:*

- **Deleting the first step takes the second's record**, and the second's two
  walls standing on the shared crossings — the twin rule the spec asked for,
  applied: a materialised point is the first feature's, and the second was
  built on it. Undo is the confirmation.
- **The two steps' walls along the shared line lie along each other** (each
  feature stands its own wall on each shared crossing), which loops.ts reads as
  overlap and so as no region: the riser between the steps is drawn but is no
  loop the sketch or extrude tool can choose. Onshape merges the bodies; this
  model keeps two solids.
- The two steps' coplanar faces at the shared line are painter's-sorted like
  any interpenetrating solids (see the register's display entry).

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
