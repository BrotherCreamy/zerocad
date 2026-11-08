# Plan: every standard sketch relation, offered for whatever you pick

**Status: queued** (2026-11-08). The owner: *"Also need to figure out a way to
do all the standard relations."*

## What is true today

`constraintsFor` (`src/dimensioning.ts`) is what the constrain tool and the
context menu offer. It covers:
- a line: Horizontal and Vertical;
- two lines: Parallel, Perpendicular, Equal, Collinear;
- two points: Coincident, Horizontal, Vertical;
- a point and a line: On, Midpoint;
- a point and a circle or arc: On (and Midpoint on an arc), plus Pierce in
  3D;
- two circles: Concentric, Equal, Tangent;
- a line and a circle: Tangent, and Equal length for an arc;
- two points and a line: Symmetric;
- a point and two curves: Intersection;
- three or more points: Equal spacing.

**Missing**, at least:
- Fix (lock) a point or an entity.
- Coincident or On for a point on an **ellipse** or a **spline**. The
  relations `onEllipse` and `onSpline` exist and are not offered.
- Tangent with an ellipse or a spline (at an end), and arc–arc tangency done
  properly (which side).
- Symmetric for two lines, two circles or two arcs about a line.
- Midpoint between two points (`mid` takes a point and two points).
- Equal, Parallel and Horizontal for **more than two** picked at once (the
  SolidWorks gesture: pick five lines, Equal).
- Coradial (concentric and equal).
- Parallel or perpendicular to a **frame axis or a plane** by picking it, and
  normal to a plane in 3D.
- Relations to a **solid's edges and faces**:
  - a point On a face;
  - a line Collinear with an edge;
  - Coincident with a vertex;
  - SolidWorks' "convert entities" (a projected copy held to the edge).

Read `CLAUDE.md` (the relations rules: lazy `lineVars`, dimension-generic, no
residual that is already a square, a relation is one module entry),
`docs/ARCHITECTURE.md`, `docs/plans/sketch-relations.md`, `constraint-glyphs.md`,
`conflict-detection.md`, `src/dimensioning.ts`, `src/tools/constrain.ts`,
`src/menu.ts`, `src/glyphs.ts`, `src/relations/`, `src/modules/core.ts` and
`sketch.ts`, and the constrain and glyph tests.

## Design

1. **Write the table first**, in the spec: every pair (and triple, and
   n-tuple) of pickable kinds, against the union of SolidWorks' and Onshape's
   sketch relations. Each cell is one of:
   - offered: the relation it types;
   - built new;
   - "doesn't apply", with why.

   The kinds are point, line, circle, arc, ellipse, spline, a frame's
   axis/plane, and a solid's vertex, edge and face. That table is the
   deliverable, and the code makes every "offered" cell true. The house's
   names are kept (`par`, `perp`, `coin`, …). A new relation is one module
   entry, per CLAUDE.md, with a glyph (`glyphs.ts`) and a `del`.
2. **Many at once**: with n picks of one kind, offer what chains (Equal,
   Parallel, Horizontal, Vertical, Coincident, Concentric). It types one
   relation per pair against the first pick, in one undo step. Say if a
   chain gives a clearer conflict than a star; measure it with the conflict
   search.
3. **Fix** is a relation (it exists: `fix(point, coords, frame)`).
   - Offer it for a point, and for any entity as fixing all its points
     (SolidWorks' Fix).
   - Draw it with the house's lock glyph, if there is one, else add one.
4. **Solid references**: a relation from sketch geometry to a solid's vertex,
   edge or face holds to that feature's model points where they exist, as
   the dimension work does (`smart-dimension.md`, being built in parallel).
   - Coordinate with it only through the code on the branch you are given;
     the two may meet in `picking.ts`, so keep your changes there small.
   - Kernel-computed geometry (fillet faces) can't be related; say so in the
     menu (greyed, with a reason) rather than offering nothing.
5. **Every relation is dimension-generic**, proved by a 3D test, or throws in
   3D with a reason.
6. **The constrain tool stays the one button**. Its list is ordered most
   likely first. On a phone the list must fit; check it at the iPhone 13's
   width and look.

## Tests

- **Unit**:
  - One test per new relation, in 2D and 3D: it holds, its gradient is
    right, deleting it frees.
  - `constraintsFor` checked against the table: every offered cell, as a
    table-driven test.
  - Many-at-once makes n−1 relations in one undo step.
  - Save/open replays every new op.
- **E2E, mouse and iPhone 13**:
  - Pick five lines, then Equal.
  - A point on an ellipse.
  - Tangent between an arc and a spline's end.
  - Symmetric for two circles.
  - Fix a point, then try to drag it.
  - A point on a solid's face.
  - LOOK at every picture, especially the glyphs.

## Docs

- CHANGELOG at the top, quoting the owner.
- STATUS.
- The register: the ordering, chain vs star, Fix's glyph.
- `help()`'s relation list.
- The spec marked built, with its table as built.
