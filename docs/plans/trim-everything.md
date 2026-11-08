# Plan: trim every sketch curve, and power trim by dragging across

**Status: built** (2026-11-08), on `claude/trim-everything`; see *As built*
at the end for every deviation. The owner: *"Also need trim for sketch
entities"*.

## What is true today

There is a trim tool, in the modify group's flyout (`src/tools/trim.ts`,
`src/sketchedit.ts`'s `trim`). You click the piece to remove, and it trims
lines, arcs and circles: a circle becomes an arc, and an arc's end is
re-pointed.
- It does not trim an **ellipse** or a **spline**. Both are logged in TODO
  (`spline.md`'s "Trim, extend and offset of a spline"; the ellipse likewise),
  because the piece of one is not the same kind of entity.
- There is no **power trim** (SolidWorks: drag across the pieces to remove).
- The owner may not know the tool exists: it lives inside a flyout.

Read `CLAUDE.md`, `docs/ARCHITECTURE.md` (relations vs operations: a trim is
an operation), `docs/plans/sketch-edit.md`, `sketch-shapes.md` (the ellipse),
`spline.md`, `toolbar-groups.md`, `src/sketchedit.ts`, `src/intersect.ts`,
`src/bspline.ts`, `src/kinds/ellipse.ts` and `spline.ts`, `src/tools/trim.ts`
and `extend.ts`, and the trim and extend tests.

## Design

1. **Every curve kind trims**: line, arc, circle, ellipse, spline, and their
   construction versions, against any other curve kind. `intersect.ts` must
   find every pair's crossings, in 2D and on any plane in 3D.
   - **An ellipse's piece is an elliptical arc.** Add it as an entity kind
     through `EntityKindSpec`, the way the ellipse and spline came in (no
     `ellipse`-named code in `model.ts`). It needs a centre, axes and two end
     points held on it. It must be extrudable, regionable, exportable to STEP
     (an elliptical edge, trimmed), and closed back into an ellipse when the
     trim is undone.
   - **A spline's piece is a spline that need not pass through points it
     does not own.** The spline TODO names the fix: a B-spline of control
     points (the piece of an interpolant is exactly a clamped B-spline, by
     knot insertion). Build that representation, or an equivalent you
     justify. It must also serve **extend and offset of a spline**, which are
     in TODO for the same reason; build those too if the representation
     makes them small, and say so if not.
   - Relations on the trimmed curve survive where they still mean something
     (a tangent at the kept end; a `conc`). One that no longer applies is
     removed and logged, as trim does today.
2. **Power trim**: with the trim tool armed, press and drag across curves.
   - Every piece the stroke crosses is removed, in one undo step, typed as
     one `trim` per piece in a single grouped call.
   - The stroke is drawn as you drag, and each piece goes red as it is
     crossed.
   - By finger this is the natural gesture. Click to trim one piece stays.
   - The touch gesture recogniser (`gestures.ts`) already tells a drag from
     a tap. Make sure a trim drag doesn't pan, and note it in the gestures
     table.
3. **Trim to closest, and extend by shift or long-press**, as SolidWorks'
   trim does: only if the walkthrough shows a need. Say what you chose.
4. **Discoverability**: the trim tool's button. The modify group's flyout
   should show the member armed last. If the owner can't find trim, the
   group's default face should be the most-used member. Check the toolbar at
   the phone width and say what you changed, if anything.

## Tests

- **Unit, 2D and 3D**:
  - Each kind trimmed against each other kind: the right piece goes, and the
    kept piece is geometrically the same curve.
  - An elliptical arc and a trimmed spline extrude, regenerate, and export
    to STEP; read the STEP back with the kernel where the suite already does.
  - Undo restores the whole curve.
  - Save/open replays.
  - A power-trim stroke over three pieces removes three, in one undo.
- **E2E, mouse and iPhone 13**:
  - Trim an ellipse crossed by a line.
  - Trim a spline crossed by a circle.
  - Power-trim a sketch of crossing lines by dragging a finger across.
  - LOOK at every picture.

## Docs

- CHANGELOG at the top, quoting the owner.
- STATUS.
- ARCHITECTURE: the new kinds.
- The register: the elliptical arc as a kind, the control-point spline,
  power trim's undo grouping.
- Tick the spline and ellipse TODO items this closes.
- `help()`.
- The spec marked built.


## As built

Built on `claude/trim-everything` (2026-11-08), from
`claude/resume-tasks-o7q02e`. By file:

- **New.** `test/trimeverything.test.ts` (each kind trimmed by each kind in
  2D and on a tilted plane in 3D; each kind's own rules; power trim's
  typing), `test/trimsolids.test.ts` (extrude, regenerate, STEP, the solid
  kernel, wireframe), `test/e2e/trimeverything.e2e.ts` (four tests, mouse
  and iPhone 13), pictures 360–369.
- **The kinds.** `src/kinds/ellipse.ts`: `EllipticArcEntity`,
  `EARC_STRUCTURE`, `addEllipticArc`, `ellipseToArc` / `arcToEllipse`,
  `retargetEllipticArc`, `ellipseOf` answering for either conic, `isConic`.
  `src/kinds/spline.ts`: `BSplineEntity`, `BSPLINE_STRUCTURE`, `addBSpline`,
  `checkBSpline`, `controlCurve`, `pathCurveOf`. `src/modules/sketch.ts`
  declares both (`EARC`'s frame, `BSPLINE`'s path) and the replay ops
  `addEllipticArc` and `addBSpline`. `src/arcgeom.ts`: `ArcFrame.t0`,
  `eccentricAnomaly`, `ellipticArcFrame`; `arcPoint`, `arcTangent`,
  `portionAngles` and `sampleAngle` read the start.
- **The crossings.** `src/sketchgeom.ts`: every declared curve is a carrier
  (`isSketchCurve` reads the kind's `curve`); `conicsMeet`, `pathsMeet`,
  `strokeCrossings`; paths are cut and measured (`fractionAlong`, `pointOn`,
  `lengthOf`, `distanceToCurve` by `nearestParam`); `curveEnds` exported.
- **The trim.** `src/sketchedit.ts`: `checkTrimmable` takes every curve
  (extend: a line, an arc, an elliptical arc); `trimPiece` reads closed kinds
  generically; `applyTrim` dispatches to `trimEllipticArc` and `trimPath`;
  `planPieces` and the journalled `PiecePlan`; `planTidy` knows every kind's
  hold and a spline's through-points and tangents.
- **The relations.** `src/relations/spline.ts`: `isPathCurve`, `onspline`
  and `tan` on either spline kind (`bsplineAt`); `src/relations/geometry.ts`:
  `tan` and `eqrad` take an elliptical arc; `src/relations/extrusion.ts`,
  `revolution.ts` hold both twins.
- **Solids.** `src/operations.ts` (profile kinds, ends, twins, regeneration
  matching, the refusals), `src/solids.ts` (the piece, `ellipticArcMember`,
  loose curves), `src/step.ts` (a trimmed curve on a declared basis),
  `src/loops.ts` (a declared open frame kind is an arc edge; its piece from
  `t0`).
- **The app.** `src/tools/trim.ts` (rewritten: power trim, `strokeOrder`, a
  click on release), `src/tools/editdraw.ts` (`curveUnder` takes a kind
  predicate), `src/tools/extend.ts`, `src/main.ts` (an elliptical arc drawn
  open; a spline piece's control polygon; the chip after a typed tool name),
  `src/boxselect.ts`, `src/glyphs.ts`, `src/replenv.ts` (`ls()`),
  `src/dimensioning.ts` (the kind list), `src/menu.ts` (construction),
  `src/persist.ts` (an elliptical arc's minor and normal saved),
  `src/tools/gestures.ts` (the table).

Deviations and decisions, each in TODO.md's register and vetoable:

- **The spec said `intersect.ts`**, but that file is screen space, and it
  already crosses polylines, which is how an ellipse and a spline reach it.
  The world-space crossings trim reads are `sketchgeom.ts`'s, and that is
  where every pair was added.
- **Kind names**: `earc` (an elliptical arc, `ea1`) and `bspline` (a spline
  of control points, `bs1`). A trimmed curve keeps its own name.
- **No format bump**: a newer file in an older build is refused at the trim
  step by name, never misread (persist.ts's precedent for added ops).
- **Trim to closest and extend by shift**: not built, no need found. A click
  already takes the piece between the nearest cuts, and extend is its own
  tool on the same button.
- **Extend and offset of a spline: not built.** The representation does not
  make them small: extending needs an unclamp and a reach along the end
  span, offsetting needs a fit to a tolerance. TODO.md says how.
- **Discoverability**: trim is the modify group's first member, so its face
  until another is armed; the flyout already showed the member armed last.
  The tray at the iPhone 13's width is unchanged: thirteen buttons in one
  column (picture 369). The glyph changed (below).

Found, and fixed:

- **By the unit suite**: an S-shaped spline's control polygon has no signed
  area, so `pathNormal` read it as straight and a line across one cut
  nothing. It takes the largest triangle now. The tidy asked `referentsOf`
  of a relation (it takes one argument), so a through-point a dimension used
  was deleted as unused.
- **By the browser** (ARCHITECTURE.md 58–60): a tool armed by its typed name
  left the chip saying Select; a spline piece's control points read as stray
  dots (the polygon is drawn now); trim's glyph read as a plus sign on the
  iPhone (the piece is struck out now).

**Verification** is in CHANGELOG.md's entry: the counts before and after,
and the full `npm run test:all` at the end.

Pictures, each looked at: 360 the ellipse's piece red under the cursor; 361
the ellipse trimmed to an elliptical arc, drawn open; 362 the spline's end
inside a circle red; 363 the spline trimmed, its control points and dashed
polygon; 364 a mouse power trim mid-stroke, two pieces red, the stroke
dashed; 365 the three pieces gone, one entry; 366 the ellipse and spline
trimmed by taps on an iPhone 13; 367 a finger power trim mid-stroke; 368
three pieces gone, the view not panned; 369 the iPhone's tray, modify's face
the new trim glyph.

Limitations left in place, deliberately (TODO.md): extend and offset of a
spline; a revolve of an elliptical arc; part of either piece bounding a
region; a trimmed spline's through-points ride the piece and do not drive
it; power trim reads its pieces at the press; an elliptical arc's major end
drawn even off the arc. *Touch was Chromium's iPhone 13 emulation, not a
phone.*
