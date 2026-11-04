# Plan: STEP export — exact solids out to every other CAD tool

**Status: built** (2026-11-04) — see *As built* at the end for what was built, what read it back, and every deviation. The owner: *"also, please add step export"*.

STEP (ISO 10303-21, the "Part 21" text format) is what SolidWorks, Fusion,
Onshape, FreeCAD, Inventor and every CAM tool read. It carries **exact
B-rep geometry** — faces on planes, cylinders, cones, tori and surfaces of
revolution, bounded by lines and circles — not a mesh, so a part leaves
ZeroCAD as the part it is.

Read `CLAUDE.md`, `docs/ARCHITECTURE.md`, `3d-phase4-extrude.md`,
`3d-phase5-revolve.md`, `explicit-regions.md`, `files.md` (as built — the
share/download path), `src/model.ts` (`ExtrudeFeature`, `RevolveFeature`),
`src/faces.ts` (how a feature's faces are found for drawing),
`src/curveplane.ts`, `src/arcgeom.ts`, `src/operations.ts` (what a feature's
record means), `src/files.ts` and `src/filehost.ts`, `src/appmenu.ts`,
`src/replenv.ts`, and the extrude, revolve and faces tests.

**A parallel package, `frameless-curves.md`, is changing how a curve records
its orientation** (a frame today, the curve's own normal after). Read a
curve's plane, centre, radius and sweep **only through `curveplane.ts` /
`arcgeom.ts` accessors**, never a frame directly, so that package changes the
accessors and not this exporter. If an accessor you need does not exist, add
it there.

## Design

- **`src/step.ts`**: a pure function from the model to Part 21 text — no DOM,
  no dependency, hand-written. Header (`FILE_DESCRIPTION`, `FILE_NAME` with
  the document's name and a timestamp, `FILE_SCHEMA`) and the product
  structure a receiving tool needs (`PRODUCT`, `PRODUCT_DEFINITION`,
  `SHAPE_REPRESENTATION` with millimetres and a length uncertainty). Choose
  **AP214 or AP242** — whichever the widest set of readers takes for B-rep
  solids; say which and why.
- **One `MANIFOLD_SOLID_BREP` per feature** (there are no booleans yet, so
  each extrude and revolve is a body), each a `CLOSED_SHELL` of
  `ADVANCED_FACE`s with **shared topology**: every edge appears once as an
  `EDGE_CURVE` and twice as `ORIENTED_EDGE`s of opposite sense in the two
  faces it bounds; every vertex once. Face normals point out of the solid
  (`same_sense` set accordingly).
  - **Extrude**: base and lid on `PLANE`s, a wall per profile member — a
    line's wall on a `PLANE`, an arc's or circle's on a
    `CYLINDRICAL_SURFACE` — and each hole's walls likewise, the holes as
    inner `FACE_BOUND`s of the base and lid. A full circle is a closed edge
    with one vertex (or split in two — say which readers prefer).
  - **Revolve**: each profile member's face on its surface of revolution —
    a line parallel to the axis a `CYLINDRICAL_SURFACE`, crossing it a
    `CONICAL_SURFACE`, perpendicular a `PLANE`, an arc a
    `TOROIDAL_SURFACE` or `SPHERICAL_SURFACE` where it is one, else a
    `SURFACE_OF_REVOLUTION`; a partial revolve's two end caps on `PLANE`s; a
    full revolve's seam edges. A member lying on the axis bounds no face.
- **Optional wireframe**: sketch curves that are not part of a solid, as a
  `GEOMETRIC_CURVE_SET`, behind an option (`exportStep({ curves: true })`);
  off by default.
- **Hidden solids are left out; construction geometry is never exported.**
- **Getting it out**: `exportStep(name?)` — a command (journals nothing, like
  `saveFile`; registered in `replenv.ts` and `help()`, not in persist's
  replay table) — hands the text to the files package's path: the share
  sheet on a phone, a download on a desktop, `<name>.step`,
  `model/step` (or `application/step`; check what iOS's Files and AirDrop
  accept). The app menu's File section gets **Export STEP…** typing it.
  With no solid in the model, it says so instead of writing an empty file.

## Verification — the part that matters

A STEP file that "looks right" and fails to import is worse than none.

- **Validate with a real kernel, outside the app.** In the scratchpad (never
  a dependency of the repo), install OpenCascade's Python bindings
  (`pip install cadquery-ocp`, or `OCP`/`pythonocc` — whatever installs
  here) and read every exported test part back: the reader returns no
  errors, the shape is a valid closed solid (`BRepCheck_Analyzer`), and its
  **volume and bounding box match** what ZeroCAD computes for it, to a
  stated tolerance. Do this for: a box; a plate with a round hole; an
  outline with a fillet (an arc wall); a cylinder (a circle profile); a
  partial revolve (end caps); a full revolve with a line crossing the axis
  (a cone) and an arc (a torus); two separate bodies; a tilted profile on a
  non-axis plane. Report each result in the PR. If no OpenCascade will
  install here, say so plainly and fall back to the structural checks below
  — do not claim the files import.
- **In the repo**: unit tests that parse the generated text structurally —
  every `#n` referenced is defined, every entity type is one the schema has,
  every edge is used exactly twice with opposite senses, the shell is closed
  (Euler characteristic per body), and the counts per test part are pinned —
  plus the volumes ZeroCAD computes. Commit the validated `.step` files as
  fixtures, with a note of what read them and when.

## Tests

As above; and E2E: *Export STEP…* in the app menu and `exportStep()` deliver
a `.step` file (Playwright's download, and a stubbed `navigator.share` under
iPhone emulation); with no solid, the message and no file.

## Docs

CHANGELOG at the top quoting the owner, with what was validated and how;
README (export, and what a receiving tool gets: one body per feature);
the register (AP choice, one body per feature, hidden and construction left
out) as vetoable; STATUS; `help()`; the spec marked built.

## As built

What was built, by file: `src/solids.ts` (new; the exact B-rep of every
shown feature, and ZeroCAD's own volume — Green's theorem for an extrude's
area, Pappus for a revolve — and extent, both from the profile rather than
from the faces, so the two check each other); `src/step.ts` (new; the Part 21
writer, `stepExport`, `stepFileName`, `real`, `str`); `featurePlane` in
`src/curveplane.ts` (the one accessor added — a feature's sketch plane, today
its frame's); `exportRoute` in `src/files.ts`; `Files.exportFile` in
`src/filehost.ts` (the share sheet's and the download's type now a
parameter); `exportStep` and the `exportFile` host handle in `src/replenv.ts`,
and `help()`; one line in `src/main.ts`; *Export STEP…* in
`src/appmenu.ts`'s `FILE_ITEMS`. Tests: `test/step.test.ts` (10),
`test/stepparts.ts` (the parts), `test/e2e/step.e2e.ts` (4), the fixtures and
`validated.json` in `test/fixtures/step/`; the File-items assertions in
`test/chrome.test.ts` and `test/e2e/chrome.e2e.ts` gained the fifth item.

**AP214** (`AUTOMOTIVE_DESIGN { 1 0 10303 214 1 1 1 1 }`). The solid
entities are the same in AP214 and AP242 (Part 42 through the advanced B-rep
class), so for a part that is only geometry AP242 adds nothing a reader
would use; AP242 readers read AP214, and many AP214 readers (older CAM, free
viewers) read nothing newer; it is what SolidWorks, Fusion and OpenCascade
write by default.

**A full circle is split in two**, and a full revolve is two half turns.
OpenCascade, Parasolid and ACIS all read a closed edge with one vertex on a
seam, but that is the one construction readers are known to differ on (a
periodic face using one edge twice); two halves are read by everything, and
make every edge two faces' — the rule the structural test enforces without
exception.

**`model/step`**: IANA-registered 2021-08-05 for `.step`, `.stp`, `.p21`
(checked at iana.org). What iOS's Files and AirDrop do with it is not
documented and cannot be tried here; Chromium's Web Share refuses it (its
permitted list in `share_service_impl.cc`, checked, has neither `.step` nor
`.json`), and the files package's fallback downloads instead.

### Validation

OpenCascade 8.0.1 (cadquery-ocp 8.0.1.1.0 from PyPI, Python 3.11, in the
session's scratch directory) read every fixture twice:

1. **As an application reads it** — `STEPControl_Reader`, the model's global
   and per-entity checks (no fail, no warning in any file), `TransferRoots`
   with the standard shape healing, then per solid `BRepCheck_Analyzer`, every
   shell closed, no free edges, a far point classified outside, `GProp`
   volume and a tight `Bnd_Box`.
2. **Strictly** — each solid translated straight from its entities by
   `StepToTopoDS_Builder`, with only what a file without pcurves leaves a
   reader to do (compute the pcurves, shift them by whole periods, add the
   zero-length edge at a pole), then the same checks plus every vertex and
   edge tolerance still the file's 1e-7.

The second exists because the first was shown not to be enough: files broken
on purpose — one face's `same_sense` flipped, the whole solid inside out, one
oriented edge reversed, a vertex moved 0.01 mm — all came through the healed
read as valid solids of the right volume. The strict read rejects each
(the moved vertex by its tolerance widening to 1e-2), and an open shell.

| part | what | bodies | valid (both reads) | volume (OpenCascade) | ZeroCAD | bounding box (OpenCascade, mm) |
|---|---|---|---|---|---|---|
| box | a box | 1 | yes | 8000.000000 | 8000.000000 | (0,0,0)–(40,20,10) |
| plate-hole | a plate with a round hole | 1 | yes | 13193.628421 | 13193.628421 | (0,0,0)–(60,40,6) |
| fillet | an outline with a fillet | 1 | yes | 17835.185789 | 17835.185789 | (0,0,0)–(50,30,12) |
| cylinder | a circle profile | 1 | yes | 7853.981634 | 7853.981634 | (−10,−10,0)–(10,10,25) |
| partial-revolve | end caps | 1 | yes | 12566.370614 | 12566.370614 | (0,0,−30)–(30,20,0) |
| cone-torus | a cone and a torus, full turn | 1 | yes | 1051.189708 | 1051.189708 | (−10,0,−10)–(10,6,10) |
| two-bodies | two separate bodies | 2 | yes | 5696.460033 | 5696.460033 | (0,0,0)–(56,20,15) |
| tilted | a profile on a tilted plane | 1 | yes | 4171.681469 | 4171.681469 | (−0.957,−7.747,2)–(34.639,22.772,21.003) |
| sphere | a semicircle turned whole | 1 | yes | 4188.790205 | 4188.790205 | (−10,−10,−10)–(10,10,10) |
| spindle | a surface of revolution | 1 | yes | 1615.390201 | 1615.390201 | (−8,−6,−8)–(8,6,8) |
| cavity | a void (`BREP_WITH_VOIDS`) | 1 | yes | 43948.935641 | 43948.935641 | (−30,0,−30)–(30,20,30) |
| island | an island in a hole | 2 | yes | 12722.124342 | 12722.124342 | (0,0,0)–(60,60,5) |
| tilted-revolve | filleted, 270°, tilted | 1 | yes | 36655.713587 | 36655.713587 | (−28.081,−24.292,−20.945)–(32.632,29.896,35.375) |
| wireframe | `curves: true`, a hidden solid | 1 | yes, 3 loose edges | 8000.000000 | 8000.000000 | (0,0,0)–(40,20,10) |

Volumes agree to 5e-15 relative or better, boxes to 1e-7 mm or better (the
test's tolerances are 1e-9 and 1e-6 mm). The wireframe's three loose edges
read back as a line, a circle and an arc of total length 85.029852, as
drawn. The validator scripts stayed in the scratch directory with the
kernel; the procedure is recorded in `validated.json`.

### Deviations

- **An island inside a hole is a body of its own** (`e1.2`): it is solid and
  the hole round it is not, so it is disconnected, and one
  `MANIFOLD_SOLID_BREP` has one outer shell. The spec said one body per
  feature.
- **A full revolve has no seam edges as such**: its "seams" are ordinary
  edges, the profile at 0 and at a half turn, each shared by two faces.
- **A full revolve of a profile with a hole is a `BREP_WITH_VOIDS`** — the
  hole turned whole is a cavity — not covered by the spec. Written as
  OpenCascade writes one: the cavity's shell facing out of it, flagged `.F.`.
- **The shape representation is an `ADVANCED_BREP_SHAPE_REPRESENTATION`**,
  a subtype of the `SHAPE_REPRESENTATION` the spec names, attached to the
  product directly, as OpenCascade and most writers do. The wireframe is a
  `GEOMETRICALLY_BOUNDED_WIREFRAME_SHAPE_REPRESENTATION` related to it by a
  `SHAPE_REPRESENTATION_RELATIONSHIP`.
- **The lid and the end face are the definition, not the twins**: an
  extrude's lid is the profile moved by the depth dimension's value along the
  sketch plane's normal, a partial revolve's end the profile turned by the
  angle — so every wall is exactly ruled and every swept surface exact. They
  agree with the twins wherever the solve has converged; a drawing whose
  solve has not is exported as what its dimensions say.
- **Six test parts beyond the spec's eight** (sphere, spindle, cavity,
  island, tilted revolve, wireframe), and a **second, strict read** beyond
  the spec's one, for the reason above.
- **The in-repo fixture test compares entity census, not bytes**: today's
  export of each part must have exactly the fixture's entities, type for
  type, and the volume and extent OpenCascade measured. Bytes would break on
  the last digit of a solve that another package's change moves.
- **No solid is a refusal (an error line)**, not a plain message, like every
  other command that cannot do what was asked. `exportStep` also takes
  `exportStep(name, { curves: true })` and `{ name }`.
- **The desktop never asks where**: a download, even in Chromium with a save
  picker — the spec's "a download on a desktop".

### Limitations left in place, deliberately

- **No pcurves** are written; every reader computes them (OpenCascade's
  standard read does; the strict read does only that). Writing them would
  make a raw read pass without that step, at the cost of a second,
  2D description of every edge that could disagree with the first.
- **No booleans, so no merging**: overlapping features are overlapping
  bodies. No colours, names beyond the bodies', assembly structure or PMI.
- **Millimetres are assumed**: ZeroCAD has no units, and a number is read
  as millimetres, the unit every CAD tool assumes of an unlabelled model.
- **Untried shapes**: a hole touching its outline at a point (one vertex in
  two loops), an arc tangent to the axis at its middle. Refused rather than
  bridged: a profile whose loop does not close to 1e-6 of its size.
- **Untried readers**: SolidWorks, Fusion, Onshape; and the iPhone's share
  sheet with a `model/step` file. On the owner's list.
