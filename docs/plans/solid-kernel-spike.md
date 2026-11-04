# Plan: a real solid kernel — the SMLib spike (go / no-go, with measurements)

**Status: spiked** (2026-11-04) — **recommendation: SMLib**; see *Findings*
at the end. **Shipped** by [`solids-kernel.md`](solids-kernel.md): the spike's
directory is retired. Its recipe and glue are `scripts/solids/build.sh` and
`glue.cpp` (`npm run build:solids`, which takes no arguments and fetches its own
pinned sources into `.solids-cache/`), its benches `scripts/solids/bench/`,
its contract, adapter and naming `src/solids/`, and its parts and helpers
`test/solids/`. Paths below are the spike's, as it was. The owner: *"consider using an open source
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

---

## Findings (2026-11-04)

The code is in `spikes/solid-kernel/` (its README says how to run it); the
kernel build and every downloaded source stayed in the scratchpad. The app is
unchanged and imports nothing from the spike.

### Recommendation: SMLib — go

Build NVIDIA's SMLib to wasm ourselves (the recipe below), run it in a Worker,
and stop considering a kernel of our own. The reasons, each measured below:

1. **Every test part comes out right.** All eleven — the spec's six, plus a
   shell, a chamfer, a union of two boxes sharing a face, a face split in two
   by a cut, and a profile on a tilted plane — are closed manifold solids that
   pass the kernel's own consistency checks. Each volume is within 2·10⁻¹⁰
   (relative) of an independent closed form, and each bounding box within
   3·10⁻¹³ mm. Both coplanar cases the spec calls "the classic failure" (a
   boss standing on a face, and a slot flush with two faces) are exact.
2. **Identity across rebuilds works through the kernel's own machinery.**
   SMLib carries attributes through splits and merges (SmAttribute.h §5).
   Each face gets a tag (*feature, role, profile member*) right after its
   sweep, and the tag survives booleans, fillets, chamfers and shells on every
   piece that remains. On every part, after every dimension was changed,
   **every face and edge name was found again**, with the same surface kind.
   That is what sketch-on-face and constraints to a solid's edge need.
3. **Small, and no new browser feature needed.** It is 1.16 MB with brotli at
   `-O2` (0.95 MB at `-Oz`), against 5.0 MB for an OpenCascade build. It
   uses no wasm exception handling at all, because SMLib catches no
   exceptions; OpenCascade's build needs exception handling.
4. **Apache-2.0, every file.** The 235 files we compile carry one licence and
   one copyright holder, and there is no LGPL relinking duty.
5. **We can build it from source ourselves.** It builds without NVIDIA's
   build system, at a pinned commit, in about 15 minutes on a 4-core box.

What the spike does not settle, and the risks, are under *Deserving
scrutiny*. The biggest is that **OpenCascade was not run** (see below), so the
comparison is SMLib measured against OpenCascade as documented.

### The build recipe (reproducible; no network block)

```sh
git clone https://github.com/NVIDIA-Omniverse/usd-brep    # pinned: 3fd5b9548d19aa8c12c29bc9637a96d42a06f8a5 (VERSION 1.0.1)
git clone https://github.com/emscripten-core/emsdk && emsdk/emsdk install 4.0.15 && emsdk/emsdk activate 4.0.15
bash spikes/solid-kernel/smlib/build.sh usd-brep emsdk out -O2   # or -Oz
```

- **What it compiles.** `build.sh` compiles `source/SMLib/src/*.cpp` and
  `source/SM_API/src/*.cpp`: 235 files, of which SMLib's alone are about
  871 000 lines. It uses upstream's release defines, plus the pair upstream
  uses to strip debug graphics, and `-ffp-contract=off` as upstream does. It
  links them with `smlib/glue.cpp`, our C ABI of 34 exports, into an ES
  module and a `.wasm`.
- **What it leaves out.** Upstream's premake, Packman, TBB and OpenUSD are
  not needed. TBB is only reached under `SM_USE_TBB`, which nothing defines.
  Threads are only used through pthread TLS, which Emscripten stubs for a
  single thread.
- **What the first attempt got wrong (now fixed in the script).**
  - SMLib *does* throw: `std::bad_alloc`, from its allocator, so
    `-fno-exceptions` fails to compile. The build keeps Emscripten's default
    instead, where a throw aborts and nothing catches.
  - Both source directories have a `StdAfx.h`, so each must compile with its
    own include directory first, as upstream does.
  - SMLib's success status is 1000, not 0.
