# Plan: an extrude's two profiles are peers, related like a mirror's — nothing is consumed

**Status: queued, the owner's answers in** (2026-11-12; *The owner's answers* below replaces the questions). First said 2026-11-09. The owner:
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
