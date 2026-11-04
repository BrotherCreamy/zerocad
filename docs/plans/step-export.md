# Plan: STEP export — exact solids out to every other CAD tool

**Status: queued** (2026-11-04). The owner: *"also, please add step export"*.

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