- **How long it takes.** A full build takes about 15 min (`-Oz`, 13:12 to
  13:27 wall clock, while another build was running). A relink takes about
  1.5 min.
- **Network.** Nothing was blocked. The GitHub clones and emsdk's download
  from storage.googleapis.com both went through the proxy.
- **The app's own kernel build.** `npm run build:kernel` failed inside
  wasm-pack's own download of binaryen, although `curl` fetches the same URL
  fine. So `build:kernel:dev` was used, as CLAUDE.md says.
- **The community build** (RandoTechNerd/smlib-wasm) was not needed and was
  not used.

### Sizes

Measured with `node --experimental-strip-types spikes/solid-kernel/bench/sizes.ts <file>`:

| File | raw | gzip -9 | brotli -11 |
|---|---|---|---|
| SMLib `-O2` `smlib.wasm` | 4 362 149 | 1 566 677 | **1 156 426** |
| SMLib `-Oz` `smlib.wasm` | 3 082 747 | 1 237 353 | 951 199 |
| SMLib `smlib.mjs` (loader) | 17 115 | 5 600 | 5 060 |
| OpenCascade, `replicad-opencascadejs@1.1.0` `replicad_single.wasm` | 22 980 267 | 7 250 252 | 5 012 753 |

`-Oz` downloads 18 % less but runs slower. The median rebuild of all eleven
parts in Node is 279 ms at `-Oz` against 193 ms at `-O2`, which is 45 %
slower. The recommendation is `-O2`, since the PWA caches the file once.

### Per part, per kernel

**Setup.** SMLib `-O2`, with the kernel in a module Worker in headless
Chromium 141 (`bench/chromium.ts`) and in Node 22.22 (`bench/node.ts`), on a
shared 4-core box.

**How a result is checked.** Each volume and box is checked against a closed
form in `src/profiles.ts`:

- Green's theorem over lines and arcs;
- Pappus for the revolve and the fillet;
- inclusion–exclusion for the chamfer.

The closed forms are themselves tested against shapes of known volume in
`test/profiles.test.ts`, including the fillet against a 200 000-slice
numerical integral.

**How to read the table.**

- "Build" is the whole part, including our tagging, which asks every face for
  its area and an interior point.
- Of the two Chromium build columns, the first is the first build after load
  (the engine is still compiling the hot code to its faster tier) and the
  second is the next build.
- These are single samples, so read the per-part milliseconds as ±50 %. The
  100-rebuild median further down is the robust number.
- "Heap of result" is the in-use heap that the finished solid and its last
  tessellation hold.

