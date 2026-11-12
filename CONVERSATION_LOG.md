# Conversation log

A narrative record of the session that produced this repo, written so
that context isn't lost when picking this up from a different machine or
a fresh Claude context. This is a summary in my own words, not a literal
transcript. Entries below are newest first.

For the itemized technical state see `STATUS.md`, for what's next see
`TODO.md`, for a shorter screenshot-carrying version of this story see
`CHANGELOG.md`, and for the project pitch see `README.md`.


## 2026-11-12 — a direction relation turns a line and never scales it; a conflict names what made it

Review items 1 and 3 of the register, built on `claude/review-solver` from
docs/plans/review-solver.md. The register has every choice as one line; this
is why each was made, and what was tried first.

**The bug, as a test, before anything changed.** `par` between two free
lines 60.1 and 60.8 long: 8.763 and 1.183 long after, SOLVED, in 2D and 3D
alike. The row was |u||v|·sin θ and the solve paid for the parallel mostly
in length. The same script then measured every row of that shape — `perp`
left the pair 56 and 87 long, `col` 17 and 3, `on` shortened the line the
point was put on from 60 to 21, `sym` its mirror line to 37 — so the fix was
never going to be three relations.

**The spec's design did not survive measuring, in four places.** It said:
divide by the lengths, multiply by the model's length scale, fall back to
the un-normalised row below the collapse threshold. Each of those was built
first and each was wrong for a reason only the numbers showed.

1. *The model's length scale.* On the forty chained rectangles of the cost
   test the drawing is two thousand across and a side is forty, so a
   direction row scaled by the drawing was fifty times a `dist` row beside
   it. The normal equations were that much worse conditioned and the solve
   took 23 iterations where it had taken 8. The multiplier is the longer of
   the row's own lines **as it was when the solve began** — a plain number
   read from a snapshot `Model.solve` already takes, so still no variable of
   the row, and the row is exactly as large as the one it replaces was at
   that moment. **Rejected**: the line's live length read as a number each
   evaluation, which is the same magnitude and simpler; its Jacobian is then
   wrong by the residual times the length's gradient, and a finite-difference
   check of the row fails, which the spec asks for.
2. *A sine and a cosine.* L·sin θ has no gradient at 90°: `par` typed on two
   lines exactly square — a rectangle's adjacent sides, the commonest pair
   there is — did not move and read CONFLICT. The raw row never showed this
   because at 90° its whole gradient is along the lines: the only way down
   was shorter, **which is the owner's first bug seen from the other side**.
   Normalising closed that way out and left nothing. So the rows are the
   angle itself: the turn that would make the two parallel (`turnToParallel`,
   the wedge scaled so its length is the angle, folded to ±90° because a
   line has no front), the same less a right angle (`turnToSquare`), the
   angle less the one asked for (`ang`). The slope is the same everywhere,
   and a Gauss–Newton step is the turn needed rather than its sine's guess
   (a cosine linearised at 13° asks for a turn of 4.3 radians where 1.3 are
   needed, which is part of how `perp` got to 169). Exactly along
   one line the wedge's length is a cone's tip with no derivative; a way to
   turn is chosen there from the values (`angleBetween`), which also retires
   the reason `ang` on a profile needed its seed. **Rejected**: a nudge in
   `Model.solve` when a direction row is unmet and flat — `leanOffNormal`'s
   move, generalised. It is a second mechanism to remember and the row would
   still be wrong.
3. *The collapse threshold as the floor.* A unit direction's gradient is one
   over the line's length. A triangle given two right angles has only one
   answer, a side of no length, and under the normalised rows it crept toward
   it: sixty iterations to 2e-6 of the drawing, the rows a million times
   stiffer than their neighbours, the kernel's per-coordinate damping letting
   nothing near them move, and the push that is meant to tell a collapse from
   a small size moving it another 15% in thirty iterations. It was called
   solved. The floor is a thousandth of the drawing's size instead
   (`DIRECTIONLESS`); under it a row runs down to nothing with the line, as
   the raw one did, and the collapse is found as before.
4. *Zero gradient is enough.* It is not, and this is the one that matters.
   With every row's gradient along its lines exactly zero, `par` between the
   two free lines left them 61.0 and 62.4 long and `perp` left them **169**.
   The kernel's step moves each end along a straight line, and a straight
   move that turns a line stretches it — at first order, not second, because
   the damping is weighted per coordinate (λ·(1 + diag JᵀJ)) and so is not a
   rotation's. No row can fix what the step does. So `Model.solve` asks, of
   every line a direction block says it turns, whether its length changed,
   and if so solves on with those lengths pulled back and then released
   (`keptSizes`): 1e-10 of their length on all six relations.

**What "a line it turns" had to mean.** The first gate was *only when a
direction block was unmet as the solve began*, so that a `coin` on a free
line's end still stretched the line. That left a level line whose one end
was pinned thirty higher with its far end slid 5e-4 sideways — a length no
relation asked to change, in a solve a `fix` began — and
`test/line.test.ts`, which is older than all of this, said so. The gate
went: every solve keeps the length of every line some relation reads for its
direction, unless a relation changes it. A line no relation reads so still
stretches to a `coin`, which is what it did before and what a draughtsman
expects of a bare line. A rectangle pinned by one corner now moves whole
rather than stretching toward the pin; I think that is right, and it is in
the register to veto.

**Why a drag is not steered.** A pull on a size in a frame would be
satisfied exactly by moving a free rectangle whole under a dragged corner,
and the corner drag is how a rectangle is resized. So a frame is the rows
alone: a drag of one end of a par pair costs the other line 3.1% where it
cost 47%. The remainder is the kernel's step, written down in TODO.md with
the measurement; changing the kernel's damping to a rotation-friendly one
would touch every solve in the app and is not this package's to do.

**A failed solve is put back.** This followed from the rows and was not in
the spec. Once a direction row cannot be met by shortening, a `par` and a
`perp` on one pair have no answer at all — which is the honest state — and
least squares ends at the compromise between them: the owner's rectangle
sheared 45°. Left there, the user has a conflict to read *and* a drawing to
undo, and every later solve starts from a state no relation described. So
the part a row stayed large in goes back as a collapsed part does, after one
more solve from where it stopped (sixty iterations is a bound, not a
verdict). Two things fell out of it: a drag on a drawing holding a conflict
has to leave that part out of the frame explicitly (it used to stop because
the frame folded a side, and no longer folds), and a relation that does not
hold must not be called redundant — a `par` and a `perp` on one pair are the
same row to first order now, and the rank analysis called the conflict an
agreement.

**The culprit is known, not found.** I had first thought of finding it: the
relation in every irreducible conflict, the one whose removal clears the
part. That is n trials and it is wrong on a drawing with two conflicts. The
drawing solved before the edit that broke it, so the model only has to
remember which relations have held in a solve (`settled`); the one in the
failed part that has not is the edit. That needs no trial, survives the
search's bound, and is right when the corner's perp is then deleted and the
par is found against two others instead. **Rejected**: the journal's last
entry — it is the culprit only until the next thing is drawn, and the status
would flip from `r7 — against r1` to `r1 · r7 cannot all hold` under the
user's hand.

**One relation before any larger set.** With the culprit fixed, QuickXplain
over the rest returned whichever irreducible set its order met first, and on
a four-perp rectangle a `par` disagrees with its own corner's perp alone and
with the two far ones together. Each of the nearest dozen is tried alone
first. This replaces #87's "two where two will do" for a conflict with a
culprit; that patch stays for the sets with none.

**The spec's e2e says "the two perps".** On a rectangle of four perps the
least set a corner's `par` cannot hold with is that corner's one perp, and
that is what is named; delete it and the two far perps are named next. The
spec's line reads like the three-perp rectangle of the original bug, where
the set was also one. Said in the register.

