# Architecture

Why the code is shaped the way it is. For *what exists* see
[`STATUS.md`](../STATUS.md); for *how to work on it* see
[`CONTRIBUTING.md`](../CONTRIBUTING.md).

The one-sentence version: a general nonlinear least-squares solver that knows
nothing about geometry, with 2D CAD built on top of it as an ordinary library,
and a command line that can extend that library at runtime.

## The layers

Each layer may only know about the ones below it. That constraint is the main
thing holding the design together, and most of the interesting decisions in
this document are consequences of it.

```
  ┌──────────────────────────────────────────────────────────────┐
  │ main.ts          the browser app: canvas, render loop, wiring│
  ├──────────────────────────────────────────────────────────────┤
  │ repl.ts          a scoped evaluator                          │
  │ replenv.ts       ...and the command surface it evaluates in  │
  ├──────────────────────────────────────────────────────────────┤
  │ modules/         the app as modules: core, sketch, solids,   │
  │ modules.ts       files, step, organiser, interface — each    │
  │                  registers into every table below            │
  ├───────────────────────┬──────────────────┬───────────────────┤
  │ tools/               │ operations.ts    │ persist.ts        │
  │ pointer gestures     │ structural edits │ journal + replay  │
  ├───────────────────────┴──────────────────┴───────────────────┤
  │ relations/       equations over entities. No structure.      │
  ├──────────────────────────────────────────────────────────────┤
  │ model.ts         entities: names, references, which vars     │
  │                  they own. No equations.                     │
  ├──────────────────────────────────────────────────────────────┤
  │ kernel/problem.ts   variables + residual blocks + solve()    │
  │ kernel/dual.ts      forward-mode automatic differentiation   │
  ├──────────────────────────────────────────────────────────────┤
  │ kernel-rs/       Rust → WASM. The only linear algebra.       │
  └──────────────────────────────────────────────────────────────┘
```

`view.ts` sits off to the side: the orthographic camera — screen↔world, plus
the plane a pixel lands on — used by the tool engine and the renderer, and
depending on nothing but `vec3.ts`, plain three-vectors that import nothing.
`undo.ts` sits beside it for the same reason — a stack of snapshots, generic
over what a snapshot is, importing nothing at all. `files.ts` is the same
kind again: the document's name and dirty flag (a comparison against the
snapshot at the last open or save), which way a save or share goes for what
the platform offers, and the autosave, all over strings and injected stores.
Its browser half, `filehost.ts`, is host-level — pickers, the share sheet,
drops, IndexedDB — and only `main.ts` constructs it. Three more of that kind
came with Android (docs/plans/android.md), each pure with the browser handed
in: `backstack.ts`, the session-history entries that make a back close what
is open (a fake history in its test); `keyboard.ts`, where a panel being
typed into goes when the keyboard covers it; and `install.ts`, the browser's
install offer kept and made from the logo menu. `step.ts` is pure the
same way, over a model: the Part 21 spelling of what `solids.ts` says each
feature exactly is — a B-rep of planes, cylinders, cones, spheres, tori and
surfaces of revolution with shared vertices and edges — beside `faces.ts`,
which says the same solid for drawing, in flat pieces at the screen's
resolution. The two never share a surface: a drawing is allowed to facet, an
export is not. `solids.ts` reads a curve only through `curveplane.ts` and
`arcgeom.ts` and a feature's plane through `featurePlane`, so where a curve
keeps its orientation is those accessors' business, not the exporter's.
`arcgeom.ts` is the same
kind of file: which way round an arc goes about a given side, and a whole
circle laid out in a given plane, over plain numbers. `curveplane.ts` is the
one that asks the model *which* numbers — a circle's or arc's plane read off
its own centre and normal, and a frame's through `frameBasis`, so it sits above the relations like
`workplane.ts` — and the renderer, the drawing-question modules, the glyphs,
the arc tools and `fillet` all ask it (see "In 3D a pixel is a ray" below).

`toolsource.ts` sits in the `tools/ | operations.ts | persist.ts` row, between
those first and last two: it holds the *text* of tools authored at the command
line, which `persist.ts` carries in a file and `replenv.ts` captures and prints.
It is deliberately not inside either — the registry in `tools/tool.ts` stays
ignorant of persistence, and `persist.ts` stays ignorant of the session — and
what it keeps is session state, not model state. See "A file carries its tools'
source" below.

`groups.ts` sits in the operations row beside `operations.ts`: the edits to
the model's groups and its hidden set, journalled as operations (see "A group
is a set" below). `operations.ts`'s `del` calls its `ungroup`; it imports only
the model.

`menu.ts` sits *beside* `main.ts` rather than under it: it is browser-layer
code that reads the model and returns command strings, and it runs none of
them. It is above `replenv.ts` in spirit — everything it produces is text for
that command surface to evaluate — but it imports nothing from there, because
it only needs to know what the commands are *called*.

`panels.ts` sits beside it, for the same reason and with even less: the panel
manager and the toolbar import nothing from the model or the tools. The
toolbar is handed its tool names, their glyphs (inline SVG strings, from
`tools/icons.ts`), armed tool and which tools cannot run by the host and hands
back a command string; the panel manager is rectangles and `localStorage`.

`facelayer.ts` sits beside `main.ts` as well: the two ways a solid's faces
become pixels — a WebGL layer with a depth test, and the painter's it falls
back to — over what `faces.ts` derives and `view.ts`'s projection. It is the
only browser code below `main.ts` that holds a GPU context, and the only place
the fallback is chosen (see "A solid's faces are drawn, never stored").

`toolavail.ts` is the one rule both of those read for *which tools can run
here* — `toolUnavailable(model, tool)`, the reason or null. The menu imports it
directly; the toolbar gets it only through `main.ts`'s host, which is what keeps
`panels.ts` model-blind. The reason is read out of `resolveFrame`, never written
here, so the menu, the toolbar and the command line's refusal are one sentence.

`picking.ts`, `snapping.ts`, `glyphs.ts` and `boxselect.ts` sit at the same
height as each other, just above the model: each is a pure function of (model,
view, cursor or rectangle) answering one question — what is under it, where
should it be pulled to, what marks should the drawing be wearing, what does
this rectangle catch. None of them draws anything or holds any state, which is
what lets all four be tested without a canvas.
`quiet.ts` is beside them and smaller still — which entities the shaded view
leaves undrawn until the hand is on them — a pure function of the model and
what the draw pass hands it (the view mode, the solids on screen, what is
revealed); it is asked by the drawing alone, never by
the four above, which is what keeps quiet from becoming hidden.

`boxselect.ts` is a separate file from `picking.ts` rather than another
function in it because the two answer differently-shaped questions. Picking is
dominated by *choosing* — tiers, tolerances, nearest wins — because only one
thing can be under the cursor. A box selects everything that qualifies and
nothing competes, so it has no tiers at all; what it has instead is two
predicates per entity kind (contained, touched) and no tolerance beyond the
arc slack. Sharing a file would have meant one of the two concepts leaking
into the other's code.

`loops.ts` is the fifth of them, at the same height: "what closed loops does
this drawing contain" and "which one is this pixel inside". Unlike the other
four it works in the world rather than on screen — a loop is a region of a
plane, read through `curveplane.ts`, and only `loopAt`'s edge-on test is
measured in pixels — and what it counts as connected comes from the relation
registry as well as the geometry: two curve ends are joined only by being one
point or by a `coin` holding them, never by sitting on the same spot, because a
profile whose corners nothing holds together is not one the next drag will
leave closed. A loop is a question rather than an entity: it is found afresh
each time, journals nothing and has no name.

Regions are split as Onshape splits them, by two different arguments that
leave "joined means held" true. A **T** is held — an end kept on an edge by
`on`, `oncircle` or `mid`'s line form — so the edge is cut at that point. A
**crossing** is held by nothing and joins nothing, but which regions a drawing
bounds is a question about its geometry as it stands, so for *finding* regions
two coplanar edges that cross are cut at a **virtual vertex**, a vertex no
entity is, named by the edges through it (`l1×l5`). A loop's members then walk
*portions* of their entities (`from`/`to` a point or a crossing, and a `span`),
each as long as the loop lets it be, so a drawing with no Ts or crossings reads
exactly as it did. What may *keep* a crossing is a feature, never this module:
`extrude` and `revolve` materialise each crossing their profile runs through as
a point held `on` every edge the profile bounds there, before they twin
anything — an operation's job, and the line between the two layers
(`docs/plans/regions-split.md`). A crossing's key is a place along an edge
that the next drag can renumber, so it is never journalled; once
materialised, the crossing is a held point, a T, to every later question.

`sketchface.ts` sits beside `loops.ts`: given a loop and the line of sight, the
three of its points a sketch plane on it is made of — pure, and read by the
sketch tool and the context menu alike, so the two cannot make different planes
of one face.

