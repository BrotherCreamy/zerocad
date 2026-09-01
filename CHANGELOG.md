# NeoCAD — changelog

What has actually been built, **newest first**. `TODO.md` is what's next;
`STATUS.md` is the itemised account of what exists and why it's shaped the
way it is; `CONVERSATION_LOG.md` is the longer narrative behind the
decisions.

---

## Snapping

While a tool is drawing, the cursor is pulled onto nearby geometry — so a
rectangle dragged corner-to-corner on an existing one lands *exactly* on both,
not a pixel and a half off.

![A rectangle being dragged from an existing corner, with a green triangle marking a snap to the midpoint of the top edge](docs/images/07-snapping.png)

Three kinds, in tiers that mirror picking's: an existing **point** (square
marker), the **middle of an edge** (triangle), or the nearest position along a
**curve** (circle). Tolerances are in screen pixels, so they hold at any zoom.

The tool is handed a snapped coordinate and never learns anything happened,
which is the point — a tool should be about its own gesture, not about how
precise the cursor is. `rectangle.ts` needed no changes at all.

The marker is drawn *after* the tool's own preview, so it can't be hidden by
it. If the cursor is not where it looks, that had better be the most visible
thing on screen.

**As first shipped, snapping made the click exact but joined nothing** — two
points at the same position were still two separate points, and dragging one
left the other behind. That gap has since been decided the way every
mainstream sketcher does it: Onshape-style **constraint inference**, where the
tool applies an ordinary `coin` (or point-on-curve, or midpoint) constraint to
whatever it snapped to. Spec in
[`docs/plans/onshape-inference.md`](docs/plans/onshape-inference.md).
`snapping(false)` turns snapping — and with it, inference — off.

The screenshot above caught a bug on its first render, which is becoming a
theme: the hover tag kept following the cursor mid-drag, still naming whatever
had been under it *before* the gesture started. Hover now stops entirely once a
tool is armed — the snap marker is the feedback that matters by then, and two
highlights competing for one cursor is worse than one.

---

## The fillet tool

Click two edges that meet; the corner rounds. The first tool built on picking,
and the case that motivated it — `fillet` the operation had been usable from
the command line for a while, but only if you already knew both edges by name.

```js
arm("fillet", { radius: 8 })   // then click two edges
```

Two additions to the tool API came out of it, both of which the next few tools
want anyway:

- `ctx.pick(screen)` — hit-test from inside a tool.
- `arm(name, options)` — hand a tool a parameter it needs *before* it can do
  anything. A fillet needs a radius; a fixed-size circle tool would need one
  too. Better one mechanism than each tool inventing its own.

Two behaviours worth stating because they were deliberate: clicking something
that isn't an edge is a **miss**, not a cancelled gesture (the likeliest cause
is aiming slightly off, and losing the whole gesture for that would be
infuriating), and a corner the operation refuses — collinear legs, a radius too
big — keeps the first edge so the second pick can be retried.

---

## Picking, and an end-to-end suite

### Clicking geometry

