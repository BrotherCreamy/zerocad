# Conversation log

A narrative record of the session that produced this repo, written so
that context isn't lost when picking this up from a different machine or
a fresh Claude context. This is a summary in my own words, not a literal
transcript. Entries below are newest first.

For the itemized technical state see `STATUS.md`, for what's next see
`TODO.md`, for a shorter screenshot-carrying version of this story see
`CHANGELOG.md`, and for the project pitch see `README.md`.

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

## What to know before continuing

The `STATUS.md` "not started yet" list is now: **deleting entities**, **a
picking/selection model**, **saving user-authored tools and relations**,
and the remaining cellwork interaction ideas (hover snaps, `sel`/`desel`,
box-select, nested `(...)` sub-commands, the icon toolbox) — most of which
want the picking model first, and several of which are UX decisions with
prior art in cellwork worth consulting rather than guessing at.

Saving user-authored definitions is the interesting one to think about
before building. A file currently records calls into the built-in
vocabulary, which is why it can be plain data. A tool defined at the REPL
is a closure, so saving it means saving its *source* — and a file that
carries code is a different kind of file, with a different set of
questions about what opening one is allowed to do. That is a decision
worth making deliberately rather than drifting into.

On deleting: variables live in a flat vector, so removing one means
compacting it and remapping every block that refers to a later index. The
lazy-`varIndices` change makes that more tractable than it was, since a
block can now resolve through an entity rather than holding a raw index.

A pointer-driven fillet tool — click two lines, round the corner — is
waiting on picking, not on the fillet itself. The operation is done and
reachable from the command line; what it needs is hit-testing, which is
the same work as `sel`/`desel`.

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

---

## Log

Newest first. Each entry is the reasoning behind a chunk of work —
`CHANGELOG.md` is the shorter, screenshot-carrying version of the same
story, and `TODO.md` is what is still ahead.

### Picking, and reading cellwork instead of guessing

`TODO.md` had picking at the top with a *decision needed* flag: cellwork had
already solved this and the ideas were validated there, so porting beat
inventing — but that meant actually reading it rather than assuming what it
did. So cellwork was cloned into the session and read.

Just as well. The TODO said "a real `sel`/`desel` pair", which I had made up.
cellwork's answer is different and better: **there is no selection set at
all.** Clicking geometry calls `insertToken(name)` and drops the name into the
command line. Its README states the principle outright — "the viewport is a
selection portal — clicking geometry only drops its name into the command
line."

That fits neocad even better than it fitted cellwork, because every relation
here takes entity names as strings. Type `dist(`, click two points, and the
input reads `dist("p1", "p2"`. Nothing accumulates, nothing needs clearing,
and there is exactly one way to refer to an entity.

The hit-testing is cellwork's too, including the parts that look arbitrary
until you think about them. It works in **screen** space, so the tolerance is a
constant number of pixels at any zoom — which is what a hand expects. And it is
*tiered* rather than nearest-wins: points (8px) beat curves (6px) beat lines
(5px), because a point sitting on a line is under the cursor at the same time
as the line, and it is almost always the point that was meant.

One deliberate difference. cellwork pans by left-dragging empty space; neocad
reserves the left button for the armed tool. Both are kept: with a tool armed
the left button is the tool's, and with nothing armed a left-drag pans and a
left-click picks. The right and middle buttons pan either way.

**Two more assembly bugs, both found by looking at a screenshot.** The first
render of the picking screenshot had an ellipse in it where a circle should
have been. The canvas bitmap only resized on `window.resize`, and the log pane
grows as commands are typed, taking height from the viewport — so the bitmap
kept its old aspect and the drawing was squashed to fit. That had been true for
a long time and no assertion had ever noticed. A `ResizeObserver` fixes it,
with a test that the bitmap keeps square pixels as the log fills.

The same screenshot showed the command line reading `dist("p1" "p2"` — no
comma. cellwork's commands are space-separated so it never needed one; neocad's
are function calls, so it does. Picks are comma-separated now, which is the
difference between "most of the call is written" and "most of the call is
written but you have to punctuate it".

That is six bugs now that passed the whole unit suite and were obvious on
sight. It is a consistent enough pattern to be worth stating as a rule, which
`CLAUDE.md` and `CONTRIBUTING.md` now do: run the app, and when you take a
screenshot to check something, actually look at it.

