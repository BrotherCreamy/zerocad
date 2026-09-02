# Plan: the 3-point arc tool

**Status: shipped, pending review** (2026-09-02). Built as specified on
`claude/arc3-tool`, with no deviation from the design below — the spec was
written by the implementing session, so it had no chance to be wrong in the
usual way, and what that costs is noted in `CONVERSATION_LOG.md`. One thing
the writing changed: the second-click-on-the-first refusal and the extraction
of `circumcircle` into its own module were both decided while specifying, not
while coding. What was decided and discovered is in `TODO.md`'s Done entry;
the behaviour is in `STATUS.md`.

The sibling `docs/plans/circle3-tool.md` promised and the register has been
asking for since the arc tool shipped: Onshape's *3 point arc* as a pointer
tool. Three clicks — **the two endpoints first, then a point the arc passes
through** — and an arc whose endpoints are real, snappable, constrainable
points.

Read `CLAUDE.md`, then `docs/ARCHITECTURE.md`, then `src/tools/circle3.ts`
(the pattern, closed form and refusal), `src/tools/arc.ts` (how an arc is
built and why `arcEndpoints` has to be applied by hand) and
`src/tools/place.ts` (what a click is allowed to infer).

## Design

- `arm("arc3")` — Onshape calls it *3 point arc*; `arc3` is the name that is
  also a legal identifier, exactly as `circle3` was. New file
  `src/tools/arc3.ts`, `defineTool` in-file plus the one import line in
  `main.ts`.
- **Click order is Onshape's: end, end, waypoint.** The first two clicks are
  the arc's endpoints; the third says which of the two arcs between them was
  meant. This is worth stating because it is the opposite of the natural
  guess (start, waypoint, end) and the opposite of the *center point arc*
  already in the box, whose first click is the centre.
- **The two endpoint clicks place real points** through `placePoint`, so
  snapping and inference apply to both: click a corner and the arc's end is
  coincident with it; click an edge and it stays on that edge. That is what
  makes "an arc from this corner to that one" three clicks and no special
  case.
- **The third click places nothing.** In Onshape the waypoint is not kept as
  geometry, and it should not be kept here either: a stray point the user
  never asked for and has to delete is worse than the freedom it would buy.
  Its whole job is to *choose* — which of the two arcs, and where the centre
  and radius start from.
- After the third click: one `addArc(start, end, r)` with its **centre
  auto-created** (free-entities conventions — `null` centre, a real named
  point made for it), `setCoords` on that centre to the circumcentre of the
  three clicks, the radius seeded at the circumradius, one `arcEndpoints`,
  one solve, `ctx.finish()`. No new journal op: `addArc`, `setCoords` and
  `arcEndpoints` are all already in `persist.ts`'s replay table, which is the
  evidence that this is a composition rather than a new kind of thing.
- **`arcEndpoints` is not optional.** An arc's endpoints lying on its own
  circle is a relation in this model, not a constructor fact (`model.ts` says
  so at `ArcEntity`); the centre-point arc tool applies it and so does this
  one. Without it the seeded numbers would be all that holds the arc
  together, and the first drag would tear it apart.
- **Sweep direction.** `main.ts` draws an arc counter-clockwise in world
  space from `start` to `end`, and `intersect.ts`'s `withinSweep` is the one
  definition of what is on it. So the two endpoint clicks are assigned to
  `start` and `end` in whichever order puts the *waypoint inside the CCW
  sweep*: with `O` the circumcentre and world angles `θ`, keep the click
  order when `ccw(θa → θw) < ccw(θa → θb)` and swap it otherwise. Both
  clicks are endpoints either way, so nothing about the user's gesture is
  lost by the swap; only the label is.
