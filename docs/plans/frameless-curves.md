# Plan: a circle is just a circle — curves carry their own orientation, and nothing makes a frame for you

**Status: queued** (2026-11-04). The owner, twice: *"why when I create
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
