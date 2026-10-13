# NeoCAD

A general nonlinear least-squares constraint solver — Rust compiled to
WebAssembly for the numerical kernel, TypeScript for automatic
differentiation and everything above it — with a runtime-extensible
tool-authoring layer on top. There is no server: the Rust/WASM kernel and
the TypeScript layer both run together, client-side, in the browser.

CAD sketching — in 3D, on the planes of coordinate frames, through an
orthographic orbit camera (points, lines, circles, arcs; a relation vocabulary of
distance, coincidence, midpoint, parallel, perpendicular (either of which
takes a coordinate frame's axis by name), angle, point-on-line,
equal-length, radius, on-circle,
concentric, equal-radius, tangent and symmetry; line, rectangle, circle and
arc tools with Onshape-style constraint inference; a fillet; extrude —
a closed loop, holes and all, expanded into a real lid of twins and walls held
by one depth dimension, drawn shaded; and revolve — a loop turned about a frame
axis or a line in its plane, its surface drawn from the live profile and, for a
partial turn, its end face real geometry held by one angle dimension) is the
**first standard library** built on that kernel, not the kernel's whole
purpose. The kernel itself knows nothing about geometry — just a flat
variable vector and residual blocks — so the same solver is meant to be
usable for anything shaped like a nonlinear least-squares problem.

This project is the successor to [`cellwork`](https://github.com/BrotherCreamy/cellwork), a single-file
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
  `test/model.test.ts`, both solving correctly). A few things are
  genuinely dimension-specific, the same way a cross product is genuinely
  3D-only — a coordinate frame exists in 2D and 3D only (above that two
  directions leave a rotation free), and a frame's z axis only in 3D —
  and are marked as such rather than forced to generalize. The app itself
  runs a 3D model; the library takes any dimension.
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
src/model.ts             Entity graph: Point / Line / Circle / Arc / Frame, dimension-generic
src/relations/vec.ts     Dual-vector helpers (dot, wedge) every relation is built from
src/relations/refs.ts    lazy variable lists, and a frame's basis as re-read values
src/relations/basic.ts   dist / fix (frame-relative) / coincident / midpoint — all dimension-generic
src/relations/geometry.ts par / perp / ang (any of which takes a frame axis) / on / eq / rad / oncircle / conc / eqrad / tan / sym
src/operations.ts        operations, which change structure rather than add equations: fillet, extrude, revolve, del, set
src/relations/extrusion.ts the one dimension an extrude's lid is held by: twin = base + depth·ẑ
src/relations/revolution.ts the one dimension a revolve's end face is held by: twin = base turned about the axis
src/persist.ts           save/open — a file is the model's journal, replayed
src/repl.ts              the scoped evaluator: curated scope, no reach into page globals
src/replenv.ts           what that scope contains — the app's whole command surface
src/view.ts              the orthographic camera, as pure testable functions (the 2D transform until turned)
src/vec3.ts              three-vectors over plain numbers, for the camera and arc layout
src/arcgeom.ts           which way round an arc goes, in its own plane — one rule for everyone
src/projection.ts        each entity's shape on screen, and a pixel on it lifted back to the world
src/workplane.ts         what a click lands on in 3D: the default frame's plane, or the one facing you
src/loops.ts             closed loops (joined by shared point or coin, never proximity), and which one a click is in
src/faces.ts             a solid's faces from its live geometry (a revolve's swept): culled, sorted per face, lit from the eye
src/undo.ts              a stack of whole-model snapshots; imports nothing
src/tools/tool.ts         abstract class Tool + defineTool registry
src/tools/engine.ts       wires real DOM pointer events to the armed tool
src/tools/point.ts        the trivial example tool
src/tools/rectangle.ts    the concrete example the Tool API was designed around
src/tools/circle.ts       drag from center to rim
src/tools/circle3.ts      three clicks, a circle through all three
src/tools/arc.ts          center, radius, sweep — a three-click gesture
src/tools/arc3.ts         two endpoints, then a point the arc passes through
src/tools/circumcircle.ts the closed form those two share
src/tools/extrude.ts      click inside a region; it is extruded
src/tools/revolve.ts      click inside a region, then on an axis; it is revolved
src/main.ts              browser entry point (canvas render loop + the REPL)
test/                    node --test, no browser needed (WASM loaded via a byte buffer)
```

## The command line

The input at the bottom of the window is a REPL over the app's own
command surface, and it is the primary interface — not a debug console.
`help()` lists everything in scope.

```js
a = pt(0, 0); b = pt(80, 0)        // entities; each returns its name
setDefaultFrame(frame())           // something to be level with, and fixed to
fix(a, [0, 0]); dist(a, b, 100)    // relations, curried against the model
solve()                            // -> { solved: true, iterations: 3, ... }

