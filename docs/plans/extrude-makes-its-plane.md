# Plan: extrude on a frameless sketch makes its own plane

**Status: built** (2026-10-29) — `orientingFrame`, `extrudeNeedsFrame`,
`revolveNeedsFrame` and `checkRevolveRegion` in `src/operations.ts`,
`featurePlaneCommand` in `src/sketchface.ts`, the tools in
`src/tools/extrude.ts` and `revolve.ts`, `ToolContext.run`/`act`/`log` in
`src/tools/tool.ts` and `engine.ts`, two lines of `src/main.ts`, `plane`'s
option and the command-layer `extrude`/`revolve` in `src/replenv.ts`;
`test/extrudeplane.test.ts` and `test/e2e/extrudeplane.e2e.ts`. Deviations,
each marked ⚠ where the text below was written before the code (and in the
register's 3D entry): the tool **waits for the typed plane** and extrudes in
an undo step of its own (`ToolContext.act`, new; `run` now settles), because a
typed line runs asynchronously; beside a default it keeps, the tool types
**`frame(a, b, c)`**, not `plane`; the tools **log what they made** (`e1
extrude of …`, a new `"done"` outcome of `ToolContext.log`), which is what puts
`e1` in the log; the command layer **checks every refusal that needs no frame
before making one** (revolve's geometry against the loop's own plane), so a
refused call leaves nothing behind; and the headless normal is loops.ts's
(largest component positive), which is +z only for a loop within 45° of level.

From the owner's screenshot and question
(*"how does extrude work? i don't really understand this"*): a rectangle
drawn in a fresh model, `extrude` armed, a click inside, and the log says
*"the loop of l1,l4,l3,l2 lies in no frame's plane, and no frame is parallel
to it — an extrude runs along a sketch frame's +z: make one on its plane
(plane(…), or Sketch on this) and extrude again"*, eight times. He never
got a solid. Read `CLAUDE.md`, `docs/plans/3d-phase4-extrude.md`,
`sketch-on-face.md` (as built), `src/operations.ts` (`extrude`, `revolve`,
`foundProfile`, `sketchFrameOf`, the refusal above), `src/sketchface.ts`
(`sketchFrameFor`, `sketchOnFaceCommand`), `src/tools/extrude.ts`,
`src/tools/revolve.ts`, `src/tools/sketch.ts`, `src/replenv.ts`'s `plane`,
and the register's "no world frame" and 3D entries in `TODO.md`.

## Why the refusal was right and still wrong

The register's rule stands: an extrude reads its direction off a frame, and
inventing a world datum nobody chose would be the origin the owner removed.
But **a frame on the loop's own plane, from three of the loop's own points,
is not a datum nobody chose** — it is exactly what "Sketch on this face"
makes (`sketchFrameFor`: a corner and its neighbours, +z toward the viewer),
it journals as an ordinary `frame(a, b, c)`, and it follows the sketch as a
datum. The refusal asked the user to do by hand what the app already knows
how to do. So: **when no frame lies in or parallel to the profile's plane,
extrude (and revolve) make one from the loop's points, make it the default
if there was none, and carry on.** A first-run user draws a rectangle and
clicks extrude, and gets a solid.

## Design

- **The tool types what it does.** The extrude and revolve tools, finding
  the profile frameless, first type `plane(a, b, c)` through `ctx.run` — the
  sketch tool's seam, the line a user could have typed — and then their
  operation with that frame. Two journal entries, both ordinary, nothing new
  to replay; the log shows the plane being made so the user learns the
  vocabulary. `plane`'s `lookAt` would turn the camera square-on at the
  moment of the click, which is a jolt in the middle of an extrude: give
  `plane` (or the tool) a way to make the frame and set the default
  *without* turning the view, and use it here — the view stays where the
  user left it. (If `plane` grows an option, say so in `help()`.)
  ⚠ *As built: `plane(a, b, c, { look: false })`, in `help()`. "Two journal
  entries" is three where there was no default — `addFrame`,
  `setDefaultFrame`, `extrude` — and two **undo steps**, the plane's and the
  solid's. They could not be one breath: the host's `submit` is async (the REPL
  evaluates in an `AsyncFunction`), so the plane runs synchronously but its
  undo bracket closes a microtask later, and an extrude made straight after
  `ctx.run` returned landed inside it — one Ctrl+Z took both, and the log put
  `f1` after the solid's line (measured: with the extrude made synchronously,
  the e2e's first Ctrl+Z leaves no plane, and its log assertion fails). So
  `run` now settles once the line has run, and the tool extrudes in `ctx.act`
  (new: the engine's own bracket, outside the pointer event). Beside a default it keeps, the tool types `frame(a, b, c)`,
  since `plane` always sets the default. And the tools now log what they made,
  `e1  extrude of …` (`describeFeature`, a `"done"` line shown as an answer,
  not an error) — every commit, not only these, or the log would say `e1` for
  one click and nothing for the next. Headless, with no `run`, a frameless
  region is refused by the operation exactly as before.*
- **The typed commands match.** `extrude("l1", 20)` typed with a frameless
  loop does the same: the operation makes the frame inside its own
  `asOperation`? No — a frame must exist before the extrude entry for a
  replay to find it. Keep the two-call shape: the *command layer*'s
  `extrude`/`revolve` (in `replenv.ts`) make the frame as their own journaled
  call first and then call the operation with it, exactly as the tool does.
  `operations.ts`'s `extrude` keeps refusing a frameless profile — the
  refusal becomes the guard that the layer above did its job, and its text
  can stay.
  ⚠ *As built, the frame must not be made for a call that is then refused, so
  the command layer asks first (`extrudeNeedsFrame`, `revolveNeedsFrame`):
  every refusal that needs no frame — the depth or angle, the member, the
  axis's name, no loop or several — and, for revolve, the geometric ones
  (axis in the plane, profile on one side) asked of the loop's own plane
  (`checkRevolveRegion`; the revolve tool asks it too before typing). Typed, it
  is one entry and so one undo step, frame and solid together.*
- **Which three points, which way up**: `sketchFrameFor`'s rule, with
  `toward` = the view's line of sight in the app and the loop's own normal
  (whichever side has a positive component along the kernel's +z, as
  `loops.ts` already picks a normal) at the command line with no view. The
  depth's sign then means what it means today: positive along the frame's
  +z, which in the app is toward the viewer.
  ⚠ *As built: loops.ts does not pick the +z side — it picks the normal whose
  **largest** component is positive (`orientPlane`), and that is what is used
  headless; it is the +z side only for a loop within 45° of level. A sketch
  standing in the x–z plane extrudes along +y. Tested.*
- **The default frame**: set to the new frame only when the model had no
  default (the case here). A model with a default frame that is merely not
  parallel keeps its default; the new frame is just the sketch's.
- **The message**, for the one case left — a loop that no three points can
  make a plane of — keeps `sketchFrameFor`'s own words.
  ⚠ *As built, one more case left with its words: a loop seen exactly edge-on
  (cosine below 1e-9), where neither side faces the viewer. `loopAt` never
  hands the tool one; a typed call in a view that happens to be exactly
  edge-on is refused, saying to turn the view.*

## Verification

Unit: typed `extrude` on a frameless rectangle makes a frame from its
points, sets it default, extrudes along it, and journals `frame`/`plane` then
`extrude`; replay reproduces the names; a model with a non-parallel default
keeps it; revolve likewise; the sign of a positive depth. E2e, the owner's
sequence exactly: fresh model, rectangle tool, extrude tool, click inside —
a solid appears, the log shows the plane line and `e1`, the view did not
turn; then undo twice brings the rectangle back frameless. LOOK at the
screenshot. Full `npm run test:all`. Docs per `CLAUDE.md`: CHANGELOG at the
top quoting the owner's question and the log line; the register's 3D entry
and the "no world frame" entry noting that a frame from a loop's own points
is not a world datum; STATUS; `help()` under extrude; this file marked built.

## Delivery

Isolated worktree, branch `claude/extrude-makes-plane` off the working-branch
tip, one PR against `claude/resume-tasks-o7q02e`. Do not merge; the
supervising session reviews.