**The inks.** The first idea was a second hue. There is none free: amber is
the hover and what just happened, violet the selection, blue what is free,
green the tools. So the quieter ink is the conflict's red let down toward
grey (#b98a86), and because two reds on a dozen pixels are one red, the
difference is carried by shape as well: the culprit's box is filled and its
mark cut out dark, what it is against is an outline. Looked at on the canvas
and over a solid's lit face, by mouse and at an iPhone's size; the filled
block is the one thing on the drawing that is solid red.

**Bug 74.** Reading the inks over a solid's lit face, every glyph read plain
under a CONFLICT verdict: a glyph follows its anchor, a solid's edges are
quiet until hovered, and so a conflict on a solid drew nothing red at all.
A relation in a conflict is always drawn now.

**Measured under load, and said so.** Three other packages were building on
the same four cores; the load average was thirty. Every time in the spec's
table is the best of three, and the e2e lifts the search's clock from the
page's model, because at that load the 500 ms bound ran out on a rectangle's
extrude and the status read "against a set not found in time" — the bound
doing its job, which has its own unit test.

**review-relations went in first, and this was measured again on the two
together.** Its author had said a relation among many would need no second
edit, the rows being the pair's own inside one relation, and that held:
`par` among four free lines left them 41, 31, 89 and 123 long on that branch
and leaves each as it was on this one. What did need an edit was the row
that branch added, `corner` — the angle between the lines two walls are
swept from, u·w − |u||w| cos θ, written while this package was still
removing every row of that shape. It is in `src/relations/`, so it was
changed here rather than handed back: `ang`'s row on the two rays out of the
corner.

The culprit needed no change for a relation among many, because it is found
by relation and never by block; and a `join` rewrites a relation's members,
so "has not held as it stands" already says the joined relation made the
conflict. Writing that test in 3D found something that was this package's
own. The failing solve folded the rectangle's far side instead of stopping,
the first ring the search tries is then the relations that name what folded,
and the rule "one relation before any larger set" had been written against
that ring. The answer — the two far corners' perps — is a true irreducible
set and the wrong thing to read: the corner's own perp, alone, is outside
the ring. The singles are asked of the nearest dozen of everything now.

Not built: saying which member of a relation among many is the one that
cannot hold. `r5 par l1 l2 m1 — against r1` fills three glyphs where one
line is at fault. Filed.

## 2026-11-12 — one relation among equals, and a wall named by its line

Review items 5 and 6, built on `claude/review-relations` from
docs/plans/review-relations.md. The register has the choices, one line each;
this is why, and what was turned down.

**What `e1.m3` meant was measured before anything was changed.** A block of
four lines, a point held on the fourth wall by `onplane(p, "e1.m3")`, a
fillet of the first corner: the profile became `l1, a1, l2, l3, l4`, place 3
was `l3`, and the point went from x = 0 to y = 40. The name was read again
at every evaluation — "lazily", which had been written up as a virtue — so
the relation followed the *place*. A chamfer and a trim that re-finds the
region did the same. That file is a fixture now. Part of item 6 was already
true: two parallel walls of one extrude were `dist` of their lines, a round
wall its circle. What held a place was everything built since on a face's
*name*: click-on-face's `onplane` and `par`, `fdist` between two features, a
driven `fangle`.

**Why a colon.** `e1.l2` was the obvious form and it does not work: a name
after a dot is a word the model owns — `lid`, `base`, `x`, `value` — and
`parseAxisRef` throws on any other, by design, so that `f1.w` is a typo and
not an entity. An entity can be called `lid` or `m3`. With a colon the two
namespaces cannot meet, the name is still one string a relation can journal,
and `claimName` refuses a colon as it refuses a dot. **Rejected**: the entity
alone (`"l2"` where a face is wanted) — a line can be a wall of two features,
and `onplane(p, "l2")` already has a meaning it refuses; an object
`{feature, entity}` — every journal argument is a string or a number, and
the palette, `rels()` and the hover tag print them.

**Why the kernel keeps its places.** The solid kernel tags a face by feature
and member index for one build, and the drawn faces carry that tag. Renaming
there would have meant the worker, the naming table, the blends and the
surfaces — and another package (linked-profiles.md) is rewriting the extrude's records.
So the written name is the model's, the tag is the build's, and exactly two
functions cross: `faceRef` (tag to name, where a relation is made, a face is
picked or an old file replayed) and `faceKernelNames` (name to tags, to
light a face or ask the kernel about it). **Rejected**: resolving the old
form lazily forever — that is the bug; migrating old files in one pass
before the replay — the profile a relation was made against exists only at
its own step, which is where it is resolved now. That makes an old file
whose walls had drifted reopen on the walls its relations were made on. I
think that is what its author meant; it is a change of meaning all the same,
and it is in the register to be vetoed.

**`corner`, not `ang`.** The spec said the angle between two meeting walls
should be `ang(l1, l2, θ)` of their lines "or the existing `ang` where that
is what it already is". It is not: `ang` is the angle between the lines' own
directions, and two sides of a profile drawn head to tail read the
supplement — 150° on the wedge whose sharp edge is 30°, the reading #84
chose `ang3` to avoid, and which of the two a user got would depend on which
way round they had drawn each line. Typing `ang(…, deg(150))` would have
kept the letter of the spec and shown the owner a wrong number on his phone.
So a small dimension that names the two lines and reads each out of their
corner. It also fixes what item 6 was really about: `ang3` held the corner
*point*, and a fillet of that corner re-points the lines off it. **Rejected**:
a flag on `ang` (geometry.ts is being rewritten by the solver package, and a
relation whose reading depends on a fourth argument is two relations);
`ang` of the face normals (`fangle`'s reading, the acute angle, wrong past
90°).

**How a relation among many is one relation.** The repo already had the
mechanism: a relation function called inside another's body is absorbed into
it (`concentric` is a `coincident`). So `par` among four is one
`model.relation` whose body calls `parallel` three times — no row of its
own, which is also what lets the solver package change `par`'s rows under
it. **The spanning set was a chain first** (each with the next: the
symmetric-looking choice) and the 3D test of three collinear lines came back
"solved" with the first line folded to a point; as three separate relations
the same chain is a CONFLICT. `col(a, b)` puts `b`'s ends on `a`'s line, a
line of no length has every point on it, and in a chain only one row knows
the first line — and one relation that alone folds a line is read as the
user's own zero. Each member with the one listed first is the star's
equations exactly, and solves as the star did, which is what the spec asked.
It makes the member listed first special *to the solver*; nothing above it
can tell, and the rows are re-formed when that member goes.

**Joining, and why a replay must not.** "Adding the relation to a member of
an existing group joins the group." I read a pair as a group of two: if only
relations of three or more attracted joins, a relation that had shrunk to
two would behave differently from one typed as two, and relating pair by
pair would still build stars — the first-typed line a hub, by history. So a
typed relation joins whatever it finds. That cannot be what a *file* does:
an old star replayed with joining would merge on open, and — worse — a file
saved today and holding deliberate separate pairs (a tool's, an
operation's) would merge on its second open. So the function a module's
entry replays is literal, the one it types is `relate`, and a joining is in
the journal as `join`, an edit like `set`. **Rejected**: joining only into
relations of three or more (above); a new relation name on every join
(`deleteRelation` + a fresh `par`: the name is what a glyph, a selection and
a later journal entry hold); migrating old stars into sets on open (the spec
forbids it, and the names after them would all shift).

**Deletion.** "Deleting cascades inward" stays true with one refinement: a
set that still holds among two after losing a member did not need that
member. The cascade asks (`shrinkFor`), writes a `leave` ahead of the
deletions, and the relation keeps its name. The first design had the
primitive `deleteEntity` do it silently; it is in the cascade and the
journal instead, because a replay must leave the relation the same way and
the log should say what happened to a relation that is not in the list of
what went.

**What the pictures showed.** Nothing new to count as a browser-only bug.
The first palette picture did show three of five free lines shrunk to stubs
by `par` — review item 1's shrink, as loud with one relation as with a
star, because the rows are the same. The e2e holds its lines' lengths and
says why; the solver package's fix lands under these rows.

## 2026-11-12 — the owner's answers: pull on anything, twins edit together, a fillet is one thing

The owner answered the standing questions. The register has each; what is
not obvious from them:

**"Hierarchies do exist, but they are not timeline based."** Until now the
repo's line was "no hierarchy". The owner's refinement: a body does depend
on its profiles, and a change to a profile must propagate through
everything built on it — but the dependence is carried by relations that
read both ways, not by an order of creation that can only be replayed
forward. So "a 2D fillet on the originating loop" and "a 3D fillet on that
edge" must be the same edit with the same result, and neither may delete
what something else names: the old corner stays, as construction, on both
linked profiles. That is `fillets-one-thing.md`, queued behind
`linked-profiles.md` because it needs twins to exist first.

**Deleting a line of one profile.** I had proposed that the extrude goes
and the other profile stays whole. The owner: it *"would break it
obviously"*, and the two profiles are *"identically linked … if you change
one the other follows automatically"*. Read with the trim answer (*"reining
in one side should trim on the other also"*), an edit to one profile is an
edit to both while the link stands: the twin line goes too and the body is
open. What "broken" looks like was mine to choose: the surviving edges are
still swept (an edge extrude is the fundamental feature), drawn as open
walls, the row marked open, and closing the loop makes it a solid again.
**Rejected**: deleting the extrude record on the first missing line — it
turns a slip of the finger into the loss of the feature, and the owner had
just said deleting the *extrude* is the act that leaves plain geometry.

**I explained the status's z exception badly, twice** ("z gauge", and a
claim that moving the whole drawing is not counted — it is: a rectangle of
four perps reads 5 free, which is 2 for position, 1 for turning, 2 for
size). What is true: the count leaves out exactly one thing, a flat
drawing's freedom to leave its plane, though nothing holds it there. Asked
again in plain words; open.

**The container was recycled between the 9th and the 12th.** Everything was
pushed. The mirror's mailmap was a local file and went with it; it is
rebuilt from the history's own identities and proven by the rewritten tip
matching the mirror's.

## 2026-11-09 — a click on a face lands on it, is held there, and says so first

The owner: *"when i make a rectangular prism, i attempt to draw an e.g.
circle on another face, but it still draws the circle on the XY plane. Why?
if i am hovering over a face without an active on-plane constraint, it should
constrain to the plane i am hovering over."* Built on `claude/click-on-face`
from docs/plans/click-on-face.md. The register has the choices; this is why.

**Reproduced first, and the bug was not where the spec guessed.** The spec
suspected `isSolidFace` after #87, or a snap to a ground entity behind the
face. Driving the real app showed the face's loop was found fine. What
failed was two things. A *click* on a face never registered: the circle tool
settled its press onto the face's plane and then asked `pressMoved(press,
release)` with the release still on the ground behind — same pixel, worlds
apart — so every click read as a drag of zero radius and the gesture quietly
reset. Only a drag drew, and the owner, clicking, saw nothing or saw the
next press start over. And a press that *snapped* — to one of the face's own
edges, which on a phone's small face a finger's reach makes nearly every
press — skipped the face question outright (`!p.snap`), so the circle was
laid on the ground through a point of the wall: the owner's words exactly.
Both are assembly: the unit tests drove the tools with clicks already on the
plane and passed. Bug 72, with both legs written down.

**Landing in the engine, not in the tools.** The old design asked the face
question inside `CurvePlane.begin`, once per gesture, of the loop under the
pixel. Moving it to the engine — every pointer event of a tool that places
points is read on the face drawn under the pixel, and told which — gave
per-click surfaces to every tool at once (point, line, spline, the shapes)
and let the snap be restricted to the face before the tool sees it, which is
the only place that restriction can live. It also made the press and the
release agree by construction. The face is the one the frame drew, asked
through `faceUnder`, the dimension tool's own question: so the face lit, the
face named and the face landed on are one face.

**The existing `onplane`, extended, rather than a new op.** A face name has
one dot, like an axis reference, and `parseAxisRef` threw on it — found by
the e2e's page errors: the `par(c, "e1.m2")` glyph asked whether its last
argument was an axis. The face's shape (`e1.lid`, `e1.m3`) moved into
model.ts beside `parseAxisRef`, where the namespace is owned, and solidref.ts
re-exports it; `onPlane` hands a face name to `onFace` in solidref.ts, which
reads the face as `fdist` does. The reward is everything that already knew
`onPlane`: the ▱ glyph, the palette's rows, `del`, the deletion cascade (a
face's referent is its feature, so `del("e1")` takes the relation), the
copies offset and mirror make, the journal and the replay. The cost is one
branch at the top of `onPlane`.

**A wall's hold is both ways, and that shows under `set`.** `readPlane`
reads a wall's line as variables, so a point held on a wall can pull the
wall. Measured: with nothing holding the base, a point put 5 off a wall met
it halfway — the wall came 2.5 and the point went 2.5. And a `set` of the
depth with a circle pinned to three faces moved the solid 0.7 of the 10 the
lid rose, the minimum-norm solve sharing the change. Correct by the owner's
"bidirectional relationships everywhere"; surprising if you think of the
solid as fixed. Written into the register as a question about free bases,
not about faces: a base held (sketch mode, `fix`) stays put and the point
rides the whole way, which the unit test shows both ways.

**Rejected: the chip's first part as a button.** `on e1.m3` is the same
question the chip's `where` answers for a chosen plane, so it goes in the
same place — but a face under the hand is no mode: nothing to look at, end
or change. The part is text in the hover's amber while it is a landing, and
the ⟂ and Done are hidden. Rejected too: the hover tag, which is hidden while
a tool is armed on purpose (the snap marker says the useful thing then); the
face's name is the mark's and the chip's.

**Rejected: a snap to an edge of the face suppressing the face hold.** The
spec's "a snap to a vertex or edge still wins over the face" is read as the
snap being taken rather than refused: a vertex snap pins the point and gets
no onplane (as a chosen plane never gets one on a pinned point); a snap along
an edge gets the edge's `on` *and* the face's `onplane`, as a sketch plane
does today — an agreeing pair, counted and not blamed.

**The pictures found the phone's snaps.** On the iPhone at the phone's own
scale a wall is sixty pixels across and its edge midpoints are inside a
finger's midpoint snap of its middle, so the first finger tests pinned their
centres to edges, correctly, and failed the face assertion. The e2e zooms in
and says why. And a finger held on a face for a picture ran into the
long-press and opened the menu, which the next tap closed: the look is a
short press now, Escape after it, the tool armed afresh.

## 2026-11-09 — the constraints palette, and redundancy counted rather than blamed

The owner: *"the constraint list should not be on the features palette, it
should be a separate constraints palette. although i think it should still
be installed as a workbench."* Built on `claude/constraints-palette` from
docs/plans/constraints-palette.md, with the register's item 2 ("redundancy
counted, not blamed on the newest relation") as part of it, since the palette
is where the agreeing set is shown. The choices are in TODO.md's register;
this is why they were made.

**Hidden from the start, everywhere.** The spec says the palette docks at the
bottom on an upright phone and at the side on its side, and the owner's words
for the organiser were *"show from start"*. Measured on the iPhone 13
emulation (390 × 664): a row under a finger is a target tall, 44 px, and a
strip's hit box reaches another target up over the drawing, so a pane of three
rows is 190 px of a 664-px screen — a third of the drawing, permanently, for a
list that is only wanted when something is selected to relate. So the pane
starts hidden there and the constrain tool summons it while armed (gone again
when the tool is put down), and a viewer who wants it always shows it from
Panes, after which it stays. The desktop was going to start with it up — it
has the room — until the first full run of the suite: twenty-five tests
clicked drawing under the pane's default place at the right edge, every one
refused by the harness's `at`. Those clicks are where people draw; the pane
starts hidden on a desktop too, and the behaviour is one story on every
device. Written down as the first vetoable choice: if the owner says "show
from start" of this pane too, it is one array in main.ts.

**Three rows, not the spec's four.** Four rows plus the strip's reach put the
pane's influence over the lower part of what the relation tests pick — a fifth
line at y −18, an arc's lower end — and two circles at the drawing's middle
would have had their lower rims under it. Three leaves the owner's case whole:
both circles and the mirror line in sight with the two circles picked. The
rows shown are not a fixed count anyway: each build measures the pane's real
height and shows the likeliest rows that fit with a *more…* row, so a pane the
viewer makes taller shows more.

**Landscape went left, not beside the column.** The first layout put the
palette as a second column left of the right-hand one; measured, it lay over
the drawing's middle — two lines drawn there were under it, and a tap on them
was the pane's. The left side under the logo is the one stretch of a landscape
phone nothing else defaults to, and the drawing's middle stays clear.

**Bug 71, and a harness blind spot.** The first tap after arming was lost on
the phone: the palette at the bottom, the strip's `::before` reaching 44 px up,
and Chromium's touch adjustment snapping a tap within the finger's 8-px radius
onto it, so a line 30 px above the pane was the pane's. `elementFromPoint`
said the canvas, so the harness's `at` let the press through, and no rectangle
overlapped, so the layout tests saw nothing. `at` now refuses a point within a
strip's reach under a finger, which is what the real finger meets.

**The agreeing set is found, not guessed.** The kernel's `null_support` was
already flagging every row in the left null space's support; `analyse` only
ever read the non-pivots, which is what made "redundant rN" blame the newest.
The union support alone was rejected as the set — a tool-drawn 3D arc's
`onplane` and `oncircle` plane row agree in one row with no whole relation
implied, and in a drawing with a redundant rectangle they would have been
listed with it. So for each wholly implied block the candidates are tried one
at a time with their rows left out, and kept when the block is then no longer
implied; where no single one is needed (a row said three times) the whole
support stands. Bounded like the conflict search. The status counts the
union's size and names none; `redundant` is kept, unsaid, because the
dimension tool's "already held" is a question about the later one.

**Rejected: the status's count opening the palette.** A tap on `4 agreeing`
typing `ui({ show: "constraints" })` would be one line, but the status's
buttons are the relation-selecting kind, and a count is not a relation.

**Rejected: a right-hand column on an upright phone.** It would keep the
left of the drawing tappable as the old options pane did, but the owner's
two circles sit at the middle and the right one would be under it entirely.

## 2026-11-09 — the owner's principle, and a review of the decisions against it

The owner, on the extrude's two profiles: *"i mean kind of like mirror
relations"*, and *"in retrospect, i don't like the idea of anything being
'consumed' as this implies unidirectional hierarchy"*. On 3D fillets: *"they
ought to keep the original geometry as construction without modification. of
course it would be silly not to allow fillets on one end only."* On the
constrain list: *"it should be a separate constraints palette … still be
installed as a workbench"*. And: *"please weigh in on the prior decisions as
some have been not very good"*.

The principle, stated once so later work can be checked against it: **a
relation between entities, never an owner; both ways, never a source and a
derivative; agreeing over-constraint is normal.** Read against it, these
decisions in the register are weak, and are now listed there as such:

1. **Conflicts found by heuristics rather than by fixing the residuals.**
   `par`/`perp`/`tan` are satisfied by a collapsed line because their
   residuals are products of raw vectors; the plan rejected normalising them
   as "changing every drawing's solving", but a unit-direction residual has
   the same roots minus the spurious one. The push/steer detection (SUSPECT,
   NUDGE_ITER, 30 iterations, tuned) is a backstop, not the fix.
2. **Redundancy blamed on the newest relation** (`diagnose`: implied by rows
   stored *before* it). Storage order is a hierarchy. With agreeing
   over-constraint normal, the status should count agreeing extras, and the
   constraints palette show the agreeing set; no culprit.
3. **Conflict naming by "two of a set"** (#87) patches 2's symptom. Name the
   relation whose addition made the conflict, with the set it disagrees
   with.
4. **Features own entities and relations** (an extrude owns its lid and
   walls; `edgeExtrude` owns what it makes; feature-held relations cannot be
   deleted; `deleteFeature` cascades). Ownership is the hierarchy the owner
   rejects. linked-profiles.md reverses it for the extrude.
5. **Many-at-once as a star** gives the first pick n−1 glyphs: a mild
   source. An n-ary relation (`eq(l1, …, l5)` as one entry) is symmetric and
   names once in a conflict.
6. **Smart dimension's `fdist` stores a wall index** (`e1.m3`) that a
   regeneration renumbers, and **`ang3` on walls holds points, not lines**.
   Both should name entities and take lines lazily.
7. **A chamfer face's sketch plane is a frame that does not follow the
   solid** (sketch-mode): a one-way tie. Hold it to what defines the face,
   or refuse until that exists.
8. **`defineThroughReach`**: a relation reading kernel geometry through a
   hook keeps the layer rule's letter; Through all should be a relation to
   the far face's defining geometry.

Fine, read against the principle: collapse-as-CONFLICT with rollback;
feature-held relations as background to the search (until 4 is undone);
Cut's direction read off the bodies; a deletable `e1_perp`; the four-perp
rectangle with one flat (redundancy being normal ink); derived names that
keep old files' r-names; ⌀ for a circle, R for an arc; driven-when-redundant
(the user may still flip it to driving and let the conflict machinery say
so); a datum picked by the user staying a datum.

## 2026-11-09 — a prism stays a prism

The owner: *"Why is it that after I extrude I can drag a corner of the
extrude and it deforms the solid? I think it's missing adding in
relations"*. The cause was one line of `extrusion`: twin = base + depth along
the frame's +z, a datum. A drag on a lid corner could only move the base, and
the base tilted under walls that could not.

**Rejected first: holding the sketch to the ground.** The first plan held a
profile drawn on the ground `onPlane` the ground, which fixes the drag by
making the base immovable. The owner: *"It's not about being tied to the
ground plane, it's about correct relationships BETWEEN entities."* — and then
*"the default for sketch entities is no plane."* So the fix had to make the
solid's own entities agree with each other, and nothing agree with a datum
nobody picked.

**Rejected second: the profile's own normal inside the extrusion.** The
natural form — a unit normal of the profile's, the twins at base + depth·n —
was proposed, and the owner asked instead for an edge extrude as the
primitive, and for the squareness to be *"its own deletable relation"*:
*"how could you have a relation inside an extrude? that doesnt really make
sense to me"*. That turned out better than the normal: the extrusion is then
only a translation (linear, both ways, nothing squared), `perp(chord, e1)` is
an ordinary relation with a name and a `del`, and an `ang` in its place is a
draft — a thing the normal-inside form could never have offered.

**Why a derived name, `e1_perp`.** Relation names come from a counter, and
an operation that makes one more relation than it used to shifts every later
`r` in an old file by one: `del("r7")` in its journal would then delete the
wrong thing. A name taken from the record claims no counter, so old files
replay name for name and gain the perpendicular — their solids stop skewing
without a format bump.

**Why `set` seats the lid first.** With no direction read, a depth changed
from 10 to 25 leaves the solve to find where the extra 15 goes, and a
minimum-norm Levenberg–Marquardt step shares it between base and lid:
measured, a free rectangle's base dropped 5.9 and tilted. Seating the twins
at the new depth first leaves the solve nothing to do (0 iterations). It is a
seed, as the operation's own are, and every relation still holds both ways.
The same move handles a depth set across zero, which would otherwise fold
every wall through nothing.

**Why the angle seeds.** Deleting `e1_perp` and typing `ang(wall, e1, 0.3)`
did nothing at first: an unsigned angle is a function of the angle alone, so
at 0 its gradient vanishes by symmetry however it is written. `ang` seats the
chord at θ toward the first edge when it finds it standing exactly square.

**Why four perps need a coplanar.** The owner wanted four so that every edge
is held alike. Measured, four right angles do flatten a quadrilateral — a
skew one's angles sum to less than 2π — but only to second order: a corner
dragged out of plane came back 2.9e-4 off. A `coplanar` makes it first
order, 9e-13. The fourth perp is then implied, and the owner's point 4 — an
agreeing redundancy in ordinary ink, muted — is what lets that be the
default rather than an orange mark on every rectangle.

**Left on hold**: the owner's point 2, linked twin relations on the lid, so
that *"it should be impossible to tell which was the original and which is
the derivative"*. Nothing extra is on the lid meanwhile; TODO.md says so.

## 2026-11-08 — the solid tools, for someone who has not used them

The owner: *"Flip button."* and *"I'm still not clear on how to use the
extrude cut tool. It doesn't make sense to me. Make it more intuitive, along
with the other solid tools."* — and *"Go now and don't ask questions"*, so
every choice below is in TODO's register to veto.

**Walked first.** Every solid tool by finger on an emulated iPhone 13, every
step pictured and looked at, before anything changed. The list of sixteen
(the spec's *Walkthrough*) decided what to build: the owner's Cut confusion
was three things at once — Cut hidden in a row, the sign of a number deciding
the direction, and ✓ building a cut that cut nothing with only a log line
afterwards. A Cut tool alone would have fixed the first.

**Why Cut's direction is read off the bodies, not the viewer.** The obvious
default is "into the screen", and on a lid seen from above it is the same
answer. It is a different answer for a circle on the ground under a block,
for a lid seen from below, and for a face seen edge-on. What a user means by
Cut is "take material away", so the tool asks where the material is. Rejected:
a second preview at the other sign when the first reached nothing (two
previews per pick, and a flicker as the second replaced the first).

**Why through all is relational, through a hook.** A through depth captured
once as a number stops being through when the plate is made deeper, and the
spec says it must follow. Routing only through-all features to the kernel was
tried on paper and rejected: the preview and a one-feature body are drawn by
faces.ts off the twins, so the twins must stand where the solid ends. So the
depth dimension holds the lid at a reach read live — but a relation may not
know what a body is, so the solids layer registers the reach with the model
(`defineThroughReach`), as a module registers a rebuild.

**Up to face, left.** Its relation is the same shape (a reach to a plane,
read live), and a face of entities is a plane already; the work is the second
pick and a stable name for a face only the kernel made — which sketch-mode is
building in parallel. Shipping a half (faces of entities only, no kernel
faces) would have been the one end condition that silently does nothing on a
filleted body.

**What the browser found that the unit suite passed**: the origin's axes
missing from the revolve; Cut's "reaches nothing" said after every cut (the
render between a confirm's lines asked the half-built model); the face's menu
items below a screenful of tools on a phone — the e2e that asked for them
found them, and only the picture showed where; the end row's label cut to
"e.", and then — the full suite's touch test — the row itself one too many
for an iPhone held sideways, so the end condition became a drop-down in the
depth's row, as SolidWorks lays it out. And one about the workshop: a dev server started by hand in a worktree
serves the code it started with, because vite.config ignores `.claude/`, which
is the whole tree there (TODO).

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

### Smart dimension: a face is what made it, and the depth is already a dimension

The owner asked for SolidWorks' Smart Dimension, faces of a solid included,
and said "don't ask questions". The decision that shaped the rest was what a
face *is* to a dimension. Three ways were open:

- **A face as kernel geometry**, a plane read off the B-rep. It is exact for
  any face, a fillet's too. But nothing in the model holds it, so it could
  only ever be driven. And the kernel answers asynchronously, from a Worker,
  above the relations layer.
- **A face as a frame made on it**, a construction plane. It is drivable,
  but it is a new entity per face with its own name and freedoms, and a
  datum: a frame is read, never pushed, so a dimension on it could not move
  the solid.
- **A face as what made it.** This is what was built. A sweep is real
  geometry here: a lid is its twins, a wall its member swept. So a face maps
  to entities, and a dimension on it is an ordinary relation on them.

The third made most of the table fall out of the existing sketch
vocabulary. Two walls of one extrude are two lines on its sketch. A round
wall is its circle. An edge between two of one extrude's faces is an entity.
The names are the kernel's (`e1.lid`, `e1.m3`), because a body drawn by
faces.ts and one built by the kernel must call one face by one name.

**The depth.** The spec asked that setting a lid-to-base distance set the
depth "through a relation between those points, not by editing the feature's
number behind its back", and asked how the depth is held. It is held by
`extrusion`: three linear residuals per pair, `twin − base − depth·ẑ`, with
the depth a constant. So any other relation on that distance can only repeat
it (redundant) or contradict it (conflict). There is no free variable for a
second relation to drive. The alternatives rejected:

- *Make the depth a solver variable*, so a dimension can drive it. That is a
  structural change to the extrusion the solid-tools package is editing this
  week, for one case.
- *Route the new dimension's `set` to the depth*. That is the "behind its
  back" the spec ruled out.
- *Make it driven*. That is honest, but the owner's first try would be a
  block's height, and a height he cannot set would be the wrong first
  impression.

So the tool recognises the pair and opens the depth's own value, as Set
value… does. The relation between those points *is* the extrusion.

**Driven when it must.** SolidWorks asks; the house never asks. So the tool
tries the driving dimension on a throwaway copy (the feature tools' preview:
the same command machinery the commit runs) and asks the copy's
`diagnose` and conflict search. The common case is two lids on one plane:
both depths already hold their distance. Typed points held by nothing made
the e2e's lids free in z, and there `fdist` legitimately drove, lifting the
second block's profile off the ground. That is right for an unheld sketch.
The test now holds its points as the sketch tools do.

**The wedge's angle.** Two walls' lines meet at the corner the wedge's edge
stands on, and `ang` reads the angle between their *directions*: 150° for a
30° wedge, since a profile's lines run head to tail. `ang` cannot be told to
reverse a line, so walls that share a corner are dimensioned by `ang3` at
that corner. It reads the solid's angle. Sketch line–line stays `ang`, as the
existing tests and files have it.

**Faces pick only for a tool that asks.** ARCHITECTURE.md says faces never
pick, and everything built on that is right as it is: a click on a face
selects nothing, hover tags only geometry. So `ctx.pickSolid` is a separate
door, the ordinary pick and then the front face, rather than a fourth tier
of `hitTest`. The relations package can use the same door.

**Rejected: long-press to edit.** The spec asked for it, but a held finger
is the menu everywhere in the app. On a label the menu's first item is Set
value… already, so long-press is one tap from editing and takes nothing away.

### Trim everything: what a piece is, and why power trim is only typing

The owner: *"Also need trim for sketch entities"*. Trim already existed for
lines, arcs and circles, and it was on the modify button behind the fillet's
face. So the request read two ways: trim the curves it refused, and make trim
easy to find. Both were done.

**What is a piece of an ellipse?** It is not an ellipse, so it needed a kind.
I considered letting the ellipse carry optional ends, as "an ellipse with ends
is an arc of one". It would have cost less code. But every predicate that
asks "closed?" would then ask a field, and the spec asked for a kind. So the
elliptical arc is its own kind, built of the same parts and read by the same
relations (`ellipseOf` answers for both). The hard part was the frame. Every
consumer of `ArcFrame` measures an arc from its start with `u` pointing at
it, but a conic's form needs `u` and `v` to be its own square axes. So the
frame keeps the axes and gains a start, `t0`, and the arithmetic in
`arcgeom.ts` absorbs it: a caller walking 0 to sweep never knows. I counted
the places that compute an angle from a point instead (sketchgeom, the extend
preview, loops), and changed those. The rejected alternative was a frame of
conjugate diameters, which does start at the start. It is not orthonormal,
and every one of those consumers projects with a dot product.

The second piece out of the middle needed holding to the first. I first
reached for sharing the minor variable, which would make the two pieces
literally one ellipse. I rejected it on reading `diagnose`: each entity's
owned variables are listed, a shared one would count twice, and the free
count would lie. `eqrad` for two conics, meaning equal semi-axes, costs one
more relation and tells the truth.

**What is a piece of a spline?** The spline TODO had named it already: the
piece of an interpolant is exactly a clamped B-spline, by knot insertion.
The real decision was who owns the control points. As the entity's own
variables they would be invisible and undraggable, and a piece the hand can
reach only by its two ends is not much of a curve. As ordinary points they
are draggable and dimensionable, with nothing to fight a drag, since nothing
holds them. That is Onshape's control-point spline. The spline package had
rejected control points as points, but for the opposite reason: there, rows
held them. Looking at the picture showed the cost. The points float off the
curve with nothing saying whose they are, so the control polygon is drawn.

A replay runs on seeds, and an interpolant's knots come from where its points
are, so a replay would cut a differently-knotted curve. The trim journals the
pieces it made, knots and control points, and the saved values put the
points back afterwards. The matrix test, which saves, opens and compares
bytes for every pair, is what holds that.

**Power trim is only typing.** I wanted no new operation for it: one typed
entry is already one undo step, and the journal already knows `trim`. The
problem was names. A middle trim renames the far part, so a later piece of
the same curve would be typed under a name that no longer covers it. I
considered simulating the stroke on a cloned model to read the names off. It
would have meant the tools layer importing persist, and an open per stroke on
an iPhone. The order is simpler. A trim keeps the curve's name on the part
from its start, so typing one curve's pieces from its far end back keeps
every name right. A closed curve is ordered from the cut its first trim
opens it at. The unit test that crosses two pieces of one line holds it.

**A press that becomes a stroke means a click trims on release.** The old
tool trimmed on the press. That had to move, and the tool tests that sent
only a press now send the release a real click sends.

**What looking found.** The e2e's first finger run said Select under the
armed trim. The bare-name shortcut never drew a frame, and the chip is synced
in the draw pass. That bug predates this package, and only a test asserting
the chip before any click could see it. On the phone, trim's glyph read as a
plus sign as the modify button's face, so the piece is struck out now.

### Every standard relation: a table first, then rules over predicates

The owner: *"Also need to figure out a way to do all the standard
relations."* The spec asked for the table to be written before the code, and
that turned out to be the useful order: once every pair of pickable kinds was
written against SolidWorks' and Onshape's lists, most cells were relations
that already existed and simply were not offered (`onellipse`, `onspline`,
`fix`, `tan` with an ellipse, `mid` of two points, `sym` about an axis). The
new mathematics was small — `corad`, and `sym` for lines, circles and arcs —
and the work was in the offering.

**Why predicates, not a switch.** Two other workers were adding kinds at the
same time (an elliptical arc, a control-point spline). A table keyed on kind
names would have needed a row for each, on merge, from someone who had not
written it. So the rules read what a kind declares: a point is On any curve
whose kind says which relation holds a point on it (`heldBy`, looked up in
its module), Fix takes any entity's `refs`, Concentric anything with a
centre. A kind a module adds gets those cells with no line here. What it does
not get is `intersection` and `pierce`, which live in geometry.ts and cannot
reach a module; that is written down.

**Star, not chain, and the cost of it.** Many at once relates each pick to
the first. Measured with the conflict search on eight lines: a star's
conflicts name at most four relations wherever the two disagreeing
dimensions are; a chain's name every eq on the path between them, up to nine.
A chain wins one case (the two offenders adjacent in it, 3 against 4). The
price showed in the first picture: five lines Equal puts four `=` marks on
the first line. Rejected: a chain (worse conflicts), and a new n-ary
`equal(...)` relation (one glyph, but one deletion takes all of them, and
the journal would carry a second spelling of `eq`).

**Two decisions the rank analysis made.** `sym` of two lines was first going
to pair ends, nearest to nearest, and journal the pairing; saying the
*segment* is mirrored — middles, direction, length — needs no pairing at all,
and four rows are exactly a segment's freedoms. `sym` of two circles in 3D was
written with the true mirror of a normal, 2(n·û)û − n; the diagnosis counted
it taking six freedoms on a tilted plane where coradial takes five, the extra
one coming through the mirror line's own direction. Parallel normals are
what the mirror gives for any line in the circles' plane, which a sketch's
always is, and take two. The 3D tests hold every point on the tilted plane,
as the tools do — the first version did not, and a solve that moved a free
point off the plane *added* a freedom, which read as a relation taking none.

**What the browser found.** Three bugs the unit table passed (55–57 in
ARCHITECTURE.md). The face picker asked only the solid kernel, and a plain
box is not the kernel's; a greyed reason was unreadable at a phone's width;
a picked spline drew nothing. The last two were found by looking at the
iPhone pictures, which is the CLAUDE.md rule paying for itself again. One
thing the pictures showed that is *not* a bug: a Fix on a rectangle's corner
is quiet with the corner (the owner's quiet rule), so its padlock shows on
hover or selection. Making Fix the one mark that never goes quiet is in the
register as an option, not done — it would be the first exception to a rule
the owner set.

**Left.** Convert Entities is an operation plus a projection relation that
does not exist; Curvature and Equal curve length have no relation. A face
bounded only by a circle comes back from sketch-on-face's plane reference as
the circle, so it is picked as the rim.

### Sketch mode: measure first, because most of it was already there

The owner did not know sketch mode existed, and the spec said as much: the
work plane, `workplane(…)`, `onPlane` from place.ts and activeplane.ts were
all built. So the first job was a table, not a feature. Every drawing tool,
every method, on nine kinds of plane, counting `onPlane` against points
made. It came back clean: one per point, everywhere a plane could be named.
The table stayed as the test, keyed on the tool registry so a tool added
later has to say whether it draws.

**Front and Right as references, not frames.** A frame made for Front would
have been three points and a frame entity in every document that sketched
on Front, and the owner asked for "not a special feature". A plane
reference costs a string. `"origin.xz"` has one dot, like an axis
reference, so the parsers that ask "is this an axis?" had to answer no
rather than throw. Rejected: built-in names `front`/`right` like `origin`,
which would have needed the old-file rename `origin` needed, for two more
reserved words.

**Copies: explicit onPlane, though mirror and pattern imply it.** A
mirrored copy is in the plane by `sym`. Adding `onPlane` is a redundant
equation, and the solver does not mind. The focus, the hover and `del` read
relations, not implications, and without it a mirrored copy was drawn
dimmed on the plane it lies on. For offset it was not redundant: `par` and
`dist` alone let the copy slide along the normal. The rule has to decide
whether an operation keeps a plane, and it decides from what is journalled
where it can (a pattern's step and plane) and from positions only for a
mirror line.

**A kernel face's plane is a frame, and does not follow.** Mapping a chamfer
to model points is impossible: it has none. A frame made at it is the
honest answer, and it is written down that it stays where the face was.
Rejected: a new plane-reference kind of plain numbers, which would follow
nothing either and would be a fourth syntax for one corner case.

**Escape leaves a work plane, not a default frame.** The spec asked for
Escape with nothing armed. The sketch-on-face suite showed why that needs
a limit: the Escape that releases a feature tool after ✓ arrives with
nothing armed and dropped a plane made with `plane()`. The work plane is
the mode; a default frame is a choice for the document.

**What the browser found** (51–54): the dimmed spline, a chamfer click
going to the lid behind it, a phone's wall turned half off the screen, and
the Escape above. None was visible to the unit suite: it has no kernel
faces, no screen edge and no Escape key.

### Conflict detection: what a solution is, and why a threshold was not enough

The owner found that a `par` could be added across a rectangle's `perp`s and
the drawing said SOLVED. It had solved, to 1e-12, by folding a side. The
residuals are right: a zero vector is parallel and perpendicular to
everything. So the fix is in what counts as a solution, decided in the model,
where what a line is is known. The kernel stays blind.

**A plain threshold failed on the first triangle.** The plan's "measure
below ε·L" works for a collapse a residual meets linearly, which lands at
the solver's precision, ~1e-12·L. A triangle's second right angle does not.
Once the first holds, the second row is the square of the folding side, and
the damped step stalls at ~4e-5·L, which is the size of a real detail. Ruled
out: a larger ε (it would call real small sizes collapses), and polishing
with no tolerance (I tried it; the damped step makes no progress there at
all). What worked is to treat anything that fell past 1e-2·L as a suspect,
pull it toward nothing, and release it. A collapse has nothing holding it off
zero and stays there. A real small size has a relation that set it, and that
relation pulls it back, after which the solve's own state is restored. With
that in, ε could be measured: across the whole unit suite collapses end at
≤ 4.6e-10·L, and real sizes that halved in a solve stay ≥ 2e-4·L.

**The solver is local, and the search found it first.** QuickXplain asks
"does this subset conflict?" by solving the subset. On the rectangle it was
told that `par(l1,l2)` with `perp(l2,l3)` conflicts, and it named that pair.
They don't: a turned side meets both. But from the rectangle as drawn, the
nearest root folds l2. So a collapsing trial is retried *steered*: every size
pulled toward what it was for a while, then released. The same retry runs on
the user's own solve, and in 3D it turns a side where the bare solver folded
one, for a set that was never a conflict. Rejected: normalising `par` and
`perp` by the lengths (Design 6). It would change every drawing's solving to
fix the ones that conflict.

**The user's own zero.** `dist(p, q, 0)` is a collapse by the definition,
and the plan says it is none. A list of which relations may zero what would
be a second table that the next relation forgets. The rule instead is that
one relation alone, solved from the state before, collapses the measure too.
That catches `dist(p, q, 0)` and a `coin` of a line's ends with no list. It
also reads `perp(l1, l1)` as meant, and a chain of two `coin`s through a
third point as a conflict. Both are pinned by tests and listed in TODO for
the owner.

**Two irreducible conflicts in one rectangle.** QuickXplain found
`{par, perp23, perp34}` before `{par, perp12}`. Both are irreducible: with
l1 ∥ l2, three corners are in a row and the far corner's two perps fold a
side. The plan expected the second. Candidates are now ordered nearest what
folded: first the relations naming the folded entity, then by reach through
the block graph. QuickXplain keeps the earliest, so the par's own corner is
what gets named. Delete that perp and the other conflict is named next. That
is right, and the test says so.

**Rollback per component, not of the whole drawing.** Undoing the whole
solve would mean a `dist` typed on an unrelated line never lands while a
conflict stands anywhere. A component shares no variable with another, so
its answer is the same either way, and only the part that folded goes back.

**The drag: stop the frame, not refuse at the end.** Refusing at release
would let the rectangle visibly fold under the hand and spring back. A
frame's check is cheap (only entities whose variables moved, no push, no
search), so each frame that would fold its part stays where the last one
was. The price is that a drawing holding a conflict cannot be dragged in that
part, which seems right while it is red.

**Cost.** The search was 300 ms on forty chained rectangles, a single
component of 280 relations, because every question solved the whole
component. Searching rings outward from what failed (a set that conflicts by
itself is irreducible or not whatever is outside it) brought it to ~130 ms.
A cache for a standing conflict was considered and left out: its key would
need everything a block's closure reads outside its declared variables, and
a frame's points are exactly that.

### The spline: why it owns its equations, why it has no normal, and what was rejected

**Interpolating, not a control polygon.** The plan said Onshape's spline,
and the owner's "all the usual" is that: you put the curve where you want
it by putting points on it, and you dimension, `coin` and snap those
points like any other. A control-polygon spline would have put draggable
points off the curve, which nothing else in the sketch does.

**Centripetal knots.** With uniform spacing, a spline through two close
points and then a far one overshoots wildly; with chord-length it can loop
at a tight corner. Centripetal (gap = √distance) is the standard answer
and the one that looked right in every picture I made. Natural ends for an
open spline (no curvature at the ends) rather than clamped tangents:
clamping needs a tangent from somewhere, and the honest source of one is a
line the user draws and `tan`s — which is what a tangent handle would have
been, so I did not build handles.

**Why the equations are the entity's, and not a relation.** The obvious
first design was `addSpline` + an `interp(sp1)` relation. Two things killed
it. A relation is deletable, and a spline whose interpolation is deleted is
a curve of free control points — through nothing, malformed in exactly the
way the delete primitives exist to refuse. And a relation shows in
`rels()`, so every spline would list a constraint the user never made and
cannot meaningfully remove. So the rows are the entity's: `owns` on its
kind, removed by `deleteEntity`, journalled by the one `addSpline`. That is
the one place a block goes straight to `problem.addResidual` outside a
`model.relation` body, deliberately; CLAUDE.md's rule is about relations,
and this is not one. Control points as hidden point entities were the other
rejected option: they would be pickable, draggable, listed, and every drag
of one would fight the rows holding it.

**Why no normal.** The plan gave the spline a circle's three normal
variables. But every control point is an affine combination of the
through-points (the rows are linear), so if the through-points lie in a
plane the curve does too, whatever is solved. A normal would be three
variables only a `par` could hold, saying what the points already say —
and a 3D spline drawn on a tilted plane works by holding its points
`onplane`, as a line's are. It also meant `sketchface.ts` had to stop
assuming a lone closed curve has a normal (found writing the OpenCascade
fixtures; fixed).

**`onspline` needed a variable of its own.** A point on a curve has to say
where along it it is. A circle answers that with an angle the residual can
eliminate; a spline cannot. So the relation owns a parameter
(`relationVar`), deleted with it and saved with it — otherwise reopening a
file would let the solver pick the nearest root and the point could jump.

**The 2° rule.** Quarter-pixel sampling made the outline exact and the
extruded wall still banded at 3×: the shading is a function of the facet
normal, and a facet can be within a quarter pixel and still turn 6° from
its neighbour at a tight bend. The fix bounds the turn per chord as well,
by halving (evenly-spaced subdivision bunched the turn and overshot to
2.8°, measured). It costs about 0.3 ms a frame for a ten-point spline.

**What I decided for the edits.** A piece of a spline is a spline through
points it does not go through, so trim, extend and offset of a spline
itself, and a region bounded by part of one, would all need a second kind
of curve (control points, no through-points). That is a real feature, not
a corner of this one, so each is refused by name, with what does work
said in the message. Everything that only needs the spline as a cutter, a
target or a copy works.

**OpenCascade, strictly.** Four of six parts read without healing; the two
that do not fail identically with no spline in them, which I proved by
exporting an arc and a triangle revolved the same way from the previous
branch's code. I wrote them down rather than chase them: both are older
than the spline, and the healed read — what every application does — is
valid and exact.

### Surfaces: why the verbs are shared, why thicken and the pair fillet are built from parts, and what was rejected

**The name clash.** The sketch already owned `trim`, `extend` and `offset`,
and `fillet`/`chamfer` already served both the sketch and the solid. I had
two choices: give surfaces distinct verbs (`trimSurface`, a surface-trim
button), or share the verbs and dispatch on the first argument. I chose
sharing:
- `fillet` already worked that way;
- the owner prefers one tool doing solids and surfaces;
- the modify flyout is full at 10 items.

The risk with sharing is getting the wrong one silently. Three things close
that off:
- only surfaces are named `s` plus a number;
- a surface-shaped name that names nothing is refused as a surface's;
- each surface form is journalled under its own op, so no file can replay
  one as the other, and old files replay untouched.

Probing edge cases with a script turned up one more:
- `trim("s2", …)` after s2 had been knitted into s1 was recorded as a trim
  *into s2*.
- It cut correctly, because s2's name answers for s1's chain.
- But if the knit were deleted later, the trim would have moved onto s2
  alone.

So a surface's name now resolves to the sheet it is part of when the record
is made.

**What the kernel could not do.** I surveyed SMLib for sheets before
designing anything. Most of what the spec asked for was there: caps-off
sweeps, project-and-trim, intersect, stitch, stitch-into-solid, offset, and
the edge fillet on a sheet. Four things were missing:
- **Thicken.** `SmApiShellBrepFull`'s offset-solid option refused a planar
  sheet and gave two coincident faces for a cylinder. I built thicken from
  the sheet, its offset and ruled walls; the volumes come out exact,
  curvature term included.
- **Planar faces.** `SmApiCreatePlanarFaces` makes faces that crashed the
  wasm module once trimmed or knitted a second time, so a planar surface is
  the cap of a one-unit sweep, extracted on its own.
- **Extending a face.** No call extends a trimmed face, so `extend`
  lengthens the sweep the surface was made by.
- **The face–face blend.** `SmApiSurfaceSurfaceFillet` does exist, but it
  leaves both surfaces whole; a test pins that. A fillet between surfaces
  that only cross is therefore trim, knit and the edge fillet, in one
  record, so the user sees a single operation.

The glue grew; the pinned source did not.

**Rejected.**
- Keeping a trim's side as a sign or an inside/outside flag: it would be a
  negative surface by another name. The kept side is a point, as the press
  that made it.
- Projecting a trim's curve along the view: the camera isn't journalled, so
  a replay would cut somewhere else.
- `offset` as a record in its source's chain: an offset is wanted beside its
  source, so it is a new surface.
- A separate button for the surface tool: it went under extrude, in a sweep
  group, so the toolbar keeps its thirteen. The cost is that extrude's
  button now opens a flyout on a hover instead of showing a tooltip.

### Touch density: why the target follows the size, why 0.8, and what each follow-up turned out to be

**One number, scaled — and scaled against the form factor.** The owner's
"spacing barely changes" had a single cause: 44 was a literal in a dozen CSS
rules and in `touchMetrics`. The spec's rule, `44 × scale / base` with `base`
the device's 100 %, was taken as written at first; the Android e2e that
checks a 130 % system font draws the tools 1.3 × larger then failed, because
`deviceScale` already holds the text size and dividing by it cancels it.
Measuring against the form factor keeps the spec's numbers at the default
text size and lets a larger text size grow the targets as it grows the type.
Rejected: keeping the floor at 44 above 100 % and scaling only below (the
guarantee above 100 % would have stayed where it was), because the owner's
complaint was about the spacing not following the size, in either direction.

**0.8, and why the share is the smaller lever.** The three shares were shot
at 1× and 3×. They differ in the tool's face, which is visible only on the
armed tool, a flyout's current member and a press; the glyph is a fixed share
of the face, and what reads as air is pitch less glyph. 0.85 put the armed
face within ~2 px of the tray's border, 0.75 read like the old tray. The
glyph's growth (21 → 26 px at 100 %) is what made the tray denser; the pitch
at 100 % is the spec's and unchanged. The tool is drawn from the target
*before* its floor, so 60 % still shrinks the tray: drawn from the floored
target the tray would have stopped shrinking at 70 % while its type kept
going, the owner's complaint again in miniature.

**The fillet flake was looked at, not retried.** Recording the recogniser's
decisions and the tool's state on every event (wrappers that only push onto
an array) showed a clean drag and a direction that flipped: the label is
re-placed every frame from the latest preview, and the drag read its
direction from it. It is the app's — a person's drag would jump the same way —
so the fix is in the tool, not the test; the second failure was the test's
(its finger left down when an assertion threw). The label still jumps between
faces while dragged; fixing where it is drawn mid-drag was left, written down.

**The owner's overlap was not the bleed.** The tempting reading of his first
landscape picture was that a side bleed had grown the log over the command
line. Arithmetic says no: a bleed only reaches into an inset, and no pane's
rectangle is in one. A fuzz of the same pipeline `Panels.apply` runs found the
real path — stored places that a rotation cannot hold, the resolver giving
up, and the leftovers drawn — in 850 of 5,592 re-layouts. Rejected: making the
resolver itself search harder (a bigger change to the hottest code in the
panels, for a case the defaults already solve); giving up all stored places
at once (731 of the 850 fit by giving up only the overlapping panes'). The
re-fit is not stored, so a rotation back is the viewer's layout again, as
the lock's re-fit already was.

**The verdict's fade.** "Hidden only for ~3 s after a solve" in the spec was
right about the symptom and wrong about the clock: the chip hid its step for
exactly as long as the verdict was not marked faded, and the cut was the 0.6 s
after. The fix counts what is drawn, not what is marked.

### Sketch editing: why trim tries and takes itself back, why patterns got relations of their own, and what was rejected

**Trim is the one edit that cannot know before it acts.** Whether a feature
standing on a curve can still find its profile is a question about the drawing
after the cut — the loop finder reads held points and joins, so the answer
depends on structure the trim has not made yet. Three ways were weighed.
*Simulating* the loops a cut would leave, from the drawing before it, means a
second loop finder that would one day disagree with the first. *A copy of the
model* (save and open, as the feature preview does) is above `operations.ts`
in the layering — persist imports the modules, which import the operations.
*Trying it*: make the structural change, ask the same `refoundProfile` a
regeneration asks, and on a refusal undo each step by its inverse. The last
was taken, with one thing the model had to give: its auto-name counters,
saved and put back, because a refused call journals nothing and a replay
would otherwise hand out different names from the session's — the rule
`relation()` already keeps for a relation that throws. The tidying (holds on
the piece that went, a stranded end) comes after and is journalled as `del`
journals it, so the trim's own entry stays the structural change and a replay
does not recompute a cascade on seeds.

**Rejected: holding a trimmed end with `intersection` on both curves**, as the
spec's words suggest. The end is its own curve's end; `on(end, own line)` is a
residual identically zero, which the diagnosis then reports as redundant. Held
`on` the cutter alone, it says exactly what is true. Also rejected: making a
trimmed circle a *new* arc and re-pointing every relation's arguments at it —
the arc and the circle own the same kind of variables, so `circleToArc` keeps
the name, and every `rad`, `tan` and `oncircle` goes on reading what it read.

**The point the extrude owned.** Found by the header, not a test: a second
trim ended the top edge at a crossing the regeneration had made real. The
point and its holds were the feature's — so deleting the solid would have
deleted a corner of the sketch, and the edge's hold on its own end said
nothing. The fix gives the point to the sketch inside the trim's entry (so a
replay does the same); the alternative, a new point beside the owned one,
left two points on one spot that the loop finder reads as two vertices, and
the profile did not close.

**Patterns: one dimension, not one per point.** The spec's "dist/par of
corresponding points" holds every copy to its seed with numbers of its own:
a three-copy pattern of a rectangle would carry twenty-four dimensions, and
changing the spacing would mean editing all of them. So a copy is held to the
*step its first copy takes* — `translated(q, q2, p, p2)`, q2 − q = p2 − p, and
for a turn `rotated`, read off the first step's angle in the plane — and only
that first step carries a number: a `dist` on a construction line from the
seed's first point to its first copy (with `par` or `ang` for its direction),
or a `rotation`. Three relations, each linear in every point and none a
square, each written with `dot` and the wedge and proven on a tilted plane in
3D. *Found by that 3D test*: `rotated` first read its angle from the raw
vectors, and the solver, free to, lifted the centre off the plane and the
copies came out turned by the wrong angle; it reads the turn in the plane
square to its axis now.

**Mirror adds nothing the `sym`s already say.** Re-making the originals'
relations between the copies — the spec's "the same relations between the
copies" — would make every one of them redundant: a copy whose every point is
the mirror of an original point is that shape already. What the copies need
that `sym` cannot give is only what a point cannot carry: an arc's ends on
its circle (`arcends`) and a circle's radius (`eqrad`).

**`bevel`.** The solid's `chamfer` tool was already on the modify button. Two
tools called chamfer on one flyout is the confusion asked about; `bevel` is
one word and a draughtsman's word for the same cut. The typed call stays
`chamfer`, told apart by its arguments, as the two fillets are.

### See-through panels: why the layout does not change, why hover is not the docked form, and what was rejected

**The layout is the same rectangles see-through.** The tempting version
shrinks each pane to its content so the resolver gives the drawing the rest.
Rejected: every rule built so far — pushing, docking through a rotation, the
fit table over 94 device ways — would have needed a second set of sizes, and
a pane that changes size when the switch flips would push its neighbours
about. Instead the box simply takes no press and draws nothing, and the
content is drawn in a form of its own inside it. So "everything fits" holds
by construction, and the tests only have to add that the content stays
inside its box.

**Hover gives the box back, not the docked form.** The spec says a pane
under the hand is drawn docked. Built literally, a mouse moving onto the
organiser's tree turns it into the docked sections before the pointer
reaches the root it was going to open, so the tree can never be used with a
mouse. The box (ground, border, strip) under the same content gives the
spec's two reasons — a row legible over a busy drawing, a strip to drag —
without that. The docked form proper comes with a press, which is the spec's
own rule for the log, and the only door a finger has.

**The rows' gap was measured, not chosen.** A compact tree wants a few
pixels between rows; a finger in Chromium gets moved onto the nearest
control its contact area reaches, so the first e2e run's tap between rows
selected a row. 20 px was the first gap clear for the emulation's 8 px
fingertip; 22 is used. Rejected: delegating the rows' handlers to the tree
so the rows are not "tappable" to the adjuster — it depends on how Chromium
scores candidates, which is not ours to rely on.

**The lock is in the pure drag.** A DOM-only guard would have been three
lines; but then "a locked layout refuses a drag and a push" is a claim about
the DOM nobody can unit-test. A locked `Drag` keeps the start as its preview
at every spot and its drop commits nothing, and the DOM takes the one path it
always took.

### Android: why the scale is a CSS variable and not a font size, why the guard is only on a phone, and what was rejected

**The spec's way to read the font scale reads nothing.** It suggested the
computed size of a `font: medium` element with `text-size-adjust` left at its
default. I measured before building: Chromium 141 under Pixel 7 emulation
with Blink's accessibility font scale set to 1.3 (the setting Chrome on
Android fills from the system's). Among four lines of text, `medium` came
back 20.8 px. On a lone probe it came back 16 px, with or without
`text-size-adjust`. Chrome applies the system's scale to type only through
text autosizing, a heuristic over runs of text, and a probe is never one.
`env(preferred-text-scale)`, which Chrome on Android has since 138, read 1.3
exactly. So the variable is read, through a probe's *width*
(`calc(100px * env(…, 0))`), since script can read a CSS number no other
way. **Rejected: `<meta name="text-scale" content="scale">`** (Chrome 146).
It would make Chrome scale `medium` by the system's setting, and the factor
would then be counted twice: once in the variable and once in `defaultFont`.
**Rejected: reading the variable under a mouse.** A desktop's preference is
its browser's font size, and where Chrome brings the variable to Windows it
is a scale Chrome already applies as zoom.

**The guard entry is a phone's and an installed app's, not a tab's.** The
spec says back at rest does nothing, never leaving the app. In an installed
app, or on a phone where the gesture is a thumb's reflex, that is right. In
a desktop browser's tab, a page that will not let Back leave is the
pattern people hate. Things that are open still get their entry everywhere,
so a desktop's Back closes a menu before it leaves. **Rejected: one entry per
open thing**, a stack mirroring the overlays. One entry for "something is
open", re-pushed after a back while more stays open, has the same effect,
and fewer entries to leave behind. **Rejected: pushing on hover.** A mouse
running along the tray opens and closes flyouts many times a second. That is
history churn, and Chromium marks entries pushed without user activation as
ones Back skips. The guard's own pop closes the hover's flyout anyway.

**The keyboard is dodged by the panel, not by a re-layout.**
`interactive-widget=resizes-visual` keeps the page its size under the
keyboard (Chrome's default since 108, now asked for), so nothing re-lays out
and the drawing does not shrink. Only the panel holding the focused field is
moved, onto the keyboard's top, and narrowed beside the panes it would
otherwise cover. **Rejected: re-running the resolver with a shorter area.** It
would move every pane twice per keystroke session and fight the viewer's own
layout, all to dodge something that goes away when the field loses focus.

**activePlane not cached.** The brief: cache it on the solve if it costs more
than a few ms a frame. It costs 0.9 ms unthrottled and 2.0–2.7 ms at a 4× CPU
throttle, on the largest fixture with faces. The model has no revision
number, so a correct cache key would be a fingerprint of every solved value,
every frame. That is cheaper than the call, but it is a new invariant to keep
true for a saving of a millisecond. Written down as the thing to do once a
drawing makes it cross.

**The share refusal.** The spec believed Chrome on Android shares a `.json`.
Chromium's Android share service has its own permitted list, and `json` is
not on it, as on the desktop. I read the source rather than trust either
claim, and the e2e now plays Android's refusal, not a share that works.

### The drag preview: why it is the drop at the spot, and what was rejected

**The preview is the drop at this spot, and that came from review.** The first
build ran `dragStep` move by move on the drag's own copy, which is what the
panels used to do live. It kept the push's memory: a ghost pushed on the way
stayed pushed when the hand drew back. I wrote that down as vetoable, reading
"the rules of the push are unchanged" as covering the push's memory, and
reading the spec's "lifting back where it started commits nothing" as having
allowed for it. The review rejected it on the owner's own words: "show how
they will snap IF the user drops the grasped toolbar in that spot". What a
drop commits must be a function of where the hand is, not of the path.

So each move now asks the resolver once, from the layout at the press, for
the held panel taken straight to the hand: one `dragStep`, the grab as taken.
I considered replaying the straight line from the press in small steps. It is
just as path-free, but it costs a resolve per step, and it differs from the
single step only in which way a panel crossed diagonally is pushed. One step
is the resolver's own answer to "this move", so it won. One consequence is in
the e2e: a tray turned in the preview keeps the column grab it was taken by,
so its ghost leaves the chain when the column would clear it. The old
"come back by exactly the lead" measurement does not hold any more. The test
now checks that the ghosts come back up with the hand and that the same spot
gives the same ghosts. The lift-at-the-press rule stays, for the fingertip
that does not quite come home.

**The held panel is drawn, not placed.** `place` both drew a panel and wrote
it into `shown`, the layout every rule reads. The held panel must be drawn
over others without the layout knowing, or `onShow` would wrap the corner's
text round a panel that is only in the hand. So `draw` was split out, and
`shown` is the start until the drop.

**Rejected: animating the settle with a transform.** The thought was that a
FLIP (final box at once, a transform easing from the old place) might leave
`getBoundingClientRect` final for the tests. It does not: the rect includes
transforms. So the settle is a plain transition on the boxes, and the
harness waits for it (`settled()`). The first version waited for the
`settling` class alone, and failed under load twice in different ways. Once
the input was acknowledged before the page had handled the pointerup, so
nothing was settling yet. Once the transition's first frame came after the
timer that removes the class. The helper now waits for no drag, no settle
and no running transition, which is the condition rather than a guess at
how long it takes.

**Two of the browser's facts, found by looking.** A row's ghost along the
top was drawn under the corner's status text. The ghosts are now lifted over
the logo's row for the drag. A phone's ghost line, asked for at 1.95 px, was
drawn at 1. Chromium floors border widths to whole CSS pixels, so the width
is rounded in the stylesheet. Neither shows in any unit test; both are in
ARCHITECTURE's count.

### Solid fillets: why blends have a registry of their own, why the preview is a trial, and what was rejected

**A separate registry, measured first.** The obvious record for a fillet was
a third kind in `model.features`, beside extrude and revolve. I added the
kind to the union and ran the typecheck. Every function that reads a sweep's
profile broke, 81 of them in `operations.ts` alone. Narrowing only the map's
value type still left 29 there. `operations.ts` is the file
regions-as-operations is rewriting on a sibling branch, so either change was
a merge waiting to go wrong. Worse, each of those sites would then have had
to remember to skip a blend, and a site that forgot would read `f.loops` of
something with none. So blends got `model.blends`: the same `e` names and the
same `del`, `hide` and `edit`, while every sweep reader stays exactly as it
was. The deletion cascade needed two lines. `Chain.steps` puts blends in
order among the sweeps for the one reader that needs both, the program;
`Chain.features` stays sweeps for the rest.

**The preview is a trial in the chain, not the model copy.** Every other
feature tool previews by running its commit on a throwaway copy of the
model. A blend's copy would hold the same record and tell nothing, because
the shape is the kernel's. So the tool asks `Bodies` to build the body with
the blend appended to its chain. The cache keeps everything before the
blend, so a radius drag rebuilds only the fillet, and the answer is the
very body ✓ will give. The first browser run showed the one hazard: between
✓ and the tool letting go, the trial was still in the chain next to the real
fillet. The real fillet had already rounded the edges, so the trial failed,
and its refusal was logged as the fillet's. Hence the rules now in place:
the trial steps aside once its blend exists, the tool keeps the number it
guessed, and an answer to a trial since ended is dropped.

**Names, not geometry, for edges.** A fillet holds `e1.lid|e1.m0`, never an
index or a point. That is why it survives a rebuild, and why a cut that takes
the edge can say so instead of quietly rounding a neighbour. Rejected: matching
edges geometrically after each rebuild. The spike chose tags for faces for the
same reason, so edges follow faces.

**The kernel edge outranks the skeleton, but the press drags the skeleton.**
In a kernel body the twins are quiet: what you see is the kernel's edge. So
hover and click should land on that edge. But a lid is resized by dragging
its edge, which moves the twins. The edge pick therefore carries the entity
it was found in place of, and a press drags that entity. Two simpler rules
were rejected. "Entities always win" left a kernel edge unpickable wherever a
twin lay along it. "Kernel edges always win" took away dragging a lid. The
hidden view's suite then caught the rule being too broad: a sketch line,
only part of which bounds the body, lost its pick to the edge along that
part. Only what the kernel draws in an entity's place yields now.

**`round`, not `fillet`, for the tool.** Icon names must be a single word,
and `fillet` is taken by the sketch's corner fillet, which the regions
package is also touching. So the tool is called `round`, as in Creo. The
typed call keeps the spec's name: `fillet` given a list of edges is the
solid fillet; given two lines it is the sketch fillet, unchanged.

**Things measured and left alone.** SMLib refuses to fillet an edge that
runs into an earlier fillet at a corner, at any radius. Both edges in one
call works. I left the kernel unpatched (the pin stays) and made the
refusal say what to do. A test pins the behaviour, so the day SMLib can do
it, the test will say so. The leak is 150 kB a rebuild, and upstream has no
newer commit that might fix it. The facets show at 4× zoom; smooth shading
would remove them, but that is a renderer change, not a fillet's.

### Regions as operations: why nothing is proposed, why cells, and what was rejected

**Nothing is proposed as a hole.** Explicit regions kept the creating click's
proposal — every loop inside the outline offered as a hole, one click to take
one out — because the owner, asked, said *"do what you think is best"*. His
first sentence here is the answer to that: *"rather than auto detecting
regions + things inside that region which then get subtracted automatically,
there should be explicit specification"*. A proposal the user must notice and
undo is an automatic subtraction with an escape hatch. So a face is its
loop's whole inside, and a hole is a step someone took. The cost is real and
written down: every test that built a holed part by the proposal now says
the hole, and a user who clicked a plate with a circle in it gets a solid
plate. The region tool is the one-click way back: plate, circle, extrude.

**Rejected: keep the proposal, made explicit.** The proposal could have typed
`region` + a `subtract` per loop inside, so the chain would show what was
taken. It would still be the tool deciding; the owner's word is
"specification", and a chain written by inference is a record of the
inference.

**Cells of the named faces, not of every loop.** The first algebra took a
face's area as findLoops's containment tree gave it — the loop and every
loop under it. The explicit-regions fixture broke it at once: a circle in
the plate has the revolve's end face for its smallest container (the end
face overlaps the plate along two collinear edges), so the plate's area did
not contain the circle and the subtract did nothing. `within` (explicit
regions' own fix for the same fixture) answers by geometry, and asking it
only of the faces a region names makes the other loops irrelevant, which is
the rule anyway: a loop no step names is part of the face it lies in.
Comparing cell sets also turned out to be wrong — a cell's index names a
face, and what the cell *is* changes as faces are named — so a step that
"does nothing" is decided by area.

**Rejected: refuse to delete a face a region names.** The spec offered it.
Explicit regions had decided the same question for holes the other way —
deleting a hole's circle fills the hole and the solid stays — and a refusal
would make a region's member undeletable until its step was undone, which
no other structure here does (a relation's entity is deletable, and takes
the relation). So the region loses the face; its first face is its outline,
and going takes the region, as an outline's member takes its feature.

**Rejected: re-deriving an old file's holes in the journal text alone.**
Hole or island depends on nesting, and the journal cannot say it — and the
replay's seeds cannot either (a loop of free lines may not close until the
saved values are back). Replaying the old file twice was considered (once
as written, to read the nesting, once translated). What was built writes
each step as a hole, replays once, and corrects the op from the saved
geometry at the end: equivalent, because a replay handed its regeneration
never reads the op, and it costs nothing for a file with no islands.

**`rg`, not `r`.** The spec wrote `r1 = f3 − f5`, and both prefixes are taken:
`r1` is a relation (and `del("r1")` must mean one thing), `f3` a frame. Faces
are not stored and so have no names of their own; a row writes a face by its
members, as every refusal about loops already does.

### Mode feedback: why focus is by relation, why the chip only types, and what was rejected

**Focus by relation, not by position.** Dimming whatever lies off the plane
by coordinates was the obvious rule, and it is wrong in the square-on view a
sketch is drawn in. Every vertex of the solid behind the lid shares a pixel
with the sketch, and a corner of the far face is "near the plane" in screen
terms. `findSnap` already refuses those as places on the sketch for the
same reason. The relation that holds a thing on the plane (`onPlane`, the
`par` on a curve's normal) is what makes it part of the sketch, so that is
what chooses. The cost is visible and written down: points typed with `pt()`
under a default frame hold to nothing, and are dimmed.

**Name the face, don't store it.** Faces are not entities (sketch-on-face.md).
The work plane is three of the face's points, and the face is found again
every frame by matching those points against the features' faces in the
plane. Storing a face id was rejected for the reason faces have none: an id
would go stale under regeneration, while points follow the solid.

**The chip lives in the corner, not as a pane.** A pane would have been laid
out by the resolver and pushed about. The corner is already the region
everything-fits keeps for the status, wrapped and clipped to its room, so
the chip inherited the guarantee for free. Its one new duty is to give way
to the verdict, since a CONFLICT cut off would be the stale-readout bug
again.

**Done types.** A Done that cleared `model.workPlane` itself would be a
second meaning of ending a sketch beside the typed `workplane(null)`, with
its own undo and journal story. Through `submit` it is the typed line. For a
default frame's plane, `workplane(null)` would do nothing, so Done types
`setDefaultFrame(null)` there. Changing what `workplane(null)` means was
rejected because the default frame also governs `fix` and `xaxis()`, and
ending it should be said.

**Rejected: a mode bar across the top.** The spec's chip is three parts
beside the status, and a bar would have taken the logo's row from the panes
on a phone. **Rejected: moving the extrude, sketch and revolve lighting onto
`Tool.takes`.** It would have changed nothing on screen for a diff across
three tools. The seam exists, the fillet uses it, and a tool written at the
command line can.

### Workbenches: why each layer owns its facet of a kind, and why the manifest is read and not run

The owner asked for the framework to be *"modular and extensible (!). like
onshape workbenches"*, and for a workbench to be added *"simply by opening a
file on my device, from the menu"*. Three decisions carried most of it.

**One declaration object read by every layer was rejected.** The obvious
shape of "an entity kind declares how it is drawn, picked, looped and written"
is one object with all of that on it, handed to everyone. But the model would
then hold an object whose methods need the drawing's types, and the first
time any facet reached for `projection.ts` the layer rule would be gone in
spirit even if not in imports. So the model owns only the structure facet
(`EntityKindSpec`), and each layer above owns a registry for the one question
it asks — curveplane's frame, picking's hover line, step's writer,
projection's polyline. `defineModule` is the only thing that sees the whole
declaration, and it sits above all of them. For TypeScript, `Entity` became
`EntityTypes[keyof EntityTypes]` so a kind's own file can add itself by
declaration merging; the alternative, a catch-all `{ kind: string }` member in
the union, would have stopped every `switch (e.kind)` in the program from
narrowing.

**Point, line, circle, arc and frame stayed known by name.** Declaring them
too was the spec's wish; doing it would have meant routing every fast path in
loops, picking, faces, projection and the renderer through facets, a change
with no test that could see it and a large surface for a regression the e2e
suite might not. The ellipse was the one with a grep to pass, and it did; the
five are written up as vetoable.

**The re-cut was proved against the build before, not against itself.** The
oracle was the same e2e results failure for failure (the base branch already
had 12 failures in this environment — 10 deterministic, under the organiser
pane on an iPhone — so "green" was not available as a criterion), the same
unit tests, and every fixture saving to the same bytes under both builds. No
existing fixture had an ellipse, so one was written *by the build before* and
committed, and the ellipse's move was checked against it.

**The workbench is in the head, not the journal.** A journalled
`setWorkbench` would have made switching an undo step and put a UI choice into
the transcript of the model; the head is where `tools` already rides, and it
is a parameter of `save`, so the undo snapshot never sees it.

**The manifest is read, not run, and checked at `defineModule`.** A dry run —
evaluate the file with a recording `defineModule` to see what it would
register — was rejected: it runs the file before the person has said yes,
which is the one thing the consent is for. Reading a JSON comment runs
nothing. The check that the file does what its manifest says is made inside
the real `defineModule`, before anything is registered; code at the file's
top level outside that call has run by then, and that is said plainly (the
person consented to running it; the scope is curated, not a sandbox).

**Found by looking:** the missing-workbench offer, centred, covered the very
points it said were safe; the notice was red though it is guidance; and on a
phone the organiser's strip wrapped "organiser · Pins" and clipped it. The
offer now sits under the status, the line is ordinary, and the word
"organiser" ellipsises before the workbench's name does.

### Sketch shapes: why the ellipse is a point and a number, and the slot's tangencies are perps

**A point for the major end, not an angle.** An ellipse could have been a
centre, two semi-axes and a rotation angle. Rejected: an angle is a variable
nothing can snap to, drag or dimension against a line, and every relation
reading it would need trigonometry. With the major end a point, the major
direction is `major − centre` and every relation is `dot` — so `onellipse`
and `tan(line, e)` came out the same in 2D and 3D, and the ellipse drags,
snaps and `coin`s like a circle's rim point. The minor is a plain variable
because nothing else gives it a place to be: a second point would need a
relation to keep it square to the major axis, which is an equation the
entity would carry, and this codebase keeps those in relations. The normal
is straightened against the major axis for the same reason a frame's y-ref
is: so a free ellipse is always well defined, with no relation holding the
major end in the plane.

**`onellipse` is a distance, not the implicit form.** `(x/a)² + (y/b)² − 1`
is not a square, and its gradient on the curve is not zero — but its scale
is a pure number that shrinks with the ellipse, so least squares would
weigh a big ellipse's points less than a small one's. Squashing the major
axis by `b/a` turns the question into `onCircle`'s, a length.

**The slot's tangencies are `perp`.** The spec said each line `tan` to both
arcs, as the fillet does. Built that way, the Jacobian at the solution was
four short of full rank (nine freedoms by rank, for a shape with five): a
side whose end is already on its arc meets it to second order, so `tan`'s
distance-minus-radius is `r(1 − sin φ)`, a square in the angle off tangency
— the CLAUDE.md rule, in disguise. Both versions solved a width dimension;
the difference is what a rank check sees, and `sketch-relations.md` is about
to build one. `perp(centre, end, side)` says the same tangency linearly.
Not changed in the fillet, which has the same flaw (measured: two extra
freedoms) — a change to an operation every old file replays is its own
package (TODO.md).

**The inscribed polygon has two circles.** Rejected, by dragging corners far
off in steps for n = 3 … 8: one circle tangent to every side with equal sides
(folds for n ≥ 4 — equal tangent sides can rock, a rhombus does); tangent
sides with corners on an outer circle and no `eq` (a side collapsed at 8);
spokes of equal length (folded at 8). Equal sides are what stop a fold, so
the inscribed polygon is the circumscribed one plus an inner circle touching
one side, and costs one equation for its one radius.

**No elliptic arc.** A region bounded by part of an ellipse is found
(loops.ts cuts an ellipse at crossings and Ts, as Onshape does), but
extruding it would need a twin that is part of an ellipse, and there is no
such entity. Adding one would be a third curve kind; refusing by name keeps
the found regions honest and the solids correct.

### Sketch relations: why the rank is asked per component, and why `tan` changed

The owner asked for *"strict rule enforcement"*: say what is free and what
conflicts. The solver already had the Jacobian; what it lacked was a rank.

**Rejected: an SVD, or any dense factorisation of the whole matrix.** Exact
and simple, and cubic in the drawing — a hundred rectangles would be a
second. Sketches are mostly separate pieces (a frame is a datum, so it joins
nothing), so the matrix is split into connected components first and each is
eliminated densely. Gaussian elimination with row pivoting, columns in
order, rank relative to each column's own norm: not as rank-revealing as QR
with column pivoting in theory, and in practice the Jacobians here are well
scaled per column, and keeping columns in order is what gives "redundant" a
useful meaning (the later relation is the one named).

**Rejected: calling every row in the left null space's support redundant.**
Tried in the head before writing it: a 3D arc drawn by the tool has an
`onplane` end and an `oncircle` plane row saying the same thing, so every
arc would have been orange. "Every row implied by the rows before it" names
only a relation that says nothing new, and only the later one.

**The z gauge** is the one judgement in it. Points drawn on the ground in a
fresh document hold nothing in z, truly; the solver never moves them; and an
Onshape user calls a fully dimensioned sketch fully defined. Counting z would
have left every drawing "free" forever and made the ink useless, so a point
lying on the drawing plane or the ground is not counted free off it. Written
down as vetoable.

**`tan` changed because the analysis found it.** The first unit test of a
tangent join failed at 2e-7 residual and a point 0.002 off — the distance
form at a shared end is a double root. That had always been true (an old
fixture's fillet was 1.8e-3 short) and nothing had noticed, because the solve
still called it solved. The join form fixes both the accuracy and the
diagnosis; the old-file test now expects the exact points, and says why.

**The status.** Putting `3 free` inside `#status` would have broken every
test that reads `SOLVED` exactly, and more to the point mixed a verdict with
a description, so the diagnosis is its own span beside it — which is also
what lets its names be buttons inside a corner that takes no pointer events.

