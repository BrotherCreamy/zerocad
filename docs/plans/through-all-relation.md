# Plan: Through all is a relation to the far side's own geometry — and Up to face is the same relation

**Status: queued, after `linked-profiles.md`** (2026-11-12), which it stands
on (the lid is the twin profile, and a feature relates to its geometry rather
than owning it). Review item 8 of 2026-11-09, which the owner passed with
*"All good"*: *"`defineThroughReach`: a relation reading kernel geometry
through a hook keeps the layer rule's letter; Through all should be a
relation to the far face's defining geometry."* The owner's principle:
*"correct relationships BETWEEN entities … bidirectional relationships
everywhere by default"*, and *"I should be able to pull on anything."*

## What is true today (read from the code, 2026-11-12)

- An extrude's `extent: "through"` makes its depth dimension hold the lid at
  `lidReach` (`src/model.ts`), which asks `throughReach` (`src/solids.ts`,
  registered by `defineThroughReach`): the farthest any solid **made before
  it** stands along the depth's way, sampled off each one's sweep, plus a
  tenth (at least one unit).
- That number is read inside a residual (`src/relations/extrusion.ts`, the
  chord's length) as a constant. Three things follow, and each is against the
  principle:
  1. **One way.** The plate moves the cut; the cut can never move the plate.
     Pull the cut's far end and nothing gives.
  2. **The Jacobian is not exact** — the one place it is not. The row depends
     on the plate's points and says it depends on the chord alone; it
     converges by being re-read. `throughReach` already carries a scar from
     it (*"a cut through a plate set deeper leaned and never settled"*).
  3. **Nothing to see or delete.** No relation names what the cut goes
     through; the palette lists none; the label says "through all" and
     that is all there is.
- "Made before it" is a timeline. The owner: *"hierarchies do exist, but they
  are not timeline based."*
- Up to face was left out of solid-tools-intuitive for want of the same
  thing: a relation from a lid to a face (CONVERSATION_LOG, *"Up to face,
  left"*).

## Design

1. **The far side of a body with corners is one of its points.** However a
   flat-faced body stands, the farthest it reaches along a direction is at a
   vertex — and an extrude's vertices are entities: its profile's points and
   their twins. So Through all is **that point on this extrude's lid**:

   ```
   onplane("p7", "e2.lid")        // named e2_through
   ```

   the relation click-on-face (#89) already built, both sides variables,
   exact Jacobian, a glyph, a row in the palette, a name in a conflict. Where
   the far face is parallel to the sketch — a plate, the usual case — every
   far vertex is as far as the next: the relation takes one, and the rest
   agree.

2. **The extrude then has no depth of its own.** With `e2_through` holding
   the lid, the `extrusion` relation makes no length row for a through
   extrude (its chord stays square to the profile, its twins stay a
   translation), and `lidReach`'s through branch, `throughReach` and
   `defineThroughReach` go. The dimension's label still reads "through all";
   the number in the journal keeps its sign, as today, and is what the depth
   becomes again when the end is set back to blind.

3. **Both ways.** Make the plate deeper and the cut follows; pull the cut's
   far rim and the plate's far face comes with it, if nothing else holds the
   plate's thickness — and if something does, it is a conflict that names
   `e2_through` and that dimension. *"I should be able to pull on anything."*

4. **Deletable, like `e1_perp`.** Deleting `e2_through` leaves a blind
   extrude at the depth it stood at (the extent is cleared and the length row
   returns, in one journalled step). Setting the end to through makes it;
   `setEnd` back to blind deletes it. The feature relates to it and does not
   own it.

5. **Past the face is the kernel's business, not the drawing's.** Today the
   lid stands a tenth past the far face so the boolean never meets a face
   edge-on. The drawn lid now stands **on** the far side — where the hole's
   rim is — and the solids layer extends a through *cut's tool body* past its
   lid by `THROUGH_PAST` when it builds (`extrudeSpan`), which no relation and
   no picture sees. A through *add* is flush, which is what adding up to a
   face means.

6. **Which point.** Chosen when the end is set, by an operation: of the
   bodies this feature's swept profile meets, the vertex farthest along the
   depth's way; ties broken by name so a replay picks the same. Journalled as
   the relation it makes (`onPlane ["p7", "e2.lid"]`, named), so a file says
   which and a replay does not search. **Re-chosen by `regen`** when the
   feature is regenerated (a body it goes through restructured, added or
   removed) — the existing queue, journalled as it journals. Between
   regenerations, if a solve leaves another vertex farther (a slanted far
   side turned), the cut no longer goes through: the feature's organiser row
   says so ("e2 stops short of p9") with the one-tap fix, rather than the
   relation silently re-pointing itself inside a solve.

7. **What it goes through is what it meets, not what came first.** The far
   point is searched over the bodies the swept profile meets. The build order
   of booleans is unchanged (a cut still cuts only what the kernel has built
   by then); that order is a timeline too, and is **filed, not changed
   here**.

8. **Round and kernel-only far sides: said, not faked.** A revolve's side, a
   sphere, a filleted far edge have no farthest *entity*. For these the lid
   is placed where the measurement says (today's sampling, kept as a plain
   function in `solids.ts`, called once by the operation — no hook, nothing
   read inside a residual) and held by an ordinary blind depth; the log says
   "through e3 as it stands — a round far side is not held; set the end again
   after changing it", the label reads "through (placed)", and it is in
   TODO. The same words click-on-face uses for a curved face.

9. **Up to face is the same relation, the other way round.** A third end
   condition, `{ end: "upto", face: "e1:l2" }` and an "Up to face" row in the
   end drop-down that takes one pick: `onplane(<a lid twin point>, "e1:l2")`,
   named `e2_upto`. A flat face of entities parallel to the sketch: held, both
   ways. A flat face not parallel to the sketch: refused with the reason (a
   lid on it would not be this profile moved, and the kernel sweeps square) —
   filed. A kernel-only or round face: placed, not held, said as in 8.

## The design made exact against the code (2026-11-12, before any of it was written)

The design above was written before linked profiles (#93) and the solver
package (#92) landed. Read against the code as it stands at 93abd3d, each
point below either confirms it or says what it has to be instead. Where this
section and the design disagree, this section is what was built.

**Measured on that commit first** (`test/throughrelation.test.ts`'s first
three tests, and `test/through.measure.ts`):

- A circle floating over a free plate, cut down through all; its far rim
  dragged 6 along the cut: the plate's four base corners moved **0.000**.
- A hole through a plate from its top: **no row** reads a variable of the
  cut's lid and a variable of the plate together.
- `e2_through` is not a relation; nothing is listed.
- The plate set from 10 to 20 deep: **35 iterations, 166 ms** for the hole
  to follow (the stale constant re-read), 8 and 16 ms with a pocket beside
  it. A top corner dragged, twelve frames: 295 ms with the hole, **714 ms**
  with the pocket as well — `throughReach` lays out every earlier feature's
  sweep at every evaluation of the row.
- And one fault the list above does not have: **through cuts compound.** A
  second through cut reads the first one's tool body as a solid made before
  it, so it stands a tenth past *that*: with the plate 14 deep the hole's lid
  was 1.4 past the far face and the pocket's 2.94.

### 1. What `onplane("p7", "e2.lid")` reads — not quite "both sides variables"

`onFace` (relations/solidref.ts, #89) reads a cap as **its first point and
the extrude's way**: the lid's first point's three variables, and the unit
chord as plain numbers (`capNormal` → `extrudeNormal`), *"a datum, read and
never pushed, as a frame's axes are"*. So `e2_through`'s one row names
**six variables: the far vertex's three and the lid point's three**, and is
exact in both. It is **not** exact in the lid's *turn*: the way is re-read at
every evaluation and is no column of the row. That is what every relation on
a cap has been since #89, it is a direction and not a position, and
`e2_perp` holds the chord square in rows that are exact — but it is the one
term of this row the Jacobian does not carry, and it is said here rather
than claimed away. Making a cap's normal the chord's own variables changes
every `onplane`, `fdist` and `par` on every cap, which is its own package
(filed in TODO.md).

### 2. The `extrusion` relation and the chord's length

The length row is `|t₀ − b₀| − |reach|`, with `reach` read by the relation's
own name at every evaluation (`lidReach`). As built:

- `lidReach` moves from `model.ts` to `relations/extrusion.ts` (it reads the
  chord, and nothing in the model needs it), and has no hook: blind → the
  depth; symmetric → half; **held** (through or up to a face, with its
  relation standing) → the chord's own length as it stands, signed as the
  depth — what `reseatLid` and the solids layer ask.
- **The length row is there unless the end is held.** Read lazily, as the
  reach was, because the record is made after the relation: the row's block
  gives no row while the record says `through`/`upto` *and* the relation
  named for it (`e2_through`, `e2_upto`) stands. So whichever way that
  relation goes — deleted, or taken by a cascade with its far point — the
  extrude is a blind one again without anything being rebuilt, and can never
  be left with no row and no relation.
- **Held or placed is structure, not a flag**: `extent: "through"` with
  `e2_through` standing is held; `extent: "through"` without it is *placed*
  — an ordinary blind depth at the number the operation put there — and the
  label says which.

### 3. Twins (linked-profiles)

- `onPlane` declares no `twin` (twins.ts: a position), and `carried` refuses
  any argument that is a face (`"e2.lid"`, `"e1:l2"`). So **`e2_through` has
  no twin**, though the far vertex `p7` is itself half of the plate's linked
  pair: its partner on the plate's other profile is held by the plate's own
  extrusion, not by a second through relation. Tested.
- The through extrude's own link is untouched: `linksOf` reads the
  extrusion's pairs, which a missing length row does not change, so the
  cut's two profiles are still twins of each other.
- `e2_through` is **not** among the record's `names`. A relation a record
  names is background to the conflict search and to `diagnose`
  (`Model.removable`), and the spec wants this one named in a conflict. It
  is found by its derived name, as `e1_perp` is.

### 4. `keptSizes` (review-solver)

`keptSizes` pulls back the length of a line that a block declares it only
*turns*. `e2_perp`'s block declares none (`squareToProfile` passes no
`turns`), and a linked twin holds no rows, so **by default nothing asks for a
through chord's length to be kept** and the through relation alone sets it.
Where a person's own relation turns a wall of the cut (`par(wall, …)`), a
solve that lengthens the wall is followed by the steer: pulled back, released,
and — the change being past `CHANGED` — let go, as a side a dimension was
just put on is. It costs iterations and changes nothing; tested with a `par`
on a pocket's wall, and measured.

### 5. Seating (`set`, `reseatLid`)

- `set` on a **blind** depth seats that extrude's lid, as now. Then, new:
  **every held end in the model is seated** (`seatEnds`) — each held lid
  moved along its own chord until its plane is on its far point (or its lid
  point on its face). A plate set deeper from below moves the far vertex of
  a cut made from its top before the solve begins; seated, the solve starts
  with that relation already met, as it starts with the depth met. Seeds
  only, as `reseatLid` is.
- `set` on a **held** extrude's own depth changes a number that holds
  nothing (it is the depth the extrude has when set back to blind). Its
  **sign** is which way it goes: a `set` across zero mirrors the lid
  (`reseatLid`, `k = −1`) and, at the call, is followed by the far point
  chosen again on the new side — journalled as the `setEnd` it is, so a
  replay searches nothing. On an **up-to-face** extrude a `set` across zero
  is refused in words: the face is on one side.

### 6. Journalled resolved — and so what an old file does

The codebase's rule (operations.ts, `extrude`): *a saved entry must not
change meaning with the drawing it is replayed into*, and **a replay runs on
seeds**. So the far point cannot be searched for at a replay, old file or
new, and the design's "the search runs once, at replay, on the model as it
stood" is replaced:

- A call journals what it found: `extrude(…, { end: "through", to: "p7" })`,
  `setEnd("e2", "through", "p7")`; placed, the depth it was placed at
  (`to: -15.4`); nothing met, `to: null`. Up to a face:
  `{ end: "upto", face: "e1:l2" }` held, `{ …, to: -12.3 }` placed.
  `regen`'s and `fillet`'s list of what they regenerated gains an entry for
  each end chosen again, `[feature, [], "end", "p9"]`.
- **A file from before 23** carries `end: "through"` with no `to`. Its
  extrude replays as it did (through, not yet held); once the saved values
  are back — the solved drawing, not seeds — each such extrude's far point is
  found once and written at the journal's end as the `setEnd` it is. The
  file re-saves in the new form and reopens without searching.
- Deleting `e2_through` is journalled as `setEnd("e2", "blind", -10)`: the
  depth it stood at, in the entry, since a replay cannot measure it.

### 7. What "the bodies the swept profile meets" is, exactly

At the operations' height (`src/farside.ts`, which may import the solids
layer; nothing below it does). The profile's interior, sampled as
`modes.ts`'s probes sample it, is walked along the depth's way; a feature is
**met** when one of those walks passes inside its own solid ahead of the
sketch. Cuts are not met: a hole is not something to go through (this is
what ends the compounding above). Of the met features' profile points — both
profiles' line and arc ends, and centres — the farthest along the way is the
far point, **if nothing of a met solid stands farther** (sampled off each
sweep, as `throughReach` sampled it); ties go to a corner before a centre,
then to the lower name. If something does stand farther — a revolve's side,
a cylinder lying across — the end is **placed** at that measure and a tenth
past, as before.

### 8. Deleting the extrude itself

`del("e2")` follows the rule linked-profiles set for any relation on a face
of a record going (`reholdFaces`): where the lid has three points that span
it, `e2_through` is re-held as `coplanar` over them, under its name, and
stays; a round hole's lid has one point, so there it goes with the record.
Nothing special is added for it.

### 9. Up to face, exactly

`onplane(<the lid's first point>, face)`, named `e2_upto`; the lid point is
`capPoints(…, "lid")[0]`, the same point every relation on the lid reads, so
there is no choice to journal. Parallel is asked of the face's normal
against the profile's, to 1e-6. A face on the far side of the sketch from
the depth's sign turns the depth round first (its own journalled `set`). A
round wall is placed where the profile's middle, walked along the way, meets
its cylinder; a face only the kernel knows is placed at the point the tool
picked it at (`setEnd("e2", "upto", "e3.f0", [x, y, z])`) and refused in
words when typed without one — nothing in the model says where it is.

## Files

- A file with `end: "through"` from before replays the extrude and then makes
  `e2_through` at that step (the search runs once, at replay, on the model as
  it stood) — so it re-saves in the new form. Format bump; a fixture saved by
  the build before, opened and compared: same solids, the relation present.
- The `through` number in an old file's depth is ignored except for its sign,
  as it is today.

## Tests (headless, then the browser)

- A cut through a plate: `e2_through` exists, is listed, has a glyph; status
  counts it. Plate set deeper → cut follows. **Lid's far point dragged →
  plate's far face follows**; with the plate's thickness dimensioned →
  CONFLICT naming both.
- The Jacobian row count and sparsity of a through extrude: the through
  relation's row names the far point's variables (it did not before). The
  "leaned and never settled" case from `throughReach`'s comment, as a test
  that now settles, with iterations before and after.
- Delete `e2_through` → blind at the depth it stood at; undo → through.
  `setEnd` each way, journal and replay equal.
- A slanted far side: the far vertex is taken; turned until another is
  farther → the organiser row says so; one tap re-picks.
- Through a revolve: placed, said, label "through (placed)"; nothing claims
  to hold.
- Up to face: parallel wall held both ways; slanted wall refused in words;
  kernel-only face placed and said.
- An old file with a through cut: opens to the same solid (volume compared),
  re-saves with the relation, reopens the same.
- `grep` test: `defineThroughReach` and `throughReach` are gone from `src/`,
  and nothing in `src/relations/` or `src/model.ts` imports from `solids.ts`.
- Browser, iPhone and desktop, pictures looked at: the through cut with its
  relation glyph on the far rim; the far rim dragged and the plate deeper;
  the conflict; Up to face picked on a wall; the "placed" label on a cut
  through a revolve.

## Vetoable, to be written into the register when built

- The drawn lid stands on the far face, not a tenth past it (5).
- The far point is re-chosen by regeneration and never inside a solve (6).
- Round and kernel-only far sides are placed, not held (8).
- Up to a face not parallel to the sketch is refused (9).

## Left deliberately

- The boolean build order (a cut cuts what was built before it) is a
  timeline and stays one here.
- A lid that is not flat (up to a slanted or curved face, as SolidWorks'
  Up To Surface trims) needs a loft or a trim in the kernel.
