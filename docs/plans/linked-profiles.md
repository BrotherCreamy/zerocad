# Plan: an extrude's two profiles are peers, related like a mirror's — nothing is consumed

**Status: built** (2026-11-12, branch `claude/linked-profiles`; *As built* at the end says what was made, what differs from the design and what was left). Design 3 is `fillets-one-thing.md`'s. First said 2026-11-09. The owner:
*"i mean kind of like mirror relations"*; *"in retrospect, i don't like the
idea of anything being 'consumed' as this implies unidirectional hierarchy"*;
*"Regarding 3D fillets, i think they ought to keep the original geometry as
construction without modification. of course it would be silly not to allow
fillets on one end only."* And earlier: *"after extrude, it should be
impossible to tell which was the original and which is the derivative."*

## What is true today (after profiles-held.md, #87)

- The lid is the base moved along one shared chord (`extrusion`), and
  `e1_perp` holds the chord square to the profile. The lid carries **none**
  of the base's relations: no perps, no dimensions. It follows the base
  through the chord only.
- The extrude **owns** its lid and walls: delete the extrude and they go.
  Delete a base line and the extrude goes with it (`deleteFeature`).
- A sketch `mirror` makes a copy held by `sym` on each point pair. The copy
  carries no copies of the original's relations either; its shape follows
  from the `sym`s. Both halves are real, and deleting a `sym` leaves both.
- A 3D fillet is a blend record over the kernel's edges; the sketch's lines
  are untouched by it, but the blend is one record per feature, not per end.

## Design

1. **The profiles are peers, like a mirror pair.** Each profile relation
   (within the profile: perps, dimensions, tangents, coincidences, equal,
   symmetric, the four-perp rectangle's flat) has a **twin** on the other
   profile, and the two are one linked pair:
   - a dimension pair shares **one value**: `set` either and both change;
   - deleting a relation deletes its twin while both profiles exist;
   - the pair is one for diagnosis (never orange for being a pair) and for
     the conflict search (named once, by whichever end the user has in view);
   - a relation added later to either profile gets its twin at once;
   - glyphs are drawn on both ends, dimensions on whichever end faces the
     viewer, so nothing is drawn twice at once.
   Relations that **reach outside the profile** (a dist to another point, an
   `onPlane` to a picked plane, a `par` to an axis is fine since it is a
   direction) are not twinned: twinning them would pin the lid where the base
   is. Say in the register which ops are directions and twin, and which are
   positions and don't.
2. **Nothing is consumed and nothing is owned.** The extrude is a relation
   between two profiles plus the record that makes a body of them:
   - deleting the **extrude** leaves both profiles and the chords as plain
     geometry, each profile with its full set of relations (the twins are
     now ordinary relations), as deleting a `sym` leaves both halves;
   - deleting **one profile's geometry** deletes the extrude (it has nothing
     to sweep) and leaves the other profile whole, with every relation;
   - the organiser's FEATURES row for an extrude is the body-making record,
     and lists both profiles without calling either the source.
   Old files: a saved extrude replays into this shape; names are kept (the
   derived-name trick of `e1_perp`).