### Toolbar groups: why the flyout replaces a grouped button's tooltip, and is not a panel

The owner wants the usual sketch tools, and everything to fit; a family
sharing a button is how every CAD program does both. Three choices were
not obvious from the spec.

**The tooltip.** A plain button shows its tooltip on a hover or a hold —
exactly the gestures the spec gives the flyout. Showing both put the tip
where the flyout goes (beside a column, on the drawing's side) and raced two
timers at 400 and 500 ms. Rejected: delaying the flyout behind the tip (a
mouse would wait twice), and placing the tip on the far side (there is no
far side for a tray against the left edge). So once a group has two members
its button opens the flyout instead, and each item carries the tooltip a
button would have. A group of one keeps its button's tooltip.

**Not a layout panel.** The flyout could have been a pane in `Panels`, pushed
and pushing like the options panel. Rejected: it lives for a second, and a
pane that appears pushes the log and the organiser out of the way and back
again each time it opens — the chrome jumping under the finger mid-gesture.
It is placed instead by a pure function over the panes' rectangles, and
keeps off them (slid along the tray) rather than moving them; the device
table proves a clear place exists on every phone.

**The table beats nothing, the class beats the table.** The spec has a
table for built-ins and `static group` for command-line tools. A class that
declares a group, or `null`, means it: a redefined `slot` that wants its own
button can have one. Reading the table first would make that impossible.

### Solids on SMLib: what the kernel draws, what stays relational, and why Cut waits to be asked

The spike settled which kernel. This package settled where the kernel sits
against a model that was already relational: one where a lid's edge is a
solved line that a constraint can hold. Most of the decisions are about
which side of that line each thing falls on. Here is the reasoning the diff
does not show.

**The twins stay.** The spike recommended deriving an extrude's lid lines and
walls from the kernel once booleans exist. *Rejected* for three reasons:
- every old file with a constraint on a lid edge would have lost it;
- the first frame of a dimension drag would have waited on a Worker round
  trip;
- the depth dimension holds a twin, so deriving the twin means deriving the
  dimension's target.

The cost of keeping them is that the twins describe a lid the kernel may have
cut away. So in a kernel body they are *quiet* in every view, not only the
shaded one. The kernel draws what the body is, and the twins are what the
dimensions hold. Like any quiet entity they show when the hand is on them.

**A one-feature body is not the kernel's.** *Rejected: drawing everything
from the kernel.* It would have made every old file's picture depend on a
4 MB download and a Worker. It would also have put a round trip between every
drag frame and its picture, on the shapes that need no boolean at all. The
hybrid has a seam: a body changes renderer when its second feature arrives.
That seam is invisible because the kernel's faces are converted into
`faces.ts` faces, so the face layer, the painter's and the occlusion answer
cannot tell which kernel built what they draw.

**Cut is never a default.** Onshape defaults to Add where a profile lies on a
body, and so does this. The spec suggested a negative depth into a body might
default to Cut. *Rejected*: a default that removes material the user meant to
add is the worse mistake, and it is silent. Adding material the user meant
to remove is at least visible. So the dialog *offers* Cut: it is outlined,
and the log says *this runs into e1 — choose Cut*. For the same reason the
mode is never remembered: a cut chosen for one hole is not the next
feature's.

**The mode is decided once, at the call.** It is journalled resolved, as an
extrude's frame is. *Rejected: re-deciding at every evaluation.* Dragging a
boss's profile off the plate would then quietly turn it into a separate
body, and a replay would need geometry to read its own file. Insideness is
closed-form (`modes.ts`), so the default is the same before the kernel loads,
in a unit test, and on a phone that never loads it. `new` is journalled as no
options at all, so a file with no booleans is byte for byte the file it was.

**`into` is not a name.** A feature's record lists the names it depends on,
and deleting one of them deletes the feature. *Rejected* for `into`: deleting
a plate would have deleted every boss on it. Instead an add whose target is
gone becomes a body of its own, a cut whose target is gone is left out, and
the log says both.

**No timeline.** A feature can only name a body that existed when it was
made, so creation order is already a dependency order. A body's chain is its
features in that order. *Rejected: a reorderable feature list.* Nothing asked
for one, and reordering is what makes a timeline's names unstable.

**Idle is read off the tags.** A rebuild measured 245 ms for the owner's
part, and 142 ms of it was SMLib integrating volumes. It did that four times
a node: to tell a sheet from a solid, and an idle cut from a real one. A sheet
is told by the manifold test alone. A cut that reached nothing leaves no face
carrying its tag, because the kernel carries tags onto every surviving piece
of a face. The volume is now integrated once, for the answer, and a rebuild
takes 118 ms.

**STEP surfaces by tag, not by recognition.** The spike's TODO was to
*recognise* analytic surfaces in SMLib's B-splines. *Rejected*: fitting a
cylinder to a B-spline is a guess with a tolerance. The face's tag already
says which feature and role made it, and that feature's data says exactly
which plane, cylinder, cone or torus it lies on (`roleSurface`). Only faces
no role names, and intersection edges, are the kernel's B-splines.
- Those edges sit about 3·10⁻⁶ off OpenCascade's own intersection of the same
  surfaces, so a file that has them declares 10⁻⁵ uncertainty. *Rejected:
  writing pcurves.* It is a larger job, and every reader healed without them.
- A cylinder's seam, which a boolean can cross, is split into halves, as
  step-export.md already did for a whole revolve.
- The one strict-read failure (a full revolve drilled across its seam) is
  documented and pinned by a test, not hidden.

**Merging with the curve tools.** The parallel package taught the tool
options a word, `method`, at the same time as this one taught them `mode`.
Theirs merged first, so theirs is the shape: `choices` is a record of word to
label. Two flags were added on top:
- `buttons`: four short words and an outlined offer want a row of buttons a
  finger hits in one tap, where a method's long words want a drop-down;
- `remember: false`, explained above.

### One circle, one arc: what a press means, and where the reading goes

The owner asked why there were four curve tools when they all make the same
two entities. The answer is that they differed only in which constraints the
clicks wrote, so the clicks are now read for it. Four decisions needed
reasons.

**A press is undecided until it moves or lifts, and a click acts on the
press.** The spec's first click is "a provisional centre-or-rim point", and
only what comes next can say which. The commit timing kept each old tool's
own: the 3-point tools and the centre-point arc acted on the press, and the
drag-out circle on the release. A press that gets another press before any
release counts as a click. That one rule is why every old test and script
that only ever sent presses still draws. *Rejected*: deciding every click on
its release. That would also have worked in the app, but it would have meant
rewriting every click-only test to say the same thing differently, and the
fixtures written by the old build would no longer have shown that nothing
was lost.

**"Hold still" is a click, not a timer.** On a phone a held finger is the
context menu (`LONG_PRESS_MS`), and the recogniser hands the tool nothing
until it has decided. A timed hold on the mouse that a finger could not make
would give the two hands different tools. *Rejected*: a hold shorter than
the long-press, between 350 and 500 ms, which no hand can be relied on to
hit.

**The reading goes inside the drop-down.** A label beside the choice was
built first. In the screenshot, "centre · radius" was cut to "centre …", and
on the phone "auto: centre · radius" was cut too. The drop-down now fills
the row. Its first option is hidden from the list and shows what was read,
lit in amber, so the list underneath is still only the locks. *Rejected*:
widening the options panel, which every layout's arithmetic on every phone
depends on (`fits.test.ts`), for one row.

**The alias's lock is not remembered.** The spec says the lock is
"remembered like any option", and it is, when chosen in the panel or typed
by name. But someone who types `circle3` once would otherwise find that the
Circle button's drag no longer draws, with nothing to say why unless they
look at the panel. So `circle3` is a shortcut for one use, and the button
stays as they left it.

**The tangent preview is a fit, not a closed form.** The circle through two
points tangent to a line has a closed form, and so does each other mix of
points, lines and circles. Writing all of them out, each with its own
degenerate cases, would be a lot of code, used only for the preview. A
three-unknown damped Newton from the circumcircle, keeping each condition on
the side the clicks are on, covers every mix in forty lines. It either lands
within a millionth of the drawing's size or reports that it did not, and
then the preview is blank and the click is answered with guidance. The
relations and the solver are what hold the result; the fit only makes the
preview honest and starts the solver at the answer.

### The solid-kernel spike: why SMLib, and why the others lost

The owner can make nothing but extrusions because nothing joins or cuts
solids. The spec ranked the options SMLib, then OpenCascade, then our own,
and asked for numbers. The reasoning that was not obvious:

**Build it, don't borrow it.** A community wasm build of SMLib exists, but a
kernel we cannot rebuild is one we cannot patch, and the first thing the
spike found (a fillet that leaks) is the kind of thing we will need to patch
or bisect. Upstream's build system (premake plus Packman, NVIDIA's package
server) fetches TBB and OpenUSD, and the geometry uses neither. So the recipe
compiles the two source directories directly. It got three things wrong on
the way, each of which looked like it should work:
- SMLib *throws* (only `bad_alloc`, from its allocator), so `-fno-exceptions`
  will not compile;
