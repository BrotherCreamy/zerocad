# Plan: a circle is just a circle — curves carry their own orientation, and nothing makes a frame for you

**Status: built** (2026-11-04) — see *As built* at the end, every deviation
there and in TODO.md's Done entry. The owner, twice: *"why when I create
something, why does it first create a frame? do I need to create a frame? can
I not just create a circle or whatever in space?"* and *"why everything need
frame? why can not just put circle right there?"* — and *"a frame should be
coloured … use rgb colours like solidworks"* (built: `tooltips-rgb-frames.md`).

## What is true today, and why

A point and a line need no frame. A **circle or an arc** does need an
orientation in 3D — "radius 10 about this point" is ambiguous until it says
which way it faces — and the code takes that orientation from a frame: a
`CircleEntity`/`ArcEntity` carries `plane?: string`, a frame's name, and
`curveplane.ts` (`curveFrame`, `curvePlaneOf`, `framePlaneAxes`) answers every
question about a curve's plane through that frame; an arc's sweep is measured
about the frame's +z from its +x. When no default frame exists, the curve
tools **make one** at the click (`place.ts`'s `CurvePlane`, the arc3/circle3
tools: "no default frame, so f1 was made at the view centre, facing you"),
**extrude and revolve make one** for a profile no frame orients
(`extrude-makes-its-plane.md`, `featurePlaneCommand`), and **sketch on face
makes one** on the face (`sketchface.ts`). There is no world frame
(`coordinate-frames.md`): a document starts with none.

