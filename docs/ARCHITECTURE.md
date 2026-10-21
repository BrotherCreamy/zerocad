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
over what a snapshot is, importing nothing at all. `arcgeom.ts` is the same
kind of file: which way round an arc goes about a given side, and a whole
circle laid out in a given plane, over plain numbers. `curveplane.ts` is the
one that asks the model *which* numbers — a circle's or arc's plane read off
its frame through `frameBasis`, so it sits above the relations like
`workplane.ts` — and the renderer, the drawing-question modules, the glyphs,
the arc tools and `fillet` all ask it (see "In 3D a pixel is a ray" below).

`toolsource.ts` sits in the `tools/ | operations.ts | persist.ts` row, between
those first and last two: it holds the *text* of tools authored at the command
line, which `persist.ts` carries in a file and `replenv.ts` captures and prints.
It is deliberately not inside either — the registry in `tools/tool.ts` stays
ignorant of persistence, and `persist.ts` stays ignorant of the session — and
what it keeps is session state, not model state. See "A file carries its tools'
source" below.

`menu.ts` sits *beside* `main.ts` rather than under it: it is browser-layer
code that reads the model and returns command strings, and it runs none of
them. It is above `replenv.ts` in spirit — everything it produces is text for
that command surface to evaluate — but it imports nothing from there, because
it only needs to know what the commands are *called*.

`panels.ts` sits beside it, for the same reason and with even less: the panel
manager and the toolbar import nothing from the model or the tools. The
toolbar is handed its tool names, armed tool and which tools cannot run by the
host and hands back a command string; the panel manager is rectangles and
`localStorage`.

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

