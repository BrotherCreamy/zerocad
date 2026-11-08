# Plan: a feature's entities are related to each other — a prism stays a prism, whichever corner is dragged


**Status: queued** (2026-11-08; rewritten the same day, see below). The owner: *"Why is it that after I extrude
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
   There is no `onPlane`, and that is not the problem (see below).
2. Drag the lid corner p5 by 60×30 px. `extrusion` holds each twin at base +
   depth·z, so p5 drags its base p2 with it, and nothing holds p2 on the
   ground:
   ```
   p2  [36.7, 26.7, 0]  → [48.4, 21.3, −18.2]
   p1  [−30, 26.7, 0]   → [−27.9, 29.5, −6.3]
   p3  [36.7, −26.7, 0] → [44.6, −31.1, −6.3]
   p4  [−30, −26.7, 0]  → [−31.7, −22.8, 5.7]
   ```
   The base is still a planar parallelogram, now tilted, while every wall still
   runs along the world's z, because `extrusion` puts twin = base + depth·(the
   frame's z), a fixed datum direction. The prism is skewed, and the status
   still says SOLVED. For a profile of five or more free points, the base
   would not even stay planar: nothing among its own points says it is flat. TODO.md already had the small symptom: a `set` of the depth
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

**The first version of this plan was wrong.** It held what is sketched to the
ground, and the profile to a datum. The owner: *"It's not about being tied to
the ground plane, it's about correct relationships BETWEEN entities. Part of
the concept of this CAD is to have bidirectional relationships everywhere by
default."* So nothing here ties anything to a datum the user didn't choose.

## Design

1. **An extrusion relates its own entities, not a datum.**
   - **The profile is flat among its own points.** Every profile point is
     coplanar with the others. Use a relation the feature owns: a normal of
     its own (unit, held by the profile's own points), or points held on the
     plane of three of them. Choose by conditioning and degeneracy, and say
     why.
   - **The direction is the profile's own normal**, not the frame's z: twin =
     base + depth·n, n from the profile. The walls are then perpendicular to
     base and lid, and the lid is parallel to the base and the same shape,
     because each is a relation between the feature's entities.
   - **A profile the user held on a plane** (sketch mode's `onPlane`, a face)
     stays there because of the user's own relation, and n follows that
     plane. The result is the same as today for every sketch-mode drawing.
     Measure that it is.
   - **Bidirectional.** A drag of a lid corner moves base and lid as one
     prism, and so does a drag of a base corner. With nothing else holding it,
     the solid may move, turn or tilt, but never skew. A dimension on the lid
     drives the base, and one on the base drives the lid.
   - Keep the frame argument in the journal for old files and for the sign
     (which side of the profile +depth is). Decide whether "along origin"
     stays meaningful when the profile isn't on origin's plane, and say so.
2. **The same audit for every operation that makes geometry from other
   geometry.** Write a table in the spec of what each leaves behind, and make
   every row hold both ways:
   - extrude, cut, revolve (axis, angle, the swept points' circles);
   - symmetric and through-all ends;
   - sketch fillet and chamfer;
   - offset (is the copy held at its distance from the original?);
   - mirror (`sym`); linear and circular pattern (`translated`/`rotated`);
   - trim's kept piece; the lid's twins.

   Where a row holds only one way, or not at all, fix it with a relation
   between the entities, owned by the operation where it is the operation's
   doing. Where a fix is large, write it down and leave it.
3. **Feature-owned relations** are background to the conflict search
   (conflict-detection.md), never named, and leave with the feature.
4. **No redundant verdicts on ordinary drawings.** A sketch-mode profile
   already on a plane plus the profile's own coplanarity must not read
   orange. If it does, the relation is wrong-shaped: one plane hold the user
   made, plus coplanarity the feature owns, is consistent by construction.
   Make the diagnosis agree, or choose the coplanarity's form so it does.
5. **Old files**: they open and regenerate under the new relation, and their
   solids stop skewing. Bump the format only if replay needs it; say why.

## Tests

- **Unit, 3D**:
  - The owner's rectangle extruded, then a lid corner pulled anywhere: base
    planar, every wall perpendicular to the base and of length = depth, lid
    the base translated. The same when a base corner is pulled.
  - A free pentagon profile extruded and pulled: still planar.
  - A sketch-mode (onPlane) profile: the same solid as before this change, to
    1e-9, and nothing redundant.
  - Each operation in the audit table: a test per row that it holds both
    ways.
  - Old fixtures open, regenerate and hold.
  - Conflicts on a drawing with features name no feature-owned relation.
- **E2E, mouse and iPhone 13**:
  - The owner's case: rectangle, extrude, orbit, drag a lid corner. The solid
    stays a right prism (assert walls ⟂ base, wall lengths = depth, base
    planar) and the status reads SOLVED.
  - LOOK at pictures before and after.
  - The probe's before-numbers go into the spec.

## Docs

- CHANGELOG at the top, quoting the owner (both messages).
- STATUS.
- ARCHITECTURE: what an extrusion relates now, and the audit table's
  principle ("bidirectional relationships everywhere by default").
- The register: the coplanarity's form, the direction from the profile, the
  frame argument's meaning, every audit-table fix.
- The TODO item "A rectangle drawn on the ground is held there by nothing":
  closed by this, the reason being the prism, not the ground.
- `help()`.
- The spec marked built, with the table.
