# Plan: a click on a face lands on that face, is held there, and says so before the click

**Status: built** (2026-11-09, branch `claude/click-on-face`; the
reproduction, what was built and every deviation are at the end, *As
built*; queued the same day). The owner: *"when i make a rectangular prism,
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

## As built (2026-11-09)

### The reproduction: bug 72 had two legs, and neither was the spec's suspect

`test/e2e/clickonface.e2e.ts`, the first two tests, against the untouched
code: a rectangle drawn and extruded with the tools, the view orbited
(`orbit(0, -1.0); orbit(-0.8, 0)`: the lid and two walls each a hand's
breadth), the circle tool armed.

| the owner's gesture | before | after |
|---|---|---|
| centre lock, a click on a wall's middle, a click at the rim | **zero circles**. The press was settled onto the face by `CurvePlane.settle`; the release was compared against it raw (`pressMoved`), at the same pixel but on the ground behind — worlds apart — so every click on a face read as a drag of zero radius and the gesture quietly started over | one circle, its centre `onplane(p9, "e1.m2")`, its normal `par(c1, "e1.m2")` |
| auto, a press three pixels inside a wall's edge (snapped along it), dragged out | the circle **on the x–y plane** through a point of the wall: a snapped press skipped the face question (`!p.snap`), and on a phone a finger's reach makes nearly every press on a small face a snapped one | the circle in the wall; its centre on the edge (`on`) and on the face (`onplane`) |

`isSolidFace` and `regionAt` were fine: the loop under the pixel was found
(probed in the browser). The spec's other suspect, a snap to a ground entity
behind the face, was half right — the snap was to the face's *own* edge, and
it was the snap, not the entity, that lost the face.

### What was built

- **Landing in the engine** (`ToolEngine.toolEvent`, `landingAt`): for a tool
  that places points (`Tool.snaps`), in a 3D model with no sketch plane
  chosen, every pointer event is read on the face drawn under the pixel
  (solidpick.ts's `faceUnder`, the dimension tool's own pick), facing the
  viewer, and the tool is told which (`PointerInfo.face = { name, flat }`).
  The snap is handed the face's plane as it is handed a sketch plane, so
  only the face's edges, vertices and what lies in it are offered as
  themselves. `engine.landing` is what the overlay lights and names and
  the chip reads.
- **`CurvePlane`** (place.ts) takes its plane from the click's face (case 2)
  and no longer asks `regionAt`; `settle` reads a later click onto the
  gesture's plane and drops the face it landed on; **`settleOwn`** keeps a
  click that is a point of its own. The circle tool uses `settleOwn` for its
  presses and `settle` for a radius; the spline for every point; the arc,
  the rectangle (which gained a `CurvePlane`) and the two-point shapes lay
  out on the first press's face. `pressMoved` is asked of like against like
  in the circle, the arc and `TwoPoint`.
