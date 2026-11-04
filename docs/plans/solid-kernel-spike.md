# Plan: a real solid kernel — the SMLib spike (go / no-go, with measurements)

**Status: queued** (2026-11-04). The owner: *"consider using an open source
nurbs engine, or the nvidia one so you can do real solving. if its possible
with what we are trying to achieve then use it, otherwise start dev on your
own engine"* — and *"I find it impossible to make anything beyond an extruded
shape. fix this so I can create complex parts"*.

**Why only extrusions are possible today**: there are no booleans. Every
feature is its own body; two overlapping extrudes overlap rather than join, a
pocket cannot be cut into a solid, a hole can only be a hole in the profile
it was extruded from, and nothing fillets or chamfers a solid's edge. Those
are what a B-rep kernel is for. Our least-squares solver stays: it solves
sketches and constraints; a kernel turns profiles and operations into solids.

## The candidates (researched 2026-11-04 — re-check every claim)

- **NVIDIA USD BRep / SMLib** — <https://github.com/NVIDIA-Omniverse/usd-brep>.
  Apache-2.0; C++ and Python; NURBS B-rep with booleans, fillets, sweeps and
  offsets; the kernel behind ClassCAD for 20+ years; open-sourced Oct 2026. A
  community Emscripten build, <https://github.com/RandoTechNerd/smlib-wasm>,
  reports box/cylinder/cone/sphere/torus, boolean union/intersect/subtract,
  extrude, revolve, fillet, tessellate with face ids, volume; 4.37 MB wasm
  (1.15 MB brotli); single-threaded (run it in a Worker); heap grows and never
  shrinks; **no STEP or USD I/O in the wasm build**; no shell or path sweep.
  Another report: SMLib compiles unchanged with Emscripten 4.0.15.
- **OpenCascade (OCCT)** — LGPL-2.1 with exception; via opencascade.js or
  occt-wasm; the most complete (STEP, chamfer, shell, loft, sweep) and the
  most battle-tested; ~2.4 MB compressed custom build, ~9 MB full.
- **Rust kernels** (truck, brepkit, BREP_kernel) — fit our Rust crate; young;
  robustness claims self-reported.
- **Our own** — the last resort: robust booleans and blends are decades of
  work in every kernel that has them.

## The spike — what to find out, by measuring

Work in `spikes/solid-kernel/` (a directory the app does not import) and the
scratchpad. Nothing here ships until the go decision.

1. **Build SMLib to wasm ourselves** from NVIDIA's upstream at a pinned commit
   (install emsdk in the scratchpad; say if the network forbids it, and fall
   back to evaluating the community build at a pinned commit, vetted, with
   its LICENSE and THIRD_PARTY_NOTICES). Record the exact recipe — it must be
   reproducible in our CI later. Sizes: raw, gzip, brotli.
2. **A thin TypeScript API in a Worker**: make a planar profile from our
   curves (lines, arcs, circles, holes) → extrude / revolve; boolean union,
   subtract, intersect; fillet and chamfer chosen edges; shell/offset if it
   exists; tessellate with face and edge ids; read exact geometry back
   (surface type, NURBS data) for STEP export.
3. **Our test parts**, each checked by volume and bounding box against an
   independent computation, and by a validity check if the kernel has one:
   a plate with a pocket cut and two through-holes; two overlapping
   extrudes unioned; a filleted outline extruded then its top edges
   filleted; a revolve with a cone and a torus face; a boss on a face
   (coplanar union — the classic failure); a cut exactly flush with a face.
4. **Identity across operations** — the question that decides whether our
   relational model can sit on it: when a part is rebuilt after a dimension
   changes, can each face and edge be matched to the one before (the kernel's
   own history/naming, or by the generating feature and profile member)?
   Sketch on a face and constraints to a solid's edge depend on it.
5. **Performance and memory** in Chromium's wasm (and Node): time per
   operation on the test parts, a rebuild of all of them, heap growth over
   100 rebuilds, and whether recycling the Worker bounds it. Note iOS
   Safari's relevant support (wasm exception handling, memory ceilings) from
   documentation — say plainly that the device is untested.
6. **OpenCascade on the same parts**, if time allows, for a like-for-like
   comparison (size, speed, robustness, identity).

## Deliverable

A report in `docs/plans/solid-kernel-spike.md` (append *Findings*) and in the
PR: a table per test part and per kernel (valid, volume error, time, heap),
the sizes, the build recipe, the licence obligations, the identity answer,
and a **recommendation — SMLib, OpenCascade, or our own — with the reasons**.
Plus a short architecture sketch of how the kernel would sit in ZeroCAD: a
Worker below `main.ts`, knowing geometry and nothing of points (the layer
rule's kernel edge), features as nodes evaluated in dependency order (no
timeline), the result tessellated for drawing and picking, and which of
today's feature twins stay relational entities.

No change to the app's behaviour; tests only for the spike's own API.

## Docs

CHANGELOG entry (the decision and its numbers); CONVERSATION_LOG (the
candidates and why the losers lost); the register (the kernel choice, as
vetoable).
