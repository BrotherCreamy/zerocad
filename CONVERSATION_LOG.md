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

### Dimension labels: the number was already in the model

The whole package is a rendering change, and that is the point of it. A
relation registry entry has kept `args` — the call exactly as it was made —
since relations became named, so `dist("p1","p2",50)` has always had the 50
sitting in it; the drawing just never said so. Nothing was added to the model,
the journal, `persist.ts`'s replay table or the relation vocabulary. If a
package this visible needs no change below the UI, the layering underneath it
is doing its job.

**The one real design decision was to make a label a glyph rather than a
dimensions overlay.** An overlay would have had to grow its own hover, its own
picking tier, its own highlight path and its own visibility switch, all
duplicating the four `glyphs.ts` already has, and then drift from them one fix
at a time. As a glyph, every one of those behaviours came for free and the e2e
suite could assert them by asking `engine.glyphs()` the same questions the
existing glyph suite asks. The only thing a label genuinely needed was a box
the width of its text — `halfW` per glyph, which `glyphAt` and `main.ts` both
read — because a hit-box frozen at a mark's 18px square clips a number and
makes aiming at its last digit a miss.

**`glyphs.ts` still has no canvas, and that cost something honest.** Sizing a
box to text wants `measureText`, which would have meant a canvas in a module
whose whole testability comes from being a pure function of (model, view). So
the width comes from a constant, `GLYPH_CHAR_W`, which is a *claim* about the
font `main.ts` sets — and the browser measured 7.2246px against the 7.2 in the
source. A comment saying "keep these in step" would have rotted; an e2e test
that measures the real advance and fails on drift will not.

**Extension lines: the spec delegated this and the browser answered it.**
Built solid first, they looked like geometry. The case that settled it was a
`dist` across a rectangle's diagonal: the dimension line drew what any reader
would take for a diagonal edge, in a sketch that has no such edge. The
tempting conclusion was to drop them — but that same diagonal is the case that
*needs* them, because a `dist` need not lie along any line, and without them
its number floats in the middle of the drawing with nothing saying which two
points it is about. Dashed and dim, they read as annotation and keep the
information. Kept.

**Two places the spec was wrong about the code, both worth writing down.** It
said degrees are what `ang` takes; `ang` takes radians. The label converts,
because a drawing has said degrees since drawings existed, which means the
number on the canvas is not the number you would retype — a genuine seam,
flagged in the register rather than papered over by drawing radians on a
sketch. And the spec's placement rules implied `ang` would keep the two marks
a two-line relation gets; it now gets one, at the shared corner. `∥` is drawn
twice because one mark leaves "parallel to what?" unanswered, and that
reasoning does not transfer: the same number written twice answers nothing.

**One bug was caught by looking at a picture, as usual.** The first screenshot
showed the `—` on the bottom edge touching the `110` beside it, and the pair
read as *minus* 110. The cause was a stacking row that stepped by a fixed
17px, which is fine when every box is 18px wide and wrong the moment one is
50. Rows now advance by each box's real edges. Nothing in the numbers could
have shown that.

**What is deliberately not here is editing.** Clicking a value inserts the
relation's name, exactly as clicking any glyph does. Making the number
editable means changing a relation's target, which lives inside the residual
closure that captured it, and the owner's own "radius d4" example hints at
named dimension parameters rather than a one-off setter. That is a design
decision, so it stays on `TODO.md` as one instead of being answered by
whichever implementation was convenient behind a double-click.

### The 3-point circle tool: spending the free-entities package

This is the package that tests whether the previous one was worth it. The
free-entities plan ended by putting a 3-point-circle *tool* on `TODO.md` as
"enabled, not built", with the claim that it would be a trivial composition.
It was: one new file, one import line, and nothing else in `src/`. Nothing was
added to the model, the solver, the relation vocabulary, or `persist.ts`'s
replay table — `addCircle`, `setCoords` and `onCircle` were all already there,
which is the evidence that this is a composition rather than a feature.

**The decision that carries the package is what *not* to build.** A tool that
solved the circumcircle in closed form and called `addCircle(centre, radius)`
is shorter than what is here and draws the identical first frame. It is also
wrong, and the wrongness is invisible until someone drags a rim point: that
circle merely *matched* three points once, so it stays where it was drawn
while the points walk away from it. The circle here is defined by three
`onCircle`s that stay in the model, so it follows them, wears three glyphs,
lists in `rels()`, and can be taken apart one constraint at a time. The unit
suite asserts the following, not the drawing — the drawing is what a computed
circle would also pass.

**The closed form is still needed, for three other things**, which is the
small irony of the above: previewing, seeding, and refusing. It lives in the
tool as `circumcircle()`, taking plain numbers and knowing nothing about which
space it is being asked about — the commit asks it in world coordinates, the
preview in screen pixels, and the view transform being affine with a uniform
scale is what makes those the same answer. That is `intersect.ts`'s design,
borrowed deliberately.

**Deviation from the spec, and why.** The spec asked for the circle's centre
to be seeded at the three clicks' centroid, reasoning that the solver deserves
to start near the answer. Since the circumcentre was already computed two
lines earlier, seeding at the *exact* answer serves that reason better than an
approximation of it, at no cost. The circle is still free in the sense that
matters: a constructor argument here only ever seeded a variable, which is the
observation the whole previous package rests on.

**Refusing a collinear commit was the one genuinely contestable call.** The
alternative is to let it through and let the solver report `CONFLICT` — which
is honest, and is what this codebase does everywhere else, since a model that
cannot be satisfied is a normal state here rather than an error. It was
rejected because this particular conflict is not a statement the user made and
might want to keep: they aimed a third click, and three collinear points have
no circle at all, so what they would get is a drawing they never asked for and
have to undo before they can find out why. Staying armed on the two good
clicks makes the recovery the obvious next click, which is the choice
`fillet.ts` already made for a corner it cannot round. **Near**-collinear is
left alone entirely: a very large circle is a legitimate thing to draw, and
the threshold is set at an angle of ~1e-9 radians so that only the exactly
degenerate case is caught.