3. *(Moved to `fillets-one-thing.md`, built after this package; kept here as
   the owner first said it.)* **3D fillets and chamfers keep the original
   geometry as construction.**
   A fillet on an edge of the solid does not trim or re-point the profile's
   lines; the lines it rounds between become **construction** (the flag,
   `construction.md`), the fillet's arc and its own twin on the other end
   (if the fillet runs the length of a wall) or on that end only (a fillet
   on one end's edges) are added, and the kernel builds from the result.
   So a fillet on one end only is ordinary: that end's profile gains an arc
   and two construction lines; the other end is untouched, and the two
   profiles are no longer twins edge for edge — the extrude relation holds
   the pairs that still correspond and the body is the kernel's. Say exactly
   what the extrude holds after a one-end fillet, and test that a drag still
   leaves a right prism with a rounded end.
4. *(Replaced by the owner's answer below: a trim lands on both profiles.)*
   **Sketch trim on one end**: the same rule as 3: the trimmed-away piece
   becomes construction rather than vanishing, so the pair still exists. If
   that is wrong for the sketch's own trim (which today deletes the piece),
   say so and keep trim as it is, applying the construction rule only to
   edits made on a profile that has a twin.

## The owner's answers (2026-11-12) — these decide Design 2 and 4

- **Deleting the extrude** leaves both profiles and the chords as plain
  geometry, each profile with its full relations: *"Yes."* (Design 2, first
  bullet, as written.)
- **Deleting a line of one profile**: *"Deleting a line would break it
  obviously. The other side of an extrude profile is an identically linked
  profile/sketch entities. If you change one the other follows
  automatically."* So while the link stands, **an edit to one profile is an
  edit to both**: deleting a line deletes its twin (and the wall between
  them). This **replaces Design 2's second bullet** ("leaves the other
  profile whole"). The body is then broken, and says so: the extrude stays
  as a record, the walls of the surviving edges are still swept (an edge
  extrude is the fundamental feature, #87) and are drawn as open surfaces,
  no lid or base face, the organiser's row marked *open*. Closing the loop
  again (drawing the missing line on either profile, which twins at once)
  makes it a solid again. If the kernel cannot build the open walls, say so
  in As built and fall back to: no body, the row marked *open*, the
  geometry all still there. Vetoable; in the register.
- **Sketch trim on a twinned profile**: *"If they are truly twinned
  profiles, then reining in one side should trim on the other also."* This
  **replaces Design 4**: a trim, extend, split or power-trim on one profile
  is applied to its twin in the same step, through the same operation, and
  the pair stays a pair. Nothing is kept as construction by a trim.
- **Fillets and chamfers keep the original geometry as construction**
  (Design 3 as written), and the owner adds: *"adding them to the
  originating chain/loop of a region of a body shouldn't break the body. The
  change should propagate through the entire hierarchy (yes: hierarchies do
  exist, but they are not timeline based). Also, adding a 2d fillet to the
  originating chain of a region of a body should produce an identical
  outcome to 3d filleting that edge. Also, the previous geometry should not
  be deleted - as in the two lines and corner point on the two linked
  sketches which form the extrude - it should be made into construction
  geometry. Note: anything can be construction. Lines, points, planes,
  bodies. Anything is fair game."* **That is its own package,
  `fillets-one-thing.md`, built after this one**: this package must leave
  what it needs — a twin for any entity added to a profile, construction
  entities carried through a twin, and the body rebuilt from whatever the
  profiles' non-construction loops are.
- **A free body moves when something held to it is pulled**: *"Yes. I should
  be able to pull on anything."* So nothing in this package may pin a
  profile to make the other follow; the pair is held to each other only.

## Also in this package: review item 4 — features relate, they do not own

TODO.md's register, *Reviewed against the owner's principle*, item 4:
`deleteFeature`'s cascade, the undeletable feature-held relations, and
`edgeExtrude` owning entities. With the profiles peers, finish it for every
feature that is the same shape of thing — extrude, cut, edge extrude,
revolve, offset, mirror, patterns: deleting the feature leaves its geometry
and turns its relations into ordinary ones; a relation a feature made is
deletable like any other (deleting one a body needs leaves the body *open*
or unbuilt, said in the organiser, never refused); relations that named the
feature's faces (`fdist`, `onplane(p, "e1.m3")`, #84 and #89) go with the
feature only where the face itself is gone, and are otherwise re-pointed to
the geometry that remains (a lid's plane is the lid profile's). Say per
feature what was owned and what is now related, in a table in As built.

## Tests

- Unit, 3D: twins made, shared dimension value both ways, delete pairs,
  outside-reaching relations not twinned, deleting the extrude leaves two
  full sketches with every relation, deleting a line of either profile
  deletes its twin and leaves the body open (surviving walls swept),
  redrawing it closes the body, trim / extend / split on either profile
  lands on both, a relation added to either gets its twin, every feature in
  item 4's table deleted and its geometry found whole, a feature-made
  relation deleted, old files replay with names kept, nothing orange,
  conflicts name a pair once, a free body pulled by a point held to its face
  still moves.
- E2E, mouse and iPhone 13: set a lid dimension and watch the base follow;
  drag a lid corner and watch the base corner; delete the extrude and see
  both sketches; delete one wall's line and see the open body, redraw it and
  see the solid; trim one profile and see both trimmed. LOOK at every
  picture.

## Docs

CHANGELOG top quoting the owner; STATUS; ARCHITECTURE ("no hierarchy": a
feature relates, it does not own); the register; `help()`; the spec marked
built.

## As built (2026-11-12)

### The link and the twins

- **The link is the `extrusion` relation** — an extrude's depth, an edge
  extrude's size. `src/twins.ts`'s `linksOf` reads the pairs off it: every
  point pair it holds (a sketch frame's datum points aside), and every line
  and spline whose ends are paired and whose partner runs between their
  partners. Neither side is called the source.
- **A twin is a registry entry of its own**, named `<partner>_<record>`
  (`r3_e1`, `d2_e1`; across two stacked extrudes `r3_e1_e2`), carrying
  `twin: { of, via }`. While the link stands it **holds no rows** — its
  statement is its partner's, carried by the extrusion; when the extrusion
  is deleted it is given its rows by its own function and is an ordinary
  relation.
- **Made and kept by a follower** (`defineFollower` in model.ts, registered
  by operations.ts): after every relation made at the top level, every
  outermost operation and every entity placed outside one. It reads names
  and joins, never positions, and is idempotent, so the journal has no
  entry for a twin and a replay makes the same ones under the same names.
- `set` on either of a pair rebuilds both with the one value;
  `deleteRelation` on either takes both; a conflict names the relation that
  was typed and the host lights both ends; a dimension's label is drawn on
  the end nearer the viewer, a mark on both.

| Relation | Twins? | Why |
|---|---|---|
| `dist`, `coin`, `mid`, `on` (point on line), `eq`, `sym`, `col`, equal spacing, `coplanar` | yes — shape | a translation keeps lengths and incidences |
| `rad`, `dia`, on-circle, concentric, coradial, equal radius, `tan`, arc endpoints, intersection, on-ellipse, major and minor axis | yes — shape | the same, for curves |
| `par`, `perp`, `ang` | yes — direction | a translation keeps directions; either may name a frame's axis |
| `fix`, `onplane`, `pierce` | no — position | the twin would pin the lid where the base is |
| `measure`, on-spline | no | a reading, not a hold; a spline's partner is paired by its points |
| `extrusion`, `revolution`, `translated`, `rotated`, `rotation` | no | they are links themselves |
| any of the above naming an entity outside the profile | no | the spec's rule: it reaches outside |

Each relation's module entry says which it is (`RelationDecl.twin`:
`"shape"` or `"direction"`); a relation with no entry does not twin.

### Review item 4: what was owned, and what is related now

| Feature | Before | Now |
|---|---|---|
| **Extrude** | Owned its lid's points and edges and its walls: `del("e1")` deleted them. Deleting a base line deleted the extrude and all it owned; a lid line could not be deleted alone. The depth `d1` and `e1_perp` took the record with them. A trim that broke the loop was refused. | `del("e1")` answers `[e1, d1, e1_perp]` and takes no entity; both profiles and the chords stay, every twin an ordinary relation. An entity of either profile deleted takes its partner and the wall between, and the record stays **open**. `d1` deleted leaves the record **unbuilt**; `e1_perp` deleted lets the chord lean. A trim that breaks the loop opens the extrude. `owns` still lists what the record made — for regeneration and for the refusals that remain on walls — and no longer decides what a deletion takes. |
| **Cut** (an extrude with `mode: "cut"`) | As the extrude; deleting it deleted its tool profile's far end and walls. | As the extrude: `[e2, d2, e2_perp]`, the tool's two profiles and chords stay, the body is drawn uncut. |
| **Edge extrude** (surface record `s1`) | Owned the copied curves, their points and the end chords. | Linked like an extrude: the copy carries a twin of each relation on the curves. `del("s1")` takes the record and its `extrusion`; `s1_perp` is an ordinary relation; a curve deleted takes its copy and the record keeps the rest. |
| **Revolve** | Owned its end face: `del("e1")` deleted it. The angle took the record. | `del("e1")` answers `[e1, <angle>]`; the end face and the sketch stay. The angle deleted leaves the record unbuilt. **Not linked**: no twins across a `revolution`, and deleting an edge of either end still takes the record (the geometry stays). |
| **3D fillet, chamfer** (blend record) | Owned no entity. Its size took the record; it went with its body. | The size deleted leaves it unbuilt, the body drawn without it. Its extrude deleted, it stays as a record left out of every body, saying why. |
| **Offset** | Owned nothing: copies held by `par`, `dist` and the like. | Unchanged; each relation is deleted alone and takes nothing. A lid's edge can now be offset (it was refused as "part of e1's solid"). |
| **Mirror** | Owned nothing: a `sym` per point pair. | Unchanged. |
| **Linear and circular pattern** | Owned nothing: `translated`, `rotated`, `rotation`. | Unchanged. |
| **Relations naming a face** | `onplane(p, "e1.m3")`, `par(c, "e1.m3")` and `fdist` went with the feature. | `onplane` on a flat face is re-pointed to `coplanar` over three of the face's own points, under the same name (`rehold`, journalled ahead of the deletion). `fdist`, `par(c, "e1.m3")` and anything on a round face still go with the record: they read the record. |

### Deviations from the design

- **Open walls are drawn, not built by the kernel.** The owner's answer has
  the surviving walls "still swept … drawn as open surfaces"; they are
  drawn, from both sides, from the model's own points (faces.ts), and no
  SMLib sheet body is made. So an open extrude cannot be cut, filleted or
  measured on. This is between the answer and its stated fallback.
- **"Named once, by whichever end the user has in view"**: named once, by
  the relation that was typed; both ends are lit. The conflict search has no
  view.
- **"Dimensions on whichever end faces the viewer"**: the end nearer the
  viewer along the view direction (in sight first), which is the same thing
  for a prism seen from outside.
- **Split and power-trim**: there is no split operation in this build; the
  trim tool's click takes a lid edge, its power-trim stroke does not.
- **"Closing the loop again (drawing the missing line on either profile,
  which twins at once)"**: true for a line joined to the two open corners by
  a shared point or `coin`. An arc, or a closure made by position, closes on
  the host's next `closeOpen` (after any edit by a person) or a typed
  `regen`.
- **"Impossible to tell which was the original"** is not reached. What
  still tells: a twin's name (`r3_e1`), the region (`rg1` stays on the
  profile the extrude was made from), `fix` and `onplane`, two corners
  joined by `coin` having one lid point, and a profile that is a piece of
  longer lines having no twins. Each is filed in TODO.md.
- **Revolve** is in item 4's table for deletion only; its ends are not
  linked.
- **Format 20** adds nothing to a file. It exists because `deleteFeature`
  means something else: a pre-20 entry is marked `"unlinked"` on the way in
  and takes what it took.

### What `fillets-one-thing.md` stands on

- A twin for an entity added to a profile: `relinkOne` gives a line its
  partner by its joins; `planOpen`/`rebuildOpen` re-make a lid from a given
  set of loops, which is where an arc's twin comes from.
- Construction through a twin: a link pairs lines by their points whatever
  their flag, so a pair flagged construction is still a pair, its relations
  keep their twins and a new relation on it is twinned at once; a
  construction line between two corners pairs with the one between their
  partners (tested, flagging at the `Model`). **Not done**: the
  `construction` operation still refuses a feature's outline member and
  flags only what it is given — lifting the refusal and flagging the partner
  with it is the fillet package's operation to define, since it changes what
  an old file's `construction("l5")` means.
- The body from the non-construction loops: regions already walk past
  construction (loops.ts), so `regen` re-derives a record's loops from what
  is not construction; `regenerateGiven`, `planOpen` and `rebuildOpen` make
  a lid from the loops they are handed, re-making or re-pointing each twin
  by name.

### Tests

`test/linkedprofiles.test.ts` (27 tests: twins, the table above, set and
drag both ways, nothing agreeing or redundant added, a conflict named once,
pairs deleted, the extrude deleted, an edge deleted from either end and
drawn back, a corner, a wall, trim and extend from either end, the
format-19 fixture, every feature of item 4, a feature-made relation, a free
body pulled, a sketch fillet's twins, construction through a twin, a twin
of a twin, marks, 2D,
`ls()`/`rels()`). `test/fixtures/linked-v19.neocad.json` was written by the
build before this one, with the geometry it solved to beside it.
`test/e2e/linkedprofiles.e2e.ts`, mouse and iPhone 13.

### Pictures

| | |
|---|---|
| 443 | Desktop, hidden-line: the block's base and lid each wearing their `⊥` pairs, the dimension 50 drawn once on the lid's front edge. |
| 444 | `set("d2_e1.value", 64)`: the label reads 64, both front edges longer. |
| 445 | A back lid corner dragged: the back edges of lid and base moved together. |
| 446 | The lid's right edge deleted: three walls, no caps, the row `extrude · open`. |
| 447 | The edge drawn back on the base: a whole block, `e1` under Bodies again. |
| 448 | `del("e1")`: two rectangles and four chords, marks on both; `rg1` on the lower. |
| 449 | A short line on the lid across its front edge. |
| 450 | The trim tool on the lid's edge: the front wall half as long, the row `extrude · open`. |
| 451–458 | The same eight on an iPhone 13, by finger (the edge deleted by its name, typed). |
