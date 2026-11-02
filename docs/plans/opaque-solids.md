# Plan: a solid looks like a solid — opaque, by default

**Status: built** (2026-11-02) — see "As built" at the end for the numbers
and for every place the build differs from this text. The owner, verbatim,
two messages in a row:

> *when you extrude a solid, it should look like a solid*
> *It should be opaque*

Today a solid is drawn as dark faces (`FACE_DARK`/`FACE_LIGHT` in
`src/faces.ts`, close to the background) under a 2D canvas that draws
**every** entity on top — the hidden-edges package dims edges behind a face,
but they, and every point, name, glyph and frame marker behind a solid,
still show through. That reads as glass. Under the owner's standing rules
(tools work like Onshape; `effortless.md`), a solid is opaque: what is behind
it is not seen and not aimed at. Read `CLAUDE.md`, `docs/plans/effortless.md`,
`display-depth.md` and `hidden-edges.md` (as built), `src/faces.ts`,
`src/facelayer.ts`, `src/occlusion.ts`, the drawing pass in `src/main.ts`
(edges, points, names, glyphs, frame markers, dimension labels, the empty
hint), `src/picking.ts` (`hitTest`), `src/snapping.ts`, `src/boxselect.ts`,
`src/glyphs.ts`, and the e2e tests for hidden edges, depth, picking and
snapping.

## The rule

**Shaded (the default): solids are opaque.** Anything behind a visible face
— an edge or the part of one, a point, its name, a glyph, a frame marker, a
dimension's label and witness lines — is **not drawn**, and **cannot be
picked, snapped to or box-selected**. The face itself still never picks
(faces are display only). What is in front, or on the solid's own visible
faces and edges, is drawn and aimed at exactly as now. Rotating the view
reveals what was behind.

**View modes**, for when the user wants to see through: `view("shaded")`
(the default), `view("hidden")` (today's look — hidden edges dimmed, hidden
points shown — and everything pickable), `view("wire")` (no faces at all).
The mode is per-viewer UI state like the camera: not journalled, not in a
file, not an undo step; remembered in `localStorage` with the other viewer
state. Offer the three in the empty-canvas context menu (a "View" row of
three items, the current one marked) and in `help()`.

**It looks like a solid**: the face colours move to a clearly lighter body
tone, well separated from the background (a lit range roughly from a mid
slate to a light grey-blue; measure contrast against the background and the
grid-free canvas, and write the numbers down), with the headlight shading
range wide enough that adjacent faces of a box read as different planes.
A solid's own edges (its profile, twins and walls) are drawn in a dark
outline ink over the faces, as Onshape draws a part's edges, so the shape
reads even where two faces shade alike; sketch geometry not on a solid keeps
its sketch colours.

## Design notes

- **One occlusion answer for drawing and for aiming.** `occlusion.ts`
  already answers "is this world point behind a visible face"; the drawing
  pass already asks it per edge sample. Extend the question to points (one
  sample), labels and glyphs (their anchor point), and frame markers (their
  origin) — and make `hitTest`, the snapper and box select ask the same
  module so nothing invisible is ever under the hand. Compute the
  `Occlusion` once per frame and hand the same one to the draw pass and to
  the next pointer event's pick, rather than recomputing per pick; say how
  staleness is handled (a pick between frames uses the last frame's, which
  is what is on screen).
- **On-the-surface is not behind.** An edge of the solid's own face lies in
  that face's plane: the same half-pixel square-to-plane tolerance the
  hidden-edge pass uses decides it, and the tests at grazing angles carry
  over.
- **The hidden-edge pass is not removed**; it is what `view("hidden")` draws.
- **The empty-canvas hint** hides while a tool gesture is in progress (a
  preview is on screen), as well as when anything exists — found while
  checking the solid previews: the hint sat under a rectangle being dragged.

## Verification

Unit: occlusion for a point, a label anchor, a frame origin; `hitTest`,
snapping and box select skipping a point behind a box and keeping one on its
near face's edge; the three modes' rules. E2e: extrude a rectangle, orbit so
a far corner is behind the solid — read pixels: the far corner's point, name
and edge are not drawn in shaded mode, are drawn in hidden mode, and the
faces are gone in wire mode; a click where the hidden point projects does
not pick it in shaded mode and does in hidden mode; the face colour contrast
measured from pixels; the mode survives a reload and is not in a saved file
or the undo history; the hint gone during a rectangle drag. LOOK at the
screenshots — the extruded box must read as an opaque solid at first glance.
Before/after pictures in the CHANGELOG. Full `npm run test:all`. Docs per
`CLAUDE.md`: CHANGELOG at the top quoting the owner; the register (the
"drawing stays on top of the solid" rule from the hidden-edges package
replaced by the opaque rule, in his words; the modes as viewer state);
STATUS; ARCHITECTURE's rendering section; `help()`; this file marked built.

## Delivery

