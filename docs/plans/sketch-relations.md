# Plan: sketch relations — the missing ones, a dimension tool, and knowing what is free

**Status: built** (2026-11-05), on `claude/sketch-relations`; see *As built*
at the end for every deviation. After `toolbar-groups.md`, in parallel with
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

## As built

Built on `claude/sketch-relations` (2026-11-05). By file:
`kernel-rs/src/analysis.rs` (`null_support`, 8 Rust tests) and `lib.rs` (its
wasm export); `src/kernel/problem.ts` (`Problem.analyse`, `GaugeRow`,
`Analysis`, `SolveReport.blocks`, `labelOf`); `src/model.ts`
(`Model.diagnose`, `Diagnosis`, `Model.conflicting`, `diameter` in
`DIMENSION_OPS`, `REFERENCE_OPS`); `src/relations/basic.ts` (`dist` to a line
and between lines, `mid(p, arc)`); `src/relations/geometry.ts` (`collinear`,
`intersection`, `pierce`, `equalSpacing`, `diameter`, `eq` over circles and
between a line and an arc, `tan`'s join form); `src/relations/measure.ts`
(`measure`, `measured`); `src/dimensioning.ts` (`roundValue`,
`dimensionFor`, `constraintsFor`); `src/tools/dimension.ts`,
`src/tools/constrain.ts`, `src/tools/picked.ts`; `src/tools/tool.ts`
(`ToolContext.prenamed`, `Tool.commands`/`ran`); `src/tools/engine.ts`
(hands the selected names over at arming); `src/tools/icons.ts` (two
glyphs); `src/glyphs.ts` (the new marks, `—`/`|`, `⌀`, driven labels,
`distEnds`); `src/picking.ts` (short names); `src/menu.ts` (one rounding, the
Constrain list on a selection); `src/panels.ts` (command rows,
`PanelCommand`); `src/statusline.ts` (`diagnosisLine`); `src/main.ts` (the
ink, the diagnosis after each solve, the status's clickable names, the two
imports after `fillet.ts`); `src/replenv.ts` and `src/persist.ts`
(registrations, `deg`, `help()`); `index.html` (`#diagnosis`, `.ocmd`).
Tests: `test/sketchrelations.test.ts` (37), `test/e2e/sketchrelations.e2e.ts`
(10: mouse, iPhone 13, iPhone 13 landscape); counts in
`dimensions.test.ts`, `glyphs.test.ts`, `oldfiles13.test.ts`,
`toolbargroups.test.ts` and five e2e files moved from eleven buttons to
thirteen. Pictures: docs/images/118–126.

**The relations, and what each journals:**

| typed | journals | note |
|---|---|---|
| `col(l1, l2)` | `collinear [l1, l2]` | both of l2's ends on l1's line: two wedge blocks, lazy |
| `horizontal(l)`, `horizontal(p, q)`; `vertical(…)` | `parallel [l, "f.x"]` / `[p, q, "f.y"]` | an expansion; the default frame's axis, resolved at the call |
| `eq(c1, c2)` | `equalLength [c1, c2]` | circles/arcs: equal radius |
| `eq(l, a)` | `equalLength [l, a]` | a line as long as an arc (r·θ, θ by `atan2`); refused above 3D |
| `mid(p, arc)` | `midpoint [p, arc]` | rim + equal chords (+ plane in 3D); two solutions, the seed's kept |
| `dist(p, l, d)`, `dist(l1, l2, d)` | `dist [p, l, d]` | perpendicular; two lines: l2's middle from l1 |
| `intersection(p, c1, c2)` | `intersection [p, c1, c2]` | `on`/`oncircle` for each, one relation |
| `pierce(p, curve, plane?)` | `pierce [p, curve, plane]` | 3D only; plane resolved and journalled |
| `spacing(p1, p2, p3, …)` | `equalSpacing [p1, …]` | every gap the first; no collinearity |
| `dia(c, d)` | `diameter [c, d]` | a `d`-named dimension, settable, drawn `⌀d` |
| `measure(kind, …names)` | `measure [kind, …names]` | driven: no blocks, `d`-named, unsettable, drawn `(…)` live |
| `tan(arc, line)`, `tan(arc, arc)` | `tangent`, as before | at a shared end, the join form (below) |

**The dimension tool** (`dimension`, its own button after modify): click a
line, two points, a point and a line, two lines, or a circle or arc — a
second click on a picked one drops it, a third thing when two are picked
starts again from it — then click empty canvas (or a glyph, or a frame) and
it types `dist`/`ang`/`rad` holding what it measures, rounded by
`roundValue`, the menu's own. The number is previewed by the cursor in the
picking green. Options: `diameter` types `dia`; `driven` types `measure`.
On a phone: tap, tap, tap empty canvas.

**The constrain tool** (`constrain`, its own button): armed on a selection
it starts from it; otherwise click (tap) what to relate, a click on empty
canvas dropping the picks. The options panel lists `constraintsFor`'s
relations as rows, each showing the command it types; a press types it
through `submit` (one undo step) and spends the picks. The context menu on a
selection of two or more carries the same list under a *Constrain* heading.

**Free variables: how found, how mapped, what it costs.** `null_support`
(Rust) splits the sparse Jacobian into connected components (columns joined
when a row reads both), and eliminates each densely to reduced row echelon
form, columns in order, the largest remaining entry as pivot, rank relative
to each column's own norm (1e-9). A column is free when it is a non-pivot or
a pivot some non-pivot's null vector reaches. `Problem.analyse` asks it of
J plus gauge rows (free variables; `dof` = columns − rank) and of Jᵀ over
the stored rows only (a non-pivot there is a row the earlier rows already
imply). It is point-blind: variables, rows, handles. `Model.diagnose` passes
only live entities' variables (deleted ones are tombstoned, not compacted,
and would count), adds the gauges, and maps back: an entity is free when a
variable it owns or a point it refers to is. **Measured** (Node, this
machine, median of 21): on the biggest fixture the suite carries
(`pre-explicit-regions.neocad.json`: 70 entities, 148 variables, 83 blocks)
**2.1 ms** per diagnosis, against 9.5 ms for one drag-frame solve of the
same file; on a synthetic 40-rectangle sketch (320 entities, 480 variables,
`test/sketchrelations.test.ts`) 13.5–15.6 ms. It runs in `solveAndRender` —
after a commit, an entry, an undo, and once at the end of a drag (the
engine's `onSolveRender`) — never per drag frame, which draws with the last
answer.

**Conflicting rows: how found, how mapped.** A failed solve ends at a
least-squares minimum, where the residual lies in Jᵀ's null space, so the
rows still large are rows in a dependency. `SolveReport.blocks` names their
blocks (the 0.05 threshold the verdict already uses); `Model.conflicting`
maps each to the relation whose `model.relation` collected it, and names a
block no relation owns by its label. Two `dist`s on one line name exactly
those two.

Deviations and additions — each a decision, vetoable:

- **`tan` at a shared end changed residual** (what "first-class" took). The
  distance form, |(ctr − p) ∧ u|/|u| = r, is a double root where a line
  leaves an arc's own end: the end is already on the rim, so the line
  touching there is the triangle inequality's boundary and the gradient
  vanishes at the root. Measured: the solve stopped within √tol (a fillet's
  tangent points 1.8e-3 off in an old fixture), and the rank analysis read
  every such joint as free. Now, when the line's end (read at each
  evaluation) is one of the arc's: (end − centre) · (q − p) = 0; for two arcs
  sharing an end, the centres and the end collinear (their wedge, along the
  first arc's normal in 3D). Same journal, same solutions, exact.
  `oldfiles13.test.ts` now expects `pre-explicit-regions`'s four tangent
  points at (35, 0) and (40, 5), base and lid, exactly, and its arcs' sweep
  π/2 exactly, where the recording build had them 1.8e-3 and 3.8e-4 short.
  On a shared end `tan(a1, a2)`'s `side` is no longer enforced: whichever way
  they were drawn, held by the seed.
- **Two gauges are not freedoms**: a curve's normal length (one row along
  it), and a point lying on the drawing plane or the ground (one row along
  that plane's normal). Without the second, everything drawn on the ground
  in a fresh document — which holds no point there — is free in z forever.
  A point off both planes counts in full.
- **Redundant means "every row implied by earlier rows"**: the later of two
  ways of saying one thing is named, never the first, and a relation only
  partly implied (a 3D `par`'s third wedge component, an `oncircle`'s plane
  row beside an `onplane`) is not. Order is part of it: the arc tool's own
  order (ends, arc, hold, arcends) reports nothing (tested); the same
  relations in another order can name the `par`. **Found:** opening
  `pre-explicit-regions` reports `r24`, the `par(a1, "f1.z")` the old-file
  translation adds to a fillet's arc, whose two tangents already hold its
  normal — genuinely redundant, and orange in the app.
- **The label is not draggable.** The spec says "draggable after
  (`dimension-labels.md`)"; that package built no dragging, and a label's
  place has nowhere to be kept (glyphs hold no state; a position is not a
  relation). The placement click commits; the label sits where the glyph
  layer puts it. Filed in TODO.md.
- **The axis `par` changes mark**: every `par` against a frame's x or y axis
  now wears `—` or `|` (a z axis, and line-to-line, keep `//`), so old
  drawings' level edges change mark too. `glyphs.test.ts`'s axis test says
  `—`.
- **No `hor`/`ver` short names**: only the long ones; the register's retired
  words stay retired.
- **The verdict says only `CONFLICT`**; the names are in `#diagnosis` beside
  it, each a button (selects it; Delete removes it). It used to list block
  labels. The log says the relations in full, once per change.
- **The count is degrees of freedom** — `5 free`, `0 free` — not entities.
  It fades with SOLVED; a conflict and a redundancy stay.
- **`deg(x)`** is new at the command line: the dimension tool types
  `ang("l1", "l2", deg(45))`, degrees rounded to a thousandth (a thousandth of
  a radian is a seventeenth of a degree).
- **`equalSpacing` and `eq(line, arc)` are in**, both cheap, 2D and 3D.
- **Two lines are a distance only when parallel to 1e-6** (sin θ); two drawn
  near-parallel by hand get their small angle, as Onshape gives.
- **Thirteen buttons**: on an iPhone 13 in landscape the tray is two rows
  again (it was, at thirteen, before one-circle-one-arc made it eleven);
  `fits.e2e.ts` says two. Every count of eleven in the suite says thirteen,
  and the fits docking test no longer pads to thirteen with tools of its own.
- **The menu's empty-canvas tool items do not list dimension or constrain**;
  the toolbar and `arm` do.

Limitations left in place, deliberately:

- **First-order**: a variable held only by a residual whose gradient
  vanishes at its root reads free — the reason no relation is a square, and
  why `tan` needed its join form.
- **Dense per component**: one huge connected sketch costs rows × cols ×
  rank; 480 variables in one chain is about 15 ms.
- **`mid(p, arc)` and `pierce` through a circle have two solutions**; the
  seed decides, as with `tan`'s sides.
- **Not tried on an iPhone**: Chromium's emulation, as every phone test.
