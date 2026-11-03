# Plan: quiet geometry — corners and solid edges show on hover

**Status: queued** (2026-11-03). The owner, verbatim:

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
twin; names of a feature's own entities show on hover or selection only (the
rule above already does this for ends and corners; it covers a wall's
midpoint label and the like).

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
