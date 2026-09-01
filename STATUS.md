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
  `hor`/`ver` relations, one solve.
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
  interchangeably.
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
  while staying free to be driven later by a `rad` or a tangency.
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
  a left-drag pans and a left-click picks; with one armed, the left button is
  the tool's, as before.

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
  every segment that moved in z alone.

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
  drag** (an edge or a rim still pans, as it did) and **no inference or snapping
  while dragging** (Onshape infers mid-drag). A settled drag is now one undo
  step, so the note that used to stand here — that a drag is undone by dragging
  back — no longer applies.

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

- **Named relations, and deletion with cascade** (`Model.relation` +
  `Model.relations` in `src/model.ts`, `del` in `src/operations.ts`,
  `BlockHandle` / `removeBlock` in `src/kernel/problem.ts`) — relations are
  registry entries named `r1`, `r2`, … beside the entities, because a
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
  registry. `del` is the one editing command that re-solves
  through the host, because it is the one edit whose purpose is to change the
  solver's verdict and a stale `CONFLICT` header is a bug this project has
  already been bitten by.
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
  cancels, and a press that grabbed anything at all is not a box — a point
  drags, an edge or a glyph pans. **Relations are not selectable and no code
  says so**: they live in a registry beside the entity map, so a box never sees
  them.
  *Reverses a register entry* (left-drag on empty canvas used to pan, which was
  cellwork's habit); the reversal is recorded in `TODO.md` for the owner to
  veto. Panning keeps middle-drag, right-drag and `pan()`.
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
  composition and is listed on `TODO.md` as enabled, not built.

## What's next

The working list lives in [`TODO.md`](TODO.md), so it has one home rather
than drifting between two. In short: saving user-authored tools, `del` of
several names at once, a 3-point circle tool (now a trivial composition),
edge dragging, and the remaining interaction ideas to carry over from
`cellwork`.

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