| Part | Valid (manifold, check failures) | Volume error | Box error | Faces / edges | Chromium build ms, first / warm | Node warm ms | Tessellate ms, triangles | Heap of result | Names after rebuild |
|---|---|---|---|---|---|---|---|---|---|
| plate-pocket-holes | yes (true, 0) | 1.6e-13 | 4e-15 | 13 / 30 | 148 / 76 | 18 | 12.6, 292 | 642 kB | all found |
| overlap-union | yes (true, 0) | 4.6e-13 | 0 | 8 / 18 | 111 / 24 | 15 | 5.7, 140 | 399 kB | all found |
| fillet-outline-and-top | yes (true, 0) | 3.5e-12 | 3e-13 | 18 / 40 | 117 / 37 | 60 | 38.1, 716 | 1834 kB | all found (8 fillet faces named by neighbours) |
| revolve-cone-torus | yes (true, 0) | 2.0e-10 | 7e-15 | 5 / 7 | 132 / 88 | 58 | 21.3, 1212 | 607 kB | all found |
| boss-on-face (coplanar union) | yes (true, 0) | 7.5e-14 | 0 | 8 / 15 | 20 / 12 | 10 | 4.5, 140 | 273 kB | all found |
| flush-cut (coplanar subtract) | yes (true, 0) | 2.7e-16 | 0 | 10 / 24 | 13 / 6 | 10 | 0.9, 28 | 195 kB | all found |
| shell-open-top | yes (true, 0) | 8.9e-16 | 4e-15 | 11 / 24 | 45 / 24 | 19 | 1.0, 28 | 273 kB | all found |
| chamfer-top-edges | yes (true, 0) | 0 | 0 | 10 / 20 | 38 / 80 | 14 | 1.3, 20 | 348 kB | all found (4 chamfer faces named by neighbours) |
| touching-union | yes (true, 0) | 1.1e-16 | 0 | 6 / 12 | 27 / 11 | 5 | 4.6, 12 | 119 kB | all found |
| split-face | yes (true, 0) | 2.7e-16 | 0 | 10 / 24 | 12 / 23 | 45 | 19.5, 28 | 195 kB | all found (the lid's 2 pieces told apart by neighbours) |
| tilted-cut | yes (true, 0) | 2.4e-12 | 0 | 7 / 15 | 26 / 23 | 29 | 6.0, 144 | 264 kB | all found |

Two conventions were measured, not assumed:

- **Shell.** SMLib's positive shell offset goes **outward**. The first run
  with +2 grew the box by 2 and gave the outward shell's volume, so the
  adapter flips the sign.
- **Chamfer.** `SmApiFilletEdges`' linear "radius" is the **setback along
  each face**, which is what the closed form assumes.

**OpenCascade: not run.**

- **What happened.** The spike fetched `replicad-opencascadejs@1.1.0` from
  npm (tarball sha256 `be73ff9e…f446d9`) into its own directory. The
  session's permission policy then refused to execute a prebuilt third-party
  package's code ("Code from External"). That is a policy refusal, not a
  network block, and it was not worked around. Building OpenCascade from
  source to wasm is a much bigger job than SMLib's and was not attempted.
- **Measured without running it.**
  - Its sizes, in the table above.
  - It uses **wasm exception handling**, in the legacy encoding. The binary
    has a TAG section, and `wasm-dis | grep` counts 165 599 `try`,
    140 835 `catch_all`, 24 541 `delegate` and 59 329 `rethrow`.
- **From its documentation.**
  - It is the most complete kernel (STEP, loft, sweep, shell, draft) and the
    most battle-tested.
  - Identity would come from the `BRepAlgoAPI_*::Modified / Generated /
    IsDeleted` histories; the package's `.d.ts` has them.
  - Its licence is LGPL-2.1 with OCCT's exception
    (<https://dev.opencascade.org/resources/licensing>).
- **So every OpenCascade cell of the table is unknown.**

### Performance and memory

- **Load.** Measured from `new Worker` to the first reply, which covers
  fetching, compiling and instantiating the module inside a fresh Worker:
  - 299 ms the first time, and 184–297 ms on recycled Workers (six recycles
    over two runs);
  - of that, the module's own start-up inside the Worker is 66–162 ms;
  - in Node, start-up is 45–73 ms.
- **A message round trip** to the Worker takes under 0.1 ms, below the page's
  timer resolution (20 pings).
- **Rebuilding all eleven parts** (every sweep, tag, boolean, fillet and
  shell), median of 100 rebuilds:
  - **181 ms in Chromium**;
  - **193 ms in Node**;
  - 279 ms in Node at `-Oz`.
- **The heap leaks, and the leak is in one call.**
  - What grows: linear memory starts at the 32 MB initial size, and 100
    rebuilds do not grow it. But the in-use heap climbs **154 kB per
    rebuild**, steadily: 1.12 MB to 16.5 MB over 100 rebuilds, and 62.6 MB
    over 400, by which point linear memory had grown to 66.5 MB. Wasm memory
    never shrinks.
  - Where it comes from: `bench/leak.ts` runs each operation alone, 50 rounds
    after a warm-up. Extrude, revolve, copy, boolean, shell, tessellate, the
    queries, and a fillet of a box's or a cylinder's lid edges each keep
    0–41 bytes a round. The whole leak is `SmApiFilletEdges` on the rounded
    outline's eight lid edges (a tangent chain of lines and arcs), at about
    154 kB a call.
  - This is an SMLib bug to report upstream; a test pins it.
  - **Recycling the Worker bounds it.** Each fresh Worker started at
    33 554 432 bytes and stayed there through a rebuild of every part.
- **iOS was not tested; no device was available.** From documentation:
  - Safari has had BigInt64Array (which Emscripten's output needs) since 15,
    legacy wasm exception handling since 15.2, and exnref since 18.4
    (<https://webassembly.org/features/>, its `features.json`).
  - The SMLib build needs **neither** exception proposal. The OpenCascade
    build needs the legacy one.
  - iOS Safari documents no fixed wasm memory ceiling. WebKit's bug tracker
    reports tabs being killed rather than `memory.grow` failing, with about
    300 MB to 1 GB reliably available
    (<https://bugs.webkit.org/show_bug.cgi?id=221530>,
    <https://bugs.webkit.org/show_bug.cgi?id=269777>).
  - So cap the Worker's maximum memory well below that, and recycle the
    Worker when it reaches a threshold.

### Identity across rebuilds: yes, through tags the kernel carries

**The scheme** (`src/naming.ts`). Right after a sweep, every face gets the tag
`feature·1000 + role`, where the role is the base cap, the lid or end cap, or
the face swept from profile member *i*. The role is found from the sweep's own
geometry (which member a wall's interior point lies over), never from the
order in which the kernel lists faces. Then, operation by operation:

- **Booleans.** A face that survives keeps its tag. When a face is **split**
  into pieces (the lid cut across by a slot), every piece gets the tag, and
  the pieces are told apart by their neighbours' names
  (`F1.lid[F1.m0,F1.m1,…]`).
- **Fillet and chamfer.** The faces they make have **no** tag, and are named
  by the faces they blend (`blend(F1.lid,F1.m3)`). That name was unique on
  every part.
- **Shell.** The offset copies **carry their source's tag**, so each tag
  appears twice. `tagOffsets` retags the copy that does not lie on the
  original face as `F1.m0'`. The caller has to do this, because the kernel
  cannot know which copy is which.
- **Coplanar merge** (touching-union). When two faces merge into one, the
  result keeps **one** feature's tag and the other's name is gone (a test
  pins this). A reference to the absorbed face would need to resolve to the
  merged one. That needs the merge to be recorded, and SMLib's `Merge`
  attribute callback is where it could be; the spike does not do this.
- **Edges** are named by their two faces.

**What was measured.** `identity()` in `src/bench.ts` builds every part, then
builds it again with every dimension changed. For example, the plate goes from
100×60×10 to 110×64×12, its holes from r 5 to 6, and its pocket from 40×20×4
to 44×22×5. On all eleven parts:

- every face and edge name of the first build was found in the second;
- no new names appeared;
- every named face kept its surface kind.

Fillets select their edges by name (`edgesNamed(… includes("F1.lid"))`), so a
rebuilt part fillets the same edges by construction.

**Not measured:** a dimension change that changes topology, such as a hole
moved so far that it breaks out through an edge. There a name can genuinely
vanish, and whatever depends on it must be shown as broken rather than
silently re-attached.

### Exact geometry for STEP

**What the glue returns.** Each face's surface kind and parameters come back
from `sm_faces`, and its NURBS control net and weights from `sm_face_nurbs`. A
test confirms that an extruded circle comes back as an `SmCylinder` of the
profile's radius with a rational net. The glue's `sm_edge_polylines` samples
each edge by index (tested: one polyline per edge, ending at its vertices).

**What the exporter would get, measured on the parts:**

- planes;
- **cylinders** for an extruded full circle;
- for **an extruded arc, a general B-spline surface**, not a cylinder,
  because SmApiCreateArc makes an `SmBSplineCurve`;
- for **every revolve face, a general `SmSurfOfRevolution`**, never an
  `SmCone` or `SmTorus`. Its generating curve is either a line (giving a
  cylinder or a cone) or a rational quadratic B-spline (an arc, giving a
  torus or a sphere);
- for a fillet along a line, an `SmCone` with a half-angle of 0, which is a
  cylinder;
- for a fillet along an arc, a surface of revolution.

**What this means for the exporter.** It must recognise analytic surfaces
itself, or else write `SURFACE_OF_REVOLUTION` and
`B_SPLINE_SURFACE_WITH_KNOTS`. The glue does not yet export knot vectors,
edge curves or p-curves; STEP needs them and they are not built. SMLib has no
STEP writer of its own (`SmApiImportExport.h` reads and writes only its own
`.smb` files). So the hand-written exporter in `step-export.md` stays the
plan, fed from the kernel instead of from the relational twins.

### Licence obligations (SMLib)

**What the source says.**

- `LICENSE` is Apache-2.0, `Copyright (c) 2020-2026 NVIDIA CORPORATION &
  AFFILIATES`.
- All 492 files under `source/SMLib` and `source/SM_API` carry
  `SPDX-License-Identifier: Apache-2.0` and NVIDIA's copyright, and no other
  (checked with grep).
- The repository has no `NOTICE` file.
- `THIRD_PARTY_NOTICES.md` lists OpenUSD, oneTBB, hwloc, MaterialX,
  OpenSubdiv, CPython, HACL*, pybind11 and tooling. **Our build compiles and
  links none of them.**

**What shipping the wasm requires.**

- The Apache-2.0 text and NVIDIA's copyright notice go with it: an *About /
  licences* page, and a `LICENSE` file beside the `.wasm`.
- A statement of changes if we ever patch SMLib. Today we do not; `glue.cpp`
  is ours.

Apache-2.0 §3 also grants a patent licence, which ends for anyone who sues
over a patent in it. Emscripten's runtime is MIT/NCSA (its `LICENSE`).

### Architecture sketch

```
main.ts ── facelayer (draws the meshes) ── picking (face/edge under a ray → name)
   │
   ├── solids.ts (new, operations row) — features as nodes: extrude / revolve
   │     (add · cut · intersect · new body), fillet, chamfer, shell; reads each
   │     profile from the live entities through curveplane/arcgeom accessors,
   │     evaluates the nodes in dependency order (no timeline: a node's inputs
   │     are entities and other nodes' names), caches each node's solid by a
   │     hash of its inputs, and keeps the name table
   │
   └── solidclient.ts ⇄ postMessage ⇄ solidworker.ts → smlib.wasm
         (kernel layer: profiles as numbers, frames, solids, tags — no Point,
          no entity, no name; the spike's src/kernel.ts is that contract)
```

- **The solver stays.** Sketches and constraints solve as they do today. A
  feature regenerates once its inputs settle (at the end of a drag, or after
  a `set`). Regeneration is asynchronous and starts only from the first
  changed node.
- **What stays a relational entity:** the profile (the user's sketch), the
  axis, and the depth and angle dimensions. They are what the solver moves.
- **What becomes derived:** an extrude's twins and walls, and a revolve's end
  face. Today they *are* the solid's edges, but after a cut they no longer
  are: a lid edge that a pocket crosses becomes two edges, or none.
  - Drawing, picking, sketching on a face and constraints to a solid's edge
    therefore move to the kernel's faces and edges, **by name** (`F3.lid`,
    `F3.m2|F3.lid`).
  - Old files' twins are kept on load and stop being drawn. That migration is
    its own spec.
- **Drawing.** The Worker tessellates once per regeneration. Each triangle
  carries its face index and each edge polyline its edge index
  (`sm_tessellate`, `sm_edge_polylines`), and the main side maps both to
  names. `facelayer.ts` already fills triangles with a depth test;
  `occlusion.ts` would test against a mesh instead of planar outlines.
- **Memory.** One Worker, with its maximum memory capped well under iOS's
  practical limit. It is recycled (the document replayed into a fresh one)
  when the in-use heap passes a threshold, or after a leak like the fillet's.

### Deserving scrutiny

- **OpenCascade was not run** (the policy refusal above). A like-for-like run
  needs the owner's permission to execute the npm build, or an OpenCascade
  build from source.
- **SMLib is new as open source.** It was released in October 2026 (upstream
  `VERSION` 1.0.1). Its `KNOWN_ISSUES.md` lists open bugs:
  - healing;
  - shelling, which "can return a result that is not a solid";
  - stitching, which can crash;
  - tessellation, with inside-out triangles next to fillets.

  Our parts did not hit any of them. A larger corpus, such as a fuzz of
  random profiles and booleans, should come before the product depends on
  it.
- **The fillet leak** (about 154 kB per call, in one case) is real and
  unexplained.
- **It is single-threaded** as built; SMLib's TBB parallelism is compiled
  out.
- **The volume checks rest on our own arithmetic.** The revolve is checked by
  our own Green's-theorem integral (tested on a tube, a sphere and a torus),
  and the fillet by Pappus (tested against a numerical integral). A second,
  independent kernel reading the same shapes back would be stronger; that is
  the STEP package's validation.
- **Tagging is slow as written.** It finds each tag by asking every face for
  its area and an interior point, which is most of a revolve's 88 ms. A
  product would take the faces a sweep reports instead (`pOptSideFaces`,
  SmApiCreateCurveSweep).
- **The timings are single samples on a shared box**, except the 100-rebuild
  medians.