Read `CLAUDE.md`, `docs/ARCHITECTURE.md`, `coordinate-frames.md`,
`extrude-makes-its-plane.md`, `sketch-on-face.md`, `curvetoolplane` tests,
`src/model.ts` (the entities, `defaultFrame`), `src/curveplane.ts`,
`src/arcgeom.ts`, `src/relations/` (everything that reads a curve's frame:
radius, tangent, onCircle, arc endpoints, `refs.ts`), `src/loops.ts` (a
loop's plane), `src/operations.ts` (fillet, extrude, revolve, regeneration,
the lid twins' curves), `src/faces.ts`, `src/sketchface.ts`,
`src/workplane.ts`, `src/tools/place.ts` and the curve tools, `src/persist.ts`
(format, replay, expansion markers), `src/planetranslation.ts`, and the tests
for all of them. This is the deepest change in a while: plan before editing,
and keep the suite green between commits.

## Design

- **A circle or an arc carries its own normal.** Its orientation is part of
  the entity — solver variables like its radius (choose the representation:
  a unit vector held by a non-squared normalisation residual, or two angles;
  say why; never a residual that is already a square, CLAUDE.md). An arc's
  sweep is about its own normal, from its start point, so it needs no
  reference axis. `curveplane.ts` answers from the curve itself; nothing asks
  a frame what plane a curve is in. Dimension-generic where it can be; a 2D
  model's curves have the trivial normal.
- **Where a drawn curve lies** is where the click is: on the **face under the
  cursor** (a solid's face, its plane), else on the **work plane** — the
  origin's xy plane by default, or whatever plane the user has made the work
  plane. The curve is held there by **ordinary, visible, deletable
  relations** — its centre on the plane, its normal parallel to the plane's
  normal — the same kind of relation that holds a point on a plane today.
  Delete them and the circle is free to turn in space; constrain it to a line
  instead and it follows the line. That is the owner's "just put the circle
  right there", in a flat relational model: no container, only relations.
- **One origin, always present.** Every document has a fixed **origin**
  datum — a point and three axes, drawn in RGB like any frame
  (`AXIS_INKS`), referable by name (`origin`, `origin.x`, …) wherever a frame
  is, never solved, never deleted, not journalled (it is part of every model,
  as the kernel's axes are). Recommended as a built-in fixed datum rather
  than a journalled entity, so old files and new documents agree without a
  replay step; say what you chose and why. A bare `xaxis()` means the work
  plane's when one is set, else the origin's.
- **Nothing makes a frame unless asked.** The curve tools stop making one.
  **Extrude and revolve** take a profile's plane from its curves (a loop's
  plane, `loops.ts`, already knows it) and extrude along that plane's normal
  — no frame is made for a frameless region. **Sketch on face** sets the work
  plane to the face (document state, journalled, a reference to the face —
  not a new entity), so what is drawn next lies on it. `frame(...)` and
  `plane(...)` still make frames, as datums the user wants.
- **Old files** open as they were: a curve recorded with a frame gets its
  normal from that frame and the parallel relation to it, so it still
  follows the frame; a feature made with an auto-created frame keeps it (it
  is real now, and other things may be constrained to it). Use the format's
  expansion markers as features do; bump the format if a journal's meaning
  changes. Prove it with fixtures from before the change, not assertions.

## Out of scope (next, in this order)

- One circle tool and one arc tool, the method read from the gesture (the
  owner: *"why are there multiple circle tools and arc tools? … surely just one
  tool, but different ways to set constraints"*). It reworks the same tools,
  so it follows this.
- Faces, surfaces and solids as typed objects that enforce their rules (the
  owner's direction; "region" retires into "face").

## Tests

Unit: a circle's normal solves and holds; a circle drawn on the work plane has
its centre-on-plane and parallel relations, and deleting the parallel lets it
turn; a circle drawn on a solid's face lies in it; an arc's sweep is about its
own normal (3D, tilted); every relation that read a curve's frame reads the
curve (3D tests, not comments); fillet, extrude, revolve and regeneration of
frameless profiles; the origin exists in every model and cannot be deleted;
**old files open and regenerate to the same geometry** (fixtures from the
current format); save/open round-trips.

E2E: on a fresh document, drawing a circle makes **one circle and no frame**
(the model's entity kinds), lying on the origin's plane; drawing on a solid's
top face puts it on the face; extruding a frameless rectangle makes no frame;
sketch on face then draw lies on the face; the origin is drawn in RGB at
start; every existing e2e passes (many create frames on purpose; keep their
claims, change their setup only where the auto-frame was incidental, and say
where). LOOK at a fresh document, a circle on the ground, one on a face.

## Docs

CHANGELOG at the top quoting the owner; the register (curves carry their own
normal; the origin is always present; nothing makes a frame unless asked;
sketch on face sets the work plane) as vetoable — note it revises
`coordinate-frames.md`'s "there is no world frame" and
`extrude-makes-its-plane.md`; STATUS; ARCHITECTURE (the curve-plane
question's new answer); README; `help()`; the spec marked built.

## As built (2026-11-04)

Built on `claude/frameless-curves`. What was chosen where the spec left a
choice, and every place it was not followed to the letter:

- **The normal is three variables read normalised — neither option the spec
  offered.** Not a unit vector held by a normalisation residual: that would
  be an equation the entity carries, and equations live in relations; and
  not two angles, which have a pole where one angle's gradient vanishes — a
  circle facing straight up, the commonest one, would sit on it. Every
  residual reads the normal through `unitDuals` (v / |v|), so it is
  scale-free: the length is a gauge with exactly zero gradient, the damped
  solve leaves it where it was seeded, and no relation can satisfy itself by
  shrinking it. Saved as `values.normals`. A collapsed normal (length under
  1e-12, only reachable by setting it there) reads as zero and its relations
  degrade to trivially satisfied, as a collapsed frame's do.
- **The origin is built in, as recommended**: `ORIGIN = "origin"`, no entity,
  not journalled, a constant basis in `frameBasis`. `Model.has("origin")` is
  true, so nothing else can be given the name; `isFrame`, `requireFrame`,
  `frameNames` (it first), `resolveFrame` (its fallback) and the menu know
  it; `del` and `deleteEntity` refuse it. It exists wherever frames do (2D
  and 3D models). Drawn by `main.ts` after every frame entity, and picked
  last among frames so a frame of the user's at the same place wins.
- **A file that already called something `origin`** (format 12 or older) has
  it renamed to the first free `origin2`, … everywhere the file says it,
  rather than refused or confused with the built-in.
- **`xaxis()` with a work plane set**: the work plane's when the work plane
  is a frame; a work plane that is a curve or three points has no named x,
  so `xaxis()` stays the default frame's, else the origin's.
- **Where a curve lies**: the work plane when one is chosen (`workplane` or a
  default frame) — chosen planes win over the face under the cursor, so a
  sketch on a face is not undone by the next click landing on another face;
  else the solid face under the first click; else the origin's ground. The
  face is `sketchFrameFor`'s three points (or the circle, for a round lid),
  facing the viewer, the same plane reference sketch on face uses. A plain
  sketch loop is not a face for this — drawing over a rectangle on the
  ground draws on the ground, which is the same plane.
- **The hold**: `onPlane(centre, ref)` (skipped when a snap already holds
  it there) and `par(curve, normal)` — `"f.z"` for a frame,
  the curve or the triple itself otherwise (`directionOf` reads a triple as
  its plane's normal, as a datum). On the bare ground both are written
  against `origin`: the spec's "visible, deletable" relations. Points the
  other tools place on the ground are *not* held (as before, when no frame
  was chosen): a rectangle in a fresh document is free.
- **Sketch on face** types `workplane("p1.p2.p3")` — or
  `workplane("c3")` on a round face — and looks at it square-on, as
  `plane(…)` did. The reference is three of the face's own points, not a
  face id (faces are not entities): it follows the solid, and deleting a
  point it names clears the work plane with a journalled
  `setWorkPlane(null)`. `setDefaultFrame` clears it too (choosing a frame is
  choosing a plane).
- **Extrude and revolve** run along `orientingPlane`: the drawing plane if
  the loop lies in it, else the frame its curves were drawn on, else a
  parallel frame (the user's first, the origin last), else three of the
  loop's own corners facing the viewer. None is made. A feature's `frame`
  field is that plane reference, a datum: a triple's points are read and
  never pushed. **A revolve makes no end frames** (expansion 11); 9 and 10
  stay for old files, and a partial revolve of an old file keeps its frames.
- **Fillet** takes an optional side vector instead of a plane: the drawing
  plane's normal when the corner is parallel to it, else the corner's own
  normal on the side of its largest component. A 3D fillet journals
  `fillet(l1, l2, r, [x, y, z])`; an old file's `fillet(…, "f")` has its
  frame's +z as the side.
- **Old files (format 13)**: each curve that named a frame keeps that
  frame's normal (sign and all, so arcs sweep the same way) and gets
  `par(curve, "f.z")` **appended at the end of the journal**, not beside the
  curve, so that no relation already in the file changes name. Every frame
  the file made is kept, auto-made or not. A lifted 2D file's circles used to
  get a frame of the translation's own, `plane`; they now face the origin,
  which is that plane — that frame is no longer made. Proved by four
  fixtures (three written by the format-12 build, and the explicit-regions
  format-11 fixture with its geometry recorded by that build): same points,
  radii, normals and sweeps; solved, regenerated and re-saved without moving.
- **A feature's twin rims** follow their base's normal by the feature's own
  `.n` block (`n̂ top − n̂ base`, or the turned base for a revolve) — the
  frame used to do that for free.
- **A curve's plane facing away from the viewer**: sketching on a cylinder's
  base makes the base rim the work plane, and a rim cannot be turned over, so
  its normal points into the solid. `orientingPlane` then takes the loop's
  own plane facing the viewer, so a positive depth still comes out at you.
- **What a fresh document shows**: the origin's triad at the middle, drawn
  first (under every frame — one made at the same spot showed none of its
  hover ink otherwise) and **without its name** unless lit or selected: it
  stands where drawings start, and "origin" printed over the first corner's
  label. The empty-canvas words moved 64 px below the middle, off the
  triad. The golden picture (`hidden.e2e.ts`) is re-recorded: 160 pixels,
  all in the origin's triad.
- **Existing e2e**: every claim kept; expectations changed where a frame
  used to be made (typed `plane(…)` lines, frame counts, `workplane` for
  sketch on face, version 13, "partial" for a revolve with no end frame, a
  hover tag that says `facing` where it said `in f`, Fix enabled with no
  default frame, an axis reference with no frame meaning the origin's).
  Setup changed in two places: `intersection.e2e.ts` no longer parks a
  frame only to give its circle a plane, and `undo.e2e.ts`'s typed fillet
  no longer names one.
- **Left in place deliberately**: a normal's length is one null direction of
  the Jacobian per curve. The damped solve treats it as it treats every
  direction nothing constrains (it stays where it was seeded) and reports
  SOLVED; anything that someday counts degrees of freedom must discount it.
