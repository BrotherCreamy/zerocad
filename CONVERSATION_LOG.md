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

### 3D frames, and what the spec left to the code

The spec for the model half of 3D phase 1 was precise about the mathematics —
Gram–Schmidt on the y-ref, `uz = ux × uy`, `onPlane` as `dot(p − origin, uz)`,
fix's frameless 3D form removed — and the mathematics went in as written. What
it could not foresee were four smaller questions, each with an answer that
would have passed the tests and been wrong.

**Where the name goes, and what that costs a file.** The spec wrote
`addFrame(origin?, xref?, yref?, name?)`: name last, as on every other
constructor. That moves the name from the third argument to the fourth, and
every saved file has it third. Three ways through were considered. *Keep the
name third and append the y-ref* — rejected: it breaks the name-last
convention every other constructor keeps, and the spec's signature, to save a
translation. *Journal 2D frames in the old three-argument form and only 3D
ones with four* — rejected: the journal is meant to be the call as made, and
the replay table would carry an arity overload forever, for a benefit (2D
files byte-identical) that evaporates the moment half 2 makes every model 3D.
*Translate old entries by arity and leave the version at 4* — closest to
right, and rejected on `persist.ts`'s own rule: a version-4-only build reading
the new entry would call `addFrame(origin, xref, null)`, auto-name the frame,
and lose any explicit name, so a later `setDefaultFrame("base")` fails. That
is a format break in the old-reader direction, which is exactly what the
`tools` note beside `VERSION` says a bump is for. So: version 5, translation
keyed on the *version* (as `relationRenamer` is) rather than on arity, so a
hand-edited three-argument entry in a v5 file fails at its own step instead of
being guessed at. The cost is to half 2's plan, which had reserved 5 for the
2D→3D lift: it takes 6, and should key that lift on the file's `dim` field,
since v4 and v5 files are both 2D. Flagged in the register.

**Seeds when two points are given.** In 2D, a missing frame point is offset
along the kernel's x from the one given, and that can never be degenerate. In
3D two of three points can be given, and "offset the missing one along the
next axis" lands on the line the given two already make whenever they happen
to lie along that axis — `addFrame("o", "up")` with `up` straight along the
kernel's y would get a y-ref on its own x axis, a frame with no plane. The
seed now goes along the first kernel axis *not parallel* to the arm already
there. At most one kernel axis is parallel to a non-zero vector, so with two
candidates there is always a clear one; only given points that coincide defeat
it, and then the degeneracy is the drawing's.

**How a 3D frame collapses.** The 2D floor zeroes both axes, but only because
+y is defined from +x. In 3D the axes are separately defined, so the choice
was between flooring the whole frame on any collapse and flooring each axis on
its own. Axis by axis won: a y-ref dragged onto the frame's own x axis leaves
+x perfectly well defined, and zeroing it as well would turn a level edge into
an unconstrained one for no reason. The y floor is scaled by the arm's length,
and that was measured rather than assumed: the Gram–Schmidt remainder of a
collinear arm is rounding error proportional to its length — 1e-15 at three
units, 1e-10 at a million, 1.3e-7 at a billion, the last past an absolute 1e-9.

**`fix` outside 2D and 3D.** Removing the frameless form "in 3D" left 1D and
4D models holding the only gauge `fix` in the vocabulary. Keeping it there
would have kept a corner where the kernel's axes show, for models nothing
uses; removing it costs those models `fix` entirely, since frames need 2D or
3D. Removed, and `resolveFrame` now says "a 4D model has no frames" first,
because the standing advice to go and make one would only lead to a second
refusal.

Two smaller things. **`"f1.z"` is syntax everywhere and meaning only in 3D**:
`parseAxisRef` stays a pure reading of a string (the deletion cascade and
`referentOf` lean on that with no model in hand), and `Model.requireAxis`
refuses z in 2D *before* the frame is looked up — in 2D no frame you could
make would have one, so "no such frame" would send the reader the wrong way.
And **the context menu's Fix item** had a raw-coordinates branch for 3D that
only made sense while `fix` there was gauge-relative; with that gone, raw
numbers would have been read in the default frame and flung the point.