![The rectangle drawn, with a hovered circle highlighted amber, a tag reading "c1 r 28" beside the cursor, and the command line showing dist("p1", "p2"](docs/images/06-picking.png)

The selection model is ported from cellwork, and it is not the obvious one:
**there is no selection set.** Clicking geometry drops its *name* into the
command line and that is all. The viewport is a selection portal, not
somewhere state accumulates — so there is nothing to clear, nothing to get out
of sync, and only one way to refer to an entity.

It suits this codebase even better than it suited cellwork, because every
relation here already takes entity names as strings. Type `dist(`, click two
points, and you have `dist("p1", "p2"` waiting for a number.

The TODO had this written down as "a real `sel`/`desel` pair", which was an
invention — reading cellwork settled it. Its README puts it plainly: *"the
viewport is a selection portal — clicking geometry only drops its name into
the command line."*

Hit-testing is in **screen** space, so the tolerance stays a constant number
of pixels however far you zoom. The tiers matter as much as the tolerances:
points beat curves beat lines, because a point sitting on a line is under the
cursor at the same time as the line and is almost always what was meant. An
arc is only pickable within its own sweep.

Hovering highlights the entity and names it in a tag. With nothing armed, a
left-drag pans and a left-click picks; with a tool armed, the left button is
the tool's, exactly as before.

### An end-to-end suite in the repo

The browser checks behind this project's "verified with a real mouse" bar had
been living outside the repo, which meant nobody else could run them. They are
now `npm run test:e2e` — 39 checks across six specs, about 12 seconds, with the
runner starting and stopping its own dev server.

They exist because a good deal of this is only wrong once assembled. The
running count of bugs that passed the entire unit suite and were obvious within
seconds in a browser is now **six**.

### And two more of those, found by looking at the screenshot above

The first version of that picture had an **ellipse** in it. The canvas bitmap
only resized on `window.resize`, but the log pane grows as you type commands
and takes height from the viewport — so the drawing was quietly squashed. It
had been that way for a long time; no assertion noticed, and one glance did.
A `ResizeObserver` fixes it, and there is now a test asserting the bitmap keeps
square pixels as the log fills.

The first version also read `dist("p1" "p2"` — names inserted with no comma,
because cellwork's commands are space-separated and this one's are function
calls. Picks are comma-separated now, so what lands in the input is actually
finishable.

---

## Mouse navigation

The viewport could previously only be driven by `zoom()` and `pan()` at the
command line, which is a strange way to have to look around a drawing. Now
the wheel zooms **about the cursor** and right- or middle-drag pans —
Onshape's split.

Navigation deliberately sits on different buttons from tool use: the left
button belongs to whichever tool is armed and nothing else. So you can start
a rectangle, pan to see where it's heading, and finish it, and the tool never
notices.

Making that work turned on a wrinkle in the pointer spec. Pressing a *second*
button while one is already held does not fire another `pointerdown` — it
arrives as a `pointermove` with the `buttons` mask updated. The first attempt
keyed off `button` (what just changed), so panning mid-gesture silently did
nothing. It watches the mask instead.

The transform moved to `src/view.ts` as pure functions, so the arithmetic can
be tested without a canvas. Zoom-about-a-point is solved directly — read the
world point under the cursor, then place the origin so it lands back on the
same pixel — rather than nudged, so the anchor doesn't drift as zooms
accumulate.

---

## Save and open

Saving is a command like everything else:

```js
text = save()        // the whole drawing, as JSON
open(text)           // ...and back again
journal()            // what the model is made of
download("part.json")
```

**A model can't be serialised directly.** A residual block holds a *closure*,
and closures don't survive a round trip through JSON. What does survive is
the sequence of calls that produced them — so a saved file is the model's
**journal**, replayed on open:

```
addPoint([0,0], "p1")
addPoint([40,0], "p2")
addPoint([40,25], "p3")
fix("p1", [0,0])
addLine("p1", "p2", "l1")
addLine("p2", "p3", "l2")
horizontal("l1")
vertical("l2")
dist("p1", "p2", 40)
dist("p2", "p3", 25)
fillet("l1", "l2", 8)
```

That's a happier answer than it first sounds. The save format isn't a second
description of the model's internals that has to be kept in step with them —
it's a transcript of the public API. Anything you can type, you can save.

Notice the fillet is one line, not the handful of points, arcs and relations
it expands into. Operations are journalled as the call the user made and
re-expand on replay.

Solved coordinates ride along and are restored afterwards. Replay alone
reaches *a* valid configuration, but an under-constrained model has many, and
reopening a drawing should give back the one that was saved.

Opening only ever performs calls from a fixed table, so a file is data rather
than a script. That table is a `Map` — a plain object would have answered a
lookup for `"constructor"` from `Object.prototype` and let a file naming it
straight past the guard.

**A latent bug this flushed out.** Wiring `open()` into the browser hung the
tab outright, and it wasn't in the new code. `Model.autoName` had always been
able to loop forever:

```js
const n = (this.counters.get(prefix) ?? 0) + 1;   // const
while (this.entities.has(name)) {
  this.counters.set(prefix, n + 1);               // always the same n
  name = `${prefix}${this.counters.get(prefix)}`;
}
```

Nothing had ever hit it, because names were only ever handed out in order. A
replay is the first thing that takes them *out* of order — every journal
entry carries its explicit saved name, so the counters stay at zero, and then
the fillet's own internal `addPoint()` finds `p1` taken, finds `p2` taken, and
spins. Fixed on both sides: the loop increments, and an explicit name shaped
like an auto-generated one now moves the counter past it.

---

## Circle and arc tools, and the fillet

### Fillet

Rounds the corner where two lines meet. All four corners of a rectangle,
still solved:

| before | after |
|---|---|
| ![A plain rectangle](docs/images/04-fillet-before.png) | ![The same rectangle with all four corners rounded](docs/images/05-fillet-after.png) |

The satisfying part is that it needed no new mathematics — `tan` on each leg,
`arcends`, and `rad`, and that's the whole thing. Those four are also
*complete*, which isn't obvious: a tangent line touches its circle at exactly
one point, so an endpoint lying on both the leg and the circle can only be
the point of tangency. Nothing further to say.

It reuses the shared corner as the first leg's tangent point rather than
replacing it, so nothing is orphaned — the model has no delete yet, and an
operation that stranded points would leave stray dots on the canvas forever.

### Circle and arc tools

Circle drags from centre to rim. Arc is three clicks — centre, radius, sweep
— which made it the first tool to span more than one gesture, and needed no
engine change at all: a tool stays armed until it calls `ctx.finish()`, so
"multi-stage" is just "finishes later".

![A committed circle on the left, and an arc mid-sweep on the right showing its dashed preview](docs/images/03-circle-and-arc-tools.png)

Both leave the radius unconstrained on commit, following the rectangle tool's
choice not to dimension what it draws: the shape keeps the size it was drawn
at, while staying free to be driven later by a `rad` or a tangency.

### The contract change the fillet forced

The first browser run of the fillet passed every numerical check — tangent to
both legs to six decimal places — and drew a **visibly broken rectangle**,
its right edge slack and slanted.

Relations captured *variable indices* when they were created. The rectangle
tool said `hor(cornerA, cornerB)` — meaning "this edge is level" but *saying*
"these two points share a y". When the fillet re-pointed the edge at a new
tangent point, the constraint stayed behind on the old corner and the edge was
free to swing.

This was first written up as a documented caveat, on the grounds that fixing
it properly was too big to bundle in. Then the screenshot arrived. Filleting a
rectangle is the most obvious thing anyone would try, and it produced garbage.
Measuring the change rather than estimating it: four lines in `problem.ts`.

So `addResidual` now takes either an index list or a thunk re-consulted at
every evaluation, and every line-taking relation uses the thunk. `hor` and
`ver` take **either** two point names or one line name — both are real things
a sketcher means — and the built-in tools use the line form. A relation on a
line now genuinely means *this line*, and follows it through structural
surgery.

---

## The REPL

The item the whole project was pointed at. The input at the bottom of the
window is a scoped evaluator over the app's own command surface — not a debug
console, the primary interface.

```
geometry   pt(x,y)  ln(a,b)  circ(center,r)  arc(center,start,end,r)
relations  dist fix coin mid hor ver par perp ang on eq
           rad oncircle conc eqrad tan sym arcends
operations fillet(line1, line2, radius)
files      save()  open(text)  download(name)  openFile()  journal()
viewport   arm(tool)  cancel()  zoom(f)  pan(dx,dy)  refresh()
inspect    ls()  coords(name)  solve()  tools()  model
authoring  Tool  defineTool(name, ctor)  Dual
```

**Tools are authored in the same place**, through the same `defineTool` the
built-ins use. This is the whole point of the architecture — a rectangle tool
typed at the command line:

```js
defineTool("boxtool", class extends Tool {
  onDown(p) { this.s = p.world; this.c = p.world; this.ctx.requestRender() }
  onMove(p) { if (this.s) { this.c = p.world; this.ctx.requestRender() } }
  onUp(p) {
    const [x0, y0] = this.s, [x1, y1] = p.world; this.s = null
    const q = pt(x0,y0), r = pt(x1,y0), s = pt(x1,y1), u = pt(x0,y1)
    const e1 = ln(q,r), e2 = ln(r,s), e3 = ln(s,u), e4 = ln(u,q)
    hor(e1); hor(e3); ver(e2); ver(e4)
    this.ctx.requestSolve(); this.ctx.finish()
  }
  render(r) { /* ...draws the green dashed preview below... */ }
})
```

Then type `boxtool` and drag one out. The green dashed preview is the tool's
own `render()` running, mid-drag, with nothing committed to the model yet:

![A green dashed rectangle preview being dragged out, from a tool defined at the command line](docs/images/01-repl-authored-tool.png)

**"Scoped evaluator, not raw `eval`"** means an entry resolves identifiers
against a curated scope rather than the page's globals. An entry runs inside a
`with` block over a Proxy whose `has` trap claims *every* name, so nothing
falls through to `globalThis`, and whose `get` trap throws `no such name:
modle` instead of quietly handing back `undefined`. `document` simply isn't a
name that exists.

To be precise about what that is: **curation, not a security boundary.** It
exists so an entry sees a small documented surface and typos get caught. Code
typed there still runs with the engine's authority; genuinely untrusted code
would need a worker or an iframe, which is a different feature with a
different threat model.

Two consequences of the `with` scope, documented rather than smoothed over: a
bare assignment (`box = ...`) persists between entries, a `const`/`let`/`class`
declaration does not.

Viewport control landed as ordinary commands at the same time — `zoom`, `pan`,
`arm`, `cancel`, `ls`, `solve`, `help`.

**A bug the browser caught:** `solve()` at the REPL called `model.solve()`
directly, so the status readout kept showing the *previous* verdict. You could
introduce a conflict from the command line and the header would still read
`SOLVED`. The host's solve path is now what runs.

---

## Circle/arc entities and the rest of the relation vocabulary

`par`, `perp`, `ang`, `on`, `eq`, `rad`, `oncircle`, `conc`, `eqrad`, `tan`,
`sym`, `arcends`. Here they are doing visible work — a circle whose radius is
decided entirely by tangency to the ground line, a segment mirrored across an
axis, and a parallel-and-equal pair:

![A scene with a circle tangent to a line, a mirrored segment pair, and a parallel equal-length pair, all solved](docs/images/02-relations.png)

**Most of them are dimension-generic, and not by coincidence.** Written
through `dot()` and `wedge()`, the definitions people think of as 2D hold
unchanged in any dimension: "parallel" is "the wedge vanishes" whether that
wedge has one component or three. Symmetry about a line is generic for a
subtler reason — the mirror in 2D and a half-turn about the axis in 3D are the
same two conditions. Both claims are checked against a real 3D model rather
than asserted in a comment.

One numerical decision worth recording: the wedge is kept as its *components*
rather than their summed square. The square is the tempting form — one
residual instead of three — but a residual that is already a square has a
vanishing gradient at its own root, so least-squares would be minimising a
fourth power, and convergence suffers badly for it.

`Circle` is a centre point reference plus one variable of its own, the radius;
`Arc` is that plus a named start and end. Both stay purely *structural*,
following the precedent `Line` set by owning no variables at all: what makes
an arc's endpoints lie on its own circle is the `arcends` relation, not the
constructor — for the same reason a `Line` doesn't imply `hor`/`ver`.

---

## Earlier

Before this changelog existed: the Rust/WASM kernel, forward-mode automatic
differentiation, the dimension-generic entity model, the tool-authoring layer
and the first browser milestone. See `CONVERSATION_LOG.md` for the narrative
and `STATUS.md` for the itemised account.