**Also this round:** the browser verification moved into the repo as
`npm run test:e2e`. It had been living in a scratchpad outside the repository,
which made every "verified in a browser" claim unreproducible by anyone else —
including by me in a later session. The runner owns the dev server rather than
the harness doing it, because node's test runner runs files in parallel and
five processes racing for one port is not a test; and it spawns vite's binary
directly rather than `npm run dev`, because npm spawns a shell which spawns
vite, so killing what we spawned left the real server orphaned and the port
held for the next run.

The harness's `at()` helper also grew a guard worth keeping: it refuses
coordinates outside the canvas. Several tests were silently clicking below the
canvas's bottom edge once the log pane had grown, which reads as "the feature
is broken" rather than "the coordinate was wrong". It now says which it is.

### Mouse navigation

Until now the viewport could only be driven by `zoom()` and `pan()` at the
command line, which is a strange way to have to look around a drawing.
`STATUS.md` named "Onshape-style pan controls" specifically, so the design
was already settled: wheel zooms about the cursor, right- or middle-drag
pans.

The part worth writing down is *why* navigation is on separate buttons.
The left button belongs to whichever tool is armed and nothing else, which
means the drawing can be re-framed in the middle of a gesture — start a
rectangle, pan to see where it is heading, finish it, and the tool never
sees the pan at all.

Making that actually work turned on a detail of the pointer spec. Pressing
a second button while one is already held does **not** fire another
`pointerdown`; it arrives as a `pointermove` with the `buttons` mask
updated. The first implementation keyed off `button` (what just changed)
and so panning mid-gesture silently did nothing — the browser pass caught
it, which is the fourth time now that only running the thing surfaced the
problem. Panning watches the mask instead, and releases the same way,
because the release of the second button is likewise reported as a move
rather than an up.

The transform moved out to `src/view.ts` as pure functions over
`{ox, oy, scale}`, mostly so the arithmetic could be tested without a
canvas. Zoom-about-a-point is solved directly — read the world point under
the cursor, then place the origin so it lands back on the same pixel —
rather than nudged, so the anchor does not drift as zooms accumulate. A
test zooms in twenty notches and back out twenty and checks the view is
where it started.

### Save and open, and a loop that had been waiting to hang

The last piece of the brief's "tool up the whole interface" goal, and the
design had already been written down twice in earlier passes, so this was
honouring a stated plan rather than inventing one.

**A file is the journal.** A model cannot be serialised directly, because
a residual block holds a closure and closures do not survive JSON. What
survives is the sequence of calls that produced them. So `Model` gained a
journal — every entity created, every relation applied, every operation
run — and a saved file is that list, replayed on open.

This is a better answer than it first sounds. The save format is not a
second description of the model's internals that has to be kept in step
with them; it is a transcript of the public API. Anything you can type at
the command line, you can save, and vice versa. An operation is journalled
as the single call the user made rather than the handful of entities and
relations it expands into, so a fillet reads as `fillet("l1","l2",5)` and
re-expands identically on replay.

Solved coordinates ride along and are restored after the replay. Not
strictly necessary — replaying and re-solving reaches *a* valid
configuration — but an under-constrained model has many, and reopening a
drawing should give back the one that was saved rather than whichever the
solver happens to find that day.

Opening only ever performs calls from a fixed table, so a file is data
rather than a script. A test for that caught something worth keeping: the
table was a plain object, and a file naming `"constructor"` sailed past
the `if (!table[op])` guard, because object lookup walks up to
`Object.prototype`. It is a `Map` now, which has no prototype chain.

**The bug underneath.** Wiring `open()` into the browser hung the page
outright — not an exception, a spin that took the tab with it. The Node
round-trip tests all passed, which narrowed it to the host, and it turned
out not to be in the new code at all:

```js
const n = (this.counters.get(prefix) ?? 0) + 1;   // const
while (this.entities.has(name)) {
  this.counters.set(prefix, n + 1);               // always the same n
  name = `${prefix}${this.counters.get(prefix)}`;
}
```

