# Plan: the spline — a B-spline curve through points you can drag

**Status: built** (2026-11-06), on `claude/spline`; see *As built* at the
end for every deviation, the table of what each sketch edit and surface
does with a spline, and the OpenCascade reading. After `sketch-shapes.md`
(the ellipse teaches the seams a second curve kind needs; this follows
them). The owner: *"give me better sketch tools, relations, trim, slot...
all the usual"*.

Read `CLAUDE.md`, `docs/ARCHITECTURE.md`, `sketch-shapes.md` (as built: the
list of seams the ellipse touched), `frameless-curves.md`, `solids-kernel.md`,
`step-export.md`, `src/model.ts`, `src/relations/`, `src/loops.ts`,
`src/faces.ts`, `src/picking.ts`, `src/snapping.ts`, `src/step.ts`
(`B_SPLINE_CURVE_WITH_KNOTS` is already written for kernel edges),
`src/solids/nurbs.ts`, `profile.ts`, `kernel.ts`, and their tests.

## Design

- **An entity** (`spline`; typed `spline(p1, p2, ..., { closed })`): a cubic
  B-spline **interpolating** its through-points (Onshape's spline, not a
  control-polygon Bézier): the through-points are ordinary points the user
  drags; the curve's control points are solved variables held to
  interpolate them by relations the entity owns (one residual per
  through-point, linear in the control points, dimension-generic). Open or
  closed; three normal variables as the circle has, so it lies in a plane
  it is drawn on (`onPlane` on its points). Tangent handles at the ends:
  option; if built, a handle is a point with a `tan` to the spline's end.
- **Tool**: click the through-points; double-click, Enter or a click on the
  first point (closed) ends it; the curve is previewed as it grows; a
  through-point snaps and infers like any point. Under **curves** in the
  toolbar. Edit: drag a through-point; the context menu on the curve adds
  or removes a through-point.
- **Relations**: `onspline(point, s)` (a point on the curve: a parameter
  variable per such point, the residual the curve's position minus the
  point's — standard, and the one `oncircle` cannot teach), `tan(line, s)`
  at an end, `tan(s, arc)` at a shared end. The spline itself is never a
  squared residual.
- **Loops, faces, solids**: a member sampled by curvature (as the ellipse
  is); a profile with a spline edge extrudes through the kernel as the exact
  NURBS (`NurbsCurve` `bspline`) and draws as a ruled strip; the kernel's
  wall comes back as `B_SPLINE_SURFACE_WITH_KNOTS` and STEP writes it as it
  writes kernel faces now. Revolve of a spline profile the same way.
- **Picking and snapping**: nearest point by a coarse sample then Newton.
- Format version +1. Old files unchanged.

## Tests

Unit: interpolation holds after a drag of a through-point (the curve passes
through every point within 1e-9); gradients at a root; closed splines;
`onspline` in 3D on a tilted plane; `tan` at an end from both sides; a loop
with a spline edge, its area against a numerical integral; extrude's volume
against the kernel's; STEP of a spline extrusion read by OpenCascade (outside
the repo, recorded). E2E (mouse and iPhone 13): draw one, drag a point,
dimension between its points, extrude it, undo, save and open. LOOK at each
picture — the wall shading and the curve's smoothness at 3× above all.

## Docs

CHANGELOG at the top quoting the owner; ARCHITECTURE (the entity owns
relations: what that means for delete and for the journal); the register
(interpolating, cubic, open/closed; handles if built) as vetoable; STATUS;
README; `help()`; the spec marked built with the deviations.


## As built

Built on `claude/spline` (2026-11-06). By file:

- **New.** `src/bspline.ts` — the arithmetic, over a `Ring` so the same
  basis code runs on numbers and on the solver's duals: the centripetal
  layout (`layout`, `gapOf`, `knotsOf`), the basis (`dersBasis`, Piegl &
  Tiller A2.3) and each interpolation row's terms (`rowTerms`), a dense
  `interpolate` for seeds and drawing, evaluation (`findSpan`, `derivs`,
  `pointAt`), `insertKnot`, `bezierSegments`, the drawing's `sampleParams`
  (quarter-pixel chords, no chord turning more than `MAX_TURN` = 2° from the
  next), `nearestParam`, `areaSweep`, `subCurve`, `nurbsOf`.
  `src/kinds/spline.ts` — the entity's structure (`SPLINE_STRUCTURE`,
  `SplineEntity`, `checkSpline`, `placeSpline`, `splineCurve`).
  `src/relations/spline.ts` — `addSpline` (the entity and the equations it
  owns), `respline`, `onSpline`, `tangentSpline`. `src/splineedit.ts` —
  `addThrough`, `removeThrough`. `src/tools/spline.ts` — the tool.
