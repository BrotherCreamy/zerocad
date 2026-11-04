# Plan: construction geometry — a per-entity flag

**Status: queued** (2026-11-04). The owner's decision, verbatim:
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
extrude the rectangle — no hole; make it not construction — `regen("e1")`
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