That threshold is a *relative sine* rather than an area, and the difference is
not pedantry: the natural expression of "are these three collinear" is twice
the triangle's area, and an area threshold calls a large drawing bent and a
scaled-down copy of the same drawing straight. Dividing through by the two
side lengths makes it an angle, which is scale-free — and there is a unit test
at three scales that fails against the area form.

**The thing this package could not do**, and the reason is worth recording
because it will come up again: a tool has no way to tell the user anything.
The refusal writes a `console.warn`, which no user will ever see. Giving tools
a line in the app's log pane wants a `log` on `ToolContext`, which means
editing `engine.ts` — and the edge-drag package was in flight in that file, so
the spec ruled it out. It is on `TODO.md`, along with the observation that
`fillet` currently reports its refusals by *throwing*, which reaches the page
as an uncaught error and is worse.

### Edge dragging: a translation is a target, not a move

The feature is small and the interesting part is entirely in what a drag
*means*. The naive implementation is to move the grabbed points by the mouse
delta and then solve — and it is wrong in a way that only shows up on a
constrained drawing: the move has already happened by the time the solver is
consulted, so the solver's job becomes "clean up after this", and whether the
constraints or the hand win depends on which residuals happen to be stiffer.
It also cannot express the thing an edge drag is actually for, which is *asking*
for a rigid translation and letting the drawing answer.

So the offset is a **target**: every governing point gets one soft pull toward
where it would be if the entity had translated rigidly, and the least-squares
solve weighs those pulls against every real constraint at once. Drag an edge of
a rectangle and it moves; drag an edge one of whose corners is `fix`ed and only
the free half goes, because the fix outweighs the pull by 1 to 0.12. Nothing
about that had to be written — it is the point drag's mechanism with more than
one pull, which is the reason this package is one function and a handful of
lines rather than a subsystem.

**Grab-time positions, captured once.** Re-reading the points' positions each
frame and adding the frame's delta would compound: the pull moves the point,
the next frame measures from where the pull left it, and the geometry runs away
from the cursor. Capturing the origins at the press and always measuring the
offset from the press position makes the drag idempotent in the cursor's
position — the same cursor position gives the same target however it got there,
which is also what makes a drag reversible by dragging back.

**Single points changed too, and that was a deliberate choice** rather than an
oversight. The point drag pulled toward the cursor itself, which is fine when
the press is exactly on the point and jumps by up to 8 pixels (the pick radius)
when it is not. The offset form has no such discontinuity, and keeping two code
paths to preserve a jump nobody wants would have been the worse trade. Every
existing drag test still passes, because a test that presses exactly on a point
cannot tell the two apart.

**What a rim drag does was the one real design question.** Dragging a circle's
rim could plausibly resize it — the rim is where a radius handle would be, and
the centre-out `circle` tool creates a circle by exactly that gesture. It does
not, for two reasons: Onshape moves the circle, and the whole package is
defined as "translate the thing you grabbed", so a single entity behaving as a
resize would be a special case in a feature that otherwise has none. Resizing
has `rad` and the tool.

**Rejected: making a glyph press inert.** With geometry dragging everywhere, a
left-drag that started on a constraint glyph is the only press left that pans,
which is arguably an inconsistency. The alternative was to make it do nothing
at all. A press that produces no feedback of any kind reads as a broken app,
whereas a pan is at least an action and is what that press has always done; and
a glyph is small enough that the case is rare either way. Recorded here because
it is the sort of thing that looks like an oversight later. It is not.

**Rejected: rigid rotation**, which the spec also excluded. A drag carries one
vector; a rotation needs a centre and an angle, so the gesture would have to
mean something different depending on where within the entity it grabbed —
which is a modifier-key feature, not this one. Onshape drags translate too.

### Free entities: the arguments were never constraints

The owner's complaint was about a tool that insists on a centre and a radius
when what you actually know is three points on the rim. The tempting reading is
that this wants a new kind of entity, or a solver mode, or a family of
alternate constructors — `circleThrough3Points`, `circleTangentTangentRadius`,
and so on down the Onshape menu.

It wants none of that, and the reason is one observation: **a constructor
argument here was never a constraint.** `circ(centre, r)` does not constrain a
radius, it *seeds* a variable; `pt(x, y)` pins nothing. Everything that pins
anything is a relation. So the misfit was not that the constructors took the
wrong arguments — it was only that they insisted on them. Make every argument
optional, auto-create whatever is missing, and the owner's examples type
themselves. No existing call changes meaning, no saved file needs a version
bump, and the alternate constructors are all compositions.

**What we did not do, and why.** A `circleThrough(p1, p2, p3)` helper would
have been three lines and would have been the wrong three lines: it fixes the
particular case the owner happened to name while leaving the general complaint
untouched, and it puts a constraint inside a constructor — the exact blurring
of structure and equations that `model.ts` and `relations/` are split to
prevent. Similarly rejected: a solver mode for "under-determined construction",
which is what an under-constrained model already is.

