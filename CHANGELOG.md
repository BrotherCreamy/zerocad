# ZeroCAD — changelog

What has actually been built, **newest first**. `TODO.md` is what's next;
`STATUS.md` is the itemised account of what exists and why it's shaped the
way it is; `CONVERSATION_LOG.md` is the longer narrative behind the
decisions.

---

## 2026-11-12 — there is no sketch: the Plane tool, Draw on this face, a group's definedness, and a tool's guidance in the hand's word

*Merged into the working branch (`3fc5372`), a clean merge. The gate on
the merge: typecheck 0; unit 2145/2145 (load 3–6); the nine browser files
the rename touches most — nosketch, panels, tooltips, toolhowto,
organiser, sketchmode, sketchmodephone, workbenches, contextmenu —
106/106. The full browser suite was run by the worker on this same tree
(841/845, the four its own expectations, fixed and rerun 49/49).*

The owner: *"There is no such thing as a sketch. There are geometry groups
(you can come up with a better name… reason I don't want to use sketch is
it implied exclusivity, but I want geometry to be able to belong to
multiple groups). A group is only fully defined when every element within
the group is fully defined."* The model already was this — a group is a
set that owns nothing, an entity is in any number of them, a plane is
where a click lands and an `onplane` if one is made — but the **word** was
everywhere a person read, and every use of it said that geometry is inside
a container (docs/plans/no-sketch.md, with an *As built*).

| | |
|---|---|
| ![Desktop: the Plane tool armed over a 60 × 40 × 15 block from above its front-right, the lid lit green with Top, Front and Right as faint patches round it; the chip reads plane · click a lit face or plane to draw on it, the options panel plane · on · Top Front Right](docs/images/525-the-plane-tool-armed-over-a-block-the-lid-lit.png) | ![The lid taken: the view square to it, the lid tinted green, the chip reading on e1's top ⊥ Done · select, the log's workplane("p5.p6.p8")](docs/images/526-the-lid-taken-the-chip-says-on-e1s-top.png) |
| ![The lid's right-click menu, Draw on this face first — workplane("p5.p6.p8") beside it — then Edit e1, Flip direction, the tools](docs/images/527-the-face-menu-draw-on-this-face.png) | ![A 60 × 40 rectangle held still — a corner fixed, two sides dimensioned 60 and 40, every side along an axis — and a fixed point p5 in it, all one group: the organiser's g1 row with a filled dot before its 9, the status SOLVED · 0 free](docs/images/528-a-group-of-a-held-rectangle-the-filled-dot.png) |
| ![p5's fix deleted: the dot hollow in the free ink, the status 2 free, and the row's menu open — g1 group of 9 members · 1 of 9 free, with Select what is free typing select("p5")](docs/images/529-the-point-let-go-the-hollow-dot-and-select-what-is-free.png) | ![Select what is free chosen: p5 alone selected, magenta, inside the still-held rectangle](docs/images/530-what-is-free-selected.png) |
| ![iPhone 13, the block typed and nothing yet touched: the chip reads select · tap a thing, or hold and drag to box](docs/images/531-iphone-before-any-touch-the-status-says-tap.png) | ![iPhone 13: the Plane tool tapped — its chosen tip Plane / Draw on a face or Top, Front, Right: all you draw stays on it / Tap a lit face — or Top, Front or Right in the options …, the block's faces lit, the options row Top Front Right](docs/images/532-iphone-the-plane-tool-chosen-the-chip-says-tap.png) |
| ![iPhone 13: the lid tapped, the view square to it, on e1's top ⊥ Done in the chip](docs/images/533-iphone-the-lid-tapped-on-e1s-top.png) | ![iPhone 13: the offset tool tapped on empty canvas — the log's offset: tap a line, arc or circle — the chain it is in is offset](docs/images/534-iphone-a-tools-miss-says-tap.png) |
| ![iPhone 13: the line tool chosen — the chip line · tap the start, the tip Draws lines: tap the start, then the end of each in turn](docs/images/535-iphone-the-line-tool-chosen-its-summary-says-tap.png) | ![iPhone 13: the g1 row held — its menu, g1 group of 9 members · 1 of 9 free, Select what is free among the items](docs/images/536-iphone-the-hollow-dot-and-the-held-rows-menu.png) |

- **The word is gone from everything a person reads.** The "sketch" tool
  is the **Plane** tool (`src/tools/plane.ts`, registered `plane`, icon as
  it was): *Draw on a face or Top, Front, Right: all you draw stays on it*.
  "Sketch on this face" is **Draw on this face**, first on a face's menu;
  the frame's item is **Draw on this**; the chip's menu reads *drawing on
  e1's top*; `help()` says a plane to draw on is the work plane, not a
  feature and not a container. Error messages say *profile* or *drawing*.
  `arm("sketch")` is an alias (`TOOL_ALIASES`, beside `circle3`) that arms
  the plane tool and says so. The "Sketch" workbench is **Drawing**
  (`drawing`); `workbench("sketch")` and a file saved in it open it
  through `WORKBENCH_ALIASES`, never listed, never written back. The
  module keeps its id `sketch`, labelled *Drawing: …*. Code names where
  cheap (`drawingPlaneRef`, `drawOnFaceCommand`, `facePlaneFor`,
  `PlaneTool`, `faceplane.ts`); the plan files keep their names with one
  line at the top. `test/nosketch.test.ts` greps every string literal in
  `src/` (the quoted module id the one exception) and asks every tool
  name, summary and how-line, every label, `help()`, the menus and the
  chip at run time.
- **A group is fully defined when every member is** — a reading, not a
  count of its own: `organiserSections` and `rowMenu` take the last
  diagnosis's `free` set (the one the free ink is drawn from). A group row
  wears a dot before its count: filled when no entity member can move,
  hollow in the free ink when some can (a faint ring before a solve); its
  tooltip says *1 of its 9 members can still move*; **Select what is free**
  on the row's menu types `select(…)` of exactly those, and is off with the
  reason when every member is held. The menu's header says *fully defined*
  or *1 of 9 free*. A relation in a group is counted neither way. No new
  solve, no new relation. The count is of members, not of the group's
  degrees of freedom (the register says why).
- **A tool's running guidance is the hand's word** (picture 503 said
  "click a thing" on an iPhone). A summary says `{tap}` where a how-line
  does and `toolSummary(name, hand)` reads it for the hand asking; every
  line a tool logs while running passes through the engine's `ctx.log`,
  which fills `{tap}` for the hand last on the canvas — once, in the one
  place every tool's line goes. A source scan refuses a one-hand "click"
  in `src/tools`. Picture 503 itself was the picture helper's mouse move
  (the hand had been seeded from the device since 2026-11-05); picture 531
  is the same screen with no mouse, saying *tap*.
- **The blank status in pictures 515 and 521 is the fade, by design**:
  `SOLVED` and a count that nothing agrees with fade after 3 s
  (`statusFade`, statusline.ts line 34; `showDiagnosis`, main.ts) and a
  faded status is `display:none` (index.html), text kept. Picture 510 kept
  its *4 agreeing*. Measured in `nosketch.e2e.ts`: shown as the operation
  lands, shown again at the next, `data-faded` 3.6 s on with the text
  still `SOLVED`. Nothing changed.
- Unit: `test/nosketch.test.ts` (7), `test/organiser.test.ts` (+1); the
  suites that named the sketch tool or its words follow the rename. E2E:
  `nosketch.e2e.ts` (6, mouse and iPhone 13). Decisions in TODO.md's
  register; the alternatives in CONVERSATION_LOG.md.

Measured on the merge with gate-stability (`2f062ff`): typecheck 0; unit
2145 of 2145 (load 3–8.5); kernel 11 of 11; browser 845 tests, 841 passed,
2 picture skips, 2 failed — both expectations this package changed
(`tools()` listing the `sketch` alias after `circle3`, panels.e2e.ts; a held
tooltip under a finger saying *tap*, tooltips.e2e.ts), fixed and rerun 49 of
49 in their two files at load 2.6–5. The full run took 28 minutes at load
0.4→9.4→3.8, with another worker's suite beside it; the Android font-scale
test, overlaylock's see-through tests and fits.e2e.ts all passed in it.

## 2026-11-12 — the gate made trustworthy again: four failures that were not the app's (and one that was, in the browser only)

*Merged into the working branch (`36ce753`) after through-all and fillets;
the Android bug is **79** here, since fillets' pick tie took 78 first.
Four doc conflicts spliced newest-first. The gate on the merge: typecheck
0; unit 2137/2137 (load 5–9); the eleven browser files the package
touches plus the two newest packages' own — android, overlaylock,
undokeys, fits, chrome, pwa, touchdensity, iosback, sketchmodephone,
filletsonething, throughall — 115 pass, 2 picture skips, 0 fail: the
Android font-scale test passes on this container's Chromium 153 for the
first time since the browser changed.*

Four tests failed on the base branch, and every worker's gate tripped on
them. Each was reproduced and measured before anything was changed
(`claude/gate-stable`; the runs are counted alone and with two other e2e
files looping on the same four cores, and every run's load average was
kept).

- **Android's font scale, measured** (android.e2e.ts) — **the app's, in the
  browser only: bug 79 (77 on the branch; tool-howto took 77 first, so renumbered on the merge).** The browser under the suite became Chromium
  153.0.8010.12 when the container was rebuilt, and 153 reports
  `env(preferred-text-scale)` only to a page carrying `<meta
  name="text-scale" content="scale">`; every other page is told 1, whatever
  the system's scale (141 told every page). The app read 1 and said *text
  size 1.00* under a scale of 1.3. Measured, in the binary's own flag
  (`--blink-settings=accessibilityFontScaleFactor`) and by CDP's
  `Emulation.setEmulatedOSTextScale`, which agree: with the meta the page
  is told the system's scale × the browser's font size ÷ 16 (1.3 at 20 px
  reads 1.625) and `medium` moves too; with the meta taken out again both
  are back. So the page asks: where the plain reading is exactly 1 on
  Android under a finger, the meta goes in, the variable is read, the meta
  comes out, all before the first paint, and the browser's own share is
  divided out so the rule (system × browser) counts it once
  (`systemTextScale`, uiscale.ts; the table is in android.md). The e2e says
  by version which reading this Chromium gives and fails there, saying so,
  if neither does; it also checks 1.15 at a 20 px browser font reads *text
  size 1.44*, not 1.80. Base: 0 of 3 runs at load 45–50. After: the test 5
  of 5 at load 36–52 and 2 of 2 after that (the loaded runs below).
- **The see-through log line** (overlaylock.e2e.ts, all five ways) — **the
  test racing the app's fade.** A tail line is whole for 3 s and gone at 10
  (logtail.ts), and one contrast sample is four screenshots; traced with
  the line's age and opacity stamped on each shot, one screenshot took
  1.7 s and once 7.7 s under load, so the line was shot at opacity 0.5, or
  after it had gone, and the two shots agreed at every pixel: *some ink to
  sample (0 pixels)*. The fade is the design, 3 s whole is readable, and
  nothing in the app changed. The sample holds the fade off for its own
  length (`animation: none`, so the line is drawn as a fresh one is), polls
  for the ground it is meant to be over instead of sleeping (the lid read
  dark once at load 45), and says the line again if it aged out mid-sample.
  Base: 2 runs of 2 failed at load 35–45, four of five ways each. After:
  see below.
- **The cost test's 2000 ms** (conflicts.test.ts) and **what a conflict
  names on the product's 500 ms** (profilesheld.test.ts and four more
  files) — **wall-clock in a unit test on a shared box.** The search read
  2255 and 2888 ms with other suites on the box and 235 ms alone; the 500 ms
  budget ran out and the bound's fallback named others. The cost is counted
  now in what the model asked the kernel for — solves and iterations, per
  fixture and for the forty rectangles (25 solves, 130 iterations), against
  the product's 200-trial budget — with the clock printed beside it and
  asserted only under `NEOCAD_TIMING`. The bound itself is tested on a
  clock the test turns, 100 ms a reading: five trials, the culprit named
  alone, `found` false, the same on any machine. Every test of *what* is
  named lifts the clock (`searchMs = Infinity`), as culprit.test.ts always
  did. Base: conflicts 9 of 10 at load 24–57; after: see below.
- **Nothing to undo, said beside the verdict** (undokeys.e2e.ts) — **the
  test racing the note's fade.** The note clears itself after 1.6 s; the
  test read it 150 ms after the key plus two round trips, and under load
  that was once past it (`'' !== 'nothing to redo'`). Every read of the
  note now waits for the words it expects, or reports what it says at 3 s.
- **The dev server, watched** (test/e2e/run.ts). In a full run on the
  merged base vite died partway under four workers' load, and the run said
  *no dev server at …* twenty-one times from modefeedback onward. The
  runner keeps the server's last stderr lines, hears it exit, prints a
  banner saying when and how (`killed by SIGKILL`, or its code) and what it
  last wrote, starts it again on the same port (twice at most; a third
  death stops the tests, since every failure after it would be the
  server's), and says again at the end which failures to run alone before
  believing. The harness's own message points at the banner.

- **Three more things the loaded runs taught** (load 30–40: my two
  looping files beside the other workers'). The fade's own test read a
  line at 0.52 where the rule said 0.42 at its age: the fade is a CSS
  animation on the browser's frame clock, which runs behind the wall clock
  under load and never ahead of it, so the test reads each line against its
  own age and allows the frame clock up to 3 s behind. Four screenshots
  outlived the tail's 10 s even with the fade held, so the sample keeps the
  sampled line young by the app's own stamp (`data-at` set to now before
  each shot). And a renderer crash ("Target crashed") left a file whose
  tests had all reported sitting 38 minutes in `browser.close()` — and
  another worker's two full runs sat 50 minutes each on fits.e2e.ts after
  the same crash, on a CDP `send` the browser never answers for a target
  that is gone. **A crashed target fails its test and never holds the
  suite** now (harness.ts: `bounded`, `timedCdp`, `closeBounded`): every
  CDP session the suite opens has its sends bounded at 30 s, every browser
  close at 15 s, and run.ts gives every test a 15 minute timeout, so what
  none of those covers still ends as a named failure, not a runner that
  waits forever.

**Counts, before → after.** Each run's load average was kept; "loaded" is
two e2e files looping beside the run on the same four cores, on top of
whatever the other workers were doing.
- Android's font scale: base 0 of 3 (load 45–50). After, the test itself:
  5 of 5 at load 36–52, 2 of 2 at 17–27, 2 of 2 loaded at 24 — 9 of 9.
  (One of the first five runs lost *files on Android before Chrome 132* to
  a 20 s wait at load 52; not this test.)
- The see-through tests, all five ways: base 0 of 2 runs at load 35–45
  (in each, four of five ways failed on the ink, one on the touch
  harness's lost tap). After the first fix: 1 of 1 at load 12; 2 of 3 at
  17–29, the one failure the fade's own test, fixed next; loaded at 30–40,
  1 of 3, the failures the line's removal (then kept young), the frame
  clock (then allowed for) and the renderer crashing. Final, loaded at
  load 15–32, three runs, fifteen ways: **the ink assertion failed in
  none**; the runs were 1 of 3 green, the four failures being two renderer
  kills — the container's memory cgroup's OOM killer, `dmesg` says, on a
  16 GB box with every worker's browsers on it — and two of the touch
  harness's lost taps (`24 !== 25`, the older entry).
- The cost test: base 9 of 10 at load 24–57 (2888 ms). After 10 of 10
  alone (load 6–16, search 160–235 ms, 25 solves every time) and 5 of 5
  loaded at 23–29 (search up to 832 ms, 25 solves every time; the clock
  no longer asserted). The bound on the turned clock: 5 solves every run.
- Profiles held: base 10 of 10 at load 42–57 (it did not fail for me);
  after 10 of 10 and 5 of 5 loaded.
- Nothing to undo: base reproduced, 1 of 3 loaded at load 28 (`'' !==
  'nothing to redo'`); after 6 of 6 alone (load 6–10) and 3 of 3 loaded
  at 26–30.
- The server's death, rehearsed by SIGKILLing vite under a run: twice 50 s
  apart, the banner each time, the files after it green against the
  restarted server, the two in flight failed with the signatures the
  banner now names.

**The gate.** Before the merge with the working branch, at load 22–29:
typecheck 0; unit 2081 of 2081; kernel 11 of 11; e2e 812 tests, 810 pass,
2 picture skips, 0 fail. After it (through-all #94 and tool-howto #90 in),
at load 6–13: typecheck 0; unit 2120 of 2120; kernel 11 of 11; e2e 831
tests, 826 pass, 2 skips, 3 fail — sketchmodephone's three, the first
*'select' !== 'sketch'* (the phone's first tap after the sketch button
lost, the touch harness's known loss, filed) and the other two downstream
of it in the same page; the file alone, three times: 3 of 3.
## 2026-11-12 — a fillet is one thing: the corner is kept as construction on both profiles, the solid's edge fillet is the sketch's, and anything can be construction

*Merged into the working branch (`0b2560f`) on top of the through-all
package; twenty-three conflicts, most of them the format literal (23
stands, both packages' notes and old-file paths kept), the docs spliced
newest-first. One meeting point in code, patched in the merge:
`regenerateRounded` now hands a through-all `"end"` entry on and chooses
every through-all end's far point again after a rounding, as
`regenerateFound` does. The gate on the merge: typecheck 0; unit
2136/2136 (load 7–12); kernel 11/11; the eighteen browser files the two
packages touch — filletsonething, throughall, regen, deletion, dimensions,
extrude, loops, organiser, reviewrelations, sketchedit, sketchmode,
contextmenu, firstrun, tooloptions, solidtools, solidtoolsphone, camera,
workbenches — 139/139. The full browser suite was run by the worker on the
branch before the merge (828/833, the rest known and accounted for in its
PR).*

The owner: *"adding them to the originating chain/loop of a region of a body
shouldn't break the body. The change should propagate through the entire
hierarchy (yes: hierarchies do exist, but they are not timeline based). Also,
adding a 2d fillet to the originating chain of a region of a body should
produce an identical outcome to 3d filleting that edge. Also, the previous
geometry should not be deleted - as in the two lines and corner point on the
two linked sketches which form the extrude - it should be made into
construction geometry. Note: anything can be construction. Lines, points,
planes, bodies. Anything is fair game."* (docs/plans/fillets-one-thing.md,
with review item 7; format 22).

| | |
|---|---|
| ![Desktop, hidden-line view of the 50 × 30 × 10 block from above its front-right: the fillet tool's R6 at the front-right corner, the arc between two short lines on base and lid, the old corner p2 and its two edges still drawn thin in the construction teal on both profiles, the chord between the corners too; SOLVED · 2 free · 4 agreeing, as before the cut](docs/images/490-the-fillet-tool-on-a-base-corner-the-body-rounded-the-corner-kept-as-construction.png) | ![The same block in a second app, the solid's edge rounded by name — fillet("e1", ["e1.m0\|e1.m1"], 6) in the log, answered a1 — and the picture the same to the pixel: the same arc, the same construction corner on both profiles](docs/images/491-the-solids-edge-fillet-typed-the-same-model-entity-for-entity.png) |
| ![The bevel tool tapped on the lid's back-left corner: the log reads chamfer("l7", "l8", 5) — the base's two lines, though the lid's corner was picked — the corner cut on both profiles with a 5 label, the old corner kept](docs/images/492-the-bevel-tool-on-the-lids-corner-the-body-chamfered-both-profiles.png) | ![construction("p6") answered [p6, p2]: the lid's front-right corner and its partner on the base drawn as rings, the block whole](docs/images/493-a-construction-point-a-ring-on-both-profiles.png) |
| ![construction("e1"): every face of the block in the construction ink's dark teal, the Features row reading extrude · construction](docs/images/494-a-construction-body-drawn-as-reference.png) | ![The sketch tool on a kernel chamfer's face: the log's refusal in full — that face is e2's, a chamfer the solid kernel cut along an edge, nothing in the model lies on it … a chamfer between two walls is the sketch's own — and then the lid beside it taken, the view square to it, on e1's top](docs/images/495-a-kernel-chamfers-face-refused-as-a-sketch-plane-the-lid-taken.png) |
| ![Shaded: a boss 6 high on the block's lid, and fillet("l1", "l2", 6) of the base's corner: the rounded corner runs the full 16 up through both bodies, R6 on it, the Bodies row e1 +e2 2](docs/images/496-a-boss-on-the-lid-and-the-base-corner-rounded-through-both.png) | ![iPhone 13, shaded: the fillet tool tapped on the lid's front corner, the body rounded there, R6 by the arc](docs/images/500-iphone-the-fillet-tool-on-the-lids-corner-the-body-rounded.png) |
| ![iPhone 13: the bevel tool tapped on the lid's back-left corner, the block chamfered there top to bottom, the 5 label above it](docs/images/501-iphone-the-bevel-tool-on-the-lids-corner.png) | ![iPhone 13: construction("p6") answered [p6, p2] in the log, the block shaded as before](docs/images/502-iphone-a-construction-point.png) |
| ![iPhone 13: construction("e1") — the block's three faces in the dark teal](docs/images/503-iphone-a-construction-body.png) | |

- **A sketch `fillet` or `chamfer` keeps the two lines and their corner**,
  exactly as drawn, with every relation on them, and flags them construction
  (`cornerCut`, `shortenLegs`, operations.ts). New: a tangent point on each
  line, held `on` it; a shorter line from each far end to it; the arc (or
  the chamfer's line), `tan` to the two construction lines. A dimension to
  the corner still measures the sharp corner — the fillet that re-pointed
  moved the corner onto a tangent point, and a 40 wide block rounded at 5
  became 45 wide (its solid 10969 for 9946). A second cut at a line's far
  end shortens the shorter line in place; four rounded corners are four
  construction lines, four real ones, four arcs. `extrude("l1")`,
  `revolve` and `region` named by a line set aside take the line made in
  its place (`standsFor`). A chain (`offset`, `trim`, `extend`,
  `chainThrough` in sketchedit.ts) runs past a construction curve unless
  asked from it, so an offset of the rounded outline is five copies, the
  shorter lines' and the arc's, not the sharp corner's too. A pick
  (`hitTest`, picking.ts) within half a pixel of both prefers the real
  curve: the trim tool's click on the shorter line took the construction
  line over it, and the offset tool's chain from it was one line —
  browser-only bug 78 (docs/ARCHITECTURE.md), found by the sketch-edit e2e
  with the unit suite green. Seventy-eight.
- **A record standing on the corner sets its half aside and is rebuilt on
  the rounded loop** (`regenerateRounded`, `ExtrudeFeature.aside`): the
  twin lines, the twin corner and the chord between the corners stay,
  construction, and the corner's pair stays in the `extrusion`, so the two
  construction lines are still partners. Then the same cut as the other
  profile has it is the next job: a boss on the lid is cut at that corner
  too. Not timeline-based: the records and the links are read, never the
  order they were made in. A kernel fillet that named a wall by its place
  is re-pointed to the place the wall has now (`remapBlends`).
- **The solid's edge fillet between two walls is that call**
  (`profileCorner`, blends.ts): `fillet("e1", ["e1.m0|e1.m1"], 6)` typed is
  `fillet("l1", "l2", 6)` — the same entities, relations, record, journal
  entry and body, compared entity for entity and face for face
  (`test/filletsonething.test.ts`). A fillet asked of the lid's lines is
  made on the base (`baseCorner`). A rim edge, an edge between features, a
  round wall's edge: the kernel's blend, as before; a mixed list makes the
  record first.
- **The `tan` relation reads a touching point held `on` the line**, not only
  a shared end (the join form). Measured first with the distance form: `r9`
  redundant on a sketch-mode profile's fillet, the `on` and the distance a
  double root at the tangent point.
- **Anything can be construction** (`Model.setConstruction` on a curve, a
  point, a frame, a feature — its body): a point cuts no edge it is held on
  (a T made by one is no vertex, loops.ts); a frame is never the plane a
  feature is laid out by unless named; a body is drawn in the construction
  ink's teal (`referenceRGB`), left out of `exportStep` (said), never the
  body a new feature joins or cuts unless named (`defaultMode`), its row
  saying *construction*. A linked profile's entity is flagged with its
  partner; an outline edge flagged leaves its extrude **open** until it is
  cleared (it was refused). One row on every menu, a body's too. A
  construction point is drawn as a ring, a construction frame in the
  construction ink.
- **Review item 7**: the sketch tool refuses a kernel chamfer's own face,
  saying why and what works (`chamferOfFace`); the frame once made there is
  not made. A chamfer of a profile corner is a wall now, sketched on like
  any wall.
- **Format 22.** `fillet` and `chamfer` mean something else, so a file from
  before is marked on the way in: `"repointed"` on each (cut as that build
  cut it, its later names kept), `{ alone: true }` on each `construction`
  (what it named, no partner); the marks stay on save.
  `test/fixtures/fillets-v21.neocad.json`, saved by the build before this
  one, opens to the model it was.
- Unit: `test/filletsonething.test.ts` (17); the suites that asserted the
  re-pointing fillet now assert the kept corner. E2E, mouse and iPhone 13:
  `filletsonething.e2e.ts`. Decisions in TODO.md's register; what was tried
  and dropped in CONVERSATION_LOG.md.

Measured on the merge with tool-howto: typecheck 0; unit 2112 of 2112;
kernel 11 of 11; browser 833 tests, 828 passed, 2 picture skips, 3 failed —
the known Android font-scale measurement (fails on this container's browser
regardless of the code, 3 of 3 alone) and the two overlaylock see-through
tests, which pass alone (3 of 3) and fail only under four workers' load.

## 2026-11-12 — through all is a relation: the far vertex on the cut's lid, and up to face is the same relation the other way

*Merged into the working branch (`bcccf00`) on top of the tool-tips
package; one conflict, this file, spliced newest-first. The gate on the
merge: typecheck 0; unit 2119/2119 (load 14–23); the seven browser files
the merge touches — throughall, tooloptions, toolhowto, solidtools,
solidtoolsphone, depth, camera — 56/56. The full browser suite was run by
the worker on the branch before the merge (804/818, every failure
accounted for in its PR); the `fits.e2e.ts` hang after a browser crash
that held both of its runs is passed to the gate-stability package.*

Review item 8, which the owner passed: *"Through all should be a relation to
the far face's defining geometry."* His principles: *"correct relationships
BETWEEN entities … bidirectional relationships everywhere by default"*, *"I
should be able to pull on anything"*, *"hierarchies do exist, but they are
not timeline based."* Spec: [`docs/plans/through-all-relation.md`](docs/plans/through-all-relation.md),
with an *As built*. Pictures 510–521 in `docs/images`, mouse and iPhone 13.

- **What was true before, measured** (`test/throughrelation.test.ts`'s first
  three tests, `test/through.measure.ts`): a through-all cut's lid was held at
  a number the solids layer worked out, read as a constant inside the
  `extrusion` row. One way: the cut's far rim pulled, the plate moved
  **0.000**. No row read the cut's lid and the plate together. Nothing was
  listed. And a plate with a through hole in it **could not be dragged at
  all** — a corner pulled 8 moved 0.000, along the plate and off it. Two
  through cuts compounded: the second stood a tenth past the first one's
  tool.
- **Built**: a through-all extrude's lid is held by `onplane("p7", "e2.lid")`
  — the far vertex of what its swept profile meets, named `e2_through`,
  listed, marked at the vertex and on the cut's far rim, deletable (a blind
  cut where it stood, one journalled step), named in a conflict. The
  `extrusion` gives no length row while it stands; the lid is **on** the far
  face, and the kernel builds a cut's tool a tenth past it. The plate set
  deeper: 7 iterations and 8 ms where it took 35 and 63 (a hole and a pocket:
  8 and 13 for 9 and 50). The corner dragged 8 moves 8.
- **Up to face**: the end row's third choice and one press on the face —
  `onplane(<lid point>, "e1:l2")`, `e2_upto`, held both ways for a flat face
  parallel to the sketch; refused in words for one that is not; a round wall
  or a face only the kernel knows placed at the press.
- **Placed, not faked**: a round far side (a revolve) or nothing met leaves
  an ordinary depth, labelled "through (placed)", with the log saying to set
  the end again after a change.
- **Chosen once, by an operation**: the call, `setEnd`, `regen` and `fillet`
  journal the vertex they found (`{ end: "through", to: "p7" }`,
  `setEnd("e2", "through", "p7")`, `[e2, [], "end", "p9"]` in a regenerated
  list); a replay runs on seeds and searches nothing. A turn that leaves
  another corner farther is said in the organiser's row ("short") with one
  tap to take the far side again — never re-pointed inside a solve.
- **Format 23**: a file from before replays its through cuts as they were
  and, once its saved values are back, finds each far side once and writes
  the `setEnd` at the journal's end; it re-saves in the new form and opens to
  the same solid (`test/fixtures/through-v21`, by volume).
- **The hook is gone**: `defineThroughReach`/`throughReach` are no more;
  `lidReach` lives in relations/extrusion.ts and reads the model alone;
  `src/farside.ts`, at the operations' height, says which vertex.
- **Tried and kept out**: a cap's normal as a column of the row. It settled a
  drag that had stalled — but let a contradicting dimension be met by sliding
  the hole 150 along the plate and leaning the cut half a degree, SOLVED
  where it is a conflict. The datum stays; both are in the register and
  `CONVERSATION_LOG.md`.
- **Slower where it moves at all**: a resize drag of a plate with a hole and
  a pocket, twelve frames, 1.6 s where before the drag did nothing; filed.
## 2026-11-12 — a tool says how to use it: on a hover, and on a phone as it is chosen

The owner, asked to try adding a parallel relation: *"I don't even know how
to add a parallel relation. Maybe a little tooltip should pop up when I hover
over (desktop) or select (phone) a tool."* (docs/plans/tool-howto.md).

| | |
|---|---|
| ![iPhone 13, Constrain just chosen from behind the Dimension button: its tip beside the tray's top, over the organiser, the strip and the log — Constrain, what it does, three steps (tap the things to relate; then choose: Parallel, Tangent…; pick several for one relation, hold a line for Leave), and Hold this button for Dimension; the palette below saying what can be picked](docs/images/480-iphone-constrain-chosen-its-tip-says-how.png) | ![Two lines tapped, one of them through the tip, which has gone: the palette lists Parallel, Perpendicular and 6 more…, the section that said "no relation yet" gone to make the room](docs/images/481-iphone-two-lines-tapped-parallel-and-perpendicular-no-more-needed.png) |
| ![Parallel pressed: par("l2", "l1") in the log, the two lines parallel at their own lengths, a // mark on each (the upper one's partly behind the log), the palette waiting for the next](docs/images/482-iphone-parallel-pressed-the-two-lines-parallel.png) | ![Desktop, the mouse on Constrain in the relate button's flyout: the tooltip under the flyout with its three steps in a mouse's words between what it does and arm("constrain")](docs/images/483-desktop-hovering-constrain-the-tooltip-with-its-steps.png) |
| ![iPhone 13, Extrude chosen: its tip at the top — tap inside a closed outline; set the depth in the options, ⇅ turns it the other way; ✓ builds the solid; hold this button for Cut, Surface, Edge — and the options pane it speaks of clear below, the rectangle clear between](docs/images/484-iphone-extrude-chosen-its-tip-clear-of-its-options-pane.png) | ![The line tool chosen a second time: the three steps alone, no name, starting at the same line as the first](docs/images/485-iphone-the-second-time-the-steps-alone.png) |
| ![iPhone 13, a tap on the relate button, whose face is Dimension: its tip, ending Hold this button for Constrain](docs/images/486-iphone-dimension-chosen-its-tip-says-constrain-is-behind-the-button.png) | ![iPhone 13 on its side: the tip at the top right, over the command line's end, the strip, the log and the organiser's top — and over the right-hand ends of the two lines, the limitation filed](docs/images/487-iphone-landscape-the-tip-over-the-organiser-and-the-drawings-corner.png) |

- **Every tool declares how it is used** (`static how`, tools/tool.ts): the
  steps, three lines at most, in the words of someone doing them — `{tap}`
  reads *click* under a mouse and *tap* under a finger, a line may be one for
  each hand where they really differ (a chain ended by Esc or by Cancel), and
  a tool whose gesture depends on how it is armed says the armed one (a
  circle locked to 3 points never says to drag). `defineTool` refuses a how
  that is not lines of text, or is more than three. Select and the Hand have
  theirs (`ENGINE_HOW`). **Each line was written by doing it in the browser,
  mouse and finger** — which is how the lines differ from the files' own
  comments: a rectangle is a drag (two clicks do nothing), a point puts the
  tool down, a confirm puts a feature tool down. The whole table is in the
  spec's *As built*.
- **On a phone, choosing a tool shows its tip** (`Tooltips.announce`): name,
  what it does, how, and for a button that holds several tools what else is
  there — *Hold this button for Constrain.* **Constrain shares Dimension's
  button**; a tap arms the face, and until now nothing on the screen said the
  button held anything else. The tip takes no touch (no pointer events: a tap
  on it picks the line under it, e2e-asserted), goes at the next press, when
  the tool is put down, or once read (a second and 40 ms a character, 3–10 s),
  and the second time a tool is chosen in a session it is the steps alone
  (5 s at most). Holding a button still shows the full tooltip without arming.
- **Where it goes** (`chosenPlacement`, pure): the place that hides least of
  what matters — over the log and the organiser for nothing, the action strip
  and the command line at half the drawing's price, the drawing's middle
  third at four times it — never over the tray, the tool's own options pane,
  the palette or the logo's corner; and of places about as good, the first
  reading down, so every tip starts at the same line. On an upright iPhone 13
  that is beside the tray's top; no tip is taller than 187 px there. The
  eight-line tips (Constrain, Dimension) are clear of the drawing's middle
  third; the nine-line ones of twelve tools end 14–32 px inside its top edge.
- **On a desktop the hover's tooltip has the steps**, between what the tool
  does and its command; a click shows nothing more.
- **The parallel case**: with two lines tapped the palette shows Parallel
  *and* Perpendicular, then "6 more…" — the wasted row (TODO, review of #88)
  was the section under the rows, "l1, l2 have / no relation yet", 39 px of a
  164 px pane; where the rows overflow, a section with nothing in it now
  gives way first. And the palette's empty state says what to pick and what
  will be offered.
- **The setting**: `ui({ tips: false })`, and *Tips when a tool is chosen* in
  the logo menu's View; the viewer's, stored, never journalled.
- **Bug 77**, found pressing ✓ in the browser: its tooltip said "the tool
  stays armed", and a confirm has put the tool down since the opaque-solids
  merge. It says what happens.
- **Seen on the way**: before `review-solver` was merged in, `par` on two
  free lines shrank both to a few pixels and read SOLVED — the first picture
  482 showed two dashes. With it merged they keep their lengths; the picture
  is retaken on the merged code, and the e2e asserts the directions.
- **Merged with review-relations**: the constrain tool's steps say that
  several picked make one relation and that a line's menu has Leave, both
  done in the browser on the merged code.
- Tests: `test/toolhowto.test.ts` (15) and `test/e2e/toolhowto.e2e.ts` (13:
  eight under fingers — every tool on the tray and behind it chosen in turn —
  one in landscape, four with a mouse). No existing test's code changed
  (harness.ts's opening comment carries the count, seventy-seven). One of
  them now says less than it reads: `tooltips.e2e.ts` asserts a tap "shows
  no tooltip", true of `#tooltip` and silent about `#chosentip`.

## 2026-11-12 — where linked profiles met the solver package: the merge

Linked profiles (#93) was built beside review-solver (#92) and merged after
it. Two places met:

- **A conflict's inks on both ends.** The solver package gave each relation
  in a conflict a part (culprit, against, plain); linked profiles lit a
  conflict on a relation's twin as well. Together: the twin wears the same
  part as its partner (`solveAndRender`, main.ts).
- **The tripwire fired.** `test/culprit.test.ts` held a test written to fail
  when features stopped owning their relations, and it did: the extrusion is
  deleted like any other relation now. Decided: a conflict's set stays the
  user's relations alone; a relation a feature's record names is background
  by the search's own rule (`removable`), no longer because `del` refuses
  it. The test says that now.
- Browser-only bugs renumbered: the solver's are 74 and 75, the trim tool on
  a lid's edge is 76. Seventy-six.

Measured on the merge: typecheck 0; unit 2080 of 2080; kernel 11 of 11;
browser 813 tests, 790 passed, 2 picture skips, 21 failed — of which 20 were
the suite's own dev server dying partway under four workers' load (`no dev
server at …`, modefeedback onward), and those files rerun alone on a quiet
machine were 55 of 56; the one left is the known Android font-scale
measurement, which fails on this container's browser regardless of the code.

## 2026-11-12 — an extrude's two profiles are peers: every relation has a twin, an edit to one is an edit to both, and nothing is owned

The owner: *"i mean kind of like mirror relations"*; *"i don't like the idea
of anything being 'consumed' as this implies unidirectional hierarchy"*;
*"after extrude, it should be impossible to tell which was the original and
which is the derivative"*; *"Deleting a line would break it obviously. The
other side of an extrude profile is an identically linked profile/sketch
entities. If you change one the other follows automatically."*; *"If they
are truly twinned profiles, then reining in one side should trim on the
other also."*; *"hierarchies do exist, but they are not timeline based"*
(docs/plans/linked-profiles.md, with review item 4: features relate, they do
not own).

| | |
|---|---|
| ![Desktop, hidden-line view of a 50 × 30 × 10 block seen from above its front: a ⊥ pair at each of the eight corners, base and lid alike, the dimension 50 drawn once, along the lid's front edge, the depth 10 at the left](docs/images/443-a-dimension-on-the-base-drawn-once-on-the-lid.png) | ![set("d2_e1.value", 64) typed in the log: the label reads 64 and both front edges, the lid's and the base's, are longer; the block is still a right prism](docs/images/444-the-lids-dimension-set-the-base-follows.png) |
| ![A back corner of the lid dragged away: the back edge of the lid and of the base have both moved, the block deeper, every ⊥ still in place](docs/images/445-a-lid-corner-dragged-the-base-corner-with-it.png) | ![The lid's right-hand edge deleted: three walls standing with no lid, no base face and no right wall; the organiser's row reads e1 extrude · open, the Bodies section is gone, and the log says e1 is left out because it is open](docs/images/446-a-lid-edge-deleted-both-edges-gone-the-body-open.png) |
| ![The edge drawn back on the base with the line tool: a whole shaded block again, e1 back under Bodies, its row plain extrude](docs/images/447-the-edge-drawn-back-on-the-base-a-solid-again.png) | ![del("e1"): two blue rectangles one above the other joined by four chords, ⊥ marks on both, no feature in the organiser; the region rg1 still drawn on the lower one](docs/images/448-the-extrude-deleted-both-sketches-and-the-chords.png) |
| ![A short line drawn on the lid's face across the middle of its front edge](docs/images/449-a-line-drawn-on-the-lid-across-an-edge.png) | ![The trim tool clicked on the right half of the lid's front edge: the front wall is half as long, ending at the line; the other three walls stand; no lid; the row reads extrude · open and the log shows trim("l5", …) and e1 is open now](docs/images/450-the-lids-edge-trimmed-and-the-bases-with-it.png) |
| ![iPhone 13, shaded: the block with 50 along the lid's front edge and the depth 10](docs/images/451-iphone-a-dimension-on-the-base-drawn-once-on-the-lid.png) | ![iPhone 13: the label reads 64, the log's last line d2_e1, the block longer along both front edges](docs/images/452-iphone-the-lids-dimension-set-the-base-follows.png) |
| ![iPhone 13: a back lid corner dragged by a finger, the block deeper, lid and base together](docs/images/453-iphone-a-lid-corner-dragged-the-base-corner-with-it.png) | ![iPhone 13: del of the lid's right edge answered r1, r1_e1, r2, r2_e1, l2, l6 in the log; three walls standing, open to the right, no caps](docs/images/454-iphone-a-lid-edge-deleted-the-body-open.png) |
| ![iPhone 13: the edge drawn back by two taps with the line tool, a whole block, e1 under Bodies](docs/images/455-iphone-the-edge-drawn-back-a-solid-again.png) | ![iPhone 13: del("e1") in the log; two blue rectangles joined by four chords with their ⊥ marks, the region still drawn on the lower one](docs/images/456-iphone-the-extrude-deleted-both-sketches.png) |
| ![iPhone 13: the short line on the lid across its front edge, typed with onplane on e1.lid](docs/images/457-iphone-a-line-drawn-on-the-lid-across-an-edge.png) | ![iPhone 13: the trim tool tapped on the lid's front edge; the front wall is half as long, the other three stand, no lid](docs/images/458-iphone-the-lids-edge-trimmed-and-the-bases-with-it.png) |

- **Every relation within a profile has a twin on the other** (`src/twins.ts`):
  the same relation over the partner entities, a registry entry of its own
  under a name derived from its partner's (`r3_e1` — no counter claimed, so an
  old file's later names stay theirs). Shapes twin (`dist`, `coin`, `tan`,
  `eq`, `rad`, `sym`…), directions twin (`par`, `perp`, `ang`, which may name
  a frame's axis); positions do not (`fix`, `onplane`), nor anything that
  names an entity outside the profile. Each relation says which it is in its
  own module entry (`RelationDecl.twin`). A relation typed later on either
  profile gets its twin before the call returns; one that only repeats what
  is there adopts it.
- **The pair is one thing.** `set` either and both change; `del` either and
  both go, one undo step; a conflict names the pair once and lights both
  ends; the status counts nothing extra for a twin, free or agreeing. A
  linked twin **holds no rows**: what it says is carried across by
  the extrusion, and its rows in the problem were measured to change the
  solver's path (CONVERSATION_LOG). A mark is drawn on both ends; a
  dimension's label once, on the end nearer the viewer.
- **Deleting the extrude leaves everything**: both profiles, the chords, and
  each profile's relations, each an ordinary relation holding its own rows.
  `del("e1")` answers `[e1, d1, e1_perp]` and takes no entity. The same for a
  cut, an edge extrude (now linked the same way) and a revolve.
- **Deleting an edge of either profile takes its partner and leaves the body
  open**: the record stays, the surviving walls are drawn from both sides
  with no cap, no kernel body is made and the status says why, the
  organiser's row reads `extrude · open`. Draw the edge back on either
  profile — corner to corner, as the line tool joins — and its partner is
  made and the solid is back, with no step asked of the user.
- **A trim on a lid's edge is a trim on the base's**, each cut carried
  across the link; a trim that takes the loop apart leaves the extrude open
  where it used to be refused. `extend` on either end seats the other. The
  trim tool takes a lid's edge that something cuts (bug 76: it read every
  press on the sketch plane, so a lid edge seen from the side was never
  under it).
- **A relation a feature made is deleted like any other**: `del("e1_perp")`
  lets the chord lean; `del` of the depth leaves the record *unbuilt*
  (`extrude · unbuilt`, "its depth d3 is deleted") and both profiles their
  own relations. `onplane(p, "e1:l2")` outlives the extrude as `coplanar`
  with three of the face's own points, under its own name (`rehold`).
- **Format 21.** Nothing new is saved — twins are made again by replay from
  the relation that made them — but a deletion means something else now, so
  a pre-21 file's `deleteFeature` entries are marked on the way in and take
  what they took. `test/fixtures/linked-v19.neocad.json`, saved by the build
  before this one, opens to the model it was, every name kept, and is linked
  from then on.
- **With the entry below** (relations among many, merged first): a relation
  among many has one twin among the partners; a name typed with a member
  only a twin holds joins the relation it is the twin of, by its partner on
  the other profile; a member deleted journals the one `leave`; a wall
  written `e1:l2` is a face, and a relation to one has no twin.
- Unit: `test/linkedprofiles.test.ts` (29). E2E, mouse and iPhone 13:
  `linkedprofiles.e2e.ts`. The per-feature table of what was owned and what
  is now related is in the spec's *As built*; the decisions in TODO.md's
  register; what was tried and dropped in CONVERSATION_LOG.md.

## 2026-11-12 — a direction relation turns a line and never scales it; a conflict names the relation that made it

Review items 1 and 3 of the register (*Reviewed against the owner's
principle*; the owner: *"All good."*), built from
docs/plans/review-solver.md, whose *As built* has every measurement.

| | |
|---|---|
| ![Desktop: Parallel pressed in the constraints palette over two free lines — both still sixty long, turned parallel, a // on each, SOLVED · 7 free](docs/images/460-parallel-pressed-over-two-free-lines-both-as-long-as-they-were.png) | ![iPhone 13: the same by finger — the two lines parallel and as long as they were, the palette up at the bottom](docs/images/461-iphone-parallel-tapped-both-lines-as-long-as-they-were.png) |
| ![Desktop: the owner's first bug — CONFLICT, r6 on a red pill, par l1 l2 — against r1; the palette's conflict heading with r6 first and r1 under it, a delete on each; the par's two glyphs filled red, the corner perp's two outlined pink, the other perps plain](docs/images/462-the-owners-first-bug-the-par-named-against-its-corners-perp.png) | ![The rectangle's glyphs close, at the size they are drawn: two // filled red, two ⊥ outlined in the quieter ink, the rest plain](docs/images/463-the-glyphs-close-the-culprit-filled-what-it-is-against-outlined.png) |
| ![iPhone 13: the same conflict by finger — the status on two lines, r6 on its red pill, against r1; the rectangle unmoved with its two filled-red // and two pink-outlined ⊥; the palette's conflict heading, r6 par l1 l2 then r1 perp l1 l2](docs/images/464-iphone-the-par-named-against-its-corners-perp.png) | ![iPhone 13, the glyphs close: the culprit's two // solid red blocks with dark slashes, what it is against two ⊥ with a pink outline and a pink mark, four plain ⊥ in grey](docs/images/465-iphone-the-glyphs-close.png) |
| ![Desktop: the two inks over a solid's lit face, the lightest ground a glyph is drawn on — a filled-red // and a pink-outlined ⊥ on the pale lid, another pair beside it on the dark canvas](docs/images/466-over-a-solids-lit-face-the-culprit-filled-what-it-is-against-outlined.png) | ![iPhone 13: the same over a lid — r7 par l5 l6 — against r6](docs/images/467-iphone-over-a-solids-lit-face.png) |
| ![The corner's perp deleted: the par is still what made it, now against r4, r3 — its glyphs filled red, the two far corners' perps outlined pink](docs/images/468-the-corners-perp-deleted-the-par-still-named-against-the-two-far-perps.png) | ![Reopened by autosave: r6 · r4 · r3 cannot all hold, none singled out, every one of the three outlined in the conflict's red and none filled](docs/images/469-reopened-the-set-none-singled-out-every-member-outlined-red.png) |

- **The bug, as a test, first** (`test/directionrows.test.ts`): `par` between
  two free lines 60.133 and 60.828 long left them **8.763 and 1.183**,
  SOLVED, in 2D and 3D. The row was |u||v|·sin θ, and a shorter line is a
  smaller residual. Every row of that shape did it: `perp` left the pair 56
  and 87 long, `col` 17 and 3, `on` shortened the line a point was put on
  from 60 to 21, `sym` its mirror line to 37.
- **Now** each of those leaves its lines as long as they were to 3e-9 of the
  length (1e-6 was asked). The rows read **unit directions** (`unit`,
  vec.ts), so their gradient along a line is exactly zero; they are **the
  angle**, not its sine or cosine (`turnToParallel`, `turnToSquare`,
  `angleBetween`), because a sine is flat at 90° and `par` on two lines
  exactly square otherwise could not move; and each is times how long the
  longer of its lines was when the solve began, a plain number, so it is
  still a length and the Jacobian still exact. Normalised: `par`, `perp`,
  `ang`, `col`, `on`, `sym`, `tan` at a shared end, `ang3`, and
  `perp(chord, e1)`.
- **The rows alone were not enough**, and that is the measurement that
  matters: with every row's gradient along its lines zero and nothing else,
  `perp` between the two free lines left them **169** long. The kernel's
  step moves each end along a straight line, and a straight move that turns
  a line stretches it. So a block says which lines it reads for direction
  only, and after any solve that changed the length of one `Model.solve`
  solves on with those lengths pulled back, then released
  (`Model.keptSizes`). A width set on a rectangle leaves its height exact;
  a rectangle pinned by a corner moves whole; a bare line still stretches to
  a `coin` on its end.
- **A drag** is one solve and is not steered (a pull on a size there would
  move a free rectangle whole under a dragged corner): one end of a par pair
  dragged costs the other line **3.1%** of its length, where it cost 47%.
- **A solve that fails is put back, as a collapse is.** A `par` and a `perp`
  on one pair no longer fold a side — they have no answer — and least
  squares would leave the rectangle sheared 45°. The drawing stays where it
  was, the relation stays, the verdict is CONFLICT; so too for a `set` to a
  value that cannot hold. `perp("l1", "l1")` is a conflict of one (it
  solved, the line at nothing).
- **A conflict names the relation that made it**: `r6 par l1 l2 — against
  r1`. The drawing solved before the edit that broke it, so the culprit is
  known without a search — the one relation of the failed part that has not
  yet held in a solve, just added or its value just `set` — and the search
  is only for the least set it cannot hold with, one relation tried before
  any larger set. Past the bound the culprit is still named: `— against a
  set not found in time`. A file opened in conflict, or an edit of more than
  one relation, names the set and singles out none; an undo and a redo hand
  on who had held, so a redone `par` reads as it did.
- **Told apart on a phone**: the culprit's glyph is its box filled with the
  conflict's red, its mark cut out dark; what it is against is outlined in a
  quieter ink (#b98a86, the red let down toward grey); in the status the
  culprit is on a red pill; the constraints palette lists the conflict
  first, whatever is selected, the culprit first, × on each.
- **Bug 74** (seventy-five now, with 75 below): a conflict on a solid's edges drew nothing
  red — a glyph follows its anchor, and a solid's edges are quiet until
  hovered. A relation in a conflict is always drawn.
- **What it costs** (best of three, on a box at a load of thirty): the same
  iterations on every fixture opened as filed, and every old file reopens to
  the shape it was saved as. A par-heavy drawing solves 1.5× to 2.3× slower
  at the same iterations (135 → 209 ms by one measure, 126 → 295 by the
  other; the load does not let them be told apart) — forty rectangles'
  Jacobian has 2629 non-zeros where it had 1353, a unit direction depending
  on every coordinate of both ends. A solve that has to bring every length
  back at once is 2× to 6× (forty rectangles with every point moved: 156 →
  960 ms, 8 iterations → 22). A failing solve is no slower than it was (the
  same forty with a `par` across a corner: 874 ms the best seen before, 780
  as built) and its set is found sooner (507 → 197 ms). The spec has the
  table.
- **With review-relations merged** (the entry below; it went in first, and
  this was measured again on the two together). One relation among many is
  the pair's rows, so it needed nothing: `par(l1, l2, l3, l4)` among four
  free lines left them 41, 31, 89 and 123 long and leaves each as long as it
  was, to 1.8e-9. **`corner`**, that package's angle between two walls'
  lines, was a raw u·w − |u||w| cos row and left two free 60-long lines 69
  and 89 long in 3D; it is `ang`'s row on the two rays out of the corner
  now, and keeps them (1.3e-9). A conflict names a relation among many once,
  with every member — `r5 par l1 l2 m1 — against r1` — and a line that
  **joins** a relation makes the relation, as it now stands, the culprit; the
  line leaving clears it. The join found a fault here: where the failing
  solve folded a side, "one relation before any larger set" was asked only
  of the relations naming the fold, and the status named the two far perps
  where the corner's own would do. It is asked of the nearest dozen of all
  of them now.
- **Bug 75, found by the full gate**: `set` of a revolve's angle slid its
  profile six units. A quarter-turn swing left to the solve is shared
  between the end face and the profile; it always had been (0.2, and an
  edge 1% short), and was small only while a sketch's right angles were
  twenty times stiffer than a feature's rows — the same products of
  lengths. Giving the rows that stiffness back was measured and brings the
  shrinking back with it (`perp` 74 and 64, a drag 47%). So `set` seats a
  revolve's end face where the new angle puts it before the solve
  (`seatTurned`), as it already seats an extrude's lid: 0 iterations, the
  profile exactly where it was. Sixty-four dimension edits across the
  fixtures move the drawing no further than they did, within 5%.
- **Tests**: unit 2051 on the merged branch (1923 on the base, 2011 before
  the merge): `test/directionrows.test.ts` (77), `test/culprit.test.ts`
  (23), one in `test/revolve.test.ts`. E2E: `reviewsolver.e2e.ts` (10,
  mouse and iPhone 13), and `conflicts.e2e.ts` in the new words.

## 2026-11-12 — many at once is one relation among equals, and a wall is named by the line it is swept from

Review items 5 and 6 of the register (docs/plans/review-relations.md), read
against the owner's principle: *"correct relationships BETWEEN entities …
bidirectional relationships everywhere by default"* — nothing privileged,
nothing consumed. The owner, of the review: *"All good."*

| | |
|---|---|
| ![Four lines picked with the constrain tool and Parallel (all 4) pressed: one relation, r5, typed as par("l1", "l2", "l3", "l4"); each line wears one // beside its length, and none of them wears three](docs/images/470-four-lines-parallel-one-relation-a-mark-on-each.png) | ![The first line picked deleted by hand, its two points left; the log says r5 par l2 l3 l4 — l1 left it, and it holds among the rest; one line's end dragged round and the other two turned with it](docs/images/471-the-first-pick-deleted-the-other-three-turn-together.png) |
| ![Two blocks, the dimension tool armed, the +x wall of each lit green as picked, the 50 it will read beside the cursor](docs/images/472-two-walls-of-two-blocks-picked-each-named-by-its-line.png) | ![The near block's corner cut off with a line and two trims, a narrow new wall where the corner was; the mouse on the dimension's label, the two lines its walls are swept from lit amber, the tag reading d3 faceDistance e1:l2 e2:l14 50](docs/images/473-the-corner-trimmed-off-the-dimension-still-on-its-walls.png) |
| ![iPhone 13: the four lines parallel, a // on each](docs/images/474-iphone-four-lines-parallel-one-relation.png) | ![iPhone 13: the first line deleted from the menu a held finger opens, the other three turned together by a finger's drag](docs/images/475-iphone-the-first-pick-deleted-the-rest-turn-together.png) |
| ![iPhone 13: the two walls tapped with the dimension tool, both lit, 50 by the finger](docs/images/476-iphone-two-walls-of-two-blocks-picked.png) | ![iPhone 13: the corner trimmed off, the dimension's 50 tapped and selected, still drawn](docs/images/477-iphone-the-corner-trimmed-off-the-dimension-still-on-its-walls.png) |
| ![The constraints palette listing eleven relations, the five lines' parallel among them once — // r5 par l1 l2 l3 l4 l5 — and a line's menu offering Leave r5 (// with l1, l2, l3, l5)](docs/images/478-the-palette-lists-the-relation-once-a-line-may-leave-it.png) | ![A block seen from behind with the point tool armed: the wall under the mouse lit amber, ▱ e1:l4 beside the ghost, the chip reading on e1:l4 · point · click where the point goes](docs/images/479-a-wall-under-the-hand-named-by-the-line-it-is-swept-from.png) |

**What was true, found before anything changed.** Four lines picked and
Parallel pressed made `par(l1, l2)`, `par(l1, l3)`, `par(l1, l4)`: delete
`l1` and the other three were related by nothing. And `e1.m3` meant *the wall
in place 3 of e1's profile*, counted loop by loop and read again at every
evaluation — so a fillet of the profile's first corner, whose arc joins at
place 1, moved every later wall up one: a point put on `l4`'s wall (x = 0) by
`onplane(p, "e1.m3")` was taken to `l3`'s (y = 40). A chamfer's new line and
a trim that re-finds the region did the same. Part of item 6 was already true
and is left alone: two parallel walls of one extrude were already `dist` of
their lines, and a round wall its circle.

- **One relation among many** (`src/relations/among.ts`): `par`, `eq`, `col`,
  `coin`, `conc`, `corad` and `eqrad` take any number of members —
  `par("l1", "l2", "l3", "l4")` — and make one relation: one name, one
  journal entry, a mark on each member. Points level or upright with each
  other are `horizontal("p1", "p2", "p3")`, journalled `par("p1", "p2",
  "p3", "origin.x")`. Its rows are the pair relation's own function, called
  n − 1 times inside the one `model.relation`: no new equations. The
  constrain list's many-at-once rows type one call each, and gained
  **Collinear (all n)**.
- **Nobody is first.** Deleting a member — the first as much as any — leaves
  the relation over the rest, under its name, down to two; with one left it
  goes. The log says which member left. A conflict names the relation once
  (three names where a star gave four and a chain up to nine), an agreeing
  set counts it once.
- **A typed relation joins** (`src/among.ts`, `relate`): `par("l2", "l9")`
  where `l2` is already in a `par` adds `l9` to that relation — one relation,
  not two — and merges two relations it bridges, pairs included. `join("r3",
  "l9")` and `leave("r3", "l2")` change who is in one by name; a line's menu
  offers **Leave r3**. Each rebuilds the relation in place (as `set` does)
  and is journalled as itself.
- **A file replays as written**: a replay never joins, so an old file's star
  reopens as the separate relations it was, re-saves the same, and is only
  gathered into one relation when someone relates one of its members again.
- **A wall is `e1:l2`**: the wall of `e1` swept from the line `l2`; the caps
  stay `e1.lid` and `e1.base`. Resolved when read, in one file
  (`src/relations/solidref.ts`: `faceSource`, `faceRef`, `faceKernelNames`),
  so `onplane`, `fdist`, `par` and `perp` to a face, a driven `fangle`, the
  dimension tool's picks, the name beside the hand and the chip all stay on
  their wall through a trim, a split and a fillet of the profile. `e1.m3`
  still reads, typed and in a file, as the wall then in place 3, and is
  journalled by its line. Deleting the line takes what was held to its wall,
  and the log says so: `r9 went with l4: it was held to e1:l4, the wall of e1
  that l4 sweeps`.
- **Two meeting walls are `corner(l1, l2, θ)`** — a new dimension: the angle
  in the corner two lines make, each read out of the corner, so a wedge's
  sharp edge reads 30° whichever way round its lines were drawn, and a fillet
  of that corner leaves the dimension on its walls. It was `ang3` of three
  points, which stays for three points a user picks.
- **Format 20.** A file of 19 or before opens to the relations it had, name
  for name; its walls are rewritten at their own step, so one in which a
  fillet had renumbered them reopens holding the wall each relation was made
  on (`test/reviewrelations.test.ts`, three fixtures saved by the build
  before).

Measured: three lines collinear in 3D from loose seeds solve by the star's
rows and, by a chain's, fold the first line to a point — so the spanning set
is each member with the one listed first, which nothing above the solver can
tell. Free lines made parallel are still met by shortening as well as by
turning (the first palette picture showed it); that is review item 1, another
package's, and its fix lands under these rows.

Tests, one full run of the four steps of `npm run test:all` on the final
code, with three other packages' suites running on the same four cores (load
average 17–28): typecheck 0 · unit 1923 → 1950 (+27, the new file), 1948
passed · kernel 11/11 · e2e 789 → 796 (+7, the new file), 790 passed, 2
picture skips as before. What did not pass, each run again alone:

- unit, *the cost: the check on every solve…* (conflicts.test.ts): a
  2000 ms wall-clock budget, measured at 2255 ms under that load. Alone, three
  times: passed, passed, failed (still under load); and three times more:
  passed, failed, passed.
- unit, *a conflict on an extruded drawing names the user's relations…*
  (profilesheld.test.ts): alone 3 of 3.
- e2e, two files that asserted the format's number, 19 (camera.e2e.ts,
  lidframe.e2e.ts): the number is 20 now; they and the six others that said
  19 were corrected and run again, 56 of 56.
- e2e, *Pixel 7 portrait: see-through from the menu* (overlaylock.e2e.ts):
  `some ink to sample (0 pixels)`. Alone 1 of 3 here — and 2 of 4 on a fresh
  clone of the base branch, with none of this work in it: the same message.
  A flake under load that was there before; filed.
- e2e, *Android's font scale, measured* (android.e2e.ts): fails alone 3 of 3
  — and fails the same on a fresh clone of the base branch. The browser on
  this machine reads `env(preferred-text-scale)` as 1 when launched with
  `--blink-settings=accessibilityFontScaleFactor=1.3`, on an empty page with
  no app at all (three launches). Nothing in this change is near it; filed
  for whoever knows what changed under the suite since the baseline.

## 2026-11-09 — a click on a face lands on that face, is held there, and says so before the click

The owner: *"when i make a rectangular prism, i attempt to draw an e.g.
circle on another face, but it still draws the circle on the XY plane. Why?
if i am hovering over a face without an active on-plane constraint, it should
constrain to the plane i am hovering over. like i should be able to do a 3
point circle with each point on a different face of the rect prism, by just
orbiting around. it should come up with an on-plane constraint indicator
before i click (and highlight the plane i am hovering over)"*
(docs/plans/click-on-face.md).

| | |
|---|---|
| ![Desktop, the three-point circle armed, the mouse over the right wall: the wall lit amber with its edges stroked, ▱ e1.m3 beside the green ghost, the chip reading on e1.m3 · circle · click the first point](docs/images/433-a-wall-lit-and-named-under-the-circle-tool.png) | ![A centre-radius circle drawn on the wall by two clicks: its // glyph and its centre p9, held by onplane(p9, e1.m3) and par(c1, e1.m3)](docs/images/434-a-circle-on-the-wall-held-by-onplane-and-par.png) |
| ![Two points clicked on two walls, marked +, and the mouse over the lid: the lid lit, ▱ e1.lid by the cursor, the preview circle through all three](docs/images/435-two-points-on-two-walls-the-third-over-the-lid.png) | ![The circle through three faces: p9 on the right wall, p10 on the front wall, p11 on the lid, each wearing its ▱](docs/images/436-the-circle-through-three-faces.png) |
| ![set("d1.value", 20): the block twice as deep, the three points ridden along, each still on its face, the circle still through them](docs/images/437-the-depth-set-to-20-the-points-ride-along.png) | ![A rectangle dragged on the wall, its four right angles, and a line from the wall up onto the lid, an end held on each](docs/images/438-a-rectangle-on-the-wall-a-line-up-onto-the-lid.png) |
| ![iPhone 13, a finger on the front wall: the wall lit, ▱ e1.m0 beside the lifted mark above the finger, the chip reading on e1.m0 · circle · press at the centre](docs/images/439-iphone-a-finger-on-a-wall-lit-and-named.png) | ![iPhone 13: the circle on the wall by two taps, its // glyph and its centre p9](docs/images/440-iphone-the-circle-on-the-wall.png) |
| ![iPhone 13, a finger on the lid with the three-point circle armed: the lid lit, ▱ e1.lid by the lifted mark, the chip reading on e1.lid · circle · tap the first point](docs/images/441-iphone-a-finger-on-the-lid-three-point-circle-armed.png) | ![iPhone 13: the circle through three faces by three taps, p9, p10 and p11 each on its own face with its ▱](docs/images/442-iphone-the-circle-through-three-faces.png) |

- **Bug 72, reproduced first** (`test/e2e/clickonface.e2e.ts`), in two legs.
  A click on a face was swallowed: the circle tool settled its press onto the
  face and compared the release against it raw — same pixel, the ground
  behind — so every click on a face read as a zero-length drag and the
  gesture started over; only a drag drew. And a press that snapped to one of
  the face's own edges (a finger's usual press on a phone's small face) never
  asked what face it was on, and laid the circle on the ground through a
  point of the wall: the owner's words. Before the fix the reproduction made
  zero circles, then one facing +z.
- **A click lands on the face drawn under it** (`ToolEngine.toolEvent`,
  `landingAt`): with no sketch plane chosen, every pointer event of a tool
  that places points is read on the solid's face under the pixel —
  solidpick.ts's `faceUnder`, the dimension tool's own pick — facing the
  viewer, and the tool is told which (`PointerInfo.face`). The snap is
  restricted to the face: its edges, vertices and what lies in it, never a
  ground entity behind; a snap to the face's own edge still wins. **Each
  click its own face**: a three-point circle through three faces, a line
  from a wall onto the lid, a spline point by point; a shape dragged out
  lays out on its first press's face (`CurvePlane.settle` / `settleOwn`).
- **Held, visibly**: `onplane(p, "e1.m3")` — the face named as the kernel
  names it, the same op, ▱ and `del` as any onplane, read off the feature's
  record (relations/solidref.ts's `onFace`, as `fdist` reads a face) so it
  follows a `set` of the depth and goes with the feature; a curve wholly on
  one face gets `par(c, "e1.m3")` on its normal (`faceDirection`). A wall's
  hold is both ways: its line's ends are variables. A face name is no axis
  (`parseFaceName` in model.ts).
- **Before the click**: the face lit amber where it is in front, `▱ e1.m3`
  with a dark rim beside the mouse's ghost or a finger's lifted mark, and
  the chip's first part `on e1.m3` in amber — said, not offered: no plane
  menu, ⟂ or Done. A round face, or one only the kernel knows: `on e1.m0,
  not held`, the point placed and nothing held, said in the log.
- **The chosen plane still wins** (case 1): with a work plane or a default
  frame set no face is asked about. The ground is still where a click lands
  with nothing else there, and holds nothing.
- **`finish` redraws** (bug 73): a tool that commits on its press left the
  frame its solve drew — the face lit, the chip armed, the button lit —
  until the next pointer event; modefeedback.e2e had asserted the stale chip.
- Unit: `test/clickonface.test.ts` (the relation, `set`, save/open, the
  cascade, a round face, `par`, the tools by hand, snaps on a face, the
  engine, the chip). E2E, mouse and iPhone 13: `clickonface.e2e.ts`.
  Decisions in TODO.md's register; the why in CONVERSATION_LOG.md.

## 2026-11-09 — the constraints palette: a pane of its own, installed as a workbench module; redundancy counted, not blamed

The owner: *"the constraint list should not be on the features palette, it
should be a separate constraints palette. although i think it should still
be installed as a workbench."* (docs/plans/constraints-palette.md.)

The constrain tool's list of relations was its options pane — up only while
the tool was armed, and on an iPhone tall enough to cover the second circle
and the mirror line a Symmetric needs (TODO.md, 2026-11-08). It is a panel
now, like the organiser, and a module a workbench names or does not.

| | |
|---|---|
| ![A desktop, the constrain tool armed: the constraints palette summoned up the right edge above the organiser, saying pick what to relate](docs/images/420-the-constrain-tool-summons-the-palette-up-the-right-edge.png) | ![Two lines selected with nothing armed, the palette shown from Panes: it lists Parallel, Perpendicular, Equal, Collinear, Horizontal (both), Vertical (both), Fix (both) and Angle, each with the line it types](docs/images/421-two-lines-selected-no-tool-the-palette-lists-what-they-take.png) |
| ![Parallel pressed: the held list shows // r1 par l1 l2 with its ×, the selection kept, the status 7 free. The lines themselves have shrunk — an un-normalised par between two free lines, the register's item 1, pre-existing](docs/images/422-parallel-pressed-the-held-list-shows-it-with-a-delete.png) | ![A dimension edited from the palette: the line's dist, 30 in its field, typed as 45 — set("d1.value", 45) in the log, the line 45 long](docs/images/423-a-dimension-edited-from-the-palette-30-typed-as-45.png) |
| ![A rectangle of four right angles with nothing selected: the status reads 5 free · 4 agreeing, the palette lists the four relations and, under Agreeing, the same four — none of them blamed](docs/images/424-a-rectangles-four-right-angles-one-agreeing-set-the-status-counts-them.png) | ![A workbench defined without the constraints module: no palette, and the constrain tool's options pane lists the relations as it did before](docs/images/425-a-workbench-without-the-module-the-options-pane-lists-as-before.png) |
| ![iPhone 13: the constrain tool armed brings the palette up, docked at the bottom above the command line, saying pick what to relate; the two lines in the middle whole](docs/images/426-iphone-constrain-armed-the-palette-up-at-the-bottom.png) | ![iPhone 13: two lines tapped — Parallel and 7 more…, the rows a finger's target tall, the lines still in sight](docs/images/427-iphone-two-lines-tapped-parallel-and-7-more.png) |
| ![iPhone 13: the owner's case — two circles picked, the palette up with Concentric and 6 more…, both circles and the mirror line in sight](docs/images/431-iphone-two-circles-picked-the-palette-up-the-mirror-line-in-sight.png) | ![iPhone 13: a dimension edited by finger — the field a target tall, 45 typed, the line 45 long](docs/images/429-iphone-a-dimension-edited-by-finger.png) |
| ![iPhone 13 on its side: the palette at the left under the logo, the two lines picked at the middle clear of it](docs/images/430-iphone-landscape-the-palette-at-the-left-under-the-logo.png) | ![iPhone 13: shown from Panes the palette stays with the tool down, listing the drawing's relations](docs/images/428-iphone-shown-from-panes-it-stays.png) |

- **A palette, not a tool pane** (`src/constraints.ts`). For the constrain
  tool's picks, or else the selection's entities, it lists the relations that
  apply (`constraintsFor`, a row each; a greyed row says why not; a press
  types the line) and the relations they already have — the glyph's own mark,
  the name, what it says, a dimension's value in a field that types
  `set("d1.value", 45)`, × that types `del`; a tap types `select`; a
  right-click or a held finger opens the glyph's menu. Nothing selected, it
  lists every relation newest first and the **agreeing sets**. The constrain
  tool armed with nothing picked says *pick what to relate*.
- **A workbench module** (`src/modules/constraints.ts`): it registers only
  its help; what it does is put the pane on `part`, `sketch` and `surfaces`.
  A workbench without it has no pane — out of the layout and Panes,
  `ui({ show: "constraints" })` refused by name — and the constrain tool's
  options pane lists the relations there as it did everywhere before.
- **Hidden from the start, summoned by the constrain tool** while armed,
  gone when the tool is put down unless shown from Panes, when it stays. On
  a phone a row under a finger is a target tall and three rows are a third
  of the drawing; on a desktop its place — the right edge above the
  organiser — is drawing people click in (the first full run: twenty-five
  tests refused there). Docked at the bottom on an upright phone, at the
  left under the logo on its side. The rows that do not fit collapse to the
  likeliest and a *more…* row, measured against the pane's real height.
  Measured, the owner's case: two circles picked, the palette up, both
  circles and the mirror line in sight (`relationscomplete.e2e.ts` picks the
  circles first again).
- **Redundancy counted, not blamed** (the register's item 2). The status
  used to say `redundant r4`, naming whichever agreeing relation was stored
  last. The kernel's `null_support` already flagged every row in the left
  null space's support; `Problem.analyse({ agreeing })` now finds, for each
  wholly implied block, the least set that implies it (each candidate tried
  with its rows left out; the whole support where no single one is needed;
  bounded like the conflict search), and `Model.diagnose().agreeing` names
  the sets, merged where they overlap. The status reads `0 free · 4
  agreeing`, muted, naming none; the palette lists each set under *none is
  wrong*. `redundant` is kept, unsaid, for the dimension tool's "already
  held".
- **Panels learned three predicates** the host hands in (`present`,
  `startHidden`, `summoned`), so `panels.ts` still imports nothing from the
  model or the tools; `Tool.related()` hands a tool's picks to the palette.
- **Bug 71** (docs/ARCHITECTURE.md): the first tap after arming was lost on
  the phone — a strip's hit box reaches a target up over the drawing and
  Chromium's touch adjustment snapped a tap 30 px above the pane onto it,
  while `elementFromPoint` said the canvas. The harness's `at` now refuses a
  point within a finger's radius of a pane or a strip's reach.
- **Expectations changed**: the three `redundant rN` status matches and the
  `#diagnosis` class (`agreeing`); `#options .ocmd` → `#constraints .ocmd`;
  the built-in module order; the five-lines test's drawing spaced to the
  phone's room; the two-lines test on the phone reads the likeliest rows and
  opens *more…*.
- **Seen, left alone**: `par` between two free lines shrinks them (60 to 8.8
  and 1.2 headless, the picture above) — the register's item 1, not this
  package's.

## 2026-11-09 — a prism stays a prism: an extrude is an edge extrude, its chord held square by a relation of its own

The owner: *"Why is it that after I extrude I can drag a corner of the
extrude and it deforms the solid? I think it's missing adding in
relations"* — and, of the first plan, which tied what is sketched to the
ground: *"It's not about being tied to the ground plane, it's about correct
relationships BETWEEN entities. Part of the concept of this CAD is to have
bidirectional relationships everywhere by default."*
(docs/plans/profiles-held.md.)

Measured before, in the browser: a lid corner of an extruded rectangle
dragged 60×30 px took its base corner from z 0 to −18.2, the base tilted
while every wall stayed along the world's z, and the status said SOLVED.
Now the same drag, by mouse and by finger, leaves a right prism — base flat,
walls square to it and the depth long, the lid the base translated, each to
about 1e-11 — and nothing is said in orange.

| | |
|---|---|
| ![Before: the block after a lid corner was dragged — its end face skewed, the base tilted under walls still along the world's z; the status says SOLVED, 8 free](docs/images/401-before-a-lid-corner-dragged-skews-the-block.png) | ![After: the same drag by mouse — the block has moved and turned, its end faces square; SOLVED · 8 free · redundant r4 in the muted grey](docs/images/403-after-a-lid-corner-dragged-the-block-stays-a-right-prism.png) |
| ![Before, iPhone 13: the same drag by finger skews it](docs/images/402-before-iphone-the-same-drag-by-finger-skews-it.png) | ![After, iPhone 13: the finger's drag leaves a right prism](docs/images/404-after-iphone-the-same-drag-by-finger-a-right-prism.png) |
| ![The edge tool on an L of two lines: its copy, the chords from each end, the two walls of sheet between, depth 20](docs/images/405-edge-extrude-an-l-of-two-lines-its-copy-and-chords.png) | ![A copy's far corner dragged by finger: the whole L and its copy turned together, one chord, still square](docs/images/407-edge-extrude-iphone-a-copy-corner-dragged-by-finger.png) |

- **An extrude is the edge extrude of its whole profile, sharing one chord**
  (the owner: *"Edge extrude is a fundamental feature."*). The `extrusion`
  relation holds every twin at its base plus the chord of its first pair, the
  chord as long as the depth, curve twins the same size
  (`EntityKindSpec.sizes`, new) and facing. It reads no direction: until now
  it put twins at base + depth along the frame's +z, a datum, which is the
  whole of the owner's bug.
- **`e1_perp`, the chord square to the profile, is an ordinary relation**
  beside the extrude (the owner: *"how could you have a relation inside an
  extrude? that doesnt really make sense to me"*): visible, deletable,
  replaceable by `ang(wall, e1, θ)` for a drafted or oblique extrude, which
  is drawn and refused by the kernel by name (it sweeps square). Named for
  the record, claiming no `r`, so old files open with every name they had and
  gain it.
- **`edgeExtrude("l1", 20)` and the `edge` tool** (the extrude button's
  flyout; a curve's menu has *Extrude edge…*): any chain of curves, its copy,
  a chord at each end and the sheet between; held by the same pair.
- **The rectangle is four perps** (the owner: *"i was thinking 4 perps so
  that all the edges are identical to one another"*) and, with no plane
  picked, one `coplanar`: four right angles flatten a quadrilateral only to
  second order (a corner dragged 7 out of plane came back 2.9e-4 off; with
  the coplanar, 9e-13).
- **An agreeing redundancy is drawn in ordinary ink**, said in the status's
  muted grey — never orange. CONFLICT stays red.
- **The audit** — every operation that makes geometry from geometry, dragged
  both ways in and out of its plane: revolve's profile held in its axis's
  plane (a line the user drew as the axis is pushed both ways, a frame's axis
  stays a datum); an offset copy held in its chain's plane by `coplanar`
  (new, format 19); a circular pattern with nothing picked turns about its
  seed's own plane. **No plane unless one is picked**: a drawing tool holds
  to a plane only in sketch mode or on a default frame (the owner: *"the
  default for sketch entities is no plane. Every sketch is a 3D sketch,
  unless you enter into active on-plane constraint."*).
- Left, written down in TODO.md: the linked twin relations on the lid (the
  owner's point 2, on hold); an oblique extrude is drawn, not built; four
  free points can fold into a line under a turned frame.

## 2026-11-09 — three-finger orbit removed

The owner: *"3 finger orbit works but actually i decided i dont like it.
please get rid of it"*. Reverted d4bb71f's code, tests and help: a third
finger drops whatever the hand was doing and the hand is spent until it
lifts, as before. The 2026-11-07 entry below stays as history.

## Solid tools a first-time user can use: Flip, Cut, Through all, a depth handle

The owner (2026-11-08): *"Flip button."* and *"I'm still not clear on how to
use the extrude cut tool. It doesn't make sense to me. Make it more
intuitive, along with the other solid tools."* Walked first, as a first-time
user, by finger on an iPhone 13 and by mouse, every step pictured
(docs/plans/solid-tools-intuitive.md, *Walkthrough*): sixteen places the
screen did not say what had to be known — among them that the direction was
the sign of a typed number, that Cut was the third button of a row only the
armed extrude shows, that Cut pressed with the default depth previewed a red
solid standing in the air with ✓ lit, and that a revolve could not use the
origin's own axis (a bug).

| | |
|---|---|
| ![Before, on an iPhone: a circle on the lid, the extrude armed, Cut pressed with depth 10. The red solid stands on the lid, out of the plate; ✓ is lit and the chip says ✓ to extrude](docs/images/301-before-iphone-cut-pressed-the-red-solid-stands-on-the-lid-and-check-is-lit.png) | ![After: the Cut tool, held out of the extrude's button, the circle tapped. The red cylinder goes down into the plate, an arrow from its end with 10 on its label, the panel reads cut · Blind ▾ 10 ⇅ — the end condition a drop-down where the depth's label was — the chip ✓ to cut](docs/images/309-iphone-the-cut-tool-goes-into-the-plate.png) |
| ![The extrude's button held open: Extrude, Cut (a slab with a hole and an arrow into it) and Surface](docs/images/308-iphone-cut-beside-extrude-in-its-flyout.png) | ![Through all picked in the depth row's drop-down: the whole of the cut's red goes through the plate, the panel reads Through all ▾ 10 ⇅](docs/images/310-iphone-through-all.png) |
| ![A plate's region tapped, seen square on: the lid shows ⊙ and 10 — the solid comes out at you](docs/images/304-iphone-square-on-the-lid-says-towards-you.png) | ![⇅ tapped: depth -25, the preview below the sketch](docs/images/306-iphone-flipped.png) |
| ![A held finger on the plate's face: Sketch on this face, Edit e1 and Flip direction first, the tools under them](docs/images/307-iphone-the-faces-menu-flip-direction-first.png) | ![The two holes, one blind-through, one through all, the plate set deeper: both still through](docs/images/311-iphone-two-holes-through.png) |
| ![By mouse: a boss on a plate, a circle on its top, Cut with Through all: the red tool runs through the boss and the plate below it](docs/images/316-desktop-through-all-on-a-stepped-body.png) | ![A revolve about the origin's own y axis, a half turn, ⇅ pressed: the sweep goes the other way round the dashed axis](docs/images/318-desktop-a-revolve-about-the-origins-axis-flipped.png) |

- **Flip.** ⇅ after the depth in the panel ("Flip direction"), and after the
  revolve's angle and in both edit dialogs, types the value negated —
  `arm("extrude", {depth: -10})` — so the preview turns at once and ✓ types
  the negated call. The menu's **Flip direction**, on a depth or partial
  angle dimension and on any piece of a solid, runs `set("d1.value", -10)`.
  No key: every printable key types into the command line.
- **Cut, a tool of its own**, beside Extrude on its button (a hold opens it;
  still thirteen buttons on an iPhone). Its depth is how far *into* the
  material; which way along the sketch's normal is read off the bodies —
  interior points of the profile walked both ways, whichever meets more
  material — so a circle on a lid cuts down and one on the ground under a
  block cuts up, no minus sign. ⇅ still flips it. A cut that reaches no
  solid says so before ✓, muted. It types the extrude call, so files, replay
  and undo are an extrude's; the mode row stays on the extrude.
- **End conditions**: Blind, **Through all**, **Symmetric** — a drop-down
  where the depth's label was ("Blind ▾ [10] ⇅", as SolidWorks lays it out;
  a row of its own did not fit an iPhone held sideways), in the panel and
  the edit dialog, `{ end: "through" | "symmetric" }` in the call,
  `setEnd("e2", …)` afterwards. Through all is relational: the depth
  dimension holds the lid past everything made before the feature at every
  solve, so a hole through a plate is still through when the plate is set
  deeper (by the solve alone; the kernel's volume checks it). Symmetric is
  half each side, the dimension the whole depth. Journalled, saved, opened,
  regenerated: tested. **Up to face** is a follow-up (TODO).
- **A depth handle**: an arrow off the previewed lid, the depth on its label;
  drag it by mouse or finger, in round steps, through zero to flip. Seen
  square on, ⊙ (towards you) or ⊗ (away).
- **Revolve takes the origin's own axes** — it asked only the frames that
  are entities (a bug, W9).
- **On a face, the menu's face items come first**: on an iPhone the tool
  list had filled the screen above them.
- **Words**: help()'s solids text, "✓ to cut", "through all" on a through
  depth's label.
- More pictures: [305](docs/images/305-iphone-the-depth-handle-dragged-by-a-finger.png)
  the handle dragged by a finger to 25 (its label under the organiser pane,
  left), [312](docs/images/312-iphone-a-revolve-about-the-origins-axis-flipped.png)
  the revolve flipped on the phone, [313](docs/images/313-desktop-the-depth-handle-on-the-preview.png)
  and [314](docs/images/314-desktop-flipped-the-handle-points-down.png) the
  handle up and then down by mouse, [315](docs/images/315-desktop-the-hole-cut-no-minus-sign.png)
  the hole, [317](docs/images/317-desktop-through-all-built-plate-set-deeper.png)
  through all built, the plate set to 20.

Tests: unit 1755 → 1772 on this branch (+17: `test/extrudeends.test.ts` 7,
`test/cuttool.test.ts` 10); e2e +8, `test/e2e/solidtools.e2e.ts` (mouse, 5)
and `test/e2e/solidtoolsphone.e2e.ts` (iPhone 13 by finger, 3). Merged with
relations complete, trim everything, sketch mode and smart dimension, the
one full `npm run test:all`: typecheck 0, unit 1863/1863, kernel 11/11, e2e
766 passed, 0 failed, 2 skipped (the picture-taking tests, off unless asked). Four more bugs
the unit suite passed and the browser showed (ARCHITECTURE, 66–69).

## 2026-11-08 — merging smart dimension: two bugs where packages met

- **A label click into a half-typed command names it again.** `del(` then a
  click on a dimension's label had opened `set("d1.value", ` when the two
  clicks fell inside the double-click window: smart dimension's
  double-click to edit (#84) against the glyphs' click-to-name. A
  half-typed command now takes every label click as a name
  (`ToolEngine.typingCommand`). dimensions.e2e failed before, passes after.
- **Symmetric takes its picks in any order.** Two circles and a mirror line
  listed Symmetric only with the line picked last (#82); the mirror is now
  whichever pick is the line. A new unit test fails without the fix.
- **The relation table takes smart dimension's rows**: a whole circle reads
  Diameter, and ten cells gain their dimension last.
- Found, not fixed: on an iPhone, two circles list seven rows, and the list
  covers the second circle and the mirror line (TODO.md).
- Bugs 64 and 65 in ARCHITECTURE; the count is sixty-five.

## Smart dimension: one tool for a vertex, an edge or a face — distances and angles between a solid's faces

The owner (2026-11-08): *"Dim tool needs to be similar in functionality to
Solidworks smart dimension. I should be able to use it to dimension virtually
anything. Distance between two faces of a solid, or angle"*. The dimension
tool now takes a solid's vertices, edges and faces — vertex before edge before
face under the hand, as SolidWorks' does — and every row of SolidWorks' table
for a sketch besides (docs/plans/smart-dimension.md, "As built", has the whole
table). Pick, pick, then click where the label goes; double-click or
double-tap the label to set its value.

| | |
|---|---|
| ![A stepped block seen from the front right, the dimension tool armed; the near +x wall is lit amber under the cursor](docs/images/320-smart-dimension-a-wall-lit-under-the-cursor.png) | ![Both +x walls of the step picked, lit green only where each is in front of the other; the 20 the click will type is beside the cursor](docs/images/321-two-walls-of-a-step-picked-lit-as-seen.png) |
| ![Placed: the label 20 between the two walls on the sketch, witness lines to each; the log reads dist("l2", "l4", 20)](docs/images/322-the-step-dimensioned-20-on-its-sketch.png) | ![Double-clicked, 30 typed: the step is deeper, the near wall wider; its label is now behind that wall (filed in TODO.md)](docs/images/323-the-step-set-to-30-its-label-behind-the-wall.png) |
| ![A wedge: its front and its slope picked, the label 30° at the sharp edge between them; the log reads ang3(…, deg(30))](docs/images/324-two-faces-of-a-wedge-30-degrees.png) | ![Two blocks side by side, their lids picked: (15) in parentheses, driven, and the log's one line — made driven, what it measures is already held](docs/images/327-two-lids-already-held-made-driven.png) |
| ![A circle labelled ⌀20 and an arc R10, each one click and a placement](docs/images/325-a-circle-diameter-an-arc-radius.png) | ![One line dimensioned twice: horizontal 30 placed above it, vertical 20 beside it](docs/images/326-horizontal-and-vertical-by-placement.png) |
| ![On an iPhone 13: the step's two walls tapped, lit green](docs/images/328-iphone-two-walls-tapped.png) | ![On the iPhone, the label double-tapped and set to 22](docs/images/329-iphone-double-tapped-and-set-to-22.png) |
| ![On the iPhone: the wedge's 30°](docs/images/330-iphone-the-wedge-30-degrees.png) | ![On the iPhone: a circle's ⌀20 and an arc's R15, by finger](docs/images/331-iphone-a-circle-diameter-an-arc-radius.png) |
| ![On the iPhone: one line, horizontal 30 placed above, vertical 20 beside](docs/images/332-iphone-horizontal-and-vertical.png) | |

- **A face is named as the kernel names it** (`e1.base`, `e1.lid`, `e1.m3`),
  whichever drew the body, and **maps to what made it**
  (`src/relations/solidref.ts`). Two walls of one extrude are the lines they
  were swept from: the distance is `dist` on the sketch, and the angle is the
  one at the corner they share (`ang3`), a wedge's 30° rather than the 150°
  between its lines' directions. A round wall is its circle, so its size is
  that circle's `dia`. An edge between two of one extrude's faces is its
  entity, so its length is that line's.
- **One new relation for what a sketch cannot say**: `fdist(face, b, d)`,
  square to a flat face, from a point, an edge's middle, a centre or another
  flat face. It reads the faces lazily through the feature's record, so it
  follows a `set` and a regeneration.
- **An extrude's lid and its own base are its depth.** The extrusion holds
  every twin at base + depth·z with the depth a constant, so a second
  relation there could only repeat or fight it. The tool makes nothing and
  opens the depth's value, as Set value… does.
- **Driven when it must, and said.** Before typing a driving dimension the
  tool tries it on a throwaway copy and asks `Model.diagnose` and the
  conflict check. One that is redundant or in conflict is typed as
  `measure(…)` instead, with one line in the log. Two lids both depths
  already hold are the common case. A face only the kernel knows (a
  fillet's) is always driven, read through a reader main.ts hands measure.ts.
- **The sketch rows SolidWorks has and the tool lacked**: a whole circle
  defaults to ⌀ and an arc to R (the menu's Dimension too; the `radial`
  option says otherwise). A point and a circle, two circles, and a line and a
  circle measure centres. Three points are the angle at the first (`ang3`),
  and an arc and its two ends are its length (`arclen`). A point and a
  frame's axis give its distance from the axis. An ellipse is its major, or
  its minor where the label is put nearer that axis. Horizontal or vertical
  is `along`, a distance along the drawing's x or y, chosen by putting the
  label beyond both points.
- **`measureOf(…)`** says the reading and makes nothing. A `measure only`
  row in the options was tried and taken out: on an iPhone a third row put
  the panel over the drawing a test's tap was aimed at.
- **Faces pick only for a tool that asks** (`ctx.pickSolid`,
  `src/solidpick.ts`): the ordinary pick first, then the front face under the
  pixel, occlusion's `nearestFace`. Hover, selection and the menu still never
  see a face. The relations package can call the same function.
- **Deleting a feature now takes the relations naming its faces and edges**:
  the cascade only ever followed entities, and `"e1.lid"`'s referent is the
  record.

**Found in the browser, passed by the unit suite** (61–63, now sixty-three in
docs/ARCHITECTURE.md's list):

- A double-click on a label opened `set("d2.value", ` and the typed number
  landed *in front of it*. The second press's default, a mousedown on the
  canvas, took the focus back off the command line. The value now opens
  after the event.
- A picked face behind another was lit straight through the face in front,
  since a 2D canvas has no depth test. It is now filled only in the cells
  where it is the front face (the pick's own question), and its edges are
  drawn only in sight.
- A double-tap on a loaded box was read as two taps: it was timed by when the
  page recognised each tap, not by the touches' own stamps. It is timed by
  the pointerdown's stamp now. The harness's `fingers.doubleTap` sends the
  second tap at a hand's pace.

Tests: test/smartdimension.test.ts (22, unit: every row in 2D and 3D, `fdist`
set and save/open, redundant and conflicting made driven, kernel faces
driven, deleting a feature, the glyph), test/e2e/smartdimension.e2e.ts (11,
mouse and iPhone 13). Updated: menu.test.ts, sketchrelations.test.ts
(the ⌀ default, the commit now awaited), dimensions.test.ts (the four new
dimensions rebuild by `set`), modules.test.ts (the module).

---

## Every sketch curve trims, and power trim drags across them

The owner (2026-11-08): *"Also need trim for sketch entities"*. Trim took a
line, an arc or a circle; it refused an ellipse and a spline by name, and it
lived behind the fillet's face on the modify button. Now every curve trims
against every other, a press dragged across the drawing trims every piece it
crosses, and the modify button's face is trim (docs/plans/trim-everything.md).

| | |
|---|---|
| ![An ellipse crossed by a line, the trim tool armed: the piece below the line, from crossing to crossing, drawn in the cut's red under the cursor. The chip reads trim · click a piece to trim it, or drag across pieces](docs/images/360-ellipse-piece-red.png) | ![Clicked: the ellipse is the cap above the line, an elliptical arc under its own name el1, drawn open; its centre and major end stay drawn](docs/images/361-ellipse-trimmed-to-an-elliptical-arc.png) |
| ![A spline whose end runs into a circle: the piece inside the circle red](docs/images/362-spline-piece-in-the-circle-red.png) | ![Clicked: the spline ends on the circle, a spline of control points under its own name sp1 — its control points p13 to p16 drawn with their polygon, thin and dashed](docs/images/363-spline-trimmed-its-control-points.png) |
| ![A grid of six lines, the trim tool pressed above it and dragged down between x = 0 and 20: the stroke dashed grey, the two pieces it has crossed red, nothing trimmed yet](docs/images/364-power-trim-mid-stroke.png) | ![Released: the three pieces between x = 0 and 20 gone, the log one entry of three trims](docs/images/365-power-trimmed.png) |
| ![On an iPhone 13, the grid power-trimmed by one finger, mid-stroke: two pieces red](docs/images/367-iphone-power-trim-mid-stroke.png) | ![On the iPhone, the modify button's face is trim's new glyph, the piece past the wall struck out](docs/images/369-iphone-toolbar-modify-face-trim.png) |

- **Every curve against every other**: a line, an arc, a circle, an ellipse,
  an elliptical arc, a spline and a spline's piece, construction or not, in
  2D and on any plane in 3D. `sketchgeom.ts` finds every pair's crossings: a
  conic with a circle or another conic by a walk round one rim, halved at
  each change of side of the other; a spline with a spline by Bézier
  subdivision, polished by Newton. A tangency cuts nothing, as before.
- **An ellipse's piece is an elliptical arc** (`earc`, a new entity kind
  through `EntityKindSpec`; no kind named in `model.ts`). A trimmed ellipse
  becomes one under its own name, as a circle becomes an arc. Its frame keeps
  the ellipse's axes and starts at an eccentric anomaly (`ArcFrame.t0`). Its
  ends are held `onellipse`. A middle piece leaves a second one, `ea1`, about
  the same centre and major end, held `eqrad` (equal semi-axes now, for
  conics). It extrudes, regenerates and goes to STEP as an elliptical edge
  between two vertices. To the solid kernel it goes as its exact rational
  NURBS. A revolve of one is refused, as an ellipse's is.
- **A spline's piece is a spline of control points** (`bspline`). The piece
  of an interpolating spline is exactly a clamped B-spline, by knot
  insertion. Its control points are ordinary points to drag and its knots are
  fixed. A closed spline needs two cuts, and opens across its seam.
  Through-points nothing else uses go; a used one on the piece is held
  `onspline`. An `onspline` on the piece is re-made on it. A `tan` at the end
  that went is removed and said in the log. It extrudes, regenerates and goes
  to STEP and the kernel as its own B-spline.
- **Power trim**: with trim armed, press and drag. The stroke is drawn, and
  each piece goes red as it is crossed. The release types one entry, one
  `trim` per piece: one undo step. Pieces of one curve are typed from its far
  end back, so every name typed is the curve the piece is on when its turn
  comes. A click now trims on its release. By finger it is the natural
  gesture: a drag with a tool armed is the tool's, never a pan.
- **Trim heads the modify button.** The button's face is its first member
  until another is armed; it already showed the member armed last. Trim's
  glyph strikes the piece out: the dotted arm read as a plus sign on the
  iPhone (looked at). Extend takes an elliptical arc.
- **Three bugs the browser found** (ARCHITECTURE, 58–60; the count is
  sixty now, after sketch mode's and the relations'). A tool armed by its typed name left the chip saying
  Select until the next pointer event. A spline piece's control points read as
  stray dots, so its control polygon is drawn now. And trim's glyph read as a
  plus sign.
- **Left**: extend and offset of a spline (neither is small in this
  representation), a revolve of an elliptical arc, part of either piece in a
  region, trim to closest and extend by shift (no need found). Each is in
  TODO.md.
- **Verification** (on a shared four-core box at load 13–39):
  - `npm run typecheck`: 0 errors, as before.
  - `npm test`: 1787 tests, 1786 pass, against 1755/1755 before. The one
    failure is `conflicts.test.ts`'s cost test, whose search is bounded by
    500 ms. It passed alone three times out of three.
  - `npm run test:kernel`: 11/11.
  - `npm run test:e2e`: 721 tests, 700 pass, 19 fail, 2 skipped.
    - Eleven failures read the modify button's old face (fillet). They were
      fixed, and those four files pass 67/67.
    - The rest are finger and timing tests. Each passed alone: regionsops
      3/3, sketchrelations 3 of 4, touchdensity 3/3. overlaylock failed
      alone at load 35–39, a different test each run (one run hung), and
      passed 14/14 twice at load 9. The base branch passed it 14/14 once at
      load 13.
  - `trimeverything.e2e.ts`: 4/4.
- **Tests**: `test/trimeverything.test.ts` (each kind trimmed by each kind,
  2D and on a tilted plane in 3D, the kept piece checked against the curve
  as it was; each kind's own rules; power trim's typing), `test/
  trimsolids.test.ts` (extrude, regenerate, STEP, the kernel),
  `test/e2e/trimeverything.e2e.ts` (mouse and iPhone 13).

---

## Every standard relation, offered for whatever you pick

The owner (2026-11-08): *"Also need to figure out a way to do all the standard
relations."* The constrain tool's list is now the union of SolidWorks' and
Onshape's sketch relations against every pickable kind — point, line, circle,
arc, ellipse, spline, a frame's axis or plane, a solid's vertex, edge and
face — written down first as a table (docs/plans/relations-complete.md, *As
built*) and then made true, row for row, by `test/relationscomplete.test.ts`.

| | |
|---|---|
| ![Five lines picked with the constrain tool, each in the picking green; the constrain panel lists Equal (all 5), Parallel (all 5), Horizontal (all 5), Vertical (all 5), Fix (all 5), each with the start of the line it types](docs/images/340-five-lines-picked-the-constrain-list.png) | ![After Equal (all 5): the five lines one length, SOLVED; four = marks on the first line and one on each of the others — four eqs, each against the first; the log reads eq("l1", "l2"); eq("l1", "l3"); eq("l1", "l4"); eq("l1", "l5")](docs/images/341-five-lines-equal-four-eqs-against-the-first.png) |
| ![On an iPhone 13: the same five lines picked by finger, the list of five rows legible at the phone's width](docs/images/342-iphone-five-lines-picked-the-list.png) | ![On the iPhone: two lines picked, eight rows — Parallel, Perpendicular, Equal, Collinear, Horizontal (both), Vertical (both), Fix (both), Angle — all on screen, covering half the canvas while up](docs/images/343-iphone-two-lines-eight-rows-fit.png) |
| ![A point and an ellipse picked, On applied: the point on the rim with the ● mark, onellipse("p3", "el1") in the log](docs/images/344-a-point-on-an-ellipse.png) | ![On the iPhone: the same, by finger](docs/images/345-iphone-a-point-on-an-ellipse.png) |
| ![An arc and a spline leaving its start downward, both picked; the panel lists Tangent, tan("a1", "sp1")](docs/images/346-an-arc-and-a-spline-picked-tangent-listed.png) | ![On the iPhone: the arc and the spline both in the picking green — the spline drew nothing before (bug 53)](docs/images/347-iphone-the-arc-and-the-spline-picked-both-green.png) |
| ![On the iPhone after Tangent: the arc runs on smoothly into the spline, the join selected and its ● and ⌒ marks shown](docs/images/348-iphone-arc-and-spline-tangent-at-the-join.png) | ![Two circles mirrored about a line by Symmetric, equal radii, a ⇌ on each rim; beside them a coradial pair drawn as one circle with ◎= at its centre](docs/images/349-two-circles-symmetric-and-a-coradial-pair.png) |
| ![On the iPhone: the same symmetric circles and coradial pair, the marks at 3×](docs/images/350-iphone-two-circles-symmetric-and-coradial.png) | ![A line's end fixed: the padlock beside it, the hover tag p1 -20, 0, 0 · r1](docs/images/351-a-fixed-point-its-padlock-on-hover.png) |
| ![On the iPhone: the fixed end selected, its padlock at 3×](docs/images/352-iphone-a-fixed-point-its-padlock.png) | ![After a drag on the fixed end and one on the free end: the fixed end where it was, the other end moved, SOLVED](docs/images/353-the-fixed-point-stayed-the-other-end-moved.png) |
| ![On the iPhone: a line and a spline that share no point; Tangent greyed, its reason on two lines under it — neither end of "sp1" meets "l1" — tan hold…](docs/images/354-iphone-tangent-greyed-with-why.png) | ![A box extruded from a rectangle, a point beside it picked and then the box's top: the three corners that name the face marked, the panel listing On face, onplane("p9", "p5.p6.p8")](docs/images/355-a-point-and-a-boxs-top-picked-on-face.png) |
| ![After On face: the point on the plane of the box's top (15 up), the ▱ mark beside it](docs/images/356-the-point-on-the-faces-plane.png) | ![On the iPhone: the same](docs/images/357-iphone-the-point-on-the-faces-plane.png) |

- **New relation: `corad(c1, c2)`** (Coradial) — one circle: concentric and
  equal radius, and in 3D one plane; one module entry, glyph `◎=`.
- **`sym` takes two lines, two circles or two arcs**, about a line or a
  frame's axis — the same op, dispatching on kind. Lines need no pairing of
  ends (the segment is mirrored: middles, direction, length); arcs pair one's
  start with the other's end, as a mirror turns an arc round.
- **`intersection` and `pierce` take an ellipse and a spline.**
- **Offered for the first time**: Fix (any entity — one `fix` per point it is
  built of, where it stands — drawn as a **padlock**), On for an ellipse and
  a spline (and for any kind a module adds, through its `heldBy`), Tangent
  with an ellipse and at a spline's end, Tangent between circles typed with
  its side (both offered, nearer first), Midpoint between two points,
  Symmetric about a frame's axis, a frame's arm as an axis (its z arm, in 3D,
  its plane: On plane, Normal to plane, Parallel to plane), a solid's flat
  face (On face, Normal to face, Parallel to face).
- **Many at once**: n lines take Equal, Parallel, Horizontal, Vertical and
  Fix for all n; n points Coincident, Horizontal, Vertical, Fix; n circles
  Concentric, Coradial, Equal, Fix — each pick against the first (a star:
  measured, its conflicts name at most four relations where a chain's name
  up to nine), typed as one line, so one undo step.
- **Greyed, with why**: a cell that cannot apply as the drawing stands — a
  spline whose end meets nothing — is shown greyed with its reason in the
  tool's panel and the context menu, and a press logs the whole of it. A pick
  of the solid kernel's own edge or face (a fillet's) greys the list with
  why nothing can hold to it.
- **The table stays open**: rules over kind predicates, not a switch over
  kind names, so the elliptical arc and control-point spline being built
  beside this get their On, Fix and Concentric cells unwritten.
- **Solid picking is one function**, `solidRefAt` (src/tools/constrain.ts),
  to be replaced by smart-dimension's picker.
- **Three bugs the whole unit suite passed**, found in the browser (55–57 in
  docs/ARCHITECTURE.md; the count is now fifty-seven, after sketch mode's 51–54): On face was never
  offered for a box (only the kernel's faces were asked); a greyed reason
  showed a dozen characters on a phone, and those the generic half; and a
  picked spline drew nothing.
- Not built, and why, in TODO.md: Convert Entities (an operation and a
  projection relation that does not exist), Curvature, Equal curve length.

---

## 2026-11-08 — the conflict search's naming test no longer reads the clock

Found merging #86 (sketch mode): `test/conflicts.test.ts`'s cost test
failed one run in three *alone*, at a load of ~18 on four cores, naming
`r5 r1 r2 r27` where it expected the made `par`. The search has two bounds,
200 trials and 500 ms (`SEARCH_MS`); under load the clock ran out first
and the fallback named every block that stayed large, which is the bound
doing its job. The test was asking the clock what the answer is. The budget
is now a field (`Model.searchMs`, defaulting to `SEARCH_MS`), and the
fixture part of the test lifts it, so what is named depends on the trials
alone; the time is still measured and printed. 3/3 alone after, at the
same load. The 40-rectangle part keeps the budget, since that part tests
the bound.

## Sketch mode: any plane, every point held on it, square to it on entering

The owner (2026-11-08): *"Not sure how it works right now but I need a way to
natively sketch on a plane without it being a special feature. It should
just add 'on plane' relations to each entity as it gets sketched. Also when
I select this mode it should go normal to the plane/face."*
(docs/plans/sketch-mode.md)

**Most of it was already true, and is now true everywhere.** Measured
first: on the ground, a block's top and wall, a revolve's end, a cylinder's
top, a tilted frame and three points at an angle, every drawing tool held
every point it made with exactly one `onPlane` — 1 for the point, 3 for a
two-segment line, 4 for the rectangle, 7 for the hexagon, 6 for the slot,
1 and 4 for the two circles, 3 and 3 for the two arcs, 2 for the ellipse, 4
for a four-point spline. What was missing was the planes and the way in.

| | |
|---|---|
| ![Before: the sketch tool armed in a fresh document. Nothing is lit; the canvas says Nothing drawn yet, and a click would answer "no closed outline yet"](docs/images/380-before-the-sketch-tool-in-a-fresh-document-takes-nothing.png) | ![Before: a rectangle and a spline drawn on the ground's plane. The rectangle is in full ink; the spline is dimmed, and its two middle points each wear a ▱ mark](docs/images/381-before-on-the-ground-the-spline-dimmed-and-a-plane-mark-on-its-points.png) |
| ![After: the sketch tool armed in a fresh document. A dashed green square labelled Top round the origin, and the options pane reads plane: Top, Front, Right](docs/images/382-the-sketch-tool-lights-top-and-offers-top-front-right.png) | ![Front picked from the options: the chip reads on Front ⊥ Done, the view looks along +y with x right and z up, a green grid patch round the origin](docs/images/383-front-picked-the-view-square-to-it.png) |
| ![A rectangle and a spline drawn on Front, then orbited: both stand in the tilted Front patch, the spline now in full ink and no ▱ anywhere](docs/images/384-a-rectangle-and-a-spline-on-front-orbited.png) | ![The chip's ⊥ pressed: square to Front again, lookAt("origin.xz") in the log](docs/images/385-normal-to-square-to-front-again.png) |
| ![Escape with nothing armed: workplane(null) typed, the patch and the chip's plane gone, the view left as it was](docs/images/386-escape-left-the-sketch-the-view-where-it-was.png) | ![A 60 × 40 × 20 block with its right lid edge filleted R6 and its front lid edge chamfered C6 by the kernel](docs/images/387-a-block-filleted-and-chamfered.png) |
| ![The block's filleted side wall picked: the chip reads on e1's side, the wall tinted square-on with the fillet's band across its top, a small circle drawn on it](docs/images/388-a-circle-on-the-filleted-blocks-side-wall.png) | ![The sketch tool armed over the block: Top, Front and Right drawn as faint dashed patches through it, the chamfer's face under the cursor](docs/images/389-the-chamfers-face-lit-the-named-planes-behind.png) |
| ![The chamfer's face picked: a frame f1 made at its middle, the view square to the 45° face, the chamfer's strip between the lid and the front wall](docs/images/390-on-a-frame-made-at-the-chamfers-face.png) | ![iPhone 13: the sketch tool armed, the options pane at the bottom reading plane Top Front Right, the Top patch round the origin](docs/images/391-iphone-the-sketch-tools-options-top-front-right.png) |
| ![iPhone 13: on Front, a rectangle dragged and a spline tapped out and ended with ✓](docs/images/392-iphone-a-rectangle-and-a-spline-on-front.png) | ![iPhone 13: orbited, the rectangle and the spline still standing in the Front patch](docs/images/393-iphone-orbited-still-on-front.png) |
| ![iPhone 13: the chip's ⊥ tapped, square to Front again](docs/images/394-iphone-normal-to.png) | ![iPhone 13: a filleted block's side wall tapped with the sketch tool, square-on in the middle of the screen, a circle dragged on it](docs/images/395-iphone-a-circle-on-the-filleted-wall.png) |

- **Front and Right have names now**: `"origin.xz"` and `"origin.yz"`, plane
  references like Top's `"origin"`, and any frame's `"f1.xz"`/`"f1.yz"`.
  Choosing one makes nothing. The chip says on Top, on Front, on Right.
- **The sketch tool takes any planar thing**: a face (held by its own
  points, as before), a flat face the kernel made that no loop bounds (a
  chamfer's: a plain frame made there, `kernelplane.ts`), Top, Front and
  Right (faint patches while it is armed, and one-tap buttons in its
  options), or a frame or three points selected before arming. Each is one
  typed `workplane(…)`, one undo step.
- **Copies stay on the plane**: offset, mirror and both patterns hold every
  copied point with its own `onPlane`. An offset copy used to float: pushed
  off the plane, it stayed off.
- **Normal To** is ⊥ in the chip. **Leaving** is the chip's Done or Escape
  with nothing armed; the view stays where it is.
- **Quieter**: the ▱ of an `onPlane` shows only while its point is hovered,
  selected or just placed. **A spline on the plane is in focus**, and so is
  any kind a module adds, by its points.
- **Discoverable**: the sketch button's tooltip reads "Sketch on a face or
  Top, Front, Right: all you draw stays on it", and help() says what sketch
  mode is.
- **Four bugs the browser found** (ARCHITECTURE, 51–54; the count is
  fifty-four now): the spline dimmed on its own plane; a click on a chamfer
  sketched on the lid behind it; on the iPhone a picked wall turned half off
  the screen; Escape dropping a plane made with `plane()`.
- **The hidden view's golden picture is re-recorded** (`test/e2e/golden/
  hidden-plain-sketch.png`): the old one drew a ▱ beside six points, which
  this package makes quiet on purpose. Looked at side by side, the new one
  differs only there.
- Tests: unit 1755 → 1769 (`sketchmode.test.ts`, 14: every tool on nine
  planes, copies, focus, Front and Right, the named-plane picks, a kernel
  face, following the block, save and open, the chip), kernel 11 → 11, e2e
  717 → 728 (`sketchmode.e2e.ts` 7 by mouse, `sketchmodephone.e2e.ts` 4 on an
  iPhone 13). The one full run, at load 35–40 on the shared box, failed 9;
  the golden above was mine, and the rest are load (TODO.md has which, and
  what each did alone).


## A conflict is a conflict even when a collapse satisfies it

The owner (2026-11-07): *"Just noticed I'm able to add a parallel relation to
a set of perpendicular relation lines. This is a bug. Solver needs to see
this kind of thing. For any feature combination and relation type, and
should be able to catch that for any chain of conflicting relationships."*
Measured before: a rectangle held by three `perp`s, then `par("l1", "l2")`,
solved to 5e-12 in 2D and 3D by folding l2 to nothing, and SOLVED was shown.
Now it reads CONFLICT. The par and the perp on its corner are drawn red, the
rectangle stays as it was, and the par stays until it is deleted
(docs/plans/conflict-detection.md).

| | |
|---|---|
| ![The rectangle drawn with the tool, Parallel added between its bottom and right sides from the constrain tool. The header reads CONFLICT, r4 · r3 cannot all hold. The rectangle is whole; the ⊥ and the new // on both sides are boxed in red, the other two pars are not. The log reads CONFLICT — these cannot all hold without collapsing l2: r4 par l1 l2 · r3 perp l1 l2](docs/images/261-a-par-across-the-rectangles-right-angle-is-a-conflict.png) | ![The same rectangle after r4 was clicked in the header and Delete pressed: SOLVED, 5 free, select armed, no mark red. The log reads r4 selected — Delete removes it, del("r4"), [r4]](docs/images/262-the-par-deleted-solved.png) |
| ![On an iPhone 13: the same conflict made by finger, CONFLICT r4 · r3 cannot all hold, the ⊥ and // marks red on both sides](docs/images/263-iphone-a-par-across-the-right-angle-is-a-conflict.png) | ![On the iPhone, after r4 is tapped in the header and the strip's Delete: SOLVED, 5 free, nothing red](docs/images/264-iphone-the-par-deleted-solved.png) |

- **A collapse is a measure**, declared per kind: a line's length, a radius,
  a frame's axes, and `EntityKindSpec.measures` for an ellipse's axes and a
  spline's spacing. One that falls from above ε·L to below it in a solve has
  collapsed, with L the drawing's size and **ε = 1e-6**. Measured over the
  whole unit suite, collapses end at ≤ 4.6e-10·L and real sizes that halved
  stay ≥ 2e-4·L. A slow collapse is told from a small size by a push toward
  zero and a release. A collapse is retried steered before it is believed,
  since the solver is local. One relation's own zero (`dist(p, q, 0)`, a
  `coin` of a line's ends) is no collapse.
- **What it does**: the solve fails, the folded component goes back to how
  it was, other components keep their answer, and the relation stays.
  Nothing on a folded entity is called redundant.
- **Named minimally, for any chain**, collapses and failed solves alike, by
  QuickXplain over the failed component. The set is irreducible: drop any one
  relation and the rest solve. Unit-tested in 2D and 3D: par+perp; par, par,
  perp; three lines with three perps (in 3D the six plane holds too); ang+par;
  a tangent through the centre with the incidence; a lid's par against a
  base's perp through an extrude's twins (the depth is never named); an
  ellipse and a spline run to nothing; a frame's axis onto its origin. A
  failed solve is named smaller than before: a diagonal of 30 at a square
  corner with a side of 40 names those two and the two levels, not the 25
  the least squares also left large.
- **When**: every solve the user causes. A drag's frame that would fold
  something stops where the last frame was.
- **Kernel**, geometry-free: `solve({ only })`, `snapshot`/`restore`,
  `varsOf`, `connected`, `reach`. No Rust change.
- **Two bugs the browser found** (ARCHITECTURE, 49 and 50; the count is fifty
  now). A conflict's name clicked in the status while a tool was armed left
  Delete deaf. And a drawing restored by autosave never solved at start, so
  a conflict opened reading "ready".
- **Cost** (two runs each, on a shared box at load ~3). On the largest
  fixtures, the check on a solve that folds nothing is within noise:
  pre-explicit-regions 0.7 ms bare against 0.6 checked, shapes-v15 0.5
  against 0.5, features-v12 0.1 against 0.1. With a conflict made in each (a
  par and a perp on two joined lines):
  - pre-explicit-regions, 35 relations: solve 22–26 ms, search 71–72 ms.
  - shapes-v15, 38 relations: solve 31–33 ms, search 28–31 ms.
  - features-v12, 12 relations: solve 12–15 ms, search 7–8 ms.
  - Forty chained rectangles, 280 relations in one component: solve
    120–138 ms, search 141–147 ms (300 ms before the search went ring by
    ring). A drag's frame there took 129–131 ms bare and 136–148 ms checked.
  The search is bounded at 200 trials and 500 ms.
- Tests: unit 1713 → 1755 (`conflicts.test.ts`), e2e 710 → 717
  (`conflicts.e2e.ts`: the rectangle by mouse and by iPhone 13, undo, a
  reload by autosave, a drag on the conflicted drawing; 710 is the 717 less
  the seven new ones, as the base was not run whole). `npm run test:all`:
  typecheck clean, unit 1755/1755, kernel 11/11, e2e 716/717. The one
  failure was `touch.e2e.ts`'s quiet corner ("no menu is left open by the
  first finger", the long-press already held when the second finger
  landed). It touches nothing changed here, passed 3/3 alone, and passed in
  a second whole e2e run (715 and the 2 picture tests skipped without
  `NEOCAD_E2E_SHOTS`). Pictures 261–264, looked at.
- **Left for later** (TODO): a stalled trial is believed; the own-zero rule's
  two edges; a standing conflict's cost on every edit; prevention, considered
  and not built.

## Three fingers always orbit

The owner (2026-11-07): *"Can you make it so that three fingers always
orbits?"*. Before, one finger orbited only on empty canvas with nothing armed,
and a third finger dropped everything until the hand lifted. Now three
fingers on the glass turn the view at the right-drag's rate (their centroid's
move), wherever they land and whatever tool is armed. That includes geometry
under them, a pinch the first two had begun, a long-press whose menu was open
(it is withdrawn), and a hand that was spent. A shape half-drawn is dropped,
as a second finger drops it, and the tool stays armed. In a 2D model, where
there is nothing to turn, three fingers pan, as the right button does there.
A finger lifting ends the orbit, and the two left neither pinch nor orbit
until the hand is off. A fourth finger spends the hand.

- `src/tools/gestures.ts`: an `orbit` phase and a sink call. `engine.ts` turns
  it into `orbitBy`, or `panBy` in 2D.
- Unit: the old "a third finger drops everything" test now states the new rule
  (the centroid's move, and a lift spends the hand). New tests cover an orbit
  from a pinch, from a spent hand and from a long-press, and a fourth finger.
  1713/1713.
- E2E (`touch.e2e.ts`, iPhone 13): the rectangle tool armed, with three
  fingers landing on a corner and an edge. The view turns, nothing is drawn or
  moved, there is no zoom, and the tool stays armed. Four fingers then do
  nothing. On the old code the test fails (no turn), and on the new one the
  file passes 18/18. Looked at the picture: the rectangle is turned so the z
  axis shows, and nothing is added.
- **Unverified on the device:** iOS has three-finger gestures of its own
  (swipe for undo and redo, pinch for copy and paste, a tap for the edit bar).
  Whether iOS takes the touches from the page for them, which would send
  `pointercancel` and end the orbit, cannot be seen from Chromium.

## iOS's edge swipe no longer goes "back" or "forward" in the app

The owner, from the installed app on his iPhone (2026-11-06): *"if I swipe
right from the left or right side, it takes me "back" or forward. How can I
disable this kind of navigation"*.

The cause was the Android back support (`src/backstack.ts`, built for
`docs/plans/android.md`). Under a finger it pushed a guard history entry at
the first press, plus one more whenever a press opened a menu, a flyout or a
dialog, so that Android's back closes what is open. iOS has no back button.
Its only use for those entries is the edge swipe: from the left it pops one,
and from the right it goes forward onto it again. A web page cannot switch
the swipe off, but the swipe does nothing when the page has no entry behind
it and none ahead.

So on iOS (`ios` in `main.ts`, an iPad included) the back stack pushes
nothing: no guard, and no entry for what opens. Escape and a tap outside close
things as before, and Android is unchanged.

- `test/e2e/iosback.e2e.ts` (new) drives an iPhone by finger: a tap, the logo
  menu opened and closed, a flyout held open and closed. It then counts the
  session history. It failed on the old code (two entries pushed, a guard on
  top) and passes now. `android.e2e.ts` is 14/14.
- An app already running keeps the entries it pushed before this until it is
  closed from the app switcher. A fresh launch starts with one.

## The touch harness streams a hand's events, and a held press reads its move's stamp

The iPhone drags in `solidsphone.e2e.ts` failed in four full gates in a row
(#75–#78) and passed alone. A gate that is red by default stops telling anyone
anything. Built to [`docs/plans/touch-harness.md`](docs/plans/touch-harness.md);
the load, every count and the rejected candidates are in its *As built*.

- **Reproduced first, under 20 busy loops** on the 4-core box (load ~24):
  `solidsphone` alone was 1/5 green, `android` 1/5, `overlaylock` 3/5.
- **The cause, traced** (the page's pointer events against the harness's
  sends). `fingers.ts` awaited every `Input.dispatchTouchEvent`, and every
  touch here is handled on the main thread, so a drag's twelve moves cost
  twelve main-thread turns of 50–130 ms. The move that leaves `TAP_SLOP` was
  sent after the long-press timer had fired, on time, and the circle's drag
  became a box.
- **The harness now streams.** Within one call, events go to the browser at
  the hand's pace (a move every 33 ms, a 40 ms tap) without waiting for each
  other, and the browser queues and coalesces them as it does a
  touchscreen's. Each call still returns only once the page has handled
  everything it sent. Every event carries the hand's own timestamp. `hold`
  waits for its landing before it holds.
- **The recogniser reads a held press's move by its stamp**
  (`gestures.ts`'s `move`). With the harness streaming, a second race showed
  on android's Pixel 7. The page was busy from the landing until its timer
  was due, and it ran the timer before the move it already had, which was
  stamped 171 ms. A move past the slop stamped before `LONG_PRESS_MS` is now
  a drag: the long-press is abandoned and its menu withdrawn. This is right
  on a phone too, since a page busy drawing at touchdown does the same
  whatever sends the events. It is the reading a tap's length already had.
  Three unit tests; the first fails without the rule.
- **Rejected by measurement:** Playwright's `page.clock` paused through a
  gesture. It made `solidsphone` green, but it freezes `performance.now()` and
  broke touch's *"a quick tap while the page is busy is still a tap"* (0/2).
- **A hand at the pace the suite was written against: 33 ms a move.** The
  first build streamed at 16 ms, believing that was the old pace. The full
  gate showed it was not: toolbargroups' iPhone-landscape slide lost the tap
  after its fling (0/3 unloaded). The old helper had really sent a move every
  32–35 ms.
- **After, alone, 5 runs each at the same 20 loops:** `solidsphone` 5/5 (from
  1/5), `android` 5/5 (from 1/5), `overlaylock` 5/5 (from 3/5).
  `solidfilletsphone`, `touch` and `surfacesphone` stayed at 5/5, and
  `toolbargroups` was 5/5. Two of `overlaylock`'s fixed sleeps that are not
  touches failed at this load, a rotation's relayout at 400 ms and the boxes'
  fade at 250 ms. They now poll what they assert, in a commit of their own.
- **Left, and written down in TODO:** at load 25 and up a tap on chrome is now
  and then lost with either harness (the page took up to 1.4 s to handle the
  touch, and the click is Chromium's own); a long-press timed from the
  landing's handling, not its stamp; the stamp rule untried on Safari.

## The spline: a curve through points you can drag

The owner: *"give me better sketch tools, relations, trim, slot... all the
usual"*. After the polygon, slot and ellipse, the curve every CAD sketch
has. Built to [`docs/plans/spline.md`](docs/plans/spline.md); every
deviation, the table of what each edit does with a spline, and the
OpenCascade reading are in its *As built*.

- **A cubic B-spline through the points you click** — Onshape's spline, not a
  control polygon. The **spline tool** is under the **curves** button beside
  the ellipse (picture 246): click the points, watch the curve grow through
  them (247); a second click on the last (a double-click), Enter or ✓ ends
  it open (248); a click on the first, with three laid, closes it (255).
  Typed: `spline("p1", "p2", [10, 5], { closed: true })` — names or
  coordinates — answering `sp1`. Open, its ends are natural (no curvature);
  closed, it is smooth to the second derivative round its seam. Its knots
  are centripetal, so it neither overshoots a tight turn nor loops between
  close points.
- **Its points are ordinary points**: drag one and the curve follows, still
  through every point (249); dimension between them (250); `coin`, `fix`,
  snap to them. The curve's control points are its own variables, held by
  equations the spline **owns** — made with it, deleted with it, journalled
  with it as one step (ARCHITECTURE.md, "An entity can own its equations").
  Deleting a through-point takes the spline; deleting the spline leaves its
  points.
- **Relations**: `onspline("p9", "sp1")` holds a point on the curve, sliding
  along it, by a parameter of the relation's own (saved, so it opens where it
  was); a click on the curve with the point tool infers it. `tan` takes a
  spline at an end — with a line, an arc or a circle at the end they share,
  or another spline end to end.
- **The menu on the curve**: *Add point here* (`addThrough`, the curve bends
  a little anew through it — picture 251), *Remove point pN*
  (`removeThrough`), and *Remove from sp1* on a through-point.
- **Solids**: a spline is a profile edge, a closed loop on its own, or a
  hole, for extrude and revolve (252, 256); its wall is the spline swept, a
  surface of linear extrusion or of revolution over the spline's own
  `B_SPLINE_CURVE_WITH_KNOTS`, and the solid kernel takes it as its exact
  NURBS. STEP of six spline parts read valid by OpenCascade 8.0.1, the
  volumes the closed forms to 3·10⁻¹¹ (`test/fixtures/step-spline/`).
- **Drawn smooth**: within a quarter pixel of the curve and no chord turning
  more than 2° from the next — the wall's shading at 3× showed bands until
  the second rule (253, 254).
- **The sketch edits** (the spec's table, every refusal tested): a spline
  **cuts** a line, arc or circle it crosses, and a line extends to one; mirror
  and the patterns copy it as the spline through the copied points; trim,
  extend and offset of a spline itself are refused by name, as is a region
  bounded by part of one. Surfaces sweep and turn one.
- **Found on the way**: the kernel's revolve named a profile's faces by its
  members' first points, wrong when a member starts on the axis (fixed, with
  arcs only); a closed spline in no frame's plane could not be extruded
  (sketchface.ts asked it for a normal); a chord between a closed spline's
  own points split nothing; three by looking at pictures — a lid's spline
  points drawn as dots, the wall's bands, and a phone chip's sentence wrapped
  to three lines (ARCHITECTURE.md's list, now forty-eight).
- **Format 18** (`values.splines`, `values.params`). Old files open
  unchanged.
- On an iPhone 13 (Chromium's emulation): armed from the curves flyout by a
  held finger, tapped, ✓ (257, 258); a closed one extruded and undone from
  the action strip (259, 260).
- Tests: unit `test/spline.test.ts` (12), `test/splinesolids.test.ts` (9),
  `test/splineedit.test.ts` (8), `test/stepspline.test.ts` (6); browser
  `test/e2e/spline.e2e.ts` (7).

---

## Surfaces: a surface is a thing, and trim, knit, fillet and thicken are operations

The owner: *"please add solid and surface fillet tools if possible"*, and
then *"also fillets and chamfers for surfaces."* The rule this follows is his,
from regions: *there is no negative face or solid, only an operation between
things.* Built to [`docs/plans/surfaces.md`](docs/plans/surfaces.md); every
deviation, and what the kernel could not do, is in its *As built*.

- **A surface is made, and named `s1`, `s2`, ….** `surface("l1", 20)` sweeps
  the chain through `l1` (open or closed) 20 along its plane's normal;
  `surface("l1", "l9", 90)` revolves it about `l9`; `surface("l1")` on a
  closed loop is the planar face inside it (a hole drawn inside is a trim,
  not a negative); `surface("e1.lid")` is a solid's face as a surface. Each
  is a sheet — a shell with no inside — drawn two-sided, listed in the
  organiser under **Surfaces**, hideable, with the kernel's edges.
- **The surface tool** sits under the extrude button (a new **sweep** group,
  so the toolbar keeps its thirteen): click a curve and its chain is lit —
  or the curve alone, with *chain* off — click inside a loop for the planar
  face, ✓ (picture 236).
- **Operations, never negatives**, each a record in the surface's chain as
  a body's booleans are: `trim("s1", by, point)` by a curve (projected along
  its plane's normal) or by another surface where they cross, keeping the
  side the point is on — **the trim tool trims a surface when you press on
  one**, the press being the side kept (picture 237); `extend("s1", edge,
  5)` lengthens a swept surface at a boundary edge; `knit("s1", "s2")` makes
  one sheet where edges meet (picture 238); `offset("s1", 3)` a new surface
  along its normals; `thicken("s1", 2)` a solid from a sheet, and
  `solidify("s1")` a closed knit filled.
- **Fillets and chamfers for surfaces, with the solid's tools.** The round
  and chamfer tools take a surface's shared edges as they take a solid's —
  click the join a knit made, the kernel's preview, ✓ — `fillet("s1",
  ["s1.base|s3.m0"], 4)` (pictures 239, 242). The chamfer is the same,
  armed from the modify group with its setback typed in the panel:
  `chamfer("s1", ["s1.base|s3.m0"], 3)`, a flat in place of the corner
  (pictures 244, 245). Between two surfaces that do
  not share an edge, click one and then the other: each is trimmed back to
  the other where they cross, the clicks being the sides kept, knitted and
  rounded, in one record — `fillet("s1", "s2", 3)`. Picture 240 is the
  filleted sheet thickened, its volume the closed form to 10⁻⁵.
- **The verbs the sketch already had are shared, never guessed.** `trim`,
  `extend`, `offset`, `fillet` and `chamfer` are the surface's when the
  first argument is a surface and exactly what they were otherwise; each is
  journalled under its own name (`trimSurface`, `filletSurfaces`, …), so a
  file made before this opens unchanged and no file can replay one as the
  other. A name that reads as a surface's but is not one (`s9`) is refused
  as a surface's, not the sketch's. `help()` lists both under each verb.
- **The context menu on a surface**: Thicken…, Offset…, Knit with s2,
  Solidify, Delete; a sheet's open edge offers Extend….
- **A surfaces workbench**, the part's modules, for the toolbar it implies.
- **STEP**: a surface is written as an open shell in a
  `SHELL_BASED_SURFACE_MODEL`; a thickened one as a solid. The four test
  parts (a holed plate, a revolved band, a knitted and filleted L, and that
  thickened) read valid by OpenCascade 8.0.1, their areas and the volume the
  closed forms to about 10⁻⁸ (`test/fixtures/step-surfaces/`).
- **What the kernel could not do**, written down: SMLib extends no trimmed
  face, so `extend` acts on the sweep that made the surface; its own thicken
  makes no solid of a sheet, so thicken is built from the sheet, its offset
  and ruled walls; its planar-face call took the module down whenever the
  face was trimmed or knitted twice, so a planar surface is the cap of a
  sweep, taken on its own; its face–face blend leaves both surfaces whole,
  so the fillet between two is built from trim, knit and the edge fillet.
- On the phone: the same flow by finger — tap the face, ✓, trim, a wall, the
  knit from a held finger's menu, the join's fillet, thicken, share
  (pictures 241–243).

## Panels reshuffle rather than push

The owner: *"When I push toolbars around, they should be able to reorder with
other toolbars. So reshuffle rather than push."* Built to
[`docs/plans/panels-reshuffle.md`](docs/plans/panels-reshuffle.md); every
deviation is in its *As built*.

- **The panes along an edge are a sequence**, read from where they are: down
  a side top to bottom, along the top or the bottom left to right. A pane
  within 16 px of an edge (22 under a finger) is on it.
- **Dragged along its edge, a pane reorders.** Past the middle of a
  neighbour it takes that neighbour's slot, and the neighbour takes its own —
  on down the line, as a dock's icons do; the ends of the stretch stay where
  they were and nothing outside it moves. The command line dragged up past the
  log on a desktop: they trade places (pictures 224, 225).
- **Brought to another edge, it is inserted** where you drop it, between the
  two it lands between; those after it make room, only as far as they must.
  A toolbar takes the way that edge runs — in its ghost; it turns at the drop.
- **Dropped on a floating pane, the two trade places.** Anywhere else a pane
  lands where you put it, or stops flush against what it would lie on.
- **The others make room.** Any pane the one you drop would lie on — off the
  edge it joins, or where a trade or a reorder lands — moves to the nearest
  place that is free, and the ghosts show where before you let go. The
  toolbar taken to the top of an upright phone becomes a row just under the
  logo's row, and the organiser, the log and the action strip go below it
  (pictures 231, 232); the command line slid past the log in Safari takes the
  log's place and the organiser moves out from under it (233, 234).
- **No room on an edge**: the pane goes on a second line beside the first.
  Only where the panes genuinely cannot all fit at their sizes does its ghost
  stay home and say *no room on this edge*, and letting go moves nothing (the
  status says so too). Over 1 500 random drops on a phone's defaults that is
  5 % upright and 1 % on its side — it was a third before the others made
  room — and mostly the command line, as wide as the screen, with no band of
  its height left.
- Along the top, a pane starts after the logo **and the status's room**
  beside it, so the status is never squeezed into a sliver.
- Unchanged: the preview (the drop at this spot, ghosts, nothing moves until
  you let go, Escape), the lock (it refuses a reorder as any drag), a resize
  still grows into its neighbour, and how layouts are stored — so yours reads
  into the same order with nothing migrated.

## Touch targets that follow the interface size, and less air between tools

The owner, from his phone: *"for the scaling, the text resizes but the
spacing between e.g menu items and toolbar items barely changes. Not sure
why. There must be some scaling you're missing. Also in general the white
space between eg the tools on the tool palettes is a bit too much"*. And, on
his iPhone on its side: *"when I move something up against the left or right
edge, it hits an invisible edge, but then the padding of the palette expands
out to touch the edge of the screen. Strange behaviour"*. Built to
[`docs/plans/touch-density.md`](docs/plans/touch-density.md); every
measurement and deviation is in its *As built*.

- **Every target under a finger follows the interface size.** It was a
  literal 44 px, so 80 % shrank the type and left every row where it was.
  Now it is 44 at your device's own 100 %, 35 at 80 %, 57 at 130 %, and never
  under 32: menu items, menu rows, choices, the spin box, organiser rows,
  strips, grips, option rows, ✓/✗, the chip's parts and the tray's pitch.
  Measured on an iPhone 13, an SE, a Pixel 7 and a Pixel Tablet, both ways
  up: a menu item is 35 / 44 / 57 px at 80 / 100 / 130 % (it was 44 at all
  three). `ui()` says the target in force.
- **The tools fill their targets**: a tray button is drawn at 0.8 of its
  target — 35 px at 100 % with a 26 px glyph, where it was 26 with a 21 px
  glyph in an 18 px gap. At 80 % the tray is shorter (a 35 px pitch where it
  was 44) and the air between glyphs is 14 px, not 27. 0.75 and 0.85 were
  looked at at 1× and 3×; 0.85 crowds the armed tool's face against the
  tray's border, 0.75 reads as loose as before.
- **A pane bleeds only into the bottom inset.** Pushed against a side or the
  top, it is drawn exactly where it stopped, the drawing visible under the
  cutout; the command line still reaches the glass under the home indicator.
- **No pane is drawn over another when a layout cannot fit.** Your landscape
  picture's log over the command line was not the bleed: the places you had
  left the panes in could not all be had after a rotation, and what the
  resolver left was drawn as it stood. Now the panes in the way go to their
  defaults for that screen, the status says *panels re-fitted to this
  screen*, and turning back puts them where you left them.
- **The verdict is never cut.** `SOLVED 36 free` drawn half under the chip on
  an upright iPhone was the 0.6 s of its fade, when the chip took its line
  back too early. It waits for the fade's end now; asserted on all 36 ways
  of the device table. A faded status also gives up its lines, so a note
  after it is not cut.
- **The phone fillet test's flake was the app's.** Dragging a fillet's
  radius label, the drag's direction was re-read every frame from the label,
  which a new preview can stand off another face, so the radius sometimes
  fell to nothing mid-drag. It keeps the direction it had when pressed.
  Found by recording the gesture recogniser's decisions and the tool's state
  in the failing runs; the second failure was the test's, a finger left on
  the glass. 10 runs in a row green alone.

Larger sizes have bigger targets now, so the everything-fits guarantee above
100 % is shorter: 120 % everywhere with no tool or a drawing tool's options,
110 % with a feature's (the step-by-step table is in the spec). Pictures:
[216](docs/images/216-before-iphone-13-at-80-the-tray-as-long-as-at-100.png) →
[217](docs/images/217-iphone-13-at-80-the-targets-follow-the-size-the-tray-shorter.png),
[218](docs/images/218-before-iphone-13-on-its-side-at-80-two-rows-at-a-44-pitch.png) →
[219](docs/images/219-iphone-13-on-its-side-at-80-one-row-the-tools-fill-their-targets.png),
[220](docs/images/220-iphone-13-at-100-at-3x-35-px-tools-on-a-44-px-pitch.png),
[221](docs/images/221-iphone-13-on-its-side-panes-at-both-side-edges-drawn-at-the-safe-line.png),
[222](docs/images/222-pixel-7-on-its-side-panes-at-both-side-edges-drawn-at-the-safe-line.png),
[223](docs/images/223-iphone-17-pro-max-a-stored-layout-re-fitted-upright-and-said.png).
Tests: typecheck 0; unit 1622 → 1630 (+8: 7 in the new file, 1 for the
fillet drag); kernel 11; e2e 645 → 662 (+17: the new file's 15 and two
finger-gap rechecks). The full gate as run, with another worker's suite on
the same four cores (load 8–18): 655 passed, 2 skipped, 5 failed — the
Pixel 7's drags and `solidsphone`'s two (the register's load flakes; 14/14
and 3/3 alone) and the new Pixel gap recheck, whose press the recorder showed
landing on the canvas with the tap read as a long-press under load (its claim
made exact; 14/14 twice alone). **Not tried on a phone**: every number is Chromium's
emulation.

## Sketch editing: trim, extend, offset, mirror, chamfer and patterns

The owner: *"give me better sketch tools, relations, trim, slot... all the
usual"*. Built to [`docs/plans/sketch-edit.md`](docs/plans/sketch-edit.md);
its *As built* has the table of what each operation journals, refuses and
cascades, and every deviation.

- **Seven operations, each one typed line and one undo step, replayed from
  the file**: `trim("l1", [x, y, z])`, `extend("l1", "p2")`, `offset(chain,
  d)`, `mirror(names, line)`, `chamfer("l1", "l2", d)` (or two setbacks),
  `linear(names, dx, dy, n)` and `circular(names, centre, angle, n)`
  (`src/sketchedit.ts`). Each creates or re-points entities, so each is an
  operation, never a relation, and journals what it read off positions —
  where a curve is cut, which way a chain turns — beside the call.
- **What they make follows what it was made from**: a trimmed end held `on`
  the curve that cut it, so it rides that curve; an offset `par` and `dist`
  from its original, its arcs about the same centre; a mirror `sym` about a
  line or a frame's axis (`"origin.y"` — `sym` takes an axis now); a chamfer
  whose corner point stays at the sharp corner with every dimension on it, its
  ends a `dist` back along each leg; a pattern held by the step its first copy
  takes, so one dimension spaces or turns it all (three new relations,
  `translated`, `rotated`, `rotation`, proven in 3D on a tilted plane).
- **A trim across a solid's profile regenerates the solid** onto the face
  left — measured: a rectangle's extrude with a line across and the bottom
  and top edges trimmed back to it stands on the left half — **or refuses,
  saying why**, and then the model, the journal and every auto-name are
  exactly as they were: it tries the change and takes it back. A region's
  face trimmed is found again from its members, as regions-as-operations
  says. A circle trims to an arc under its own name; a curve nothing cuts is
  refused (`del` removes it whole).
- **Six tools on the modify button** — no new button: **trim** (click the
  piece, drawn red under the cursor), **extend** (click near the end, the
  reach drawn first), **offset** (click a curve, the side is the cursor's,
  ✓ — or drag the distance), **mirror** (select, ✓, click the line),
  **bevel** — the sketch's chamfer, named so it is not the solid's
  `chamfer` beside it — and **pattern** (select, Linear or Circular, ✓). The
  flyout lists the sketch's edits, then the solid's round and chamfer.
  Copies are named after their seed: copy 3 of `l1` is `l1_3`.

Found in a browser and fixed (ARCHITECTURE's 37–39): from above, a lid's edge
lies on the pixel of the sketch edge under it and won the pick, so a trim of
an extruded outline's second edge was refused as the solid's — the edit tools
read such a press on the sketch plane now; a second trim at a crossing the
extrude had made real left the solid owning a corner of the sketch, and the
header said `redundant` — the point is the sketch's now; and the first flyout
to wrap cut its second line under its own edge (`#flyout` had the tray's
padding). Pictures:
[206](docs/images/206-a-corner-bevelled-previewed-by-a-click-on-it.png),
[207](docs/images/207-an-offset-previewed-outward-on-the-cursors-side.png),
[208](docs/images/208-trim-the-piece-a-click-takes-drawn-red.png),
[209](docs/images/209-trimmed-across-the-solid-regenerated-on-the-left-half.png),
[210](docs/images/210-extend-the-reach-drawn-to-where-it-lands.png),
[211](docs/images/211-mirror-previewed-about-a-line.png),
[212](docs/images/212-a-linear-pattern-previewed-from-a-selected-circle.png),
[213](docs/images/213-iphone-13-a-piece-trimmed-by-a-tap.png),
[214](docs/images/214-iphone-13-an-open-chain-offset-previewed.png),
[215](docs/images/215-iphone-13-the-modify-flyout-in-two-lines-whole.png).

## The drag preview's ghosts are solid, translucent white

The owner: *"the outline should be solid white slightly translucent rather
than dotted"*. A ghost's outline is now solid white at 60 % opacity over a
7 % white fill; the held panel's own ghost is brighter (85 %). Its width is
unchanged — the interface size's 1.5 px, rounded to a whole pixel.

## See-through panels, each in a form of its own, and a lock

The owner: *"there should be a menu option to make the toolbars transparent
to maximize visible viewport size. and also another option to lock the
toolbars in place. note: things like the organiser toolbar etc need to have
some kind of structure to their layout in order to make the transparent view
work. like how the feature tree in solidworks changes form when it is
overlaid over the viewport vs being in a pane on the side"*. Built to
[`docs/plans/panels-overlay-lock.md`](docs/plans/panels-overlay-lock.md);
every measurement and deviation is in its *As built*.

- **Two switches in the logo menu's View**: *See-through panels* and *Lock
  panels*, typed `panels({ overlay: true })` and `panels({ locked: true })`;
  `panels()` says both. Yours, in this browser, beside the layout — never in
  a file, never an undo step.
- **See-through, each pane has a form of its own**, drawn inside the same
  rectangle it has docked (so everything that fitted still fits, on every
  iPhone and Android way, tested): the toolbar and the action strip their
  buttons alone; **the organiser a small tree in its corner** — each body a
  root with its chain under it, Groups and Regions each a root, collapsed to
  `e1 › e2 extrude · add`, ▸ to open, empty sections not drawn; the log its
  last three lines, fading, gone after ten seconds; the command line its
  input on an underline. The options panel, menus, tooltips and the mode chip
  stay opaque.
- **The drawing has everything between**: only the content takes a press,
  so a tap between two of the tree's rows, or on the tray's strip's place,
  draws — measured with the point tool on a mouse, an iPhone 13 and a Pixel
  7, both ways up.
- **A halo keeps it legible**: a thin ring in the drawing's ground round
  every letter and glyph. Sampled from the pixels over a light lid: 10–16.5 : 1,
  against 1.2–1.4 : 1 without it.
- **The hand brings the box back**: a mouse over a pane gives it its ground
  and strip under the same content; a press on its content shows it docked —
  the organiser's eyes and counts, the whole log — until you press outside.
- **Locked, the panels stay where they are**: no strip or grip is drawn, a
  drag moves and pushes nothing, and a press where a strip was says *panels
  are locked — unlock in the menu* in the chip. A rotation that leaves a
  locked layout unfittable re-fits it, says so, and turning back puts every
  pane where it was locked.

Found in a browser and fixed (ARCHITECTURE's 35–36): an 8 px gap between the
tree's rows went to a row under a finger — Chromium moves a touch onto the
nearest control its contact area reaches — so a finger's rows are 22 px
apart (20 was the first clear); and a re-fit after a rotation went unsaid
when the pane the resolver moved was a default one. Pictures:
[195](docs/images/195-see-through-on-a-desktop-the-organiser-a-tree-in-its-corner-the-log-three-lines.png),
[196](docs/images/196-iphone-13-see-through-over-a-busy-model-the-drawing-between-the-rows.png),
[197](docs/images/197-iphone-13-see-through-over-a-light-lid-the-halo-keeps-it-legible.png),
[198](docs/images/198-iphone-13-on-its-side-see-through-over-a-light-lid.png),
[199](docs/images/199-iphone-13-a-root-open-the-body-and-its-chain-see-through.png),
[200](docs/images/200-pixel-7-on-its-side-a-root-open-the-tree-hugging-the-bottom-right.png),
[201](docs/images/201-a-mouse-over-the-organiser-its-box-back-the-tree-kept.png),
[202](docs/images/202-iphone-13-a-tap-on-a-row-selects-it-and-shows-the-organiser-docked.png),
[203](docs/images/203-pixel-7-on-its-side-locked-no-strips-no-grips.png),
[204](docs/images/204-pixel-7-locked-and-see-through-the-chip-says-why-nothing-moved.png),
[205](docs/images/205-iphone-13-a-locked-layout-re-fitted-on-its-side-and-said.png).
Tests: typecheck 0; unit 1574 → 1584 (+10); kernel 11; e2e 621 → 637 (+16:
the new file's 12, and the fits suite with each switch, 4). The gate as run
(`npm run test:all`, the only worker): 634 passed, 1 skipped, 2 failed — the
phone fillet file's held-label drag and edge tap, the register's open touch
flake; alone, that file failed them in 2 of 4 runs here and in 1 of 4 on the
base commit.

## Android: the same app, at home on a Pixel or a Galaxy

The owner: *"obv this whole platform should also work on android"*. Built to
[`docs/plans/android.md`](docs/plans/android.md); every number's source and
every deviation is in its *As built*.

- **The device table has an Android column**: Pixels 7, 8 and 9 and their
  Pro sizes, Galaxy S23/S24, a Fold 7's cover and inner screens, a Galaxy Tab
  and a Pixel Tablet. Each is laid out installed with the gesture bar,
  installed with three buttons, and in a Chrome tab, with its camera cutout
  and bars. Status bars and cutouts come from AOSP's own Pixel files;
  Samsung's are estimated and say so. **Everything fits on all 66**, both
  ways up and with the keyboard up, with no change to the layout.
- **The interface size follows Android's font size.** Chrome reports it as
  `env(preferred-text-scale)`. Measured with Chrome's own setting at 130 %,
  the variable reads 1.3, while `font: medium` (the spec's suggestion) reads
  16 px whatever the setting. A Pixel's 100 % is then 1.69× a desktop's
  instead of 1.3×. `ui()` says where its text size came from.
- **Android's back closes what is open** — a flyout, the menu, the context
  menu, Add workbench…'s question, a tooltip — **and otherwise does
  nothing.** It never leaves the app or reloads it. Escape closes the same
  things through the same seam. In a desktop's tab, Back with nothing open
  still leaves the page.
- **The keyboard**: the drawing keeps its size, and the command line rides
  on the keyboard's top, beside the tray rather than over it.
- **Install app** is in the logo menu once Chrome offers to install. Tapping
  it shows Chrome's own install sheet, now with pictures (the manifest's new
  `screenshots`). Opening the app a second time focuses the window already
  open. An iPhone's menu says how Safari installs instead.
- **Files**: Open… and Save use Chrome's pickers where they exist. A picker
  that refuses or fails falls back to the Files chooser or a download, and
  the log says which door it used. **Chrome on Android will not share a
  `.json`** (its share service's list has no json), so Share… downloads
  there and says why. Add workbench… uses the picker too, and a workbench
  file opened with the installed app goes to its question.
- **Touch**: nothing new in the recogniser. Tap, drag, long-press and pinch
  work as on the iPhone. A long-press now raises no browser menu anywhere
  but on the command line and the log. A swipe from the screen's edge is
  Android's back, never a pan.

Looking found two bugs, now fixed and listed in ARCHITECTURE (31–32): a tray
button's long-press let Chrome's own menu through, and the lifted command
line kept padding for a bar it no longer touched. Measured, for two earlier
reviews (`npm run measure:android`): the mode chip's `activePlane` costs
0.9 ms a frame (2–2.7 ms under a 4× CPU throttle), so it is not cached.
Arming round on a one-sweep box waits 1.2–1.7 s for the kernel's Worker.
Pictures: [177](docs/images/188-pixel-7-installed-below-its-52px-status-bar-the-command-line-over-the-gesture-bar.png)–[183](docs/images/194-pixel-tablet-upright-with-three-buttons-along-the-bottom.png).
Tests: typecheck 0; unit 1477 → 1561 (+84); kernel 11; e2e 592 → 607 (+15: the
Android file's 14, and the Android table in fits), run in sets of three on a
machine shared with another worker. 604 passed, 1 skipped, and 2 failed: the
phone fillet file's held-label drag and edge tap, which the register already
records as missing under load. That file passed 3/3 alone, twice. Run as
its set again, the misses moved with the load. Sometimes they were those two,
sometimes solidsphone's drags (also on the register). The base, at the same
load, missed solidsphone's two. **Not tried on an Android device**, and Firefox for
Android and Samsung Internet are untested; Samsung's user agent was
smoke-run on Chromium. Worth trying: install from the logo menu, then Back
with a menu open and with nothing open, Open… and Save, and type with the
keyboard up.

## A dragged panel shows where everything will land, and nothing moves until it is dropped

The owner: *"the toolbars should push each other around, but they should show
how they will snap IF the user drops the grasped toolbar in that spot. but
until they actually drop it, the permanent position of any tool bar is not
changed"*; *"when I push a toolbar up against one side and it changes from
horizontal to vertical layout. it should not actually change the toolbar
between modes unless I let go"*; and *"when I am dragging toolbars, all the
ungripped ones should go translucent"*. Built to
[`docs/plans/panels-preview.md`](docs/plans/panels-preview.md); every
deviation is in its *As built* and the register.

- **Only the panel in your hand moves.** It is lifted (a deeper shadow) and
  follows the hand exactly; everything else stays where it is.
- **Ghosts** — a dashed outline with a faint fill — show where each panel
  the drop would push will land, and where the one in hand will snap when
  that is not under the hand (stopped against an edge or a chain, turned). A
  panel the drop would not move has none.
- **A toolbar's turn is a ghost too**: dragged to an edge that turns it, it
  stays a column (or a row) in the hand; its ghost is the turned tray, and it
  turns when you let go.
- **Every other panel goes to half opacity** for the drag, and back at the
  end.
- **Let go and it all moves at once**, gliding onto the ghosts in 120 ms.
  **Escape**, or **letting go back where you started**, moves nothing. A drop
  the layout could not take (never seen) moves nothing and says so.
- Resizing the log or the command line by a corner previews the same way.
- **The preview is the drop at this spot**: what the ghosts show depends on
  where the hand is, not the way it came — the panel taken from where it was
  straight to here, from the layout as it was at the press. Back at the start
  there are no ghosts. The rules of the push are unchanged (the same
  resolver, asked once for that move). Every preview is checked as a placed
  layout is: nothing a ghost shows overlaps.

**Measured** on an emulated iPhone 13 with the CPU slowed 4×
(`npm run measure:panels`): the move handler — the resolver, the held panel
and the ghosts drawn — 1.9 ms median, 4.1–4.5 ms at the 95th percentile; the
resolver alone under 0.1 ms median, 0.6–0.7 ms at the 95th. The opacity class: a
frame that flips it is 16.7 ms at the median, as one that flips nothing is;
dragging with and without the translucency, the same 16.7 ms median. Pictures:
[177](docs/images/177-the-command-line-held-over-the-log-the-logs-ghost-where-it-will-be-pushed.png)–[187](docs/images/187-phone-landscape-lifted-the-tray-a-column.png).
Tests: unit 1477 → 1490 (+13), e2e 592 → 606 (+14, mouse and iPhone 13 both
ways up). The gate, in sets of four files: typecheck 0, unit 1489/1489,
kernel 11, e2e 606 — 603 pass, 1 skipped, 2 failed under a load of about 10:
`solidsphone.e2e.ts`'s two touch-drawing tests, the touch harness's recorded
miss, which pass alone (3/3). After the review (the preview made the drop at
the spot, not the push along the path): unit 1490/1490, and the panels,
preview, chrome and fits e2e files 77 of 78 pass, 1 skipped. **Not tried on an iPhone**: drag the command line onto the log and
look at the ghosts, then lift; drag the toolbar to the top, watch its ghost
turn, and lift back where you started to see nothing move.

## Fillets and chamfers of a body's edges, and kernel edges a hand can pick

The owner: *"please add solid and surface fillet tools if possible (after you
do the nurbs conversion)"*. The solid fillet and the chamfer are built to
[`docs/plans/solid-fillets.md`](docs/plans/solid-fillets.md); the surface
fillet waits for surfaces ([`surfaces.md`](docs/plans/surfaces.md)). Every
deviation is in the spec's *As built*.

- **A body's edges pick.** Each kernel edge is named by its two faces,
  `e1.lid|e1.m0`. Hover one and the tag names it (`… edge of e1  len 47`). A
  click selects it, shift adds one, a box catches them, a finger reaches them.
  A right-click offers Fillet… and Chamfer…. A press on an edge still drags the
  lid line under it, so resizing a body by its edge works as it did.
- **Fillet** — `fillet("e1", ["e1.lid|e1.m0", …], 3)`, or the **round** tool
  on the modify button. It is a feature in the body's chain, after what it
  rounds and before whatever comes next, and its radius is a dimension:
  `set`, undo and Set value… work as for any. Click edges, a face for its
  edges, the face again for the whole body; tangent chains take a rounded rim
  whole. The preview is the kernel's own body, shaded across the blend,
  standing in for the body until ✓. Drag the `R3` label on the drawing to
  change the radius. `edit("e3")` opens it again.
- **Chamfer** — `chamfer("e1", [...], 2)`, or the chamfer tool: the same, with
  one setback along both faces.
- **Identity by name.** A cut that takes a filleted edge leaves it out of its
  fillet and says so. A notch that splits the edge leaves both pieces rounded.
  A thicker plate keeps every name.
- **STEP** writes a fillet's faces as the kernel's B-splines. OpenCascade 8.0.1
  read a filleted, a rounded-outline and a chamfered part as valid closed
  solids, healed and strict, with volumes equal to the closed forms (table in
  the spec).
- **Memory:** 200 rebuilds of the spike's leaking fillet leak 150 kB each, and
  peak at 46 MB of the Worker's 256 MB. Upstream has no newer version that
  might fix it.

**Not done:** variable radius, face fillets, setback corners, two-distance
chamfers. SMLib also will not fillet an edge that runs into an earlier fillet
at a corner; the refusal says to add the edge to that fillet instead. Looking
found four bugs, now fixed and listed in ARCHITECTURE. Pictures:
[167](docs/images/167-the-round-tool-armed-a-kernel-edge-lit-under-the-cursor.png)–[176](docs/images/176-phone-the-finger-holds-the-radius-label-the-preview-follows.png).
Tests: unit 1435 → 1453 (+18; 1477 merged with regions as operations), e2e +11; the gate, merged: typecheck 0, unit 1477/1477, kernel 11, e2e 592 in sets of four files — 591 pass, 0 fail, 1 skipped. **Not tried on an iPhone**: try
filleting a lid's edge and dragging the radius label.

## Regions as operations: a face is a face, and a region is faces combined by named operations

The owner: *"rather than auto detecting regions + things inside that region
which then get subtracted automatically, there should be explicit
specification of positive region and negative region"* — and then,
correcting himself: *"there should be no such thing as a negative face. a
face is just a face. just like there should be no such thing as a negative
solid, only an operation which subtracts one solid from another"*. Built to
[`docs/plans/regions-as-operations.md`](docs/plans/regions-as-operations.md);
every deviation is in its *As built*.

- **A face is a closed loop, found — its whole inside.** A circle drawn
  inside a rectangle is a circle, and the rectangle's face is the whole
  rectangle, until an operation says otherwise. So `extrude("l1", 10)` and a
  click with the extrude tool make a solid plate: **nothing is proposed as a
  hole any more.** This is a change in what the extrude and revolve tools do,
  and the explicit-regions creating dialog's click that took a proposed hole
  out is gone with the proposal.
- **A region is a named thing made by operations**: `region("l1")` makes
  `rg1` of the face `l1` bounds; `subtract("rg1", "c1")`, `add("rg1", "c3")`
  and `intersect("rg1", "l9")` change it. Each is one typed line, one undo
  step, journalled with its face resolved and replayed without finding
  anything. Its area is the faces' as loops.ts measures them, exactly. A face
  added beside a region merges with it into one outline.
- **A feature takes a region**: `extrude("rg1", 10)`, `revolve("rg1",
  "f1.y")`. A bare face makes its region on the way (`rg1 = l1–l4  (made for
  e1)`, in the log). Several features may stand on one region; editing the
  region regenerates every one of them. The extrude and revolve tools take
  the region a click is inside, its holes and islands as its operations made
  them.
- **The region tool**, under the shapes button: click a face to make a
  region, then click faces to **Subtract** (what an unpressed mode row
  means), or press **Add**, **∩** or **New** in the row, as the extrude
  dialog's. With a region in hand a click is read on its plane, so a circle
  under the region's own solid is the circle.
- **The organiser lists Regions** — `rg1  l1–l4 − c1 − c2` — with the eye,
  *Edit rg1* (`edit("rg1")`, the tool armed on it), *Extrude rg1* and Delete.
  A region nothing stands on yet is tinted faintly in a violet of its own.
- **`hole("e1", "c1")` and `unhole(…)` are aliases now**: the step on e1's
  region that gives the loop the meaning they always gave it, journalled as
  that `subtract` or `add`. The menu's *Add as hole to e1* still types them.
- **Deleting a face a region names: the region loses it** (the decision,
  vetoable). The step comes out of the chain and the solid is rebuilt
  without it — the hole fills, the solid stays, as it did. Deleting the
  region's first face takes the region; `del("rg1")` takes the features on
  it and keeps the sketch.
- **Format 17. A file's holes become regions at open**: each old feature its
  region and its holes `subtract`s (an island an `add`), each old
  `hole`/`unhole` the step it meant, every entry still carrying the profiles
  it rebuilt — so the model is the same, thing for thing. Proved on every
  journal fixture with a feature, against the same file replayed with the
  translation off. A file re-saves in today's vocabulary.
- **The rule, written down for all three algebras** (ARCHITECTURE's
  *Nothing is negative*): faces → regions, surfaces → surfaces (trim, extend,
  knit — not built; `surfaces.md`), solids → bodies.

Found by the e2e test and by looking: a click on a circle under the
region's own solid landed on the lid's twin of it; pressing a mode button
put the region down; the mode row's label was cut to one letter
(ARCHITECTURE's 24–26). Pictures: [161](docs/images/161-the-region-tool-a-plate-less-two-circles-in-hand.png)–[166](docs/images/166-iphone-the-solid-follows-its-region.png).
**Not tried on an iPhone**: try the region tool by taps, then extrude it.

Tests: typecheck 0 errors; unit 1435 → 1458; kernel 11; e2e 581 (575 before, by the base's records: workbenches' 564 and mode feedback's 11), run in sets of five while building and then whole as the gate: 579 pass, 1 skipped, 1 failed under a load of 16 — solidsphone's iPhone boss — which passes alone (3/3).

## The dev server no longer reloads the tests when a worker checks out a tree

Three gates in a row lost tests to "Execution context was destroyed, most
likely because of a navigation" — a page reloading mid-test. The cause:
Vite reloads every open page when any `.html` file under the project root
changes, and the agents' worktrees live under `.claude/worktrees/` inside
the root, so a worker checking out its tree (which writes an `index.html`)
reloaded the suite's pages. `vite.config.ts` now tells the watcher to ignore
`.claude/**`; nothing under it is the app's.

## Mode feedback: the sketch plane drawn, a chip that says where · what · next, and Done

The owner: *"at the moment, it is not obvious how the UI works. like when
creating a sketch or a face or something - in active face mode or whatever,
it isnt obvious to me that is whats happening. needs clearer
visual/contextual feedback to the user."* Built to
[`docs/plans/mode-feedback.md`](docs/plans/mode-feedback.md); every
deviation is in its *As built*.

- **The plane being sketched on is drawn.** The face it was taken from is
  tinted the tools' green, lighter, and outlined in the green, in every view
  mode. Turn the view and the tint is still there. Look from behind the solid
  and it fades, its outline dimmed as a hidden edge is. A frame made the
  work plane is a patch with a faint grid whose step follows the zoom. With
  no plane chosen nothing is drawn: drawing on the ground is not a mode. A
  default frame on its own is named in the chip, not drawn.
- **The mode chip**, beside the status: `on e1's top · circle · drag the
  radius`. Where is the face, named by its feature and side, or the frame by
  name. What is the tool. Next is the gesture's next step, from the tool,
  worded for a mouse or a finger ("click", "tap"). The plane's name opens
  Look at, Change… and Done; the tool's name opens its options. A miss's
  guidance is said here, where the next step is, and goes once the step
  moves on. The status keeps the verdict, which the chip gives way to rather
  than cut on a phone.
- **Done** beside the plane's name ends the plane in one tap. It types
  `workplane(null)` (or `setDefaultFrame(null)` for a default frame's
  plane), so it is logged, journalled and undone like any typed line. The
  camera stays where it is.
- **What is held on the plane is in focus; the rest is dimmed one step.**
  Held means by the relation that holds it there (`onPlane`, the `par` on a
  curve's normal), never by where it happens to lie. Picking is unchanged.
- **The stage is drawn.** A ghost dot shows where a mouse click would place
  the next point. The line tool's chain is in the green until it ends. The
  fillet tool lights the corners it can take, through one new seam
  (`Tool.takes`), beside `Tool.next` and `Tool.placed`.

On a phone the chip wraps under the logo, as the status does, and is over no
pane on any iPhone in the device table, both ways up, installed and in Safari
(the fits suite). Looking at the screenshots found three bugs, now fixed and
listed in ARCHITECTURE: stale guidance over a picked region, Done's tap taken
by the line below on a landscape phone, and the verdict cut off on an upright
one. Pictures: [135](docs/images/148-sketching-on-the-lid-tinted-the-chip-says-on-e1s-top.png)–[147](docs/images/160-a-frame-made-the-work-plane-a-patch-with-a-grid.png).
**Not tried on an iPhone**: try sketching on a face, turning the view, and
tapping Done.

## Workbenches — the app as modules, and Add workbench… from a file

The owner: *"the whole framework should be modular and extensible (!). like
onshape workbenches"* — and *"obv the concept is that I should be able to add
a workbench simply by opening a file on my device, from the menu... should be
some item like 'add workbench'"*
([`docs/plans/workbenches.md`](docs/plans/workbenches.md), with every
deviation under *As built*):

- **A module is the unit.** `defineModule(name, { tools, icons, groups,
  relations, operations, entities, menu, files, help, commands })` registers
  everything a module brings in one call, and every table that used to be
  kept by hand — the tray's glyphs and groups, the menu's tool items and File
  items, the relation vocabulary, the replay table a file is opened by,
  `help()` — is filled from the modules in load order. The app is seven
  built-in modules (`src/modules/`): core, sketch, solids, files, step,
  organiser, interface. A module that registers a name something already has
  is refused with that name, and registers nothing. `modules()` lists them.
- **Nothing you could see changed.** The whole unit suite passes with the
  same tests, the e2e suite has the same results as the build before, failure
  for failure (that build had twelve, since fixed on the working branch: see
  TODO.md), and every
  fixture file — and a new one with every sketch-shapes piece in it, written
  by the build before — replays to the same bytes.
- **The entity extension point.** An entity kind is declared — what it is
  built of, what it owns, whether it is a curve, closed, carries a plane, the
  relations that hold a point on it, the frame it is drawn and looped by, its
  hover line, its STEP spelling, its constructor — and each layer asks the
  declaration. The proof: the ellipse moved out of the model into the sketch
  module, and `grep ellipse src/model.ts src/loops.ts src/faces.ts
  src/picking.ts src/step.ts` is empty (a test holds it). Found on the way:
  the diagnosis never counted an ellipse's minor or normal, so an ellipse
  whose minor nothing held read as fully held; it now reads free.
- **Workbenches.** A workbench is a named set of modules with its own tray:
  **part** (the default — today's tray exactly) and **sketch** (no solids).
  Switch in the logo menu's new Workbench section, or `workbench("sketch")`;
  the tray and the menu follow, and a typed name works in any workbench. The
  document remembers its workbench (format 16; a file in part is the file it
  was but for its version), and the organiser's heading names it.
- **Add workbench…** in the logo menu opens the device's file picker (a
  dropped `.zerocad.js`, or `loadModule(url)`, too). The file's manifest —
  a comment at its top — is shown before anything in it runs: its tools,
  relations, operations and entity kinds, by name, and that it runs with the
  command line's authority, curated and not a sandbox. Added, it is loaded,
  kept on the device and loaded at every start; the menu lists it with
  **Share…** (the file back, byte for byte) and **Remove**. A file that
  registers anything its manifest did not show is refused, and registers
  nothing. A drawing that uses an added workbench records it; opened on a
  device without it, it says which is missing, opens everything else, and
  offers Add workbench… — after which it opens whole.
- At the command line, `defineRelation`, `defineOperation` and
  `defineEntity` join a `user` module as `defineTool` puts a tool on the
  tray, and a file carries their source as text, as it carries a tool's.

Screenshots 135–143. Tests: `test/modules.test.ts` (10) and
`test/e2e/workbenches.e2e.ts` (9, mouse and iPhone 13).

## A touch offset that persisted: the page scrolled back to zero whenever iOS may have scrolled it

The owner, from his iPhone: *"a weird bug where the touch input is offset
upwards at some point and it persists"*. The engine maps every press from a
fresh `getBoundingClientRect`, so nothing of ours is stale. What fits the
symptom is WebKit's: the page is fixed by its four edges, but iOS scrolls the
layout viewport to bring a focused field above the keyboard and, in an
installed app, can leave that scroll behind when the keyboard goes — from
then on a touch's client position and the fixed canvas disagree by the
leftover, every press landing above the finger, until a reload. The scroll
is now put back to zero when a field loses focus (after the keyboard's
animation), when the visual viewport settles, and on every press on the
drawing, so a press already off heals the next. Chromium cannot scroll this
page at all, so this is unverified until the owner's phone says; the trigger
he saw is still to be named (after typing? after rotating?). In TODO.md.

## The tray's ends, fields that scale, and a column that wraps above the command line

The owner, from his iPhone: *"the first button in the toolbars is too close
to the handle, and there is too much blank space after the end of the last
tool"*, and *"the cmd text does not scale... the title of this pane scales,
but not the text itself"*. Three things, each measured:

- **The tray's padding along its run is half a gap more at each end.** The
  run `traySize` gives holds `per` gaps and the grid draws `per − 1`, so one
  gap — 18 px on a phone, 2 px on a desktop — sat empty after the last
  button while the first sat 3 px from the strip. The first button is now
  half a gap from the strip and the last half a gap from the end; the run is
  unchanged, so no layout arithmetic moved.
- **Fields scale with everything else.** The 16 px floor under a finger
  (against Safari zooming into a focused field) held the command line at
  16 px below 95 %, which is exactly where the owner was looking; the
  viewport meta's `maximum-scale=1` is what stops that zoom, and the floor
  is retired (`chrome-logo-scale.md`, As built — vetoable by one check on
  the device: if a focused field zooms the page, say so).
- **Dimension and constrain share a button, the *relate* group.** Fourteen
  buttons at a phone's 100 % (the two of them and the curves group's button
  together) ran one pixel onto an iPhone 13's command line; the line stepped
  aside to the right of the tray, and its strip's 44 px hit box then lay
  under the last button (measured). Wrapping the column instead moved every
  other pane on the phone, so the two relation tools — both make a relation
  — are one button, and the column is the thirteen that the relations
  package passed its gate with. Vetoable in the register.

## Sketch shapes — a polygon, a slot, and the ellipse

The owner: *"give me better sketch tools, relations, trim, slot... all the
usual"*. Three tools, in the families the toolbar groups made room for
([`docs/plans/sketch-shapes.md`](docs/plans/sketch-shapes.md), with every
deviation):

- **Polygon** (shapes): press at the centre, drag to a corner; `n` sides (6)
  and `circumscribed` in the options panel. It leaves n points, n lines and a
  construction circle through the corners, each side `eq` to the one before
  it — ordinary relations, so a side dimensioned resizes it and a corner
  dragged turns it, regular all the way. Inscribed adds a second circle
  inside, touching the sides. Typed: `polygon("p1", "p2", 6)`.
- **Slot** (shapes): drag between the two centres, then click (or tap) the
  width — or set `width` and skip that. Two lines, two arcs about the
  centres, a construction line between them for the length; `rad` on an arc
  is half the width. Typed: `slot("p1", "p2", 10)`.
- **Ellipse** (curves, after arc): drag from the centre to the end of the
  major axis, then click the minor. A new kind of entity — a centre, a
  major-end point, a minor semi-axis, and in 3D a normal — with its own
  relations: `onellipse(p, e)` (a line drawn onto one infers it),
  `tan(line, e)`, `conc` with circles, and `major(e, 30)` / `minor(e, 12)`,
  dimensions labelled `a30` and `b12` (the menu's Dimension major / minor).
  It bounds regions (a line across one cuts it), extrudes to an elliptic
  cylinder, goes to the solid kernel as its exact NURBS, and exports to STEP
  as `ELLIPSE`s and a surface of linear extrusion — read back by OpenCascade
  as valid, the volume to 3e-16 (the table is in the spec). Typed:
  `ellipse(pt(0, 0), 30, 12)`.

Twelve toolbar buttons now (curves). Format 15 for the ellipse; older files
open as they were. Out of scope, refused by name: `tan` between an ellipse
and a curve, revolving an ellipse, extruding part of one. Found on the way:
a tangency at a point already held on the curve is a square in disguise —
the slot says its tangencies as `perp` to the radius instead, and the
fillet has the same flaw (TODO.md). An ellipse is sampled where it
bends — evenly in its normal's direction, as finely as its flattest stretch
needs — after the shaded wall of an extruded one showed bands. Pictures: docs/images/118–126. Not tried
on an iPhone.

## Sketch relations — a dimension tool, a constrain tool, and knowing what is free

The owner: *"give me better sketch tools, relations, trim, slot... all the
usual"* — and earlier *"strict rule enforcement"*: a model should say what is
under-constrained and what conflicts
([`docs/plans/sketch-relations.md`](docs/plans/sketch-relations.md), with
every deviation):

- **What is free is drawn blue.** After every solve — not during a drag —
  the solver's Jacobian is asked its rank (a new kernel function,
  `null_support`, in Rust), and every entity some motion can still move with
  all its relations holding is drawn in a blue ink, Onshape's; held ones keep
  the sketch's own. The status says `SOLVED · 5 free` — degrees of freedom —
  down to `0 free`. 2.1 ms on the biggest drawing the suite carries.
- **A conflict names its relations.** `CONFLICT`, and beside it
  `d1 · d2 cannot all hold`: each name a button that selects the relation, so
  Delete removes it; their marks on the drawing turn red; the log says them in
  full. A relation the earlier ones already imply is **redundant** — said in
  orange, never refused.
- **The dimension tool** (its own button): click a line, two points, a point
  and a line, two lines, or a circle — then empty canvas — and it types the
  `dist`, `ang` or `rad` holding what it measures, rounded as the menu's
  Dimension is. Options: diameter (`dia`) and **driven** (`measure(…)`, a
  reference dimension in parentheses that measures and holds nothing).
- **The constrain tool** (its own button): select things, press it, and the
  relations they take are listed — two lines: Parallel, Perpendicular, Equal,
  Collinear, Angle; a point and a line: On, Midpoint, Distance; two circles:
  Concentric, Equal, Tangent; … One press types one. The context menu on a
  selection carries the same list.
- **Relations**: `col`, `intersection`, `pierce` (3D), `spacing`, `dia`,
  `measure`; `dist` to a line and between lines; `eq` between circles and
  between a line and an arc; `mid` of an arc; `horizontal` and `vertical`,
  which are `par` against the default frame's axis, drawn `—` and `|`.
- **A fillet's corner is now exact.** `tan` where a line or arc leaves an
  arc's own end was a double root: the solve stopped within the square root
  of its tolerance — a filleted rectangle's tangent points 0.0018 off — and
  would have read every such joint as free. It has a join form there now.

Two buttons more makes thirteen: on an iPhone 13 held sideways the toolbar is
two rows again. The dimension label is not yet draggable (TODO.md). Not tried
on an iPhone. Pictures: docs/images/126–134 (118–125 are the sibling sketch-shapes package's).

Tests: unit 1290 → 1327 passing (37 skipped, as before), with
`test/sketchrelations.test.ts` adding 37; Rust 3 → 11; e2e: 10 new in
`test/e2e/sketchrelations.e2e.ts` (mouse, iPhone 13, landscape), and the
suite's eleven-button counts moved to thirteen.

---

## Toolbar groups — one button per family, the rest a flyout away

The owner: *"give me better sketch tools, relations, trim, slot... all the
usual"* — and before that, *"Second row.... everything has to fit"*. The
packages queued behind this add a dozen tools; twenty-three buttons fit no
phone. So a family shares one button
([`docs/plans/toolbar-groups.md`](docs/plans/toolbar-groups.md), with every
deviation):

- **The table** (`TOOL_GROUPS` in `src/tools/tool.ts`, vetoable): *shapes* —
  rectangle, polygon, slot; *curves* — ellipse, spline; *modify* — fillet,
  chamfer, trim, extend, offset, mirror, pattern. Select, the Hand, point,
  line, circle, arc, extrude, revolve and sketch keep a button each. A
  group with no registered member has no button. Eleven buttons today, as
  before; fourteen when every queued package has landed.
- **The button shows the one armed last** — by the flyout, the button, or
  `arm("polygon")` typed — remembered per browser, never in a file, and a
  tap arms it. Once a group has two members its button carries a small
  triangle in its corner.
- **The flyout**, beside the tray and clear of every pane on every iPhone
  in the device table: under a mouse, rest on the button or press and hold,
  then click; under a finger, press and slide off onto a tool and lift — one
  gesture, as a phone keyboard's accents — or hold and tap. A plain tap never
  opens it. Escape, leaving it, or a press elsewhere puts it away. Each
  item has its tooltip.
- A tool defined at the command line joins a family with
  `static group = "shapes"`; the context menu lists a family of two or more
  under its name; `help()` says which tools share a button.
- Found by looking: an item's tooltip lay over the tray's buttons. A
  tooltip can now be told what else to keep off, and a flyout item's keeps
  off its tray.

Today every group has one member, so nothing on screen changes until the
next package lands; the tests pad the groups with command-line tools.
Pictures: docs/images/111–117. Not tried on an iPhone — try a slide off the
modify button once chamfer or trim is in.

## A tap on a loaded phone is not lost to the menu

Two ways a tap could go missing when the page was slow, both found by the
touch suite under the full suite's load while solids were being built (the
solids PR left it open; 6 of 9 full runs there), fixed in the engine rather
than the tests:

- **A second finger ends the menu the first opened.** A finger held past
  the long-press opens the context menu. When a second finger then landed,
  the recogniser dropped the held gesture (as it should) but the menu stayed,
  so the next tap closed the menu instead of selecting what it landed on.
  Now `abandon` withdraws the menu, as a drag out of the held press already
  did. The quiet-corner test says which state the recogniser was in when
  the second finger landed, so a loaded machine's answer is legible.
- **A late long-press timer waits a grace, not one turn.** When the page was
  blocked at touchdown, the timer fired late and yielded one turn of the
  queue for a lift that might be waiting. But the browser forwards a lift only
  once the landing is acknowledged — after the block, by a message — and on
  a loaded machine that message takes longer than a turn. It now waits
  `LATE_MS` (50 ms); a long-press on a page that was already blocked longer
  opens 50 ms later, which is not felt. `gestures.test.ts` holds both.

Seen once in three paired runs and left open in `TODO.md`: the depth test
"two solids driven through each other" found the painter's picture right
everywhere (it expects it wrong inside the overlap).

## Solids on SMLib — extrude and revolve add to, cut from or start a body

The owner:

> *I find it impossible to make anything beyond an extruded shape. fix this
> so I can create complex parts*

> *consider using an open source nurbs engine, or the nvidia one so you can
> do real solving*

Spec: [`docs/plans/solids-kernel.md`](docs/plans/solids-kernel.md), marked
built; every deviation is in its *As built* and in TODO.md. NVIDIA's SMLib,
the kernel the spike chose, now ships: it is built from pinned source, runs
in a Worker, and turns features into solids. A plate with a hole cut through
it and a boss on its side is now one part, and it exports to STEP as one solid.

- **Extrude and revolve have a mode**: **New** body, **Add**, **Cut** or
  **∩** (intersect). The dialog shows it as a row of buttons, and it can be
  typed too: `extrude("c1", -10, { mode: "cut" })`, with
  `{ mode, into: "e1" }` to name the body.
  - **Left alone, the mode is Onshape's default.** A solid that touches or
    overlaps a body adds to it; a solid that touches nothing is a new body.
    The dialog lights the button for what it will do.
  - **Cut is never the default.** When the solid runs into a body, the
    dialog outlines Cut, and the log says *this runs into e1 — choose Cut to
    cut it*.
  - The mode is decided when the feature is made and saved with it. Moving
    the profile later never turns an add into a new body. Old files have no
    modes, and every solid in them stays a body of its own, as before.
- **Bodies.** A body is its first feature and everything added to it, cut
  from it or intersected with it, in the order they were made. The
  organiser lists **Bodies** first, once there is one, each with its chain
  (`e1 +e3 −e2`).
  Hiding a body hides its first feature. Hiding a later feature leaves it
  out of the body, so the hole disappears.
- **Sketch on any face**, a boolean's faces included. Click the floor of a
  pocket or the side of a boss and the sketch plane is that face. Its plane
  follows the solid when a dimension changes.
- **Names survive a rebuild.** Each face is named by the feature, role and
  profile member that made it (`e1.lid`, `e2.m0`), and each edge by its two
  faces. The kernel carries those names through every boolean. When a change
  in topology removes a face, the log says so, and a sketch on that face stays
  where it was rather than jumping. Measured:
  - a pocket deepened until it breaks through loses only its floor and the
    floor's four edges, and gets every name back when it is made shallow again;
  - a hole dragged out through a wall splits that wall into two pieces with
    one name;
  - a cut dragged off the plate is said to cut nothing.
- **Drawn from the kernel.** A body of two or more features is drawn from the
  kernel's tessellation and edges. A one-feature body is drawn as before, live
  at every frame. So every old file looks exactly as it did, and the app works
  before the kernel has loaded. A dimension drag shows the last good body
  until the new one arrives, about 0.2 s later in Chromium. A refusal leaves the last good
  body on screen and says why.
- **STEP exports bodies**: one solid per body, booleans included. Planes and
  cylinders are written from the feature data. The curves where two features
  meet are written as the kernel's B-splines. Four new parts were read back by
  OpenCascade 8.0.1, all of them valid closed solids:

  | part | strict read | OpenCascade's volume | ZeroCAD's | closed form |
  |---|---|---|---|---|
  | plate, hole cut, boss on a side | valid | 59440.796508 | 59440.796508 | 59440.796508 |
  | pocket, boss on top, hole out through a wall | valid | 59174.009151 | 59174.009151 | 59174.009151 |
  | boss on a cylinder's curved wall | valid (3·10⁻⁶ tolerance, declared 10⁻⁵) | 72265.601448 | 72265.685429 | 72265.685636 (numerical) |
  | revolved collar drilled across | **not strict**: healed read only | 103416.406515 | 103416.278900 | — |

- **What it costs.**
  - The kernel is 4.37 MB, or **1.16 MB with brotli**. The PWA loads it
    lazily as a file of its own and caches it for offline use. The single
    file is 6.2 MB, since it carries the kernel inline.
  - In Chromium, a Worker is ready in 0.16 to 0.26 s. A rebuild of the
    owner's part answers in a median of 0.19 to 0.21 s, round trip. In Node
    the full build takes 0.12 s.
  - The spike's eleven parts rebuild in a median of 171 ms in a Chromium
    Worker; the spike measured 181 ms.
  - The Worker is replaced when it dies, when it does not answer in 30 s, or
    when it grows past 256 MB.
  - About has SMLib's Apache-2.0 notice and a link to its licence.
- **CI** builds the kernel from source in 6 m 51 s cold on GitHub's four
  cores, and caches it by the recipe's hash: warm, the build is 16 s.

![A plate seen from below the top, a hole cut through it: one body, e1 −e2, in the organiser's Bodies](docs/images/106-a-hole-cut-through-the-plate-one-body.png)
![The same plate with a boss standing on its side: the organiser lists one body, e1 −e2 +e3, and the features e2 extrude · cut and e3 extrude · add](docs/images/107-a-boss-added-on-the-side-bodies-e1-minus-e2-plus-e3.png)
![The plate thickened to 16 and the hole dragged out through its wall: the kernel rebuilt the body, the hole now a notch in the edge](docs/images/108-the-plate-thickened-and-the-hole-dragged-out-through-its-wall.png)
![An iPhone: a circle on the plate's top previewed as a cut, the mode row New Add Cut ∩ with Cut chosen, and the status line saying the solid runs into e1](docs/images/109-phone-the-mode-row-cut-chosen-and-the-log-offering-it.png)
![An iPhone: the owner's part, a hole through the top and a boss on the side, the organiser's body row reading e1 with its chain cut to an ellipsis](docs/images/110-phone-the-owners-part-hole-and-boss.png)

Tests: unit 1278 (1219 before); of the 59 new, 49 are in `test/smlib`, `solidprofiles`, `solidsidentity`,
`solidsclient`, `modes`, `bodies` and `stepkernel`. E2E 529 (521
before), with `test/e2e/solids.e2e.ts` and `solidsphone.e2e.ts` adding 8. They
draw the owner's part with a mouse and with a finger under iPhone 13
emulation: a plate, a hole cut through, a boss added on a side, and a
dimension dragged. The kernel's tests skip, and say so, in a checkout with no
kernel build. `npm run test:all` passes. **Found along the way**, each invisible to the unit
tests:
- on a phone, the organiser's body row lost its name (`−e2 +e3 3`), so the
  name now keeps its width and the chain gives way to an ellipsis;
- the hidden view drew none of a kernel body's edges behind its faces, and
  now dims them as it does an extrude's;
- an empty Bodies section pushed Groups out of an iPhone's pane, so it is now
  shown only once there is a body;
- every page load started the kernel's Worker and compiled its 4 MB for an
  empty program. It now starts only when a body has two features.

**Still open:** under the full suite's load, `touch.e2e.ts` loses one tap on
a corner in most full runs of this branch: in 6 runs of 9, "a finger down
on a quiet corner…" 5 times and "a quick tap while the page is busy…" once. It never failed with the file alone, sometimes with one
or three others beside it, and the base branch's one full run here passed. Two things
measured the same as on the base branch on the touch suite's phone page: the
cost of a frame and the cost of a reload. No long task runs after a reload.
With passive event recording the full suite passed, so the cause is not yet
known; TODO.md has the item.

## One circle tool and one arc tool — the gesture chooses the method

The owner:

> *why are there multiple circle tools and arc tools? they all achieve the
> same thing. surely just one tool, but different ways to set constraints.*

Spec: [`docs/plans/one-circle-one-arc.md`](docs/plans/one-circle-one-arc.md),
marked built; every deviation is in its *As built* and in TODO.md's Done
entry. There were four tools: `circle`, `circle3`, `arc` and `arc3`. Now there
is **one Circle and one Arc**, and how you use them decides which constraints
the clicks make. The toolbar has **11 buttons** (Select, the Hand and nine
tools), down from 13.

- **Circle.** A press and drag sets the centre and then the radius. Three
  separate clicks make a circle through all three. A click, then a drag,
  takes that click as the centre. When a rim click lands *along* a line or a
  circle, the new circle is **tangent** to it (`tan`), and no rim point is
  left on the line. Letting go of a drag on a line also makes it tangent;
  letting go on a point makes the circle pass through that point.
- **Arc.** Drag from one end to the other, then click the bulge, for a
  3-point arc. Or click first (that click is the centre), then click the start
  and the end; from the centre, one stroke from start to end also works. If
  you drag from the end of a line or arc and bring the bulge near the arc that
  carries on smoothly, it **snaps** to that arc and is held tangent.
- **The options panel shows what it read** — `centre · radius`, `3 points`,
  `tangent`, `centre · ends` — in amber while you draw, and you can **lock**
  it from the same drop-down. The lock is typed as
  `arm("circle", { method: "3pt" })` and remembered like any option. Each lock
  behaves exactly like the old tool it replaces. `tangent` is new: the circle
  touching three lines or circles, and Onshape's tangent arc.
- **`circle3` and `arc3` still work** as typed names, and so do old scripts.
  `circle3` arms the Circle locked to 3 points, and `tools()` lists both old
  names. Old files open unchanged: the tools only ever wrote ordinary relations.
- **`tan` takes two circles** (or arcs): `tan("c1", "c2")` makes them touch
  from outside or inside, whichever is nearer. The choice is saved in the
  file, and in 3D the two circles are also held in one plane.
- **Nothing was lost.** Before the change, the old build recorded sixteen
  files from the four old tools (test/fixtures/curve-tools-v13.json). Every
  one of those gestures, made with the new tools, writes the same file byte
  for byte, both locked to the old method and with auto reading the gesture.

![The circle tool after two clicks: one on a line, one above it. The dashed preview is the circle through the cursor that touches the line, and the options panel reads "tangent" in amber](docs/images/103-circle-a-rim-click-on-a-line-reads-tangent.png)
![The arc tool dragged from a line's end, with the bulge near the smooth way on: the preview is the quarter arc leaving the line tangent, and the panel reads "tangent"](docs/images/104-arc-from-a-lines-end-snapped-smooth.png)
![An iPhone after two taps with the circle tool: two marks on the canvas and the options panel reading "3 points" in amber](docs/images/105-phone-two-taps-read-3-points.png)

Tests: unit 1219 (1199 before), with `test/onetool.test.ts` adding 19 and `test/tooltips.test.ts` 1. E2E
521 (509 before), with `test/e2e/onetool.e2e.ts` adding 12: a mouse and
iPhone 13 emulation, each gesture checked against a closed form, and the panel
read during each gesture. `npm run test:all` passes. **Found along the way:** with eleven buttons, a
phone's column can run the full height of the screen, and a tooltip too wide
for the room beside it was being clamped back over the column. The tooltip is
now narrowed to that room (`roomBeside`, tooltip.ts). On an iPhone 13 in
landscape the tray now fits in one row, where thirteen buttons took two.

---

## The solid-kernel spike: SMLib, measured — go

The owner:

> *consider using an open source nurbs engine, or the nvidia one so you can
> do real solving. if its possible with what we are trying to achieve then
> use it, otherwise start dev on your own engine*

> *I find it impossible to make anything beyond an extruded shape. fix this
> so I can create complex parts*

Spec: [`docs/plans/solid-kernel-spike.md`](docs/plans/solid-kernel-spike.md),
with its *Findings* appended. **The recommendation is NVIDIA's SMLib**, built
to wasm by us and run in a Worker. Nothing in the app changed; the spike
lives in `spikes/solid-kernel/`, which the app does not import.

- **Built from NVIDIA's source** (usd-brep at
  `3fd5b9548d19aa8c12c29bc9637a96d42a06f8a5`) with Emscripten 4.0.15. The
  build needs neither upstream's build system nor TBB nor OpenUSD, takes
  about 15 minutes on 4 cores, and the recipe is
  `spikes/solid-kernel/smlib/build.sh`.
- **Size**: 4.36 MB raw, **1.16 MB brotli** (`-O2`); `-Oz` is 0.95 MB but
  45 % slower. An OpenCascade build is 5.0 MB brotli. The SMLib build uses
  **no wasm exception handling**; OpenCascade's needs it.
- **Eleven test parts, all exact.** These are the spec's six (a plate with a
  pocket and two holes, two overlapping extrudes unioned, a filleted outline
  with its top edges filleted, a revolve with a cone and a torus face, a boss
  on a face, a cut flush with a face) plus a shell, a chamfer, two boxes
  sharing a face, a face split by a cut, and a tilted profile.
  - Every one is a manifold solid that passes the kernel's own consistency
    checks.
  - Each volume is within 2·10⁻¹⁰ of an independent closed form, and each
    bounding box within 3·10⁻¹³ mm.
- **Identity across rebuilds: yes.** Faces are tagged by *feature, role and
  profile member* right after each sweep. SMLib's attribute propagation
  carries the tags through booleans, fillets and shells. After every
  dimension of every part changed, every face and edge name was found again.
  The exceptions, now documented:
  - a coplanar merge keeps only one of the two faces' names;
  - a shell's offset faces need retagging by the caller.
- **Speed**: rebuilding all eleven parts takes a median of **181 ms** in a
  Chromium Worker and 193 ms in Node. A fresh Worker answers in 184–299 ms.
- **Memory**: one leak was found. Filleting a rounded outline's lid keeps
  about 154 kB per call inside SMLib; no other operation keeps more than
  41 bytes. A fresh Worker starts back at 32 MB, so recycling bounds it.
- **Not run: OpenCascade.** The session's policy refused to execute the
  prebuilt npm package, so OpenCascade's side of the comparison is its sizes
  and its documentation. **Not tested: iOS**, as there was no device.
- Tests: 29 in `spikes/solid-kernel/test/`. Nine check the closed forms
  against shapes of known volume; twenty run against a build and skip,
  saying so, without one. The app's suite is unchanged.

## STEP export: exact solids out to every other CAD tool

The owner:

> *also, please add step export*

Spec: [`docs/plans/step-export.md`](docs/plans/step-export.md), built, every
deviation in its *As built* and in TODO.md's Done entry.

- **`exportStep()`** — the app menu's **Export STEP…** — writes the shown
  solids as `<name>.step`: the share sheet on a phone (Save to Files,
  AirDrop), a download on a desktop, `model/step`. `exportStep("bracket")`
  names it; `exportStep({ curves: true })` adds the sketch curves no solid is
  made of, as wireframe. With no solid it says so and writes nothing; a
  hidden solid is left out and named in the log. It journals nothing, like
  `saveFile()`.
- **Exact B-rep, not a mesh** (`src/solids.ts`): an extrude's caps and line
  walls on planes, its arc and circle walls on cylinders; a revolve's faces
  on planes, cylinders, cones, spheres, tori or — for an arc whose circle
  reaches the axis — a surface of revolution, with end caps for a partial
  turn and a cavity (`BREP_WITH_VOIDS`) for a hole turned a whole turn. Every
  vertex and edge once, every edge used by two faces in opposite senses,
  every face's sense read off its geometry. A circle is two half circles and
  a full revolve two half turns, so no face needs a seam.
- **AP214**, hand-written in `src/step.ts`: one product, millimetres and
  radians with a 1e-7 mm uncertainty, one `MANIFOLD_SOLID_BREP` per feature
  named for it (`e1`, `e2`; an island in a hole is a body of its own, `e1.2`).
  AP214 rather than AP242 because every reader that takes AP242 takes AP214,
  and many that take AP214 take nothing newer; the solid entities are the same.
- **Validated by a real kernel**: OpenCascade 8.0.1 (cadquery-ocp from PyPI,
  in a scratch directory, never a dependency here) read all fourteen test
  parts back — the spec's eight (a box, a plate with a round hole, a
  fillet, a cylinder, a partial revolve, a full revolve with a cone and a
  torus, two bodies, a tilted profile) and six more (a sphere, an arc whose
  circle crosses the axis — the surface of revolution — a cavity, an island,
  a filleted 270° revolve on a tilted plane, the wireframe). Every solid
  valid and closed, its volume within 5e-15 of ZeroCAD's and its
  extent within 1e-7 mm, read twice: as an application reads it, and again
  with OpenCascade's shape healing left out, because the healed read was
  shown to pass files broken on purpose (a face turned over, a solid inside
  out, an edge reversed, a vertex moved 0.01 mm) and the strict read rejects
  every one. The files are committed as fixtures with what read them and
  when (`test/fixtures/step/validated.json`).
- **Tests**: unit 1144 (1134 before; `test/step.test.ts` 10, with a Part 21
  reader of its own checking references, types, loops, edge use, genus and
  vertices on their curves and surfaces); e2e 497 (493 before;
  `test/e2e/step.e2e.ts` 4 — the menu's download, a typed name and curves,
  the iPhone share sheet, and no solid).

**What only the owner can check**: that the share sheet on a real iPhone
takes a `model/step` file for Save to Files and AirDrop (Chromium's own
share refuses `.step` as it refuses `.json`, and a download is what it gets
instead), and that SolidWorks, Fusion or Onshape open the file as OpenCascade
does.

## A circle is just a circle: curves carry their own normal, one origin, no frame made for you

The owner, twice:

> *why when I create something, why does it first create a frame? do I need
> to create a frame? can I not just create a circle or whatever in space?*

> *why everything need frame? why can not just put circle right there?*

Spec: [`docs/plans/frameless-curves.md`](docs/plans/frameless-curves.md),
built, every deviation in its *As built* and in TODO.md's Done entry.

- **A circle or an arc carries its own normal** — three solver variables,
  like its radius, read normalised (`unitDuals` in `relations/refs.ts`) so
  only their direction means anything. No normalisation residual: every
  residual that reads the normal is scale-free, so its length is a gauge the
  damped solve leaves where it was seeded. An arc's sweep is about its own
  normal; `curveplane.ts` answers from the curve and asks no frame. A 2D
  model's curves have the trivial normal and no variables for it.
- **One origin, always there**: `origin`, a fixed built-in frame — the
  kernel's own axes, never solved, never deleted, never journalled, drawn in
  RGB from the start. `origin.x`/`.y`/`.z` work wherever a frame axis does;
  `fix`, `onplane`, `xaxis()` mean it when no frame is named and none is the
  default. A fresh document is still empty: the origin is no entity.
- **Nothing makes a frame unless asked.** The curve tools draw on the plane
  you sketch on, else **the face under the cursor**, else the ground, and
  hold what they draw with an `onplane` on its centre and a `par` on its
  normal — ordinary relations you can see, hover and delete; delete the
  `par` and the circle is free to turn. Extrude and revolve run along a
  profile's own plane (the ground's, a frame's, or three of its corners);
  fillet needs no frame; a revolve makes no end frames (expansion 11).
- **Sketch on face sets the work plane** — `workplane("p1.p2.p3")`, three of
  the face's own points, journalled, a reference to the face and not a new
  entity; it follows the solid when the solid changes. `workplane()` says
  which plane things are drawn on, `workplane(null)` clears it. A plane
  reference is anywhere a plane is taken: a frame, a curve, or three points.
- **Old files open to the same geometry** (format 13): each curve that named
  a frame gets that frame's normal and a `par(curve, "f.z")` at the end of
  the journal, so it still follows the frame; every frame a file made is
  kept. Proved by fixtures written by the format-12 build
  (`test/oldfiles13.test.ts`): every point, radius, normal and sweep the
  same, solved, regenerated and re-saved without moving.
- **Revises** `coordinate-frames.md`'s "there is no world frame" (there is
  now exactly one, fixed) and `extrude-makes-its-plane.md` (no plane is
  made). Both vetoable in the register.
- **What a fresh document looks like**: the origin's triad at the middle,
  unlabelled until hovered (its name would print over the first corner
  drawn there), and the empty-canvas words moved 64 px below it so the two
  do not overlap. The golden picture is re-recorded: 160 pixels, all in the
  origin's triad.
- **Existing e2e suites**: their claims kept, their expectations changed
  where a frame used to be made for them (the typed `plane(…)` lines, frame
  counts, `workplane` for sketch on face, version 13, a revolve's
  "partial"); the setup changed in two places only — `intersection.e2e.ts`
  no longer parks a frame to give its circle a plane, and `undo.e2e.ts`'s
  typed fillet no longer names one.
- Tests: unit 1134 → 1153 (`test/frameless.test.ts`,
  `test/oldfiles13.test.ts`, and the curve-tool and extrude-plane suites
  rewritten), e2e 493 → 498 (`frameless.e2e.ts`). Pictures
  looked at: a fresh document, a circle on the ground, one on a box's lid,
  one on a work plane set by sketch on face.

## Everything fits: a second toolbar row, the organiser shown, and nothing over anything

The owner, asked whether a landscape phone's toolbar should wrap or fold:

> *Second row.... everything has to fit*

and whether the organiser should show from the start on a phone:

> *show from start*

Spec: [`docs/plans/everything-fits.md`](docs/plans/everything-fits.md),
built, every deviation in its *As built* and in TODO.md's Done entry. This
**reverses `tray-fixed-line.md`'s one-line rule** where a line does not fit.

- **The tray wraps** where its line does not fit the room along it — the
  area's, less the logo's corner: a second line, a third if the interface
  size makes even two too long, the buttons in order, line by line, a whole
  button pitch apart (44 px under a finger, so the hit boxes meet across
  lines as along them). Never scrolled, never a tool hidden. A rotation that
  makes a line too long wraps it where it used to turn it, and a pane docked
  beside it keeps lying along it. `layout()` says `row ×2`.
- **Everything fits, enforced.** On every iPhone from the SE (375 × 667) to
  the Pro Max (440 × 956) — seven screen sizes, `test/devices.ts`, every
  number's source in it — both ways up, installed and in Safari, at the
  device's 100 %, the default panes overlap nothing and none enters the
  corner (the logo and the status beside it). A layout the resolver cannot
  find is now an error on the page in development (every e2e test trips it)
  and a warning in a built page, never drawn silently. At larger interface
  sizes it holds to 120 % on every phone and to 160 % on most; the options
  panel is what stops it first.
- **A phone's new defaults.** Portrait: the strip and a one-line log under the
  logo's row, **the organiser beside them**, right of the tray, above the
  drawing's middle. Landscape: the strip, the log and the organiser down the
  right edge, the command line in the top row beyond the corner, and **the
  tray two rows** along the bottom left (one on a Pro Max, which has the
  room).
- **The organiser is shown from the start** everywhere; the app menu still
  hides it.
- **The corner never sits on a pane**: the status, the step note, the open
  group and *Update ready* wrap inside the room the panes leave them, so the
  status no longer lies over the command line's strip in landscape.
- **A held tooltip never covers its neighbours**: it goes beside a column,
  above or below a row — outside the whole tray, every line of it — and
  clear of the finger; the action strip's case included.
- Tests: unit `test/fits.test.ts` (34: wrapping at every interface size, the
  fit rule over every phone and orientation, the limits, the resolver's
  report, the corner's room) and fixes in four suites; e2e
  `test/e2e/fits.e2e.ts` (7: every phone both ways installed and in Safari
  with real insets, an iPhone 13 at 130 %, the landscape tray's two rows on
  an iPhone 13 and an SE, held tooltips covering no neighbour, docking
  through a rotation that wraps the tray). Unit 1134 → 1170, e2e
  493 → 500.
- Pictures looked at: every phone and orientation in the table, installed
  and in Safari, an iPhone 13 at 130 % both ways, held tooltips on an iPhone
  13 and an SE, the docked tray before and after the rotation.
- **Not tried on an iPhone**: Safari's page sizes are Playwright's
  measurements, the SE's estimated.

---

## Tooltips on every control; frames in RGB

The owner, after trying the hosted app:

> *when I hover over tools, I should see a tooltip*

> *a frame should be coloured or something so I can tell the orientation.
> use rgb colours like solidworks.*

Spec: [`docs/plans/tooltips-rgb-frames.md`](docs/plans/tooltips-rgb-frames.md),
built, every deviation in its *As built* and in TODO.md's Done entry.

- **One tooltip** (`src/tooltip.ts`) for every control that is an icon or a
  short word — the toolbar, the action strip, the options panel's ✓ and ✗,
  the spin box, the organiser's ＋, eyes and open markers, every panel's
  strip, the logo. It shows **the name, a line saying what it does, and the
  command it types**, with its key where there is one (`hold Space` for the
  Hand, `⌘Z`/`Ctrl+Z`, `Delete`, `Esc`); a control that would do nothing
  says why. In the hover tag's family, at the interface size, inside the
  safe area. The native titles are gone where it is, so two never show.
- **A mouse** sees it after 400 ms, and at once moving from one control to
  the next; it goes on leave and on any press. **A finger** holds the control
  for the recogniser's 500 ms: the tooltip shows above the finger, clear of
  it, and lifting then does **not** press the control; a tap presses it as
  before. Measured in the e2e: 300–500 ms after the pointer arrives, the next
  button under 100 ms.
- **The words live with the tools**: a `static summary` on each built-in
  ("Draws a rectangle: drag from corner to corner"), read by the tooltip,
  `tools()` (each line now ends `  — <summary>`) and `help()` (a new *tools*
  section). A tool defined at the command line may declare one; it is not
  inherited.
- **Frames in RGB**: x `#ee6040`, y `#60d658`, z `#5b9cff`, each letter in
  its arm's ink. Not the pure primaries — pure blue is 2.3 : 1 on the dark
  ground; these are 5.9–10.4 : 1 — and each keeps its hue in the hidden
  view's dimmed ink. Red and green differ in lightness as well as hue (0.27
  against 0.51) and keep their letters, for red–green colour blindness.
  Hovered, the marker is all amber; selected, violet. **The default frame is
  heavier** (2 px arms, bold letters and name), no longer lighter.
- Tests: 10 unit (`test/tooltips.test.ts`), 10 e2e (`tooltips.e2e.ts`: hover
  timing and text, leave, the next button at once, a press arming as before,
  every control without a title, a phone's hold that does not arm and a tap
  that does, the action strip's, a frame's arm pixels red, green and blue and
  amber when hovered). The golden picture is re-recorded: 346 pixels, all in
  the frame marker. Unit 1124 → 1134, e2e 483 → 493.
- **Not tried on iOS Safari**: whether it sends a click after a long touch
  (swallowed if it does). Pictures looked at: a tooltip on a desktop and on
  an iPhone 13 both ways up at 70 % and 130 %, a frame on the ground, lit,
  over a solid and in the hidden view.

---

## A quick tap on a busy page is still a tap

Two workers reported touch tests that failed only while the machine was
loaded. The cause was real and would reach a phone: the finger recogniser
timed a tap by when the page *handled* the touch, not when it *happened*.
While the page is busy — a heavy solve, a big file opening — a 40 ms tap
was measured as however long the page was busy, and the long-press timer,
running late, could decide "held" before the queued lift was even read.

- **Taps are timed by the events' own timestamps** (`gestures.ts`'s `down`
  and `up` take the event time; `engine.ts`'s `eventTime` checks it is in the
  clock's timebase and falls back to the clock where it is not).
- **A long-press timer that fires late yields once** (`LATE_MS`), so a lift
  waiting in the queue lands first; with none waiting, the long-press follows
  one tick later, as before.
- Proved both ways: a new `touch.e2e.ts` test lands a finger on a page that
  then blocks for 700 ms and lifts it 40 ms later, stamped as a phone's OS
  would — it fails without the fix and passes with it. Four unit tests pin
  the timing rules with a clock that can be blocked. The first version of the
  browser test was wrong and is worth recording: CDP waits for each touch to
  be handled before it returns, so a lift sent after a blocked landing is a
  700 ms press, not a quick tap. The test now sends both touches without
  waiting, with the lift's real timestamp.

---

## The organiser: groups you can see, open, and draw into

The owner:

> *there needs to be a group pane I think, and the ability to e.g. create a
> new group and "open" the group, which means any entities which get created
> become a part of that group.*

and, of the design: *"the group view or whatever organisation method you
decided on. There needs to be a pane for that."*

Spec: [`docs/plans/organiser.md`](docs/plans/organiser.md), built, its
deviations in its *As built* and in TODO.md's Done entry.

- **The organisation method** is the groups that were already built —
  overlapping sets that own nothing and imply nothing, hide and show as
  document state — plus the one thing they lacked, an **open group**. The
  typed objects (regions, chains, solids) are the next design conversation
  and arrive as more sections of the same pane. Vetoable, in the register.
- **The Organiser pane** (`src/organiser.ts`): *Groups* and *Features*, a row
  each — the open marker (● open, ○ not), the name, the member count, an eye.
  A tap on a row types `select("g1")`; the eye `hide("g1")` / `show("g1")`;
  the marker `opengroup("g1")` / `closegroup()`; a right-click or a finger's
  long-press opens the row's menu — *Rename…*, *Add selection*, *Remove
  selection*, *Open* / *Close*, *Ungroup* for a group, *Edit e1* and *Delete*
  for a feature. The **＋** in its strip groups the selection, or with
  nothing selected types `opengroup(group())` — the owner's "create a new
  group and open it". Everything typed through `submit`, so it is in the log
  and is one undo step. A panel like the others: moved, docked, sized by the
  interface size, and in the app menu's Panes with no edit to the menu.
  Bottom right on a desktop. **On a phone it starts hidden** — a tick in
  Panes away — and shown sits under the log at the right edge, either way up.
- **The open group** (`opengroup(g)`, `closegroup()`): every entity made
  while it is open joins it, in the entry that made it — a tool's gesture, a
  typed constructor, a line's own endpoints, a fillet's arc, an extrude's
  twins and walls. Journalled document state, like hide and show: saved,
  reopened at its step on replay, undone. One at a time; Escape leaves it
  open. Shown in the pane, as `● g1` beside the status, and in the hover tag
  of what joined it (`· g1 (open)`).
- **A regeneration's new pieces join the groups that held all the feature
  had made** — so a group holding the whole solid still does after a fillet
  rounds its sketch — and never the open group, which is what is being drawn.
- **A group may be empty**, reversing one line of groups.md: a group made to
  be drawn into starts empty, and a group whose last member is removed or
  deleted stays until `ungroup`. `group()` makes an empty one.
- **`rename(g, name)`**: a group's name, by the model's name rules; it keeps
  its members, its place and its being open. Only a group.
- **Format version 12.** An emptying `removeFrom` means something else now,
  so a version-11 file is translated on the way in: each `removeFrom` that
  emptied a group is followed by the `ungroup` that build did silently, and a
  later entry that reused the name still opens. No file in the repository
  relied on it.
- Tests: `test/organiser.test.ts` (15), `test/groups.test.ts` updated where
  the emptied group used to go, the pinned format version in five suites;
  `test/e2e/organiser.e2e.ts` (10: desktop, iPhone 13 portrait and
  landscape). 1109 unit tests (1094 before), 473 e2e (463 before).

## Select and Hand tools, first on the toolbar; Space is a temporary hand

The owner:

> *there is no hand/selction tool. would be nice since a lot of people are
> used to that*

Spec: [`docs/plans/select-hand.md`](docs/plans/select-hand.md), built, with
every deviation in its *As built*.

- **Select**, an arrow, is the toolbar's first button and is **lit whenever
  no tool is armed** — which is what selecting always was; now it says so.
  Pressing it types `arm("select")`: the armed tool is put down (a feature
  dialog's picks with it) and **the selection is kept**. Escape, `cancel()`
  and the action strip's Cancel light it again too.
- **The Hand**, second, types `arm("hand")`. Armed, **a left-drag or one
  finger pans from wherever it starts** — over a line or a point too, and
  nothing moves; a click or a tap still selects; the wheel and a pinch still
  zoom. It stays armed until another tool is chosen. The cursor is an open
  hand, closed while panning.
- **Holding Space** (on a desktop) is a hand for as long as it is held, over
  whatever is armed: a half-drawn rectangle is still there when it comes up,
  and the rectangle's button is lit again. Not while the command line — or
  any field — has the focus, where Space is a space.
- `tools()` lists both first, `hand` and `select` typed bare arm them,
  `help()` says all of it, and `defineTool` refuses the two names.
- **On a phone in portrait in Safari** (a shorter page than the installed
  app's), the toolbar's column, two buttons longer, would have run down onto
  the command line; there the command line now starts right of the column,
  still along the bottom. The installed app is as before.
- Tests: `test/selecthand.test.ts` (9) and `test/e2e/selecthand.e2e.ts` (8,
  mouse and iPhone 13); the toolbar suites updated for thirteen buttons.
  **Not tried on an iPhone**: worth trying the Hand with one finger over the
  drawing, and that Select lights after a finished point.

## Update ready — tap to reload

The owner asked whether the site updates on the fly. It does — every merged
change is live within a couple of minutes — but the installed app took a
new version only on its next start, and on an iPhone that meant closing it
from the app switcher, sometimes twice.

Now a new version that has downloaded in the background is **offered**:
*Update ready — tap to reload* appears beside the logo. A tap autosaves the
drawing, asks the waiting service worker to take over, and reloads; the
drawing comes back from the autosave. Nothing changes until the tap, so a
version is still never swapped under a hand that is drawing, and an app left
open asks for updates when it comes back to the front and every half hour.

- `src/update.ts` (new): watches the registration, shows the notice, and
  reloads only for a takeover this window asked for.
- `scripts/pwa-sw.js`: one new rule — the message `zerocad:update-now`, and
  nothing else, makes a waiting worker skip its wait.
- Tests: the worker skips its wait for that message only, and never on
  install or activate; end to end, an old build open, a new one deployed, the
  notice shown, the open app still old, the tap reloading into the new build
  with the drawing kept.

---

## No title bar: a logo over the drawing, each device's own interface size, panels to the very edge

The owner tried 0.1.0 on his iPhone and sent two screenshots:

> *rather than say zerocad, it should be a tiny logo in the top left corner,
> that is overlaid over the viewport. Be creative with the logo, but keep it
> simple. There should be no title bar.*
>
> *the interface elements are huge on my screen. there should be a settings
> menu that allows the user to change the zoom level of the interface (ie size
> of tool panes and other elements eg labels and icons which display in the
> viewport. Maybe if you click on the logo, that brings up settings.*
>
> *see in the portrait screenshot, the command bar is not at the bottom. That
> is as far as I can drag it down. Please allow it to be dragged right to the
> bottom.*

and then, the same day:

> *Clicking on the logo should bring up a dropdown menu, and that menu should
> include a zoom level little spin box like  - 80% +, a show hide for the
> panes, and file open etc etc*
>
> *Also, if I push a toolbar right to one side, or up against another
> toolbar, that setting should persist if I change from landscape to portrait
> or vice versa*
>
> *is there any way you can figure out what interface scale to use for each
> device, so everything is appropriately sized? (and make that 100% zoom)*

Spec: [`docs/plans/chrome-logo-scale.md`](docs/plans/chrome-logo-scale.md),
built, with its three amendments and the deviations in its *As built*.

- **No title bar.** The drawing is the whole window, under the status bar and
  the home indicator too, and the chrome floats over it.
- **The logo** (`src/logo.ts`): a zero drawn the way the app draws — an amber
  circle crossed by a construction line with a point at each end, reading as
  "0" and "∅" — with the app's own casing round every stroke so it reads over
  a light solid. Top-left, inside the safe area, 20 px on a desktop and 26 on
  a phone. **The home-screen icons are regenerated from it** (`npm run
  build:icons` now writes `public/icons/icon.svg` from the same markup), so
  the icon and the logo are one mark; a unit test fails if they drift.
- **The status beside it**: `ready`, `SOLVED` and a note fade after a few
  seconds; a conflict or an error stays until the next action replaces it
  (`src/statusline.ts`). Only the picture fades — the text stays for anything
  that reads it. Nothing in the corner takes a press but the logo.
- **The logo opens the app menu** (`src/appmenu.ts`), a dropdown in the
  context menu's family, every control typing its command through `submit`:
  **File** (`Untitled`, then `newFile()`, `openFile()`, `saveFile()`,
  `shareFile()` — the files package's commands; until one exists its item is
  off and says so), **Interface size** (`− 100% +`, 10 % a press, the number
  back to 100 %, typing `ui({ scale: 0.9 })`), **Panes** (a box per panel the
  page has — built from the panels, so a new one is listed with no edit —
  typing `ui({ hide: "log" })`), **View** (`view(...)`), **About** (the build,
  and the source). Escape or a tap outside closes it, and the tap that closes
  it does not also draw.
- **Each device's own 100 %.** The interface size is the device's — form
  factor × the person's text size: 1 under a mouse (the desktop look,
  unchanged), 1.3 on a phone (iOS's 17 pt body text against macOS's 13), 1.15
  on a tablet (a short side of 600 CSS px or more); times Dynamic Type
  (`-apple-system-body` over 17) under a finger in Safari, or the browser's
  default font size over 16 — times the viewer's multiplier, the spin box,
  which is all that is stored (per device, never in a file). On an iPhone 13
  a tool button is drawn **26 px** where 0.1.0 drew 44, a strip 21 where it
  was 44, the tray 34 thick where it was 52.
- **Drawn small, hit at 44.** "Huge" was every control under a finger being
  drawn at its 44 px hit size. They are drawn at the interface size now, and
  under a coarse pointer answer a press over at least 44 px however small they
  are drawn: a tray's buttons are a target apart, each with an invisible hit
  box round its face; a strip is grabbed over 44 reaching outward; rows are a
  target tall; the spin box's − and + are 44 square. How far from a point a
  finger may land and still pick it is unchanged at any size.
- **What the size scales**: the panels and their type, the command line and
  the log, the menus and the hover tag — and in the drawing the constraint
  glyphs (and their hit boxes, which are their drawn boxes), dimension labels,
  point dots and names, frame markers, the snap marker and the lifted mark.
  `ui()` says what is in force, and why 100 % is what it is on this device.
- **Panels to the very edge.** The ~60 pt gap under the command line had two
  causes, both fixed: `#app` was `100dvh`, which an iOS home-screen app with a
  translucent status bar reads as the screen less the status bar (his
  screenshot: the drawing ends 96 pt above the glass on a phone whose insets
  are 62 and 34); and the drawing was inset from the home indicator, so a
  panel could only reach that inset's edge. Now the panels' area is the safe
  area, and **a panel touching an inset edge reaches under it and pads its
  content clear** — iOS's toolbar: the command line docks flush to the glass,
  its line above the home indicator. Likewise at the top and at a landscape
  notch's side. The phone's portrait default has the command line docked to
  the bottom.
- **Docking survives a rotation.** A panel the viewer has put somewhere is
  stored as what each of its sides rests against — the area's edge, another
  panel, or nothing — with its rectangle. Turned, the window lays it out
  again by that: a tray against the right edge stays against the right edge,
  a pane against the toolbar stays against it, a floating one keeps its share
  of the room, and a tray whose line no longer fits along its edge turns,
  keeping the edge. Layouts stored by 0.1.0 are migrated, not dropped.
- **The logo is in the layout as the one panel nothing moves**: a panel pushed
  into the corner stops against it, as at the window's edge.
- **No blur over the top of the installed app.** The owner: *"in PWA mode on
  iPhone, there is some blending at the top of the screen which is annoying.
  Any way to get rid of that?"* Since iOS 26, iOS draws Liquid Glass's
  scroll-edge blur over the top of a home-screen app whose status bar is
  `black-translucent` (reported by several projects; Apple has said
  nothing). The style is `default` now: the app starts below a solid status
  bar in the drawing's own colour. **iOS reads this when the app is added to
  the home screen — remove the ZeroCAD icon and add it again** (Safari →
  Share → Add to Home Screen) to lose the blur.
- `layout()` now also says the window's size and the insets the page
  measured — on a phone, the one place to read what iOS reported.

Tests: unit 1056 → 1094 (the files package's among them; this package's
`test/chrome.test.ts` is 21), e2e 435 → 463 (`test/e2e/chrome.e2e.ts` 16),
and the suites that asserted the header now assert what replaced it.

---

## Files: open, save and share on an iPhone and a desktop, and a drawing that survives the app being closed

The owner, after trying 0.1.0 on his iPhone:

> *think about file system access etc. I want to be able to open files on my
> phone, share files etc. Should also work for desktop.*

Four commands, each what a menu item will type (the app menu is the chrome
package's, landing beside this one): **`newFile()`**, **`openFile()`**,
**`saveFile()`**, **`shareFile()`**. **Ctrl+S / ⌘S** types `saveFile()` and
**Ctrl+O / ⌘O** `openFile()`. A file is `<name>.zerocad.json`; the document
is called after the file it came from, or *Untitled*, and knows whether it
has unsaved changes (read off the drawing itself, so undoing back to the
opened state is saved again). New and Open ask before throwing away unsaved
changes, and each is one undo step.

- **On an iPhone**: *Open* is the Files picker (iCloud Drive, On My iPhone,
  any provider). *Save* is the share sheet — choose **Save to Files**; there
  is no other way for a web app to put a file where you can find it. *Share*
  is the same sheet, for AirDrop, Messages, Mail.
- **On a desktop, in Chrome or Edge**: *Save* asks where once and then saves
  back into that file without asking; a file you opened is saved back into
  too (Chrome asks once for permission to write it). Drop a file on the
  window to open it. Installed as an app, ZeroCAD is offered in the desktop's
  *Open with* for `.json` files.
- **Firefox and desktop Safari**: *Open* is the file picker, *Save* a
  download; Safari's *Share* is its share sheet.
- **Autosave, on by default.** The drawing, its name and whether it is saved
  are kept on the device after every change and when the app is put away,
  and are back when it starts — an iPhone closes a backgrounded app without
  warning, and this is what makes that harmless. `newFile()` replaces it.
  Stored in IndexedDB (the reasons are in `docs/plans/files.md`).

**What an iPhone cannot do**, plainly — these are iOS's rules for web apps,
not something a later version can fix:

- **It cannot save back into a file.** Every save is a new copy through the
  share sheet; Files asks where, and whether to replace one of the same name.
- **It cannot be "Open with" ZeroCAD.** A `.zerocad.json` in Files, Mail or
  Messages does not open in the app from there; open it from inside the app.
- **It cannot receive a share.** ZeroCAD will not appear in another app's
  share sheet.
- **It cannot see your files except the one you pick**, each time.
- **Its stored data is not forever outside the home-screen app**: Safari
  deletes a site's storage after seven days of using Safari without opening
  the site. The home-screen app counts only days it is used. A file saved to
  Files is the copy that lasts.

**Please try on the iPhone** (Chromium's emulation stood in for all of this;
only the phone runs iOS Safari):

1. `openFile()` (the menu's *Open…* once it lands): a `.zerocad.json` in
   iCloud Drive or On My iPhone can be chosen, not greyed out.
2. `saveFile()`: the share sheet appears, *Save to Files* saves **one** file
   called `Untitled.zerocad.json` (not also a note with the title), and it
   opens back with `openFile()`.
3. `shareFile()` by AirDrop to a Mac or by Messages: the other end receives a
   `.zerocad.json`.
4. Draw something, close the app from the app switcher, start it again: the
   drawing is there and the log says *restored*.
5. Is a drawing autosaved in Safari also in the home-screen app, or are the
   two kept apart?
6. `newFile()` with unsaved changes shows a question in the home-screen app.
7. Dismiss the share sheet: the log says *save cancelled* and nothing else.

Corrected in the spec, checked against MDN's compatibility data, Chromium's
source and WebKit's notes: desktop Safari *can* share files; Chromium says
yes to sharing a `.json` file and then refuses it, so a refused share
downloads instead; Chrome on Android has the file pickers too; and nothing
documents what a download does in an iOS home-screen app today. Every
deviation is in the spec's *As built*.

---

## ZeroCAD 0.1.0 — the first version, and a new name

The owner named the project **ZeroCAD** and asked for *"the first version of
the app"* before the next round of design. This is it, at
**https://brothercreamy.github.io/zerocad/**: installable on an iPhone
(Safari → Share → Add to Home Screen), usable by finger, offline once opened,
and the same app on a desktop with a mouse.

What 0.1.0 is, in one breath: points, lines, rectangles, circles and arcs on
coordinate frames, held by relations a least-squares solver satisfies as you
drag; dimensions you can edit; fillets; extrudes and revolves made by picking a
region and confirming; holes added on purpose (`hole`, *Add as hole*,
*Edit e1*) and never by being coplanar; construction geometry; opaque solids
with hidden and wireframe views; groups; undo and redo of everything; a
command line that can define new tools and relations while the app runs; and
files that save and open.

The rename, and what it deliberately leaves alone:

- **Renamed — everything a person sees:** the window title and the header's
  mark, the home-screen name and the manifest, the README and the logs'
  titles, the kernel's description, the package (`zerocad@0.1.0`), and a
  download's default name (`sketch.zerocad.json`).
- **The offline cache is renamed too, and the old one is cleared.** The
  service worker's caches are `zerocad-…` now, and it deletes `neocad-…`
  caches as well, so a phone that installed the app under its old name is
  left with no stale copy.
- **Kept — the internal code name.** Identifiers (`neocadScope`,
  `window.__neocad`, the `neocad-kernel` crate and its `neocad_kernel` files),
  the saved-file format tag `"neocad-model"`, and the browser-storage keys for
  panels, options and the view mode. Renaming the format tag would make every
  saved file unreadable, and renaming the storage keys would lose every saved
  layout; nobody using the app ever sees these names.

---

## A feature's region is explicit: its outline and the holes you said

The owner, on how a later hole joins an extrude without a timeline:

> *there should be some kind of relationship between the loops > region > extrude*

and then:

> *I don't think coplanarity should be used as an automatic basis for deciding
> which entities to include in a region.*

Asked whether click-to-pick should keep proposing the loops it sees inside:
*"do what you think is best"*. It keeps proposing them, and nothing joins
afterwards unless you say so.

Measured first: a circle drawn inside an extruded rectangle was a hole the next
time anything regenerated the extrude — `regen("e1")`, or a fillet on one of
its corners — because `refoundProfile` took every loop inside the outline. Now:

- **The record is the membership.** A feature's `loops` are its outline and
  the loops the user confirmed. **Regeneration re-walks each recorded hole by
  its own members and adds none**; a loop inside the outline that the record
  does not name is left out, in the preview and the solid. A recorded hole
  whose loop has gone is filled, and the log says so (`e1: hole l9–l12 is gone,
  filled`); the outline's going is still a refusal.
- **`hole("e1", "c1")` cuts the loop `c1` is in through `e1`; `unhole("e1",
  "c1")` fills it** (and any island recorded inside it). Operations, one undo
  step each, journalled with what they rebuilt resolved, as `regen` is;
  registered in `replenv.ts` and `persist.ts`. Refusals say what would work:
  `c1 is not inside e1's outline l1–l4 — move it in, or extrude it on its own`,
  `c1 is already a hole of e1`, a member of the outline, in no loop, in a loop
  not parallel to the sketch frame; `unhole` of a loop that is no hole names the
  holes there are. A revolve takes both the same way — a hole turned is a
  tunnel.
- **A hole's loop going fills the hole, and never takes the solid**:
  `del("c1")` on a hole's circle (or a corner of a square hole) used to take
  `e1`'s record — the solid lost its faces; now it is journalled as the
  `unhole` it is, then the deletion. **Making a hole's member construction fills
  it the same way** (the decision this package was left: it is the same as the
  loop going away); an outline member is still refused. **Clearing the flag adds
  no hole** — `hole` does.
- **The menu**: *Add as hole to e1* on a closed loop's member inside a
  feature's outline, *Remove hole from e1* on a hole's, *Edit e1* on anything
  of a feature and on a solid's face — each typing its call.
- **Edit e1** (`edit("e1")`) opens the feature dialog on the feature: its
  region lit as recorded, every other loop inside outlined as available, its
  depth (or angle) in the panel. A click on a loop inside toggles it; ✓ types
  `hole`/`unhole` per toggle and `set` for the value as **one user action**;
  ✗ leaves it as it was. The preview is the edit run on a copy, and the solid
  as it is steps aside while it is up, so a hole being cut shows. The clicks
  are read on the sketch plane, so it works shaded, under the lid.
- **The creating dialog**: a click proposes the region with every loop inside,
  as before; **a click on one of its holes now takes that hole out of the
  proposal** (and back in), and ✓ types the loops outright —
  `extrude("l13", 10, "f", [["l13","l16","l15","l14"]])`. A click on a solid
  island is still a region of its own. Extrude and revolve both.
- **No format bump**: a file never re-finds a profile — its `extrude`, `regen`
  and `fillet` entries carry their loops — so a file saved by the build before
  opens to the solids it was saved with. Proved with one written by that build
  (`test/fixtures/pre-explicit-regions.neocad.json`), whose regen and fillet
  took two circles in as holes that this build would not.

Unit: `test/explicitregions.test.ts` (17, new), `construction.test.ts` (the
regen-brings-the-hole test inverted, quoting the owner; a hole's member made
construction fills it), `sketchface.test.ts` (a face's menu has *Edit e1*);
browser: `test/e2e/explicitregions.e2e.ts` (4, new), `construction.e2e.ts`
(*Add as hole* instead of `regen`). 1018 unit tests (1000 before), 418 e2e (414 before). Spec:
[`docs/plans/explicit-regions.md`](docs/plans/explicit-regions.md), marked
built, with its deviations.

---

## The app under fingers: an iPhone first

The owner, verbatim:

> *it should work on a multi-touch device. Specifically I have an iPhone.
> Think about how best to do that.*

The app was built for a mouse and a keyboard. Right-drag orbits, middle-drag
pans, the wheel zooms, a right-release opens the menu, hover reveals quiet
geometry, shift adds to a selection, and Enter, Escape, Delete and Ctrl+Z are
keys. None of that exists on glass. Now each of them has a finger, after
Onshape and Shapr3D on iPhone:

| Mouse / keyboard | Finger |
|---|---|
| left click | **tap**: lifted within 8 px and 350 ms |
| left drag with a tool armed | **one-finger drag**: the tool's own gesture |
| left drag on geometry | **one-finger drag** on it: moves it |
| left drag on empty canvas (box) | **long-press, then drag** |
| right drag (orbit) | **one-finger drag on empty canvas**, nothing armed (a pan in 2D) |
| middle drag and wheel | **two fingers**: the centroid pans and the spread zooms about it, both at once |
| right-click menu | **long-press** (500 ms, still): the menu at the finger |
| shift-click | **a tap toggles** once something is selected; a tap on empty canvas clears |
| hover | **a finger down** reveals what is under it; lifting ends it, except for what is selected |
| Enter / Escape | the options panel's ✓ / ✗, as before |
| Ctrl+Z / Ctrl+Y / Delete / Escape | **the action strip**: Undo, Redo, Delete, Cancel |

Twist is ignored. A second finger arriving during a one-finger gesture drops it
(a half-drawn rectangle is not built) and becomes the pan and zoom. A third
finger drops everything until the hand is off the glass. A mouse on the same
device is still a mouse: the split is made on each event's `pointerType`.

- **One recogniser** (`src/tools/gestures.ts`): pointer ids, pixels and a
  clock in; tap, drag, long-press, box, pinch and abandon out. It holds a
  touch until it has done something, then the engine feeds the answer down the
  mouse's paths. A tool sees the same `onDown`/`onMove`/`onUp` from a finger as
  from a mouse. Its press is held until the finger moves or lifts, so a pinch
  that starts with one finger never hands a tool a press it has to take back.
- **A finger reaches further.** Every pick and snap radius is multiplied by
  2.75, which makes a point exactly Apple's 44 pt target. One factor for all
  tiers, so a corner still wins over the edge it ends. Glyph boxes are not
  widened: they sit beside their lines and would swallow taps aimed at them.
- **The point you are placing is drawn above your finger.** With a tool armed,
  a dark disc 56 px above the contact carries the snap's own mark and what it
  caught (`p3`, `mid l1`, `on c2`), or a cross where nothing was caught, with a
  dotted leader down to the real place. This is not a loupe. A loupe would have
  to copy two canvases, one of them WebGL with no copy of its last frame. And
  the question under a finger is "where will it land, and on what", not "show
  me more".
- **The action strip**: Undo, Redo, Delete selection, Cancel, a tray like the
  toolbar that is moved and turned the same way. Each button types its line
  (`undo()`, `redo()`, `del("l1")`, `cancel()`) and is disabled when it would
  do nothing. Shown only where the primary pointer is coarse.
- **44 px targets** under `(pointer: coarse)`: tray and strip buttons, every
  panel's strip, the grips, option rows, fields, ✓/✗, and menu items. The
  panels' arithmetic takes the same numbers from one `COARSE` metrics value,
  picked from the same media query. Fields use 16 px type, below which iOS
  zooms into a field it focuses.
- **The keyboard stays away.** On a touch device the command line is not
  focused on start. A finger on the drawing blurs whatever field holds the
  focus (iOS otherwise leaves its keyboard up). A name a tap puts in the line
  does not refocus it. Tapping the line brings the keyboard, as any field does.
- **A phone's defaults.** Portrait: the command line at the top, the tray a
  column down the left, a one-line log under the command line, the strip at
  the bottom right, and the options panel just above the strip. Landscape:
  the tray a row along the bottom, the command line top left, the strip and a
  one-line log top right. Per-viewer layout and pushing are unchanged.
- **Found and fixed on the way:** the browser's compatibility click after a
  long touch is hit-tested where the finger lifts. That is on the menu the
  long-press just opened, so it ran the menu's first item. The engine now
  cancels the canvas's `touchend`, which stops that click and the
  compatibility mouse events; nothing on the canvas listened for them.

**This machine cannot run iOS Safari.** Every test here is Chromium emulating
an iPhone 13 (its viewport, its 3× screen, `isMobile`, `hasTouch`), with real
multi-touch dispatched through CDP. **What to try on the iPhone**, in this order:

1. **Open it and tap a tool** (rectangle). The keyboard must not come up.
   Drag one finger across the drawing. A rectangle should follow, with a small
   disc above your fingertip showing where the corner is. Lift, and it is built.
2. **Undo it with the strip** (bottom right, ↶), then **Redo** (↷).
3. **Two fingers**: spread to zoom and move together to pan. The page itself
   must not zoom or scroll. That part is the PWA package's; if the page zooms,
   say which one did.
4. **One finger on empty canvas** should turn the drawing.
5. **Tap a line**, then another: both are selected. Tap the bin to delete
   them, and tap empty canvas to clear a selection.
6. **Hold a finger still** on a line for half a second. The menu should open
   and stay open when you lift. Does iOS put its own callout or text-selection
   loupe on top? That would be the PWA package's `-webkit-touch-callout`.
7. **Hold, then drag**: a selection box.
8. **Extrude by finger**: draw a rectangle, tap the cube, tap inside the
   rectangle, then tap ✓ (above the strip).
9. **Start a rectangle and put a second finger down** mid-drag. The rectangle
   should vanish and the view zoom instead.
10. **Tap the command line** (top). The keyboard comes up. Type `help()` and
    press return. Tap the drawing, and the keyboard should go away.
11. **Turn the phone.** The layout should rearrange (tray along the bottom).
12. Anything that feels too small, too slow (the long-press is 500 ms, a tap
    350 ms) or too eager (a finger reaches 22 px to a point, 27 to snap):
    those are single numbers, say which.

**Left as they are, deliberately:**

- **Portrait's tray is a column**, not the spec's row: eleven 44 px buttons
  are 556 px, and the phone is 390 wide. It fits down the left.
- **Landscape is cramped** in Safari, which leaves 342 px of height. The
  command line's strip and row take 88 of it. Installed as an app, the
  height is larger.
- **The menu is wider than a phone's room** on either side of most fingers,
  so it is held inside the window and may sit under the finger. The lift no
  longer presses it.
- **A constraint glyph is still its drawn size** (about 18×16 px) under a
  finger, for the reason above.
- **What a tool committed on its press stays committed** when a second finger
  drops the gesture, as with a mouse (a line's second click). Undo takes it
  back.
- **The chrome's sizes are chosen once, at load**, from `(pointer: coarse)`.
  A mouse plugged into an iPad keeps the large targets until a reload, and
  still behaves as a mouse.

Spec: [`docs/plans/touch.md`](docs/plans/touch.md).

![An iPhone in portrait: the command line across the top, a one-line log under it, the tool tray down the left with the rectangle armed, a rectangle being dragged out with a disc above the finger carrying a cross and a dotted leader down to the corner, and Undo, Redo, Delete, Cancel at the bottom right](docs/images/100-touch-portrait-drawing-with-the-lifted-mark.png)
![The same phone with the extrude tool armed: the rectangle's region lit green, the extrude options (depth 10, ✓ and ✗) just above the action strip](docs/images/101-touch-portrait-extrude-by-finger.png)
![The phone in landscape: the command line top left, the action strip and a one-line log top right, the tray a row along the bottom, the extrude options above it at the left](docs/images/102-touch-landscape.png)

## An installable app, and a page that never scrolls or zooms

The owner:

> *please make this available via GitHub hosting, and it should be a PWA,
> non-scrolling/non-zooming, to enable use on a multi-touch device …
> Specifically I have an iPhone.*

**`npm run build:pwa` makes `dist-pwa/`, a folder that is the whole site.** It
holds:

- the single-file app as `index.html`, wrapped in a full document with the
  head a home screen reads. The kernel still rides inside it, so the app needs
  no other request;
- `manifest.webmanifest`: standalone, any orientation, the app's dark ground
  and header colours;
- the icons, rasterised once from one SVG mark (`public/icons/icon.svg`, a
  right triangle and its incircle in the app's inks) by `npm run build:icons`
  and committed;
- a hand-written service worker, and `.nojekyll`.

**Every URL in it is relative**, so it works under any sub-path. It is to be
served from a public repository, `BrotherCreamy/zerocad`, at
**https://brothercreamy.github.io/zerocad/**. `.github/workflows/pages.yml`
builds it on every push to the working branch and replaces the running
repository's `gh-pages` branch with it, pushing with the job's own token.
Nothing has been published yet. Publishing is the manager's step, and so is
turning on Pages (Settings → Pages → Deploy from a branch → `gh-pages`, root).

**It works offline after the first visit.** The worker keeps the page, the
manifest and the icons in a cache named for the build stamp. A new deploy
installs beside the open app and waits, so it never reloads the page while
someone is drawing. The next start gets the new version, and the old cache is
deleted. On an iPhone, "the next start" means after the app is closed from
the app switcher.

**The page itself never moves, in every build**: the dev server and the
single-file artifact too, not only the hosted one.

- The viewport is `user-scalable=no` and covers the notch.
- The page is fixed to the screen, with nothing to scroll and no rubber band.
- The app sits inside the safe areas. The header's text is clear of the status
  bar, and the drawing and every panel are clear of the notch and the home
  indicator. The header's ground runs up under the translucent status bar.
- iOS Safari ignores `user-scalable=no`, so `src/pagelock.ts` also cancels
  WebKit's pinch events and any touchmove with two fingers down.
- The canvas takes every touch itself (`touch-action: none`). The chrome may
  pan but never double-tap zoom.
- A long press raises no callout. Nothing is selectable except the command
  line, the log and the fields.

**Tested in Chromium's iPhone 13 emulation, which is not an iPhone.** The real
device is iOS Safari, and this machine cannot run it. In the emulation:

- the hosted build, served from `/zerocad/`, loads, solves and registers its
  worker, and asks for nothing outside the sub-path;
- with the network off and the server stopped, it still starts, solves and
  draws;
- a new build waits, and is what the next start gets;
- a wheel, a swipe on the chrome, and a pinch on the header or the canvas all
  leave the page at scroll 0 and scale 1.

Each "does not move" check has a control, in which the same touches do scroll
or zoom an ordinary page. With the viewport's limits stripped, as iOS strips
them, the pinch is refused only while the page lock is in. The safe areas are
iOS's own insets, set through CDP, in portrait and landscape.
`NEOCAD_E2E_SHOTS=dir npm run test:e2e` writes `pwa-iphone13-portrait.png` and
`-landscape.png`, plus `-safe` copies with the notch's and home indicator's
bands tinted.

**On the iPhone, try this:**

1. Open the URL in Safari, tap Share, then **Add to Home Screen**.
2. Start it from the icon. It should open with no Safari bars, and the status
   bar should sit over the dark header.
3. Pinch on the header and on the drawing. Neither should zoom the page.
4. Swipe down on the header. Nothing should bounce.
5. Long-press the drawing. No callout should appear.
6. Turn the phone. Nothing should sit under the notch.
7. Turn on Airplane Mode, close the app from the switcher, and start it again.
   It should still work.

**Known:** in landscape, the default panels overlap the tray's edge and the
empty-canvas hint. Layout on a small screen is the touch package's, and so are
the finger gestures. Until that package lands, a finger on the canvas acts as
a left mouse button would, and two fingers do nothing. 981 unit tests (973
before; `test/pwa.test.ts` 8), 407 e2e (398 before; `test/e2e/pwa.e2e.ts` 9).
Spec: [`docs/plans/pwa-pages.md`](docs/plans/pwa-pages.md), with its
deviations under *As built*.

---

## Construction geometry

The owner:

> *construction geometry should be a per entity flag. at least based on the
> name "construction geometry" it implies per entity*

and, after the spec was written:

> *if it is a group based inherited thing, then geometry could be both
> construction geometry and not construction geometry simultaneously*

With no sketch containers, every closed loop on a plane forms regions, so a
reference circle drawn inside an outline became a hole in it. Now a line, arc
or circle can be **construction geometry**: it forms no regions — it bounds,
splits and crosses nothing, so a construction circle inside a rectangle is no
hole and a construction line across it no split — and is otherwise an ordinary
entity: constrained, solved, picked, snapped to, hovered, selected.

- **`construction(...names)` sets it, `construction(...names, false)` clears
  it.** One word with a value, because the flag is one. Journalled, saved,
  one undo step each; no format bump (one new op).
- **The flag is on the entity**, never a group's. `construction("g1")` flags
  each of g1's members *now* and is journalled as the curves it changed
  (`construction("l1", "l2")`), so a line added to g1 later is not
  construction and a line taken out stays it. A feature named flags the curves
  it made. Points, frames and relations among the names are passed over.
- **A solid's profile member is refused**, by name: `"l1" is part of e1's
  profile — a solid's profile cannot stop being a boundary under it`. And
  `extrude` of a construction member says it is construction, rather than "in
  no closed loop". A circle made construction *before* the extrude leaves no
  hole; made real again, `regen("e1")` brings the hole.
- **The look: thin (0.9px) and a muted teal of its own, never dashed** — a
  dash means selection here. On a solid it keeps only a hairline of casing,
  so it stays thin over the light faces. The hover tag says `construction`;
  `ls()` says `(construction)`.
- **Pointer paths**: the right-click menu on a line, arc or circle, or on a
  selection, offers *Construction* / *Not construction*, typing the command.
  The six drawing tools (line, rectangle, circle, 3 point circle, arc, 3 point
  arc) declare a `construction` option, so armed they show a checkbox in the
  options panel — `arm("circle", { construction: true })` — remembered like
  any option.
- A fillet of two construction legs makes a construction arc.

Unit: `test/construction.test.ts` (19, new) and `menu.test.ts`; browser:
`test/e2e/construction.e2e.ts` (7, new), `contextmenu.e2e.ts` and
`tooloptions.e2e.ts` (a drawing tool has an options panel now). 992 unit tests
(973 before), 405 e2e (398 before). Spec:
[`docs/plans/construction.md`](docs/plans/construction.md), marked built, with
its deviations.

---

## An extrude makes no lid frame

The owner's report, the one that started the last package:

> *i'm getting a lot of overlapping points. why is this happening?*

It was still true after that package in the commonest multi-region case:
**two rectangles, the extrude tool, a click in each, Enter.** Both solids share
the first rectangle's sketch frame, three of *its* corners. For the second
solid that frame stands off its profile, so the second lid frame made three
points of its own, the sketch frame's moved by the depth. They landed exactly
on the **first** solid's lid corners, and each was drawn, since a frame's point
ends no line. That was 19 points, three pairs on one spot, and three frames.
**Now it is 16 points, none on another, and one frame: the sketch's.**

The lid frame was made *"so a sketch on the cap has a plane"*, and
sketch-on-face has built that plane from the cap's own points since it
shipped. Two things still read the lid frame: a twin curve's frame and the
depth's pairs. A curve's frame is an orientation, not a place, and an extrude
translates without turning. So:

- **A twin circle or arc of a curve on the sketch frame names the sketch frame
  itself.** It is the same curve lifted, drawn and solved as before. A twin of
  a curve on any other frame keeps that frame, as it always did.
- **The depth holds the corners, the centres and the radii**, and nothing over
  the sketch frame's points. `rels()` on a rectangle says `4 pairs`.
- **The record has no `top`** for a new extrude, and `ls()` no longer ends a
  feature's line with `, lid f2`.
- **Sketching on a cylinder's top works.** A circle's lid has only one point of
  its own, its centre, and its circle's frame is the sketch's, down at the
  base. The sketch tool and *Sketch on this face* used to refuse it. They now
  type a plane through the top's own centre, with two points seeded on the rim
  along the circle frame's axes and held there:
  `plane("p18", pt(75, 4.666666666666664, 20, oncircle(_, "c2")), pt(90, -10.333333333333336, 20, oncircle(_, "c2")))`.
  The points go on the rim because the rim moves with the face: `set` the
  cylinder's depth and the plane rises with the top, still square. The only
  circle still refused is one whose frame has collapsed and gives no
  orientation at all.
- **A second extrude on a lid** is oriented by the sketch frame now, which the
  lid is parallel to.

**A revolve is unchanged.** Its end face is turned, so a curve on it needs a
turned orientation, which only an end frame of its own can give. Its end frames
already stand on the end face's corners.

**Format 11.** No entry changed shape (the call is the same), but the expansion
makes fewer points, so every name after an extrude differs. A version-10 file
opens exactly as it was: `translate` writes `10` into each of its extrudes
(`extrude(…, loops, 10)`; a version-9 file's still get `9`). That makes the lid
frame again under the names the file's later entries hold, regenerates it the
old way, and stays in the entry when the file is saved again. Save, open, save
is byte-identical for old files and new.

`test/nolidframe.test.ts` (7 new) and `test/e2e/nolidframe.e2e.ts` (3 new). The
lid-frame tests now ask for version 10's expansion by name. 973 unit tests,
398 e2e.

![Two boxes extruded together from one sketch, seen from above and in front: one frame marker, the sketch's, at the left box's base corner; no point and no marker on either lid](docs/images/98-two-boxes-extruded-together-one-frame-no-point-on-a-lid.png)
![A cylinder beside a box, with a smaller boss standing on its top: the plane the sketch tool made there has its two rim points, p19 and p20, each with its on-circle glyph](docs/images/99-a-boss-sketched-on-a-cylinders-top.png)

Spec: [`docs/plans/no-lid-frame.md`](docs/plans/no-lid-frame.md).

---

## Quiet geometry: corners and a solid's edges show when the hand is on them

The owner:

> *I think points ought to disappear when they are the endpoint of a line or
> a corner (except when you hover over them), and lines ought to disappear
> when they form the edge of a solid (except when you hover over them).*

A rectangle was four dots and four names on top of four lines; an extruded
box was eight corners labelled and twelve edges inked over the faces. In the
default shaded view that noise is gone:

- **A point that ends a line or an arc — a corner — is not drawn**, dot or
  name, until the cursor is over it, it is selected, it is the armed tool's
  snap target (or under an armed tool's cursor: the fillet tool aims at
  corners and shows no snap marker), or it is being dragged. Circle and arc
  centres, isolated points and frames stay as they were.
- **A solid's own edges** — whole profile members, twins, walls — **are not
  drawn as sketch geometry while the solid has faces on screen.** The face
  layer draws a fine dark line (`SOLID_EDGE`, 1.2 px) along every face's
  edges instead, as part of the solid: by the depth layer as thin quads
  square to the line of sight, depth-tested against faces pushed back by a
  polygon offset; by the painter's fallback as a stroke after each fill. Hover
  an edge and it is drawn lit, with its ends.
- **Glyphs follow their anchors**: a `//` on a profile line, a `▱` on a
  corner, is quiet with what it is on and drawn with it. **Dimensions stay** —
  the depth's `20` is there throughout.
- **Quiet is not hidden.** Nothing of this reaches the pick, the snapper, box
  select or the drag: a quiet corner is hovered, clicked, snapped to and
  dragged as before. A quiet glyph is still picked too — a line picks 5 px
  out and a glyph's box starts 7 px out, so one that could not be hovered
  while quiet could never be reached from its line.
- **`view("hidden")` and `view("wire")` draw everything**, as before.

**Decided by geometric role alone.** The spec also made a feature's own
entities quiet by name; the supervising session dropped that mid-build on the
owner's reasoning — *"why is a 3D corner any different from a 2D corner"*. A
lid's corner is quiet because it ends lines, as a sketch's is. With the lid
frame now standing on the lid's own corner twins (below), a sketched outline's
lid has no other point on a corner; where a sketch frame stands off the
profile the lid frame still makes points of its own, which end nothing and
are drawn, as any isolated point is.

**Selected is drawn, hidden is not.** A selected quiet corner or edge (the
groups package's selection, `select(...)`, a click) is drawn in the
selection's violet; a hidden one stays undrawn however it is revealed —
hidden outranks revealed. Hiding a solid's sketch hides its base lines, and
the face layer's line still outlines the base: it is the solid's, not the
sketch's.

**`ls()` lists a feature's output as a count under its line** —
`    14 made — members("e1") lists them` for a sketched rectangle — rather
than a line per twin, `, 2 hidden` when some are, and the groups package's
`members("e1")` lists exactly what is counted, the depth dimension included.
They are still named entities: a relation on a lid corner holds that point.

**The face layer's edges are the solid's face boundaries, not the entities
that happen to exist**: a cap's outlines, a wall's base and twin sides and its
side at a profile vertex, a sweep's rims and the circles its vertices sweep —
so a revolved block now shows the circles its corners turn through, which no
entity draws, and a hole's wall has no seam line where a whole circle closes.

**The plain-sketch golden picture is unchanged.** It was recorded in the
default view, which is now the one that leaves corners out; it is held in
`view("hidden")` instead — which draws everything, as the build before did —
and still matches to the pixel, and a new test holds the shaded picture to
differ from it only inside the quiet corners' dots, names and the marks
anchored on them (and to differ at every one of them).

Unit: `test/quiet.test.ts` (12, new), `faces.test.ts` (5 more, the edges),
the `ls()` lines in `extrude.test.ts` and `revolve.test.ts`. Browser:
`test/e2e/quiet.e2e.ts` (10, new: the rectangle and its hovered corner, a
drag, a snap, the extruded box and its hovered edge, the `//` mark and the
depth's value, the hidden and wire views, the plate with a hole, the
painter's fallback, a selected corner and edge, the hidden sketch), the
shaded-against-hidden test in `hidden.e2e.ts`, and `opaque.e2e.ts` reading
the edge ink off the faces' picture. Counts after merging groups and the lid
frame fix are in STATUS.
Spec: [`docs/plans/quiet-geometry.md`](docs/plans/quiet-geometry.md).

## Groups, hide and show — and the selection they need

The owner, verbatim:

> *the concept of this project is flat relational direct cad. there is no
> hierarchy. a sketch entity exists in the same logical space as a solid
> entity. and entities can be grouped. think about this grouping, and
> implement also*

Phase 1 of [`docs/plans/groups.md`](docs/plans/groups.md).

**A click selects.** There was no entity selection: a click put a name in
the command line and a box put every name it caught there. Now, with nothing
armed and **the command line empty**, a click on an entity or a constraint
glyph selects it, shift toggles it, a box (window or crossing) selects what
it catches (shift adds), and a click on empty canvas or Escape clears. Region
preselection is the same selection, for regions. **With text in the command
line a click still inserts the name** — the user is writing a call and
pointing at its arguments — so `dist(` then two clicks is what it always was.
The selection is drawn in its own violet (`SELECTION #c46cff`, in
`tools/selection.ts`): not the hover's amber, not an armed tool's green, not
either box's colours; heavier than a plain edge, rimmed on a solid's light
faces by the casing every light mark gets there, and checked by eye on both
the faces and the ground. `sel()` lists it, `select("l1", "g1")` sets it (a
group or feature selects its members, what is hidden is left out and said),
`select()` clears it. **UI state**: never journalled, never in a file, never
an undo step — Ctrl+Z after selecting undoes the last edit.

**The menu and the Delete key act on it.** A right-click on something
selected, or on empty canvas with something selected, offers *Group*,
*Delete* and *Hide* over the whole selection; a right-click on an entity in
a group offers *Select g1* for each (and *Select e1* for the feature that
made it); empty canvas offers *Show all* while anything is hidden. The
Delete key types `del(…)` for the selection. Every one of them is typed
through `submit`, so the log shows it and Ctrl+Z takes it back.

**Groups are sets, never containers.**

```
> group("l1", "l2", "l3", "l4")         g1
> group("g1", "c1", { name: "plate" })  plate   — g1's members now: a union, not a link
> addTo("g1", "l5")    removeFrom("g1", "l5")    ungroup("g1")   (or del("g1"))
> members("plate")     groups("l1")     groups()     ls()
```

A group owns nothing: deleting it deletes the grouping, never a member.
Membership overlaps; a group never holds a group — naming one, or a feature,
adds its current members, flattened then, and the log says so. A feature is a
read-only group: `members("e1")` is what the extrude made, `select("e1")` and
`hide("e1")` work, `addTo("e1", …)` refuses with the reason. Deleting a member
takes it out of every group (journalled as `removeFrom` in the deletion's
expansion), and a group left empty goes too — `del` returns it among the names
it took. The hover tag ends `· g1 g2`.

**Hide and show.** `hide(...names)` and `show(...names)` (groups and features
expand): a hidden entity is not drawn, not picked, not snapped to, not boxed —
and still solved. A hidden feature's faces are not drawn; a constraint's mark
on something hidden is not drawn either, except a feature's own dimension,
which goes with its feature. `show()` shows everything. Visibility is the
document's: journalled, saved, undone.

Six new ops — `group`, `addTo`, `removeFrom`, `ungroup`, `hide`, `show` — in
both `replenv.ts` and `persist.ts`'s replay table, **no format bump**: no
existing op changed, and an older build refuses a newer file's new op by name
at its step (the precedent extrude set). Groups and the hidden set are
rebuilt by replay; a file with groups and hidden things in its history
round-trips byte for byte.

Unit: `test/groups.test.ts` (new), `test/selection.test.ts` (new), and the
engine and feature-dialog tests, whose click is now composing a command or
selecting. Browser: `test/e2e/groups.e2e.ts` and `test/e2e/selection.e2e.ts`
(new); `picking`, `boxselect`, `drag`, `edgedrag`, `frames`, `glyphs`,
`opaque` and `featuredialog` read the selection where they read the command
line, and each keeps a case that writes a command first. 936 unit tests (911
before), 381 e2e (358 before); `npm run test:all` green.

## A feature's frames stand on its own points: no doubled labels on a lid

The owner, on a screenshot of an extruded plate with its point names printed
over each other:

> *i'm getting a lot of overlapping points. why is this happening?*

and, told why and what the fix would be:

> *of course it should.*

**Why it happened.** An extrude's lid frame (the sketch frame moved by the
depth, so a sketch on the cap has a plane) always made three points of its
own. Since a frameless sketch's frame is three of the outline's own corners
(`extrude-makes-its-plane`), those three landed exactly on three lid corner
twins, held there by the depth: measured on the owner's plate with a
triangular hole, **17 points, three pairs on one spot each** (`p8 = p11`,
`p9 = p12`, `p10 = p14`). A partial revolve's end frames did the same.

**The rule now: a frame a feature makes reuses an entity the feature already
makes at the same place.** For each of the sketch frame's three points: if it
is a profile vertex, the lid frame takes that vertex's twin; if not (a frame
floating off the profile, a user's `plane()` elsewhere) it makes its own point
as before. The same for every revolve end frame. The depth (or angle) holds
each place once. The same plate is now **14 points, no two on one spot**, in
the unit test and in the browser (`test/lidframe.test.ts`,
`test/e2e/lidframe.e2e.ts`).

- **The revolution relation** takes an end frame as a frame pair, which is how
  it knows the sketch frame's points are a datum. It now skips a frame point a
  corner pair already holds, instead of adding a second, redundant block: four
  blocks for a rectangle's end face, not seven.
- **Regeneration follows the rule.** A shared lid point is owned once, as a
  twin. If its corner later leaves the profile (a line drawn across, then
  `regen`), the point stays as the lid frame's own, held by its own pair, and
  only the wall goes. If a sketch-frame point comes into the profile, it takes
  the lid point already above it as its twin instead of getting a second one.
- **Deletion:** `del("e1")` takes each shared point once. Deleting a lid
  corner that the lid frame stands on now also takes the lid frame and
  whatever is drawn on it, as deleting any frame's point does.

**Format version 10.** No entry changed shape, but the expansion makes fewer
points in a different order. **Old files open exactly as they were**: every
`extrude`, and every partial `revolve`, from a file of version 9 or below is
given the expansion `9` on the way in (a sixth/seventh argument), which
rebuilds its frames with points of their own, under the names the file's
later entries hold, and regenerates it the old way. The `9` stays in the
entry when the file is saved again. Without it, measured: the owner's plate
saved by a version-9 build, with a `dist` drawn on a later point, fails to
reopen at that step (`"p16" is not a point`). A new file's entry is the call
as it always was.

**Found and left, in `TODO.md`:** the line tool, closing a chain back onto its
first point, makes a point of its own there and joins it with a coin, so a
triangle drawn with it shows two names at one corner of the *sketch* (seen in
the e2e's first screenshot; the lid has one twin there). Also left: a
sketch-frame point on the same spot as a corner but not joined to it still
gets its own lid point, because the rule reads joins, never positions; and a
revolve about the sketch frame's own axis puts its end frame's origin and
y-ref on the sketch frame's, which the feature did not make.

12 new unit tests (923 in all, from 911) and 3 new e2e (361, from 358); `npm run test:all` green.

## A confirmed feature releases its tool, so the solid looks like a solid

Found in the browser after merging opaque solids and pick-preview-confirm:
after Enter built two boxes, the extrude tool stayed armed, and an armed
extrude lights every region it could take next. Every face of the solids it
had just built is such a region, so the finished solids glowed green like the
preview they replaced, which is exactly what the owner had asked against
(*"when you extrude a solid, it should look like a solid"*). A confirm now
releases the tool, as Onshape's ✓ closes its feature dialog; the options
panel goes with it. Escape and ✗ still cancel and keep the tool armed, and a
refused confirm keeps its picks. Five unit and five e2e assertions that
stated the old rule now state this one.

## A solid looks like a solid: opaque, by default

The owner, two messages in a row:

> *when you extrude a solid, it should look like a solid*
> *It should be opaque*

A solid was dark faces, close to the background, under a drawing that put
every edge, point, name and glyph on top of them — the hidden-edge pass
dimmed the edges behind a face, but they, and everything else behind it,
still showed through and could still be clicked. It read as tinted glass.

**Shaded, the default, a solid is opaque.** Whatever is behind a visible
face — an edge or the part of one, a point and its name, a glyph, a
dimension's label and its witness lines, a frame's marker — is not drawn,
and cannot be picked, hovered, snapped to, dragged or caught by a selection
box. What is on the solid's own visible faces and edges, or in front of it,
is drawn and aimed at exactly as before. Turn the view and what was behind
comes round into sight. Faces themselves still never pick.

**One answer for the eye and the hand.** `occlusion.ts` already answered "is
this world point behind a visible face" for the hidden-edge pass;
`inSight(occ, world)` is the same question asked of a point, a glyph's
anchor, a frame's origin, and the place on an edge nearest the cursor. The
draw pass builds the frame's `Occlusion` once and hands the same object to
the tool engine, whose every pick, snap, box and glyph placement asks it —
so nothing that was not drawn can be under the hand, and a pick between two
frames is a pick of what is on screen. "On the surface is not behind" is the
hidden-edge pass's half-pixel square to the plane, so a box's near corners
and edges are drawn and picked and its far ones are not.

**Three view modes**, for when you want to see through:

```
> view("hidden")     the hidden-edge look: behind a face drawn dimmed, and everything pickable
> view("wire")       no faces at all
> view("shaded")     the default: opaque
> view()             says which
```

— and the same three as a **View** row on the empty-canvas right-click menu,
the current one marked, each typing its `view(…)` into the log like every
menu item. The mode is the viewer's, like the camera and the panel layout:
in this browser's `localStorage` (`neocad.viewMode.v1`), never in the
journal, a saved file or the undo history — Ctrl+Z after switching undoes
the last edit, not the switch. `view` was the camera object in the command
scope; it is now the command, and the camera is `camera`.

**It looks like a solid.** The body is a light tone, a mid slate edge-on to a
light grey-blue square-on (`FACE_DARK [72, 86, 102]`, `FACE_LIGHT
[196, 208, 222]`), and the headlight shade now runs the whole of that range
rather than the top three-quarters of it. A solid's own edges — its profile,
the lid's twins, the walls — are drawn in a dark outline ink over the faces
(`SOLID_EDGE #1b2530`), as Onshape draws a part. Sketch geometry keeps its
sketch colours, and every light mark drawn where faces are shown — a line, a
point, a name, a frame's arms and letters — gets a casing in the
background's own colour, drawn for every mark before any mark, so a sketch
on a lid and a name on a wall stay legible and the casing is invisible off
the solid. A plain sketch has no faces and skips the casing pass: it is
still pixel for pixel the build before's picture.

Measured — WCAG contrast, the box seen from a corner (1, −2, 1.5), against the
background `#0a0e13`. *After* is read off the composed screenshot in the e2e
browser (`opaque.e2e.ts`, and it matches what `faces.test.ts` computes from
the constants to the byte); *before* is computed from the old constants:

| | before | after |
|---|---|---|
| lid | 1.96:1 | 6.75:1 |
| front wall | 2.22:1 | 8.87:1 |
| right wall | 1.74:1 | 5.01:1 |
| lid / front, lid / right, front / right | 1.13, 1.13, 1.28 | 1.31, 1.35, 1.77 |
| a face edge-on; square-on | 1.38; 2.62 | 2.58; 12.37 |
| the solid's edge ink on the lid, front, right | — | 5.4, 7.1, 4.0 |
| the sketch's ink `#afc6d9` on the lid, front, right | 5.6, 5.0, 6.3 | 1.6, 1.2, 2.2 — hence the casing |

**The hidden mode's ink** now takes an edge toward the faces' darkest tone
rather than their middle: with the light body the middle sat within a few
levels of a non-default frame's grey, and a hidden frame arm dimmed to itself
(found by the hidden-edge e2e test). Hidden lines over the light body are a
mid-dark slate now, the solid's dark edges lighter, sketch lines darker.

**Cost**, `npm run measure:hidden` on this build and on the build before,
back to back on the same (heavily shared: frames ran 90–120 ms against the
45 ms recorded in October) machine — `render()`'s own share, median of three
runs of 90 frames: stepped block 4.41 → 4.78 ms, boss on a plate 2.39 →
3.25 ms, filleted full turn 14.23 → 14.23 ms. The frame intervals
(110.7 → 99.7, 100.7 → 88.8, 122.8 → 119.5 ms) moved by less than their own
run-to-run spread. The casing pass samples each edge a second time, which is
most of the difference on the small scenes.

**The empty-canvas hint** now also goes while a tool's preview is on screen
in an empty model — it sat under a rectangle being dragged out. Whether a
preview is on screen is asked of the overlay's own canvas calls, not of any
tool's state, so a tool typed at the command line is covered too.

![Before: a 40 × 30 × 20 box seen from the front, the right and above, with a small rectangle sketched on its lid. The faces are a dark slate barely off the background, and every edge, point and name behind the box — the far bottom corner p4, the back edges, a frame under it — is drawn on top: it reads as tinted glass](docs/images/94-before-opaque-a-box-reads-as-glass.png)
![After, shaded (the default): the same view. The faces are a light grey-blue body, the lid, front and right walls each their own tone, the solid's edges a dark outline. Nothing behind it is drawn: no p4, no back edges; the frame under the box shows only where it hangs below the box's outline. The rectangle on the lid and the names on the walls read clearly, each light mark on a thin dark rim](docs/images/95-the-box-opaque-shaded.png)
![After, view("hidden"): the same, with the far corner p4 and the back and far edges drawn in a mid-dark slate through the body — the hidden-edge look, and all of it pickable](docs/images/96-the-same-box-view-hidden.png)
![After, view("wire"): no faces at all; every edge and point in the sketch's own colours](docs/images/97-the-same-box-view-wire.png)

Tests: `test/opaque.test.ts` (new) — occlusion for a point, a label's anchor
and a frame's origin; `hitTest`, `findSnap` (a hidden vertex's projection
included) and `selectInBox` skipping the far corner of a box and keeping a
point on its near face's edge; an edge picking only where its nearest place
is in sight; a frame under the box not picking by its arm; the glyphs; the
modes' rules and their storage. `faces.test.ts` holds the contrast;
`menu.test.ts` the View row; `repl.test.ts` `view()` and `camera`.
`test/e2e/opaque.e2e.ts` (new) — the box from a corner: the far corner's
dot, name and the edge behind not drawn shaded, drawn hidden, faces gone in
wire; a real click where the hidden corner projects not picking it shaded
and picking it hidden; the contrast read off the screenshot; the mode
surviving a reload and absent from the saved file and the undo history; the
menu row; the hint gone during a rectangle drag. The hidden-edge e2e tests
now say `view("hidden")`, which is what they test, and expect the solid's
own edges in its ink; `regen.e2e.ts`'s fillet, which clicks a base corner now
behind the lid, switches to the hidden view first. 884 → 897 unit tests,
340 → 347 e2e, all passing; typecheck clean. Spec, with every deviation:
[`docs/plans/opaque-solids.md`](docs/plans/opaque-solids.md).

## Feature tools pick, preview, and confirm — like every other CAD tool

The owner (2026-11-02):

> *also, extrude and other tools should work like they do in other cad
> software. just click on the region or select the loop and hit the tickbox
> or enter or something*

**Extrude, revolve and fillet no longer build on the click that picks.** Arm
extrude and the options panel now carries **✓ and ✗** under the depth. A
click inside a region **toggles** it into the selection — several may be
picked, each a shade stronger than the faint light on every region a click
could take — and the solids they would make are drawn **as they will be
built**, translucent in the solid look with their new edges in the tools'
green. Type 25 in the depth field and the lids move up as you type. **✓,
Enter, or a second click on the region picked last** builds them all — one
undo step for the whole selection, planes included — and the tool stays
armed with nothing picked, ready for the next. **✗ or Escape** drops the
selection; a second Escape releases the tool. Revolve takes regions, then a
line or a frame's arm as the axis (clicking another replaces it), and
previews the turned solid; fillet takes two lines that share a corner — or a
click on the corner's point, for both — and previews the arc and the trimmed
legs.

**Select the loop, then hit extrude.** With nothing armed, a click inside a
region now selects it (shift-click adds or drops one, a click on empty canvas
clears); arming extrude, revolve or sketch starts from that selection, and
sketch — which has nothing to preview — sketches on a preselected face at
once. A click on an entity still names it in the command line, a drag on
empty canvas still boxes, and the right button still opens the menu.

**What ✓ does is typed**, and the log shows every line:

```
> arm("extrude", {depth: 25})
armed: extrude
> plane("p2", "p1", "p3", { look: false })
f1
> extrude("l1", 25)
e1
> extrude("l5", 25)
e2
e1  extrude of l1,l4,l3,l2, depth d1 = 25 along f1, lid f2
e2  extrude of l5,l8,l7,l6, depth d2 = 25 along f1, lid f3
```

— the shortest call that names each region (`regionNaming`), the same line a
user could have typed, through the command line, so the journal holds what
the typed calls hold. The typed commands themselves are unchanged:
`extrude("l1", 20)` still builds at once. **The preview is that commit, run
on a copy** — the model saved and opened again, the same lines typed into a
command line over the copy, solved — so it is the geometry ✓ builds, not a
picture of it (`src/featurepreview.ts`).

One region cannot be typed: a region bounded by a crossing no point marks
yet, every member of it shared. That one is built by calling the operation, as
the tool always did — the same journal entry, reported as `e1  extrude of …`.

## A shape being drawn is a solid line, not a dashed one

The owner: *"when you drag out a shape, it should not be a dashed line (dashed
means selection)"*. The line, rectangle, circle, arc, circle3 and arc3 previews
were dashed, the same mark as the crossing selection box. They are now solid,
in the same amber. The engine resets the dash state before every tool's
render, so a preview can never inherit a dash from whatever the canvas drew
last. Dashes stay where they mean something other than a shape: the crossing
box (selection), the projected-snap ghost marker, the line tool's faint
inference guide, revolve's lit axis, and dimension witness lines.

## Tool options: declared, visible, remembered

The owner's standing direction (2026-10-29):

> *things should be as easy as every other cad tool makes them, by using
> defaults etc, but then I should be able to customise everything also if I
> want. if the tool has options, there should also be some kind of e.g.
> pop-up menu that allows me to set them visually, or it happens in the
> terminal or whatever.*

**Both, and they are one thing.** Arm extrude — its button, or `extrude`, or
`arm("extrude")` — and a small panel appears beside the tray: the tool's name
on its strip and one row, `depth  [10]`. Type 25 in the field and press Enter
(or click away), and the log shows what the panel did:

```
> arm("extrude", {depth: 25})
armed: extrude
```

— the panel **types** the command through the command line, so it can do
nothing a typed line cannot, and `arm("extrude", { depth: 40 })` typed by hand
shows 40 in the field. Escape in the field puts the value back (and leaves the
tool armed; a second Escape releases it). The next click extrudes 25 deep; the
tool releases, and the panel goes with it. Arm it again and it says 25: **the
last value is the next default**, as Onshape remembers the last extrude
depth — the viewer's, like their panel layout, in `localStorage` under its own
key (`neocad.toolOptions.v1`), never in the journal or a file. A reload keeps
it.

**A tool declares its options**, and everything else is built from the
declaration: `static options = { depth: { default: 10, unit: "length" } }` on
the class (extrude's depth, revolve's angle in radians, fillet's radius).
`arm` fills what was left out (typed, else remembered, else the default) and
refuses, in one line naming what the tool has, what it does not:

```
> arm("extrude", { dpth: 3 })
Error: extrude has no option "dpth" — its options are { depth: 10 }
```

— leaving the armed tool exactly as it was. `tools()` lists each tool's
options as `arm` would use them now (`extrude  { depth: 25 }  (default { depth:
10 })`), and `help()` says how. **A tool defined at the command line with a
`static options` gets all of it** — the checks, the memory, the panel, a
checkbox for a `true`/`false` option — by declaring it; one that declares
nothing gets no panel and is armed as it always was.

The panel is an ordinary panel: dragged by its strip, it pushes and is pushed
like any other, keeps the grab it was taken by, and its place is the viewer's
across a reload (`layout("reset")` puts it back beside the tray). It has no
grips — like the tray, its size is its content's (`optionsSize`).

**And the toolbar's greyed buttons are gone outright.** `toolUnavailable` has
answered "never" since the last package; the wiring that read it in
`panels.ts` (`ToolbarHost.unavailable`, the disabled state, the reason in the
hover text, its CSS) is removed. The rule stays for the context menu and an
undo's re-arm, which still ask it.

884 unit tests (was 866), e2e 340 (was 330). *Deliberately left:* the
remembered value is set when a tool is armed with it, not when a feature is
made; there is no command to forget it (type the default); editing a field
mid-gesture re-arms the tool and so drops the gesture (a fillet's first line,
a revolve's profile); an angle shows in radians (`rad`), a length with no
unit. *Spec:* [`docs/plans/tool-options.md`](docs/plans/tool-options.md).

---

## No refusals: the curve tools make their plane, and a miss is guidance

The owner's standing direction (2026-10-29):

> *make the whole thing more intuitive. i should be able to very simply
> extrude etc, not get a bunch of errors. and same with every other tool.
> things should be as easy as every other cad tool makes them, by using
> defaults etc, but then I should be able to customise everything also if I
> want. […] don't be throwing errors at the user for no reason. keep the user
> on track. it should be effortless to pick up but then insanely powerful*

**Nobody has to know what a frame is to draw a circle.** In a fresh 3D model
the circle, 3-point circle, arc, 3-point arc and fillet buttons used to be
greyed, with "no default frame — frame() then setDefaultFrame(), or say which
frame" as their hover text — the first thing a newcomer met after a
rectangle. Now they work. The circle and arc tools' first click types the
plane it already landed on, and the gesture carries on over it:

```
> plane(pt(3.333, -5.333, 0), null, null, { look: false })
f1
```

— the click as its origin, the refs seeded along the screen's right and up as
a typed `frame()` seeds them, made the default, the view left alone. The
fillet tool makes its corner's plane from the corner's own three points
(`plane("p2", "p3", "p1", { look: false })`), once the corner has passed every
refusal that needs no frame. Typed, `circ()` and `arc()` do the same at the
view centre and say so (`circ: no default frame, so f1 was made at the view
centre, facing you`), and `fillet("l1", "l2", 5)` on the corner's points —
one entry, one undo step. Nothing is greyed on the toolbar or the menu any
more: `toolUnavailable` answers "never", and stays as the one rule both read.
The model's own "no default frame" is still the guard underneath.

**A miss is guidance.** Every refusal a tool makes about a click now says, in
one short line, what would work, leaves the tool armed, and is shown muted —
in the log and in the header beside the verdict — never red, which is kept
for the model's own contradictions:

| | before | after |
|---|---|---|
| extrude, no region | no closed region under the click — click inside a loop (loops() lists them) | click inside a closed outline — the ones I can see are lit |
| revolve, no region | no closed region under the click — click inside a loop (loops() lists them), then on the axis | the same as extrude |
| revolve, no axis | no line or frame axis under the click — click a line, or an arm of a frame's marker, to turn the profile about | now click a line, or a frame's arm, to turn it about |
| revolve, wrong axis | the axis l7 leans 36.87° out of the plane of the profile … | l7 is not in its plane, or crosses it — click a lit one |
| sketch, no face | no face under the click — click inside a closed loop: a solid's face, or a sketch's (loops() lists them) | click inside a closed outline — the ones I can see are lit |
| circle3 / arc3, one line | those three points lie on one line — no circle passes through them | those three are on one line — click the third off it |
| fillet, lines that do not meet | "l1" and "l3" do not meet at a shared point | l1 and l3 do not meet — fillet wants two lines that share a corner |
| fillet, a miss or the wrong kind | (silence) | click a line — fillet wants two lines that share a corner · c1 is a circle — … · now click a line that meets l1 · that is l1 again — click the line it shares a corner with |
| circle / arc tools, no frame | no default frame — frame() then setDefaultFrame(), or say which frame | (no refusal: the plane is made) |

**And it shows where.** While extrude, revolve or sketch is armed, every
closed region it could take is lit faintly in the hover's green — the
outline around its hole, the hole as a region of its own — and the one under
the cursor brightens as before. Once revolve has its profile, every line and
frame arm it could turn about (in its plane, the profile to one side) is lit.

**The first run, as a test.** `test/e2e/firstrun.e2e.ts` is a fresh model and
a mouse, nothing typed: rectangle; circle inside it (the plane line in the
log, no greyed button, no red); extrude clicked outside every region (the
guidance, the regions lit — read off the pixels), then inside (the solid);
fillet on a corner; a right-drag orbit; revolve with a miss, a profile, a miss
for the axis (the axes lit) and a lid edge; sketch on the lid. At the end the
log holds no red line. 868 unit tests (was 852), 330 e2e (was 323).

*Deliberately left:* hidden faces are lit too (no occlusion test); an
abandoned curve gesture keeps the plane it typed (one Ctrl+Z); the frame a
curve tool makes shows its two ref points as ordinary points beside the
circle. *Spec:* [`docs/plans/no-refusals.md`](docs/plans/no-refusals.md).

---

## The tool tray is one line, and the grips draw nothing

The owner:

> *you dont need those diag lines on every corner. also actually get rid of
> resizing altogether on the tool palette. its just a straight line that fits
> the number of tools it has in it, and can either be vert or horiz*

**The grips draw nothing.** The log and the command line keep their four
corner grips, and everything about resizing from them is as it was — the
opposite corner fixed, pushing, stopping flush, the fixed grab. But the
diagonal marks are gone, idle, hovered and held: a grip is an invisible
12 px corner hot-spot (still clipped to the triangle in its corner, so a strip
keeps its middle) whose resize cursor is the whole affordance. The held
grip's own `held` class went with its lit drawing.

**The tray is a line.** It has no grips — `gripCorners(true)` is empty — and
`dragStep` hands a tray's resize grab back with nothing moved, so not even a
scripted grab can resize one. Its size has one source, `traySize(buttons,
orient)`: one button thick, as long as its buttons, a column or a row, turned
by dragging it against an edge as before. `trayFit`, `perLine`, `trayDepth`,
the wrap-refit loop in `dragStep` and the stylesheet's `flex-wrap` are
deleted. Placement moved into a pure `arranged(order, stored, defaults, trays,
area)`, which keeps a tray's stored position and orientation and **ignores its
stored size**: a layout saved while the tray could be shortened and wrapped
comes up as one line where it was, under the same `v2` key (the size is still
written, and never believed). And because the size is always recomputed, **a
tool defined at the command line makes the tray one button longer whether or
not the viewer ever moved it**, pushing whatever it grows into — which
retires the old "a moved tray wraps (or scrolled) a new tool rather than
growing" caveat. A tray too long for the window is clipped at the window's
edge (`overflow: hidden`), still wholly inside; a window that short is not one
anyone draws in, so nothing cleverer is done.

850 unit tests (852 before: the six wrap tests deleted, four new — no grips
and a resize grab refused from every corner; a stored size ignored, position
and way kept, the log's stored size still believed; a moved row growing a
button per tool and pushing the log by exactly that; a tray clipped by a short
window — and the 2 000-step walk now hands the tray resize grabs and asserts
nothing moves, and that the tray is exactly `traySize` on every step). E2e
unchanged in number (four wrap tests out, four in): the log's corners read
pixel for pixel with the hand on each grip, and held, against the same corner
with the grips hidden — and the comparison shown to see a mark by putting one
back; no `.pgrip` under the tray, no resize cursor at its corners, and a press
on its top corner a drag; a stored wrapped size coming up one line; a tool
defined into a moved row lengthening it by one button and pushing the log;
the untouched column's growth now measured as exactly one button; the random
run drags the tray only by its strip and checks it is one line after every
drag.

*Known and deliberate:* the grips are found by the cursor alone — there is no
mark to see before the pointer is there; the grip's triangle still takes the
corner of what it covers (now invisibly); a tray longer than the window is
clipped, its last buttons out of reach until the window is taller; `pushed`
keeps pushing the way a rectangle grows rather than the pointer's sign, though
only the wrapped tray ever made the two differ.

## Extrude on a frameless sketch makes its own plane

The owner, with a screenshot of a rectangle drawn in a fresh model, the
extrude tool armed, and the log saying, once per click, eight times:

> the loop of l1,l4,l3,l2 lies in no frame's plane, and no frame is parallel
> to it — an extrude runs along a sketch frame's +z: make one on its plane
> (plane(…), or Sketch on this) and extrude again

> *how does extrude work? i don't really understand this*

He never got a solid. The refusal was asking him to do by hand something the
app already knows how to do: "Sketch on this face" makes a frame of three of a
loop's own points, +z toward the viewer. **That frame is not the world datum
the "no world frame" rule forbids** — it is the sketch's own plane, an ordinary
journalled `frame(a, b, c)` that follows the sketch — so now the layer above
the operation makes it and carries on.

**The tool types it.** A click inside a region no frame lies in or along types
`plane("p2", "p1", "p3", { look: false })` through the command line — so the
log shows it and the user learns the word — waits for it, then extrudes along
it as an undo step of its own and says what it made. The owner's sequence now
logs:

```
> plane("p2", "p1", "p3", { look: false })
f1
e1  extrude of l1,l4,l3,l2, depth d1 = 10 along f1, lid f2
```

and a solid appears where he was looking: **the view does not turn**
(`plane`'s new `{ look: false }`; plain `plane()` still turns square-on). Two
Ctrl+Z bring the rectangle back exactly as drawn, frameless — the solid, then
the plane. A model that already has a default frame keeps it (the tool types
`frame(a, b, c)` instead); only a model with none gets the new one as its
default. The revolve tool does the same once an axis is clicked, and only after
the axis passes the checks that need no frame, so a refused axis types nothing.

**Typed, the same.** `extrude("l1", 20)` on such a loop makes the frame itself
— journalled `addFrame`, `setDefaultFrame` (if there was none), then the
`extrude` entry naming it, so a replay finds it — with +z toward the viewer in
the app and along the loop's own normal headless. A call that will be refused
(a zero depth, an axis off the plane) is refused before any frame is made.
`operations.ts`'s `extrude` still refuses a frameless loop: that refusal is now
the guard that the layer above did its job.

*Why the tool waits* (measured): a typed line runs asynchronously, and an
extrude made the moment `ctx.run` returned fell inside the typed line's undo
step — one Ctrl+Z took both, and the log put `f1` after the solid. So
`ToolContext.run` now settles once the line has run, and a new
`ToolContext.act` brackets the commit that follows as its own step.
`ToolContext.log` gained a `"done"` outcome, shown as an answer rather than an
error, which both tools now use on every commit.

844 unit tests (12 new in `test/extrudeplane.test.ts`: the typed call's
journal, replay byte-identity, a non-parallel default kept, a parallel frame
used as before, the sign headless and from both sides in a view, refusals
leaving nothing, revolve and its refusal, `plane`'s option, both tools, the
headless guard), 318 e2e (4 new in `test/e2e/extrudeplane.e2e.ts`: the owner's
sequence exactly, the two undos, the typed call and its file round trip, and a
turned view).

*Known and deliberate:* typed, frame and solid are one undo step (one line
typed); by the tool, two. The sketch's +x is whichever edge `sketchFrameFor`
starts at — in the owner's rectangle `f1` points left — which shows only in the
frame's marker, since the view is not turned to it. Headless, with no command
line, the tool still refuses.
*Spec:* [`docs/plans/extrude-makes-its-plane.md`](docs/plans/extrude-makes-its-plane.md).

---

## Panels resize from any corner, and the tray wraps

The owner:

> *allow me to rescale the popup windows from any corner. the tool palette
> should wrap the icons also - i.e. if it is vertical and i decrease vertical
> size, it should create a second column.*

**Every panel has four grips**, one per corner, each the 12 px triangle the
one bottom-right grip was, with the cursor of its diagonal (`nwse-resize`,
`nesw-resize`). Dragging one moves that corner and its two edges; the
opposite corner stays put. Everything true of the one grip is true of all
four, because all four go through the same `dragStep` → `pushed` path:
the panel never leaves the area or drops below its minimum, growing into a
neighbour pushes it, a chain against the window edge stops the resize flush,
the grab stays fixed (now as an offset from the grip's own corner), and the
layout is stored. `resized(start, dx, dy, area, min, corner)` is the pure
function, the south-east still the default. The grips are made by
`panels.ts` rather than written into `index.html`, and each is **clipped to
the triangle in its corner**, so a strip keeps its middle to drag by and a
tray's corner buttons lose only their very tips — which closes the old
"the grip sits over the last button's corner" caveat.

**The tray's buttons wrap.** They flow in the way the tray runs (CSS
flex-wrap): a column made shorter gains a second column, then a third; a row
made narrower, a second row. `trayFit` is the rule, pure and matched to the
CSS to the pixel: **the run is the viewer's, the depth is the buttons'** — the
length along the run is kept as the hand left it, between one button and one
line of them all, and the depth is exactly the lines that wraps into. So no
button is ever out of sight and **the scrollbar is retired** (`overflow:
hidden`). A tray whose lines would not fit — against the window edge, or a
chain that cannot move — keeps the lines that do, and the hand is stopped as
at a minimum; from the opposite corner the new line grows the other way.
`traySize(n, o)` is now "the size a tray wants for n buttons in one line",
used for a turn and the defaults; a turned tray comes up one line, as before.
`apply` fits too, so **a tool defined at the command line takes its place in
the wrap** — another line if the last is full — instead of scrolling into
view, and a window too short for the tray's one line wraps it. Storage is
unchanged: `v2`, rectangle and orientation, the wrap derived.

Two things only a west or north grip exposed, fixed in `pushed`: the way a
panel pushes along an axis is now the way its rectangle grows there, not the
pointer's sign (a tray shortened from its north-west corner, the pointer going
down and right, gains a column out to the *west*, and pushing the pointer's
way would have thrown what it covered across to the east side); and the
pull-back to flush is done on the leading edge with the trailing edge kept
exact, so a panel grown west into a blocked chain stops flush to the bit
rather than 3·10⁻¹⁴ px into its neighbour.

840 unit tests (8 new: `resized` from each corner against the minimum and the
area's edges; each corner pushing a neighbour along each axis, stopping flush
on a chain at the window edge and waiting for the hand; `trayFit`'s wrap, its
caps, its idempotence and its west/north growth; a tray's grip wrapping and
pushing, blocked by a wall, and partway; a wrapped tray turning to one line;
and the 2 000-step random walk now dragging random corners as well as strips,
asserting no overlap, no pixel outside, no panel below its minimum, the tray
always exactly as deep as its lines, and the panel under its grab whenever
nothing stops it), 319 e2e (5 new: the log from each of its four corners, the
opposite corner measured still; a column shortened from its bottom-right into
two columns, by button position, then into one button a column; a row
narrowed from its right into two rows; a wrapped row and a wrapped column
turned, each coming up one line; two tools defined into a wrapped tray, the
second widening it by a column, every button inside and nothing to scroll —
and the random-drag run now takes all four grips and checks the tray whole
after every drag).

*Known and deliberate:* a tray's grip cannot set the depth — dragging a
column's corner sideways moves nothing, the lines decide it; a tray cannot be
made longer than one line of its buttons; a moved one-line tray that gains a
tool wraps that button into a second line rather than growing a button longer
(the layout does not record whether its length was the viewer's or the
defaults', and the spec keeps the stored shape unchanged); a grip's triangle
takes the corner of whatever is under it, the first few pixels of the log's
"log" label included.

## Undo and redo, bulletproof

The owner:

> *why does ctrl+z and ctrl+y not work? should work and be bulletproof*

Measured before anything changed, in headless Chromium: Ctrl+Z and Ctrl+Y
undid and redid the model with the focus on the empty command line, on the
body after a canvas click and after a toolbar click, and Cmd+Z and
Ctrl+Shift+Z did too. **One case failed by design — text left in the command
box.** The undo package's carve-out handed Ctrl+Z to the browser's text undo,
which emptied the box and left the drawing alone, and that reads as "does not
work". Run against the old code, the new matrix below fails 10 of its 15
cells; the text cell fails exactly there, on the drawing not moving.

**Now Ctrl+Z (Cmd+Z) always undoes the drawing and Ctrl+Y and Ctrl+Shift+Z
(Cmd+⇧Z) always redo it, wherever the focus is.** The carve-out is retired:
the drawing undoes and the half-typed text stays in the box, every character
of it, because the browser's text undo is prevented. The listener runs in the
capture phase on `window`, the first place a keydown arrives, and stops the
undo and redo chords there and nothing else, so no input, panel, button or menu
can swallow them. `e.key` is matched case-insensitively, and `e.code` is the
fallback where the layout gives no Latin letter (Cyrillic, Greek) — not
accepted outright, because on QWERTZ the Z key reports `code: "KeyY"` and would
have been undo and redo at once (`src/historykeys.ts`, unit-tested).

An undo now **puts away what is on screen first**: the context menu closes,
and a gesture in progress is cancelled as Escape cancels it — so a line tool's
rubber band goes, and a drag interrupted by Ctrl+Z settles into a step that
the same keystroke takes back. **The tool stays armed**, re-armed fresh with
its options (it used to be disarmed as a side-effect), unless the restored
model cannot run it, in which case the log says why. **Every step answers**:
the log line, and a note beside the status verdict — "undid", "redid",
"nothing to undo" — for 1.6 s, beside it rather than over it so the verdict is
never hidden. **A mouse path:** every context menu ends with Undo and Redo,
which type `undo()` / `redo()` and are disabled with "nothing to undo" /
"nothing to redo". `help()` says under undo that panel layout and the camera
are not steps, which is the other way this reads as broken.

832 unit tests (6 new: the chord matcher's four, the menu's Undo/Redo, the
engine's `armed`), 314 e2e (15 new in `test/e2e/undokeys.e2e.ts`: the empty
input, text in the input, the body, a focused toolbar button, after a panel
drag, with the menu open, the line tool mid-gesture and mid-chain, mid-drag,
Ctrl+Y / Ctrl+Shift+Z / Meta+Z / Meta+Shift+Z / Meta+Y, a dispatched Cyrillic
Ctrl+я, the empty-stack message, both menus' items; the carve-out test in
`undo.e2e.ts` inverted, and six exact-menu assertions elsewhere taught that
every menu now ends Undo, Redo).

*Known and deliberate:* a half-typed command is not protected — it stays in
the box while the drawing undoes, and anything submitted is one ↑ away; the
layout fallback is checked with a dispatched event, since no test machine can
switch keyboard layout; a held Ctrl+Z repeats, one step per repeat.

## The grasp point stays the same

The owner, a day after asking for the slip below:

> *actually the grasp point should stay the same*

**The grab is fixed at the moment the panel is taken.** A panel stopped short
— at the window's edge, against a chain that cannot move, a grip at its
minimum — stays where it stopped while the pointer goes on. It moves again
only when the pointer comes back past the point where it left the panel
behind, and is then exactly under the hand where it was grabbed. Measured in
the browser: the tray pushed down until the chain reached the bottom edge,
then the pointer brought back up — ten pixels, and a pixel short of the whole
lead, and the tray did not move; the whole lead, and the hand was on the
middle of the tray's strip, where it had pressed; ten pixels more, and the
tray came up ten. The grip is held the same way. Pushing is untouched.

The one place the grab changes is a **tray that turns**: it is a new shape, so
the hand keeps the same point of it — the same fraction along the strip, the
same depth into it (`regrasped`). Where the turn puts the tray is unchanged:
against the edge it met. So a column eased onto the bottom edge lies down
along it as a row, away from the hand, and comes back under the hand on the
next move; released before that move, it stays docked there.

Three things the slip had been hiding, each found by measuring:

- **A tray could flip on every move.** A row just under the top edge, held
  high on its strip and eased onto the right edge, turned into a column; under
  the hand that column poked over the top edge and turned into a row; under the
  hand that row was on the right edge again. 225 flips across one 600-move
  drag. A turn is now refused when, brought back under the hand, the new shape
  would turn straight back: the row waits against the right edge and turns
  once, when the hand reaches the corner.
- **A panel could be short of the hand with nothing stopping it**, for one
  event: `pushed` takes the larger axis first, and a panel stopped along it by
  a neighbour it then slid clear of along the other had not tried again. The
  2 000-drag random walk, now asserting the panel is under its grab whenever
  nothing blocks it, found it; `dragStep` asks `pushed` again, up to three
  rounds.
- **The grab was in window coordinates**, the layout in the canvas area's.
  Re-based every move, the header's 32 px cancelled out; held, a turning tray
  carried them along its strip, and the e2e turn against the log's right edge
  was refused. Every unit test passed — the pure half has no header. Eighth on
  ARCHITECTURE's list of bugs only a browser saw.

826 unit tests (3 new: the fraction along the strip, the bottom-edge turn
coming back under the hand, no flip-flop; the slip test inverted and the
random walk extended in place), 299 e2e (the chain test's slip half rewritten
to measure the reverse).

*Known and deliberate:* a panel stopped by a chain and then slid clear of it
catches up the whole lead in one event, and a tray turned against a bottom or
right edge is away from the hand until the next move — both the rule as
asked for, both jumps (TODO, Smaller things).

---

## Panels push one another, and the grab point slips

*Rule 2 of this entry — the slip — was reversed by the owner the next day:
see the entry above.*

The owner, verbatim:

> *shouldn't be able to drag windows over other windows. they should collide
> and push one another around. not collide like physics, just push. also when
> i grab a window at a point on that window, then push it up against
> something, the grab point should kind of slip, so that when i push it back
> in the opposite direction, it doesnt have to get back to the original slip
> point*

![The whole window: the tool tray, turned into a row as it met the log, sits flush on the log's top; the log sits flush on the command line; the command line sits on the window's bottom edge. The pointer, below the window, went on well past where the tray stopped](docs/images/92-the-tray-pushes-the-log-and-the-command-line-to-the-bottom-edge.png)

**Panels never overlap.** A dragged panel that meets another pushes it by
exactly the amount they overlap, and that one pushes what it meets, in a
chain. Nothing springs back, bounces or slides round a corner; a pushed panel
stays where it was pushed and is stored there, as if the viewer had dragged
it. **The window's edge is the one immovable thing**: when the chain is solid
against it, the dragged panel stops flush against the chain — to the pixel,
computed rather than searched for (a chain's overshoot grows one for one with
the mover's travel, so pulling the travel back by it is exact). Resizing by
the grip pushes the same way and stops the same way; a tray that turns into a
neighbour pushes it aside, and does not turn if nothing can make room; a
stored layout, a window too short for the defaults, or a toolbar grown for a
new tool are all put down clear (`settled`, earlier panels holding their
places).

**The grab point slips.** Stopped short of the pointer — at the edge, against
a chain that cannot move, at its minimum size — a panel is held from where it
is: one move back moves it by that move. Measured in the browser: the tray
pushed down until the chain reached the bottom edge, then the pointer moved
10 px up, and the tray moved 10 px up on that very event.

**One resolver** (`pushed` in `src/panels.ts`), pure and unit-tested without a
DOM: each axis of a pointer move in turn, the larger first, a panel pushed
along that axis only. Not everything along the larger axis, as the spec had
it — a drag is never quite straight, and a tray resting on the log dragged
right with a pixel of downward drift would throw the log sideways by the
tray's width; per axis it pushes the log down a pixel. What pushes is the
mover's swept rectangle, not where it lands, because a 2 000-drag random walk
found a fast flick passing straight through a narrow panel.

![After thirty seeded random drags and resizes in the browser: the tray a long row along the top, the log mid-left, the command line, much enlarged, at the bottom — touching nothing, overlapping nothing](docs/images/93-after-thirty-random-drags-no-panel-over-another.png)

Under the dev server the panels check after every placement that no two
overlap and report it as a page error if they do, so the e2e suite's "no
uncaught page errors" covers every gesture it makes. 823 unit tests (12 new,
among them 2 000 random drags that never leave an overlap or a pixel outside),
299 e2e (6 new).

*Known and deliberate:* a window too small to hold every panel side by side
at its size leaves the last one over its neighbour — nothing shrinks a panel
to make room; a pushed tray does not turn (only the one being dragged does);
with no motion the tie goes to x, so a toolbar grown onto the log nudges the
log sideways by the tray's thickness rather than down.

---

## Hidden edges, dimmed: a shaded solid reads as a solid

![Before: the stepped block from the front, the right and above, with a boss on its tall step's front wall; every edge in the same full ink, so the base's back edge, the far uprights and the cut line under the block look as near as the edges in front](docs/images/88-before-hidden-edges-stepped-block-all-in-full-ink.png)
![After: the same view: the base's back edge, the far uprights, the cut line under the block and the part of the boss's foot circle behind the boss are drawn in a dull blue-grey; the edges in front, every point and name and every glyph are as they were](docs/images/89-stepped-block-hidden-edges-dimmed.png)

**The drawing stays on top of the solid, and what a hand aims at is never
behind a face; the part of an edge behind a face is drawn in a dimmed ink** —
a drafting convention's hidden line. Nothing about picking, snapping, dragging
or boxing changed: a dimmed edge picks where it is dimmed (tested). Points,
names, a frame's letters and glyphs are never dimmed; a frame's arms are edges
and are. A hovered edge stays amber, dimmed where hidden. No dashes: at this
stroke width they turn to noise on a curved sweep.

**Which part is hidden is asked of the faces, on the CPU**, by
`src/occlusion.ts` — the e2e oracle that grades the depth layer, lifted out of
the harness, which now imports it: one implementation, tested in Node. A
sample of an edge is hidden when a visible face's screen box and then its
even-odd outlines hold its pixel and the sample is more than half a pixel
behind that face's plane, **measured square to the plane** — along the ray
the quarter-pixel a curve is drawn to is multiplied by 1/cos of the grazing
angle, and a strip seen nearly edge-on would hide its own boundary (tested
about a degree off edge-on). Edges are sampled at least every 4 px; runs are
cut half-way between disagreeing samples, within 2 px of the true crossing
(tested on 40 random lines and views). The ink is the edge's colour 40% of the
way from the faces' mid tone, solid, so it is one colour over any face.

![The boss on a plate from the same side: the far half of the boss's foot circle and the plate's back and left base edges dimmed; the boss's top circle and the plate's near edges in full ink](docs/images/90-boss-on-a-plate-hidden-edges-dimmed.png)
![A filleted profile turned a whole turn: the profile at the back of the sweep is dimmed where the sweep covers it — its outer wall and base — and in full ink along the top and down the bore as far as the hole's near rim](docs/images/91-filleted-turn-profile-dimmed-where-the-sweep-covers-it.png)

**A plain sketch draws pixel for pixel as before**: with no solid nothing is
asked and the old stroke calls run. Held against a picture *the previous
build* drew — recorded in its own commit before the pass existed
(`test/e2e/golden/hidden-plain-sketch.png`). The painter's fallback dims the
same edges: it is the same 2D pass.

**Measured** (`npm run measure:hidden`; headless Chromium, SwiftShader, 1100 ×
768, a shared 4-core machine whose load ran from 5 to 12 while it ran). The
build before and this one were measured alternately, three rounds, each the
median of three fresh apps × 90 frames of an orbit:

| scene | frame, before → after (ms, three rounds) | `render()`, mean before → after |
|---|---|---|
| stepped block + boss, 22 faces | 74.0 → 75.5, 72.0 → 50.0, 39.8 → 37.5 | 1.51 → 2.18 ms |
| boss on a plate, 22 faces | 76.7 → 60.3, 49.4 → 49.5, 33.7 → 34.2 | 1.25 → 1.83 ms |
| filleted full turn, 650 faces | 85.5 → 89.4, 52.7 → 54.2, 36.4 → 49.6 | 4.33 → 7.49 ms |

The frame interval is the GPU process rasterising in software and is mostly
noise here; `render()` is the main thread's share. The pass alone, timed in the
page over the same views (medians of six runs), against the faces' own
main-thread work, derived and drawn:

| scene | faces | the pass | samples × faces → pairs past the box test |
|---|---|---|---|
| stepped block + boss | 0.54 ms | 1.19 ms | 1 226 × 22 → 3 547 |
| boss on a plate | 0.43 ms | 0.90 ms | 838 × 22 → 2 196 |
| filleted full turn | 3.73 ms | 2.26 ms | 238 × 860 → 2 650 |

About twice the faces' cost where there are few faces, and less than it on the
full turn, where faces whose boxes miss an edge's are dropped before its
samples are asked.

To see it: any solid, orbited (right-drag) until some of its edges are behind
it.

**Known and deliberate:** a face seen within about a degree of edge-on hides
only what is more than half a pixel behind its plane, which along the ray can
be far; an edge that is hidden but ends on the silhouette keeps up to 2 px of
full ink at that end (the seam's slack); the golden picture is tied to the
e2e browser, which is pinned, and is re-recorded only on purpose
(`NEOCAD_E2E_GOLDEN_RECORD`). 797 unit tests (nine new), 284 e2e (seven new). Spec:
[`docs/plans/hidden-edges.md`](docs/plans/hidden-edges.md).

## The tool tray: icons, held inside, turning with the edge it meets

The owner, verbatim, on the panels package:

> *I shouldnt be able to slide the tooltrays off the edge. they should stay
> fully within the viewport borders*
> *tools should be icons*
> *when I push a vertical tooltray against a top or bottom edge, it should
> become horizontal etc and vice versa. that includes pushing it up against a
> vertical/horizontal edge of another tooltray*

Three defaults the panels package shipped with a veto, vetoed — all three are
now the other way round.

![The tool tray at its own size, a column one icon wide: a grip of dots at the top, then a dot, a diagonal line, a rectangle, a circle, a circle with three dots on it, an arc, an arc with three dots, a rounded corner, a box, an arrow turning round a small profile, and a pencil on a plane. The line is outlined and drawn in amber, armed; the five circle and arc tools are dim grey, disabled in a model with no default frame; the rest are the usual pale blue](docs/images/85-the-tool-tray-armed-and-greyed.png)

**Tools are icons.** Every built-in tool has a small inline SVG — one family,
1.5-unit round strokes, no fill but a dot — drawn in the button's own colour,
so the armed amber and the disabled grey are the glyph's exactly as they were
the label's. The tool's name is the tooltip, with what the button does after
it — `circle — arm("circle")`, or `circle — no default frame — …` when it
cannot run — and the button still types `arm("circle")` into the log. A tool
defined at the command line has no icon of its own and none is guessed: it gets
a square carrying the first two letters of its name. The glyphs are a table
keyed by the registered name (`src/tools/icons.ts`), not a static on the tool
class, because a static is inherited — a command-line `class extends
CircleTool` under a new name would wear the circle.

**Panels stay wholly inside.** `constrain` used to keep only 40 px of a
panel's strip on screen; now not one pixel of any panel leaves the area, and a
layout stored in a bigger window is pulled in on load.

| | |
|---|---|
| ![The whole window: the tray has become a single row of icons along the top edge of the canvas, its grip of dots at the row's left end, the log and command line at the bottom-left as usual](docs/images/86-the-tray-pushed-to-the-top-is-a-row.png) | ![The tray as a row sitting on the log's top edge, pushed up against it from above, the log and command line below it](docs/images/87-the-tray-pushed-onto-the-log-is-a-row.png) |

**The tray turns with the edge it meets — live, as it is pushed.** Within 6 px
of the area's top or bottom, or of the facing top or bottom edge of a panel it
is beside, it becomes a row, one button high; of a side, a column; of both — a
corner — it keeps the way it runs. It re-sizes to its buttons and keeps the
edge it is against, so a column pushed down onto the log becomes a row sitting
on the log, not one floating where the column's top was. The rule is a pure
function (`orientationFor`, `turned`) with unit tests for every edge, beside
and not, the corner and "nowhere near"; the orientation is stored with the
layout, under a new `v2` key (a `v1` layout reads as the defaults). The log
and the command line keep their shape. The snap distance is 6 px rather than
the spec's "8, say", because the defaults sit 8 px off every edge and dragging
the untouched toolbar along the top must not turn it.

```
> layout()
toolbar  108,532  264x28  row
log      8,562  560x150  (default)
cmd      8,716  560x44  (default)
```

One e2e test turned out to have been passing without testing anything: the
"strip out of reach" drag of the command line pressed on the log, which the
resize test before it had grown over the command line's strip, so nothing
moved and the assertions held at the default position. It now resets first and
asserts the panel moved. 802 unit tests (14 new), 286 e2e (9 new).

*Known and deliberate:* a moved or turned tray keeps its size when a tool is
defined (it scrolls); the resize grip sits over the last button's corner;
a re-registered `circle` keeps the circle glyph, as it keeps the circle's
availability; no positional snapping.

---

## Faces drawn by depth: solids through each other, and a 355° sweep, drawn right

![Before: two bars on a turned view, a 60 × 20 × 20 bar along x and a 15 × 40 bar on a frame turned 20° driven through it; by the painter's sort the second bar's whole slab is painted over the first, uniform, as if it stood in front of all of it](docs/images/83-before-depth-one-solid-painted-over-the-other.png)

**The painter's could not be right here, and it was measured first.** A sort
over whole faces needs an order, and for two solids that pass through each
other — or a sweep that wraps round in front of its own cap — the order does
not exist. `npm run measure:depth` drew 40 seeded random orbits of each scene
both ways, the app's painter's and a depth buffer drawing the same faces, and
counted the pixels that differ by more than 6 levels away from every outline
(headless Chromium 141, software WebGL, 1100 × 768):

| scene | painter's wrong: mean / worst px | views with any |
|---|---|---|
| two interpenetrating extrudes | **4 528 / 14 647** | **39 of 40** |
| 355° revolve with a bore | 20 / 199 | 13 of 40 |
| stepped block + boss on its wall | 0 / 0 | 0 of 40 |
| full turn of a filleted profile | 0 / 0 | 0 of 40 |
| lone box, lone cylinder (convex) | 0 / 0 | 0 of 80 |

The convex solids are the control: where the painter's cannot be wrong the two
pictures agree everywhere but along outlines and the faint seams the painter's
leaves between strip pieces.

![After: the same view by depth: where the turned bar passes through the first, the first bar's faces show in front of it, a darker quadrilateral across the middle, and the slab no longer covers what is nearer](docs/images/84-two-solids-through-each-other-by-depth.png)

**Now faces are drawn by WebGL with a depth test**, on a canvas of their own
under the drawing, through the view's own orthographic projection
(`clipMatrix` in `view.ts`: `worldToScreen` and `depth` in clip coordinates,
unit-tested against both on 200 random views). Which face is in front is
answered per pixel. A cap with holes is filled even-odd by the stencil method —
fans that flip a stencil bit, then the same fans filling where it is odd — so
there is still no triangulator and no new dependency; a wall quad, being
convex, is just a fan, all of them in one draw. Shading is the same flat
headlight to the byte. The nearest-point cap key, the cap-lowering rule and the
355° limit they left are deleted, and the tests that pinned the sort are
picture tests now (`test/e2e/depth.e2e.ts`): an oracle casts each sampled
pixel's ray at the faces' planes, and the depth canvas must hold the nearest
face's fill at every sample clear of an edge.

![Before: close up on the gap of a 355° revolve, by the painter's: across the gap, where the end cap shows, stepped slivers of the sweep's walls are painted over it](docs/images/81-before-depth-355-revolve-walls-over-its-cap.png)
![After: the same gap by depth: the cap across the gap is one clean dark wedge, and the top of the sweep has no seams](docs/images/82-the-355-revolve-by-depth.png)

**It costs nothing in the e2e browser, and saves a lot there.** The app's own
frames, `render()` each animation frame for 90 frames, by depth against the
same app with WebGL taken away: **45.9 against 46.0 ms** for the stepped block,
**51.2 against 252.9 ms** for a filleted full turn of 650 visible faces. With
no GPU the 2D canvas is rasterised in software too, and 650 anti-aliased paths
cost it more than a depth test does.

```js
> __neocad.faces          // in devtools: which way the app is drawing faces
"depth"
```

**The painter's stays, as the fallback** where the browser has no WebGL — the
one place it is chosen — now sorting by centroid: wrong where any sort is, a
grazing lid past its own hole's far wall included, which a test holds it to.
The e2e harness asks Chromium for its software WebGL by name, a test fails if
the app ever falls back, and pixel reads say which picture they mean —
`app.pixels("faces" | "drawing" | "screen", at)`, the last a real screenshot.

**Known and deliberate:** hidden edges still show through the faces — the
drawing-over-the-solid rule, kept; dimming them is its own follow-up. A face
still never picks, snaps, boxes or wears a glyph: the faces canvas takes no
pointer events. 788 unit tests (three new for the projection; two sort tests
became pictures), 277 e2e (seven new). Spec:
[`docs/plans/display-depth.md`](docs/plans/display-depth.md).

## Fillet an extruded corner and the lid is rounded too: features follow their profiles

![Before: a 40 by 30 rectangle on a tilted sketch plane, extruded 20 and turned so the lid faces the viewer, its base seen through it; one base corner has been rounded with the fillet tool — the base shows the arc from p5 round to p15 with its R8 label — but the lid above it is still four-cornered, its right-hand edge running on a slant from p12, over the tangent point, to the far corner p13](docs/images/78-before-regeneration-a-square-lid-over-a-rounded-base.png)

**The bug, measured first.** Extrude a rectangle, then fillet one of its base
corners: the solver reported SOLVED, every relation satisfied, and the lid was
wrong. `fillet` keeps the corner as leg one's tangent point — moving it 8 along
leg one — and re-points leg two at a new tangent point; the lid's corner twin,
held 20 over the corner, went with it, but the lid's copy of leg two still ran
from that twin to the far corner. So the lid was a quadrilateral whose edge
over leg two **leaned 14.9°** (atan 8/30) where the leg is plumb, over a base
with an arc in it; no twin arc, no twin for the new tangent point, no wall
there (`test/regen.test.ts`'s first case keeps that measurement, with the
regeneration a version-8 file's fillet still has: none).

![After: the same rectangle and fillet, the same view: the lid's corner is rounded exactly as the base's, a twin arc from p12 round to p18 about the twin centre p17, a new wall from p15 up to p18, and the curved wall between the two arcs shaded](docs/images/79-the-lid-rounded-as-the-base-is.png)

**Now a feature's expansion follows its profile.** The fillet tool's two
clicks round the base and the lid together, in one journal entry and one undo
step: the twin arc lies on the lid frame about the centre's twin, the new
tangent point gets a twin and a wall, and leg two's copy on the lid is **the
same line, re-pointed** — so a relation on it, or on any twin or wall whose
corner is still there, survives. The depth dimension keeps its name and value
and is rebuilt to hold the new twins, so `set` carries the rounded lid:

![The rounded solid with its depth set to 35: the lid, twin arc and all, 35 over the base, the walls stretched, the label reading 35](docs/images/80-the-rounded-lid-set-to-35.png)

```js
> fillet("l1", "l2", 8)          // l1…l4 extruded 20 off sketch frame t
a1
> journal().at(-1)
{ op: "fillet", args: ["l1", "l2", 8, "t", [["e1", [["l1","a1","l2","l3","l4"]]]]] }
> regen("e1")                    // nothing structural changed: nothing changes
e1
```

Every feature standing on either leg regenerates — two extrudes of one sketch
(up and down) both round; a revolve's end face rounds about the axis; a solid
extruded on the lid follows the lid edge that moved. Where a vertex has really
gone, its twin and wall go by the ordinary cascade, taking what was on them.
**`regen("e1")`** is the explicit door for a profile changed by hand: draw a
line across an extruded plate and `regen` makes it the half its member is in —
the crossings made points, the far corners' twins and walls released, the
surviving edges' twins re-pointed rather than remade. On an untouched feature
it changes nothing and journals once; on a feature whose profile is gone it
refuses, by name, and changes nothing. Not on a solve, a drag or a `set`: those
move geometry, and faces are drawn from live geometry already.

**The file is version 9.** A fillet that regenerated carries what it
regenerated, profiles resolved — `extrude`'s rule, because a replay runs on
seeds where a profile of free lines has no loop to find — and `regen` is a new
op. A version-8 file opens exactly as it was: its fillets regenerated nothing,
and one with a feature on a leg is read as saying so. 787 unit tests (15 new
in `test/regen.test.ts`), 270 e2e (7 new in `test/e2e/regen.e2e.ts`).

## A stepped block from one sketch: split regions extrude and revolve

![A plate on a tilted sketch plane with a line drawn across it, turned off square: the half left of the line is extruded 10 deep and the half right of it 20 deep, so the solid steps up at the line, the riser between the two lids shaded like the walls; the line's ends stick out past the plate above and below, and the two points where it crosses the plate's edges each wear two small "on" marks. Beside it, up and to the right, two crossing circles on the same plane, and the lens between them extruded 15 into a lens-shaped solid with curved walls](docs/images/76-a-stepped-block-and-a-lens-from-one-sketch.png)

Draw a rectangle, draw a line across it, arm `extrude` and click one half —
then the other, with a different depth. Two solids from one sketch, stepping
up at the line, which is how Onshape does it and what the preview has outlined
since the last entry. Two crossing circles do the same: click the lens between
them and it extrudes as a lens.

```js
> ls()   // the feature lines, from the e2e's drawing
e1  extrude of l1[p10→p5],l2,l3[p6→p11],l5[p10→p11], depth d1 = 20 along f1, lid f2
e2  extrude of l1[p4→p10],l5[p10→p11],l3[p11→p7],l4, depth d2 = 10 along f1, lid f3
```

**The crossing becomes a point first.** Nothing holds two lines where they
cross, so before anything is twinned the extrude makes each crossing its
profile runs through a real point held `on` both lines — what
`pt(on(_, "l1"), on(_, "l5"))` would make — and owns it, as it owns its twins:
`p10` and `p11` above are the first extrude's. The second finds them held on
both lines, a T, and makes nothing more. Then a twin per corner, a twin line
(or arc, for part of a circle) per *portion* between the twins of its ends,
and a wall at each corner, as ever; the caps and walls are drawn between the
points as they are now, so moving the line moves the step with it.

Everything an extrude was, it still is: `set("d2.value", 4)` moves that step's
lid and nothing else, one Ctrl+Z takes a step away crossings and all, the
hover tag says `· e1 e2` on a crossing both steps stand on, and `revolve`
takes a split region the same way — the half of a rectangle on one side of a
line turns about that line. Deleting the first step takes the second's record
and its walls on the shared crossings, as deleting an extrude takes one built
on its lid; undo is the confirmation.

**The file is version 8**: a profile member may now be
`{"name":"l1","from":"p1","to":"p10"}`, the part of `l1` between two points,
and the points the extrude made are named in its entry, so a reopened file
makes them again under the same names. A crossing's key (`l1×l5`) is never
written down — it is a place along an edge, and a drag can renumber it.
Version-7 files open exactly as before. 772 unit tests (13 new in
`test/regionfeatures.test.ts`), 263 e2e.

## A line across a rectangle cuts it in two: regions split at crossings and Ts

![A rectangle on a tilted sketch plane, seen square-on, with a vertical line drawn across it that runs past its top and bottom edges to p9 and p8; the extrude tool is armed and the cursor is in the right-hand part, which is filled faint green and outlined in green from where the line crosses the top edge, round the right side, to where it crosses the bottom edge and up the line between them; the left part, and the line's stubs outside the rectangle, stay grey](docs/images/75-the-extrude-preview-stopping-at-a-crossing.png)

Draw a rectangle, draw a line across it, arm `extrude` and hover: the outline
is the half under the cursor and stops at the line. That is Onshape's
behaviour, and it was the loop policy's one deviation from it — until now a
crossing, or a line whose ends the tool had held *on* the edges, split nothing.

```js
> loops()
loop of l1[p1→l1×l5],l5[l1×l5→l3×l5],l3[l3×l5→p4],l4 in f, area 450
loop of l1[l1×l5→p2],l2,l3[p3→l3×l5],l5[l1×l5→l3×l5] in f, area 750
```

**Joined still means held.** A *T* is held — `on`, `oncircle`, or a midpoint
snap's `mid` keeps the end on the edge — so the edge is cut there. A *crossing*
is held by nothing and joins nothing; but which regions a drawing bounds is a
question about where its edges are now, so for finding regions the edges are
cut at a **virtual vertex** named by the lines that make it, `l1×l5` (`c1×c2#1`
and `#2` for two circles, which cross twice). Closed forms throughout: a
rectangle with two lines across it is four regions, two crossing circles are
two crescents and a lens, a bow-tie is its two lobes; a tangent circle, a line
stopping short of an edge and a stray line inside split nothing. A member of a
loop is now a *portion* of its entity — `l3[l3×l5→p4]`, part of `l3` — and a
loop with nothing cut reads exactly as before.

**Extruding one is the next package.** A feature has to *keep* a crossing, so
it will make it a real point held on both lines first; until then `extrude` and
`revolve` refuse a split region by name — *"this region is bounded by part of
l1 (from l1×l5 to p5) — extruding split regions is not built yet"* — rather
than build a solid that is not the region you saw. The preview, `loopAt`,
`loops()` and sketching on a split face all work now.

## A refused constructor leaves nothing behind

`line()`, `circle()`, `arc()` and `frame()` make the points they were not
given — and used to make them *before* checking the name. So
`line(null, null, "a.b")` refused, correctly, and left two points in the
drawing that the journal knew nothing about: they vanished on save/open, and
they had advanced the `p` counter, so the session and its own file handed out
different names from then on. Measured: a refused `addLine` stranded 2 points,
`addFrame` 2 in 2D and 3 in 3D, `addCircle` 1, `addArc` 3; now all four strand
none, and after one refusal of each a session and its reopened file agree on
every entity and on the next auto-name (they differed by 8 points in 2D, 9 in
3D).

Every refusal now runs before the first effect, the same rule `del` batches,
clauses and operations already follow. The name is the last refusal and the
first effect: `claimName` checks and then claims in one call, refusing before
it moves a counter, so one helper (`claimFirst`) claims it and then makes the
points. Successful calls journal byte-for-byte what they did before — pinned
by hand in the tests — and the replay table did not change.

One behaviour changed on purpose: a line explicitly named `p2`, when its own
first endpoint would have been auto-named `p2`, used to be refused as
`"p2" already exists`, about a point the user never made. The name is now held
aside while the points are made, and the endpoints step around it. 53 new unit
tests in `test/stranded.test.ts`, 20 of which fail on the old order.

---

## Sketch on a face: click a wall, draw, extrude — a boss on the side of a plate

![A plate 80 by 50 and 20 deep, turned so its lid, its near wall and a sliver of its right wall face the viewer, shaded slate; standing out of the middle of the near wall toward the viewer is a cylinder, its base circle on the wall and its lid circle nearer, with the shaded strip of its side between them and the depth label 14 beside it; the wall's sketch frame f3 sits at the plate's corner p5 with its +z pointing out of the wall](docs/images/73-a-boss-sketched-on-the-side-of-a-plate.png)

The gesture every stacked feature in Onshape starts with. Arm **`sketch`** and
click inside a face — a solid's lid, a wall turned toward you, a revolve's end
face, or a plain sketch loop — or right-click inside one and choose **Sketch on
this face**. Either types one line:

```js
> plane("p5", "p12", "p4")      // three of the wall's own corners
f3                              // made the default, looked at square-on
```

Draw on it with any tool (the working plane follows the default, so the circle
lands on the wall), extrude it a positive depth, and it stands *out* of the
solid.

**There is no face to pick, and no new entity.** The register had said faces
would need to pick first; they did not. Every planar face of a solid is a
closed loop of real entities — a lid is its twin loop, a wall is the quad of an
edge, two side edges and the twin edge — and `loopAt` already finds the loop
under a pixel. So the face is a region the tool asks about, exactly as the
extrude tool asks about a region; faces stay display only. And a frame on three
of the loop's own points *is* the sketch plane: it journals as the ordinary
`plane(a, b, c)` it is, and follows the solid, because its points are the
solid's — `set` the plate's depth and the wall's frame stays on the wall.

**Out of the solid, for free.** The three points are ordered so
`(b − a) × (c − a)` faces the camera. A face you can click is the first one the
ray meets, and the first surface a ray meets on a solid is one it enters
through — one whose outward normal faces you. So one rule serves solids and
plain loops alike, and a whole-circle lid uses its frame's three points, turned
over (x-ref and y-ref swapped) when the frame faces away.

![The same plate before the sketch, turned the same way, with the sketch tool armed in the toolbar: the near wall under the cursor is outlined in the extrude tool's green and tinted faintly](docs/images/74-the-sketch-tool-outlining-a-wall.png)

**The tool types its command.** "What `plane(a, b, c)` typed would do" includes
turning the camera, which no tool holds — so the tool hands the line to the
command machinery (`ToolContext.run`, the context menu's own seam) and the log,
the recall history, the journal and the single undo step are the typed call's
because it is one. The hover outline is the extrude tool's, now shared by the
three click-inside tools (`tools/region.ts`). ⚠ *Deviations, all in the spec
and the register:* the helper takes the line of sight rather than the view
(`regionAt` reports it); its preferred triple is a corner and its two
neighbours, because the first three vertices swapped put +x along a wall's
diagonal and `lookAt` showed it tipped — **found by looking at the
screenshot**; a circle lying off its own frame's plane is refused; and the
"outside the plate" test measures across the wall's plane, since the boss's lid
frame twins a plate corner. *Left deliberately:* that lid frame's marker floats
off the plate's corner, `depth` from the wall. Tests: 673 → 686 unit,
247 → 254 e2e.

---

## Clauses: an entity defined by any constraint set, in one expression

![The app solved: on the right a circle through three fixed points p1, p2 and p3, each wearing a fix mark and an oncircle mark, its auto-made centre p4 in the middle; on the left two fixed lines crossing, with p9 sitting exactly on the crossing and wearing two on marks; the log at the bottom reads x = pt(on(_, h), on(_, v)) answered p9, then on(_, "l1") echoed back as on(_, "l1"), then a red refusal: pt: on(_, "nope") names "nope", and there is no "nope"](docs/images/72-a-circle-and-a-point-each-defined-by-clauses.png)

The owner, verbatim: *"please think about how to create a syntax that enables
me to create elements with arbitrary constraints. pt(x,y,z) is just one
possible constraint set — to have a function call based around just one
possible constraint set is not efficient."*

**A relation given `_` does not apply — it returns a clause**, and the
constructors `pt`, `ln`, `circ`, `arc` and `frame` take clauses after their own
arguments, filling `_` with the name of what they made:

```js
c = circ(oncircle("p1", _), oncircle("p2", _), oncircle("p3", _))   // a 3-point circle
c = circ(tan("l1", _), oncircle("p3", _), rad(_, 4))                // tangent, through p3, radius 4
p = pt(on(_, "l1"), on(_, "l2"))                                    // the intersection
p = pt(fix(_, [10, 20]))                                            // coordinates: one constraint set among many
p = pt(-9, 1, on(_, "l1"), oncircle(_, "c1"))                       // a seed picks the branch
```

`constrain(name, ...clauses)` is the primitive — a constructor with clauses is
`constrain(pt(), …)` — and returns the relation names it made. Constructors
still return the name, so clauses nest. A clause typed alone prints as the call
(`on(_, "l1")`), never as `{}`.

**It is sugar and nothing else.** A clause applied is the relation called by
name, so it journals as itself with its own `rN`/`dN` and `del`; `model.ts`,
`relations/`, `persist.ts` and the file format are untouched, and a test saves
a clause expression and its expanded lines to the same bytes. **Everything that
can be refused is refused before anything is made** — `_` where a number goes
(`rad("c1", _)`, at the moment the clause is typed), a name that does not exist,
a relation's `rN` where a clause was meant (the `_` forgotten), `_` as a
constructor's own argument. What is left to the relation is the relation's own
refusal (`ln(on(_, "l1"))` — a line is not a point): the line is made by then,
and the message says so — *`ln made l2, but on("l2", "l1") refused: "l2" is not
a point`* — while the whole entry stays one undo step. ⚠ *The spec wrote the
three-point circle `oncircle(_, "p1")`; `oncircle` takes (point, circle), so it
is `oncircle("p1", _)` here.* `_` is required — omitting it is deferred; see the
register. Tests: 652 → 673 unit, 242 → 247 e2e.

---

## The toolbar greys out a tool that cannot run

![A fresh page: the tools panel top-left lists point, line and rectangle in the normal light text — rectangle under the pointer with the hover lift — then circle, circle3, arc, arc3 and fillet in a muted grey, then extrude and revolve light again; the empty-canvas hint is in the middle and the log and command line at the bottom-left](docs/images/71-curve-tools-greyed-until-there-is-a-frame.png)

In a 3D model with no default frame, the context menu already showed circle,
circle3, arc, arc3 and fillet disabled with the model's reason — and the
toolbar armed them anyway, for the first click to be refused in the log. The
newcomer the empty-canvas hint sends to the toolbar was the person most likely
to hit it. **Now the two agree:** the buttons are shown greyed, in the menu's
disabled-item colour, and hovering one shows the same sentence the menu prints
under its item and the command line prints on refusal — *"no default frame —
frame() then setDefaultFrame(), or say which frame"*. A disabled button types
nothing. `setDefaultFrame(frame())` (or the menu's Frame item) enables them on
the next render; deleting that frame greys them again.

The rule is one function, `toolUnavailable` in the new `src/toolavail.ts`,
which the menu imports and the toolbar reaches only through its host — so
`panels.ts` still knows nothing about the model, and a unit test now holds it
to having no imports at all. `arm` is unchanged: typing `arm("circle")` with no
frame still arms it, and the command line still refuses the click in the log.
Tests: 645 → 652 unit, 237 → 242 e2e.

---

## A toolbar, every piece of chrome a movable panel, and an empty canvas that says what to do

![A fresh page: the header reading ready, a narrow "tools" panel top-left listing point, line, rectangle, circle, circle3, arc, arc3, fillet, extrude and revolve, the log and the command line as two panels at the bottom-left, and across the middle of the otherwise empty canvas, in muted grey, "Nothing drawn yet." over "Pick a tool from the toolbar, right-click for the menu, or type help() in the command line."](docs/images/68-a-fresh-page-says-what-to-do.png)

The owner, verbatim: *"add the buttons. but they should be a moveable toolbar.
actually everything should be moveable and resizable."* And, opening the
published build cold, *"i dont see anything in the artifact"* — the page had
loaded and solved perfectly, but since the grid and the origin went, a fresh
model was a black rectangle with nothing to say it was working, let alone what
to do next. Both are answered here.

| | |
|---|---|
| ![The default layout with a drawing on it: a constrained rectangle with a circle inside it and a 100 dimension along its top, a line off to the right with the line tool's dashed amber preview running from its end, a frame marker bottom-right; the toolbar on the left with "line" outlined in amber as the armed tool, and the log at the bottom showing the arm("rectangle"), arm("circle") and arm("line") lines the buttons typed](docs/images/69-toolbar-log-and-command-line-as-panels.png) | ![The same drawing with the chrome rearranged: the toolbar moved to the top-right corner, the log made tall and narrow down the left side with layout() printed at the bottom of it, and the command line moved to the top centre](docs/images/70-the-same-panels-rearranged.png) |

**The toolbar** has one button per registered tool, built from the registry when
it is drawn — so `extrude` and `revolve` are there, and a tool defined at the
command line gets a button too (an untouched toolbar grows to hold it). **A
button types `arm("line")`** through `submit`, the seam the context menu uses: the
log shows the line, the recall history has it, and arming by button journals
exactly what arming by typing journals, which is nothing — an e2e test reads the
journal both ways. The armed tool's button is outlined in amber, the only amber
in the chrome; Escape or a finished gesture lets it go. Labels are the tool
names, the words the command line uses; there are no icons.

**Every piece of chrome is a panel** — the toolbar, the log, the command line —
dragged by its title strip and resized by its corner grip, over a canvas that is
now the whole window under the header. Nothing reflows the drawing any more (the
log used to take height from it as it filled). A panel is held where its strip
stays reachable; the panel last pressed comes to the front. **The header is the
one fixed thing**: it is the title bar, where the solve status lives.

```
> layout()
toolbar  998,8  96x242
log      8,100  330x620
cmd      380,8  440x44
> layout("reset")
layout reset to the defaults
```

**Layout is the viewer's, not the drawing's** — `localStorage`, read and written
through try/catch, never the journal, the file or the undo history. A storage
that throws on every touch (a private window) costs the arrangement and nothing
else; an e2e test makes one. Only panels the viewer has touched are stored, so an
untouched panel follows its default — the log and command line stay on the
bottom edge as the window resizes.

**Gestures never cross.** A drag that starts on a panel's strip, released over
the drawing with a tool armed, places nothing; a rectangle dragged out from the
canvas and released over the log is built. The second needed a fix: the engine
captured the pointer for drags, boxes and pans but not for an armed tool's
gesture, so the log took the release and the rectangle never happened. The host
now captures every canvas press (the test fails with that line removed).
And typing with nothing editable focused — after a canvas click, say — goes to
the command line.

**The empty canvas** says *"Nothing drawn yet."* and names the three ways in, in
the status line's muted colours. It is drawn from the model in the render pass —
no flag — so a fresh page, an undo back to nothing and deleting the last entity
all show it, and the first entity of any kind, a frame included, takes it away.

Two existing e2e tests had layout assumptions the full-window canvas exposed,
fixed rather than worked around: box-select's empty-canvas boxes started where
the toolbar now is, and the free-line tangent test had put a circle's centre on
the very spot `line()` seeds from, passing only because the growing log had
dragged "the middle of the view" off it. The harness's `at()` now refuses a
point a panel covers, with the panel's name, in place of the old
canvas-shrinks-as-the-log-fills check. 645 unit tests (11 new), 237 e2e (19 new).

*Known and deliberate:* positions are stored in pixels from the top-left, so a
moved panel stays put when the window grows; the curve tools are not greyed out
on the toolbar in a model with no default frame (the menu greys them; the
toolbar arms them and the click is refused, loudly, in the log); no icons,
docking or snapping between panels.

---

## Revolve: a profile turned about an axis, and the owner's 3D ask closed

![A tilted sketch with two solids on it, seen at three-quarters: in front, a long rectangular plate extruded 8; behind it, a filleted rectangle revolved 270° about the sketch frame's +y, its open quarter facing the viewer so both flat end faces — the filleted profile on the right and its turned twin on the left — show, with the bore of the ring visible between them and the label 270° beside the axis](docs/images/64-a-plate-and-a-filleted-profile-revolved-270.png)

**3D phase 5** — the last of the roadmap, and with it the owner's original ask,
*"extrude, revolve etc"*, closed: both are built. The solid above was made by the
**revolve tool's two clicks** — inside the filleted profile, then on the arm of
the sketch frame's marker — beside a plate extruded by extrude's one click.

| | |
|---|---|
| ![The revolve tool mid-gesture, square-on: the filleted profile is chosen and tinted green, and a dashed green line runs along the frame's +y axis through the profile's height and past it — the axis the next click will take](docs/images/65-the-revolve-tool-shows-the-axis-before-the-click.png) | ![The same scene after set("d3.value", Math.PI): the end face has swung round to lie in the sketch plane on the far side of the axis, both flat faces now facing the viewer, the half ring behind them, and the label reading 180°](docs/images/66-the-angle-set-to-a-half-turn.png) |
| ![Three revolves on one frame: a block with a round hole turned 180° about a line beside it, the hole a tunnel visible through both end faces; a circle turned 270° about the frame's +y, three quarters of a torus with its two round end faces; and a semicircle turned a whole turn about its own diameter, a sphere labelled 360°](docs/images/67-a-torus-a-sphere-and-a-tunnel.png) | |

```
> revolve("l5", yaxis(), 3 * Math.PI / 2)   // or arm("revolve", { angle }) and click
e2
> ls()
…, e2  revolve of l5,l6,a1,l7,l8, angle d3 = 270° about f1.y, end f3
> set("d3.value", Math.PI)                  // the end face swings; the label says 180°
> revolve("l5", "f1.y")                     // a whole turn: no end face at all
```

**What is real, and what is drawn.** A sweep is not finitely many entities, so
the **surface is drawn from the live profile every frame** — each member swept
round the axis in steps sized from the swept radius, a ring of quads, shaded and
sorted as an extrude's walls are — and stored nowhere. What is real is what can
be: the **profile**, untouched; the **axis**, a frame-axis reference or a line,
read as a datum and never pushed (a twin pulled away goes back; the axis does not
move by a bit); **one `revolution` dimension** carrying the angle, in radians with
degrees on its label — `ang`'s seam; and, for a **partial** turn, the **end face**:
a twin of every profile corner, member and frame, held at its base turned about the
axis by closed-form rotation residuals, three linear components per point. So
`set` swings the end face, and the end face is ordinary geometry: hold a twin
corner 26 from the profile's inner corner and the profile's free width gives way to
`10·cos θ + √(26² − 100·sin² θ)`, and again when the angle is set — a unit test.

**A whole turn makes no end face,** so it has no twins and its dimension holds
nothing. **Turning a full revolve partial is a new feature, not a new value:** a
`set` on its angle refuses and says so (and a partial one `set` to a whole turn
refuses too). The geometry is refused when it is not a solid of revolution — an
axis leaning out of the profile's plane or lying beside it, a profile or a rim
bulging across the axis — and **touching the axis is allowed**: a semicircle on its
diameter is a sphere, a triangle on a leg a cone, a rectangle about its own edge a
cylinder. Holes come along as tunnels. The journal carries the resolved profile
(extrude's measured rule) and the axis; the geometric refusals are the call's,
never a replay's.

**A sort the extrude rule could not have needed.** A sweep past about 300° wraps
round *in front of its own start cap*, and the nearest-point key extrude's caps sort
by painted the cap over those walls — found by a check of 192 views per shape
(374 bad samples at 321°), then on the canvas, where the colours differ by five
levels and the picture alone did not show it. A cap now goes before any overlapping
wall of its own in front of its plane — the exact rule for a planar face — and
extrude's order is unchanged. Clean at every view tried up to 344°.

634 unit tests (from 600), 218 end-to-end (from 210). The e2e draws the plate and
the filleted profile with the real tools on a tilted sketch, revolves it 270° by the
tool's two clicks (a click on nothing refused aloud, the dashed axis on the canvas
before the click), checks every end-face twin against a rotation computed in the
test, sets the angle to 180° live, undoes the whole feature in one Ctrl+Z, reads a
start-cap pixel at the cap's own shade, and round-trips the file byte for byte.

**Known and deliberate:** the sort is still a sort — interpenetrating solids can
draw wrong where they cross, and a sweep within a few degrees of a whole turn, seen
nearly along its axis, can leave a wall over its start cap where no single key fits
both; hidden edges show through faces, as on an extrude; the swept surface never
picks (its profile and end face do); deleting a piece of a full revolve leaves its
360° label holding nothing until it too is deleted.

---

## Extrude, half 2: shaded faces, and a click inside a region

![A filleted block with a round hole through it, an island standing in the hole and a small boss on its lid, seen from above at three-quarters: the lid is the lightest face, the side walls darker, the hole shows its curved inner wall shading round and the background through its far end, and the sketch's edges, points and the labels 35, R8 and 10 are drawn crisply over the faces](docs/images/61-a-shaded-solid-with-a-hole-an-island-and-a-boss.png)

**3D phase 4, half 2** — what the solid looks like, and the gesture that makes
one. The extrude above was made by **one click inside the profile**; its depth
was then `set` to 35 from the command line; the boss is a circle sketched *on
the lid*, on the lid's own frame, and extruded 10 by another click.

| | |
|---|---|
| ![The extrude tool armed over a tilted sketch: the profile under the cursor — a filleted rectangle with a hole and an island — is outlined in green and faintly tinted, the ring between the hole and the island left clear](docs/images/60-the-extrude-tool-outlines-the-region.png) | ![The same solid looked at straight down the lid: the lid is one flat slate face, the ring of the hole is black right through, and the island in the hole is filled — even-odd](docs/images/62-even-odd-seen-down-the-lid.png) |
| ![Close up on the hole and the boss: the hole's far wall shades from light to dark round the curve in thin bands, the island's own cylinder recedes into the hole, and the boss stands off the lid with its side shaded round](docs/images/63-curved-walls-shade-round.png) | |

**`arm("extrude", { depth: 20 })`, then click inside a region.** The region under
the cursor is outlined as it moves — the loop and every loop inside it, filled
faintly even-odd so the holes stay clear — exactly the profile a click would
take (`loopAt`: the innermost loop, then the nearest). A click on nothing says
so in the log and the tool stays armed. This is the app's first click-inside
behaviour and it lives in the tool only: with nothing armed, a click inside a
region still picks nothing and a press there still starts a box. The tool asks
the engine for no snap (`Tool.snaps`), since a vertex marker would promise a
click it does not keep.

**Faces are read off the live geometry every frame** (`src/faces.ts`): two caps,
each one even-odd path of every profile loop — so a hole is empty and an island
in a hole is solid with no triangulation — and a wall per member, a quad for a
line and a strip of quads for an arc or circle at the resolution the curve is
drawn at. Each face's outward normal is *worked out*, from the loop's winding and
how deep it is nested, so a profile drawn clockwise faces out just the same.

**Painter's per face, back faces culled, lit from the eye.** Faces sort far to
near and the ones facing away are not drawn; each is shaded by Lambert's cosine
with the light along the line of sight — a headlight, because there is no world
to hang a light in. A wall sorts by its centroid; a **cap by its nearest point**:
nothing of a prism is in front of its visible cap's plane, and by its centroid a
cap seen at a grazing angle sorted behind its own hole's far wall, which then
painted over the cap wherever it showed past the opening (seen in a screenshot;
pinned by a test that fails under the centroid key). The surface tones are the
app's panel slates, dim enough that edges, points and labels — **drawn after the
faces, hidden ones included** — stay the foreground.

**Faces never pick, snap, box or wear a glyph.** The pieces of a solid do, as
before; a face is display.

600 unit tests (from 584), 210 end-to-end (from 207). The e2e makes the solid
with the tool's click, reads the canvas's own pixels looking straight down the
lid (the cap's square-on colour, nothing at all in the hole's ring, the island
filled), sketches and extrudes the boss on the lid, checks that every cap is
drawn after its own walls in a turned view, and round-trips the file with both
solids in it.

**Known and deliberate:** hidden edges show through faces (the spec's order —
faces first, entities on top); per-face painter's is still a sort, so two
separate solids interpenetrating can draw wrong where they cross; a face is not
a target, so extruding a face of a solid means clicking inside the loop of its
edges, and a wall's loop has no frame to extrude along until one is made on it.

---

## Extrude, the model half: a loop becomes a lid, held by one depth

![A filleted rectangle with a hole and an island in it, drawn on a tilted sketch and extruded 20 along the sketch's +z, seen obliquely as a wireframe: the lid is a second copy of the outline, arc and both circles, five wall lines join the corners, the lid frame f2 sits 20 above the sketch frame f1, and a dimension label 20 with dashed witness lines stands beside the first wall](docs/images/59-extrude-the-lid-and-its-walls.png)

**3D phase 4, half 1** — the expansion, the feature record, deletion and the
file. The shading and the click-inside tool are the second half; until then a
solid draws as the wireframe it is made of.

```
> extrude("l1", 20)
e1
> ls()
…, e1  extrude of l1,a1,l2,l3,l4 + 2 inside, depth d2 = 20 along f1, lid f2
> set("d2.value", 35)          // the lid moves; nothing else does
> del("e1")                    // the solid goes; the sketch stays
```

**An extrude is real geometry, not a mesh.** `extrude(member, depth?)` finds
the closed loop the member is in (`findLoops`) and expands it: a **twin** of
every corner on the lid, a twin of every line, arc and circle between them, a
**wall** line at every corner, a **lid frame** (the sketch frame moved by the
depth, so a sketch on the cap has a plane), and **one dimension** — an
`extrusion`, `d`-named — holding every twin at its base plus the depth along the
sketch frame's +z. Three linear residuals per pair, never a square; one more per
curve for its radius. So `set("d2.value", 35)` moves the lid like any other
dimension, and the twins and walls are ordinary entities: draggable,
constrainable, dimensionable.

**The solver negotiates.** Hold a lid corner 50 from the opposite corner of the
base, of a rectangle whose height is 30 and width free, and its width settles at
√(50² − 30² − 20²) = 34.641; `set` the depth to 30 and the width gives way to
√(50² − 30² − 30²) = 26.458. That is the one-model decision paying out — the
lid is geometry the sketch can be constrained against — and it is a unit test.

**Holes come with the loop.** Every loop inside the one extruded is part of
the profile and gets twins too — a hole, and an island inside the hole. A circle
has no corners, so a tube is two rims, two centres and the depth: its walls are
display-only, for the second half to draw.

**A feature is a record** — `e1` — holding which pieces are one solid: the
profile it was built on, everything it made, the lid frame and the depth. It
lists in `ls()`, and hovering any piece of it ends the tag with `· e1`.
**`del("e1")` removes everything it made and never the sketch** (Onshape's
rule). **Deleting any piece of it** — a profile edge, a wall, a lid corner, the
depth — **takes the record and nothing more**: the record is to its pieces what
a relation is to its arguments, so the pieces left behind stay what they always
were, ordinary geometry. Undo is the confirmation.

**Which loop.** A member in several loops is refused with the loops listed —
and after an extrude every profile edge is also the edge of a wall, so it always
is. `extrude("l9", 10, "f2")` narrows to the loop parallel to that frame (the
lid's own, here); the click-inside tool (half 2) skips the question. A loop
whose plane no frame orients is refused rather than given a frame nobody chose.

**Journalled as the call, with its profile resolved** —
`extrude("l1", 20, "f1", [["l1","a1","l2","l3","l4"],["c1"],["c2"]])` — the way
`fix` and `fillet` journal the frame they resolved, and for a reason measured
rather than supposed: replay runs on *seeds*, and a rectangle of four free `ln()`s
coin'd and fixed into place has one loop solved and **none** at its seeds. A
re-found profile would fail that file at its extrude, and every undo after it.
Given the profile, a replay walks it by its joins (relations, never positions).

**No format bump.** Two new ops (`extrude`, `deleteFeature`) and the meaning of
none changed; an older build refuses a newer file at the step, by op name, as it
did when the deletion ops arrived. Version stays 7.

584 unit tests (from 563), 207 end-to-end (from 199): the e2e draws the profile
with the real tools on a tilted sketch, extrudes it from the command line, sets
the depth, undoes the set and then the whole feature one Ctrl+Z each, reopens
the file byte for byte, and deletes the solid back to the sketch.

**Known and deliberate:** a feature is expanded once — restructuring its profile
afterwards (filleting a base corner) does not regenerate the lid. `fillet`
holds its new tangent point and centre on the rim's plane, not on the sketch, so
a rounded corner has a free direction along +z that a `set` can stir by a few
millionths; a tool-drawn sketch is undimensioned, and a solve may wander in its
freedom by 1e-5. The lid frame always has its own three points, even where the
profile shares a point with its sketch frame.

---

## Closed loops: what regions a drawing has, and which one a click is in

**3D phase 3.** Phase 4's extrude takes an *auto-detected* profile — the
owner's decision — so before anything extrudes, the drawing has to answer two
questions exactly. `src/loops.ts` answers both, and nothing in the app asks the
second one yet: **a click inside a region still picks nothing** (box select and
the menu depend on empty-canvas presses), and a loop is drawn nowhere.

**`loops()`** lists them, one line each:

```
> loops()
[loop of l1,a1,l2,l3,l4 in f1, area 1186.265,
 loop of c1 in f1, area 254.469, inside l1,a1,l2,l3,l4]
```

A loop is a *question*, not an entity: asking journals nothing, claims no name
and makes no undo step, so a loop is spoken of by its members. Members are
listed counter-clockwise about the plane's normal (a frame's +z where a frame
lies in that plane), from the earliest-made one.

**Joined means held, never near** — the package's honesty line. Two curve ends
are joined when they are the same point, or a `coin` holds them together
(directly or through a chain). Two ends that merely sit on the same spot are
*not* joined — nothing holds them there — and neither a **crossing** nor a
**T** (an end held *on* an edge by `on`) splits anything. A drawing made with
the tools joins by coincidence inference, so this reads the relation registry.

**Minimal cycles, with containment reported.** A figure-eight is two loops; two
rectangles sharing an edge are two, the edge in both and the six-edge outline in
neither; a whole circle is a loop; an outline with an island is two, and the
island's `parent` is the outline — phase 4 decides what a hole means. Every
line end, arc centre and arc end must lie in one plane (a millionth, `liesOn`'s
rule), and every arc's *frame* must agree with it; a box's twelve edges are its
six faces and the belt round its middle is nothing.

**`loopAt(model, view, sx, sy)`** casts the pixel's ray into each loop's plane
and tests the hit by winding number, arcs exact. The innermost loop wins (an
island beats the outline round it — containment, not depth, since coplanar
loops tie on depth exactly), then the nearest plane, then the smaller area; a
loop less than a pixel thick on screen is edge-on and offers no inside.

**Known and deliberate:** a component whose joined edges *cross* reports no
loops — with nothing joining them where they cross, its faces are not the
regions the drawing shows (a self-crossing outline is no profile anyway); Onshape
would split the regions at the crossing, which needs a join this model was never
told about. A T does not split an edge for the same reason. `loops()` is silent
about near-misses (an end not quite joined, a corner not quite in plane).

563 unit tests (from 534), 199 end-to-end (from 195): the e2e draws a rectangle,
fillets a corner and adds an island circle with the real tools on a tilted
sketch, turns the view, and checks `loops()` against the drawing's own
coordinates and `loopAt` against the position a real click carried.

---

## Planar discipline: circles and arcs carry a plane

![A rectangle and two circles drawn on a sketch plane tipped off every kernel axis, turned a radian away: the rectangle is a parallelogram, and both circles are ellipses inscribed in it — one drawn with the circle tool, one through three clicked points, passing exactly through them](docs/images/55-circles-seen-as-ellipses.png)

**3D phase 2.** Phase 1 left three honest lies in the drawing — a circle was a
sphere (round from every angle, snapped only face-on), an arc's side came from
the kernel's axes, and a sketch simply ignored geometry off its plane. All three
are closed.

| | |
|---|---|
| ![The same sketch square-on, after plane() and the circle and 3-point circle tools: two circles, a rectangle, the tilted frame's triad with its z arm pointing at the viewer](docs/images/54-circles-on-a-tilted-sketch-square-on.png) | ![The sketch turned, with the point tool armed over empty space: a dashed green square with a small ring sits on the sketch, and a faint dashed leader runs from it up to p13, a point thirty units off the plane — the projected snap](docs/images/56-projected-snap.png) |
| ![A right-click on a second frame's arm: the frame lights amber and the menu reads Insert name, Delete, and Sketch on this with setDefaultFrame("f2"); lookAt("f2") beside it](docs/images/57-sketch-on-this.png) | ![A version-6 file opened and turned: a floor and a wall tipped up from it, each with its own arc and circle; the floor's circle is a flat ellipse and the wall's nearly round, and the log reports [floor, wall, floor, wall] for the four planes](docs/images/58-a-v6-file-opened-planar.png) |

**A circle or arc in 3D names its plane — a frame.** `addCircle(center?,
radius?, plane?, name?)`, `addArc(…, radius?, plane?, name?)`, `circ(c, r,
plane?)`, `arc(c, s, e, r, plane?)`: the frame named, or the default resolved
**at call time and journalled resolved** — `fix`'s rule — and with neither, the
standing message. ⚠ **That is a real semantic change:** a 3D circle now needs a
frame to exist, exactly as `fix` does; in a one-model 3D world a circle without
a plane would be a sphere. A 2D model refuses the argument, and 2D behaviour is
unchanged. **The plane is an orientation, never a constraint:** the rim is the
circle through the circle's own centre parallel to the frame's x–y plane, and
the centre is not pinned to the frame — a constructor never constrains — so
dragging a centre off the frame carries the rim with it, parallel. (A tool
holds what it draws on the sketch with an ordinary `onPlane`, as before.)
Deleting a frame takes the circles and arcs on it.

**`onCircle` and `tangent` mean the planar rim.** In 3D each gains a second
block — the point (or both ends of the line) on the plane through the centre
parallel to the frame, the frame read as a datum — so `oncircle` is a curve,
not a sphere, and a tangent line lies in the circle's plane instead of swinging
round its centre. **In 2D that block would be trivially zero and is not
emitted**: block counts and residual values are exactly today's, and tests say
so.

**An arc turns about its frame's +z.** The kernel-axis side rule is retired;
an arc on an upside-down frame draws the arc it was given, not its complement.
`fillet(l1, l2, r, plane?)` gives its arc the default frame in 3D and refuses a
corner that is not in that frame's orientation, naming the frame.

**A planar circle is drawn, picked, snapped and boxed as the ellipse it
projects to** — a closed quarter-pixel polyline seen obliquely, the exact
circle face-on — through one new module, `curveplane.ts`, that answers "where is
this rim" for the renderer, projection, glyphs, tools and fillet alike. The
silhouette is gone, and with it the face-on-only intersection snaps.

**A point off the sketch snaps at its projection** — the foot of the
perpendicular onto the sketch plane — as a position aid only. It **infers
nothing** (a coincidence with a point the new one is not at would be a lie),
ranks below every place really on the sketch and above a bare curve, and is
drawn as a **dashed hollow square with a leader** back to the point it borrows
from. Points only in this package; projecting curves is later.

**Starting a sketch.** `plane(origin?, xref?, yref?)` is a frame, made the
default, looked at square-on — "start sketching here" in one call, journalling
only the frame and the `setDefaultFrame`, never the camera. A frame's context
menu gains **Sketch on this** (it types `setDefaultFrame("f"); lookAt("f")`).
`frame()` typed in a turned view now seeds facing the viewer instead of along
the kernel's axes. In 3D with no default frame the circle, arc and fillet tools
refuse their first click out loud, and the empty-canvas menu shows them
disabled with that message underneath.

**Format version 7.** Older files translate on the way in: in 2D the plane is
null; in 3D an arc takes the frame nearest its normal (read from the *saved*
coordinates), a fillet its corner's, a circle the default; a file with no frame
at all — any frameless 2D drawing — gets one frame of the translation's own,
`plane`, lying where its curves are; and an arc that version 6 drew the other
way round has its ends swapped so it opens as the arc it was. A 2D file of
*any* version lifted into the app goes through the same rule, since its
circles never had a plane — a version-7 2D file's null plane is exactly what a
3D model cannot take. The rule is written out in `src/planetranslation.ts`.

**Found and fixed on the way:** an operation journalled itself *before* its
body ran, so a fillet refused for its radius stayed in the journal and the file
saved after it failed to reopen at that step. Operations now journal once they
have succeeded.

**Known and deliberate:** a plane never pins a centre; curves off the sketch
are not projected; a v6 circle cannot say which plane it was drawn on and takes
the default; a v6 bare `arc()` whose ends were auto-created cannot be swapped;
`pt(x, y)` still seeds at the kernel's z = 0; one depth per entity in the
painter's sort; the last click's snap marker stays on screen until the next
redraw (older than this package — screenshot 54 moved the mouse off it).

534 unit tests (from 493), 195 end-to-end (from 187), all green with the
typecheck and the kernel's own.

---

## The app is 3D: an orbit camera, sketches on planes, and 2D files lifted

![A floor sketch and a wall sketch standing on its back edge, seen obliquely: the floor is a parallelogram with one filleted corner drawn as part of an ellipse, the wall's profile — two lines, a three-point arc bump, two more lines — rises from the floor's back edge, and each frame's triad shows its x, y and z arms foreshortened](docs/images/52-two-sketch-planes-oblique.png)

**The camera half of 3D phase 1.** The app runs a `Model(3)`, always — the
owner's one-model decision: no mode switch, no second model type, and a
"sketch" is just geometry on a frame's plane. It starts square-on, looking down
−z with +x right and +y up, and until something turns it the app looks and
behaves exactly as the 2D one did, with every point at z = 0.

| | |
|---|---|
| ![A rectangle and a circle drawn face-on on a default frame; each corner wears a small parallelogram mark, the on-plane constraint](docs/images/49-face-on-sketch.png) | ![The same drawing after a right-drag: the rectangle is a parallelogram, the frame's triad shows its z arm, and the circle is still a full circle — its silhouette, the phase-2 seam](docs/images/50-orbited.png) |
| ![Looking square-on at an upright frame standing on the rectangle's far edge, with a profile drawn on it by the line and three-point-arc tools; the floor rectangle is edge-on, a line](docs/images/51-drawing-on-an-upright-frame.png) | ![A version-4 2D file opened in the 3D app and turned: the rectangle and its fillet lie flat, the frame has gained a y-ref called base_y, and the 70 and 50 dimension labels follow the projection](docs/images/53-a-2d-file-opened-lifted.png) |

**⚠ The mouse map is Onshape's 3D one.** Right-**drag orbits**; middle-drag
pans; the wheel zooms toward the cursor; a right press **released in place
still opens the context menu**, because the release decides — the register's
promise held through the change of what a right-drag *is*. The left button is
exactly what it was, on the working plane. `pan()`/`zoom()` keep working, and
`orbit(yaw, pitch)` and `lookAt(frame?)` join them — relative like them,
never journalled like them. A 2D model (the library, the unit tests) keeps the
old map: there is nothing to turn.

**Orthographic, and an orbit is a trackball.** The camera stores its own
screen axes rather than an azimuth and elevation, for two reasons: `lookAt`
has to put a *tilted* frame square-on with its +x to the right, which two
angles cannot express (it needs a roll), and an orbit about the kernel's z
would make the gauge's z the drawing's "up". So a right-drag turns the
drawing about the screen's own axes (half a degree per pixel, positive carrying
the near side the way the hand moves), about an orbit target that panning and
zooming keep on its pixel — "orbit" is always about the middle of the window.
Perspective is deliberately not v1.

**A click lands on the working plane.** A pixel names a ray, so it needs a
surface: the **default frame's plane**, when there is one — set a frame as the
default and every tool draws on it, Onshape's sketch flow — else the plane
facing the viewer through the orbit target. A drag moves what it grabbed
parallel to the plane the press landed on. **`placePoint` holds what it places
on the sketch with `onPlane`**, deliberately minimally: only where the snap
left the point free (no snap, or a curve snap), and only when it is actually on
the plane. Its mark is `▱`, the one the model half deferred until it could be
looked at.

**The tools needed editing after all**, and the spec hoped they would not:
rectangle, circle, circle3, arc and arc3 all refused 3D outright. Each now does
its layout in the working plane (a rectangle's derived corners along the
plane's axes; the 3-point tools' circumcircle in 3D; the centre-point arc
counter-clockwise *as the viewer sees it*). The line tool's axis inference works
against a tilted 3D frame, in its plane. `fillet` is dimension-generic too, or
every 2D file with a fillet would have failed to open.

**What the projection changed.** Lines project to segments; **a circle is drawn
and hit as its silhouette**, because until phase 2 gives it a plane every
relation reads it as a sphere — visible in the orbited picture above, and left
visible on purpose. **An arc has a plane** — through its centre and endpoints —
and **sweeps counter-clockwise about that plane's normal on the kernel's +z side**
(then +y, then +x): the gauge showing through, said out loud, and the one rule
that keeps every 2D arc what it was. Seen face-on an arc is picked, snapped and
boxed by the exact arithmetic it always was; seen obliquely, as a quarter-pixel
polyline. A snap's world position is read off what it snapped to, never off the
pixel, and a screen crossing counts only where both curves agree it is one
place in space.

**While sketching on a plane, snaps only offer places on it.** Found by looking
at the poster: seen square-on, the wall's last corner snapped to the floor's
*front* corner seventy units behind the pixel, dragging the wall's edge out of
its plane with every relation satisfied. What is only seen *through* a sketch
is not a place on it; what is on it (the floor's back edge, which the wall
stands on) is still found.

**Format version 6, and 2D files open lifted.** Opening a 2D file — keyed on
its `dim`, so v4 *and* v5 — gives every coordinate a zero and every frame the
y-ref a 3D frame needs, named after the frame (`base_y`) so it cannot take a
name the file uses later, and placed a quarter turn from the x-ref using the
*saved* coordinates. At the command line `pt(x, y)` is `pt(x, y, 0)` and
`fix(p, [x, y])` is on the frame's plane, journalled lifted. Version 6 because a
2D-only build would open a 3D drawing as its flattened shadow with every tool
refusing — nothing would be misparsed, but it would be misread. A re-saved
lifted file is a v6, `dim: 3` file, byte-stable from there.

**Known and deliberate, for phase 2:** circles are spheres (silhouette, no
intersection snaps except face-on); an arc whose plane turns through the
vertical flips its reference side and draws as its complement; `pt(x, y)` seeds
at the kernel's z = 0, not on a tilted default frame; `frame()` typed in a
turned view is still seeded along the kernel's axes; no snapping to off-plane
geometry while sketching; one depth per entity in the painter's sort.

493 unit tests (from 452), 187 end-to-end (from 175), all green with the
typecheck and the kernel's own.

---

## 3D frames: a frame is a sketch plane, and `fix` stops seeing the gauge

**The model half of 3D phase 1.** Nothing on screen changed — the app still
runs a 2D model, and the camera, the app on `Model(3)` and 3D rendering are
the second half. What exists now is everything a 3D drawing needs underneath:
frames that are planes, `fix` in three coordinates, a way to hold a point in a
plane, and axis references that include the plane's normal. All of it is
usable from the command line on a `new Model(3)` and pinned by closed-form
tests.

**A 3D frame is an origin, an x-ref and a y-ref.** In 2D an origin and one
direction settle a frame; in 3D they leave a whole rotation free, which is why
frames were 2D-only and why `fix` above 2D still pinned the kernel's own
coordinates — the one place the register said the gauge was visible. The y-ref
closes it. `addFrame(origin?, xref?, yref?, name?)` follows the free-entities
rules (a missing piece is created, seeded so the frame cannot start degenerate
even when two of its three points were given); a 2D model refuses a y-ref.

**The y-ref picks the plane and its side, not the angle.** `frameBasis` takes
+y as the y-ref's direction with its +x component removed (Gram–Schmidt) and +z
as +x × +y, so three clicks that are roughly an L give an exact, orthonormal,
right-handed frame, and a y-ref dragged anywhere in its half of the plane
changes nothing. A frame that collapses floors axis by axis rather than turning
into NaN: a y-ref on the frame's own x axis loses +y and +z and keeps +x.

**`fix` in 3D pins `[x, y, z]` in a frame, and the frameless form is gone** —
in every dimension, so a 3D `fix` with no frame gets the same standing message
a 2D one does. **`onPlane(point, frame?)`** (`onplane`) holds a point in a
frame's plane: the signed distance `(p − origin) · +z`, a frame read and never
pushed, the default resolved at call time and journalled resolved — exactly
`fix`'s rules. **`"f1.z"`** is the plane's normal as an axis reference, so
`par("l", zaxis())` stands an edge straight up off a sketch. A 2D model refuses
`onPlane`, `"f1.z"` and `zaxis()`: there, every point is already in every
frame's plane and there is no direction off it.

**Format version 5.** `addFrame`'s name moved from third to fourth argument —
name last, as on every constructor — and a build that knew only version 4 would
have read the new entry as an auto-named frame and lost an explicit name, so
the version moved. **Every older file still opens**: its three-argument
`addFrame` is translated on the way in, and it re-saves as version 5
(`save(open(x)) ≠ x` across this boundary, as across the earlier ones). The one
file that will not open is a version-4 *3D* file that used the gauge `fix` —
refused by step with the no-frame message, as a frameless version-1 file is.
The app has only ever been 2D, so only the command line or a test could have
written one.

**What the tests check is the arithmetic, not the verdict.** Every 3D frame in
`test/frames3d.test.ts` is turned by a rotation the test computes for itself,
and the assertions are where that rotation says things land: a `fix` at
`(3, −4, 5)`, a line pinned above and below the plane crossing it at
`(2.8, 0.2, 0)`, `par`/`perp`/`ang` against all three axes — with the frame's
points unmoved to the last bit. 452 unit tests (from 430); e2e unchanged at 175.

---

## A saved file carries its tools' source — as text you paste back yourself

![A fresh session after openFile(): the log reads "this file carries the source of tool "spot" — toolSource("spot") shows it; paste it to enable", then the printed source, then the pasted entry, then "armed: spot", with p5 drawn by the re-enabled tool beside the four points that came out of the file](docs/images/48-a-file-carries-its-tool.png)

**The owner's decision, built exactly as decided: inert text, pasted back by
hand.** A tool authored at the command line now rides in the saved file as its
own source, `open()` never evaluates it, and the paste is the consent. This
closes the register's oldest open question without spending any of the
"a saved file is data" rule: nothing in a file runs that the user did not
themselves type.

**What is captured is the whole entry.** A tool is a class over its module, so
it cannot be serialised any more than a residual block can — but the text the
user typed can be written down, exactly as the journal writes down the calls
they made. The *whole* entry, not the class expression sliced out of it: an
entry may build helpers around its class, and cutting one expression out of it
would be both a parser project and a lie about what ran.

**The capture seam was the design question.** The entry text is known only to
the evaluator; what a tool is, is known only to the command surface; and
`repl.ts` has to stay as ignorant of tools as `problem.ts` is of points. So the
evaluator publishes a plain fact — `repl.entry`, the entry in flight — and the
host wires the two together through a `currentEntry` handle. Capture then lives
in `replenv`'s `defineTool` wrapper, and two properties fall out of *where* it
sits rather than out of any check: a built-in registers from its own module and
never comes through that door, so built-ins are never captured; and a
`defineTool` called later from inside a tool's own callback has no entry in
flight, so nothing is recorded for it.

**It is session state, not model state.** Not in the journal, not known to
`model.ts`, and not an undo step — the undo bracket compares `save(model)`
snapshots, and `tools` is a *parameter* of `save` that defaults to none, so a
snapshot cannot see one. That is why the sources are passed in at the one call
site the user asked for rather than read from a global; a pinned test asserts
that authoring a tool leaves the snapshot byte-identical.

**`VERSION` stays 4.** An optional field that older code ignores is not a format
break in either direction, and there are no third-party readers of v4 to
protect — the reasoning is in the comment beside the constant rather than in a
bump nobody could act on.

**What a user sees.** Opening a file that carries tools prints one line per
tool — `this file carries the source of tool "spot" — toolSource("spot") shows
it; paste it to enable` — through the log, from both doors into opening a file
(the `open()` command and the file picker, sharing one function so the two
cannot drift). `tools()` lists a carried-but-not-pasted source distinctly from
something armable, `toolSource(name)` prints it, and pasting it is an ordinary
entry that the wrapper re-captures, so the next `save()` carries it forward.
There is deliberately no button, menu item or flag that runs it for you.

**The inertness is tested, not asserted.** A file whose `tools` entry would set
a marker and throw if it were ever evaluated travels open → list → print →
save; the marker stays unset, the name stays unregistered, the text comes back
unchanged, and only a paste — a person typing — makes anything run.

---

## Dimensions are named `d1`, `d2`, … and `set()` edits one

![A levelled rectangle with a filleted corner, dimensioned 120, 70 and R20, the log showing dist returning d1 and d2](docs/images/46-dimensions-are-named.png)

**The owner's decision, verbatim: editing a dimension *"should be a
`set(d4.value, 60)` where d4 is the dimension."*** That closes the register's
open question, and it closes it by adding nothing: there is no parameter table,
no second registry, no new kind of entity. The dimension already had a name and
already held the value; it just needed the right name and a way to say so.

**`dist`, `rad` and `ang` are dimensions and claim `d` names.** Everything else
— `par`, `perp`, `coin`, `tan`, `on`, `eq`, `sym`, `fix` — stays `r`. The split
is the one Onshape draws: a dimension is a number you put on the drawing, a
constraint is a statement about shape. It earns its keep because the name now
tells you which kind of thing you are holding: a `d` is something to go back and
edit, an `r` is something to add or delete. Nothing else changed — `del`,
`rels()`, glyphs, hover, the journal all worked the moment the prefix did,
because none of them ever cared what a name started with.

**`fix` is deliberately not a dimension.** It carries *coordinates* — two of
them, in a frame — rather than one value, so there is nothing for `.value` to
mean; and Onshape's fix is a constraint too.

**The prefix is decided by the op, inside `model.relation`.** Read from a lookup
rather than passed in by each relation, because an argument every relation has
to remember is an argument one of them will eventually forget — this codebase
has a whole CLAUDE.md section about that failure. The throw-rollback now puts
back whichever counter the claim actually moved: restoring `"r"` after claiming
`"d"` would leave a failed `dist` silently shifting every later dimension's
name, and a replay would then hand out different ones.

![The same drawing after set("d1.value", 190): wider, still level, still tangent, the log showing the command and d1 coming back](docs/images/47-set-a-dimensions-value.png)

**`set("d4.value", 60)` is an operation, not a relation.** It does not add an
equation, it *replaces* one — old residual blocks out of the problem, fresh ones
in — which is structure-adjacent bookkeeping of exactly the kind `operations.ts`
exists to hold apart from `relations/`. The relation is rebuilt **in place under
the same name**: same registry position, `args` updated, so `rels()`, the glyph's
label and `del`'s reference scan all tell the truth about `d4` afterwards without
being told anything. That the name survives is the whole point of the dimension
having one.

**New blocks are built before old ones are removed**, which is the only ordering
under which a body that throws leaves the relation exactly as it was. The other
way round, a bad value would delete a working constraint and *then* fail — and
residual blocks are closures, so there would be nothing left to put back.

**`ang` takes radians, because that is what the relation stores.** The label on
the drawing reads degrees; that seam is the documented one and this package does
not close it. Guessing the caller's unit from the size of the number would be
worse than one honest unit, and degree input is the owner's to ask for. The
throw says "a number of radians (the label reads degrees; the relation stores
radians)" where a user holding the wrong unit will actually meet it.

**One user action, so one undo step, and the host re-solves after.** The `del`
precedent, only sharper: changing the answer is the entire thing `set` does, so
leaving a stale verdict on the header would be the readout bug this project has
already been bitten by twice.

**The menu gains Set value… on a dimension glyph, and it *types*.** It puts
`set("d4.value", ` in the command line, unfinished, for the user to complete —
the house pattern for a command needing input the menu cannot know, and the only
shape available under the rule that every item is a command the log shows. A
menu that popped its own number prompt would be a fourth editing surface. The
item shows exactly that unfinished text beside its label, so it cannot look like
it is about to do more than it does; the current value is deliberately *not*
pre-filled, since it is already on the drawing and pre-filling it would leave the
user editing a literal rather than stating one. A constraint glyph gets no such
item at all — there is no value to set, and an item existing only to say so would
be worse than none.

**Format version 4, and version-3 files translate rather than being refused.**
Relation names are handed out by order of creation, so re-prefixing changes which
relation a given string picks out. Almost nothing in a journal holds one — a
relation entry records the geometry it constrains, not its own name — with one
exception: `deleteRelation`, which is nothing but a name. So a v3 journal is
replayed with a map from the name each relation *had* to the name it *gets*, and
`deleteRelation` args are rewritten through it. The map is computed **from the
replay itself** rather than by scanning the journal, because `fillet` is one
entry that expands into four relations and a scan would be off by four from there
on — and would be wrong again the next time an operation's expansion changed. It
also reproduces the old naming's one wrinkle, skipping a name an *entity* had
taken. As at 2→3, the rewritten journal is what gets installed, so a v3 file
re-saves pointing at names the model actually uses and round-trips byte for byte
from then on.

**Verification.** 414 unit tests (was 396) and 173 in the browser (was 165). The
unit side asserts block counts and dead handles rather than behaviour where it
can: a rebuild that left the old block in would still *solve* — to a drawing
satisfying neither the old value nor the new — and every behavioural assertion
short of counting would pass it. The browser side covers what only assembly can
get wrong: geometry that actually moves to the new value, a header that is not
still reporting the verdict from before the edit, one Ctrl+Z returning the old
value, and the menu item typing something that does nothing until it is finished
by hand. The screenshots above are a real session; the tilt visible in an earlier
take of them was the drawing's free rotation — nothing pins a bare rectangle's
orientation — so the poster pair levels it against a datum first, and the
right angles, the tangencies and the untouched `70` were checked to nine decimal
places rather than by eye.

---

## `hor` and `ver` are retired; a level edge is parallel to an axis you can name

![A rectangle levelled against a tilted frame, each edge wearing one // mark](docs/images/45-par-to-a-frame-axis.png)

**The words implied a world frame, so the words are gone.** The
coordinate-frames package took the world frame out of the model and left it
standing in the vocabulary: `hor` still says the universe hands you a
privileged pair of directions. What is meant is "parallel to an axis I can
name", so that is now the only way to say it. `par("l1", "f1.y")` is vertical;
`par("l1", "f1.x")` is level; `perp` and `ang` take an axis the same way.
`horizontal` and `vertical` are **removed, not aliased** — reaching for one
gets `no such name: hor`, which the REPL already said for every other typo.

**`xaxis(frame?)` and `yaxis(frame?)`** hand back the reference string,
resolving the default frame *at call time* through the same `resolveFrame`
every frame-relative call uses — so a drawing with no default gets the one
standing message about what to do, and the answer is baked into the string the
relation journals. A saved entry cannot change meaning because the default
moved afterwards. The owner's sketch was `parallel(l1, *defaultframe.Y)`;
`par("l1", yaxis())` is as close as that gets without the evaluator learning a
new kind of expression.

**Datum semantics carry over, and now say so in the arithmetic.** An axis
reference contributes a direction and no variables, so the solver can never
satisfy it by turning the frame — the direction is built out of
`Dual.constant`, whose gradient is empty, which puts the frame outside the
Jacobian as a matter of construction rather than of bookkeeping. Two ordinary
lines in `par` still push each other. The axis arrives normalised from
`frameBasis`, which keeps the collapse exploit shut and puts the residual on
exactly the `|d|·sin` scale `hor` had: `par(l, "f.x")` is the same equation,
wedge for wedge, and the frames package's closed-form tilted-frame tests hold
to the same tolerances in the new spelling.

**Which relations take one is a rule rather than a list.** An axis is a
direction — no length, no position — so exactly the relations that read an
argument for its direction alone may take one: `par`, `perp`, `ang`. `eq` has
no length to be equal to; `on`, `sym` and `tan` each need a *located* line, and
reading `"f1.x"` as a line through the frame's origin would give one syntax two
meanings (`fix(p, [t, 0])` already says "somewhere along the frame's x").
`par`/`perp` keep the point-pair form `hor` had — `par("p1","p3","f.x")` —
settled on the subject's kind exactly as `hor` settled it. `fix` is untouched:
it was frame-relative already and names no privileged direction.

**A dot is now refused in every entity name**, at `claimName`, so a reference
can never collide with one. `relationsNaming` and `del`'s cascade read `f1.x`
as naming `f1` — without that a frame could be deleted out from under a
relation still reading it, and the symptom would be a residual throwing inside
the next solve, as far from the mistake as a failure gets.

**Glyphs.** `—` and `|` went with their relations. A `par` whose other side is
an axis reference gets **one** mark, on the line: there is no second edge to
put one beside, and inventing a place for it would be a mark on geometry the
relation does not constrain. An `ang` against an axis has no corner to be
written at, so it goes beside the edge. Hovering either still lights up the
frame, because the highlight resolves `f1.x` back to `f1`.

**The parallel mark is `//`, not `∥`.** Found by looking at the picture rather
than the numbers: U+2225 is not in the browser's monospace and drew as a tofu
slab. Every other mark advances 7.2246px in that font; `∥` advances 6, which is
the substitution showing. It was invisible while `par` was a rare relation and
became the commonest mark in the drawing the moment `hor` and `ver` retired
into it. `//` is also what a draughtsman writes. An end-to-end test now
measures every symbol in the table against the monospace cell, so the next one
cannot rot quietly.

**Format version 3, and old files translate rather than being refused.** A
version-2 entry `horizontal(l, f)` replays as `parallel(l, "f.x")` and
`vertical(l, f)` as `parallel(l, "f.y")` — parallel to +y rather than
perpendicular to +x, which is the same equation (the wedge with +y *is* the dot
with +x) but reads afterwards as what the drawing actually claims. Point forms
carry their extra name along. **`save(open(x))` differs from `x` across this
boundary, deliberately:** the translated journal is what gets installed, so a
v2 file re-saves in the new vocabulary. A file that opened as `par` and saved
back as `hor` would keep the retired words alive in the format forever. It
round-trips byte for byte from there on. Version-1 files — the pre-frames ones,
whose `hor`/`ver`/`fix` name no frame at all — are still refused by step, with
the same message, now raised by the translation that has to resolve the frame
they lack.

---

## The right-click menu, which only ever types

![The context menu open on an edge](docs/images/43-context-menu-on-an-edge.png)

**Right-press and release without moving opens a menu; right-drag still pans.**
The right button now makes exactly the split the left one has always made, on
exactly the same three-pixel threshold: the press decides nothing, the release
decides. That is what lets the register's standing promise — right-drag pan
yields to a context menu once one exists — be cashed without taking anything
away. Panning is untouched, the browser's own menu stays suppressed, and
middle-drag remains purely navigational and never opens anything.

**Everything on the menu is a shortcut to a command the log shows.** An item
does not call into the model; it types a line into the same machinery the
keyboard uses. On an entity: *Insert name* (what a left-click already does),
*Delete* (`del("l3")`), *Dimension*, and on a point *Fix*. On a constraint
glyph: the relation's own description as the header, and *Delete*. On empty
canvas: the eight tool arms, plus *Frame*. Each row shows the command beside
its label, because a menu that hid what it was about to do would be a fourth
way to edit the drawing instead of a faster way to type.

**The seam is `submit`** — the function the Enter key calls — passed to the
menu as an explicit `run` hook. That was the one real design question here, and
it turns on "a shortcut to a typed command" being a claim about *machinery*
rather than about outcome: it has to log the entry, push it onto the recall
history, bracket it as one undo step, and re-solve if it changed anything. All
four already live in `submit` and nowhere else, so anything short of calling it
would be a second, slightly different answer to what typing a command means,
and the two would drift. The alternative — writing the text into `#cmd` and
dispatching a synthetic Enter — reaches the same function by pretending to be a
keyboard: it makes the seam invisible to a reader, destroys whatever was
half-typed, and breaks the moment the input's keydown handling changes.

The consequence is that there is nothing to check about undo, journalling or
the status line, because none of it is new. `Dimension` on an edge is one
`dist` in the journal, one Ctrl+Z, one solve, one line in the log — the same as
if it had been typed, because it was.

![The dimension the menu typed, and the log line it wrote](docs/images/44-dimension-from-the-menu.png)

**A dimension carries the current measurement**, so the action reads as *hold
it where it is* — Onshape's own dimension-tool behaviour, and the only reading
under which the item is safe to click without looking: it adds a constraint the
drawing already satisfies and moves nothing. A line gets `dist(end, end, len)`,
a circle or arc `rad(name, r)`. A point gets no Dimension at all, because a
single point has no measurement of its own, only measurements to other things —
and what a point wants instead is the item below it.

**Fix is shown disabled when there is no default frame**, carrying the model's
own standing message (`no default frame — frame() then setDefaultFrame(), or
say which frame`) read out of `resolveFrame` rather than copied, so the menu and
the command line cannot drift on the wording. Shown and disabled rather than
omitted, because the missing frame is exactly what the user needs told; an item
that simply was not there would leave "why can I not pin this point"
unanswered. It never quietly makes one — a datum nobody chose, silently
becoming what every later `hor` is measured against, is precisely what the
no-world-frame decision exists to prevent. And the coordinates it types are the
point's position **in the frame**, not its raw numbers: against a frame that is
turned or sitting off the gauge's origin, raw numbers would be a `fix` that
yanks the point somewhere else the instant it landed, which is not "hold it
where it is" by any reading. There is a unit test with a frame turned 90° and
moved that fails on the raw form.

The *Frame* item on empty canvas is `setDefaultFrame(frame())` when the drawing
has no frame at all and `frame()` once it has one. A first frame is nearly
always meant to be the default — `hor`, `ver` and `fix` do nothing until one is
set, so a first frame that was not the default would leave a marker on screen
and the same error message as before. A second frame is a different intent, and
silently repointing the default would move every bare `hor` in the drawing.

Escape closes the menu, and so does a press anywhere else — a *left* press is
also swallowed, so the click that dismissed a menu does not go on to pick, drag
or box on the canvas underneath it. Other buttons fall through, so a right-click
elsewhere closes this menu and opens the next one in one gesture. Opening a file
or pressing Ctrl+Z closes it too: an open menu names entities of the model being
replaced, and `del("l3")` offered for an `l3` that no longer exists is a lie.

New file `src/menu.ts`, which splits so that the interesting half has no DOM in
it: `menuFor(model, pick)` takes a model and a pick and returns labels and
command strings, which is what lets "which items for which kind" and "what does
Dimension type for an arc" be unit tests. `engine.ts` gained one callback and
the right button's threshold; `main.ts` gained the wiring and the `run` hook;
`index.html` gained the menu's styling, beside the hover tag's. Nothing else
changed — no new journal op, no model change, no solver change, no new relation.

*Known and deliberate:* the items are hard-coded per pick kind, so nothing
defined at the command line can add one — the same gap "tools are not
privileged" closed for tools, left open here and noted in `TODO.md`. No
submenus, icons or arrow-key navigation. A right-click with a tool armed opens
the ordinary menu rather than something tool-specific, which is one rule
instead of two. A right press taken *during* a left drag opens nothing.

---

## The 3-point arc tool, and the click it deliberately throws away

Onshape's *3 point arc* as a pointer tool: `arm("arc3")` — or the bare word —
then **the two endpoints, then a point the arc passes through**. That order is
worth saying twice, because it is neither the natural guess (start, waypoint,
end) nor the centre-point arc tool's (centre, start, end); it is Onshape's.

What is committed is two `placePoint`s, one **free** `addArc` whose centre is
auto-created and seeded at the circumcentre, its radius at the circumradius,
and one `arcEndpoints`. No new journal op, no model change, no solver change —
`addArc`, `setCoords` and `arcEndpoints` were all already in `persist.ts`'s
replay table, which is the evidence that this is a composition and not a new
kind of thing. `engine.ts`, `replenv.ts`, `persist.ts` and `operations.ts` are
untouched; `tools()` lists `arc3` without being told, because it reads the
registry.

**The third click places nothing, and that is the design.** In Onshape the
waypoint is not kept as geometry, and keeping it would leave a point in the
drawing the user never asked for and would have to clean up by hand — the
fillet's reason for reusing its shared corner rather than stranding it.
Its whole job is to *choose*: which of the two arcs between the endpoints, and
where the centre and radius start from. So the arc is under-constrained
afterwards — seven unknowns against `arcEndpoints`' two equations, with the
**bulge free** — which is the same bargain the centre-point arc tool already
strikes and the register's standing rule that tools do not dimension what they
draw. The alternative, keeping the waypoint as a third point with an
`onCircle` (precisely what `circle3` does), was rejected on both counts. There
is a test that shoves the centre along the endpoints' perpendicular bisector
and finds the system just as solved at a visibly different radius: the freedom
is asserted, not merely written down. A user who wants the bulge held says
`rad(...)` or drops a point on the rim.

**The sweep is chosen, not assumed.** `main.ts` draws an arc counter-clockwise
in world space from `start` to `end`, so the two endpoint clicks are assigned
to those two roles in whichever order puts the waypoint *inside* that sweep —
both clicks are endpoints either way, only the label moves. This is the claim
that needed testing hardest, because an arc bulging the wrong way satisfies
every residual to machine precision and is still the wrong drawing, which is
the fillet bug's exact shape. The unit tests therefore ask `withinSweep` and
`screenAngle` themselves — `intersect.ts`'s one definition of what is *on* an
arc, the one picking and snapping already sit on — rather than a second
opinion written for the occasion. Flipping the choice in the source fails
three of them.

Everything else is `circle3`'s shape, and deliberately so: both endpoint
clicks go through `placePoint`, so an arc from one existing corner to another
is three clicks and no special case; nothing is created before the third
click, so the engine's existing bracket makes the whole gesture one Ctrl+Z; a
dashed preview after the second click shows the arc the next click will build,
bulge and all; an exactly collinear third click is refused through `ctx.log`
with the gesture left live, and near-collinear is the user's call. A second
click on top of the first is swallowed as a double-click, the way `arc.ts`
already swallows its own zero-radius one.

One shared piece moved: **`circumcircle` and `COLLINEAR_EPS` now live in
`src/tools/circumcircle.ts`**, out of `circle3.ts`. Two tools need the same
closed form *and the same answer* to "are these three points on one line", and
two copies of a scale-free epsilon is the sort of thing that drifts until one
tool refuses a gesture the other accepts. The new file registers no tool, so
importing it has no side effect — `place.ts` is the precedent for a helper
module under `tools/`.

| two endpoint clicks and the cursor — the dashed arc, live | committed: one arc, one `arcends`, two inferred coincidences |
|---|---|
| ![A rectangle with its parallel and perpendicular marks. Its top-left corner p1 and top-right corner p2 are both lit amber, and a dashed amber arc springs from one to the other, bowing up above the rectangle to the cursor. It is one arc, not a circle — nothing is drawn below the top edge. The log reads "armed: rectangle" then "armed: arc3"](docs/images/41-arc3-preview.png) | ![The same rectangle with the arc now solid and pale, still running corner to corner over the top of the shape. Two new points p5 and p6 sit on the two corners with ring-and-dot marks beside them, and the arc's own centre p7 sits just inside the rectangle below the top edge. There is no point at the top of the bulge — the third click left nothing behind. The log shows rels() answering r1 par l1 l3, r2 par l2 l4, r3 perp l1 l2, r4 coin p5 p1, r5 coin p6 p2, r6 arcends a1](docs/images/42-arc3-committed.png) |

The right-hand picture carries the two claims that matter. **There is no point
at the top of the bulge** — the waypoint chose the arc and was thrown away.
And the centre `p7` sits *below* the chord while the arc bows *above* it,
which is simply what a minor arc looks like; a test written about which side
the centre falls on would flip its answer with the sagitta, so the browser
spec asks about the midpoint of the sweep instead.

Unit 350 → 364, e2e 150 → 156, kernel unchanged.

## There is no world frame any more

The owner's direction: **no built-in origin and no built-in world coordinate
system at all**, because an origin tempts every drawing into being related to
a global grid. Instead a coordinate frame is a thing you make, and one of them
can be the default. The grid went earlier; this is the rest of it.

A **frame** is an origin point plus a point fixing +x — purely referential
like a line, owning no variables, its two points ordinary draggable
constrainable points. `addFrame(origin?, xref?, name?)` follows the
free-entities conventions throughout: every argument optional, `null` the same
as absent, missing pieces auto-created and seeded a span apart so a frame with
no direction cannot be built, and the whole thing journalled as the one call
that was made. +y is +x turned a quarter turn, which settles a frame in 2D and
leaves a whole rotation free above it — so frames are 2D-only, the same call
`hor`/`ver` already make.

`hor`, `ver` and `fix` are now **relative to a frame**: the one named, or the
default at call time. With neither, they refuse, and say what to do about it —
*no default frame — frame() then setDefaultFrame(), or say which frame*. The
journal always records the frame the call resolved to, so an entry cannot
change meaning because the default changed afterwards.

> **⚠ Saved files from before this package will not open.** They carry
> frameless `hor`/`ver`/`fix` entries and there is no world frame left to
> resolve them against. The replay table refuses them by step and name with
> exactly the message above, rather than skipping them silently. Accepted
> deliberately: this is pre-release with one owner, and a compatibility shim
> would have to preserve precisely the semantics the package exists to remove.
> The format version is 2; a version-1 file with nothing frameless in it still
> opens.

**A frame is read, never pushed — the one decision worth arguing about.** A
residual block declares the variables it reads, and declaring the frame's two
points would put them in the Jacobian, which lets the solver satisfy
`hor(line, frame)` by turning the *frame*. Measured, it does exactly that: on
a 40-unit line seven units off level against a frame with a 20-unit arm, least
squares turns the frame about 8° and the line barely at all — and with an
un-normalised wedge it also pulls the frame's arm in by 14%, because shrinking
the thing being measured against is cheaper still. A frame the drawing shoves
around is not a datum, and a datum is the whole of what a frame is for. So the
frame's position is re-read at every evaluation — lazily, so a re-targeted
frame is still followed — and handed to the residual as a value. Two things
follow: a drawing levelled against a tilted frame settles at *exactly* the
frame's tilt rather than somewhere between its own and the frame's, and moving
a frame moves the drawing hanging off it, which is the gesture the second half
of this package is built around.

Two tools needed bridging, since a fresh model now has no frame at all:

- **The rectangle tool goes intrinsic** — `par` on each pair of opposite
  sides, one `perp` at a corner. A tool that could not draw a rectangle until
  you had made a frame would be a tool that mostly does not work, and "a
  rectangle is a rectangle in any frame" is the truer statement anyway. Three
  relations where there were four; the fourth was always redundant. ⚠ A
  deviation from Onshape, which infers H/V against its sketch frame.
- **The line tool infers an axis only when a default frame is set**, and
  infers against it. Inferring against the kernel's own axes would be the
  world frame coming back in through the side door.

### And a frame is a thing you can see and take hold of

A frame draws as a small axes marker at its origin: two short arrows along +x
and +y, lettered, with the frame's name beside it the way a point's name sits
beside the point. It is drawn in the **entity** pass, not with the constraint
glyphs — a frame is a thing in the drawing that can be clicked, dragged and
deleted, not a note about one. The arms are a fixed length in pixels, because
how far the x-ref sits from the origin carries no meaning at all; drawing to
it would put a number on screen that means nothing and changes with the zoom.

**The default frame is drawn brighter.** Which frame is the default is the
only ambient state in this app that changes what a typed word does, so it had
better be visible without asking.

![Two coordinate frames on an otherwise empty canvas, each a pair of short
arrows lettered x and y out of a dot, with the frame's name below it. The left
one, f1, is tilted about thirty degrees and drawn in a bright pale blue; the
right one, f2, is square to the window and drawn dimmer and
thinner](docs/images/39-default-frame-brighter.png)

Frames then hover, pick, box-select, drag and `del` with no new interaction
model, because every one of those was already written against "an entity is
the points it is made of". The marker is what the cursor aims at; the frame's
*origin point* still wins the pick where the two meet, which is the right
answer — dragging the point turns the frame, dragging the marker moves it.

`frame()` seeds its origin at the middle of the view like every other free
constructor, which matters more here than for a circle: a frame is what `hor`
and `ver` are measured against, and one that materialised off-screen would
leave the whole vocabulary pointing at something nobody can see.

**The line tool's aim, its guide and its constraint are now one answer.** Half
1 inferred `hor(line, frame)` while computing the aim and drawing the dashed
guide against the kernel's axes — invisible while nothing could tilt a frame
by hand, and wrong the moment something could. All three read the default
frame's own axes now, and with no default frame there is no aim and no guide
either, rather than a preview promising a constraint that never lands.

![The line tool mid-gesture beside two frames. A long dotted guide runs up and
to the right at the tilted frame f1's own angle — plainly not parallel to the
square frame f2's x arrow — with the dashed preview segment lying along
it](docs/images/40-tilted-guide.png)

### The poster: tilt the frame, and the drawing turns with it

![A dimensioned rectangle, its edges level and plumb, with hor and ver marks,
a 60 and a 40 dimension and a fix mark on its lower-left corner. To its right
a small axes marker, f1, square to the window](docs/images/37-frame-levelled.png)

![The same sketch after its frame's x-ref has been dragged upward: the axes
marker now leans about thirty degrees, and the whole rectangle — dimensions,
marks and all — has turned by exactly that much about the frame's
origin](docs/images/38-frame-tilted.png)

Nothing was typed between those two pictures. The x-ref was dragged thirty-odd
pixels upward, and every edge that said "level with f1" turned to stay level
with it, keeping its dimensions, pivoting about the corner that was `fix`ed in
the frame's coordinates.

**Which did not work at first, and the fix is the other half of
read-never-pushed.** The first version moved the frame three thousandths of a
degree against a gesture asking for twenty-six. Since a `hor(line, frame)`
residual does not declare the frame's points among its variables, the Jacobian
has no row saying "turn the frame and the line follows" — so the damped solve
tried a step that turned the frame, found it *raised* the total residual
(every levelled edge's error grows by its whole length times the angle) and
rejected it, multiplying λ by eight each time until the frame sat still.

So **a drag on a point some frame reads moves it outright**, and the same solve
then carries the drawing to it: one Gauss-Seidel sweep, exactly the cost
`frameBasis` said this trade costs. A datum is moved by the user; the solver
never gets a vote on where it goes. The weak kinematic pull is still applied
on top, so a frame's point that is *also* ordinary geometry keeps its
relations' say and the gesture degrades to the ordinary drag.

## A dimension is now its number

`dist("p1","p2",50)` used to put a `↔` on the drawing and the 50 nowhere.
In Onshape a dimension *is* its value — the number is the whole point of
dimensioning — so the three dimensioned relations now draw theirs: `50`
midway along the span, `R22` just outside the rim, `30°` at the corner two
lines share.

![A rectangle with a filleted top-left corner and a line running up and to the right from its top-right corner. Below the shape, a dashed dimension line with arrows at both ends runs the full width between two short witness lines, broken in the middle by a box reading 110; to the right of the shape the same arrangement runs vertically, reading 73. R22 sits beside the fillet arc, 30° sits at the corner where the sloping line leaves the rectangle, and the plain hor/ver marks sit beside each of them](docs/images/35-dimension-labels.png)

**A dimension label is a glyph, not a second overlay.** It anchors in world
space and offsets in screen pixels, hovers with the relation's name, lights
up what the relation constrains, drops that name in the command line when
clicked, disappears with `del`, and goes away with `glyphs(false)` — every
one of those because it is the same glyph, not because any of it was
written twice. The value comes out of `RelationEntry.args`, which keeps the
call as it was made, so nothing under the UI changed at all: no model
change, no journal change, no new relation kind.

![The same sketch with the cursor on the 110. The label's box, its dimension line, its arrows and the two corners it measures between are all amber, and the hover tag under it reads "r5  dist p3 p4 110"](docs/images/36-dimension-hover.png)

Three things a label needed that a mark did not:

- **A box the width of its text**, so aiming at `120.5` is not aiming at
  the 18px square a `○` gets. `halfW` is per glyph now and `glyphAt` reads
  it. `glyphs.ts` still has no canvas — it is a pure function of (model,
  view), which is what lets it be tested headless — so the width comes from
  a constant, `GLYPH_CHAR_W`, and an e2e test measures the browser's real
  monospace advance and fails if the two ever drift apart.
- **Room in a stacking row.** A row used to step by a fixed 17px; with a
  wide box in it that drew `—` (this edge is level) touching `110` (this
  edge is 110 long), which reads as *minus* 110. Rows now advance by each
  box's actual edges, with a label asking for a little daylight.
- **One label for `ang`, not two.** `∥` is drawn on both lines because one
  mark leaves "parallel to what" unanswered. The same angle written twice
  answers nothing, so the number goes once, at the shared corner, nudged
  along the bisector into the wedge. Two lines that share no corner still
  have an angle; it goes midway between their middles.

**Witness and dimension lines: kept, dashed.** The spec left this to
whichever read better in a browser, so both were built and photographed.
Solid, they were indistinguishable from the drawing — a `dist` across a
rectangle's diagonal drew what looked exactly like a diagonal edge that
does not exist. Dashed and dim they read as annotation, and that diagonal
is precisely where they earn their pixels: a `dist` need not lie along any
line, and without them a number floats in the middle of a sketch with
nothing saying which two points it belongs to.

Which *side* of an edge a dimension sits on is the argument order:
`dist("p3","p4")` and `dist("p4","p3")` are the same constraint and land on
opposite sides, which is how the screenshot above gets its dimensions
outside the shape.

**Two caveats, both deliberate.** `ang` is typed in radians and labelled in
degrees, because a drawing has said degrees since drawings existed — so a
label is not quite the thing you would retype, and that seam closes when
retargeting does. And **a value cannot be edited in place**: clicking one
inserts the relation's name, exactly as clicking any glyph does, and `del`
plus retype is still the way to change 50 to 60. Editing needs a way to
change a relation's target, which lives inside a residual closure; it is an
owner decision in `TODO.md`, not something to smuggle in behind a label.

---

## A tool can now say no out loud

`ToolContext` gained a `log` channel, filled in by the engine and routed to
the app's log pane. Before it a tool had two ways to refuse a gesture and
both were wrong: `fillet` *threw*, which reaches the page as an uncaught
error nobody sees explained, and `circle3` wrote a `console.warn` no user
ever reads. Both now put one line in the pane, in the same style as an
entry's error, and the gesture stays live exactly as before.

Headless — a tool driven directly in a test, with no pane and no user — the
old behaviours are kept deliberately: a real refusal still throws and an
advisory still warns, which is what keeps unit tests honest and is the same
convention `pick` set (a context provides what its environment has). Both
directions are pinned by tests, and the collinear-refusal e2e now asserts
the pane text instead of capturing console traffic.

---

## The 3-point circle tool

Onshape's *3 point circle*, with a mouse. Type `circle3`, click three times,
and a circle passes through all three.

| two clicks and the cursor — the dashed circumcircle, live | committed: one circle, three `oncircle`s, two inferred coincidences |
|---|---|
| ![A rectangle with its hor/ver marks. A dashed amber circle passes exactly through its top-left corner p1 and its bottom-right corner p3 and down past the cursor below the shape; small amber crosses sit on the two corners that have been clicked. The log reads "armed: rectangle" then "armed: circle3"](docs/images/33-circle3-preview.png) | ![The same rectangle, the circle now solid and pale, threading p1, p3 and a third point p7 below the shape, with its centre p8 inside. Small ring and dot marks sit at each of the three. The log shows rels() answering r1 hor l1 … r5 coin p5 p1, r6 coin p6 p3, r7 oncircle p5 c1, r8 oncircle p6 c1, r9 oncircle p7 c1](docs/images/34-circle3-solved.png) |

The right-hand log is the whole story of the feature. Nine relations, and the
last five were all made by three mouse clicks: two coincidences the tool
*inferred* because those clicks landed on existing corners, and the three
`oncircle`s that are the circle's entire definition.

**It is a composition, not a computation.** A tool that worked out the
circumcircle and then called `addCircle(centre, r)` would draw the same
picture and lose everything: the circle would merely have *matched* the three
points once. Because the constraints are real and stay, the circle follows
its rim points when they move, each relation wears a glyph, `rels()` lists
them, and any one of them can be deleted on its own. That is what
`docs/plans/free-entities.md` was for; this is it being spent.

- **Every click places a real point, through `placePoint`.** So all three
  carry snapping and inference, identically to the other tools — which is
  why "a 3-point circle through two existing corners" above needed no
  special case at all.
- **The whole gesture is one undo step.** Nothing is created until the third
  click, so the bracket the engine already puts around one pointer event
  covers the lot: one Ctrl+Z takes the circle, its three rim points and its
  five relations together. No engine change; the shape the rectangle tool
  set.
- **A collinear third click is refused rather than solved.** Three
  `oncircle`s on three points in a line are a system with no solution, so
  committing would put a `CONFLICT` header over a drawing that should never
  have been made and leave the user to undo it to find out why. The tool
  stays armed on the first two clicks, so aiming the third elsewhere just
  works. *Near*-collinear is the user's call and goes through: the threshold
  is a relative sine — an angle of about 1e-9 radians, the same form and
  number `intersect.ts` uses for parallel — so it means the same thing at
  every zoom and in every unit, which an area threshold would not.
- **The preview stops at a rim 1e6 pixels away.** Past that the arc sags less
  than a pixel across the window, so what would be drawn is a straight line;
  a preview that lies about what the next click will build is worse than no
  preview. The commit is unaffected.

*Known gap, worth naming:* the refusal is a `console.warn`, not a line in the
app's log pane. Nothing in the `Tool` interface can write there yet — `fillet`
reports a corner it cannot round by *throwing*, which reaches the page as an
uncaught error. Giving tools a way to speak is a follow-up on `TODO.md`.

---

## Drag an edge, a rim, an arc — not just a point

With nothing armed, a left-drag that starts on any geometry now drags it. That
was the last leftover from the old mouse map: a point dragged, and everything
else panned, because when the drag was built nothing better existed yet.
Onshape drags the edge, and now so does this.

**Dragging an entity is dragging every point it is made of by the same
offset** — expressed as a *target*, not as a move. Each governing point gets
one soft pull toward its grab-time position plus however far the cursor has
travelled, and the solver does the rest. Nothing new was needed:
`Problem.solve({extra})` and the 0.12 weight are the point drag's, and the
whole change is one exported function saying which points govern which entity
(a line: its two endpoints; a circle: its centre; an arc: centre, start, end).

| the constrained rectangle, before | the top edge dragged 90px up, mid-gesture | released, and exact |
|---|---|---|
| ![A rectangle 90 by 40 with constraint marks: an em dash on the top edge, a vertical bar on each upright, an em dash and a double-headed arrow at the bottom, and a # under the bottom-left corner p1. The log shows rels() listing r1 hor l1, r2 ver l2, r3 hor l3, r4 ver l4, r5 dist p1 p2 90, r6 fix p1](docs/images/29-edge-drag-before.png) | ![The same rectangle mid-drag with the mouse button still down: it is now roughly 90 by 70, the top edge having travelled up while the fixed bottom-left corner stayed on its mark. The uprights are still plumb and the top edge still level; the log is unchanged](docs/images/30-edge-drag-during.png) | ![The same taller rectangle after release. The log has gained solve() returning solved:true, maxResidual 2.386e-11, offenders empty — the drag left the model exactly satisfied, not approximately](docs/images/31-edge-drag-after.png) |

The middle frame is the interesting one: the cursor went up *and* 40px to the
right, and the rectangle only went up. `ver` on the uprights and `fix` on the
corner had their say, the sideways half of the pull lost, and the shape stayed
a rectangle throughout. That is the same trade the point drag has always made
— it is just that a whole edge is now making it.

**A rim drags the circle, it does not resize it.** Dragging a circle moves it
in Onshape too, and resizing is what `rad` and the centre-out `circle` tool are
for. The evidence is two `ls()` calls in one frame:

![A circle up and to the right of the rectangle, its centre p5 marked. The log shows two ls() calls: the first has p5 at (0.000, 70.000) and c1 with r=22.000, the second — after the circle was dragged by its rim — has p5 at (40.000, 56.667) and c1 still r=22.000](docs/images/32-rim-drag.png)

120px right and 40px down at scale 3 is 40 and 13.33 world units, which is
exactly where the centre went. The radius is the same to three decimals because
nothing pulled on it: an arc behaves the same way, its three points travelling
together and its radius following from `arcends` rather than being dragged.

Smaller things that came with it:

- **Single points use the offset form too**, so there is one code path rather
  than two. The side benefit is that a point grabbed a few pixels off-centre no
  longer jumps to the cursor as the drag starts.
- **Settling, cancel and undo are untouched.** A drag is one action whether it
  is released or escaped, and Escape still settles rather than dropping — the
  same reasoning as before.
- **The only left-drag that still pans** is a press that landed on a constraint
  glyph. A glyph is UI: it grabs nothing, having no position of its own, and it
  is not empty canvas either, so it must not draw a box.
- **No rigid rotation**, deliberately. Translation plus the solver is what
  Onshape's drag does; a rotation would need a second degree of freedom the
  gesture does not carry.

Two e2e assertions asserted the retired behaviour and now assert its reversal,
in the files that made the claim — `drag.e2e.ts` and `boxselect.e2e.ts`. The
new stories live in `test/e2e/edgedrag.e2e.ts`.

---

## `del` takes the whole box-select's worth

`del("p1", "l5", …)` — several names, one call, one undo step. Box select
puts eight names in the command line; making `del` take them is the other
half of that gesture. Three rules, each tested: every name is validated
**before** anything is removed, so a typo in the middle of a batch costs
nothing rather than half the batch; a name an earlier cascade already took
is skipped silently, because handing over a point *and* the line on it is
the normal shape of a box-selected batch, not a mistake; and the host
re-solve happens once, after the batch. Journalling needed no change at all
— a deletion was already recorded as its expansion, one entry per removal,
and a replay test pins that the batch form round-trips identically.

---

## `circle()` — a circle you have yet to define

The owner's complaint, in his words: *"It's weird if you want a circle not
defined by a center and radius but the tool requires it."* You can now say what
you actually mean:

```js
c = circle()
oncircle("p1", c); oncircle("p2", c); oncircle("p3", c)   // the 3-point circle
```

| `circle()` typed — a circle exists, defined by nothing yet | the three `oncircle`s, and it threads them exactly |
|---|---|
| ![Three points p1, p2 and p3, each wearing a # fix mark, scattered across the canvas. A small circle with its centre p4 sits by itself in the middle of the window, nowhere near them. The log reads c = circle() → c1 and rels() listing only the three fixes](docs/images/26-free-circle-seeded.png) | ![The same three points, now each wearing a # and a • on-circle mark, with one large circle passing exactly through all three and its centre p4 well to the right. The log adds r4, r5, r6 oncircle and then [[59.999999999, -10.000000000], 58.309518948]](docs/images/27-free-circle-solved.png) |

The last line of the right-hand log is the point of the whole thing. The
circumcircle of (10,−40), (110,−40) and (10,20) is centred (60, −10) with
radius √(50² + 30²) = 58.30951894845…; the solver reports (59.99999999986,
−10.00000000027) and 58.30951894833. Not "solved: true" — the closed form, to
ten digits, and **nobody typed `solve()`**.

**Nothing about existing calls changed meaning.** The insight the package rides
on is that a constructor argument here was never a constraint: `circ(centre, r)`
only *seeds* a radius variable and `pt(x, y)` pins nothing. The misfit was that
the arguments were mandatory. So every one of them is now optional, whatever is
missing is auto-created free, and old files replay untouched.

- **Auto-created pieces are real entities.** A free circle's centre is a
  named, visible, draggable, dimensionable point, exactly like a rectangle
  tool's corners. It answers to `ls()`, `rels()`, hover and `del`, and it
  outlives the circle when the circle is deleted, the same as a centre you
  placed by hand. Nothing downstream was taught anything.
- **A seed is never degenerate.** A free `line()`'s endpoints are 20 units
  apart, not coincident: a zero-length line has no direction and half the
  relation vocabulary — `tan`, `par`, `ang` — divides by that direction's
  length. A free `arc()` seeds as a quarter arc, and an auto-seeded arc below
  2D is refused rather than built flat.
- **Long names beside the short ones**: `point()`, `line()`, `circle()` next to
  `pt()`, `ln()`, `circ()`. A creator function and a tool share a name without
  trouble — a bare word arms the tool, a call is an expression — which `arc`
  and `fillet` have been quietly doing all along.
- **A free piece appears where you are looking**, not at the world origin. The
  middle of the window is read in the command layer and passed down as an
  ordinary coordinate; the model still has never heard of a viewport. Headless
  it falls back to the model's plain defaults.
- **The journal stays honest.** Each constructor records as *the one call that
  was made*, never its expansion, and re-expands deterministically on replay —
  so a `circle()`-then-constrain model reopens byte-identical, auto-names
  included, and the constraints still bite after a nudge.

A free line is held by nothing but what it touches:

![Two circles of different sizes, centres p1 and p2 both fix-marked, with radius marks on each. A single straight line runs from p3 at the upper-left rim of the small circle to p4 beyond the big one, grazing both — a tangency mark sits at each touch point. The log reads t = line(); tan(t,"c1"); tan(t,"c2"); dist("p3","p4",170), and rels() lists all seven](docs/images/28-free-line-tangent.png)

### Multiple solutions, honestly

Tangent + through-a-point + radius admits **up to four circles**, and this one
picks the branch nearest its seed. Dragging it flips branches. That is not
nondeterminism and it is not a bug — it is what Onshape does, and what any
least-squares sketcher does: the equations have several roots and the solver
returns the one it started closest to. The three-point circle above has no such
ambiguity, which is exactly why that is the example checked against a closed
form. Where a construction is ambiguous, the seed is the answer to "which one",
and moving a free piece before you constrain it is a legitimate way to choose.

Two things surfaced while writing the browser tests, both now pinned by the
tests that found them. `circ("p1", 6)` only *seeds* a radius, so "tangent to
two circles" with unpinned radii is satisfied by shrinking a circle onto the
line — the test says `rad()` too, and says why. And what counts as one undo
step is decided around a *submitted* entry, so a `del()` pushed straight into
the evaluator is not a step at all and the next `undo()` undoes the entry
before it.

**What this does not change: the pointer tools.** Drag-centre-to-rim is the
right *pointer* gesture and is Onshape's own. This is freedom on the command
surface; a 3-point-circle *tool* is now a trivial composition, and is on
`TODO.md` as enabled rather than built.

---

## Drag a box round it, and every name lands in the command line

Left-drag on empty canvas is now box select, with the direction of the drag
choosing what kind — the SolidWorks and Onshape convention exactly, because it
is one of the few gestures every CAD user already has in their hands.

| left → right: **window**, solid, only what is fully contained | right → left: **crossing**, dashed, anything it touches |
|---|---|
| ![A rectangle with its constraint marks, a circle to the upper right, and an edge running out of the rectangle's top-right corner to a point beyond. A solid-edged translucent blue box is drawn round the rectangle. The log below reads p1, p2, p3, p4, l1, l2, l3, l4, each "→ command line"](docs/images/24-window-box.png) | ![The same drawing with a dashed green box in the same place. The log reads the same eight names and then two more: l5 and c1 — the edge the box merely clipped, and the circle whose rim passes through it](docs/images/25-crossing-box.png) |

The two pictures are the same rectangle in the same place. The difference is
the last two lines of the log: `l5`, the edge the box only *clipped*, and `c1`,
the circle whose rim passes through the box while its centre sits outside. A
window box leaves both; a crossing box takes them.

**A box is a multi-click.** The names drop into the command line quoted and
comma-separated, exactly as clicking them one at a time would, which is what
keeps the "there is no selection set" decision intact under a feature that in
most CAD *is* the selection set. An empty box inserts nothing, Escape mid-drag
cancels, and a box started anywhere but empty canvas is not a box at all —
press a point and it still drags, press an edge and it still pans.

**Constraint glyphs are not box-selectable**, and that took no code: relations
live in a registry beside the entity map rather than in it, so a box never sees
them. A box that filled the command line with a dozen `r`-names nobody asked
for would be noise; the flow for relations stays hover-and-click.

The predicates live in the new `src/boxselect.ts`, screen-space and testable
without a canvas, on top of `intersect.ts` — so a box and a click cannot
disagree about where an arc stops. The one worth stating out loud: **a
rectangle wholly inside a circle touches nothing.** The entity is the rim, not
the disc, which is the same rule that makes clicking the middle of a circle
pick nothing.

**This reverses a decision in the register, deliberately and in the open.** The
register said left-drag on empty canvas pans, which was cellwork's habit; the
standing rule that tools work like Onshape outranks it. Panning lost nothing —
middle-drag, right-drag and `pan()` all still pan.

*Found while writing the browser story:* Escape was bound to the command input,
and pressing the mouse on the canvas blurs it (a canvas is not focusable), so
Escape was deaf during exactly the gestures it exists to abandon. It is on
`window` now, the same reasoning that already put Ctrl+Z there.

---

## What you type is solved, so the header is never a lie

A relation typed at the command line used to add its residual, redraw, and
leave the status readout saying whatever it said before — `SOLVED` over a
drawing that plainly violated the constraint just entered, until someone
thought to type `solve()`. The stale-readout family, third sighting, and found
the same way as the first two: by looking at a picture the numbers said was
fine.

**A command entry that changed the model now re-solves**, the way a tool, a
drag and `del` already did. Onshape's continuous solve, and cellwork's.

![The app with a level 80-unit edge and a circle above it. The header reads CONFLICT: rad(c1). The log shows every line that was typed — fix, hor, dist, circ, rad 25, rad 12 — and no solve() among them](docs/images/23-live-solve-conflict.png)

Nothing in the app enumerates which commands are edits, and nothing needed to:
**the answer was already being computed one line away.** The undo bracket
decides what counts as one step by snapshotting the model before an entry and
after it and comparing, which is exactly the question "did that change
anything". `endUserAction` now returns that comparison instead of swallowing
it. So `ls()`, `help()` and `2 + 2` cost nothing, an entry that throws costs
nothing, and every relation anyone ever adds — including one authored at the
command line five minutes from now — is covered without appearing on a list.

The picture above is the whole of the test: no `solve()` was typed, the
distance constraint was applied, and a second `rad` on the same circle flipped
the header to `CONFLICT` on the keystroke that caused it.
---

## The latest build now lives at a URL you can just open

`npm run build:single` (scripts/singlefile.mjs) folds the whole app — the
esbuild-bundled TypeScript, the page style and markup, and the WASM kernel
as base64 — into one self-contained `dist-single/neocad.html`, published as
a claude.ai artifact so the owner can review each merged change without
checking anything out. A small buildstamp (git short rev + date) sits in the
header so the page says which commit it is. The entry shim decodes the
embedded kernel and hands the bytes to `ensureKernelLoaded` *before*
importing `main.ts`, so the memoized loader never tries to fetch
`wasm-gen/` over the network — there is no network copy to fetch.

Known limitation, deliberate for now: the artifact viewer blocks
viewer-initiated downloads, so `download()` is inert there; `save()` /
`open(text)` (copy-paste persistence) work fine. *(Closed the same day:
the entry shim now bridges the anchor click into the viewer's
confirmed-save flow, so `download()` works in the artifact too.)* Verified before first
publish with a Playwright smoke run against the built file: draw a
rectangle, constrain it, `solve()` → SOLVED at 4 iterations, residual
4e-10, and the screenshot actually shows a rectangle with its glyphs.

---

## Where two curves cross is now a place you can click

The last gap in the snap vocabulary. Points, midpoints and along-a-curve
existed; the *crossing* — the place a draughtsman most often actually means —
did not. It slots between exact points and midpoints: an existing point still
wins outright (it is the thing itself), but a crossing beats a midpoint, which
is a property of one curve, and beats either curve alone.

| the × on a crossing, mid-gesture | clicked: one point, two relations | the line tilted, and the point rode it |
|---|---|---|
| ![A circle and a level edge crossing it, with the point tool armed. A small green × sits exactly where the edge meets the circle's right-hand rim, three pixels from where the cursor actually is](docs/images/20-intersection-snap.png) | ![The same drawing with p4 now placed on the crossing, wearing two small round marks side by side. The log reads: r4 oncircle p4 c1, r5 on p4 l1](docs/images/21-intersection-placed.png) | ![The same drawing after dragging the edge's left end down by 34 units. The circle has not moved; the edge now runs diagonally, and p4 has travelled down and right along the rim to sit exactly where the tilted edge cuts it, still wearing both marks. The header reads SOLVED](docs/images/22-intersection-ride.png) |

**The pairing is the feature, not the ×.** `placePoint` on an intersection
applies the on-curve relation for *each* curve — `on p4 l1` and
`oncircle p4 c1`, two ordinary relations with two names, two glyphs and two
`del`s. That is what makes the snapped point *stay* the crossing rather than
being a one-frame courtesy: the third picture is the same drawing after
dragging the edge's far end down, and p4 has ridden the intersection along the
rim. A point told only that it is on the line would have slid off the circle
the instant anything moved.

`Snap` therefore carries `targets: string[]` rather than a single `target`,
because an intersection is *about* two curves; `describeSnap` reads
`l1 × c2`.

**Degenerate cases return nothing, deliberately.** Parallel and collinear
lines, coincident and tangent circles, a tangent chord: all produce either no
crossing or a doubled one, and a doubled root is a *tangency*, which is already
its own relation. Manufacturing a crossing out of one would put a snap — and
two constraints — where the drawing says two curves touch rather than cross.
"Doubled" is judged on how far apart the two candidates are in pixels rather
than on a discriminant being exactly zero, because a tangency the solver
actually holds leaves its roots a thousandth of a pixel apart and an exact test
would never fire on real numbers.

The new `src/intersect.ts` holds the three closed forms (segment–segment,
segment–circle, circle–circle) and, moved down out of `picking.ts`, the
**arc-sweep test**. That move is the point of where the file sits: an
intersection has to agree with picking about where an arc stops, and two copies
of "is this angle on the arc" would eventually disagree about an arc's last few
pixels — giving a snap that cannot be clicked, or the reverse. The algebra is
in screen space, because everything that asks it a question asks in pixels and
the view transform is affine with a uniform scale, so the exact screen crossing
maps back to the exact world crossing.

Cost discipline, since candidates are recomputed on every cursor move: curves
are prefiltered on the distance the along-a-curve tier already computes, and
only the survivors are intersected pairwise. A crossing within tolerance of the
cursor lies on both its curves, so both curves are themselves within tolerance
— the prefilter cannot lose a candidate, and it turns a pairwise scan of the
drawing into a pairwise scan of the two or three curves under the hand.

## Constraints you can see without being told where to look

Every relation now wears a small mark beside the geometry it constrains. The
previous entry gave constraints names and put those names on the hover tag,
which answers "what is constraining this?" — but only once you have thought to
hover the right thing. A drawing wearing its glyphs answers it before you ask,
which is the point: the constraints most in need of announcing are exactly the
ones you did not type.

| a constrained drawing wearing its glyphs | hovering one, and the spread |
|---|---|
| ![Two rectangles and a circle. Small boxed marks sit beside the geometry: an em dash beside each level edge, a vertical bar beside each upright one, a hollow ring at the corner the two rectangles share, a double-headed arrow beside the left edge, a perpendicular sign twice, an "r" on the circle's upper-right rim and an arc mark where the circle touches the extension of a rectangle edge. The log shows solve() returning solved:true, maxResidual 2.4e-11, no offenders](docs/images/18-constraint-glyphs.png) | ![The same drawing with the cursor on the perpendicular mark above the top rectangle. That mark and its twin beside the second rectangle are both boxed in amber, the hover tag reads "r12 perp l1 l6", and the two lines it names — the top edge of one rectangle and the right edge of the other — are drawn in amber while everything else stays pale](docs/images/19-glyph-hover.png) |

**Hovering a mark lights up everything the constraint is about**, which is the
half that a tag alone cannot do. The right-hand picture is a perpendicularity
between two edges in two different rectangles: hover either of its marks and
both of them go amber, and so do both lines. Reading `perp l1 l6` off a tag and
then hunting for `l6` is a different and worse experience.

Otherwise glyphs invent nothing. Clicking one drops its name into the command
line exactly as clicking geometry does, so `del(` + click + `)` remains the
whole deletion flow. They are the **top picking tier** — above points, which
until now won outright — because a mark is small, deliberate to aim at, and
only ever where it is because something put it there; a glyph you cannot click
because a point wandered near it would defeat the feature. They take no part in
snapping, being UI rather than geometry. `glyphs(false)` empties the layer and
stops them being picked; `glyphs()` reports. Default on, as in an Onshape
sketch.

**Anchors are world-space; offsets are screen-space.** A mark belongs to a
place in the drawing and follows it through a solve or a drag, but sits a
constant number of pixels off that place at any zoom — the convention every
tolerance in this codebase already uses. Marks sharing an anchor stack in a
row, and that is the entire crowding story: a busy drawing *will* crowd, and
`glyphs(false)` is the v1 answer rather than a layout engine, which would bring
its own failure mode of labels jumping about as the model solves.

**On the symbols.** The spec proposed a table and left legibility to be judged
from screenshots rather than from the source, which turned out to matter. Each
candidate was rendered at the real 12px and inspected enlarged, and checked for
tofu by bitmap identity against a codepoint no font has (advance width tells
you nothing in a monospace stack — present and absent measure the same).
Nothing shipped as a tofu box, and four marks changed:

- `coin` is **`○`**, not the spec's `◦`: at 12px `◦` is two pixels across and
  reads as dirt on the screen. `coin` is the most common relation of all — it
  is the one inference produces — so it takes the crispest mark in the set.
- `on` / `oncircle` are **`●`**. The spec gave them the same `◦` as `coin`,
  which cannot be right: a point *lying on* something is a filled dot on that
  thing, and a hollow ring is two points sharing one place.
- `fix` is **`#`**, not `⚓`. The anchor is not tofu — it does render — but it
  is the densest mark of the lot and turns to mush at 12px. The spec offered
  both.
- `sym` is **`⇌`**, the standard equilibrium arrow.

Two relations had no mark in the spec's table and needed one, since a relation
that drew nothing would look like a constraint that does not exist: `dist`
(`↔`, between its two points) and `arcends` (`●` on each endpoint, since it is
literally two `onCircle`s). A relation authored at the command line — an op
nothing in `src/` has heard of — anchors on the first entity it names and takes
the op's first letter, for the same reason.

---

## Constraints you can see, name, and delete

Relations have names now — `r1`, `r2`, … alongside `p1` and `l1` — and `del`
removes one, with Onshape's cascade. This is the item inference made urgent:
a tool that constrains your drawing on your behalf hands you a constraint you
did not type, and until now you could not see it, list it, or take it back.

| the corner a tool constrained | the constraint deleted, the corners dragged apart | two undos later |
|---|---|---|
| ![Two rectangles meeting at a shared corner. The hover tag under the corner reads "p3 -60, 42 · r5", and the log below shows rels() output: r1 hor l1, r2 hor l3, r3 ver l2, r4 ver l4, r5 coin p5 p3, and four more](docs/images/15-relations-and-hover.png) | ![The same two rectangles, now separated — the upper one has been dragged up and left, and the corner they used to share is two corners in two places. The hover tag reads "p3 -86.667, 60.333" with no relation names after it. The log shows del("r5") answering [r5]](docs/images/16-constraint-deleted.png) | ![The rectangles are joined at the corner again and the hover tag reads "p3 -60, 42 · r5" once more. The log has gained two lines: "undid — 3 back, 1 forward" and "undid — 2 back, 2 forward"](docs/images/17-undone.png) |

Neither rectangle in the first picture was drawn with a constraint typed at
the command line. The second was started three pixels off the first's corner,
the tool inferred a coincidence, and `r5` is that inference with a name on it.
The hover tag names the relations constraining whatever is under the cursor,
`rels()` lists them all (`rels("p5")` lists the ones naming `p5`), and the
flow from noticing to removing needs no new interaction model: hover to see
`r7`, click to drop the name into the command line, type `del("r7")`.

**The middle picture is the point.** A constraint removed from a list and a
constraint removed from the *problem* look identical until something pulls on
it. Drag the corner after `del("r5")` and the rectangles come apart, which is
the only way to see that a residual block really left the solver.

**The cascade is Onshape's**, deliberately, so that people arrive knowing it:
a relation takes nothing else with it; a point takes everything that
references it — a line's endpoint, a circle's centre, an arc's centre or ends
— recursively, and every relation naming any of them; a line, circle or arc
takes the relations naming it and leaves its points, which were the drawing's
points first. `del` returns the names it removed, so the log answers "what did
that just take with it".

**And there is no "are you sure?", because undo is the confirmation.** `del`
is one user action, one Ctrl+Z from harmless — the pattern `open()` already
set. The third picture is two keystrokes after the second: geometry, journal
and registry all back, byte-for-byte identical to `save()` before the
deletion.

Underneath: `Problem.addResidual` now returns a monotonic `BlockHandle` and
`Problem.removeBlock` spends it, blocks being stored as `{ id, block }` so a
removal never shifts another block's identity. `Model` gained a relation
registry and one wrapper, `model.relation(op, args, body)`, which every
function in `relations/` is now a single call to. Deletions are journalled as
their expansion — `deleteEntity` / `deleteRelation`, one per name — so a
reopened file removes exactly what was removed rather than recomputing a
cascade against a model that may have been built differently since. Old files
carry neither op and open unchanged.

**A bug the registry flushed out on the way past:** `concentric` and
`arcEndpoints` are defined in terms of `coincident` and `onCircle`, and both
calls used to journal, so reopening a file containing either quietly added the
inner constraint a *second* time. A relation defined in terms of another is
now one relation — the inner call's blocks join the outer entry and it
journals nothing.

**Documented, not fixed:** a deleted point's variables stay in the flat
vector, referenced by nothing. Orphans take part in no residual, so the solve
leaves them exactly where they are — they cost memory, not correctness — and a
save/reopen does not shed them either, since replay re-runs the same creates
and deletes. Compaction means remapping every captured index list in every
closure, which is a different piece of work with a different risk profile.

## Undo and redo

Ctrl+Z, at last. **Ctrl+Z / Cmd+Z** undoes, **Ctrl+Shift+Z** and **Ctrl+Y**
redo, and `undo()` / `redo()` are ordinary commands doing exactly the same
thing through the same handle.

| three actions | one Ctrl+Z | two Ctrl+Z |
|---|---|---|
| ![A filleted rectangle. The log below reads: rectangle armed, then fillet("l1","l2",12). The drawing is 290 by 135 screen pixels with a rounded top-right corner, and p3 sits at the bottom right where a mouse drag left it](docs/images/12-undo-three-actions.png) | ![The same drawing from the same viewpoint, taller and narrower — p3 is back where the rectangle tool put it. The rounded corner is still there. The log has gained one line: "undid — 2 back, 1 forward"](docs/images/13-undo-once.png) | ![The same rectangle again, now with a square top-right corner: the arc and its two tangent points are gone and the four corners p1–p4 are all that is left. The log reads "undid — 1 back, 2 forward"](docs/images/14-undo-twice.png) |

Three things were done to that drawing: the **rectangle tool** was dragged out
with the mouse, `fillet("l1","l2",12)` was typed, and then **`p3` was dragged**
with the mouse. Three keystrokes walk back through them one at a time, in that
order — and the third action is the one to look at hardest, because a drag
journals nothing and logs nothing, so in the first frame it exists only as
geometry. Undo puts it back all the same. The counter in the log ("*N* back,
*M* forward") is the stack saying where in the history it now is.

**Snapshots, not journal cleverness.** The journal invites a smarter design —
undo a structural change by truncating the journal and replaying it — and it is
the wrong one: value-only changes like a drag are never journalled, so that
design needs value snapshots *as well*, and the hybrid is more machinery than
either half of it. Instead the stack holds whole models in the format the repo
already had: the text `save()` writes, which carries the journal *and* the
solved coordinates, restores through the same path `open()` uses, and compares
for equality as a string. One representation does both jobs, and `src/undo.ts`
ends up being a stack and nothing else — it imports nothing at all.

**One step is one thing the user did**, which is a question about the interface
and is therefore answered in `main.ts`, by one comparison: snapshot before the
action, snapshot after, record a step only if they differ. Nothing enumerates
which commands are edits — `ls()` and `help()` stay out of the history because
they leave the model identical, not because they are on a list. A command entry
is one step (so an entry that draws four points is one Ctrl+Z), a tool
commit is one step, a completed drag is one step, and opening a file is one
step, so opening the wrong one is one Ctrl+Z from harmless.

**The engine still does not know undo exists.** It gained a single callback,
`onUserAction("before" | "after")`, fired around a press or release handed to an
armed tool and around a drag from its first moving frame to its settling solve.
That is a neutral fact about a gesture rather than anything to do with history;
the engine sits below undo in the layering, and this is what it is entitled to
say. Cancelling a drag with Escape closes the action like a release does,
because a cancelled drag *is* a settled drag and leaves the same geometry
behind.

**The one carve-out: while the command line holds uncommitted text, Ctrl+Z is
the browser's** and edits the text. A half-typed command on screen makes the
keystroke genuinely ambiguous, and undoing the drawing out from under someone
mid-sentence is the worse of the two wrong answers; an empty input is the
signal that the keystroke is meant for the model.

**Deliberately not saved.** History is per-session: it lives in memory, and a
reopened file starts with an empty stack. Restoring is a full replay of a saved
model, so undo through a large drawing costs what opening it costs — fine at
this size, and the thing to measure first if it ever is not.

## Dragging geometry

The interaction the solver was built for: with nothing armed, press on a point
and pull. The geometry follows the cursor *while every constraint holds*.

| before | during |
|---|---|
| ![A rectangle 80 by 60, built from the four commands visible in the log below it: four points, four lines, hor/ver on each edge, and a fix on the bottom-left corner p1](docs/images/10-drag-before.png) | ![The same drawing from the same viewpoint, with p3 dragged up and to the right. p1 has not moved by a pixel; p2 has followed in x and p4 in y; all four edges are still exactly level or plumb](docs/images/11-drag-after.png) |

The right-hand frame is from the *middle* of the gesture, with the button still
down — same viewport, same grid, so the two can be flipped between. `p1` is
pinned by a `fix` and has not moved by a pixel. `p3` is the corner being
dragged. `p2` and `p4` were not touched by the cursor at all and moved anyway,
because `hor` and `ver` on the edges say they must: that is the whole feature
in one picture, and it is what makes this a *kinematic* drag rather than moving
a point.

**The mechanism is a residual that lasts one solve.** `Problem.solve()` now
takes `extra?: ResidualBlock[]`: blocks evaluated alongside the stored ones at
every iteration of that solve, added to nothing, gone when it returns. Each
pointer move solves with a soft pull toward the cursor — `(x - cursor.x) *
0.12` per coordinate, cellwork's weight — and renders. Release runs one
ordinary solve without the pull, which is what settles the model and updates
the header. The weight is the whole feel of the thing: small enough that a real
constraint wins outright, large enough that geometry nothing constrains sits
under the cursor exactly.

**A soft pull may never accuse.** Extras are excluded from the offender report
and from `maxResidual`, because a residual that never reaches zero is doing
what it was asked to do, and letting it into the report would paint `CONFLICT`
across the header for the duration of every drag.

**What the tests caught, and it is arithmetic rather than a bug:** least
squares weighs everything at once, so a cursor dragged far past where a point
can follow does not stall against the constraints — it trades against them, and
the drawing goes slightly out of true for as long as the button is held (at w =
0.12, the overshoot divided by about 71). In ordinary use the cursor is a pixel
or two from the point it is pulling and this is invisible. It is nonetheless
the reason intermediate frames never touch the status line, and the reason
release solves again: that solve puts everything back to 1e-6.

A **`fix`ed point needs no special case** — the pull loses to the fix residuals
and the point stays put, which falls out of the mathematics rather than being
checked for. And **nothing is journalled**: a drag changes values, not
structure, and a saved file already carries solved coordinates, so a dragged
drawing round-trips through save/open unchanged.

**Abandoning a drag settles it.** `Escape` mid-gesture cannot put the geometry
back — nothing here has undo yet — but it must not leave the cursor's pull
baked into the drawing either, with the header still reading whatever it did
before the gesture began. So `cancel()` ends a drag the same way releasing the
button does: one ordinary solve, through the host's path.

Deliberately not in this version, each a known difference from Onshape and each
a follow-up rather than an oversight: **only points drag** (press an edge or a
rim and it still pans, exactly as before); **no inference or snapping while
dragging**, which Onshape does do; and **no undo**, because nothing here has
undo yet — for now a drag is undone by dragging back.

Eleven new unit tests and six new end-to-end ones, the latter including the two
gestures dragging shares its button with: a press that does not move is still a
pick, and a press that is not on a point still pans. 135 unit, 3 kernel, 63 e2e.

## The line tool

Point, rectangle, circle, arc, fillet — and, until now, not the most basic
tool in any sketcher. `line` is click-click, chaining, Onshape-shaped.

![Two committed segments — one upright, one at an angle — with a third in progress: its preview locked exactly level and a faint dashed guide running the width of the canvas through the vertex it starts from](docs/images/09-line-tool.png)

**The chain shares its vertices.** The end of a committed segment *is* the
start of the next one — the same point entity, not a copy joined by a
constraint. There is nothing to infer between them: they are one vertex, as
chained segments are in Onshape. Drag it and both segments follow, because
there is only one thing there to drag.

**Nothing is committed on the first click**, so a chain abandoned before its
second click leaves no stray point behind — the same reason the rectangle
tool builds nothing until `onUp`. `Escape` ends the chain; what was committed
stays.

**Horizontal and vertical are inferred.** Within 3° of an axis the preview is
drawn exactly on it, with the guide in the screenshot above, and the committed
line gets `hor(line)` or `ver(line)` — the line form, so it still means "this
edge is level" after a fillet re-points the edge. Further off than that,
nothing is inferred and nothing is straightened: the middle segment in the
picture is at an angle and stayed there.

An **endpoint snap beats the axis guess**. If the click landed on real
geometry, that is what was aimed at, and quietly sliding it onto an axis would
undo a deliberate aim — so the snap wins, and the axis constraint comes along
only when the snapped position satisfies it anyway.

The chain itself is dimension-generic — it is only points and lines — so the
tool works unchanged in a 3D model and simply infers no axis there, `hor`/`ver`
being genuinely 2D-only. Writing that test earned its keep immediately: it
caught a degeneracy check that measured only the first two coordinates, and so
refused every segment that moved in z alone.

---

## Constraint inference

Snapping made a click land exactly on a corner. Inference is the step that
makes it *mean* that corner: when a tool places a point on existing geometry
it now applies the relation that implies, and the shapes are genuinely joined.

![Two rectangles drawn with the mouse, meeting at a single shared corner, with the log below showing the constraint the tool applied: coincident("p5", "p3")](docs/images/08-inference.png)

Onshape calls this *inferencing*, SolidWorks calls it automatic sketch
relations, and the behaviour here is deliberately theirs rather than invented:

| what you clicked | what you get |
|---|---|
| an existing point | `coin(new, that point)` |
| the middle of an edge | `mid(new, that line)` — the line form |
| somewhere along a line | `on(new, that line)` |
| somewhere on a rim | `oncircle(new, that circle or arc)` |

The screenshot above is the acceptance test that defined "done": rectangle B
was drawn with a mouse drag starting three pixels off rectangle A's corner,
and A's corner has since been moved with `fix`. B's corner came with it —
before this change two points sat at identical coordinates, unconnected, and
moving one left the other behind.

Two points, one constraint. **Nothing is merged**: the new point is a new
point, and the constraint is an ordinary one the user could have typed and
will be able to delete once constraint deletion exists. Inference is
downstream of snapping rather than beside it, so `snapping(false)` turns off
both — one switch, as in Onshape, not two.

The mechanics are small: `PointerInfo` now carries the `Snap` the engine used
alongside the coordinate it produced, and `placePoint` (`src/tools/place.ts`)
is the one place that turns a snap into a relation. A tool that ignores the
new field behaves exactly as before; the point, rectangle, circle and arc
tools go through the helper. The rectangle keeps the whole first `PointerInfo`
from `onDown` rather than only its coordinate, since by `onUp` that snap is
the only record of what the gesture was started *on*; its two derived corners
get nothing, because nothing was clicked there.

`midpoint` gained the line form it was missing — `mid(m, "l1")` beside
`mid(m, "a", "b")` — resolving the line's endpoints lazily, the same
distinction `hor`/`ver` already drew and for the same reason: a midpoint snap
means "the middle of this edge", which has to survive a fillet re-pointing it.
Both forms save and reopen as the form they were called in.

One thing worth knowing, because it looks like a bug and is not: a coincident
constraint between two *free* points does not make one follow the other on
solve — least squares moves both and meets in the middle. Pin one (`fix`, or
another constraint) and the other follows exactly. The tests do that rather
than asserting a direction the mathematics never promised.

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