- both directories have a `StdAfx.h`, and the wrong one compiles silently for
  all but one file;
- success is status 1000.

**Why exceptions matter for the phone.** The build keeps Emscripten's default
of *throws abort, nothing catches*. That is only correct because SMLib catches
nothing, which was checked with grep rather than assumed. It also means the
module needs no wasm exception-handling proposal, which an OpenCascade build
does need, and which older iOS Safari lacks.

**Identity is the question that could have sunk it.** A relational model
holds names: a sketch on `F3.lid`, a constraint to `F3.m2|F3.lid`. The first
design considered was matching faces geometrically after each rebuild
(nearest centroid, same surface kind). *Rejected:* it guesses, and it guesses
wrong when a dimension moves a face past another. The kernel's own history is
better. SMLib's form of history is *attributes that propagate on split and
merge*, so a tag set once at the sweep is carried by the kernel. The
measurements show where that is not the whole answer:
- a merged face keeps one tag, so the other feature's face name disappears;
- a shell copies a tag onto both walls, so the caller has to say which wall
  is the offset;
- a fillet's new faces have no tag, and are named by the faces they blend.

Those are rules the naming layer above the kernel owns, so they do not count
against the kernel.

**The tags are found from geometry, never from the kernel's face order.**
Which member a wall came from is asked of where the wall is. *Rejected:*
trusting `GetFaces()` order, which nothing documents as stable.

