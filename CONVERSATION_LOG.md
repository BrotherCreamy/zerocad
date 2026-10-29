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

### Extrude on a frameless sketch: the layer above makes the plane, and the tool waits for it

**The owner**, with a screenshot of eight identical refusals ("the loop of
l1,l4,l3,l2 lies in no frame's plane …"): *"how does extrude work? i don't
really understand this"*. The refusal was right by the register's rule (no
world frame: an extrude reads its direction off a frame, and inventing one
would be a datum nobody chose) and wrong about what counts as inventing. A
frame of three of the loop's own points is the one "Sketch on this face" has
made since 2026-10-21; it is the sketch's plane, it follows the sketch, and it
journals as an ordinary `frame(a, b, c)`. The rule now says so in its own
register entry.

**Why not inside the operation.** `extrude` making the frame inside its
`asOperation` would journal the frame nowhere — the body runs unrecorded, and a
replay of the `extrude` entry would then name a frame that does not exist yet.
Making it in `extrude()` but outside `asOperation` would journal in the right
order and was the smallest diff, but it is an operation deciding to create a
datum, the thing the rule is about; the spec put it in the layer above, and the
refusal left below became a guard worth having (a test asserts it still
stands).

**Why the tool waits, and why that needed a new seam.** The first shape was
the spec's literal one: type the plane through `ctx.run`, then extrude. The
plane does run synchronously — the REPL's `AsyncFunction` runs until its first
`await` — but `submit`'s undo bracket and its log of the answer close a
microtask later, so an extrude made as `ctx.run` returned landed inside the
typed line's step: one Ctrl+Z took both, and the log said `e1` before `f1`.
Measured by making it synchronous and watching the e2e fail there. So `run`
settles, the tool waits, and `ctx.act` gives it the engine's bracket for the
commit. Rejected: typing the extrude too (`extrude(member, depth, frame,
loops)`, the journal's form) — it would have made the log perfectly uniform,
but a region split by a crossing names points that do not exist until the
operation materialises them, so the typed form cannot say what the click
chose; the tool's direct `extrudeProfile` can.

**Why the tools now always say what they made.** The spec's e2e asked for `e1`
in the log. A line only after a typed plane would make one click talk and the
next stay silent, so both tools report every commit (`describeFeature`) — as a
`"done"` line, shown in the answer colour, because `ToolContext.log` had only
ever carried refusals and the host showed everything it carried as an error.

**Why check before making the frame, rather than take it back.** A typed
`revolve` with an axis off the plane would otherwise make the frame, be
refused, and leave it — journalled, in the file, and an undo step for a call
that failed. Taking it back would have meant `del` and `setDefaultFrame(null)`
entries for nothing, or editing the journal by hand. Checking first is the
house pattern (`withClauses` checks every clause before making anything), and
revolve's geometric refusals do not care which way the plane faces, so they
can be asked of the loop's own normal before any frame exists.

### Any corner, and a tray that wraps: whose is each side of a tray

**The owner:** *"allow me to rescale the popup windows from any corner. the
tool palette should wrap the icons also - i.e. if it is vertical and i
decrease vertical size, it should create a second column."*

The corners were mechanical: `resized` takes which corner, and the grab, the
pushes, the flush stop and the storage all come for free because every grip
goes through the one `dragStep` → `pushed` path. Two things in the resolver
only showed up once an edge could grow to the west or north. The push
direction was the pointer's sign, which is the rectangle's growth direction
for every drag and every south-east resize there had ever been; for a tray
whose depth is not the pointer's (below), it is not: a column shortened from
its north-west corner with the hand drifting right gains a line to the west,
and pushing the pointer's way would throw what that line covers across to the
east side. (Found by reading `pushed` before the first run, not by a test.)
And the flush pull-back interpolated position and length together, which is
exact for a south-east grip (its position does not move) and 3·10⁻¹⁴ px into
the neighbour for a north-west one — that one the new per-corner unit test
caught. Both were fixed in place rather than special-cased for the
new grips, so the rule reads the same for every axis and every corner.

**The wrap needed a decision the spec did not make: which of a tray's two
sides is the viewer's.** The spec said the wrap is "the panel's content box
deciding" — CSS flex-wrap in the stored rectangle. But a corner moves both
edges, and the owner's own example — a column made shorter — does not make it
wider; flex-wrap in that box puts the second column outside it, which is the
scrollbar back or buttons lost. Three ways out were weighed:

- *Both sides the viewer's, the depth floored at what the lines need.* The
  depth grows by itself when the column is shortened, but never shrinks back
  when it is lengthened (the floor is the current width), so a column dragged
  short and back keeps an empty second column until the viewer narrows it by
  hand. Rejected for the asymmetry.
- *The depth the viewer's and the run derived* (drag a column wider and it
  gets shorter). Inverts the owner's sentence: he shortens, it wraps.
- *The run the viewer's and the depth derived* — taken. Shorter wraps, longer
  unwraps, symmetric, and every button is always shown. The cost is that a
  column's corner dragged sideways does nothing; written down in TODO as a
  limitation rather than hidden.

Capping the run at one line followed: a column taller than its buttons would
be a strip of nothing, and with the depth derived there is no other way for
empty space to appear. The cap also makes a stored run from a session with
more tools (a command-line tool, gone on reload) come back tight.

**When the depth cannot grow by a whole line.** `pushed` resolves each axis on
its own and will happily stop the depth part of a line deep against a chain —
which would clip a column. The fix is a second ask: take the lines the depth
reached and the shortest run that holds every button in them, or, if the run
was the axis that got cut, the lines that run needs; and if that comes back
cut too, stay put. A closed form rather than a search, for the same reason
`pass` is exact: a search stops a fraction short, and a fraction short of a
line boundary is a different number of lines.

**Rejected: remembering whether a moved tray was "full".** A moved one-line
tray that gains a command-line tool now wraps that one button into a second
line instead of growing a button longer. Keeping the last button count in the
DOM half and growing a tray that was exactly one line long would fix it, but
it is a heuristic standing in for the fact the layout does not store (whose
the length was), the spec kept the stored shape unchanged, and wrapping is
already strictly better than the scroll it replaces. It stays in TODO with the
real fix named.

**The grips are clipped to triangles** because four 12 px squares on a 28 px
tray leave its strip a 4 px slot and take most of the lower half of the corner
buttons. `clip-path` clips hit-testing as well as painting, and mirrors with
the element's transform, so one rule draws and shapes all four.

### Undo, bulletproof: the chord is the drawing's, and the text stays put

**The owner:** *"why does ctrl+z and ctrl+y not work? should work and be
bulletproof"*. Measured by the supervising session before the spec was
written: in headless Chromium the keys worked from every focus position but
one — text left in the command box, where the undo package's carve-out handed
Ctrl+Z to the browser's text undo, which emptied the box and left the drawing
alone. That carve-out was the decision the undo log entry below says "took the
longest to settle for how small it is", and it was wrong in the way that
matters most: it made the key look broken. Its reasoning — that undoing the
drawing mid-sentence is the worse of two wrong answers — had a premise nobody
tested, that the text undo was the *right* answer for someone with text in
the box. What someone pressing Ctrl+Z in a CAD tool means is the drawing.

**Why the text is kept rather than cleared or left to the browser.**
`preventDefault` on the chord means the browser's text undo never runs, so the
box keeps exactly what was in it. Clearing it would have been the opposite
mistake (destroying a half-written command to make room for an undo nobody
asked to make room for), and letting the browser have the keystroke *as well*
would have done two things with one press. Anything already submitted is still
one ↑ away, which is why a half-typed command is not otherwise protected.

**`code` only as a fallback.** The spec said accept `e.code` beside `e.key`.
Taken literally that is a bug on German keyboards: QWERTZ puts the key printed
Z at a US Y's position, so its event says `key: "z"`, `code: "KeyY"`, and a
matcher accepting either would read it as undo and redo at once. `code` is the
answer only where the layout produced no Latin letter at all (Cyrillic,
Greek), which is the case the spec was reaching for. The matcher is a pure
function in its own file so the unit suite can feed it layouts no test machine
has.

**The note beside the verdict, not over it.** The spec asked for the status
readout to say "undid" briefly. Writing it into `#status` was rejected: for a
second and a half the header would not be saying SOLVED or CONFLICT, and a
readout that hides the verdict on a timer is the stale-readout bug by design —
the first browser-only bug in ARCHITECTURE's list was a stale status line. It
also would have made every e2e test that reads `#status` straight after a
Ctrl+Z wait out the timer. So the note is its own element beside the verdict,
in the header, and `#status` is untouched.

**The tool stays armed, as a new instance.** Before this, an undo disarmed
whatever was armed, as a side-effect of `swapModel` cancelling the gesture.
The spec wants the gesture gone and the tool kept, and the gesture *is* the
tool instance's state (the line tool's pending click, its chain anchor), so
"keep the tool, drop the gesture" is a fresh `arm` with the same name and
options after the swap. The engine grew a read-only `armed` for that. The one
case it does not re-arm is a tool the restored model cannot run (a curve tool
whose default frame was just undone): arming it would put a tool on the
toolbar's greyed button whose first click can only fail, so it is left
disarmed with the toolbar's own reason in the log.

