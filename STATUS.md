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

## Not started yet

- A **fillet** tool/relation — the one item from cellwork's vocabulary not
  yet carried over, and the most interesting, since it has to create
  geometry (an arc) *and* constrain it (tangent to both legs) in one move.
- **Circle and arc drawing tools.** The entities and their relations exist
  and are reachable from the command line, but there is no drag-to-create
  circle or arc tool yet the way `rectangle.ts` exists for rectangles.
- **Save/open** as ordinary commands in the same language — the remaining
  piece of the "tool up the whole interface" goal now that viewport
  control is done. A model is a flat variable vector plus named entities
  plus residual blocks; the first two serialise directly, the third is the
  open question (a residual block holds a *closure*, so saving a model
  means saving the calls that built it, not the closures themselves).
- Porting the rest of the interaction niceties already proven out in
  `cellwork` (nested `(...)` sub-commands, hover snaps, selection via a
  real `sel`/`desel` command, box-select, Onshape-style pan controls, the
  icon toolbox) onto the new architecture — not reinventing them, just
  carrying the same *ideas* over since they were already validated there.
  The REPL landing is what unblocks most of these: `sel`/`desel` and the
  nested sub-commands are command-language features, and there is now a
  command language to put them in.

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