**Where a free piece goes was the only genuinely new decision.** A circle that
materialises at the world origin while the user is looking somewhere else is
indistinguishable from a bug — you type `circle()`, nothing appears. But "the
middle of the window" is a fact about a window, and `model.ts` learning about
viewports would be a layering violation of the same kind as a `Point` in the
kernel. So the command layer reads the view centre and passes it down as an
ordinary coordinate: `addPoint([x, y])`, which the model has always accepted
from anyone. Two smaller shapes fell out of that. It needs the canvas's *size*
as well as the transform, and a `View` — a pure ox/oy/scale transform — has no
business holding a window size, so `EnvHandles` gained a separate `viewSize`
function rather than the `View` gaining fields. And headless, the command layer
passes `null` rather than the model's own default coordinates, so a journal
written with no viewport is byte-for-byte what the model layer writes: one
call, no expansion. On screen the coordinate goes into the journal, so a
drawing reopens where it was drawn rather than wherever the window points next
time.

The anchor is deliberately *not* used whenever something is missing — only
where the model would otherwise fall back to the origin for want of anything to
derive a position from. `ln("a")` seeds its second endpoint beside `a`, and
dragging that to the middle of the window because it happened to be
auto-created would be worse, not better.

**Honesty about branches.** Tangent + through-point + radius has up to four
solutions. Least-squares returns the one nearest its seed, and dragging flips
between them. There is no fixing this and nothing to fix — it is what Onshape
does — but there is a difference between a documented property and an
undocumented surprise, so it is written into the changelog as behaviour. The
consequence for testing is sharper: an ambiguous construction can only be
checked by *satisfying its constraints*, while the three-point circle is unique
and therefore gets checked against the closed-form circumcircle, exactly. A
test that asserted a particular tangent circle would be asserting the seed.

**Two things the browser found.** First, `circ("p1", 6)` only seeds a radius —
so the "line tangent to two circles" test passed nothing until the radii were
actually constrained with `rad()`, because the solver was free to shrink a
circle onto the line and call it tangent. That is the package's own central
distinction biting the person who wrote it, which is worth recording. Second,
what counts as one undo step is decided in `main.ts` around a *submitted*
entry, so a `del()` pushed straight into the evaluator by a test is not a step
and the following `undo()` quietly undoes the entry before it. Not a product
bug — but a trap for the next person writing an e2e, so the test types it and
says why.

### Box select, a register entry overruled, and a key that was deaf

The spec settled the interesting question before work started — the
SolidWorks/Onshape direction convention, left→right window and right→left
crossing — so what is worth writing down here is the three things it left open
and the one thing nobody expected.

**Where the predicates live.** The obvious home was `picking.ts`: it already
answers "what does the pointer mean, in screen space", already imports
`intersect.ts`, already has the entity-to-screen projection. It was the wrong
home. Picking is dominated by *choosing* — tiers, tolerances, a nearest-wins
comparison threaded through every branch — because only one thing can be under
a cursor. A box chooses nothing; it takes everything that qualifies, and has no
tolerance at all beyond a pixel of arc slack. Putting them in one file would
have meant either concept leaking into the other's code. So `boxselect.ts` is a
fourth peer beside `picking.ts`, `snapping.ts` and `glyphs.ts`, and the
architecture doc says why.

That decision cost one small duplication: `snapping.ts` has a private
`screenCurve` that projects an entity into the plain screen curve
`intersect.ts` understands, and `boxselect.ts` now has its own. Exporting
snapping's and importing it would have created a lateral dependency between two
peers — precisely what `intersect.ts` was pushed down below both of them to
avoid. The hazard the architecture doc actually names is two copies of "is this
angle on the arc" drifting apart, and that test is *not* duplicated: both files
call `withinSweep`. What is duplicated is a fifteen-line projection with no
judgement in it, and even its one parameter (the slack) legitimately differs
between the callers.

**An arc's bounds are its own, not its circle's.** The easy version of
containment measures an arc against the bounding box of the whole circle it
lies on. It is wrong in a way a user can see: a quarter arc tucked in a corner
would refuse to be window-selected until the box was three times its size, for
no visible reason. So `arcBounds` takes the two endpoints plus whichever of the
four cardinal points the sweep actually reaches. This is also the one place the
sweep test is asked *without* slack — slack exists to make an arc's last pixels
reachable by a cursor, and a bounding box wants the true extent.

**A rectangle inside a circle touches nothing.** Stated in the spec, and worth
restating because it looks like a bug the first time someone hits it. The
entity is the rim. It falls out of the implementation rather than being special
-cased: touching is "contained, or crosses the boundary", and those two are
exhaustive for a closed curve — if part of the rim were inside the box and part
outside, it would have to cross.

**And the thing nobody expected.** The Escape-cancels-the-box story failed, and
kept failing, with the box still up after the keypress. Escape was bound to the
command input's `keydown`. A mouse press on the canvas blurs that input — a
canvas is not focusable, so focus falls to the body — which means the binding
was deaf during *every* gesture, which is the only time Escape means anything.
It had never been caught because each earlier Escape test picked something
first, and `insertToken` re-focuses the input on a pick. So the key worked in
tests and would have failed for a user who dragged before clicking. It is on
`window` now, which is the same reasoning that already put Ctrl+Z there, and it
still fires from the command line because keydown bubbles. Fifth entry for the
list of bugs that were invisible to the unit suite and obvious in a browser.

### The stale header, and the answer that was already there

The bug was known and had been sitting under "smaller things" with a warning
attached: the obvious fix is to re-solve after an edit, and the obvious
implementation is a list of which commands are edits — which is exactly the
enumeration `main.ts` has refused to write since undo was built, because such a
list is wrong the moment anyone adds a relation and forgets to update it, and
wrong *silently*.

The list is unnecessary. Undo has been answering the same question all along:
"is this one step" is decided by snapshotting the model before an entry and
after it and comparing the two strings, and that comparison is precisely "did
this entry change the model". `UndoStack.pushIfChanged` even returns the
answer; `endUserAction` was throwing it away. Now it returns it, and `submit`
calls `solveAndRender()` when it is true and `render()` when it is false. Six
lines, no new concept, and the property that matters is structural rather than
maintained: an entry cannot be an undo step and not re-solve, because both come
off the same boolean.

