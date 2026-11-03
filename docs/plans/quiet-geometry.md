# Plan: quiet geometry — corners and solid edges show on hover

**Status: built** (2026-11-03) — see "As built" at the end for every place
the build differs from this text, including one scope change the supervising
session directed mid-build (struck through below). The owner, verbatim:

> *I think points ought to disappear when they are the endpoint of a line or
> a corner (except when you hover over them), and lines ought to disappear
> when they form the edge of a solid (except when you hover over them).*

Read `CLAUDE.md`, `docs/plans/effortless.md`, `opaque-solids.md` (as built:
view modes, the dark solid-edge ink, the rim pass), the drawing pass in
`src/main.ts` (points, names, edges, glyphs, frame markers, hover), the hover
and pick path in `src/tools/engine.ts` and `src/picking.ts`, `src/glyphs.ts`,
`src/faces.ts` and `src/facelayer.ts`, and the e2e tests that read point or
edge pixels.

## The rule (shaded mode, the default)

- **A point that is an end of a line or arc, or a corner shared by edges, is
  not drawn** — no dot, no name. It is drawn when the cursor is over it
  (hover), when it is selected, when it is the armed tool's snap target, and
  while it is being dragged. It is still hovered, picked, snapped to and
  dragged exactly as now: quiet is not hidden.
- **A line, arc or circle that bounds a visible face of a solid is not drawn
  as sketch geometry.** The solid keeps a fine edge line at its face
  boundaries, drawn by the face layer as part of the solid (so a box reads
  as a box where two faces shade alike), replacing the entity pass's dark
  ink on those edges. On hover the entity is drawn highlighted as now, with
  its ends; selected, it is drawn selected.
- **Glyphs and labels follow their anchors**: a relation glyph anchored to a
  quiet point or a quiet edge is quiet too, and shows when its anchor is
  hovered or selected. **Dimensions stay visible** — they are the values the
  user edits (`set`, the menu's Set value) — and so do glyphs on geometry that
  is not quiet.
- **Stays as now**: isolated points (no curve uses them), circle and arc
  centres, frame markers, every point and edge of geometry that bounds no
  solid face and is not an end or corner (a lone line's ends are ends, so
  they are quiet; the line itself is drawn).
- **`view("hidden")` and `view("wire")` draw everything**, as now: those are
  the modes for seeing all of it.

## Generated geometry is quiet in name too

From the conversation where the owner asked whether generated edges and
corners should be named entities (the answer recorded on the register: yes —
they are the persistent names that make relations on a solid survive
regeneration — but quiet): `ls()` lists a feature's output under its feature
line as a count with `members("e1")` to expand, rather than one line per
twin. ~~Names of a feature's own entities show on hover or selection only
(the rule above already does this for ends and corners; it covers a wall's
midpoint label and the like).~~

**Dropped mid-build, at the supervising session's direction**, from the
owner's latest reasoning — *"why is a 3D corner any different from a 2D
corner"*: nothing is treated differently because a feature made it. Quiet is
decided purely by geometric role — an end of a line or arc, a corner shared
by edges, an edge bounding a visible face — the same rule for a sketch corner
and a lid corner. The `ls()` change stays: that is grouping, not visibility.

## Verification

Unit: the quiet rule per entity kind and state (end, corner, isolated,
centre; on a face, off a face; hovered, selected, snap target); glyph
anchoring; `ls()` grouping. E2e: a rectangle — no corner dots until hovered,
then the hovered corner's dot and name; drag a corner (it moves, dot shown
while dragging); extrude it, orbit — no sketch lines over the solid's edges,
the fine edge line present (pixels), a hovered edge highlighted with its ends;
a parallel glyph on a profile line hidden until that line is hovered; the
depth dimension visible throughout; `view("hidden")` shows everything; snap
to a quiet corner with the line tool. LOOK at the screenshots — the owner's
plate with a hole should read as a clean solid. Full `npm run test:all`.
Docs per `CLAUDE.md`: CHANGELOG at the top quoting the owner; the register
(the quiet rule; generated geometry stays named, and why); STATUS;
ARCHITECTURE's rendering section; this file marked built.

## Delivery

Isolated worktree, branch `claude/quiet-geometry` off the working-branch tip,
one PR against `claude/resume-tasks-o7q02e`. Do not merge; the supervising
session reviews. The groups package is concurrently adding the selection
highlight and hidden entities to the same drawing pass: keep your change to
the visibility rule and the face layer's edge line, and expect to merge with
its selection state ("selected" in the rule above is its selection).

## As built (2026-11-03)