**Why the losers lost.**
- **OpenCascade** is the more complete kernel (STEP, loft, draft) and the
  more proven one. But it is 4.3 times the download (5.0 MB against 1.16 MB
  brotli), it needs wasm exception handling, and LGPL-2.1 makes us ship it in
  a form the user can relink. It also could not be run here: the session's
  policy refused to execute a prebuilt package, and that was not worked
  around. So "lost" means "not needed, given that SMLib passed everything we
  asked", not "measured worse". If SMLib fails a larger corpus, OpenCascade
  is the fallback, and the kernel-neutral contract (`src/kernel.ts`) is
  written so that it can be measured on the same parts.
- **Our own kernel** was never in contention once SMLib passed both coplanar
  cases. Robust booleans and blends are where every kernel spent its decades.
- **The Rust kernels** (truck and others) would sit nicely in our crate, but
  their robustness claims are self-reported, and they were not built: the
  first candidate passed, and the spec ranked them below OpenCascade.

**What was deliberately left.** These are documented in the Findings rather
than fixed:
- the leak, which is upstream's and pinned by a test;
- arc walls and revolve faces coming back as general NURBS or surfaces of
  revolution rather than cylinders, cones and tori (the STEP exporter's
  problem to recognise);
- the cost of tagging by area and interior point, which a product would take
  from the sweep's own face lists.

### STEP export: a validator that could not fail, and what replaced it

The owner asked for STEP export. The spec's hard line was that a file that
"looks right" and fails to import is worse than none, so the acceptance test
was a real kernel: OpenCascade, installed from PyPI (cadquery-ocp 8.0.1.1.0,
OCCT 8.0.1) in the session's scratch directory, never a dependency.

**The first validator passed everything, including what it should not
have.** Reading each file the way an application does — `STEPControl_Reader`,
transfer, `BRepCheck_Analyzer`, volume — every part came back valid, volume to
1e-15. Before believing that, the validator was given files broken on
purpose: one face's `same_sense` flipped, every face flipped (a solid inside
out), one oriented edge reversed, a vertex moved 0.01 mm. All four came back
valid with the right volume. OpenCascade's reader heals shapes after
translating them (ShapeFix: face orientation, wire order, tolerances), which
is right for an application and useless for a test of the file. So the
validator that was going to be reported was one that could not fail on the
errors most likely in a hand-written B-rep.

**The strict read.** The fix was to translate each solid straight from its
entities with `StepToTopoDS_Builder` and skip the healing. Then *every* curved
part failed, which could have been the exporter, and was not: OpenCascade's
own STEP output of a cylinder, torus and sphere passed the same read because
it carries pcurves (each edge's 2D curve on each face), and ZeroCAD's does
not. Without them the raw translator leaves curved faces with none; computing
them is the part of healing every reader needs. So the strict read allows
exactly that — compute the missing pcurves, shift them by whole periods, add
the zero-length edge OpenCascade wants at a pole — and nothing that moves a
vertex, reverses anything or reorders a loop. Re-run on the broken files it
rejects all four (and an open shell); on the fixtures it accepts all of them.
Both reads are recorded in `validated.json`.

**Rejected: writing pcurves.** They would make the raw read pass without the
allowed repairs, and some readers prefer them. But they are a second
description of every edge, in another space, which a reader may trust over
the 3D one; a wrong pcurve is worse than none, and every reader computes them.
Left as a limitation, in TODO.md.

**Rejected: AP242.** It carries the same solid entities. What it adds (PMI,
tessellation, newer product data) ZeroCAD has none of, and what it costs is
readers: every AP242 reader reads AP214, not the other way round.

**Rejected: a circle as one closed edge.** Every major kernel reads a
periodic face bounded by a seam edge it uses twice, but that is where readers
are known to differ, and two half circles cost one vertex and one edge each.
It also keeps "every edge in two faces, once each way" an exceptionless rule,
which is what the in-repo test asserts. The full revolve followed: two half
turns rather than one face round a seam.

**Found on the way:** a full revolve of a profile with a hole is a solid with
a *cavity*, which needs `BREP_WITH_VOIDS` — the spec did not mention it. Its
orientation convention was settled by writing a box with a cavity out of
OpenCascade and reading how it spells one (the cavity's shell facing out of
it, flagged `.F.`), rather than from memory of Part 42; ZeroCAD's first
spelling (facing in, `.T.`) means the same and OpenCascade read it the same,
but the convention readers are tested against is the one their most common
writer uses. And a mistyped Gauss–Legendre weight made every volume 2e-8 too
large; the closed forms in the unit test caught it before any kernel did.

### Frameless curves: what a normal is, where the origin lives, and what a click lands on

The owner asked twice why drawing a circle made a frame. The answer had been
"a 3D circle needs an orientation, and the orientation was a frame". The
change gives a curve its own and makes one origin always present; four
decisions needed reasons.

**The normal is three variables read normalised.** The spec offered a unit
vector held by a normalisation residual, or two angles. *Rejected, the
residual*: it is an equation the entity carries, and this codebase keeps
equations in relations, where they can be seen and deleted — a hidden
`|n| − 1` would be the only one. *Rejected, the angles*: a circle facing
straight up, the commonest one, sits at their pole, where the azimuth's
gradient vanishes. Reading the three numbers through `v/|v|` makes every
residual scale-free, so the length has exactly zero gradient: nothing can
shrink a normal to satisfy a relation (the 14 % a raw frame arm once lost),
and the damped solve leaves the length where it was seeded. The cost is one
null direction of the Jacobian per curve, which the LM damping handles as it
handles every unconstrained direction.

**The origin is built in, not journalled.** A journalled origin would have to
be written into every old file on open and could be deleted, undone or
renamed. Built in, it is the kernel's axes given a name: `Model.has` claims
the name, `frameBasis` returns a constant, and nothing in a file mentions it
unless a relation is written against it. The one wrinkle is an old file that
already called something `origin`; it is renamed `origin2` on open rather
than refused or confused. *Rejected*: making the origin the default frame —
then `setDefaultFrame(null)` would mean something new, and the default
frame's heavier marker would be on every document.

**The hold is two relations, and the ground holds only curves.** A curve drawn
on a plane gets `onPlane` on its centre and `par` on its normal, so "just put
the circle there" is exactly what is in the relation list. Points the other
tools place on the bare ground stay unheld, as they were when no frame was
the default: holding a fresh rectangle's corners on the ground would make
every fresh sketch a constrained one and change what dragging does.
*Rejected*: not holding a ground circle at all — the spec asks for the
relations, and a circle that drifts off the ground the first time something
pulls its rim is a worse surprise than a `par` you can delete.

**Chosen planes win over the face under the cursor.** With a work plane set
(or a default frame), the curve tools draw on it even over a solid's face;
only with no plane chosen does the face under the first click decide. A
sketch on a face that the next click silently abandoned for a neighbouring
face would be the bug. A face is three of its own points (`sketchFrameFor`'s
choice, facing the viewer), so the curve follows the solid when it changes,
and the cascade clears it when the solid goes.

**Old files keep their frames and gain pars at the end.** A curve that named a
frame keeps the frame's normal, sign and all (an arc's sweep depends on it),
and a `par(curve, "f.z")` is appended after the whole journal rather than
beside the curve, so no relation already in the file is renamed (`r7` stays
`r7`). Fixtures written by the format-12 build, not assertions about the
translation, are the proof. A lifted 2D file used to get a frame called
`plane` for its circles; the origin is that plane, so that frame is no longer
made — the one place an old file opens with fewer entities than it did.

**Extrude from a curve's plane that faces away.** A circle's plane cannot be
turned over, so sketching on a cylinder's base gives a work plane facing into
the solid; `orientingPlane` then takes the loop's own plane facing the
viewer, so a positive depth still comes out at you.

**The origin's label and the empty-canvas words.** Both were found by looking
at the fresh-document picture, not by a number: the words ran across the
triad and its "origin" label. The label is drawn now only when the origin is
lit or selected — a triad at zero says what it is, and the label also printed
over the first corner drawn at the origin — and the words moved below the
middle. *Rejected*: moving the fresh view so the origin is off-centre, which
would have shifted every e2e test's screen arithmetic for a cosmetic reason.

### Everything fits: where the second row comes from, and what "the logo's row" is

The owner chose a second row over a fold, and the organiser shown from the
start. Three decisions were not in his answers.

**What a tray's room is.** "One line when it fits along its edge" could mean
the free stretch of the edge it lies on, which is what a landscape default
wants — the tray shares the bottom with a column of panes. But that room
changes as the tray is dragged past other panes, so a tray would wrap and
unwrap on the way, which reads as the pushing rules breaking. So the room is
the area's alone (less the logo's corner), and a default may ask for more
lines than the room forces (`Placed.lines`): the landscape default asks for
the lines that fit beside its column. A tray the viewer moves keeps what it
asked for until it turns; forgetting it at release would unwrap the row on
the next layout and push its neighbours across the screen.

