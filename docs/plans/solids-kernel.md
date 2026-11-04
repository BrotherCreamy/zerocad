# Plan: solids on SMLib — bodies that add, cut and combine

**Status: built** (2026-11-04) — see *As built* at the end, where every
deviation is marked ⚠. After `solid-kernel-spike.md` (go: SMLib,
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

## As built (2026-11-04)

Built on `claude/solids-kernel`. Where it differs from the design above it is
marked ⚠; each ⚠ is also in TODO.md.

- **The kernel ships.**
  - **The recipe.** `npm run build:solids` runs `scripts/solids/build.sh`:
    usd-brep at `3fd5b9548d19aa8c12c29bc9637a96d42a06f8a5` and Emscripten
    4.0.15, at `-O2`, with no wasm exceptions and a 512 MB memory ceiling.
    The build lands in `src/solids/smlib-gen/`, gitignored, beside SMLib's
    LICENSE and a `BUILD` stamp. The sources, emsdk and object files are
    cached in `.solids-cache/`, and the variables `SMLIB_SRC`, `EMSDK` and
    `SOLIDS_OBJ` reuse an existing checkout.
  - **CI.** The Pages workflow and a new `solids` workflow both cache
    `.solids-cache/` by the recipe's hash. The cold build is 6 m 51 s on
    GitHub's four cores, and the warm one 16 s after a 20 s cache restore.
  - **Shipping.** The PWA carries `solids/worker.js`, `smlib.wasm` and
    `LICENSE` as files of their own, which the service worker caches; the
    Worker starts the first time a body needs it. The single file inlines
    all three.
  - **Licence.** About names SMLib, its owner and its licence, and links to
    the licence text.
  - The spike directory is gone: its code is in `src/solids/`, and its
    recipe and benches are in `scripts/solids/`.
- **The Worker** (`src/solids/serve.ts`, `client.ts`) knows profiles in a
  plane, sweeps, booleans, tags and tessellation — numbers only.
  - The client replaces the Worker when it crashes (the message says so),
    when it hangs past 30 s, or when it grows past 256 MB.
  - Measured: 200 rebuilds stay at 32 MB, in use within 2 MB. A recycled
    Worker costs one cold rebuild, about 290 ms in Node.
- **Evaluation** (`src/solids/evaluate.ts`, `src/bodies.ts`, `src/modes.ts`).
  A body is a chain of sweep nodes in feature-creation order.
  - Each node is cached by the hash of every node up to it, so a change to
    the last feature rebuilds only that feature.
  - The kernel answers asynchronously after each solve. Until it does, and
    whenever it refuses, the last good body is drawn and the reason is logged.
  - A sweep that is not a solid fails. So does a boolean that leaves
    nothing. A cut that reaches no material is said to be *idle*.
- **Modes.** `mode` and `into` are on the feature record; file format 14.
  - The mode is decided at the call and journalled resolved.
  - `new` is journalled as no options at all, so a file with no booleans is
    the file it was. The replay decides nothing.
  - The default is Add when a closed-form probe just behind or ahead of the
    profile lands in a body, and New otherwise.
  - ⚠ **Cut is offered, never defaulted**, even for a negative depth into a
    body. The spec said a negative depth into a body "offers it", and that is
    what the dialog does: Cut is outlined and the log says so. A default
    that removes material when the user meant to add would be the worse
    mistake.
  - ⚠ **The mode is not remembered** as the next arm's default, though every
    other option is: a cut chosen once is not the next feature's.
  - ⚠ The edit dialog does not change a feature's mode. Typing a new feature
    does.
- **Bodies.** They are listed in the organiser once there is one, named by
  their first feature, each with its chain.
  - ⚠ **`into` is not part of a feature's names.** When an add's target is
    deleted, the add stands alone as a body of its own; when a cut's target
    is deleted, the cut is left out. The log says which.
  - ⚠ **Hiding a later feature suppresses it** — the body is rebuilt without
    it — rather than hiding a body.
- **Drawing and picking.**
  - ⚠ **A one-feature body is still drawn by `faces.ts`**, live, with no
    kernel. Only bodies of two or more features are drawn from the kernel's
    tessellation and edges, as `faces.ts` `Face`s, so they go through the
    face layer, the painter's fallback and the occlusion answer unchanged.
    Old files draw pixel for pixel as they did, and the app is whole before
    the kernel loads.
  - Picking a kernel face asks the kernel's triangles.
  - Kernel edges are drawn by the face layer when shaded, and by the sketch
    pass in the hidden view (dimmed behind a face) and the wireframe.
  - ⚠ Kernel edges are not yet hover or constraint targets.
  - ⚠ The edit preview does not replace a kernel body; it is drawn over it.
- **The twins: kept, as the relational skeleton.** An extrude's lid lines and
  walls stay solved entities, so every constraint an old file holds on a lid
  edge still holds. Proved by `test/oldfiles13.test.ts` and the v12 fixtures.
  - In a kernel body they are quiet in every view: the kernel draws what the
    body is, and the twins are what the dimensions hold.
  - A click on a kernel face becomes the drawn loop round the point it hits,
    which is the feature's own lid, wall or profile. So sketch on face makes
    its plane of that feature's points, and the plane follows the solid. A
    curved face is no region.
  - ⚠ The spike recommended deriving the twins from the kernel. Rejected: it
    would cost every old constraint on a lid's edge and make the first
    dimension drag wait for the Worker. See CONVERSATION_LOG.md.
- **STEP.**
  - **Topology from the kernel.** A body of two or more features is written
    from the kernel's topology. Surfaces are analytic where the face's tag
    names a feature role (plane, cylinder, cone, torus, from the feature
    data), and a B-spline from the kernel otherwise.
  - **Edges.** Each edge is a LINE or CIRCLE where sampling says it is one,
    and the kernel's B-spline otherwise. Each face's orientation is decided
    geometrically, and seams on cylinders are split into halves.
  - ⚠ **A file with B-spline edges declares a 10⁻⁵ uncertainty**, not 10⁻⁷:
    the kernel's intersection curves sit 3·10⁻⁶ off OpenCascade's surfaces.
  - ⚠ **`turned-and-drilled` fails OpenCascade's strict read** (the healed
    read, every application's, takes it). A seam face that a boolean crossed
    keeps its seam, and the unhealed translation computes a negative area.
  - ⚠ The disconnected lumps of one body share one shell. No pcurves.
- **Tests.**
  - New: `solidsidentity`, `solidsclient`, `modes`, `bodies` and
    `stepkernel`, with the fixtures in `test/fixtures/step-kernel/`.
  - E2E: `solids.e2e.ts` on a desktop and `solidsphone.e2e.ts` under iPhone 13
    emulation.
  - ⚠ The kernel tests skip, saying so, without a kernel build.
  - ⚠ The unit suite now takes about 25–45 s, up from 14 s.
  - The spike's Chromium bench (`scripts/solids/bench/chromium.ts`) runs
    again from its new place.
