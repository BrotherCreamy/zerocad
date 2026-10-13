# Plan: 3D phase 4 — extrude

**Status: in flight** (2026-10-13). Fourth package of
[`3d-roadmap.md`](3d-roadmap.md), and the owner's headline feature. Read
the roadmap, `CLAUDE.md`, `docs/ARCHITECTURE.md`, `src/loops.ts` (phase 3
— your input), `src/operations.ts` (fillet is the operation precedent;
`set`/REBUILD is the dimension-editing machinery), and the register's 3D
entry including phase 3's two parked policy lines (crossing edges report
no loops; a T splits nothing) and the face-on arc-snap question — none of
which this package reopens; extrude consumes loops exactly as phase 3
reports them.

## The design, in one sentence

`extrude` is an **operation** that expands a closed loop into real twin
geometry — a copy of the loop's members on a parallel plane, wall edges
joining the corners — held there by **one depth dimension**, so
`set("dN.value", 40)` re-solves the solid like any other dimension; the
*faces* exist only as a display record derived from live geometry.

## Design

### The expansion (journal-as-the-call, fillet's pattern)

`extrude(member, depth?)` — `member` names any line/arc/circle; the loop
containing it is resolved by `findLoops` (throw with a helpful message
when it is in no loop or in more than one; name the loops' members in the
error). `depth` seeds (free-entities rule: a seed, not a constraint;
default `Model.DEFAULT_RADIUS`). The expansion, all inside
`asOperation("extrude", …)`:

- For each loop vertex, a **twin point** seeded at base + depth·normal.
  For each member, a **twin member** (line between twin endpoints; an
  arc/circle gets its twin on a twin frame — create one frame for the top
  plane per extrude, origin/x-ref/y-ref twinned from the loop's plane
  frame, so planar entities on the top cap mean what they say).
- **Wall edges**: one line per loop vertex joining base point to twin.
- **One dimension** holding the whole lid: a new dimension op
  `extrusion(pairs…, frame, depth)` (decide the real signature; it is
  created inside the expansion so it journals nothing itself) whose blocks
  say, for every base/twin pair, twin = base + depth·(frame's +z), frame
  read as datum. It is ONE relation with many blocks so it carries ONE
  `d` name and `set()` rebuilds it — **add its REBUILD entry** in
  `operations.ts` or `set` on it throws; test that `set` on an extrusion
  depth moves the whole lid and nothing else. Blocks must not be
  squares; twin−base−d·uz has three linear components, use them.
- **The feature record**: a new `features` registry on the model
  (`e1, e2, …`, claimName like everything else), holding the base loop's
  member names, the twins, the wall names, the frame, the depth
  dimension's name, and the hole structure (children loops get twins and
  walls too — see holes). Features list in `ls()`, delete by `del("e1")`
  with a cascade that removes twins, walls, the dimension and the record
  but NEVER the base sketch (Onshape: deleting the extrude keeps the
  sketch); deleting any member entity of the feature takes the feature
  record with it (inward reference rule). Persistence: the journal carries
  the `extrude` call; re-expansion rebuilds the registry — verify a
  byte-identical double-save with an extrude plus a later `set` plus a
  deletion in history. VERSION bump only if the file shape actually
  changes beyond new ops (your call; justify it).

### Holes

A loop with children extrudes **with** its holes: children get twins and
walls exactly like the outer loop; the caps are drawn with canvas
**even-odd fill** (outer contour + hole contours in one path — no
triangulation needed for display). A child with its own children (an
island inside a hole) extrudes as solid inside the hole — the even-odd
rule gets this right for free; test it.

### Display

- Faces: two caps (even-odd paths in their planes) and one wall quad per
  loop member pair (a wall along an arc is a ruled strip — sample it with
  `arcSegments`, same resolution as drawing).
- **Painter's goes per-face** for faces (the roadmap's promised upgrade):
  sort faces by camera depth at their centroid; entities (edges, points,
  glyphs) still draw after faces so the sketch stays legible on top.
  Flat shading: one fill per face from a headlight lambert (light along
  the camera's view direction — no world light, for the obvious reason),
  on the existing palette's surface tones; keep it dim enough that edges
  and dimension labels stay the foreground. Faces never pick, snap, box
  or glyph in this package — the entities do, as today; say so.
- The twins and walls ARE ordinary entities: draggable, constrainable,
  dimensionable. That is the one-model payoff — state it in the CHANGELOG
  with a demo (constrain a wall edge's top to something and `set` the
  depth; the solver negotiates).

### Surface

- Command: `extrude("l1", 20)` → returns the feature name.
- Tool: `arm("extrude", {depth})` — one click **inside** a region
  (`loopAt`) commits; the preview between hover and click outlines the
  loop under the cursor (members highlighted, the loops machinery gives
  them to you). Refusals through `ctx.log` (no loop under the click).
  This is the first click-inside behaviour in the app; it lives in the
  tool only — idle clicks stay exactly as they are.
- Context menu inside a region: too clever for v1 — menu stays as is.
- `help()`, hover tag for features where reachable (`e1  extrude of
  loop(l1…) depth d9`).

## Verification

Unit: expansion counts (points/lines/frames/dimension/feature) for a
rectangle loop, a filleted loop (arc twin on the twin frame), a circle
(tube: two circles + how many walls? decide — a circle has no vertices;
the honest wall for a tube is NONE in entity terms, walls are display-only
for circles — document), a loop with a hole; `set` on the depth moves the
lid exactly (closed form) and the base not at all; deleting the feature
keeps the sketch, deleting a base member takes the feature; journal
round-trips byte-identical including set-then-delete history; the error
cases (no loop, ambiguous member, crossing-edge group). E2e: draw a
filleted rectangle with an island hole on a tilted frame, extrude via the
tool's click-inside, orbit — the poster: a shaded solid with a hole, its
sketch visible on the cap, dimension labels legible; `set` the depth from
the command line and watch the lid move; undo removes the whole feature
in one step; save/open round-trip of the solid. LOOK at every screenshot
— shading bugs are exactly the class the house rule exists for. Full
`npm run test:all` per commit. Docs duties per `CLAUDE.md`; the register
gains this package's entries; roadmap phase 4 marked.

## Delivery

Isolated worktree, branch `claude/3d-phase4-extrude` off the
working-branch tip. **Two PRs if it grows past one hand** (expansion +
model/persist first, display + tool second) — your call, say which and
why. Do not merge; the supervising session reviews.
