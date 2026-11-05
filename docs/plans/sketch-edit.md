# Plan: sketch editing — trim, extend, offset, mirror, chamfer, patterns

**Status: queued** (2026-11-05), after `toolbar-groups.md`, in parallel with
`sketch-shapes.md` and `sketch-relations.md`. The owner: *"give me better
sketch tools, relations, trim, slot... all the usual"*.

Every one of these **creates or re-points entities**, so each is an
*operation* (`operations.ts`, `asOperation`, journalled as its typed call and
replayed as it), never a relation — the rule in `CLAUDE.md`. `fillet` is the
model: an operation that was typed first, then got a tool that picks
(`tools/fillet.ts`, a feature tool with a preview and ✓/✗). Build each the
same way: the operation, its unit tests, then the tool.

Read `CLAUDE.md`, `docs/ARCHITECTURE.md` ("Deleting cascades inward",
"Structure and equations are separate"), `constraint-deletion.md`,
`feature-regeneration.md` (what a regenerating extrude does when its
profile changes under it), `explicit-regions.md`, `toolbar-groups.md`,
`src/operations.ts` (`fillet`, `del`, `regenerateAfter`), `src/tools/fillet.ts`,
`feature.ts`, `src/picking.ts`, `src/loops.ts` (`heldOnCurves`,
intersections), `src/snapping.ts` (`intersection-snap.md`), and their tests.

## Design

- **Trim** (`trim(curve, near)`; tool: click the piece to remove): cuts
  `curve` at its intersections with other curves and removes the piece
  under the click. A line becomes a shorter line (its end re-pointed to a
  new point held `on` both curves — the intersection is a relation, not a
  number, so it follows); an arc or circle becomes an arc; the removed
  piece's relations that no longer have a subject go with it (as `del`
  cascades), and the rest stay. A trim that cuts a profile under an
  extrude regenerates it or refuses with the reason (no malformed model).
- **Extend** (`extend(curve, to)`): lengthens a line or arc to the next
  curve along its direction, the new end `on` it. The tool: hover shows
  where it would reach.
- **Offset** (`offset(chain, d)`; tool: click a curve, type or drag the
  distance, a side): a parallel copy of a line, arc, circle, or a connected
  chain of them, at distance `d`, held by relations: a line's offset is
  `par` and `dist` from it, an arc's `conc` and `rad` equal ± d, corners
  joined — so the offset follows the original. Option: construction.
- **Mirror** (`mirror(entities, line)`): a mirrored copy held by `sym`
  about the line (points) with the same relations between the copies as
  the originals have (two mirrored lines of equal length need no `eq`; the
  `sym` on their ends does it). The tool: select entities, click the mirror
  line (any line, the frame's axes included, by name as `par` takes them).
- **Chamfer** (`chamfer(l1, l2, d)` or `(l1, l2, d1, d2)`; tool as fillet's,
  under **modify**): the corner replaced by a line, its ends held by `dist`
  from the corner along each edge (the corner point stays as construction,
  as fillet's does — read `fillet` for how the lid regenerates).
- **Patterns**: `linear(entities, dx, dy, n)` and `circular(entities,
  centre, angle, n)`: copies with relations tying each copy to the first
  (`dist`/`par` of corresponding points for linear, equal angle about the
  centre for circular), so the pattern follows its seed. The tool: select,
  then the vector or the centre and count in the options panel. Copies are
  ordinary entities named with a suffix the register records; deleting the
  seed deletes nothing else (the copies keep their relations among
  themselves and go free), written down.
- Every operation refuses, with a reason in the log and never a thrown
  error, what would leave the model malformed; every one is one undo step;
  every one replays (`persist.ts`'s table, a save/open test per op).
- All tools under **modify** with tooltips and the options panel.

## Tests (the risky ones first)

Unit: trim across a profile under an extrude (regenerates, or refuses and
says why); trim of a circle to an arc keeps its `oncircle` points that
survive; offset of a closed chain is a closed chain; mirror about an axis
by name and about a tilted line in 3D; chamfer's dims; patterns follow
their seed when it is dragged and when a dimension changes; delete the seed;
each op's replay. E2E (mouse and iPhone 13): each tool's gesture on a drawn
sketch, undo, save and open, extrude the result. LOOK at each picture.

## Docs

CHANGELOG at the top quoting the owner; the register (each op's rule for
what it refuses and what it cascades; the pattern naming) as vetoable;
STATUS; README; `help()`; the spec marked built with the deviations.
