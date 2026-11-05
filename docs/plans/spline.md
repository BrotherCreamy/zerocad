# Plan: the spline — a B-spline curve through points you can drag

**Status: queued** (2026-11-05), after `sketch-shapes.md` (the ellipse
teaches the seams a second curve kind needs; this follows them). The owner:
*"give me better sketch tools, relations, trim, slot... all the usual"*.

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
