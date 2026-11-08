# Plan: what is sketched on the ground stays on it, and an extrude's profile stays on its plane

**Status: queued** (2026-11-08). The owner: *"Why is it that after I extrude
I can drag a corner of the extrude and it deforms the solid? I think it's
missing adding in relations"*.

## What is true today (measured in the browser)

1. Fresh document, 3D. Draw a rectangle with the tool, then extrude it 10 with
   the tool. The model's relations are only:
   ```
   r1 par(l1, l3)
   r2 par(l2, l4)
   r3 perp(l1, l2)
   d1 extrusion(origin, 10, p2→p5, p1→p6, p4→p7, p3→p8)
   ```
   There is no `onPlane`: in a fresh document nothing is chosen to sketch on,
   and `holdOnSketchPlane` (`src/tools/place.ts`) holds nothing then — *"a
   point drawn on the ground in a fresh document stays free, as it always
   did"*. That rule is a leftover of the app's 2D-first days, not an owner
   decision. The owner's sketch-mode words, *"It should just add 'on plane'
   relations to each entity as it gets sketched"*, say otherwise.
2. Drag the lid corner p5 by 60×30 px. `extrusion` holds each twin at base +
   depth·z, so p5 drags its base p2 with it, and nothing holds p2 on the
   ground:
   ```
   p2  [36.7, 26.7, 0]  → [48.4, 21.3, −18.2]
   p1  [−30, 26.7, 0]   → [−27.9, 29.5, −6.3]
   p3  [36.7, −26.7, 0] → [44.6, −31.1, −6.3]
   p4  [−30, −26.7, 0]  → [−31.7, −22.8, 5.7]
   ```
   The base is no longer planar, so the walls are twisted, and the status still
   says SOLVED. TODO.md already had the small symptom: a `set` of the depth
   moved the base by 0.0143 (solid-tools-intuitive.md's "base rectangle
   drifts").

The probe that measured this is
`/tmp/claude-0/-home-user-neocad/8ade0f4b-8494-5195-866f-0f5d13c76c3b/scratchpad/dragprobe/zzprobe.e2e.ts`.
Copy it into `test/e2e/` to run it, and don't commit it as it is.

Read `CLAUDE.md`, `docs/ARCHITECTURE.md`, `docs/plans/sketch-mode.md` (just
built: the named planes, `"origin"` is Top), `frameless-curves.md`,
`free-entities.md`, `3d-phase4-extrude.md`, `no-lid-frame.md`,
`lid-frame-shares-points.md`, `src/tools/place.ts`, `src/workplane.ts`,
`src/relations/extrusion.ts`, `revolution.ts`, `src/operations.ts`
(`extrude`, `revolve`, deletion), and `test/sketchmode.test.ts`.

## Design

1. **The ground is a sketch plane when nothing else is chosen.** In a 3D model
   with no work plane and no default frame, a drawing tool holds what it makes
   on Top (`"origin"`) with `onPlane`, as it does on any chosen plane. This
   covers every drawing tool and the copies offset, mirror and pattern make:
   `test/sketchmode.test.ts`'s table gains "fresh document, nothing chosen" as
   a plane. Typed commands (`pt(…)`, `ln(…)`) stay free: the command line is
   the expert's, and free-entities.md's examples depend on it.
2. **A feature holds its own profile on its plane.** Extrude and revolve (and
   cut) hold every profile point that is not already held on that plane. The
   holds are **owned by the feature**, as its twins are, so:
   - they leave when it is deleted and the sketch goes back to what it was;
   - they are never named in a conflict (conflict-detection.md: feature-held
     relations are background);
   - a profile typed by hand is protected too.

   "Already held" means an `onPlane` to the same ref, or one the conflict
   search would call redundant. Don't add a second hold that diagnosis then
   reports orange. If adding them makes anything report redundant on an
   ordinary drawing, that's a bug in this plan; say so.

   This is the TODO's proposal: *"the extrude's profile held onPlane its
   sketch plane when the plane is a datum"*. A profile in no datum's plane
   (three of its corners) is held to that triple. Say what you chose for it.
3. **Dragging an extruded solid's lid corner** then reshapes the profile in
   its plane, and the solid follows as a prism. That is the house's direct
   editing, and it stays. It must never leave the plane. Say in help() what a
   lid drag does.
4. **Old files**: a file saved with free ground points opens as it did. The
   feature-held profile hold arrives on regeneration or replay of the extrude
   (decide which, and say why), so an old file's solids also stop deforming.
   Make sure the journal replays byte-for-byte where it must; bump the format
   version only if you have to, and say why.

## Tests

- **Unit, 3D**:
  - A fresh document with the rectangle tool: every corner held `onPlane`
    origin.
  - The table over every drawing tool, with nothing chosen.
  - A typed `pt` stays free.
  - Extrude of a typed profile: the profile is held, by the feature, and
    deleting the extrude frees it again.
  - A sketch-mode profile (already held) gains no second hold, and nothing
    reports redundant.
  - Revolve and cut likewise.
  - Old fixtures open and regenerate; their solids hold.
  - `set` of the depth moves no base point (the 0.0143 case, now 0).
- **E2E, mouse and iPhone 13**:
  - The owner's case: rectangle, extrude, orbit, drag a lid corner. Every base
    point keeps z = 0 to 1e-9, the solid stays a prism, and the status is
    SOLVED.
  - LOOK at a picture before and after the drag.
  - The probe's numbers from before your change go in the spec.

## Docs

- CHANGELOG at the top, quoting the owner.
- STATUS.
- ARCHITECTURE: the ground as the default sketch plane, and feature-held
  profile holds.
- The register: the ground rule, feature-owned holds, the off-datum profile,
  old files.
- Tick the TODO item "A rectangle drawn on the ground is held there by
  nothing".
- `help()`.
- The spec marked built.
