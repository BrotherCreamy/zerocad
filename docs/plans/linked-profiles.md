# Plan: an extrude's two profiles are peers, related like a mirror's — nothing is consumed

**Status: queued, with questions for the owner** (2026-11-09). The owner:
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
3. **3D fillets and chamfers keep the original geometry as construction.**
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
4. **Sketch trim on one end**: the same rule as 3: the trimmed-away piece
   becomes construction rather than vanishing, so the pair still exists. If
   that is wrong for the sketch's own trim (which today deletes the piece),
   say so and keep trim as it is, applying the construction rule only to
   edits made on a profile that has a twin.

## Questions for the owner (answered before this is built)

- Q-A. Deleting the extrude leaves both profiles and the chords (Design 2).
  Confirm.
- Q-B. Deleting one profile's line deletes the extrude but leaves the other
  profile whole. Confirm, or should the extrude survive with the lid as the
  surviving profile and the base regrown?
- Q-C. A one-end fillet makes that end's lines construction and adds the arc
  (Design 3). The other end keeps its sharp corner. Confirm.
- Q-D. Sketch trim on a twinned profile keeps the piece as construction
  (Design 4), or deletes it as trim does elsewhere?

## Tests

- Unit, 3D: twins made, shared dimension value both ways, delete pairs,
  outside-reaching relations not twinned, deleting the extrude leaves two
  full sketches, deleting a base line leaves the lid whole, a one-end
  fillet, old files replay with names kept, nothing orange, conflicts name
  a pair once.
- E2E, mouse and iPhone 13: set a lid dimension and watch the base follow;
  delete the extrude and see both sketches; fillet one end. LOOK.

## Docs

CHANGELOG top quoting the owner; STATUS; ARCHITECTURE ("no hierarchy": a
feature relates, it does not own); the register; `help()`; the spec marked
built.
