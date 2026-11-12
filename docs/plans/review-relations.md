# Plan: many-at-once is one relation among equals, and a dimension names what it measures

**Status: built** (2026-11-12, branch `claude/review-relations`, PR against
`claude/resume-tasks-o7q02e`; what was found, what was built and every
deviation are under *As built* at the end). Queued 2026-11-12: review items 5
and 6 of TODO.md's register
(*Reviewed against the owner's principle*, 2026-11-09). The owner: *"All
good."* The principle: *"correct relationships BETWEEN entities …
bidirectional relationships everywhere by default"*; nothing privileged,
nothing consumed.

Read `CLAUDE.md`, `docs/ARCHITECTURE.md`, `docs/plans/relations-complete.md`
(#82: many-at-once as a star, and why), `smart-dimension.md` (#84: `fdist`,
`ang3`, faces named `e1.m3`), `click-on-face.md` (#89: `onplane(p,
"e1.m3")`), `constraints-palette.md`, `src/dimensioning.ts`,
`src/relations/solidref.ts`, `src/modules/*.ts`, `src/persist.ts`.

## 5. Many-at-once is one n-ary relation

**True today**: four lines picked and Parallel pressed makes `par(l1, l2)`,
`par(l1, l3)`, `par(l1, l4)` — a star on the first pick. The first pick is
privileged: delete `l1` and the other three are no longer related at all.

**Design**: one relation, `par("l1", "l2", "l3", "l4")`, for every relation
many-at-once offers (Parallel, Equal, Collinear, Coincident, Concentric,
Coradial, Tangent chains where it applies — take the list from
`dimensioning.ts`). No member is first in any way a user can observe:
- one name, one row in the palette, a glyph on each member;
- deleting a member leaves the relation over the rest, down to two; at one
  it is gone;
- adding the relation to a member of an existing group and a new entity
  joins the group (one relation, not two);
- its rows are any spanning set (n − 1 of them), re-formed when a member
  goes; which pairs is not observable and not journalled;
- a conflict names it once; an agreeing set counts it once.
A relation to a frame's axis ("Horizontal (both)") is already symmetric per
member and stays as it is. Old files' stars replay as the separate relations
they were; nothing is migrated. A new format version if the journal's form
changes; say which.

## 6. A dimension names the entities it measures, read when asked

**True today**: a wall is named by its place in the profile (`e1.m3`), so a
trim, split or fillet of the profile re-numbers what `fdist("e1.m3", …)`
and `onplane(p, "e1.m3")` mean; `ang3(corner, a, b)` for two meeting walls
names three points rather than the two lines the walls are swept from.

**Design**: a face is named by what it is swept from — the profile entity —
and resolved to the kernel's face when read: propose the written form (for
example `"e1:l2"` for the wall of line `l2`, `e1.lid` / `e1.base`
unchanged), say why, and make every relation that takes a face take it
(`fdist`, `fangle`, `onplane`, `par` to a face normal, the dimension tool's
picks, the palette's wording). The old `e1.mN` form still reads, in files
and typed, resolved once at replay to the entity then in that place, and is
re-journalled in the new form. The angle between two meeting walls is
`ang(l1, l2, θ)` of their lines measured square to the extrusion (or the
existing `ang` where that is what it already is), not `ang3` of points;
`ang3` remains for three points a user picks. A face whose source entity is
deleted takes its relations with it, said in the log.

## Tests

- Unit, 2D and 3D: n-ary of each kind solves as the star did; member
  deleted, group survives; join; old star file replays; a wall dimension
  survives a split and a trim of its profile line's neighbours; old `e1.mN`
  files reopen and re-save in the new form; save/open round trips.
- E2E, mouse and iPhone 13: four lines, Parallel, delete the first, the
  other three still parallel under a drag; a wall-to-wall dimension, then a
  trim on the profile, the dimension still on its walls. LOOK.

## Docs

CHANGELOG top; STATUS; ARCHITECTURE; the register (items 5 and 6 ticked,
decisions one line each); `help()`; the spec marked built.

## As built (2026-11-12)

### What `e1.m3` meant, and what re-numbered it

Found first, on the untouched base, and kept as a fixture
(`test/fixtures/review-relations-drift-v19.*`):

- **`e1.m3` was the wall in place 3 of `e1`'s profile**: `parseFaceName`
  (model.ts) read `{ feature: "e1", role: "member", member: 3 }`, and
  `faceSource` (relations/solidref.ts) took `members(f)[3]` — the feature's
  `loops` flattened loop by loop, the solid kernel's numbering
  (`src/solids/naming.ts`). It was read **again at every evaluation**
  (`readPlane` inside the residual's thunk), so the relation followed the
  place, not the wall.
- **What re-numbers a place**: anything that rewrites the record's `loops`
  (`rewriteFeature`, at the end of every regeneration). Measured on a
  60 × 40 block, `loops` `[l1, l2, l3, l4]`:
  - `fillet("l1", "l2", 5)` → `[l1, a1, l2, l3, l4]`. `e1.m3` was `l4`'s
    wall (x = 0) and became `l3`'s (y = 40); a point held by
    `onplane(p, "e1.m3")` was moved from x = 0 to y = 40, SOLVED. And
    `e1.m1`, `l2`'s wall, became the arc's, which is not flat — what
    `readPlane` refuses (not run to see how a solve met it).
  - `chamfer("l2", "l3", 5)` → `[l1, l2, l13, l3, l4]`: `e1.m3` is `l3`'s.
  - a line across the block and `trim("l1", [45, 0, 0])` →
    `[l1, {l13 …}, {l3 …}, l4]`: the region is the left half, `e1.m1` is the
    cutter's wall, and `l2` bounds nothing.
  - region edits (`subtract`, `add`, `hole`) add or remove whole loops,
    and members are counted loop by loop, so by the numbering they move the
    places of every loop after the one edited (read off `members`, not run).
- **Part of 6 was already true**, and is left as it was: two *parallel* walls
  of one extrude were `dist` of their lines (dimensioning.ts's `faces`), a
  round wall its circle's `dia`/`rad`, an edge its entity (`edgeSource`).
  **What held a place**: `onplane(p, face)` and `par(c, face)` (#89, every
  click on a wall), `fdist` between walls of two features, a driven
  `fangle`; and two *meeting* walls of one extrude held `ang3` of three
  points. Those are what was built.

### 6, as built

- **The written form is `e1:l2`** — feature, colon, the profile entity;
  `e1.lid`, `e1.base` unchanged (`parseFaceName`, `wallName` in model.ts). A
  colon because what follows a dot is the model's word and what follows the
  colon the user's name (an entity may be called `m3`); `claimName` refuses a
  colon. `referentsOf("e1:l2")` is `["e1", "l2"]`.
- **Resolved in one file**, relations/solidref.ts: `faceSource` (either
  form, when read; one entity bounding a region in several portions is one
  wall), `faceRef` (a place → the entity now in it: where a relation is
  made, a face picked, a file replayed), `faceKernelNames` (a name → the
  kernel's tags this build: to light it, and for `measure`'s reader).
- **Every relation that takes a face journals it by its line**: `onPlane`
  (`onFace`), `faceDistance`, `parallel`/`perpendicular` (two lines added to
  geometry.ts's `directionSides`, nothing else there touched), `measure`.
  The dimension tool's picks and the name by the hand come from the engine
  (`pickSolid`'s `written`, `landingAt`); `constraintsFor` reads a face's
  own name as a face.
- **Old `e1.mN`**: typed, it is resolved when the relation is made; in a
  file from before format 20, at the relation's own step in the replay
  (`writtenFaces` in persist.ts), and the journal installed holds the new
  form. So the drift fixture reopens with `onplane(p17, "e1:l4")`.
- **Deleting the source entity** takes the relation (the cascade already
  reads `referentsOf`), and replenv's `del` says `r9 went with l4: it was
  held to e1:l4, the wall of e1 that l4 sweeps`.

### 5, as built

- **relations/among.ts**: `among(model, op, …names)` — the seven ops of the
  register — one `model.relation` whose rows are the pair function's;
  `amongSet` reads any relation's arguments as members and what they are
  relative to. Two members, or a datum among them, is the pair relation
  untouched.
- **among.ts** (operations row): `relate` (typed: joins), `join`, `leave`
  (operations, journalled, `rebuildRelation`), `shrinkFor`/`leaveFor` (the
  deletion cascade's), `amongEntry` (a module entry's `fn` and `typed`).
- **operations.ts**: nine lines in `cascade` — a relation among many loses
  its going members and stays.
- **glyphs.ts**: a mark on each member; loops.ts, relations/spline.ts,
  sketchedit.ts read a `coin` of any size. menu.ts: *Leave r3*.
- **dimensioning.ts**: many-at-once types one call; pairs go through
  `relate`; Collinear (all n) is new.
- **Format 20** (persist.ts's `VERSION` note says all of it).

### Deviations from this spec, each in the register

1. **`corner(l1, l2, θ)`, a new dimension, for two meeting walls — not
   `ang`.** `ang` reads the angle between the lines' own directions: the
   supplement for two sides drawn head to tail (150° on the 30° wedge), and
   dependent on which way round each was drawn. `corner` reads each line out
   of the corner, so the reading is the solid's and a fillet of the corner
   leaves it standing. `ang3` stays for three picked points. An old file's
   `ang3` on a wedge replays as it was (`review-relations-wedge-v19`).
2. **The spanning set is each member with the one listed first**, not a
   chain: measured (3D collinear, three lines), the chain folds a line. The
   spec's "any spanning set … not observable" holds: nothing above the
   solver reads it.
3. **Joining includes pairs**, and is a typed relation's doing only: the
   spec's "existing group" read as any relation among equals, so that pair
   by pair builds what all at once builds. A replay never joins, which is
   what keeps "old files' stars replay as the separate relations they were".
4. **Points Horizontal/Vertical (all n) are one relation** as well (they
   were a star too); the spec's list did not name them. Lines stay one `par`
   to the axis each, as the spec says.
5. **Tangent chains do not apply**: tangency is not the same statement of
   any two members, and the list offers no many-at-once Tangent.
6. **A glyph on each member, except where the members share a place**:
   `coin`, `conc`, `corad` wear one mark at the shared point, as a pair does.
7. **The constrain tool's own face pick is still three points**
   (`"p1.p2.p3"`); `constraintsFor` reads a face's name as well. Filed.
8. **The e2e trims by typing**: the cutter line lies under the solid, where
   the shaded view neither draws nor picks it. The picks, the label, the
   deletion and the drag are by hand.
9. **A relation whose line a trim took out of the profile stays**, read as
   the plane the line would sweep. The spec did not say; filed.
10. **The solid kernel's names, edges and blend/surface records are
    untouched** (another package is rewriting feature records). Filed as
    what a regeneration still renumbers.

### Tests

- `test/reviewrelations.test.ts` (27): each kind among many in 2D and 3D
  against the star; member deleted (first and middle), down to two, gone at
  one; join, bridge, `join`/`leave`, refusals; a replay never joins; conflict
  named once, agreeing counted once; the list's texts and the marks; the
  face's name, `faceRef`, every relation journalling a wall by its line; the
  wall held through a fillet, a chamfer and a trim; `fdist` through fillets
  of both profiles and `set`; the log on deletion; a wall off the profile;
  `corner` in 2D and 3D and through a fillet; the picked face's name and its
  lighting; the three format-19 fixtures.
- `test/e2e/reviewrelations.e2e.ts` (7): the two scenarios with a mouse and
  on an iPhone 13, the palette and the menu, the name by the hand.
- Changed to the new truth: `relationscomplete` (unit and e2e),
  `smartdimension` (unit and e2e), `clickonface` (unit and e2e),
  `dimensions`, and every test of the format's version number.

### Pictures (docs/images/)

- 470 — desktop: four lines parallel after Parallel (all 4), each with its
  length and one `//`; the log shows `par("l1", "l2", "l3", "l4")` → `r5`.
- 471 — `l1` deleted by hand (its points and their 40 left), the other three
  turned about 25° together by a drag; the log: `r5 par l2 l3 l4 — l1 left
  it, and it holds among the rest`.
- 472 — two blocks, the dimension tool armed, both +x walls lit green, the
  50 it will read by the cursor.
- 473 — the near block's corner cut off (a narrow new wall), the mouse on
  the label: the two lines its walls are swept from lit amber, the tag
  `d3 faceDistance e1:l2 e2:l14 50`.
- 474, 475 — iPhone 13: the four lines parallel; the first deleted from the
  held finger's menu and the rest turned by a finger.
- 476, 477 — iPhone 13: the two walls tapped; the corner trimmed off and the
  50 tapped (selected, violet), still drawn.
- 478 — the palette's eleven relations, the five lines' `par` among them
  once; a line's menu with *Leave r5 (// with l1, l2, l3, l5)*.
- 479 — a block from behind, the point tool armed: the wall under the mouse
  lit, `▱ e1:l4` by the ghost, the chip `on e1:l4 · point · click where the
  point goes`.
