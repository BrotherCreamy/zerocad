# Plan: display depth done right

**Status: built** (2026-10-22) — see "Measured — before" and "As built" below
for the numbers and for what differs from this text. Last of the register's "Next up" queue:
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

## Measured — before (2026-10-22)

`npm run measure:depth` (`test/e2e/depth.measure.ts`; `NEOCAD_MEASURE_DIR`
keeps the numbers and pictures). The depth layer (`src/facelayer.ts`) was
written first and not yet wired into the app, so this is the painter's as the
app drew it, against a depth buffer drawing the same faces. Headless Chromium
141 with SwiftShader WebGL — **WebGL was available** (ANGLE on SwiftShader,
8-bit stencil, 4× multisampling). App canvas 1100 × 768, 40 seeded random
orbits a scene. *Wrong* = differs by more than 6 levels and lies further than
1.5 px from every visible face's outline; *different* counts the band too.

| scene | faces (max) | wrong: mean / worst | views with any | different: mean / worst |
|---|---|---|---|---|
| lone box (convex) | 3 | 0 / 0 | 0 of 40 | 2 416 / 3 045 |
| lone cylinder (convex) | 40 | 0 / 0 | 0 of 40 | 12 806 / 17 407 |
| 355° revolve with a bore | 1 700 | 20 / 199 | 13 of 40 | 15 740 / 19 047 |
| two interpenetrating extrudes | 6 | **4 528 / 14 647** | **39 of 40** | 7 718 / 18 193 |
| stepped block + boss on its wall | 22 | 0 / 0 | 0 of 40 | 2 615 / 3 777 |
| full turn of a filleted profile | 1 170 | 0 / 0 | 0 of 40 | 24 682 / 34 914 |

- **Where the painter's is right, the depth layer agrees with it**: on both
  convex solids every differing pixel is on an outline or a seam between two
  strip pieces (the diff pictures show nothing else) — the painter's own
  seam, darker by a few levels where two anti-aliased fills meet, which the
  multisampled depth layer does not have.
- **Interpenetration is the painter's real failure**: wrong in 39 views of 40,
  up to 14 647 pixels — whole slabs of one solid painted over the other.
- **The 355° revolve** is wrong in 13 views of 40, in slivers of wall over the
  start cap across the gap (worst 199 px); the band hides some of it among the
  sweep's dense seams, so the count is a floor.
- **The stepped block with a boss is not wrong** in any of the 40 views: its
  coplanar faces at the shared line are back to back and one is always
  culled. The register's guess that it sorted "as interpenetrating solids do"
  did not show.

**Time per frame** — the app's own frames: the scene built in a fresh app, the
view turned a little each animation frame and `render()` called, 90 frames;
"WebGL taken away" is the same app with `getContext("webgl")` answering null.
Before the depth layer is wired in both are the painter's, so the two columns
are a control on the noise:

| scene | faces drawn | as the app runs | WebGL taken away |
|---|---|---|---|
| stepped block + boss | 22 | 45.6 ms a frame (render 1.16 ms) | 47.3 ms (render 1.31 ms) |
| full turn, filleted | 650 | 251.2 ms a frame (render 7.33 ms) | 249.3 ms (render 6.39 ms) |

The frame is far longer than `render()`: in a browser with no GPU the 2D
canvas is rasterised by SwiftShader in the GPU process, and that, not the
main thread, sets the pace. Timing each renderer on a canvas of its own was
tried first and dropped — forcing a painted frame to finish needs a read back,
and Chrome moves a 2D canvas that is read back into CPU memory, which changed
what was being timed (0.6 ms read-optimised against 12 ms as the app's canvas
is made, the same 22 faces).

## Tests

The e2e harness must run with WebGL available (headless Chromium needs its
software GL enabled — find the launch flag, put the reason in the harness)
and an e2e test must assert the depth path is the one in use, so the suite
tests the real renderer and never silently the fallback. Pixel-reading e2e
tests that look at faces (`extrude`, `revolve`) read the face canvas
(*corrected as built:* `regions` and `sketchface` read only a tool's green
preview, which is on `#cv`, so they read the drawing); those that look at
entities or the hint read `#cv` as now — give the harness one helper for "the composed picture" so tests say
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