Three things fell out of it that are worth writing down.

**An entry that throws is not an edit.** A relation that fails part-way rolls
back its blocks and its name counter (a fix from the deletion package), so the
snapshot is unchanged and nothing re-solves. That was not designed here; it is
the earlier fix paying a dividend, and there is now a test pinning it.

**A history move must not re-solve through this path.** `undo()` and `redo()`
replace the whole model, and `swapModel` already solves and draws it.
`endUserAction` returns `false` for those, along with every nested close — only
the outermost bracket has an answer at all.

**Existing specs that type a redundant `solve()` were left alone**, as the
spec asked. None of them asserted staleness — they typed `solve()` to *make*
the model settle, and it still does. Removing them would have been a diff with
no meaning in it. The one new assertion this needed is the negative one, "`ls()`
did not solve", which cannot be seen from the geometry; `test/e2e/livesolve.e2e.ts`
wraps `model.solve` in the page and counts calls.

### Snapping to crossings, and three decisions the spec left open

The spec for this one was unusually specific about *what*, which left the
interesting arguments to be had about *how*. Three of them are worth writing
down, because in each case the obvious answer is the wrong one.

**Screen space, not world space.** The instinct is that geometry belongs in
world coordinates and the view is a presentation detail, so the intersection
algebra should live in world space and the tolerances should be converted. But
follow the callers: the prefilter measures pixel distance to the cursor, the
tolerance for "is that a crossing I meant" is eight pixels, and the arc-sweep
test picking already owned is written against *screen* angles, in a convention
whose own comment says "screen angles run the other way from world angles".
Doing the algebra in world space would have meant writing that sweep test a
second time in the opposite convention — which is precisely the thing the spec
said not to do ("one definition of on the arc"). And the cost of screen space
turns out to be nothing: the view transform is affine with a uniform scale, so
a segment stays a segment, a circle stays a circle, and the exact screen
crossing maps back through `screenToWorld` to the exact world crossing. The
e2e checks that against a closed form computed independently, and it holds to
better than 1e-6 on a crossing at an irrational x.

Having chosen screen space, the sweep test had to move somewhere both
`picking.ts` and the new code could reach. It went **down**, into
`intersect.ts`, which knows nothing about models — rather than having
`intersect.ts` import `picking.ts`, which would have inverted the layering to
save a file. `picking.ts` now imports it back, and the behaviour is pinned by
a unit test that asserts the predicate itself, including its asymmetry and the
fact that slack only extends the far end.

**Degeneracy is measured in pixels, not in the discriminant.** The
textbook answer is `disc <= 0 → no intersection, disc == 0 → tangent`. The
textbook answer does not survive contact with a solver. A tangency that
`tangent(l, c)` actually holds has a residual around 1e-11, but the *root
separation* goes as the square root of the discriminant, so those two "equal"
roots come out about a thousandth of a pixel apart and an exact test never
fires — you get two crossings where the drawing has a touch, and two inferred
constraints where the user meant one relation that already exists. So the rule
became: two candidates closer together than `TANGENT_EPS` (0.05 screen pixels)
are one candidate, and one candidate is a tangency, so return nothing. That
threshold is far above solver noise at any plausible radius and far below
anything a hand can aim between. The same rule covers the circle–circle cases
for free, internal and external tangency alike, which is a good sign it is the
right rule rather than three special cases.

**Two relations, not one.** This is the spec's own point and it deserves
repeating because the snap is the visible part and the inference is the
feature. A point placed at a crossing and told only "you are on this line"
looks identical for exactly one frame, and then slides off the circle the
moment anything moves. `placePoint` therefore applies the on-curve relation per
target, and the e2e proves the machinery engages rather than assuming it: it
checks both relations are in the registry under their own names, that both wear
a glyph, that dragging the edge leaves the point on the rim *and* on the edge
to 1e-4, and that two Ctrl+Z unwind the pair cleanly.

**Rejected:** keeping `Snap.target` alongside a new `Snap.targets`, as a
compatibility shim. There were four call sites. Two fields that can disagree,
forever, is a worse trade than a rename that the type checker completes for
you.

**Left in place deliberately:** the along-a-curve tier still snaps to an arc's
whole circle, as it always has; only the crossings are gated by sweep. That is
inconsistent on its face, and it is the existing behaviour — snapping along a
rim is deliberately more forgiving than picking one — so changing it is a
separate decision, not a side effect of this package.

### Drawing the constraints, and what only looking could settle

This package is small and the interesting part of it is not the code. Almost
everything mechanical was already in place: PR #3 gave relations names and a
registry, `describePick` already described things for a tag, the engine already
had a tier-ordered hit test, and `main.ts` already highlighted whatever was
hovered. The glyph layer is `placeGlyphs(model, view)` plus one new value in a
union plus about forty lines of canvas drawing.

The one structural decision worth recording is **`Pick.kind` gaining
`"relation"` rather than a second, parallel pick type.** A glyph is not an
entity, and the honest-looking design has a separate `GlyphPick` alongside
`Pick`. I wrote it that way first and it was immediately wrong: hovering,
describing, highlighting, and dropping a name into the command line all want to
do the *same thing* to a glyph pick as to a point pick, so a parallel type
means writing every one of those paths twice and then keeping the two in step
forever. Widening the existing type made the rest of the package fall out as a
handful of switches, exactly as the spec predicted.

