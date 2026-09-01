# Plan: dimension values on the canvas

**Status: shipped, pending review** (2026-09-01). Built as specified, on
`claude/dimension-labels`. The one thing the spec delegated — whether
extension/leader lines earn their pixels — was answered by building both and
looking: **kept, and dashed**. Drawn solid they read as geometry (a `dist`
across a rectangle's diagonal drew what looked like a diagonal edge that does
not exist); dashed and dim they read as annotation, and that same diagonal is
where they earn their keep, since a `dist` need not lie along any line and
nothing else says which two points a floating number belongs to.

Two corrections to the spec, both recorded in `CONVERSATION_LOG.md`: `ang`
takes **radians**, not degrees, so the label converts and is deliberately not
what you would retype (flagged in the register, and it closes with
retargeting); and `ang` now draws **one** label at the shared corner instead
of the two marks it used to get, since the same number twice answers nothing.
`rad` has no leader line back to its arc — not asked for, and the `R` prefix
already says which dimension it is.

`dist("p1","p2",50)` puts a ↔ mark on the drawing and the 50 nowhere. In
Onshape a dimension *is* its value — the number on the canvas is the whole
point of dimensioning — and the standing rule is that tools work like
Onshape. This package makes the dimensioned relations (`dist`, `rad`,
`ang`) draw their value.

Read `CLAUDE.md`, then `docs/ARCHITECTURE.md`, then `src/glyphs.ts` — this
package extends it rather than growing a second overlay system.

## Design

**A dimension label is a glyph that says its number.** The glyph system
already places marks per relation, already hovers, already clicks (a click
drops the relation's name in the command line), and already has one switch
(`glyphs()`); a separate dimensions overlay would duplicate all four and
then drift. So: in `glyphs.ts`, the three dimensioned ops render as their
formatted value instead of their generic mark —

- `dist` — the value, midway between the two points, offset perpendicular
  to their span (the ↔ mark's spot). Onshape-style thin extension/leader
  lines are wanted only if they earn their pixels at this size; try it,
  screenshot it, and keep whichever reads better. Say which you chose.
- `rad` — `R12` (Onshape's prefix), sitting just outside the rim along the
  radial toward the upper right, the way Onshape places an unattended
  radius label.
- `ang` — the value in degrees with a `°`, near the shared point of the two
  lines (or between the lines' midpoints if they do not share one), since
  degrees are what the command takes.

The *target* value is read from the relation's own `args` (the registry
keeps the call as made — `RelationEntry.args`), so this is pure UI over
data that already exists: no model change, no journal change, no new
relation kind. Format values trimmed (`50`, not `50.000`; keep up to 3
decimals when they are real).

**What a label does NOT do yet: edit.** Clicking one inserts the relation's
name, exactly as every glyph already does — from there `del(name)` and
retyping is today's editing story. Changing a dimension's value in place
(double-click, type, enter — and the owner's own example "radius d4"
suggests *named* dimension parameters eventually) needs a way to update a
relation's target, which touches how relations capture their targets in
closures. That is a design decision for the register, filed by this
package's docs rather than smuggled into it.

Hover/pick: a label participates exactly as the mark it replaced did (top
pick tier, hover tag names the relation). Keep the glyph box sized to the
text so aiming at "120.5" is not aiming at a 16px square that clips it.

## Verification

Unit: label text formatting (trim rules); placement math for the three ops
(dist offset perpendicular; rad outside the rim; ang near the vertex);
`glyphAt` hit-boxes track the text size. E2e: draw a dimensioned rectangle
with a filleted arc and a `rad`; assert the values are on the canvas (pixel
probe or glyph enumeration through the page, whichever the harness already
does more robustly); click a value → its relation name lands in the command
line; `glyphs(false)` hides values too. Screenshots at the next free
`docs/images/` numbers — check what is actually free on YOUR branch tip,
the last packages collided at 29 — showing a drawing that reads like an
Onshape sketch: values on edges, an R on the arc. Look at them. Full
`npm run test:all` per commit. Docs duties per `CLAUDE.md`; add the
register entry (dimension display is a decision) and file the
edit-in-place/named-parameters question under "Decisions needed from the
owner".

## Delivery

Isolated worktree, branch `claude/dimension-labels` off the working-branch
tip, PR against `claude/resume-tasks-o7q02e`. Do not merge; the supervising
session reviews. Expected footprint: `src/glyphs.ts`, possibly
`src/picking.ts` if hit-boxes need the text metrics, tests, docs. Nothing
else is in flight anywhere right now, but keep the footprint tight anyway.
