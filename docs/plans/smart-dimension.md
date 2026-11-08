# Plan: one dimension tool that dimensions virtually anything — SolidWorks' Smart Dimension

**Status: queued** (2026-11-08). The owner: *"Dim tool needs to be similar in
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