The other one is smaller and worth naming because I nearly did the opposite:
**`describeRelation` and its short-name table moved down from `replenv.ts` to
`picking.ts`.** The hover tag needs it now, and picking sits below the command
surface, so the alternative was a second copy. Two tables would have meant the
canvas and the command line could quietly start calling the same relation two
different things, which is precisely the sort of drift nothing would ever
catch.

**Legibility was the actual work, and it needed eyes.** The spec proposed a
symbol table and said the implementer owns it and must judge it from
screenshots. That instruction earned its place three times over:

- My first attempt at detecting missing glyphs measured `ctx.measureText`
  against a codepoint no font has. In a **monospace** stack that is useless —
  every glyph, present or absent, gets the same advance — and the check
  cheerfully reported that `|`, `=` and `r` were all tofu. The measurement that
  works is bitmap identity: render the character and `U+FFFF` to two canvases
  and compare the pixels. Worth writing down, because the width test is the
  obvious one and it is confidently wrong.
- The spec's table gave `coin` and `on` the same `◦`. That is not a legibility
  problem you can see in a table — both rows look fine — and it is obvious the
  moment two marks that mean different things sit next to each other on a
  drawing. `coin` also deserved better than `◦`, which at 12px is two pixels
  across and reads as dirt rather than as a symbol; it is the most common
  relation of all, since it is the one inference produces.
- `⚓` for `fix` turned out to *render* — the risk the spec named — and still
  be the wrong choice, because at 12px it is a dense smudge. The spec offered
  `#` as the fallback and `#` is simply better.

And the screenshots caught something entirely unrelated: while setting up the
"drawing wearing its glyphs" picture I typed a `tan` at the command line and the
circle plainly was not tangent, while the header read `SOLVED`. A relation added
from the command line adds its residual and redraws but does not solve. That is
the stale-readout family this project has been bitten by before, it is
pre-existing, and it is not this package's to fix — but it is now on `TODO.md`
rather than waiting to be rediscovered. It is also the fourth time in this
project that looking at a picture found something no assertion was watching for.

**Deliberately not built:** any kind of layout pass. Marks sharing an anchor
stack in a row and everything else is left to crowd. The spec ruled a layout
engine out and I agree with it more after building this than before: the honest
version of label layout has to move marks as the model solves, and a mark that
jumps about while you drag is worse than a mark that overlaps its neighbour and
stays put. `glyphs(false)` is the v1 escape hatch, and per-relation hiding can
follow if the crowding turns out to matter.

### Giving relations names, and what that turned up

The spec for this one framed the gap exactly right: entities have names and
relations do not, and a constraint you cannot refer to is a constraint you
cannot inspect or remove. That was survivable while every constraint was one
you typed. Inference ended it — a tool that constrains your drawing on your
behalf hands you something you did not ask for and, until this package, could
not take back.

Most of the work was mechanical, and the diff should read that way: every
function in `relations/` swapped its opening `model.record(...)` for a
`model.relation(op, args, body)` wrapper around its body, and its
`model.problem.addResidual` calls for `model.addResidual` so the wrapper can
collect the handles. What was *not* mechanical was three decisions the wrapper
forced, each of which only became visible once the registry existed.

**A relation defined in terms of another is one relation.** `concentric` is a
`coincident` on two centres; `arcEndpoints` is two `onCircle`s. The obvious
implementation registers three entries for `concentric` — an outer and an
inner — and the moment I wrote it down it was obviously wrong: two entries
claiming the same residual blocks cannot both be right, because deleting
either leaves the other holding handles the kernel has already forgotten, and
the kernel is specified to throw on exactly that. So the inner call's blocks
join the outer entry and it takes no name.

Following that thread found a real bug that had been sitting there since those
relations were written. Both calls also *journalled*, so a file containing a
`conc` or an `arcends` came back from `open()` with the inner constraint
applied twice. Nothing caught it: the round-trip tests compare entities and
coordinates, and a duplicated identical residual only doubles a weight that is
already satisfied, so every number stayed right. It would have surfaced years
later as a mysterious stiffness in a model that had been saved and reopened a
few times. Worth noting for its own sake — the registry did not fix this
because anyone went looking, it fixed it because a stricter representation
made the duplication impossible to state.

**A relation that throws has to roll back its name.** Blocks obviously; the
counter less obviously. A replay performs only the calls that succeeded, so a
mistyped relation that burned `r7` in the live session would leave the reopened
model naming everything after it one step lower — and the deletion journal
refers to relations *by name*. Determinism here is not tidiness, it is the
difference between `deleteRelation("r7")` removing the tangency it removed and
removing something else.

**The cascade is Onshape's, and the interesting part is the asymmetry.** It
follows references inward — who needs me — and never outward — what do I need.
Deleting a line therefore reaches nothing, while deleting one of its endpoints
reaches the line. Stated that way the "a curve does not take its points" rule
is not a special case, it is the same rule; and the implementation is a
worklist over `dependents`, which stays correct if an entity kind that
references another is ever added.

Two judgement calls I want on the record because a reviewer might disagree.
The first: **deletion is journalled as its expansion**, one `deleteEntity` or
`deleteRelation` per name, which is the *opposite* of how `fillet` is
journalled. A fillet re-expands identically on replay because its expansion is
a pure function of its arguments; a cascade is computed against the model as it
stood, and a replay recomputing it could remove a different set. So the two
ops go in the replay table and `del` itself does not.

The second: **`del` re-solves through the host, and no other editing command
does.** That is an inconsistency and I chose it deliberately. Deleting a
constraint is precisely the edit whose purpose is to change what the solver is
allowed to do, and leaving `CONFLICT` on the header after removing the
constraint that caused it is the stale-readout bug this repo already has an
incident note about. Nothing moves — the drawing was satisfying more than it
now has to — so the cost is one frame.

