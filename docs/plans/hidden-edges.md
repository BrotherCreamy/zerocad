# Plan: hidden edges, dimmed

**Status: built** (2026-10-22) — see "As built" at the end for the numbers
and for what differs from this text. The follow-up every 3D package since phase 4
has deferred: *"hidden edges show through faces; dimming them is its own
follow-up."* Read `CLAUDE.md`, `docs/ARCHITECTURE.md`'s rendering section
(as rewritten by display depth), `docs/plans/display-depth.md`,
`src/faces.ts` (`visibleFaces`, `Face.outlines`, `Face.normal`),
`src/facelayer.ts`, the entity-drawing pass in `src/main.ts` (the wireframe
over the faces; `entityDepth`, `stroke`, `weight`), `src/view.ts`, and the
e2e oracle `nearestFaces` in `test/e2e/harness.ts` — which already does, in
a test, exactly what this package needs in the app.

## The rule, and what it keeps

**The drawing stays on top of the solid, and what a hand aims at is never
behind a face**: every edge, point, name and glyph is still drawn over the
faces, still picks, snaps and drags exactly as now. What changes is only the
*ink*: **the part of an edge that lies behind a face is drawn dimmed**, the
way a drafting convention shows a hidden line, so a shaded solid reads as a
solid and the sketch under it stays legible. Points and names are never
dimmed (a dimmed name is unreadable, and a point is a target); glyphs are
never dimmed. Frames' arms are edges and dim like edges.

## Design

- **Occlusion is a question asked of the faces, on the CPU, per sample** —
  `visibleFaces` already hands over planar outlines with normals. A point on
  an edge is *hidden* when the pixel's ray meets a visible face nearer the
  viewer than the point itself, by more than a tolerance scaled to the
  drawing (the face the edge itself bounds must not hide it: an edge lies
  *in* its own faces' planes, so "nearer by more than ε" settles it, with ε
  documented and tested at grazing angles). Lift the oracle's method out of
  the harness into a pure module (`src/occlusion.ts`, say): screen-space
  boxes, even-odd inside test per outline set, depth of the plane at the
  pixel; the harness then imports it rather than keeping its own copy — one
  implementation, tested in Node, used by the app and by the tests' oracle.
- **Edges are sampled, not solved**: a line at every few pixels along its
  screen length, a curve at its existing `arcSamples`; each sample asks the
  question; consecutive samples with the same answer are one run; runs are
  stroked in full ink or dimmed ink. The seam between runs is at the sample,
  not at the true crossing — a few pixels of slack, which is the resolution
  of the convention anyway. Document and test that the slack is bounded by
  the sample spacing.
- **Cost is measured, not assumed.** Samples × faces per frame, with screen
  boxes culling most pairs. Measure frames on the stepped block, the boss on
  a plate, and the filleted full-turn revolve (hundreds of strips), before and
  after; it must stay within a small factor of the faces' own cost. If the
  full turn is too slow, cull strips by box first and say what the number is.
- **The dimmed ink** is the edge's own colour at the faces' ground level
  (choose a mix that reads as "behind" on both an armed/lit edge and a plain
  one — amber hover stays amber, dimmed). No dashes: dashes at this stroke
  width turn to noise on a curved sweep.
- **Off when there are no faces**: a plain sketch draws exactly as today, and
  the pass costs nothing.
- Nothing changes in `faces.ts`, `facelayer.ts`, picking, snapping or the
  tools. The painter's fallback gets the same dimming (it is the same 2D
  pass).

## Verification

Unit (`test/occlusion.test.ts`): a point behind a box's near face is hidden,
one on the far face's edge seen through is hidden, one on the near face's own
edge is not, a point on a plain sketch (no faces) is not, grazing angles with
the ε; run-splitting on a line crossing behind a box gives three runs with
the seam within one sample spacing of the true crossing. E2e: the stepped
block and the boss, orbited so the far edges run behind — read the 2D
canvas: a pixel on a hidden run is the dimmed colour, one on a visible run is
full ink, a point's dot behind a face is still full ink; the sketch with no
solid is pixel-identical to before (the same picture as the previous build's
screenshot of the same scene). LOOK at the screenshots: the solid must read
as a solid. The frame-time numbers in the CHANGELOG. Full `npm run test:all`.
Docs per `CLAUDE.md`: CHANGELOG at the top with numbers and pictures; every
"hidden edges show through" caveat on the register and in STATUS replaced
by the rule; ARCHITECTURE's rendering section; this file marked built.

