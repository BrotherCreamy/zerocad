# NeoCAD

A general nonlinear least-squares constraint solver — Rust compiled to
WebAssembly for the numerical kernel, TypeScript for automatic
differentiation and everything above it — with a runtime-extensible
tool-authoring layer on top. There is no server: the Rust/WASM kernel and
the TypeScript layer both run together, client-side, in the browser.

2D CAD sketching (points, lines, circles, arcs; a relation vocabulary of
distance, coincidence, midpoint, horizontal/vertical, parallel,
perpendicular, angle, point-on-line, equal-length, radius, on-circle,
concentric, equal-radius, tangent and symmetry; a drag-to-create
rectangle tool) is the **first standard library** built on that kernel,
not the kernel's whole purpose. The kernel itself knows nothing about geometry — just a flat
variable vector and residual blocks — so the same solver is meant to be
usable for anything shaped like a nonlinear least-squares problem.

This project is the successor to [`cellwork`](../cellwork), a single-file
prototype that proved out the CAD interaction ideas (keyboard-first
commands, live constraint solving, hover snaps, a fillet tool) but with a
hand-rolled dense Gaussian-elimination solver and no extensibility story.
NeoCAD is a from-scratch rewrite around a real kernel, built so that
**new tools and relations can be authored live, in the same language the
app itself is written in** — a rectangle tool, for instance, is nothing
more than a class with `onDown`/`onMove`/`onUp`/`render` methods and one
registration call (see `src/tools/rectangle.ts`), not a privileged
built-in.

## Why a rewrite, not an iteration on cellwork

The brief that started this project asked for a kernel that is:
- **Dimension-generic**, not hardcoded to 2D — a relation like `dist` or
  `midpoint` should work unchanged whether a point has 2 coordinates or
  3 (`src/relations/basic.ts` proves this: the identical relation
  functions are run against a 2D model and a 3D model in
  `test/model.test.ts`, both solving correctly). Some relations —
  `horizontal`/`vertical` — are genuinely 2D-only concepts, the same way
  a cross product is genuinely 3D-only, and are marked as such rather
  than forced to generalize.
- **Extensible from the command line**: type a new tool's definition into
  the REPL and have it immediately usable in the viewport — the same
  extension point built-in tools use, not a separate plugin API. This
  works now. The acceptance test that seeded it, "I should be able to
  write a rectangle tool and drag one out with the mouse," is verified
  literally: a rectangle tool *typed at the command line* registers
  through the same `defineTool` a built-in uses, arms by name, and drags
  out with real synthetic mouse events in headless Chrome — mid-drag
  only its own preview draws, release commits the geometry.
  "Scoped evaluator, not raw `eval`" means an entry resolves identifiers
  against a curated scope (`src/replenv.ts`) rather than the page's
  globals, so `document` is simply not a name that exists and a typo
  gets `no such name: modle` instead of `undefined`. That is curation
  for legibility, not a security sandbox — see `STATUS.md`.
- **AI/automation-friendly**: viewport control is now an ordinary command
  in that same language (`zoom`, `pan`, `arm`, `cancel`, `ls`, `solve`),
  not a GUI-only affordance — so the app is drivable the same way a tool
  or relation is authored. Save/open are the remaining pieces.
- A **from-scratch kernel**, not cellwork's dense in-browser Gaussian
  elimination: Rust/WASM with a matrix-free conjugate-gradient linear
  solve (never forms `JᵀJ` explicitly, so it scales to sparse systems)
  and exact sparse Jacobians via forward-mode automatic differentiation
  (`src/kernel/dual.ts`) instead of finite-difference perturbation.

Longer-term, the plan is to port the interaction ideas cellwork already
validated — nested `(...)` sub-commands, hover snaps, a real `sel`/`desel`
selection model, box-select, Onshape-style pan controls, the icon
toolbox — onto this new architecture. Not reinventing them, just
carrying proven ideas over once there's a foundation worth building them
on top of. The REPL landing is what unblocks most of that: `sel`/`desel`
and the nested sub-commands are command-language features, and there is
now a command language to put them in.

