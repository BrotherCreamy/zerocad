# Plan: sketch on a solid's face

> **Revised 2026-11-04 by [`frameless-curves.md`](frameless-curves.md)**: the
> sketch tool and the menu item type `workplane("a.b.c")` — the work plane set
> to the same three points, journalled, no frame made — where they typed
> `plane(a, b, c)`.

**Status: built** (2026-10-21) — `src/sketchface.ts`, `src/tools/sketch.ts`,
the menu item, `test/sketchface.test.ts` and `test/e2e/sketchface.e2e.ts`.
Deviations, each marked ⚠ where the text below was written before the code
and in the register's queue entry: the helper takes the **line of sight**
(`toward`), not the view; the preferred triple is **a corner and its two
neighbours**, not the first three vertices; the tool **types** its command
through a new `ToolContext.run`, and `regionAt` reports the `toward` it looked
along; a whole circle lying *off* its own frame's plane is refused; and the
outward-boss assertion measures the lid frame's origin across the wall's
plane, not straight-line.

First of the register's "Next up" queue;
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
  ⚠ *As built: `sketchFrameFor(model, loop, toward)` in `src/sketchface.ts` —
  the line of sight (`viewAxes(view).toward`) rather than the view, because
  the tool asking has no camera: the engine's `regionAt` now reports the
  `toward` it looked along with the region. And "preferring the vertices in
  loop order" became **the first corner (a vertex not on a straight run) with
  its two neighbours**, swapped to face the viewer — the first-three-vertices
  reading, swapped, put the sketch's +x along the face's diagonal whenever the
  face was seen from its back, and `lookAt` then showed a wall tipped by its
  own aspect ratio (found in the e2e screenshot). Any three vertices, then
  arc centres (a lens has only two vertices), are the fallbacks.*
  - **A whole-circle loop** has only its centre. It also has its `plane` frame.
    Use that frame's own three points (`origin`, `xref`, `yref`), swapping
    `xref` and `yref` when the frame's +z faces away — so a lid that is a
    circle still gets a plane facing out. (A frame with no `yref` — 2D-style —
    cannot be flipped that way; refuse, naming the frame.)
    ⚠ *As built, also refused: a circle whose centre is off its frame's plane.
    A circle is held only parallel to its frame (the frame is an orientation,
    not a constraint), so its frame's points are then not on the face. A 3D
    frame always has a y-ref, so the no-`yref` refusal can only be reached by
    a 2D model, which is refused before it.*
- **The tool: `sketch`** (`arm("sketch")`; it appears on the toolbar and in
  `tools()` by registering, as every tool does). Extrude's gesture exactly:
  hovering outlines the region under the cursor (reuse extrude's outline
  drawing; share rather than copy), one click inside commits. The commit is
  **what `plane(a, b, c)` typed would do** — frame, default, `lookAt` — and
  journals the same entry; return the frame name; the log shows it as the
  typed call. A click outside any region is refused in the log, as extrude's
  is. The tool's hover must distinguish "this loop" from "the loop it is
  inside" as extrude does (innermost, then nearest).
  ⚠ *As built: a tool could not do "what `plane` typed would do" — `lookAt`
  is the camera's, and no tool holds it — so the tool types the line:
  `ToolContext.run` (new; the host's `submit`, the menu's very seam). The log,
  the recall history, the journal and the one undo step are then the typed
  call's because it is one. Headless, with no `run`, the tool refuses.*
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
first solid's centroid than the wall is). ⚠ *As built: the lid frame's
origin twins one of the wall frame's points, a plate **corner**, which is
farther from the centroid than the wall's middle whichever way the boss goes
— so straight-line distance cannot tell out from in. The tests measure the
lid frame's origin across the wall's plane (along its outward normal), and the
boss's lid centre straight-line.* ⚠ *On the midpoint case: `loops.ts` joins
at shared points and coins only, so a point held on an edge by `on` is no
vertex (a T splits nothing); the honest collinear case is an edge drawn as two
lines through a point, which is one five-member loop.* Then the same by the
context menu.
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