**One measurement worth keeping from the tests.** `onPlane`'s closed-form test
— a line pinned above and below the plane must cross it at (2.8, 0.2, 0) —
first failed to converge. It looked like `onPlane`'s fault and was not: with a
second plain `on` in its place the same system stalls too, from a seed
`onPlane` survives, and the 2D analog converges from both. It is `on`'s
wedge, whose scale grows with the point's distance, trading the line's `fix`es
for itself when the line's ends still have far to travel. The test now seeds
the line near its pins; the finding is in `TODO.md`.

Left for half 2, deliberately: `onPlane`'s glyph symbol (a mark is chosen by
looking at it, and no 3D drawing can be looked at yet) and the line tool's
axis inference in 3D (it needs the camera's projection).

### Tool source in saved files, and where the capture had to happen

The owner's decision settled the *policy* completely — a REPL-authored tool's
source rides in the file as inert text, `open()` never runs it, the paste is
the consent — and left one real question: how does anything know the text of
the entry that is calling `defineTool` at the moment it calls it?

Four seams were available and three of them are wrong in an interesting way.

**Rebuild the scope per entry**, with a `defineTool` closed over that entry's
text. It works and it is the most literal reading of "the wrapper knows the
entry", but it rebuilds the whole command surface on every keystroke-ending
Enter, and the scope is the thing bare assignments persist into — a fresh one
per entry is exactly what `repl.ts` documents itself as *not* doing.

**Let `repl.ts` do the capturing.** It is the only file that has the text, so
this is the shortest diff. It is also the one edit that would end the
evaluator's generality: the file's whole claim is that it knows how to scope
and evaluate and nothing else. A `toolsource` import there is the same mistake
as a `Point` import in `problem.ts`, one storey up.

**A module-level "current entry" in `repl.ts`, read by `replenv.ts`.** No host
wiring at all, which is tempting. But it is ambient state shared by every
`Repl` in the process, and the tests make several; the moment two exist, the
capture belongs to whichever ran last. Ambient globals are also precisely what
the curated scope exists to avoid, so writing one to implement a feature *about*
the scope reads badly.

**What was built: the evaluator publishes a fact, the host wires it.**
`repl.entry` is the entry in flight, `null` between entries, saved and restored
around nested evaluation. `EnvHandles.currentEntry` is how the command surface
asks for it — the same shape as `openModel`, `solve` and `view`, which are all
"things only the host can answer". It costs one line in `main.ts` and one in a
test, and in exchange the dependency is visible in the wiring instead of hidden
in a module.

Two things then came free, which is the sign the seam was in the right place.
**Built-ins are never captured** — they register from their own modules at
import time and never touch the wrapper — so the rule needed no check and
cannot be broken by adding a built-in. And **a `defineTool` reached any other
way records nothing**, because there is no entry in flight; that also covers a
tool defined asynchronously after its entry returned, which is a limitation
rather than a feature and is written down as one.

The other decision worth keeping: `tools` is a *parameter* of `save`, not
something it reads from a global. `main.ts` takes its undo snapshots with
`save(model, false)`, so leaving the parameter at its default is what keeps
authoring a tool from landing on the undo stack — no enumeration of "which
commands are edits", the same trick the undo bracket already plays with its
snapshot comparison. Had the sources been read from a module singleton inside
`toSaved`, every `defineTool` would have been an undo step, and the symptom
(Ctrl+Z appearing to do nothing) would have been baffling.

The inertness is checked the only way that means anything: the test fixtures'
tool sources would set a marker and throw if anything ever evaluated them, and
they are dragged through open, list, print and re-save with the marker still
unset. An assertion that `open` "does not evaluate" would have been a comment;
this fails if anyone ever adds the convenience button.

### Named dimensions, and the three decisions the spec left to the code

The owner's sentence — editing a dimension *"should be a `set(d4.value, 60)`
where d4 is the dimension"* — settles the interface completely and says nothing
about the machinery. Three things had to be decided while building it, and each
had a plausible wrong answer that would have passed the tests.

**Where does the prefix come from?** The spec offered "an argument or a lookup,
whichever reads better". An argument reads better at the call site and is the
wrong choice, because it is an argument every relation has to remember and one
of them will eventually not. The failure would be silent — a `d`-worthy relation
quietly named `r7`, discovered whenever someone next tries to `set` it. A lookup
on the op inside `model.relation` cannot be forgotten by a relation that does not
know it exists, and gives a user-authored relation the right default (`r`, since
it has no value to set) for free.

The related trap is the one the spec flagged: the rollback. It used to restore
`counters.get("r")` because there was only ever an `"r"`. Restoring `"r"` after
claiming `"d"` would leave the `d` counter advanced by a relation that *failed*
— and since names are handed out by order, a replay would then produce different
ones. It is a one-line change and the sort of one-line change that stays wrong
for months.

**How is a relation rebuilt without losing it?** The obvious implementation
removes the old blocks, re-runs the relation, and registers the result. It works
until the re-run throws — at which point the old blocks are gone, and they were
closures, so there is nothing to put back. The drawing has silently lost a
constraint because someone typed a bad number. Reversing the order costs nothing
and makes the failure free: build the new blocks first, and if the body throws,
remove *those* and leave the entry untouched. `rebuildRelation` also reuses the
`building` field that nested relations go through, which is what lets `set` call
`dist` and have it land in the existing entry rather than claiming `d2`.

Keeping the registry *position* is a `Map` detail worth stating out loud:
`Map.set` on a key that already exists keeps its insertion order. Delete-then-set
would have moved the dimension to the end, which nothing today depends on and
which would have broken the moment something did.

**How does a version-3 file's `deleteRelation` find its target?** The spec says
to build an old-name/new-name map during replay, and the temptation is to build
it by walking the journal instead: it looks equivalent and needs no plumbing in
the replay loop. It is wrong, and `fillet` is why — one journal entry that
expands into four relations. A journal scan would be off by four from that point
on, and would be wrong again the next time an operation's expansion changed.
Watching the registry fill up as the replay runs is exact by construction,
because the old scheme's `r1`, `r2`, … came out in exactly that order.

The finicky part is the old `autoName`'s skip: it stepped over a name an
*entity* had already claimed, so a drawing with a point called `r1` had its
first relation named `r2`. Entity names are untouched by this change and the
replay reaches each step having made the same ones, so consulting the live entity
map reproduces the old answer exactly rather than approximately. A `deleteRelation`
naming something the map does not know is left alone deliberately, so a
hand-edited file's typo fails with its own message instead of being rewritten
into the deletion of whatever happened to be in that slot.

**And one thing found by looking at the picture.** The first screenshot pair
showed a rectangle that visibly *tilted* after a `set` lengthened one edge. The
numbers said everything was fine, which is exactly the situation CLAUDE.md warns
about — so it was checked rather than assumed: right angles at 90.000000000,
edges parallel to 1e-6, the other dimension and the arc's radius and both
tangencies unmoved to nine decimals. The tilt is real and correct. Nothing pins a
bare rectangle's *orientation* — the rectangle tool adds two `par`s and a `perp`,
which fix its shape and leave its heading free — so the whole drawing rotates a
little as it re-solves. That is the no-world-frame decision working as designed.
The poster pair levels the drawing against a datum first, so the picture shows
the edit rather than the rotation, and the surprise is written into `TODO.md` so
the next person to meet it does not spend the afternoon on it.

### Retiring hor/ver, and the two questions the spec left open

The spec was clear about the *what* — `hor`/`ver` removed, `par`/`perp`/`ang`
take `"f1.x"`, persistence translates — and left two things to be decided
honestly. Both are worth writing down because both had a tempting wrong answer.

**Which other relations should take an axis reference?** The spec named `ang`,
`sym` and `on` as candidates and said to decide each. The tempting answer is
per-relation taste. The answer that survives is a *rule*, and it comes from
asking what an axis reference actually denotes: a **direction**, with no length
and no position. From that, the set is forced. `par`, `perp` and `ang` read
their arguments for a direction and nothing else, so they take one. `eq`
compares lengths and an axis has none. `on`, `sym` and `tan` each need a
*located* line — a place, not a heading — and the tempting move there is to
read `"f1.x"` as the line through the frame's origin along +x, which is a
perfectly sensible thing to want and exactly the wrong way to get it: one
syntax would then mean two different things depending on which relation was
reading it, and `fix(p, [t, 0])` already says "somewhere along the frame's x"
against a frame that has an origin. `ang` is the only inclusion `hor`/`ver`
did not already justify, and it is flagged as veto-able for that reason —
though "this edge at 30° to the frame" is, if anything, the commoner draughting
intent.

**What happens to the point form?** `hor("a", "b")` was a documented capability
with a table of its own in `ARCHITECTURE.md`, and the spec's instruction to
translate point-form journal entries has no destination unless `par` has one
too. Dropping it would have been a silent capability regression smuggled in
under a rename. So `par`/`perp` take a point pair as their first side, settled
on the subject's *kind* exactly as `hor` settled it — the same arity trick, in
the same house style. `ang` does not get one: its trailing numeric target would
have to be told from a third name by arity alone, and a form nobody has asked
for is not worth an ambiguity.

**Two things the spec did not anticipate, found while building.**

The first is a genuine bug the axis syntax would have introduced. `f1.x` is not
an entity name, so `relationsNaming("f1")` — which is what `deleteEntity`
consults before letting anything go, and what `del`'s cascade reads — would not
have seen it. A frame could then be deleted while a relation was still reading
it, and the symptom would be a residual throwing inside the *next solve*: about
as far from the mistake as a failure can land. The fix is one predicate,
`referentOf`, in `model.ts` — which is also the honest home for the syntax,
since `claimName` refusing a dot is a namespace decision and `relationsNaming`
understanding a dot is a reference decision. Turning a reference into a
direction is a different job and stayed in `relations/refs.ts`, one layer up,
beside `frameBasis`. One parser, two questions, each answered in the layer that
owns it.

The second was found by looking at a screenshot rather than at a number. The
`∥` mark for `parallel` is **not in the browser's monospace** and draws as a
tofu slab. It had been in the symbol table since the glyphs package and nobody
noticed, because `par` was a rare relation — the intrinsic rectangle's two, and
little else. Retiring `hor`/`ver` into it made it the commonest mark on any
drawing, four to a rectangle. The measurement that settles it: in that font
every mark advances 7.2246px and `∥` advances 6, which is the browser
substituting a fallback face. `//` is in the font, is what a draughtsman
writes, and reads instantly. The guard is the interesting part — an e2e now
measures *every* symbol in the table against the monospace cell, because this
is precisely the class of thing a picture can be looked at and still missed,
and precisely the class of thing a number settles in a line.

**One thing that needed no decision at all.** `par(l, "f.y")` is numerically
identical to what `ver(l)` computed — the wedge with +y *is* the dot with +x,
for a unit basis — so the frames package's closed-form tilted-frame tests came
across with their assertions and tolerances untouched. That is the check that
the rename really is a rename.

### The context menu, and the search for the seam it should type through

The spec for this one was unusually specific about *what* every item should do
and deliberately silent on *how* an item does it: "the menu types into the same
machinery the command line uses". Finding that machinery was the whole of the
work worth writing down; everything else in the package is bookkeeping.

**The seam is `submit`.** There were three candidates, and the choice matters
more than it looks.

The first was to call the REPL directly — `repl.eval("del(\"r5\")")`. It is the
obvious one and it is wrong, because it would produce a menu action that does
not appear in the log, is not one undo step, does not push onto the recall
history and does not re-solve. Each of those is a separate bug and each would
be found separately, weeks apart.

The second was to write the text into `#cmd` and dispatch a synthetic Enter.
This reaches the right function, and it is the version I would expect an agent
in a hurry to write, because it needs no change to `main.ts` at all. It is
worse than it looks: it destroys whatever the user had half-typed (which is
often the very thing they right-clicked to add a name to), it makes the seam
invisible to anyone reading `menu.ts` — the connection between the menu and the
command line is a keystroke code, not a function call — and it breaks silently
the first time the input's keydown handling changes shape. Faking input to your
own app is a way of programming against yourself.

The third, and what is here, is one explicit hook: `main.ts` hands the menu
`run: (command) => void submit(command)`. `submit` is the function the Enter
key calls. It logs the entry, pushes it onto the history, opens the undo
bracket, evaluates, closes the bracket and re-solves if anything changed — all
five, in that order, in one place. The instruction I was working from allowed a
small explicit hook in `main.ts` over reaching into the DOM, and this is why
that is the right preference in general: the hook is one line and one named
argument, and it makes the claim "a menu item is a typed command" checkable by
reading rather than by trusting.

The payoff is the size of the test surface. Nothing about undo, journalling,
the recall history or the status readout is new, so nothing about them needed
designing. The e2e test that says "the Dimension action is one undo step"
passes because a typed `dist` was already one undo step; it is a regression
test on the seam, not on a mechanism.

**`fix` gets frame coordinates, not raw ones.** The spec said
`fix(name, current-coords)`, and taken literally that is `model.coords(name)`.
Taken literally it is also wrong, because `fix` has been frame-relative since
the no-world-frame change: against a frame turned 45° and sitting off the
gauge's origin, `fix("p1", [13, 9])` means a *different place* from where p1
is, and the constraint would move the point the instant it landed. The item is
specified as "hold it where it is", so it types the point's offset from the
frame's origin along each unit axis. There is a unit test with a frame turned
90° and moved to (10, 5) which fails on the raw form; without it the bug would
have been invisible in every test that used the suite's axis-aligned fixture
frame, which is nearly all of them.

**Disabled rather than absent, for Fix with no frame.** Omitting the item would
have been less code and is the wrong answer: the absence of a frame is exactly
the thing the user needs told, and a menu that silently varies its own length
teaches nothing. The message is read out of `model.resolveFrame`'s own throw
rather than copied, so there is one wording in the codebase.

**Two things beyond the spec.** Each item shows the command it is about to
type, in dim text beside its label. That is not decoration — the stated purpose
of the menu is to *teach the commands rather than hide them*, and an item
labelled only "Dimension" hides them exactly as much as a toolbar button does.
And the header on an entity is `describePick`'s sentence, the same one the
hover tag writes, rather than a second spelling of the same fact.

**What I left alone, and why.** A right-click while a tool is armed opens the
ordinary menu rather than something tool-specific: two rules where one will do,
and the ordinary menu's tool arms are a reasonable escape hatch out of a
half-finished gesture anyway. A right press taken *during* a left drag opens
nothing, because interrupting a gesture in progress is never what it means —
this is the `buttons`-mask path that once made mid-gesture panning silently do
nothing, so it has a test of its own. And the menu's contents are hard-coded
per pick kind, which is a real gap next to "tools are not privileged": a
relation defined at the command line cannot put itself on a menu. Closing that
is a package, not a paragraph, and it is in `TODO.md`.

### The 3-point arc, and the click that is thrown away on purpose

This one arrived without a spec — a sibling of `circle3` with the instruction
to write the spec first and then build it. Two things in it are worth the
entry, because neither is visible in the diff and one of them is a decision I
could have gone the other way on.

**The waypoint is not geometry.** `circle3` and `arc3` look like the same
tool: three clicks, a circumcircle, one free entity seeded at the answer. They
differ in what the third click *means*. All three of a 3-point circle's clicks
are rim points, and all three `onCircle`s are the circle's definition — the
circle follows the points, which is the thing a user can feel and the reason
the free-entities package existed. A 3-point arc's third click is not a claim
about the arc; it is a *choice between two arcs*. Onshape does not keep it,
and the temptation to keep it anyway is strong precisely because it would make
`arc3` symmetric with `circle3` and would leave the arc pinned instead of
loose.

I rejected it on three grounds. The first is deference: this repo copies
Onshape where Onshape has an answer, and Onshape throws the waypoint away. The
second is the standing rule that tools do not dimension what they draw — a
waypoint held by an `onCircle` is a dimension in all but name, since it fixes
the one thing about the arc the endpoints leave free. The third is the one
that actually decided it, and it is the fillet's argument reused: the point
would sit in the middle of the arc, named, drawn and listed in `ls()`, and
nothing would ever want it there. It *is* deletable — `del` takes the point
and its `onCircle` together, and the arc simply stays put and goes loose — so
this is litter rather than a trap. But the fillet reuses its shared corner
precisely so that a gesture does not leave stray dots for the user to clean up
by hand, and a tool that makes the user delete part of its own output every
time is a worse deal than an arc that starts under-constrained, which is what
every other tool in the box already hands back. So the bulge is free, it is
documented in three places, and there is a test that *demonstrates* the
freedom rather than asserting the absence of a constraint — it shoves the
centre along the perpendicular bisector and finds the system just as solved at
a different radius. A caveat that is documented and tested is a decision.

**Writing my own spec is a weaker check than being handed one.** The `circle3`
spec was written by a different session, and its one deviation — centroid seed
versus circumcentre — is on the record because there was something to deviate
*from*. Here the spec and the implementation come from the same head, so
"built as specified, no deviations" means considerably less than it usually
does. Two things did move from coding into specifying rather than the other
way round (the second-click-on-the-first guard, and pulling `circumcircle` out
into its own module), and I have noted them at the top of the plan for
whoever reviews it. The honest summary is that the spec is a design record
here, not an independent check.

**The one thing I would have got wrong without a picture.** The e2e spec first
asserted that a downward-bulging arc has its centre *above* the chord. That is
true for a minor arc and false for a major one — the answer flips with the
sagitta — and the browser caught it as a failure on the second story. The
right question is where the *midpoint of the sweep* is, which is also what a
person looking at the drawing actually judges. The screenshot shows the same
thing from the other side: image 42's arc bows above the rectangle while its
centre `p7` sits below the top edge, which looks wrong for about a second and
is exactly right.

### No world frame, half 2: a datum is moved, not persuaded

Half 2 was meant to be the presentation half — draw the frame, let it be
clicked and dragged, close the line tool's aim against the frame's axes, tell
the story end to end. Most of it was. The exception is worth the entry.

**The package's own poster gesture did not work.** Drag a frame's x-ref and
the whole levelled drawing is supposed to turn to follow. It moved the frame
0.003° against a gesture asking for 26 — not slowly, not approximately:
essentially not at all, silently, with `SOLVED` on the header the whole time.

The cause is the direct consequence of the half-1 decision recorded above,
and it is one the spec did not see coming: it assumed read-never-pushed was
exactly what would make this drag work ("turn the drawing rather than start a
tug of war"). It prevents the tug of war, certainly. It also stops the drag.
A `hor(line, frame)` block does not declare the frame's points, so the
Jacobian has no row saying "turn the frame and the line must follow". The
drag's own weak pull *does* have a row, so the linear step does move the
frame — and then the damped solve evaluates the result, finds the total
residual has gone *up* (every levelled edge's error grows by its whole length
times the angle, where the pull's row falls by a fraction of that), rejects
the step and multiplies λ by eight. Eight tries per iteration, and the frame
sits still. Every part of that is the trust-region step acceptance doing
precisely its job on a problem whose derivative it was deliberately not given.

The fix is the other half of the same principle rather than a retreat from
it: **a datum is moved by the user, not negotiated with by the solver.** A
drag on a point that some frame reads assigns the position outright, and the
same solve then carries the drawing to it — the Gauss-Seidel sweep
`frameBasis`'s own note says this trade costs, now actually being taken.
The weak pull is still applied on top, so nothing is lost where the point
happens to be ordinary geometry as well: those relations *do* declare it, they
win the solve as they always did, and the gesture degrades to the ordinary
kinematic drag. That case has its own test, because it is the one where the
outright move must not be the last word.

Three smaller things, all judgement calls:

- **The marker's arms are a fixed pixel length.** How far the x-ref sits from
  the origin is meaningless — only its direction counts — so an arm drawn to
  it would put a number on screen that carries no information and changes with
  the zoom. It also makes the marker a deliberate, constant-sized target, the
  same argument that puts constraint glyphs in the top pick tier.
- **The origin point out-ranks the marker in the pick tiers**, because points
  are tier 1 and nothing was changed about that. It turns out to be the right
  answer rather than a compromise: dragging the corner turns the frame,
  dragging an arm moves it, and those are two gestures a hand can tell apart.
- **`framemarker.ts` exists because three files needed the same answer** —
  `main.ts` draws the marker, `picking.ts` hit-tests it, `boxselect.ts`
  catches it — and `picking.ts` and `boxselect.ts` are peers, so putting it in
  either would have been the first sideways import between them. Three copies
  of "where are the arms" drift by a few pixels and leave a frame that refuses
  to be clicked where it plainly is.

### No world frame: why the frame is read and never pushed

The spec for this package said to take the frame's point variables *lazily*,
"the house rule", so that a frame whose points get re-targeted keeps its
relations honest. Half 1 does follow the house rule — the frame's position is
re-read at every evaluation — but it deliberately does **not** declare those
points as variables of the residual block, and that is worth writing down
because it is the one place the implementation departs from the letter of the
spec.

Declaring them was built first, and then measured. Put a 40-unit line seven
units off level, say `hor(line, frame)` against a frame with a 20-unit arm,
and solve: the *frame* turns about 8° and the line barely moves. Both readings
satisfy the constraint — the residual only says the two directions agree — and
least squares splits the correction in proportion to how far each thing has to
move, which on those numbers favours the frame heavily. It was worse than
that with the residual written as a plain `wedge(d, xref - origin)`, the form
`par` uses: shrinking the frame's arm makes the residual smaller directly, so
the solver pulled the arm in by 14% as well and called it level.

Three things could have been done about it. Normalising the frame's direction
kills the shrinking (and is kept, for that reason) but not the turning.
Making the frame's arm enormously long makes it stiff — the frame's share of
the rotation goes as roughly (drawing size / arm)² — but "enormously" turns
out to mean about 1e6 against a drawing of order 100, which is a magic number
pretending to be a design. And translation cannot be fixed that way at all:
`fix` reads the origin with exactly the sensitivity it reads the point, so a
fixed point and the frame's origin simply meet in the middle. A drawing pinned
to a frame would drift across the canvas as it was dimensioned.

So the third option: the frame is a **datum**, and a datum is not something
the geometry referencing it pushes around. Every CAD system a user arrives
from behaves that way. The frame's position enters the residual as a value,
refreshed each evaluation; the block declares only the geometry it constrains.
The Jacobian is exact for the block as declared, and where the frame does move
— because a drag or a dimension moved it — the solve behaves like one
Gauss-Seidel sweep and converges without complaint.

Two payoffs beyond the principle. The spec's own acceptance test becomes
literally true: a drawing levelled against a frame tilted 30° settles at
exactly 30°, not somewhere between its own angle and the frame's, so the check
can be closed-form instead of `solved: true`. And the mechanical part of the
package really is mechanical — every existing test keeps the coordinates it
was written with, because nothing a test constrains can drag the fixture frame
off the axes.

Two smaller decisions, both deliberate and both documented where they live.
`fix` above 2D keeps its old gauge-relative meaning, because a frame is an
origin plus one direction and that settles nothing in 3D; making `fix`
frame-only would have cost the vocabulary its dimension-genericity, which is
load-bearing elsewhere. And the rectangle tool went intrinsic in half 1
rather than half 2, not out of enthusiasm but because there was no honest
alternative: `hor` needs a frame, a new model has none, and a rectangle tool
that throws on a clean sheet is a broken app.

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
