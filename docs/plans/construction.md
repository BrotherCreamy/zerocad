# Plan: construction geometry — a per-entity flag

**Status: built** (2026-11-04) — the flag on `LineEntity`/`CircleEntity`/
`ArcEntity` with `isConstruction`/`setConstruction` in `src/model.ts`; the
`construction` operation in `src/operations.ts` (and `checkMember`'s and
`givenProfile`'s refusals, fillet's arc); `collect` in `src/loops.ts`; the op
in `src/replenv.ts` and `src/persist.ts`'s table (no format bump); the look in
`src/main.ts`; the hover tag in `src/picking.ts`; the menu items in
`src/menu.ts`; `DRAWING_OPTIONS`/`asArmed` in `src/tools/place.ts` and the six
drawing tools. Deviations, each also in TODO.md's Done entry:

1. **Journalled resolved, not as typed.** `hide` journals what was typed and
   lets replay re-expand; `construction` journals the curves whose flag it
   changed — `construction("g1")` is written `construction("l1", "l2")`. The
   owner, after this spec: *"if it is a group based inherited thing, then
   geometry could be both construction geometry and not construction geometry
   simultaneously"* — so the entry says which entities, and no reading of g1
   at any later step can enter into it. (The *Design* bullet below said "as
   `hide` does"; it expands as `hide` does, and journals differently.)
2. **One spelling, `construction(...names, false)`**, not `real(...)`: the flag
   is a value, and the tools' option is `{ construction: false }`.
3. **Points, frames and relations among the names are passed over**, not
   refused (a box-selected batch, a group's corners); only a call naming no
   line, arc or circle is refused, and the command line logs a point or frame
   named outright as passed over. The menu types the curves only.
4. **A fillet of two construction legs makes a construction arc** (one real
   leg: a real arc). Not in the spec; without it a rounded construction corner
   drew a real arc between two construction lines.
5. **extrude/revolve refuse a construction member by name** (typed, or in a
   profile handed over whole), rather than "in no closed loop".
6. **The casing over a face is a hairline** (0.5px a side, against 1.25): the
   full rim drew a construction line on a solid as a heavy dark line.
7. **The e2e makes the circle not construction in `view("hidden")`**: once the
   rectangle is extruded the circle is under the opaque lid, where shaded
   picks nothing (opaque-solids.md), so its menu cannot be reached there.
8. **Every drawing tool now shows the options panel** (a `construction`
   checkbox, no ✓ ✗) — a direct consequence of the spec's option, and
   `tooloptions.e2e.ts`'s "a tool with no options" became the point tool.

The owner's decision, verbatim:
*"construction geometry should be a per entity flag. at least based on the
name "construction geometry" it implies per entity"*.

It is the escape that a flat model needs once regions follow their geometry
(the region-binding design under discussion): with no sketch containers, every
closed loop on a plane forms regions, so a reference circle drawn inside an
outline would become part of it. Construction geometry is geometry that
**forms no regions** — still a real entity, constrainable, solved, pickable,
snappable — exactly as in every CAD tool. Read `CLAUDE.md`,
`docs/plans/effortless.md`, `groups.md` (as built: hide/show as document state
is the precedent for a per-entity flag), `src/model.ts`, `src/loops.ts` (where
regions are formed), `src/groups.ts`, `src/operations.ts`'s `del` cascade,
`src/persist.ts`, `src/replenv.ts`, `src/menu.ts`, the drawing pass in
`src/main.ts`, `src/quiet.ts`, `src/picking.ts` (the hover tag) and the loops
and drawing e2e tests.

## Design

- **The flag** lives on the entity (lines, arcs, circles; points have no
  regions to form and take no flag — say so if a reason appears otherwise).
  It is **document state**: `construction(...names)` sets it,
  `construction(...names, false)` clears it (or a separate `real(...)` —
  choose one spelling and say why), groups and features expanding as `hide`
  does. Journalled operations, registered in **both** `replenv.ts` and
  `persist.ts`; saved; one undo step each. No format bump (new ops).
- **Loops and regions** (`loops.ts`) ignore construction entities entirely:
  they bound nothing, split nothing, and cross nothing (a construction line
  across a rectangle leaves one region). Every consumer of regions — extrude,
  revolve, sketch on a face, the region lighting, `loops()` — follows for free.
  A feature whose profile member is made construction refuses the change by
  name (a feature's profile cannot stop being a boundary under it) — or
  regenerates without it if the region-binding package has landed first;
  for now, refuse.
- **The look**: construction geometry is drawn **thin and in a muted colour
  of its own, never dashed** — dashes mean selection here (the owner's rule,
  `CHANGELOG` "a shape being drawn is a solid line"). Hover, selection and
  quiet geometry apply to it as to any entity. The hover tag says
  `construction`.
- **Pointer paths**: the context menu on an entity or a selection offers
  *Construction* / *Not construction* (typing the command); a drawing tool's
  options panel gets a `construction` boolean option (declared in
  `static options`), so a circle can be drawn as construction from the start;
  remembered like any option.

## Verification

Unit: the flag set/cleared, journalled, saved, undone; groups and features
expanding; loops ignoring construction entities (a construction circle inside
a rectangle leaves one region; a construction line across it leaves one); a
feature's profile member refused; snapping and picking unchanged. E2e: draw a
rectangle and a circle inside, make the circle construction from its menu,
extrude the rectangle — no hole; make it not construction (from its menu in
`view("hidden")`: the circle is under the opaque lid) — `regen("e1")`
gives the hole (until region binding makes that automatic); draw a circle with
the circle tool's `construction` option on; the look on the dark ground and
on a solid — thin, muted, not dashed; LOOK at the screenshots. Full
`npm run test:all` (give it a two-hour limit). Docs per `CLAUDE.md`:
CHANGELOG at the top quoting the owner; the register (his decision, verbatim);
STATUS; `help()`; this file marked built.

## Delivery

Isolated worktree, branch `claude/construction` off the working-branch tip,
one PR against `claude/resume-tasks-o7q02e`. Do not merge; the supervising
session reviews.