- **`onplane(p, "e1.m3")`**: `basic.onPlane` hands a face name to
  solidref.ts's `onFace`, which journals the same op and reads the face
  through `readPlane` at every evaluation — a cap by its first point and
  the sketch plane's normal, a wall by its line's two ends as variables. The
  face name's shape moved into model.ts (`parseFaceName`, beside
  `parseAxisRef`, which now returns null for one); solidref.ts re-exports
  it. **`par(c, "e1.m3")`**: geometry.ts's `directionSides` reads a face
  through `faceDirection` (a cap a datum, a wall its line's ends).
  `workplane.ts` reads a face as a plane (`planeOfRef`, `planeNormalRef`,
  `isFacePlane`); `holdOnSketchPlane` and `holdCurve` hold to a face whether
  or not a plane is chosen.
- **Before the click**: the face lit amber in the cells it is in front at
  (`renderLandingFace`, the dimension tool's shading), `▱ e1.m3` with a dark
  rim beside the mouse's ghost or a finger's lifted mark
  (`renderLandingName`), and the chip's first part `on e1.m3` in amber with
  no menu, ⟂ or Done (`chipParts(…, landing)`, `landingLabel`).
- **A round face**: `on e1.m0, round` in the chip, `e1.m0 · round, not held`
  by the hand, the point placed on the piece drawn under the pixel, and the
  log: `p9 placed on e1.m0, a round face — nothing holds it there yet`.
- **Finish redraws**: `ctx.finish` requests a render, so a tool that commits
  on its press leaves no stale frame (the lit face, the armed chip) behind —
  seen in the picture of a three-point circle just made.

### Deviations from the design, and decisions (each in TODO.md's register)

- **Design 1 listed the face before the chosen plane; design 5 the plane
  first.** The plane wins (Onshape's rule; case 1 unchanged). With a sketch
  plane chosen no face is asked about.
- **Design 4's "a snap to a vertex or edge still wins"** is read as the
  snap being taken: a vertex snap pins the point and gets no `onplane`, as
  a chosen plane never gets one on a pinned point; a snap along an edge of
  the face gets the edge's `on` *and* the face's `onplane` — an agreeing
  pair, as a sketch plane makes today, counted and not blamed.
- **The relation is the existing `onplane`, not a new module entry.** The
  spec asked for an entry in a module's `relations`; the op is core's
  `onPlane` entry, extended to read a face name, so the palette, the ▱, `del`,
  the cascade and the copies came for free and there is no second table.
- **A wall's hold is both ways** (`readPlane`'s wall is its line's ends as
  variables, as `fdist` reads it): measured, a point put 5 off a free prism's
  wall met it halfway; a `set` of the depth with a circle pinned to three
  faces moved the free prism 0.7 of the lid's 10. A base the user holds
  stays and the point rides the whole way (`test/clickonface.test.ts`). The
  e2e measures the ride against the solid, not the ground.
- **Faces land only where they are drawn**: the wire view draws none, so a
  click lands on the ground there, as a dimension picks no face there. The
  old `regionAt` path, which found a face by its loop in any view, is gone.
- **A kernel-only face** (a fillet's, a boolean's) is placed-not-held like a
  round one: nothing in the model holds such a face.
- **The spline's points** each take their own face (not in the spec's list;
  a spline is points, so it follows the three-point circle).
- **The phone's snaps** at the phone's own scale put a wall's edge midpoints
  inside a finger's midpoint snap of its middle; the e2e zooms in (`zoom(1.8)`)
  and says why. On a real phone the owner will meet the same: a tap near
  the middle of a small face snaps to an edge's midpoint and is pinned
  there, correctly, and the face is not asked. Written in the register.

### Pictures (docs/images/)

- 433 — desktop, the three-point circle armed, the mouse over the right
  wall: the wall lit amber with its edges stroked, `▱ e1.m3` with its dark
  rim beside the green ghost, the chip `on e1.m3 · circle · click the first
  point` in amber.
- 434 — a centre-radius circle on the wall by two clicks: its `//` glyph,
  its centre p9; the chip back to `select` the moment the tool finished.
- 435 — two points clicked on two walls (the + marks), the mouse over the
  lid: the lid lit, `▱ e1.lid`, the preview circle through all three.
- 436 — the circle through three faces — p9 on the right wall, p10 on the
  front wall, p11 on the lid — each with its ▱, nothing lit now the tool is
  down.
- 437 — `set("d1.value", 20)`: the block twice as deep, the three points
  ridden along, each still on its face.
- 438 — a rectangle on the wall, small so no corner meets an edge's snap,
  its four ⊥, and a line from the wall up onto the lid (short: the lid's
  middle is close by at this angle).
- 439 — iPhone 13, a finger on the front wall: the wall lit, `▱ e1.m0` by
  the lifted mark, the chip `on e1.m0 · circle · press at the centre`.
- 440 — iPhone 13, the circle on the wall by two taps.
- 441 — iPhone 13, a finger on the lid with the three-point circle armed:
  the lid lit, `▱ e1.lid`.
- 442 — iPhone 13, the circle through three faces by three taps.
