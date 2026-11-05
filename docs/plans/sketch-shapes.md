# Plan: sketch shapes — polygon, slot and the ellipse

**Status: queued** (2026-11-05), after `toolbar-groups.md`. The owner:
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
