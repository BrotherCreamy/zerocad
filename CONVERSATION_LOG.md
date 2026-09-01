# Conversation log

A narrative record of the session that produced this repo, written so
that context isn't lost when picking this up from a different machine or
a fresh Claude context. This is a summary in my own words, not a literal
transcript. For the itemized technical state, see `STATUS.md`; for the
project pitch, see `README.md`.

## Where this came from

The conversation started as ongoing work on `cellwork`, a single-file
2D CAD sandbox prototype (keyboard-first commands, a hand-rolled dense
Gaussian-elimination solver, hover snaps, a fillet tool with virtual
intersection, derived entities with auto-promotion). That work is still
sitting uncommitted in the `cellwork` repo — extensive edits to
`index.html` and `README.md` that were never committed because commits
there were never explicitly requested. Nothing from that session was
lost; it's just parked, on the `cellwork` side, not this one.

At some point the conversation turned into a request for a from-scratch
rewrite: a general nonlinear constraint solver kernel, properly
engineered (sparse, automatic differentiation, not finite-difference
perturbation over a dense Jacobian), with a runtime-extensible
tool-authoring layer on top, where 2D CAD is the first "standard
library" built on the kernel rather than the kernel's entire purpose.
Key requirements that came out of that discussion (and that shaped
everything built since):

- The kernel should be **dimension-generic** — not hardcoded to 2D
  points, so that relations work the same whether a point has 2 or 3
  coordinates.
- Tools and relations should be **authorable at the command line**, in
  the same language the app itself is written in — not a separate
  plugin API bolted on afterward. The concrete acceptance example given
  was: write a rectangle tool, and dragging with the mouse after
  arming it should drag out an actual rectangle.
- The whole interface — viewport control, save/open, settings — should
  eventually be "tooled up" the same way, so the app is drivable by
  automation/AI the same way a human drives it, not just through GUI-only
  affordances.
- Longer-term, cellwork's already-proven interaction ideas (nested
  `(...)` sub-commands, hover snaps, a real `sel`/`desel` selection
  model, box-select, Onshape-style pan, the icon toolbox) should be
  ported onto the new architecture once there's a foundation worth
  building them on — not reinvented, and not done first.

The user then said they'd be away for a stretch ("I will leave you
running overnight") and asked for as much of this to get built as
possible, unattended.

## Session narrative

