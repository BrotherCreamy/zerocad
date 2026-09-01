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
  pulled onto whatever meaningful geometry is near it: an existing point, the
  middle of an edge, or the nearest position along a line or rim. Tolerances
  are in screen pixels and the tiers mirror picking's, for the same reason.
  The tool is handed a snapped world coordinate and **never learns that
  anything happened** — a tool should be about its own gesture, not about how
  precise the cursor is. A marker shows what was caught (square for an exact
  point, triangle for a midpoint, circle for somewhere along a curve), drawn
  after the tool's own preview so it can never be hidden by it: if the cursor
  is not where it looks, that has to be the most visible thing on screen.
  As built here, snapping makes the click *exact* but joins nothing — two
  points at the same position are still two separate points. The decided next
  step (owner's call, matching Onshape/SolidWorks) is constraint inference:
  the tool applies the corresponding relation — `coin`, point-on-curve,
  midpoint — to whatever it snapped to. Spec in
  `docs/plans/onshape-inference.md`. `snapping(false)` turns snapping, and
  with it inference, off.

## What's next

The working list lives in [`TODO.md`](TODO.md), so it has one home rather
than drifting between two. In short: a picking/selection model (which most
of the rest is waiting on), deleting entities, saving user-authored tools,
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
