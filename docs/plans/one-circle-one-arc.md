# Plan: one Circle tool and one Arc tool — the method read from the gesture

**Status: built** (2026-11-04) — see *As built* at the end, every deviation
there and in TODO.md's Done entry. Queued after `frameless-curves.md` (built). The
owner: *"why are there multiple circle tools and arc tools? they all achieve
the same thing. surely just one tool, but different ways to set
constraints. think about how to do this."*

Today there are four: `circle` (centre, drag the radius), `circle3` (three
points on the rim), `arc` (centre, start, end) and `arc3` (start, end, a point
on it). Each makes the same entity; they differ only in **which constraints
the clicks create**.

Read `CLAUDE.md`, `effortless.md`, `circle3-tool.md`, `arc3-tool.md`,
`frameless-curves.md`, `tool-options.md`, `onshape-inference.md` (as built),
`src/tools/circle.ts`, `circle3.ts`, `arc.ts`, `arc3.ts`, `place.ts`,
`src/tools/options.ts`, `src/snapping.ts`, and their tests.

## Design

- **One `circle` tool**, the gesture deciding:
  - **press and drag** — centre, then radius (today's `circle`);
  - **three separate clicks** — a circle through the three points
    (today's `circle3`); the first click is a provisional centre-or-rim
    point, and the second click (rather than a drag) settles it as a rim
    point;
  - **clicking on existing geometry** while placing a rim point makes the
    circle **tangent** to that line or circle (a tangent relation, visible and
    deletable) — the "different ways to set constraints" the owner named.
- **One `arc` tool**: **drag from start to end, then move to set the bulge and
  click** (three-point, today's `arc3`); or **press on a point first and hold
  still** to make it the centre, then start and end (today's `arc`). Tangent
  on existing geometry as for the circle — an arc starting at a line's end
  tangent to it is the common case; offer it by snapping.
- **The options panel shows the method it read** (`centre · radius`,
  `3 points`, `tangent`) as a choice the user can **lock** — typed as
  `arm("circle", { method: "3pt" })` — remembered like any option.
- `circle3` and `arc3` **stay as typed names** that arm the one tool locked
  to that method, so old habits, scripts and files keep working; the toolbar
  shows one of each (11 buttons, not 13).
- Drawn on the face under the cursor or the work plane, held by the
  frameless relations (`frameless-curves.md`).

## Tests

Unit: each gesture's constraints (centre+radius; three on-circle points;
tangent to a line; to a circle); the method lock; `circle3`/`arc3` arm the
locked tool. E2E (mouse and iPhone 13): each gesture draws the right circle or
arc with the right relations; the panel names the method; the toolbar has
one of each; every existing curve test passes (update counts and the tools
removed from the toolbar, keep claims). LOOK at each.

## Docs

CHANGELOG at the top quoting the owner; the register (one tool each, the
gesture decides, lockable; the old names stay as typed shortcuts) as
vetoable; STATUS; README; `help()`; the spec marked built.

## As built (2026-11-04)

Built on `claude/one-circle-one-arc`. `src/tools/circle.ts` and
`src/tools/arc.ts` are the two tools; `src/tools/curvemethod.ts` (new) is
what they share. `circle3.ts` and `arc3.ts` are gone, and `arcThrough` moved
into `arc.ts`. Other changes: `TOOL_ALIASES`, `toolAlias`, `aliasCommand`,
`armedLine` and `Tool.read` in `tool.ts`; the alias resolved in
`ToolEngine.arm`; choice options (`choices`) in `options.ts`; a choice row in
`panels.ts`'s `OptionsPanel` and its CSS in `index.html`; `roomBeside` in `tooltip.ts`; `CurvePlane.surface`
in `place.ts`; `tan` between two circles in `relations/geometry.ts`; its glyph
in `glyphs.ts`; the bare-name shortcut and the panel's rows in `main.ts`
(eight lines); `arm`, `tools()` and `help()` in `replenv.ts`; the menu items
and glyphs dropped. Where the spec left a choice, and every place the build
differs from the text above:

- **How each gesture is told apart.** A press is held until it either moves
  more than `DRAG_PX` (3 px, the engine's own drag threshold) or lifts where
  it landed. A finger gets the recogniser's 8 px slop before the tool sees
  anything. **A click decides when it is pressed and a drag when it is
  released**, the same as the old tools: the old 3-point tools and the
  centre-point arc acted on the press, and the drag-out circle on the
  release. A press followed by another press with no release in between
  counts as a click, so a script of presses alone still draws.
- **"Press on a point first and hold still" means a press that does not
  move: a click, held for any length of time.** It is not a timed hold. On a
  phone, a finger held still opens the context menu (`LONG_PRESS_MS`), and a
  tool under a finger sees no press until the recogniser has decided what it
  is. A timed hold could not be made the same on both hands. So the arc reads
  a first **click** as its centre and a first **drag** as its two ends.
- **The circle's first click is provisional, as the spec says.** A drag after
  it makes that click the centre, with the radius where the drag lets go. A
  second click makes the first a rim point. A drag that comes after two
  clicks is not a centre: the third press commits on the press.
- **Tangent, on the circle.** In `auto`, a rim click whose snap is `curve`
  (along a line, circle or arc, but not at a vertex, a midpoint or a
  crossing) makes the circle tangent to that curve instead of leaving a rim
  point on it. Letting go of a drag the same way does the same. **Letting go
  of a drag on a point makes the circle pass through it** (`oncircle(point,
  c)`): this was not in the spec, and it is the same idea of constraints
  set by where you click. A rim let go on a midpoint, a crossing or a
  projected point sets the radius to the cursor and adds nothing, which is
  what the old drag-out circle always did. Some cases fall back to an
  ordinary rim point on the curve: a curve already touched by an earlier
  click, and a curve outside the gesture's plane, since a 3D `tan` puts the
  line in the circle's plane.
- **The tangent preview is the circle the click will build.** The circle
  through two points tangent to a line, and every mix of points and
  tangencies, is found by a small damped Newton fit in the plane
  (`fitCircle`) from the circumcircle of the clicks. It keeps the side of
  each line, and the inside or outside of each circle, that the clicks are
  on. It seeds the commit as well. Where it finds nothing, the preview is
  blank and the click is answered with guidance. It is only for the preview
  and the seed: the relations and the solver hold the circle.
- **Tangent, on the arc.** `auto` offers it by snapping. When an end of the
  arc is at the end of a line or arc in the plane, and the bulge comes within
  8 px of the arc that leaves that end smoothly (the circle through both ends
  tangent to the curve there), the bulge is pulled onto that arc. The commit
  adds `tan(curve, arc)`, and the panel reads `tangent` while the bulge is
  there. **The `tangent` lock is Onshape's tangent arc**: you press on the
  end of a line or arc, then drag or click to where the arc ends. The arc
  leaves the curve going on in the same direction, with no bulge step. A
  start anywhere else is answered with guidance.
- **The circle's `tangent` lock takes only lines and circles**: three clicks
  along curves make the circle touching all three (for example, a triangle's
  incircle, or whichever touching circle is nearest the clicks). A click on
  empty space, a vertex or the same curve twice is answered with guidance.
- **Every lock is the old tool.** `centre` is the old drag-out circle, which
  infers nothing at the rim; a click then a click (centre, then rim) works as
  well. `3pt` is circle3: a click along an edge leaves a rim point on it. The
  arc's `centre` is the old centre-point arc, and a first drag from the
  centre sets the start. The arc's `3pt` is arc3, and a drag may stand for
  the two end clicks. **Sixteen files written by the old tools** (2D and 3D,
  test/fixtures/curve-tools-v13.json) come out byte for byte from the new
  tools, locked, and from `auto` for every gesture whose meaning did not
  change.
- **The panel shows the method inside the drop-down, not beside it.** The
  spec does not say where the reading goes. A label and a drop-down side by
  side did not fit the panel's width: on screen, "centre · radius" was cut to
  "centre …", and "auto: centre · radius" was cut on the phone as well. So
  the drop-down fills the row. While the method is `auto` and has read
  something, the box shows what it read, in the preview's amber. The list
  underneath still holds only the locks. The arc's centre method is labelled
  `centre · ends` (the spec named only the circle's three).
- **A choice is a new kind of option.** The method is a word, not a number or
  a flag, so `options.ts` now has declared `choices`. A string default must
  list its choices, and anything else is refused by name. `arm` names the
  choices when it refuses a word. A remembered word that is no longer one of
  the choices is ignored, like any stale value.
- **Typing `circle3` does not change what the Circle button does next.**
  `circle3` arms the tool locked, but the lock is **not remembered**. A lock
  picked in the panel, or typed as `arm("circle", { method: "3pt" })`, is
  remembered like any option. Remembering the alias would leave someone who
  typed `circle3` once with a Circle button whose drag no longer draws. The
  log line says what was armed:
  `armed: circle3 — the circle tool, locked to 3 points, arm("circle", {method: "3pt"})`.
  `tools()` lists both old names after the tools. A tool that someone
  registers under one of those names wins over the alias.
- **`tan` between two circles extends the existing relation and adds no new
  op**, so `replenv.ts` and `persist.ts` needed no new entry. The side
  (`"outside"` or `"inside"`) is read from the drawing when it is not given,
  and it is **written to the journal as read**, so a replay never guesses
  again. Inside is `|c₁ − c₂| − |r₁ − r₂|` and outside is
  `|c₁ − c₂| − (r₁ + r₂)`; neither is a square. In 3D it also holds the
  second centre on the first circle's plane and the two normals parallel,
  which is tested on a tilted plane. `tan(circle, line)` works as well as
  `tan(line, circle)`. The glyph sits where the two circles touch.
- **The menu lost its two 3-point items**, for the same reason the toolbar
  lost its buttons.
- **Changing the lock in the middle of a gesture starts the gesture again**
  (the tool is armed afresh). Nothing had been made yet, so nothing is lost.
- **The tool is now called `circle` or `arc`** while it is armed: in
  `activeTool`, in the panel's strip, and in guidance such as
  `circle: those three are on one line — click the third off it`. Tests that
  read `circle3` there were updated; the claims they make are unchanged.
- **Existing tests.** Every claim is kept. The changed expectations are the
  button count (13 → 11), the menu's items, the curve tools listed, the tool
  names above, `tools()`'s line with `method` in it, a string now being a
  valid remembered value, and the summaries. The unit tests that drove
  `Circle3Tool`/`Arc3Tool` drive the one tool locked to 3 points
  (`test/lockedtools.ts`). The layout arithmetic in `touchlayout.test.ts` and
  `chrome.test.ts` stays at thirteen buttons, the longer tray, as arithmetic.
  `fits.test.ts` checks that the app's own eleven fit every iPhone.
- **Found by looking: a phone's tooltips, with eleven buttons.** On an
  iPhone SE, and on a 13 in portrait, the toolbar is now one column the
  screen's height. A tooltip wider than the room beside the column fitted no
  side, so it was clamped back over the column (`fits.e2e.ts` and
  `tooltips.e2e.ts` caught it). `tooltip.ts` now narrows a column's tip to
  that room (`roomBeside`, at least `MIN_TIP_W`), and the text wraps beside
  the column. This is outside the spec, and it is tested in unit and e2e. On a
  13 in landscape the tray is now one row, and `fits.e2e.ts` expects one
  there and two on an SE. The docking-through-a-rotation test defines two
  tools to get back the thirteen it was measured at. At eleven, the column
  rotates into two lines that are set beside the logo's corner rather than
  under it; that is recorded in TODO.md and left to a layout package.
- **Left in place deliberately.** The side of a circle tangency is stored as
  a word, so an entity *named* `outside` or `inside` would look like it is
  named by that relation. Arc-to-circle tangency at an arc's end works only
  for an arc in the gesture's plane. The tangent snap's 8 px is measured
  along the chord of the two ends, which is exact in a square-on view and
  only approximate in an oblique one.
