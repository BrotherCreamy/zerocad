# Plan: every standard sketch relation, offered for whatever you pick

**Status: built** (2026-11-08), branch `claude/relations-complete`, PR
against `claude/resume-tasks-o7q02e`; the table as built and every
deviation are under *As built* at the end. The owner: *"Also need to figure
out a way to do all the standard relations."*

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

## As built

### The table

`test/relationscomplete.test.ts` is this table as a test: every row's list,
in order, in 2D and 3D, and every offered cell applied twice — by its
`apply` and by typing its text — to check both journal the same thing. A row
lists **most likely first**: what is about the selection's mix, then what
chains over many, then Fix, then the dimension (the dimension tool's, kept).

Kinds: **P** point (a solid's vertex is one: a lid's corner is a model point),
**L** line (a solid's edge along its sketch is one: a lid's twin, a wall),
**C** circle, **A** arc (C|A is "circular"), **E** ellipse, **S** spline,
**X** a frame's x or y arm, **Z** a frame's z arm (3D; it stands for the
frame's plane), **F** a solid's flat face (its plane through three of its
points, `"p1.p2.p3"`), **K** the solid kernel's own edge or face. New in
**bold**; everything else was offered before.

| picks | offered (label → typed) |
|---|---|
| P | **Fix** → `fix(p, [x, y(, z)])` |
| L | Horizontal, Vertical, **Fix** (its two ends), Length |
| C / A | **Fix** (centre; an arc's centre and ends), Radius |
| E / S | **Fix** (centre and major end / its through-points) |
| P P | Coincident, Horizontal, Vertical, **Fix (both)**, Distance |
| P L | On, Midpoint, Pierce (3D), Distance |
| P C | On, Pierce (3D) |
| P A | On, Midpoint, Pierce (3D) |
| P E | **On** → `onellipse`, **Pierce** (3D) |
| P S | **On** → `onspline`, **Pierce** (3D) |
| P *any kind with `heldBy`* | **On** → that kind's own relation, looked up in its module |
| P Z (3D) | **On plane** → `onplane(p, frame)` |
| P F | **On face** → `onplane(p, "p1.p2.p3")` |
| L L | Parallel, Perpendicular, Equal, Collinear, **Horizontal (both)**, **Vertical (both)**, **Fix (both)**, Angle |
| L X | **Parallel**, **Perpendicular** → `par`/`perp(l, "f1.x")` |
| L Z (3D) | **Normal to plane** → `par(l, "f1.z")`, **Parallel to plane** → `perp(l, "f1.z")` |
| L F | **Normal to face** → `par(l, face)`, **Parallel to face** → `perp(l, face)` |
| L C | Tangent |
| L A | Tangent, Equal length |
| L E | **Tangent** |
| L S | **Tangent** at the spline's end that meets the line — greyed with why when neither does |
| C/A C/A | Concentric, **Coradial** → `corad`, Equal, **Tangent (nearer side)**, **Tangent (other side)**, **Fix (both)** |
| C/A S, S S | **Tangent** at the meeting end (greyed when none meets); S S also **Fix (both)** |
| C/A E | Concentric |
| E E | Concentric, **Fix (both)** |
| P P P | **Midpoint** → `mid(first, second, third)`, Equal spacing, **Coincident / Horizontal / Vertical / Fix (all 3)** |
| P P L, P P X | Symmetric (**about a frame's axis** is new to the list) |
| L L L | **Equal (all 3)**, **Parallel (all 3)**, **Symmetric** (about the third), **Horizontal / Vertical / Fix (all 3)** |
| L L X | **Symmetric** |
| C C L, A A L, C A L (and about X) | **Symmetric** |
| P + two of L C A E S | Intersection (**E and S new**) |
| n ≥ 3 points | Equal spacing, **Coincident / Horizontal / Vertical / Fix (all n)** |
| n ≥ 3 lines | **Equal / Parallel / Horizontal / Vertical / Fix (all n)** |
| n ≥ 3 circles/arcs | **Concentric / Coradial / Equal / Fix (all n)** |
| n ≥ 3 ellipses | **Concentric / Fix (all n)** |
| anything with K | one greyed **Relate**, saying it is the kernel's own and why nothing holds to it |

**Doesn't apply**, and why:

| picks | why |
|---|---|
| X alone, Z alone, F alone, a frame | a datum: nothing to move. A frame is picked by its arm. |
| X X, Z F, F F, X F | two datums — `directionSides` refuses them: nothing in the residual can move |
| P X (x or y arm) | a point on an axis is `fix(p, [t, 0])`'s to say, in the frame's coordinates (geometry.ts, the axis rule) |
| P X in 2D, P Z in 2D | every point already lies in the one plane |
| E S | `tan` between a spline and an ellipse is not a relation (tangentSpline takes a line, an arc, a circle or a spline) |
| C E / E E Tangent | a quartic with no closed form a distance residual could be of (sketch-shapes.md) |
| E E Equal, S S Equal (curve length) | no relation says either; left (below) |
| C/A/E X, C/A/E Z | a circle's plane is the one it is drawn on (tools/place.ts holds it); `par(c, axis)` still types |
| C/A F | drawing on a face is sketch-on-face's; `par(c, face)` and `onplane` still type |
| P F with the point inside the face | `onplane` holds to the face's **plane**, not inside its outline — as SolidWorks' On Plane does |

SolidWorks' and Onshape's lists against this: Horizontal, Vertical,
Collinear, Coradial, Perpendicular, Parallel, Tangent, Concentric, Midpoint,
Intersection, Coincident, Equal, Symmetric, Fix, Pierce, Merge (Coincident),
On (Onshape's Coincident on a curve), Normal (to a plane) — all offered.
**Not built**: Curvature (G2 between splines), Equal curve length, Onshape's
Offset relation, SolidWorks' Convert Entities (below).

### Deviations, and why

- **Many at once is a star, measured.** (Superseded 2026-11-12 by
  review-relations.md: one relation among them all.) Each pick is related to the first.
  With two of eight lines dimensioned to different lengths, the conflict
  search names four relations for the star wherever the two are, and up to
  nine for a chain (every eq on the path between); the chain wins only when
  the two are neighbours in it (3 against 4). The cost of the star is on the
  canvas: the first pick wears n − 1 marks (five lines Equal: four `=` on
  the first line, one on each other).
- **The text is one line** — `eq("l1", "l2"); eq("l1", "l3")` — so the
  command line makes it one undo step, and the journal holds one relation per
  pair, each deletable.
- **Fix is drawn as a padlock** (`glyphs.ts` `LOCKED`): there was no lock
  glyph in the house, so one was added, as a path. It is quiet with its
  corner (quiet.ts: a line's end, and the marks on it, are drawn while the
  hand is on it) — so a fixed corner of a rectangle shows its padlock on
  hover or when selected, not always. Left as the house's quiet rule says;
  register.
- **Fix on an entity is one `fix` per point it is built of**, where it stands
  in the default frame: a circle's radius is no point and stays free.
- **Tangent between two circles is offered both ways**, the nearer side
  first, each typed with its side — except two arcs sharing an end, whose
  join decides it (one row).
- **`sym` of two circles in 3D holds their normals parallel**, not mirrored.
  Written with the mirror itself (2(n·û)û − n) the block read the line's
  direction too and the rank analysis counted it taking six freedoms where
  coradial's takes five, on a tilted plane; parallel is what the mirror gives
  whenever the line lies in the circles' plane, as a sketch's does.
- **`sym` of two lines needs no pairing of ends**: it says the segment is
  mirrored — middles, direction, length — so a line drawn the other way
  round is neither refused nor flipped.
- **`sym` of two arcs pairs the start of one with the end of the other** (a
  mirror turns an arc round; in 3D when the normals point one way, read
  when made), one row per end: the ends are on their rims already
  (`arcends`), and a second row would be redundant.
- **A greyed cell** (`Applicable.off`) shows its reason where its command
  would be; a press types nothing and says the whole reason in the log —
  which is where a phone, with no hover, can read it. Its first words are
  the particular (`neither end of "sp1" meets "l1" — …`).
- **Solid picking is `solidRefAt`** in `src/tools/constrain.ts`, one
  function, for smart-dimension.md's picker to replace: a kernel edge or a
  curved or kernel-made face is its kernel name (greyed); a flat face whose
  loop is a solid feature's own (its profile, twins, walls) is its plane
  through three of its points. A face bounded only by a circle comes back as
  the circle — the plane reference it has — and so is picked as its rim.
- **The `On` cell for a kind this file has never heard of** is the
  relation its `EntityKindSpec.heldBy` names, looked up in its module's
  relations — so trim-everything.md's elliptical arc and control-point spline
  get On, Fix (through `refs`) and Concentric (through `plane`) without a
  line here. `intersection` and `pierce` take only the kinds `onCurve` knows
  (geometry.ts cannot reach a module).
- **Convert Entities is not built**: it creates entities, so it is an
  operation, and a projected copy needs a projection relation that does not
  exist; a line Collinear with a lid's edge is offered (the edge is a model
  line). In TODO.md.
