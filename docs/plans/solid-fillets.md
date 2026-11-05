# Plan: fillets and chamfers on a body's edges

**Status: queued** (2026-11-05), after `workbenches.md` (built as the solids
module's feature), in parallel with `android.md`. The owner: *"please add
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