**Why a right-hand column in landscape.** A landscape phone is short. The
old layout put the command line across the top beside the logo and the tray
along the whole bottom, which left the organiser 150 px under the log and
the status over the command line's strip. Putting the strip, the log and the
organiser down the right edge gives the organiser the height, and the tray
two rows of seven on the left — the owner's second row, arrived at because
the line does not fit beside the column, not because a rule says "two".

**What "the logo's row" means.** Kept wholly empty, landscape loses 44 px it
does not have; so the region no default pane enters is the corner's box —
the logo and 120 px (at 100 %) for the status — and the status wraps inside
whatever room the panes leave it. In portrait the defaults leave the whole
row empty anyway. Rejected: making the corner a fixed panel the others are
pushed out of, which would stop a tray turning against the top edge on a
desktop, and the desktop is to stay as it is.

**Rejected: keeping the organiser over the middle.** Its old phone place,
under the log at the right edge, lay over the touch suite's rectangle — the
reason it started hidden. Shown from the start, it has to live in the top
third (portrait) or the right-hand column (landscape); at 40 % of the height
it still covered a corner the suite draws, measured, so it is a third.

### Tooltips and RGB frames: what a hold means, and which red

The owner asked for a tooltip on hover and for frames coloured like
SolidWorks'. Neither needed new machinery; three things needed a decision.

**A hold under a finger.** A phone has no hover, so the tooltip comes from a
hold — the canvas recogniser's 500 ms, so a hold means one thing everywhere.
The question was what the lift after it does. If it pressed the button, a
person who held a button to find out what it does would have done it; so the
click after a hold that showed the tip is swallowed, and a tap — which
nothing here times — presses as it always did. The organiser already had a
hold on its rows (the row's menu), and its eye sits inside a row, so a hold
on a row's button is now the button's tooltip and not the row's menu: one
hold, one answer. The rows keep a tooltip for the mouse only.

**Where the words live.** The spec said each tool declares a summary; the
open question was how. A `static summary` is the shape `static options`
already has and a command-line tool can write. But the icons were put in a
table by name because a static is inherited, and a `class extends CircleTool`
registered as "stamp" saying it draws a circle is the same guess; so the
summary is read from the class's own property only. *Rejected:* a table like
the icons' — a tool defined at the command line could not then declare one.
`panels.ts` stays ignorant of the tools: `main.ts` hands it `toolSummary`.
The tooltip module is the one thing it imports, and the test that held it to
no imports holds `tooltip.ts` to none instead.

**Which red.** The pure primaries fail on this ground: pure blue is 2.3 : 1
on `#0a0e13`. Lightened inks read, but the hidden view dims an edge by mixing
it toward the faces' slate shadow, which has more blue than green; a red
whose green and blue are level comes out pinkish. So the red leans to
vermilion (`#ee6040`) and keeps its channel order dimmed. The green is far
lighter than the red (luminance 0.51 against 0.27), which is what a red–green
colour-blind eye has left to tell them by, with the letters. The default
frame used to be the lighter grey; with the inks saying which axis is which,
it is told by weight. *Rejected:* a hue-preserving dim for the arms alone —
the hidden view's rule is one ink per depth for every edge, and the measured
inks already keep their hue under it.

### The organiser: what an open group is, and the two places it was not obvious

The owner asked for a pane and for groups that can be "opened" so that what is
drawn joins them. Most of it follows from groups.md without a decision: a pane
that reads the model and types commands, like every other piece of chrome.
Three things did need one.

**Where the joining happens.** The open group could have been an `addTo`
journalled after each creation, or a membership worked out on replay from
when each entity appeared. Both re-infer. Instead every constructor puts its
entity through one door, `Model.place`, which adds it to the open group if one
is open — so the joining is part of the constructor's own entry, and a replay,
which reopens the group at its step, makes the same membership by running the
same code. Five `entities.set` calls became one method; nothing that makes an
entity can forget the open group, including an auto-made endpoint, a fillet's
tangent points and an extrude's twins.

**Regeneration.** A fillet on an extruded sketch rebuilds the solid, making a
twin arc, its ends and walls. The spec recommended they "join the groups the
entity they twin was in"; I traced it through and it files the lid's new arc
with the *sketch* (the arc it twins is a sketch member), so hiding the sketch
after extruding — the use groups.md gives for groups — would leave a hole in
the solid's edges. Joining the open group is wrong for the same reason when
the sketch's group is the open one, as it naturally is while filleting. The
rule taken: the new pieces join every group that held all the entities the
feature had made, read before the rebuild. A group that held the solid still
holds it; one holding a single edge does not suddenly hold the new arc.
*Rejected:* the union of the groups of what the feature made (one edge in a
group would pull every new piece in); the twinned entity's groups (above).

**The empty group and old files.** A group made to be drawn into starts
empty, so "a group is never empty" had to go. The only journals that could
rely on the old rule are ones that used an emptied group's name again; none
is in the repository, but a file from the groups build could be. I bumped
the format to 12 and, for an older file, write the silent `ungroup` in after
each emptying `removeFrom` on the way in. The spec suggested a marker, as old
extrudes carry; a marker is right when re-expanding would shift names, and an
`ungroup` shifts none, so translation (the `horizontal` precedent) leaves a
re-saved file speaking today's vocabulary. Correcting groups.md on the way:
it said the emptied group's going was journalled in the deletion's
expansion; only the `removeFrom` was.

**Where the pane goes.** First top right. The full e2e run said otherwise: 31
failures, every one a click or a drag that now landed on the pane — top right
is where the suites park their "empty canvas" and where the tray goes when it
is pushed along the top. Bottom right, level with the log, cost one suite (a
drag to that corner) and one pixel sample. On a phone no corner is free: the
touch suite draws in the middle, and the pane in either orientation covers a
third of what is left. So a phone starts with it hidden, a tick away in the
app menu, and the panel manager learnt `hiddenAtFirst`. Vetoable, and said so
in the register.

### Select and the Hand: a state given a button, and a press read differently

The owner: *"there is no hand/selction tool. would be nice since a lot of
people are used to that"*. Neither is new behaviour so much as a name for
something: "nothing armed" always was selection, and panning always existed
on the middle button and two fingers. The design question was where each
lives.

**Not as registry tools.** The first idea was `defineTool("hand", HandTool)`,
so the button would come for free. Rejected: a Tool is handed world
coordinates and no camera, so it cannot pan without a new door in
`ToolContext`; and the Hand's tap has to select, which is the engine's
selection, reached only on the no-tool path. A HandTool would have needed
both doors opened, for one tool. So the engine answers `arm("select")` and
`arm("hand")` itself (`putDown`), `listTools()` is unchanged, the toolbar
asks `toolbarTools()`, and `defineTool` refuses the two names — a class
registered as "hand" could never be armed, and should not be accepted
silently. `ToolEngine.lit` is one answer to "which button", read by the
toolbar, so Select being lit and `engine.active === null` cannot disagree.

**Space as an overlay, not a disarm.** The obvious reading of "released, the
previous tool is back" is: remember the tool, arm the Hand, re-arm the tool
on release. Rejected: a tool put down and armed again is a fresh instance,
and a fresh instance has no gesture — a rectangle's first corner and an
extrude's picks would both be gone. `hold(true)` instead only changes how the next press is read;
the tool never leaves, so there is nothing to bring back.

**What the extra buttons cost on a phone.** Two more at a finger's 44 px
pitch are 88 px of column. The screenshot (looked at, not measured — the
numbers said nothing, because a window too small for the resolver switches
the overlap check off) showed the column drawn over an edge-to-edge command
line in Safari's 664 px page. Fixed at the default: the line starts right
of the column where the column would reach it. In landscape a 13-button row
on the right edge leaves less than a log's least width beside it; that is
left as a limitation, since the owner vetoed wrapping the tray.

### No title bar: what "huge" was, where the 60 pt went, and a blur nobody documents

The owner tried 0.1.0 on his iPhone: no title bar, a tiny logo that opens
settings, an interface "huge" on his screen, and a command line that would not
go to the bottom. Three amendments followed the same day (a dropdown with a
spin box and pane boxes; docking kept through a rotation; each device's own
100 %), and the manager added the status bar's blur.

**The 60 pt.** Chromium's emulation, with iOS's real insets set through CDP,
showed only 34 of it — `#viewwrap` was inset from the home indicator, so a
panel stopped at that inset's edge. The rest only WebKit does, so it was read
off the owner's screenshot: it is a 440×956 pt phone with a 62 pt top inset,
and the empty-canvas hint (centred on the canvas, so a ruler) puts the
canvas's bottom at 860 pt. `#app`, at `100dvh`, was the screen less the top
inset. Fixed at the cause — `#app` by its four edges — and the drawing now
runs under both insets, a panel touching one reaching under it with its
content padded clear, as iOS's toolbars do. Rejected: keeping the drawing
inset and only letting the command line overhang; every panel touching an
edge has the same problem, and the rule is one function (`bleed`) that the
push geometry never sees.

**"Huge" was drawn size equal to hit size.** The first build shrank a
finger's chrome to 70 % — 31 px buttons — which the owner's next message
undid: work it out per device and call that 100 %. The real fault was that a
finger's controls were *drawn* at their 44 px target. Now they are drawn at
the interface size and answer a press over 44 px (a `::before` round each
face, rows a target tall). One cost was not avoidable: a tray's buttons must
be a target apart for their hit boxes not to overlap, so the slim column is
as long as the old one. Shorter would have meant two buttons claiming the
same touch. And a strip's hit box has to reach somewhere: outward, over the
drawing, because inward it would take the log's scrolling and the command
line's field. That reach was then measured taking a drag that began on the
status, so the portrait log moved down.

**Each device's 100 %** is form factor × text size. 1.3 for a phone is
Apple's own ratio — 17 pt body text on iOS, 13 on macOS. The amendment said
to read Dynamic Type through `-apple-system-body` "in Safari"; WebKit's bug
tracker shows macOS Safari has the keyword at a fixed 13 px and WebKit
declining to change it, so it is read only under a coarse pointer — otherwise
every Mac would shrink by a quarter. The fallback reads `font-size: medium`,
because the page's root font is the stylesheet's 13 px, not the person's.

**Docking.** Pixel positions cannot survive a rotation, so a moved pane is
stored as what each side rests against, recorded when a gesture ends and
re-laid on every resize. Re-recording on resize was rejected: a rotation that
pushed a pane off its edge would then forget the edge, and turning the phone
back would not restore it.

**The blur.** The owner: *"in PWA mode on iPhone, there is some blending at
the top of the screen which is annoying."* Several projects report the same
since iOS 26.1: a home-screen app whose status bar is `black-translucent`
gets Liquid Glass's scroll-edge blur over its top; a Glide community thread
calls it a regression. **Apple has published nothing about it**, and nothing
here could run iOS 26, so this is the consensus fix, not a verified one: the
style is `default`, the page starts below a solid bar in `theme-color` (now
the drawing's ground), and there is nothing beneath it to blur. iOS reads the
style when the app is added, so the owner has to re-add the icon. The
top-edge `bleed` stays for Safari, which still has a top inset.

### Files: what each platform really allows, and three decisions it forced

The owner asked to open and share files on his iPhone and on a desktop. The
spec set out what each platform allows and asked for every claim to be
checked; most held, and the ones that did not changed the code, not only the
notes.

**Chromium will not share a `.json` file, and does not say so up front.**
`canShare({ files })` in Blink checks only that there is something to share;
the type check is in the browser process, against a fixed list (audio,
images, PDF, video, plain text, CSV, CSS, HTML) that has no JSON. So
"share when `canShare` says yes, else download" would have shown a Windows
or Mac Chrome user a "Permission denied" for every share. Any refusal that is
not the person's cancel now downloads, and says so. Rejected: sharing as
`text/plain` with a `.txt` name — it would pass, and arrive as a file that
no longer opens as a drawing anywhere that goes by extension.

**The unsaved-changes question moved to after the choice.** Asking before the
picker, as the spec had it, puts a `confirm` between the press and the
picker; pickers need the press's transient activation, which in Chromium and
Firefox is a few seconds, so a person who read the question carefully would
get a picker that silently never opened. Asking after the file is chosen
loses nothing (nothing has been replaced yet) and the question can name the
file. `newFile()` has no picker, so it asks first.

**Saving through the share sheet is a finger's only.** On an iPhone the
sheet's Save to Files is the only save there is. Desktop Safari can share
files too — the spec said it could not — but its sheet is Mail, Messages,
AirDrop and Notes, so a desktop Safari user pressing Save would never get a
file. There a download is the save; `shareFile()` still uses the sheet.

**IndexedDB for the autosave, not local storage.** Local storage's few
megabytes are per origin, and the origin, `brothercreamy.github.io`, is
every site the account publishes; it is synchronous on the main thread, and
the autosave writes the whole drawing after every change. IndexedDB costs an
await at start, which `main()` already has for the kernel, and it can store
a Chromium file handle, so a restart does not forget which file Save writes
to.

**`document()` is not a command.** It was, briefly, and the repl's own test
that `document` does not resolve in the scope failed — rightly: the command
line deliberately cannot reach the page, and a `document` there would read as
the page's. The menu reads it from the host, which is what the seam asked
for.

**A drawing that will not restore is kept, at a cost.** If the stored drawing
is from a newer build, starting empty and autosaving over it would destroy
the only copy. So autosave pauses until the person replaces the document on
purpose; the cost is that work drawn in that session is not autosaved, and
the log says so. Moving the refused copy aside and carrying on was
considered and rejected: the newer build would then restore the older
session's drawing and leave its own unreachable.

### 0.1.0: a public home, a new name, and what the rename leaves alone

**The move.** The owner wanted the app hosted and installable, which on the
free plan means a public repository, and asked that nothing public carry his
personal identity. The history was therefore carried into a fresh public
repository, `BrotherCreamy/zerocad`, with author identities rewritten to
noreply addresses; every branch's files were checked identical apart from two
lines that had named him, and the rewrite is deterministic, so later syncs
arrive as ordinary pushes. Rejected: making this repository public after a
rewrite — GitHub keeps every pull request's commits reachable whatever the
branches say, and only GitHub Support can purge them.

**The rename.** The owner chose ZeroCAD from several rounds of names (three
meanings, all true: residuals driven to zero, zero install, zero hierarchy).
Everything a person sees was renamed. The internal code name was kept where a
rename has a cost and no visible benefit: the saved-file tag `"neocad-model"`
(every file saved so far would stop opening), the browser-storage keys (every
saved layout and remembered option would be lost), and identifiers in the
code. The one place the old name had to be handled, not just kept, is the
offline cache: a service worker deletes only caches under its own prefix, so
the renamed worker deletes `neocad-` caches as well as its own old ones.

### Explicit regions: a feature keeps the holes you said

**What was wrong.** A feature already recorded its loops — the outline, then
every loop inside it — and the journal carried them resolved, so a file never
re-inferred anything. The inference was in one place, regeneration:
`refoundProfile` found the outline and then took every loop inside it. So a
circle drawn inside an extruded outline yesterday became a hole the moment
anything regenerated the extrude — a `regen`, a fillet on a corner — because
it was coplanar and inside. The owner: *"there should be some kind of
relationship between the loops > region > extrude"*, and then *"I don't think
coplanarity should be used as an automatic basis for deciding which entities
to include in a region."*

**Rejected: live binding — the region follows whatever is inside the
outline.** It was the design under discussion when construction geometry was
specced (construction.md calls it "region binding"), and it is what
regeneration already half did: a feature would always be its outline with
every loop now inside it, so drawing a circle in a plate would cut a hole as
soon as anything noticed. It is tidy — there is nothing to record, and nothing
to keep in step — and it is what the owner turned down, for a reason a flat
model makes sharp: with no sketch container, *everything* on that plane is
"inside" — a reference circle, the outline of the next feature, a sketch for a
boss that happens to sit within the plate. Construction flags were the escape
hatch for that design; the owner's second remark removed the need for an
escape. Under live binding a solid would also change shape on an edit that
never named it, which is the "a relation changing under you" kind of surprise
the rest of this codebase is built to avoid (a journal entry never changes
meaning with the drawing it is replayed into).

**What replaced it: the record is the membership.** `featureRegion` finds the
outline as before, then each recorded hole by its own members — the loop
keeping most of them, inside the outline — and nothing else. Adding and
removing are calls, `hole` and `unhole`, because a membership change is a
structural change a user makes, and the journal should say so in their words.
The menu and the edit dialog type those calls; the menu *proposes* from
containment (that is a suggestion clicked, not an inclusion).

**Why click-to-pick still proposes the loops inside.** The owner left it to
us. The proposal is shown — the preview is what ✓ builds — and confirmed by a
click, so it is the user saying it, not the drawing; and every other CAD tool
does it, so a plate with a hole is one click. What changed is that the
proposal can be edited before ✓ (a click on a hole takes it out) and that
nothing joins after.

**Why a hole whose loop goes is filled, never refused.** Deleting a hole's
circle used to take the feature's record — the solid lost its faces, its lid
and walls left standing as bare geometry. A missing hole is not a missing
solid: the region is still well defined, it just has one hole fewer. So `del`
fills it (journalled as the `unhole` it implies, then the deletion's
primitives, so replay does exactly that), and regeneration fills a recorded
hole whose loop has gone and says so. The outline is different: without it
there is no region, so its going is still a refusal, or a deletion.

**Why flagging a hole's member construction fills the hole.** Construction
geometry forms no regions, so flagging a hole's circle is, as far as regions
go, the same event as deleting it; refusing (construction.md's interim rule)
would have kept a user from ever demoting a hole's outline to reference
geometry. *Rejected:* keeping the refusal for holes too, for symmetry with the
outline — the asymmetry is real (a region survives losing a hole, not its
outline). Clearing the flag, the other way, adds nothing: that would be live
binding by the back door.

**Rejected: `hole` and `unhole` editing the record without regenerating.**
Simpler, but then a profile changed since (a fillet, a line across) would be
re-found by the next `regen` and not by `hole`, and the two would answer
differently about the same feature. `hole` is `regen` with one loop more.

**Found by the older-file test.** The fixture — written by the build before —
has a revolve whose half-turned end face lies on the plate's plane, over part
of it. `findLoops`' containment tree gives a loop its *smallest* container, so
the end face, not the plate, was a recorded hole's parent, and the hole read
as outside its own outline and was dropped. "Inside" is now asked of the
geometry (`within`: a descendant, or every member's midpoint inside the
outline) — the tree was a proxy that a flat model's overlapping loops break.

### The app under fingers

**The ask**, verbatim: *"it should work on a multi-touch device. Specifically I
have an iPhone. Think about how best to do that."* The spec
(`docs/plans/touch.md`) gave the finger mapping after Onshape and Shapr3D. The
choices below are the ones the mapping left open.

**One recogniser, in front of the engine, rather than touch branches through
it.** A mouse press means something the moment it lands, because its button
says what it is. A finger's press means nothing until it has moved, lifted,
held still or been joined. So `gestures.ts` holds every touch until it has
decided, then hands the engine a tap, a drag, a long-press, a box or a pinch.
The engine sends each one down a path the mouse already used: `toolEvent`,
`idlePress`/`idleMove`/`idleRelease`, `onContextMenu`, the view functions.
*Rejected:* synthesising mouse-shaped events (buttons bitmasks) and replaying
them into the old `dispatch`. That would have needed a fake right button for
the menu and a fake middle button for the pan, and a tool armed would still
have had its press delivered on landing. A tool's press is the reason for
holding: the line, point and fillet tools commit on the press, and the second
finger of a pinch lands a few tens of milliseconds after the first.
Delivered on landing, every pinch would have started with a stray point. Held
until the finger moves past 8 px (then delivered where it *landed*) or lifts,
a pinch never reaches the tool at all. The recogniser is pure, with an
injected clock, so the long-press is a timer and the tests drive it with a
fake. A finger held perfectly still sends no events, so "on the next event"
could not have been the check.

**The second finger drops a draw by re-arming the tool**, `arm(name,
options)`, exactly as undo does. *Rejected:* calling `onCancel` and keeping
the instance. `onCancel` has always meant "you are being disarmed", and
nothing promises a tool is usable after it. Re-arming is also right for the
feature tools: `arm` on the tool already armed `retune`s, so an extrude keeps
its picks.

**Orbit on one finger, box behind the long-press.** On a phone the one-finger
drag is the gesture people make most, and on empty canvas in a 3D CAD app it
means "turn it". The box is rarer and deliberate, which suits a gesture with a
wait in it. A box by finger *adds*, as shift-box does, because a selection
built tap by tap must be able to grow, and a tap on empty canvas is the clear.

**The lifted mark, not a loupe.** The spec offered either. A loupe magnifies a
picture, and this picture is two canvases. The faces are WebGL with
`preserveDrawingBuffer` off, so there is no frame to copy back, and a loupe
would either show the sketch without its solid or re-render the faces on
every move. What a hand under a finger needs is where the point will land and
on what. A copy of the snap's own mark and its name, 56 px up with a leader
down, says exactly that, and costs a few strokes.

**Radii by one factor.** 2.75 = 22/8: a point's 8 px pick radius becomes half
of Apple's 44 pt target. Every tier is scaled together, rather than each radius
being tuned, so the tier order (point over curve over line) survives. Glyphs
were left alone. Widening a box that sits 7 px off its line would have made the
line untappable.

**The click after a long touch.** Found in the browser, not designed: the
compatibility click a browser makes after a touch is hit-tested where the
finger lifts, and the menu the long-press had just opened was there. Pointer
events cannot cancel a click; `touchend.preventDefault()` can, so the engine
cancels every canvas `touchend`. Nothing on the canvas listened for clicks,
and the explicit blur in `main.ts` replaces the focus change the
compatibility `mousedown` used to make.

**Sizes from `(pointer: coarse)`, behaviour from `pointerType`.** The rule was
"never a device guess". A media query is the one signal there is before any
pointer has arrived (the first layout, whether to focus the command line at
start), and it is the one the stylesheet sizes by, so the panels' arithmetic
(`COARSE`) and the CSS cannot disagree. What a press *does* is decided per
event. A mouse on an iPad is a mouse with big buttons.

**Portrait's tray is a column.** Eleven 44 px buttons are 556 px, and the
phone is 390. The owner retired wrapping (*"its just a straight line"*), and a
row that fits would need buttons of about 30 px, well under the target. The
column fits, with the command
line and the log right of it, the strip under a thumb at the bottom right, and
the options panel just above the strip. Beside the column it hung over the
middle of the drawing.

**Shown only under a coarse pointer: the action strip.** A desktop has Ctrl+Z,
Delete, Escape and the menu's Undo/Redo. Adding a panel there would have
changed the mouse's layout, and the brief was that mouse and keyboard stay as
they were.

### An installable app, and a page that never moves

**What the owner asked for** was GitHub hosting, a PWA, and a page that
neither scrolls nor zooms, for his iPhone. Partway through, the hosting target
moved: the site is to be served from a public repository of its own,
`BrotherCreamy/zerocad`, so nothing was published from here.

**Why the worker never takes over.** *Rejected:* `skipWaiting` with a reload
on `controllerchange`. That is the usual "update now" recipe, and it swaps the
page under a hand that is mid-drag, losing whatever is not saved. The app's
state is the model in the page, so a reload is a loss, not a refresh. The
browser's own rule (a new worker activates once no window of the old one is
open) gives "the next start" for free. The test proves it in both directions:
the open window stays on the old version, and so does a second window opened
meanwhile.

**Why the cache prefix matters more than it looks.** Caches belong to the
origin. Every Pages site of one account is `<account>.github.io`, so a worker
that deleted "every cache but mine" would delete the other sites' caches.

**Why the no-zoom rules are in `index.html`, not only in the hosted build.**
The dev server and the single-file artifact are where the app is tried before
it is deployed. A phone rule that only the deploy has would be checked only
on the deploy. Only what needs a served folder (the manifest, the worker) is
the hosted build's. *Rejected:* registering the worker from `main.ts`. On the
dev server it would cache the code under development and serve it after an
edit.

**Why the negative checks have controls.** "The page did not zoom" passes
just as well when the gesture never reached the page. On the control page,
CDP's `synthesizePinchGesture` zoomed nothing, which would have made every
pinch test vacuous. Two raw touch points do zoom it, so those are what the
tests use. For the same reason, the "as iOS" test strips the viewport's limits
and pinches twice: with the page lock's listeners dropped (it zooms) and with
them in (it does not). Chromium reports zero safe-area insets for an iPhone,
so the notch test sets iOS's real insets through CDP. Without that, nothing
could ever be under the notch.

**What is left for an iPhone.** Safari's own behaviour (the gesture events,
the rubber band, the callout, standalone launch) is exactly what Chromium
cannot show. The CHANGELOG lists what to try.


### Construction geometry

**Why a flag on the entity, and why the journal resolves groups.** The owner
decided it was per entity — *"at least based on the name "construction
geometry" it implies per entity"* — and then said why it could not be a
group's: *"if it is a group based inherited thing, then geometry could be both
construction geometry and not construction geometry simultaneously"* (a line in
two groups, one construction and one not). So the flag is a field on the line,
arc or circle, not a `Set` beside the model the way `hidden` is: it goes with
the entity when it is deleted with no cleanup to forget, and stays with a line
an operation re-points. *Rejected:* journalling it as typed, `hide`'s rule.
That would have been correct — replay re-expands `g1` at the same step — but
the entry would then say "g1", which is exactly the reading the owner ruled
out; `construction("l1", "l2")` says which entities, and a file reader never
has to know what g1 was.