And one thing I did **not** do: compacting the variable vector. A deleted
point's variables stay in it, referenced by nothing. Compaction means remapping
every captured index list inside every closure in the problem, which is a
different piece of work with a different risk profile, and the failure mode of
getting it subtly wrong is a drawing that solves to the wrong answer rather
than one that costs a few bytes. The leak is bounded by how much a session
deletes; a save/reopen does not shed it, because replay re-runs the same
creates and deletes. Both facts are tests, not comments, which is the
difference between a documented decision and a bug waiting to be rediscovered.

The e2e is the part I would look at first if reviewing this. Everything above
is arguable from a unit test except one thing: whether the residual block
really left the *problem*, as opposed to leaving a list that claims to describe
the problem. The only way to see that is to pull on it — so the test drags the
corners apart after the delete, and the screenshot in the changelog is the
same gesture.

### Undo, and the design that was already lying there

The interesting thing about undo here is that almost none of it is new code.
The spec's central claim — snapshots, not journal cleverness — is the sort of
thing that sounds like giving up until you look at what the alternative costs.
Journal truncation is *obviously* the clever design: the model already knows
the calls that built it, so drop the last one and replay. It falls over on the
first thing a user does after drawing, which is drag something. A drag changes
values and journals nothing, on purpose, so truncation would see nothing to
truncate. Undo would then need value snapshots *as well as* journal surgery,
and two mechanisms that each half-work are worse than one that works.

And the snapshot format was already written. `save()` produces text that
carries the journal and the solved coordinates, `open()` puts one back,
`swapModel` already re-points the engine and the REPL at a new model and is
already tested for keeping the user's own command-line bindings alive. So the
whole feature is a stack of strings plus a decision about *when* to push one.
`src/undo.ts` imports nothing at all, which is a good sign about where the
complexity ended up rather than a boast about the file.

**The decision worth writing down is what counts as one step**, and the thing
I did not expect was that it needs no list. The first shape I sketched had the
host asking "is this command an edit?" — which means a table of command names,
which means every new relation has a third place to be registered and a fourth
way to silently do nothing. What replaced it is one comparison: snapshot
before, snapshot after, push only if the text differs. `ls()` and `help()`
stay out of the history because they leave the model identical, not because
anyone remembered to exclude them. A command added next year is covered.

The second decision is where that policy lives, and it is the layer rule doing
its usual work. The engine is below undo and must not learn it exists, so what
it offers is a neutral bracket — `onUserAction("before" | "after")`, a gesture
began, a gesture ended — and `main.ts` hangs the snapshot-compare-push on it.
What I got wrong first was giving the *host* the job of pairing those phases.
The engine is the only thing that knows all the ways a gesture can end: a
release, an Escape, and a swap of the model out from under a drag in progress.
Miss one and the host's bracket stays open forever, and the symptom is not the
missed action — it is the *next* one, silently unrecorded, possibly minutes
later. So the engine owns the pairing, closes it in a `finally`, and the tests
that matter most in this package are the three that check it closes on each of
those three exits. (Reading that path also turned up a real bug of the same
family: a drag whose model was swapped out wrote to a cleared `idle` on the
next pointer move — an uncaught TypeError, sitting there since the drag work.)

Two smaller things I deliberately did *not* do. Undo does not restore the
**view**: panning and zooming are not edits to the drawing, and a Ctrl+Z that
scrolls the page back is a well-known annoyance in tools that conflate them.
And the history is **not saved** with the file. A reopened drawing starts with
an empty stack — which is standard, is one line in the CHANGELOG, and stays a
documented decision rather than an undiscovered gap.

The carve-out took the longest to settle for how small it is. Ctrl+Z with a
half-typed command in the box could mean the text or the model, and nothing
outside the user's head can resolve it. Both wrong answers are bad; undoing
the *drawing* while someone is mid-sentence is the worse one, because the text
is right there in front of them and the geometry might be off-screen. So text
in the input keeps the keystroke. Note that the test is the text, not the
focus: what is visible is what a user reasons from, and an input with
`dist("p1", ` sitting in it looks like it is being typed whether or not it
holds focus.

### Dragging, and the difference between a constraint and an intention

The drag needed one thing the kernel could not do: solve the model *plus*
something that is only true for this frame. The alternative — add the pull as
an ordinary residual block, solve, remove it again — was rejected on both
counts it can be judged by. It is slower, since `Problem` has no removal and
would have needed one; and it is a lie about what the model contains, because
for the duration of that call the drawing genuinely has a constraint in it
saying a corner belongs under the cursor. A constraint is a claim about the
drawing. A drag is a claim about the hand. `solve({ extra })` keeps them apart
without the kernel learning what either of them is: it still has never heard
of a point, and the residual blocks are built one layer up in the engine,
which is allowed to know.

The one design decision inside `problem.ts` was the offender report. Evaluate
the stored blocks first, keep the row count at the hand-over, and slice the
report there. It could have been a flag on the block instead, but the report
is a slice of the residual vector and a row index is the thing that actually
indexes it. The *reason* for excluding extras is worth writing down plainly: a
soft pull never reaches zero, that being what "soft" means, so a report that
counted it would say `CONFLICT` for the whole of every drag — a header that
lies during the most common interaction in the program is worse than no header.

Then the tests said something I had not expected, and it changed the shape of
the engine code. Least squares does not stall politely against a constraint it
cannot beat; it *trades*. Pull a fixed point 150 units and the fix gives way by
2.1 — the whole system settling into the compromise that minimises the sum. At
w = 0.12 the displacement is about the overshoot over 71, which is nothing when
the cursor is a pixel from the point it is dragging, and quite visible if you
hold it far away. So mid-drag the model can genuinely be out of true, and can
genuinely have offenders among the *stored* blocks — correctly so. Two
consequences, both now load-bearing: the intermediate frames call
`model.problem.solve(...)` directly and ignore the report, rendering without
touching the status line, and release runs an ordinary solve through the host's
path, which is what makes the header the settled truth rather than a frame of a
gesture. The last kernel test walks exactly that lifecycle. I would rather have
that test than a comment.

