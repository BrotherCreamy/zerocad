# Plan: regions as operations — a face is a face; a region is faces combined by a named operation

**Status: queued** (2026-11-05), after `workbenches.md`, before
`sketch-edit.md` (trim needs to know what a region is). The owner: *"rather
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
