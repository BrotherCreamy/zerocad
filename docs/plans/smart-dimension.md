# Plan: one dimension tool that dimensions virtually anything — SolidWorks' Smart Dimension

**Status: built** (2026-11-08, branch `claude/smart-dimension`; the table as built and the deviations are at the end). The owner: *"Dim tool needs to be similar in
functionality to Solidworks smart dimension. I should be able to use it to
dimension virtually anything. Distance between two faces of a solid, or
angle"*.

## What is true today

`src/tools/dimension.ts` decides from what is clicked:
- a line gives its length;
- two points, the distance;
- a point and a line, the distance;
- two lines, the angle;
- two parallel lines, the distance;
- a circle or arc, the radius (or diameter).

The dimension holds the value measured now, rounded, and `driven` makes a
reference one (`measure(…)`). Nothing else can be dimensioned: no faces, no
solid edges, no ellipses or splines, no point to circle, no circle to circle,
no arc length, no horizontal or vertical component.

Read `CLAUDE.md`, `docs/ARCHITECTURE.md`, `docs/plans/sketch-relations.md`,
`dimension-labels.md`, `dimensions-are-named.md`, `conflict-detection.md`
(just built: a CONFLICT is now caught, collapses included), the dimension
tool, `src/dimensioning.ts`, `src/relations/measure.ts`, `basic.ts`,
`geometry.ts`, `extrusion.ts`, `src/picking.ts`, `src/facelayer.ts`,
`src/faces.ts`, `src/kernelbrep.ts`, `src/kerneledges.ts`, and how a solid's
faces and edges are picked today, by the fillet tool on solid edges and the
sketch tool on faces.

## Design

1. **What it takes**: anything you can see. That is every sketch kind
   (point, line, circle, arc, ellipse, spline, construction too), a frame's
   origin, axes and planes, and **a solid's faces, edges and vertices**.
   - The pick's priority under the cursor is vertex > edge > face, as
     SolidWorks' is.
   - By finger, the same rule with the house's touch slop.
   - A solid face is highlighted on hover and on pick, so the user sees what
     they are dimensioning.
2. **The table**: write the full one into the spec, and build it all.
   - The SolidWorks list as a floor:
     - point–point, point–line, point–circle (centre);
     - line length, line–line (distance if parallel, else angle);
     - circle and arc radius or diameter (a circle defaults to Ø, an arc to
       R, as SolidWorks does), and arc length;
     - circle–circle (centre to centre), and line–circle;
     - ellipse axes, and a spline's end-to-end;
     - a three-point angle (vertex then two points, or a point and two
       lines);
     - **horizontal or vertical** distance, chosen by where the label is
       placed, as SolidWorks does.
   - Solids:
     - **face–face distance** (parallel planar faces);
     - **face–face angle**;
     - face–point, face–edge and edge–edge distance;
     - edge length;
     - a cylindrical face's radius or diameter;
     - point–face.
   - Every entry works in 3D, and in 2D where it means anything.
