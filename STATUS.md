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

## Not started yet

- Tool-authoring layer: the `abstract class Tool { onDown/onMove/onUp/
  render }` API + a registry (`defineTool`), so built-in tools are
  ordinary uses of the same extension point a user/AI would use at the
  REPL.
- The 2D geometry "standard library" (point, line, circle, arc, and the
  relation vocabulary — dist/hor/ver/coin/mid/sym/fix/par/perp/ang/on/
  rad/eq/tan/fillet) reimplemented as `Problem` residual blocks using
  `Dual` arithmetic, generalized over an N-length coordinate vector per
  point rather than hardcoded x/y (2D now, 3D is "add the 3D layer").
- Canvas rendering + the command-line REPL (a scoped JS/TS evaluator,
  not raw `eval` on `window` — curated globals only: the kernel API,
  math, the tool registry).
- Viewport control, save/open, and settings exposed as ordinary commands
  in that same language, per the brief's "tool up the whole interface
  for AI/automation use" goal.
- Porting the interaction niceties already proven out in `cellwork`
  (nested `(...)` sub-commands, hover snaps, selection via a real `sel`/
  `desel` command, box-select, Onshape-style pan controls, the icon
  toolbox) onto the new architecture — not reinventing them, just
  carrying the same *ideas* over since they were already validated there.

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
