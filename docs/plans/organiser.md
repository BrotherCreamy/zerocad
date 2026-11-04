# Plan: the organiser pane — groups you can see, open, and draw into

**Status: queued** (2026-11-04), to start once `chrome-logo-scale.md` has
merged (it reworks `panels.ts` and builds the app menu whose pane list this
pane must appear in). The owner:

> *"there needs to be a group pane I think, and the ability to e.g. create a
> new group and "open" the group, which means any entities which get created
> become a part of that group."* — and, of the design: *"the group view or
> whatever organisation method you decided on. There needs to be a pane for
> that."*

**The organisation method, decided here (vetoable in TODO.md's register):**
keep the groups that are built (`docs/plans/groups.md`): overlapping sets
that own nothing and imply nothing, with hide/show as document state — and
add the one thing they lack, an **open group** that new geometry joins. The
alternatives discussed with the owner — exclusive layers, CATIA's split of
sets and bodies, and typed objects that enforce rules (regions, chains,
solids) — are not ruled out: the typed objects are the next design
conversation, and this pane is built so they arrive as new sections of it,
not a new pane.

Read `CLAUDE.md`, `docs/plans/effortless.md`, `groups.md` (as built),
`chrome-logo-scale.md` (as built), `src/groups.ts`, `src/model.ts` (the group
registry, `expand`, `membersOf`, `hidden`), `src/panels.ts`, `src/menu.ts`,
`src/replenv.ts`, `src/persist.ts`, the tools' creation paths, and the group
tests.

## Design

- **The pane** ("Organiser"), a panel like the others: movable, dockable,
  shown or hidden from the app menu's pane list (it must appear there with no
  edit to the menu), scaled by the interface size, its phone default chosen
  for both orientations. Sections:
  - **Groups**: each row its name, member count, an eye (types `hide`/`show`),
    and an open marker. Tap a row: select its members (UI state, as the
    canvas's selection). The row's menu (long-press / right-click): Rename,
    Add selection, Remove selection, Open / Close, Ungroup — each typing its
    command.
  - **Features**: `e1`, `e2`, … read-only rows (what each made), with the eye
    and tap-to-select; the menu offers *Edit e1* (exists) and Delete.
  - Room for later sections (regions, chains, solids) without restructuring:
    a section is a title and rows built from the model.
  - A **＋** in the pane's header: a new group of the selection, or, with
    nothing selected, a new empty group **opened at once** — the owner's
    "create a new group and open it".
- **The open group.** `opengroup("g1")` makes g1 the group new geometry joins;
  `closegroup()` ends it. **Journalled document state** (like hide/show), so a
  replay adds the same entities to the same group — the membership is never
  re-inferred. While it is open, **every entity created** — by a tool, a typed
  constructor, or an operation (a fillet's arc, a feature's made entities at
  creation) — joins it, recorded in the same journal entry as its creation.
  Decide and document what regeneration does with a feature's new twins
  (recommended: they join the groups the entity they twin was in). The open
  group is shown in the pane (the marker), beside the logo's status line, and
  in the hover tag of new geometry; Escape does not close it (it is not a
  tool), the pane and `closegroup()` do.
- **A group may now be empty**, because a new group opened to be drawn into
  starts empty. This reverses one line of `groups.md` ("a group is never
  empty") — record it in the register. Deleting the last member leaves the
  group, empty; `ungroup` removes it. Old files keep working (check whether
  any journal relied on an emptied group disappearing, and handle it with an
  expansion marker if so, as features do).
- **Registered in both** `replenv.ts` and `persist.ts` for every journalled
  command; `help()` updated.

## Tests

Unit: opengroup/closegroup journal, replay and undo; creation by a typed
constructor, a tool's gesture, a fillet and an extrude all join the open group,
and replay reproduces it; empty groups; the old-file case; rename.

E2E: the pane lists groups and features; the eye hides and shows; a row tap
selects; ＋ with nothing selected opens a new empty group, a drawn rectangle
joins it, and the pane's count says 8; the row menu's items type their
commands; the pane appears in the app menu's pane list and hides/shows from
there; under a finger, in both orientations. LOOK at it.

## Docs

CHANGELOG at the top quoting the owner; the register (the organisation
method, the open group, groups may be empty) as vetoable; STATUS; README;
`help()`; the spec marked built.