**Toolchain setup and a disk-space incident.** Installing Rust via
`brew install rustup-init` triggered Homebrew to compile Rust, LLVM,
cmake, and Python **from source** (no bottle for this macOS version) —
this silently filled a 92GB disk down to 20MB free and briefly broke
basic shell commands, including the sandboxed tool-call path. Diagnosed
the actual cause (not the Rust build itself, which was still small at
that point, but two unrelated large caches: 7.2GB in
`~/Library/Caches/vscode-cpptools`, VS Code's C++ IntelliSense cache, and
Homebrew's own download/build cache) and recovered to 8GB+ free by
clearing both — both fully regenerable, nothing of the user's own work
was at risk. Reinstalled Rust via the official `rustup.rs` script
instead, which downloads prebuilt binaries rather than compiling, and
does not repeat the problem. Full detail in `STATUS.md`'s incident note.

**The kernel.** Built `kernel-rs/`, a Rust crate compiling to WASM via
`wasm-pack`, exposing one function — a matrix-free conjugate-gradient
solve of the damped normal equations `(JᵀJ + λ(1+diag(JᵀJ))) dx = -Jᵀr`,
never forming `JᵀJ` explicitly so it scales to sparse systems. Gave it
its own native Rust unit tests (identity system, an overdetermined
least-squares average, decoupled-variable independence) that run without
touching WASM or a browser at all.

**Automatic differentiation.** Built `src/kernel/dual.ts`: forward-mode
AD via dual numbers, so a residual written with `.add`/`.mul`/`.sin`/
`.sqrt`/etc. arithmetic yields both its exact value and its exact sparse
gradient from one evaluation — no finite-difference perturbation, no
extra residual evaluations per variable. Checked directly against
finite differences on a nonlinear test residual to make sure the chain
rule implementation itself was right, independent of the solver.

**`Problem`, the kernel's public surface.** `src/kernel/problem.ts`:
a flat variable vector plus `addResidual(varIndices, fn)` blocks. It
knows nothing about points, lines, or CAD. `solve()` runs
Levenberg-Marquardt, calling into the WASM kernel once per Newton step
for the linear solve, warm-started, with damping/trust-region step
acceptance living in TypeScript. Verified end to end in Node: a
distance-constrained two-point system solves to the exact target length,
and an intentionally contradictory system correctly reports
`solved: false` naming the offending residual, rather than silently
pretending to succeed.

**The dimension-generic proof.** `src/model.ts` (a `Point` is a name
plus one `Problem` variable per `model.dim` coordinate — nothing else
hardcoded to 2D) and `src/relations/basic.ts` (`dist`/`fix`/
`coincident`/`midpoint`, all generic over `model.dim`). Rather than just
claiming this generalizes, `test/model.test.ts` runs the *identical*
relation code against a 2D model and a separately-constructed 3D model
in two different tests, both solving correctly. `horizontal`/`vertical`
were added later and deliberately kept 2D-only, the same way a cross
product is genuinely 3D-only rather than something to force-generalize.

**First browser milestone.** `index.html` + `src/main.ts`, served via
Vite: loaded the WASM kernel over `fetch` (the actual browser path, as
opposed to the Node test suite's byte-buffer shortcut), built a small
solved model, rendered it to canvas. Verified via headless Chrome
automation (CDP) rather than taking it on faith — screenshotted the
result, confirmed the solve converged and the rendered positions matched
the expected geometry.

**Handoff to `/loop`.** At this point the user invoked `/loop` with no
argument (the dynamic self-pacing autonomous mode) — read as "yes, keep
pushing on this across a longer unattended stretch" following directly
from an offer made in the previous message. Continued the same
documented plan autonomously from there.

**The tool-authoring layer.** `src/tools/tool.ts`: `abstract class Tool
{ onDown/onMove/onUp/onCancel/render }`, a `ToolContext` (model +
`requestRender`/`requestSolve`/`finish` — no ambient globals reachable
from inside a tool), and `defineTool(name, ctor)` for registration.
`src/tools/engine.ts` wires real DOM pointer events to whichever tool is
armed, with a 2D screen<->world transform matching cellwork's own
convention, and a one-shot-by-default lifecycle (a tool deactivates once
it calls `ctx.finish()`, mirroring how cellwork's own pointer tools
completed a gesture and had to be re-armed for the next one). Built two
tools on that API with nothing privileged about either: `point.ts` (the
trivial case) and `rectangle.ts` — the concrete example named in the
brief. `onDown` remembers the first corner *without* touching the model;
`onMove` only requests a live preview redraw; `render()` draws a dashed
preview from the tool's own in-progress state; `onUp` is the only place
anything is actually committed (four points, four lines, `hor`/`ver`
relations, one solve).

Rather than trust this from unit tests alone, verified it with an actual
synthetic mouse drag over CDP against the running dev server: mid-drag
the model has zero entities (a true live preview, nothing committed
early), releasing the mouse commits exactly four points and four lines
forming a precise axis-aligned rectangle matching the drag distance, the
status line flips to `SOLVED`, and the tool deactivates afterward with
no exceptions thrown. `test/tools.test.ts` covers the same ground at the
unit level plus an edge case (a click with no real drag distance commits
nothing). 10/10 tests passing at that point.

**Questions and a detour.** Reported back at that milestone; the user
then asked two things: whether this is a traditional frontend/backend
split (answered: no — there's no server; TypeScript and the Rust/WASM
kernel both run together, client-side, in the browser), and whether it
could be hosted somewhere to view directly. Started down the path of
installing `cloudflared` to open a quick tunnel to the local Vite dev
server (a temporary, unauthenticated, no-account-needed public URL) so
the running app could be watched live as work continued — this was
interrupted mid-`brew install` when the user decided to move to
continuing this on a Windows machine instead. No tunnel was actually
opened; nothing about the app itself changed from that detour.

**This log.** Written at the user's request, specifically to carry
context across that machine switch — so a fresh session (on Windows or
anywhere else) starting from this repo has the reasoning behind the
architecture, not just the code.

## Build and test notes

Still current, and the things most likely to trip up a fresh checkout:

- `npm install && npm run build:kernel` regenerates `src/kernel/wasm-gen/`
  (gitignored — it's a build artifact, not source). Requires Rust via
  the official `rustup.rs` installer, not Homebrew, for the reason in
  the incident note above.
- `npm test` runs everything in `test/` via Node's native
  `--experimental-strip-types` — no `ts-node`/`tsx` dependency. Relative
  imports between local `.ts` files must include the literal `.ts`
  extension for this to resolve (Node's strip-only mode does no module
  resolution beyond that); this project also avoids TypeScript
  parameter-property constructor shorthand for the same reason (it needs
  real transformation, not just type-stripping).
- `npm run dev` starts Vite. The command input at the bottom of the
  window is the REPL (`src/repl.ts`); a bare tool name arms that tool,
  anything else is evaluated.
- See `STATUS.md` for the itemized "not started yet" list.

## Picking it back up on a fresh machine

Resumed from this repo with no prior context beyond what is written down
here — which is exactly what this log was written for, so the first thing
worth recording is that it worked. `README.md` explained the intent,
`STATUS.md`'s "not started yet" list said what was next, and this file
supplied the reasoning behind the architecture. Nothing had to be
guessed at.

One environment wrinkle, noted in case it recurs: `wasm-pack` builds the
release profile by downloading `binaryen` for the `wasm-opt` pass, and
that download was blocked here. `wasm-pack build --dev` skips `wasm-opt`
and is fine for running tests. That is a property of this sandbox, not of
the project, so `Cargo.toml` was deliberately left alone rather than
switching `wasm-opt` off for everyone.

**Circles and arcs.** `Circle` is a center point reference plus one
variable of its own — the radius; `Arc` is that plus a named start and
end point. Both were kept purely *structural*, following the precedent
`Line` already set by owning no variables at all: what makes an arc's
endpoints lie on its own circle is the `arcends` relation, not the
constructor, for the same reason a `Line` doesn't imply `hor`/`ver`. The
model holds structure; relations hold equations. `model.circular(name)`
reads a circle or an arc indifferently, so every radius-aware relation
accepts either without knowing which it got.

**The rest of the relation vocabulary.** `par`, `perp`, `ang`, `on`,
`eq`, `rad`, `oncircle`, `conc`, `eqrad`, `tan`, `sym`, `arcends`. The
interesting discovery here was how *few* of these are actually 2D. Written
through `dot()` and `wedge()` — pulled into a new `relations/vec.ts` that
`basic.ts` now shares — the definitions people think of as planar hold
unchanged in any dimension: "parallel" is "the wedge vanishes" whether
that wedge has one component or three. Symmetry about a line turned out
generic for a subtler reason: the two conditions (midpoint on the line,
connecting segment perpendicular to it) describe the mirror in 2D and a
half-turn about the axis in 3D, which is the same relation one dimension
up. Rather than assert that in a comment, `test/geometry.test.ts` runs
the identical code against a real 3D model and checks the half-turn lands
where it should.

One numerical decision worth writing down: the wedge is kept as its
*components* rather than their summed square. The square is the tempting
form — one residual instead of three — but a residual that is already a
square has a vanishing gradient at its own root, so least-squares would
be minimising a fourth power, and convergence suffers badly for it.

**The REPL — the thing the whole brief was pointed at.** Two files:
`repl.ts` is the evaluator, `replenv.ts` is what it can see. "Scoped, not
raw `eval`" is done the standard way: an entry runs inside a `with` block
over a Proxy whose `has` trap claims *every* name, so no identifier can
fall through to the page's globals, and whose `get` trap throws
`no such name: modle` instead of quietly handing back `undefined`.

Being honest about what that is mattered more than making it sound
stronger than it is, so it is documented as *curation, not a security
boundary* — in the source, in `STATUS.md`, and in the README. It exists so
an entry sees a small deliberate surface and so typos are caught early.
Code typed there still runs with the engine's own authority; genuinely
untrusted code would need a worker or an iframe, which is a different
feature with a different threat model. Claiming otherwise would have been
easy and wrong.

Two consequences of the `with` scope are worth knowing and are documented
rather than smoothed over: a bare assignment persists to later entries
(the Proxy's `set` trap catches it), while a `const`/`let`/`class`
declaration does not (it binds to the entry's own function scope and goes
away with it). That is a real wart, but a predictable one, and the
alternative — parsing declarations out of each entry — is a lot of
machinery for a small gain.

`replenv.ts` binds relations under the short sketch names (`par`, `perp`,
`tan`) with the long ones alongside, each curried against the model so
`dist("a", "b", 10)` reads the way it should. Viewport control went in as
ordinary commands at the same time — `zoom`, `pan`, `arm`, `cancel`,
`ls`, `solve`, `help` — which was the brief's "tool up the whole
interface" goal, now true for everything except save/open.

**The acceptance test, met literally.** Verified in headless Chrome
against the real dev server rather than only in unit tests: a rectangle
tool *typed into the command line* — a class plus one `defineTool` call,
carrying its own dashed-preview `render()` — lands in the same registry
the built-ins use, arms by bare name, and drags out with a real mouse.
Mid-drag the model is untouched and only the tool's own green preview
draws; on release exactly four points and four lines commit, matching the
drag distance; status flips to `SOLVED`; the tool stands down. Alongside
that: circle/tangency/arc construction from the command line, `document`
being genuinely unreachable from an entry *on a page that has one*, and a
deliberately contradictory constraint reporting `CONFLICT` with the
offending relation named. 42 unit tests, 19 browser checks, all passing.

Two bugs the browser run caught that the unit tests could not, both worth
recording because they are the same shape — state that only exists once
the app is assembled:

- `solve()` typed at the REPL called `model.solve()` directly, so the
  status readout kept showing the *previous* verdict. A conflict could be
  introduced at the command line and the header would still cheerfully
  read `SOLVED`. Fixed by giving `EnvHandles` an optional `solve` the host
  wires to its own solve-and-render path, so a command-line solve
  refreshes the viewport exactly as a tool-triggered one does — with a
  regression test pinning it.
- The first browser run also failed on a check that turned out to be the
  *test script's* bug rather than the app's: it constrained one circle
  with both `rad(c, 20)` and a tangency implying 30, and the solver
  correctly refused to call the result solved. That is the behaviour you
  want, so the deliberate-conflict case was kept as its own check instead
  of being deleted.

The README's command-line examples are executed verbatim by a script
before being committed, on the principle that documentation which has
never been run is a guess.

## What to know before continuing

The `STATUS.md` "not started yet" list is now: a **fillet** (the most
interesting one left — it has to create an arc *and* constrain it tangent
to both legs in a single move), **circle/arc drawing tools** (the
entities and relations exist and are reachable from the command line, but
there is no drag-to-create tool for them yet the way `rectangle.ts`
exists), **save/open as commands**, and the rest of the cellwork
interaction ideas.

On save/open specifically, the shape of the problem is now clear enough
to write down: a model is a flat variable vector, a set of named
entities, and a set of residual blocks. The first two serialise
directly. The third does not — a residual block holds a *closure* — so
saving a model means recording the sequence of commands that built it and
replaying them, rather than trying to serialise the blocks. Which is
tidy, because those commands are exactly what the REPL already takes.