`Model.autoName` had always been able to loop forever — any two
consecutive taken names and it recomputes the same candidate until the tab
dies. Nothing had ever hit it, because names were only ever handed out in
order. A replay is the first thing that takes names *out of order*: every
journal entry carries the explicit name it was saved under, so the
counters stay at zero, and then the fillet's own internal `addPoint()`
asks for an auto-name, finds `p1` taken, finds `p2` taken, and spins.

Fixed on both sides: the loop increments properly, and an explicit name
shaped like an auto-generated one now moves the counter past it — which is
the right behaviour anyway, replay or not. Naming a point `p7` by hand
should mean the next automatic one is `p8`.

That is the third bug in this project's life that only appeared once the
app was assembled and driven — after the stale status readout and the
fillet that passed every numerical check while drawing a broken rectangle.
All three were invisible to unit tests and obvious within seconds of
running the thing. Worth keeping the browser pass in the loop for anything
that touches the app rather than the mathematics.

### Sketch tools, the fillet, and a contract change it forced

Continuing down the `STATUS.md` list.

**Circle and arc tools.** Circle is a drag from center to rim. Arc is
three clicks — center, radius, sweep — and it was the interesting one,
because it is the first tool to span more than a single gesture. That
needed no engine change whatsoever: a tool stays armed until it calls
`ctx.finish()`, so "multi-stage" is just "finishes later". The one-shot
lifecycle turned out to have been the right shape already, which is
pleasant to discover rather than assume.

Both leave the radius unconstrained on commit. That follows the
rectangle tool's existing choice not to dimension the box it draws: the
shape keeps the size it was drawn at, because nothing pulls on that
variable and the solver leaves it alone, while staying free to be driven
later by a `rad` or a tangency. Pinning it would make every drawn circle
rigid, which is the wrong default for a constraint sketcher.

**The fillet.** The satisfying part is that it needed no new mathematics
at all — `tan` on each leg, `arcends`, `rad`, and that is the whole
thing. Those four are also *complete*, which is worth stating because it
is not obvious: a tangent line touches its circle at exactly one point,
so an endpoint lying on both the leg and the circle can only be the
point of tangency. There is nothing further to say.

Structurally it reuses the shared corner as the tangent point on the
first leg instead of replacing it, so nothing is orphaned. That was a
deliberate constraint on the design rather than an optimisation: the
model has no delete yet, so an operation that stranded points would
leave stray dots on the canvas forever.

It also earned `src/operations.ts` a file of its own, because "operation"
and "relation" are genuinely different things and it is worth naming the
difference. A relation only ever adds an equation; the worst it can do is
over- or under-constrain. An operation changes the structure and can
leave the model malformed. They want reviewing with different eyes.

**The contract change the fillet forced.** The first browser run of the
fillet passed every numerical check — tangent to both legs to six
decimal places — and produced a visibly broken rectangle. The right edge
had gone slack and slanted.

The cause: relations captured *variable indices* when they were created.
The rectangle tool had said `hor(cornerA, cornerB)`, meaning "this edge
is level" but saying "these two points share a y". When the fillet
re-pointed the edge at a new tangent point, the constraint stayed behind
on the old corner and the edge was left free to swing.

The first instinct was to document this as a caveat and move on, and
that is in fact what the first pass did — the note said fixing it
properly was "too big to smuggle in alongside a fillet." Then the
screenshot arrived. Filleting a rectangle is the most obvious thing
anyone would try with this feature, and it produced garbage. Going back
to actually measure the change rather than estimate it: four lines in
`problem.ts`. The earlier judgement had been made without looking.

So `Problem.addResidual` now takes either a fixed index list or a thunk
re-consulted at every evaluation, and every line-taking relation uses the
thunk. `hor`/`ver` take either two point names or one line name — both
are real things a sketcher means when they pick something and say
"level" — and the built-in tools use the line form. A relation on a line
now genuinely means *this line*, and follows it through structural
surgery.

The two forms are kept, rather than the point form being removed, because
both are legitimate; the difference is documented at every level and both
behaviours are pinned by tests, so nobody has to rediscover it from a bad
screenshot. Filleting a drawn rectangle now keeps the rectangle square.

The lesson worth keeping: the numerical checks all passed. Only rendering
the thing and looking at it caught this. That is the second bug in two
sessions that only appeared once the app was assembled and drawn — the
first being the stale status readout — and both would have shipped on
unit tests alone.

### Picking it back up on a fresh machine

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

### Session narrative

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
