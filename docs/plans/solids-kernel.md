# Plan: solids on SMLib — bodies that add, cut and combine

**Status: queued** (2026-11-04), after `solid-kernel-spike.md` (go: SMLib,
measured). The owner: *"I find it impossible to make anything beyond an
extruded shape. fix this so I can create complex parts"* — and *"consider
using an open source nurbs engine, or the nvidia one"*.

This is the first integration package: SMLib becomes the thing that turns
features into solids, and extrude and revolve learn to **add to, cut from,
or start** a body. Fillets, chamfers, shell, mirror and patterns follow in
their own packages, on this one.

Read `CLAUDE.md`, `docs/ARCHITECTURE.md`, `solid-kernel-spike.md` (its
*Findings* and architecture sketch above all), `frameless-curves.md`,
`explicit-regions.md`, `step-export.md` and `feature-dialog.md` (as built),
`spikes/solid-kernel/` (the recipe, the glue, `src/kernel.ts` — the
contract — the naming, the benches), `src/model.ts`'s features,
`src/operations.ts` (extrude, revolve, regeneration, twins), `src/faces.ts`,
`src/facelayer.ts`, `src/occlusion.ts`, `src/picking.ts`, `src/step.ts`,
`src/sketchface.ts`, `src/tools/feature.ts`, `extrude.ts`, `revolve.ts`,
`.github/workflows/pages.yml`, `scripts/pwa*.ts`, and the feature, faces,
depth, hidden and step tests.

## Design

- **The kernel ships.** `spikes/solid-kernel/smlib/build.sh` moves to
  `scripts/` as `npm run build:solids` (pinned usd-brep commit, pinned
  emsdk), output gitignored beside the solver's wasm; the Pages workflow
  builds it (cache the emsdk and the build by the pin; say what the cold and
  warm times are); the single-file and PWA builds carry it (the PWA as its
  own cached file, loaded lazily — the app opens before it). Apache-2.0: its
  LICENSE beside the wasm and in About. The spike directory is retired into
  `src/solids/` and `scripts/`.
- **A Worker, below `main.ts`, that knows geometry and nothing of points**
  (the layer rule's kernel edge): profiles as numbers in a plane, sweeps,
  booleans, tags, tessellation. Memory is capped and the Worker recycled
  past a threshold (the spike's measured fillet leak); a crash or a refusal
  is a message, never a hung app.
- **Features evaluate in dependency order, no timeline.** Each extrude and
  revolve is a node: its profile (solved positions, from the relational
  model), its parameters (the dimension values) and its **mode**:
  - **New body** — a body of its own (today's behaviour).
  - **Add** — unioned into a target body.
  - **Cut** — subtracted from a target body.
  - (Intersect if it costs nothing more.)
  The target is the body the profile lies on or overlaps; the mode is an
  option in the feature dialog and typed (`extrude("l1", 10, { mode: "cut" })`),
  journalled with the call, with a sensible **default**: Add when the
  profile lies on a body's face or overlaps one, New otherwise — as in
  Onshape; Cut is chosen (and a negative depth into a body offers it). A
  body is the result of its chain; bodies are listed in the organiser
  (a *Bodies* section), hideable, and are what STEP exports, one solid each.
- **Drawing and picking from the kernel.** Faces are the kernel's
  tessellation carrying face ids, through `facelayer.ts` and the occlusion
  answer; edges are the kernel's, drawn as edges are now. A face or edge is
  named by the spike's tagging (feature, role, profile member; edges by
  their two faces) so that picking, hovering, **sketch on face** — on any
  face, a boolean's included — and the work plane refer to it by name and
  survive a rebuild.
- **What stays relational.** The profile, the axis, the depth and angle
  dimensions, and the work plane. **Decide and document what happens to
  today's twins** (an extrude's lid lines and walls as solved entities):
  the spike recommends deriving them from the kernel; keeping them where a
  face is untouched by booleans keeps constraints to a lid's edge working.
  Choose, prove old files keep their constraints, and write it down.
- **Regeneration** is asynchronous after the solver settles, cached per
  input hash; a drag shows the last good solid until the new one arrives,
  and a kernel refusal (a cut that removes nothing, a boolean that fails)
  keeps the last good body and says why in the status — never a broken
  picture.
- **STEP** exports bodies: where a face is untouched and analytic, the
  exporter keeps writing planes, cylinders, cones and tori from feature data
  (SMLib returns them as B-splines and general surfaces of revolution);
  where a face comes from a boolean or a blend, write
  `B_SPLINE_SURFACE_WITH_KNOTS` and edge curves from the kernel (extend the
  glue to export knots and curves). Re-validate every part with OpenCascade
  as `step-export.md` did, the boolean parts included.

## Tests (the risky ones first)

- **Identity through a topology-changing rebuild** — the spike's unmeasured
  question: a cut whose depth change makes it break through a face, a hole
  dragged off an edge; what names survive, what is new, what a sketch on a
  vanished face does (it should say so, not jump).
- Every spike part through the app (cut pocket, two holes, overlapping union,
  boss on a face, flush cut) by volume and validity; the mode defaults; the
  organiser's bodies; old files open with today's solids unchanged.
- E2E: draw a plate, extrude; sketch a circle on its top, extrude Cut
  through — a hole; sketch on the side, extrude Add — a boss; drag a
  dimension and the body rebuilds; undo; save, open; export STEP and read it
  back. Under iPhone emulation too. LOOK at each.
- Memory: 200 rebuilds stay under the cap with recycling.

## Docs

CHANGELOG at the top quoting the owner; ARCHITECTURE (the kernel's layer,
the evaluation, naming, what is relational and what is derived); the
register (SMLib ships; modes and their defaults; bodies; twins' fate) as
vetoable; STATUS; README; `help()`; the spec marked built.
