# Plan: regions as operations — a face is a face; a region is faces combined by a named operation

**Status: built** (2026-11-05), on `claude/regions-as-operations`; see
*As built* at the end for what was built, the decisions taken and every
deviation. Queued after `workbenches.md`, before `sketch-edit.md` (trim needs
to know what a region is). The owner: *"rather
than auto detecting regions + things inside that region which then get
subtracted automatically, there should be explicit specification of
positive region and negative region"* — then, correcting himself: *"there
should be no such thing as a negative face. a face is just a face. just like
there should be no such thing as a negative solid, only an operation which
subtracts one solid from another"*.

The rule, which is one rule for every dimension: **things are things;
booleans are operations between things; nothing is negative.** Solids
already obey it (`solids-kernel.md`: a body is a chain of `new`, `add`,
`cut`, `intersect`). This package makes the 2D side obey it, and writes down
how surfaces will.

Read `CLAUDE.md`, `docs/ARCHITECTURE.md`, `explicit-regions.md` (as built:
a feature records its outline and its confirmed holes; `hole`/`unhole`),
`regions-split.md`, `feature-regeneration.md`, `solids-kernel.md`,
`workbenches.md` (as built: this is a module's operations),
`organiser.md`, `src/loops.ts`, `src/operations.ts` (`regionOf`,
`featureRegion`, `hole`, `unhole`, `regen`), `src/model.ts`'s features,
`src/tools/region.ts`, `extrude.ts`, `src/organiser.ts`, and their tests.

## Design

- **A face is a closed loop of sketch curves, found** (`loops.ts`, as now).
  Finding faces is not what the owner objected to — a face is just a face.
  Faces are not stored; they are what the model's curves bound.
- **A region is a named thing made by operations on faces**:
  `r1 = region(f)` (a face named by a member, as `extrude` takes one today)
  and then `subtract(r1, g)`, `add(r1, g)`, `intersect(r1, g)` — each
  journalled, each one undo step, each replayed. A region's membership is
  its chain, never re-inferred: a loop inside a region's outline is drawn
  as a loop and nothing more until an operation names it. The region tool
  (`region`, under **shapes**): click a face to make one; with a region
  selected, click a face inside it to subtract (the default), with the mode
  row New · Add · Subtract · ∩ as the extrude dialog's. The organiser
  lists regions (`r1 = f3 − f5 − f6`), hideable, with delete.
- **A feature takes a region**: `extrude("r1", 10)`; a bare face is a region
  of one operation made for it (`extrude("l1", 10)` keeps working and makes
  `r1` on the way, named in the log). Several features may take one region.
  Editing a region (subtract one more face) regenerates the features on it
  (`regen`, as holes do today).
- **Today's holes become regions at open**: a version-N file's feature with
  recorded holes replays as `region` + `subtract` + the feature on the
  region, byte-for-byte the same model; `hole`/`unhole` stay as typed names
  that do the same (aliases with a note in `help()`), the way `circle3`
  stayed.
- **Surfaces, written down, not built**: a surface (extruded, revolved,
  later lofted, or a solid's face used as one) is a thing; `trim(s, by)`,
  `extend(s, to)` and `knit(s, t)` are the operations; nothing is a negative
  surface. Same shape as regions and bodies: name, chain, organiser row.
- Format version +1 for the region entries. Old files unchanged in meaning.

## Tests

Unit: a region's chain; subtract, add, intersect by area against
`loops.ts`'s; a feature on a region regenerates when the region changes;
two features on one region; every fixture file with holes opens to the
same model (the fixture oracle); `hole`/`unhole` as aliases; delete a face
named by a region (refused with the reason, or the region loses it — decide,
write it down, test it). E2E (mouse and iPhone 13): make a region, subtract
two faces, extrude it, change the region, undo, save and open; the
organiser's rows. LOOK at each.

## Docs

CHANGELOG at the top quoting the owner (both quotes); ARCHITECTURE: the
rule, in a section of its own, with the three algebras (faces → regions,
surfaces → surfaces, solids → bodies); the register (regions as operations;
holes as aliases; the surfaces rule) as vetoable; STATUS; README; `help()`;
the spec marked built with the deviations.

## As built (2026-11-05)

Branch `claude/regions-as-operations`, from `claude/resume-tasks-o7q02e`
after workbenches and mode feedback.

**By file.** `src/model.ts`: `RegionEntry`/`RegionStep`/`RegionOp`, the
`regions` registry in the one namespace (`has`), `addRegion`, `regionEntry`,
`featuresOnRegion`, `deleteRegion` (a primitive, journalled),
`removeRegionStep`, `forgetRegion`; a feature's `region`; `hide` takes a
region by name. `src/operations.ts`: the algebra (`regionValue`,
`combineCells`, `faceTree`, `treeDepth`, `cellsArea`, `regionArea`,
`regionHolds`, `regionBoundary`, `mergedBoundary`, `regionProfile`,
`regionText`, `regionAtPoint`, `faceNaming`, `regionStepNaming`,
`planRegionStep`); the operations `region`, `subtract`, `add`, `intersect`,
`deleteRegionSteps`; `extrude`/`revolve` (and their tool doors) on a region,
and `onNewRegion`, which makes a bare face's region on the way;
`refoundProfile` reading a region's chain; `hole`/`unhole` as aliases; `del`
and `construction` through `regionsLosing`/`regionsGone`; `innerOps`.
`src/regiontranslation.ts` (new): a file before format 17 opened into
regions. `src/persist.ts`: format 17, the translation hooked into the
replay, `fromSaved`'s `{ regions: false }` (the oracle's switch, nothing else
asks for it). `src/tools/regiontool.ts` (new): the region tool.
`src/tools/region.ts`: a face drawn whole, `namedRegionAt`, `drawNamedRegion`,
`drawHit`, `drawStandingRegions`, `NAMED_REGION`. `src/tools/extrude.ts`,
`revolve.ts`: a click inside a named region takes it; no proposed hole to
toggle. `src/tools/engine.ts`: standing regions drawn under the overlay.
`src/organiser.ts`: the Regions section and its row menu. `src/modules/
sketch.ts`: the tool, its glyph, the shapes group, the ops, the replay entry,
help's `regions` section. `src/modules/solids.ts`: help's extrude lines.
`src/replenv.ts`: `region`/`subtract`/`add`/`intersect` typed, the new region
named in the log, `edit("rg1")`, `ls()`. Tests: `test/regionsops.test.ts`
(22), `test/e2e/regionsops.e2e.ts` (6: mouse and iPhone 13), and every suite
that built a holed part by the old proposal or read the journal's old shape
(below). Pictures: docs/images/161–166.

**The operations and what each journals.**

| call | journalled as | replay |
|---|---|---|
| `region("l1")` → `rg1` | `region("l1", "f1", ["l1", "l2", "l3", "l4"])` — the plane and the face's member names | the face given: nothing found |
| `subtract("rg1", "c1")` | `subtract("rg1", "c1", ["c1"], [["e1", loops]])` — the face, and each feature on the region with the profile it was rebuilt to | the step appended, the features rebuilt from the lists |
| `add`, `intersect` | the same shape | the same |
| `extrude("rg1", 10)` | `extrude("rg1", 10, "f1", loops)` | the loops given |
| `extrude("l1", 10)` (a bare face) | `region(…)` then `extrude("rg1", 10, "f1", loops)` — two entries, one line typed, one undo step | as the two |
| `hole("e1", "c1")` / `unhole(…)` | the region step they are: `subtract` or `add` | as that step |
| deleting a face a region names | `deleteRegionSteps("rg1", [k], [["e1", loops]])` ahead of the deletion's primitives | the steps dropped, the features rebuilt |
| `del("rg1")`, or its first face deleted | each feature on it as `del("e1")` journals it, then `deleteRegion("rg1")` | the primitives |

**The region tool's gesture and mode row.** Under the shapes button (no new
button: thirteen still, which an iPhone 13's column needs). With no region
in hand, a click on a face types `region("l1")` and holds the region it made;
a click inside an existing region takes that one in hand and types nothing.
With one in hand, a click on a face types the mode's step. The mode row is
the extrude dialog's shape — **New · Add · Subtract · ∩**, none pressed
meaning the obvious thing (Subtract with a region in hand, a new region with
none); New makes another region, which is then in hand. With a region in
hand a click is read on its plane, so a circle under the region's own solid
is the circle. Escape puts the region down; a second Escape the tool.
`edit("rg1")` — the organiser row's *Edit rg1* — arms the tool on it. The
chip says `click a face to make a region of it`, `click a face to subtract
rg1` (`tap` under a finger). The region in hand is drawn as a feature would
take it, holes clear, in the tools' green; the face under the cursor is
outlined, in the cut's red when the click would take it away.

**How a file's holes become regions** (`regiontranslation.ts`). Each old
`extrude`/`revolve` entry with its loops is opened as `region(member, frame,
outline)`, a `subtract` per loop inside (an `add` for an island), then the
entry on the region. An old `hole` is the `subtract` it meant, an `unhole`
the `add`; a `fillet` or `regen` whose list took in a loop drawn inside (the
inference before explicit regions) gets that loop's `subtract` just before
it, rebuilding nothing (`[]`), since the entry after rebuilds the feature as
it always did. Every one of those entries still carries the profiles it
rebuilt, so the replay is handed exactly what the old entries were: the same
entities under the same names, the same relations, the same records. Hole or
island is the one thing decided — an old record does not say — and it is
read off the file's saved geometry once it is back (`settle`), since at the
replay's seeds a loop of free lines may not close. **The proof**: every
journal fixture with a feature (pre-explicit-regions, features-v12,
curves-v12, flat2d-v12, shapes-v15) opens to the same model, thing for thing
and point for point, as the same file replayed with the translation off
(`test/regionsops.test.ts`); and `test/oldfiles13.test.ts` still holds the
first four to the geometry the old build recorded, solved and regenerated.
pre-explicit-regions opens as `rg1 = l1–l4 − c1 − c3 − c5` (c3 and c5 the
two the old inference took in) and `rg2 = l14–l17 − c7`.

**Deleting a face a region names — the decision: the region loses it.** The
step comes out of the chain (`deleteRegionSteps`, journalled ahead of the
deletion) and every feature on the region is rebuilt without it: a hole
whose circle is deleted is filled, the solid survives, as explicit regions
had it. Making a member of it construction does the same. Deleting a member
of the region's **first** face takes the region, as an outline's member took
the feature: the cascade takes the features, then `deleteRegion`.
`del("rg1")` takes the features on it (their sketch kept) and the region.
Tested both ways round, with one undo bringing the face and the step back.

**Deviations, each a decision, vetoable** (TODO.md's register):

- **A bare face is its loop's whole inside, and nothing is proposed.** The
  spec's "a bare face is a region of one operation" read with the owner's
  first sentence — *"rather than auto detecting regions + things inside that
  region which then get subtracted automatically"*: `extrude("l1", 10)` on a
  plate with a circle inside is a solid plate, and so is the extrude tool's
  click. The explicit-regions creating dialog's proposal, and its click that
  took a proposed hole out, are gone; a hole is a region's `subtract` (the
  region tool, `subtract`, or `hole`). Every suite that built a holed part by
  the proposal now says the hole (stepparts' plate, tilted, cavity and
  island; extrude, faces, revolve, construction, explicit regions, lidframe),
  each with the owner's words beside the inverted test.
- **Regions are `rg1`, `rg2`, …**, not the spec's `r1`: `r1` is a relation's
  name and `f3` a frame's. A face in a row is named by its members, as
  refusals name loops (`rg1 = l1–l4 − c1 − c3`).
- **A step keeps its face as member names**, not as resolved portions: what
  the face is found again by is the loop through its member keeping the
  most of them, and a name never goes stale where a crossing's key would.
- **The algebra is of the faces a region names**, nested by geometry
  (`within`) rather than by findLoops's containment tree, which keeps one
  smallest container and handed a circle in the explicit-regions fixture's
  plate to the revolve's end face overlapping it. A loop no step names is
  part of whatever face it lies in.
- **A face added beside the region merges** — the shared edge cancelled, the
  rest walked into one outline (`mergedBoundary`) — so the two halves of a
  split rectangle extrude as the rectangle. A region in pieces is allowed; a
  feature on one is refused, naming the pieces.
- **`hole`/`unhole` choose the step**: a loop whose cell the region holds is
  subtracted, one it does not (an island, a hole being filled) is added — the
  even-odd meaning they always had — and are journalled as that step.
- **A face gone (its loop opened) does nothing while it is gone**, and the
  step stays; the log says `rg1: c1 is gone, so its subtract does nothing
  now` where it said `e1: hole c1 is gone, filled`. An old file's hole that a
  regen dropped stays in the chain the same way.
- **The organiser's Regions section is last** (after Features), shown only
  once there is a region; a row's tap selects the members its faces run
  along; its menu has *Edit rg1*, *Extrude rg1* and Delete.
- **A region standing ready (no feature on it) is tinted** faintly in a
  violet of its own (`NAMED_REGION`), so the organiser's eye has something
  to show and hide; a hidden region is not drawn and a feature tool's click
  does not take it.
- **The extrude and revolve tools take a named region** where the click is
  inside one (the latest made), and the face otherwise; two clicks inside one
  region are one feature.
- **The mode row has no label**: beside "Subtract" the word "mode" was cut to
  one letter (found by looking).
- **fromSaved has one new option**, `{ regions: false }`, for the oracle.
- **The solid kernel was not rebuilt here**: the main checkout's
  `src/solids/smlib-gen/` was built from the same pins and the same
  `scripts/solids/` (diffed, identical), and was copied.

**Surfaces, written down, not built.** ARCHITECTURE's *Nothing is negative*
holds the rule for all three algebras — faces → regions, surfaces →
surfaces, solids → bodies — and `help()`'s regions section says it in two
lines. `surfaces.md` is the package that builds it.

**Verification as run.** Typecheck 0 errors before and after. Unit 1435 →
1458: the base's 1435 (the proposal's tests rewritten in place, not
removed), 22 in `test/regionsops.test.ts` and one in `test/faces.test.ts`. Kernel 11. E2E: see
581 tests (575 before, by the base's records); run in sets of five while building, then whole as the gate: 579 pass, 1 skipped, 1 failed under a load of 16 (solidsphone's iPhone boss), which passes alone. Screenshots 161–166, each looked at.

Limitations left in place, deliberately:

- **Not tried on an iPhone**: Chromium's iPhone 13 emulation only.
- `RegionSelection.toggleHole` and `leftOut` stay in `selection.ts` with no
  caller: the creating dialog proposes nothing to toggle now; the edit
  dialog still toggles a feature's holes through `hole`/`unhole`.
- The hole-or-island reading of an old file uses its saved geometry, so a
  loop moved across a boundary between the entry and the save is read where
  it ended; a loop the saved drawing no longer closes stays a subtract.
- A deleted face a region added or intersected is dropped as a subtracted
  one is; there is no typed way to drop a step but undo and `del`.
