# Plan: surfaces — a surface is a thing; trim, extend, knit and fillet are operations

**Status: built** (2026-11-06), on `claude/surfaces` — see *As built* at
the end, where every deviation is marked ⚠ and what SMLib could not do is
said. Queued 2026-11-05, after `regions-as-operations.md` (which
writes the rule this package follows) and `solid-fillets.md` (which makes
kernel edges pickable). The owner: *"please add solid and surface fillet
tools if possible"*, and the rule from `regions-as-operations.md`: *"there
should be no such thing as a negative face … only an operation which
subtracts."*

Read `CLAUDE.md`, `docs/ARCHITECTURE.md`, `regions-as-operations.md` as
built (the three algebras), `solids-kernel.md`, `solid-fillets.md`,
`workbenches.md` (this is the surfaces module and the surfaces workbench),
`src/solids/kernel.ts` (what the kernel offers for sheets: extend the glue
where SMLib has it), `src/organiser.ts`, and the solids and step tests.

## Design

- **A surface is a kind**, built by the kernel as a sheet body: extruded
  surface (a sketch curve, open or closed, swept a depth), revolved
  surface, planar surface from a face, and a solid's face used as one
  (`surface(body.face)`). Listed in the organiser under *Surfaces*,
  hideable, drawn with the face layer (two-sided) and its edges the
  kernel's.
- **Operations, never negatives**: `trim(s, by)` (by a curve projected
  along the view or the plane's normal, or by another surface's
  intersection — keep the side the click is on), `extend(s, edge, d)`,
  `knit(s, t, ...)` (one sheet where edges meet within tolerance; a closed
  knit becomes a solid body on request: `thicken` / `solidify`), `offset(s,
  d)` and `thicken(s, d)` (a solid from a sheet). Each a named feature in
  the surface's chain, as bodies' booleans are.
- **Surface fillet**: `fillet(s, t, r)` between two surfaces that meet at
  an edge (after `knit`, the shared edge — `solid-fillets.md`'s kernel
  call on a sheet body) or, where SMLib offers it, a face-face blend
  between two surfaces that do not share an edge, trimming both. Say which
  of the two the kernel gives; build what it gives.
- **Surface chamfer** (the owner, 2026-11-06: *"also fillets and chamfers
  for surfaces"*): `chamfer(s, t, d)` the same way — a ruled strip between
  the two surfaces at an equal setback `d` along each, both trimmed back to
  it; at a knitted shared edge through `solid-fillets.md`'s kernel
  `chamfer` on the sheet body, between surfaces that do not share an edge
  only if the kernel offers it (say which). Both the fillet and the chamfer
  use the solid tool's gesture (`solid-fillets.md` as built: pick the edge,
  or here the two surfaces; the distance as a dimension; a live preview),
  under the same **modify** group, so one tool does solids and surfaces.
- **Sketch on a surface**: a planar surface is a work plane like a face.
- **STEP**: sheets as `SHELL_BASED_SURFACE_MODEL` (AP214), faces as the
  kernel writes them; re-validate with OpenCascade.
- Out of scope, written down: loft and sweep surfaces (the loft and sweep
  package), boundary and fill surfaces, surface patterns.

## Tests

Unit: each operation by area against the closed form; knit of two
sheets into one; a closed knit thickened by volume; a fillet between two
knitted sheets; identity of a surface's edges through a trim. E2E (mouse
and iPhone 13): extrude a surface, trim it with a sketch, knit two, fillet
the join, thicken, export. LOOK at each.

## Docs

CHANGELOG at the top quoting the owner; ARCHITECTURE's three-algebras
section gains the surface column; the register as vetoable; STATUS;
README; `help()`; the spec marked built with the deviations.

## As built (2026-11-06)

**What there is.** `model.surfaces` holds `s`-named records (`SurfaceEntry`,
`model.ts`). A surface is a chain of them: a head (`extrude`, `revolve`,
`planar`, `face`, `offset`) and then the records whose `into` names it. The
chains are read by `surfaceChains` (`src/surfaces.ts`), and the solid kernel
builds each as a **sheet body** (`SheetNode` … `PairBlendNode`,
`src/solids/evaluate.ts`).