`faces.ts` is the sixth: what a solid's faces are this frame, which of them
face the viewer, in what order to fill them and how bright — computed, not
drawn, so it is tested without a canvas (see "A solid's faces are drawn, never
stored" below).

`projection.ts` sits between them and the model: each entity's shape *on
screen* — a segment, a circle or arc that is an exact screen circle or arc seen
square-on and a fine polyline on its ellipse seen obliquely — and the way back,
lifting a pixel on that shape to the world point of the entity it shows. Picking,
snapping and box select all ask it, so the three cannot disagree about where an
oblique arc is drawn. `framemarker.ts` reads a frame's axes through
`frameBasis`, the same function every relation written against the frame
reads, so the marker can never show a +y the constraints do not mean.

`workplane.ts` sits above the relations (it reads a plane reference's basis — a frame's, a curve's or three points') and below the
tools and the command surface, which both need its one answer: the plane a
click lands on in a 3D model.

`intersect.ts` sits one step *below* those three: closed-form crossings and the
arc-sweep test, over plain numbers, with no idea a Model exists. It is where it
is because picking and snapping must give the same answer to "is this angle on
the arc" — picking asks it of the cursor, snapping asks it of a candidate
crossing — and a second copy would eventually disagree about an arc's last few
pixels, producing a crossing you can snap to but not click. Keeping it below
both is what lets them share the definition without either importing the other.

## The kernel knows nothing about geometry

`Problem` is a flat vector of numbers plus a list of residual blocks. It has
never heard of a point. That is deliberate and worth protecting: the same
solver is meant to work for anything shaped like a nonlinear least-squares
problem, and the moment `problem.ts` grows a `Point` import that stops being
true.

A residual block is *which variables it reads* plus *a function from Duals to
Duals*. Evaluating that function once yields both the residual's value and its
exact derivatives, because `Dual` arithmetic propagates both at once — so
there is no finite-difference perturbation anywhere, and the Jacobian is
exact and sparse for free.

`addResidual` hands back a **block handle** — monotonic, never reused — and
`removeBlock` spends it. A handle rather than an index, because something
above this file has to remember which blocks belong to which constraint and an
index would be invalidated by every removal that happened to come earlier in
the list. Removing an unknown handle throws: the only way to hold one is to
have been given it, so one that names nothing means the bookkeeping above has
lost track, and a silent no-op would leave that constraint in the drawing with
no sign of why.

`solve()` runs Levenberg–Marquardt in TypeScript and calls into Rust once per
Newton step for the linear solve. The Rust side never forms `JᵀJ` explicitly —
it is a matrix-free conjugate gradient on the damped normal equations — so
memory stays proportional to the number of non-zeros rather than to n².

`solve()` also takes `extra?: ResidualBlock[]` — residuals that take part in
that one solve and are stored nowhere. The distinction they draw is between a
*constraint*, which is a claim about the drawing, and an *intention*, which is
a claim about the hand: "this point wants to be under the cursor" is true for
one frame and false by the next, and putting it in `blocks` would make the
model briefly contain something it does not mean. Extras are kept out of the
offender report and out of `maxResidual`, because a deliberately weak residual
never reaches zero and a report that counted it would call every drag a
conflict. This stays geometry-free: `problem.ts` has still never heard of a
point, and the blocks are built a layer up, in the engine.

**Why split it that way?** The expensive inner loop is the linear solve, and
that is the part worth having in WASM. The outer loop is bookkeeping —
damping, step acceptance, convergence — which is easier to read, change and
debug in TypeScript and is not where the time goes.

## Diagnosis: the kernel says the rank, the model says the names

What is still free, and which relations disagree, are questions about the
Jacobian — so they are answered at the layer that has one, and translated
into names at the layer that has names. The layer rule is the shape of it.

**kernel-rs** gains one linear-algebra function, `null_support`: the rank of
a sparse m × n matrix and, per column, whether it is in the support of the
null space. It splits the matrix into connected components and eliminates
each densely, columns in order, rank relative to each column's own norm. It
knows variables and rows, nothing else.

**`Problem.analyse`** asks it twice. Of J, with extra **gauge rows** the
caller supplies (plain linear rows over variable indices), it gives the free
variables and the count of independent motions. Of Jᵀ, over the stored rows
only, it gives the rows each implied by the rows before it — so "redundant"
means the later of two ways of saying one thing — and, asked with
`agreeing`, for each block every row of which is implied, the blocks it is
implied *by*: each block in the left null space's support tried once more
with its rows left out, and kept when the implied block is then implied no
longer (where no single one is needed, a row said three times, the whole
support). Bounded by trials and milliseconds, like the conflict search;
past the bound the support stands. `SolveReport.blocks` names
the blocks whose residual stayed large after a failed solve; at a
least-squares minimum the residual lies in Jᵀ's null space, so those are
rows in a dependency. All of it is handles and indices: `problem.ts` still
has never heard of a point.

**`Model.diagnose`** owns the meaning. It says which variables are live (a
deleted entity's are tombstoned and would otherwise count), which directions
are gauges rather than freedoms (a curve's normal length; a point lying on
the drawing plane or the ground, off it), maps free variables back to the
entities that own or refer to them, and maps blocks back to the relations
whose `model.relation` collected them (`Model.conflicting`). A relation is
redundant only when every one of its rows is implied **and it holds**
(`Problem.unmet`): implied is a statement about gradients, and a `par` and a
`perp` on one pair of lines are both the angle between them — one row to
first order, and a conflict, not an agreement. What is *said* of
it is not its name but its **agreeing set** (`Diagnosis.agreeing`; the
owner's principle, TODO.md's register: *agreeing over-constraint is
normal*): the relations it says one thing with, by the kernel's answer
above, kept to the ones a person made, sets merged where they share a
member. A rectangle's four right angles are one set of four, none of them
"the redundant one" — which is stored last is an accident of order, not a
property of the drawing. The status counts the set (`0 free · 4 agreeing`),
muted, and names none; the constraints palette lists it
(docs/plans/constraints-palette.md). `redundant` itself is kept, unsaid,
for the dimension tool's "already held".

**main.ts** asks once per solve that the user caused — a commit, an entry,
an undo, the end of a drag — never per drag frame, which draws with the last
answer. It is a few milliseconds where a drag frame's solve is ten.

One consequence worth knowing: the analysis is first order, so a residual
whose gradient vanishes at its own root reads as holding nothing. That is
the old rule against squared residuals, seen from the other side — and it is
why `tan` at a shared end needed a join form: the distance form there was a
double root, and the joint read as free (docs/plans/sketch-relations.md).

### A conflict is a conflict even when a collapse satisfies it

The owner: *"I'm able to add a parallel relation to a set of perpendicular
relation lines. This is a bug."* A line of zero length is parallel and
perpendicular to everything, so least squares meets a `par` across a
rectangle's `perp`s by folding a side, to 1e-12, and the verdict said SOLVED.
Nothing about the residuals is wrong; the solution is. So what a solution is
gets decided where what a line *is* is known: `Model.solve`, not the kernel
(docs/plans/conflict-detection.md).

- **Measures.** Every entity has non-degeneracy measures, as functions of its
  variables: a line's length, a radius, a frame's axes, and whatever a
  declared kind says through `EntityKindSpec.measures` (an ellipse's axes, a
  spline's spacing). A **collapse** is a measure above ε·L before a solve and
  below it after, L being the drawing's size, ε = 1e-6.
- **Telling a collapse from a small size.** One a residual meets quadratically
  (a triangle's second right angle) stalls at ~4e-5·L, where the damped step
  stops seeing it. So a measure that fell past 1e-2·L is a suspect, and is
  pushed toward zero and released: a collapse stays at zero, and a size a
  relation set comes back. After that, every collapse in the unit suite ends at
  ≤ 4.6e-10·L and the smallest real size left after halving is 2e-4·L.
- **The solver is local.** From a rectangle it will fold a side to meet a set
  that a turned side meets just as well. A collapse is retried **steered**
  (every size pulled toward what it was, then released) before it is believed.
- **The user's own zero** — `dist(p, q, 0)`, a `coin` of a line's ends — is no
  collapse. The test is that one relation alone, tried from the state before,
  collapses it too.
- **What a collapse does.** The solve fails, `collapsed` names what would have
  folded, and the connected component that folded (`Problem.connected`) is put
  back as it was. Other components keep their answer, since they share no
  variable. The relation stays, as Onshape keeps a conflicting constraint.
  Redundancy is never said of a relation reading a folded entity.
- **A solve that fails outright is put back the same way** (since the
  direction rows were normalised, below). Most of what used to fold now has
  no answer at all, and least squares ends at the compromise — a rectangle
  sheared 45° between a `par` and a `perp`. That is neither what the user
  drew nor anything a relation describes, so the component a row stayed
  large in goes back to where it was, after being solved on once from where
  it stopped: sixty iterations is a bound, not a verdict.
- **Naming it minimally.** `Model.conflicting` names an irreducible set, for a
  collapse and a failed solve alike. It runs QuickXplain over the deletable
  relations of the failed component, each question a trial solve of that
  component alone from the state before (`Problem.solve({ only })`).
  Candidates nearest what failed go first: relations naming the folded entity,
  then by `Problem.reach`. The first ring of them that conflicts by itself is
  the one searched. A feature's own relations (an extrude's depth) are never
  named. The search is bounded by trials and milliseconds, and past the bound
  the component is named as before, by its large rows.
- **A drag frame** that would fold something stops where the last frame was,
  for the component that would fold. And the component the last solve put
  back is **left out of the frame** — its blocks, and any pull on a point of
  it (`Model.stuck`) — so a drawing that holds a conflict does not move in
  that part until the conflict is deleted. (It used to stand still because
  every frame folded a side; with rows that cannot be met by folding, a frame
  would end at the sheared compromise instead.)
- **Two more ways to know a collapse**, both from the rows being stiff near a
  side of no length: a suspect the release after the push did not settle
  (`UNSETTLED`), and one that was pushed down and stayed under half its size
  (`SANK`). A size a relation set is one the release converges at, back
  where the solve had it.

The kernel learned only geometry-free things for this: `solve({ only })`,
`snapshot`/`restore`, `varsOf`, `connected` and `reach` — and, for what
follows, `solve({ stall })`, `unmet` and `handles`. It still has never heard
of a point.

### A direction relation turns a line and never scales it

The collapse above was a symptom. `par`, `perp`, `ang` and every row of
their shape were products of raw `b − a` — |u||v|·sin θ, |u||v|·cos θ — so a
shorter line was a smaller residual and the solve paid for a direction
partly in length: `par` typed between two free lines 60 long left them 8.8
and 1.2 long, SOLVED (docs/images/422; docs/plans/review-solver.md has every
measurement). Four things make a direction row turn a line and nothing else,
and each was arrived at by measuring the simpler thing first.

- **Unit directions.** A row reads a line's direction through `unit` (vec.ts):
  `b − a` over its own length, the derivative the chain rule written once,
  (I − ûûᵀ)/|u|. The row's gradient along the line is then exactly zero, and
  no change of length can lower it. `on`, `sym` and `col`'s position row read
  û and are plain distances off an infinite line.
- **An angle, not a sine.** A sine is flat where it is largest: two lines
  exactly square have no way to turn that lowers it. The raw row hid that
  because at 90° its whole gradient ran along the lines — the only way down
  was shorter, which is how a rectangle's side folded. So the row is the
  turn itself: the wedge scaled so its length is the angle between the two
  as undirected lines (`turnToParallel`), that angle less a right angle
  (`turnToSquare`), or less the one asked for (`ang`). The slope is the same
  at every angle. Exactly along one line the wedge's length has no
  derivative; `angleBetween` picks a way to turn from the values.
- **Times a length that is no variable.** The kernel's tolerances are
  lengths, so a bare angle of 1e-10 would leave the end of a 40-long edge
  4e-9 off. Each row is multiplied by the longer of its own lines **as it
  was when the solve began** (`Model.valueBefore`, read from the snapshot
  `solve` already takes): a plain number, so the Jacobian stays exact, and
  the row is a length — how far the far end of the longer line is off. For
  a line against an axis that is the size the raw row had. For two lines it
  is smaller by the shorter line's length, and that is deliberate and has a
  consequence: **a sketch is no longer stiffer than what is built on it.**
  The raw rows made a 18 × 30 profile's right angles some twenty times
  stiffer than a revolve's rows, so a solve that had far to go moved the
  feature and hardly the sketch, by accident of scale. Giving the rows that
  scale back was measured (the product of both lengths as the solve began):
  the sketch anchors again, and `perp` between two free lines leaves them 74
  and 64 long and a drag costs 47% — the stiffness is what made the rows pay
  in length. So who gives way is said where it is known instead: an edit of
  a feature's dimension seats the feature before the solve (`reseatLid` for
  a depth, `seatTurned` for an angle), and the solve begins at a root.
  Under a thousandth of the drawing's size
  a line has no direction to turn by and its rows run down to nothing with
  it, as the raw rows did — which is where a collapse is still found.
- **And the solve keeps the length too.** Zero gradient is not enough: the
  kernel's step moves each end along a straight line, damped per
  coordinate, and a straight move that turns a line stretches it. With the
  rows above and nothing else, `perp` between those two lines left them 169
  long. `model.ts` holds no equations, but it knows what a line is, so the
  fix is there: a block says which entities it reads for their direction
  only (`addResidual`'s `turns`), and after a solve that changed the length
  of any of them `Model.keptSizes` solves on with those lengths pulled back
  to what they were and then released. What a relation really changes — a
  side a dimension was just put on — is changed by the release; the rest
  comes back to 1e-10 of itself. A drag's frame is not steered (a pull on a
  size there would move a free rectangle whole under a dragged corner), so a
  drag still costs a turned line a little: 3% where it cost 47%.

The residual's form is not journalled, so no file changed: a unit-direction
row has the roots the raw one had, less the collapsed one, and every fixture
reopens to the shape it was saved as.

**A new row that reads a line for its direction** is written the same way or
it brings the bug back: `corner`, the angle between the lines two walls are
swept from, arrived as u·w − |u||w| cos θ and left two free lines 69 and 89
long. The form is `unit` of each line, the angle between them
(`angleBetween`, `turnToParallel`, `turnToSquare`), times `rowLength` of
`lengthBefore`, `fadeUnder` the floor, and the lines named as `turns`; and
`test/directionrows.test.ts`'s `checkRows` asks of any row that its gradient
along its lines is zero. A relation among many needs nothing: its rows are
the pair's.

### A conflict names the relation that made it

A minimal set is true and unhelpful: `r1 · r5 cannot all hold` leaves the
reader to work out which of them they just did. The drawing solved before
the edit that broke it, so the edit is the culprit, and that is **known, not
searched for**: `Model` remembers each relation as it stood the last time a
solve solved its part of the drawing (`settled`), and the one relation of a
failed part that has not held — just added, or its value just `set` — is it.
The search (`Model.conflicting`) is then only for what it cannot hold with:
the culprit is in every trial, QuickXplain asks about the rest nearest
first, and one relation is tried alone before any larger set — the nearest
dozen of all of them, whichever ring first clashed. Past the search's bound
the culprit is still named and its set is not.

The culprit is a relation, never a row block: one relation among many
(`par("l1", "l2", "l3")`, relations/among.ts) owns a block for each member
with the first and is named once, with every member. And "has held" is of
the relation as it stands — the same call, the same arguments — so one a
line has just joined has not, and is what made the conflict the join makes.

None is singled out where none can be: a file opened in conflict (nothing in
it has held here), or an edit of more than one relation. An undo and a redo
each open a new model from a snapshot, and hand on what had held
(`inheritHeld`), so a redone `par` is named as it was the first time.

It is said three ways, and each tells the culprit from its set by more than
a hue — on a phone a glyph is a dozen pixels, and two reds there are one:
the status reads `r7 par l1 l2 — against r1, r2` with the culprit on a pill
of the conflict's ink; the culprit's glyph is its box filled with that ink,
what it is against outlined in a quieter one; and the constraints palette
lists the conflict first, whatever is selected, the culprit first, a delete
on each. A relation in a conflict is always drawn, quiet anchor or not.

A feature's own relations are still background to the search — in every
trial, in no answer — because they cannot be deleted alone. When features
relate rather than own, that changes; `test/culprit.test.ts` has a test
written to fail then.

## Structure and equations are separate

`model.ts` holds structure: names, references between entities, and which
`Problem` variables each entity owns. It holds no equations at all.

`relations/` holds equations. A relation adds one residual block and changes
nothing else.

Both halves are **named**. Entities always were; relations are, now, because
a constraint you cannot refer to is a constraint you cannot inspect or
remove — survivable while every constraint is one you typed, and not
survivable once a tool infers them on your behalf. `Model` keeps a relation
registry beside its entity map, filled by one wrapper (`model.relation`) that
every function in `relations/` is written as a single call to: it journals the
call, gathers the residual-block handles the body adds, and registers them
under a name. Entities and relations share the namespace, because
`del("r3")` has to mean one thing.

**Which name depends on whether the relation is a dimension.** `dist`, `rad`
and `ang` are `d1`, `d2`, … — and so are an extrude's depth, the `extrusion`
that holds its lid, and a revolve's angle, the `revolution` that holds its end
face; everything else is `r1`, `r2`, …. The split is
Onshape's — a dimension is a number you put on the drawing, a constraint is a
statement about shape — and it belongs here rather than merely in the UI because
the name is what you *do* things to: a `d` is something to go back and edit
(`set("d4.value", 60)`), an `r` is something to add or delete. `fix` is not a
dimension: it carries coordinates rather than one value.

The prefix is read from the op inside `model.relation` rather than passed in by
each relation. An argument that every relation must remember is an argument one
of them will eventually forget, and the failure would be silent — this
codebase's characteristic bug. The rollback on a throwing relation restores
whichever counter the claim moved, because putting `"r"` back after claiming
`"d"` leaves the `d` counter advanced, and a name shifted by a relation that
failed is a name a replay will not reproduce.

**Editing a dimension is an operation, not another relation.** `set` replaces an
equation rather than adding one, so it sits in `operations.ts` with the rest of
the structure-adjacent work. `Model.rebuildRelation` re-runs the dimension in
place under the same name — same registry position, `args` updated — so
`rels()`, the glyph's label and `del`'s reference scan all tell the truth
afterwards without being told anything. It builds the new blocks *before*
removing the old ones, which is the only ordering under which a body that throws
leaves the relation as it was: the other way round deletes a working constraint
and then fails, with the closures gone and nothing to put back.

A relation defined in terms of another — `concentric` via `coincident`,
`arcEndpoints` via two `onCircle`s — is **one** relation: the inner call's
blocks join the outer entry and it journals nothing. Two entries claiming the
same blocks could not both be right, since deleting either would leave the
other holding handles the kernel has forgotten.

This is why a `Line` owns no variables — it is two point references and
nothing more — and why an `Arc` does not automatically constrain its own
endpoints to lie on its own circle. That is the `arcends` relation's job. The
alternative (constructors that quietly add equations) makes it impossible to
tell, reading a model, where its constraints came from.

The split also gives a clean rule for reviewing: **a relation can only ever
over- or under-constrain; an operation can leave the model malformed.** Hence
`operations.ts` being its own file rather than another function in
`relations/`. `fillet` creates entities and re-points a line, so it is an
operation. Everything in `relations/` is not.

**A feature is a third registry, and it holds neither structure nor
equations.** `extrude` expands a loop into ordinary entities — twin points and
members, wall lines (and, in an old file, a lid frame) — held by one ordinary relation, the
`extrusion` dimension. What none of that can say is *these pieces are one
solid*, and that is the whole of a feature record (`e1`, in `model.features`,
sharing the namespace so `del("e1")` means one thing): which profile it was
built on, what it made, which relation is its depth. It is rebuilt by replaying
the operation, never saved, and the faces a solid is drawn with are read off
the live geometry each frame and stored nowhere. That is the one-model decision
carried into solids: a lid is geometry a sketch can be constrained against, and
`set` on its depth re-solves it like any dimension, because it is one.

**A profile member is a whole entity or a portion of one between two real
points** (`Portion` in `model.ts`) — the region a crossing or a T cut out.
The portion's ends are points by the time anything is twinned (crossings
materialised, see the loops paragraph above), and it is drawn between those
points as they are each frame, never over the `span` loops.ts found at hover
time: a span is a snapshot, and a cap drawn over one would stay behind when
the line that cut the region was dragged. The journal entry names the points
the expansion itself made — known only after its body ran, so `asOperation`
may take its arguments as a function — and a replay meeting a vertex the model
has no point by makes it under that name: the same "not a point means a
crossing" test loops.ts reads a vertex by.

**A revolve keeps real only what can be real.** No finite set of entities is a
surface of revolution, so a revolve makes no walls: its record names the profile
and the axis (a frame axis or a line, read as a datum like every frame — the
`revolution` holding it never declares the axis as variables, so nothing a revolve
holds can turn it), and one `revolution` dimension carries the angle. A partial
turn also has an end face — twins of the profile turned through the angle,
closed-form, three linear residuals per point — so `set` swings it and a sketch
can be constrained against it, as against a lid. A whole turn has no end face and
makes nothing but the dimension, which then holds no blocks; turning it partial
would mean growing geometry inside a dimension edit, so `set` refuses across that
line and a new revolve is the way.

**A feature's expansion is a function of its profile, and follows it.** An
operation that restructures a profile — `fillet` today, re-pointing leg two and
adding an arc — ends, inside its own `asOperation`, by *regenerating* every
feature on what it touched: the profile is found again as the call found it,
and the old expansion is **diffed** against it rather than thrown away. A joined
class of vertices that survives keeps its twin and wall; a line whose end moved
keeps its twin, re-pointed; what is new is made as the expansion makes it; what
has gone goes by the ordinary deletion cascade, last, once the record no longer
names it. The dimension is rebuilt in place (`set`'s path) and the record
rewritten in place (`rewriteFeature`), so names survive wherever identity does —
which is what lets a relation a user put on a lid outlive a fillet on the base.
The alternative, deleting the feature and extruding again, is simpler and
would rename every twin, taking every relation on them with it. Only
structural change regenerates: a solve, a drag or a `set` moves geometry, and
faces are drawn from live geometry already. `regen("e1")` is the same machinery
for a profile restructured by hand. The finding reads positions, so — exactly
as `extrude` — the call journals what it found, resolved, and a replay is
handed it.

**The sketch edits are operations, held by relations** (`src/sketchedit.ts`,
docs/plans/sketch-edit.md): trim, extend, offset, mirror, chamfer and the two
patterns each create or re-point entities, so each is journalled as its call
with what it read off positions resolved beside it, and what it makes is held
by ordinary relations to what it was made from — a trimmed end `on` the curve
that cut it, an offset `par` and `dist`, a mirror `sym`, a pattern the step
its first copy takes (`translated`, `rotated`, `rotation`, relations/
pattern.ts). **A trim tries, and takes itself back.** Whether a feature on the
trimmed curve can still find its profile is a question about the drawing
*after* the change, and an operation must refuse before it changes anything;
so trim makes its structural change, asks (`regenerationRefusal`), and on a
refusal undoes each step by its inverse and puts the auto-name counters back
(`Model.nameCounters`), so a refused trim leaves the model, its journal and
every later auto-name exactly as they were. What a trim tidies afterwards —
holds on the piece that went, the end it stranded — is journalled as `del`
journals it, after the trim's own entry, in the same typed call.

## Deleting cascades inward, and undo is the confirmation

`del(name)` removes an entity or a relation and takes with it whatever could
not survive without it. The cascade is Onshape's: a relation takes nothing
else, a point takes everything that references it (recursively) plus every
relation naming any of them, and a line, circle or arc takes the relations
naming it while leaving its points alone. The rule underneath is that the
closure follows references **inward** — who needs me — and never outward —
what do I need. That asymmetry is the whole of it: deleting a line reaches
nothing, deleting one of its endpoints reaches the line. A 3D circle or arc
needs the frame whose plane it lies in, so deleting a frame reaches the curves
drawn on it (`Model.dependents` counts the plane, and the primitive refuses to
orphan one) — while its points, as ever, stay.

**A feature relates, it does not own** (docs/plans/linked-profiles.md; the
section below, "No hierarchy"). Until 2026-11-12 a feature's record read the
inward rule from both sides — deleting anything it named took the record,
and deleting the feature took what it *made* (the record's `owns`), Onshape's
rule. The owner: *"i don't like the idea of anything being 'consumed' as this
implies unidirectional hierarchy"*. So now:

- **`del("e1")` takes the record and the relation that is the feature** — an
  extrude's `extrusion`, a revolve's `revolution`, a fillet's or a surface's
  size — with the relations that read the record (`e1_perp`), and **no
  entity**. The lid, the walls, a revolve's end face, an edge extrude's
  copies stay as plain geometry, as deleting a `sym` leaves both halves.
- **An entity of an extrude's profile deleted takes its partner on the other
  profile** (`linkedClosure`) and **the record stays, open** (`unsweep`,
  journalled ahead of the deletions, as a hole's filling is). Only where it
  cannot stand — its sketch frame going, its last pair — does the record go,
  and then alone, leaving its dimension, as it always did.
- **A relation a record names is deleted like any other.** The primitive
  used to refuse an extrude's depth; now the record stops naming it and says
  why it builds nothing (`unbuilt`).
- **A relation naming a face goes only where the face's geometry is gone**:
  a point's `onplane(p, "e1.lid")` is re-held, by name, as `coplanar` over
  three of the lid's own points (`rehold`); a round wall has no three points
  that are its surface and `fdist` no relation that says the same between
  entities, so those go with the record.

The primitives still refuse to delete an *entity* a record names, so a
record can never point at nothing.

**There is no confirmation prompt, because undo is the confirmation.** `del`
is one user action, so a cascade that took more than was meant is one Ctrl+Z
from harmless — the pattern `open()` already set. It returns the names it
removed so the log can answer "what did that just take with it".

Deletion is journalled as its **expansion** — one `deleteEntity` or
`deleteRelation` per name — rather than as the `del` call, which is the
opposite of how an operation like `fillet` is journalled and for a good
reason: a `fillet` re-expands identically on replay, while a cascade is
computed against the model as it stood, and recomputing it later could remove
a different set. `Model`'s two primitives refuse to leave the model malformed
(they will not delete something still referenced or still constrained), so a
hand-edited file gets a reason rather than a line with no endpoint.

**Variables are tombstoned, not compacted.** A deleted point's variables stay
in the flat vector, referenced by nothing. The damped solve leaves orphans
exactly where they are, so they cost memory and not correctness. Compaction
means remapping every captured index list inside every closure — real work
with real risk — and a save/reopen does not shed the leak either, because
replay re-runs the same creates and the same deletes. Both facts are pinned by
tests rather than left to be rediscovered.

## A group is a set, and the model stays flat

The owner's statement of the concept: *"flat relational direct cad. there is
no hierarchy. a sketch entity exists in the same logical space as a solid
entity. and entities can be grouped."* Nothing owns a sketch or a solid — a
feature's twins and walls are ordinary entities beside the sketch — so a group
could not be a container without undoing that. It is a **set**
(`GroupEntry` in `model.ts`): a name and a list of entity and relation names.

- **It owns nothing.** `ungroup(g)` (and `del(g)`) removes the grouping and no
  member; deleting a member takes it out of every group, and a group left empty
  goes too. The second half is done *in the primitives* (`deleteEntity`,
  `deleteRelation`), for the default frame's reason: a regeneration that
  deletes a twin, or a hand-edited file's `deleteEntity`, must not leave a
  group naming nothing. Each group a name leaves is journalled as a
  `removeFrom` just before the primitive, so a deletion's expansion still says
  everything it did.
- **It never nests.** A group or a feature named where members are wanted is
  flattened to its members *then* (`Model.expand`) — a union, not a link, and
  the log says so. A link would be a tree; the journal records the members
  resolved, so a file says what the union was.
- **A feature is a read-only group.** `membersOf("e1")` is the feature's
  `owns` — what it made — so a feature selects, hides and lists as a group
  does, and refuses `addTo`/`removeFrom`/`ungroup`, since its members follow
  its profile.

The registry is **structure**, so it lives in the model, and every edit is an
**operation** (`groups.ts`, `asOperation`), replayed by `persist.ts`'s table;
nothing below the model learns of it, and the solver never does.

**Visibility is the document's** (`Model.hidden`), as in every CAD tool:
`hide` and `show` are journalled, saved and undone. A hidden entity is not
drawn, picked, snapped to or boxed — each of those asks `model.hidden`, the
same one question, so the eye and the hand cannot disagree — and it is still
solved, because nothing below the drawing reads it. A hidden feature's faces
are not drawn (and so hide nothing behind them); a constraint's mark on
something hidden is not drawn either, except a feature's own dimension, which
is the solid's.

**Construction geometry is a flag on the entity** (`construction?: true` on a
line, arc or circle; `Model.isConstruction`), never a set and never a group's:
the owner ruled out geometry that is "both construction geometry and not
construction geometry simultaneously". Only one question reads it — which
regions there are — and `loops.ts` answers it by leaving construction edges
out where edges come in, so every consumer of regions follows. Everything else
(solve, pick, snap, quiet) treats it as any entity; the drawing gives it a thin
muted ink. Setting it is an operation (`construction` in `operations.ts`),
journalled with the curves it changed, so a group named is resolved at the call.

**The selection is the viewer's** — `Selection` in `tools/selection.ts`, held
by the engine, never journalled, never in a file, never an undo step. It is
needed because a set wants to be picked in one gesture, and it is told apart
from cellwork's click-to-name by **the command line's text**: with text in it a
click is an argument to the call being written and inserts the name, as it
always did; with none a click selects. Region preselection is the same
selection, for regions. The menu and the Delete key act on it by typing, like
every menu item.

## Relations follow their entities, not their indices

`addResidual` takes either a list of variable indices or a **thunk**
re-consulted at every evaluation.

The thunk form exists because the thing a relation is *about* can be
restructured underneath it. `par("l1", "f.x")` means "this edge is level" — if
a fillet later re-points that edge at a new tangent point, the constraint has
to follow. A captured index list cannot; a thunk that reads the line's current
refs can.

This was learned the hard way: the fillet's first version passed every
numerical check to six decimal places while visibly wrecking the rectangle it
was applied to, because the rectangle's edge constraints stayed behind on the
old corners.

`par` and `perp` therefore take **either** two point names or one line name
for their first side, and the two are not interchangeable once a model starts
changing shape:

| form | means | survives re-pointing? |
|---|---|---|
| `par("a", "b", "f.x")` | these two points share a y | no — it keeps constraining those points |
| `par("l1", "f.x")` | this edge is level | yes — it re-reads the line each solve |

Prefer the line form for anything that is a property of an edge. The built-in
tools use it.

## A relation among many is one relation, and nobody in it is first

The owner's principle, the one later work is checked against: *"correct
relationships BETWEEN entities … bidirectional relationships everywhere by
default"* — a relation between entities, never an owner; nothing privileged,
nothing consumed. Four lines picked and Parallel pressed used to make
`par(l1, l2)`, `par(l1, l3)`, `par(l1, l4)`: a star on the first pick, which
wore three marks and, deleted, left the other three related by nothing. It is
one relation now, `par("l1", "l2", "l3", "l4")` (docs/plans/review-relations.md).

- **Which relations.** The ones that are the same statement of any two
  members, so that a set is well defined whatever order it was built in:
  `par`, `eq` (lines among lines, circles and arcs among themselves), `col`,
  `coin`, `conc`, `corad`, `eqrad`, and points level or upright with each
  other (`par("p1", "p2", "p3", "origin.x")` — the points the members, the
  direction what they are relative to). Not `perp`, `tan`, `sym` or `mid`: a
  tangent chain says a different thing of each neighbouring pair. And not a
  relation to a datum — `par("l1", "origin.x")`, `par("c1", "e1:l2")` — where
  each line is level on its own account and the datum is a member of nothing.
- **Equations are still one layer's.** `src/relations/among.ts` holds no row:
  the entry is one `model.relation` whose body calls the pair relation's own
  function n − 1 times, each call absorbed into the entry being built (the
  rule that makes `concentric` one relation and not two). So a conflict
  names it once, `del` takes it whole, and whatever is done to a pair's rows
  is done to these. Which n − 1 pairs is the solver's business — each member
  with the one listed first, the equations the star had, chosen by
  measurement (three lines collinear in 3D solve by it and fold a line to a
  point by a chain) — and is in no name, mark or journal entry: the entry
  holds members.
- **Who is in it is structure, so changing that is an operation**
  (`src/among.ts`, beside `groups.ts`): `join` and `leave` rebuild the
  relation in place over its new members, under its name — `rebuildRelation`,
  what `set` is built on, new rows before old — and are journalled as
  themselves. **A deletion's cascade asks first** (`shrinkFor`): a relation
  whose members are only some of what is going loses them and stays, a
  `leave` written ahead of the `deleteEntity`s, down to two; with one left
  it goes, as any relation naming a deleted entity does. That is the one
  change to "deleting cascades inward": inward still, but a set that
  survives the loss of a member is not a thing that needed that member.
- **Typed, a relation joins; replayed, it never does.** `relate` — what the
  command line, a palette row and the constrain list run — adds the names to
  a relation of the kind one of them is already in, and merges the relations
  the names bridge, pairs included; the journal says `join`. A file's
  `parallel ["l1", "l2"]` is that pair whatever else names `l1`, which is
  what lets a file from before this reopen as the separate relations it had
  and re-save the same. The alternative, joining on replay, would have merged
  an old star the second time its file was opened.

## One fixed origin, and every other frame is a datum

The kernel keeps a flat vector of numbers and those numbers have to live
somewhere. That substrate was a **gauge, not a frame**, and for a long time
nothing in the user-facing vocabulary could reference it: a document started
with no frame, `fix` refused without one, and a tool that needed a plane made
a frame of its own. The owner asked twice why drawing a circle made a frame
(docs/plans/frameless-curves.md), and the answer is now **one origin**: a
built-in frame called `origin` — the kernel's own axes, drawn in RGB like any
frame, referable wherever a frame is (`"origin.x"`, `onplane(p, "origin")`),
**never solved, never deleted, never journalled**. It is part of every model
that can hold a frame, as the kernel's axes are, so a new document and an old
file agree about it without a replay step. It is not an entity: a fresh
document is still empty, `Model.has("origin")` answers so nothing can be made
under its name, and `frameBasis` hands back a constant basis for it.

What survives of the old decision is the part that mattered: **nothing else
makes a frame unless asked.** `fix`, `onplane` and `xaxis()` mean the default
frame when there is one, else the origin. `fix` is still a position *in a
frame's coordinates*. Everything else in the vocabulary (`dist`, `par`, `perp`,
`ang`, `tan`, `on`, …) is intrinsic: a claim about geometry relative to other
geometry. A drawing nothing anchors still floats: the damped solve leaves
unconstrained directions where they were seeded.

**There is no `hor`/`ver` either, and that is the same decision one step
further.** Those words name a privileged pair of directions whether or not a
frame is behind them. What they meant is written against a frame's axis
instead: `par`, `perp` and `ang` take a **frame-axis reference** — the string
`"f1.x"` or `"f1.y"`, and in 3D `"f1.z"` — anywhere they take a line, and
`xaxis()`/`yaxis()`/`zaxis()` fill in the default. The rule for which relations may take one falls out of what an
axis *is*: a direction with no length and no position, so exactly the
relations that read an argument for its direction alone. `eq` has no length to
compare against; `on`, `sym` and `tan` each need a located line, and reading
`"f1.x"` as a line through the origin would give one syntax two meanings.

A dot is refused in every entity name, at `claimName`, so a reference can
never collide with one — and `relationsNaming` reads `f1.x` as naming `f1`, or
a frame could be deleted out from under a relation still reading it.

**A relation reads a frame; it never pushes one.** This is the exception to
the rule above it, and it is deliberate. A residual block declares the
variables it reads, and declaring a frame's two points would put them in the
Jacobian — at which point the solver can satisfy "this line is parallel to
your +x" by turning the *frame*, which it does: measured at about 8° of a 9° error for a
40-unit line against a 20-unit frame arm, plus a 14% shortening of the arm if
the residual is not normalised, because a shorter arm makes a wedge smaller.
Both readings satisfy the equation; only one of them is what a datum means.

So `frameBasis` (`relations/refs.ts`) re-reads a frame's origin and unit axes
at every evaluation and hands them to the residual as *values* — as
`Dual.constant`s, whose gradients are empty, so the frame is outside the
Jacobian by construction rather than by anyone remembering to leave it out. The house rule
about laziness is kept — a frame whose points are re-targeted is still
followed, and moving a frame moves the drawing hanging off it within the same
solve — while the frame itself moves only when something moves it. The
Jacobian stays exact for the block as declared rather than for every number
the residual touches, which costs nothing while the frame is still and behaves
like one Gauss-Seidel sweep while it is not.

The default frame is a model-level pointer resolved **at call time** and
journalled resolved, so a saved entry cannot change meaning because the
default changed afterwards — the same instinct that makes a deletion journal
its expansion rather than the cascade.

**In 3D a frame is a plane, and the gauge is gone there too.** An origin and
one direction settle a 2D frame and leave a rotation free in 3D, which is why
`fix` above 2D used to pin the kernel's own coordinates — the one place the
gauge stayed visible. A 3D frame carries a third point, a y-ref, and
`frameBasis` reads it the same read-never-pushed way: +y is the y-ref's
direction **straightened against +x** (Gram–Schmidt) and +z is +x × +y. So the
y-ref fixes the plane and which side of +x is +y, not the exact angle, and the
axes handed to a residual are orthonormal by construction — `fix(p, [x, y, z])`
means distances along them, and `onPlane(p)` is the signed distance off the
plane, `(p − origin) · +z`. A drawing on a sketch plane is then just geometry
held in a frame's plane; there is no second model type and no sketch mode,
which is the owner's one-model decision. Frames exist in 2D and 3D models only,
and so does `fix`.

## In 3D a pixel is a ray

The app runs a `Model(3)`. That changed almost nothing below `view.ts` — the
kernel and the relations were dimension-generic already — and almost
everything that turns a pixel into a place.

**The camera is orthographic, and starts as the 2D transform.** A `View` is the
old `{ox, oy, scale}` plus, once something turns it, the screen's own right and
up axes in world terms and an orbit target. With no orientation it is the top
view, evaluated term for term as the 2D formula, which is what let the whole
2D suite stand unmodified while the app underneath it became 3D. The
orientation is stored as axes rather than as an azimuth and elevation because
`lookAt` must put a *tilted* frame square-on with its +x right, which needs a
roll two angles cannot hold — and because an orbit about the kernel's z would
make the gauge's z the drawing's "up", the world frame coming back in through
the camera. So an orbit is a trackball about the screen's own axes, about a
target that panning and zooming keep on its pixel. Perspective is deliberately
absent: a sketcher draws in parallel projection, and a pick radius in pixels
means the same thing at every depth only under one.

**A click needs a surface, and it is the working plane** (`workplane.ts`): the
plane you chose to sketch on — the **work plane** (`workplane(ref)`, which
sketch on face sets to three of the face's own points, journalled document
state and no entity), else the default frame's — else the origin's ground
plane, else the plane facing the viewer through the orbit target when the
ground is seen edge-on. The engine reads every pointer event there and
reports which plane it was (`PointerInfo.plane`), and a drag moves what it
grabbed parallel to the plane its press landed on, fixed for the gesture.
`placePoint` holds a point it places on a plane you *chose* with `onPlane` —
only where a snap has not already pinned it, and only when it is actually on
the plane; the ground holds nothing, so a rectangle drawn in a fresh document
is as free as it always was.

**With no plane chosen, a click on a solid's face lands on the face**
(docs/plans/click-on-face.md; the owner: *"if i am hovering over a face
without an active on-plane constraint, it should constrain to the plane i am
hovering over"*). The engine asks, for every pointer event of a tool that
places points, which face is drawn under the pixel — solidpick.ts's
`faceUnder`, the dimension tool's own question, asked of the faces the frame
drew — and reads the event on that face's plane, facing the viewer, naming
the face to the tool (`PointerInfo.face`, `e1.m3`). **Each click decides its
own face**: a three-point circle may have a point on each of three faces; a
shape dragged out — a rectangle, a slot, a circle's radius — is laid out on
the face its first press landed on (`CurvePlane` in `tools/place.ts`, whose
`settle` reads a later click back onto the gesture's plane and whose
`settleOwn` keeps a click that is a point of its own). A point placed on a
flat face is held there by `onplane(p, "e1.m3")`, and a curve drawn wholly on
one face has its normal `par` to it besides — the face is a relation now,
where before it was only where the first click happened to land. The snap is
restricted to the face while one is under the hand: its edges and vertices
and what lies in it, never a ground entity behind it, a snap to the face's
own edge still winning over the face. Before the click the face is lit (as
the dimension tool lights one) and named beside the hand with the mark the
relation will wear, `▱ e1.m3`, and the chip says `on e1.m3` — said, not
offered: no plane's menu, no Done, because nothing was chosen. A round face
(a cylinder's wall) places the point and holds nothing, and the log says so.
With a sketch plane chosen none of this is asked: every click lands on that
plane, whatever is under it (Onshape's rule). It used to be the curve tools'
question alone, answered at the gesture's first click by the loop under the
pixel, and skipped whenever the press had snapped — bug 72.

**Picking, snapping and box select stay in screen space**; what changed is what
each entity looks like there and which world point a pixel on it *is*
(`projection.ts`). In 2D the inverse was one formula; in 3D a pixel names a
ray, and only the entity under it knows how deep it is. So a snap's world
position is read off what it snapped to — a vertex's own coordinates, the
midpoint of an edge's ends, a point of a curve lifted by its parameter — and a
screen crossing of two curves is a crossing only where both curves' readings
are one place in space. While sketching on a plane, a snap is offered as
itself only where it lands *on* that plane: seen square-on, a sketch has whole
stacks of geometry behind it sharing its pixels, and a vertex seen through the
sketch is not a place on it. **A point off the sketch is offered at its
projection instead** — the foot of the perpendicular onto the plane, Onshape's
"project into the sketch" — as a position aid that infers nothing: the new
point is not at the one it borrowed from, so a coincidence would be a lie, and
"under that point along the plane's normal" is a relation this model does not
have. It ranks below every place really on the sketch and above a bare curve,
and its marker is drawn hollow and dashed, with a leader back to its source, so
it does not look like a snap that means something. Points only, so far.

**A circle or arc carries its own normal** (`CircleEntity`,
docs/plans/frameless-curves.md). In 3D a circle without an orientation would
be a sphere — which is what phase 1 had — and phase 2 took the orientation
from a frame the curve named. That made every curve need a frame, so the tools
made one at every first click, and the owner asked twice why drawing a circle
made a frame. Now a 3D circle or arc owns **three normal variables**, solved
like its radius, and every residual reads them **normalised** (`unitDuals` in
`relations/refs.ts`): only their direction means anything, their length is a
gauge. There is no normalisation residual — that would be an equation the
entity carried, and equations live in relations — and nothing can shrink the
normal to satisfy a relation, because every reading is scale-free and the
gradient along the normal is exactly zero. Two angles were the alternative and
were rejected: they have a pole where the gradient of one vanishes, and a
circle facing straight up — the commonest one — would sit on it. A 2D model's
curves have the trivial normal and no variables for it.

**The normal is an orientation, not a constraint**, as the frame was: the rim
is the circle through the curve's own centre square to its normal, nothing
pins the centre anywhere, and nothing holds the normal either. A tool that
draws on a plane holds what it draws there with two ordinary relations — an
`onPlane` on the centre and a `par(curve, plane's normal)` — which can be
seen, hovered and deleted; delete the `par` and the circle is free to turn,
`par("c1", "l1")` stands it square to a line. `par`, `perp` and `ang` read a
curve as its normal (`directionOf`), and the normal is *geometry*, declared by
every block that reads it, so a free circle turns to meet what it is held to.

The relations that read the *rim* read the normal: `onCircle` in 3D is two
blocks, the distance and the point's offset off the rim's plane, and `tangent`
holds the line's ends on that plane; both declare the normal's variables. In
2D those blocks would be trivially zero, and they are **not emitted** — a 2D
relation is the blocks it always was.

An arc goes counter-clockwise about its own normal, from its start, so it
needs no reference axis. Before arcs carried a plane that side came from the
kernel's axes (+z, then +y, then +x) — the gauge showing through. The rule
survives only in the translation of files written under it
(`planetranslation.ts`), which swaps an arc's ends where the two disagree so
the file opens as the drawing it was.

`curveplane.ts` is the one place a rim is located — `curveFrame` lays any
circle or arc out for `arcgeom.ts`'s machinery, from the curve alone — and
everything that draws, picks, snaps, boxes or labels a rim asks it. Seen
face-on a rim is still the exact screen circle or arc it always was; seen
obliquely it is a closed quarter-pixel polyline on its ellipse, lifted back to
the true rim by angle.

**A plane reference** is what `onplane`, `par`, `workplane`, `lookAt` and a
feature's plane take: a frame's name (its x–y plane), a circle's or arc's
name (its own plane), or three point names `"p1.p2.p3"` (the plane through
them, normal (p2 − p1) × (p3 − p1)). `planeBasis` reads any of them as a
datum, as `frameBasis` reads a frame: plain numbers, so a point is pulled to
a face and never the face to the point. `referentsOf` is what the deletion
cascade, `argRefersTo` and the glyphs read a reference's names through, so
deleting one of the three points takes what stood on them.

**A 2D file opens lifted** (`persist.ts`, keyed on the file's `dim`): every
coordinate gains a zero, and every frame the y-ref a 3D frame cannot be without
— named after its frame rather than auto-named, because an auto-name claimed
mid-replay is a name some later entry already holds, and placed from the
*saved* coordinates, since only they know where a frame the drawing had turned
put its +y. The command line applies the same lift to a two-number `pt` or
`fix`.

## A sketch is a plane, and the plane is drawn

A sketch here is no container. It is the **work plane**, a plane reference
held as document state (`workplane("p5.p6.p8")`), or the default frame's
plane. Until docs/plans/mode-feedback.md nothing drew it: the camera turned
square to it once, and that was the only sign. The owner: *"it isnt obvious to
me that is whats happening."* Now three things say it, and none of them is
model state.

**The plane is drawn** (`activeplane.ts`, pure, at quiet.ts's height, asked
once a frame by main.ts's draw pass). A plane of points, or of a curve, is
matched to the face it was taken from. That is a feature's face lying in the
plane whose outline runs through the plane's points, or for a round face
whose rim is that circle. The face is tinted in the tools' green, lighter, and
outlined in the green, under the drawing and over the faces, in every view
mode. Where a solid is in front of it, or it faces away, the tint fades and
the outline takes the hidden view's ink for that green (`hiddenInk`), so the
plane reads from behind too. No face, and the plain loop the points are
corners of is tinted. A frame made the work plane, or a bare plane, is a patch sized to
what is held on it, with a grid whose step is the first 1·2·5×10ⁿ that is
32 px on screen, so the grid follows the zoom. **No plane, nothing drawn**,
and a default frame on its own is only named in the chip: it is drawn heavier
already, and what is typed under it is held by no relation, so focus would
dim the whole drawing.
Drawing on the ground is not a mode, and must not look like one.

**Focus is chosen by relation, not by position.** What is held on the plane
by `onPlane(p, ref)`, a curve whose centre is or which a `par` holds to the
plane's normal, a line whose ends are, the plane's own points, and the solid
its face belongs to are drawn in full ink. Everything else is drawn in the
out-of-focus ink, its own colour taken toward the canvas's ground. "On the
plane" by coordinates would catch every vertex the square-on view stacks
behind the sketch, which is exactly what `findSnap` already refuses to offer
as a place on it. None of this reaches the pick: dimmed is not hidden.

**The chip says where · what · next** (`modechip.ts`), in the status's
corner, so it is laid out by the corner's rules (everything-fits.md): it
wraps within the room the panes leave it and is clipped, never drawn over
a pane. *Where* is the plane's name (`e1's top`, `f1`). *What* is
`engine.lit`. *Next* is **one engine seam**, `engine.next()`, asking the
armed tool (`Tool.next(hand)`), every frame, in the verb of the last hand on
the canvas. Guidance goes there too. A miss is answered where the next step
is said, and dropped once the step moves on. The status keeps the verdict
and its one-off notes, so the two never fight over one line. When the
corner is short, the chip gives way (its next step, then the tool's name)
and **the verdict is never cut** for it.

**The chip only types, as the context menu does.** Done is
`workplane(null)`, or `setDefaultFrame(null)` where the plane is the
default frame's. Look at is `lookAt(ref)`; Change… is `arm("sketch")`. Each
goes through `submit`, so it is logged, journalled where it is document
state, and undone in one step. The camera is left where it is.

**The gesture's stage is drawn through two more optional hooks.**
`Tool.placed()` names what a gesture has put in the model and not finished
with, and the host draws it in the accent (the line tool's chain).
`Tool.takes()` names what the next pick could take, lit faintly (the
fillet's corners). The point a mouse click would place is a ghost at the
cursor, the mouse's half of the lifted mark a finger already had. A tool
written at the command line with none of these hooks is drawn as before, and
the chip then says its name and nothing after it.

## Sketch mode is a mode, not a feature

The owner asked to "natively sketch on a plane without it being a special
feature" (docs/plans/sketch-mode.md). Sketch mode is three things that were
already true and one rule that makes them hold everywhere:

- **the work plane is set** — a plane reference, `workplane(ref)`, document
  state that names no new entity;
- **the view is square to it** — `workplane` turns the camera, and the chip's
  ⊥ turns it back after an orbit;
- **everything drawn is held on it by `onPlane`, one per point** — and the
  rule is checked over the tool registry (`test/sketchmode.test.ts`), so a
  drawing tool added later that forgets the plane fails by name, and the
  check reads every new point, never which kind of curve it belongs to.

**A plane is a reference, never a feature.** Four kinds: a frame (its x–y
plane), a frame's x–z or y–z (`"origin.xz"` is Front, `"origin.yz"` Right),
a curve's own plane, three points. The ground's three cost nothing to
choose. A face of a solid is three of its own points, so it follows the
solid. The one face with no points to name — a flat face the kernel made
that no loop bounds, a chamfer's — gets a plain frame made where it is
(`kernelplane.ts`), which is a frame like any other and not in the feature
list; it does not follow the solid, and that is written down.

**Copies inherit the plane.** offset, mirror and the patterns pair each
original point with its copy and hold the copy on every plane the original
is held on that the operation maps onto itself. The pairing is all the rule
knows, so a module's curve kind is copied onto the plane by the same code.

**The relation is ordinary and quiet.** Each `onPlane` is a relation with a
name, a `del` and a glyph, but the glyph is drawn only while its point is
revealed: one ▱ per sketched point is the clutter the glyph work removed.

## Every sketch is a 3D sketch, and every operation holds both ways

Two rules from the owner, the same day (docs/plans/profiles-held.md), and
the second is the reason for the first.

**No plane unless one is picked.** *"The default for sketch entities is no
plane. Every sketch is a 3D sketch, unless you enter into active on-plane
constraint."* Where a click lands on the ground in a fresh document is a
position, never a relation. A drawing tool holds what it makes to a plane
only when sketch mode's work plane or a default frame is set, **or when the
click landed on a solid's flat face** (`holdOnSketchPlane`, `holdCurve`: a
chosen plane by `sketchPlaneRef`, a face by its name — the owner's later
*"it should constrain to the plane i am hovering over"*,
docs/plans/click-on-face.md); otherwise a curve is held by nothing but its
own definition, its normal seeded facing the plane it was drawn on.
`test/noplanedefault.test.ts` walks every drawing tool on the ground, and
`test/clickonface.test.ts` on a face.

**A face a click lands on is held by what made it**, as a face dimensioned
is (below): `onplane(p, "e1.m3")` reads the wall's line and the extrusion's
way off the feature's record at every evaluation (`relations/solidref.ts`),
the line's two ends as variables — so a point held on a wall can pull the
wall, and the solid with it, as much as the wall holds the point. With
nothing holding the base, that is what happens: a `set` of the depth with a
circle pinned to three faces lets the minimum-norm solve share the change
between the points and the solid (measured: the lid's point rose 9.3 of 10,
the solid moved the rest). Both ways, by the owner's rule; a base the user
holds (sketch mode's `onplane`s, a `fix`) stays, and then the point rides the
full distance.

**Relations between entities, both ways, by default.** *"It's not about
being tied to the ground plane, it's about correct relationships BETWEEN
entities. Part of the concept of this CAD is to have bidirectional
relationships everywhere by default."* So an operation that makes geometry
from geometry says what it means as a relation between the new entities and
the old, with **both sides variables**, so a drag on either moves the other.
A datum — read as numbers, never pushed — is only ever something the user
picked: a frame, a frame's axis, a plane chosen to sketch on. The audit
that applied this to every such operation is a table in the spec, and
`test/bothways.test.ts` has a row for each, dragging the copy and the
original in the plane and out of it:

- a **revolve** holds its profile in the plane through its axis (one row a
  point but the farthest from it); a frame's axis is a datum, a line the user
  drew is read as the line's points, so a profile drag can move it;
- an **offset**'s copy is held in its chain's plane by `coplanar` — a point in
  the plane of three others, all four moving, unlike `onPlane(p, "a.b.c")`,
  which reads the three as a datum — on one vertex per run nothing else
  holds, and a round copy nothing turns is `par` to its original;
- a **circular pattern** with nothing picked turns about its seed's own
  plane, three seed points read as variables, rather than the ground's z;
- the **extrusion** itself — the owner's measured case, a lid corner dragged
  skewing the prism — is below.

**An extrude is an edge extrude of its whole profile, sharing one chord.**
The owner: *"Edge extrude is a fundamental feature."* An edge E and a chord
c give E′ = E + c: every point moved by c, every size (`Model.sizesOf`: a
radius, an ellipse's minor, whatever a module's kind declares with
`EntityKindSpec.sizes`) and every normal the same. That is the whole of the
`extrusion` relation now: each twin is its base plus the chord of the first
pair, and the chord is as long as the depth reaches — **no direction read
from anything**. Until 2026-11-09 every twin sat at base + depth along the
frame's +z, a datum, so a lid corner dragged tilted the base while every
wall kept the frame's z: a skewed prism, SOLVED. `edgeExtrude` (the `edge`
tool) makes the same pair for any chain of curves, and its sheet is a
surface record that, unlike every other, owns entities.

**Which way the chord points is an ordinary relation beside it**, the
operation's and anyone's to delete: `perp(chord, e1)`, named `e1_perp` — the
chord square to every edge of the record's profile, read off the record at
every evaluation, so a regenerated profile is the one held. The owner: *"how
could you have a relation inside an extrude? that doesnt really make sense
to me."* An `ang(wall, e1, θ)` in its place makes a drafted or oblique
extrude; the kernel sweeps only square, so that one is drawn and its body
refuses, by name. The name is derived from the record and claims no counter
(`Model.namedRelation`), so an old file opened today gains the perpendicular
and every name it had stays its: its journal and values re-save byte for
byte, and its solids stop skewing.

**The sign is the geometry's.** With no direction read, which side the lid
is on is where its twins are: seeded on the depth's side by the operation,
and moved across by `set` when a depth changes sign (`reseatLid`, which also
seats the lid at a new depth before the solve, so a minimum-norm solve does
not share the change between base and lid). The plane a solid is laid out
in (`featurePlane`) is square to the chord and signed by the depth — never by
the reach, which for a through-all end is read off the bodies' planes and
would read itself.

**A rectangle is four perps and, with no plane picked, one `coplanar`.** The
owner: *"i was thinking 4 perps so that all the edges are identical to one
another."* Four right angles do force a quadrilateral flat, but only to
second order: measured, a corner dragged 7 out of the plane came back 2.9e-4
off it; with the coplanar, 9e-13. The fourth perp is implied by the other
three, and the diagnosis says so — which is why **an agreeing redundancy is
drawn in the ordinary ink**, and said in the status's muted grey, never
orange (the owner's decision). A conflict stays red.

**Fewer relations, not more.** Each of these was first written holding
everything and read orange: a rectangle's offset held at four corners
reads three redundant, because a line's copy is `par` to an in-plane line
and one held end carries the other. The rule that came out of it: hold
what nothing else holds, and check with `diagnose`, never by counting.

**A feature's own relations are never named redundant** (`Model.diagnose`
skips what `removable` refuses, as the conflict search already did). A
revolve of a sketch-mode profile says "these points are in one plane with
the axis" where the user's onplanes already say "these points are on this
plane"; that is the feature being consistent, and a person can neither
delete nor fix it. Measured with the line taken out: a whole revolve's
angle read orange.

## No hierarchy: an extrude's two profiles are peers, and a feature relates

The owner (docs/plans/linked-profiles.md): *"i mean kind of like mirror
relations"*; *"i don't like the idea of anything being 'consumed' as this
implies unidirectional hierarchy"*; *"after extrude, it should be impossible
to tell which was the original and which is the derivative"*; and, refining
"no hierarchy", *"hierarchies do exist, but they are not timeline based"* — a
body does depend on its profiles, but through relations that read both ways,
not through an order of creation.

**The link is the `extrusion`.** It already holds every point of one profile
at its partner plus one chord, both ways. `twins.ts` reads a link off it —
the pairs it holds, and every line and spline whose ends are paired and whose
partner runs between their partners — for an extrude and an edge extrude
alike. Nothing reads which side "the profile" was.

**Every relation within a profile has a twin on the other**: the same
relation over the partner entities, an ordinary registry entry under a name
derived from its partner's (`r3_e1`), so it claims no counter and an old
file's later names stay theirs — the `e1_perp` trick. The entry carries
`twin: { of, via }`. Which relations twin is the relation's own module entry
(`RelationDecl.twin`): **shapes** (`dist`, `tan`, `eq`, `coin`, `rad`…) and
**directions** (`par`, `perp`, `ang`, which may name a frame's axis — a
direction a translation does not turn) do; a relation that says *where*
(`fix`, `onplane`) does not, nor one that names anything outside the profile
— its twin would pin the lid where the base is.

**The pair is one thing, and a twin holds no rows.** What a twin says of its
profile is exactly what its partner says of the other, carried across by the
extrusion; its rows would repeat rows already there. They were tried first,
and measured: with them in the problem the suite's frame-turn (a rectangle
on a tilted frame, the frame's y-ref swung) stopped solving — repeated rows
re-weight the least-squares step, and it found the fold. So a linked twin is
registered, named, drawn, set and deleted, and holds nothing; the solver,
the diagnosis and the conflict search see one statement for the pair by
construction, with no special case in any of them, and a solve takes the
path it took before there were twins. When the link's `extrusion` is deleted
each twin is an ordinary relation that owes its rows (`asleep`) and is given
them by its own function before the call returns. `set` on either rebuilds
every relation of the pair with the one value; `deleteRelation` — the
primitive, so an old file's deletion of a base relation means what it meant
— takes the pair. A relation among many (among.ts) has one twin among the
partners, the relation as written; what would join or leave a twin joins or
leaves the relation it is the twin of, by the partners on that profile, and
a member deleted journals that relation's one `leave` — the twin is made
again from it, as it was made in the first place.

**Kept true by one pass, at the points a replay reaches.** `Model` runs a
follower (`defineFollower`, as `defineThroughReach` keeps it from knowing
what a body is) after every relation made at the top level, every outermost
operation and every entity made outside one — never inside an operation,
which sees structure half-made. The follower (`syncTwins`, and
`relinkOpen` before it) is idempotent and decided by names and joins alone,
never positions: so a journal carries **no entry for a twin**, and replaying
what made a relation makes its twin again under the same name. Format 21
exists for what *deletions* mean now, not for any new shape (persist.ts).

**An edit to one profile is an edit to both.** Deleting a profile's entity
takes its partner (`linkedClosure`), and the extrude **stays, open**: its
record keeps what is left of the profile, `faces.ts` draws a wall per
surviving edge from both sides and no cap, `chainsOf` leaves it out of every
body and says why, the organiser's row says *open*. A line drawn again
between two corners — joined to them by `coin`, as the line tool joins —
is given its partner and the profile, walking closed by its joins, is
rebuilt (`relinkOpen`); closure by position (an end extended back to an
edge) is the host's to ask after a person's edit (`closeOpen`), journalled as
the `regen` it is. A `trim` on a lid's edge is made on its partner with each
cut carried back across the link (a cutter with no partner holds the end's
twin, on its own profile); one that takes the loop away leaves the extrude
open (`planOpen`: each member's twin re-pointed or made without the walk
round), where it used to be refused. `extend` only moves a point and holds
it, which the extrusion already carries both ways.

**What is left that tells them apart** is written down rather than hidden:
a twin's name says which was typed (`r3_e1`); `fix` and `onplane` are on the
profile they were put on; two base corners joined by `coin` have one lid
point between them; a region stays on the profile the extrude was made
from; and a profile that is a *piece* of longer lines (a region a crossing
split) has no partner edge for edge, so its relations do not twin.

**Hierarchies exist, but they are not timeline based** (the owner, and
docs/plans/fillets-one-thing.md). A body depends on its profile and a boss
on the lid depends on the lid; what carries the dependence is the records
and the links, read both ways, never an order of creation. So when a corner
of a profile is cut (`fillet`, `chamfer`) nothing is deleted or re-pointed:
the two lines and the corner stay, as construction, and the shorter lines
and the arc are new. Every record standing on either line is brought into
step (`regenerateRounded`): it sets its half of the old corner aside
(`aside` — the twin lines, the twin corner, the chord between the corners,
kept construction and no longer swept), rebuilds on the loop as it stands,
and the same cut *as its other profile has it* is the next job, so a solid
on the lid is cut at that corner too, and so on up. The solid's own edge
fillet between two walls is this call (`profileCorner`): one entry, one
model, one body, whichever route was taken. A fillet asked of the lid's two
lines is made on the base, since the record is rebuilt from it — and that is
the one place the two profiles are not symmetric, filed in the register.

**Anything can be construction.** One flag (`Model.setConstruction`) on a
curve, a point, a frame or a feature (its body), meaning one thing on every
kind — reference: related to and dimensioned like anything else, left out
of what is built from it. A curve bounds no region; a point cuts no edge it
is held on; a frame lays out no feature unless named; a body is drawn in the
construction ink, is not exported and is joined or cut only when named.

## Tools are not privileged

A tool is a class with `onDown` / `onMove` / `onUp` / `onCancel` / `render`,
registered with `defineTool(name, ctor)`. The built-ins use exactly the API a
tool typed at the command line uses — there is no separate plugin surface,
and if there ever is, something has gone wrong.

A tool receives a `ToolContext` (the model, plus `requestRender`,
`requestSolve` and `finish`, and `options` — what it was armed with, every
declared option filled and checked) and no ambient globals. It stays armed until it
calls `ctx.finish()`, which is why a three-click arc tool needed no engine
change: "multi-stage" is just "finishes later".

The engine keeps navigation and tool use on separate mouse buttons, so a
gesture can be panned through without the tool ever seeing it.

**A finger has no buttons**, so a touch pointer goes through a recogniser
first (`tools/gestures.ts`): pure, below the engine, knowing nothing but
pointer ids, pixels and a clock. It holds a touch until it has moved, lifted,
held still or been joined, then names the gesture, and the engine sends that
down the mouse's own paths. A tool therefore sees a finger's tap as a click
and a finger's drag as a left drag, and never learns that touch exists. The
one thing a finger changes below the engine is reach: `hitTest` and
`findSnap` take a `reach` factor (`TOUCH_REACH` for a finger) that scales
every tier together. The branch is made on each event's `pointerType`, never
on what the device is; only the chrome's sizes follow `(pointer: coarse)`.

Screen-space questions are the engine's to answer, never the tool's: `pick`
says what entity is under a pixel — and, for a frame, which arm of its marker,
so the revolve tool turns a click into `"f1.y"` — and `regionAt` which closed
region it is inside (`findLoops` + `loopAt`), so a tool can choose things on
screen without learning what a camera is. The extrude tool was the first to ask
the second, the revolve tool asks both, and the click-inside gesture lives in
the tools alone — with nothing armed, a click inside a region still picks
nothing. A tool that chooses rather than places
says so (`snaps = false`) and the engine neither pulls its cursor nor draws a
marker promising a vertex the click will not go to.

`regionAt` also reports the line of sight it looked along (`RegionHit.toward`),
which is the half of the answer the sketch tool needs and the only part of the
camera a tool ever sees: which side of a face was the one clicked. And a tool
whose commit *is* a command — the sketch tool's `plane(a, b, c)`, which turns
the view as well as making a frame — **types it** (`ctx.run`, the host's
`submit`, the context menu's own seam) rather than reaching past the model to
the camera. That is the menu's rule applied to a tool: the log, the recall
history, the journal and the one undo step are the typed call's because it is
one.

A typed line runs asynchronously, so `ctx.run` settles once it has run, and a
tool with more to do after it waits: the extrude and revolve tools type the
plane a frameless sketch needs (`plane(a, b, c, { look: false })`), then
commit along it inside `ctx.act`, the engine's own undo bracket — without the
wait the commit lands inside the typed line's step, and one Ctrl+Z takes both
(measured). A tool reports what a commit made through `ctx.log(line,
"done")`, which the host shows as an answer rather than a refusal.

## A solid's faces are drawn, never stored

An extrude is real geometry — twins, walls, a depth — and its *faces* are what
is filled between those pieces, read off where they are each frame
(`faces.ts`, a pure function of model and view at glyphs.ts's height). So a
face can never disagree with the edges over it. A cap is every profile loop as
one set of outlines, filled even-odd, which makes a hole empty and an island in
a hole solid with no triangulation and no nesting rule; a curved wall is one
quad per drawn segment, so it shades round. Each face's outward normal is
computed from its loop's winding and nesting, faces turned away are culled, and
the rest shade by the cosine to the line of sight — a headlight, because a
light fixed anywhere would need a world frame to fix it in.

**Which face is in front is a depth buffer's answer.** `faces.ts` says what
the faces are; `facelayer.ts` draws them, by WebGL with a depth test, on a
canvas of their own (`#faces`) under the 2D drawing (`#cv`), through the
view's own orthographic projection — `clipMatrix` in `view.ts`, which is
`worldToScreen` and `depth` rearranged into clip coordinates, the depth range
the visible faces' own each frame, the points handed over relative to an
anchor near the middle of the screen so single precision costs nothing on
screen. A face whose one outline is convex — every wall quad and strip piece —
is its own triangle fan and goes in one batched draw; a cap is filled even-odd
by the **stencil method**: a fan from the first vertex of each outline inverts
one stencil bit with no colour written, and the same fans again write colour
and depth only where the bit is odd, clearing it as they go. No triangulator,
no dependency, exact for every planar outline `faces.ts` produces.

It replaced a painter's sort over whole faces, and the reason is that no
order of whole faces can be right for two solids passing through each other,
or for a sweep that wraps round in front of its own cap: the order needed does
not exist. Each fix to the sort — a cap keyed by its nearest point, a cap
lowered under a wall of its own in front of its plane — moved the limit
without removing it. Measured before choosing (`npm run measure:depth`, 40
seeded orbits a scene, wrong = a pixel more than 6 levels off and 1.5 px from
every outline): two interpenetrating extrudes, the painter's wrong in 39 views
of 40, 4 528 pixels a view on average and 14 647 at worst; a 355° revolve
wrong in 13 of 40, slivers of wall over its cap; a lone box and a lone
cylinder wrong in none — where the painter's is right the two agree but for
anti-aliasing. The app's own frames in headless Chromium with software WebGL:
45.9 ms by depth against 46.0 by the painter's for a stepped block, 51.2 against
252.9 for a full turn of a filleted profile — in a browser with no GPU the 2D
canvas is rasterised by the same software renderer, and 650 anti-aliased paths
cost it more than a depth test does. (See docs/plans/display-depth.md.)

**The painter's is the fallback, chosen in one place.** `createFaceLayer`
returns null where the browser has no WebGL (or no stencil buffer, or a driver
refuses the shaders), and `main.ts` then fills `facesToDraw` — faces far to
near by centroid, into the 2D canvas before everything else — and nothing else
anywhere branches on which. Its sort is the plainest, and wrong where any sort
is, a grazing lid past its own hole's far wall included (the case the deleted
nearest-point key existed for; a test holds the fallback to it). It exists so
a browser without WebGL still sees solids, not to be right.

**A solid is opaque: what is behind a visible face is neither drawn nor aimed
at.** The owner (2026-11-02): *"when you extrude a solid, it should look like a
solid"* / *"It should be opaque"*. The entities are still drawn on the 2D canvas
over the faces, but in the default **shaded** view every part of the drawing
behind a visible face — an edge or the part of one, a point and its name, a
glyph (asked at its anchor, so a dimension's label goes with its witness
lines), a frame's marker (asked at its origin) — is left out, and the same
answer is what `hitTest`, `findSnap`, `selectInBox` and `placeGlyphs` are
handed, so it cannot be picked, hovered, dragged, snapped to or boxed either.
**One `Occlusion` a frame, for the eye and the hand**: `render` builds it from
the faces it drew and sets it on the tool engine (`engine.occlusion`), and every
question the engine asks about the cursor passes it on. A pick between two
frames therefore uses the last frame's — what is on screen — and since every
change to the model or the camera redraws before the next pointer event,
there is no other staleness to handle. A face still never picks for the hover,
the selection, the menu or a drag (smart dimension's exception is below): the pieces
of a solid are what a hand aims at. On the surface is not behind: the
square-to-the-plane half pixel below decides it, so a box's near edges and
corners draw and pick while its far ones do not.

**The view mode is the viewer's** (`viewmode.ts`): `view("shaded")`, the
default; `view("hidden")`, the hidden-edge look below — everything drawn, the
part of an edge behind a face in a dimmed ink, and everything aimable;
`view("wire")`, no faces (the depth layer cleared, `occluded` null, every
mark in its sketch colour). In `localStorage` under `neocad.viewMode.v1`, like
the layout and the tool options, never in the journal, a file or the undo
history; offered as a View row on the empty-canvas menu and in `help()`.

**The body is light and its edges dark.** Faces run from a mid slate edge-on
to a light grey-blue square-on, the headlight's cosine spread over the whole
range (WCAG 5–9:1 against the background for a box seen from a corner, 1.3–1.8:1
face against face; measured in the CHANGELOG). A solid's own edges — its whole
profile members, the lid's twins, the walls — are drawn in `SOLID_EDGE`, a dark
ink, wherever faces are drawn: by the face layer, as part of the solid, and in
the hidden view by the entity pass as well (in the shaded view the entity pass
leaves them quiet — below); a profile member that is only a portion of a
longer line keeps its sketch colour, since most of that line may be off the
solid. Light marks over light faces would vanish, so where faces are drawn the
entity pass runs twice: first every mark's **casing** — the same strokes a
little wider, dots a little larger and names stroked, in the background's own
colour, invisible off the solid — then every mark itself; casings first, all
of them, so one never cuts a mark already drawn where two cross. A plain
sketch has no faces, skips the casing pass, and draws pixel for pixel as it
did (the hidden-edge package's golden picture holds it).

**Quiet geometry: corners and a solid's edges are drawn when the hand is on
them** (`quiet.ts`). The owner: points *"disappear when they are the endpoint
of a line or a corner (except when you hover over them)"*, lines *"when they
form the edge of a solid"*. In the shaded view `render` asks `quietEntities`
for this frame's quiet set — every end of a line or arc that is no circle's or
arc's centre, and every whole profile member, twin and wall of a feature with
faces on screen — and `revealed` for what is drawn regardless: the hover and
what a hovered glyph lights, the selection (drawn in its violet),
the snap's targets, what is under an armed tool's cursor (`engine.armedUnder`)
and what a drag is moving (`engine.dragging`), each line or arc among them with
its ends. The entity pass draws only what is not hidden and is not quiet or
is revealed (`entityDrawn`: hidden outranks revealed), and a
glyph follows its anchor (`Glyph.about`, `glyphDrawn`); a dimension is always
drawn. **Decided by geometric role, never by what made a thing** — a lid's
corner and a sketch's are one case. **Quiet is not hidden**: nothing of it
reaches `hitTest`, `findSnap`, `selectInBox` or the drag, so a quiet corner is
hovered, snapped to and dragged as a drawn one is — and so is a quiet glyph,
because a line picks 5 px out and a glyph's box starts 7 px out, and a glyph
that could not be hovered while quiet could never be reached from its line.
The hidden and wire views draw everything. **The solid's edges are the face
layer's** (`Face.edges`): every face says which of its sides are edges of the
solid — a cap's outlines, a wall's base and twin and its sides at profile
vertices, a sweep's rims and the circles its vertices turn through, never a
seam between two pieces of one round surface — and both renderers draw a fine
`SOLID_EDGE` line along them as part of the solid: the depth layer as thin
quads square to the line of sight (`SOLID_EDGE_PX` wide on screen, whatever
the driver's line width), depth-tested with `LEQUAL` against faces drawn with a
polygon offset of one pixel's slope more than the half-width, so an edge on a
face wins and an edge behind one does not; the painter's as a stroke after each
fill, so a nearer face painted later covers it. A solid that cannot be laid out
has no faces, no face line, and its edges are drawn by the entity pass as
before.

**In the hidden mode, the part of an edge behind a face is drawn in a dimmed
ink** — the drafting convention for a hidden line. Only the ink changes: every
edge, point, name and glyph is drawn on top and picks, snaps and drags.
Points, names, a frame's letters and glyphs are never dimmed (a dimmed name is
unreadable, a point is a target); a frame's arms are edges and dim like edges.
Hidden runs get no casing: they are meant to be faint.

*Which part is hidden is asked of the faces on the CPU* (`occlusion.ts`), not
read back from the depth buffer, which would stall the frame. Each visible
face is projected once a frame with its screen box; an edge — a line's two
ends, a curve's drawn samples, a frame's arm — is sampled at least every 4 px
on screen, and a sample is hidden when a face's box and then its even-odd
outlines hold its pixel and the sample is more than half a pixel's worth of
world *behind the face's plane, measured square to the plane*. Not along the
ray: an edge lies in its own faces only to the quarter-pixel a curve is drawn
to, and along the ray that error is multiplied by 1/cos of the grazing angle,
so a face seen nearly edge-on would hide its own boundary. Runs of samples with
one answer are stroked in full or hidden ink, the seam half-way between the two
samples that disagree — within 2 px of the true crossing, which is the
convention's resolution anyway. The hidden ink is the edge's colour 40% of the
way from the faces' darkest tone (their middle until the body went light, 2026-11-02), a solid colour (the same over any face, and amber
stays amber when lit); no dashes, which at this stroke width are noise on a
curved sweep. With no solid nothing is asked and the old stroke calls run as
they were, pixel for pixel (a test holds it to a picture the build before drew).
The painter's fallback gets the same dimming: it is the same 2D pass. Measured
(`npm run measure:hidden`, medians of six runs): the pass costs 1.2 ms a frame
on the stepped block and 2.3 ms on a filleted full turn of 860 strips, against
0.5 and 3.7 ms of the faces' own main-thread work (derived and drawn) — a
couple of times the faces where there are few of them, less than them where
there are many, because faces whose screen boxes miss an edge's are dropped
before its samples are asked. The frame interval in the e2e browser did not
move beyond its own noise; see the CHANGELOG. The e2e oracle that grades the depth layer asks the same module, so
the app and the test cannot disagree about which face is in front. The faces canvas has `pointer-events: none`; every listener is
on `#cv`, which is transparent wherever it draws nothing. The e2e suite reads
either picture, or the composed one from a screenshot, and checks the faces
against an oracle that casts each pixel's ray at the faces' planes, so the
renderer is never trusted to grade itself; Chromium is launched with its
software WebGL asked for by name, and a test fails if the app ever falls back.

**Sketching on a face needs no face to pick.** Every planar face of a solid is
a closed loop of real entities — a lid its twin loop, a wall the quad of an
edge, two side edges and the twin edge — so the face under a click is the
region `loopAt` finds, and a frame on three of its own points (`plane(a, b,
c)`, `sketchface.ts`) is the sketch plane, following the solid because its
points are the solid's. Back-face culling gives the orientation for free: the
first face a ray meets is one whose outward normal faces the viewer, so
ordering the points to face the camera puts +z out of the solid.

**A revolve's faces are derived further.** There are no walls to fill between,
so each piece of the profile is swept round the live axis in steps sized from the
swept radius — `arcSegments`' quarter-pixel at the farthest point, one count for
the whole solid so neighbouring rings meet — and each quad's normal is the
profile's own in-plane normal turned, which is exact for a surface of revolution
and is why the axis must lie in the profile's plane. Caps only for a partial
turn. Every quad is planar, which is all the depth layer needs; the 355° limit
the painter's sort had here went with the sort.

## A face to dimension is what made it

The owner asked for SolidWorks' Smart Dimension, *"Distance between two
faces of a solid, or angle"* (docs/plans/smart-dimension.md). A face is not
stored, so a dimension on one holds **what made it**, by a name that says so.

- **A face is named by what it is swept from, and the name is resolved when
  it is read** (docs/plans/review-relations.md). A cap is `e1.base` or
  `e1.lid`; a wall is **`e1:l2`**, the wall of `e1` swept from the profile
  entity `l2`. That is what a relation journals and what a tool is handed for
  the face under the hand. It was `e1.m3` — the wall in *place* 3 of the
  profile, members counted loop by loop — which is how the solid kernel tags
  the faces of one build (`src/solids/naming.ts`) and what a drawn face still
  carries (`Face.name`), on a body faces.ts draws and on one the kernel
  built alike. A place is right for a build and wrong for a relation: a
  fillet of the profile's first corner puts its arc in place 1 and every
  later wall moves up one, so `onplane(p, "e1.m3")`, made on the wall of
  `l4`, took its point to the wall of `l3`. The two names meet in one file,
  `src/relations/solidref.ts`: `faceSource` resolves either form;
  **`faceRef`** turns a place into the entity now in it, and is called where
  a relation is made (so a typed `e1.m3` is journalled by its line), where a
  face is picked (the engine) and where a file from before format 20 is
  replayed — at the relation's own step, when the profile is as it was when
  the relation was made; **`faceKernelNames`** turns a name back into the
  tags it is drawn as this build, to light it and to ask the kernel about it.
  A colon, not a second dot: what follows a dot is a word the model owns
  (`lid`, `base`, `x`, `value`), what follows the colon a name the user
  owns, and an entity called `m3` must not be place 3. `claimName` refuses a
  colon in a name as it refuses a dot.
- **A wall's name is about two things**: `referentsOf("e1:l2")` is the
  feature and the line, so a relation on the wall goes with either, lights
  the line when its mark is hovered, and the log says which wall it went
  with. A relation whose line a trim took out of the profile, the line
  itself still there, is read as the plane that line would sweep rather than
  throwing inside a solve; it is only ever *made* on a face the solid has.
- **The source is the record's** (`src/relations/solidref.ts`), read at every
  evaluation. A cap is its profile's points or their twins and the sketch
  plane's normal, a datum. A line's wall is the line, its normal the line
  turned square to the extrusion. A round wall is its circle or arc, and an
  edge between two of one extrude's faces is its entity.
- **So most face dimensions are sketch dimensions.** Two parallel walls of
  one extrude are `dist` of their lines, two that meet are `corner` of them
  (relations/smartdim.ts: the angle in the corner the two lines make, each
  read out of the corner — where `ang` of two sides drawn head to tail reads
  the supplement, and `ang3` of three points lost its corner to a fillet), a
  round wall's size is its circle's `dia`, an edge's length its line's.
  These follow any regeneration, because lines do. `fdist`, square to a flat
  face, names faces — by their lines, like every relation that takes one
  (`onplane`, `par` and `perp` to a face's normal, a driven `fangle`).
- **The depth is not a second dimension.** `extrusion` holds the lid at base
  + depth·ẑ with the depth a constant, so the lid-to-base distance can only
  be the depth. The tool opens its value rather than add a relation that
  could only repeat or fight it.
- **What only the kernel knows** — a fillet's face, a boolean's edge — is read
  through a function the host hands `measure.ts` (`setSolidReader`), so the
  relations layer still never learns where the kernel is. It can only be
  measured: a driven dimension.
- **A record's going takes the relations naming its faces.** `"e1.lid"`'s
  referent is the record, which the entity cascade never saw.
- **What still holds a place**: the solid kernel's own names — a drawn face's
  tag, an edge (`e1.lid|e1.m0`), a blend's edges, a surface taken from a face.
  They are a build's, and filed in TODO.md as the next thing a regeneration
  renumbers.

**Faces pick for a tool that asks, and nowhere else.** `ToolContext.pickSolid`
(`src/solidpick.ts`) is the ordinary pick, and where it finds nothing, the
front face under the pixel. That is occlusion's `nearestFace`, the e2e
oracle's question, over the faces the frame drew. It is not a fourth tier of
`hitTest`. A click on a face still selects nothing, hovers nothing and drags
nothing, which everything built since "faces are display only" relies on. A
lit face is filled only in the cells where it is in front, because a 2D canvas
has no depth test.

## A body is a chain, and the kernel builds only what a boolean made

ZeroCAD's equations live in the solver. Its solids are built by a second
kernel, NVIDIA's SMLib, compiled to wasm from pinned source by
`scripts/solids/build.sh` and run in a Worker
(docs/plans/solids-kernel.md). The two kernels never meet. The relational
model holds what a user means: a profile, a depth, an axis, a work plane. The
solid kernel is handed numbers derived from it and hands back faces, edges and
triangles.

**The layer rule's kernel edge holds for this kernel too.** `src/solids/`
(the contract `kernel.ts`, the SMLib adapter, `evaluate.ts`, `naming.ts`,
`profile.ts`, the Worker's `serve.ts` and the page's `client.ts`) knows
planes, profiles as 2D numbers, sweeps, booleans and tags. It has no point,
entity or name of the model. The page side sits above the model:
- `modes.ts` says which features make which bodies, and what a new feature
  does by default;
- `bodies.ts` reads the program off the model, sends it, and turns the answer
  into faces to draw and faces to pick;
- `kernelbrep.ts` turns the kernel's topology into the exporter's B-rep.

`main.ts` constructs the client (`solidshost.ts` says where the Worker and the
wasm are in each build).

**A body is its chain**: a feature of mode `new` starts one, and each later
feature whose `into` names that body adds to it, cuts from it or intersects
it, in the order the features were made. That order is a dependency order,
because a feature can only name a body that existed when it was made. So
there is no timeline to keep and nothing to reorder. A feature with no mode
(every feature in every file older than format 14) is a body of its own,
which is what it always was.

**The default is decided once, at the call, and journalled resolved.** A
solid that touches or overlaps a body adds to it; one that touches nothing is
new; Cut is never a default. Whether a solid touches a body is a closed-form
question (`insideBody`: a point's foot in the profile, its height within the
depth, union and cut in chain order). So the default needs no kernel, and a
replay reads no geometry: `Model.journalling` is false while a file is being
replayed, and the call takes the mode it was given. Moving a profile off its
body later does not quietly change what it does.

**Only a boolean goes to the kernel.** A body of one feature is drawn as it
always was, by `faces.ts`, live at every frame, so old files draw pixel for
pixel as they did, a drag has no lag, and the app is whole before the kernel
loads. A body of two or more features is built by the kernel:
- **Asynchronous and cached.** `Bodies.sync` sends the program when it
  differs from the last one sent, with one request in flight and the newest
  waiting. The evaluator caches each node by the hash of every node up to it,
  so a change to the last feature rebuilds only that feature.
- **Never a broken picture.** Until the answer arrives the last good body is
  drawn. A refusal keeps the last good body and says why in the log.
- **Drawn and picked as faces.ts faces.** The kernel's triangles become
  faces.ts `Face`s, each carrying its face's name and its edges' segments. So
  the face layer, the painter's fallback, the occlusion answer and the quiet
  set take a kernel body exactly as they take an extrude, and nothing below
  `main.ts` knows which kernel built what it draws.

**Names are the kernel's history, not a geometric guess.** Right after each
sweep, each face is tagged `feature·1000 + role` (base, lid, or profile member
*i*). SMLib carries the tag onto every piece of a face that survives a
boolean. A face is named by its tag (`e3.lid`); the pieces of a split face
share that name and are told apart by their neighbours. An edge is named by
its two faces (`e1.m1|e2.m0`), and a seam by its one face (`e2.m0:seam`).
Measured through topology changes (`test/solidsidentity.test.ts`):
- a pocket that breaks through loses exactly its floor and the floor's edges,
  and gets them back when it is made shallow again;
- a hole dragged out through a wall splits the wall into two pieces with one
  name;
- a sketch on a face that is gone stays where it was, and the log says the
  face is gone.

**What is relational and what is derived.**
- **Relational:** the profile, the depth and angle dimensions, the axis, the
  work plane, the mode, and an extrude's twins and walls. The twins stay solved
  entities, so a constraint to a lid's edge, in an old file or a new one,
  still holds.
- **Derived, every rebuild, never saved:** the body's faces, edges, volume
  and STEP topology.

In a kernel body the twins are quiet in every view (`quiet.ts`). The kernel
draws what the body is; the twins are what the dimensions hold. Deriving the
twins from the kernel, as the spike suggested, would have cost every old
constraint on a lid and made the first drag wait for the Worker.

**The Worker can die, hang or leak, and the app may not.** `SolidsClient`
replaces it on a crash (an abort in SMLib is fatal to its module), on 30 s
without an answer, and past 256 MB (the fillet leak the spike measured). The
next request starts a fresh one, and the log says each time.

**How an extrude ends is the record's, and the lid is where it says**
(docs/plans/solid-tools-intuitive.md). A feature used to be a profile and a
depth: blind. An extrude's record now carries `extent` — `"through"` or
`"symmetric"`, absent for blind — journalled in the call's options beside
the mode (`{ mode: "cut", end: "through" }`) and changed by `setEnd`. The
depth dimension still holds every twin to its base, but at `lidReach` of
its value rather than the value: half of it for symmetric, and for through
all past the far side of everything made before the feature, read off their
sweeps every evaluation as a datum, the way a frame is read and never
pushed. So the lid stands where the solid ends — faces.ts draws the solid
off the twins, the preview is faces.ts, and both are right — and a cut
through a plate follows the plate set deeper by the solve alone. The
relation cannot know what a body is, so the solids layer registers the
reach (`defineThroughReach`, model.ts); the kernel, the exact B-rep and the
closed-form insideness all read the span through one function
(`extrudeSpan`, solids.ts), and a symmetric extrude's base, which has no
entities, is drawn and built as far below the sketch as the lid is above.

**A fillet is a step of the chain, and an edge is its name**
(docs/plans/solid-fillets.md). A fillet or chamfer is a `BlendFeature` in
`model.blends`: the body it rounds, its edges by name, and the dimension
holding its size. It sits in a registry of its own rather than among
`model.features`, because every reader of `features` reads a sweep's
profile, and a blend has none. It shares the features' `e` names, `del`,
`hide`, `edit` and the organiser. `chainsOf` merges the blends into
`Chain.steps` by number, so a blend applies to what was made before it, and
a cut made after it cuts the rounded body. `Chain.features` stays the sweeps.
- **Evaluated by name, every rebuild.** The evaluator finds the edges by
  their names in the topology the chain made. It rounds a copy and tags each
  face the kernel made after the edge it came from (`e3.f0`), so a fillet's
  faces have names that survive rebuilds as a sweep's do.
- **A soft refusal.** A name that is gone is said and left out. A blend with
  none left is refused, and the body without it is drawn: unlike a failed
  boolean, a dropped fillet leaves a body that is right.
- **Its size is a dimension with no equation.** It is a named value that
  `set` rebuilds and undo restores. The kernel reads it off the record;
  nothing is solved.
- **Edges are picks without being entities.** A `kind: "edge"` pick is
  found through the host (`SolidsAccess`), since only it holds the kernel's
  answer. It outranks the skeleton the kernel draws in its place: twins,
  walls and whole profile members. A press on it still drags that skeleton,
  so the relational model stays the thing a hand moves.
- **Selected edges are names too**, in the selection beside the entity names
  (`Selection.edges`), pruned against the bodies on screen.
- **The preview is a trial in the chain** (`Bodies.trial`), not a model copy.
  The kernel builds the body with the blend appended (or swapped in, for an
  edit), from the cache up to it. The answer is drawn in the body's place
  until the trial ends and the body's own answer arrives.

## Nothing is negative: three algebras, one rule

The owner, on regions (docs/plans/regions-as-operations.md): *"there should be
no such thing as a negative face. a face is just a face. just like there
should be no such thing as a negative solid, only an operation which
subtracts one solid from another"*. **Things are things; booleans are
operations between things; nothing is negative.** One rule, in every
dimension:

| things | found or made | combined into | by | named | built |
|---|---|---|---|---|---|
| faces | found: a closed loop of sketch curves (loops.ts) | **regions** | `region`, `subtract`, `add`, `intersect` | `rg1` | yes |
| surfaces | made: a curve chain extruded or revolved, a face of the drawing, or a solid's face | **surfaces** | `trim(s, by, keep)`, `extend(s, edge, d)`, `knit(s, t)`, `offset`, `fillet`/`chamfer(s, edges \| t, d)`; `thicken`/`solidify` to a solid | `s1` | yes — `surfaces.md` |
| solids | made: a feature's sweep | **bodies** | `new`, `add`, `cut`, `intersect` (a feature's mode) | the body's first feature | yes (*A body is a chain*) |

Each is the same shape: a **name**, a **chain** of named operations that is
its whole membership, and an **organiser row** that shows the chain. Nothing
in any of the three is inferred from where things happen to be: a loop drawn
inside a region's outline is a loop until an operation names it, as a solid
drawn inside a body is a body of its own until its mode says add or cut.

**A face is found, never stored.** loops.ts answers what the drawing bounds;
a face is a loop's whole inside, the loops drawn inside it included. **A
region is stored, as its chain** (`RegionEntry`): its first face, then each
step, each naming its face by a member and keeping the member names it was
resolved to, which is what the face is found again by — the loop through the
member, in the region's plane, keeping the most of them. A face whose loop
has gone does nothing while it is gone.

**The algebra is of cells, and exact.** The faces a region names nest — a
crossing splits faces that would overlap (loops.ts) — so each named face is a
cell, its inside less the named faces inside it, and a face's area is its
cell and every named cell inside it. Subtract, add and intersect are set
difference, union and intersection of cells; the region's area is its cells'
summed. The nesting is asked of the geometry (`within`), not of findLoops's
tree alone, which keeps one smallest container and hands a circle in a plate
to a revolve's end face overlapping it.

**What a feature takes is the boundary**: the named faces whose cell is in
and whose container's is not, or the other way round — exactly the even-odd
profile a feature has always been built from, outline first. Where two of
them share an edge (a face added beside the region) the shared pieces cancel
and the rest are walked into one outline (`mergedBoundary`). A region in
pieces is a region; a feature on one is refused, naming the pieces.

**The record is the region's, the profile the feature's.** A feature names
the region it stands on and keeps the profile it was built to, resolved, as
it always has — the journal must not re-find a loop (*A saved file is a
journal*). Editing a region is a step that regenerates every feature on it
and journals what each was rebuilt to, `regen`'s rule. Several features may
stand on one region. A bare face is a region of one step made on the way, so
every feature stands on a region and there is one way to change what it is
made of.

**Deleting a face a region names takes the step, not the region** (the
decision this package made): the region loses the face and its features are
rebuilt without it — the hole fills. Its first face going takes the region,
as an outline's going takes a feature.

`hole`/`unhole`, explicit regions' calls, stay as typed names: aliases of the
step that gives a loop the meaning they always gave it.

**A surface is a chain too** (docs/plans/surfaces.md): `model.surfaces` holds
`s`-named records, a head (`extrude`, `revolve`, `planar`, `face`) and then
records whose `into` names it — `trim`, `extend`, `knit`, `offset`,
`fillet`/`chamfer`, `thicken`, `solidify` — and the kernel builds the chain as
a *sheet* body, a lamina shell, no inside. A trim keeps a side by a point (the
press), not by a sign: nothing is a negative surface. A knit, and a fillet or
chamfer between two surfaces, **absorb** the partner — its chain is inlined
as of the moment the record was made (`chainAt` with the record's own index),
so a later record on the partner does not reach back into the knit — and the
partner leaves the organiser as a body leaves it for a boolean. `thicken` and
`solidify` end the sheet: the chain's result is a manifold solid (STEP writes
it as a solid), and a sheet operation after them is refused, naming the
record. A surface's record keeps what it read off the drawing (its curves'
plane, the trim's keep point, the knit's tolerance), so a replay asks no
kernel to resolve anything. The equations a surface carries are dimensions
only (`surfaceDepth`, `surfaceAngle`, `surfaceDistance`, and the fillet's
`filletRadius`/`chamferSetback`), each a number a rebuild reads; the module
entries are `src/modules/surfaces.ts`, the operations `src/surfaces.ts`, the
kernel's half `src/solids/evaluate.ts` (`SheetNode` … `PairBlendNode`).

## A module is the unit

The owner: *"the whole framework should be modular and extensible (!). like
onshape workbenches"* (docs/plans/workbenches.md). Before, a tool, its
relations, its replay entry, its glyph, its group, its menu item and its help
were written into five tables by hand, beside code that knew nothing of them.
Now **a module is one file that registers everything it brings, in one call**
— `defineModule(name, spec)` in `src/modules.ts` — and every one of those
tables is filled from the modules, in load order: `TOOL_ICONS`, `TOOL_GROUPS`,
the menu's tool items and the logo menu's File items, the relation vocabulary
`replenv.ts` binds, the replay table `persist.ts` opens a file by, `help()`.
The app is eight built-in modules (`src/modules/`), loaded by
`modules/builtin.ts`, which `main.ts`, `persist.ts`, `replenv.ts` and
`menu.ts` import — so any host that opens a file or builds a command scope,
a test included, has the app's vocabulary.

**Where it sits, and why that keeps the layer rule.** `modules.ts` is in the
row above tools, operations and persist: it registers into the registries
below it and nothing below imports it. A module *file* is a manifest of
pieces that live at their own heights — a tool in `tools/`, a relation in
`relations/`, an entity kind's structure beside the model (`src/kinds/`) —
and only the registering call is up here. The replay table is still a fixed
list for any one session (whatever was loaded), so a file is still data: it
can only name a call a module registered.

**Refusals are whole.** A module naming a tool, glyph, relation spelling,
journal op or entity kind that another module has is refused with the name
and the owner, *before* anything is registered — `checkModule` reads the whole
spec first. Groups are the one thing shared on purpose: the shapes group is
the sketch module's, and any later module adds to it, members in module order.

**The entity extension point: each layer owns its facet.** An entity kind is
declared, but no one object is read by every layer, because then the model
would have to import the drawing. Instead the model owns `EntityKindSpec` —
structure only: what points it is built of, what variables it owns, whether it
is a curve, closed, carries a plane (and is straightened against a point of its
own), which relations hold a point on it, whether it bounds — and every layer
above owns a registry for its own question: `curveplane.ts` the frame a curve
is sampled by (so the renderer, box select, faces and loops take it at once),
`picking.ts` its hover line, `step.ts` its Part 42 spelling, `projection.ts`
the polyline of a kind with no frame. `defineModule` hands each its part.
`Entity` is `EntityTypes[keyof EntityTypes]`; a kind's file adds itself by
declaration merging, so every `switch (e.kind)` above the model narrows to it
while `model.ts` names it nowhere. **The proof is the ellipse**: it moved into
the sketch module (`src/kinds/ellipse.ts`, `modules/sketch.ts`) and
`model.ts`, `loops.ts`, `faces.ts`, `picking.ts` and `step.ts` no longer
mention it (a test greps them). `loops.ts` walks any kind whose frame has a
second radius as the conic piece it already had; `faces.ts` treats any closed
kind as a whole circle. Point, line, circle, arc and frame are still known by
name — the vocabulary every fast path is written in — and the registry is
asked for every other kind (vetoable, TODO.md). The kernel sees variables and
residuals, as it always did.

**A workbench is a named set of modules with its own tray.** `part` (the
default — every built-in, today's tray exactly) and `sketch` (no solids, no
STEP). The tray and the menu's tool items are the current workbench's tools;
**a typed name is not filtered**, because a typed call is not a toolbar. A
module no workbench names (typed at the command line) is on every tray, as a
typed tool is. The workbench is the document's — written in a saved file's
head (format 16) and read back — but not the journal's and not the undo
snapshot's: switching is no edit to the drawing, so it is no undo step,
exactly as the camera is not.

**A pane can be a module.** The constraints palette
(docs/plans/constraints-palette.md; the owner: *"it should be a separate
constraints palette. although i think it should still be installed as a
workbench"*) is a panel like the organiser — titled, docked, dragged,
remembered, in the app menu's Panes — and a module, `constraints`
(`src/modules/constraints.ts`), that registers nothing but its help. What
the module does is put the pane on a workbench: `part`, `sketch` and
`surfaces` name it, and a workbench that does not has no palette — out of
the layout, out of Panes, `ui({ show: "constraints" })` refused by name
(`Panels`' `present`). The pane itself stays the host's, as the organiser's
does: `main.ts` builds it, from the model, the selection and the last
diagnosis, through `src/constraints.ts`'s pure `paletteFor` and a thin DOM
half, and the panel manager is told three things it did not know before —
a pane that is `present` only while a predicate holds, one that starts
hidden (`startHidden`: on a phone the pane is a third of the drawing, on a
desktop its place is drawing people click in), and one `summoned` while a
predicate holds (the constrain tool armed) although hidden. All three are predicates the host hands in, so
`panels.ts` still imports nothing from the model or the tools. The
constrain tool is the way to pick by clicking and nothing more: its picks
reach the palette as names (`Tool.related`), and its options pane lists the
relations only where the module is off the workbench.

**Add workbench… is the paste rule with a file.** A workbench file is one
`.zerocad.js` whose top is a manifest comment saying what it registers. The
app reads the manifest *without running the file*, shows it, and asks — that
is the consent, as pasting a tool's source is (below). Accepted, the file runs
once in the command line's scope, which is curation and not a sandbox (and the
question says so), and `defineModule` refuses a module that registers anything
the manifest did not show before registering any of it. It is kept in
IndexedDB beside the autosave and loaded at every start until removed; Share
hands the stored text back. A document records the added modules its journal
uses — read off the ops at save time, so it is never stale — and opened on a
device without one, `fromSaved` leaves out those steps and what named their
results, opens the rest, and the host says which workbench is missing and
offers the picker. Never a hung open: the rest of the model is intact.

## A second curve kind: what the ellipse needed

(The list below is what the ellipse touched when it was hard-wired. The
entity extension point — "A module is the unit", above — now carries items 1,
3, 4 (its frame), 5, 7 and 8's writer through a declaration; the rest still
name it, TODO.md.)

The ellipse (docs/plans/sketch-shapes.md) is the first curve that is not a
circle, and it went through every seam a curve meets. Listed, so the spline
(`spline.md`) can follow the same list instead of finding it again:

1. **The entity** (`model.ts`): its points among `refsOf` (so `del` of one
   takes it), its own variables (a minor; a normal in 3D, through
   `normalSeed`), the construction flag, `oriented` (centre and normal for
   `normalOf`, `setNormal` and the plane questions — an ellipse is a plane
   reference), and the exhaustive `switch`es TypeScript then names (`ls()`,
   the hover tag, a glyph's default anchor, the painter's depth).
2. **Relations** written through `dot` so they hold in 2D and 3D, each with
   the circle's plane block in 3D, and **dimensions** for its numbers: their
   op in `DIMENSION_OPS` and `VALUE_ARG`, a `REBUILD` row for `set`, a label
   in `glyphs.ts`. Every relation in **both** `replenv.ts` and `persist.ts`.
3. **A frame to sample by** (`arcgeom.ts`, `curveplane.ts`): `curveFrame`
   answers for it, and every consumer that samples through `arcPoint`,
   `arcSamples` and `portionAngles` — the renderer, box select, faces, the
   feature preview — drew it at once. What had to change in each was only the
   sample count (`frameReach`, the larger semi-axis).
4. **Picking and snapping** through `projection.ts`: a screen polyline (what
   `intersect.ts` already crosses) and a lift back onto the true curve —
   Newton on the projected parametric form. Snapping then needed nothing,
   and inference one row in `place.ts`'s `onCurve`.
5. **Regions** (`loops.ts`): the arc piece took a second radius and a
   direction, so every function that walks, slices, measures or winds a
   piece reads one; the crossings needed their own (closed form with a line
   in the curve's normalised axes, numeric with another conic), and
   `heldOnCurves` the curve's on-relation.
6. **Features** (`operations.ts`, `relations/extrusion.ts`): the twin of a
   whole member, what the depth holds of it (its own variables), and the
   refusals — part of one, and a revolve.
7. **Drawing a solid** (`faces.ts`): nothing but `hasVertices` — a closed
   curve has no corner for a wall line.
8. **The exact B-rep and STEP** (`solids.ts`, `step.ts`): a `Curve` and a
   `Surface` kind and their Part 21 spelling, the surface's own normal for
   `same_sense`, `roleSurface` saying there is no analytic surface where the
   kernel's NURBS should be written instead, and `looseCurves`.
9. **The solid kernel** (`src/solids/`, `scripts/solids/glue.cpp`): a profile
   member it can take exactly — the contract grew a `nurbs` member, so the
   spline will need no further change there — and the profile helpers
   (`distanceTo`, `memberPoints`) that naming and insideness read.
10. **The chrome**: a tool in the group the table names (`TOOL_GROUPS`), its
    icon, its import where the group's button should stand, a menu item, the
    quiet set (which of its points are on the curve), `help()`.
11. **The file format**: a version, its saved values, and the old-file test.

What did *not* need touching is the point of the layer rule: the kernel, the
engine, the undo stack, the organiser, groups, selection — none of them knows
what kind of curve anything is.

**The spline followed the list through the extension point**
(docs/plans/spline.md): items 1, 3–5, 7 and 8 went through declarations — a
**path** facet in `curveplane.ts` (`defineCurvePath`: a kind that *is* an
exact B-spline, which drawing, picking, box select, regions, faces, the exact
B-rep and STEP each read), `EntityKindSpec`'s `closed` as a function, `ends`,
`through` and `owns` — and `model.ts`, `loops.ts`, `faces.ts`, `picking.ts`
and `step.ts` never name it (the same grep). Item 9 needed nothing: the
ellipse's `nurbs` member carries the spline exactly. Items 2, 6, 10 and 11
still name it, as they name the ellipse.

## An entity can own its equations: the spline

A circle's radius is a variable and nothing more; every equation on a circle
is a relation someone put there, named, listed and deletable. **A spline is
the first entity whose definition is equations**: its control points are its
own variables, and the rows that make the curve pass through its points (one
per point, linear in the control points, and the natural ends or the closed
seam's smoothness) are what make it a spline and not a cloud of control
points. They are not relations on it, so they are not relations:

- **Made with it.** `addSpline` adds the entity and its rows together —
  `problem.addResidual` straight, the one place a block is added outside a
  `model.relation` body on purpose — and keeps their handles on the entity.
  `EntityKindSpec.owns` declares them.
- **Gone with it.** `deleteEntity` removes the blocks a kind owns before the
  entity. The cascade is unchanged: deleting a through-point takes the
  spline (its `refs` are its points), which takes its rows; deleting the
  spline takes the relations naming it (`onspline`, `tan`) and leaves its
  points. No row can be deleted alone, because a spline without one is
  malformed — exactly what the primitives refuse to leave.
- **Journalled once.** The file says `addSpline(points, closed, name)`; replay
  re-makes the entity and its rows in one step, and format 18 saves the
  control points' values (`values.splines`) so a file opens at the solution
  it was saved at, as every other variable does. Re-pointing a spline —
  `addThrough`, `removeThrough` — is an operation (it changes what the entity
  is built of), journalled as its call with what it read off positions
  resolved beside it, and `respline` swaps the rows.
- **Diagnosed as held.** The control points' variables count among the
  entity's (`vars`), so `diagnose` sees them fixed by the rows and reports the
  through-points as what is free — the user's question.

**A relation can own variables too.** `onspline(p, s)` needs a parameter σ —
where along the curve p is — that belongs to no entity. `Model.relationVar`
makes one inside a relation's body and the relation's entry keeps it
(`RelationEntry.vars`): deleted with the relation, counted by `diagnose`,
saved (`values.params`) so the point does not jump to the nearest root on
open. Outside a relation body it is refused: a variable nothing owns is one
nothing would ever delete.

Rejected: the interpolation as an ordinary relation (`interp(sp1)`) — it
would be in `rels()`, deletable, and a deleted one leaves free control
points that draw a curve through nothing; and the control points as hidden
point entities — they would be in `ls()`, pickable and draggable, and a drag
of one would fight the rows that hold it.

## What a trim leaves: the elliptical arc and the spline of control points

The owner: *"Also need trim for sketch entities"* (docs/plans/trim-everything.md).
A trim is an operation: it re-points and makes entities. What it could not
do before was say what a piece of an ellipse or a spline *is*, because
neither piece is the kind it came from. So two kinds came in through the
extension point, as the ellipse and the spline did, and `model.ts`,
`loops.ts`, `faces.ts`, `picking.ts` and `step.ts` name neither (the grep
in `test/modules.test.ts` covers them).

**The elliptical arc (`earc`) is an ellipse with two ends.** It has the
ellipse's centre, major end, minor variable and normal, and a `start` and an
`end` it runs between, counter-clockwise about its normal as an arc runs. A
trimmed ellipse becomes one **under its own name**, as a trimmed circle
becomes an arc, so `major`, `minor`, `conc`, `tan` and `onellipse` read the
same variables (`ellipseOf` answers for either conic). Its ends are held by
two `onellipse` relations, an arc's `arcends` said twice. A trim at one end
carries the old end's hold to the new end, rebuilt in place under its name.
A piece out of the middle leaves a second elliptical arc about the same
centre and major end, held `eqrad`, which now says equal semi-axes for two
conics. Sharing the minor variable between the two was rejected, because
`diagnose` would count it twice.

**Its frame is the ellipse's, started late.** A conic's parametric form
needs its two axes square to each other, so the frame cannot be turned to
start at the arc's start the way a circular arc's is. `ArcFrame` gained `t0`,
the start's eccentric anomaly, and every parameter `arcgeom.ts` takes or
gives is still measured from the start: `arcPoint(f, 0)` is the start,
`portionAngles` answers from it, and `sampleAngle` spaces the samples by the
normal's turn between the two ends. So every caller that walks a frame from
0 to its sweep (drawing, box select, faces, the projection's lift) walks an
elliptical arc unchanged. The few that read an angle off a point
(`sketchgeom.ts`, the extend tool's preview) subtract `t0`, and `loops.ts`
lays the piece out from it. A conjugate-diameter frame that starts at the
start was the rejected alternative. It is not orthonormal, and every
consumer projects onto `u` and `v`.

**The spline of control points (`bspline`) is the piece of a spline,
exactly.** The piece of an interpolating spline between two parameters is no
interpolant of any points of its own, but it is exactly a clamped cubic
B-spline: insert each end as a knot until it is whole (Boehm, `subCurve`).
So it is that: ordinary points for its control polygon, its first and last
the two ends (the curve passes through them because it is clamped), and the
knots it was cut with, as fixed numbers. It **owns nothing**, neither
variables nor equations. Its control points are the user's, as a line's
points are, which is Onshape's control-point spline, and the dashed polygon
drawn through them says so. The control points as owned variables were the
rejected alternative, because no hand could reach them. A trimmed spline
becomes one under its own name. `onspline` and `tan` read either kind
lazily, so a `tan` at the end the trim kept holds unchanged. An `onspline`
is re-made, because its parameter was a fraction of the old domain. A closed
spline needs two cuts and opens across its seam: the two halves are joined
end to end, and its first point stays a control point at a triple knot, on
the curve.

**A replay runs on seeds, so the piece is journalled.** The knots of an
interpolant come from where its points are, and a replay reaches the trim
before the saved values put them back. So `trim`'s resolved cuts carry the
pieces made, `[lo, hi, [{ knots, ctrl }]]`. The replay makes exactly those
knots and control points, and the saved values then put the points where
they were saved. Every other trim's entry is unchanged.

**Power trim is typed, not a new operation.** A stroke's pieces are found
against the drawing as it was at the press, each one red as it is crossed,
and the release types `trim(…); trim(…)` as one entry, so one undo step and
nothing new in the journal. Names are the hard part, because a middle trim
gives the far part a new name. A trim keeps the curve's name on the part
from its start, so one curve's pieces are typed from its far end back.
Each name typed is then the curve the piece is on when its turn comes. A
closed curve is ordered from the cut its first trim opens it at.

## Constraints are drawn, and a drawn constraint is a thing you can click

Every relation wears a small mark beside the geometry it constrains. The tiers
that decide what a click means put those marks **above everything else**,
including points — which until then won outright. The reasoning is the same one
that makes a point beat a line it sits on, only stronger: a mark is small,
deliberate to aim at, and only ever on screen because something put it there,
so a mark you cannot click because a point wandered near it defeats the whole
feature.

**Snapping does not consult them.** Picking and snapping have mirrored tiers
and it would be easy to keep them mirrored here too, but a glyph is UI rather
than geometry and nothing should ever be *placed* at one.

A glyph pick travels as an ordinary `Pick` with `kind: "relation"`, not as a
parallel type. Everything downstream of a pick — the hover tag, the highlight,
dropping a name into the command line — wants to do the same thing with a glyph
as with a point, so a second type would mean writing every one of those paths
twice and keeping them in step forever.

The placements come from `glyphs.ts`, which computes and does not draw. Two
rules cover all of it: **anchors are world-space and offsets are screen-space**,
so a mark follows its geometry through a solve while staying a constant number
of pixels off it at any zoom; and **there is no layout engine** — marks sharing
an anchor stack in a row and everything else is left to crowd, with
`glyphs(false)` as the escape hatch. That is not laziness so much as a
preference between two failure modes: honest label layout has to move marks as
the model solves, and a mark that jumps about while you drag is worse than one
that overlaps its neighbour and stays put.

**A dimension's value is one of those marks.** `dist`, `rad` and `ang` draw
their target — `50`, `R22`, `30°` — where their generic symbol would have gone,
read out of the relation registry's `args`. Two things follow from that being a
glyph rather than a dimensions overlay. First, hovering, picking, highlighting
and `glyphs(false)` all work on a dimension without a line of code, because
they are not written twice. Second, the only thing the label needed that a mark
did not is a box the width of its text — so `Glyph` carries its own half-extents
and `glyphAt` reads them, rather than every glyph being an 18px square. The text
width comes from a constant, because `glyphs.ts` has no canvas and having one
would end its testability; an end-to-end test measures the browser's real
monospace advance against that constant so the assumption cannot rot quietly.

With no tool armed the left button has four meanings, decided by what it landed
on and whether it moved: press a point and move, and the point is dragged with
the model following it; press *empty canvas* and move, and a selection box is
dragged out; press any other geometry and move, and the view pans; press and do
not move, and whatever is under the cursor has its name put into the command
line. The hit-test happens once, at press time — from the first frame of a drag
the geometry is moving under the cursor, so re-asking what is beneath it would
hand the drag to whatever the drawing swept past.

Empty canvas used to pan, which was cellwork's habit and is written into the
decision register as such. It was reversed deliberately: SolidWorks and Onshape
both make that gesture box select, and the standing rule that tools work like
Onshape outranks a register entry inherited from the prototype. Panning lost
nothing by it — middle-drag, right-drag and `pan()` all still panned — while
gaining a gesture every CAD user already has in their hands. (Right-drag has
since become the 3D orbit; see below.)

A box is **a multi-click and nothing more**: every name it catches goes down
the same path a single click's name does, into the command line, quoted and
comma-separated. That is what keeps the "no selection set" decision intact
under a feature that in most CAD *is* the selection set. Constraint glyphs are
not box-selectable, and it takes no code to say so — relations live in a
registry beside the entity map rather than in it, so a box never sees them.

The **right** button makes the same split, on the same threshold: past three
pixels it **orbits** the view (in a 3D model — Onshape's right-drag; in a 2D one,
with nothing to turn, it pans as it always did); released where it landed it
opens a context menu. The press decides nothing and the release decides, which
is the only arrangement under which a menu can be added without taking a
gesture away — it held through the gesture itself changing from a pan to an
orbit. Middle-drag is left purely navigational, because one button that
unambiguously means "move the view" is worth keeping, and it is now the pan.

## The context menu only ever types

`menu.ts` builds a menu out of a model and a pick, and every item on it is a
**command string**. Nothing on the menu calls into the model; choosing an item
hands that string to `submit` — the function the Enter key calls — and the app
behaves as though it had been typed, because it was.

That is a stronger claim than it sounds. Logging, the command recall history,
the undo bracket and the "re-solve if this changed anything" comparison all
live in `submit` and nowhere else, so an item that reached the model any other
way would be a second, slightly different answer to what running a command
means — and the two would drift, one bug at a time. Going through `submit`
means there is nothing new to get right: a menu-typed `dist` is one journal
entry and one undo step because a typed `dist` already was.

The rejected alternative is worth naming, because it is the one that needs no
change to `main.ts` and is therefore tempting: write the text into the command
input and dispatch a synthetic Enter. It reaches the same function by
pretending to be a keyboard, which destroys whatever was half-typed, hides the
seam from anyone reading the menu's code, and breaks the first time the input's
key handling changes. One named hook passed in from the host is smaller and
says what it is.

The split inside the file follows from that. `menuFor(model, pick)` is pure —
model and pick in, labels and command strings out, no DOM anywhere near it — so
"which items for which pick kind" and "what does Dimension type for an arc" are
unit tests. The DOM half is a `<div>` in the hover tag's visual family, and it
shows each item's command beside its label: the menu exists to be a shortcut
*to the command line*, and an item that hid what it was about to do would be a
fourth editing surface rather than a faster way to type.

**An item may also type a command it cannot finish.** Set value… on a dimension
glyph puts `set("d4.value", ` in the command line and stops, for the user to
supply the number. That is the only shape available under the rule above — a
menu that popped its own number prompt would be the fourth editing surface the
rule exists to prevent — and it needed a third action kind rather than reusing
Insert name, because a partial command *replaces* what is being composed where a
name appends to it. `dist("p1", set("d4.value", ` is not a thing anyone was
typing. The item shows the unfinished text beside its label, so it cannot look
like it is about to do more than it does.

Two consequences of the "no new machinery" rule are visible on the menu itself.
A **dimension carries the current measurement**, so it holds what it measures
and moves nothing — which also means a point gets no Dimension item, because a
point has no measurement of its own. And **Fix is shown disabled when there is
no default frame**, carrying `resolveFrame`'s own message: creating a frame to
make the item work would be a datum nobody chose, quietly becoming what every
later `xaxis()` means, which is the exact thing the no-world-frame decision
prevents. A menu that cannot do anything a command cannot do also cannot do
that.

## The chrome floats, and its layout is the viewer's

The canvas is the whole window — there is no title bar
(docs/plans/chrome-logo-scale.md) — and the toolbar, the log and the command
line are panels over it (`panels.ts`). Nothing in the page reflows the drawing
any more — the log used to, taking height from the canvas as it filled, which
moved "the middle of the view" under every command that seeds there. The logo
in the top-left corner is the one thing that does not move: it is in the
layout as a fixed panel, so pushes stop against it, and it opens the app menu
(`appmenu.ts`), which like every menu only types.

**The layout's area is the safe area**, and a panel touching an inset edge is
*drawn* reaching under it with its content padded (`bleed`) — drawing only,
so no rule of pushing or turning knows insets exist. **A moved panel is
stored as what its sides rest against** (`dockingOf`), and re-laid by that in
whatever area there is (`relaid`): a rotation keeps docking, not pixels.

**One interface size, read in one place** (`main.ts`'s `uiScale`, the
device's 100 % from `uiscale.ts` times the viewer's multiplier): the panels'
`Metrics`, the stylesheet's custom properties, and `View.ui`, which everything
drawn in the viewport for a person to read is multiplied by. A finger's
controls are drawn at that size and hit at 44 px (`touchMetrics`, index.html's
`::before`s); picking's reach is never scaled.

**A toolbar button is a context-menu item with a fixed place on screen.** It
types `arm("name")` through `submit`, for every reason in the section above,
and it is built from the tool registry when drawn rather than from a list kept
beside it — so the extensibility claim ("tools are not privileged") reaches the
toolbar too: a tool defined at the command line has a button.

**A tool's options panel is the same rule again.** A tool declares what it can
be armed with (`static options`, `src/tools/options.ts`), and the declaration
is the one source: `ToolEngine.arm` checks and fills from it, `tools()` lists
it, and while the tool is armed a small panel beside the tray is built from
it — a field edited there types `arm("extrude", {depth: 25})` through
`submit`, so the panel can do nothing a typed line cannot, and a line typed by
hand shows in the fields. The values a viewer last armed with are remembered
as their defaults, per viewer, beside the layout and under their own key, for
the reason layout is: a preferred depth is a fact about the person, not the
drawing. The panel comes and goes with the tool, so it is the one panel
`Panels` hides; sized by its rows as the tray is by its buttons, it has no
grips, and it is placed after every other panel so that it is the one moved
out of the way.

**The constraints palette is a pane, not a tool pane**
(docs/plans/constraints-palette.md). The constrain tool's list of relations
lived in that options panel until the owner asked for *"a separate
constraints palette"*: it was up only while the tool was armed, and on an
iPhone it covered what had been picked. The palette is a panel like the
organiser — grips, a stored place, Panes — and it lists for the selection
too, with nothing armed. It starts hidden, everywhere: the constrain tool
summons it while armed, and a viewer who shows it from Panes keeps it.
Where it is placed is the one thing device-shaped about it: a desktop's
right edge above the organiser; an upright phone's bottom, above the
command line; a phone on its side, the left under the logo.
A phone's rows are a target tall and a strip's hit box reaches a target up
over the drawing, so the pane is sized to three rows there, and where its
rows do not fit the likeliest show and a *more…* row opens the rest —
measured against the pane's real height on each build, so a pane the viewer
made taller shows more.

No button is greyed. One used to be, for a tool the model could not run;
since every tool makes what it needs and answers a click it cannot use with
guidance, the toolbar no longer asks `toolUnavailable` at all.

**Layout is not model state.** Where a viewer keeps their log is a fact about
their screen. It lives in `localStorage`, every touch wrapped — a private window
throws on the first one — and never reaches the journal, a saved file or the
undo stack. Only the panels a viewer has touched are stored; the rest follow
their defaults, and what is drawn is always the stored-or-default rectangle
passed through `constrain` against the window as it is now — which holds every
panel **wholly** inside it. So shrinking the window pulls panels in without
forgetting where they were put.

**A tray turns with the edge it meets.** The toolbar is a tray: dragged within
a few pixels of a horizontal edge — the area's top or bottom, or the facing
edge of a panel it is beside — it becomes a row; of a vertical one, a column;
of both (a corner), it stays as it is. The rule (`orientationFor`, `turned`) is
pure arithmetic in `panels.ts`, and the orientation is stored with the
rectangle, in the same per-viewer layout.

**Any corner resizes — but a tray never does.** The log and the command line
have a grip on each corner, which draws nothing (the cursor is the
affordance); `resized` moves that corner and its two edges and leaves the
opposite corner where it was, through the same resolver as everything else.
A tray has no grips: **its size is its buttons'**, one line of them
(`traySize`), and nothing the viewer does sets it — a stored tray keeps its
position and orientation and has its size recomputed from the count every
time it is placed (`arranged`), so a tool defined at the command line makes
it one button longer wherever it is. (For an afternoon a tray could be
shortened and wrapped its buttons into more lines; the owner reversed it.)

**A dragged pane takes its place among the others; nothing is shoved**
(docs/plans/panels-reshuffle.md; the owner: *"When I push toolbars around,
they should be able to reorder with other toolbars. So reshuffle rather than
push."*). The panes along each edge are **a sequence**, and a drag by the
strip is resolved against it (`reshuffled`), not by pushing: along an edge
the pane was on, past a neighbour's middle it takes that neighbour's slot (a
dock's reorder: the stretch laid out again in the new order, its ends and
gaps kept); brought to another edge it is inserted between the two it lands
between, and those after it make room; dropped on a pane that is on no edge
the two trade places; elsewhere it lands where it is put, or flush against
what it would lie on. An edge with no room takes it on a second line. **The
others make room**: any pane the held one, its line or a trade now lies on
goes to the nearest place on nothing (`madeRoom`), the push below the
fallback, then every unkept pane laid again round the kept ones; only where
none of that finds room — the panes cannot all be had at their sizes — is the
preview refused, said on the held pane's ghost. Along the top the corner is
the logo and the status's least room (`cornerBox`), so a pane let in there
never leaves the status a sliver.
**The sequence is read, not stored**: each press reads it from where the
panes are (`sequences`), and the layout is stored as before — so the order a
viewer made is the order of the positions they left, and a layout from before
reshuffling reads into the same order with nothing to migrate. The push below
stays for what has no order to change: a resize by a grip, and `apply`
making a stored or grown layout sound.

**Panels never overlap, and what is left of the push.** A resize, a turn and
every `apply` go through one pure resolver, `pushed` (a drag by the strip did
too until the reshuffle above): the
mover goes where it wants along each axis of the pointer's move in turn, and
whatever its swept rectangle covers is put flush ahead of it along that axis,
in a chain. The window edge is the one thing that does not move: a chain that
would cross it pulls the mover's travel back by exactly the overshoot, so the
mover stops flush. Each axis on its own, rather than everything along the
larger, because a hand never drags quite straight and a pixel of drift into a
panel must push it a pixel, not throw it sideways. **The grab is fixed at the
moment the panel is taken** (the owner: *"the grasp point should stay the
same"*): a panel stopped short stays where it stopped while the pointer goes
on, and moves again only once the pointer comes back past where it left the
panel — exactly under the hand where it was grabbed. Only a tray that turns
changes its grab, to the same point of its new shape. Under the dev server the
DOM half reports any overlap it shows as a page error, which is how the e2e
suite asserts the invariant over every gesture it makes rather than only the
ones it measures.

**Nothing moves until the drop** (docs/plans/panels-preview.md; the owner:
*"they should show how they will snap IF the user drops the grasped toolbar
in that spot. but until they actually drop it, the permanent position of any
tool bar is not changed"*). A gesture keeps two things apart (`Drag`): the
**preview, which is the drop at this spot** — the resolvers above (the reshuffle for a strip, the push for a grip) asked for
one step, from the layout at the press straight to where the hand is, so it
is a function of the spot and not the path, the rules have one
implementation, and the preview cannot disagree with what a drop commits —
and the **held panel**, drawn where the hand has it (`heldAt`) and placed
nowhere. Every other panel stays put, at half opacity, with a translucent white ghost
where the drop would put it (`ghostsOf`); a tray's turn is the preview's
until the drop. The drop commits the preview in one step (`dropOf`) and the
panels glide onto it (the rectangles final at once, only the drawing
catching up). Escape, a lift back at the press and a refused preview commit
nothing — the start is the layout at the press, which no move touched, so
there is nothing to undo. Every preview is checked by `layoutProblem` as a
shown layout is, so "nothing overlaps" holds for what the ghosts show too.

**See-through is a form per pane, not a transparent box**
(docs/plans/panels-overlay-lock.md; the owner: *"like how the feature tree in
solidworks changes form when it is overlaid over the viewport vs being in a
pane on the side"*). With `panels({ overlay: true })` the layout is the very
same rectangles — so every fit rule holds unchanged — and each pane draws
its content in a form of its own inside its rectangle: a tray its buttons
alone, the organiser a tree hugging its corner (`organiserTree`, built from
the sections the docked pane draws, so the two cannot disagree), the log its
last three lines (`logtail.ts`, read off the docked log's own stamped lines),
the command line its input on an underline. **Only content takes a press**:
the box is `pointer-events: none`, so the drawing has every pixel between.
A thin halo in the drawing's ground keeps text legible on a light face as on
the dark ground — measured from the pixels, not chosen by eye. A mouse over
a pane gives its box back under the same content; a press on its content
brings its docked form until the next press outside. What is read and typed
into — the options panel, the menus, the flyout, the tooltip, the chip —
never goes see-through. **The lock is a property of the drag**
(`beginDrag`'s `locked`): the preview stays the start and the drop commits
nothing, so the gesture takes the path it always took and the rule is the
pure half's; the strips and grips are simply not drawn. The resolver still
runs under a lock — a rotation that leaves the layout unfittable is
re-fitted, said, and not stored — because the lock is against a hand, not
against the window. Both switches are the viewer's, stored beside the layout
under their own key, never journalled.

**Gestures never cross**, and it takes both halves: a panel captures the
pointer on its strip or grips, and the host captures it on every canvas press.
The engine already captured drags, boxes and pans, but not an armed tool's
gesture — harmless while the chrome sat beside the canvas, and a rectangle that
never finished once a panel could sit on top of it. The capture lives in
`main.ts` rather than the engine because it is a fact about the page (there are
things over the canvas), not about gestures.

## The REPL is scoped, not sandboxed

An entry runs inside a `with` block over a Proxy whose `has` trap claims every
name. Nothing falls through to `globalThis`, and the `get` trap throws
`no such name: modle` rather than quietly returning `undefined`.

**This is curation, not a security boundary**, and the distinction matters
enough to repeat in the source. It exists so an entry sees a small documented
surface and so typos are caught. Code typed there still runs with the engine's
own authority. Genuinely untrusted code would need a worker or an iframe,
which is a different feature with a different threat model.

Two consequences of using `with`, documented rather than smoothed over:

- a bare assignment (`box = ...`) persists to later entries, because the
  Proxy's `set` trap catches it;
- a `const` / `let` / `class` declaration does **not**, because it binds to the
  entry's own function scope.

## A clause is a call not yet made

`pt(on(_, "l1"), on(_, "l2"))` defines a point by two relations in one
expression. A relation given `_` returns a **clause** — its name and its
arguments with `_` still in, plain data — and a constructor fills `_` with what
it made and calls the relation by name (`src/clauses.ts`, wired in
`replenv.ts`). So a clause expression *is* its expansion: every relation
journals as itself, and the model, the relations and the file format never
hear of clauses — which a test checks by saving both forms to the same bytes.
That is also why undo needs nothing: a submitted line is one step however many
relations it makes.

The one thing it adds below the surface is a **slot list per relation
binding**, saying where `_` may go (`#` marks a number). Everything checkable
is checked before the entity is made — the `del` batch rule — except a
relation's own refusal while applying, which is the model's to make and is
passed on with what was already made named in front of it. `repl.ts` shows a
clause through Node's `inspect.custom` convention, so the evaluator still
imports nothing from the surface it evaluates.

## A saved file is a journal

A model cannot be serialised directly: a residual block holds a closure, and
closures do not survive JSON.

What does survive is the sequence of calls that produced them. So `Model`
keeps a journal — every entity created, relation applied, operation run — and
a saved file is that journal, replayed on open.

The pleasant consequence is that the save format is a *transcript of the
public API* rather than a second description of the model's internals that has
to be kept in step with them. Anything you can type, you can save.

Two details:

- An operation is journalled as the single call the user made, not its
  expansion, so `fillet("l1","l2",8)` is one line and re-expands on replay —
  and only once it has *succeeded*: an operation refuses before it changes
  anything, and a refusal leaves no entry behind (one used to, and the file
  saved after it then failed to reopen at that step).
- Solved coordinates are stored alongside and restored after the replay.
  Replay alone reaches *a* valid configuration, but an under-constrained model
  has many, and reopening a drawing should give back the one that was saved.
- Which means **a replay runs on seeds**, and an operation whose expansion
  depends on where things *are* would re-expand differently. `fix` and
  `fillet` already journal the default frame they resolved for that reason;
  `extrude` journals the loop it resolved — its members, loop by loop — because
  a profile built from free lines and relations has no loop at all at its
  seeds. The call is still the call (the user typed two arguments); the journal
  writes in what the call meant at the time it was made. A `fillet` that
  regenerated a feature, and `regen`, write in the profiles they found the same
  way. `revolve` does the
  same, and goes one step further for the same reason: its refusals that read
  positions — the axis in the profile's plane, the profile on one side of it —
  are made by the call and the tool and never by a replay, which would be
  reading seeds.

Opening only performs calls from a fixed table, so a file is data rather than
a script. That table is a `Map` — a plain object answers a lookup for
`"constructor"` from `Object.prototype`, which let a hostile file straight past
the guard.

## A file carries its tools' source, and the paste is the consent

A tool authored at the command line is a class over its module, so it is
exactly as unserialisable as a residual block. What can be written down is what
was written down for the model: **the text the user typed**. So a saved file
carries an optional `tools: {name, source}[]` beside the journal, and every
word of it is inert. `open()` replays geometry and evaluates nothing; it says
what the file carries, `toolSource(name)` prints one, and pasting it back is an
ordinary entry that a person read before pressing Enter. There is deliberately
no button that runs it for them — that would make a file a script again, which
is the one thing the section above is for.

**Where the capture lives decides most of it.** The entry text is known only to
`repl.ts`, and `repl.ts` must stay as ignorant of tools as `problem.ts` is of
points; what a tool *is* is known only to the command surface. So the evaluator
publishes a plain fact — `repl.entry`, the entry in flight — and the host wires
it to the command surface through the `currentEntry` handle, the same shape as
`openModel` and `solve`. Capture is then a wrapper around `defineTool` in
`replenv.ts`, and two properties come from that position rather than from a
check: a built-in registers from its own module and never passes through the
wrapper, so built-ins are never captured; and a `defineTool` reached any other
way has no entry in flight, so nothing is recorded.

What is stored is the **whole entry**, because an entry may build helpers around
its class and slicing out the class expression would be both a parser project
and a lie about what ran.

**This is session state, and the type system is not what keeps it out of the
model.** `tools` is a *parameter* of `save`/`toSaved` defaulting to none, and
the only caller that passes any is the `save()` a user typed. `main.ts`'s undo
snapshot is `save(model, false)` — so a tool definition cannot register as an
edit to the drawing, and it takes no enumeration of "which commands are edits"
to arrange, which is the same trick the undo bracket already plays.

`toolsource.ts` holds the store and two rules that only matter when names
collide: a definition this session watched wins over a file's version of the
same name (the store then matches what is actually registered), and opening a
second file drops the first file's carried sources (they belonged to a drawing
that is no longer open, and carrying them into the next `save()` would smuggle
one file's tools into another's).

## Undo is the save format, on a stack

Because a saved file is a journal *plus* the solved values, it is also a
complete description of a state to come back to — so undo is a stack of them,
and restoring one is the same code path as `open()`.

The clever alternative is worth naming so it is not rediscovered: undo a
structural change by truncating the journal and replaying. It cannot work on
its own, because the changes that are not journalled are exactly the ones a
user makes most often. A drag changes values and records nothing (deliberately
— see above), so a truncating undo would need value snapshots as well, and two
half-mechanisms cost more than one whole one.

**What counts as one undo step is a question about the interface**, so it is
answered in `main.ts` and nowhere lower. The answer is one comparison —
snapshot before the action, snapshot after, record a step only if they differ —
which means nothing has to enumerate which commands are edits. `ls()` stays out
of the history because it leaves the model identical.

This is also why the tool engine gained `onUserAction("before" | "after")`
rather than anything named after undo. The engine is below undo in the layering
and must not know it exists; what it reports is the neutral fact only it can
see, that a gesture began and a gesture ended. The engine does own the
*pairing*, because it alone knows every way a gesture can end — released,
cancelled, or abandoned when the model is swapped out mid-drag — and a `before`
without its `after` would strand the host's bracket with no visible symptom
until the next action went unrecorded.

## Why there is an end-to-end suite

Seventy-six bugs so far were invisible to the unit tests and obvious within seconds
of running the app:

1. a status readout that went stale, so a conflict could be introduced from
   the command line while the header still read `SOLVED`;
2. a fillet that satisfied every constraint to six decimals while drawing a
   visibly broken rectangle;
3. an auto-naming loop that had been able to spin forever since the beginning,
   and hung the tab the first time anything handed out names out of order;
4. a pan that silently did nothing mid-gesture, because a second mouse button
   pressed while one is held arrives as a `pointermove` and never as a
   `pointerdown`;
5. Escape, bound to the command input, which a mouse press on the canvas
   blurs — so the one key that abandons a gesture was deaf during every
   gesture. It passed every test that existed, because each of them picked
   something first and picking re-focuses the input.
6. A wall sketched square-on whose last corner snapped to a floor vertex
   seventy units *behind* the pixel aimed at — the two shared a pixel — so
   the wall's edge ran diagonally out of its own plane with every relation
   satisfied. Found by looking at a screenshot of the 3D package's poster.
7. A solid's lid, sorted by its centroid, drawn *before* the far wall of its
   own hole at a grazing angle — so the wall painted over the lid wherever it
   showed past the opening. Every face was the right shape and the right shade;
   only the order was wrong. Found by looking at the extrude package's
   screenshots.
8. A panel's grab taken in window coordinates while its layout is in the
   canvas area's. Harmless while the grab was re-based on every move — the
   header's height cancelled out — and wrong the moment it was held for a
   whole gesture: a turning tray carried the header's 32 px along its strip,
   and refused a turn it should have made. Every unit test passed, because
   the pure half has no header; the e2e turn against the log's right edge
   failed on the first run.
9. The Delete key deleting the selection from an *empty* command line. The
   unit suite has no keyboard; the first e2e run had Playwright's `fill("")`
   — which sends a Delete to a line already empty — delete half of each
   test's drawing, and the hand does the same: empty the line, press Delete
   once more. The key is now never a focused text field's to give away.
10. A long-press that opened the context menu and then, on the lift, pressed
   the menu's first item. The browser makes up a click after a touch and
   hit-tests it where the finger lifts, which is on the menu that had just
   opened under it. The unit suite has no browser to make up clicks; the
   first iPhone-emulation run found it, and only with a tool armed, where the
   menu happened to open under the finger. The engine now cancels the
   canvas's `touchend`, the one way to stop that click.
11. The origin's triad, drawn after every frame, covering a user's frame made
   at the same spot with the same axes — `frame()` in a fresh view lands
   exactly there — so hovering that frame lit it amber underneath an
   unchanged red, green and blue. Picking was right and every unit test
   passed; the tooltips suite's pixel reading of a lit arm failed. The origin
   is drawn first now, under everything.
12. The empty-canvas words written straight across the origin's triad and its
   label, which a fresh view puts at the middle. Nothing was wrong by any
   number; it was found by looking at the fresh-document screenshot of
   frameless-curves.md. The words now sit below the middle.
13. The curve tools' method, shown as a label beside its drop-down, cut to
   "centre …" in the options panel. The text was right and every test
   passed; it was found by looking at the first screenshot of
   one-circle-one-arc.md, and it is why the reading is shown inside the
   drop-down.
14. A phone's tooltip clamped back over the toolbar it belongs to, once that
   toolbar was eleven buttons, one column the full height of an iPhone's
   screen with no room above or below it. Placement was unit-tested for the
   layouts it had been given; the e2e suites that hold a finger on a real
   tray failed the first time the tray changed. A column's tip is now
   narrowed to the room beside it.
15. The organiser's body row losing its name on a phone. The row put the
   body's name and then its whole chain in a pane a phone makes narrow: first
   cut to `e…`, then, with the chain shortened, `−e2 +e3 3` with no `e1` at
   all, because the name was the part allowed to shrink. The unit test read
   the full text and passed. Found by looking at the iPhone screenshots of
   solids-kernel.md, twice; the name now keeps its width and the chain gives
   way to an ellipsis, and the phone suite asserts the name is whole.
16. The hidden view drawing nothing of a kernel body behind its faces. An
   extrude's hidden edges are its twins, dimmed where a face covers them; a
   kernel body's twins are quiet, and its own edges went only to the face
   layer, which depth-tests them away. Every unit test passed, the solids
   suites too; the hidden view's old pixel tests failed the first time the
   whole suite ran, because the boss on their stepped block and on their
   plate now adds into it by default, making a kernel body.
17. The organiser's empty Bodies section, saying again what Features says,
   pushing Groups out of an iPhone's pane, so a tap on a group landed on
   nothing. The organiser suite's phone test failed; Bodies is now shown
   once there is a body.
18. A toolbar group's flyout item showing its tooltip over the tray it had
   opened from: kept off the flyout, centred on its item, and slid back over
   the tray's buttons — on a desktop and on a phone. The placement's unit
   tests had no tray to keep off; found by looking at the first screenshots
   of toolbar-groups.md. A tip can now be told what else to keep off.
19. A dark line down an elliptic cylinder's wall, where no edge is: faces.ts
   drew a wall line at a member's first sample unless the member was a whole
   circle, and the ellipse's samples start at its major end. Every unit test
   passed, the exact B-rep and the STEP among them (they have no such
   line); found by looking at the first picture of the wall
   (sketch-shapes.md). A whole ellipse has no vertices, as a circle has none.
20. The organiser's strip on a phone, once it named the workbench: "organiser
   · Pins" wrapped onto a second line the strip has no room for, and the
   name was clipped away — then, kept to one line, squeezed to nothing.
   Every test passed, the heading's text included; found by looking at the
   iPhone picture of workbenches.md. The word "organiser" now gives way to an
   ellipsis and the workbench's name keeps its width.
21. A miss's guidance in the mode chip outranking the step after the next
   click had succeeded: "click inside a closed outline" stayed for five
   seconds over a region already picked. Every unit test of the words
   passed; the e2e suite's miss-then-hit failed. Guidance now goes once
   the tool's next step changes.
22. Done on a landscape phone, which the chip wraps onto two lines, taken by
   the tool's name on the line below: its 44 px touch box reached up over
   Done. Found by the phone e2e test's one-tap Done; the plane's part is now
   stacked over the tool's.
23. The verdict cut off on an iPhone held upright: the chip's two lines
   pushed `SOLVED 8 free` past the corner's room, which clips it. Every test
   passed. Found by looking at the phone screenshot of mode-feedback.md; the
   chip's next step now gives way while the verdict shows.
24. The region tool's click on a circle under its region's own solid: the
   nearest loop there is the lid's twin of it, in another plane, and the
   step was refused. Every unit test passed (none had a lid over the face);
   the e2e suite's Edit rg1 found it. A click with a region in hand is read
   on the region's plane now, as the edit dialog's are.
25. A mode button pressed with a region in hand put the region down: the
   engine re-arms a tool for new options unless it can retune, and the
   region tool could not. Found by the same e2e test; it retunes now.
26. The region tool's mode row label, "mode", cut to one letter beside
   "Subtract". Every test passed; found by looking at the screenshot. The
   row has no label.
27. A fillet that had just succeeded, logged as refused. Between ✓ and the
   tool letting go, the preview was still in the chain beside the fillet it
   previewed. It found its edges already rounded, and its refusal was
   reported as the new feature's. Found by looking at the log in
   solid-fillets.md's screenshot. A trial now steps aside once its blend
   exists, and the report speaks only for nodes the body has.
28. The page's stack exhausted by guidance. A preview refusal said as
   guidance redrew synchronously, before the tool had recorded that it had
   said it, so the redraw said it again, forever. Found by the e2e suite's
   page errors.
29. A sketch line losing its pick to a kernel edge. Part of the line bounds
   a kernel body's step and the rest runs past the solid, but the edge
   along the part was taken in its place. Found by the hidden view's e2e test.
   Only the skeleton the kernel draws in an entity's place now yields.
30. A fillet's committed `R2` drawn under the edit dialog's own radius label,
   on a phone. Found by looking at the phone screenshot.
31. A drag's ghost drawn under the corner's status text, where a ghost can
   land in the logo's row that no placed pane may enter. Found by looking at
   panels-preview.md's first screenshot. The ghosts and the held panel are
   now lifted over the corner for the drag.
32. A ghost's line drawn at 1 px on a phone where the stylesheet asked for
   1.95 (1.5 × the interface size): Chromium floors a border to a whole CSS
   pixel. Found by the phone e2e reading the computed width. The width is
   now rounded to the nearest pixel, 2 at a phone's 100 %.
33. A long-press on a tray button raising a `contextmenu` nothing cancelled —
   the one surface that let it through, where Chrome on Android shows its own
   menu. Every unit test passed (none has a browser to raise one); found by
   the Android e2e's touch checks (android.md). It is now cancelled page-wide
   but where there is text to copy.
34. The command line lifted above the keyboard still padded for the gesture
   bar it no longer touched: an empty band between the text and the keys.
   The lift's arithmetic was right and its test passed; found by looking at
   the keyboard picture. A lifted panel is lifted as its own rectangle now.
35. A tap midway between two of the see-through organiser's rows, 8 px
   apart, selecting a row instead of reaching the drawing: Chromium moves a
   touch onto the nearest control its contact area reaches, and pointer
   events with it. Every unit test passed (there is no finger in them);
   found by the phone e2e's point tool, which made no point. A finger's rows
   are 22 px apart now, measured clear (panels-overlay-lock.md).
36. A locked layout re-fitted in a rotation and nothing said: the check
   compared the shown panes with the stored ones re-laid, which `relaid`
   returns alone — a default pane the resolver pushed out of a stored one's
   way was invisible to it. Found by the e2e's rotation; every pane is
   compared with what its docking or its default asked now.
37. A trim of an extruded outline's second edge refused as "part of e1's
   solid": seen from above, the lid's edge lies on the very pixel of the
   sketch edge under it, and the pick took the lid's. The unit suite's tools
   are handed the curve; found by the trim e2e reading the log. The edit
   tools read a press on a solid's own geometry on the sketch plane now
   (`curveUnder`, docs/plans/sketch-edit.md).
38. `redundant r12` in the header after a second trim: the extrude had made
   the crossing on the top edge a point of its own, held on both lines, and
   the trim ended the edge there — so the solid owned a corner of the sketch
   (deleting the solid would have taken the edge) and its hold on that edge
   said nothing. Every assertion of the test passed; found by looking at the
   picture's header. The trim hands such a point to the sketch.
39. The first toolbar flyout to wrap — modify, with the sketch edits in it —
   lost its second line's bottom under its own edge: `#flyout` is a `.tray`
   and took the tray's pitch padding, which `flyoutSize` never counted. A
   single line hid it (the coarse tray overflows visibly). Found by looking
   at the iPhone's long-press picture.
40. A fillet's radius dragged on a phone falling to nothing mid-drag, now
   and then: the drag's direction was read every frame from the size label,
   which the kernel's next preview can stand off another face, pointing
   another way. Every unit test passed (no preview lands mid-drag in one);
   found by recording the recogniser's and the tool's decisions in the phone
   e2e's failing runs. The direction is taken at the press now.
41. The verdict drawn half under the mode chip on an upright iPhone for the
   0.6 s of its fade: the chip took its line back when the fade *started*.
   Found by looking at a picture (196); the chip waits for the fade's end.
42. A stored layout a rotation could not hold drawn with panes over panes —
   the resolver's no-layout drawn as it stood, a console warning the only
   sign. Found by the owner (his log over the command line); a fuzz put it
   at 850 of 5,592 re-layouts. `refit` gives places up until one fits.
43. Targets measured against the device's whole 100 % — text size included
   — so a larger system font drew no larger tools. The unit table was
   right for its inputs; found by the Android e2e's "drawn 1.3 × larger".
44. The phone's action strip pushed flush into the right edge no longer
   turning into a column: the reshuffle kept a tray that lay along none of
   its edges running its own way along them, so the strip and the log could
   trade places. Every unit test passed (none presses a row into a side);
   found by the rotation e2e's docking, which starts with exactly that
   turn. Pressed within the turn's own 6 px it turns again
   (docs/plans/panels-reshuffle.md).
45. The status in the corner squeezed to a 20 px column, running down the
   screen a character to a line, once the toolbar was let in along the top
   beside the bare logo. Every unit and e2e assertion passed — the layout
   was sound, nothing overlapped; found by looking at the picture of the
   drop. Along the top the corner is the logo and the status's least room
   now (`cornerBox`), and a row too long for the rest wraps under it.
46. A spline extruded, and its points drawn again as dots on the lid — the
   twin spline's through-points, which a lid's circle never had (its centre
   is not on the lid's edge). Every count and every volume was right; found
   by looking at the extrude picture of spline.md. A feature's declared
   curve's points are quiet now (`quiet.ts`).
47. Bands down a spline's extruded wall at 3×, where a tight bend's facets
   each turned several degrees: every chord was within a quarter pixel of
   the curve, which is all the unit test asked. Found by looking at the 3×
   picture; no drawn chord turns more than 2° from the next now, and the
   unit test asks that too.
48. The spline tool's sentence for a mouse — "click the next point —
   double-click ends it, the first closes it" — wrapped to three lines in an
   iPhone's chip, over the drawing. The tool said the right thing; found by
   looking at the iPhone picture. A finger reads "tap more, ✓ ends, the
   first closes".
49. A conflicting relation clicked in the status, the log saying "r4 selected
   — Delete removes it", and Delete doing nothing: the key is the armed
   tool's while one is armed, and the constrain tool that had just added the
   par still was. Every unit test passed (the unit suite has no key); found by
   the conflict e2e's first run (conflict-detection.md). The click puts the
   tool down now.
50. A drawing restored by autosave never solved at start, so one holding a
   conflict opened reading "ready" in the sketch's ink, its conflict unsaid
   until the next edit: the stale readout of bug 1, from the other end. Found
   by the same suite's reload. A restored drawing is solved first; a CONFLICT
   stays up, and one that solves still reads ready.
51. A spline drawn on the sketch plane, dimmed as though it were off it:
   the focus had a rule for lines and circles and none for a spline, and
   every one of its points wore the ▱. Found by looking at the sketch-mode
   walkthrough's first picture. The focus now takes any curve by the points
   it is built of, and the ▱ is drawn only when asked.
52. A click on a chamfer's face, sketched on the lid behind it: the lid is
   still a loop of the feature's points spanning the corner the kernel cut
   away, and its plane is nearer the eye, so the region under the pixel was
   the lid seen through the chamfer. Every unit test passed, because the
   unit suite has no kernel faces to be in front of anything.
53. On an iPhone 13, a block's wall picked at the right of the screen turned
   square about its far corner and ended half off the screen, under the
   options pane, where the finger that was to draw on it could not reach.
   `lookAt` turns about the middle of a face's points now, and brings it on
   screen.
54. Escape made the sketch's exit rule drop a plane the user had made with
   `plane()`: the Escape that releases a feature tool after ✓ arrives with
   nothing armed. Found by the sketch-on-face suite. Escape leaves a work
   plane only.
55. On face was never offered for a box: the constrain tool's solid picker
   asked only the solid kernel for the face under the pixel, and a plain
   extrude is drawn from its features, not by the kernel, so a press on its
   lid found nothing and dropped the picks. The unit table fed the face's
   point triple straight to `constraintsFor` and passed
   (relations-complete.md). A region is a face now when its loop is a solid
   feature's own.
56. A greyed relation's reason, beside its label at an iPhone's width, showed
   a dozen characters — and those the generic half of the message ("tan
   holds a s…"). Found by looking at the picture. The reason leads with the
   particular and sits on two lines under the label.
57. A spline picked for Tangent drew nothing: `markPicked` knew lines,
   points, circles and arcs, because nothing had ever picked a spline. Found
   by looking at the iPhone picture — the arc green, the spline not. Any
   curve is marked by its frame or its path now, and the e2e reads the green.
58. A tool armed by its name typed at the command line (`trim`) left the
   chip saying Select until the next pointer event. The bare-name shortcut
   synced the toolbar but drew no frame, and the chip is synced in the draw
   pass: the stale readout of bug 1 again, from the tray's side. Found by
   trimeverything.e2e.ts asserting the chip before its first click, mouse and
   finger (docs/plans/trim-everything.md).
59. A trimmed spline's control points drawn as dots far off the curve, with
   nothing to say they were its: every point was where the knots put it.
   Found by looking at the trim picture. The control polygon is drawn now,
   thin and dashed.
60. Trim's glyph, as the modify button's face, read as a plus sign on the
   iPhone, because its dotted arm draws solid at that size. Found by looking
   at the toolbar picture. The piece past the wall is struck out instead.
61. A dimension's label double-clicked, `set("d2.value", ` put in the command
   line, and the number typed after it landing *in front of* it. The second
   press's default, a mousedown on the canvas, took the focus back off the
   line the press had just focused. The unit suite has no focus; the smart
   dimension e2e's first run found it (smart-dimension.md). The value opens
   after the event now.
62. A face picked behind another, lit straight through the one in front: a 2D
   canvas has no depth test, and the face's whole outline was filled. Every
   pick was the right face; found by looking at the picture of a step's two
   walls picked. A lit face is filled only in the cells where it is the
   front face, the pick's own question.
63. A double-tap on a dimension's label read as two taps on a loaded box. It
   was timed by when the page got round to recognising each tap, not by the
   touches' own stamps, which the recogniser already reads. It is timed by
   the pointerdown's stamp now, and the harness has a `doubleTap` that sends
   the second at a hand's pace.
64. A dimension's label clicked into a half-typed `del(` opened `set(` instead
   of naming it: smart dimension's double-click to edit and the glyphs'
   click-to-name met on a quick hand, two clicks inside the double-click
   window. Every unit test passed; dimensions.e2e failed once the box was
   quiet enough for the clicks to be quick. A half-typed command now takes
   every label click as a name.
65. Symmetric for two circles was offered only with the mirror line picked
   last; the line first listed nothing. The table test picked in one order.
   Found when the iPhone's seven-row list for two circles covered the line,
   so the test had to pick it first. The mirror is now whichever pick is the
   line, in any order.
66. The revolve tool never offered the origin's own axes: it asked only the
   frames that are entities, and the origin is none, so a rectangle beside
   the origin's y axis lit no axis and a tap on the arm was refused as "not
   in its plane" — while `revolve(…, "origin.y")` typed worked. Found by
   walking the revolve on a phone (docs/plans/solid-tools-intuitive.md, W9).
67. The Cut tool's "this cut doesn't reach any solid" said once after every
   confirm: the render between the confirm's lines asked the model half-way
   — the cut already made, its material gone. Found reading the log of the
   first iPhone run; the question now waits while a confirm's lines go in.
68. On a phone, a held finger on a solid's face opened the empty-canvas menu
   with the tool list first, filling the screen, and the face's own Sketch on
   this face, Edit e1 and Flip direction below it, out of sight. The test that
   asked for the items found them; only the picture showed where they were.
   On a face they come first now.
69. The extrude's new end-condition row: its label cut to "e." beside
   "Through all" and "Symmetric" on an iPhone (#13 again, found by looking),
   and, the row being one more, no panel layout fitting an iPhone held
   sideways — found by the full suite's touch.e2e.ts, every unit test passing.
   The end condition is a drop-down where the depth's label was now,
   SolidWorks' "Blind ▾ [10]", and costs no row.
70. A lid corner of an extruded rectangle dragged in the browser skewed the
   solid — the base tilted, every wall still along the world's z — and the
   status said SOLVED; the owner saw it at once. No unit test had ever
   dragged a lid: each asked of the relation what it said, twin = base +
   depth·z, and it said that exactly. The tests now ask the solid's
   properties (flat, square, the depth long, translated), whichever corner
   moved (docs/plans/profiles-held.md).
71. The constraints palette docked at an iPhone's bottom took the first tap
   on a line drawn just above it: a strip's hit box reaches a whole target up
   over the drawing (index.html's `.ptitle::before`), and Chromium's touch
   adjustment snaps a tap within the finger's radius onto it, so a line 30 px
   above the pane was the pane's. `elementFromPoint` said the canvas, so the
   harness's `at` let the press through, and the unit layout tests — which
   check rectangles — saw no overlap because there was none. Found by the
   palette e2e's first run; the pane is sized to three rows there, and `at`
   now refuses a point within a strip's reach under a finger
   (docs/plans/constraints-palette.md).
72. A click on a solid's face with the circle tool drew nothing, or drew on
   the ground: the owner's *"it still draws the circle on the XY plane"*
   (docs/plans/click-on-face.md). Two legs, both only visible assembled. A
   press on a face was settled onto the face by the tool and its release
   compared against it raw, at the same pixel but on the ground behind — so
   every click on a face read as a drag to a point a world apart, with a
   radius of zero, and the gesture quietly started over. And a press that
   snapped to one of the face's own edges — on a phone's small face, a
   finger's reach makes that the usual press — never asked what face it was
   on, and laid the circle on the ground through a point of the wall. The
   unit tests drove the tools with clicks already on the plane and passed;
   the reproduction (`test/e2e/clickonface.e2e.ts`) made zero circles, then
   one facing +z. The engine lands every drawing tool's event on the face
   drawn under the pixel now, snap or no snap, and says which.
73. A tool that commits on its press — the three-point circle, every tool
   whose last click builds — left the frame its solve drew on screen until
   the next pointer event: the toolbar button still lit, the chip still
   saying `circle · press at the centre`, and now the face it was landing on
   still lit, with the tool already put down. `finish` cleared the tool and
   redrew nothing. The e2e suite had asserted the stale chip as "the next
   circle" (modefeedback.e2e) and passed for weeks; the picture of a
   three-point circle just made, the lid still amber under no tool, found
   it. `finish` redraws.
74. A conflict on a solid's edges drew nothing red. A glyph follows its
   anchor, and a solid's edges are quiet until hovered, so the glyphs of the
   relations a CONFLICT named were not drawn at all: the status accused two
   relations over a picture that showed neither. Every unit test of what a
   conflict names passed, as they do not draw. Found by
   `reviewsolver.e2e.ts` reading the two conflict inks off the drawing over
   a lid's lit face and getting the plain ink for all of them. A relation in
   a conflict is always drawn.
75. Setting a revolve's angle slid its profile six units toward the axis.
   The unit suite has "set swings the end face to exactly the new angle and
   moves nothing else at all" — on a profile with every corner fixed, so
   that "nothing else" would be exact; `revolve.e2e.ts` draws as a person
   does, with the rectangle tool, fixed nowhere, and its sample points on
   the start cap were no longer on the cap. A quarter-turn swing left to the
   solve is shared between the end face and the profile; it always had been
   (0.2, and an edge 1% short), and was small only while the sketch's rows
   were products of its lines' lengths and so twenty times stiffer than the
   feature's. With those rows at their proper size (*A direction relation
   turns a line and never scales it*) it was six. `set` seats the end face
   where the new angle puts it before the solve (`seatTurned`), as it seats
   an extrude's lid, and the unit suite now has the drawing a person makes.
76. The trim tool on a lid's edge trimmed the wrong curve, or none
   (docs/plans/linked-profiles.md). The unit tests called `trim` with a
   place on the lid and passed. In the app the edit tools had never taken a
   solid's own edge: a press on one fell through to "the sketch curve
   nearest the press, read on the drawing plane" — which, with the solid
   seen from one side, is the ground under the pixel, nowhere near an edge
   a depth above it. On the iPhone that was the line drawn across the lid,
   and the tool trimmed the cutter instead of the edge. And under a finger
   the pick is the edge's corner, a point the tool passed over for being the
   solid's, so by finger nothing was trimmed at all. A lid's edge that
   something cuts is an edge to edit now, its place the point of it drawn
   under the pixel (`placeOn`, editdraw.ts), and a lid's corner offers the
   cut edges through it.

None of these are mathematics. They are all *assembly*. Hence `npm run
test:e2e`, and hence the expectation that anything touching the app is checked
in a browser before it is believed.

**A finger in the suite is a hand, not a request.** `test/e2e/fingers.ts`
drives touches through CDP, and CDP answers a touch only once the page has
handled it; every touch here is handled on the main thread. A helper that
waited for each answer before sending the next made a drag one main-thread
turn per move. On a loaded box its move past the slop came after the
long-press, and the gate went red four times in a row for it
(docs/plans/touch-harness.md). So a call sends its events at a hand's pace
without waiting for each other, and the browser queues and coalesces them as
it does a touchscreen's. The pace is 33 ms a move, which is what the old
helper really sent on an unloaded box. A faster hand flings harder, and the
tests' steps and rests were tuned to that speed. Every event carries the hand's
own timestamp: the wall clock less the time spent waiting for the browser.
The call returns once the page has handled them all, so a test still reads
the page with the finger where the call left it. A `hold` alone waits for its
landing before it starts counting, because the long-press is the page's
timer. The recogniser's half of the contract is to read what the stamps say.
A tap's length is the lift's stamp less the landing's. A held press whose
move past the slop is stamped before the long-press is a drag, because a busy
page can run its timer before a move it already has.