c = circ(pt(0, 50), 10)            // a circle, radius free
tan(ln(a, b), c)                   // ...until tangency decides it
solve()

zoom(1.5); pan(0, -20)             // the viewport is just more commands
ls()                               // what's in the model
loops()                            // its closed loops — the profiles an extrude or a revolve will take
extrude("l1", 20)                  // a solid of the loop l1 is in: e1, its depth a dimension
revolve("l5", yaxis(), Math.PI)    // another, turned half way about the default frame's +y
```

**Every constructor argument is optional**, because none of them was ever a
constraint — `circ(centre, r)` only *seeds* a radius, it does not pin one. So
you can create a thing and then say what it is, which is usually what you
actually know:

```js
k = circle()                       // a circle. Defined by nothing, yet
oncircle("p1", k)                  // through these three points, and
oncircle("p2", k); oncircle("p3", k)   // that is the whole 3-point circle
```

Whatever you leave out is auto-created free — a real, named, draggable point,
seeded in the middle of the view so it appears where you are looking — and
`point`/`line`/`circle` are long names for `pt`/`ln`/`circ`. Where a
construction is ambiguous (tangent + through-a-point + radius admits four
circles) the solver returns the branch nearest the seed, and dragging flips
branches, exactly as Onshape does.

**There is no world frame, and no origin.** Geometry is defined by its
relations to other geometry; an origin nobody made is what tempts a drawing
into being related to a global grid instead. So `fix` — and any mention of a
direction to be level with — is relative to a **coordinate frame**, which is a
thing you make: `frame()` is an origin point plus a point fixing +x — two
ordinary, draggable, constrainable points — and `setDefaultFrame(name)` says
which one is meant when none is named. With no frame at all they refuse, and
say what to do about it. A frame draws as a small axes marker at its origin,
brighter when it is the default; drag the marker to move it, or its x-ref to
turn it, and everything levelled or fixed against it follows.

**There is no `hor` or `ver` either**, and for the same reason one step
further on: those words say the universe hands you a privileged pair of
directions. A frame's axes are things you can name — `"f1.x"`, `"f1.y"`, and
in a 3D model `"f1.z"` — and `par`, `perp` and `ang` take one wherever they
take a line. `xaxis()`, `yaxis()` and `zaxis()` fill in the default frame.

```js
f = frame()                        // at the middle of the view, +x to the right
setDefaultFrame(f)                 // ...and now fix and xaxis()/yaxis() mean this one
par("l1", xaxis())                 // "horizontal": level with f
par("l2", yaxis())                 // "vertical"
perp("l3", "f.x")                  // or name the frame outright
fix("p1", [0, 0])                  // at f's own origin
```

The axis is **read and never pushed**: a line levelled against a tilted frame
settles at exactly the frame's tilt, rather than the two meeting halfway. Two
ordinary lines in `par` still move each other; that asymmetry is what makes a
frame a datum.

The viewport works the way Onshape's does: **right-drag orbits**, middle-drag
pans, the wheel zooms about the cursor. The camera is orthographic and starts
square-on — the drawing in the plane z = 0, exactly as a 2D sketcher shows it
— and `orbit(yaw, pitch)`, `pan(dx, dy)`, `zoom(f)` and `lookAt(frame?)` do the
same from the command line (`lookAt` puts a frame's plane square to the screen,
+x right and +y up: Onshape's "normal to sketch"). Navigation is deliberately
on different buttons from tool use, so the left button always belongs to
whichever tool is armed — you can start a rectangle, turn the view to see
where it is going, and finish it without the tool noticing.

**A click lands on the default frame's plane** — set a frame as the default and
every tool draws on it, holding what it draws there with `onplane` — or, with
no default frame, on the plane facing you through the middle of the window. So
sketching on a tilted plane is: make the frame, `setDefaultFrame`, `lookAt`,
draw. `pt(x, y)` is `pt(x, y, 0)`, and `fix(p, [x, y])` is a position on the
frame's plane. A 2D file from before 3D opens lifted into z = 0.

**Right-click without moving opens a menu** for whatever is under the
cursor — an entity, a constraint mark, or empty canvas. Everything on it
is a shortcut to a command: *Dimension* on an edge types
`dist("p3", "p4", 80)` with the length it already has, *Delete* on a
constraint types `del("r5")`, *Set value…* on a dimension types
`set("d1.value", ` and leaves the number to you, and the empty-canvas menu
arms a tool. Each item shows the command beside its label, and the log
records what it typed, so the menu teaches the command line rather than
replacing it.

**Dimensions are named `d1`, `d2`, …** — `dist`, `rad` and `ang`, the
relations that carry a number — while every other constraint is `r1`, `r2`, ….
A dimension is the thing you go back and edit, and editing it is one command:

```js
set("d1.value", 60)   // the same dimension, a different number
```

It rebuilds the dimension in place under the same name, so anything that
referred to `d1` still does; it is one undo step, and the drawing re-solves.
`ang` stores radians, so `set` on an angle takes radians even though the label
on the canvas reads degrees.

Drawing tools are `point`, `rectangle`, `circle`, `circle3`, `arc` and
`arc3` — type the name to arm one. The two numbered ones are Onshape's
*3 point circle* (three clicks, all three on the rim) and *3 point arc*
(the two endpoints, then a point the arc passes through). `fillet` rounds
the corner where two lines meet:

```js
fillet("l1", "l2", 8); solve()     // an arc tangent to both legs
```

Saving is a command too. `save()` returns the file's text and `open(text)`
replaces the model; `download()` and `openFile()` are the browser
conveniences on top, and `journal()` shows what a model is made of.

```js
text = save()                      // the whole drawing, as JSON
open(text)                         // ...and back again
journal()                          // ["addPoint([0,0],\"p1\")", "fillet(\"l1\",\"l2\",8)", ...]
```

A saved file is that journal — the calls that built the model, replayed on
open — because a residual block holds a closure and closures do not survive
JSON. The upshot is that the save format is a transcript of the same public
API you type at the command line, so anything you can type, you can save.

**Ctrl+Z / Cmd+Z** undoes and **Ctrl+Shift+Z** (or **Ctrl+Y**) redoes;
`undo()` and `redo()` do the same thing from the command line. One step is
one thing you did — a command entry that changed the model, a tool commit, a
completed drag, or opening a file — and the mechanism is the save format
above: the stack holds whole models as text, so undo is `open()` on a
snapshot. The exception is that with uncommitted text in the command input
Ctrl+Z stays the browser's, and edits the text.

One thing worth knowing when constraining geometry you intend to modify
later: `par` and `perp` take *either* two point names or a single line
name for their first side, and the two are not interchangeable.
`par("a", "b", xaxis())` pins those two points forever;
`par("l1", xaxis())` means "this edge is level" and re-reads the line's
endpoints every solve. Only the second survives an operation that
re-points the edge — which is exactly what a fillet does when it trims a
corner back. The built-in tools use the line form.

Tools are authored in the same place, through the same `defineTool` the
built-ins use — this is the whole point of the architecture:

```js
defineTool("box", class extends Tool {
  onDown(p) { this.s = p.world; this.ctx.requestRender() }
  onMove(p) { if (this.s) { this.c = p.world; this.ctx.requestRender() } }
  onUp(p) {
    const [x0, y0] = this.s, [x1, y1] = p.world; this.s = null
    const q = pt(x0, y0), r = pt(x1, y0), s = pt(x1, y1), u = pt(x0, y1)
    const [l1, l2, l3, l4] = [ln(q, r), ln(r, s), ln(s, u), ln(u, q)]
    par(l1, l3); par(l2, l4); perp(l1, l2)   // intrinsic: no frame needed
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
npm test               # unit tests — the mathematics, no browser needed
npm run test:e2e       # end-to-end — a real browser driving the real app
npm run test:all       # both, plus typecheck and the Rust crate's own tests
npm run dev            # Vite dev server
```

Rust must be installed via the official script at rustup.rs, **not**
Homebrew's `rustup` formula — see the incident note in `STATUS.md` for
why that matters (it filled a 92GB disk to 20MB free by trying to
compile Rust and LLVM from source).

## Current status

- [`CHANGELOG.md`](CHANGELOG.md) — what's been built, newest first, with
  screenshots. The quickest way to see what this thing actually does.
- [`TODO.md`](TODO.md) — what's next, and which items need a decision
  before they can be started.
- [`STATUS.md`](STATUS.md) — the itemized account of what exists and why
  it's shaped the way it is.
- [`CONVERSATION_LOG.md`](CONVERSATION_LOG.md) — the longer narrative
  behind the decisions, newest first. Useful when picking this up from a
  different machine or a fresh context.

## Contributing

[`CONTRIBUTING.md`](CONTRIBUTING.md) covers setup, the three test suites and
where new code goes; [`docs/ARCHITECTURE.md`](docs/ARCHITECTURE.md) explains
why the layers are drawn where they are. [`CLAUDE.md`](CLAUDE.md) is the terse
version for AI contributors.
