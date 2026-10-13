# NeoCAD — status

A general nonlinear least-squares solver (Rust/WASM kernel, automatic
differentiation for exact sparse Jacobians) with a runtime-extensible
TypeScript tool-authoring layer on top. 2D CAD sketching is the first
"standard library" built on it — see the overnight brief below for the
full architectural intent (N-dimensional-capable kernel, tools defined
at the command line in the same language the app itself is written in,
etc).

## What's working right now

- **`kernel-rs/`** — Rust crate, compiles to WASM via `npm run build:kernel`.
  Exposes one function: `solve_step(rows, cols, vals, r, n, lambda) -> dx`,
  a matrix-free conjugate-gradient solve of the damped normal equations
  `(JᵀJ + λ(1+diag(JᵀJ))) dx = -Jᵀr`. Never forms JᵀJ explicitly, so it
  scales to sparse systems. Has its own native unit tests (`npm run
  test:kernel`, no WASM/browser needed) covering an identity system, an
  overdetermined least-squares average, and independence of decoupled
  variables.
- **`src/kernel/dual.ts`** — forward-mode automatic differentiation via
  dual numbers. A residual written with `Dual` arithmetic (`.add/.mul/
  .sin/.sqrt/...`) yields its exact value *and* exact sparse gradient in
  one evaluation — no finite-difference perturbation. Verified against
  finite differences in `test/problem.test.ts`.
- **`src/kernel/problem.ts`** — the kernel's public surface: `Problem`,
  a flat variable vector plus `addResidual(varIndices, fn)` blocks. Knows
  *nothing* about points, lines, or CAD — geometry is meant to live
  entirely above this file. `solve()` runs Levenberg-Marquardt, calling
  into the WASM kernel once per Newton step for the linear solve, warm-
  started, with LM damping/trust-region step acceptance in TS.
- **`test/problem.test.ts`** — end-to-end: two points + a distance
  constraint solves to the exact target length; an intentionally
  contradictory system correctly reports `solved:false` with the
  offending residual named, not silently "solved." Run via
  `npm test` (uses Node's native `--experimental-strip-types`, no
  ts-node/tsx dependency).

Toolchain: Rust installed via the official rustup script (**not**
Homebrew — Homebrew's `rustup` formula has no bottle for this macOS
version and tries to compile Rust+LLVM+Python from source, which filled
the disk to 20MB free before I caught it; see the incident note below).
Node pinned via `.nvmrc` to LTS through nvm, installed alongside (not
replacing) the system Node other projects on this machine may depend on.

- **`src/model.ts`** — the entity graph on top of the kernel. A `Point`
  is a name plus one `Problem` variable per `model.dim` coordinate;
  nothing else is hardcoded to 2D.
- **`src/relations/basic.ts`** — `dist`/`fix`/`coincident`/`midpoint`,
  written generically over `model.dim`. `test/model.test.ts` proves this
  isn't just a claim: the *identical* relation code is run against a 2D
  model and a 3D model in separate tests, both solving correctly (7/7
  tests passing total, `npm test`).