## As built (2026-10-22)

Three commits, as asked: the measurement (with the depth layer written but not
yet wired in), the renderer, the deletions and docs. What differs from the text
above, and what was found:

- **"Both renderers exist in the tree" was not yet true** — the depth layer
  had to be written for there to be anything to measure against. It went into
  the first commit as `src/facelayer.ts`, unwired, beside the painter's (moved
  out of `main.ts` unchanged), so the "before" is the app's painter's against a
  depth buffer drawing the same faces.
- **Time per frame is the app's own frames**, not each renderer on a canvas of
  its own: forcing a painted 2D frame to finish needs a read back, and Chrome
  then moves the canvas into CPU memory (0.6 ms a frame read-optimised against
  12 ms as the app's canvas is made, same 22 faces), so the offscreen number
  was of a different canvas. The app is timed instead — `render()` each
  animation frame for 90 frames, once as it runs and once with WebGL taken
  away (the harness's `openApp({ webgl: false })`, an init script making
  `getContext("webgl")` answer null: the fallback's one door, nothing in the
  app branching on a test). With the depth layer wired in:

  | scene | depth | painter's (WebGL taken away) |
  |---|---|---|
  | stepped block + boss, 22 faces | 45.9 ms a frame | 46.0 ms |
  | full turn, filleted, 650 faces | 51.2 ms a frame | 252.9 ms |

  `render()`'s own share is 1–7 ms either way; the rest is the GPU process
  (SwiftShader: no GPU here) rasterising and compositing. The stop rule (more
  than 3× slower on the stepped block) is not close.
- **"Wrong" excludes a band** 1.5 px either side of every visible outline, and
  differences under 7 levels: the painter's anti-aliases against a hair-wide
  stroke and leaves a faint seam between strip pieces, the depth layer
  multisamples. The convex solids (wrong 0 in all 80 views) show the band is
  only that. Along a dense sweep the band also hides some real error, so the
  355° count is a floor.
- **The painter's fallback sorts by centroid**, every face, now that the
  nearest-point key and the cap-lowering rule are deleted as asked — which
  undoes the fix those were for: a lid seen at a grazing angle past its own
  hole's far wall is painted under it again, on the fallback only, and
  `depth.e2e.ts` holds the fallback to being wrong there so the limit is a
  decision rather than a rediscovery. Measured after (same 40 views): the
  interpenetrating extrudes wrong 4 209 mean / 12 079 worst in 38 of 40; the
  355° revolve 0 — the plain key happens to suit that sweep better than the
  rule did.
- **Walls skip the stencil.** A face whose one outline is convex (every wall
  quad and strip piece) is its own triangle fan and goes in one batched draw;
  only caps take the two stencil passes. Same picture, one draw call for the
  walls instead of two per quad. Exact for any outline; `convex` checks.
- **An edge with no outline.** Where one solid passes through another, the
  line they cross along is drawn by neither, and anti-aliased all the same;
  the e2e oracle's outline distance missed it and a first run failed there.
  The harness now also skips a sample whose four neighbours two pixels away
  are not all the same nearest face.
- **The harness reads three pictures**, `"faces"`, `"drawing"` and `"screen"`
  (`app.pixels(of, at)`), the last a real screenshot decoded, and has an oracle
  (`app.nearestFaces`) that casts each pixel's ray against the visible faces'
  planes, so a picture is checked without trusting either renderer
  (`checkPicture`).
- **The register's guess about the stepped block did not show**: its coplanar
  faces at the shared line are back to back, one always culled; wrong 0 in 40
  views before as well as after.
- **The single-file build** needed nothing: the shaders are strings in
  `facelayer.ts`, the canvas is in `index.html`'s body, which the build copies.
  Opened from disk it reports the depth layer and fills the faces canvas.
- **Hidden edges still show through**, as the plan said: the drawing-over-the-
  solid rule. Dimming them is the separate follow-up it was.