- **The extension point grew a facet**: `EntityKindSpec` takes `closed` as a
  function, `ends`, `through` (the points it passes through by definition,
  which the regions cut it at) and `owns` (the residual blocks that are the
  entity's own definition, removed by `deleteEntity`); `RelationEntry.vars` and
  `Model.relationVar` give a relation variables of its own (counted by
  `diagnose`). `curveplane.ts` gained a **path** registry (`defineCurvePath`,
  `curvePath`: a kind that is an exact B-spline), handed in by `defineModule`
  (`modules.ts`) — and `model.ts`, `loops.ts`, `faces.ts`, `picking.ts` and
  `step.ts` never name the spline (`modules.test.ts` greps them).
- **Changed for it.** `projection.ts` (`pathParams`, `pathLift`;
  `sampledWorld` takes the view's scale), `main.ts`, `boxselect.ts`,
  `glyphs.ts` (the `onspline` glyph; a `tan` anchored at the spline's end),
  `dimensioning.ts`, `replenv.ts` (`ls()`), `modules/sketch.ts` (the kind,
  tool, icon, menu item, relation, operations, typed `spline`, `help()`),
  `relations/geometry.ts` (`tan` dispatches to the spline), `persist.ts`
  (format 18), `tools/place.ts` (a click on the curve infers `onspline`),
  `quiet.ts`, `menu.ts`, `operations.ts` (profiles, twins, regeneration),
  `relations/extrusion.ts`, `revolution.ts`, `loops.ts` (a path piece:
  walked, cut, measured, wound), `faces.ts`, `solids.ts` (the exact B-rep's
  `bspline` curve, its extrusion and revolution walls, the kernel member),
  `step.ts`, `solids/naming.ts` (a fix — below), `sketchgeom.ts` (a spline as
  a cutter), `sketchedit.ts`, `surfaces.ts`, `sketchface.ts` (a fix — below).
- **Tests.** New: `test/spline.test.ts` (12), `test/splinesolids.test.ts`
  (9), `test/splineedit.test.ts` (8), `test/stepspline.test.ts` (6, against
  `test/fixtures/step-spline/`), `test/e2e/spline.e2e.ts` (7: five with a
  mouse, two on an iPhone 13). Updated where a count, a list or a version
  moved: the format pins 17 → 18 across the suite, the curves group's
  members (`toolbargroups`, `menu`, `modules`, `shapes.e2e`, `contextmenu.e2e`),
  the profile-kind refusal messages, and `toolbargroups.e2e`'s group of one
  (curves has two members now, so a typed module of one stands in).

**The interpolation.** n through-points, centripetal knot gaps `|Pₖ₊₁ −
Pₖ|^½` (Lee's — the parameterisation that neither overshoots a tight turn
nor loops between close points; uniform and chord-length were the
alternatives). **Open**: n + 2 control points, the first and last *being*
the end points, the n unknowns held by n − 2 rows through the interior points
and two **natural** ends (no curvature: C″ = 0). **Closed**: clamped, n + 3
control points, the first and last being P₀; n + 1 unknowns held by the rows
through P₁ … Pₙ₋₁ and the seam made **C²** — C′ and C″ equal either side,
scaled to the knot spans so each row is a length. Every row is **linear in
the control points**, so its gradient at the root is its coefficient row and
never vanishes (CLAUDE.md's square rule, tested). The control points are the
spline's own variables; the knots are read off the through-points, so a row
is a dual in the through-points too, and the Jacobian is exact and banded (a
row touches four control points and a six-knot window).

**What the spline owns, and what is a relation.** The interpolation rows are
the entity's definition, not something said about it: one residual block per
row, added by `addSpline`, kept on the entity (`blocks`), not named, not in
`rels()`, not deletable on their own, gone with the entity — a deleted spline,
or a deleted through-point (whose spline goes with it). The file journals one
`addSpline` and replay re-makes the entity and its rows together.
`onspline(p, s)` is a relation: a parameter variable of its own
(`relationVar`, saved as `values.params`), the residual `C(σ) − p`, so a
point slides along the curve and stays where it was across save and open.
`tan` takes a spline at an end: a line along it (the wedge of the two unit
tangents — a sine, not a square), an arc or circle square to its radius at
the shared end (plus the circle's plane block in 3D), another spline end to
end; which end is the one they share (through `coin`s too), or named:
`tan(a, b, "end")`.

**What each sketch edit and the surface sweep does with a spline** — each
a decision, vetoable; every refusal's message is tested
(`test/splineedit.test.ts`):

| edit | with a spline | how |
|---|---|---|
| trim (sketch) | **partly** | A spline **cuts** a line, an arc or a circle it crosses; the new end is held on it by `onspline`. A spline itself is refused: `"sp1" is a spline, and trim trims nothing of one yet — a piece of a spline would be a spline through points it does not go through. A spline does cut a line, an arc or a circle it crosses` |
| extend | **partly** | A line or arc **extends to** a spline (the end held `onspline`); a spline is not lengthened: `… extend does not lengthen one — drag its end out. A spline does cut …` |
| offset | **refused** | `"sp1" is a spline, and offset does not offset one yet — an offset of a spline is no spline …` — also for a chain a spline is part of |
| bevel (chamfer), sketch fillet | **refused** | The corner tools take two lines: `"sp1" is not a line` |
| mirror | **works** | The copy is the spline through its points' mirrors, held by `sym`, following its original |
| linear and circular patterns | **works** | Each copy the spline through its points' copies — an isometry, so the original's exact image |
| surface: extrude a sheet | **works** | The kernel's sheet from the spline's exact NURBS; area = length × depth to 1e-5 |
| surface: turn a sheet | **works** | Its area by Pappus, the turn by ∫ r ds, to 1e-5 |
| surface: trim a surface by a spline | **refused** | `a surface is trimmed by a line, an arc or a circle — sp1 is a spline` |
| a region bounded by part of a spline, extruded | **refused** | `a part of the spline "sp1" bounds this region — a spline makes a solid only whole, an edge from its first point to its last or a loop on its own …`. A whole spline extrudes and revolves: as an outline's edge, or closed on its own, or as a hole |
| `addThrough` / `removeThrough` under a feature | **refused** | `… is part of e1, whose lid is a spline through the twins of its points — edit the spline before extruding it, or del("e1") and extrude it again` |

Not tried: a planar surface from a closed spline's region, knit, thicken,
and surface offset of a spline sheet — each goes through the kernel's own
B-spline faces and none was measured.

**The OpenCascade reading.** OpenCascade 8.0.1 through cadquery-ocp
8.0.1.1.0 from PyPI, Python 3.11, in the session's scratch directory, never a
dependency. The six parts are `test/stepspline.test.ts`'s, written by
`NEOCAD_STEP_OUT=<dir> node --experimental-strip-types --test
test/stepspline.test.ts` and committed with what OpenCascade read
(`test/fixtures/step-spline/validated.json`, whose `read` says exactly how).
Each read twice, as `step-export.md`'s fixtures were: as an application
reads (`STEPControl_Reader`, standard healing, `BRepCheck_Analyzer`, closed
shells, no free edges, a far point OUT, a tight box) and strictly (each
`MANIFOLD_SOLID_BREP` through `StepToTopoDS_Builder`, only the pcurve fixes a
file without pcurves needs, every tolerance still the file's 1e-7). Volumes
are BRepGProp's **Gauss–Kronrod** integration to 1e-9: its adaptive
integrator at 1e-10, which the ellipse's table used, read these B-spline
walls 2e-4 to 4e-4 off (kept in the fixture as `volumeAdaptive`). The closed
forms are the spline's own — its vector area ½∮ p × p′ and its first moment,
by 5-point Gauss–Legendre per knot span, exact for a cubic — not any solid
integrator's.

| part | what | valid (healed / strict) | volume (OpenCascade, GK) | closed form | faces |
|---|---|---|---|---|---|
| spline-d | an open spline over a line, extruded 12 | yes / yes | 5028.306358 | 5028.306358 | 3 planes, 1 surface of linear extrusion |
| closed-spline | a closed spline through five points, extruded 6 | yes / yes | 1890.635961 | 1890.635961 | 2 planes, 2 extrusions (the two exact halves) |
| tilted-spline | closed, on a plane tipped 0.5 rad, in no frame's plane, extruded 9 | yes / yes | 3156.324883 | 3156.324883 | 2 planes, 2 extrusions |
| plate-spline-hole-boss | the tilted plate, a closed spline cut through, a smaller one bossed 5 — the kernel's body | yes / **no** | 57416.130853 | 57416.130854 | 7 planes, 2 B-spline surfaces |
| spline-revolved | the D turned a quarter about its straight side | yes / **no** | 4074.394792 | 4074.394792 | 1 surface of revolution, 2 planes |
| spline-wireframe | the closed spline extruded, a loose open spline beside it (`curves: true`) | yes / yes | 1890.635961 | 1890.635961 | 2 planes, 2 extrusions; 1 loose B-spline edge |

Every volume agrees with its closed form to 3e-11 relative or better, and
every tolerance is the file's 1e-7. Every spline edge reads back as a
`B_SPLINE_CURVE_WITH_KNOTS`. **The strict read rejects two, neither for the
spline**, each measured on a part with no spline in it: the kernel body's
hole wall is one seamed B-spline face (`splitSeams` halves only circles) —
the ellipse's `plate-oval-hole-boss` and the kernel suite's
`turned-and-drilled` fail the same way; and the D's wall meets its axis at
two poles — a circular segment and a triangle turned a quarter the same way
fail strictly too, exported from the branch before this one, byte for byte
the same files. Both are `STRICT_FAILS` in the test, with the reason, and in
TODO.md. The healed read, every application's, takes all six.

Deviations and additions — each a decision, vetoable:

- **No normal.** The plan gave the spline a circle's three normal
  variables. Its control points are affine combinations of its points, so a
  spline whose points lie in a plane lies in it whatever is solved; it is
  held on its sketch plane by `onplane` on its points, as a line is. Three
  more variables only a `par` could hold would say what the points say.
- **Tangent handles not built** (the plan's option). `tan(line, sp1)` at an
  end does the same work with an ordinary line the user draws there; the plan
  left handles optional, and a handle would be that line made automatically.
- **A spline is named `sp1`, `sp2`, …** — `s` is the surfaces'.
- **Two points make a spline** (a straight segment); three a closed one. A
  point may not repeat (a closed spline closes by `closed`, not by naming its
  first point again), and consecutive points must be apart.
- **Ending it**: a second click on the last point (a double-click, or a
  double tap), Enter, or ✓ ends it open; a click on the first point, with
  three or more laid, closes it. The finger's chip says "tap more, ✓ ends,
  the first closes" — the mouse's sentence wrapped on an iPhone (looked at).
- **`addThrough` is not shape-preserving.** An interpolating spline through
  one more point re-spaces its knots and bends a little differently: under
  2 % of its length in the suite's case. A point on the curve that kept the
  curve exactly would need a knot inserted, and the curve would then no
  longer be the interpolant of its points. `help()` says so.
- **Drawn by turn as well as by distance.** Sampled to a quarter pixel the
  wall of an extruded spline still showed bands at 3×, where a tight bend's
  facets turned several degrees at once (looked at); no chord turns more than
  2° from the next now (`MAX_TURN`), split by halving, read off the Bézier
  pieces' hodographs with no allocation (0.3 ms for a ten-point spline).
- **Format 18** (`values.splines`, the control points, so a file opens at
  the solution it was saved at; `values.params`, the `onspline` parameters).
- **The solid kernel takes the spline as its exact NURBS** (the `nurbs`
  member the ellipse added — nothing in `src/solids/` or the glue changed);
  the exact B-rep writes a closed spline as **two exact halves**
  (`subCurve`), because no face may have a seam and no edge be closed
  (solids.ts's rule).
- **Found by the unit suite, not this package's: the kernel's revolve named
  its faces by the first points of the profile's members** (`tagRevolve`),
  which say nothing of the side when a member starts on the axis; a circular
  segment whose arc centre lies below the axis took the wrong side. It now
  reads points along every member (`memberPoints`); the regression test is
  arcs only and fails on the old code.
- **Found writing the refusal's test: a chord between two of a closed
  spline's own points split nothing.** The regions cut a curve where a
  relation holds a point on it, and nothing holds a spline's through-points
  on it — its definition does. `EntityKindSpec.through` says which points a
  kind passes through; `heldOnCurves` reads it, so the regions, the profile
  walk and the sketch edits agree. The chord now makes two regions (each
  refused, as part of the spline); the test failed before.
- **Found writing the fixtures: a closed spline in no frame's plane could
  not be extruded** — `sketchface.ts` took a lone closed curve for a circle
  and asked it for a normal. Only a kind with a plane facet answers for its
  plane now; the test fails on the old code with the old message.
- **Found by looking** (and counted in ARCHITECTURE.md's e2e list): a
  feature lid's spline points drawn as dots on the lid (now quiet, as a lid
  circle's centre is); the wall's bands at 3×; the phone chip's wrapped
  sentence.

Pictures 246–260, each looked at: 246 the curves flyout (ellipse and spline);
247 a spline previewed through its clicks; 248 drawn, its ends quiet; 249 a
through-point dragged, the curve still through every point; 250 a dimension
between its ends; 251 the menu's Add point here; 252 a spline profile
extruded; 253 its wall at 3× and 254 the trough close up, unbanded (the
second picture after the turn bound — the first showed the bands); 255 a
closed spline closing on its first point; 256 extruded; 257–260 the same on
an iPhone 13: tapped with ✓ to end, drawn, a closed spline extruded, its wall
at 3×.

Limitations left in place, deliberately:

- Trim, extend and offset of a spline itself, and a region bounded by part of
  one: refused by name (the table). A piece of a spline is a spline through
  points that are none of its own; that needs a curve that is not an
  interpolant, which nothing makes yet.
- No length dimension, no curvature comb, no tangent handles.
- The strict OpenCascade read of a kernel body's closed B-spline wall, and of
  a partial revolve meeting its axis — the table; neither the spline's.
- `addThrough` and `removeThrough` refuse a spline a feature is built on.
- Touch was Chromium's iPhone 13 emulation, not a phone.
