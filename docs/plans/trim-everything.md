# Plan: trim every sketch curve, and power trim by dragging across

**Status: queued** (2026-11-08). The owner: *"Also need trim for sketch
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
