# Plan: sketch editing — trim, extend, offset, mirror, chamfer, patterns

**Status: built** (2026-11-06), on `claude/sketch-edit` — see *As built* at
the end for what was built, the decisions taken and every deviation.

*Queued* (2026-11-05), after `workbenches.md` and
`regions-as-operations.md` (the owner confirmed the order): written as a
module from the start, and trim works on regions as that package defines
them. The owner: *"give me better sketch tools, relations, trim, slot... all
the usual"*.

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

## As built (2026-11-06)

Branch `claude/sketch-edit`, from `claude/resume-tasks-o7q02e` after
workbenches and regions as operations. Where it differs from the design above
it is marked ⚠; each ⚠ is also in TODO.md's register, as vetoable.

**By file.** New: `src/sketchedit.ts` (the seven operations, `trimPiece`,
`extendReach`, `planOffset`, `walkChain`, `chainThrough`, `patternNames`),
`src/sketchgeom.ts` (carriers and where they meet — `cutsOf`, `reachOf`,
`fractionOn`, `pointOn`, `distanceToCurve`), `src/relations/pattern.ts`
(`translated`, `rotated`, `rotation`), the tools `src/tools/{trim,extend,
offset,mirror,bevel,pattern,editdraw}.ts`. Changed: `model.ts`
(`retargetArc`, `circleToArc`, `arcToCircle`, `nameCounters`,
`restoreNameCounters`), `operations.ts` (`featuresTouching`,
`regenerationRefusal`, `regenerateNamed`), `relations/geometry.ts` (`sym`
about a frame axis), `modules/sketch.ts` (the tools, glyphs, the modify
group, the relations, the operations, the replay entries, the typed
commands, help's `edit` section), `modules.ts` (`ModuleKit.log`),
`replenv.ts` (the typed `chamfer` told apart by its second argument),
`tools/fillet.ts` (its guidance in its own name, for the bevel), `glyphs.ts`
(the pattern relations' marks, the rotation's label), `index.html`
(`#flyout`'s padding). Tests: `test/sketchedit.test.ts` (28),
`test/sketchedittools.test.ts` (10), `test/e2e/sketchedit.e2e.ts` (8: mouse
and iPhone 13), and the tables the tools join (modules, menu, toolbar groups,
dimensions, tooltips; the context menu and toolbar-groups e2e files).

**The operations: what each journals, refuses and cascades.**

| call | journalled as | refuses | makes, holds, cascades |
|---|---|---|---|
| `trim("l1", [x, y, z])` | `trim("l1", at, [lo, hi], regenerated?)` — each cut `[curve, point or null, place]`; then its tidying as `del` journals it | not a line, arc or circle; an ellipse (no elliptical arc); nothing cuts it (`del` removes it whole); a circle cut once; a feature's own edge; a place not the model's coordinates; a feature on it that could not find its profile afterwards (tried and taken back) | an end re-pointed at the cut (`retargetLine`/`retargetArc`, the arc's `arcends` rebuilt in place); a middle piece leaves a new line held `col` (an arc: same centre, `eqrad`, `arcends`); a circle becomes an arc **under its name** (`circleToArc`), `arcends` added. A new end is a new point held `on` the cutter (`oncircle` on a circle or arc) — or the point already there: a T's own end, a crossing made real. The features touching it are regenerated inside the call. Tidied: holds of points on the piece that went (an `intersection` re-held `on` its other curve), holds of a cut point on the curve it now ends, the end the piece stranded with what named it — unless something is built on it or a feature names it |
| `extend("l1", "p2", to?)` or `extend("l1", [x, y])` | `extend("l1", "p2", "c3", [x, y, z])` | not a line or an arc; an end another curve shares or a `coin` holds (a corner); nothing that way; a feature's edge | the end moves (its name, and what names it, kept), held `on` what it reached. Cascades nothing |
| `offset(chain, d, { construction }?)` | `offset(names, d, options or null, { side, radii, smooth })` | a distance of 0; not lines, arcs and circles; a branch; a member not joined to the rest; a circle with others; inward past a radius; a corner the copies do not meet at; a feature's edge | one point per corner (the sharp corner where the copies cross, the smooth one along the common normal), one copy per member: a line `par` + `dist` (each its own dimension); an arc about **the same centre point**, `arcends`, `tan` to a line copy where it met that line smoothly, else `rad` r ± d; a circle about the same centre, `rad` r ± d; an open chain's line ends held `perp` across. Cascades nothing |
| `mirror(names, line)` | `mirror(names, line, { shared, level })` | an ellipse or a frame among the names; a line that is neither a line nor an axis; `z` in 2D; everything on the line; a feature's edge | a point per point (`sym` about the line); a point on the line is its own mirror, held `on` it where the line is a line; a curve per curve, an arc's ends `arcends`, a circle `eqrad` (and, in 3D, `par` when the line lies in its plane); a curve all on the line is not copied. Cascades nothing |
| `chamfer("l1", "l2", d1, d2?)` | `chamfer("l1", "l2", d1[, d2])`, or `[l1, l2, d1, d2 or null, regenerated]` | a setback not positive or past a leg's far end; lines that share no corner; legs on one line | two new ends, each leg re-pointed to one, a line between them; **the corner point stays at the corner**, held by `intersection` of the legs; `dist(corner, T1, d1)` and either `spacing(T1, corner, T2)` or `dist(corner, T2, d2)`. Features on a leg regenerate as `fillet`'s do |
| `linear(names, dx, dy, n)` | `linear(names, dx, dy, n, { step, plane })` | a step of nothing; a count not a whole number 2–200; an ellipse or frame; a feature's edge | n − 1 copies named `l1_2 … l1_n`, a construction line from the seed's first point to its first copy with `dist` (the spacing) and `par` to the plane's axis (else `ang` to its x and, in 3D, `onplane`), every other copy point `translated`; arcs `arcends`, circles `eqrad` (+ `par` in 3D). Cascades nothing |
| `circular(names, centre, angle, n)` | `circular(names, centre, angle, n, { first, plane })` | a centre that is no point; an angle of 0 or past a whole turn; the count; everything on the centre | copies named as linear's, the centre never copied; the seed's first point off the centre turned to its copy by `rotation` (a dimension, the step's angle), every other point `rotated`. Cascades nothing |

Every one is one typed call and so one undo step; every one replays (a
module's `operations` entry is its replay entry — there is no second table in
`persist.ts` any more, the spec's wording predates that). No format bump: an
older build refuses the new ops by name at their step, the ellipse's precedent.

**How trim meets regions** (regions-as-operations.md's rule for a face
changed or gone): a region's face is found again from its members after the
trim, so a face trimmed into a smaller loop is that loop (tested: the left
half of a rectangle a line crosses, 600 of its 1200); a face whose loop the
trim opens does nothing while it is open, and a region with no feature on it
is left to that. **A feature on it is regenerated inside the trim; where it
could not be** — its region's first face gone, or two loops keeping as much
of it — **the trim refuses, naming the feature and the regions' own reason**,
having tried the change and taken it back. ⚠ Where `fillet` (which predates
the question) leaves such a feature as it was, trim refuses: a trim's whole
point is to change a profile, and leaving the solid on the old one would be
a model the drawing contradicts.

**The pattern naming** (vetoable): copy k of `l1` is `l1_k`, k from 2 — the
seed is instance 1, and the count includes it — for every entity a pattern
copies, points included; a second pattern of the same seed takes a letter,
`l1_2b`, then `l1_2c`. **Deleting the seed deletes no copy**: what named the
seed's points goes with them (the first copy's hold, the construction line,
the dimension), and the copies keep what holds them to one another — copy 3
still steps from copy 2 — and are otherwise free. Deleting only a seed's
curve (`del("l1")`) takes the relations naming the curve and leaves the
pattern held, since a pattern holds points.

**The tools' gestures** (all under modify; the flyout lists the sketch's
edits, then the solid's round and chamfer — fillet, bevel, trim, extend,
offset, mirror, pattern, round, chamfer; it wraps into two lines on a phone):

- **trim** — click the piece to remove; the hover draws it in the cut's red
  (a curve nothing cuts dashed). One click, one typed line, no ✓.
- **extend** — click a line or arc near the end to lengthen; the hover draws
  the reach dashed green to a ring where it lands (a corner, red).
- **offset** — click a curve (its chain comes with it), move to the side you
  want, ✓ / Enter / a click on the chain; or press off the chain and drag the
  distance — let go and it is typed into the option (`arm("offset", {
  distance: 7.5 })`). The copy drawn is the call's own seed (`planOffset`).
  Options: distance, construction.
- **mirror** — select, then arm (or click things in, ✓), then click the
  mirror line or a frame marker's arm, ✓. The copy preview.
- **bevel** — the fillet's gesture: two lines or their corner, ✓. Options:
  setback, second (0: the same).
- **pattern** — select (or click things in), choose Linear or Circular, set
  count, step x / y (or angle) in the panel, ✓; a circular one asks for its
  centre (a point, or a circle or arc for its centre) after the first ✓.

**Deviations and additions, each a decision, vetoable:**

- ⚠ **The sketch chamfer's tool is `bevel`**: `chamfer` is the solid's edge
  tool on the same button (solid-fillets.md), and a tool's name is one word.
  The typed call is `chamfer("l1", "l2", 5)`, told from the solid's
  `chamfer("e1", [edges], 2)` by its second argument; it journals as
  `chamfer`, the solid's as `chamferEdges`.
- ⚠ **A trimmed end is held `on` the cutter only**, not by `intersection`
  with both curves: it is its own curve's end (a line's by structure, an
  arc's by `arcends`), and a hold on its own curve is a row identically zero
  that the diagnosis reports as redundant.
- ⚠ **A circle trims to an arc under the circle's own name**, so every
  relation on it keeps meaning what it meant; a middle piece's second half is
  a new curve held `col` (an arc's: the same centre point and `eqrad`).
- ⚠ **A curve nothing cuts is refused**, where Onshape deletes it: the
  refusal says `del` removes it whole, and the tool says so muted.
- ⚠ **Trim refuses where a feature could not be regenerated**, by trying
  (above) — two new Model methods let it put the name counters back.
- ⚠ **A crossing a feature made real becomes the sketch's** when a trim
  ends a curve there: the record stops owning the point and its holds (found:
  the second trim, ARCHITECTURE's 38).
- ⚠ **Extend moves the end itself** rather than re-pointing to a new point,
  and refuses a corner — pulling it would pull the other curve.
- ⚠ **Offset's arcs share the original's centre point** instead of a
  `conc`; **each piece's distance is its own dimension** (to change an offset,
  set each); a lone arc's or circle's radius, and an arc's not tangent to a
  line copy, is a `rad` of r ± d, which does not follow the original's radius;
  the free end of an open chain's end arc is held by nothing but the rim.
  Positive is outward for a closed chain, to the left of the first member as
  drawn for an open one.
- ⚠ **Mirror holds the copies by `sym` and nothing the `sym`s already
  say**: relations among the originals are not re-made between the copies
  (they would all be redundant); shared corners stay shared; an arc's copy
  holds `arcends`, a circle's `eqrad`. A point on the line is its own mirror,
  held `on` the line — not when the line is an axis (`on` takes no axis).
- ⚠ **`sym` takes a frame's axis as a located line** through the frame's
  origin (the direction relations still read an axis as a heading): what
  "mirror about the y axis" means.
- ⚠ **The chamfer's corner point is not construction** (a point carries no
  such flag): it stays where the corner is, held by the legs' `intersection`,
  so every dimension on the corner still measures the sharp corner. One
  setback is one dimension and an `equalSpacing`.
- ⚠ **Patterns are held by three new relations** (`translated`, `rotated`,
  `rotation`), one dimension driving each pattern (the linear's spacing, a
  `dist` on a construction line from the seed's first point to its first copy;
  the circular's `rotation`); the spec's "dist/par of corresponding points"
  would have made a dimension per point per copy. **One pattern tool**, its
  kind a choice in the panel, where the spec could be read as two.
- ⚠ **Angles are radians** (`circular`'s `angle` is the whole sweep; a
  whole turn spreads the copies evenly round, a part turn from the seed to the
  last), as every typed angle is; the rotation's label reads degrees.
- ⚠ **The edit tools read a press on a solid's own edge on the sketch
  plane** (`curveUnder`): from above a lid's edge is on the sketch edge's
  pixel (found: ARCHITECTURE's 37).
- ⚠ **`#flyout` has its own 3 px padding** (index.html), the size
  `flyoutSize` always assumed: the modify flyout is the first to wrap, and its
  second line was cut (ARCHITECTURE's 39). The toolbar-groups phone test's
  "tap elsewhere" landed on that second line; it taps right of it now and
  checks it is the canvas.
- ⚠ **The empty-canvas menu lists the edits** under Modify, by the toolbar
  groups rule (a group of two or more under its heading).

**Verification as run.** Typecheck 0 errors before and after. Unit 1584 →
1622 (the base's 1584, 28 in `test/sketchedit.test.ts`, 10 in
`test/sketchedittools.test.ts`; the tables in the modules, menu, toolbar
groups and dimensions suites grown, no test added there). Kernel 11/11. E2E,
the whole suite in nineteen sets of four files on the commit before the merge
with the working branch: 645 tests (the base's 637, 8 in
`sketchedit.e2e.ts`), 640 pass, 4 fail, 1 skipped. Of the four, one was real
— `panels.e2e.ts`'s toolbar table, which had to learn that the edits share
the fillet's button (fixed; 39/39 alone); three were the timing flakes the
working branch's log already records — Pixel 7's drag in `android.e2e.ts`
(14/14 alone) and the phone fillet file's two steps (3/3 alone). After the
merge, typecheck, unit and kernel again, and the files the merge or this
package touch (panels, panels preview, fits, chrome, touch, sketch edit,
toolbar groups, context menu) once more, in two sets: 125 tests, 122 pass,
1 skipped, 2 fail — toolbar groups' 300 ms leave-timer check and the test
built on it, the load flake TODO.md records (8/8 alone). Pictures:
docs/images/206–215, each looked at.

**Left in place, deliberately:**

- An ellipse is not trimmed (there is no elliptical arc) and does not cut a
  circle, an arc or another ellipse (a quartic; it cuts lines).
- A circle trimmed needs two cuts; a curve with none is `del`'s.
- The pattern panel shows the linear and circular fields together (the
  options panel cannot hide a field); each kind reads its own.
- A pattern draws a mark per copied point, which a big pattern crowds.
- A linear pattern on a face's plane (not a frame) holds the step's length
  and plane but not its direction.
- Not tried on an iPhone: Chromium's iPhone 13 emulation only.
