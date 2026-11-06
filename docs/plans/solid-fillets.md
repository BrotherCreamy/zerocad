# Plan: fillets and chamfers on a body's edges

**Status: built** (2026-11-05), on `claude/solid-fillets` — see *As built* at
the end, where every deviation is marked ⚠. After `workbenches.md` (built as
the solids module's feature), in parallel with `android.md`. The owner: *"please add
solid and surface fillet tools if possible (after you do the nurbs
conversion)"*. The NURBS conversion is `solids-kernel.md`, built: bodies are
the kernel's, and the kernel contract already has `fillet(s, edges, r)` and
`chamfer(s, edges, d)` (`src/solids/kernel.ts`), proven in the spike with
one caveat below. Surface fillets are `surfaces.md`'s, since a surface is
not yet a kind.

Read `CLAUDE.md`, `docs/ARCHITECTURE.md` ("A body is a chain"),
`solids-kernel.md` as built (the evaluation, naming by tag, the Worker's
recycling, the deviation *"kernel edges are drawn but cannot be hovered or
constrained"*), `solid-kernel-spike.md` (*Findings*: the fillet leak of
about 154 kB per call, chamfer's setback semantics), `feature-dialog.md`,
`tools/fillet.ts` (the sketch fillet: the model for the gesture),
`src/solids/`, `src/picking.ts`, `src/facelayer.ts`, `src/occlusion.ts`,
`src/step.ts`, and the solids, identity and step tests.

## Design

- **Kernel edges become pickable first** — the loose end this stands on. A
  body's edges carry the kernel's names (`e1.m1|e2.m0`); hover lights one,
  with its tooltip naming it; a click selects it (an edge selection is a
  new selection kind, drawn as the solid's edges are, in the selection
  ink); a box selects several; a tap on a phone the same with its reach.
  Sketch-on-face and the work plane are untouched.
- **Fillet** (`fillet("e1", ["e1.m1|e2.m0", ...], 3)`): a **feature** in the
  body's chain, after the feature whose edges it names — evaluated by the
  kernel's `fillet`, named by tag like a boolean, its faces tessellated and
  drawn like any body face, its new faces named `fillet.n` after the edge.
  The tool (under **modify**, in the part workbench): click edges (or a
  face: all its edges; or a body: all), the radius in the options panel and
  as a draggable dimension on one filleted edge, a live preview from the
  kernel (the last good body stays until the preview arrives, as a drag
  does), ✓ to commit. Tangent-chain selection: an edge click takes the
  edges smoothly joined to it (option, default on).
- **Chamfer**: the same with a setback distance (`chamfer(...)`); equal
  setback only; two distances and an angle later if asked.
- **Edits**: the radius is a dimension, so it is edited, driven and undone
  like one; the edge list is edited through the feature dialog (Edit on
  the organiser row), which re-lights the edges. Identity: a fillet names
  edges by their tags, so a cut that removes an edge removes the fillet of
  it with a word in the log, and a topology change that keeps the tag keeps
  the fillet (the identity tests gain a filleted part).
- **The leak, handled**: the Worker is recycled when its heap passes the
  threshold (`solids-kernel.md` built that); measure 200 fillet rebuilds
  stay under the cap and say the number. If upstream has fixed the leak at
  a newer pin, say so; do not move the pin in this package.
- **STEP**: fillet faces are the kernel's B-spline surfaces, written as
  the exporter writes kernel faces now; re-validate with OpenCascade
  (outside the repo, recorded), a filleted and a chamfered part.
- **Drawing**: fillet faces are curved, so their edges are the kernel's
  edge curves, drawn as the hidden-edge pass draws a cylinder's seams;
  check the tessellation density follows the radius at the view's scale.
- Out of scope, written down: variable-radius fillets, face fillets
  (between two faces with no shared edge — `surfaces.md`), setback
  corners, hold-line fillets.

## Tests

Unit: fillet and chamfer by volume against the closed form on the spike's
parts (a filleted box: V − (4 − π)r²·L per edge, …); the feature's place
in the chain; the tag naming of new faces; identity through a cut that
removes a filleted edge; 200 rebuilds under the memory cap; edge picking
by ray on the kernel's edges. E2E (mouse and iPhone 13): hover an edge,
click it, fillet it, drag the radius, undo, save and open, export STEP;
chamfer the same; the preview while the finger holds. LOOK at each
picture — the shading across the blend above all.

## Docs

CHANGELOG at the top quoting the owner; ARCHITECTURE (edge selection; a
fillet as a chain feature); the register (tangent-chain default; equal
setback; what is out of scope) as vetoable; STATUS; README; `help()`; the
spec marked built with the deviations.

## As built (2026-11-05)

Built on `claude/solid-fillets`, from `claude/resume-tasks-o7q02e` at the
mode-feedback merge. Where it differs from the design above it is marked ⚠;
each ⚠ is also in TODO.md's register, as vetoable.

### Kernel edges, pickable

- **An edge is its name** — `e1.lid|e1.m0`, its two faces' names
  (`src/solids/naming.ts`); a split face's pieces share a name, so one name
  can answer to several kernel edges, and picking, selecting and filleting it
  take them all. `src/kerneledges.ts` (new, beside `bodies.ts`) answers which
  edge is under a pixel (`edgeAt`: screen space, a line's 5 px, a finger's
  2.75×, only where the nearest place on it is in sight through the frame's
  occlusion), which a box holds (`edgesInBox`: window and crossing, by the
  seen part, as box select's rules), which run on smoothly (`tangentChain`),
  which bound a face (`faceEdges`), and the hover tag (`describeEdge`:
  `e1.lid|e1.m1  edge of e1  len 47  ·  e3`).
- **A new pick kind, `edge`** (`picking.ts`), found by the engine's `pickAt`
  through the host (`engine.solids`, `SolidsAccess` in `tools/tool.ts`).
  ⚠ **It wins where no entity picks, and over the kernel body's skeleton** —
  its twins, walls and whole profile members (quiet.ts's solid edges), which
  the kernel draws in their place, in every view — **but a press still drags
  that skeleton** (`Pick.under`), so a lid is resized by its edge exactly as
  before. A point still wins, as it wins over a line. A profile member that is
  only a portion of a longer line keeps its pick: it runs past the solid (the
  hidden view's e2e found this).
- **An edge selection** (`Selection.edges`): a click selects one, shift (or a
  tap, once something is selected) toggles one, a box adds every edge it
  holds; drawn along the kernel's own curve through the same occlusion as a
  solid's edges, in the selection's violet (and the hover's amber). The round
  and chamfer tools start from it (`ctx.preedges`).
- ⚠ **A body of one extrude has kernel edges only while the round or chamfer
  tool is armed** (`Tool.kernelEdges`, `Bodies.everything`), or once it is
  rounded. Otherwise it is still `faces.ts`'s, live, and no Worker starts for
  it — the solids package's decision, kept. With nothing armed, a plain
  extrude's edges are its twin lines, as before; a twin line selected and then
  Round armed is not turned into the kernel edge along it.
- A right-click on an edge: its hover line, and **Fillet… / Chamfer…**, which
  type the call up to its size (the menu only ever types).
- Sketch on face and the work plane are untouched.

### Fillet and chamfer as features

- **The record** (`BlendFeature`, `model.ts`): `{ kind: "fillet" | "chamfer",
  name: "e3", into: "e1", edges, size: "d7", names: [d7], owns: [d7] }`.
  ⚠ **In a registry of its own, `model.blends`**, sharing the features' `e`
  names, `has`, `del`, `hide`, `edit`, `ls()` and the organiser's rows. In
  `model.features`, every reader of a sweep's profile would have had to learn
  to skip it — 81 type errors in `operations.ts` alone, the file
  regions-as-operations is rewriting in parallel. The cascade gained two lines.
- **In the chain** (`modes.ts`): `Chain.steps` holds the sweeps and the blends
  in creation order — each blend just before the first sweep numbered after
  it — and `Chain.features` stays the sweeps, so every sweep reader is
  unchanged. `programOf` sends a blend as a node; a body with a blend is a
  kernel body even with one sweep. Hidden, a blend is left out of its body; its
  body deleted, it is left out, said.
- **The operations** (`src/blends.ts`, new, at the operations' height):
  `fillet("e1", ["e1.lid|e1.m0", …], 3)` — the typed `fillet`, told from the
  sketch's corner fillet by its list — journalled as `filletEdges`;
  `chamfer("e1", [...], 2)` as `chamferEdges`; `setEdges("e3", [...])`, the
  edit dialog's, in place. Edges are checked for shape, never for presence:
  whether one is on the body is the kernel's to say, asynchronously, so a
  replay, a test with no kernel and a phone yet to load it make the same record.
- **The size is a dimension with no equation** (`src/relations/blend.ts`:
  `filletRadius`, `chamferSetback`), declared as dimensions by the solids
  module, so `set("d7.value", 4)`, undo, the label (`R3`, `C2`) and Set value…
  work as for any dimension, and nothing is solved. `del` of the blend or of
  its dimension takes both.
- **Evaluation** (`src/solids/evaluate.ts`): a `BlendNode { id, op, edges,
  size }`. Its edges are found by name in whatever topology the chain made,
  rounded on a copy (the cache keeps the solid before), and each face the
  kernel made — they come back untagged; every other face keeps its tag — is
  tagged after the edge whose midpoint lies nearest it. ⚠ **Named `e3.f0`,
  `e3.f1` …** (face *i* of fillet e3, made of its edge *i*) for the spec's
  `fillet.n`; the edges round it are `e1.lid|e3.f0`. A name no edge answers to
  is said (`e3 no longer fillets e1.lid|e1.m0 — e1 has no such edge now`) and
  left out; a blend with none left is refused. ⚠ **A blend's refusal is
  soft:** the body without it is drawn (a cut that took the edge is drawn
  cut), where a failed boolean keeps the last good body.
- **The tools** (`src/tools/blend.ts`), ⚠ **named `round` and `chamfer`**: an
  icon's name is one word, and `fillet` is the sketch's corner fillet. On the
  modify button (no new button: an iPhone's column stays thirteen), after the
  fillet: fillet, chamfer, round. Click an edge (tangent chain on by default,
  the option `tangent`); ⚠ **a face for its edges, and the same face again for
  the body's** (the spec's "or a body: all"); a picked edge, or a face the
  preview rounded, again to drop it. The radius is in the options panel and
  **is a label on the first face the preview made, dragged along its normal**;
  let go, it becomes the option, typed as the panel's field types it. ✓ types
  one line.
- **The preview is the kernel's** (`BlendTrial`, `Bodies.trial`): the body
  built with the blend in its chain (appended, or in place of the one being
  edited), drawn in the body's place, shaded as it will be. The last good body
  stands until the answer arrives, and after ✓ or ✗ until the body's own
  arrives, so neither flashes. Picks are made on the body as drawn, the
  preview included: a rounded edge is gone from it, so its face stands for it.
  The kernel's refusal of the preview blocks ✓ and is said once, as guidance.
  ⚠ The trial runs under the number the blend will most likely get, guessed
  at the first pick; a wrong guess costs one rebuild after ✓.
- **Edit** (`edit("e3")`, Edit on its organiser row; `edit fillet` / `edit
  chamfer`): its edges picked, its size in the panel and on the drawing (the
  committed label steps aside), ✓ types `setEdges` and `set` as one step. It
  keeps at least one edge (`del("e3")` removes it).
- ⚠ **SMLib will not fillet an edge that runs into an earlier fillet at a
  corner**, whatever the radius; both in one fillet works, and a chamfer
  after a fillet works. The refusal says so and what to do; a test pins it, so
  the day SMLib learns it the test says so.
- Tangent chains: each end's tangent from the circle through its first three
  samples (exact for lines and arcs), to half a degree. ⚠ A chain runs on
  through an earlier fillet's end arc and down the edge it is tangent to, as
  Onshape's tangent propagation does — and SMLib will not chamfer such a
  chain; the chamfer e2e turns chains off for it.
- ⚠ The organiser's Features row reads `fillet` / `chamfer` (its menu's header
  says the edges: a phone's pane cut `chamfer · 1 edge`); the body's chain
  signs them `⌒e3` / `⌔e4`.

### Identity

`test/solidsidentity.test.ts` gains a filleted part: a cut made after the
fillet takes the front's fillet with the front, and the back's stands; the
same cut made before it is said as the one edge missing, the rest is rounded
and its face keeps its index (`e3.f1`); every edge taken refuses the fillet
and the body stands without it; a notch splits the edge and both pieces round
under its one name; a thicker plate keeps every name.

### The leak, measured

200 rebuilds of the spike's leaking case — the rounded outline's eight lid
edges, a new radius each time, the extrude below from the cache — through
the client and an in-process Worker: in use 2.5 → 31.7 MB, **150 kB a
rebuild** (the spike's 154 kB); linear memory peaked at **46.1 MB against the
256 MB recycle**, so none was needed (Node, 451 ms a rebuild on the shared box
under load). Recycling would come after about 1 400 such rebuilds. **Upstream
has not fixed it at a newer pin: usd-brep's `main` is still the pinned
v1.0.1** (`git ls-remote`, 2026-11-05). The pin is unmoved.

### STEP, re-validated with OpenCascade

A blend's faces are the kernel's B-spline surfaces, written as every kernel
face no feature role names; the faces it trims keep their planes, a hole its
cylinder. Three parts join `test/stepkernel.test.ts` and
`test/fixtures/step-kernel/`. OpenCascade 8.0.1 (cadquery-ocp 8.0.1.1.0 in a
scratch venv, never a dependency) read all seven fixtures by step-export.md's
two procedures. The validator was rewritten from the procedure's description
and calibrated on the four recorded parts: it reproduces their verdicts and
volumes, boss-on-cylinder's strict tolerances (3.07·10⁻⁶) to the digit, and
turned-and-drilled's known strict failure. The four old fixtures export byte
for byte as before.

| part | what | valid (healed / strict) | OpenCascade volume | closed form | ZeroCAD | surfaces | file's uncertainty |
|---|---|---|---|---|---|---|---|
| filleted-plate-drilled | two lid edges filleted r 3, then a hole cut through | yes / yes | 58 482.743 337 89 | 58 482.743 338 82 | 58 482.743 339 13 | 6 plane, 2 B-spline, 2 cylinder | 10⁻⁷ |
| rounded-outline-filleted | an outline rounded in the sketch, extruded, its eight lid edges filleted r 3 | yes / yes | 34 824.304 755 55 | 34 824.304 725 76 | 34 824.304 725 87 | 6 plane, 4 cylinder, 8 B-spline | 10⁻⁵ |
| chamfered-lid | four lid edges chamfered, setback 2 | yes / yes | 59 370.666 666 67 | 59 370.666 666 67 | 59 370.666 666 67 | 6 plane, 4 B-spline | 10⁻⁵ |

No reader fail or warning and no loose edge in any; every vertex and edge
tolerance in the strict read is 10⁻⁷. OpenCascade's volume is the closed form
to 1.6·10⁻¹¹, 8.6·10⁻¹⁰ (its integral of the toroidal corner patches;
ZeroCAD's is 3·10⁻¹² off) and 10⁻¹⁶. ⚠ A chamfer's faces are flat but written
as the kernel's B-splines, not `PLANE`, with B-spline edges, so its file
declares 10⁻⁵.

### Drawing

Fillet faces are drawn and picked as any kernel face, their edges the
kernel's edge curves. The tessellation is the kernel's angle bound (10°): a
fillet's facets turn at most 10° whatever its radius — as many across r 0.5
as across r 12 (tested) — so the density **follows the radius, but not the
view's scale**. ⚠ At 4× zoom on an r 3 fillet the facets are about 10 px
wide and the flat shading shows faint steps (docs/images/174). Smooth
shading, or re-tessellating with the zoom, would remove them; left.

### Tests

**The gate, as run** (merged with regions as operations, 2026-11-06): typecheck 0 errors; unit 1477/1477; kernel 11/11; e2e 592 tests in eighteen sets of four files, 591 pass, 0 fail, 1 skipped. Base before this package: unit 1435.

Unit 1435 → 1453 on its own base: `test/solidfillets.test.ts` (15: the spike's
fillet-outline-and-top and chamfer-top-edges built the app's way, against
Pappus and inclusion–exclusion; one straight edge against (4 − π)/4 · r² · L;
a hole's rim chamfered against Pappus; the chain; the face naming; the soft
refusal; the SMLib limitation pinned; the dimension's edits, save and open,
del; the organiser; the 200 rebuilds; picking by pixel; tangent chains; the
facets; the typed surface) and 3 in `solidsidentity.test.ts`;
`stepkernel.test.ts` gains three parts and one test. The tables the new
tools and dimensions join (modules, menu, toolbar groups, dimensions) are
updated. ⚠ The spec's closed form, V − (4 − π) r² L per edge, is four times
the spandrel of a quarter disc; the tests use (4 − π)/4 · r² · L.

E2E: `solidfillets.e2e.ts` (8, desktop) and `solidfilletsphone.e2e.ts` (3,
iPhone 13): hover an edge (its name), click it, the kernel's preview, ✓, the
label dragged (the preview follows while the finger is still down), undo; a
click, shift-click, box and right-click on edges with nothing armed; select
then Round; save and open; STEP; a chamfer; the shading close up. Two
existing e2e expectations (the modify flyout, the empty-canvas menu) now list
round and chamfer. Pictures 167–176, each looked at.

**Found in the browser**, each invisible to the unit suite (ARCHITECTURE's
27–30): the preview still in the chain beside the fillet ✓ had just made, its
refusal logged as the new fillet's; a refusal said as guidance redrawing
before it was recorded as said, recursing until the stack ran out; a sketch
line that is partly a profile member losing its pick to the kernel edge along
that part; the committed `R2` drawn under the edit dialog's own label on a
phone.

Left in place, deliberately (TODO.md): variable-radius fillets, face fillets
(`surfaces.md`), setback corners, hold-line fillets, two-distance and
distance-angle chamfers; on a phone, the lifted mark reveals a corner under
the finger while it drags the radius label; Delete with only edges selected
deletes nothing (an edge is the kernel's, not the model's). **Not tried on an
iPhone**: Chromium's emulation of one only.
