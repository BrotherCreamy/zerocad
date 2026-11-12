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
