# Plan: extrude on a frameless sketch makes its own plane

**Status: queued** (2026-10-29). From the owner's screenshot and question
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
- **The typed commands match.** `extrude("l1", 20)` typed with a frameless
  loop does the same: the operation makes the frame inside its own
  `asOperation`? No — a frame must exist before the extrude entry for a
  replay to find it. Keep the two-call shape: the *command layer*'s
  `extrude`/`revolve` (in `replenv.ts`) make the frame as their own journaled
  call first and then call the operation with it, exactly as the tool does.
  `operations.ts`'s `extrude` keeps refusing a frameless profile — the
  refusal becomes the guard that the layer above did its job, and its text
  can stay.
- **Which three points, which way up**: `sketchFrameFor`'s rule, with
  `toward` = the view's line of sight in the app and the loop's own normal
  (whichever side has a positive component along the kernel's +z, as
  `loops.ts` already picks a normal) at the command line with no view. The
  depth's sign then means what it means today: positive along the frame's
  +z, which in the app is toward the viewer.
- **The default frame**: set to the new frame only when the model had no
  default (the case here). A model with a default frame that is merely not
  parallel keeps its default; the new frame is just the sketch's.
- **The message**, for the one case left — a loop that no three points can
  make a plane of — keeps `sketchFrameFor`'s own words.

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