- **What pins the arc through the third click: nothing, deliberately.**
  After the commit the arc has seven degrees of freedom (two endpoints, a
  centre, a radius) and two equations, so the *bulge* is free — drag an
  endpoint and the arc follows, keeping roughly the curvature it was drawn
  with, but nothing holds it to the waypoint. That is the same bargain the
  centre-point arc tool already strikes, and it is the register's standing
  rule: **tools do not dimension what they draw**. The alternative — keeping
  the waypoint as a third point with an `onCircle`, which is precisely what
  `circle3` does — was rejected twice over: it contradicts Onshape's own
  behaviour, and it leaves a point in the drawing that the user did not ask
  for and would have to clean up by hand — the fillet's reason for reusing
  its shared corner rather than stranding it. A user who wants the bulge
  held can say `rad(a1, …)` or drop a point on the rim; that is the same
  answer the whole toolset gives.
- **The whole gesture is one user action.** Nothing is created before the
  third click, so the engine's bracket around that one pointer event makes
  arc, endpoints, centre and relation one Ctrl+Z, exactly as `rectangle` and
  `circle3` do. No engine change.
- Live preview: after two clicks, the dashed arc through the two placed
  points and the cursor, drawn with the same start/end choice the commit
  would make — so what is on the screen is the arc the next click builds,
  including which side it bulges to. Nothing when the three are collinear or
  the rim is absurdly far away; a preview that lies is worse than none.
- Refusals, both advisory (`ctx.log`, gesture stays live — `circle3`'s
  shape):
  - a **collinear** third click: the "arc" through three points on a line is
    that line, so there is nothing to build.
  - a **second click on top of the first**: an arc needs two different
    endpoints, and the click was almost certainly a double-click. Swallowed
    silently rather than logged, the way the centre-point arc tool already
    swallows a zero-radius second click.

## The one shared piece

`circumcircle` and its `COLLINEAR_EPS` move out of `circle3.ts` into
`src/tools/circumcircle.ts` — unchanged, and still plain numbers in and out
with no idea which space it is being asked about. Two tools now need the same
closed form and the same collinearity threshold, and two copies of a
scale-free epsilon is exactly the sort of thing that drifts. The new file
registers no tool, so importing it has no side effect; `place.ts` is the
precedent for a helper module living under `tools/`.

## Verification

Unit: the start/end choice puts the waypoint inside the sweep — asserted
against `withinSweep`/`screenAngle` themselves, so the tool's world-space
decision is tied to the codebase's one screen-space definition of "on the
arc", not to a second opinion; both click orders and both bulge sides; the
journal is exactly `addPoint, addPoint, addArc, setCoords, arcEndpoints` and
survives save/open byte for byte; the arc is seeded exactly at the
circumcircle; the collinear refusal keeps the gesture live and reaches
`ctx.log`; a snapped endpoint click infers its coincidence; cancel forgets;
2D-only.

E2e: three clicks on empty canvas draw an arc whose centre and radius are the
independently-computed circumcircle of the two placed endpoints and the
clicked waypoint, and whose sweep contains that waypoint; the dashed preview
is genuinely on the screen after two clicks, on the waypoint's side; the
whole gesture is one Ctrl+Z; an endpoint clicked on an existing corner picks
up the coincidence in `rels()`; a collinear third click refuses in the log
pane with nothing thrown at the page. Screenshots at the next free
`docs/images` numbers (41, 42).

Full `npm run test:all` before each commit. Docs duties per `CLAUDE.md`: tick
the queue entry, correct the register's "No 3-point arc yet", `CHANGELOG.md`
at the top, `STATUS.md`, and `CONVERSATION_LOG.md` for the waypoint decision
above, which is the one a reader would otherwise have to reconstruct.

## Delivery

Branch `claude/arc3-tool` off the working-branch tip, PR against
`claude/resume-tasks-o7q02e`. Do not merge. Expected footprint:
`src/tools/arc3.ts` (new), `src/tools/circumcircle.ts` (moved out of
`circle3.ts`), the one import line in `src/main.ts`, tests, docs. Nothing in
`engine.ts`, `replenv.ts`, `persist.ts` or `operations.ts` — if that changes,
say why in the PR instead.