Two smaller things. The pull is one residual per coordinate, not one on the
distance to the cursor, because a distance residual is a square in disguise
near its own root and least squares would end up minimising a fourth power —
the repo's standing rule about never writing a residual that is already a
square. And the point being dragged is hit-tested **once**, at press time,
rather than each move: from the first frame onward the geometry is moving under
the cursor, so re-asking "what is under the pointer" would hand the drag to
whatever the drawing swept past.

Review caught a third thing I had written down as a known edge instead of
fixing: `cancel()` mid-drag. I had reasoned that "cancel cannot undo the drag,
because nothing has undo, so leaving the geometry where it is is the honest
option". That is half an argument. Cancel cannot restore the *pre-drag*
geometry, true — but what it was leaving behind was not the drag's result
either, it was the last frame's *compromise between the drawing and a cursor
that no longer exists*, with the header still showing whatever it said before
the gesture. The right reading is that abandoning a drag and releasing it
differ in whether the pull's final position is intended, not in whether the
model should be left consistent. So `cancel()` settles through the host's solve
path exactly as `pointerup` does. The unit test for it fails against the old
code, which is the only reason to trust it.

That test needed the engine driven without a browser, which turned out to be
easy — a stand-in canvas that records its listeners, and synthetic pointer
events fired at them. Worth having for the whole class of "what happens when a
gesture is abandoned", which has no mouse event of its own and is otherwise
only reachable through the keyboard.

What is deliberately absent is inference during the drag, which Onshape does
have. It is a real difference and it is documented rather than smoothed over,
along with only-points-drag and the absence of undo — a drag is currently
undone by dragging back, which is honest but not something to leave standing
for long. Undo is next in the queue and the drag makes its case for it.

### The line tool, and what "chaining" actually has to mean

Second half of the same plan document. The interesting question was not how to
draw a line — it is two points and a `ln` — but what happens between segments.

Onshape chains: the end of one segment is the start of the next. The lazy
reading of that, given inference had just been built, would be "commit a new
point and make it coincident with the previous end". That is wrong, and
usefully so. A chained vertex is not two points that agree; it is **one
point**, and saying it with a constraint would give the drawing twice the
vertices it looks like it has, each pair held together by an equation the
solver has to keep satisfying. So the tool holds the committed end point's
*name* and hands it straight to the next `addLine`. Inference exists for
points that genuinely are new and land on something; it is not the mechanism
for a shared vertex.

Two smaller decisions in the same spirit. Nothing is committed on the first
click, so an abandoned chain leaves nothing behind — the same rule
`rectangle.ts` follows, and the reason a mis-click costs nothing. And the
tool never calls `ctx.finish()`: it stays armed until cancelled, which is what
made "multi-stage tool" a non-event when the arc tool needed it, and needed no
engine change here either.

**Precedence between the two kinds of inference** was the one real judgement
call. Within 3° of an axis the segment is pulled level and gets `hor`/`ver`;
land on an existing point and it gets `coin`. When both apply, the snap wins.
The reasoning: an axis guess is inferred from a rough aim, while a click that
landed on real geometry is a deliberate one, and sliding it onto an axis would
silently undo it — the same argument that settled the arc tool's third click
an hour earlier. The axis constraint still comes along when the snapped
position happens to satisfy it, since nothing is being given up in that case.

**Dimension-genericity earned its keep immediately.** `CLAUDE.md` asks for
relations to be written generically and proved with a 3D test rather than a
comment; a chain of points and lines is generic even though `hor`/`ver` are
not, so the tool infers no axis above two dimensions and otherwise behaves
identically. Writing that test found a real bug on the first run: the
degeneracy check ("did this click land on the segment's own start?") measured
`Math.hypot(dx, dy)` and nothing else, so in 3D every segment that moved only
in z looked like a zero-length click and was silently refused. It would never
have surfaced in the 2D app.

Verified in the browser as the rule requires: the screenshot in `CHANGELOG.md`
is a chain mid-draw — an upright committed segment, a diagonal one that was
left alone because it is past the tolerance, and a third in progress locked
exactly level with its guide running across the canvas.

### Inference built: the snap now says what it meant

Implementing `docs/plans/onshape-inference.md`, which read as an instruction
rather than a design question — the design had already been settled by the
owner's correction, so this was execution.

The shape of it fell out of one observation: snapping had already done the
hard part. `findSnap` decides *what* was aimed at and in which of three
senses; all that was missing was the line that turns "you aimed at p3" into
`coin(new, p3)`. So the change is genuinely small — `PointerInfo` carries the
`Snap` alongside the coordinate it produced, and one helper, `placePoint`,
owns the whole mapping. Every tool that puts a point where the user clicked
goes through it; a tool that ignores the new field behaves exactly as it did
before, which matters because tools authored at the command line are the same
kind of thing as the built-ins and must not need updating.

The rectangle tool needed the only structural change: it was keeping
`p.world` from `onDown` and nothing else, and by `onUp` that coordinate is all
that remains of a gesture that started *on* something. It keeps the whole
`PointerInfo` now. Its two derived corners get no inference, deliberately —
nothing was clicked there, and inventing a constraint for a corner the user
never pointed at would be the guessing the whole approach avoids.

Three things worth writing down, since none is obvious from the diff.

