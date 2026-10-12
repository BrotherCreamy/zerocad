# Plan: 3D phase 2 — planar discipline

**Status: built** (2026-10-12) — see the register's 3D entry in `TODO.md` for
what was decided on the way (notably: the v6 translation makes a frame where
none fits, the curve tools show disabled in the menu without a default frame,
and `fillet` takes a plane). Second package of
[`3d-roadmap.md`](3d-roadmap.md). Read that, `CLAUDE.md`,
`docs/ARCHITECTURE.md` (the new pixel-is-a-ray section), the register's 3D
entry (phase 1's flagged seams are this package's backlog), and
`src/arcgeom.ts` / `src/projection.ts` / `src/workplane.ts` from phase 1.

Phase 1 left three honest lies in the drawing: a circle is a sphere (its
silhouette never foreshortens and it snaps only face-on); an arc's
orientation falls back to kernel axes (the gauge showing through in
display); and sketch-plane snapping simply ignores off-plane geometry.
This package makes circles and arcs *planar* and closes all three.

## Design

### Circles carry their plane

`CircleEntity` gains a **plane reference: a frame name** (`plane: string`).
- `addCircle(center?, radius?, plane?, name?)` — free-entities
  conventions; `plane` omitted resolves the **default frame at call time,
  journaled resolved** (the fix/onPlane rule). No default frame and no
  plane: throw with the standing message. This is a real semantic change:
  a circle now requires a frame to exist, exactly as `fix` does — in a
  one-model 3D world a circle without a plane is a sphere, and spheres are
  not what a sketcher draws. **2D models: the argument is refused** (every
  2D circle is trivially in the one plane); 2D behaviour is unchanged.
- The circle's own plane constraint is structural for DISPLAY but its
  *center* is NOT auto-constrained onto the plane — state it or don't:
  decide honestly. Recommendation, and the default unless you find it
  wrong while building: the circle op applies `onPlane(center, plane)` as
  part of its journaled expansion is WRONG (constructors never constrain —
  the register's free-entities rule: an argument is never a constraint).
  Instead the plane ref orients *display and on-circle geometry* around
  wherever the center is: the rim is the circle of radius r in the plane
  through the center parallel to the frame's x–y plane. Dragging the
  center off the frame's surface carries the rim with it, parallel. Write
  this reading into the entity's doc comment and test it.
- `onCircle`/`tangent`/intersections in 3D mean the planar rim, not the
  sphere: `onCircle(p, c)` becomes two residuals — distance-to-center = r
  AND p on the circle's plane (through the center, normal = frame z, frame
  read as datum). Closed-form 3D tests, not solved:true. The 2D residuals
  must come out *identical to today's* (the second residual is trivially
  zero and must not be emitted in 2D — the suite is the net).
- Rendering: a planar circle projects as an ellipse — sample as a polyline
  in its plane (the arc machinery generalises; share it). Silhouette
  rendering retires. Snapping/picking read the rim in 3D (projection.ts).

### Arcs stop guessing their plane

An arc's plane is already determined by center/start/end when they are
not collinear; phase 1's kernel-axis fallback only decided *orientation
sign*. Give `ArcEntity` the same `plane` frame reference, same resolution
rules, and let the frame's +z orient the sweep — the kernel-axis rule
retires. v6 files carry arcs without planes: translate on open by
resolving the plane from the arc's current geometry against the file's
frames (nearest-normal match; document the rule), VERSION to 7.

### Off-plane snapping, honestly

Phase 1 filters snaps to the sketch plane (the 70-units-behind bug). The
honest general rule: while sketching on a plane, geometry OFF the plane
snaps by its **projection onto the plane** — Onshape's behaviour (project
an edge into the sketch) — but ONLY as a position aid, inferring nothing
(an inferred constraint to a projected ghost would be a lie). Draw the
projected snap marker distinctly (hollow). If this turns out to be more
than a screen-space change (it is: the candidate set changes), keep it
small and honest: points only in this package, curves later; say so.

### Conveniences

- `plane()` — alias/sugar: `frame()` reads as motion toward sketching; a
  `plane(origin?, xref?, yref?)` creating a frame and `lookAt`ing it when
  a view exists is the one-call "new sketch here". Decide whether it also
  sets the default frame (recommendation: yes — that is what "start
  sketching on this plane" means; journal only the frame creation and the
  setDefaultFrame, never the camera).
- Context menu on a frame gains "Sketch on this" (sets default + lookAt;
  types the commands, house pattern).

## Verification

Unit: circle plane resolution/refusal (2D and 3D); onCircle/tangent 3D
closed forms against tilted frames; 2D residual identity (block-count and
value equality with today's); arc plane adoption + v6 translation; the
projected-snap candidate rule. E2e: draw a circle on a tilted frame,
orbit, see an ellipse (projected closed form); onCircle point stays on the
tilted rim under drag; off-plane point snaps by projection with the hollow
marker and infers nothing (`rels()` unchanged); v6 file with arcs opens
with planes resolved; the phase-1 suites all green. Screenshots at next
free numbers (53 was last), looked at. Full `npm run test:all` per commit.
Docs duties per `CLAUDE.md`; register updates with every decision, the
phase-1 seams marked closed in the roadmap.

## Delivery

Isolated worktree, branch `claude/3d-phase2` off the working-branch tip,
PR against `claude/resume-tasks-o7q02e` — one PR unless the circle
semantic change grows past holding in one hand, in which case split
circles/arcs from snapping-and-conveniences and say so. Do not merge; the
supervising session reviews.
