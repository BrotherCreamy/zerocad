# Roadmap: 3D — one constraint model, extrude and revolve

**Status: the owner's direction (2026-10-12), structured.** Two forks he
decided before this was written: **one 3D constraint model** (not
Onshape's sketch-on-plane/part split — everything is entities and
relations in a single `Model(3)`, and a "sketch" is just coplanar
geometry), and **profiles are auto-detected closed loops**. Each phase
below is a worker package with its own spec; this file is the map.

## Why "one model" works here, and what it commits us to

The kernel is dimension-blind; most relations are written through
`dot()`/`wedge()` and already hold in 3D with tests; frames are entities.
What 3D adds is not a new solver — it is:

1. **a third axis on frames** (the register's noted follow-up: a frame
   carrying a second reference direction). A 3D frame — origin, x-ref,
   y-ref — *is* a sketch plane, and `fix`'s documented gauge seam above 2D
   closes for free.
2. **a camera** instead of a 2D pan/zoom transform. Everything in
   picking/snapping/glyphs/box-select is already screen-space over
   `worldToScreen(world[])` — hand them a projecting `worldToScreen` and
   they largely survive. The one genuinely new seam: `screenToWorld` is
   ill-posed in 3D; a pointer ray must intersect a **working plane** (the
   default frame's plane — the sketch flow — or a camera-parallel plane).
3. **planar sub-structure**: circles and arcs need the plane they lie in;
   closed loops need detecting; extrude needs a direction normal to a
   plane. The frame-as-plane carries all three.
4. **features as operations**: `extrude(loop, depth)` journals as one call
   and *expands into real entities and relations* — top loop points held a
   dimensioned distance along the plane normal from their bottom twins, so
   `set("dN.value", …)` re-solves the solid like any other dimension. The
   display mesh is derived, never stored. `revolve` renders its surface
   parametrically from the live profile (a sweep is not finitely many
   entities); its section curve stays fully constrainable.

## Phases

- **Phase 1 — the third dimension** (two PRs, model half then view half):
  3D frames (optional y-ref; orthogonalised basis; `fix`/axis refs in 3D),
  an `onPlane(point, frame)` relation, the app on `Model(3)`, an
  orthographic orbit camera (right-drag orbits — Onshape; middle pans;
  wheel zooms; right-release keeps the menu), ray→working-plane pointing
  so every existing tool draws onto the default frame's plane, rendering
  that projects (z-sorted, arcs sampled in their own plane).
  *Spec:* `docs/plans/3d-phase1.md`. ✅ **Built, both halves** — with `lookAt`
  and a minimal `onPlane` inference pulled forward from phase 2, and an
  arc-orientation rule and sketch-plane snap filter phase 2 should revisit
  (see the register's 3D entry).
- **Phase 2 — planar discipline**: circles/arcs carry their plane (via the
  frame or a normal ref) — retiring phase 1's silhouette circles and its
  kernel-+z arc orientation; on-plane inference beyond phase 1's minimal one;
  snapping to off-plane geometry by its projection; a `plane()` convenience;
  multiple frames as multiple sketch planes. (The camera "look at plane"
  command shipped in phase 1 as `lookAt`.)
- **Phase 3 — loops**: `src/loops.ts`, pure — closed chains of coplanar
  lines/arcs from shared/coincident endpoints; click-inside-a-region
  picking (the Onshape gesture) in screen space.
- **Phase 4 — extrude**: the operation (expansion: twin loop, side edges,
  per-point offset relations along the plane normal, one `d` dimension for
  depth), face lists for display, z-sorted flat-shaded canvas rendering.
- **Phase 5 — revolve**: profile + axis reference (`f1.x` style) + angle
  dimension; parametric surface rendering from live geometry.
- Later, undecided, not promised: booleans, 3D fillets, shaded WebGL,
  export.

## Standing rules that carry over unchanged

Journal-as-the-call; free-entities optional args; datum read-never-pushed;
no world frame (the first sketch floats in the gauge until a frame
exists); dimensions are `d`-named and `set()`-able; tools work like
Onshape; every package lands as a PR with the full gate.
