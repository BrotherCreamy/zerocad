# Plan: 3D phase 1 — the third dimension

**Status: half 1 built** (2026-10-12, PR against the working branch; half 2
not started). Deviations and decisions from half 1 are in `TODO.md`'s 3D
entry; the one that changes this plan is that **half 1 took format version
5** (`addFrame`'s name moved to the fourth argument — see `persist.ts`), so
half 2's bump is to **6**, and its 2D→3D lift should key on the file's `dim`
field: v4 *and* v5 files are 2D.

First package of
[`3d-roadmap.md`](3d-roadmap.md); read that first, then `CLAUDE.md`,
`docs/ARCHITECTURE.md`, and the register's no-world-frame entry (the
read-never-pushed datum rule and the drag-a-datum rule govern 3D frames
identically).

Delivered as **two PRs in order**, like coordinate-frames was: **(1) model
+ relations**, **(2) camera + app**. The suite must be green at each PR's
head.

## Half 1 — model + relations

- **3D frames.** `addFrame(origin?, xref?, yref?, name?)` — in a 2D model
  the third argument is refused; in 3D it is optional like everything else
  (free-entities conventions; auto pieces seeded non-degenerate:
  origin→xref along one axis, origin→yref along another). `frameBasis` in
  3D: `ux` from the x-ref normalised; `uy` from the y-ref
  **orthogonalised** against `ux` (Gram–Schmidt — the y-ref fixes the
  plane and the sign, not the exact angle; say this in the doc comment);
  `uz = ux × uy`. Degenerate (collinear refs) gets the same floor
  treatment the 2D degenerate case has, tested.
- **`fix` in 3D closes its documented gauge seam**: with a 3D frame it
  pins frame coordinates `[x, y, z]` exactly as 2D `fix` does `[x, y]`;
  the frameless 3D form is REMOVED (the register's "one place the gauge is
  still visible" closes; the same no-default-frame error as 2D). Tests
  that used gauge `fix` in 3D gain fixture frames — read each.
- **Axis references in 3D**: `"f1.x"`, `"f1.y"`, and now `"f1.z"`.
  `par`/`perp`/`ang` against them work in 3D (the wedge has three
  components — the machinery holds; prove with closed-form tilted-frame
  tests in 3D, not solved:true).
- **`onPlane(point, frame?)`** — new relation (short name `onplane`;
  decide and document the long form): the point lies in the frame's
  x–y plane. Residual: dot(point − origin, uz) = 0, frame read as datum.
  Default-frame resolution and journaling-resolved exactly like `fix`.
  2D models refuse it (every point is trivially on every "plane").
- **`xaxis`/`yaxis` gain `zaxis`** at the command layer.

## Half 2 — camera + app

- **The app runs `Model(3)`.** This is the owner's one-model decision: no
  mode switch, no second model type. Saved v4 files are 2D and must still
  open — decide and document the translation (a 2D journal replays into a
  3D model with z=0 seeds and an (x,y)→(x,y,0) lift of every coordinate
  argument; `fix` two-coordinate forms lift to z=0 against their frame).
  Bump VERSION to 5. *(↻ Half 1 already took 5 — bump to 6, and key the
  lift on `dim`; see the status note at the top.)*
- **Orthographic orbit camera** replacing the 2D transform in `view.ts`
  (keep the exported names/shape as close as honesty allows — everything
  downstream reads `worldToScreen`). Camera: target point, azimuth,
  elevation, scale. `worldToScreen([x,y,z]) → [sx,sy]` plus a `depth(w)`
  for z-sorting. Perspective is deliberately NOT v1 (CAD sketching is
  orthographic; picking tolerances stay meaningful).
- **Pointing**: `screenToWorld` becomes ray→working-plane intersection.
  The working plane is the **default frame's x–y plane** when one exists,
  else the camera-parallel plane through the orbit target. Every tool's
  `PointerInfo.world` flows through this — tools themselves should not
  need edits (verify; say where they did).
- **Mouse map** (register update, flagged ⚠ Onshape-parity): right-DRAG
  orbits (Onshape's gesture), middle-drag pans, wheel zooms toward the
  cursor, right-release still opens the menu, left button exactly as
  today (pick/drag/box on the working plane). `pan()`/`zoom()` commands
  keep working; add `orbit(az, el)` and `lookAt(frame?)` (aligns the
  camera to a frame's plane — the "edit this sketch face-on" gesture).
- **Rendering**: project all entities through the camera; z-sort
  painter's-style per entity (good enough until faces exist in phase 4);
  an arc/circle samples as a polyline **in its own plane** (an arc's
  plane is through its center/start/end; a circle with no plane yet —
  phase 2 — renders as its silhouette circle, correct for a sphere under
  orthographic projection; document this as the phase-2 seam). Frames
  draw as 3-arrow markers (x, y, z — extend the 2D marker).
- **Box select, picking, snapping, glyphs** keep working in screen space
  over the projecting `worldToScreen` — verify each suite rather than
  assuming, and fix projection-dependent spots (the drag's
  `screenToWorld` offset arithmetic now lives on the working plane).
- **Inference**: the line tool's axis inference works against the default
  frame's x and y axes projected to screen; placePoint lands on the
  working plane with `onPlane` inferred when a default frame exists —
  decide and flag anything beyond that for phase 2 rather than building
  inference speculatively.

## Verification

Half 1 unit: 3D frame construction/orthogonalisation/degeneracy; fix-3D
closed-forms against a tilted 3D frame; onPlane closed-forms; axis refs in
3D; journal round-trips; the 2D paths unchanged (the whole existing suite
is the regression net). Half 2 e2e: the app boots 3D; draw a rectangle on
a default frame's plane face-on, orbit, see it foreshorten (pixel
probe/closed-form projected coordinates); draw on a TILTED frame; save a
2D v4 file opens lifted; orbit/pan/zoom gestures; menu still opens;
dimensions/labels/glyphs render. The poster: one drawing on two different
frames' planes, orbited to show both obliquely. Screenshots at next free
numbers — check your tip — and LOOK at them. Full `npm run test:all` per
commit. Docs duties per `CLAUDE.md`; register gains the 3D entry with the
mouse-map change and every deviation flagged.

## Delivery

Isolated worktree, branch `claude/3d-phase1` off the working-branch tip,
two PRs against `claude/resume-tasks-o7q02e` (half 2 starts only after
half 1 merges). Do not merge; the supervising session reviews. The
footprint is wide by nature; keep commits small and reasoned, and expect
the reviewer to push back hardest on anything that weakens the 2D
behaviour the suite pins.