**The spec's line-tool cell was wrong about the code.** It expected the point
placed by the line tool's first click to be undone; the first click places
nothing (the line tool commits both ends on the second click, so an abandoned
chain leaves no stray point). The test checks what actually happens — the
preview goes, the step *before* the gesture undoes, and the next two clicks
make a line between them rather than from the abandoned first click — and a
mid-chain cell was added for the case the spec was reaching for, where a
committed segment is what undoes. A mid-drag cell too: cancelling a drag first
settles it into a step, so the one keystroke takes the drag back, and the rest
of the held gesture moves nothing.

**Rejected: a separate undo for layout and camera.** The spec is explicit that
they are not steps; `help()` now says so, because an orbit followed by a
Ctrl+Z that undoes an edit is the other way this reads as broken.

### The grasp point stays the same — and what the slip had been hiding

**The owner:** *"actually the grasp point should stay the same"* — reversing
rule 2 of the push package a day after it was built. The spec's "Reversed"
section in `docs/plans/panels-push.md` made it: the grab fixed at the press,
never re-based on a stop, drag and grip alike; a tray that turns keeps the
same point of its strip. The change to `dragStep` is one line — hand back the
grab it was given. Everything else here is what that line exposed.

**Where the turn puts the tray.** The spec fixes the grab after a turn, not
the placement, so `turned` still holds the edge the tray met. Against the top
or left that is where the strip — and the hand — already is. Against the
bottom or right it is the far end: a column eased onto the bottom edge becomes
a row lying along it, the hand a column's height above. Under the slip that
was invisible (the grab re-based onto the row wherever it was); under a fixed
grab the next move brings the row up under the hand. Considered and rejected:
turning the tray *in place* round the hand. It is what "the grasp point stays
the same" most literally pictures, but `turned`'s own doc comment rejects
exactly that ("not a row floating where the column's top was"), two e2e tests
release a one-step turn and expect it docked against the edge it met, and it
flip-flops in the same corner bands as the version built. Released before the
next move, the tray as built stays docked — which is a reasonable thing for a
gentle push onto an edge to do.

**The flip-flop.** A fixed grab plus a turn that transposes the grab (a
column's strip runs across its top, a row's down its left end, the same 28 px
both ways) is an involution: turn, and under the hand the new shape can sit
exactly where the old one turned. Measured with a scripted 600-move drag of a
row just under the top edge, held high on its strip, eased right onto the right
edge: 225 flips. The slip had broken the symmetry by re-basing. Rejected:
hysteresis by distance travelled since the last turn (state the pure function
does not have, and a threshold nobody asked for). Built: a turn is refused when, brought back under the hand, the new shape
would turn straight back. One more `orientationFor` call, stateless, and the
drag ends with one turn, at the corner. Over 40 seeds × 2 000 random drags the
count of a turn immediately undone on the next move is 14, against 23 under
the slip (and 4 404 turns in all against 5 796). The three looked at are the
hand crossing a snap band near a corner — a column in the bottom-left corner
moved two pixels clear of the left edge is a row on the bottom — which is a
real change of contact, not a flip on every move.

**The second round.** The random walk was asked to assert "under its grab
point whenever not blocked", and "blocked" had to be something the test could
check without asking the resolver — so it is worked out from the layout: the
lagging face is on the area's edge, or flush against a chain of panels that
ends there, or (a grip shrinking) the panel is at its minimum. It failed on
drag 20: the tray, moving up-right, was stopped in y by the log's bottom
*before* its x pass carried it clear of the log, so it ended short of the hand
with nothing above it. `pushed` takes axes one at a time on purpose (the
drift case in the entry below), so the fix is in `dragStep`: if the move ended
short, ask again from where the panel got to, at most three rounds, stopping on
a round that moves nothing. 40 seeds × 2 000 drags: zero violations.

**Window coordinates.** The unit suite was green; the first browser run failed
the turn against the log's right edge. The DOM half had always passed
`clientX/clientY` while the layout is in the area's coordinates, 32 px of
header lower — harmless while every move re-based the grab, since only
differences mattered. A held grab is a point *of the panel*, and `regrasped`
moved those 32 px from the column's "down" to the row's "along". The pointer is
now converted at the press, with the area's origin measured once (measuring on
every move would force a layout after each `show`). Eighth on ARCHITECTURE's
list; `CLAUDE.md`'s copy of the count still says seven, left for the owner.

### Panels push one another: per axis, exact, and the grab slips

**The owner:** *"shouldn't be able to drag windows over other windows. they
should collide and push one another around. not collide like physics, just
push. also when i grab a window at a point on that window, then push it up
against something, the grab point should kind of slip, so that when i push it
back in the opposite direction, it doesnt have to get back to the original slip
point"*. The spec (`docs/plans/panels-push.md`) made it one pure resolver,
`pushed`, through which every arrangement goes.

**Decisions made in the code, and what was rejected:**

