# Plan: sketch relations — the missing ones, a dimension tool, and knowing what is free

**Status: queued** (2026-11-05), after `toolbar-groups.md`, in parallel with
`sketch-shapes.md` and `sketch-edit.md`. The owner: *"give me better sketch
tools, relations, trim, slot... all the usual"* — and earlier *"strict rule
enforcement"*: a model should say what is under-constrained and what
conflicts.

Today: `dist fix onPlane coin mid par perp ang on eq rad oncircle conc
eqrad tan sym arcends`, placed by typing or from the context menu, with
Onshape-style inference while drawing. Missing against SolidWorks and
Onshape: a **dimension tool** that measures what you click, a **constrain
tool** that applies a relation to a selection, a few relations, and any
**diagnosis** beyond `SOLVED`/`CONFLICT`.

Read `CLAUDE.md`, `docs/ARCHITECTURE.md` ("Constraints are drawn",
"Relations follow their entities"), `constraint-glyphs.md`,
`dimension-labels.md`, `dimensions-are-named.md`, `onshape-inference.md`,
`clauses.md`, `context-menu.md`, `toolbar-groups.md`, `src/relations/`,
`src/replenv.ts`, `src/persist.ts`, `src/menu.ts`, `src/snapping.ts`,
`src/kernel/problem.ts` (the Jacobian the solver already has),
`src/statusline.ts`, `src/tools/selection.ts`, and their tests.

## Design

- **Relations added** (each registered in `replenv.ts` *and* `persist.ts`,
  the rule in `CLAUDE.md`; dimension-generic; never a squared residual):
  - `collinear(l1, l2)` — `par` plus an end `on`; one relation, one glyph;
  - `horizontal(a, b)` / `vertical(a, b)` for two **points** and for a line
    — the frame's axis by name as `par` takes it, so `par(l, xaxis())` is
    what it journals; glyphs `—` and `|` (the register retired `hor`/`ver`
    as tools; these are the relation names Onshape users type, and they
    expand to `par`, documented);
  - `eq` extended to arcs and circles together (`eqrad`) and to a line and
    an arc's length if cheap, else say so;
  - `midpoint` of an arc (`mid(p, arc)`);
  - `tan(arc, arc)` and `tan(arc, line)` at a shared end — smooth joins,
    which the one-arc tool infers; make the typed relation first-class;
  - `pierce(point, curve)` — 3D: a sketch point on the curve where it
    crosses the sketch plane (point `on` curve, point `onPlane`);
  - `intersection(point, c1, c2)` — a point held at two curves' crossing
    (`on` both), the relation the trim and extend ops lean on;
  - `equalSpacing(points...)` if cheap — else later.
- **Dimension tool** (`dimension`, its own button): click a line (length),
  two points (distance), a point and a line (distance), two lines (angle; or
  distance when parallel), a circle or arc (radius; option diameter), then
  place the label with a click; it types `dist`/`ang`/`rad` as the menu
  does now, with the same rounding. The label is draggable after
  (`dimension-labels.md`). Option: **driven** — a reference dimension that
  measures and never constrains (drawn in parentheses; `measure(...)`,
  journalled, updated live).
- **Constrain tool** (`constrain`): with entities selected, the toolbar's
  button (or the panel it opens) lists the relations that apply to that
  selection — two lines: par, perp, eq, collinear, ang, dist; a point and a
  line: on, mid, dist; two circles: conc, eqrad, tan; … — one click applies
  one, typed as the relation. The context menu keeps its items; this is the
  same list, reachable from the toolbar with a selection.
- **Diagnosis** — what the owner called strict rule enforcement, as far as
  the solver can say it:
  - **Free entities are drawn differently** (Onshape's blue): after each
    solve, the Jacobian's null space says which variables are free (rank
    from the kernel; expose a `freeVars()` on the problem, dimension-generic
    and point-blind as the layer rule demands, and let `model.ts` map
    variables to entities). An entity with a free variable is drawn in the
    "free" ink; a fully-held one in the normal ink. The status line says
    `SOLVED · 3 free` and `help()` explains it. Measure the cost on the
    biggest fixture; it must not slow a drag (compute it when the drag
    ends, not per frame, and say so).
  - **Conflicts name their relations**: a `CONFLICT` says which relations
    cannot all hold — the rows of the residual that stay large, mapped back
    through `model.relation`'s handles — in the status and the log, and
    those relations' glyphs are drawn in the conflict ink. Clicking one in
    the status selects it; Delete removes it (`constraint-deletion.md`).
  - **Redundant relations** (consistent but over-constrained): detected by
    rank, reported like a conflict but in a softer word, never blocking.
- All typed names in `help()`; glyphs in `constraint-glyphs.md`'s table.

## Tests

Unit: each relation's residual and gradient at a root; in 3D on a tilted
plane; `collinear`, `pierce`, `intersection` follow a drag; `freeVars` on a
rectangle with and without its dimensions (which variables, and which
entities); a conflict names exactly the relations that disagree (two
distances on one line); a redundant `eq` reported, not failed; the
dimension tool's rounding equals the menu's; every new op replays. E2E
(mouse and iPhone 13): dimension a line, an angle, a radius; constrain two
selected lines parallel from the toolbar; free entities drawn in the free ink
until dimensioned, and the status count going to zero; a conflict's relation
drawn in the conflict ink and deleted from the status. LOOK at each.

## Docs

CHANGELOG at the top quoting the owner; ARCHITECTURE (diagnosis: what the
kernel exposes and what the model maps; the layer rule kept); the register
(the relation names, `horizontal`/`vertical` as expansions, driven
dimensions, the free ink) as vetoable; STATUS; README; `help()`; the spec
marked built with the deviations.
