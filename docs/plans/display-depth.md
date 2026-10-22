# Plan: display depth done right

**Status: queued** (2026-10-22). Last of the register's "Next up" queue:
*"The 355° cap limit, hidden edges showing through faces, and interpenetrating
solids all trace to painter's sorting. The honest fix is a real depth pass
(BSP split or a WebGL conversion of faces.ts's output). Measure before
choosing."* Read `CLAUDE.md`, `docs/ARCHITECTURE.md` (rendering, and the
"faces are display only" rule), `docs/plans/3d-phase4-extrude.md` and
`3d-phase5-revolve.md`, `src/faces.ts` end to end (`Face`, `featureFaces`,
`orderedFaces`, `facesToDraw`, `faceColour`, the cap sort and its documented
limits), the face-drawing pass and `sizeCanvas` in `src/main.ts`,
`src/view.ts` (orthographic: `viewAxes`, `worldToScreen`, `depth`),
`scripts/singlefile.mjs`, `test/e2e/harness.ts`, and the register's 3D
entries in `TODO.md` (the 355° note, the interpenetration note, "hidden edges
show through").

## The choice, and why it is WebGL

A painter's sort over whole faces cannot be right for interpenetrating faces
or for a sweep that wraps round in front of its own cap: the order it needs
does not exist. A BSP split would make it exist by cutting faces, at the
cost of a second geometry pass per frame and a per-frame cut of every sweep
strip. A depth buffer answers per pixel, is exact by construction, and
`faces.ts` already produces exactly what one needs — planar outlines in world
coordinates with an outward normal. **So: faces are drawn by WebGL with a depth
test; everything else stays on the 2D canvas, over them, exactly as now.**
Hidden edges still show through — that is the drawing-over-the-solid rule
the register keeps on purpose, and dimming them stays a separate follow-up.

## Design

- **A second canvas under the drawing.** `#faces` (WebGL) sits under `#cv`
  (2D) in `#viewwrap`, same CSS size and the same device-pixel sizing rule
  `sizeCanvas` uses. The 2D canvas becomes transparent where it used to paint
  faces (its clear is transparent; the page background shows through both).
  Panels, hover tag and menu are unaffected.
- **Projection is the view's.** Orthographic, from `viewAxes`: clip x and y
  are `worldToScreen` mapped to normalised device coordinates, clip z is
  `depth` (larger nearer) normalised over the scene's depth range each frame
  (the range from the faces' own points, with a margin), so there is nothing
  new to keep in step with the camera. One matrix per frame, built from the
  same numbers the 2D pass uses.
- **Even-odd caps without triangulation**: a planar face with holes is drawn
  by the stencil method — a triangle fan from any vertex of each outline,
  stencil INVERT, no colour; then the same fans again with the stencil test
  requiring odd, depth test on, writing colour and depth. Exact for every
  outline `faces.ts` produces, no triangulator, no dependency. A wall quad and
  a sweep strip are the same machinery with one outline.
- **Shading is unchanged**: flat per face, `faceColour(dot(normal, toward))`,
  the headlight Lambert, passed as a per-face colour. Back faces are not
  drawn, as now (`orderedFaces` culls); with a depth buffer the cap-lowering
  rule, the per-face nearest-point key and the 355° limit are gone — delete
  that code rather than leaving it idle, and the tests that pinned the sort
  become tests that the picture is right.
- **The painter's path stays as the fallback** where `getContext("webgl")`
  returns null (the one place it is chosen), so the app still draws solids
  without WebGL. Nothing else may branch on it.
- **Faces still never pick, snap, box or wear a glyph.** The WebGL canvas
  has `pointer-events: none`; every pointer listener stays on `#cv`.
- **The single-file build** carries the shaders inline (they are strings).

## Measure before choosing — the numbers this package must produce

Both renderers exist in the tree, so the measurement is direct:
1. **Wrong pixels per view.** For the three register scenes — the 355°
   revolve, two interpenetrating extrudes, and the stepped block with a boss
   on its wall — render N random orbits (say 40) with both paths and count
   the pixels where they differ beyond a small colour tolerance. The depth
   path is correct by construction; the count is the painter's error. Report
   mean and worst per scene, before (painter's) and after (zero, by
   definition, but *prove the depth path agrees with the painter's where the
   painter's is right*: a lone convex solid must differ by only its edge
   anti-aliasing).
2. **Time per frame**, both paths, on the stepped block and on a full-turn
   revolve of a filleted profile (many strips), measured in the browser.
3. **The 355° case and the interpenetration case as e2e pixel tests**: the
   pixel that used to be wrong is now right, with before/after screenshots
   in the CHANGELOG. LOOK at them.
Put the numbers in the CHANGELOG entry and in `docs/ARCHITECTURE.md`'s
rendering section. If a measurement contradicts the choice above (WebGL
unavailable in the e2e browser, or slower than the painter's by more than a
small factor on the stepped block), stop and report rather than shipping.

## Tests

The e2e harness must run with WebGL available (headless Chromium needs its
software GL enabled — find the launch flag, put the reason in the harness)
and an e2e test must assert the depth path is the one in use, so the suite
tests the real renderer and never silently the fallback. Pixel-reading e2e
tests that look at faces (`extrude`, `revolve`, `regions`, `sketchface`)
read the face canvas; those that look at entities or the hint read `#cv` as
now — give the harness one helper for "the composed picture" so tests say
which they mean. A unit test for the projection matrix against
`worldToScreen`/`depth` on random views. Full `npm run test:all`.

## Docs

CHANGELOG at the top with the numbers and the pictures; the queue item
ticked; the register's 3D entry: the 355° limit, the cap-lowering rule and
the interpenetration note replaced by the depth rule; STATUS; ARCHITECTURE's
rendering section rewritten; `faces.ts`'s header rewritten (it describes the
painter's; after this it describes what it derives and who draws it); this
file marked built.

## Delivery

Isolated worktree, branch `claude/display-depth` off the working-branch tip,
one PR against `claude/resume-tasks-o7q02e`, in reviewable commits (the
measurement harness and numbers first — the "before" is evidence; then the
renderer; then the deletions and docs). Do not merge; the supervising session
reviews.