The module is `src/modules/surfaces.ts`. It holds:
- the dimensions `surfaceDepth`, `surfaceAngle` and `surfaceDistance`, which
  have no equation (`relations/surface.ts`);
- the surface tool, and the **sweep** group (`extrude`, `surface`);
- a replay entry for every journal op;
- the typed commands and `help()`.

A surface is drawn two-sided, and listed last in the organiser under
*Surfaces*: a row per surface, its chain written as signs
(`planar −s2 +s3 ⌒s5 ▮s6`). It is hidden by hiding its first record.
Deleting it takes its records and their dimensions, and deleting a curve it
was swept from takes the surface.

| typed | journalled | what it is |
|---|---|---|
| `surface("l1", 20)`, `surface(["l1","a2"], 20)` | `surfaceExtrude` | the chain through l1 (or just those curves) swept along its plane's normal, no caps |
| `surface("l1", "l9", angle?)` | `surfaceRevolve` | turned about an axis |
| `surface("l1")`, `surface("rg1")` | `surfacePlanar` | the planar face a loop or region bounds |
| `surface("e1.lid")` | `surfaceFace` | a body's (or a surface's) face on its own |
| `trim("s1", by, [x,y,z])` | `trimSurface` | trimmed by a curve (projected along its plane's normal), or by a surface where they cross; the point's side is kept |
| `extend("s1", edge, d)` | `extendSurface` | the sweep lengthened at its base, its lid or an open curve end |
| `knit("s1", "s2", …, {tolerance}?)` | `knit` | one sheet where the edges meet (tolerance 10⁻³ by default); s2 becomes part of s1 |
| `offset("s1", d)` | `offsetSurface` | a **new** surface along s1's normals; s1 is kept |
| `thicken("s1", d)` | `thicken` | a solid: the sheet, its offset, and ruled walls between them; a closed shell gives the hollow between it and its offset |
| `solidify("s1")` | `solidify` | a closed knit filled |
| `fillet("s1", ["s1.base\|s3.m0"], r)`, `chamfer(…)` | `filletSurfaces` / `chamferSurfaces` | blends a surface's shared edges |
| `fillet("s1", "s2", r, keeps?)`, `chamfer(…)` | the same ops | blends two surfaces in one record: knitted if they meet; if not, each is trimmed back to the other first (the larger piece, or the side of each keep point) |

**Tools.**
- **The surface tool** sits under the extrude button. A click on a curve
  takes its chain (with `chain: false`, the curve alone); a click inside a
  loop takes the planar face. ✓ or Enter types `surface(...)`.
- **The trim tool**, pressed on a surface, holds that surface. The press is
  the side kept, and a ring is drawn there. A click on a curve or on another
  surface then types `trim("s1", by, point)`.
- **The round and chamfer tools** take a surface's shared edges as they take
  a solid's: hover names the edge, the kernel previews, ✓ confirms. A click
  on a surface with no shared edge under it starts a pair; the click on the
  second surface finishes it. The two clicks are the keep points.
- **The context menu** on a surface: Thicken…, Offset…, Knit with sN (one
  item for each other surface), Solidify and Delete, then Undo and Redo. On a
  sheet's open edge it offers Extend…, disabled with a reason when the edge
  was made by a trim or a blend.

**Naming.** A surface's faces and edges are named as a body's are:
- faces: `s1.m0` (the member it was swept from), `s1.base`, `s1.lid`,
  `s1.start`, `s1.end`;
- a shared edge, by its two faces: `s1.base|s3.m0`;
- an open (lamina) edge, by its face and the boundary it lies on:
  `s1.m0|s1.lid`;
- a trim's new boundary, after the trim: `s1.m0|s2`.

SMLib carries edge attributes through a trim, so an uncut edge keeps its name
(tested).

### ⚠ The shared verbs — vetoable

The sketch already owns `trim`, `extend` and `offset`. `fillet` and `chamfer`
already serve both the sketch (two lines) and the solid (a list of edges).
**Decision: the verbs are shared, and dispatch on their first argument.** A
surface (any record of one: `model.surfaces.has`) goes to the surface's
version; anything else gets exactly what it got before. The reasons:
- one word per idea, as `fillet` already serves the sketch and the solid;
- the owner prefers one tool doing solids and surfaces;
- the modify flyout's 10 items gain none.

These guards keep it from ever being silently the wrong one:
- Names are unique across the model, and only surfaces are named `s` plus a
  number (`claimName("s")`). A curve can't be mistaken for a surface, or the
  other way round.
- A surface-shaped name that names nothing (`trim("s9", …)`) is refused **as
  a surface's** (`noSuchSurface`), not passed on to the sketch's "takes a
  line".
- Each is journalled under its own op (`trimSurface`, `extendSurface`,
  `offsetSurface`, `filletSurfaces`, `chamferSurfaces`). An old file's
  `trim`, `extend`, `offset`, `fillet`, `chamfer` and `filletEdges` entries
  are untouched, so it replays unchanged, and no file can replay one as the
  other.
- In `help()`, the surfaces section gives each surface form, and the sketch's
  edit section ends: "Given a surface first (s1), trim, extend, offset,
  fillet and chamfer are the surface's instead — see surfaces."
- A surface's name resolves to **the surface it is part of now**. After
  `knit("s1", "s2")`, `trim("s2", …)` is recorded as a trim of s1, which is
  what it cuts, so deleting the knit later cannot move the trim onto s2
  alone.

The rejected alternative was distinct verbs: `trimSurface(…)` typed, and a
separate surface-trim tool. That is a second word and a second button for the
same act, and a user typing `trim("s1", …)` would still get the sketch's
refusal. The journal names can be typed all the same.

### What SMLib could do, and what it could not

Measured against closed forms in `test/surfaceskernel.test.ts` (12 tests):

| asked | SMLib | built as |
|---|---|---|
| a sheet swept from curves | **yes**: `SmApiCreateLinearSweep` / `SmApiCreateRotationalSweep`, caps off | `sm_sheet_extrude`, `sm_sheet_revolve` |
| a planar face | ⚠ `SmApiCreatePlanarFaces` makes one, but its faces took the module down ("table index is out of bounds" / "null function") in every trim and every second knit tried | the cap of a one-unit extrude, extracted on its own (`sm_extract_face`; `DeleteFace` needs `m_bEditingEnabled`) |
| trim by a curve | **yes**: `SmApiProjectAndTrim`, keeping the side the reference point is on | `sm_trim_curve` |
| trim by a surface | **yes**, in two calls: `SmApiIntersectBreps` for the crossing, then project-and-trim along the normal at each curve's midpoint | `sm_trim_brep` |
| knit | **yes**: `MergeBrep` + `SmApiStitchAdvanced`; a closed knit is a manifold shell | `sm_knit` |
| a closed knit filled | **yes**: `SmApiStitchIntoSolid` | `sm_solidify` |
| offset | **yes**: `SmApiOffsetBrepFull` | `sm_offset` |
| thicken | ⚠ **no**: `SmApiShellBrepFull` with `bCreateOffsetSolid` returned -1002 for a planar sheet, and two coincident faces for a cylinder | the sheet, its offset and ruled walls (`SmApiCreateRuledSurface`), stitched and closed (`sm_thicken`); the volumes are exact |
| extend a face at an edge | ⚠ **no**: no API extends a trimmed face | `extend` lengthens the sweep the surface was made by; what follows in the chain applies to the longer sheet |
| fillet or chamfer a shared edge | **yes**: `SmApiFilletEdges` on a sheet, as on a solid; the areas are exact | the solid's blend node |
| a blend between surfaces that don't meet | ⚠ `SmApiSurfaceSurfaceFillet` exists but **leaves both surfaces untrimmed**; its blend runs over the union of both surfaces' reach along the crossing (pinned by a test) | trim each back to the other, knit, then the edge fillet, in one record |

The build stays reproducible: only `scripts/solids/glue.cpp` and
`exports.txt` changed, and the pinned SMLib source is untouched.

### ⚠ Deviations

1. **The trim's side is a point, typed** (`trim(s, by, point)`), and a curve
   is projected along **its plane's normal**, not along the view. The camera
   isn't part of the model and is never journalled, so a replay couldn't
   know it.
2. **`extend` acts on the sweep** (see the table above). Only an extruded or
   revolved surface's base, lid or open-end edges extend. The edges of a
   trimmed, planar, face or offset surface don't, and the refusal says so.
3. **`offset` makes a new surface** and keeps the original. It is a head of
   its own, not a record in the original's chain, since an offset is usually
   wanted beside its source. Vetoable.
4. **A closed shell, thickened, gives the hollow** between it and its offset
   (a tube with wall `d`), not the shell filled. Filling is `solidify`.
5. **A pair fillet with no keep points trims to the larger piece** of each
   surface. The tool always passes the clicks as keep points. Vetoable.
6. **Sketching on a surface** works where a planar surface lies on a loop of
   the drawing (one made from a loop or a region, or a body's face), through
   the sketch tool's own loop. Checked in a browser: the click typed
   `workplane("p4.p5.p7")`. A flat swept wall, an offset, or a planar surface
   moved off its loop is no work plane, because the tool takes only loops of
   entities. That last part comes from reading the code; it isn't tested.
7. **The surface tool extrudes chains and makes planar faces.** Revolved
   surfaces and face surfaces are typed only: picking an axis is the revolve
   tool's gesture, and isn't repeated here.
8. **There is no edit dialog** for a surface record. Its dimension is
   changed with `set`, or the record is deleted and made again.
9. **A thickened surface belongs to no body.** Features don't add to it or
   cut it.
10. **STEP.** A sheet is written as an `OPEN_SHELL` in a
    `SHELL_BASED_SURFACE_MODEL`, inside a
    `MANIFOLD_SURFACE_SHAPE_REPRESENTATION`. With solids present, that
    representation is related to the solids' by a
    `SHAPE_REPRESENTATION_RELATIONSHIP`. Faces are the kernel's B-splines,
    not analytic surfaces. OpenCascade 8.0.1 read all four fixture parts as
    valid (`test/fixtures/step-surfaces/validated.json`):
    - planar holed: area 2286.9027;
    - revolved: area 314.15926;
    - knit-filleted: area 3083.8938;
    - thickened: volume 6356.2833.

    All agree with the closed forms to about 10⁻⁸. OpenCascade's only
    warning is "Surface forced to be periodic", on a whole turn.
11. **The surfaces workbench has exactly the part workbench's modules**: the
    same toolbar under its own name, there so a user can choose it.
    Vetoable.
12. **A trim's sign in a row is `−`**, not ✂, which didn't render in the
    interface's font.

### Tests and pictures

Unit tests:
- `test/surfaceskernel.test.ts` (12): the kernel calls, against closed forms.
- `test/surfaces.test.ts` (16): each operation by area or volume through the
  app's own path, names kept through a trim, the shared verbs, save and
  open, deletion, refusals, and the organiser.
- `test/stepsurfaces.test.ts` (3).

Browser tests: `test/e2e/surfaces.e2e.ts` (7, mouse) and
`test/e2e/surfacesphone.e2e.ts` (5, iPhone 13). Both run the same flow:
1. a rectangle's face becomes the planar surface s1;
2. a circle and the trim tool leave an area of 2400 − 36π;
3. a wall is made and knitted in from the menu;
4. the round tool rounds the join (checked against the closed form);
5. Thicken from the menu makes a solid, its volume the closed form with the
   curvature term (π/2)·L·T²/2;
6. the part is exported.

Pictures 236–243, each looked at.

### Found, still to do

- Revolved and face surfaces in the surface tool (an axis pick).
- A thickened surface joining bodies (add, cut) as a feature's solid does.
- Extending a trimmed edge. That needs a kernel call SMLib doesn't have, or
  re-trimming an extended sweep.
- An edit dialog for surface records.
- Not tried on a real phone.
