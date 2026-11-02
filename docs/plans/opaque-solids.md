# Plan: a solid looks like a solid — opaque, by default

**Status: queued** (2026-11-02). The owner, verbatim, two messages in a row:

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
