# Plan: groups — named sets in a flat model, and the selection they need

**Status: phase 1 built** (2026-11-03) — `src/groups.ts` (new: `group`,
`addTo`, `removeFrom`, `ungroup`, `members`, `groupsOf`, `hide`, `show`);
`GroupEntry`, `groups`, `hidden`, `expand`, `membersOf` and the group
primitives in `src/model.ts`, whose `deleteEntity`/`deleteRelation` journal a
`removeFrom` for each group a name leaves; `Selection` and `SELECTION`
(`#c46cff`, a violet) in `src/tools/selection.ts`; the engine's `selection`,
`composing` and `select`; the menu's Group/Delete/Hide, Select g1 and Show
all; the Delete key; hidden left out of the pick, the snapper, the box, the
glyphs, the faces, the draw pass and region clicks. Phase 2 is not started.
Deviations, each also in TODO.md's Done entry: the Delete key is never taken
from a focused text field (empty or not); `removeFrom` that empties a group
removes it; the menu offers *Select e1* too; a feature's members are what it
made (`owns`); `select()` leaves hidden names out and says so; a plain empty
box clears the selection. The spec's account of the code needed no
correction.

The owner, verbatim:

> *the concept of this project is flat relational direct cad. there is no
> hierarchy. a sketch entity exists in the same logical space as a solid
> entity. and entities can be grouped. think about this grouping, and
> implement also*

## The thinking

The model is already flat: a feature's twins, walls and lid frame are
ordinary points, lines and frames beside the sketch they came from, and any
relation can tie a sketch point to a solid's corner. Grouping must not
undo that. Three decisions follow from "no hierarchy":

1. **A group is a set, not a container.** It names some entities and
   relations; it owns none of them. Deleting a group deletes the grouping,
   never the members. Deleting a member takes it out of every group it is in.
2. **Membership overlaps and never nests.** An entity may be in any number of
   groups. A group never contains a group — that would be a tree. Naming a
   group (or a feature) when making or adding to a group adds *its current
   members*, flattened at that moment, and says so; it is a union, not a link.
3. **A feature is a group already.** `e1` names a set of entities (what the
   extrude made). So a feature name is accepted wherever a group is — select
   it, hide it, list its members — but it is read-only as a group: its members
   follow its profile, and `addTo("e1", …)` refuses with that reason.

What grouping is *for*, in a relational CAD, beyond naming: selecting a set
in one gesture, hiding and showing a set (the CAD-familiar "hide the sketch
once it is extruded"), deleting a set, and — the second phase — holding a set
**rigid**, so dragging one member moves the whole set as a body and the rest
of the model's relations keep acting on it. That last is what makes a group
part of the constraint model rather than a filing system.

## Phase 1 — the selection, groups, hide and show ✅ built

### The selection

There is no entity selection today: a click on an entity inserts its name in
the command line, and a box inserts every name it caught. Grouping by pointer
needs one, and every CAD tool has one.

- **A click selects.** With nothing armed and the command line empty, a click
  on an entity or a constraint glyph replaces the selection with it; shift
  toggles it in or out; a box (window or crossing, as now) selects what it
  catches, shift adding; a click on empty canvas or Escape clears it. Region
  preselection (the feature dialog's) is the same selection for regions: one
  story, one highlight family.
- **Composing a command keeps today's behaviour.** With text in the command
  line, a click inserts the name, as now — the user is writing a call and
  pointing at its arguments. The same signal the undo carve-out used, and
  visible.
- **Selected things are drawn selected**, in a colour of their own (not the
  hover's amber, not the armed tool's; choose and document it, and make sure
  it reads on a solid's light faces and on the dark ground).
- **Typed equivalents**: `sel()` lists it, `select(...names)` sets it (a group
  or feature name selects its members), `select()` clears. The selection is
  UI state: not journalled, not in a file, not an undo step.
- **The context menu acts on the selection** when the right-click lands on a
  selected thing or on empty canvas with something selected: *Group*,
  *Delete*, *Hide*; and on an entity in groups, *Select g1* for each. The
  Delete key deletes the selection. Each item types its command.

### Groups

- `group(...names, { name? })` makes a group of the named entities and
  relations (groups and features flattened), returns `g1`, `g2`, … or the
  given name (the model's name rules: unique, no dot). `addTo(g, ...names)`,
  `removeFrom(g, ...names)`, `ungroup(g)` (also `del(g)`), `members(g)`.
  `ls()` lists groups with their members; `groups(name)` lists the groups an
  entity is in. Every edit is a journalled operation (`asOperation`),
  registered in **both** `replenv.ts` and `persist.ts`'s replay table. New ops
  need no format bump (an older build refuses the step by name, the
  precedent).
- Deleting a member: the cascade removes it from its groups, and a group left
  empty goes too — journalled as part of the deletion's expansion, as the
  cascade already is.
- The hover tag ends with `· g1 g2` (as it does with `· e1` for a feature).

### Hide and show

`hide(...names)` and `show(...names)` (groups and features expand): a hidden
entity is **not drawn, not picked, not snapped to, not box-selected — and
still solved**. A hidden feature's faces are not drawn. Visibility is part of
the document (journalled, saved, an undo step), as it is in every CAD tool.
`show()` with no arguments shows everything; the empty-canvas menu gets
*Show all* when anything is hidden. A hidden entity in the selection leaves
it.

### Verification

Unit: group creation, flattening, overlap, read-only features, the deletion
cascade (member removed, emptied group gone, journal expansion), hide/show
and their journal, persistence and double-save byte-identity with groups and
hidden things in the history, the selection model and its typed commands.
E2e: draw a rectangle and a circle, box-select the rectangle, right-click →
Group, see `g1` in the log and on hover; click empty canvas, shift-click two
lines, Group; select g1 from a member's menu; extrude the rectangle, then
hide the sketch group — the solid stays, the sketch lines are gone and cannot
be clicked; show all; Delete key on a selection; undo each step; save/open
with groups and a hidden group; with text in the command line a click still
inserts a name. LOOK at the selection highlight on a solid and on the
ground. Full `npm run test:all`. Docs per `CLAUDE.md`.

## Phase 2 — rigid groups (after phase 1 merges)

`rigid(g)` is a **relation** over a group: the members' relative geometry is
held as it stands when the relation is made, so the group moves and turns as
one body; dragging any member moves them all; other relations on members
still act (a rigid bracket's corner held `on` a line slides along it). Written
dimension-generically and proven in 3D; never a residual that is already a
square (per `CLAUDE.md` — say which residuals hold a body rigid without
that); journalled as itself; deletable like any relation; members added to a
rigid group later are not rigid until the relation is remade (say so). A
spec of its own is written when phase 1 lands.

## Delivery (phase 1)

Isolated worktree, branch `claude/groups` off the working-branch tip, one PR
against `claude/resume-tasks-o7q02e`, in two reviewable commits (the selection;
then groups, hide and show). Do not merge; the supervising session reviews.
Another package (`lid-frame-shares-points.md`) runs at the same time and owns
`src/operations.ts`'s extrude/revolve bodies and the format bump to 10; stay
out of those.