- **First browser milestone** (`index.html` + `src/main.ts`, `npm run
  dev`): loads the WASM kernel over `fetch` (the real browser path, not
  the Node test's byte-buffer shortcut), builds a small solved model,
  renders it to canvas. Verified via headless Chrome — solves in 4
  iterations, exact distance and midpoint.

- **Tool-authoring layer** (`src/tools/tool.ts`): `abstract class Tool {
  onDown/onMove/onUp/onCancel/render }`, a `ToolContext` (model +
  requestRender/requestSolve/finish — no ambient globals reachable from
  inside a tool), and `defineTool(name, ctor)` for registration.
  `src/tools/engine.ts` wires real DOM pointer events to whichever tool
  is armed, with a 2D screen<->world transform (cellwork's convention:
  `screen = ox + x*scale, oy - y*scale`) and a one-shot-by-default
  lifecycle (a tool deactivates once it calls `ctx.finish()` — same
  "gesture completes, re-arm explicitly" shape cellwork's pointer tools
  already used).
- **`src/tools/point.ts`** and **`src/tools/rectangle.ts`** — two tools
  built with that API, nothing privileged. Point is the trivial case
  (click, place, finish). Rectangle is the concrete example from the
  brief: `onDown` remembers the first corner *without* touching the
  model, `onMove` just requests a preview redraw, `render()` draws a
  dashed preview from the tool's own in-progress state, and `onUp` is
  the only place anything is committed — four points, four lines,
  the relations that make it a rectangle, one solve. (Those were `hor`/`ver`
  until coordinate frames arrived; they are `par`/`par`/`perp` now — see the
  coordinate-frames entry below.)
- **Verified with a real mouse drag**, not just unit tests: armed the
  rectangle tool through the command input (a tool-name-only stand-in
  at that point; the real REPL landed later, see below),
  dispatched actual `mousePressed`/`mouseMoved`/`mouseReleased` events
  on the canvas via headless Chrome, and confirmed (a) mid-drag nothing
  exists in the model yet — 0 entities — only a live preview renders,
  (b) on release exactly 4 points + 4 lines commit, forming a precise
  axis-aligned rectangle matching the drag distance, (c) status flips to
  SOLVED, (d) the tool deactivates afterward. `test/tools.test.ts` also
  covers this at the unit level (10/10 tests passing overall) plus the
  no-real-drag-commits-nothing edge case.
- **`Line` entity** added to `model.ts` (two point refs, owns no
  variables — purely referential, like cellwork's lines) and
  **`horizontal`/`vertical`** added to `relations/basic.ts` — these are
  deliberately 2D-only (like a cross product is genuinely 3D-only),
  unlike `dist`/`fix`/`coincident`/`midpoint` which stay dimension-generic.

- **Circle and arc entities** (`model.ts`) — a `Circle` is a center point
  reference plus one variable of its own, the radius; an `Arc` is that plus
  a named start and end point. Both stay purely *structural*, the same way
  a `Line` owns no variables: what makes an arc's endpoints lie on its own
  circle is the `arcends` relation, not the constructor — for the same
  reason a `Line` doesn't imply `hor`/`ver`. `model.circular(name)` reads
  either one, so every radius-aware relation takes a circle or an arc
  interchangeably. (↻ In a 3D model both also name a **plane** — a frame — since
  3D phase 2; see the planar-discipline entry below.)
- **The rest of the sketch relation vocabulary** (`relations/geometry.ts`):
  `par`, `perp`, `ang`, `on`, `eq`, `rad`, `oncircle`, `conc`, `eqrad`,
  `tan`, `sym`, `arcends`. Most are dimension-generic, and not by
  coincidence — written through `dot()` and `wedge()` (`relations/vec.ts`)
  the definitions people think of as 2D hold unchanged in any dimension, so
  "parallel" is "the wedge vanishes" whether that wedge has one component
  or three. Symmetry about a line is generic for the same reason: the
  mirror in 2D and a half-turn in 3D are the same two conditions. Both
  claims are *checked against a real 3D model* in `test/geometry.test.ts`,
  not just asserted in a comment.
  The wedge is kept as its components rather than their summed square on
  purpose: a residual that is already a square has a vanishing gradient at
  its own root, which would leave least-squares minimising a fourth power.
- **The REPL** (`src/repl.ts` + `src/replenv.ts`) — the item the whole
  brief was pointed at, and no longer a stand-in. `repl.ts` is the scoped
  evaluator: an entry runs inside a `with` block over a Proxy whose `has`
  trap claims *every* name, so no identifier falls through to the page's
  globals, and whose `get` trap throws `no such name: modle` rather than
  silently yielding `undefined`. `replenv.ts` is the command surface that
  scope is filled with — geometry constructors, the relation vocabulary
  under its short names, viewport control, and `Tool`/`defineTool`.
  To be precise about what that is and isn't: it is *curation*, not a
  security boundary. It exists so an entry sees a small documented surface
  and so typos are caught; code typed there still runs with the engine's
  authority. Genuinely untrusted code would need a worker or an iframe —
  a different feature with a different threat model.
  Two consequences of the `with` scope worth knowing: a bare assignment
  (`box = class extends Tool {...}`) persists to later entries, a
  `const`/`let`/`class` declaration does not.
- **Viewport control as ordinary commands** — `zoom()`, `pan()`, `arm()`,
  `cancel()`, `refresh()`, `ls()`, `solve()`, `help()`, per the brief's
  goal of having the whole interface drivable the way a tool is authored.
- **The acceptance test the project was pointed at, met end to end.** A
  rectangle tool *typed at the command line* — a class plus one
  `defineTool` call, with its own dashed-preview `render()` — registers in
  the same registry the built-ins use, arms by bare name, and drags out
  with a real mouse in headless Chrome: mid-drag nothing is committed and
  only the preview draws, release commits exactly 4 points and 4 lines
  matching the drag, status flips to `SOLVED`, and the tool stands down.
  Verified alongside circle/tangency/arc construction from the command
  line, `document` being unreachable from an entry on a page that has one,
  and a contradictory constraint correctly reporting `CONFLICT` with the
  offending relation named. 42/42 unit tests, 19/19 browser checks.

- **Circle and arc tools** (`tools/circle.ts`, `tools/arc.ts`). Circle is a
  drag from center to rim. Arc is *three clicks* — center, then radius, then
  sweep — which made it the first tool to span more than one gesture, and
  needed no engine change at all: a tool stays armed until it calls
  `ctx.finish()`, so a multi-stage tool is simply one that finishes later.
  Both leave the radius unconstrained on commit, matching the rectangle
  tool's choice not to dimension what it draws: the shape keeps the size it
  was drawn at (nothing pulls on that variable, so the solver leaves it be)
  while staying free to be driven later by a `rad` or a tangency. **↳ The
  3-point arc is now built too** — see its own entry below; `arc.ts` remains
  the *centre point* arc.
- **`fillet`** (`src/operations.ts`) — the last item from cellwork's
  vocabulary. It composes entirely out of the existing relations, which is
  the part worth noticing: `tan` on each leg, `arcends`, and `rad`. Those
  four are also *complete*, because a tangent line touches its circle exactly
  once, so an endpoint lying on both the leg and the circle can only be the
  point of tangency — no separate statement needed.
  Structurally it reuses the shared corner as the tangent point on the first
  leg rather than replacing it, so nothing is left orphaned (the model has no
  delete yet, and an operation that stranded points would leave stray dots on
  the canvas forever). It refuses corners it cannot round — collinear legs, a
  radius larger than the legs — with a reason rather than a bad solve.
- **Operations vs. relations** is now a real distinction in the tree
  (`src/operations.ts`). A relation only ever adds an equation and can at
  worst over- or under-constrain; an operation changes the structure and can
  leave the model malformed. Worth reviewing with different eyes.
- **Relations on lines resolve their endpoints lazily.** `Problem.addResidual`
  now accepts either a fixed index list or a thunk re-consulted at each
  evaluation, and every line-taking relation uses the thunk. This came
  straight out of building the fillet: a relation on a line means "this
  line", not "these two points as they stood when I was written", and
  re-pointing a leg used to leave its constraints behind on the old corner.
  `hor`/`ver` accordingly take *either* two point names or one line name —
  both are real things a sketcher means — and the built-in tools use the line
  form. Filleting a drawn rectangle keeps the rectangle square; before this
  it visibly did not. Both behaviours are pinned in `test/sketch.test.ts`.

- **Save and open** (`src/persist.ts`), as ordinary commands: `save()` hands
  back the file's text, `open(text)` replaces the model, plus `download()`
  and `openFile()` in the browser and `journal()` to read back what a model
  is made of. That completes the brief's "tool up the whole interface" goal.
  A model cannot be serialised directly — a residual block holds a *closure*,
  and closures do not survive JSON — so a saved file is the model's
  **journal**: what was done to it, in order, replayed on open. Which is a
  happier answer than it sounds, because those calls are exactly what the
  command line already takes. The format is a transcript of the public API,
  not a second description of the model's internals that has to be kept in
  step with them.
  An operation is journalled as the single call the user made rather than
  its expansion, so a fillet reads as `fillet("l1","l2",5)` and re-expands on
  replay. Solved coordinates ride along and are restored afterwards: replay
  alone reaches *a* valid configuration, but an under-constrained model has
  many, and reopening a drawing should give back the one that was saved.
  Opening only ever performs calls from a fixed table, so a file is data
  rather than a script — and the table is a `Map`, because a plain object
  would have answered a lookup for `"constructor"` from `Object.prototype`.
  Round-tripping is a fixed point: open then save reproduces the file byte
  for byte.

- **A file also carries the source of tools authored at the command line**
  (`src/toolsource.ts`), as an optional `tools: {name, source}[]` field beside
  the journal — **inert text**. `open()` evaluates none of it: it says what
  the file carries (one line per tool, through the log), `toolSource(name)`
  prints a source, `tools()` marks a carried source as not armable, and
  pasting it back is an ordinary entry the user has read. The paste is the
  consent; there is no affordance that runs it for them.
  The capture is the *whole entry* that called `defineTool`, taken by a
  wrapper in `replenv.ts` — so built-ins, which register from their own
  modules, are never captured, and nothing has to check for them. This is
  **session state**: not journalled, unknown to `model.ts`, and not an undo
  step, because the undo bracket's snapshot is `save(model)` with the tools
  parameter left at its default of none. `VERSION` stays 4 — an additive
  optional field is not a break in either direction.
  The inertness is pinned by a test that opens, lists, prints and re-saves a
  source which would set a marker and throw if anything ever evaluated it.

- **Mouse navigation** (`src/view.ts` + the tool engine): the wheel zooms
  about the cursor, right- or middle-drag pans. Onshape's split, and the
  reason for it is that navigation and tool use stay on separate buttons —
  the left button belongs to whichever tool is armed and nothing else, so a
  drawing can be re-framed *during* a gesture. Start a rectangle, pan, finish
  it, and the tool never sees the pan.
  That last part turned on a detail of the pointer spec: pressing a second
  button while one is already down does not fire another `pointerdown`, it
  arrives as a `pointermove` with the `buttons` mask updated. Panning
  therefore watches the mask (what is held) rather than `button` (what just
  changed).
  The transform itself moved to `src/view.ts` as pure functions so it can be
  tested without a canvas — zoom-about-a-point is solved directly rather than
  nudged, so the anchor does not drift as zooms accumulate, and the scale is
  clamped at both ends.

- **Picking and hover** (`src/picking.ts`) — hit-testing in *screen* space, so
  the pick tolerance stays a constant number of pixels however far the view is
  zoomed. Tiered rather than nearest-wins: points beat curves beat lines, since
  a point sitting on a line is under the cursor at the same time as the line
  and is almost always what was meant. An arc is only pickable within its own
  sweep.
  The selection model is cellwork's, and it is not the obvious one: **there is
  no selection set.** Clicking geometry drops its *name* into the command line
  and that is all — the viewport is a selection portal, not somewhere state
  accumulates. It suits this codebase even better than it suited cellwork,
  because every relation here already takes entity names as strings: click two
  points after typing `dist(` and you have `dist("p1", "p2"` ready to finish.
  Hovering highlights the entity and shows a tag naming it. With no tool armed,
  a left-click picks and a left-drag depends on what it grabbed — geometry
  drags, empty canvas box-selects (see the box-select and edge-drag entries
  below); with one armed, the left button is the tool's, as before.

- **The fillet tool** (`src/tools/fillet.ts`) — click two edges that meet and
  the corner between them is rounded. The first tool built on picking, and the
  case that motivated picking: the `fillet` operation was perfectly usable from
  the command line, but only if you already knew both edges by name.
  It also added two things to the tool API that the next few tools want anyway.
  `ctx.pick(screen)` hit-tests from inside a tool, and `arm(name, options)`
  hands a tool a parameter it needs before it can do anything —
  `arm("fillet", { radius: 8 })` — rather than each such tool inventing its own
  way of being told. Clicking something that isn't an edge is a *miss*, not a
  cancelled gesture, and a corner the operation refuses keeps the first edge so
  the second pick can be retried.

- **Snapping** (`src/snapping.ts`) — while a tool is drawing, the cursor is
  pulled onto whatever meaningful geometry is near it: an existing point,
  **where two curves cross**, the middle of an edge, or the nearest position
  along a line or rim, in that order of precedence. Tolerances
  are in screen pixels and the tiers mirror picking's, for the same reason.
  The tool is handed a snapped world coordinate and **never learns that
  anything happened** — a tool should be about its own gesture, not about how
  precise the cursor is. A marker shows what was caught (square for an exact
  point, × for a crossing, triangle for a midpoint, circle for somewhere along
  a curve), drawn
  after the tool's own preview so it can never be hidden by it: if the cursor
  is not where it looks, that has to be the most visible thing on screen.
  On its own snapping makes the click *exact* but joins nothing; what joins
  things is inference, below.
  A `Snap` carries `targets: string[]` rather than one name, because an
  intersection is about *two* curves and that pairing is the feature; every
  other kind fills in exactly one. `describeSnap` reads `l1 × c2`.

- **Intersections** (`src/intersect.ts`) — three closed forms
  (segment–segment, segment–circle, circle–circle) over plain numbers in
  screen space, plus the **arc-sweep test**, which lives here rather than in
  `picking.ts` where it started. Both files ask the same question — "is this
  angle on the arc?" — and two copies of the answer would eventually disagree
  about an arc's last few pixels, giving a crossing you can snap to but not
  click, or the reverse. Screen space because every caller asks in pixels and
  the view transform is affine with a uniform scale, so the exact screen
  crossing maps back through `screenToWorld` to the exact world crossing;
  world space would have bought nothing and cost a second angular convention.
  **Degenerate cases return nothing**: parallel and collinear lines,
  coincident, nested and tangent circles, a tangent chord. A doubled root is a
  *tangency* — already its own relation — and manufacturing a crossing out of
  one would place two constraints where the drawing says two curves touch
  rather than cross. Doubling is judged on the two candidates being within
  `TANGENT_EPS` (0.05px) of each other rather than on an exactly-zero
  discriminant, because a tangency the solver actually holds leaves its roots a
  thousandth of a pixel apart: the residual is ~1e-11 but the root separation
  goes as its square root, so an exact test never fires on real numbers.
  Candidates are prefiltered on the distance the along-a-curve tier already
  computes (`nearestOnCurve`, now shared) and only the survivors are
  intersected pairwise. That cannot lose a candidate — a crossing within
  tolerance of the cursor lies on both its curves, so both curves are within
  tolerance too — and it keeps a per-cursor-move cost proportional to what is
  under the hand rather than to the drawing.
  **Known limitation:** the along-a-curve tier still treats an arc as its whole
  circle, as it always has; only the *crossings* are gated by sweep. Snapping
  along a rim is more forgiving than picking one, and changing it was not part
  of this package.

- **Constraint inference** (`src/tools/place.ts`) — a tool that places a point
  on existing geometry applies the relation that implies. Onshape calls it
  inferencing, SolidWorks calls it automatic sketch relations, and the mapping
  is theirs: a point snap becomes `coin`, a midpoint snap becomes the *line*
  form of `mid`, a curve snap becomes `on` for a line or `oncircle` for a
  circle or arc, and an **intersection snap becomes both at once** — the
  on-curve relation for each of the two curves it names. That last one is what
  makes a point clicked on a crossing *stay* the crossing when either curve
  moves; with one relation it would slide along that curve and off the other
  the instant anything moved. Two relations, two registry entries, two glyphs,
  two `del`s: nothing downstream treats the pair specially.
  So a rectangle drawn from another's corner genuinely follows
  that corner when it moves — which it demonstrably did not before.
  **Nothing is merged.** Two points stay two points, joined by an ordinary
  constraint the user could have typed themselves; merging entities is a
  different feature living in deletion territory. Inference is downstream of
  snapping rather than beside it, so `snapping(false)` turns off both — one
  switch, as in Onshape, not two.
  The mechanism is deliberately thin: `PointerInfo` carries the `Snap` the
  engine used alongside the coordinate it produced, and `placePoint` is the
  single place that turns one into a relation. A tool that ignores the field
  behaves exactly as before. The rectangle tool keeps the whole first
  `PointerInfo` from `onDown` rather than only its coordinate, because by
  `onUp` that snap is the only record of what the gesture was started on; its
  two *derived* corners get no inference, since nothing was clicked there.
  The arc tool prefers a snapped third click over its own rim projection —
  `arcends` then stretches the arc to reach it, rather than the click being
  quietly moved back onto the drawn rim.
  `midpoint` gained the line form it was missing (`mid(m, "l1")` beside
  `mid(m, "a", "b")`), resolving the line's endpoints lazily — the same
  distinction `hor`/`ver` already drew, for the same reason. Both forms
  round-trip through save/open as the form they were called in.
  Worth knowing, because it looks like a bug and is not: a coincident
  constraint between two *free* points does not make one follow the other on
  solve — least squares moves both and meets in the middle. Pin one and the
  other follows exactly, which is what the tests do.

- **The line tool** (`src/tools/line.ts`) — click, click, chaining, shaped
  like Onshape's, and the last obvious gap in the toolbox: point, rectangle,
  circle, arc and fillet all existed and the most basic tool of all did not.
  The chain **shares its vertices**: the end of a committed segment *is* the
  start of the next one, the same point entity rather than a copy joined by a
  constraint, so there is nothing to infer between them and dragging the
  vertex moves both segments because there is only one thing there. Nothing is
  committed until the second click, so an abandoned chain leaves no stray
  point; `Escape` ends the chain and keeps what was drawn.
  Within 3° of an axis the preview locks onto it, a dashed guide shows why,
  and the committed line gets `hor(line)`/`ver(line)` — the line form, so it
  survives a fillet. Past the tolerance nothing is inferred and nothing is
  straightened. An endpoint snap beats the axis guess, because a click that
  landed on real geometry is a deliberate aim and sliding it onto an axis
  would undo it; the axis constraint still comes along when the snapped
  position satisfies it anyway.
  The chain is dimension-generic — it is only points and lines — so it works
  unchanged in a 3D model and infers no axis there, `hor`/`ver` being
  genuinely 2D-only. That test paid for itself on the spot: it caught a
  degeneracy check measuring only the first two coordinates, which refused
  every segment that moved in z alone. (↻ Since 3D phase 1's camera half it
  infers in 3D too, against a 3D default frame's axes, in its plane.)

- **Kinematic drag** (`src/tools/engine.ts`, `src/kernel/problem.ts`) — with
  nothing armed, press on a point and pull: the model follows the cursor while
  every constraint holds. Drag the free corner of a constrained rectangle and
  it resizes as a rectangle; drag a point held at a distance from a fixed one
  and it swings round the circle.
  The mechanism is a **temporary residual**. `Problem.solve()` now takes
  `extra?: ResidualBlock[]` — blocks evaluated alongside the stored ones for
  that one solve, added to nothing, gone when it returns. Each pointer move
  solves with a soft pull toward the cursor (`(x - cursor.x) * 0.12`, one
  residual per coordinate, cellwork's weight) and renders; the release runs one
  ordinary solve through the host's solve path. `problem.ts` still has never
  heard of a point: the blocks are built in the engine, which is allowed to
  know what one is.
  Extras are **excluded from the offender report** and from `maxResidual`. A
  soft pull never reaches zero — that is what makes it soft — so counting it
  would paint `CONFLICT` across the header for the duration of every drag.
  Worth knowing, and tested: least squares weighs everything at once, so a
  cursor held far past where a point can follow does not stall politely against
  the constraints, it *trades* against them, and the drawing goes a little out
  of true until the button comes up. At w = 0.12 the displacement is roughly
  the overshoot over 71 — invisible when the cursor is a pixel or two from the
  point it is pulling, which is the ordinary case. It is why the intermediate
  frames render without touching the status line, and why release solves again
  with no pull: that solve puts everything back to 1e-6.
  A `fix`ed point needs no special case; the pull (0.12) loses to the fix
  residuals (1) and it effectively stays put, which falls out of the
  arithmetic. Nothing is journalled — a drag changes values, not structure, and
  solved coordinates already ride along in a saved file, which
  `test/e2e/drag.e2e.ts` round-trips.
  `cancel()` (Escape, or a file being opened mid-gesture) **settles** a drag
  rather than dropping it, for the same reason the release does: the last frame
  was solved with the pull applied, so abandoning it without a final solve
  leaves the cursor's influence baked into the geometry and the status line
  stale. It cannot undo the drag — nothing has undo — but it can decline to
  leave a compromise behind. `test/engine.test.ts` covers that and the three
  neighbouring cases, driving the engine with synthetic pointer events against
  a stand-in canvas: a press that never moved, a pan, and an ordinary release.
  Deliberately not in v1, each a known difference from Onshape: **only points
  drag** and **no inference or snapping while dragging** (Onshape infers
  mid-drag). A settled drag is now one undo step, so the note that used to
  stand here — that a drag is undone by dragging back — no longer applies.
  The first of those two is no longer true either: the edge-drag entry below
  generalised it to any geometry. The second still is.

- **Undo/redo** (`src/undo.ts`, policy in `src/main.ts`) — Ctrl+Z / Cmd+Z
  undoes, Ctrl+Shift+Z and Ctrl+Y redo, and `undo()` / `redo()` are ordinary
  commands over the same host handles, so the keystroke and the command cannot
  drift apart.
  The mechanism is a **stack of whole-model snapshots**, and the snapshot format
  is the text `save()` writes — which already carries the journal *and* the
  solved coordinates, already restores through `open()`, and compares for
  equality as a string. The alternative (truncate the journal and replay) was
  rejected because value-only changes — a drag, a solve — are never journalled,
  so it would need value snapshots as well and be strictly more machinery.
  `undo.ts` is a stack and nothing else: generic over what a snapshot is,
  importing nothing, cap 100 (cellwork's), pushing clears redo.
  **What counts as one step** is decided in `main.ts` by one comparison —
  snapshot before, snapshot after, record only if they differ. Nothing
  enumerates which commands are edits: `ls()` and `help()` stay out of the
  history because they leave the model identical. One step each for a command
  entry that changed something (an entry drawing four points is one step,
  because one thing was typed), a tool commit, a settled drag, and an `open()`.
  `undo()`/`redo()` push nothing themselves.
  The engine gained **one callback**, `onUserAction("before" | "after")`, fired
  around a press or release handed to an armed tool and around a drag from its
  first moving frame to its settling solve. It is deliberately neutral — the
  engine is below undo in the layering and must not learn undo exists — and the
  engine owns the *pairing*, because it is the only thing that knows every way a
  gesture can end (released, cancelled with Escape, or abandoned because the
  model was swapped out mid-gesture). An unpaired `before` would strand the
  host's bracket silently, so `test/engine.test.ts` covers all three exits.
  **The carve-out:** while the command input holds uncommitted text, Ctrl+Z is
  the browser's and edits the text. A half-typed command makes the keystroke
  ambiguous, and an empty input is the signal that it is meant for the model.
  Deliberate limitations: history is **per-session and not saved** — a reopened
  file starts with an empty stack; restoring is a full replay, so undo costs
  what opening the file costs (fine at present sizes, and the first thing to
  measure if it ever is not); and there is **no undo of a view change**, since
  the view is not part of the model.

- **Constraint glyphs on the canvas** (`src/glyphs.ts`, drawn by `main.ts`,
  hit-tested by `ToolEngine.pickAt`) — one small boxed mark per relation,
  beside the geometry it constrains, in the same visual family as the hover
  tag. This is the fuller half of the visibility story the hover tag began:
  the tag answers "what constrains *this*?" once you have thought to hover the
  right thing, and a drawing wearing its glyphs answers it before you ask.
  `placeGlyphs(model, view)` computes placements and nothing else — no canvas,
  no pointer, no state — so it is unit-testable, and it is the only thing that
  decides where a mark goes.
  **Anchors are world-space, offsets are screen-space:** a mark belongs to a
  place in the drawing and follows it through a solve or a drag, while sitting
  a constant number of pixels off it at any zoom, which is the convention
  every tolerance in this codebase uses. Marks sharing an anchor **stack in a
  row**, and that is the whole crowding story — deliberately no layout engine,
  whose own failure mode (labels jumping about as the model solves) would be
  worse than the crowding it fixed. A relation about two things gets a mark on
  *each* (`par`, `perp`, `eq`, `eqrad`, `sym`), because one mark says a right
  angle exists somewhere and two say which pair.
  **Interaction, inventing nothing:** hovering a mark names the relation on
  the hover tag (`r5  coin p5 p3`, through the same `describePick`) *and*
  lights up every entity that relation constrains; clicking one drops its name
  into the command line exactly as clicking geometry does, so `del(` + click +
  `)` is still the whole deletion flow. `Pick.kind` gained `"relation"` rather
  than a parallel type, since everything downstream of a pick does the same
  thing with it.
  **Glyphs are the top picking tier**, above points — a mark is small,
  deliberate to aim at, and only ever where it is because something put it
  there, so a mark you cannot click because a point wandered near it would
  defeat the feature. They take no part in **snapping**: they are UI, not
  geometry, and nothing should ever be placed at one. A press that lands on a
  glyph also grabs nothing, so a mark cannot be used to start dragging the
  geometry behind it.
  **Command surface:** `glyphs()` reports, `glyphs(true|false)` sets, on
  `help()`, default **on** as in an Onshape sketch. Off empties the layer and
  stops glyphs being picked, since a mark you cannot see but can still click
  would be a trap.
  **The symbols** were judged in a browser at the real 12px rather than in the
  source, as the spec required, and tofu was ruled out by bitmap identity
  against a codepoint no font has — advance width cannot detect it in a
  monospace stack, where a present and an absent glyph measure identically.
  `coin` is `○` (the spec's `◦` is two pixels across), `on`/`oncircle` `●`,
  `fix` `#` (`⚓` renders but muddies at 12px), `sym` `⇌`; `dist` (`↔`) and
  `arcends` (`●`) were given marks the spec's table omitted. An op with no
  entry — a relation authored at the command line — anchors on the first
  entity it names and takes the op's first letter, so runtime extensibility
  does not leave holes in the layer. Placements are recomputed each frame
  rather than cached, because no cache could be invalidated honestly: a drag
  and a solve both move geometry without touching the model's structure.

- **Dimension values are those glyphs** (`labelFor` in `src/glyphs.ts`) —
  `dist`, `rad` and `ang` draw their target instead of a generic mark: `50`
  midway along the span offset across it, `R22` just outside the rim toward
  the upper right, `30°` at the corner two lines share, nudged along the
  bisector into the wedge (or between the two edges' middles when they share
  no corner). In Onshape a dimension *is* its number, and a separate
  dimensions overlay would duplicate the hovering, the picking, the
  highlighting and the `glyphs(false)` switch and then drift from them.
  The value is read from `RelationEntry.args` — the relation registry keeps
  the call as it was made — so this is pure UI over data that already
  existed: no model change, no journal change, no new relation kind. Values
  are trimmed to at most three decimals (`50`, not `50.000`), and a target
  that is not a number falls back to the generic mark rather than drawing
  `NaN`.
  **The box is the text's box.** `halfW` is per glyph and `glyphAt` reads it,
  so aiming at the last digit of `120.5` is not a miss. `glyphs.ts` has no
  canvas and must not grow one, so widths come from `GLYPH_CHAR_W` (7.2px,
  the 12px monospace advance) — a constant that is a claim about the font
  `main.ts` sets, checked against the browser's own `measureText` by
  `test/e2e/dimensions.e2e.ts`. Rows of marks now advance by each box's real
  edges rather than by a fixed step, because a wide label stepping 17px sat
  under its neighbour: `—` beside `110` drew as *minus* 110.
  `ang` gets **one** label rather than the two marks a two-line relation
  usually gets — two marks answer "which pair", two copies of one number
  answer nothing.
  **`dist` draws dashed witness and dimension lines** with arrowheads, from
  the two points it measures between (`Glyph.ends`, drawn by `main.ts`).
  Solid ones were built first and read as geometry — a `dist` across a
  rectangle's diagonal drew what looked like an edge that is not there — and
  the dashed version is where the information (which two points is this
  number about?) survives without that. Which side of an edge a dimension
  sits on follows the argument order: `dist("p3","p4")` and `dist("p4","p3")`
  are the same constraint on opposite sides.
  Deliberate limitations: **a value still cannot be edited on the canvas.**
  Clicking one inserts the relation's name like any other glyph; editing is
  `set("d1.value", 60)` at the command line, or Set value… on the glyph's
  menu, which types that command for you (see the next entry). **`ang` takes
  radians and labels degrees**, so a label is not quite what you would
  retype — and `set` on an angle takes radians for the same reason. Drawing
  radians on a sketch would be the wrong fix and guessing the unit from the
  number would be worse; degree input is an open owner decision in `TODO.md`.
  `rad` has no leader line back to its arc, and nothing moves a label out of
  a crowded spot — that is still the no-layout-engine decision above, with
  `glyphs(false)` as the escape hatch.

- **Dimensions are named `d1`, `d2`, … and `set()` edits one**
  (`DIMENSION_OPS` / `relationPrefix` / `parseValueRef` / `rebuildRelation` in
  `src/model.ts`, `set` in `src/operations.ts`) — the owner's decision,
  verbatim: editing a dimension *"should be a `set(d4.value, 60)` where d4 is
  the dimension."* There is no parameter table: the dimension **is** the named
  value-holder.
  **The `d` namespace.** `dist`, `rad` and `ang` are dimensions — a number you
  put on the drawing — and claim `d` names; every other relation stays `r`.
  Onshape's split, and it earns its keep because the name says which kind of
  thing you are holding. **`fix` is not a dimension**: it carries coordinates
  rather than one value. The prefix is read from the op inside
  `model.relation` rather than passed in by each relation, so a new relation
  cannot get it wrong by omission — and the throw-rollback restores whichever
  counter the claim actually moved, or a failed `dist` would silently shift
  every later dimension's name and a replay would hand out different ones.
  **`set` is an operation, not a relation**: it replaces an equation rather
  than adding one. `Model.rebuildRelation` re-runs the dimension **in place
  under the same name** — same registry position, `args` updated — so
  `rels()`, the glyph's label and `del`'s reference scan all tell the truth
  afterwards with no code told anything. New blocks are built *before* the old
  ones are removed, which is the only ordering under which a refused value
  leaves the relation intact (blocks are closures; there would be nothing to
  put back). Journalled as the one call, one undo step, and it re-solves
  through the host — the `del` precedent, sharpened: changing the verdict is
  the whole purpose of the call.
  `"d4.value"` is the only settable property, parsed by `parseValueRef` beside
  `parseAxisRef` in the layer that owns the namespace. An unknown property, a
  non-dimension, or a value that is not a number each gets a throw naming what
  *is* settable.
  **Command surface:** `set(path, value)`, on `help()`, registered in both
  `replenv.ts` and `persist.ts`'s replay table. The menu's **Set value…** on a
  dimension glyph *types* `set("d4.value", ` into the command line rather than
  running anything — a third `MenuAction` (`type`), because a partial command
  replaces the line where Insert name appends to it.
  **Format version 4.** Names are handed out by creation order, so
  re-prefixing changes which relation a recorded name picks out. Only
  `deleteRelation` holds one, so a v3 journal replays through a map from old
  name to new and its `deleteRelation` args are rewritten. The map is built
  **from the replay** rather than from a scan, because `fillet` is one entry
  that creates four relations. As at 2→3 the rewritten journal is installed,
  so a v3 file re-saves pointing at names the model uses.
  Worth knowing and not a bug: nothing pins a bare rectangle's *orientation*,
  so lengthening one edge lets the whole drawing rotate slightly unless it is
  levelled against a datum — the no-world-frame decision working as designed.

- **Named relations, and deletion with cascade** (`Model.relation` +
  `Model.relations` in `src/model.ts`, `del` in `src/operations.ts`,
  `BlockHandle` / `removeBlock` in `src/kernel/problem.ts`) — relations are
  registry entries named beside the entities (`r1`, `r2`, … for constraints and
  `d1`, `d2`, … for dimensions — see the entry above), because a
  constraint you cannot refer to is one you cannot inspect or remove, which
  stopped being survivable the moment tools began inferring constraints on the
  user's behalf.
  Every function in `relations/` is one call to **`model.relation(op, args,
  body)`**: it journals the call (replacing the bare `model.record` each used
  to open with, so there is one place to forget rather than two), collects the
  residual-block handles the body adds, registers them, and returns the name.
  Relations return their name where they used to return `void`. Entities and
  relations share one namespace, since `del("r3")` has to mean one thing. A
  relation defined in terms of another — `concentric` via `coincident`,
  `arcEndpoints` via two `onCircle`s — is **one** relation: the inner call's
  blocks join the outer entry and it journals nothing. That last part fixed a
  real bug rather than only tidying: both used to journal, so reopening a file
  containing a `conc` or an `arcends` quietly applied the inner constraint
  twice. A relation that throws part-way is rolled back — blocks removed, name
  counter restored — because a replay performs only the calls that succeeded
  and would otherwise name everything after it one step out.
  **The kernel change**, the only one: `Problem.addResidual` returns a
  monotonic, never-reused `BlockHandle` and `Problem.removeBlock(handle)`
  removes that block. Blocks are stored as `{ id, block }` so a removal never
  shifts another block's identity, and an unknown handle throws rather than
  being ignored. `problem.ts` still has never heard of a point.
  **`del(name)`** deletes an entity or a relation with Onshape's cascade — a
  relation takes nothing else; a point takes everything referencing it,
  recursively, plus every relation naming any of them; a line, circle or arc
  takes the relations naming it and leaves its points. The closure follows
  references *inward* (who needs me), never outward (what do I need), which is
  what makes it Onshape's rather than merely transitive. It returns the names
  it removed. **There is no confirmation prompt: undo is the confirmation**,
  `del` being one user action and therefore one Ctrl+Z from harmless.
  Deletion is journalled as its **expansion** (`deleteEntity` /
  `deleteRelation`, one entry per name) rather than as the `del` call, because
  a cascade is computed against the model as it stood and recomputing it later
  could remove a different set. Old files carry neither op and open unchanged;
  no format version bump. `Model`'s two primitives refuse to remove something
  still referenced or still constrained, so a hand-edited file gets a reason
  rather than a line with no endpoint.
  **Command surface:** `del(name)` and `rels(name?)`, both on `help()`.
  `rels()` prints the short op name — `r3  coin p5 p3` — so a listed relation
  reads back as a line you could retype. The **hover tag** gained the relation
  names (`p5  12, 30 · r3 r7`), which was this package's whole visibility
  story; the constraint glyphs above are the follow-up that builds on the same
  registry. `del` re-solves through the host — as `set` now does, for the same
  reason — because these are the edits whose purpose is to change the solver's
  verdict, and a stale `CONFLICT` header is a bug this project has already been
  bitten by.
  **The documented leak:** variables are **tombstoned, not compacted**. A
  deleted point's variables stay in the flat vector referenced by nothing;
  they take part in no residual, so the damped solve leaves them exactly where
  they are and they cost memory rather than correctness. It is bounded by how
  much one session deletes — and **a save/reopen does not shed it**, since
  replay re-runs the same creates and the same deletes. Both are pinned by
  tests in `test/deletion.test.ts`. Compaction means remapping every captured
  index list inside every closure, which is real work with real risk and is
  deliberately a later package.
  Also deliberate: a relation authored at the command line that calls
  `model.problem.addResidual` directly still works and is still anonymous —
  the same anonymity every relation had until now. Route it through
  `model.relation` and `model.addResidual` to get a name and a `del`.
- **`scripts/singlefile.mjs`** (`npm run build:single`) — folds app, page
  and WASM kernel (base64) into one self-contained
  `dist-single/neocad.html` with a git-rev buildstamp in the header. This
  is what gets published as the owner's review artifact after each merge;
  the entry shim (`scripts/single-entry.ts`) feeds the embedded kernel
  bytes to `ensureKernelLoaded` before `main.ts` loads, so nothing fetches.
  In the artifact sandbox `download()` is inert (viewer downloads are
  blocked); `save()`/`open(text)` work.

- **Typed edits re-solve (`src/main.ts`).** A command entry that changed the
  model goes through `solveAndRender()`, so the status readout always
  describes the drawing on screen. Before this, `dist("a","b",50)` added its
  residual and redrew and the header went on reading `SOLVED` over geometry
  that violated it until someone typed `solve()` — the stale-readout family,
  third sighting. **Which entries count is not enumerated anywhere:** it is
  the undo bracket's own before/after snapshot comparison, which
  `endUserAction` now returns rather than swallowing. One consequence worth
  stating: the two customers cannot drift apart, because "this is one undo
  step" and "this needs re-solving" are now literally the same boolean.
  `ls()`, `help()`, a bare expression and an entry that throws all leave the
  model identical and therefore solve nothing;
  `test/e2e/livesolve.e2e.ts` wraps `model.solve` in the page and counts,
  because "it did not solve" is not otherwise assertable. A redundant
  `solve()` typed afterwards remains harmless, so the older specs that type
  one were left alone.

- **Box select (`src/boxselect.ts`, the gesture in `src/tools/engine.ts`).**
  Left-drag on empty canvas drags a rectangle; **the direction is the mode**,
  SolidWorks/Onshape convention exactly — left→right is a *window* (only what
  is fully contained, solid edge, translucent fill), right→left a *crossing*
  (anything touched, dashed, different tint). The file is a fourth peer beside
  `picking.ts`, `snapping.ts` and `glyphs.ts`: a pure function of (model, view,
  rectangle), no canvas and no state, so all of it is unit-tested. It sits on
  `intersect.ts` for segment–segment, segment–circle and the arc-sweep test, so
  **a box and a click cannot disagree about where an arc stops**.
  Per kind: a point by its position; a segment contained when both ends are and
  touched when either end is inside or it crosses the boundary; a circle
  contained when its whole extent is and touched when the rim passes through —
  **a rectangle wholly inside a circle touches nothing**, because the entity is
  the rim and not the disc, the same rule picking follows. An arc measures
  containment against its *own* extent (endpoints plus whichever cardinal
  points its sweep reaches), not its whole circle's, or a quarter arc in a
  corner would refuse a box three times its size.
  **A box is a multi-click**: each name goes through the same `onPick` path a
  single click's does, so "there is no selection set" survives the feature
  rather than being replaced by it. An empty box inserts nothing, Escape
  cancels, and a press that grabbed anything at all is not a box — geometry
  drags (a point since the kinematic-drag package, an edge or a rim since the
  edge-drag one), a glyph pans. **Relations are not selectable and no code
  says so**: they live in a registry beside the entity map, so a box never sees
  them.
  *Reverses a register entry* (left-drag on empty canvas used to pan, which was
  cellwork's habit); the reversal is recorded in `TODO.md` for the owner to
  veto. Panning keeps middle-drag, right-drag and `pan()`. (↻ In the 3D app
  right-drag orbits; middle-drag and `pan()` pan.)
  *Fixed on the way:* **Escape moved from the command input to `window`.** A
  mouse press on the canvas blurs the input — a canvas is not focusable, so
  focus falls to the body — so the old binding was deaf during exactly the
  gestures Escape exists to abandon. It had never shown up because every
  earlier Escape test picked something first, and picking re-focuses the input.
  *Known and deliberate:* a box only ever catches what is on screen, since the
  rectangle is pixels; there is no shift-to-add, there being no selection set
  to add to.

- **Entities defined by constraints, not constructors** (`src/model.ts`'s four
  constructors, the creator commands in `src/replenv.ts`). **Every constructor
  argument is optional**, in the model and at the command line alike:
  `circle()`, `line()`, `arc()` and `point()` are all legal, and whatever is
  missing is auto-created free for the relations to define. Long names sit
  beside the short ones — `point`/`line`/`circle` next to `pt`/`ln`/`circ` —
  which costs nothing, because a creator function and a tool have shared a name
  since `arc` and `fillet` did (a bare word arms the tool, a call is an
  expression). `null` means the same as absent everywhere, since a journal
  round-trips through JSON and JSON has no `undefined`.
  The design rests on one observation: **a constructor argument here was never
  a constraint.** `circ(centre, r)` only seeds a radius variable and `pt(x,y)`
  pins nothing, so making the arguments optional changes no existing call's
  meaning and old files replay untouched.
  *Auto-created pieces are first-class.* A free circle's centre is a real,
  named, visible, draggable point — the rectangle tool's corners set that
  precedent — and everything downstream needed no changes to handle it: `ls()`,
  `rels()`, hover, glyphs, `del` (which leaves the centre, as it does for any
  circle) and undo, all confirmed in the browser rather than assumed.
  *No seed is ever degenerate.* A free line's endpoints are 20 units apart, not
  coincident, because a zero-length line has no direction and `tan`/`par`/`ang`
  divide by that direction's length; a free arc seeds as a quarter arc; an
  auto-seeded arc below 2D throws rather than being built flat.
  *Journal discipline:* each constructor records as **the one call that was
  made**, never its expansion — the auto-created sub-entities journal nothing
  — and re-expands deterministically, so a `circle()`-then-constrain model
  reopens byte-identical with the same auto-names.
  *Where a free piece appears:* the middle of the window, decided in
  `replenv.ts` and passed down as an ordinary coordinate. The model never
  learns what a viewport is. This needs the canvas's **size** as well as the
  transform — a `View` is only a transform and has no business holding a window
  size — hence the separate `viewSize` handle in `EnvHandles`. Headless there
  is nothing to ask and the model's plain defaults stand; the anchor is used
  only where the model would otherwise fall back to the origin for want of
  anything to derive a position from (a line with neither endpoint, a circle or
  arc with no centre), since given any reference the model already seeds beside
  it.
  *Known and deliberate:* **tangent + through-point + radius admits up to four
  circles**, and the solver lands on the branch nearest its seed; dragging flips
  branches. That is Onshape's behaviour and every least-squares sketcher's, not
  nondeterminism — which is why the *three-point* circle is the case checked
  against a closed form (exact circumcentre and circumradius to 1e-6), and why
  the ambiguous one is checked by satisfying all three of its constraints
  rather than by expecting a particular circle.
  *Not changed:* the pointer tools. Drag-centre-to-rim is the right pointer
  gesture and is Onshape's own; a 3-point-circle *tool* is now a trivial
  composition and is listed on `TODO.md` as enabled, not built. **↳ Since
  built** — see the next entry, and it really was trivial.

- **The 3-point circle tool** (`src/tools/circle3.ts`). `circle3` — bare word
  or `arm("circle3")` — then three clicks, and a circle passes through all
  three. Onshape calls it *3 point circle*; `circle3` is the name that is also
  a legal identifier.
  The tool adds nothing to the model and nothing to the solver: it commits one
  **free** `circle()`, three `onCircle`s and a solve. That is the whole
  implementation, and it is the free-entities package being spent rather than
  merely demonstrated. The difference from a tool that computed the
  circumcircle and called `addCircle(centre, r)` is not visible in the first
  frame and is the entire point: the constraints stay, so the circle *follows*
  its rim points when they move, each relation wears a glyph, `rels()` lists
  them, and any one can be deleted alone.
  *Every click goes through `placePoint`*, so all three carry snapping and
  inference like every other tool's clicks — which is why a 3-point circle
  through two existing corners is three clicks and no special case. The
  browser spec draws a rectangle, clicks two of its corners, and reads the two
  inferred coincidences out of `rels()` beside the three `oncircle`s.
  *One user action.* Nothing is created until the third click, so the bracket
  the engine already puts round a single pointer event covers circle, rim
  points and relations together — one Ctrl+Z. The rectangle tool set that
  shape; no engine change was needed for this one either.
  *Preview:* after the second click, the dashed circumcircle through the two
  clicks and the cursor, computed in **screen pixels** — the same closed form,
  and a pixel radius needs no scale factor, which is `intersect.ts`'s reason
  for living in screen space too.
  *Known and deliberate:* an **exactly** collinear third click is refused (the
  tool stays armed on the two good clicks) rather than committed, because
  three `oncircle`s on three collinear points have no solution and committing
  would leave a `CONFLICT` header over a drawing that should never have
  existed. Near-collinear goes through — it is the user's call. The threshold
  is a relative *sine*, i.e. an angle of ~1e-9 radians, not an area: an area
  threshold would call a large drawing bent and a small copy of it straight.
  Unit-tested at three scales.
  *Known gap:* the refusal is a `console.warn`. A `Tool` has no channel to the
  app's log pane — `fillet` reports a corner it cannot round by *throwing*,
  which reaches the page as an uncaught error — and giving tools one means a
  new `ToolContext` field, which is an `engine.ts` change this package was
  scoped out of. On `TODO.md` as a follow-up. **↳ Closed:** tools have a voice
  now (`ctx.log`), and the refusal goes to the pane.

- **The 3-point arc tool** (`src/tools/arc3.ts`). `arc3` — bare word or
  `arm("arc3")` — then three clicks: **the two endpoints first, then a point
  the arc passes through.** Onshape calls it *3 point arc*, and that click
  order is Onshape's; it is neither the natural guess (start, waypoint, end)
  nor `arc.ts`'s (centre, start, end), which is exactly why it is written down
  here.
  What it commits is two `placePoint`s, one **free** `addArc` with its centre
  auto-created and seeded at the circumcentre (radius at the circumradius),
  and one `arcEndpoints`. No new journal op was needed — `addArc`, `setCoords`
  and `arcEndpoints` were all already in the replay table, which is the
  evidence that it is a composition. `arcEndpoints` is not optional: an arc's
  endpoints lying on its own circle is a relation in this model rather than a
  constructor fact, so a tool that builds an arc has to say so.
  *The third click places nothing, and that is the design.* In Onshape the
  waypoint is not kept as geometry; keeping it here would leave a point the
  user never asked for and would have to clean up by hand — the fillet's
  reason for reusing its shared corner rather than stranding it. Its whole
  job is to choose which of the two arcs was meant and where the centre and
  radius start from. **So the arc is under-constrained afterwards — the bulge
  is free**: seven unknowns (two endpoints, a centre, a radius) against
  `arcEndpoints`' two equations. That is the same bargain `arc.ts` already
  strikes and the standing rule that tools do not dimension what they draw.
  The rejected alternative — the waypoint as a third point with an `onCircle`,
  which is exactly what `circle3` does — is in `CONVERSATION_LOG.md`. A unit
  test shoves the centre along the endpoints' perpendicular bisector and finds
  the system just as solved at a different radius, so the freedom is asserted
  rather than merely claimed. `rad(...)` is how a user pins it.
  *The sweep is chosen, not assumed.* `main.ts` draws an arc counter-clockwise
  in world space from `start` to `end`, so the two clicks are assigned to those
  roles in whichever order puts the waypoint inside the sweep — both are
  endpoints either way, only the label moves. An arc that bulges the wrong way
  satisfies every residual to machine precision and is still the wrong
  drawing (the fillet bug's shape), so the tests ask `withinSweep` and
  `screenAngle` themselves — `intersect.ts`'s one definition of what is *on*
  an arc — rather than a second opinion. Flipping the choice in the source
  fails three of them.
  *The rest is `circle3`'s shape:* both endpoint clicks carry snapping and
  inference, so an arc from one existing corner to another is three clicks and
  no special case; nothing is created before the third click, so the whole
  gesture is one Ctrl+Z with no engine change; the dashed preview after the
  second click shows the arc the next click will build, bulge and all; an
  exactly collinear third click is refused through `ctx.log` with the gesture
  left live, and near-collinear is the user's call. A second click on top of
  the first is swallowed as a double-click, the way `arc.ts` already swallows
  its zero-radius one.
  *One shared piece moved:* `circumcircle` and `COLLINEAR_EPS` now live in
  `src/tools/circumcircle.ts` rather than inside `circle3.ts`. Two tools need
  the same closed form and the same answer to "are these three points on one
  line"; two copies of a scale-free epsilon drift until one tool refuses a
  gesture the other accepts. The new file registers no tool, so importing it
  has no side effect — `place.ts` is the precedent.
  The pictures are in `CHANGELOG.md`, images 41 and 42.

- **Dragging an edge, a rim or an arc** (`src/tools/engine.ts`). With nothing
  armed, a left-drag that starts on *any* geometry drags it — the last leftover
  from the old mouse map, in which everything but a point panned. **Dragging an
  entity is dragging every point it is made of by the same offset**, and the
  offset is a *target* rather than a move: one soft pull per governing point,
  each toward that point's grab-time position plus however far the cursor has
  travelled. The machinery is exactly the point drag's — `Problem.solve({extra})`
  at weight 0.12 — so the constraints still win: an edge of a constrained
  rectangle carries the rectangle, an edge held by a `fix` strains toward the
  cursor and settles back legally.
  Which points govern which entity is one small exported function
  (`dragGoverns`): a line is its two endpoints, **a circle is its centre alone**
  — dragging a rim moves the circle and does not resize it, which is Onshape's
  behaviour and the only reading under which the gesture is a translation — and
  an arc is centre, start and end, its radius following from `arcends` rather
  than being dragged.
  The offset form replaced "pull the point to the cursor" for single points
  too, so there is one code path and not two, with the side benefit that a point
  grabbed a few pixels off-centre no longer jumps to the cursor as the drag
  starts. Settling, cancel and the undo bracket are untouched: a drag is one
  action whether it is released or escaped.
  **The only left-drag that still pans is one that started on a constraint
  glyph.** A glyph is UI: it grabs nothing, because it has no position of its
  own to move, and it is not empty canvas either, so it must not box. Leaving
  the pan there was preferred to making the press inert — the gesture does
  something rather than nothing, and it is the same press that has never
  dragged or boxed.
  *Known and deliberate:* **no rigid rotation** (translation only; the solver
  resolves the rest, which is what Onshape's drag does too), and still no
  inference or snapping mid-drag.

- **Coordinate frames, and no world frame** (`model.ts`, `relations/basic.ts`,
  `relations/refs.ts`, `framemarker.ts`, `picking.ts`, `boxselect.ts`,
  `main.ts`, `tools/engine.ts`, `tools/line.ts`, `replenv.ts`).
  A `Frame` is an origin point plus a point fixing +x, purely referential the
  way a `Line` is: it owns no variables and its two points are ordinary
  points. `addFrame(origin?, xref?, name?)` follows the free-entities
  conventions — everything optional, missing pieces auto-created and seeded a
  span apart so a frame with no direction cannot be constructed, journalled as
  the one call that was made. Frames were **2D-only** when this shipped: +y is
  +x turned a quarter turn, which settles a frame in 2D and leaves a whole
  rotation free above it. (*Superseded:* 3D frames carry a y-ref — see the
  3D-frames entry below.)
  `hor`, `ver` and `fix` are relative to a frame now — the one named, or
  `model.defaultFrame` at call time, and an error naming the fix when there is
  neither. The journal always carries the frame the call *resolved* to, so an
  entry cannot change meaning when the default changes later; old files
  carrying frameless entries are refused by the replay table with that same
  message, and the format version is 2.
  **A frame is read, not pushed.** `frameBasis` (`relations/refs.ts`) re-reads
  the frame's origin and unit axes at every evaluation and hands them to the
  residual as values; the frame's two points are not among the block's
  declared variables. Declaring them was tried first and measured: the solver
  then satisfies a `hor` by turning the frame rather than the line (≈8° of a
  9° error, on a 40-unit line against a 20-unit frame arm), and without
  normalising it shrinks the frame's arm as well. So a frame moves only when
  something moves *it*, and the drawing follows within the same solve because
  the basis is re-read. That is what makes "level against a tilted frame"
  settle at exactly the frame's tilt.
  Two tools bridged: **the rectangle tool is intrinsic** (`par`, `par`,
  `perp` — no `hor`/`ver`, so it works with no frame at all, and three
  relations rather than four because the fourth was redundant), and **the line
  tool's axis inference fires only when a default frame is set**, against that
  frame — its aim, its dashed guide and the constraint it lands are one answer
  read off that frame's axes, so a tilted frame tilts all three together. With
  no default frame there is no aim and no guide, rather than a preview pulled
  onto the kernel's axes promising a constraint that never arrives.
  **A frame is drawn, and behaves like the geometry it is.** A small axes
  marker at the origin — two lettered arrows of a fixed pixel length (the
  x-ref's *distance* means nothing, only its direction), the name beside it,
  and the default frame brighter, because which frame is default is the only
  ambient state in the app that changes what a typed `hor` means. It is drawn
  in the entity pass of `render()`, not with the glyphs. `framemarker.ts` owns
  the marker's screen geometry, because `main.ts` draws it, `picking.ts`
  hit-tests it and `boxselect.ts` catches it and three copies of "where are
  the arms" would drift. A frame therefore hovers, picks, box-selects, drags
  and `del`s with no new interaction model; its origin point still wins a pick
  at the marker's corner, which is the right answer — dragging that turns the
  frame, dragging the marker moves it.
  **A drag on a point a frame reads moves it outright**, then lets the same
  solve carry the drawing to it. That is the other face of read-never-pushed:
  with the frame's points outside the Jacobian of the residuals that read
  them, the damped solve rejects every step that turns the frame (turning it
  raises a residual the step cannot see how to lower), λ runs away, and the
  frame does not move — measured at 0.003° against a gesture asking for 26°.
  The weak pull is still applied on top, so a frame point that is also
  ordinary geometry keeps its relations' say. `frame()` seeds its origin at
  the middle of the view like every other free constructor.
  *Known and deliberate:* a frame has no rotation gesture of its own — you
  turn one by dragging its x-ref, which is the same gesture as dragging any
  other point, and there is no rigid-rotate anywhere in the app yet.

- **A right-click context menu** (`src/menu.ts`, wired in `src/main.ts`,
  styled in `index.html`). **Right-press and release without moving opens it;
  right-drag still pans** — the right button makes the same click/drag split
  the left one always has, on the same three-pixel threshold, so the release
  decides and the press decides nothing. Middle-drag stays purely
  navigational and never opens anything. The browser's own menu is still
  suppressed on the canvas, and now on the menu element too.
  **Every item is a shortcut to a command the log shows.** On an entity:
  *Insert name* (what a left-click already does), *Delete*, *Dimension* — and
  *Fix* on a point. On a constraint glyph: the relation's description as the
  header, and *Delete*. On empty canvas: the eight tool arms, plus *Frame*
  (`setDefaultFrame(frame())` when the drawing has no frame at all, `frame()`
  once it has one). Each row shows the command beside its label.
  **The seam is `submit`** — the very function the Enter key calls, handed to
  the menu as an explicit `run` hook. Logging, the recall history, the one
  undo bracket and the re-solve all live there and nowhere else, so an item
  that went any other way would be a second answer to what typing a command
  means. Nothing about undo, journalling or the status readout is new: a
  menu-typed `dist` is one journal entry, one undo step and one solve because
  a typed `dist` already was.
  **A dimension carries the current measurement** — a line's length, a
  circle's or arc's radius — so the action means "hold it where it is" and
  moves nothing. A point gets no Dimension (no single natural measurement)
  and neither does a frame (its arm's length is drawn at a fixed pixel size).
  **Fix is shown disabled when there is no default frame**, with the model's
  own `resolveFrame` message beneath it, and never quietly makes one. Its
  coordinates are the point's position *in the frame*, not its raw numbers,
  or the relation would move what it claims to hold.
  `menuFor(model, pick)` is pure — model and pick in, labels and command
  strings out — which is what puts the item logic in the unit suite
  (`test/menu.test.ts`); the gesture and the whole browser story are in
  `test/engine.test.ts` and `test/e2e/contextmenu.e2e.ts`.
  *Known and deliberate:* the items are hard-coded per pick kind, so nothing
  defined at the command line can add one; no submenus, icons or arrow keys;
  a right-click with a tool armed opens the ordinary menu; and a right press
  taken during a left drag opens nothing.

- **`hor`/`ver` retired into frame-axis references.** The vocabulary no longer
  names a privileged pair of directions anywhere. `par`, `perp` and `ang`
  accept a **frame-axis reference** — the string `"f1.x"` or `"f1.y"` — beside
  an ordinary line, and `xaxis(frame?)`/`yaxis(frame?)` hand one back with the
  default resolved at call time. `par("l1", yaxis())` is what `ver("l1")` was;
  the residual is identical (the wedge with +y *is* the dot with +x), so the
  frames package's closed-form tilted-frame tests hold unchanged in the new
  spelling. `horizontal`/`vertical` are **removed, not aliased**: reaching for
  one gets the standing `no such name: hor`.
  **Resolution has one home** — `directionOf` in `relations/refs.ts`, beside
  `frameBasis` — while the *syntax* belongs to `model.ts`, which owns the
  namespace: `claimName` refuses a dot in any entity name so a reference can
  never collide with one, and `relationsNaming`/`del` read `f1.x` as naming
  `f1` so a frame cannot be deleted out from under a relation still reading it.
  **Datum semantics are now structural rather than remembered**: an axis
  contributes no variables and a direction built from `Dual.constant`, whose
  gradient is empty, so the frame is outside the Jacobian by construction. Two
  ordinary lines in `par` still push each other; two frame axes on one relation
  are refused, since that residual could declare no variables at all.
  **Which relations may take one is a rule**: an axis is a direction with no
  length and no position, so `eq` (no length), `on`, `sym` and `tan` (all need
  a *located* line) are excluded, and each exclusion is written into
  `relations/geometry.ts` rather than left to be rediscovered.
  `par`/`perp` keep the point-pair form (`par("p1","p3","f.x")`); `ang`
  deliberately has none, since its trailing numeric target would have to be
  told from a third name by arity alone. `fix` is untouched.
  **Downstream**: the line tool infers `par(line, "f.x")`/`par(line, "f.y")`;
  a `par` or `ang` whose other side is an axis wears **one** mark, on the line,
  since there is no second edge to put one beside — and hovering it still
  lights the frame, because the highlight resolves `f1.x` back to `f1`.
  The parallel mark is `//`: `∥` is not in the browser's monospace and drew as
  a tofu slab (every other mark advances 7.2246px, `∥` advances 6), which was
  invisible while `par` was rare and glaring the moment it became the drawing's
  commonest mark. An e2e now measures every symbol in the table against the
  monospace cell.
  **Format version 3**, and version-2 files **translate** rather than being
  refused: `horizontal(l, f)` replays as `parallel(l, "f.x")`, `vertical(l, f)`
  as `parallel(l, "f.y")`, point forms carrying their extra name. The
  *translated* journal is what gets installed, so such a file re-saves in the
  new vocabulary — `save(open(x)) ≠ x` across this boundary, deliberately, and
  byte-stable from there on. Version-1 files are still refused by step, with
  the same message, now raised by the translation that has to resolve the frame
  they lack.
  *Spec:* [`docs/plans/retire-hor-ver.md`](docs/plans/retire-hor-ver.md).

- **3D frames: a frame is a sketch plane** (`model.ts`, `relations/refs.ts`,
  `relations/basic.ts`, `persist.ts`, `replenv.ts`, `menu.ts`) — the model half
  of 3D phase 1. **The app still ran `Model(2)`** when this landed; nothing on
  screen changed, and everything here was reachable from a 3D model at the
  command line or in a test. (↻ The second half, the entry below, put the app
  on `Model(3)`.)
  `addFrame(origin?, xref?, yref?, name?)`: in a 3D model the **y-ref** is a
  third ordinary point, auto-created when absent like every free piece, and
  seeded so the frame can never start degenerate even when two of the three
  points were given (a seed goes along the first kernel axis not parallel to
  the arm already there). A 2D model refuses a y-ref; a model of any other
  dimension has no frames at all. **`frameBasis` straightens the y-ref**
  (Gram–Schmidt against +x) and takes +z = +x × +y, so the y-ref fixes the plane
  and its side, not the angle, and the axes are orthonormal and right-handed by
  construction. Collapse floors **axis by axis**: a y-ref on the origin or on
  the frame's own x axis floors +y and +z and keeps +x; an x-ref on the origin
  floors +x and +z. The y floor scales with the arm's length (measured: an
  absolute 1e-9 would let a billion-unit collinear arm's 1.3e-7 rounding
  remainder through as a direction).
  **`fix` in 3D pins `[x, y, z]` in a frame**, and the frameless form is
  **gone** — in every dimension — so the gauge is no longer visible anywhere in
  the vocabulary. **`onPlane(point, frame?)`** (`onplane`) holds a point in a
  frame's plane: `(p − origin) · +z = 0`, a signed distance, read-never-pushed,
  default resolved at call time and journalled resolved; refused in 2D.
  **`"f1.z"`** is a frame-axis reference in 3D (refused in 2D, by
  `Model.requireAxis`, before the frame is looked up), and `zaxis(frame?)`
  joins `xaxis`/`yaxis`, all three through `Model.axisRef`. The context menu's
  Fix item reads frame coordinates in either dimension (its raw-coordinates 3D
  branch only made sense while `fix` there was gauge-relative).
  **Format version 5**: `addFrame`'s name moved to its fourth argument, and every
  older file's three-argument `addFrame` is translated on the way in (keyed on
  the version, so a hand-edited v5 entry fails at its own step). A v4 *3D* file
  that used the gauge `fix` is refused by step with the standing no-frame
  message — the app has always been 2D, so only the command line or a test
  could have written one.
  *Known and deliberate (then):* `onPlane` had no glyph symbol of its own (it
  would draw the fallback `o`, but only in a 3D drawing, which the app could
  not show — choosing a mark is for when it can be looked at); the line tool
  inferred no axis in 3D (that needed the camera's projection). Both closed by
  the entry below.
  *Spec:* [`docs/plans/3d-phase1.md`](docs/plans/3d-phase1.md).

- **The app is 3D: camera, working plane, projected drawing, lifted files**
  (`view.ts`, `vec3.ts`, `arcgeom.ts`, `projection.ts`, `workplane.ts`,
  `intersect.ts`, `picking.ts`, `snapping.ts`, `boxselect.ts`, `glyphs.ts`,
  `framemarker.ts`, `tools/*`, `operations.ts`, `replenv.ts`, `persist.ts`,
  `main.ts`) — the camera half of 3D phase 1. **The app runs `Model(3)`,
  always**; every door a model comes in by (new, open, the file picker, undo)
  opens into 3D.
  **The camera** (`view.ts`) is orthographic: `{ox, oy, scale}` as before plus
  optional `right`/`up` screen axes in world terms and an orbit `target`. A
  view with no orientation is the top view, evaluated term for term as the old
  2D formula, so every 2D caller gets bit-identical numbers. `orbitBy` turns
  the drawing about the screen's own axes (a trackball) about the target,
  which `panBy`/`zoomAbout` keep on its pixel; `alignView` is `lookAt`'s
  primitive; `depth` orders a painter's sort; `screenToPlane` is the one
  pixel-to-place intersection, and `screenToWorld` stays the 2D inverse (the
  ray's crossing with z = 0) for 2D models; `liesOn` is the shared "is this on
  the sketch" test.
  **The working plane** (`workplane.ts`) is the default frame's plane when
  there is one, else the camera-parallel plane through the target (z = 0 in an
  unturned view); a frame seen exactly edge-on falls back to the latter. The
  engine reads every pointer event there, reports it as `PointerInfo.plane`,
  and does a drag's offset arithmetic on the plane the press landed on.
  **Mouse** (⚠ register): right-drag orbits in a 3D model (`ORBIT_PER_PIXEL`,
  half a degree), middle-drag pans, the wheel zooms about the cursor, a right
  press released in place opens the menu; a 2D model keeps right-drag pan.
  `orbit(yaw, pitch)` and `lookAt(frame?)` join `pan`/`zoom`, unjournalled.
  **Drawing** (`main.ts`): curves and frames depth-sorted, then points
  depth-sorted on top. A circle is its silhouette (still a sphere to every
  relation — the phase-2 seam). An arc is laid out in the plane through its
  centre and endpoints and swept counter-clockwise about that plane's normal
  on the kernel's +z side, then +y, then +x (`arcgeom.ts` — the gauge showing
  through, in rendering and picking only, keeping every 2D arc as it was),
  drawn as a quarter-pixel polyline. A frame draws a three-arrow triad from
  `frameBasis`, each arm foreshortened.
  **Picking, snapping, box select and glyphs** stay screen-space; what changed
  is what each entity looks like on screen and which world point a pixel on it
  stands for (`projection.ts`). A face-on arc is the exact screen arc it always
  was; an oblique one is a polyline (`intersect.ts` gained polylines). Snap
  world positions are lifted off the entity, never inverted from the pixel; a
  screen crossing counts only where both curves' lifts are one place; and with
  a sketch plane, only snaps on it are offered (a vertex merely *behind* a
  square-on sketch is no place on it — found in the poster screenshot).
  Glyph nudges are measured on screen; a circle's rim glyph sits on the
  silhouette. `onPlane` wears `▱`.
  **Tools** draw on the working plane: rectangle (derived corners along the
  plane's axes), circle (full 3D radius; silhouette preview via
  `RenderContext.scale`), circle3/arc3 (3D circumcircle, world-space previews),
  arc (endpoints stored so the drawn sweep is counter-clockwise *as seen*),
  line (axis inference against a 3D frame, in its plane). `placePoint` infers
  `onPlane` with the default frame where the snap leaves the point free and the
  point is on the plane; a tool's derived points get it too. `fillet` is
  dimension-generic.
  **Format version 6**; opening a 2D file into 3D (keyed on `dim`) lifts every
  coordinate to z = 0 and gives each frame a named y-ref (`<frame>_y`, never a
  name the file uses), placed from the saved coordinates. The library opens a
  file in its own dimension unless asked. At the command line `pt(x, y)` and
  `fix(p, [x, y])` take the same lift. 493 unit tests, 187 e2e.
  *Known and deliberate:* circles are spheres (silhouettes; intersection snaps
  only square-on); an arc turned through the vertical draws as its complement;
  `pt(x, y)` seeds at the kernel's z = 0 even with a tilted default frame; typed
  `frame()` seeds along kernel axes in a turned view; one depth per entity in
  the painter's sort; no snapping to off-plane geometry while sketching.
  (↻ The circle, arc, typed-`frame()` and off-plane-snap seams closed in 3D
  phase 2 — next entry.)
  *Spec:* [`docs/plans/3d-phase1.md`](docs/plans/3d-phase1.md).
- **Planar discipline: circles and arcs carry a plane** (`model.ts`,
  `relations/refs.ts`, `relations/geometry.ts`, `curveplane.ts` (new),
  `arcgeom.ts`, `projection.ts`, `glyphs.ts`, `snapping.ts`, `tools/*`,
  `operations.ts`, `persist.ts`, `planetranslation.ts` (new), `replenv.ts`,
  `menu.ts`, `main.ts`) — 3D phase 2.
  **The plane.** A 3D `CircleEntity`/`ArcEntity` has `plane`, a frame name:
  `addCircle(center?, radius?, plane?, name?)` and `addArc(…, radius?, plane?,
  name?)` resolve it like `fix` (the one named, else the default **at call
  time**, journalled resolved; with neither, the standing message — and before
  any auto-created centre exists). A 2D model refuses the argument. The frame
  gives orientation only: the **rim is the circle through the circle's own
  centre parallel to the frame's x–y plane**; the centre is never pinned, so
  dragging it off the frame carries the rim with it, parallel. A free 3D arc's
  auto-created ends are seeded along the plane's own axes. `Model.dependents`
  counts the plane, so **deleting a frame takes the circles and arcs on it**
  (and the primitive refuses to orphan one).
  **Relations.** In 3D `onCircle` is two blocks — the distance, as ever, and
  `(p − centre) · +z` (`oncircle(p,c)|plane`) — and `tangent` gains a block
  holding both line ends on the rim's plane (`tan(l,c)|plane`); the frame's +z
  comes through `rimNormal` as a datum. In 2D neither extra block is emitted:
  the 2D relations are the blocks they always were, pinned by block count and
  by value. `arcends`, being two `onCircle`s, follows.
  **Orientation.** An arc turns counter-clockwise about its frame's +z
  (`arcFrame(c, s, e, r, side)`, `sweepsAs(…, side)`); the kernel-axis side rule
  is gone from everything but the v6 translation.
  **Drawing and hitting.** `curveplane.ts` answers "where is this rim" for
  everyone (`curveFrame`, `curvePlaneOf`, `sketchSide`); `circleFrame` lays a
  whole circle out for the arc machinery. A circle seen obliquely is a closed
  quarter-pixel polyline on its ellipse — drawn, picked, snapped, boxed, lifted
  by angle — and face-on the exact circle it always was. The silhouette is
  gone; a rim glyph sits on the planar rim where the screen says up-right; the
  hover tag and `ls()` name the plane (`c1  r 10  in f1`).
  **Tools.** circle/circle3/arc/arc3 refuse their first click in 3D with no
  default frame (`curveToolReady`: log, nothing placed; a throw headless), and
  the empty-canvas menu shows those four and Fillet **disabled with the
  model's own message**. Previews are sampled in their plane. `fillet(l1, l2,
  r, plane?)` takes the default in 3D (journalled `[l1, l2, r, frame]`; a 2D
  entry stays three arguments) and refuses a corner out of the frame's
  orientation (`IN_PLANE_SINE`, a millionth).
  **Off-plane snapping.** With a sketch plane, a point *off* it is offered at
  its projection onto it — `"projected"`, the foot of the perpendicular along
  the plane's normal — below every on-sketch point, crossing and midpoint and
  above a bare curve, drawn as a dashed hollow square with a dashed leader back
  to the point. It **infers nothing**; the placed point gets only the sketch's
  own `onPlane`. Points only: projecting curves is later.
  **Conveniences.** `plane(origin?, xref?, yref?)` = `frame()` +
  `setDefaultFrame` + `lookAt`, journalling only the first two. `frame()` with
  no refs in a *turned* view seeds them along the screen's right and up (an
  unturned view journals exactly what it did). A frame's menu gains **Sketch on
  this** → `setDefaultFrame("f"); lookAt("f")`.
  **Format version 7**: the plane before the name. Older files translate
  (`planetranslation.ts`): 2D → null planes; 3D → an arc takes the surviving
  frame nearest its normal read from the *saved* geometry (default, then
  earliest, on ties), a fillet its corner's, a circle the default (else one its
  centre is on, else the earliest); where none fits, a translation frame
  `plane` (never a name the file uses) in the curve's plane, on its centre; an
  arc whose v6 side disagrees with its frame's +z has its ends swapped.
  **Also:** `asOperation` journals after its body succeeds, so a refused
  operation (a fillet too big for its corner) no longer poisons the saved file.
  534 unit tests, 195 e2e.
  *Known and deliberate:* the plane never pins a centre (a tool's `onPlane`
  does); curves off the sketch are not projected (points only); a v6 *circle*
  cannot say which plane it was drawn in, so it takes the default; a v6 bare
  `arc()` with auto-created ends cannot be swapped and may open as its
  complement on an upside-down frame; `pt(x, y)` still seeds at the kernel's
  z = 0; one depth per entity in the painter's sort.
  *Spec:* [`docs/plans/3d-phase2.md`](docs/plans/3d-phase2.md).
- **Closed loops** (`src/loops.ts` (new), `replenv.ts`) — 3D phase 3. A pure
  question-about-the-drawing module, boxselect's kind, and nothing in the app
  calls it yet: a click inside a region still picks nothing, and loops are
  drawn nowhere.
  **`findLoops(model)`** returns every closed loop: a cycle of lines and arcs
  in one plane, joined end to end, or a whole circle. *Joined* means the same
  point entity or held by `coin` (a union over the relation registry, chains
  included) — never proximity, a crossing or a T (an `on`); the module header
  states it as the honesty line. *One plane* means every line end, arc centre
  and arc end within `liesOn`'s millionth, and every arc's frame +z parallel
  (sine ≤ 1e-6). Candidate planes come from each arc's and circle's frame and
  each non-parallel line pair at a joined vertex. Per plane: bridges dropped
  (Tarjan, multigraph-safe), any component whose edges cross is rejected, and
  the bounded faces are walked with edges ordered by tangent, curvature, then a
  mirrored index offset; a face revisiting a vertex is split there. Each `Loop`
  has `plane` (origin, u, v, normal, and the frame whose plane it is, if one
  is), `members` counter-clockwise about the normal from the earliest-made
  (name, `reversed`, `from`/`to` points), `area` (Green's theorem, arcs in
  closed form; positive as listed), and `parent`/`children` — the smallest
  coplanar container, touching at a point allowed, sharing an edge not.
  **`loopAt(model, view, sx, sy, loops?)`** casts the pixel's ray into each
  plane and tests by winding number (arcs exact); the innermost hit wins, then
  the nearest plane, then the smaller area; a loop under a pixel thick on
  screen is edge-on and skipped.
  **`loops()`** lists them — `loop of l1,a1,l2,l3,l4 in f1, area 1186.265`,
  `…, inside …` for an island — and journals nothing, claims no name, makes no
  undo step. 563 unit tests, 199 e2e.
  *Known and deliberate:* a component whose joined edges cross reports no
  loops, and a T or a crossing splits nothing (Onshape splits regions at every
  intersection); `loops()` says nothing about near-misses.
  *Spec:* [`docs/plans/3d-phase3-loops.md`](docs/plans/3d-phase3-loops.md).
- **Extrude, the model half** (`extrude` in `src/operations.ts`,
  `src/relations/extrusion.ts` (new), the feature registry in `src/model.ts`,
  `persist.ts`, `replenv.ts`, `picking.ts`, `glyphs.ts`) — 3D phase 4, half 1.
  **`extrude(member, depth?, frame?)`** finds the loop the member is in —
  refusing none, or several (listed; `frame` narrows to the loop parallel to
  it), or a loop no frame orients — and expands it, with every loop inside it,
  into: a **lid frame** (the sketch frame's three points lifted by the depth,
  then the frame); one **twin point per joined class** of the profile's points
  (corners and centres, joined by `loops.ts`'s own `joinClasses`); a **twin
  member** per member in its own direction (a curve on the sketch frame onto
  the lid frame, any other keeps its own); a **wall line** per corner class,
  base to twin (circles have none); and **one `extrusion` dimension**
  (`d`-named, `[frame, depth, base₁, twin₁, …]`): per point pair three linear
  residuals `twin − base − depth·ẑ`, per curve pair `r_twin − r_base`, the
  frame's +z and its own points read as a datum. It is in `DIMENSION_OPS` with
  its value at index 1 and has a `REBUILD` line, so **`set` moves the lid**.
  Default depth `DEFAULT_DEPTH` (10, a seed); zero refused, negative goes the
  other way. **Journalled as the call with its profile resolved** —
  `[member, depth, frame, loops]` — and a profile handed over is walked by its
  joins and checked closed, never re-found (replay runs on seeds, where a
  profile of free lines has no loop).
  **The record** (`FeatureEntry`, `model.features`, `e1`, `e2`, …, one
  namespace with entities and relations): `member`, `frame`, `top`, `depth`,
  `loops`, `twins`, `walls`, `names` (profile + frame + everything made) and
  `owns` (everything made). Made by `addFeature` (journals nothing; the
  operation is the entry), listed by `ls()` (`e1  extrude of l1,a1,… + 2
  inside, depth d2 = 20 along f1, lid f2`), named at the end of the hover tag
  of any piece (`· e1`). The depth's label is its value on the first wall,
  with `dist`'s witness lines; `rels()` writes it `d1  extrusion 20 along
  f1.z, 7 pairs` for a plain rectangle (four corners, three lid-frame points).
  **Deletion:** `del("e1")` takes the record and what it owns (with whatever
  needs those) and never the profile; deleting anything a record names takes
  the record and nothing else; `deleteEntity`/`deleteRelation` refuse while a
  record names the thing; `deleteFeature` is the journalled primitive. Format
  version unchanged (7). 584 unit tests, 207 e2e.
  *Known and deliberate:* a feature is expanded once (restructuring its
  profile later does not regenerate the lid); the lid frame always has its own
  points; `fillet`'s new points are not held on the sketch, so a `set` can stir
  a rounded corner by a few millionths along +z.
  *Spec:* [`docs/plans/3d-phase4-extrude.md`](docs/plans/3d-phase4-extrude.md).
- **Extrude, the faces and the tool** (`src/faces.ts` (new),
  `src/tools/extrude.ts` (new), `main.ts`, `tools/engine.ts`, `tools/tool.ts`) —
  3D phase 4, half 2.
  **Faces** are a pure function of (model, view), glyphs.ts's kind, recomputed
  every frame from the live geometry and stored nowhere. `featureFaces` gives a
  feature's two caps — each one outline per profile loop, filled even-odd — and
  its walls: a quad per line, a strip of quads per arc or circle at
  `arcSegments`' drawing resolution, the twin sampled piece for piece with its
  base. Members are walked by position (so a profile whose join a deletion
  opened still draws). Outward normals: caps along ∓/± the sketch frame's +z by
  which way the lid went; walls `winding × (−1)^nesting × (edge × ẑ)`, the
  winding from the signed area about +z and the nesting from how many other
  loops contain a point of the loop. `facesToDraw` culls faces whose normal
  points away from the viewer, sorts far to near — a wall by its centroid, a
  cap by its nearest point — and shades each by `normal · toward` (a headlight);
  `faceColour` maps that onto the panel slates `FACE_DARK`…`FACE_LIGHT`, a
  quarter of the way up at worst. `main.ts` fills them (even-odd, plus a
  0.75px stroke in the same colour against anti-aliasing seams) **before** the
  entities, so every edge, point and glyph draws on top. A solid that cannot be
  laid out (a collapsed frame) costs its own faces and never throws.
  **The tool**: `arm("extrude", { depth })` (default `DEFAULT_DEPTH`). On move
  it asks `ctx.regionAt(screen)` — new on `ToolContext`, answered by the engine
  with `findLoops` + `loopAt` — and outlines the region (`regionOf`: the loop and
  every loop inside it), tinted even-odd; a click there runs `profileOf` and
  `extrude` with the profile resolved, solves and finishes; a click on nothing
  logs `extrude: no closed region under the click …` and stays armed (a throw
  headless). `Tool.snaps` (new, default true) is false for it, so the engine
  neither snaps nor draws a marker. Idle clicks are unchanged. 600 unit tests,
  210 e2e.
  *Known and deliberate:* hidden edges show through faces; interpenetrating
  solids can sort wrong where they cross; faces never pick, snap, box or wear a
  glyph; a solid's side face extrudes only once a frame is made on its plane.


## What's next

The working list lives in [`TODO.md`](TODO.md), so it has one home rather
than drifting between two. In short: saving user-authored tools, `del` of
several names at once, edge dragging, a way for a tool to say something to
the user that is neither a thrown error nor a console line, and the remaining
interaction ideas to carry over from `cellwork`.

several names at once, a 3-point circle tool (now a trivial composition),
and the remaining interaction ideas to carry over from `cellwork`.

## Incident note (disk space)

Early in this session `brew install rustup-init` (the old formula name,
since renamed) triggered Homebrew to compile Rust, LLVM, cmake, and
Python **from source** — this filled the disk to 20MB free on a 92GB
volume and briefly broke even basic shell commands. Recovered by
clearing `~/Library/Caches/vscode-cpptools` (7.2GB, VS Code's C++
IntelliSense cache — safe, fully regenerable) and `brew cleanup` (~1GB).
Disk is healthy now (8GB+ free). Lesson applied: Rust was then installed
via the official `rustup.rs` script instead, which downloads prebuilt
binaries rather than compiling — fast, and does not repeat the problem.
If disk space gets tight again, `~/Library/Caches/*` is generally safe
to prune selectively (regenerable app caches), `~/Downloads` and
anything under a project's own working files are not mine to touch.

## Repo

Separate repo from `cellwork` (sibling directory), per instruction —
this is meant to grow into the general-purpose kernel `cellwork` was a
single-file prototype of, not a subdirectory of it.