**Why one spelling.** *Rejected:* `real(...)` beside `construction(...)`. The
flag is a value; the tools' option is `{ construction: false }`; the menu's two
items type the same word with and without `false`. Two words would also have
needed two replay entries for one fact.

**Why pass over points.** A box-selected batch or a group carries corners with
its edges, and refusing the whole call for them would be the "errors for no
reason" `effortless.md` rules out. A point has no regions to form, so there is
nothing for a flag on it to mean. Only a call with no curve in it at all is
refused, and the command line names a point or frame typed outright.

**Where loops ignore it.** At `collect`, the single place every edge enters
`findLoops`: nothing downstream (cuts, crossings, planes, containment) can see
an edge that never came in, so "bounds nothing, splits nothing, crosses
nothing" is one line rather than a rule each step must remember. The one path
that does not go through `findLoops` — a profile handed over whole, which is
walked by its joins — is told separately (`givenProfile`).

**The look on a solid.** The first picture had the construction line over the
lid drawn as a heavy dark stripe: the entity pass rims every light mark with
1.25px of casing a side so it reads over a light face, and a 0.9px teal core
inside 3.4px of near-black reads as a dark line, not a thin muted one. The
teal is mid-dark already, so its casing is a hairline (0.5px); looked at
enlarged, it is a thin teal line on the face with an edge parting it.
*Rejected:* no casing at all — the faces' shade runs down to a mid slate,
where a teal of similar value would vanish.

**The fillet arc.** Not in the spec. Filleting two construction lines drew a
real arc between them — an outline-coloured stray edge — so the arc takes the
flag when both legs have it, inside `fillet`'s own operation, so replay makes
the same.

### An extrude makes no lid frame

**The report** was the one that started the last package — *"i'm getting a
lot of overlapping points. why is this happening?"* — still true after it in
the commonest multi-region case: two rectangles extruded at once. They share
the first rectangle's sketch frame, which for the second solid stands off its
profile, so sharing had nothing of the second solid's to share, and its lid
frame laid three points on the *first* solid's lid corners. Measured in a unit
test with version 10's expansion asked for by name: 19 points, three pairs, all
three the second lid frame's own on a first-lid corner. Now 16 and none.

**Why remove the frame rather than share harder.** *Rejected:* letting a lid
frame stand on another feature's twins. The two solids' depths are separate
dimensions; a frame point shared across them would be held by both, and the
first `set` would pull one solid's corner to the other's height. *Rejected:*
choosing a lid frame from the profile's own points (the open default "a boss's
lid frame floats" offered this). It keeps a datum nothing needs and a +x
nobody chose. The lid frame's one job was a plane for a sketch on the cap, and
sketch-on-face builds that plane from the cap. What still read it was a twin
curve's `plane` and the depth's pairs. A curve's frame is an orientation, not a
place (`CircleEntity`), and a translation keeps every orientation, so the sketch
frame serves.

**Why the circle's lid gets a plane made, and why on the rim.** With no lid
frame, a cylinder's top has one point of its own, its centre, and its circle's
frame lies at the base. The spec said: a point at the centre typed with
`pt(...)` and the refs seeded along the frame's axes, as the curve tools make
their plane. *Rejected as written:* a new point at the centre lands exactly on
the top's twin centre, which is a doubled point, the thing this package
removes. So the origin is the twin centre itself. *Rejected:* free `pt(...)`
refs. A frame is a datum, so nothing ever moves its points. `set` the
cylinder's depth and the origin rises while the refs stay put, which tips the
plane by atan(Δ/r). The refs are held `oncircle` the top's rim instead, the one
thing that moves with the face: the plane follows the lid exactly, and the hold
has no tangential pull, so +x does not drift. *Measured, then fixed:* seeded to
three decimals, as the curve tools type an origin, the holds pulled the refs
back onto the rim, and the cylinder's free radius gave way by 5e-5. Seeded with
every digit, it does not move.

**Why the expansion is per operation now.** A revolve keeps its end frames:
its end face is turned, so its curves need a turned orientation, which only a
frame of its own gives. So `EXPANSION` is `{ extrude: 11, revolve: 10 }`.
`expansionOf` refuses an `11` on a revolve, so the number always means one
expansion.

**Why the old files are marked, again.** This is the lid-frame-shares-points
pattern, one value later: a version-10 extrude gets `10` at translation, a
version-9 one `9`. Choosing by the file's version at replay would forget the
choice the first time the file is saved as 11.

### Quiet geometry: what the drawing leaves out until the hand is on it

**The owner**: *"I think points ought to disappear when they are the endpoint
of a line or a corner (except when you hover over them), and lines ought to
disappear when they form the edge of a solid (except when you hover over
them)."* And mid-build, on whether a solid's own pieces should be quieter
than a sketch's: *"why is a 3D corner any different from a 2D corner"*.

**Why quiet is a drawing rule and nothing else.** The tempting
implementation is `hide`: leave the corner out of the model's visible set
and let the pick follow. That is the opposite of what was asked — "except
when you hover over them" needs the corner to be under the hand while it is
not drawn. So `quiet.ts` is consulted by `render` alone; `hitTest`,
`findSnap`, `selectInBox` and the drag never hear of it. That is also why
opaque-solids' "nothing invisible is under the hand" does not stretch to
this: a quiet corner is not invisible, it is waiting for the cursor.

**Why quiet glyphs still pick.** The spec has a glyph show "when its anchor
is hovered or selected", which read alone makes a quiet glyph unpickable.
Measured against the code it is unreachable that way: a line picks 5 px
out (`PICK_LINE`) and a mark's box starts `GLYPH_OFFSET − GLYPH_HALF_H` = 7
px out, so moving from the line to its `//` crosses two pixels where nothing
is hovered, the mark goes quiet, and it is not there to arrive at. Rejected:
a sticky reveal (the mark stays drawn a while after the line loses the
hover) — a timer in a pure rule, and a mark that vanishes if you are slow.
Chosen: a quiet glyph picks as a quiet corner does, and a hovered glyph is
drawn; hovering it also lights its lines, so the anchor shows too.

**Why the face layer's edges are face boundaries, not entities.** The
obvious source for "the solid's fine edge line" is the entities the entity
pass inked dark — profile, twins, walls. Two things went wrong with it on
paper: a revolve has no entity at the circle a corner sweeps (so a revolved
block would have no rims), and a whole circle's hole has no wall line, which
is right, but its faces' outlines close on a seam that a naive "stroke every
outline" draws. So each face says which of its own sides are edges
(`Face.edges`), from structure — a cap's outlines, a wall's base and twin,
a side only at a profile vertex — and the face layer draws exactly those.
Rejected: a dihedral-angle threshold over the tessellation, which depends on
how finely a curve is sampled at this zoom and would draw seams on a coarse
small circle.

**Why quads, not `gl.LINES`.** WebGL's line width is whatever the driver
allows, in device pixels, usually exactly one; a 1.2 px line at a device
pixel ratio of 2 would be 0.5 CSS px. The edge is a quad square to the line
of sight, offset in that plane only, so it keeps its own depth; faces are
drawn with a polygon offset of a pixel's slope more than the half-width so
the edge they bound wins the depth test, and an edge behind another face
loses it by far more than that.

**Centres win over ends.** A point that is both a circle's centre and a
line's end stays drawn: the spec keeps centres, and a circle whose centre
went quiet would have no mark at its middle at all.

**The selection is the groups package's.** Built against a stub while the
two packages ran side by side, and integrated after both merged: the
selection the draw pass already prunes each frame is one more reveal, and a
selected glyph is drawn as a hovered one is. **Hidden outranks revealed**
(`entityDrawn`): `hide` takes a thing out of sight on purpose, and a reveal
is about what the hand is on, so a stale snap or a selection made before the
`hide` must not bring it back. Hiding a solid's sketch is the case that shows
why the edge line belongs to the faces: the base's lines are hidden and the
base is still outlined.

**One `members`.** The groups package's reads a feature as a read-only group
of what it made — its depth dimension included — so `ls()`'s count is of
exactly that list, rather than of the entities only as this package first
counted.

**The register's "feature's own entities quiet by name" item was dropped**,
at the supervising session's direction on the owner's reasoning above. With
the lid frame now on the lid's own corners (`lid-frame-shares-points.md`)
that leaves a sketched outline's lid clean; a lid frame over a sketch frame
that stands off the profile still has points of its own, and they are drawn.

### Groups, phase 1: a selection, sets that own nothing, and visibility

**The owner**: *"the concept of this project is flat relational direct cad.
there is no hierarchy. a sketch entity exists in the same logical space as a
solid entity. and entities can be grouped. think about this grouping, and
implement also"*. The design (docs/plans/groups.md) was settled before the
build; what follows is the reasoning the build added.

**Why the command line's text is the switch between selecting and naming.**
Cellwork's click-to-name is the right gesture while a call is being written —
`dist(` then two clicks — and the wrong one for "group these", which needs a
set held somewhere. Rejected: a modifier for naming (Alt-click), which makes
the long-standing gesture a chord and is invisible; and a mode toggle, which is
state the user has to remember. The text is already on screen, and the undo
carve-out had used the same signal. Every test that read the command line after
a plain click now reads the selection, and each keeps a case that writes a
command first, so both halves are pinned.

**Why the selection is engine state with a host handle, not model state.** It
is the viewer's — never journalled, never undone, like the camera and the
layout — and the engine already held the region preselection, which the spec
asked to be "the same selection". So `Selection` holds names and the
`RegionSelection`, one clear, one highlight family. The host decides nothing
but whether a command is being written (`composing`), which is the one fact
only it can see.

**Why the cascade lives in the primitives.** `del` is not the only thing that
deletes: a fillet's regeneration removes twins inside an operation, and a
hand-edited file can say `deleteEntity`. Had group membership been tidied in
`del`, either would leave a group naming nothing. In `deleteEntity` and
`deleteRelation` — beside the default frame's clearing, which set the
precedent — it cannot be missed, and recording `removeFrom` there keeps a
deletion's expansion a complete account. Inside an operation recording is off
and the replay of the operation makes the same removal, so nothing doubles.

**Why a group is never empty.** The spec said the cascade takes a group it
empties. `removeFrom` emptying one by hand is the same state, and two rules
for one state is how they drift; so one invariant, in `removeMembers`.

**Why `hide` journals as typed and `group` journals resolved.** A group *is*
the union at that moment, and the file should state the union: the members a
`group("g1", "l5")` resolved to are its meaning. A `hide("g1")` means "what g1
is now", and replay reaches that step with g1 exactly as it was — so the short
form is as exact, and reads as what was typed.

**Why the Delete key is refused to a focused text field even when it is
empty.** The first e2e run deleted half a test's drawing: Playwright's
`fill("")` sends a Delete to an already empty command line, and the key handler
took it. The hand does the same — empty the line, press Delete once more — and
that should never delete geometry. A click on the canvas blurs the line, so the
key is the drawing's exactly when the hand was just on the drawing.

**What hiding a solid's sketch costs, and why it was left.** The profile
lines are the solid's base edges — the flat model's own point — so hiding the
sketch takes the solid's bottom outline with it. Onshape keeps the two apart;
here they are one entity. Drawing a hidden profile member as a solid edge while
its feature is shown is a small, separable change, written down in TODO.md for
the owner to want or not.

### A lid frame shares the lid's own points

**The owner**, on a screenshot of doubled point labels on an extruded plate:
*"i'm getting a lot of overlapping points. why is this happening?"*, and, told
why, *"of course it should."* A frameless sketch's frame is three of the
outline's corners, and the lid frame made three points of its own over them,
which landed on three lid corners. Measured on his plate: 17 points, three
pairs. Now the lid frame takes those twins: 14 points, no pairs.

**Why the twins are made before the frame now.** The frame has to know which
of its points are twins, so it comes after them. That reorders the names, so
it is a format break (10) even though no entry changed shape.

**Why the old expansion is written into the old entry.** *Rejected:*
re-expanding old files the new way. Every auto-name after the first extrude
would shift. Measured: the owner's plate saved by a version-9 build, with a
`dist` on a later point, fails at that step (`"p16" is not a point`).
*Rejected:* choosing by the file's version at replay alone. A reopened old file
saves as version 10, so after one save it would mean the new expansion. So
`translate` writes `9` into the entry, as the version-8 fillet translation
writes its empty list, and the `9` stays. *Rejected:* marking only extrudes
whose frame stood on the profile. A later `regen` can bring a sketch-frame
point into the profile, and the two expansions differ there. So the record
carries `expansion` too, and regeneration rebuilds a version-9 feature the
version-9 way.

**Why revolve keeps its frame pair.** The `revolution` relation reads a base
as a datum when it is a point of a frame named in a frame pair. That is what
keeps the end face from turning the sketch frame. Spelling out only the end
frame's own points as point pairs would have lost that for a shared corner.
So the frame pair stays, and the relation skips any of its points a corner
pair already holds. Without the skip, that would be a second identical block,
a redundant equation.

**Sharing reads joins, never positions.** A replay runs on seeds, where
positions mean nothing, and the expansion must make the same names there. So
a sketch-frame point on a corner's spot but not joined to it still gets its
own lid point. This is documented, and a test fixture was moved off the
tilted frame's origin because of it.

**What the browser found.** The e2e of the owner's sequence showed one doubled
label left, on the *sketch*. The line tool, closing the triangle back onto its
first point, makes a point of its own and `coin`s it, which is the snap rule
for every existing point. It is not the lid's problem, since the lid has one
twin per joined class, and it is likely part of what the owner saw. It is
left for its own package and asserted exactly in the e2e.

### Opaque solids: one answer for the eye and the hand

**The owner**, two messages in a row: *"when you extrude a solid, it should
look like a solid"* / *"It should be opaque"*. The hidden-edge package had
kept the drawing on top of the faces on purpose — "what a hand aims at is
never behind a face" — and dimmed only the ink. The owner's reading of the
result was glass, and under "tools work like Onshape" a part is opaque: what
is behind it is not seen and not aimed at.

**Why the pick asks the same `Occlusion` the draw pass built, rather than
asking afresh.** The danger in hiding something from the eye is a second,
slightly different answer about what the hand can reach: a point not drawn
but pickable is a trap, and one drawn but unreachable is a bug report. So
`render` builds the frame's `Occlusion` once, draws with it and sets it on the
engine, and `hitTest`, `findSnap`, `selectInBox` and `placeGlyphs` each take
it as an argument and ask `inSight` — the hidden-edge test, square to the
plane, applied to one point. Rejected: recomputing per pointer event (a pick
could then disagree with a picture drawn a frame earlier, and it costs the
faces' derivation on every move); and reading the depth buffer back (a stall,
and the depth layer is not the only renderer — the painter's fallback has no
buffer). Staleness: the engine's copy is the last frame's, which is what is on
screen, and every change to the model or camera redraws before the next event.

**Where on an edge.** An edge is pickable at the cursor when the place on it
nearest the cursor is in sight — one sample, the one a hand is at. Rejected:
"pickable if any of it is visible", which picks an edge by the hidden part
under the cursor because a different part is visible somewhere else. A box,
which is about extent rather than a place, takes the visible runs instead.

**`view` changed its meaning.** It was the camera object in the command
scope; the spec names the mode command `view(…)`. Nothing in the suite or the
docs typed `view.` at the command line, so the camera moved to `camera` rather
than inventing `viewMode()` or `shading()` for the thing a user will reach
for by the obvious name.

**The casing, which the spec did not ask for.** The lighter body was the
spec's, and measured right (5–9:1 against the background). But the sketch's
light ink on it measured 1.2–2.2:1, and the first screenshot showed what
that means: a rectangle sketched on a lid barely there, `p1` on the front wall
unreadable. Options considered: darken the sketch ink over faces (rejected:
the spec keeps sketch colours, and the same line would change colour as it
crossed a silhouette), keep the faces darker (rejected: that is the glass
again), or a rim. The rim is the background's own colour, so off the solid it
is not there at all, and drawn for every mark before any mark so two crossing
lines do not cut into each other. A plain sketch never runs it, which is what
keeps the hidden-edge package's golden picture pixel-identical.

**The hint during a gesture** is decided by whether the overlay drew
anything — counted at the 2D context's drawing calls while `renderOverlay`
runs, in an empty model only. Rejected: asking the tool (no tool says whether
it has a gesture; teaching every tool to say so is the tools package's
territory and would miss tools typed at the command line), and tracking
presses in the host (a line tool previews between clicks with no button held).

