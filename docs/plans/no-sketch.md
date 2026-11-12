# Plan: there is no sketch — geometry, planes it is drawn on, and groups it belongs to

**Status: queued** (2026-11-12). The owner: *"There is no such thing as a
sketch. There are geometry groups (you can come up with a better name… reason
I don't want to use sketch is it implied exclusivity, but I want geometry to
be able to belong to multiple groups). A group is only fully defined when
every element within the group is fully defined."* Earlier: *"the default for
sketch entities is no plane. Every sketch is a 3D sketch, unless you enter into
active on-plane constraint."*

## What is true today

- The model already has no sketch. Geometry is entities in one flat registry;
  a **group** (`src/groups.ts`, `docs/plans/groups.md`) is a set that owns
  nothing, an entity may be in any number of groups, and a group never holds a
  group. A plane is only where a click lands (`drawingPlane`, `workPlane`) and
  an `onplane` relation if one is made. This is the owner's model exactly.
- **The word is everywhere the user looks.** A "sketch tool" (`src/tools/
  sketch.ts`) that picks a plane; "Sketch mode is the work plane, not a
  feature" in `help()`; "Sketch on this face" in the face's menu; a "Sketch"
  workbench; `sketchPlaneRef`, `sketchOnFaceCommand`, "sketch editing" in
  module and plan names (`sketch-edit.md`, `sketch-mode.md`, `sketch-on-face.md`,
  `sketch-relations.md`, `sketch-shapes.md`). Every one says to a person
  that there is a container called a sketch that geometry is inside, which
  the owner has now said twice is not so.
- Nothing says whether a group is defined. The status counts the whole
  drawing's freedoms (`N free`); the organiser's group row shows a count and
  an eye.

## Design

1. **The word goes from everything a person reads.** What the "sketch tool"
   does is choose **a plane to draw on**; it is the Plane tool (icon as now),
   its chip already reads `on f1` / `on e1.lid`. "Sketch on this face" →
   **"Draw on this face"**. `help()`'s "Sketch mode" → "drawing on a plane".
   The "Sketch" workbench → **"Drawing"** (or dropped: the Part bench has
   every tool). The module keeps its id `sketch` for files that name it
   (`ui({ modules })`), with the label changed; a rename of the id is a
   format change and not worth it.
2. **Code names follow where cheap**: `sketchPlaneRef` → `drawingPlaneRef`,
   `sketchOnFaceCommand` → `drawOnFaceCommand`, `sketchedit.ts` →
   `editdraw.ts` already exists for part of it. Plan files are history and
   keep their names; each gets one line at the top saying the word is
   retired and pointing here.
3. **A group's definedness is a reading, not a count of its own**: a group is
   fully defined when every member is — each member's freedoms, as
   `Model.diagnose()` already finds them per variable, are zero. The
   organiser's group row shows it (a filled dot for defined, hollow for not,
   with "3 free" on hover/tap), and a group's menu has *Select what is free*.
   No new solve, no new relation. The owner: *"Should be trivial to
   calculate this stuff but it's not a concern of mine now"* — so this is the
   last item, and it does not block the renaming.
4. **The drawing's own count stays as it is** (`N free`), including
   `gaugePlanes`' exclusion of the flat drawing's freedom to leave its plane.
   Asked on 2026-11-12 and answered "not a concern of mine now": left, and
   the question is closed in the register.

## Tests

- No user-facing string contains "sketch" (a test greps the tool names,
  summaries, how-lines, menu labels, `help()` text, status and chip text, and
  the workbench labels); the module id `sketch` is allowed and the only
  exception.
- The Plane tool, the face menu's "Draw on this face" and the chip, by mouse
  and by finger, in pictures.
- A group of a fully defined rectangle shows defined; drag one corner free
  (delete a relation) and the row shows "1 free"; *Select what is free*
  selects that point.
- Old files that saved `ui({ modules: ["sketch", …] })` or a workbench by
  name still open.

## Vetoable

- "Plane" for the tool and "Draw on this face" for the menu item (the owner
  invited a better name than "geometry group" too; "group" is kept, as it
  is already the organiser's word and the owner's own in `groups.md`).
- The "Sketch" workbench becomes "Drawing" rather than going.
- The module id `sketch` stays in files.