**A coincident constraint between two free points does not make one follow the
other.** The first version of the acceptance test moved rectangle A's corner
with `setCoords` and asserted B's corner arrived there; it arrived halfway,
and the test was wrong rather than the feature. Least squares with both ends
free minimises the step, so the two points meet in the middle — which is
correct, and is what a sketcher does too when nothing else is holding either
end. The tests pin one end with `fix` and then ask whether the other followed
exactly. Recorded in `TODO.md` and `CHANGELOG.md` as well, because it will
look like a bug to whoever meets it next.

**`midpoint` had the same trap `hor`/`ver` escaped**, and inference is what
walked into it: a midpoint snap means "the middle of this edge", so applying
the point form `mid(m, a, b)` would have captured the two endpoints the line
happened to have and then gone on constraining them after a fillet re-pointed
it. It has the line form now, resolving lazily through `model.line()` at each
evaluation, and the round-trip test checks that each call site saves and
reopens as the *form* it was called in rather than merely at the right
coordinates.

**The arc tool's third click had two rules that disagreed.** It projects the
end onto the rim so nothing jumps on solve; a snap says the end belongs on
some other geometry. Projecting after snapping would silently undo an aim the
user took deliberately, so the snap wins and `arcends` stretches the arc to
reach it — the constraint system settles it, which is the whole point of
having one.

Verified in a browser as well as in tests, per the rule that has now caught
six bugs: the screenshot in `CHANGELOG.md` is two rectangles drawn with a real
mouse, meeting at exactly one corner, with the log below showing the
`coincident("p5", "p3")` the tool applied on the user's behalf — the
constraint is an ordinary one they could have typed, which is exactly the
claim being made.

### "Weld" retired: it's constraint inference, like every other sketcher

The snapping work left a question framed as "welding coincident points", with
options sketched out as though this were an open design problem. The owner's
review corrected the framing in one line: no CAD program has "weld". Onshape
and SolidWorks solved this decades ago — when a sketch tool places a point on
existing geometry, it keeps two points and applies a **coincident constraint**
between them automatically. Constraints on curves and midpoints likewise.
Onshape calls it inferencing; SolidWorks calls it automatic sketch relations.
Tools should work the way those do, so people arrive already knowing how to
use them.

Worth recording *why* the earlier framing went wrong, since it is a
reasoning error worth not repeating: the "a tool that welds is guessing at
intent" concern treated this as a novel design question, when it is a solved
one with twenty years of user expectation behind it. The standard answer is:
apply the constraint, visibly, and let the user delete it if it was wrong.
The missing delete is real, but it is an argument for building constraint
deletion (now on `TODO.md`), not for inventing a nonstandard concept to
avoid the guess.

Also surfaced while writing the spec: there is no plain **line tool**. Point,
rectangle, circle, arc, fillet — and not the most basic tool in any sketcher.
It is specced alongside inference (chaining clicks, shared vertices,
horizontal/vertical inference) in `docs/plans/onshape-inference.md`, which is
written as an implementation instruction for a second Claude session to
execute.

### Snapping, and what cellwork actually meant by it

Both READMEs list "hover snaps" among cellwork's proven ideas, so the first
job was working out what that actually referred to. Reading the source: in
cellwork, pointer tools fill *argument slots*, so clicking an existing point
used that point and clicking empty space auto-created one. The snap fell out
of picking — there was no geometric snapping at all.

neocad's tools are gesture-based rather than slot-based (you drag a rectangle,
you don't fill in its four corners), so the direct port doesn't apply. The
same *idea* — a click near existing geometry should mean that geometry, not
something a pixel away from it — lands here as snapping the coordinate a tool
receives.

Which turns out to be the better shape for this codebase anyway, because the
tool never learns anything happened. `rectangle.ts` needed no changes at all;
it asks for `p.world` and gets a snapped one. A tool should be about its own
gesture, not about how precise the cursor is.

The marker is drawn after the tool's own preview rather than before, which is
deliberate: if the cursor is not where it looks, that has to be the most
visible thing on screen, not something a dashed rectangle can cover.

**One thing deliberately not done.** Snapping moves the cursor; it does not
reuse the point it snapped to. Drawing a rectangle on the corner of another
leaves two points in the same place rather than sharing one. Sharing is often
what you want — and sometimes badly not, and it cannot be undone by moving
something afterwards. Conflating "be precise" with "merge these" would make
snapping quietly destructive, so welding is on `TODO.md` as its own decision
with its own consequences.

**And another screenshot bug**, which is now a reliable enough pattern to
expect. The first render showed the hover tag following the cursor mid-drag,
still naming the point that had been under it *before* the gesture started —
sitting next to a snap marker that was correctly reporting something else
entirely. Hover now stops the moment a tool is armed. Two highlights competing
for one cursor is worse than one, and the snap marker is the one that matters
while something is being drawn.

### The fillet tool

The first thing built on picking, and the thing picking was for. `fillet` as
an operation had been complete and reachable from the command line for a
while, but only usable if you already knew both edges by name — which is
exactly the gap a viewport is supposed to close.

Two additions to the tool API fell out of it, and both are worth having beyond
this one tool. `ctx.pick(screen)` lets a tool hit-test — hover snaps will want
the same thing. And `arm(name, options)` hands a tool a parameter it needs
before it can do anything: a fillet needs a radius, a fixed-size circle tool
would need one too, and one mechanism beats each such tool inventing its own
way of being told.

Two deliberate behaviours. Clicking something that isn't an edge is a *miss*
rather than a cancelled gesture — the likeliest cause is aiming slightly off,
and losing the whole gesture over that would be maddening. And when the
operation refuses a corner (collinear legs, too large a radius) the tool keeps
the first edge, so the obvious next move — pick a different second edge, or
re-arm with a smaller radius — just works.

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