3. **Driving when it can, driven when it must.** A dimension constrains when
   what it names is made of model variables. It is a reference (driven)
   dimension, said so in its label's parentheses, when:
   - what it names is fixed geometry the kernel computed (a fillet's face,
     a boolean's face); or
   - constraining it would be redundant or a CONFLICT, as SolidWorks asks
     "make this dimension driven?". The house never asks: it makes it driven
     and says so in the log, one line. Use `Model.diagnose` and the
     conflict check rather than guessing.
4. **Solid faces map to their sources where they have one.**
   - An extrude's lid and base are planes through the profile's points and
     their twins. A lid-to-base distance is the depth: setting it sets the
     depth, through a relation between those points, not by editing the
     feature's number behind its back. Check `extrusion.ts` and say how
     the depth is actually held.
   - A wall is its sketch line swept, so a distance between two walls is a
     distance between two lines.
   - A face between two different features (e1's lid to e2's lid) is a
     distance between planes through their points.
   - Build each mapping as a relation in a module (`defineModule`), journalled
     and replayed. Where a face has no stable name to journal, say what you
     built to give it one, or make that case driven-only and write it down.
5. **The gesture stays the house's**: pick, pick, then place the label. A
   click on a third thing starts again. Driven stays available as the option.
   The value is editable in place after placing (the label's Set value…), and
   double-click or long-press edits it at once, as SolidWorks' Modify box does.
6. **Measure**: the same machinery answers a plain measure (no dimension
   made). If it is cheap, offer it as `measure` in the options and the menu.

## Tests

- **Unit, 2D and 3D**:
  - Every row of the table makes the right relation or a driven measure,
    with the measured value right.
  - Setting a face–face distance moves the solid, and survives save/open.
  - Redundant becomes driven.
  - Kernel faces are driven.
- **E2E, mouse and iPhone 13**:
  - Dimension two faces of an extruded block, then set a value: the block
    changes.
  - The angle between two faces of a wedge.
  - A circle's diameter, an arc's radius.
  - Horizontal vs vertical by placement.
  - LOOK at every picture.

## Docs

- CHANGELOG at the top, quoting the owner.
- STATUS.
- The register (vetoable):
  - the pick priority;
  - Ø vs R defaults;
  - driven-instead-of-asking.
- `help()`.
- The spec marked built, with its table as built and deviations.

## As built

The tool is `src/tools/dimension.ts`; the table is `dimensionFor` in
`src/dimensioning.ts`; a solid's faces and edges by name are
`src/relations/solidref.ts`; the new relations are the **dimensions**
module's (`src/modules/dimensions.ts`); the face under the hand is
`src/solidpick.ts`.

### The table

Picks in any order unless said. "Driving" means a `d`-named dimension `set`
edits; every driving row has the driven `measure(…)` of the same reading, which
is what it becomes with the `driven` option — or when the trial says it may not
drive.

| picked | dimension | typed |
|---|---|---|
| a line (a sketch's, or a solid's edge) | its length — true, or horizontal / vertical by placement | `dist(a, b, L)` / `along(a, b, "origin.x", L)` |
| a circle | its diameter (`radial`: radius) | `dia(c, D)` / `rad` |
| an arc | its radius (`radial`: diameter) | `rad(a, R)` / `dia` |
| an arc and its two ends (3 picks) | its length | `arclen(a, L)` — new |
| an ellipse | its major semi-axis, or the minor where the label is nearer that axis | `major(e, a)` / `minor(e, b)` |
| an open spline | its ends' distance (true / H / V) | `dist` / `along` of its first and last points |
| two points | their distance — true, horizontal or vertical by placement | `dist` / `along` — new |
| a point and a line | square to the line | `dist(p, l, d)` |
| a point and a circle or arc | to its centre (true / H / V) | `dist(p, centre, d)` |
| two circles or arcs | centre to centre (true / H / V) | `dist(c1, c2, d)` |
| a line and a circle or arc | the centre square to the line | `dist(centre, l, d)` |
| two lines | the angle; parallel, the distance | `ang(l1, l2, deg(θ))` / `dist(l1, l2, d)` |
| three points | the angle at the first | `ang3(v, a, b, deg(θ))` — new |
| a point and two lines | the lines' angle | `ang` |
| a line and a frame's axis | the angle (parallel: nothing yet) | `ang(l, "f.x", deg(θ))` |
| a point (or centre) and a frame's x or y | its distance from the axis, along the other | `along("f", p, "f.y", d)` |
| a solid's vertex | it is a point: every point row | — |
| a solid's edge | it is its entity (a lid's edge is the twin, a base's the member, a side edge the wall line); every line row | — |
| an extrude's lid and its own base | its depth: nothing made, the depth's value opened | `set("dN.value", ` |
| two walls of one extrude, parallel | the distance between the lines they were swept from | `dist(l1, l2, d)` |
| two walls of one extrude, meeting | the angle at their corner (a wedge's) | `ang3(corner, a, b, deg(θ))` |
| two walls of extrudes going the same way, not parallel | their lines' angle | `ang` |
| two parallel flat faces otherwise | square to the first | `fdist(f1, f2, d)` — new (driven when both depths hold it) |
| two flat faces at an angle, otherwise | the angle between the planes | `measure("fangle", f1, f2)` (driven only) |
| a flat face and a point or a circle's centre | square to the face | `fdist(face, p, d)` |
| a flat face and an edge parallel to it | its middle, square to the face | `fdist(face, l, d)` |
| a round wall | it is its circle or arc: ⌀ / R | `dia` / `rad` |
| a face or an edge only the kernel built (a fillet's) | ⌀ / R of a cylinder, an edge's length, a distance or angle against a plane | `measure("diameter" / "length" / "fdist" / "fangle", …)` — always driven |

Every new relation is dimension-generic where it can be (`along`, `ang3`,
`arclen` hold in 2D and 3D, test/smartdimension.test.ts); `fdist` is 3D only
(a face is a solid's) and refuses in 2D with that reason.

### How a face is held

- **Named as the kernel names it** (`e1.base`, `e1.lid`, `e1.m3`; superseded
  2026-11-12 by review-relations.md: a wall is written `e1:l2`, by the line it
  is swept from, and two meeting walls are `corner` of their lines), for a body
  faces.ts draws as for one the kernel builds; faces.ts's `Face.name` and the
  kernel's face record carry the same name, so a face picked is the face
  journalled.
- **The depth is held by `extrusion`** as `twin − base − depth·ẑ` per point
  pair, the depth a constant in the residual. So the lid-to-base distance *is*
  the depth dimension, and is edited as it (design 4). Lid to lid of two
  extrudes on one plane is held by the two depths: redundant, so driven.
- **`fdist` names faces and reads them lazily** through the feature's record:
  a cap is its first point and the sketch plane's normal (a datum), a line's
  wall is that line and its normal turned square to the extrusion (Duals). So
  it follows a `set` of either depth and a regeneration of either profile.
- **Deleting a feature takes the relations naming its faces and edges**
  (operations.ts's cascade): the names' referent is the record.
- **What only the kernel knows** is read through a reader main.ts hands
  `measure.ts` (`setSolidReader`), so the relations layer never learns where
  the kernel is; driven only.

### Deviations from this spec

- **Long-press is not "edit at once"**: it stays the menu, whose first item on
  a label is Set value…. Double-click and double-tap open the value. Vetoable.
- **Horizontal / vertical are `along`**, a distance along the drawing plane's
  axis, rather than a pair of new `hdist`/`vdist` ops: the house has no
  privileged x and y (a sketch on a tilted face has its own).
- **Face–edge angle, point–plane (a frame's plane), and kernel-only vertices**
  are not built; filed in TODO.md with why.
- **A face dimension mapped to sketch lines is labelled on the sketch**, which
  the solid can hide — seen after setting the step to 30
  (`docs/images/323`). Filed.
- **Measure** is the `measureOf(…)` command (the reading said in the log,
  nothing made). A `measure only` option was built and taken out: on an
  iPhone a third row of the options panel covered the drawing a tap was aimed
  at (sketchrelations.e2e). No menu item yet: the selection menu is the
  relations package's `constraintsFor` list this week.

### Pictures (docs/images/)

- 320 — a wall of a stepped block lit amber under the cursor, the dimension
  tool armed.
- 321 — the step's two +x walls picked, lit green only where each is in front,
  the 20 it will read beside the cursor.
- 322 — placed: `dist("l2", "l4", 20)`, its label between the walls, on the
  sketch.
- 323 — double-clicked and set to 30: the step deeper, its label now behind the
  near wall (the filed limitation).
- 324 — two faces of a wedge: 30° at its sharp edge, `ang3` at the corner.
- 325 — a circle's ⌀20 and an arc's R10, by default.
- 326 — one line, horizontal 30 and vertical 20 by where each label was put.
- 327 — two lids both depths already hold: `(15)`, driven, and the log's line.
- 328–332 — the same on an iPhone 13 by finger: two walls tapped, double-tapped
  and set to 22, the wedge's 30°, ⌀20 and R15, horizontal and vertical.
