# Plan: sketch shapes — polygon, slot and the ellipse

> **The word "sketch" is retired** (2026-11-12, the owner: *"There is no such
> thing as a sketch"*): the tool is the Plane tool, the menu item "Draw on
> this face", the workbench "Drawing". This file keeps its name and its words
> as history; see [`no-sketch.md`](no-sketch.md).

**Status: built** (2026-11-05), on `claude/sketch-shapes`; see *As built*
at the end for every deviation. After `toolbar-groups.md`. The owner:
*"give me better sketch tools, relations, trim, slot... all the usual"*.

Polygon and slot are **composite tools**: they make the lines, arcs and
relations the user would otherwise draw one by one, and leave ordinary
entities behind (like `rectangle` does). The ellipse is a **new entity
kind**, the first curve that is not a circle, and it teaches every seam —
drawing, picking, snapping, relations, loops, extrude and revolve, STEP —
what a second curve type needs. `spline.md` follows it through the same
seams.

Read `CLAUDE.md`, `docs/ARCHITECTURE.md`, `frameless-curves.md`,
`one-circle-one-arc.md`, `toolbar-groups.md`, `explicit-regions.md`,
`step-export.md`, `solids-kernel.md`, `src/model.ts` (circle and arc: the
normal variables, `unitDuals`), `src/relations/`, `src/tools/rectangle.ts`,
`circle.ts`, `curvemethod.ts`, `place.ts`, `src/loops.ts`, `src/faces.ts`,
`src/arcgeom.ts`, `src/picking.ts`, `src/snapping.ts`, `src/step.ts`,
`src/solids/profile.ts` and `kernel.ts` (the profile contract), and their
tests.

## Design

- **Polygon** (`polygon`; typed `polygon(centre, vertex, n)`): a regular
  polygon of `n` sides (option, default 6) by centre and one vertex, as
  Onshape's — press at the centre, drag to a vertex. It makes `n` points,
  `n` lines, the corners joined by `coin`, every side `eq` to the first, and
  a **construction circle** through the vertices (option `circumscribed`,
  default; or inscribed) held `conc`-free by `oncircle` on each vertex — so
  the polygon stays regular as a side is dimensioned, and rotates as a
  vertex is dragged. Drawn on the face under the cursor or the work plane,
  held by `onPlane` as every shape is.
- **Slot** (`slot`; typed `slot(a, b, width)`): a straight slot by its two
  centres and a width (option, or the drag's second stage): two lines and two
  arcs, the arcs `conc` to the centre points, `eqrad`, each line `tan` to
  both arcs, the two centre points construction with a construction line
  between them (so the slot's length is a dimension on that line). An
  **arc slot** (option `arc`, three points: two centres and a point on the
  centreline's arc) if it costs little; otherwise say so.
- **Ellipse** (`ellipse`; typed `ellipse(centre, major, minor)`), an entity:
  centre point, a **major axis end** point (its own point, the direction and
  the semi-major length), a **minor semi-axis** variable, and three normal
  variables as the circle has (`unitDuals`). Drawn as the circle is: press at
  the centre, drag the major end, then a second stage for the minor. Held in
  its plane by `onPlane` on the centre and the major end; `rad`'s cousins:
  `major(e, 20)` and `minor(e, 10)` dimensions, with labels.
  - Relations: `onellipse(point, e)` (the implicit equation in the ellipse's
    own frame, written dimension-generically through `dot` — and **not** a
    square: use the signed distance-like form, see the rule in `CLAUDE.md`);
    `tan(line, e)` (a line tangent to an ellipse: the discriminant form, not
    squared either); `conc` with circles and ellipses (centre `coin`).
    `tan(circle, ellipse)` and `tan(ellipse, ellipse)` are **out of scope**;
    say so.
  - Loops: an ellipse is a closed member like a circle, sampled as arcs are
    (`arcgeom.ts`'s counterpart, by curvature not a fixed count); a face
    bounded by one extrudes to an elliptic cylinder — through the kernel's
    profile as a B-spline (`NurbsCurve` `bspline`: an exact rational
    quadratic ellipse), and in `faces.ts` as a ruled strip like a circle's
    wall. Picking and snapping (nearest point on an ellipse: Newton on the
    parametric form, a few steps) as for arcs.
  - STEP: `ELLIPSE` with its placement for a sketch curve and a lid's edge;
    the wall as `B_SPLINE_SURFACE_WITH_KNOTS` from the kernel where a body
    has one, else an exact `SURFACE_OF_LINEAR_EXTRUSION` over the `ELLIPSE`.
    Re-validate with OpenCascade as `step-export.md` did.
  - Revolve of an ellipse: out of scope unless free.
- All three live in the toolbar groups `toolbar-groups.md` made: polygon
  and slot under **shapes**, ellipse under **curves**. The options panel
  shows `n`, `circumscribed`; `width`, `arc`; nothing for the ellipse beyond
  construction. Tooltips (`static summary`). Each is one undo step and is
  replayed from the journal (`persist.ts` for the entity and the relations;
  the composites journal their calls, so `polygon(...)` replays as its
  pieces exactly as `rectangle` does — prove with a save/open round trip).
- Format version +1 for the ellipse. Old files unchanged.

## Tests

Unit: each composite's entities and relations by name; polygon stays
regular when a side is dimensioned and when a vertex is dragged; slot's
width and length dimension; the ellipse's relations' gradients at a root
(not vanishing); `onellipse` in 3D on a tilted plane; `tan(line, ellipse)`
from both sides; loops find a face bounded by an ellipse and by a slot;
extrude of each by volume (the kernel's) against the closed form; STEP of an
elliptic cylinder read by OpenCascade (outside the repo, as before; record
the table). E2E (mouse and iPhone 13): draw each with the gesture, see the
relations' glyphs, dimension it, drag it, undo, save and open, extrude it.
LOOK at each picture, the ellipse's wall shading above all.

## Docs

CHANGELOG at the top quoting the owner; ARCHITECTURE (a second curve kind:
what every seam needed, listed, for `spline.md` to follow); the register
(the composites' relations; the ellipse's representation; what is out of
scope) as vetoable; STATUS; README; `help()`; the spec marked built.

## As built

Built on `claude/sketch-shapes` (2026-11-05). By file: `src/model.ts`
(`EllipseEntity`, `addEllipse`, `checkEllipse`, `ellipse`, `semiAxes`,
`oriented`; `normalOf` straightens an ellipse's normal; the ellipse a plane
reference and a construction-able curve; `majorAxis`/`minorAxis` in
`DIMENSION_OPS`); `src/relations/refs.ts` (`ellipseAxes`; `curveNormal`,
`directionOf` and `planeBasis` take an ellipse); `src/relations/geometry.ts`
(`onEllipse`, `tangent` of a line and an ellipse, `concentric` with any
centred curve, `majorAxis`, `minorAxis`); `src/relations/extrusion.ts` (an
ellipse pair: minor and normal); `src/arcgeom.ts` (`ArcFrame.rv`,
`ellipseFrame`, `frameReach`, `arcTangent`; `arcPoint` and `portionAngles`
read the second radius); `src/curveplane.ts` (`curveFrame` and
`curvePlaneOf` of an ellipse); `src/projection.ts` (an ellipse on screen,
lifted by Newton); `src/loops.ts` (an arc piece with a second radius; line ×
ellipse in closed form, ellipse × curve numerically); `src/operations.ts`
(the twin of a whole ellipse, the refusals); `src/solids.ts` (ellipse pieces,
the `ellipse` curve and `extrusion` surface, `ellipseMember`);
`src/solids/kernel.ts`, `profile.ts`, `smlib.ts`, `naming.ts`,
`scripts/solids/glue.cpp` and `exports.txt` (the `nurbs` profile member,
`sm_profile_nurbs`); `src/step.ts` (`ELLIPSE`, `SURFACE_OF_LINEAR_EXTRUSION`);
`src/faces.ts`, `boxselect.ts`, `glyphs.ts`, `picking.ts`, `quiet.ts`,
`sketchface.ts`, `tools/feature.ts`, `main.ts`, `menu.ts`, `replenv.ts`,
`persist.ts` (format 15); `src/tools/shapes.ts` (the composites),
`twopoint.ts` (the first stage the tools share), `polygon.ts`, `slot.ts`,
`ellipse.ts`, `place.ts` (`holdCurve`), `icons.ts`. Tests:
`test/shapes.test.ts` (30), `test/shapessolids.test.ts` (6),
`test/e2e/shapes.e2e.ts` (7, a mouse and iPhone 13); counts and names
updated where the toolbar grew a button (`fits`, `toolbargroups`,
`tooltips`, `onetool`, `selecthand`, `menu`) and the format a version.

**What each tool leaves.**

| tool (typed) | gesture | entities | relations |
|---|---|---|---|
| `polygon` (`polygon(c, v, n?, circumscribed?)`) | press at the centre, drag to a corner (or click both) | the centre and the corner given, n − 1 more corners, n sides sharing them, a construction circle about the centre (inscribed: a second, inside) | `oncircle` × n, `eq` × (n − 1), each side to the one before; inscribed adds one `tan` (the first side, the inner circle); 3D: `onplane` on each derived corner, `onplane` + `par` per circle |
| `slot` (`slot(a, b, width)`) | press at one centre, drag to the other (or click both), then click or tap the width | the two centres, four tangent points, two sides, two arcs about the centres, a construction line between the centres | `arcends` × 2, `eqrad`, `perp` × 4 (each side square to the radius at each of its ends); 3D: `onplane` on the four points, `onplane` + `par` per arc |
| `ellipse` (`ellipse(c, major, minor, plane?)`) | press at the centre, drag to the major end (or click both), then click or tap the minor | the ellipse, its centre and its major end | 3D: `onplane` on the centre and the major end, `par` on the normal; nothing on its size |

The polygon is left 4 freedoms (centre, size, turn), the slot 5 (two
centres, width) — both counted by the Jacobian's rank in the unit suite.

**The ellipse's representation.** A centre point, a **major-end point** (the
axis's direction, and the semi-major `a` = |major − centre|), a **minor
semi-axis variable** `b`, and in 3D three normal variables read through
`unitDuals` and **straightened against the major axis** (as a frame's y-ref
is), so its plane always contains the major axis and no relation has to keep
the major end in it. `onellipse` is `√((x·b/a)² + y²) − b`, with `x = (q −
c)·û` and `y² = |q − c|² − x²` — `onCircle`'s question once the major axis
is squashed, a length whose gradient on the curve never vanishes; `tan(line,
e)` is the line's distance from the centre less the ellipse's support,
`√(a² − (a² − b²)cos²θ)`. Both read only `dot`, so they are the same in 2D
and 3D, where each adds the circle's plane block. `major(e, a)` and
`minor(e, b)` are dimensions (`d`-named, `set`-able), labelled `a30` and
`b12`.

**The OpenCascade table** — OpenCascade 8.0.1 through cadquery-ocp
8.0.1.1.0 from PyPI, Python 3.11, in the session's scratch directory, never
a dependency. Each file read twice, as `step-export.md` read its fixtures:
as an application reads (`STEPControl_Reader`, standard healing, then per
solid `BRepCheck_Analyzer`, closed shells, no free edges, a far point OUT,
`GProp` volume at 1e-10, a tight box), and strictly (each
`MANIFOLD_SOLID_BREP` through `StepToTopoDS_Builder`, only the pcurve fixes a
file without pcurves needs, then the same checks):

| part | what | valid (healed / strict) | volume (OpenCascade) | closed form | faces | max tolerance |
|---|---|---|---|---|---|---|
| elliptic-cylinder | 12 × 5, extruded 20 | yes / yes | 3769.911184 | 3769.911184 | 2 planes, 2 surfaces of linear extrusion | 1e-7 |
| tilted-ellipse | 9 × 4 on a plane tipped 0.5 rad, its axis turned 0.8 rad in it, extruded 15 | yes / yes | 1696.460033 | 1696.460033 | 2 planes, 2 extrusions | 1e-7 |
| slot | 30 between centres, 10 wide, extruded 6 | yes / yes | 2271.238898 | 2271.238898 | 4 planes, 2 cylinders | 1e-7 |
| hexagon | circumradius 10, extruded 4 | yes / yes | 1039.230485 | 1039.230485 | 8 planes | 1e-7 |
| plate-oval-hole-boss | 100 × 60 × 10, a 12 × 6 elliptic hole cut through, an 8 × 4 boss 5 tall — the kernel's body | yes / **no** | 58240.708114 | 58240.708114 | 7 planes, 2 B-spline surfaces | 1e-7 |
| ellipse-wireframe | an elliptic cylinder and a loose ellipse beside it (`curves: true`) | yes / yes | 628.318531 | 628.318531 | 2 planes, 2 extrusions | 1e-7 |

Volumes agree to 1.3e-12 relative or better (the kernel body's; the exact
bodies' to 3e-16). Every edge of an exact body reads back as an `ELLIPSE` or
a `LINE` (the slot's as `CIRCLE`s and `LINE`s). **The strict read rejects the
kernel body**: one of its elliptic walls — one B-spline face closed on a seam
the kernel made — fails `BRepCheck` unhealed; the healed read is valid and
exact. The suite's own kernel part `turned-and-drilled` is rejected by the
same strict read (`STRICT_FAILS` in `stepkernel.test.ts`). Splitting such a
wall in two, as `kernelbrep.ts` splits a cylinder's (`splitSeams`), is left
for later (TODO.md).

Deviations and additions — each a decision, vetoable:

- **A polygon's corners are shared points**, as the rectangle's are, so no
  `coin` joins them; one appears only where a click's snap infers it.
- **Each side `eq` to the one before it**, not every side to the first. An
  `eq` wears a mark on both its lines; to the first, a hexagon's first side
  wore five in a row (looked at, on the iPhone picture); along the chain no
  side wears more than two. The same n − 1 equations.
- **The inscribed polygon has two construction circles**: the circumscribed
  polygon's relations and an inner circle `tan` to the first side. The
  spec's one circle tangent to every side was tried, with the sides held
  equal: dragged, it folded for every n ≥ 4 (equal sides tangent to one
  circle can rock — a rhombus does); tangent sides with the corners on an
  outer circle and no `eq` collapsed a side at n = 8; `eq` spokes from the
  centre folded at 8. Measured for n = 3 … 8 before choosing.
- **The slot's tangencies are `perp`**, side to radius at each end, not
  `tan`: a side whose end is already on its arc touches it to second order,
  so `tan` there is a square in the angle (CLAUDE.md's rule) — measured, four
  freedoms too many by rank. The fillet has the same flaw (TODO.md).
- **The slot's `width` option is 0 by default** — chosen by the second
  stage; set, the second stage is skipped.
- **No arc slot**: its ends and sides are four arcs held tangent to one
  another round a centreline arc — circle-to-circle `tan`s — several times
  the straight slot, for a shape the owner did not name.
- **Typed composites take points' names** (`polygon("p1", "p2", 6)`,
  `slot("p1", "p2", 10)`), lay out on the drawing plane, take no clauses and
  return what they made, by name; `ellipse(c, major, minor)` takes the major
  end as a point or as a number (the semi-major, along the drawing plane's
  first direction). An ellipse is named `el1`, `el2`, ….
- **`major` and `minor` are semi-axes**, as `rad` is a radius, journalled as
  `majorAxis` and `minorAxis`; nothing orders them — a minor dimensioned past
  the major is legal.
- **An ellipse is a polyline on screen however it is seen** (no exact screen
  curve even square-on); a pixel on it is lifted to the true curve by six
  Newton steps on its projected parametric form.
- **Loops: an ellipse crossing a circle or another ellipse is found
  numerically** — 720 steps round for a change of side, then halving — the
  one crossing with no closed form; a line × ellipse is closed form in the
  ellipse's normalised axes. A point held `onellipse` cuts it, as `oncircle`
  cuts a circle.
- **A region bounded by part of an ellipse is found but not built**: there
  is no elliptic arc to twin it with, so `extrude` refuses it by name. A
  whole ellipse extrudes, as an outline or as a hole.
- **The kernel contract gained a member kind**, `nurbs` (degree, knots,
  multiplicities, `[x, y, w]` points), and the glue `sm_profile_nurbs`
  (`SmApiCreateCanonicalCurve`): an ellipse goes to SMLib as its exact
  rational quadratic, counter-clockwise in the profile's axes. The kernel's
  volumes match πab·d to 1e-6 relative (unit suite).
- **Format 15** (`values.minors`); the format's own precedent would have
  added the ops without a bump — the plan asked for one.
- **Ellipse on the menu**: an item beside Circle and Arc on empty canvas, and
  Dimension major / Dimension minor on an ellipse.
- **Twelve toolbar buttons** (curves after arc). The tooltip tests that
  hovered the rectangle hover the circle: the rectangle's button opens the
  shapes flyout now and has no tooltip of its own (toolbar-groups' rule).
- **Found by looking: a seam line down an elliptic wall.** faces.ts drew a
  wall line at the ellipse's first sample as at a profile vertex; a whole
  ellipse is treated as a whole circle is (`hasVertices`).
- **Revolving an ellipse is refused**, wherever it is in the profile.
- **Found by looking: bands on an elliptic wall.** An ellipse sampled evenly
  in its parameter put a few long facets round each end of the major axis,
  where it bends a/b times as fast as on average, and the iPhone picture of
  an extruded ellipse showed them as shaded bands. Its samples are now spaced
  evenly in the direction its normal faces (`sampleAngle`), and how many is
  asked of its largest radius of curvature, a²/b (`frameReach`) — so every
  chord is within the quarter-pixel a circle's are (unit suite). Everything that
  draws, shades, boxes or picks one goes through `arcSamples`, and
  projection's lift reads the same spacing back.

Limitations left in place, deliberately:

- `tan` between an ellipse and a circle or another ellipse: refused by name.
- A line `tan` an ellipse with its end held `onellipse` converges only to
  the solver's residual tolerance in the angle (about 1e-4 rad), as a
  circle's does — the slot's second-order touch again; `perp` to a radius is
  the cure where there is one.
- A boolean body's elliptic wall is one seamed B-spline face (the strict
  read above), and its seam may draw as an edge in a kernel body's shaded
  view — not looked at.
- Not tried on an iPhone; the gestures were Chromium's emulation.
