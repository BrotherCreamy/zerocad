# Plan: a feature's entities are related to each other — a prism stays a prism, whichever corner is dragged


**Status: built** (2026-11-09, branch `claude/profiles-held`; queued
2026-11-08, rewritten the same day, see below — and built to the owner's
decisions, *The owner's decisions*, with the owner's point 2 on hold). The
audit and the measurements are at the end, *As built*. The owner: *"Why is it that after I extrude
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

## The owner's direction on the extrusion's form (2026-11-08)

*"I think extrude should create an identical copy of the originating
profile's geometry, with relations and all, then chord edges connecting each
corner of one profile to the other, and then the edges become extruded
surfaces. Edge extrude is a fundamental feature. Have to think about how an
edge extrude relation would work."* Also: *"the default for sketch entities is
no plane. Every sketch is a 3D sketch, unless you enter into active on-plane
constraint."* The edge-extrude relation's design was proposed to the owner,
and he answered point by point:

## The owner's decisions (2026-11-09)

1. **Edge extrude is the primitive, and a tool of its own.** An edge E and a
   chord give E′ = E shifted by the chord, the end chords, and the swept
   surface derived. A profile extrude is the edge extrude of every edge of
   the profile sharing one chord. A kind declares its sizes
   (`EntityKindSpec.sizes`) so its twin can match them. In his words: *"Edge
   extrude is a fundamental feature."* **Built.**
2. **The lid's relations: linked twins.** *"linked, but i want it to be
   bidirectionally linked somehow, so the originating sketch is no different
   from the derivative sketch... after extrude, it should be impossible to
   tell which was the original and which is the derivative."* **On hold**:
   the lid gets nothing extra meanwhile (TODO.md).
3. **The perpendicular is its own deletable relation**, `perp(chord,
   profile)`, replaceable by an angle: *"how could you have a relation inside
   an extrude? that doesnt really make sense to me"*. **Built**: `e1_perp`.
4. **Agreeing redundancy is drawn in normal ink, not orange**; a status
   mention is muted at most. CONFLICT stays red; the smart dimension's
   driven-when-redundant rule stays. **Built.**
5. **The rectangle: four perps, plus one coplanar on its four corners**: *"i
   was thinking 4 perps so that all the edges are identical to one
   another"*. A drag out of plane must come back planar to ~1e-12 with
   nothing orange. **Built**: 9.2e-13, measured below.

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

## As built

### The owner's drag, before and after

The probe (the browser, a fresh document, the rectangle tool, the extrude
tool at 10, `orbit(-0.6, -1.0)`, the lid corner nearest the top right
dragged 60×30 px):

| | before | after |
|---|---|---|
| base corner p2 | [36.7, 26.7, 0] → [48.4, 21.3, −18.2] | moves with the lid, as one solid |
| walls | all still along the world's z, the base tilted under them | square to the base, to ~1e-12 |
| the solid | a skewed prism | a right prism: base flat, walls square and the depth long, the lid the base translated — each to 1e-11 or better (`test/e2e/profilesheld.e2e.ts` asserts 1e-6, mouse and iPhone 13) |
| status | SOLVED | SOLVED · 8 free · redundant r4, in the muted grey |

Pictures: 400–402 before (desktop as made, desktop dragged, iPhone dragged),
403–404 after (the same drags, mouse and finger), 405–407 the edge tool
(an L of two lines; a copy's corner dragged by mouse and by finger).

### The rectangle, measured (a corner dragged [3, 4, 7] out of plane)

| relations | off its plane after | redundant |
|---|---|---|
| par, par, perp (before) | 1.8e-16 | none |
| four perps | 2.9e-4 — four right angles flatten a quadrilateral only to second order | r4 |
| four perps + coplanar (built) | 9.2e-13 | r4, said muted, drawn in ordinary ink |

### The audit

Each row was measured in a fresh 3D document (nothing picked to sketch on,
so under the owner's rule nothing is held to any plane), by dragging the
copy and then the original 12 frames, in the plane and out of it. After each
drag the operation's own property was checked in closed form
(`test/bothways.test.ts`, `test/profilesheld.test.ts`).

| operation | what it leaves | before | now |
|---|---|---|---|
| extrude, blind | twins at base + depth·(frame's z), the z a datum | **one way**: a lid corner pulled [12,−6,−8] left the walls 1.50 off square to the base; a free pentagon's base went 7.4 off flat | one shared chord, `e1_perp` square to the profile. Lid corner [12,−6,−8], then base corner [3,−2,9]: flat 6e-12, square 4e-12, translated 4e-11 |
| extrude, symmetric | the same, reach ½·depth | **one way**, walls 0.22 off square | the same: flat 1e-11, square 6e-12, translated 3e-11 |
| extrude, through all (cut) | the same, reach past the bodies | **one way** | the same: flat 9e-12, square 1e-12, translated 2e-11; its reach's direction read from the frame, not the chord, so it does not read itself |
| edge extrude (new) | — | — | the same pair: the copy is its base moved by one chord, square to the curves (`test/edgeextrude.test.ts`, 1e-7, both ways) |
| revolve, partial and whole | the end face's twins turned about the axis, the axis a datum | **broken**: a profile corner pulled 8 off took the axis 5.3 out of the profile's plane | the profile held in the plane through the axis (a row per point but the farthest); a whole turn names its profile by self-pairs. A frame's axis is a datum; a line the user drew is pushed both ways |
| sketch fillet | arc, arcends, tan ×2, rad | holds both ways, to 1e-13 | unchanged (guard test) |
| sketch chamfer | intersection, dist, equal spacing | holds both ways, to 1e-10 | unchanged (guard test) |
| offset | par + dist per line copy, rad per round copy; onPlane only on a sketch plane | **broken off a sketch plane**: the copy left its original's plane by 3.2–3.6; a circle's copy turned 24° off its original | `coplanar` (new, all four points moving) on one vertex per run nothing else holds; `par` from each round copy nothing turns; format 19. Left: a round copy's radius is its own dimension (r ± d), so a pull on the original's rim changes the gap |
| mirror (`sym`) | the half-turn about the line, per pair | holds both ways, to 1e-13 | unchanged (guard test) |
| linear pattern | `translated` per copy point | holds both ways, to 5e-11 | unchanged (guard test) |
| circular pattern | `rotation` + `rotated` about the drawing plane's normal, a datum | **tied to an axis nobody picked**: a tilted seed's copies stood 22–29 off its plane | the seed's own plane (three seed points, read as variables), with nothing picked; a picked plane is still a datum |
| trim's kept piece | the cut end held on the cutting curve | holds both ways | unchanged (guard test) |
| the lid's twins | twin curves: radius equal, normal equal | holds both ways | sizes through `Model.sizesOf` (an ellipse's minor too), normals equal |

### What the design questions came to

- **The coplanarity's form**: none of the extrude's own. The profile is held
  flat by `e1_perp` (every edge square to one chord), and a rectangle by its
  own `coplanar`; the extrude adds no flatness the user did not ask for, so
  a sketch-mode profile reads nothing redundant (measured: nothing).
- **The direction**: the chord's, held by `e1_perp`, which the user can
  delete. Not the profile's normal as a variable: that would be a direction
  inside the extrude, which the owner ruled out.
- **The frame argument** stays in the journal: where +depth was seeded, and
  what old files named. "Along origin" in `describe` is where it was made.
- **Format**: 19 for the offset's `flat` (replay needs it); the extrude needs
  no bump — `e1_perp` is made at replay under a derived name.
- **Feature-owned relations** are never named redundant or in a conflict;
  `e1_perp` is not feature-owned (it is the user's to delete) and is named
  like any relation.