### Feature tools: pick, preview, confirm

**The owner** (2026-11-02): *"extrude and other tools should work like they
do in other cad software. just click on the region or select the loop and hit
the tickbox or enter or something"*. Spec: `docs/plans/feature-dialog.md`.

**How the preview is made — the clone, not a plan function.** The spec
offered a throwaway clone or "a pure plan function the operation already has
— `planExtrude` is one". There is no `planExtrude`; the nearest thing,
`planSweep`, walks a profile's joins and computes no geometry. Where a lid
goes is the expansion itself (twins seeded along the frame, a depth
dimension solved), and a second function saying where a lid goes would be a
second account of it — the approximation the spec forbade. So the preview is
the commit, run on a copy: `save` and `open` (the round trip every undo step
already makes), the tool's lines typed into a `Repl` over `neocadScope` of the
copy — the same command layer, the same frame-making and refusals — solved,
and the copy's new features and entities drawn. *Rejected:* computing faces
from the profile and the depth directly — fast, and wrong the first time a
regenerated lid or a crossing materialised differently from the guess.
*Cost, measured* in the app (headless Chromium on the shared 4-core box, a
model of 97 entities — six rectangles, three extruded — previewing a fourth):
24 ms the first time, then 6.5–10 ms for each of nine more. The copy is
rebuilt only when the picks, the values or the model change (a key over the
picks, the values, the journal's length and the entity count), never per
frame, so a keystroke in the depth field costs one of those.

**What a confirm types.** The brief was journal-as-the-call: the confirm types
what the typed commands type, through `submit`. A region is not a member, so
the tool asks `regionNaming` for the shortest typed call that names that very
loop — `extrude("l1", 25)` when one of its whole members is in no other loop,
`extrude("l9", 25, "f2")` when that is true only among loops parallel to its
frame (a lid's edges are walls' too), the resolved profile as the journal
carries it when every member is shared in its own plane. Each asks the
question `foundLoop` asks, over the same loops, so the typed line cannot find
a different region. **The one gap:** a region bounded by a crossing no point
marks yet, every member of it shared (two halves of a rectangle split by a
line drawn across it, never joined). A typed profile names points, and a
crossing is a key until an extrude makes it a point; the operation refuses
keys on purpose (a drag renumbers them). So that region alone is extruded by
calling `extrudeProfile` as the tool always did — the same journal entry, and
`e1  extrude of …` in the log, but no `> extrude(…)` line. *Rejected:* a new
typed form for regions (the spec says the typed commands do not change), and
typing `pt(on(_, "l1"), on(_, "l5"))` first to materialise the crossing (a
different journal, a point the feature would not own).

**One undo step for the selection, planes included.** The extrude tool used to
type a frameless region's plane and then extrude in a step of its own — two
Ctrl+Z, because `submit` closes its bracket a microtask later than it runs.
The host's `perform` now opens one bracket and awaits each line's `submit`
inside it, so the nested brackets record nothing and the outer one records
everything: the plane and every solid, one step. `extrudeplane.e2e.ts`'s "two
Ctrl+Z" became one.

**A region is kept by a point inside it.** A pick keeps `RegionHit.at`, where
the click met the loop's plane, and is found again as `loopAround` that point
in the drawing as it stands. Keys were tried first and fail in exactly the
multi-region case the spec asks for: extruding one half of a split rectangle
makes its crossings points, which relabels the other half's members, and a
key no longer finds it. A point inside it does.

**Re-arming keeps the picks.** The panel's field types `arm("extrude", {depth:
25})`, and `arm` used to make a new tool instance — which would drop the
selection the depth was being typed for. Arming the tool already armed now
retunes it in place (`Tool.retune`) when it has the hook; every other tool
starts over as before. Typing in a field shows the preview the value *as
typed* (`ToolContext.trial`, checked against the declaration, never typed or
remembered), so the lid moves with the keystrokes; Enter commits the field
and then confirms.

**The quick path versus toggling.** A click on a picked region drops it —
except the one picked last, whose second click confirms (the spec's
click-click). Revolve with no axis yet has nothing to confirm, so there the
second click drops the region, as a toggle would. The fillet tool keeps a
corner it cannot round (radius too large) picked, with the preview refused
in the operation's words and ✓ off — the next move is as likely a smaller
radius as another line.

### Tool options: declared, visible, remembered

**The owner's direction** (docs/plans/effortless.md): *"if the tool has
options, there should also be some kind of e.g. pop-up menu that allows me to
set them visually, or it happens in the terminal or whatever."* The second
package under it made the two one mechanism: the panel types `arm`.

**Where the checking lives.** The spec put it in `arm(name, opts)`; the
command is only one way in. A bare tool name typed at the command line, and
an undo re-arming the tool it interrupted, call `ToolEngine.arm` directly. So
the declaration is resolved there, once, and the command only forwards.
*Rejected:* validating in the command and filling defaults in the tool —
two places to agree on what a tool's options are.

**When a value is remembered.** At arm time. The panel types `arm`, a hand
types `arm`, a button types `arm`; arming is the one moment every way of
choosing a value passes through. Remembering when a feature is made would be
closer to Onshape, but would need each tool to report "I used depth 25" — a
second channel for the same fact, and one a tool defined at the command line
would have to know about. The visible difference (arm with 25, change your
mind, the next arm still says 25) is written down in TODO.md.

**Why a press commits.** "Enter or blur commits" sounds complete, but blur
fires on `mousedown`, after the canvas's `pointerdown` has already been
handed to the tool — armed with the old value. Type 25, click inside the
rectangle, get a 10-deep solid: the precise bug the panel exists to prevent.
A capture-phase `pointerdown` on the document commits a field mid-edit before
anything else hears the press; blur still commits for everything else (Tab,
the window losing focus).

**A refused arm changes nothing.** The engine used to cancel the armed tool
and then look the new one up. Checking options first, and cancelling only
once the arm will happen, means a typo (`dpth`) leaves the tool and its
gesture where they were — the effortless rule applied to the command line.
An unknown tool name still cancels, as before, since nothing armed survives
that line's meaning either way.

**`check`, beyond the spec.** Every built-in used to swap an impossible value
(depth 0, radius −1) for its default without saying so: a value typed and
ignored, which is the opposite of the owner's "customise everything". A
declaration can now say why a value of the right type will not do, and the
refusal names it. *Rejected:* min/max fields — a revolve angle is ±2π but not
0, and a depth is anything but 0; a function says both.

**The panel's size is its content's.** Like the tray: no grips, size from
`optionsSize(rows)`, a stored size never read. It is placed last, so that
when it appears over something the viewer has put down, it is the one that
moves. Its default is computed from where the tray is *shown* (`besideTray`),
which needs the tray's arranged place first — `apply` arranges without it,
then with it; `settled` keeps earlier panels' places, so the two agree.

**The greyed buttons.** `toolUnavailable` has answered null since
no-refusals, and that package kept the toolbar's disabled state wired to it,
idle. Removed here: an idle code path that renders a state nobody can reach
is a test nobody can write. The menu and `step` still ask the rule; it is
one function and cheap to keep.

### No refusals: the curve tools make their plane, and a miss is guidance

**The owner's direction** (docs/plans/effortless.md): *"don't be throwing
errors at the user for no reason. keep the user on track."* The first package
under it took the extrude package's pattern — the layer above makes what the
operation needs, typed so the log teaches it — to the curve tools, and turned
every click refusal into a muted line of what would work.

**Which plane a circle tool makes.** The working plane the click already
landed on: with no default frame that is the camera-parallel plane through
the orbit target, and the click is on it by construction. The tool types
`plane(pt(click), null, null, { look: false })` and lets `frame()` seed the
refs along the screen axes. *Rejected:* typing three `pt(…)`s with
coordinates, as the spec's words suggested — rounded for the log, three
points tilt the plane by up to ~5e-5 rad, and the fillet's in-plane check is
1e-6; only the origin is rounded (under a thousandth along the normal), and
the first click is projected onto the frame's plane at commit so
`holdOnSketchPlane` holds it. *Rejected:* full-precision literals, which put
`pt(512.3456789012345, …)` in the log the newcomer is meant to learn from.

**When.** At the first click, not at commit. Making it at commit would mean
an abandoned gesture leaves nothing behind — but every click of a three-click
gesture would land on the camera plane *of its own moment*, and an orbit
between clicks (a right-drag mid-gesture is a supported thing) would put them
on different planes. The cost kept: Escape after the first click leaves the
typed plane, one Ctrl+Z away, as any typed line would.

**The fillet is different.** The arc must lie in the *corner's* plane (the
operation refuses a corner out of its frame's orientation to 1e-6), and the
screen-facing plane is that only until the view turns. So the fillet tool
types a plane of the corner's own three points, +z toward the viewer — the
extrude package's frame-of-the-sketch's-points, which the register already
says is not a world datum — and only after every refusal that needs no frame
(`filletNeedsFrame`), so a corner that will be refused makes nothing. Typed
`fillet` does the same, which the spec did not ask for; leaving the typed
command refusing what the tool does would have been the inconsistency the
extrude package had already ruled out.

**What stays red.** Nothing a built-in tool says about a click. The rule I
drew: a refusal about where the user clicked, or what they clicked, is
guidance; red is the solver's CONFLICT and a typed entry's error. The
operation's own words, where a tool cannot say it shorter (a radius too large
for the corner), are passed on as guidance too — they are still about the
click. A tool written at the command line that calls `ctx.log(line)` with no
outcome still gets red: that default keeps meaning "refused" so nothing
authored before this changes colour under its author.

**The light.** Every loop's region, faint, even-odd, so the outline around a
hole leaves it clear and the hole is lit as a region of its own — each click
target lit exactly once. Loops thinner on screen than they are long are
skipped, or a box seen from above would have its walls painted as green edges.
*Not done:* occlusion. Hidden faces are lit through the lid. It reads as
busy on a solid seen at an angle, not wrong, and occlusion.ts could fix it.
The revolve tool's axes are lit by asking `checkRevolveRegion` of every line
and frame arm, once per profile chosen — what is lit is exactly what a click
would be let use, so the guidance for a dark one can be short ("click a lit
one").

**Found by looking.** The first screenshot after the solid showed its edges
still green: the extrude tool solved (and redrew) before it finished, so the
last frame drawn still had the armed tool's light in it. Finished first now.
The second showed the header still saying "click inside a closed outline"
over the solid that click had made: a guidance note is cleared when the next
undo step is recorded.

### The tray is a line, and a grip is a cursor: undoing the wrap cleanly

**The owner**, an hour after the wrap landed: *"you dont need those diag lines
on every corner. also actually get rid of resizing altogether on the tool
palette. its just a straight line that fits the number of tools it has in it,
and can either be vert or horiz"*.

**Deleting the wrap meant deciding what was the wrap's.** `trayFit`,
`perLine`, `trayDepth`, `dragStep`'s second-ask loop (and the `same` helper
only it used) and the stylesheet's `flex-wrap` existed for nothing else, and
went. Two things that came in with the wrap were weighed and kept. The push
direction in `pushed` — the way the rectangle grows on an axis rather than the
pointer's sign — was introduced because a wrapped tray's depth grew against
the pointer; for every gesture left the two are the same, so it could be
reverted with no change in behaviour. It was kept because it is the better
statement of the rule (it is the rectangle that covers what must make way)
and it runs on every move, so it is not idle code; reverting it would be churn
in the one resolver everything shares. And the grips' triangle clip was
introduced so that four grips would not eat a 28 px tray; with the tray
gripless that reason is gone, but the second — a 16 px strip keeps its middle
to drag by, rather than losing 12 px squares at both ends — still holds for
the log and the command line, and the spec said nothing else about resizing
changes.

**Where "no resizing" lives.** The spec asked for `resized` on a tray to be
refused, but `resized` is geometry on a bare rectangle and has no notion of a
tray; giving it one would make the pure core know about panel kinds for one
`if`. `dragStep` is already the one function told a panel is a tray (its
button count, for turning), so the refusal went there: a resize grab on a tray
returns the very layout it was handed. The DOM half never makes the grips in
the first place (`gripCorners`), so the refusal is the second wall, not the
only one — and the random walk deliberately hands the tray resize grabs to
prove the second wall holds.

**Why the size is recomputed rather than stored differently.** The stored
layout is a rectangle per panel under `v2`. A tray's rectangle could have been
stored without `w`/`h`, but that is a format change for no gain: `arranged`
simply reads a tray's `x`, `y` and `orient` and takes its size from
`traySize` of the count it has now. That one rule does three jobs — old
wrapped layouts come up one line, a tool defined into a moved tray lengthens
it (closing the caveat the wrap had left about a moved tray not growing), and
nothing a viewer does can make the two disagree. Pulling the placement out of
`apply` into a pure `arranged` was so all three are unit tests rather than
browser ones.

**Rejected: a mark on hover.** The smallest step back from "no visible mark"
would be drawing the diagonals only while the pointer is on a grip. The owner
asked for none, the cursor already changes at exactly that moment, and the
platform's own window corners carry nothing either. Written down in TODO in
case the grips prove hard to find.

**The pixel test reads the screen, not the stylesheet.** Asserting that the
computed `background` is `none` would pass with a mark drawn some other way
(a border, a pseudo-element, an SVG). So the test screenshots each corner of
the log with the hand on its grip, and held, and again with the grips hidden,
and requires the two to be identical, decoding the PNG in the page so there
is no new dependency; and it plants the old lit colour to show the
comparison sees a mark when there is one.

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

---

## 2026-11-06 — panels reshuffle rather than push

The owner: *"When I push toolbars around, they should be able to reorder with
other toolbars. So reshuffle rather than push."* Spec:
`docs/plans/panels-reshuffle.md`, built.

**Why the sequence is read and not stored.** The spec keeps an ordered list
per edge and lays positions out from it. That would have been a new storage
format beside v3's dockings, a second source of truth for where a pane is,
and a migration — and it would have had to live with `refit` (touch-density's
"a layout that does not fit is never drawn") and `relaid` deciding positions
through a rotation. Reading the order from the positions at each press gives
the owner's behaviour (a drag reorders, the result is a new order) with
nothing stored differently, and makes "old layouts translate" true by
construction. Rejected: storing the list. The price is written down in the
spec: a reordered pair with a gap between them is not docked to each other,
so a rotation re-lays each on its own.

**Why the source edge does not close up.** "The rest of that edge closes up
or makes room" could mean the edge a pane left closes the hole. Tried on
paper against the desktop's defaults: the tray leaving the left edge would
pull the log and the command line up from the bottom to the top. Built: the
destination makes room, the source is left; only what the hand took moves,
except to make room for it.

**Why there is no push left in a drag at all.** The spec keeps push "where
order cannot help" and then says what that means: a second line, else a
refusal — "nothing is ever pushed off screen". So a reorder or a trade that
would land a pane on another is refused and said, not pushed; and a drop in
free space partly on a pane stops flush against it. The first build of that
last case reused the old resolver with every other pane fixed, which stops a
pane at the *first* thing on the line from the press — so a pane carried over
another to empty space beyond stopped on it. It lands now at the furthest point
toward the hand that lies on nothing, then slides on along each axis (so a
pane taken diagonally into the corner under the logo still reaches the edge).

**What it costs, measured.** On a phone's crowded defaults a third of random
drops are refusals: where the push used to make room, nothing does. The
sharpest case is the toolbar along the top of an upright phone — the
organiser and the action strip are under the logo's row and nothing moves
them. Left in place, said on the ghost, and vetoable.

**Overturned on review, the same day.** The coordinator read the third of
drops refused, and the picture of the toolbar at the top doing nothing, as a
regression: *"'reshuffle rather than push' means the others reorder to let
the held one in"*. So the panes the drop lands on make room — the nearest free
place, the old push's search as the fallback, then all of them laid again —
and refusal is kept for panes that genuinely cannot all fit. Rejected on the
way: making room by the push alone (it moves whole chains along one axis and
throws a pane across the screen where a free place is a few pixels off), and
packing every pane again on each move (it would move panes the drop never
touched). The first new picture showed one more thing the rule needed: let in
beside the bare logo, the toolbar left the status a 20 px column, so along the
top the corner is the logo and the status's least room.


## 2026-11-06 — a touch harness that streams, and a recogniser that reads the stamp

The manager's package (`docs/plans/touch-harness.md`): the iPhone drags in
`solidsphone.e2e.ts` failed in four full gates in a row and passed alone.

**The first cause was the harness's.** A trace of the page's pointer
events against the harness's sends, under 20 busy loops, showed it before
any fix was tried. The long-press timer fired on time (506 ms, due 506), so
the page was not too slow to decide. What was late was the move that leaves
`TAP_SLOP`. It was stamped 475–518 ms after the landing, because it really
was *sent* that late. `fingers.ts` awaited each `dispatchTouchEvent`, and
every touch here is handled on the main thread, so a 12-step drag cost twelve
main-thread turns. No change to the recogniser could have fixed that one: by
its own stamps, that move came at the long-press.

**Why streaming, and not the page's clock.** Both made `solidsphone` green
at the same load (3/3 each). Playwright's `page.clock`, paused from the first
landing to the last lift, freezes `performance.now()` for the page as well.
That broke touch's *"a quick tap while the page is busy is still a tap"*
(0/2): the test checks that the recogniser times a tap by the event's own
stamp against the page's clock, and a frozen clock turns it into a different
test. It also fires the long-press timer by fiat (`runFor`) instead of in
real time. So it changes what the tests mean, which is the one thing the spec
asked not to change. Streaming is what a touchscreen does: the OS sends a
finger's events as they happen, and the browser queues and coalesces them
while the page is busy.

**Why every event is stamped, not some.** The 2026-11-05 attempt sent the
first move unawaited and kept the browser's stamp on it, and every drag
broke: the browser-stamped move came out earlier than the harness-stamped
landing. One clock for the whole gesture avoids that. That clock is the hand's:
the wall clock less the time the helper spent waiting for the browser. A
test's own waits between calls (a finger resting on a corner before it lifts,
which the fling rule depends on) are the hand's time, so they count.

**Why 33 ms a move, and how I got it wrong first.** I took the old helper's
`settle(16)` to be its pace and streamed at 16 ms. The six touch files were
all green at that pace under load. The full gate wasn't: toolbargroups'
iPhone-landscape slide lost the plain tap after it, deterministically, on an
unloaded box. Measured, the old helper had sent a move every 32–35 ms,
because each 16 ms settle came after an acknowledgement and a Playwright
round trip. So my hand was twice as fast, and its fling suppressed a tap
400 ms later. A real touchscreen reports at 60–120 Hz, but a drag's *speed*
is what decides a fling, and the suite's steps and rests were all tuned to
the old speed. The pace that keeps every test meaning what it meant is the
old one, so the hand keeps it at every load.

**Why `hold` still waits for its landing.** The long-press is the page's
timer, started when the page handles the landing. A hold counted from the
send could lift before the page's 500 ms were up on a page that handled the
landing late, and so never become a long-press.

**The second cause was the recogniser's, and it holds on a phone.** With the
harness streaming, android's Pixel 7 rectangle drag still became a box about
once a run at load 30. The trace put the race in the page: the landing
handled at 67 ms, the moves in the browser by 228, the main thread busy until
568, the timer run 1 ms after it was due (so `LATE_MS`'s grace, which only
looks at the timer's own lateness, did not apply), and the queued move,
stamped 171, dispatched only at the next frame, at 630. Touch moves are
rAF-aligned, and a timer can run before the frame that would deliver them.
Nothing about this is the harness's: a phone whose page is busy drawing a
heavy preview at touchdown does the same. So a held press's move past the
slop is read by its own stamp, as a tap's length already was. Made before
`LONG_PRESS_MS`, it was a drag: the long-press is abandoned, its menu
withdrawn by the same path a second finger withdraws it, and the drag
starts where the finger landed. The menu was opened in the same frame the
move is dispatched in, before that frame paints, so a hand should never see
it. That is a reading of Chromium's input pipeline, not something measured.

Rejected for the second cause: waiting `LATE_MS` on every timer, on time or
not. That delays every long-press on a quiet page to save one on a busy page.
It also only moves the race: a frame can take longer than any grace.
Rejected too: `navigator.scheduling.isInputPending`, which Safari does not
have.

**Left alone, and written down.** At load 25 and up on this box (my 20 loops,
at times with another worker's full suite beside them), taps on chrome
buttons and on the logo are
still lost now and then, with either harness. The page took 400–1,400 ms to
handle a touch, and the click is Chromium's own synthesis from the touch
sequence. Nothing a harness sends can make a busy page answer sooner. Two
neighbours of the stamp rule are not built, because nothing measured needs
them. A press whose move is stamped *after* `LONG_PRESS_MS` but handled
before a late timer is read as a drag, not as a hold and then a box. And the
long-press timer is started when the landing is handled, not when it was
stamped, so a hold made while the page is blocked at touchdown can lift
before the timer is due and come to nothing.