## Layout

```
kernel-rs/              Rust crate -> WASM. The only place linear algebra happens.
src/kernel/dual.ts       forward-mode automatic differentiation (dual numbers)
src/kernel/problem.ts    Problem: variables + residual blocks + solve() (LM loop)
src/model.ts             Entity graph: Point / Line / Circle / Arc, dimension-generic
src/relations/vec.ts     Dual-vector helpers (dot, wedge) every relation is built from
src/relations/basic.ts   dist / fix / coincident / midpoint (generic) / hor / ver (2D-only)
src/relations/geometry.ts par / perp / ang / on / eq / rad / oncircle / conc / eqrad / tan / sym
src/repl.ts              the scoped evaluator: curated scope, no reach into page globals
src/replenv.ts           what that scope contains — the app's whole command surface
src/tools/tool.ts         abstract class Tool + defineTool registry
src/tools/engine.ts       wires real DOM pointer events to the armed tool
src/tools/point.ts        the trivial example tool
src/tools/rectangle.ts    the concrete example the Tool API was designed around
src/main.ts              browser entry point (canvas render loop + the REPL)
test/                    node --test, no browser needed (WASM loaded via a byte buffer)
```

## The command line

The input at the bottom of the window is a REPL over the app's own
command surface, and it is the primary interface — not a debug console.
`help()` lists everything in scope.

```js
a = pt(0, 0); b = pt(80, 0)        // entities; each returns its name
fix(a, [0, 0]); dist(a, b, 100)    // relations, curried against the model
solve()                            // -> { solved: true, iterations: 3, ... }

c = circ(pt(0, 50), 10)            // a circle, radius free
tan(ln(a, b), c)                   // ...until tangency decides it
solve()

zoom(1.5); pan(0, -20)             // the viewport is just more commands
ls()                               // what's in the model
```

Tools are authored in the same place, through the same `defineTool` the
built-ins use — this is the whole point of the architecture:

```js
defineTool("box", class extends Tool {
  onDown(p) { this.s = p.world; this.ctx.requestRender() }
  onMove(p) { if (this.s) { this.c = p.world; this.ctx.requestRender() } }
  onUp(p) {
    const [x0, y0] = this.s, [x1, y1] = p.world; this.s = null
    const q = pt(x0, y0), r = pt(x1, y0), s = pt(x1, y1), u = pt(x0, y1)
    ln(q, r); ln(r, s); ln(s, u); ln(u, q)
    hor(q, r); hor(u, s); ver(q, u); ver(r, s)
    this.ctx.requestSolve(); this.ctx.finish()
  }
  render(r) { /* draw a live preview from this.s / this.c */ }
})
```

Then type `box` and drag one out. A bare tool name arms it; anything else
is evaluated. Note that a bare assignment (`box = ...`) persists between
entries while a `const`/`let`/`class` declaration does not — a
consequence of how the scope is built, described in `src/repl.ts`.

## Building and running

```sh
npm install
npm run build:kernel   # cargo -> wasm-pack, produces src/kernel/wasm-gen/ (gitignored, regenerated)
npm test                # Rust unit tests are separate: npm run test:kernel
npm run dev             # Vite dev server
```

Rust must be installed via the official script at rustup.rs, **not**
Homebrew's `rustup` formula — see the incident note in `STATUS.md` for
why that matters (it filled a 92GB disk to 20MB free by trying to
compile Rust and LLVM from source).

## Current status

See [`STATUS.md`](STATUS.md) for the up-to-date, itemized account of
what's built and verified versus what's still ahead, and
[`CONVERSATION_LOG.md`](CONVERSATION_LOG.md) for the narrative of how
this session went — useful if picking this up from a different machine
or a fresh context.