## Delivery

Isolated worktree, branch `claude/hidden-edges` off the working-branch tip,
one PR against `claude/resume-tasks-o7q02e`. Do not merge; the supervising
session reviews.

## As built (2026-10-22)

Four commits: the frame measurement (the "before"), the plain sketch recorded
by the build before the pass, the pass, and per-edge culling with the pass's
own cost measured. Nothing in `faces.ts`, `facelayer.ts`, picking, snapping or
the tools changed. The numbers are in the CHANGELOG; in short, the pass costs
1.2 ms a frame on the stepped block and 2.3 ms on the filleted full turn
against the faces' own 0.5 and 3.7 ms, and the frame interval did not move
beyond its noise. What differs from the text above:

- **"Nearer by more than ε" is measured square to the face's plane, not along
  the ray.** The two have the same sign for a face that faces the viewer, but
  along the ray the quarter-pixel by which a curve's drawn polyline and its
  strip's outline disagree is multiplied by 1/cos of the grazing angle — at a
  degree off edge-on, a dozen pixels — so a strip seen nearly edge-on would
  hide its own boundary. ε is half a pixel of world, square to the plane;
  tested at about a degree off edge-on and at three zooms. The price: a
  sliver face hides only what is well behind it.
- **The seam is half-way between the two samples that disagree**, not at a
  sample: free, and it halves the slack, to 2 px. The test still asks for
  "within one sample spacing" (4 px) and checks the half on 40 random lines.
- **A curve's drawn samples are subdivided too** where they are more than
  4 px apart on screen (a large arc's quarter-pixel samples can be 20 px
  apart): one rule for every polyline, so the slack bound is the same for a
  curve as for a line.
- **Faces are culled by box per edge as well as per sample**, which the spec
  offered for the full turn if it was slow. It was not slow (the pass was
  about 1× the faces' cost there before the cull too); it went in because 238
  samples × 860 strips of box tests a frame for 2 650 survivors is waste. Its
  own effect was not separable from the shared machine's noise.
- **"The boss on a plate" is a new scene** (`boss-plate` in
  `test/e2e/scenes.ts`, a 60 × 40 × 8 plate with a boss r 10 × 15 on its lid),
  added last so the depth measurement's seeded views are unchanged; "the
  stepped block" is the existing `stepped-boss`. `appFrames` moved from
  `depth.measure.ts` into `scenes.ts` so both measurements time frames the
  same way.
- **Frame time was measured alternately** — the build before and this one,
  three rounds, by swapping `main.ts` (the only file the pass touches in the
  app) — because the machine was shared and its load ran from 5 to 12; and
  `render()` alone cannot say which part of it is the pass, so the pass was
  also timed by itself in the page against the faces' own work.
- **"Pixel-identical to the previous build's screenshot"** is held against the
  drawing canvas the previous build drew, recorded in its own commit before
  the pass existed (`test/e2e/golden/hidden-plain-sketch.png`), compared
  pixel for pixel, decoded in the page. It is tied to the e2e browser.
- **The dimmed ink** is the edge's colour 40% of the way from `faceRGB(0.5)`,
  a solid colour (not transparency: a hidden run must be one colour over any
  face, and a partly covered pixel of a full stroke must not look like it).
- **A frame's arrowhead takes the ink its arm reaches the tip in**; its
  letters, like names, keep their colour.
- **The e2e tests choose their hidden points by geometry** — an edge both of
  whose faces are turned away from a camera written down in the test, whose
  pixel the oracle says is on the solid — never by asking the module that
  dims them. Some sample points were moved off places where a glyph or a name
  sits on the edge (a dimension's label, a frame point's name), found by
  looking; the test comments say where.
- **Found:** an edge hidden but ending on the silhouette keeps a stub of full
  ink up to 2 px long at that end (the base's back edge where the right wall
  turns toward the viewer) — the seam's slack, documented rather than
  bisected away.
