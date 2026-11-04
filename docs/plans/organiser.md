# Plan: the organiser pane — groups you can see, open, and draw into

**Status: built** (2026-11-04), on `claude/organiser`, after
`chrome-logo-scale.md` merged; see *As built* at the end for what regeneration
does, what old files relied on, and every deviation. The owner:

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

## As built

Built on `claude/organiser` (2026-11-04). By file: `src/organiser.ts` (new:
the sections, a row's menu and the ＋'s command, pure; the pane's DOM and its
long-press); `src/groups.ts` (`opengroup`, `closegroup`, `rename`; `group()`
may be empty; `removeFrom` leaves an emptied group); `src/model.ts`
(`openGroup`, `place` — the one door every constructor puts an entity through,
which joins the open group — `withoutOpenGroup`, `setOpenGroup`,
`renameGroup`; `removeMembers` no longer deletes; `deleteGroup` closes);
`src/operations.ts` (`rebuildFeature`'s group rule; `del` no longer reports an
emptied group); `src/persist.ts` (version 12, the three ops, the version-11
translation); `src/replenv.ts` (the commands, `ls()`, `help()`);
`src/picking.ts` (`· g1 (open)`); `src/panels.ts` (the organiser's defaults,
`hiddenAtFirst`); `src/main.ts` (the pane, `● g1` beside the status);
`index.html` (the panel, its styles and hit areas, `#opengroup`). Tests:
`test/organiser.test.ts` (15), `test/e2e/organiser.e2e.ts` (10), and the
suites that knew the old rule or the old version.

**What regeneration does with new twins under an open group.** They do not
join it. A regeneration's new pieces — twins, their ends, walls, a crossing it
materialises — join every group that held *all* the entities the feature had
made, read before the rebuild; the open group gets them only if it was one of
those. The recommendation was "the groups the entity they twin was in"; it was
not taken, because the entity a lid twin twins is a sketch member: a sketch
drawn into `sketch` and extruded with `solid` open would, after a fillet, put
the lid's new arc into `sketch`, and hiding the sketch "once it is extruded"
would take an edge off the solid. A wall twins nothing at all. The rule taken
keeps a group that held the whole solid holding the whole solid, and leaves a
group that held part of it (one edge) alone. A fillet's own arc and tangent
points are drawing, and join the open group as any entity made does.

**Did any old journal rely on an emptied group vanishing?** None in the
repository — no fixture or golden carries a group. A file saved by the groups
build (2026-11-03) could: an emptied group's name used again afterwards, by
`group(…, { name })` or an entity explicitly so named, which that build allowed
because the group had gone. Today that step would fail `"g1" already exists`
(tested). So it is handled, and **the format is version 12**: on the way in, a
version-11 (or older) `removeFrom` that empties a group is followed by the
`ungroup` that build did silently.

Deviations and additions — each a decision, vetoable:

- **Translated, not marked.** The spec suggested an expansion marker, as
  features have. An `ungroup` makes no names, so writing it into the old
  journal shifts nothing after it and the re-saved file says in today's
  vocabulary what the old one meant — the `horizontal` → `parallel`
  precedent. A marker would carry the old meaning forward in every re-save.
  The version is what keys it, so the bump is needed either way.
- **On a phone the organiser starts hidden** (`Panels`' new `hiddenAtFirst`,
  and a stored `hidden: false` once the viewer ticks it in Panes): the
  phone's drawing is mostly covered already, and a pane always over its
  right half covered what the touch suite draws. Shown, it sits **under the
  log at the right edge in both orientations** — in portrait the top of the
  box the options panel uses the bottom corner of; in landscape down to the
  tray's row. A tablet and a desktop show it from the start; a desktop's is
  the **bottom-right corner** (190 × 260 at 100 %), level with the log and
  the command line — top right, where it was first put, lay under the clicks
  of seven suites and in the path of the tray pushed along the top.
- **`rename(g, name)`** is the command the menu's *Rename…* needs; the spec
  named the item, not the command. Only a group: an entity's or a relation's
  name is in every entry that uses it. *Rename…* puts `rename("g1", "` in the
  command line to finish, as *Set value…* does.
- **The ＋ types `opengroup(group())`** — one line, so one undo step — and
  `group()` with no names is an empty group.
- **Only entities join**, not relations: the rectangle's 8 is 4 corners and 4
  edges, its `par`/`perp` not counted.
- **The open group is open in the file**: a drawing saved with a group open
  reopens with it open. One at a time — opening another switches; `ungroup`
  of the open group closes it; a feature cannot be opened (its members follow
  its profile). Both no-ops (opening the open one, closing with none open)
  journal nothing.
- **Beside the status it is `● g1`**, never fading, spelt out in its title —
  "drawing into g1" covered a phone's undo and redo in portrait. In landscape
  it lies over the left end of the command line's strip, where the status
  already sits until it fades. The hover tag says `· g1 (open)`.
- **The eye has a third state, partial** (some members hidden): a tap shows
  them all; a wholly shown set's tap hides. An empty group's eye is off.
- **A row is lit violet** — the selection's colour — while every member is
  selected.
- **The long-press is the pane's own timer** (500 ms, 8 px of slop): iOS
  sends no `contextmenu` for a long-press on something that is not a link.
  The click its release makes is swallowed; the next press starts clean.
- **The ＋ sits over the strip's north-east grip** (`z-index`), which took
  its press under a finger; the corner keeps the rest of its triangle.
- **`del` no longer lists an emptied group** among what it removed — none goes.
- Suites changed for the pane or the version: `groups.test.ts` (an emptied
  group stays; its log line), the format version pinned in five unit and five
  e2e suites, `touchlayout.test.ts` and `panels.test.ts` (one more default
  panel), `opaque.e2e.ts` (its ground pixel was in the pane's shadow),
  `panels.e2e.ts` (a drag to the bottom-right corner hides the pane first),
  `touch.e2e.ts` (the grip check skips a hidden pane).

The spec's account of the code needed one correction, made in
`groups.md`'s text below its status line: the groups build did not journal an
emptied group's going "as part of the deletion's expansion" — the expansion
was the `removeFrom` alone, and the group went silently inside it, which is
exactly why an old file needs the translation.

Limitations left in place, deliberately:

- **A regenerated piece joins only groups that held everything** the feature
  made. A group holding most of a solid — every piece but one edge taken out
  by hand — gets none of the new pieces.
- **Rows are not reordered, nested or dragged**; a section is a flat list in
  creation order. The typed objects' sections are not built.
- **The pane rebuilds its rows when what it shows changes**, compared as JSON
  every redraw — cheap at tens of groups, not measured at thousands.
- **Only an iPhone can show** whether iOS's own long-press callout stays away
  from a row (`-webkit-touch-callout: none` is set; Chromium's emulation
  cannot say).
