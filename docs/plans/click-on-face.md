# Plan: a click on a face lands on that face, is held there, and says so before the click

**Status: queued** (2026-11-09). The owner: *"when i make a rectangular prism,
i attempt to draw an e.g. circle on another face, but it still draws the
circle on the XY plane. Why? if i am hovering over a face without an active
on-plane constraint, it should constrain to the plane i am hovering over. like
i should be able to do a 3 point circle with each point on a different face of
the rect prism, by just orbiting around. it should come up with an on-plane
constraint indicator before i click (and highlight the plane i am hovering
over)"*. And the principle: *"correct relationships BETWEEN entities …
bidirectional relationships everywhere by default."*

## What is true today

`src/tools/place.ts` `CurvePlane.begin` decides a curve tool's plane **once,
at the gesture's first click**: (1) the picked sketch plane if any; (2) else
the face of a solid under the cursor — `regionAt`, then `isSolidFace`, every
member of the loop named by one common feature; (3) else the origin's x–y
plane. Only case 1 holds the curve there (`hold`: centre `onplane`, normal
`par`). Case 2 holds **nothing**, by design written before the owner said
otherwise, and case 2 is skipped altogether when the pointer is snapped
(`!p.snap`). The owner reports case 2 not firing at all on a prism: suspect
`isSolidFace` after #87 (a wall is now base line + two chords + twin, and the
chords and twin may not share the base line's naming feature), or a snap to a
ground entity behind the face. **Reproduce first** (e2e: prism, orbit, circle
tool, click on a wall; assert the centre's z) and name it bug 72 in the four
copies of the count.

Read `CLAUDE.md`, `docs/ARCHITECTURE.md`, `docs/plans/profiles-held.md` (#87,
what a wall is now), `smart-dimension.md` (how a face is named and read
lazily: `src/relations/solidref.ts`, `src/solidpick.ts`, picture 320 is a
face lit under the cursor), `sketch-mode.md` (case 1, unchanged),
`frameless-curves.md`, `src/tools/place.ts`, `engine.ts` `regionAt` /
`solidFaceAt`, `src/snap.ts` or wherever snaps are found, `src/modules/*.ts`.

## Design

1. **Per click, not per gesture.** Each point a curve tool places decides its
   own surface at its own click: the solid face under the pointer, else the
   picked sketch plane, else the ground. A three-point circle may have its
   three points on three faces; a line an end on each of two faces; a
   rectangle four corners on one face (its four `onplane`s and the tool's
   `coplanar` then agree, which the status now counts rather than blames).
2. **Held, visibly.** A point placed on a flat face gets `onplane(p, face)`,
   the face named as the dimension tool names it (`e1.lid`, `e1.m3`, …,
   `solidref.ts`) and read lazily through the feature's record, so it follows
   a depth change and a regeneration. Ordinary relation: journalled by its
   module, in the palette, deletable, named once in a conflict. A curve
   placed entirely on one face (centre-radius circle, arc, ellipse, rectangle)
   also gets its normal `par` to the face's, as case 1's `hold` does today —
   the owner's "constrain to the plane i am hovering over". A curved face
   (cylinder wall): the point is placed on it and **nothing is held**; say so
   in the log line and file an `onsurface` relation in TODO.
3. **Before the click**: the face under the pointer is lit (as the dimension
   tool lights it, `src/solidpick.ts`, picture 320) and an on-plane glyph sits
   by the cursor with the face's name (`⊥ e1.m3` or the house's onplane
   mark); the status note says `on e1.m3`. On a phone the same at the finger,
   with the glyph offset so the finger does not cover it.
4. **Snaps on a face.** With a face under the pointer, snaps are taken only
   to things on that face — its edges and vertices, and sketch entities lying
   in it — never to ground entities behind it. A snap to a vertex or edge of
   the face still wins over the face (coincidence says more than onplane).
5. **Case 1 unchanged**: with a sketch plane picked, everything lands on it
   and is held to it, whatever is under the pointer (Onshape's rule, the
   owner's sketch mode).
6. **The ground is still where a click lands when nothing else is there**,
   and still holds nothing. Say in the register that this is the pointer's
   plane and not a relation (CONVERSATION_LOG 2026-11-09, the owner's "is
   this a coincidence?" exchange).

## Tests

- Unit, 3D: a point placed on a named face is held by `onplane` naming the
  face; follows `set` of the depth; survives save/open; deleting the feature
  takes the relation (today's cascade — note it is on the review list, item
  4); a curved face holds nothing and logs; snaps restricted to the face.
- E2E, mouse and iPhone 13: extrude a rectangle; orbit; **three-point circle
  with one point on each of three faces** — each point `onplane` its face,
  the circle through them; set the depth and watch the points ride along;
  centre-radius circle on a wall: centre `onplane`, normal `par`; the hover
  picture with the face lit and the indicator before the click. LOOK at
  every picture. The reproduction of bug 72 first, failing, then passing.

## Docs

CHANGELOG top quoting the owner; STATUS; ARCHITECTURE (where a click lands,
and that the face is a relation now); the register (per-click surface;
curved faces not held; snap restriction; the ground is the pointer's plane);
bug 72 in the four copies of the count; `help()`; the spec marked built with
deviations.