- *Each axis of the motion in turn, not everything along the dominant one.*
  The spec said: resolve an overlap by moving the other panel along the
  motion's dominant axis by the amount that separates them. Worked through,
  that breaks on the commonest drag there is. A tray resting on the log (after
  being pushed onto it, or turned against it) dragged right with one pixel of
  downward drift overlaps the log by one pixel; along the dominant axis the
  amount that separates them is the tray's whole overlap in x, so the log
  jumps sideways hundreds of pixels — or, with no room for that, the chain
  "fails" and the tray cannot be dragged right at all while the hand drifts.
  Taking x and y in turn (the larger first, so a near-horizontal flick into a
  panel's side is resolved in x before the drift is considered) pushes the
  log down the pixel. Face-on, it is the same result the spec asked for, and
  its "diagonal motion pushes along the dominant axis only" test passes as
  written. Rejected also: a minimum-translation push (out along whichever
  axis separates least), which slides a panel round the mover's corner — the
  "sliding round corners" the owner's "just push" rules out.
- *The flush stop is computed, not searched.* Along one axis, every panel the
  chain moves moves exactly as far as the mover's leading edge does past the
  point where the chain reached it, so the chain's overshoot past the edge
  grows one for one with the travel. Pulling the travel back by the
  overshoot is the largest travel that fits, exactly; a bisection gets within
  a fraction of a pixel and a test asking for "flush, to the pixel" would
  need a tolerance. The loop re-checks (a shorter travel can meet a different,
  shorter chain) and, failing a few rounds, stays put — always sound.
- *The chain revisits.* "Breadth first, never revisiting" leaves overlap when
  the mover reaches a panel directly with a short push and another panel it
  pushed then reaches it further; never revisiting, the two stay on top of
  each other. A unit test builds exactly that. All pushes in a pass go one
  way along one axis, so positions only grow and the loop ends.
- *The swept rectangle pushes.* The 2 000-drag random walk failed on its first
  run: a single pointer event that moved a panel further than a narrow panel
  in its way is wide put it on the far side, clear, having pushed nothing.
  Real mice do that on a fast flick. The mover's interval from where it was to
  where it lands is what is tested for overlap; it lands where it lands.
- *Float noise is snapped.* The same walk's second failure was a tray at
  y = −7e-15 after a pull-back: exact in arithmetic, a few ulps out in floating
  point. A moved panel within 1e-6 px outside is put on the edge; overlap
  itself is measured with the same tolerance, so a shared edge is never read
  as a sliver.
- *Load: earlier panels hold their places.* Read literally, "each panel is
  pushed into a non-overlapping place" with that panel as the mover means a
  toolbar grown for a new tool, placed first, gets shoved by the log placed
  after it — off the left edge, failing, then to the log's far right. With the
  earlier panel as the mover, the grown toolbar stays and the log makes way.
  What `apply` moves is not stored: a wider window may need none of it.
- *Zero motion tries x away, x back, y away, y back.* The spec said only "ties
  resolve along x". A turn whose row would cover a panel that cannot go
  sideways now pushes it down; one that nothing can make room for simply does
  not turn.
- *The slip is the grab re-based every move*, as the spec said — and that one
  rule replaced the special re-basing the drag used to do after a turn. The
  grip slips the same way, which the spec did not ask for: a log shrunk past
  its minimum used to need the pointer back past where it stopped before it
  grew again, the same annoyance the owner described.
- *The invariant is asserted in the browser over every gesture*, not only the
  measured ones: under the dev server the DOM half `reportError`s any overlap
  it shows (unless the resolver said the window cannot hold them), and every
  e2e file already asserts no uncaught page errors. Reported, not thrown, so a
  developer who trips it keeps a working page.

**Left in place deliberately:** a window too small to hold the panels side by
side at their sizes leaves the last one over its neighbour (pushing never
shrinks); a pushed tray does not turn; with zero motion a toolbar grown onto
the log nudges the log sideways by the tray's thickness, the x tie, rather
than down.

### Hidden edges: dim the ink, keep the drawing on top

The spec (`docs/plans/hidden-edges.md`) kept the rule that made a solid
usable — the drawing over the faces, still the thing a hand aims at — and
asked only for the hidden part of an edge to change ink. What was decided:

- *Ask on the CPU, not the depth buffer.* The depth layer knows per pixel
  what is in front, but reading it back stalls the frame and gives a picture,
  not an answer per edge. The e2e oracle already answered "which face is in
  front at this pixel" from the faces' planes; it became `src/occlusion.ts`,
  and the harness imports it. One implementation means the oracle is no
  longer independent of the app's *dimming* — but the oracle grades the depth
  layer, which is GPU code that shares nothing with it, and the dimming's own
  tests choose their hidden points by geometry (an edge on two turned-away
  faces whose pixel is on the solid), not by asking the module.
- *"Behind" square to the plane, rejected: along the ray.* The spec said
  "nearer by more than ε". Along the ray, the same quarter-pixel by which a
  curve's drawn polyline and its strip's outline disagree is multiplied by
  1/cos of the grazing angle: at a degree off edge-on it is a dozen pixels, so
  a strip seen nearly edge-on would hide its own boundary curve. Square to the
  plane the error is what it is at any angle; for a face that faces the viewer
  the two measures have the same sign. The price, documented: a sliver face
  hides only what is well behind it.
- *The seam half-way between samples, not at a sample.* Free, and halves the
  slack to 2 px. Bisecting each seam to the true crossing was considered and
  left: the spec's "sampled, not solved", and 2 px is under the convention's
  resolution.
- *A solid ink, rejected: transparency.* Alpha would blend with whichever
  face is under the edge, which reads well, but then a hidden run and a
  partly-covered pixel of a full one are the same colour at different alpha
  and nothing can tell them apart; and two hidden edges crossing double up.
  The edge's colour 40% of the way from the faces' mid tone keeps amber
  amber and is one colour anywhere. No dashes, as the spec said.
- *Pixel-identical, against what?* "The same picture as the previous build's"
  can only be held by a picture the previous build drew, so the second commit,
  made before the pass existed, records the plain sketch's drawing canvas and a
  test that compares it pixel for pixel. It is tied to the e2e browser, which
  is pinned; re-recording is an explicit act.
- *Cull by edge as well as by sample.* A full turn has 860 strips facing the
  viewer and only a handful of edges, so the faces whose boxes miss an edge's
  are dropped once per edge rather than tested once per sample.

### The tool tray: icons, held inside, turning with the edge it meets

**The owner vetoed three defaults in three lines** — *"I shouldnt be able to
slide the tooltrays off the edge. they should stay fully within the viewport
borders"*, *"tools should be icons"*, and *"when I push a vertical tooltray
against a top or bottom edge, it should become horizontal etc and vice versa.
that includes pushing it up against a vertical/horizontal edge of another
tooltray"*. The spec (`docs/plans/toolbar-icons-docking.md`) made each a rule;
this is those rules, with the decisions the spec left open made as follows.

**Decisions made in the code, and what was rejected:**

- *An icon is a table keyed by name, not a static on the tool class.* The
  spec offered both. A static is inherited: a command-line tool written as
  `class extends CircleTool` under a new name would wear the circle, which is
  the guessing the spec forbids. A name is not inherited, and it is what every
  other surface keys a tool by — `arm`, and `toolUnavailable` — so a
  re-registered `circle` keeps the circle's glyph for the same reason it keeps
  the circle's availability rule. One table also keeps eleven glyphs one
  visual family, which a unit test holds (one stroke width, `currentColor`, no
  fill but a dot or the generic glyph's letters).
- *The snap distance is 6 px, not the spec's "8, say".* The default layout puts
  the toolbar 8 px off the top and the left. At 8, inclusive, the untouched
  toolbar dragged sideways along the top would turn into a row on the first
  pixel — a surprise nobody pushed for. Anything under the margin works; 6
  leaves room.
- *A row's strip runs down its left end.* With the strip across the top a row
  is a strip plus a button, 44 px — a short column lying down rather than a
  row. Down the left end, a row is one button high, which is what the spec
  asks. The strip is then too narrow for the word "tools" either way, so it
  is a grip of dots with "tools" as its title.
- *Which edge a turn keeps.* The one it is against: the bottom when only the
  bottom is in contact, else the top; likewise right/left. The other axis keeps
  its near edge, where the strip and so the pointer was. After a turn the drag
  is re-based at the pointer, because the new shape measured from the press
  would jump back to the old shape's anchor.
- *"Beside" means facing edges.* The tray's bottom against another panel's top
  (or top against bottom, left against right, right against left), within the
  snap, overlapping along that edge by more than zero. A tray lying over the
  log is against nothing of it; touching only at a corner is not overlap.
- *The tooltip is `name — command`, and `name — reason` when disabled.* The
  spec's example was one line; the spec's other text said "the command under
  it" and "the reason, as now". The reason alone would leave a greyed icon
  that never says which tool it is, so the name leads both.
- *Glyphs tried and dropped:* a revolve drawn as an axis with a foreshortened
  elliptical arrow round it read as an anchor at 16 px; it became a profile
  inside three-quarters of a circle with an arrowhead. Arcs shallower than a
  half turn read as a bent line (and arc3 with dots as a caret); circle3's dots
  had to grow to 1.9 units before they read at 1x.

**Found on the way:** the old e2e test "a panel cannot be dragged where its
strip is out of reach" never moved the panel. The resize test before it left
the log grown over the command line's strip, so the press went to the log, and
the assertions (strip inside, 40 px of it on screen) held at the untouched
default. It now resets the layout first and asserts the panel moved.

### Display depth: measure the painter's against a depth buffer, then let the buffer draw

The spec (`docs/plans/display-depth.md`) had already chosen WebGL over a BSP
split, on the argument that `faces.ts` already produces what a depth buffer
needs — planar outlines with an outward normal — and asked for the choice to
be measured before it was shipped, with a stop rule. What happened, and what
was decided along the way:

- *The depth layer came first, unwired.* "Both renderers exist in the tree"
  was not yet true, so `src/facelayer.ts` was written with the painter's moved
  beside it unchanged, and the first commit measured the app's painter's
  against it without the app using it. That kept the "before" honest: the
  painter's numbers are of the code that shipped.
- *What counts as wrong.* Two renderers never agree pixel for pixel at an edge
  (multisampling against Skia's coverage plus the old hair-wide stroke), so
  the count excludes a 1.5 px band round every visible outline and anything
  under 7 levels. The lone box and cylinder are the control — the painter's
  cannot sort a convex solid wrong — and they come out at zero, so the band
  hides anti-aliasing and nothing more there. Along a dense sweep it also hides
  some real error; the 355° number is a floor and is reported as one.
- *Timing offscreen was tried and dropped.* Forcing a painted 2D frame to
  finish needs a read back, and Chrome answers repeated read backs by moving
  the canvas into CPU memory: 0.6 ms a frame then, against 12 ms for the same
  22 faces on a canvas made the way the app makes it. That number was of a
  different canvas, so the app's own frames are timed instead, both ways, with
  WebGL taken away by an init script for the painter's — the fallback's real
  door, so no switch in the app exists for a test's sake. In a browser with no
  GPU the 2D canvas is rasterised in software as well, and the depth layer won
  outright on the strip-heavy scene (51 against 253 ms).
- *The oracle needed one more edge.* The picture tests cast each pixel's ray at
  the faces' planes and skip samples near an outline — and the first run failed
  along the line where one solid passes through another, which no outline
  draws but which is anti-aliased like any edge. The fix is in the test (skip a
  sample whose neighbours see a different face), not the renderer.
- *The fallback's sort.* The spec said to delete the nearest-point key with the
  cap-lowering rule, and the fallback still needs some key. Centroid is the
  plainest; it brings back the grazing-lid error the nearest-point key was
  added for, on the fallback only. Keeping the key for the fallback was the
  alternative — rejected because the spec asked for it gone and a fallback is
  for "still shows solids", not "shows them right"; the error is written down
  and a test holds the fallback to it, so it stays a decision. Measured, the
  centroid fallback is no worse than the old rules on the register's scenes
  (it even gets the 355° views right), only on the grazing lid.
- *Walls skip the stencil.* Every wall quad is convex, and a convex outline is
  its own triangle fan, so all the walls are one draw call; only caps pay the
  two stencil passes. The spec described one machinery for both; the picture
  is the same.

### Feature regeneration: diff, don't rebuild, and journal what was found

The spec (`docs/plans/feature-regeneration.md`) set the rule — an expansion
follows its profile, keeping identity — and the trigger, `fillet`, inside its
own call. The bug was measured first, on the code before the fix: a 40 × 30
extrude, a radius-8 fillet on a base corner, and the lid's edge over leg two
leaning 14.9° from over the tangent point to the far corner, SOLVED. (Not "a
rectangle", as the spec had it: the corner's twin follows the corner.) What was
decided in the code, and what was rejected:

- *Diff, not delete-and-redo.* Re-running the extrude from scratch was the
  cheap way, and it would have renamed every twin, wall and the depth —
  taking every relation a user had put on them, which is precisely what the
  spec's "keep identity" is for. So the old expansion is read back off the
  dimension's pairs (one twin per joined class), the record's twins
  (parallel to its loops) and its walls, and matched against the new walk.
  New things are made in exactly the order a fresh expansion makes them, so
  a replay makes the same names; the record's `owns` comes out in that order
  too, so a no-op `regen` rewrites an identical record.
- *Finding versus splicing.* The first design considered splicing the arc
  into the old profile between the two legs, by structure — position-free,
  so `fillet`'s entry would not have had to change at all. Rejected: it can
  only know what a fillet does, so it would miss a crossing the new arc makes
  or a hole drawn since, and `regen` needs the finder anyway; two ways to know
  a profile would one day disagree. So the profile is found as the call found
  it — which reads positions, which is exactly extrude's replay problem. The
  answer is extrude's: the call journals what it found, resolved, and a replay
  walks it by its joins. That is the spec's "journal-as-the-call" rule as this
  codebase already reads it (the user typed four arguments; the entry writes
  in what they meant), not a departure from it.
- *Where `fillet` cannot regenerate, it does not refuse.* `asOperation`'s
  contract is refuse-before-change, and by the time the new profile can be
  found the corner is already rounded. A rollback was considered and rejected
  (the model has no transactions; undo is the only one, and it lives above
  operations in main.ts). Leaving that one feature as it was is the old
  behaviour for it, and `regen` then refuses with the reason.
- *Version 9, and the translation.* A new op alone would not have bumped (the
  deletion ops' precedent), but `fillet` changed meaning: an old build would
  replay a new fillet without the lid and silently drop the names it made. Old
  files the other way round needed the translation, measured necessary rather
  than guessed: a version-8 file with a point drawn after its fillet, read
  without the translation, regenerates on replay, claims the next auto-names,
  and fails at that point's step — `"p14" already exists` (pinned in
  `test/regen.test.ts`). An explicit empty list says what the old build
  did, and is only written where a feature stood on a leg, so other old files
  re-save untouched.
- *Arcs are remade, lines re-pointed.* Adding `retargetArc` to the model was
  considered and left: no operation re-points an arc's end yet, and the first
  one that does should add it with its own reason.
- *The chain.* Not in the spec, found by asking what happens to a solid
  extruded on the lid: its profile's twin line gets re-pointed by the first
  regeneration, so without the chain it would be left with a profile that no
  longer closes. The hook queues every feature whose profile names a line it
  re-pointed — the same hook any later restructuring operation calls.

### Features over split regions (PR 2): the feature is what makes a crossing held

PR 1 found split regions and refused to build on them. PR 2 builds on them:
a stepped block from one sketch, a lens from two circles. The spec had the
shape (materialise, then expand; twin portions; journal v8). What was decided
in the code, and what was rejected:

- *Where materialising happens.* Inside the feature's own `asOperation`,
  as the spec said, and owned by it — not as separate journal entries before
  the extrude. Rejected: writing the point and its two `on`s to the journal as
  ordinary steps, then an extrude naming them. Simpler to replay, but undo
  would then take the extrude and leave three stray steps of the user's
  drawing nobody typed, and `del("e1")` would leave a point the user never
  made. A feature that made it owns it.
- *How a replay knows which points to make.* The journal must name real
  points, but at a replay those points do not exist yet — the extrude is what
  makes them. Three shapes were weighed: (1) a separate argument listing edge
  pairs to materialise, (2) a marker on the member saying "made here", (3) the
  rule loops.ts already reads vertices by: a vertex is a crossing exactly when
  the model has no point by that name. (3) won because it adds no vocabulary
  and cannot disagree with the finder; the entry stays the call with what it
  resolved written in. Its cost is that a hand-typed unknown name would be
  made rather than refused — so a name spelled like a key (`×`) is refused,
  and a made vertex must sit where two different edges of the profile meet.
- *Reading the entry after the body.* The names exist only once the body has
  claimed them. Predicting them (the next `p` numbers) was rejected: it would
  duplicate `autoName`'s rules in operations.ts and break the first time they
  changed. `asOperation` taking a function is a two-line change in the one
  place that records.
- *Own direction for `{from, to}`.* As walked, two points on a circle do not
  say which arc; PR 1 hit this with labels and chose the entity's own
  direction, and the journal follows the label so `ls()`, `loops()` and the
  file all spell a portion the same way.
- *Draw between points, never over spans.* PR 1 left the warning: a span is a
  snapshot. Caps and walls are drawn from the points' current positions
  (`portionAngles`), and a unit test drags the cutting line 10 units and checks
  the cap's corners follow — over the span they could not have, since the
  span is a fraction of the bottom edge and the bottom edge did not move.
- *The revolve's side check had to learn portions.* The obvious first revolve
  of a split region — a half about the line that cut it — was refused, because
  the check measured the whole bottom edge, which runs on across the line.
  PR 1's test had pinned that refusal as "split regions not built"; it now
  asserts the revolve.
- *Deletion was matched, not improved.* Deleting the first step of a stepped
  block takes the second's record and its two walls on the shared crossings —
  exactly what deleting a first extrude does to a second built on its lid. A
  gentler rule (hand the crossing to the surviving feature) was considered and
  left: it would be the first deletion that edits a record rather than
  removing one, and undo already makes the cascade harmless.

### Regions split at crossings and Ts (PR 1): a crossing is a vertex of the question, not of the drawing

The spec (`docs/plans/regions-split.md`) had settled the policy: a T is held,
so it splits; a crossing is geometry, so it splits for *finding* regions and
must be materialised before anything keeps it. PR 1 is the finding half. What
was decided in the code, and what was rejected:

- *Cut the drawing, then run the old face walk.* Every edge is cut at its
  held points and its crossings into parts, and parts are what the angular
  order, the bridge removal and the face walk see. The alternative — keep
  whole edges and teach the walk about crossings — was never attractive: a
  face walk is only correct on a planar graph, and cutting is what makes it
  one. It also retires the "a crossing component yields no loops" rule
  outright rather than leaving it as a special case.
- *A member is as long as the loop lets it be.* Found by thinking about the
  refusal, not by a test failing: a rectangle with a point held on one edge
  for a dimension, or a T whose stem dangles inside, would otherwise be a
  loop of *portions* — and PR 1 refuses portions, so a rectangle that
  extruded yesterday would not today. Coalescing consecutive parts of one
  entity walked one way restores whole members wherever the cut is no corner.
  Rejected: coalescing only at vertices of degree two in the pruned graph —
  that keeps a T from the other side as a "corner" of a loop it does not
  bend, which nobody drawing it would call one.
- *The key had to be guaranteed differently.* The spec said a crossing's key
  could never be an entity name because the model reserves the dot. Only the
  dot is reserved; `l1×l5` is a legal name. A spelling with a dot in it would
  have been guaranteed and illegible, and changing `claimName` was out of
  scope (no `model.ts` change in PR 1). So keys are primed past existing names
  at the time of the question — the invariant consumers need ("is this vertex a
  point?") holds, and `isVirtual` states it.
- *Labels in the entity's own direction.* `loops()` first printed a portion's
  vertices as walked. Running the lens case showed both crescents printing
  identically — two vertices on a circle bound two arcs, and the walk
  direction is what said which — and `regionKey` uses the same text, so the
  hover would not have redrawn between them. Own direction names one arc.
- *Tangency as a distance.* The old crossing test called two roots closer
  than the tolerance a tangency. A tangency solved to residual δ has roots
  √(2rδ) apart — 1.4e-4 for δ = 1e-9 at r = 10, past a tolerance of 5e-5 — so a
  circle the solver had made tangent to an edge would have cut it into slivers
  and made the rectangle "split". Measured from touching, it is a tangency.
  The same reasoning for lines: they cross only if each straddles the other by
  more than the tolerance, so near-collinear lines cannot cross somewhere
  arbitrary along their length.
- *Crossing lines are candidate planes.* Three lines that only cross bound a
  triangle with no joined corner, and the old candidates (joined corners, arc
  and circle frames) never offered its plane. The first version tested every
  pair of lines and built a plane per coplanar pair: measured at 81 ms a call
  on a hundred separate rectangles, against 2.8 ms before — and `findLoops`
  runs on every hover move. Swept along x, boxed, and building a plane only for
  a pair that actually crosses: 3.6 ms.
- *Refuse in `profileOf`, not in `extrude`.* It is the one door the typed
  calls and all three tools come through, and it holds the `Loop`s with their
  spans; `extrude` itself sees only names. A journal's handed-over profile is
  names and was never split, so a replay is never refused.

### A refused constructor leaves nothing behind: claim first, and hold the claim

The spec (`docs/plans/no-stranded-points.md`) asked which `claimName` is — a
check or a reservation — and to order accordingly. **It is both, in one call,
in the right order:** every way it refuses (a dot, a taken name) comes before
its one effect (moving the prefix's counter), so a refused claim consumes
nothing. No split was needed; it is placed last among each constructor's
refusals and first among its effects.

**Claiming first opened a hole the old order hid.** The entity is not in
`entities` until its points exist, so between claim and insert nothing marks
its name taken — and a line explicitly called `p2` would have its own first
endpoint auto-named `p2`, the later `entities.set` silently overwriting one
with the other. The old order never reached that: it made the point `p2` first
and then refused the line as "already exists". Two ways to keep a hole shut:

- *Predict and refuse.* Before making anything, simulate the auto-names the
  missing points would get and refuse the explicit name if it is among them.
  Rejected: it re-implements `autoName`'s walk to preserve a refusal that was
  only ever an accident of ordering, with a message ("already exists") that
  was false — the user had made no `p2`.
- *Hold the claim aside* (chosen). `claimFirst` sets a private `claimed` name
  that `autoName` steps around, exactly as it steps around every taken name,
  for the duration of the points' making. The call now succeeds. It cannot
  rename anything in a call that succeeded before: the hold only moves an
  auto-name that would have landed on the claimed name, which is precisely the
  case that used to be refused. And it replays identically, because replay
  goes through the same code with the same explicit name.

**The counters are private, so the tests read them the way a user does** — the
next auto-name of every prefix, against a twin model that was never refused
anything — rather than reaching into the map. The successful calls' journal
entries are written out by hand rather than captured, so a change to one is a
failure, not a regenerated expectation; that test passes on the old code too,
which is the point.

### Sketch on a face: a face is a loop, and three of its points are the plane

**The register's note — "faces will need to pick first" — was the wrong
framing, and the spec (`docs/plans/sketch-on-face.md`) said why before any code:**
a planar face of a solid is a loop of real entities, and the extrude tool had
already shown that a region is something a tool asks about rather than
something the canvas selects. So nothing about faces is stored, picked or
journalled; the journal carries `plane(a, b, c)` on three point names.

**Decisions made in the code, and what was rejected:**

- *The tool types its command.* The spec asked for "what `plane(a, b, c)`
  typed would do — frame, default, `lookAt`" and for the log to show the typed
  call. A tool reaches the model, not the camera, so it could not do the third
  part without either a camera handle on `ToolContext` or a second
  implementation of `plane()` in the engine. Rejected both: a camera handle
  breaks "screen-space questions are the engine's to answer", and a second
  `plane()` is the drift the menu's design exists to prevent. `ToolContext.run`
  is the menu's `run` handed to a tool; it executes synchronously inside the
  pointer event's undo bracket (the REPL runs an entry synchronously up to its
  first `await`), so the click is one step. Headless, with no `run`, the tool
  refuses rather than make a frame nobody looks at.
- *The line of sight travels with the region.* The helper needs which side of
  the face was seen. Rather than give tools a view, `regionAt` returns the
  `toward` it was asked along: a region is the answer to a question along a
  ray, and the ray's direction is part of the answer. So the helper takes
  `toward`, not `view` — a deviation from the spec's signature.
- *A corner and its neighbours, found by looking.* The first cut took the
  first three vertices in loop order and swapped the last two when the face
  faced away — the spec's reading. Every unit test passed. The e2e screenshot
  of the wall, after `lookAt`, showed it tipped: seen from its back the swap
  made the x-ref the *diagonal* corner, so +x ran across the wall. Taking a
  corner with its two neighbours keeps +x on an edge in both orientations; an
  e2e assertion now checks that the wall's edge from origin to x-ref is level
  on screen.
- *A circle off its frame is refused.* The spec's whole-circle rule uses the
  circle's frame's three points; a circle is held parallel to its frame and
  not on it (the free-entities rule), so for one lying off it those points are
  not on the face. Refused by name rather than given a plane beside its face.
- *The spec's outward-boss measure could not fail.* "Its origin farther from
  the first solid's centroid than the wall is": the boss's lid frame twins the
  face frame's origin, which is a plate corner — farther than the wall's middle
  whichever way the boss went. The tests measure that origin across the wall's
  plane, and the boss's lid centre straight-line, both of which a bore fails.
- *Left alone:* that same lid frame, twinned from the plate's corners, draws
  its marker out past the corner, in empty space. Correct, and visible in the
  poster; changing which frame an extrude's lid gets is an extrude decision.

### Clauses: one expression for "make a thing, defined by these"

**The owner's complaint was about the shape of the call, not the model.** The
model already treated `pt(10, 20)`'s numbers as a seed; the vocabulary for any
constraint set already existed. What it lacked was a way to say both in one
breath. The spec (`docs/plans/clauses.md`) answered with `_` and inert
clauses, and the rule that it be sugar only — and the decisive test is that a
clause expression saves to the same bytes as its expansion, so the claim is
checked rather than asserted.

**Decisions made in the code, and what was rejected:**

- *A frozen object for `_`, not a symbol.* A symbol prints as `Symbol(_)` and
  throws inside a template string, and a refusal message is exactly where a
  clause gets interpolated. An object with `toString` prints as `_` everywhere.
- *Where the slot check lives.* `rad("c1", _)` is refused when the clause is
  made, because that is the wrong expression; refusing at the constructor that
  receives it would point at the wrong thing. That needs each relation's slots,
  so the bindings in `replenv.ts` now carry a slot list, and the `relation()`
  helper there will not take a binding without one — the "register a relation
  in two places" problem stays two places, not three, because the second is
  the line that already existed.
- *How the evaluator shows a clause.* `repl.ts` must not import the command
  layer, so `fmt` honours `Symbol.for("nodejs.util.inspect.custom")` — the
  convention Node's own REPL reads — and a clause implements it. Rejected:
  `toJSON` (it would print quoted) and "any object with its own `toString`"
  (it would change how `Date` prints, for no reason of this package's).
- *Applying a clause by name, from the surface's own table.* A clause holds no
  function, only `op` and `args`, and is applied by looking `op` up in the
  relations of the surface applying it — never the live scope, so assigning
  `on = 5` changes what can be typed, not what an earlier clause means; and a
  clause made before an `open()` applies to the model that is open now.
- *Naming what was made when a relation refuses late.* The spec left the
  relation's refusal alone, and it is passed on unchanged — but prefixed with
  `ln made l2, but on("l2", "l1") refused:`. Without that, a headless caller
  learns that something failed and not that a line now exists.
- *Rejected: a kind check before anything is made.* The slot lists already
  say `point`/`line`/`circle`, so comparing the subject's kind would catch
  `oncircle(_, "p1")` — the very mistake the spec's own example makes —
  before the circle exists. Not done, because the spec says the relation's
  refusal is not second-guessed and the generic slots (`dist`'s `a`, `par`'s
  line-or-point-or-axis) would need a small kind language. Filed under
  Smaller things, as the owner's call.
- *The spec's level-line example collapses.* `ln(par(_, xaxis()), on("p1",
  _))` solves `SOLVED` with both ends on one spot — measured, and so does the
  expanded form. It is the degenerate-wedge family, not clauses; filed, and
  the tests pin a length with `eq` so they assert the geometry meant.

### The toolbar greys out a tool that cannot run

**The menu and the toolbar disagreed** about the curve tools in a 3D model with
no default frame: the menu greyed them with the model's reason, the toolbar
armed them for the first click to be refused. The panels worker filed it; the
spec (`docs/plans/toolbar-availability.md`) asked for one shared rule and the
menu's look, and this is that, with no deviation.

**Decisions made in the code, and what was rejected:**

- *Ask per tool, or once per sync.* `ToolbarHost.unavailable(tool)` is asked
  for every button on every render, so a 3D model with no frame throws and
  catches `resolveFrame`'s error five times a render. Caching the answer per
  render in the host would save that, at the price of a second place that
  knows which tools share an answer — the thing the shared rule exists to
  prevent. Five caught exceptions are microseconds; left uncached.
- *Key the rule by tool class, not name.* A tool redefined at the command line
  under `circle`'s name inherits the curve rule. Telling a built-in from its
  replacement would need `toolavail.ts` to import tool classes, or tools to
  declare `needsPlane` — a change to the tool contract for a case nobody has
  hit. Left keyed by name, written down in `TODO.md`'s Smaller things.
- *Grey the armed tool too.* When the frame goes away under an armed curve
  tool, `arm` is unchanged (the spec), so the tool stays armed — but the
  button greys rather than staying amber. The disabled style is placed after
  the pressed one, which it ties on specificity: amber means "this click will
  run this tool", and here it will not.

### Panels: a toolbar, movable chrome, and a canvas that explains itself

**The owner asked for buttons, then for everything to move.** The spec turned
that into one rule — every piece of chrome is a panel over a full-window
canvas — and two that it borrowed: a button is the context menu's kind of
thing (it types a command the log shows), and layout is per-viewer state.
Mid-package the owner opened the published build and saw "nothing": a fresh
model is a black rectangle since the grid went. The supervising session added
an empty-canvas hint to the scope, since the toolbar is what the hint points at.

**Decisions made in the code, and what was rejected:**

- *Store every panel, or only the touched ones.* Storing the whole layout on
  any change is simpler, and freezes every untouched panel at whatever the
  defaults were on that screen — so the bottom pair would stop following the
  bottom edge the first time the toolbar moved. Storing only touched panels
  means "untouched" keeps meaning "default", including the toolbar's height,
  which is sized to the tools there are and so grows when one is defined.
- *Clamp what is stored, or what is shown.* Clamping the stored rectangle to a
  small window would lose the viewer's arrangement the moment they shrank it.
  Stored is what was asked for; shown is `constrain(stored)`.
- *How much of a panel must stay on screen.* Wholly-inside is simplest and
  forbids parking a log mostly off an edge, which is a reasonable thing to do.
  The rule is the strip: wholly inside top to bottom, 40px of it sideways.
- *Where the toolbar learns of changes.* Neither the registry nor the engine
  announces anything, and both are out of this package's footprint. Rather than
  add notifications there, `syncToolbar` re-reads both from every place a
  change can have just happened — every render, canvas press and release,
  entry and Escape — and does DOM work only on a difference. A
  requestAnimationFrame poll was the other option; rejected as a loop that runs
  forever to save four call sites.
- *Clicking the armed button.* A toggle (typing `cancel()`) is natural, and
  the spec did not ask for it; it types `arm` again, which re-arms fresh.
- *Where the canvas capture goes.* The engine is where gestures live, but the
  reason for the capture is the page — panels over the canvas — and the engine
  is out of footprint. One listener in `main.ts`, after the engine's, which also
  means the toolbar sync on release runs after a finishing tool cleared itself.
  Checked by removing it: the cross-gesture test fails.
- *The keyboard rule.* The spec said to verify that typing with nothing
  focused reaches the command line. It did not: focus came back only on a pick,
  and a toolbar makes the focus-less state common. Added as a window keydown
  that focuses the input for a printable key with no modifier; buttons and
  strips also prevent `mousedown`, so they never take focus in the first place.
- *`layout` and replenv.* The footprint listed `main.ts` but not `replenv.ts`.
  A `repl.define` from the host would have kept out of it and left `layout`
  missing from `help()`; every other viewport command is a host handle there,
  so this one is too.
- *The hint.* Canvas text rather than a DOM overlay, so it is drawn from the
  model in the render pass with no state to keep in step — the coordinator's
  requirement, and the reason undo, open and delete all get it free. Two lines
  rather than one: a short statement ("Nothing drawn yet.") reads as the page
  working, where a single long instruction reads as an error message.

**Two existing tests leaned on the old layout.** Box-select's empty-canvas boxes
started where the toolbar now is — moved right. The free-line tangent test put
a circle's centre on the world origin, which is exactly where `line()` now
seeds; it had passed because the log grew and dragged the view's middle off
it. The circles moved below the seed and the seed-sensitivity went into the
TODO. The harness's `at()` now asks the browser what is on top at a pixel and
refuses one a panel covers, which is the honest successor to the old
"the canvas shrinks as the log fills" error.

**Looking at the screenshots** caught one thing the tests could not: panels at
95% opacity let the drawing ghost through the log, which read as a rendering
fault. They are opaque.

### Revolve: what can be real, and a sort no picture showed

**One PR, two commits.** Extrude split into two PRs so its semantic decisions
were not buried in fill colours. Revolve's semantics are just as separable, so the
model half and the display half are separate commits, each with the full gate
green — but one PR, because the halves are tightly coupled (whether there is an
end face decides whether there are caps), and stacked PRs against one branch
would show the first half's diff twice.

**What is real.** The spec settled the shape — profile live, surface drawn, axis a
datum, one angle dimension, end twins for a partial turn. Three things were left
to decide in the code:

- *How the relation knows its datum bases.* Extrusion reads "this base is one of
  the sketch frame's points" off a frame argument. A revolve has more of them —
  the axis's own points (a profile edge as its own axis is the cylinder case), and
  the points of every frame it twins. A second list in the arguments would be a
  list to keep in step. Letting a pair be *two frames* says it once: the frame
  pair holds the end frame's three points, and its base frame's points are datum.
  Both rules were checked by mutation — each pinning test fails with its rule
  removed — because "the axis is never pushed" passes vacuously if nothing ever
  tries.
- *A curve on a frame that is not the sketch's.* Extrude keeps such a curve's
  frame for its twin, since translation leaves an orientation alone. Turning does
  not, so the twin needs that frame turned too. Refusing the profile was
  considered; turning every frame a profile curve names costs four entities and is
  decided by name alone, which a replay reproduces.
- *A point on the axis.* Its twin sits on it. Sharing the point instead (no twin)
  would have needed "is this on the axis" — a position, which a replay on seeds
  cannot answer the same way.

**Full and partial.** The spec recommended that a full turn make no twins and
that `set` refuse to turn it partial; taken, and made symmetric — a partial one
`set` to a whole turn refuses too, since its end face would lie on its start face.
The refusals live in the relation, which is what `set` rebuilds through, so a
refused value leaves the old one standing for free. The consequence written down:
a full revolve's dimension holds no residual blocks. It is a label that `del`
can find — and, by the uniform record-only rule, it is left behind holding nothing
when a piece of the profile is deleted. Taking it with the record was considered
and rejected: one deletion rule for every feature is worth an inert label.

**The geometric refusals are not replayed.** Extrude learned that a replay runs
on seeds. A revolve's refusals — axis out of the plane, profile across the axis —
read positions, so a replay must not make them: given loops (the journal's form)
nothing is checked but joins. The test builds a profile seeded straddling its axis
and fixed clear of it; it reopens, and the test also shows the re-asked check
failing at the seeds. Detecting "this is a replay" from the model's recording flag
was considered and rejected as a hidden mode; "loops given" is the visible one.
The tool, which also hands loops over, goes through `revolveProfile`, which makes
the checks first — so the tool can refuse nothing the command line would accept.

**A sort no picture showed.** "Revolve shading at grazing angles is exactly where
sorting lies" — so besides looking, a script compared, at sampled pixels over 192
views per shape, the true depth of every pair of faces drawn there against the
order they were drawn in, and was itself checked by reversing the order (15,486
errors). The poster's 270° and every torus were clean. A holed profile at 321°
was not: 374 samples where the start cap was painted over walls nearer than it.
A sweep past ~300° wraps round in front of its own start cap's plane, which is the
one thing extrude's nearest-point key assumes never happens. The screenshot of
that view looked fine; the cap and the bottom face differ by five levels, and only
a canvas pixel read in the page settled it.

The fix is the exact rule for a planar face, applied only where it bites: a cap
goes after the faces of its own solid behind its plane and before those in front,
so a cap that an overlapping wall in front would sort before is lowered just under
that wall. Rejected: shifting those walls *later* instead (it reorders them
against other solids' faces, a new error where solids sit near each other), and a
full Newell sort (the right tool for arbitrary scenes, a much larger change than
this package). Two refinements were measured, not assumed: bounding boxes alone
over-reported overlap and left no key that fit, so an exact screen-overlap test
follows them (6 → 0 bad samples at 344°, 38 → 28 at 355°); and a cap seen all but edge-on (shade
4e-4 on a torus) was lowered under walls far behind it, so slivers keep their old
key. What is left — 28 samples at 355° seen nearly along the axis — has a wall in
front of the cap sorting below one behind it, both over the cap, and no single key
can sit between: a true painter's limit, documented. A unit test proves itself:
it passes, asserts the nearest-point order fails the same views, and fails with the
rule removed.

**Smaller things.** The swept surface draws no seam edges along it (the paths the
profile's corners trace); its silhouette comes from shading, which read clearly in
every screenshot, so they were left out rather than invented as display-only
lines. The e2e files each carry their own pointer helpers (seven already did), so
the revolve one follows that convention; the *unit* suites' profile helpers moved
to `test/profiles.ts`, which the spec asked for. And a reminder for whoever runs
the e2e next: editing a source file while the suite is running hot-reloads the
page under the tests — the first baseline here showed ten failures that were
nothing but that.

### Extrude, the faces: what a centroid sort gets wrong, and the click inside

**Two PRs, and why.** The package split where the spec said it might: the
expansion, the record, deletion and the file first, then the display and the
tool. The first half alone carried the package's semantic decisions — the
resolved profile, the record-only deletion, no version bump — and reviewing
those in a diff full of fill colours would have buried them.

**Culling was not in the spec, and it is what makes the sort tolerable.** The
spec asked for faces sorted by camera depth at their centroid. A closed prism
seen from outside shows only the faces turned toward the viewer, and for a
convex one those never overlap each other, so with back faces gone the sort
cannot be wrong at all. That needed each face's *outward* normal, and the
order findLoops lists members in was not trusted for it — a loop's winding is
measured (signed area about the sketch frame's +z) and its nesting counted
(how many of the profile's other loops contain a point of it), and the wall
faces away from the material on whichever side those say. A profile drawn
clockwise is a test.

**The centroid key failed, and a screenshot found it.** With holes the solid is
not convex, and the case that bit was the obvious one once seen: turned to a
grazing angle, the lid's centroid sorted *behind* the far wall of its own hole,
so the wall was painted after the lid, over it, wherever it projected past the
opening. Every number was right and the picture was wrong. The fix is a fact
about prisms rather than a tweak: every point of the solid is a point of the
visible cap moved back along the depth, so nothing of it is in front of that
cap's plane, and the cap's *nearest* point is at least as near as anything it
could overlap. A cap sorts by that; walls keep their centroids. The test that
pins it builds a long solid with a hole near one end, checks that the cap is
drawn last in four views, and also checks that at least one of those views is
one a centroid sort gets wrong — it was run against the centroid key to make
sure it fails there.

**Seams.** Neighbouring quads of a curved wall share an edge exactly, and each
anti-aliased against the background alone leaves a thin line of background
between them. Stroking each face 0.75px in its own colour covers it: measured
across a cylinder, the dips went from background-deep to 1–3 levels out of ~60.

**The tool asks, the engine answers.** The tool needs "which region is under
this pixel", which needs the camera; `ToolContext` gained `regionAt` beside
`pick` rather than a `view`, so tools stay camera-blind and the engine owns
every screen-space question. It hands `extrude` the loop it found, resolved,
not a member name: after any extrude every profile edge is in two loops, and
the click has already said which. And it opts out of snapping (`Tool.snaps`),
because a vertex marker under the cursor would promise a click that goes
somewhere else.

**The e2e reads pixels.** Looking straight down the lid, the canvas's own
pixels are asserted: the cap is exactly the square-on fill, the ring of the
hole is transparent right through both caps, and the island is filled. Each
probe is chosen from a few candidates by asking the app's `hover()` whether
anything is there, since sketch geometry seen through a solid crosses its faces
and a probe hardcoded onto a mark fails for the wrong reason (two did, the first
time).

### Extrude, the model half: what a replay can see, and what a record is

The spec's shape was clear — an operation, journalled as the call, expanding
into twins, walls, one depth dimension and a record — and most of the work was
in what "the same expansion on replay" turned out to require.

**The profile is journalled resolved, and that was measured before it was
decided.** The spec said journal-as-the-call, fillet's pattern. The worry was
that `findLoops` reads *positions* — coplanarity to a millionth, crossings,
the face walk's angles — while a replay runs on seeds: nothing is solved until
the saved values go back, after the last step. A scratch run settled it: four
`ln()`s (seeded on top of one another), coin'd at the corners and fixed into a
40 × 30 rectangle, have one loop solved and **none** at their seeds. Replaying
`extrude("l1", 20)` there would throw, failing the file — and every undo, since
undo is the save format replayed. Three ways out were considered. Journalling
the *expansion*, as `del` journals its cascade, has the precedent for exactly
this reason (a cascade recomputed later could differ), but the spec asked for
the call, and an expansion of thirty primitives is no longer a transcript of
what was typed. Restoring values mid-replay is not available — they exist only
for the model's final entities. What remained is the rule `fix`, `circ` and
`fillet` already follow for the default frame: journal what the call resolved.
So the entry is `extrude("l1", 20, "f1", [[…members…], …])`, and given loops a
replay only walks them by their joins — relations, never positions — and checks
each closes. The test that pins this builds that very rectangle.

**What "the same order" needs.** Names are handed out in creation order, so a
replay must create the twins in the order the call did. Everything that orders
them is read off names and relations: the loops' member order (journalled), the
walk's direction (forward along the first member unless its far end does not
meet the second — joins, not geometry), and the joined classes (`coin`
relations). One geometric question nearly crept in: a twin arc on the lid
frame must turn the same way as its base, which is a question about which way
its frame faces relative to the sketch frame — and a replay on seeds could
answer it differently if a frame had since been dragged over. It was designed
away instead of answered: a curve on the sketch frame twins onto the lid frame
(same orientation by construction), and a curve on any *other* frame keeps its
own (same orientation trivially). No side is ever decided.

**One twin per joined class, not per point.** The line tool joins corners with
a new point and a `coin`, so a drawn rectangle can have eight points at four
corners. A twin per point would give the lid eight unjoined ends — and the top
cap would not be a loop, so a second extrude on it would have nothing to find.
Classing by `loops.ts`'s own `joinClasses` (exported for this) gives the lid
one point per corner and one wall per corner, and the cap comes out a loop in
the lid frame with the profile's area — tested.

**The depth holds radii.** A twin circle has no ends for a point pair to hold;
its radius would float. Two ways: an `eqrad` per curve (more names, `r`-named,
deletable on their own, and a lid partly held by relations `set` does not
touch), or a radius residual inside the `extrusion`. The second keeps "one
relation holds the lid" literally true.

**The sketch frame is a datum to the depth; the profile is not.** The lid
frame's points are held at the sketch frame's points plus the depth, the sketch
frame read as numbers, so the lid can never turn the sketch plane — the rule
every relation against a frame keeps. The profile's own points are variables
in their pairs, deliberately: that is what lets a constraint on the lid push
the base, which is the demonstration the spec asked for (a diagonal held to 50,
the depth set, the free width settling at √(50² − h² − d²) — a unit test).

**Deleting a piece takes the record, not the solid.** The spec says deleting
"any member entity of the feature takes the feature record with it". Read
strictly, as a relation is read, the record needs its pieces and the pieces do
not need the record — so the record goes and the rest stays, ordinary geometry
without faces. Taking the whole solid was weighed: it is what a user deleting a
profile edge might expect, but it would also mean deleting one wall line takes
every other wall, which nothing else in the cascade does to its neighbours. It
also settled the depth: `del("d9")` takes the record (it names the depth) and
leaves the lid free, rather than being refused. `del("e1")` is the way a solid
goes, and it takes only what it made — the primitives refuse to delete
anything a record still names, which is what keeps the cascade honest.

**The drift that was not the extrude's.** The first "`set` moves the lid and
nothing else" test failed at 2e-5 — a corner of the *base* had moved. Traced:
`fillet` holds its new tangent point and centre on the rim's plane, not the
sketch's, so a rounded corner can slide along +z as a whole, and the damped
step for the depth (which shares its first correction between twin and base)
nudged it. With those two points held on the sketch the drift fell to 7e-7 —
the rest an undimensioned sketch wandering in its in-plane freedom, and the
tangency, which pins a tangent point only to second order. On a fully defined
sketch it is 1.6e-11, and that is what the test now claims. The fillet seam is
written up in the register rather than fixed here; it is older than extrude.

**No version bump**, for the deletion ops' reason: new ops, no changed meaning,
and an older build refuses a newer file at the step by name rather than
misreading it.

### Closed loops: faces, not cycles, and what "joined" is allowed to mean

The spec fixed the honesty line before any code: joined means one point or a
`coin`, never proximity. Most of what follows is what that line implies once
it meets real geometry.

**Why faces rather than a cycle basis.** "Minimal cycles" has two readings. The
graph-theory one is a minimum-weight cycle basis — the shortest set of cycles
from which every other is a sum — and it is tempting because it needs no
geometry. It was rejected on paper: a basis is free to trade a face for the
outline round two faces whenever that is shorter, and nothing about lengths
promises the faces win. The spec's own examples — a figure-eight is two, two
rectangles sharing an edge are two with the edge in both — are statements about
*faces*, so the module walks faces: order each vertex's edges by angle, walk
with the interior on the left, keep the counter-clockwise walks. That needs the
drawing to be planar in the strict sense — no two edges crossing — which is
where the next decision came from.

**A component whose joined edges cross has no faces worth reporting.** The
rule was written in from the start, but the mutation pass — delete each rule,
see which test notices — showed what it is for: without it a lopsided bow-tie
comes back as a loop of its *net* area, 400, a number that describes no region
anyone drew. Onshape would split it at the crossing;
doing so here would mean inventing a join where the drawing has none, which is
the one thing the honesty line forbids. So such a component reports nothing,
and the register says so. The symmetric bow-tie the first test used had been
passing for the wrong reason — its lobes cancel to zero area and it vanished
regardless — which is why the test is lopsided now.

**Ties at a vertex.** Angle alone orders a vertex's edges until two leave in
the same direction: an arc leaving tangent to another, or the same line drawn
twice. Curvature settles the first (the edge bending left sits just
counter-clockwise), and the second needed a small trick: an imagined offset by
edge index, to the left of each edge's direction from its lower-numbered end —
which orders a pair one way at one end and the other way at the other, as two
parallel edges a hair apart really are. Ordering both ends the same way leaves
the sliver between the two copies unclosed; the duplicate-line test fails
without the mirror, and the tangent-arcs test fails with the curvature order
flipped.

**Exact arcs in the inside test, a deviation from the spec's letter.** The spec
suggested point-in-polygon with arcs sampled. But an arc's winding about a point
has a closed form — the plain angle between its ends from outside its circle,
that angle the long way round from inside — so there is no resolution to pick
and `loopAt` and containment use one test. The sampling survives where it
belongs: the edge-on measure samples arcs as they are drawn, because "how thick
does this look" is a question about the drawing on screen.

**The innermost rule turned out to coincide with a tie-break**, and was kept
anyway. Coplanar loops share one plane object, so a click meets them at the
same depth exactly, and "smaller area wins a depth tie" already picks the island
over its outline. But the spec asked for the rule to be stated, and it is the
one that survives a future where two coplanar loops' planes are computed apart
and differ by noise — so the test nudges an outline's plane a ten-thousandth
nearer and checks the island still wins, which is the only way to tell the two
rules apart.

**Found in the e2e, not fixed:** the island circle's radius was dragged to the
right, released near the fillet arc's *unseen* continuation, and snapped to it —
8.86 instead of 9, with nothing visible at the cursor. Face-on snapping offers an
arc's whole circle, deliberately (`snapping.ts` says so); obliquely it offers
only the drawn arc. The test drags left now, and the disagreement is in the
register for someone to decide.

### Planar discipline: a plane is an orientation, and what the old files needed

The spec settled the big fork itself — a circle's plane is a frame reference
that orients the rim around wherever the centre is, and the circle op does
*not* add an `onPlane(center)` — and building it confirmed the reading rather
than overturning it. An auto-constraint would have made `addCircle` the one
constructor that constrains, and a circle dragged off its sketch would have
snapped back to a plane nobody asked for; the tools already hold what they
place with an `onPlane` the user can see and delete, which is where that claim
belongs. What the reading costs is honesty about the rim: it is the circle
through the *centre*, parallel to the frame, and the doc comment and a test say
exactly that (drag the centre nine units off the frame, the whole rim goes nine
units with it).

**Which relations read the plane.** `onCircle` and `tangent` — the two that are
claims about the rim. `rad`, `conc` and `eqrad` read centre and radius only and
were left alone; `concentric` across two different frames is still just "same
centre", which is what it says. The second residual of each went in its own
block rather than as a second row of the first, so an offender report can say
`oncircle(p,c)|plane`, and in 2D the block is simply not added — which keeps
the 2D relations block-for-block and value-for-value what they were (the spec's
net, and a mutation run confirmed the new 3D tests fail without the blocks).
`tangent` holds *both* line ends on the rim's plane, not only the touching
point: a tangent line lies in the circle's plane, and one end alone would
leave it free to tip out of it about the contact.

**Arcs: the c/s/e plane, oriented by the frame.** Two readings were on the
table: draw an arc in the plane through its centre and ends (the spec's
wording — the geometry already says that much) with the frame deciding only the
sweep's sense; or draw it in the frame-parallel plane through the centre, like
a circle, with the ends projected. They agree whenever `arcends` holds, which
in 3D now includes the plane block. The first was kept because it draws what
the model actually has while a solve is still pulling, the way the existing
code draws the arc's own radius rather than the distance to its start.

**The fillet had to get a plane, and a refusal.** A fillet makes an arc, so in
3D it resolves a frame like everything else and journals it. Choosing the frame
by nearest normal instead was considered and rejected for new calls — the
resolution rule is the same everywhere, and a magic choice would make the same
typed `fillet` mean different frames in different drawings. A corner that is
not in the resolved frame's orientation is refused by name: rounding it would
put `arcends`/`tan` plane blocks in a fight with the legs. That refusal found an
old bug: `asOperation` journalled before running its body, so *any* refused
fillet (a radius too big for its corner, since the beginning) stayed in the
journal and the next save produced a file that failed to reopen at that step.
It journals after success now; every operation already refused before
mutating, so nothing else changed.

**The version-6 files were the hard part, and the spec's rule was not enough
on its own.** "Nearest-normal match against the file's frames" assumes there
*are* frames. A 2D drawing need never have had one (the no-world-frame package
made frames optional), so every frameless 2D file with a circle would have been
unopenable in the 3D app. Three options: refuse such files (losing them);
keep a planeless "legacy" circle in 3D (keeping the very seam this package
closes); or let the translation *make* a frame for them. The third was taken,
with the same discipline as the lift's y-refs: named after nothing the file
uses (`plane`, `plane2`…), placed just before the curve that needs it in the
translated journal, lying in the curve's plane on its centre, an ordinary frame
afterwards. It is visible — a triad appears on an old drawing — which is the
honest price; a frame nobody can see would be a world frame by stealth.

Two more things the rule needed. **Saved geometry, not replay seeds:** a
three-point arc's centre is auto-created at the origin and only moved by a
later `setCoords`, so the plane through the replay's points at the `addArc`
step is nonsense; the arc is given a provisional frame at its step and chosen
for real once the saved coordinates are restored. (The residuals read the
plane lazily, so re-pointing it afterwards is safe.) **Deleted frames are no
candidates:** a v6 journal can delete a frame a circle never knew about, and
v7 would refuse that deletion while the circle stands on it. And the old side
rule is kept in exactly one place, so an arc v6 drew counter-clockwise about
the kernel's +z opens as that arc on a frame whose +z faces the other way —
its ends are swapped. A circle has no normal to match, so it takes the default
at its step; that is a guess and is documented as one.

**The off-plane snap's tier.** Below every on-sketch point, crossing and
midpoint, above a bare curve. A projected vertex is an exact position but a
ghost: at the same pixel a real place that infers something true should win,
while a vertex aimed at is a more particular intent than an edge passed over.
Projected along the plane's normal, not the line of sight — the same thing
square-on, and obliquely the nearest point of the sketch to the vertex, which
is what "project into the sketch" means. It infers nothing; the point it makes
gets only the sketch's own `onPlane`, as a click in empty space does. The
existing point marker was already a hollow square, so "hollow" alone would not
have been distinct: the projected one is dashed, ringed, and leads back to its
source.

**Smaller calls.** The curve tools refuse on the first click (logged, nothing
placed) rather than at arm time — refusing in the constructor would have needed
the engine's `arm` to change for one family of tools — and the empty-canvas menu
shows them disabled with the model's own message, Fix's precedent. `plane()`
seeds facing the viewer in a turned view, and so does a bare `frame()` (a
phase-1 seam): "here" is the plane you are looking at; an unturned view
journals exactly what it always did. The hover tag and `ls()` name a circle's
plane, because nothing on screen says which frame a square-on circle is
parallel to.

### The camera half of 3D, and where the spec's hopes did not hold

The spec for half 2 hoped for a small footprint — "keep the exported names as
close as honesty allows", "tools themselves should not need edits" — and the
first decision was how to make the switch to `Model(3)` without weakening a
single 2D behaviour the suite pins, since the reviewer would push hardest
there. The answer was to build in three layers and prove each on its own: a
camera and projection that are *bit-identical* to the 2D transform until
turned (the whole 2D suite passed unmodified on that commit alone), then tools
and an engine that only do anything different in a 3D model, then the switch.
Each of the three was committed only after `test:all` ran green on exactly
that tree.

**Azimuth and elevation, rejected.** The spec named the camera's state as
target, azimuth, elevation, scale. Two angles were the first thing written down
and the first thing dropped: `lookAt(frame)` has to put a frame square-on *with
its +x to the right*, and a frame tilted about its own normal needs a third
angle (a roll) to say that. Adding a roll gives three Euler angles and their
gimbal lock in exactly the top view the app starts in. And a turntable orbit —
dragging changes azimuth about a fixed "up" — needs a world up to turn about,
which can only be the kernel's z: the gauge becoming the drawing's "up", which
the no-world-frame decision exists to prevent. So the camera stores its own
screen axes, the orbit is a trackball about them (which is also how Onshape
feels), and `orbit(yaw, pitch)` became *relative*, like `pan`, `zoom` and the
mouse: an absolute azimuth would be measured from axes nobody chose. The
orbit target is screen-anchored — pan and zoom carry it on its pixel — after
weighing a world-anchored one, which leaves the pivot off-screen after any pan
and swings the visible drawing about a point the user cannot see.

**"Tools should not need edits" — five did.** Every drawing tool but point and
line refused a 3D model outright, so the app would have lost its rectangle,
circle and arc tools on the day it became 3D. The smallest honest change was
to tell a tool which plane its cursor was read on (`PointerInfo.plane`) and let
each lay its shape out there; the alternative, the engine handing tools 2D
plane coordinates and mapping back, would have needed a second channel back
for every point a tool creates and made tools written at the command line see
a different world from the model. A rectangle on a default frame now follows
the frame's axes where the 2D app followed the screen's — identical until a
frame is turned in its own plane, flagged in the register. `fillet` became
dimension-generic for a reason the spec could not see: it refused 3D, so every
2D file with a fillet would have failed to open lifted.

**The arc orientation rule nobody specified.** "An arc samples as a polyline
in its own plane" leaves open which of the two arcs between two endpoints that
is — an arc entity names three points and no normal. Considered: always the
minor arc (breaks every reflex arc in every existing file); the default
frame's +z (an arc would flip when the default changed — a drawing redrawn by a
pointer nobody connected to it); the camera's side (an arc would flip as you
orbit past its plane). The kernel's +z side of the arc's own plane is the only
rule that keeps every 2D and lifted arc exactly what it was, at the price of
the gauge showing through in rendering and picking — never in a residual — and
an arc turned through the vertical flipping. It is written down as a seam
rather than hidden, and the tools and `fillet` store endpoints so the drawn arc
is the one meant. Phase 2 retires it.

**What only the screenshot showed.** Every test was green when the poster was
first taken, and the picture was wrong: a wall sketch's last corner had gone to
the floor's *front* corner, seventy units behind the pixel aimed at, because
square-on the two share a pixel and the point tier took the first. Every
relation was satisfied. The fix is the rule that while sketching on a plane a
snap is offered only where it lands on that plane; the alternative Onshape
uses — snap to the off-plane vertex and constrain the *projection* — needs a
relation this model does not have, and is phase 2's call. The same picture
also first showed a hand-written legacy file solving into a near-degenerate
shape; that turned out to be the file (under-constrained, and identical in the
2D library), not the lift — checked before it was believed.

**The lift's one trap.** A 2D frame opened into 3D needs a y-ref, and
`addFrame` creates a missing one auto-named — mid-replay, where the next free
`p`-name is very often a name some later entry of the file already holds, so
the very next step fails with "already exists". The lift names it after its
frame instead, from names the file never uses, and seeds it where the frame's
own auto-created pieces keep their 2D names and positions. It is placed
exactly only after the saved coordinates are restored, because a frame the
drawing had turned before saving has its real +y only there — a replay seed
would put it on the wrong side, and a pinned test shows the difference.

**Version 6, argued against itself.** `persist.ts`'s own rule is that a bump
is for a break in the old-reader direction, and nothing in a v6 journal would
be misparsed by v5. It was bumped anyway, on the ground that a v5 build would
open a 3D drawing as its flattened x–y shadow with every tool refusing it —
misread rather than misparsed, which is the silent-meaning-change the rule is
really about. Flagged.

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
