# Plan: many-at-once is one relation among equals, and a dimension names what it measures

**Status: queued** (2026-11-12). Review items 5 and 6 of TODO.md's register
(*Reviewed against the owner's principle*, 2026-11-09). The owner: *"All
good."* The principle: *"correct relationships BETWEEN entities …
bidirectional relationships everywhere by default"*; nothing privileged,
nothing consumed.

Read `CLAUDE.md`, `docs/ARCHITECTURE.md`, `docs/plans/relations-complete.md`
(#82: many-at-once as a star, and why), `smart-dimension.md` (#84: `fdist`,
`ang3`, faces named `e1.m3`), `click-on-face.md` (#89: `onplane(p,
"e1.m3")`), `constraints-palette.md`, `src/dimensioning.ts`,
`src/relations/solidref.ts`, `src/modules/*.ts`, `src/persist.ts`.

## 5. Many-at-once is one n-ary relation

**True today**: four lines picked and Parallel pressed makes `par(l1, l2)`,
`par(l1, l3)`, `par(l1, l4)` — a star on the first pick. The first pick is
privileged: delete `l1` and the other three are no longer related at all.

**Design**: one relation, `par("l1", "l2", "l3", "l4")`, for every relation
many-at-once offers (Parallel, Equal, Collinear, Coincident, Concentric,
Coradial, Tangent chains where it applies — take the list from
`dimensioning.ts`). No member is first in any way a user can observe:
- one name, one row in the palette, a glyph on each member;
- deleting a member leaves the relation over the rest, down to two; at one
  it is gone;
- adding the relation to a member of an existing group and a new entity
  joins the group (one relation, not two);
- its rows are any spanning set (n − 1 of them), re-formed when a member
  goes; which pairs is not observable and not journalled;
- a conflict names it once; an agreeing set counts it once.
A relation to a frame's axis ("Horizontal (both)") is already symmetric per
member and stays as it is. Old files' stars replay as the separate relations
they were; nothing is migrated. A new format version if the journal's form
changes; say which.

## 6. A dimension names the entities it measures, read when asked

**True today**: a wall is named by its place in the profile (`e1.m3`), so a
trim, split or fillet of the profile re-numbers what `fdist("e1.m3", …)`
and `onplane(p, "e1.m3")` mean; `ang3(corner, a, b)` for two meeting walls
names three points rather than the two lines the walls are swept from.

**Design**: a face is named by what it is swept from — the profile entity —
and resolved to the kernel's face when read: propose the written form (for
example `"e1:l2"` for the wall of line `l2`, `e1.lid` / `e1.base`
unchanged), say why, and make every relation that takes a face take it
(`fdist`, `fangle`, `onplane`, `par` to a face normal, the dimension tool's
picks, the palette's wording). The old `e1.mN` form still reads, in files
and typed, resolved once at replay to the entity then in that place, and is
re-journalled in the new form. The angle between two meeting walls is
`ang(l1, l2, θ)` of their lines measured square to the extrusion (or the
existing `ang` where that is what it already is), not `ang3` of points;
`ang3` remains for three points a user picks. A face whose source entity is
deleted takes its relations with it, said in the log.

## Tests

- Unit, 2D and 3D: n-ary of each kind solves as the star did; member
  deleted, group survives; join; old star file replays; a wall dimension
  survives a split and a trim of its profile line's neighbours; old `e1.mN`
  files reopen and re-save in the new form; save/open round trips.
- E2E, mouse and iPhone 13: four lines, Parallel, delete the first, the
  other three still parallel under a drag; a wall-to-wall dimension, then a
  trim on the profile, the dimension still on its walls. LOOK.

## Docs

CHANGELOG top; STATUS; ARCHITECTURE; the register (items 5 and 6 ticked,
decisions one line each); `help()`; the spec marked built.
