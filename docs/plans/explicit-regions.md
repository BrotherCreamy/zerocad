# Plan: a feature's region is explicit — an outline and the holes you said

**Status: queued** (2026-11-04). The owner, on how a later hole joins an
extrude without a timeline: *"there should be some kind of relationship
between the loops > region > extrude"*, and then *"I don't think coplanarity
should be used as an automatic basis for deciding which entities to include in
a region."* Asked whether click-to-pick should keep proposing the loops it
sees inside, he said *"do what you think is best"*: it keeps proposing them,
and nothing joins afterwards unless you say so.

Read `CLAUDE.md`, `docs/plans/effortless.md`, `feature-dialog.md`,
`feature-regeneration.md`, `construction.md` (as built — it lands first),
`src/operations.ts` from `extrude` through `regionOf`, `profileOf`,
`refoundProfile`, `planRegen`, `regenerateAfter` and `regen`, the `del`
cascade, `src/model.ts`'s `ExtrudeFeature`/`RevolveFeature`, `src/loops.ts`'s
top comment (`parent`, `children`), `src/tools/feature.ts`,
`src/tools/extrude.ts`, `src/tools/revolve.ts`, `src/menu.ts`,
`src/replenv.ts`, `src/persist.ts`, and the extrude, revolve, regen and
feature-dialog tests.

## What is true today, and what is wrong with it

A feature already **records** its loops explicitly (`f.loops`: the outline,
then every loop inside it), and the journal already carries them resolved, so
replay never re-infers. The inference is in two places:

1. **`refoundProfile`** (every regeneration: `regen("e1")`, a fillet on a
   profile corner) finds the loop through `f.member` and then takes **every
   loop inside it** (`profileOf` → `regionOf`): a circle drawn inside an
   extruded outline yesterday becomes a hole the next time anything
   regenerates the extrude, because it is coplanar and inside. That is
   exactly what the owner rejected.
2. Nothing else: the click and the typed call propose the loops inside, and
   that is the proposal he accepted — what the preview shows is what ✓ builds
   and what the record keeps.

## Design

- **The record is the membership.** `f.loops[0]` is the outline; every other
  entry is a loop the user confirmed (a hole, or an island in a hole —
  even-odd still decides which is solid). Nothing adds to it but a call that
  says so.
- **Regeneration re-walks each recorded loop by its joins, and adds none.**
  `refoundProfile` finds the outline as it does now (the loop through
  `f.member`, the most-kept tie-break), and then each recorded inner loop **by
  its own members** — the loop that keeps the most of that hole's recorded
  members, inside the new outline — never by containment. A loop inside the
  outline that the record does not name is left out, and the preview and the
  solid show it left out. A recorded hole whose loop is gone (its circle
  deleted, a line of it removed) is **dropped from the record**, and the
  regeneration says so in its result line ("e1: hole c1 is gone, filled") —
  the outline's going is still a refusal, as now, because that is a deletion.
  Check what the `del` cascade does today when a hole's member is deleted and
  make it agree: deleting a hole's circle fills the hole, it never deletes the
  solid.
- **Adding and removing a hole are calls.** `hole("e1", "c1")` adds the loop
  `c1` is in to `e1`'s region; `unhole("e1", "c1")` takes it out. Both are
  operations (they re-point a feature's structure), journalled as the call
  with the resolved loops beside it as `regen`'s are (`hole("e1","c1",
  [[…],[…]])`), registered in **both** `replenv.ts` and `persist.ts`, one undo
  step each. Refusals that guide, not just refuse (`effortless.md`): a loop
  not parallel to the feature's frame, or not inside the outline ("c1 is not
  inside e1's outline l1–l4 — move it in, or extrude it on its own"); a loop
  already a hole ("c1 is already a hole of e1"); a member in no loop; a
  member of the outline itself. `unhole` of a loop that is not a hole says
  which are. Revolve takes both the same way (a hole turned is a tunnel).
  Choose the spellings `hole`/`unhole` unless a better pair is already in the
  command vocabulary; say why in the PR if you change them.
- **The menu.** Right-click a closed loop's member (a circle, a line of a
  closed loop) that lies inside a feature's outline and is not yet its hole:
  *Add as hole to e1*, one item per such feature. Right-click a member of a
  hole: *Remove hole from e1*. The menu proposes from containment — that is a
  suggestion the user clicks, not an inclusion — and types the call through
  `submit`, as every menu item does.
- **Edit e1.** Right-click a feature's face (or select `e1` and use the menu):
  *Edit e1* opens the feature dialog on that feature: its region lit, its
  depth (or angle) in the options panel, and every loop inside the outline
  shown — the region's holes lit, the others outlined as available. Clicking
  an inner loop toggles it; changing the value edits the dimension. ✓ (Enter,
  a second click) types the steps — `hole`/`unhole` per toggle, `set` for the
  value — as **one user action** through `ctx.perform`, exactly as a creating
  confirm does; ✗ (Escape) leaves `e1` as it was. The preview is the edit run
  on the copy, as for creation. No rollback, no history: it edits the
  feature's inputs in place.
- **Creation is unchanged in what it proposes.** A click inside an outline
  picks the region with every non-construction loop inside it, as today; in
  the creating dialog a click on an inner loop now **toggles that loop out of
  the proposal** (and back in), rather than picking another region, and the
  preview follows. Find out how `picks.toggle` treats a click inside a hole
  today (it may pick the hole's own region as a second profile); keep that a
  second region where the click is inside an island that is solid, and make
  it the toggle where the click is on the hole's loop or inside the hole.
  Write the rule you chose in the top comment of `extrude.ts` and the help.
  The typed `extrude("l1", 10)` keeps taking the loops inside — the same
  proposal, confirmed by typing it — and the explicit form
  `extrude("l1", 10, "f1", [[…], […]])` takes exactly what it names.

## Out of scope

- Re-binding a feature to a different outline (that is delete and extrude).
- A feature panel or tree — there is no hierarchy to show.
- Fillet, which takes two lines, not a region.

## Tests

Unit (`test/`): `regen` with an unrecorded loop inside → left out; the
old behaviour's test, inverted, with a comment quoting the owner. `hole` adds,
`unhole` removes, each round-trips save/open and replays; undo is one step.
A fillet on an outline corner keeps the recorded holes and adds none.
Deleting a hole's circle fills it (the solid survives, its hole walls go).
Every refusal above, by text. Revolve: `hole` makes a tunnel round the axis.
A file saved before this change opens and regenerates to the same solids —
its records already list the holes it was built with, so no format bump is
needed; prove it with an older fixture rather than asserting it.

E2E (`test/e2e/`): extrude a rectangle, draw a circle inside, check the solid
has **no** hole (read the face layer or the feature's loops, and look at a
screenshot); right-click the circle → *Add as hole to e1* → the hole appears;
Ctrl+Z takes it away; *Remove hole* puts it back solid. *Edit e1*: toggle the
circle in, change the depth, ✓ — one undo step undoes both. The creating
dialog: click a rectangle with a circle inside (the hole proposed), click the
circle (toggled out, preview solid), ✓ → a solid with no hole. LOOK at the
screenshots of each.

## Docs

CHANGELOG at the top quoting the owner; TODO.md: tick, and record in the
register the decision — *a region's membership is its outline plus the loops
confirmed as holes, never re-inferred from coplanarity; click-to-pick proposes
the loops inside* — as vetoable; STATUS; `help()` and the README's extrude
section; CONVERSATION_LOG with the rejected design (live binding: the region
follows whatever is inside the outline) and why the owner rejected it.
