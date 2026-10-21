# Plan: sketch on a solid's face

**Status: queued** (2026-10-21). First of the register's "Next up" queue;
the gesture every stacked feature in Onshape starts with: pick a face, sketch
on it, extrude. Read `CLAUDE.md`, `docs/ARCHITECTURE.md`, the 3D roadmap and
phases 3–5 (`docs/plans/3d-*.md`), `src/loops.ts` (`findLoops`, `loopAt`),
`src/tools/extrude.ts` (the click-inside precedent and the `regionAt` hook in
`src/tools/engine.ts`), `src/faces.ts`'s header ("faces are display only"),
`src/menu.ts` (`emptyCanvasMenu`, `sketchOnItem`, `menuFor`), and
`replenv.ts`'s `plane()`/`frame()`/`lookAt`.

## The shape of it, and why there is no face to pick

The register said faces would "need to pick first". They do not, and the
reason is worth keeping: **a face is not an entity, but every planar face of a
solid is a closed loop of real entities** — a lid is its twin loop, a wall is
the quad of a profile edge, two side edges and the twin edge, a partial
revolve's end is its turned twins — and `loopAt` already finds the loop under
a pixel. The extrude tool's precedent holds exactly: a face is something a
*tool asks about*, not something the canvas selects. A plain sketch loop (no
solid yet) is a face in the same sense, and sketching on it must work too.

And **a frame built from three of the loop's own points is the sketch plane**:
`plane(a, b, c)` — origin, x-ref, y-ref — journals as the ordinary call it is,
needs no new entity kind, and *follows the solid* because its points are the
solid's (a datum, read never pushed, as every frame is). Nothing about faces
is stored; the journal carries three names.

**Orientation: +z toward the viewer.** A sketch plane on a face must have its
normal pointing *out* of the solid, so a positive extrude on it adds material
outward (Onshape's behaviour). Back-face culling makes this free: the only
faces that can be clicked are the ones facing the camera, and a visible face's
outward normal faces the viewer. So the rule is one rule for solids and plain
loops alike: order the three points so `(b − a) × (c − a)` points toward the
camera (swap b and c if not). Write this reasoning down in the code; it is the
whole trick.

## Design

- **One helper, pure, in `src/loops.ts` or a sibling: `sketchFrameFor(model,
  loop, view): [a, b, c]`** — three non-collinear point names from the loop's
  members (line ends, arc ends; a circle contributes its centre — see below),
  preferring the loop's vertices in loop order, oriented toward the viewer by
  the rule above. Throws with a named reason when no three non-collinear
  points exist. Tested without a DOM against tilted loops and both
  orientations.
  - **A whole-circle loop** has only its centre. It also has its `plane` frame.
    Use that frame's own three points (`origin`, `xref`, `yref`), swapping
    `xref` and `yref` when the frame's +z faces away — so a lid that is a
    circle still gets a plane facing out. (A frame with no `yref` — 2D-style —
    cannot be flipped that way; refuse, naming the frame.)
- **The tool: `sketch`** (`arm("sketch")`; it appears on the toolbar and in
  `tools()` by registering, as every tool does). Extrude's gesture exactly:
  hovering outlines the region under the cursor (reuse extrude's outline
  drawing; share rather than copy), one click inside commits. The commit is
  **what `plane(a, b, c)` typed would do** — frame, default, `lookAt` — and
  journals the same entry; return the frame name; the log shows it as the
  typed call. A click outside any region is refused in the log, as extrude's
  is. The tool's hover must distinguish "this loop" from "the loop it is
  inside" as extrude does (innermost, then nearest).
- **The menu item: "Sketch on this face"** in the empty-canvas menu (the one
  shown when nothing is under the cursor), present only when the right-click
  landed inside a region, running the same `plane(a, b, c)` command. This
  needs the menu to be told the region under the click: extend `menuFor`'s
  inputs (the engine's `regionAt` is the source; keep the menu pure and
  DOM-free as it is). The existing frame item "Sketch on this" is unchanged.
- **Undo:** one step, like `plane()`. `del` of the frame leaves the solid
  alone, like any frame. Nothing in `model.ts`, `faces.ts`'s derivation, the
  journal format or persistence changes.
- **Not in scope:** picking faces for selection, snapping, glyphs or boxes
  (faces stay display only); projecting the face's edges into the sketch
  ("use edge"); feature regeneration.

## Verification

Unit: the helper on a tilted square loop both ways round the camera; on a loop
whose first three vertices are collinear (a rectangle with a midpoint on an
edge — `on`-split edges are separate loops? check `loops.ts`'s policy and
test the honest case); on a whole-circle loop both orientations; the refusal.
E2e, the Onshape sequence end to end: `plane()`, draw a rectangle, extrude it,
orbit so a wall faces the camera, arm `sketch`, click the wall, draw a circle
on it (it must land on the wall, which `onPlane`/the working plane give for
free), extrude that circle outward with a positive depth and assert the new
solid's lid frame sits *outside* the first solid (its origin farther from the
first solid's centroid than the wall is). Then the same by the context menu.
Undo in one step. Save/open byte-identity with a sketch-on-face in the
history. LOOK at every screenshot: the poster is a boss on the side of a
plate. Full `npm run test:all` per commit. Docs per `CLAUDE.md`: CHANGELOG at
the top; the register's queue item ticked, with the "faces need to pick first"
note corrected to what was learned; STATUS; this file marked built; the
roadmap's "later" list if touched.

## Delivery

Isolated worktree, branch `claude/sketch-on-face` off the working-branch tip,
one PR against `claude/resume-tasks-o7q02e`. Do not merge; the supervising
session reviews.