Branch `claude/quiet-geometry`. The rule is `src/quiet.ts` (pure, at
glyphs.ts's height); the draw pass in `src/main.ts` asks it once a frame;
`Face.edges` in `src/faces.ts` and both renderers in `src/facelayer.ts` draw
the solid's fine edge line; `Glyph.about` in `src/glyphs.ts` is what a glyph
follows; `engine.armedUnder` and `engine.dragging` in `src/tools/engine.ts`
are two more reveals; `ls()` and `members()` in `src/replenv.ts`. Nothing in
`src/operations.ts`, `hitTest`, `findSnap` or `selectInBox` changed.

**What differs from the text above, and why:**

- ⚠ **Supervisor-directed: nothing is quiet because a feature made it**
  (struck through above). Quiet is geometric role only. Since
  `lid-frame-shares-points.md` merged, a sketched outline's lid frame stands on
  its corner twins and the lid is clean; where the sketch frame stands off
  the profile the lid frame's own points end nothing and are drawn, as any
  isolated point is.
- ⚠ **A quiet glyph is still picked, and drawn while it is hovered.** The
  text has a glyph show "when its anchor is hovered or selected"; alone, that
  makes it unreachable: a line picks 5 px out (`PICK_LINE`) and a mark's box
  starts `GLYPH_OFFSET − GLYPH_HALF_H` = 7 px out, so the cursor crosses two
  pixels where nothing is hovered, the mark goes quiet, and there is nothing
  to arrive at. So it picks as a quiet corner does ("quiet is not hidden"),
  and hovering it lights its lines too.
- **What is under an armed tool's cursor reveals too** (`engine.armedUnder`),
  beyond the snap target: hover stops while a tool is armed, and the fillet
  tool, which aims at corners, opts out of snapping, so without it a corner
  the fillet tool is aimed at would never show.
- **A centre wins over an end**: a point that is a circle's or arc's centre
  and also a line's end is drawn. The text keeps centres; a circle whose
  centre went quiet would have no mark at its middle.
- **The face layer's edges are face boundaries, not the solid's entities.**
  Each face says which of its sides are edges (`Face.edges`): a cap's
  outlines, a wall's base and twin sides and its side at a profile vertex, a
  sweep's rims and the circles its vertices sweep. So a revolved block shows
  the circles its corners turn through (no entity draws those), and a hole's
  wall has no seam where a whole circle closes. A full turn's profile draws
  no line (it is a seam, not an edge), and its members are quiet as a
  solid's edges.
- **The edge line is 1.2 px of `SOLID_EDGE`** (`SOLID_EDGE_PX`): thin quads
  square to the line of sight in the depth layer (GL's line width is the
  driver's), with a polygon offset on the faces; a stroke after each fill in
  the painter's. In the hidden view it is drawn too, under the entity pass's
  own dark ink on the same edges.
- **One `members`, the groups package's**, which reads a feature as a
  read-only group of what it made, its dimension included; `ls()`'s count is
  of exactly that list, with `, N hidden` when some are. (Built first with a
  `members` of its own for features; dropped at integration.)
- **The plain-sketch golden is unchanged.** The text expected to update it;
  it was recorded in the default view, which is now the one that leaves
  corners out, so the golden test types `view("hidden")` first — which draws
  everything, as before — and still matches to the pixel, and a new test
  holds the shaded picture to differ from it only inside the quiet corners'
  dots, names and anchored marks, and at every one of them.
- **"Selected" is the groups package's selection**, integrated after both
  merged (built against a stub): a selected quiet thing is drawn in the
  selection's violet, and a selected glyph is drawn. **Hidden outranks
  revealed** (`entityDrawn` in quiet.ts) — not in the text, which predates
  `hide`. Hiding a solid's sketch leaves its base outlined by the face layer
  (tested and looked at).

**Left deliberately:**

- Silhouettes of curved walls (a cylinder's sides, a hole's inner wall seen
  obliquely) get no edge line; shading carries them. Nor does the line where
  two solids pass through each other — it is no face's side.
- A revolve's vertex circles are drawn at every profile vertex, tangent joins
  included; so is an extrude's wall line, as its wall entity always was.
- Frame markers, their letters and names stay drawn, lid frames included.

**Counts.** Unit 911 → 927; e2e 358 → 367, all passing (the full e2e run took
13 minutes on a box shared with two other workers). The tests hold the edge
line's darkest pixel at least two thirds of the way from the lid's fill to
`SOLID_EDGE` — a 1.2 px line anti-aliased across two pixels reaches its full
ink in neither.
