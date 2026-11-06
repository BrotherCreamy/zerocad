# Plan: surfaces — a surface is a thing; trim, extend, knit and fillet are operations

**Status: queued** (2026-11-05), after `regions-as-operations.md` (which
writes the rule this package follows) and `solid-fillets.md` (which makes
kernel edges pickable). The owner: *"please add solid and surface fillet
tools if possible"*, and the rule from `regions-as-operations.md`: *"there
should be no such thing as a negative face … only an operation which
subtracts."*

Read `CLAUDE.md`, `docs/ARCHITECTURE.md`, `regions-as-operations.md` as
built (the three algebras), `solids-kernel.md`, `solid-fillets.md`,
`workbenches.md` (this is the surfaces module and the surfaces workbench),
`src/solids/kernel.ts` (what the kernel offers for sheets: extend the glue
where SMLib has it), `src/organiser.ts`, and the solids and step tests.

## Design

- **A surface is a kind**, built by the kernel as a sheet body: extruded
  surface (a sketch curve, open or closed, swept a depth), revolved
  surface, planar surface from a face, and a solid's face used as one
  (`surface(body.face)`). Listed in the organiser under *Surfaces*,
  hideable, drawn with the face layer (two-sided) and its edges the
  kernel's.
- **Operations, never negatives**: `trim(s, by)` (by a curve projected
  along the view or the plane's normal, or by another surface's
  intersection — keep the side the click is on), `extend(s, edge, d)`,
  `knit(s, t, ...)` (one sheet where edges meet within tolerance; a closed
  knit becomes a solid body on request: `thicken` / `solidify`), `offset(s,
  d)` and `thicken(s, d)` (a solid from a sheet). Each a named feature in
  the surface's chain, as bodies' booleans are.
- **Surface fillet**: `fillet(s, t, r)` between two surfaces that meet at
  an edge (after `knit`, the shared edge — `solid-fillets.md`'s kernel
  call on a sheet body) or, where SMLib offers it, a face-face blend
  between two surfaces that do not share an edge, trimming both. Say which
  of the two the kernel gives; build what it gives.
- **Surface chamfer** (the owner, 2026-11-06: *"also fillets and chamfers
  for surfaces"*): `chamfer(s, t, d)` the same way — a ruled strip between
  the two surfaces at an equal setback `d` along each, both trimmed back to
  it; at a knitted shared edge through `solid-fillets.md`'s kernel
  `chamfer` on the sheet body, between surfaces that do not share an edge
  only if the kernel offers it (say which). Both the fillet and the chamfer
  use the solid tool's gesture (`solid-fillets.md` as built: pick the edge,
  or here the two surfaces; the distance as a dimension; a live preview),
  under the same **modify** group, so one tool does solids and surfaces.
- **Sketch on a surface**: a planar surface is a work plane like a face.
- **STEP**: sheets as `SHELL_BASED_SURFACE_MODEL` (AP214), faces as the
  kernel writes them; re-validate with OpenCascade.
- Out of scope, written down: loft and sweep surfaces (the loft and sweep
  package), boundary and fill surfaces, surface patterns.

## Tests

Unit: each operation by area against the closed form; knit of two
sheets into one; a closed knit thickened by volume; a fillet between two
knitted sheets; identity of a surface's edges through a trim. E2E (mouse
and iPhone 13): extrude a surface, trim it with a sketch, knit two, fillet
the join, thicken, export. LOOK at each.

## Docs

CHANGELOG at the top quoting the owner; ARCHITECTURE's three-algebras
section gains the surface column; the register as vetoable; STATUS;
README; `help()`; the spec marked built with the deviations.