Isolated worktree, branch `claude/opaque-solids` off the working-branch tip,
one PR against `claude/resume-tasks-o7q02e`. Do not merge; the supervising
session reviews. Another package (`feature-dialog.md`) runs at the same time
and owns the tools, the options panel and the Enter/Escape keys; stay out of
`src/tools/` except where picking is called, and out of `src/panels.ts`.

## As built (2026-11-02)

Branch `claude/opaque-solids`. In `src/tools/` only `engine.ts` changed, and
only where it picks: an `occlusion` field passed to `hitTest`, `findSnap`,
`selectInBox` and `placeGlyphs`. Nothing in `panels.ts`, the tools, or the
Enter/Escape handlers.

**Measured.** WCAG contrast, the box seen from (1, −2, 1.5), read off the
composed screenshot in the e2e browser (`opaque.e2e.ts`; the same numbers
`faces.test.ts` computes from the constants), against the background
`#0a0e13`:

| | before (computed) | after (measured) |
|---|---|---|
| lid | 1.96:1 | 6.75:1 (`141,154,169`) |
| front wall | 2.22:1 | 8.87:1 (`164,177,191`) |
| right wall | 1.74:1 | 5.01:1 (`118,131,147`) |
| lid / front, lid / right, front / right | 1.13, 1.13, 1.28 | 1.31, 1.35, 1.77 |
| edge-on, square-on | 1.38, 2.62 | 2.58, 12.37 |
| solid edge ink `#1b2530` on the three faces | — | 5.4, 7.1, 4.0 |
| sketch ink `#afc6d9` on the three faces | 5.6, 5.0, 6.3 | 1.6, 1.2, 2.2 — hence the casing |

**What differs from the text above, and why:**

- ⚠ **`view` was already taken**: it was the camera object in the command
  scope (`view: h.view`). The spec's `view("shaded")` is the command now, and
  the camera is `camera`. Nothing in the suite, the docs or `help()` typed
  `view.` at the command line.
- ⚠ **A casing under light marks, not in the spec.** The spec keeps sketch
  colours on a solid; on the new light body they measured 1.2–2.2:1 and the
  first screenshot showed a sketch on a lid barely there and a name on a wall
  unreadable. Where faces are drawn the entity pass runs twice — every mark's
  casing first (the background's colour, a little wider: invisible off the
  solid), then every mark — so sketch colours stay and stay legible. A plain
  sketch skips it (the hidden-edge golden is still pixel-identical).
- ⚠ **The hidden ink's ground moved** from the faces' middle tone to their
  darkest (`HIDDEN_GROUND = faceRGB(0)`). With the light body the middle tone
  was within a few levels of a non-default frame's grey, and a hidden frame
  arm dimmed to itself; found by the hidden-edge e2e test.
- **The hidden mode draws the solid's edges dark too** — "today's look" with
  today's light faces would put light edges on light faces. Its hidden runs
  are its edges' inks taken toward the ground, as before.
- **Which edges are "the solid's own"**: whole profile members, twins and
  extrude walls. A profile member that is a *portion* of a longer line (a
  region split by a crossing) keeps its sketch colour, since most of that
  line may be off the solid; points keep theirs (targets, not outline).
- **A frame's marker is hidden by its origin** as the spec says, and also
  loses an arm's head and letter when that arm's tip is hidden; the rest of
  the arm is an edge, its hidden part not drawn.
- **Where an edge picks**: at the place on it nearest the cursor, if that is
  in sight. Box select takes an edge by its visible runs (`visibleRuns`): a
  crossing box must touch a visible run, a window must contain the whole edge
  and see some of it.
- **A projected snap** (a vertex off the sketch plane) is refused when the
  vertex is hidden, and when its foot on the plane is.
- **The hint** is hidden when the overlay draws anything in an empty model —
  counted at the 2D context's drawing calls while `renderOverlay` runs — so
  a selection box on an empty canvas hides it too.
- **Staleness**: `render` sets `engine.occlusion`; a pick between frames uses
  the last frame's, which is what is on screen, and every change to the model
  or camera redraws before the next pointer event. A tool's own `ctx.pick`
  uses the same.
- **The fillet e2e in `regen.e2e.ts`** aims at a base corner that is now
  behind the lid; it types `view("hidden")` first, as a user would.

**Left deliberately:**

- Region picking (`regionAt`, the extrude/revolve/sketch tools' click inside
  a loop) does not consult occlusion: a click inside a lid's loop finds the
  lid's region whatever lies behind it, and a loop wholly behind a solid can
  still be the region under a click. Faces are not the drawing; the regions
  are a separate question, and the feature-dialog package owns those tools.
- The casing is drawn under hover-lit (amber) marks too, and under a frame's
  letters and name; it is not drawn under glyph boxes (which have their own
  fill) or dimension witness lines (already dark).
- The casing pass runs `inkRuns` a second time for every edge; not cached.