`workplane.ts` sits above the relations (it reads a frame's basis) and below the
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
members, wall lines, a lid frame — held by one ordinary relation, the
`extrusion` dimension. What none of that can say is *these pieces are one
solid*, and that is the whole of a feature record (`e1`, in `model.features`,
sharing the namespace so `del("e1")` means one thing): which profile it was
built on, what it made, which relation is its depth. It is rebuilt by replaying
the operation, never saved, and the faces a solid is drawn with are read off
the live geometry each frame and stored nowhere. That is the one-model decision
carried into solids: a lid is geometry a sketch can be constrained against, and
`set` on its depth re-solves it like any dimension, because it is one.

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

**A feature's record reads the same rule from both sides.** It names
everything it was built on and made, so deleting any of those takes the
record — and only the record, as deleting a point takes a relation and not the
relation's other arguments; the pieces left are ordinary geometry and stay.
Deleting the feature itself takes what it *made* (the record's `owns`) and
never the profile it was built on, which was a sketch before the feature
existed — Onshape's rule. The primitives refuse to delete anything a record
still names, so a record can never point at nothing.

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

## There is no world frame, and a frame is a datum

The kernel keeps a flat vector of numbers and those numbers have to live
somewhere, but that substrate is a **gauge, not a frame**: nothing in the
user-facing vocabulary may reference it. `fix` is relative to a `Frame` — an
origin point plus a point fixing +x, purely referential the way a `Line` is —
and refuses to run when none is named and no default is set. Everything else
in the vocabulary (`dist`, `par`, `perp`, `ang`, `tan`, `on`, …) is intrinsic:
a claim about geometry relative to other geometry. A drawing with no frame
simply floats: the damped solve leaves unconstrained directions where they
were seeded, so nothing needs anchoring for the mathematics to work.

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
default frame's plane when there is one — set a frame as the default and every
tool draws on it, which is the sketch flow — else the plane facing the viewer
through the orbit target. The engine reads every pointer event there and
reports which plane it was (`PointerInfo.plane`), and a drag moves what it
grabbed parallel to the plane its press landed on, fixed for the gesture.
`placePoint` holds a point it places on the default frame's plane with
`onPlane` — only where a snap has not already pinned it, and only when it is
actually on the plane.

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

**A circle or arc lies in a plane, and the plane is a frame** (`CircleEntity`).
In 3D a circle without one would be a sphere — which is what phase 1 had, drawn
as a silhouette that never foreshortened — so a 3D circle or arc names a frame,
resolved like `fix`'s (the default at call time, journalled resolved, the
standing message with none), and a 2D one refuses the argument. **The frame is
an orientation, not a constraint**: the rim is the circle through the
circle's *own* centre parallel to the frame's x–y plane, and nothing pins the
centre to the frame. That is the free-entities rule — an argument is never a
constraint — and it is what lets a circle be dragged off its sketch with its
rim carried along, parallel, rather than snapping back to a plane nobody asked
it to be held on. A tool that draws on a sketch holds the centre there with an
`onPlane` of its own, which can be seen, hovered and deleted.

The relations that read the *rim* read the plane: `onCircle` in 3D is two
blocks, the distance and the point's offset off the rim's plane, and `tangent`
holds the line's ends on that plane; the frame's +z reaches them as a datum
(`rimNormal`), read and never pushed. In 2D those blocks would be trivially
zero, and they are **not emitted** — a 2D relation is the blocks it always was.

An arc's plane also says which way round it goes: counter-clockwise about the
frame's +z. Before arcs carried a plane that side came from the kernel's axes
(+z, then +y, then +x) — the gauge showing through, which drew an arc turned
through the vertical as its complement. The rule survives only in the
translation of files written under it (`planetranslation.ts`), which swaps an
arc's ends where the two disagree so the file opens as the drawing it was.

`curveplane.ts` is the one place a rim is located — `curveFrame` lays any
circle or arc out for `arcgeom.ts`'s machinery — and everything that draws,
picks, snaps, boxes or labels a rim asks it. Seen face-on a rim is still the
exact screen circle or arc it always was (so a 2D drawing is hit by the old
arithmetic); seen obliquely it is a closed quarter-pixel polyline on its
ellipse, lifted back to the true rim by angle.

**A 2D file opens lifted** (`persist.ts`, keyed on the file's `dim`): every
coordinate gains a zero, and every frame the y-ref a 3D frame cannot be without
— named after its frame rather than auto-named, because an auto-name claimed
mid-replay is a name some later entry already holds, and placed from the
*saved* coordinates, since only they know where a frame the drawing had turned
put its +y. The command line applies the same lift to a two-number `pt` or
`fix`.

## Tools are not privileged

A tool is a class with `onDown` / `onMove` / `onUp` / `onCancel` / `render`,
registered with `defineTool(name, ctor)`. The built-ins use exactly the API a
tool typed at the command line uses — there is no separate plugin surface,
and if there ever is, something has gone wrong.

A tool receives a `ToolContext` (the model, plus `requestRender`,
`requestSolve` and `finish`) and no ambient globals. It stays armed until it
calls `ctx.finish()`, which is why a three-click arc tool needed no engine
change: "multi-stage" is just "finishes later".

The engine keeps navigation and tool use on separate mouse buttons, so a
gesture can be panned through without the tool ever seeing it.

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

## A solid's faces are drawn, never stored

An extrude is real geometry — twins, walls, a depth — and its *faces* are what
the renderer fills between those pieces, read off where they are each frame
(`faces.ts`, a pure function of model and view at glyphs.ts's height). So a
face can never disagree with the edges over it. A cap is every profile loop in
one path, filled even-odd, which makes a hole empty and an island in a hole
solid with no triangulation and no nesting rule; a curved wall is one quad per
drawn segment, so it shades round.

**Painter's per face, culled, lit from the eye.** Each face's outward normal is
computed from its loop's winding and nesting, faces turned away are not drawn,
and the rest sort far to near and shade by the cosine to the line of sight — a
headlight, because a light fixed anywhere would need a world frame to fix it in.
A wall sorts by its centroid, a cap by its *nearest* point: nothing of a prism
is in front of its visible cap's plane, and a centroid key let a grazing cap
sort behind its own hole's far wall, which then painted over it. The faces go
down first and every entity draws over them — so the sketch stays legible on a
solid, at the price of hidden edges showing through — and a face never picks,
snaps, boxes or wears a glyph: the pieces of a solid are what a hand aims at.

**A revolve's faces are derived further.** There are no walls to fill between,
so each piece of the profile is swept round the live axis in steps sized from the
swept radius — `arcSegments`' quarter-pixel at the farthest point, one count for
the whole solid so neighbouring rings meet — and each quad's normal is the
profile's own in-plane normal turned, which is exact for a surface of revolution
and is why the axis must lie in the profile's plane. Caps only for a partial turn.

**A cap goes before the walls of its own solid in front of its plane.** The
nearest-point key rests on a prism having nothing in front of its visible cap's
plane, and a revolve past about 300° does: its last stretch wraps round in front
of its start cap, and the key painted the cap over it. For a planar face the
exact order is by side — after what is behind its plane, before what is in front
— so a cap that an overlapping wall of its own in front of its plane would sort
before is lowered just under that wall (`orderedFaces`). An extrude never has
such a wall, so nothing about it changed. It was found by a check of true depths
at sampled pixels over 192 views a shape, not by a picture: the two shades
differed by five levels. Within a few degrees of a whole turn, seen nearly along
the axis, there are walls in front and behind that no one key can sit between —
there a sort is a sort.

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

The canvas is the whole window under the header, and the toolbar, the log and
the command line are panels over it (`panels.ts`). Nothing in the page reflows
the drawing any more — the log used to, taking height from the canvas as it
filled, which moved "the middle of the view" under every command that seeds
there. The header is the one thing that does not move: it is the title bar.

**A toolbar button is a context-menu item with a fixed place on screen.** It
types `arm("name")` through `submit`, for every reason in the section above,
and it is built from the tool registry when drawn rather than from a list kept
beside it — so the extensibility claim ("tools are not privileged") reaches the
toolbar too: a tool defined at the command line has a button.

**Layout is not model state.** Where a viewer keeps their log is a fact about
their screen. It lives in `localStorage`, every touch wrapped — a private window
throws on the first one — and never reaches the journal, a saved file or the
undo stack. Only the panels a viewer has touched are stored; the rest follow
their defaults, and what is drawn is always the stored-or-default rectangle
passed through `constrain` against the window as it is now. So shrinking the
window pulls panels in without forgetting where they were put.

**Gestures never cross**, and it takes both halves: a panel captures the
pointer on its strip or grip, and the host captures it on every canvas press.
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
  writes in what the call meant at the time it was made. `revolve` does the
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

Seven bugs so far were invisible to the unit tests and obvious within seconds
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

None of these are mathematics. They are all *assembly*. Hence `npm run
test:e2e`, and hence the expectation that anything touching the app is checked
in a browser before it is believed.
